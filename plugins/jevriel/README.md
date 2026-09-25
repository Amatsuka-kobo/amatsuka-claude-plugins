# jevriel

TypeSafe AI の判断モデル Jev を Claude Code から利用する MCP プラグインです。分類・順位付け・主張の確認・操作の安全性評価に加え、ブラウザや HTTP API の動作確認を支援します。操作の安全性評価は判断材料を返すもので、実際の操作を止める仕組みではありません。

## 1. 概要

jevriel は判断系、ブラウザ系、API 系の 10 ツールと、判断結果の使いどころを案内するスキル `jevriel:judging` を提供します。ブラウザや API の目的駆動ツールは、指定された操作候補の中から実行内容を選び、最後に結果を評価します。任意の操作を無制限に実行するものではありません。

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
| `api_run_goal` | リクエストのテンプレートから目的に沿う呼び出しを選び、結果を評価する | `baseUrl`, `goal`, `requests` (`method`, `path`, `headers`, `body`, `description`), `assertions`, `inputs`, `maxSteps`, `allowedHosts`, `timeoutMs`, `name`, `evidence`, `thresholds` |

`browser_check` の `waitFor` は `load` または `domcontentloaded` を指定します。主な既定値は `browser_check` の `waitFor: "load"` と `timeoutMs: 30000`、`browser_run_goal` の `maxSteps: 15` と `stepTimeoutMs: 10000` です。`browser_run_goal` と `api_run_goal` の `inputs` は名前と値の組で、Jev には名前だけが送られます。`name` は任意で、省略すると URL をもとに実行名が付けられます。

`thresholds` を受け取るツールでは `satisfied` と `unsatisfied` を指定でき、既定値はそれぞれ `0.8` と `0.2` です。`evidence` を受け取るツールの値は `always` (既定)、`on_failure`、`none` です。

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

## 8. 証跡と秘密

ブラウザ系・API 系の実行証跡は、プロジェクトの次の場所に保存されます。

```text
.jevriel/runs/<kind>/<name>/<timestamp>/
```

実行内容に応じて `result.json`、`log.json`、`step-<n>.png`、`final.png`、`trace.zip` が保存されます。証跡は既定では成功時も保存されます。`evidence` を `on_failure` にすると失敗時だけ、`none` にすると保存されません。`none` のときはブラウザの trace とスクリーンショットも作成されません。

`.jevriel/` を `.gitignore` に追加し、不要になった証跡は削除してください。共有する前にも中身を確認してください。ページや応答など `state` に入れた情報は TypeSafe AI へ送信されます。`inputs` の実際の値は Jev へ送信されませんが、ブラウザに入力した値は trace やスクリーンショットに残ることがあります。`api_run_goal` の `requests` の `path` に `{{inputs.*}}` を埋めると、解決後の URL が `result.json` の steps と `log.json` に記録されます。クエリ値と `{{inputs.*}}` を埋めたヘッダーは伏字になりますが、パスは伏字にならないため、秘密をパスに含める場合は `evidence: "on_failure"` または `"none"` を指定してください。

## 9. Codiel との併用

Codiel の run では、次の場面で jevriel のツールを利用できます。

- Issue の分類や所見の優先度付けに `classify_items` / `rank_items`
- 受け入れ基準を満たしているかの確認に `check_claims`
- 破壊的な操作などを実行する前の判断材料に `assess_action`
- ブラウザや API を使った動作確認に `browser_*` / `api_*`

併用のために Codiel 側の設定を変更する必要はありません。