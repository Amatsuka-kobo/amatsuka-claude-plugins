---
name: cliproxyapi-investigation
description: Claude CodeやCodex、Gemini(antigravity経由含む)など、AIモデルの呼び出しでタイムアウト・応答なし・429エラー・変な/不可解な応答・サブエージェントの原因不明な失敗が起きたときに使う。CLIProxyAPIを疑って調査し、docs/cliproxyapi/に調査記録を作成、README.mdの一覧表に追記する。「CLIProxyAPIを疑って」「API側から調べて」のように名指しされた依頼や、直前の提案への「そうして」「それで」「先にそっちで」といった同意・続きの一言にも対応する。CLIProxyAPI自体のセットアップや設定変更(config.yamlの編集など)には使わない。
---

# CLIProxyAPI 調査

- サブエージェントの失敗など、Claude CodeのAPI通信やモデルに関する問題が起きたら、まずCLIProxyAPIを疑い調査する。
- `~/.cli-proxy-api/logs/error-v1-messages-*.log` でエラーログを確認する。
- 429などのエラーがquota枯渇か偽装かを、RetryInfo・ErrorInfoの有無、応答までの時間(数百msでの即時返却は偽装の兆候)、同一bodyの再送で同じ結果になるかで見分ける。
- 失敗したリクエストをログから取り出し、curlで直接再送して再現を確認する。
- 再現したら、リクエストの構成要素(system・tools・metadata・thinking等)を1つずつ取り除き、二分探索で原因要素を特定する。
- 特定した要素を他モデル・他プロバイダー経路でも試し、プロバイダー固有かを確認する。
- CLIProxyAPIのGitHub issueを検索し、既知の問題と対応状況を確認する。
- `cliproxyapi.config.example.yaml` に該当する回避設定がないかを確認する。
- 調査結果を `docs/cliproxyapi/<日付>-<主題>.md` にまとめる。既存ファイルの見出し構成に合わせる。
- `docs/cliproxyapi/README.md` の表に、日付・ファイル・症状の一言・根本原因の分類を1行追記する。
