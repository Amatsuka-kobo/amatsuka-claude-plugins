# codiel:run のコスト効率を改善する 実装計画書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** codiel:run が辿る指示書を、指摘 181 件と施策 P1・P3〜P7 に沿って改め、run 1 回あたりのトークン消費を 10% 以上減らす。

**Architecture:** `orchestrating-runs` の本文を run の開始から要る 7 つのセクションに絞り、フェーズ別・共有の手順を `skills/orchestrating-runs/references/` へ切り出す。ほかのスキルは、HARD-GATE と Red Flags を本文へ統合し、重複を削り、場面限定の手順を各スキルの `references/` へ切り出す。`src/` は変えない。効果は、改修の前後に同じ題材で run を 2 回ずつ回し、transcript の usage を集計して確かめる。

**Tech Stack:** Markdown の指示書、Python 3(計測の道具)、vitest(既存のテスト)

**Spec:** `harness-docs/design/2026-10-02-codiel-run-cost-design.md`(承認済み。以下「設計書」)と付録 `harness-docs/design/2026-10-02-codiel-run-cost-findings.md`(以下「付録」)。以下 `C/` は `plugins/codiel/`、`ORS` は `C/skills/orchestrating-runs/SKILL.md` を指す。

## Global Constraints

- codiel のバージョンは `1.0.0-dev` のまま上げない。raguel-mcp も上げない(設計書 K5)。
- 改修前の基準は、コミット `d53db58` の codiel とする。改修前の計測(Task 1)が終わるまで、`C/skills/`・`C/references/`・`C/commands/` を変えない。
- `ORS` を変えてよいのは Task 2 と Task 7 だけである。Task 3〜6 は `ORS` を変えない。`ORS` 側に要る変更を見つけたら、完了報告に書いて Task 7 に回す。
- `skills/**/*.md`・`references/**/*.md`・`.serena/memories/` を編集する前に `prompt-smith:prompt-smith` を起動し、その規律に従う。`.serena/memories/` は Serena の `edit_memory` / `write_memory` で変える。
- Markdown と Python の編集は Serena の編集ツールで行う。新しいファイルの作成だけは Write で行ってよい。
- 規律の文言に「節」「段」「版」を使わない。「セクション」「ステップ」と書く。
- 手順ファイルの名前は設計書 §5.3.1 の規則に従う(`phase-<フェーズ名>.md`・`delegation-env.md`・`review-common.md`・`e2e.md`・`resume.md`・`failures.md`)。
- 付録の行は、設計書 §4 の読み替え規則 W1〜W5 を当ててから適用する。付録の「採否」列が「不採用」「対象外」の行は適用しない。
- `src/` を変えないので、`pnpm run build` は要らない。Done の条件は `pnpm run lint`・`pnpm run typecheck`・`pnpm run test` が通ることと、§7.3 の受け入れ基準を満たすことである。

## 細目の決定(設計書が計画書に委ねたもの)

| 項目 | 決定 |
| --- | --- |
| 計測の run の連携モード | local に固定する。PR の作成とコメントの投稿という外部への副作用を避け、前後の条件をそろえる |
| Jev | 改修の前後で `TYPESAFE_API_KEY` の有無をそろえる。Task 1 で有無を記録する |
| 計測の道具の名前と置き場 | `tools/codiel_run_usage.py`。`tools/` はまだ無いので Task 1 で作る |
| 計測の道具の自己検証 | テスト方針の vitest は Python に当てはまらないので、`__main__` の `--self-check` で `assert` による検証を 1 つ持つ。重複除去は、このリポジトリの transcript `91128792-1d44-467b-9c36-af6910365c75.jsonl` の時点で usage 行 122・`message.id` 60(docs-reviewer が 2026-10-02 に数えた値)を使わず、小さな固定の入力を道具の中に持って確かめる。transcript は追記されて数が変わるためである |
| 計測の run の特定 | サンドボックスの project ディレクトリ(`~/.claude/projects/<サンドボックスのパスを変換した名前>/`)と slug を入力にする。区間は、`/codiel:run` を含むユーザー行から、`codiel-state.mjs finalize --slug <slug>` を含む Bash の行までとする |
| 横断参照の付け替え | 下の表のとおり |

`ORS` の外から、切り出すセクションを番号で指している箇所は次の 2 つである(2026-10-02 に `grep -rnE` で確かめた)。

| 参照元 | 現在の参照 | 付け替え先 |
| --- | --- | --- |
| `C/skills/fixing-review-findings/SKILL.md:18` | `orchestrating-runs` §5「fix-loop のスキップ経路」 | `orchestrating-runs` §2 の fix-loop をスキップする規則(本文に残る) |
| `C/skills/capturing-intent/SKILL.md:49` | `orchestrating-runs` の再開手順(§6) | `orchestrating-runs` の `references/resume.md` |

§0・§3・2.1・2.4 への参照は、本文に残るセクションを指すので変えない。`ORS` の内部の参照(「2.6 に従う」など)は Task 2 で付け替える。

`C/src/hooks/__test__/guard-bash.test.ts:1426` は `grep -c "gh pr create" plugins/codiel/skills/orchestrating-runs/SKILL.md` をコマンドの文字列として使い、hook がそれを通すことだけを確かめる。grep の結果は見ないので、§2.2 を切り出しても影響しない。

## Review Focus

- 設計書 §5.3.1 の表の全行に、対応する手順ファイルがあること。本文の「`references/<file>.md` を Read」の参照先がすべて実在すること。
- 手順ファイルを読む 4 つの契機(設計書 §5.3.1)が `ORS` の本文に書かれ、再開・finalize・fix-loop の再レビュー・compaction の後のどの経路でも、必要な手順ファイルが読まれること。
- フェーズに入るかどうかを決める規則(軽量 run の discuss・design の skip、fix-loop の skip)が本文に残っていること。
- HARD-GATE と Red Flags から本文へ移した条項が、元の条項の意味を保っていること。直前の設計書 §5.4 の HARD-GATE の中身(オーケストレーターはコード・spec.md / cases.md・レビューの所見を自分で書かない)が本文に残っていること。
- `intent-format.md` の変更が、マーカー・見出し名・frontmatter のキー・持続層のセクション書式・候補 ID の採番規則の行に触れていないこと。

### Task 1: 計測の題材と道具を用意し、改修前の run を 2 回計測する

役割: 通常の実装(ステップ 3)。ステップ 1・2・4〜6 はオーケストレーターがユーザーと行う。

**Files:**
- Create: `tools/codiel_run_usage.py`
- Modify: この計画書(「Task 1 の結果」)

- [ ] ステップ 1: 題材を決める。既存のサンドボックス(`~/codiel-speedup`〜`~/codiel-speedup3`)の題材が、E2E を含む全フェーズに到達するかを確かめる。到達しなければ、小さなリポジトリと確定済みの intent 文書を新しく用意する。どちらにするかをユーザーに確かめる(設計書 §11)。
- [ ] ステップ 2: サンドボックスが読む codiel のパスを確かめる。【要確認】既存のサンドボックスの `.claude/` には settings が無く、codiel をどの経路(`--plugin-dir` かマーケットプレイスか)で読んでいるかを計画の時点で確かめられなかった。改修前の run が `d53db58` の codiel を読むように固定する。改修前と改修後を並行して回す場合は、`d53db58` を別の worktree に checkout して改修前の codiel にする。
- [ ] ステップ 3: `tools/codiel_run_usage.py` を作る。仕様は設計書 §7.1 と細目の決定のとおりで、要点は次のとおりである。
  - 入力: project ディレクトリと slug。その project 配下で、区間を含むすべてのセッションの transcript と `<session>/subagents/` の transcript を読む。
  - 重複除去: `message.id` ごとに最後の行の usage を採る。
  - 割り振り: 委譲先は state の `waits`(`phase`・`taskId`)で、`taskId` の無いものは「未分類」。オーケストレーターは `start-phase`・`complete-phase`・`pass-gate`・`skip-phase` を呼んだ Bash の行の時刻で区間を切る。test-spec と dev-plan の並列の区間は「test-spec+dev-plan」。
  - 出力: フェーズ別・委譲別・合計の 4 種類の usage と、review フェーズの委譲の数を、JSON と表で出す。
  - `--self-check`: 固定の入力で、重複除去と割り振りを `assert` で確かめる。
  - 完了報告に、`--self-check` の結果と、このリポジトリの transcript に当てた出力の抜粋を添える。
- [ ] ステップ 4: 連携モード(local)と `TYPESAFE_API_KEY` の有無を記録し、改修前の codiel で run を 2 回回す。1 回ごとに 1 つのセッションで finalize まで回し、セッションを切り替えない。
- [ ] ステップ 5: 道具で 2 回分を集計し、review に出た観点の数と名前も記録する(設計書 §9 の「改修前の run が何観点を出すか」)。
- [ ] ステップ 6: 結果を、この計画書の「Task 1 の結果」に書いてコミットする。

### Task 2: orchestrating-runs を分割し、手順ファイルを作る

役割: 複雑または重要な実装。分割の境界と読む契機の判断を含み、機械的に検証できない。`prompt-smith:prompt-smith` を起動してから書く。Task 1 の後に行う。

**Files:**
- Modify: `ORS`
- Create: `C/skills/orchestrating-runs/references/` の `phase-test-spec.md`・`phase-test-code.md`・`phase-implement.md`・`phase-test-loop.md`・`phase-pr.md`・`phase-review.md`・`phase-fix-loop.md`・`phase-intent-sync.md`・`phase-finalize.md`・`delegation-env.md`・`review-common.md`・`e2e.md`・`resume.md`・`failures.md`
- 入力: 設計書 §1・§4・§5.1〜§5.4・§6、付録の A 群(全行)と D24・E1・E29・E30

- [ ] ステップ 1: 付録の A 群のうち、本文に残るセクション(概要・チェックリスト・§0・§1・§2・§2.1・§2.4・§3・§4)への削除と書き換えを適用する。A23・A24 は適用しない。
- [ ] ステップ 2: 設計書 §5.3.1 の表に従い、切り出すセクションを手順ファイルへ移す。移すときに、付録の該当行(A7〜A22 のうち移す範囲のもの)も適用する。D24 は `writing-test-specs` から `phase-test-spec.md` へ、E1 は `reviewing-diffs` から `review-common.md` へ移す。この 2 件は、移した元のスキルの側の削除も同じコミットに含める。
- [ ] ステップ 3: `review-common.md` に P1 の観点の規則(設計書 §6.1)を書く。
- [ ] ステップ 4: 本文の §2 に、フェーズと手順ファイルの対応表と、読む 4 つの契機(設計書 §5.3.1)を書く。軽量 run の skip と fix-loop の skip の規則は本文に残す。
- [ ] ステップ 5: 本文に P4(設計書 §6.2)と P7(設計書 §6.3)を書く。
- [ ] ステップ 6: §3 のテンプレートを設計書 §5.2 の 6 項目に絞る(W2)。A9 の `waits/<id>.md` と `wait-done` の手順は §3 に 1 か所だけ残す。`wait-add` の id 規則は §3 を正本にする(W5)。
- [ ] ステップ 7: HARD-GATE と Red Flags を削り、本文に無い条項を手順へ移す(K2)。直前の設計書 §5.4 の HARD-GATE の中身は、本文の手順に残す。移した条項の一覧を、設計書 §5.1 の表の形で完了報告に添える。
- [ ] ステップ 8: `ORS` 内部の番号の参照(「2.6 に従う」など)を、手順ファイルの名前に付け替える。
- [ ] ステップ 9: 次を確かめ、結果を完了報告に添える。
  - `grep -nE 'HARD-GATE|Red Flags'` が `ORS` と手順ファイルで 0 件である。
  - 本文と手順ファイルにある `references/<file>.md` の参照先が、すべて実在する。
  - 設計書 §5.3.1 の表の全行に、対応する手順ファイルがある。
  - `wc -c` で、本文と各手順ファイルのバイト数。
- [ ] ステップ 10: コミットする。

### Task 3: intent 系のスキルと references を改める

役割: 通常の実装。`prompt-smith:prompt-smith` を起動してから書く。Task 2 の後に行う。Task 4〜6 と並列に行える。

**Files:**
- Modify: `C/skills/capturing-intent/SKILL.md`、`C/skills/syncing-intents/SKILL.md`、`C/references/intent-format.md`、`C/references/intent-common.md`、`C/references/intent-writing.md`
- Create: `C/skills/capturing-intent/references/`・`C/skills/syncing-intents/references/` の手順ファイル(設計書 §5.3.2)
- 入力: 設計書 §4・§5.1・§5.3.2・§5.6、付録の B 群(全行と末尾の切り出しの所見)

- [ ] ステップ 1: 付録の B 群を、W1〜W4 を当てて適用する。
- [ ] ステップ 2: 設計書 §5.3.2 の capturing-intent と syncing-intents の行を切り出す。
- [ ] ステップ 3: `capturing-intent/SKILL.md:49` の「`orchestrating-runs` の再開手順(§6)」を `orchestrating-runs` の `references/resume.md` に付け替える。
- [ ] ステップ 4: `intent-format.md` の diff が、マーカー・見出し名・frontmatter のキー・持続層のセクション書式・候補 ID の採番規則の行に触れていないことを確かめ、完了報告に書く(設計書 §5.6)。
- [ ] ステップ 5: 理由・経緯の退避(B5・B22・B27・B28)は、W3 に従って `C/docs/DESIGN.md` へ移す。同じ内容が既にあれば移さずに消す。
- [ ] ステップ 6: HARD-GATE と Red Flags の残りが 0 件であること、移した条項の一覧を完了報告に添える。
- [ ] ステップ 7: コミットする。

### Task 4: gate とレビュー対応の系統を改める

役割: 通常の実装。`prompt-smith:prompt-smith` を起動してから書く。Task 2 の後に行う。

**Files:**
- Modify: `C/skills/raguel-gating/SKILL.md`、`C/skills/fixing-review-findings/SKILL.md`、`C/skills/filing-followup-issues/SKILL.md`、`C/skills/facilitating-design-discussions/SKILL.md`、`C/references/github-writing.md`、`C/references/handoff-contract.md`
- Create: 各スキルの `references/` と、`C/references/` 配下の切り出し先(設計書 §5.3.2・§5.7・§5.8)
- 入力: 設計書 §4・§5.1・§5.3.2・§5.7・§5.8、付録の C 群

- [ ] ステップ 1: 付録の C 群を、W1〜W5 を当てて適用する。C32・C33 は適用しない。
- [ ] ステップ 2: 設計書 §5.3.2 の raguel-gating・filing-followup-issues・facilitating-design-discussions・github-writing の行を切り出す。github-writing の切り出しでは文言を変えない(設計書 §5.8)。
- [ ] ステップ 3: `fixing-review-findings/SKILL.md:18` の「§5「fix-loop のスキップ経路」」を、`orchestrating-runs` §2 の fix-loop をスキップする規則に付け替える。`fixing-review-findings` の L96-98 の「所見の統合と投稿」の参照を、`orchestrating-runs` の `references/review-common.md` に付け替える。fix-loop の再レビューの委譲を出す前に `review-common.md` を読むことを書く。
- [ ] ステップ 4: C8 の `wait-add` の id 規則は、`orchestrating-runs` §3 への参照にする(W5)。
- [ ] ステップ 5: HARD-GATE と Red Flags の残りが 0 件であること、移した条項の一覧を完了報告に添える。
- [ ] ステップ 6: コミットする。

### Task 5: 設計・実装系のスキルを改める

役割: 通常の実装。`prompt-smith:prompt-smith` を起動してから書く。Task 2 の後に行う。

**Files:**
- Modify: `C/skills/preparing-design-agendas/SKILL.md`、`C/skills/writing-design-docs/SKILL.md`、`C/skills/writing-dev-plans/SKILL.md`、`C/skills/writing-test-specs/SKILL.md`、`C/skills/implementing/SKILL.md`、`C/skills/implementing/references/frontend.md`、`C/skills/fixing-failures/SKILL.md`
- Create: `C/skills/implementing/references/` の手順ファイル(設計書 §5.3.2 の implementing の行)
- 入力: 設計書 §4・§5.1・§5.3.2・§5.4・§5.9、付録の D 群

- [ ] ステップ 1: 付録の D 群を、W1〜W3 を当てて適用する。D1・D7・D31 は W2 により委譲先スキルの記述を残す。D47 は適用しない。D24 は Task 2 で移し済みなので、`writing-test-specs` に残りが無いことだけを確かめる。
- [ ] ステップ 2: 設計書 §5.3.2 の implementing の行を切り出す。
- [ ] ステップ 3: `implementing`・`fixing-failures`・`writing-test-specs` に `## 完了報告` を置き、P5・P6 の項目を書く(設計書 §5.4)。
- [ ] ステップ 4: HARD-GATE と Red Flags の残りが 0 件であること、移した条項の一覧を完了報告に添える。
- [ ] ステップ 5: コミットする。

### Task 6: レビュー・テスト系を改める

役割: 通常の実装。`prompt-smith:prompt-smith` を起動してから書く。Task 2 の後に行う。

**Files:**
- Modify: `C/skills/reviewing-diffs/SKILL.md`、`C/skills/reviewing-diffs/references/*.md`、`C/skills/running-regression-tests/SKILL.md`、`C/skills/scripting-tests/SKILL.md`、`C/references/e2e-report-format.md`
- 入力: 設計書 §4・§5.1・§5.4、付録の E 群

- [ ] ステップ 1: 付録の E 群を、W1〜W4 を当てて適用する。E1 は Task 2 で移し済みなので、`reviewing-diffs` に「統合と投稿はオーケストレーターが行う。担当は所見を返すだけで `gh pr review` を実行しない」の 1 文だけが残っていることを確かめる。
- [ ] ステップ 2: `reviewing-diffs`・`running-regression-tests`・`scripting-tests` に `## 完了報告` を置き、P5・P6 の項目を書く。`reviewing-diffs` の所見には、該当行と前後 3 行の差分の抜粋と根拠を含める(設計書 §5.4)。
- [ ] ステップ 3: `running-regression-tests` の単独実行モード(E13)を縮めた後も、`C/commands/test.md` の手順と食い違わないことを確かめ、完了報告に書く。
- [ ] ステップ 4: HARD-GATE と Red Flags の残りが 0 件であること、移した条項の一覧を完了報告に添える。
- [ ] ステップ 5: コミットする。

### Task 7: 参照の付け替えと横断の検証

役割: 軽量な実装。grep による機械的な検証が中心である。Task 3〜6 の後に行う。

- [ ] ステップ 1: Task 3〜6 の完了報告にある「`ORS` 側に要る変更」を `ORS` に適用する。
- [ ] ステップ 2: `C/skills`・`C/references`・`C/commands` で次を確かめ、結果を完了報告に書く。
  - `grep -rnE 'HARD-GATE|Red Flags'` が 0 件である。
  - `grep -rnoE 'references/[A-Za-z0-9_./-]+\.md'` の参照先が、すべて実在する。
  - W4: 各スキルの本文と `references/` に `<plugin-root>` が残るかと、プラグインルート参照規約の有無が一致する。
  - 切り出したセクションの番号(§5・§6・§7・2.2・2.3・2.5〜2.11)で `orchestrating-runs` を指す参照が、`ORS` の外に残っていない。
- [ ] ステップ 3: `pnpm run lint`・`pnpm run typecheck`・`pnpm run test` を実行する。
- [ ] ステップ 4: コミットする。

### Task 8: 文書とメモリを追随させる

役割: その他のタスク。`prompt-smith:prompt-smith` を起動してから書く(メモリは AI 向けの指示書に当たる)。

**Files:**
- Modify: `C/docs/DESIGN.md`、`C/README.md`、`.serena/memories/` の該当メモリ。ルートの `README.md` に codiel の run の説明があれば、それも。

- [ ] ステップ 1: `C/docs/DESIGN.md:130-132` の review の説明を、`review-common.md` の規則と食い違わないように書き換える(infra と generic を加え、doc と security を毎回選ぶことを残す)。K2 で HARD-GATE と Red Flags を廃止した理由を足す。
- [ ] ステップ 2: `C/README.md` の review の説明を同じく書き換え、P7 のセッションの切り替えの使い方を 1 段落で足す。
- [ ] ステップ 3: `.serena/memories/` で codiel のスキルの構成に触れるメモリを探し、切り出し後の構成に合わせる。
- [ ] ステップ 4: コミットする。

### Task 9: レビュー

- [ ] ステップ 1: Task 2〜8 の差分を、コードレビューの役割に委譲する。Review Focus の 5 点を依頼文に書く。
- [ ] ステップ 2: 改修後の `ORS`・`raguel-gating`・`reviewing-diffs`・`capturing-intent` に、prompt-smith の評価をもう一度当てる。冗長度の評点が改修前(設計書 §3.2)より下がっていないことを確かめる。
- [ ] ステップ 3: 所見の採否を決め、採った所見を直してコミットする。

### Task 10: 改修後の run を 2 回計測し、受け入れを判定する

役割: オーケストレーターがユーザーと行う。Task 9 の後に行う。

- [ ] ステップ 1: Task 1 と同じ題材・連携モード・`TYPESAFE_API_KEY` の有無で、改修後の codiel(この worktree の HEAD)を読ませて run を 2 回回す。
- [ ] ステップ 2: 道具で集計し、設計書 §7.3 の受け入れ基準を判定する。
- [ ] ステップ 3: transcript から、各フェーズで対応する手順ファイルが Read されたことを確かめる。compaction が起きていれば、その後に `ORS` と手順ファイルが読み直されたことも確かめる。
- [ ] ステップ 4: 結果を「Task 10 の結果」に書き、基準を満たさない項目があればユーザーと次の手を決める。

## コミットの分け方

- Task ごとに 1 コミット以上に分ける。Task 2 は、本文の削減(ステップ 1)、切り出し(ステップ 2〜5)、テンプレートと HARD-GATE(ステップ 6〜8)の 3 つに分けてよい。
- 計測の道具(Task 1 のステップ 3)と計測の結果(ステップ 6)は別のコミットにする。
- コミットメッセージは既存の形(`fix(codiel): …`・`docs: …`)に合わせる。

## 既知のリスク

- 手順ファイルを読む契機が実際に守られるかは、run を回すまで分からない。Task 10 のステップ 3 で確かめる。
- K2 で HARD-GATE と Red Flags を削ると、規律を守る強さが落ちる可能性がある。Task 10 の run で、オーケストレーターがコードや spec を自分で書いていないかを transcript で確かめる。
- 改修前の run が何観点を出しているかは記録が無い(設計書 §9)。Task 1 で記録し、P1 の効果の見積もりと比べる。
- モデルの出力の揺らぎで、2 回の平均でも 10% の差が判定しきれないことがある。そのときは Task 10 のステップ 4 でユーザーと回数を足すかを決める。

## 未決事項

- 計測の題材(Task 1 のステップ 1)と、サンドボックスが codiel を読む経路(Task 1 のステップ 2)。

## Task 1 の結果

(Task 1 のステップ 6 で書く)

## Task 10 の結果

(Task 10 のステップ 4 で書く)
