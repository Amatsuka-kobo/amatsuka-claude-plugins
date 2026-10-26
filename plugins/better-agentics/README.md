# better-agentics

オーケストレーター(メインのセッション)が調査・設計・実装を自分で進め、次の 3 つの場面でだけサブエージェントへ委譲するプラグインです。

| 場面 | 内容 |
| --- | --- |
| レビュー | 自分の成果物を、自分以外の目で確かめる |
| 分担 | 大きな作業を、自分と並行して進めてもらう |
| 行き詰まり | 自分で原因を追っても解決しない |

委譲先は、TypeSafe AI の判断モデル Jev が選びます。各 Agent 定義の本文にある `## When to invoke`(英語の選択基準)を、委譲先決定スクリプトだけが読んで Jev に渡します。オーケストレーターは選択基準を持たず、「いつ委譲するか」だけを判断します。

## 使い方

1. `/better-agentics:setup` で、プロジェクトの `.claude/agents/` に委譲先の Agent 定義を作ります。13 の役割について、1 役割に 1 つずつ定義を作ります。
2. 次の 2 つの環境変数を設定し、新しいセッションを起動します。

   ```bash
   export AMATSUKA_AGENT_ENABLE_ORCHESTRATION=1
   export TYPESAFE_API_KEY=<TypeSafe AI の API キー>
   ```

3. セッションの開始時に、オーケストレーターの規律(`better-agentics:orchestration`)の使用指示が注入されます。サブエージェントの起動時には、サブエージェントの規律が注入されます。

`.claude/agents/` を新しく作ったときは、Claude Code を再起動するまで定義が読み込まれません。

## 環境変数

`AMATSUKA_AGENT_ENABLE_ORCHESTRATION` は前後の空白を除き、小文字にしてから判定します。上の行から順に評価し、最初に当たった行の動作になります。

| 状態 | セッション開始時の動作 |
| --- | --- |
| 未設定・空・`0`・`false`・`off` | 何もしない |
| `1`・`true`・`on` 以外の値 | 未知の値だという警告だけを出す |
| `AMATSUKA_AGENT_AUTO_INJECTION` が空でも `none` でもない | 規律を注入せず、2 つの環境変数が同時に有効だという警告を出す |
| `AMATSUKA_AGENT_DELEGATION_GATE` が `1`・`true`・`on` | 規律を注入せず、直接編集を差し止める gate が有効だという警告を出す |
| `TYPESAFE_API_KEY` が無い | 規律を注入せず、キーが無いという警告を出す |
| 上記以外 | オーケストレーターの規律の使用指示を注入する |

`AMATSUKA_AGENT_AUTO_INJECTION` と `AMATSUKA_AGENT_DELEGATION_GATE` は、エージェント運用方針を注入する別のプラグインの環境変数です。better-agentics と同時には使えません。

サブエージェントの規律は、better-agentics の定義で起動したサブエージェントに対し、上の表の最後の行か「`TYPESAFE_API_KEY` が無い」の行に当たるときだけ注入します。

## TypeSafe AI へ送る内容

委譲のたびに、次の内容が TypeSafe AI へ送られます。

- オーケストレーターが書いた作業の要約(英語)
- レビューを依頼するときは、成果物のパス
- 候補の Agent 定義の名前と、`## When to invoke` の本文

成果物の中身は送りません。

## 選ばれ方の調整

委譲先の選ばれ方は、生成した定義の `## When to invoke` を編集すると変えられます。`/better-agentics:setup` で定義を作り直すときは、利用者が編集したセクションを見分けて、保持するかを尋ねます。

## 動作の前提

- Node.js 22 以上
- TypeSafe AI の API キー。キーが無いと委譲先を決められず、オーケストレーターはユーザーの指示を待ちます。
