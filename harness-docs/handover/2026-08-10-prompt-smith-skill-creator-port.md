# prompt-smith:skill-creator 移植 引き継ぎ書

- 作成日: 2026-08-10
- ブランチ: `feat/prompt-smith-skill-creator-port`
- 設計書: `docs/design/2026-08-09-prompt-smith-skill-creator-port-design.md`
- 実装計画: `docs/plans/2026-08-09-prompt-smith-skill-creator-port-implementation.md`
- 台帳: `.superpowers/sdd/2026-08-09-prompt-smith-skill-creator-port-implementation/progress.md`

## 1. 何をしている作業か

Anthropic 公式プラグイン `skill-creator` の description 改善ループを TypeScript へ移植し、`prompt-smith` プラグインの独立スキル `skill-creator` として持つ。公式プラグインへの依存を無くす。

## 2. 現在地

**14 タスクすべて完了している**(2026-08-10)。全タスクにレビューを通し、指摘は解消済みか台帳に記録済みである。

| Task | 状態 | コミット |
| --- | --- | --- |
| 1. ライセンス表示とパッケージ基盤 | 完了 | `87d862b` |
| 2. parse-skill-md | 完了 | `aca1097` |
| 3. 発火判定の状態機械 | 完了 | `0ca02c8` |
| 4. サンドボックスの構築 | 完了(修正 1 回) | `eccd3ed` |
| 5. 発火測定 CLI とビルド | 完了(修正 1 回) | `32a6571` |
| 6. 層化分割 | 完了 | `23f1f03` |
| 7. description の改善 | 完了 | `57853b5` |
| 8. 反復ループ | 完了(修正 1 回) | `3b21194` |
| 9. HTML レポートと配線 | 完了(修正 1 回) | `a1f828e` |
| 10. eval レビュー UI | 完了 | `4f7f6a6` |
| 11. skill-creator スキル本文 | 完了 | `1d7ff71` |
| 12. 経路の付け替え | 完了 | `4ead088` |
| 13. eval セットと自己適用 | 完了 | `fbba09d`, `6ad8d41` |
| 14. 文書と抗体の更新 | 完了 | `daf9e8e` |
| 番外: 改善ループの全損対策 | 完了 | `37e2bd4` |

検証の状態: `pnpm test` がリポジトリ全体で 1119 件 PASS(`plugins/prompt-smith` は 96 件)。`pnpm build` / `pnpm typecheck` / `pnpm lint` すべて成功。バンドル出力に未コミットの差分なし。

## 3. 測定の結果

3 本の改善ループを回した結果である(2026-08-10、`--max-iterations 5`、`--holdout 0.4`、`--runs-per-query 3`)。

| スキル | 現行(反復 1) | best | 適用 |
| --- | --- | --- | --- |
| `skill-creator` | train 9/12・test 7/8 | 反復 1(現行) | しない。4 案とも現行を超えず |
| `agent-creator` | train 9/12・test 5/8 | 反復 4 train 12/12・test 7/8 | **した**(`6ad8d41`) |
| `prompt-smith` | train 5/12・test 4/8 | 反復 2 train 6/12・test 5/8 | しない。差が holdout 8 問中 1 問でばらつきの範囲、かつ英語になる |

読み取れたことが 2 つある。

**3 スキルとも偽陽性がゼロで、失敗はすべて `expected=true` の取りこぼしである。** description が過剰に発火する問題は無い。改善の余地は除外規則を足す側ではなく、対象の言い方を増やす側にある。

**`prompt-smith` は 5 反復とも test 4〜5/8 で頭打ちだった。** 落ちるのは「`commands/escalate.md` の本文を整えて」「`memories/intake-notes.md` を棚卸ししたい」のような、ファイルを指して直接 Edit すれば済む依頼である。サンドボックスには他のスキルが 1 つも居ないので競合負けではない。description の文言ではなく、この種の依頼で Skill ツールを経由させること自体の難しさに見える。**description の調整だけでは動かない可能性が高い。**

`skill-creator` は反復 3・4 で train が 10/12 に上がったが test は 7/8 のままで、holdout が過学習を棄却した。分割が効いた実例である。

## 4. これを知らないと同じ失敗をする

### 4.1 移植の理由は「登録先」ではない

**設計の初版は診断を誤っていた。** 当初は「公式の `run_eval.py` は測定対象を `.claude/commands/` へ登録するので自然文の依頼から発火しない」としていたが、2026-08-09 の対照実験でこれは否定された。

条件を揃えた一時ディレクトリで `.claude/skills/` と `.claude/commands/` の両方に同じ SKILL.md を置いて測った結果、**両経路とも 10/24 で差が出なかった**。公式ドキュメントも `commands/deploy.md` と `skills/deploy/SKILL.md` について "Both can be auto-invoked by Claude" と明記している。

移植が必要な理由は別の 2 点である。

1. `find_project_root()` が**実リポジトリのルートを cwd にする**。このリポジトリで走らせると 45 のプロジェクトスキルが同席し、スコアは description の質ではなく手元のカタログとの競争結果になる
2. 本文を捨てた **description だけの薄いファイル**を測定対象にする。本番の SKILL.md とは別物を測っている

抗体 `ab-2026-0802-001` が記録する 2026-08-01 の実測(登録先を変えると 1/8 → 8/8)は、**登録先と cwd の 2 変数が同時に変わった交絡した比較**である。旧測定器は一時ディレクトリを cwd にしていた(`git show 239f2a3^:plugins/optimize-agents/scripts/run-trigger-eval.mjs` の 93 行と 117 行)。効いていたのは cwd の方だったと読むのが自然である。

### 4.2 抗体 `ab-2026-0802-001` は書き換え済み(2026-08-10)

この抗体は 2026-08-10 まで、毎セッション「`run_eval.py` は登録先が `.claude/commands/` なので発火を検出できない」と注入していた。**この主張は上記のとおり否定されている。**

`daf9e8e` で本文を実測に合わせて差し替えた。現在は cwd 汚染と薄い測定対象の 2 点を理由として書いている。**古い主張を見かけても復活させないこと。**

本文を直すときは手で `.raphael/antibodies/*.md` を編集せず、`node plugins/raphael/scripts/update-antibody.mjs patch ab-2026-0802-001` を使う。`--dry-run` で差分キーを確認できる。

### 4.3 バンドル CLI の自己起動は出力ファイル名に依存する

`run-loop.ts` は `improve-description.js` と `run-trigger-eval.js` を静的に import する。esbuild が 1 ファイルにまとめると `import.meta.url` が 3 つとも同じになるため、自己起動のガードが同時に真になる。**正しい引数で成功しても終了コードが 1 になる**という実害が出た。

現在は `isDirectRun(expected)` がエントリファイル名で判定している。**`build.ts` の entry 名を変えるときは、対応する `isDirectRun("...")` も同時に変える。** `src/__test__/bundle-cli-smoke.test.ts` がこれを守っている。

### 4.4 GPT 系のサブエージェントは Markdown の報告書を作れない

`gpt-sol` / `gpt-terra` は定義上、報告用の Markdown ファイルを作成できない。SDD の実装報告はレビュアーが読む契約なので、**依頼文で「報告書の中身を最終メッセージにそのまま書いて返す」よう指示し、オーケストレーターがファイルへ転記する**。台帳の隣にある `task-N-report.md` のうち、転記であるものは冒頭にその旨を書いてある。

### 4.5 `.superpowers/` は git 管理外

台帳 `progress.md` だけを `git add -f` で例外的に追跡に入れてある。ブリーフ・実装報告・review の diff は追跡していない。別マシンで作業を再開する場合、それらは手元に無い。

## 5. 決定済みの事項

| 事項 | 決定 | 日付 |
| --- | --- | --- |
| 実行系 | 公式プラグインへの依存を無くし、改善ループを全面移植する | 2026-08-09 |
| 移植の言語 | TypeScript | 2026-08-09 |
| eval セット | skill-creator が生成するものと完全に同一の形式 | 2026-08-09 |
| 出力の評価 | 測定器は作らないが、手作業の手順として本文に書く | 2026-08-09 |
| packaging | 対象外。`package_skill.py` は移植しない | 2026-08-09 |
| `description-guide.md` の扱い | 共通の基準だけを持つ。skill 固有は `skill-creator` の本文、Agents 固有は `agent-creator` の本文へ移す | 2026-08-10 |
| 前提の訂正 | 移植は続け、登録先ではなく cwd 汚染と薄いファイルを理由として書き直す | 2026-08-10 |
| 抗体 | 本文を実測に合わせて書き換える | 2026-08-10 |
| eval セット | 起草した 3 本をそのまま承認 | 2026-08-10 |
| 「explain the why」 | **放置する。** 公式 `skill-creator` の Writing Style と `prompt-smith` の「根拠は削り指示だけ残す」は方向が逆で、後者を優先する | 2026-08-10 |
| タグ無し応答のフォールバック | ~~移植元どおりのままとする~~ → **同日中に反転。** タグを必須にし、無ければ 1 回再依頼、2 回目も無ければエラーにする。据え置きの決定は「異常は一過性」という前提の上に立っていたが、その前提が §6 のとおり崩れた | 2026-08-10 |
| improve 失敗時の扱い | 例外の種類を問わずループを打ち切り、best-so-far を返す。タイムアウトを `--improve-timeout` / `--timeout` で変えられるようにする | 2026-08-10 |
| 測定の実行方法 | 改善ループ中はメインセッションを止める。応答生成と `claude -p` が同時に走ると落ちる | 2026-08-10 |
| 測定結果の適用 | `agent-creator` のみ差し替え。`skill-creator` は現行が best、`prompt-smith` は差がばらつきの範囲で据え置き | 2026-08-10 |

## 6. `claude -p` はメインセッションと同時に走らせられない

Task 9 で観測した異常(`improve-description` の `claude -p` が eval と無関係なテキストを返し、タグが無いため全文が description になる)は、**2026-08-10 に再現した。一過性ではない。**

同日の改善ループ 1 回目では、3 本とも `claude -p` が 300 秒でタイムアウトして異常終了し、6〜11 分の測定が全損した。成否はメインセッションが応答を生成中かどうかと一致している。

| improve 呼び出し | 結果 | そのときのメインセッション |
| --- | --- | --- |
| agent-creator 反復 1 | 127.7s 成功 | idle(ユーザー回答待ち) |
| agent-creator 反復 2 | 132.9s 成功 | idle |
| skill-creator 反復 1 | 252.6s だが汚染応答 | 応答生成中 |
| skill-creator 反復 2 | 300s タイムアウト | 応答生成中 |
| prompt-smith 反復 1 | 300s タイムアウト | 応答生成中 |
| agent-creator 反復 3 | 300s タイムアウト | 応答生成中 |

反復番号の若いものも落ちているので、プロンプトが膨らんだせいではない。ローカルプロキシが同時実行の Claude リクエストを直列化するか取り違えていると読むのが自然である。正常時でも 130 秒前後かかるので、上限までの余裕はもともと薄い。

**回すときはメインセッションを止める。** 2 回目は `--improve-timeout 600` と開始前 300 秒の待ちを置き、起動後は完走通知まで応答を生成しないことで 3 本とも完走した。

対策としてコード側も変えた(§5 の 2 行)。タグ無し応答は採用せず、improve の失敗はループを打ち切って best-so-far を残す。**修正前は 1 回のタイムアウトで測定が丸ごと消えていた。**

## 7. 作業の再開手順

```
git checkout feat/prompt-smith-skill-creator-port
cat .superpowers/sdd/2026-08-09-prompt-smith-skill-creator-port-implementation/progress.md
```

台帳の末尾が現在地である。`Task N: complete` の行があるタスクは完了している。

14 タスクはすべて完了しているので、残るのは最終レビューの指摘への対応と、マージ可否の判断である。
