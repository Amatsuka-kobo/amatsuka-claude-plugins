# agent-policy 役割体系改修 引き継ぎ書

- 日付: 2026-09-24
- 引き継ぎ元: 設計・計画セッション(実装は未着手)
- 引き継ぎ先: 実装セッション
- 対象プラグイン: `plugins/agent-policy`(`0.19.8-dev` → `0.20.0-dev`)

## 現在地

| 工程 | 状態 |
| --- | --- |
| 設計書 | 完成。第 3 版で、理解レビュー(Haiku)と独立レビュー(Grok)の指摘を反映済み |
| 実装計画書 | 完成。第 3 版。T0〜T16(T1b を含む)とコミット単位を定義済み |
| ユーザー承認 | 取得済み。設計判断は確定している |
| 実装 | 未着手 |
| 未解決事項 | 1 件。敵対的レビュー定義の名前とモデルを T16 でユーザーに確認する |

設計書は `harness-docs/design/2026-09-24-agent-policy-role-overhaul-design.md`、実装計画書は `harness-docs/plans/2026-09-24-agent-policy-role-overhaul-plan.md` である。どちらも HEAD `beda2ee` 以降のコミットで追加されている。

作業ツリーには本件と無関係な未コミット変更がある。`cliproxyapi.config.example.yaml` と `docs/chat/` 配下には触れない。

## 次セッションが最初にやること

1. この引き継ぎ書、設計書 §2・§11、実装計画書 §0〜§2 の順に読む。
2. T0 として `git status`、`pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build` を実行する。方針スキル本文と規律の合計も `wc -c` で測り、baseline の 26,737B と照合する。
3. baseline が通った後、T1 から計画書の順序とコミット単位で実装する。確定した設計を実装中に再検討しない。
4. T16 に入る前に、敵対的レビューの新規定義に使う名前とモデルをユーザーに確認する。

## 確定した決定

設計書 §2 を正本とする。実装では次の要約だけで判断を補わず、詳細は該当節に従う。

| 要件 | 決定 |
| --- | --- |
| 1. 執筆基準 | `doc-writing` を廃止する。執筆基準は `_common.md` の新節(ja `## 文書の執筆`、en `## Writing`)と規律に置く。`writingHeading` を加え、`compose.ts` は常に出力する。F1 と D1 は撤去し、オーケストレーターは文書を書ける。GOTCHA-002 の対策である「文書の執筆を委譲するとき」は役割に依存しない節として残す。`general` は文書作成を再び担当する。 |
| 2. レビュー役割 | `independent-review` を `design-review`(default-name: `docs-reviewer`)へ、`doc-review` を `knowledge-elicitation`(default-name: `knowledge-elicitor`)へ改名する。前者は設計書・実装計画書を、後者は任意の成果物を扱う。旧 ID は残さない。 |
| 3. 敵対的レビュー | `adversarial-review` を `gate-review` の直後、`advisor` の直前に新設する。default-name は `adversary`、readonly、tools は Read/Grep/Glob/Bash、Agent Tool は使わない。推奨は Opus / `gpt-sol`。標準フローには入れない。 |
| 4. setup-agents | 既定を 1 役割 1 定義にし、`--models` は `ok: false` で廃止する。`--recommended [--roles]` は候補列の先頭から live にある最初の ModelId を採り、名前を `<model-id>-<default-name>` とする。Claude enum は常に実在するため各行は最初の Claude enum で止まる。`rolesDropped`、`modelsDropped`、`recommendedRolesFor` は持たない。個別指定フラグとの併用は拒否する。`RECOMMENDED` は custom で採る候補が先頭になるよう並べ替え、`ASSIGNMENTS` は変えない。 |
| 5. 探索 | context-map と `explore-lead` を廃止する。`explore` は「コードベース探索」として直接委譲を受ける。規律では、3 ターン以上見込む探索を 1 dispatch にまとめ、結果の突き合わせと要件確定はオーケストレーターが担う。`.gitignore` の `.claude/context-maps` 行は残す。 |
| 6. E2E | `RECOMMENDED["e2e-verify"]` は `["sonnet"]` のみとする。 |
| 7. 実装役割 | escalation、complex-impl、normal-impl、light-impl を観測可能な条件で上から評価する。escalation は同役割への 2 回の未完了、原因未特定の差し戻し、検証失敗を 2 回直しても未解消のいずれかで発火する。依頼には試行履歴、失敗出力の原文、未解決制約を入れる。complex は公開 I/F・複数コンポーネント・新構造・全セッション等への影響、normal は 1 コンポーネント内で既存パターンと I/F 不変、light は内容が完全指定済みで対象を列挙でき新ロジックがない作業である。 |
| 8. advisor | 構造を変える複数案、依頼と実コードの食い違い、原因候補を絞れない検証失敗だけを相談対象にする。確認可能な事実、命名・表記、範囲拡大は相談しない。オーケストレーターは相反するレビュー指摘や要件確定の判断軸を立てられないときに諮る。依頼には選択肢、制約、関係ファイルを入れ、出力は推奨 1 案とする。 |
| 9. モデル | `gemini-flash` と vendor `gemini` を削除する。MODELS は 9 件、Vendor は 4 値とし、`antigravity` は `unknown` に戻す。README の Antigravity 注記も削除する。 |

全体としてバージョンを `0.20.0-dev` に上げ、README に「0.19 系から 0.20 系へ」の移行節を追加する。Serena メモリを更新する。ARCHITECTURE と ADR は更新しない。このリポジトリの `.claude/agents/` は T16 で既存の名前と役割構成を保って個別経路から再生成する。

## ユーザー指摘による改定

同じ案を再提案しないため、決定に至る経緯を残す。

| 段階 | 改定 |
| --- | --- |
| 初期 | 要件 1〜4 を提示した後、ユーザーが context-map / `explore-lead` の廃止、E2E と実装役割の基準、advisor の基準、Gemini のモデルとベンダーの削除を順に追加した。 |
| context-map | `.gitignore` の `.claude/context-maps` を消す案は採らない。行を残すと決まった。 |
| 役割 ID | `doc-review` を別用途へ流用する案を撤回し、既存定義の誤解釈を避けるため `design-review` と `knowledge-elicitation` を新 ID にした。 |
| 推奨モデル | custom の `--recommended` が Claude だけを採る問題を確認した。ユーザーは解決規則の変更ではなく、`RECOMMENDED` の役割ごとの並べ替えを選んだ。 |
| 自リポの定義 | 新しい既定名・1 役割 1 定義への統一ではなく、既存の定義名と役割構成を維持すると決めた。 |
| 独立レビュー | 到達不能な `rolesDropped` を削除した。合成結果の禁止語検査は T3 に置き、`doc-writing` と `context-map` だけを見る。30KB の測定対象は方針スキル本文と規律であり、baseline は 26,737B、純増上限は 3,983B である。`gpt-sol` と `gpt-astra` のテスト位置を訂正し、英語純度検査を全役割へ広げ、`COLORS` の矛盾を解消した。 |
| 理解レビュー | T2 で触る `_common.md` の範囲、途中状態の `rolesFor("sonnet")`、T14 の照合対応表を明確化した。`writingHeading` の名前は確定し、本文の文言は実装者の裁量とした。 |

## 再提案しない不採用案

設計書 §9 の不採用案を再提案しない。特に次を実装中の代替案にしない。

- `doc-review` の ID 流用、旧 ID の別名表、旧 ID の CLI 検出。
- 執筆基準を `_common.md` か規律の片方だけに置くこと、執筆の節を `withAgent` 条件付きで出すこと、文書委譲の節を削ること。
- `adversarial-review` を標準フローへ入れること。
- `--models` の維持、`--recommended` の vendor を `resolveVendor` で決めること、外部優先への解決規則変更、`RECOMMENDED` を並べ替えない実装、`recommendedRolesFor` の温存、併用フラグの黙殺。
- `gemini-flash` または `gemini` の温存。
- 自リポの定義名を新しい既定へそろえること。

## 実装時に踏みやすい点

- 役割数は 17 から、T2 で 16、T3 と T4 で 15、T5 で 16 になる。固定値は常にそのタスク完了時点の役割集合に合わせる。
- T1b では `RECOMMENDED["doc-writing"]` を一時的に `["sonnet", "gpt-terra"]` にして型を通す。T2 で行ごと削除する。
- `src/` を変えたら `pnpm run build` を実行する。忘れると生成済み `scripts/*.mjs` に `return "gemini"` が残る。
- 断片本文に `###` を使わない。断片は `## ` 単位で集約される。en 断片には日本語を書かない。
- `_common.md` の `## Agent tool の制約` は `agentConstraintHeading` と照合するため、見出しを変えない。
- 規律の純増は 3,983B 以内にする。超える見込みなら、F1・D1・探索節・L107 の撤去を先に終え、それでも収まらなければ実装を止めて報告する。
- T16 は GOTCHA-001 に従う。別ディレクトリへ複製し、`--check` の `mcpCurrent.denyTools` を `--mcp-deny` に渡し、生成後に削除行がないことを差分で確かめる。`complex-reviewer` の `e2e-verify` には推奨外警告が出るが受容する。
- `references/`、`skills/`、`assets/roles/` を変えるタスクでは `prompt-smith:prompt-smith` を使う。`plugins/*/scripts/` は手で編集せず、ブランチも切らない。

## このセッションで確定させた事実

- `setup-agents.ts` に MCP 既定付与の役割列挙は無い。追随対象は SKILL.md と README である。
- `recommendedRolesFor` は `--models` 経路だけで使われていたため、`--models` の廃止後は削除できる。
- `gpt-sol` の `recommendedFor` は `setup-agents.test.ts` L469、`gpt-astra` の `e2e-verify` は L472〜480 を確認する。両者を取り違えない。
- 現在の英語純度検査は `complex-impl` と `explore` の合成だけを見る。T5 で全役割を合成する検査に広げる。
- `context-map-guide.md` は方針スキルの参照に入らない。削除しても 30KB 制限の余裕は増えない。

## スコープ外

- ARCHITECTURE と ADR の更新。層と依存方向は変わらない。
- `codiel`、`sandalphon`、`metatron` の変更。これらは RoleId を参照しない。
- 翻訳ディレクトリに残る旧断片を CLI で検出する機能。

## 参照

- 設計書: `harness-docs/design/2026-09-24-agent-policy-role-overhaul-design.md` (§2、§5、§9〜§11)
- 実装計画書: `harness-docs/plans/2026-09-24-agent-policy-role-overhaul-plan.md` (§0〜§2、§4、§8〜§9)
- GOTCHA: `harness-docs/GOTCHAS.md` (GOTCHA-001、GOTCHA-002)
- 規律: `plugins/agent-policy/references/orchestration-discipline.md`
- プロジェクト規約: `.claude/rules/metatron/conventions.md`
- 会話記録: `docs/chat/2026/0924/phyllis998/1805-agent-policy-role-discipline-redesign.md`
