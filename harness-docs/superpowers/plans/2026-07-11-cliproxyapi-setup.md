# CLIProxyAPI セットアップ手順書 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WSL2/Linux のジュニアエンジニアが、CLIProxyAPI の導入、任意の Codex/Claude OAuth、ローカル API 確認、Claude Code 経由の利用までを安全に完了できる手順書を提供する。

**Architecture:** `ONBOARDING.md` が既に参照する `docs/development/cliproxyapi-setup.md` を新規作成する。設定例と起動スクリプトを唯一のリポジトリ内事実源とし、CLIProxyAPI と Claude Code の最新の公式ドキュメントは固定 URL や推測した CLI 構文を避けるための外部参照として使う。実認証・実キーでの検証はせず、文書の構造、リンク、設定値、コマンド構文の整合を確認する。

**Tech Stack:** Markdown、Bash、CLIProxyAPI、Claude Code、`curl`。

**Spec:** `docs/superpowers/specs/2026-07-11-cliproxyapi-setup-design.md`

## Global Constraints

- 対象読者は WSL2/Linux の初学者であり、CLIProxyAPI は必須ではなく任意設定として説明する。
- 実設定はリポジトリルートの `cliproxyapi.config.yaml` に作り、Git に追加しない。例示値以外の API キー、OAuth トークン、Cookie、認証情報を文書に書かない。
- ローカルプロキシは `127.0.0.1` とポート `8317` を維持する。LAN・インターネット・サーバーへ公開する手順は含めない。
- OAuth は Codex と Claude のうち利用者が必要なものだけ実施する。認証情報は `auth-dir` の `~/.cli-proxy-api` に保存され、共有しない。
- `scripts/start-proxy.sh` はリポジトリルートで `cliproxyapi.config.yaml` を参照する。本文の起動コマンドはこの作業ディレクトリを明示する。
- Claude Code のプロキシ接続は一時的な環境変数付き起動で案内し、`.bashrc` / `.zshrc` などを変更しない。
- 本タスクでは `ONBOARDING.md`、`cliproxyapi.config.example.yaml`、`scripts/start-proxy.sh`、`.gitignore` を変更しない。
- 実 OAuth、実 API キーでの API 呼び出し、実際の Claude Code 接続は実施しない。検証結果では未実施理由を明記する。
- ユーザーから明示的な依頼がない限り、コミットしない。

---

## File Structure

| ファイル | 役割 |
| --- | --- |
| Create: `docs/development/cliproxyapi-setup.md` | 任意設定としての CLIProxyAPI 初回導入、設定、OAuth、起動、API 検証、Claude Code 利用、Docker 補足、トラブルシューティングを説明する唯一の利用手順書。 |
| Read-only reference: `ONBOARDING.md:191-194` | 利用者への既存導線。新規文書のパスとタイトルを一致させる。 |
| Read-only reference: `cliproxyapi.config.example.yaml:1-36` | ローカルバインド、ポート、認証保存先、API キー、モデル別名、除外モデルの正しい値。 |
| Read-only reference: `.gitignore:1-4` | 実設定 `cliproxyapi.config.yaml` が Git 無視されることの根拠。 |
| Read-only reference: `scripts/start-proxy.sh:1-4` | プロキシを起動する既存スクリプトと、リポジトリルートでの実行前提。 |

---

### Task 1: ジュニア向け CLIProxyAPI セットアップ手順書を作成する

**Files:**
- Create: `docs/development/cliproxyapi-setup.md`
- Read: `ONBOARDING.md:191-194`
- Read: `cliproxyapi.config.example.yaml:1-36`
- Read: `.gitignore:1-4`
- Read: `scripts/start-proxy.sh:1-4`

**Interfaces:**
- Consumes: `ONBOARDING.md` のリンク先 `docs/development/cliproxyapi-setup.md`、設定例の `host: "127.0.0.1"` / `port: 8317` / `auth-dir: "~/.cli-proxy-api"` / `api-keys` / `oauth-model-alias` / `oauth-excluded-models`。
- Produces: WSL2/Linux 向けの自己完結した Markdown 手順書。利用者は実設定の作成、必要な OAuth、プロキシ起動、ローカル API 確認、任意の Claude Code 起動を順番に実施できる。

- [ ] **Step 1: 外部 CLI の現行コマンドを公式資料で再確認する**

CLIProxyAPI と Claude Code は外部 CLI であるため、執筆直前に公式ドキュメントを確認し、次の項目を記録する。

1. CLIProxyAPI の公式 GitHub リポジトリと Releases ページ。
2. CLIProxyAPI の `--config`、`--codex-login`、`--claude-login`、`--no-browser`、`--oauth-callback-port` の構文。
3. Claude Code のプロキシ接続で使う `ANTHROPIC_BASE_URL` と認証環境変数の現在の仕様。
4. 認証環境変数を設定した Claude Code で影響を受ける機能の公式注意事項。

確認結果が既存の設計書と異なる場合は、推測で補わない。公式ドキュメントに一致する記法へ設計書の該当箇所を更新し、実装計画を調整してから執筆する。

- [ ] **Step 2: 手順書の導入・前提・安全境界を書く**

`docs/development/cliproxyapi-setup.md` を新規作成し、次の内容で開始する。

```markdown
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
```

続けて、実設定ファイルは Git 無視されていることを明記する。

```markdown
> [!IMPORTANT]
> `cliproxyapi.config.yaml` は実キーを含むローカル設定です。`.gitignore` に登録済みですが、`git add -f` などで強制追加しないでください。
```

- [ ] **Step 3: CLIProxyAPI 導入の本文と Docker 補足を書く**

「CLIProxyAPI を導入する」節を追加する。固定のバージョン番号・アセット名・ダウンロード URL は記載しない。利用者が公式 Releases から自分のアーキテクチャに合う Linux バイナリを取得し、`PATH` 上のディレクトリに実行ファイルを置き、実行権限を設定し、ヘルプ表示で確認する流れを記載する。

```markdown
## 1. CLIProxyAPI を導入する

CLIProxyAPI は公式の GitHub Releases から取得します。Releases ページで、WSL2/Linux と自分の CPU アーキテクチャに対応するファイルを選んでください。

1. [CLIProxyAPI の公式 Releases](https://github.com/router-for-me/CLIProxyAPI/releases) を開く
2. Linux 用の配布ファイルをダウンロードして展開する
3. 展開した実行ファイルを、自分の `PATH` に含まれるディレクトリへ `cli-proxy-api` として配置する
4. 実行権限を設定する

導入後、次のコマンドで確認します。

~~~bash
cli-proxy-api --help
~~~

ヘルプが表示されれば導入は完了です。`command not found` と表示される場合は、実行ファイルの配置先と `PATH` を確認してください。
```

その後に「Docker を使う場合」節を追加する。公式 Compose 構成を参照するリンクを示し、ローカル実行ファイル方式と Docker 方式を同時起動しないこと、設定・OAuth 認証情報・ログをコンテナ外のボリュームに保存すること、公開ポートをローカルに限定することだけを説明する。手順書内で独自の Compose ファイルを作成しない。

- [ ] **Step 4: プロジェクト設定を作成する手順を書く**

「プロジェクト用の設定を作成する」節を追加する。リポジトリルートで実行することと、コピーコマンドを明記する。

```markdown
## 2. プロジェクト用の設定を作成する

このリポジトリのルートで、設定例をローカル設定としてコピーします。

~~~bash
cp cliproxyapi.config.example.yaml cliproxyapi.config.yaml
~~~

次に、`cliproxyapi.config.yaml` をエディターで開き、`api-keys` の `replace-with-a-random-local-key` を自分だけが使う十分にランダムな文字列へ置き換えます。置き換えた値は、次の API 確認と Claude Code の起動で使います。
```

次の表を手順書に追加し、例示設定の値をそのまま説明する。

```markdown
| 設定 | 役割 | 扱い |
| --- | --- | --- |
| `host: "127.0.0.1"` | このマシンからだけ接続を受け付ける | 変更しない |
| `port: 8317` | プロキシの待受ポート | 他のプロセスと競合するときだけ変更する |
| `auth-dir: "~/.cli-proxy-api"` | OAuth 認証情報の保存先 | 内容を共有・コミットしない |
| `api-keys` | ローカル API の認証キー | プレースホルダーを必ず置換し、共有しない |
| `oauth-model-alias` | Codex モデルをクライアント側の別名として公開する設定 | 既定値を保持する |
| `oauth-excluded-models` | この構成で公開しないモデルの設定 | 既定値を保持する |
```

さらに、`claude-gpt-5-6-sol`、`claude-gpt-5-6-terra`、`claude-gpt-5-6-luna` は Codex の上流モデルに付けるクライアント側の別名であり、上流モデル ID そのものではないと明記する。

- [ ] **Step 5: Codex OAuth と Claude OAuth の手順を書く**

「OAuth を認証する（必要なものだけ）」節を追加する。Step 1 で確認した CLIProxyAPI の公式構文を使い、次の形で Codex と Claude を明確に分離する。

```markdown
## 3. OAuth を認証する（必要なものだけ）

Codex と Claude の両方を認証する必要はありません。使いたいサービスだけ認証してください。

### Codex OAuth

Codex を使う場合は、リポジトリルートで次を実行します。

~~~bash
cli-proxy-api --config "cliproxyapi.config.yaml" --codex-login
~~~

### Claude OAuth

Claude を使う場合は、リポジトリルートで次を実行します。

~~~bash
cli-proxy-api --config "cliproxyapi.config.yaml" --claude-login
~~~
```

ブラウザを自動起動できない場合の注記を追加する。

```markdown
WSL などでブラウザが開かない場合は、コマンドに `--no-browser` を追加します。表示された URL を自分のブラウザで開いて認証を完了してください。認証が終わるまで、コマンドを実行したターミナルは閉じないでください。

OAuth のコールバック用ポートが他のアプリケーションと競合する場合だけ、`--oauth-callback-port` で別のポートを指定してください。
```

`auth-dir` に保存された認証情報は共有しないこと、OAuth 失敗時はブラウザ・コマンド出力・ポート競合を確認してから再試行することを追加する。

- [ ] **Step 6: 起動とローカル API の確認手順を書く**

「CLIProxyAPI を起動する」節を追加する。既存スクリプトの相対パス前提を誤らせないため、リポジトリルートからの起動を太字で強調する。

```markdown
## 4. CLIProxyAPI を起動する

**リポジトリルートで**次を実行します。

~~~bash
./scripts/start-proxy.sh
~~~

このターミナルは、プロキシを動かしている間は開いたままにします。
```

続けて、別ターミナルでの API 確認を追加する。実値を文書に残さないため、環境変数を利用する。

```markdown
別のターミナルで、設定したローカル API キーを一時的なシェル変数に設定します。

~~~bash
read -rsp "CLIProxyAPI のローカル API キー: " CLI_PROXY_API_KEY
echo
~~~

次に、プロキシが応答することを確認します。

~~~bash
curl --fail-with-body \
  --header "Authorization: Bearer $CLI_PROXY_API_KEY" \
  http://127.0.0.1:8317/v1/models
~~~

JSON の応答が表示されれば、プロキシは起動しています。
```

`401` / `403` は API キーまたは認証ヘッダーの見直し、接続拒否は起動状態・`host`・`port` の確認、期待するモデルがない場合は実施した OAuth と `oauth-model-alias` / `oauth-excluded-models` の確認につながる説明を追加する。

- [ ] **Step 7: Claude Code を経由利用する任意手順を書く**

「Claude Code からプロキシを使う（任意）」節を追加する。Step 1 で確認した公式の環境変数名と認証方式を使う。最初は現在のシェルだけで有効な環境変数付き起動に限定する。

```markdown
## 5. Claude Code からプロキシを使う（任意）

CLIProxyAPI が起動している別ターミナルを残したまま、このターミナルでローカル API キーを読み取ります。

~~~bash
read -rsp "CLIProxyAPI のローカル API キー: " CLI_PROXY_API_KEY
echo
~~~

次に、環境変数を付けて Claude Code を起動します。

~~~bash
ANTHROPIC_BASE_URL="http://127.0.0.1:8317" \
ANTHROPIC_AUTH_TOKEN="$CLI_PROXY_API_KEY" \
claude
~~~

この方法は、この 1 回の `claude` 起動だけを CLIProxyAPI 経由にします。通常の Claude Code に戻すには、環境変数を付けずに `claude` を起動してください。
```

Step 1 の公式資料で `ANTHROPIC_AUTH_TOKEN` 以外の認証変数が必要だと確認された場合は、その公式名に置き換え、Bearer 認証との対応を明記する。

次の注意事項を追加する。

```markdown
> [!NOTE]
> `ANTHROPIC_BASE_URL` を設定すると、Claude Code の通信先は公式 API ではなく CLIProxyAPI になります。プロキシ運用者と接続先サービスの利用条件が適用されます。

> [!NOTE]
> `ANTHROPIC_API_KEY` または `ANTHROPIC_AUTH_TOKEN` を設定した Claude Code では、Remote Control、`/schedule`、claude.ai MCP コネクター、通知設定などの一部機能が無効になる場合があります。
```

プロキシ停止中にこの起動をすると接続できないこと、利用可能なモデルは OAuth 状態と設定の別名・除外リストに依存することも説明する。

- [ ] **Step 8: トラブルシューティングと完了確認を書く**

「トラブルシューティング」節を追加する。少なくとも次の表を含める。

```markdown
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
```

最後に完了チェックリストを追加する。

```markdown
## 完了チェック

- [ ] `cli-proxy-api --help` が成功する
- [ ] `cliproxyapi.config.yaml` を作成し、ローカル API キーを置き換えた
- [ ] `./scripts/start-proxy.sh` をリポジトリルートで実行できる
- [ ] `curl` で `http://127.0.0.1:8317/v1/models` の応答を確認できる
- [ ] 必要な OAuth だけを認証した
- [ ] Claude Code を使う場合、環境変数付き起動でプロキシ経由にできる
```

- [ ] **Step 9: 手順書の文書検証を行う**

次のコマンドをリポジトリルートで実行する。

~~~bash
# 既存の案内リンク先が作成されたことを確認する
test -f docs/development/cliproxyapi-setup.md

# 禁止した秘密情報の実値や未解決の執筆マーカーがないことを確認する
rg -n "T[O]DO|T[B]D|ANTHROPIC_API_KEY=sk-|sk-ant-|Bearer [A-Za-z0-9_-]{20,}" \
  docs/development/cliproxyapi-setup.md || true

# 文書と既存設定のキー・起動パスを並べて確認する
rg -n "127\.0\.0\.1|8317|auth-dir|api-keys|oauth-model-alias|oauth-excluded-models|cliproxyapi\.config\.yaml|scripts/start-proxy\.sh" \
  docs/development/cliproxyapi-setup.md \
  cliproxyapi.config.example.yaml \
  scripts/start-proxy.sh \
  ONBOARDING.md

# 差分に空白エラーがないことを確認する
git diff --check -- docs/development/cliproxyapi-setup.md
~~~

Expected:

- `test -f` が終了コード 0 を返す。
- `rg` の 1 回目は、秘密情報や未解決の執筆マーカーを出力しない。
- 2 回目の `rg` は、新手順書、設定例、起動スクリプト、`ONBOARDING.md` に必要な値・パスを表示する。
- `git diff --check` は出力なしで終了する。

- [ ] **Step 10: 実認証を行わない範囲を最終報告に明記する**

最終報告に次の事実を含める。

```markdown
- `docs/development/cliproxyapi-setup.md` を追加し、`ONBOARDING.md` の既存リンク先を有効化した。
- 設定例と起動スクリプトに対するパス・キー・ポートの整合を確認した。
- OAuth、実 API キーによる API 呼び出し、Claude Code の実プロキシ接続は、個人の認証情報を扱うため実行していない。
```

コミットは作成しない。ユーザーから明示的に依頼された場合にだけ、既存の未コミット変更と分けられるかを確認してからコミット手順を提案する。

---

## Plan Self-Review

### Spec coverage

- 任意設定・WSL2/Linux の読者・前提・完了条件: Task 1, Steps 2, 3, 8。
- CLIProxyAPI 導入と Docker 補足: Task 1, Step 3。
- 設定例のコピー、ローカル API キー、Git 無視、モデル別名: Task 1, Step 4。
- Codex OAuth と Claude OAuth、ブラウザなし・コールバックポート: Task 1, Step 5。
- リポジトリルートでの起動、ローカル API の認証付き確認: Task 1, Step 6。
- `ANTHROPIC_BASE_URL` を使う Claude Code の一時的な経由利用と機能上の注意: Task 1, Step 7。
- トラブルシューティング、安全境界、実認証をしない検証制約: Task 1, Steps 2, 8, 9, 10。
- `ONBOARDING.md` の既存リンクを変更せず有効化すること: Task 1, Steps 2, 9, 10。

### Placeholder scan

- 未解決の執筆マーカー、後回し表現、未定義のコード実装手順は含まない。
- 外部 CLI の配布アセット名・バージョンを固定せず、公式 Releases を確認する明示的な手順にした。

### Interface consistency

- 新規成果物パスはすべて `docs/development/cliproxyapi-setup.md` に統一した。
- 設定ファイル名は `cliproxyapi.config.yaml`、設定例は `cliproxyapi.config.example.yaml`、起動スクリプトは `scripts/start-proxy.sh` に統一した。
- プロキシ URL はすべて `http://127.0.0.1:8317`、OAuth コマンドの設定引数はすべて `--config "cliproxyapi.config.yaml"` に統一した。
