# chat-recorder ヘッドレス記録の tempDir 問題調査と修正

- 日付: 2026-07-25
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 根本原因の確定、修正方針の提示
- 前提: `docs/chat/2026/0724/phyllis998/chat-recorder-performance-improvement.md`（セッション1〜7、案B設計とマージ）

---

## セッション1: ヘッドレス記録の連続失敗の根本原因確定と修正着手

# phyllis998

> 一旦1を進めてください

# AI

### 調査段階の成果（ここまでの結論）

ヘッドレス chat-recorder が一時ファイル書き込みで全試行ブロックされていることを確認しました。

**根本原因**: `~/.claude/task-utility/chat-recorder/<key>/temp/*.md` への Write 操作が、Claude Code の「sensitive file」ガードで保護されている。これは `--add-dir ~/.claude/task-utility/chat-recorder` や `--permission-mode acceptEdits` では解除されず、ヘッドレス（`claude -p`）環境には許可を与える人間がないため、記録手順の途中（手順3）で毎回失敗停止していた。

**被害**: `recordedLine: 0` — このプロジェクトの会話は改修以降、一度も記録されていない（2セッション、計7回の試行全滅）。

**設計時点での予見**: 設計書 L257 に「実装時に実サブスクリプション環境で検証する」と明記されていたが、この検証が消化されないまま実装が入った。

修正方針は3点。最初に根本修正（tempDir を `~/.claude/` 外へ移す）を着手します。

### 実装：tempDir を os.tmpdir() 配下へ移す

`plugins/task-utility/src/chat-recording-state.ts:144` の `tempDir` 初期化を修正します。
