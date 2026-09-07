# agent-policy 上流 2 帯のサブエージェント化とオーケストレーターの役割定義 設計書

- 作成日: 2026-09-07
- 対象プラグイン: `plugins/agent-policy`
- 現行バージョン: `0.15.0-dev` → `0.16.0-dev`
- 状態: 設計(実装前・第 1 版)
- 関連: `harness-docs/design/2026-08-31-agent-policy-two-profile-design.md`(2 プロファイル化)、`2026-08-27-agent-policy-external-agent-model-assignment-design.md`(合成)、`2026-08-24-agent-policy-role-based-setup-design.md`(役割ベース setup)

## 1. 背景と目的

現行の担当表(`skills/claude-model-policy/SKILL.md` L17-18、`skills/custom-policy/SKILL.md` L19-20)は「設計書・実装計画書(WBS)の作成」「コードベース探索統括」の 2 行を持ち、いずれもモデルを `Opus` としている。しかしこの 2 行は帯として実装されていない。

- `src/agents/roles.ts` の `RoleId` は 14 種(L3-17)であり、この 2 つを含まない。`ASSIGNMENTS` / `RECOMMENDED`(`src/agents/policies.ts` L128-162)も 14 帯である。
- `assets/roles/{ja,en}/` の断片は 14 本(`_common.md` とベンダー overlay を除く)であり、この 2 つの断片は無い。
- `README.md` L109-127 は「組み込みの役割 ID は次の 14 種です」と書く。
- `skills/custom-policy/SKILL.md` L36 は「『設計書・実装計画書(WBS)の作成』『コードベース探索統括』はオーケストレーター自身が担う。サブエージェントへ委譲しない」と明記する。
- `references/orchestration-discipline.md` L46 は「担当表に帯を持たない作業(設計書・実装計画書の作成、コードベース探索統括)は合成しない」と、帯が無いことを前提に書く。

一方で同じ規律の別の箇所は、この 2 つを帯として扱っている。

- `references/orchestration-discipline.md` L85「コードベース探索は担当表の『コードベース探索統括』の帯が統括する」。
- 同 L86「context-map の執筆・§未解決事項の判断・要件確定への接続は、担当表の『コードベース探索統括』の帯が行う」。
- `assets/context-map-template.md` L4「**作成者**: Opus(探索統括)」。

この矛盾の根は「オーケストレーター = Opus」という前提である。オーケストレーターのモデルはセッションを起動したモデル(Fable / Opus / Sonnet のいずれか)であり、プラグインからは固定できない。担当表に `Opus` と書けるのは、`model` 上書きまたは定義の frontmatter で実行モデルを決められる対象、すなわちサブエージェントの役割だけである。したがって「オーケストレーター自身が担う帯に Opus と書く」ことは、そもそも成立しない。

本改修は次を行う。

1. 「設計書・実装計画書(WBS)の作成」「コードベース探索統括」を **Opus サブエージェントの帯として正式化する**(RoleId 2 種の追加、断片 2 本 × 2 言語、担当表正本への追加)。
2. 担当表の全帯がサブエージェントの役割であることを、共通規律に**宣言として 1 箇所だけ置く**。両方針スキルは共通規律を必読としているため、スキル側には重複させない。
3. オーケストレーターが自ら担う作業を「dispatch・要件確定・採否判断・承認・分析」と定義し、**分析の範囲を 3 つ(報告の突き合わせ・判断 / 要件分析 / 原因分析・調査)まで明記する**。
4. 上記に伴う規律・テンプレート・setup・README・テストの追随。

### ユーザー決定(2026-09-07。本設計はこれを前提とし、覆さない)

1. 2 帯を Opus サブエージェントの帯として正式化する。担当表の 2 行のモデル欄は `Opus` のまま維持する。
2. 宣言は担当表全体にかける。対象 2 帯だけに「委譲する」と注記しない(他帯がオーケストレーター担当と読めるため)。
3. custom-policy L36 の箇条は削除する。
4. 宣言は共通規律の冒頭「担当表とは〜」の定義文に 1 箇所だけ置く。両 SKILL.md には置かない(同じ規律を複数の指示書に書かない。両 SKILL.md は L10 で共通規律を必読にしている)。
5. 「分析」はオーケストレーターの役割と明記する。範囲は 3 つすべて。探索の実働は帯へ委譲するが結論はオーケストレーターが出す。「その他のタスク」帯へ丸投げしない。
6. Agent Tool を許可しない 6 帯の列挙は現状維持。新 2 帯は許可側。
7. `context-map-guide.md` の「オーケストレーター = 圧縮された map を読む側」は維持。規律 L86 のうち「§未解決事項の判断・要件確定への接続」はオーケストレーターへ移し、「context-map の執筆」だけを統括帯に残す。
8. 規律 L46 の括弧書きを撤回し、合成対象を 13 帯 → 15 帯へ拡張する。
9. 「複数の context-map・設計書・実装差分・並列サブエージェントの全レポートを分割せず一度に読んで突き合わせる」条項は維持する。
10. 設計書の執筆は「設計書・実装計画書(WBS)の作成」帯へ委譲し、その後 Haiku レビュー → 独立レビュー → オーケストレーターが採否判断 → ユーザー提示、とする。
11. custom-policy の推奨モデルは、この 2 行とも `Opus` のみにする(`GPT Sol` を併記しない)。

## 2. 前提

### 2.1 コードの現況(実測)

| 対象 | 現況 |
| --- | --- |
| `src/agents/roles.ts` L3-17 | `RoleId` 14 種。L26 のコメントに「並び順は設計書 §4 の表順であり、`agent-policy-role` の CSV の並びにも使う」 |
| `src/agents/roles.ts` L1 | `RoleKind = "impl" \| "readonly"` の 2 値 |
| `src/agents/roles.ts` L130-133 | `hasMixedKinds` は impl と readonly の同居だけを true にする |
| `src/agents/policies.ts` L124-144 | `ASSIGNMENTS["claude-model-policy"]` が 14 帯 |
| `src/agents/policies.ts` L147-162 | `RECOMMENDED` が 14 帯 |
| `src/agents/policies.ts` L166-182 | `AGENT_DENIED_MODELS = ["haiku"]`、`SOLO_DENIED_ROLES` 6 帯、`allowsAgentTool` |
| `src/agents/compose.ts` L44-45 | `allowsAgentTool` の結果で `Agent` tool を tools へ足す。ROLES の `tools` は `Agent` を含まない基底値 |
| `src/agents/compose.ts` L113-130 | `describeRoles` が `kind === "impl"` / `"readonly"` で 2 分し、`mixedKinds` を返す |
| `src/agents/fragments.ts` L83 | `kind` が `impl` / `readonly` 以外なら例外 |
| `assets/roles/{ja,en}/` | `_common.md` + 14 本 + `realtime-research.grok.md` |

### 2.2 文書の現況(実測・変更対象行)

| ファイル | 行 | 現在の文言 |
| --- | --- | --- |
| `skills/claude-model-policy/SKILL.md` | L17 | `| 設計書・実装計画書(WBS)の作成 | `Opus` |` |
| 同 | L18 | `| コードベース探索統括 | `Opus` |` |
| `skills/custom-policy/SKILL.md` | L19 | `| 設計書・実装計画書(WBS)の作成 | `Opus` |` |
| 同 | L20 | `| コードベース探索統括 | `Opus` |` |
| 同 | L36 | 「「設計書・実装計画書(WBS)の作成」「コードベース探索統括」はオーケストレーター自身が担う。サブエージェントへ委譲しない。」 |
| `references/orchestration-discipline.md` | L5 | 「以下で「担当表」とは、読み込んだ方針の §モデル別役割 の表を指す。帯の名前は担当表の行名で参照する。」 |
| 同 | L14 | 「オーケストレーターは、複数の context-map・設計書・実装差分・並列サブエージェントの全レポートを分割せず一度に読んで突き合わせる。要約の要約では判断しない。」 |
| 同 | L46 | 「合成の対象とする帯は、…の 13 帯とする。「その他のタスク」と、担当表に帯を持たない作業(設計書・実装計画書の作成、コードベース探索統括)は合成しない。」 |
| 同 | L85 | 「コードベース探索は担当表の「コードベース探索統括」の帯が統括する。grep/read の反復など短命な探索実働は、担当表の「コードベース探索実働」の帯へバッチ委譲する。」 |
| 同 | L86 | 「context-map の執筆・§未解決事項の判断・要件確定への接続は、担当表の「コードベース探索統括」の帯が行う。」 |
| 同 | L97 | 「出力した設計書・実装計画書は、まず担当表の「設計書・実装計画書のレビュー」の帯にレビュー(理解+暗黙知・矛盾抽出)させ、オーケストレーターが補足修正を加える。」 |
| `references/context-map-guide.md` | L12 | `| オーケストレーター | セッションを主導し、dispatch・要件確定・承認・最終レビューを行う役割 |` |
| 同 | L37 | 「オーケストレーター | 圧縮された map を読む(= 生探索の代替)。…」(**維持**) |
| 同 | L40 | 「map 作成者 | 自己共有は不要。作成者 ≠ 下流設計者になった場合だけ、次の dispatch にパスを渡す」 |
| `assets/context-map-template.md` | L4 | `**作成者**: Opus(探索統括)` |
| `README.md` | L109 | 「組み込みの役割 ID は次の 14 種です。」+ L111-127 の表 |
| 同 | L103 | MCP 既定の実装役割列挙(`complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general`) |
| `skills/setup-agents/SKILL.md` | L236 | 同じ実装役割列挙 |

### 2.3 変えない前提

- `AGENT_DENIED_MODELS` / `SOLO_DENIED_ROLES` / `allowsAgentTool` は変更しない。新 2 帯は `SOLO_DENIED_ROLES` に入らないため Agent Tool 許可側になる。
- `MODELS`(9 ModelSpec)、`POLICIES`(2 件)、live models 機構、SessionStart / SubagentStart の分岐、delegation gate、parallel nudge は変更しない。
- 実装計画書(WBS)は本設計書のスコープ外である。

## 3. 全体像

```
担当表(16 行)= すべてサブエージェントの役割
  ├─ 既存 14 帯(変更なし)
  └─ 新設 2 帯
       design-plan   設計書・実装計画書(WBS)の作成   kind: impl  Agent Tool 許可
       explore-lead  コードベース探索統括             kind: impl  Agent Tool 許可

オーケストレーター(モデル固定不能。帯を持たない)
  dispatch / 要件確定 / 採否判断 / 承認 / 分析
    分析 = ① 報告の突き合わせ・判断  ② 要件分析  ③ 原因分析・調査

上流フロー
  探索が要る → explore-lead へ委譲
                 └─ explore へ実働をバッチ再委譲 → context-map 執筆
  オーケストレーターが §未解決事項を判断し、要件を確定
  → design-plan へ設計書・実装計画書を委譲(context-map を入力)
  → doc-review 帯 → independent-review 帯
  → オーケストレーターが採否判断・補足修正 → ユーザー提示 → Approve
```

## 4. 各変更の詳細

### 4.1 RoleId 2 種の追加(`src/agents/roles.ts`)

#### 命名

| 帯 | RoleId | 根拠 |
| --- | --- | --- |
| 設計書・実装計画書(WBS)の作成 | `design-plan` | 既存 ID の一部(`doc-review` / `code-review` / `final-review` / `gate-review` / `e2e-verify`)が 2 語ケバブであり、他は形容語+`impl` や 1 語である。流儀は一様でないため命名規則からは決まらず、語の衝突回避と意味の網羅で選ぶ。`design-plan` は「設計と計画(の文書)」を 2 語で表し、既存の `doc-review`(設計書のレビュー)と語が衝突しない。`design-doc` は実装計画書を落とし、`wbs` は略語で意味が閉じるため採らない(§7) |
| コードベース探索統括 | `explore-lead` | 実働帯が `explore` であり、統括を接尾辞 `-lead` で表すと 2 語で親子関係が読める。`explore-orchestrator` はオーケストレーターと語が衝突し、本改修の主眼(この帯はサブエージェントである)を濁すため採らない |

この ID は `agent-policy-role` の CSV、README の役割 ID 表、setup の選択肢に現れる。

#### 並び位置

`ROLES` に `general`(現 L52-57)の直後、`explore`(現 L58-63)の直前へ、`design-plan` → `explore-lead` の順で挿入する。結果の並びは次のとおり。

```
complex-impl, normal-impl, light-impl, escalation, general,
design-plan, explore-lead,
explore, realtime-research, e2e-verify, independent-review,
doc-review, code-review, final-review, gate-review, advisor
```

根拠:

- `kind` のブロックを崩さない。新 2 帯は `impl`(後述)であり、impl 群の末尾に置けば「impl 群 → readonly 群」という現行の並びが保たれる。
- 担当表の並び(設計書作成 → 探索統括 → 探索実働)と相対順が一致し、`explore-lead` が `explore` の直前に来て親子が隣接する。
- 先頭・末尾を動かさないため、`src/agents/__test__/roles.test.ts` L108-109 の `roleOrder("complex-impl") === 0` と `roleOrder("advisor") === ROLES.length - 1` が値の変更なしで通り続ける。先頭挿入・末尾追加はどちらかを壊す。

#### kind

**両帯とも `kind: "impl"` とする。** 第 3 の kind は採らない。

| 案 | 評価 |
| --- | --- |
| A. `impl`(採用) | 両帯は成果物ファイル(`harness-docs/design/` `harness-docs/plans/` `.claude/context-maps/`)を Write する。`fragments.ts` L83 の検証・`compose.ts` L115-126 の 2 分・`hasMixedKinds`・setup の MCP 既定のいずれも変更不要。setup の MCP 既定(実装役割を持つ定義に全サーバーを付ける)がそのまま効き、`explore-lead` は Serena、`design-plan` は Context7 を既定で得る。これは両帯の実務に合う |
| B. `readonly` | 実態(Write する)と矛盾する。`tools` に `Write` を入れると、setup が読み取り専用定義向けに行う `disallowedTools` 提案の前提(読み取り役割だけの定義には外部状態を変えるツールを禁じる)と噛み合わない。不採用 |
| C. 第 3 の kind(例 `authoring`) | `RoleKind` の 2 値前提が `roles.ts` L130-133・`compose.ts` L113-130(`implRoles` / `readonlyRoles` / `mixedKinds`)・`fragments.ts` L83・`RolesSummary` の型・setup の MCP 既定・README・SKILL の全文に波及する。得られるのは「コードは書かないが文書は書く」という区別だけで、現行のどの判断分岐もこの区別を要求していない。費用が便益を大きく上回るため不採用(§7) |

受容する副作用: `explore-lead` と `explore` を 1 つの定義に同居させると `describeRoles` の `mixedKinds` が `true` になる。この値は `--list-coverage` の JSON 出力に載るだけで、`skills/setup-agents/SKILL.md` の対話手順には提示文言が無い(独立レビューで確認)。つまり利用者へ警告として届く経路は現状無く、同居は黙って許容される。`explore` は「成果物を作らず報告のみ」、`explore-lead` は「context-map を書く」という反対の制約を持つため、`setup-agents/SKILL.md` の対話手順に「`mixedKinds` が真のとき、読み取り帯と実装帯の同居を知らせて分離を提案する」文言を本改修で足す。

#### tools

| RoleId | tools |
| --- | --- |
| `design-plan` | `Read, Grep, Glob, Write, Edit, Bash, Skill` |
| `explore-lead` | `Read, Grep, Glob, Write, Edit, Bash, Skill` |

根拠: いずれも `complex-impl` / `escalation` / `general` と同じ集合である。`Write` は成果物の新規作成、`Edit` は同一セッション内の更新(context-map は同一会話で同じファイルを更新する規律。`context-map-guide.md` L22)に要る。`Bash` は読み取り目的の確認(`git log`・`wc -c`)に使う。`Skill` は設計時の Context7 参照など、依頼文で指定されたスキルのロードに要る。`Agent` は `tools` に書かない。`compose.ts` L44-45 が `allowsAgentTool` の結果で付けるためである(両帯は `SOLO_DENIED_ROLES` に入らないので付く)。

### 4.2 担当表正本(`src/agents/policies.ts`)

`ASSIGNMENTS["claude-model-policy"]` へ 2 行、`RECOMMENDED` へ 2 行を追加する。キーの並びは `ROLES` の並びに合わせ、`general` と `explore` の間へ入れる。

```ts
// ASSIGNMENTS["claude-model-policy"]
"design-plan": ["opus"],
"explore-lead": ["opus"],

// RECOMMENDED
"design-plan": ["opus"],
"explore-lead": ["opus"],
```

根拠: `ASSIGNMENTS` は担当表(`Opus`)と一致させる契約であり、`policy-skill-assignments.test.ts` がこれを固定する。`RECOMMENDED` はユーザー決定 11 により `["opus"]` のみとする。custom-policy の担当表の 2 行(現行 L19-20)も `Opus` のまま変更しない。推奨は参考であり拘束しない(`skills/custom-policy/SKILL.md` L14)。

`allowsAgentTool` / `AGENT_DENIED_MODELS` / `SOLO_DENIED_ROLES` は変更しない。

### 4.3 両 SKILL.md の担当表

担当表の表本体は 2 行のモデル欄を両プロファイルとも `Opus` のまま維持し、宣言文は置かない。全帯がサブエージェントの役割であるという宣言は §4.5 の共通規律 1 箇所に置く。両 SKILL.md は L10 で「`../../references/orchestration-discipline.md` を併せて読み、これに従う」としており、規律側の宣言が担当表にかかる。

`custom-policy` L14 の既存段落(「担当表が持つのは役割の帯だけである。…」)は変更しない。

### 4.4 custom-policy L36 の削除

変更前(L35-37):

```markdown
- モデルと役割の組合せを制約しない。推奨から外れる構成も有効である。
- 「設計書・実装計画書(WBS)の作成」「コードベース探索統括」はオーケストレーター自身が担う。サブエージェントへ委譲しない。
- `orchestration-discipline` の「軽量な実装」…の 6 帯として扱う定義には Agent Tool を許可しない。
```

変更後(L36 を削除):

```markdown
- モデルと役割の組合せを制約しない。推奨から外れる構成も有効である。
- `orchestration-discipline` の「軽量な実装」…の 6 帯として扱う定義には Agent Tool を許可しない。
```

`claude-model-policy` 側には同種の箇条が無い(L33-37 は Agent Tool 非許可 6 帯と読み取り限定条項だけ)。したがって削除は custom-policy の 1 行のみである。

### 4.5 共通規律 §冒頭の定義文

変更前(`references/orchestration-discipline.md` L5):

```markdown
以下で「担当表」とは、読み込んだ方針の §モデル別役割 の表を指す。帯の名前は担当表の行名で参照する。
```

変更後:

```markdown
以下で「担当表」とは、読み込んだ方針の §モデル別役割(または §役割の帯と推奨モデル)の表を指す。帯の名前は担当表の行名で参照する。

担当表の全帯はサブエージェントの役割である。オーケストレーターはどの帯も自ら担わず、dispatch・要件確定・採否判断・承認・分析だけを行う。
```

節名の併記は、`custom-policy` の見出しが「役割の帯と推奨モデル」であり現行の定義文が指せていない不整合の同時解消である(§8-1)。宣言はこの 1 箇所にだけ置き、両 SKILL.md には重複させない(ユーザー決定 4)。

実装時の補正(T5): L5 の第 2 段落と §4.6 新節の第 1 段落は同じ趣旨であるため、指示書の重複禁止に従い L5 側には置かず、§4.6 の新節だけに置いた。L5 の変更は節名の併記のみである。

### 4.6 共通規律 §オーケストレーターが自ら担う作業(新設)

`## モデル別役割の運用` の直前に新しい節を置く。L14 の既存条項(全レポートを分割せず一度に読む)は、この節へ移してユーザー決定 9 のとおり維持する。

```markdown
## オーケストレーターが自ら担う作業

オーケストレーターが担うのは dispatch・要件確定・採否判断・承認・分析である。担当表の帯はすべてサブエージェントの役割であり、オーケストレーターはそのどれも自ら実行しない。

分析は次の 3 つを含む。実働(読む・探す・再現する)は帯へ委譲してよいが、結論と判断はオーケストレーターが出す。分析全体を 1 つの帯へ渡して結論まで受け取ることはしない。

- 報告の突き合わせ・判断。複数の context-map・設計書・レビュー・実装差分・並列サブエージェントの全レポートを分割せず一度に読んで突き合わせ、採否と要件を決める。要約の要約では判断しない。
- 要件分析。ユーザーの要望を要件と受け入れ基準へ落とす。
- 原因分析・調査。バグの原因究明・現状把握など「調べて結論を出す」作業。grep/read の反復や再現の実働は「コードベース探索実働」などの帯へ委譲してよいが、結論はオーケストレーターが出す。「その他のタスク」の帯へ丸投げしない。
```

L14 は元の位置から削除する(内容は上の第 1 項に吸収)。L15-23 の他の条項は動かさない。

### 4.7 共通規律 §合成の対象(L46)

変更前:

```markdown
合成の対象とする帯は、「複雑または重要な実装」「通常の実装」「軽量な実装」「行き詰まり時のエスカレーション」「コードベース探索実働」「リアルタイム情報調査」「E2E 動作検証・ブラウザ/GUI 操作」「設計書・実装計画書の独立レビュー」「設計書・実装計画書のレビュー」「コードレビュー」「重要な実装の最終レビュー」「設計書の最終ゲートレビュー」「設計・計画・実装のアドバイザー」の 13 帯とする。「その他のタスク」と、担当表に帯を持たない作業(設計書・実装計画書の作成、コードベース探索統括)は合成しない。
```

変更後:

```markdown
合成の対象とする帯は、「複雑または重要な実装」「通常の実装」「軽量な実装」「行き詰まり時のエスカレーション」「設計書・実装計画書(WBS)の作成」「コードベース探索統括」「コードベース探索実働」「リアルタイム情報調査」「E2E 動作検証・ブラウザ/GUI 操作」「設計書・実装計画書の独立レビュー」「設計書・実装計画書のレビュー」「コードレビュー」「重要な実装の最終レビュー」「設計書の最終ゲートレビュー」「設計・計画・実装のアドバイザー」の 15 帯とする。「その他のタスク」は合成しない。
```

除外は「その他のタスク」だけになる。列挙の並びは担当表の並びに合わせ、新 2 帯を「行き詰まり時のエスカレーション」の後に置く。

### 4.8 共通規律 §コードベース探索(L85-86)

変更前:

```markdown
- コードベース探索は担当表の「コードベース探索統括」の帯が統括する。grep/read の反復など短命な探索実働は、担当表の「コードベース探索実働」の帯へバッチ委譲する。
- context-map の執筆・§未解決事項の判断・要件確定への接続は、担当表の「コードベース探索統括」の帯が行う。
```

変更後:

```markdown
- コードベース探索は担当表の「コードベース探索統括」の帯へ委譲する。grep/read の反復など短命な探索実働は、統括の帯が「コードベース探索実働」の帯へバッチで再委譲する。
- context-map の執筆は「コードベース探索統括」の帯が行う。
- context-map の §未解決事項の判断と、そこから要件を確定させる接続は、オーケストレーターが行う。統括の帯は §未解決事項を報告に載せるところまでを担う。
```

これで統括帯は Agent Tool 許可側であることと整合する(統括帯自身が探索実働へ再委譲する)。L84・L87 は変更しない。

### 4.9 共通規律 §設計・実装計画の規律(L96-99)

変更前:

```markdown
- コードベース探索を伴う設計・実装は、context-map の作成後に着手する。
- 出力した設計書・実装計画書は、まず担当表の「設計書・実装計画書のレビュー」の帯にレビュー(理解+暗黙知・矛盾抽出)させ、オーケストレーターが補足修正を加える。
- 補足修正を終えた設計書・実装計画書は、ユーザーへ提示して承認を得る。
- オーケストレーターの Approve(計画が全体要件を満たすことの確認)はユーザー承認の後に置く。Approve を経てから実装へ移行する。
```

変更後:

```markdown
- コードベース探索を伴う設計・実装は、context-map の作成後に着手する。
- 設計書・実装計画書の執筆は、担当表の「設計書・実装計画書(WBS)の作成」の帯へ委譲する。オーケストレーターは確定した要件・受け入れ基準・context-map の所在を依頼文で渡し、自ら執筆しない。
- 出力された設計書・実装計画書は、まず担当表の「設計書・実装計画書のレビュー」の帯にレビュー(理解+暗黙知・矛盾抽出)させる。
- 続いて担当表の「設計書・実装計画書の独立レビュー」の帯へ、原本のみを渡して dispatch する。他のレビューの指摘は渡さない。この帯の解決は方針の「独立レビューの手順」に従う(対応表に無いときは省略する)。
- オーケストレーターが両レビューの指摘の採否を判断し、補足修正を加えてからユーザーへ提示して承認を得る。
- オーケストレーターの Approve(計画が全体要件を満たすことの確認)はユーザー承認の後に置く。Approve を経てから実装へ移行する。
```

両方針スキルの「独立レビューの手順」節(claude L39-46 / custom L64-73)は既に同じ順序を書いており、変更しない。規律側は「執筆も委譲する」ことと、規律だけを読む経路でも独立レビューの段が見えることを補う。

### 4.10 `references/context-map-guide.md`

L37(消費側の読む深さ・オーケストレーター行)は**維持する**(ユーザー決定 7)。

変更 1 — L12 用語表:

| | 変更前 | 変更後 |
| --- | --- | --- |
| L12 | `| オーケストレーター | セッションを主導し、dispatch・要件確定・承認・最終レビューを行う役割 |` | `| オーケストレーター | セッションを主導し、dispatch・要件確定・採否判断・承認・分析・最終レビューを行う役割。担当表のどの帯も自ら担わない |` |

変更 2 — L40(消費側の読む深さ・map 作成者行):

| | 変更前 | 変更後 |
| --- | --- | --- |
| L40 | `| map 作成者 | 自己共有は不要。作成者 ≠ 下流設計者になった場合だけ、次の dispatch にパスを渡す |` | `| map 作成者(コードベース探索統括の帯) | 自己共有は不要。作成者と下流の設計担当は別のサブエージェントになるため、報告に map のパスを必ず載せる |` |

根拠: 統括帯がサブエージェントになったことで、作成者と下流設計者が同一になる経路は無くなる。L87 の「所在は次の dispatch または上流報告で必ず通知する」と一致させる。

L81(「作成者」欄は map を実際に作ったモデル名を記入する)は変更しない。

### 4.11 `assets/context-map-template.md` L4

| | 文言 |
| --- | --- |
| 変更前 | `**作成者**: Opus(探索統括)` |
| 変更後 | `**作成者**: [map を作成したモデル名](コードベース探索統括の帯)` |

根拠: モデル名の固定を外す。`context-map-guide.md` L81 は「実際に作ったモデル名を記入する」と指示しており、テンプレートは記入欄であるべきである。帯名は「探索統括」から担当表の行名「コードベース探索統括」へ揃える。テンプレートの他の行(L1-6 の記入欄形式)は変更しない。

### 4.12 断片 2 本 × 2 言語

`assets/roles/ja/design-plan.md`、`assets/roles/en/design-plan.md`、`assets/roles/ja/explore-lead.md`、`assets/roles/en/explore-lead.md` を追加する。frontmatter は `id` / `label` / `description` / `default-name` / `tools` / `kind`、本文は既存断片と同じ節構成(ja: When to invoke / Core Responsibilities / 作業手順 / 制約 / Output Format、en: When to invoke / Core Responsibilities / Procedure / Constraints / Output Format)とする。`label` / `tools` / `kind` は `ROLES` と一字一句一致させる(`compose.test.ts` L321-330 が固定する)。本文に他定義の固有名(GPT Sol 等)を書かない(同 L332-354)。

#### `assets/roles/ja/design-plan.md`

```markdown
---
id: design-plan
label: 設計書・実装計画書(WBS)の作成
description: 確定済みの要件と context-map を入力に、設計書と実装計画書(WBS)を執筆する
default-name: design-writer
tools: Read, Grep, Glob, Write, Edit, Bash, Skill
kind: impl
---

## When to invoke

- **設計書・実装計画書の作成。** 要件と受け入れ基準が確定した後、設計書または実装計画書(WBS)を文書として起こすとき。

## Core Responsibilities

- 渡された要件・受け入れ基準・context-map から、実装者がそのまま着手できる設計書・実装計画書を執筆する。

## 作業手順

- context-map を渡されたときはそれを出発点にし、記載と実際のコードに食い違いがあれば報告する。
- 変更対象のファイルは実際に読み、現在の文言・シグネチャ・行番号を確認してから設計に書く。推測で埋めない。
- 設計書は `harness-docs/design/YYYY-MM-DD-<スラッグ>.md`、実装計画書は `harness-docs/plans/YYYY-MM-DD-<スラッグ>.md` へ書く。既存の設計書がある領域では、その章立てに倣う。
- 影響ファイル・テスト方針・リスク・不採用案・Done 条件を必ず節として持たせる。
- 決められない事項は推測で埋めず、「未解決事項」の節に列挙する。

## 制約

- **設計書・実装計画書の作成として依頼されたときは**、設計対象の実装に手を付けず、設計書・実装計画書のファイルだけを作る。
- 要件の追加・変更・スコープの拡大は自分で決めず、オーケストレーターへ差し戻す。
- 採否の判断・ユーザーへの提示はオーケストレーターに委ね、自分は求めない。

## Output Format

- 結論(書いた設計書・実装計画書のパス)を冒頭に一文で
- 章ごとの要旨
- 未解決事項の一覧
- 参照した既存ファイルのパスと行番号
```

#### `assets/roles/ja/explore-lead.md`

```markdown
---
id: explore-lead
label: コードベース探索統括
description: コードベース探索を統括し、探索結果を context-map へ蒸留する
default-name: explore-lead
tools: Read, Grep, Glob, Write, Edit, Bash, Skill
kind: impl
---

## When to invoke

- **探索統括。** コードベース探索を伴うタスクの着手前に、探索の範囲を分割し、結果を context-map へまとめるとき。

## Core Responsibilities

- 探索の範囲を分割して実働へ委譲し、集まった結果を蒸留して context-map を執筆する。

## 作業手順

- 着手前に、依頼文で指定された context-map 作成ガイドとテンプレートを読み、その規律に従う。指定が無いときはオーケストレーターへ所在を問い合わせる。
- 短命な探索実働(grep/read の反復)は、独立した範囲ごとに 1 メッセージ内で並列に再委譲する。委譲先には「ファイルを変更しない」「報告のみを返す」を明記する。
- 集まった報告をダンプせず、判断に要る最小限へ蒸留して context-map に落とす。map が大きくなったら、共有先を減らす前に再蒸留する。
- 未解決のまま残った論点は、判断を自分で下さず §未解決事項へ列挙する。

## 制約

- **探索統括として依頼されたときは**、成果物として書くのは context-map だけとし、設計書・実装コードは書かない。
- §未解決事項の判断と、そこから要件を確定させる接続はオーケストレーターの役割である。自分は論点を挙げるところまでを担う。
- context-map に API キー・トークン・パスワードなどの機密情報を記録しない。

## Output Format

- 結論(作成した context-map のパス)を冒頭に一文で
- §未解決事項の一覧(前回からの差分があれば差分)
- 走査した範囲と、範囲外で気づいた事項
```

英語版は同じ節構成・同じ内容を英語で書き、`label` / `description` は英訳する(`label`: `Codebase Exploration Lead` / `Design and Implementation Plan Authoring`)。`default-name` は言語をまたいで同一にする(既存断片も `explorer` / `lead-implementer` で共通)。

- **注意**: `label` は `ROLES` の値と一致することを `compose.test.ts` L321-330 が検査するが、その検査は ja ディレクトリに対してのみ行われる(`PLUGIN_ROLES` は `assets/roles/ja`)。en の `label` は英語表記でよい(既存の `explore.md` en が `Codebase Exploration` であることと同じ)。

### 4.13 `skills/setup-agents/SKILL.md` と README

| 対象 | 変更 |
| --- | --- |
| `skills/setup-agents/SKILL.md` L236 | MCP 既定の実装役割列挙へ `design-plan` / `explore-lead` を追加(`complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general` / `design-plan` / `explore-lead`)。この列挙は TypeScript にハードコードされておらず対話手順の散文だけで完結しているため、コード変更は不要で散文を追随させる。同じ節に「`--list-coverage` の `mixedKinds` が真のとき、読み取り帯と実装帯が同居していることを知らせ、定義の分離を提案する」手順を足す(§4.1 の副作用対処) |
| `README.md` L103 | 同じ列挙の追随 |
| `README.md` L109 | 「14 種」→「16 種」 |
| `README.md` L111-127 の表 | `general` の行の後に `| design-plan | 設計書・実装計画書(WBS)の作成 |` と `| explore-lead | コードベース探索統括 |` を挿入(`ROLES` の並びと一致させる) |
| `README.md` §旧バージョンからの移行 | 「0.15 系から 0.16 系へ移行する場合」の節を新設し、次を書く。(1) 役割 ID が 14 → 16 になった。(2)「設計書・実装計画書(WBS)の作成」「コードベース探索統括」は、これまでオーケストレーター自身が担う想定だったが、Opus サブエージェントの帯になった。(3) 既存の生成済み定義はそのまま動く(マーカーは追加されない)。この 2 帯へ委譲したい場合は `agent-policy:setup-agents` を再実行して未カバーの役割だけを作る。(4) 担当表の全帯がサブエージェントの役割であることが明文化された |
| ルート `README.md` L111 | 「14 の役割帯と GPT Astra を含む 9 つの推奨モデル ID」→「16 の役割帯と…」 |
| `.claude-plugin/marketplace.json` の description | 役割数・役割 ID を書いていない(L41 で確認済み)。変更不要 |

## 5. 影響ファイル

新規:

- `plugins/agent-policy/assets/roles/ja/design-plan.md`
- `plugins/agent-policy/assets/roles/ja/explore-lead.md`
- `plugins/agent-policy/assets/roles/en/design-plan.md`
- `plugins/agent-policy/assets/roles/en/explore-lead.md`

変更(コード):

- `plugins/agent-policy/src/agents/roles.ts`(`RoleId` 2 種・`ROLES` 2 要素)
- `plugins/agent-policy/src/agents/policies.ts`(`ASSIGNMENTS` / `RECOMMENDED` 各 2 行)
- `plugins/agent-policy/scripts/*`(`pnpm run build` による再生成。手で書かない)

変更(文書):

- `plugins/agent-policy/skills/claude-model-policy/SKILL.md`(§8-4 の整形のみ)
- `plugins/agent-policy/skills/custom-policy/SKILL.md`(§4.4)
- `plugins/agent-policy/skills/setup-agents/SKILL.md`(§4.13)
- `plugins/agent-policy/references/orchestration-discipline.md`(§4.5-4.9)
- `plugins/agent-policy/references/context-map-guide.md`(§4.10)
- `plugins/agent-policy/assets/context-map-template.md`(§4.11)
- `plugins/agent-policy/README.md`(§4.13)
- ルート `README.md`(§4.13)
- `plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json`(`0.15.0-dev` → `0.16.0-dev`)

変更(テスト): §6。

削除: なし。

## 6. テスト方針

Grep で確認した、実際に落ちる/追随を要するテストは次のとおり。

| ファイル | 行 | 追随内容 |
| --- | --- | --- |
| `src/agents/__test__/roles.test.ts` | L11 / L12-27 / L28 | テスト名「14 件」→「16 件」、期待配列へ `design-plan` / `explore-lead` を `general` と `explore` の間へ挿入、`size` を 16 へ |
| 同 | L108-113 | `roleOrder("complex-impl") === 0` と `roleOrder("advisor") === ROLES.length - 1` は並び位置の決定(§4.1)により変更不要。回帰確認として残す |
| 同 | L31-(追加 4 役割の固定値検査) | 新 2 役割の `label` / `kind` / `tools` を固定する検査を追加する(既存の 4 役割検査と同じ形) |
| `src/agents/__test__/policies.test.ts` | L16-31(`EXPECTED_CLAUDE_ASSIGNMENTS`)/ L33-(`EXPECTED_RECOMMENDED`)/ L50-65(`EXPECTED_AGENT_TOOL`) | 3 つとも `Record<RoleId, …>` の網羅型であり、`RoleId` 追加の時点で型エラーになる。各 2 行追加(`design-plan` / `explore-lead`。`ASSIGNMENTS` は `["opus"]`、`RECOMMENDED` は `["opus"]`、`AGENT_TOOL` は `true`) |
| 同 | L91 / L188 | テスト名「全 14 役割」→「全 16 役割」。`ALL_ROLE_IDS`(L71)は `ROLES` から導出しているため値の追随は不要 |
| 同 | L103-105 | `RECOMMENDED` の網羅・固定値の期待更新 |
| `src/agents/__test__/policy-skill-assignments.test.ts` | L151 | テスト名「全 14 役割」→「全 16 役割」。パーサ本体は変更不要 |
| `src/agents/__test__/compose.test.ts` | L294-331 | 断片と `ROLES` の整合性(ファイル名・id・label・tools・kind)。新断片 4 本の追加で自動的に対象になる。ja に断片が無いと落ちるため、断片追加が前提 |
| 同 | L121(マーカーを `ROLES` の定義順で並べる) | 新 ID を含むケースの追加は任意。並び位置の回帰を守るため 1 ケース追加する |
| `src/__test__/setup-agents.test.ts` | L359 / L418 | `--list-coverage` の `roles` が `toHaveLength(14)` → `16` |
| `src/hooks/__test__/marker-scan.test.ts` | L302 ほか | `roleLabel` は `roleById` 経由で自動追随。`design-plan` / `explore-lead` の表示名解決を 1 ケース追加する(任意) |
| `src/hooks/__test__/session-start.test.ts` | L530 | 「マーカーの行を `ROLES` 順に並べる」。新 ID を含む並び順のケースを 1 件足す(任意)。役割数のリテラルは無いため必須の追随は無い |

- `src/agents/__test__/fragments.test.ts` L57 の `expect(fragments.size).toBe(14)` は `assets/roles/ja` の断片数を固定している。断片 2 本の追加で 16 になるため、`toBe(16)` へ追随する(独立レビューで検出。当初「リテラルを持たない」と書いたのは誤り)。
- `src/hooks/__test__/{delegation-gate,parallel-nudge}.test.ts` と `src/agents/__test__/{live-models,mcp,vocabulary}.test.ts` は役割集合に依存しない。追随不要。
- 文書検証は `policy-skill-assignments.test.ts` が担う。両 SKILL の表の新 2 行(いずれも `Opus`)と正本の一致がここで固定される。パーサは行の 1 列目を `startsWith(label)` で照合する(L67-70)。新 label「設計書・実装計画書(WBS)の作成」「コードベース探索統括」は、既存 label(「設計書・実装計画書のレビュー」「設計書・実装計画書の独立レビュー」「コードベース探索実働」)のいずれとも前方一致で衝突しないことを確認済み。逆方向(既存行が新 label に前方一致する)も起きない。
- 実装は既存規律のとおりテスト先行で行う。

## 7. リスクと不採用案

### リスク

| リスク | 受容の理由と対処 |
| --- | --- |
| 既存の生成済み定義には新 2 帯のマーカーが無く、対応表に載らない。custom プロファイルでは「対応表に無い帯」となり、`claude-model-policy` の同帯(`Opus`)へ読み替えられて `general-purpose` へ委譲される | 実行帯の解決順(custom-policy L46)がそのまま働くため壊れない。委譲先を明示したい利用者には setup の再実行を README の移行節で案内する |
| 上流 2 帯を委譲に変えると、context-map と設計書の執筆が別プロセスになり、オーケストレーターが持つ文脈の一部が依頼文へ転記されないまま失われうる | 依頼文に要件・受け入れ基準・context-map の所在を渡す規律を §4.9 と断片の作業手順に明記した。文脈が足りないときは差し戻すことも断片の制約に書いた |
| 委譲の段が 1 つ増え、上流のトークン消費とレイテンシが増える | 上流 2 帯は Opus 推奨であり単価は高いが、オーケストレーターの文脈へ探索の生データを持ち込まない分、セッション全体では相殺されうる。効果は未実測であり、運用で観測する(§8-4) |
| `explore-lead` と `explore` を 1 定義に同居させても、`mixedKinds` は JSON 出力のフラグに留まり対話フローに現れない | §4.1 のとおり `setup-agents/SKILL.md` に提示文言を足し、分離を提案する経路を作る。生成は止めない |
| `kind: impl` により、setup の MCP 既定でこの 2 帯を持つ定義へ全 MCP サーバーが付く | 両帯の実務(Serena での探索統括、Context7 での設計)に合う。付けたくない場合は setup の「定義ごとに調整する」で外せる |
| 規律の改訂が広く、`orchestration-discipline.md` を読む全プラグイン利用者のセッション挙動が変わる | 変更は帯の追加と役割分担の明文化であり、既存の判定フロー(§委譲先の実行モデルの確定 の 8 行の表)は行 5「作業種別が合成対象の帯に合致しない」の対象集合が広がるだけである |
| 新 2 帯の `tools` は無制限の `Write` / `Edit` を持ち、「設計書・context-map だけを書く」制約は断片本文の宣言のみで強制されない | 既存の `light-impl` 等と同型の設計であり、tools 権限でパスを絞る機構が無い。断片の制約節と Output Format で成果物パスを固定し、逸脱は報告で検出する |
| `policy-skill-assignments.test.ts` の前方一致パーサが、新 label の追加で誤マッチする | 双方向で衝突しないことを確認済み(§6)。テストは複数一致時に例外を投げるため、誤マッチは沈黙せず失敗として出る |

### 不採用案

- **第 3 の `RoleKind`(例 `authoring`)を足す** — `roles.ts` L130-133、`compose.ts` L113-130、`fragments.ts` L83、`RolesSummary` の型、setup の MCP 既定、README・SKILL の散文へ波及する。得られる区別を要求している判断分岐が現時点で 1 つも無いため、費用が便益を上回る。将来「文書だけ書く帯には MCP を付けない」等の要求が出たときに再検討する。
- **新 2 帯を `kind: readonly` にする** — 両帯は成果物ファイルを書く。`tools` に `Write` を持つ readonly 帯は、setup の読み取り専用定義向け `disallowedTools` 提案と矛盾する。
- **RoleId を `design-doc` / `wbs` / `explore-orchestrator` にする** — `design-doc` は実装計画書を落とす。`wbs` は略語 1 語で既存の 2 語ケバブの流儀から外れ、設計書を含まない。`explore-orchestrator` はオーケストレーターの語と衝突し、「この帯はサブエージェントである」という本改修の主眼を濁す。
- **`ROLES` の先頭または末尾へ追加する** — 先頭は `roleOrder("complex-impl") === 0`、末尾は `roleOrder("advisor") === ROLES.length - 1` を壊す。加えて impl / readonly のブロックが分断される。
- **対象 2 帯の行にだけ「サブエージェントへ委譲する」と注記する** — ユーザー決定 2 で却下済み。他の帯がオーケストレーター担当であるかのように読めるため、宣言は表全体にかける。
- **両 SKILL.md の担当表の直前にも同じ宣言を置く** — 同じ規律を複数の指示書に書くことになり、指示書の規律(重複禁止)に反する。両 SKILL.md は共通規律を必読としており、規律だけを読む経路も規律側の 1 箇所で足りる(ユーザー決定 4)。
- **`SOLO_DENIED_ROLES` へ新 2 帯を入れる** — 統括帯は探索実働へ再委譲し、設計帯はアドバイザーへ相談する必要がある。Agent Tool 非許可 6 帯は現状維持(ユーザー決定 6)。
- **`context-map-guide.md` L37 の「オーケストレーター = 圧縮された map を読む側」を書き換える** — ユーザー決定 7 で維持。統括帯が map を書き、オーケストレーターが読むという分担はこの行と矛盾しない。

## 8. 未解決事項

1. **`orchestration-discipline.md` L5 の節名参照。** 現行は「§モデル別役割 の表」と書くが、`custom-policy` の見出しは「役割の帯と推奨モデル」であり指せていない。§4.5 で併記する案を出したが、これは本改修の合意事項に含まれない先行不整合の修正である。**決定: 併記する。** 本改修が同じ行を書き換えるため同時に直す。
2. **`assets/roles/en/` の `label` 検査。** `compose.test.ts` の断片整合性検査は ja ディレクトリのみを対象とする(`PLUGIN_ROLES` = `assets/roles/ja`)。en 断片の `label` / `tools` / `kind` を固定する検査は存在しない。今回 en 断片を 2 本足すにあたり、en 側の整合性検査を追加するかは決めていない。既存 14 本も同じ状態である。**決定: 本改修に含める。** `compose.test.ts` の整合性検査を `assets/roles/en` にも回し、`label` の言語差だけを除いた `id` / `default-name` / `tools` / `kind` の一致を検査する。en の `default-name` 書き忘れが検出されない穴(独立レビュー指摘)を同時に塞ぐ。
3. **上流 2 帯を委譲に変えたときのトークン・レイテンシの実測値。** 未計測である。運用後に観測し、`references/orchestration-discipline.md` のコスト規律へ追記するかを別途判断する。
4. **`skills/claude-model-policy/SKILL.md` の「実行帯の解決順」節が L54-55 で終わっており、番号付きリストが「1.」の 1 項目だけである。** claude プロファイルには Claude 帯しか無いため実害は無いが、番号付けが不自然である。**決定: 番号を外す整形を含める。** 同じ節を書き換えるため。
5. **`.serena/memories/agent_policy/core.md` の更新項目。** 実際に食い違うのは次の記述である。実装完了後にこれらを更新する。
   - 冒頭の `plugins/agent-policy (0.14.0-dev, ...)` — 現行は既に `0.15.0-dev` であり、本改修で `0.16.0-dev` になる。以前から追随漏れがある。
   - 見出し「### Role fragments and the 10 role IDs」— 実体は 14 種であり既に古い。本改修で 16 種になる。
   - 「## The two policy skills — role tables」節の `RECOMMENDED` の値の列挙 — `design-plan` / `explore-lead` の追加を反映する必要がある。また現在の列挙は `normal-impl/general→GPT Terra` と書くが、実体(`policies.ts` L149・L152)は `normal-impl: ["sonnet","gpt-luna","grok"]` / `general: ["sonnet","gpt-luna"]` であり既に食い違っている。
   - 「Custom's execution-tier resolution」の記述に、担当表の全帯がサブエージェントの役割であるという宣言と、オーケストレーターの担当(dispatch / 要件確定 / 採否判断 / 承認 / 分析)を足す。
   - 設計書の一覧へ本設計書を追加する。
   - なお `agent_policy` メモリは `core.md` 1 本だけである(`.serena/memories/agent_policy.md` というファイルは存在しない)。更新は `core.md` に対して行う。
6. **`harness-docs/ARCHITECTURE.md` への影響。** grep した限り、ARCHITECTURE 内で `agent-policy` を名指しするのは L125 の ADR-001(MCP ツールの許可はサーバー単位、禁止はツール単位)だけであり、役割 ID の一覧・フック構成・帯の定義は載っていない。したがって**本改修は ARCHITECTURE に影響しないと判断する**。ただしドメインマップの glob(`plugins/agent-policy/**` 相当)が新規ファイルを取りこぼさないかは実装時に確認する。取りこぼしがあれば `/metatron:update` で追随する。

## 9. 実施手順と Done 条件

1. 本設計書を「設計書・実装計画書のレビュー」帯(Haiku)へレビューさせ、続いて「設計書・実装計画書の独立レビュー」帯へ原本のみを渡して dispatch する。オーケストレーターが採否を判断して補足修正し、ユーザーへ提示して承認を得る。
2. 承認後、本設計書を入力に実装計画書(WBS)を別途起こす。本設計書には含めない。
3. 着手時に最新の `git status` と HEAD で対象を再確認し、`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の baseline を記録する。無関係な未コミット変更を revert しない。
4. テスト先行で実装する。順序の目安は「roles.ts / policies.ts → 断片 4 本 → テスト追随 → 文書(SKILL 2 本・規律・guide・template)→ README 2 本 → バージョン → build」。
5. AI が読む指示書の本文(`skills/*/SKILL.md`・`references/*.md`・`assets/roles/**/*.md`・`assets/context-map-template.md`)の作成と改修は、`prompt-smith:prompt-smith` スキルをロードした担当に行わせる。断片 4 本の新規作成も同スキルで行う。README・設計書・Serena メモリは対象外とする。
6. Done 条件:
   - `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
   - `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分が同じコミットにある。
   - `plugins/agent-policy/.claude-plugin/plugin.json` と `package.json` が揃って `0.16.0-dev`。
   - `README.md`(プラグイン・ルートの両方)の役割 ID 表が 16 種になり、移行節が追記されている。
   - `policy-skill-assignments.test.ts` が両 SKILL の担当表 16 行を正本と一致させて通る。
   - `.serena/memories/agent_policy/core.md` の食い違い(§8-6)が更新されている。
   - ARCHITECTURE への影響が無いことを確認した記録を残す(§8-7)。影響があれば `/metatron:update` で追随する。
