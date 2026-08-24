# agent-policy 役割ベース setup と MCP 非同梱化 設計書

作成日: 2026-08-24
対象プラグイン: `plugins/agent-policy`
現行バージョン: 0.8.0-dev → 0.9.0-dev

## 1. 背景と目的

現行の agent-policy は、エージェント定義 7 種を MCP ツール名込みで同梱している。この形は次の前提に立っている。

- 利用者の環境に Context7 / GitHub / Playwright / Serena の MCP が接続されている
- 利用者は同梱定義をそのまま使い、tools や規律を足す必要がない

どちらも成り立たない利用者がいる。MCP を接続していない環境では `tools:` の MCP 名も本文の「ツール運用」節も無意味であり、逆に別の MCP を使いたい利用者は同梱定義を差し替えられない。エイリアスだけが環境変数で変えられる状態になっている。

本改修の目的は次の 4 点である。

1. 同梱定義から MCP への依存を取り除き、どの環境でも意味を持つ素の定義にする。
2. 利用者が自分の tools と規律を持ち込めるよう、`setup-gpt` / `setup-grok` を復活させる。
3. セットアップを「エージェント一式を作る」から「役割を選んで、それに適した定義を 1 つ作る」へ変える。
4. 利用者が自分で作った定義を、名前に依存せず担当表の帯へ結び付けられるようにする。

## 2. 0.7.0 から反転させる判断

0.7.0(2026-08-16)の設計は、セットアップ作業をなくすことを目的として `setup-gpt` / `setup-grok` を廃止した。本改修はその一部を反転させる。何を取り消すのかを明示しておく。

| 0.7.0 で得たもの | 本改修での扱い |
| --- | --- |
| プロジェクトごとのセットアップが不要 | 維持する。同梱プリセットをそのまま使う道は残す |
| 定義がプラグイン更新に自動追随する | 同梱プリセットを使う限り維持する。setup で作った定義は再 setup の差分確認で追随する |
| テンプレートと同梱定義の二重管理を回避 | 維持する。役割断片を唯一の正とし、同梱定義はビルドで生成する |
| 探索実働が読み取り専用の帯に固定される | **取り消す**(§2.1) |

### 2.1 researcher 3 定義の廃止

`claude-researcher` / `gpt-researcher` / `grok-researcher` を廃止する。担当表にはモデル名だけを書き、リサーチ用の定義を作るかどうかは利用者の判断に委ねる。

0.7.0 設計書 §6 は「探索実働を researcher へ寄せることで、探索の実行帯が権限の面でも読み取り専用に固定される」と書いた。researcher を廃止すると、探索実働・独立レビュー・リアルタイム情報調査は `Write` / `Edit` / `Bash` を持つ実装エージェントが担うことになり、この固定は失われる。

読み取り専用の担保は次の 2 つへ移す。

- 依頼文の制約(「ファイルを変更しない」「報告のみを返す」)を各方針スキルの dispatch 節に明記する。
- 利用者が読み取り専用の定義を持ちたいときは、setup で読み取り専用役割だけを選んで作る。§5 の tools 導出規則により、その定義には `Write` / `Edit` が付かない。

### 2.2 Grok 2 定義の統合

`grok-implementer` と `grok-researcher` を `grok` 1 定義へ統合する。Grok はエイリアスが 1 つ(`claude-grok-4-6`)であり、実装と調査で定義を分ける必然性がない。GPT が researcher を持たない形になるのに合わせ、Grok も 1 本にする。

## 3. 全体像

```
役割断片(唯一の正)
  plugins/agent-policy/assets/roles/*.md
        |
        +--- pnpm build ---> 同梱プリセット plugins/agent-policy/agents/*.md
        |                      (gpt-sol / gpt-terra / gpt-luna / grok)
        |
        +--- setup-gpt / setup-grok ---> .claude/agents/<利用者が決めた名前>.md
                 ^                          (役割マーカー付き)
                 |                                  |
        プロジェクト側の断片                        |
        .claude/agent-policy/roles/*.md             v
                                          SessionStart フックが走査し
                                          「帯 → エージェント名」を注入
```

- 役割断片が唯一の正である。同梱プリセットも setup の生成物も、同じ断片から組み立てる。
- SessionStart フックは読んで注入するだけで、ファイルを書かない。
- 定義ファイルへの書き込みは setup スキルだけが行う。

## 4. 役割 ID

担当表の帯に ID を割り当てる。setup の選択肢と役割マーカーの語彙は同じ集合とする。

| 役割 ID | 担当表の帯 | 種別 |
| --- | --- | --- |
| `complex-impl` | 複雑または重要な実装 | 実装 |
| `normal-impl` | 通常の実装 | 実装 |
| `light-impl` | 軽量な実装 | 実装 |
| `general` | その他のタスク | 実装 |
| `explore` | コードベース探索実働 | 読み取り |
| `realtime-research` | リアルタイム情報調査 | 読み取り |
| `independent-review` | 設計書・実装計画書の独立レビュー | 読み取り |
| `doc-review` | 設計書・実装計画書のレビュー | 読み取り |
| `code-review` | コードレビュー | 読み取り |
| `advisor` | 設計・計画・実装のアドバイザー | 読み取り |

担当表の「調査・分析」「設計書・実装計画書の作成」「コードベース探索統括」はオーケストレーター自身が担う帯であり、サブエージェントへ委譲しない。ID を割り当てず、setup の選択肢にも出さない。

## 5. tools の導出規則

選ばれた役割から `tools` を機械的に決める。

### 5.1 役割ごとの要求ツール

| 役割 ID | 要求ツール |
| --- | --- |
| `complex-impl` | Read, Grep, Glob, Write, Edit, Bash, Skill, LSP |
| `normal-impl` | Read, Grep, Glob, Write, Edit, Bash, Skill, LSP |
| `light-impl` | Read, Grep, Glob, Write, Edit, Bash, LSP |
| `general` | Read, Grep, Glob, Write, Edit, Bash, Skill, LSP |
| `explore` | Read, Grep, Glob, Bash |
| `realtime-research` | Read, Grep, Glob, Bash, WebSearch, WebFetch |
| `independent-review` | Read, Grep, Glob, Bash |
| `doc-review` | Read, Grep, Glob |
| `code-review` | Read, Grep, Glob, Bash |
| `advisor` | Read, Grep, Glob |

`tools` は選ばれた役割の要求ツールの和集合とする。MCP ツールは 1 つも含めない。

### 5.2 Agent tool の可否

`Agent` は、選ばれた役割に `complex-impl` / `normal-impl` / `general` のいずれかが含まれるときだけ付与する。

`orchestration-discipline.md` の規定は「軽量な実装の**帯**に Agent Tool を許可しない」である。複数役割を兼ねる定義はその帯そのものではないため、`light-impl` を含んでいても重い実装役割を併せ持つなら付与してよい。「不可が 1 つでもあれば不可」という規則にすると、`complex-impl` + `explore` の組み合わせで現行 `gpt-sol` を再現できなくなる。

### 5.3 読み取り専用性の警告

読み取り役割と実装役割を同時に選ぶと、`Write` / `Edit` が付くため tools による読み取り専用の担保が消える。読み取り/実装の分類は SKILL.md に役割 ID を手書きせず、`--list-roles` が返す各役割の `kind` と、`--check` が返す `roles.mixedKinds` に基づく。setup は `mixedKinds` が `true` になる組み合わせを禁止せず、生成前に警告を出す。

> 選んだ役割に読み取り専用の役割(independent-review など)と実装役割が混在しています。生成される定義には Write / Edit が付くため、読み取り専用の担保は依頼文の制約に委ねられます。

本文の制約も衝突する。現行 researcher の制約「成果物(ファイル)を作らない。報告のみを返す」をそのまま連結すると、実装役割の「実装を遂行する」と同じ本文に並ぶ。これは §6.5 の役割スコープ付き制約で解消する。

## 6. 役割断片

### 6.1 配置

| 種別 | パス | 適用方法 |
| --- | --- | --- |
| 共通枠 | `plugins/agent-policy/assets/roles/_common.md` | 全定義の土台 |
| 役割断片(共通) | `plugins/agent-policy/assets/roles/<role-id>.md` | 基準 |
| 役割断片(ベンダー別) | `plugins/agent-policy/assets/roles/<role-id>.<vendor>.md` | 共通断片の同名節へ**追記** |
| プロジェクト側の断片 | `<project>/.claude/agent-policy/roles/<role-id>.md` | 同じ役割 ID の共通断片を**置き換え** |

`<vendor>` は `gpt` / `grok` / `claude` のいずれか。

- ベンダー別断片は節の置き換えではなく追記である。Grok の「X 由来・ソーシャル由来の情報を未検証として明示する」のような、ベンダー固有の規律を足す用途に限る。
- プロジェクト側の断片は共通断片を置き換える。ベンダー別断片の追記は、置き換え後の節に対しても適用する。
- プロジェクト側にしか存在しない役割 ID を置くこともできる。setup の選択肢に現れ、役割マーカーの語彙としても有効になる。

**プロジェクト側の断片を読むのは setup だけである。** `build.ts` は読まない。同梱プリセットが利用者の環境によって変わると、配布物の再現性が失われるためである。

`_common.md` もプロジェクト側に置ける。ただしこちらは役割断片と違い、**節単位で上書きする**。後の探索先が定義した節だけを差し替え、定義しなかった節はプラグイン同梱のものを残す。`_common.md` は `## Preamble` / `## アドバイザーへの相談` / `## 制約` という独立した 3 部品を持つ土台であり、丸ごと置き換える方式だと、1 節を差し替えたい利用者が残り 2 節も書き写すことになる。書き写しはプラグイン更新に追随せず、§10.2 が避けようとした二重管理を `_common.md` で再発させる。

### 6.2 断片のフォーマット

```markdown
---
id: complex-impl
label: 複雑または重要な実装
description: 複雑なコーディング(アーキテクチャ判断・非自明な設計トレードオフ・複数コンポーネントの協調を伴う実装)
tools: Read, Grep, Glob, Write, Edit, Bash, Skill, LSP
kind: impl
---

## When to invoke

- **複雑な実装。** アーキテクチャ判断・非自明な設計トレードオフ・複数コンポーネントの協調を伴う、難度の高い実装を行うとき。

## Core Responsibilities

- 複雑、または重要な実装を、根拠(ファイルパス・行番号)付きで自ら遂行する。

## 作業手順

- 着手前に対象コードとその呼び出し元を読み、リポジトリの流儀に合わせる。推測で書かず、シグネチャや既存パターンを確認してから実装する。

## 制約

- **複雑または重要な実装として依頼されたときは**、スコープの境界を守る。最上位の承認判断はオーケストレーターに委ね、自分は求めない。

## Output Format

- 結論(成果物の完了状況)を冒頭に一文で
- 根拠となるファイルパスと行番号
```

- `id` / `label` / `description` / `tools` / `kind` は必須。`kind` は `impl` / `readonly` のいずれかで、§5.2 と §5.3 の判定に使う。
- 役割 ID は `src/agents/roles.ts` に定数として並べ、断片ファイル名との一致をテストで検査する(§13.1)。担当表の帯名との対応も同ファイルに持ち、方針スキルの表と突き合わせる。

### 6.3 合成

#### frontmatter

| フィールド | 組み立て方 |
| --- | --- |
| `name` | 利用者が決めた名前。プリセットは `presets.ts` の名前 |
| `description` | `Use this agent when ` + 選ばれた役割の `description` を「、」で連結 + `を委譲するとき。詳細は本文の「When to invoke」を参照。` |
| `model` | ヒアリングしたエイリアス。プリセットは既定エイリアス |
| `color` | 同梱プリセットは `presets.ts` の `color` を優先する(値は §8.1)。指定がない定義はベンダー既定(`gpt` は yellow、`grok` は red、`claude` は blue)を使う |
| `tools` | §5 の導出規則 |
| `agent-policy-role` | 選ばれた役割 ID を §4 の表順に並べた CSV。区切りは `, `(カンマ + 半角スペース) |

`description` は Claude Code が委譲先を選ぶ際の判断材料であり、欠かせない。役割の `description` を機械的に連結して作る。

#### 本文

1. 冒頭宣言 — `_common.md` のひな形に、定義名と選ばれた役割の要約を埋める
2. `## When to invoke` — 選ばれた役割の項目を §4 の表順に並べる
3. `## Core Responsibilities` — 同上。番号付きリストへ振り直す
4. `## 作業手順` — 同上
5. `## アドバイザーへの相談` — `Agent` が付くときだけ、`_common.md` の節をそのまま入れる
6. `## 制約` — `_common.md` の共通制約 + 選ばれた役割の制約項目
7. `## Output Format` — 単一役割なら項目を直接並べる。複数役割なら役割ごとに `### <label>` の h3 小見出しを立てる

節名は統一する。現行 `gpt-sol.md` の `## 進め方` は `## 作業手順` へ、`claude-researcher.md` / `gpt-researcher.md` の `## 役割の判定` は `## When to invoke` へ寄せる。「ツール運用」節は生成しない(§7)。

### 6.4 名前非依存の原則

現行定義は「通常の実装は `GPT Terra`、軽量なタスクは `GPT Luna` に委ねる」(`agents/gpt-sol.md`)のように、他定義の名前を直接参照している。setup で生成される定義の名前は利用者が決めるため、この文言は断片に置けない。

断片には他定義の名前を書かず、次の形に置き換える。

> 自分の役割に含まれない作業は引き受けず、オーケストレーターへ差し戻す。

同梱プリセットも同じ文言を使う。現行の相互参照が持っていた「どこへ押し戻すか」の情報は失われる。押し戻し先の判断はオーケストレーターが担当表で行う。断片に他定義の名前が含まれないことはテストで検査する(§13.1)。

### 6.5 役割スコープ付き制約

読み取り役割と実装役割を併せ持つ定義では、制約が衝突する。実装役割の「実装を遂行する」と、読み取り役割の「成果物(ファイル)を作らない。報告のみを返す」が同じ本文に並ぶ。

断片の制約項目には役割名を冠し、「この役割で依頼されたときの制約」として書く。

> - **独立レビューとして依頼されたときは**、成果物(ファイル)を作らず、報告のみを返す。
> - **複雑または重要な実装として依頼されたときは**、スコープの境界を守る。

これにより、実装役割と読み取り役割を合成しても矛盾しない。合成という手法を採る以上、断片の文言は「常に真」ではなく「この役割で呼ばれたとき真」として書く必要がある。`_common.md` の共通制約(Skill のロード禁止など)だけは役割名を冠さない。

## 7. MCP の削除

### 7.1 削除対象

- 全定義の `tools:` から `mcp__context7` / `mcp__playwright` / `mcp__github__*`(16 個)/ `mcp__plugin_serena_serena__*`(5〜11 個)を削除する。
- 全定義の本文「## ツール運用」節を削除する。役割断片にもこの節を置かない。
- `claude-researcher` / `gpt-researcher` の作業手順にある「Serena の探索ツールで確かめる」は、定義ごと廃止されるため消える。

### 7.2 退避する規律

「ツール運用」節には MCP と独立に成り立つ権限規律が混ざっている。落とすと定義が緩むため、役割断片の `## 制約` へ移す。

| 元の記述 | 移す先 |
| --- | --- |
| GitHub への書き込み(PR 作成・レビュー投稿)は行わず、必要ならオーケストレーターへ報告する | `_common.md` の `## 制約` |
| ブラウザでの動作確認は閲覧・動作確認に限り、対象システムのデータを変更する操作は行わない | `_common.md` の `## 制約` |
| 0 件の結果を結論とせず、Grep で裏を取る | `explore` 断片の作業手順 |

前の 2 つは当初「実装役割の断片の制約」へ移すと定めていた。実装中のレビューで、その表現が計画では `complex-impl` と `normal-impl` の 2 断片へ狭められ、**`general` や `light-impl` だけで作った定義に載らない穴**ができていることが判明したため、`_common.md` へ移す形に改めた。読み取り役割だけの定義にも載るが、どちらも「行わない」制約なので害がない。同じ 3 行が 2 断片に逐語重複していた問題も同時に解消する。

### 7.3 Agent tool の規律は権限と連動させる

`Agent` tool を持つ定義には、それを統べる規律が本文になければならない。

- 「`Agent` tool はアドバイザー相談専用である。作業委譲(再オーケストレーション)目的では使用せず、自身が起動したサブエージェントに `Agent` tool を許可しない」を `_common.md` の `## Agent tool の制約` 節に置く。
- 合成器は `allowsAgentTool` が真のときだけ、この項目を `## 制約` の先頭へ合流させる。`## アドバイザーへの相談` 節と同じ条件で出る。

当初この規律は `complex-impl` / `normal-impl` 断片が個別に持っていたが、`general` も §5.2 により `Agent` を得るため、`general` だけで作った定義が Agent を持ちながら規律を欠く状態になっていた。権限の付与条件(`allowsAgentTool`)と規律の出現条件を同じにすることで、この種の取りこぼしが構造的に起きなくなる。

利用者が MCP を使いたいときは、生成後の定義へ自分で `tools` と規律を足す。再 setup 時に差分確認(§10)で保持される。

## 8. 同梱プリセットとビルド生成

### 8.1 プリセット

プリセットの役割は §11.1 の担当表と一致させる。担当表がある帯を振っているのに、プリセットにその役割が無いと、必要なツールが `tools` から欠落する(例: `realtime-research` を持たない定義には `WebSearch` / `WebFetch` が付かない)。

| 定義 | ベンダー | 既定エイリアス | color | 役割 |
| --- | --- | --- | --- | --- |
| `gpt-sol` | gpt | `claude-gpt-5-6-sol` | yellow | `complex-impl` |
| `gpt-terra` | gpt | `claude-gpt-5-6-terra` | green | `normal-impl`, `general`, `explore`, `realtime-research`, `independent-review` |
| `gpt-luna` | gpt | `claude-gpt-5-6-luna` | cyan | `light-impl` |
| `grok` | grok | `claude-grok-4-6` | red | `normal-impl`, `light-impl`, `general`, `explore`, `realtime-research`, `independent-review` |

`code-review` / `doc-review` / `advisor` は担当表で Claude 帯(`Sonnet` / `Haiku` / `Fable`)が担うため、プリセットに含めない。役割 ID としては存在し、利用者が setup で選べる。

`gpt-terra` と `grok` は読み取り役割と実装役割を併せ持ち、§5.3 の警告に該当する構成になる。担当表がこれらの帯を同じエージェントへ振っている以上これは必然であり、プリセットでは警告を出さない。本文の制約衝突は §6.5 の役割スコープ付き制約で解消する。tools レベルの読み取り専用担保が無いことは §2.1 のとおり受け入れる。

`with-grok-policy` は「通常の実装と軽量な実装はどちらも Grok が担い、Agent Tool の可否を分けない」という例外を持つ(`with-grok-policy/SKILL.md`)。`grok` プリセットは `normal-impl` を含むため §5.2 により `Agent` が付き、この例外を満たす。

`gpt-sol` に `explore` を割り当てない。現行 `agents/gpt-sol.md` の「When to invoke」は複雑な実装だけであり、探索実働は担当表で `GPT Terra` / `Grok` が担うためである。

プリセットの役割が §11.1 の担当表と一致することは、テストで機械的に検査する(§13.1)。2 つの表を別々に手で維持すると必ずずれる。

### 8.2 生成

- プリセットの定義は `plugins/agent-policy/src/agents/presets.ts` に置く。
- `build.ts` に生成処理を追加し、`pnpm build` で `plugins/agent-policy/agents/*.md` を生成する。
- 生成物は git 管理下に置く。`plugins/*/scripts/` と同じ運用である。
- `build.ts` はプラグイン同梱の断片だけを読む。プロジェクト側の断片(§6.1)は読まない。
- 生成後に `PRESETS` に対応しない `agents/*.md` を削除する。`.md` 以外のファイルは触らない。

生成された同梱プリセットにも役割マーカーを入れる。これは setup の差分確認で「テンプレート由来の情報」だと判別するためである。**SessionStart フックは同梱プリセットを走査しない**(§9.2)。担当表が既にプリセット名を書いているため、同じ対応を注入しても冗長になる。

`src/` を変更したら `pnpm build` を実行し、生成物の差分も同じコミットに含める(CLAUDE.md の規律)。

### 8.3 既定エイリアスの更新(Grok 4.6)

Grok 4.6(2026-08-12 リリース)に合わせ、Grok の既定エイリアスを `claude-grok-4-5` から `claude-grok-4-6` へ更新する。

エイリアスはモデル本体の ID ではなく、ProxyAPI サーバーが配信するクライアント側の別名である。既定値を変えるだけでは動かず、**利用者はプロキシ側に同じ別名を用意する必要がある**(CLIProxyAPI なら `oauth-model-alias` に `xai` の `grok-4.6` → `claude-grok-4-6` を追加する)。

この変更には静かに壊れる経路がある。フックは `AMATSUKA_AGENT_GROK_ALIAS` が未設定なら「既定と一致」とみなして何も促さない(§9.2 の 3)。プロキシ側に `claude-grok-4-6` が無い利用者は、通知を受けないまま委譲時に `unknown provider for model` で失敗する。フックはプロキシへ問い合わせないため、これを事前に検知できない。

README の移行手順に、次のどちらかを行うよう明記する。

- プロキシ設定に `claude-grok-4-6` の別名を追加する(推奨)
- 4.5 を使い続けるなら `AMATSUKA_AGENT_GROK_ALIAS=claude-grok-4-5` を明示的に設定する

更新箇所は `src/agents/presets.ts`、`src/hooks/session-start.ts` の `fallback`、`plugins/agent-policy/README.md` の環境変数表と同梱エージェント表、ルート `README.md` である。0.7.0 設計書 §5 が定めた「モデル世代が変わったときは同梱定義とフックの既定値表を同時に更新する」に従う。

GPT 側の既定エイリアス(`claude-gpt-5-6-*`)は変更しない。


## 9. 役割マーカーと SessionStart フック

### 9.1 マーカー

定義ファイルの frontmatter に `agent-policy-role` を置く。値は役割 ID の CSV。

```yaml
---
name: my-heavy-coder
description: ...
model: my-custom-alias
tools: Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent
agent-policy-role: complex-impl, explore
---
```

Claude Code 2.1.241 で実測し、未知の frontmatter キーを持つ定義が警告なくエージェント一覧に載ることを確認した。対照として未知キーなしの定義も置き、両方が読み込まれることを確かめた。公式ドキュメント(`code.claude.com/docs/en/sub-agents`)が列挙するフィールドには含まれない挙動であり、§13 にリスクとして記録する。

### 9.2 フックの責務

SessionStart フックからファイル生成を廃止する。フックは読んで注入するだけになる。

走査対象は `${CLAUDE_PROJECT_DIR}/.claude/agents/*.md` のみとする。プラグイン同梱の `${CLAUDE_PLUGIN_ROOT}/agents/*.md` は走査しない(§8.2)。

1. **方針指示の注入** — `AMATSUKA_AGENT_AUTO_INJECTION` に従う(現行どおり)。
2. **役割マーカーの走査と注入** — 走査対象の frontmatter を読み、`agent-policy-role` を持つ定義を集める。役割 ID ごとに「担当表の『<帯名>』は `<name>` を使う」を注入する。同じ役割を複数定義が宣言したときは全て列挙し、選択はオーケストレーターに委ねる旨を添える。未知の役割 ID は無視し、その ID と定義名を注入文へ 1 行で添える(誤記に気づけるようにする)。
3. **setup 未実行・エイリアス不一致の促し** — エイリアス変数が既定と異なるとき、対応する定義名があり、その `model:` がエイリアス変数の値と一致すれば従来どおり充足とする。それ以外では、**そのエイリアスを `model` に持つ定義群の役割の和集合が、プリセットの `roleIds` を覆わない**ときに setup スキルの実行を促す。生成も修正もしない。

   `model:` が一致する定義が 1 つも無ければ、対応する定義名の有無と `model:` の食い違いに応じて従来どおり理由を示す。1 つ以上あっても役割が不足するときは、その定義名と不足している役割 ID を示す。`model:` を持たない定義は、どのエイリアスの充足にも数えない。`PRESETS` とエイリアス定義がずれて対応するプリセットを見つけられない場合だけは、役割を評価せず、対応する定義名と `model:` による従来の判定へ戻す。

   役割の和集合を使うため、利用者は 1 つのエイリアスを持つ複数の定義へ役割を分担でき、定義名にも依存しない。一方で、役割が 1 つでも交差すれば充足とする判定は採らない。たとえば `explore` 専用の定義だけがエイリアスを持つ場合に `normal-impl` の不足を見逃すためである。
4. **旧定義の残骸通知** — `.claude/agents/` に `claude-researcher.md` / `gpt-researcher.md` / `grok-researcher.md` / `grok-implementer.md` があれば、廃止済みである旨と削除を促す。フックは削除しない。残骸に `grok-` で始まる名前が含まれ、かつ `AMATSUKA_AGENT_GROK_ALIAS` が未設定(空文字を含む)のときだけ、次の 1 行も添える。

   > Grok の既定エイリアスは `claude-grok-4-6` へ変わった。プロキシ設定にこの別名が無い場合、委譲時に `unknown provider for model` で失敗する。4.5 を使い続けるなら `AMATSUKA_AGENT_GROK_ALIAS=claude-grok-4-5` を設定する。

例外を握りつぶしてフェイルオープンする挙動は現行どおり維持する。

### 9.3 自動生成を廃止する理由

現行 `session-start.ts` は、エイリアス差分がある限り毎セッション同梱定義ベースで `.claude/agents/` を上書きする。setup で利用者が足した tools や規律は、次のセッションで消える。書き込みの責務を setup へ一本化することでこの事故が消える。

代償として、エイリアスを既定と変えている利用者は初回に 1 回 setup を回す必要が戻る。これは受け入れる。

## 10. setup-gpt / setup-grok

### 10.1 手順

`--yes` を渡されないときは、次の順に進める。

1. **前提確認** — Codex 系 / Grok 系モデルを配信するプロキシ経由で Claude Code を起動しているかを確認する。検証コマンドは実行させない。前提が満たせないときは代替方針を案内して終了する。
2. **役割の選択** — `AskUserQuestion` の複数選択で §4 の役割から選ばせる。表示順は §4 の表順とする。プロジェクト側の断片(§6.1)があれば、その役割 ID も選択肢に加える。選択数の上限は設けない。
3. **読み取り専用性の確認** — §5.3 に該当する組み合わせなら警告を出し、続行するか確認する。既定は「続行しない」とし、利用者が明示的に選んだときだけ進む。
4. **名前のヒアリング** — 役割の組み合わせから候補を提示しつつ、自由に変更できるようにする。プリセットと同じ役割構成なら、そのプリセット名を第一候補にする。
5. **モデルエイリアスのヒアリング** — 役割から推奨を提示する。`complex-impl` を含むなら Sol、`light-impl` のみなら Luna、それ以外は Terra を推奨する。Grok はエイリアスが 1 つのため推奨のみを提示する。
6. **既存確認と差分提示** — §10.2。
7. **生成** — スクリプトが合成して書き込む。
8. **後処理案内** — 次を伝える。
   - 生成したパスと、`.claude/agents/` を git 追跡するかはプロジェクト判断であること
   - Claude Code が `.claude/agents/` の変更を読み直すこと(新規ディレクトリを作った初回だけ再起動が要る)
   - 読み取り専用の作業(独立レビュー・探索実働)を tools レベルで担保したい場合は、読み取り役割だけを選んだ定義を別に作れること
   - CLAUDE.md への追記文例(自動では書き込まない)

`--yes` を渡されたときは、確認を挟まず既定プリセット(setup-gpt なら `gpt-sol` / `gpt-terra` / `gpt-luna`、setup-grok なら `grok`)を既定エイリアスで `--write --merge` により生成する。テンプレートに存在し得ない情報は保持し、テンプレート側で上書きした内容は報告する。

### 10.2 差分確認

比較対象の「テンプレート」とは、**その場で役割断片から合成した内容**を指す。`presets.ts` のリテラルではない。断片が更新されればテンプレートも変わるため、再 setup で断片側の更新を差分として検出できる。

スクリプトは `--check` で構造化差分を JSON で返す。

```json
{
  "ok": true,
  "target": ".claude/agents/gpt-sol.md",
  "exists": true,
  "identical": false,
  "roles": {
    "ids": ["complex-impl"],
    "implRoles": ["complex-impl"],
    "readonlyRoles": [],
    "mixedKinds": false,
    "agentTool": true
  },
  "frontmatter": {
    "changed": [{ "key": "model", "existing": "my-sol", "template": "claude-gpt-5-6-sol" }],
    "toolsOnlyInExisting": ["mcp__context7"],
    "toolsOnlyInTemplate": ["LSP"],
    "keysOnlyInExisting": ["permissionMode"]
  },
  "preambleChanged": true,
  "body": {
    "sectionsOnlyInExisting": ["## ツール運用"],
    "sectionsOnlyInTemplate": [],
    "sectionsChanged": ["## 制約"]
  }
}
```

`roles` は、その場で合成した定義の役割要約である。`ids` は役割の表順、`implRoles` と `readonlyRoles` は断片の `kind` による分類、`mixedKinds` は両種別が混在するか、`agentTool` はその役割構成で `Agent` が付くかを示す。setup は `mixedKinds` を §5.3 の読み取り専用性の確認に使う。

**テンプレートに存在し得ない情報**とは `toolsOnlyInExisting` / `keysOnlyInExisting` / `sectionsOnlyInExisting` の 3 つを指す。利用者が足したものであり、テンプレートからは再生成できない。

`changed` と `preambleChanged` はこの 3 つに含まれない。テンプレート側にも同じ要素が存在し、値だけが違う状態である。ただし利用者が意図的に変えた可能性がある(典型は `model` と `description`、冒頭宣言の書き換え)。保持マージの既定はテンプレート側を採るため、**残したい場合は個別に選ぶ必要がある**。差分提示でその旨を明示する。

スキルは差分を提示し、`AskUserQuestion` で方針を選ばせる。

- **保持マージ(推奨)** — `--write --merge` を使う。テンプレートに存在し得ない情報を自動で残し、それ以外はテンプレート側で更新する。
- **項目を選んで保持** — `--write --merge` に加え、`changed` / `preambleChanged` のうち残すものを `--keep key:<name>` / `--keep section:<heading>` / `--keep preamble` で指定する。
- **完全上書き** — `--write` を使い、既存を捨ててテンプレートどおりに書く。
- **スキップ** — 書き込まない。

`--merge` は `--write` と併用する。既存ファイルがあるとき、`toolsOnlyInExisting` / `keysOnlyInExisting` / `sectionsOnlyInExisting` にあるテンプレートに存在し得ない情報を自動で `--keep` 相当として保持する。明示した `--keep` は、この自動保持に追加される。保持マージと `--yes` はともにこのフラグを経由する。

書き込み結果は `action`、`kept`、`discarded` を返す。`action` は新規作成なら `written`、`--merge` による既存ファイルの更新なら `merged`、`--merge` なしの既存ファイル更新なら `overwritten` である。`discarded` はテンプレート側で上書きした項目を示す。保持した `mcp__*` tools と `## ツール運用` 節は、旧版の同梱定義由来である可能性を `keptNeedsReview` として別に示す。

合成と書き込みはスクリプトが行う。書き込みをスクリプトへ閉じることで再現性を確保する。

**検出できないもの**を差分提示に明示する。

- 節の中身の一部改変(`sectionsChanged` は節単位でしか扱わない。既存節へ 1 行足しただけの変更は、保持を選ばない限り消える)
- 冒頭宣言以外の、見出しに属さないテキストの追記
- 本文中の HTML コメント

完全な 3-way マージは実装しない。上記を許容した上で、利用者が最も足しがちな箇所(tools・独自 frontmatter キー・独自節)を保護することを目的とする。

### 10.3 `allowed-tools` と書き込みの規律

当初は、`allowed-tools` に `Write` / `Edit` を書かなければ書き込みを禁止できると定めていた。しかし `allowed-tools` は利用可能なツールを絞るフィールドではない。書き込みを直接行わせない設計は、次の 3 層で担保する。

| 層 | 手段 | 意味 |
| --- | --- | --- |
| 事前承認 | `allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *), AskUserQuestion` | 起動ターンで、列挙したツールを確認なしで使えるようにする |
| 起動ターン限りの除去 | `disallowed-tools: Write, Edit` | スキルが起動したターンだけ `Write` / `Edit` を利用可能なツールのプールから除く |
| 本文の恒久指示 | SKILL.md の standing instruction | `.claude/agents/` を `Write` / `Edit` で直接編集せず、必ず `setup-agents.mjs` で書き込むよう指示する |

公式ドキュメントの Frontmatter reference は、それぞれ次のように定義する。

| フィールド | 原文 |
| --- | --- |
| `allowed-tools` | "Tools Claude can use without asking permission during the turn that invokes this skill." |
| `disallowed-tools` | "Tools removed from Claude's available pool while this skill is active." |

同じドキュメントは `allowed-tools` について "It does not restrict which tools are available: every tool remains callable" とし、`disallowed-tools` について "The restriction clears when you send your next message." とする。したがって、`allowed-tools` に列挙しないことは禁止を意味しない。また `disallowed-tools` は起動ターンの保護であり、`AskUserQuestion` を挟むウィザード全行程で `Write` / `Edit` を禁止するものではない。

SKILL.md の本文はセッションに残る。公式ドキュメントが "This persistence applies to the skill's instructions, not its permissions" と明記するため、本文の standing instruction は権限の付与・除去が次のユーザーメッセージで切れた後も効く。書き込みを行えるのを `setup-agents.mjs` に閉じる構造(§10.2)と、この恒久指示を組み合わせる。

出典: [Claude Code Skills](https://code.claude.com/docs/en/skills) の Frontmatter reference / "Pre-approve tools for a skill" / "Skill content lifecycle"、2026-08-24 取得。

### 10.4 `--list-roles`

`--list-roles` は、`--name` / `--model` / `--roles` を要求せず、`--dir` と `--vendor` を受け付ける一覧モードである。次の形式で JSON を返す。

```json
{
  "ok": true,
  "roles": [
    {
      "id": "complex-impl",
      "label": "複雑または重要な実装",
      "kind": "impl",
      "tools": ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill", "LSP"],
      "source": "plugin"
    }
  ]
}
```

並びは §4 の表順、同順のものは `id` の `localeCompare` 順とする。プロジェクト固有の役割は末尾に並ぶ。プロジェクト側の断片が組み込みと同じ `id` を置き換えたときは、その要素の `source` は `project` になる。

## 11. 方針スキルの改訂

### 11.1 担当表

researcher 3 定義の廃止に伴い、担当表の該当行をモデル名へ置き換える。ユーザー定義が無いときは同帯の実装エージェントが担う。

| 方針 | リアルタイム情報調査 | コードベース探索実働 | 独立レビュー |
| --- | --- | --- | --- |
| `claude-model-policy` | `Sonnet` | `Sonnet` | `Sonnet` |
| `with-codex-policy` | `GPT Terra` | `GPT Terra` | `GPT Terra` |
| `codex-grok-policy` | `Grok` | `Grok` | `Grok` |
| `with-grok-policy` | `Grok` | `Grok` | `Grok` |

`with-grok-policy` の「通常の実装」「軽量な実装」「その他のタスク」は `Grok Implementer` から `Grok` へ改名する。

### 11.2 役割マーカーの優先

各方針へ次の節を追加する。

> ## 役割マーカー付き定義の優先
>
> SessionStart フックが「担当表の『<帯名>』は `<name>` を使う」と注入したときは、その帯の委譲先を担当表より優先してその定義とする。同じ帯に複数の定義が挙がったときは、依頼内容に近いものを選ぶ。

### 11.3 実行帯の解決順

`gpt-researcher` / `grok-researcher` / `claude-researcher` への参照を削除し、次の順へ書き換える。

1. 役割マーカーで注入された定義があればそれを使う。
2. プロジェクトの `.claude/agents/<プリセット名>.md` が存在すればそれを使う。
3. 存在しなければ同梱プリセット `agent-policy:<name>` を使う。
4. ローカルプロキシ経由で呼び出せないときは、既存のフォールバック節に従う。

「環境変数で既定と異なるエイリアスを指定したときは SessionStart フックがここへ定義を生成する」という記述は、フックが生成しなくなるため削除し、`setup-gpt` / `setup-grok` の実行案内へ置き換える。

### 11.4 dispatch 節

researcher 廃止により、読み取り専用の作業を `Write` / `Edit` を持つ実装エージェントへ委譲する場面が生じる。各方針の dispatch 節へ次を追記する。

> - 独立レビュー・探索実働・リアルタイム情報調査を、実装エージェント(`Write` / `Edit` を持つ帯)へ委譲するときは、依頼文に次を明記する。
>   - 使用してよい tools を読み取り系に限定すること(`Read` / `Grep` / `Glob`、読み取りに限った `Bash`、必要なら `WebSearch` / `WebFetch`)
>   - ファイルを変更しないこと、報告のみを返すこと

各方針が既に持つ「依頼文に『この tools のみ使用』と明記する」は、**エージェント定義の tools 全体**を指しており、部分集合へ絞る指示ではない。調査目的の委譲では、そこからさらに読み取り系だけを明示する。

この制約は方針スキル本文に置き、オーケストレーターが dispatch のたびに依頼文へ書き写す。定義側の本文には書かない — 定義は実装役割も兼ねており、常時この制約が効いてはならないためである(§6.5)。

### 11.5 フォールバック節

`codex-grok-policy` の「Grok が利用不可のときのフォールバック」の「探索実働: `GPT Terra` / `GPT Luna` へ読み替える」は維持する。`with-grok-policy` の同節は `Grok Implementer` を `Grok` へ改名する。

## 12. 影響ファイル

新規:

- `plugins/agent-policy/assets/roles/_common.md`
- `plugins/agent-policy/assets/roles/<role-id>.md`(10 件)
- `plugins/agent-policy/assets/roles/realtime-research.grok.md`(ベンダー別断片)
- `plugins/agent-policy/src/agents/roles.ts`(役割 ID の定数・担当表の帯との対応)
- `plugins/agent-policy/src/agents/presets.ts`
- `plugins/agent-policy/src/agents/compose.ts`(断片の読み込みと合成)
- `plugins/agent-policy/src/setup-agents.ts`
- `plugins/agent-policy/scripts/setup-agents.mjs`(ビルド生成物)
- `plugins/agent-policy/skills/setup-gpt/SKILL.md`
- `plugins/agent-policy/skills/setup-grok/SKILL.md`
- `plugins/agent-policy/src/__test__/compose.test.ts`
- `plugins/agent-policy/src/__test__/setup-agents.test.ts`

変更:

- `plugins/agent-policy/agents/{gpt-sol,gpt-terra,gpt-luna}.md`(ビルド生成へ切り替え)
- `plugins/agent-policy/src/hooks/session-start.ts`(生成の廃止・マーカー走査の追加)
- `plugins/agent-policy/src/hooks/__test__/session-start.test.ts`
- `plugins/agent-policy/skills/{claude-model,with-codex,with-grok,codex-grok}-policy/SKILL.md`
- `plugins/agent-policy/references/orchestration-discipline.md`(役割マーカーへの言及を追加)
- `plugins/agent-policy/build.ts`
- `plugins/agent-policy/package.json` / `.claude-plugin/plugin.json`(version)
- `plugins/agent-policy/README.md`
- `.claude-plugin/marketplace.json`(description)
- ルート `README.md`

削除:

- `plugins/agent-policy/agents/{claude-researcher,gpt-researcher,grok-researcher,grok-implementer}.md`

`grok-implementer.md` は `grok.md` への改名に相当する。

## 13. テスト方針

`vitest` で次を確認する。既存の `src/testing/run-ts.ts` の `runTs` による子プロセス実行に倣う。

### 13.1 合成(`compose.ts`)

**tools の導出**

- 単一役割から、期待した `tools` を持つ定義が生成される。
- 複数役割の `tools` が和集合になる。MCP ツールが 1 つも含まれない。
- `complex-impl` / `normal-impl` / `general` を含むとき `Agent` が付き、`light-impl` のみ・読み取り役割のみのとき付かない。
- `light-impl` + `complex-impl` で `Agent` が付く(§5.2)。

**frontmatter**

- `description` が、選ばれた役割の `description` を連結した形になる。
- `color` がベンダーごとの固定値になる。
- `agent-policy-role` が §4 の表順で並ぶ。

**本文**

- 節構造が §6.3 の順序になる。`Agent` が付かないとき「アドバイザーへの相談」節が出ない。
- 単一役割のとき `## Output Format` に小見出しが立たず、複数役割のとき `### <label>` が立つ。
- 読み取り役割の制約が役割スコープ付き(「〜として依頼されたときは」)で出力される(§6.5)。
- **断片の本文に他定義の名前が含まれない**(§6.4)。`GPT Sol` / `GPT Terra` / `GPT Luna` / `Grok` 等の固有名を全断片へ grep して検出する。

**断片の解決**

- ベンダー別断片が共通断片の同名節へ追記される(置き換えではない)。
- プロジェクト側の断片が同じ役割 ID の共通断片を置き換える。置き換え後の節にもベンダー別断片が追記される。
- プロジェクト側にしかない役割 ID が選択肢に現れる。
- `build.ts` の経路ではプロジェクト側の断片を読まない(§6.1)。

**整合性**

- 役割断片の frontmatter が `id` / `label` / `description` / `tools` / `kind` を必ず持ち、`kind` が `impl` / `readonly` のいずれかである。
- 断片のファイル名と `id`、`roles.ts` の定数が三者一致する。
- **プリセットの役割が §11.1 の担当表と一致する。** 担当表の帯 → 担当モデル名の対応を `roles.ts` に持ち、4 プリセットの役割集合が、その担当表で自分に割り当てられた帯を漏れなく含むことを検査する(§8.1)。
- 4 プリセットが期待どおりの `tools` と役割マーカーを持つ。
- 4 プリセットの `model` が既定エイリアスと一致する(Grok は `claude-grok-4-6`)。`presets.ts` とフックの `fallback` が同じ値を参照し、片方だけ更新される事故を防ぐ。

### 13.2 差分(`setup-agents.ts`)

- 既存が無いとき `exists: false` を返す。
- 既存とテンプレートが同一のとき `identical: true` を返す。
- 既存にしかない tools / 未知 frontmatter キー / 節が、それぞれ `toolsOnlyInExisting` / `keysOnlyInExisting` / `sectionsOnlyInExisting` に出る。
- 冒頭宣言を書き換えた既存で `preambleChanged: true` になる。
- `model` / `description` を変えた既存が `changed` に出る。
- 役割断片を更新したとき、その節が `sectionsChanged` に出る(テンプレートがその場で合成されることの確認)。
- `--keep` で指定したものだけが保持され、指定しなかったものはテンプレート側で置き換わる。
- `--keep key:description` / `--keep preamble` が個別に効く。
- `--keep` を渡さないとき完全上書きになる。
- 不正な役割 ID・不正な `--keep` セレクタでエラーを返す。

### 13.3 フック(`session-start.ts`)

- ファイルを 1 つも書かない(全ケース)。
- 役割マーカーを持つ定義から、期待した帯 → 名前の対応が注入される。
- 同じ役割を複数定義が宣言したとき、全て列挙される。
- 未知の役割 ID を宣言した定義は無視され、その ID と定義名が注入文に出る。
- 同梱プリセットを走査しない(`CLAUDE_PLUGIN_ROOT` 配下にマーカー付き定義があっても注入されない)。
- エイリアス差分があり定義が無いとき、setup の促しが出る。
- エイリアス差分があり定義はあるが `model:` が食い違うとき、setup の促しが出る。
- エイリアス差分があり `model:` も一致するとき、促しが出ない。
- 旧定義 4 種が `.claude/agents/` にあるとき、残骸通知が出る。
- 例外時に stdout へ何も出さず終了コード 0 を返す。

## 14. リスクと受容

| リスク | 受容の理由と対処 |
| --- | --- |
| 未知 frontmatter キーの黙殺は公式ドキュメントに無い挙動 | 2.1.241 で実測済み。キー名にプラグイン名前空間を付け、将来の公式フィールドとの衝突を避ける。厳格化された場合は、マーカーを本文先頭の HTML コメント(`<!-- agent-policy-role: ... -->`)へ退避する。フック側のパーサだけの変更で済むよう、走査処理を 1 関数に閉じる |
| 探索実働・独立レビューが読み取り専用の帯でなくなる | §2.1 のとおり意図した取り消し。§11.4 の dispatch 節と、読み取り役割だけで作った定義の 2 つで担保する。オーケストレーターが dispatch 節を守らないと無効になる点は受け入れる |
| `gpt-terra` / `grok` プリセットが読み取り役割と実装役割を併せ持つ | 担当表が同じ帯を振っている以上必然(§8.1)。本文の制約衝突は §6.5 で解消する。tools レベルの担保は無い |
| 相互参照(「通常の実装は GPT Terra に委ねる」)が失われる | §6.4 のとおり、名前が利用者可変になる以上避けられない。押し戻し先の判断はオーケストレーターが担当表で行う |
| エイリアス変更時に setup が必須になる | §9.3 のとおり受け入れる。定義が無いときも、`model:` が食い違うときも、フックが促しを出す(§9.2) |
| setup 生成物がプラグイン更新に追随しない | 再 setup の差分確認(§10.2)で追随する。同梱プリセットをそのまま使う利用者は自動追随する |
| 節の中身の一部改変・冒頭宣言以外の追記を差分検出できない | §10.2 のとおり明示する。完全な 3-way マージは実装しない |
| `changed` 項目の既定がテンプレート採択 | 利用者が意図的に変えた `model` / `description` が保持マージで消える。差分提示で明示し、個別保持の選択肢を出す(§10.2) |
| 役割断片の粒度が細かく、断片間で文言が重複する | 重複は断片の統合で解消する。合成器は重複除去をしない |
| 旧定義 4 種が `.claude/agents/` に残る | フックの残骸通知と README の移行手順で気づけるようにする。フックは削除しない |
| Grok 既定エイリアスの 4.6 化で、プロキシ側に別名が無い利用者が沈黙して失敗する | フックはプロキシへ問い合わせないため事前検知できない(§8.3)。エイリアス変数が未設定だと促しも出ない。README の移行手順で、プロキシ設定への別名追加か `AMATSUKA_AGENT_GROK_ALIAS=claude-grok-4-5` の明示指定を促す |
| `disallowed-tools` は claude.ai へのアップロードと Skills API のパッケージ仕様で許される 6 フィールドに含まれない | 本プラグインは Claude Code 用スキルのため影響しない。将来アップロード経路へ載せる場合はハードエラーになるため、当該 frontmatter を除くか経路を分ける。公式ページには最小バージョンの記載がない |
| `--merge` は保持対象が利用者の追加か旧版の同梱定義由来かを区別できない | `mcp__*` tools と `## ツール運用` 節を自動除外すると利用者の意図的な追加を壊すため、保持した上で `keptNeedsReview` に可視化するに留める。採否は利用者が判断する |
| `sortRoleIds` の変更でプロジェクト固有役割を含む定義に 1 度だけ並び差分が出る | 未知 ID は担当表の既知 ID の後ろへ並ぶ。役割マーカー CSV、本文節の連結順、カスタム断片由来の tools 順が変わり得て `identical: false` になるが、中身は同じであり、保持マージで通過できる |

## 15. バージョン

`0.8.0-dev` → `0.9.0-dev`。`--list-roles` と `--merge` の機能追加を含むため、マイナーを上げる。`plugins/agent-policy/package.json` の `version` も同じ値に揃える。
