# optimize-agents

`optimize-agents` は、あまつか工房のエージェント運用を最適化する(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map 作成によるコスト最適化)ための規律を配布可能な Skill として提供する。CLAUDE.md にこの Skill へ従う旨を書くだけで、任意のプロジェクトに同じ最適化施策を持ち込める。

## 提供 Skill

- `optimize-agents:with-codex-policy` — Claude + Codex(GPT)併用構成での最適化方針。
- `optimize-agents:claude-model-policy` — Claude のみで完結する最適化方針(プロキシ不要)。
- `optimize-agents:setup` — with-codex-policy で使う GPT Agent 定義を `.claude/agents/` に生成するウィザード。
- `optimize-agents:prompt-smith` — AI が読み手となる指示書(CLAUDE.md・SKILL.md 等)の**本文**の基準と工程。新規作成時の規律と、既存文書の評価・是正の両方で使う。frontmatter の description は対象外で、そちらは `references/description-guide.md` の基準に従う(発火の確実性が簡潔さより優先されるため。根拠と実測は `docs/description-out-of-scope.md`)。

## 使い方(CLAUDE.md への記載)

**どちらを選ぶか:** Codex 系 GPT モデルを配信するプロキシ環境がある → `with-codex-policy` / それ以外(Claude のみ)→ `claude-model-policy`。

with-codex-policy を使う場合、CLAUDE.md に次のように書く:

```markdown
## エージェント運用方針

- エージェント運用は `optimize-agents:with-codex-policy` に従う。
- GPT エージェント(gpt-sol / gpt-terra / gpt-luna)が未生成の場合は `optimize-agents:setup` を実行して `.claude/agents/` に生成する。
```

claude-model-policy を使う場合:

```markdown
## エージェント運用方針

- エージェント運用は `optimize-agents:claude-model-policy` に従う。
```

## 前提条件

- `claude-model-policy`: 追加の前提なし。プロキシ・GPT・外部 API は不要。
- `with-codex-policy` + `codex@openai-codex`: Claude Code から Codex CLI にタスクを委譲できる codex プラグインがインストールされ、使用可能であること。
- `with-codex-policy` + `setup`: Codex 系モデルを配信するローカルプロキシ(任意の ProxyAPI サーバー)経由で Claude Code を起動していること、`/v1/models` に使用するエイリアスが含まれること。構築手順は本 README では扱わず、要件のみ記載する。プロキシ・OAuth・秘密値はこのプラグインが管理しない。

## モデルエイリアスについて

`claude-gpt-5-6-sol` 等は、モデル本体の ID ではなく、ProxyAPI サーバーが配信するクライアント側の別名である。名前に `claude-` が付くが上流は Codex GPT である。エイリアスはプロキシ設定に依存する拡張であり、標準 model 値(`inherit` / `sonnet` / `opus` / `haiku`)と同じ可搬性は仮定しない。`setup` でプロジェクトごとに差し替え可能。

## 他プラグインとの棲み分け

- 本プラグイン(`optimize-agents`)=「誰に任せるか」(モデル別役割分担・委譲先の決定)を最適化する。
- `revelation`=「どう進めるか」(タスク分解・自己検証・次の一手の選び方)。両者は併用可能で、同じ局面で両方が発動しても矛盾しない(役割分担 vs 進め方で関心が異なる)。
- 他プラグイン・自作 Agents との併用: Claude Code の Agents は `model` を省略すると `inherit`(委譲元と同じモデル)になる。optimize-agents はこれを検出して担当表どおりの実行帯へ寄せる規律を持つ。対象は `model` 未指定 / `inherit` の Agents 定義全般で、プラグイン由来(例: Codiel の `codiel-implementer-*`)・プロジェクトやユーザーの自作・ビルトイン(`Explore` / `Plan` / `general-purpose`)を問わない。逆に `model` が具体的なモデルに指定された Agents は定義者の意図表明として尊重し、対象外とする。`with-codex-policy` では、実行帯が GPT に相当するフェーズで役割定義本文を GPT エージェントへの依頼文に注入する合成方式(役割プロンプト × GPT 実行)をとる。詳細な判断フローは `references/orchestration-discipline.md` の §委譲先の実行モデルの確定 に記載。

## 設計上の確定事実(dispatch 時の model 上書き制限)

**確定事実(2026-07-20 実測検証済み):** Agent tool の dispatch 時 `model` 上書きパラメータは enum(`sonnet` / `opus` / `haiku` / `fable`)に制限され、カスタムエイリアス(`claude-gpt-5-6-*`)は実行前にバリデーションエラーで拒否される。カスタムエイリアスが有効なのは Agents 定義 frontmatter の `model` フィールドのみである。将来 enum が緩和されたら dispatch 上書き方式を再検討する。

これが `with-codex-policy` の §実行帯が GPT モデルの場合の dispatch で「実行帯が GPT の場合は dispatch 時の `model` 上書きを使わず、役割定義本文を依頼文に同梱する」方式を採る理由である。

## アップデート時の注意

0.9.0 で 2 つの policy Skill が共有していた規律(モデル別役割の運用・委譲先の実行モデルの確定・コードベース探索・コスト規律・設計/実装計画の規律)を `references/orchestration-discipline.md` に集約しました。各 policy Skill は担当表と自プロファイル固有の分岐のみを持ち、共通規律を参照します。CLAUDE.md 側の記載変更は不要です。

0.8.0 でプラグイン名を `agent-policy` から `optimize-agents` へ、スキル名を `with-codex`→`with-codex-policy`・`claude-only`→`claude-model-policy` へ改名しました(「規律を定める」から「エージェントを最適化する」というコンセプトへの転換)。CLAUDE.md 等で旧名称を参照している場合は書き換えてください。

0.4.0 でエージェントテンプレートを改訂しました(コードベース探索の統括が GPT Sol から Opus に移り、GPT 三体は探索実働の担当になりました)。既存プロジェクトの `.claude/agents/gpt-*.md` は `optimize-agents:setup` の再実行で更新してください。

0.3.0 でエージェントテンプレートを改訂しました(gpt-luna のツール構成変更・スキルロード規律の追加)。既存プロジェクトの `.claude/agents/gpt-*.md` は `optimize-agents:setup` の再実行で更新してください。
