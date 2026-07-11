# ONBOARDING.md 再構成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工房メンバー、とくにジュニアエンジニアが WSL2/Linux の開発環境を構築できるように `ONBOARDING.md` を再構成し、Context7 の導入手順と、安全に共有できる CLIProxyAPI のサンプル設定を追加する。

**Architecture:** `ONBOARDING.md` は必須環境構築の一本道に限定し、Context7 を Claude Code の共通ツール、LSP を編集支援として別セクションで説明する。任意の CLIProxyAPI 詳細は `docs/development/cliproxyapi-setup.md` へ分離し、秘密情報を含み得る実設定 `cliproxyapi.config.yaml` と、Git 管理する最小サンプル `cliproxyapi.config.example.yaml` を分ける。

**Tech Stack:** Markdown、YAML、Bash、Claude Code MCP、Context7 CLI、CLIProxyAPI

## Global Constraints

- 対象読者は、あまつか工房の開発メンバー、とくに初めて環境を構築するジュニアエンジニアとする。
- 正式な案内対象は WSL2/Linux とし、macOS は CLIProxyAPI の Homebrew 手順のみ補足として残す。
- `ONBOARDING.md` の対象は環境構築までとし、開発フローやテスト方法は追加しない。
- Node.js のバージョン管理には、このプロジェクトの推奨ツールである Volta を使用する。
- Volta では `volta install node` により最新の LTS 版 Node.js を導入する。
- Node.js、npm、npx は、プラグインスクリプト、`node --test`、LSP、Context7 のための必須ツールとする。
- `uv` と `uvx` は、Serena MCP サーバーを起動するための必須ツールとする。
- Serena の手動起動は案内せず、`claude mcp list` で `plugin:serena:serena` の接続状態を確認する。
- Context7 は LSP に含めず、「Claude Code の共通ツール」として LSP より前に説明する。
- Context7 はグローバル設定を標準とし、`--project` は標準コマンドへ追加しない。
- Context7 の確認省略オプションは、公式資料に明記されている `--yes` を使用する。
- Codex／CLIProxyAPI は任意設定として別ページへ分離する。
- Claude Code 1.x／2.x 別の固定モデル ID と環境変数例は削除する。
- CLIProxyAPI の実行ファイル名を状況に応じて読み替えるという説明は削除する。
- macOS、OAuth、Codex CLI、Claude Code 接続用トークンの各手順は保持する。
- `cliproxyapi.config.yaml` はローカル専用として `.gitignore` へ追加し、ファイルを削除せず Git の追跡対象から外す。
- `cliproxyapi.config.example.yaml` の `api-keys` にはプレースホルダーだけを置き、実際のキーやトークンを記載しない。
- `cliproxyapi.config.example.yaml` には現在の `oauth-excluded-models.claude` と `oauth-excluded-models.codex` の値を保持する。
- サンプル設定から、現在使用していない設定項目とコメントアウト例を削除する。
- `scripts/install-mdbase.sh` と `scripts/start-proxy.sh` の実装は変更しない。
- 既存の未コミット変更を保持し、コミットや push は行わない。

---

## File Structure

- Modify: `.gitignore` — ローカル専用 CLIProxyAPI 設定を Git 管理から除外する。
- Untrack but keep locally: `cliproxyapi.config.yaml` — 現在のローカル設定と秘密情報を保持したまま、Git インデックスから外す。
- Create: `cliproxyapi.config.example.yaml` — 工房で共有する最小の CLIProxyAPI 設定例。
- Create: `docs/development/cliproxyapi-setup.md` — Codex／Claude Code から CLIProxyAPI を使う任意設定の詳細。
- Modify: `ONBOARDING.md` — 必須環境構築、Context7、LSP、確認方法、任意設定への導線。
- Reference only: `scripts/install-mdbase.sh` — `mdbase-lsp` 導入時の副作用と OS 前提を文書化する根拠。
- Reference only: `scripts/start-proxy.sh` — CLIProxyAPI のローカル設定ファイル名を確認する根拠。

---

### Task 1: CLIProxyAPI の実設定とサンプル設定を分離する

**Files:**
- Modify: `.gitignore`
- Untrack but keep locally: `cliproxyapi.config.yaml`
- Create: `cliproxyapi.config.example.yaml`

**Interfaces:**
- Consumes: `scripts/start-proxy.sh` が `./cliproxyapi.config.yaml` を参照する現行仕様。
- Produces: ローカル実設定 `cliproxyapi.config.yaml` と、共有可能な `cliproxyapi.config.example.yaml`。

- [ ] **Step 1: 現在の設定ファイルとインデックス状態を確認する**

Run:

```bash
git status --short -- .gitignore cliproxyapi.config.yaml
git ls-files --stage -- cliproxyapi.config.yaml
```

Expected:

```text
M  .gitignore
A  cliproxyapi.config.yaml
```

`git ls-files` に `cliproxyapi.config.yaml` が表示され、すでにインデックスへ追加されていることを確認する。実際のキー値は出力・記録しない。

- [ ] **Step 2: `.gitignore` にローカル設定を追加する**

`.gitignore` の末尾に次の1行を追加する。既存行の順序や内容は変えない。

```gitignore
cliproxyapi.config.yaml
```

- [ ] **Step 3: 実設定をローカルに残したままインデックスから外す**

Run:

```bash
git rm --cached -- cliproxyapi.config.yaml
```

Expected: `rm 'cliproxyapi.config.yaml'` と表示されるが、作業ツリー上のファイルは残る。

Verify:

```bash
test -f cliproxyapi.config.yaml
git check-ignore -v cliproxyapi.config.yaml
```

Expected: `test` は終了コード 0、`git check-ignore` は `.gitignore` の追加行を表示する。

- [ ] **Step 4: 最小のサンプル設定を作成する**

`cliproxyapi.config.example.yaml` を次の内容で作成する。

```yaml
host: "127.0.0.1"
port: 8317

auth-dir: "~/.cli-proxy-api"

api-keys:
  - "replace-with-a-random-local-key"

oauth-excluded-models:
  claude:
    - "claude-3-7-sonnet-20250219"
    - "claude-3-5-haiku-20241022"
    - "claude-sonnet-4-6"
    - "claude-opus-4-20250514"
    - "claude-opus-4-6"
    - "claude-opus-4-7"
    - "claude-opus-4-5-20251101"
    - "claude-sonnet-4-5-20250929"
    - "claude-opus-4-1-20250805"
    - "claude-sonnet-4-20250514"
  codex:
    - "gpt-5.5"
    - "gpt-5.4"
    - "gpt-5.4-mini"
    - "gpt-image-1.5"
    - "gpt-image-2"
    - "gpt-5.3-codex-spark"
```

- [ ] **Step 5: サンプルに秘密情報と不要項目がないことを検証する**

Run:

```bash
node - <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync('cliproxyapi.config.example.yaml', 'utf8');
const required = [
  'host: "127.0.0.1"',
  'port: 8317',
  'auth-dir: "~/.cli-proxy-api"',
  'oauth-excluded-models:',
  '  claude:',
  '  codex:',
];
for (const value of required) {
  if (!text.includes(value)) throw new Error(`missing: ${value}`);
}
for (const forbidden of ['sk-F2', 'sk-I8', 'cpa-71', 'remote-management:', 'plugins:', 'payload:', 'tls:']) {
  if (text.includes(forbidden)) throw new Error(`forbidden: ${forbidden}`);
}
console.log('CLIProxyAPI sample is minimal and sanitized');
NODE
```

Expected:

```text
CLIProxyAPI sample is minimal and sanitized
```

- [ ] **Step 6: Git の状態が意図どおりか確認する**

Run:

```bash
git status --short -- .gitignore cliproxyapi.config.yaml cliproxyapi.config.example.yaml
```

Expected:

- `.gitignore` は変更として表示される。
- `cliproxyapi.config.yaml` は新規追加として表示されず、ローカルには残っている。
- `cliproxyapi.config.example.yaml` は未追跡または追加対象として表示される。

---

### Task 2: CLIProxyAPI の任意設定ページを作成する

**Files:**
- Create: `docs/development/cliproxyapi-setup.md`
- Reference: `cliproxyapi.config.example.yaml`
- Reference: `scripts/start-proxy.sh`

**Interfaces:**
- Consumes: Task 1 の `cliproxyapi.config.example.yaml`。
- Produces: `ONBOARDING.md` からリンクする CLIProxyAPI 詳細ページ。

- [ ] **Step 1: 詳細ページを作成する**

`docs/development/cliproxyapi-setup.md` を次の構成と内容で作成する。

```markdown
# CLIProxyAPI のセットアップ

CLIProxyAPI は任意の開発ツールです。Codex または Claude Code を、ローカルで起動したプロキシ経由で使うメンバーだけが設定してください。

## 注意事項

- `cliproxyapi.config.yaml` には接続用キーを保存するため、Git にコミットしないでください。
- サンプルのキーはそのまま使わず、自分の環境専用のランダムな値へ置き換えてください。
- CLIProxyAPI は `127.0.0.1` だけで待ち受け、外部ネットワークへ公開しないでください。

## 1. CLIProxyAPI をインストールする

### WSL2/Linux

公式インストーラーを実行します。

```bash
curl -fsSL https://raw.githubusercontent.com/router-for-me/cliproxyapi-installer/refs/heads/master/cliproxyapi-installer | bash
```

### macOS

Homebrew でインストールします。

```bash
brew install cliproxyapi
```

インストール後、コマンドが利用できることを確認します。

```bash
cli-proxy-api --help
```

## 2. ローカル設定を作成する

リポジトリのルートで、サンプルをローカル設定へコピーします。

```bash
cp cliproxyapi.config.example.yaml cliproxyapi.config.yaml
```

`cliproxyapi.config.yaml` の `api-keys` を、自分の環境専用のランダムな値へ置き換えてください。このキーは Codex CLI や Claude Code から CLIProxyAPI へ接続するときに使います。

## 3. Codex の OAuth 認証を設定する

```bash
cli-proxy-api --config ./cliproxyapi.config.yaml --codex-login
```

ブラウザーを自動で開けない場合は `--no-browser` を追加します。

```bash
cli-proxy-api --config ./cliproxyapi.config.yaml --no-browser --codex-login
```

## 4. CLIProxyAPI を起動する

リポジトリのルートで起動スクリプトを実行します。このターミナルは、CLIProxyAPI を使っている間は開いたままにしてください。

```bash
scripts/start-proxy.sh
```

## 5. Codex CLI を接続する

`~/.codex/config.toml` に次の設定を追加します。`experimental_bearer_token` には、`cliproxyapi.config.yaml` の `api-keys` と同じ値を設定してください。

```toml
model = "gpt-5.5"
model_provider = "cliproxyapi"
model_reasoning_effort = "xhigh"
plan_mode_reasoning_effort = "xhigh"
supports_websockets = true

[model_providers.cliproxyapi]
name = "cliproxyapi"
base_url = "http://127.0.0.1:8317/v1"
experimental_bearer_token = "cliproxyapi.config.yaml と同じ接続用キー"
wire_api = "responses"
requires_openai_auth = true
```

CLIProxyAPI を起動した状態で `codex` を実行し、応答できることを確認します。

## 6. Claude Code を接続する

Claude Code では、OAuth または接続用トークンのどちらか一方を設定します。

### OAuth を使う場合

```bash
cli-proxy-api --config ./cliproxyapi.config.yaml --claude-login
```

ブラウザーを自動で開けない場合は `--no-browser` を追加します。OAuth のコールバックにはローカルのポート `54545` が使われます。

```bash
cli-proxy-api --config ./cliproxyapi.config.yaml --claude-login --no-browser
```

ログイン後、別のターミナルで `scripts/start-proxy.sh` を起動したまま `claude` を実行します。

### 接続用トークンを使う場合

CLIProxyAPI を起動したターミナルとは別のターミナルで、次の環境変数を設定します。

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8317"
export ANTHROPIC_AUTH_TOKEN="cliproxyapi.config.yaml と同じ接続用キー"
claude
```

キーをシェル履歴やシェル設定へ不用意に保存しないでください。

## 通常の接続へ戻す

Codex CLI は `~/.codex/config.toml` の `model_provider` と `model_providers.cliproxyapi` を元に戻します。

Claude Code は、CLIProxyAPI 用に設定した環境変数を解除します。

```bash
unset ANTHROPIC_BASE_URL
unset ANTHROPIC_AUTH_TOKEN
```

## トラブル時の確認

CLIProxyAPI が起動しているか、設定ファイルのパスが正しいか、Codex／Claude の OAuth ログインが完了しているかを順番に確認してください。
```

- [ ] **Step 2: 承認済みの削除内容が復活していないことを確認する**

Run:

```bash
node - <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync('docs/development/cliproxyapi-setup.md', 'utf8');
for (const forbidden of [
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  '配布形態によって実行ファイル名',
]) {
  if (text.includes(forbidden)) throw new Error(`forbidden: ${forbidden}`);
}
console.log('Deprecated model examples and ambiguous aliases are absent');
NODE
```

Expected:

```text
Deprecated model examples and ambiguous aliases are absent
```

- [ ] **Step 3: 保持対象の手順が揃っていることを確認する**

Run:

```bash
node - <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync('docs/development/cliproxyapi-setup.md', 'utf8');
for (const required of [
  'brew install cliproxyapi',
  '--codex-login',
  '--claude-login',
  'ANTHROPIC_AUTH_TOKEN',
  '[model_providers.cliproxyapi]',
  'scripts/start-proxy.sh',
  'cp cliproxyapi.config.example.yaml cliproxyapi.config.yaml',
]) {
  if (!text.includes(required)) throw new Error(`missing: ${required}`);
}
console.log('Required CLIProxyAPI procedures are present');
NODE
```

Expected:

```text
Required CLIProxyAPI procedures are present
```

---

### Task 3: `ONBOARDING.md` を必須環境構築の一本道へ書き換える

**Files:**
- Modify: `ONBOARDING.md`
- Reference: `docs/development/cliproxyapi-setup.md`
- Reference: `scripts/install-mdbase.sh`

**Interfaces:**
- Consumes: Task 2 の CLIProxyAPI 詳細ページ。
- Produces: 工房メンバー向けの環境構築入口。

- [ ] **Step 1: 冒頭で対象、ゴール、必須・任意の区別を示す**

`ONBOARDING.md` の先頭を次の構造にする。

```markdown
# 開発環境のセットアップ

この文書は、あまつか工房のメンバーが、このリポジトリで開発するための環境を準備する手順です。初めて環境を構築する人でも進められるよう、必須の作業を順番に説明します。

主な対象環境は WSL2/Linux です。すべてのコマンドは、特に説明がない限りターミナルで実行してください。

## この文書のゴール

次の状態になればセットアップ完了です。

- Volta で管理された Node.js LTS、npm、npx が利用できる
- `uv` と `uvx` が利用でき、Claude Code から Serena MCP に接続できる
- Claude Code から Context7 MCP を利用できる
- 担当するファイルに必要な LSP が利用できる

Codex／CLIProxyAPI は任意設定です。必要なメンバーだけ、最後の案内から詳細ページへ進んでください。
```

- [ ] **Step 2: Volta、Node.js、uv を必須ツールとして追加する**

ゴールの後、Context7 より前に次のセクションを追加する。

```markdown
## 必須ツール

### Volta と Node.js

このプロジェクトでは、Node.js のバージョン管理に Volta を推奨しています。Node.js は、各プラグインの `.mjs` スクリプト、`node --test`、LSP のインストール、Context7 のセットアップに必要です。

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

### uv

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
```

- [ ] **Step 3: Context7 を「Claude Code の共通ツール」として追加する**

LSP より前に、次のセクションを追加する。

```markdown
## Claude Code の共通ツール

### Context7

Context7 は、Claude Code がライブラリやフレームワークの最新ドキュメントを取得するための MCP サーバーです。LSP のような補完ツールではなく、技術調査で古い情報を使わないために利用します。

次のコマンドは、Context7 を Claude Code のグローバル設定へ登録します。リポジトリの外で作業するときも同じ設定を利用できます。

```bash
npx ctx7 setup --claude --mcp --yes
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
```

- [ ] **Step 4: LSP の概要を一覧表へ統合する**

Context7 の後に次のセクションを置く。

```markdown
## LSP

LSP（Language Server Protocol）は、コードや文書の補完、エラー表示、定義への移動などを提供する仕組みです。担当するファイルに応じて必要な言語サーバーをインストールしてください。

| 言語サーバー | 対象 | 主な用途 |
| --- | --- | --- |
| `pyright` | Python | 補完と静的診断 |
| `vtsls` | TypeScript／JavaScript | 補完と静的診断 |
| `bash-language-server` | Shell Script | 補完と静的診断 |
| `mdbase-lsp` | Markdown | Markdown の編集支援 |
```

- [ ] **Step 5: npm で導入する3種類の LSP を段階的に説明する**

次の内容を LSP 一覧の後へ追加する。

```markdown
### npm でインストールする言語サーバー

次の3つは、どのディレクトリから実行しても構いません。`npm install -g` は現在のユーザー環境へコマンドを追加します。

#### Python: pyright

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
```

- [ ] **Step 6: `mdbase-lsp` の前提と副作用を説明する**

次の内容を追加する。

```markdown
### Markdown: mdbase-lsp

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
```

- [ ] **Step 7: 完了確認と任意設定への導線を追加する**

末尾を次の内容にする。

```markdown
## セットアップ確認

最後に、必要なコマンドをまとめて確認します。

```bash
volta --version
node --version
npm --version
npx --version
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

Codex または Claude Code を CLIProxyAPI 経由で利用する場合は、[CLIProxyAPI のセットアップ](docs/development/cliproxyapi-setup.md)を参照してください。

## トラブル時の確認

1. コマンドを実行したディレクトリが手順と一致しているか確認する
2. `volta --version`、`node --version`、`npm --version`、`npx --version` が成功するか確認する
3. `uv --version` と `uvx --version` が成功するか確認する
4. `claude mcp list` で `plugin:serena:serena` と `context7` の接続状態を確認する
5. グローバルにインストールしたコマンドの保存先が `PATH` に含まれているか確認する
6. Context7 は `claude mcp logs context7` でログを確認する
7. `mdbase-lsp` は `$HOME/.local/bin/mdbase-lsp` が存在するか確認する
```

- [ ] **Step 8: 必須と任意が混在していないことを検証する**

Run:

```bash
node - <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync('ONBOARDING.md', 'utf8');
const required = [
  '## 必須ツール',
  'curl https://get.volta.sh | bash',
  'volta install node',
  'uv --version',
  'uvx --version',
  'plugin:serena:serena',
  '## Claude Code の共通ツール',
  'npx ctx7 setup --claude --mcp --yes',
  'claude mcp list',
  'claude mcp logs context7',
  '## LSP',
  'scripts/install-mdbase.sh',
  'docs/development/cliproxyapi-setup.md',
];
for (const value of required) {
  if (!text.includes(value)) throw new Error(`missing: ${value}`);
}
for (const forbidden of [
  '## Codex と CLIProxyAPI',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
]) {
  if (text.includes(forbidden)) throw new Error(`forbidden: ${forbidden}`);
}
console.log('ONBOARDING structure is correct');
NODE
```

Expected:

```text
ONBOARDING structure is correct
```

---

### Task 4: 文書・設定・Git 状態を最終検証する

**Files:**
- Verify: `.gitignore`
- Verify: `cliproxyapi.config.yaml`
- Verify: `cliproxyapi.config.example.yaml`
- Verify: `docs/development/cliproxyapi-setup.md`
- Verify: `ONBOARDING.md`

**Interfaces:**
- Consumes: Tasks 1–3 の全成果物。
- Produces: レビュー可能で秘密情報を含まない最終差分。

- [ ] **Step 1: Markdown と空白エラーを確認する**

Run:

```bash
git diff --check -- .gitignore ONBOARDING.md docs/development/cliproxyapi-setup.md cliproxyapi.config.example.yaml
```

Expected: 出力なし、終了コード 0。

- [ ] **Step 2: 参照先の存在とリンクを確認する**

Run:

```bash
node - <<'NODE'
const fs = require('node:fs');
for (const path of [
  'scripts/install-mdbase.sh',
  'scripts/start-proxy.sh',
  'docs/development/cliproxyapi-setup.md',
  'cliproxyapi.config.example.yaml',
]) {
  if (!fs.existsSync(path)) throw new Error(`missing file: ${path}`);
}
const onboarding = fs.readFileSync('ONBOARDING.md', 'utf8');
if (!onboarding.includes('(docs/development/cliproxyapi-setup.md)')) {
  throw new Error('missing CLIProxyAPI link');
}
console.log('Referenced files and links exist');
NODE
```

Expected:

```text
Referenced files and links exist
```

- [ ] **Step 3: 実設定が無視され、サンプルが無視されていないことを確認する**

Run:

```bash
git check-ignore cliproxyapi.config.yaml
test -f cliproxyapi.config.yaml
if git check-ignore -q cliproxyapi.config.example.yaml; then
  echo 'sample file must not be ignored' >&2
  exit 1
fi
```

Expected: 終了コード 0。実設定はローカルに残り、サンプルは Git 管理可能である。

- [ ] **Step 4: 追跡対象ファイルに既知の実キーが残っていないことを確認する**

Run:

```bash
if git grep -n -E 'sk-F2LGAPed|sk-I8L8RSP|cpa-71eb78' -- ':!docs/chat/**'; then
  echo 'tracked files still contain local CLIProxyAPI keys' >&2
  exit 1
fi
```

Expected: 一致なし、終了コード 0。

注意: `git grep` は追跡対象だけを検索するため、`.gitignore` 済みのローカル `cliproxyapi.config.yaml` は検査対象に含まれない。

- [ ] **Step 5: 変更一覧を確認する**

Run:

```bash
git status --short -- .gitignore ONBOARDING.md cliproxyapi.config.yaml cliproxyapi.config.example.yaml docs/development/cliproxyapi-setup.md
git diff --stat -- .gitignore ONBOARDING.md cliproxyapi.config.example.yaml docs/development/cliproxyapi-setup.md
git diff --cached --stat -- cliproxyapi.config.yaml
```

Expected:

- `.gitignore` と `ONBOARDING.md` が変更として表示される。
- `cliproxyapi.config.example.yaml` と `docs/development/cliproxyapi-setup.md` が新規ファイルとして表示される。
- `cliproxyapi.config.yaml` はローカルに存在するが、新規追加として残っていない。
- ユーザーが元から持っていた他の未コミット変更は変更されていない。

- [ ] **Step 6: コミットせずに完了報告を作る**

報告には次を含める。

1. Context7 を LSP ではなく Claude Code 共通ツールとして追加したこと
2. 公式に確認できた `--yes` を採用したこと
3. CLIProxyAPI 詳細を任意設定ページへ分離したこと
4. 実設定をローカルに保持し、サンプル設定だけを共有対象にしたこと
5. `oauth-excluded-models` の現在値をサンプルへ保持したこと
6. 実行した検証コマンドと結果
7. コミットしていないこと
