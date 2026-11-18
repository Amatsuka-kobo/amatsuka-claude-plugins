# リポジトリ概要

あまつか工房産 Claude Code プラグインの Marketplace

## スクリプトツール

- セッション内で使用する、一時スクリプト以外のツールは `Python` で作成し、`tools/` に配置する。
- ユーザーが手動で実行するためのツールは `ShellScript` で作成し、`scripts/` に配置する。

## 作業の仕方

- ユーザーからの依頼内容がプラグインの改修であったとき、まだGitHubのIssueとして作られていないときは要件を詰めてIssueを作る。
- 要件を詰めた結果人間が作業したときに1日を超える時間がかかりそうなタスクは`Story`、そうでないものは`Subtask`と呼称し、Storyはタスク分解を行い子IssueとしてSubtaskを起票する。
- mainブランチからEnterWorktreeで切ったworktreeで作業する。

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

## 探索と編集

- コードベースの探索は Serena のシンボルツールで行う。0 件でも結論にせず Grep で裏を取る。
- TypeScript / JavaScript / Markdown / Python の作成と編集は Serena の編集ツールで行う。
- ライブラリ・フレームワーク・CLI・API の仕様、セットアップ手順、コード生成の方法が要るときは Context7 で取る。Web 検索より優先する。

## プラグインのバージョン

プラグインのバージョンは、以下の規則によって決定する。

- 形式は `x1.x2.x3` とし、x1はメジャーバージョン、x2はマイナーバージョン、x3はパッチバージョンと呼称する。
- 開発中のプラグインは末尾に `-dev` と付け、付けていないものはリリース済みのものである。
- プラグインを改修したときはパッチバージョンを上げ、メジャー・マイナーバージョンはユーザーからの指示があったときのみ上げる。

## AI 向けの指示書

以下に挙げるファイルは AI 向けの指示書であり、作成・編集する前に `prompt-smith:prompt-smith` を起動し、その規律に従って書く。

- `CLAUDE.md`
- `docs/prompts/*.md`
- `harness-docs/**/*.md`
- `.claude/rules/**/*.md`
- `.claude/output-styles/*.md`
- `plugins/<plugin>/references/**/*.md`
- `plugins/<plugin>/assets/**/*.md`
- `**/skills/**/references/**/*.md`
- `**/skills/**/assets/**/*.md`

## 完了条件

- `pnpm run lint` と `pnpm run typecheck` と `pnpm run test` が通る。
- `plugins/*/src/` を変更したなら `pnpm run build` を実行し、`plugins/*/scripts/` の差分が同じコミットにある。
- プラグインを追加または改修したなら、ルートの `README.md` に反映されている。
- ARCHITECTURE に影響する変更をしたなら、`/metatron:update` で追随させている。
- 改修した内容が `.serena/memories/` の記述と食い違うなら、該当メモリを更新している。
- 編集内容を適切に分けて git にコミットしている。

@harness-docs/ARCHITECTURE.md
