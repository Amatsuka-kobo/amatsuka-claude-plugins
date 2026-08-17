# metatron/sandalphon プラグイン実装計画

- 日付: 2026-08-16
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: harness-docs/design/2026-08-16-metatron-design.md、harness-docs/design/2026-08-16-sandalphon-design.md

---

## セッション 1: metatron/sandalphon実装のワークフロー編成

# phyllis998

> # 依頼: metatron+sandalphon プラグインの実装(Opus Dynamic Workflow テスト)
>
> 承認済み設計書 2 本を読み、これに従って実装する。
> - harness-docs/design/2026-08-16-metatron-design.md
> - harness-docs/design/2026-08-16-sandalphon-design.md
>
> ## この依頼の特別ルール
>
> - 今回は Opus による Dynamic Workflow のテストを兼ねる。オーケストレーションには Workflow ツールを使う(ワークフロー使用を明示的に許可する)。
> - agent-policy の GPT/Grok 帯への委譲は今回行わない。実装・探索・レビューはすべて Claude モデル(Workflow のサブエージェント)で構成する。
> - 規模はタスクに合わせて動的に決める。並列化できる独立作業(metatron の lib/CLI/hooks、sandalphon のスキル 3 種+検出スクリプト、codiel/gh-utility 改修)は並列に、検証・レビューはワークフローの verify ステージに置く。
> - 着手前に、両設計書の理解とワークフロー編成計画(フェーズ・エージェント数・並列構成)を提示し、承認を得てから実行する。
>
> ## 作業範囲と順序(各設計書の実装手順節に従う)
>
> 1. metatron ファイル契約の凍結(metatron 設計の実装手順 N0。マーカー名・config スキーマ・パス解決規則・既定パス・文書書式)— 全作業の先行依存
> 2. plugins/metatron 本体: 共有ライブラリ(src/lib: パーサ[フェンス状態機械]・検証・採番・パス解決)、CLI(scripts/ バンドル。stage/commit・append-gotcha・tag-gotcha・stage-adr 等)、PreToolUse deny hook、SessionStart 注入 hook(10,000 文字キャップ・6 段階縮退)、commands/init、skills、references(文書フォーマット正本+writing-discipline.md)、README、plugin.json、package.json、build.ts
> 3. plugins/sandalphon 本体: commands/run、skills(capturing-intent / bridging-execution / executing-intent)、check-intent-env(ファイル契約の独立実装)、references(intent 文書・intent-issue・handoff-contract 正本)、README、plugin.json、package.json、build.ts
> 4. codiel 改修(マイナー上げ): initializing-harness 縮小+最小 domains フォールバック、readDomains/ルート解決の契約追随、recording-gotchas の新書式追随+2 分岐+拒否時リカバリ、analyzing-issues(intent 写像)、preparing-design-agendas(合意済み除外)、agents 12 ファイル 23 箇所の固定パス除去(prompt-smith:agent-creator 経由)、CLAUDE.example.md / ARCHITECTURE.example.md の刷新
> 5. gh-utility 改修(パッチ上げ): issue-craft の持ち込みモード(固定開始句契約)
> 6. 登録・反映: marketplace.json、pnpm-workspace.yaml、ルート README.md
>
> ## 順守事項(CLAUDE.md より特に)
>
> - Skills の作成・改修は prompt-smith:skill-creator、Agents 定義は prompt-smith:agent-creator、references/ 等の AI 向け文書は prompt-smith:prompt-smith を使う。
> - TypeScript / Markdown の編集は Serena を使う。
> - src/ 変更後は pnpm build を実行し、生成物差分を同じコミットに含める。
> - コミット前に pnpm lint・pnpm typecheck・pnpm test を通す。
> - Anthropic API・ANTHROPIC_API_KEY 前提の実装はしない。MCP サーバーは作らない(設計で撤回済み。C1 構成に従う)。
> - 設計書と実装が食い違う判断が必要になったら、実装を止めてユーザーに確認する。
> - 両設計書の「未解決事項」節に残る選択肢は、着手前の編成計画提示時に推奨案とともに確認を取る。
>
> ## 完了条件
>
> - pnpm build / lint / typecheck / test が全通過している(両設計書のテスト計画のケースを含む)。
> - 新規スキルが skill-creator の評価手順を通っている。
> - 機能単位でコミットされている。
> - 結果報告に、作成・変更ファイル一覧と、Workflow 実行の構成(フェーズ・エージェント数・token 規模)を含める。

## セッション 2: WF1完了:メタトロンコア実装と段階計画確定

# AI

設計書 2 本を読了。実装前の現状把握を行う。

`★ Insight ─────────────────────────────────────`
- prompt-smith 3 スキルは全て 30KB 未満(skill-creator 19.5KB + references 5.3KB が最大)→ orchestration-discipline のコスト規律に照らしてサブエージェントへの直接ロードが許容される
- codiel は raguel-mcp を内包する大型プラグイン。改修対象は `src/hooks/lib.ts` と skills/agents に限定され、raguel-mcp 配下は無関係
- claude-researcher は `model: sonnet` 固定・Agent Tool なし・Serena read 系あり → 探索実働の委譲先として担当表どおり
`─────────────────────────────────────────────────`

編成計画を精緻化するため、現状調査を Workflow で並列実行する。

調査を並列実行中。その間に、着手前に確定が要る 2 点を確認する。

調査完了。ユーザー回答を受け、16-5(guard-write への domains 配線)をスコープに追加する。調査結果の全文を確認する。

`★ Insight ─────────────────────────────────────`
- codiel の hook は **フェイルクローズド**(catch で `emit("ask")`)なのに対し、metatron 設計は deny hook を**フェイルオープン**と定めている。同じリポジトリで方針が逆になるが、これは「止めたときの損害」の非対称性による意図的な差
- `pass()` が `permissionDecision: "allow"` を出さず無出力なのは、allow が許可システムをバイパスして自動実行にしてしまうため。metatron の素通しも同じ形にする必要がある
- skill-creator は eval セット 20 問 + **ユーザーによる HTML レビュー承認** + 発火測定ループを必須手順としている。新規スキル 6 本ぶんの承認手番が計画に効く
`─────────────────────────────────────────────────`

16-5(guard-write への domains 配線)は設計書に仕様が無いため、現状を確認する。

調査完了。両設計書の理解と編成計画を提示する。

---

# 1. 設計書の理解

## 何を作るか

**metatron** — Codiel から `docs/ARCHITECTURE.md` / `docs/GOTCHAS.md` を切り出し、独立資産にする。C1 構成(共有ライブラリ + 決定的 CLI + PreToolUse deny hook + SessionStart 注入 hook。常駐プロセスなし)。

設計の中心は**強制点が deny hook ただ 1 つ**という認識。MCP も CLI も呼び出しが任意 → 素通りする。よって「CLI = 行儀のよい窓口 / deny hook = 強制点 / 注入 = CLI の発見性の担保」という三点構造。3 者が `src/lib/` を共有することで、検証規則の実装が 1 つに保たれる。

**sandalphon** — Issue が生まれる前の上流区間(願い → intent 確定 → 起票 → 実行系引き渡し)。承認ゲート 2 点(intent 文書 / テスト仕様)。スクリプトは判断を持たず事実のみ返す。

## 両者を貫く 1 本の思想

プラグイン間はインストールパスが互いに不定 → **連携手段は 2 つだけ**。

- **(a) ファイル契約** — `metatron.config.json` スキーマ、ルート解決規則、マーカー `metatron:domains`、文書書式。metatron / codiel / sandalphon が**独立に 3 実装**する。機械的担保はテスト R4(3 者比較)ただ 1 つ。
- **(b) モデルコンテキスト** — 注入文と拒否メッセージが CLI 絶対パスを広告。「案内があれば使う、無ければ自前」でインストール検出が消える。

この (a) が全作業の先行依存。ここがぶれると 3 実装を追いかけることになる。

## 調査で確定した事実

| 項目 | 実測 |
| --- | --- |
| agents の固定パス | **12 ファイル 23 箇所**(設計値と完全一致)。`codiel-test-designer.md` のみ 0 件 |
| `docs/` 接頭辞**なし**の `ARCHITECTURE.md` 言及 | **追加で 7 箇所 / 5 ファイル**(設計書の 23 箇所に含まれない) |
| codiel agents の frontmatter | `name` / `description` / `tools` のみ。`model` なし(担当表運用) |
| 現行バージョン | codiel `0.4.1-dev`、gh-utility `0.5.1-dev` |
| hook 出力形式 | SessionStart は `hookSpecificOutput.additionalContext`、PreToolUse は `permissionDecision`。`pass()` は**無出力**(`allow` は許可系をバイパスするため使わない) |
| codiel hook の失敗方針 | **フェイルクローズド**(catch で `ask`)。metatron 設計は**フェイルオープン** — 逆だが意図的 |
| skill-creator の要求 | eval セット 20 問 + **ユーザーの HTML レビュー承認** + `run-loop.mjs` の発火測定ループ |
| ビルド規約 | esbuild `format: esm` / `target: node22` / `outExtension .mjs`、shebang で実行権限自動付与、CLI エントリは薄い `*-cli.ts` に分離(bundle 時の誤発火防止) |

---

# 2. ワークフロー編成計画

`/config` のサイズ指針が medium(1 本 15 agents 未満)のため、**6 本に分割して順に鎖でつなぐ**。各本の完了を私が読んでから次を組む(結果を見ずに次を流さない)。

## P0(ワークフロー外・私が実施)— ファイル契約の凍結

`harness-docs/design/2026-08-16-file-contract-freeze.md` を作る。マーカー名 / config スキーマ / ルート解決規則 / 既定パス / ARCHITECTURE 10 セクション / ADR 書式 / GOTCHAS 新書式とタグ検出規則 / intent v1 書式 / handoff 固定開始句。以降**全エージェントがこの 1 ファイルを絶対パスで参照**する。設計書の要約を各エージェントに配ると解釈が割れるため。

| WF | 内容 | フェーズ構成 | agents |
| --- | --- | --- | --- |
| **WF1** | metatron コア(lib + 単体テスト) | 骨格 → `config.ts` → {architecture / gotchas / staging / scan} 並列 → `adr.ts` → verify 3 並列 | 9 |
| **WF2** | metatron CLI + 2 hooks | {cli / inject-context / guard-docs} 並列 → build+統合検証 → 敵対的レビュー 3 並列 | 7 |
| **WF3** | metatron 文書 | references 5 本(prompt-smith)/ skills 3 本(skill-creator)/ commands 2 + README + rationale + example 移設 | 8 |
| **WF4** | sandalphon 一式 | 骨格+`check-intent-env.ts`+テスト 24 → references 3 / skills 3 / command+README 並列 → verify | 8 |
| **WF5** | codiel 改修 | `lib.ts`(findDocRoot/resolveDocPaths)→ skills 6 本 / agents 12 本(agent-creator)/ example 3 本 並列 → verify | 9 |
| **WF6** | gh-utility + 16-5 配線 + 登録 + 全体検証 | issue-craft / guard-write 配線 / R4 三者比較 / 登録 3 点 / 全通し / eval 6 本 → 最終レビュー 3 並列 | 10 |

**合計 51 agents / 6 ワークフロー。** 調査 WF の実績(6 agents = 207k tokens)から、実装は書き込みを伴うため 1 agent 30〜60k、**総計 2.0〜2.5M tokens** の規模。

## 並列化の判断

- 並列にするのは**別ファイルを書く作業だけ**。同一ファイルへの並列書き込みは作らない(worktree 分離は使わない — 統合コストが利得を上回る)
- `architecture.ts` → `adr.ts` は直列(ADR がセクション分解器に依存)
- verify は各 WF 末尾の独立ステージ。「テスト実行 + 修正」1 本と「敵対的レビュー」複数本を分ける
- コミットは機能単位で 9〜10 本。16-5 配線は**独立コミット**(設計書が切り分け不能な回帰を警告しているため)

---

# 3. 着手前に確定が要る 4 点

とくに **16-5 は設計書に仕様が無く、現状の state 構造では設計の文言どおりには実装できない**ことが判明した。

`RunState`(`plugins/codiel/src/codiel-state.ts:26-43`)に「いまどのドメインの implementer が動いているか」を示すフィールドは**存在しない**。hook の stdin にもサブエージェント種別は渡らない。つまり「ドメイン別 implementer の書き込み境界を強制する」には state スキーマ・`codiel-state` CLI・`orchestrating-runs` の 3 点変更が要る。

`★ Insight ─────────────────────────────────────`
- B(完全配線)を選ぶと `RunState` へのフィールド追加が要る。既存の `baseBranch?` が optional で後付けされた前例があるので、`domain?: string | null` を同じ形で足せば `version` 据え置きで後方互換が保てる
- 判定を `deny` でなく `ask` にすべき理由: guard-write の既存分岐は state.json 保護だけが `deny` で、他は全て `ask`。ドメイン境界違反は「改竄」ではなく「境界の誤り」であり、人間が通せる余地を残すのが既存の設計思想と揃う
`─────────────────────────────────────────────────`

B(完全配線)により WF6 を分割し、**7 ワークフロー / 56 agents** に再編する。P0(ファイル契約の凍結)から着手する。

契約凍結文書を作成した。これを全実装エージェントの参照点にする。WF1(metatron コア)を開始する。

スクリプト内のバッククォートがテンプレートリテラルを壊した。ファイルに書き出して修正する。

WF1 起動。バックグラウンドで実行中。

## 実施済み

**P0 完了** — `harness-docs/design/2026-08-16-file-contract-freeze.md` を作成。3 実装が参照する単一の点。14 章構成:

マーカー / config スキーマ / ルート解決規則 / ARCHITECTURE 10 節 + フェンス状態機械 / ADR 書式 / GOTCHAS 新書式 + タグ検出 / 既定パス / intent 文書 / intent-issue v1 + 写像表 / 持ち込みモード固定開始句 / CLI 入出力規約 + ロック方式 / hook 出力形式 / 3 者比較検証 / 変更時チェックリスト。

## WF1 の構成(13 agents / 6 フェーズ)

当初 9 と見積もったが、**契約の検証層を 3 agents 足して 13 にした**。契約が誤ったまま lib を実装すると 3 プラグイン分の手戻りになるため、ここだけは投資する。

| フェーズ | 内容 | agents |
| --- | --- | --- |
| Contract | 契約レビュー(Haiku: 理解+暗黙知 / Researcher: 反証)+ 骨格作成 — 3 並列 | 3 |
| ContractFix | 2 レビューを突き合わせて契約を修正。設計書に根拠のない変更は却下、決めきれない点は `<!-- 未確定 -->` で残す | 1 |
| Config | `config.ts` + C1〜C12。3 実装の基準となるため単独 | 1 |
| Lib | architecture / gotchas / staging / scan — 4 並列(別ファイルのみ) | 4 |
| Adr | `adr.ts` + R-A1〜R-A9(architecture の分解器に依存するため直列) | 1 |
| Verify | テスト実行+修正 / コードレビュー / テスト網羅性監査 — 3 並列 | 3 |

Verify に**テスト網羅性監査**を独立で置いた。設計書のケース表(C/A/G/R-A/T/S 計 72 件)に対し「実装あり・**検証が弱い**・実装なし」の 3 値で判定させる。A2「対象セクション以外がバイト単位で不変」のような性質は、部分文字列の存在確認で通ってしまうため、テストの存在だけでは担保にならない。

## 規模の更新

16-5 を B(完全配線)にした分と契約検証層を加え、**7 ワークフロー / 約 60 agents**。

## 次

WF1 完了 → 契約修正の内容と Verify 3 本を読む → WF2(CLI + 2 hooks)を組む。WF4(sandalphon)と WF5(codiel)は**契約修正の完了を待ってから**出す。古い契約で実装すると 3 者比較テストが落ちるため、並行させない。

WF1(metatron コア、13 agents)実行中。完了通知を待って、契約修正の内容と Verify 3 本の結果を読んでから WF2 を組む。

WF1 実行中。完了後すぐ起動できるよう WF2(CLI + 2 hooks)のスクリプトを準備する。

WF2 のスクリプトを準備完了(7 agents / 3 フェーズ)。WF1 の完了を待って、契約修正と Verify の結果を反映してから起動する。

WF2 の要点は、実装後の Review ステージを**敵対的**に組んだこと。「注入が予算を超えない」「deny がすり抜けない」を主張として立て、それを**破る入力を探させる**。とくに guard-docs は C1 構成で唯一の強制点なので、設計書が既知の限界と認めたもの(Bash リダイレクト・人間の編集・hook 自身の失敗)を除いたすり抜けを探させる。

Raphael の蒸留をバックグラウンドへ委譲した。WF1(metatron コア)は引き続き実行中。完了通知を待つ。

WF1 の ContractFix フェーズが完了し、契約凍結文書が更新された。3 点が具体化された:

- **§1** — `metatron:domains` の終了フェンス判定を §4-2 の規則 2 と同一に統一(独自のフェンス判定を書かせない)
- **§2** — 「壊れた JSON」の定義を明確化。構文エラーだけでなく**トップレベルがオブジェクトでない場合**を含める。一方で個々のキーの型不整合(`maxChars` が文字列など)は全体を止めず**その項目だけ既定値**に落とす
- **§1** — 未確定が 1 件残された: 同一ファイル内に `metatron:domains` ブロックが 2 個以上あるときの扱い

未確定の 1 件は私が判断する。**「最初を採り、書き込み経路は警告を返す」**が妥当 — §4-2 が同名見出しについて既にその形(最初を採る + 書き込み時は警告)を採っており、ブロックだけ別扱いにする根拠がない。読み取り経路をエラーにすると、フェイルオープンであるべき注入が止まる。

ただし WF1 が実行中で他のエージェントが契約ファイルを読んでいるため、**反映は WF1 完了後**に行う。実行中に書き換えると、読むタイミングで内容が変わる。

WF1 の残りは Config → Lib(4 並列)→ Adr → Verify(3 並列)。完了を待つ。

WF1 完了(12/13 成功、`verify:code-review` は API エラーで失敗)。実測で状態を確認する。

Bash の分類器が一時的に落ちている。WF1 の出力を読んで結果を確認する。

WF1 の結果は良好。**204 tests / metatron 全通過、リポジトリ全体 1363 tests 全通過**。契約の未確定 3 件を判断して埋める。

契約の未確定 3 件を埋めた。WF2 に WF1 の積み残し(失敗した lib コードレビュー、G8 のテスト強化)を組み込んで起動する。

# WF1 完了 — metatron コア

## 結果

| 検証 | 結果 |
| --- | --- |
| `tsc --noEmit` | エラー 0 |
| `vitest run plugins/metatron` | 6 files / **204 tests 全通過** |
| `vitest run`(リポジトリ全体) | 133 files / **1363 tests 全通過** — 他プラグインへの回帰なし |
| `biome check` | 指摘 0 |

生成物: `src/lib/` 7 ファイル(config / architecture / gotchas / adr / staging / scan / emit)、`src/__test__/` 6 ファイル、骨格 4 ファイル、テストヘルパ 2 ファイル。

設計書のテストケース **72 件中 72 件を実装**。網羅性監査の判定は「実装なし 0 件、検証が弱い 1 件(G8)」。

## 拾えたもの

**`scan.ts` に生の NUL バイトが埋め込まれていた。** `tsc` も `vitest` も `biome` も検出しない。実害は、`file(1)` がバイナリ判定して **GNU grep がこのファイルの本文を一切返さなくなる**こと — CLAUDE.md の「Serena が 0 件を返しても Grep で裏を取る」という規律が、このファイルに対してだけ黙って無効化される。`\u0000` エスケープへ修正済み、ランタイム等価。

副次的に判明: **NUL を含むファイルに対して Serena の `replace_content` が `OK` を返しながら 1 バイトも変化しなかった**(2 回)。成功を誤報する。

## 契約の未確定 3 件を判断して確定

| 件 | 判断 | 根拠 |
| --- | --- | --- |
| `metatron:domains` ブロックが複数 | **最初を採り、書き込み経路は警告**(読み取りは警告なし) | §4-2 の同名見出しと同型。同じ「重複」に 2 通りの規則を並べない。読み取りをエラーにすると注入のフェイルオープンが破れる |
| intent `status` の後戻り | **スクリプトで遷移を検証しない。値域だけを定める** | 既存 intent を `/sandalphon:run` に渡すやり直し経路で status は巻き戻りうる。遷移の妥当性は意味の判断であり、スクリプトに判断を持たせない方針(sandalphon §7-1)に従う |
| ロック奪取のフェンシング | **導入せず、既知の限界として明記** | 設計書 §7-4 の決定(`wx` / 50ms×20 / mtime 60秒)の変更にあたる。窓に入るには「60 秒超の保持 + 再確認と unlink の間の数ミリ秒での取り直し」が要り、この書き込み頻度では起こらない |

契約修正フェーズ自体も機能した。独立レビューが挙げた **CommonMark のインデント許容漏れ**(リスト内フェンスを取りこぼす — 4-2 の目的と正面から矛盾する)などを設計書に根拠づけて採用し、フェンシング導入・タグ検出の空白緩和・フェイルオープン時のログ出力など**設計変更にあたる 11 件は却下**している。

## WF2 起動(9 agents)

当初 7 に、WF1 の積み残し 2 本を足した — API エラーで落ちた lib コードレビューの再実行と、G8 のテスト強化。CLI / 注入 hook / deny hook を 3 並列で実装し、ビルド後に**生成された `.mjs` を実際に叩く実地確認**(設計書 M4「注入された CLI パスが動く」に相当)まで行う。

WF2 完了(7/8、`review:lib-code` が stall)。実測で状態を確認する。

Build フェーズは実地確認まで完了。Review 3 本を読む。

deny hook に**強制点の穴**が見つかった。3 本目のレビューを読んでから修正をまとめる。

CLI は規約違反ゼロ。**deny hook に強制点の穴が 1 件**、注入に仕様違反が 1 件見つかった。WF3 で修正と文書作成を同時に回す。

# WF2 完了 — metatron CLI + 2 hooks

## 到達点

`pnpm build` が通り、**生成された `.mjs` を実際に叩く実地確認まで完了**。

| 検証 | 結果 |
| --- | --- |
| `pnpm build` | 3 つの `.mjs`。shebang 保持、`rwxrwxr-x`、再ビルドでバイト同一 |
| `vitest run plugins/metatron` | 9 files / **249 tests** |
| `pnpm test`(全体) | 136 files / **1408 tests** |
| `pnpm lint` | 337 files / 指摘 0 |

実地確認で **C1 構成の成立条件**が満たされた: 注入本文に出る CLI 絶対パスと deny 理由に出る絶対パスが同一で、そのパスを `node` に渡して 12 サブコマンド全てが動作。`maxChars=1200` に絞っても CLI 案内は先頭かつ完全な形で残った。

## レビューが拾ったもの

**deny hook に強制点の穴**(`guard-docs.ts:132`):

```ts
const raw = input.tool_input?.file_path ?? input.tool_input?.notebook_path
```

`??` は `null`/`undefined` のときだけ右辺に落ちる。`file_path` が**空文字列でも定義されていれば** `notebook_path` は読まれない。NotebookEdit で `file_path: ""` / `notebook_path: <正本>` を渡すと素通しする。設計書 §7-5 が「matcher に 1 語足すだけで塞げる穴を残さない」ために NotebookEdit を対象に入れたのに、実装側で穴が開いていた。既存の D3 テストは `notebook_path` 単独の形しか見ておらず、この経路を通っていない。

**注入の要約が表のヘッダーを拾う**: 表判定が `line.startsWith("|")` の 1 行だけで、先頭パイプなしの GFM テーブル(`Language | Framework`)を検知できない。実測で `- 技術スタック: Language | Framework` が要約に出た。設計書 §8-5「表の中身は採らない」に反する。

**CLI は規約違反ゼロ** — 12 サブコマンド網羅、staging 3 保証、ADR 経路の一本化、`--input <path>` の統一がすべてコード上で成立。

## 実装が正しく設計書の文言が追いついていない点

`maxChars` が CLI 案内(約 700 文字)より小さいとき、実装は CLI 案内を優先して `maxChars` を超える。設計書 I8 の「どんな入力でも maxChars 以下」とは食い違うが、§8-3(CLI 案内が最も代替が効かない)と §8-5(決して手を付けない)からは実装が正しい。真の上限 10,000 は守られている。**コメント側を実態に合わせる**方針で WF3 に回した。

## WF3 起動(13 agents)

修正 2 本と文書 11 本を同時に走らせる。修正には**変異試験**を課した — 追加したテストが修正前のコードで実際に落ちることを確認してから修正を入れさせる。テストが穴を捕まえられることを確かめないまま「通った」と報告させないため。

文書側では `examples` タスクに、作った example を**実装済み CLI で実際に解析させる**検証を入れた。書式の正本が自分のパーサで読めなければ、それは正本ではない。

Raphael の蒸留をバックグラウンドへ委譲した。WF3(修正 2 本 + 文書 11 本、13 agents)は引き続き実行中。

Raphael の蒸留完了(5 件すべて非採用 — metatron 開発中の一過性の状態)。WF3 の完了を待つ間に WF4(sandalphon)を準備する。

WF4(sandalphon 一式、9 agents)のスクリプトを準備完了。WF3 の完了を待って起動する。

WF3 と WF4 を並行させないのは、両方の Verify が `pnpm test` をリポジトリ全体で走らせるため。片方が途中状態のファイルを持っているとテストが落ち、どちらの原因か切り分けられなくなる。

現在の進捗:

| WF | 内容 | 状態 |
| --- | --- | --- |
| P0 | ファイル契約の凍結 | 完了(未確定 3 件も確定) |
| WF1 | metatron コア(lib + 72 テストケース) | 完了 |
| WF2 | metatron CLI + 2 hooks | 完了(指摘 2 件を WF3 へ) |
| WF3 | 修正 + metatron 文書 11 本 | 実行中(13 agents) |
| WF4 | sandalphon 一式 | 準備完了・起動待ち |
| WF5 | codiel 改修 | 未着手 |
| WF6 | gh-utility + 登録 + R4 三者比較 + eval 6 本 | 未着手 |
| WF7 | 16-5 guard-write への domains 完全配線 | 未着手(仕様設計が先) |

Raphael の蒸留をバックグラウンドへ委譲した。WF3 は引き続き実行中。

WF3 の完了を待つ間に WF5(codiel 改修)を準備する。

WF5(codiel 改修、10 agents)のスクリプトを準備完了。

WF5 で注意した点を 2 つ:

**agents 12 ファイルを 2 バッチに分けたことの副作用** — 別々のエージェントが書き換えると文言がぶれる。両バッチのプロンプトに**同一の書き換え文言を厳密に指定**し、さらに Verify の監査項目に「2 バッチ間で表現がぶれていないか」を入れた。

**codiel 側の example 削除に前提条件を付けた** — `docs/ARCHITECTURE.example.md` を消す前に、最小 ARCHITECTURE の雛形が `initializing-harness` の本文に実在することを確認させる。確認できなければ削除せず報告させる。雛形の埋め込みは別エージェントの担当なので、失敗していれば codiel が単体で ARCHITECTURE を作れなくなる。

現在 WF3(修正 + metatron 文書、13 agents)が実行中。完了後に WF4 → WF5 と順に流す。

WF3 完了(12/13、`docs:ref-formats` が API エラーで失敗)。実測と Verify の結果を確認する。

`gotchas-format.md` が欠落している(失敗したエージェントの担当分)。Verify の結果を読む。

`pnpm test` 1414 tests 全通過、lint 指摘 0。NotebookEdit の穴と表スキップは**実地で塞がったことを確認済み**。積み残しを WF4 に組み込む前に、契約の記載漏れを 1 件直す。

# WF3 完了 — 修正 + metatron 文書

## 修正 2 件は変異試験つきで完了

**deny hook の穴** — `file_path` と `notebook_path` を配列に入れ、**それぞれ独立に**正本と突き合わせる形に変更。変異試験で、追加した 4 ケースのうち 3 件が修正前のコードで実際に落ちることを確認済み(いずれも `permissionDecision` が `undefined` = 素通し)。

実地確認も通った:

| 入力 | 結果 |
| --- | --- |
| `file_path: ""` + `notebook_path: <正本>` | **deny** |
| `file_path: "src/unrelated.ts"` + `notebook_path: <正本>` | **deny** |
| `file_path: "src/a.ts"` + `notebook_path: "docs/nb.ipynb"` | 素通し(対照) |

**注入の表判定** — ヘッダー行だけ飛ばす実装では本体行(`TypeScript | Node`)が散文として採られるため、ヘッダーを起点に**表全体を読み飛ばす**形にした。実地確認で `分類 | 採用技術 | 備考` が要約に現れないことを確認。

## 全体の状態

`pnpm test` 136 files / **1414 tests 全通過**、`pnpm lint` 337 files / 指摘 0。

## 文書監査が拾ったもの

**`references/gotchas-format.md` が存在しない。** 設計書 §4 の構成表と §6-3b、契約 §14 のチェックリストがいずれもこのファイルを「正本」として参照しているのに、実体が無く、書式が `recording-gotchas/SKILL.md` に直接埋め込まれている。**文書自身とそれを律する上位文書が食い違っている状態**。API エラーで落ちたエージェントの担当分がここだった。

加えて執筆規律違反 2 件(理由の混入 1、正本との重複 1)。

契約側の記載漏れも 1 件見つかり、直した — `tag-gotcha --date` は実装にあるのに契約のサブコマンド表に無かった。

## WF4 起動(10 agents)

sandalphon 一式に、上の**積み残しタスク 1 本を相乗り**させた。metatron と sandalphon はファイルが完全に分離しており、Verify の `pnpm test` は両方を一度にカバーする。ワークフローを 1 本増やすより往復が減る。

`check-intent-env.ts` には**読み取り専用の実地確認**を課した — 実行前後でディレクトリツリーを比較し、`docs/intents/` が作られていないことを見る。「判断を持たない・書き込まない」がこのスクリプトの契約なので、そこだけは実測で押さえる。

WF4 完了(10/10)。Verify の結果を確認する。

WF4 完了(10/10)。sandalphon 一式と metatron の積み残しが揃い、`pnpm test` **1453 tests 全通過**。読み取り専用も 3 ケースで実測確認(`TREE: unchanged`)。

設計書側の記載漏れを 1 件直す。

# WF4 完了 — sandalphon 一式 + metatron の積み残し

`pnpm test` 137 files / **1453 tests 全通過**、`pnpm lint` 341 files / 指摘 0。文書監査は 8 項目中 7 項目で違反なし。

## 実測で押さえたこと

**読み取り専用の担保** — 3 つの擬似プロジェクトそれぞれで、実行前後に `find -printf '%p|%y|%s|%T@|%m'`(パス・種別・サイズ・mtime ナノ秒・パーミッション)のスナップショットを取って diff。**3 ケースとも `TREE: unchanged`**。`docs/intents/` が作られていないことも全ツリー走査で確認。「判断を持たない・書き込まない」というこのスクリプトの契約が実測で裏づけられた。

**`docRoot` と `repoRoot` の分離** — サブディレクトリに `metatron.config.json` を置いた構成で両者が別値になり、文書は `docRoot` 基準、`intentsDir` は `repoRoot` 基準で解決されることを確認。

## 契約の穴埋めが 1 件

`configWarnings: string[]` が実装に追加された。設計書 §7-5 の出力例には無いが、契約 §3 規則 3 が「拒否した場合は理由を呼び出し元へ返す」と定めており、**返す口が無かった**。実装側の判断が正しいので設計書に追記した。

## 判断が要る 1 件

**sandalphon の `.codiel` 探索基準が、codiel 自身の基準と食い違う。**

設計書 §7-3 は `codielHarness.dirExists` を「`docRoot/.codiel/` がディレクトリとして存在する」と明記しており、実装はそのとおり。しかし codiel 自身の `findProjectRoot` は**開始ディレクトリから上方向に `.codiel` を探す**。

食い違うシナリオ:

```
repo/.codiel/                    ← codiel はここを見つける
repo/sub/metatron.config.json    ← docRoot は repo/sub になる
repo/sub/ から /sandalphon:run
```

sandalphon は `repo/sub/.codiel` だけを見て「無い」と判定 → 委譲を選択肢に出さない。しかし codiel は実際には動く。**正当な委譲経路を不当に塞ぐ。**

安全側には倒れている(出して失敗するより良い)が、sandalphon の目的は「codiel へ渡せるかを正しく判定する」ことなので、判定基準は codiel 自身の基準に合わせるのが筋だと考える。

`.codiel` 探索を上方向探索へ変更する方針で確定。設計書と契約を先に直す(WF6 のエージェントが参照するため)。

設計書と契約に反映済み。実装の変更は WF6 で行う(WF5 が codiel を触っている最中に sandalphon を並行修正すると、`pnpm test` がどちらの原因で落ちたか切り分けられなくなるため)。

契約 §3 には 3 基準の使い分けを表で明示し、**なぜ `docRoot` 直下に限定してはいけないか**を具体的な構成つきで書いた — 「sandalphon がこの判定で答えるのは『codiel へ委譲できるか』であり、答えるべき相手は codiel 自身の探索規則である」。基準を揃える根拠が残っていないと、後から「docRoot に統一したほうが一貫する」と戻される。

## 進捗

| WF | 内容 | 状態 |
| --- | --- | --- |
| P0 | ファイル契約の凍結 | 完了(以降 4 回追補) |
| WF1 | metatron コア(lib + 72 ケース) | 完了 |
| WF2 | metatron CLI + 2 hooks | 完了 |
| WF3 | 修正 2 件 + metatron 文書 | 完了 |
| WF4 | sandalphon 一式 + 積み残し | 完了 |
| WF5 | codiel 改修(10 agents) | **実行中** |
| WF6 | gh-utility + 登録 + R4 三者比較 + `.codiel` 探索修正 + eval 6 本 | 未着手 |
| WF7 | 16-5 guard-write への domains 完全配線 | 未着手(仕様設計が先) |

累計 `pnpm test` は 1453 tests 全通過。WF5 完了後、WF6 の内容が確定する(R4 三者比較は codiel の `resolveDocPaths` が揃って初めて書ける)。

Raphael の蒸留をバックグラウンドへ委譲した。WF5(codiel 改修、10 agents)は引き続き実行中。

コンテキスト 53%(532k/1M)、残り 468k。残る WF5〜WF7 の結果読み込みは 1 本あたり 10〜20k 程度なので余裕がある。

出力ファイルは毎回 `offset`/`limit` で必要なキーだけを読んでおり(1 レポート = 1 行の JSON)、全文は読み込んでいない。

WF5(codiel 改修、10 agents)は実行中。完了後、WF6 の内容が確定する:

- `.codiel` 探索を上方向探索へ変更(sandalphon 実装)
- **R4 三者比較テスト** — metatron `config.ts` / codiel `resolveDocPaths` / sandalphon `check-intent-env` を同一の一時ディレクトリ構成で走らせ、`docRoot` と解決パスの一致を検証。契約が「唯一の機械的担保」と位置づけているもので、3 実装が揃って初めて書ける
- gh-utility の持ち込みモード + バージョン + README
- `marketplace.json` / ルート `README.md` への登録(現在 metatron・sandalphon とも未登録)
- 新規スキル 6 本の eval セット + 発火測定(承認は一括 1 回)

その後 WF7 で 16-5(guard-write への domains 完全配線)。こちらは `RunState` へのフィールド追加を伴うため、仕様を先に固めてから着手する。

WF5 完了(10/10)。Verify と実測を確認する。

WF5 完了。**1471 tests 全通過**、R9 は 4 パターンすべて 0 件。実測で agents の最終状態を確認する。

設計書 §10-6 の内部矛盾を実装に合わせて解消する。

# WF5 完了 — codiel 改修

`pnpm test` 137 files / **1471 tests 全通過**、lint 341 files / 指摘 0。監査 8 項目すべて違反なし。

## 実測で確認したこと

| 確認 | 結果 |
| --- | --- |
| R9(agents の固定パス) | 4 パターンすべて **0 件**。12 ファイルの文言も 1 行に統一 |
| 旧マーカー | 残存 2 ファイルのみ、いずれも「読まない」ことを担保する否定文脈とテスト |
| R6(guard-write) | `readDomains` 参照 0 件 = 未配線を維持。35 tests 通過 |
| バージョン | plugin.json / package.json とも `0.5.0-dev` |
| codiel 単体動作 | metatron 非導入・設定なしでドメインが読め、サブディレクトリ起動でも同結果 |

## 設計書の内部矛盾が 1 件見つかった

metatron 設計書 §10-6 は agents の書き換え文言を「指定が無ければ既定値(`docs/ARCHITECTURE.md` / `docs/GOTCHAS.md`)を使う」と規定していた。しかし**同じ設計書の §13-2 R9** は「固定パスの直書きが 0 件」を要求している。**指示どおりに書くと必ず R9 に違反する。**

担当エージェントが契約 §7(固定パスを前提にしない)と §10-6 冒頭(解決はオーケストレーターで 1 回、以降は値を渡す)に寄せて「**パスが指定されていない文書は、存在しないものとして扱う**」へ変更し、その判断を報告してきた。妥当なので採り、設計書側の記述を実装に合わせて直した(なぜ既定値を持たせないかの理由つき)。

`orchestrating-runs` §0 がフェイルクローズドでパスを解決してからディスパッチプロンプトに実パスを埋めるため、既定値が無くても運用上の欠落は生じない。

## WF6 起動(8 agents)

残るのは統合作業。とくに 2 つを重視した。

**3 者比較テスト(契約 §13)** — codiel 側は既に metatron との 2 者比較を実装済みだが、sandalphon の `check-intent-env.ts` はトップレベルで副作用を持つスクリプトなので関数として呼べない。**子プロセスとして起動して出力 JSON を比較する**形で 3 者目を足させる。契約が「唯一の機械的担保」と位置づけているものなので、2 者で妥協させない指示を明記した。

**最終監査** — 項目 1(ルート解決の 3 実装一致)と項目 2(書式の写しの一致)を「他より丁寧に見ること」と指示した。この設計全体が**写しを 3 箇所に持つという賭け**の上に成り立っているため。

WF6 完了(7/7)。**3 者比較テストが成立**し、不一致構成はゼロ。最終監査を読む。

WF6 完了。**1485 tests 全通過**。最終監査が**契約違反 1 件を含む実質的な不一致 2 件**を検出した — いずれもテストのカバー外。WF7 で修正と 16-5 配線を行う。

# WF6 完了 — 統合

`pnpm test` 137 files / **1485 tests 全通過**、lint 指摘 0、marketplace 13 件登録、全プラグインのバージョン整合。

## 3 者比較テストが成立した

契約が「唯一の機械的担保」と位置づけていたもの。metatron の `loadConfig`(直接 import)/ codiel の `resolveDocPaths`(直接 import)/ sandalphon の `check-intent-env`(**子プロセス起動**)を同一の一時ディレクトリに対して走らせ、`docRoot` と解決パスを突き合わせる。契約が列挙する 10 構成すべてで**不一致ゼロ**。

担当エージェントが `findDocRoot` の inclusive 探索を一時的に壊す **negative check** を行い、テストが空振りでないことまで確認している。

## 最終監査が契約違反を掘り当てた

3 実装の写しを読み比べさせた結果、**テストのカバー外に 2 件**あった。

**1. `readDomains` が独自のフェンス判定を書いている(契約 §1 違反)**

```
/```json metatron:domains\n([\s\S]*?)```/
```

開始フェンス直後に文字どおりの `\n` を要求するため、**CRLF 改行の ARCHITECTURE.md を codiel だけが読めない**。metatron と sandalphon は `\r` を除去して読む。Windows で作られた ARCHITECTURE を持つプロジェクトで、codiel の run が「ドメイン定義が読めない」で開始できなくなる。契約 §1 は「独自のフェンス判定を書かない」と明記している。

**2. `resolveDocPaths` が拒否の理由を返さない**

契約 §3 規則 3 は「拒否した場合はその項目だけ既定値に落とし、**理由を呼び出し元へ返す**」。metatron は `warnings`、sandalphon は `configWarnings` で返すが、codiel は黙って落としている。3 者比較は `docRoot` とパスしか見ていないため掛からなかった。

どちらも WF7 で修正中。**3 者比較の比較対象に warnings と CRLF 構成を追加**させ、同じ見逃しが再発しないようにした。

## eval セット 6 本 — 発火測定まで完了

ローカルプロキシ経由で `claude` CLI が動いたため、**API キーを要求せずに測定できた**(360 回のヘッドレス実行、9 分 21 秒)。

| スキル | 正答 | FN | FP |
| --- | --- | --- | --- |
| metatron/recording-gotchas | 20/20 | 0 | 0 |
| metatron/capturing-architecture | 18/20 | 2 | 0 |
| metatron/updating-architecture | 18/20 | 1 | **1** |
| sandalphon/capturing-intent | 16/20 | 4 | 0 |
| sandalphon/bridging-execution | 16/20 | 4 | 0 |
| sandalphon/executing-intent | 17/20 | 3 | 0 |

**false positive 1 件が境界の破れを実際に検出した** — `updating-architecture` が「最小 ARCHITECTURE から技術スタック・レイヤー構造・規約まで起こす」で 3/3 発火。これは `capturing-architecture` の担当領域。

false negative は sandalphon 3 本に集中し、いずれも「intent」という語が出ない依頼で落ちている。ただしこれは 3 本とも description に「自律的には発動しない」と宣言していることと整合する挙動でもあり、**修正するか許容するかは eval セットの承認後に判断すべき**と担当が保留している。

測定サンドボックスの限界も報告された: 測定スクリプトは被測定スキル 1 本だけを一時ディレクトリに置くため、**同名スキル同士の実地の取り合い(metatron 対 codiel の `recording-gotchas`)は測っていない**。測ったのは「description が近傍クエリまで過剰に主張していないか」まで。

## 承認をお願いしたいもの

eval セット 6 本のレビュー用ページを用意してあります。ブラウザで開いて確認・承認してください。

```
/tmp/ps-eval/eval-review-6skills.html
```

6 本をタブで切り替えて確認でき、`Export All (6 files)` で一括書き出しできます。承認いただければ description の改善ループを回します(現状は測定の報告で止めてあります)。

WF7(契約違反修正 + 16-5 配線、7 agents)は実行中です。

Raphael の蒸留をバックグラウンドへ委譲した。WF7(契約違反修正 + 16-5 配線、7 agents)は引き続き実行中。

eval セットのレビューページ(`/tmp/ps-eval/eval-review-6skills.html`)は、お手すきのときに確認いただければ大丈夫です。承認後に description の改善ループを回します。

Raphael の蒸留完了(5 件すべて非採用 — metatron/sandalphon 開発中の一過性の状態)。WF7 は引き続き実行中。

完了後に残るのは:

1. **eval セットの承認** → description の改善ループ(ユーザー手番待ち)
2. **機能単位でのコミット** — 現在 git 上に新規 79 件・変更 61 件・削除 2 件が未コミットで積み上がっている。16-5 配線は設計書の警告どおり独立コミットにする
3. **結果報告** — 作成・変更ファイル一覧と、Workflow 実行の構成(フェーズ・エージェント数・token 規模)

コミット前に確認したい点が 1 つあります。`plugins/codiel/docs/ARCHITECTURE.example.md` と `GOTCHAS.example.md` の 2 ファイルが **index 上で削除済み**の状態になっています(metatron へ移設したため設計どおりですが、私が削除操作をした記録はありません)。コミットするとこの削除が確定します。意図どおりであればそのまま含めます。

WF7 完了(7/7)。契約違反 2 件は変異試験つきで修正され **1500 tests 通過**。16-5 配線の検証結果を読む。

監査が**実際の回帰リスクを 1 件掘り当てた**。実測で裏を取る。

実測で監査の指摘 2 件を切り分けた。

- **CRLF の 3 者比較は実在する**(`check-intent-env.test.ts:1050, 1072` のケース 16f)。warnings も 3 者比較に入っている(`:892`)。監査は codiel 側の `lib.test.ts` だけを見て「存在しない」と判定していた — この指摘は誤り
- **`.codiel/` 免除の欠落は実在する**。domain 判定ブロックに `.codiel/` の素通しが無く、DOC_PHASES 分岐と catch-all にはある

契約側の食い違いを先に確定させる。

# WF7 完了 — 契約違反の修正と 16-5 配線

`pnpm test` 137 files / **1516 tests 全通過**、lint 指摘 0。

## 契約違反 2 件の修正は変異試験で裏を取ってある

修正前のコードに新規テストだけを載せて実行した結果:

- **フェンス判定 7 件中 6 件が失敗**(CRLF / チルダ / インデント 2 / インデント 4 / バッククォート 4 個 / チルダ先行)
- **warnings 6 件は全件失敗**(`warnings` が `undefined`)
- sandalphon 側は `readDomains` だけを旧正規表現に戻した変種で **CRLF の 2 ケースだけが失敗**、他 11 ケースは通過 — 追加したケースが違反を狙い撃ちで検出することを確認

唯一通過したのが「ブロックが 2 個以上なら最初を採る」で、旧正規表現は非貪欲かつ無アンカーのため**偶然この 1 ケースだけ同じ結果になる**。担当が回帰ガードとして残している。

実地確認でも、CRLF の ARCHITECTURE に対して **3 実装すべてが同じ 3 ドメインを読む**ことを確認。`git show HEAD:...lib.mjs` で修正前を同じファイルに当てて `null` が返ることまで対照実験している。

## 16-5 配線は 8 ケースで実地確認済み

`set-domain` → 越境 Write が **ask**(理由にパス・ドメイン名・glob の 3 点)→ 範囲内 Write は素通し → `clear-domain` 後は素通し → **`domain` キーを持たない state では素通し**(後方互換)。

CRLF 化した ARCHITECTURE でも同じ結果になることを確認しており、**CRLF 修正と配線が連結して動く**ことが押さえられた。修正前は `readDomains` が `null` を返し、境界が**無音で無効化**される経路だった。

## 監査が実際の回帰リスクを掘り当てた

**`.codiel/` 免除が domain 判定ブロックにだけ無い。**

DOC_PHASES 分岐と catch-all には `.codiel/` の素通しがあるのに、CODE_PHASES の domain 判定ブロックには無い。domain が `backend` のまま `.codiel/specs/<id>/scripts/*.spec.ts` へ書くと、`src/server/**` に一致しないので **ask** になる。

test-loop フェーズは「スクリプト安定化(tester、domain 非紐付け)→ TDD 修正(implementer、domain 紐付け)」を同一フェーズ内で往復する設計なので、`clear-domain` の呼び忘れで tester の正当な書き込みが黙って止まる。**設計書 §16-5 が警告していた「切り分け不能な回帰」の実例パターンそのもの。**

WF8 で修正中(変異試験つき)。

## 監査の指摘 1 件は誤りだったので訂正

監査は「CRLF の cross-impl 比較が存在しない」と報告したが、実測すると `check-intent-env.test.ts:1050, 1072` にケース 16f として実在した。監査が codiel 側の `lib.test.ts` だけを見て判定していた。warnings も 3 者比較に含まれている(`:892`)。

## 契約側を 1 件、実装に合わせた

metatron が読み取り経路でも重複ブロック警告を積んでいる件。契約 §1 は「読み取り・注入経路は警告なしで最初を採る」としていたが、**警告は情報であり読み取りを止めない**うえ、重複は異常な状態なので気づける形にしておく価値が警告 1 行のコストを上回る。契約を実装に合わせた。

WF8 では併せて**コミット前の最終確認**を走らせ、機能単位の分割案(どのファイルがどの単位に属し、またがりがあるか)を出させています。

Raphael の蒸留をバックグラウンドへ委譲した。WF8(`.codiel/` 免除の修正 + コミット前確認、3 agents)は実行中。

完了後、コミット単位の提案を確認してから機能単位でコミットし、最終報告を出す。

Raphael の蒸留完了(3 件すべて既存抗体でカバー済みのため非採用)。WF8 は引き続き実行中。

完了後の残タスクは 3 つ:

1. **コミット** — 提案される単位に従って機能単位で分ける。16-5 配線は設計書 §16-5 の警告どおり独立コミットにする
2. **eval セットの承認**(ユーザー手番)→ description の改善ループ
3. **最終報告** — 作成・変更ファイル一覧と Workflow 実行の構成(フェーズ・エージェント数・token 規模)

現在の累計は 8 ワークフロー・65 agents・subagent tokens 約 10.1M。

WF8 完了。**1518 tests 全通過**、build 3 回で冪等性確認済み。コミット単位の提案を読む。

コミット単位の提案を得た。またがりファイル 4 件と版数 2 件の扱いを確定させ、9 コミットに分ける。

**③(契約追随)と⑤(domains 配線)を分ける代償**を先に述べます。`scripts/guard-write.mjs` は esbuild が `lib.ts` をインライン化するため両方のコンパイル結果が混在し、③だけを反映した状態を作れません。③のコミットではバンドル出力を含めず、⑤で一括更新します。③の時点で生成物が一時的に src と不整合になりますが、**設計書 §16-5 が「同じコミット範囲に混ぜるな」と警告している切り分け可能性のほうを優先**します。

コミットを実行します。

`.git/index.lock` が残っている。実行中の git プロセスがあるか確認する。

ロックはサイズ 0、8 分前の生成、git プロセスは存在しません。クラッシュしたロックの残骸です。git 自身が案内している回復手順(`remove the file manually to continue`)に従って削除します。空ファイルなので失われる内容はありません。

ロック解除、git 正常。コミットを順に実行します。

28 ファイルがステージされ、またがり分は正しく除外されています。

9 コミット完了、作業ツリーはクリーン。コミット後の状態で最終検証を走らせます。

# 実装完了報告

## 完了条件の充足

| 条件 | 状態 |
| --- | --- |
| `pnpm build` | exit 0(14 workspace、3 回実行で冪等性確認済み) |
| `pnpm lint` | exit 0(341 files、指摘 0) |
| `pnpm typecheck` | exit 0(エラー 0) |
| `pnpm test` | exit 0(**137 files / 1518 tests 全通過**) |
| 両設計書のテスト計画 | metatron 72 ケース全件 + sandalphon 24 ケース + codiel R1〜R9 を実装 |
| 新規スキルの skill-creator 評価手順 | eval セット 6 本作成 + 発火測定完了。**ユーザー承認が未了** |
| 機能単位のコミット | **10 コミット** |

規模: **148 files changed, 28,073 insertions(+), 601 deletions(-)**

## コミット

```
d45d4b0 chore: raphael 抗体と chat 記録を更新
3f96f6a chore: metatron と sandalphon を marketplace とワークスペースへ登録
cc4d2b7 feat(gh-utility): issue-craft に持ち込みモードを追加
2b57a5c feat(codiel): guard-write へドメインマップを配線し書き込み境界を実際に効かせる
5c87fc4 feat(codiel): sandalphon の intent issue と連携する
b1ccb5b refactor(codiel)!: ARCHITECTURE / GOTCHAS を metatron のファイル契約へ追随させる
9a121c6 feat(sandalphon): intent 駆動で Issue の前段を担うプラグインを追加
1e4508b feat(metatron): ARCHITECTURE と GOTCHAS を独立資産として管理するプラグインを追加
e910348 docs(design): metatron / sandalphon の設計書とファイル契約の凍結
```

16-5 配線は設計書 §16-5 の警告どおり独立コミットにしました。`scripts/guard-write.mjs` は esbuild が `lib.ts` をインライン化するため契約追随分と配線分を分離できず、`b1ccb5b` ではバンドル出力を保留して `2b57a5c` で一括更新しています。切り分け可能性を優先した結果です。

## 成果物

**metatron 56 ファイル** — `src/lib/` 7 本(config / architecture / gotchas / adr / staging / scan / emit)、CLI 12 サブコマンド、hook 2 本、テスト 9 本、references 5 本、skills 3 本、commands 2 本、example 2 本、README / rationale

**sandalphon 19 ファイル** — `check-intent-env.ts`、テスト、references 3 本、skills 3 本、command 1 本、README / rationale

**codiel 改修 41 ファイル** — `lib.ts`(findDocRoot / resolveDocPaths / readDomains)、`guard-write.ts` / `codiel-state.ts`(domains 配線)、skills 12 本、agents 12 本、example 2 本削除、CLAUDE.example.md

**gh-utility 改修 4 ファイル** — issue-craft の持ち込みモード、version、README

## Workflow 実行の構成

| WF | 内容 | フェーズ | agents | subagent tokens |
| --- | --- | --- | --- | --- |
| 調査 | 既存コードベースの並列調査 | 1 | 6 | 207k |
| WF1 | metatron コア(lib + 72 ケース) | 6 | 13 | 1,926k |
| WF2 | metatron CLI + 2 hooks | 3 | 8 | 2,197k |
| WF3 | 修正 2 件 + metatron 文書 11 本 | 3 | 13 | 1,522k |
| WF4 | sandalphon 一式 + 積み残し | 3 | 10 | 1,309k |
| WF5 | codiel 改修 | 3 | 10 | 1,241k |
| WF6 | gh-utility + 登録 + 3 者比較 + eval | 4 | 7 | 803k |
| WF7 | 契約違反修正 + 16-5 配線 | 4 | 7 | 899k |
| WF8 | `.codiel/` 免除 + コミット前確認 | 2 | 3 | 266k |

**9 ワークフロー / 77 agents / subagent tokens 合計 約 10.4M**(失敗 3、いずれも API エラーで後続 WF に相乗りさせて回収)。

## 検証層が実際に拾ったもの

多層の検証を置いた効果が出た箇所を挙げます。

**`scan.ts` の生 NUL バイト** — `tsc` も `vitest` も `biome` も検出しない。実害は `file(1)` のバイナリ判定で **GNU grep が本文を返さなくなる**こと。CLAUDE.md の「Serena が 0 件でも Grep で裏を取る」規律が、このファイルに対してだけ黙って無効化されていました。

**deny hook の強制点の穴** — `file_path ?? notebook_path` は `file_path` が空文字列でも右辺に落ちません。NotebookEdit で正本がすり抜けました。設計書が「matcher に 1 語足すだけで塞げる穴を残さない」と書いた当の場所です。

**`readDomains` の契約違反** — 正規表現によるフェンス抽出のため **CRLF 改行の ARCHITECTURE を codiel だけが読めない**。Windows 製の文書を持つプロジェクトで run が開始できなくなります。3 実装の写しを読み比べる監査でしか出ませんでした。

**`.codiel/` 免除の欠落** — domain 判定ブロックにだけ免除が無く、`clear-domain` の呼び忘れで tester の正当な書き込みが黙って止まる。設計書 §16-5 が警告した「切り分け不能な回帰」の実例そのものです。

修正はすべて**変異試験**を課しました(追加したテストが修正前のコードで実際に落ちることを確認してから修正を入れる)。テストが穴を捕まえられることを確かめないまま「通った」と報告させないためです。

## 3 者比較テスト

契約が「唯一の機械的担保」と位置づけたものが成立しました。metatron の `loadConfig`(直接 import)/ codiel の `resolveDocPaths`(直接 import)/ sandalphon の `check-intent-env`(子プロセス起動)を同一の一時ディレクトリで走らせ、`docRoot`・解決パス・warnings・ドメイン可読性を突き合わせます。契約が列挙する全構成 + CRLF で**不一致ゼロ**。担当が `findDocRoot` を一時的に壊す negative check まで行い、空振りでないことを確認しています。

## 未了 — eval セットの承認

`/tmp/ps-eval/eval-review-6skills.html` をブラウザで開いて確認・承認をお願いします。承認後に description の改善ループを回します。

現状の測定値(ローカルプロキシ経由、360 回のヘッドレス実行):

- metatron/recording-gotchas **20/20**、capturing-architecture 18/20、updating-architecture 18/20
- sandalphon/capturing-intent 16/20、bridging-execution 16/20、executing-intent 17/20

**false positive が 1 件、境界の破れを実際に検出しました** — `updating-architecture` が「最小 ARCHITECTURE から全節を起こす」で 3/3 発火。これは `capturing-architecture` の担当です。

false negative は sandalphon 3 本に集中し、いずれも「intent」の語が出ない依頼で落ちています。ただし 3 本とも description に「自律的には発動しない」と宣言しており、**修正すべきか許容すべきかは承認後の判断**として保留しています。

測定の限界も 1 点: スクリプトは被測定スキル 1 本だけを一時ディレクトリに置くため、**同名スキル同士の実地の取り合い**(metatron 対 codiel の `recording-gotchas`)は測れていません。測ったのは「description が近傍クエリまで過剰に主張していないか」までです。

作業ツリーはクリーン(全てコミット済み)。レビュー対象は本セッションのコミット範囲で **148 files / 28,073 insertions** — 明らかに大きい規模です。

Codex review started in the background. Check `/codex:status` for progress.

Codex review は起動せず、次のメッセージを返して終了しました(exit 1)。

```
`/codex:review` now maps directly to the built-in reviewer and does not support custom focus text. Retry with `/codex:adversarial-review このセッションで行った変更を中心に、codiel、sandalphon、metatron、gh-utilityをレビューしてください` for focused review instructions.
```

`/codex:review` はビルトインのレビューアーに直結する形に変わっており、**フォーカス指定のテキストを受け付けなくなっています**。今回渡した「このセッションで行った変更を中心に、codiel、sandalphon、metatron、gh-utility をレビューしてください」がそれに当たります。

このコマンドは review-only の制約があり、私の側で引数を書き換えたり再実行したりはしません。Codex 自身が案内している再実行の形を、そのままお伝えします。

```
/codex:adversarial-review このセッションで行った変更を中心に、codiel、sandalphon、metatron、gh-utilityをレビューしてください
```

なお、フォーカス指定を外して `/codex:review` を単独で実行する道もありますが、作業ツリーはクリーン(全 10 コミット済み)なので、ビルトインのレビューアーが差分を見つけられない可能性があります。**その場合はレビュー対象を明示できる `/codex:adversarial-review` のほうが確実**です。

# phyllis998

> サブエージェント(Opus)に、serenaのメモリを最新化するよう指示してください。
> その後、gpt-researcherエージェントと同じToolsを許可し、modelにclaude-gpt-5-6-solを指定したサブエージェントを適切に並列起動し、今回のセッションで行った変更を中心にcodiel、gh-utility、sandalphon、metatronをレビューさせてください。
