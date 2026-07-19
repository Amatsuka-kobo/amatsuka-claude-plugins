# Serena メモリ最新化セッション

- 日付: 2026-07-19
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `.serena/memories/pitcrew/core.md`(新規作成)、`.serena/memories/core.md`、`.serena/memories/tech_stack.md`、`.serena/memories/suggested_commands.md`、`.serena/memories/conventions.md`(複数回更新)、`~/.claude/.../memory/pitcrew-viewer-backlog.md`、`~/.claude/.../memory/MEMORY.md`(更新)
- 前提: なし

---

## セッション 1: Serena メモリ最新化

# phyllis998

> serena メモリを最新化して

# AI

Serena メモリの全体を把握し、リポジトリの現状と突き合わせ。最大の乖離は **pitcrew プラグイン(0.10.0)が Serena メモリに一切未記載**であること、および関連メモリの記述が古い実態を発見。

**差分の詳細**：

1. **pitcrew (0.10.0) が5番目のプラグインとして追加**
   - 唯一のリリース版(非 `-dev`)
   - hooks-only の捕捉(SubagentStop/PostToolUse)と注入(PreToolUse/Stop)の2層モデル
   - `.pitcrew/` 状態ディレクトリ、3コマンド(serve/watch/config)、src/ レイアウト
   - TUI は `/pitcrew:watch` コマンドで案内のみ(Claude は実行しない)

2. **tech_stack メモリの workspace members に pitcrew が欠落**

3. **suggested_commands の workspace パッケージ名一覧に pitcrew-scripts が欠落**

4. **conventions の「plugin.json と package.json の version は一致」が崩れている**
   - pitcrew の plugin.json は 0.10.0
   - pitcrew の package.json は 0.1.0-dev
   - 実態に合わせて「distributed 版は plugin.json 側で管理」に修正

**実施内容**：

- **新規作成**: `.serena/memories/pitcrew/core.md`
  - 唯一のリリース版であることを明記
  - hooks-only 2層モデル、状態管理、コマンド3種類、ファイル構成を記載

- **更新**: `.serena/memories/core.md`
  - 配布プラグインを 4→5 に
  - pitcrew を追加、`mem:pitcrew/core` へ参照

- **更新**: `.serena/memories/tech_stack.md`
  - workspace members に `plugins/pitcrew` を追加

- **更新**: `.serena/memories/suggested_commands.md`
  - workspace パッケージ名一覧に `pitcrew-scripts` を追加

- **更新**: `.serena/memories/conventions.md`
  - 「plugin.json と package.json の version 一致」の記述を、pitcrew でドリフトしている実態に合わせて修正

**確認事項**：

他のメモリ(`basic_design/core`・`codiel/raguel_mcp`・`task_completion`・`memory_maintenance`)は現状と一致しており変更不要。

ただし、別系統の auto-memory(`pitcrew-viewer-backlog.md`)は「Stage 4.2 (v0.9.4) まで対応済み」のままで、現在の TUI watch (Stage 5 / 0.10.0) を反映していない。そちらも更新するか確認。

---

## セッション 2: auto-memory 更新と version ドリフト修正

# phyllis998

> お願いします

# AI

auto-memory (`pitcrew-viewer-backlog.md` と `MEMORY.md`) を更新。

- **pitcrew-viewer-backlog.md**: 「v0.10.0(Stage 5: TUI ビューア `pitcrew watch`)までリリース済み、未対応要望なし」を明記し、`modified` タイムスタンプを更新
- **MEMORY.md の索引行**: 「Stage 4.2(v0.9.4)まで」→「v0.10.0(Stage 5 TUI watch)まで」に更新

なお、バックログの「対応済み」リストはそのまま據え置きました。Stage 5 の TUI 自体がバックログ由来の要望だったという根拠が手元にないため、対応済み要望として追記はしていません。

結果として Serena メモリ・auto-memory ともに v0.10.0 と整合。

---

# phyllis998

> pitcrew の package.json の version を plugin.json に合わせました。version 表記一致の方針は変わらないままです

# AI

Serena メモリの2箇所を、方針に戻すように修正。

- **conventions**: 「plugin.json と package.json の version は一致(全プラグイン一致中)」という不変条件に復元
- **pitcrew/core**: バージョンドリフト(plugin.json 0.10.0 vs package.json 0.1.0-dev)についての Gotcha 記述を削除

pitcrew の package.json / plugin.json ともに 0.10.0 で一致を確認済み。メモリは「書いた時点の事実」のスナップショットだが、「一致していない」という現状記述より「一致させるのが方針」という不変条件の方が経年劣化に強く、こういう揺れに巻き込まれにくい点が本ターンの教訓。

---

注意事項: コミット未実施。
