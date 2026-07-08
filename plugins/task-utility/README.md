# task-utility

タスク進行を支援するユーティリティスキル群。

## chat スキル

会話を `docs/chat/YYYY/MMDD/*.md` に永続記録する。粒度契約(ユーザー発言=原文引用、AI発言=構造化要約、失敗は道筋ごと記録、網羅性の明記)は `skills/chat/SKILL.md` を参照。

## 会話の自動記録(Stop フック + chat-recorder エージェント)

実質的な会話が記録されないままターンが終わると、Stop フックが差し戻して記録を促す。記録本体はメインセッションではなく軽量モデル(haiku)の `chat-recorder` サブエージェントが行い、生ログ(トランスクリプト JSONL)から発言を機械抽出するため、ユーザー発言の逐語性が構造的に保証される。

- **オプトイン**: 対象プロジェクトに `docs/chat/` ディレクトリが存在する場合のみ働く。無効化したければディレクトリを作らないだけでよい
- **発火条件**: 最後の実質的なユーザー発言が最後の記録イベント(`docs/chat/` への Write/Edit、または `chat-recorder` へのディスパッチ)より新しいとき。1ターン目から働き、記録後も新しい発言があれば追記を促す。差し戻しは 1 ストップにつき 1 回まで(無限ループ防止)
- **制限**: フック設定の変更はセッション再起動後に反映される

## 動作確認

```bash
node --test plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs \
            plugins/task-utility/scripts/extract-conversation.test.mjs
```
