# task-utility

タスク進行を支援するユーティリティスキル群。

## 動作要件

フックとスクリプトは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。

Claude Code 本体はネイティブバイナリで配布され Node.js を同梱しないため、未導入の場合は別途インストールしてください。

## 文書の置き場

- `README.md`(このファイル): 利用者が読まなければこのプラグインを使えない情報
- `docs/rationale.md`: スキルの指示から退避した設計根拠(なぜその指示なのか)

## chat スキル

会話を `docs/chat/YYYY/MMDD/<作業者名>/*.md`(作業者名は git のユーザー名)に永続記録する。粒度契約(ユーザー発言=原文引用、AI発言=構造化要約、失敗は道筋ごと記録、網羅性の明記)は `skills/chat/SKILL.md` を参照。

## recall スキル

docs/chat/ の会話記録から決定の経緯・失敗の記録をキーワード検索し、出典付きで要約して返す(明示発動型)。候補の絞り込みは `scripts/find-chat-records.mjs`(INDEX.md があれば索引検索、なければ全文検索)、読解は軽量モデルの `chat-reader` サブエージェントに委譲し、メインのコンテキストを消費しない。詳細は `skills/chat-recall/SKILL.md` を参照。

## resume スキル

新しいセッションの冒頭で、本人(git のユーザー名)の直近の chat 記録から前回の進捗と持ち越し事項(記録末尾の「注意事項と次の作業」)を読み取り、再開点を合意する(明示発動型)。対象の特定は `find-chat-records.mjs --latest`、読解は chat-recall と同じ `chat-reader` に委譲する。詳細は `skills/resume/SKILL.md` を参照。

## 会話の自動記録(Stop フック + バックグラウンド chat-recorder)

実質的な会話が記録されないままターンが終わると、Stop フックは最小限の `additionalContext` を注入する。メインエージェントは通知を受けて `chat-recorder` サブエージェントをバックグラウンド起動し、完了を待たずにターンを終える。生ログ(トランスクリプト JSONL)から発言を機械抽出するため、ユーザー発言の逐語性が構造的に保証される。

- **オプトイン**: 対象プロジェクトに `docs/chat/` ディレクトリが存在する場合のみ働く。無効化したければディレクトリを作らないだけでよい
- **発火条件**: 最後の実質的なユーザー発言が記録済み行(ユーザーローカルの状態ファイルで管理)より新しいとき。1ターン目から働き、記録後も新しい発言があれば追記する。1 実発言につき記録試行は最大 1 回(ロックと試行済み行番号で多重起動・無限ループを防止)
- **注入の最小性**: `additionalContext` には記録に必要な値だけを載せ、手順やコマンド行は chat-recorder のエージェント定義に集約する。注入文は最大 1200 字で、メインのコンテキストへの影響を抑える
- **記録処理**: chat-recorder は `prepare-chat-recording.mjs` による入力収集、一時ファイルへの Write、`commit-chat-recording.mjs` による追記・INDEX 更新・検証・状態確定を行う
- **バックグラウンド実行時の permission**: `Bash` と `Write` の permission プロンプトが記録を止める環境では、必要に応じて `~/.claude/settings.json` の `permissions` に許可設定を追加する。プラグイン側から permission を強制することはない
- **制限**: フック設定の変更はセッション再起動後に反映される。記録の状態とロックは `~/.claude/task-utility/chat-recorder/` 配下(git 非追跡)に置かれる

## 会話記録の索引(INDEX.md)

`docs/chat/INDEX.md` に全記録の索引(1 ファイル 1 行: パス | 日付 | 作業者名 | 要旨)を置く。記録のたびに `commit-chat-recording.mjs` が対応行をパス昇順の位置へ追加、または既存行を更新する(INDEX.md が無ければヘッダー付きで新規作成)。索引に載っていない記録は chat-recall / resume の実行時に `unindexed` として検出され、依頼すればその場で補完される(専用の移行処理はない)。規約の正本は `skills/chat/SKILL.md` の「索引(INDEX.md)」節。

## 動作確認

リポジトリルートで実行する。

```bash
pnpm test
```

テストソースは `plugins/task-utility/src/**/__test__/*.test.ts` に配置する。
