# codiel:run のコスト効率を改善する 実装計画書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** codiel:run が辿る指示書を、指摘 181 件と施策 P1・P3〜P7 に沿って改め、run 1 回あたりのトークン消費を 10% 以上減らす。

**Architecture:** `orchestrating-runs` の本文を run の開始から要る 7 つのセクションに絞り、フェーズ別・共有の手順を `skills/orchestrating-runs/references/` へ切り出す。ほかのスキルは、HARD-GATE と Red Flags を本文へ統合し、重複を削り、場面限定の手順を各スキルの `references/` へ切り出す。`src/` は変えない。効果は、改修の前後に同じ題材で run を 2 回ずつ回し、transcript の usage を集計して確かめる。

**Tech Stack:** Markdown の指示書、Python 3(計測の道具)、vitest(既存のテスト)

**Spec:** `harness-docs/design/2026-10-02-codiel-run-cost-design.md`(承認済み。以下「設計書」)と付録 `harness-docs/design/2026-10-02-codiel-run-cost-findings.md`(以下「付録」)。以下 `C/` は `plugins/codiel/`、`ORS` は `C/skills/orchestrating-runs/SKILL.md` を指す。

## Global Constraints

- codiel のバージョンは `1.0.0-dev` のまま上げない。raguel-mcp も上げない(設計書 K5)。
- 改修前の基準は、コミット `d53db58` の codiel とする。改修前の計測(Task 1)が終わるまで、`C/skills/`・`C/references/`・`C/commands/` を変えない。
- `ORS` の本文と `C/skills/orchestrating-runs/references/` を変えてよいのは Task 2 と Task 7 だけである。Task 3〜6 は、そこのファイルを変えない。担当のファイルに、そこのファイルを指す参照を書くことはしてよい。`ORS` 側に要る変更を見つけたら、完了報告に書いて Task 7 に回す。
- `C/docs/DESIGN.md` に書き込むのは Task 8 だけである。Task 3〜6 は、W3 で退避する理由・経緯・出典を完了報告に書いて Task 8 に回す。
- 改修の対象は、付録に行があるファイルと `C/commands/run.md` である。評価の対象外の `C/skills/initializing-harness/SKILL.md` は変えない(設計書 W4)。
- `skills/**/*.md`・`references/**/*.md`・`.serena/memories/` を編集する前に `prompt-smith:prompt-smith` を起動し、その規律に従う。`.serena/memories/` は Serena の `edit_memory` / `write_memory` で変える。
- Markdown と Python の編集は Serena の編集ツールで行う。新しいファイルの作成だけは Write で行ってよい。
- 規律の文言に「節」「段」「版」を使わない。「セクション」「ステップ」と書く。
- 手順ファイルの名前は設計書 §5.3.1 の規則に従う(`phase-<フェーズ名>.md`・`delegation-env.md`・`review-common.md`・`e2e.md`・`resume.md`・`failures.md`)。
- 付録の行は、設計書 §4 の読み替え規則 W1〜W5 を当ててから適用する。付録の「採否」列に書いた規則がその行に当てる規則である。「不採用」「対象外」の行は適用しない。
- 各 Task の完了報告には、変更した各箇所を判定した検査とその結果、`ORS` 側に要る変更(Task 3〜6)、DESIGN.md へ退避する内容(Task 3〜6)を書く。
- `src/` を変えないので、`pnpm run build` は要らない。Done の条件は `pnpm run lint`・`pnpm run typecheck`・`pnpm run test` が通ることと、設計書 §7.3 の受け入れ基準を満たすことである。

## 細目の決定(設計書が計画書に委ねたもの)

| 項目 | 決定 |
| --- | --- |
| 計測の run の連携モード | local に固定する。PR の作成とコメントの投稿という外部への副作用を避け、前後の条件をそろえる |
| 計測の開始状態 | 毎回、題材のリポジトリを同じ開始コミットに戻してから始める。finalize が intent を更新してコミットするので、前の回の状態から続けない。開始コミットには承認済みの intent 文書を含める(`/codiel:run <intentパス>` で始めるため)。`.codiel/` のうち run の state と報告(try のディレクトリ)だけを消し、`config.json`・`raguel.config.yaml`・`specs/` は開始コミットのまま残す。Raguel の記録(`~/.raguel` の題材の projectId の配下)も、毎回の開始前に同じ手順で消す |
| 委譲先の transcript の対応づけ | 委譲先の transcript は `<session>/subagents/agent-<agentId>.jsonl` に置かれる(2026-10-02 にこのリポジトリのセッションで確かめた)。`agentId` は Agent ツールが返す ID で、`wait-add --task-id` に渡す値と同じである |
| 計測の記録項目 | 各回について、前後の別・回次・開始コミット・intent 文書のパスと内容のハッシュ・モデル・運用方針(`AMATSUKA_AGENT_AUTO_INJECTION` の値)・連携モード・`TYPESAFE_API_KEY` の有無・セッション ID を記録する |
| 計測の道具の名前と置き場 | `tools/codiel_run_usage.py`。`tools/` はまだ無いので Task 1 で作る |
| 計測の run の特定 | 道具の入力は、サンドボックスの project ディレクトリと、計測の回ごとに記録したセッション ID の並びである。区間は、各セッションのうち `/codiel:run` を含むユーザー行から、`codiel-state.mjs finalize --slug <slug>` を含む Bash の行までとする |
| 待ちの履歴の復元 | `wait-done` は state から待ちの記録を消すので(`C/src/codiel-state.ts:1221-1223`)、finalize の後の state からは割り振れない。道具は、transcript にある `codiel-state.mjs wait-add` の Bash の呼び出しと、その結果の出力(待ちの `id`・`phase`・`taskId` を含む state)から待ちの履歴を復元する |
| 手順ファイルの Read の確認 | 道具は、区間の中でオーケストレーターが Read したファイルの一覧を、フェーズの区間ごとに出力する |
| 計測の道具の自己検証 | テスト方針の vitest は Python に当てはまらないので、`--self-check` で `assert` による検証を 1 つ持つ。固定の入力を道具の中に持ち、次の場面を最低限含める。同じ `message.id` を持つ 2 行、`taskId` のある委譲と無い委譲 1 件ずつ、`wait-done` で state から消えた後の待ち、test-spec と dev-plan の並列の区間 |
| `/codiel:test` の基準 | Task 1 で改修前の codiel の `/codiel:test` を、引数なしと引数ありの 2 通りで 1 回ずつ実行し、レポートの置き場と項目を記録する。Task 10 で改修後に同じ実行をして比べる |
| 横断参照の付け替え | 下の表のとおり |

`ORS` の外から、切り出すセクションを指している箇所は次のとおりである(2026-10-02 に `grep` と docs-reviewer の検証で確かめた)。

| 参照元 | 現在の参照 | 付け替え先 | 担当 |
| --- | --- | --- | --- |
| `C/skills/fixing-review-findings/SKILL.md:18` | `orchestrating-runs` §5「fix-loop のスキップ経路」 | `orchestrating-runs` §2 の fix-loop をスキップする規則(本文に残る) | Task 4 |
| `C/skills/fixing-review-findings/SKILL.md:96-98` | `reviewing-diffs` の「所見の統合と投稿」 | `orchestrating-runs` の `references/review-common.md` | Task 4 |
| `C/skills/raguel-gating/SKILL.md:190・199・246` | `orchestrating-runs` の「7. 失敗の記録」(L190 は番号を付けずに退避の形を指す) | `orchestrating-runs` の `references/failures.md` | Task 4 |
| `C/skills/capturing-intent/SKILL.md:49` | `orchestrating-runs` の再開手順(§6) | `orchestrating-runs` の `references/resume.md` | Task 3 |
| `C/docs/DESIGN.md:673` | `orchestrating-runs` の「7. 失敗の記録」 | `orchestrating-runs` の `references/failures.md` | Task 8 |
| `plugins/metatron/docs/format-change-checklist.md:37` | codiel の `orchestrating-runs/SKILL.md` の「7. 失敗の記録」 | codiel の `skills/orchestrating-runs/references/failures.md` | Task 8(metatron のバージョンは上げない。2026-10-02 ユーザー決定) |

§0・§3・2.1・2.4 への参照は、本文に残るセクションを指すので変えない。`ORS` の内部の参照(「2.6 に従う」など)は Task 2 で付け替える。

`C/src/hooks/__test__/guard-bash.test.ts:1426` は `grep -c "gh pr create" plugins/codiel/skills/orchestrating-runs/SKILL.md` をコマンドの文字列として使い、hook がそれを通すことだけを確かめる。grep の結果は見ないので、§2.2 を切り出しても影響しない。

## Review Focus

- 設計書 §5.3.1 の表の全行に、対応する手順ファイルがあること。本文の「`references/<file>.md` を Read」の参照先がすべて実在すること。
- 手順ファイルを読む 4 つの契機(設計書 §5.3.1)が `ORS` の本文に書かれ、再開・finalize・fix-loop の再レビュー・compaction の後のどの経路でも、必要な手順ファイルが読まれること。
- フェーズに入るかどうかを決める規則(軽量 run の discuss・design の skip、fix-loop の skip)が本文に残っていること。
- HARD-GATE と Red Flags から本文へ移した条項が、元の条項の意味を保っていること。直前の設計書 §5.4 の HARD-GATE の中身(オーケストレーターはコード・spec.md / cases.md・レビューの所見を自分で書かない)が本文に残っていること。
- `intent-format.md` の変更が、マーカー・見出し名・frontmatter のキー・持続層のセクション書式・候補 ID の採番規則の行に触れていないこと。

### Task 1: 計測の題材と道具を用意し、改修前を計測する

役割: 通常の実装(ステップ 4)。ステップ 1〜3・5〜8 はオーケストレーターがユーザーと行う。

**Files:**
- Create: `tools/codiel_run_usage.py`
- Modify: この計画書(「Task 1 の結果」)

- [x] ステップ 1: 題材を決める。既存のサンドボックス(`~/codiel-speedup`〜`~/codiel-speedup3`)の題材が、E2E を含む全フェーズに到達するかを確かめる。到達しなければ、小さなリポジトリと確定済みの intent 文書を新しく用意する。どちらにするかをユーザーに確かめる(設計書 §11)。題材の開始コミットを決めて記録する。
- [x] ステップ 2: サンドボックスが読む codiel のパスを確かめる。`~/codiel-speedup3` の transcript では、codiel のスキルをこの worktree(`/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development/plugins/codiel/`)から読んでいた(2026-10-02 に確かめた)。改修前の計測は Task 2 より前に行うので、この worktree の codiel がそのまま改修前の codiel になる。計測の前に、この worktree の `C/skills/`・`C/references/`・`C/commands/` が `d53db58` と同じであることを `git diff d53db58 -- plugins/codiel/skills plugins/codiel/references plugins/codiel/commands` で確かめる。
- [x] ステップ 3: 計測の記録項目(細目の決定)を記録する表を「Task 1 の結果」に用意する。
- [x] ステップ 4: `tools/codiel_run_usage.py` を作る。仕様は設計書 §7.1 と細目の決定(計測の run の特定・待ちの履歴の復元・手順ファイルの Read の確認・自己検証)のとおりで、要点は次のとおりである。
  - 入力: project ディレクトリとセッション ID の並び。各セッションの transcript と `<session>/subagents/` の transcript を読む。
  - 重複除去: `message.id` ごとに最後の行の usage を採る。
  - 割り振り: 委譲先は、transcript から復元した待ちの履歴(`phase`・`taskId`)で割り振り、`taskId` の無いものは「未分類」。オーケストレーターは `start-phase`・`complete-phase`・`pass-gate`・`skip-phase` を呼んだ Bash の行の時刻で区間を切る。test-spec と dev-plan の並列の区間は「test-spec+dev-plan」。
  - 出力: フェーズ別・委譲別・合計の 4 種類の usage、review フェーズの委譲の数、フェーズの区間ごとに Read したファイルの一覧を、JSON と表で出す。
  - 完了報告に、`--self-check` の結果と、このリポジトリの transcript に当てた出力の抜粋を添える。
- [x] ステップ 5: 細目の決定「計測の開始状態」の手順で題材を戻してから、改修前の codiel で run を回す。1 つのセッションで finalize まで回し、セッションを切り替えない。これを 2 回行い、各回の記録項目を書く。
- [x] ステップ 6: 改修前の codiel で `/codiel:test` を、引数なしと引数ありの 2 通りで実行し、レポートの置き場と項目を記録する。
- [x] ステップ 7: 道具で 2 回分を集計し、review に出た観点の数と名前も記録する(設計書 §9 の「改修前の run が何観点を出すか」)。
- [x] ステップ 8: 結果を「Task 1 の結果」に書いてコミットする。道具(ステップ 4)と結果は別のコミットにする。

### Task 2: orchestrating-runs を分割し、手順ファイルを作る

役割: 複雑または重要な実装。分割の境界と読む契機の判断を含み、機械的に検証できない。`prompt-smith:prompt-smith` を起動してから書く。Task 1 の後に行う。

**Files:**
- Modify: `ORS`、`C/commands/run.md`、`C/skills/writing-test-specs/SKILL.md`(D24 を移す元)、`C/skills/reviewing-diffs/SKILL.md`(E1 を移す元)
- Create: `C/skills/orchestrating-runs/references/` の `phase-test-spec.md`・`phase-test-code.md`・`phase-implement.md`・`phase-test-loop.md`・`phase-pr.md`・`phase-review.md`・`phase-fix-loop.md`・`phase-intent-sync.md`・`phase-finalize.md`・`delegation-env.md`・`review-common.md`・`e2e.md`・`resume.md`・`failures.md` の 14 本
- 入力: 設計書 §1・§4・§5.1〜§5.4・§6、付録の A 群(全行)と D24・E1・E29・E30

- [ ] ステップ 1: `C/commands/run.md` に A1・A2 を適用する。
- [ ] ステップ 2: 付録の A 群のうち、本文に残るセクション(概要・チェックリスト・§0・§1・§2・§2.1・§2.4・§3・§4)に当たる行を適用する。A23・A24 は適用しない。
- [ ] ステップ 3: 設計書 §5.3.1 の表に従い、切り出すセクションを手順ファイルへ移す。付録の A 群の各行の「該当箇所」の行番号を、設計書 §5.3.1 の表の各行の範囲と照らし、移す範囲に当たる行は移すときに適用する。A9 の `waits/<id>.md` と `wait-done` の手順は §3 に 1 か所だけ残し、手順ファイルには書かない。D24 は `writing-test-specs` から `phase-test-spec.md` へ、E1 は `reviewing-diffs` から `review-common.md` へ移し、移した元の削除も同じコミットに含める。`reviewing-diffs` には「統合と投稿はオーケストレーターが行う。担当は所見を返すだけで `gh pr review` を実行しない」の 1 文を残す。
- [ ] ステップ 4: `review-common.md` に P1 の観点の規則(設計書 §6.1)を書く。
- [ ] ステップ 5: 本文の §2 に、フェーズと手順ファイルの対応表と、読む 4 つの契機(設計書 §5.3.1)を書く。軽量 run の skip と fix-loop の skip の規則は本文に残す。
- [ ] ステップ 6: 本文に P4(設計書 §6.2)と P7(設計書 §6.3)を書く。
- [ ] ステップ 7: §3 のテンプレートを設計書 §5.2 の 6 項目に絞る(W2)。`wait-add` の id 規則は §3 を正本にする(W5)。
- [ ] ステップ 8: HARD-GATE と Red Flags を削り、本文に無い条項を手順へ移す(K2)。直前の設計書 §5.4 の HARD-GATE の中身は、本文の手順に残す。
- [ ] ステップ 9: `ORS` 内部の番号の参照(「2.6 に従う」など)を、手順ファイルの名前に付け替える。
- [ ] ステップ 10: 次を確かめ、結果を完了報告に添える。
  - `grep -nE 'HARD-GATE|Red Flags'` が `ORS`・手順ファイル・`C/commands/run.md` で 0 件である。
  - 本文と手順ファイルにある `references/<file>.md` の参照先が、すべて実在する。
  - 設計書 §5.3.1 の表の全行に、対応する手順ファイルがある。
  - `wc -c` で、本文と各手順ファイルのバイト数。
  - 移した条項の一覧(設計書 §5.1 の表の形。対象は `ORS` の HARD-GATE と Red Flags)。
- [ ] ステップ 11: コミットする。本文の削減(ステップ 1〜2)、切り出し(ステップ 3〜6)、テンプレートと HARD-GATE と参照(ステップ 7〜9)の 3 つに分けてよい。

### Task 3: intent 系のスキルと references を改める

役割: 通常の実装。`prompt-smith:prompt-smith` を起動してから書く。Task 2 の後に行う。Task 4〜6 と並列に行える。

**Files:**
- Modify: `C/skills/capturing-intent/SKILL.md`、`C/skills/syncing-intents/SKILL.md`、`C/references/intent-format.md`、`C/references/intent-common.md`、`C/references/intent-writing.md`
- Create: `C/skills/capturing-intent/references/`・`C/skills/syncing-intents/references/` の手順ファイル(設計書 §5.3.2)
- 入力: 設計書 §4・§5.1・§5.3.2・§5.6、付録の B 群(全行と末尾の切り出しの所見)

- [ ] ステップ 1: 付録の B 群を、W1〜W4 を当てて適用する。W3 で `C/docs/DESIGN.md` へ退避する内容(B5・B22 の理由、B27・B28)は、DESIGN.md に書かず完了報告に書く。
- [ ] ステップ 2: 設計書 §5.3.2 の capturing-intent と syncing-intents の行を切り出す。
- [ ] ステップ 3: `capturing-intent/SKILL.md:49` の「`orchestrating-runs` の再開手順(§6)」を `orchestrating-runs` の `references/resume.md` に付け替える。
- [ ] ステップ 4: `intent-format.md` の diff が、マーカー・見出し名・frontmatter のキー・持続層のセクション書式・候補 ID の採番規則の行に触れていないことを確かめ、完了報告に書く(設計書 §5.6)。
- [ ] ステップ 5: 担当のファイルで HARD-GATE と Red Flags の残りが 0 件であることを確かめる。移した条項の一覧、`ORS` 側に要る変更、DESIGN.md へ退避する内容を完了報告に添える。
- [ ] ステップ 6: コミットする。

### Task 4: gate とレビュー対応の系統を改める

役割: 通常の実装。`prompt-smith:prompt-smith` を起動してから書く。Task 2 の後に行う。Task 3・5・6 と並列に行える。

**Files:**
- Modify: `C/skills/raguel-gating/SKILL.md`、`C/skills/fixing-review-findings/SKILL.md`、`C/skills/filing-followup-issues/SKILL.md`、`C/skills/facilitating-design-discussions/SKILL.md`、`C/references/github-writing.md`、`C/references/handoff-contract.md`
- Create: 各スキルの `references/` と、`C/references/` 配下の切り出し先(設計書 §5.3.2・§5.7・§5.8)
- 入力: 設計書 §4・§5.1・§5.3.2・§5.7・§5.8、付録の C 群

- [ ] ステップ 1: 付録の C 群を、W1〜W5 を当てて適用する。C32・C33 は適用しない。
- [ ] ステップ 2: 設計書 §5.3.2 の raguel-gating・filing-followup-issues・facilitating-design-discussions・github-writing の行を切り出す。github-writing の切り出しでは文言を変えない(設計書 §5.8)。
- [ ] ステップ 3: 細目の決定の横断参照の表のうち、担当が Task 4 の行を付け替える。fix-loop の再レビューの委譲を出す前に `review-common.md` を読むことを、`fixing-review-findings` に書く。
- [ ] ステップ 4: C8 の `wait-add` の id 規則は、`orchestrating-runs` §3 への参照にする(W5)。
- [ ] ステップ 5: 担当のファイルで HARD-GATE と Red Flags の残りが 0 件であることを確かめる。移した条項の一覧と `ORS` 側に要る変更を完了報告に添える。
- [ ] ステップ 6: コミットする。

### Task 5: 設計・実装系のスキルを改める

役割: 通常の実装。`prompt-smith:prompt-smith` を起動してから書く。Task 2 の後に行う。Task 3・4・6 と並列に行える。

**Files:**
- Modify: `C/skills/preparing-design-agendas/SKILL.md`、`C/skills/writing-design-docs/SKILL.md`、`C/skills/writing-dev-plans/SKILL.md`、`C/skills/writing-test-specs/SKILL.md`、`C/skills/implementing/SKILL.md`、`C/skills/implementing/references/frontend.md`、`C/skills/fixing-failures/SKILL.md`
- Create: `C/skills/implementing/references/` の手順ファイル(設計書 §5.3.2 の implementing の行)
- 入力: 設計書 §4・§5.1・§5.3.2・§5.4・§5.9、付録の D 群

- [ ] ステップ 1: 付録の D 群を、W1〜W3 を当てて適用する。D1・D7・D31 は W2 により委譲先スキルの記述を残す。D47 は適用しない。D24 は Task 2 で移し済みなので、`writing-test-specs` に残りが無いことだけを確かめる。W3 で退避する内容(D3・D14 の経緯・D27 の hooks の挙動・D35 の出典)は、DESIGN.md に書かず完了報告に書く。
- [ ] ステップ 2: 設計書 §5.3.2 の implementing の行を切り出す。
- [ ] ステップ 3: `implementing`・`fixing-failures`・`writing-test-specs` に `## 完了報告` を置き、P5・P6 の項目を書く(設計書 §5.4)。
- [ ] ステップ 4: 担当のファイルで HARD-GATE と Red Flags の残りが 0 件であることを確かめる。移した条項の一覧、`ORS` 側に要る変更、DESIGN.md へ退避する内容を完了報告に添える。
- [ ] ステップ 5: コミットする。

### Task 6: レビュー・テスト系を改める

役割: 通常の実装。`prompt-smith:prompt-smith` を起動してから書く。Task 2 の後に行う。Task 3〜5 と並列に行える。

**Files:**
- Modify: `C/skills/reviewing-diffs/SKILL.md`、`C/skills/reviewing-diffs/references/*.md`、`C/skills/running-regression-tests/SKILL.md`、`C/skills/scripting-tests/SKILL.md`、`C/references/e2e-report-format.md`
- 入力: 設計書 §4・§5.1・§5.4、付録の E 群

- [ ] ステップ 1: 付録の E 群を、W1〜W4 を当てて適用する。E1 は Task 2 で移し済みなので、`reviewing-diffs` に 1 文だけが残っていることを確かめる。W3 で退避する内容(E20・E27)は、DESIGN.md に書かず完了報告に書く。
- [ ] ステップ 2: `reviewing-diffs`・`running-regression-tests`・`scripting-tests` に `## 完了報告` を置き、P5・P6 の項目を書く。`reviewing-diffs` の所見には、該当行と前後 3 行の差分の抜粋と根拠を含める(設計書 §5.4)。
- [ ] ステップ 3: `running-regression-tests` の単独実行モード(E13)を縮めた後も、`C/commands/test.md` の手順と食い違わないことを確かめ、完了報告に書く。
- [ ] ステップ 4: 担当のファイルで HARD-GATE と Red Flags の残りが 0 件であることを確かめる。移した条項の一覧、`ORS` 側に要る変更、DESIGN.md へ退避する内容を完了報告に添える。
- [ ] ステップ 5: コミットする。

### Task 7: 参照の付け替えと横断の検証

役割: 軽量な実装。grep による機械的な検証が中心である。Task 3〜6 の後に行う。

- [ ] ステップ 1: Task 3〜6 の完了報告にある「`ORS` 側に要る変更」を、`ORS` と `C/skills/orchestrating-runs/references/` に適用する。
- [ ] ステップ 2: `C/skills`・`C/references`・`C/commands` で次を確かめ、結果を完了報告に書く。検索から `C/skills/initializing-harness/` を除く(評価の対象外で、変えない)。
  - `grep -rnE 'HARD-GATE|Red Flags'` が 0 件である。
  - `grep -rnoE 'references/[A-Za-z0-9_./-]+\.md'` の参照先が、すべて実在する。
  - W4: 各スキルの本文と `references/` に `<plugin-root>` が残るかと、プラグインルート参照規約の有無が一致する。
  - 切り出したセクションの番号(§5・§6・§7・2.2・2.3・2.5〜2.11)や名前(「失敗の記録」「再開手順」「所見の統合と投稿」など)で、切り出す前の場所を指す参照が残っていない。
- [ ] ステップ 3: `pnpm run lint`・`pnpm run typecheck`・`pnpm run test` を実行する。
- [ ] ステップ 4: コミットする。

### Task 8: 文書とメモリを追随させる

役割: その他のタスク。`prompt-smith:prompt-smith` を起動してから書く(メモリは AI 向けの指示書に当たる)。Task 7 の後に行う。

**Files:**
- Modify: `C/docs/DESIGN.md`、`C/README.md`、`.serena/memories/` の該当メモリ。ルートの `README.md` に codiel の run の説明があれば、それも。`plugins/metatron/docs/format-change-checklist.md`(バージョンは上げない)。

- [ ] ステップ 1: `C/docs/DESIGN.md:130-132` の review の説明を、`review-common.md` の規則と食い違わないように書き換える(infra と generic を加え、doc と security を毎回選ぶことを残す)。K2 で HARD-GATE と Red Flags を廃止した理由を足す。
- [ ] ステップ 2: Task 3・5・6 の完了報告にある、DESIGN.md へ退避する内容を DESIGN.md に足す。同じ内容が既にあれば足さない。
- [ ] ステップ 3: 細目の決定の横断参照の表のうち、担当が Task 8 の行を付け替える。
- [ ] ステップ 4: `C/README.md` の review の説明を同じく書き換え、P7 のセッションの切り替えの使い方を 1 段落で足す。
- [ ] ステップ 5: `.serena/memories/` で codiel のスキルの構成に触れるメモリを探し、切り出し後の構成に合わせる。
- [ ] ステップ 6: コミットする。

### Task 9: レビュー

- [ ] ステップ 1: Task 2〜8 の差分を、コードレビューの役割に委譲する。Review Focus の 5 点を依頼文に書く。
- [ ] ステップ 2: 改修後の `ORS`・`raguel-gating`・`reviewing-diffs`・`capturing-intent` に、prompt-smith の評価をもう一度当てる。冗長度の評点が改修前(設計書 §3.2)以上であることを確かめる。
- [ ] ステップ 3: 所見の採否を決め、採った所見を直してコミットする。

### Task 10: 改修後を計測し、受け入れを判定する

役割: オーケストレーターがユーザーと行う。Task 9 の後に行う。

- [ ] ステップ 1: Task 1 と同じ題材・開始コミット・intent 文書・モデル・運用方針・連携モード(local)・`TYPESAFE_API_KEY` の有無で、改修後の codiel(この worktree の HEAD)を読ませる。毎回、細目の決定「計測の開始状態」の手順で題材を戻し、1 つのセッションで finalize まで回す。これを 2 回行い、各回の記録項目を書く。
- [ ] ステップ 2: 改修後の codiel で `/codiel:test` を Task 1 のステップ 6 と同じ 2 通りで実行し、レポートの置き場と項目を Task 1 の記録と比べる。
- [ ] ステップ 3: 道具で集計し、設計書 §7.3 の受け入れ基準を判定する。各回の記録項目が Task 1 とそろっていることも確かめる。
- [ ] ステップ 4: 道具が出力する Read したファイルの一覧で、各フェーズで対応する手順ファイルが Read されたことを確かめる。compaction が起きていれば、その後に `ORS` と手順ファイルが読み直されたことも確かめる。
- [ ] ステップ 5: 結果を「Task 10 の結果」に書き、基準を満たさない項目があればユーザーと次の手を決める。

## コミットの分け方

- Task ごとに 1 コミット以上に分ける。
- 計測の道具と計測の結果は別のコミットにする。
- コミットメッセージは既存の形(`fix(codiel): …`・`docs: …`)に合わせる。

## 既知のリスク

- 手順ファイルを読む契機が実際に守られるかは、run を回すまで分からない。Task 10 のステップ 4 で確かめる。
- K2 で HARD-GATE と Red Flags を削ると、規律を守る強さが落ちる可能性がある。Task 10 の run で、オーケストレーターがコードや spec を自分で書いていないかを transcript で確かめる。
- 改修前の run が何観点を出しているかは記録が無い(設計書 §9)。Task 1 で記録し、P1 の効果の見積もりと比べる。
- モデルの出力の揺らぎで、2 回の平均でも 10% の差が判定しきれないことがある。そのときは Task 10 のステップ 5 でユーザーと回数を足すかを決める。

## 未決事項

- 計測の題材(Task 1 のステップ 1)。
2026-10-02 にユーザーが計画書を承認した。あわせて、`plugins/metatron/docs/format-change-checklist.md:37` は Task 8 で付け替え、metatron のバージョンは上げないと決めた(開発時に読む docs/ の参照だけで、利用者に影響しない)。

## Task 1 の結果

### 題材(ステップ 1・2、2026-10-02)

- 題材: `~/codiel-cost-bench`。既存のサンドボックスは `e2e/` を持たないので、新しく作った(ユーザー決定)。todo の一覧を表示する Node のサーバー(`node:http`)と、`node --test` の単体テスト 1 件、Playwright の E2E 1 件を持つ。
- 開始コミット: `0f23d8d`(`bcc7601` 初期構成 → `d2e8b4e` codiel の初期化 → `0f23d8d` intent)。
- intent: `docs/intents/2026-10-02-todo-title-search.md`(sha256 の先頭 12 桁 `95c2b8d34bfb`)。`status: approved`、`domains: [todo]`。
- 聞き取りで run の規模が `scale: light` になった。計測の run では discuss と design が skip され、design の手順ファイルは読まれない。改修の前後で同じ規模にそろうので、比較には影響しない。
- 起動: `cd ~/codiel-cost-bench && claude --plugin-dir /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development/plugins/codiel`。この worktree の codiel を読む。
- 開始状態への戻し方: `scripts/reset-cost-bench.sh`(ユーザーが実行する)。`0f23d8d` に戻し、main 以外のブランチ・追跡外のファイル(`node_modules/` を除く。`.codiel/runs/` を含む)・Raguel の記録(`~/.raguel/cases/codiel-cost-bench-*` と `~/.raguel/precedents/codiel-cost-bench-*`)を消す。

### 計測の記録(ステップ 5・6)

| 前後 | 回 | 開始コミット | モデル | 運用方針 | 連携 | Jev の鍵 | セッション ID |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 前 | 1 | `0f23d8d` | Sonnet 5.5 | custom | local | あり | `a3d6adc5-f78a-4504-af58-fcc4517049b2`(try-1。intent-sync で ASK、人の裁定で通過。合計 33,916,969) |
| 前 | 2 | `0f23d8d` | Sonnet 5.5 | custom | local | あり | `c147ab30-27df-4cfc-9049-c3db3be34649`(try-1。intent-sync で ASK、人の裁定で通過。合計 37,160,513) |

改修前の平均(ステップ 7): 合計 35,538,741、オーケストレーターの分 31,977,742、オーケストレーターの `cache_read_input_tokens` 31,110,005。2 回とも review の観点は backend・frontend・security・generic の 4 つで、doc は選ばれなかった。2 回とも intent-sync で ASK が出た。

### `/codiel:test` の基準(ステップ 6、セッション `39247d27-1fd2-483b-8e62-7041f5606438`)

2 回目の run が終わった状態で、改修前の codiel で実行した。

- 引数なし: レポート `.codiel/reports/test-run-<日時>.md` と、E2E の出力 `.codiel/reports/test-run-<日時>/e2e/<仕様のディレクトリ>/`(`results.json`・`summary.md`・スクリーンショット)。委譲は E2E の仕様のディレクトリごとに 1 件(2 件)で、units と test コマンドはオーケストレーターが実行した。結果は OK 22 / NG 0 / broken 0 / 環境の失敗 0、test コマンド 10 pass。
- 引数 `e2e/backend`: 同じ置き場に、`e2e/backend/api/todos` だけの結果が出た。委譲は 1 件で、test コマンドは実行していない。
- レポートの見出し: `# テスト実行レポート(単独実行 /codiel:test)`、`## サマリ`、`## ケース別結果`、`## E2E のレポート`、`## test コマンドの結果`、`## 実行し直し`、`## 判定`。

無効にした計測: セッション `44ce4f52-af03-4b9a-9d6c-5bb9a24766af`(Sonnet 5.5、合計 38,652,932)。`reset-cost-bench.sh` が `set -o pipefail` の下で、main 以外のブランチが無いときに `grep -vx main` の終了コード 1 で止まり、`git clean` と Raguel の記録の削除が実行されなかった。intent だけを作った run の `try-1` が残ったまま始まり、run は `try-2` になった。開始状態がそろわないので比較に使わない(2026-10-02 ユーザー決定)。スクリプトは `4d83336` で直した。

## Task 7・8 への引き継ぎ(Task 2〜6 の完了報告から)

### Task 7(ORS 側と横断)

- Task 2: `review-common.md` は `github-writing.md` の「画像の載せ方」を、`phase-pr.md` は「PR 本文」と画像の縮退の順序を指す。Task 4 で C30・C31 を切り出したら付け替える。
- Task 2: ARCHITECTURE への言及を `references/` へ移すと、`plugins/metatron/src/__test__/section-reference-inventory.test.ts` の V2 が落ちる。登録簿 `plugins/metatron/src/fixtures/section-reference-inventory.json` に行を足して直す(Task 2 で `phase-finalize.md` の 1 行を足した)。
- Task 6: ORS 側に要る変更は無い。`running-regression-tests` が ORS §3 の `adhoc-` の記述を参照している。
- Task 3: B27 で `intent-format.md` から ARCHITECTURE への言及(検知の理由の行)が無くなり、登録簿の `plugins/codiel/references/intent-format.md → (ARCHITECTURE への言及)` の行が「参照が無い」で V2 を落とす。言及は根拠として DESIGN.md へ退避したので、登録簿のその行を削る。
- Task 3: B24・B40 は適用しなかった(B24 は独自の挙動、B40 は `readable-writing.md` と循環する)。

### Task 8(Task 3 の退避の内容)

- B5(言語確認の理由): 両者が食い違うと、issue への転記に翻訳という加工が入り、原文をそのまま転記するという前提が崩れる。
- B22(syncing-intents の Red Flags の理由): 追記された要望の反映先が誤っていても、書いた時点で派生文のセクションに残るので、確認前に書くと確認の意味が失われる。`## 変更履歴` は承認の経路を残す記録で、省くと後から変更の正当性を追えない。要約は派生文のセクションの役割で、`## ASIS` / `## TOBE` には手を入れない。矛盾の確認は `mark-ask --kind confirm` で取り、待たずに書き換えると確認の意味が失われる。参照形は ADR へ移した後の確定済みの形で、全文を書き戻すと ADR と持続層で正が二重になる。
- B27(マーカー検知): 位置制約を課さないのは、Issue テンプレートのヘッダが前置されてマーカーが本文の中ほどに来ることがあり、「先頭 N 行以内」の条件では intent issue を取りこぼすからである。フェンス内の例示マーカーも検知するのは、取りこぼしの損失(写像が効かず精度が落ちる)が誤検知の損失より大きいからで、ARCHITECTURE 側のフェンス除外と規律が異なるのは意図した非対称である。
- B28: 原文の区切りの前後に空行を置くのは、空行が無いと直前の行が見出しとして描画されうるため。区切りは、どこから下を AI が書いたか、食い違えばどちらに従うかを人が分かるようにするため。`[ADR 候補]` の小見出しを metatron の ADR エントリと同じ名前と順序にするのは、metatron が ADR へ移すときに小見出しの下をそのまま写せるようにするため。参照形に候補 ID を残すのは、採番で ID を再利用しないため。`[ADR 候補]` の書式と参照形は codiel と metatron の共有ファイル契約で、正本は `intent-format.md`、metatron は最小限の写しを参照文書に置く。3 条件は metatron の執筆規律の写しである。
- B30: マーカーはスキルの規律で付け、hook で強制する(付け忘れた投稿は deny され、付けて投稿し直す)。run が active なセッションの本文は、人のアカウントから投稿されても AI が生成した文として扱い、読む側は原文から除ける。intent の承認時の任意の起票は run の作成前なので hook は掛からないが、規律でマーカーを付ける。

### Task 8(DESIGN.md へ退避する内容)

- E20(`scripting-tests`): 三層構造(`spec.md` → `cases.md` → テストコード)のうち、このスキルが担当するのはテストコードの作成と実行である(DESIGN.md §4)。期待結果を書く委譲(test-spec)、テストを書く委譲(test-code)、コードを直す委譲(implement・test-loop・fix-loop)を分けるのは、役割分担による捏造防止のためである(同 §4)。
- E27(`scripting-tests`): guard-write hook は、`<testsDir>/**/spec.md` と `<testsDir>/**/cases.md` への書き込みを implement・test-loop・fix-loop で ask にし、test-code は通す。hook は呼び出し元の委譲先を識別できないため、これ以外の境界は委譲先の規律で守る。
- Task 2: `docs/DESIGN.md:498・673`、`docs/skill-flowcharts.md:448・542・645` が、HARD-GATE・失敗の記録・fix-loop のスキップの切り出し前の置き場を指している。

## Task 10 の結果

(Task 10 のステップ 5 で書く)
