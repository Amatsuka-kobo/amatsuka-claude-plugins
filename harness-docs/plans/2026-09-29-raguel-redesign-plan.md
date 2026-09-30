# Raguel を層ごとに作り直す 実装計画書

- 作成日: 2026-09-29
- 状態: 計画(第 3 版)・承認済み(2026-09-29)
- 改訂の記録: 第 2 版で、レビューのうちオーケストレーターが採った 4 件を直した(`rules/util.ts`・`rules/testHelpers.ts` の持ち主を W2-T01 へ移す、`Subject` の型の正本を `R/subject/types.ts` にする、`--model` のエイリアスの確認を足す、W2-T01 の grep を `-rn` にする)。第 3 版で、codiel の M4-C(`7130f69c`)の結果と設計書第 7 版の R24 に合わせ、取り込む HEAD、O0-3 の答え、R24 の実装の割り当て、W3 の codiel 側のタスクの前提、最後の手順の手動確認(codiel の O4C-6〜O4C-8)を改めた
- 設計書(正本): `harness-docs/design/2026-09-28-raguel-redesign-design.md`(第 7 版、決定 R1〜R24。第 6 版はコミット `c5fa33c3`、第 7 版は 2026-09-29 に承認済み)。以下「設計書」
- 対象: `plugins/codiel/raguel-mcp`(主)、`plugins/codiel` の Raguel を使う箇所(`src/raguel-records.ts`・`src/codiel-state.ts`・`src/hooks/guard-write.ts`・`guard-bash.ts`・`skills/raguel-gating`・`skills/orchestrating-runs`・`skills/initializing-harness`・`docs/`・`README.md`)
- バージョン: codiel `1.0.0` → `1.0.0-dev`、raguel-mcp の `package.json` `0.0.1-dev` → `0.0.2-dev`(設計書 §8。2026-09-29 にユーザーの指示で `1.1.0-dev`・`0.1.0-dev` から改めた)。最後の手順(§8 の O5-4)で上げる
- Workflow 実行: 4 本(`raguel-w1-foundation`・`raguel-w2-core`・`raguel-w3-codiel`・`raguel-w4-review`)と、失敗したときの修正の Workflow
- 作業ツリー: `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-raguel-redesign`(ブランチ `raguel-redesign`)

この計画書は、設計書をタスク・順序・検証の方法へ分けるだけで、設計判断を上書きしない。設計書と実コードの食い違いを見つけたタスクは、作業を止めて `status: blocked` で報告する。オーケストレーターは報告を §11.3 へ追記し、設計書を直すかをユーザーに確かめる。設計書を直すのはユーザーが認めたときだけで、オーケストレーターが単独のコミットで行う。

ファイルパスは設計書と同じく略記する。R は `plugins/codiel/raguel-mcp/src`、C は `plugins/codiel`。

---

## 0. 前提

### 0.1 実装は別セッションで Dynamic Workflow を使う

実装セッションは次の性質を前提に Workflow スクリプトを組む。スクリプトを書く前に `workflow-authoring` スキルを読み、関数の引数の形はそのスキルで確かめる。

- スクリプトは `export const meta = { name, description, phases }` と、`phase()`・`agent(prompt, { label, phase, schema, agentType })`・`parallel()`・`pipeline()` で組む。
- 各 `agent()` はサブエージェントであり、ユーザーと対話できない。判断が要る事態では `status: blocked` を返して終わる。
- 完了したエージェントの結果は `resumeFromRunId` で再利用できる。
- 1 Workflow あたりのエージェント数は 10 未満を目安にする。本計画の最大は `raguel-w2-core` の 9 である。
- ユーザーの手作業、実機確認(設計書 §7.2)、metatron の対話的な手順は Workflow の中に入れない。Workflow の合間に、オーケストレーター(メインセッション)が §3・§4.3・§5.3・§6.3・§8 の手順で行う。
- 各 Workflow は、前の Workflow のゲートがコミットまで終えてから始める。

Workflow の中の作業は次の規則で分ける。

- タスクのエージェントはコミットしない。同じ作業ツリーで複数のエージェントが同時にコミットすると `index.lock` で衝突するためである。コミットは各 Workflow の最後のゲートのエージェントが、§9 の規則で行う。
- タスクのエージェントは `pnpm run build` を実行しない。ビルドはゲートだけが行う。
- タスクのエージェントは `pnpm run typecheck` と `pnpm run lint` を実行しない。`tsconfig.json` の include はリポジトリ全体なので、隣のタスクの書きかけのファイルで失敗するためである。タスクが実行するテストは、自分が触るテストファイルの `pnpm exec vitest run <パス>` だけにする。
- 型検査・lint・全体のテスト・ビルドはゲートだけが行う。ゲートで失敗したら、同じ Workflow の修正 Workflow(`raguel-w<n>-fix`)で直し、ゲートをやり直す(§11.2)。
- 同じ phase で並列に動くタスクは、触るファイルが重ならない。各タスクの「触るファイル」の外を変える必要が出たら、変えずに `blocked` で報告する。

### 0.2 Workflow の分け方

raguel-mcp のモジュールはほぼすべてが `core/types.ts` と設定の型に依存するので、既存のモジュールを層ごとに別の Workflow で書き換えると、Workflow の境界で型検査が通らない。そこで次の 3 つで分ける。

1. `raguel-w1-foundation`: 既存のモジュールの呼び出し側を壊さずに足せる基盤を先に作る。新しいモジュール(フェーズの表、プロジェクトルート、評価対象の取得、MinHash、Jev の文脈判定)と、呼び出し側を壊さない形で改めるプロバイダーである。どれもまだパイプラインにつながない。
2. `raguel-w2-core`: 既存のモジュールを、型と設定 → ケースファイル・判例・ルール層・重さ → パネル → パイプラインとツール、の順に 1 本の Workflow の中で書き換える。境界で型検査が通る最小の単位がこれである。
3. `raguel-w3-codiel`: raguel-mcp の契約(ツールの入出力とケースファイルの形式)が W2 のコミットで固まってから、codiel 側(codiel-state・hook・スキル・文書)を改める。

2 者比較テスト(設計書 §6.14)は 2 本ある。フェーズの表を照らす 1 本目を W1-T01 に、記録の読み込みを照らす 2 本目を W3-T01 に置く。契約の文書 `C/docs/raguel-contract.md` は W3-T03 が書く。W2 で実装した形式を §11.3 の記録から写すためである。

### 0.3 変えないもの

- 設計書を Edit / Write で直さない。直すのは、ユーザーが認めたときにオーケストレーターが行うときだけである。
- `harness-docs/ARCHITECTURE.md`・`harness-docs/GOTCHAS.md`・`.claude/rules/metatron/*.md` を Edit / Write で触らない。ADR はオーケストレーターが §8 の O5-1 で `metatron:updating-architecture` を通して足す。
- `plugins/*/scripts/` と `plugins/*/dist/` を手で編集しない。ゲートのビルドで作り直す。
- `.serena/memories/` は Serena の `edit_memory` / `write_memory` でだけ変える(§8 の O5-2)。
- jevriel の `src/` を raguel-mcp から import しない。codiel の `src/` と raguel-mcp の `src/` は互いを import しない。例外は `__test__/` の 2 者比較テストだけである(設計書 §6.14、codiel 設計 §6.10.3)。
- 設計書が決定論に残すと定めたもの(`common/secrets`・`code/protected-paths`・計数・構造解析・改竄検知・合成規則。設計書 §6.4.4)を Jev に送らない。

---

## 1. 各タスクの依頼文に入れる共通ブロック

オーケストレーターは、各 `agent()` の依頼文の冒頭に次のブロックをそのまま入れる。`<...>` はタスクごとの値に置き換える。

```text
あなたはサブエージェントである。ユーザーと対話できないので、判断に迷ったら作業を止め、status: blocked で理由を報告する。

タスク: <タスク ID と内容>
設計書(正本): /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-raguel-redesign/harness-docs/design/2026-09-28-raguel-redesign-design.md の <セクション番号>
実装計画書: /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-raguel-redesign/harness-docs/plans/2026-09-29-raguel-redesign-plan.md の <タスク ID>
触ってよいファイル: <glob の列>
ロードするスキル: <スキル名。無ければ「なし」>
前の手順で確定した事項: <§11.3 の記録から、このタスクに要るもの。無ければ「なし」>

制約:
- ファイルへの書き込みは Edit / Write / Serena の編集ツールで行い、Bash では書き込まない。
- TypeScript・JavaScript・Markdown の作成と編集は Serena の編集ツールで行う。JSON は Edit で行う。
- plugins/*/scripts/ と plugins/*/dist/ を手で編集しない。pnpm run build も実行しない。
- pnpm run typecheck と pnpm run lint を実行しない(ゲートが行う)。実行するテストは、自分が触ったテストファイルの pnpm exec vitest run <パス> だけにする。
- コミットしない。git stash を使わない。
- 触ってよいファイルの外を変える必要が出たら、変えずに blocked で報告する。
- テストは対象ソースと同じディレクトリの __test__/ に <対象ファイル名>.test.ts の名前で置き、vitest で書く。複数のテストから使うヘルパーは __test__/helpers/ に置く。子プロセスとして起動するエントリポイントは src/testing/ に置く。
- テストで実際の claude・codex・Jev の API を呼ばない。fake の子プロセスと fake の関数を使う。
- プラグインに書く日本語は /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-raguel-redesign/plugins/native-japanese/references/discipline.md に従う。直訳語を使わない(Step は「Step」「ステップ」、section は「セクション」と書き、「段」「節」「〜の側」を使わない)。
- バージョンを変えない(最後の手順でオーケストレーターが上げる)。
- raguel-mcp の src と codiel の src は互いを import しない。例外は __test__/ の 2 者比較テストだけである。jevriel の src は import しない。
- harness-docs/、.claude/rules/metatron/*.md、.serena/memories/ を変えない。
- 設計書と実コードが食い違っていたら、どちらかに合わせて直さず、両方の該当行を報告する。

報告: 次の JSON スキーマで返す。値は例示であり、実際の内容に置き換える。
{ "taskId": "W2-T04", "status": "done", "changedFiles": ["plugins/codiel/raguel-mcp/src/rules/common/secrets.ts"], "commands": [{ "command": "pnpm exec vitest run plugins/codiel/raguel-mcp/src/rules/common/__test__/secrets.test.ts", "exitCode": 0 }], "findings": [{ "id": "A1", "test": "テスト名 'パスの語はエントロピーで拾わない'" }], "decisions": [], "discrepancies": [], "notes": "" }
status は done か blocked のどちらかである。findings には、このタスクのテストで確かめた所見の番号(設計書 §4)を並べる。decisions には、依頼文に無く自分で決めた扱いを書く。

<セッションの規律が依頼文への転記を求める条項は、この行の下に置く>
```

各タスクの「委譲先」は、役割マーカーの対応表で次のように解決する。`agent()` の `agentType` に渡す定義の名前は、codiel の計画書(`harness-docs/plans/2026-09-27-codiel-intent-driven-plan.md` の §9.3 の最後の行)で確かめた対応を使い、O0-4 で確かめ直す。

| 役割 | 使う場面 |
| --- | --- |
| complex-impl | 公開の型・ツールの入出力・state の検査・hook の判定を変える実装 |
| normal-impl | 既存のパターンに沿う実装とテスト |
| light-impl | ゲート(検査コマンドの実行・ビルド・コミット) |
| general | 指示書・参照文書・README・設計の文書の執筆 |
| code-review | 各 Workflow の差分のレビュー(読み取りだけ) |
| final-review | 全体の最終レビュー(読み取りだけ) |

AI 向けの指示書を書くタスク(`plugins/*/skills/**`、`plugins/*/references/**`、`plugins/*/assets/**`)は `prompt-smith:prompt-smith` をロードする。`docs/` と README は prompt-smith の対象外なので、ロードしない。

読み取りだけのエージェント(code-review・final-review)の依頼文には、共通ブロックに加えて「使用してよい tools を読み取り系に限定する」「ファイルを変更しない」「報告のみを返す」の 3 文と、次の severity の基準を入れる。

| severity | 基準 |
| --- | --- |
| critical | 実行時に壊れる、ゲートを素通りさせる経路が開く、秘密情報が外部へ送られるか記録に平文で残る、保護パスを直接書き換えている |
| high | 設計書の決定(R1〜R23)または受け入れ基準から逸脱している。テストは通るが意味が設計書と違う |
| medium | 設計書の範囲内での局所的な改善(テストの不足、重複、誤解を招く文) |
| low | 表記・体裁・命名の揺れ |

---

## 2. 設計書が計画書に委ねた細目の決定

設計書が名前・置き場・順序を決めていない細目を、この表で確定する。名前を変えるタスクは、報告の `decisions` に書く。

| 細目 | 決定 |
| --- | --- |
| M4 後の HEAD の取り込み方 | この worktree のブランチ `raguel-redesign` に、M4 と M4-C を終えた `intent-driven-development`(`7130f69c` 以降)を `git merge --no-ff` で取り込む(O0-1)。rebase は使わない。設計書と計画書のコミットの履歴を保つためである |
| プロジェクトルート・projectId・置き場の解決の置き場 | `R/project/root.ts`(新設)。`findProjectRoot`・`findMainRoot` と同じアルゴリズムの `resolveProjectRoot(cwd)`、`resolveProjectId(projectRoot, storageProjectId?)`、`resolveCasesDir(configured?)` を export する。W1-T01 が作る |
| フェーズの表の置き場と形 | `R/codiel/phases.ts`(新設)。`GATED_PHASES`(フェーズ名・ステージ番号・kind・ツールの配列)と `priorPhasesOf(phase)` を export する |
| MinHash の置き場 | `R/casefile/digest.ts`(新設)。`computeDigest(text)` と `digestSimilarity(a, b)` を export し、`a_i`・`b_i` は固定の種から作った定数としてファイルに持つ |
| 評価対象の取得の置き場 | `R/subject/`(新設。W1-T02 が作る)。`code.ts`(git の差分、`repoPath` の検証、未コミットの検出)、`files.ts`(`paths` の読み込み)、`types.ts`(`Subject` と、見出し行の位置を持つ本文の型)。`R/subject/types.ts` を `Subject` の型の正本とし、`R/core/types.ts` はそれを import か re-export し、同じ型を定義し直さない(re-export は W2-T01 が行う)。変更ファイルの一覧は `git diff --name-status -z` で取り、`rules/code/diffParse.ts` に依存しない |
| Jev の文脈判定の置き場と入出力 | `R/context/jev.ts`(SDK の呼び出し、入力の上限の推定)と `R/context/judge.ts`(質問の組み立て、結果の当て方)。入力は `{ kind, objective, maskedArtifact, candidates, priorFindings, decisionFields, resubmissionTargets }`、出力は `{ status, adjustedFindings, tierFloor, adjustments, record }` とする。`record` は `07-context.json` に書く中身である。パイプラインへのつなぎ込みは W2-T08 |
| プロバイダーの置き場 | `R/panel/provider.ts`(インターフェース)、`R/panel/claudeCli.ts`、`R/panel/codexCli.ts`(新設)。fake は `R/testing/fake-claude.mjs`(移設)と `R/testing/fake-codex.mjs`(新設)。パネルのテストのヘルパー(`fakeProvider.ts`・`fixtures.ts`)は `R/panel/__test__/helpers/` へ移す(W2-T07) |
| ルールのパラメータのスキーマの置き場 | `R/rules/params.ts`(新設)。ルール ID ごとのパラメータ(名前・型・既定値・和集合か置換か・sealed の制約)を 1 つの表で持ち、設定の検証(W2-T01)・各ルール(W2-T04・T05)・list_rules(W2-T08)が読む。W2-T01 が作る |
| diff の解析の型の置き場 | `DiffFile` と `ParsedDiff` の型を `R/core/types.ts` に置く(W2-T01)。`rules/code/diffParse.ts` の実装は W2-T05、読み手の重さ判定は W2-T06 で、同じ phase で並列に動くためである |
| 生成物と E2E のレポートの判定の置き場(R24) | `R/config/paths.ts`(新設)。`resolveTestsDir(projectRoot)`(codiel の `readCodielConfig` の `testsDir` と同じ規則と既定値)と、`classifyPath(repoRel, config, testsDir)`(`"generated"`・`"report"`・`"normal"` を返す。`"report"` は codiel の `isE2eReport` と同じ判定)を export する。W2-T01 が作り、ルール層(W2-T05)・重さ判定(W2-T06)・パイプライン(W2-T08)が読む。phase 2 で並列に動く読み手が、書く側と並ばないようにするためである |
| ルール層の共有ヘルパーの持ち主 | `R/rules/util.ts`(`getSeverity`・`truncateExcerpt`・`keywordMatches` など)と `R/rules/testHelpers.ts`(`makeArtifact`・`makeConfig`)は W2-T01 が持つ。W2-T01 は phase 1 で単独に動き、型の変更と同時にこの 2 つを新しい型に合わせる。W2-T04・T05・T06 はこの 2 つを読むだけで変えない。phase 2 で並列に動く 3 タスクが読み、書く側と並ばないようにするためである |
| 秘密情報の伏せ字の関数 | `R/rules/common/secrets.ts` が `maskSecrets(text): string` を export する(W2-T04)。ケースファイルの `submission.txt`、Jev への送信、応答の抜粋はこの関数を通す(W2-T08) |
| 再提出の Jev の対象の渡し方 | `R/rules/common/resubmissionLoop.ts` が `findAddressedButSimilar(content, priors)` を export する(W2-T04)。W2-T08 がこの結果を Jev の入力 `resubmissionTargets` にする |
| codiel 側の記録の読み込みの置き場 | `C/src/raguel-records.ts`(新設)。`resolveRaguelStore(mainRoot)`・`readEvaluationIndex`・`readOutcomes`・`readVerdictRecord` を export する。M4-C の `readCodielConfig`(`C/src/codiel-state.ts:318`(`7130f69c`))は `testsDir`・`runsDir` だけを返して `raguel` を読まないので、`raguel.storage` は `raguel-records.ts` が同じ config.json を `JSON.parse` で読む(設計書 §6.13.3) |
| codiel-state が state に足すフィールド | `phases.<phase>.startHead`(40 桁のコミット、code 系 4 フェーズだけ)と、state のトップレベルの `raguelContract: 2` |
| degraded を止めるときの `stop` の理由 | `raguel-degraded`(設計書 §6.13.1 の文言のまま) |
| 実機確認のスクリプトの置き場 | セッションの scratchpad に一時のスクリプトとして置き、`tools/` と `scripts/` に置かない。一時のスクリプトなので、CLAUDE.md のツールの置き場の規則に当たらない |
| Workflow の名前 | `raguel-w1-foundation`・`raguel-w2-core`・`raguel-w3-codiel`・`raguel-w4-review`。修正は `raguel-w<n>-fix` |

---

## 3. 実装前のオーケストレーターの手順

W1 を始める前に、次の順に行う。O0-6 で食い違いがあれば、ユーザーに示して扱いを決めてから W1 を始める。

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O0-1 | 設計書第 7 版がユーザーに承認されていることを確かめる。M4 と M4-C を終えた `intent-driven-development` を確かめる(HEAD が `7130f69c` かその子孫である、`plugins/codiel/.claude-plugin/plugin.json` の `version` が `1.0.0`、codiel の計画書 §9.3 の O4C-1 の行が埋まっている)。この worktree で `git merge --no-ff intent-driven-development` を実行し、衝突があれば止めてユーザーに示す。続けて `scripts/setup-workspace.sh` と `pnpm install` を実行する | オーケストレーター | `git log --oneline -1` がマージのコミット。`git status --short` に未コミットの変更が無い |
| O0-2 | §3.1 の baseline の表を実測して記入する | オーケストレーター | 表の空欄が無い。4 つのコマンドが通っている。失敗があれば W1 に入らずユーザーに報告する |
| O0-3 | §3.2 の【要確認】を、M4 後の HEAD で確かめて §11.3 に記録する | オーケストレーター | §3.2 の各行に結果がある |
| O0-4 | `workflow-authoring` スキルを読み、§0.1 の前提と `agentType` の対応(§1)を確かめる | オーケストレーター | 違えば §11.3 に記録し、§0.1 と §1 を読み替える |
| O0-5 | 実機確認 1(設計書 §7.2 の 1)を §3.3 の分岐で行う | オーケストレーター(実行の前にユーザーに確かめる) | §11.3 に、使う `--setting-sources` の値と、hooks・CLAUDE.md・プラグインが読まれたかが記録されている |
| O0-6 | O0-3・O0-5 で見つけた設計書との食い違いを、§11.4 の既知の食い違いと合わせてユーザーに示し、扱いを決めてもらう | オーケストレーターとユーザー | 決まった扱いが §11.3 にある。設計書を直すなら、ユーザーの承認の後に単独のコミットで直してある |

### 3.1 baseline(O0-2 で記入する)

| 項目 | 値 |
| --- | --- |
| HEAD(O0-1 のマージの後) | (実装セッションが記入) |
| `git status --short` | (実装セッションが記入) |
| `pnpm run lint` | (実装セッションが記入) |
| `pnpm run typecheck` | (実装セッションが記入) |
| `pnpm run test` | (実装セッションが記入。Test Files と Tests の件数) |
| `pnpm run test` のうち raguel-mcp の件数 | (実装セッションが記入。`pnpm exec vitest run plugins/codiel/raguel-mcp`) |
| `pnpm run build` | (実装セッションが記入。実行後に `scripts/` と `dist/` の差分が無いこと) |
| `claude --version`・`codex --version` | (実装セッションが記入) |

### 3.2 M4 後の HEAD で確かめること(O0-3)

1〜6 は、計画の第 3 版の作成時に `7130f69c` で答えが出ている。取り込んだ HEAD が `7130f69c` より新しいときは、答えが変わっていないかを確かめ直し、変わっていれば §11.3 に記録して O0-6 でユーザーに示す。7〜10 は取り込みの後に確かめる。

| # | 確かめること | 設計書 | 見る場所 | `7130f69c` での答え |
| --- | --- | --- | --- | --- |
| 1 | configSource の値 | §6.2.5 | `R/config/loader.ts` の `configCandidate` | `env:<パス>`・`cwd:<config.json の絶対パス>`・`defaults`。`raguel` キーが無い config.json も `defaults`。読み直しは `RAGUEL_CONFIG` か cwd の config.json のパスと mtime で判定する |
| 2 | run の間に codiel が `.codiel/config.json` を書く手順が無いか | §6.13.4、§11 | `C/src/codiel-state.ts`・`C/skills/**`・`C/scripts/install-harness.sh` を `config.json` で grep | 無い。書くのは run の外の `/codiel:init` だけ |
| 3 | raguel-mcp の `package.json` に `yaml` が残っていないか | §8 | `plugins/codiel/raguel-mcp/package.json` | 削除済み |
| 4 | codiel の config.json を読む関数の名前・シグネチャと、`raguel` キーを扱うか | §6.12.1、§6.13.3 | `C/src/codiel-state.ts` の `readCodielConfig` | `readCodielConfig(codielRoot): { testsDir; runsDir }`(`:318`)。`raguel` は読まない。既定は `docs/codiel/tests` と `docs/codiel/runs`(`:212-213`)。不正は例外。CLI の `config`(`:1252`)と `gitignore`(`:1262`)が使う |
| 5 | `findMainRoot` と `findProjectRoot` の M4 後のアルゴリズム | §6.9.1 | `C/src/hooks/lib.ts` | `findMainRoot`(`:575-580`)は git を呼ばず、パスの `/.codiel/worktrees/` より前を返す。設計書第 7 版の §6.9.1 はこれに追随した(§11.4 の 1 は解決済み) |
| 6 | 設計書が引く codiel 側の行番号 | §6.13.1〜§6.13.4、§9 | 各ファイル | 設計書第 7 版が `7130f69c` の値で引き直した。雛形は `C/skills/initializing-harness/config.example.json` |
| 7 | 応急処置 11 件がすべて入っているか | §3.2 | codiel の計画書 §9.3 の M4-T16 と M4-T15 の記録、`R/` の該当ファイル | (取り込み後に確かめる) |
| 8 | `claude --help` に `--setting-sources`・`--no-session-persistence`・`--strict-mcp-config`・`--tools` があるか。`--model` に渡すエイリアス(設計書 §6.7.1 の既定の `haiku`・`sonnet`)が有効か | §6.7.1、§6.7.2 | `claude --help`(費用はかからない)。この環境の `--model` の説明は例に `fable`・`opus`・`sonnet` を挙げ、`haiku` を挙げていない。費用のかからない確かめ方が無ければ、O0-5 の実機確認 1 のコマンド(`--model haiku`)で確かめる。無効だったら、O0-6 でユーザーに示し、設計書 §6.7.1 のプロバイダーごとの既定のモデルを直すかを聞く | (取り込み後に確かめる) |
| 9 | `codex exec --help` の読み取り専用のサンドボックスのフラグの綴り、`--ignore-rules` の説明、ツールを無効にする設定の有無 | §6.7.3、§7.2 の 5・6 | `codex exec --help`(費用はかからない)。綴りが分かれば §7.2 の 5 の綴りの部分はここで閉じ、効果は O1-3 で見る | (取り込み後に確かめる) |
| 10 | `R/panel/testing/fakeProvider.ts`・`fixtures.ts` と、M4 の応急処置で足された raguel-mcp のテストの一覧 | §7.1 | `find plugins/codiel/raguel-mcp/src -name '*.test.ts'` | (取り込み後に確かめる。M4-C で `loader.test.ts`・`tools.test.ts`・`pipeline.golden.test.ts` が変わった) |

### 3.3 実機確認 1 の分岐(O0-5)

設計書 §6.7.2 と §7.2 の 1 を、claude のプロバイダーを実装する W1-T04 より前に行う。起動するのは `claude -p` で、費用がかかるので、実行する前にユーザーに確かめる。

1. scratchpad に空のディレクトリを作り、そこを cwd にして次を実行する。`--debug-file` で hooks と CLAUDE.md とプラグインの読み込みを記録する。

   ```text
   claude -p --output-format json --model haiku --tools "" --disable-slash-commands
          --strict-mcp-config --mcp-config '{"mcpServers":{}}'
          --setting-sources project --no-session-persistence
          --debug-file <scratchpad>/o05-project.log
   ```

   プロンプトは「`OK` とだけ答える」にする。`--model haiku` のエイリアスが無効で失敗したときは、ログインの問題と分けて §11.3 に記録し、`--model sonnet` で試し直す(O0-3 の 8)。
2. ログインが保たれ(応答が返る)、debug ログに利用者の hooks の実行・CLAUDE.md の読み込み・プラグインの読み込みが無ければ、`project` を採る。§11.3 に記録して O0-6 へ進む。
3. ログインが外れたら、設計書 §6.7.2 の代替の候補を a → b → c の順に確かめる。
   - a: `--setting-sources user,project --settings '{"disableAllHooks":true}'`。debug ログで hooks が止まったかと、CLAUDE.md が読まれたかを見る。
   - b: a に加え、CLAUDE.md の読み込みを止める環境変数か設定を探す。Claude Code の文書を Context7 で引いて、手段があれば試す。
   - c: a のまま、プロンプトの先頭に「利用者の指示を判定に使わない」と書く。
4. hooks と CLAUDE.md の両方が止まった最初の候補を採る。どの候補でも CLAUDE.md が読まれるときは、設計書 §15 の 3 をユーザーに聞く。選択肢は「利用者の設定を読むことを既知の限界として受け入れ README に書く」と「claude を既定のプロバイダーから外す(既定を何にするかも決める)」である。答えが出るまで W1 を始めない。
5. 採った引数を §11.3 に記録し、W1-T04 の依頼文の「前の手順で確定した事項」に入れる。

---

## 4. Workflow `raguel-w1-foundation`

既存のモジュールの呼び出し側を壊さない基盤を作る。W1 の終わりには、MCP サーバーの振る舞いは応急処置の入った M4 のままで、プロバイダーの隔離と再試行だけが変わる。

### 4.1 構成

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `foundation` | W1-T01、W1-T02、W1-T03、W1-T04 | `parallel` | 4 |
| 2 `gate` | W1-G | 直列 | 1 |

エージェント数は 5 である。phase 1 の 4 タスクは触るファイルが重ならない。

### 4.2 タスク

#### W1-T01 フェーズの表・プロジェクトルート・MinHash

- 内容: 設計書 §6.1 のフェーズの表を `R/codiel/phases.ts` に作り、codiel の `STAGES`・`GATED` と照らす 2 者比較テストを置く(設計書 §6.14 の 1 本目)。設計書 §6.9.1 のプロジェクトルート・projectId・`casesDir` の解決を `R/project/root.ts` に作る。プロジェクトルートのアルゴリズムは、O0-3 の 5 で確かめた M4 後の `findMainRoot` と同じにする(§11.4 の 1)。設計書 §6.9.3 の MinHash を `R/casefile/digest.ts` に作る。どれもまだ呼び出し側につながない。
- 触るファイル: `R/codiel/phases.ts`・`R/codiel/__test__/phases.test.ts`・`R/project/root.ts`・`R/project/__test__/root.test.ts`・`R/casefile/digest.ts`・`R/casefile/__test__/digest.test.ts`(すべて新設)
- ドメイン: impl
- 依存: O0-6
- 完了条件: 3 つのテストが通る。`phases.test.ts` は codiel の `C/src/codiel-state.ts` から `STAGES` と `GATED` を相対パスで import し、フェーズ名・ステージ番号・ゲートの有無の一致を確かめる。`root.test.ts` は設計書 §6.14 の起点(codiel の worktree の中、利用者の worktree で `.codiel` を持つもの・持たないもの、git の管理外、プロジェクトルートのサブディレクトリ)でのプロジェクトルートと、どの worktree からでも同じ projectId になることを確かめる。`digest.test.ts` は、NFC の正規化、コードポイント単位の 5-gram、5 コードポイント未満、空の本文、同じ本文で類似度 1、定数を固定した署名の値を確かめる
- 委譲先: normal-impl
- スキル: なし

#### W1-T02 評価対象の取得

- 内容: 設計書 §6.2.1〜§6.2.4 の評価対象の取得を `R/subject/` に作る。`repoPath` の検証(git の共通ディレクトリの一致)、`baseRef` の解決、HEAD の取得、未コミットの変更の検出、固定した書式の `git diff`、20 MB の上限、空の差分の判定(設計書 §6.2.2 の手順 6。空を入力の誤りにせず、空であることを返す)、`paths` の読み込み(repoPath の外・シンボリックリンク越し・1 MB 超・UTF-8 でないものの拒否)、見出し行の位置を持つ本文の組み立て、ファイルごとの sha256 と `isNew`。入力の誤りは型付きの例外で返し、MCP のツールエラーへの変換は W2-T08 が行う。プロジェクトルートは W1-T01 の関数を使わず、呼び出し側が渡す(W1-T01 と並列のため)。
- 触るファイル: `R/subject/**`(新設。`__test__/` を含む)
- ドメイン: impl
- 依存: O0-6
- 完了条件: 設計書 §7.1 の「git からの差分」「ファイルの読み込み」と、「空の差分」のうち取得の部分(空であることが返り、手順 3 の未コミットの変更の拒否が先に効く)のテストが通る。テストは一時のリポジトリを作り、`core.quotePath=true`・`diff.noprefix=true`・`diff.external` を設定しても書式が変わらないことと、日本語のファイル名を確かめる
- 委譲先: complex-impl
- スキル: なし

#### W1-T03 Jev の文脈判定

- 内容: 設計書 §6.4.4 の文脈判定を `R/context/` に作る。`@typesafe-ai/sdk` の `0.6.0` を raguel-mcp の `package.json` の `dependencies` に足す。質問の表(対象・問う場面・当て方・向き)、2 つの問い合わせの並列、候補の抜粋(前後 5 行)、1 回 100 問の上限、入力の上限の推定(UTF-8 のバイト数 ÷ 2.5、合計 51,200、1 つの値 25,600)、鍵が無い・失敗・タイムアウト・上限超過のときの `unavailable` の扱い、再試行をしないこと、`contextJudge/unavailable` の info の所見、`07-context.json` に書く記録、重さの水準から tier の下限を出すこと、を実装する。`maskedArtifact` は呼び出し側が伏せ字を当てて渡す前提にし、このモジュールでは伏せ字を当てない。SDK の呼び出しは `JevCall` の型の関数を注入できる形にする。
- 触るファイル: `R/context/**`(新設。`__test__/` を含む)、`plugins/codiel/raguel-mcp/package.json`(`dependencies` の 1 行だけ)
- ドメイン: impl
- 依存: O0-6
- 完了条件: 設計書 §7.1 の「Jev の文脈判定」のうち、パイプラインにつながない単体の部分のテストが通る。対象(破壊操作と実行の候補、injection-marker、語彙系の 4 ルール、再提出、重さ)ごとに、有効で下げる・上げる(unsafe-exec は message だけ)、閾値の間では変えない、鍵が無い・例外・タイムアウト・上限超過で決定論の結果のままと info の所見、を確かめる。Jev が単独で STOP も PROCEED も出さないこと(許された向きの外へ動かさないこと)を、すべての対象で確かめる
- 委譲先: complex-impl
- スキル: なし

#### W1-T04 プロバイダーの隔離と codex

- 内容: 設計書 §6.7 と §6.8 のうちプロバイダーの分。`R/panel/provider.ts` の `JudgeProvider` に `name` と、`invoke` の第 2 引数 `CallControl`(`timeoutMs`・`signal`)を足し、`JudgeError` の理由に `unavailable` を足す。既存の呼び出し側(`runner.ts`・`panelists/*`)が第 2 引数を渡さなくても動くよう、`CallControl` は省略できる形にする(W2-T07 が必須にする)。`claudeCli.ts` を設計書 §6.7.2 の引数(O0-5 で採った `--setting-sources` の値)、呼び出しごとの空の一時 cwd、`RAGUEL_PANELIST=1`、タイムアウト・nonzero-exit・spawn の失敗の 1 回の再試行、`signal` の abort での SIGKILL に改め、`buildArgs` を export する。`codexCli.ts` を設計書 §6.7.3 の形で新設する。O0-3 の 9 で確かめた読み取り専用のサンドボックスの綴りを使い、確かめられなかったフラグは入れずに報告する。`fake-claude.mjs` を `R/testing/` へ移して引数とスキーマの検査を足し、`fake-codex.mjs` を新設する。`NoneProvider` と、テストの `fakeProvider.ts` に `name` を足す(ほかは変えない。移設は W2-T07)。
- 触るファイル: `R/panel/provider.ts`・`R/panel/claudeCli.ts`・`R/panel/codexCli.ts`(新設)・`R/panel/__test__/{provider,claudeCli,codexCli}.test.ts`・`R/panel/testing/fakeProvider.ts`(`name` の 1 行だけ)・`R/panel/testing/fake-claude.mjs`(削除)・`R/testing/fake-claude.mjs`(移設)・`R/testing/fake-codex.mjs`(新設)
- ドメイン: impl
- 依存: O0-5、O0-6
- 完了条件: 設計書 §7.1 の `fake-claude.mjs`・`fake-codex.mjs`・`claude` の `buildArgs`・2 プロバイダーの同じ入力、の行のテストが通る。`fake-claude.mjs` は `$schema` を含むスキーマで非ゼロで終わる(所見 C1 の再発を止める)。既存の `runner.test.ts`・`panelists/__test__/*.test.ts` が、`fake-claude.mjs` の新しいパスで通る(パスを参照していれば報告し、W2-T07 が直す)
- 委譲先: complex-impl
- スキル: なし

#### W1-G ゲート

- 内容: `pnpm install` → `pnpm run lint` → `pnpm run typecheck` → `pnpm run test` → `pnpm run build` を順に実行する。すべて通ったら §9 の C1 の単位でコミットする。どれかが失敗したら、コミットせずに失敗の出力を報告する。
- 触るファイル: `pnpm-lock.yaml`、`plugins/codiel/raguel-mcp/dist/**`
- ドメイン: bundle、manifest
- 依存: phase 1 のすべて
- 完了条件: 5 つのコマンドの終了コードが 0。`grep -rn "jevriel/src" plugins/codiel/raguel-mcp/src` が 0 件。`grep -rn "codiel-state" plugins/codiel/raguel-mcp/src --include=*.ts | grep -v __test__` が 0 件。`git status --short` に W1 の未コミットの変更が残らない
- 委譲先: light-impl
- スキル: なし

### 4.3 W1 の後のオーケストレーターの手順

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O1-1 | W1 の各タスクの報告から、確定した関数の名前とシグネチャ(`R/project/root.ts`・`R/subject/`・`R/context/`・`R/panel/provider.ts`)と、`decisions` を §11.3 に記録する | オーケストレーター | W2 の依頼文の「前の手順で確定した事項」に入れる |
| O1-2 | 実機確認 2・3(claude)を行う。scratchpad の一時のスクリプトから `ClaudeCliProvider` を呼ぶ。実行の前にユーザーに確かめる | オーケストレーター | §11.3 に結果がある |
| O1-3 | 実機確認 5〜8(codex)を行う。scratchpad の一時のスクリプトから `CodexCliProvider` を呼ぶ。実行の前にユーザーに確かめる | オーケストレーター | §11.3 に結果がある |
| O1-4 | O1-3 で codex の読み取り専用のサンドボックスかツールの無効化が実現できなかったら、設計書 §15 の 1(codex をプロバイダーに残すか)をユーザーに聞く | オーケストレーターとユーザー | 答えが §11.3 にある。codex を外すなら、W2 の前に `raguel-w1-fix` で `codexCli.ts` の扱いを直す |
| O1-5 | O1-2・O1-3 の結果で設計書の【要確認】の記述が変わるなら、ユーザーに示し、承認を得て設計書を直す | オーケストレーターとユーザー | 直したなら単独のコミットがある |

---

## 5. Workflow `raguel-w2-core`

既存のモジュールを書き換え、W1 の基盤をつなぐ。W2 の終わりに、raguel-mcp は設計書 §6 の姿になり、ツールの入出力と記録の形式が確定する。W2 と W3 の間は codiel のスキルが旧い入力のままなので、codiel の run を始めない(§11.1)。

### 5.1 構成

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `contract` | W2-T01 | 直列 | 1 |
| 2 `layers` | W2-T02、W2-T03、W2-T04、W2-T05、W2-T06 | `parallel`(すべて W2-T01 に依存) | 5 |
| 3 `panel` | W2-T07 | 直列(W2-T04・T05 に依存) | 1 |
| 4 `pipeline` | W2-T08 | 直列(phase 1〜3 のすべてに依存) | 1 |
| 5 `gate` | W2-G | 直列 | 1 |

エージェント数は 9 である。phase 2 の 5 タスクは触るファイルが重ならない。phase 2 と 3 の間は型検査が通らないことがあるが、ゲートまでに W2-T08 が揃える。

### 5.2 タスク

#### W2-T01 型と設定の契約

- 内容: 設計書 §6.2.5・§6.9.2・§6.12 の型と設定。`R/core/types.ts` を新しい形(`Artifact` の `phase` と `subject`、`Finding`、`EvaluationResult` の新しいフィールド、`JudgeStatus`、verdict.json と索引と裁定の記録の型、`DiffFile`・`ParsedDiff`、`RaguelConfig` の新しい形)に改める。`Subject` は W1-T02 の `R/subject/types.ts` を正本とし、`R/core/types.ts` はそれを import か re-export して、定義し直さない(§2)。`R/rules/params.ts` を新設し、全ルールのパラメータのスキーマを 1 つの表で持つ(§2)。ルール層の共有ヘルパー `R/rules/util.ts` と `R/rules/testHelpers.ts` を新しい型に合わせる(§2)。`makeConfig()` は廃止したキー(`judge.canStop`、`panel.trivial`・`panel.standard`・`panel.critical`)を返さず、新しい設定の形を返す。`util.ts` の関数の振る舞い(`keywordMatches` の一致の規則など)は変えず、ルールごとの振る舞いの改めは W2-T04・T05 が各ルールのファイルの中で行う。`R/config/schema.ts`・`defaults.ts`・`loader.ts` を設計書 §6.12.1〜§6.12.4 に改める(JSON、読む順、プロジェクトルートの `.codiel/config.json`、厳格なスキーマ、廃止したキーとルール ID の読み込みエラー、sealed のリストの和集合、`excludeDefaults` の除き方、起動時に壊れた設定でも起動するための結果の型)。`R/core/invariants.ts` を設計書 §6.12.3 の表に改める。configSource の文言は M4-C の `env:`・`cwd:`・`defaults` のまま保つ(設計書 §6.2.5)。出発点の `loader.ts` は M4-C の形(`configCandidate`・`createConfigReloader`)なので、読み直しの仕組みを保ったまま探す起点をプロジェクトルートに改める。R24 の `R/config/paths.ts` を新設する(§2)。`testsDir` は `RAGUEL_CONFIG` を設定したときもプロジェクトルートの `.codiel/config.json` から、`readCodielConfig` と同じ規則と既定値(`docs/codiel/tests`)で読み、不正なら読み込みの失敗にする(設計書 §6.12.1)。
- 触るファイル: `R/core/types.ts`・`R/rules/params.ts`(新設)・`R/rules/{util,testHelpers}.ts`・`R/config/{schema,defaults,loader}.ts`・`R/config/paths.ts`(新設)・`R/config/__test__/{loader,paths}.test.ts`・`R/core/invariants.ts`・`R/core/__test__/invariants.test.ts`
- ドメイン: impl
- 依存: W1-G、O1-1
- 完了条件: 設計書 §7.1 の「設定」の行のテストが通る(`pnpm exec vitest run plugins/codiel/raguel-mcp/src/config plugins/codiel/raguel-mcp/src/core/__test__/invariants.test.ts`)。所見 A3(sealed の各検査)・A14・E2・C5(パネルの構成のキーの廃止)・R20 の検査・R21 の上限・R23 の読む順と、R24 の `testsDir` の読み方(既定、`RAGUEL_CONFIG` のとき、不正な値)と `classifyPath` の判定(`testsDir` の外の `reports/` は外れない、`.` のとき)が、それぞれ 1 件以上のテストにある。configSource の 3 種の値がテストにある。`grep -rn "canStop" plugins/codiel/raguel-mcp/src/config plugins/codiel/raguel-mcp/src/core/types.ts plugins/codiel/raguel-mcp/src/rules/testHelpers.ts` が、廃止の読み込みエラーの文言を除いて 0 件。`makeConfig()` が廃止したキー(`judge.canStop`、`panel.trivial`・`panel.standard`・`panel.critical`)を返さない。`R/core/types.ts` に `Subject` の型の定義が無く、`R/subject/types.ts` からの import か re-export だけがある
- 委譲先: complex-impl
- スキル: なし

#### W2-T02 ケースファイル

- 内容: 設計書 §6.9・§6.10。`R/casefile/store.ts` を `<runId>/<phase>/attempt-NN` の配置、既知の証拠ファイルの一覧、`subject.json`・`submission.txt`、`evaluations.jsonl` と `outcomes.jsonl` の読み書き、一時ファイルと rename、読めない索引を上書きしないこと、最後の評価の時刻による掃除と索引の掃除、「評価の記録が無い」と改竄の文言の区別、に改める。`submission-digest.json` は W1-T01 の `digest.ts` を使う。`R/casefile/hashchain.ts` を seed と `prevChainHead` を入れる形に改める。projectId と `casesDir` は W1-T01 の関数を使う。
- 触るファイル: `R/casefile/{store,hashchain}.ts`・`R/casefile/__test__/{store,hashchain}.test.ts`
- ドメイン: impl
- 依存: W2-T01
- 完了条件: 設計書 §7.1 の「ケースファイル」の行のテストが通る。所見 F4(フェーズ単位の attempt)・G3・G4・G5・G6・G8・I1(`latestAttemptDir`・`resolveProjectId`・`sweepRetention` の `maxDays`)が、それぞれ 1 件以上のテストにある
- 委譲先: complex-impl
- スキル: なし

#### W2-T03 判例

- 内容: 設計書 §6.11 と §6.2.9 の保存の部分。`R/precedent/store.ts` の索引を `{ sha256, retiredAt, retireReason }` の形にし、一覧・退役の関数、`phase` と `ruling` のフィールド、一時ファイルと rename、読めない索引を上書きしないことを足す。`R/precedent/retrieval.ts` が退役した判例を除く。firedRules から `panel/*-error`・`kernel/*`・`rule-error` を除く関数を export する(記録は W2-T08 の record_outcome が呼ぶ)。シード判例は据え置く。
- 触るファイル: `R/precedent/{store,retrieval}.ts`・`R/precedent/__test__/{store,retrieval}.test.ts`・`R/precedent/seed/**`(型の追随だけ)
- ドメイン: impl
- 依存: W2-T01
- 完了条件: 設計書 §7.1 の「判例」のうち保存と検索の部分のテストが通る。所見 G2 の firedRules の除外と、退役した判例が検索に出ないことがテストにある
- 委譲先: normal-impl
- スキル: なし

#### W2-T04 ルール層(common)

- 内容: 設計書 §6.4.2 の common の 4 ルール。`common/secrets` の検出の改め(見出し行の構造的な除外、`/` と `.` での分割、3 種の文字の条件、`user:pass@`、抜粋と伏せ字、`allowPatterns` をトークンに当てる)と `maskSecrets` の export。`common/injection-marker` の `system-prompt-forgery` の改め。`common/resubmission-loop` の比較の相手の絞り込み(ruleId が消えた attempt、裁定のある attempt、degraded の attempt を外す)、stop への昇格の廃止、MinHash の類似度、`findAddressedButSimilar` の export。`common/max-size` は型の追随だけ。パラメータは `R/rules/params.ts` から読む。
- 触るファイル: `R/rules/common/**`(`__test__/` を含む)
- ドメイン: impl
- 依存: W2-T01
- 完了条件: 設計書 §7.1 の「ルール層」の common の部分と「再提出の判定」のテストが通る。所見 A1(60 行の標本で出ないこと)・A2・A3(トークンに当てる)・A12・D5・H1・G1(抜粋の位置)が、それぞれ 1 件以上のテストにある。`rules/util.ts` と `rules/testHelpers.ts` を変えない(W2-T01 が持つ。要れば blocked で報告する)
- 委譲先: complex-impl
- スキル: なし

#### W2-T05 ルール層(code・plan・decision)とレジストリ

- 内容: 設計書 §6.4.1〜§6.4.3 の残り。`code/dangerous-patterns` を `code/destructive-ops`(新設)と `code/unsafe-exec`(新設)に分けて旧ファイルを削除する。`code/protected-paths` に `excludeDefaults` と `generated` を足し、`code/generated-only` と `code/no-change` の所見の ID を登録する。生成物と E2E のレポートの判定は W2-T01 の `classifyPath` を使い、どちらのパスにも `common/secrets` 以外のルールを当てない(設計書 §6.4.2、R24)。`code/test-deletion`・`code/new-dependency` の改め。`rules/code/diffParse.ts` の引用符付きのパスと 8 進エスケープの復号、解釈できない見出しの `rule-error`。plan と decision の 5 ルールを info にし、`irreversible-ops` を語幹一致に、`max-steps` を plan だけにして `## Step N` を数える形にする。`rules/registry.ts` にルールとファイルの組ごとの集約と件数の上限(設計書 §6.4.3 の 1 行目と 3 行目)を入れる。`irreversible-ops` の語幹一致のような一致の規則の改めは、各ルールのファイルの中で行う。`rules/util.ts`・`rules/testHelpers.ts` は W2-T01 が持つので変えず、変える必要が出たら blocked で報告する。
- 触るファイル: `R/rules/code/**`・`R/rules/plan/**`・`R/rules/decision/**`・`R/rules/registry.ts`・`R/rules/__test__/registry.test.ts`(`__test__/` を含む)
- ドメイン: impl
- 依存: W2-T01
- 完了条件: 設計書 §7.1 の「ルール層」の残りと「保護パスの除外と生成物」のうちルールの部分のテストが通る。所見 A4(見逃しの型)・A5・A6(引用符付きのパス)・A7・A8・A9・A10・A11・I3(集約)・R20 と、R24 のレポートのパスにルールが当たらないことが、それぞれ 1 件以上のテストにある。`ls plugins/codiel/raguel-mcp/src/rules/code/dangerousPatterns.ts` が失敗する。旧 ID `code/dangerous-patterns` がレジストリに無い。`rules/util.ts` と `rules/testHelpers.ts` を変えていない
- 委譲先: complex-impl
- スキル: なし

#### W2-T06 重さ判定

- 内容: 設計書 §6.5。kind ごとの基礎点と加点、code の trivial の範囲、不可逆キーワードの加点の廃止、ask 以上の所見による床、`code/protected-paths` と `plan/irreversible-ops` が ask 以上のときだけ critical の床、固定部の最長接頭辞による保護パスの近接、生成物と E2E のレポートのパス(W2-T01 の `classifyPath`)を変更行数・ファイル数・近接から外すこと、Jev の文脈判定の tier の下限(W1-T03 の出力)を受けて上げること。`ParsedDiff` は W2-T01 の型を使い、`diffParse.ts` の実装に依存しない形でテストする。テストは W2-T01 が新しい型に合わせた `rules/testHelpers.ts` の `makeArtifact`・`makeConfig` を使い、この 2 つと `rules/util.ts` を変えない(要れば blocked で報告する)。
- 触るファイル: `R/core/weight.ts`・`R/core/__test__/weight.test.ts`
- ドメイン: impl
- 依存: W2-T01
- 完了条件: 設計書 §7.1 の「重さ判定」の行のテストが通る。所見 B1・B2(49 行・4 ファイルで 33 点、文書が standard を下回らない)・B3 と、R20 の生成物と R24 のレポートの除外、Jev の下限が上げる向きだけに効くことがテストにある
- 委譲先: normal-impl
- スキル: なし

#### W2-T07 パネルと合成規則

- 内容: 設計書 §6.6 と §6.2.5 の `reasons`・`decisionPoint`。`R/panel/runner.ts` を tier ごとの構成(standard の code と文書、critical)、文書の standard で前フェーズの証拠があるときの crosscheck の並列、steelman が adversarial と crosscheck の所見に反駁すること、meta を critical だけにすること、`CallControl` を必須にして締切と `signal` を渡すこと、に改める。`panelists/assumption.ts`・`panelists/precedent.ts` とそのテストを削除する。`rubrics.ts` の軸の名前と、全プロンプトの「100 = 問題なし」、adversarial の職務の改め、事実表の新規ファイルの表記、判例の参考入力。`R/core/verdict.ts` の合成規則を設計書 §6.6.3 の 10 ステップに改め、`judgeStatus` と `degradedReasons`、`decisionPoint` の定型文を出す。パネルのテストのヘルパー(`fakeProvider.ts`・`fixtures.ts`)を `R/panel/__test__/helpers/` へ移す。
- 触るファイル: `R/panel/{runner,prompts,rubrics,schema}.ts`・`R/panel/panelists/**`・`R/panel/testing/{fakeProvider,fixtures}.ts`(削除)・`R/panel/__test__/**`(`provider`・`claudeCli`・`codexCli` のテストを除く)・`R/core/verdict.ts`・`R/core/__test__/verdict.test.ts`
- ドメイン: impl
- 依存: W2-T01、W2-T04、W2-T05(所見の ID の一覧を使う)
- 完了条件: 設計書 §7.1 の「合成規則」「パネルの構成」の行のテストが通る。所見 C2・C5(provider none が degraded の ASK)・D2・D6 と R15 が、それぞれ 1 件以上のテストにある。`grep -rln "assumption\|panel/precedent" plugins/codiel/raguel-mcp/src --include=*.ts` が、撤去の経緯のコメントを除いて 0 件
- 委譲先: complex-impl
- スキル: なし

#### W2-T08 パイプライン・ツール・サーバー

- 内容: 設計書 §6.2・§6.3・§6.8 のつなぎ込み。`R/core/pipeline.ts` を 11 の手順(設計書 §6.3)に改め、空の差分の経路とレポートだけの差分を変更なしにする経路(設計書 §6.2.2 の手順 6・7。判定は W2-T01 の `classifyPath`)、パネルの入力で生成物とレポートを 1 行にすること、前フェーズ証拠(フェーズの表で解き、tier と verdict に関係なく本文を渡す)、`maskSecrets` を当てた `submission.txt` と Jev の入力、Jev の文脈判定のつなぎ込み(呼ばない場面を含む)、締切・再試行・キャンセル・進捗の通知、内部エラーの一意の evaluationId、事実表(所見 A13)、応答の `findings` の上限と並べ方、を入れる。`R/tools/*.ts` を設計書 §6.2 の新しい入力(旧入力の廃止)と応答に改め、入力の誤りを `isError` で返す。`listPrecedents.ts`・`retirePrecedent.ts` を新設し、`recordOutcome.ts` に `ruling` と組み合わせの検査、firedRules の除外を足す。`listRules.ts` にパラメータの一覧・configSource・buildVersion・プロバイダーの解決結果・`policy.protectedPaths` を載せる。`R/server.ts` を、設定が壊れていても起動する形と、ツール 2 本の登録に改める。`raguel-mcp/build.ts` の `define` でバージョンを埋め込む。依存を設計書 §8 のとおり上げる(所見 J4)。`R/subject/` の関数と `Subject` の型は W1-T02 の形のまま使う。出力の形を変える必要が出たら、変えずに blocked で報告する。
- 触るファイル: `R/core/pipeline.ts`・`R/core/__test__/pipeline.golden.test.ts`・`R/core/log.ts`(要るときだけ)・`R/tools/**`(`__test__/` を含む)・`R/server.ts`・`plugins/codiel/raguel-mcp/build.ts`・`plugins/codiel/raguel-mcp/package.json`(`dependencies` の版だけ)
- ドメイン: impl、manifest
- 依存: phase 1〜3 のすべて
- 完了条件: 設計書 §7.1 の「空の差分」「保護パスの除外と生成物」「testsDir と E2E のレポート」のうちパイプラインの部分、「パイプライン」「判例」のうち record_outcome の部分、「Jev の文脈判定」のうちつなぎ込みの部分(`common/secrets` の stop で呼ばれない、送る `state` が伏せ字済み)のテストが通る。所見 D3・E1(起動時)・F1(旧入力が無い)・F2・F6・G1(`submission.txt`)・G7(`false-positive` の記録)・I1(前フェーズ改竄の STOP、meta の失敗、`onError` の分岐の撤去)・I2・J2 が、それぞれ 1 件以上のテストにある。`grep -n '"diff"\|"files"\|"plan"\|"steps"\|"design"\|"requirements"' plugins/codiel/raguel-mcp/src/tools/*.ts` が入力のスキーマに 0 件
- 委譲先: complex-impl
- スキル: なし

#### W2-G ゲート

- 内容: W1-G と同じ 5 つのコマンドを実行し、通ったら §9 の C2 の単位でコミットする。
- 触るファイル: `pnpm-lock.yaml`、`plugins/codiel/raguel-mcp/dist/**`
- ドメイン: bundle、manifest
- 依存: phase 1〜4 のすべて
- 完了条件: 5 つのコマンドの終了コードが 0。W1-G の 2 つの grep が 0 件。`git status --short` に W2 の未コミットの変更が残らない
- 委譲先: light-impl
- スキル: なし

### 5.3 W2 の後のオーケストレーターの手順

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O2-1 | W2 の各タスクの報告から、ツールの入出力のスキーマ、`EvaluationResult` の形、ケースファイルの配置、`evaluations.jsonl`・`outcomes.jsonl`・verdict.json・`subject.json` の形、`record_outcome` の組み合わせ、configSource の値、所見の ID の一覧(`code/no-change`・`code/generated-only`・`contextJudge/unavailable` を含む)、`decisions` を §11.3 に記録する | オーケストレーター | W3 の依頼文の「前の手順で確定した事項」に入れる |
| O2-2 | 実機確認 4(standard と critical の所要時間)を行う。scratchpad の一時のスクリプトから `evaluateArtifact` を、このリポジトリの実際の差分と文書で呼ぶ。実行の前にユーザーに確かめる | オーケストレーター | §11.3 に、tier ごとの所要時間、再試行の有無、degraded の有無がある |
| O2-3 | 実機確認 9(Jev の文脈判定)を行う。`TYPESAFE_API_KEY` がある環境で、所見 A4・A5・A12(誤検知)と A7・A8・F6(見逃し)の標本を、`contextJudge.enabled` を真にした一時の設定で評価する。実行の前にユーザーに確かめる | オーケストレーター | §11.3 に、標本ごとの確率・当てた変更・所要時間がある |
| O2-4 | O2-2 の結果で、設計書 §15 の 2(`judge.timeoutMs`・`judge.deadlineMs`・confidence の閾値)をユーザーに聞く。O2-3 の結果で、設計書 §15 の 4(Jev の閾値と重さの水準の境)をユーザーに聞く | オーケストレーターとユーザー | 答えが §11.3 にある。既定値を変えるなら、W3 の前に `raguel-w2-fix` で `R/config/defaults.ts` と該当のテストを直し、ゲートを通す。設計書の値も、ユーザーの承認の後に直す |

---

## 6. Workflow `raguel-w3-codiel`

codiel 側を W2 で確定した契約に合わせる。W3 の終わりに、codiel の run が新しい Raguel で動く。

W3 のタスクは、M4-C(`7130f69c`)で変わった codiel を出発点にする(設計書 §3.1)。依頼文の「前の手順で確定した事項」に、codiel の計画書 §9.3 の O4C-1 の行(`readCodielConfig`・`config`・`gitignore` の形、guard-write の判定の順序、guard-bash の理由文)を入れる。M4-C の `codiel-state config`・`codiel-state gitignore`・`isLegacy` の振る舞いと、M4-C で足されたテストを壊さない。

### 6.1 構成

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `records` | W3-T01、W3-T03 | `parallel` | 2 |
| 2 `guards-skills-docs` | W3-T02、W3-T04、W3-T05、W3-T06 | `parallel`(W3-T02 と W3-T04 は W3-T01 に依存) | 4 |
| 3 `gate` | W3-G | 直列 | 1 |

エージェント数は 7 である。

### 6.2 タスク

#### W3-T01 codiel-state と記録の読み込み

- 内容: 設計書 §6.13.3。`C/src/raguel-records.ts` を新設し、置き場の解決(設計書 §6.9.1 と §6.12.1 の読む順)、索引・裁定の記録・verdict.json の読み込みを持たせる。`raguel.storage` は同じ config.json を `JSON.parse` で読む(M4-C の `readCodielConfig` は `raguel` を読まない。§2)。コマンドの位置は `init`(`:680`)・`start-phase`(`:787`)・`pass-gate`(`:853`)・`mark-ask`(`:908`)で、`config`(`:1252`)・`gitignore`(`:1262`)・`isLegacy`(`:293`)は変えない(いずれも `7130f69c`)。`C/src/codiel-state.ts` の `start-phase`(code 系 4 フェーズの `startHead`)、`pass-gate`(検査 1〜10 と migrate の文言)、`mark-ask`(`--kind raguel` の検査)、`init`(Raguel の記録による STOP の検査と `raguelContract: 2`)を改める。2 者比較テスト `C/src/__test__/raguel-records.test.ts` を新設する(設計書 §6.14 の 2 本目)。raguel-mcp の CaseStore と W1-T01 の `R/project/root.ts` を相対パスで import し、書いた評価と裁定を codiel の関数で読んで pass-gate の検査が通ること、置き場の解決と projectId が両者で等しいことを、設計書 §6.14 のすべての起点とケースで確かめる。R24 の突き合わせとして、codiel の `readCodielConfig` と raguel-mcp の `resolveTestsDir`(W2-T01)の `testsDir` の一致、guard-write の `isE2eReport` と raguel-mcp の `classifyPath` のレポートの判定の一致も、同じテストで確かめる(`isE2eReport` を export していなければ、export だけを足す。`guard-write.ts` はこのタスクの触るファイルに入れず、要れば blocked で報告する)。
- 触るファイル: `C/src/raguel-records.ts`(新設)・`C/src/codiel-state.ts`・`C/src/__test__/codiel-state.test.ts`・`C/src/__test__/raguel-records.test.ts`(新設)
- ドメイン: impl
- 依存: W2-G、O2-1
- 完了条件: 設計書 §7.1 の「codiel-state」と「2 者比較」の 2 本目のテストが通る。pass-gate の検査 1〜10 ごとに、外れた入力で非ゼロで終わるテストがある。所見 D1・D4 と、R16 の検査 8・9、R24 の `testsDir` とレポートの判定の突き合わせがテストにある。M4-C の `codiel-state.test.ts` の `config`・`gitignore`・`isLegacy` のテストがそのまま通る。`grep -rn "raguel-mcp/src" plugins/codiel/src --include=*.ts | grep -v __test__` が 0 件
- 委譲先: complex-impl
- スキル: なし

#### W3-T03 契約の文書と checklist

- 内容: 設計書 §6.14。`C/docs/raguel-contract.md` を新設し、フェーズの表、ケースファイルの配置と置き場の解決、`evaluations.jsonl`・`outcomes.jsonl`・verdict.json・`subject.json` の形、裁定の組み合わせ、pass-gate の検査を書く。値は §11.3 の O2-1 の記録から写す。`C/docs/format-change-checklist.md` に「Raguel との契約」のセクションを足す。
- 触るファイル: `C/docs/raguel-contract.md`(新設)・`C/docs/format-change-checklist.md`
- ドメイン: docs
- 依存: W2-G、O2-1
- 完了条件: 契約の文書に 5 つの項目がそれぞれある。checklist のセクションが、`R/codiel/phases.ts`・`R/casefile/`・`R/config/paths.ts`・`C/src/codiel-state.ts` の `STAGES`・`GATED`・`readCodielConfig`・`C/src/hooks/guard-write.ts` の `isE2eReport`・`C/src/raguel-records.ts`・raguel-gating の対応表・2 者比較テストの 2 本を並べる。契約の文書に、`testsDir` の読み方とレポートの判定(R24)がある
- 委譲先: general
- スキル: なし

#### W3-T02 guard の保護

- 内容: 設計書 §6.13.4。guard-write が、run が active か awaiting_human の間、`.codiel/config.json` の全体・`RAGUEL_CONFIG` が指すファイル・`casesDir` の配下への Write と Edit を deny する。guard-bash が、同じ条件と同じパスで、リダイレクト・`tee`・`sed -i`・`cp`・`mv`・`rm`・`dd`・`install` を deny する。置き場の解決は W3-T01 の `raguel-records.ts` を使う。既知の限界はコメントに書く。
  - guard-write の deny は、M4-C の判定の順序(codiel 設計 §6.17.6)を崩さず、`findActiveRun` の直後、`status !== "active"` で通す分岐の前(`guard-write.ts:229-230` の間(`7130f69c`))に置く。awaiting_human の run でも効かせるためである。`state.intent`・config の読み込み・未記録の GOTCHAS の退避先・`docs/intents/**`・文書フェーズ・コード系フェーズの判定と、その理由文は変えない。
  - guard-bash の判定は、M4-C の `writesStateJson`(`guard-bash.ts:754-790`(`7130f69c`)、codiel 決定 96)と同じく `parseCommands` の語の列に当て、閉じていないクォートでは `splitLoosely` の語で見る。run の判定は `findActiveRun`(`:798`)の後に置く。state.json の判定と理由文は変えない。
- 触るファイル: `C/src/hooks/{guard-write,guard-bash}.ts`・`C/src/hooks/__test__/{guard-write,guard-bash}.test.ts`
- ドメイン: impl
- 依存: W3-T01
- 完了条件: 設計書 §7.1 の「hook」の行のテストが通る。active と awaiting_human の 2 つの状態で、3 種のパスへの Write・Edit と、Bash の各形が deny になり、run が無ければ通る。所見 G8 と R12 がテストにある。M4-C の guard-write のテスト(判定の順序、E2E のレポート、`<runsDir>/` の ask、未記録の GOTCHAS の退避先)と guard-bash のテスト(state.json の判定の誤検知の再発)がそのまま通る
- 委譲先: complex-impl
- スキル: なし

#### W3-T04 raguel-gating

- 内容: 設計書 §6.13.1 の表の全行。フェーズ→ツールの対応表(`phase`、`baseRef`、`paths`)、fix-loop の評価の範囲、空の差分でも起点を変えないこと、STOP の誤検知の `ruling: false-positive`、改竄の STOP では止める選択肢だけにすること、裁定 A の `revise` を再評価の前に記録すること、裁定 B の `as-is`、degraded の ASK の 3 択と `stop --reason raguel-degraded`、「同一フェーズで ASK が 3 回続いたら止める」の撤去(R17)、バックグラウンドへ移ったときに完了の通知を待つこと、`decisionPoint` と `reasons` の提示、AskUserQuestion の質問文に懸念の要約と `decisionPoint` を入れる規則。M4-C の応急処置の 2 つの文を消す。対応表の「そのフェーズの差分が空なら `git diff <base>...HEAD` を渡す」(`SKILL.md:58`(`7130f69c`))と、`git diff` にレポートの除外の pathspec を付けて空を決める規則(`:66`)である。誤検知の退避先は M4-C の `<runsDir>/<slug>/unrecorded-gotchas.md`(run が無いときは `.codiel/reports/unrecorded-gotchas.md`)に揃える(`:137`)。`mark-ask` と `pass-gate` の引数は W3-T01 の報告に合わせる。
- 触るファイル: `C/skills/raguel-gating/SKILL.md`
- ドメイン: prompt
- 依存: W3-T01
- 完了条件: 設計書 §6.13.1 の各行の受け入れ基準がすべて満たされる。対応表の 9 行が `phase` を持ち、旧入力の名前(`diff`・`files`・`plan`・`design`)が対応表に無い(報告に対応表を貼る)。`grep -n "3 回続いたら" plugins/codiel/skills/raguel-gating/SKILL.md`・`grep -n '<base>...HEAD' plugins/codiel/skills/raguel-gating/SKILL.md`・`grep -n 'exclude,glob' plugins/codiel/skills/raguel-gating/SKILL.md` がそれぞれ 0 件。`grep -n "unrecorded-gotchas.md" plugins/codiel/skills/raguel-gating/SKILL.md` に 2 つの退避先がある。3 つの場面(ASK・STOP・degraded の ASK)の AskUserQuestion の手順に、質問文へ要約と `decisionPoint` を入れる文がある
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### W3-T05 orchestrating-runs と initializing-harness

- 内容: 設計書 §6.13.2 と §9 の initializing-harness の行。orchestrating-runs のゲートの手順の「全文を渡す」「git diff を渡す」を raguel-gating の対応表の参照に置き換え、code 系フェーズの開始の HEAD が state に記録されることを書く。initializing-harness のスキルの本文に、配列の和集合と置換の規則、`storage.projectId`、`code/protected-paths` の `excludeDefaults` と `generated` の書き方と使う場面を書き、雛形 `C/skills/initializing-harness/config.example.json` の例を合わせる。M4-C で書き換わった両スキルの本文(`.codiel` の構成、`codiel-state config`・`gitignore` の使い方、E2E のレポート)は変えない。orchestrating-runs に E2E のレポートを evaluate_code の前にコミットする手順があれば残す(Raguel がレポートを評価から外す前提で、コミットは要る)。
- 触るファイル: `C/skills/orchestrating-runs/SKILL.md`・`C/skills/initializing-harness/**`
- ドメイン: prompt
- 依存: W2-G、O2-1
- 完了条件: 設計書 §6.13.2 の各行の受け入れ基準が満たされる。`grep -n "差分オーバーレイ\|raguel.config" plugins/codiel/skills/initializing-harness/SKILL.md` が、旧 YAML の移し方の説明を除いて 0 件。`grep -n "excludeDefaults\|generated" plugins/codiel/skills/initializing-harness/SKILL.md` が 1 件以上。`wc -c plugins/codiel/skills/orchestrating-runs/SKILL.md` を報告する
- 委譲先: general
- スキル: `prompt-smith:prompt-smith`

#### W3-T06 Raguel の DESIGN と codiel の README

- 内容: 設計書 §9 の DESIGN.md と README の行。`plugins/codiel/raguel-mcp/docs/DESIGN.md` を設計書に合わせて書き直す(契約の詳細は `C/docs/raguel-contract.md` を参照させる)。今も残る `raguel.config.yaml` の設定の説明を撤去し、`.codiel/config.json` の `raguel` キーと `testsDir` の読み方に置き換える(設計書 §9)。`plugins/codiel/README.md` に Raguel の運用のセクションを足す。O1-4・O2-4・O0-5 で決まった扱い(codex の限界、既定値、`--setting-sources` の扱い)を §11.3 から写す。
- 触るファイル: `plugins/codiel/raguel-mcp/docs/DESIGN.md`・`plugins/codiel/README.md`
- ドメイン: docs
- 依存: W2-G、O2-4
- 完了条件: 設計書 §9 の 2 行の項目がすべてある。`grep -n "raguel.config.yaml" plugins/codiel/README.md plugins/codiel/raguel-mcp/docs/DESIGN.md` が、廃止を説明する文を除いて 0 件。`grep -n "assumption\|canStop\|kind ごと" plugins/codiel/raguel-mcp/docs/DESIGN.md` が、撤去の経緯を除いて 0 件
- 委譲先: general
- スキル: なし

#### W3-G ゲート

- 内容: W1-G と同じ 5 つのコマンドを実行し、通ったら §9 の C3 の単位でコミットする。
- 触るファイル: `plugins/codiel/scripts/**`、`plugins/codiel/raguel-mcp/dist/**`
- ドメイン: bundle
- 依存: phase 1〜2 のすべて
- 完了条件: 5 つのコマンドの終了コードが 0。W1-G の grep と W3-T01 の grep が 0 件。`git status --short` に W3 の未コミットの変更が残らない
- 委譲先: light-impl
- スキル: なし

### 6.3 W3 の後のオーケストレーターの手順

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O3-1 | W3 の報告の `decisions` と、W3-T01 の CLI の文言を §11.3 に記録する | オーケストレーター | W4 のレビューの依頼文に入れる |

---

## 7. Workflow `raguel-w4-review`

W3-G のコミットの後に始める。

| phase | タスク | 並列 | エージェント数 |
| --- | --- | --- | --- |
| 1 `review` | W4-R1、W4-R2 | `parallel` | 2 |

#### W4-R1 差分のレビュー

- 内容: O0-1 のマージのコミットから W3-G のコミットまでの差分(`harness-docs/` を除く)を、設計書 §6〜§7 と照らしてレビューする。所見は §1 の severity の基準で返す。
- 依存: W3-G
- 委譲先: code-review
- スキル: なし

#### W4-R2 最終レビュー

- 内容: 同じ差分を、設計書 §1 の決定 R1〜R23、§4 の所見の扱い、§14 の Done 条件と照らす。特に、ゲートを素通りさせる経路(pass-gate の検査の抜け、guard の抜け、Jev が許された向きの外へ判定を動かす経路、生成物の宣言の抜け道)と、秘密情報が外部へ送られる経路を探す。
- 依存: W3-G
- 委譲先: final-review
- スキル: なし

critical・high があれば、修正の Workflow(`raguel-w4-fix`)で直し、W3-G と同じゲートをやり直してから §8 へ進む(§11.2)。

---

## 8. 最後のオーケストレーターの手順

| # | 手順 | 実行者 | 確認方法 |
| --- | --- | --- | --- |
| O5-1 | ADR「[codiel] Raguel の作り直し」を足す。`metatron:updating-architecture` スキルを起動し、その手順(diff-architecture、get rules、草案の第三者検査)に従う。`stage-adr` → `commit-architecture` だけで済ませない。要点は設計書 §9 の 4 つである | オーケストレーターとユーザー(対話) | ARCHITECTURE の ADR 一覧に新しい ADR がある |
| O5-2 | `.serena/memories/codiel/raguel_mcp.md` を Serena の `edit_memory` で直す(バージョン、パネリストの構成、プロバイダー、Jev の文脈判定、ケースファイルの配置、fake の置き場、設定の置き場) | オーケストレーター | メモリに `assumption`・`0.4.1-dev`・`raguel.config.yaml` が残っていない |
| O5-3 | ルートの `README.md` の codiel の行に、Raguel のプロバイダーの選択を 1 文で足す | オーケストレーター(general へ委譲してよい) | 1 文がある |
| O5-4 | バージョンを上げる。codiel の `plugin.json` と `package.json` を `1.0.0-dev`、raguel-mcp の `package.json` を `0.0.2-dev` にする(2026-09-29 にユーザーの指示で改めた)。`pnpm run build` で `dist/server.mjs` の名乗るバージョンを作り直し、lint・typecheck・test を通す | オーケストレーター(light-impl へ委譲してよい) | 3 つのファイルの値が揃う。`grep -n "0.1.0-dev" plugins/codiel/raguel-mcp/dist/server.mjs` が 1 件以上 |
| O5-5 | O5-2〜O5-4 を §9 の C5 の単位でコミットする | オーケストレーター | `git status --short` に本改修の変更が残らない |
| O5-6 | 手動確認に使うプラグインの複製を、作り直しの後の HEAD(O5-5 のコミット)で作る。codiel の計画書 §9.3 の O4C-4 と同じ構成(`codiel`・`metatron`・`gh-utility` の 3 つを `git archive` で書き出す)にする。既存の `~/codiel-o4c-plugins` は消さず、新しい置き場 `~/codiel-o4c-plugins-r` に作る。消すのはユーザーが自分の手で行う | オーケストレーター | §11.3 に、複製の置き場・コミット・3 つのバージョン(codiel `1.1.0-dev` を含む)がある |
| O5-7 | Raguel の手動確認を行う。§8.1 の項目を確かめる。Claude Code を O5-6 の複製で起動し直して、新しい MCP サーバーを読ませてから始める。実機確認 10(progressToken、120 秒でのバックグラウンドへの移行と完了の通知、MCP の呼び出しの時間の上限)もここで見る。§8.1 の項目は、O5-8 の run の中で確かめてよい(run を減らして費用を抑えるため)。始める前にユーザーに確かめる | オーケストレーター(ユーザーに確かめてから) | §11.3 に §8.1 の各項目の YES / NO / 機会なしがある。run は最後に終端にする |
| O5-8 | codiel の手動確認 O4C-6〜O4C-8 を、codiel の計画書 §6.8 の手順と確認項目のとおりに行う。複製は O5-6 のもの、画面を持つサンプルは `~/codiel-o4c-sample`(そのまま使える)、O4C-6 の作業ツリーは `~/codiel-o41-gh`・`~/codiel-o41-local` である。結果は codiel の計画書 §9.3 の書き方に揃えて本書の §11.3 に記録し、codiel 側の記録へ写すかはユーザーに確かめる。始める前にユーザーに確かめる | ユーザーとオーケストレーター | §11.3 に、O4C-6〜O4C-8 の各確認項目の YES / NO / 機会なしがある。各 run を終端にする |
| O5-9 | O5-7・O5-8 で NO が出たら、直す前に原因が codiel の M4-C にあるか、Raguel の作り直し(本計画の変更)にあるかを切り分ける。切り分けは、NO の場面で使ったファイルを `git log 7130f69c..HEAD -- <パス>` で本計画の変更に含むかで見て、Raguel の評価の記録(`casePath`)と codiel の state を読み比べて行う。本計画の変更が原因なら、修正の Workflow(`raguel-w5-fix`)で直し、W3-G と同じゲートを通してから、その確認をやり直す。M4-C が原因なら本計画では直さず、所見を §11.3 に記録してユーザーに示し、直す場所(codiel の intent 駆動化のブランチか本ブランチか)を決めてもらう。どちらとも決められないときも、ユーザーに示す | オーケストレーター(M4-C が原因のときはユーザーと) | §11.3 に、NO ごとの原因の切り分けと扱いがある |
| O5-10 | O5-7・O5-8 の結果と実機確認 10 で設計書の【要確認】の記述が変わるなら、ユーザーに示し、承認を得て設計書と README を直す | オーケストレーターとユーザー | 直したなら単独のコミットがある |

### 8.1 Raguel の手動確認の項目(O5-7)

対象は、変更の無いフェーズ・生成物の宣言・E2E のレポートを試せるプロジェクトにする。O5-8 の O4C-7(画面を持つサンプル)の run で E2E のレポートの項目を、O4C-6 の run でそのほかの項目を確かめてよい。

| # | 確かめること | 設計書 |
| --- | --- | --- |
| 1 | intent・design・test-spec・dev-plan・test-code・implement・test-loop・intent-sync・fix-loop の各ゲートが、新しい入力(`phase`・`baseRef`・`paths`)で評価され、pass-gate が Raguel の記録を照合して通る | §6.2、§6.13.3 |
| 2 | 変更の無い test-loop が、空の差分で PROCEED と `code/no-change` になり、pass-gate を通る | §6.2.2、R22 |
| 3 | `generated` に `plugins/*/scripts/**`・`plugins/*/dist/**` を宣言したとき、生成物の差分で STOP にならない | §6.4.2、R20 |
| 4 | ASK が出たら、AskUserQuestion の質問文に懸念の要約と `decisionPoint` が入る | §6.13.1 |
| 5 | run の間に `.codiel/config.json` への Write が deny になる | §6.13.4 |
| 6 | 評価が 120 秒を超えたとき、バックグラウンドへ移り、完了の通知を待ってから進む | §6.8、R21 |
| 7 | ケースファイルの `submission.txt` と応答の抜粋に、秘密情報が平文で残らない(標本に偽の鍵を 1 つ入れる) | §6.4.2、H1 |
| 8 | E2E のレポートをコミットした後の evaluate_code で、レポートがパネルと重さに入らず、レポートだけの差分なら PROCEED と `code/no-change` になる。raguel-gating がレポートの除外の pathspec と `<base>...HEAD` を使わない | §6.2.2、§6.4.2、§6.13.1、R24 |
| 9 | Raguel の誤検知の STOP を誤検知と裁定したとき、退避先 `<runsDir>/<slug>/unrecorded-gotchas.md` に 1 件書かれ、guard-write に止められない | §6.13.1 |

---

## 9. コミットの分け方

- 基本は、ゲートごとに 1 コミットとする。raguel-mcp は codiel に同梱するので、`raguel-mcp/src` と `raguel-mcp/dist` は同じコミットに入れる。
- `pnpm-lock.yaml` は、プラグインと別のコミットにする。
- 文書だけの変更と、バージョンの上げは、別のコミットにしてよい。
- メッセージは Conventional Commits の形で書き、末尾に共同作成者の行を付ける。

| # | 作成者 | 内容 |
| --- | --- | --- |
| C0-1 | O0-1 | M4 と M4-C の取り込み(マージのコミット) |
| C1-1 | W1-G | raguel-mcp の基盤(フェーズの表、プロジェクトルート、MinHash、評価対象の取得、Jev の文脈判定、プロバイダー、fake、`dist/`) |
| C1-2 | W1-G | lockfile(`@typesafe-ai/sdk` の追加) |
| C2-1 | W2-G | raguel-mcp の本体(型、設定、ケースファイル、判例、ルール層、重さ、パネル、パイプライン、ツール、サーバー、`build.ts`、`dist/`) |
| C2-2 | W2-G | lockfile(依存の上げ) |
| C3-1 | W3-G | codiel のコード(`raguel-records.ts`、codiel-state、guard、テスト、`scripts/`) |
| C3-2 | W3-G | codiel のスキルと文書(raguel-gating、orchestrating-runs、initializing-harness、契約の文書、checklist、Raguel の DESIGN、README) |
| C5-1 | O5-5 | バージョン(codiel `1.0.0-dev`、raguel-mcp `0.0.2-dev`、`dist/`) |
| C5-2 | O5-5 | ルートの README と Serena メモリ |

O5-1 のコミットは metatron の手順に従う。修正の Workflow のコミットは、直したゲートの単位に揃える。設計書を直すコミット(O0-6・O1-5・O2-4・O5-10)は、それぞれ単独にする。O5-9 の `raguel-w5-fix` のコミットは W3-G の単位(C3-1・C3-2)に揃え、raguel-mcp を直したときは C2-1 の単位を足す。

---

## 10. 検証

### 10.1 テスト方針

- ユニットテストは vitest で書き、`.claude/rules/metatron/testing-policy.md` の置き場に従う。実際の claude・codex・Jev は呼ばない。
- 新設するテストファイルは次のとおりである。`R/codiel/__test__/phases.test.ts`・`R/project/__test__/root.test.ts`・`R/casefile/__test__/digest.test.ts`(W1-T01)、`R/subject/__test__/*.test.ts`(W1-T02)、`R/context/__test__/*.test.ts`(W1-T03)、`R/panel/__test__/codexCli.test.ts`(W1-T04)、`C/src/__test__/raguel-records.test.ts`(W3-T01)。
- 書き換える既存のテストは次のとおりである。
  - `R/panel/__test__/{provider,claudeCli}.test.ts`(W1-T04)
  - `R/config/__test__/loader.test.ts`(M4-C で JSON の読み込みと読み直しに書き換わったもの)・`R/core/__test__/invariants.test.ts`(W2-T01。`R/config/__test__/paths.test.ts` を新設する)
  - `R/casefile/__test__/{store,hashchain}.test.ts`(W2-T02)
  - `R/precedent/__test__/{store,retrieval}.test.ts`・`R/precedent/seed/__test__/index.test.ts`(W2-T03)
  - `R/rules/common/__test__/*.test.ts`(W2-T04)
  - `R/rules/{code,plan,decision}/__test__/*.test.ts`・`R/rules/__test__/registry.test.ts`(W2-T05)
  - `R/core/__test__/weight.test.ts`(W2-T06)
  - `R/panel/__test__/{prompts,rubrics,runner,schema}.test.ts`・`R/panel/panelists/__test__/*.test.ts`・`R/core/__test__/verdict.test.ts`(W2-T07。`assumption`・`precedent` のテストは削除)
  - `R/core/__test__/pipeline.golden.test.ts`・`R/tools/__test__/tools.test.ts`(W2-T08)
  - `C/src/__test__/codiel-state.test.ts`(W3-T01。M4-C の `config`・`gitignore`・`isLegacy` のテストは変えずに通す)
  - `C/src/hooks/__test__/{guard-write,guard-bash}.test.ts`(W3-T02。M4-C の判定の順序と state.json の判定のテストは変えずに通す)
- M4 と M4-C の応急処置で足されたテスト(O0-3 の 10)は、触るファイルの持ち主のタスクが書き換える。持ち主が決まらないテストは、O0-6 でこの表に足す。
- タスクは自分のテストだけを実行する。型検査・lint・全体のテストはゲートで実行する(§0.1)。
- テストで見ないもの(スキルの手順、対話、プロバイダーの実際の挙動、Claude Code のバックグラウンドへの移行)は、grep と実機確認と O5-7・O5-8 の手動確認で見る。

### 10.2 所見の「直す」とテストの対応(設計書 §4 と §7.1)

設計書 §4 で「直す」とした所見ごとに、確かめるタスクとテストを割り当てる。各タスクは報告の `findings` にテストの名前を書き、ゲートはその一覧が揃っていることを確かめる。

| 所見 | タスク | テスト(設計書 §7.1 の行) |
| --- | --- | --- |
| A1、A2、H1 | W2-T04 | ルール層(common/secrets) |
| A3 | W2-T01(sealed の検査)、W2-T04(トークンに当てる) | 設定、ルール層 |
| A4、A5 | W2-T05、W1-T03(Jev で絞る) | ルール層、Jev の文脈判定 |
| A6 | W1-T02(固定の書式)、W2-T05(引用符付きのパス) | git からの差分、ルール層 |
| A7、A8、A9、A10、A11 | W2-T05(A7・A8 は W1-T03 も) | ルール層、Jev の文脈判定 |
| A12 | W2-T04、W1-T03 | ルール層、Jev の文脈判定 |
| A13 | W2-T08 | パイプライン |
| A14、E2 | W2-T01 | 設定 |
| B1、B2、B3 | W2-T06(B1 は W1-T03 も) | 重さ判定、Jev の文脈判定 |
| C2 | W2-T07 | 合成規則 |
| C3(設定の読み込み) | W1-T04 | `fake-claude.mjs`、`claude` の `buildArgs` |
| C4 | W1-T04(再試行)、W2-T08(締切) | `claude` の `buildArgs`、パイプライン |
| C5 | W2-T01、W2-T07 | 設定、合成規則 |
| D1 | W1-T02、W3-T01 | git からの差分、codiel-state |
| D2 | W2-T07、W2-T08 | 合成規則、パイプライン |
| D3 | W2-T08 | パイプライン |
| D4 | W3-T01 | codiel-state |
| D5 | W2-T04(W1-T03 も) | 再提出の判定、Jev の文脈判定 |
| D6 | W2-T07 | 合成規則 |
| F1 | W1-T02、W2-T08 | git からの差分、パイプライン |
| F2 | W2-T08 | パイプライン |
| F4 | W2-T02 | ケースファイル |
| F6 | W2-T08(W1-T03 も) | パイプライン、Jev の文脈判定 |
| G1 | W2-T04(抜粋)、W2-T02・W2-T08(`submission.txt`) | ルール層、ケースファイル、パイプライン |
| G2 | W2-T03、W2-T08 | 判例 |
| G3、G4、G5、G6 | W2-T02(G5 は W1-T01 も) | ケースファイル |
| G7 | W2-T08(record_outcome)、W3-T04(スキル) | 判例。スキルは grep |
| G8 | W2-T02(チェーン)、W3-T02(guard) | ケースファイル、hook |
| I1 | W1-T04、W2-T02、W2-T08 | `fake-claude.mjs`、ケースファイル、パイプライン |
| I2 | W2-T08(進捗とキャンセル)、W3-T04(スキル) | パイプライン。スキルは grep |
| I3 | W1-T01(MinHash)、W2-T05(集約)、W2-T08(応答の上限) | ルール層、パイプライン |
| J2 | W2-T08 | パイプライン(応答の `buildVersion`) |
| J3、J4 | W3-T06(文書)、W2-T08(依存) | テストでは見ない。grep と W2-G のビルド |
| K1(R20) | W2-T05・W2-T06・W2-T08 | 保護パスの除外と生成物 |
| K2(R21) | W2-T01(上限)、W2-T08(締切) | 設定、パイプライン。所要時間は O2-2 |
| K4(R22) | W1-T02・W2-T08・W3-T01 | 空の差分 |
| R24(testsDir と E2E のレポート) | W2-T01(`testsDir` の読み方と `classifyPath`)、W2-T05(ルールを当てない)、W2-T06(重さから外す)、W2-T08(レポートだけの差分とパネルの入力)、W3-T01(2 者比較)、W3-T04(スキルの pathspec の撤去) | testsDir と E2E のレポート、2 者比較。スキルは grep |

「応急処置のまま残す」の所見(C1、E1 の本体、F3、F5、J1)は、応急処置のテストを消さないことを各タスクの持ち主が守る。C1 は W1-T04 の `fake-claude.mjs` で再発を止める。

### 10.3 設計書 §14 の Done 条件の担当

| Done 条件 | 担当 |
| --- | --- |
| `pnpm run lint`・`typecheck`・`test` が通る | W1-G・W2-G・W3-G・O5-4 |
| `pnpm run build` の `scripts/` と `dist/` の差分が同じコミットにある | W1-G・W2-G・W3-G・O5-4(§9 の C1-1・C2-1・C3-1・C5-1) |
| codiel が `1.0.0-dev`、raguel-mcp が `0.0.2-dev` で、MCP サーバーが同じ値を名乗る | O5-4 |
| §4 の「直す」の所見ごとに §7.1 のテストがある | §10.2 の各タスク。W4-R2 が照らす |
| §7.2 の実機確認をユーザーに確かめて行い、記録し、【要確認】を直している | O0-5(1)、O1-2(2・3)、O1-3(5〜8)、O2-2(4)、O2-3(9)、O5-7(10)。直すのは O0-6・O1-5・O2-4・O5-10 |
| §9 の文書を更新し、ADR を足している | W3-T03・W3-T05・W3-T06・O5-3、ADR は O5-1 |
| `.serena/memories/codiel/raguel_mcp.md` の食い違いを直している | O5-2 |
| ルートの `README.md` に反映している | O5-3 |
| 編集内容を適切に分けてコミットしている | §9 |

このほか、codiel の手動確認 O4C-6〜O4C-8(codiel の計画書 §6.8)は、作り直しの後へ回ったので本計画の O5-8 が担う。NO の扱いは O5-9 に従う。

---

## 11. リスクと中断時の再開

### 11.1 リスク

| リスク | 対策 |
| --- | --- |
| W2 の中で、phase 2 と phase 3 の間に型検査が通らない | 型検査はゲートだけが行う(§0.1)。タスクは自分のテストだけを実行する。W2-T01 が型と設定を先に固め、W2-T08 が最後に全体をつなぐ |
| W2 と W3 の間に codiel の run を始めると、スキルが旧い入力で evaluate を呼び、入力の誤りになる | W2-G から W3-G までの間に codiel の run を始めない。実機確認は scratchpad のスクリプトから行う |
| 並列のエージェントが同じファイルを編集する | 各 phase の「触るファイル」を重ならないように割り当てた。ルール層の共有ヘルパー `rules/util.ts` と `rules/testHelpers.ts` は、phase 1 で単独に動く W2-T01 だけが持つ。phase 2 の W2-T04・T05・T06 は読むだけで、書く側と並列にならない |
| W3 の codiel 側の変更が、M4-C の `config`・`gitignore`・`isLegacy`、guard-write の判定の順序、guard-bash の state.json の判定を壊す | W3 の依頼文に O4C-1 の記録を入れ、M4-C のテストを変えずに通すことを完了条件にした(W3-T01・W3-T02)。W4 のレビューで照らす |
| codiel の O4C-6〜O4C-8 の NO が、M4-C と作り直しのどちらの原因か分からないまま直す | O5-9 で切り分けてから直す。M4-C が原因なら本計画では直さず、ユーザーに直す場所を決めてもらう |
| M4 の取り込みで、この worktree の設計書・計画書と衝突する | M4 のブランチは `harness-docs/design/2026-09-28-*`・`harness-docs/plans/2026-09-29-*` を持たないので、衝突しないと推定する。衝突したら止めてユーザーに示す(O0-1) |
| 実機確認の費用 | 項目ごとに、実行の前にユーザーに確かめる。まとめて確かめてもよい。回数は §3.3 と §4.3・§5.3・§8 の手順の 1 回ずつに限る |
| O0-5 で代替の候補もすべて効かない | 設計書 §15 の 3 をユーザーに聞き、答えが出るまで W1 を始めない(§3.3 の 4) |
| codex のサンドボックスやツールの無効化が実現できない | O1-4 で設計書 §15 の 1 を聞く。外すなら W2 の前に直す |
| 1 回の評価が長く、W2-T08 のテストが遅くなる | テストは fake の子プロセスの遅延を短くし、締切は設定で短くして試す |
| `claude -p` の実機確認で、実行中のセッションの hooks が一時ディレクトリに副作用を残す | scratchpad の空のディレクトリで行い、終わったら中身を確かめて消す |
| 実機確認のスクリプトが `.raguel` の実際の置き場に評価を書く | スクリプトは `RAGUEL_CONFIG` で `storage.casesDir` を scratchpad に向ける |

### 11.2 中断と失敗の扱い

- Workflow が途中で止まったら、`git status --short` で未コミットの変更を確かめてから、`resumeFromRunId` で同じ Workflow を再実行する。完了したエージェントの結果は再利用され、失敗したエージェントと後続だけが動く。
- タスクが `blocked` を返したら、オーケストレーターが理由を読む。設計書との食い違いなら §11.3 に記録してユーザーに確かめる。依頼文の不足なら依頼文を直してそのタスクだけを再実行する。
- ゲートが失敗したら、コミットされていない状態で止まる。失敗の出力から原因のタスクを特定し、同じ Workflow の修正 Workflow(`raguel-w<n>-fix`)で直してから、ゲートを再実行する。原因が 1 つに絞れないときは advisor に相談する。
- 未コミットの変更を退避するときは `git stash` を使わず、一時の WIP コミットにする。stash の一覧はほかのセッションと共有されるためである。
- レビューの critical / high は `raguel-w4-fix` で直してからゲートを通し、§8 へ進む。medium / low は §11.3 に記録し、ユーザーが扱いを決める。

### 11.3 記録欄

実装中にオーケストレーターが書き込む。

| 項目 | 記録 |
| --- | --- |
| M4 の取り込み(O0-1) | 2026-09-29。`intent-driven-development` の HEAD は `7130f69c`、codiel `1.0.0`、codiel 計画書 §9.3 の O4C-1 の行は記録済み。`git merge --no-ff intent-driven-development` は衝突なしで、マージのコミットは `ed6df300`。`scripts/setup-workspace.sh` は設計セッションで実行済みで、再実行すると `cp -r` が `.claude/agents/agents` を作るため、`pnpm install` だけを実行した(lockfile は最新)。baseline(§3.1 の相当): HEAD `ed6df300`、`git status --short` は空、lint・typecheck は終了コード 0、test は 177 files passed・1 skipped、3003 tests passed・2 skipped、raguel-mcp は 39 files・324 tests passed、build は終了コード 0 で `scripts/`・`dist/` の差分なし。`claude` 2.1.284、`codex-cli` 0.144.1 |
| M4 後の HEAD で確かめたこと(O0-3) | 1〜6: 取り込んだ HEAD は `7130f69c` そのもので、答えは変わらない。7: 応急処置 11 件はすべて入っている(探索の報告。(1) `R/panel/schema.ts:57-60`、(2) `R/rules/common/secrets.ts:21,45-52,95-122`、(3) `R/server.ts:31-43`・`R/config/loader.ts:79-102,153-178`、(4) `R/rules/code/dangerousPatterns.ts:111-150`、(5) `R/tools/evaluatePlan.ts:29-51`・`evaluateCode.ts:42-75`、(6)(7) `C/src/codiel-state.ts:723-737,862-866`、(8)〜(11) raguel-gating・orchestrating-runs・reviewing-diffs の本文)。8: `claude --help` に `--setting-sources`・`--no-session-persistence`・`--strict-mcp-config`・`--tools`・`--debug-file` がある。`--model` の例は `fable`・`opus`・`sonnet` だが、O0-5 で `--model haiku` が `claude-haiku-4-5-20251001` に解決された(有効)。9: 読み取り専用のサンドボックスは `-s, --sandbox read-only`(値は `read-only`・`workspace-write`・`danger-full-access`)。`--ignore-rules` の説明は「Do not load user or project execpolicy `.rules` files」で、`AGENTS.md` の読み込みとは別の機構である。ツールを無効にする専用のフラグは無く、`--disable <FEATURE>`(`-c features.<name>=false` と同じ)と `-c <key=value>` だけがある。`--ignore-user-config` は「auth still uses `CODEX_HOME`」。効果は O1-3 で見る。10: raguel-mcp のテストは 39 本(`find` の結果)。`R/panel/testing/` に `fake-claude.mjs`・`fakeProvider.ts`・`fixtures.ts` がある。すべて W1-T04・W2-T01〜T08 の触るファイルに収まり、持ち主の決まらないテストは無い |
| `agentType` の対応(O0-4) | `workflow-authoring` の記述どおり、`agent()` の `opts.agentType` に Agent ツールと同じレジストリの名前を渡せ、`schema` と併用できる。codiel 計画書 §9.3 の対応(complex-impl → `lead-implementer`、normal-impl → `claude-implementer`、light-impl → `claude-light-implementer`、general → `general-worker`、code-review → `code-reviewer`、final-review → `claude-complex-reviewer`)は、このセッションのレジストリにすべてある。`opts.model` は渡さない。運用の差: このセッションの作業ディレクトリは `intent-driven-development` の worktree で、Serena もそちらに向いている。そのため、Workflow の各タスクの依頼文に「Serena のツールを使わず、絶対パスで Edit / Write を使う」「Bash は `cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-raguel-redesign && ...` の形で実行する」を足し、共通ブロックの「Serena の編集ツールで行う」をこれで読み替える |
| 実機確認 1 と採った `--setting-sources`(O0-5) | 2026-09-29、ユーザーの承認の後に 1 回実行。scratchpad の空のディレクトリで §3.3 の 1 のコマンドを実行し、終了コード 0、`result` は `OK`、所要 3.8 秒、`total_cost_usd` 0.0137。ログインは保たれた。debug ログでは、hooks は `Registered 0 hooks`・`Found 0 total hooks in registry`、利用者のプラグインは読まれず(`Found 2 plugins` は組み込みの `agents-md`・`telemetry` だけ、skills 0・agents 0)、CLAUDE.md は `found 0 of 6 directories`。入力は 6,652 tokens で、利用者の `~/.claude/rules/` は混じっていないと推定する。`project` を採る。候補 a〜c は試していない。付随して、`[claudeai-mcp] Fetched 1 servers` の行があり、claude.ai の MCP サーバーの一覧を取得している(`--strict-mcp-config` の効果は O1-2 の実機確認 3 で見る) |
| 食い違いの扱い(O0-6) | O0-3・O0-5 で設計書との新しい食い違いは無い。§11.4 の 1 は解決済み、2 は O0-6・O1-5・O2-4・O5-10 の運用で扱う、3 は O0-1 の取り込みで解消した。O0-3 の 9 の `--ignore-rules` の意味(execpolicy の `.rules` で、`AGENTS.md` ではない)は、設計書 §6.7.3 の【要確認】の範囲にあり、O1-3 で確かめる。ユーザーには実機確認をまとめて承認してもらった(2026-09-29。O1-2・O1-3・O2-2・O2-3 は到達時に確認なしで実行してよい。各 1 回、O2-3 は `TYPESAFE_API_KEY` があるときだけ) |
| W1 で確定した関数と `decisions`(O1-1) | Workflow `wf_882197df-a4f`。コミットは `586b1e6c`(C1-1)と `769c6ece`(C1-2)。W1-G のエージェントはコミットの後に StructuredOutput を返さずに終わったので、オーケストレーターがゲートを検証し直した(lint・typecheck は終了コード 0、test は 186 files passed・1 skipped、3154 tests passed・2 skipped、build は終了コード 0 で差分なし、`jevriel/src` の grep は 0 件)。`codiel-state` の grep は `R/codiel/phases.ts:3` のコメントの 1 件で、import ではないので完了条件の趣旨(import しない)は満たすと判断した。確定した関数: `R/codiel/phases.ts` は `GATED_PHASES`・`priorPhasesOf(phase)`・`findPhase` と型 `GatedPhase`・`PhaseKind`・`EvaluateTool`・`PhaseEntry`。`R/project/root.ts` は `resolveProjectRoot(cwd)`・`resolveProjectId(projectRoot, storageProjectId?)`(git の共通ディレクトリを `git -C` で取り、git が失敗したらプロジェクトルートの実体パスで作る)・`resolveCasesDir(configured?)`(`~` の展開だけ)・`DEFAULT_CASES_DIR`。`R/casefile/digest.ts` は `computeDigest(text) → { schemaVersion: 1, sha256, signature }`(128 個の 32 bit、種 `0x52414755` の mulberry32)・`digestSimilarity(a, b)`(版か長さが違えば null)・`normalizeText`。`R/subject/` は `types.ts`(`Subject`・`SubjectInputError`。`Subject.head` は `string \| null`)・`code.ts` の `collectCodeSubject({ projectRoot, repoPath?, baseRef, paths? }) → { subject, diff, empty }`・`files.ts` の `collectFilesSubject({ projectRoot, repoPath?, paths }) → { subject, body }`・`body.ts`(新設。`joinSections`・`collectDecisionSubject({ projectRoot, repoPath?, decision, optionsConsidered?, rollbackPlan? }) → { subject, body }`)。`SubjectBody.headingLines` は 0 始まりの行番号。想定外の git の失敗は通常の Error(内部エラー)。削除のファイルは sha256 が null。`R/context/` は `jev.ts`(`createJevCall`、`retry: { maxRetries: 0 }`)と `judge.ts`(入力に計画書 §2 の列に加えて `findings` を持つ。第 2 引数 `ContextJudgeOptions { settings, apiKey?, jevCall?, remainingMs?, signal? }`。候補は `{ ruleId, findingIndex, path, line }`、`priorFindings` は `{ attempt, ruleId, message }`、`resubmissionTargets` は `{ attempt, similarity }`。重さの下限は `adjustments` に `{ ruleId: "weight", from: "none", to }` で載る。効かなかった原因は `contextJudge/unavailable` の message と `record.unavailableReasons` にあり、応答の `reasons` への転記は W2-T08 が行う)。`R/panel/provider.ts` は `JudgeProvider { name: "claude" \| "codex" \| "none"; invoke(call, ctl?) }`・`CallControl { timeoutMs; signal }`(W1 では第 2 引数を省略できる)・`JudgeError` の理由に `unavailable`(spawn の ENOENT)。子プロセスの共通部品(`runChild`・`runChildWithRetry`・`withTempDir`・`invokeWithSchemaRetry`・`Semaphore` など)を `provider.ts` に置いた。abort では SIGKILL し、`signal.reason` で reject して再試行しない。`claudeCli.ts` は `buildArgs` を export。`codexCli.ts` は `CodexCliProvider`・`buildCodexArgs(dir, model)`・`toStrictSchema`・`stripOptionalNulls`、バイナリは `RAGUEL_CODEX_BIN` で差し替えられる。fake は `R/testing/fake-claude.mjs`(`$schema` で exit 2、`fail-once` のモード)と `R/testing/fake-codex.mjs`。オーケストレーターの判断: W1-T04 の食い違い(設計書 §6.8 の「締切までの残りが 30 秒未満なら再試行しない」は、`CallControl` が締切を持たないので未実装)は、W2-T07 が `CallControl` に締切を足して扱う(W2-T07 の触るファイルに `R/panel/provider.ts` を足す)。`name` に `none` を足したこと、W1-T03 の入力に `findings` を足したこと、`ruleId: "weight"` は、設計の範囲内の細目として採る。`.serena/memories/codiel/raguel_mcp.md:39` の旧 fake のパスは O5-2 で直す |
| 実機確認 2・3・5〜8 と設計書 §15 の 1(O1-2〜O1-4) | 2026-09-29、まとめて承認された範囲で実行した。scratchpad の一時のスクリプトから `ClaudeCliProvider`・`CodexCliProvider` を呼んだ。2: `$schema` を除いたスキーマで構造化出力が返った(haiku、14.4 秒)。3: モデルに見えるツールは `StructuredOutput` だけで、MCP のツールは無かった。`--strict-mcp-config` は、プラグイン同梱の MCP サーバーも claude.ai のコネクタも、モデルに渡さない(debug ログにはコネクタの一覧を取得する行が残る)。5: `--sandbox read-only` で、cwd へのファイルの作成は失敗した(効いている)。6: W1-T04 の引数(ツールの無効化なし)では、シェルが使え、cwd の外の canary ファイルを読めた。`codex features list` に `shell_tool` と `unified_exec` があり、`--disable shell_tool --disable unified_exec` を足すと canary を読めず、シェルも使えなかった(ツールを無効にできる)。7: `--ignore-user-config` の下でも `$CODEX_HOME/AGENTS.md` は読まれた(一時の `CODEX_HOME` に置いた canary の指示に従った)。`-c project_doc_max_bytes=0` と `--disable hooks` を足しても読まれた。止める手段は見つからなかった。この環境の `~/.codex` には `AGENTS.md` が無い。`~/.codex/hooks.json` は利用者の hooks を持つので、`--disable hooks` を足す。8: 認証は `CODEX_HOME` だけで通った。`--output-schema` は厳格な形が必須で、`additionalProperties: false` の無いスキーマは 400(`'additionalProperties' is required to be supplied and to be false`)で失敗した。`toStrictSchema` の変換は要る。O1-4: サンドボックスとツールの無効化はどちらも実現できたので、設計書 §15 の 1 を聞く条件に当たらない。W1-T04 の `codexCli.ts` に `--disable shell_tool --disable unified_exec --disable hooks` を足す作業は、W2-T07 に含める(W2-T07 の触るファイルに `R/panel/codexCli.ts`・`R/panel/__test__/codexCli.test.ts` を足す)。残る限界(`$CODEX_HOME/AGENTS.md` が読まれる)は README と DESIGN に書く(W3-T06) |
| W2 で確定した契約と `decisions`(O2-1) | Workflow `wf_61d76d1f-f92`。コミットは `a238f6ae`(C2-1)と `6e1fca75`(C2-2)。形の正本はコードで、W3 のタスクは次のファイルを読む。ツールの入力は `R/tools/shared.ts` の `commonInput`(`runId`・`phase`(`GATED_PHASES` の enum)・`objective`・`repoPath?`)に、`evaluateCode.ts`(`baseRef`・`paths?`・`testResults?`)、`evaluatePlan.ts` の `documentInput`(`paths` 1〜20 件。evaluate_design も同じ)、`evaluateDecision.ts`(`decision`・`optionsConsidered?`・`rollbackPlan?`)を足したもので、すべて `z.strictObject`(旧入力の `diff`・`files`・`plan`・`steps`・`constraints`・`design`・`requirements` は未知のキーとして isError)。phase とツールの kind が合わなければ isError。ツールは 8 本(evaluate_* の 4 本、`record_outcome`、`list_rules`、`list_precedents`、`retire_precedent`)。応答の `EvaluationResult`(`R/core/types.ts`)は `evaluationId`・`runId`・`phase`・`kind`・`attempt`・`verdict`・`judgeStatus`・`degradedReasons`(`{ source, reason }` の列。source はパネリスト名・meta・kernel・config)・`weightTier`・`findings`(severity の重い順で 50 件まで。切ったら `reasons` に件数)・`reasons`(接頭辞は `rule-stop`・`panel-findings`・`degraded`・`rule-ask`・`panel-ask`・`trivial-pass`・`standard-pass`・`variance`・`meta-missing`・`meta-below`・`meta-pass`・`no-change:`・`context-judge:`・`findings-cap:`・`degraded:`)・`decisionPoint?`(ASK・STOP だけ)・`subject`・`meta?`・`casePath`・`policy`(`{ configHash, configSource, version: 2, buildVersion, protectedPaths: { excludedDefaults, generated } }`)・`contextJudge`(`{ enabled, status, adjustments }`)。ケースファイルは `<casesDir>/cases/<projectId>/{evaluations.jsonl, outcomes.jsonl, <runId>/<phase>/attempt-NN/}` で、証拠ファイルは設計書 §6.9.1 の 12 件に固定(`R/casefile/store.ts` の `EVIDENCE_FILES`)。attempt の番号は run とフェーズの組ごとに振り、数値で並べる。`evaluations.jsonl` の行は `EvaluationIndexEntry { schemaVersion: 2, evaluationId, runId, phase, kind, attempt, casePath, verdict, judgeStatus, head: string\|null, at }`、`outcomes.jsonl` の行は `OutcomeRecord { schemaVersion: 2, evaluationId, runId, phase, outcome, ruling: Ruling\|null, notes?, precedentId: string\|null, at }`(同じ evaluationId は後の行が正)。verdict.json は `VerdictRecord { schemaVersion: 2, evaluationId, runId, phase, kind, attempt, verdict, judgeStatus, degradedReasons, weightTier, findings, reasons, meta, subject, policy(protectedPaths を含まない PolicyRecord), at, prevChainHead, evidence, chainHead }`。`subject.json` は `{ repoPath, head(string\|null), base?, paths?, files: [{ path, sha256(削除は null), isNew }] }`、decision は `files` が空で `contentSha256` を持つ。索引の読めない行は例外にし、上書きしない。索引に無い evaluationId の文言は `NO_EVALUATION_RECORD`(「評価の記録が無い(掃除済みか、存在しない)」)。`verifyAttempt` は証拠の sha256・chainHead・prevChainHead に加え、verdict.json の subject と subject.json の一致も照らす。`00-synthesis.json` は `{ objective, reasons, decisionPoint, variance }`。`record_outcome` は設計書 §6.2.7 の表のとおりで、応答は `{ recorded, precedentId, reason? }`。判例の id は `prec-<evaluationId の先頭 8 文字>-<ruling か run>-<outcome>`。firedRules は `filterFiredRules` で `panel/*-error`・`kernel/*`・`rule-error` を除く。configSource は `env:<パス>`・`cwd:<config.json の絶対パス>`・`defaults`(config.json はプロジェクトルートで探す)。所見の ID: ルール 16 本(`R/rules/params.ts` の `RULE_SPECS`。`common/secrets`・`common/injection-marker`・`common/resubmission-loop`・`common/max-size`・`code/protected-paths`・`code/destructive-ops`・`code/unsafe-exec`・`code/max-diff-lines`・`code/test-deletion`・`code/new-dependency`・`plan/irreversible-ops`・`plan/max-steps`・`plan/scope-keywords`・`decision/no-alternatives`・`decision/no-rollback`・`precedent/failure-match`)と、固定の `code/no-change`・`code/generated-only`・`rule-error`・`casefile/tampered`・`kernel/config-error`・`kernel/internal-error`・`contextJudge/unavailable`・`panel/<名前>-error`。`testsDir` の読み方は `R/config/paths.ts` の `resolveTestsDir(projectRoot)`(既定 `docs/codiel/tests`、不正は例外)、レポートの判定は同じファイルの `isE2eReport(repoRel, testsDir)` と `classifyPath(repoRel, config, testsDir)`(report を先に、次に generated)。オーケストレーターの判断: (1) W2-G のエージェントは「ファイルを直さない」指示に反して `R/core/weight.ts:82`(配列の `additions` を数として足していた W2-T06 の不具合)を `.length` に直し、使われない `pnpm-workspace.yaml` の `minimumReleaseAgeExclude`(SDK 1.31.0 の除外。W2-T08 が一度入れて版を戻した名残)を C2-1 に含めた。修正は正しいと確かめ、`pnpm-workspace.yaml` の 2 行はオーケストレーターが消した。(2) W2-T05 は `common/resubmission-loop` に生成物とレポートを含む元の本文を渡し、W2-T08 はダイジェストも元の本文で書いた。設計書 §6.4.2(生成物とレポートには common/secrets だけ)を正とし、`raguel-w2-fix` で直す。(3) `R/testing/fake-codex.mjs` が `--disable` の 3 組を検査しない(設計書 §7.1 の fake-codex の行)ので、同じく `raguel-w2-fix` で直す。(4) 設計書の中の読み違えやすい箇所 2 件は、実装が R24 の側で正しいので直さず、O5-10 で文言だけを直すかをユーザーに聞く。1 件目は §7.1 の「設定」の行の「testsDir・runsDir を検証しない」と §6.12.1・R24(不正な testsDir は読み込みの失敗)。2 件目は §6.2.2 の手順 7(レポートだけの差分はルール層を通さない)と §6.4.2(レポートにも common/secrets を当てる)。実装はレポートと生成物に common/secrets だけを当て、stop が無ければ `code/no-change` の PROCEED にし、レポートと生成物しかない差分も変更なしにする。(5) 採った細目: `CallControl { timeoutMs, deadline, signal }` を必須にし、`launchBudget` と `RETRY_MIN_REMAINING_MS`(30 秒)で再試行を制御する。`JudgeErrorReason` から `provider-none` を消して `deadline` を足し、`NoneProvider` は `unavailable`。`judge.provider: none` のときは perPanelist の指定があっても LLM を起動しない。meta の入力は runner が決定論で組む。`runPanel(input, deps)`・`synthesize({ weightTier, ruleFindings, panel?, degradedReasons?, config })`。パイプラインの入口は `evaluate(req, deps, ctl)`。設定が壊れていても、評価対象を先に取ってから `kernel/config-error` の ASK・degraded を `~/.raguel` に記録する。依存は `@modelcontextprotocol/sdk` `~1.30.1`・`picomatch` `^4.0.7`・`zod` `^4.6.5`(1.31.0 は公開から 1 日で minimumReleaseAge に掛かる)。`server.ts` は `__RAGUEL_VERSION__`(`build.ts` の define)を名乗る。`.serena/memories/codiel/raguel_mcp.md` の追随は O5-2 |
| 実機確認 4・9 と設計書 §15 の 2・4(O2-2〜O2-4) | O2-1 の続き: `raguel-w2-fix`(`wf_91c2ca15-add`)で、(2) と (3) を直した(コミット `f7aec493`)。再提出の比較・`findAddressedButSimilar`・`submission-digest.json` は、`R/rules/registry.ts` の `comparisonContent(artifact, ctx)`(code は生成物とレポートの区間を外した本文)で揃え、`WHOLE_CONTENT_RULE_IDS` は `common/secrets` だけにした。`submission.txt` は元の本文の伏せ字のまま。`fake-codex.mjs` は `--disable` の 3 組が揃わなければ exit 2。ゲートのエージェントは、lint を通すために `R/core/weight.ts` の改行と `plugins/metatron/src/__test__/section-reference-inventory.test.ts` の文字列の連結をテンプレートリテラルに直す整形をした(範囲外だが意味は同じ。受け入れた)。O2-2(2026-09-29、まとめて承認の範囲): scratchpad の一時のスクリプトから `evaluate` を、このリポジトリの差分(`f7aec493^..f7aec493` を `paths: [plugins/codiel/raguel-mcp]`、`generated` に `plugins/*/dist/**` などを宣言)と引継ぎ書で呼んだ。standard の code は 106 秒(adversarial 16 秒 → steelman 90 秒)、standard の文書は 119 秒(20 秒 → 99 秒)で、どちらも PROCEED・ok。critical は、最初の試行(`weight.tiers.critical` 31)が文字数の加点 0 で standard のままだったので、閾値を standard 20・critical 30 にして測り直した。242.6 秒(adversarial 18 秒 ∥ crosscheck 95 秒 → steelman 106 秒 → meta 42 秒)で、ASK(採用された所見 1 件)・ok。再試行と degraded は 0 件。1 回の呼び出しの最長は steelman(haiku)の約 106 秒で、sonnet の adversarial より長い。O2-3(同): 一時のリポジトリに標本を置き、`contextJudge.enabled: true`・`judge.provider: none` で 7 件を評価した(1 件 0.2〜0.4 秒)。A4(ヘルプ文の `rm -rf /`)は p=0.41 で stop のまま(lower 0.2 では下がらない)。A5 の対照(実行される `rm -rf` と `DROP TABLE`)は p=0.79 で stop のまま、`unsafe-exec` の p=0.75 は message に添えただけ。A12(system prompt の説明文)は正規表現も Jev も所見を出さない。A7(objective の外へ及ぶ計画)は scope が p=0.97 で ask、あわせて irreversible が p=0.71 で ask。A8(語彙に掛からない不可逆な操作)は irreversible が p=0.97 で ask、重さの水準 4 で critical。A8 の否定文は info のまま。F6(中身の無い rollbackPlan と選択肢)は no-rollback が p=0.96、no-alternatives が p=0.81 で ask、critical。O2-4(ユーザーの決定): 設計書 §15 の 2 は据え置き(`judge.timeoutMs` 180000・`judge.deadlineMs` 600000・confidence 70)。§15 の 4 は `contextJudge.thresholds.lower` を 0.2 から 0.5 に改め、`raise` 0.7 と重さの水準の境は据え置く。設計書を単独のコミットで直し、`raguel-w2-fix2` で `R/config/defaults.ts` と関係するテストを直す |
| W3 の CLI の文言と `decisions`(O3-1) | Workflow `wf_ad04618c-391`。コミットは `1ee55688`(C3-1。codiel の src・scripts・テスト、raguel-mcp の `config/loader.ts` と dist)と `38bac22b`(C3-2。スキルと文書)。W2 の修正 2 は `56947d0a`(`contextJudge.thresholds.lower` の既定を 0.5 に。W2-F02 が足した行の整形の違反でゲートが一度止まり、W2-F03 が整形してから通した)。CLI: `pass-gate <phase> --slug <slug> --evaluation-id <id> --verdict <V> [--human-approved]`(ASK・STOP を通すには、先に record_outcome で `as-is`・`false-positive` の記録が要る。code 系は評価の head が今の HEAD、base が `phases.<phase>.startHead` と等しいときだけ通る)。`mark-ask <phase> --slug <slug> [--kind raguel\|confirm] [--verdict ASK\|STOP\|PROCEED] [--evaluation-id <id>]`(`--kind raguel` が既定で、`--evaluation-id` が必須)。`C/src/raguel-records.ts` は `resolveRaguelStore(mainRoot)`・`readEvaluationIndex`・`readOutcomes`・`readVerdictRecord` に加え、`checkEvaluationRow`・`checkGate`(pass-gate の検査をまとめたもの)・`unresolvedStops`・`resolveProjectId` などを export する。W3-T01 の決定: 検査 10 は loadRun の直後、1・2・4 は mark-ask と共通、その後 3・5・7・8・9。検査 7 で `--human-approved` 付きの PROCEED は裁定の行があることだけを見る。検査 8・9 は `subject.repoPath` ではなく codiel-state の root を基準にする。`startHead` は未記録のときだけ書き、HEAD を読めなければ start-phase を失敗させる。Raguel の設定が読めないときは既定の置き場に落とさず、pass-gate・`mark-ask --kind raguel`・init(前の try があるとき)を失敗させる。W3-T02 の決定: guard-write はパスの末尾が `/.codiel/config.json` のものをすべて守り、Raguel の設定が読めないときは casesDir の判定だけを外す。guard-bash は設計書の 8 つの形に、守るパスを含むディレクトリの rm・mv、同じ名前のファイルを写す cp・mv・install、`~`・`$HOME` の展開を足した。W3-T02 の申し送り: `RAGUEL_CONFIG` は hook のプロセスの環境変数から読むので、MCP サーバーの設定にだけ書いたときはそのファイルを守れない。オーケストレーターの判断: (1) W3-T01 は、範囲外の `stop-guard.test.ts`・`guard-bash.test.ts` の足場が pass-gate の照合で壊れるとして blocked を返した(実装は完了)。計画書の触るファイルの割り当ての漏れと判断し、`guard-bash.test.ts` の足場を W3-T02 に、`stop-guard.test.ts` の足場を新しいタスク W3-T07 に割り当てて、Workflow を再開した。(2) 相対パスの `storage.casesDir` を、Raguel はサーバーの cwd、codiel は codiel-state の cwd で解決していた(設計書 §6.9.1 は決めていない)。設定を探すのと同じプロジェクトルートを基準にそろえると決め、W3-T07 で直した。(3) 設定が壊れているとき Raguel は `kernel/config-error` を既定の置き場に記録し、codiel は pass-gate で失敗する。フェイルクローズドとして受け入れる。(4) W3-T07 は `stop-guard.test.ts` の一括置換に Bash の python を使った(書き込みの手段の逸脱。内容はゲートのテストで確かめた)。O5-10 でユーザーに聞く食い違い: (a) 設計書 §6.13.1 は改竄の STOP で AskUserQuestion の選択肢を「止める」だけにするとするが、AskUserQuestion の options は 2 件以上が必須で実現できない。(b) 設計書 §6.9.4 の索引の `head` は 40 桁の例だが、実装は git の管理外で `null` を許す。(c)・(d) O2-1 の (4) の 2 件 |
| レビューの所見と扱い(W4) | Workflow `wf_f7ff05ba-61c`(W4-R1 は code-reviewer、W4-R2 は claude-complex-reviewer。critical・high は claude-adversarial-reviewer が 1 件ずつ反証を試み、すべて反証されなかった)。重複をまとめた所見と扱い: (1) critical W4R2-01・W4R1-03: code 系フェーズで evaluate_code に `paths` を渡すと、差分の一部だけで検査 8 を通せる(設計書の検査の穴)。(2) high W4R1-01: rename の移動元のパスが保護パス・生成物とレポートの分類・重さ・test-deletion の判定から漏れる。(3) high W4R1-02・W4R2-02: Jev の候補が集約後の所見 1 件につき先頭の 1 行だけで、同じファイルの別の破壊操作を問わずに stop → ask に下げうる(設計書 §6.4.4 の「候補ごと」からの逸脱)。(4) high W4R2-03・W4R1-04: 文書のフェーズで別のファイルを評価しても検査 9 を通せる(設計書の検査の穴)。(5) medium W4R2-04(検証で high から下げた): code 系フェーズの pass-gate と次の start-phase の間に足したコミットが評価されない(設計書の穴)。(6) medium W4R2-06: `://` を含む行のエントロピーの除外で、URL のクエリの鍵を見逃して codex・Jev へ平文で送る。(7) medium W4R2-05・low W4R1-06: 変更なしの経路が前フェーズの改竄の検証も飛ばす。(8) medium W4R1-05: testResults の検査とパネルへの追記のテストが無い。(9) medium W4R2-07: Raguel が書いた空の差分の記録で code 系の pass-gate(検査 8)が通る 2 者比較のテストが無い。(10) low W4R1-07: 退役した判例が同じ id の再記録で復活する。(11) low W4R2-08: Jev に送る rollbackPlan・optionsConsidered に伏せ字を当てない。範囲外の気づき(直さず記録): `weight.tiers.standard` を上げると code の多くが trivial になる設定の余地、guard-bash が `cd` を挟む書き込みを見逃すこと(シェル構文の既知の限界)、人の裁定の真正性(設計書 §13 の既知の限界)。ユーザーの決定(2026-09-29): (1)・(4) は設計書 §6.13.3 の検査 8・9 に足して直す。(5) はフェーズの間の連続性の検査(`passedHead`)を足す。medium・low の (6)〜(11) はすべて直す。§11.3 に溜めた設計書の文言の食い違い (a)〜(d) もまとめて直す(改竄の STOP は AskUserQuestion を使わずに止めて理由を報告する)。(2)・(3) は設計書の範囲内の実装の修正なので確認なしで直す(rename の扱いは設計書 §6.4.2 に明記した)。設計書は単独のコミットで直し、`raguel-w4-fix` で実装・テスト・スキル・契約の文書を直してから、W3-G と同じゲートを通す。修正の結果: 設計書のコミットは `1c6eb7fa`。修正の Workflow は `wf_78a60dea-47e`。W4-F1 が codiel の検査 8・9 と passedHead を実装し、W4-F2a がルール層の rename(`sidePaths`)・集約の `evidence.lines`・`://` の行の除外の撤去を、W4-F2b がパイプラインの全候補の問い合わせ・rename の分類・変更なしでの改竄の検証・testResults のテスト・decisionFields の伏せ字・判例の退役の保護を、W4-F3 がスキルと文書を直した。F1 と F3 が、連続性の検査(直前のフェーズの passedHead と今の HEAD の厳密な一致)と、orchestrating-runs の「文書フェーズの成果物はゲート通過の直後にコミットする」(設計書 §6.2.3 の前提)が両立しないと報告した。ユーザーの決定(2026-09-29)で、直前が文書のフェーズなら `passedHead..HEAD` の変更がそのフェーズの `subject.files` だけのとき通す形にし(設計書 `1b438100`)、W4-F4 が実装した。W4-F5 が lint の整形を直した。1 回目のゲートは lint の整形で、2 回目のゲートは `pnpm run test` の出力を取れずに止まった(テストの失敗ではない)。オーケストレーターが残ったプロセスを止めて検証し直した(lint・typecheck は終了コード 0、test は 187 files passed・1 skipped、3553 tests passed・2 skipped、build は終了コード 0、W1-G・W3-T01 の grep は 0 件)。コミットは `d4924d79`(raguel-mcp の src・dist)・`f4fdc76a`(codiel の src・scripts)・`da721651`(スキルと文書)。W4-F4 の【要確認】: intent-sync の通過から fix-loop の開始までの間(pr・review)に、評価した文書のほかのファイルをコミットする運用があれば、fix-loop の start-phase が失敗する。O5-8 の手動確認で見る |
| ADR とバージョンと Serena メモリ(O5-1〜O5-5) | O5-1: `metatron:updating-architecture` の手順で、`diff-architecture`(検出 11 件。技術スタックの表記、`--filter`、`.vscode`・`.claude`、`dist` と `tools` の glob。どれも本件と関係の無い前からの乖離で、ユーザーは 1 件も更新に選ばなかった)と `get rules`(3 ファイルとも存在)を実行し、ADR の草案をサブエージェントに同じ規律で簡潔にさせた。ユーザーは文面を承認し、番号を ADR-011 に、影響範囲のバージョンを codiel `1.0.0-dev`・raguel-mcp `0.0.2-dev` に改めるよう指示した(main で ADR-010 が採番済みのため)。CLI は番号を指定できないので、main の `1e1221fd`・`36e76698` の ARCHITECTURE の差分(native-japanese の ADR-010)を、このブランチの ADR-009 の後に当ててコミットし(`93bfab6e`)、stage し直して ADR-011 を得た。承認を取り直して書き込んだ(`7a3ca34c`)。バージョンの目標は、ユーザーの指示で codiel `1.0.0-dev`・raguel-mcp `0.0.2-dev` に改め、設計書 §8・§11・§14・検査 10 の「1.1.0 より前」の文言と、本書の冒頭・O5-4・§9・§10.3 を直した。O5-2: このセッションの Serena は main の worktree を向いていて、`edit_memory` でこのブランチのメモリを直せない。ユーザーの決定で、`.serena/memories/codiel/raguel_mcp.md` を Edit で直す(保護パスの規則からの逸脱) |
| 手動確認に使うプラグインの複製(O5-6) | O5-2〜O5-5 は Workflow `wf_2067c3f3-3ca` で行った。コミットは `ac69163f`(C5-1。codiel `1.0.0-dev`・raguel-mcp `0.0.2-dev`、dist、検査 10 の文言)と `f66e23f6`(C5-2。ルートの README の 1 文と Serena メモリ)。メモリに「DESIGN.md は作り直しの前の記述のまま」と誤って書かれたので、オーケストレーターが直した(`f7344f0f`)。ゲートは test を省いたので、オーケストレーターが実行した(187 files passed・1 skipped、3553 tests passed・2 skipped)。複製: 既存の `~/codiel-o4c-plugins` を消さずに、新しい置き場 `~/codiel-o4c-plugins-r/{codiel,metatron,gh-utility}` を `f7344f0f` の `git archive` で作った。バージョンは codiel `1.0.0-dev`、metatron `0.4.0-dev`、gh-utility `0.5.3-dev`。`codiel/raguel-mcp/dist/server.mjs` は `0.0.2-dev` を名乗る。前の複製 `~/codiel-o4c-plugins` は、ユーザーが消すと決め、2026-09-29 に自分の手で消した |
| Raguel の手動確認と実機確認 10(O5-7) | (ユーザーの回答待ち。2026-09-29 にユーザーが開始を承認し、オーケストレーターが起動のしかた(`claude --plugin-dir ~/codiel-o4c-plugins-r`)と確認項目を渡した。§8.1 の 9 項目に、W4 の修正で入った連続性の検査の項目(文書のゲート通過の直後のコミットで、次の code 系フェーズの start-phase が失敗しないこと。intent-sync から fix-loop までの間に、ほかのファイルのコミットが入らないこと)を足した。O4C-6 の「変更の無いフェーズで `git diff <base>...HEAD` を受けたか」は、R22 で意味が変わったので「PROCEED と `code/no-change` で通ったか」に読み替えた) |
| codiel の O4C-6〜O4C-8(O5-8) | O4C-6 の github の run(2026-09-29〜30。`~/codiel-o41-gh`、slug `add-truncate-functions` の try-1、PR #7、Issue #8、finalize 済みで awaiting_outcome)を、トランスクリプト `~/.claude/projects/-home-hiro0209-codiel-o41-gh/b85a8d01-8274-414f-ae78-0b62af1526b0.jsonl`・state・git・`~/.raguel/cases/codiel-o41-gh-19e6610d8f90/` で確かめた(Workflow `wf_fe4fa0ee-0c8`)。1(init の前の `/codiel:run` が止まり `/codiel:init` を案内): YES(B・C・D の 3 点で止まった)。2(YAML の移行): 機会なし(`raguel.config.yaml` と旧 `config.json` は前回の run ブランチにだけあり、main へ切り替えると無くなったので、新規の init になった)。3(`.gitignore` の差分を示してから書いた): NO(承認の後に書いたが、AskUserQuestion の前に差分を応答の本文に出さず、「示した内容のとおりに」と聞いた)。4(run の文書が `<runsDir>/<slug>/` にコミット): YES。5(`main..run ブランチ` に `.codiel/runs/`・init の成果物・無関係なファイルが無い): YES(14 コミット、17 ファイル)。6(報告ファイルの拒否): YES(0 件)。7(報告が `.codiel/runs/<slug>/try-1/` にある): YES。8(pr の前の確認): YES。9(行コメントが head のコミットに付いた): YES(`f3859c7`)。10(review で push を試みない): YES。11(空の worktree のディレクトリが残らない): YES(worktree は test-code で 2、implement で 2 作られ、後始末された。前回の run の空の `add-url-slug-function/` は残っている)。12(state.json の判定の誤った deny): YES(guard-bash の deny は 0 件)。13(変更の無いフェーズが PROCEED と `code/no-change`): YES(test-loop、1.1 秒)。O4C-6 の local の run(2026-09-30。`~/codiel-o41-local`、基点 `o41`、slug `add-state-list-command` の try-1、finalize 済みで awaiting_outcome。トランスクリプトは `7baa0e81…`(init と聞き取り)と `10daea4d…`(run の本体)、Raguel の記録は `~/.raguel/cases/codiel-o41-base-9b1ed3ccc63a/`。projectId は git の共通ディレクトリから作るので、linked worktree の元の `codiel-o41-base` の名前になる)。最初のセッションは、聞き取りの途中で終わった後に別の worktree(`intent-driven-development`)から `--plugin-dir` なしで再開され、マーケットプレイス版の codiel 0.9.0-dev が読み込まれたので、AI が run を作る前に止めた(運用の誤りで、codiel と Raguel の不具合ではない)。新しいセッションでやり直した。1: YES(B・C・D の欠けを示して止まった)。2: 機会なし(`o41` に `raguel.config.yaml` が無い)。3: YES(`9101142c` の規律が効き、`.gitignore`・rules・CLAUDE.md の中身を応答の本文に出してから承認を聞いた)。4: YES。5: NO(run ブランチに `5ee17cc5`「chore(chat): 会話記録を追記する」がある。`docs/chat/` の 2 ファイル)。6: YES。7: YES。8: 機会なし(init の成果物は、run を作る前の確認でユーザーがコミットを選び、`o41` に `19d6e1e8` でコミットされた。pr の前に未コミットのファイルは無かった)。9・10: 機会なし(local)。11: YES(worktree は test-code で 1、implement で 4 作られ、後始末された。前回の run の空の `codiel-state-version/` は残っている)。12: YES(guard-bash・guard-write の deny は 0 件。stop-guard は discuss で 1 回、非同期の委譲を正しく止めた)。13: YES(test-loop、1.5 秒)。O4C-7・O4C-8 は未実施 |
| Raguel の手動確認と実機確認 10 の結果(O5-7。github の run の分。上の行の続き) | 1: YES(intent・design・test-spec・dev-plan・test-code・implement・test-loop・intent-sync の 8 ゲートが新しい入力で評価され、pass-gate を通った。code 系に `paths` は渡していない。fix-loop は critical・high が 0 件で skip)。2: YES。3: 機会なし(github の run では `generated` を宣言していない)。4: YES(4 回の ASK すべてで、質問文に懸念の要約と「判断点:」がある。implement の質問文に AI の誤字「碴壊的」が 1 か所)。5: 機会なし(run の間に config.json を書く試みが無かった)。6: YES(design・dev-plan・implement・intent-sync の 4 回が 131〜134 秒でバックグラウンドへ移り、呼び直さずに完了の通知を待った。最長は dev-plan の約 310 秒)。7: 未実施。8: O4C-7 で見る。9: 機会なし(STOP が無かった)。10: YES(文書のゲートの直後のコミットの後、start-phase test-spec・dev-plan・test-code・implement が成功した)。record_outcome は 4 回とも `approved`・`as-is` で、`outcomes.jsonl` と一致した。judgeStatus はすべて ok。見つかった問題: (a) design・test-spec・dev-plan の ASK は、すべて crosscheck の同じ型の誤りだった。objective(intent の要求と受け入れ基準の写し。raguel-gating の「run を通じて同じ文言」の規則どおり)が実装の完了まで述べるのに、crosscheck・steelman・adversarial のプロンプトは phase も kind も受け取らず、objective を「この成果物が何のためのものか」として読ませる。そのため、後続フェーズで作る実装ファイルの不在を「未達」として採用した(`R/panel/panelists/crosscheck.ts:101-128`、steelman は同じ内容を認めて反駁しなかった)。設計書 §6.2.1・§6.6 は、文書のフェーズでの objective の扱いを決めていない。O5-9 の切り分けでは、原因は今回の作り直し(パネルのプロンプト)と設計書の穴にある。(b) implement の ASK は `code/new-dependency`(typescript・@types/node の追加)で、設計書 §6.4.2 どおりの正しい挙動。local の run の分(2026-09-30): 1: YES(8 ゲートが新しい入力で評価され、pass-gate を通った。code 系に `paths` は渡していない。STOP・degraded・再評価は 0 件。fix-loop は skip)。2: YES。3: STOP にならず(YES)、応答の `policy.protectedPaths.generated` に 2 つの glob が出て、重さは生成物を除いた 4 ファイルで数えた(28 点で trivial)。ただし `plugins/*/scripts` は保護パスに入っていないので、`generated` が無くても STOP にはならない。trivial でパネルを通らなかったので、パネルへの 1 行の渡し方は確かめられていない。4: YES(design と dev-plan の 2 回。懸念の要約があり、decisionPoint は「判断するのは、この指摘に対処が要るかです」と言い換えて入っている。「判断点:」の字面は無い)。ASK の原因は 2 回とも crosscheck で、design は「変更対象のパスと、影響を受ける機能単位の ID(`units/…`)が食い違う」(確信度 95)、dev-plan は「仕様のディレクトリを作るステップが無い」(確信度 72)。github の run で出た「実装ファイルが無い」の型は出なかった。5: 機会なし。6: YES(design・test-spec・dev-plan・intent-sync の 4 回が 120〜134 秒でバックグラウンドへ移り、呼び直さなかった。最長は test-spec の 378 秒。待ちは verdict.json の出現のポーリング)。7: 未実施。9: 機会なし。10: YES(start-phase の失敗は 0 件)。見つかった問題: (c) test-code の evaluate_code が、`docs/chat/INDEX.md` の未コミットの変更で入力の誤りになった(設計書 §6.2.2 の手順 3。`paths` が無いので作業ツリー全体を見る)。chat-history プラグインの記録係が、run の間も `docs/chat/` を非同期に書き続けるためである。オーケストレーターは AskUserQuestion で扱いを聞き、推奨の「run ブランチへ別コミットで入れる」が選ばれて、run と関係の無いファイルが run ブランチに入った(O4C-6 の 5 の NO)。run の終わりにも `docs/chat/` の未コミットの変更が残った |
| NO の切り分けと扱い(O5-9) | O4C-6 の 3(init が差分を示さずに承認を取った): 今回の作り直しで initializing-harness に入れた変更は、旧キーを外す 1 文だけで(`38bac22b`)、「差分を示し、承認を得る」の指示は M4-C の本文のままである。原因は M4-C 側(指示の本文と、それを守らなかったオーケストレーター)にあり、本計画では直さずにユーザーに示す。Raguel の (a) は、今回の作り直しに原因があるので、修正の Workflow の対象である(ユーザーの判断を待つ)。ユーザーの決定(2026-09-30): (a) は直さず、既知の限界として記録する(文書のフェーズで、objective が実装の完了まで述べると、crosscheck が後続フェーズで作るファイルの不在を採用して ASK にしうる。人は「このまま承認」で進める)。残りの run は今の方針で進める。O4C-6 の 3 は、このブランチで initializing-harness に「承認を聞く前に、書くものの差分(新規は全文)を応答の本文に出す」規律を足して直す(`9101142c`。複製の該当ファイルも上書きした。local の run の init で効いたことを確かめた)。O4C-6 の local の 5(会話記録が run ブランチに入った): 直接の原因は、evaluate_code が作業ツリー全体の未コミットの変更を入力の誤りにすること(今回の作り直しで入れた §6.2.2 の手順 3)と、run と関係の無いファイルを非同期に書くプラグイン(chat-history)が同じ作業ツリーで動いていたことの組み合わせである。M4-C の codiel には、この拒否への対処の手順が無い(拒否そのものが作り直しで生まれた)。原因は今回の作り直しの範囲にあり、扱いはユーザーの判断を待つ |

### 11.4 計画の作成時に見つけた設計書と実コードの食い違い

1. (解決済み。設計書第 7 版)設計書 §6.9.1 は第 6 版まで、プロジェクトルートの手順 1 を「`git worktree list --porcelain` の先頭のエントリを返す」と書いていた。M4 は `findMainRoot` を git を呼ばない形に改めた(`C/src/hooks/lib.ts:575-580`(`7130f69c`))。設計書第 7 版の §6.9.1 はこれに追随した。
2. 設計書 §14 は「【要確認】の項目は、結果に合わせて本設計と README を直している」を Done 条件にする。設計書は承認を経て変える決まりである。本計画は、直すときはユーザーの承認の後にオーケストレーターが単独のコミットで直す、として両立させた(O0-6・O1-5・O2-4・O5-10)。
3. 設計書 §3.4 は、この worktree の `orchestrating-runs/SKILL.md` が M3 時点の記述であることを挙げる。M4 の取り込み(O0-1)で解消するので、W3-T05 は取り込み後の本文を直す。

---

## 12. ユーザーに聞く時点

| 時点 | 聞くこと |
| --- | --- |
| O0-1 | M4 と M4-C の取り込みで衝突したときの扱い |
| O0-3 | 取り込んだ HEAD が `7130f69c` より新しく、§3.2 の 1〜6 の答えが変わっていたときの扱い(O0-6 でまとめて聞く) |
| O0-2 | baseline が失敗を含むときの扱い |
| O0-5 の前 | 実機確認 1 の実行(費用) |
| O0-5 の 4 | 代替の候補もすべて効かないときの扱い(設計書 §15 の 3) |
| O0-6 | O0-3・O0-5 と §11.4 の食い違いの扱い、設計書を直すか |
| O1-2・O1-3 の前 | 実機確認 2・3・5〜8 の実行(費用) |
| O1-4 | codex をプロバイダーに残すか(設計書 §15 の 1) |
| O1-5 | 実機確認の結果による設計書の直し |
| O2-2・O2-3 の前 | 実機確認 4・9 の実行(費用) |
| O2-4 | 既定の `judge.timeoutMs`・`judge.deadlineMs`・confidence の閾値(設計書 §15 の 2)と、Jev の閾値と重さの水準の境(設計書 §15 の 4) |
| W4 の後 | レビューの medium / low の扱い |
| O5-1 | ADR の草案の承認(metatron の手順) |
| O5-6 | 前の複製 `~/codiel-o4c-plugins` を消すか(消すのはユーザーの手で) |
| O5-7・O5-8 の前 | Raguel の手動確認と、codiel の O4C-6〜O4C-8 の run の実行(費用)。O4C-6〜O4C-8 の各確認項目の答え |
| O5-8 | O4C-6〜O4C-8 の結果を codiel 側の記録へ写すか |
| O5-9 | M4-C が原因の NO を直す場所(codiel の intent 駆動化のブランチか本ブランチか)。原因を決められない NO の扱い |
| O5-10 | 手動確認と実機確認 10 の結果による設計書と README の直し |

---

## 13. 未決事項

1. `agent()` の `agentType` に渡す定義の名前は、codiel の計画書で確かめた対応を使う。O0-4 で違っていたら、ユーザーに扱いを確かめる。
2. §2 の置き場と名前(`R/project/root.ts`・`R/subject/`・`R/context/`・`R/rules/params.ts`・`R/config/paths.ts`・`C/src/raguel-records.ts`、Workflow の名前、O5-6 の複製の置き場 `~/codiel-o4c-plugins-r`)と、§0.2 の Workflow の分け方は、本書が決めたものである。ユーザーレビューで変えてよい。
3. W1 に既存のモジュールを壊さない基盤を集め、既存のモジュールの書き換えを W2 の 1 本にまとめた。W2 のエージェント数は 9 で、目安の中に収まるが、タスクごとの作業量が大きい。W2 の途中で止まったら、`resumeFromRunId` で残りだけをやり直す(§11.2)。

---

## 14. 不採用案

| 案 | 採らない理由 |
| --- | --- |
| 型・設定、ルール層、パネル、パイプラインを別々の Workflow にする | ほぼすべてのモジュールが `core/types.ts` と設定の型に依存するので、層ごとに書き換えると Workflow の境界で型検査が通らない。互換の層を挟むと、作っては消すコードが増える |
| raguel-mcp の書き換えを 1 本の Workflow にまとめる | エージェント数が 13 になり、目安の 10 未満を超える。既存のモジュールを壊さない基盤を W1 に分けると、W2 を 9 に収められる |
| 新しい実装を `R/v2/` のような別のディレクトリに作り、最後に入れ替える | 最終の配置(設計書 §10)と違う場所にコードを書き、入れ替えのときに import をすべて書き直す手間が増える |
| 実機確認を Workflow のエージェントに任せる | 費用がかかり、実行の前にユーザーの確認が要る。エージェントはユーザーと対話できない |
| codiel 側を raguel-mcp と同じ Workflow で直す | codiel-state と guard は、W2 で確定したケースファイルと索引の形を読む。形が固まる前に書くと、W2 の変更に追随させる手戻りが出る |
| M4 の取り込みを rebase で行う | 承認済みの設計書のコミット(`c5fa33c3`)の ID が変わる |
| タスクごとに git worktree を切って並列に実装する | 並列は最大 5 で、触るファイルを分ければ衝突しない。worktree のマージと後始末の手間が増える |
| 各タスクのエージェントが自分の変更をコミットする | 同じ作業ツリーで並列にコミットすると `index.lock` で衝突する |
