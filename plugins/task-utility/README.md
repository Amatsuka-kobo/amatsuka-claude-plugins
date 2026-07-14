# task-utility

タスク進行を支援するユーティリティスキル群。

## issue-craft スキル

ユーザーとのブレインストーミングで GitHub Issue を練り上げ、リモートリポジトリに起票する(明示発動型)。単一/複数の一括起票に対応。環境の事実(git リポジトリ・リモート・gh・Issue テンプレート)は `scripts/check-issue-env.mjs` が JSON で返し、STOP 判断や対話はスキル側が行う。詳細は `skills/issue-craft/SKILL.md` を参照。

## issue-split スキル

既存の親 Issue(番号/URL 指定)をユーザーとのディスカッションでタスク分解し、子 Issue を起票して GitHub 公式の Sub-issues として親にリンクする(明示発動型)。親 Issue の本文は変更しない。環境チェックは issue-craft と共通の `scripts/check-issue-env.mjs`、Sub-issues リンクの REST API 2 ステップ(子の内部 ID 取得 → 親へ POST)は `scripts/link-sub-issue.mjs` に閉じている。詳細は `skills/issue-split/SKILL.md` を参照。

## chat スキル

会話を `docs/chat/YYYY/MMDD/<作業者名>/*.md`(作業者名は git のユーザー名)に永続記録する。粒度契約(ユーザー発言=原文引用、AI発言=構造化要約、失敗は道筋ごと記録、網羅性の明記)は `skills/chat/SKILL.md` を参照。

## chat-recall スキル

docs/chat/ の会話記録から決定の経緯・失敗の記録をキーワード検索し、出典付きで要約して返す(明示発動型)。候補の絞り込みは `scripts/find-chat-records.mjs`(INDEX.md があれば索引検索、なければ全文検索)、読解は軽量モデルの `chat-reader` サブエージェントに委譲し、メインのコンテキストを消費しない。詳細は `skills/chat-recall/SKILL.md` を参照。

## resume スキル

新しいセッションの冒頭で、本人(git のユーザー名)の直近の chat 記録から前回の進捗と持ち越し事項(記録末尾の「注意事項と次の作業」)を読み取り、再開点を合意する(明示発動型)。対象の特定は `find-chat-records.mjs --latest`、読解は chat-recall と同じ `chat-reader` に委譲する。詳細は `skills/resume/SKILL.md` を参照。

## issue-triage スキル

open Issue を棚卸しし、ラベル提案・古い Issue の生死確認(既定 90 日)・重複候補の検出を行い、全提案の一括承認後に適用する(明示発動型)。Issue の取得・stale 判定は `scripts/list-issues.mjs` が JSON で返し、クローズ提案は「自分が作者・アサインなし・コメントなし」の Issue に限る決定的ルールで安全側に倒す。環境チェックは issue-craft と共通の `scripts/check-issue-env.mjs`。詳細は `skills/issue-triage/SKILL.md` を参照。

## 会話の自動記録(Stop フック + chat-recorder エージェント)

実質的な会話が記録されないままターンが終わると、Stop フックが差し戻して記録を促す。記録本体はメインセッションではなく軽量モデル(haiku)の `chat-recorder` サブエージェントが行い、生ログ(トランスクリプト JSONL)から発言を機械抽出するため、ユーザー発言の逐語性が構造的に保証される。

- **オプトイン**: 対象プロジェクトに `docs/chat/` ディレクトリが存在する場合のみ働く。無効化したければディレクトリを作らないだけでよい
- **発火条件**: 最後の実質的なユーザー発言が最後の記録イベント(`docs/chat/` への Write/Edit、または `chat-recorder` へのディスパッチ)より新しいとき。1ターン目から働き、記録後も新しい発言があれば追記を促す。差し戻しは 1 ストップにつき 1 回まで(無限ループ防止)
- **制限**: フック設定の変更はセッション再起動後に反映される

## 会話記録の索引(INDEX.md)

`docs/chat/INDEX.md` に全記録の索引(1 ファイル 1 行: パス | 日付 | 作業者名 | 要旨)を置く。chat-recorder が記録のたびに対応行を追加・更新する。索引に載っていない記録は chat-recall / resume の実行時に `unindexed` として検出され、依頼すればその場で補完される(専用の移行処理はない)。規約の正本は `skills/chat/SKILL.md` の「索引(INDEX.md)」節。

## 動作確認

```bash
pnpm test
```

テストソースは `plugins/task-utility/src/**/__test__/*.test.ts` に配置する。
