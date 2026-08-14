# CLIProxyAPI セットアップ手順書 設計書

日付: 2026-07-11  
対象: リポジトリルートの任意設定ドキュメント

## 目的

WSL2/Linux で開発するジュニアエンジニアが、CLIProxyAPI を導入し、必要に応じて Codex OAuth または Claude OAuth を認証し、Claude Code をローカルプロキシ経由で利用できるようにする。

この設定は必須ではない。Codex または Claude OAuth を CLIProxyAPI 経由で使いたいメンバーだけが実施する。OAuth を使わない通常の Claude Code 利用者は、この手順を実施しない。

## 完了条件

手順を完了した利用者は、次の状態を確認できる。

1. `cli-proxy-api` コマンドが利用できる。
2. リポジトリルートに、Git 管理されない `cliproxyapi.config.yaml` が存在する。
3. CLIProxyAPI が `127.0.0.1:8317` で起動している。
4. 設定したローカル API キーを使って、プロキシの API に認証できる。
5. OAuth を選択した場合は、Codex または Claude のアカウント認証が完了している。
6. Claude Code をプロキシ経由で起動する場合は、`ANTHROPIC_BASE_URL` とローカル API キーを設定した起動方法を使える。

## 読者と前提

- 主な対象は WSL2/Linux の初学者。
- `ONBOARDING.md` の必須セットアップ（Node.js、Claude Code など）が完了している。
- OAuth を使う場合、対象サービスを利用できるアカウントを持つ。
  - Codex OAuth: OpenAI/Codex を利用できるアカウント。
  - Claude OAuth: Claude を利用できるアカウント。
- Docker は必須にしない。Docker を使える利用者向けに補足する。

## 新規ドキュメント

### `docs/development/cliproxyapi-setup.md`

`ONBOARDING.md` が既に参照しているリンク先として新規作成する。本文は「初回セットアップを上から順に進める」一本道の構成にする。各節には、次の 3 要素を揃える。

1. 何をするステップか。
2. 実行するコマンド。
3. 成功時に何を確認できるか。

## 手順書の構成

### 1. はじめに: 任意設定と安全上の注意

手順書の先頭に、次を明記する。

- CLIProxyAPI は任意設定であり、通常の Claude Code 利用に必要ではない。
- ローカルプロキシは例示設定どおり `127.0.0.1` にだけ待ち受ける。`0.0.0.0` などへ変更して外部公開しない。
- OAuth 認証情報とローカル API キーは個人の認証情報である。チャット、Issue、コミット、Pull Request に貼り付けない。
- 実設定ファイル `cliproxyapi.config.yaml` は `.gitignore` に登録済みであり、Git に追加しない。
- `ANTHROPIC_BASE_URL` を設定した Claude Code は、公式エンドポイントではなく CLIProxyAPI に通信する。プロキシ運用者・接続先サービスの利用条件が適用される。

### 2. CLIProxyAPI を導入する

本文の標準経路は、公式 GitHub Releases から WSL2/Linux に対応する実行ファイルを取得し、利用者の `PATH` 上に `cli-proxy-api` として配置する方式にする。

手順書は、特定のバージョン番号や固定ダウンロード URL を埋め込まない。代わりに、次を説明する。

1. 公式リポジトリの Releases ページを開く。
2. 利用環境に合う Linux バイナリを選ぶ。
3. 展開後の実行ファイルを、利用者が管理する `PATH` 上のディレクトリへ配置する。
4. 実行権限を付与する。
5. `cli-proxy-api --help` または同等のヘルプ表示で導入を確認する。

この設計は、CLIProxyAPI の配布ファイル名・バージョンの変更により、コピー用コマンドが古くなることを避けるためである。

Docker を利用する場合は、公式イメージと `docker compose` による起動例を「Docker を使う場合」の補足に配置する。本文のローカル実行ファイル方式と Docker 方式の設定・認証保存先を混在させないようにする。

### 3. プロジェクト用設定ファイルを作成する

`cliproxyapi.config.example.yaml` をコピーして、リポジトリルートに `cliproxyapi.config.yaml` を作成する。

```bash
cp cliproxyapi.config.example.yaml cliproxyapi.config.yaml
```

続いて、`api-keys` の `replace-with-a-random-local-key` を十分にランダムなローカル専用文字列へ置換する。手順書は API キーをコマンド出力やシェル履歴に残さない編集方法を案内する。

設定説明は次に限定する。

| 設定 | 役割 | 扱い |
| --- | --- | --- |
| `host: "127.0.0.1"` | 自分のマシンからだけアクセス可能にする | 変更しない |
| `port: 8317` | プロキシの待受ポート | 他のプロセスと競合するときだけ変更する |
| `auth-dir` | OAuth 認証情報の保存先 | 内容を共有・コミットしない |
| `api-keys` | ローカル API 呼び出しの認証キー | プレースホルダーを必ず置換し、共有しない |
| `oauth-model-alias` | Codex モデルを Claude Code で選択できる別名として公開する設定 | 既定の例を保持する |
| `oauth-excluded-models` | この構成で使わないモデルを明示する設定 | 既定の例を保持する |

モデル別名は、上流のモデル名そのものではない。たとえば `claude-gpt-5-6-terra` は、このリポジトリの設定が Codex の `gpt-5.6-terra` に付けるクライアント側の別名であることを説明する。

### 4. OAuth を認証する（必要なものだけ）

認証はプロキシを起動する前または後に、設定ファイルを明示して実施する。手順書は次の公式フラグを記載する。

```bash
# Codex を使う場合だけ
cli-proxy-api --config "cliproxyapi.config.yaml" --codex-login

# Claude を使う場合だけ
cli-proxy-api --config "cliproxyapi.config.yaml" --claude-login
```

ブラウザが自動的に開かない環境では、`--no-browser` を追加して表示された URL を自分のブラウザで開く方法を説明する。OAuth コールバックポートが競合する場合だけ `--oauth-callback-port` を使う旨を案内する。

各認証手順には、次の注記を付ける。

- 認証するのは利用するプロバイダーだけでよい。
- ブラウザで認証を完了するまでターミナルを閉じない。
- 認証情報は `auth-dir` に保存されるため、他人に渡さない。
- ログインに失敗した場合は、認証状態・ブラウザ・プロキシログを確認してから再試行する。

### 5. CLIProxyAPI を起動して確認する

既存の `scripts/start-proxy.sh` を使う。現行スクリプトは `cliproxyapi.config.yaml` を相対パスで参照するため、必ずリポジトリルートで実行することを明記する。

```bash
./scripts/start-proxy.sh
```

起動したターミナルはそのままにして、別ターミナルで API の動作を確認する。認証ヘッダーを付けた `curl` により、`http://127.0.0.1:8317/v1/models` などのプロキシ公開 API を確認する。手順書では、API キー自体を画面や共有ログに残さないよう、シェル変数を使う例を採用する。

確認結果の解釈を示す。

- 接続できる: プロキシは起動している。
- `401` / `403`: ローカル API キーまたは認証ヘッダーを確認する。
- 接続拒否: プロキシが起動しているか、ポート番号が設定と一致するかを確認する。
- モデルが期待どおりでない: 実施した OAuth と `oauth-model-alias` / `oauth-excluded-models` を確認する。

### 6. Claude Code からプロキシを使う（任意）

Claude Code は `ANTHROPIC_BASE_URL` を設定すると、Anthropic 互換の LLM ゲートウェイへ通信する。この仕組みを使い、プロキシが起動している間だけ CLIProxyAPI を経由させる。

手順書は、永続的なシェル設定の変更を最初から要求しない。まずは 1 回の起動コマンドに環境変数を付ける方式を標準とする。

```bash
ANTHROPIC_BASE_URL="http://127.0.0.1:8317" \
ANTHROPIC_AUTH_TOKEN="$CLI_PROXY_API_KEY" \
claude
```

実装時には、CLIProxyAPI と Claude Code の認証ヘッダー要件を公式ドキュメントと実環境で再確認し、`ANTHROPIC_AUTH_TOKEN` または必要な認証変数を明記する。API キーをソースコード・設定ファイル・コミットへ直接記載しない。

この節に次の注意を含める。

- 通常の Claude Code に戻すには、上記の環境変数を付けずに `claude` を起動する。
- API キーまたは認証トークンを設定すると、一部の Claude Code 機能（Remote Control、`/schedule`、claude.ai MCP コネクター、通知設定）が無効になる場合がある。
- CLIProxyAPI が停止している状態でこの環境変数を付けて Claude Code を起動すると、接続に失敗する。
- プロキシが受け付ける Claude Code のモデル名は、CLIProxyAPI の設定と OAuth 状態に依存する。

### 7. Docker を使う場合（補足）

Docker を使いたい利用者向けに、公式の `docker compose` 構成を参照させる。

この節では、以下を明記する。

- 本文のローカル実行ファイル方式と Docker 方式を同時に起動しない。ポート `8317` が競合する。
- 設定、OAuth 認証情報、ログをコンテナ外のボリュームへ保存する。
- `127.0.0.1:8317:8317` のように、ホスト側でもローカルバインドを維持する。
- Docker 方式の起動・停止・ログ確認は公式の Compose ファイルを基準にする。

### 8. トラブルシューティング

表形式で、少なくとも次の症状を扱う。

| 症状 | 最初の確認 | 主な対応 |
| --- | --- | --- |
| `cli-proxy-api: command not found` | `command -v cli-proxy-api` | 実行ファイルの配置、実行権限、`PATH` を確認する |
| プロキシに接続できない | 起動ターミナルのログ、設定の `host` と `port` | プロキシを起動し、ポート競合を解消する |
| `401` / `403` | `api-keys` とリクエストの認証値 | ローカル API キーを見直す |
| OAuth が完了しない | ブラウザ、`--no-browser` の使用、ログ | 対象アカウントで再認証し、コールバックポート競合を確認する |
| モデルが表示されない | OAuth 実施状況、設定の別名・除外リスト | 必要なプロバイダーを認証し、設定を見直して再起動する |
| Claude Code が接続できない | `ANTHROPIC_BASE_URL`、プロキシ起動、認証変数 | URL・ポート・トークンを見直し、通常起動と比較する |
| 通常の Claude Code の機能が減った | Claude Code 起動時の認証環境変数 | プロキシを使わない起動では環境変数を付けない |

## 既存ファイルとの関係

| ファイル | 扱い |
| --- | --- |
| `ONBOARDING.md` | 既存リンク先の `docs/development/cliproxyapi-setup.md` を新規作成して有効化する。本文のリンク文言は変更しない。 |
| `cliproxyapi.config.example.yaml` | 設定作成のコピー元として使う。実キーは書かない。 |
| `.gitignore` | `cliproxyapi.config.yaml` が無視対象であることを、安全上の根拠として説明する。 |
| `scripts/start-proxy.sh` | リポジトリルートから実行する起動手段として案内する。スクリプト自体の振る舞いは本タスクでは変更しない。 |

## エラー処理と安全境界

- 手順書は `sudo` を前提にしない。利用者が任意の配置先へ実行ファイルを置く方法を選べるようにする。
- 実行ファイル・Docker イメージの導入時は、公式リポジトリと公式 Releases から取得することを求める。
- API キー、OAuth 認証情報、Cookie、アクセストークンを例示値以外で文書化しない。
- ローカルプロキシをネットワークへ公開する手順は含めない。
- ユーザー固有の Claude Code 設定ファイルを自動変更する手順は含めない。まずは一時的な環境変数で検証する。

## 検証

手順書の実装後、次を確認する。

1. `ONBOARDING.md` のリンク先 `docs/development/cliproxyapi-setup.md` が存在する。
2. すべてのリポジトリ内リンクが有効である。
3. `cliproxyapi.config.example.yaml` に存在する設定キー・モデル別名・ポート番号と記載が一致する。
4. `scripts/start-proxy.sh` が要求する実行ディレクトリと、手順書の起動指示が一致する。
5. コードブロックに秘密情報の実値が含まれない。
6. OAuth が必要な実アカウント認証、実キーによる API 呼び出し、Claude Code の実接続は、認証情報を扱わないため自動実行しない。実装者はコマンドの構文と公式ドキュメント整合を確認し、その制約を最終報告に記載する。

## 非スコープ

- CLIProxyAPI、Claude Code、Codex の認証方式そのものの実装・改変。
- 共通のシェル初期化ファイル（`.bashrc`、`.zshrc` など）への環境変数の永続設定。
- CLIProxyAPI を LAN、インターネット、サーバーへ公開する構成。
- チーム共有の API キー、共有 OAuth アカウント、認証情報配布手順。
- `cliproxyapi.config.example.yaml`、`scripts/start-proxy.sh`、`.gitignore` の変更。
