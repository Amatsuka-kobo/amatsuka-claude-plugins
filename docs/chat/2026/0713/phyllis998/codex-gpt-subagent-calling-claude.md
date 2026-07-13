# Codex GPT サブエージェント と Claude Sonnet 連携の可否

- 日付: 2026-07-13
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: なし
- 前提: codex プラグイン実体（`~/.claude/plugins/cache/openai-codex/codex/1.0.6`）、`agents-with-codex.md`

---

## セッション1: Codex プラグインの構造と制約

# phyllis998

> codexプラグインで起動したGPTサブエージェントは、Claude Sonnetをサブエージェントとして呼び出すことはできますか？

# AI

**結論: いいえ（ネイティブなサブエージェント機構としては不可）**

codex プラグインで起動する「GPTサブエージェント」は、Claude Code のサブエージェント機構（Agent/Task ツール）を呼び出せない。したがって GPT が Claude Sonnet をサブエージェントとして呼ぶことはできない。

**理由 — 3層の構造と境界線**

このリポジトリで使う codex プラグイン（`~/.claude/plugins/.../openai-codex/codex/1.0.6`）は以下の入れ子構造になっている：

```
Claude Code メインセッション (Opus)
  └─ codex-rescue エージェント        ← Claude の Sonnet サブエージェント
        └─ Bash: node codex-companion.mjs
              └─ Codex CLI (app-server)  ← OpenAI 独立ランタイム（GPT-5.x-codex）
```

ポイントは以下の通り：

1. **`codex-rescue`（agents/codex-rescue.md:1-5）は Claude の Sonnet サブエージェント**だが、その実装は「Bash で `codex-companion.mjs` に丸投げするだけ」の薄いラッパーに徹するよう明記されている（`tools: Bash` のみ、それ以外の作業禁止）。

2. その先の **Codex CLI は OpenAI 独立のエージェント・ランタイム**である。`codex-companion.mjs` は `runAppServerTurn` で Codex の app-server プロトコルを叩いて GPT を回す。ここで動く GPT が持つツールは **Codex 側のツール群（shell / apply_patch など）だけ**で、Claude Code の Agent/Task ツールは見えない。プロセスも認証（OpenAI サブスク）も別系統。

**「サブエージェント」という言葉の曖昧さ**

`codex-rescue` は *Claude の* サブエージェントだが、その内側の GPT は *Claude Code の枠外にいる別プロセス* で、両者はサブエージェント関係ではなく **Bash 経由のプロセス呼び出し** でつながっているだけ。Claude Code の Agent/Task ツールは「同じセッションが子エージェントを spawn する」仕組みなので、外部プロセス（Codex CLI）からは原理的に到達不能。

**理論上の抜け道（ただし別物）**

GPT（Codex CLI）は shell ツールを持つので、自分のシェルから `claude -p "..."（ヘッドレス実行）を叩くことは理屈の上では可能。ただし：

- **「サブエージェント」ではなく単なる shell コマンド実行**である
- codex プラグインはそのような配線をしていない（Codex CLI にそう指示するプロンプトも設定もない）
- 呼ぶ側の Codex の設定・許可次第で、環境によっては動かない可能性がある

これらの理由から、質問の「Claude Sonnet をサブエージェントとして呼ぶ」には該当しない。

**実現したい場合の正しい設計**

GPT に実装させつつ Claude にレビューさせるなど、同様の目的があれば、正しい設計は「**Claude 側のオーケストレーターが GPT と Claude 両方を呼び分ける**」形になる。これは `agents-with-codex.md` の Fable（設計・監査）と GPT Sol（実装）の分業体制そのものである。

---

注意事項: なし（回答のみ。ファイル作成・コミット一切なし）
