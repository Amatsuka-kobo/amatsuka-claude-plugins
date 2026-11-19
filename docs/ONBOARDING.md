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

### Mise と Node.js

このプロジェクトでは、Node.js のバージョン管理に Mise を推奨しています。Node.js は、各プラグインの `.mjs` スクリプト、テストの実行(vitest)に必要です。

WSL2/Linux では、Mise の公式インストーラーを実行します。

```bash
curl https://mise.run | sh
```

インストーラーは Volta の保存先を `PATH` へ追加します。完了後は新しいターミナルを開き、次のコマンドで Mise が利用できることを確認してください。

```bash
mise --version
```

Mise で Node.js をインストールします。

```bash
mise install node
```

Node.js と、同時に利用可能になる npm、npx を確認します。

```bash
node --version
npm --version
npx --version
```

### pnpm と依存関係

このリポジトリは pnpm workspace として構成されており、パッケージマネージャーには pnpm のみを使用します。pnpm も Mise で導入します。

```bash
mise install pnpm
```

インストールできたことを確認します。

```bash
pnpm --version
```

ルート `mise.toml`の `tools` フィールドには node 26.10.0 / pnpm 12.9.1 がピン留めされており、このリポジトリ内で作業するときは Mise が自動でそのバージョンに切り替えます。

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

### Docker Engine と Docker Sandboxes

一部のプラグインは改修時に前後比較の計測をします。その際 Docker Sandboxes による隔離環境で行うことになります。

### WSL を使っている場合

1. (Windows 側のユーザーフォルダ内) .wslconfig
```
[wsl2]
nestedVirtualization=true
```

2. (WSL 内で) /etc/wsl.conf
```
[boot]
systemd=true
```

3. (PowerShell で) WSL 再起動
```bash
wsl --shutdown
wsl ~
```

4. (WSL 内で) KVM の設定
```bash
# KVMが見えているか確認: 正常なら「crw-rw---- 1 root kvm 10, 232 ... /dev/kvm」のように表示される
ls -l /dev/kvm

# KVMモジュールを確認: Intel CPUなら「kvm_intel」「kvm」が表示されれば問題ない
lsmod | grep kvm

# 診断ツールで確認: 正常なら「INFO: /dev/kvm exists」「KVM acceleration can be used」のように表示される
sudo apt update && sudo apt install -y cpu-checker
kvm-ok

# ユーザーを kvm グループに追加
sudo usermod -aG kvm $USER
newgrp kvm
```

5. (PowerShell で) WSL 再起動
```bash
wsl --shutdown
wsl ~
```

6. (WSL 内で) ユーザーが kvm グループに追加されていることを確認
```bash
# groupsコマンドの実行結果に「kvm」とが含まれていれば、問題ない
groups
```

### Docker のインストール

```bash
# Docker Engine
sudo apt update && sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Docker Sandboxes
curl -fsSL https://get.docker.com | sudo REPO_ONLY=1 sh
sudo apt update && sudo apt install docker-sbx
sbx login # Docker アカウントにログイン
sbx policy ls # Balanced を選択
```

WSL の場合は以下の設定も必要です。

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### VSCode での Biome 拡張機能

VSCode を使用する場合、コード保守の観点から Biome 拡張機能をインストールしてください。

## Claude Code の共通ツール

### .claude/settings.local.json

Claude Code のローカル設定ファイルです。agent-policy プラグインの環境変数と jevriel プラグインの環境変数を用意しています。

```
cp .claude/settings.local.example.json .claude/settings.local.json
```

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
```

## 任意設定

Claude Code を CLIProxyAPI 経由で利用する場合は、[CLIProxyAPI のセットアップ](development/cliproxyapi-setup.md)を参照してください。Codex や Grok のアカウントを持っていない場合は、この設定は不要です。

## トラブル時の確認

1. コマンドを実行したディレクトリが手順と一致しているか確認する
2. `volta --version`、`node --version`、`npm --version`、`npx --version`、`pnpm --version` が成功するか確認する
3. `uv --version` と `uvx --version` が成功するか確認する
4. `claude mcp list` で `plugin:serena:serena` と `context7` の接続状態を確認する
5. グローバルにインストールしたコマンドの保存先が `PATH` に含まれているか確認する
6. Context7 は `claude mcp logs context7` でログを確認する

