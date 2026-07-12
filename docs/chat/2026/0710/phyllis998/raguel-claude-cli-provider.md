# Raguel MCP ClaudeCliProvider 調査

- 日付: 2026-07-10
- 参加者: hiro0209, AI (Claude Haiku 4.5)
- 成果物: なし(調査・説明のみ、ファイル変更なし)
- 前提: ユーザーが Raguel MCP の ClaudeCliProvider コンポーネント詳細を依頼

---

## セッション1: ClaudeCliProvider の位置特定と実装詳細の説明

# hiro0209

> Raguel MCPのClaudeCliProviderに移動して

# AI

`ClaudeCliProvider` クラスの位置を特定し、実装内容を確認。

**位置情報**:
- ファイル: `plugins/codiel/raguel-mcp/src/panel/claudeCli.ts`
- 行番号: 41
- 用途: `src/server.ts` から `JudgeProvider` として import・利用

**実装内容と設計パターンの説明**:

1. **本命プロバイダの性質**
   - `claude -p`(ヘッドレスモード)をサブプロセス起動する設計
   - 外部 Anthropic API クライアントを使わず、ユーザーの既存 CLI サブスク認証に相乗りする構造
   - これは CLAUDE.md の「Codiel/Raguel は Anthropic API 不使用が必須」という制約の具体的な実装形

2. **JSON Schema と リトライ戦略**
   - `--json-schema` フラグでスキーマを CLI に渡し、LLM 出力の JSON 妥当性を CLI 層で保証
   - 失敗時は `buildRetryPrompt` でエラー詳細を埋め込んだプロンプトを再送
   - リトライは1回のみ(LLM 出力の非決定性を吸収する典型パターン)

3. **ツール・MCP 遮断**
   - パネリスト(判定者)呼び出し時に `--tools ""` と `--strict-mcp-config` で一切のツール・MCP・スキルを遮断
   - 純粋な「1発の判定」のみを行わせる設計
   - コメント注記: `--bare` や空 `--setting-sources` は使わない(ユーザーのログイン情報ごと外れてしまうため)

**関連ファイル**:
- `plugins/codiel/raguel-mcp/src/server.ts` — JudgeProvider として使用
- `plugins/codiel/docs/DESIGN.md` §7 — 設計原典

---

注意事項: ユーザーが「移動して」と指示したのは閲覧・説明の依頼。ファイル修正・リファクタは実施されていない。「具体的に何をしたいか」という次のアクション待ち状態。

## セッション2: 過去セッション参照の確認

# hiro0209

> 私は「AIが下した判断や、AIが考えた仕様(plan)・設計(design)、AIが書いたソースコードなど、AIが出力したものを機械的に判断し、PROCEED・ASK・STOPの判定を出し、AIの暴走を防ぐためのツールを提供するMCPサーバーを一緒に設計してください。言語はTypeScriptです。」と、いつ言っていましたか？

# AI

docs/chat/ ディレクトリ内の grep 検索により過去セッション記録から該当発言を特定。

**発見内容**:
- 発言日時: 2026-07-07
- ファイル: `docs/chat/2026/0707/raguel-mcp-design-session.md`
- セッション位置: セッション1「初期設計」の冒頭
- 内容確認: 同ファイルからユーザーの上記発言の原文を確認

**関連セッションとプロジェクト背景**:
- raguel-mcp(旧 decision-kernel-mcp)の設計出発点のセッション
- 成果物は `docs/DESIGN.md` の全面改訂とプロジェクト名の Raguel への改名
- 翌日 2026-07-08 の `codiel-orchestrator-design-implementation-session.md` にも PROCEED/ASK/STOP の継続議論あり

---

注意事項: このターンは過去記録の検索・参照のみ。ファイル変更・コード操作なし。
