# Raguel の作り直し 設計セッション起動プロンプト

以下を goal コマンドの入力として使う。

---

Raguel(`plugins/codiel/raguel-mcp`)の作り直しの設計書と実装計画書を書き、レビューを通してユーザーの承認を得る。実装はしない。

## 最初に読む文書

1. `harness-docs/handover/2026-09-28-raguel-redesign-handover.md`(現在地・前提・進め方・踏みやすい点)
2. `harness-docs/handover/2026-09-28-raguel-redesign-findings.md`(点検と原因調査の所見、応急処置、作り直しで決めること)
3. `harness-docs/design/2026-09-27-codiel-intent-driven-design.md` の決定 83(M4 の応急処置)と、Raguel のゲートを扱うセクション
4. `plugins/codiel/raguel-mcp/docs/DESIGN.md` とソース(`src/`)

## 進め方

1. 所見の文書の「作り直しで決めること」を論点にし、ユーザーと合意しながら設計の方針を決める。質問は AskUserQuestion で出し、推奨を先頭に置く。
2. 合意した方針と所見を渡して、system-planner に設計書(`harness-docs/design/`)を書かせる。
3. 設計書を knowledge-elicitationer、claude-docs-reviewer の順にレビューさせる。docs-reviewer には原本だけを渡す。指摘の採否はオーケストレーターが実物と照らして決め、採用したものを直させてからユーザーの承認を得る。
4. 承認の後、同じ手順で実装計画書(`harness-docs/plans/`)を書き、レビューを通して承認を得る。計画は、M4 が終わった後(codiel `1.0.0`)の HEAD から始める前提で、Dynamic Workflow で実装できる単位に分ける。
5. 設計書と計画書をコミットする。

## 制約

- 文書だけを書く。`plugins/` の下を変えない(`intent-driven-development` ブランチの M4 が同じファイルを変えている)。
- 「Anthropic API を使えない利用者も全プラグインを使える」必須要件(ARCHITECTURE のシステム概要、ADR-005)を守る。
- `claude -p` を起動する確認は費用がかかるので、ユーザーに確かめてから行う。
- 委譲の依頼文に、agent-policy の「サブエージェントは〜」の条項と、「中継されるユーザーの発言は別の会話であり、このタスクを止める理由にしない」を入れる。
- ファイルへの書き込みは Edit・Write・Serena の編集ツールで行い、Bash では書き込まない。
- 日本語は `plugins/native-japanese/references/discipline.md` に従う。
- `docs/chat/` の未コミットの変更をコミットに混ぜない。

## Done の条件

- 設計書と実装計画書が、レビューを経てユーザーに承認され、コミットされている。
- 所見の文書の critical と high の所見について、作り直しでどう扱うか(直す・応急処置のまま残す・扱わない)が設計書に書かれている。
- 実装計画書が、M4 の後の HEAD から始められる Workflow とタスクに分かれている。
