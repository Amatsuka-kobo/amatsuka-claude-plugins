# optimize-agents

`optimize-agents` は、あまつか工房のエージェント運用を最適化する(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map 作成によるコスト最適化)ための規律を配布可能な Skill として提供する。CLAUDE.md にこの Skill へ従う旨を書くだけで、任意のプロジェクトに同じ最適化施策を持ち込める。

## 提供 Skill

- `optimize-agents:with-codex-policy` — Claude + Codex(GPT)併用構成での最適化方針。
- `optimize-agents:claude-model-policy` — Claude のみで完結する最適化方針(プロキシ不要)。
- `optimize-agents:setup-gpt` — with-codex-policy で使う GPT Agent 定義を `.claude/agents/` に生成するウィザード。
- `optimize-agents:prompt-smith` — AI が読み手となる指示書(CLAUDE.md・SKILL.md・コマンド定義等)の**本文**と、`references/` に置かれた文書の基準と工程。新規作成時の規律と、既存文書の評価・是正の両方で使う。`references/` 配下でも、外部仕様の写しやスキーマ定義のように**引くために置かれた記述**には重複・例・出典の基準を当てない(設計は `docs/prompt-smith-references-scope.md`)。
- `optimize-agents:agent-creator` — **Agent 定義**(subagent)の作成と検証。frontmatter の仕様は `references/agent-definition-spec.md`、本文は `prompt-smith`、description は `references/description-guide.md` に従う。

SKILL.md・コマンド定義の description も `references/description-guide.md` に従って書く。

このプラグインはスクリプトを同梱しない。Skill と `references/` の文書だけで構成する。

## 使い方(CLAUDE.md への記載)

**どちらを選ぶか:** Codex 系 GPT モデルを配信するプロキシ環境がある → `with-codex-policy` / それ以外(Claude のみ)→ `claude-model-policy`。

with-codex-policy を使う場合、CLAUDE.md に次のように書く:

```markdown
## エージェント運用方針

- エージェント運用は `optimize-agents:with-codex-policy` に従う。
- GPT エージェント(gpt-sol / gpt-terra / gpt-luna)が未生成の場合は `optimize-agents:setup-gpt` を実行して `.claude/agents/` に生成する。
```

claude-model-policy を使う場合:

```markdown
## エージェント運用方針

- エージェント運用は `optimize-agents:claude-model-policy` に従う。
```

## 前提条件

- `claude-model-policy`: 追加の前提なし。プロキシ・GPT・外部 API は不要。
- `with-codex-policy` + `codex@openai-codex`: Claude Code から Codex CLI にタスクを委譲できる codex プラグインがインストールされ、使用可能であること。
- `with-codex-policy` + `setup-gpt`: Codex 系モデルを配信するローカルプロキシ(任意の ProxyAPI サーバー)経由で Claude Code を起動していること、`/v1/models` に使用するエイリアスが含まれること。構築手順は本 README では扱わず、要件のみ記載する。プロキシ・OAuth・秘密値はこのプラグインが管理しない。

## モデルエイリアスについて

`claude-gpt-5-6-sol` 等は、モデル本体の ID ではなく、ProxyAPI サーバーが配信するクライアント側の別名である。名前に `claude-` が付くが上流は Codex GPT である。エイリアスはプロキシ設定に依存する拡張であり、標準 model 値(`inherit` / `sonnet` / `opus` / `haiku`)と同じ可搬性は仮定しない。`setup-gpt` でプロジェクトごとに差し替え可能。

## 他プラグインとの棲み分け

- 本プラグイン(`optimize-agents`)=「誰に任せるか」(モデル別役割分担・委譲先の決定)を最適化する。
- `revelation`=「どう進めるか」(タスク分解・自己検証・次の一手の選び方)。両者は併用可能で、同じ局面で両方が発動しても矛盾しない(役割分担 vs 進め方で関心が異なる)。
- `plugin-dev`=プラグイン開発の文脈で Agent やスキルを作る。`agent-creator` と担当が近いので、違いを次に示す。

| 項目               | `optimize-agents:agent-creator`                                  | `plugin-dev`                            |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------- |
| description の様式 | `references/description-guide.md` の基準。`<example>` は使わない | `<example>` ブロックを含む独自様式      |
| 本文の基準         | `prompt-smith` へ委譲                                            | スキル内に自前の指針                    |
| frontmatter の仕様 | 公式 16 フィールドを reference に記録                            | name/description/model/color を必須扱い |
| 検証               | `agent-creator` の §既存定義を点検する(project 配下も対象)       | `validate-agent.sh`                     |
| 想定文脈           | 任意の Agent 定義                                                | プラグイン開発                          |

`<example>` を使わない判断の根拠は `docs/agent-creator-rationale.md` に記載する。公式ドキュメントに記述がないためであり、効果が無いと測ったわけではない。

- 他プラグイン・自作 Agents との併用: Claude Code の Agents は `model` を省略すると `inherit`(委譲元と同じモデル)になる。optimize-agents はこれを検出して担当表どおりの実行帯へ寄せる規律を持つ。対象は `model` 未指定 / `inherit` の Agents 定義全般で、プラグイン由来(例: Codiel の `codiel-implementer-*`)・プロジェクトやユーザーの自作・ビルトイン(`Explore` / `Plan` / `general-purpose`)を問わない。逆に `model` が具体的なモデルに指定された Agents は定義者の意図表明として尊重し、対象外とする。`with-codex-policy` では、実行帯が GPT に相当するフェーズで役割定義本文を GPT エージェントへの依頼文に注入する合成方式(役割プロンプト × GPT 実行)をとる。詳細な判断フローは `references/orchestration-discipline.md` の §委譲先の実行モデルの確定 に記載。

## 設計上の確定事実(dispatch 時の model 上書き制限)

**確定事実(2026-07-20 実測検証済み):** Agent tool の dispatch 時 `model` 上書きパラメータは enum(`sonnet` / `opus` / `haiku` / `fable`)に制限され、カスタムエイリアス(`claude-gpt-5-6-*`)は実行前にバリデーションエラーで拒否される。カスタムエイリアスが有効なのは Agents 定義 frontmatter の `model` フィールドのみである。将来 enum が緩和されたら dispatch 上書き方式を再検討する。

これが `with-codex-policy` の §実行帯が GPT モデルの場合の dispatch で「実行帯が GPT の場合は dispatch 時の `model` 上書きを使わず、役割定義本文を依頼文に同梱する」方式を採る理由である。

## アップデート時の注意

0.14.0 で全 5 スキルと 4 つの `references/` 文書を `prompt-smith` の基準で再点検し、40 件を是正しました。CLAUDE.md 側の記載変更は不要です。

- **SKILL.md の description の担当を `references/description-guide.md` に移しました。**0.13.0 で削除した `skill-eval` を指したままの記述を差し替えたものです。
- **削除済みスクリプトへの参照を落としました。**`scripts/` は 0.13.0 で削除済みで、このプラグインはスクリプトを同梱しません。Agent 定義の点検は `agent-creator` の §既存定義を点検する が担います。
- `with-codex-policy` の §GPT が使えない場合のフォールバック を §実行帯の解決順 へ改称しました。1 番目の項は通常経路でありフォールバックではないためです。
- `agent-creator` に §既存定義を点検する を追加しました。description が既存定義の点検を担当と書いていた一方、手順が新規作成しか扱っていませんでした。

0.13.0 で skill-eval と description の測定機構を削除しました。
(実測に基づいた規律だけで十分であると判断したため)

0.12.0 で次を変更しました。CLAUDE.md 側の記載変更は不要です。

- **セットアップウィザードのコマンド名を `/optimize-agents:setup` から `/optimize-agents:setup-gpt` へ変更しました(破壊的変更)。**旧名は使えません。手順書やスクリプトに `/optimize-agents:setup` を書いている場合は書き換えてください。
- **`commands/` 配下のコマンド定義を対象に加えました。**本文は `prompt-smith`、description は `skill-eval` が担当します。コマンド定義の発火は測れないため、測定対象は skill のままです。
- **`scripts/check-skill-definition.mjs` を追加しました。**SKILL.md とコマンド定義の frontmatter を静的検査します。
- `skill-eval` に規律を足しました(新規スキルを作るときの baseline 測定・assertion の書き方・見て直す問と測る問の分離・発火を担う語の見極め・配布するスキルの eval の書き方)。
- **同梱の eval セット 80 問を汎用化しました。**このリポジトリ固有のファイル名・プラグイン名を架空の名前へ置き換え、配布先でも成立する形にしました。経緯と実測は `docs/eval-set-genericity.md` にあります。
- `references/description-guide.md` に §長さの上限(1536 字)と §対象を広げるとき を足しました。後者は、別種の対象を指す例示を足すと既存の正例の発火が落ちるという実測に基づきます(`docs/skill-creator-intake.md`)。
- `skill-eval` に §測れないスキルを見分ける を足しました。発火条件がプロジェクトの状態(CLAUDE.md の記載・特定ファイルの存在)にあるスキルは、この測定器のサンドボックスでは条件を再現できないため測りません。実測は `evals/README.md` にあります。
- **`setup-gpt` の eval セットを追加しました。**policy 2 種は上記の理由で対象外とし、その判断を `evals/README.md` に記録しました。
- 全 6 スキルと 4 つの `references/` 文書を `prompt-smith` の基準で見直し、根拠・重複・出典を本文から外しました(37 件)。振る舞いを変える指示は残し、将来の判断の入力になる根拠は `docs/` へ退避しています。

  0.11.1 で `prompt-smith` の対象を `references/` 配下の文書へ広げました。対象は置き場所(`references/` というディレクトリ名)で決まり、プラグインを問いません。指示書が参照していても `docs/` や README は対象外のままです。あわせて、外部仕様の写し・スキーマ定義・網羅を要する列挙のような**引くために置かれた記述**には重複・例・出典の基準を当てない例外を設けました。CLAUDE.md 側の記載変更は不要です。

  0.11.0 で `skill-eval` と `agent-creator` を追加し、`scripts/` に 4 本の測定・検証スクリプトを同梱しました。あわせて description の基準と発火精度の測定を `skill-eval` の担当としたため、CLAUDE.md にこれらを記載する必要がなくなりました。次の 2 行を書いている場合は削除できます。

```markdown
- SKILL.md・Agents 定義の description は `optimize-agents` の `references/description-guide.md` の基準で書くこと。
- スキルの発火精度を測る時は `scripts/run-trigger-eval.mjs` を使うこと。
```

本文の基準を示す行(`optimize-agents:prompt-smith` を参照するもの)は残してください。

0.9.0 で 2 つの policy Skill が共有していた規律(モデル別役割の運用・委譲先の実行モデルの確定・コードベース探索・コスト規律・設計/実装計画の規律)を `references/orchestration-discipline.md` に集約しました。各 policy Skill は担当表と自プロファイル固有の分岐のみを持ち、共通規律を参照します。CLAUDE.md 側の記載変更は不要です。

0.8.0 でプラグイン名を `agent-policy` から `optimize-agents` へ、スキル名を `with-codex`→`with-codex-policy`・`claude-only`→`claude-model-policy` へ改名しました(「規律を定める」から「エージェントを最適化する」というコンセプトへの転換)。CLAUDE.md 等で旧名称を参照している場合は書き換えてください。

0.4.0 でエージェントテンプレートを改訂しました(コードベース探索の統括が GPT Sol から Opus に移り、GPT 三体は探索実働の担当になりました)。既存プロジェクトの `.claude/agents/gpt-*.md` は `optimize-agents:setup-gpt` の再実行で更新してください。

0.3.0 でエージェントテンプレートを改訂しました(gpt-luna のツール構成変更・スキルロード規律の追加)。既存プロジェクトの `.claude/agents/gpt-*.md` は `optimize-agents:setup-gpt` の再実行で更新してください。
