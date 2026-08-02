# optimize-agents プラグイン検査

- 日付: 2026-08-03
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: なし（検査実施のみ）
- 前提: optimize-agents プラグイン定義一式

---

## セッション1: プラグイン自体の検査実施

# phyllis998

> optimize-agentsでoptimize-agentsを検査してください

# AI

(tool: Bash — List optimize-agents plugin files, Bash — Check checker CLI usage, Bash — Show manifest and file sizes, Bash — Read checker CLI headers, Bash — Run skill definition checker on all skills)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/references/orchestration-discipline.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/README.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/prompt-smith/SKILL.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/agent-creator/SKILL.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup-gpt/SKILL.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/claude-model-policy/SKILL.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/references/description-guide.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/references/agent-definition-spec.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/references/context-map-guide.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/docs/skill-creator-intake.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup-gpt/assets/gpt-sol.temp)

optimize-agents プラグイン自体の構造、スキル定義、参照ドキュメント、設定を包括的に検査。

- ファイル構成、manifest、各スキル (prompt-smith, agent-creator, setup-gpt, claude-model-policy) の定義形式を確認
- orchestration-discipline、description-guide、agent-definition-spec、context-map-guide などの規律ドキュメントを確認
- skill-creator-intake の intake 要件を確認
- setup-gpt の gpt-sol.temp テンプレートを確認

全体の構成と規律に問題なし。
## セッション 1: プラグイン構成の確認と検査実行

# AI

- optimize-agents プラグイン(`plugins/optimize-agents/`)の全体像を把握するため、ファイル一覧・README・検査用 CLI の仕様を調査(tool: Bash × 3, Read × 3)
- 6 スキル(`agent-creator` / `claude-model-policy` / `prompt-smith` / `setup-gpt` / `skill-eval` / `with-codex-policy`)と 3 つの references ドキュメント、および 3 つの GPT エージェントテンプレート(`gpt-sol` / `gpt-luna` / `gpt-terra`)の実装を確認
- `check-skill-definition.mjs` と `check-agent-definition.mjs` による静的検査をすべてのスキル・テンプレートに実行(tool: Bash — Run skill definition checker on all skills)
- `prompt-smith` の評価様式に基づき、6 スキルと 4 つの references ドキュメント(全 10 文書)に対して冗長度・充足度・スタイル適合の 3 軸で評価を実施

---

## セッション 2: 検査結果の報告と判断確認

# AI

**何をしたか**

- 4 つの主な不整合(S1〜S4)を特定
  - S1: スキル名が README と実装で食い違う。`setup-gpt` ディレクトリながら frontmatter `name` は `setup` で、実際のコマンドは `/optimize-agents:setup` となり、README の 9 行目・40 行目では `optimize-agents:setup-gpt` と記載。これまで判断が 2 回反転(plans では `setup-gpt` 統一を決定 → design で『README が正しい』として取り消し → docs では『不一致は仕様上許容』と記録)し、いずれの版も完結していない状態
  - S2: eval セット分類の呼称が 3 つ混在。SKILL.md 本文では `substantive / short / fp`、`evals/` ディレクトリは `trigger / short / fp`、description-guide.md の表は「文脈のある依頼 / 短い依頼 / 近接した依頼」
  - S3: 6 スキル中 3 スキル(`setup-gpt` / `with-codex-policy` / `claude-model-policy`)の eval セットが未測定。このうち `with-codex-policy` と `claude-model-policy` は排他選択される最重要スキルで、誤発火コストが極めて高い
  - S4: `plugin.json` が `0.12.0-dev` のまま。README の 0.12.0 節は変更を過去形で記述済みで、バージョンラベル更新の判断が保留
- 静的検査結果は良好(`check-skill-definition` 6 スキル / `check-agent-definition` 3 テンプレートすべて errors 0、warnings は `.template.md` サフィックスによる誤検出のみ、`pnpm build` は成功で差分なし)
- `prompt-smith` による評価で 10 文書に対し 37 件の指摘を抽出。内訳は削除対象 18 件、書き換え対象 12 件、退避対象 5 件、統一対象 2 件

**決定と理由**

S1・S2・S3 の 3 点について、ユーザーの判断を仰ぐことが必須と判定。プラグイン自体の正確性と配布先での動作に直結するため、推奨値(S1 は A 案「`setup-gpt` に統一」、S2・S3 は全指摘・全 eval セット作成)を示した上で確認を求めた。

**失敗・やり直し・誤った前提**

評点式(`prompt-smith`)の自己適用で、計算式の欠陥が露出。「引くための記述を分母から除く」という基準が表を大量に持つ文書(担当表が本体の `claude-model-policy`)に当たると、分母が 5 まで縮み、1 件の指摘が 20% を占めてしまう問題が顕在化。この欠陥は指摘 #12 として記録。

---

## セッション 3: ユーザーの決定と実行開始

# phyllis998

> 1. Aでお願いします。
> 2. 全件お願いします。
> 3. 走らせてください。3スキル分のevalセットも新規で作ってください。

# AI

S1 の決着を「`setup-gpt` に統一」(A 案)に確定。指摘 #1〜#37 のすべてを適用対象として、各スキル・references ドキュメントの修正を開始。同時に未測定 3 スキル(`setup-gpt` / `with-codex-policy` / `claude-model-policy`)の eval セットを新規作成し、発火精度の実測(`run-trigger-eval.mjs`、概算 160 回の `claude -p` 起動)を実行予定。

次ターン以降で修正の詳細と実測結果を報告します。

---

注意事項: 指摘 #1〜#37 の適用、3 スキル分の eval セット新規作成、および発火精度の実測が次セッションの作業対象。発火精度の実測はコストが大きいため、実行時間の見積もりとリソース消費を確認してから進める予定です。

## セッション 4: 指摘 37 件全適用 + eval セット測定 + 抗体蒸留

# AI

**何をしたか**

- 指摘 37 件の全適用: `setup-gpt` 名称統一（S1）と指摘 #1～#37 を 10 文書に適用
  - S1: `setup` → `setup-gpt` へ名称変更、参照側 4 箇所更新、README にアップデート案内追記
  - 削除 25 件（本文・説明から不要な実装詳細・根拠を消す）
  - 書き換え 8 件（表現改善・用語統一）
  - 退避 4 件（実測・基準導出・ばらつき根拠を `docs/` へ移動）
  - `skill-eval` の警告（分母不足への対処）を `prompt-smith` に追記
  - (tool: Read / Edit × 37+ 回、各スキル・文書に段階的に適用)
- eval セット新規作成: 未測定 3 スキルの trigger/short/fp セット 9 本（計 84 問）を作成
  - `setup-gpt.json` × 3、`claude-model-policy.json` × 3、`with-codex-policy.json` × 3
  - (tool: Write × 9)
- 測定実施: 全 6 スキル × 3 種類の発火精度を測定（runs=2）
  - (tool: Bash — Run trigger evals for existing skills)
  - (tool: Bash — Run trigger evals for new skill sets)
  - (tool: Bash — List failing eval queries)
- 対照実験: policy 2 種が特異的に不発火する根本原因を特定
  - (tool: Bash — Inspect trigger eval sandbox setup)
  - (tool: Bash — Probe with-codex-policy with and without project context)
  - (tool: Bash — Probe claude-model-policy with and without context)
- 本文改稿の影響を切り分け: `prompt-smith` と `skill-eval` の改稿前後で同一クエリを再測
  - (tool: Bash — Re-measure prompt-smith failing queries with more runs)
  - (tool: Bash — Measure pre-edit prompt-smith body on same queries)
  - (tool: Bash — Compare skill-eval trigger before and after body edits)
- eval セットの撤去と規律追加
  - policy 2 種の 6 セットを撤去（測定器で測れない理由を記録）
  - (tool: Write — /plugins/optimize-agents/evals/README.md)
  - (tool: Edit — skill-eval の本文に「§測れないスキルを見分ける」として規律追加）
- 静的検査 × 2 回: 改修後と最終で errors/warnings 確認
- バージョン試運用：一度 0.13.0-dev に上げて 0.12.0-dev に戻した（`-dev` の意味確認）
- Raphael 抗体蒸留: background で起動
  - (tool: Agent — Distill Raphael infections)
  - (tool: Agent — Record conversation turns)

**決定と理由**

- S1 は A 案（`setup-gpt` に統一）を採用。破壊的変更なので README にアップデート案内を明記し、検査で `/optimize-agents:setup-gpt` に正しく解決されることを確認
- 指摘 37 件を全件適用した理由: 削除・書き換え・退避の 3 方向すべてが本文構造の改善に直結（本来の指摘目的に沿っているため）
- policy 2 種の eval セットを撤去した理由：対照実験で明白に、サンドボックス環境では CLAUDE.md と `.claude/agents/gpt-*.md` が存在しないため、これを発火条件にする description の測定ができない。description の改稿では解決不可で、測定器自体の限界であると判定
- 本文改稿の影響を個別測定した理由：README のベースライン(8/8)より落ちた問があるため、それが改稿によるのか分散か切り分ける必要があった。結果は改稿後の方が高く、既存の実測「本文改稿は発火に影響しない」と整合

**却下された選択肢**

- policy 2 種の description を改稿する案は棄却（サンドボックスで測れない根本原因が description ではなく測定環境の再現限界であるため、改稿しても fp は上がらず、逆に実運用の description を弱めてしまう）
- 出力契約の測定は先送り（`output-evals.json` とチェッカーが同梱されていないため、先に作ることが必須だが、その判断はユーザー）

**失敗・やり直し・誤った前提**

- 測定スクリプトで stderr/stdout が混在：`node run-trigger-eval.mjs | python -m json.tool` で実行したときに、Node のモジュール解決エラーが stderr 経由で混ざり Python がパース失敗。原因は前の `cd` が残っていて相対パスが解決できなかったこと。修正：絶対パスで再実行で解決
- バージョン番号の意味を誤解：`0.12.0-dev` を「次のバージョンの開発版」と理解し 0.13.0-dev に上げたが、正しくは「0.12.0 としてリリース前」。リリース後に次の変更を始めるときに上げるのが正しい。即座に戻した
- Raphael 抗体蒸留で `ab-2026-0803-001` に記録された原因が実際と異なる：抗体では「eval-set JSON が破損」と記録されたが、実際はモジュール解決エラーが stderr に混ざったことが根本（前の `cd` 残存）。既存の `ab-2026-0801-001` がカバーする範囲と重複。ユーザー指示で訂正予定

# USER

> 1. 訂正してください
> 2. 作ってください
> 3. setup-gptの実運用でこの言い回しは出ないと思います。
> 4. 外しません

# AI

**何をしたか**

- `ab-2026-0803-001` の訂正：記録された原因を「Node モジュール解決エラーが stderr に混ざったこと」に変更。前の `cd` 残存が根本原因であることを明記、既存の `ab-2026-0801-001` との関連性を記述
  - (tool: Edit — Raphael infection record)
- 出力契約の測定セット を新規作成：全 6 スキル対象の `output-evals.json` とチェッカー実装
  - (tool: Write — /plugins/optimize-agents/evals/output-evals.json)
  - (tool: Write — checking script)
  - (tool: Bash — Test output-eval checker with one skill)
  - 測定は後続で別途実施
- `setup-gpt` の short 5/8 について：ユーザー確認により、落ちた 3 問(「gpt-luna.md を置いといて」等)は実運用では出ない言い回しと判定。description 修正は不要として `evals/README.md` に記録を留置
- `plugin.json` のバージョン：`0.12.0-dev` のまま据え置き（リリースは行わない）

**決定と理由**

- 訂正は immediate に実施（抗体の内容が実際の失敗と食い違うと、次回に誤った対処を促すため）
- 出力契約測定セットを新規作成した理由：ユーザーの指示「作ってください」に従い、プラグインの出力契約テスト環境を整える
- `setup-gpt` short の修正は不実施：実運用に出ない言い回しである以上、description を改稿して fp を上げる価値がないと判定

---

**測定結果（参考記録）**

全 6 スキル、trigger/short/fp × 2 runs:

| スキル | trigger | short | fp | 計 |
| --- | ---: | ---: | ---: | ---: |
| `agent-creator` | 8/8 | 8/8 | 12/12 | **28/28** |
| `prompt-smith` | 6/8 | 5/8 | 8/8 | 19/24 |
| `skill-eval` | 4/8 | 7/8 | 11/12 | 22/28 |
| `setup-gpt` (新規) | 7/8 | 5/8 | 11/12 | 23/28 |
| `with-codex-policy` (新規) | 6/8 | 4/8 | 11/12 | 21/28 |
| `claude-model-policy` (新規) | 6/8 | 4/8 | 10/12 | 20/28 |

policy 2 種（`with-codex-policy` / `claude-model-policy`）は測定結果の解釈に注意が必要：実測では short が 4～4/8 で不発火が多いが、これは description の問題ではなく、測定器のサンドボックスが CLAUDE.md と `.claude/agents/gpt-*.md` を置かないため、これらを発火条件にする description が実行時に展開されないことが原因。対照実験で確認済み（CLAUDE.md + gpt-*.md を置くと 0/2 → 2/2 に反転）。本文改稿の影響は排除済み（改稿前後で同クエリを測定し、改稿後の方が高い）。

**成果物**

- 修正：10 文書（setup-gpt, with-codex-policy, claude-model-policy, agent-creator, prompt-smith, skill-eval, orchestration-discipline, description-guide, context-map-guide, README）
- 新規：evals/README.md、output-evals.json、チェッカー実装
- 抗体訂正：1 件（`ab-2026-0803-001`）
- コミット：未実施（差分 22 ファイル変更 + 新規 5 ファイル）

## セッション 1: optimize-agents プラグインの再検査

# USER

> optimize-agentsでoptimize-agentsを検査してください

## セッション 2
## ASSISTANT

CLAUDE.md の指示に従い、まず運用方針スキルと、検査に使う `prompt-smith` を読みます。

(tool: Skill)

(tool: Skill)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/references/orchestration-discipline.md)

(tool: Bash — List optimize-agents plugin files)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/prompt-smith/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/agent-creator/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup-gpt/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/claude-model-policy/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/with-codex-policy/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/references/agent-definition-spec.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/references/context-map-guide.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/references/description-guide.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup-gpt/assets/gpt-sol.template.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup-gpt/assets/gpt-terra.template.)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup-gpt/assets/gpt-luna.template.m)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/assets/context-map-template.md)

(tool: Bash — Verify referenced validation script exists)

(tool: Bash — Read plugin manifest and file sizes)

`optimize-agents` プラグイン配下の指示書 12 本を読み、`prompt-smith` の基準で評価しました。対象は SKILL.md 5 本・`references/` 4 本・`setup-gpt` の Agent 定義テンプレート 3 本です。`README.md`・`docs/`・`assets/context-map-template.md` は適用範囲外として除きました。

`★ Insight ─────────────────────────────────────`
- 自己適用の検査では「基準が自分自身に当たっているか」が最も出やすい欠陥になります。実際 `prompt-smith` の「根拠は削る」基準の文自身に根拠が付いており、`agent-definition-spec.md` は「引くための記述」の例外に守られない削る基準(根拠・理由)で複数ヒットしました。
- 例外規定(引くための記述)は重複・例・出典の 3 基準だけに効くため、外部仕様の写しでも「〜という理由で」という説明文は削除対象に残ります。この非対称性が評点差を生んでいます。
`─────────────────────────────────────────────────`

## 評点表

| 指示書 | 文の総数 | 冗長度 | 充足度 | スタイル適合 |
| --- | --- | --- | --- | --- |
| `skills/prompt-smith/SKILL.md` | 51 | 4 | 4 | 4 |
| `skills/with-codex-policy/SKILL.md` | 10 | 5 | 3 | 3 |
| `skills/claude-model-policy/SKILL.md` | 3 | \- | \- | \- |
| `skills/agent-creator/SKILL.md` | 9 | \- | \- | \- |
| `skills/setup-gpt/SKILL.md` | 22 | 3 | 5 | 5 |
| `references/orchestration-discipline.md` | 29 | 5 | 5 | 4 |
| `references/agent-definition-spec.md` | 13 | 2 | 5 | 5 |
| `references/context-map-guide.md` | 20 | 3 | 5 | 4 |
| `references/description-guide.md` | 23 | 4 | 4 | 4 |
| `assets/gpt-sol.template.md` | 21 | 3 | 5 | 4 |
| `assets/gpt-terra.template.md` | 24 | 3 | 5 | 4 |
| `assets/gpt-luna.template.md` | 19 | 3 | 4 | 5 |

`claude-model-policy`(3 文)と `agent-creator`(9 文)は **評点なし(母数不足)** です。指摘リストは通常どおり出します。

例外(引くための記述)として除いた範囲:
- `prompt-smith`: §評価 の軸の表・比率表
- `with-codex-policy` / `claude-model-policy`: §モデル別役割 の表と直後の補足
- `agent-creator`: §2 配置を決める の表と直後の補足
- `agent-definition-spec`: §frontmatter のフィールド・§配置による制約・§優先順位・§model の解決順・§検証手段
- `context-map-guide`: §用語・§消費側の読む深さ・§オーケストレーターの3チェックポイント の各表

---

## 指摘リスト

### A. `skills/prompt-smith/SKILL.md`

**A-1** 該当箇所: §削る基準「出典・引用・経緯は削る。**どこから来たか、いつ決まったかは振る舞いを変えない。**」/ 基準: 削る基準(根拠・理由)/ 判定: 削除

**A-2** 該当箇所: §引くための記述の見分け方「**例外がかかるのは重複・例・出典の 3 基準だけである。**書き方の基準・残す基準は引くための記述にも当てる。」/ 基準: 削る基準(重複 — §削る基準 末項と同内容)/ 判定: 書き換え
> 書き方の基準・残す基準は、引くための記述にも当てる。

**A-3** 該当箇所: 冒頭ブロック(適用範囲の 6 文が散文)/ 基準: 書き方の基準(箇条書き)/ 判定: 書き換え
> 対象は次の指示書とする。
> - CLAUDE.md・SKILL.md・コマンド定義(`commands/*.md`)・output style・Agents 定義・メモリの本文
> - `references/` に置かれた文書。人間も読む内容であっても対象とする
>
> 対象は `references/` というディレクトリ名で決まり、どのプラグインの配下かは問わない。
> README・設計書・チュートリアル・`docs/` の文書には適用しない。指示書がこれらを参照していても、対象は参照先へ広がらない。
> description を書くときは `../../references/description-guide.md` に従う。

**A-4** 該当箇所: §書き方の基準 末項「テーブルやコードブロックなどの構造体の補足事項、見出しの概要、１文だけの指示以外は、文脈が破綻する・返って AI が理解しづらいなどの理由で、それが不適切だと判断されない限りは箇条書きで書く。」/ 基準: 書き方の基準(1 文 1 指示)/ 判定: 書き換え
> - 本文は箇条書きで書く。
> - 次のものは箇条書きにしない: 構造体の補足事項・見出しの概要・1 文だけの指示。
> - 箇条書きにすると文脈が破綻する箇所は、散文で書く。

**A-5** 該当箇所: §評価「評点は、その軸の指摘件数を…影響しない。」(7 文の散文ブロック)/ 基準: 書き方の基準(箇条書き)/ 判定: 書き換え
> - 評点は、その軸の指摘件数を文の総数で割った比率から決める。
> - 箇条書きの 1 項目と散文の 1 文をそれぞれ 1 と数える。
> - 表は、ヘッダ行と区切り行を除いた 1 行を 1 と数える。
> - 充足度の欠落は、書かれていない項目の種類ごとに 1 と数える。
> - frontmatter は文の総数に数えず、指摘の対象にもしない。
> - 引くために置かれた記述も文の総数に数えない。
> - 除くのは比率の分母だけで、指摘の通し番号には影響しない。

**A-6** 該当箇所: §評価「複数の指示書を一度に評価するときは、評点表を 1 つに束ね、指摘リストは指示書ごとに区切って通し番号を振る。」/ 基準: 書き方の基準(1 文 1 指示)/ 判定: 書き換え
> - 複数の指示書を一度に評価するときは、評点表を 1 つに束ねる。
> - 指摘リストは指示書ごとに区切り、通し番号を振る。

**A-7** 該当箇所: §評価(全体)/ 基準: 残す基準の裏返し(判断基準の欠落)/ 判定: 書き換え — 「プラグインを検査して」のようにディレクトリ単位で渡されたときに、どのファイルを対象に選ぶかの基準がない。description が発火例として挙げているのに本文に手順がなく、今回の検査でも対象選定を自己判断で行った。§評価 の冒頭へ追加:
> 対象がディレクトリ単位で渡されたときは、配下から対象の指示書だけを列挙し、評価に入る前にその一覧を示す。

### B. `skills/with-codex-policy/SKILL.md`

**B-1** 該当箇所: 「この担当表で「軽量な実装」の帯にあたるのは `GPT Luna` と `Haiku` である。」/ 基準: 残す基準の裏返し(制約の欠落)/ 判定: 書き換え — 表では `Haiku` は「設計書・実装計画書のレビュー」の帯であり、この文と食い違う。実際の用途は `orchestration-discipline` の「軽量な実装の帯以外に Agent Tool を許可する」の解釈にあるので、そう書く。
> `orchestration-discipline` の「軽量な実装」の帯として扱うのは `GPT Luna` と `Haiku` である。この 2 つには Agent Tool を許可しない。

**B-2** 該当箇所: §実行帯が GPT モデルの場合の dispatch 第 1 項/ 基準: 書き方の基準(1 文 1 指示)/ 判定: 書き換え
> - 定義ファイルを持つ Agents は、定義本文(frontmatter を除く)を役割定義として依頼文に同梱し、担当 GPT エージェントへ dispatch する。
> - このとき `model` 上書きは使わない。
> - 依頼文に「この tools のみ使用」と明記する。

**B-3** 該当箇所: §GPT が使えない場合のフォールバック の見出しと第 1 項「`.claude/agents/gpt-*.md` が存在すればそれを使う」/ 基準: 残す基準の裏返し(範囲の誤読)/ 判定: 書き換え — 第 1 項は通常経路であってフォールバックではない。見出しを実態に合わせる。
> 見出しを「## 実行帯の解決順」へ変更し、導入文を「実務タスク着手前に確認し、上から順に適用する。1 で解決したときはフォールバックではない。」とする。

### C. `skills/claude-model-policy/SKILL.md`

**C-1** 該当箇所: 「`model` 未指定・`inherit` の Agents は、dispatch 時の `model` 上書きで実行帯を明示する。」/ 基準: 削る基準(重複 — `orchestration-discipline` §委譲先の実行モデルの確定 に同内容が 2 項ある)/ 判定: 削除

### D. `skills/agent-creator/SKILL.md`

**D-1** 該当箇所: §手順(全体)/ 基準: 残す基準の裏返し(判断基準の欠落)/ 判定: 書き換え — description は「既存定義の点検も担当する」と明言しているが、手順 1〜5 は新規作成の流れだけで、点検時に何を見るかがない。§手順 の末尾へ追加:
> ### 6. 既存定義を点検する
>
> - 手順 3・4・5 の基準を既存の記述に当て、逸脱箇所を挙げる。
> - `tools` に、本文が使わないツールが含まれていないかを照合する。
> - `../../references/agent-definition-spec.md` §配置による制約 に照らし、その配置で使えないフィールドが書かれていないかを確認する。

**D-2** 該当箇所: §5 本文を書く「**本文は system prompt になる。**何をする agent か、どう進めるか、何を返すかを書く。」/ 基準: 削る基準(根拠・理由)/ 判定: 書き換え
> - 何をする agent か、どう進めるか、何を返すかを書く。

**D-3** 該当箇所: §1 用途を聞く「何をする agent かを聞く。1 つの責務に収まらないときは分割を提案する。」/ 基準: 書き方の基準(箇条書き)/ 判定: 書き換え
> - 何をする agent かを聞く。
> - 1 つの責務に収まらないときは分割を提案する。

**D-4** 該当箇所: §4 description を書く(1 項目だけの箇条書き)/ 基準: 書き方の基準(1 文だけの指示は見出し直下に書く)/ 判定: 書き換え
> `../../references/description-guide.md` に従う。

### E. `skills/setup-gpt/SKILL.md`

**E-1** 該当箇所: ステップ 1「ユーザーに次を確認する(**検証コマンドの実行は強制しない。確認方法の提示に留める**)。」/ 基準: 削る基準(重複 — 同内容の言い換え)/ 判定: 書き換え
> ユーザーに次を確認する。検証コマンドは実行させず、確認方法の提示に留める。

**E-2** 該当箇所: ステップ 3「既存ファイルがある場合は、`AskUserQuestion` でユーザーに上書き可否を確認する。」と「**承認なしに上書きしない。**」/ 基準: 削る基準(重複)/ 判定: 削除(後者)

**E-3** 該当箇所: ステップ 4 の見出し「後処理案内(**自動書き込みはしない**)」と「CLAUDE.md への追記文例を**提示のみする**(**自動で書き込まない**):」/ 基準: 削る基準(重複 — 同一指示が 3 箇所)/ 判定: 書き換え — 見出しを「## ステップ 4: 後処理案内」、項目を「CLAUDE.md への追記文例を提示する。自動では書き込まない。」とする。

### F. `references/orchestration-discipline.md`

**F-1** 該当箇所: §モデル別役割の運用 第 2 項「実装の帯は次で分ける。複数コンポーネントに…」(1 項目に 4 文)/ 基準: 書き方の基準(1 文 1 指示)/ 判定: 書き換え
> - 複数コンポーネントにまたがる実装、または非自明な設計判断を含む実装は「複雑または重要な実装」とする。
> - 単一コンポーネントに閉じ、設計判断を伴わない実装は「通常の実装」とする。
> - 既存パターンの機械的な反復・一括適用は「軽量な実装」とする。

**F-2** 該当箇所: §委譲先の実行モデルの確定 第 1 項「セッションで初めて委譲する Agents は、定義ファイルの frontmatter `model` を確認する。原本を読み、複製・改変版は作らない。」/ 基準: 書き方の基準(1 文 1 指示)/ 判定: 書き換え
> - セッションで初めて委譲する Agents は、定義ファイルの frontmatter `model` を確認する。
> - 確認は原本に対して行い、複製・改変版は作らない。

### G. `references/agent-definition-spec.md`

**G-1** 該当箇所: 冒頭「2026-08-02 時点の Anthropic 公式ドキュメントに基づく。」+「出典: https://...」/ 基準: 削る基準(出典 — ただし版の日付は陳腐化判断の入力として残す)/ 判定: 書き換え
> 出典: https://code.claude.com/docs/en/sub-agents / https://code.claude.com/docs/en/plugins-reference (2026-08-02 時点)

**G-2** 該当箇所: 冒頭「**仕様は変わる。**この文書と実際の挙動が食い違うときは公式ドキュメントを正とする。」/ 基準: 削る基準(根拠・理由)/ 判定: 削除(前半のみ)

**G-3** 該当箇所: §配置による制約「プラグインが提供する agents は 3 つのフィールドを使えない。**公式がセキュリティ上の理由として明記している。**」/ 基準: 削る基準(根拠・理由)/ 判定: 削除(後半のみ)

**G-4** 該当箇所: §公式ドキュメントに記述がない事項「次は公式に記述がない。**慣習や独自様式であり、**公式推奨として扱わない。」/ 基準: 削る基準(根拠・理由)/ 判定: 書き換え
> 次の 4 つは公式に記述がなく、公式推奨として扱わない。

**G-5** 該当箇所: §公式が示す設計原則 の英語引用 2 行/ 基準: 削る基準(引用)+ 書き方の基準(言い切り)/ 判定: 書き換え
> - subagent は 1 つのタスクに専念する形で設計する。
> - tools は必要なものだけを許可する。
> - 非 fork の subagent は会話履歴・ロード済みスキル・既読ファイルを引き継がない。

**G-6** 該当箇所: §検証手段「| `optimize-agents` の `scripts/check-agent-definition.mjs` | プラグイン配下と project 配下の双方 |」/ 基準: 削る基準(実体のない記述)/ 判定: 削除 — このスクリプトは `239f2a3` で削除済みで、`plugins/optimize-agents/` に `scripts/` ディレクトリは存在しない。参照が壊れています。

### H. `references/context-map-guide.md`

**H-1** 該当箇所: §context-map とは「map の所在(パス)の通知は必須。」/ 基準: 削る基準(重複 — §用語 の「所在通知」定義および `orchestration-discipline` §コードベース探索 末項)/ 判定: 削除

**H-2** 該当箇所: §context-map とは「読む深さは役割・チェックポイントに応じる。」/ 基準: 削る基準(重複 — §消費側の読む深さ の表)/ 判定: 削除

**H-3** 該当箇所: §オーケストレーターの3チェックポイント ②「(設計書/WBS 完成時。**計画確定規則の Approve** と同一の瞬間)」/ 基準: 削る基準(実体のない参照)/ 判定: 書き換え — 「計画確定規則」という節はどこにもなく、実体は `orchestration-discipline` §設計・実装計画の規律 です。
> (設計書/WBS 完成時。`orchestration-discipline` §設計・実装計画の規律 の Approve と同一の瞬間)

**H-4** 該当箇所: §context-map とは(散文 5 文)/ 基準: 書き方の基準(箇条書き)/ 判定: 書き換え — H-1・H-2 を削った残りを整形。
> セッションの探索成果物。現在の構造・関連モジュール・既存パターン・影響範囲・既存契約・未解決事項・テスト方法を、オーケストレーターが生探索を避けられる小さな状態へ圧縮したもの。
> map を小さく(蒸留された状態に)保つことが最優先の規律である。

**H-5** 該当箇所: §シークレット非記録「…context-map が上書きしない**こと**。」/ 基準: 書き方の基準(命令形を使わない)/ 判定: 書き換え
> リポジトリ固有ポリシー(例: 特定ディレクトリを読まない等)を context-map が上書きしない。

### I. `references/description-guide.md`

**I-1** 該当箇所: §書く内容 第 1 項「まず何をするスキルかと、どんなときに使うかを**簡潔に**書く。」/ 基準: 削る基準(判断基準のない修飾)/ 判定: 書き換え — §長さの上限 に 1536 字の基準があるため、修飾ごと削る。
> まず何をするスキルかと、どんなときに使うかを書く。

**I-2** 該当箇所: §書く内容(全体)/ 基準: 残す基準の裏返し(範囲の欠落)/ 判定: 書き換え — 導入文が対象を「SKILL.md・コマンド定義・Agents 定義」に限定しているが、`prompt-smith` の対象には output style とメモリも含まれる。どちらが正かが読み取れない。導入文へ追加:
> output style・メモリの frontmatter にある description もこの基準に従う。

**I-3** 該当箇所: ###スキルの発火率を上げるための施策 第 1 項「この施策は Agents 定義には適用せず、代わりに使用する場面を具体的に書き、「積極的に使用する」と書く。」/ 基準: 書き方の基準(1 文 1 指示)/ 判定: 書き換え
> - この施策は Agents 定義には適用しない。
> - Agents 定義では、使用する場面を具体的に書き、「積極的に使用する」と書く。

**I-4** 該当箇所: ###スキルの発火率を上げるための施策 第 3 項「「〜に役立つ」…にしない。「〜しといて」のような口語・省略形も含める。」/ 基準: 書き方の基準(1 文 1 指示)/ 判定: 書き換え
> - 「〜に役立つ」「〜のときに参照できる」のような控えめな表現にせず、「必ず使用する」と言い切る。
> - 「〜しといて」のような口語・省略形も例示に含める。

### J. `skills/setup-gpt/assets/gpt-sol.template.md`

**J-1** 該当箇所: §アドバイザーへの相談 第 1 項「**あなたはサブエージェントである。**」/ 基準: 削る基準(重複 — 冒頭「メインオーケストレーターから起動されたサブエージェントであり」)/ 判定: 削除

**J-2** 該当箇所: §Core Responsibilities 第 2 項「自らの成果を diff・テスト結果などの証拠で検証し、整合性に責任を持つ。」/ 基準: 削る基準(重複 — §進め方 第 3 項)/ 判定: 削除

**J-3** 該当箇所: §アドバイザーへの相談 第 3 項「助言以外の目的(作業の委譲など)で Agent ツールを使用しない。」/ 基準: 削る基準(重複 — §制約 第 1 項)/ 判定: 削除(後半のみ、「迷っていないときはアドバイザーを呼ばない。」は残す)

**J-4** 該当箇所: §アドバイザーへの相談 第 1 項(1 項目に 3 指示)/ 基準: 書き方の基準(1 文 1 指示)/ 判定: 書き換え
> - 判断に迷ったときだけ、Agent ツールでアドバイザーを呼び出す。
> - 相談相手は `Fable` サブエージェントとし、Fable を起動できないときは `Opus` サブエージェントにする。

**J-5** 該当箇所: §制約 第 2 項(1 項目に 3 文)/ 基準: 書き方の基準(1 文 1 指示)/ 判定: 書き換え
> - ブリーフで明示的に指定されたスキル以外を Skill ツールでロードしない。
> - スキル側のトリガー定義はブリーフの明示指定に劣後する。
> - ロードが必要だと気づいたときもロードせず、その旨を報告して差し戻す。

### K. `skills/setup-gpt/assets/gpt-terra.template.md`

**K-1** 該当箇所: 冒頭「通常のコーディング(複雑でない実装)と、レビュー・設計を除くその他の作業を確実に遂行する。」/ 基準: 削る基準(重複 — §When to invoke)/ 判定: 削除

**K-2** 該当箇所: §Core Responsibilities 第 2 項「実行したコマンドとその結果を、成功・失敗を問わず正確に報告する。」/ 基準: 削る基準(重複 — §Output Format 第 2 項)/ 判定: 削除

**K-3** 該当箇所: §作業手順 第 4 項「判断に迷う点は勝手に決めず、まずアドバイザーに相談し、それでも決められない事項は選択肢と推奨を添えて報告する。」/ 基準: 削る基準(重複 — §アドバイザーへの相談)/ 判定: 書き換え
> 4. 判断に迷い、アドバイザーに相談しても決められない事項は、選択肢と推奨を添えて報告する。

**K-4** 該当箇所: §アドバイザーへの相談 第 1 項「**あなたはサブエージェントである。**」/ 基準: 削る基準(重複)/ 判定: 削除

**K-5** 該当箇所: §アドバイザーへの相談 第 1 項・§制約 第 2 項/ 基準: 書き方の基準(1 文 1 指示)/ 判定: 書き換え — J-4・J-5 と同一の置き換えを適用する。

### L. `skills/setup-gpt/assets/gpt-luna.template.md`

**L-1** 該当箇所: 冒頭「軽量なタスクを速く、正確にこなすことに特化したワーカーであり…多数対象への一括処理に加え、軽微なコーディングと探索実働を担う。」/ 基準: 削る基準(重複 — §When to invoke)/ 判定: 書き換え
> あなたは GPT Luna。メインオーケストレーターから起動されたサブエージェントである。

**L-2** 該当箇所: §Core Responsibilities 第 2 項「対象件数・処理済み件数・スキップ件数を数えて報告する。」/ 基準: 削る基準(重複 — §Output Format 第 1 項)/ 判定: 削除

**L-3** 該当箇所: §Core Responsibilities 第 3 項「パターンに合致しない例外を見つけたら、勝手に判断せず例外として報告する。」/ 基準: 削る基準(重複 — §Output Format 第 3 項)/ 判定: 書き換え
> 3. パターンに合致しない対象は、勝手に判断せず処理を止める。

**L-4** 該当箇所: §作業手順/ 基準: 残す基準の裏返し(制約の欠落)/ 判定: 書き換え — luna も §When to invoke で探索実働を担うのに、sol/terra にある context-map の扱いがない。§作業手順 へ追加:
> 4. オーケストレーターから context-map の断片を渡されたときは、それを出発点として用い、記載と実際のコードに食い違いがあれば報告する。

---

## 適用範囲外だが検査中に見つかった不整合

`prompt-smith` の対象外(frontmatter・実装物)ですが、放置すると壊れるため報告します。

1. **`skill-eval` スキルが存在しない。** `prompt-smith` の description は「SKILL.md の description は skill-eval が担当する」と委譲していますが、`skill-eval` は `239f2a3` で削除済みです。現状、SKILL.md の description を担当するスキルが不在になっています。`agent-creator` へ寄せるか、`description-guide.md` を直接参照させるかの判断が要ります。
2. **`check-agent-definition.mjs` が存在しない。** G-6 と同じ件です。`agent-definition-spec.md` §検証手段 が消えたスクリプトを案内しています。
3. **`agent-creator` の description に脱字。** 「setup-gptが担当する」→「setup-gpt が担当する」。

---

適用してよいものを指定してください。「全件」または番号指定(例: `G-6, H-3, A-1〜A-3`)の双方を受け付けます。範囲外の 3 件をどう扱うか(1 の担当再定義など)も、あわせて指示をいただければ同じ改稿に含めます。

(tool: Agent — Record conversation turns)

検査結果は前のターンで出し終えています。適用する項目の指定をお待ちしています。

- 全件適用する場合は「全件」とお伝えください。
- 一部だけの場合は番号(例: `G-6, H-3, A-1〜A-3`)でご指定ください。
- 適用範囲外として挙げた 3 件(`skill-eval` の担当再定義、`check-agent-definition.mjs` の参照切れ、`agent-creator` の description の脱字)も、扱いを指示いただければ同じ改稿に含めます。

バックグラウンドの記録処理が完了した通知が届いただけで、検査結果への回答はまだいただいていません。

適用する項目のご指定をお待ちしています。

- 全件適用: 「全件」
- 一部のみ: 番号指定(例: `G-6, H-3, A-1〜A-3`)
- 適用範囲外の 3 件(`skill-eval` の担当再定義、`check-agent-definition.mjs` の参照切れ、`agent-creator` の description の脱字)の扱いも、指示があれば同じ改稿に含めます。

---

## USER

> 全件てきようしてください。
>
> 適用範囲外について
> 1. description-guide.mdを直接参照させる
> 2. 削除してください
> 3. 対応してください