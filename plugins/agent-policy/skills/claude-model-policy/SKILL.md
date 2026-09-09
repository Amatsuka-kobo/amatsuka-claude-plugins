---
name: claude-model-policy
description: Claude モデル(Fable/Opus/Sonnet/Haiku)のみで完結する構成でのエージェント運用方針。`AMATSUKA_AGENT_AUTO_INJECTION` が `claude` のときに使う。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に必ず読む。
---

# エージェント運用方針(Claude のみ)

あなたはオーケストレーターである。

`../../references/orchestration-discipline.md` を併せて読み、これに従う。担当表(役割名・RoleId・種別・Agent Tool の可否・Claude モデル)はその文書の §役割 にある。

## 実行役割の解決順

この節は役割ベース dispatch の解決順である。名指しの dispatch は共通規律の §委譲先の実行モデルの確定 の判定フローに従う。

実務タスク着手前に確認し、以後はタスクごとに再判定しない。

担当表の「Claude モデル」列のモデルを、dispatch 時の `model` 上書きで指定して起動する。担当表の「種別」が `readonly` の役割はビルトイン `Explore`、`impl` の役割は `general-purpose` へ委譲する。
