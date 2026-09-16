# CLIProxyAPI 調査記録

このディレクトリには、CLIProxyAPI の利用中に遭遇した問題の調査記録を集積します。原因の切り分け手順と結論を残し、将来 CLIProxyAPI から自前のプロキシ実装へ移行する際の設計材料とすることを目的とします。

セットアップ手順そのものは `docs/development/cliproxyapi-setup.md` を参照してください。

## 記録一覧

| 日付 | ファイル | 症状の一言 | 根本原因の分類 |
| --- | --- | --- | --- |
| 2026-09-16 | [2026-09-16-antigravity-false-429-system-prompt-filter.md](2026-09-16-antigravity-false-429-system-prompt-filter.md) | antigravity 経由の Gemini がサブエージェントから常に 429 で失敗する | 上流(Google)による systemInstruction 内文字列検出に基づく偽装 429（quota 枯渇ではない） |
