# agent-policy 同梱エージェント化と自動注入 設計書

作成日: 2026-08-16
対象プラグイン: `plugins/agent-policy`
現行バージョン: 0.6.0-dev → 0.7.0-dev

## 1. 背景と目的

現行の agent-policy は、GPT / Grok のエージェント定義を `setup-gpt` / `setup-grok` スキル経由でプロジェクトの `.claude/agents/` へ生成する。利用者はプロジェクトごとにウィザードを回す必要があり、方針スキルの選択も「どの定義ファイルが存在するか」に依存している。

本改修の目的は次の 3 点である。

1. エージェント定義をプラグイン同梱で提供し、プロジェクトごとのセットアップ作業をなくす。
2. モデルエイリアスと方針の自動注入を、5 つの環境変数で一元的に運用できるようにする。
3. 現在 `grok-researcher` だけが担っている役割(独立レビュー・リアルタイム情報調査・探索実働)を、`with-codex-policy` と `claude-model-policy` の構成でも使えるようにする。

3 について、Claude 単独構成では「別ベンダーによる独立性」という利点は失われる。それでも最新情報の取得と、レビュー系統を分けた独立レビューには価値があると判断した。

## 2. 事前検証で確定した制約

Claude Code 2.1.233 上で、ヘッドレス実行(`claude -p`)を使って実測した。

| 検証項目 | 結果 |
| --- | --- |
| Agent 定義 frontmatter の `model` に `${VAR}` を書く | 展開されない。リテラルのまま API へ渡り `400 unknown provider for model ${...}` |
| `plugin.json` の `agents` に `${CLAUDE_PLUGIN_DATA}/...` を書く | 展開されず、その定義はエージェントとして登録されない |
| SessionStart フックが生成した `.claude/agents/*.md` | 同一セッションでは読み込まれない。同じファイルが残った次セッションでは読み込まれる |
| `CLAUDE_PLUGIN_DATA` の実体 | `~/.claude/plugins/data/<plugin>-<marketplace>`。hook プロセスには渡る |

ここから 2 つの帰結が出る。

- 同梱エージェントの `model` は**リテラル固定でしか書けない**。環境変数でエイリアスを差し替えるには、プロジェクトの `.claude/agents/` へ定義を生成するほかない。
- 生成した定義が効くのは**次セッションから**である。生成が発生したセッションでは、その旨を利用者と Claude に伝える必要がある。

## 3. 全体像

- エージェント 7 種をプラグインに同梱する。`model` には既定エイリアスをリテラルで書く。
- 環境変数が既定エイリアスと一致する利用者は、追加設定なしで同梱定義をそのまま使える。
- 環境変数が既定と異なるときだけ、SessionStart フックがプロジェクトの `.claude/agents/` へ上書き定義を生成する。
- 同じフックが `AMATSUKA_AGENT_AUTO_INJECTION` に従って、方針スキルの使用指示を `additionalContext` として注入する。
- `setup-gpt` / `setup-grok` スキルと生成スクリプトは廃止する。

## 4. 環境変数

| 変数名 | 用途 | 既定値 |
| --- | --- | --- |
| `AMATSUKA_AGENT_GPT_SOL_ALIAS` | `gpt-sol` のモデルエイリアス | `claude-gpt-5-6-sol` |
| `AMATSUKA_AGENT_GPT_TERRA_ALIAS` | `gpt-terra` と `gpt-researcher` のモデルエイリアス | `claude-gpt-5-6-terra` |
| `AMATSUKA_AGENT_GPT_LUNA_ALIAS` | `gpt-luna` のモデルエイリアス | `claude-gpt-5-6-luna` |
| `AMATSUKA_AGENT_GROK_ALIAS` | `grok-researcher` と `grok-implementer` のモデルエイリアス | `claude-grok-4-5` |
| `AMATSUKA_AGENT_AUTO_INJECTION` | 注入する方針スキルの選択 | 未設定(= `none`) |

エイリアスはモデル本体の ID ではなく、ProxyAPI サーバーが配信するクライアント側の別名である。

### AMATSUKA_AGENT_AUTO_INJECTION の値

| 値 | 注入する方針スキル |
| --- | --- |
| `claude` | `agent-policy:claude-model-policy` |
| `with-codex` | `agent-policy:with-codex-policy` |
| `with-grok` | `agent-policy:with-grok-policy` |
| `with-codex-grok` | `agent-policy:codex-grok-policy` |
| `none` / 未設定 | 注入しない |
| 上記以外 | 注入しない。値が未知である旨だけを注入する |

注入する文言は次で固定する。`<policy>` を上表のスキル名に置き換える。

```text
最初に必ず agent-policy:<policy> スキルを使用し、この規律に従う
```

## 5. 同梱エージェント

配置は `plugins/agent-policy/agents/<name>.md`。呼び出し名はプラグイン名前空間が付いた `agent-policy:<name>` になる。

frontmatter の `model` には既定エイリアスをリテラルで書く。既定エイリアスはソースにハードコードし、設定ファイルでは管理しない。モデル世代が変わったときは同梱定義とフックの既定値表を同時に更新する。

下表の「エイリアス供給元」列は同梱定義そのものには現れない。SessionStart フックが差分を検知したときに、その環境変数の値で `model` 行を差し替えた定義をプロジェクトへ生成するための対応関係である(§7)。

| 定義 | `model` のリテラル既定 | エイリアス供給元(フック用) | 役割 |
| --- | --- | --- | --- |
| `gpt-sol` | `claude-gpt-5-6-sol` | `..._GPT_SOL_ALIAS` | 複雑または重要な実装 |
| `gpt-terra` | `claude-gpt-5-6-terra` | `..._GPT_TERRA_ALIAS` | 通常の実装・一般作業 |
| `gpt-luna` | `claude-gpt-5-6-luna` | `..._GPT_LUNA_ALIAS` | 軽量な実装 |
| `gpt-researcher` | `claude-gpt-5-6-terra` | `..._GPT_TERRA_ALIAS` | 独立レビュー・リアルタイム情報調査・探索実働(新規) |
| `grok-researcher` | `claude-grok-4-5` | `..._GROK_ALIAS` | 同上(既存を同梱化) |
| `grok-implementer` | `claude-grok-4-5` | `..._GROK_ALIAS` | 通常・軽量の実装、一般作業(既存を同梱化) |
| `claude-researcher` | `sonnet` | なし | 同上(新規) |

- `claude-researcher` はプロキシを必要とせず、どの環境でも起動できる。供給元を持たないため、フックの生成対象にもならない。
- `gpt-researcher` は `gpt-terra` と同じ `AMATSUKA_AGENT_GPT_TERRA_ALIAS` を供給元とする。専用の変数は設けない。この変数を変えると 2 定義がまとめて生成対象になる。
- `gpt-sol` / `gpt-terra` / `gpt-luna` / `grok-researcher` / `grok-implementer` の本文は、現行の `skills/setup-gpt/assets/*.template.md` と `skills/setup-grok/assets/*.template.md` を移設して作る。移設時に `{{MODEL_ALIAS}}` プレースホルダを既定エイリアスのリテラルへ確定させる。
- 同梱定義はプラグインのバージョンに紐付く。定義ファイル自身にバージョン欄は持たせない。

## 6. researcher 3 系統の設計

3 つの researcher は同じ 3 役割を持つ。役割ごとの Output Format と、報告のみで成果物を作らない制約も共通とする。

- **独立レビュー** — 設計書・実装計画書の前提・暗黙の仮定・楽観的な見積もりを検証し、根拠付きの反証を提示する。採否は判断しない。
- **リアルタイム情報調査** — 最新動向・リリース情報・外部エコシステムを、一次情報源の URL と鮮度を添えて報告する。
- **探索実働** — 指定範囲を走査し、ファイルパスと行番号付きで報告する。

ベンダーごとに書き分けるのは次の点に限る。

- `grok-researcher`: X 由来・ソーシャル由来の情報を未検証として区別する既存記述を維持する。
- `gpt-researcher`: Context7 と WebSearch / WebFetch を主たる情報源とする。
- `claude-researcher`: オーケストレーターと同一ベンダーであるため、独立レビューの独立性が限定的であることを `agents/claude-researcher.md` の本文に明記する。そのうえで、レビュー系統を分ける意義(原本のみを読む・他レビューの指摘を渡されない)を明示し、前提検証と反証提示に集中させる。方針スキル側には「同一ベンダーである」旨を重ねて書かない。

いずれも読み取り専用とし、`Write` / `Edit` とファイルを変更する Serena ツールは与えない。tools は既存 `grok-researcher` の構成を基準にする。

3 定義とも `prompt-smith:agent-creator` スキルに従って作成・検証する。

### 担当表への反映

| 方針 | 追加・変更する行 |
| --- | --- |
| `claude-model-policy` | 「リアルタイム情報調査」と「設計書・実装計画書の独立レビュー」を追加し、担当を `Claude Researcher` にする。「コードベース探索実働」の担当を `Sonnet` / `Haiku` から `Claude Researcher` へ変更する |
| `with-codex-policy` | 同 2 行を追加し、担当を `GPT Researcher` にする。「コードベース探索実働」の担当を `GPT Terra` / `GPT Luna` から `GPT Researcher` へ変更する |
| `codex-grok-policy` | 「コードベース探索実働」の担当を `GPT Terra` / `GPT Luna` から `Grok Researcher` へ変更する。他の行は変更しない |
| `with-grok-policy` | 変更しない(「コードベース探索実働」は既に `Grok Researcher`) |

探索実働を researcher へ寄せることで、探索の実行帯が権限の面でも読み取り専用に固定される。従来の担当帯(`Sonnet` / `Haiku`、`GPT Terra` / `GPT Luna`)は `Write` / `Edit` / `Bash` を持つため、探索目的の dispatch でも書き込み権限が付いていた。

この変更に伴い、次を各方針へ反映する。

- `claude-model-policy` では、探索実働の実行帯が `Haiku` から `Claude Researcher`(`sonnet`)へ上がるため、探索 1 件あたりのコストが上がる。`orchestration-discipline.md` の「コードベース探索」節にあるバッチ委譲の規律で吸収する。同文書は変更しない。
- `with-codex-policy` / `codex-grok-policy` では `GPT Luna` の担当が「軽量な実装」だけになる。「軽量な実装の帯に Agent Tool を許可しない」規定の対象は変わらない。
- `Claude Researcher` / `GPT Researcher` にも Agent Tool を許可しない。既存の `Grok Researcher` と同じ形で、各方針の箇条書きへ追記する。

## 7. SessionStart フック

- ソース: `plugins/agent-policy/src/hooks/session-start.ts`
- バンドル出力: `plugins/agent-policy/scripts/session-start.mjs`。`build.ts` の `entryPoints` へ `"session-start": "./src/hooks/session-start.ts"` を追加する。
- 登録: `plugins/agent-policy/hooks/hooks.json` の `SessionStart`。記述形式は `plugins/revelation/hooks/hooks.json` に倣う。

### 入力

フックプロセスへ渡る環境変数だけを入力とする。標準入力は読まない。

- §4 の 5 変数。
- `CLAUDE_PLUGIN_ROOT` — 同梱定義の読み出し元。`${CLAUDE_PLUGIN_ROOT}/agents/<name>.md` を読む。
- `CLAUDE_PROJECT_DIR` — 生成先の基点。`${CLAUDE_PROJECT_DIR}/.claude/agents/` へ書く。未設定のときは生成を行わず、注入だけを行う。

5 変数は OS 環境と Claude Code の `settings.json` / `settings.local.json` の `env` のどちらで与えてもよい。フックプロセスから見て両者は区別できない。

### 処理順

1. 環境変数を読む。
2. エイリアス 4 変数を既定値と比較し、差分のあるエージェントを列挙する(`claude-researcher` は対象外)。
3. 差分のあるエージェントについて、`${CLAUDE_PLUGIN_ROOT}/agents/<name>.md` を読み、frontmatter の `model:` 行だけを環境変数の値へ差し替えて `${CLAUDE_PROJECT_DIR}/.claude/agents/<name>.md` へ書く。書き込み先に同一内容が既にあるときは書かない。
4. 差分のないエージェントについて、生成先に同名ファイルが存在するかを調べる。存在すれば旧セットアップの残骸である可能性があるため、次節の 4 番目のブロックで通知する。フックは削除しない。
5. `additionalContext` を組み立てて stdout へ JSON を 1 行出力する。
6. 例外は握りつぶし、stdout へ何も出さず終了コード 0 で終わる(フェイルオープン)。原因は stderr へ 1 行書き、Claude Code のデバッグログに残す。

同梱定義を読んで `model` 行を差し替える方式にすることで、テンプレートと同梱定義の二重管理を避ける。

### 出力

stdout へ次の形の JSON を 1 行だけ書く。注入すべき内容が何もないときは、何も書かずに終わる。

```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
```

### additionalContext の構成

次の 4 ブロックを、該当するものだけ順に連結する。

1. **方針指示** — `AMATSUKA_AGENT_AUTO_INJECTION` が方針を指す値のとき、§4 の固定文言を出す。未知の値のときは、値が未知であるため注入をスキップした旨だけを出す。
2. **定義の優先指示** — エイリアスに差分があるとき、「`.claude/agents/` の `<name>` を使い、`agent-policy:` プレフィックス付きの同梱定義は使わない」旨を出す。対象エージェント名を列挙する。
3. **再起動の指示** — 今回のセッションで実際に書き込みが発生したとき、「生成した定義は今セッションには反映されない。エイリアスに依存する委譲を行う前に Claude Code を再起動する」旨を出す。
4. **残骸の通知** — 処理順 4 に該当するとき、「`.claude/agents/<name>.md` が旧セットアップの生成物として残っている。プロジェクト定義は同梱定義より優先されるため、内容が古い場合は削除する」旨を出す。対象名を列挙する。

2 は §2 の検証で判明した二重定義問題への対処である。差分がある環境で同梱側(既定エイリアス)を呼ぶと、存在しないモデル名で 400 になる。

4 は、既定エイリアスを使う利用者では差分生成が起きないため、旧セットアップが生成した古い本文がプロジェクト側に残り続け、同梱定義より優先されてしまう問題への対処である。

## 8. 方針スキルの改訂

4 つの方針スキルに、次の変更を加える。

- **description の選択条件** — 「`.claude/agents/` に定義ファイルが存在するか」という条件を削除する。同梱化により定義ファイルは常に存在するため、この条件は判定として成立しない。代わりに「`AMATSUKA_AGENT_AUTO_INJECTION` がこの方針に対応する値であるとき、CLAUDE.md 等でこの方針に従うよう指示されているとき、またはユーザーが明示的に指定したときに使う」と書く。他方針への振り分け案内(「`grok-researcher.md` が無ければ代わりに…」の類)も、対応する環境変数値の案内へ置き換える。
- **実行帯の解決順** — `setup-gpt` / `setup-grok` の実行案内を削除し、次の順序へ置き換える。
  1. プロジェクトの `.claude/agents/<name>.md` が存在すればそれを使う。
  2. 存在しなければ同梱定義 `agent-policy:<name>` を使う。
  3. ローカルプロキシ経由で呼び出せないとき、GPT の帯は `codex@openapi-codex` プラグイン(`/codex:rescue --model gpt-5.6-sol` 等)を使い、それも不可なら `claude-model-policy` の担当表へ読み替える。Grok の帯は `codex-grok-policy` / `with-grok-policy` の既存「Grok が利用不可のときのフォールバック」節に従う。`with-codex-policy` と `claude-model-policy` には同種の節を新設しない。researcher の帯を `GPT Researcher` / `Claude Researcher` が担うため、そこにフォールバック先を書く必要がないためである。
- **担当表** — §6 のとおり researcher の行を追加・変更する。
- **フォールバック節** — `codex-grok-policy` の「Grok が利用不可のときのフォールバック」節へ「探索実働: `GPT Terra` / `GPT Luna` へ読み替える」を追加する。探索実働の担当が `Grok Researcher` へ移ったことで、Grok 不可時の代替先が必要になるためである。`with-grok-policy` の同節は既に探索実働を含むため変更しない。

`references/orchestration-discipline.md` は変更しない。researcher に Agent Tool を許可しない規定は、各方針スキルの箇条書きで既存の `Grok Researcher` と同じ形で追記する。

## 9. 廃止するもの

| 対象 | 措置 |
| --- | --- |
| `skills/setup-gpt/` | 削除(assets のテンプレートは同梱 `agents/` へ移す) |
| `skills/setup-grok/` | 削除(同上) |
| `src/setup-agents.ts` | 削除 |
| `scripts/setup-agents.mjs` | 削除 |
| `src/__test__/setup-agents.test.ts` | 削除 |
| README の「Agent 定義のセットアップ」「生成スクリプトのオプション」節 | 環境変数の運用手順と移行手順へ書き換え |

### 既存生成物の移行

旧セットアップが生成した `.claude/agents/*.md` は、プロジェクト定義として同梱定義より優先される。その本文は旧テンプレート由来であり、本改修で更新した内容を含まない。放置すると古い定義が使われ続ける。既定エイリアスの利用者ではフックの差分生成が起きないため、上書きによる自然解消も起きない。

- README に移行手順として、旧セットアップで生成した `gpt-*.md` / `grok-*.md` を削除することを明記する。
- 削除後、既定エイリアスの利用者は同梱定義がそのまま使われる。既定と異なるエイリアスの利用者は、環境変数を設定してセッションを 1 度開き直せばフックが再生成する。
- フック自身は既存ファイルを削除しない。§7 の 4 番目の通知で利用者が気づけるようにする。

## 10. 影響ファイル

新規:

- `plugins/agent-policy/agents/{gpt-sol,gpt-terra,gpt-luna,gpt-researcher,grok-researcher,grok-implementer,claude-researcher}.md`
- `plugins/agent-policy/hooks/hooks.json`
- `plugins/agent-policy/src/hooks/session-start.ts`
- `plugins/agent-policy/scripts/session-start.mjs`(ビルド生成物)
- `plugins/agent-policy/src/hooks/__test__/session-start.test.ts`

変更:

- `plugins/agent-policy/skills/{claude-model,with-codex,with-grok,codex-grok}-policy/SKILL.md`
- `plugins/agent-policy/build.ts`
- `plugins/agent-policy/package.json`(version)
- `plugins/agent-policy/.claude-plugin/plugin.json`(version)
- `plugins/agent-policy/README.md`
- `.claude-plugin/marketplace.json`(description)
- ルート `README.md`

削除: §9 のとおり。

## 11. テスト方針

`session-start.ts` を対象に vitest で次を確認する。テスト方式は既存の `src/__test__/setup-agents.test.ts` に倣い、`src/testing/run-ts.ts` の `runTs` で子プロセス実行する。環境変数(5 変数・`CLAUDE_PLUGIN_ROOT`・`CLAUDE_PROJECT_DIR`)と一時ディレクトリを子プロセスへ渡して差し替えるため、依存注入のための構造分割は行わない。

- 5 変数すべてが未設定のとき、stdout へ何も出さず、ファイルも生成しない。
- エイリアス 4 変数が未設定または既定値と一致し、`AMATSUKA_AGENT_AUTO_INJECTION` だけが設定されているとき、方針指示だけを出し、ファイルは生成しない。
- `AMATSUKA_AGENT_AUTO_INJECTION` の 5 値それぞれについて、期待どおりの方針名を含む文言を出す、または注入しない。
- `AMATSUKA_AGENT_AUTO_INJECTION` が未知の値のとき、方針指示を出さず、値が未知である旨だけを出す。
- エイリアス 1 変数だけが既定と異なるとき、その供給元に紐付くエージェントだけを生成し、`model` 行が差し替わっている。`AMATSUKA_AGENT_GPT_TERRA_ALIAS` の場合は `gpt-terra` と `gpt-researcher` の 2 件が対象になる。
- 生成先に同一内容が既にあるとき、書き込みを行わず、再起動の指示も出さない。
- 差分のないエージェントの定義が生成先に存在するとき、残骸の通知を出す。
- `CLAUDE_PROJECT_DIR` が未設定のとき、生成を行わず注入だけを出す。
- 読み書きで例外が起きたとき、stdout へ何も出さず終了コード 0 を返す。

「生成した定義が次セッションから効く」ことは Claude Code 本体の挙動であり、単体テストの対象にしない。§2 の実測をもって確定とする。

## 12. リスクと受容

| リスク | 受容の理由と対処 |
| --- | --- |
| 生成した定義が次セッションからしか効かない | エイリアスを変えるのは初回設定時に限られる。フックの注入文で再起動を促す |
| 旧セットアップの生成物が残ると古い定義が使われ続ける | 既定エイリアスの利用者では上書きが起きないため自然解消しない。README の移行手順とフックの残骸通知(§7)で気づけるようにする。フックによる自動削除は行わない |
| 同名の定義が二重に見える | 差分がある環境でのみ発生する。フックの注入文と方針スキルの解決順の両方で規律を置く |
| 同梱エージェントが全プロジェクトのエージェント一覧に出る | プロキシ未導入の環境では呼ぶと 400 になる。方針スキルの解決順とフォールバック節で扱う |
| `AMATSUKA_AGENT_AUTO_INJECTION` 未設定では何も起きない | 既定を `none` とすることで、プラグイン導入だけで全プロジェクトの振る舞いが変わる事故を防ぐ |

## 13. バージョン

`0.6.0-dev` → `0.7.0-dev`。スキル 2 つの廃止と hook の新設を含むため、マイナーを上げる。`plugins/agent-policy/package.json` の `version` も同じ値に揃える。
