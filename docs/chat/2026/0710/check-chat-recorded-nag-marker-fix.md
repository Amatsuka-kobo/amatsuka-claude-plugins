# Task-utility chat hook 無限ループ修正（Stop フック NAG_MARKER ガード化）

- 日付: 2026-07-10
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `plugins/task-utility/hooks/scripts/check-chat-recorded.mjs`（NAG_MARKER ガード追加）、`plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs`（テスト3件追加、全45テスト通過）
- 前提: Google Drive ドキュメント「chat-recorder Stop フック 無限ループ 修正方針(mjs 専用)」（https://drive.google.com/file/d/1hXTlZAnTAUxef3tBIJBFsosNsBOkUuDy/view?usp=sharing）

---

## セッション1: 修正方針ドキュメント分析と実装

# phyllis998

> task-utiltyのchat hookで、何度もchatファイルに記録される不具合が発生しました。
> これはその現象の修正方針です。これを分析し、修正にあたってください。
> https://drive.google.com/file/d/1hXTlZAnTAUxef3tBIJBFsosNsBOkUuDy/view?usp=sharing

# AI

**調査と根本原因の検証**:

修正方針ドキュメントを分析し、現行コード（`check-chat-recorded.mjs`）を照合。

**不具合の根本原因**:
Stop フックの無限ループガードが `stop_hook_active`(旧コード 12行目)の1条件のみで実装されていた。このフラグは「block 直後にテキストのみで再停止した」場合のみ true になり、block への正しい応答である Agent ツール呼び出し（chat-recorder ディスパッチ）を挟むとリセットされる。結果、ディスパッチが検知されない・エージェントが指示を誤認するケースで毎停止ごとに block が再注入され、記録サブエージェントが何度も起動して chat ファイルへ重複記録される状況に陥っていた（実測では実発言2回に対し block 7回）。

**実装方針の決定**:
ドキュメントのチェックリスト全項目に従い、以下の修正を実施。

1. **番兵マーカー定数追加** — `NAG_MARKER = '<!--chat-recorder-nag-->'` を定義
2. **トランスクリプト走査に lastNag 追跡追加** — user 文字列メッセージ中のマーカーを検出（マーカー行は `<` 始まりなので `lastUserTurn` には二重に混入しない）
3. **差し戻し判定に冪等性ガード追加** — `if (lastNag > lastUserTurn) process.exit(0);` を挿入 → **実ユーザー発言1回につき差し戻し最大1回**を保証
4. **block reason の先頭にマーカー付与** — 注入された reason がトランスクリプトに残り、次回走査で検出される
5. **既存補助ガード（`stop_hook_active`・`subagent_type` 明示）は安価な補助として残置** — リスク低減

**TDD による実装**:

テスト駆動開発で実施。先に3つの新規テストを追加し、現行コードで fail することを確認：
- 同一未記録状態では2回目は差し戻さない（nag-once）
- nag の後に新しい実発言が来たら再度 block する（状態遷移）
- block reason にマーカーが含まれる（マーカー永続性）

これらテストが fail すること(現行コード が冪等性欠落)を確認 → 修正 → 全テスト通過。

**テスト結果**: 全45テスト通過（新規3 + 既存42）。既存テスト（`stop_hook_active` ケース含む）は無変更で全通過。リポジトリ内の他スクリプトテスト（codiel 含む）も全て通過。

**設計の洞察**:
- この修正は「フックの出力自体を状態として使う」パターン。Stop フックは毎回トランスクリプトを全走査するため、状態ファイルや環境変数なしで冪等性（ターンごと最大1回）を実現でき、セッション再開後も正しく機能する
- 異常系（エージェントが記録を無視した場合）は `lastRecord` が前進しないが、`lastNag > lastUserTurn` で2回目以降は素通しになり、「技術的に記録できない場合は諦めてよい」という既存設計許容と同じ結末に収束
- 新しい実発言が来ると `lastUserTurn` が `lastNag` を追い越すため、次ターンでは再び1回だけ差し戻せる → 記録の督促機能自体は失われない

---

注意事項: mjs 版のみコミット対象。bash 版は別スコープ。
