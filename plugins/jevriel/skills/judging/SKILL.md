---
name: judging
description: 分類・採点・優先度付け・合否確認、主張の根拠確認、操作の安全性判定、ブラウザや API の動作確認を行うときに必ず使う。文章の生成・要約・翻訳・画像の判定には使わない。
allowed-tools:
  - mcp__jevriel__jev_ask
  - mcp__jevriel__classify_items
  - mcp__jevriel__rank_items
  - mcp__jevriel__check_claims
  - mcp__jevriel__assess_action
  - mcp__jevriel__api_check
  - mcp__jevriel__api_run_goal
  - mcp__jevriel__browser_setup
  - mcp__jevriel__browser_check
  - mcp__jevriel__browser_run_goal
---

# 判断と動作確認

## ツールの選び方

| 場面 | 主な入力 | ツール |
| --- | --- | --- |
| 専用ツールで扱えない判断を尋ねる | `state`、`questions` | `jev_ask` |
| 項目を指定カテゴリへ振り分ける | `items`、ラベルと説明の `categories`、任意の `context` | `classify_items` |
| 項目を基準で採点し順位を付ける | `items`、`criterion`、低い順の `levels`、任意の `context` | `rank_items` |
| 主張を根拠と照合する | `claims`、`evidence`、`thresholds` | `check_claims` |
| 操作の破壊性と影響範囲を見積もる | `action`、任意の `context`、`thresholds` | `assess_action` |
| ブラウザ実行環境を用意する | 入力なし | `browser_setup` |
| ページを読み込み、操作せず条件を確認する | `url`、`assertions`、`name`、`evidence`、`thresholds` | `browser_check` |
| ブラウザを操作して目標を達成し、条件を確認する | `url`、`goal`、`assertions`、`inputs`、`allowedHosts`、`name`、`evidence`、`thresholds` | `browser_run_goal` |
| API リクエストを 1 回送り、応答条件を確認する | `request`、`assertions`、`name`、`evidence`、`thresholds` | `api_check` |
| 用意した API リクエストを選びながら目標を達成し、条件を確認する | `baseUrl`、`goal`、`requests`、`assertions`、`inputs`、`allowedHosts`、`name`、`evidence`、`thresholds` | `api_run_goal` |

- 専用ツールで足りる判断には `jev_ask` を使わない。
- 機械的な集計や比較はコードで行う。

## state と質問の組み方

- `jev_ask` では、判断対象を項目名のある JSON の `state` に入れる。
- 専用ツールでは、判断対象と根拠を対応する入力欄へ渡す。
- 1 つの質問では 1 つの判断だけを求める。
- `jev_ask` の `instructions` は英語で書き、`state` のキーで判断対象を指す。
- ユーザーのデータは翻訳や言い換えをせず、そのまま渡す。
- 判断に関係しない長い説明は含めない。

## 確率と閾値

- `noul` の結果は `probability` と `verdict` を見る。`choice` と `score` の結果は `confidence` を見る。
- `uncertain` を確定した結論として扱わない。関連する根拠を加えて聞き直すか、利用者に確認する。
- 閾値を変えるのは、誤判定の影響が片側に大きい場合に限る。
- `assess_action` の破壊性が `unsatisfied` 以外なら、操作前に利用者へ確認する。
- `assess_action` の結果は判断材料であり、操作を止める仕組みではない。

## Jev が苦手なこと

- 計数、数値や日時の比較、多段の推論、文章の生成、画像の判定を Jev に任せない。
- これらはコードまたは Claude Code で先に処理し、必要な結果だけを `state` に入れる。

## ブラウザと API の確認

- `goal` には目標を、`assertions` には個別に合否を確認する条件を書く。
- `allowedHosts` にはテスト中に許可するホストだけを指定する。
- 実行入力の値は Jev に直接送られないが、ブラウザに入力した値は trace やスクリーンショットに残ることがある。秘密を扱うときは `evidence` に `on_failure` または `none` を指定する。
- `browser_check`、`browser_run_goal`、`api_check`、`api_run_goal` には、テスト対象の機能名や画面名を `name` として渡す。
- 同じ URL の別テストには、それぞれの対象が分かる `name` を付け、証跡が混ざらないようにする。

## 未セットアップのとき

- `not_configured` が返ったら、利用者に API キーの設定を依頼する。
- `playwright_missing` が返ったら、`browser_setup` を呼ぶ。
- `setup_failed` が返ったら、結果の案内を利用者に伝える。

## 外部送信

- `state` に入れたデータは外部サービスへ送信される。
- 秘密は `state` に入れない。
