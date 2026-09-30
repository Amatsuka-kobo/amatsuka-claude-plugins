# agent-policy 委譲体系の再編 実装計画書

- 作成日: 2026-09-29
- 対象プラグイン: `plugins/agent-policy`
- バージョン: `0.20.1-dev` → `0.21.0-dev`
- 設計書(正本): `harness-docs/design/2026-09-29-agent-policy-delegation-effort-design.md`
- 承認: 要件はユーザー確定済み。設計書とこの計画書は 2026-09-29 にユーザーが承認した
- 版: 第 2 版(D8(全役割の Agent Tool 廃止)とレビュー指摘を反映)
- 計画立案時の HEAD: `9ea98e90`

この計画書はタスクの分割・順序・検証方法だけを定め、設計判断を上書きしない。設計書と実装の食い違いを見つけた担当は、実装を止めてオーケストレーターへ報告する。オーケストレーターは §7 に記録し、設計書の修正要否を判断する。

## 0. 触らないもの

- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md`。更新が要ると気付いたら、修正せず報告する。
- `.claude/rules/metatron/` の 3 ファイル。
- `plugins/*/scripts/` の手編集。`src/` を変え、`pnpm run build` で再生成する。
- `.raphael/`。
- `.serena/memories/` を Edit / Write で触ること。T12 でオーケストレーターが Serena のツールで行う。
- プラグイン README の古い移行節(0.19 → 0.20 以前)。履歴として残す。
- `src/hooks/subagent-start.ts`(設計書 D8-5)。
- 本改修と無関係な未コミット変更(`docs/chat/` など)。触らず、revert もしない。
- `.claude/agents/` のファイル削除。T13 でユーザーが行う。

## 1. 進め方の共通規律

- ブランチを切らない。作業はこの worktree(`agent-policy-overhaul` ブランチ)で行い、タスクごとにコミットする。
- 各タスクの中では、テストを先に直してから実装する。タスクの完了時点で `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通ることを完了条件にする。タスクの途中でテストが失敗するのは期待どおりである。
- `plugins/agent-policy/src/` を変えるタスクは、最後に `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分を同じコミットに含める。`assets/` と `references/` だけを変えるタスクでも build を実行し、`git status --short plugins/agent-policy/scripts` に差分が無いことを確かめる。
- `assets/**/*.md`・`references/**/*.md`・`skills/**/SKILL.md` を編集する担当には、編集の前に `prompt-smith:prompt-smith` を起動させる。適用する内容は設計書で確定済みのため、既存指示書の評価工程(評点表と承認)は省かせる。依頼文には変更の要点と判断の軸を渡し、完成文を載せない(規律 §文書の執筆を委譲するとき)。
- README・テストコード・`src/**/*.ts`・バージョンのタスクにはスキルをロードさせない。
- TypeScript と Markdown の編集は Serena の編集ツールで行わせる。テストは対象ソースと同じ階層の `__test__/` に置く。
- en 断片と en の `_common.md` に日本語と日本語約物を書かない。断片本文に `###` を使わない。依頼文にこの 2 点を明記する。
- 改名は `git mv` で行い、履歴を保つ。
- 担当の目安は設計書 §2.3 の 5 軸と §4.4 の決定 (a)(b) で決めた。各タスクの「担当」欄に当てた軸を書く。
- `light-impl` の tools は `Skill` を持たない。prompt-smith の起動が要るタスクは `light-impl` に振らない。
- 検証の grep は `grep -E` の拡張正規表現で書き、選択肢は `|` で区切る。表のセルには書かず、各タスクの表の下にコードブロックで置く。
- T1 の後、このリポジトリの `.claude/agents/` にある旧 ID のマーカーの定義(`complex-reviewer` / `system-planner` / 2 件の adviser)は対応表に出なくなり、SessionStart が廃止の通知を出す。実装中はこの通知を想定どおりのものとして扱う。T13 で再生成するまで、これらの定義を使うときは名指しで起動する。
- 規律の合計(`skills/custom-policy/SKILL.md` と `references/orchestration-discipline.md`)は 30,720B 以下に保つ。T5 で測り、超える見込みなら設計書 §4.9 の手順に従う。
- 設計判断・要件の追加・スコープの拡大は担当が決めず、オーケストレーターへ差し戻す。

## 2. タスク

### T0: baseline(オーケストレーター)

| 項目 | 内容 |
| --- | --- |
| 作業 | `git status --short` で本改修と無関係な未コミット変更を記録する。`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` を実行し、結果とテスト件数を記録する。build 後に `git status --short plugins/agent-policy/scripts` の差分が無いことを確かめる。`wc -c plugins/agent-policy/skills/custom-policy/SKILL.md plugins/agent-policy/references/orchestration-discipline.md` の合計を記録する(期待値 27,188B) |
| 検証 | 4 コマンドがすべて通る。通らないときは本改修に入らず報告する |
| コミット | なし |

### T1: D1 / D4 役割の再編・推奨と割当・廃止役割の通知

| 項目 | 内容 |
| --- | --- |
| 対象(実装) | `src/agents/roles.ts`、`src/agents/policies.ts`(`ASSIGNMENTS` / `RECOMMENDED`)、`src/hooks/session-start.ts`(設計書 §4.10) |
| 対象(断片) | `assets/roles/{ja,en}/design-plan.md` / `advisor.md` / `gate-review.md`(削除)、`final-review.md` → `complex-review.md`(`git mv` の後に `gate-review.md` の内容を統合)、`adversarial-review.md`(L14 の比較先) |
| 対象(規律) | `references/orchestration-discipline.md` の担当表(L6-23)の行だけ。列は T2 で減らす |
| 対象(テスト) | 設計書 §7.1 の全行と §7.5 |
| 要点 | 設計書 §5.1 / §5.2 / §5.6 / §5.10 と §5.7 の `adversarial-review.md` の行。`complex-review.md` は設計書 §4.1 の 2 つの表(節ごとの組み立て、旧項目の振り分け)に従って書く。担当表は 13 行にし、`complex-review` の Claude モデルを `Fable` にする。このタスクでは Agent Tool 列を残し、`complex-review` は「否」、他の行は現行の値のまま置く(列ごと T2 で消す)。担当表以外の規律の本文は T5 で直す |
| 担当 | 通常の実装。仕様確定度と検証の容易さ(期待値表とテストで判定できる)は `normal-impl` に当たる。設計新規性は、断片 2 本の統合の文面と通知の文だけにある。機械的な書き換えが大半だが、断片の統合に判断が要るため `light-impl` には振らない |
| スキル | `prompt-smith:prompt-smith`(断片と担当表の部分) |
| 検証 | lint / typecheck / test / build。下のコマンド |
| コミット | `feat(agent-policy): 役割を 13 種へ再編し complex-review を追加する` |

```bash
ls plugins/agent-policy/assets/roles/ja plugins/agent-policy/assets/roles/en   # complex-review.md があり、削除した 4 本が無い
node plugins/agent-policy/scripts/setup-agents.mjs --list-roles --lang ja --dir "$(mktemp -d)"   # 13 役割が設計書 §5.1 の順
```

依頼文に次を書く。

- §4 の契約(役割の並び、`ASSIGNMENTS` / `RECOMMENDED` の表、`complex-review` の frontmatter)を転記する。
- `SOLO_DENIED_ROLES` と `allowsAgentTool` はこのタスクでは残す。旧 4 役割を外し、`complex-review` を足すだけにする(削除は T2)。
- `_common.md`・`light-impl.md`・`general.md` の相談の記述は T2 で直す。このタスクでは触らない。
- `compose.test.ts:236-257` と `:577` の相談と Agent tool の検査は T2 で直す。このタスクでは、役割 ID の差し替えだけを行う。
- `compose.test.ts:222-234` の否定の検査に、`design-plan`・`final-review`・`gate-review` を足す。`advisor` と「アドバイザー」は `_common.md` に残っているため、T2 で足す。
- `setup-agents.test.ts:1922-1944` / `:1947-1961` / `:1967-1993` の 3 件は、`design-review` の先頭が gpt-sol に変わったため期待値が変わる。設計書 §7.1 の書き方で、各テストの意図(先頭が無ければ次の Claude enum / 照会失敗時は先頭 / vendor と color は ModelSpec 由来)を保つ組に直す。3 件目で sonnet が採られるときは vendor が claude、color が blue になる。
- `session-start.ts` の通知は、既存の `retiredBlock` の文の形に合わせる。既存の `RETIRED`(定義名)は変えない。

### T2: D2 / D8 相談と Agent Tool の撤去

| 項目 | 内容 |
| --- | --- |
| 対象(実装) | `src/agents/policies.ts`(`SOLO_DENIED_ROLES` / `allowsAgentTool` の削除)、`src/agents/vocabulary.ts`、`src/agents/compose.ts` |
| 対象(断片) | `assets/roles/{ja,en}/_common.md`、`light-impl.md`(L29 だけ)、`general.md`(L23 だけ) |
| 対象(規律) | `references/orchestration-discipline.md` の担当表の Agent Tool 列と L27 だけ |
| 対象(テスト) | 設計書 §7.2 と §7.4 の全行 |
| 要点 | 設計書 §4.2 / §5.4 / §5.5 と §5.7 の `_common.md`・`light-impl.md` L29・`general.md` L23 の行、§5.8 の担当表と L27 の行。`_common.md` は相談の節と `## Agent tool の制約` の節を削除する。旧 L13-17 の 5 項目は削除せず `## 制約` へ移し、L13-15 の 3 文は述語を「相談する」から「差し戻す」に書き換える |
| 担当 | 通常の実装。仕様は設計書で確定しており、削除と移動は既存パターン内の変更である。検証は `compose.test.ts` と `discipline-role-table.test.ts` で判定できる |
| スキル | `prompt-smith:prompt-smith`(断片と規律の部分) |
| 検証 | lint / typecheck / test / build。下のコマンド |
| コミット | `feat(agent-policy): サブエージェントの相談と Agent Tool を廃止し差し戻しに一本化する` |

```bash
# 結果がテストの否定の検査だけであること
grep -rn -E "アドバイザー|advisor|Consulting an advisor|Agent tool の制約|Agent tool limits|SOLO_DENIED_ROLES|allowsAgentTool|agentConstraintHeading" plugins/agent-policy/assets plugins/agent-policy/src
```

依頼文に次を書く。

- `light-impl.md` の When to invoke・description・`## 制約` の追加・Output Format は T4 で直す。このタスクでは L29 だけを触る。
- `_common.md` の残す見出し(`## Preamble` / `## 制約` / `## Constraints`)を変えない。見出しは `vocabulary.ts` と合成器が突き合わせる。
- `compose.ts` の `resolveToolsFor` は、断片の tools にある `Agent` を除く処理を残す。
- `compose.test.ts:222-234` の否定の検査に `advisor` と「アドバイザー」を足す。
- 担当表は Agent Tool 列を消して 4 列にする。行の値と桁揃えは変えない。

### T3: D5 effort の付与

| 項目 | 内容 |
| --- | --- |
| 対象(実装) | `src/agents/policies.ts`(`Effort` / 段の順序 / `EFFORT` / `effortFor`)、`src/agents/compose.ts`(`ComposeInput.effort` と frontmatter の出力)、`src/setup-agents.ts`(`composeInputFor`) |
| 対象(テスト) | 設計書 §7.3 の全行 |
| 要点 | 設計書 §4.5 / §5.3 / §5.4 / §5.5。`effort` は値があるときだけ `model` の直後に出す。複数役割は最も高い段を採る。組み込みに無い役割 ID は表に無い組として扱う。`merge` と `automaticKeep` は変えない(既存の仕組みで要件どおりになる) |
| 担当 | 通常の実装。値と規則は設計書で確定し、段の選択は表とテストで機械的に判定できる。frontmatter の出力は全利用者の生成物に効くが、テストで機械的に検証できるため役割を上げない(決定 (b)) |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。下のコマンド |
| コミット | `feat(agent-policy): 生成する定義に役割とモデルに応じた effort を付ける` |

```bash
tmp="$(mktemp -d)"
node plugins/agent-policy/scripts/setup-agents.mjs --write --model-id sonnet --name t --roles general,code-review --scope claude --lang ja --dir "$tmp"
grep -n -E "^(model|effort):" "$tmp/.claude/agents/t.md"   # model の次の行が effort: high
```

依頼文に、`ComposeInput` に `modelId` を足さないこと(設計書 §4.5)と、`--effort` フラグを足さないこと(設計書 §9)を書く。

### T4: D3 / D6 役割断片の書き換え

| 項目 | 内容 |
| --- | --- |
| 対象 | `assets/roles/{ja,en}/complex-impl.md` / `normal-impl.md` / `light-impl.md` / `escalation.md` / `realtime-research.md` / `design-review.md` |
| 要点 | 設計書 §5.7 の各行。4 実装断片は When to invoke と description を設計書 §2.3 の自分の役割の条件で書き直し、評価順は書かない。`escalation.md` L22 の入力の要求は残す。`normal-impl.md` と `light-impl.md` の Output Format に、変更した各箇所を判定した検査とその結果を足す。`light-impl.md` の `## 制約` に、委譲しない 3 つ(全セッションに作用する設定、プロジェクトの規約が直接編集を禁じるか変更の手順を定めるパス、データ移行)に当たる作業を引き受けず差し戻す旨を足す。パスの例にはバンドル出力と規約ファイルを挙げ、このリポジトリ固有の名前を書かない。`realtime-research.md` は並列クエリ・打ち切り・前置きと総評の省略を足す。`realtime-research.grok.md` は変えない。`design-review.md` は L21 の照合対象を絞り、前置きと総評の省略を足す |
| 担当 | 通常の実装。書く内容は設計書で確定しており、文面の判断だけが残る。検証は断片の合成検査と下の grep で行う |
| スキル | `prompt-smith:prompt-smith` |
| 検証 | lint / typecheck / test / build(`scripts/` に差分が出ない)。下のコマンド |
| コミット | `feat(agent-policy): 実装役割の条件を 5 軸で書き直し調査・設計レビューの出力を絞る` |

```bash
# 変更量の基準が残っていないこと(0 件)
grep -n -E "コンポーネント|公開インターフェース" plugins/agent-policy/assets/roles/ja/*-impl.md
grep -n -i -E "component|public interface" plugins/agent-policy/assets/roles/en/*-impl.md
```

### T5: 規律の本文(オーケストレーター)

| 項目 | 内容 |
| --- | --- |
| 対象 | `references/orchestration-discipline.md`(担当表と L27 以外) |
| 要点 | 設計書 §5.8 の担当表と L27 以外の全行。§4.2 の表(§サブエージェントの規律。L110-113 の再委譲の削除を含む)、§4.3(`AskUserQuestion`)、§4.4(5 軸・4 役割の条件・決定 (a)(b)・差し戻しの経路)、L98 の 1 文、L104 の転記義務の対象、L139 の順 3 の許可一覧への `effort` の追加(`disallowedTools` は足さない。設計書 §4.7)、§設計・実装計画の規律 の書き換え。決定 (a)(b) は §4 の契約の条件をすべて載せる |
| 担当 | オーケストレーター。規律はオーケストレーター自身の振る舞いを定め、文面の判断に要件の解釈が入る |
| スキル | `prompt-smith:prompt-smith` |
| 検証 | test(`discipline-role-table.test.ts` を含む)。下のコマンド。§サブエージェントの規律 の条項がすべて「サブエージェントは〜」で始まる |
| コミット | `feat(agent-policy): 規律を 5 軸の委譲基準と差し戻しの経路に書き換える` |

```bash
wc -c plugins/agent-policy/skills/custom-policy/SKILL.md plugins/agent-policy/references/orchestration-discipline.md   # 合計 30,720B 以下
# 0 件であること
grep -n -E "advisor|アドバイザー|設計書・実装計画書\(WBS\)|再委譲するとき|自ら執筆しない|コンポーネント|公開インターフェース" plugins/agent-policy/references/orchestration-discipline.md
# 1 件で、許可一覧に effort があり disallowedTools が無いこと
grep -n -E "以外のフィールドを持つ" plugins/agent-policy/references/orchestration-discipline.md
```

### T6: SKILL.md

| 項目 | 内容 |
| --- | --- |
| 対象 | `skills/setup-agents/SKILL.md` |
| 要点 | 設計書 §5.9。L215 の列挙を 5 件にし、ステップ 4 に effort の 1 文を足す。frontmatter は変えない |
| 担当 | 通常の実装。変更は小さく明確だが、prompt-smith の起動に `Skill` が要り、`light-impl` は `Skill` を持たない |
| スキル | `prompt-smith:prompt-smith` |
| 検証 | 下のコマンドが 0 件 |
| コミット | `docs(agent-policy): setup-agents の MCP 既定と effort の説明を更新する` |

```bash
grep -n -E "design-plan|advisor|agentTool" plugins/agent-policy/skills/setup-agents/SKILL.md
```

### T7: README

| 項目 | 内容 |
| --- | --- |
| 対象 | `plugins/agent-policy/README.md`、ルート `README.md` |
| 要点 | 設計書 §5.12 の全行。移行節「0.20 系から 0.21 系へ」は「0.19 系から 0.20 系へ」の直前に置く。ルート README は L102 と L106 だけを変える |
| 担当 | 通常の実装。書く項目は設計書で確定しており、文面の判断だけが残る |
| スキル | 不要(README は prompt-smith の対象外) |
| 検証 | プラグイン README の役割表が 13 行で `ROLES` の順と一致する。下のコマンドが 0 件 |
| コミット | `docs(agent-policy): README を 0.21 の役割構成と effort に追随させる` |

```bash
grep -n -E "アドバイザー運用|16種|16 種" README.md plugins/agent-policy/README.md
```

### T8: バージョン

| 項目 | 内容 |
| --- | --- |
| 対象 | `plugins/agent-policy/.claude-plugin/plugin.json`、`plugins/agent-policy/package.json`、`scripts/`(生成物) |
| 要点 | 両方の `version` を `0.21.0-dev` にする。`pnpm run build` を実行し、差分があれば同じコミットに含める |
| 担当 | 軽量な実装。変更内容が完全に指定され、2 ファイルの一致で機械的に検証できる |
| スキル | 不要 |
| 検証 | 2 ファイルの `version` が一致する。lint / typecheck / test が通る |
| コミット | `chore(agent-policy): 0.21.0-dev` |

### T9: 統合検証(オーケストレーター)

次を順に実行し、出力を記録する。

1. `pnpm run build` の後、`git status --short plugins/agent-policy/scripts` に差分が無い。
2. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test`。テスト件数の増減が本改修の追加・削除分だけである。
3. `wc -c plugins/agent-policy/skills/custom-policy/SKILL.md plugins/agent-policy/references/orchestration-discipline.md` の合計が 30,720B 以下。
4. 次の grep の結果が、テストの否定の検査と、README の移行節(旧 ID・旧挙動を説明する箇所)だけである。

   ```bash
   grep -rn -E "advisor|design-plan|final-review|gate-review|アドバイザー|SOLO_DENIED_ROLES|allowsAgentTool|コンポーネント|公開インターフェース|設計書・実装計画書\(WBS\)|自ら執筆しない" \
     plugins/agent-policy/src plugins/agent-policy/assets plugins/agent-policy/references plugins/agent-policy/skills \
     plugins/agent-policy/README.md README.md
   ```

5. `node plugins/agent-policy/scripts/setup-agents.mjs --list-roles --lang ja --dir "$PWD"` が 13 役割を設計書 §5.1 の順で返す。
6. `node plugins/agent-policy/scripts/setup-agents.mjs --write --recommended --scope claude --lang ja --dir "$(mktemp -d)"` で生成した 13 定義について、次を確かめる。
   - `effort` が設計書 §5.3 の claude 側の値と一致し、`model` の直後にある。`knowledge-elicitation` と `light-impl`(haiku)には `effort` が無い。
   - どの定義の tools にも `Agent` が無く、`## アドバイザーへの相談` と `## Agent tool の制約` の節が無い。
7. `--scope custom` でも 6 を実行し、照会が成功した環境で各役割に `RECOMMENDED` の先頭が採られ、`effort` が表の値である。先頭の既定エイリアスが実在しない役割は次の候補になり、その事実を記録する。

### T10: レビュー(並列、読み取りのみ)

| ID | 内容 | 担当 |
| --- | --- | --- |
| T10a | T1-T8 の全差分のコードレビュー。必ず見る点: (1) `SOLO_DENIED_ROLES` と `allowsAgentTool` が無く、どの定義にも `Agent` が出ない (2) 担当表が 4 列で、`discipline-role-table.test.ts` が 4 列を解析する (3) `vocabulary.ts` に `advisorHeading` と `agentConstraintHeading` が無く、`_common.md` の見出しが `vocabulary.ts` と一致する (4) `effortFor` が最も高い段を採り、組み込みに無い ID で例外を投げない (5) `effort` が `model` の直後で、値が無ければ行が無い (6) `ComposeInput` に `modelId` が無い (7) en 断片に日本語が無い (8) 断片に `###` が無い (9) `RECOMMENDED` / `ASSIGNMENTS` / `EFFORT` が設計書 §5.2 / §5.3 と一致する (10) SessionStart の廃止役割の通知が既存の `retiredBlock` の形に揃い、「未知の役割 ID」と二重に出ない (11) 規律 L139 の許可一覧に `effort` があり、`disallowedTools` が無い | コードレビュー |
| T10b | 重要な実装の最終レビュー。T10a と同じ差分を、設計書 §2 の要件と突き合わせて判定する | 重要な実装・高リスク設計書の最終レビュー(`complex-reviewer.md` を名指しで起動する。T13 の前はマーカーが旧 ID のため) |
| T10c | ARCHITECTURE への影響確認。削除・新規・改名したファイルがドメインマップの glob に収まり、ARCHITECTURE が役割 ID・effort・Agent Tool の可否を名指ししていないことを確かめる。取りこぼしは修正せず報告する | コードベース探索 |

依頼文に「ファイルを変更しない」「報告のみを返す」「使用してよい tools を読み取り系に限定する」を明記する。

### T11: 最終突き合わせ(オーケストレーター)

全差分を分割せず一度に読み、設計書 §5 と突き合わせる。特に次を確かめる。

1. 役割 13 種の並びが `roles.ts`・担当表・プラグイン README・`--list-roles` で同じ。
2. `complex-review` の label が `roles.ts`・ja 断片・担当表・README で揃っている。
3. 次の対応表の各行で、条件の数と内容が一致する。

   | 規律側 | 定義側 |
   | --- | --- |
   | §モデル別役割の運用 の `escalation` の条件 | `escalation.md`(ja / en)の When to invoke |
   | 同 `complex-impl` の条件 | `complex-impl.md`(ja / en)の When to invoke |
   | 同 `normal-impl` の条件 | `normal-impl.md`(ja / en)の When to invoke |
   | 同 `light-impl` の条件 | `light-impl.md`(ja / en)の When to invoke |
   | §サブエージェントの規律 の差し戻しの条件 | `_common.md`(ja / en)§制約 の差し戻しの条件 |
   | §モデル別役割の運用 の決定 (b)(完了報告の検査結果、light-impl へ委譲しない 3 つ) | `normal-impl.md` / `light-impl.md`(ja / en)の Output Format、`light-impl.md` の `## 制約` |

4. MCP 既定の列挙が SKILL.md と README で同じ 5 件。
5. 規律 §サブエージェントの規律 に advisor・Fable への相談と再委譲の条項が無く、残りの条項がすべて「サブエージェントは〜」で始まる。

食い違いは §7 に記録し、該当タスクをやり直す。

### T12: Serena メモリ(オーケストレーター)

| 項目 | 内容 |
| --- | --- |
| 対象 | `.serena/memories/agent_policy/core.md`、`.serena/memories/core.md` |
| 要点 | 設計書 §5.11。Serena の `edit_memory` / `write_memory` で行う。サブエージェントへ委譲しない |
| 検証 | 下のコマンドの結果が、廃止の経緯を書いた箇所だけ |
| コミット | `docs: Serena メモリを agent-policy 0.21 に追随させる` |

```bash
grep -n -E "advisor|design-plan|final-review|gate-review|SOLO_DENIED|Agent Tool" .serena/memories/agent_policy/core.md .serena/memories/core.md
```

### T13: このリポジトリの `.claude/agents/` の再生成(オーケストレーター)

設計書 §5.14 の表のとおり処置する。個別経路(`--model-id … --name … --roles …`)で生成し、`--merge` を使わない。

1. `.claude/agents/` を別ディレクトリ(例: `/tmp/agents-backup-2026-09-29/`)へ複製する。
2. 残す 12 定義の `agent-policy-role`・`model`・`tools` の MCP・`disallowedTools` を一覧にする。`disallowedTools` を持つのは `adversarial-reviewer` / `code-reviewer` / `complex-reviewer` / `docs-reviewer` / `general-explore` / `realtime-researcher` の 6 定義である(削除する adviser 2 定義を除く)。
3. 各定義について、手順 4 と同じ引数で `--check` を実行し、応答の `mcpCurrent.servers` と `mcpCurrent.denyTools` を控える。次のどちらかに当たる定義は生成を止め、報告する。
   - `body.sectionsOnlyInExisting` に `## アドバイザーへの相談` と `## Agent tool の制約` 以外の節がある。
   - `frontmatter.keysOnlyInExisting` に `disallowedTools` 以外のキーがある。
4. `claude mcp list` を実行し、控えたサーバーがすべて Connected または cached であることを確かめる。そうでないサーバーがある定義は生成しない。
5. 控えた値を引数へ変換して生成する。変換の例を示す(値は実際の `--check` の応答に置き換える)。

   ```text
   応答: "mcpCurrent": { "servers": ["plugin_context7_context7", "serena"],
                         "denyTools": ["mcp__serena__delete_memory", "mcp__serena__write_memory"] }
   引数: --mcp-servers plugin_context7_context7,serena --mcp-deny mcp__serena__delete_memory,mcp__serena__write_memory
   ```

   コマンドの形は `--write --model-id <model-id> --name <name> --roles <…> --mcp-servers <…> --mcp-deny <…> --scope custom --lang ja --dir "$PWD"` とする。`servers` が空の定義は `--mcp-servers` を渡さない。`denyTools` が空の定義は `--mcp-deny` を渡さない。model-id は次のとおり。
   - `complex-reviewer`: `gpt-astra`、`--roles complex-review`
   - `general-implementer`: `sonnet`、`--roles normal-impl`
   - `docs-reviewer`: `gpt-sol`、`--roles design-review`
   - `general-explore` / `code-reviewer` / `e2e-tester`: `sonnet`、それぞれの現在の役割
   - `realtime-researcher`: `grok`
   - 残り 5 定義(`lead-implementer` / `technical-leader` / `general-worker` / `knowledge-elicitationer` / `adversarial-reviewer`): 現在の model に対応する ModelId と役割
6. `light-implementer` を新設する。`--write --model-id gpt-luna --name light-implementer --roles light-impl --scope custom --lang ja --dir "$PWD"` に、`general-implementer` の控えた `servers` を `--mcp-servers` として、控えた `denyTools` を `--mcp-deny` として渡す(空なら渡さない)。
7. 各生成の直後に、応答の `mcpDropped` が空であることを確かめる。続いて、生成した定義の tools を読む。控えたサーバーごとに `mcp__<server>` があることを確かめる。欠けていたら、その定義を複製から戻し、以後の生成を止めて報告する。
8. すべて生成した後、複製と `diff -r` を取り、次を確かめる。
   - `disallowedTools` と MCP の行が消えていない。
   - どの定義の tools にも `Agent` が無い。
   - どの定義にも `## アドバイザーへの相談` と `## Agent tool の制約` の節が無い。
   - `effort` が設計書 §5.14 の値である。
9. 削除する 3 定義を、ユーザーに `!` で削除してもらう。示すパスは次の絶対パスである。
   - `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-overhaul/.claude/agents/system-planner.md`
   - `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-overhaul/.claude/agents/independent-tech-adviser.md`
   - `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-overhaul/.claude/agents/technical-adviser.md`
10. `--list-coverage --scope custom` の `uncovered` が空であることを確かめる。`grep -l -E "agent-policy-role:.*(design-plan|advisor|final-review|gate-review)" .claude/agents/*.md` が 0 件であることを確かめる。`ls .claude/agents` が 13 件である。

`.claude/agents` は `.gitignore` で追跡外のため、コミットを伴わない。

### T14: 実機確認(オーケストレーター)

生成した外部モデルの定義で、effort が上流へ届くことを確かめる。稼働中の CLIProxyAPI は止めず、設定も変えない。

1. 実設定 `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/cliproxyapi.config.yaml` を一時ディレクトリへ複製する。
2. 複製の `port` を稼働中と別の値にし、次の 3 キーを追記する。認証情報のディレクトリは稼働中と同じものを指す。
   - `debug: true`
   - `request-log: true`
   - `logging-to-file: true`
3. 複製の設定で観測用インスタンスを起動する。
4. このリポジトリで、`ANTHROPIC_BASE_URL` を観測用インスタンスへ向けた `claude -p` を実行し、次の 2 つの定義を名指しで 1 回ずつ起動させる。作業はファイルを変更しない短い読み取りにする。
   - low の観測: `light-implementer`(`claude-gpt-6-luna`)
   - medium の観測(必須): `docs-reviewer`(`claude-gpt-6-sol`)
   - 可能なら high の観測: `complex-reviewer`(`claude-gpt-6-astra`)
5. 観測用インスタンスの `logs/v1-messages-*.log` を読む。各リクエストについて、`REQUEST BODY`(Claude Code から来た body)の `output_config.effort` と、`API REQUEST 1`(上流へ送った body)の `reasoning.effort` を記録する。上流の値が定義の `effort`(low / medium / high)と一致することを確かめる。
6. `xhigh` は、このリポジトリの定義に該当する組が無いため観測しない。§10 に「`xhigh` の写像は未確認」と記録する。
7. 観測用インスタンスを停止し、複製した設定とログを削除する。秘密値を含むファイルはコミットしない。
8. 結果を §10 に記録する。`reasoning.effort` が表の値と食い違ったときは、実装を直さず報告し、原因の調査を別に立てる。

## 3. 依存関係

```
T0 ─ T1 ─ T2 ─ T3 ─ T4 ─ T5 ─ T6 ─ T7 ─ T8 ─ T9 ─┬─ T10a ─┬─ T11 ─ T12 ─ T13 ─ T14
                                               ├─ T10b ─┤
                                               └─ T10c ─┘
```

- T1-T4 は直列にする。T1 と T2 はどちらも担当表・`policies.ts`・`compose.test.ts` を書き換え、T2 と T3 はどちらも `compose.ts` を書き換え、T2 と T4 はどちらも `light-impl.md` を書き換える。同じ作業ツリーで並列に動かすと、互いの途中の変更でテストが落ちる。
- T5 は T4 の後に置く。規律の 4 役割の条件と断片の When to invoke を並べて揃えるためである。
- T6 は T3 の後に置く(effort の説明を書くため)。
- T7 は T5 と T6 の後に置く(README の MCP の説明と移行節を SKILL.md と規律に揃える)。
- T8 は全変更の後に置く。
- T12 と T13 は T8 の後に置く(バージョンと断片が最終形になってから)。
- T14 は T13 の後に置く(再生成した定義で確かめる)。

## 4. タスク間で共有する契約

依頼文へ転記し、担当が推測で決めないようにする。

**最終の役割の並び(13 件。`ROLES` の定義順。T1 から有効)**

```
complex-impl, normal-impl, light-impl, escalation, general,
explore, realtime-research, e2e-verify, design-review, knowledge-elicitation,
code-review, complex-review, adversarial-review
```

**固定値**

`ASSIGNMENTS`・`RECOMMENDED` は設計書 §5.2、`EFFORT` は §5.3、label・kind・tools は §5.1 の表を正本とする。

**`complex-review` の frontmatter**

| 項目 | 値 |
| --- | --- |
| id | `complex-review` |
| label(ja) | 重要な実装・高リスク設計書の最終レビュー |
| label(en) | Final review of critical implementations and high-risk designs |
| default-name | `complex-reviewer` |
| kind | `readonly` |
| tools | `Read, Grep, Glob, Bash` |

**`rolesFor` の期待値(T1 以降)**

| モデル | 役割 |
| --- | --- |
| sonnet | normal-impl, general, explore, realtime-research, e2e-verify, design-review, code-review |
| fable | escalation, complex-review |
| opus | complex-impl, adversarial-review |
| haiku | light-impl, knowledge-elicitation |

**Agent Tool(T2 以降)**

どの役割の定義にも `Agent` を出さない。`SOLO_DENIED_ROLES` と `allowsAgentTool` は存在しない。担当表は 4 列(役割名 / RoleId / 種別 / Claude モデル)である。

**MCP 既定の列挙(T6 / T7)**

`complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general`

**決定 (a) 分解可能性(T4 / T5。設計書 §4.4)**

- 分解できる作業は、難しい判断の部分を `complex-impl` へ、単純な部分を `normal-impl` または `light-impl` へ分けて委譲する。
- 分けてよいのは、判断部分の成果を文書に固定でき、下位の役割が追加の判断なしに実装できるときだけ。固定の形の例は、型・関数シグネチャ・ファイル配置・変更箇所の列挙。
- 判断部分を先に完了させ、その成果を下位の役割の依頼文に渡す。
- 成果を固定できないとき、または分割で委譲の回数が増えて効果に見合わないときは、分けずに全体を `complex-impl` に任せる。
- 下位の役割は、受け渡しが曖昧で迷ったら差し戻す。オーケストレーターは差し戻された作業を `complex-impl` へ再委譲する。

**決定 (b) 変更影響度(T4 / T5。設計書 §4.4)**

- 影響度だけでは役割を決めず、検証困難度と組み合わせる。
- 影響が広く、失敗を機械的に検出できない作業は `complex-impl` へ寄せる。影響が広くても機械的に検証できる作業は、役割を上げない。
- 「機械的に検証できる」根拠(変更するすべての箇所の正誤を、どの型検査・テスト・lint・grep が判定するか)は、着手前の `explore` への依頼に含めて調べさせる。根拠を示せなければ検証困難として扱う。
- 委譲先は完了報告に、変更した各箇所を判定した検査とその結果を添える。添えられない箇所があれば差し戻し、オーケストレーターは `complex-impl` へ再委譲する。
- 次の 3 つは、検証の可否にかかわらず `light-impl` へ委譲しない: 全セッションに作用する設定(hooks など)/ 保護パス / データ移行。
- 断片(他のリポジトリでも生成される)では、保護パスを「プロジェクトの規約(CLAUDE.md や rules)が直接編集を禁じる、または変更の手順を定めるパス」と書き、例にバンドル出力と規約ファイルを挙げる。

## 5. コミット

| # | タスク | メッセージ |
| --- | --- | --- |
| 1 | T1 | `feat(agent-policy): 役割を 13 種へ再編し complex-review を追加する` |
| 2 | T2 | `feat(agent-policy): サブエージェントの相談と Agent Tool を廃止し差し戻しに一本化する` |
| 3 | T3 | `feat(agent-policy): 生成する定義に役割とモデルに応じた effort を付ける` |
| 4 | T4 | `feat(agent-policy): 実装役割の条件を 5 軸で書き直し調査・設計レビューの出力を絞る` |
| 5 | T5 | `feat(agent-policy): 規律を 5 軸の委譲基準と差し戻しの経路に書き換える` |
| 6 | T6 | `docs(agent-policy): setup-agents の MCP 既定と effort の説明を更新する` |
| 7 | T7 | `docs(agent-policy): README を 0.21 の役割構成と effort に追随させる` |
| 8 | T8 | `chore(agent-policy): 0.21.0-dev` |
| 9 | T12 | `docs: Serena メモリを agent-policy 0.21 に追随させる` |

- すべてのメッセージの末尾に、セッションの指示にある Co-Authored-By の行を付ける。
- 本計画書と設計書は、文書のユーザー承認の後、コミット 1 の前に別にコミットする(`docs(agent-policy): 委譲体系の再編と effort の設計書と実装計画書を追加する`)。
- 各コミットの時点で lint / typecheck / test が通る。コミットの前に `git status --short` を見て、本改修と無関係なファイルを含めない。

## 6. リスクと対処

| リスク | 対処 |
| --- | --- |
| T1 の担当が、相談・Agent Tool の記述まで先に直し、T2 と衝突する | 依頼文で「T2 で直す。触らない」と明記する |
| T1 の担当が担当表以外の規律の本文まで直す | 依頼文で担当表(L6-23)の行だけに限定する |
| T1 の担当が、廃止した役割 ID を定義名の `RETIRED` へ足し、旧 ID のマーカーを検出できない | 依頼文で設計書 §4.10 の形(役割 ID で照合する別の一覧)を指定する。§7.5 のテストが検出する |
| T1 の担当が `setup-agents.test.ts:1922-1993` の 3 件の期待値だけを書き換え、テストの意図(次候補への移行 / 照会失敗 / ModelSpec 由来の vendor と color)が失われる | 依頼文で意図を保つ組への差し替えを指定する(設計書 §7.1) |
| T2 の担当が旧 L13-17 の 5 項目を削除し、差し戻しの条件が失われる | 依頼文で「削除せず `## 制約` へ移す」と書く。T11 の対応表で確かめる |
| T2 の担当が旧 L13-15 を移すとき、述語を「相談する」のまま残す | 依頼文で「述語を『差し戻す』に書き換える」と書く。§7.2 の新規検査が検出する |
| T2 の担当が `_common.md` の残す見出しを変え、合成結果から節が消える | 依頼文で明記する。`compose.test.ts` の節の検査が検出する |
| T2 の担当が `resolveToolsFor` の、断片の `Agent` を除く処理まで消す | 依頼文で残すと書く。§7.4 の「断片に書いても出ない」検査が検出する |
| T3 の担当が `ComposeInput` に `modelId` を足す | 依頼文で禁止を書く。T10a の確認点 (6) |
| T3 の担当が `merge` / `automaticKeep` に effort の特別扱いを足す | 依頼文で「変えない」と書く。§7.3 の merge の検査が既存の挙動で通ることを確かめる |
| T4 の担当が断片に評価順や決定 (a)(b) の判断手順を書く | 依頼文で「自分の役割の条件と、設計書 §4.4 が断片に置くと定めた 2 点(検査結果の報告、light-impl の 3 つ)だけ。評価順と判断手順は規律に置く」と書く |
| T4 の担当が `light-impl` の断片に、このリポジトリ固有のパス(`plugins/*/scripts/` など)を書く | 依頼文で「他のリポジトリでも通じる表現。例はバンドル出力と規約ファイル」と書く |
| en の断片・`_common.md` に日本語が入る | 依頼文で明記する。`compose.test.ts` の英語断片の検査が検出する |
| T5 で L139 の許可一覧に `disallowedTools` まで足す | 要点で「足さない」と明記した。T5 の grep で確かめる |
| 決定 (a)(b) の条件で規律の合計が 30,720B を超える | T5 で測る。条件の数と内容を保ったまま短くし、それでも超えるなら止めて報告する(設計書 §4.9) |
| T13 で保持マージを使い、廃止した節と `Agent` が残る | T13 の手順で `--merge` を使わない。手順 8 で確かめる |
| T13 で `disallowedTools` と MCP の付与が失われる | GOTCHA-001 の手順(T13 の 1・3・5・6)。手順 4 で接続を確かめ、手順 7 で欠けを検出して戻す |
| T13 で利用者の編集(独自の節やキー)が保持マージを使わないために失われる | T13 の手順 3 で検出し、該当する定義の生成を止める |
| T14 で稼働中のプロキシを止める、または設定を変える | 観測用インスタンスを別ポートで立てる(T14 の手順 1-3) |
| T14 で秘密値を含む設定やログがコミットに入る、または残る | 一時ディレクトリに置き、終了時に削除する(T14 の手順 7) |
| 実装中、旧 ID のマーカーを持つ定義が対応表から消え、レビューの委譲先が見つからない | §1 のとおり名指しで起動する |

## 7. 設計書との食い違い

計画立案時に検出した食い違いは、設計書 §3.3 に記録した 8 件である。実装中に見つけた食い違いは、次の形でこの節へ追記する。

| # | 検出タスク | 設計書の記述 | 実際 | 判断 |
| --- | --- | --- | --- | --- |

## 8. 未解決事項と着手の関係

| 設計書の項 | 内容 | 止めるタスク |
| --- | --- | --- |
| §10-1 | en 断片の文言 | なし(各タスクで決める) |

`## Agent tool の制約` の扱い(D8)、`complex-review` の label、決定 (a)(b)、廃止した役割 ID の通知の形(`RETIRED_ROLES` を足す)、規律 L139 の許可一覧への `effort` の追加は 2026-09-29 に確定した。

## 9. Done 条件

設計書 §11 に、本計画書で足した次の項目を加える。

- T0 の baseline と T9 の結果が記録されている。
- 各コミットの時点で lint / typecheck / test が通っている。
- `src/` を変えたコミット(1-3、8)に `scripts/` の差分が含まれ、`assets/` と `references/` と文書だけを変えたコミット(4-7)に `scripts/` の差分が無い。
- T10a / T10b / T10c の報告と T11 の突き合わせで見つかった食い違いが §7 に記録され、解消されている。
- T13 の前後の `diff -r` で、`disallowedTools` と MCP の行の削除が無い。
- T14 の結果(low と medium の観測、`xhigh` が未確認であること)が §10 に記録されている。

## 10. 実施記録

| 時点 | 結果 |
| --- | --- |
| 2026-09-29 T0 | lint / typecheck / test / build がすべて通った。テストは 2,894 件がパスし、5 件がスキップ。規律の合計は 27,188B |
| 2026-09-30 T1-T8 | コミット cfb43f64・dfcb8920・14d790f0・ef89e71e・a9a50fd8・12b9aa41・55de16cd・8b5b8ba3。T1 は担当の文脈が上限を超えて止まり、src と断片に分けて再委譲した |
| 2026-09-30 T9 | lint / typecheck / test / build がすべて通った。テストは 2,900 件がパスし、5 件がスキップ。規律の合計は 26,099B。grep で旧 ID が当たったのは SessionStart の廃止通知、規律の「変更量は条件に使わない」、README の移行節だけ。claude と custom の `--recommended` で 13 定義を生成し、effort・model 直後の位置・Agent の無いこと・旧節の無いことを確かめた |
| 2026-09-30 T10-T11 | code-review は重大な指摘なし。complex-review の判定は「採用可」。ARCHITECTURE への影響は無し。指摘 3 件(plugin.json の description、テストのコメント、RETIRED_ROLES の Set 化)と marketplace.json の description を f2335d77 で直した。marketplace.json の変更はユーザーが承認した |
| 2026-09-30 T12 | 85795b0f で agent_policy/core.md を更新した。core.md は T13 の後に更新した |
| 2026-09-30 T13 | 12 定義を再生成し、light-implementer を新設した。再生成の前に MCP サーバー 4 つが Connected であることを確かめた。生成の前後を比べ、disallowedTools と MCP の行が消えていないことを確かめた。廃止する 3 定義はユーザーが削除する |
| 2026-09-30 T14 | 上流の reasoning.effort を観測した。light-implementer(gpt-6-luna)は low、docs-reviewer(gpt-6-sol)は medium、complex-reviewer(gpt-6-astra)は high で、いずれも定義の effort と一致した。1 回目の観測では luna と astra のリクエストがプロキシに届かなかった。子の claude -p が Agent tool の model 引数で上書きしたためと推定する。model 引数を指定させない 2 回目の観測では、両方とも届いた。xhigh の写像は未確認 |
