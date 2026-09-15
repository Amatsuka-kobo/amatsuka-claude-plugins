# agent-policy custom-policy ロール担当表の推奨モデル更新

- 日付: 2026-09-04
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: agent-policy custom-policy スキル、role marker 対応表
- セッション ID: bc7821b2-2119-4dc1-a778-cd05e83de229

---

## セッション 1: agent-policy カスタム方針ロール担当表の推奨モデル更新

# phyllis998

> agent-policyの、custom-policyの担当表を変更したいです。
> as-is: 推奨モデルが旧with-codex-grokのもの
> to-be:
>
> | 役割                                                  | 推奨モデル(参考)                |
> | ----------------------------------------------------- | ------------------------------- |
> | リアルタイム情報調査(最新動向・外部エコシステム)      | `Sonnet` / `Grok`               |
> | 設計書・実装計画書(WBS)の作成                         | `Opus`                          |
> | コードベース探索統括                                  | `Opus`                          |
> | コードベース探索実働                                  | `Sonnet` / `Grok` / `GPT Terra` |
> | 複雑または重要な実装                                  | `Opus` / `GPT Sol`              |
> | 通常の実装                                            | `Sonnet` / `GPT Luna` / `Grok`  |
> | 軽量な実装                                            | `Haiku` / `GPT Luna` / `Grok`   |
> | 行き詰まり時のエスカレーション                        | `Fable` / `GPT Astra`           |
> | コードレビュー                                        | `Sonnet`                        |
> | 重要な実装の最終レビュー                              | `Fable` / `GPT Astra`           |
> | E2E動作検証・ブラウザ/GUI操作を伴う確認               | `Sonnet` / `GPT Astra`          |
> | 設計・計画・実装のアドバイザー                        | `Fable` / `GPT Astra`           |
> | 設計書・実装計画書のレビュー(理解したこと+暗黙知抽出) | `Haiku`                         |
> | 設計書・実装計画書の独立レビュー(前提検証・反証提示)  | `Sonnet` / `Grok`               |
> | 設計書の最終ゲートレビュー(高リスク案件のみ)          | `Fable` / `GPT Astra`           |
> | その他のタスク                                        | `Sonnet` / `GPT Luna`           |

## セッション 2: 実装計画承認と SOLO_DENIED_ROLES 拡張

# AI

調査完了。表の差し替えだけで済まない点が 3 つある。

## 判明した構造

担当表の左列(役割の帯)は飾りでなく、実装の `RoleId` と 1:1 対応:

- `plugins/agent-policy/src/agents/roles.ts:3-13` — RoleId 10 値
- `plugins/agent-policy/src/agents/policies.ts:114-144` — `ASSIGNMENTS`(claude 読み替え先)と `RECOMMENDED`
- `.claude/agents/*.md` の `agent-policy-role` — マーカーはこの語彙で書かれている

to-be 表の 16 行のうち、既存帯に無いのが 4 つ:

- 行き詰まり時のエスカレーション
- 重要な実装の最終レビュー
- E2E動作検証・ブラウザ/GUI操作を伴う確認
- 設計書の最終ゲートレビュー(高リスク案件のみ)

`GPT Astra` も `ModelId` に無い。ただしプロキシ実機には**存在する** — `gpt-6-astra` / owned_by `openai`(`http://127.0.0.1:8317/v1/models` で確認)。`MODELS` が追随していないだけ。

`★ Insight ─────────────────────────────────────`
- 担当表だけ書き換えると、新規 4 帯は「解決順の手順 2」に落ちる → `claude-model-policy` の同じ帯へ読み替え → そこにも無い → **解決不能な帯**になる。表に書いてあるのに dispatch 先が決まらない状態。
- `orchestration-discipline.md:46` が「合成対象は 9 帯」と帯名を列挙している。帯を増やすとここも追随対象。
- `policies.ts:44` のコメント「color は公式が受け付ける 8 色。ちょうど 8 モデルなので重複させない」— Astra を足すと 9 モデル目で color 前提が崩れる。
`─────────────────────────────────────────────────`

「調査・分析」帯が to-be から消えている点も、本文 2 箇所(`SKILL.md:33` の自身担当リスト、`:35` の振り分け規律)に波及する。

判断を仰ぐ。

回答を受けた。実装に入る前に、後から変えると既存 Agent 定義へ波及する 2 点だけ詰める。

`★ Insight ─────────────────────────────────────`
- `RoleId` の文字列は `.claude/agents/*.md` の `agent-policy-role` にそのまま書かれる値。命名を後で変えると、既に配置済みの定義 8 本と `marker-scan` のテストが全部追随対象になる。先に固める。
- `MODELS[].model` は SessionStart がプロキシの `/v1/models` と突き合わせる実在検証の対象(`session-start.ts:101`)。ここに実在しない id を書くと、custom プロファイル全体が `claude` へフォールバックする。表記統一と検証通過が競合する。
`─────────────────────────────────────────────────`

model 値の懸念は正当。答えを出すため、`MODELS[].model` が実際にどこで使われるか追う。

`MODELS[].model` の性質が確定した。懸念への答え:

## 事実

**規定値ではない。ユーザーのプロキシのエイリアス次第で変わる既定候補。**

- `setup-agents.ts:268-269` — `modelIsAvailable()` は `isClaudeEnum(model) || live.ids.includes(model)`。`isClaudeEnum` は `CLAUDE_ENUMS` の**完全一致**(sonnet/opus/haiku/fable/inherit 等)で、`claude-` prefix 判定ではない。
- `setup-agents.ts:283-288` — `--models` 経路(ウィザードの通常経路)は、プロキシに無い `spec.model` を持つ候補を `modelsDropped` として**黙って落とす**。
- `setup-agents.ts:310` — `--model-id gpt-astra --model <実在id>` の明示上書き経路がある。ここでプロキシごとのエイリアス差を吸収できる。

`★ Insight ─────────────────────────────────────`
- つまり既存の `claude-gpt-5-6-sol` 等も同じ性質 — **このリポジトリの利用者(あなた)のプロキシがその名前を持っているから書かれている値**。他人のプロキシが別名なら、既存 3 つも同様に候補から落ちる。Astra だけが脆いわけではなく、設計として「既定候補 + `--model` 上書き」で吸収する形になっている。
- ただし `claude-gpt-6-astra` を選ぶと、**あなたの現在のプロキシ(`gpt-6-astra` しか持たない)では今すぐ候補から落ちる**。表記統一と即時動作が競合する。
`─────────────────────────────────────────────────`

この事実を踏まえて確認。

エイリアス機構の現状を確認する。廃止の経緯があるので、事実を揃える。

エイリアス機構の答えが出た。**既に存在する。** 環境変数ではなくウィザードの中にある。

## エイリアス指定の現状

| 世代 | 仕組み |
| --- | --- |
| 旧 setup-gpt | `AMATSUKA_AGENT_GPT_SOL_ALIAS` 等の環境変数 |
| 現行 | `--list-live-models` でプロキシの `/v1/models` を照会し、**実機のエイリアスを候補に出して選ばせる** |

証拠:

- `setup-agents/SKILL.md:79` — 照会成功時は「`models` にある**実在エイリアス**と `claudeEnums` の両方をモデル候補にする」
- `SKILL.md:137` — 「ステップ 1 で保持した候補から、作る定義の `model` 値を複数選択で選ばせる」
- `SKILL.md:141` — 推奨構成外の実在エイリアスを選んだ場合、`--model-id`(推奨モデル ID)と `--model`(実際のエイリアス値)を分けて渡す
- `SKILL.md:199` — 「`model` 値を尋ねる。表示だけで済ませず、必ず質問する」「別の値を指定する」→ 自由入力
- `setup-agents.ts:705` — `live.ids` を vendor 付きで列挙して返す

つまり他の利用者のプロキシが `my-gpt-alias` という名前でも、照会一覧に出るので選べる。`MODELS[].model` は**照会失敗時のフォールバック既定値**(`SKILL.md:80`)にすぎない。環境変数が廃止されたのは、この実機照会に置き換わったため。

**仕組みの追加は不要。** ただし Astra 追加に伴い、`SKILL.md` のハードコード 2 箇所は追随が要る:

- `:53` — 推奨モデル ID 全件 `gpt-sol,gpt-terra,gpt-luna,grok,haiku,sonnet,fable,opus`
- `:80` — 既定エイリアス対応表(`gpt-sol` = `claude-gpt-5-6-sol` …)

`★ Insight ─────────────────────────────────────`
- 「エイリアスを指定できる仕組み」は消えたのではなく、**静的な env 変数から動的な実機照会へ移った**。env 変数版は「プロキシに何があるか」を知らないまま名前だけ差し替える形なので、名前が間違っていても書き込めた。現行は候補が実機由来なので、存在しない名前を選べない。
- 代償として `MODELS[].model` が二重の役割を持つ: ①照会失敗時のフォールバック ②`recommendedFor` を出すための照合キー(`setup-agents.ts:186` の `recommendedForAlias`)。②のため、実機に一致する値だと推奨役割が自動で付く。`claude-gpt-6-astra` をあなたが張ったなら②も効く。
`─────────────────────────────────────────────────`

## 実装計画

確定済み: RoleId 短縮型 / `claude-gpt-6-astra` / 「調査・分析」完全廃止 / 実装まで一式。

**新規 4 帯の定義案**(`roles.ts`):

| RoleId | label | kind | tools |
| --- | --- | --- | --- |
| `escalation` | 行き詰まり時のエスカレーション | `impl` | Read, Grep, Glob, Write, Edit, Bash, Skill |
| `final-review` | 重要な実装の最終レビュー | `readonly` | Read, Grep, Glob, Bash |
| `e2e-verify` | E2E動作検証・ブラウザ/GUI操作を伴う確認 | `readonly` | Read, Grep, Glob, Bash |
| `gate-review` | 設計書の最終ゲートレビュー | `readonly` | Read, Grep, Glob |

`escalation` を `impl` にした理由: 行き詰まりを引き取って打開する帯なので、助言のみの `advisor`(readonly)と区別する。`e2e-verify` は Bash でアプリを起動するが、ファイルは変更しないので `readonly`。ブラウザ操作の MCP は setup-agents の MCP 選択で付ける。

**変更ファイル**:

| ファイル | 内容 |
| --- | --- |
| `src/agents/roles.ts` | RoleId 4 値 + ROLES 4 エントリ追加 |
| `src/agents/policies.ts` | ModelId に `gpt-astra`、MODELS へ 1 件、ASSIGNMENTS/RECOMMENDED へ 4 帯、color 8 色前提コメントの修正 |
| `skills/custom-policy/SKILL.md` | 担当表を to-be へ差し替え、「調査・分析」の追随記述 2 箇所を削除 |
| `skills/claude-model-policy/SKILL.md` | 同じ 4 帯を追加、「調査・分析」削除 |
| `references/orchestration-discipline.md` | 合成対象帯 9 → 拡張、自身担当帯の列挙から「調査・分析」削除 |
| `skills/setup-agents/SKILL.md` | 推奨モデル ID 全件と既定エイリアス表に `gpt-astra` 追加 |
| `assets/`(役割断片) | 新規 4 帯の断片 ja/en |
| `src/agents/__test__/*`, `src/hooks/__test__/*` | 期待値追随 |
| `README.md`(agent-policy / ルート) | 表の追随 |
| `plugin.json` / `package.json` | マイナー上げ |

未確定が 2 点ある。

`claude-model-policy` 側の新規 4 帯は、to-be 表の Claude 側の値から導出して `escalation`=`fable` / `final-review`=`fable` / `e2e-verify`=`sonnet` / `gate-review`=`fable` とする。

`policies.ts:153` の `SOLO_DENIED_ROLES`(単一役割なら Agent Tool を与えない帯)は現在 `light-impl` と `advisor`。新規 4 帯のうち `gate-review` と `final-review` はレビュー専任なので加えるのが筋だが、現行の `code-review`・`doc-review` も加わっていない。**既存に合わせて追加しない**方針で進める。

この計画で着手してよいか。修正があれば番号でなく箇所を指定してもらえれば直す。

なお編集する `.md` は既存本文が通常日本語なので、追記部分も通常日本語で揃える(原始人口調は適用しない)。別扱いを望むなら言ってほしい。

前ターンの実装計画への回答を待っている。

確認待ちの要点:

- 新規 4 帯の `kind` / `tools`(`escalation` のみ `impl`、残り 3 帯は `readonly`)
- 変更ファイル 11 種の範囲
- `claude-model-policy` 側の新規 4 帯の割当 — `escalation`/`final-review`/`gate-review` = `fable`、`e2e-verify` = `sonnet`
- `SOLO_DENIED_ROLES` は既存に合わせて据え置き

この計画で進めてよければ着手する。

実装計画への回答待ち。着手していない。

# phyllis998

> agent toolを与えない帯に、code-review、doc-review、gate-review、final-reviewも追加してください
> それ以外は承認します。

## セッション 3: Role 拡張実装を検証し SOLO_DENIED_ROLES を 10 帯へ拡張

# AI

承認を受けた。`SOLO_DENIED_ROLES` を 6 帯へ拡張する。着手前に規律と実装細部を確認する。

計画どおり着手する。決定事項が多いので、まず作業仕様を固定してから「複雑または重要な実装」の帯へ委譲する。

「複雑または重要な実装」の帯へ委譲した。バックグラウンドで実行中。

`★ Insight ─────────────────────────────────────`
- 決定事項を依頼文へ直接書かず `/tmp` の仕様ファイルに固定したのは、承認済みの内容が転記の途中で変質するのを防ぐため。委譲先が読む正本を 1 つにすると、後で差分を検証するときも「仕様書と実装」の 2 者比較で済む。
- `MODELS[].color` の 8 色制約は既に実効を失っていた — 生成時に実際に使われるのは `VENDOR_COLORS[vendor]`(`setup-agents.ts:302`)で、モデル単位の色は参照されない。9 個目のモデルで表面化した「制約に見えるが守られていないコメント」の典型。仕様書ではコメント自体の書き換えも指示に入れた。
`─────────────────────────────────────────────────`

完了通知を待つ。届いたら変更差分を仕様書と突き合わせて確認し、結果を報告する。

実装エージェントの完了を待っている。届き次第、仕様書と差分を突き合わせて報告する。

実装エージェントはまだ実行中。完了通知を待っている。

実装が完了した。報告を鵜呑みにせず、核心部分を自分で検証する。

主要部分は仕様どおり。残りを確認し、テストは自分で実行し直す。

仕様との突き合わせは全項目一致した。検証コマンドを自分で実行し直す。

実装は全項目通った。最後に、今回の変更で生じた食い違いを 1 つ見つけたので事実確認する。

完了。全項目が仕様どおりで、検証も自分で実行し直して通った。

## 結果

| コマンド | 結果 |
| --- | --- |
| `pnpm run lint` | exit 0(info 4 件、いずれも対象外) |
| `pnpm run typecheck` | exit 0 |
| `pnpm run test` | 2023 passed / 2 skipped、154 ファイル |
| `pnpm run build` | exit 0、再実行で追加差分なし |

変更 21 ファイル + 新規 8 ファイル(役割断片 ja/en 各 4)。バージョンは `0.14.0-dev` → `0.15.0-dev`、`plugin.json` と `package.json` で一致。コミットはしていない。

担当表は指定どおり 16 行・順序も一致。`roles.ts` は 14 帯になり、既存 10 帯の相対順が保たれているので `.claude/agents/` の既存定義 8 本の `agent-policy-role` の並びは変わらない。

## 1 件、判断を要する食い違いを見つけた

`AGENT_DENIED_MODELS`(`policies.ts:165`)が `["haiku", "gpt-luna"]` のまま残っている。これは帯ではなく**モデル**で Agent Tool を落とす経路で、今回の担当表変更で文書と実装がずれた。

実機で確認した:

```
--check --models gpt-luna
  roles: normal-impl, light-impl, general
  agentTool: False
```

`normal-impl` と `general` は、あなたが指定した Agent Tool 不許可 6 帯に**含まれない**。文書(`custom-policy:37`、`orchestration-discipline:16`)を読めば許可されるはずの定義に、実装は Agent Tool を付けない。

`★ Insight ─────────────────────────────────────`
- 変更前は `gpt-luna` の推奨が `light-impl` 1 帯だけで、それが不許可帯だったため、モデルベースと帯ベースの 2 経路が偶然同じ答えを出していた。to-be 表が `gpt-luna` を「通常の実装」「その他のタスク」にも広げたことで、初めて 2 経路が割れた。
- `haiku` は推奨が `light-impl` / `doc-review` の 2 帯で、どちらも不許可帯なので今も割れていない。割れるのは `gpt-luna` だけ。
`─────────────────────────────────────────────────`

どう倒すかで結果が変わる。

- **A: `AGENT_DENIED_MODELS` から `gpt-luna` を外す** — 帯ベースに一本化する。`gpt-luna` の定義は `normal-impl` / `general` を持つので Agent Tool を得る。文書と実装が一致する。
- **B: 実装を維持し、文書に書き戻す** — 「Haiku と GPT Luna には帯によらず Agent Tool を許可しない」を両方針スキルへ明記する。軽量モデルにサブエージェント統括をさせない意図なら、こちら。

どちらにするか決めてもらえれば直す。触らないまま置くこともできるが、その場合は文書と実装が食い違ったまま残る。

実装は完了・検証済み。前ターンで挙げた `AGENT_DENIED_MODELS` の食い違いについて、A(帯ベースに一本化して `gpt-luna` を外す)か B(実装を維持し文書へ書き戻す)かの判断を待っている。

抗体の蒸留が完了した(3 件処理、新規抗体 1 件)。

本題は変わらず、`AGENT_DENIED_MODELS` の食い違いについての判断待ち。

- **A**: `AGENT_DENIED_MODELS` から `gpt-luna` を外して帯ベースに一本化する。`normal-impl` / `general` を持つ `gpt-luna` の定義が Agent Tool を得る。
- **B**: 実装を維持し、「Haiku と GPT Luna には帯によらず Agent Tool を許可しない」を両方針スキルへ書き戻す。

どちらでもなく、このまま置くという選択もある。その場合は文書と実装が食い違ったまま残る。

# phyllis998

> Aで対応してください

## セッション 4: `AGENT_DENIED_MODELS` から `gpt-luna` を外し、帯ベース一本化を実装・検証完了

# AI

A で対応する。まず影響範囲を確認する。

編集する。規約どおり Serena の編集ツールを使う。

delegation gate が拒否した。運用方針どおり「通常の実装」の帯へ委譲する。

委譲した。実行中。

`★ Insight ─────────────────────────────────────`
- `delegation-gate.mjs` が私の直接編集を拒否した — このプラグイン自身が持つ hook が、自分のソースを編集しようとしたメインセッションを止めた形。エラー文が「Bash 経由の書き込みや他ツールへの切替で回避しない」と明記しているのは、gate が Edit だけでなく回避経路も想定して書かれているため。
- 変更 3(`setup-agents.test.ts`)を単なる期待値修正でなく `haiku` への置き換えとして指示したのは、`gpt-luna` の除外を外すとそのテストが「モデル制約を外す」効果を検証しなくなるから。テストが緑のまま意味を失う形の劣化は、期待値だけ見ていると気づけない。
`─────────────────────────────────────────────────`

完了通知を待って、結果を自分で検証してから報告する。

A の実装は委譲済みで実行中。完了通知を待っている。

A の実装エージェントはまだ実行中。完了通知を待っている。

A の対応が完了した。検証も自分で実行し直した。

## A の変更

| ファイル | 内容 |
| --- | --- |
| `src/agents/policies.ts:164-166` | `AGENT_DENIED_MODELS` を `["haiku"]` へ。コメントも実態に更新 |
| `src/agents/__test__/policies.test.ts` | `gpt-luna` の false 期待を削除し、「GPT Luna はモデル側の除外を受けず帯の規定だけに従う」を新設 |
| `src/__test__/setup-agents.test.ts` | 自由モデル値テストを `haiku` / `--vendor claude` へ置き換え、検証意図を保持 |
| `src/agents/__test__/compose.test.ts` | モデル除外テストを Haiku のみに絞る(依頼外だが、`gpt-luna` を前提にしていたため必要な追随) |
| `scripts/setup-agents.mjs` | build による再生成 |

実機で確認した結果:

```json
{"ids": ["normal-impl", "light-impl", "general"], "agentTool": true}
```

文書(帯ベース)と実装が一致した。`haiku` はモデル側の除外に残したままにしてある — 推奨帯が `light-impl` / `doc-review` のみで帯ベースと同じ結果になり、割れていないため。

## 全体の状態

| コマンド | 結果 |
| --- | --- |
| `pnpm run lint` | exit 0 |
| `pnpm run typecheck` | exit 0 |
| `pnpm run test` | 2024 passed / 2 skipped(新設 1 件を含む) |
| `pnpm run build` | exit 0 |

担当表の差し替え、帯 4 追加、`gpt-astra` 追加、`AGENT_DENIED_MODELS` の一本化まで完了。バージョンは `0.15.0-dev`。コミットはしていないので、差分の確認と commit のタイミングは判断してもらいたい。

`★ Insight ─────────────────────────────────────`
- `compose.test.ts` の追随は依頼に書いていなかったが必要だった。`for (const modelId of ["haiku", "gpt-luna"])` というループで 2 モデルをまとめて検証していたため、片方の前提が消えるとテストが落ちる。「変更 4: 他の追随」として grep を指示しておいたのが効いた形で、定数の要素を 1 つ減らす変更でも、その定数を列挙して回るテストは連動する。
- 今回 hook に 2 度止められた(delegation-gate と Stop hook の抗体蒸留)。どちらもプラグイン自身が自分のソース変更に対して働いたもので、agent-policy の gate は「メインセッションが agent-policy の実装層を直接編集する」という、まさに今回の形を想定して書かれている。
`─────────────────────────────────────────────────`

# phyllis998

> コミットしてください
