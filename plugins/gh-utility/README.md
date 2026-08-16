# gh-utility

GitHub 関連のユーティリティスキル群。

## 動作要件

スクリプトは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。

Claude Code 本体はネイティブバイナリで配布され Node.js を同梱しないため、未導入の場合は別途インストールしてください。

Issue の操作には GitHub CLI(`gh`)のインストールと認証が必要です。環境の充足は各スキルの最初の手順で `scripts/check-issue-env.mjs` が確認します。

## 文書の置き場

- `README.md`(このファイル): 利用者が読まなければこのプラグインを使えない情報
- `docs/rationale.md`: スキルの指示から退避した設計根拠(なぜその指示なのか)
- `references/github-issue-common.md`: issue 系 3 スキルが実行時に共有する規律(AI が読む)

## issue-craft スキル

ユーザーとのブレインストーミングで GitHub Issue を練り上げ、リモートリポジトリに起票する(明示発動型)。単一/複数の一括起票に対応。環境の事実(git リポジトリ・リモート・gh・Issue テンプレート)は `scripts/check-issue-env.mjs` が JSON で返し、STOP 判断や対話はスキル側が行う。他のスキル・エージェントが固定開始句「持ち込みモード: 以下の完成済み本文で起票」で起動したときは持ち込みモードに入り、ブレインストーミングを飛ばして渡された本文をそのまま起票する(承認ゲートは実行する)。詳細は `skills/issue-craft/SKILL.md` を参照。

## issue-split スキル

既存の親 Issue(番号/URL 指定)をユーザーとのディスカッションでタスク分解し、子 Issue を起票して GitHub 公式の Sub-issues として親にリンクする(明示発動型)。親 Issue の本文は変更しない。環境チェックは issue-craft と共通の `scripts/check-issue-env.mjs`、Sub-issues リンクの REST API 2 ステップ(子の内部 ID 取得 → 親へ POST)は `scripts/link-sub-issue.mjs` に閉じている。詳細は `skills/issue-split/SKILL.md` を参照。

## issue-triage スキル

open Issue を棚卸しし、ラベル提案・古い Issue の生死確認(既定 90 日)・重複候補の検出を行い、全提案の一括承認後に適用する(明示発動型)。Issue の取得・stale 判定は `scripts/list-issues.mjs` が JSON で返し、クローズ提案は「自分が作者・アサインなし・コメントなし」の Issue に限る決定的ルールで安全側に倒す。環境チェックは issue-craft と共通の `scripts/check-issue-env.mjs`。詳細は `skills/issue-triage/SKILL.md` を参照。

## issue 系スキルの共通規律

issue-craft / issue-split / issue-triage は、環境チェック・操作手段の決定・言語規律・承認規律・ラベル規律・失敗時の扱いを `references/github-issue-common.md` で共有する。各 SKILL.md は冒頭でこのファイルを参照し、固有の手順だけを本文に持つ。規律を変えるときは共通ファイルを直す。

## 会話記録について

会話の記録・検索・再開(chat / recall / resume スキルと chat-recorder)は、このプラグインから分離した `chat-history` プラグインが担当します。

## 動作確認

リポジトリルートで実行する。

```bash
pnpm test
```

テストソースは `plugins/gh-utility/src/**/__test__/*.test.ts` に配置する。
