# codiel を intent 駆動へ改造し、sandalphon を吸収する 実装計画書

- 作成日: 2026-09-27
- 状態: 計画(第 3 版)・承認済み(2026-09-27)・M4 の組み直し(2026-09-28。設計書の決定 72〜79)・M4 の見直し(2026-09-28。決定 80・81)・M4-A の記録と M4-B の追補(2026-09-28。決定 82)・M4-B の前の見直し(2026-09-28。決定 83)・M4 の追補 M4-C(2026-09-29。決定 84〜109)
- 設計書(正本): `harness-docs/design/2026-09-27-codiel-intent-driven-design.md`(第 9 版、決定 53 件、コミット `00fb6ae8`)。M4-C は決定 109 までの追補(`ce236284`)に従う
- 対象プラグイン: `plugins/codiel`(主)、`plugins/sandalphon`(撤去)、`plugins/metatron`、`plugins/gh-utility`
- バージョン: codiel `0.9.0-dev` → M1〜M3 の終点 `1.0.0-dev` → M4 の終点 `1.0.0`。metatron `0.3.10-dev` → M1 の終点 `0.3.11-dev` → M3 の終点 `0.4.0-dev`。gh-utility `0.5.2-dev` → M2 の終点 `0.5.3-dev`。M4-C では codiel を `1.0.0`、metatron を `0.4.0-dev` のまま据え置く
- Workflow 実行: 13 本(M1 が 1 本、M2 が 4 本、M3 が 2 本、M4 が 3 本、M4-C が 3 本)
- 改訂履歴: 第 2 版で、反証レビューと暗黙知レビューの採用分(オーケストレーター決定)を反映した。主な変更は、並列タスクで型検査と lint を実行しないこと、コミットをゲートとプラグインの単位にしたこと、DESIGN.md の終了状態の修正を M1 の最初へ移したこと、`issue.md` の取り残しを M2 の対象に加えたこと、hooks.json の発火確認を M2-B の前の条件にしたことである。第 3 版で、テスト run を受けたユーザー決定(設計書の決定 72〜79)に合わせて M4 を 2 本の Workflow に組み直した(§6)。同じ日の見直しで、E2E を implement で通すこと、test-loop の修正の委譲の並べ方、新しい画面の名前をユーザーに聞くこと(設計書の決定 80・81 と決定 30 の改め)を M4-B のタスクに入れた(§9.4 の 33)。続く見直しで、テストを実行する委譲の並べ方、環境の失敗の扱い、M4 より前の state の止め方を M4 のタスクに入れた(§9.4 の 33)。その後の見直しで、M4 より前の state を CLI が拒む形と、新しい try での intent の持ち込み(M4-T13)を入れた(§9.4 の 33)。M4-A の後に、確定した CLI と hook を §9.3 に記録し、決定 82 の M4-T14・guard-github-mcp の M4-T15・画面を持つサンプルでの手動確認(O4-6・O4-7)を足した(§9.4 の 34)。M4-B の前の見直しで、Raguel の応急処置(設計書の決定 83)の M4-T16 と M4-T15 の追補、intent の表の書式、`findMainRoot` の改め、レビューの Workflow の分離、O3-1 の結果と O4-8 を入れた(§9.4 の 35)。手動確認 O4-1・O4-7・O4-8 の結果を §9.3 に記録し、それを受けた設計書の追補(決定 84〜109)を入れる M4-C(§6.6〜§6.8)を足した(§9.4 の 37)

この計画書は、設計書をタスク・順序・検証方法へ分けるだけで、設計判断を上書きしない。設計書と実コードの食い違いを見つけたタスクは、作業を止めて `status: blocked` で報告する。オーケストレーターは報告を §9.3 へ追記し、設計書を直すかをユーザーに確かめる。

---

## 0. 前提

### 0.1 実装は別セッションで Dynamic Workflow を使う

実装セッションは次の性質を前提に Workflow スクリプトを組む。スクリプトを書く前に `workflow-authoring` スキルを読み、関数の引数の形はそのスキルで確かめる。

- スクリプトは `export const meta = { name, description, phases }` と、`phase()`・`agent(prompt, { label, phase, schema })`・`parallel()`・`pipeline()` で組む。
- 各 `agent()` はサブエージェントであり、ユーザーと対話できない。判断が要る事態では `status: blocked` を返して終わる。
- 完了したエージェントの結果は `resumeFromRunId` で再利用できる。
- 1 Workflow あたりのエージェント数は 10 未満を目安にする(ユーザーが引き上げられる)。目安であり上限ではない。`codiel-m4b-tdd-skills`(§6.1.3)は 10 で目安を 1 超えるが、オーケストレーターが受け入れた(§10 の 8)。ほかの Workflow は 9 以下に収めた。
- ユーザーの手作業と metatron の対話的な手順は Workflow の中に入れない。Workflow 実行の合間に、オーケストレーター(メインセッション)が §3.0・§3.4・§4.1.1・§4.4・§4.6・§5.3・§6.0・§6.1.2・§6.5・§6.6.1・§6.6.3・§6.8 の手順で行う。
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

- `plugins/codiel/raguel-mcp/` を変えない。例外は M4-T16 の応急処置(設計書 §6.14.1、決定 83)と、M4C-T05 の設定の読み込み先の変更(設計書 §6.15.1、決定 88。`package.json` の依存から `yaml` を除くことを含む)だけで、`raguel-mcp/src/` を変え、`raguel-mcp/dist/` はゲートのビルドで作り直す。
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
- バージョンは変えない(ゲートが上げる)。規則は次のとおり。codiel は M1〜M3 の終点で 1.0.0-dev、M4 の終点で 1.0.0。metatron は M1 の終点で 0.3.11-dev、M3 の終点で 0.4.0-dev。gh-utility は M2 の終点で 0.5.3-dev。M4-C では codiel を 1.0.0、metatron を 0.4.0-dev のまま据え置く。raguel-mcp の package.json は変えない(例外は M4C-T05 が dependencies から yaml を除くことだけで、version は変えない)。
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
| final-review | M4 の終わりの、M1〜M4 全体の最終レビューと、M4-C の差分を決定 84〜109 に照らす最終レビュー(読み取りだけ) |

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
| test-code と test-loop の worktree の型 | `implement.steps` と同じ型を使い、`testCode.units` と `testLoop.units` に分けて持つ。キーは仕様のディレクトリの ID(設計書 §6.13.3)。M4-T01 が `testLoop.units` と `step-add --kind unit` を実装した。M4-T09 が `--kind` を `step` / `test-code` / `test-loop` に改めて `testCode.units` を足し、ID の検査を入れる。分担は §6.2 の表にある |
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
| O2-5 | 新 ADR を起票する。ADR-004 のうち「同梱 Agent を 2 体に絞る」部分を上書きし、codiel が同梱 Agent を持たないとする(§9.4 の 13)。`metatron:updating-architecture` スキルを起動して行い、`stage-adr` → `commit-architecture` を直接呼ぶ手順で代えない | オーケストレーターとユーザー(対話) | ARCHITECTURE に新しい ADR があり、ADR-004 の本文が変わっていない |
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

## 6. M4 並列化とテスト駆動

終点の受け入れ基準は A4-1〜A4-4、A6-1〜A6-29 と、A5-3 の `writing-dev-plans` と `scripting-tests` の行である。

### 6.0 組み直しの前に終えた作業

最初の Workflow `codiel-m4-parallel`(base `7b4b3bd6`)で次の 4 タスクが完了し、変更は未コミットのままメインの作業ツリーにある。M4-T02 と M4-T04 は開始の直後に止め、書きかけは無い。止めた後に HEAD は `62d78e67`(ADR-007。`harness-docs/ARCHITECTURE.md` だけを変えた)と `88c0474a`(`plugins/metatron/references/writing-discipline.md` の 1 行)へ進んだが、どちらも 4 タスクの変更とは重ならない。

| タスク | 未コミットの変更 | 完了条件にした受け入れ基準 | コミット | 組み直し後の扱い |
| --- | --- | --- | --- | --- |
| M4-T01 `implement.steps`・`testLoop.units`・`waves` | `plugins/codiel/src/codiel-state.ts`、`plugins/codiel/src/__test__/codiel-state.test.ts` | A4-2 | C4A-1 | M4-T09 が §6.2 の表の「M4-T09」の列を足し、A4-2 を判定し直す。型・遷移・`waves`・lockfile の一覧・重なりの判定はそのまま使う |
| M4-T03 dev-plan と test-spec の書式 | `plugins/codiel/skills/{writing-dev-plans,writing-test-specs}/SKILL.md` | A4-1、A4-4、A5-3 の `writing-dev-plans` の行 | C4A-1 | M4-T11 が「通すテスト」と仕様の置き場を足し、3 つの基準を判定し直す。`## 環境準備`・`## 生成物`・`parallel` はそのまま使う |
| M4-T05 worktree の中で作業するスキル | `plugins/codiel/skills/{implementing,scripting-tests,running-regression-tests}/SKILL.md` | なし(完了条件は grep だけ) | C4A-1 | M4-T12 が test-code と test-loop の手順に書き直す。implementing の worktree と `report.md` の記述はそのまま使う |
| M4-T08 metatron の縮約の拒否の経路のテスト | `plugins/metatron/src/lib/__test__/adr-candidates.test.ts` | なし(M3-R の medium に応えるテスト) | C4A-0 | 変えない |

- 組み直し後の M4-A は、この作業ツリーから始め、4 タスクを再実行しない。
- M4-A のタスクは、4 タスクの未コミットの変更の上で編集する。M4A-G が、4 タスクの変更を M4-A の変更と合わせて表の「コミット」の列のとおりにコミットする(§7.4)。
- M4-B は M4A-G のコミットの後に始まるので、M4-B のタスクはコミット済みの変更の上で編集する。
- 4 タスクの完了条件は決定 72〜79 より前に決めたもので、A6 の基準を含まない。A6 は M4-A と M4-B のタスクが満たす(§8.2)。

M4-A の前に、オーケストレーターが次の手順を行う。

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O4A-0 | 設計書と計画書の組み直しの変更を、2 ファイルだけの docs のコミットにする。続けて `git status --short` の未コミットの変更が、上の表の 8 ファイルと `docs/chat/` だけであることを確かめ、HEAD を M4 の起点として §9.3 に記録する | オーケストレーター | `git status --short` に上の表の 8 ファイルと `docs/chat/` のほかが無い。§9.3 に起点の HEAD がある |

### 6.1 Workflow の構成

M4 を 3 本の Workflow に分ける。state・hook・init のコードを M4-A で固めてコミットし、M4-B のスキルは M4-A で確定した CLI を §9.3 の記録から参照する。M4-B の実装とゲートを `codiel-m4b-tdd-skills` で、M4 のレビューを `codiel-m4b-review` で行う。

#### 6.1.1 Workflow `codiel-m4a-tdd-code`

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `state` | M4-T09 | 直列 | 1 |
| 2 `hooks-init` | M4-T02、M4-T10 | `parallel`(M4-T02 は M4-T09 に依存) | 2 |
| 3 `gate` | M4A-G | 直列 | 1 |

エージェント数は 4 である。

#### 6.1.2 M4-A の後のオーケストレーターの手順

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O4A-1 | M4-T09 と M4-T02 の報告から、CLI(`step-add` / `step-update` の `--kind` と ID、`config`、`set-test-edit` / `clear-test-edit`)の引数と出力の形、設定を読む関数の名前とシグネチャ、guard-write の ask の理由文を §9.3 に記録する | オーケストレーター | M4-B の依頼文の「前の Workflow で確定した事項」に入れる。記録済み(2026-09-28。§9.3 の O4A-1 の行) |

#### 6.1.3 Workflow `codiel-m4b-tdd-skills`

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `skills-code` | M4-T11、M4-T12、M4-T13、M4-T14、M4-T15、M4-T16 | `parallel` | 6 |
| 2 `orchestrate` | M4-T04 | 直列(M4-T11〜T14 に依存) | 1 |
| 3 `docs` | M4-T06、M4-T07 | `parallel`(どちらも M4-T04 に依存) | 2 |
| 4 `gate` | M4B-G | 直列 | 1 |

エージェント数は 10 で、§0.1 の目安(10 未満)を 1 超える。レビューは `codiel-m4b-review`(§6.1.4)に分けたが、決定 83 の Raguel の応急処置の M4-T16 を足したためである。目安は上限ではないので、オーケストレーターが受け入れた(§10 の 8)。phase 1 の 6 タスクは触るファイルが重ならない。codiel 側の CLI と hook の変更(STOP の裁定、次の try の承認、stop-guard の理由文、`findMainRoot`)は、エージェントを増やさないよう M4-T15 にまとめた。

#### 6.1.4 Workflow `codiel-m4b-review`

`codiel-m4b-tdd-skills` の M4B-G がコミットまで終えてから始める。

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `review` | M4-R、M4-FR | `parallel` | 2 |

エージェント数は 2 である。critical・high があれば、M4 の修正の Workflow(`codiel-m4-fix`)で直し、ゲートをやり直してから §6.5 へ進む(§9.2)。

### 6.2 `implement.steps`・`testCode.units`・`testLoop.units` の型と遷移(確定)

設計書 §6.6.5 が必須とするフィールドを、次の型で持つ。型は実装の目安であり、名前を変えるときはタスクの報告に書く。

```ts
type StepStatus = "pending" | "running" | "reviewing" | "merged" | "failed"
interface StepState {
  status: StepStatus
  files: string[]                 // 触るファイル(repoRoot 相対の glob)。test-code と test-loop では空配列でよい
  deps: string[]                  // 前提ステップ。test-code と test-loop では常に空配列
  final: boolean                  // 方式 b の最終ステップ。test-code と test-loop では常に false
  group: { index: number; mode: "parallel" | "serial" | "final" } | null  // test-code と test-loop では常に null
  worktree: string | null         // repoRoot 相対のパス
  branch: string | null
  commits: { base: string | null; head: string | null }
  attempts: number                // 修正ラウンド数。phases[phase].attempts とは別
  domain: string | null
}
// RunState に任意フィールドとして足す。version は 2 のまま
implement?: { steps: Record<string, StepState> }
testCode?: { units: Record<string, StepState> }   // キーは仕様のディレクトリの ID
testLoop?: { units: Record<string, StepState> }   // キーは仕様のディレクトリの ID
testEdit?: boolean
```

遷移は次のとおりとし、CLI が検証する。表に無い遷移は非ゼロで終了する。3 つの表に同じ遷移を当てる。例外は、`testLoop.units` の `merged` の要素を `step-add` で登録し直せること(test-loop の次の巡の修正。設計書 §6.7)である。

| 現在 | 次 | 契機 |
| --- | --- | --- |
| `pending` | `running` | worktree を作って委譲した(`--worktree`・`--branch`・`--base` を記録) |
| `running` | `reviewing` | 委譲先の報告を受けた |
| `reviewing` | `running` | タスクレビューの所見で修正ラウンドに入った(`attempts` を 1 増やす) |
| `reviewing` | `merged` | run ブランチへマージした(`--head` を記録) |
| `running` / `reviewing` | `failed` | マージの衝突、5 ラウンドで通らなかった、または test-code の委譲先が「cases.md の誤り」を報告した |
| `failed` | `pending` | やり直しの前に worktree とブランチを削除した(`worktree`・`branch`・`commits` を `null` に戻す) |

M4-T01 が実装した範囲と、M4-T09 が足す範囲は次のとおりである。

| 項目 | M4-T01(完了) | M4-T09 |
| --- | --- | --- |
| `StepState` の型と遷移の表 | 実装した | 変えない |
| `implement.steps` と `--kind step` | 実装した | 変えない |
| `testLoop.units` | `--kind unit` で登録する。`--files` は必須、ID は英小文字のケバブケース | `--kind test-loop` に改め、`unit` は受け付けない。ID を仕様のディレクトリの形で検査し、`--files` を任意にし、`merged` からの登録し直しを許す |
| `testCode.units` | なし | `--kind test-code` で足す。ID と `--files` の扱いは test-loop と同じ。`merged` からの登録し直しは許さない |
| `waves` | `implement.steps` だけを対象に実装した | 変えない。test-code と test-loop の要素を出さないことのテストを足す |
| `step-update --worktree` の一意性 | なし | ほかの要素(3 つの表のすべて)がすでに記録したパスを拒否する |
| `STAGES`・`GATED`・`phases` に test-code を持たない state の拒否・`config`・`testEdit` | なし | 足す |

CLI は次のとおりである。

- `step-add --slug <slug> --id <ID> [--kind step|test-code|test-loop] [--files '<JSON 配列>'] [--deps '<JSON 配列>'] [--final] [--domain <名前>]`。`--kind` の既定は `step`。glob に `{a,b}` のカンマが入るので、配列は JSON で渡す。`step` の ID は現行の形(英小文字と数字のケバブケース)、`test-code` と `test-loop` の ID は設計書 §6.13.3 の形で検査する。`--files` は `step` のときだけ必須とし、`--deps` と `--final` は `step` のときだけ受け付ける。
- `step-update --slug <slug> --id <ID> [--kind step|test-code|test-loop] --status <状態> [--worktree <パス>] [--branch <名前>] [--base <sha>] [--head <sha>]`。`reviewing` から `running` への遷移で `attempts` を 1 増やす。
- `waves --slug <slug>`。`implement.steps` だけを対象に、設計書 §6.6.2 の出力を stdout に出し、各ステップの `group` を記録する。
- `config`。`.codiel/config.json` を読み、`{ "testsDir": "<値>" }` を stdout に出す。run を要しない(設計書 §6.13.4)。
- `set-test-edit --slug <slug>` と `clear-test-edit --slug <slug>`(設計書 §6.13.6)。
- `--final` は値を取らないので、`main` の冒頭で `--active` と `--human-approved` を取り除く処理に加える(M4-T01 で済み)。
- `phases` に test-code を持たない v2 の state は、v1 の state と同じ箇所(`loadRun`・`get --active`・`findActiveRun`・`record-outcome`)で判定し、v1 と同じコマンドだけを受け付ける。文言は設計書 §6.6 の冒頭のテンプレートを使う。読み込み時に補わない。

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

- 状態: 完了(`codiel-m4-parallel`。変更は未コミット)
- 内容: §6.2 の型・遷移・CLI のうち「M4-T01」の列、§6.3 の lockfile の一覧、設計書 §6.6.2 のグループ分けと重なりの判定。設計書 §8.2 の「`implement.steps`」の行のテストを置く。
- 触るファイル: `plugins/codiel/src/codiel-state.ts`、`plugins/codiel/src/__test__/codiel-state.test.ts`
- ドメイン: impl
- 依存: なし
- 完了条件: A4-2。`pnpm exec vitest run plugins/codiel/src/__test__/codiel-state.test.ts` が通る
- 委譲先: complex-impl
- スキル: なし

#### M4-T03 dev-plan と test-spec の書式

- 状態: 完了(`codiel-m4-parallel`。変更は未コミット)
- 内容: 設計書 §6.6.1(触るファイル、前提ステップ、`## 環境準備`、`## 生成物`、方式 a / b の選び方と規約の読み先、方式 b の既定)と §6.7 の `spec.md` の frontmatter。§6.3 の既定のインストールコマンドの表を `writing-dev-plans` に載せる。§6.10.1 の rules の行の縮退先(規約が無ければ方式 b)を書く。
- 触るファイル: `plugins/codiel/skills/{writing-dev-plans,writing-test-specs}/SKILL.md`
- ドメイン: prompt
- 依存: なし
- 完了条件: A4-1、A4-4、A5-3 の `writing-dev-plans` の行
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4-T05 worktree の中で作業するスキル

- 状態: 完了(`codiel-m4-parallel`。変更は未コミット)
- 内容: 設計書 §6.9.1 の `implementing`(worktree 内の依存のインストール、生成物の方式、`report.md`、`codiel-state` を呼ばない)と、`scripting-tests`・`running-regression-tests`(第 2 版の §6.7。unit の worktree、`parallel: true` の unit だけを同時に実行する)。後者の 2 つは M4-T12 が書き直す。
- 触るファイル: `plugins/codiel/skills/{implementing,scripting-tests,running-regression-tests}/SKILL.md`
- ドメイン: prompt
- 依存: なし
- 完了条件: `grep -n "report.md" plugins/codiel/skills/implementing/SKILL.md` と `grep -n "parallel: true" plugins/codiel/skills/running-regression-tests/SKILL.md` が各 1 件以上
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4-T08 metatron の縮約の拒否の経路のテスト

- 状態: 完了(`codiel-m4-parallel`。変更は未コミット)
- 内容: M3-R の medium(§9.4 の 31)に応え、`shrink-adr-candidate` の拒否の経路 `not_git_repository`・`file_not_found`・`candidate_not_found`・`duplicate_candidate` のテストを足す。実装は変えない。
- 触るファイル: `plugins/metatron/src/lib/__test__/adr-candidates.test.ts`
- ドメイン: impl
- 依存: なし
- 完了条件: `pnpm exec vitest run plugins/metatron/src/lib/__test__/adr-candidates.test.ts` が通る。4 つの理由のテストがそれぞれ、対象のファイルがバイト単位で変わらないことを確かめる
- 委譲先: normal-impl
- スキル: なし

#### M4-T09 テスト駆動のフェーズと設定の CLI

- 状態: 完了(`codiel-m4a-tdd-code`。C4A-1 `508601b7`)
- 内容: M4-T01 の実装を土台に、§6.2 の表の「M4-T09」の列を実装する。設計書 §6.1.1 の `STAGES` と `GATED` に test-code を足す。`step-add` / `step-update` の `--kind` を `step` / `test-code` / `test-loop` にし、`testCode.units` を足し、ID を設計書 §6.13.3 の形で検査する。`testLoop.units` の `merged` からの登録し直しと、`step-update --worktree` の一意性の検査を足す。`testEdit`・`config`・`set-test-edit` / `clear-test-edit` と、設計書 §6.6 の冒頭の `phases` に test-code を持たない state の扱い(§6.2 の CLI の最後の項目)を実装する。v1 の state を判定している箇所に同じ判定を足し、文言だけを state の形で出し分ける。`stop` の `--reason` の値は検査しない。設定の読み取りは `codiel-state.ts` の 1 つの関数にして export し、`.codiel` を持つディレクトリを引数に取る形にする。M4-T02 の guard-write がこの関数を使う(設計書 §6.13.4)。設計書 §8.2 の「テスト駆動のフェーズ」「M4 より前の state」「`config`」「仕様のディレクトリの登録」「`testEdit`」の行のテストを置き、M4-T01 の `--kind unit` のテストを `--kind test-loop` に改める。`.codiel/specs` を値に使っているテスト(`codiel-state.test.ts:203`、`:1686`)の値を置き換える。
- 触るファイル: `plugins/codiel/src/codiel-state.ts`、`plugins/codiel/src/__test__/codiel-state.test.ts`(`codiel-state-cli.ts` はエントリの登録が要るときだけ)
- ドメイン: impl
- 依存: O4A-0。M4-T01 の未コミットの変更の上で編集し、コミットしない(§6.0)
- 完了条件: A4-2、A6-1、A6-2、A6-5、A6-6、A6-18 のテストの部分。`pnpm exec vitest run plugins/codiel/src/__test__/codiel-state.test.ts` が通る。`grep -n "\.codiel/specs" plugins/codiel/src/__test__/codiel-state.test.ts` が 0 件。報告の notes に、CLI の引数と出力の形、設定を読む関数の名前とシグネチャを書く
- 委譲先: complex-impl
- スキル: なし

#### M4-T02 hook の worktree 対応とテストの保護

- 状態: 完了(`codiel-m4a-tdd-code`。C4A-1 `508601b7`)
- 内容: 第 2 版の内容(設計書 §6.8 の (a)〜(c)、guard-bash と stop-guard のルートの変更)に、次を加える。(c) の要素は、worktree の名前を読まず、3 つの表の `worktree` の記録との一致で引き、一致が 2 つ以上なら ask を返す。設計書 §6.13.6 のテストの保護(対象、フェーズ、`testEdit`、判定の基準、`<testsDir>/**/spec.md` の `tests` の読み取り、理由文)と、文書フェーズで `<testsDir>/` を通す規則と、`CODE_PHASES` に test-code を加えることを実装する。testsDir は M4-T09 の関数で読み、不正な値のときは設計書 §6.13.4 のとおりに扱う。`guard-write.ts` の「test-designer の担当です」の文言と、`:184` の `.codiel/specs/**/scripts/` のコメントを改める。`lib.test.ts:79` のコメント(§9.4 の 10)を直す。設計書 §8.2 の W-1〜W-7 と P-1〜P-11 のテストを置き、`.codiel/specs` を値に使っているテストの値を置き換える。M2 で入れた規則(`docs/intents/**`、`state.intent` の照合、guard-bash の字句解析とマーカーの検査、stop-guard の理由文の分岐)を保つ。
- 触るファイル: `plugins/codiel/src/hooks/{lib,guard-write,guard-bash,stop-guard}.ts`、`plugins/codiel/src/hooks/__test__/{lib,guard-write,guard-bash,stop-guard}.test.ts`
- ドメイン: impl
- 依存: M4-T09
- 完了条件: A4-3、A6-4。`pnpm exec vitest run plugins/codiel/src/hooks` が通る。`grep -rn "test-designer" plugins/codiel/src` と `grep -rn "\.codiel/specs" plugins/codiel/src/hooks` が 0 件。`grep -n "resolveDocPaths" plugins/codiel/src/hooks/lib.ts` が 1 件以上(A5-3)
- 委譲先: complex-impl
- スキル: なし

#### M4-T10 `/codiel:init` の設定ファイル

- 状態: 完了(`codiel-m4a-tdd-code`。C4A-1 `508601b7`)
- 内容: 設計書 §6.13.4 のとおり、`install-harness.sh` が `.codiel/specs` を作らず、`.codiel/config.json` が無ければ `{ "testsDir": "docs/tests" }` で作り、あれば変えないようにする。`install-harness.test.ts` を合わせる。`initializing-harness/SKILL.md` の §0 の D(`.codiel/runs`・`.codiel/reports`・`.codiel/config.json` の 3 つが存在する)と §1 の記述を改める。description は変えない(M4-T07 が行う)。`install-harness.sh` は保護パスの例外で、直接編集してよい。
- 触るファイル: `plugins/codiel/scripts/install-harness.sh`、`plugins/codiel/src/__test__/install-harness.test.ts`、`plugins/codiel/skills/initializing-harness/SKILL.md`
- ドメイン: impl
- 依存: なし
- 完了条件: A6-3。`pnpm exec vitest run plugins/codiel/src/__test__/install-harness.test.ts` と `pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る。3 ファイルで `grep -n "\.codiel/specs"` が 0 件
- 委譲先: normal-impl
- スキル: `prompt-smith:prompt-smith`

#### M4A-G ゲート

- 状態: 完了(C4A-0 `8f89bd45`、C4A-1 `508601b7`。§9.3 の O4A-1 の行)
- 内容: lint・typecheck・test・build を実行する。コミットの前に `git status --short` を見て、未コミットの変更が §6.0 の表の 8 ファイル、M4-A のタスクの触るファイル、ビルドが再生成した `plugins/codiel/scripts/`、`docs/chat/` に限られることを確かめる。ほかの変更があれば、コミットせずに blocked で報告する。C4A-0(M4-T08)と C4A-1(codiel の `src/`・`scripts/`・`install-harness.sh`・`initializing-harness`、M4-T03 と M4-T05 のスキルの変更)を §7.4 のとおりコミットする。バージョンは上げない。
- 完了条件: 4 コマンドの終了コードが 0。A5-1、A5-2。`git status --short` に `docs/chat/` 以外の変更が残らない
- 委譲先: light-impl

#### M4-T11 テストの仕様・設計・dev-plan のスキルと、画面名の確認

- 内容: 次の 4 スキルの本文を改める。description は変えない(M4-T07 が行う)。testsDir は依頼文で渡される値を使うと書く。
  - `writing-test-specs`: 設計書 §6.13.3 の命名と置き場(`<testsDir>/<ID>/`。`e2e/cli`、`{id}`、`_root` を含む)、作る仕様の規則(決定 78・79。正本はこのスキル)、画面名の決め方(既にある画面は名前を使い、新しい画面は名前の候補を 2〜3 個出す。決定 81)、frontmatter の `tests` を書かず既存の値を保つ規則、HARD-GATE の書き込み先の変更、`scripts/` と `screen-*` などの旧命名の削除を入れる。仕様のディレクトリは渡された一覧(標準では `design.md`、軽量では依頼文)だけを使い、一覧に無い仕様のディレクトリは作らずに報告する規則を入れ、現行の「本フェーズで新規に命名する」の記述を除く。軽量の run で仕様のディレクトリを同定する委譲の手順(設計書 §6.1.4 の手順 1。読み取りだけで、一覧と新しい画面の名前の候補を返し、ファイルを書かない)をセクションとして足す。M4-T03 の `parallel` の記述を保ち、`parallel: true` が効く範囲を「test-loop で同時に実行される」から、test-code・implement・test-loop・`/codiel:test` でほかのテストと同時に実行されうる形に改める(設計書 §6.7、§6.13.1)。
  - `writing-design-docs`: `## 影響を受ける機能単位` を仕様のディレクトリの ID で列挙する形にし、作る仕様の規則は `writing-test-specs` を参照させる。既にある画面は `<testsDir>/e2e/frontend/` の名前を使い、新しい画面の行は ID の代わりに名前の候補を書いて報告に挙げ、決まった名前を渡されたら候補の行を ID に書き換える手順と、候補の行の書式を入れる(設計書 §6.13.3)。
  - `writing-dev-plans`: 「ユニットテスト」を「通すテスト」に替え、通すテストの定義(そのステップと前提ステップが終わった時点で通るもの)、全仕様のディレクトリ(ユニットと E2E)の割り当てと「E2E を除外しない」の文、検証コマンドを通すテストに絞る規則を入れる(設計書 §6.13.1、決定 80)。軽量の run では、仕様のディレクトリを自分で同定せず、依頼文の一覧を使うと書く(設計書 §6.1.4)。
  - `facilitating-design-discussions`: 設計ウォークスルーに、`design.md` の新しい画面ごとに名前の候補を示して AskUserQuestion で聞く手順、候補の外の答えをケバブケースの 1 セグメントに直して確かめる手順、決まった名前を修正の要望として design の委譲をやり直させる手順、名前の候補が残る `design.md` でゲートへ進まない規則を足す(設計書 §6.13.3)。待機は既存の `mark-ask design --kind confirm` を使う。
- 触るファイル: `plugins/codiel/skills/{writing-test-specs,writing-design-docs,writing-dev-plans,facilitating-design-discussions}/SKILL.md`
- ドメイン: prompt
- 依存: なし
- 完了条件: A4-1、A4-4、A6-8、A6-11、A5-3 の `writing-dev-plans` の行。A6-14 の `writing-dev-plans` の部分と、A6-16 の `writing-design-docs`・`writing-test-specs`・`facilitating-design-discussions` の部分。4 ファイルで `grep -n "\.codiel/specs"` が 0 件。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4-T12 test-code・test-loop・implement のスキル

- 内容: `scripting-tests` を test-code フェーズの委譲先の手順(設計書 §6.13.2、§6.13.5。置き場の決め方、`tests` の記録、Red の確認と「cases.md の誤り」の報告)に書き直す。`running-regression-tests` を test-loop と `/codiel:test` の手順(設計書 §6.7。全テストの回帰の確認)に書き直し、スクリプト安定化(Step A)の手順を除く。修正の委譲を出すのはオーケストレーターなので、修正の委譲の並べ方(設計書 §6.13.1)はこのスキルに書かず、`orchestrating-runs` の test-loop の運転に任せる。M4-T05 が書いた NG 修正の委譲の記述(`running-regression-tests/SKILL.md:50-51`)は除き、回帰の実行の同時実行の規則だけを残す。`implementing` から RED の手順を除き、「通すテスト」を通すことと、テストと仕様を書き換えない HARD-GATE を入れる(設計書 §6.13.1、§6.13.6)。`implementing` には、brief(`serial` グループと `final` では依頼文)が挙げた通すテスト(E2E を含む)を実行し、実行しなかった通すテストを `report.md` に挙げる手順も入れる(決定 80)。`fixing-failures` の「(B) TDD 修正ループ」を「test-loop の修正」に改め、NG の入力の出所を `running-regression-tests` にする。M4-T05 の worktree・`report.md`・`parallel: true` の記述を保ち、worktree の名前を設計書 §6.6.3 に合わせる。`scripting-tests` の「ツール運用」のセクション(Context7 での仕様の確認と、Playwright MCP でブラウザを操作して失敗の原因を切り分ける手順。現行 58〜64 行目)は保ち、目的を test-code の文脈に書き直す。Playwright MCP の切り分けは、失敗の理由が未実装(Red)か、テストの記述の誤りか、環境の失敗かを見分けるために使う。このセクションには test-loop の用語「NG」を使わない。`implementing` には、run ブランチ上の委譲では報告を依頼文が指す `.codiel/runs/<slug>/try-<n>/steps/<名前>/report.md` に書くことを入れる。`serial` グループと `final` では `steps/step-<k>/report.md`、グループのマージの後の修正では `steps/merge-fix-<g>/report.md`、test-loop のどの仕様のディレクトリにも属さない失敗の修正では `steps/test-loop-project/report.md` である(設計書 §6.6.4 の手順 7〜9、§6.7)。

  テストの実行環境と環境の失敗(設計書 §6.13.1)の分として、次も入れる。
  - `scripting-tests` と `implementing`: E2E の実行の準備をプロジェクトの規約とテストの設定に従って行うこと。理由が環境にある失敗を Red にもプロダクトの失敗にも数えず、「環境の失敗」として理由と出力の抜粋を `report.md` に挙げること。`scripting-tests` の失敗の種類の表で異常終了の例に挙げた「環境未起動などの環境問題」は、環境の失敗へ移す。
  - `running-regression-tests`: 環境の失敗を broken と NG から分けてレポートに挙げること(レポート書式に欄を足す)。単独実行モード(`/codiel:test`)では、環境の失敗が出た仕様のディレクトリを 1 回だけ単独で実行し直し、残れば報告に挙げてユーザーに示すこと。単独実行モードは state を遷移させないので `mark-ask` を使わない(設計書 §6.7)。
  - `fixing-failures`: 修正の後に実行したテストの環境の失敗を、報告に挙げること。
- 触るファイル: `plugins/codiel/skills/{scripting-tests,running-regression-tests,implementing,fixing-failures}/SKILL.md`
- ドメイン: prompt
- 依存: なし
- 完了条件: A6-9、A6-10、A6-14 の `implementing` の部分、A6-17 の 4 スキルの部分、A5-3 の `scripting-tests` の行。`grep -n "Playwright MCP" plugins/codiel/skills/scripting-tests/SKILL.md` が 1 件以上で、`scripting-tests/SKILL.md` の「## ツール運用」のセクションに「NG」が 0 件。`grep -n "step-<k>/report.md" plugins/codiel/skills/implementing/SKILL.md` が 1 件以上。4 ファイルで `grep -nE "Step A|スクリプト安定化|\.codiel/specs"` が 0 件。`grep -n "report.md" plugins/codiel/skills/implementing/SKILL.md` と `grep -n "parallel: true" plugins/codiel/skills/running-regression-tests/SKILL.md` が各 1 件以上。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4-T13 周辺のスキルと入口

- 内容: 参照文書(`references/*.md`)は M4-T14 が担うので触らない。`fixing-review-findings` に `set-test-edit` / `clear-test-edit` とテスト側の修正の順序(設計書 §6.13.6)を足す。`reviewing-diffs` の入力を `<testsDir>/**` と記録されたテストに替える。`raguel-gating` の対応表に test-code の行(設計書 §6.13.2 の手順 8)を足し、run の結末を記録するときの `evaluationId` の選定順(`raguel-gating/SKILL.md:168-171`)の末尾に test-code を足す(設計書 §6.9.1)。`commands/test.md` の引数と手順を設計書 §6.7 に合わせ、description も改める。`assets/rules/codiel.md` と `CLAUDE.example.md` のテストの仕様の置き場を testsDir に替える。`capturing-intent` の手順 1 の最新化の後に、前の try の run ブランチから intent を持ち込む手順(設計書 §6.1.2 の手順 1。`get --slug` で読む最新の try、持ち込まない 3 つの場合、`git checkout` の失敗時の確認、`state.json` がブランチの切り替えで残る前提)を足し、手順 6 の持ち込みの記述を手順 1 の参照に改める。`capturing-intent` の手順 0 と手順 2 で、再開する run を frontmatter の `run` に加えて、state の `intent` が入口のパス(repoRoot 相対にしたもの)と同じ run でも照合する(設計書 §6.1.2 の手順 0・2)。frontmatter の `run` で当たった run は確かめずに再開し、state の `intent` だけで当たった run は再開する前に slug・intent のパス・現在のフェーズを示してユーザーに確かめる。手順 2 の intent パスの分岐には、照合する run が無く作業ツリーにも intent のファイルが無いとき、パスが無いことを示してユーザーに確かめる文を足す(設計書 §6.1.2 の手順 2)。

  決定 82 の (5) と決定 83 の分として、次も入れる。
  - `capturing-intent`: `SKILL.md:115` の `## 合意済み事項` の書き方(`<論点>: <採用した選択肢>(理由: <...>)`)を、「論点 | 決定 | 理由」の表に改め、表のヘッダ行 `| 論点 | 決定 | 理由 |` を本文に示す。`## 意図的な制約` も「制約 | 理由」の表で書くと、`:111` の持続層の初稿の記述に添える(設計書 §6.3.3)。手順 1 の持ち込みの判定に、最新の try が `stopped` で、`stopReason` が `raguel-stop` か、`humanApproved` の無い `verdict: "STOP"` のフェーズを持つなら(設計書 §6.2.2 の `init` の検査と同じ条件)、STOP を受けたフェーズと `evaluationId` を示して新しい try を作ってよいかを確かめ、承認されたら手順 5 の (4) の `init` に `--human-approved` を付け、承認されなければ run を始めない手順を足す。手順 5 の (4) のコマンドに `[--human-approved]` を足す(設計書 §6.1.2、§6.14.2 の (7))。
  - `raguel-gating`: 設計書 §6.14.2 の (6) の STOP の手順(`mark-ask --kind raguel --verdict STOP`、AskUserQuestion での「誤検知として続ける」と「妥当として止める」、誤検知の `record_outcome` と「Raguel の誤検知: <ruleId>」の退避、`pass-gate ... --verdict STOP --human-approved`、妥当なら `stop --reason raguel-stop`)に現行の STOP の手順を置き換える。HARD-GATE の `--human-approved` の例外を 2 つ(ASK の裁定 B と STOP の誤検知の裁定)にする。フェーズ→ツール対応表の「成果物として渡すもの」を設計書 §6.14.2 の (8) の表にし、intent-sync の行を足し、「要約や手で書いた diff を渡さない」の文と `files[]` を使わない規則と、入力の誤り(`isError`)が返ったら入力を直して呼び直し ASK に数えない規則を入れる。ツール名を `mcp__plugin_codiel_raguel__<ツール名>` に直す((9))。「ゲートを 1 回通すたびに」の手順 2 の objective の規則を、「objective の本体」を run を通じて同じ文言にし、フェーズに固有の注記を本体の後に 1 文だけ足す形に改め、test-code の注記と `testResults` を判定に使わないことを書く((11))。
  - `fixing-review-findings`: `SKILL.md:61` のツール名を直す((9))。
  - `reviewing-diffs`: レビュー担当がさらに委譲するときも前景で出す 1 文を入れる(設計書 §6.14.2 の (10))。
- 触るファイル: `plugins/codiel/skills/{fixing-review-findings,reviewing-diffs,raguel-gating,capturing-intent}/SKILL.md`、`plugins/codiel/commands/test.md`、`plugins/codiel/assets/rules/codiel.md`、`plugins/codiel/CLAUDE.example.md`
- ドメイン: prompt
- 依存: なし
- 完了条件: A6-13 の `raguel-gating` の部分。A6-19。A6-21 の `capturing-intent` の部分。A6-29 の `raguel-gating`・`capturing-intent`・`reviewing-diffs` の部分。`grep -n "set-test-edit" plugins/codiel/skills/fixing-review-findings/SKILL.md` が 1 件以上。触ったファイルで `grep -n "\.codiel/specs"` と `grep -n "mcp__raguel__"` が 0 件。A2-8・A2-19 の grep が引き続き通る。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`、`prompt-smith:skill-creator`(`commands/test.md` の description)

#### M4-T14 参照文書の書式と、人が読む文書の執筆規則

- 内容: codiel の参照文書と gh-utility の執筆規則を、設計書の決定 82(§6.3.3、§6.3.5、§6.12.9、§7.4)と M4 の書式の変更に合わせる。
  - 新設 `references/readable-writing.md`: 設計書 §6.12.9 の適用範囲、原文のセクションに当てないこと、書式が形を定めた箇所は書式に従うこと、4 つの規則(根拠の置き場、言語を問わない書き方、翻訳、環境に固有の値)を書く。AI 向けの指示書の規律(できるだけ削る)を写さない。ARCHITECTURE に触れない(触れると登録簿のエントリが要る)。
  - `references/intent-writing.md` と `references/github-writing.md`: 「## 文の組み立て」の見出しを残し、本文を `readable-writing.md` に従うという 1 文だけにする。現行の箇条書きの 6 項目(「言い切りで書く」から「最も短い文にする」まで)はすべて除く。参照は同じディレクトリのファイル名で「文の組み立ては `readable-writing.md` に従う。」の形に書き、スキルからの参照の形(`../../references/readable-writing.md`)にしない(設計書 §6.12.9)。`intent-writing.md` の残す基準・削る基準の表と原文のセクションの 2 文(A2-10、A2-17)、`github-writing.md` の 3 文とマーカーの文(A2-11、A2-23)は保つ。
  - `references/github-writing.md` に「PR 本文」のセクション(設計書 §6.12.8)を足す(M4-T13 から移した)。
  - `references/intent-format.md`: 派生文のセクションの冒頭の定型文(`:78-79` の表の「原文のセクションからの派生である。」、`:130` の規則、`:158`・`:162` の例)を除き、原文の区切り(区切り線と 1 行)の規則と例を設計書 §6.3.3 のとおりに入れる。変更 intent の書式のコードブロック(`:53-69`)と v1 から v2 への変換の例にも原文の区切りを置く。intent-issue の本文のセクションに、原文の区切りを同じ位置に置くことと、Issue から intent へ転記するときに原文の区切りを写さないこと(設計書 §6.3.5)を足す。status の表の `abandoned` の行の例外に `stop --reason migrate`(設計書 §6.3.2、§6.6)を足す(M4-T13 から移した)。13 セクションを置く規則と「なし」は変えない。
  - `references/intent-format.md`(決定 82 の (5)): 変更 intent のセクションの表の `## 意図的な制約` と `## 合意済み事項` の行(`:82-83`)と、派生文のセクションの規則(`:133`)を、設計書 §6.3.3 の 2 つの表(「制約 | 理由」と「論点 | 決定 | 理由」、1 行に 1 件、内容が無ければ表を置かずに「なし」)に改め、ヘッダ行 `| 制約 | 理由 |` と `| 論点 | 決定 | 理由 |` を含む表の例を置く。「「制約: 理由」の対で書く」の文は残さない。intent-issue の本文のセクションに、2 つの表を同じ形で転記することを足す。「## 持続層」のセクションの書式(`- 制約:` と `- 理由:` の行)は変えない。
  - `skills/syncing-intents/SKILL.md`(`:64`)と `skills/preparing-design-agendas/SKILL.md`(`:74-85`、`## 合意済み事項の継承`): intent の `## 意図的な制約` と `## 合意済み事項` を、表の 1 行を 1 件として読む形に改める。持続層へ書く形と `agenda.md` へ書く形は変えない。
  - `references/intent-common.md`: `:31` のツール名 `mcp__raguel__*` を `mcp__plugin_codiel_raguel__*` に直す(設計書 §6.14.2 の (9))。
  - `docs/format-change-checklist.md`: `readable-writing.md` のセクションを足し、追随先に `intent-writing.md` と `github-writing.md` の「## 文の組み立て」と、gh-utility の `references/github-issue-common.md` の「## 執筆規則」を挙げる。設計書 §6.12.6 が求める `github-writing.md` と gh-utility の同じファイルを揃える行が無いので、同じく足す。intent 文書の書式のセクションに、`skills/capturing-intent/SKILL.md` の `## 合意済み事項` の書き方と、`skills/syncing-intents/SKILL.md` の持続層への取り込みの 2 行を足す(2 つの表の形に依存するため)。`intent-format.md` の変更について、既存のセクションの追随先(契約凍結文書の §9・§10 は設計書 §7.5 の上書き記録で扱う、`filing-followup-issues`・`syncing-intents`・`preparing-design-agendas`・gh-utility の `issue-craft`)を確かめ、結果を報告に書く。`syncing-intents` と `preparing-design-agendas` はこのタスクで直し、`capturing-intent` は M4-T13 が直す。ほかの追随先のスキルは触らず、追随が要るなら blocked で報告する。
  - gh-utility の `references/github-issue-common.md`: 「## 執筆規則」の適用範囲と 3 文(A2-12)を保ち、「文の組み立ては次に従う」の列を設計書 §6.12.9 の 4 つの規則に置き換える。A6-21 の固定文字列は `readable-writing.md` と同じ文言で書く。何を残し何を削るかは、そのセクションの 3 文に従うと書く。codiel の名前を書かない。
  - gh-utility の `docs/format-change-checklist.md`: 最初のセクションで揃える相手に `references/readable-writing.md` を足す。「## 文の組み立ての規律への追随」(prompt-smith に揃える)を、同じ Marketplace の別プラグインの `references/readable-writing.md` に揃える形に改め、`prompt-smith` の語を除く。codiel の名前を書かない(§9.4 の 9)。
- 触るファイル: `plugins/codiel/references/{readable-writing,intent-writing,github-writing,intent-format,intent-common}.md`、`plugins/codiel/skills/{syncing-intents,preparing-design-agendas}/SKILL.md`、`plugins/codiel/docs/format-change-checklist.md`、`plugins/gh-utility/references/github-issue-common.md`、`plugins/gh-utility/docs/format-change-checklist.md`
- ドメイン: prompt
- 依存: なし
- 完了条件: A6-12 の `github-writing.md` の部分。A6-18 の `intent-format.md` の部分。A6-21(`capturing-intent` の部分を除く)。`grep -n "mcp__raguel__" plugins/codiel/references/intent-common.md` が 0 件。`intent-writing.md` と `github-writing.md` の「## 文の組み立て」のセクションが 1 文だけである。A2-10・A2-11・A2-12・A2-16(決定 82 で改めた形)・A2-17・A2-23・A3-5 の grep が通る。`grep -rn "codiel" plugins/gh-utility --exclude-dir=node_modules` が 0 件。`grep -n "ARCHITECTURE" plugins/codiel/references/readable-writing.md` が 0 件。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る。報告の notes に、`intent-format.md` の追随先を確かめた結果を書く
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4-T15 hook と CLI の追随(run の検索、STOP の裁定、stop-guard の理由文)

- 内容: 次の 4 つを行う。
  - guard-github-mcp: `plugins/codiel/src/hooks/guard-github-mcp.ts:23` の run の検索を `findProjectRoot` から `findMainRoot` に替え、`:3` の import を合わせる(設計書 §6.8 の (a) と hook の表)。テストを足す。cwd が codiel の worktree(`.codiel/worktrees/<slug>/<名前>`)の中で、その checkout に `.codiel/` の一部がコミットされていても、メインの active run を見つけ、マーカーの無い本文を deny することを確かめる。worktree はテストの中で git で作り、作るための関数はこのテストファイルの中に置く。`guard-write.test.ts` の W 系の組み立てを参考にしてよいが、そのファイルは変えない。
  - `findMainRoot`: 設計書 §6.8 の (a) のとおり、git を呼ばない形に改める。cwd のパスが `/.codiel/worktrees/` を含むとき(区切りは `/` と `\`)は最初に現れるその位置より前を返し、含まないときは `findProjectRoot(cwd)` を返す。`gitMainWorktree`(`lib.ts:568`)を除き、`findMainRoot` の説明のコメントを合わせる。`lib.test.ts:917-926` の既存のテストは、git 管理外の worktree の形のパスでもメインのルートを返す形に改める。linked worktree のケースのテストを足す。一時のリポジトリで `git worktree add` した作業ツリー L に `.codiel/` を置き、L の中に codiel の worktree(`L/.codiel/worktrees/<slug>/<名前>`)を作り、その中の cwd で `findMainRoot` が L を返すことを確かめる。`.codiel` を git のルートの下に置いた構成(`repo/app/.codiel`)で `repo/app` を返すことも確かめる。`guard-write.ts:235` の「findMainRoot が git から得たルートは実体パスである」のコメントを、パスの形から得たルートを `realpathOrAncestor` で実体化して比べる旨に直す(コメントだけ)。
  - `codiel-state`: `mark-ask` に任意の `--verdict`(`PROCEED`・`ASK`・`STOP`。既定は `ASK`)を足し、値をフェーズの `verdict` に記録する(`codiel-state.ts:847` は `"ASK"` を固定で書く)。`pass-gate` が `--human-approved` のときだけ `--verdict STOP` を受け付け、フェーズの `verdict` がすでに `STOP` なら `--human-approved` の無い `PROCEED`・`ASK` も拒否する(`:789`。設計書 §6.2.2)。`init` が、同じ slug の最新の try が `stopped` であり、かつ `stopReason` が `raguel-stop` であるか、どれかのフェーズの `verdict` が `STOP` で `humanApproved` を持たないとき、`--human-approved` が無ければ失敗する(`:659-665` の未完了の try の検査の後)。文言は設計書 §6.2.2 のとおりにする。`--human-approved` は既存の値を取らないフラグである。
  - stop-guard: `in_progress` のフェーズの理由文(`stop-guard.ts:60-65`)に、サブエージェントの完了を待つなら委譲を前景で出し直して報告を受け取る旨の 1 文を足す(「前景で」を含める。設計書 §6.14.2 の (10))。ほかの分岐の理由文は変えない。
- 触るファイル: `plugins/codiel/src/hooks/{guard-github-mcp,lib,stop-guard}.ts`、`plugins/codiel/src/hooks/__test__/{guard-github-mcp,lib,stop-guard}.test.ts`、`plugins/codiel/src/hooks/guard-write.ts`(`:235` のコメントだけ)、`plugins/codiel/src/codiel-state.ts`、`plugins/codiel/src/__test__/codiel-state.test.ts`
- ドメイン: impl
- 依存: なし(M4A-G のコミットの上で編集する)
- 完了条件: A6-20、A6-27、A6-28。`pnpm exec vitest run plugins/codiel/src/hooks/__test__/guard-github-mcp.test.ts plugins/codiel/src/hooks/__test__/lib.test.ts plugins/codiel/src/hooks/__test__/stop-guard.test.ts plugins/codiel/src/hooks/__test__/guard-write.test.ts plugins/codiel/src/hooks/__test__/guard-bash.test.ts plugins/codiel/src/__test__/codiel-state.test.ts` が通る(guard-write と guard-bash は変えないが、`findMainRoot` の改めで W 系が通ることを確かめる)。`grep -n "findProjectRoot" plugins/codiel/src/hooks/guard-github-mcp.ts` と `grep -n "gitMainWorktree" plugins/codiel/src/hooks/lib.ts` が 0 件
- 委譲先: complex-impl
- スキル: なし

#### M4-T16 Raguel の応急処置

- 内容: 設計書 §6.14.1 の 5 件を `plugins/codiel/raguel-mcp/src` に入れる。(1) `panel/schema.ts` の `toJsonSchema` の戻り値から `$schema` を除く。(2) `rules/common/secrets.ts` のエントロピーの判定から `/` を含む語と見出し行を外し、既知の形を組み込みの偽陽性の文脈でも照合し、`sk-` に直前が英数字でない条件を付ける。(3) 設定の読み直し(`server.ts` の起動時の 1 回だけの読み込みを、各ツールの呼び出しの初めの有無と mtime の比較に替える)、`code/protected-paths` の `globs` の和集合(`config/loader.ts` の深マージの後)、`policy` と `list_rules` の `configSource`。(4) `rules/code/dangerousPatterns.ts` の `.md`・テストファイル・コメント行での ask。files[] の本文には parseDiff がファイルを返さない(`--- <path> ---` の見出しを diff と見なさない)ので、dangerousPatterns が本文を `--- <path> ---` の行で区切ってパスを得る処理を足す。(5) `tools/evaluatePlan.ts` の本文のつなぎ方と、`tools/evaluateCode.ts`・`tools/shared.ts` の入力の誤り(`isError`)。見出しだけの diff は、ハンクも、設計書の (5) に挙げた印の行(名前の変更・バイナリ・モードの変更・空のファイルの追加と削除)も無いときだけ入力の誤りにする。どれも設計書の表の「変更」の列の文言どおりにする。設計書 §8.2 の「Raguel の応急処置」の行のテストを、既存のテストファイルに足す。既存のテストが旧い振る舞い(`$schema` がある、files[] が無いときの `internal-error` の ASK、`policy` の形など)を確かめているときは、設計書の新しい振る舞いに合わせて改め、改めたテストを報告に挙げる。`raguel-mcp/dist/`・`raguel-mcp/docs/`・`raguel-mcp/package.json` は変えない。
- 触るファイル: `plugins/codiel/raguel-mcp/src/**`
- ドメイン: impl
- 依存: なし
- 完了条件: A6-22〜A6-26。A6-25 は files[] の本文のケースを、A6-26 はハンクの無い正当な diff(名前の変更だけ・バイナリ・モードの変更だけ・空のファイルの追加と削除)で判定を返すケースを含む。`pnpm exec vitest run plugins/codiel/raguel-mcp/src` が通る。報告の notes に、設定の読み直しの契機(比べる値)と、入力の誤りを返す関数の名前と形を書く
- 委譲先: complex-impl
- スキル: なし

#### M4-T04 orchestrating-runs の並列とテスト駆動の流れ

- 内容: 第 2 版の内容(設計書 §6.6.2〜§6.6.4 の手順)に、次を加える。`STAGES` とフェーズ進行表(設計書 §6.1.1)。§0 の `codiel-state.mjs config` の実行と、初期化の判定 D(`.codiel/runs` と `.codiel/reports` の 2 ディレクトリ。設計書 §6.13.4)。test-code の運転(設計書 §6.13.2 のオーケストレーターの手順)。test-loop の運転(設計書 §6.7。巡ごとの登録し直し、修正の 1 巡を `record-attempt` の 1 回と数える)。§2.1 のコード系フェーズに test-code を足す。§2.2 の PR 本文(設計書 §6.12.8、§6.12.7)。§3 の依頼文の条項(testsDir の値、test-spec の書き込み先を `<testsDir>/<ID>/` に、test-code の書き込み先、implement 以降の委譲でテストと仕様を書き換えない)。§4.1 で test-code に `set-domain` を使わないこと。フェーズ進行表の `[test-loop A]`・`[test-loop B]` の 2 行(`SKILL.md:170-171`)を、test-code と test-loop の行に置き換える。表の外の「test-loop B」(`SKILL.md:375`、`:387`)を「test-loop の修正」に改める。worktree の名前は設計書 §6.6.3 に従う。委譲先は作業内容だけで表す(ADR-004)。`unscoped` の記述と登録簿の 2 エントリが指す記述を保つ。

  2 回目の見直し(決定 80・81)とその後の見直しの分として、次も入れる。
  - テストを実行する委譲の並べ方(設計書 §6.13.1。並列可の委譲と単独の委譲、判定の時点、「動いている委譲」の範囲、同時に 4 件まで、出せる並列可の委譲を同じ応答からまとめて出すこと、run ブランチ上の修正の委譲を単独の委譲にすること、implement での種類の選び方)。規則の本文はこのスキルの 1 か所に置き、test-code・implement・test-loop の運転からはそこを参照する。
  - §4.1 の `SKILL.md:406`(実装の委譲を 1 体ずつ逐次に出し、同じ応答で複数の実装を起動しない)を除き、委譲の並べ方の参照に替える。`:407`(state が持てる `domain` は 1 つだけなので、同じ応答で出す委譲のドメイン規律をディスパッチプロンプトで運用する)は、implement の worktree の委譲の部分だけを設計書 §6.6.6 に合わせて改める。worktree の中の委譲は、`step-add --domain` で要素に記録した `domain` で guard-write が境界を判定するので、`set-domain` を使わない。`set-domain` は、メインの作業ツリーで動く委譲(`serial` グループ、`final`、run ブランチ上の修正、fix-loop)にだけ使う。レビューで複数の観点を同じ応答で出すときの規律(先に `clear-domain` を実行して `set-domain` せず、ドメインの規律を依頼文で伝える)は残す。
  - implement の brief(`serial` グループと `final` では依頼文)に、選んだ委譲の種類と実行する通すテストを書き、その `spec.md` の `tests` を写すこと(設計書 §6.6.4 の手順 1)。
  - 設計書 §6.6.4 の手順 7 の「グループのマージの後」の実行(E2E を含む。`parallel: true` のものだけを同時に、ほかは直列に)と、失敗を run ブランチ上で直列に直すこと。
  - 環境の失敗の扱い(設計書 §6.13.1)。test-code・implement・test-loop の運転に当てる。implement と test-loop の修正では、report.md の環境の失敗を実行し直させてからタスクレビューへ進み、マージより前に済ませる(設計書 §6.6.4 の手順 3)。実行し直しの委譲の依頼文には、結果を元の報告の末尾に `## 実行し直し` のセクションとして足すことを書く。`serial` グループと `final` の依頼文には、報告を `steps/step-<k>/report.md` に書かせる(設計書 §6.6.4 の手順 8・9)。グループのマージの後の修正の依頼文には `steps/merge-fix-<g>/report.md`(g は、そのグループのステップの state の `group.index` に 1 を足した値。`group.index` は 0 から数える)、test-loop のどの仕様のディレクトリにも属さない失敗の修正の依頼文には `steps/test-loop-project/report.md` に書かせる(設計書 §6.6.4 の手順 7、§6.7)。
  - §6 の再開手順に、`phases` に test-code を持たない state の run の扱い(設計書 §6.6 の冒頭。CLI の文言か `get` の state でこの run を見つけたら続行せず、`codiel-state stop --slug <slug> --reason migrate` で止め、ユーザーに示し、同じ intent パスを入口に新しい try を始める)と、報告の `## 実行し直し` の有無で実行し直しが済んだかを判断すること、確かめる報告ファイルの範囲(設計書 §6.2.5)を足す。
  - §1 の `SKILL.md:144-145` と §6 の手順 1(`:445-446`)で、再開する run を intent の frontmatter `run` に加えて state の `intent` でも照合する(設計書 §6.1.2 の手順 0、§6.2.5)。state の `intent` だけで当たった run は、再開する前に slug・intent のパス・現在のフェーズを示してユーザーに確かめる。
  - 軽量の経路の同定の委譲と画面名の確認(設計書 §6.1.4 の手順 1〜3 と、やり直しと再開のときの一覧の扱い)。フェーズ進行表の test-spec と dev-plan の行の入力に、軽量の一覧を足す。
  - フェーズ進行表の design の行に、ウォークスルーで新しい画面の名前を聞くこと(`facilitating-design-discussions`)を足す。

  決定 83(設計書 §6.14.2)の分として、次も入れる。
  - 「7. 失敗の記録」の契機「Raguel が `STOP` を返した」を「人が STOP を妥当と裁定した」に改め、記録する時点を `raguel-gating` の STOP の手順で `stop --reason raguel-stop` を実行した直後にする。誤検知と裁定した STOP は、退避の形で「Raguel の誤検知: <ruleId>」として 1 件書き、台帳へは書かないことを添える((6))。
  - 前の try の成果物(intent 以外。STOP を受けたファイルを含む)を新しい try で使うときは、それを作るフェーズを新しい try で進めて「新しい try のゲートを通す」ことと、ゲートを通さずに run ブランチへ持ち込まないことを、§6 の再開手順か §1 の開始の手順に書く。STOP を記録したまま止めた try(`raguel-stop` など。設計書 §6.14.2 の (7))の次の try を作るときの承認は `capturing-intent` の手順 1 に従うと添える((7))。
  - 各フェーズのゲートで Raguel に渡すものは `raguel-gating` の対応表に従い、要約や手で書いた diff を渡さないと書く((8))。
  - `SKILL.md:105` のツール名を `mcp__plugin_codiel_raguel__*` に直す((9))。
  - 委譲はすべて前景で出す(Agent ツールの `run_in_background` を使わない)ことと、並列にする委譲は同じ応答からまとめて出すことを、委譲の共通の規律として書く。review の観点ごとの委譲にも当てる((10))。
- 触るファイル: `plugins/codiel/skills/orchestrating-runs/SKILL.md`
- ドメイン: prompt
- 依存: M4-T11、M4-T12、M4-T13、M4-T14(`github-writing.md` の「PR 本文」)、§9.3 の O4A-1 の記録
- 完了条件: A6-12 と A6-13 の `orchestrating-runs` の部分。A6-14〜A6-18 の `orchestrating-runs` の部分。A6-29 の `orchestrating-runs` の部分。`grep -n "waves"`・`grep -n "info/exclude"`・`grep -n "codiel-state.mjs config"`・`grep -n "set-test-edit"`・`` grep -n 'state の `intent` だけ' `` が各 1 件以上。`grep -n "\.codiel/specs"` と `grep -n "mcp__raguel__"` が 0 件。`:407` の書き直しの後も、`grep -n "レビューで複数の観点"` が 1 件以上で、その行が `clear-domain` を含む(`:406` の書き直しは A6-15 で確かめる)。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る。`wc -c` の値を報告する
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4-T06 codiel の文書

- 内容: 第 2 版の内容(`DESIGN.md`・`skill-flowcharts.md`・`README.md` に並列実装を足す)に、テスト駆動を加える。`DESIGN.md` の §2(全体フロー)・§3(成果物と state 管理)・§4(テスト資産モデル)・§5(test-loop の詳細と `/codiel:test`)・§6(Skills)・§8(Hooks)を、設計書 §6.7・§6.13・§6.9.4 に合わせる。implement が E2E も通すこととグループのマージの後の実行(決定 80)、新しい画面の名前をユーザーに聞くことと軽量の run の同定(決定 81)を、§2 と §4 に書く。テストを実行する委譲の並べ方と環境の失敗の扱い(設計書 §6.13.1)を、§5 に書く。`skill-flowcharts.md` の writing-test-specs・scripting-tests・running-regression-tests・implementing の図と全体の図を改める。`README.md` に、フェーズ図、`/codiel:test` の引数、`.codiel/config.json` と testsDir(設計書 §6.9.4)を書く。旧 `.codiel/specs/` の移行の注記は書かない(決定 74)。`DESIGN.md` の終了状態の記述(M1-T00)を保つ。決定 83 の分として、`DESIGN.md:162` の STOP の扱い(run を停止して GOTCHAS に記録)を、人が「誤検知として続ける」か「妥当として止める」かを裁定する形に改め(設計書 §6.14.2 の (6))、`:160` の「ゲートの唯一の正規例外」を、ASK の as-is 承認と STOP の誤検知の裁定の 2 つにする。`:637` のツール名を `mcp__plugin_codiel_raguel__*` に直す((9))。`skill-flowcharts.md` の raguel-gating の図の STOP の枝(`:551` 付近)も裁定の分岐に改める。
- 触るファイル: `plugins/codiel/docs/{DESIGN,skill-flowcharts}.md`、`plugins/codiel/README.md`
- ドメイン: docs
- 依存: M4-T04
- 完了条件: 3 ファイルに `test-code` と `wave` の語がある。`DESIGN.md` に「名前の候補」と「誤検知」の語がある。3 ファイルで `grep -n "\.codiel/specs"` と `grep -n "mcp__raguel__"` が 0 件
- 委譲先: general
- スキル: なし

#### M4-T07 全スキルの description の統一

- 内容: §9.4 の 12 のユーザー決定(設計書の決定 55)に従い、codiel の全スキル(`plugins/codiel/skills/` の 17 個)の description を「Codiel の <フェーズ> フェーズで、<担い手> が <入力> から <出力> を<動作>ときに使う。<起動元> が名指しで起動する。」の形に書き直す。「〜したくなる場面でこそ必ず使用する」の句を入れない。`scripting-tests` は test-code フェーズ、`running-regression-tests` は test-loop フェーズと `/codiel:test` のスキルとして書く。`writing-test-specs` は、軽量の run で仕様のディレクトリを同定する委譲にも使うことを含める。`facilitating-design-discussions` は、design のウォークスルーで新しい画面の名前を聞くことを含める。本文は変えない。
- 触るファイル: `plugins/codiel/skills/*/SKILL.md`(frontmatter の description だけ)
- ドメイン: prompt
- 依存: M4-T04
- 完了条件: `grep -L "^description: .*名指しで起動する。" plugins/codiel/skills/*/SKILL.md` が 0 件。frontmatter の description に「でこそ必ず使用する」「スクリプト安定化」「(A)」「(B)」「.codiel/specs」が 0 件。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る
- 委譲先: general
- スキル: `prompt-smith:skill-creator`

#### M4B-G ゲート

- 内容: lint・typecheck・test・build を実行し、§8.3 の A5-3 の grep をすべて実行し、A6-7、A6-14〜A6-18、A6-21、A6-29 と A2-12 の grep を実行する。A6-14〜A6-18、A6-21、A6-29 は複数のタスクのファイルにまたがるので、ここで全体を判定する。build は、M4-T15 の変更で `plugins/codiel/scripts/` の hook と `codiel-state.mjs`(`codiel-state` をインラインする `.mjs` を含む)を、M4-T16 の変更で `plugins/codiel/raguel-mcp/dist/server.mjs` を再生成する。コミットの前に `git status --short` を見て、未コミットの変更が M4-B のタスクの触るファイル、ビルドが再生成したファイル、`docs/chat/` に限られることを確かめる。ほかの変更があれば、コミットせずに blocked で報告する。codiel の `plugin.json` と `package.json` を `1.0.0` に上げ、§7.4 のとおりコミットする。gh-utility のバージョンは `0.5.3-dev` のまま変えない(設計書 §9、§9.4 の 35)。raguel-mcp の `package.json` は変えない。
- 完了条件: 4 コマンドの終了コードが 0。A5-1、A5-2、A5-3、A6-7、A6-14〜A6-18(A6-18 は grep の部分)、A6-20〜A6-29(テストの部分は `pnpm run test` で判定する)、A2-12
- 委譲先: light-impl

#### M4-R と M4-FR レビュー

Workflow `codiel-m4b-review`(§6.1.4)で行う。

- M4-R: M4 の差分(O4A-0 で記録した起点から M4B-G のコミットまで)を、設計書 §6.1.2 の手順 0〜2、§6.1.4、§6.2.2、§6.2.5、§6.3.2、§6.3.3 の原文の区切りと 2 つの表、§6.6〜§6.8、§6.12.8、§6.12.9、§6.13、§6.14、A4、A6 と照らす。M4-T09 と M4-T02 が依頼文に無く自分で決めた扱い(§9.3 の O4A-1 の行の末尾)と、M4-T16 の報告の notes(設定の読み直しの契機、入力の誤りの形)が設計書と食い違わないかも見る。`--human-approved` の STOP の迂回が、人の明示の答えと `record_outcome` の記録を前提にしているかを確かめる。委譲先は code-review。
- M4-FR: M1 の開始時の HEAD から M4B-G のコミットまでの全体を、設計書 §1 の決定表(決定 1〜83)と §4 の受け入れ基準に照らす。委譲先は final-review。
- どちらも所見は §1 の severity の基準で返す。Raguel の応急処置の範囲の外の所見(設計書 §6.14.3)は、severity を付けずに「作り直しへ」と分けて返す。

### 6.5 M4 の後のオーケストレーターの手順

手動確認(O4-1、O4-6〜O4-8)は、M4B-G のコミットと M4 のレビュー(`codiel-m4b-review`)の後に行う。レビューの critical・high は、先に M4 の修正の Workflow(`codiel-m4-fix`)で直す。確認項目が NO になったら、所見を §9.3 に記録し、`codiel-m4-fix` で直してから、その確認をやり直す。Raguel の ASK と STOP が出たら、裁定と所見を §9.3 に記録する(設計書 §6.14)。

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O4-1 | このリポジトリを対象に `/codiel:run` を github モードと local モードで 1 回ずつ通す。dev-plan の `## 生成物` が方式 a になること、worktree が作られて後始末されること、設計書 §8.4 のテスト駆動の確認項目を確かめる。このリポジトリは git の linked worktree だが、M4-T15 の `findMainRoot` で run が見つかる(§10 の 6) | ユーザーとオーケストレーター | 結果を §9.3 に記録する。run を終端にする |
| O4-6 | 画面を持つサンプルは `/tmp/claude-1000/-home-hiro0209-amatsuka-kobo-amatsuka-claude-plugins-intent-driven-development/59313b99-90d9-4ff0-8421-0797da50ede1/scratchpad/o41b/` にある。この置き場はセッション `59313b99` の間だけ使う一時の場所で、セッションが終われば残らない。サンプルに、既存のホーム画面の仕様 `docs/tests/e2e/frontend/home/spec.md` と `cases.md` を M4 の最終の書式(`writing-test-specs`)で足す。`cases.md` には、既存の `tests/e2e/home.spec.js` が確かめる振る舞い(見出し「ようこそ」が出る)を 1 ケースとして書く。`spec.md` の frontmatter の `tests` に `tests/e2e/home.spec.js` を載せ、`parallel: true` を書かない。サンプルが消えていたら、設計書 §8.4 の構成(`server.js`、`public/index.html`、`src/routes.js` と `test/routes.test.js`、`tests/e2e/home.spec.js`、ポート 4173 の `playwright.config.js`、テスト方針を書いた `CLAUDE.md`)で作り直す | オーケストレーター | `docs/tests/e2e/frontend/home/` に 2 ファイルがあり、`spec.md` の frontmatter が `tests` だけを持つ |
| O4-7 | ユーザーがサンプルを一時の git リポジトリへ写し、最初のコミットを作る。`origin` を持たないので local モードになる。`npm install` と Playwright のブラウザの導入の後、`npm test` と `npm run test:e2e` が通ることを確かめてから、`/codiel:init` と `/codiel:run` を実行する。要望は、ホーム画面からお問い合わせ画面へのリンクを置き、お問い合わせ画面を新しく作ることとする。規模はユーザーが選ぶ。設計書 §8.4 のサンプルの 5 点を確かめる | ユーザーとオーケストレーター | 5 点の結果、選んだ規模、名前を聞いたフェーズ(標準では design、軽量では test-spec)を §9.3 に記録する。run を終端にする |
| O4-8 | O3-1 で確かめられなかった 3 点をやり直す。ARCHITECTURE を持たない一時の git リポジトリで、M4 の版(M4B-G のコミット)の codiel を使い、`/codiel:init` の後に軽量の run を 1 回通し、続けて `/metatron:init` を実行する(設計書 §8.4) | ユーザーとオーケストレーター | `[ADR 候補]` が持続層に書かれ finalize の報告に挙がる、`/metatron:init` が候補を提示し承認した候補が ADR になる、持続層が参照形に縮む、の 3 点の結果を §9.3 に記録する。run を終端にする |
| O4-2 | `/metatron:update` で ARCHITECTURE の乖離を確かめる | オーケストレーターとユーザー | 乖離の報告が 0 件 |
| O4-3 | Serena メモリ `codiel/core` に、並列実装、test-code フェーズと `GATED`、`.codiel/config.json` の testsDir、テストの保護を反映する。直すのは現行の 17 行目(`install-harness.sh` が作るディレクトリ)、56 行目(`specs/**` の判定)、75〜77 行目(フェーズ列と Raguel のゲート)、161〜170 行目(`CODE_PHASES` と `.codiel/specs/**/scripts/`)である | オーケストレーター | `waves` と `test-code` と `testsDir` の語があり、`.codiel/specs` の語が無い |
| O4-4 | ルートの `README.md` の codiel のセクションに、並列化とテスト駆動と testsDir を足し、コミットする | オーケストレーター | `git status --short` に本改修の変更が残らない |
| O4-5 | テスト駆動の組み直し(決定 73〜79)を ADR にするかを、`metatron:updating-architecture` の手順の中で判断する | オーケストレーターとユーザー(対話) | 判断の結果を §9.3 に記録する |

O4-1・O4-7・O4-8 の結果と Raguel の裁定は §9.3 にある。結果を受けた設計書の追補(決定 84〜109)は、M4-C として §6.6〜§6.8 で入れる。

### 6.6 M4-C は、コード・スキル・レビューの 3 本の Workflow で追補を入れる

M4-C は、手動確認 O4-1・O4-7・O4-8 を受けた設計書の追補(決定 84〜109。§6.15〜§6.19 と、§6.8・§6.13.4・§8 の追補の行)を入れる。終点の受け入れ基準は A7-1〜A7-20・A8-1〜A8-5 と、M4-C が触るファイルでの A2・A5-3・A6 の回帰である。A6-2 と A6-3 の既定値(`docs/tests`)と A6-24 の `raguel.config.yaml` の読み直しは、決定 84・85 により A7-1・A7-2・A7-5 に置き換わる。

- M4-C は、M4 のレビューの修正(`bbb82f27`)と O4-2〜O4-5 の後に始める。M4-C の間に run を始めない。
- codiel のバージョンは `1.0.0` のまま据え置く(設計書 §9)。metatron は、M4C-T06 で文言を直しても `0.4.0-dev` のまま据え置く(§9.4 の 37、§10 の 11)。
- raguel-mcp で変えるのは、設定の読み込み先と `package.json` の依存の `yaml` だけである(決定 88)。`raguel-mcp/package.json` の `version` と `raguel-mcp/docs/` は変えない。
- 依頼文は §1 の共通ブロックを使う。「前の Workflow で確定した事項」には §9.3 の O4A-1 の行を入れ、スキルの Workflow では O4C-1 の行も入れる。
- 新設する参照文書と観点ファイル(`references/e2e-report-format.md` と 2 つの `references/infra.md`)は ARCHITECTURE に触れない。触れると metatron の登録簿のエントリが要る。
- config.json の例のファイルの名前は `skills/initializing-harness/config.example.json` とする(設計書 A7-6 が計画書に委ねた名前)。E2E のレポートの書式の参照文書は、設計書の仮名のまま `references/e2e-report-format.md` とする。

#### 6.6.1 M4-C の前のオーケストレーターの手順

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O4C-0 | この計画書の追補を、1 ファイルだけの docs のコミットにする。`git status --short` の未コミットの変更が `docs/chat/` だけであることを確かめ、HEAD を M4-C の起点として §9.3 に記録する | オーケストレーター | §9.3 に起点の HEAD がある |

#### 6.6.2 Workflow `codiel-m4c-code`

state・hook・init・Raguel・metatron のコードを先に固めてコミットし、スキルの Workflow は確定した CLI と理由文を §9.3 から参照する(M4-A と M4-B の分け方と同じ)。

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `code` | M4C-T01、M4C-T02、M4C-T03、M4C-T05、M4C-T06 | `parallel` | 5 |
| 2 `guard-write` | M4C-T04 | 直列(M4C-T01 の `readCodielConfig` に依存) | 1 |
| 3 `gate` | M4CA-G | 直列 | 1 |

エージェント数は 7 である。phase 1 の 5 タスクは触るファイルが重ならない。M4C-T02 は `codiel-state gitignore` を呼ぶ手順を書くが、コマンドの名前と出力の形は設計書 §6.15.5 が定めているので、M4C-T01 を待たない。

#### 6.6.3 M4-C のコードの後のオーケストレーターの手順

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O4C-1 | M4C-T01〜T06 の報告と M4CA-G から、`readCodielConfig` のシグネチャ、`config` と `gitignore` の出力の形と失敗の文言、`.gitignore` を読む基準のディレクトリ、guard-bash と guard-write の足した理由文(原文)、guard-write の判定の順序、Raguel の設定の出所の表記と読み直しの契機、タスクが依頼文に無く自分で決めた扱いを §9.3 に記録する。書き方は O4A-1 の行に揃える。記録の例(例であり、値は報告の実際の内容に置き換える): 確定した CLI は「`gitignore`: run を要しない。成功時の stdout は `{ "path": ".gitignore", "required": [...], "missing": [...] }`、config.json が不正なら stderr に理由を出して終了コード 1」の形で、サブコマンドごとに引数・出力・失敗の文言を書く。理由文は、guard-bash の push の拒否と `-F body=@<パス>` の案内、guard-write の `<runsDir>/` の ask を、`guard-*.ts:<行>` を添えて原文のまま書く。自分で決めた扱いは「M4C-T01 は、`.gitignore` の末尾の改行の有無を比べ方に含めないことにした」の形で、タスクごとに挙げる | オーケストレーター | `codiel-m4c-skills` の依頼文の「前の Workflow で確定した事項」に入れる |

#### 6.6.4 Workflow `codiel-m4c-skills`

`codiel-m4c-code` の M4CA-G がコミットまで終え、O4C-1 を記録してから始める。

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `skills` | M4C-T07、M4C-T08、M4C-T09、M4C-T10 | `parallel` | 4 |
| 2 `orchestrate` | M4C-T11 | 直列(M4C-T07〜T10 に依存) | 1 |
| 3 `docs` | M4C-T12 | 直列(M4C-T11 に依存) | 1 |
| 4 `gate` | M4CB-G | 直列 | 1 |

エージェント数は 7 である。phase 1 の 4 タスクは触るファイルが重ならない。M4C-T08 は、M4C-T09 が新設する `references/e2e-report-format.md` をファイル名で参照し、書式の中身を写さない。

#### 6.6.5 Workflow `codiel-m4c-review`

`codiel-m4c-skills` の M4CB-G がコミットまで終えてから始める。

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `review` | M4C-R、M4C-FR | `parallel` | 2 |

エージェント数は 2 である。critical・high があれば、修正の Workflow(`codiel-m4c-fix`)で直す。直したファイルに合わせて M4CA-G か M4CB-G と同じゲートをやり直し、直した差分を M4C-R と M4C-FR と同じ観点で確かめてから §6.8 へ進む(§9.2)。medium・low は §9.3 に記録し、ユーザーが扱いを決める。

### 6.7 M4-C のタスク

#### M4C-T01 `codiel-state` の `config` と `gitignore`

- 内容: 設計書 §6.13.4 と §6.15.5 を実装する。
  - `DEFAULT_TESTS_DIR`(`codiel-state.ts:212`)を `docs/codiel/tests` に改め、runsDir の既定 `docs/codiel/runs` を足す。
  - `readCodielConfig`(`:316`)は名前と引数を変えず、戻り値を `{ testsDir: string; runsDir: string }` にする。runsDir には testsDir と同じ不正の判定と正規化を当てる。`raguel` キーは検査せず、有無と中身で戻り値を変えない。
  - `config` の出力に `runsDir` を足す。
  - 新しいコマンド `gitignore` を足す。run を要しない。testsDir から設計書 §6.15.5 の 6 行を `required` に作り、`.gitignore` と比べて無い行を `missing` に返し、`{ "path": ".gitignore", "required": [...], "missing": [...] }` を出す。比べ方(前後の空白を除いた完全一致、`#` で始まる行と空行を数えない、ファイルが無ければ全行)は設計書のとおりにする。`.gitignore` は、ほかのコマンドと同じく cwd(`.codiel` を持つディレクトリ)のものを読む(§10 の 10)。config.json が不正なら非ゼロで終了する。`.gitignore` は書かない(書くのは `/codiel:init`)。
  - 設計書 §8.1 の `config` のテスト(`codiel-state.test.ts:1816` 以降の `docs/tests` の期待値)を新しい既定に改め、§8.2 の「`config`(追補)」と「`gitignore`」の行のテストを置く。`git check-ignore` の判定は、テストの中で作る一時の git リポジトリで確かめる。
  - ほかのコマンドと、M4 より前の state の扱いは変えない。
- 触るファイル: `plugins/codiel/src/codiel-state.ts`、`plugins/codiel/src/__test__/codiel-state.test.ts`(`codiel-state-cli.ts` はエントリの登録が要るときだけ)
- ドメイン: impl
- 依存: O4C-0
- 完了条件: A7-1、A7-3。`pnpm exec vitest run plugins/codiel/src/__test__/codiel-state.test.ts` が通る。`grep -n '"docs/tests"' plugins/codiel/src/codiel-state.ts` が 0 件。報告の notes に、`readCodielConfig` のシグネチャ、`config` と `gitignore` の出力の形と失敗時の文言、`.gitignore` を読む基準のディレクトリを書く
- 委譲先: complex-impl
- スキル: なし

#### M4C-T02 `/codiel:init` の設定ファイル・`.gitignore`・Raguel の設定の移し方

- 内容: 設計書 §6.13.4・§6.15.2・§6.15.5 と、§6.9.1 の「`initializing-harness`・`commands/init.md`・`scripts/install-harness.sh`(決定 84〜87・93)」「`assets/rules/codiel.md`・`CLAUDE.example.md`(決定 84〜90)」の行を入れる。
  - `install-harness.sh`: 無ければ作る config.json の内容(`:12-18`)を、`testsDir` が `docs/codiel/tests`、`runsDir` が `docs/codiel/runs` のものにする。`raguel` と `.gitignore` は書かない。冒頭の注記(`:2-4`)を設計書 §6.15.2 の最後の項目のとおりに改める。保護パスの例外なので直接編集してよい。
  - `install-harness.test.ts`: A7-2 のテストにする。`raguel.config.yaml` を作らないことを確かめるテスト(`:60-74`)は、名前と文言を config.json の `raguel` に合わせる(設計書 §8.1)。
  - `initializing-harness/SKILL.md`: §0 の判定の表の C・D を設計書 §6.13.4 の表にする。手順 2(`:52-61`)を設計書 §6.15.2 の 3 つの場合(`raguel` がある、`raguel.config.yaml` を写して承認を得て消す、どちらも無ければ保護パスを 1 回聞いて `raguel` に書く)に分け、config.json が無いときは手順 1 の `install-harness.sh` を先に実行する。`.gitignore` の手順(`codiel-state gitignore` の `missing`、`# codiel` の行と `missing` の行を末尾に足す差分、承認、既存の行を変えない、`.codiel/` の行で config.json まで無視されるときは聞く。設計書 §6.15.5)を足す。`:94`・`:113` などの `raguel.config.yaml` の記述を config.json の `raguel` に改める。description は M4-T07 の形を保ち、`raguel.config.yaml` を config.json と `.gitignore` に替える。
  - `skills/initializing-harness/raguel.config.example.yaml` を `git rm` で消し(Bash で書き込まない規則の、このタスクだけの例外)、設計書 §6.13.4 の例と同じ形の `skills/initializing-harness/config.example.json` を置く。JSON はコメントを持てないので、出所の順と差分の形の説明は `SKILL.md` に書く。
  - `commands/init.md`: description と本文の `raguel.config.yaml` を、config.json と `.gitignore` に改める。移し方を書くときも `raguel.config.yaml` の語を使わない(A7-6)。
  - `assets/rules/codiel.md` と `CLAUDE.example.md`: testsDir の既定、runsDir、config.json の `raguel`、git に載せない置き場(設計書 §6.15 の表)を書く。`CLAUDE.example.md` の `## Codiel` は `.codiel/config.json` と `runsDir` を含み、`raguel.config.yaml` の語を含まない。
- 触るファイル: `plugins/codiel/scripts/install-harness.sh`、`plugins/codiel/src/__test__/install-harness.test.ts`、`plugins/codiel/skills/initializing-harness/SKILL.md`、`plugins/codiel/skills/initializing-harness/config.example.json`(新設)、`plugins/codiel/skills/initializing-harness/raguel.config.example.yaml`(削除)、`plugins/codiel/commands/init.md`、`plugins/codiel/assets/rules/codiel.md`、`plugins/codiel/CLAUDE.example.md`
- ドメイン: impl、prompt
- 依存: O4C-0
- 完了条件: A7-2。A7-4 の `initializing-harness` の部分。A7-6 のうち、`CLAUDE.example.md`・`commands/init.md`・例のファイル・`assets/rules/codiel.md` の部分と、`skills/` の配下の `docs/tests` の部分(当たるのは `initializing-harness` だけ)。`pnpm exec vitest run plugins/codiel/src/__test__/install-harness.test.ts plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る。`config.example.json` が JSON として読める
- 委譲先: normal-impl
- スキル: `prompt-smith:prompt-smith`、`prompt-smith:skill-creator`(`initializing-harness` と `commands/init.md` の description)

#### M4C-T03 guard-bash の state.json の判定と理由文

- 内容: 設計書 §6.16.2 と §6.16.5 を実装する。
  - `:701` の正規表現の判定を、`parseCommands` の出力の語の列に当てる判定に替える。対象はリダイレクトの行き先と、同じコマンドの区切りの中の `tee`・`sed -i` の引数である。語の中の `>` からの演算子の切り出し、行き先が空のときに次の語を読むこと、クォートの中の `>` の既知の限界は設計書のとおりにする。
  - `parseCommands` と `readWord` は変えず、gh の起動の判定を変えない。`cp`・`mv`・`dd`・`install` の判定(`:707`)は変えない。
  - push の拒否の理由文(`:748`)を設計書 §6.16.5 の形にする。`checkGeneratedMarker` の `denyMissingMarker` の呼び出し(`:668`)で、`command` が `api` の投稿の `inline` に `@` で始まる値があるときだけ、理由文に `-F body=@<パス>` の案内を添える。
  - どちらの理由文も、deny するかどうかは変えない。
  - 設計書 §8.2 の「guard-bash(state.json と理由文)」の行のテストを置く。
- 触るファイル: `plugins/codiel/src/hooks/guard-bash.ts`、`plugins/codiel/src/hooks/__test__/guard-bash.test.ts`
- ドメイン: impl
- 依存: O4C-0
- 完了条件: A7-11、A7-12。`pnpm exec vitest run plugins/codiel/src/hooks/__test__/guard-bash.test.ts` が通り、既存のテストを消していない。`grep -nF '(>|>>|\btee\b|\bsed\s+-i\b)' plugins/codiel/src/hooks/guard-bash.ts` が 0 件。報告の notes に、2 つの理由文の原文を書く
- 委譲先: complex-impl
- スキル: なし

#### M4C-T04 guard-write の E2E のレポートと runsDir

- 内容: 設計書 §6.17.6 と、§6.8 の hook の表の「M4(追補)」の guard-write の行を、設計書が定める位置に入れる。
  - `state.intent` の判定(`guard-write.ts:245`)の直後に、`repoRel` が `<runsDir>/<runId>/unrecorded-gotchas.md` と一致する書き込みを通す免除を置く。config.json が不正なら外す。
  - 文書フェーズの分岐(`:264-280`)で、`<runsDir>/` を `repoRel` で通す。config.json が不正ならこの規則だけを外す。
  - `CODE_PHASES` の分岐(`:281`)で、テストの保護の後・ドメイン境界の前に、`<runsDir>/` への書き込みを実行モードと `domain` によらず ask にする。`<testsDir>/**/reports/**` は対象外とする。理由文は設計書の形にする。config.json が不正で runsDir を決められないときは、コード系フェーズの書き込みを ask にする(test-code を含む)。
  - mapped のドメイン境界(`:337`)に、`<testsDir>/**/reports/**`(`repoRel`)の免除を `.codiel/` の免除と同じ位置に足す。
  - pr・review・triage・finalize の分岐(`:392-393`)は変えない。
  - runsDir は M4C-T01 の `readCodielConfig` で読む。
  - テストは、設計書 §8.2 の R-1〜R-13 を置く。§8.1 のとおり、P 系の既定の testsDir を前提にしたケースを新しい既定か config.json の明示の値に合わせ、`:177-190` の discuss のケースの近くに `<runsDir>/<slug>/` のパスのケースを足す。W 系・P 系と M2 の規則のテストを保つ。
- 触るファイル: `plugins/codiel/src/hooks/guard-write.ts`、`plugins/codiel/src/hooks/__test__/guard-write.test.ts`
- ドメイン: impl
- 依存: M4C-T01
- 完了条件: A7-20。A6-4 が引き続き満たされる。`pnpm exec vitest run plugins/codiel/src/hooks/__test__/guard-write.test.ts plugins/codiel/src/hooks/__test__/guard-github-mcp.test.ts` が通る。報告の notes に、足した理由文の原文と判定の順序を書く
- 委譲先: complex-impl
- スキル: なし

#### M4C-T05 Raguel の設定の読み込み先

- 内容: 設計書 §6.15.1 を `raguel-mcp/src/config/loader.ts` に入れる。
  - 出所の順を、`RAGUEL_CONFIG` → `<cwd>/.codiel/config.json` の `raguel` → 内蔵デフォルトにする。`<cwd>/raguel.config.yaml`(`:19`、`:53-66`)は読まない。
  - `RAGUEL_CONFIG` が指すファイルと `raguel` の値を、同じ形の JSON として読む。`yaml` の import と YAML の読み取りを除く。
  - config.json はあるが `raguel` が無ければ内蔵デフォルトで動き、出所は `defaults` にする。config.json が JSON として読めないとき、`raguel` がオブジェクトでないときは例外を投げる。
  - 出所の表記は `cwd:<config.json の絶対パス>` にし、読み直しは config.json の mtime で判定する(`configCandidate` と `configStamp`)。深マージ・配列の置き換え・`globs` の和集合は変えない。冒頭のコメント(`:3`)を合わせる。
  - `raguel-mcp/package.json` の `dependencies` から `yaml` を除く。`pnpm install` はゲートが行う。
  - テストは、設計書 §8.1 の `loader.test.ts`・`tools.test.ts`(`:340-400`)・`pipeline.golden.test.ts`(`:109`、`:138`)を新しい出所に改め、§8.2 の「Raguel の設定の読み込み先」の行のテストを置く。
- 触るファイル: `plugins/codiel/raguel-mcp/src/config/loader.ts`、`plugins/codiel/raguel-mcp/src/config/__test__/loader.test.ts`、`plugins/codiel/raguel-mcp/src/tools/__test__/tools.test.ts`、`plugins/codiel/raguel-mcp/src/core/__test__/pipeline.golden.test.ts`、`plugins/codiel/raguel-mcp/package.json`(`dependencies` の `yaml` の行だけ)
- ドメイン: impl
- 依存: O4C-0
- 完了条件: A7-5。A6-22〜A6-26 のテストが引き続き通る(A6-24 は A7-5 に置き換わる)。`pnpm exec vitest run plugins/codiel/raguel-mcp/src` が通る。`grep -rn 'from "yaml"' plugins/codiel/raguel-mcp/src` と `grep -n '"yaml"' plugins/codiel/raguel-mcp/package.json` が 0 件。`raguel-mcp/package.json` の `version` が `0.0.1-dev` のまま。報告の notes に、出所の表記と読み直しの契機を書く
- 委譲先: normal-impl
- スキル: なし

#### M4C-T06 metatron の `scan.ts` の古くなる文言

- 内容: 設計書 §13 の最後の段落。`plugins/metatron/src/lib/scan.ts:1652` の検出しない理由の文言から `raguel.config.yaml` を除く。metatron は codiel の資産の置き場に依存しない(設計書 §6.10.2)ので、ファイル名を挙げずに Raguel の設定の解析を伴う旨を書く。「保護パス」の語は残す(`scan.test.ts:643` が確かめる)。
- 触るファイル: `plugins/metatron/src/lib/scan.ts`(`:1652` の 1 行だけ)
- ドメイン: impl
- 依存: なし
- 完了条件: `grep -rn "raguel.config" plugins/metatron/src` が 0 件。`pnpm exec vitest run plugins/metatron/src/lib/__test__/scan.test.ts` が通る
- 委譲先: light-impl
- スキル: なし

#### M4CA-G ゲート

- 内容: `pnpm install`(M4C-T05 が `yaml` の依存を除いたので `pnpm-lock.yaml` が変わる)→ lint → typecheck → test → build を順に実行する。test のタイムアウトは §9.4 の 19 のとおりに扱う。build は `plugins/codiel/scripts/`・`plugins/codiel/raguel-mcp/dist/server.mjs`・`plugins/metatron/scripts/` を作り直す。コミットの前に `git status --short` を見て、未コミットの変更が M4C-T01〜T06 の触るファイル、ビルドが作り直したファイル、`pnpm-lock.yaml`、`docs/chat/` に限られることを確かめる。ほかの変更があれば、コミットせずに blocked で報告する。§7.4 の C4C-1〜C4C-3 のとおりコミットする。codiel・metatron・raguel-mcp のバージョンは変えない(§9.4 の 37)。
- 完了条件: 5 つのコマンドの終了コードが 0。A5-1、A5-2。A7-1〜A7-3、A7-5、A7-11、A7-12、A7-20 と、M4 のテストの基準(A6-1〜A6-6、A6-18、A6-20、A6-22〜A6-28)は `pnpm run test` で判定する。A7-4 の `initializing-harness` の部分の grep。`git status --short` に `docs/chat/` 以外の変更が残らない
- 委譲先: light-impl

#### M4C-T07 review・triage・Raguel のスキル

- 内容: 設計書 §6.9.1 の決定 84〜109 の行のうち、次のスキルの分を入れる。
  - `raguel-gating`: フェーズ→ツール対応表の implement・test-loop・fix-loop の行(`SKILL.md:58`)に、そのフェーズの差分が空なら `git diff <base>...HEAD`(`<base>` は state の `baseBranch`)を渡すと書く(§6.16.3)。Raguel に渡す diff から E2E のレポートを除く pathspec `':(exclude,glob)<testsDir>/**/reports/**'` を書き、空の判定も除いた後の diff で行うと書く(§6.17.4)。誤検知の 1 件の退避先(`:136-137`)を `<runsDir>/<slug>/unrecorded-gotchas.md` に改める(§6.15.4)。
  - `reviewing-diffs`: 本文ファイル(`review-body-<m>.md`・`review-comment-<連番>.md`)を Write で書いて投稿し、コミットしない形に改める(`:103-118`。§6.15.4)。「所見の統合と投稿」の手順 4 に、`commit_id` は PR の head(`gh pr view <PR番号> --json headRefOid` の値)を使い、review では push しないと書く(§6.16.4)。所見書式の観点の列挙(`:69`)に `infra` を足す(§6.17.1)。review の diff から E2E のレポートを除く pathspec を書く(§6.17.4)。
  - 新設 `reviewing-diffs/references/infra.md`: 設計書 §6.17.1 の review の確認項目を、`reviewing-diffs/references/security.md` と同じ構成(観点・両方向の確認・severity の目安)で書く。
  - `reviewing-diffs/references/data.md`: `:12` の `raguel.config.yaml` を config.json の `raguel` に改める。
  - `fixing-review-findings`: 反論・言い直し・対応の本文ファイル(`:53-62`、`:84-88`、`:112-117`)を、コミットせずに投稿する形にする。HARD-GATE の「run ブランチにコミットする」(`:130-133`)を「`reports/` に書く」に改める(§6.15.4)。
  - `filing-followup-issues`: 本文ファイル(`issue-<連番>.md`・`followup-<連番>.md`。`:65-76`)を、コミットせずに投稿する形にする。後続 Issue と intent 草案には、`review-<m>.md` の行を指すだけにせず、所見の内容(severity・対象・内容)を書く(§6.15.4)。
  - 保つもの: A6-13 の `raguel-gating` の test-code の行、A6-29 の `raguel-gating` と `reviewing-diffs` の文字列、`fixing-review-findings` の `set-test-edit`。
- 触るファイル: `plugins/codiel/skills/{raguel-gating,reviewing-diffs,fixing-review-findings,filing-followup-issues}/SKILL.md`、`plugins/codiel/skills/reviewing-diffs/references/infra.md`(新設)、`plugins/codiel/skills/reviewing-diffs/references/data.md`
- ドメイン: prompt
- 依存: O4C-1
- 完了条件: A7-8 の 4 スキルの部分、A7-13、A7-14、A7-16 の `reviewing-diffs` の部分、A7-19、A7-6 の `data.md` の部分。A6-13・A6-29 の該当の grep と、`grep -n "set-test-edit" plugins/codiel/skills/fixing-review-findings/SKILL.md` が引き続き通る。`grep -n "ARCHITECTURE" plugins/codiel/skills/reviewing-diffs/references/infra.md` が 0 件。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4C-T08 implement・test 系のスキルと `/codiel:test`

- 内容: 設計書 §6.9.1 の「`implementing`・`scripting-tests`・`running-regression-tests`・`fixing-failures`(決定 95・103・105)」「`commands/test.md`(決定 91・103)」「新設 `skills/implementing/references/infra.md`」の行と、決定 109 を入れる。
  - 4 スキルの報告(§6.16.1): 報告の本文を最終の返答で返し、報告のファイルを Write で書かず、`git add` もしない。当たる箇所は、`implementing` の `:46-55`、`scripting-tests` の `:16`・`:69`・`:74`(`<report.md のパス>` を除く)、`running-regression-tests` の `:25`・`:54`・`:56`(手順 10 を除く)・`:100-101`(「レポートパス」と「コミットハッシュ」を除く)、`fixing-failures` の手順 9(`:45-48`。最終の返答に書くと明記する)である。報告の書式は変えない。
  - E2E の実行(§6.17.3): 仕様のディレクトリごとにテストフレームワークを 1 回起動し、JSON の出力と、frontend では各ケースの最後の画面のスクリーンショットを、依頼文(worktree の委譲では brief)が指す実行ごとのディレクトリに出す。返答に入れる項目は `references/e2e-report-format.md`(M4C-T09 が新設)に従うと書き、書式を写さない。`scripting-tests` には、スクリーンショットの撮り方をプロジェクトの規約とテストの設定に合わせて決め、返答に書くことを足す。
  - 修正の委譲(§6.17.5): `implementing` の修正モードと `fixing-failures` に、依頼文が渡す最新の E2E のレポート(`failure.md`・`results.json`・画像)を読んで直し方を決めることと、直した実行ごとのディレクトリの名前と直し方を返答に入れることを書く。
  - `running-regression-tests` のレポート書式(`:64-92`): E2E の仕様のディレクトリごとに、その回の `summary.md` か `failure.md` へのリポジトリ相対のリンクの項目を足す(§6.17.5)。
  - 名前の日時(決定 109): `running-regression-tests` の `<ISO日時>`(`:54`、`:64`)と `commands/test.md` の `<ISO日時>`(`:16`)を、ローカルのタイムゾーンの `YYYYMMDD-HHMMSS` に改め、「ローカルのタイムゾーン」の語で定める。
  - 単独実行(`commands/test.md` と `running-regression-tests` の単独実行モード): E2E のレポートを `.codiel/reports/test-run-<日時>/<仕様のディレクトリの ID>/` にだけ置き、testsDir の `reports/` に書かないこと、`failure.md` の直し方を「なし」と理由にすることを書く(§6.17.3、決定 91)。
  - 新設 `implementing/references/infra.md`: 設計書 §6.17.1 の implement の確認項目を、`implementing/references/backend.md` と同じく短い注意の列で書く。
  - 保つもの: A6-9・A6-10・A6-14・A6-17 の文字列、`scripting-tests` の「既存のテストの配置」(A5-3)と「## ツール運用」のセクション、`implementing` の登録簿のエントリが指す記述。
- 触るファイル: `plugins/codiel/skills/{implementing,scripting-tests,running-regression-tests,fixing-failures}/SKILL.md`、`plugins/codiel/skills/implementing/references/infra.md`(新設)、`plugins/codiel/commands/test.md`
- ドメイン: prompt
- 依存: O4C-1
- 完了条件: A7-10 の 4 スキルの部分、A7-16 の `implementing/references/infra.md` の部分、A7-18 の `running-regression-tests` と `commands/test.md` の部分、A8-5 の `running-regression-tests` と `commands/test.md` の部分。A6-9・A6-10・A6-14・A6-17 の該当の grep と、A5-3 の `scripting-tests` の行が引き続き通る。`grep -n "ARCHITECTURE" plugins/codiel/skills/implementing/references/infra.md` が 0 件。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4C-T09 E2E のレポートの書式と GitHub の執筆規則

- 内容:
  - 新設 `references/e2e-report-format.md`(設計書 §6.9.2、§6.17.3): 置き場 `<testsDir>/e2e/{frontend,backend,cli}/<名前>/reports/<実行ごとのディレクトリ>/`、名前 `<日時>-<slug>-try<n>`(日時はローカルのタイムゾーンの `YYYYMMDD-HHMMSS`。決定 109)、中身の表(書く者と内容、JSON を出せないときの最小の形の `results.json`)、md の共通の形(見出しと項目)、ケースの結果の 5 つの値、`summary.md` と `failure.md` の使い分け(Red の確認の実行は `summary.md`)、`failure.md` の直し方の規則(その回の失敗を直した委譲の返答から書く、「未記入」、「なし」と理由を書く 3 つの時点)、委譲先が返答に入れる項目、`/codiel:test` の単独実行の置き場と直し方を書く。md の形の例には、例であることと値を置き換えることを書く。設計書 §6.17.3 の例の `実行:` の値(`20261001T031500Z-…`)は決定 109 の前の形なので、`YYYYMMDD-HHMMSS` の形の値にする(§9.4 の 37)。
  - `references/github-writing.md`: `:25` に、本文ファイルは run の `reports/` に書き、コミットしないことを足す(§6.15.4)。`:41` のローカルの保存先に、E2E のレポートの画像を証拠に使うときは画像の置き場(実行ごとのディレクトリ)を本文に書くことを足す(§6.17.5)。A2-11・A2-23・A6-12 の文字列を保つ。`docs/format-change-checklist.md` の GitHub の執筆規則のセクションに照らして、gh-utility の `github-issue-common.md` の追随が要るかを確かめる。本文ファイルの書き方は写さない項目なので要らないと見込むが、要るなら触らずに blocked で報告する。
- 触るファイル: `plugins/codiel/references/e2e-report-format.md`(新設)、`plugins/codiel/references/github-writing.md`
- ドメイン: prompt
- 依存: O4C-1
- 完了条件: A7-18 の書式の参照文書の部分。A8-5 の書式の参照文書の `YYYYMMDD-HHMMSS` の部分。`grep -n "ARCHITECTURE" plugins/codiel/references/e2e-report-format.md` と `grep -n "T031500Z" plugins/codiel/references/e2e-report-format.md` が 0 件。A2-11・A2-23・A6-12 の grep が引き続き通る。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る。報告の notes に、gh-utility の追随を確かめた結果を書く
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4C-T10 intent と文書系フェーズのスキル

- 内容:
  - `capturing-intent`(決定 107。§6.18.1): 手順 3-3(現状調査)に、持続層を読む前の独立した手順として、見出し(`### ` で始まり「領域名」を含む)を持つ領域名の決定の手順を置く。中身は §6.18.1 の 4 つ(frontmatter の `domains` があれば使う、ドメインマップが読めればキーから選んで手順 4 のドラフトで示す、読めなければ候補を 2〜3 個作って AskUserQuestion で聞く、決めた名前を `domains` に書く)である。run を作る前なので `mark-ask` を使わない。`:117` の文から領域名の決め方を外し、決めた領域の持続層を読む文にする(「TOBE に関係する領域があれば」を残さない)。intent のファイル名と `created` の日付をローカルのタイムゾーンで決めることを、日付を決める手順に書く(決定 109)。
  - `syncing-intents`(決定 108。§6.18.2): 依頼文の取り込み先の領域が空なら取り込みを行わず、取り込みを行わなかった理由(取り込み先の領域が空)と、intent の `## 意図的な制約` に行があったかを報告すると書く。
  - `references/intent-format.md`(決定 109。§6.19): ファイル名と `created`、持続層の取り込み日(`:5`・`:7`・`:18`・`:297`・`:301`)の日付を、実行する機械のローカルのタイムゾーンで付けると定める。領域名の定め(`:285`)は変えない(§6.18.1)。書式の契約なので、`docs/format-change-checklist.md` の「intent 文書と intent-issue の書式」のセクションの追随先を確かめ、結果を報告に書く。`capturing-intent` と `syncing-intents` はこのタスクで直す。ほかの追随先(契約凍結文書の §9・§10、`filing-followup-issues`、`preparing-design-agendas`、gh-utility の `issue-craft`)に追随が要るなら、触らずに blocked で報告する。日付の形は変わらないので、要らないと見込む。追随先の一覧に行を足す必要があるときだけ `docs/format-change-checklist.md` を直す。
  - `facilitating-design-discussions`(決定 89。§6.15.3): 手順 8 のコミット(`:36`)の `<try-dir>` を、依頼文が渡す `<runsDir>/<slug>/` のパスに改める。
  - 保つもの: A2-8・A2-19・A6-19・A6-21・A6-29 の `capturing-intent` の文字列、A6-21 の `intent-format.md` の表、A5-3 の `intent-format.md` と `syncing-intents` の行、登録簿のエントリが指す記述。
- 触るファイル: `plugins/codiel/references/intent-format.md`、`plugins/codiel/skills/{capturing-intent,syncing-intents,facilitating-design-discussions}/SKILL.md`、`plugins/codiel/docs/format-change-checklist.md`(追随先の行を足すときだけ)
- ドメイン: prompt
- 依存: O4C-1
- 完了条件: A8-1、A8-3。A8-5 の `intent-format.md` と `capturing-intent` の部分。A7-7 の `facilitating-design-discussions` の部分と、`grep -rn "<try-dir>" plugins/codiel --exclude-dir=node_modules` が 0 件。A2-8・A2-19・A6-19・A6-21・A6-29 の該当の grep と A5-3 の該当の行が引き続き通る。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る。報告の notes に、`intent-format.md` の追随先を確かめた結果を書く
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4C-T11 orchestrating-runs の `.codiel` の構成・報告・E2E のレポート・取り込みの安全網

- 内容: 設計書 §6.9.1 の「`orchestrating-runs`(決定 84〜106)」「`orchestrating-runs`(決定 108)」の行と、決定 109 を入れる。
  - §0(§6.13.4、§6.15.2、§6.15.5): `codiel-state config` の出力の `runsDir` を読み、依頼文に使う。初期化の判定の表の C・D を設計書 §6.13.4 の表にし、D の判定に `codiel-state gitignore` の `missing` を使う。欠けたら止まり、欠けた項目(C では config.json の `raguel`、D では足りない `.gitignore` の行)を名指しして `/codiel:init` を案内し、`raguel.config.yaml` があれば移すために `/codiel:init` を実行するよう添える。
  - run の文書(§6.15.3): discuss・design・dev-plan の委譲の依頼文に、出力先を `<repoRoot>/<runsDir>/<slug>/<ファイル名>` の絶対パスで書き、後のフェーズの入力にも同じパスを渡す。コミットの時機は変えない。新しい try は同じパスに書き直し、前の try の文書は `git show <前の try のブランチ>:<runsDir>/<slug>/<ファイル名>` で読む。
  - try ごとのもの(§6.15.4): 「`.codiel/runs/` の下のファイルはコミットしない」を書く。pr の `pr-body.md` のコミット(`:262-264`)と、フェーズ進行表のコミット担当の列の本文ファイルと `review-<m>.md` のコミット(`:188-191`)を除く。「失敗の記録」(`:709-712`、`:730-731`)の run があるときの退避先を `<runsDir>/<slug>/unrecorded-gotchas.md` に改め、try で分けずに追記し、既存のエントリを消さない。退避のコミットは残す。run が無いときの `.codiel/reports/unrecorded-gotchas.md` への退避はコミットしない。
  - pr の前の確認(§6.15.6。`:236-238`、`:281`): run の成果物の残りは担当へ差し戻し、E2E のレポートはオーケストレーターがコミットする。run の外のファイルはコミットも退避もせず、`start-phase pr` の後に `mark-ask pr --slug <slug> --kind confirm` で待ち、一覧を示して設計書の 2 つの選択肢で聞き、答えを得たら `resume` する。
  - 報告(§6.16.1): 報告のファイルを持つ委譲の返答を受けた直後に、state の更新や次の委譲より先に、本文を要約せずに報告のファイルへ書く。置き場(`:388-395`)は変えない。環境の失敗の実行し直しでは、実行し直した委譲の返答をオーケストレーターが元の報告の末尾の `## 実行し直し` に書く(`:382-386`)。依頼文テンプレートの完了条件(`:528-530`)に、報告のファイルを持つ委譲は報告の本文を最終の返答で返し、報告のファイルを書かないことを足す。
  - worktree の後始末(`:353-355`。§6.16.6): `git worktree remove` の後に空になった `.codiel/worktrees/<slug>/` を、リポジトリ相対のパスの `rmdir` で消す。
  - 観点ファイル(`:563-566`。§6.17.2): 実装の委譲の観点ファイルを、変更の中身から `skills/implementing/references/` の中で選ぶ。mapped でタグ名と同じ名前のファイルは必ず含め、unscoped でも渡す。review の観点の選び方には規則を足さない。
  - E2E のレポート(§6.17.3〜§6.17.5): 実行ごとのディレクトリの名前をローカルのタイムゾーンの `YYYYMMDD-HHMMSS` で決め、メインの作業ツリーの絶対パスを依頼文と brief に書く。E2E は仕様のディレクトリごとに 1 回起動させる。md(`summary.md`・`failure.md`、JSON を出せないときの `results.json`)は、返答を受けた直後に `references/e2e-report-format.md` に従って書く。コミットは、コード系フェーズで `evaluate_code` を呼ぶ前と、`codiel-state stop` の直前の 2 つの契機で行い、§2.1 の「自分の判断によるコミットをしない」(`:234-235`)の例外に加える。Raguel と review に渡す diff から E2E のレポートを除く。finalize で、この try の途中のパスした実行と Red の確認の実行を、`git rm -r -q --` と `rm -r --`(リポジトリ相対のパス)で消してコミットし、github モードでは push する(2.3 の手順 4 に並べる)。implement の修正と test-loop の修正の委譲に、最新のレポートの絶対パスを渡す。PR・Issue・コメントの証拠には、レポートの画像を `imageUpload` の手段で載せる。
  - intent-sync の安全網(§6.18.2): 委譲の前に intent の `domains` と `## 意図的な制約` を読む。`domains` が空で制約の表に行があれば、`mark-ask intent-sync --slug <slug> --kind confirm` の後に AskUserQuestion で領域名を聞き、frontmatter に書き、`resume` してから委譲する。領域を決めないと答えたら、取り込みを行わずに進む。
  - finalize(§6.18.3): 結果レポートに持続層への取り込みの結果を書き、飛ばしたときは「取り込みを飛ばした理由」を書く。ADR 候補の一覧(`:311-313` の手順 7)でも、候補が無いときに理由を書く。
  - 名前の日時(決定 109): 「ローカルのタイムゾーン」の語で定める。
  - 保つもの: A6-12〜A6-18・A6-29 の文字列、`unscoped` の記述、登録簿の 2 エントリが指す記述、A5-3 の `orchestrating-runs` の行(「unscoped」「前提」「乖離」「未記録の GOTCHAS」)。
- 触るファイル: `plugins/codiel/skills/orchestrating-runs/SKILL.md`
- ドメイン: prompt
- 依存: M4C-T07〜M4C-T10、§9.3 の O4C-1 の記録
- 完了条件: 自分が触る `orchestrating-runs/SKILL.md` に対する grep だけを確かめる。すべてのスキルと文書に対する回帰の grep は M4CB-G が実行する。A7-4・A7-7・A7-8・A7-10・A7-18・A8-5 の `orchestrating-runs` の部分。A7-9、A7-15、A7-17、A8-2、A8-4。A6-12〜A6-18・A6-29 の該当の grep と、A5-3 の `orchestrating-runs` の行が引き続き通る。`pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が通る。`wc -c` の値を報告する
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### M4C-T12 codiel の文書

- 内容: 設計書 §6.9.4 の最後の 2 項目と、§6.15.4 が挙げる同じ退避先を書く箇所を入れる。
  - `docs/DESIGN.md`: §3 の木(`:207-225` 付近。config.json の 3 つのキー、`<runsDir>/<slug>/` の run の文書、`.codiel/runs/<slug>/try-<n>/` の state と報告、E2E のレポート、それぞれの git の扱い)、testsDir の既定(`:208`、`:216`、`:243`、`:339`)、§7 の観点ファイルの列挙(`:525`、`:527`)の `infra`、§8 の hook の表(guard-bash と guard-write の追補の規則)、`raguel.config.yaml` の記述(`:561`、`:568`、`:592`、`:656`)、未記録の GOTCHAS の退避先(`:188-189`、`:607`)、`/codiel:test` の報告の名前(`:440` の `<ISO日時>`。決定 109)を改める。報告を委譲先の返答で受けることと、E2E のレポートの置き場・残す範囲・消す時機を、§2〜§5 の該当の記述に足す。終了状態の記述(M1-T00)を保つ。
  - `docs/skill-flowcharts.md`: 「report.md に記録」のノード(`:207`、`:268`、`:274`)を返答に挙げる形に、退避のノード(`:659`)を `<runsDir>/<slug>/unrecorded-gotchas.md` に改める。
  - `README.md`: `/codiel:init` の説明(`:17`、`:110`)を config.json と `.gitignore` に、testsDir の既定(`:85`、`:101`)を `docs/codiel/tests` に改める。git で共有する置き場と共有しない置き場、以前の版の Raguel の YAML の設定を移すには `/codiel:init` をやり直すこと、testsDir と runsDir を書き換えるのは run が active でないときにすること(設計書 §6.13.4)を書く。移し方の説明でも `raguel.config.yaml` の語を使わない(A7-6。§9.4 の 37)。既知の限界として、`.codiel` は git のルートに置くことを書く(git のルートの下のディレクトリに置くと、`/codiel:init` が足す `.gitignore` の行が当たらない。§10 の 10)。未記録の GOTCHAS の記述(`:29`)を改める。
- 触るファイル: `plugins/codiel/docs/{DESIGN,skill-flowcharts}.md`、`plugins/codiel/README.md`
- ドメイン: docs
- 依存: M4C-T11、M4C-T02(README が init の手順を説明する)
- 完了条件: A7-6 の `README.md` と `docs/DESIGN.md` の部分、A7-7 の `docs/DESIGN.md` の部分、A7-16 の `docs/DESIGN.md` の部分。3 ファイルで `grep -n "<ISO日時>"`・`grep -n "\.codiel/specs"`・`grep -n "mcp__raguel__"` が 0 件。`README.md` に、`.codiel` を git のルートに置くという既知の限界の記述がある。`DESIGN.md` の終了状態の記述が変わっていない
- 委譲先: general
- スキル: なし

#### M4CB-G ゲート

- 内容: lint・typecheck・test・build を実行する。§8.3 の A5-3 の grep と、A2-11・A2-12・A2-23・A6-7・A6-12〜A6-21・A6-29 の grep を回帰として実行する。A7-4・A7-6(ルートの README を除く)・A7-7〜A7-10・A7-13〜A7-19・A8-1〜A8-5 の grep を実行し、複数のタスクにまたがる基準はここで全体を判定する。コミットの前に `git status --short` を見て、未コミットの変更が M4C-T07〜T12 の触るファイル、ビルドが作り直したファイル(あれば)、`docs/chat/` に限られることを確かめる。ほかの変更があれば、コミットせずに blocked で報告する。§7.4 の C4C-5 のとおりコミットする。バージョンは変えない。
- 完了条件: 4 コマンドの終了コードが 0。上の grep(A7・A8 と、回帰の A5-3・A2・A6)を、M4C-T07〜T12 が各自のファイルで確かめた後にも、すべてのスキルと文書に対して実行し、すべて基準どおり。`git status --short` に `docs/chat/` 以外の変更が残らない
- 委譲先: light-impl

#### M4C-R と M4C-FR レビュー

Workflow `codiel-m4c-review`(§6.6.5)で行う。

- M4C-R: M4-C の差分(O4C-0 で記録した起点から M4CB-G のコミットまで)を、設計書 §6.8 の hook の表の「M4(追補)」の行、§6.13.4、§6.15〜§6.19、§8.1・§8.2 の追補の行(R 系と A7 のテスト)、A7、A8 と照らす。次の点も確かめる。
  - guard-bash の state.json の判定が A7-11 の deny のケースを取りこぼさず、gh の起動の判定を変えていないこと。
  - guard-write の判定の順序が §6.17.6 のとおりで、退避先の免除が退避先の 1 ファイルだけに当たること。
  - `gitignore` の 6 行と `git check-ignore` の判定。
  - M4C-T01 の実装と M4C-T02 のスキルの記述(同じ phase で独立に書いたもの)で、`codiel-state gitignore` のコマンド名、JSON のキー名(`path`・`required`・`missing`)、出力と失敗の文言が一致していること。
  - Raguel の設定の出所の表記と読み直しの契機。
  - 報告のファイルを委譲先に書かせる記述が、どのスキルにも残っていないこと。
  - O4C-1 に記録した、タスクが依頼文に無く自分で決めた扱い。
  - 委譲先は code-review。
- M4C-FR: 同じ差分を、設計書 §1 の決定 84〜109 と、それが改めた決定(20・67・75・80)に照らす。§6.9.1 の決定 84〜109 の行と前の行が食い違うところを、決定 84〜109 の行に従って直しているか、A1〜A6 の基準を壊していないか、raguel-mcp の変更が設定の読み込み先に限られるかを見る。委譲先は final-review。
- どちらも所見は §1 の severity の基準で返す。Raguel の作り直しに回す所見(設計書 §6.14.3)は、severity を付けずに「作り直しへ」と分けて返す。

### 6.8 M4-C の後のオーケストレーターの手順

`codiel-m4c-review` の critical・high を `codiel-m4c-fix` で直してから、次の順に行う。手動確認で NO が出たら、所見を §9.3 に記録し、`codiel-m4c-fix` で直し、M4C-R と同じ観点で差分を確かめてから、その確認をやり直す。直した後は、O4C-2 と O4C-3 の結果が古くなっていないかを確かめる。Raguel の ASK と STOP が出たら、裁定と所見を §9.3 に記録する。

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O4C-2 | `/metatron:update` で ARCHITECTURE の乖離を確かめる。続けて `metatron:updating-architecture` を起動し、その手順の中で `.codiel` の構成の組み直し(決定 84〜94。git で共有する設定と run の文書、手元に残す state と報告)を ADR にするかを判断する。この追補で古くなる記述は、ADR-002 の影響範囲の退避の置き場(`harness-docs/ARCHITECTURE.md:182`)、ADR-003 の影響範囲の初期化の判定の `raguel.config.yaml`(`:221`)、ADR-008 の結論の testsDir の既定 `docs/tests`(`:363`)と影響範囲の「`/codiel:init` の判定だけは `.codiel/config.json` も見る」(`:371`)である。ADR にするときは、O4-5 の ADR-008 と同じく、新しい ADR の影響範囲に置き換えを 1 文ずつ書く。ADR-006 の影響範囲(`:311`)に古くなる記述があるかも、同じ手順の中で確かめる。ADR にしないときは、古くなる記述の扱いを同じ手順の中でユーザーに確かめる。ADR の本文は書き換えない | オーケストレーターとユーザー(対話) | 乖離の報告と、ADR にするかの判断と、古くなる記述の扱いを §9.3 に記録する |
| O4C-3 | ルートの `README.md` の codiel のセクション(`:74` の testsDir の既定)を `docs/codiel/tests` に改める。Serena メモリ `codiel/core`(`:17-18`、`:19`、`:32`、`:95`、`:150` の `raguel.config.example.yaml`)と `tech_stack`(`:32` の raguel-mcp の依存の `yaml`)を `edit_memory` で直す。README と Serena メモリの変更をコミットする | オーケストレーター | A7-6 のルートの README の部分。`grep -rn "raguel.config\|docs/tests" .serena/memories/codiel` が 0 件。`git status --short` に本改修の変更が残らない |
| O4C-4 | 手動確認に使う複製を作り直す。前回の複製(`~/codiel-o4-plugins`。codiel 1.0.0 の `bbb82f27`)を、M4-C の最後のコミット(レビューの修正を含む)の `plugins/codiel` と `plugins/metatron` で置き換える。O4C-8 が `/metatron:init` を使うので、metatron も同じコミットの複製にする | オーケストレーター | §9.3 に複製の置き場とコミットを記録する |
| O4C-5 | 画面を持つサンプルを作り直す。O4-7 で使った写し(`~/codiel-o41b`)は run の変更を含むので使わず、O4-6 のサンプル(scratchpad の `o41b/`。消えていれば O4-6 の構成で作り直す)から新しい写しを作る。既存のホーム画面の仕様を、新しい既定の testsDir の `docs/codiel/tests/e2e/frontend/home/` に移す(`spec.md` の frontmatter は `tests` だけ) | オーケストレーター | `docs/codiel/tests/e2e/frontend/home/` に 2 ファイルがあり、`docs/tests/` が無い |
| O4C-6 | O4-1 をやり直す。対象は O4-1a・O4-1b と同じ作業ツリー(M4 の版で `/codiel:init` を済ませ、`raguel.config.yaml` を持つもの)で、O4C-4 の複製の codiel を使い、github モードと local モードで 1 回ずつ run を通す。最初の `/codiel:run` が判定 C と D で止まって `/codiel:init` を案内することを確かめてから、`/codiel:init` をやり直す。init の成果物はコミットせずに残して run を始め、pr の前の確認を通す。要望は、dev-plan が worktree を作る規模にする。設計書 §8.4 の追補の 7 点のうち 1〜6 点目と、O4-1a・O4-1b の不具合の再発を、表の下の「O4C-6」の確認項目で確かめる | ユーザーとオーケストレーター | 結果を §9.3 に記録する。run を終端にする |
| O4C-7 | O4-7 をやり直す。ユーザーが O4C-5 のサンプルを一時の git リポジトリへ写し、最初のコミットを作る(`origin` を持たないので local モード)。`npm install` と Playwright のブラウザの導入(WSL では `npx playwright install-deps chromium` も)の後、`npm test` と `npm run test:e2e` が通ることを確かめてから、`/codiel:init` と `/codiel:run` を実行する。要望と規模は O4-7 と同じにする。設計書 §8.4 の追補の 1 点目(新規の init)・2・3・6・7 点目と、O4-7 の 5 点を、表の下の「O4C-7」の確認項目で確かめる | ユーザーとオーケストレーター | 結果と名前を聞いたフェーズを §9.3 に記録する。run を終端にする |
| O4C-8 | O4-8 をやり直す(設計書 §8.4 の最後の段落)。ARCHITECTURE を持たない一時の git リポジトリで、O4C-4 の複製の codiel と metatron を使い、`/codiel:init` の後に軽量の run を 3 回通してから `/metatron:init` を実行する。1 回目は、intent の `## 意図的な制約` に ADR の 3 条件を満たす判断が入る要望で通し、1・2 点目を確かめる。2 回目と 3 回目は、`## 意図的な制約` に行がある要望で、intent-sync に入る前に intent の frontmatter の `domains` を手で空にする。2 回目は聞かれたら領域名を決めて 4 点目を、3 回目は領域を決めないと答えて 5 点目を確かめる。最後の `/metatron:init` で 3 点目を確かめる。答える項目は表の下の「O4C-8」の確認項目である | ユーザーとオーケストレーター | 5 点の結果を §9.3 に記録する。各 run を終端にする |

O4C-6〜O4C-8 でユーザーに渡す確認項目は次のとおりである。各項目は YES / NO で答えられる形にし、括弧に設計書 §8.4 の追補の何点目か、再発を確かめる不具合と決定の番号を添える。機会が無かった項目は「機会なし」と記録する。

O4C-6(github と local の run。両方の run で答える。review の項目は github モードだけ):

- init の前の最初の `/codiel:run` が、判定 C と D で止まって `/codiel:init` を案内したか(1 点目)
- `/codiel:init` が `raguel.config.yaml` の中身を config.json の `raguel` に写し、承認の後に YAML を消したか(1 点目)
- `/codiel:init` が `.gitignore` の差分を示し、承認の後に書いたか(1 点目)
- run の文書が `<runsDir>/<slug>/` にコミットされたか(2 点目)
- `git log --name-only <base>..<run ブランチ>` に、`.codiel/runs/` の下のファイル・init の成果物・run に関係の無いファイルが 1 つも無いか(2 点目。O4-1b の (2)、決定 84〜94)
- 「Subagents should return findings as text, not write report files」の拒否が 1 回も出なかったか(3 点目。O4-1b の (1)、決定 95)
- 報告のファイルが、オーケストレーターの手で `.codiel/runs/<slug>/try-<n>/` の同じ置き場にあるか(3 点目。決定 95)
- pr の前の確認で、run の外のファイルがコミットされず、`awaiting_human` の後に扱いを聞かれたか(4 点目)
- review の行コメントが PR の head のコミットに付いたか(5 点目。O4-1a、決定 98)
- review で push を試みなかったか(5 点目。O4-1a、決定 98)
- worktree の後始末の後に、空の `.codiel/worktrees/<slug>/` が残っていないか(6 点目。O4-1a の ③、決定 100)
- コミットの trailer の `>` などで、state.json の判定の誤った deny が出なかったか(O4-1b の (2)、決定 96)
- 変更の無いフェーズのゲートで、`evaluate_code` が入力の誤りを返さずに `git diff <base>...HEAD` を受けたか(O4-1b の (4)、決定 97)

O4C-7(画面を持つサンプルの local モードの run):

- 新規の `/codiel:init` が config.json に `raguel` を書き、`.gitignore` の差分を承認の後に書いたか(1 点目)
- `git log --name-only <base>..<run ブランチ>` に、`.codiel/runs/` の下のファイルが 1 つも無いか(2 点目)
- 「Subagents should return findings as text, not write report files」の拒否が 1 回も出なかったか(3 点目)
- 空の `.codiel/worktrees/<slug>/` が残っていないか(6 点目)
- E2E のレポートが、実行ごとのディレクトリに置かれたか(7 点目)
- E2E のレポートの画像が git に載っていないか(7 点目)
- finalize の後に、途中のパスした実行と Red の確認の実行が消えているか(7 点目)
- test-code の Red の確認の実行に、`failure.md` ではなく `summary.md` が置かれたか(7 点目)
- 修正の委譲の依頼文に、最新のレポートのパスが書かれたか(7 点目)
- 失敗した実行の `failure.md` の直し方が、その回の失敗を直した委譲の返答の内容か、「なし」と理由になっているか(7 点目)
- 既にあるホーム画面の名前を聞かれなかったか(O4-7)
- 新しいお問い合わせ画面の名前を、候補が示されてから聞かれたか(O4-7)
- test-code の後に、E2E を含むテストが Red になったか(O4-7)
- implement のグループのマージの後に、run ブランチで E2E がパスしたか(O4-7)
- E2E の仕様が `parallel: true` を持たず、ほかのテストと同時に実行されなかったか(O4-7)

O4C-8(ARCHITECTURE を持たないリポジトリの 3 回の run と `/metatron:init`):

- 1 回目の intent フェーズで、領域名の候補が示されて AskUserQuestion で聞かれたか(1 点目。O4-8、決定 107)
- 1 回目の intent の frontmatter の `domains` に、決めた名前が入ったか(1 点目。O4-8、決定 107)
- 1 回目の intent-sync で `docs/intents/domains/<領域>.md` が作られ、判断が `[ADR 候補: <候補 ID>]` の形で書かれたか(2 点目。O4-8)
- 1 回目の finalize の結果レポートに、ADR 候補が挙がったか(2 点目。O4-8)
- `/metatron:init` で候補が示され、承認した候補が ADR になったか(3 点目。O4-8)
- `/metatron:init` の後に、持続層が参照形に縮んだか(3 点目。O4-8)
- 2 回目で `domains` を空にした run が、`awaiting_human` の後に領域名を聞き、取り込みを行ったか(4 点目。決定 108)
- 3 回目で領域を決めないと答えた run の finalize の結果レポートに、取り込みを飛ばした理由が書かれたか(5 点目。決定 108)

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
| C4A-0 | M4A-G | metatron の縮約の拒否の経路のテスト(M4-T08)。バージョンは上げない(テストだけで、配布する動作を変えない) |
| C4A-1 | M4A-G | codiel(state・hook・init のコード、`scripts/`、`install-harness.sh`、`initializing-harness`、M4-T03・M4-T05 のスキルの変更) |
| C4B-1 | M4B-G | codiel(スキル・参照文書・commands・assets・`CLAUDE.example.md`・文書、M4-T15 の hook と `codiel-state` の `src` とテストと `scripts/`、M4-T16 の `raguel-mcp/src` とテストと `raguel-mcp/dist/`)。Raguel は codiel に同梱するので、同じコミットに入れる |
| C4B-2 | M4B-G | gh-utility(執筆規則と checklist の決定 82 の追随)。バージョンは `0.5.3-dev` のまま |
| C4B-3 | M4B-G | codiel のバージョン `1.0.0` |
| C4C-1 | M4CA-G | codiel(`codiel-state`・guard-bash・guard-write の `src` とテストと `scripts/`、`install-harness.sh`、`initializing-harness` と例のファイル、`commands/init.md`、`assets/rules/codiel.md`、`CLAUDE.example.md`、`raguel-mcp` の `src` とテストと `dist/` と `package.json`)。バージョンは `1.0.0` のまま |
| C4C-2 | M4CA-G | リポジトリ共通(`pnpm-lock.yaml`。raguel-mcp の `yaml` の依存を除いた追随)。C4C-1 の直後に置く |
| C4C-3 | M4CA-G | metatron(`scan.ts` の文言と `scripts/`)。バージョンは `0.4.0-dev` のまま |
| C4C-5 | M4CB-G | codiel(スキル・参照文書・観点ファイル・`commands/test.md`・文書・README)。バージョンは `1.0.0` のまま |

O4C-0・O4C-3 のコミットと、O4C-2 の ADR のコミットは、オーケストレーターが §7 の規則と metatron の CLI とスキルの手順で行う。

---

## 8. 検証

### 8.1 テスト方針

- ユニットテストは vitest で書き、`.claude/rules/metatron/testing-policy.md` の置き場に従う。新設するテストファイルは `plugins/codiel/src/__test__/check-intent-env.test.ts`、`plugins/codiel/src/hooks/__test__/guard-github-mcp.test.ts`、`plugins/metatron/src/lib/__test__/adr-candidates.test.ts` の 3 本である。
- 設計書 §8.1 が書き換えを求める既存のテストは次の 5 つである。
  - `plugins/codiel/src/__test__/codiel-state.test.ts`(M2-T01、M3-T08、M4-T01、M4-T09)
  - `plugins/codiel/src/hooks/__test__/guard-bash.test.ts`(M2-T02、M4-T02)
  - `plugins/codiel/src/hooks/__test__/guard-write.test.ts`(M2-T04、M4-T02)
  - `plugins/codiel/src/hooks/__test__/stop-guard.test.ts`(M2-T02、M4-T02)
  - `plugins/metatron/src/__test__/section-reference-inventory.test.ts` が読む `plugins/metatron/src/fixtures/section-reference-inventory.json`(M1-T05、M2-T13。テスト本体は変えない)
- このほか、`plugins/codiel/src/hooks/__test__/guard-github-mcp.test.ts`(M4-T15)、`plugins/gh-utility/src/__test__/check-issue-env.test.ts`(M2-T07a)、`plugins/metatron/src/cli/__test__/cli.test.ts`(M3-T04)、`plugins/codiel/src/hooks/__test__/lib.test.ts`(M1-T01 のコメント、M4-T02、M4-T15)、`plugins/codiel/src/__test__/install-harness.test.ts`(M4-T10)、`plugins/metatron/src/lib/__test__/adr-candidates.test.ts`(M4-T08)を書き換える。M4-T15 は `codiel-state.test.ts` と `stop-guard.test.ts` も、M4-T16 は `plugins/codiel/raguel-mcp/src/**/__test__/` の既存のテスト(`schema`・`secrets`・`dangerousPatterns`・`loader`・`tools`・`pipeline.golden`)も書き換える。
- M4-C が書き換えるテストは、`codiel-state.test.ts`(M4C-T01)、`install-harness.test.ts`(M4C-T02)、`guard-bash.test.ts`(M4C-T03)、`guard-write.test.ts`(M4C-T04)と、raguel-mcp の `loader.test.ts`・`tools.test.ts`・`pipeline.golden.test.ts`(M4C-T05)である。新設するテストファイルは無い。
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
| A4-2、A4-3、A6-1〜A6-6、A6-18 のテストの部分 | M4-A のタスク(M4-T09・M4-T02・M4-T10)の完了条件。A6-18 のテストの部分は M4-T09 | テスト |
| A6-20、A6-27、A6-28 | M4-T15 の完了条件。最終判定は M4B-G | テストと grep |
| A6-22〜A6-26 | M4-T16 の完了条件。最終判定は M4B-G | テスト |
| A6-29 | M4-T13(`raguel-gating`・`capturing-intent`・`reviewing-diffs`、ツール名は `fixing-review-findings` も)・M4-T14(`intent-common.md` のツール名)・M4-T04(`orchestrating-runs`)・M4-T06(`DESIGN.md` のツール名)の完了条件。最終判定は M4B-G | grep |
| A4-1、A4-4、A6-7〜A6-17、A6-18 の grep の部分、A6-19、A6-21 | M4-B のタスク(M4-T11・M4-T12・M4-T13・M4-T14・M4-T04)の完了条件。A6-19 は M4-T13(`capturing-intent`)。A6-21 と、決定 82 で改めた A2-16 は M4-T14。ただし A6-21 の `capturing-intent` の部分(決定 82 の (5))は M4-T13。A6-12 は M4-T14(`github-writing.md`)・M4-T04(`orchestrating-runs`)。A6-14 は M4-T11(`writing-dev-plans`)・M4-T12(`implementing`)・M4-T04(`orchestrating-runs`)、A6-15 は M4-T04、A6-16 は M4-T11(`writing-design-docs`・`writing-test-specs`・`facilitating-design-discussions`)・M4-T04(`orchestrating-runs`)、A6-17 は M4-T12(`scripting-tests`・`implementing`・`running-regression-tests`・`fixing-failures`)・M4-T04(`orchestrating-runs`)、A6-18 は M4-T14(`intent-format.md`)・M4-T04(`orchestrating-runs`)が分けて持つ。A6-7、A6-14〜A6-18、A6-21 の最終判定は M4B-G | grep |
| A5-1、A5-2 | 各ゲート | grep |
| A5-3 | 各行の担当タスクと、M2 以降の各ゲート(回帰)。最終判定は M3B-G(M3 の行)と M4B-G(全行) | 下の表の grep |
| A5-4 | M3-T04 | テスト |
| A7-1、A7-3 | M4C-T01。最終判定は M4CA-G | テスト |
| A7-2 | M4C-T02。最終判定は M4CA-G | テスト |
| A7-5 | M4C-T05。最終判定は M4CA-G | テスト |
| A7-11、A7-12 | M4C-T03。最終判定は M4CA-G | テスト |
| A7-20 | M4C-T04。最終判定は M4CA-G | テスト |
| A7-4 | M4C-T02(`initializing-harness`)・M4C-T11(`orchestrating-runs`)。最終判定は M4CB-G | grep |
| A7-6 | M4C-T02(`CLAUDE.example.md`・`commands/init.md`・例のファイル・`assets/rules/codiel.md`・`skills/` の配下)・M4C-T07(`data.md`)・M4C-T12(`README.md`・`docs/DESIGN.md`)・O4C-3(ルートの `README.md`)。最終判定は M4CB-G、ルートの README の部分は O4C-3 | grep |
| A7-7 | M4C-T10(`facilitating-design-discussions` と `<try-dir>`)・M4C-T11・M4C-T12(`docs/DESIGN.md`)。最終判定は M4CB-G | grep |
| A7-8 | M4C-T07(4 スキル)・M4C-T11。最終判定は M4CB-G | grep |
| A7-10 | M4C-T08(4 スキル)・M4C-T11。最終判定は M4CB-G | grep |
| A7-16 | M4C-T07(`reviewing-diffs` とその `infra.md`)・M4C-T08(`implementing/references/infra.md`)・M4C-T12(`docs/DESIGN.md`)。最終判定は M4CB-G | grep |
| A7-18 | M4C-T09(書式の参照文書)・M4C-T08(`running-regression-tests`・`commands/test.md`)・M4C-T11。最終判定は M4CB-G | grep |
| A7-9、A7-15、A7-17、A8-2、A8-4 | M4C-T11 | grep |
| A7-13、A7-14、A7-19 | M4C-T07 | grep |
| A8-1、A8-3 | M4C-T10 | grep |
| A8-5 | M4C-T08(`running-regression-tests`・`commands/test.md`)・M4C-T09(書式の参照文書)・M4C-T10(`intent-format.md`・`capturing-intent`)・M4C-T11。最終判定は M4CB-G | grep |
| 設計書 §8.4 の追補の確認(決定 84〜108) | O4C-6〜O4C-8 | 手動確認 |

### 8.3 A5-3 の判定表

設計書 §6.10.1 の依存表のうち、「定める箇所」が「縮退不要」でない行を次の grep で確かめる。「既存」の行は、本改修の前から在る記述であり、担当タスクはそれを消さないことに責任を持つ。M2 の各ゲートは、その時点で対象のファイルがある行を回帰として実行する。M4-C では、M4C-T08(`scripting-tests`)・M4C-T10(`intent-format.md`・`syncing-intents`)・M4C-T11(`orchestrating-runs`)が該当の行を保ち、M4CB-G が全行を回帰として実行する。

| 依存 | grep | 担当タスク |
| --- | --- | --- |
| パス解決 | `grep -n "resolveDocPaths" plugins/codiel/src/hooks/lib.ts` | 既存(M1-T01・M4-T02 が保つ) |
| ドメインマップ | `grep -n "unscoped" plugins/codiel/skills/orchestrating-runs/SKILL.md` | 既存(M2-T10・M3-T03・M4-T04 が保つ) |
| ARCHITECTURE と GOTCHAS を読む | `grep -n "前提" plugins/codiel/skills/orchestrating-runs/SKILL.md` | 既存(M2-T10・M4-T04 が保つ) |
| SessionStart の注入・ARCHITECTURE の更新 | `grep -n "乖離" plugins/codiel/skills/orchestrating-runs/SKILL.md` | M2-F2(§9.4 の 18) |
| GOTCHAS への記録 | `grep -n "未記録の GOTCHAS" plugins/codiel/skills/orchestrating-runs/SKILL.md` | M2-T15(§9.4 の 15) |
| ADR | `grep -n "ADR 候補" plugins/codiel/references/intent-format.md plugins/codiel/skills/syncing-intents/SKILL.md` | M3-T01、M3-T02 |
| ADR の 3 条件 | `grep -n "覆すコスト" plugins/codiel/references/intent-format.md` と、両プラグインの `format-change-checklist.md` の追随の行 | M3-T01、M3-T07、M3-T05 |
| rules を生成物の根拠に読む | `grep -n "方式 b" plugins/codiel/skills/writing-dev-plans/SKILL.md` | M4-T03(M4-T11 が保つ) |
| rules をテストコードの置き場の根拠に読む | `grep -n "既存のテストの配置" plugins/codiel/skills/scripting-tests/SKILL.md` | M4-T12 |
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
| 手動確認の run が active のまま残り、実装セッションの停止を stop-guard が止める | O2-0・O2-4・O3-1・O4-1・O4-7・O4-8 の最後に run を終端にする |
| GitHub MCP のツール名が変わる | M2-T03 が確認の日付と出典を残す。変わったら matcher とテストを直す |
| claude-in-chrome の操作が GitHub の画面の変更で壊れる | 手順に「失敗したら次の手段へ縮退する」を必ず入れる(M2-T08b、M2-T14) |
| 画像のアップロードは取り消せない | E2E は private のテスト用リポジトリで、公開してよい画像だけで行う |
| `workflow-authoring` の API が §0.1 の前提と違う | 実装セッションがスクリプトを書く前にスキルで確かめ、違えば §9.3 に記録して前提を直す |
| test-code の後の run ブランチで、未実装のモジュールを参照するテストのために型検査と全体のテストが失敗する | ステップの検証コマンドとグループの後の実行を「通すテスト」に絞る(設計書 §6.13.1、§6.6.4 の手順 7)。全体は test-loop で通す。M4 のゲートはこのリポジトリのテストを直接走らせるので影響を受けない |
| 並列のグループの委譲が worktree で E2E を同時に実行し、ポートやデータベースが衝突する | テストを実行する委譲を設計書 §6.13.1 の委譲の並べ方で出し、並列可の委譲で実行しなかった通すテストはグループのマージの後にオーケストレーターが実行する(設計書 §6.6.4 の手順 7、決定 30・80)。A6-14 と A6-15 の grep で、規則がスキルに入ったことを確かめる |
| E2E の環境の失敗(サーバーが起動しない、ポートが使用中など)を Red や NG と取り違える | 環境の失敗を別に数え、設計書 §6.13.1 のとおり実行し直して人に確かめる。実行し直しの結果を報告に追記し、再開の後も回数を守る(設計書 §6.2.5)。A6-17 の grep で確かめる |
| 画面名の確認で、design の委譲とウォークスルーの往復が 1 回増える | 新しい画面があるときだけ聞き、既にある画面は聞かない(決定 81)。名前の確認を修正の要望とまとめて、design の委譲を 1 回でやり直させる |
| M4A-G のコミットの時点で、スキルがまだ旧 `.codiel/specs` と Step A を指している | M4-A と M4-B の間に run を始めない。バージョンは M4B-G で上げる |
| guard-write が、保護するフェーズの書き込みのたびに `spec.md` を走査して遅くなる | 走査は implement・test-loop・fix-loop の書き込みだけで行う。O4-1 で体感の遅さを記録する |
| `orchestrating-runs/SKILL.md`(2026-09-28 に 47,776 B)が test-code の運転でさらに大きくなる | M4-T04 に `wc -c` を報告させ、M4-R で重複を見る |
| 対象の作業ツリーが git の linked worktree のとき、codiel の worktree の中で hook が run を見つけない(M4-A の `findMainRoot` が primary の checkout を返す)。このリポジトリがこの形なので、O4-1 でテストの保護とドメイン境界が効かない | M4-T15 が `findMainRoot` を git を呼ばない形に改める(§10 の 6)。A6-20 の linked worktree のテストで確かめる |
| Raguel の応急処置の後も、範囲の外の所見(重さの判定・パネル・resubmission-loop など)による ASK が手動確認の run で出る | ASK は裁定 A・B で、STOP は誤検知の裁定で扱う(設計書 §6.14.2 の (6))。出た ASK と STOP を §9.3 に記録し、作り直しの材料にする |
| パネルが初めて動き、1 回の評価が数分かかる。2 分を超えた MCP の呼び出しは Claude Code がバックグラウンドへ移す(`harness-docs/handover/2026-09-28-raguel-redesign-findings.md` の所見 I2) | 手動確認で所要時間と、バックグラウンドへ移ったかを §9.3 に記録する。移ったら、結果を待ってからゲートの手順を進め、evaluate を呼び直さない |
| common/secrets から `/` を含む語を外すので、`/` を含む高エントロピーの秘密情報を見逃す | 既知の形は引き続き検出する(設計書 §6.14.1)。検出の方式は作り直しで見直す |
| STOP の迂回(`pass-gate --verdict STOP --human-approved`)が、人の裁定なしに使われる | `raguel-gating` の HARD-GATE で、人の明示の答えと `record_outcome` の記録を前提にする(設計書 §6.14.2 の (6))。M4-R で確かめる |
| O4-7 のサンプルの E2E が、ブラウザの依存ライブラリの不足で起動しない(WSL で `libasound.so.2` が無いなど) | run の前に `npm run test:e2e` が通ることを確かめ、通らなければ環境を直してから run を始める。run の中で起きたら、設計書 §6.13.1 の環境の失敗として扱う |
| `orchestrating-runs/SKILL.md`(2026-09-29 に 69,882 B)が M4-C でさらに大きくなる | M4C-T11 に `wc -c` を報告させ、M4C-R で重複を見る |
| M4-C の後、M4 の版で初期化したプロジェクト(O4-1 の対象を含む)は判定 C と D を満たさず、`/codiel:run` が止まる | 設計どおりの動きである(設計書 §6.15.2)。O4C-6 で、止まって `/codiel:init` を案内し、やり直しで設定を移せることを確かめる。README に書く(M4C-T12) |
| M4C-T01 が既定の testsDir を変えると、M4C-T04 が直すまで guard-write の P 系のテストが失敗する | 同じ Workflow の中で M4C-T04 が直し、ゲートで全体を通す(M2-A の行と同じ扱い) |
| guard-bash の state.json の判定を書き直すと、書き込みを見逃す形が生まれうる | A7-11 の deny のケースをテストに置き、M4C-R で取りこぼしを確かめる。変数で渡したパスの既知の限界は据え置く(設計書 §6.16.2) |
| Raguel の作り直しが空の差分を正規の入力にすると、決定 97 の「空なら base からの差分」が合わなくなる | M4-C は決定 97 のまま入れる。作り直しの後に、作り直しの設計に合わせて見直す(§9.4 の 37) |

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
| guard-github-mcp の対象ツールと本文の引数名(O2-1) | M2-T03 の報告。出典は Context7 のライブラリ ID `/github/github-mcp-server`(v1.12.2、2026-09-27 取得)。本文の引数名はすべて `body`。既定で有効なツール: `issue_write`、`add_issue_comment`(reaction だけの呼び出しでは `body` を省略できる)、`update_issue_comment`、`create_pull_request`、`update_pull_request`、`pull_request_review_write`。オプトインの granular 系で有効なツール: `update_pull_request_body`、`create_pull_request_review`、`add_comment_to_pending_review`。計画書 §2 の初期案の `create_issue`・`update_issue` は `issue_write` に統合済みで現行の定義に無いので外した。確定した matcher: `^mcp__.*github.*__(issue_write\|add_issue_comment\|update_issue_comment\|create_pull_request\|update_pull_request\|update_pull_request_body\|create_pull_request_review\|add_comment_to_pending_review\|pull_request_review_write)$`。`body` が文字列でない呼び出しは通し、内部エラーは既存の hook と同じく ask を返す。訂正(M2 の修正、M2-FX-B、2026-09-27): `create_issue` と `update_issue_body` は `issues_granular` に現存し、`add_reply_to_pull_request_comment`(既定)・`submit_pending_pull_request_review`・`add_pull_request_review_comment`(`pull_requests_granular`)も `body` を取る。`update_issue` は旧 `@modelcontextprotocol/server-github`(archived)のツールである。この 6 個を足して対象を 15 個にし、サーバー名は `[Gg][Ii][Tt][Hh][Uu][Bb]` で照合する。出典は Context7 `/github/github-mcp-server` と、`github/github-mcp-server` の `README.md`・`docs/feature-flags.md`、`modelcontextprotocol/servers-archived` の `src/github/README.md`(いずれも 2026-09-27 取得)。Discussions と Projects の書き込みツールは決定 53 の対象外として外した |
| hooks.json の発火確認(O2-0) | 通過(2026-09-27)。ユーザーが `/tmp/codiel-o20` の一時リポジトリで `claude --plugin-dir <worktree>/plugins/codiel --debug-file ...` を起動して確かめた: run が無いとき `gh pr comment 999999 --body "hook test"` は hook を通って gh 自身のエラー(no git remotes found)になった。codiel の hook が読み込まれて動いていることは、Stop の `stop_hook_summary` に `stop-guard.mjs` があることと、PreToolUse:Bash の 2 本目の hook が空出力(通過)を返した記録で確かめた。そのセッションの active run の間の試行はマーカー付きで実行されて通ったため(期待どおり)、マーカー無しの deny は観測できなかった。その 2 点を、同じリポジトリでオーケストレーターが新しいヘッドレスセッション(`claude -p --plugin-dir ... --mcp-config <偽の GitHub MCP> --debug-file /tmp/codiel-o20/debug-headless.log`)で補った: run を awaiting_human にした状態で、`gh pr comment 999999 --body 'hook test'` は「gh pr comment の本文に `<!-- codiel:generated -->` を含めて投稿し直してください」で deny、`mcp__fake-github__add_issue_comment`(matcher のサーバー名に github を含む偽のサーバー。何も投稿しない)は「GitHub MCP の投稿にはマーカーが必要です。本文に <!-- codiel:generated --> を含めて投稿し直してください。」で deny された。debug ログに両方の `permissionDecision: deny` がある。検査用の run はどちらも `stop` で終端にした。M2 の修正(`3cb2b628`)で matcher を変えたので、同じ手順でヘッドレスの確認をやり直した(2026-09-27): scratchpad の一時リポジトリで run を awaiting_human にし、偽のサーバー `FakeGitHub`(大文字を含む)の `add_reply_to_pull_request_comment` と、`gh api --hostname codiel-hook-test.invalid repos/o/r/issues/1/comments -f body='hook test'` を呼んだ。どちらもマーカーが無いので deny された(debug ログに `permissionDecision: deny` が 2 件)。旧版の codiel の matcher は小文字の `github` にしか当たらず、`gh api` も検査しないので、deny は worktree の hook による |
| E2E で確定した手順(O2-3) | 2026-09-27 に private のテスト用リポジトリ `phyllis998/codiel-e2e-test`(ユーザーの承認で作成)で確かめた。gh 2.101.0、claude-in-chrome はログイン済み。4 手段とも成功した。(1) `gh --attach`: 画像のある場所を作業ディレクトリにし、本文に `![alt](./file.png)` を書き、同じ相対パスを `--attach './file.png#alt'` で渡す。`gh issue create`(Issue #1)・`gh pr create`(PR #2 の本文)・`gh pr comment` で、本文の参照が `https://github.com/user-attachments/assets/<uuid>` に置き換わった。`gh pr review` には `--attach` が無い。(2) claude-in-chrome: 新しいタブで PR(または Issue)の画面を開き、`find` でコメント欄(Add a comment のフォーム)の `type=file` の入力を探し、`file_upload` で画像を渡す。「Attach files」のボタンは click しない(OS のファイル選択画面が開き、操作できない)。数秒待つと textarea(`name="comment[body]"`)に `<img width=… alt=… src="https://github.com/user-attachments/assets/<uuid>" />` が入る。`javascript_tool` で値から `https://github\.com/user-attachments/assets/[0-9a-f-]+` の URL を取り出し、textarea の値を空にして input イベントを送り、未投稿の下書きを破棄する(localStorage・sessionStorage に `user-attachments` を含む値が残らないことを確かめた)。タブを閉じ、URL を本文の `![alt](URL)` にして `gh pr review <番号> --comment --body ...` で投稿した(判定を伴うときは `--approve` / `--request-changes`)。前提は、ブラウザで対象リポジトリに書き込める GitHub アカウントにログインしていること。ログイン画面が出る、ファイル入力が見つからない、待っても URL が入らないときは次の手段へ縮退する。(3) ブラウザが使えないとき: 画像付きの本文を `gh pr comment --attach` で投稿し、判定だけを `gh pr review` で行い、レビュー本文でそのコメントの URL を示した。(4) どれも使えないとき: 画像を `reports/` に保存し、本文に載せられなかった理由と保存パスを書いた。可視性: private リポジトリの画像は `private-user-images.githubusercontent.com` から配信され、閲覧権限に従う。テスト用リポジトリの削除はユーザーが行う(gh のトークンに `delete_repo` が無い) |
| M4 の起点の HEAD(O4A-0) | `88c0474a`。O4A-0 の docs のコミットの親で、このコミットにこの記録を含めるために親を起点にした。M4-R は `harness-docs/` を除いて見るので、差分は O4A-0 のコミットを起点にしたときと同じになる。設計書と計画書の見直しはユーザーが 2026-09-28 に承認した |
| M4-A で確定した CLI と hook(O4A-1) | M4-T09・M4-T02・M4-T10 の報告と M4A-G(C4A-1 `508601b7`)。CLI の成功時の stdout は `{ statePath, state }`、失敗は stderr に理由を出して終了コード 1。`step-add --slug --id [--kind step\|test-code\|test-loop] [--files '<JSON 配列>'] [--deps '<JSON 配列>'] [--final] [--domain]`: `--kind` の既定は `step` で、値域の外(`unit` を含む)は拒否する。登録先は `step` が `implement.steps`、`test-code` が `testCode.units`、`test-loop` が `testLoop.units`。`step` は M4-T01 のままで、ID は英小文字と数字のケバブケース、`--files`(空でない配列)と `--deps` が必須。`test-code` と `test-loop` の ID は `^(units/.+\|e2e/backend/.+\|e2e/(frontend\|cli)/[^/]+)$` に一致し、空のセグメント・`.`・`..`・`:`・`\` を含まない(`codiel-state.ts:208`、`:546`)。`--files` は任意で、省くと `[]`、渡せば `step` と同じ検査をして `[]` も受ける。`--deps` と `--final` は値が `[]` でも「<kind> には --deps と --final を指定できません」で拒否する。`--domain` はどの kind でも受ける。登録し直しは、`pending` の要素ならどの表でも上書きし、`merged` の要素は `testLoop.units` だけで受ける。登録し直した要素は `pending`・`group`/`worktree`/`branch`/`commits` が null・`attempts` が 0 になり、キーの位置(worktree の名前の k)は変わらない(`codiel-state.ts:1055-1066`)。それ以外は「<kind> <ID> は <status> のため登録し直せません」で拒否する。`step-update --slug --id [--kind] --status [--worktree] [--branch] [--base] [--head]`: 遷移は §6.2 の表のまま。`--worktree` は `./` と末尾の `/` を落としてから、3 つの表の自分以外の要素の記録と比べ、一致すれば「--worktree <値> は <kind> <ID> がすでに記録しています」で拒否して state を変えない(`:1099`)。記録するのは渡された文字列のままで、null の記録は比べない。`waves` は変えず、test-code と test-loop の要素を出さない。`config`: cwd の `.codiel/config.json` を読み、`{ "testsDir": "<値>" }` を出す。`--slug` も run も要らず、不正な値は終了コード 1。`set-test-edit --slug`: 終端の run は「すでに終端状態です」で拒否し、`state.phase` が fix-loop で `phases.fix-loop.status` が `in_progress` のときだけ `testEdit` を true にする(ほかは「set-test-edit は fix-loop が in_progress のときだけ使えます(phase: …、fix-loop: …)」で拒否)。`clear-test-edit --slug`: 終端の run でも成功し、`testEdit` のキーを消す(false は書かない)。`STAGES` は 13 ステージで 5 番目が `["test-code"]`、`GATED` は test-code を含む 9 フェーズ、`SKIPPABLE` は変えていない(`:119-146`)。設定を読む関数: `export function readCodielConfig(codielRoot: string): { testsDir: string }`(`:314`)。引数は `.codiel` を持つディレクトリ。ファイルかキーが無ければ `{ testsDir: "docs/tests" }` を返し、未知のキーは無視する。不正(JSON として読めない、トップレベルがオブジェクトでない、`testsDir` が文字列でない、空文字列、posix か win32 の絶対パス、`..` のセグメント)は `Error` を投げる。戻り値は `./` と末尾の `/` を落とした値。M4 より前の state: `isLegacy(st)`(`st.version !== 2 \|\| !("test-code" in st.phases)`。export しない。`:290`)で判定し、文言は `legacyMessage`(`:296`)が state の形で設計書 §6.2.4 か §6.6 のテンプレートを出す。受け付けるのは `get`、`stop`(`--reason` を検査しない)、`record-outcome`(`awaiting_outcome` の run への approved・rejected・incident と、`completed`・`rejected` の run への incident)。拒むのは `start-phase`・`skip-phase`・`pass-gate`・`complete-phase`・`mark-ask`・`resume`・`set-domain`・`clear-domain`・`set-integration`・`record-attempt`・`close`・`finalize`・`step-add`・`step-update`・`waves`・`set-test-edit`・`clear-test-edit` と、最新の try が終端でないときの同じ slug への `init` で、文言を stderr に出して終了コード 1、state のファイルは変えない。`get --active` は active と awaiting_human の run を `runs` から除いて run ごとに文言を出し、awaiting_outcome の run は含める。`findActiveRun` はこの run を返さず、読み込み時に test-code を補わない。guard-write の ask の理由文(原文。`guard-write.ts:293`、`:305`、`:331`): テストの保護は `テスト(${repoRel})の変更は test-spec と test-code フェーズの担当です(${phase} 中の変更は改竄の疑い)`。worktree の一致が 2 つ以上は `worktree ${wtRel} を記録した要素が ${n} 個あり(${ラベル})、境界に使うドメインを 1 つに決められません(worktree のパスは run の中で一意のはずです)` で、ラベルは `implement.steps[<ID>]`・`testCode.units[<ID>]`・`testLoop.units[<ID>]` をカンマ区切りで並べる。設定が不正は `.codiel/config.json が不正なため、${phase} 中の書き込みがテストの保護に当たるか判定できません(<readCodielConfig の例外の文言>)`。findMainRoot: `export function findMainRoot(startDir: string): string`(`lib.ts:595`)。`startDir` が `.codiel/worktrees/<slug>/<名前>` を含むときだけ `git worktree list --porcelain` を実行して先頭の `worktree <パス>` を返し、それ以外と git の失敗では `findProjectRoot(startDir)` を返す。guard-write(`:221`)・guard-bash(`:718`)・stop-guard(`:8`)が使い、guard-github-mcp(`:23`)は `findProjectRoot` のまま(M4-T15 が直す)。対象の作業ツリーが git の linked worktree のときの限界は §10 の 6(解決済み。M4-T15 が git を呼ばない形に改める)。init: `install-harness.sh` は `.codiel/runs` と `.codiel/reports` を作り、`.codiel/config.json` が無ければ `{ "testsDir": "docs/tests" }` を書き、あれば変えない。`.codiel/specs` は作らない。`initializing-harness` の判定 D は 3 つの存在である。M4A-G: lint・typecheck・test(177 ファイル・2904 件パス)・build が通った。C4A-0 は `8f89bd45`(metatron のテスト)、C4A-1 は `508601b7`(codiel)。バージョンは上げていない。タスクが依頼文に無く自分で決めた扱い(M4-R で確かめる): M4-T09 は、`readCodielConfig` が不正を例外で知らせること、トップレベルが配列・null・文字列の JSON も不正とすること、testsDir と worktree のパスを正規化すること、`set-test-edit` が終端の run を拒むこと、M4 より前の state で終端でない slug への `init` にも §6.6 の文言を出すこと。M4-T02 は、worktree かどうかを cwd のパスの形で先に見て当たったときだけ git を実行すること、worktree の名前の形(`step-<k>` など)を検査しないこと、fix-loop で設定が不正なら `testEdit` が真でも ask にすること、保護の照合で大文字小文字を区別し testsDir が `.` ならリポジトリ全体とみなすこと、worktree の中の `.codiel/`(worktreeRoot 相対)を従来の免除に入れること、`spec.md` の `tests` をブロックの列・1 行の列・クォートで読むこと(YAML のライブラリは足していない)。guard-bash と stop-guard の worktree のテストは足していない(`findMainRoot` は guard-write の W 系が実際の worktree で確かめている) |
| ARCHITECTURE の乖離と ADR の判断(O4-2、O4-5) | 2026-09-28。`diff-architecture` の乖離は O2-6 と同じ既存の 11 件だけで、ユーザーは扱わないと決めた。テスト駆動の組み直し(決定 73〜79)は、ADR にする 3 条件(覆すコスト、実在した選択肢、自明でない理由)を満たすとして ADR-008 にした(`9d4eebd2`)。ADR-006 と ADR-003 の古くなった記述の置き換えは、ADR-008 の影響範囲に書いた |
| 手動確認の結果(O2-4、O3-1、O4-1、O4-7、O4-8) | O2-4: 2026-09-28 に 2 回の run で行った。run A は github モードで、private のテスト用リポジトリ `phyllis998/codiel-e2e-test` を対象に、M3-A の時点(`11710152`)の codiel の複製を使った。run B は local モードで、`origin` を持たない一時のリポジトリを対象にした。設計書 §8.4 から写した確認項目(§4.6 の一覧)は、どちらの run でもすべて YES だった。指摘は、追加要件として設計書に入れた決定 72〜81 だけだった。O3-1: 2026-09-28 に、ARCHITECTURE を持たない一時のリポジトリで行った。`adrTarget` が `intents` になり、`unscoped` で進んだ(YES)。残りの 3 点(`[ADR 候補]` の書き込みと finalize の報告、`/metatron:init` による ADR 化、持続層の縮約)は検証できなかった。3 つの try がすべて Raguel の common/secrets の STOP で止まったためである。try-1 は test-spec の `evaluate_plan`、try-2 と try-3 は test-loop の `evaluate_code` で止まり、intent のパス、テストの置き場 `.codiel/specs/<unit>/scripts/` のパス、diff の見出しが誤検知された。STOP の後に、オーケストレーターが人に確かめずに次の try を作り、STOP を受けたファイルをゲートなしで持ち込み、事実と違う報告をした(決定 83 の契機)。run は `stop` で止め、intent は書式の規則どおり `abandoned` にした。残りの 3 点は O4-8 でやり直す。O4-1・O4-7・O4-8: 2026-09-28 に、M4 の版(`bbb82f27`)の複製(`~/codiel-o4-plugins`)で行った。O4-1 は 2 回に分けた。O4-1a は unscoped の軽量の run(slug の関数と `node --test`)で、①〜③ がすべて YES だった。③ では、`git worktree list` とブランチからは消えていたが、空の `.codiel/worktrees/<slug>/` が残った(決定 100)。O4-1a の review では、行コメントの `commit_id` に手元のコミットを使おうとして push を試み、guard-bash に止められた(決定 98)。push と `gh api -f body=@` の拒否の理由文は、許すフェーズと正しい渡し方を示していなかった(決定 99)。O4-1b は ①〜⑦ がすべて YES だった。⑤ は implement の間にテストへの書き込みが無く ask の機会が無かったので、M4 の `guard-write.mjs` を implement の一時の run に直接かけて確かめた(記録されたテスト、worktree の中の記録されたテストと `cases.md` は ask、記録されていないソースは通す)。O4-1b では意図しない動作が 4 件あった。(1) Claude Code 本体が、委譲先の `steps/**/report.md` の Write を「Subagents should return findings as text, not write report files」で 3 回拒否し、オーケストレーターが返答から書いて回復した(決定 95)。(2) `.codiel/` の中身が `git status --short` に残り、オーケストレーターが init の成果物と run に関係の無い `docs/chat/` をコミットした。state.json のコミットは guard-bash が誤検知で拒否し(trailer の `<noreply@anthropic.com>` の `>` から `&&` をまたいで当たった)、ユーザーが `!` でコミットしたので run ブランチに state.json が入った(決定 84〜94・96)。(3) Raguel の adversarial のタイムアウトとスコアのぶれ(作り直しへ)。(4) 変更の無い test-loop で、フェーズの差分が空のため `evaluate_code` が入力の誤りを返した(決定 97)。O4-7 は、サンプルを `~/codiel-o41b` に写して標準の規模で行い、5 点がすべて YES だった。名前を聞いたフェーズは design である。WSL で `libasound.so.2` が無く E2E が落ちたので、run の前に `npx playwright install-deps chromium` で直した。O4-7 の後に、ユーザーが E2E のレポートを追加要件にした(決定 103〜105)。O4-8 は 3 点がすべて NO だった。intent の frontmatter の `domains` が空のまま run が進み、intent-sync が持続層への取り込みを飛ばし、finalize は ADR 候補を「対象外」と報告した。intent の `## 意図的な制約` には、説明文書を書く言語を定める制約が 1 行入っていた(決定 107・108)。Raguel の裁定: O4-1a の test-spec の ASK(evaluationId `a99cbf00-df2b-46e8-b000-6419745f2b5b`。irreversible-ops の「削除」の誤検知、パネルの assumption の 5 件、adversarial のタイムアウト)は、as-is で承認した。O4-1b の test-loop は、フェーズの差分が空だったので run 全体の diff を渡し、ASK(evaluationId `c1351661-5c45-45b4-9cb2-7b18f5126c00`)を人が承認した。やり直しは §6.8 の O4C-6〜O4C-8 で行う |
| M4-C の起点の HEAD(O4C-0) | `f9b93a68`(計画書の M4-C のコミット)。設計書の追補は `ce236284`・`2f34ba92` |
| M4-C で確定した CLI と hook(O4C-1) | `codiel-m4c-code` の M4CA-G(`33955eb9` codiel、`efe9db06` pnpm-lock、`c78d1b39` metatron。3003 件のテストがパス)。`readCodielConfig(codielRoot): { testsDir; runsDir }`(`codiel-state.ts:318`)。既定は testsDir `docs/codiel/tests`(:212)、runsDir `docs/codiel/runs`(:213)で、2 つのキーを同じ検査と正規化(`./` と末尾の `/` を落とす)にかけ、`raguel` は見ない。`config`(:1249): run を要しない。成功時の stdout は `{ "testsDir", "runsDir" }`。不正なときは stderr に 1 行(`<config.json> を JSON として読めません`・`… は JSON のオブジェクトにしてください`・`<キー> は文字列にしてください`・`<キー> に空文字列は指定できません`・`<キー> には repoRoot 相対のパスを書いてください: <値>`・`<キー> に .. のセグメントは使えません: <値>`)を出し、終了コード 1。`gitignore`(:1259): run を要しない。stdout は `{ "path": ".gitignore", "required": [...], "missing": [...] }`。`required` は `.codiel/runs/`・`.codiel/reports/`・`<T>/e2e/**/reports/[0-9]*-try[0-9]*/**`・`!…/results.json`・`!…/summary.md`・`!…/failure.md` の 6 行(`<T>` は testsDir)。cwd(`.codiel` を持つディレクトリ)の `.gitignore` を `\r?\n` で分け、行の前後の空白を除いた完全一致で比べる(`#` の行と空行は数えない)。config.json が不正なら `config` と同じ文言で終了コード 1。`.gitignore` は書かない。guard-bash: push の拒否は `push は pr・fix-loop・triage・finalize のフェーズで、test-loop の合格の後にだけ実行できます(現在: ${phase})`(:827)。`gh api` の本文に `@` で始まる `-f` の値があるときだけ、マーカーの欠落の理由文に `。\`-f\` は値をそのまま送ります。ファイルの中身を本文にするには \`-F body=@<パス>\` を使ってください` を足す(:530-538、呼び出しは :674-679)。state.json の判定はクォートが閉じていないとき `splitLoosely` の語で行い、パスは `/\.codiel\/runs\/\S*state\.json/` の部分一致で見る。guard-write の判定の順序: state.json の deny(:197)→ active run → `state.intent`(:252)→ config を 1 回読む(:254-262。不正なら null)→ 未記録の GOTCHAS の退避先 `<runsDir>/<runId>/unrecorded-gotchas.md` を通す(:264-274)→ `docs/intents/**` → 文書フェーズ(:294。`<testsDir>/`・`<runsDir>/` を repoRel で通す)→ コード系フェーズ(:310。テストの保護 → config が null なら ask(test-code も)→ `<runsDir>/` を ask(E2E のレポートを除く)→ ドメイン境界に `<testsDir>/**/reports/**` の免除)→ pr・review・triage・finalize(:441-443。変えていない)。理由文は `run の文書(${repoRel})は文書フェーズで書きます(${phase} 中の変更は想定外)`(:351)と `.codiel/config.json が不正なため、${phase} 中の書き込みが run の文書(runsDir)に当たるか判定できません(${configError})`(:343)。Raguel の設定の出所の表記は `env:<パス>`・`cwd:<config.json の絶対パス>`・`defaults`。読み直しは RAGUEL_CONFIG か cwd の config.json の有無と mtime で判定し、`raguel` 以外のキーの書き換えでも読み直すが `configHash` は変わらない。タスクが自分で決めた扱い: gitignore の行に testsDir をエスケープせずに入れる(T01)。init は config.json が JSON として読めないときの修復を承認付きで行い、YAML は Bash の rm で消すと書いた(T02)。tee と sed -i の判定の細目と、`tee "<" <パス>` の見逃しを既知の限界に加えた(T03)。E2E のレポートは testsDir の後ろの `reports/` のセグメントで判定し、runsDir が `.` でも組み立てられるよう `path.posix.join` を使った(T04)。手順の逸脱: T01 が `codiel-state.ts` の、T05 が `loader.ts` と `pipeline.golden.test.ts` の編集の一部を Bash(sed・python)で行った(内容はテストで確かめた。M4C-R で差分を見る)。T02 が DESIGN.md に `raguel.config.example` の語が残ることを報告(M4C-T12 の範囲) |
| ARCHITECTURE の乖離と ADR の判断(O4C-2) | (未記録) |
| 手動確認のやり直しの結果(O4C-4〜O4C-8) | (未記録) |
| `agent()` の委譲先の指定(§10 の未決事項 1) | 指定できる。`workflow-authoring` スキルの記述では、`agent()` の `opts.agentType` に Agent ツールと同じレジストリのサブエージェント名を渡せ、`schema` と併用できる。役割マーカーの対応表の定義を次のとおり指定する: complex-impl → `lead-implementer`(opus)、normal-impl → `claude-implementer`(sonnet)、light-impl → `claude-light-implementer`(haiku)、general → `general-worker`(sonnet)、code-review → `code-reviewer`(sonnet)、final-review → `claude-complex-reviewer`(fable)。各定義は担当表の Claude モデルと同じ `model` を宣言しているので、`opts.model` は渡さない(2026-09-27 確認) |
| 設計書との食い違い(実装中に見つかったもの) | M1-T01: `check-intent-env.ts` は `findDocRoot` を直接 import せず、`resolveDocPaths` が内部で解決した `docRoot` を使う(git の子プロセスを増やさず、文書パスと docRoot を同じ解決結果にするため)。独自の写しを持たないという §6.9.3 の目的は満たすので採用した。M1-T02・T05: `sandalphon-common.md` の ARCHITECTURE への言及は環境チェック(`:20-30`)にあり、capturing-intent の本文へ吸収された。登録簿は `intent-common.md` ではなく `plugins/codiel/references/intent-format.md` と `plugins/codiel/skills/capturing-intent/SKILL.md` の 2 エントリにした。M2-T04: `state.intent` との照合に使う相対パスを、repoRoot ではなく `codielRel`(`.codiel` を持つ祖先が基準)で求めた。`.codiel` と git ルートが同じ通常の構成では一致するが、ずれる構成では設計書 §6.8 と食い違うので、M2-R で確かめる。M2-R と M2-AR が high として挙げ、M2 の修正(M2-FX-A、`3cb2b628`)で repoRoot(`lib.ts` の `findRepoRoot`)基準に直した。M2-T04 はテストファイルの全面書き換えに Serena ではなく Write を使い、M2A-G は lint の整形を biome で自動修正した(どちらも内容は差分とテストで確認済み)。M2-T08b: `github-writing.md` は構成を `intent-writing.md` に揃えたが、根拠と背景の残す・削るの表は再掲していない。設計書 §6.12.3 の「構成は Intent 文書の執筆規則に従う」を満たすかを M2-R で確かめる |
| レビューの medium / low | M1-R: low 1 件。`plugins/codiel/docs/DESIGN.md` の統合セクション(§12)の導入文 2 文が「節」を使っていた。直訳語を使わない制約に当たるので「セクション」に直した(O1 の手順でコミット)。移設した本文の「二段構え」と、契約文書の規則番号を指す「段 3」は直していない。M2(M2-R・M2-AR と修正の再レビュー 6 回。所見の全文はセッションの scratchpad の m2-reviews.txt〜m2ef-reviews.txt。実装セッションの一時領域にあり、残らない): critical・high はすべて修正 Workflow(M2-FX〜M2-FX5、M2-E、M2-EF)で直し、経緯は §9.4 の 18〜29 にある。ユーザーが直すと決めた medium・low(stop-guard の理由文、「節」の残り、heredoc の誤検知、`--fill`・`-T`、v1 の outcome)も直した。直さずに残したものは、guard-bash の既知の限界(設計書 §6.8 の一覧。決定 69)と、guard-write の DOC_PHASES の `docs/` の判定が codielRel のままであること(`.codiel` が git ルートの下にある構成で、文書フェーズの `docs/intents` 以外の文書への書き込みが ask になる。変更前から同じ)である |

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
18. ユーザー決定(2026-09-27): `plugins/codiel/CLAUDE.example.md` から ARCHITECTURE・GOTCHAS・metatron の言及を外す。metatron が無い環境では不要で、有る環境では metatron の SessionStart の注入が伝える。見出し「文書の扱い」は intent 文書・持続層・テスト仕様書の扱いのために残した。ARCHITECTURE との乖離の縮退(報告に残すだけにする)は `orchestrating-runs` の依頼文テンプレートと finalize が持つ。これで 14 の「見出し『文書の扱い』は残す(A5-3)」は根拠を失い、§8.3 の A5-3 の「SessionStart の注入・ARCHITECTURE の更新」の行は `grep -n "乖離" plugins/codiel/skills/orchestrating-runs/SKILL.md` に替わった。「GOTCHAS への記録」の行も 15 に従い `orchestrating-runs` へ替えた。設計書は決定 58・59 と §6.10.1 で追随した。M2-D の M2-F2 が行った。
19. M2D-G の `pnpm run test` が、全体の負荷でタイムアウトして止まった。1 回目は guard-write の review・fix-loop・finalize のテスト(1 件 13 秒)と raphael の detect-infection のテスト(11 秒)である。M2-F1 が guard-write のテストの state を CLI ではなく直接組み立てる形にして、ファイル全体を約 130 秒から約 40 秒に縮めた。2 回目は raphael の detect-infection のテスト(本改修の範囲外で、単独では通る)だけがタイムアウトした。各ゲートの手順 2 に次の扱いを足した: 失敗がすべてタイムアウトで、失敗したテストファイルがそのワークフローで変えていないものに限り、そのファイルを単独で 1 回実行し、通れば `pnpm run test` を 1 回だけやり直す。raphael のテストの不安定さは GOTCHAS の候補として完了報告に載せる。
20. M2 のレビュー(M2-AR の high)で、codiel のスキルが `gh api` で PR へ本文を投稿する(reviewing-diffs の行コメント、fixing-review-findings の反論)のに、guard-bash の対象が設計書 §6.8 の `gh` の 7 コマンドだけだと分かった。決定 53 は「`gh` のコマンドは guard-bash で強制する」とするので、M2 の修正(M2-FX-B)が `gh api` の書き込みを対象に加えた。判定の規則と、残る抜け道(GraphQL の query に本文を直接書く形、`body` 以外の名前のフィールド)は設計書 §6.8 と決定 60 に書いた。同じ修正で GitHub MCP の対象ツールを 15 個にした(§9.3 の O2-1 の行の訂正)。
21. M2 のレビュー(M2-AR の high)で、`mark-ask` が run とフェーズの状態を確かめず、passed のゲートを巻き戻し、終端の run を生き返らせることが分かった。M2 の修正(M2-FX-A)が、終端の run・passed のフェーズ・finalize 以外の `pending` のフェーズへの `mark-ask` を拒否するようにし、branch が null の run では `skip-phase` も拒否するようにした。フェーズの合間(直前が passed、次が pending)には `mark-ask` できるフェーズが無くなったので、オーケストレーターが `orchestrating-runs` §2.4 に「次のフェーズを `start-phase` してから `mark-ask` する」を足した。設計書は決定 61 と §6.2.2 で追随した。
22. M2 のレビュー(M2-AR の high)で、設計書 §6.1.2 の手順 0 が、ユーザーが再開したい run まで終端にしてしまうと分かった(`commands/run.md` の「未完了の run があれば再開」と衝突する)。M2 の修正(M2-FX-C)が capturing-intent の手順 0 と orchestrating-runs §1 を、再開する run は終端にせず §6 の再開手順へ進め、終端にする run はユーザーに示して確かめる形に改めた。設計書は決定 62 と §6.1.2 の手順 0 で追随した。同じ修正で、§6.2.3 の slug の規則(40 文字、`issue-<N>` の禁止、同日の重複の `-2`)を capturing-intent と `intent-format.md` に書き、A2-19・A2-23 の固定文字列を本文に載せた。
23. M2 の修正の再レビュー(M2-FX-R)と確認のレビューで、capturing-intent の手順 5 の (6) の `git commit` の失敗時の扱いが、決定 61 の `mark-ask` の拒否と HARD-GATE の両方に反すると分かった。`96315cfd` と 2 本目の修正(M2-FX2、`6fc749d2`)が、`stop --reason commit-failed` で終端にしてから確かめる形に改め、intent を `abandoned` にしない例外を `intent-format.md` に足した。3 本目の修正(M2-FX3)が、前の try が commit-failed のときに try-2 の持ち込みが承認済みの intent を上書きする問題を直す。設計書は決定 68 と §6.1.1・§6.1.2(手順 5・6)・§6.3.2 で追随した。
24. ユーザー決定(2026-09-27): v1 の state で `awaiting_outcome` の run の outcome を記録する(Jev の判定は割れた。confidence 0.36〜0.41)。`get --active` はこの run を `runs` に含め、`record-outcome` を受け付ける(M2-FX2)。`completed` / `rejected` の v1 の run への incident も受け付ける(M2-FX3)。設計書は決定 63 と §6.2.2・§6.2.4・A2-3 で追随した。§9.3 の O2-1 の行の「v1 の state は `get` と `stop` だけが受け付け」は、この例外を除いた記述として読む。同じ日のユーザー決定で、`gh pr create` の `--fill` 系・`-T` と `gh issue create` の `-T` を deny し(決定 64)、stop-guard の理由文を決定 52 に合わせ、heredoc の本文の行を gh の起動と見なさないようにした(M2-FX2)。M2-FX2 の再レビューで、heredoc の除外が閉じていない heredoc と here-string で後続の行を検査から外すこと(critical)、`-f` と結合した短いフラグ、行継続の `\` のすり抜けが見つかり、M2-FX3 が直す。
25. ユーザー決定(2026-09-27): Issue・PR のテンプレートの扱いを、アドバイザーとの壁打ち(事実調査 2・案出し 3 切り口・批判・まとめの Workflow)で決めた。テンプレートはスキルが読んで構成に使い、マーカー付きの本文を `--body-file` で投稿する。PR テンプレートの手順は今入れる。intent-issue は据え置く(決定 65)。壁打ちの批判が実測で示した hook の穴 3 つ(同じコマンドでの本文ファイルの書き換え、1 つのマーカーで複数の投稿が通る、`gh pr create --web`)を hook で塞ぐ(決定 66)。本文ファイルは `review-<n>.md` と同じく run ブランチにコミットする(決定 67)。gh 2.101.0 は TTY の無い環境で `-T` を拒み、`-T` と本文のフラグの併用も拒むので、決定 64 のうち実効があるのは `--fill` 系の deny である。M2-FX3 が行う。
26. M2 の修正を 3 回回しても、敵対的レビューが guard-bash のシェル構文の端のケース(本文のコマンド置換、クォートの中のフラグ、フラグの繰り返し、`-R` の位置、クォートしない heredoc の中のコマンド置換)を毎回新しく見つけ、収束しなかった(M2-FX3-AR)。オーケストレーターが決定 53 の「codiel を通さない投稿までは追わない」から hook の検査の範囲を決定 69 として明記し、以後のレビューはこの範囲で重さを決める。M2-FX4 が、範囲の中の穴と誤検知(タイトルの `--web` での deny など)を直し、stop-guard の passed の案内、レビュー本文と反論の本文ファイル化、triage の mark-ask の残りを直す。
27. M2-FX4 の再レビュー(M2-FX4-AR)で、空白を置いた `cat << 'EOF'` などの heredoc を開始と見なさず、本文の対になっていないクォートが後ろの gh の投稿を飲み込む退行(high)が見つかり、M2-FX5 が直した(`5510201f`)。M2-FX5 の再レビューで critical・high は 0 件になった。M2-FX5 の medium・low(stop-guard の理由文の作業タグと intent-only の close の案内、取りこぼしを拾い直す方式の代入の形、fixing-review-findings の local モードの条件、パスの `<n>` の二重の意味)は、下の 28 の Workflow で直す。設計書 §6.8 は、M2-FX5 の規則と既知の限界に追随した。
28. ユーザー決定(2026-09-27): codiel の運用の規律を CLAUDE.md から `.claude/rules/codiel.md`(`paths` の指定なし)へ移す。CLAUDE.md はセッションの最初にだけ読まれるので、最初に知っておくべき知識だけを置く。`CLAUDE.example.md` の 7 項目(文書の扱い 3、規則 4)はすべて規律なので rules へ移し、CLAUDE.md には置き場の地図と入口のコマンドだけの「## Codiel」を置く。既存の CLAUDE.md の旧セクションは、承認を得て取り除く。設計書の決定 70 と §6.9.4。M2-E(`codiel-m2-rules`)として、27 の medium・low と合わせて行う。
29. M2-E(`a64f271e`)と、その再レビューの所見の修正(`cf5db5c0`)を行った。修正の再レビュー(M2-EF-R)は、閉じていないクォートを残したときに使う読み直し(splitLoosely)が引数の値の `NAME=gh` を gh の起動と読む誤検知を high とした。この方式は設計書 §6.8 が「厳しい側で検査する」と定め、入るのは開始として受けない heredoc の本文に対になっていないクォートがあるときだけなので、オーケストレーターは決定 69 に従い既知の限界として §6.8 に記録し、コードは直さなかった。同じ方式での取りこぼし(M2-EF-AR の low 2 件)も同じ扱いにした。`<m>` の定義文(reviewing-diffs の手順 1、orchestrating-runs のフェーズ進行表の前)と設計書 §6.9.4 の見出しの判定の表現は、オーケストレーターが直した。これで M2 のコードの修正を終える。
30. O2-5 で ADR-006 を起票した(`5a5d86b4`)。ユーザーのレビューで、背景には現状の事実だけでなく決定が必要になった事情を書くこと、AI 向けの指示書としてできるだけ簡潔に書くことなどが決まり、ユーザー決定(2026-09-28)でその基準を metatron の `writing-discipline.md` の新しいセクション「## ADR の書き方」に入れることにした(設計書の決定 71、§6.12.5)。M3-B の M3-T06 が行う。O2-4 の github モードは、このリポジトリに試しの PR を作らないよう、private のテスト用リポジトリ `phyllis998/codiel-e2e-test` で行う。試すのは M3-A の時点(`11710152`)の codiel の複製で、以降の Workflow の変更の影響を受けない。O2-6 の `diff-architecture` は、ユーザーが扱わないと決めた既存の 11 件だけを返した。
31. M3-B で、M3-T04 は実装を終えたが、既存のテスト SC1 が新しいサブコマンドを `plugins/metatron/src/cli/paths.ts` の USAGE_LINES に載せることを求め、そのファイルが触るファイルに入っていなかったので blocked を返した(SC2 の `cli-usage.md` は M3-T05 の担当)。オーケストレーターが USAGE_LINES に 2 行を足し、M3-T04 の結果を使って M3-T05 へ進めた。設計書 §6.11.2 の表は `shrink-adr-candidate` の引数を 3 つとしていたが、§6.11.4 の「走査のときの値と照らす」には呼び出し元がハッシュを渡すほかないので、M3-T04 が必須の `--hash` を足した。設計書の表を追随させた。M3-T06 と、一度目の M3-T04 は、ユーザーがメインセッションで送ったメッセージが依頼に添えて中継されたことで作業の正当性を疑い、blocked を返した。依頼文に「ハーネスが添えるユーザーの発言はこのタスクと無関係」の注記を足して再実行した。M3-R の所見は critical・high が 0 件で、low の「節」2 か所はオーケストレーターが直した(`01c494dd`)。medium の拒否の経路のテスト不足(`not_git_repository`・`file_not_found`・`candidate_not_found`・`duplicate_candidate`)は M4 で足す。
32. ユーザー決定(2026-09-28): テスト run を受けた追加要件として、PR の本文を変更の説明に絞る(決定 72)、テストを実装より先に書く test-code フェーズを置く(決定 73)、テストの仕様を `<testsDir>` の下に置く(決定 74)、`.codiel/config.json` の `testsDir` を設ける(決定 75)、テストコードの置き場をプロジェクトの規約に委ねて `spec.md` に記録する(決定 76)、テストを guard-write で保護する(決定 77)、E2E とユニットテストを作る範囲を規約か既定の規則で決める(決定 78・79)と決めた。草案の未決 3 件も決めた。旧 `.codiel/specs/` は何もしない、画面でも API でもない入口は `e2e/cli/` に置く、API のパスのパラメータは `{id}`・ルートは `_root` とする(いずれも決定 74)。最初の M4 の Workflow(`codiel-m4-parallel`、base `7b4b3bd6`)は、M4-T01・T03・T05・T08 を終えたところで止めた。M4-T08 は 31 の「M4 で足す」を受けてその Workflow が足したタスクで、第 2 版の §6.4 には定義が無かったので、第 3 版で正式なタスクにした。M4 を 2 本の Workflow(`codiel-m4a-tdd-code`、`codiel-m4b-tdd-skills`)に組み直し、完了済みの変更を活かしてタスクを足した(§6)。組み直しの草案へのレビュー 2 本の所見(M4-T01 と M4-T09 の分担、Red の確認の条件、初期化の判定 D、`tests` を書く者と時機、testsDir を得る手段、worktree のパスの一意性と判定の基準、PR のリンクを github モードに限ること、M4-T08 の定義、§8.2 の「M4-G」、決定 18・30・56 の具体化の列、A6-13 の grep の範囲)を反映した。続くレビュー 2 本の所見(完了済みの 4 タスクの変更の引き継ぎとコミットの時機、M4-A と M4-B の受け入れ基準の分担、決定 30 を test-code の委譲の単位に当てること、`raguel-gating` の `evaluationId` の選定順、test-loop の brief と report の置き場、フェーズ進行表の `[test-loop A]`・`[test-loop B]` の 2 行)も反映し、§6.0 に O4A-0 を足した。設計書は決定 72〜79、§4.6、§6.12.8、§6.13 などで追随した。
33. ユーザー決定(2026-09-28、2 回目の見直し): 32 の組み直しは、worktree の中で実行できない E2E を通すテストから外し、test-loop で通すとしていた。ユーザーは、E2E も implement で通すと決めた(設計書の決定 80)。オーケストレーターの指定で、worktree で実行する通すテストは決定 30 と test-code の手順 3 と同じ考え方で選ぶ。同じグループのほかの委譲が動いている間は `parallel: true` のものだけを実行し、ほかの委譲が動いていなければすべてを実行する。実行しなかったものは委譲先が `report.md` に挙げ、グループのマージの後にオーケストレーターが run ブランチで E2E を含めて実行する。test-loop の修正の委譲も worktree でテストを実行するので、決定 30 で並べる(決定 30 を改めた)。新しい画面の仕様の名前はユーザーに聞き、既にある画面の名前は聞かない(決定 81)。軽量の run の手順(いつ誰が候補を出し、いつ聞くか)と、聞いた記録の残し方は執筆者に委ねられた。設計書は、軽量の run では test-spec の開始時に同定の委譲を 1 回だけ出して一覧と名前の候補を作り、`mark-ask test-spec --kind confirm` で聞いてから test-spec と dev-plan に同じ一覧を渡す形にした(§6.1.4)。記録は既存の `askKind` の `confirm` に残し、確認の種類は足さない。受け入れ基準 A6-14〜A6-16 を足した。計画は M4-T11(`facilitating-design-discussions` を触るファイルに足した)・M4-T12・M4-T04・M4-T06・M4-T07・M4B-G・M4-R・M4-FR と §8.2 を改めた。M4-T09・M4-T02・M4-T10・M4-T13 は、CLI・hook・init・PR 本文に変更が無いので改めていない。エージェント数は変わらない。続く見直し(2026-09-28)で、テストを実行する委譲の並べ方を設計書 §6.13.1 の 1 つの規則(並列可の委譲と単独の委譲)にまとめ、E2E の実行環境と環境の失敗の扱い(§6.13.1)と、M4 より前に作った state の run を既存の `stop --reason migrate` で止めて新しい try を始める手順(§6.6)を決め、M4-T04・M4-T06・M4-T09・M4-T11・M4-T12(`scripting-tests` のツール運用のセクションを保つことを含む)・M4-T13 と A6-15・A6-17・A6-18 を改めた。あわせて §9.3 に O2-4 の結果を記録し、§10 の未決事項 3 を閉じた。その後の見直し(オーケストレーターの決定、2026-09-28)で、環境の失敗の実行し直しを implement のタスクレビューとマージの前に置き、結果を報告の `## 実行し直し` に追記して再開の後も 1 回を守る形にし、設計書 §6.6.4 の規則の重複を参照に改めた。M4 より前の state を state の形で判定して CLI が v1 の run と同じ形で拒むこと、新しい try の intent を手順 1 の最新化の後に持ち込むこと、`scripting-tests` のツール運用の目的の書き直しも決め、M4-T04・M4-T09・M4-T12・M4-T13 と A6-1・A6-17〜A6-19・§10 の 5 を改めた。さらに続く見直し(オーケストレーターの決定、2026-09-28)で、並列可の委譲を同じ応答からまとめて出す規則を設計書 §6.13.1 に戻して `orchestrating-runs` §4.1 の逐次ディスパッチの段落を書き直すこと、run ブランチ上の修正の報告の置き場(`merge-fix-<g>`・`test-loop-project`)、オーケストレーター自身の実行し直しを記録しないこと、再開で確かめる報告の範囲、state の `intent` による再開する run の照合を決め、M4-T04・M4-T12・M4-T13・M4-R と A6-15・A6-17・A6-19 を改めた。次の見直し(オーケストレーターの決定、2026-09-28)で、state の `intent` だけで当たった run を再開の前に確かめること、run を探す 2 つの方法の使い分け、`merge-fix-<g>` の g の求め方、照合する run も intent のファイルも無いときの確認を設計書 §6.1.2 と §6.6.4 に足し、`:407` の書き直しをレビューの規律を残す形に改め、M4-T04・M4-T13 と A6-19 を改めた。
34. M4-A(`codiel-m4a-tdd-code`)を終えた(2026-09-28。C4A-0 `8f89bd45`、C4A-1 `508601b7`)。O4A-1 として、確定した CLI・設定を読む関数・M4 より前の state の扱い・guard-write の理由文・`findMainRoot`・init の振る舞いを §9.3 に記録した。M4-A のタスクが報告した食い違い 3 件は、オーケストレーターが次のとおり決めた。(1) `guard-github-mcp.ts:23` の run の検索が `findProjectRoot` のままで、設計書 §6.8 の (a) と、hook の表(guard-bash と stop-guard だけを挙げていた)が食い違う。hook の表に guard-github-mcp を加え、M4-B に M4-T15(通常の実装)を足した。(2) 設計書 §6.2.2 の「`--files` と `--deps` と `--final` は `step` のときだけ使う」を、A6-5 と §6.2 に合わせて「`--files` は `step` のときだけ必須」と書き直した。(3) 設計書 §6.8 の (b) の `mainRoot` が git のルートを指すことを明記した(実装は `findRepoRoot(mainRoot)` を基準にしている)。ユーザー決定(2026-09-28)で、E2E と画面名の経路を画面を持つサンプルで確かめる手順を O4-6・O4-7 に足し、設計書 §8.4 に確認の 5 点を足して設計書 §15 の 1 と §10 の 4 を閉じた。同じ日のユーザー決定 82 で、intent の派生文の冒頭の定型文を原文の区切り(区切り線と 1 行)に替え、人が読む文書の共通の執筆規則 `readable-writing.md` を置き、gh-utility の執筆規則も揃える(バージョンは `0.5.3-dev` のまま)ことにした。書式の書き換えは保護パスの書式契約(`intent-format.md`)に当たるので、M4-T14 に `format-change-checklist.md` の追随を入れた。参照文書を 1 タスクにまとめるため、M4-T13 の `github-writing.md` と `intent-format.md` の作業を M4-T14 へ移した。設計書は決定 82、A2-16・A6-20・A6-21、§6.3.3・§6.3.5・§6.9.2・§6.12・§7.4・§7.5・§8・§9〜§12 で追随した。M4-B のエージェント数は 11 になり、§0.1 の目安を超える(§10 の 7)。計画の見直しの中で、`findMainRoot` が linked worktree の作業ツリーで primary の checkout を返し、このリポジトリを対象にした O4-1 で hook が run を見つけないことが分かった(§10 の 6、設計書 §15 の 4)。
35. M4-B の前の見直し(2026-09-28)で、次のことを入れた。
    - 34 の見直しへのレビューを採った。設計書 §6.8 の (b) の `mainRoot` は、コードの変数 `mainRoot`(`findMainRoot` の戻り値)と紛れるので、「メイン作業ツリーの git のルート(コードでは `repoRoot = findRepoRoot(mainRoot)`)」と書き直した。§9.3 の登録し直しの記録に、`group` も null に戻ること(`codiel-state.ts:1060`)を足した。O4-6・O4-7 を M4B-G と M4 のレビューの後に行い、失敗したら所見を記録して M4 の修正の Workflow で直すと書いた(§6.5)。M4-T14 に `readable-writing.md` の参照の形を明記した。gh-utility は M4 で改修するが、バージョンは `0.5.3-dev` のまま据え置く。ゴールの Done 条件が gh-utility を `0.5.3-dev` と定め、M4 の変更はこの改修の中で上げた未リリースの同じ dev 版の中の変更だからである。
    - オーケストレーターの決定で、`findMainRoot` を git を呼ばない形(cwd のパスの `/.codiel/worktrees/` より前、無ければ `findProjectRoot(cwd)`)に改め、M4-T15 に `lib.ts` と `lib.test.ts` を足した(§10 の 6、設計書 §6.8 の (a)・§15 の 4)。M4-R と M4-FR を Workflow `codiel-m4b-review` に分けた(§6.1.4、§10 の 7)。決定 42 の読み替え(intent と GitHub の文書は prompt-smith 由来の文の組み立てをやめる)は維持した。
    - ユーザー決定で、変更ごとの intent と intent-issue の `## 意図的な制約` を「制約 | 理由」、`## 合意済み事項` を「論点 | 決定 | 理由」の表にした(設計書の決定 82 の (5)、§6.3.3)。書式に依存するスキルを grep で洗い、`capturing-intent`(`:115`。M4-T13)と `syncing-intents`(`:64`)・`preparing-design-agendas`(`:74-85`)(M4-T14)を直すことにした。`reviewing-diffs`・`writing-design-docs`・`writing-dev-plans`・`writing-test-specs` は持続層か見出しだけを読むので直さない。A6-21 を追随させた。
    - O3-1 の結果を §9.3 に記録し、残りの 3 点を O4-8 にした。
    - ユーザー決定で、Raguel の応急処置の 11 件を決定 83 として足した(設計書 §6.14)。Raguel 側の 5 件を M4-T16 に、codiel 側の CLI と hook(STOP の裁定、次の try の承認、stop-guard の理由文)を M4-T15 に、スキルと文書を M4-T13・M4-T14・M4-T04・M4-T06 に割り当て、A6-22〜A6-29 を足した。Raguel の変更は codiel のコミット(C4B-1)に入れる。
    - ユーザー決定で、Raguel の作り直しは別のセッションが別の git worktree で設計から行い、設計は M4 と並行に、実装は M4 の後の状態から始める(§10 の 9)。引継ぎ資料と起動プロンプトはオーケストレーターが別に作る。
36. M4-B(`codiel-m4b-tdd-skills`)とレビュー(`codiel-m4b-review`)を終えた(2026-09-28)。コミットは codiel の `08647269`(raguel-mcp の src と dist を含む)、gh-utility の `724efcdb`、codiel を 1.0.0 に上げた `d10795cc` である。途中で止まったタスクは、オーケストレーターが次のとおり決めて続けた。
    - M4-T15 は、W-5 のテストが git を呼ぶ旧い `findMainRoot` の振る舞いを確かめていたことと、`mark-ask` が記録済みの STOP を上書きできることを挙げて blocked を返した。W-5 の期待を linked worktree でも run が見つかる形に反転し(設計書 §8.2 の W-5 の行)、`mark-ask` はフェーズの `verdict` が STOP なら STOP と、その `evaluationId` を残すことにした(設計書 §6.2.2、`38a67fb9`)。
    - M4B-G は A6-7 の grep がテストの固定データの `.codiel/specs` に当たって blocked を返した。M4-T17 が固定データを `<testsDir>` の形に替えた。
    - M4-T16 が自分で決めた 4 点は、Raguel の作り直しの材料として完了報告に載せる。config の読み込みの失敗は `kernel/config-error` の ASK にすること、`list_rules` は失敗を error のオブジェクトで返すこと、`DepsSource` と `failClosed` のシグネチャを変えたこと、ask に下げたときの理由文の注記である。
    - M4-B のゲートのエージェントは StructuredOutput を返さずに終わった。オーケストレーターがコミットを確かめ、lint・typecheck・test(2952 件がパス)を実行し直し、完了条件の grep を確かめた。
    - M4-R と M4-FR の high 1 件(Serena メモリ `core` に sandalphon の名前が残る。A1-4)はオーケストレーターが直した(`38a67fb9`)。medium と low の 6 件(skill-flowcharts の図、DESIGN.md の `/codiel:test` の注記、`codiel-state.ts` のコメントの参照先、raguel-gating の選定順の数、「変更履歴節」、「Task ツール」)は `codiel-m4-fix` が直した(`bbb82f27`)。`raguel-mcp/docs/DESIGN.md` が応急処置の前の記述のままであることと、DESIGN.md §1 のテストの体系の行は、作り直しと履歴のために残した。
    - O4-3 で Serena メモリ `codiel/core` と `codiel/raguel_mcp` を追随させ(`04990b28`)、O4-4 でルートの README の codiel のセクションにテスト駆動・並列実装・`testsDir` を足した(`ad9ca627`)。手動確認の O4-1・O4-7・O4-8 は、M4 の版(`bbb82f27`)の複製でユーザーが行う。
    - O4-2 の `diff-architecture` は、O2-6 でユーザーが扱わないと決めた既存の 11 件だけを返し、ユーザーは今回も扱わないと決めた。ARCHITECTURE の本文に、M4 に由来する意味の食い違いは無かった。O4-5 で、ユーザーはテスト駆動の組み直し(決定 73〜79)を ADR-008 にすると決めた(`9d4eebd2`)。ADR-006 の影響範囲の version 1 の run の扱いと、ADR-003 の影響範囲の初期化済みの判定の `.codiel/` の 3 ディレクトリは M4 で古くなったので、置き換えを ADR-008 の影響範囲に 1 文ずつ書いた。
    - M4-T16 を足したので、`codiel-m4b-tdd-skills` のエージェント数は 10 になった。codiel 側の CLI と hook の変更は、エージェントを増やさないよう M4-T15 にまとめた(§10 の 8)。
    - オーケストレーターが採った修正で、決定 83 の具体化を直した。`mark-ask --verdict` で STOP を state に残し、`init` の検査を `humanApproved` の無い STOP のフェーズにも広げ、dangerous-patterns が files[] の見出しでパスを得ることと、ハンクの無い正当な diff を入力の誤りにしないことを、M4-T13・M4-T15・M4-T16 と A6-25〜A6-27・A6-29 に入れた。あわせて、`findMainRoot` の改めがユーザー決定ではなくオーケストレーターの判断であると設計書に明記し、一時領域への参照を所見の文書 `harness-docs/handover/2026-09-28-raguel-redesign-findings.md` に替え、`codiel-m4b-tdd-skills` の 10 エージェントを受け入れた(§0.1、§10 の 8)。
    - `codiel-m4b-tdd-skills`(`wf_8b1392fe-cec`)は M4-T11〜M4-T14・M4-T16 を終え、M4-T15 で止まった。M4-T15 は担当の範囲を実装したが、2 点を報告した。1 つは、M4-A の `guard-write.test.ts` の W-5 が git に問い合わせる旧い振る舞いを確かめており、新しい `findMainRoot` では必ず失敗すること。もう 1 つは、STOP の後に `resume` と `--verdict` の無い `mark-ask --kind confirm` を実行すると STOP が ASK で上書きされ、`--human-approved` の無い `pass-gate --verdict PROCEED` が通ること(scratchpad で再現)。オーケストレーターの判断で、W-5 の期待値を新しい振る舞い(設計書 §8.2 の W-5)に改め、`mark-ask` は記録済みの STOP を上書きしないことにした(設計書 §6.2.2、A6-27)。残りは Workflow `codiel-m4b-tdd-skills-2`(M4-T15 の続き → M4-T04 → M4-T06・M4-T07 → M4B-G)で行う。
37. 手動確認 O4-1・O4-7・O4-8 を受けて、設計書に追補(決定 84〜109)を足し、この計画書に M4-C(§6.6〜§6.8)を足した(2026-09-29)。
    - 経緯: O4-1a と O4-1b で見つかった不具合(委譲先の報告のファイルの書き込みの拒否、`.codiel/` の中身と run の外のファイルのコミット、guard-bash の state.json の誤検知、変更の無いゲートの入力の誤り、review の push、理由文、空の worktree のディレクトリ)と、ユーザーの追加要件(`.codiel` の構成の組み直し、infra の観点、E2E のレポート)が、決定 84〜106 になった。O4-8 の NO(`domains` が空のまま取り込みが飛んだ)は決定 107・108 に、名前の日時は決定 109 になった。結果は §9.3 の「手動確認の結果」の行にある。
    - 主なユーザー決定: `raguel.config.yaml` の中身を config.json の `raguel` へ移して YAML を消し、Raguel は YAML を読まない。`RAGUEL_CONFIG` も JSON にする。`/codiel:run` の判定 D にも `.gitignore` の行を入れる。`/codiel:test` の E2E のレポートは `.codiel/reports/` にだけ置く。未記録の GOTCHAS は `<runsDir>/<slug>/` に置き、どのフェーズでも書けるようにする。test-code の Red の確認の実行は、失敗した実行に数えない。config.json が不正なら test-code の書き込みもすべて ask にする。名前の日時はローカルのタイムゾーンの `YYYYMMDD-HHMMSS` にする。
    - 設計書の追補は、暗黙知のレビュー・前提の検証のレビュー・修正の確認のレビューを経て、2026-09-29 にユーザーが承認した(`ce236284`)。codiel は `1.0.0` のまま据え置く(設計書 §9)。Raguel の設定の読み込み先の変更は、作り直しのセッションへ通知済みである(2026-09-28・29)。作り直しのセッションは空の差分を正規の入力にする予定なので、作り直しの後に決定 97 を見直す(§9.1)。
    - 計画で決めたこと: 設計書 §13 の metatron の `scan.ts:1652` の文言を M4C-T06 で直す。metatron のバージョンは `0.4.0-dev` のまま据え置く(ユーザー決定。2026-09-29。§10 の 11)。ゴールの Done 条件(`docs/prompts/2026-09-27-codiel-intent-driven-prompt.md:39`)が metatron を `0.4.0-dev` と定め、M4C-T06 の変更は、この改修の中で上げた未リリースの同じ dev 版の中の変更だからである。gh-utility を `0.5.3-dev` のまま据え置いた 35 と同じ扱いにした。config.json の例のファイルの名前を `config.example.json` にし、E2E のレポートの書式の参照文書は設計書の仮名 `e2e-report-format.md` のままにする。O4-8 のやり直しは、安全網の 2 つの答え(領域を決める、決めない)を確かめるために軽量の run を 3 回通す(O4C-8)。
    - 計画の作成時と見直しで見つけた食い違いは次の 7 件である。(1)〜(5) は設計書を正として計画に書き、(6)・(7) は計画を正とした。(1) 設計書 §6.17.3 の md の例の `実行:` の値 `20261001T031500Z-add-login-try1` は、同じセクションの名前の規則と決定 109 の `YYYYMMDD-HHMMSS` に合わない。M4C-T09 は決定 109 の形の値にする。(2) 設計書 §6.9.4 は README に「既存の `raguel.config.yaml` を移すには `/codiel:init` をやり直す」を書くとし、A7-6 は `README.md` と `commands/init.md` に `raguel.config.yaml` の語が無いことを求める。M4C-T02 と M4C-T12 は、ファイル名を使わずに移し方を書く。(3) 設計書 §11.2 と §7.8 は Serena メモリ `codiel/core` の `:17-18`・`:19`・`:32`・`:95` を挙げるが、`codiel/core.md:150`(`raguel.config.example.yaml`)と `tech_stack.md:32`(raguel-mcp の依存の `yaml`)も古くなる。O4C-3 に足した。(4) 設計書 §10 の引き継ぎは古くなる ARCHITECTURE の記述に `:182`・`:221`・`:363` を挙げるが、ADR-008 の影響範囲の「`/codiel:init` の判定だけは `.codiel/config.json` も見る」(`:371`)も、決定 87・93 で古くなる。O4C-2 に足した。(5) 設計書 §6.19 の変更の対象に `plugins/codiel/docs/DESIGN.md:440` の `<ISO日時>` が無い。A8-5 の grep の範囲の外だが、M4C-T12 に足した。(6) 設計書 §13 の最後の段落は「直せば metatron のバージョンが上がる」とするが、計画は上のユーザー決定で `0.4.0-dev` のまま据え置く。設計書は直していない。(7) 設計書 §6.17.6 は pr・review・triage・finalize の分岐を `guard-write.ts:391-393` と引くが、`:391` はコメントで、分岐は `:392-393` である。M4C-T04 は `:392-393` と書いた。
    - 見直し(2026-09-29)のユーザー決定で、`.codiel` を git のルートの下のディレクトリに置く構成の `.gitignore`(§10 の 10)には M4-C で対応せず、既知の限界として `plugins/codiel/README.md` に「`.codiel` は git のルートに置く」と書く(M4C-T12)。

---

## 10. 未決事項

1. Workflow の `agent()` が委譲先の Agent 定義(役割マーカーで選ぶ定義)を指定できるか。指定できないときは、依頼文に委譲先の種類を書くだけになり、モデルの割り当てが役割どおりにならない。実装セッションが `workflow-authoring` で確かめ、指定できなければユーザーに扱いを確かめる。
2. §2 と §6.2 の CLI の形(`next-adr-candidate-id`、`step-add --kind step|test-code|test-loop`、JSON 配列での受け渡し、`testLoop.units` の `merged` からの登録し直し、`--worktree` の一意性)、metatron の実装の置き場、gh-utility の執筆規則を既存の `github-issue-common.md` に足すことは、本書が決めた(technical-adviser の助言で確かめた)ものである。ユーザーレビューで変えてよい。
3. (解決済み。2026-09-28)O2-4 の local モードの手動確認は、`origin` を持たない新しい一時のリポジトリで行った(§9.3)。
4. (解決済み。2026-09-28)E2E を implement で通す経路(決定 80)と、新しい画面の名前を聞く経路(決定 81)は O4-1 では通らない。ユーザーは画面を持つサンプルで確かめると決め、O4-6・O4-7 を足した(設計書 §8.4、§15 の 1)。
5. (解決済み。2026-09-28)M4 より前に test-spec か dev-plan を通し、implement に入っていない run の扱いと、新しい try で前の try の run ブランチから intent を持ち込む時点(設計書 §15 の 2・3)。前者は `phases` に test-code を持たない state を CLI が v1 の run と同じ形で拒むことにし(設計書 §6.6。M4-T09・M4-T04)、後者は持ち込みを手順 1 の最新化の後へ移した(設計書 §6.1.2。M4-T13)。
6. (解決済み。2026-09-28)M4-A の `findMainRoot`(`lib.ts:595`)は、cwd が codiel の worktree の中のとき `git worktree list --porcelain` の先頭のエントリを返すので、対象の作業ツリーが git の linked worktree(このリポジトリがそう)だと primary の checkout を返す。オーケストレーターは、git を呼ばずに cwd のパスの `/.codiel/worktrees/` より前をメインのルートとし、含まないときは `findProjectRoot(cwd)` を返す形に改めると決めた(設計書 §6.8 の (a)・§15 の 4。M4-T15)。
7. (解決済み。2026-09-28)M4-B のエージェント数が 11 で、§0.1 の目安を超えた。オーケストレーターは、M4-R と M4-FR を Workflow `codiel-m4b-review` に分けると決めた(§6.1.4)。
8. (解決済み。2026-09-28)`codiel-m4b-tdd-skills` のエージェント数は、決定 83 の M4-T16 を足して 10 になり、§0.1 の目安(10 未満)を 1 超える。オーケストレーターは、目安は上限ではないので 10 のまま受け入れ、M4-T16 を別の Workflow に分けないと決めた。
9. Raguel の点検の所見のうち決定 83 の応急処置に入れなかったものは、Raguel の作り直しに回す。所見は `harness-docs/handover/2026-09-28-raguel-redesign-findings.md` にまとめてある(設計書 §15 の 5)。
10. (解決済み。2026-09-29)`.codiel` を git のルートの下に置いた構成(`repo/app/.codiel`)での `.gitignore` の置き場。設計書 §6.15.5 は `gitignore` の出力の `path` を `.gitignore` とし、E2E の 4 行を testsDir(repoRoot 相対)から作るが、`.gitignore` をどのディレクトリに置くかを定めていない。`.codiel` を持つディレクトリの `.gitignore` では、git がそのディレクトリからの相対として読むので E2E の 4 行が当たらず、git のルートの `.gitignore` では `.codiel/runs/` の行が当たらない。`.codiel` が git のルートにある通常の構成では食い違わない。M4C-T01 は `.codiel` を持つディレクトリの `.gitignore` を読む形で実装して報告し、M4C-R が確かめる。ユーザーは、M4-C ではこの構成に対応せず、既知の限界として `plugins/codiel/README.md` に「`.codiel` は git のルートに置く」と書くと決めた(M4C-T12、§9.4 の 37)。
11. (解決済み。2026-09-29)metatron の `scan.ts:1652` の文言の修正(M4C-T06)に伴うバージョン。ユーザーは、gh-utility(§9.4 の 35)と同じく `0.4.0-dev` のまま据え置くと決めた。設計書 §13 の「直せば metatron のバージョンが上がる」との食い違いは §9.4 の 37 に記録した。

---

## 11. Done 条件

各マイルストーンの終点で次をすべて満たしてから、次のマイルストーンへ進む。

- `pnpm run lint`・`pnpm run typecheck`・`pnpm run test`・`pnpm run build` がすべて通る。
- `plugins/*/src/` を変えたコミットに、同じプラグインの `plugins/*/scripts/` の差分がある。
- 改修したプラグインの `plugin.json` と `package.json` のバージョンが、§7 の値で揃っている。
- ルートの `README.md` に反映されている(O1-3、O2-8、O3-5、O4-4、O4C-3)。
- ARCHITECTURE に影響する変更を `/metatron:update` で追随させている(O1-8、O2-6、O3-3、O4-2、O4C-2)。
- `.serena/memories/` の食い違いを直している(O1-4、O2-7、O3-4、O4-3、O4C-3)。
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
| M4-R と M4-FR を `codiel-m4b-tdd-skills` の最後の phase に残す | エージェント数が 11 になり、§0.1 の目安を超える。レビューは読み取りだけでコミットしないので、ゲートのコミットの後に別の Workflow で行っても順序は変わらない |
| M4 の最初の Workflow の変更を捨て、組み直した計画で最初からやり直す | M4-T01・T03・T05・T08 の変更は決定 72〜79 と矛盾しない。改めるのは `--kind` と ID の検査と一部の記述だけで、M4-T09・T11・T12 がそれを担う |
| M4-C を 1 本の Workflow にまとめる | エージェント数が 16 になり、§0.1 の目安を超える。スキルは、コードの Workflow で確定した CLI と理由文(O4C-1)を参照する |
| metatron の `scan.ts` の文言を直さずに残す | codiel が読まなくなった `raguel.config.yaml` の名前が metatron の出力に残り、利用者が設定の置き場を取り違える |
| O4-8 のやり直しを 1 回の run で済ませる | 安全網の確認は、領域を決める答えと決めない答えで結果が分かれるので、1 回の run では 4 点目と 5 点目の片方しか確かめられない |
