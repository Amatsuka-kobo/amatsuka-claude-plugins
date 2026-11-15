# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace

## スクリプトツール

- セッション内で使用する、一時スクリプト以外のツールは `Python` で作成し、`tools/` に配置する。
- ユーザーが手動で実行するためのツールは `ShellScript` で作成し、`scripts/` に配置する。

## 作業の仕方

- ユーザーからの依頼内容がプラグインの改修であったとき、まだGitHubのIssueとして作られていないときは要件を詰めてIssueを作る。
- 要件を詰めた結果人間が作業したときに1日を超える時間がかかりそうなタスクは`Story`、そうでないものは`Subtask`と呼称し、Storyはタスク分解を行い子IssueとしてSubtaskを起票する。
- mainからブランチを切って作業する。複数のSubtaskを対応するときはworktreeで作業する。

## GitHub Issueの運用

このプロジェクトで管理するIssueにはすべて[Codiel Agentのprojects](https://github.com/orgs/Amatsuka-kobo/projects/3)を設定する。

- system: `Amatsuka Claude Plugins`
- ticket-type: `Story` or `Subtask`
- 新しく作るIssue: `Backlog`
- 直近で着手するSubtask: `Todo`
- 着手中のIssue: `In Progress`
- closeしたIssue: `Done`

Subtaskに着手するときは以下の設定を行う。

- Subtaskのみ、currentのiterationと、ログイン中GitHubアカウントをAssigneeに設定する。
- 着手するSubtaskとその親StoryとEpicのstatusをIn Progressにする。