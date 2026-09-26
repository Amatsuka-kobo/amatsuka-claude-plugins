# Agent定義の役割カバレッジ検証と更新

- 日付: 2026-09-26
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `.claude/agents/` 内15件定義ファイル(complex-reviewer, e2e-tester, lead-implementer 編集)
- 前提: agent-policy の役割マーカー対応表、MCP サーバー実在確認
- セッション ID: a882c469-437f-4ff4-a71b-2bda4182233c

---

## セッション 1: Agent定義の役割カバレッジ検証と3件編集

# AI

既存 `.claude/agents/` に役割マーカー付き定義14件確認。内訳: Claude(sonnet/opus/haiku/fable)5件、外部ベンダー(gpt/grok)9件。

construction選択を確認する。

既存14定義で16役割すべて被覆済み(`uncovered: []`)。

| 役割 | 推奨モデル | 既存定義 |
|---|---|---|
| 複雑または重要な実装 | gpt-sol, opus | lead-implementer |
| 通常の実装 | gpt-luna, sonnet, grok | general-implementer |
| 軽量な実装 | gpt-luna, haiku, grok | general-implementer |
| 行き詰まり時のエスカレーション | gpt-astra, fable | technical-leader |
| その他のタスク | gpt-luna, sonnet | general-implementer, general-worker |
| 設計書・実装計画書(WBS)の作成 | opus | system-planner |
| コードベース探索 | grok, sonnet, gpt-terra | general-explore |
| リアルタイム情報調査 | grok, sonnet | realtime-researcher |
| E2E動作検証・ブラウザ/GUI操作 | sonnet | complex-reviewer |
| 設計書・実装計画書のレビュー | grok, sonnet | docs-reviewer |
| 暗黙知の抽出・理解レビュー | haiku | knowledge-elicitationer |
| コードレビュー | sonnet | code-reviewer |
| 重要な実装の最終レビュー | gpt-astra, fable | complex-reviewer |
| 設計書の最終ゲートレビュー | gpt-astra, fable | complex-reviewer |
| 敵対的レビュー | opus, gpt-sol | adversarial-reviewer |
| 設計・計画・実装のアドバイザー | gpt-astra, fable | independent-tech-adviser, technical-adviser |

`--check --recommended` の差分、全16件 `exists: false`。理由: 既定の生成対象パスが `<model>-<既定名>.md`(例: `gpt-sol-lead-implementer.md`)であり、既存14定義のカスタム名(`lead-implementer.md` 等)とは別パス。このまま `--write --merge --recommended` を実行すると、既存定義を更新せず、役割が重複する新規16ファイルが生まれる。

既存定義はモデル値自体は最新(gpt-6-sol / gpt-6-astra / gpt-6-luna / grok-4-7 — 直近コミットの新エイリアスと一致)。差分は主に「命名」と「複数役割の1ファイル統合」(例: `general-implementer` が normal-impl・light-impl・general の3役割、`complex-reviewer` が e2e-verify・final-review・gate-review の3役割を1定義で担う)。

14件全部 `exists: true`。1件(`knowledge-elicitationer`)は変更ゼロ(`identical: true`)。残り13件の差分は、GOTCHA-001と同じ構造 ─ `--mcp-servers`/`--mcp-deny` を明示しないと既存の MCP 由来 tools/disallowedTools が消える。値は既存の `mcpCurrent` からそのまま復元できる(impl 役割は context7+raguel+serena・denyなし、readonly 役割は context7+serena・serena書き込み系11個denyあり)。

1件だけ別種の差分がある。

`complex-reviewer`(e2e-verify・final-review・gate-review の3役割混在)に警告 `mixedKinds: true` と `toolsOnlyInTemplate: [Write, Edit, Skill]`。e2e-verify が impl 役割扱いのため、テンプレートは Write/Edit/Skill を付与しようとする。既存定義はこの3ツールを持たない(レビュー専用、コードは書かない設計)。

13件、差分は全て同型(モデル値・役割・tools は無変更、MCP由来の frontmatter だけ既存値を明示指定して保持)。内容を一覧化する。

| 定義 | 役割 | mcp-servers | mcp-deny |
|---|---|---|---|
| lead-implementer | complex-impl | context7 / raguel / serena | なし |
| general-implementer | normal-impl, light-impl, general | 同上 | なし |
| general-worker | general | 同上 | なし |
| technical-leader | escalation | 同上 | なし |
| system-planner | design-plan | context7 / serena | なし |
| general-explore | explore | context7 / serena | serena書込み系11個 |
| realtime-researcher | realtime-research | 同上 | 同上 |
| docs-reviewer | design-review | 同上 | 同上 |
| code-reviewer | code-review | 同上 | 同上 |
| adversarial-reviewer | adversarial-review | 同上 | 同上 |
| independent-tech-adviser | advisor | 同上 | 同上 |
| technical-adviser | advisor | 同上 | 同上 |

denyの11個は共通: `mcp__serena__delete_memory` / `edit_memory` / `insert_after_symbol` / `insert_before_symbol` / `rename_memory` / `rename_symbol` / `replace_content` / `replace_in_files` / `replace_symbol_body` / `safe_delete_symbol` / `write_memory`

`general` を外すと description・preamble・本文各節から「その他のタスク」関連の記述が落ちる(想定通り)。反映する。

全16役割 被覆済み(`uncovered: []`)。

## 更新結果

| 定義 | 役割 | モデル | action | 備考 |
|---|---|---|---|---|
| lead-implementer | complex-impl | claude-gpt-6-sol | merged | MCP保持のみ |
| general-implementer | normal-impl, light-impl | claude-gpt-6-luna | merged | **general 除去**(description・本文各節も追随) |
| general-worker | general | sonnet | merged | MCP保持のみ。general は本定義単独担当に |
| technical-leader | escalation | claude-gpt-6-astra | merged | MCP保持のみ |
| system-planner | design-plan | opus | merged | MCP保持のみ |
| general-explore | explore | claude-grok-4-7 | merged | MCP+deny保持のみ |
| realtime-researcher | realtime-research | claude-grok-4-7 | merged | MCP+deny保持のみ |
| complex-reviewer | e2e-verify, final-review, gate-review | claude-gpt-6-astra | merged | **Write/Edit/Skill 付与**(テンプレート通り選択) |
| docs-reviewer | design-review | claude-grok-4-7 | merged | MCP+deny保持のみ |
| code-reviewer | code-review | sonnet | merged | MCP+deny保持のみ |
| adversarial-reviewer | adversarial-review | claude-gpt-6-sol | merged | MCP+deny保持のみ |
| independent-tech-adviser | advisor | claude-gpt-6-astra | merged | MCP+deny保持のみ |
| technical-adviser | advisor | fable | merged | MCP+deny保持のみ |
| knowledge-elicitationer | knowledge-elicitation | haiku | 変更なし | `identical: true`、書き込み未実施 |

全件 `kept: []` / `keptNeedsReview: []` / `mcpDropped: []`。`discarded` は general-implementer(`description`・`agent-policy-role`・本文5節)以外は空 ─ 想定通り無変更。

`warnings`: complex-reviewer のみ「roles: e2e-verify is not recommended for gpt-astra」(既存モデル維持のため許容)。他13件は警告なし。

モデル値・ベンダーは全定義とも既存値のまま変更なし(再確定なし)。全定義が `agent-policy-vendor` を出力しており、色は vendor 値に従う(`none` 定義は無い)。

`AMATSUKA_AGENT_AUTO_INJECTION` が `custom` のとき: SessionStart フックが役割マーカー付き定義の `model` を検証。全て実在すれば custom プロファイルとマーカー対応表を注入する。照会失敗・実在しないモデル・役割マーカー付き定義0件のいずれかなら、セッション全体で `claude-model-policy` へフォールバックする。

`.claude/agents/` を git 追跡するかはプロジェクトの判断。既存ディレクトリのため再起動は不要。

# phyllis998

> complex-reviewerの役割からe2e-verifyをはずし、モデルを

> いくつか変更したい項目があるので列挙します。
> - complex-reviewerの役割からe2e-verifyをはずします。
> - e2e-verify専用のe2e-testerエージェントを追加します。MCPはSerena,Raguel,Jevrielとします。
> - lead-implementerのモデルをOpusに変更します。

# AI

3件対応する。まず MCP サーバー実在確認と各差分確認をする。

MCP サーバー実在確認: `plugin:context7:context7` / `plugin:codiel:raguel` / `plugin:jevriel:jevriel` / `serena` 全て接続済み。

差分確認結果。

- **complex-reviewer**: e2e-verify 除去で `Write/Edit/Skill/Agent` 消滅、`agentTool: false` に。role は final-review, gate-review のみ。既存の「## アドバイザーへの相談」節は保持マージで残る。
- **lead-implementer**: model → opus、color yellow→blue、vendor gpt→claude。他は無変更。

e2e-tester(新規)、e2e-verify の推奨モデルは `sonnet` のみ(候補1件)。tools は Read/Grep/Glob/Write/Edit/Bash/Skill(Agent なし)。sonnet で進めてよいか?

MCP は指定通り `plugin_codiel_raguel` / `plugin_jevriel_jevriel` / `serena`(context7 は指定になかったため付けない想定)。denyTools はなし(impl役割)。

この内容で3件とも実行してよいか確認する。

`--merge` が `toolsOnlyInExisting`(Write/Edit/Skill/Agent)を自動保持してしまった。e2e-verify を外したのに実装系ツールが残っている ─ 意図と逆。完全上書きで直す。

書き込み結果を確認 ─ Write/Edit/Skill/Agent と「## アドバイザーへの相談」節が保持されてしまった。final-review/gate-review は読み取り専用設計(本文にも「成果物を作らず、報告のみを返す」と明記)なので、Write/Edit/Skill/Agent はロールと矛盾する。節自体はロールに依存しない汎用内容なので保持で問題ない。

`--keep` で節だけ保持しツールは外せるか確認する。

complex-reviewer は完全上書きで想定通り readonly 専用ツールセットに戻った(Write/Edit/Skill/Agent 消滅)。「## アドバイザーへの相談」節も消えたが、これは Agent ツール保有時に合成される断片と判断でき、Agent が無い以上正しい。

lead-implementer と e2e-tester の内容も確認する。

3件すべて反映確認。

全16役割 被覆済み、`uncovered: []`。e2e-verify は e2e-tester(新規)に移った。

## 反映結果

| 定義 | 変更 |
|---|---|
| complex-reviewer | role: final-review, gate-review のみに。tools から Write/Edit/Skill/Agent 消滅(完全上書きで反映。`--merge` では `toolsOnlyInExisting` が自動保持され消えなかったため) |
| e2e-tester(新規) | role: e2e-verify。model: sonnet。MCP: raguel / jevriel / serena(指定通り、context7 なし) |
| lead-implementer | model: claude-gpt-6-sol → opus。color: yellow→blue。vendor: gpt→claude |

15定義体制(14→e2e-tester追加で15)。`.claude/agents/` は git 追跡対象外のため、変更差分は git 履歴に残らない。

**気づいた点**: `--merge` は「既存にあってテンプレートに無い」項目(tools・sections)を無条件保持する。役割を外して不要になったツールも自動的には落ちない ─ 完全上書き(`--merge` を外す)か、必要な節だけ後で個別に復元する対応が要る。今回は「## アドバイザーへの相談」節が Agent ツール保有時の合成断片と判明したため、完全上書きで両方(不要ツール・不要節)を一度に落として正しい状態になった。

記録エージェント起動済み。バックグラウンド実行、完了通知待ち。

## セッション 2: Agent定義の役割調整と検証

# phyllis998

> 今回の変更で露見したスクリプトの問題を改修したいです。引継ぎをお願いします

# AI

merge/keep のロジック位置を特定した(`setup-agents.ts:534` の `merge()` 関数、584行目付近で `toolsOnlyInExisting` を無条件展開)。この行を見て原因を確定させる。

2135字、4000字以内に収まっている。2文書を作成した。

## 作成した文書

- 引き継ぎ書: `harness-docs/handover/2026-09-26-setup-agents-merge-keep-fix-handover.md`
- 実装プロンプト: `docs/prompts/2026-09-26-setup-agents-merge-keep-fix-prompt.md`(2135字、goal コマンドへそのまま渡せる)

引き継ぎ書には原因をコード行まで特定して書いた。

`plugins/agent-policy/src/setup-agents.ts` の `write()`(623行)が、`--merge` 指定時に `automaticKeep()`(582行)の戻り値を無条件で保持セレクタへ加える。`automaticKeep` は非 MCP のツール・キー・節を「既存にしかない」という理由だけで全部保持リストに入れ、`--keep` はそこへの追加しかできず除外はできない。MCP 系(`mcp__*`・`disallowedTools`)だけは GOTCHA-001 対応で既に除外されているが、それ以外の経路は未対応のまま今回踏んだ、という構図。

設計判断はまだ確定していない旨も明記した(役割由来かどうかを判別する案・opt-in化する案・`--drop` 構文を足す案の3つを並べたのみ)。次セッションはこの3案から選ぶところから始まる。

記録エージェント起動済み。バックグラウンド実行中。
