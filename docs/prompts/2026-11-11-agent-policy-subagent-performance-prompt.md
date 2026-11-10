# agent-policy 改修(サブエージェントの性能策と codiel との食い違いの解消)の実装 セッション起動プロンプト

以下を goal コマンドの入力として使う。作業場所はリポジトリ `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins` の main である。

---

agent-policy の改修を、実装計画書の T0〜T8 のとおりに実装する。

## 最初に読む文書

1. `harness-docs/handover/2026-11-11-agent-policy-subagent-performance-handover.md`(決まったこと・未決のこと・踏みやすい点)
2. `harness-docs/plans/2026-11-11-agent-policy-subagent-performance-plan.md`(タスク・分岐・契約)
3. `harness-docs/design/2026-11-10-agent-policy-subagent-performance-and-codiel-gaps-design.md`(正本。0 章・4〜7 章・11 章・13 章)

引き継ぎ書の「決まったこと」と設計書の決定 D1〜D20・判断 J1〜J29 は再検討しない。

## 進め方

1. T0 の試作 S1〜S7 を最初に行う。T1 の前に、改修前の定義をリポジトリの外の消えない場所へ保存し、パスを計画書 5 章に記録する(Step 0)。
2. 試作の結果を計画書 5 章に記録し、T0 の「分岐」の表に従って後のタスクを変える。S1 で fork が委譲を始めて直らないとき、S2 で修正の作業全体の費用が再開のほうが高いときは、止めてユーザーに聞く。
3. T1〜T8 を順に進め、タスクごとにパスを指定してコミットする。
4. `src/` を変えるタスクは、失敗するテストを先に書く。`pnpm --filter agent-policy-scripts build` の差分を同じコミットに入れる。
5. 指示書は `prompt-smith:prompt-smith` を起動してから書く。
6. 各タスクのレビューの時点・回し方・止め方は、このセッションの運用方針(SessionStart が注入する方針スキル)に従う。
7. T8 で、改修した規律と生成した定義を使い、新しいセッションで S2・S5・S6 を確かめ直す。オーケストレーターは計画書が名指しするモデル(Opus・Fable・Sonnet)で試す。
8. 実機の確認(T0・T8)は、計画書 1-1 の手順どおり、リポジトリの外の試験用のプロジェクトで `claude -p --setting-sources project --plugin-dir <プラグインのディレクトリ>` で起動したセッションで行う。バージョンを上げないので、インストール済みのキャッシュには改修が入らない。`-p` でバックグラウンドの委譲先を待てないときは、計画書の分岐の表のとおり、ユーザーに対話のセッションで行ってもらう。

## 制約

- 指示書(`skills/`・`references/`・`assets/`)に codiel の名前も固有の語も書かない。「Workflow」「Auto Ask」「委譲の指定」「`declined`」も書かない。Jev の名前も書かない。外側の手順は「このプラグインの外のスキルやコマンドが定める手順」と書く。
- 設計書 5.1 の「両立しない例」の表は、規律に写さない。
- 担当表(13 役割)と `hooks/hooks.json` は変えない。
- このリポジトリの `.claude/agents/` の 13 定義は作り直さない。試験は、試験用のプロジェクトで生成した定義で行う。
- 指示書には、他プラグインの名前、設計書の D・J の番号、行番号を書かない。設計書の箇条は条項の文面に書き直す。
- バージョンは `0.21.8-dev` のまま上げない。
- ブランチと worktree を作らない。
- `.claude/settings.local.example.json`(ステージ済み)、`.claude/settings.json`、`docs/chat/` の変更をコミットに混ぜない。
- `harness-docs/ARCHITECTURE.md`・`harness-docs/GOTCHAS.md`・`.claude/rules/metatron/` は Edit しない。影響があれば `/metatron:update` を使う。
- 日本語は native-japanese の規律に従う。「節」「段」「版」「契機」を使わない。

## Done の条件

- T0〜T8 が計画書どおりに済み、試作と実機の確認の結果が計画書 5 章に記録されている。
- `pnpm run lint`・`typecheck`・`test`・`build` が通り、`scripts/` の差分が対応する `src/` の変更と同じコミットにある。
- プラグインの README・ルートの README・`.serena/memories/agent_policy/core.md`・食い違いの文書が改修に追随している。
- ARCHITECTURE に影響があれば、`/metatron:update` で追随させている。
- `plugin.json` と `package.json` が `0.21.8-dev` のままである。
- 変更がタスクごとに分けてコミットされている。
