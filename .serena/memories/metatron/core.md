`plugins/metatron` (0.6.2-dev) — ARCHITECTURE を**独立資産**として記録・更新するプラグイン。
2026-08-16 新規追加(commit 1e4508b)。0.6.0(2026-11-19、PR #41)で、扱う文書を ARCHITECTURE と GOTCHAS だけにした。
旧 rules 3 ファイル(`.claude/rules/metatron/`)と、その CLI・config(`paths.rulesDir`)・guard・書式は撤去済み。
0.6.1-dev(2026-11-27、Issue #46、PR #61)で ADR 機能と GOTCHAS 機能を削除し、扱う文書を ARCHITECTURE だけにした。
保護パスとテスト方針は ARCHITECTURE のセクション、規約は CLAUDE.md に書く。
文書は CLAUDE.md の行頭の `@<パス>` で読み込ませ、hook で本文を注入しない(SubagentStart は撤去)。
組み込みの Explore・Plan と `omitClaudeMd` のサブエージェントには ARCHITECTURE が届かないが、対応しないと決定済み。
codiel が持っていた `docs/ARCHITECTURE.md` の管理をここへ切り出したもの。
書式の正本は `mem:file_contract`。設計根拠は `plugins/metatron/docs/rationale.md`。

This repository's architecture asset is `harness-docs/ARCHITECTURE.md`; the repository CLAUDE.md
imports it with `@harness-docs/ARCHITECTURE.md`. It has no ADR section: the ADR list (ADR-001〜016) and the
GOTCHAS ledger moved to `docs/old/metatron/ADR.md` and `docs/old/metatron/GOTCHAS.md` (Issue #48, PR #66), and
AI no longer reads them. Which ADRs still hold was deliberately not copied anywhere (user decision).

## C1 構成 — 常駐プロセスなし

共有ライブラリ + CLI + deny hook + 案内 hook の 4 点だけで構成する。**MCP サーバーではない。**
CLI も hook のスクリプト(2 本)もすべて短命プロセスなので「サーバーが起動していない」故障が原理的に起きない。
MCP 化は設計段階で撤回済み(`docs/rationale.md`)。**MCP サーバー化を再提案しない。**

## 真の強制点は deny hook だけ

| 手段 | 強制力 |
| --- | --- |
| MCP ツール / CLI | 呼び出しは任意。呼ばずに Write すれば素通り = 「行儀よく使えば安全な窓口」でしかない |
| PreToolUse deny hook | Edit / Write / NotebookEdit 経由の直接編集を、hook が正常動作する限り拒否する |

deny hook の保証範囲は限定的で、次は**対象外**(「破りようがない」と主張しない)。

- Bash リダイレクト(`echo >> docs/ARCHITECTURE.md`)。matcher に掛からない。
- 人間のエディタでの編集。これは Markdown 保存の目的そのものなので正しい挙動。
- hook 自身の失敗。metatron の不具合で全編集が止まる損害のほうが大きいためフェイルオープン。

CLI が無価値という意味ではない。deny hook は「直接書かせない」しかできず、書式検証・承認つきの書き換えの規律・
差分提示の強制は CLI が担う。位置づけは「回避を試みる AI を止める」ではなく
「知らずに直接編集する AI を正しい窓口へ導く」。

## 2 イベントに掛ける 2 本のスクリプト(`hooks/hooks.json`)

| hook | スクリプト | 挙動 |
| --- | --- | --- |
| SessionStart | `scripts/inject-context.mjs` | 文書の本文は注入しない。CLI の絶対パス、更新時の `updating-architecture` スキルの起動、委譲の注意だけを案内する。移行が要る状態(旧 rules の 3 ファイルが残る・CLAUDE.md の @メンションの欠け)は `systemMessage` で画面にも出す。`metatron.config.json` が無い案内は画面に出さず注入だけ(0.6.2-dev)。フェイルオープン |
| PreToolUse (`Edit\|Write\|NotebookEdit`) | `scripts/guard-docs.mjs` | ARCHITECTURE への直接編集を拒否し、`updating-architecture` スキルへ誘導する。CLI の絶対パスを載せる。保護する文書は ARCHITECTURE だけ。フェイルオープン |

**案内文と deny の理由文は、ARCHITECTURE の書き込み手順(stage → commit)を載せず、`updating-architecture` スキルの起動へ誘導する**(2026-11-07、0.5.2-dev。`updateLines` と guard-docs の `SKILL_LINE`)。
CLI の手順が完結した形で見えていると、AI はスキルを起動せずに CLI へ直行し、`diff-architecture`・草案のサブエージェント検査を飛ばしていた。

**ADR・GOTCHAS の機能は 0.6.1-dev で消えた。** `AMATSUKA_METATRON_ENABLE_ADR`・`AMATSUKA_METATRON_ENABLE_GOTCHAS`(ADR-015 のオプトイン)は読まれず、
`metatron.config.json` の `paths.gotchas` は警告なしで無視する。`recording-gotchas` スキル・`references/gotchas-format.md`・`docs/GOTCHAS.example.md`・
`evals/recording-gotchas.json` も無い。

**`link-claude-md`**(0.6.0、`src/lib/claude-md.ts`・`src/cli/claude-md.ts`)は CLAUDE.md へ @メンションを冪等に追記し、
`metatron.config.json` が無ければ `wx` で `{ "version": 1 }` を先に作る(codiel がこのファイルの有無で metatron の利用を判定するため)。
判定はルートの `CLAUDE.md` と `.claude/CLAUDE.md` だけを見て、コードフェンス・インラインコード・HTML コメントの中を除く。
空白・制御文字を含むパスは `skipped` に載せて追記しない。CLAUDE.md の書き込みに失敗したら、作った設定ファイルを消す(0.6.2-dev)。

**docRoot の解決は契約 §3 規則 1**(`src/lib/config.ts` が正本)。0.6.2-dev(2026-11-27、Issue #43、PR #69)の現行の動き:
開始ディレクトリに `metatron.config.json` があれば git を実行せずそこを返す。設定ファイルを持つ祖先の探索は git の toplevel で打ち切る(親リポジトリの中の worktree が親の設定を拾わないため)。
git を実行できないときは、`.git`(ディレクトリかファイル)を持つディレクトリで打ち切る。リポジトリの外に置いた設定は拾わない。
`paths.rulesDir` を持つ旧設定の移行案内は、旧版が拒否した値(空文字列・絶対パス・docRoot 自身・ルート外)のとき既定の置き場の旧 rules を対象にする。

**SessionStart の案内は文書が 1 つも無くても CLI 案内を出す**(契約 §12 の限定)。
`/metatron:init` はまさに文書が無い状態で使うため、案内を落とすと AI は CLI の絶対パスを
知る手段を持たない。**案内まで落とすのは**、`loadConfig` 自体が例外で失敗したとき(壊れた機構が誤った CLI パスを広告しないため)。
後者は通常の入力では再現できないので `src/testing/fault-config.mjs` が
`NODE_OPTIONS=--import` でモジュール解決層の `loadConfig` を差し替えて検証する
(biome / tsc の対象外にするため拡張子は `.mjs`)。

**deny hook は dangling symlink まで辿る。** `realpathSync` は未作成のリンク先を解決できず、
親だけ実体化するとリンク自身のパスに留まってリンク先への直接 Write が素通りする。
`followDanglingLink` が `lstat` + `readlink` で多段リンクを辿る。ホップ上限は
`MAX_SYMLINK_HOPS = 40`、循環・辿れないときは**入力をそのまま返して素通しへフォールバック**
(フェイルオープン方針に沿う)。比較キーは realpath → dangling 追跡 → `/` 正規化 → NFC →
(非区別 FS なら)小文字化の順。FS の大文字小文字区別は inode 一致で実測する。

deny hook は **CLI を実行しない**。`import.meta.url` からプラグインルートを求めて
`scripts/metatron.mjs` の絶対パスを**文字列として組み立て**、`permissionDecisionReason` に載せるだけ。
実行するのはモデル(Bash)。これにより AI はインストール位置を知らなくても CLI を呼べる。

## src の構成

- `src/lib/` 8 本: `config.ts`(契約 §3 の**正本実装**)、`architecture.ts`、`scan.ts`(コードベース解析)、
  `staging.ts`、`emit.ts`、`claude-md.ts`、`atomic-write.ts`、`file-lock.ts`(`withFileLock`・`FileLockError`)。
- `src/cli/` 11 本(`main.ts` / `args.ts` / `input.ts` / `output.ts` / `paths.ts` / `get.ts` /
  `scan`系 `analysis.ts` / `diff.ts` / `stage.ts` / `commit.ts` / `claude-md.ts`)。
- エントリは `src/metatron-cli.ts` → `scripts/metatron.mjs`。hook 本体は `src/guard-docs.ts` /
  `src/inject-context.ts`。
- Test placement follows `harness-docs/ARCHITECTURE.md` §テスト方針: the six `src/lib` target tests
  (`architecture`, `claude-md`, `config`, `file-lock`, `scan`, `staging`) are in `src/lib/__test__/`
  (helper: `helpers/write-faults.ts`); the CLI test is `src/cli/__test__/cli.test.ts`; `guard-docs`,
  `inject-context` and `section-reference-inventory` tests remain in `src/__test__/` because their targets are
  directly under `src/` (the inventory test reads `src/fixtures/section-reference-inventory.json`).
  Fault injection lives in `src/testing/`.

## CLI サブコマンド

読: `get config` / `get architecture [--section]` / `get domains` / `scan` / `diff-architecture`。
段階: `stage-architecture --input`。書: `commit-architecture --staging-id` / `link-claude-md`。以上の 8 個だけ(`get` の 3 対象を数える)。
0.6.1-dev で消した ADR・GOTCHAS 用の 13 個は `unknown_subcommand`(終了コード 2)、`get` の ADR・GOTCHAS 用の対象は
`unknown_target`(終了コード 0)を返す。

`diff-architecture` は技術スタックとコマンドを機械的に照合せず、定義のありかを `sources` で返す(2026-11-12)。ディレクトリの消失も断定しない(どこを基準にした相対パスかを決められないため)。インラインコードの `/` を含むパスのうち、ルートから実在を確かめられないもの(リンクはたどらない)を skipped の「ディレクトリの実在の未確認」に並べ、AI が確かめる。ツリーの中と 1 語は並べない。

**残った `## ADR 一覧`**: 見出しの許可リストは 8 セクションで、`ADR 一覧` は外れた。既存の ARCHITECTURE に残っていれば `diff-architecture` が
`legacy_section` の所見で示し(`scan.ts` の `LEGACY_ADR_HEADING`)、`stage-architecture` の `{ "heading": "ADR 一覧", "remove": true }` で消せる。
`updating-architecture` は削除の前に、本文の退避先をユーザーに確かめる。

- 出力は**常に JSON を stdout**。読み取り系は「読めなかった」も事実として返すため**常に exit 0**、
  書き込み系は拒否・失敗で非 0 かつ理由は JSON の `error`。
- 長い入力は一時ファイルへ書き `--input <path>` で渡すのが**正式な呼び出し規約**(引数長上限と
  シェル解釈の回避。Write ツールで書けばシェルを一切通らない)。CLI は読み取り後に削除しない。
- ARCHITECTURE は `stage-architecture` → `commit-architecture` の 2 段階。**差分を計算せずに
  書き込む経路がコマンド体系上存在しない。** `stagingId` は単回使用・既定 30 分失効・stage 後に
  ファイルが変化していれば `file_changed` で失敗。保存先は
  `<tmpdir>/metatron-staging/<プロジェクトパスのハッシュ>/<id>.json`(プロジェクト内に置かない)。
  staging の種別は `architecture` だけで、廃止した種別の記録は `unknown_id` で拒否する。
- `stage-architecture` が返す `diff` は `{ unified, truncated, truncatedReason, beforeLines, afterLines,
  maxLines, sections }`。**省略の有無は `truncated` で判定する。`unified` の文面から読み取らない。**
  1500 行(`MAX_DIFF_LINES`)超で `unified` は案内文だけになる。`truncated: true` のときは
  `sections` の `before` / `after` から全文提示する — 2 スキルの HARD-GATE に
  「`diff.truncated` が true のまま承認を求めない」がある。
- `commit-architecture` の書き込みは `<文書パス>.lock` を `fs.open` の `wx` で取り、50ms × 最大 20 回リトライ
  (失敗は `FileLockError`、`code` は `lock_timeout`)、mtime 60 秒超で死んだロックを奪う(奪取前に mtime を再取得して確認)。
  **フェンシング(PID/nonce トークン)は意図的に導入しない。** 導入判断は設計書への差し戻しが要る。
- 2026-10-05: 正本への書き込みは `src/lib/atomic-write.ts` の一時ファイルと rename にそろえた(M1-01)。stage は改行を LF にそろえてから、組み上げた全文を既存の parser で読み直して保存する。guard-docs は `..` を畳む前に存在する最深の祖先を実体化し、字句と実体の両方で照合する(M1-04)。

### staging の保証範囲(recordHash。境界を誤解しない)

レコードは `recordHash`(= `recordHash` 以外の全フィールドの正規化 JSON の sha256)を持つ
(`STAGING_RECORD_VERSION = 2`)。`commit` と `readStaging` は**判定の先頭で**再計算して照合し、
不一致なら `tampered` を返して**書き込まない**。`usedAt` / `expiresAt` / `targetPath` /
`nextContent` のどれを単独で差し替えても、後続の判定に入る前にここで落ちる。
消費の印を付けたレコードも `recordHash` を打ち直す(打ち直さないと正当な CLI の書き込みを
次回が tampered と誤判定する)。

- **検知できる**: 偶発的な破損、CLI を経由しないレコード書き換え、単独フィールドの差し替え。
- **防げない**: **`recordHash` まで整合的に打ち直す改変。** ハッシュ関数は公開されており鍵が
  無いため、同一ユーザー権限のプロセスは正しい値を計算できる。**HMAC を持ち込んでも
  鍵の配置・失効という別問題に置き換わるだけで本質は変わらない。**
  metatron は「同一ユーザー権限からの意図的な改変を防ぐ」ことを目標にしない。防ぐのは
  「CLI の 2 段階を素通りする経路」であって「ユーザー自身が自分のマシンで行う書き換え」ではない。
  **HMAC / 署名の導入を再提案しない。**
- 判定順は `unknown_id` → `tampered` → `already_used` → `expired` →(ルート外チェック)→
  `file_changed`。消費の印は書き込みの**後**に付ける。

## skills / commands / references

- skills 2: `capturing-architecture`(初回生成)、`updating-architecture`(乖離検出と更新)。
  `evals/` に 2 本の JSON。**agents は持たない。**
- commands 3: `/metatron:init`(scan の事実からセクション単位で確認しながら ARCHITECTURE(保護パス・テスト方針を含む)を初回生成し、`link-claude-md` で CLAUDE.md に @メンションを追記する。規約は対象外)、`/metatron:update`(決定的に検出できる乖離候補だけを提示し、旧 rules の移行と @メンション・設定ファイルの欠けも扱う)、`/metatron:audit`。
- `references/` 4 本(AI が実行時に読む正本): `architecture-format.md` / `config-schema.md` /
  `cli-usage.md` / `writing-discipline.md`。
- `docs/format-change-checklist.md` is the developer checklist for format changes. It was moved out
  of `references/` because it names repository-root-specific paths.
- `docs/ARCHITECTURE.example.md` はここへ移設された(codiel から削除)。

## 他プラグインとの関係

- **codiel は metatron 無しで動く。** `/codiel:init` は ARCHITECTURE を生成・修復せず、保護パスだけを確認する。
  ARCHITECTURE の作成と更新は metatron が担う。codiel は ARCHITECTURE にあるドメインマップを
  実行時に読み取るが、そこへ書き込まない。
- codiel の `capturing-intent` は ASIS 探索の材料として ARCHITECTURE を読むだけで、パスは `check-intent-env` の `projectDocs` から得る。
- **どちらも metatron のインストール位置を参照しない。** 共有するのはファイルの書式だけ。
