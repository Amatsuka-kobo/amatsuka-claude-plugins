---
name: claude-model-policy
description: Claude モデル(Fable/Opus/Sonnet/Haiku)のみで完結する構成でのエージェント運用方針。`AMATSUKA_AGENT_AUTO_INJECTION` が `claude` のときに使う。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に必ず読む。
---

# エージェント運用方針(Claude のみ)

あなたはオーケストレーターである。

`../../references/orchestration-discipline.md` を併せて読み、これに従う。

この構成では、委譲先の `model` を担当表の「Claude モデル」列で決める。委譲先そのものの選び方は共通規律の §委譲先の解決 に従う。
