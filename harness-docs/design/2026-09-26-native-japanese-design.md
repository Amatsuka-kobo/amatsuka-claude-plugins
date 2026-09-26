# native-japanese プラグイン 設計書

- 作成日: 2026-09-26
- ステータス: ユーザー承認済み(2026-09-26)
- 更新基準: 実装開始後に本書を更新するのは、(a) 本書の 2 箇所が両立しないと実装中に判明したときの解消と、(b) 実装のほうが正しいと判断した箇所への追随(理由を添える)に限る。設計判断を変える必要が出たときは実装を止め、ユーザーに確認する。
- 対象プラグイン: `plugins/native-japanese/`(新規。`0.1.0-dev`)、`plugins/agent-policy/`(文書規律の撤去。`0.20.0-dev` から上げる)
- 前提資料:
  - `harness-docs/ARCHITECTURE.md`(レイヤー構造、依存方向、ディレクトリ構成、ドメインマップ)
  - `.claude/rules/metatron/conventions.md` / `testing-policy.md` / `protected-paths.md`
  - `plugins/prefetch/`(同型の小さな hook スクリプト。`build.ts` / `package.json` / `hooks/hooks.json` / `src/check-prefetch-manifest.ts`)
  - `plugins/agent-policy/src/hooks/session-start.ts` / `subagent-start.ts`(`hookSpecificOutput` の出力形式)
  - `plugins/agent-policy/references/orchestration-discipline.md`、`assets/roles/{ja,en}/_common.md`、`src/agents/compose.ts`、`src/agents/vocabulary.ts`、`src/agents/__test__/compose.test.ts`
  - 派生元 coji/natural-japanese v1.5.0 の `LICENSE`、`README.md`、`skills/natural-japanese/references/` の `writing-constitution.md` / `forbidden-patterns.md` / `translationese.md` / `readability-principles.md`

---

## 1. 背景・目的

### 1-1. 何をするか

AI が日本語で書くものには、決まった癖が出る。前置きから入る、見出しがラベルだけになる、「〜することができる」のような翻訳調が混ざる、「重要なのは〜」で締める、といったものである。本プラグインは、これらを避ける規律を毎セッションの冒頭と、サブエージェントの起動時に注入する。対象は日本語で書く出力のすべてで、ユーザーとの会話、コード内のコメント、コミットメッセージ、文書を含む。

### 1-2. なぜスキルでなく hook 注入か

スキルは、description が発火したときにしか本文が読まれない。会話の返答やコミットメッセージを書く場面では、書き手が「文書を書いている」と意識しないため発火しにくい。本プラグインが防ぎたい癖は、まさにその無意識の出力に出る。

hook の `additionalContext` なら、発火条件を持たずに毎回届く。SessionStart は matcher を省くと startup・resume・clear・compact・fork のすべてで発火するため、コンテキストの圧縮後にも規律が戻る。SubagentStart で同じ本文を渡せば、サブエージェントの出力にも同じ規律がかかる。

### 1-3. 派生元との関係

派生元の coji/natural-japanese v1.5.0(MIT)は、文書を作るときに呼び出す工程スキルである。設計・執筆・検査・収束の工程を回し、lint スクリプトで癖を機械的に拾う。

本プラグインは工程を持たない。派生元の文体憲法・禁止語・翻訳調・読みやすさの原則から、書く瞬間に当てられる規律だけを抜き出し、常駐の生成時制約として再構成する。派生元と併用してもよく、その場合は本プラグインが下地になり、文書を仕上げる工程は派生元が担う。

---

## 2. スコープ / 非スコープ / 前提とする制約

### 2-1. スコープ

- `plugins/native-japanese/` の新設(配布宣言、hook、注入スクリプト、規律文書、README、LICENSE)
- ワークスペース・marketplace・ルート README への登録
- agent-policy からの文書規律の撤去(§8)と、本リポジトリの Agent 定義の再生成

### 2-2. 非スコープ

- 英語の出力に対する規律
- 検査スクリプト(lint など)の同梱
- 設計・執筆・検査・収束の工程
- 文書タイプ別の型(doctype)、採点(score)、文体プロファイル(style-profile)、6 軸ルーブリック
- スキルを持たないため、description の発火測定

### 2-3. 前提とする制約

- hook 1 件の `additionalContext` が 10,000 文字を超えると、Claude Code は全文をファイルへ退避し、モデルにはそのポインタだけを渡す(Claude Code 2.1.283 の実装。閾値はフック 1 件ごとで、他プラグインとの合算ではない)。退避されると規律は読まれなければ効かない。agent-policy の SubagentStart は上限を 9,500 文字に置いている(`subagent-start.ts:16`)。本プラグインは `discipline.md` を 9,000 文字以内に収め、テストで守る(§4-4)。
- ARCHITECTURE のレイヤー規則に従う。hook は配布物(`scripts/inject.mjs`)を実行し、配布物は参照層(`references/discipline.md`)を実行時に読む。
- 指示層と参照層には他プラグインの名前を書かない(ARCHITECTURE「禁止される依存方向」)。`discipline.md` に派生元の名前は入れない。
- `plugins/*/scripts/` はバンドル出力であり手で編集しない。`src/` を変えて `pnpm run build` で作り直す。

---

## 3. 全体像

構成要素は 3 つだけで、それぞれの役割は重ならない。

| 構成要素 | 役割 |
| --- | --- |
| `hooks/hooks.json` | SessionStart と SubagentStart の両方で `scripts/inject.mjs` を起動する |
| `scripts/inject.mjs`(元は `src/inject.ts`) | 入力のイベント名を読み、`discipline.md` の本文をそのイベント名で `additionalContext` に載せる |
| `references/discipline.md` | 規律の本体。注入スクリプトは中身を解釈せず、全文をそのまま渡す |

規律の文言を直すときは `discipline.md` だけを編集すればよく、ビルドは要らない。スクリプトが本文を読むのは実行時だからである。

他の口調指示との関係は層で整理する。`discipline.md` は基底の層として働く。敬体か常体か、圧縮した口調か、体言止めを許すか、といった口調と文体を別の指示(CLAUDE.md、output style、他プラグインの注入)が決めているときは、その項目だけが上書きされる。上書きされなかった項目、たとえば翻訳調の言い換えや結論を先に書く規律は有効のまま残る。この宣言は `discipline.md` の冒頭(§6 の節 1)に書く。

---

## 4. プラグイン構成

### 4-1. ディレクトリとファイル

```
plugins/native-japanese/
├── .claude-plugin/plugin.json
├── hooks/hooks.json
├── references/discipline.md
├── src/
│   ├── inject.ts
│   ├── __test__/inject.test.ts
│   └── testing/run-ts.ts
├── scripts/inject.mjs          (ビルド出力)
├── build.ts
├── package.json
├── README.md
└── LICENSE
```

### 4-2. 各ファイルの内容

**`.claude-plugin/plugin.json`**: `name` は `native-japanese`、`version` は `0.1.0-dev`。`description` は機能を短く述べる。派生元の名前は入れない。

**`hooks/hooks.json`**: `description` を置き、`SessionStart` と `SubagentStart` にそれぞれ 1 件ずつコマンドを登録する。どちらも `matcher` を持たない。コマンドは `node "${CLAUDE_PLUGIN_ROOT}/scripts/inject.mjs"`、`timeout` は 10 とする。書式は `plugins/prefetch/hooks/hooks.json` と `plugins/agent-policy/hooks/hooks.json` に揃える。

**`src/inject.ts`**: §5 の契約を満たす単一のスクリプト。依存は `node:fs` と `node:path` と `node:url` だけで、ほかのモジュールを import しない。標準入力の読み方は `plugins/prefetch/src/check-prefetch-manifest.ts:6-12` の `fs.readFileSync(0, "utf8")` に倣う。

**`build.ts`**: `plugins/prefetch/build.ts` と同じ形で、`entryPoints` を `{ inject: "./src/inject.ts" }` にする。

**`package.json`**: `name` は `native-japanese-scripts`、`version` は `plugin.json` と同じ `0.1.0-dev`。`private: true`、`type: "module"`、`scripts.build` は `tsx build.ts`。形は `plugins/prefetch/package.json` に揃える。

**`references/discipline.md`**: 規律の本体。§6 の節構成で書く。

**`README.md`**: 利用者が読まないと使えない情報に絞る。何が注入されるか、どのイベントで届くか、他の口調指示との関係(§3 の層の説明)、無効にする方法(プラグインを無効化する)、「由来」節(§7)を置く。

**`LICENSE`**: §7 のとおり。

### 4-3. ワークスペースへの登録

- `pnpm-workspace.yaml` の `packages` に `plugins/native-japanese` を加える。現在の末尾は `plugins/jevriel`。変更後に `pnpm install` を実行し、`pnpm run build` を通す(protected-paths)。
- `.claude-plugin/marketplace.json` の `plugins` 末尾(現在は `jevriel`)に `name` / `source` / `description` を加える。`description` は `plugin.json` と同じ文にする。
- ルート `README.md` の「配布プラグイン」表(`README.md:44` の節)に 1 行を加え、ステータスは「開発中」とする。表の後に続くプラグイン別の説明節にも 1 節を加える。

### 4-4. テストの配置

testing-policy に従い、テストは `src/__test__/inject.test.ts` に置く。hook スクリプトの契約は標準入力・標準出力・exit code なので、tsx で子プロセスとして起動して検証する。この起動補助 `src/testing/run-ts.ts` は、hook や CLI を持つ 9 プラグイン(agent-policy、chat-history、codiel、gh-utility、guidepost、metatron、pitcrew、raphael、sandalphon)が同一実装を持つリポジトリ共通の型であり、他プラグインの `src/` を import できないため(ARCHITECTURE)、本プラグインも同じ内容を独立に持つ。

`runTs` は tsx で `src/inject.ts` を直接起動する。`src/` と `scripts/` はどちらもプラグインルートの 1 階層下にあるため、`import.meta.url` から `../references/discipline.md` を解決する処理は、ビルド前のソースでもバンドル後でも同じ場所を指す。

テストケースは次のとおり。

| ケース | 入力 | 期待 |
| --- | --- | --- |
| SessionStart | `{"hook_event_name":"SessionStart"}` | `hookEventName` が `SessionStart`、`additionalContext` が `discipline.md` の全文と一致、exit 0 |
| SubagentStart | `{"hook_event_name":"SubagentStart"}` | `hookEventName` が `SubagentStart`、`additionalContext` が全文と一致、exit 0 |
| イベント名なし | `{}` | stdout が空、exit 0 |
| 未知のイベント名 | `{"hook_event_name":"Stop"}` | stdout が空、exit 0 |
| stdin 不正 | `not json` | stdout が空、exit 0 |
| ファイル不在 | 一時ディレクトリに `src/inject.ts` だけを複製して起動 | stdout が空、exit 0 |
| 空白だけの本文 | 一時ディレクトリに `src/inject.ts` と、空白と改行だけの `references/discipline.md` を置いて起動 | stdout が空、exit 0 |
| 文字数の上限 | `discipline.md` を読む | 9,000 文字以下 |

ファイル不在と空白だけの本文のケースは、スクリプトを一時ディレクトリの `src/` へ複製し、`references/` を置かない、または空白だけの `discipline.md` を置いて起動して作る。本番のパス解決をそのまま使えるので、パスを差し替える環境変数を足さずに済む。

---

## 5. `inject` の契約

### 5-1. 入力

標準入力から hook の入力 JSON を受け取る。読むのは `hook_event_name` だけで、ほかのフィールドは見ない。

### 5-2. 出力

`hook_event_name` が `SessionStart` か `SubagentStart` のとき、次の 1 行を stdout に書いて exit 0 で終わる。

```json
{"hookSpecificOutput":{"hookEventName":"<入力の hook_event_name>","additionalContext":"<discipline.md の全文>"}}
```

`hookEventName` には入力の値をそのまま入れる。固定値にしないのは、同じスクリプトを 2 つのイベントで共用するためである。本文は加工せず、読んだ文字列をそのまま渡す。出力の組み立ては `JSON.stringify` に任せ、末尾に改行を付ける(`session-start.ts:233-241` と同じ形)。

### 5-3. 異常時の振る舞い

次のどの場合も、stdout に何も書かず exit 0 で終わる。stderr にも書かない。規律が届かないことはセッションを止める理由にならないからである。

- 標準入力が空、または JSON として読めない
- `hook_event_name` が無い、文字列でない、`SessionStart` と `SubagentStart` のどちらでもない
- `discipline.md` が無い、または読めない
- `discipline.md` の中身が空白だけ

パスは `import.meta.url` を起点に解決する。`scripts/inject.mjs` から見て `../references/discipline.md` を読む。`CLAUDE_PLUGIN_ROOT` には頼らない。テストから起動するときにこの変数が無いためである。

---

## 6. `discipline.md` の節構成と各節の項目

ここでは節の構成と、各節に入れる項目を定める。本文は実装時に prompt-smith の規律で書く。目標は 120〜180 行、9,000 文字以内とする。

根拠・実測値・出典・経緯は載せない(prompt-smith の削る基準)。派生元の名前も書かない。節 4 と節 5 は「引くための記述」として表にし、重複・例の基準を当てない。

### 節 1. 適用範囲

- 日本語で書く出力のすべてに適用する。会話、コード内のコメント、コミットメッセージ、文書を含む。
- 基底層であることの宣言。口調と文体(敬体と常体、圧縮した口調、体言止めなど)を指定する別の指示があれば、その項目だけを上書きさせる。それ以外の規律は有効のまま残す。

### 節 2. 構成の規律

派生元の文体憲法 12 箇条から、書く瞬間に当てられる条を抜き出す。

- 前置きを書かず、結論を先に書く。
- 見出しには結論を含める。
- 箇条書きは項目が本当に並列なときだけ使う。因果と経緯は地の文で書く。
- 用語は、機能を説明してから名前を渡す。
- 固有名詞・数値・実例で接地する。
- 太字は文中の核 1 箇所に限る。
- 重要な節は厚く、軽い節は軽く書く。
- 同じ鋳型を 3 回続けない。
- 「〜ではなく」は、実際にある誤解を正すときだけ使う。
- 確信度は【要確認】などのラベルで書き分け、語尾でぼかさない。
- 事実と意見を分ける。
- 結びは要約の繰り返しにせず、全体を再統合する。

### 節 3. 文の規律

派生元の読みやすさの原則から抜き出す。

- 長い修飾語を先に置き、短い修飾語を被修飾語の直前に置く。
- 読点は統語の切れ目に打つ。
- 一文に一つの内容を書く。長さは 40〜60 字を目安にする。
- 主語と述語を近づける。
- 連体修飾を重ねず、文を割る。
- 段落の先頭に、その段落の主題を述べる文を置く。
- 文末の形を単調にしない。
- 接続詞がどこまでを受けるか(射程)を明確にする。

派生元の「読者の 3 軸」は、個々の規律を判断する理由にあたるため載せない。

### 節 4. 翻訳調の言い換え

表にする。1 行に 1 パターンを置き、Before と After を 1 組ずつ添える。

| パターン |
| --- |
| 無生物主語 + 他動詞 |
| 〜することができる |
| 〜という観点から |
| 〜にとって重要 |
| 〜を持つ |
| 〜することによって |
| 〜に他ならない |
| ダッシュで挟む挿入句 |
| cleft 構文(「それは〜である。なぜなら〜」) |

派生元の「連体修飾の入れ子」は語の言い換えではなく文の組み立ての規律なので、節 3 に置く。

### 節 5. 避ける語

表にする。列は「分類」と「語」の 2 つで、語を列挙するだけにし、避ける理由は書かない。分類は次の 9 つとする。派生元の「正面から系」は「空虚な形容・動詞」に吸収し、「拡張リスト」の語は該当する分類へ振り分ける。

| 分類 |
| --- |
| まとめ口調 |
| 過剰な強調 |
| 空疎な接続 |
| 予防線 |
| 三点構成・数の宣言 |
| 空虚な形容・動詞 |
| 決め文 |
| 水増しの講釈 |
| 感嘆・共感の演出 |

派生元の禁止語カタログのうち、次の 4 つは節 5 に置かない。「対比の多用」は節 2 の「〜ではなく」の規律が受け持つ。「段落構造の均質化」は節 2 の濃淡の規律が受け持つ。「体言止め・断定的箇条書きの過用」は口調の層に属し、本プラグインの管轄外とする。「語彙の使い回し」は語の列挙で表せないので落とす。

### 節 6. 訳語

agent-policy の「文書の執筆」節から移す。

- 直訳せず、日本語の慣用に合わせて意訳する。
- Version は単に「版」とせず、「確定版」「新しいバージョン」などから選ぶ。
- テスト結果の Green / Red は「パス」「失敗」と書く。
- Frozen Document は「確定版の文書」と書く。
- Ledger は用途に応じて「一覧」「管理表」「ログ」と書き分ける。
- Step は「Step」または「ステップ」と書く。

---

## 7. 帰属とライセンス

- 本プラグインのライセンスは、派生元と同じ MIT License とする。
- `plugins/native-japanese/LICENSE` は MIT License の本文 1 通とし、著作権表示を 2 行置く。1 行目は `Copyright (c) 2026 amatsuka-koubou`、2 行目は派生元の `Copyright (c) 2026 coji` とし、2 行目の末尾に派生部分(`references/discipline.md`)を指す短い注記を添える。これで MIT が求める著作権表示と許諾文の同梱を満たし、別ファイルは要らない。
- `NOTICE` は作らない。MIT に NOTICE の仕組みは無い。
- README の「由来」節には、coji/natural-japanese v1.5.0(MIT)の文体憲法・禁止語・翻訳調・読みやすさの原則を、常時適用の規律へ再構成したことを書く。派生元のリポジトリへのリンクを添える。
- 派生元の名前を書くのは `LICENSE` と README の「由来」節だけとする。`discipline.md`、`plugin.json` と `marketplace.json` の `description`、README の説明文には書かない。

---

## 8. agent-policy からの文書規律の撤去

### 8-1. 撤去する理由と帰結

agent-policy は、オーケストレーター向けの規律と各 Agent 定義の共通断片の両方に、文書の書き方を持っている。本プラグインが SessionStart と SubagentStart の両方で同じ種類の規律を届けるため、残すと二重になる。訳語の 5 項は `discipline.md` の節 6 へ移る。

帰結として、英語で書かれた Agent 定義からは文体の規律が無くなる。これは承認済みの割り切りである。

### 8-2. 削る箇所

| ファイル | 削る箇所 |
| --- | --- |
| `plugins/agent-policy/references/orchestration-discipline.md` | 「### 文書の執筆」節(72-82 行) |
| `plugins/agent-policy/assets/roles/ja/_common.md` | 「## 文書の執筆」節(27-38 行) |
| `plugins/agent-policy/assets/roles/en/_common.md` | 「## Writing」節(27-33 行) |
| `plugins/agent-policy/src/agents/compose.ts` | 執筆節を合成する分岐(82-84 行) |
| `plugins/agent-policy/src/agents/vocabulary.ts` | `Vocabulary` の `writingHeading`(7 行)と、JA・EN の値(19 行、32 行) |
| `plugins/agent-policy/src/agents/__test__/compose.test.ts` | 「執筆の節を Agent の有無にかかわらず一度だけ出す」(211-223 行)と「英語の定義でも執筆の節を出す」(225-229 行)を削る。「節の順序が仕様どおりになる」(192-209 行)は配列から `"## 文書の執筆"` を外す |

`orchestration-discipline.md` の「### 文書の執筆を委譲するとき」節(84-92 行)は残す。これは依頼文の書き方の規律であり、文体の規律ではない。

### 8-3. 追随させる箇所

- `plugins/agent-policy/.claude-plugin/plugin.json` と `package.json` の `version` を、揃えてパッチで上げる(`0.20.0-dev` から `0.20.1-dev`)。
- `.serena/memories/agent_policy/core.md:116-120` は、`_common.md` が「## 文書の執筆」「## Writing」を持ち `compose()` が出力すると書いている。撤去後の事実に合わせ、Serena の `edit_memory` で直す。
- `plugins/agent-policy/README.md` の 0.19 系から 0.20 系への移行リストにある「執筆基準は全定義の共通部分に含まれ、再生成で反映されます」の 1 文を削る。同じリストに、文書規律を撤去したことと再生成の注意(§8-4)を 1 項として足す。`docs/` は無い。

### 8-4. Agent 定義の再生成

本リポジトリの `.claude/agents/` にある 14 の定義は、どれも「## 文書の執筆」節を持っている。撤去後の断片から `plugins/agent-policy/scripts/setup-agents.mjs` で作り直す。手順は GOTCHAS の GOTCHA-001 に従う。

`setup-agents.mjs` は `vocabulary.ts` をインラインで含むバンドルなので、§8-2 の撤去を `src/` に施しただけでは「## 文書の執筆」を出し続ける。再生成は、撤去後に `pnpm run build` を通してから行う。

1. §8-2 の撤去を終え、`pnpm run build` を実行し、`scripts/setup-agents.mjs` に `writingHeading` が残っていないことを grep で確かめる。
2. `.claude/agents/` を別ディレクトリへ複製する。このディレクトリは `.gitignore` の対象で、git では戻せない。
3. `--check` を実行し、応答の `mcpCurrent.denyTools` を控える。あわせて、14 定義すべてで、テンプレートとの差分が「## 文書の執筆」節の有無だけであることを確かめる。ほかの差分があれば、その定義は再生成せず、手で節を削る。
4. `--merge` を付けずに `--write` で上書きする。`--merge` は既存ファイルにだけある節を末尾に残す(`setup-agents.ts` の `automaticKeep` が `sectionsOnlyInExisting` を保持対象にする)ため、撤去した節が消えない。`--mcp-servers` を渡すときは、同じコマンドに控えた値を `--mcp-deny` として渡す。
5. 生成後に複製との差分を取る。消えてよいのは「## 文書の執筆」節の行だけで、それ以外に削除行が無いことを確かめる。

---

## 9. 検証と Done の条件

### 9-1. 検証

- `pnpm run test` で §4-4 のケースと、変更後の `compose.test.ts` がパスする。
- 新しいセッションを起動し、SessionStart の注入に `discipline.md` の本文が入っていることを目視で確かめる。`/clear` と `/compact` の後にも入ることを確かめる。
- サブエージェントを 1 体起動し、SubagentStart の注入に本文が入っていることを目視で確かめる。
- hooks.json の変更は全セッションの挙動を変えるため、この 2 つの目視確認を省かない(protected-paths)。

### 9-2. Done の条件

- `pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build` が通る。
- `plugins/native-japanese/scripts/inject.mjs` と、agent-policy の `scripts/` の差分が、それぞれ対応する `src/` の変更と同じコミットにある。
- native-japanese の `plugin.json` と `package.json` が `0.1.0-dev` で揃っている。agent-policy の 2 ファイルが同じ値へ上がっている。
- ルート README の表と説明節、`marketplace.json`、`pnpm-workspace.yaml` に native-japanese が登録されている。
- ARCHITECTURE への影響を確かめる。ARCHITECTURE はプラグインの一覧を持たず、本プラグインは既存のレイヤー規則の範囲に収まる。影響が見つかったときだけ `/metatron:update` で追随させる。
- `.serena/memories/agent_policy/core.md` が撤去後の事実と一致している。
- コミットは「native-japanese の新設」と「agent-policy からの撤去」の 2 つに分ける。Agent 定義の再生成は `.claude/agents/` が git の管理外(`.gitignore:14`)のため、コミットを生まない。

---

## 10. 不採用案

| 案 | 採らなかった理由 |
| --- | --- |
| SKILL.md 1 枚のスキルとして配布する | description が発火したときにしか読まれず、会話やコミットメッセージのように文書を書く意識の無い場面を取りこぼす。 |
| CLAUDE.md の指示に任せる | プロジェクトごとに書き写す必要があり、規律を直したときに全プロジェクトへ行き渡らない。サブエージェントに届くかどうかも定義しだいになる。 |
| 「スキルを使え」だけを注入する | 規律の中身が届くかどうかがスキルのロードに左右され、ロードを飛ばされたときに何も効かない。ロードの分だけ手番も増える。 |
| hooks.json に awk 一行で本文を出力させる | JSON のエスケープとイベント名の追随をシェルで正しく書くのが難しく、テストもできない。 |
| 英語版の「## Writing」を残す | 本プラグインは日本語だけを扱うので、英語版だけを残すと agent-policy に文体規律の置き場が二つ残る。英語での出力の規律は割り切ると決めている。 |
| ライセンスを Apache-2.0 にする(prompt-smith に揃える) | prompt-smith が Apache-2.0 なのは移植元がそのライセンスだったためで、本プラグインには同じ制約が無い。MIT の派生元に Apache-2.0 を重ねると MIT 全文の併記が要り、デュアルライセンスと誤読される。特許条項は規律文書と小さなスクリプトに実益が無い。 |

---

## 11. 未解決事項

- 本リポジトリの `CLAUDE.md` は、全文書で派生元スキルの使用を指示している。本プラグイン導入後にこの指示を残すかどうかはユーザーが決める。本書の範囲外とする。
