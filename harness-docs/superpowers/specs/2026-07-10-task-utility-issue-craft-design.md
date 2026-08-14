# task-utility: issue-craft スキル 設計書

- 日付: 2026-07-10
- ステータス: ユーザー承認済みの設計(実装前)
- 前提: `docs/chat/2026/0710/task-utility-issue-craft-design.md`(設計ディスカッションの記録)

## 目的

ユーザーとのブレインストーミングを通じて GitHub Issue の内容を練り上げ、プラグインがインストールされたプロジェクトのリモートリポジトリに起票するスキル。単一 Issue の起票に加え、複数 Issue の一括起票に対応する。

## スコープ

- **含む**: 単一 Issue の起票 / 複数 Issue の一括起票(最初から複数、またはブレスト途中での切替)/ ラベルの提案 / Issue Template の選択 / Issue 間の相互参照
- **含まない**: アサイン・マイルストーン(ユーザーから明示的に指示された場合のみ設定)/ 親トラッキング Issue の作成 / 既存 Issue の子 Issue への分解(将来の別スキル。本設計の `check-issue-env.mjs` を共用する前提でスクリプトはプラグイン共通の場所に置く)

## 構成ファイル

```
plugins/task-utility/
├── skills/issue-craft/SKILL.md          # スキル本体(新規)
├── scripts/check-issue-env.mjs          # 環境チェックスクリプト(新規・プラグイン共通)
└── scripts/check-issue-env.test.mjs     # そのテスト(新規、node --test)
```

- スクリプトを `skills/issue-craft/` 配下ではなくプラグイン直下の `scripts/` に置くのは、将来の Issue 分解スキルとの共用のため
- 既存テストコマンドのグロブ `plugins/task-utility/scripts/*.test.mjs` にそのまま乗る

## 発動条件(SKILL.md の description)

ユーザーが GitHub Issue の起票・作成・下書きを依頼したときに必ず使用する、**明示発動型**。`chat` スキルのような自律発動条件は持たない。

## フロー

### 1. 環境チェック

`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-issue-env.mjs"` を実行し、JSON で事実を得る。

- git リポジトリでない → **git リポジトリ化(`git init` + リモート設定)を推奨して STOP**
- リモート未設定、または GitHub 以外のリモート → 状況を説明し、`gh repo create` 等を案内して **STOP**

### 2. 操作手段の決定

モデルが自分の利用可能ツール一覧を確認し、**GitHub 操作系 MCP Tool があればそれを優先**。なければ `gh` コマンド。gh も未インストール/未認証なら、導入手順・`gh auth login` を案内して **STOP**。

MCP Tool の有無はモデルのコンテキストにしか存在しないため、ここだけはスクリプトではなくモデルが判定する(責務分割: 事実収集=スクリプト、手段選択=モデル)。

### 3. 最初の確認(1回の質問にまとめる)

ディスカッション開始時に AskUserQuestion で以下を確認する:

- **Issue Template**: スクリプトが検出した一覧から選択、または「使わない」。テンプレートが存在する場合、この確認を飛ばして進めてはならない
- **Issue 本文の言語**: README・既存 Issue から推定した言語を推奨案として提示し確認する(例: 英語圏 OSS なら英語を推奨)

### 4. ブレインストーミング

- **ディスカッションはユーザーが使用する言語を厳守する**(SKILL.md に強い制約として明記)。Issue 本文の言語とは独立
- スタイルは「自由対話+観点チェックリスト」: 固定の質問順は強制せず、Issue 種別ごとの「埋まるべき観点」を SKILL.md に定義し、不足している観点だけを 1 問ずつ質問する
  - バグ報告: 再現手順 / 期待動作 / 実際の動作 / 環境 / 影響範囲
  - 機能要望: 背景・課題 / 提案内容 / 代替案 / スコープ外
  - タスク: 目的 / 完了条件
- テンプレート選択時は、テンプレートの項目がチェックリストになる
- 選択式で聞ける場面では AskUserQuestion を使う

### 5. ドラフト提示 → 明示承認

タイトル・本文・ラベル案(リポジトリの既存ラベルから提案)を全文提示し、**ユーザーの明示的な承認を得るまで起票しない**。

### 6. 起票

- MCP Tool または `gh issue create`。gh の場合、本文はクォート事故防止のため一時ファイル経由(`--body-file`)で渡す
- 成功したら Issue URL を報告する

## 複数起票モード

### モードへの入り方(2経路)

1. **最初から**: ユーザーの依頼自体が複数件の起票を含む場合
2. **途中から**: ブレスト中に「1 つの Issue にまとめるのは重い」と判断した場合、分割案(各 Issue のタイトル+スコープ 1 行)を提示し、**ユーザーの承認が得られたときだけ**切り替える。拒否されたら単一 Issue のまま続行する

切替判断の基準(SKILL.md に明記):

- 独立してクローズできる関心事が複数ある
- 担当や時期が分かれうる
- テンプレート種別(バグ/機能要望など)が混在する

### モード内のフロー

1. 環境チェック・操作手段・言語確認は全体で 1 回だけ(共通)
2. **分割設計を先に確定**: Issue の一覧(タイトル・スコープ・相互の依存関係)をユーザーと合意してから各論に入る
3. テンプレートは Issue ごとに確認(種別が混在しうるため)。全件同じならまとめて指定可
4. 各 Issue のドラフトを順に練る(不足観点だけ質問、という単一モードと同じ規律)
5. **全ドラフトを一覧で最終提示 → 一括承認**(「2 番だけ直して」のような個別修正に対応)
6. 承認後に一括起票し、URL 一覧を報告する

### Issue 間の関連付け

親トラッキング Issue は作らず、各 Issue の本文に相互参照(`Related: #n`)を入れる。

番号の解決順序: 起票するまで番号は確定しないため、(1) 全 Issue を順に起票し、(2) 起票済みの番号を後続 Issue の本文に反映し、(3) 全件起票後、先行 Issue の本文に後続の番号を追記修正(MCP Tool の issue 更新、または `gh issue edit --body-file`)する。この手順を SKILL.md に明記する。

## check-issue-env.mjs の仕様

標準出力に JSON を 1 つ返す。**常に exit 0** とし、STOP するかどうかの判断はスキル側(モデル)が行う。

```json
{
  "isGitRepo": true,
  "remoteUrl": "git@github.com:owner/repo.git",
  "repoSlug": "owner/repo",
  "ghInstalled": true,
  "ghAuthenticated": true,
  "templates": [
    { "file": "bug_report.yml", "name": "バグ報告", "about": "...", "title": "", "labels": ["bug"] }
  ],
  "blankIssuesEnabled": true
}
```

- `remoteUrl`: `origin` の URL。未設定なら `null`
- `repoSlug`: GitHub リモート(github.com の SSH/HTTPS)から抽出した `owner/repo`。GitHub 以外なら `null`
- `templates`: `.github/ISSUE_TEMPLATE/*.{md,yml,yaml}` をローカルから検出。YAML パーサ依存を増やさず、トップレベルの `name:` / `about:` / `description:` / `title:` / `labels:` のみ簡易抽出する(`about` は md 形式、`description` は yml フォーム形式のキー。JSON 出力ではどちらも `about` に正規化)
- `blankIssuesEnabled`: `.github/ISSUE_TEMPLATE/config.yml` の `blank_issues_enabled`。ファイルまたはキーが無ければ `true`
- 依存パッケージなし(Node 標準モジュールのみ)。既存スクリプトと同様に `node --test` でテストする

## エラー処理

- 起票 API/コマンドの失敗(権限・ネットワーク)→ 生のエラーを報告し、勝手なリトライや代替手段への切替をしない
- STOP 系はすべて「理由+次にユーザーがすべきこと」を明示して終了する
- 複数起票の途中で失敗した場合 → どこまで起票済みか(URL 一覧)と、失敗した Issue・エラー内容を報告して停止する。起票済み Issue の削除(ロールバック)は行わない

## テスト

`check-issue-env.test.mjs`(node --test)で以下を検証する:

- 非 git ディレクトリ / リモート未設定 / GitHub 以外のリモート / GitHub リモート(SSH・HTTPS 両形式)の判定
- テンプレート検出: md / yml 混在、frontmatter・トップレベルキーの抽出、`config.yml` の有無
- gh 未インストール環境の判定(PATH 制御で再現)

SKILL.md 本体の振る舞い(対話フロー)は自動テスト対象外(手動確認)。

## バージョンと文書

- `plugins/task-utility/.claude-plugins/plugin.json`: `1.0.1-dev` → `1.1.0-dev`(新機能追加のマイナーアップ)
- `plugins/task-utility/README.md` に issue-craft の節を追加

## 決定の経緯(要約)

| 論点 | 決定 |
| --- | --- |
| Issue 本文の言語 | リポジトリから推定し、冒頭確認で提案(ディスカッション自体はユーザー言語厳守) |
| メタデータ | ラベルのみ提案。アサイン/マイルストーンは明示指示時のみ |
| 対話スタイル | 自由対話+観点チェックリスト |
| スキル名 | `issue-craft`(候補: issue / open-issue / create-issue から選定) |
| 実装アプローチ | 環境チェックスクリプト付き(テスト可能性・軽量モデルでの判定安定性を重視) |
| リモート未設定時 | STOP |
| 複数 Issue の関連付け | 親は作らず相互参照のみ |
| 既存 Issue の分解ツール | 別スキルとして後日設計(check-issue-env.mjs を共用) |
