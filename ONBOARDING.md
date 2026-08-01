# 開発環境のセットアップ

この文書は、あまつか工房のメンバーが、このリポジトリで開発するための環境を準備する手順です。初めて環境を構築する人でも進められるよう、必須の作業を順番に説明します。

主な対象環境は WSL2/Linux です。すべてのコマンドは、特に説明がない限りターミナルで実行してください。

## この文書のゴール

次の状態になればセットアップ完了です。

- Volta で管理された Node.js LTS、npm、npx が利用できる
- pnpm が利用でき、リポジトリのルートで `pnpm install` が完了している
- `uv` と `uvx` が利用でき、Claude Code から Serena MCP に接続できる
- Claude Code から Context7 MCP を利用できる
- 担当するファイルに必要な LSP が利用できる

Codex／CLIProxyAPI は任意設定です。Codex のアカウント(ChatGPT/OpenAI の Codex 契約)を持っているメンバーだけ、最後の案内から詳細ページへ進んでください。

## 必須ツール

### Volta と Node.js

このプロジェクトでは、Node.js のバージョン管理に Volta を推奨しています。Node.js は、各プラグインの `.mjs` スクリプト、テストの実行(vitest)、LSP のインストール、Context7 のセットアップに必要です。

WSL2/Linux では、Volta の公式インストーラーを実行します。

```bash
curl https://get.volta.sh | bash
```

インストーラーは Volta の保存先を `PATH` へ追加します。完了後は新しいターミナルを開き、次のコマンドで Volta が利用できることを確認してください。

```bash
volta --version
```

Volta で最新の LTS 版 Node.js をインストールします。Volta では、バージョンを省略した `node` が最新の LTS を表します。

```bash
volta install node
```

Node.js と、同時に利用可能になる npm、npx を確認します。

```bash
node --version
npm --version
npx --version
```

### pnpm と依存関係

このリポジトリは pnpm workspace として構成されており、パッケージマネージャーには pnpm のみを使用します(npm/yarn は使いません)。pnpm も Volta で導入します。

```bash
volta install pnpm
```

インストールできたことを確認します。

```bash
pnpm --version
```

ルート `package.json` の `volta` フィールドには node 26.3.1 / pnpm 11.8.0 がピン留めされており、このリポジトリ内で作業するときは Volta が自動でそのバージョンに切り替えます。上で最新の LTS 版を導入していても問題ありません。

続けて、リポジトリのルートで依存関係をインストールします。

```bash
pnpm install
```

開発コマンドはすべてリポジトリのルートから実行します。

```bash
pnpm test        # vitest によるテスト実行
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome check .
pnpm build       # 各プラグインの src/ から scripts/*.mjs を再生成
```

`plugins/*/scripts/*.mjs` はビルド生成物ですが git 管理の対象です。`plugins/*/src/` を変更した場合は `pnpm build` を実行し、生成された差分もあわせてコミットしてください。

### VSCode での Biome 拡張機能

VSCode を使用する場合、コード保守の観点から Biome 拡張機能をインストールしてください。

## Claude Code の共通ツール

### CLAUDE.md

`CLAUDE.md` は、セッションを起動したときに毎回注入されるプロンプトです。
主にこのプロジェクト内の概要や、運用方針などを記載しています。

利用者それぞれに設定したい項目等があると仮定して、推奨される共通設定 `CLAUDE.example.md` をコピーする運用を採用しています。

```bash
cp CLAUDE.example.md CLAUDE.md
```

また、 Codex 利用者と Claude Code のみの利用者でエージェントの運用方針を変えるため、optimize-agents プラグインの Skills として分割しています。利用状況によって設定を変えてください。詳しい設定プロンプトは CLAUDE.example.md に記述してあります。

- Codex 併用 -> `optimize-agents:with-codex-policy`
- Claude Code のみ -> `optimize-agents:claude-model-policy`

### uv と Serena

`uv` は Python のパッケージ／ツールランナーです。この環境では、Serena MCP サーバーを `uvx` で起動するために必要です。

WSL2/Linux では、公式の standalone installer を実行します。

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

完了後は新しいターミナルを開き、`uv` と `uvx` を確認します。

```bash
uv --version
uvx --version
```

Claude Code に登録された Serena MCP の接続状態を確認します。

```bash
claude mcp list
```

一覧の `plugin:serena:serena` が `Connected` になっていれば完了です。Serena の起動コマンドを手動で実行する必要はありません。

### Context7

Context7 は、Claude Code がライブラリやフレームワークの最新ドキュメントを取得するための MCP サーバーです。LSP のような補完ツールではなく、技術調査で古い情報を使わないために利用します。

この手順には Node.js と `pnpm` が必要です。先に必須ツールのセットアップを完了してください。

次のコマンドは、Context7 を Claude Code のグローバル設定へ登録します。リポジトリの外で作業するときも同じ設定を利用できます。

```bash
pnpm dlx ctx7 setup --claude --mcp --yes
```

オプションの意味は次のとおりです。

- `--claude`: Claude Code 向けに設定する
- `--mcp`: Context7 を MCP サーバーとして登録する
- `--yes`: 確認プロンプトを省略する

登録されたことを確認します。

```bash
claude mcp list
```

一覧に `context7` が表示されれば完了です。問題がある場合はログを確認します。

```bash
claude mcp logs context7
```

プロジェクト単位で設定したい場合は `--project` を追加できますが、工房の標準環境ではグローバル設定を使用します。

### LSP

Claude Code で効率よく開発を行うため、以下の LSP プラグインを有効化しています。

- pyright (Python)
- vtsls (TypeScript/JavaScript)
- bash-language-server (ShellScript)
- mdbase-lsp (Markdown)

これらを使用するには、各言語を扱う言語サーバーをインストールする必要があります。

#### pyright (Python)

Python 用の言語サーバーインストール手順です。

```bash
npm install -g pyright
pyright --version
```

#### TypeScript／JavaScript: vtsls

```bash
npm install -g @vtsls/language-server
vtsls --version
```

#### Shell Script: bash-language-server

```bash
npm install -g bash-language-server
bash-language-server --version
```

各コマンドでバージョンが表示されれば完了です。

#### Markdown: mdbase-lsp

`mdbase-lsp` は、このリポジトリのインストールスクリプトを使って導入します。このスクリプトは Debian／Ubuntu 系の WSL2/Linux を前提とし、次の処理を行います。

- `apt` と `sudo` を使って不足パッケージをインストールする
- `git`、C言語のビルド環境、Rust を準備する
- 外部リポジトリを `$HOME/third-party` へ clone する
- Rust で `mdbase-lsp` をビルドする
- `$HOME/.local/bin/mdbase-lsp` にシンボリックリンクを作る

内容を確認したうえで、リポジトリのルートから実行してください。

```bash
scripts/install-mdbase.sh
```

導入後、次のコマンドで確認します。

```bash
mdbase-lsp --help
```

コマンドが見つからない場合は、`$HOME/.local/bin` が `PATH` に含まれているか確認してください。

## セットアップ確認

最後に、必要なコマンドをまとめて確認します。

```bash
volta --version
node --version
npm --version
npx --version
pnpm --version
uv --version
uvx --version
claude --version
claude mcp list
pyright --version
vtsls --version
bash-language-server --version
mdbase-lsp --help
```

担当しない言語の LSP は未導入でも構いません。Context7 と、担当するファイルに必要な LSP が確認できればセットアップ完了です。

## 任意設定

Codex または Claude Code を CLIProxyAPI 経由で利用する場合は、[CLIProxyAPI のセットアップ](docs/development/cliproxyapi-setup.md)を参照してください。Codex のアカウントを持っていない場合は、この設定は不要です。

## トラブル時の確認

1. コマンドを実行したディレクトリが手順と一致しているか確認する
2. `volta --version`、`node --version`、`npm --version`、`npx --version`、`pnpm --version` が成功するか確認する
3. `uv --version` と `uvx --version` が成功するか確認する
4. `claude mcp list` で `plugin:serena:serena` と `context7` の接続状態を確認する
5. グローバルにインストールしたコマンドの保存先が `PATH` に含まれているか確認する
6. Context7 は `claude mcp logs context7` でログを確認する
7. `mdbase-lsp` は `$HOME/.local/bin/mdbase-lsp` が存在するか確認する
