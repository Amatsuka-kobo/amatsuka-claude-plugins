# 引き継ぎ: スキル eval 機構を optimize-agents へ取り込む

- 作成日: 2026-08-02
- 前セッションの記録: `docs/chat/2026/0801/phyllis998/evaluate-agent-policy-skills.md`
- 関連コミット: `26c9496` / `3395af2` / `37e0ea6` / `56fd907` / `f6fb566`

## 依頼内容

skill-creator が持つ eval・ベンチマークのループ構造を optimize-agents に取り込み、手順化・スクリプト化する。スクリプトは TypeScript で書き、`plugins/optimize-agents/src/` に置いて esbuild で `plugins/optimize-agents/scripts/` へ出力する。

現状 `scripts/run-trigger-eval.mjs`(リポジトリルート、手書きの .mjs)にある実装が移行対象の起点になる。

## 着手前に読むもの

| パス | 内容 |
| --- | --- |
| `plugins/task-utility/evals/README.md` | 3 種の eval セットの役割、測定手順、実測値 |
| `plugins/optimize-agents/docs/description-out-of-scope.md` | description を prompt-smith の対象外とした根拠と実測 |
| `plugins/optimize-agents/references/description-guide.md` | description の書き方の規律。「直したときの確かめ方」が eval の設計思想にあたる |
| `scripts/run-trigger-eval.mjs` | 移行対象の実装(150 行) |
| `plugins/task-utility/build.ts` | esbuild 設定の参考にする既存プラグインの例 |

## 前提知識(これを知らないと同じ失敗をする)

### skill-creator の run_eval.py / run_loop.py は現行 Claude Code で機能しない

測定対象を `.claude/commands/` にスラッシュコマンドとして登録するが、Claude Code の現行版ではコマンドと skills が別系統である。コマンドは `/名前` で明示呼び出しするものなので自然文の依頼からは選ばれない。検出側は `Skill` ツールの呼び出しを見ているため、結果が常に「発火せず」になる。

2026-08-01 の実測: skill-creator 公式の description をその想定用途どおりの英語クエリで測っても発火率 0。同一 description・同一クエリで登録先を `.claude/skills/` に変えると resume の発火が 1/8 から 8/8 になった。

抗体 `ab-2026-0802-001` がこの内容を PreToolUse で注入する。`run_eval.py` / `run_loop.py` / `scripts.run_eval` / `scripts.run_loop` を含む Bash コマンドにマッチする。

### 測定器を先に検証する

description を書き換えてもスコアが動かないときは、description ではなく測定系を疑う。実績のある description(skill-creator 自身など)で測って発火するかを確かめる対照実験を先に行う。これを怠ると、壊れた測定に合わせて本番の description を改悪する。

前セッションでは、この対照実験に至るまでに 3 イテレーション分の測定を無駄にした。

### 3 種の依頼を必ず同時に測る

| 種別 | 内容 | 期待 |
| --- | --- | --- |
| substantive | 固有名・パス・背景を含む長い依頼 | 発火する |
| short | 実運用に多い一言の依頼 | 発火する |
| fp | 担当が近い別スキルが正解の依頼 | 発火しない |

除外の記述を足すと fp は改善するが substantive / short が落ちうる。例示を足すとその逆になる。片側だけ見て判断すると悪化に気づけない。

### assertion に識別力があるかを確かめる

output eval は with_skill / without_skill の 2 構成で測り、差を見る。with_skill だけを見ても、assertion が緩いのかスキルが効いているのかを区別できない。

前セッションの eval-1(既存ファイルへの追記)は両構成とも 6/6 で、差が出なかった。既存ファイルと INDEX が正しい状態から始まるので、何もしなくても「既存を壊さない」条件が満たされるためである。

## 移行するもの

### 1. run-trigger-eval(移行対象、実装済み)

`scripts/run-trigger-eval.mjs` を TypeScript へ書き直す。ロジックは動作確認済みなので、型付けと配置の変更が主になる。

- 一時ディレクトリに `.claude/skills/<name>/SKILL.md` を作って測定対象を登録する
- `claude -p` を `--output-format stream-json --verbose --include-partial-messages` で起動する
- 最初のツール呼び出しを検出した時点で kill する(実処理まで走らせない)
- `Skill` ツールなら発火とみなす
- should_trigger は過半数で発火、should_not_trigger は 1 度も発火しないことを合格とする

移行後はルートの `scripts/run-trigger-eval.mjs` を削除し、`CLAUDE.md` の参照先(「skill-creator でスキルの発火精度を測る時は〜」の行)と抗体 `ab-2026-0802-001` の本文を新しいパスへ更新する。抗体の更新には `plugins/raphael/scripts/update-antibody.mjs patch <id>` を使う。

### 2. output eval のチェッカー(要一般化)

`plugins/task-utility/evals/check-chat-output.mjs` は chat スキル専用のハードコードである。optimize-agents に置くなら、assertion を宣言的に書ける形へ一般化する必要がある。

一般化の方向性(要検討):
- assertion を JSON で定義し、汎用チェッカーが解釈する
- スキル固有の判定はプラグイン側に残し、optimize-agents は実行と集計だけを担う

後者のほうが現実的と思われる。前セッションでは判断していない。

### 3. ベンチマーク集計(未着手)

skill-creator の `aggregate_benchmark.py`(401 行)に相当する機構。pass_rate / 所要時間 / トークン数を構成ごとに集計し、平均と標準偏差、差分を出す。

前セッションでは手作業で集計したため、この部分は実装していない。

### 4. イテレーションのループ構造(未着手)

skill-creator の SKILL.md が持つ「draft → test → review → improve → repeat」の手順。optimize-agents に取り込むなら、スキルとして手順を書き、スクリプトが各段を支援する形になる。

前セッションでは 1 往復しか回していない(測定 → description 修正 → 再測定)。

## 構造上の注意

### optimize-agents は現在スクリプトを持たない

`plugins/optimize-agents/` の構成は `README.md` / `assets` / `docs` / `references` / `skills` のみで、`src/` も `package.json` も `build.ts` もない。スクリプトを持たせるには次が要る。

1. `plugins/optimize-agents/package.json` を新設(`plugins/task-utility/package.json` と同形式)
2. `plugins/optimize-agents/build.ts` を新設(`plugins/task-utility/build.ts` と同形式)
3. `pnpm-workspace.yaml` の `packages` に `plugins/optimize-agents` を追加

`pnpm-workspace.yaml` への追加を忘れると `pnpm build` が対象にしない。

### 配置の規律

- ソースは `plugins/optimize-agents/src/`、バンドル出力は `plugins/optimize-agents/scripts/`
- バンドル出力も git 管理する(利用者はビルド不要)。ソースを変更したら `pnpm build` を実行し、生成物の差分もコミットする
- テストは `plugins/optimize-agents/src/__test__/*.test.ts`

### ライセンス

skill-creator は Apache License 2.0。改変・再配布・派生物の作成が許諾されている。ただし `run-trigger-eval.mjs` は skill-creator のコードを流用しておらず、`claude -p` の公開 CLI インターフェースだけを使った独立実装である。借りているのは「スキルを登録して Skill ツール呼び出しを監視する」という手法の着想のみ。

aggregate_benchmark 等を新たに移植する際にコードを参照する場合は、Apache 2.0 の条件(著作権表示と変更点の記載)に従う。

## 前セッションで判断済みの事項

| 事項 | 決定 |
| --- | --- |
| description は prompt-smith の対象外 | 確定。`references/description-guide.md` が基準の正本 |
| description の基準は optimize-agents 内で自己完結させる | 確定。skill-creator への参照は解消済み |
| eval セットは測定対象プラグイン配下に置く | task-utility では `plugins/task-utility/evals/` に配置済み |
| 測定ツールの置き場 | 今回の依頼で optimize-agents 配下へ移すことが決定 |

## 前セッションで未解決の事項

| 事項 | 状況 |
| --- | --- |
| resume の誤発火 2 件 | 「PR のレビューを再開」「リファクタ続けて」。description の否定条項に該当する語を含みながら発火する。文面では抑えきれないと判断して据え置き |
| issue-craft の誤発火 1 件 | 「gh コマンドで Issue 一覧を取得する方法を教えて」。同上 |
| output eval の eval-1 に識別力がない | 追記でしか変化しない assertion を足す必要がある |
| 他プラグインへの eval 展開 | task-utility 以外は未着手 |

## 実測値(回帰の基準として使う)

2026-08-02 時点の task-utility 6 スキル、168 問。

| スキル | substantive | short | fp |
| --- | ---: | ---: | ---: |
| chat | 6/8 | 6/8 | 12/12 |
| chat-recall | 8/8 | 8/8 | 12/12 |
| resume | 8/8 | 8/8 | 10/12 |
| issue-craft | 8/8 | 8/8 | 11/12 |
| issue-split | 8/8 | 8/8 | 12/12 |
| issue-triage | 8/8 | 8/8 | 12/12 |
| 合計 | 46/48 | 46/48 | 69/72 |

output eval(chat): 新規記録 with_skill 9/9 / without_skill 4/9、既存への追記 6/6 / 6/6。

移行後は同じ eval セットで測り直し、この値から落ちていないことを確認する。

## 実行環境

- `claude -p` は CLIProxyAPI 経由のサブスク認証で動く。API 実費は発生しない
- 測定は一時ディレクトリで行う。`run_eval.py` は cwd から上へ `.claude/` を探すため、cwd をサンドボックスにしないとリポジトリの設定に触れる
- 6 スキル × 3 セットの並列測定で 20 分程度かかる
