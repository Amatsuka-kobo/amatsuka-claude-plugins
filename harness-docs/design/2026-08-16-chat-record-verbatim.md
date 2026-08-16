# chat-history: AI 発言を原文で記録する

- 日付: 2026-08-16
- 対象プラグイン: `plugins/chat-history`
- 状態: 設計（実装前）

## 背景と問題

`docs/chat/` の記録は、粒度契約として「ユーザーの発言 = 原文、AI の発言 = 構造化された要約」という非対称を採ってきた。要約は chat-recorder サブエージェント（haiku）が生成する。

この構成には、要約が原文から乖離しても検知できないという欠陥がある。実例として `docs/chat/2026/0815/phyllis998/context7-github-serena-mcp-investigation.md:20` は Serena を「このリポジトリ内で構成される AI ツール」と記述しているが、Serena は外部プロジェクト（oraios/serena）であり、事実と異なる。会話の原文は失われているため、記録だけからは誤りと判定できない。

生ログ（transcript JSONL）はローカル限定で消えるため、`docs/chat/` はリポジトリに残る唯一の会話記録である。要約の誤りはそのまま歴史として固定される。

## 目的

AI の発言を、transcript の原文のまま記録する。要約を生成する経路そのものを本文から取り除き、記録内容が LLM の解釈を経ないようにする。

あわせて、記録から Tool 使用行（`(tool: ...)`）を削除する。

## 非目標

- 既存記録の再生成。過去分の transcript は既に存在せず、原文の復元は不可能である。旧形式のまま残す
- `thinking` ブロックの記録。対象は assistant の `text` ブロックのみとする
- chat-recorder の実行形態の変更。バックグラウンド起動・`model: haiku` は据え置く

## 方針

本文の生成を LLM から外し、スクリプトの決定的処理に移す。chat-recorder が書くのは、要旨・索引・ヘッダーという短いメタ情報だけに限定する。

代替案として「chat-recorder に原文をそのまま転記させる」形も検討したが、採らない。長文の転記で LLM は省略・言い換えを起こすため、本文が LLM の出力である限り、今回の問題は同じ経路で再発する。

## 設計

### 1. 責務分担

| 担当 | 生成物 |
| --- | --- |
| `prepare-chat-recording` | `bodyFile` — 原文本文（USER 引用ブロック + AI 原文）。セッション番号の確定も行う |
| chat-recorder (haiku) | `sessionTitleFile` — セッション要旨 1 行<br>`indexLineFile` — INDEX 1 行<br>`headerFile` — 新規ファイル時のみ、タイトルとメタ情報の箇条書き |
| `commit-chat-recording` | 上記を結合して記録ファイルへ書き込み、INDEX.md を更新 |

chat-recorder は `bodyFile` を読み書きしない。本文への改変経路が構造上存在しない状態を作る。

chat-recorder の出力は最大でも数行になるため、`model: haiku` の妥当性はむしろ上がる。

chat-recorder はセッション要旨とヘッダーメタを書くために会話内容を必要とする。そのため `prepare` が返す JSON の `conversation` フィールドは従来どおり保持し、chat-recorder への入力とする。chat-recorder はこれを読んで要旨を書くだけで、本文として転記しない。入力トークンは従来と変わらず、削減されるのは出力トークンである。正確性の確保が目的であり、コスト削減は副次的な効果として扱う。

`prepare` は `conversation` を JSON で返すのと同時に、同じ内容を `bodyFile` へ書き出す。chat-recorder は `bodyFile` を読み書きしない。

### 2. `extract-conversation.ts`

- `tool_use` の分岐と `MAX_TOOL_HINT` 定数を削除する。`(tool: ...)` 行は出力されなくなる
- 出力見出しを `## USER` / `## ASSISTANT` から、記録形式の `# <workerName>` / `# AI` に変更する。従来 chat-recorder が担っていた見出しの変換を機械化する
- `workerName` を引数で受け取る。`prepare` が `git config user.name` から得た値を渡す
- `thinking` は従来どおり抽出対象外とする
- USER 発言の引用ブロック化（`quote`）は現状のまま維持する

### 3. 記録フォーマット（`skills/chat/SKILL.md`）

- 粒度契約を「非対称」から「ユーザー・AI とも原文」に反転する。ユーザー発言は引用ブロック、AI 発言は地の文で原文とし、両者の区別は `# <ユーザー名>` / `# AI` の見出しが担う
- 「AIの発言 = 構造化された要約」の 4 スロット（何をしたか / 決定と理由 / 却下された選択肢 / 失敗・やり直し・誤った前提）の節を削除する。原文がこれらを内包する
- 「網羅性の明記」の節を削除する。要約を書かなくなるため対象がなくなる
- ファイル末尾の「注意事項と次の作業」の節を廃止する。追記のたびに末尾へ追加される結果、実際の記録では本文の途中に散らばっており（`docs/chat/2026/0815/phyllis998/context7-github-serena-mcp-investigation.md:60,82`）、末尾セクションとして機能していない。持ち越し事項は原文中に残る
- 代わりに、セッション要旨と INDEX 要旨の書き方を明文化する。これが chat-recorder の唯一の生成物になるため、契約として具体化する必要がある

`docs/rationale.md` の「ユーザー発言を原文で残す理由」「引用ブロックと地の文を対応させる理由」は、今回の反転に合わせて更新する。

### 4. `agents/chat-recorder.md`

- 「AI パートの粒度」節を全面的に置き換える。記述対象を、セッション要旨・INDEX 要旨・ヘッダーメタの書き方に限定する
- 手順 3 の Write 対象を `bodyFile` / `indexLineFile` から `sessionTitleFile` / `indexLineFile` / `headerFile`（新規時のみ）へ変更する
- 「`bodyFile` を読まない・書かない」を厳守事項として明記する

### 5. 検証条件とサイズ上限（`commit-chat-recording.ts`）

`validateInputs` を、結合前の `bodyFile` ではなく結合後の文字列を対象にする形へ変更する。

- `body.includes("## セッション")`（追記時のセッション見出し必須）→ 見出しは `commit` が生成するため、結合後の文字列に対する検証へ移す
- `updatedRecord.endsWith(input.body)`（書き込み検証）→ 結合後の文字列に対する検証へ変更する
- `body.includes("> ")`（USER 引用ブロック必須）→ 維持する。`extract` 生成物なので構造的に満たす
- 本文サイズ上限 1MB → 8MB へ引き上げる。原文をそのまま載せると 1MB 超が起こりうる。切り詰めは今回の目的に反するため、上限を上げる方を採る
- `indexLine` の 1 行制約・8KB 上限は維持する

新しい入力ファイルの検証条件を加える。

- `sessionTitleFile`: 空でないこと、改行を含まないこと、512 バイト以内であること
- `headerFile`: `appendMode = false` のとき必須とし、`appendMode = true` のときは受け取らない。先頭行が `# ` で始まること、64KB 以内であること

結合の形は次のとおり。

- `appendMode = true`: `\n## セッション <N>: <sessionTitle>\n\n` + 本文
- `appendMode = false`: ヘッダー + `\n---\n\n## セッション 1: <sessionTitle>\n\n` + 本文

`<N>` は `prepare` が `lastSessionNumber + 1` として確定し、plan に書く。従来 chat-recorder の判断だったものを決定的処理に移す。

### 6. 一時ファイルの掃除

一時ファイルは `tempDir`（`~/.claude/chat-history/chat-recorder/<projectKey>/temp/`、Claude 設定ディレクトリと衝突する環境では `$TMPDIR/chat-history-recorder-<uid>/<projectKey>/temp/`）に置かれる。リポジトリ外・git 管理外である。

現状、commit 成功時には `bodyFile` / `indexLineFile` / `planPath` / `lockPath` が削除されるが、失敗時は残り、これを掃除する経路がない。`headerFile` の追加で孤児の種類が 1 つ増えるため、あわせて掃除を入れる。

- `prepare` の冒頭（lock 検証の通過後）で、`tempDir` 内の `<sessionKey>-` で始まり現在の `attemptId` を含まないファイルを削除する。対象は自セッション分のみとし、他セッションの一時ファイルには触れない
- `commit` 成功時の削除リストに `headerFile` を加え、5 本（`bodyFile` / `indexLineFile` / `headerFile` / `planPath` / `lockPath`）とする
- 削除の失敗は無視する。記録本体の成否に影響させない

## 影響範囲

改修対象:

- `src/extract-conversation.ts` と `src/__test__/extract-conversation.test.ts`
- `src/prepare-chat-recording.ts` と `src/__test__/prepare-chat-recording.test.ts`
- `src/commit-chat-recording.ts` と `src/__test__/commit-chat-recording.test.ts`
- `skills/chat/SKILL.md`
- `agents/chat-recorder.md`
- `docs/rationale.md`
- `README.md`（プラグイン）とルートの `README.md`

`pnpm build` で `scripts/` を再生成し、生成物の差分も同じコミットに含める。

バージョンは記録フォーマットの契約変更のためマイナーを上げ、`plugins/chat-history/.claude-plugin/plugin.json` と `plugins/chat-history/package.json` を同じ値に揃える。

実装の最初に確認すべき点として、`agents/chat-reader.md`・`skills/recall/SKILL.md`・`skills/resume/SKILL.md` が「AI パート = 要約」を前提にした記述を持つかを調べる。持つ場合は、旧形式と新形式が混在する前提の記述へ改める。

## 検証

- 単体テスト: `extract-conversation` が `tool_use` を出力しないこと、見出しが `# <workerName>` / `# AI` になること、`commit` が結合後の文字列で検証を行うこと、`prepare` が孤児ファイルを掃除すること
- 実機確認: このリポジトリで実際に記録を 1 往復させ、`docs/chat/` の新規記録に AI 原文がそのまま載り、`(tool: ...)` 行が消えていることを確認する
- `pnpm lint` / `pnpm typecheck` / `pnpm test` を通す

## 移行

既存の `docs/chat/` 記録（INDEX.md 74 行分）は旧形式のまま残す。日付で新旧が分かれるため、追加の印は付けない。
