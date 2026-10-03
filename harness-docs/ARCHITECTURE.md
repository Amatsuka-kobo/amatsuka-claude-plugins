# ARCHITECTURE

## システム概要

あまつか工房が開発する Claude Code プラグインを配布する pnpm workspace のモノレポである。利用者は Claude Code のユーザーであり、提供するマーケットプレイスを通じてプラグインを導入する。各プラグインは Claude Code が読む宣言(skills / agents / commands / hooks)と TypeScript ソースを持ち、ソースは esbuild でバンドルして `scripts/` へ出力し git 管理下に置く。ネイティブコードと辞書はバンドルにも git にも含めず、初回に取得して `${CLAUDE_PLUGIN_DATA}` に置いてよい。Anthropic API を使えないユーザーも全プラグインを使えることを必須要件とし、Anthropic API が必要になる処理は Claude Code の機構か `claude` CLI のヘッドレス実行に閉じる。Anthropic 以外の外部 API は、利用者が環境変数に設定する API キーを前提に必須依存としてよい。開発環境の用意とローカルプロキシの起動はルートの `scripts/` が担い、コードベース探索は Serena MCP が `.serena/` の設定とメモリを通じて担う。

## 技術スタック

| 区分 | 採用技術 |
| --- | --- |
| ランタイム | Node.js >=26 |
| パッケージマネージャ | pnpm 11.8.0 |
| 言語 | TypeScript ^6.0.3 |
| モジュール形式 | ESM |
| バンドラ | esbuild ^0.28.1 |
| スクリプト実行 | tsx ^4.22.4 |
| Lint / Format | @biomejs/biome ^2.5.0 |
| テスト | vitest ^4.1.10 |
| 型定義 | @types/node ^26.0.0 |

- Node.js と pnpm のバージョンは volta で固定する。Node は 26.3.1、pnpm は 11.8.0 とする。
- TypeScript は `strict` と `noEmit` を有効にする。
- esbuild の `target` は node22 に揃える。出力は ESM とし、拡張子は `.mjs` とする。
- 共通の開発依存はルートの `package.json` に置く。
- プラグイン固有のランタイム依存は、そのプラグインの `package.json` に置く。
- 初回に取得するネイティブコードと辞書は `package.json` に置かず、取得元の URL と sha256 をコードに固定する。

## レイヤー構造

| 層 | 責務 |
| --- | --- |
| 配布宣言 | プラグインの配布単位・名前・バージョンを宣言する(`.claude-plugin/`) |
| 指示 | AI が読んで従う手順を置く(`skills/` `commands/` `agents/`) |
| 参照 | 複数の指示から共有する規律と断片を置く(`references/`) |
| フック | Claude Code のイベントと実行スクリプトを結びつける(`hooks/`) |
| 配布物 | 実行されるバンドル。単発実行は `scripts/`、常駐プロセスは `dist/` に置く |
| 実装 | 配布物の元になる TypeScript ソース(`src/`) |

依存の許される方向:

- 指示層は参照層を読む。
- 指示層とフック層は配布物層を実行する。
- 配布物層は参照層を実行時に読む。
- 実装層はビルドを通じて配布物層を生成する。
- 配布宣言層は他のどの層にも依存しない。

禁止される依存方向:

- 実装層は他プラグインの `src/` を import しない。同じ規則が複数のプラグインに要るときは、各プラグインで独立に実装し、規則を変えたときは同じ規則を持つ全プラグインの実装を追随させる。
- 配布物層を手で編集しない。実装層を変更し、`pnpm run build` で再生成する。
- 指示層と参照層に、リポジトリルート固有のパスや他プラグインの名前を書かない。参照が要る内容は、プラグイン内に閉じた表現へ書き換える。例外は、プラグイン間の連携を前提に設計された `codiel` `metatron` `gh-utility` の 3 プラグイン同士の言及のみ。

## ディレクトリ構成と責務

```
.
├── .claude-plugin/marketplace.json  配布するプラグインの一覧を宣言する
├── .claude/rules/metatron/          metatron が管理する規律を置く
├── harness-docs/                    設計書・実装計画書と ARCHITECTURE・GOTCHAS を置く
├── scripts/                         ターミナルで手動実行するための ShellScript を置く
├── tools/                           AI が使用する Python スクリプトツールを置く
├── docs/                            人間向けの文書と会話記録を置く
│   └── prompts/                     別セッションの起動プロンプトを置く
├── .raphael/                        raphael の抗体を置く
├── .serena/                         Serena のプロジェクト設定とメモリを置く
└── plugins/<plugin>/
    ├── .claude-plugin/plugin.json   プラグイン名とバージョンを宣言する
    ├── .mcp.json                    MCP サーバーの起動方法を宣言する
    ├── build.ts                     esbuild のバンドル定義を置く
    ├── src/                         TypeScript ソースを置く
    │   └── __test__/                vitest のテストを置く
    ├── scripts/                     単発実行のバンドル出力を置く
    ├── dist/                        常駐プロセスのバンドル出力を置く
    ├── skills/                      AI が読む手順を置く
    ├── commands/                    スラッシュコマンドの定義を置く
    ├── agents/                      サブエージェントの定義を置く
    ├── assets/                      指示層が読み込んで合成する素材を置く
    ├── hooks/hooks.json             Claude Code のイベントと実行スクリプトの対応を置く
    ├── references/                  複数の指示から共有する規律を置く
    ├── docs/                        設計・背景・経緯・不採用案と、開発時のチェックリストを置く
    ├── evals/                       スキルとエージェント定義の評価セットを置く
    └── README.md                    利用者が読まないと使えない情報を置く
```

- `plugins/codiel/raguel-mcp/` は codiel 内の独立した pnpm workspace であり、MCP サーバーとして `dist/` へ出力する。
- `assets/` に置くのは、指示層が実行時に読み込む素材と、実装層が Agent 定義へ合成する断片である。言語別に分けるときは `assets/<種別>/<言語>/` とする。
- `docs/` は読まない。`docs/chat/` と `docs/prompts/` だけが例外である。
- `docs/chat/**/*.md` は chat-recorder エージェントと chat-reader エージェントだけが読む。
- `docs/prompts/**/*.md` は、依頼文で名指しされたときだけ読む。
- 過去の記録が必要なときは `chat-history:recall` を使う。
- 前回セッションの再開には `chat-history:resume` を使う。

## ドメインマップ

```json metatron:domains
{
  "impl": ["plugins/*/src/**", "plugins/*/build.ts", "plugins/codiel/raguel-mcp/src/**", "plugins/codiel/raguel-mcp/build.ts"],
  "prompt": ["plugins/*/skills/**", "plugins/*/agents/**", "plugins/*/commands/**", "plugins/*/references/**", "plugins/*/assets/**"],
  "bundle": ["plugins/*/scripts/**", "plugins/*/dist/**", "plugins/codiel/raguel-mcp/dist/**"],
  "manifest": [".claude-plugin/**", "plugins/*/.claude-plugin/**", "plugins/*/hooks/**", "package.json", "plugins/*/package.json", "pnpm-workspace.yaml", "tsconfig.json", "biome.json", "vitest.config.ts", "scripts/**", "tools/**"],
  "docs": ["harness-docs/**", "docs/**", "plugins/*/docs/**", "plugins/*/README.md", "README.md", "CLAUDE.md", ".raphael/**", ".serena/**"]
}
```

- `impl` は TypeScript の実装を指す。
- `prompt` は AI が読む指示書と、そこへ合成される素材を指す。
- `bundle` は手で編集しない。
- `manifest` は配布宣言・ワークスペース設定・環境構築スクリプトを指す。
- `docs` は実行されない資産を指す。人間向けの文書、AI 向けの知識、Serena のメモリ、raphael の抗体を含む。

## コマンド定義

| 種別 | コマンド |
| --- | --- |
| build | `pnpm run build` |
| lint | `pnpm run lint` |
| lint(自動修正) | `pnpm run lint:fix` |
| typecheck | `pnpm run typecheck` |
| test | `pnpm run test` |

- いずれも `pnpm install` が済んでいることを前提とする。
- 単一のプラグインだけをビルドするときは `pnpm --filter <plugin>-scripts build` を使う。

## ADR 一覧

### ADR-001: [agent-policy] MCP ツールの許可はサーバー単位、禁止はツール単位とする

- 状態: 採用
- 決定日: 2026-08-25
- 決定者: phyllis998

#### 背景

サブエージェントに MCP ツールを与えたいが、プラグインは利用者がどの MCP サーバーを接続しているか事前に知り得ない。加えて、`tools` に存在しないツール名を書くと他の許可済みツールまで落ちることが実測で分かっている。

#### 検討した選択肢

1. 許可も禁止もサーバー単位にする
2. 許可も禁止もツール単位にする
3. プラグインが主要 MCP サーバーの編集系ツール一覧を同梱し、それを使って禁止リストを組む

#### 採用した結論

許可は `claude mcp list` が返したサーバー名だけを受け取り、`mcp__<server>` の形で `tools` へ書く。禁止は `disallowedTools` へツール名で書き、利用者が指定した文字列をそのまま通す。

#### 理由

許可リストへ実在しないツール名が入ると他の許可が落ちるため、許可側は実在が保証された値だけを扱う。`claude mcp list` の出力はその保証を与える。禁止リストは誤った名前が入っても無害であり、ツール単位の粒度を取れる。ツール単位の許可は実在保証を失う。編集系ツール一覧の同梱は、サーバー側の更新に追随できず、利用者が使うサーバーを列挙し切れない。

#### 影響範囲

`--mcp-servers` はサーバー名、`--mcp-deny` はツール名を受ける。MCP の付与単位は役割ではなく定義になる。

---

### ADR-002: [metatron] GOTCHAS の台帳は init が承認を得て生成する

- 状態: 採用
- 決定日: 2026-09-15
- 決定者: phyllis998

#### 背景

`/metatron:init` は ARCHITECTURE と rules を生成するが、GOTCHAS の台帳は生成しなかった。台帳は最初の失敗を記録する時点で `append-gotcha` が作っていた。このため metatron が管理する 5 ファイルのうち GOTCHAS だけが、ユーザーの承認を経ずに生まれ、生成と同時に hook の保護下へ入っていた。SessionStart の init 案内文とも食い違っていた。

#### 検討した選択肢

1. init が新しいサブコマンドで生成する(採用)
2. スキルが Write で雛形を書く — hook が GOTCHAS のパスへの書き込みを拒否する。ファイルが無い状態でも拒否されるため成立しない
3. `append-gotcha` に台帳だけ作るモードを足す — `append-gotcha` は承認なしで動く決まりであり、同じサブコマンドが承認の要る動きと要らない動きを併せ持つことになる
4. 現状維持 — 注入文との食い違いと、承認を経ない生成が残る

#### 採用した結論

`init-gotchas` と `get gotchas-template` を新設する。init の承認対象を 4 から 5 へ増やし、stage の対象は 4 のまま据え置く。GOTCHAS は stage を経ず、雛形の全文を提示して承認を得てから一度の実行で生成する。既存の台帳があるときは拒否し、内容を変更しない。

#### 理由

雛形は固定の文字列で、既存の台帳と内容を混ぜる処理が無い。stage と commit に分ける方式が防ぐ事故のうち、ここで起きうるのは提示から実行までの間に別の書き込みが割り込むことだけであり、それは既存の台帳を拒否する仕組みが同じ役割を果たす。残る隙間は、その間に空のファイルが現れたときに雛形で上書きすることだが、失われる内容が無いため許容する。承認を init に置くのは、台帳を作るとプロジェクトに恒久的なファイルが増え、以後は hook が直接編集を拒むようになるためである。`append-gotcha` が台帳ごと作る動きは残す。失敗を記録しようとした時点で台帳が無いことを理由に止めると、記録の機会そのものを失う。今回変えるのは、通常どちらが作るかの一点だけである。

#### 影響範囲

codiel は GOTCHAS の直接追記と雛形の写しを失う。CLI の案内が無い環境では、記録を run のレポート(`.codiel/runs/<runId>/try-<n>/reports/` または `.codiel/reports/`)と完了報告へ持ち越す。持ち越しは次のセッションで注入が届けば解消する。`harness-docs/design/2026-08-16-file-contract-freeze.md` のサブコマンド一覧とロック取得の表を更新する。init の承認回数が 4 回から 5 回へ増える。

---

### ADR-003: [codiel] ドメインマップは metatron の資産とし、codiel は無くても汎用実行する

- 状態: 採用
- 決定日: 2026-09-15
- 決定者: phyllis998

#### 背景

`/codiel:init` が ARCHITECTURE を生成・修復し、`orchestrating-runs` §0 が `domains: null` を「未初期化」と断定して run を終了させていた。ドメインマップは metatron の構造記述であり、codiel が作成・修復する立場にない。さらに `readDomainsResult` は ARCHITECTURE 不在・ブロック不在・JSON 不正・形式不正・例外の 5 状態をすべて `domains: null` に落とし、うち 2 つは警告も空だった。このため「マップを使わない」と「使うはずのマップを読めない」を呼び出し側が区別できなかった。

#### 検討した選択肢

1. 正本を `.codiel/config.json` へ新設して移す
2. 正本を `raguel.config.yaml` の最上位へ置く
3. 正本を `raguel.config.yaml` の `rules.<ruleId>` 配下へ置く
4. ドメインマップを metatron へ完全移管し、codiel を metatron 必須にする
5. 正本を動かさず writer だけ止め、`domains: null` を generic へ自動縮退させる
6. 正本を動かさず writer を止め、「読めない理由」で正当な不在と異常を分ける(採用)

#### 採用した結論

⑥ を採用する。ドメインマップは ARCHITECTURE に残し、codiel は作成・修復しない。run は開始時に実行モード(`mapped` / `unscoped`)を決め、モードを run state へ記録する。マップを読めないときは、正当な不在と壊れたマップを別の状態として扱い、前者だけを汎用実行の候補にする。任意のドメイン名は、専門担当が無ければ汎用担当へ送り、タグと glob は保つ。

#### 理由

独自のドメイン境界を metatron 不在でも設定できることは必須要件ではない、とユーザーが判断した。このため新しい恒久設定と契約を導入せずに済む。

`domains: null` は 5 状態の混合である。一括縮退は「正当な不在」と「壊れたマップ」を同一視し、書き手が自分のブロックを読まれていないことに気づけなくする。

`unscoped` へ到達する経路を 2 つに限ると、どちらでも `domains` が `null` になる。このため hook 層を据え置いたまま指示層と結論が一致する。

汎用担当を新設したのは、縮退時に足されるのが範囲の指示だけで、観点が差し替わらないためである。任意キーへ一般化すると、backend の観点を無関係なドメインへ当てることになる。

#### 影響範囲

codiel は ARCHITECTURE を書かなくなる。`/codiel:init` の聞き取りは保護パスだけになり、初期化済みの判定は CLAUDE.md の運用ルール節・`raguel.config.yaml`・`.codiel/` の 3 ディレクトリで決まる。専門担当が無いドメイン名は汎用担当が受ける。planner と architect と implementer は、ドメインマップを渡された値として受け取る。sandalphon の委譲判定はドメイン可読性を見なくなる。凍結契約 `harness-docs/design/2026-08-16-file-contract-freeze.md:70` の警告経路から init の名指しが外れる。hook(`guard-write`)の挙動と既存テストは据え置く。将来予定される Agents から Skills への移行は、別の ADR で扱う。

---

### ADR-004: [codiel] ディスパッチ先を作業内容で表し、選択をセッションの運用方針に委ねる

- 状態: 採用
- 決定日: 2026-09-23
- 決定者: phyllis998

#### 背景

codiel は各フェーズの担当を同梱 Agent 15 体の名前で固定し、名指しで dispatch していた。このため、プロジェクトの `.claude/agents/` にある最適化済みの定義が使われなかった。

#### 検討した選択肢

1. 同梱 15 体を維持し、名指し dispatch を続ける
2. codiel の指示層に、委譲先の解決機構または役割名を書く
3. 同梱を 2 体に絞り、残りは作業内容だけを渡す(採用)

#### 採用した結論

同梱 Agent を `codiel-analyst` と `codiel-test-designer` の 2 体に絞る。残るフェーズは作業内容と委譲の種別(成果物を書く/読み取りだけ)だけを渡す。削除した Agent の注意と観点は、各スキル配下の `references/` に置く。SubagentStop hook を廃止し、agent-policy の `e2e-verify` を `impl` へ昇格させる。

#### 理由

解決機構や役割名を codiel に書くと、運用方針との二重管理になる。また、作業の重さに応じて委譲先を選べなくなる。analyst と test-designer は tools の組合せが一般の委譲先と合わないため残す。

#### 影響範囲

codiel は委譲先を名指しでも役割名でも指定せず、作業内容と委譲の種別だけを渡す。選択はセッションの運用方針に委ね、方針が無い環境ではビルトイン(`general-purpose` / `Explore`)へ縮退する。ツール制限による構造的ハーネスは部分的に成立しなくなり、依頼文の tools 限定条項とスキル本文の HARD-GATE が代わりを担う。

---

### ADR-005: Anthropic 以外の外部の有料 API を必須依存とするプラグインを認める

- 状態: 採用
- 決定日: 2026-09-26
- 決定者: phyllis998

#### 背景

このプロジェクトのプラグインは、LLM を要する処理を Claude Code の機構か claude CLI のヘッドレス実行に限定し、Anthropic API に依存しない構成を採用し、API キーを使用する外部 API への依存を避けてきた。しかし新しく作成した Jevriel プラグインは TypeSafe AI による外部の有料 API に依存するため、この前提が一部崩れてしまう。

#### 検討した選択肢

1. Anthropic 以外の外部 API にも依存しない
2. 外部 API を使うが、キーが無いときは `claude` CLI で代替する
3. 外部 API を必須依存として認め、キーが無いときはエラーを返す(採用)

#### 採用した結論

このプロジェクトのプラグインは、Anthropic 以外の API キーを使用する外部 API を必須依存としてよい。キーは利用者が環境変数に設定し、キーが設定されていないときはその API を要する機能だけがエラーを返す構成を採用する。依存外部 API が使用できないときの代替経路は作らない。Jevriel はこの方針で `TYPESAFE_API_KEY` の設定を必須とし、キーが設定されていない場合は Jev を呼ぶツールが `not_configured` を返す。

#### 理由

このプロジェクトで禁止しているのは Anthropic API の使用であり、他の外部 API は対象外である。

#### 影響範囲

システム概要の「LLM を要する処理は...に閉じる」が Anthropic API が必須の処理を指すと明確にし、外部 API を必須とするプラグインを認める記述を加える。ディレクトリ構成図に `plugins/<plugin>/.mcp.json` を加える。

---

### ADR-006: [codiel] run の起点を intent 文書に替え、sandalphon を吸収し、同梱 Agent を持たない

- 状態: 採用
- 決定日: 2026-09-27
- 決定者: phyllis998

#### 背景

sandalphon には intent の聞き取りと書式があるが、intent を起点に設計・実装・テスト・レビューまで進める機能が無く、単独では intent 駆動開発をフルサポートできなかった。codiel の GitHub Issue 起点のワークフローには特別な需要が無く、革新的なプラグインとして確立するには弱かった。ADR-004 で残した同梱 Agent 2 体(`codiel-analyst` と `codiel-test-designer`)は、特別な理由がない限りサブエージェントにはプロジェクトに最適化されたユーザー定義の Agent を使うべきという考えに反していた。

#### 検討した選択肢

1. Issue 起点を保ち、sandalphon を codiel の前段のプラグインとして残す
2. sandalphon を codiel に吸収して run の起点を intent 文書にし、同梱 Agent は `codiel-test-designer` だけを残す
3. 2 と同じだが、同梱 Agent を持たない(採用)

#### 採用した結論

sandalphon を codiel に吸収し、codiel を intent 駆動開発をフルサポートするプラグインとして確立する。run の起点は `docs/intents/` の intent 文書、入口は Issue 番号・intent パス・省略の 3 つとし、Issue は転記先も兼ねる。GitHub を使えない環境では local モードで run を進める。codiel は同梱 Agent を持たない。ADR-004 のうち上書きするのは「同梱 Agent を 2 体に絞る」部分だけで、それ以外(委譲先を作業内容で表す)は保つ。

#### 理由

sandalphon と codiel を統合すると、intent の聞き取りから設計・実装・テスト・レビュー・完了の判定までを 1 つのワークフローで支えられ、sandalphon の不足と codiel の弱さを解消できる。intent 文書を正本にすると、ユーザーの言葉(原文)と要件の由来が run の外に残り、完了を原文に照らして判定できる。同梱 Agent は背景の考えに反するため、ADR-004 で残した 2 体も残す価値が薄いと判断した。

#### 影響範囲

run state は slug で識別する version 2 になり、version 1 の run は `get`・`stop` と、`awaiting_outcome` の run の outcome の記録だけを受け付ける。sandalphon はマーケットプレイスから消える。codiel は変更ごとの intent 文書と持続層 `docs/intents/domains/` を持つ。test-spec の書き込み範囲の制限は、依頼文とスキルの HARD-GATE が担う。ADR-003 の影響範囲にある「初期化済みの判定は CLAUDE.md の運用ルール節」は、`.claude/rules/codiel.md` と CLAUDE.md の `## Codiel` による判定に置き換わる。

---

### ADR-007: [metatron] codiel の持続層の ADR 候補を metatron が ADR へ移し、参照形に縮める

- 状態: 採用
- 決定日: 2026-09-27
- 決定者: phyllis998

#### 背景

codiel は metatron が無くても動くよう(ADR-003)、ADR にすべき判断を持続層 `docs/intents/domains/` に `[ADR 候補]` として全文で書く。後から metatron を入れると、同じ判断が ADR と持続層の 2 か所に全文で残り、食い違っていく。プラグインは自分の資産だけを書く分担で、ほかのプラグインの資産を書き換える経路は無かった。

#### 検討した選択肢

1. 利用者が手で ADR へ移し、持続層を直す
2. codiel が metatron の CLI を呼んで ADR を足し、自分の持続層を縮める
3. metatron が持続層を走査して ADR へ移し、そのエントリを参照形に縮める(採用)

#### 採用した結論

`/metatron:init` と `/metatron:update` は `scan-adr-candidates` で `[ADR 候補]` を提示し、承認された候補を ADR にしてから `shrink-adr-candidate` でそのエントリを参照形に縮める。metatron が codiel の資産に書くのはこの縮約だけで、範囲は `docs/intents/domains/*.md` のうち候補 ID で特定したエントリに限る。書式は codiel の `intent-format.md` を正本とする共有ファイル契約とし、metatron は読み取りと縮約に要る最小限だけを写す。

#### 理由

ARCHITECTURE の持ち主である metatron が ADR の確定と縮約を同じ手順で行えば、判断の全文は ADR の 1 か所だけに残る。codiel が metatron を呼ぶと、metatron が無くても動くという codiel の独立性が崩れる。手で移すと、候補の取りこぼしと写し間違いを防げない。書き込みを候補 ID で特定したエントリに限り、走査時のハッシュと照合すれば、ほかのプラグインの資産でも範囲外を壊さない。

#### 影響範囲

metatron は codiel の持続層の書式に依存し、書式を変えたときは両プラグインの `format-change-checklist.md` に沿って追随させる。metatron に `scan-adr-candidates` と `shrink-adr-candidate` が加わり、縮約の失敗は終了コード 3 と `shrinkPending` で返る。codiel は ADR の確定に関わらず、`[ADR 候補]` を持続層に全文で書くことだけを担う。

---

### ADR-008: [codiel] テストを実装の前に別の委譲で書いて保護し、仕様を testsDir に置く

- 状態: 採用
- 決定日: 2026-09-28
- 決定者: phyllis998

#### 背景

codiel 0.x では、implement の委譲がコードと一緒にテストを書き、test-loop も implement の後に書いていた。どちらのテストも実装に合わせて書かれるおそれがあった。テストは `.codiel/specs/` の下にあり、プロジェクトのテストの置き場にも実行の対象にも入らなかった。

#### 検討した選択肢

1. implement の委譲がコードと一緒にテストを書く形を保つ
2. test-loop が implement の後にテストを書く形を保つ
3. test-code フェーズを implement の前に置いてテストを別の委譲で書き、implement 以降はテストの書き換えを hook で止める(採用)

#### 採用した結論

test-code フェーズを (test-spec ∥ dev-plan) と implement の間に置く。test-code は仕様からユニットテストと E2E を書き、それらが実装の前に失敗することを確かめる。implement はそのテストを通し、test-loop は全テストの回帰を確かめて直す。テストの仕様は `.codiel/config.json` の `testsDir`(既定は `docs/tests`)の下に置く。テストコードはプロジェクトの規約の場所に置き、置いたパスを `spec.md` に記録する。implement・test-loop・fix-loop の間は、仕様と、`spec.md` に記録したテストコードへの書き込みを guard-write が ask にする。

#### 理由

実装の前に別の委譲でテストを確定させると、テストが実装を追認しなくなる。書き込みを ask にすれば、コードを直すフェーズでテストが実装に合わせて書き換えられるのを人が止められる。テストコードをプロジェクトの規約の場所に置くと、run の外でもプロジェクトのテストとして走る。保護の対象は `spec.md` の記録 1 か所で決まる。

#### 影響範囲

run state の `phases` に `test-code` が加わる。ADR-006 が version 1 の run に定めた扱いは、`phases` に `test-code` を持たない version 2 の run にも当たる。ADR-003 の初期化済みの判定にある `.codiel/` の 3 ディレクトリは、`.codiel/runs` と `.codiel/reports` の 2 つになり、`/codiel:init` の判定だけは `.codiel/config.json` も見る。codiel 0.x の `.codiel/specs/` は読まれず、移されず、報告もされない。fix-loop では、オーケストレーターが `set-test-edit` を立てている間だけテストの保護が外れる。

---

### ADR-009: [codiel] 設定を .codiel/config.json に集め、run の文書を git で共有し、state と報告を手元に残す

- 状態: 採用
- 決定日: 2026-09-29
- 決定者: phyllis998

#### 背景

Raguel は codiel と組にして使うのに、codiel 1.0.0 の初版では設定が `.codiel/config.json` と `raguel.config.yaml` に分かれ、2 つの置き場を別々に用意して管理する手間があった。また、run の文書(agenda・discussion・design・dev-plan)と state・報告が `.codiel/runs/<slug>/try-<n>/` にまとまり、run ブランチへコミットされていた。手動確認では `.codiel/` の中身が `git status` に残り、オーケストレーターが run と関係の無い変更や `state.json` をコミットした。

#### 検討した選択肢

1. `.codiel/` をまるごと git から外す
2. run の文書を try ごとに分けて `.codiel/runs/<slug>/try-<n>/` に置き、コミットする形を保つ
3. Raguel の設定を `raguel.config.yaml` に残し、codiel の設定と分ける
4. 設定を `.codiel/config.json` に集めて共有し、run の文書を `runsDir` に置いて共有し、try ごとの state と報告を `.codiel/runs/` に置いて git から外す(採用)

#### 採用した結論

`.codiel/config.json` に `testsDir`(既定は `docs/codiel/tests`)・`runsDir`(既定は `docs/codiel/runs`)・`raguel` を置き、git で共有する。Raguel は `RAGUEL_CONFIG` か cwd の `.codiel/config.json` の `raguel` を読み、YAML を読まない。discuss・design・dev-plan の文書は `<runsDir>/<slug>/` に置き、try で分けずにコミットする。try ごとの `state.json`・`steps/`・`reports/` は `.codiel/runs/<slug>/try-<n>/` に、`/codiel:test` の報告は `.codiel/reports/` に置き、どちらも `.gitignore` で外す。E2E のレポートは `<testsDir>/e2e/` の下の `reports/` に置き、json と md だけを共有する。`/codiel:init` が `.gitignore` の行を足し、`/codiel:run` はその行が揃うまで始めない。

#### 理由

run の文書は後から設計の経緯を読む材料になるので、コードと同じ場所で共有する。state と報告は実行ごとの作業記録で、共有すると差分とコミットの誤りを生む。組で使う 2 つの設定を 1 ファイルに集めると、用意と管理が 1 か所で済み、init の判定と Raguel の読み込み先も 1 か所で決まる。新しい try は前の try の文書を置き換え、前の版は前の try のブランチから読めるので、try で分けない。

#### 影響範囲

`raguel.config.yaml` は読まれず、`/codiel:init` が承認を得て中身を `raguel` へ写してから消す。raguel-mcp は yaml の依存を持たない。未記録の GOTCHAS の退避先は `<runsDir>/<slug>/unrecorded-gotchas.md`(run が無いときは `.codiel/reports/unrecorded-gotchas.md`)になる。PR・レビュー・Issue の本文ファイルは `reports/` に書き、コミットしない。`.codiel` は git のルートに置く。ADR-002 の影響範囲にある退避の置き場「`.codiel/runs/<runId>/try-<n>/reports/` または `.codiel/reports/`」は、上の退避先に置き換わる。ADR-003 の影響範囲にある初期化済みの判定の `raguel.config.yaml` は、`.codiel/config.json` の `raguel` に置き換わる。ADR-008 の結論にある testsDir の既定 `docs/tests` は、`docs/codiel/tests` に置き換わる。ADR-008 の影響範囲にある「`/codiel:init` の判定だけは `.codiel/config.json` も見る」は、`/codiel:init` と `/codiel:run` の両方が `.codiel/config.json` の `raguel` と `.gitignore` の行を見る判定に置き換わる。

---

### ADR-010: [native-japanese] 形態素解析の実行物と辞書は初回に取得し、git に同梱しない

- 状態: 採用
- 決定日: 2026-09-29
- 決定者: phyllis998

#### 背景

native-japanese は、文の長さ・文末の連続・連体修飾の重なりの検査に形態素解析を使う。lindera 6.2.0(N-API)の `.node` は OS ごとに最大 7.4MB あり、IPADIC の辞書は展開後 46MB になる。バンドル出力を git に置く現行の方針のままでは、6 種の `.node` と辞書がリポジトリに入る。

#### 検討した選択肢

1. `.node` と辞書を git に同梱する
2. lindera を `package.json` の依存にし、プラグイン導入時のインストールに任せる
3. 初回に npm registry と GitHub のリリースから取得し、sha256 で検証する(採用)
4. 辞書を同梱できる kuromoji(純 JavaScript)か lindera-wasm を使う

#### 採用した結論

取得元の URL と sha256 をコードに固定し、取得物を `${CLAUDE_PLUGIN_DATA}/morph/` に置く。取得は、SessionStart の hook が切り離して起動する子プロセスが行う。hook は子プロセスの終了を待たない。取得が済むまでと取得できない環境では、形態素解析を使わず正規表現だけで検査する。hook での取得と使用は `AMATSUKA_NATIVE_JAPANESE_MORPH=off` で止められる。

#### 理由

1 はリポジトリが 50MB 以上増え、使わない OS の `.node` まで全員に配る。2 は成り立たない。プラグインの導入はファイルの配置であり、`package.json` の依存は入らない。辞書も npm に無い。4 はプロセス全体に 300ms(lindera-wasm)と 820ms(kuromoji)かかり、書き込みのたびに起動する hook には重い。N-API なら 60ms で済む。

#### 影響範囲

システム概要にバンドルと git の例外を、技術スタックに `package.json` の例外を足す。利用者の環境は、初回のセッションで約 13MB を取得する。

---

### ADR-011: [codiel] Raguel を層ごとに作り直し、評価対象を自分で読み、STOP を 4 種に絞る

- 状態: 採用
- 決定日: 2026-09-29
- 決定者: phyllis998

#### 背景

codiel 1.0.0 の手動確認で、Raguel は run を止めるか素通しさせるかに偏った。25 件の評価のうち STOP 3 件はすべて codiel が作るパスへの秘密情報の誤検知、PROCEED 19 件はすべてパネルを通らない trivial、パネルの起動 12 回はすべて `claude` が `--json-schema` を拒んで失敗した。呼び出し側が渡す要約をそのまま検査していたので、PROCEED は成果物の実物を検査した結果になっていなかった。基盤の障害(タイムアウトなど)も内容の懸念と同じ ASK になり、判例を汚した。

#### 検討した選択肢

1. 全面的に書き直し、MCP ツール面と層の構成も新しく決める
2. ルールだけに縮小し、LLM のパネルを外す
3. MCP ツール面と層の構成(ルール・重さ・パネル・ケースファイル・判例)を残し、層ごとに改修する(採用)

#### 採用した結論

層の構成を残して改修する。
- Raguel は評価対象を自分で読む。evaluate_code は baseRef から git diff を固定の書式で作る。evaluate_plan・evaluate_design は paths のファイルを読む。どちらも読んだ内容の sha256 と HEAD を記録し、呼び出し側が本文を渡す旧入力は廃止する。
- codiel の pass-gate は Raguel の記録(評価の索引・verdict.json・裁定の記録)を照合する。code 系フェーズでは HEAD・起点・範囲の絞り込みの無さを、文書のフェーズではファイルの sha256 と期待するファイルを確かめる。
- pass-gate と Raguel は同じファイル契約(plugins/codiel/docs/raguel-contract.md)を独立に実装し、2 者比較テストで突き合わせる。
- STOP は秘密情報・保護パス・破壊操作・改竄の 4 種だけに出す。改竄以外は、人が誤検知と裁定すれば record_outcome を経て通せる。
- ほかのルールは最大 ASK にする。語彙のルールは info にしてパネルの入力にする。
- パネルのプロバイダーは claude と codex から選べ、既定は claude とする。
- ルール層と重さ判定の一部は、任意で Jev(TypeSafe AI)に文脈判定させられる。既定は無効とする。Jev が動かせる向きは stop → ask と、語彙のルールの info → ask などに限る。
- 基盤の障害は judgeStatus: degraded の ASK にし、判例と再提出の比較から外す。

#### 理由

要約を渡せば PROCEED を取れる入力が残る限り、ゲートの結果は実物の検査にならない。STOP を確かな危険に絞ると、誤検知で run が止まる回数が減り、それ以外の懸念はパネルと人の裁定に回せる。層の構成と MCP ツール面は codiel のスキルと hook が前提にしているので、残すと codiel 側の変更を入力と記録の形に限れる。ルールだけに縮小すると、文書の欠陥や設計の穴のように正規表現で拾えない懸念を検査できない。

#### 影響範囲

- codiel 1.0.0-dev と raguel-mcp 0.0.2-dev を同じリリースで出す。
- ツールの入力が互換でないので、それより前に作った run は pass-gate が migrate で止める。旧 projectId のケースファイルと判例は引き継がない。
- 旧 DESIGN の原則「STOP は覆せない」は、改竄以外について上書きする。
- codex と Jev は ADR-005 の外部 API にあたり、選んだときだけ成果物が外部へ送られる。
- 既定の claude のパネリストは --setting-sources project で利用者の hooks・CLAUDE.md・プラグインを読まない。codex は止められず $CODEX_HOME/AGENTS.md を読む。
- Raguel は ADR-009 が集めた .codiel/config.json から raguel と testsDir を読み、設定の置き場を増やさない。
- E2E のレポート(<testsDir>/**/reports/**)は生成物と同じに扱い、評価から外す。
- run が active か awaiting_human の間、codiel の guard は .codiel/config.json・RAGUEL_CONFIG のファイル・ケースファイルの置き場への書き込みを拒む。

---

### ADR-012: [codiel] Raguel の LLM パネルを廃止し、Jev を推奨依存として内容を判定する

- 状態: 採用
- 決定日: 2026-10-01
- 決定者: phyllis998

#### 背景

codiel の run は、Raguel のゲートがパネルの完了を待つため遅い。パネルは claude -p を 2〜4 体、2〜3 回の待ちに分けて起動し、1 回の上限は 180 秒、ゲートの締切は 600 秒である。2026-09-28〜10-01 の判定 106 件のうち ASK は 28 件で、ルール層だけの ASK は 2 件、残りはパネルの所見(crosscheck 26 件など)と起動失敗・タイムアウト(22 件)だった。

#### 検討した選択肢

1. パネルを残す(ADR-011 のまま)
2. パネルを 1 体に減らして残す
3. パネルを廃止し、ルール層だけで判定する
4. パネルを廃止し、Jev が使える環境では Jev に成果物の内容を固定の問いで判定させ、使えない環境ではルール層だけで判定する(採用)

#### 採用した結論

- パネル(adversarial・steelman・crosscheck・meta)、claude と codex のプロバイダー、重さ判定(tier)を撤去する。
- 環境変数 TYPESAFE_API_KEY があれば Jev を使う。contextJudge.enabled は廃止する。
- Jev の内容判定は、評価の種別(code・plan・design・decision)ごとの固定の問いで行う。plan は test-spec とそれ以外で問いを分ける。閾値を外れた問いは定型文の ASK にする。
- Jev によるルール層の文脈判定補正は残す。
- Jev が無いとき、または失敗したときは、内容判定を行わずルール層だけで判定し、ASK にも degraded にもしない。
- 判例検索は tier に関係なく毎回行う。
- verdict は、ルールの stop → STOP、パイプラインの例外 → ASK(degraded)、ルールか Jev の ask → ASK、それ以外 → PROCEED の順に合成する。
- codiel は Jev を推奨依存とする。

#### 理由

パネルは遅さと誤検知の ASK の発生源だった。現行のモデルと Claude Code の権限機構は codiel を最初に設計した当時より精密になり、内容の水準の検査力を手放しても run の速さを取る(ユーザー判断)。Jev の内容判定は本文の問い合わせ 1 回に入り、リクエスト本数は文脈判定だけのときと変わらない。パネルを 1 体に減らしても claude -p の起動と応答の待ちは残る。ルール層の補正をやめると、決定論の引き下げ規則が拾わないソースコード中の文字列リテラルなどで、destructive-ops の誤検知が STOP のまま残る。

#### 影響範囲

- ADR-011 のうち、パネル・プロバイダー・重さ判定・Jev を既定で無効にする決定を置き換える。評価対象を自分で読むこと、pass-gate との照合、STOP の 4 種、ケースファイル、判例は ADR-011 のまま残す。
- 設定の judge.*・panel.*・weight.*・contextJudge.enabled を撤去する。残っていても読み込みエラーにせず、警告を残して無視する。
- 既知のケースファイル名から撤去したファイル名を消さない。消すと変更前のケースファイルが改竄扱いになる。
- 鍵がある環境では、伏せ字を当てた後の成果物が TypeSafe AI へ送られる(ADR-005)。codex のパネルで OpenAI へ送られる経路は無くなる。
- 内容判定の閾値は、過去に PROCEED になった成果物で較正してから確定する。
- 設計書: harness-docs/design/2026-10-01-codiel-run-speedup-design.md

---

### ADR-013: [codiel] Codiel は ADR と GOTCHAS を直接記録せず、候補を出して Metatron に渡す

- 状態: 採用
- 決定日: 2026-10-03
- 決定者: phyllis998

#### 背景

ARCHITECTURE と GOTCHAS の読み方・書き方・記録のタイミングについて、codiel と metatron の両方が指示を出しており、同じセッションに 2 つの指示が重なっていた。metatron は SessionStart で両文書と記録の CLI を注入する。codiel は、ARCHITECTURE と GOTCHAS をサブエージェントに読ませる規則と、run の失敗を GOTCHAS へ記録する手順(recording-gotchas の起動と、CLI の案内が無いときの <runsDir>/<slug>/unrecorded-gotchas.md への退避)を別に持っていた。2 つの指示が食い違ったとき、どちらに従うかが決まらなかった。ADR だけは、codiel が候補を書き、metatron が ADR へ移す分担になっていた(ADR-007)。

#### 検討した選択肢

1. codiel が metatron の CLI を呼び、GOTCHAS の台帳と ADR へ直接書く
2. codiel は何も残さず、記録は利用者と metatron に任せる
3. codiel は ADR 候補と GOTCHAS 候補を run の成果物に書き、state の knowledgeTarget(metatron | intents)で書き先を分けて渡す

#### 採用した結論

codiel の指示層は ARCHITECTURE と GOTCHAS を読ませず、書かせない。残すのは、ドメインマップの抽出と、review の委譲へ ARCHITECTURE のパスを渡すことだけとする。ADR 候補と GOTCHAS 候補は、knowledgeTarget を問わず try のローカルレポート(reports/adr-candidates.md・reports/gotcha-candidates.md)に書く。ADR 候補は intent-sync と、fix-loop で設計を変える修正を採ったときに書き、GOTCHAS 候補は発生した時点で書く。knowledgeTarget が intents のときは、intent-sync と finalize でローカルレポートの候補を持続層の領域ファイルへ全文で写してコミットする。候補は finalize の結果レポートと stop の完了報告に一覧する。

#### 理由

ARCHITECTURE と GOTCHAS の持ち主は metatron であり、codiel が別に規則を持つと、食い違ったときに従う側が決まらない。codiel が metatron の CLI を呼ぶと、metatron が無くても動く codiel の独立性(ADR-003)が崩れる。何も残さないと、run で起きた失敗が記録されずに消える。候補として渡せば、metatron の有無にかかわらず材料が残り、台帳へ移すかどうかは人と metatron が判断できる。

#### 影響範囲

ADR-009 の影響範囲にある未記録の GOTCHAS の退避先(unrecorded-gotchas.md)は使われなくなり、guard-write のその免除も外した。state の adrTarget は knowledgeTarget に改名し、互換を持たない。guard-write は、triage が passed で finalize が終わるまで、docs/intents/domains/** への書き込みを通す。持続層の GOTCHAS 候補を台帳へ移す走査は metatron に加える。
