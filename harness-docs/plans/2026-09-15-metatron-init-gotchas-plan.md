# metatron init による GOTCHAS 台帳の生成 実装計画書

- 作成日: 2026-09-15
- 対象プラグイン: `plugins/metatron`(主)、`plugins/codiel`(従)
- バージョン: metatron `0.2.0-dev` → `0.3.0-dev`、codiel `0.6.0-dev` → `0.7.0-dev`
- 設計書(正本): `harness-docs/design/2026-09-15-metatron-init-gotchas-design.md`(**第 3 版**)
- context-map: `.claude/context-maps/2026-09-15-metatron-init-gotchas.md`
- 版注: **第 3 版。** レビュー 2 件の全指摘を反映し、**U2 のユーザー回答(`install-harness.sh` L5 を行ごと削除)**を反映した。U2 はユーザー確認の待ち事項ではなくなり、T13 の通常タスクへ移した(T20 は欠番)。U1 は (a)(b)(c) すべて承認済み。
- **設計書のユーザー承認**: 済(実装着手の依頼を受領。U1 も (a)(b)(c) すべて承認済み)

この計画書は設計書からタスク分割・順序・検証方法だけを立てるものであり、**設計判断を上書きしない**。設計書と実装が食い違う事実を見つけたときは、実装を止めてオーケストレーターへ報告する。報告を受けたオーケストレーターは §8「設計書との食い違い」へ追記し、設計書の修正要否を判断する。

---

## 0. 前提と baseline

### 0.1 オーケストレーターが確定済みの判断(着手時にこれを前提とする)

| # | 事項 | 決定 |
| --- | --- | --- |
| O1 | 網羅検査テスト SC1 / SC2 | **含める。** ただし配置は SC1 = T5、SC2 = T8(§6 F17) |
| O2 | codiel のバージョン | **マイナー(`0.7.0-dev`)** |
| O3 | `CLAUDE.example.md` の ARCHITECTURE 側の非対称 | **本改修では扱わない**(別件のドメインマップ移管と一緒に扱う) |
| O4 | `.serena/memories/file_contract.md` の追随 | 実装時に確認し、§12 の写しがあれば追随する。無ければ変更しない |
| O5 | 本リポジトリ自身で `/metatron:init` を実行して台帳を作るか | **Done 条件に含めない。** 検証手順がこれを既成事実化しないようにする(§0.4) |
| **U1** | 凍結契約 §12 の改訂 | **承認済み。(a)(b)(c) すべて実施する。** 実装者が T19 で適用する |
| **U2** | `install-harness.sh` L5 の GOTCHAS 言及 | **確定済み(ユーザー回答)。行ごと削除する。** 通常の実装タスクへ格下げし T13 で扱う。T20 は欠番(設計書 §6.12) |
| **O6** | `protected-paths.md` へ `install-harness.sh` の例外を明記するか | **既定は「明記する」。** T17 の 1 回の `stage-rules` に同梱する(設計書 §6.12 (3)) |

### 0.2 記入欄(実装セッションが着手時に埋める)

| 項目 | 値 |
| --- | --- |
| 着手時の HEAD(`git rev-parse HEAD`) | `637a81d09679aa97aba39d31e52f2ca235556fdc` |
| `git status --short` の全文 | `M docs/chat/INDEX.md` / `M scripts/setup-workspace.sh` / `?? docs/chat/2026/0915/` / `?? docs/prompts/2026-09-15-codiel-domain-map-decoupling-prompt.md` / `?? harness-docs/design/2026-09-15-metatron-init-gotchas-design.md` / `?? harness-docs/handover/2026-09-15-codiel-domain-map-decoupling-handover.md` / `?? harness-docs/plans/2026-09-15-metatron-init-gotchas-plan.md` |
| `git diff --stat`(unstaged) | `docs/chat/INDEX.md 2 ++` / `scripts/setup-workspace.sh 6 +++---` / `2 files changed, 5 insertions(+), 3 deletions(-)` |
| `git diff --cached --stat`(staged) | 変更なし |
| `git ls-files --others --exclude-standard`(未追跡) | `docs/chat/2026/0915/phyllis998/1041-metatron-gotchas-generation-design.md` / `docs/chat/2026/0915/phyllis998/1041-metatron-init-gotchas-spec.md` / `docs/prompts/2026-09-15-codiel-domain-map-decoupling-prompt.md` / `harness-docs/design/2026-09-15-metatron-init-gotchas-design.md` / `harness-docs/handover/2026-09-15-codiel-domain-map-decoupling-handover.md` / `harness-docs/plans/2026-09-15-metatron-init-gotchas-plan.md` |
| `ls -la harness-docs/GOTCHAS.md`(**存在しないことを確認**) | `No such file or directory` |
| `pnpm run lint` | 緑(4 infos、エラーなし) |
| `pnpm run typecheck` | 緑 |
| `pnpm run test` の Test Files / Tests / Duration | `157 passed / 1 skipped`、`2223 passed / 2 skipped`、`62.36s` |

baseline は `plugins/metatron/` に限定せず**リポジトリ全体**で取る。ルート `package.json` の `build` は `pnpm -r build` で全 workspace を対象にするため。

### 0.3 着手前に確認済みの事実(2026-09-15 時点の実測。実装セッションで再確認する)

- HEAD は `637a81d`。metatron は `0.2.0-dev`、codiel は `0.6.0-dev`。
- `plugins/metatron/build.ts` の entryPoints は 3 本。**新規ファイルを足しても変更は要らない。**
- `harness-docs/GOTCHAS.md` は**存在しない**(git 履歴上も一度も存在していない)。

**触ってはならない未コミット差分。** `docs/chat/INDEX.md`・`scripts/setup-workspace.sh` に差分、`docs/chat/2026/0915/` に未追跡ファイルがある。**本改修と無関係である。触らない。revert もしない。**

### 0.4 【必読】CLI を手で実行するときの隔離(設計書 §10 リスク 9)

**`metatron.mjs` に `--cwd` フラグは無い。** `src/cli/main.ts` L54-56 の `cwd` は既定が `process.cwd()` で、`src/metatron-cli.ts` は `main(process.argv.slice(2))` を呼ぶだけである。したがって**対象文書は必ず「実行時のカレントディレクトリから解決した docRoot」で決まる**。

リポジトリルートで `init-gotchas` を実行すると、ルート `metatron.config.json` L4(`paths.gotchas` = `harness-docs/GOTCHAS.md`)が効いて、**このリポジトリの正本 GOTCHAS 台帳が実際に作られる**。以後 PreToolUse が Write を deny するようになり、O5(台帳を作るかはユーザー判断)が検証の副作用として既成事実化する。

**手で CLI を実行するタスク(T3 / T22)は、必ず次の隔離手順に従う。**

```bash
# 1. 先に「リポジトリ側の絶対パス」を変数へ取る(cd する前に確定させる)
REPO="$(pwd)"
CLI="$REPO/plugins/metatron/scripts/metatron.mjs"

# 2. 空の一時ディレクトリを作って移動する
TMP="$(mktemp -d)"
cd "$TMP"

# 3. 【ガード】docRoot が TMP であることを確認してから先へ進む。
#    ここが TMP でなければ隔離が壊れている。直ちに中止する。
node "$CLI" get config | grep docRoot
```

- **`cd` した後は CLI を必ず絶対パス(`$CLI`)で呼ぶ。** `node plugins/metatron/scripts/metatron.mjs` のようなリポジトリ相対パスは TMP から解決できない。
- **TMP にリポジトリの `metatron.config.json` をコピーしない。** 設定ファイルが無ければ `findDocRoot` は「① 設定ファイルを持つ祖先 → ② `git rev-parse --show-toplevel` → ③ 開始ディレクトリ」の段 3 に落ち、docRoot = TMP になる(`/tmp` は git 管理外)。この結果 GOTCHAS は `<TMP>/docs/GOTCHAS.md` に作られる。
- 各タスクの終了時に `ls harness-docs/GOTCHAS.md` が **No such file** を返すことを確認する。

---

## 1. 進め方の共通規律

- 各タスクは**テストを先に書いてから実装する**。
- `plugins/metatron/scripts/` は手で編集しない。`src/` を変更し `pnpm run build` で再生成する。
- **フェーズの境界では常に緑にする。** 赤が残ってよいのはタスクの内部だけである。
- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md` と `.claude/rules/metatron/*.md` を Edit / Write で触らない。ADR は `stage-adr` → `commit-architecture`、rules は `stage-rules` → `commit-rules` で更新する。
- `.serena/memories/` の変更は Serena の `write_memory` / `edit_memory` で行う。
- ブランチを切らない。`git push` に force 系のフラグを付けない。
- **依頼文の生成規則(委譲するとき必須)。** 次をすべて転記する。
  1. 対象ファイルの**絶対パス**と、そのタスクが書き込んでよいパスの列挙。
  2. 設計書の該当節番号と、**その節の「変更前」「変更後」ブロックの全文**。
  3. §5 の共有契約のうち、そのタスクに必要な小節だけ。
  4. §6 のうち、そのタスクの ID が挙がっている行の全文。
  5. 使用してよい tools、Agent tool の可否、報告形式。
  6. **CLI を手で実行するタスクには §0.4 の全文を転記する。**

### 中間状態の許容範囲

- T2 の完了時点では `main.ts` がまだ `runInitGotchas` を呼ばないため、CLI からは `unknown_subcommand` になる。T3 で解消する。
- T5 の完了時点までに `src/` の変更をすべて入れ終える。**T6(build)までに `scripts/` との食い違いを必ず解消する。** この状態でコミットしない。
- **SC1 は T5、SC2 は T8 に置く**(設計書 §9.4)。T3 が `WRITE_SUBCOMMANDS` を増やした時点で、`USAGE_LINES`(T5)と `cli-usage.md`(T8)が未更新なら SC1 / SC2 は赤になる。だからテストを**更新と同じタスクに置く**。T4 へ前倒ししない。

---

## 2. タスク分割

### フェーズ 0: 準備(直列 1)

#### T0: baseline の取得

- §0.2 の表をすべて埋める。
- 検証: `lint` / `typecheck` / `test` が**着手前に緑**であること。赤があれば本改修に入らず報告する。`harness-docs/GOTCHAS.md` が存在しないことを記録する。

---

### フェーズ 1: metatron 実装層(直列。TDD)

#### T1: `gotchas.ts` に台帳生成を足す

- 対象: `plugins/metatron/src/lib/gotchas.ts`、`plugins/metatron/src/lib/__test__/gotchas.test.ts`
- 設計書: §7.1、§9.1
- 変更:
  1. **先にテストを書く。** 「採番と挿入」節の前へ「台帳の生成」節を作り、GI1〜GI5(§5.3)を書く。この時点で赤。
  2. 冒頭コメント L11-12 を設計書 §7.1 の「変更後」へ差し替える。
  3. `GotchaErrorCode`(L24-28)へ `| "already_exists"` を足す。
  4. `appendGotcha`(L887)の直前へ `InitGotchasResult` と `initGotchasLedger` を新設する(§5.1)。
- 検証: `pnpm exec vitest run plugins/metatron/src/lib/__test__/gotchas.test.ts` が緑。既存の G1 以降が 1 件も落ちない。

#### T2: CLI ハンドラを足す

- 対象: `plugins/metatron/src/cli/gotcha.ts`、`plugins/metatron/src/cli/get.ts`
- 設計書: §7.2、§7.3、§7.9 (b)
- 変更:
  1. `gotcha.ts` の冒頭コメント L1-4 を設計書 §7.2 の「変更後」へ差し替える。
  2. `gotcha.ts` へ `initGotchasLedger` を import し、`runAppendGotcha`(L48)の直前へ `runInitGotchas` を新設する(§5.2)。
  3. `get.ts` の **`GET_TARGETS`(L441-448)へ `"gotchas-template"` を足す。** `unknown_target`(L474-478)がこの配列を案内に使うため、足さないと新対象が案内に載らない。
  4. `get.ts` の `runGet` の switch へ case を足し、`runGetGotchasTemplate` を新設する(§5.4)。**`exists` と `hasContent` を両方返す。**
  5. `get.ts` の **`get config` の `cli` オブジェクト(L115-125)へ 2 行**(`initGotchas` / `getGotchasTemplate`)を足す。ここは手で列挙しているため、足さないと `get config` から新サブコマンドのコマンド行が取れない。
  6. `get.ts` **L294 の `not_created` メッセージ**を設計書 §7.9 (b) の「変更後」へ差し替える。
  7. import に `renderGotchasTemplate`(`../lib/gotchas.js`)と `commandLine`(`./paths.js`)を足す。
- 検証: `pnpm run typecheck` が緑。この時点では CLI 経由で呼べない(T3 で解消)。

#### T3: ディスパッチと層の宣言 + 隔離スモーク

- 対象: `plugins/metatron/src/cli/main.ts`
- 設計書: §7.4
- 変更: 冒頭コメント L5-9 の書き込み経路の列挙へ `init-gotchas` / L18 の import へ `runInitGotchas` / L33-41 `WRITE_SUBCOMMANDS` へ `"init-gotchas"` / L87-121 の switch へ `case "init-gotchas"` を `case "append-gotcha"` の直前に置く。
- **`READ_SUBCOMMANDS`(L31)は変更しない。**
- 検証:
  1. `pnpm run typecheck` が緑。
  2. **隔離スモーク。§0.4 に従う。** ただしこの時点では `scripts/` が未再生成なのでソースから実行する。

```bash
REPO="$(pwd)"
TSX="$REPO/node_modules/.bin/tsx"
ENTRY="$REPO/plugins/metatron/src/metatron-cli.ts"
TMP="$(mktemp -d)"
cd "$TMP"
"$TSX" "$ENTRY" get config | grep docRoot      # ← TMP であることを確認してから次へ
"$TSX" "$ENTRY" get gotchas-template           # ok:true / exists:false / hasContent:false
"$TSX" "$ENTRY" init-gotchas                   # ok:true / created:true
```

  3. **`cd "$REPO" && ls harness-docs/GOTCHAS.md` が No such file を返すこと。**

#### T4: CLI テスト

- 対象: `plugins/metatron/src/cli/__test__/cli.test.ts`
- 設計書: §9.2
- 変更:
  1. `READ_INVOCATIONS`(L197-214)へ `["get", "gotchas-template"]` を足す。
  2. `REJECTIONS`(S6)へ `init-gotchas`(引数なし)を足し `error: "already_exists"` を固定する。S6 は毎ケース `docs/GOTCHAS.md` を書いてから実行し `expectUnchanged` で不変を確認するため、既存の枠組みにそのまま乗る。
  3. 通しテストを 3 本足す(§5.5)。**3 本目は空白ファイルの CLI ケース**である。
- **SC1 / SC2 はここに置かない**(T5 / T8)。
- 検証: `pnpm exec vitest run plugins/metatron/src/cli/__test__/cli.test.ts` が緑。

#### T5: 案内文言(`paths.ts` / `guard-docs.ts`)+ SC1

- 対象: `plugins/metatron/src/cli/paths.ts`、`plugins/metatron/src/guard-docs.ts`、`plugins/metatron/src/__test__/guard-docs.test.ts`、`plugins/metatron/src/cli/__test__/cli.test.ts`
- 設計書: §7.5、§9.3、§9.4
- 変更:
  1. `paths.ts` の `INPUT_SCHEMAS`(L36-63)へ `init-gotchas` を足す(§5.6)。
  2. `paths.ts` の `USAGE_LINES`(L65-88)へ 2 行(読み取り節の `get gotchas` の次に `get gotchas-template`、書き込み節の `append-gotcha` の直前に `init-gotchas`)。
  3. **SC1 を `cli.test.ts` へ足す**(§5.8)。`USAGE_LINES` を更新した同じタスクに置くことで、赤が残らない。
  4. `guard-docs.ts` の `gotchasReason`(L174-183)の `append-gotcha` 案内行(L178)の**直後**へ 2 行を挿入する(§5.7)。
  5. `guard-docs.test.ts` へ 1 ケース(deny の `permissionDecisionReason` に `init-gotchas` と `append-gotcha` の両方が載る)を足す。
- **`src/inject-context.ts` は変更しない**(設計書 §6.11)。`src/__test__/inject-context.test.ts` も無変更。
- 検証: `pnpm run test` が全体で緑。既存の D6(L179)/ D7 / D7b(L216-243)が落ちない。

---

### フェーズ 2: バンドル(直列 1)

#### T6: build

- 変更: `pnpm run build`。
- 検証: `git diff --stat plugins/metatron/scripts/` に差分がある。`scripts/*.mjs` を**手で編集していない**。`pnpm run test` が全体で緑。

---

### フェーズ 3: metatron 指示層・参照層(T7 → T8 / T9 / T10 は並列 3)

#### T7: `capturing-architecture/SKILL.md` の承認フロー

- 対象: `plugins/metatron/skills/capturing-architecture/SKILL.md`
- 設計書: §7.8((1)〜(10) の全文が設計書にある)
- 変更: (1) 手順一覧 L31-38 / (2) 手順 1 の L42 / (3) 終了判定 L48 / (4) 9 単位の表の直後へ 1 行 / (5) 手順 5 の L96 / (6) 手順 6 の L132 と新設小節「GOTCHAS の台帳」/ (7) 手順 7 の末尾 / (8) 手順 8 の L154 / **(9) HARD-GATE L159・L160・L161・L162 と新規 2 行** / **(10) description(L3)とタイトル(L6)**。
- **9 単位の表(L59-71)そのものは変更しない。**
- **「4 対象」は文脈で書き分ける(§5.9)。** L96(stage の対象数)は**残す**。L161(承認の対象数)は **5 へ変える**。
- **L160 と L162 の書き分けは必須。** GOTCHAS の提示には diff が無いため、文字どおり読むと承認ゲートが詰まる。
- 検証(§5.9 の表に従う):
  - `grep -n "4 対象" SKILL.md` → **3 件**(手順 5 と、HARD-GATE L160・L162 の stage 対象を限定する文脈)。
  - `grep -n "5 対象" SKILL.md` → 1 件(HARD-GATE)。
  - `grep -n "合計 5 回" SKILL.md` → 2 件(手順一覧・手順 6)。
  - `grep -n "init-gotchas\|gotchas-template\|hasContent" SKILL.md` が期待どおりの行に出る。
  - L6 のタイトルに `GOTCHAS` が入っている。
  - ドラフト単位の表の行数が **9 のまま**。
  - L154 の「初回生成では作らない」が消えている。

#### T8: 参照層(`cli-usage.md` / `gotchas-format.md`)+ SC2

- 対象: `plugins/metatron/references/cli-usage.md`、`plugins/metatron/references/gotchas-format.md`、`plugins/metatron/src/cli/__test__/cli.test.ts`
- 設計書: §7.6、§7.7、§9.4
- 変更:
  1. `cli-usage.md` のサブコマンド表へ 2 行 / 「書き込み系の入力 JSON」へ `### init-gotchas` を新設 / 「stage から commit の 2 段階」節へ 1 行。
  2. `gotchas-format.md` L14 を 3 行へ差し替える。
  3. **SC2 を `cli.test.ts` へ足す**(§5.8)。`cli-usage.md` を更新した同じタスクに置く。
- 検証: `grep -n "init-gotchas\|gotchas-template" references/cli-usage.md` が 4 箇所以上。`pnpm run test` が緑。

#### T9: `recording-gotchas/SKILL.md`(metatron 側)の近道封じ

- 対象: `plugins/metatron/skills/recording-gotchas/SKILL.md`
- 設計書: §7.9 (a)
- 変更: 手順 2「台帳の現状確認」の `not_created` の行を 3 行へ差し替える。**「記録の途中で `init-gotchas` を呼ばない」の 1 行を必ず含める。**
- 検証: `grep -n "init-gotchas" SKILL.md` が 1 件で、否定形の文であること。

#### T10: metatron の利用者向け文書

- 対象: `plugins/metatron/commands/init.md`、`plugins/metatron/README.md`、`plugins/metatron/docs/format-change-checklist.md`
- 設計書: §7.13
- 変更:
  1. **`commands/init.md` L2 の description** へ、生成物に rules 3 ファイルと GOTCHAS の空の台帳が含まれることを足す(codiel 側だけ直して metatron 側を放置すると非対称が残る)。
  2. `README.md` L25(`/metatron:init` の説明)へ rules 3 ファイルと GOTCHAS の空の台帳。
  3. `README.md` の CLI の表へ 2 行。
  4. **`README.md` L59** の「差分を計算せずに書き込む経路がコマンド体系上存在しません」を、**ARCHITECTURE と rules に主語を限定する**形へ直す(`append-gotcha` の時点で既に偽)。
  5. `format-change-checklist.md` の GOTCHAS 節(L22-25)へ 2 行を足し、**L25 を「エントリ書式の写し(台帳の雛形は持たない)」へ改める**。
- 検証: `grep -n "GOTCHAS" plugins/metatron/commands/init.md` が 1 件以上。`README.md` の CLI の表が 2 行増えている。

---

### フェーズ 4: codiel 側(T11 → T12 / T13 は並列 2)

#### T11: `recording-gotchas/SKILL.md`(codiel 側)の三分岐廃止

- 対象: `plugins/codiel/skills/recording-gotchas/SKILL.md`
- 設計書: §6.6(残す / 削るの表)、§7.10(差し替えの全文)
- 変更:
  1. **手順(L40-47)の 2 項目**を差し替える(§7.10 (a))。**手順 2(L43)** は「台帳が無いときは読むものが無い」を明記。**手順 6(L47)** は「台帳へ追記できたときだけ `git add`。持ち越したときはレポートをコミット」へ分岐させる。
  2. 「書き込み手段」節(L49-62)を §7.10 (b) の全文へ差し替える。**L54 の第 2-3 文(パス推測の禁止)は残す。** 第 1 文(インストール有無を検出しない)だけを削る。
  3. 「エントリの書式」の L66 を 1 行差し替える。
  4. 「台帳が無いとき」節(L97-125)を節ごと削除し、§7.10 (d) の 3 行へ差し替える。**雛形本文を消す。**
  5. 「記録できないとき」節を新設する(§7.10 (e))。**書き先は `.codiel/runs/<runId>/try-<n>/reports/` または `.codiel/reports/`。どちらも `.codiel/` 配下であること。**
  6. Red Flags の L140 / L141 を差し替える。
- 検証:
  - `grep -n "直接追記" SKILL.md` → **0 件**。
  - `grep -n "metatron が無い\|インストール有無" SKILL.md` → **0 件**。
  - `grep -n "推測しない" SKILL.md` → **1 件以上**(パス推測の禁止が残っている)。
  - `grep -n "記録できないとき" SKILL.md` → 1 件以上。
  - `grep -n "^## 運用ルール\|^## 記入テンプレート" SKILL.md` → **0 件**(雛形ブロックが消えている。「`## 失敗パターン一覧` の直下へ挿入」のような**言及**は残ってよい)。
  - `grep -n "runs/<runId>/try-<n>/reports/" SKILL.md` → 1 件。**ルート直下の `runs/` になっていないこと。**

#### T12: `CLAUDE.example.md` の分離

- 対象: `plugins/codiel/CLAUDE.example.md`
- 設計書: §7.11、§6.10
- 変更: L25-27 の 2 つの箇条書きを、ARCHITECTURE 用 1 つと GOTCHAS 用 1 つへ分ける。
- **L31-33(規則 1)と L34-37(規則 2)は変更しない。** 規則 2 を変えない判断の根拠は設計書 §6.10 にある。
- 検証: `grep -n "案内が無ければ直接編集" CLAUDE.example.md` が **1 件**(ARCHITECTURE の側だけ)。「GOTCHAS は直接編集しない」が 1 件。

#### T13: codiel のその他の追随

- 対象: `plugins/codiel/commands/init.md`、`skills/initializing-harness/SKILL.md`、`docs/DESIGN.md`、`README.md`、`src/__test__/install-harness.test.ts`、**`scripts/install-harness.sh`**
- 設計書: §7.12 の表、**§6.12**
- 変更:
  1. 設計書 §7.12 の表のとおり 5 ファイル。`install-harness.test.ts` は**テスト名のみ**変更し、アサーションを変えない。
  2. **`scripts/install-harness.sh` の L5 を行ごと削除する**(§5.11 の差分契約)。文面を差し替えない。**L2・L3-4・L6 のコメントと L7 以降の本体は一切変更しない。**
- **このファイルはバンドル出力ではない**(`plugins/codiel/build.ts` の entryPoints に無い)。`pnpm run build` では再生成されないので、**手で削除するのが正しい**。`src/` を探して直そうとしない。
- 検証:
  - **`grep -n "GOTCHAS" plugins/codiel/scripts/install-harness.sh` が 0 件。**
  - `wc -l plugins/codiel/scripts/install-harness.sh` が **12**(13 → 12)。
  - `git diff plugins/codiel/scripts/install-harness.sh` が **1 行削除のみ**(追加行が無い)。
  - `bash plugins/codiel/scripts/install-harness.sh <一時ディレクトリ>` が成功し `.codiel/{specs,runs,reports}` を作る。
  - `pnpm exec vitest run plugins/codiel/src/__test__/install-harness.test.ts` が緑(4 ケースすべて)。
  - `grep -rn "台帳ごと作" plugins/codiel/` が 3 件。`docs/DESIGN.md` に 1 件、`skills/recording-gotchas/SKILL.md` に 2 件で、いずれも `append-gotcha` が主語。他のファイルには出ない。

---

### フェーズ 5: 共通文書とバージョン(並列 2)

#### T14: ルート README

- 対象: `README.md`(L132)
- 変更: `/metatron:init` が ARCHITECTURE と rules 3 ファイルと GOTCHAS の空の台帳を生成することを明記する。

#### T15: バージョン

- 対象: `plugins/metatron/.claude-plugin/plugin.json`、`plugins/metatron/package.json`、`plugins/codiel/.claude-plugin/plugin.json`、`plugins/codiel/package.json`
- 変更: metatron を `0.3.0-dev`、codiel を `0.7.0-dev`(O2 で確定)。
- 検証: 4 ファイルの `version` が 2 組で一致する。

---

### フェーズ 6: 保護対象への書き込みとメモリ(T16 / T17 / T18 は並列 3)

#### T16: ADR-002 の起票(**オーケストレーターが実施**)

- 対象: `harness-docs/ARCHITECTURE.md`(**CLI 経由のみ**)
- 設計書: §6.8 の表
- 手順:
  1. §6.8 の表の内容を `{ mode: "add", title, status, decidedOn, decidedBy, background, options, conclusion, rationale, impact }` の JSON にして一時ファイルへ Write する。`title` は `[metatron] GOTCHAS の台帳は init が承認を得て生成する`。
  2. `stage-adr --input <一時ファイル>` を実行する。
  3. 返った `diff.unified` を**全文提示してユーザーの承認を得る**。`stage-adr` が exit 0 で返ったことを承認と読み替えない。
  4. 承認後に `commit-architecture --staging-id <id>` を実行する。
- **CLI の絶対パスは注入の案内か hook の拒否メッセージから取る。推測しない。**
- **`/metatron:update` は実行しない**(ディレクトリ構成・コマンド定義・技術スタック・ドメインマップに影響が無い)。
- 検証: `grep -n "ADR-002" harness-docs/ARCHITECTURE.md` が 1 件。`get adr --id ADR-002` が `ok: true`。

#### T17: `protected-paths.md` の追随(**オーケストレーターが実施**)

- 対象: `.claude/rules/metatron/protected-paths.md`(**CLI 経由のみ**)
- 設計書: §7.13、**§6.12 (3)**
- **2 箇所を 1 回の `stage-rules` → `commit-rules` でまとめて直す。** `stage-rules` の `body` はファイル全文なので(`references/cli-usage.md` L92-103)、同一ファイル内の変更箇所数に制限は無い。分けると同じファイルに対して stage → 承認 → commit を 2 周することになり、得るものが無い。
- 手順:
  1. `get rules --name protected-paths` で現在の全文を取る。
  2. 次の 2 箇所を反映した全文を組み立てる。**`# 見出し` と管理者表示行を含む完全なファイル内容**にする。
     - **① L7(必須)**: GOTCHAS の更新手段の列挙へ `init-gotchas` を足す。
     - **② 「触らないパス」の `plugins/*/scripts/` の項(O6。既定は実施)**: `install-harness.sh` が手書きで `src/` の対応物を持たない例外を明記する(§5.13 に追記案の全文)。
  3. `stage-rules --input <一時ファイル>` → diff を全文提示して承認 → `commit-rules --staging-id <id>`。
- このファイルは Claude Code の rules 機構で**毎セッション読まれる**。書き込み経路が 3 本になった後も 2 本のままだと、規律文書が実装と食い違う。②を入れないと、T13 で `scripts/` を手編集する判断が毎回迷いを生む。
- 検証: `grep -n "init-gotchas" .claude/rules/metatron/protected-paths.md` が 1 件。O6 を実施したなら `grep -n "install-harness.sh" .claude/rules/metatron/protected-paths.md` が 1 件。

#### T18: Serena メモリの追随

- 対象: `.serena/memories/metatron/core.md`、`.serena/memories/codiel/core.md`、(O4 次第で)`.serena/memories/file_contract.md`
- 設計書: §7.13
- 変更: Serena の `edit_memory` で行う。Edit / Write ツールで直接書かない。
  - `metatron/core.md`: `/metatron:init` の説明へ GOTCHAS の生成を足す。冒頭のバージョン表記 `0.1.6-dev` → `0.3.0-dev`。
  - `codiel/core.md`: **L1 のバージョン `0.5.2-dev` → `0.7.0-dev`**(現状は実体 0.6.0-dev からも遅れている)。L16-21 の `install-harness.sh` の行と `recording-gotchas` の三分岐の記述を CLI 専用の 2 状態へ書き換える。
  - O4: `file_contract.md` に §12 の写し(サブコマンド一覧・ロック表)があるか `read_memory` で確認し、あれば追随する。
- **T16 に依存しない。** メモリ本文は ADR-002 を必須としないため並列でよい。
- 検証: `grep -rn "案内が無ければ直接追記\|三分岐" .serena/memories/` が 0 件。

---

### フェーズ 7: 承認済みの凍結契約改訂

U1 は (a)(b)(c) すべて承認済み。T19 で適用する。

#### T19: U1 —— 凍結契約の改訂

- 対象: `harness-docs/design/2026-08-16-file-contract-freeze.md` §12(L676-751)、§7-3(L448-454)
- 設計書: §6.7 (2)、§12-1 U1
- 承認済みの 3 点をすべて適用する。
  - (a) §12 サブコマンド網羅表(L683-698)へ `get gotchas-template` と `init-gotchas` を追加。
  - (b) §12 ロック表 L748 へ `init-gotchas` を追加。
  - (c) §7-3(L453-454)へ生成経路の明確化を 1 行追記。
- 検証: `grep -n "init-gotchas" harness-docs/design/2026-08-16-file-contract-freeze.md` が 3 件以上(§7-3 1 + サブコマンド表 1 + ロック表 1)。

#### T20: 欠番

U2 はユーザー回答により確定した(`install-harness.sh` L5 を行ごと削除する)。ユーザーへ問うステップが不要になったため、**作業は T13 へ統合した**。

**番号は欠番のまま残す。** 第 2 版までの議論が T21 / T22 / T23 を参照しており、繰り上げると過去のやり取りとの対応が崩れるためである。

---

### フェーズ 8: 統合検証(直列。T21 → T22 → T23)

#### T21: 全体のビルドと検査

- 手順: `pnpm run build` → `pnpm run lint` → `pnpm run typecheck` → `pnpm run test`。
- 検証:
  - 4 つすべてが緑。
  - **`plugins/metatron/scripts/` の差分は build 由来のものだけである**(手編集が無い)。
  - **`plugins/codiel/scripts/` には `install-harness.sh` の 1 行削除の差分が出る**(U2 の確定事項。T13)。これが**唯一の**差分であること。他のファイル(`lib.mjs` / `guard-write.mjs` / `codiel-state.mjs` / `guard-bash.mjs` / `stop-guard.mjs` / `subagent-stop.mjs`)に差分が出ていたら、`plugins/codiel/src/` を意図せず変更している。**「codiel の scripts に差分が無いこと」を合格条件にしない**(差分が出るのが正しい)。

#### T22: 実機の通し確認(**§0.4 の隔離を必ず守る**)

```bash
REPO="$(pwd)"
CLI="$REPO/plugins/metatron/scripts/metatron.mjs"
TMP="$(mktemp -d)"
cd "$TMP"
node "$CLI" get config | grep docRoot     # ← ガード。TMP でなければ中止
```

| # | コマンド | 期待 |
| --- | --- | --- |
| 1 | `node "$CLI" get gotchas-template` | exit 0。`ok: true` / `exists: false` / `hasContent: false` / `template` に 4 節 / `next` に `init-gotchas` のコマンド行 |
| 2 | `node "$CLI" init-gotchas` | exit 0。`ok: true` / `created: true`。`<TMP>/docs/GOTCHAS.md` が作られる |
| 3 | `node "$CLI" init-gotchas`(2 回目) | **非 0 終了**。`error: "already_exists"`。ファイルがバイト単位で不変 |
| 4 | `node "$CLI" get gotchas` | `ok: true` / `total: 0` / `entries: []`(**`not_created` ではない**) |
| 5 | `node "$CLI" append-gotcha --input "$TMP/gotcha.json"` | `created: false` / `id: "GOTCHA-001"` |
| 6 | `node "$CLI" get gotchas-template`(追記後) | `exists: true` / `hasContent: true` / `next: null` |
| 7 | `node "$CLI"`(引数なし) | usage に `get gotchas-template` と `init-gotchas` の 2 行が載っている |
| 8 | 空白ファイルの確認: `printf '   \n\n' > "$TMP/docs/GOTCHAS.md"` の後 `get gotchas-template` | `exists: true` / `hasContent: false`。続けて `init-gotchas` が成功して雛形になる |

**#5 の入力 JSON は Write ツールで `$TMP/gotcha.json` へ書く**(ヒアドキュメントで渡さない。`cli-usage.md` L43-45 の呼び出し規約)。内容:

```json
{ "title": "検証用", "task": "t", "mistake": "m", "cause": "c", "countermeasure": "実装前に node_modules の型定義を Read して確認する", "promotionCandidate": "No" }
```

- **終了時に `cd "$REPO" && ls harness-docs/GOTCHAS.md` が No such file を返すこと。**

#### T23: 最終確認

- `git status --short` を baseline と突き合わせ、**baseline に無い新規差分がすべて本改修のものである**ことを確認する。`docs/chat/` と `scripts/setup-workspace.sh` の既存差分が変わっていないこと。
- **`harness-docs/GOTCHAS.md` が存在しないこと**(O5。検証の副作用で作られていない)。
- §7 の Done 条件をすべて埋める。
- コミットする(ユーザーの指示があるときのみ)。

---

## 3. 依存関係

```
T0
 └→ T1 → T2 → T3 → T4 → T5 → T6(build)
                                 ├→ T7 → (T8 ∥ T9 ∥ T10)
                                 ├→ T11 → (T12 ∥ T13)
                                 ├→ (T14 ∥ T15)
                                 └→ (T16 ∥ T17 ∥ T18)

T19  ← 承認済み U1(a)(b)(c) を適用。他をブロックしない
(T20 は欠番。U2 は確定したため T13 へ統合)
                                                  └→ T21 → T22 → T23
```

- **T1 → T2 → T3 は厳密に直列。** 型が順に依存する。
- **T4 は T3 の後。** CLI テストは `main.ts` のディスパッチが入って初めて通る。
- **SC1 は T5、SC2 は T8。** T4 へ前倒しすると、依存先(`USAGE_LINES` / `cli-usage.md`)が未更新のため赤のまま残り、「フェーズ境界は緑」の規律に反する。
- **T6(build)は T5 までの `src/` 変更をすべて含んでから行う。**
- **T7 は T8 / T9 / T10 より先。** SKILL.md が参照層の書き方を決める。
- **T16 / T17 / T18 は並列でよい。** メモリ本文は ADR-002 を必須としない。
- **T19(U1)は承認済みの (a)(b)(c) を適用する。** 凍結契約の改訂は `src/` とテストに影響しないため T21 を回し直す必要は無い。
- **T20 は欠番。** U2 は確定したため T13(フェーズ 4)へ統合した。T13 は T21 より前にあるので、`install-harness.sh` の削除は T21 の検査に自然に含まれる。

---

## 4. 委譲先

| タスク | 役割 | 備考 |
| --- | --- | --- |
| T1〜T6 | 複雑または重要な実装 | 型の追加と CLI の層の判断を含む。設計書 §7.1〜§7.5 の全文を転記する。**T3 には §0.4 の全文を転記する** |
| T7 | 通常の実装 | 変更が 10 箇所に散る。設計書 §7.8 の (1)〜(10) を漏らさず転記し、§5.9 の「4 対象」の書き分け表も渡す |
| T8〜T15 | 通常の実装 | 文書の書き換え。並列可 |
| **T16 / T17** | **オーケストレーター本体** | stage の diff に対するユーザー承認を挟むため**委譲しない** |
| **T19** | 通常の実装 | U1 (a)(b)(c) は承認済み。T20 は欠番 |
| T18 | 通常の実装 | Serena の `edit_memory` を使う |
| T21 / T22 | 通常の実装 | **T22 には §0.4 の全文を転記する** |
| T23 | オーケストレーター本体 | 最終確認は委譲しない |

読み取りだけの確認を `Write` / `Edit` を持つ定義へ委譲するときは、依頼文に「使用してよい tools を読み取り系に限定すること」「ファイルを変更しないこと」「報告のみを返すこと」を明記する。

---

## 5. タスク間で共有する契約

### 5.1 `initGotchasLedger` の全文(T1 が実装。T2 が呼ぶ)

```ts
export interface InitGotchasResult {
  path: string
  created: boolean
  bytesWritten: number
}

/**
 * 雛形だけの台帳を新規作成する(設計書 2026-09-15 §6.2・§6.3)。
 *
 * 内容のある台帳があるときは `already_exists` を投げ、1 バイトも書かない。
 * 固定文字列を書くサブコマンドなので、この拒否がエントリ保護の唯一の担保である。
 * 空白のみのファイルを「内容なし」と扱うのは buildAppendedText と同じ判定である。
 */
export function initGotchasLedger(gotchasPath: string): InitGotchasResult {
  return withFileLock(gotchasPath, () => {
    const existing = readTextIfExists(gotchasPath)
    if (existing !== null && existing.trim() !== "") {
      throw new GotchaError(
        "already_exists",
        `${gotchasPath} は既に存在します。既存の台帳を上書きしません。エントリの追記は append-gotcha を使ってください。`
      )
    }
    const text = renderGotchasTemplate()
    fs.mkdirSync(path.dirname(gotchasPath), { recursive: true })
    fs.writeFileSync(gotchasPath, text)
    return {
      path: gotchasPath,
      created: true,
      bytesWritten: Buffer.byteLength(text)
    }
  })
}
```

`readTextIfExists` は `gotchas.ts` 内の非公開関数(`appendGotcha` L904 が使用)。新たに export しない。

### 5.2 `runInitGotchas` の全文(T2 が実装。T3 が呼ぶ)

```ts
export function runInitGotchas(ctx: GotchaContext): void {
  const command = "init-gotchas"
  const config = loadConfig(ctx.cwd)
  try {
    const result = initGotchasLedger(config.gotchasPath)
    noteWarnings(config.warnings)
    emitResult(command, {
      ok: true,
      written: true,
      created: result.created,
      path: result.path,
      relative: config.gotchasRelative,
      bytesWritten: result.bytesWritten,
      warnings: config.warnings
    })
  } catch (error) {
    failFromError(command, error, {
      written: false,
      path: config.gotchasPath
    })
  }
}
```

`failFromError`(`gotcha.ts` L29-42)が `GotchaError.code` をそのまま `error` に載せるため、`already_exists` と `lock_timeout` はどちらも exit 1 で返る。**`loadInputJson` を呼ばない。**

### 5.3 GI1〜GI5 の期待値(T1 が書く)

| ID | 前提 | 期待 |
| --- | --- | --- |
| GI1 | 台帳も親ディレクトリも無い | `created: true`。4 節(`# GOTCHAS` / `## 運用ルール` / `## 記入テンプレート` / `## 失敗パターン一覧`)が含まれる。`parseGotchas(text).entries` が **0 件**。親ディレクトリが作られる |
| GI2 | 内容のある台帳がある | `GotchaError` が投げられ `code === "already_exists"`。**`readFileSync` の Buffer が呼び出し前後で等しい** |
| GI3 | 空白のみ(`"   \n\n"`)の台帳がある | 雛形で作り直され `created: true` |
| GI4 | GI1 の直後に `appendGotcha` | `result.created === false`、`result.id === "GOTCHA-001"` |
| GI5 | ― | `renderGotchasTemplate()` の戻り値と GI1 で書かれたファイルの内容が**文字列として一致** |

### 5.4 `runGetGotchasTemplate` の全文(T2 が実装)

```ts
export function runGetGotchasTemplate(ctx: GetContext): void {
  const command = "get gotchas-template"
  const config = configOf(ctx.cwd)
  const file = readDocument(config.gotchasPath)
  const hasContent = file.exists && file.text.trim() !== ""
  const warnings = [...config.warnings, ...file.warnings]
  noteWarnings(warnings)
  emitResult(command, {
    ok: true,
    path: config.gotchasPath,
    relative: config.gotchasRelative,
    exists: file.exists,
    hasContent,
    template: renderGotchasTemplate(),
    next: hasContent ? null : commandLine("init-gotchas"),
    warnings
  })
}
```

**`exists` と `hasContent` を両方返すこと。** `readDocument`(`input.ts` L95-114)は空ファイルでも `exists: true` を返す。`exists` だけで分岐すると、空の `GOTCHAS.md` があるときにスキルは「既にある」と判断してスキップするのに、注入(`inject-context.ts` L153-162)は `trim() === ""` で「無い」側に倒れ続ける(設計書 §6.1)。

### 5.5 T4 が足す通しテスト 3 本

1. **「`get gotchas-template` → `init-gotchas` で台帳が作られ、再実行は `already_exists`」**
   - 作成前: exit 0 / `ok: true` / `exists: false` / `hasContent: false` / `next` が非 null。
   - `init-gotchas` が exit 0 / `created: true`。
   - 作成後: `exists: true` / `hasContent: true` / `next: null`。`template` とファイル内容が一致。
   - 2 回目の `init-gotchas` が**非 0** / `already_exists`。`expectUnchanged` でファイル不変。
2. **「台帳が無い状態でも `get gotchas-template` は `ok: true`」**(空ディレクトリ)。
3. **「空白のみの `GOTCHAS.md` があるとき `exists: true` / `hasContent: false` を返し、`init-gotchas` が雛形で作り直す」。** GI3 は lib 単体の検証であり、CLI 経由で 2 つのフラグが食い違う挙動は別に固定する。

### 5.6 `INPUT_SCHEMAS` へ足すエントリ(T5)

`tag-gotcha`(L59-62)の直前へ置く。`--input` を取らないサブコマンドを `usage` キーで載せる先例は `tag-gotcha` である。

```ts
  "init-gotchas": {
    usage: "init-gotchas",
    note: "入力を取らない。雛形だけの台帳を新規作成する。内容のある台帳があるときは already_exists で拒否する。実行の前にユーザーの承認を得ること。"
  },
```

### 5.7 `gotchasReason` へ足す 2 行(T5)

`append-gotcha` の案内行(L178)の**直後**へ挿入する。

```ts
    "台帳がまだ無いときは、ユーザーの承認を得てから新規作成してください:",
    `  node ${cli} init-gotchas`,
```

存在判定を入れない(hook はフェイルオープンであり、案内の分岐のために I/O を増やさない)。

### 5.8 SC1 / SC2(O1 = 含める)

| ID | 内容 | 置くタスク |
| --- | --- | --- |
| SC1 | `READ_SUBCOMMANDS` と `WRITE_SUBCOMMANDS` の全要素が `USAGE_LINES` のいずれかの行に部分文字列として現れる | **T5**(`USAGE_LINES` を更新するタスク) |
| SC2 | `WRITE_SUBCOMMANDS` の全要素が `plugins/metatron/references/cli-usage.md` の本文に現れる。読み込みは `import.meta.dirname` からの相対で行う | **T8**(`cli-usage.md` を更新するタスク) |

SC2 はリポジトリ内の相対パスを読むため、`section-reference-inventory.test.ts` と同じく「配布物に含まれないテスト」として扱う。

### 5.9 「4 対象」の書き分け(T7 が共有。検証もこれに従う)

| 箇所 | 意味 | 扱い | 改修後の文言 |
| --- | --- | --- | --- |
| SKILL.md L96(手順 5) | **stage を発行する対象の数**。GOTCHAS は stage を持たない | **4 のまま残す** | 「4 対象分の stage をまとめて先に発行しない。」 |
| SKILL.md L160(HARD-GATE) | 全文提示する材料の書き分け | **stage 対象を 4 と明記する** | 「stage を経る 4 対象は `diff` の全文を、GOTCHAS は…」 |
| SKILL.md L161(HARD-GATE) | **承認を得る対象の数**。GOTCHAS を含む | **5 へ変える** | 「5 対象を 1 回の承認でまとめない。」 |
| SKILL.md L162(HARD-GATE) | `diff.truncated` 判定の適用範囲 | **stage 対象を 4 と明記する** | 「stage を経る 4 対象で `diff.truncated` が…」 |

**したがって `grep -n "4 対象"` は 3 件である。** 手順 5 の 1 件と、HARD-GATE で stage 対象へ限定する 2 件を確認する。

### 5.10 U1 でユーザーへ問う内容(T19。オーケストレーターが使う)

> `harness-docs/design/2026-08-16-file-contract-freeze.md` は冒頭 L18 で「本書の内容を変更する必要が生じたときは、実装を止めてユーザーに確認する」と定めています。本改修で 3 点の確認をお願いします。
>
> **(a) 必須 —— §12 のサブコマンド網羅表(L683-698)へ 2 行追加。**
> `init-gotchas` と `get gotchas-template` を新設するため、現在 15 行の表が網羅でなくなります。`plugins/metatron/src/cli/__test__/cli.test.ts` L1 はこのテスト群を「契約 §12 の検証」と自己定義しており、表と実装の乖離は契約の破れにあたります。
> L689(`get rules`)の直後へ: `| \`get gotchas-template\` | 読 |`
> L697(`append-gotcha`)の直前へ: `| \`init-gotchas\` | 書 |`
>
> **(b) 必須 —— §12 のロック表(L746-749)の L748 を差し替え。**
> 新設する `initGotchasLedger` は `withFileLock`(`gotchas.ts` L809)を使うため、`<gotchas パス>.lock` の取得者が 3 つになります。
> 変更前: `| \`<gotchas パス>.lock\` | \`append-gotcha\` / \`tag-gotcha\` |`
> 変更後: `| \`<gotchas パス>.lock\` | \`init-gotchas\` / \`append-gotcha\` / \`tag-gotcha\` |`
>
> **(c) 任意 —— §7-3(L453-454)への明確化 1 行追記。**
> §7-3 は「挿入位置と採番」の配下にあり、生成主体を限定していないため**改訂は不要**と判定しました。ただし経路が 2 つになったことを明記すると誤読を防げます。規則は変えません。
> 追記案: `- 台帳の新規作成は \`/metatron:init\`(\`init-gotchas\`)と、台帳が無い状態での挿入(\`append-gotcha\`)の 2 経路で起きる。いずれも同じ雛形を書く。内容のある台帳に対する新規作成は拒否する。`
>
> **(a) と (b) が承認されない場合**、契約と実装の乖離が残ります。その場合は適用せず、乖離を Done 条件の未達として記録します。**(c)** は承認されなければ追記しません(本改修は成立します)。

### 5.11 `install-harness.sh` の削除の差分契約(T13 が使う。U2 の確定内容)

**削除するのは L5 の 1 行だけである。** 変更前(全 13 行のうち L1-L7):

```bash
#!/usr/bin/env bash
# 対象プロジェクトに Codiel ハーネスの機械的資産(.codiel/ ディレクトリ)を配置する。
# ARCHITECTURE / CLAUDE.md / raguel.config.yaml は initializing-harness スキル(/codiel:init)が
# 生成するため、このスクリプトでは扱わない。
# GOTCHAS は失敗を記録する時点で recording-gotchas スキルが台帳ごと作成するため、ここでは配置しない。
# 使い方: bash <plugin-root>/scripts/install-harness.sh [対象プロジェクトルート(既定: カレント)]
set -euo pipefail
```

変更後:

```bash
#!/usr/bin/env bash
# 対象プロジェクトに Codiel ハーネスの機械的資産(.codiel/ ディレクトリ)を配置する。
# ARCHITECTURE / CLAUDE.md / raguel.config.yaml は initializing-harness スキル(/codiel:init)が
# 生成するため、このスクリプトでは扱わない。
# 使い方: bash <plugin-root>/scripts/install-harness.sh [対象プロジェクトルート(既定: カレント)]
set -euo pipefail
```

- **L3-4 は 2 行にまたがる 1 文である。** 主語は「ARCHITECTURE / CLAUDE.md / raguel.config.yaml」であり、L5(主語は GOTCHAS)とは別の文である。**L3-4 を巻き込んで消さない。**
- L5 はコメント行なので、削除しても構文とスクリプトの意味は変わらない。
- 置換ではなく**削除**である。代わりの行を入れない。
- 結果として、このファイルから `GOTCHAS` の語が消える。

### 5.12 codiel 側で「残す」記述(T11 が誤って削らないための一覧)

| 箇所 | 残す理由 |
| --- | --- |
| L14-18(台帳のパス解決。`node -e` + `resolveDocPaths`) | **codiel 自身の同梱スクリプトであり metatron の CLI を必要としない。** CLI の案内が無い環境でも動く |
| L54 第 2-3 文(パスを推測しない / 使ってよいパスは案内と拒否メッセージのものだけ) | パス推測の禁止は三分岐と独立に必要 |
| L64-95(エントリの書式・タグの規則) | `append-gotcha` の入力と「記録できないとき」の報告の両方で使う |
| L20-27(記録の契機と担当の表) | 変更しない |
| L29-38(記録の判断) | 変更しない |
| Red Flags の L136-139(4 行) | 変更しない |
| HARD-GATE(L127-130) | 変更しない |

### 5.13 `protected-paths.md` の 2 箇所の変更(T17 が使う)

**① L7(必須)。** GOTCHAS の更新手段の列挙へ `init-gotchas` を足す。

変更前(該当部分):

> ARCHITECTURE の更新は `stage-architecture` → `commit-architecture`、ADR は `stage-adr` → `commit-architecture`、GOTCHAS の追記は `append-gotcha`、タグ付けは `tag-gotcha` を使う。

変更後:

> ARCHITECTURE の更新は `stage-architecture` → `commit-architecture`、ADR は `stage-adr` → `commit-architecture`、**GOTCHAS の台帳の新規作成は `init-gotchas`**、追記は `append-gotcha`、タグ付けは `tag-gotcha` を使う。

**② 「触らないパス」の `plugins/*/scripts/` の項(O6。既定は実施)。**

変更前:

> - `plugins/*/scripts/` と `plugins/*/dist/` — バンドル出力。対応する `src/` を変更し、`pnpm run build` で再生成する。

変更後:

> - `plugins/*/scripts/` と `plugins/*/dist/` — バンドル出力。対応する `src/` を変更し、`pnpm run build` で再生成する。**例外は `plugins/codiel/scripts/install-harness.sh` で、これは手書きのシェルスクリプトであり `src/` の対応物を持たない。直接編集してよい。**

②を入れる理由: T13 が `install-harness.sh` を手編集するが、規則の文言(「`plugins/*/scripts/` はすべてバンドル出力」)は事実と合っていない(`plugins/codiel/build.ts` の entryPoints は 6 つで `install-harness` を含まない)。明記しないと、実装者が「保護パスだから触れない」と判断して削除を見送るか、規則を破った自覚のないまま編集することになる。

---

## 6. 想定される失敗と対策

| # | 失敗 | 該当タスク | 対策 |
| --- | --- | --- | --- |
| **F1** | **検証手順がリポジトリ自身の `harness-docs/GOTCHAS.md` を作ってしまう。以後 PreToolUse が Write を deny する** | **T3 / T22** | **§0.4 の隔離を守る。** `cd "$TMP"` した後は CLI を絶対パスで呼ぶ。TMP に `metatron.config.json` を置かない。実行前に `get config` で docRoot が TMP であることを確認する。各タスクの終了時に `ls harness-docs/GOTCHAS.md` が No such file を返すことを確認する |
| F2 | `init-gotchas` が既存の台帳を上書きし、エントリが消える | T1 / T2 | GI2 を**先に**書く。Buffer 比較で不変を固定する。存在判定を `withFileLock` の**内側**に置く(外側だと TOCTOU が開く) |
| F3 | 空白のみのファイルの扱いが `appendGotcha` とずれる | T1 | `existing !== null && existing.trim() !== ""` の形を `buildAppendedText` L617 の判定に**揃える**。GI3 が固定する |
| **F4** | **`get gotchas-template` が `exists` だけを返し、スキルが空ファイルで誤ってスキップする** | **T2 / T7** | **`exists` と `hasContent` を両方返し、スキルの分岐は `hasContent` で行う**(§5.4)。CLI 通しテスト 3 本目が固定する |
| F5 | `gotchas-template` を `READ_SUBCOMMANDS` に足してしまう | T3 | `gotchas-template` は `get` の**対象**である。足すのは `GET_TARGETS`(`get.ts` L441-448) |
| F6 | `GET_TARGETS` を更新せず、`unknown_target` の案内に新対象が載らない | T2 | 案内(L474-478)は `GET_TARGETS` を `join` して出す。配列に足す |
| F7 | `get config` の `cli` オブジェクトを更新し忘れる | T2 | `inputSchemas` は `INPUT_SCHEMAS` 参照なので自動だが、`cli`(L115-125)は**手で列挙している**。2 行足す |
| F8 | `get gotchas-template` を `ok: false` で返してしまう | T2 | 台帳の有無は読み取り層にとって異常ではない。`ok` は常に `true` |
| F9 | `inject-context.ts` を「追随」と称して変更し、テストの全文一致が落ちる | T5 | 設計書 §6.11 が**変更しない**と決めている。触らない |
| F10 | 9 単位の表へ GOTCHAS を 10 行目として足す | T7 | 表は起草と対話確認の粒度。表の**直後の 1 行**で所在だけ示す |
| **F11** | **HARD-GATE L160 を直さず、GOTCHAS にも diff の全文提示が要ると読めてしまい承認が詰まる** | **T7** | L160 を「書き込む内容を全文提示」へ一般化し、stage を経る 4 対象は diff、GOTCHAS は `template` と書き分ける。L162 にも「stage を経る 4 対象で」の限定を足す |
| **F12** | **`grep "4 対象"` の件数を誤り、必要な限定文を消す** | **T7** | §5.9 の表に従う。**3 件**(手順 5 と HARD-GATE の 2 件)を確認する |
| F13 | codiel の SKILL.md から雛形を消すときに、エントリ書式まで一緒に消す | T11 | §5.12 の「残す」一覧を依頼文へ転記する。消すのは L97-125 の**節**であってエントリ書式(L64-95)ではない |
| **F14** | **「記録できないとき」の書き先をルート直下の `runs/<runId>/reports/` と書いてしまう** | **T11** | 実レイアウトは `.codiel/runs/<runId>/try-<n>/reports/`(`codiel/docs/DESIGN.md` L160-171)。`guard-write.ts` L135-136 の免除は `.codiel/` の前方一致であり、`.codiel/` の外は `domain` 設定中に `ask` へ倒れて **run が止まる** |
| F15 | 手順 6 の `git add` を分岐させず、台帳が無いのに add しようとする | T11 | 台帳へ書けたときだけ台帳を add する。持ち越したときはレポートを add する |
| F16 | `CLAUDE.example.md` で ARCHITECTURE 側まで CLI 専用にしてしまう | T12 | 要件が「GOTCHAS に関する三分岐だけを削る」と定めている。「案内が無ければ直接編集」が **1 件残る**ことを確認する |
| **F17** | **SC1 / SC2 を T4 へ置き、依存先が未更新のまま赤が残る** | **T4 / T5 / T8** | SC1 は `USAGE_LINES` を更新する T5、SC2 は `cli-usage.md` を更新する T8 に置く |
| F18 | ADR を `harness-docs/ARCHITECTURE.md` の直接編集で足す | T16 | hook が拒否する。`stage-adr` → `commit-architecture` の 2 段階。CLI の絶対パスは注入か拒否メッセージから取る |
| F19 | ADR / rules の diff を提示せずに commit する | T16 / T17 | `stage-*` が exit 0 で返ったことは承認ではない。diff を全文提示してから承認を得る |
| F20 | `/metatron:update` を実行して ARCHITECTURE の他の節まで動かす | T16 | ADR だけを足す |
| F21 | `protected-paths.md` を Edit で直接書く | T17 | hook が拒否する。`get rules --name protected-paths` で全文を取り、`stage-rules` → `commit-rules` |
| F22 | `plugins/metatron/scripts/` を手で編集する | T6 | `src/` を変更して `pnpm run build` |
| F23 | 凍結契約を確認なしに編集する | T19 | L18 が「実装を止めてユーザーに確認する」と定めている。**(a)(b) は必須だが、確認を経てから適用する** |
| **F24** | **T21 で「codiel の `scripts/` に差分が無いこと」を合格条件にしてしまい、正しい削除を失敗と判定する** | **T21** | metatron の `scripts/` は build 由来の差分のみ。**codiel の `scripts/` には `install-harness.sh` の 1 行削除が出るのが正しい。** それ以外のファイルに差分が出ていたら `plugins/codiel/src/` を意図せず変更している |
| **F28** | **`install-harness.sh` の L5 を消すときに L3-4(2 行にまたがる別の文)まで巻き込む** | **T13** | 削除は L5 の 1 行だけ。§5.11 の変更前・変更後を突き合わせる。`git diff` が **1 行削除のみ・追加行なし**であることを確認する |
| **F29** | **`install-harness.sh` を「バンドル出力だから `src/` を直す」と誤解し、存在しない元ソースを探す、または編集を見送る** | **T13** | このファイルは `plugins/codiel/build.ts` の entryPoints に無く、`pnpm run build` で再生成されない。**手で削除するのが正しい**(§5.13 ②が規則側にも明記する) |
| F25 | `.serena/memories/` を Edit / Write で直接書く | T18 | Serena の `edit_memory` を使う |
| F26 | `recording-gotchas`(metatron 側)から `init-gotchas` を呼ぶ手順を書いてしまう | T9 | 台帳の生成は承認を要する。失敗の記録はその承認を待たない。**否定形の 1 行**を必ず入れる |
| F27 | metatron の `commands/init.md` を追随させ忘れ、codiel 側だけ直る | T10 | 両方の `commands/init.md` を同じ改修で直す |

---

## 7. Done 条件チェックリスト

- [ ] `pnpm run lint` が緑。
- [ ] `pnpm run typecheck` が緑。
- [ ] `pnpm run test` が緑(baseline と比べて失敗が増えていない)。
- [ ] `pnpm run build` を実行し、`plugins/metatron/scripts/` の差分が同じコミットにある。手で編集していない。
- [ ] **`plugins/codiel/scripts/install-harness.sh` に `GOTCHAS` の語が残っていない**(L5 が削除されている。`grep -n "GOTCHAS"` が 0 件、`wc -l` が 12)。
- [ ] `plugins/codiel/scripts/` の差分が `install-harness.sh` の 1 行削除**だけ**である(他のバンドル出力に差分が無い)。
- [ ] metatron の `plugin.json` と `package.json` がともに `0.3.0-dev`。
- [ ] codiel の `plugin.json` と `package.json` がともに `0.7.0-dev`。
- [ ] ルート `README.md` / `plugins/metatron/README.md`(L25・CLI の表・L59)/ `plugins/codiel/README.md` に反映されている。
- [ ] **`plugins/metatron/commands/init.md` の description が GOTCHAS と rules に触れている。**
- [ ] ADR-002 が `stage-adr` → `commit-architecture` で `harness-docs/ARCHITECTURE.md` に入っている。
- [ ] **`.claude/rules/metatron/protected-paths.md` L7 に `init-gotchas` が入っている**(`stage-rules` → `commit-rules` 経由)。
- [ ] **凍結契約 §12 の 2 表と §7-3 が改訂されている(U1 (a)(b)(c)、すべて承認済み)。**
- [ ] `.serena/memories/metatron/core.md`(バージョン `0.3.0-dev` を含む)と `.serena/memories/codiel/core.md`(バージョン `0.7.0-dev` を含む)が改修後の記述と食い違わない。
- [ ] codiel の `recording-gotchas/SKILL.md` に GOTCHAS の雛形ブロックが残っていない。`grep -n "直接追記"` が 0 件。
- [ ] codiel の `recording-gotchas/SKILL.md` の「記録できないとき」の書き先が `.codiel/` 配下である。
- [ ] `capturing-architecture/SKILL.md` で `grep -n "4 対象"` が **3 件**(手順 5 と、HARD-GATE の stage 対象限定 2 件)。HARD-GATE の承認対象は「5 対象」。
- [ ] HARD-GATE の L160 と L162 が、stage を経る 4 対象と GOTCHAS で書き分けられている。
- [ ] `grep -n "案内が無ければ直接編集" plugins/codiel/CLAUDE.example.md` が 1 件(ARCHITECTURE 側のみ)。
- [ ] T22 の実機確認 8 項目がすべて期待どおり。
- [ ] **`harness-docs/GOTCHAS.md` が存在しない**(`ls` で確認。O5)。
- [ ] `git status --short` に、baseline に無い本改修以外の差分が無い。
- [ ] §0.1 の U1 が (a)(b)(c) すべて承認済みとして記録され、T19 で反映されている。
- [ ] O6(`protected-paths.md` への例外の明記)の採否が記録され、採用したなら反映されている。

---

## 8. 設計書との食い違い

実装中に設計書と実装の食い違いを見つけたら、実装を止めてオーケストレーターへ報告し、この節へ追記する。

| # | 箇所 | 設計書の記述 | 実測 | 扱い |
| --- | --- | --- | --- | --- |
| 1 | T7 / §5.9 / Done 条件の `4 対象` 件数 | 設計書 §7.8(9) は、手順 5 に加えて HARD-GATE L160・L162 にも「stage を経る 4 対象」と明記する | 旧計画は `grep -n "4 対象"` が 1 件だけと要求していたが、設計どおりの実装では 3 件 | 設計書を優先。T7・§5.9・F12・Done 条件を 3 件へ訂正した |
| 2 | T13 の `台帳ごと作` 件数 | 設計書 §7.10(d)(f) は `recording-gotchas/SKILL.md` に 2 件、§7.12 は `docs/DESIGN.md` に 1 件を要求する | 旧計画は SKILL.md の 1 件以外に出ないことを要求していたが、設計どおりでは計 3 件 | 設計書を優先。T13 の検証条件を計 3 件へ訂正した |

---

## 9. 未解決事項

**設計書 §12-1 の U1(凍結契約 §12 の改訂)のみが残る。** U2 はユーザー回答により確定し(`install-harness.sh` L5 を行ごと削除)、T13 の通常タスクへ移した。O1〜O5 は §0.1 で確定済み、O6 は既定「実施」で T17 に同梱してある。
