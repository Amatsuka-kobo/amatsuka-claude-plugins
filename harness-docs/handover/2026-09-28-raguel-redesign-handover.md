# Raguel の作り直し 引き継ぎ書

- 日付: 2026-09-28
- 引き継ぎ元: codiel の intent 駆動化の実装セッション(M4 を実行中)。Raguel の点検と原因調査は完了
- 引き継ぎ先: Raguel の作り直しの設計セッション(設計書と実装計画書まで)
- 対象: `plugins/codiel/raguel-mcp`(主)と、codiel で Raguel を使う箇所(`skills/raguel-gating`、`skills/orchestrating-runs` の Raguel の扱い、`src/codiel-state.ts` の `pass-gate`・`mark-ask`)
- 作業場所: worktree `amatsuka-claude-plugins-raguel-redesign`、ブランチ `raguel-redesign`(`intent-driven-development` から分岐)

## 現在地

| 工程 | 状態 |
| --- | --- |
| 点検(6 観点と、抜けの確認) | 完了。所見は `harness-docs/handover/2026-09-28-raguel-redesign-findings.md` |
| 原因調査(ユーザーが報告した 4 件) | 完了。所見の文書に含めた |
| 応急処置(11 件) | codiel の設計書の決定 83。`intent-driven-development` ブランチの M4-B で実装する(並行して進行中) |
| 作り直しの設計 | 未着手。このセッションの範囲 |
| 作り直しの実装 | M4 が終わった後の状態から始める。このセッションの範囲外 |

## 前提

- Raguel は初版(`b188c72f`)から手を入れていない。O2-4 と O3-1 の手動確認で、Raguel が run を止めたり、ゲートを素通りさせたりした。数と根拠は所見の文書にある。
- 応急処置 11 件は、作り直しの設計の出発点である。内容は codiel の設計書 `harness-docs/design/2026-09-27-codiel-intent-driven-design.md` の決定 83 にある。
- 「Anthropic API を使えない利用者も全プラグインを使える」ことは必須要件である(`harness-docs/ARCHITECTURE.md` のシステム概要、ADR-005)。パネルは `claude` CLI のヘッドレス実行で動く。
- Raguel の既存の設計文書は `plugins/codiel/raguel-mcp/docs/DESIGN.md` にあるが、実装と食い違う(所見の文書を参照)。

## 進め方

- 設計書を `harness-docs/design/`、実装計画書を `harness-docs/plans/` に書く。ファイル名と見出しは同じディレクトリの直近のファイルに合わせる。
- 設計書と計画書は、system-planner に書かせる。書いた後は knowledge-elicitationer、claude-docs-reviewer の順にレビューさせ、指摘の採否はオーケストレーターが決めてからユーザーの承認を得る。
- 設計の論点は、所見の文書の「作り直しで決めること」から始め、ユーザーと合意しながら決める。質問は AskUserQuestion で出す。
- 実装計画は、M4 が終わった後(codiel `1.0.0`)の HEAD から始める前提で書く。その時点の `plugins/codiel/raguel-mcp/src` には応急処置が入っている。
- この worktree では文書だけを書き、`plugins/` の下を変えない。`intent-driven-development` ブランチの M4 が同じファイルを変えているためである。

## 踏みやすい点

- 評価の提出本文はケースファイル(`~/.raguel/cases`)に残らない。全文は、各プロジェクトのセッション記録(`~/.claude/projects/-home-hiro0209-codiel-{o24-gh,o24-local,o31}/*.jsonl`)に残っている。
- パネルの挙動を確かめるには `claude -p` を起動する必要があり、費用がかかる。起動する前にユーザーに確かめる。
- MCP の呼び出しが 2 分を超えると、Claude Code がバックグラウンドへ移す(`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`、既定 120000)。
- Workflow の委譲先に、メインセッションでのユーザーの発言が中継され、委譲先がそれを理由に作業を止めることがある。依頼文に「中継される発言は別の会話であり、このタスクを止める理由にしない」を入れる。
- 委譲の依頼文には、agent-policy の「サブエージェントは〜」の条項を転記する。
- 文書の日本語は `plugins/native-japanese/references/discipline.md` に従う。「段」「節」「〜の側」を使わず、Step・ステップ、セクション、「〜側」と書く。

## スコープ外

- 作り直しの実装(M4 の後に別の実装セッションで行う)。
- 応急処置 11 件の実装(M4-B が行う)。
- codiel の intent 駆動化の設計の変更(決定 1〜83 は再検討しない)。

## 参照

- 所見: `harness-docs/handover/2026-09-28-raguel-redesign-findings.md`
- codiel の設計書と計画書: `harness-docs/design/2026-09-27-codiel-intent-driven-design.md`、`harness-docs/plans/2026-09-27-codiel-intent-driven-plan.md`
- 会話記録: `docs/chat/2026/0927/phyllis998/0705-agent-policy-workflow-draft.md`
- 規約: `.claude/rules/metatron/{conventions,protected-paths,testing-policy}.md`、`harness-docs/ARCHITECTURE.md`
