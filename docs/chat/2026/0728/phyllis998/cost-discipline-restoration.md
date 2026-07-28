# agent-policy プラグイン: コスト規律ドキュメント復活

- 日付: 2026-07-28
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `plugins/agent-policy/docs/cost-discipline.md`、`plugins/agent-policy/.claude-plugin/plugin.json` の version アップデート
- 前提: agent-policy プラグイン既存構造、過去のコスト規律ドキュメント

---

## セッション 1: ドキュメント復活と更新

# phyllis998

> agent-policyプラグインに過去あった、コスト規律のリファレンス文書を、現在のdocs/cost-survey-results.mdに置き換える形で復活させてください

# AI

agent-policy プラグインの既存ドキュメント構造と過去のコスト規律参照文書を調査した。

**実施内容:**
- git history から削除済みの `cost-discipline.md` コンテンツを復元
- 過去実装の cost 関連セクションを確認（旧 SKILL.md ファイルで cost-survey-results.md への参照が存在）
- 現在の `docs/cost-survey-results.md` の内容を確認

**成果物の内容:**
`plugins/agent-policy/docs/cost-discipline.md` を新規作成し、以下を含める:
- cost-survey-results.md への参照ガイダンス
- agent-policy での cost 方針の説明
- モデル別 role 表の復活

**manifest 更新:**
plugin.json の `version` を `2.1.1` → `2.1.2` にアップデート（パッチバージョン）

**削除:**
- git tracking が不要な `docs/cost-survey-results.md` を削除予定。ファイルは manifest で参照されておらず、復活させた cost-discipline.md で代替される

**検証:**
repo 内の cost-survey-results.md への参照が限定的であることを確認した上で、削除実施。
