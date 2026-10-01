# CLIProxyAPI 調査記録

このディレクトリには、CLIProxyAPI の利用中に遭遇した問題の調査記録を集積します。原因の切り分け手順と結論を残し、将来 CLIProxyAPI から自前のプロキシ実装へ移行する際の設計材料とすることを目的とします。

セットアップ手順そのものは `docs/development/cliproxyapi-setup.md` を参照してください。

## 記録一覧

| 日付 | ファイル | 症状の一言 | 根本原因の分類 |
| --- | --- | --- | --- |
| 2026-09-16 | [2026-09-16-antigravity-false-429-system-prompt-filter.md](2026-09-16-antigravity-false-429-system-prompt-filter.md) | antigravity 経由の Gemini がサブエージェントから常に 429 で失敗する | 上流(Google)による systemInstruction 内文字列検出に基づく偽装 429（quota 枯渇ではない） |
| 2026-09-23 | [2026-09-23-auto-mode-server-classifier-not-passed.md](2026-09-23-auto-mode-server-classifier-not-passed.md) | auto mode の分類器リクエスト無料化の対象外と通知される | プロキシが `safeguards`・`safeguard_results` を素通ししない（サーバー側分類器に非対応） |
| 2026-10-02 | [2026-10-02-advisor-tool-passthrough.md](2026-10-02-advisor-tool-passthrough.md) | `advisorModel`（advisor tool）がプロキシ経由で使えるかの確認。8.0.9 で正常動作 | 不具合なし。Claude OAuth 経路は素通しで対応、Codex・Gemini への翻訳経路は非対応（過去の 400 系 3 件は修正済み） |
