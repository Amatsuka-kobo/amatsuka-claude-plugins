# Metatron 📜

プロジェクトの技術的前提(`docs/ARCHITECTURE.md`)と失敗知識(`docs/GOTCHAS.md`)を記録・更新し、毎セッションの冒頭で AI のコンテキストへ注入するプラグインです。

名前は天の書記天使 Metatron に由来します。神の記録を司り、人の行いを書き留める役です。プロジェクトの前提と、そこで犯された失敗を書き留め続けるという、このプラグインの役割そのものを表しています。

## 何をするか

- **記録**: 2 文書の更新は決定的な CLI を通します。書式の検証・連番の採番・GOTCHAS が追記のみであることを機械で保証します。
- **更新**: `/metatron:init` と `/metatron:update` が、コードベース解析から起こしたドラフトをセクション単位で確認しながら文書を育てます。
- **注入**: SessionStart hook が ARCHITECTURE の内容と GOTCHAS の要約を毎セッション渡します。「作業前に必ず読む」という指示に頼りません。

## 動作要件

フックとスクリプトは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。

Claude Code 本体はネイティブバイナリで配布され Node.js を同梱しないため、未導入の場合は別途インストールしてください。

**常駐プロセスはありません。** metatron は MCP サーバーではなく、CLI も 2 つの hook もいずれも短命プロセスです。そのため「サーバーが起動していないので動かない」という故障はそもそも起こりません。MCP サーバー化を撤回した経緯は [`docs/rationale.md`](./docs/rationale.md) に残しています。

## コマンド

### `/metatron:init`

対象プロジェクトの ARCHITECTURE を初回生成します。まず CLI の `scan` がコードベースの事実(パッケージマネージャ・依存・スクリプト・ディレクトリ構造など)を集め、その事実からセクションごとのドラフトを起草します。ドラフトは「こう読み取ったが合っているか」という形でセクション単位に確認し、確定後に差分を全文提示して承認を得てから書き込みます。`## ADR 一覧` は初回生成の対象外です(空の節を置き、以後 `stage-adr` で足します)。

### `/metatron:update`

現在のコードベースと ARCHITECTURE の乖離を検出し、更新します。技術スタック・コマンド定義・ドメインマップの穴と死んだ glob・保護パス・セクションの欠落など、決定的に検出できる候補だけを一覧提示し、選ばれた分だけ差分提示と承認を経て書き込みます。

## CLI

```
node <metatron のプラグインルート>/scripts/metatron.mjs <サブコマンド> [オプション]
```

絶対パスは毎セッションの注入文と、直接編集を拒否したときのメッセージに載ります。インストール位置を自分で調べる必要はありません。

| サブコマンド | 種別 | 概要 |
| --- | --- | --- |
| `get config` | 読 | 解決済みの絶対パス、既定値が適用された項目、拒否された設定値 |
| `get architecture [--section <見出し>]` | 読 | 全文またはセクション単位の取得 |
| `get domains` | 読 | ドメインマップの構造化取得(パースの成否と理由も返す) |
| `get gotchas [--recent N \| --id <ID> \| --query <語>] [--exclude-tagged] [--promotion-candidates]` | 読 | 台帳の取得・検索 |
| `get adr [--id <ID> \| --status <状態>]` | 読 | ADR の取得・状態での絞り込み |
| `scan` | 読 | コードベース解析の事実を返す(書き込みなし) |
| `diff-architecture` | 読 | 現行 ARCHITECTURE との乖離候補を返す |
| `stage-architecture --input <path>` | 段階 | セクション更新案を受け取り、書かずに差分と `stagingId` を返す |
| `stage-adr --input <path>` | 段階 | ADR の追加・状態変更を段階化する(採番は CLI が行う) |
| `commit-architecture --staging-id <id>` | 書 | `stagingId` を消費して書き込む |
| `append-gotcha --input <path>` | 書 | エントリを先頭に挿入する(採番は CLI が行う) |
| `tag-gotcha --id <ID> --tag <解決済み\|対象外> --reason <理由>` | 書 | 既存エントリにタグを付与する(本文は不変) |

### なぜ CLI を通すのか

書式検証・採番・追記のみという規律を、AI への指示ではなく機械で保証するためです。指示は合理化して破られますが、CLI しか書き込み口が無ければ、壊れたドメインマップは書けず、連番は衝突せず、GOTCHAS の既存エントリは消えません。ARCHITECTURE の更新に `stage-architecture` → `commit-architecture` の 2 段階を課しているのも同じ理由で、差分を計算せずに書き込む経路がコマンド体系上存在しません(`stagingId` は単回使用、既定 30 分で失効し、その間にファイルが変化していれば commit は失敗します)。

### 長い入力は `--input <path>` で渡す

書き込み系サブコマンドの入力 JSON は、一時ファイルに書いてパスで渡します。引数に直接埋めると引数長の上限に当たり、本文中の引用符・バッククォート・`$`・改行がシェルに解釈されて壊れるためです。ファイルへの書き込みは Write ツールが担うのでシェルを一切通らず、CLI に渡るのはパス 1 個だけになります。CLI は読み取り後に一時ファイルを削除しません(失敗時に内容を確認できるようにするためです)。出力は常に JSON を stdout へ返します。読み取り系は「読めなかった」も事実として返すため常に exit 0、書き込み系は拒否・失敗で非 0 になり、理由は JSON の `error` に入ります。

## 2 つの hook

| hook | 役割 |
| --- | --- |
| **SessionStart**(`scripts/inject-context.mjs`) | ARCHITECTURE の内容、GOTCHAS の目次と直近エントリ、CLI の絶対パス案内をセッション開始時に注入します。予算を超える場合は GOTCHAS → ADR 一覧 → ARCHITECTURE の順に段階縮退し、CLI 案内だけは削りません |
| **PreToolUse**(`scripts/guard-docs.mjs`) | ARCHITECTURE / GOTCHAS への直接編集を拒否し、対象に応じた CLI の呼び出し方を絶対パス付きで案内します |

### 拒否の範囲(正直な限界)

PreToolUse hook が拒否するのは **Edit / Write / NotebookEdit ツール経由の書き込みだけ**です。次は対象外です。

- **Bash のリダイレクト**(`echo >> docs/GOTCHAS.md` など)。matcher に掛かりません。
- **人間のエディタでの編集**。hook は AI のツール呼び出しにのみ介在します。人間が普通に読み書きできることは Markdown で保存している目的そのものであり、これは正しい挙動です。
- **hook 自身が失敗したとき**。metatron の不具合であらゆる編集が止まる損害のほうが大きいため、素通しします(フェイルオープン)。

「回避を試みる AI を止める」機構ではなく、「知らずに直接編集する AI を正しい窓口へ導く」機構だと考えてください。ファイルは git 管理下にあるため、想定外の書き込みは差分で気づけます。

## 設定ファイル `metatron.config.json`(任意)

リポジトリのルート直下に置くと、文書のパスと注入の挙動を変えられます。**無くても構いません。** その場合は全項目が既定値で動き、警告も出ません。

```json
{
  "version": 1,
  "paths": {
    "architecture": "docs/ARCHITECTURE.md",
    "gotchas": "docs/GOTCHAS.md"
  },
  "injection": {
    "enabled": true,
    "gotchasRecentCount": 5,
    "maxChars": 9000
  }
}
```

上の内容は既定値そのものです。`paths.*` が 2 文書の位置、`injection.enabled` が注入の有効・無効、`injection.gotchasRecentCount` が全文で注入する直近エントリ数、`injection.maxChars` が注入全体の文字数上限です。

- パスは設定ファイルのある位置(git リポジトリルートにフォールバック)からの**相対パス**です。絶対パスとルート外へ出るパスは拒否され、その項目だけ既定値に戻ります。
- 環境変数によるパス指定はありません。共有資産の位置は、リポジトリにコミットされる場所で宣言します。
- 壊れた JSON や未知の `version` でも停止せず、既定値で動作します。

## 他プラグインとの関係

### Codiel

Codiel は **metatron が無くても動きます。** `/codiel:init` はドメイン分割だけを聞き取って最小の ARCHITECTURE を自前で生成するフォールバックを持ちます。metatron を併用すると、`/metatron:init` がシステム概要・レイヤー構造・テスト方針・ADR まで含む豊かな前提を作り、Codiel はそれをそのまま利用します。両者が共有するのはファイルの書式だけで、Codiel が metatron のインストール位置を参照することはありません。

### sandalphon

sandalphon の ASIS 探索が ARCHITECTURE と GOTCHAS を材料に使います。ドメインマップは探索スコープの決定にも使えます。こちらもファイルを直読するだけで、metatron の CLI には依存しません。

## 文書の置き場

- `README.md`(このファイル): 利用者が読まなければこのプラグインを使えない情報
- `docs/rationale.md`: 設計根拠(MCP サーバー化を撤回した経緯を含む)
- `references/`: AI が実行時に読む正本(ARCHITECTURE / GOTCHAS の書式、設定スキーマ、CLI の使い方、執筆規律)
