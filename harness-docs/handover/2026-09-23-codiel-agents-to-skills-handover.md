# codiel の同梱 Agent 定義撤去 引き継ぎ書

- 日付: 2026-09-23
- 引き継ぎ元: 設計セッション(実装は未着手)
- 引き継ぎ先: 実装セッション
- 対象プラグイン: `plugins/codiel`(`0.8.0-dev` → `0.9.0-dev`)、`plugins/agent-policy`(`0.19.6-dev` → `0.19.7-dev`)、`plugins/metatron`(`0.3.7-dev` → `0.3.8-dev`)

## 現在地

| 工程 | 状態 |
| --- | --- |
| 事実調査 | **完了**。context-map で一次確認済み |
| 方針決定 | **確定**。ユーザー指摘を 6 段階で反映済み |
| 設計書 | **完成** |
| 実装計画書(WBS) | **完成**。22 タスク、8 コミットに分割済み |
| 実装 | **未着手** |
| レビュー | `doc-review` と `independent-review` が完了し、指摘を反映済み |
| 未解決事項 | **0 件** |

この文書を起点に実装を再開できる。詳細な変更手順と根拠は、設計書・実装計画書の参照先の節を読むこと。

## 次セッションが最初にやること

1. `git status` と HEAD を確認する。本件と無関係な未コミット変更が作業ツリーにあれば、revert・削除・上書き・コミットへの混入を含めて**触らない**。
2. `pnpm run lint`、`pnpm run typecheck`、`pnpm run test` を実行し、すべてパスする baseline を実装計画書 §0.2 に記録する。
3. 実装計画書 §0 を読み、T0 から着手する。設計書 §1 の 12 件は確定済みであり、設計判断を再議論しない。

## 確定した決定

設計書 §1 の 12 件を実装の前提として扱う。詳細は各参照先に従う。

| 論点 | 決定 |
| --- | --- |
| 残す Agent の範囲 | `codiel-analyst` と `codiel-test-designer` の 2 体を残し、13 体を削除する。`codiel-tester` も削除対象である(設計書 §5.1、§6.3) |
| フェーズごとの委譲先 | 委譲は作業内容で表す。役割名と解決機構は書かない(設計書 §5.2、§6.2) |
| 解決の規律が無い環境 | 成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore` へ縮退する(設計書 §5.3) |
| スキル本文の届け方 | 依頼文に絶対パスを示し、必要なスキルをすべて `Read` するよう指示する(設計書 §5.4、§6.2) |
| 削除する Agent の固有部 | 観点ごとの個別ファイルにし、各スキル配下の `references/` に置く。プラグイン直下の `references/` と `assets/` は作らない(設計書 §5.5、§6.1) |
| 依頼文テンプレート | `orchestrating-runs/SKILL.md` §3 を、作業内容・絶対パス・読み取り限定条項・git 操作禁止・転記欄を持つ形へ改める(設計書 §5.6、§6.2) |
| SubagentStop hook | src、build エントリ、hooks.json、バンドルを廃止する(設計書 §5.7、§6.4) |
| agent-policy の追随 | parallel-nudge の注入文と orchestration-discipline の 1 条項を改める(設計書 §5.8、§6.5、§6.6) |
| バージョン | codiel はマイナー、agent-policy と metatron はパッチを上げる(設計書 §5.9、§6.9) |
| description の発火測定 | 測定しない。description は Agent 名の除去だけに限る(設計書 §5.10) |
| 残る 2 体の `model` | 宣言せず、オーケストレーターのモデルを継承させる(設計書 §5.11) |
| `e2e-verify` の種別 | `readonly` から `impl` に昇格させる。Agent Tool の可否とモデル割当は変えない(設計書 §5.8、§6.11) |

## ユーザー指摘による 6 段階の改定

同じ案を再提案しないため、改定の経緯を残す。

| 段階 | 改定 | ユーザーの理由 |
| --- | --- | --- |
| 1 | codiel の指示層から解決機構への言及を外した | 併用時は二重管理になり、単体運用時には機構そのものが存在しないため |
| 2 | 役割名による指定も外し、作業内容だけを渡す形にした | 役割名を固定すると、作業の重さに応じた委譲先の選択ができなくなるため |
| 3 | 注意と観点をスキル本文へ統合せず、個別ファイルへ分けた | 今後の強化・追加で、他の観点を読む委譲先へのノイズになるため |
| 4 | `codiel-tester` も削除対象に加えた | tools の組合せは一般的で、固有規律はスキル本文で表せるため |
| 5 | `e2e-verify` を `impl` に昇格させた | tester 廃止後にテストスクリプトを作成・実行する作業を、readonly のままでは受けられないため |
| 6 | 未解決事項を 3 件とも解消し、0 件にした | 6 観点の統合は粒度を失い、発火測定は対象となる自律起動がなく、残る Agent の `model` は未宣言と決められたため |

設計書 §1、§5.1、§5.2、§5.5、§5.8、§5.10、§5.11、§12 を参照すること。

## 再提案しない不採用案

設計書 §10 には不採用案が **21 件**ある。いずれも再提案しない。特に次は設計の前提を崩すため、実装中の代替案にしない。

- codiel の指示層に役割名や委譲先の解決機構を書く。
- implementer の注意と reviewer の観点をスキル本文へ統合する。
- `codiel-tester` を残す。
- `e2e-verify` を `readonly` のままにする。

## 実装時に踏みやすい点

設計書 §9 と実装計画書 §6 をあわせて確認すること。

- C2(T4〜T6)でディスパッチ規約を改める前に Agent を削除すると、削除済みの Agent を指定する中間状態の run が壊れる。C2 → C3 の順を守る。
- 登録簿の追加 2 件は T2 と同じコミットに、削除 16 件は T7 と同じコミットに入れる。分けると metatron の V2 または V3 が落ちる。
- `e2e-verify` の昇格では、`session-start.mjs`、`subagent-start.mjs`、`delegation-gate.mjs`、`setup-agents.mjs` の 4 バンドルにも差分が出る。T10 の完了条件「差分は `parallel-nudge.mjs` だけ」は、T10 時点に限る。
- `roles.ts` と担当表のどちらか一方だけを変えると、`discipline-role-table` のテストが落ちる。T11b で両方をそろえる。
- `plugins/codiel/src/hooks/__test__/guard-write.test.ts` は書き換えない。書き換えが要ると判断した時点で実装を止めて報告する。

## このセッションで確定させた事実

次の事項は再調査を要しない。

- 先行設計は `e2e-verify` の `readonly` を設計判断として正当化していない。この値は 2026-09-09 の設計書に担当表の写しとして記され、引き継がれてきた値である(設計書 §2.5、§5.8)。
- `codiel-tester` の参照は 17 箇所ある。このうち `plugins/codiel/src/hooks/__test__/guard-write.test.ts:337` はコメントであり、変更しない。
- `section-reference-inventory.json` の `plugins/codiel/agents/` のエントリは 17 件であり、`codiel-tester.md` と `codiel-test-designer.md` は含まれない。したがって `41 − 16 + 2 = 27` となる(設計書 §6.7、実装計画書 §0.3)。
- `prompt-smith:agent-creator` を起動するタスクはない。残る 2 体の Agent 定義は変更せず、削除する 13 体はファイルごと削除する(実装計画書 §1、T7)。

## スコープ外

- 実 run による動作検証は完了条件に含めない。
- `.claude/agents/complex-reviewer.md` は再生成しない。
- codiel に evals を作らない。

## 参照

- 設計書: `harness-docs/design/2026-09-22-codiel-agents-to-skills-design.md` (§1、§5〜§12)
- 実装計画書: `harness-docs/plans/2026-09-22-codiel-agents-to-skills-plan.md` (§0、§2、§5〜§7)
- context-map: `.claude/context-maps/2026-09-22-codiel-agents-to-skills.md`
- 2026-09-10 の互換検査: `docs/chat/2026/0910/phyllis998/1155-codiel-agent-policy-compatibility.md`
- 2026-09-15 の引き継ぎ書: `harness-docs/handover/2026-09-15-codiel-domain-map-decoupling-handover.md`
- 2026-09-15 の設計書: `harness-docs/design/2026-09-15-codiel-domain-map-decoupling-design.md`
