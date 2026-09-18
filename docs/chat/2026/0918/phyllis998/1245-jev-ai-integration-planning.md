# Jev AI 統合戦略と役割設計

- 日付: 2026-09-18
- 参加者: phyllis998、AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: `plugins/agent-policy/README.md`、`plugins/agent-policy/references/orchestration-discipline.md`、agent-policy 現行定義
- セッション ID: de77ea61-8bcf-417b-ba59-b5dfee28af6f

---

## セッション 1: Jev AI 統合の役割割当と経路検討

# phyllis998

> 最近新しく出たJevというAIが話題です。
> これについてどんなものなのか詳しく教えてください。
> また、このリポジトリ内で使用する場合どのように使うのが最適か、仮にagent-policyに適用する場合どのような役割をあたえたらよりUXが良くなるか、考えてください。

# AI

調査と役割設計に入る。まず方針スキルを読み、並行で Jev の最新情報とこのリポの agent-policy 役割を取る。

方針スキル読了。規律と既存の役割設計を読み、Jev 調査は realtime-research へ委譲する。

規律確認。Jev 調査は realtime-research、役割設計は現行担当表と定義を突き合わせる。

推奨役割マップと現行定義を読む。Jev 調査は裏で走る。

Jev の一次情報は調査中。先に、このリポで載せる経路と役割割当の判断軸だけ置く。事実が揃い次第、製品の中身と推奨役割を足す。

---

## このリポで使う経路（Jev の正体に依存）

agent-policy は **Agent 定義を同梱しない**。モデル追加は「プラグインに焼き込む」ではなく、次のどれか。

1. **プロキシにモデルが乗る（Anthropic 互換 API）**  
   最短。`ANTHROPIC_BASE_URL` の `/v1/models` に ID が出れば、`/agent-policy:setup-agents` で役割を付けて `.claude/agents/` に定義を生やす。SessionStart が実在検証 → `custom-policy` が対応表注入。  
   今のこのリポはまさにこの形（Grok / GPT / Claude 混在）。

2. **推奨カタログへ正式追加**（`plugins/agent-policy/src/agents/policies.ts` の `MODELS` / `RECOMMENDED` / `Vendor`）  
   利用者が毎回手で選ばなくて済むようにするときだけ。テストが「10 モデル」を固定しているので、追加はパッチではなく minor 相当。ベンダーが gpt/grok/gemini/claude の外なら `Vendor` 型も拡張。

3. **別製品（Devin / Jules 型の独立エージェント）**  
   agent-policy の委譲先にならない。こちらは Claude Code のサブエージェントハーネス。別ランタイムを役割に載せる設計は、過去に API/CLI 前提で失敗している（Codiel と同じ轍）。**役割にしない。**

4. **独自役割をプロジェクト断片で足す**  
   `.claude/agent-policy/roles/` に `id` を置けば setup の選択肢に出る。17 役割の置換も可。新モデル専用の仕事が既存 RoleId に収まらないときだけ。

---

## 現行配置（このリポ）

判断軸は「能力」より **ベンダー分離** と **失敗コスト**。

- **Grok** (`claude-grok-4-6`): `explore` / `realtime-research` / `independent-review`  
  探索・調査のスループット。独立レビューは実装側（GPT）・計画側（Claude）とベンダーをずらすため。
- **GPT**: 実装一式（complex/normal/light/escalation）+ 文書 + 最終レビュー/ゲート
- **Claude**: 設計統括・計画・知識抽出・コードレビュー

`RECOMMENDED` 上の Grok は `normal-impl` / `light-impl` / `explore` / `realtime-research` / `independent-review`。このリポは実装を GPT に寄せ、Grok は読み取り帯に閉じている。

---

## 役割を決める軸（Jev が来たらここに当てる）

推奨を先に出さない。軸が埋まってから選ぶ。

- **独立性**: 実装ベンダーと違うか。違う → `independent-review` が最優先候補。今 Grok が担っている席。
- **Web/最新情報**: 強い → `realtime-research`（今 Grok）。主セッションが Grok なら、調査を別ベンダーへ移す意味が出る。
- **安・速・ツール多用**: `explore` または `light-impl`。探索実働は並列が多く、レイテンシと単価が UX に直撃する。
- **コーディング本体が強い**: `normal-impl` か `complex-impl`。ただしこのリポの実装は GPT に寄っている。載せ替えは回帰コストが大きい。
- **長文・計画**: `design-plan` / `explore-lead` は今 Claude Opus 相当。ここを動かすのは最終手段。
- **ゲート/最終レビュー**: 失敗コスト最大。新モデル初手では載せない。

Jev が「モデル」なら setup-agents で 1 役割だけ載せて観測。カタログ追加はその後。  
Jev が「独立エージェント製品」なら、このリポでは使わない（別窓・別ワークフロー）。

調査側の一次情報が返り次第、上記の軸に当てて推奨役割を1つに絞る。

調査継続中。一次情報が返り次第、Jev の中身と推奨役割を足す。
