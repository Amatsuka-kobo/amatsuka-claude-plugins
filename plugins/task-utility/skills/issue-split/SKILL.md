---
name: issue-split
description: ユーザーが既存の GitHub Issue のタスク分解・子 Issue 作成・Sub-issue 化を依頼したときに必ず使用するスキル。分解対象の親 Issue(番号または URL)を起点に、ユーザーとのディスカッションで分解設計を練り上げ、子 Issue を起票して GitHub の Sub-issues として親にリンクする。ゼロから Issue を起票する場合は issue-craft を使う。明示的な依頼があったときのみ使い、自律的には発動しない。
---

# Issue Split — GitHub Issue のタスク分解

## 目的

既存の親 Issue を出発点に、ディスカッションでタスク分解を練り上げ、子 Issue 群を起票して GitHub 公式の Sub-issues として親にリンクする。

## 大原則

- **ディスカッションはユーザーが使用する言語を厳守する**。有意義な対話のための絶対条件であり、Issue 本文の言語(手順 4 で確認)とは独立した規律
- **ユーザーの明示的な承認を得るまで起票しない**。起票は取り消しの効きにくい外部公開行為である
- **親 Issue の本文は変更しない**。親子関係の表現は Sub-issues リンクのみで行う
- STOP するときは必ず「理由+次にユーザーがすべきこと」を伝えて終了する

## 手順

### 1. 環境チェック

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-issue-env.mjs"
```

出力 JSON の事実に基づいて判断する:

- `isGitRepo: false` → git リポジトリ化(`git init` とリモート設定)を推奨して **STOP**
- `repoSlug: null`(リモート未設定、または GitHub 以外のリモート)→ 状況を説明し、GitHub リポジトリの作成・リモート設定(`gh repo create` 等)を案内して **STOP**

### 2. 操作手段の決定

自分の利用可能ツール一覧を確認し、次の優先順で決める:

1. GitHub 操作系の MCP Tool で **Issue の作成と Sub-issue リンクの両方**ができるなら、それを使う
2. Issue 作成だけできる MCP Tool の場合、作成は MCP Tool・リンクは `link-sub-issue.mjs`(gh を使用)を併用する。ただし JSON が `ghInstalled: false` または `ghAuthenticated: false` なら、Sub-issues リンクを張れない旨を説明し、gh の導入・認証を案内して **STOP**
3. MCP Tool がなければ `gh` コマンド。`ghInstalled: false` なら導入手順を、`ghAuthenticated: false` なら `gh auth login` の実行を案内して **STOP**

### 3. 親 Issue の取得

ユーザーが指定した番号 / URL から親 Issue を読み取る(`gh issue view <番号>`、または MCP Tool)。あわせて既存の Sub-issues も確認する(`gh api repos/<owner/repo>/issues/<番号>/sub_issues`、または MCP Tool)。

- 親 Issue が存在しない・アクセスできない → 生のエラーを伝えて **STOP**
- 既に Sub-issues がある → 一覧を提示し、追加分解でよいかユーザーに確認してから続行

### 4. 最初の確認(1 回の質問にまとめる)

ディスカッションに入る前に、AskUserQuestion で次を確認する:

- **子 Issue 本文の言語**: 親 Issue・README からリポジトリの言語を推定し、推奨案として提示して確認する。ディスカッションの言語はこれと無関係にユーザーの言語のまま
- **Issue Template**: 子 Issue はタスク型の軽量本文(後述)なので「テンプレートを使わない」を推奨とする。ただし JSON の `blankIssuesEnabled: false` のときは「使わない」を選択肢に出さず、`templates` 一覧(`name`・`about` を添える)から選択してもらう

### 5. 分解たたき台の提示 → ディスカッション

親 Issue を読んだら、**まず自分の分解案を提示する**。各子 Issue につきタイトル+スコープ 1 行+子同士の依存関係。それを叩き台にディスカッションして練り上げる。

分解の適切さのチェックリスト(すべて満たすまで練る):

- 各子 Issue が独立してクローズできる
- 粒度が揃っている(1 つだけ巨大な子 Issue がない)
- 子の完了条件の合計が親の完了条件をカバーする(漏れがない)
- 親のスコープ外のタスクが混ざっていない

分解の議論中に親 Issue 自体の不備(完了条件が曖昧など)が見つかった場合は指摘してよいが、親本文の修正はこのスキルの範囲外(ユーザーに委ねる)。

### 6. 全ドラフト一覧提示 → 一括承認

各子 Issue のタイトル・本文・ラベル案を**全文**一覧で提示し、一括で承認を得る(「2 番だけ直して」のような個別修正に対応する)。

子 Issue の本文はタスク型の軽量本文とする:

- 目的(親のどの部分を担うか)
- 完了条件
- 末尾に `Parent: #親番号`(Sub-issues リンクとは別に、本文からも辿れるようにする)

テンプレートを使う場合はテンプレートの項目構成に従いつつ、上記 3 点を必ず含める。

- ラベルはリポジトリの既存ラベル(`gh label list` または MCP Tool)から提案する。存在しないラベルを勝手に作らない
- アサイン・マイルストーンはユーザーから明示的に指示されたときだけ設定する

### 7. 起票 + リンク

承認された子 Issue を 1 件ずつ「作成 → 親にリンク」の順で処理する:

1. **作成**: MCP Tool、または `gh issue create --title <title> --body-file <一時ファイル> --label <label>`。gh の場合、本文は必ず一時ファイル経由(`--body-file`)で渡す(シェルのクォート事故防止)
2. **リンク**: MCP Tool、または:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/link-sub-issue.mjs" <owner/repo> <親番号> <子番号>
   ```

   出力 JSON が `ok: false` なら失敗。`error` を**そのまま**ユーザーに報告して停止する。勝手なリトライや代替手段(本文参照方式など)への切り替えをしない

全件完了したら、親 Issue の URL と子 Issue の URL 一覧を報告する。親 Issue の本文は更新しない(Sub-issues リンクにより GitHub UI 上で子一覧・進捗が表示される)。

### 8. 途中で失敗した場合

どこまで処理済みか(作成済み子 Issue の URL と、それぞれリンク済みかどうか)と、失敗した箇所・エラー内容を報告して停止する。作成済み Issue の削除(ロールバック)はしない。
