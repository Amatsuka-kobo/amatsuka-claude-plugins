# CLIProxyAPI のセットアップ

CLIProxyAPI は任意の開発ツールです。Codex または Claude Code を、ローカルで起動したプロキシ経由で使うメンバーだけが設定してください。

**Codex のアカウント(ChatGPT/OpenAI の Codex 契約)を持っていないメンバーは、この設定を行う必要はありません。** `oauth-model-alias` で公開される GPT-5.6 系モデルは Codex の OAuth ログイン(`--codex-login`)が前提のため、Codex を使えない場合はこの設定をしても利用できるモデルは増えません。CLAUDE.md のエージェント運用方針にある「GPT系モデルが使用できないときのフォールバック」に従って、Opus／Sonnet／Haiku で運用してください。

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

リポジトリのルートで実行します。

```bash
cli-proxy-api --config ./cliproxyapi.config.yaml --codex-login
```

ブラウザーを自動で開けない場合は `--no-browser` を追加します。

```bash
cli-proxy-api --config ./cliproxyapi.config.yaml --no-browser --codex-login
```

ログインが完了すると、CLIProxyAPI が Codex の認証情報を保存したことを示すメッセージが表示されます。

## 4. CLIProxyAPI を起動する

リポジトリのルートで起動スクリプトを実行します。このターミナルは、CLIProxyAPI を使っている間は開いたままにしてください。

```bash
scripts/start-proxy.sh
```

起動すると、`127.0.0.1:8317` で待ち受けを開始したことを示すログが表示されます。

## 5. Codex CLI を接続する

`~/.codex/config.toml` に次の設定を追加または更新します。`experimental_bearer_token` には、`cliproxyapi.config.yaml` の `api-keys` と同じ値を設定してください。

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

CLIProxyAPI を起動した状態で、別のターミナルから `codex` を実行し、応答できることを確認します。

## 6. Claude Code を接続する

Claude Code では、OAuth または接続用トークンのどちらか一方を設定します。

### OAuth を使う場合

リポジトリのルートで実行します。

```bash
cli-proxy-api --config ./cliproxyapi.config.yaml --claude-login
```

ブラウザーを自動で開けない場合は `--no-browser` を追加します。OAuth のコールバックにはローカルのポート `54545` が使われるため、そのポートを受信できる環境で実行してください。

```bash
cli-proxy-api --config ./cliproxyapi.config.yaml --claude-login --no-browser
```

ログイン後、`scripts/start-proxy.sh` を起動したターミナルとは別のターミナルで `claude` を実行します。

### 接続用トークンを使う場合

CLIProxyAPI を起動したターミナルとは別のターミナルで、次の環境変数を設定します。

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8317"
export ANTHROPIC_AUTH_TOKEN="cliproxyapi.config.yaml と同じ接続用キー"
claude
```

キーをシェル履歴やシェル設定へ不用意に保存しないでください。

## 通常の接続へ戻す

Codex CLI は `~/.codex/config.toml` の `model_provider` と `model_providers.cliproxyapi` の設定を、CLIProxyAPI を使う前の状態へ戻します。

Claude Code は、CLIProxyAPI 用に設定した環境変数を解除します。

```bash
unset ANTHROPIC_BASE_URL
unset ANTHROPIC_AUTH_TOKEN
```

いずれの場合も、CLIProxyAPI を起動したターミナルで `Ctrl+C` を押して停止して構いません。

## トラブル時の確認

1. `scripts/start-proxy.sh` を実行したターミナルで CLIProxyAPI が起動したままになっているか確認する
2. `cliproxyapi.config.yaml` がリポジトリのルートに存在し、`api-keys` を設定済みか確認する
3. Codex／Claude Code どちらを使う場合も、該当する OAuth ログイン（`--codex-login` または `--claude-login`）が完了しているか確認する
4. 接続用トークンを使う場合は、`ANTHROPIC_AUTH_TOKEN` と `cliproxyapi.config.yaml` の `api-keys` が一致しているか確認する
