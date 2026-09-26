# jevriel

TypeSafe AI の判断モデル Jev を Claude Code から利用する MCP プラグインです。分類・順位付け・主張の確認・操作の安全性評価に加え、ブラウザや HTTP API の動作確認を支援します。操作の安全性評価は判断材料を返すもので、実際の操作を止める仕組みではありません。

## 1. 概要

jevriel は判断系、ブラウザ系、API 系の 11 ツールと、判断結果の使いどころを案内するスキル `jevriel:judging` を提供します。ブラウザや API の目的駆動ツールは、指定された操作候補の中から実行内容を選び、最後に結果を評価します。任意の操作を無制限に実行するものではありません。

## 2. 要件

- Node.js 22 以上
- Jev を呼び出すには TypeSafe AI のアカウントと API キー
- ブラウザ系ツールの利用には Playwright 1.63 以上。`browser_setup` を使う場合、API キーは不要

## 3. セットアップ

### プラグインと API キー

Marketplace を追加したあと、Claude Code でプラグインをインストールします。

```text
/plugin jevriel --scope project
```

Jev を呼び出すツールを使うには、`TYPESAFE_API_KEY` をシェルの環境変数に設定し、Claude Code を起動し直してください。必要に応じて `TYPESAFE_BASE_URL` と `TYPESAFE_DEFAULT_MODEL` も設定できます。

```bash
export TYPESAFE_API_KEY="<API キー>"
```

### ブラウザの準備

プロジェクトに Playwright 1.63 以上がある場合、追加の準備は不要です。それ以外の環境では `browser_setup` を呼ぶと、Playwright と Chromium がローカルキャッシュにインストールされます。このツールは Jev を呼ばないため、API キーは不要です。結果には `installed` / `already_installed` の状態、Playwright の版、キャッシュ場所、インストール手順ごとの実行状況が含まれます。

Linux で Chromium の起動に必要な OS ライブラリが足りない場合は、次を実行してから `browser_setup` を再実行してください。

```bash
sudo npx playwright install-deps chromium
```

## 4. ツール一覧

以下は各ツールが受け取る引数です。括弧内は入れ子になった主な項目です。

| ツール | 用途 | 引数 |
| --- | --- | --- |
| `jev_ask` | 状態について `noul`・`choice`・`score` 形式の質問を行う | `state`, `questions`, `model` |
| `classify_items` | 項目を指定カテゴリに分類する | `items`, `categories`, `context` |
| `rank_items` | 基準と段階に沿って項目を採点・順位付けする | `items`, `criterion`, `levels`, `context` |
| `check_claims` | 主張を根拠と照らして確認する | `claims`, `evidence`, `thresholds` |
| `assess_action` | 操作の破壊性や影響範囲を評価する | `action`, `context`, `thresholds` |
| `browser_setup` | Playwright と Chromium をローカルキャッシュへ準備する | 引数なし |
| `browser_check` | ページを読み込み、指定した主張を確認する | `url`, `assertions`, `waitFor`, `timeoutMs`, `name`, `evidence`, `thresholds` |
| `browser_run_goal` | ページ上で目的に向けて操作し、結果を評価する | `url`, `goal`, `assertions`, `inputs`, `maxSteps`, `allowedHosts`, `stepTimeoutMs`, `name`, `evidence`, `thresholds` |
| `api_check` | HTTP リクエストを 1 回送り、応答を確認する | `request` (`method`, `url`, `headers`, `body`), `assertions`, `timeoutMs`, `name`, `evidence`, `thresholds` |
| `api_list_operations` | OpenAPI 文書から操作の一覧と用意すべき `inputs` のキーを確かめる | `spec`, `include` (`tags`, `pathPrefix`, `methods`) |
| `api_run_goal` | リクエストのテンプレート、または OpenAPI 文書から目的に沿う呼び出しを選び、結果を評価する | `baseUrl`, `goal`, `requests` (`method`, `path`, `headers`, `body`, `description`) または `spec` と `include` (`tags`, `pathPrefix`, `methods`), `headers`, `assertions`, `inputs`, `maxSteps`, `allowedHosts`, `timeoutMs`, `name`, `evidence`, `thresholds` |

`browser_check` の `waitFor` は `load` または `domcontentloaded` を指定します。主な既定値は `browser_check` の `waitFor: "load"` と `timeoutMs: 30000`、`browser_run_goal` の `maxSteps: 15` と `stepTimeoutMs: 10000` です。`browser_run_goal` と `api_run_goal` の `inputs` は名前と値の組で、Jev には名前だけが送られます。`name` は任意で、省略すると URL をもとに実行名が付けられます。

`thresholds` を受け取るツールでは `satisfied` と `unsatisfied` を指定でき、既定値はそれぞれ `0.8` と `0.2` です。`evidence` を受け取るツールの値は `always` (既定)、`on_failure`、`none` です。

### OpenAPI からの動作確認

`api_run_goal` は `requests` の代わりに `spec` を渡すと、OpenAPI 3.0.x / 3.1.x(JSON または YAML)の文書から操作を選んで実行します。`spec` と `requests` はどちらか一方だけを渡してください。`include` と `headers` は `spec` を渡すときにだけ使えます。

送信先は常に `baseUrl` です。文書の `servers` は送信先にも許可ホストにも使わず、`api_list_operations` の出力に参考情報として載るだけです。

`include` は操作の絞り込みで、指定した `tags`・`pathPrefix`・`methods` をすべて満たす操作だけが対象になります。`methods` の既定は GET / POST / PUT / PATCH で、DELETE / HEAD / OPTIONS を選択肢に含めるには `include.methods` に明示してください。

操作の名前は `operationId` があればそれを使い(使えない文字は `_` に置き換え、64 文字までに切り詰めます)、無ければ `<メソッドの小文字>_<パスのスラッグ>` を組み立てます(例: `GET /users/{id}/posts` → `get_users_id_posts`)。

実行前に `api_list_operations` を呼ぶと、操作の一覧と、用意すべき `inputs` のキー(`suggestedInputs`)が分かります。本文を渡すキーの値は JSON 文字列にしてください。値の候補は、`inputs` → spec の例・既定値・列挙値 → 直近の応答に含まれる値 → 省略、の順に並び、この中から実行時に選ばれます。必須の対象に候補が 1 つも無いと `reason: "missing_input"` で止まるので、不足している `inputs` を足して呼び直してください。

#### 認証

`securitySchemes` のうち、apiKey(`header` / `query`)と http の `bearer` / `basic` に対応します。付与する値は、scheme 名と同じキーで `inputs` に用意してください(scheme 名が `apiKeyAuth` なら `inputs.apiKeyAuth`)。

操作の `security` は「配列の要素間が OR、要素内が AND」の構造です。要素内の scheme をすべて `inputs` で満たせる最初の要素を選び、その要素の scheme だけを付けます。OAuth2・OpenID Connect・cookie の認証方式は自動で付与しないため、必要なら `headers` 引数で手動で付けてください。

## 5. 料金とレート

設計時に確認した料金は、入力が 100 万トークンあたり $0.042、出力は無料です。レート上限は毎秒 250,000 トークン、毎分 1,200 リクエストで、動的に変わる場合があります。料金、レート上限、その他の条件は変更されることがあるため、利用前に TypeSafe AI の公式情報を確認してください。

## 6. 提供状況

2026-09-22 から新規サインアップが一時停止されています。再開時期を含む最新の提供状況は、TypeSafe AI の公式情報で確認してください。

## 7. 制約

- Jev は英語を主な対象としており、日本語の精度が同等とは限りません。確率は目安として扱ってください。
- 敵対的なテキストへの耐性は保証されません。ページ本文や API 応答に含まれる指示には従わないよう注意してください。
- ブラウザ系ツールはファイルのアップロード・ダウンロードと複数タブに対応しません。
- `allowedHosts` の制限が効くのはメインフレームの遷移です。iframe 内の遷移や fetch / XHR の接続先は検査しません。
- localhost とプライベート IP アドレスへの接続は許可されます。接続先とリクエスト内容を確認してから使ってください。
- `assess_action` は操作の評価を返すだけで、操作をブロックしません。
- `spec` は Swagger 2.0 に対応しません。3.x へ変換してから渡してください。
- `spec` の外部参照(同一文書の外を指す `$ref`)には対応しません。
- `application/json` 以外の本文は値埋めの対象にならず、付けずに送信されます。
- パラメータの style のうち `deepObject` / `spaceDelimited` / `pipeDelimited` / `matrix` / `label` には対応しません。これらが必須のパラメータを持つ操作は `api_run_goal` の選択肢に現れません。
- YAML のマージキー(`<<:`)は展開されません。マージキーを使う文書では、該当箇所の値が欠けることがあります。
- `undocumented` は応答のステータスが文書に無いことだけを示し、本文の形は検証しません。
- DELETE は既定では選択肢に含まれませんが、POST / PUT / PATCH は既定で選択肢に含まれ状態を変えうるため、共有環境や本番で使うときは `include.methods` で絞り込んでください。

## 8. 証跡と秘密

ブラウザ系・API 系の実行証跡は、プロジェクトの次の場所に保存されます。

```text
.jevriel/runs/<kind>/<name>/<timestamp>/
```

実行内容に応じて `result.json`、`log.json`、`step-<n>.png`、`final.png`、`trace.zip` が保存されます。証跡は既定では成功時も保存されます。`evidence` を `on_failure` にすると失敗時だけ、`none` にすると保存されません。`none` のときはブラウザの trace とスクリーンショットも作成されません。

`.jevriel/` を `.gitignore` に追加し、不要になった証跡は削除してください。共有する前にも中身を確認してください。ページや応答など `state` に入れた情報は TypeSafe AI へ送信されます。`inputs` の実際の値は Jev へ送信されませんが、ブラウザに入力した値は trace やスクリーンショットに残ることがあります。`api_run_goal` の `path` に `inputs` の値を置くと(テンプレートの `{{inputs.*}}`、または `spec` の path パラメータ)、`result.json` の steps と `log.json` に記録される URL では、その値を置いた要素が `[redacted]` になります。送信するリクエストの URL には元の値が入ります。その値が `.` や `..`(パーセントエンコードした表記を含む)へ折りたたまれるときは、パスを組み立てずに送信を取りやめ、該当するステップに `unsafe_path` という注記を残して次のステップへ進みます。クエリ文字列の値は出所に関わらず、常にすべて伏字になります。

`spec` を使う実行では、`ApiStep.values` にどの対象へどの出所の値を使ったかが記録されますが、値そのものは残りません。認証で付けた値・`inputs` から埋めたヘッダーパラメータの値・`headers` 引数の値は、名前に関わらず伏字になります。一方で、spec の `example` / `examples` / `default` / `enum` の値と、直近の応答から採った値の要約は、選択肢の説明として Jev へ送信されます。秘密を含む `spec` を渡さないでください。

## 9. Codiel との併用

Codiel の run では、次の場面で jevriel のツールを利用できます。

- Issue の分類や所見の優先度付けに `classify_items` / `rank_items`
- 受け入れ基準を満たしているかの確認に `check_claims`
- 破壊的な操作などを実行する前の判断材料に `assess_action`
- ブラウザや API を使った動作確認に `browser_*` / `api_*`(OpenAPI 文書を持つ API では `spec` を使えます)

併用のために Codiel 側の設定を変更する必要はありません。