# Codiel agent-policy 統合の両プロファイル互換検査

- 日付: 2026-09-10
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: agent-policy orchestration-discipline.md、parallel-nudge.ts、marker-scan.ts、subagent-start.ts、delegation-gate.ts の静的検査記録
- 前提: agent-policy v0.13.0-dev、Codiel エージェント群(codiel-architect/codiel-implementer/codiel-tester)、2026-08-27 設計 § 前提・workflow 境界
- セッション ID: 90d964c7-53e6-4dea-a527-553caae3f962

---

## セッション 1: Codiel の agent-policy 両プロファイルでの共存検査と改修案

# phyllis998

> 現在のagent-policyの両プロファイルにおいて、ワークフロープラグインが持つ専用のエージェント共存(例: Codiel ただしこれに限らない)は果たせているかを検査してください。
> 基本的には同梱プラグインではなくプロジェクト側にある最適化されたエージェントを優先したいが、ワークフローを壊したくはないです。
> アイディアはありますか？

# AI

Using agent-policy:custom-policy to follow the session's delegation discipline, then investigating the code.

検査完了。結論先出し。

## 結論

役割ベース委譲の経路は両プロファイルとも共存成立。名指し dispatch の経路は「そのまま起動」に倒れるのが実態 → 最適化は届かず、届く構成(custom の合成)では破壊経路 3 つ。実機 run 未実施、規律文と実装の静的検査のみ。

## 検査結果(F1〜F7)

- **F1 役割経路: 成立(機械的)。** `orchestration-discipline.md` §委譲先の候補 が「他プラグイン同梱定義は候補外」と明記。`marker-scan.ts` の走査対象も `.claude/agents/` のみ → codiel 群が担当表へ混入する経路なし。両プロファイル同一。
- **F2 名指し経路: 合成に到達しない。** 判定表 行 2「原本を特定できない → そのまま起動」→ 他プラグイン実体は plugin cache、オーケストレーターは cache パスを知らない → 同一性の確証を得られない → 常にそのまま起動。結果、codiel 各定義は `model` 未宣言 → メインモデル継承(Fable) → コスト増・MCP 未到達。これが「最適化が届かない」の真因。
- **F3 プロファイル差: claude はモデル注入止まり、custom だけ合成。** このリポジトリの impl 系ホスト(`general-implementer` / `lead-implementer`)は gpt → claude 構成の候補外 → 行 6 モデル注入(Sonnet)。custom は行 7 合成 → 下記 F4〜F5 の破壊経路が custom 限定で開く。
- **F4 合成ホストの Agent tool × codiel SubagentStop。** `subagent-stop.ts` は agent_type を見ず「in_progress フェーズが 1 つならその成果物を検査」→ ホスト(例 `system-planner` に `codiel-architect` を合成)がアドバイザー相談 → アドバイザー停止時に design.md 不在で block → アドバイザーは Write 無し → 脱出不能。tools 上限規則(外部定義に無い Agent は使わない)は遵守依存 → frontmatter は Agent を付与したまま。
- **F5 転記条項 × codiel のスキル連鎖。** 規律「サブエージェントは依頼文で指定されたスキルだけをロードする」を dispatch 文へ転記 → codiel-tester 本文は `running-regression-tests` を条件付き追加ロード、implementer は `fixing-failures` を参照 → 転記条項が禁止 → レポート書式・修正手順が欠落。両プロファイル共通、合成有無に無関係。
- **F6 parallel-nudge × codiel 逐次規律。** `parallel-nudge.ts` は毎 Agent 呼び出しで「独立タスクは同一メッセージで並列」注入 → codiel は domain state が 1 つ → implementer 逐次必須(`orchestrating-runs` L230) → 並列化すると guard-write 境界が最後の `set-domain` 値で誤判定。既定有効、両プロファイル共通。
- **F7 優先順の未定義。** 規律「オーケストレーターは担当表の役割を自ら実行しない」vs codiel「review レポート執筆・成果物 commit・PR コメントはオーケストレーター」。2026-08-27 設計 §前提 は「skill 駆動ワークフローのオーケストレーターに本規律が届く」と認めるが、衝突時の優先を書いていない。

副次: SubagentStart は `codiel:*` を unknown 扱い → 対応表を全 codiel 子へ注入(deny-list 設計どおり、Agent 無し定義には無用、1 run で 13 回 × 最大 9.5KB)。破壊ではなくコスト。

`★ Insight ─────────────────────────────────────`
codiel のフック(guard-write / subagent-stop)は agent_type ではなく run state で判定する。これが「合成で subagent_type を差し替えても境界検査は壊れない」根拠であり、同時に「余分な子(アドバイザー)が 1 体増えるだけで誤 block する」脆さの根拠でもある。共存の可否はホスト名ではなく「子の数と成果物の対応」で決まる。
`─────────────────────────────────────────────────`

## 案(A〜D)

**推奨: A + B + D。** 理由: F2 で合成は実質死んでいる → 合成を守るより「届かない」を正直に規律へ書き、モデル注入だけ機械的に届かせる方が破壊ゼロで実益(コスト)を取れる。C は最適化を本当に届かせる唯一の経路だが実測が先。

| 軸 | A 優先順条項 | B 名指しは注入止まり | C 手書き shadow | D nudge 文言 |
| --- | --- | --- | --- | --- |
| 内容 | 規律に「ワークフロースキルの手順が衝突時優先。スキル指定 dispatch は行 1 と同扱い。転記条項はワークフロー本文のスキル連鎖を妨げない」 | 他プラグイン定義の名指しは合成せず、未宣言なら役割モデルを注入するのみ | `.claude/agents/codiel-implementer-backend.md` を利用者が手書き → 文書化された scope 優先で project が勝つ | 「前の出力に依存するとき、またはワークフロー手順が逐次を定めるときだけ逐次」へ 1 行変更 |
| 解消する所見 | F5 F7(F6 は遵守側) | F3 F4(合成経路を閉じる) | F2(MCP・本文とも機械的に到達) | F6 |
| 破壊リスク | 無し | 無し(tools/本文不変) | 中: 本文複製の drift、`codiel:` 名前空間参照まで shadow されるかは**非文書化** | 無し |
| 最適化到達 | 無し | モデルのみ | 最大 | 無し |
| コスト | 規律文のみ | 規律文のみ | 利用者の手作業 + 実測 | コード 1 行 |
| 機械的/遵守 | 遵守 | 遵守 | 機械的 | 遵守 |

C の注意: 2026-08-27 設計が却下したのは**自動生成**(hash 管理・drift)。手書き変種は未評価。採る前に (1) bare 名 vs `codiel:` 名指しの解決先、(2) shadow 時の Agent tool 一覧表示、の 2 点を実測。

**要実測(結論を変え得る)**

- Agent tool `model` param: 公式 docs は「完全 ID も可」。2026-08-27 §8 実測は enum のみ → 再測。プロキシ alias が通るなら custom の「Claude 列へ読み替え」自体が不要になる。
- codiel 側 `mcp__context7` は plugin 同梱サーバー名(`mcp__plugin_context7_context7__*`)に一致しない(docs 明記)。行 6「固有 MCP が本体か」判定に影響。codiel の課題で本件の範囲外、報告のみ。

次の一手: A/B/D 採用なら規律 3 条項 + `parallel-nudge.ts` 1 行 + バージョン上げ。C は実測セッションを別に立てる。

検査結果と案は上記のとおり。判断待ち: A/B/D の規律改修を進めるか、C の実測セッションを先に立てるか。
