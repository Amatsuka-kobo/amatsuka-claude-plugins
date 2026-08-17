`plugins/metatron` (0.1.0-dev) — ARCHITECTURE / GOTCHAS を**独立資産**として記録・更新し、
毎セッション冒頭に注入するプラグイン。2026-08-16 新規追加(commit 1e4508b)。
codiel が持っていた `docs/ARCHITECTURE.md` / `docs/GOTCHAS.md` の管理をここへ切り出したもの。
書式の正本は `mem:file_contract`。設計根拠は `plugins/metatron/docs/rationale.md`。

## C1 構成 — 常駐プロセスなし

共有ライブラリ + CLI + deny hook + 注入 hook の 4 点だけで構成する。**MCP サーバーではない。**
CLI も 2 つの hook もすべて短命プロセスなので「サーバーが起動していない」故障が原理的に起きない。
MCP 化は設計段階で撤回済み(`docs/rationale.md`)。**MCP サーバー化を再提案しない。**

## 真の強制点は deny hook だけ

| 手段 | 強制力 |
| --- | --- |
| MCP ツール / CLI | 呼び出しは任意。呼ばずに Write すれば素通り = 「行儀よく使えば安全な窓口」でしかない |
| PreToolUse deny hook | Edit / Write / NotebookEdit 経由の直接編集を、hook が正常動作する限り拒否する |

deny hook の保証範囲は限定的で、次は**対象外**(「破りようがない」と主張しない)。

- Bash リダイレクト(`echo >> docs/GOTCHAS.md`)。matcher に掛からない。
- 人間のエディタでの編集。これは Markdown 保存の目的そのものなので正しい挙動。
- hook 自身の失敗。metatron の不具合で全編集が止まる損害のほうが大きいためフェイルオープン。

CLI が無価値という意味ではない。deny hook は「直接書かせない」しかできず、書式検証・採番・
追記のみの規律・差分提示の強制は CLI が担う。位置づけは「回避を試みる AI を止める」ではなく
「知らずに直接編集する AI を正しい窓口へ導く」。

## 2 つの hook(`hooks/hooks.json`)

| hook | スクリプト | 挙動 |
| --- | --- | --- |
| SessionStart | `scripts/inject-context.mjs` | ARCHITECTURE 本体、GOTCHAS の目次と直近エントリ、CLI の絶対パス案内を注入。予算超過時は GOTCHAS → ADR 一覧 → ARCHITECTURE の順に段階縮退し、**CLI 案内だけは削らない**。フェイルオープン |
| PreToolUse (`Edit\|Write\|NotebookEdit`) | `scripts/guard-docs.mjs` | 2 文書への直接編集を拒否し、対象に応じた CLI 呼び出しを絶対パス付きで案内。フェイルオープン |

deny hook は **CLI を実行しない**。`import.meta.url` からプラグインルートを求めて
`scripts/metatron.mjs` の絶対パスを**文字列として組み立て**、`permissionDecisionReason` に載せるだけ。
実行するのはモデル(Bash)。これにより AI はインストール位置を知らなくても CLI を呼べる。

## src の構成

- `src/lib/` 7 本: `config.ts`(契約 §3 の**正本実装**)、`architecture.ts`、`gotchas.ts`、`adr.ts`、
  `scan.ts`(コードベース解析)、`staging.ts`、`emit.ts`。
- `src/cli/` 11 本(`main.ts` / `args.ts` / `input.ts` / `output.ts` / `paths.ts` / `get.ts` /
  `scan`系 `analysis.ts` / `diff.ts` / `stage.ts` / `commit.ts` / `gotcha.ts`)。
- エントリは `src/metatron-cli.ts` → `scripts/metatron.mjs`。hook 本体は `src/guard-docs.ts` /
  `src/inject-context.ts`。

## CLI 12 サブコマンド

読: `get config` / `get architecture [--section]` / `get domains` / `get gotchas` / `get adr` /
`scan` / `diff-architecture`。段階: `stage-architecture --input` / `stage-adr --input`。
書: `commit-architecture --staging-id` / `append-gotcha --input` / `tag-gotcha`。

- 出力は**常に JSON を stdout**。読み取り系は「読めなかった」も事実として返すため**常に exit 0**、
  書き込み系は拒否・失敗で非 0 かつ理由は JSON の `error`。
- 長い入力は一時ファイルへ書き `--input <path>` で渡すのが**正式な呼び出し規約**(引数長上限と
  シェル解釈の回避。Write ツールで書けばシェルを一切通らない)。CLI は読み取り後に削除しない。
- ARCHITECTURE は `stage-architecture` → `commit-architecture` の 2 段階。**差分を計算せずに
  書き込む経路がコマンド体系上存在しない。** `stagingId` は単回使用・既定 30 分失効・stage 後に
  ファイルが変化していれば `file_changed` で失敗。保存先は
  `<tmpdir>/metatron-staging/<プロジェクトパスのハッシュ>/<id>.json`(プロジェクト内に置かない)。
- ADR の追加・状態変更は `stage-adr` 専用。`stage-architecture` では拒否される。
- 採番と挿入は `<文書パス>.lock` を `fs.open` の `wx` で取り、50ms × 最大 20 回リトライ、
  mtime 60 秒超で死んだロックを奪う(奪取前に mtime を再取得して確認)。
  **フェンシング(PID/nonce トークン)は意図的に導入しない。** 導入判断は設計書への差し戻しが要る。

## skills / commands / references

- skills 3: `capturing-architecture`(初回生成)、`updating-architecture`(乖離検出と更新)、
  `recording-gotchas`。`evals/` に 3 本の JSON。**agents は持たない。**
- commands 2: `/metatron:init`(scan の事実からセクション単位で確認しながら初回生成。
  `## ADR 一覧` は対象外)、`/metatron:update`(決定的に検出できる乖離候補だけを提示)。
- `references/` 5 本(AI が実行時に読む正本): `architecture-format.md` / `gotchas-format.md` /
  `config-schema.md` / `cli-usage.md` / `writing-discipline.md`。
- `docs/ARCHITECTURE.example.md` / `docs/GOTCHAS.example.md` はここへ移設された(codiel から削除)。

## 他プラグインとの関係

- **codiel は metatron 無しで動く。** `/codiel:init` がドメイン分割だけを聞いて最小 ARCHITECTURE を
  自前生成するフォールバックを持つ。併用時は最小構成をそのまま活かして残りの節を足す(変換なし)。
- sandalphon は ASIS 探索の材料として 2 文書を直読するだけ。
- **どちらも metatron のインストール位置を参照しない。** 共有するのはファイルの書式だけ。
