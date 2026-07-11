# CLIProxyAPI のセットアップ

この手順は、CLIProxyAPI をローカルで起動し、必要に応じて Codex または Claude の OAuth を使うための**任意設定**です。通常の Claude Code 利用には必要ありません。

対象環境は WSL2/Linux です。`ONBOARDING.md` の必須セットアップを完了してから進めてください。

## この手順でできること

- CLIProxyAPI をローカルに導入する
- Codex OAuth または Claude OAuth を必要なものだけ認証する
- `127.0.0.1:8317` のローカル API を確認する
- Claude Code を CLIProxyAPI 経由で一時的に起動する

## 先に確認すること

- Codex OAuth を使う場合は、Codex を利用できる OpenAI アカウントが必要です。
- Claude OAuth を使う場合は、Claude を利用できるアカウントが必要です。
- OAuth の認証情報とローカル API キーは個人の認証情報です。チャット、Issue、コミット、Pull Request に貼り付けないでください。
- この手順ではプロキシを `127.0.0.1` だけで待ち受けます。`0.0.0.0` などへ変更してネットワークに公開しないでください。

> [!IMPORTANT]
> `cliproxyapi.config.yaml` は実キーを含むローカル設定です。`.gitignore` に登録済みですが、`git add -f` などで強制追加しないでください。

## 1. CLIProxyAPI を導入する

CLIProxyAPI は公式の GitHub Releases から取得します。Releases ページで、WSL2/Linux と自分の CPU アーキテクチャに対応するファイルを選んでください。

1. [CLIProxyAPI の公式 Releases](https://github.com/router-for-me/CLIProxyAPI/releases) を開く
2. Linux 用の配布ファイルをダウンロードして展開する
3. 展開した実行ファイルを、自分の `PATH` に含まれるディレクトリへ `cli-proxy-api` として配置する
4. 実行権限を設定する

導入後、次のコマンドで確認します。

```bash
cli-proxy-api --help
```

ヘルプが表示されれば導入は完了です。`command not found` と表示される場合は、実行ファイルの配置先と `PATH` を確認してください。

### Docker を使う場合

ローカルに実行ファイルを配置する代わりに、公式の Docker イメージと Compose 構成で CLIProxyAPI を動かすこともできます。構成の詳細は[公式リポジトリの Docker 関連ファイル](https://github.com/router-for-me/CLIProxyAPI)を参照してください。この手順書では独自の Compose ファイルは用意しません。

- ローカル実行ファイル方式と Docker 方式を同時に起動しないでください。どちらも `8317` を使うため競合します。
- 設定ファイル、OAuth 認証情報（`auth-dir`）、ログは、コンテナの外側のディレクトリへボリュームとして保存してください。コンテナを削除すると内容が消えるためです。
- 公開ポートは `127.0.0.1:8317:8317` のように、ホスト側もローカル限定でマッピングしてください。

## 2. プロジェクト用の設定を作成する

このリポジトリのルートで、設定例をローカル設定としてコピーします。

```bash
cp cliproxyapi.config.example.yaml cliproxyapi.config.yaml
```

次に、`cliproxyapi.config.yaml` をエディターで開き、`api-keys` の `replace-with-a-random-local-key` を自分だけが使う十分にランダムな文字列へ置き換えます。置き換えた値は、次の API 確認と Claude Code の起動で使います。

| 設定 | 役割 | 扱い |
| --- | --- | --- |
| `host: "127.0.0.1"` | このマシンからだけ接続を受け付ける | 変更しない |
| `port: 8317` | プロキシの待受ポート | 他のプロセスと競合するときだけ変更する |
| `auth-dir: "~/.cli-proxy-api"` | OAuth 認証情報の保存先 | 内容を共有・コミットしない |
| `api-keys` | ローカル API の認証キー | プレースホルダーを必ず置換し、共有しない |
| `oauth-model-alias` | Codex モデルをクライアント側の別名として公開する設定 | 既定値を保持する |
| `oauth-excluded-models` | この構成で公開しないモデルの設定 | 既定値を保持する |

`claude-gpt-5-6-sol`、`claude-gpt-5-6-terra`、`claude-gpt-5-6-luna` は、`oauth-model-alias` が Codex の上流モデル（`gpt-5.6-sol` など）に付けるクライアント側の別名です。上流モデル ID そのものではありません。

## 3. OAuth を認証する（必要なものだけ）

Codex と Claude の両方を認証する必要はありません。使いたいサービスだけ認証してください。

### Codex OAuth

Codex を使う場合は、リポジトリルートで次を実行します。

```bash
cli-proxy-api --config "cliproxyapi.config.yaml" --codex-login
```

### Claude OAuth

Claude を使う場合は、リポジトリルートで次を実行します。

```bash
cli-proxy-api --config "cliproxyapi.config.yaml" --claude-login
```

WSL などでブラウザが開かない場合は、コマンドに `--no-browser` を追加します。表示された URL を自分のブラウザで開いて認証を完了してください。認証が終わるまで、コマンドを実行したターミナルは閉じないでください。

OAuth のコールバック用ポートが他のアプリケーションと競合する場合だけ、`--oauth-callback-port` で別のポートを指定してください。

`auth-dir` に保存された認証情報は、他人と共有しないでください。OAuth が失敗した場合は、ブラウザでの認証完了・コマンドの出力・コールバックポートの競合を確認してから再試行してください。

## 4. CLIProxyAPI を起動する

**リポジトリルートで**次を実行します。

```bash
./scripts/start-proxy.sh
```

このターミナルは、プロキシを動かしている間は開いたままにします。

別のターミナルで、設定したローカル API キーを一時的なシェル変数に設定します。

```bash
read -rsp "CLIProxyAPI のローカル API キー: " CLI_PROXY_API_KEY
echo
```

次に、プロキシが応答することを確認します。

```bash
curl --fail-with-body \
  --header "Authorization: Bearer $CLI_PROXY_API_KEY" \
  http://127.0.0.1:8317/v1/models
```

JSON の応答が表示されれば、プロキシは起動しています。

- `401` / `403` が返る場合は、`cliproxyapi.config.yaml` の `api-keys` と、リクエストの `Authorization` ヘッダーに設定したキーが一致しているか確認してください。
- 接続が拒否される場合は、`./scripts/start-proxy.sh` を実行したターミナルでプロキシが起動しているか、設定の `host` と `port` が想定どおりか確認してください。
- 期待するモデルが応答に含まれない場合は、必要な OAuth（Codex/Claude）を実施したか、`oauth-model-alias` と `oauth-excluded-models` の設定を確認してください。

## 5. Claude Code からプロキシを使う（任意）

CLIProxyAPI が起動している別ターミナルを残したまま、このターミナルでローカル API キーを読み取ります。

```bash
read -rsp "CLIProxyAPI のローカル API キー: " CLI_PROXY_API_KEY
echo
```

次に、環境変数を付けて Claude Code を起動します。

```bash
ANTHROPIC_BASE_URL="http://127.0.0.1:8317" \
ANTHROPIC_AUTH_TOKEN="$CLI_PROXY_API_KEY" \
claude
```

この方法は、この 1 回の `claude` 起動だけを CLIProxyAPI 経由にします。通常の Claude Code に戻すには、環境変数を付けずに `claude` を起動してください。

> [!NOTE]
> `ANTHROPIC_BASE_URL` を設定すると、Claude Code の通信先は公式 API ではなく CLIProxyAPI になります。プロキシ運用者と接続先サービスの利用条件が適用されます。

> [!NOTE]
> `ANTHROPIC_API_KEY` または `ANTHROPIC_AUTH_TOKEN` を設定した Claude Code では、Remote Control、`/schedule`、claude.ai MCP コネクター、通知設定などの一部機能が無効になる場合があります。これらの機能を使う通常起動では、環境変数を付けないでください。

CLIProxyAPI が停止している状態でこの起動をすると、Claude Code は接続できません。利用できるモデルは、実施した OAuth の状態と、設定の `oauth-model-alias` / `oauth-excluded-models` に依存します。

## トラブルシューティング

| 症状 | 最初の確認 | 主な対応 |
| --- | --- | --- |
| `cli-proxy-api: command not found` | `command -v cli-proxy-api` | 実行ファイルの配置、実行権限、`PATH` を確認する |
| プロキシに接続できない | 起動ターミナルのログ、設定の `host` と `port` | プロキシを起動し、ポート競合を解消する |
| `401` / `403` | `api-keys` とリクエストの認証値 | ローカル API キーと `Authorization` ヘッダーを見直す |
| OAuth が完了しない | ブラウザ、`--no-browser`、コールバックポート | 対象アカウントで認証し直し、ポート競合を確認する |
| モデルが表示されない | OAuth 実施状況、別名・除外リスト | 必要なプロバイダーを認証し、設定を見直して再起動する |
| Claude Code が接続できない | `ANTHROPIC_BASE_URL`、プロキシ起動、認証変数 | URL、ポート、トークンを見直し、通常起動と比較する |
| 通常の Claude Code の機能が減った | Claude Code 起動時の認証環境変数 | プロキシを使わない起動では環境変数を付けない |

## 完了チェック

- [ ] `cli-proxy-api --help` が成功する
- [ ] `cliproxyapi.config.yaml` を作成し、ローカル API キーを置き換えた
- [ ] `./scripts/start-proxy.sh` をリポジトリルートで実行できる
- [ ] `curl` で `http://127.0.0.1:8317/v1/models` の応答を確認できる
- [ ] 必要な OAuth だけを認証した
- [ ] Claude Code を使う場合、環境変数付き起動でプロキシ経由にできる
