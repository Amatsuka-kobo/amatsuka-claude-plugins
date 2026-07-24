# agent-policy

`agent-policy` は、あまつか工房のエージェント運用方針(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map 作成)を配布可能な Skill として提供する。CLAUDE.md にこの Skill へ従う旨を書くだけで、任意のプロジェクトに同じ運用規律を持ち込める。

## 提供 Skill

- `agent-policy:with-codex` — Claude + Codex(GPT)併用構成の運用方針。
- `agent-policy:claude-only` — Claude のみで完結する運用方針(プロキシ不要)。
- `agent-policy:setup` — with-codex で使う GPT Agent 定義を `.claude/agents/` に生成するウィザード。

## 使い方(CLAUDE.md への記載)

**どちらを選ぶか:** Codex 系 GPT モデルを配信するプロキシ環境がある → `with-codex` / それ以外(Claude のみ)→ `claude-only`。

with-codex を使う場合、CLAUDE.md に次のように書く:

```markdown
## エージェント運用方針

- エージェント運用は `agent-policy:with-codex` に従う。
- GPT エージェント(gpt-sol / gpt-terra / gpt-luna)が未生成の場合は `agent-policy:setup` を実行して `.claude/agents/` に生成する。
```

claude-only を使う場合:

```markdown
## エージェント運用方針

- エージェント運用は `agent-policy:claude-only` に従う。
```

## 前提条件

- `claude-only`: 追加の前提なし。プロキシ・GPT・外部 API は不要。
- `with-codex` + `codex@openai-codex`: Claude Code から Codex CLI にタスクを委譲できる codex プラグインがインストールされ、使用可能であること。
- `with-codex` + `setup`: Codex 系モデルを配信するローカルプロキシ(任意の ProxyAPI サーバー)経由で Claude Code を起動していること、`/v1/models` に使用するエイリアスが含まれること。構築手順は本 README では扱わず、要件のみ記載する。プロキシ・OAuth・秘密値はこのプラグインが管理しない。

## モデルエイリアスについて

`claude-gpt-5-6-sol` 等は、モデル本体の ID ではなく、ProxyAPI サーバーが配信するクライアント側の別名である。名前に `claude-` が付くが上流は Codex GPT である。エイリアスはプロキシ設定に依存する拡張であり、標準 model 値(`inherit` / `sonnet` / `opus` / `haiku`)と同じ可搬性は仮定しない。`setup` でプロジェクトごとに差し替え可能。

## 他プラグインとの棲み分け

- 本プラグイン(`agent-policy`)=「誰に任せるか」(モデル別役割分担・委譲先の決定)。
- `revelation`=「どう進めるか」(タスク分解・自己検証・次の一手の選び方)。両者は併用可能で、同じ局面で両方が発動しても矛盾しない(役割分担 vs 進め方で関心が異なる)。
- 役割 Agents を持つワークフロープラグイン(例: Codiel)との併用: Codiel 等は関心ごとの役割 Agents(`model: inherit`)で各フェーズを駆動する。agent-policy はその「役割」を尊重しつつ「誰が実行するか」を重ねる。`with-codex` では、実装フェーズの役割 Agent 定義本文を GPT エージェントへの依頼文に注入して実行する合成方式(役割プロンプト × GPT 実行)をとる。`claude-only` では役割 Agents をそのまま起動する(必要なら dispatch 時に標準 model 値へ上書き)。詳細な判断フローは各 Skill 本文に記載。

## 設計上の確定事実(dispatch 時の model 上書き制限)

**確定事実(2026-07-20 実測検証済み):** Agent tool の dispatch 時 `model` 上書きパラメータは enum(`sonnet` / `opus` / `haiku` / `fable`)に制限され、カスタムエイリアス(`claude-gpt-5-6-*`)は実行前にバリデーションエラーで拒否される。カスタムエイリアスが有効なのは Agents 定義 frontmatter の `model` フィールドのみである。将来 enum が緩和されたら dispatch 上書き方式を再検討する。

これが `with-codex` の役割 Agents 併用ルールで「dispatch 時の `model` 上書きは使わず、役割定義本文を依頼文に同梱する」方式を採る理由である。

## アップデート時の注意

0.3.0 でエージェントテンプレートを改訂しました(gpt-luna のツール構成変更・スキルロード規律の追加)。既存プロジェクトの `.claude/agents/gpt-*.md` は `agent-policy:setup` の再実行で更新してください。
