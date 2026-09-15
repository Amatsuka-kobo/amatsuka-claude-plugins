# codiel / sandalphon のドメインマップ必須依存の解消 実装計画書

- 作成日: 2026-09-15
- 対象プラグイン: `plugins/codiel`(主)、`plugins/sandalphon`(従)、`plugins/metatron`(登録簿 fixtures とバージョンのみ)
- バージョン: codiel `0.7.0-dev` → `0.8.0-dev`、sandalphon `0.1.2-dev` → `0.2.0-dev`、metatron `0.3.2-dev` → `0.3.3-dev`
- 設計書(正本): `harness-docs/design/2026-09-15-codiel-domain-map-decoupling-design.md`
- 引き継ぎ書(事実・却下案の正本): `harness-docs/handover/2026-09-15-codiel-domain-map-decoupling-handover.md`
- **設計書のユーザー承認**: 済。契約凍結文書 `:70` の変更文面も 2026-09-15 に承認済み(設計書 §7.2)
- タスク数: **23**(T0〜T22)

この計画書は設計書からタスク分割・順序・検証方法だけを立てるものであり、**設計判断を上書きしない**。設計書と実装が食い違う事実を見つけたときは、実装を止めてオーケストレーターへ報告する。報告を受けたオーケストレーターは §8「設計書との食い違い」へ追記し、設計書の修正要否を判断する。

---

## 0. 前提と baseline

### 0.1 オーケストレーターが確定済みの判断(着手時にこれを前提とする)

| # | 事項 | 決定 |
| --- | --- | --- |
| 6-1 | 実行モードの記録先 | run state の optional フィールド `domainMode`。`version` は据え置く |
| 6-2 | 「初期化済み」の判定基準 | **B + C + D の 3 点。** A(ARCHITECTURE)は見ない |
| 6-3 | sandalphon の `codielReady` | 条件と名前の両方を変える。`codielHandoffCandidate = codielDirExists` |
| 6-4 (a) | 任意ドメイン名の行き先 | **汎用担当エージェントを新設する**(案 2) |
| 6-4 (b) | 穴埋めの時期 | **依存解消と同じ変更単位。** 停止条件を外す前に塞ぐ |
| 6-5 | 契約凍結文書 | init 手順 5 から ARCHITECTURE 検証を完全に消す。契約 `:70` を改訂する |
| 追加 | W14 | `preparing-design-agendas` と `writing-design-docs` も明示入力へ揃える |
| **承認済み** | 契約 `:70` の変更文面 | **2026-09-15 にユーザー承認済み。** T20 でそのまま適用する |
| **確定** | metatron のバージョン | **`0.3.3-dev` へ上げる。** 当初の据え置き判定はユーザーレビューで覆された(設計書 §5.8) |

### 0.2 baseline(2026-09-15 に計測済み。着手時に再取得して一致を確認する)

| 項目 | 値 |
| --- | --- |
| HEAD | `93a07ad` |
| `git status --short` | クリーン(差分なし) |
| `pnpm run lint` | 緑(biome の info 4 件。エラーなし) |
| `pnpm run typecheck` | 緑 |
| `pnpm run test` | `157 passed / 1 skipped`、`2234 passed / 2 skipped` |
| 現行バージョン | codiel `0.7.0-dev` / sandalphon `0.1.2-dev` / metatron `0.3.2-dev` |

baseline は `plugins/codiel/` に限定せず**リポジトリ全体**で取る。ルート `package.json` の `build` は全 workspace を対象にするため。

### 0.3 変更前の grep 実測値(検証条件の起点。2026-09-15 計測)

| ファイル | 「ドメインマップ」 | 「ARCHITECTURE」 |
| --- | --- | --- |
| `plugins/codiel/CLAUDE.example.md` | 2 | 10 |
| `agents/codiel-implementer-backend.md` | 2 | 2 |
| `agents/codiel-implementer-data.md` | 1 | 2 |
| `agents/codiel-implementer-frontend.md` | 1 | 2 |
| `agents/codiel-reviewer-backend.md` | 2 | 1 |
| `agents/codiel-reviewer-doc.md` | 1 | 4 |
| `commands/init.md` | 1 | 1 |
| `skills/implementing/SKILL.md` | 2 | 3 |
| `skills/initializing-harness/SKILL.md` | 4 | 18 |
| `skills/orchestrating-runs/SKILL.md` | 7 | 10 |
| `skills/preparing-design-agendas/SKILL.md` | 1 | 5 |
| `skills/writing-design-docs/SKILL.md` | 1 | 3 |
| `skills/writing-dev-plans/SKILL.md` | 5 | 2 |

**「ドメインマップ」の出現数は登録簿のエントリ数と一致しない。** 登録は `termsIn`(`section-reference-inventory.test.ts:93-106`)の 4 パターンで決まり、主に (d) `ARCHITECTURE[^\n]{0,40}` + 節名 が効く。例えば `agents/codiel-reviewer-backend.md` は「ドメインマップ」を 2 件持つが、いずれも近傍に `ARCHITECTURE` が無いため**分類 B として登録されていない**。判定は必ず §5.9 の手順で行う。

### 0.4 触ってはならないもの

- **`plugins/codiel/src/hooks/__test__/guard-write.test.ts` を書き換えない**(設計書 §5.7・§9.1)。書き換えが要ると判断したら、その時点で実装を止めて報告する。
- **3 者比較テストを書き換えない**: `plugins/sandalphon/src/__test__/check-intent-env.test.ts` の 16f 群(`:886` 以降)、`plugins/metatron/src/lib/__test__/config.test.ts` の R4-a〜R4-f(`:274`-`:338`)。
- **`plugins/metatron/src/__test__/section-reference-inventory.test.ts` を書き換えない。** fixtures 側を直して V1 / V2 / V3 を通す。
- **`plugins/*/scripts/` を手で編集しない。** `src/` を変更し `pnpm run build` で再生成する。
- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md` と `.claude/rules/metatron/*.md` を Edit / Write で触らない。ADR は `stage-adr` → `commit-architecture` を使う。
- `.serena/memories/` の変更は Serena の `write_memory` / `edit_memory` で行う。
- `plugins/sandalphon/skills/capturing-intent/SKILL.md:81` を変更しない(任意参照であり必須依存ではない)。

---

## 1. 進め方の共通規律

- 各タスクは**テストを先に書いてから実装する**(実装層のタスク)。
- **フェーズの境界では常に緑にする。** 赤が残ってよいのはタスクの内部だけである。
- **指示書の文面確定は `prompt-smith:prompt-smith` を Skill ツールで起動して行う。** 対象は SKILL.md / agents / references / `CLAUDE.example.md` である。各タスクの手順にこの起動を明記してある。
- **新規 agent 定義の作成は `prompt-smith:agent-creator` で行う**(T4)。
- **description の作成・改善は `prompt-smith:skill-creator`(スキル・コマンド定義)と `agent-creator`(agent)が担当する。** T13 の `commands/init.md` の description、T4 / T5 の agent の description が該当する。
- `src/` を変更したタスクは、同じタスク内で `pnpm run build` を実行し、**`scripts/` の差分が同じコミットに入る**ことを確認する。
- ブランチを切らない。`git push` に force 系のフラグを付けない。
- **依頼文の生成規則(委譲するとき必須)。** 次をすべて転記する。
  1. 対象ファイルの**絶対パス**と、そのタスクが書き込んでよいパスの列挙。
  2. 設計書の該当節番号と、その節の表・全文ブロック。
  3. §5 の共有契約のうち、そのタスクに必要な小節だけ。
  4. §6 のうち、そのタスクの ID が挙がっている行の全文。
  5. §0.4「触ってはならないもの」の全文。
  6. 使用してよい tools、Agent tool の可否、報告形式。

### 中間状態の許容範囲

- T1 の完了時点で `lib.ts` は `unreadable` を返すが、読む側はまだ無い。型は閉じているので緑になる。
- T2 の完了時点で `RunState.domainMode` は書けるが、読む指示層はまだ無い。
- **T4〜T7(穴を塞ぐ)を終えるまで、T8(停止条件の置き換え)に着手しない。** 順序の理由は §3。
- T14 で `check-intent-env.ts` のフィールド名を変えると、消費側(T15)が追随するまで指示層と出力がずれる。**T14 と T15 は同じフェーズ内で連続して行う。**

---

## 2. タスク分割

### フェーズ 0: 準備(直列 1)

#### T0: baseline の取得

- §0.2 の表を再取得し、記録値と一致することを確認する。
- 検証: `lint` / `typecheck` / `test` が**着手前に緑**であること。赤があれば本改修に入らず報告する。

---

### フェーズ 1: 実装層(直列。TDD)

#### T1: `lib.ts` に「読めない理由」を足す

- 対象: `plugins/codiel/src/hooks/lib.ts`、`plugins/codiel/src/hooks/__test__/lib.test.ts`
- 設計書: §5.2、§6.15、§9.2、§9.3(テスト 1〜3)
- 変更:
  1. **先にテストを書く**(§9.3 のテスト 1〜3)。この時点で赤。
  2. `DomainsUnreadableReason` 型と `DomainsRead.unreadable` を足す(§5.1 に全文)。
  3. `readDomainsResult`(`:484-503`)の 5 つの return に理由を入れる。
  4. **`validateDomainsValue`(`:451-463`)と `findDomainsBlocks` の警告生成と JSON パースの成否判定は変更しない。**
  5. **`readDomains`(`:509-511`)は変更しない。**
  6. 既存テスト `lib.test.ts:531-537` を `unreadable: "architecture_missing"` を含む形へ更新する(§9.2)。
- 検証:
  - `pnpm exec vitest run plugins/codiel/src/hooks/__test__/lib.test.ts` が緑。既存の R1〜R11 群が 1 件も落ちない。
  - `pnpm exec vitest run plugins/sandalphon/src/__test__/check-intent-env.test.ts` が緑(**3 者比較が無傷であることの確認**)。
  - `git diff plugins/codiel/src/hooks/guard-write.ts` が**空**。

#### T2: `codiel-state.ts` に実行モードを足す

- 対象: `plugins/codiel/src/codiel-state.ts` と対応する `__test__/`
- 設計書: §5.1、§6.4、§9.3(テスト 4・5)
- 変更:
  1. **先にテストを書く**(§9.3 のテスト 4・5)。
  2. `RunState`(`:26-48`)へ `domainMode?: "mapped" | "unscoped"` を足す。`domain?`(`:43-47`)と同型のコメントを添える。**`version`(`:27`)は据え置く。**
  3. `init` の経路(`--base-branch` を読む `:241` と同じ形)で `--domain-mode` を受け取り `state.domainMode` に入れる。未指定なら**フィールドを持たせない**。
- 検証:
  - `codiel-state init --issue N --domain-mode unscoped` で `state.json` に `"domainMode": "unscoped"` が入る。
  - `--domain-mode` を付けない `init` で `state.json` に `domainMode` キーが**現れない**。
  - `domainMode` を持たない既存 `state.json` を `get` で読めて例外にならない。
  - `state.json` の `version` が baseline と同じ値である。

#### T3: codiel の build

- 変更: `pnpm run build`。
- 検証:
  - `git diff --stat plugins/codiel/scripts/` に `lib.mjs` / `guard-write.mjs` / `codiel-state.mjs` の差分がある。
  - **`guard-write.mjs` に差分が出るのは正しい**(§6 の F3)。`guard-write.ts` のソースは不変だが `lib.ts` を取り込むため。
  - `scripts/*.mjs` を手で編集していない。
  - `pnpm run test` が全体で緑。

---

### フェーズ 2: 先に穴を塞ぐ(W7・W6)

**このフェーズを終えるまで T8 に着手しない。** 停止条件を外した瞬間に任意キーのマップで run が始まるため、行き先が無いまま通す状態を一瞬も作らない(設計書 §1 の 6-4 (b))。

#### T4: 汎用担当エージェント 2 体の新設

- 対象: `plugins/codiel/agents/codiel-implementer-generic.md`(新規)、`plugins/codiel/agents/codiel-reviewer-generic.md`(新規)
- 設計書: §5.5、§6.7
- 手順:
  1. **`prompt-smith:agent-creator` を Skill ツールで起動し、その規律に従って 2 体を作る**(規約)。
  2. 要件は §5.10 の表に従う。**担当タグをハードコードしない。**
  3. `tools` は既存の `codiel-implementer-backend.md:4` / `codiel-reviewer-backend.md:4` と同じ最小構成に揃える(reviewer は GitHub 系、implementer は Edit / Write / Bash)。
- 検証:
  - 2 ファイルが存在し、frontmatter に `name` / `description` / `tools` がある。
  - `grep -n 'frontend\|backend\|data' plugins/codiel/agents/codiel-implementer-generic.md` が**0 件**(特定ドメインを名乗っていない)。
  - `grep -n 'API 設計\|エラーハンドリング' plugins/codiel/agents/codiel-reviewer-generic.md` が **0 件**(backend の観点を持ち込んでいない)。

#### T5: 既存 agent の兼任記述を外す

- 対象: `plugins/codiel/agents/codiel-implementer-{backend,frontend,data}.md`、`codiel-reviewer-{backend,doc}.md`(5 ファイル)
- 設計書: §6.6 の表、§5.7(reviewer-doc の書き換え方針)
- 手順: **`prompt-smith:prompt-smith` を起動して文面を確定する。** description の変更は `agent-creator` が担当する。
- 変更:
  1. `codiel-implementer-backend.md:16`(縮退時の兼任)と `:3` の description の兼任記述を**削除**する。`:15` / `:20` の backend 専任の記述は残す。
  2. `codiel-implementer-frontend.md:16-17` と `codiel-implementer-data.md:16-17` の「汎用実装は codiel-implementer-backend の担当」「generic 縮退時は呼ばれない」を、`codiel-implementer-generic` を指す形へ書き換える。
  3. `codiel-reviewer-backend.md:3` の description から「ドメイン縮退時は汎用レビュー担当を兼ねる。」を**削除**する。`:26`(縮退時は diff 全体を確認する)を**削除**する。
  4. `codiel-reviewer-doc.md:25` を §5.7 の方針で書き換える。`:26` の ARCHITECTURE 更新漏れの確認も同じ向きへ揃える。
- 検証:
  - `grep -rc '兼ね' plugins/codiel/agents/` が**全ファイル 0 件**(変更前は implementer-backend 2 件・reviewer-backend 1 件の計 3 件)。
  - `grep -rn 'codiel-implementer-backend の担当\|generic 縮退時は呼ばれない' plugins/codiel/agents/` が **0 件**(変更前は 4 件)。
  - `grep -rln 'codiel-implementer-generic' plugins/codiel/agents/` が **2 ファイル**(frontend と data)。
  - `grep -n 'ドメインマップと実装が乖離していないことを確認する' plugins/codiel/agents/codiel-reviewer-doc.md` が **0 件**。

#### T6: `implementing/SKILL.md` の汎用条件

- 対象: `plugins/codiel/skills/implementing/SKILL.md`
- 設計書: §6.6 の前半 4 行
- 手順: **`prompt-smith:prompt-smith` を起動して文面を確定する。**
- 変更: `:10-12`(概要の担当列挙)/ `:34-36`(自ドメインの定義)/ `:37-39`(ARCHITECTURE を読む手順)/ `:91-97`(ドメイン規律)。**渡された担当タグを使う形**へ揃え、ARCHITECTURE をマップの取得元として読み直させない。
- 検証:
  - `grep -c '縮退' SKILL.md` が **0 件**(変更前 1 件)。
  - `grep -n 'codiel-implementer-generic' SKILL.md` が 1 件以上。
  - `grep -n 'docs/ARCHITECTURE.md' SKILL.md` が **0 件**(既定パスへのフォールバックが消えている)。

#### T7: `orchestrating-runs/SKILL.md` のルーティング規則

- 対象: `plugins/codiel/skills/orchestrating-runs/SKILL.md`(§4 と フェーズ進行表)
- 設計書: §5.4、§6.7
- 手順: **`prompt-smith:prompt-smith` を起動して文面を確定する。**
- 変更:
  1. `:195-205`(§4)の対応表を §5.5 のルーティング規則へ置き換える。`:197` の固定語彙(`frontend` / `backend` / `data`)をやめる。
  2. `:203-205`(generic 縮退)を `codiel-implementer-generic` / `codiel-reviewer-generic` を使う形へ置き換える。
  3. `:118`(implement 行)と `:122`(review 行)の担当エージェント列に generic を加える。
  4. `:129` の縮退運用の参照を実行モードの語へ揃える。
- **§0(`:52-78`)と §3(`:156-193`)と §4.1(`:207-239`)は T8 で扱う。このタスクでは触らない。**
- 検証:
  - `grep -c '汎用実装者' SKILL.md` が **0 件**(変更前 2 件)。
  - `grep -n 'codiel-implementer-generic\|codiel-reviewer-generic' SKILL.md` が 2 件以上。
  - `grep -n 'ハーネスが未初期化' SKILL.md` が **1 件のまま**(§0 は未着手。T8 で消す)。

---

### フェーズ 3: 実行モードの決定(W2・W3・W4 の指示層)

#### T8: `orchestrating-runs/SKILL.md` の §0・§3・§4.1・§6

- 対象: `plugins/codiel/skills/orchestrating-runs/SKILL.md`
- 設計書: §6.2(W2)、§6.3(W3)、§6.4(W4)、§5.3(分岐表)
- 手順: **`prompt-smith:prompt-smith` を起動して文面を確定する。**
- 変更:
  1. **§0(`:52-78`)**: §5.3 の指示文の形に従う。`:70-72` の停止条件を分岐表 7 行へ置き換える。`:56-65` の解決コマンドは §5.3 の `node -e` へ差し替える。`:73-74`(`warnings` の全文提示)は**残す**。`:76-77`(Raguel MCP)は残す。初期化の外形(B + C + D)の確認を足す。**A(ARCHITECTURE)を見る記述を入れない。**
  2. **§3(`:156-193`)**: §5.4 のディスパッチプロンプト契約に従い、`## 前提` ブロック(`:174-179`)へモード・マップ・担当タグを足す。`:190` にモードとマップも同じ扱いである旨を足す。
  3. **§4.1(`:207-239`)**: `mapped` のときだけ `set-domain` を運用する。`unscoped` では呼ばず `clear-domain` で `domain` を残さない。`:223-225` を「ステップに付いたタグの値をそのまま渡す」へ改める。
  4. **§6 再開手順(`:271-283`)**: 手順 1 と 3 の間へ `state.domainMode` の復元を足す。§5.3 の行 4・行 7 を適用する。
  5. `:35`(チェックリスト 0)と `:39` / `:102`(`codiel-state init` の呼び出し)へ `--domain-mode` を足す。
- 検証:
  - `grep -c 'ハーネスが未初期化' SKILL.md` が **0 件**。
  - `grep -n 'unreadable' SKILL.md` が 1 件以上(§0 が理由を読む)。
  - `grep -n 'domainMode\|--domain-mode' SKILL.md` が 2 件以上。
  - `grep -n 'warnings' SKILL.md` が 1 件以上(**警告の提示が残っている**。契約 `:70` が §0 を名指しし続ける根拠)。
  - `grep -c 'generic 縮退' SKILL.md` が **0 件**(変更前 2 件。T7 と合わせて解消)。
  - §0 の分岐表が 7 行あり、`unreadable` の 5 値すべてに行き先がある。

---

### フェーズ 4: planner と architect の明示入力化(W5・W14)

#### T9: `writing-dev-plans/SKILL.md`

- 対象: `plugins/codiel/skills/writing-dev-plans/SKILL.md`
- 設計書: §6.5、§5.8(ask の扱い)
- 手順: **`prompt-smith:prompt-smith` を起動して文面を確定する。**
- 変更: `:30-32`(渡された値を使う)/ `:33-34`(縮退の条件を限定)/ 新規(`unscoped` の分類規則)/ `:35-37`(`mapped` の手順と明示)/ `:76-77`(固定語彙の列挙をやめる)/ `:79-88`(未分類ファイル規則の一般化と §5.8 の追記)。
- 検証:
  - `grep -n 'docs/ARCHITECTURE.md' SKILL.md` が **0 件**(既定パスへのフォールバックが消えている)。
  - `grep -n 'ファイルがあれば必ず読む' SKILL.md` が **0 件**。
  - `grep -n 'unscoped' SKILL.md` が 1 件以上(マップ不在時の分類規則がある)。
  - `grep -n 'ask' SKILL.md` が 1 件以上(§5.8 の扱いが書かれている)。

#### T10: `preparing-design-agendas` と `writing-design-docs`

- 対象: `plugins/codiel/skills/preparing-design-agendas/SKILL.md`(`:20-23`)、`plugins/codiel/skills/writing-design-docs/SKILL.md`(`:27-30`)
- 設計書: §6.14
- 手順: **`prompt-smith:prompt-smith` を起動して文面を確定する。**
- 変更: 両者とも、ドメインマップは**渡された値**を使う形へ改める。既定パスへのフォールバックをやめ、渡されなければ使わない。ARCHITECTURE 自体を読み物として読むことは禁じない。
- 検証: 両ファイルで `grep -n 'docs/ARCHITECTURE.md'` が **0 件**。

---

### フェーズ 5: writer の停止と配布物(W1・W8・W11)

#### T11: `initializing-harness/SKILL.md` から ARCHITECTURE を外す

- 対象: `plugins/codiel/skills/initializing-harness/SKILL.md`
- 設計書: §6.1 の表(12 行)
- 手順: **`prompt-smith:prompt-smith` を起動して文面を確定する。** description(`:3`)は `skill-creator` が担当する。
- 変更: §6.1 の表のとおり 12 箇所。**手順 1 全体(`:42-98`)と修復の例外の ARCHITECTURE 部分(`:163-172`)を削除し、手順 5(`:129-150`)から ARCHITECTURE 検証を完全に消す。**
- 検証:
  - `grep -c 'ドメインマップ' SKILL.md` が **0 件**(変更前 4 件)。
  - `grep -c 'metatron:domains' SKILL.md` が **0 件**(変更前 3 件)。
  - `grep -c '最小 ARCHITECTURE' SKILL.md` が **0 件**(変更前 6 件)。
  - `grep -n 'readDomainsResult' SKILL.md` が **0 件**(手順 5 の検証コマンドが消えている。**契約 `:70` から手順 5 の名指しを外す根拠**)。
  - `grep -n 'raguel.config.yaml' SKILL.md` が 3 件以上(保護パスの聞き取りと YAML 修復は残っている)。
  - 現状調査の表が **3 行**(A が消えて B / C / D)。

#### T12: `CLAUDE.example.md` と `docs/DESIGN.md`

- 対象: `plugins/codiel/CLAUDE.example.md`、`plugins/codiel/docs/DESIGN.md`
- 設計書: §6.8 の表、§5.6(規則 5 の反転方針)
- 手順: **`prompt-smith:prompt-smith` を起動して文面を確定する**(`CLAUDE.example.md` は対象プロジェクトへ配布される指示書である)。
- 変更:
  1. `CLAUDE.example.md:25-27` を GOTCHAS 側(`:28-29`)と同型にする。
  2. `:33-35`(規則 1)のドメインマップ確認を必須の前提から外す。
  3. `:48-51`(規則 5)を §5.6 の方針で反転する。
  4. `docs/DESIGN.md:391-394` から ARCHITECTURE を生成物の列挙から外し、`:395` の GOTCHAS と同型の 1 文にする。`:396` の「未初期化」の定義を B + C + D と明示する。
  5. **`docs/DESIGN.md:385`(hook の表)は変更しない。** hook の挙動を据え置くため事実のまま。
- 検証:
  - `grep -c 'ARCHITECTURE を更新する' CLAUDE.example.md` が **0 件**(変更前 2 件)。
  - `grep -c '案内が無ければ直接編集' CLAUDE.example.md` が **0 件**(変更前 1 件)。
  - `grep -c '直接編集しない' CLAUDE.example.md` が **3 件**(変更前 2 件 = GOTCHAS と state.json。ARCHITECTURE が加わる)。
  - `CLAUDE.example.md` の規則が **7 項目のまま**(本数を変えない。`:11` の宣言と整合)。
  - `git diff plugins/codiel/docs/DESIGN.md` に `:385` の行が含まれない。

#### T13: README とコマンド説明

- 対象: `plugins/codiel/README.md`(`:15-19`・`:21-26`)、`plugins/codiel/commands/init.md`(`:2`)、ルート `README.md`(`:71`・`:146`)
- 設計書: §6.11
- 手順: `commands/init.md` の description は **`prompt-smith:skill-creator` が担当する**(コマンド定義の description)。README は通常の文書。
- 変更: §6.11 の表のとおり 4 箇所。
- **`plugins/codiel/README.md:21`「Codiel は単体で完結します。」は残す。** 本改修は単体完結性を強める。
- 検証:
  - `grep -c '最小 ARCHITECTURE\|最小の ARCHITECTURE' plugins/codiel/README.md README.md plugins/codiel/commands/init.md` が**全ファイル 0 件**。
  - `grep -c 'ドメインマップ' plugins/codiel/commands/init.md` が **0 件**(変更前 1 件)。
  - `grep -c '単体で完結' plugins/codiel/README.md` が 1 件(残っている)。
  - **`commands/init.md:2` の description を書き換えると登録簿の 4 エントリが同時に影響する**(§5.9)。T16 で必ず再判定する。

---

### フェーズ 6: sandalphon(W9)

#### T14: `check-intent-env.ts` のフィールド変更と build

- 対象: `plugins/sandalphon/src/check-intent-env.ts`、対応する `__test__/`
- 設計書: §5.6、§6.9、§9.3(テスト 6・7)
- 変更:
  1. **先にテストを書く**(§9.3 のテスト 6・7)。
  2. `:593-594` を `const codielHandoffCandidate = codielDirExists` にし、コメントを検出事実を返す旨へ書き換える。
  3. `:798` の出力キーを `codielHandoffCandidate` へ改名する。
  4. **`:792-797` の `projectDocs.domainsReadable` / `domainCount` は変更しない**(3 者比較の比較対象)。
  5. `pnpm run build` を実行する。
- 検証:
  - `pnpm exec vitest run plugins/sandalphon/src/__test__/check-intent-env.test.ts` が緑。**16f 群を書き換えていない。**
  - 出力 JSON に `codielHandoffCandidate` があり `codielReady` が無い。
  - `projectDocs.domainsReadable` が従来どおり出る。
  - `git diff --stat plugins/sandalphon/scripts/` に差分がある。手で編集していない。

#### T15: sandalphon の指示層・参照層・docs

- 対象: `plugins/sandalphon/skills/bridging-execution/SKILL.md`、`references/sandalphon-common.md`、`docs/rationale.md`
- 設計書: §6.9 の表、§5.6
- 手順: **`prompt-smith:prompt-smith` を起動して文面を確定する**(SKILL.md と references が対象。`docs/rationale.md` は設計文書なので対象外)。
- 変更:
  1. `bridging-execution/SKILL.md:39`・`:48-49` を `codielHandoffCandidate` へ改名。**`:51-53` の `domainsReadable: false` の案内分岐を削除**する。`:54` は残す。
  2. `sandalphon-common.md:42` の行を**削除**する。`:41` と `:29` は残す。
  3. `docs/rationale.md:51-68` の見出しを改題し `:53-60` を書き換える。`:62-65` と `:67-68` は残す。
- **`plugins/sandalphon/skills/capturing-intent/SKILL.md:81` を変更しない。**
- 検証:
  - `grep -rn 'codielReady' plugins/sandalphon/ --include=*.md --include=*.ts | grep -v '/scripts/'` が **0 件**(変更前 21 件)。
  - `grep -n 'domainsReadable' plugins/sandalphon/references/sandalphon-common.md` が **0 件**。
  - `grep -n 'domainsReadable' plugins/sandalphon/skills/capturing-intent/SKILL.md` が **1 件のまま**(`:81` の任意参照)。
  - `grep -n '複合条件' plugins/sandalphon/docs/rationale.md` が **0 件**。

---

### フェーズ 7: 登録簿(W10)

#### T16: `section-reference-inventory.json` の追随

- 対象: `plugins/metatron/src/fixtures/section-reference-inventory.json`
- 設計書: §6.10、§9.4
- **このタスクは T4〜T15 の文面がすべて確定した後に行う。** 登録の増減は最終的な文面で決まる。
- 手順: **§5.9 の判定手順に従う。** 自力で grep して推測せず、テストの出力を一次情報にする。
- 検証:
  - `pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` が緑(V1 / V2 / V3)。
  - `section-reference-inventory.test.ts` を**変更していない**(`git diff` が空)。
  - 新設した agent 2 体が、ARCHITECTURE に言及するなら登録され、しないなら登録されていない。

---

### フェーズ 8: バージョンとメモリ(並列 2)

#### T17: バージョン

- 対象: `plugins/codiel/.claude-plugin/plugin.json` / `package.json`、`plugins/sandalphon/.claude-plugin/plugin.json` / `package.json`、`plugins/metatron/.claude-plugin/plugin.json` / `package.json`
- 設計書: §5.8
- 変更: codiel を `0.8.0-dev`、sandalphon を `0.2.0-dev`、**metatron を `0.3.3-dev`**。
- 検証: 6 ファイルの `version` が 3 組で一致する。

#### T18: Serena メモリの追随

- 対象: `.serena/memories/codiel/core.md`、`.serena/memories/sandalphon/core.md`、`.serena/memories/metatron/core.md`
- 設計書: §8.6、§13
- 変更: Serena の `edit_memory` で行う。**Edit / Write ツールで直接書かない。**
  - `codiel/core.md`: **`:1` のバージョンを `0.8.0-dev` へ。** `:19-33` の「`/codiel:init` が最小 ARCHITECTURE を生成する」を、生成しない形へ書き換える。`:11` のマーカーの記述は事実として残す。
  - `sandalphon/core.md`: バージョンと、`codielReady` の記述があれば追随する。
  - `metatron/core.md`: バージョンを `0.3.3-dev` へ。
- 検証:
  - `grep -rn '最小 ARCHITECTURE' .serena/memories/` が **0 件**。
  - `grep -rn 'codielReady' .serena/memories/` が **0 件**。
  - `grep -rn '0.7.0-dev\|0.1.2-dev\|0.3.2-dev' .serena/memories/` が **0 件**。

---

### フェーズ 9: 保護対象と契約(T19 はオーケストレーターが実施)

#### T19: ADR-003 の起票(**オーケストレーターが実施**)

- 対象: `harness-docs/ARCHITECTURE.md`(**CLI 経由のみ**)
- 設計書: §6.12 の表
- 手順:
  1. §6.12 の表の内容を `stage-adr` の入力 JSON にして一時ファイルへ Write する。`title` は `[codiel] ドメインマップは metatron の資産とし、codiel は無くても汎用実行する`。
  2. `stage-adr --input <一時ファイル>` を実行する。
  3. 返った `diff.unified` を**全文提示してユーザーの承認を得る**。`stage-adr` が exit 0 で返ったことを承認と読み替えない。
  4. 承認後に `commit-architecture --staging-id <id>` を実行する。
- **CLI の絶対パスは注入の案内か hook の拒否メッセージから取る。推測しない。**
- 現在 ADR-001 と ADR-002 があるため、CLI が **ADR-003** を採番する。
- 検証: `grep -n 'ADR-003' harness-docs/ARCHITECTURE.md` が 1 件。`get adr --id ADR-003` が `ok: true`。

#### T20: 契約凍結文書の改訂(承認済み)

- 対象: `harness-docs/design/2026-08-16-file-contract-freeze.md`(`:70`)
- 設計書: §7.2(変更前・変更後の全文)
- **2026-09-15 にユーザー承認済み。** そのまま適用する。
- 変更: `:70` から `initializing-harness` の手順 5 の名指しを外す。**`orchestrating-runs` の §0 の名指しは残す。**
- **このファイルは保護パスではない**(`.claude/rules/metatron/protected-paths.md` の対象は ARCHITECTURE / GOTCHAS / rules 3 本)。Edit で直接変更してよい。
- 検証:
  - `grep -n 'initializing-harness' harness-docs/design/2026-08-16-file-contract-freeze.md` が **0 件**。
  - `grep -n 'orchestrating-runs' harness-docs/design/2026-08-16-file-contract-freeze.md` が **1 件**。
  - `:70` 以外の行が変わっていない(`git diff` が 1 行の置換のみ)。

---

### フェーズ 10: 統合検証(直列。T21 → T22)

#### T21: 全体のビルドと検査

- 手順: `pnpm run build` → `pnpm run lint` → `pnpm run typecheck` → `pnpm run test`。
- 検証:
  - 4 つすべてが緑。テスト数が baseline(2234 passed)から**減っていない**。
  - `plugins/codiel/scripts/` の差分が build 由来のみ(`lib.mjs` / `guard-write.mjs` / `codiel-state.mjs`)。**`install-harness.sh` に差分が無いこと**(本改修の対象外)。
  - `plugins/sandalphon/scripts/` の差分が build 由来のみ。
  - `git diff plugins/codiel/src/hooks/guard-write.ts` が**空**。
  - `git diff plugins/codiel/src/hooks/__test__/guard-write.test.ts` が**空**。
  - `git diff plugins/metatron/src/__test__/section-reference-inventory.test.ts` が**空**。

#### T22: 最終確認

- `git status --short` を baseline と突き合わせ、**新規差分がすべて本改修のものである**ことを確認する。
- §7 の Done 条件チェックリストをすべて埋める。
- コミットする(ユーザーの指示があるときのみ)。

---

## 3. 依存関係

```
T0
 └→ T1 → T2 → T3(build)
            │
            ├→ 【フェーズ 2: 先に穴を塞ぐ】
            │    T4 → T5 → T6
            │      └→ T7
            │
            └→ 【フェーズ 3】T8   ← T4〜T7 の完了が必須
                  │
                  ├→ T9 → T10
                  ├→ T11 → T12 → T13
                  ├→ T14 → T15
                  │
                  └→ T16(登録簿。T4〜T15 の文面確定後)
                        │
                        ├→ (T17 ∥ T18)
                        ├→ (T19 ∥ T20)
                        └→ T21 → T22
```

- **T1 → T2 → T3 は直列。** T3 の build で `scripts/lib.mjs` が `unreadable` を返すようになり、T8 の §0 コマンドが成立する。
- **T4 → T5 は直列。** T5 が `codiel-implementer-generic` を名指しするため、T4 で実体を作ってから。
- **T4〜T7 は T8 より先(最重要)。** 停止条件を外した瞬間に任意キーのマップで run が始まる。行き先が無いまま通す状態を一瞬も作らない(設計書 §1 の 6-4 (b))。
- **T7 と T8 は同じファイルを触る。必ず逐次に行う。** T7 は §4 とフェーズ進行表、T8 は §0・§3・§4.1・§6 を担当する。
- **T11 → T12 → T13 は逐次が安全。** `initializing-harness` の文面が `CLAUDE.example.md` と README の書き方を決める。
- **T14 → T15 は連続して行う。** 間に他のタスクを挟むと、出力キーと消費側がずれた状態が長く残る。
- **T16 は T4〜T15 のすべてが終わってから。** 登録の増減は最終的な文面で決まる。
- **T19 / T20 は他をブロックしない。** ADR と契約文書は `src/` とテストに影響しない。
- T9 / T10、T11〜T13、T14 / T15 の 3 系統は互いに独立で、並列に進めてよい。

---

## 4. 委譲先

プロジェクトの担当表に従う。

| タスク | 委譲先の役割 | 備考 |
| --- | --- | --- |
| T0 | 通常の実装 | baseline の取得のみ |
| **T1 / T2** | **複雑または重要な実装**(`lead-implementer`) | 型の追加と契約の不変条件を伴う。設計書 §5.2 の「契約が割れない論証」4 点と §0.4 を必ず転記する |
| T3 | 軽量な実装(`general-implementer`) | build のみ |
| **T4** | 通常の実装(`general-implementer`) | **`prompt-smith:agent-creator` の起動を依頼文に明記する。** §5.10 の要件表を転記する |
| T5 / T6 / T7 | 通常の実装(`general-implementer`) | **`prompt-smith:prompt-smith` の起動を明記する。** §5.5 / §5.7 を転記する |
| **T8** | **複雑または重要な実装**(`lead-implementer`) | 分岐表 7 行を指示文へ落とす。§5.3 / §5.4 の全文を転記する |
| T9 / T10 | 通常の実装(`general-implementer`) | §5.8 を転記する |
| T11 / T12 / T13 | 通常の実装(`general-implementer`) | §5.6 を転記する |
| **T14** | **複雑または重要な実装**(`lead-implementer`) | 3 者比較テストに触れずにフィールドを改名する。§0.4 を必ず転記する |
| T15 | 通常の実装(`general-implementer`) | — |
| **T16** | 通常の実装(`general-implementer`) | **§5.9 の判定手順を全文転記する。** 推測で増減させない |
| T17 / T18 | 軽量な実装(`general-implementer`) | T18 は Serena の `edit_memory` を使う |
| **T19** | **オーケストレーター本体** | stage の diff に対するユーザー承認を挟むため**委譲しない** |
| T20 | 通常の実装(`general-implementer`) | 承認済み。1 行の置換 |
| T21 | 通常の実装(`general-implementer`) | — |
| T22 | オーケストレーター本体 | 最終確認は委譲しない |

- **コードレビューは `code-reviewer` へ委譲する。** 対象は T1 / T2 / T14 の差分(`src/` の変更)。
- **重要な実装の最終レビューは `complex-reviewer` へ委譲する。** 対象は T8 の指示文と、T21 の統合結果。
- 読み取りだけの確認を `Write` / `Edit` を持つ定義へ委譲するときは、依頼文に「使用してよい tools を読み取り系に限定すること」「ファイルを変更しないこと」「報告のみを返すこと」を明記する。

---

## 5. タスク間で共有する契約

### 5.1 `DomainsRead` の拡張(T1 が実装。T8 が読む)

```ts
/** domains が null になった理由。読めたときは null。 */
export type DomainsUnreadableReason =
  | "architecture_missing" // ARCHITECTURE のファイルが無い(lib.ts:487)
  | "block_missing"        // metatron:domains ブロックが無い(:491)
  | "invalid_json"         // ブロック内が有効な JSON でない(:497)
  | "invalid_shape"        // 検証 4 項目の 2〜4 に違反(:499)
  | "read_error"           // 例外(:500-501)

export interface DomainsRead {
  domains: Record<string, string[]> | null
  warnings: string[]
  unreadable: DomainsUnreadableReason | null
}
```

**変えてはならないもの**(設計書 §5.2 の論証がこれに依存する)。

- `validateDomainsValue`(`lib.ts:451-463`)の判定内容。
- `findDomainsBlocks` の警告生成。
- `readDomains`(`:509-511`)の戻り値。
- `domains` と `warnings` の値。全入力に対して変更前と同一であること。

### 5.2 `RunState.domainMode`(T2 が実装。T8 が書き読みする)

```ts
  // 境界の課し方(設計書 2026-09-15 §5.1)。"mapped" は有効なドメインマップに基づく境界、
  // "unscoped" は境界を設けないことを run 開始時に明示選択した状態。
  // optional なので domainMode を持たない既存 state はそのまま読める(version 据え置き)。
  // 未記録は「モード未決」として扱い、§0 の判定をやり直す。
  domainMode?: "mapped" | "unscoped"
```

`codiel-state init` が `--domain-mode <値>` を受け取る。未指定ならフィールドを持たせない。

### 5.3 §0 の指示文の形(T8 が実装。レビュー指摘 1 への回答)

**解決コマンドは `unreadable` も出力する形へ差し替える。** `:56-65` の `node -e` を次の形にする。

```
node -e 'import("<plugin-root>/scripts/lib.mjs").then(({ resolveDocPaths, readDomainsResult }) => {
  const p = resolveDocPaths(process.cwd());
  const d = readDomainsResult(process.cwd());
  console.log(JSON.stringify({ architecture: p.architecture, gotchas: p.gotchas, domains: d.domains, unreadable: d.unreadable, warnings: [...p.warnings, ...d.warnings] }));
})'
```

**分岐表は設計書 §5.3 の 7 行をそのまま指示文へ置く。** 上から順に評価し、最初に当たった行を採る形で書く。書くときの規律は次のとおり。

- 「初期化済み」の判定は **B + C + D の 3 点**とする。**A(ARCHITECTURE)を判定に入れる文を書かない。**
- 行 5 と行 6 は**ユーザーへの確認を伴う**。確認の文言は「ドメイン別の境界を設けずに実行してよいか」の可否 1 点(行 5)と、「修復するか、この run に限り境界なしで進むか」の二択(行 6)にする。
- 行 2(初期化の外形が欠けている)で案内するのは `/codiel:init` であり、**ARCHITECTURE には言及しない**。
- `warnings` の全文提示(`:73-74`)を残す。**これが契約 `:70` で §0 を名指しし続ける根拠である**(設計書 §7.2)。
- 決めたモードは `codiel-state init --domain-mode <値>` で記録する。既存 run の再開時は記録を正とする。

### 5.4 ディスパッチプロンプトの形(T8 が実装。レビュー指摘 2 への回答)

`## 前提` ブロック(`:174-179`)を次の構造にする。**パスを渡して「読め」と指示する形から、値を渡す形へ変える。**

```
## 前提
- ARCHITECTURE: <§0 で解決した絶対パス。読み物として渡す。存在しなければ「なし」>
- GOTCHAS: <§0 で解決した絶対パス。存在しなければ「なし」>
- 実行モード: <mapped | unscoped>
- ドメインマップ: <mapped のときは §0 で読み取った JSON の全文。unscoped のときは「なし」>
- 担当タグ: <このディスパッチで担当するタグ。ドメインに紐づかない役割では「なし」>
```

- **ドメインマップは値で渡す。** サブエージェントに ARCHITECTURE から読み直させない。
- ARCHITECTURE のパスは**読み物として**渡し続ける。設計や論点抽出でシステム概要やレイヤー構造を読むことは禁じない。
- `unscoped` では「ドメインマップ: なし」と明記する。空欄にしない。
- `:178-179` の「ドメインマップ・過去の落とし穴を踏まえて作業してください」は、マップを上の値から取る旨へ書き換える。

### 5.5 ルーティング規則の文面(T7 が実装。T4 / T5 が前提にする)

- ステップのタグ `X` に対し、**`codiel-implementer-X` が自分の利用可能なエージェント一覧にあればそれへ、無ければ `codiel-implementer-generic` へ**ディスパッチする。
- **実在の判定は利用可能なエージェント一覧を見るだけで行う。** プラグインルート・`agents/` ディレクトリ・定義ファイルを探索しない(`initializing-harness/SKILL.md:53-55` が `/metatron:init` に対して取っている判定と同型)。
- reviewer も同型。`codiel-reviewer-doc` / `-security` は常時参加のまま。
- **`set-domain` に渡す値はタグの値そのまま。** 汎用担当へ送るときも `X` を渡す。エージェント名から別名を作らない。
- **`unscoped` では `set-domain` を呼ばない。** ディスパッチ前に `clear-domain` を呼ぶ。
- 固定語彙(`frontend` / `backend` / `data`)を規則の本文に列挙しない。例示として出すときは「例であり固定語彙ではない」と添える。

### 5.6 `CLAUDE.example.md` 規則 5 の反転方針(T12 が実装。レビュー指摘 3 への回答)

現状(`:48-51`)は「気づいたら、その場で ARCHITECTURE を更新する。更新せず気づかないふりをして進めた場合、後で発覚した際に GOTCHAS へ記録される対象になる。」である。

**反転の方針。**

- **「更新する」を「報告する」へ変える。** 乖離に気づいたら、その場で直さず、乖離の内容を報告して所有者による更新へ引き渡す。
- **「黙って進めるのは GOTCHAS 行き」は残す。** 反転するのは対処の手段であって、放置を許す変更ではない。
- 見出し(`:48` の規則名)も「更新する」から「報告する」へ揃える。
- 規則の**本数を 7 のまま**にする(`:11` が「7 項目は DESIGN.md §9 に定義された規則そのまま」と宣言している)。
- 規則 1(`:33-35`)は、ドメインマップの確認を必須の前提から外す。run が渡す前提を使う形にする。

### 5.7 `codiel-reviewer-doc.md` の書き換え方針(T5 が実装。レビュー指摘 4 への回答)

現状 `:25` は「ARCHITECTURE のドメインマップと実装が乖離していないことを確認する。」である。これをそのまま残すと、レビュー所見が「ARCHITECTURE を直せ」という書き込み要求になり、実装担当が更新へ戻る(設計書 §10 のリスク 8)。

**方針。**

- 乖離の**検出**は残す。codiel が乖離に気づける価値は失わない。
- 所見の**出力先**を変える。「修正必須の所見」ではなく「所有者へ引き渡す報告」として出す。
- `:26`(README・API ドキュメント・ARCHITECTURE の更新漏れ)からは ARCHITECTURE を外すか、「更新は所有者が行う」を添える。
- reviewer は元々「コードを修正しない」(`:31`)規律を持つ。その規律と同じ向きに揃える。

### 5.8 どのドメインにも属さないパスの扱い(T9 が実装。レビュー指摘 5 への回答)

`writing-dev-plans/SKILL.md:81-86` は「どの glob にも当たらない共有コードを利用側のドメインへ入れる」と定める。一方 `guard-write.ts:167-174` は glob に一致しない書き込みを `ask` で止める。**タグは付くが glob には一致しないため、`ask` が返る。**

**方針。**

- この `ask` は**正当な合図**である。握り潰さない。
- 止まったときの選択肢を 2 つ書く。
  1. そのパスを担当ドメインの glob に含める変更を、**ARCHITECTURE の所有者へ報告する**。
  2. ステップを再計画し、glob 内に収まる形へ分割する。
- **codiel 自身が ARCHITECTURE を直しに行かない。** これが本改修の趣旨である。
- 固定語彙の優先順位(`data` → `backend` → `frontend`)をやめ、「渡されたマップのキーのうち、依存の起点になるもの」へ一般化する。

### 5.9 登録簿の判定手順(T16 が実装。レビュー指摘 6 への回答)

**推測で増減させない。テストの出力を一次情報にする。**

1. T4〜T15 の文面がすべて確定した状態で、次を実行する。

```
pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts
```

2. **V2 が落ちたら**、出力の `unregistered` 配列がそのまま**追加すべきエントリの一覧**である(`section-reference-inventory.test.ts:143-144` が「落ちたときの出力がそのまま登録簿の候補一覧になる」と明記している)。`path` と `reference` を読み、分類を決めて足す。
   - 分類 **B** = ドメインマップの中身に依存している。
   - 分類 **C** = ディスパッチプロンプトで渡されたパスを読むだけ。
   - 分類 **D** = description・案内文・例示。
   - **分類 A は作らない**(V1 が落ちる)。
3. **V3 が落ちたら**、出力の `stale` 配列がそのまま**削除すべきエントリの一覧**である。
4. 両方が緑になるまで 2 と 3 を繰り返す。

**注意点。**

- **「ドメインマップ」の出現数と登録簿のエントリ数は一致しない。** 登録は `termsIn`(`:93-106`)の 4 パターンで決まる。特に (d) は `ARCHITECTURE[^\n]{0,40}` + 節名 であり、**節名の近く 40 文字以内に `ARCHITECTURE` が無ければ登録対象にならない**。
- 例: `agents/codiel-reviewer-backend.md` は「ドメインマップ」を 2 件持つが、どちらも近傍に `ARCHITECTURE` が無いため分類 B として登録されていない。**T5 でこの 2 件を減らしても登録簿は変わらない。**
- 逆に `commands/init.md:2` は、**1 つの `ARCHITECTURE` トークンから 40 文字以内に「ドメインマップ」「技術スタック」「規約」の 3 語が並んでいる**ため、(d) で 3 件が同時に検出される。登録簿にも 4 エントリ(ドメインマップ B / 技術スタック D / 規約 D / ARCHITECTURE への言及 D)がある。**T13 でこの 1 行を書き換えると 4 エントリすべてが再判定の対象になる。**
- `ARCHITECTURE` の語がファイルから完全に消えたら、`(ARCHITECTURE への言及)` のエントリも消す。語が残るなら残す。

### 5.10 新設する agent 2 体の要件(T4 が実装)

| 項目 | `codiel-implementer-generic` | `codiel-reviewer-generic` |
| --- | --- | --- |
| 担当タグ | **ディスパッチプロンプトで指定されたタグ**のステップのみ。特定のドメイン名をハードコードしない | 指定されたドメインに関わる diff |
| 観点 | `implementing` スキルの手順に従う。ドメイン固有の観点を持たない | 正しさ・不整合・回帰リスクといったドメイン非依存の観点に限る |
| 範囲 | `unscoped` では dev-plan の全ステップ、`mapped` では指定タグの glob 配下 | 同左 |
| ツール | `codiel-implementer-backend.md:4` と同じ | `codiel-reviewer-backend.md:4` と同じ |
| 禁止 | backend / frontend / data の専門観点を名乗らない | 同左 |

---

## 6. 想定される失敗と対策

| # | 失敗 | 該当タスク | 対策 |
| --- | --- | --- | --- |
| **F1** | **`guard-write.test.ts` を「追随」と称して書き換え、hook の挙動の固定が失われる** | **T1 / T3 / T21** | 設計書 §5.7 が**変更しないと決めている**。`git diff` が空であることを T21 で確認する。書き換えが要ると判断したら**実装を止めて報告する** |
| **F2** | **`unreadable` の追加が 3 者比較を壊す** | **T1** | 3 者比較はフィールド単位(`.domains` / `.warnings.length` / `readDomains() !== null`)であり、オブジェクト全体の `toStrictEqual` ではない(設計書 §7.5)。T1 の検証で `check-intent-env.test.ts` を必ず回す |
| F3 | `guard-write.mjs` に差分が出たことを「`src` を誤って変えた」と誤判定する | T3 / T21 | `guard-write.ts` は `lib.ts` を import している(`:11`)ため、バンドル出力は再生成される。**ソースの差分が空であることを見る**(設計書 §6.15) |
| F4 | `validateDomainsValue` を「ついでに整理」して判定が変わる | T1 | 検証 4 項目の判定を変えると 3 実装の契約が割れる(`lib.ts:446-450`)。**触らない** |
| **F5** | **T8 を先にやってしまい、行き先の無いタグで run が通る状態を作る** | **T4〜T8** | 依存関係(§3)で T4〜T7 を T8 の前に置いてある。**順序を崩さない**(設計書 §1 の 6-4 (b)) |
| F6 | T7 と T8 が同じファイルを並列に編集して衝突する | T7 / T8 | 同一ファイルなので**必ず逐次**に行う。担当範囲は T7 = §4 とフェーズ進行表、T8 = §0・§3・§4.1・§6 |
| **F7** | **`unscoped` でも `set-domain` を呼ぶ指示を書き、hook 層と指示層がずれる** | **T8** | `unscoped` では呼ばない(§5.5)。`domain` が空なら `guard-write.ts:136` の `if (domain && ...)` に入らない |
| **F8** | **`domains: null` を一括で generic へ縮退させる指示を書く** | **T8** | 案G と案G＋ を分ける唯一の点である。行 5(正当な不在)と行 6(異常)を必ず別の分岐に保つ(設計書 §5.3) |
| F9 | §0 の判定に A(ARCHITECTURE)を入れてしまう | T8 | 初期化の判定は **B + C + D** である(設計書 §1 の 6-2)。ARCHITECTURE を見る文を書かない |
| **F10** | **§0 から `warnings` の提示を消してしまう** | **T8** | 契約 `:70` が §0 を警告の到達経路として名指しし続ける根拠である。消すと T20 の契約変更の前提が崩れる |
| F11 | planner に ARCHITECTURE を読ませたまま、モードだけ渡す | T8 / T9 / T10 | 三重状態の温床になる。**値で渡す**(§5.4)。既定パスへのフォールバックを消す |
| F12 | 汎用担当に backend の観点を書き写す | T4 | §5.10 の「禁止」行を依頼文へ転記する。`grep` で `API 設計` が 0 件であることを確認する |
| F13 | `codiel-implementer-backend` から backend 専任の記述まで消す | T5 | 消すのは**兼任**の記述だけである。`:15` / `:20` の backend 専任は残す |
| **F14** | **`codiel-reviewer-doc` の乖離検出ごと消してしまう** | **T5** | 検出は残し、**出力先を報告へ変える**(§5.7)。乖離に気づける価値を失わない |
| F15 | `CLAUDE.example.md` の規則の本数を変える | T12 | `:11` が「7 項目」と宣言している。本数を変えるなら `:11` と `docs/DESIGN.md` §9 も同時に直す |
| F16 | `docs/DESIGN.md:385`(hook の表)を「追随」として変える | T12 | hook の挙動を据え置くため、記述は事実のまま正しい。**触らない** |
| F17 | `plugins/codiel/README.md:21`「単体で完結します」を消す | T13 | 本改修は単体完結性を**強める**。残す |
| **F18** | **`projectDocs.domainsReadable` を「もう使わないから」と削除する** | **T14** | 3 者比較(`check-intent-env.test.ts:973-983`)の比較対象である。削除も改名もしない。**判断に使うのをやめるだけ** |
| F19 | `capturing-intent/SKILL.md:81` の任意参照まで消す | T15 | 「必須依存の解消」と「任意参照の全廃」は別である(設計書 §11) |
| **F20** | **登録簿を grep の件数で増減させ、V2 / V3 が落ち続ける** | **T16** | §5.9 の手順に従う。テストの出力(`unregistered` / `stale`)を一次情報にする |
| F21 | `commands/init.md` の description を直して 4 エントリの再判定を忘れる | T13 / T16 | 1 つの `ARCHITECTURE` トークンから 3 語が (d) で検出される(§5.9)。T16 でテストを回せば必ず露見する |
| F22 | `section-reference-inventory.test.ts` を書き換えて通す | T16 | fixtures 側を直す。テストは**変更しない** |
| F23 | metatron のバージョンを据え置く | T17 | **ユーザー判断で `0.3.3-dev` へ上げると決まっている**(設計書 §5.8)。据え置きの根拠は経緯として残っているだけで、結論ではない |
| F24 | `.serena/memories/` を Edit / Write で直接書く | T18 | Serena の `edit_memory` を使う |
| F25 | ADR を `harness-docs/ARCHITECTURE.md` の直接編集で足す | T19 | hook が拒否する。`stage-adr` → `commit-architecture` の 2 段階。CLI の絶対パスは注入か拒否メッセージから取る |
| F26 | `stage-adr` が exit 0 で返ったことを承認と読み替える | T19 | diff を全文提示してユーザーの承認を得てから `commit-architecture` |
| F27 | 契約凍結文書から `orchestrating-runs` の名指しまで消す | T20 | 消すのは `initializing-harness` の手順 5 だけである(設計書 §7.2) |
| F28 | 指示書の文面を `prompt-smith` を起動せずに書く | T5〜T15 | プロジェクト規約である。各タスクの手順に起動を明記してある |

---

## 7. Done 条件チェックリスト

- [ ] `pnpm run lint` が緑。
- [ ] `pnpm run typecheck` が緑。
- [ ] `pnpm run test` が緑。テスト数が baseline(2234 passed)から減っていない。
- [ ] `pnpm run build` を実行し、`plugins/codiel/scripts/` と `plugins/sandalphon/scripts/` の差分が同じコミットにある。手で編集していない。
- [ ] **`plugins/codiel/src/hooks/__test__/guard-write.test.ts` の `git diff` が空。**
- [ ] **`plugins/codiel/src/hooks/guard-write.ts` の `git diff` が空。**
- [ ] **3 者比較テスト(`check-intent-env.test.ts` の 16f 群、`config.test.ts` の R4-a〜R4-f)の `git diff` が空で、かつ通る。**
- [ ] **`plugins/metatron/src/__test__/section-reference-inventory.test.ts` の `git diff` が空で、V1 / V2 / V3 が通る。**
- [ ] `codiel-implementer-generic` と `codiel-reviewer-generic` が存在し、特定ドメインの観点を名乗っていない。
- [ ] `grep -rc '兼ね' plugins/codiel/agents/` が全ファイル 0 件。
- [ ] `grep -c 'ハーネスが未初期化' plugins/codiel/skills/orchestrating-runs/SKILL.md` が 0 件。
- [ ] `orchestrating-runs/SKILL.md` の §0 に分岐表 7 行があり、`unreadable` の 5 値すべてに行き先がある。
- [ ] `orchestrating-runs/SKILL.md` の §0 に `warnings` の提示が残っている。
- [ ] `grep -c 'ドメインマップ' plugins/codiel/skills/initializing-harness/SKILL.md` が 0 件(変更前 4 件)。
- [ ] `grep -n 'readDomainsResult' plugins/codiel/skills/initializing-harness/SKILL.md` が 0 件。
- [ ] `grep -c 'ARCHITECTURE を更新する' plugins/codiel/CLAUDE.example.md` が 0 件(変更前 2 件)。`CLAUDE.example.md` の規則が 7 項目のまま。
- [ ] `grep -rn 'codielReady' plugins/sandalphon/ --include=*.md --include=*.ts`(`scripts/` を除く)が 0 件。
- [ ] `grep -n 'domainsReadable' plugins/sandalphon/skills/capturing-intent/SKILL.md` が 1 件のまま。
- [ ] codiel の `plugin.json` と `package.json` がともに `0.8.0-dev`。
- [ ] sandalphon の `plugin.json` と `package.json` がともに `0.2.0-dev`。
- [ ] **metatron の `plugin.json` と `package.json` がともに `0.3.3-dev`。**
- [ ] ルート `README.md` と `plugins/codiel/README.md` に反映されている。
- [ ] ADR-003 が `stage-adr` → `commit-architecture` で `harness-docs/ARCHITECTURE.md` に入っている。
- [ ] 契約凍結文書 `:70` から `initializing-harness` の名指しが消え、`orchestrating-runs` の名指しが残っている。
- [ ] `.serena/memories/` に `最小 ARCHITECTURE` と `codielReady` が 0 件で、バージョン表記が更新されている。
- [ ] 指示書の文面確定を `prompt-smith:prompt-smith` で、新規 agent の作成を `prompt-smith:agent-creator` で行った。
- [ ] `git status --short` に、baseline に無い本改修以外の差分が無い。

---

## 8. 設計書との食い違い

実装中に設計書と実装の食い違いを見つけたら、実装を止めてオーケストレーターへ報告し、この節へ追記する。

**着手時点では食い違いなし。** 計画作成時に設計書の全 `path:line` を実測と突き合わせ、一致を確認した。

参考として、誤解しやすい点を 1 つ記録する(食い違いではない)。

| # | 箇所 | 誤解しやすい点 | 正しい理解 |
| --- | --- | --- | --- |
| 1 | 設計書 §6.10 の登録簿 12 件の表 | 「ドメインマップ」の grep 件数と登録簿のエントリ数が対応すると読める | 対応しない。登録は `termsIn` の 4 パターン(主に (d) の 40 文字条件)で決まる。`codiel-reviewer-backend.md` は grep で 2 件あるが登録簿には B が無い。判定は §5.9 の手順で行う |

---

## 9. 未解決事項

設計書の §6-1 〜 §6-5 と契約変更とバージョンはすべて確定済みである。残るのは**実装時にしか決まらない 2 件**で、どちらも解決手順が定まっている。

| # | 事項 | 解決手順 |
| --- | --- | --- |
| 1 | **登録簿の最終的な増減**(設計書 §6.10 で「判定が要る」とした 4 ファイル: `codiel-reviewer-doc.md` / `implementing/SKILL.md` / `preparing-design-agendas/SKILL.md` / `writing-design-docs/SKILL.md`) | 文面が確定しないと `termsIn` の検出結果が決まらない。**T16 で §5.9 の手順を実行し、V2 / V3 の出力で決める。** 推測で先に決めない |
| 2 | **新設する agent 2 体を登録簿へ足すかどうか** | 本文が `ARCHITECTURE` に言及するかで決まる。T4 の文面確定後、T16 で同じ手順で判定する |

**判断を要する論点は残っていない。** 上記 2 件はいずれも機械的な手順で解決するため、オーケストレーターへの差し戻しは発生しない見込みである。発生した場合は §8 へ記録して報告する。
