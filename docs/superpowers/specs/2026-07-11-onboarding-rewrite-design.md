# ONBOARDING.md 再構成設計

## 背景

現在の `ONBOARDING.md` は、LSP の導入手順と、Codex／CLIProxyAPI／Claude Code の接続設定を同じ階層で扱っている。そのため、初めて環境を構築する工房メンバーが、どこまでを必須で行うべきか判断しにくい。

また、LSP の説明はインストールコマンドが中心で、対象環境、コマンドの実行場所、導入後の確認方法が不足している。一方、任意の CLIProxyAPI 設定は詳細で長く、環境構築の主要経路を見えにくくしている。

## 目的

工房メンバー、とくにジュニアエンジニアが、WSL2/Linux を中心とした開発環境を迷わず準備できる文書にする。

この文書の完了条件は、Volta で管理する Node.js LTS、Serena MCP の起動に必要な `uv`、Claude Code の共通ツール、必要な LSP を導入し、各コマンドが利用可能であることを確認できることである。ブランチ運用、実装、テスト、リリースなどの開発フローは対象外とする。

## 対象読者と環境

- 対象読者: あまつか工房の開発メンバー
- 主な対象: 初めてこのリポジトリの環境を構築するジュニアエンジニア
- 正式な案内対象: WSL2/Linux
- 補足対象: macOS。ただし CLIProxyAPI の任意設定ページにある Homebrew 手順のみ保持する

## 文書構成

### `ONBOARDING.md`

次の順序で、必須のセットアップ経路を案内する。

1. 文書の対象とゴール
2. 対象環境
3. 必須ツール（Volta／Node.js／uv）
4. Claude Code の共通ツール
5. LSP の用途とインストール
6. セットアップ確認
7. 任意設定へのリンク
8. トラブル時の確認先

各手順には、必要に応じて次の情報を添える。

- コマンドを実行する場所
- コマンドが行うこと
- 成功時に確認できる状態
- OS やパッケージマネージャーに関する前提

### 必須ランタイム

Claude Code と各プラグインの機能を動かすため、Node.js と `uv` を必須ツールとして説明する。

#### Volta と Node.js

このプロジェクトでは Node.js のバージョン管理に Volta を推奨する。WSL2/Linux では公式の Unix インストーラーを使用する。

```bash
curl https://get.volta.sh | bash
```

インストーラーは `VOLTA_HOME="$HOME/.volta"` と `$VOLTA_HOME/bin` の `PATH` 設定をシェルの起動ファイルへ追加する。インストール後は新しいターミナルを開き、Volta で最新の LTS 版 Node.js を導入する。

```bash
volta install node
```

Volta の公式資料では、バージョンを省略した `volta install node` が最新の LTS リリースを選択する。固定されていない `node@lts` という表記は使用しない。

次のコマンドで Volta、Node.js、npm、npx を確認する。

```bash
volta --version
node --version
npm --version
npx --version
```

Node.js は、各プラグインの `.mjs` スクリプトと `node --test`、LSP の `npm install -g`、Context7 の `npx ctx7 setup` に必要である。

#### uv

`uv` は Python のパッケージ／ツールランナーであり、この環境では Serena MCP サーバーを `uvx` で起動するために必要である。WSL2/Linux では公式の standalone installer を使用する。

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

インストール後は新しいターミナルを開き、次のコマンドで確認する。

```bash
uv --version
uvx --version
```

Serena の個別起動コマンドを手動実行させるのではなく、`claude mcp list` で `plugin:serena:serena` が Connected になっていることを確認手順とする。現在の MCP 登録は `uvx --from git+https://github.com/oraios/serena serena start-mcp-server` を使用している。

### Context7 のセットアップ

Context7 は LSP ではなく、Claude Code がライブラリやフレームワークの最新ドキュメントを取得するための MCP である。そのため LSP セクションには含めず、「Claude Code の共通ツール」として必須セットアップの後、LSP の前に配置する。

工房メンバーの共通環境へグローバル設定するため、次のコマンドを案内する。Context7 CLI のデフォルトはグローバル設定であり、この用途では `--project` を付けない。

```bash
npx ctx7 setup --claude --mcp --yes
```

各オプションの意味をジュニア向けに短く説明する。

- `--claude`: Claude Code 向けに設定する
- `--mcp`: CLI + Skills ではなく MCP サーバーとして登録する
- `--yes`: 確認プロンプトを省略する

前提として Node.js と `npx` が利用可能であることを明記する。セットアップ後は次のコマンドで登録状態を確認する。

```bash
claude mcp list
```

問題がある場合は次のコマンドで Context7 のログを確認する。

```bash
claude mcp logs context7
```

プロジェクト単位で設定したい場合に使う `--project` は、工房の標準手順には含めず補足に留める。

### CLIProxyAPI の任意設定ページ

Codex／CLIProxyAPI の詳細を `ONBOARDING.md` から分離し、`docs/development/cliproxyapi-setup.md` に移す。

`ONBOARDING.md` には次だけを記載する。

- CLIProxyAPI は任意設定である
- Codex や Claude Code をローカルプロキシ経由で使う場合に必要である
- 詳細ページへのリンク

## LSP の扱い

次の4種類を残す。

| LSP | 対象 | 文書で説明する用途 |
| --- | --- | --- |
| `pyright` | Python | 補完と静的診断 |
| `vtsls` | TypeScript/JavaScript | 補完と静的診断 |
| `bash-language-server` | Shell Script | 補完と静的診断 |
| `mdbase-lsp` | Markdown | Markdown 編集支援 |

重複した説明を減らすため、最初に一覧表で用途を示し、その後に番号付きの導入手順を書く。

`mdbase-lsp` については、`scripts/install-mdbase.sh` が次の処理を行うことを実行前に説明する。

- Debian/Ubuntu 系の `apt` と `sudo` を使用する
- `git`、`build-essential`、`rustup` を必要に応じて導入する
- 外部 GitHub リポジトリを `$HOME/third-party` に clone する
- Rust でリリースビルドする
- `$HOME/.local/bin/mdbase-lsp` にシンボリックリンクを作る

## CLIProxyAPI ページに残す情報

- Linux の公式インストーラー
- macOS の Homebrew 手順
- ローカルホストへバインドする設定例
- 認証情報を Git にコミットしないという警告
- Codex OAuth ログイン
- `--no-browser` を使う場合の説明
- CLIProxyAPI の起動方法と `scripts/start-proxy.sh`
- Codex CLI の接続設定
- Claude Code の OAuth 接続手順
- Claude Code の接続用トークンを使う手順
- 通常の接続へ戻す方法

## 承認済みの削除範囲

次の記述は優先度が低く、陳腐化または誤解の原因になりやすいため削除する。

1. Claude Code 1.x/2.x 別の固定モデル ID と環境変数例
2. CLIProxyAPI の実行ファイル名が配布形態によって異なる場合に読み替える、という曖昧な説明

次の情報は削除しない。

- macOS の Homebrew 手順
- OAuth 認証手順
- API キー／接続用トークンを使う手順
- Codex CLI の接続設定

## CLIProxyAPI 設定ファイルの管理

ローカルで実際に使用する設定と、Git で共有するサンプルを分離する。

- `cliproxyapi.config.yaml`: 各メンバーのローカル設定。`.gitignore` に追加し、Git の追跡対象から外す
- `cliproxyapi.config.example.yaml`: Git で共有するサンプル設定

`cliproxyapi.config.yaml` はすでに Git のインデックスへ追加されているため、`.gitignore` への追加だけでは追跡対象から外れない。実装時は作業ツリーのファイルを残したまま、インデックスから外す操作が必要である。

サンプル設定は、公式設定例を基準に次の項目へ絞る。

- `host: "127.0.0.1"`
- `port: 8317`
- `auth-dir: "~/.cli-proxy-api"`
- プレースホルダーのみを持つ `api-keys`
- 現在の値を保持した `oauth-excluded-models.claude`
- 現在の値を保持した `oauth-excluded-models.codex`

現在設定していない機能の説明コメント、コメントアウトされたプロバイダー例、プラグイン設定、TLS、管理 API、ログ、リトライ、ルーティング、ペイロード変換などはサンプルから削除する。`oauth-excluded-models` は工房の標準設定として値を保持する。

CLIProxyAPI の任意設定ページでは、初回セットアップ時に次の手順を案内する。

```bash
cp cliproxyapi.config.example.yaml cliproxyapi.config.yaml
```

コピー後、`api-keys` のプレースホルダーを各メンバー固有の値へ置き換える。`scripts/start-proxy.sh` は引き続きローカル設定の `cliproxyapi.config.yaml` を読み込む。

## 安全性

- 文書とサンプルには実際の API キー、接続用キー、OAuth トークンを記載しない
- `cliproxyapi.config.example.yaml` の `api-keys` にはプレースホルダーのみを置く
- 実際のキーを持つ `cliproxyapi.config.yaml` は `.gitignore` で除外する
- 現在インデックスへ追加されている実設定を追跡対象から外す
- 実設定ファイルを削除せず、ローカルで引き続き利用できる状態を保つ

## 検証

変更後に次を確認する。

1. Markdown の見出し階層が自然である
2. `ONBOARDING.md` から任意設定ページへの相対リンクが正しい
3. 記載したスクリプトと設定ファイルがリポジトリ内に存在する
4. 必須手順と任意手順が明確に区別されている
5. 各インストール手順に確認方法がある
6. Volta が Node.js の推奨バージョン管理ツールとして説明されている
7. `volta install node` により最新 LTS を導入し、`volta`、`node`、`npm`、`npx` を確認できる
8. Node.js がプラグインスクリプト、テスト、LSP、Context7 に必要な理由が説明されている
9. `uv` と `uvx` の公式インストール・確認手順が記載されている
10. `uvx` が Serena MCP の起動に必要であることと、`claude mcp list` による確認方法が記載されている
11. Context7 が LSP ではなく Claude Code の共通ツールとして説明されている
12. `npx ctx7 setup --claude --mcp --yes` の前提、オプション、確認方法が記載されている
13. WSL2/Linux 中心の前提と、`install-mdbase.sh` の実装が矛盾しない
14. `cliproxyapi.config.yaml` が Git の追跡対象外である
15. `cliproxyapi.config.example.yaml` が追跡対象で、実際のキーを含まない
16. サンプルに現在の `oauth-excluded-models` の値が保持されている
17. サンプルから未使用機能のコメントとコメントアウト例が除かれている
18. `scripts/start-proxy.sh` が参照するローカル設定ファイル名と文書が一致する
19. 削除承認されていない macOS と認証関連の手順が保持されている
20. 承認された2項目以外を意図せず削除していない
21. 実際の秘密情報が新しい文書やサンプルへ転記されていない

## 対象外

- 開発コマンドやテストコマンドの詳細追加
- ブランチ、コミット、プルリクエストの運用説明
- プラグインのバージョン更新手順
- `scripts/install-mdbase.sh` や `scripts/start-proxy.sh` の実装修正
- Context7 のプロジェクト単位設定への変更
- CLIProxyAPI の除外モデル一覧そのものの見直し
