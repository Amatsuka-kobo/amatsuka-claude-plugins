# ARCHITECTURE

## システム概要

あまつか工房が開発する Claude Code プラグインを配布する pnpm workspace のモノレポである。利用者は Claude Code のユーザーであり、提供するマーケットプレイスを通じてプラグインを導入する。各プラグインは Claude Code が読む宣言(skills / agents / commands / hooks)と TypeScript ソースを持ち、ソースは esbuild でバンドルして `scripts/` へ出力し git 管理下に置く。Anthropic API を使えないユーザーも全プラグインを使えることを必須要件とし、LLM を要する処理は Claude Code の機構か `claude` CLI のヘッドレス実行に閉じる。開発環境の用意とローカルプロキシの起動はルートの `scripts/` が担い、コードベース探索は Serena MCP が `.serena/` の設定とメモリを通じて担う。

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
- 指示層と参照層に、リポジトリルート固有のパスや他プラグインの名前を書かない。参照が要る内容は、プラグイン内に閉じた表現へ書き換える。例外は、プラグイン間の連携を前提に設計された `sandalphon` `codiel` `metatron` `gh-utility` の 4 プラグイン同士の言及のみ。

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
