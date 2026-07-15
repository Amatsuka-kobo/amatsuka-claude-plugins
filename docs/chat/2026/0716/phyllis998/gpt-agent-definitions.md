# GPT エージェント定義の作成

- 日付: 2026-07-16
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `codex/gpt-sol.md`、`codex/gpt-terra.md`、`codex/gpt-luna.md`
- 前提: `CLAUDE.md` の「エージェント運用方針」、`agents-with-codex.md`

---

## セッション 1: エージェント運用方針に基づく定義の作成

# phyllis998

> エージェント運用方針にそって、claude-gpt-5-6-sol, claude-gpt-5-6-terra, claude-gpt-5-6-luna をそれぞれ model 指定した Agent 定義を作成してください。

# AI

現行のエージェント運用方針（CLAUDE.md）に基づき、前回コミット 38e7623 で削除された旧 GPT エージェント定義をベースに、以下の 3 つの定義を `codex/` 配下に新規作成した。

**作成したファイル:**

- `codex/gpt-sol.md` — `model: claude-gpt-5-6-sol`。複雑な実装（アーキテクチャ判断・非自明なトレードオフを伴う処理）専任。
- `codex/gpt-terra.md` — `model: claude-gpt-5-6-terra`。通常の実装と、レビュー・調査・分析を除く一般作業の基本担当。
- `codex/gpt-luna.md` — `model: claude-gpt-5-6-luna`。一括適用・一括チェック・軽微なコード変更などの軽量タスク担当。

**旧定義からの主な変更点:**

旧版では Sol が「設計・実装計画・レビューへのアドバイザー」を兼務していたが、現行の CLAUDE.md エージェント運用方針ではアドバイザー役が `Fable` に移行した。これに伴い、Sol は複雑な実装専任に役割を絞った。

**Agent ツール付与と入れ子禁止の実装:**

現行方針の「サブエージェントがアドバイザー（`Fable`）に相談できるよう Agent Tool を許可する」に従い、3 エージェント全てに `tools` に `Agent` を追加。同時に「呼び出した `Fable` には Agent ツールを使わせない指示を依頼文に必ず書く」ことを本文で義務付け、方針の「サブエージェントは自身が起動するサブエージェントに Agent Tool を許可してはならない」を満たしている。

3 ファイル共通の特性：
- 各定義は「自分はサブエージェントである」ことを明示
- 迷ったときだけ `Fable` をアドバイザーとして呼ぶ手順を含む
- CLAUDE.md のプラグイン開発制約（Anthropic API 前提の実装禁止・plugin.json のバージョン更新）を本文に組み込み

---

注意事項: `codex/` はプラグイン本体ではないため、`plugin.json` のバージョン更新は不要。実際に使用する際には従来どおり `.claude/agents/` へのシンボリックリンク配備が必要だが、その配置はユーザーの運用（GPT の利用可否）に委ねられる。
