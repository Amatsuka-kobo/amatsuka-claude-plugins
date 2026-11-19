# codiel の ADR 候補を消し、失敗の記録を持続層の通常の記述にする

- 対象: Issue #45(親 Story #44)
- 変更するプラグイン: codiel 1.1.2 → 1.1.3
- この PR は metatron のソースを変えない

## metatron の台帳が無くなるので、候補という形をやめる

codiel は、ADR にする判断と run で起きた失敗を「候補」として書き、metatron が ADR と GOTCHAS の台帳へ移す分担だった(ADR-007・ADR-013)。Story #44 で metatron の両機能を廃止するため、移す先が無くなる。

この PR で次の 3 つを行う。

- ADR 候補を消す。判定・採番・手元の記録・持続層への写しをすべてやめる。
- GOTCHAS 候補を「失敗の記録」に変える。持続層の領域ファイル(`docs/intents/domains/<領域>.md`)の通常のセクションにし、有効・無効の切り替えを無くす。
- carry-over と fix-loop の修正判断を、intent 文書の `## 合意済み事項` に残す。

範囲外は次のとおりである。

- 領域ファイルの古い記述を改訂する手順は #47 で扱う。
- `metatron.config.json` の `paths.gotchas` の削除は #46 へ移す。理由は「paths.gotchas は #46 で両プラグイン同時に消す」のセクションに書く。
- `harness-docs/ARCHITECTURE.md` の ADR は更新しない。ADR 一覧は #48 で `docs/old/metatron/` へ移す。

## 決定事項

| 項目 | 決定 | 決めた人 |
| --- | --- | --- |
| 領域ファイルのセクション名 | `## 失敗の記録`。見出しの印は付けない | 利用者 |
| 領域ファイルのキー | 英語に統一する。本文とセクション名は日本語のままにする | 利用者 |
| intent の `## 意図的な制約` の表の行 | ADR の 3 条件による除外をやめ、すべての行を領域ファイルへ取り込む | 利用者 |
| `## 合意済み事項` と `design.md` の採用案 | 領域ファイルへ取り込まない。intent 文書と run の `design.md` に残る | 利用者 |
| carry-over と fix-loop の修正判断 | intent 文書の `## 合意済み事項` に残す | 利用者 |
| 改修前の形で書かれた記録 | 移行しない。読まず、直さない | 利用者 |
| 写す領域が決まらない失敗の記録 | 今と同じく手元の記録に残し、結果レポートに一覧する | 利用者 |
| 手元の記録と手順ファイルの名前 | `failure-records.md` | 設計者 |
| `guard-write.runs.test.ts` の R-13 | この PR では変えない | 設計者 |

## 今の仕組みを保ち、分岐と名前だけを変える

失敗の記録について 3 つの方式を比べ、案 1 を採る。

| 軸 | 案 1: 仕組みを保つ | 案 2: 発生時に領域ファイルへ直接書く | 案 3: 記録をやめる |
| --- | --- | --- | --- |
| 内容 | 手元の記録に書き、intent-sync と finalize で領域ファイルへ写す流れを保つ。`candidates` と `knowledgeTarget` による分岐を消す | 手元の記録をやめ、失敗が起きた時点で領域ファイルに書く | STOP の裁定と incident は Raguel の記録に任せ、codiel は書かない |
| 持続層への書き込みの保護 | 変えない | guard-write は intent-sync と finalize の作業中だけ領域ファイルへの書き込みを通す。全フェーズで通す変更が要る | 変えない |
| STOP で止めた run の記録 | 手元に残り、次の try の intent-sync が写す | 止めた時点ではコミットされず、作業ツリーに残る | Raguel の記録だけに残る |
| review の設計漏れの記録 | 残る | 残る | どこにも残らない |
| 変更量 | 指示層の分岐の削除と改名 | hook の変更と、写しの追跡の作り直し | 最も少ない |

案 2 は、持続層を intent-sync の外で書かせない保護を外すことになる。案 3 は、失敗の記録を持続層に残すという決定に反する。

## 領域ファイルの書式

`references/intent-format.md` の領域ファイルの書式を次のとおり変える。値は例であり、実際の内容に置き換える。

```markdown
# <領域名>

## 目的
## 意図的な制約
### <制約の見出し>
- constraint: <...>
- reason: <...>
- sourceIntent: docs/intents/YYYY-MM-DD-<slug>.md
## 非ゴール
## 失敗の記録
### <失敗のタイトル>
- date: YYYY-MM-DD
- run: <slug> try-<n>
- task: <何をしようとしていたか>
- mistake: <具体的に何を間違えたか>
- cause: <なぜそうなったか(推測)>
- countermeasure: <次に同じ作業をするときに取る行動>
## 由来
## 出典
```

変える点は次のとおりである。

- セクション名を `## GOTCHAS 候補` から `## 失敗の記録` にする。位置は変えない。失敗を初めて書くときに作る決まりも変えない。
- 失敗の記録の見出しから印 `[GOTCHAS 候補]` を外す。
- 失敗の記録のキーは今の英語の名前を保ち、`promotionCandidate` だけを消す。台帳から規約へ昇格させる候補を示す値で、使う仕組みが無くなる。
- 制約のキーを `制約`・`理由`・`出典 intent` から `constraint`・`reason`・`sourceIntent` にする。
- 制約のエントリから `関連 ADR` の行を消す。
- `sourceIntent` が複数あるときに 1 行 1 パスで繰り返す決まりは変えない。
- `## 由来` の行の形は変えない。

intent 文書の表(`## 意図的な制約` の「制約 | 理由」、`## 合意済み事項` の「論点 | 決定 | 理由」)は変えない。取り込みの手順では、表の「制約」列を `constraint`、「理由」列を `reason` に対応させる。

手元の記録のエントリも領域ファイルと同じキーで書く。手元の記録だけが持つ `由来` と `写し先` の行は、今の名前のまま保つ。

## 失敗の記録を書く時点は変えず、有効・無効の切り替えを無くす

失敗を書く条件と時点は変えない。

| 条件 | 書く時点 |
| --- | --- |
| 人が Raguel の STOP を妥当と裁定した | `stop --reason raguel-stop` の直後。carry-over で「修正して再提出」を選んだときは、その選択の直後 |
| `record_outcome(incident)` を記録した | 記録の直後 |
| review で、設計時に想定していなかった仕様漏れ・考慮漏れが見つかった | fix-loop の pass-gate の後 |

流れは今と同じ 2 段階である。発生した時点で try の手元の記録に書き、intent-sync と finalize で領域ファイルへ写してコミットする。次の規則は今のまま保つ。

- 写したかどうかを、手元の記録の `写し先` の行とコミットの到達で判定する。
- 人が選んだ `写さない(<理由>)` の印を保つ。
- 重複は、見出しと `mistake` が同じかで判定する。
- 写す領域は、intent-sync では取り込み先から、finalize ではこの try の intent-sync が取り込んだ領域から選ぶ。incident の記録は、既存の領域ファイルから `task` と `mistake` で選ぶ。
- 写す領域が決まらない記録は、手元に残して結果レポートに一覧する。

変える点は次のとおりである。

- `state.candidates.gotchas` による有効・無効の判定を消し、常に書く。
- `knowledgeTarget` が `metatron` のときに写さない分岐を消す。incident の記録を他の slug から集める走査も、すべての run で行う。
- 手元の記録のファイル名を `reports/gotcha-candidates.md` から `reports/failure-records.md` にし、先頭行を `# 失敗の記録(<slug> try-<n>)` にする。
- 手順ファイルの名前を `skills/orchestrating-runs/references/gotcha-candidates.md` から `failure-records.md` にする。
- metatron が候補を消す・台帳へ移すことを前提にした文を消す。
- 一覧の未写しの理由を、「取り込みを行わなかった」「領域を選べなかった」「人が写さないと決めた」の 3 つにする。
- 改修前の `写し先: 写さない(incident)` の行を読み替える規則を消す。

この変更で、利用者に見える動作が 1 つ変わる。`phase-intent-sync.md` は、未写しの記録があれば制約に行があるのと同じ扱いにし、intent が領域を持たないときは領域名を人に聞く。これまで `knowledgeTarget` が `metatron` の run はこの分岐を通らなかったが、改修後はすべての run が通る。

## 改修前の形で書かれた記録は読まない

移行の手順を持たない。旧い形の記録があるのは、環境変数で記録を有効にしていたプロジェクトだけである。

- 手元の `reports/gotcha-candidates.md` と `reports/adr-candidates.md` は読まない。写しの対象にも、一覧の対象にもしない。
- 領域ファイルの `## GOTCHAS 候補` は読まず、書き換えない。重複の判定は `## 失敗の記録` だけを見る。
- 領域ファイルに `[ADR 候補: <ID>]` の印が付いたエントリ、参照形のエントリ、日本語のキーのエントリが残っていても、通常の制約として読む。
  - 同じ内容の制約を別の intent が持ち込んだときは、今の規則どおり出典の行を加える。加える行は `sourceIntent` で書く。
  - 制約を変える intent が来たときは、今の規則どおり上書きせずに人へ確かめる。
  - それ以外の書き換えは #47 の改訂の手順に任せる。
- README に、旧い形の記録を残したいときは人が手で `## 失敗の記録` へ移す、と書く。

改修前に始めた run を改修後に続けると、手元の未写しの候補は人に示されなくなる。README の同じ箇所に書く。

## 制約の表の行をすべて取り込み、修正判断は intent 文書に残す

`skills/syncing-intents/references/persistent-layer.md` の取り込み手順を次のとおり変える。

| 対象 | 今の動作 | 変更後 |
| --- | --- | --- |
| intent の `## 意図的な制約` の表の行のうち、ADR の 3 条件を満たすもの | 取り込まず、ADR 候補として扱う。候補が無効の run ではどこにも書かない | 他の行と同じく、通常の制約として領域ファイルに取り込む |
| intent の `## 合意済み事項` と `design.md` の採用案 | 3 条件を満たすものを ADR 候補として判定する(手順 8) | 判定しない。領域ファイルへ取り込まない |
| carry-over の修正判断 | 同上 | intent 文書の `## 合意済み事項` に書く |
| 参照形のエントリを書き戻さない規則(手順 4 の 3 つ目) | 確定済みとして扱う | 手順から消す |

修正判断を残す置き場は 4 つを比べ、intent 文書を採る。

| 置き場 | 書ける時点 | 評価 |
| --- | --- | --- |
| intent 文書の `## 合意済み事項` | intent-sync と finalize。guard-write が intent 文書への書き込みを通す | 採る。「論点 | 決定 | 理由」の表が判断を書く形に合う |
| 領域ファイルの失敗の記録の `countermeasure` | intent-sync と finalize | 失敗をきっかけにしない修正判断を書けない。領域が決まらない run では git に入らない |
| 設計資料 `docs/intents/design/` | intent-sync だけ。fix-loop はその後に走る | 書式が変更の経緯を書かないと決めている |
| run の `design.md` | 未確認 | 判断の理由を書く見出しが無い |

手順は次のとおりにする。ADR の 3 条件のような選別は行わず、該当する修正をすべて書く。

- carry-over で「修正して再提出」を選んだ try では、intent-sync の書き戻しの中で、修正方針 1 つにつき 1 行を intent の `## 合意済み事項` に加える。材料は、`startHead` からの `codiel(carry-over):` のコミットと carry-over の所見である。今の手順 8 が ADR 候補の判定に使っていた材料と同じである。
- fix-loop で設計を変える修正を採ったときは、pass-gate の後に、論点・決定・理由を手元の `reports/fix-decisions.md` へ 1 件ずつ書く。fix-loop の間は guard-write が intent 文書への書き込みを通さないので、手元に置く。
- finalize は、同じ slug のすべての try の `reports/fix-decisions.md` を読み、intent の `## 合意済み事項` に無い論点を 1 行ずつ加える。intent を更新する今の手順(手順 2・3)の変更と同じコミットに入れる。
- どちらも、加えた行を intent の `## 変更履歴` に 1 行で記録する。
- `reports/fix-decisions.md` は `.codiel/runs/` の下にあり、コミットしない。

## ADR 候補に関わるものを消す

- `codiel-state` の `next-adr-candidate-id` コマンドとテスト 5 件。このコマンドだけが使っていた `escapeRegExp`(`src/codiel-state.ts`)と `writeDomainDoc`(`src/__test__/codiel-state.v1-config-domain.test.ts`)も消す。
- `skills/orchestrating-runs/references/adr-candidates.md`。
- `references/intent-format.md` の `[ADR 候補]` の書式・候補 ID の採番・参照形・ADR の 3 条件・`knowledgeTarget` ごとの分担の表。
- intent-sync・fix-loop・finalize・再開・stop の完了報告の手順にある、ADR 候補の判定と一覧。

## run state から candidates を消し、knowledgeTarget は残す

- `RunState.candidates` と、`codiel-state init` の `--adr-candidates`・`--gotcha-candidates` を消す。
- `readState` が `candidates` を補う行を消す。`readState` は未知のキーを検査しないので、`candidates` を持つ既存の state はそのまま読める。state の version は 2 のまま変えない。
- `check-intent-env` から、`knowledgeRecording` の出力と、`ENABLE_VALUES`・`featureEnabled`・`readKnowledgeRecording` を消す。テストのヘルパーの `KNOWLEDGE_VARS` も消す。
- `knowledgeTarget` と `--knowledge-target` は残す。設計資料 `architecture.md` に書く範囲の判定が使っている。
  - `intent-format.md` では、この値の説明を「プロジェクトが `metatron.config.json` を持ち、metatron が構造の文書を管理しているかを表す」に改める。
  - `src/codiel-state.ts` の `knowledgeTarget` のコメントも同じ内容に直す。
- `guard-write` の動作は変えない。finalize の作業中に領域ファイルへの書き込みを通す免除は、失敗の記録を finalize で写す手順が使い続ける。コメントの文言だけを直す。

## paths.gotchas は #46 で両プラグイン同時に消す

Issue #45 には `src/hooks/lib.ts` の `DEFAULT_GOTCHAS_PATH` と `DocPaths.gotchas` を消すと書いたが、#46 へ移す。

`metatron.config.json` の読み方は、metatron と codiel が同じ規則を独立に実装し、2 者比較テストで突き合わせる契約である。テストは `paths.gotchas` に不正な値を入れたときの警告まで両者で比べている。codiel だけが先に `paths.gotchas` を読まなくなると、metatron が警告を出す設定で codiel が警告を出さなくなり、テストが失敗する。契約の変更は 1 つの PR で両方の実装に当てる必要がある。

このため、この PR では次を変えない。

- `src/hooks/lib.ts` の文書パスの解決。
- `check-intent-env` の `projectDocs.gotchas` の出力。
- 2 者比較テストのうち `gotchasPath` を突き合わせる部分。
- `skills/initializing-harness/SKILL.md` と `commands/init.md` の、GOTCHAS の台帳を作らないと述べる文。metatron の機能が残る間は事実である。

metatron の `lib/features.js` を import する `check-intent-env.knowledge.test.ts` は、`knowledgeRecording` と一緒にこの PR で消す。これで codiel から `features.ts` への依存が無くなり、#46 は `features.ts` を単独で消せる。

Issue #45 と #46 の本文は、この設計の承認後に直す。#46 には、`paths.gotchas` の両実装からの削除と、上の 2 ファイルの文の削除を加える。

## metatron のテストを通すための制約

metatron の `src/__test__/section-reference-inventory.test.ts` は、他プラグインの `skills/**` と、`agents/`・`commands/`・`references/` の直下の `.md` を走査する。大文字の `ARCHITECTURE` を含むファイルが登録簿(`src/fixtures/section-reference-inventory.json`)に無いと失敗する。登録簿にある codiel のファイルは 4 つである。

metatron のソースを変えないため、指示層の編集では次を守る。

- 登録簿に無いファイルに、大文字の `ARCHITECTURE` を書かない。`references/intent-format.md` の `knowledgeTarget` の説明も、この語を使わずに書く。
- 登録簿にある 4 ファイル(`commands/init.md`、`skills/initializing-harness/SKILL.md`、`skills/orchestrating-runs/SKILL.md`、`skills/reviewing-diffs/references/doc.md`)から、`ARCHITECTURE` と「ドメインマップ」への言及を消さない。

## #46 のマージまで metatron との間に残るずれ

metatron は #46 のマージまで ADR と GOTCHAS の機能を持ち続ける。その間のずれは次のとおりで、どれも既定で無効の機能の中に閉じる。

- metatron の `scan-gotcha-candidates` と `scan-adr-candidates` は旧い印を探すので、新しい形の記録を見つけない。意図どおりである。
- 記録を有効にしているプロジェクトでは、領域ファイルに残る旧い `[GOTCHAS 候補]` を、metatron が今までどおり台帳へ移して消す。
- metatron の `references/gotchas-format.md` と `references/architecture-format.md` は、codiel の `intent-format.md` の書式の写しを持つ。写しは古い書式のまま残り、#46 で消える。
- codiel の `docs/format-change-checklist.md` から、metatron の写しを追随させる 3 項目を消す。

## 変更するファイル

| 種別 | ファイル | 変更 |
| --- | --- | --- |
| 実装 | `src/codiel-state.ts` | `candidates`・2 つの引数・`next-adr-candidate-id`・`escapeRegExp` を消す。`knowledgeTarget` のコメントを直す |
| 実装 | `src/check-intent-env.ts` | `knowledgeRecording` と環境変数の読み取りを消す |
| 実装 | `src/hooks/guard-write.ts` | コメントだけを直す |
| テスト | `src/__test__/codiel-state.init.test.ts` | `candidates` の必須と値域のテストを消す。`candidates` を持つ state を読めるテストを残す |
| テスト | `src/__test__/codiel-state.v1-config-domain.test.ts` | `next-adr-candidate-id` の 5 件と `writeDomainDoc` を消す。`get` の出力のキーの一覧を直す |
| テスト | `src/__test__/check-intent-env.knowledge.test.ts` | 消す |
| テスト | `src/__test__/codiel-state-cli.test.ts`、`raguel-records.test.ts`、`helpers/codiel-state-fixtures.ts`、`helpers/check-intent-env-fixtures.ts` | `init` に渡す 2 つの引数と `KNOWLEDGE_VARS` を消す |
| テスト | `src/hooks/__test__/guard-github-mcp.test.ts`、`stop-guard.test.ts`、`guard-write.intents.test.ts`、`helpers/run-setup.ts`、`helpers/guard-write-fixtures.ts` | `init` に渡す 2 つの引数を消す。テスト名とコメントの文言を直す |
| バンドル | `scripts/` | `pnpm run build` で再生成する |
| 指示 | `skills/orchestrating-runs/` | SKILL.md、`references/` の `gotcha-candidates.md`(`failure-records.md` に改名)・`adr-candidates.md`(削除)・`phase-intent-sync.md`・`phase-finalize.md`・`phase-carry-over.md`・`phase-fix-loop.md`・`resume.md` |
| 指示 | `skills/raguel-gating/` | SKILL.md、`references/outcome-sync.md` |
| 指示 | `skills/syncing-intents/` | SKILL.md、`references/persistent-layer.md` |
| 指示 | `skills/capturing-intent/SKILL.md` | `init` の引数 |
| 指示 | `skills/filing-followup-issues/references/local-mode.md`、`references/intent-writing.md` | 候補に触れる箇所があれば直す |
| 参照 | `references/intent-format.md` | 領域ファイルの書式、ADR 候補の削除、`knowledgeTarget` の説明 |
| 参照 | `references/readable-writing.md` | `[ADR 候補]` を挙げた例を差し替える |
| 素材 | `assets/rules/codiel.md` | 持続層の書き込みの決まり |
| 文書 | `README.md`、`docs/DESIGN.md`、`docs/skill-flowcharts.md`、`docs/format-change-checklist.md` | 追随。README に、旧い形の記録の扱いと、`/codiel:init` をやり直して `.claude/rules/codiel.md` を更新することを書く |
| 配布宣言 | `.claude-plugin/plugin.json`、`package.json` | 1.1.3 |
| ルート | `README.md` | Codiel の項目と、Metatron の項目のうち Codiel の候補に触れる行 |

`.serena/memories/` の `core.md`・`codiel/core.md`・`file_contract.md` は候補の記述を持つ。worktree の中で書くと main 側に書かれるので、マージ後に main で更新する。

導入済みのプロジェクトの `.claude/rules/codiel.md` は、`/codiel:init` をやり直すまで旧い文面のまま残る。`/codiel:run` は文面の一致を確かめない。旧い文面は、finalize で `## GOTCHAS 候補` へ書き足してよいと述べていて、新しい手順と食い違う。README の案内で対処し、`/codiel:run` に検査は加えない。

## 確かめ方

- worktree で `pnpm install` を実行してから、`pnpm run lint`・`pnpm run typecheck`・`pnpm run test`・`pnpm run build` を通す。metatron のテストも、metatron のソースを変えずに通る。
- `plugins/codiel` の `src/`・`skills/`・`references/`・`assets/`・`commands/` を次の語で検索する。
  - 検索語: `ADR 候補`・`GOTCHAS 候補`・`candidates`・`adr-candidates`・`gotcha-candidates`・`promotionCandidate`・`AMATSUKA_METATRON_ENABLE`・`3 条件`・`関連 ADR`・`参照形`・`knowledgeRecording`・`next-adr-candidate-id`。
  - 残ってよいのは、旧い形を読まないと述べる文、`candidates` を持つ state を読めることを確かめるテスト、raguel-mcp と guard-bash にある別の意味の `candidates` である。
- 指示層の変更は、変更後の SKILL.md と手順ファイルを通して読み、次の 2 つが途切れずにたどれることを確かめる。
  - 失敗の記録を書く 3 つの時点から、領域ファイルへのコミットまで。
  - carry-over と fix-loop の修正判断から、intent の `## 合意済み事項` へのコミットまで。

## レビューで受けた指摘の採否

| 指摘 | 採否 | 対処 |
| --- | --- | --- |
| `intent-format.md` に `ARCHITECTURE` を書くと metatron のテストが失敗する | 採る | 「metatron のテストを通すための制約」を加えた |
| 修正判断が intent にも `design.md` にも残らない | 採る | intent 文書の `## 合意済み事項` に残す手順を加えた |
| 写す領域が決まらない記録が git に入らない | 利用者が現状の維持を選んだ | 未写しの理由を 3 つに直した |
| 新旧の書式をまたぐと二重に写る。過去の incident がまとめて写る | 採る | 旧い形を読まないことにし、移行の手順を消した |
| 未写しの `reports/adr-candidates.md` が通知なく失われる | 採る | 読まないと明記し、README に書く |
| 印付き・参照形のエントリの出典の追加が決まっていない | 採る | 通常の制約として読み、出典の追加を許すと書いた |
| 変更するファイルの表と検索語の漏れ | 採る | 表と検索語を直した |
| 手元の記録のキー、重複の判定、`写さない` の印、`check-intent-env` の削除範囲が決まっていない | 採る | それぞれ書いた |
| R-13 のテストの扱いを実装者に委ねている | 採る | この PR では変えないと決めた |
| ADR-007・ADR-013・ADR-015 の状態を更新していない | 採らない | ADR 一覧は #48 で移す。ADR の記録は既定で無効で、このリポジトリでも無効にしている |
| 領域ファイルが無いプロジェクトでの初期化が無い | 採らない | 領域ファイルを作る今の規則(取り込みの手順 2)は変えない。写す領域が決まらないときは手元に残す |
