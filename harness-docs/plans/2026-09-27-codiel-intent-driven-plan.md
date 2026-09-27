# codiel を intent 駆動へ改造し、sandalphon を吸収する 実装計画書

- 作成日: 2026-09-27
- 状態: 計画(第 2 版)・承認済み(2026-09-27)
- 設計書(正本): `harness-docs/design/2026-09-27-codiel-intent-driven-design.md`(第 9 版、決定 53 件、コミット `00fb6ae8`)
- 対象プラグイン: `plugins/codiel`(主)、`plugins/sandalphon`(撤去)、`plugins/metatron`、`plugins/gh-utility`
- バージョン: codiel `0.9.0-dev` → M1〜M3 の終点 `1.0.0-dev` → M4 の終点 `1.0.0`。metatron `0.3.10-dev` → M1 の終点 `0.3.11-dev` → M3 の終点 `0.4.0-dev`。gh-utility `0.5.2-dev` → M2 の終点 `0.5.3-dev`
- Workflow 実行: 8 本(M1 が 1 本、M2 が 4 本、M3 が 2 本、M4 が 1 本)
- 改訂履歴: 第 2 版で、反証レビューと暗黙知レビューの採用分(オーケストレーター決定)を反映した。主な変更は、並列タスクで型検査と lint を実行しないこと、コミットをゲートとプラグインの単位にしたこと、DESIGN.md の終了状態の修正を M1 の最初へ移したこと、`issue.md` の取り残しを M2 の対象に加えたこと、hooks.json の発火確認を M2-B の前の条件にしたことである

この計画書は、設計書をタスク・順序・検証方法へ分けるだけで、設計判断を上書きしない。設計書と実コードの食い違いを見つけたタスクは、作業を止めて `status: blocked` で報告する。オーケストレーターは報告を §9.3 へ追記し、設計書を直すかをユーザーに確かめる。

---

## 0. 前提

### 0.1 実装は別セッションで Dynamic Workflow を使う

実装セッションは次の性質を前提に Workflow スクリプトを組む。スクリプトを書く前に `workflow-authoring` スキルを読み、関数の引数の形はそのスキルで確かめる。

- スクリプトは `export const meta = { name, description, phases }` と、`phase()`・`agent(prompt, { label, phase, schema })`・`parallel()`・`pipeline()` で組む。
- 各 `agent()` はサブエージェントであり、ユーザーと対話できない。判断が要る事態では `status: blocked` を返して終わる。
- 完了したエージェントの結果は `resumeFromRunId` で再利用できる。
- 1 Workflow あたりのエージェント数は 10 未満を目安にする(ユーザーが引き上げられる)。この計画書の Workflow はすべて 9 以下に収めた。
- ユーザーの手作業と metatron の対話的な手順は Workflow の中に入れない。Workflow 実行の合間に、オーケストレーター(メインセッション)が §3.0・§3.4・§4.1.1・§4.4・§4.6・§5.3・§6.5 の手順で行う。
- 各 Workflow は、前の Workflow のゲートがコミットまで終えてから始める。

Workflow の中の作業は次の規則で分ける。

- タスクのエージェントはコミットしない。同じ作業ツリーで複数のエージェントが同時にコミットすると `index.lock` で衝突するためである。コミットは各 Workflow の最後のゲートのエージェントが、§7 の規則で行う。例外は M1-T00 で、Workflow の最初の phase で単独に動くので自分でコミットする。
- タスクのエージェントは `pnpm run build` を実行しない。バンドルは `codiel-state` などを各 hook の `.mjs` にインラインするので、同じプラグインの `scripts/` を複数のエージェントが再生成すると差分が混ざる。ビルドはゲートだけが行う。
- タスクのエージェントは `pnpm run typecheck` と `pnpm run lint` を実行しない。`tsconfig.json` の include はリポジトリ全体なので、隣のタスクの書きかけのファイルで失敗するためである。タスクが実行するテストは、自分が触るテストファイルの `pnpm exec vitest run <パス>` だけにする。
- 型検査・lint・全体のテスト・ビルドはゲートだけが行う。ゲートで失敗したら、同じマイルストーンの修正 Workflow(`codiel-m<n>-fix`)で直し、ゲートをやり直す(§9.2)。
- 同じ phase で並列に動くタスクは、触るファイルが重ならない。各タスクの「触るファイル」の外を変える必要が出たら、変えずに `blocked` で報告する。

### 0.2 baseline(M1 の前にオーケストレーターが実測して記入する)

値は実装セッションが O0-1(§3.0)で記入する。この計画書の作成時には記入しない。

| 項目 | 値 |
| --- | --- |
| HEAD | `164b29542c7223e8d427b6d15175c314db1a7966`(2026-09-27 に実測) |
| `git status --short` | `docs/chat/INDEX.md` の変更、未追跡の `docs/chat/2026/0926/phyllis998/2333-intent-driven-development-research.md` と `docs/chat/2026/0927/` だけ。本改修と無関係なのでコミットに混ぜない |
| `pnpm run lint` | 終了コード 0(Checked 420 files、エラー 0、info 4) |
| `pnpm run typecheck` | 終了コード 0 |
| `pnpm run test` | 終了コード 0(Test Files 175 passed / 1 skipped(176)、Tests 2616 passed / 2 skipped(2618)) |
| `pnpm run build` | 終了コード 0。実行後の `git status --short` に `scripts/` の差分なし |
| `gh --version` | 2.101.0(2026-09-15) |
| `wc -c plugins/codiel/skills/orchestrating-runs/SKILL.md` | 30,950 B |

baseline が失敗を含むときは M1 に入らず、ユーザーに報告する。

### 0.3 変えないもの

- `plugins/codiel/raguel-mcp/` を変えない。
- `harness-docs/ARCHITECTURE.md`・`harness-docs/GOTCHAS.md`・`.claude/rules/metatron/*.md` を Edit / Write で触らない。更新はオーケストレーターの手順で metatron の CLI とスキルを通す。
- `harness-docs/design/2026-08-16-file-contract-freeze.md` を書き換えない(設計書 §7.5)。
- `plugins/*/scripts/` と `plugins/*/dist/` を手で編集しない。例外は `plugins/codiel/scripts/install-harness.sh` だけである。
- metatron の R4-a〜f(`plugins/metatron/src/lib/__test__/config.test.ts:274-348`)のテスト本体を変えない。変えるのは `:241` のコメントだけである。
- ADR-004 の本文を書き換えない。
- `.serena/memories/` は Serena の `edit_memory` / `write_memory` / `delete_memory` でだけ変える。`delete_memory` はユーザーの許可を得てから使う。
- M1-T00 で直した `plugins/codiel/docs/DESIGN.md` の終了状態の記述(`:174-175` 付近)を、以降のタスクは元に戻さない。

---

## 1. 各タスクの依頼文に入れる共通ブロック

オーケストレーターは、各 `agent()` の依頼文の冒頭に次のブロックをそのまま入れる。`<...>` はタスクごとの値に置き換える。

```text
あなたはサブエージェントである。ユーザーと対話できないので、判断に迷ったら作業を止め、status: blocked で理由を報告する。

タスク: <タスク ID と内容>
設計書(正本): /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development/harness-docs/design/2026-09-27-codiel-intent-driven-design.md の <セクション番号>
実装計画書: /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development/harness-docs/plans/2026-09-27-codiel-intent-driven-plan.md の <タスク ID>
触ってよいファイル: <glob の列>
ロードするスキル: <スキル名。無ければ「なし」>
前の Workflow で確定した事項: <§9.3 の記録から、このタスクに要るもの。無ければ「なし」>

制約:
- ファイルへの書き込みは Edit / Write / Serena の編集ツールで行い、Bash では書き込まない。
- TypeScript・JavaScript・Markdown の作成と編集は Serena の編集ツールで行う。JSON と YAML は Edit で行う。
- plugins/*/scripts/ と plugins/*/dist/ を手で編集しない。pnpm run build も実行しない。ビルドはゲートが行い、src の変更と scripts の差分を同じコミットに入れる。
- pnpm run typecheck と pnpm run lint を実行しない(ゲートが行う)。実行するテストは、自分が触ったテストファイルの pnpm exec vitest run <パス> だけにする。
- コミットしない。git stash を使わない。
- 触ってよいファイルの外を変える必要が出たら、変えずに blocked で報告する。
- テストは対象ソースと同じディレクトリの __test__/ に <対象ファイル名>.test.ts の名前で置き、vitest で書く。複数のテストから使うヘルパーは __test__/helpers/ に置く。子プロセスとして起動するエントリポイントは src/testing/ に置く。
- プラグインに書く日本語は /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development/plugins/native-japanese/references/discipline.md に従う。直訳語を使わない(Step は「Step」「ステップ」、section は「セクション」と書き、「段」「節」「〜の側」を使わない)。
- バージョンは変えない(ゲートが上げる)。規則は次のとおり。codiel は M1〜M3 の終点で 1.0.0-dev、M4 の終点で 1.0.0。metatron は M1 の終点で 0.3.11-dev、M3 の終点で 0.4.0-dev。gh-utility は M2 の終点で 0.5.3-dev。
- harness-docs/ARCHITECTURE.md、harness-docs/GOTCHAS.md、.claude/rules/metatron/*.md、.serena/memories/ を変えない。
- plugins/codiel/docs/DESIGN.md の終了状態の記述(M1-T00 で現行の TERMINAL に合わせたもの)を元に戻さない。
- 設計書と実コードが食い違っていたら、どちらかに合わせて直さず、両方の該当行を報告する。

報告: 次の JSON スキーマで返す。値は例示であり、実際の内容に置き換える。
{ "taskId": "M2-T01", "status": "done", "changedFiles": ["plugins/codiel/src/codiel-state.ts"], "commands": [{ "command": "pnpm exec vitest run plugins/codiel/src/__test__/codiel-state.test.ts", "exitCode": 0 }], "acceptance": [{ "id": "A2-2", "met": true, "evidence": "テスト名 'init は slug から識別子を作る'" }], "discrepancies": [], "notes": "" }
status は done か blocked のどちらかである。

<セッションの規律が依頼文への転記を求める条項は、この行の下に置く>
```

各タスクの「委譲先の種類」は、役割マーカーの対応表で次のように解決する。`agent()` が委譲先の定義を指定できるかは `workflow-authoring` で確かめる(§10 の未決事項 1)。

| 種類 | 使う場面 |
| --- | --- |
| complex-impl | 公開インターフェース(CLI・state の型・hook の判定)を変える実装 |
| normal-impl | 既存パターンに沿う実装とテスト |
| light-impl | ゲート(検査コマンドの実行・バージョン・コミット)と、機械的な置き換え |
| general | 指示書・参照文書・README など文書の執筆 |
| code-review | 各マイルストーンの終わりの差分レビュー(読み取りだけ) |
| final-review | M4 の終わりの、M1〜M4 全体の最終レビュー(読み取りだけ) |

AI 向けの指示書を書くタスク(`plugins/*/references/**`、`plugins/*/skills/**`、`plugins/*/agents/*.md`、`plugins/*/commands/*.md`、`harness-docs/**`)は `prompt-smith:prompt-smith` をロードする。新設するスキルの SKILL.md と、既存スキルの description を書き換えるタスクは `prompt-smith:skill-creator` も併せてロードする。Agent 定義の本文を直すタスク(M2-T12b の `codiel-test-designer.md`)は `prompt-smith:agent-creator` をロードする。description と tools は変えない。

読み取りだけのエージェント(code-review・final-review)の依頼文には、共通ブロックに加えて「使用してよい tools を読み取り系に限定する」「ファイルを変更しない」「報告のみを返す」の 3 文と、次の severity の基準を入れる。

| severity | 基準 |
| --- | --- |
| critical | 実行時に壊れる、データや既存の文書が失われる、保護パスを直接書き換えている |
| high | 設計書の決定または受け入れ基準から逸脱している。grep は通るが意味が設計書と違う |
| medium | 設計書の範囲内での局所的な改善(テストの不足、重複、誤解を招く文) |
| low | 表記・体裁・命名の揺れ |

---

## 2. 設計書が計画書に委ねた細目の決定

設計書 §10「計画側への引き継ぎ」の細目を、この表で確定するか、確定させるタスクに割り当てる。

| 細目 | 決定、または決めるタスク |
| --- | --- |
| `implement.steps` の型と遷移 | 本書で確定(§6.2)。M4-T01 が実装する |
| test-loop の worktree(`testLoop.units`)の型 | `implement.steps` と同じ型を使う(§6.2)。登録は `step-add --kind unit` で行う。M4-T01 が実装する |
| lockfile の一覧と既定のインストールコマンド | 本書で確定(§6.3)。一覧は M4-T01 がコードに、対応表は M4-T03 が `writing-dev-plans` に書く |
| 連携モードの記録を変える CLI | `codiel-state set-integration --slug <slug> --integration <github\|local> --image-upload <値>`。`imageUpload` も同じ扱いにするので 1 つのコマンドで両方を書き換える。M2-T01 が実装する |
| intent-sync のスキル名 | `syncing-intents`(設計書の仮名のまま) |
| `sandalphon-common.md` の移設先の名前 | `intent-common.md`(設計書の仮名のまま) |
| 候補 ID の採番の実装 | `codiel-state next-adr-candidate-id --file <パス> --domain <領域名>` を足し、`{ "candidateId": "<領域名>-<n>" }` を返す。ファイルが無ければ `<領域名>-1` を返す。`--domain` には設計書 §6.4.1 の正規化後の領域名を渡す。M3-T08 が実装し、`syncing-intents` はこのコマンドを使う。環境判定(`check-intent-env`)に持たせないのは、intent フェーズで走る判定と、intent-sync で書く時点の番号がずれるためである |
| gh-utility の執筆規則の置き場 | 既存の `plugins/gh-utility/references/github-issue-common.md` に新しいセクションとして足す(設計書 §6.12.6 が許す形)。`issue-craft`・`issue-split`・`issue-triage` の SKILL.md は既にこのファイルを読む(各 `SKILL.md:14-16`)ので、読む指示を足す編集が要らない |
| gh-utility の追随の行の置き場 | 新設 `plugins/gh-utility/docs/format-change-checklist.md`。codiel と metatron の同名の文書に揃え、追随の行は `github-issue-common.md` の該当セクションを指す |
| metatron の走査と縮約の置き場 | 関数は `plugins/metatron/src/lib/adr-candidates.ts`、CLI のハンドラは `plugins/metatron/src/cli/adr-candidate.ts`(`gotcha.ts` が init・append・tag を 1 ファイルに持つ先例に倣う)、終了コード 3 は `src/cli/output.ts` の `EXIT_SHRINK_PENDING`。`main.ts` の読み・書きのサブコマンドの一覧と switch に足す |
| guard-github-mcp の対象ツールと本文の引数名 | M2-T03 が GitHub MCP の現行のツール定義(Context7 で `github/github-mcp-server` を引く)で確かめて確定し、報告の `notes` に表で残す。オーケストレーターがその表を §9.3 に転記する |
| `hooks.json` の matcher の正規表現 | 下の正規表現を初期案とする。サーバー名に `github` を含むことを条件にするのは、Linear など別の MCP の同名のツール(`create_issue`)に掛けないためである。M2-T03 が上の確認でツール名を確定し、正規表現を直す |
| claude-in-chrome で画像を載せる操作の手順とログインの前提 | M2 の E2E(§4.4 の O2-3)で確定し、§9.3 に記録する。M2-T14 が codiel の `github-writing.md` と gh-utility の `github-issue-common.md` に書く |
| `DESIGN.md` の終了状態の食い違い(設計書 §13 の 3 行目) | 本改修のタスクと分け、M1-T00 として M1 の最初に単独のコミットで直す。以降の DESIGN.md の編集はこの修正を保つ |

matcher の初期案(M2-T03 が確定する)。

```text
^mcp__.*github.*__(issue_write|add_issue_comment|update_issue_comment|create_issue|update_issue|create_pull_request|update_pull_request|update_pull_request_body|create_pull_request_review|add_comment_to_pending_review|pull_request_review_write)$
```

---

## 3. M1 吸収

sandalphon の資産を codiel へ移し、撤去の波及を済ませる。codiel の run はまだ Issue 起点のまま動く。終点の受け入れ基準は A1-1〜A1-6 である。

### 3.0 M1 の前のオーケストレーターの手順

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O0-1 | §0.2 の表の各項目(HEAD、`git status --short`、lint・typecheck・test・build の結果、`gh --version`、`orchestrating-runs/SKILL.md` のサイズ)を実測して記入する | オーケストレーター | 表に「実装セッションが記入」の欄が残っていない。4 コマンドが通っている |

### 3.1 Workflow `codiel-m1-absorb`

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 0 `design-fix` | M1-T00 | 直列(自分でコミットする) | 1 |
| 1 `move` | M1-T01、M1-T02、M1-T06 | `parallel` | 3 |
| 2 `skills-docs` | M1-T03、M1-T04 | `parallel`(どちらも M1-T02 に依存) | 2 |
| 3 `metatron` | M1-T05 | 直列(M1-T01〜T03 に依存) | 1 |
| 4 `gate` | M1-G | 直列 | 1 |
| 5 `review` | M1-R | 直列 | 1 |

エージェント数は 9 である。

### 3.2 タスク

#### M1-T00 DESIGN.md の終了状態を現行の TERMINAL に合わせる

- 内容: 設計書 §13 の 3 行目。`plugins/codiel/docs/DESIGN.md:174-175` の終了状態の記述(completed / stopped / rejected)を、現行の `TERMINAL`(`plugins/codiel/src/codiel-state.ts:90-95`。awaiting_outcome を含む)に合わせる。本改修の内容は書かない。他の DESIGN.md の編集より前に、このタスクだけで 1 コミットにする(メッセージ例 `docs(codiel): DESIGN.md の終了状態を TERMINAL に合わせる`)。
- 触るファイル: `plugins/codiel/docs/DESIGN.md`(`:174-175` 付近だけ)
- ドメイン: docs
- 依存: O0-1
- 完了条件: `git show --stat HEAD` が `plugins/codiel/docs/DESIGN.md` の 1 ファイルだけを含む。記述が `TERMINAL` の値と一致する
- 委譲先: light-impl
- スキル: なし

#### M1-T01 check-intent-env を codiel へ移し、2 者比較テストを作る

- 内容: 設計書 §6.9.3 のうち M1 の分(移設、`lib.ts` の `findDocRoot` / `resolveDocPaths` / `readDomainsResult` の import、独自の写しの削除、`codielHandoffCandidate`・`codielHarness`・`testRunner` の出力の削除、`build.ts` へのエントリ追加)と、§8.3 の縮小を行う。sandalphon 側の 3 者比較(`expectThreeWayMatch`)は移さずに削り、codiel 側に `expectTwoWayMatch` を作る。codiel に 3 者比較を残さない。`ghVersion` などの出力の追加と `*.ghe.com` の対応は M2-T06 で行い、ここでは入れない。`lib.ts:62,88,333,339-340,448` と `lib.test.ts:6,69,206,334,677` のコメントの「3 実装」「sandalphon」を「2 実装」「metatron」に、「契約 §13」を「契約 §14」に直す。
- 触るファイル: `plugins/codiel/src/check-intent-env.ts`(新設)、`plugins/codiel/src/__test__/check-intent-env.test.ts`(新設)、`plugins/codiel/build.ts`、`plugins/codiel/src/hooks/lib.ts`(コメントだけ)、`plugins/codiel/src/hooks/__test__/lib.test.ts`(コメントだけ)
- ドメイン: impl
- 依存: なし
- 完了条件: A1-5。`pnpm exec vitest run plugins/codiel/src/__test__/check-intent-env.test.ts plugins/codiel/src/hooks/__test__/lib.test.ts` が通る。`grep -n "expectTwoWayMatch" plugins/codiel/src/__test__/check-intent-env.test.ts` が 1 件以上で、`grep -n "ThreeWay" plugins/codiel/src/__test__/check-intent-env.test.ts` が 0 件。`grep -rn "sandalphon" plugins/codiel/src` が 0 件。比較項目(docRoot、architecture / gotchas のパス、warnings の有無と件数、ドメインマップの可読性・値・件数)を減らしていないことを報告に書く
- 委譲先: complex-impl
- スキル: なし

#### M1-T02 参照文書を codiel へ移す

- 内容: 設計書 §6.9.2 のうち `intent-format.md`・`handoff-contract.md`・`intent-common.md` の 3 本を `plugins/codiel/references/` へ移す。書式は v1 のまま移し、v2 への改訂は M2-T08a で行う。`intent-common.md` へ移す範囲は `plugins/sandalphon/references/sandalphon-common.md` の次の行である。
  - `:5-12` 基本方針、`:13-19` 大原則
  - `:31-46` 畳む経路の対応表。ただし `:40`(`/codiel:run` が無いときの Codiel 委譲)、`:41`(`codielHarness.dirExists`)、`:42`(`testRunner.detected`)の 3 行は除く
  - `:47-53` 畳んだことの報告、`:54-58` 自前起票(`:57` の「sandalphon 側で行う」は capturing-intent を主語に改める)、`:59-63` 失敗時
  - `:20-30` の環境チェックは移さない(M1-T03 が capturing-intent の本文へ吸収する)
  ARCHITECTURE への言及は落とさない(`section-reference-inventory.json:148,154` の登録がこのファイルへ移るため)。
- 触るファイル: `plugins/codiel/references/{intent-format,handoff-contract,intent-common}.md`(新設)
- ドメイン: prompt
- 依存: なし
- 完了条件: A1-3 の 2 ファイル分。`ls plugins/codiel/references/` が 3 件。`grep -c "sandalphon" plugins/codiel/references/*.md` がすべて 0。`grep -c "ARCHITECTURE" plugins/codiel/references/intent-format.md plugins/codiel/references/intent-common.md` が移設元と同じかそれ以上。`grep -n "testRunner\|codielHarness" plugins/codiel/references/intent-common.md` が 0 件
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M1-T03 capturing-intent スキルを codiel へ移す

- 内容: 設計書 §10 の M1 の項のとおり、sandalphon の手順から `/sandalphon:run` と `bridging-execution`・`executing-intent` への言及を除いたものを移す。参照先のパスを `plugins/codiel/references/` と `plugins/codiel/scripts/check-intent-env.mjs` に替え、`sandalphon-common.md:20-30` の環境チェックを本文へ吸収する。codiel の run とはまだつなげない。description から sandalphon の語を除く。ARCHITECTURE への言及は落とさない(`section-reference-inventory.json:160`)。
- 触るファイル: `plugins/codiel/skills/capturing-intent/SKILL.md`(新設)
- ドメイン: prompt
- 依存: M1-T02
- 完了条件: `grep -c "sandalphon" plugins/codiel/skills/capturing-intent/SKILL.md` が 0。参照するパスがすべて実在する(報告に列挙する)
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`、`prompt-smith:skill-creator`

#### M1-T04 codiel の文書と evals を移す

- 内容: 設計書 §6.9.4 のうち M1 の分。`rationale.md` を `plugins/codiel/docs/DESIGN.md` の新しいセクションへ統合する(M1-T00 の修正を保つ)。`format-change-checklist.md` を `plugins/codiel/docs/` へ移し、追随先を改める(`analyzing-issues` の行はこの時点では残し、M2-T13 で削る)。`evals/capturing-intent.json` を移す(改修後の手順への書き換えは M2-T09)。`plugins/codiel/README.md:52` の「intent issue を起点にした場合」のセクションから sandalphon の語を除き、codiel の capturing-intent を指す形にする。
- 触るファイル: `plugins/codiel/docs/DESIGN.md`、`plugins/codiel/docs/format-change-checklist.md`(新設)、`plugins/codiel/evals/capturing-intent.json`(新設)、`plugins/codiel/README.md`
- ドメイン: docs
- 依存: M1-T00、M1-T02
- 完了条件: A1-3 の checklist 分。`grep -n "sandalphon" plugins/codiel/README.md plugins/codiel/docs/format-change-checklist.md plugins/codiel/evals/capturing-intent.json` が 0 件。`plugins/codiel/docs/DESIGN.md` の sandalphon の語は、移設の経緯を書く統合セクションの中だけにある(設計書 §7.6 の許可リスト)
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`(checklist は AI も読むため)

#### M1-T05 metatron を追随させる

- 内容: 設計書 §7.3 のうち M1 の行。`references/architecture-format.md:84` の読み手、`docs/format-change-checklist.md` の sandalphon 行と 3 者比較、`docs/ARCHITECTURE.example.md:106`、`README.md:116-118`(sandalphon のセクションを削り codiel のセクションへ統合)、`src/lib/config.ts:8-9` と `src/lib/__test__/config.test.ts:241` のコメント(§13 → §14)、`src/fixtures/section-reference-inventory.json:148-160` の 3 エントリの移設先への置き換え。
- 触るファイル: `plugins/metatron/references/architecture-format.md`、`plugins/metatron/docs/{format-change-checklist,ARCHITECTURE.example}.md`、`plugins/metatron/README.md`、`plugins/metatron/src/lib/config.ts`、`plugins/metatron/src/lib/__test__/config.test.ts`(`:241` だけ)、`plugins/metatron/src/fixtures/section-reference-inventory.json`
- ドメイン: impl(fixtures とコメント)、docs
- 依存: M1-T01、M1-T02、M1-T03
- 完了条件: `grep -rn "sandalphon" plugins/metatron` が 0 件。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts plugins/metatron/src/lib/__test__/config.test.ts` が通る
- 委譲先: normal-impl
- スキル: `prompt-smith:prompt-smith`(`references/architecture-format.md` は指示書に当たる)

#### M1-T06 リポジトリ共通の波及を済ませる

- 内容: 設計書 §7.2 のうち Edit で行う行。`.claude-plugin/marketplace.json` の sandalphon のエントリ、`.claude/settings.json:62`、`.claude/skills/session-handover/evals/session-handover.json:21`(クエリ文の sandalphon を現存するプラグイン名へ。発火しないクエリという意図は変えない)、`pnpm-workspace.yaml` の `plugins/sandalphon` 行。`pnpm install` はゲートで実行する。ルートの `README.md` はオーケストレーターが §3.4 で直す。
- 触るファイル: `.claude-plugin/marketplace.json`、`.claude/settings.json`、`.claude/skills/session-handover/evals/session-handover.json`、`pnpm-workspace.yaml`
- ドメイン: manifest
- 依存: なし
- 完了条件: A1-1。`grep -n "sandalphon" .claude-plugin/marketplace.json pnpm-workspace.yaml .claude/settings.json .claude/skills/session-handover/evals/session-handover.json` が 0 件
- 委譲先: light-impl
- スキル: なし

#### M1-G ゲート

- 内容: `pnpm install` → `pnpm run lint` → `pnpm run typecheck` → `pnpm run test` → `pnpm run build` を順に実行する。すべて通ったら、codiel の `plugin.json` と `package.json` を `1.0.0-dev` に、metatron の両方を `0.3.11-dev` に上げ、§7.1 の単位でコミットする。どれかが失敗したら、コミットせずに失敗の出力を報告する。
- 触るファイル: `pnpm-lock.yaml`、`plugins/codiel/scripts/**`、`plugins/{codiel,metatron}/{package.json,.claude-plugin/plugin.json}`
- ドメイン: bundle、manifest
- 依存: phase 0〜3 のすべて
- 完了条件: A1-2。5 つのコマンドの終了コードが 0。A5-1(`grep -rn "metatron/src" plugins/codiel/src --include=*.ts | grep -v __test__` が 0 件)と A5-2(`grep -rn "codiel/src" plugins/metatron/src` が 0 件)。`git status --short` に本改修の未コミットの変更が残らない
- 委譲先: light-impl
- スキル: なし

#### M1-R レビュー

- 内容: M1 の開始時の HEAD から M1-G のコミットまでの差分を、設計書 §6.9.2〜§6.9.3・§7.1〜§7.3・§8.3 と照らしてレビューする。所見は §1 の severity の基準で返す。
- 触るファイル: なし
- 依存: M1-G
- 委譲先: code-review
- スキル: なし

### 3.3 M1 のゲートの判定

Workflow の終了後、オーケストレーターは M1-G と M1-R の報告を読む。M1-G が失敗したとき、または M1-R の所見に critical / high があるときは、修正のタスクを M1 の修正 Workflow(`codiel-m1-fix`)で出し、M1-G と同じゲートを通す。A1-4 と A1-6 は §3.4 の手順の後に判定する。

### 3.4 M1 の後のオーケストレーターの手順

次の順に行う。

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O1-1 | `.claude/rules/metatron/protected-paths.md:21-22` を 2 実装・2 者比較と codiel のパスへ改める(設計書 §7.2)。metatron の `stage-rules` → `commit-rules` を使う | オーケストレーター | `grep -n "sandalphon" .claude/rules/metatron/protected-paths.md` が 0 件 |
| O1-2 | `harness-docs/ARCHITECTURE.md:50` の例外を 3 プラグインに改める。`metatron:updating-architecture` スキルを起動して行い、`stage-architecture` を直接呼ばない | オーケストレーターとユーザー(対話) | `:50` に sandalphon が無い。ADR-003 の本文は変わっていない |
| O1-3 | ルートの `README.md` から sandalphon のセクションを削り、codiel のセクションに capturing-intent を足す | オーケストレーター(general へ委譲してよい) | `grep -n "sandalphon" README.md` が 0 件 |
| O1-4 | Serena メモリを設計書 §7.8 の 1〜4 項目どおりに直す。`sandalphon/core` の削除はユーザーの許可を得て `delete_memory` で行う | オーケストレーター | `grep -rln "sandalphon" .serena/memories` が 0 件 |
| O1-5 | ユーザーに `plugins/sandalphon/` の削除を依頼する。依頼する前に `pnpm run test` が通っていることを確かめる。コマンドは `! rm -rf /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development/plugins/sandalphon` | ユーザー | `ls plugins/sandalphon` が失敗する(A1-6) |
| O1-6 | 削除の後に `pnpm install`、`pnpm run build`、`pnpm run test` を実行し、`git add -A plugins/sandalphon pnpm-lock.yaml` で削除をコミットする | オーケストレーター | 3 つのコマンドが通る |
| O1-7 | A1-4 を判定する。`grep -rln sandalphon . --exclude-dir=node_modules --exclude-dir=.git` の結果から、設計書 §7.6 の許可リスト(`harness-docs/{design,plans,handover}/**`、`harness-docs/ARCHITECTURE.md`、`docs/prompts/**`、`docs/chat/**`、`plugins/codiel/docs/DESIGN.md`)を除いて 0 件 | オーケストレーター | 残ったパスは許可リストを広げずに直す |
| O1-8 | `/metatron:update` で ARCHITECTURE の乖離(プラグイン一覧など)を確かめ、あれば反映する | オーケストレーターとユーザー(対話) | 乖離の報告が 0 件 |
| O1-9 | O1-3・O1-4 の変更をコミットする(§7.1) | オーケストレーター | `git status --short` に本改修の変更が残らない |

---

## 4. M2 起点変更

run を intent から始める。終点の受け入れ基準は A2-1〜A2-23、A3-1、A3-7、A5-1、A5-2 である。

M2 は 4 本の Workflow に分ける。順序は M2-A → O2-0・O2-1 → M2-B → M2-C → O2-2・O2-3 → M2-D である。M2-B と M2-C は、M2-A のゲートがコミットまで終え、O2-0 の発火確認が通った後に始める。M2-A が CLI の名前と state の形を確定させ、M2-B と M2-C の指示書がそれを参照する。

### 4.1 Workflow `codiel-m2a-state-hooks`

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `state` | M2-T01 | 直列 | 1 |
| 2 `hooks-env` | M2-T02、M2-T03、M2-T04、M2-T06、M2-T07a | `parallel`(M2-T02〜T04 は M2-T01 に依存。M2-T06 と M2-T07a は依存なし) | 5 |
| 3 `gate` | M2A-G | 直列 | 1 |

エージェント数は 7 である。M2-T06 と M2-T07a は M2-T01 に依存しないが、phase 2 にまとめてエージェントの起動を 1 回で済ませる。

#### M2-T01 run state v2 と CLI

- 内容: 設計書 §6.1.1(`STAGES` 12 ステージ、`GATED` 8 フェーズ、`SKIPPABLE` に discuss と design)、§6.1.3 の `close`、§6.1.4 の `skip-phase` の条件、§6.2.1〜§6.2.4 のすべて(フィールド、`--slug`、`init` の必須と任意の引数、`--intent-only`、`branch` が `null` の run での `start-phase` の拒否、`runDir`、`findActiveRun` と `get --active` の走査、`complete-phase pr` の `--pr-url`、`mark-ask --kind` と `askKind`、`stop --reason intent-updated`、slug の制約、v1 の扱いと文言テンプレート)、§2 の `set-integration`。`implement` と `testLoop` のフィールドは M4 で足すので入れない。`codiel-state.test.ts` を v2 に書き換え、設計書 §8.2 の「state v2」「`adrTarget`」「`imageUpload`」「`mark-ask --kind`」「v1 の扱い」の行のテストを置く(§9.4 の食い違い 1)。hook のテスト(`src/hooks/__test__/*.test.ts`)は M2-T02・M2-T04 が直すので触らない。
- 触るファイル: `plugins/codiel/src/codiel-state.ts`、`plugins/codiel/src/codiel-state-cli.ts`、`plugins/codiel/src/__test__/codiel-state.test.ts`
- ドメイン: impl
- 依存: なし
- 完了条件: A2-2、A2-3、A2-4、A2-7、A2-8 のテスト分、A2-13、A2-15、A3-1、A3-7。`pnpm exec vitest run plugins/codiel/src/__test__/codiel-state.test.ts` が通る。報告の `notes` に、変更後の CLI のコマンドと引数の一覧を書く
- 委譲先: complex-impl
- スキル: なし

#### M2-T02 guard-bash のマーカー検査と、run の作り方の追随

- 内容: 設計書 §6.5.3 と §6.8「投稿する本文のマーカー」の guard-bash の規則。既存の 3 つの制限を残し、その後にマーカーの検査を当てる。`guard-bash.test.ts` と `stop-guard.test.ts` の既存テストの run の作り方は、すべてのテストで `init --slug` に替える(`init --issue` を残さない)。設計書 §8.2 の「guard-bash」「guard-bash(マーカー)」の行のテストを足す。
- 触るファイル: `plugins/codiel/src/hooks/guard-bash.ts`、`plugins/codiel/src/hooks/__test__/{guard-bash,stop-guard}.test.ts`
- ドメイン: impl
- 依存: M2-T01
- 完了条件: A2-5、A2-21。`pnpm exec vitest run plugins/codiel/src/hooks/__test__/guard-bash.test.ts plugins/codiel/src/hooks/__test__/stop-guard.test.ts` が通る。`grep -n "\-\-issue" plugins/codiel/src/hooks/__test__/guard-bash.test.ts plugins/codiel/src/hooks/__test__/stop-guard.test.ts` の一致が run の作成に使われていない
- 委譲先: normal-impl
- スキル: なし

#### M2-T03 guard-github-mcp の新設

- 内容: 設計書 §6.8「GitHub MCP の hook の規則」。`src/hooks/guard-github-mcp.ts` を新設し、`build.ts` のエントリと `hooks/hooks.json` の PreToolUse に登録する。対象ツールと本文の引数名は、Context7 で `github/github-mcp-server` の現行のツール定義を引いて確定する(§2)。マーカーの検査は guard-bash と共有の関数を作らず、このファイルの中で行う。設計書 §8.2 の「guard-github-mcp」の行のテストを置く。
- 触るファイル: `plugins/codiel/src/hooks/guard-github-mcp.ts`(新設)、`plugins/codiel/src/hooks/__test__/guard-github-mcp.test.ts`(新設)、`plugins/codiel/build.ts`、`plugins/codiel/hooks/hooks.json`
- ドメイン: impl、manifest
- 依存: M2-T01
- 完了条件: A2-22。`pnpm exec vitest run plugins/codiel/src/hooks/__test__/guard-github-mcp.test.ts` が通る。`grep -n "guard-github-mcp" plugins/codiel/hooks/hooks.json plugins/codiel/build.ts` が各 1 件。報告の `notes` に、対象ツールと本文の引数名の表と、確認に使った出典を書く
- 委譲先: normal-impl
- スキル: なし(Context7 の MCP ツールを使う)

#### M2-T04 guard-write の `docs/intents/**` の規則

- 内容: 設計書 §6.1.1 の `DOC_PHASES` の変更(intent と intent-sync を加え、init を除く)と、§6.8 の `docs/intents/**` の規則の表と判定の順序。`state.intent` のファイルはすべてのフェーズで通す。`state.intent` のファイルかどうかは、書き込み先の repoRoot 相対のパスと `state.intent` の値の完全一致で判定する(設計書 §6.8)。A2-9 の「同じファイル」もこの意味である。`guard-write.test.ts` の既存テストの run の作り方は、すべてのテストで `init --slug` に替える。設計書 §8.2 の「guard-write(フェーズ)」の行のテストを足す。worktree の判定は M4-T02 で行う。
- 触るファイル: `plugins/codiel/src/hooks/guard-write.ts`、`plugins/codiel/src/hooks/__test__/guard-write.test.ts`
- ドメイン: impl
- 依存: M2-T01
- 完了条件: A2-9。`pnpm exec vitest run plugins/codiel/src/hooks/__test__/guard-write.test.ts` が通る。`docs/intents/` の同じディレクトリにある別のファイル(パスが 1 文字違うもの)が design フェーズで ask になるテストがある
- 委譲先: normal-impl
- スキル: なし

#### M2-T06 check-intent-env の出力の追加と `*.ghe.com`

- 内容: 設計書 §6.9.3 のうち M2 の分(`repoSlug` の正規表現、`remoteHost`、`gh auth status --hostname <remoteHost>`、`ghVersion`、`ghAttachSupported`)と、§8.2 の「intent 書式 v2」(`existingIntents` が v1 と v2 の `intent` の値を返す)と「環境判定」の行のテスト。
- 触るファイル: `plugins/codiel/src/check-intent-env.ts`、`plugins/codiel/src/__test__/check-intent-env.test.ts`
- ドメイン: impl
- 依存: M1-T01(完了済み)
- 完了条件: A2-14。`pnpm exec vitest run plugins/codiel/src/__test__/check-intent-env.test.ts` が通る。2 者比較のケースが残っている
- 委譲先: normal-impl
- スキル: なし

#### M2-T07a gh-utility の check-issue-env

- 内容: 設計書 §6.12.6 と §7.4 の `src/check-issue-env.ts` と `src/__test__/check-issue-env.test.ts` の行。codiel のコードを使わずに独立に直す。
- 触るファイル: `plugins/gh-utility/src/check-issue-env.ts`、`plugins/gh-utility/src/__test__/check-issue-env.test.ts`
- ドメイン: impl
- 依存: なし
- 完了条件: A2-12 のテスト分。`pnpm exec vitest run plugins/gh-utility/src/__test__/check-issue-env.test.ts` が通る。`grep -rn "codiel" plugins/gh-utility/src` が 0 件
- 委譲先: normal-impl
- スキル: なし

#### M2A-G ゲート

- 内容: lint・typecheck・test・build を実行し、通ったら §7.2 の単位でコミットする。バージョンは上げない(codiel は M1 で `1.0.0-dev` にした。gh-utility は M2D-G で上げる)。§8.3 の A5-3 の grep のうち、この時点で対象のファイルがある行を回帰として実行する。
- 触るファイル: `plugins/{codiel,gh-utility}/scripts/**`
- 依存: phase 1〜2
- 完了条件: 4 コマンドの終了コードが 0。A5-1、A5-2。A5-3 の回帰の grep がすべて 1 件以上
- 委譲先: light-impl

#### 4.1.1 M2-A の後のオーケストレーターの手順(M2-B に進む条件)

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O2-0 | `hooks/hooks.json` の変更を新しいセッションで確かめる。`claude --plugin-dir /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development/plugins/codiel --debug-file <パス>` で起動し、run が active でない状態と、テスト用の run を作った状態の両方で、マーカーの無い `gh pr comment --body` と GitHub MCP の書き込みを試す。確かめた後、テスト用の run を `codiel-state stop` で止める | ユーザー | active のときだけ deny され、debug ログに guard-bash と guard-github-mcp の発火がある。通らなければ M2-B に進まず、`codiel-m2-fix` で直す |
| O2-1 | M2-T01 の報告にある CLI のコマンドと引数の一覧、M2-T03 の報告にある対象ツールの表を §9.3 に記録する。以降の依頼文の「前の Workflow で確定した事項」にこの記録を入れる | オーケストレーター | §9.3 の該当欄が埋まっている |

### 4.2 Workflow `codiel-m2b-formats-intent`

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `formats` | M2-T08a、M2-T08b、M2-T07b | `parallel` | 3 |
| 2 `skills` | M2-T09、M2-T11、M2-T13 | `parallel`(M2-T09 と M2-T11 は M2-T08a・T08b に依存) | 3 |
| 3 `gate` | M2B-G | 直列 | 1 |

エージェント数は 7 である。

#### M2-T08a intent-format.md を v2 に改める

- 内容: 設計書 §6.3.1〜§6.3.5(frontmatter、`status` の表、原文になるものの原則、13 セクションの順序、原文と派生文の規則、未記録のマーカー、持ち越しの注記、記録の形の例、v1 から v2 への変換の例、Issue を入口にしたときのマーカーの表、intent-issue の v2 書式、写像表の削除)と §6.12.2 の `## 出典`。持続層の書式は M3-T01 で足すので入れない。
- 触るファイル: `plugins/codiel/references/intent-format.md`
- ドメイン: prompt
- 依存: なし
- 完了条件: A2-16。A2-10 の `## 出典` の分(変更 intent の書式のコードブロックで最後の `##` 見出しが `## 出典`)
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M2-T08b intent-writing.md と github-writing.md の新設

- 内容: 設計書 §6.12.1〜§6.12.4。`intent-writing.md` は残す・削るの表と原文のセクションの 2 文を本文に載せる。`github-writing.md` は 3 文、縮退の順序の 2 系統、可視性、`<!-- codiel:generated -->` の文を載せ、画像の手段のセクションを 1 つ設ける。claude-in-chrome の具体的な操作は M2-T14 がこのセクションへ足すので、ここでは「ブラウザが使えてログイン済みであることが前提」「操作に失敗したら次の順へ縮退する」だけを書く。文の組み立ての規則は各ファイルの本文に書き、prompt-smith を参照して読ませる形にしない(設計書 §6.12.1)。
- 触るファイル: `plugins/codiel/references/{intent-writing,github-writing}.md`(新設)
- ドメイン: prompt
- 依存: なし
- 完了条件: A2-10 の `intent-writing.md` の分、A2-11、A2-17、A2-23 の codiel の分。`grep -c "prompt-smith" plugins/codiel/references/*.md` がすべて 0
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M2-T07b gh-utility の執筆規則

- 内容: 設計書 §6.12.6 と §7.4 の文書の行。`plugins/gh-utility/references/github-issue-common.md` に執筆規則と画像の載せ方のセクションを足し、§6.12.3〜§6.12.4 と同じ規則を codiel の名前を書かずに置く。マーカーの規則は写さない。画像の手段は実行時に判定する(`gh --version`、`remoteHost`、claude-in-chrome のツールの有無)。`issue-craft`・`issue-split`・`issue-triage` の SKILL.md は既にこのファイルを読むので変えない。`README.md` に画像の載せ方と前提を書く。`docs/format-change-checklist.md` を新設し、codiel の `github-writing.md` と揃える行と、prompt-smith の規律に追随させる行を置く。claude-in-chrome の具体的な操作は M2-T14 で足す。
- 触るファイル: `plugins/gh-utility/references/github-issue-common.md`、`plugins/gh-utility/README.md`、`plugins/gh-utility/docs/format-change-checklist.md`(新設)
- ドメイン: prompt、docs
- 依存: なし
- 完了条件: A2-12 の文書の分、A2-23 の gh-utility の分。`grep -rn "codiel" plugins/gh-utility` が 0 件
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M2-T09 capturing-intent を intent フェーズの手順に改める

- 内容: 設計書 §6.1.2〜§6.1.3 の手順 0〜6(`mark-ask` の例外、`git add -- <intent パス>`、パス限定のコミット、`git stash push -m` のパス指定、intent-only と続行の分岐、try-2 以降の持ち込み)、§6.3.3 の原文の規則、§6.3.5 の Issue を入口にしたときの扱い、`## 現状調査` の規律の付け替え、v1 の昇格、任意の起票の本文へのマーカー。CLI の引数は §9.3 に記録した一覧に合わせる。`evals/capturing-intent.json` を改修後の手順に合わせる。
- 触るファイル: `plugins/codiel/skills/capturing-intent/SKILL.md`、`plugins/codiel/evals/capturing-intent.json`
- ドメイン: prompt
- 依存: M2-A、M2-T08a、M2-T08b
- 完了条件: A2-8 の grep 分、A2-19
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`、`prompt-smith:skill-creator`

#### M2-T11 syncing-intents スキルの新設(M2 の分)

- 内容: 設計書 §6.3.4 の受け入れ基準の書き戻しと、途中で追記された原文の派生文のセクションへの反映(`mark-ask --kind confirm` による人の確認つき)。原文のセクションを書き換えない、`status` を `done` にしない、を手順に入れる。持続層の取り込みと `adrTarget` の書き分けは M3-T02 で足す。
- 触るファイル: `plugins/codiel/skills/syncing-intents/SKILL.md`(新設)
- ドメイン: prompt
- 依存: M2-A、M2-T08a
- 完了条件: A2-20 の grep 分(`grep -n "done" plugins/codiel/skills/syncing-intents/SKILL.md` の該当行が「付けない」の文だけである)
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`、`prompt-smith:skill-creator`

#### M2-T13 analyzing-issues と codiel-analyst の削除と、入口と文書の追随

- 内容: 設計書 §6.1.6 の削除、`commands/run.md` の引数 3 形と description、`plugin.json` の description、`section-reference-inventory.json` の `plugins/codiel/agents/codiel-analyst.md` のエントリの削除(§9.4 の食い違い 2)、`docs/format-change-checklist.md` の `analyzing-issues` 行の削除と `filing-followup-issues`・`syncing-intents` 行の追加、`docs/DESIGN.md`・`docs/skill-flowcharts.md`・`README.md`・`CLAUDE.example.md` の intent 駆動への書き換え。`DESIGN.md` の終了状態の記述(M1-T00)は保つ。`CLAUDE.example.md` の見出し `文書の扱い` は残す(A5-3 の grep の対象)。README には、run の間に gh-utility から投稿すると deny されることを書く(設計書 §6.12.6)。
- 触るファイル: `plugins/codiel/skills/analyzing-issues/`(削除)、`plugins/codiel/agents/codiel-analyst.md`(削除)、`plugins/codiel/commands/run.md`、`plugins/codiel/.claude-plugin/plugin.json`(description だけ)、`plugins/metatron/src/fixtures/section-reference-inventory.json`、`plugins/codiel/docs/{DESIGN,skill-flowcharts,format-change-checklist}.md`、`plugins/codiel/README.md`、`plugins/codiel/CLAUDE.example.md`
- ドメイン: prompt、docs、manifest
- 依存: M2-A
- 完了条件: A2-1 の `argument-hint` 分、A2-6。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る。`grep -n "文書の扱い" plugins/codiel/CLAUDE.example.md` が 1 件以上
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`、`prompt-smith:skill-creator`(`commands/run.md` の description)

#### M2B-G ゲート

- 内容: M2A-G と同じ手順で、§7.2 の単位でコミットする。M2-T13 の Agent の削除と登録簿のエントリの削除は同じコミットに入れる(§7 の例外)。A5-3 の回帰の grep を実行する。
- 委譲先: light-impl

### 4.3 Workflow `codiel-m2c-skills`

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `skills` | M2-T10、M2-T12a、M2-T12b | `parallel` | 3 |
| 2 `gate` | M2C-G | 直列 | 1 |

エージェント数は 4 である。

#### M2-T10 orchestrating-runs を intent 起点に改める

- 内容: 設計書 §6.9.1 の `orchestrating-runs` の 5 行(フェーズ表・§0・§1・§2.1・§4.1・§5・§6、pr、finalize、共通、依頼文テンプレート)。§0 に連携モード・`imageUpload`・`adrTarget` の判定と `check-intent-env` の呼び出しを置き、§1 の run の解決を intent フェーズ(capturing-intent)へつなぐ。§6 の再開を `--slug` と frontmatter `run` からの逆引きにし、resume 時の連携モードの再判定と `set-integration` を書く。登録簿の 2 エントリ(`section-reference-inventory.json:46,52`)が指すセクションと ARCHITECTURE への言及を落とさない。`unscoped` の記述(§0 の実行モード)は残す(A5-3 の grep の対象)。
- 触るファイル: `plugins/codiel/skills/orchestrating-runs/SKILL.md`
- ドメイン: prompt
- 依存: M2-A、M2-B
- 完了条件: A2-1 の本文分、A2-18 の `orchestrating-runs` 分、A2-20 の finalize の grep 分。`grep -n "analyzing-issues\|--issue <" plugins/codiel/skills/orchestrating-runs/SKILL.md` が 0 件。`grep -n "unscoped" plugins/codiel/skills/orchestrating-runs/SKILL.md` が 1 件以上。`wc -c` の値を報告する(閾値判定はしない)
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M2-T12a review・triage・Raguel 系のスキル

- 内容: 設計書 §6.9.1 の `reviewing-diffs`(入力を `git diff`、軽量の入力、原文の未達は high、原文を正とし `mark-ask`、local では投稿しない、`github-writing.md` とレビュー本文の縮退の順序)、`filing-followup-issues`(local の草案、github の本文とマーカー)、`fixing-review-findings`(`github-writing.md`)、`raguel-gating`(outcome 同期の local 分岐、`--slug`)。`reviewing-diffs/references/generic.md:4` の `issue.md` を intent へ直す。持続層の違反の規則は M3-T03 で足す。
- 触るファイル: `plugins/codiel/skills/{reviewing-diffs,filing-followup-issues,fixing-review-findings,raguel-gating}/SKILL.md`、`plugins/codiel/skills/reviewing-diffs/references/generic.md`
- ドメイン: prompt
- 依存: M2-A、M2-B
- 完了条件: A2-18 の `reviewing-diffs` 分。`grep -n "gh pr diff" plugins/codiel/skills/reviewing-diffs/SKILL.md` が 0 件。`grep -n "codiel:generated" plugins/codiel/skills/filing-followup-issues/SKILL.md` が 1 件以上
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M2-T12b design 系・test 系のスキルと codiel-test-designer

- 内容: 設計書 §6.1.5〜§6.1.6。`preparing-design-agendas`(合意済み事項の継承を intent の `## 合意済み事項` と `## 意図的な制約` から)、`writing-design-docs`・`facilitating-design-discussions`(入力を intent に)、`writing-test-specs`・`writing-dev-plans`(`design.md` が無い run の入力)。`scripting-tests/SKILL.md:113` と `agents/codiel-test-designer.md:14,21` の `issue.md` を intent へ直す。`codiel-test-designer.md` の description と tools は変えない。持続層の読み取りは M3-T03、dev-plan の書式の変更は M4-T03 で足す。
- 触るファイル: `plugins/codiel/skills/{preparing-design-agendas,writing-design-docs,facilitating-design-discussions,writing-test-specs,writing-dev-plans,scripting-tests}/SKILL.md`、`plugins/codiel/agents/codiel-test-designer.md`
- ドメイン: prompt
- 依存: M2-B
- 完了条件: 自分が触ったファイルの `grep -n "issue\.md"` が 0 件。登録簿のテスト(`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts`)が通る
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`、`prompt-smith:agent-creator`(`codiel-test-designer.md`)

#### M2C-G ゲート

- 内容: M2A-G と同じ手順で、§7.2 の単位でコミットする。`issue.md` の取り残しの判定をここで行う。A5-3 の回帰の grep を実行する。
- 完了条件: 4 コマンドの終了コードが 0。`grep -rn "issue\.md" plugins/codiel/skills plugins/codiel/agents` が 0 件(`skills/*/references/` を含む)
- 委譲先: light-impl

### 4.4 E2E の前のオーケストレーターの手順(M2-C の後)

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O2-2 | `gh` を 2.99.0 以上へ上げる | ユーザー | `gh --version` が 2.99.0 以上 |
| O2-3 | 画像の載せ方の E2E を private のテスト用リポジトリで行う。対象は設計書 §8.4 の 4 手段(`--attach` で Issue と PR コメントに載せる、claude-in-chrome でアップロードした URL をレビュー本文に書く、claude-in-chrome が使えないときに `gh pr comment --attach` と `gh pr review` に分ける、どちらも使えないときに `reports/` に保存して理由とパスを本文に書く)。claude-in-chrome の操作(ファイルを選ぶ画面、`user-attachments` の URL の取り出し方、未投稿の下書きの破棄)とログインの前提を確定する | ユーザーとオーケストレーター(e2e-verify に委譲してよい) | 4 手段のそれぞれについて、使える環境で成功を確かめ、使えない手段は「使えない」と理由つきで記録する。縮退の順序(Issue・PR・コメント全般とレビュー本文の 2 系統)どおりに動くことを確かめたら完了とする。結果と確定した操作の手順を §9.3 の「E2E で確定した手順」に書く |

### 4.5 Workflow `codiel-m2d-image-steps`

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `steps` | M2-T14 | 直列 | 1 |
| 2 `gate` | M2D-G | 直列 | 1 |
| 3 `review` | M2-R | 直列 | 1 |

エージェント数は 3 である。

#### M2-T14 E2E で確定した操作を執筆規則へ書く

- 内容: §9.3 の「E2E で確定した手順」を入力にする。書き先は、codiel の `references/github-writing.md` の画像の手段のセクション(M2-T08b が設けたもの)と、gh-utility の `references/github-issue-common.md` の執筆規則のセクション(M2-T07b が設けたもの)である。それぞれに、claude-in-chrome の操作の手順、ログインの前提、操作に失敗したときの縮退先を書く。2 ファイルは独立に書き、書く内容(手段の順序・前提・縮退)は揃える。gh-utility 側には codiel の名前とマーカーの規則を書かない。
- 触るファイル: `plugins/codiel/references/github-writing.md`、`plugins/gh-utility/references/github-issue-common.md`
- ドメイン: prompt
- 依存: O2-3
- 完了条件: A2-11、A2-12 の文書分、A2-23 を再確認する。両ファイルに `user-attachments` の語がある
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M2D-G ゲート

- 内容: lint・typecheck・test・build を実行し、gh-utility の `plugin.json` と `package.json` を `0.5.3-dev` に上げ、§7.2 の単位でコミットする。A5-3 の回帰の grep を実行する。
- 完了条件: 4 コマンドの終了コードが 0。A5-1、A5-2
- 委譲先: light-impl

#### M2-R レビュー

- 内容: M2 の開始時の HEAD から M2D-G のコミットまでの差分を、設計書 §6.1〜§6.3、§6.5、§6.8(M2 の行)、§6.9.1、§6.12 と照らしてレビューする。所見は §1 の severity の基準で返す。
- 委譲先: code-review

### 4.6 M2 の後のオーケストレーターの手順

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O2-4 | このリポジトリを対象に、`/codiel:run` を github モードと local モードで 1 回ずつ通す(設計書 §8.4)。local モードは `origin` を持たない一時のリポジトリで行う。確かめる項目は下の一覧である | ユーザーとオーケストレーター | 各項目の YES / NO を §9.3 に記録する。A2-20 の手動分を含む。終わったら run を `finalize` か `stop` で終端にする(active な run が残るとほかのセッションの停止を stop-guard が止める) |
| O2-5 | 新 ADR を起票する。ADR-004 のうち「同梱 Agent を 2 体に絞る」部分を上書きし、残る同梱 Agent を `codiel-test-designer` の 1 体とする。`metatron:updating-architecture` スキルを起動して行い、`stage-adr` → `commit-architecture` を直接呼ぶ手順で代えない | オーケストレーターとユーザー(対話) | ARCHITECTURE に新しい ADR があり、ADR-004 の本文が変わっていない |
| O2-6 | `/metatron:update` で ARCHITECTURE の乖離を確かめる | オーケストレーターとユーザー | 乖離の報告が 0 件 |
| O2-7 | Serena メモリ `codiel/core` の run の記述を intent 起点に直す | オーケストレーター | `.serena/memories/codiel/core.md` に `--issue` を必須とする記述が無い |
| O2-8 | ルートの `README.md` の codiel と gh-utility のセクションを直す | オーケストレーター(general へ委譲してよい) | codiel の入口が 3 形で書かれている |
| O2-9 | O2-7・O2-8 の変更をコミットする | オーケストレーター | `git status --short` に本改修の変更が残らない |

O2-4 で確かめる項目(設計書 §8.4 から写す)。

- 原文のセクションと完了判定
  - 聞き取りの回答が要約も翻訳もされずに `## ASIS` / `## TOBE` に入り、今回やらないことも `## TOBE` に入る。
  - run の途中で要望を足すと、そのフェーズの中で原文のセクションの末尾に日付つきで追記され、既存の原文が変わらない。
  - intent-sync より後に要望を足し、run に含めないと答えると持ち越しの注記が付き、finalize で「持ち越し」と示されて達成の判定から外れる。
  - 原文にだけある要望を実装で満たさないとき、review が severity high の所見を出し、finalize の結果レポートで「未達」になり、intent の `status` が `in-progress` のままである。すべて達成のときだけ `done` になり、run ブランチにコミット(github では push)される。
  - 派生文と原文の食い違いの確認で、run が `awaiting_human` になってから人に聞く。
  - v1 の intent ファイルを渡すと、`## 現状調査` / `## 要求` へ移り、原文のセクションが聞き取りで埋まる。
  - Issue を入口にしたときの 4 通り。`<!-- intent:v1 -->` の Issue は本文が派生になり原文を聞き直す。マーカーの無い Issue は本文と人のコメントが原文に入り、bot と `<!-- codiel:generated -->` のコメントが除かれる。codiel が起票した `<!-- codiel:generated -->` の Issue を入口にすると本文が派生になり原文を聞き取る。承認ゲートで原文から記録を除ける。
  - triage の草案を入口にすると、`<!-- codiel:unrecorded -->` が聞き取りの原文に置き換わる。
- 投稿する本文のマーカー
  - 新しいセッションで、guard-bash と guard-github-mcp の hook が発火する(O2-0 で確認済みなら、その記録を引く)。
  - run が active な間に codiel が投稿した PR 本文・レビュー本文・Issue・コメントのすべてに `<!-- codiel:generated -->` が入っている。
  - run が active でないセッションでは、どちらの hook もマーカーを求めない。

O2-4 で M2 の受け入れ基準に NO が出たら、修正の Workflow(`codiel-m2-fix`)を出し、M2D-G と同じゲートを通してから O2-4 の該当項目をやり直す。

---

## 5. M3 持続層

終点の受け入れ基準は A3-2〜A3-15、A5-1〜A5-4 である。codiel の `intent-format.md` が `[ADR 候補]` の書式の正本なので、codiel の Workflow を先に、metatron の Workflow を後に実行する。

### 5.1 Workflow `codiel-m3a-durable-layer`

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `format` | M3-T01 | 直列 | 1 |
| 2 `sync-read` | M3-T02、M3-T03、M3-T07、M3-T08 | `parallel` | 4 |
| 3 `gate` | M3A-G | 直列 | 1 |

エージェント数は 6 である。M3-T02 は M3-T08 が実装する CLI を使うが、CLI の名前と出力の形は §2 で確定済みなので、2 つを並列にできる。

#### M3-T01 持続層の書式と ADR の 3 条件の写し

- 内容: 設計書 §6.4.1〜§6.4.3 を `intent-format.md` の新しいセクションにする。持続層の 5 セクション、1 行 1 パス、`[ADR 候補]` の書式・候補 ID・採番の規則・エントリの範囲・参照形・変換の例、ADR の 3 条件の写し、`adrTarget` の表。
- 触るファイル: `plugins/codiel/references/intent-format.md`
- ドメイン: prompt
- 依存: なし
- 完了条件: A3-5。持続層の書式のコードブロックで最後の `##` 見出しが `## 出典`(A2-10 の持続層の分)
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M3-T02 syncing-intents に持続層の取り込みを足す

- 内容: 設計書 §6.4.3〜§6.4.4 の intent-sync の行と注記(取り込み、`## 由来`、`adrTarget` による書き分け、既存の制約との矛盾の確認、参照形のエントリの扱い、新しい候補 ID、`出典 intent` の追加)。候補 ID は `codiel-state next-adr-candidate-id` で得る手順にし、`--domain` に正規化後の領域名を渡すと書く。
- 触るファイル: `plugins/codiel/skills/syncing-intents/SKILL.md`
- ドメイン: prompt
- 依存: M3-T01
- 完了条件: A3-2、A3-6、A3-13
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M3-T03 持続層を読むフェーズの追随

- 内容: 設計書 §6.4.4 の読み手の表。`capturing-intent`(現状調査)、`writing-design-docs`(標準)、`writing-test-specs`・`writing-dev-plans`(軽量)、`reviewing-diffs`(A3-4 の文言)、`orchestrating-runs`(finalize の報告に ADR 候補を挙げる。§6.4.3)。`orchestrating-runs` の `unscoped` の記述と登録簿の 2 エントリが指す記述を保つ。
- 触るファイル: `plugins/codiel/skills/{capturing-intent,writing-design-docs,writing-test-specs,writing-dev-plans,reviewing-diffs,orchestrating-runs}/SKILL.md`
- ドメイン: prompt
- 依存: M3-T01
- 完了条件: A3-4。`grep -ln "docs/intents/domains" plugins/codiel/skills/*/SKILL.md` に上の 6 ファイルが並ぶ
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M3-T07 codiel の文書の追随

- 内容: `plugins/codiel/README.md` に「metatron を導入すると `/metatron:init` と `/metatron:update` が `[ADR 候補]` を ADR へ移し、持続層を参照形に縮める」の内容だけを書く。`docs/format-change-checklist.md` に、ADR の 3 条件の写しと ADR 候補の書式を metatron と揃える行を 1 行ずつ足す。`docs/DESIGN.md` に持続層を足す(終了状態の記述は保つ)。
- 触るファイル: `plugins/codiel/README.md`、`plugins/codiel/docs/{format-change-checklist,DESIGN}.md`
- ドメイン: docs
- 依存: M3-T01
- 完了条件: A3-8 の codiel 分、A3-12 の codiel の checklist 分
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`(checklist)

#### M3-T08 候補 ID の採番の CLI

- 内容: §2 の `codiel-state next-adr-candidate-id`。印と参照形の候補 ID を完全一致のトークンとして読み、最大連番 + 1 を返す。ファイルが無ければ `<領域名>-1` を返す。設計書 §8.2 の「採番」の行のテスト(`frontend-1` と `frontend-10` があれば `frontend-11`)を置く。
- 触るファイル: `plugins/codiel/src/codiel-state.ts`、`plugins/codiel/src/__test__/codiel-state.test.ts`
- ドメイン: impl
- 依存: なし
- 完了条件: `pnpm exec vitest run plugins/codiel/src/__test__/codiel-state.test.ts` が通る
- 委譲先: normal-impl
- スキル: なし

#### M3A-G ゲート

- 内容: lint・typecheck・test・build を実行し、§7.3 の単位でコミットする。codiel のバージョンは `1.0.0-dev` のまま据え置く。
- 完了条件: 4 コマンドの終了コードが 0。A5-1、A5-2
- 委譲先: light-impl

### 5.2 Workflow `codiel-m3b-metatron`

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `impl-discipline` | M3-T04、M3-T06 | `parallel` | 2 |
| 2 `docs` | M3-T05 | 直列(M3-T04 の CLI と M3-T06 の checklist の編集の後) | 1 |
| 3 `gate` | M3B-G | 直列 | 1 |
| 4 `review` | M3-R | 直列 | 1 |

エージェント数は 5 である。

#### M3-T04 `scan-adr-candidates` と `shrink-adr-candidate` の実装

- 内容: 設計書 §6.11.1〜§6.11.4。置き場は §2 の表のとおりとする。`stage-adr` と `commit-architecture` を変えない。`main.ts` の書き込み系の catch は終了コード 1 を返すので、`shrink-adr-candidate` のハンドラの中で例外を捕まえ、書き込みの失敗も終了コード 3 と `shrinkPending` にする。設計書 §8.2 の「metatron の走査」「metatron の縮約」の行のテストを `src/lib/__test__/adr-candidates.test.ts` に、終了コードのテストを `src/cli/__test__/cli.test.ts` に置く。
- 触るファイル: `plugins/metatron/src/lib/adr-candidates.ts`(新設)、`plugins/metatron/src/lib/__test__/adr-candidates.test.ts`(新設)、`plugins/metatron/src/cli/adr-candidate.ts`(新設)、`plugins/metatron/src/cli/{main,output}.ts`、`plugins/metatron/src/cli/__test__/cli.test.ts`
- ドメイン: impl
- 依存: M3-A
- 完了条件: A3-9、A3-10、A5-2、A5-4(既存の metatron のテストが `docs/intents/domains/` の無い一時リポジトリで変更なしに通る)。`pnpm exec vitest run plugins/metatron` が通る
- 委譲先: complex-impl
- スキル: なし

#### M3-T06 writing-discipline を prompt-smith の規律に追随させる

- 内容: 設計書 §6.12.5 の表のすべてと、維持する特化。`docs/format-change-checklist.md` に追随のセクションを足す。`writing-discipline.md` の既存の見出し名は変えない。`skills/{capturing-architecture,updating-architecture,recording-gotchas}/SKILL.md` と `references/{gotchas-format,rules-format}.md` が見出し名で参照しているためである。見出し名を変える必要が出たら、変えずに `blocked` で返す。新しいセクションを足すことはできる。
- 触るファイル: `plugins/metatron/references/writing-discipline.md`、`plugins/metatron/docs/format-change-checklist.md`(writing-discipline のセクションだけ)
- ドメイン: prompt
- 依存: なし
- 完了条件: A3-14、A3-15。`git diff` で `writing-discipline.md` の既存の `##` 見出しの行が変わっていない
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M3-T05 metatron の参照文書・スキル・README の追随

- 内容: 設計書 §6.11.3、§6.11.5、§7.3 の M3 の行。`references/architecture-format.md` の「ADR 候補の取り込み」のセクション(正本が codiel にあることを冒頭に書く)、`references/cli-usage.md`、`references/config-schema.md` の既定パス表の行、`skills/{capturing-architecture,updating-architecture}/SKILL.md` の走査と候補の提示、`README.md` の走査の挙動、`docs/format-change-checklist.md` の ADR の 3 条件と ADR 候補の書式の追随の行。M3-T06 が同じ checklist に足したセクションを保つ。
- 触るファイル: `plugins/metatron/references/{architecture-format,cli-usage,config-schema}.md`、`plugins/metatron/skills/{capturing-architecture,updating-architecture}/SKILL.md`、`plugins/metatron/README.md`、`plugins/metatron/docs/format-change-checklist.md`
- ドメイン: prompt、docs
- 依存: M3-T04、M3-T06
- 完了条件: A3-3、A3-8 の metatron 分、A3-11、A3-12 の metatron 分
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M3B-G ゲート

- 内容: lint・typecheck・test・build を実行し、metatron の `plugin.json` と `package.json` を `0.4.0-dev` に上げ、§7.3 の単位でコミットする。§8.3 の A5-3 の判定表のうち M3 の行の grep を実行する。
- 完了条件: 4 コマンドの終了コードが 0。A5-1〜A5-4
- 委譲先: light-impl

#### M3-R レビュー

- 内容: M3 の開始時の HEAD から M3B-G のコミットまでの差分を、設計書 §6.4、§6.10〜§6.12.5 と照らしてレビューする。metatron の縮約が持続層のエントリの範囲の外を 1 バイトも変えないことを重点に見る。所見は §1 の severity の基準で返す。
- 委譲先: code-review

### 5.3 M3 の後のオーケストレーターの手順

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O3-1 | ARCHITECTURE を持たない一時の git リポジトリで `/codiel:init` の後に軽量の run を 1 回通し、続けて `/metatron:init` を実行する(設計書 §8.4) | ユーザーとオーケストレーター | `adrTarget` が `intents`、`unscoped` で進む、`[ADR 候補]` が書かれ finalize の報告に挙がる、`/metatron:init` が候補を提示し、承認した候補が ADR になり、持続層が参照形に縮む。結果を §9.3 に記録する |
| O3-2 | metatron が codiel の持続層を縮約すること(プラグインをまたぐ書き込み)を ADR にするかを、`metatron:updating-architecture` の手順の中で判断する | オーケストレーターとユーザー(対話) | 判断の結果を §9.3 に記録する |
| O3-3 | `/metatron:update` で ARCHITECTURE の乖離を確かめる | オーケストレーターとユーザー | 乖離の報告が 0 件 |
| O3-4 | Serena メモリ `metatron/core` と `file_contract` に、走査と縮約、`adoptedAs` の判定、共有ファイル契約を足す(設計書 §7.8) | オーケストレーター | 両メモリに `scan-adr-candidates` の語がある |
| O3-5 | ルートの `README.md` の metatron と codiel のセクションに持続層と ADR 候補の移送を足し、コミットする | オーケストレーター | `git status --short` に本改修の変更が残らない |

---

## 6. M4 並列化

終点の受け入れ基準は A4-1〜A4-4 と、A5-3 の `writing-dev-plans` の行である。

### 6.1 Workflow `codiel-m4-parallel`

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `state` | M4-T01 | 直列 | 1 |
| 2 `hooks-skills` | M4-T02、M4-T03、M4-T05 | `parallel`(M4-T02 は M4-T01 に依存) | 3 |
| 3 `orchestrate` | M4-T04 | 直列(M4-T01・T03・T05 に依存) | 1 |
| 4 `docs` | M4-T06 | 直列 | 1 |
| 5 `gate` | M4-G | 直列 | 1 |
| 6 `review` | M4-R、M4-FR | `parallel` | 2 |

エージェント数は 9 で、10 未満である。1 つの `agent()` に複数のタスクをまとめるものは無い(第 1 版の M4-T07 は M1-T00 へ移した)。

### 6.2 `implement.steps` と `testLoop.units` の型と遷移(確定)

設計書 §6.6.5 が必須とするフィールドを、次の型で持つ。型は実装の目安であり、名前を変えるときは M4-T01 の報告に書く。

```ts
type StepStatus = "pending" | "running" | "reviewing" | "merged" | "failed"
interface StepState {
  status: StepStatus
  files: string[]                 // 触るファイル(repoRoot 相対の glob)
  deps: string[]                  // 前提ステップ
  final: boolean                  // 方式 b の最終ステップ
  group: { index: number; mode: "parallel" | "serial" | "final" } | null
  worktree: string | null         // repoRoot 相対のパス
  branch: string | null
  commits: { base: string | null; head: string | null }
  attempts: number                // 修正ラウンド数。phases[phase].attempts とは別
  domain: string | null
}
// RunState に任意フィールドとして足す。version は 2 のまま
implement?: { steps: Record<string, StepState> }
testLoop?: { units: Record<string, StepState> }
```

遷移は次のとおりとし、CLI が検証する。表に無い遷移は非ゼロで終了する。

| 現在 | 次 | 契機 |
| --- | --- | --- |
| `pending` | `running` | worktree を作って委譲した(`--worktree`・`--branch`・`--base` を記録) |
| `running` | `reviewing` | 委譲先の報告を受けた |
| `reviewing` | `running` | タスクレビューの所見で修正ラウンドに入った(`attempts` を 1 増やす) |
| `reviewing` | `merged` | run ブランチへマージした(`--head` を記録) |
| `running` / `reviewing` | `failed` | マージの衝突、または 5 ラウンドで通らなかった |
| `failed` | `pending` | やり直しの前に worktree とブランチを削除した(`worktree`・`branch`・`commits` を `null` に戻す) |

CLI は次の 3 つである。

- `step-add --slug <slug> --id <k> [--kind step|unit] --files '<JSON 配列>' --deps '<JSON 配列>' [--final] [--domain <名前>]`。glob に `{a,b}` のカンマが入るので、配列は JSON で渡す。`--kind` の既定は `step` で、`unit` は `testLoop.units` に登録する。
- `step-update --slug <slug> --id <k> [--kind step|unit] --status <状態> [--worktree <パス>] [--branch <名前>] [--base <sha>] [--head <sha>]`。`reviewing` から `running` への遷移で `attempts` を 1 増やす。
- `waves --slug <slug>`。`implement.steps` だけを対象に、設計書 §6.6.2 の出力を stdout に出し、各ステップの `group` を記録する。`testLoop.units` は対象外である(unit の並列は `spec.md` の `parallel: true` で決まる)。unit を含む state で `waves` が unit を出さないことをテストで確かめる。
- unit の `deps` は常に空配列、`group` は `null` のままとする。
- `--final` は値を取らないので、`main` の冒頭で `--active` と `--human-approved` を取り除く処理(`codiel-state.ts:223-230` 付近)に加える。

### 6.3 lockfile の一覧と既定のインストールコマンド(確定)

serial グループにする lockfile は、`pnpm-lock.yaml`、`package-lock.json`、`npm-shrinkwrap.json`、`yarn.lock`、`bun.lockb`、`bun.lock`、`Cargo.lock`、`poetry.lock`、`uv.lock`、`Gemfile.lock`、`composer.lock`、`go.sum` とする。判定はファイル名(最後のセグメント)の完全一致で行い、どのディレクトリにあっても対象にする。

dev-plan の `## 環境準備` が「なし」のときの既定は次の表に限る。表に無い lockfile だけのプロジェクトではインストールを省き、dev-plan の担当に `## 環境準備` を書かせる。

| lockfile | 既定のコマンド |
| --- | --- |
| `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` |
| `package-lock.json` / `npm-shrinkwrap.json` | `npm ci` |
| `yarn.lock` | `.yarnrc.yml` があれば `yarn install --immutable`、無ければ `yarn install --frozen-lockfile` |
| `bun.lockb` / `bun.lock` | `bun install --frozen-lockfile` |
| `uv.lock` | `uv sync --frozen` |

### 6.4 タスク

#### M4-T01 `implement.steps`・`testLoop.units`・`waves`

- 内容: §6.2 の型・遷移・CLI、§6.3 の lockfile の一覧、設計書 §6.6.2 のグループ分けと重なりの判定。設計書 §8.2 の「`implement.steps`」の行のテストを置く。
- 触るファイル: `plugins/codiel/src/codiel-state.ts`、`plugins/codiel/src/__test__/codiel-state.test.ts`
- ドメイン: impl
- 依存: なし
- 完了条件: A4-2。`pnpm exec vitest run plugins/codiel/src/__test__/codiel-state.test.ts` が通る
- 委譲先: complex-impl
- スキル: なし

#### M4-T02 hook の worktree 対応

- 内容: 設計書 §6.8 の (a)〜(c)(メイン作業ツリーのルートでの run の検索、`worktreeRoot` 基準の判定、docRoot の写し、ステップ・unit 単位のドメイン)と、guard-bash と stop-guard のルートの変更。設計書 §8.2 の W-1〜W-5 のテストを置く。
- 触るファイル: `plugins/codiel/src/hooks/{lib,guard-write,guard-bash,stop-guard}.ts`、`plugins/codiel/src/hooks/__test__/{lib,guard-write,guard-bash,stop-guard}.test.ts`
- ドメイン: impl
- 依存: M4-T01
- 完了条件: A4-3。`pnpm exec vitest run plugins/codiel/src/hooks` が通る
- 委譲先: complex-impl
- スキル: なし

#### M4-T03 dev-plan と test-spec の書式

- 内容: 設計書 §6.6.1(触るファイル、前提ステップ、`## 環境準備`、`## 生成物`、方式 a / b の選び方と規約の読み先、方式 b の既定)と §6.7 の `spec.md` の frontmatter。§6.3 の既定のインストールコマンドの表を `writing-dev-plans` に載せる。§6.10.1 の rules の行の縮退先(規約が無ければ方式 b)を書く。
- 触るファイル: `plugins/codiel/skills/{writing-dev-plans,writing-test-specs}/SKILL.md`
- ドメイン: prompt
- 依存: なし
- 完了条件: A4-1、A4-4、A5-3 の `writing-dev-plans` の行
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4-T05 worktree の中で作業するスキル

- 内容: 設計書 §6.9.1 の `implementing`(worktree 内の依存のインストール、生成物の方式、`report.md`、`codiel-state` を呼ばない)と、`scripting-tests`・`running-regression-tests`(§6.7。unit の worktree、`parallel: true` の unit だけを同時に実行する)。
- 触るファイル: `plugins/codiel/skills/{implementing,scripting-tests,running-regression-tests}/SKILL.md`
- ドメイン: prompt
- 依存: なし
- 完了条件: `grep -n "report.md" plugins/codiel/skills/implementing/SKILL.md` と `grep -n "parallel: true" plugins/codiel/skills/running-regression-tests/SKILL.md` が各 1 件以上
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4-T04 orchestrating-runs の並列の流れ

- 内容: 設計書 §6.6.2〜§6.6.4 と §6.7 のオーケストレーターの手順(`step-add`・`waves`・循環のときの差し戻し、worktree の作成と `.git/info/exclude`、brief ファイル、並列の委譲、タスクレビュー、修正ループの 1〜3 と 4〜5 ラウンド、順次マージと衝突の処理、グループ後のユニットテスト、serial と final、後始末、test-loop の Step A と Step B)。委譲先は作業内容だけで表し、役割名もモデル名も書かない(ADR-004)。`unscoped` の記述と登録簿の 2 エントリが指す記述を保つ。
- 触るファイル: `plugins/codiel/skills/orchestrating-runs/SKILL.md`
- ドメイン: prompt
- 依存: M4-T01、M4-T03、M4-T05
- 完了条件: `grep -n "waves" plugins/codiel/skills/orchestrating-runs/SKILL.md` と `grep -n "info/exclude" plugins/codiel/skills/orchestrating-runs/SKILL.md` が各 1 件以上。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る。`wc -c` の値を報告する
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4-T06 codiel の文書

- 内容: `docs/DESIGN.md`・`docs/skill-flowcharts.md`・`README.md` に並列実装と test-loop の並列化を足す。`DESIGN.md` の終了状態の記述(M1-T00)は保つ。
- 触るファイル: `plugins/codiel/docs/{DESIGN,skill-flowcharts}.md`、`plugins/codiel/README.md`
- ドメイン: docs
- 依存: M4-T04
- 委譲先: general
- スキル: なし

#### M4-G ゲート

- 内容: lint・typecheck・test・build を実行し、codiel の `plugin.json` と `package.json` を `1.0.0` に上げ、§7.4 の単位でコミットする。§8.3 の A5-3 の grep をすべて実行する。
- 完了条件: 4 コマンドの終了コードが 0。A5-1、A5-2、A5-3
- 委譲先: light-impl

#### M4-R と M4-FR レビュー

- M4-R: M4 の差分を設計書 §6.6〜§6.8 と照らす。委譲先は code-review。
- M4-FR: M1 の開始時の HEAD から M4-G のコミットまでの全体を、設計書 §1 の決定表と §4 の受け入れ基準に照らす。委譲先は final-review。
- どちらも所見は §1 の severity の基準で返す。

### 6.5 M4 の後のオーケストレーターの手順

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O4-1 | このリポジトリを対象に `/codiel:run` を github モードと local モードで 1 回ずつ通す。dev-plan の `## 生成物` が方式 a になること、worktree が作られて後始末されることを確かめる(設計書 §8.4) | ユーザーとオーケストレーター | 結果を §9.3 に記録する。run を終端にする |
| O4-2 | `/metatron:update` で ARCHITECTURE の乖離を確かめる | オーケストレーターとユーザー | 乖離の報告が 0 件 |
| O4-3 | Serena メモリ `codiel/core` に並列実装を足す | オーケストレーター | `waves` の語がある |
| O4-4 | ルートの `README.md` の codiel のセクションに並列化を足し、コミットする | オーケストレーター | `git status --short` に本改修の変更が残らない |

---

## 7. コミットの分け方

バンドルは `codiel-state` などを各 hook の `.mjs` にインラインするので、`scripts/` の差分をタスク単位に割れない。そのためコミットは次の規則で分ける。

- 基本は、ゲートごと・プラグインごとに 1 コミットとする。そのマイルストーンで変えたプラグインの `src/`・`scripts/`・参照文書・スキル・文書をまとめる。
- 文書だけの変更と、バージョンの上げは、別のコミットにしてよい。
- プラグインをまたいで同じコミットに入れる例外は 1 つだけである。Agent やスキルの削除と、metatron の登録簿(`section-reference-inventory.json`)のエントリの削除は、同じコミットに入れる。分けると間のコミットで登録簿のテストが失敗する。
- リポジトリ共通のファイル(`.claude-plugin/marketplace.json`、`.claude/**`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`)は、プラグインと別のコミットにする。
- メッセージは Conventional Commits の形で書き、末尾に共同作成者の行を付ける。

### 7.1 M1

| # | 作成者 | 内容 |
| --- | --- | --- |
| C1-0 | M1-T00 | DESIGN.md の終了状態の修正(単独) |
| C1-1 | M1-G | codiel(check-intent-env、`scripts/`、参照文書、capturing-intent、文書、evals) |
| C1-2 | M1-G | metatron(fixtures、コメント、参照文書、文書) |
| C1-3 | M1-G | リポジトリ共通(marketplace、settings、session-handover の eval、workspace、lockfile) |
| C1-4 | M1-G | バージョン(codiel `1.0.0-dev`、metatron `0.3.11-dev`) |
| C1-5 | O1-6 | sandalphon の削除と lockfile |
| C1-6 | O1-9 | ルートの README と Serena メモリ |

O1-1 と O1-2 のコミットは metatron の CLI とスキルの手順に従う。

### 7.2 M2

| # | 作成者 | 内容 |
| --- | --- | --- |
| C2A-1 | M2A-G | codiel(state v2、hook 3 本、guard-github-mcp、`hooks.json`、check-intent-env、`scripts/`) |
| C2A-2 | M2A-G | gh-utility(check-issue-env、`scripts/`) |
| C2B-1 | M2B-G | codiel と metatron の登録簿(参照文書、capturing-intent、syncing-intents、analyzing-issues と codiel-analyst の削除と登録簿のエントリの削除、入口と文書) |
| C2B-2 | M2B-G | gh-utility(執筆規則、README、checklist) |
| C2C-1 | M2C-G | codiel(orchestrating-runs と各スキル、codiel-test-designer) |
| C2D-1 | M2D-G | codiel と gh-utility の執筆規則への E2E の手順。プラグインごとに 2 コミットに分ける |
| C2D-2 | M2D-G | gh-utility のバージョン `0.5.3-dev` |

### 7.3 M3

| # | 作成者 | 内容 |
| --- | --- | --- |
| C3A-1 | M3A-G | codiel(持続層の書式、syncing-intents、読み手のスキル、採番の CLI と `scripts/`、文書) |
| C3B-1 | M3B-G | metatron(走査と縮約、`scripts/`、writing-discipline、参照文書、スキル、README、checklist) |
| C3B-2 | M3B-G | metatron のバージョン `0.4.0-dev` |

### 7.4 M4

| # | 作成者 | 内容 |
| --- | --- | --- |
| C4-1 | M4-G | codiel(`implement.steps`・`waves`、hook の worktree 対応、`scripts/`、スキル、文書) |
| C4-2 | M4-G | codiel のバージョン `1.0.0` |

---

## 8. 検証

### 8.1 テスト方針

- ユニットテストは vitest で書き、`.claude/rules/metatron/testing-policy.md` の置き場に従う。新設するテストファイルは `plugins/codiel/src/__test__/check-intent-env.test.ts`、`plugins/codiel/src/hooks/__test__/guard-github-mcp.test.ts`、`plugins/metatron/src/lib/__test__/adr-candidates.test.ts` の 3 本である。
- 設計書 §8.1 が書き換えを求める既存のテストは次の 5 つである。
  - `plugins/codiel/src/__test__/codiel-state.test.ts`(M2-T01、M3-T08、M4-T01)
  - `plugins/codiel/src/hooks/__test__/guard-bash.test.ts`(M2-T02、M4-T02)
  - `plugins/codiel/src/hooks/__test__/guard-write.test.ts`(M2-T04、M4-T02)
  - `plugins/codiel/src/hooks/__test__/stop-guard.test.ts`(M2-T02、M4-T02)
  - `plugins/metatron/src/__test__/section-reference-inventory.test.ts` が読む `plugins/metatron/src/fixtures/section-reference-inventory.json`(M1-T05、M2-T13。テスト本体は変えない)
- このほか、`plugins/gh-utility/src/__test__/check-issue-env.test.ts`(M2-T07a)、`plugins/metatron/src/cli/__test__/cli.test.ts`(M3-T04)、`plugins/codiel/src/hooks/__test__/lib.test.ts`(M1-T01 のコメント、M4-T02)を書き換える。
- タスクは自分のテストだけを実行する。型検査・lint・全体のテストはゲートで実行する(§0.1)。
- テストで見ない受け入れ基準は grep で確かめる。grep の対象は設計書 §8.2 の最後の段落の一覧で、各タスクの完了条件に割り当てた。
- 対話・並列の委譲・worktree のマージ・画像の載せ方・hook の発火は、O0〜O4 の手動確認で見る。

### 8.2 マイルストーンごとの受け入れ基準の担当

| 基準 | 担当 | 確かめ方 |
| --- | --- | --- |
| A1-1〜A1-3、A1-5 | M1-T01〜T06、M1-G | テストと grep |
| A1-4、A1-6 | O1-5〜O1-7 | grep と `ls` |
| A2-1〜A2-23、A3-1、A3-7 | §4 の各タスクの完了条件 | テストと grep。A2-20 の手動分は O2-4 |
| A3-2〜A3-15 | §5 の各タスクの完了条件 | テストと grep |
| A4-1〜A4-4 | §6 の各タスクの完了条件 | テストと grep |
| A5-1、A5-2 | 各ゲート | grep |
| A5-3 | 各行の担当タスクと、M2 以降の各ゲート(回帰)。最終判定は M3B-G(M3 の行)と M4-G(全行) | 下の表の grep |
| A5-4 | M3-T04 | テスト |

### 8.3 A5-3 の判定表

設計書 §6.10.1 の依存表のうち、「定める箇所」が「縮退不要」でない行を次の grep で確かめる。「既存」の行は、本改修の前から在る記述であり、担当タスクはそれを消さないことに責任を持つ。M2 の各ゲートは、その時点で対象のファイルがある行を回帰として実行する。

| 依存 | grep | 担当タスク |
| --- | --- | --- |
| パス解決 | `grep -n "resolveDocPaths" plugins/codiel/src/hooks/lib.ts` | 既存(M1-T01・M4-T02 が保つ) |
| ドメインマップ | `grep -n "unscoped" plugins/codiel/skills/orchestrating-runs/SKILL.md` | 既存(M2-T10・M3-T03・M4-T04 が保つ) |
| ARCHITECTURE と GOTCHAS を読む | `grep -n "前提" plugins/codiel/skills/orchestrating-runs/SKILL.md` | 既存(M2-T10・M4-T04 が保つ) |
| SessionStart の注入・ARCHITECTURE の更新 | `grep -n "文書の扱い" plugins/codiel/CLAUDE.example.md` | 既存(M2-T13 が保つ) |
| GOTCHAS への記録 | `grep -n "未記録の GOTCHAS" plugins/codiel/skills/recording-gotchas/SKILL.md` | 既存(本改修では触らない) |
| ADR | `grep -n "ADR 候補" plugins/codiel/references/intent-format.md plugins/codiel/skills/syncing-intents/SKILL.md` | M3-T01、M3-T02 |
| ADR の 3 条件 | `grep -n "覆すコスト" plugins/codiel/references/intent-format.md` と、両プラグインの `format-change-checklist.md` の追随の行 | M3-T01、M3-T07、M3-T05 |
| rules を生成物の根拠に読む | `grep -n "方式 b" plugins/codiel/skills/writing-dev-plans/SKILL.md` | M4-T03 |
| `config-schema.md` の行 | `grep -n "docs/intents/domains" plugins/metatron/references/config-schema.md plugins/codiel/references/intent-format.md` | M3-T05、M3-T01 |

---

## 9. リスクと中断時の再開

### 9.1 リスク

| リスク | 対策 |
| --- | --- |
| 並列のエージェントが同じファイルを編集する | 各 phase のタスクの「触るファイル」を重ならないように割り当てた。外を変える必要が出たら `blocked` で止める |
| 同じ作業ツリーでの同時コミットや同時ビルド | タスクはコミットもビルドもしない。ゲートだけが行う |
| 隣のタスクの書きかけのファイルで型検査や lint が失敗する | タスクは型検査と lint を実行しない。ゲートでまとめて実行する |
| M2-A の中で hook のテストが一時的に通らない | M2-T02 と M2-T04 が同じ Workflow の中で hook のテストを直し、ゲートで全体を通す。Workflow の境界では常に全テストが通る |
| `orchestrating-runs/SKILL.md` を M2・M3・M4 の 3 回編集する | 同じ Workflow の中では 1 タスクだけが編集する。登録簿の 2 エントリと `unscoped` の記述を落とさないことを依頼文に入れた |
| 手動確認の run が active のまま残り、実装セッションの停止を stop-guard が止める | O2-0・O2-4・O3-1・O4-1 の最後に run を終端にする |
| GitHub MCP のツール名が変わる | M2-T03 が確認の日付と出典を残す。変わったら matcher とテストを直す |
| claude-in-chrome の操作が GitHub の画面の変更で壊れる | 手順に「失敗したら次の手段へ縮退する」を必ず入れる(M2-T08b、M2-T14) |
| 画像のアップロードは取り消せない | E2E は private のテスト用リポジトリで、公開してよい画像だけで行う |
| `workflow-authoring` の API が §0.1 の前提と違う | 実装セッションがスクリプトを書く前にスキルで確かめ、違えば §9.3 に記録して前提を直す |

### 9.2 中断と失敗の扱い

- Workflow が途中で止まったら、`git status --short` で未コミットの変更を確かめてから、`resumeFromRunId` で同じ Workflow を再実行する。完了したエージェントの結果は再利用され、失敗したエージェントと後続だけが動く。
- タスクが `blocked` を返したら、オーケストレーターが理由を読む。設計書との食い違いなら §9.3 に記録してユーザーに確かめる。依頼文の不足なら依頼文を直してそのタスクだけを再実行する。
- ゲートが失敗したら、コミットされていない状態で止まる。失敗の出力から原因のタスクを特定し、同じマイルストーンの修正 Workflow で直してから、ゲートを再実行する。原因が 1 つに絞れないときは advisor に相談する。
- 未コミットの変更を退避するときは `git stash` を使わず、一時の WIP コミットにする。stash の一覧はほかのセッションと共有されるためである。
- レビューの critical / high は、同じマイルストーンの修正 Workflow(`codiel-m<n>-fix`)で直してからゲートを通し、次のマイルストーンへ進む。medium / low は §9.3 に記録し、ユーザーが扱いを決める。

### 9.3 記録欄

実装中にオーケストレーターが書き込む。

| 項目 | 記録 |
| --- | --- |
| M2-A で確定した CLI のコマンドと引数(O2-1) | M2-T01 の報告(コミット `00ecbb48`)。共通: `init` と `get --active` 以外は `--slug <slug>` が必須(`--issue` の指定は廃止)。v1 の state は `get` と `stop` だけが受け付け、ほかは §6.2.4 の文言で終了コード 1。値を取らないフラグは `--active`・`--human-approved`・`--intent-only`。成功時の stdout は `{ statePath, state }`。コマンド: `init --slug --intent --integration <github\|local> --scale <standard\|light> --adr-target <metatron\|intents> --image-upload <gh-attach\|chrome\|gh-attach,chrome\|none> [--issue N] [--intent-only] [--base-branch] [--domain-mode]`(`--intent` は repoRoot 相対で、絶対パスは拒否。未終端の try があれば失敗)/ `get --slug` / `get --active`(`{ runs: [...] }`。v1 は含めず stderr に文言)/ `stop --slug [--reason]` / `start-phase <phase> --slug`(`branch` が null なら intent 以外を拒否)/ `skip-phase <phase> --slug --reason`(discuss と design は scale が light のときだけ)/ `pass-gate <phase> --slug --evaluation-id --verdict <PROCEED\|ASK> [--human-approved]` / `complete-phase <phase> --slug [--note] [--pr-url]`(pr は github のときだけ `--pr-url` 必須。local では渡されても無視)/ `mark-ask <phase> --slug [--kind <raguel\|confirm>] [--evaluation-id]` / `resume --slug`(`askKind` は残る)/ `close --slug [--reason]`(新設)/ `set-integration --slug --integration --image-upload`(新設。終端の run は拒否)/ `set-domain --slug --domain` / `clear-domain --slug` / `record-attempt <phase> --slug`(上限超過で終了コード 3)/ `finalize --slug` / `record-outcome --slug --outcome <approved\|rejected\|incident> [--note]`。`--base-branch` と `--domain-mode` は設計書 §6.2.2 の必須の列挙に無いので任意のまま残した(§6.1.2 の手順 5 の (4) はスキルが常に渡す)。`findActiveRun` はシグネチャを変えず、`runs/` 直下を全走査して v2 の state だけを run として扱う |
| guard-github-mcp の対象ツールと本文の引数名(O2-1) | M2-T03 の報告。出典は Context7 のライブラリ ID `/github/github-mcp-server`(v1.12.2、2026-09-27 取得)。本文の引数名はすべて `body`。既定で有効なツール: `issue_write`、`add_issue_comment`(reaction だけの呼び出しでは `body` を省略できる)、`update_issue_comment`、`create_pull_request`、`update_pull_request`、`pull_request_review_write`。オプトインの granular 系で有効なツール: `update_pull_request_body`、`create_pull_request_review`、`add_comment_to_pending_review`。計画書 §2 の初期案の `create_issue`・`update_issue` は `issue_write` に統合済みで現行の定義に無いので外した。確定した matcher: `^mcp__.*github.*__(issue_write\|add_issue_comment\|update_issue_comment\|create_pull_request\|update_pull_request\|update_pull_request_body\|create_pull_request_review\|add_comment_to_pending_review\|pull_request_review_write)$`。`body` が文字列でない呼び出しは通し、内部エラーは既存の hook と同じく ask を返す |
| hooks.json の発火確認(O2-0) | 通過(2026-09-27)。ユーザーが `/tmp/codiel-o20` の一時リポジトリで `claude --plugin-dir <worktree>/plugins/codiel --debug-file ...` を起動して確かめた: run が無いとき `gh pr comment 999999 --body "hook test"` は hook を通って gh 自身のエラー(no git remotes found)になった。codiel の hook が読み込まれて動いていることは、Stop の `stop_hook_summary` に `stop-guard.mjs` があることと、PreToolUse:Bash の 2 本目の hook が空出力(通過)を返した記録で確かめた。そのセッションの active run の間の試行はマーカー付きで実行されて通ったため(期待どおり)、マーカー無しの deny は観測できなかった。その 2 点を、同じリポジトリでオーケストレーターが新しいヘッドレスセッション(`claude -p --plugin-dir ... --mcp-config <偽の GitHub MCP> --debug-file /tmp/codiel-o20/debug-headless.log`)で補った: run を awaiting_human にした状態で、`gh pr comment 999999 --body 'hook test'` は「gh pr comment の本文に `<!-- codiel:generated -->` を含めて投稿し直してください」で deny、`mcp__fake-github__add_issue_comment`(matcher のサーバー名に github を含む偽のサーバー。何も投稿しない)は「GitHub MCP の投稿にはマーカーが必要です。本文に <!-- codiel:generated --> を含めて投稿し直してください。」で deny された。debug ログに両方の `permissionDecision: deny` がある。検査用の run はどちらも `stop` で終端にした |
| E2E で確定した手順(O2-3) | 2026-09-27 に private のテスト用リポジトリ `phyllis998/codiel-e2e-test`(ユーザーの承認で作成)で確かめた。gh 2.101.0、claude-in-chrome はログイン済み。4 手段とも成功した。(1) `gh --attach`: 画像のある場所を作業ディレクトリにし、本文に `![alt](./file.png)` を書き、同じ相対パスを `--attach './file.png#alt'` で渡す。`gh issue create`(Issue #1)・`gh pr create`(PR #2 の本文)・`gh pr comment` で、本文の参照が `https://github.com/user-attachments/assets/<uuid>` に置き換わった。`gh pr review` には `--attach` が無い。(2) claude-in-chrome: 新しいタブで PR(または Issue)の画面を開き、`find` でコメント欄(Add a comment のフォーム)の `type=file` の入力を探し、`file_upload` で画像を渡す。「Attach files」のボタンは click しない(OS のファイル選択画面が開き、操作できない)。数秒待つと textarea(`name="comment[body]"`)に `<img width=… alt=… src="https://github.com/user-attachments/assets/<uuid>" />` が入る。`javascript_tool` で値から `https://github\.com/user-attachments/assets/[0-9a-f-]+` の URL を取り出し、textarea の値を空にして input イベントを送り、未投稿の下書きを破棄する(localStorage・sessionStorage に `user-attachments` を含む値が残らないことを確かめた)。タブを閉じ、URL を本文の `![alt](URL)` にして `gh pr review <番号> --comment --body ...` で投稿した(判定を伴うときは `--approve` / `--request-changes`)。前提は、ブラウザで対象リポジトリに書き込める GitHub アカウントにログインしていること。ログイン画面が出る、ファイル入力が見つからない、待っても URL が入らないときは次の手段へ縮退する。(3) ブラウザが使えないとき: 画像付きの本文を `gh pr comment --attach` で投稿し、判定だけを `gh pr review` で行い、レビュー本文でそのコメントの URL を示した。(4) どれも使えないとき: 画像を `reports/` に保存し、本文に載せられなかった理由と保存パスを書いた。可視性: private リポジトリの画像は `private-user-images.githubusercontent.com` から配信され、閲覧権限に従う。テスト用リポジトリの削除はユーザーが行う(gh のトークンに `delete_repo` が無い) |
| 手動確認の結果(O2-4、O3-1、O4-1) | (未記録) |
| `agent()` の委譲先の指定(§10 の未決事項 1) | 指定できる。`workflow-authoring` スキルの記述では、`agent()` の `opts.agentType` に Agent ツールと同じレジストリのサブエージェント名を渡せ、`schema` と併用できる。役割マーカーの対応表の定義を次のとおり指定する: complex-impl → `lead-implementer`(opus)、normal-impl → `claude-implementer`(sonnet)、light-impl → `claude-light-implementer`(haiku)、general → `general-worker`(sonnet)、code-review → `code-reviewer`(sonnet)、final-review → `claude-complex-reviewer`(fable)。各定義は担当表の Claude モデルと同じ `model` を宣言しているので、`opts.model` は渡さない(2026-09-27 確認) |
| 設計書との食い違い(実装中に見つかったもの) | M1-T01: `check-intent-env.ts` は `findDocRoot` を直接 import せず、`resolveDocPaths` が内部で解決した `docRoot` を使う(git の子プロセスを増やさず、文書パスと docRoot を同じ解決結果にするため)。独自の写しを持たないという §6.9.3 の目的は満たすので採用した。M1-T02・T05: `sandalphon-common.md` の ARCHITECTURE への言及は環境チェック(`:20-30`)にあり、capturing-intent の本文へ吸収された。登録簿は `intent-common.md` ではなく `plugins/codiel/references/intent-format.md` と `plugins/codiel/skills/capturing-intent/SKILL.md` の 2 エントリにした。M2-T04: `state.intent` との照合に使う相対パスを、repoRoot ではなく `codielRel`(`.codiel` を持つ祖先が基準)で求めた。`.codiel` と git ルートが同じ通常の構成では一致するが、ずれる構成では設計書 §6.8 と食い違うので、M2-R で確かめる。M2-T04 はテストファイルの全面書き換えに Serena ではなく Write を使い、M2A-G は lint の整形を biome で自動修正した(どちらも内容は差分とテストで確認済み)。M2-T08b: `github-writing.md` は構成を `intent-writing.md` に揃えたが、根拠と背景の残す・削るの表は再掲していない。設計書 §6.12.3 の「構成は Intent 文書の執筆規則に従う」を満たすかを M2-R で確かめる |
| レビューの medium / low | M1-R: low 1 件。`plugins/codiel/docs/DESIGN.md` の統合セクション(§12)の導入文 2 文が「節」を使っていた。直訳語を使わない制約に当たるので「セクション」に直した(O1 の手順でコミット)。移設した本文の「二段構え」と、契約文書の規則番号を指す「段 3」は直していない |

### 9.4 計画の作成時に見つけた設計書と実コードの食い違い

1. 設計書 §8.2 の表で、「`adrTarget`」「`imageUpload`」「`mark-ask --kind`」「v1 の扱い」「`implement.steps`」の行のテストファイルが「同上」になっており、表の並びでは `check-intent-env.test.ts` を指す。内容は `codiel-state` の CLI の検査なので、本書は `plugins/codiel/src/__test__/codiel-state.test.ts` に置く(M2-T01、M4-T01)。同じ表の「2 者比較」の行の「同上」は直前の gh-utility の行を指すが、本書は `plugins/codiel/src/__test__/check-intent-env.test.ts` に置く(M1-T01)。
2. `plugins/metatron/src/fixtures/section-reference-inventory.json:16` に `plugins/codiel/agents/codiel-analyst.md` のエントリがある。設計書 §7.3 と §8.1 は sandalphon の 3 エントリだけを挙げ、このエントリの削除に触れていない。削除しないと M2 で登録簿のテストが失敗するので、M2-T13 の触るファイルに入れた。
3. 設計書 §10 は M3 の終点に A5-1〜A5-4 を置くが、A5-3 の対象のうち `writing-dev-plans` の行(§6.10.1 の rules の行)は M4 の変更である。本書は A5-3 のこの行だけを M4 の終点で判定する(§8.3)。
4. 設計書 §9 は metatron を M1 の終点で `0.3.11-dev` にするとし、依頼では metatron の値として `0.4.0-dev` だけが挙がっていた。両者は矛盾しない(M1 でパッチ、M3 でマイナー)ので、本書は設計書 §9 に従う。
5. 設計書 §6.1.6 の入力の置き換えの表は `issue.md` を読むスキルを 5 つ挙げるが、実コードでは次のファイルにも `issue.md` への言及がある。`plugins/codiel/skills/scripting-tests/SKILL.md:113`、`plugins/codiel/skills/reviewing-diffs/references/generic.md:4`、`plugins/codiel/agents/codiel-test-designer.md:14,21`、`plugins/codiel/skills/raguel-gating/SKILL.md:35,37,58`、`plugins/codiel/skills/fixing-review-findings/SKILL.md:35,81,95`。本書はこれらを M2-T12a・M2-T12b の触るファイルに入れ、M2C-G で `plugins/codiel/skills` と `plugins/codiel/agents` の全体を grep する。

実装中に見つけた食い違いは次のとおりである(2026-09-27 の実装セッションが記録)。

6. 登録簿のテスト(`plugins/metatron/src/__test__/section-reference-inventory.test.ts` の V2)は `plugins/` 配下の全プラグインを走査するので、`plugins/sandalphon/` が残る M1 のゲートの時点で sandalphon の 3 エントリを消すと失敗する。M1-T05 は最終形(codiel の 2 エントリ)に置き換え、M1-T05b が移設元の 3 エントリを一時的に戻した。O1-6 で `plugins/sandalphon/` の削除と同じコミットに、3 エントリの削除を入れる(§7 の例外と同じ理由)。
7. §3.2 の M1-G などの完了条件 `grep -rn "codiel/src" plugins/metatron/src` は、作成時点から既存のコメント 2 件(`plugins/metatron/src/lib/config.ts:7`、`plugins/metatron/src/__test__/inject-context.test.ts:6`)に一致し、0 件にならない。設計書の A5-1・A5-2 は import を対象にしているので、各ゲートは import 文に限った grep(`from "…/codiel/src…"` と `import("…/codiel/src…")`。A5-1 も同じ形)で判定する。
8. 設計書 §6.2.2 は「すべてのコマンドの run 指定を `--slug` に替える」とするが、M2 のタスクに割り当てられていない `--issue` と `issue-N try-M` が次のファイルに残っている。`plugins/codiel/skills/{fixing-failures,recording-gotchas,implementing,running-regression-tests,initializing-harness}/SKILL.md`、`plugins/codiel/skills/scripting-tests/SKILL.md:91`。M2-C に M2-T12c(general)を足して前の 5 ファイルを直し、`scripting-tests/SKILL.md:91` は M2-T12b に含める。M2C-G で `--issue` と `issue-N try` の取り残しも grep する。M2-C のエージェント数は 5 になる。
9. A2-12 の grep は `plugins/gh-utility` 配下の全体を対象にするので、M2-T07b が新設する `plugins/gh-utility/docs/format-change-checklist.md` にも codiel の名前を書けない。追随の相手は名前を出さずに特定できる書き方(同じ規則を独立に持つプラグインの `references/github-writing.md`)で書く。
10. M1-T01 の報告で、指定行の外に「3 実装」「3 プラグイン」のコメントが残っていた(`plugins/codiel/src/hooks/guard-write.ts:28,44`、`plugins/codiel/src/hooks/__test__/lib.test.ts:79`)。`guard-write.ts` は M2-T04、`lib.test.ts` は M4-T02 の依頼文に含めて直す。
11. ユーザー決定(2026-09-27): `plugins/codiel/evals/`(旧 sandalphon から移した `capturing-intent.json` の 1 ファイル)を削除する。codiel のスキルはすべてオーケストレーターが名指しで起動するので、description の発火率を測る evals は要らない。設計書 §6.9.4・§7.1・§11.1 の「evals を移して改修後の手順に合わせる」はこの決定で置き換わる。M2-T09 は evals を 20 問のうち 2 問のラベルを変えて更新したが(true 12 / false 8)、M2-C の M2-T12c が削除する。同じ理由で、capturing-intent の description の長さ(839 バイト)は縮めない。
12. ユーザー決定(2026-09-27): codiel の全スキルの description を実態に合わせて書き直し、形を「Codiel の <フェーズ> フェーズで、<担い手> が <入力> から <出力> を<動作>ときに使う。<起動元> が名指しで起動する。」に揃える。「〜したくなる場面でこそ必ず使用する」の句は入れない。対象は codiel のスキルだけで、commands と Agent は含めない。スキル本文の改修がすべて終わる M4 に M4-T07 として足す。根拠: HEAD `9f031f1e` で全スキルの参照元を数えた結果、description の照合で起動されるスキルは無く、どれもコマンド・orchestrating-runs の手順・依頼文テンプレートの SKILL.md の絶対パス・ほかのスキルと Agent 定義の本文から名前かパスで起動される。description は、run の外での誤発火を防ぐ役に立つ。
13. ユーザー決定(2026-09-27): 同梱 Agent `codiel-test-designer` を廃止する(ADR-004 の撤去と同じ型)。test-spec の委譲は名指しをやめて成果物を書く委譲にし、Agent 定義の tools の制約(Bash 無し、書くのは `.codiel/specs/<unit-id>/` の spec.md と cases.md だけ)は依頼文と `writing-test-specs` の HARD-GATE で表す。設計書 §6.1.1 の表の test-spec の行(名指し `codiel-test-designer`)と、§3.6・§10 の「残る同梱 Agent を `codiel-test-designer` の 1 体とする」はこの決定で置き換わる。O2-5 の新 ADR は「同梱 Agent を持たない」を内容とする。M2-D の M2-T15 が行う。
14. ユーザー決定(2026-09-27): `plugins/codiel/CLAUDE.example.md` を、metatron への分離後と intent 駆動化後の実態に合わせて最新化する。見出し「文書の扱い」は残す(A5-3)。M2-D の M2-T16 が行う。
15. ユーザー決定(2026-09-27): codiel の `recording-gotchas` スキルを削除し、GOTCHAS の記録は metatron の `metatron:recording-gotchas` に委ねる。codiel の skill は metatron の書式契約(記録の判断・5 フィールド・採番・挿入位置・タグ)の写しが大半で、二重管理になっていた。codiel に残すのは、記録の契機 4 つ(Raguel の STOP、ループ上限超過、incident、レビューで発覚した設計漏れ)と、metatron の CLI の案内が無いときの退避(未記録の GOTCHAS)だけで、orchestrating-runs の「失敗の記録」のセクションに置く。設計書 §6.10.1 の「GOTCHAS への記録」の行の「定める箇所」は orchestrating-runs に移り、A5-3 の grep の対象も `plugins/codiel/skills/orchestrating-runs/SKILL.md` になる。M2-D の M2-T15 が行う。
16. M2C-G の取り残しの grep(`--issue`)が、`codiel-state init` の任意の引数 `[--issue <N>]`(Issue を入口にしたときの記録。設計書 §6.2.2)を誤検出して止まった。grep から `codiel-state init` の行を除いてゲートをやり直した。
17. M2-T10 と M2-T09 が、check-intent-env の呼び出しと連携モード・imageUpload・adrTarget の判定を、orchestrating-runs の §0 と capturing-intent の手順 1 の 2 か所に書いた。M2-D の M2-T17 が、正本を orchestrating-runs の §0 にし、capturing-intent からは参照する形にまとめる。

---

## 10. 未決事項

1. Workflow の `agent()` が委譲先の Agent 定義(役割マーカーで選ぶ定義)を指定できるか。指定できないときは、依頼文に委譲先の種類を書くだけになり、モデルの割り当てが役割どおりにならない。実装セッションが `workflow-authoring` で確かめ、指定できなければユーザーに扱いを確かめる。
2. §2 と §6.2 の CLI の形(`next-adr-candidate-id`、`step-add --kind unit`、JSON 配列での受け渡し)、metatron の実装の置き場、gh-utility の執筆規則を既存の `github-issue-common.md` に足すことは、本書が決めた(technical-adviser の助言で確かめた)ものである。ユーザーレビューで変えてよい。
3. O2-4 の local モードの手動確認に使う「`origin` を持たない一時のリポジトリ」の作り方(このリポジトリの clone からリモートを外すか、別の小さなリポジトリにするか)は、実行時にユーザーと決める。

---

## 11. Done 条件

各マイルストーンの終点で次をすべて満たしてから、次のマイルストーンへ進む。

- `pnpm run lint`・`pnpm run typecheck`・`pnpm run test`・`pnpm run build` がすべて通る。
- `plugins/*/src/` を変えたコミットに、同じプラグインの `plugins/*/scripts/` の差分がある。
- 改修したプラグインの `plugin.json` と `package.json` のバージョンが、§7 の値で揃っている。
- ルートの `README.md` に反映されている(O1-3、O2-8、O3-5、O4-4)。
- ARCHITECTURE に影響する変更を `/metatron:update` で追随させている(O1-8、O2-6、O3-3、O4-2)。
- `.serena/memories/` の食い違いを直している(O1-4、O2-7、O3-4、O4-3)。
- そのマイルストーンの受け入れ基準(§8.2)がすべて YES である。
- レビューの critical / high が残っていない。
- `git status --short` に、本改修の未コミットの変更が残っていない。

## 12. 不採用案

| 案 | 採らない理由 |
| --- | --- |
| マイルストーンごとに 1 本の Workflow にまとめる | M2 はタスクが 16 あり、エージェント 10 未満の目安を超える |
| 各タスクのエージェントが自分の変更をコミットする | 同じ作業ツリーで並列にコミットすると `index.lock` で衝突する |
| タスク単位でコミットを分ける | バンドルが `codiel-state` を各 hook の `.mjs` にインラインするので、`scripts/` の差分をタスクごとに割れない |
| 並列タスクが型検査と lint を実行する | `tsconfig.json` の include がリポジトリ全体で、隣の書きかけのファイルで失敗する |
| タスクごとに git worktree を切って並列に実装する | 本改修の並列は最大 5 で、触るファイルを分ければ衝突しない。worktree のマージと後始末の手間が増える |
| 手動確認や ADR の起票を Workflow のエージェントに任せる | エージェントはユーザーと対話できず、metatron の ADR の手順は草案の承認を要する |
| guard-bash と guard-github-mcp でマーカーの検査関数を共有する | 検査は文字列の包含の 1 行で済み、共有すると `lib.ts` を 2 タスクが同時に触る |
