# agent-policy エージェント定義の生成方式決定

- 日付: 2026-09-10
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: 不明
- セッション ID: 42d60bea-e324-4726-b17c-c66175e213b9

---

## セッション 1: agent-policy 役割カバレッジ確認と定義生成方式検討

# AI

/model コマンド実行完了。Sonnet 5 セット済み、次回セッション既定にも保存済み。ただし `.claude/settings.json` が `Opus 5 (1M context)` にピン止め中→再起動で戻る。

/agent-policy:setup-agents 実行するか?

既存 `.claude/agents/`: 役割マーカー付き定義 11 件。内訳 Claude 4 件(code-reviewer=sonnet, fable-adviser=fable, haiku-reviewer=haiku, system-planner=opus)、外部ベンダー 7 件(gpt 系 5 件、grok 系 2 件)。

構成選択:

カスタム構成、`lang=ja` で進める。live models 照会。

全役割 既存定義でカバー済み(未カバー 0 件)。

| 役割 | 推奨モデル | 既存定義 |
|---|---|---|
| 複雑または重要な実装 | opus, gpt-sol | gpt-sol-lead-implementer |
| 通常の実装 | sonnet, gpt-luna, grok | gpt-luna |
| 軽量な実装 | haiku, gpt-luna, grok | gpt-luna |
| 行き詰まり時のエスカレーション | fable, gpt-astra | astra-tech-leader |
| その他のタスク | sonnet, gpt-luna | gpt-luna |
| 設計書・実装計画書作成 | opus | system-planner |
| コードベース探索統括 | opus | system-planner |
| コードベース探索実働 | sonnet, grok, gpt-terra | gpt-terra-explorer, grok-researcher |
| リアルタイム情報調査 | sonnet, grok | grok-researcher |
| E2E動作検証・ブラウザ/GUI操作 | sonnet, gpt-astra | astra-complex-reviewer |
| 設計書・実装計画書の独立レビュー | sonnet, grok | grok-docs-reviewer |
| 設計書・実装計画書のレビュー | haiku | haiku-reviewer |
| コードレビュー | sonnet | code-reviewer |
| 重要な実装の最終レビュー | fable, gpt-astra | astra-complex-reviewer |
| 設計書の最終ゲートレビュー | fable, gpt-astra | astra-complex-reviewer |
| 設計・計画・実装のアドバイザー | fable, gpt-astra | fable-adviser |

補足: `grok-researcher` はセッション冒頭の注入で「廃止済み、プロジェクト定義は同梱定義より優先されるため削除する」と通知されている。被覆表にはまだ現れている。

9 候補(実在エイリアス→gpt-sol/grok/gpt-astra/gpt-terra/gpt-luna、claude enum→haiku/opus/sonnet/fable)。5件以上→4件ずつ分割。

gpt-terra 未選択(除外)。残り 1 件を確認。

fable(claude enum / vendor claude / 推奨役割: アドバイザー)も作るか?

# phyllis998

> 作ります

# AI

vendor 推定: gpt-sol/gpt-astra/gpt-luna=gpt、grok=grok。haiku/opus/sonnet/fable=claude(確認不要)。

全モデル vendor 推定通り確定。一括生成対象: gpt-sol, grok, gpt-astra, gpt-luna, haiku, opus, sonnet, fable の8件、確認コマンド実行。

## 一括確認結果(8モデル)

| モデル | target | 状態 | 役割 | mixedKinds | 既存MCP |
|---|---|---|---|---|---|
| gpt-sol | gpt-sol-lead-implementer.md | 既存・非同一(##アドバイザーへの相談 節差分) | complex-impl | false | context7, raguel, serena(既存のみ) |
| grok | **grok.md(新規)** | 新規作成 | normal-impl, light-impl, explore, realtime-research, independent-review | **true** | なし |
| gpt-astra | **gpt-astra.md(新規)** | 新規作成 | escalation, e2e-verify, final-review, gate-review, advisor | **true** | なし |
| gpt-luna | gpt-luna.md | 既存・非同一(同上節差分) | normal-impl, light-impl, general | false | context7, raguel, serena(既存のみ) |
| haiku | **haiku.md(新規)** | 新規作成 | light-impl, doc-review | **true** | なし |
| opus | **opus.md(新規)** | 新規作成 | complex-impl, design-plan, explore-lead | false | なし |
| sonnet | **sonnet.md(新規)** | 新規作成 | normal-impl, general, explore, realtime-research, e2e-verify, independent-review, code-review | **true** | なし |
| fable | **fable.md(新規)** | 新規作成 | escalation, final-review, gate-review, advisor | **true** | なし |

warnings なし、modelsDropped なし。

問題: 一括生成はモデル単位で推奨役割を全部束ねた**1ファイル**を作る方式。既存構成は役割単位で分割した個別ファイル(system-planner / fable-adviser / code-reviewer / haiku-reviewer / astra-tech-leader / astra-complex-reviewer / grok-researcher / grok-docs-reviewer)。このまま実行すると grok/gpt-astra/haiku/opus/sonnet/fable の6件が新規ファイルとして生まれ、同じ役割を既存ファイルと二重に持つ定義が並立する。加えて6件は mixedKinds:true(読み取り役割と実装役割が同居)→ Write/Edit 付与で読み取り専用担保が依頼文頼みになる。

どう進めるか。

どの組み合わせにするか、対象を教えて。

どの組み合わせにするか、対象を教えて。

## セッション 2: 8モデル役割候補確認とファイル構成の衝突検討

# phyllis998

> 全て

# AI

8件とも個別調整。役割候補を並列取得。

chat-recorder バックグラウンド完了(通知のみ、対応不要)。

作業続行。8モデル全部の役割候補取得完了、いずれも同じ16役割カタログが返る(list-rolesはモデル別フィルタなし)。ここで方針確認が要る。

list-coverage の推奨役割対応表を見ると、プラグイン側の推奨がプロジェクト既存構成より広がっている。

- grok に normal-impl・light-impl(実装系)が新規追加 ── 既存は grok-researcher(explore, realtime-research)/grok-docs-reviewer(independent-review)の読み取り系のみ
- haiku に light-impl が新規追加 ── 既存は haiku-reviewer(doc-review)のみ
- opus に complex-impl が新規追加 ── 既存は system-planner(design-plan, explore-lead)のみ
- sonnet に normal-impl・general・explore・realtime-research・e2e-verify・independent-review が新規追加 ── 既存は code-reviewer(code-review)のみ
- fable に escalation・final-review・gate-review が新規追加 ── 既存は fable-adviser(advisor)のみ
- gpt-astra に advisor が新規追加 ── 既存は astra-tech-leader(escalation)/astra-complex-reviewer(e2e-verify, final-review, gate-review)

gpt-sol・gpt-luna は既存role構成のまま(変更なし)。

8モデル×16候補の総当たり選択は非現実的。方針をどちらにするか。

sonnet(2/2)の回答が欠落。再確認。

方針確定。ほぼ全モデルが既存ファイル構成のまま(gpt-sol/gpt-luna/grok/gpt-astra/haiku/opus/fable は新規役割追加なし)、sonnet だけ general 役割で新規ファイル追加。全11件を個別に差分確認する。

既存差分: 全10ファイルとも frontmatter変更なし・body は「##アドバイザーへの相談」節(astra-tech-leaderのみ追加で「## When to invoke」節)の更新のみ。haiku-reviewer は完全一致。破壊的変更なし → 保持マージで問題ない。

MCP付与は現状こう分かれてる。

| 定義 | context7 | raguel | serena | serena書込系denylist |
|---|---|---|---|---|
| gpt-sol-lead-implementer | ○ | ○ | ○ | - |
| grok-researcher | ○ | - | ○ | ○(11tool) |
| grok-docs-reviewer | ○ | - | ○ | ○(11tool) |
| gpt-luna | ○ | ○ | ○ | - |
| astra-tech-leader | ○ | ○ | ○ | - |
| astra-complex-reviewer | ○ | - | ○ | ○(11tool) |
| haiku-reviewer | - | - | - | - |
| system-planner | ○ | **なし** | ○ | - |
| code-reviewer | ○ | - | ○ | ○(11tool) |
| fable-adviser | ○ | - | ○ | ○(11tool) |
| sonnet-generalist(新規) | ? | ? | ? | ? |

system-planner は impl系役割(design-plan, explore-lead)だが raguel 未付与。sonnet-generalist(新規, general役割)は未決定。

`grok-researcher.md`(explore + realtime-research 同居)を分離する方向で反映する。命名を決める。

分離後の2ファイル、それぞれの名前を教えて(例: explore用/realtime-research用)。

分離後の2ファイル、名前を教えて。

## セッション 3: エージェント定義ファイルの分割と命名

# AI

バックグラウンド記録完了(対応不要)。分離後の2ファイル、名前を教えて。

# phyllis998

> project-explore / realtime-researcher

# AI

project-explore/realtime-researcher とも新規。MCP は旧 grok-researcher と同じ(context7+serena+denylist)にするか確認。

12ファイル書込み実行。MCP付与は `claude mcp list` の生名(`plugin:context7:context7` 等)をそのまま渡す形。

gitignore対象(git管理外)。安全に削除できる。書込み実行。

# phyllis998

> 他のファイルに関しても名前を変えさせてください

# AI

書込み中断。他ファイルの名前変更、対象と新名を教えて。

他ファイルの名前変更、対象と新名を教えて。

## セッション 4: 他ファイルの名前変更対象を精査

# AI

バックグラウンド記録完了(対応不要)。他ファイルの名前変更、対象と新名を教えて。

# phyllis998

> gpt-luna: general-implementer
> gpt-sol: lead-implementer
> gpt-astra: complex-reviewer / technical-leader
> sonnet: code-reviewer / general-worker
> fable: technical-adviser
> grok: docs-reviewer / general-explore / realtime-researcher
> haiku: knowledge-elicitatiotor
>
> terraは削除でお願いします。

> gpt-luna: general-implementer
> gpt-sol: lead-implementer
> gpt-astra: complex-reviewer / technical-leader
> sonnet: code-reviewer / general-worker
> fable: technical-adviser
> grok: docs-reviewer / general-explore / realtime-researcher
> haiku: knowledge-elicitationer
>
> terraは削除でお願いします。

# AI

最終命名を反映。全体像を確認。

## 最終構成(12ファイル)

| 新ファイル名 | model-id | 役割 | 旧ファイル(削除対象) |
|---|---|---|---|
| lead-implementer.md | gpt-sol | complex-impl | gpt-sol-lead-implementer.md |
| general-implementer.md | gpt-luna | normal-impl, light-impl, general | gpt-luna.md |
| technical-leader.md | gpt-astra | escalation | astra-tech-leader.md |
| complex-reviewer.md | gpt-astra | e2e-verify, final-review, gate-review | astra-complex-reviewer.md |
| code-reviewer.md | sonnet | code-review | (同名、変更なし) |
| general-worker.md | sonnet | general | (新規) |
| technical-adviser.md | fable | advisor | fable-adviser.md |
| docs-reviewer.md | grok | independent-review | grok-docs-reviewer.md |
| general-explore.md | grok | explore | (新規、grok-researcher.mdから分離) |
| realtime-researcher.md | grok | realtime-research | (新規、grok-researcher.mdから分離) |
| knowledge-elicitationer.md | haiku | doc-review | haiku-reviewer.md |
| system-planner.md | opus | design-plan, explore-lead | (同名、変更なし) |

削除: gpt-sol-lead-implementer.md, gpt-luna.md, astra-tech-leader.md, astra-complex-reviewer.md, fable-adviser.md, grok-docs-reviewer.md, grok-researcher.md, haiku-reviewer.md, gpt-terra-explorer.md(terra除外分)。全て `.gitignore` 対象で git 管理外。

MCP付与は前回確定通り(gpt-sol/gpt-luna/gpt-astra-technical-leader/sonnet-general-worker=context7+raguel+serena、readonly系=context7+serena+denylist11、system-planner=context7+serenaのみ、haiku=なし)。

全12件書込み完了。旧ファイル9件削除。

## 完了報告

被覆確認: 全16役割 uncovered:0、全てカバー済み。

**生成12件**(`.claude/agents/`配下)

| target | action | 役割 |
|---|---|---|
| lead-implementer.md | written | complex-impl |
| general-implementer.md | written | normal-impl, light-impl, general |
| technical-leader.md | written | escalation |
| complex-reviewer.md | written | e2e-verify, final-review, gate-review |
| code-reviewer.md | merged | code-review |
| general-worker.md | written | general |
| technical-adviser.md | written | advisor |
| docs-reviewer.md | written | independent-review |
| general-explore.md | written | explore |
| realtime-researcher.md | written | realtime-research |
| knowledge-elicitationer.md | written | doc-review |
| system-planner.md | merged | design-plan, explore-lead |

kept/keptNeedsReview は全件なし。discarded は system-planner.md のみ「## アドバイザーへの相談」節(旧内容を破棄しテンプレート最新化)。mcpDropped/warnings/modelsDropped、全件なし。

**削除9件**: gpt-sol-lead-implementer.md, gpt-luna.md, astra-tech-leader.md, astra-complex-reviewer.md, fable-adviser.md, grok-docs-reviewer.md, grok-researcher.md, haiku-reviewer.md, gpt-terra-explorer.md(全て `.gitignore` 対象、git管理外)。

**vendor確定**: gpt-sol/general-implementer(gpt-luna)/technical-leader・complex-reviewer(gpt-astra)=gpt(推定通り)、docs-reviewer・general-explore・realtime-researcher(grok)=grok(推定通り)、code-reviewer・general-worker(sonnet)・knowledge-elicitationer(haiku)・system-planner(opus)・technical-adviser(fable)=claude(自動)。`none`定義なし、blue色定義なし。

**MCP**: lead-implementer/general-implementer/technical-leader/general-worker = context7+raguel+serena。complex-reviewer/code-reviewer/technical-adviser/docs-reviewer/general-explore/realtime-researcher = context7+serena+serena書込系11ツールdenylist。system-planner = context7+serenaのみ(raguelなし、現状維持)。knowledge-elicitationer = MCPなし。

**方針注入**: `AMATSUKA_AGENT_AUTO_INJECTION=custom`。SessionStart フックが役割マーカー付き定義の `model` を実在検証し、成功なら custom プロファイルとマーカー対応表(新ファイル名で)を注入する。

`.claude/agents/` は `.gitignore` 対象のためgit追跡外(現状維持)。ディレクトリ自体は既存のため再起動不要。

setup-agents 完了。他に用件あれば。
