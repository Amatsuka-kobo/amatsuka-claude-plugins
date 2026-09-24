# agent-policy 役割の再編 実装計画書

- 作成日: 2026-09-24
- 対象プラグイン: `plugins/agent-policy`
- バージョン: `0.19.8-dev` → `0.20.0-dev`
- 設計書(正本): `harness-docs/design/2026-09-24-agent-policy-role-overhaul-design.md`
- 設計書のユーザー承認: **未取得**(承認後に着手する)
- 版: 第 3 版(第 2 版で未解決事項への決定と要件 9、第 3 版でレビュー指摘の採否を反映)
- context-map: なし(本設計で context-map を廃止する。実測はオーケストレーターが行い設計の依頼文で渡した)
- 計画立案時の HEAD: `beda2ee`

この計画書はタスクの分割・順序・検証方法だけを定め、設計判断を上書きしない。設計書と実装の食い違いを見つけた担当は、実装を止めてオーケストレーターへ報告する。オーケストレーターは §7 に記録し、設計書の修正要否を判断する。

## 0. 触らないもの

- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md`。更新が要ると気付いたら、修正せず報告する(追随は metatron の CLI とスキルで行う)。
- `.claude/rules/metatron/` の 3 ファイル。
- `plugins/*/scripts/` の手編集。`src/` を変え、`pnpm run build` で再生成する。
- `.raphael/`。
- ルート `.gitignore` の `.claude/context-maps` 行(ユーザー指示で残す)。
- `.serena/memories/` を Edit / Write で触ること。T15 でオーケストレーターが Serena のツールで行う。
- プラグイン README の古い移行節(0.18 → 0.19 以前)。履歴として残す。
- 本改修と無関係な未コミット変更(`cliproxyapi.config.example.yaml`、`docs/chat/` など)。触らず、revert もしない。

## 1. 進め方の共通規律

- ブランチを切らない(プロジェクト規約)。main で作業し、タスクごとにコミットする。
- 各タスクの中では、テストを先に直してから実装する。タスクの完了時点で `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通ることを完了条件にする。タスクの途中で赤になるのは期待どおりである。
- `plugins/agent-policy/src/` を変えるタスクは、最後に `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分を同じコミットに含める。`assets/` と `references/` だけを変えるタスクでも build を実行し、`git status --short plugins/agent-policy/scripts` に差分が無いことを確認する(断片は実行時に読むため、差分が出ないのが期待値)。
- 指示書(`assets/roles/`・`references/`・`skills/`)を変えるタスクは、担当に `prompt-smith:prompt-smith` を起動させ、その規律に従わせる。適用する内容は設計書で確定済みのため、既存指示書の評価工程(評点表と承認)は省かせる。文面は担当が書く。依頼文には変更の要点と判断の軸を渡し、完成文を載せない(規律 §文書作成を委譲するとき)。
- README・テストコード・`src/**/*.ts`・バージョンのタスクにはスキルをロードさせない。
- en 断片と en の `_common.md` に日本語と日本語約物を書かない(`compose.test.ts:587`)。断片本文に `###` を使わない。`_common.md` の既存の見出し(`## Agent tool の制約` / `## Agent tool limits` など)を変えない。依頼文にこの 3 点を明記する。
- 改名は `git mv` で行い、履歴を保つ。
- 実装者の裁量: `Vocabulary` の新フィールド名は `writingHeading` とする。`adversarial-review` の en label、`general` の description、`_common.md` の執筆の節と各断片の本文の文言は、設計書の要点を満たす範囲で実装者が prompt-smith の規律に従って決める。設計書は文言を確定しない。
- 規律の純増は 3,983B を上限とする(設計書 §4.10)。T6 / T7 で超える見込みになったら、撤去する条項(L73 / L80 / L107 / 探索節の context-map 記述)の削除が済んでいることを確かめ、次に §2.7 / §2.8 の条項を条件の数と内容を保ったまま短くする。それでも超えるなら止めて報告する。
- 役割数は T2 で 16、T3 で 15、T4 で 15、T5 で 16 と推移する。各タスクは、そのタスクの完了時点の役割集合でテストの固定値を書く。最終形を先取りしない。
- プラグイン README と SKILL.md は T9 / T10 でまとめて直す。T1b-T8 のコミットでは、これらの記述が一時的に古いままになる(テストは読まない)。
- 設計判断・要件の追加・スコープの拡大は担当が決めず、オーケストレーターへ差し戻す。
- 設計書 §10 に残った未解決事項が着手を止めるタスクを §8 に挙げた。オーケストレーターは該当タスクの前に決定する。

## 2. タスク

### T0: baseline(オーケストレーター)

| 項目 | 内容 |
| --- | --- |
| 作業 | `git status --short` で本改修と無関係な未コミット変更を記録する。`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` を実行し、結果とテスト件数を記録する。build 後に `git status --short plugins/agent-policy/scripts` の差分が無いことを確認する。`wc -c plugins/agent-policy/skills/custom-policy/SKILL.md plugins/agent-policy/references/orchestration-discipline.md` の合計を記録する(期待値 26,737B。上限 30,720B までの余裕 3,983B)。claude-model-policy 側は custom より小さいため測らない |
| 検証 | 4 コマンドがすべて通る。通らないときは本改修に入らず報告する |
| コミット | なし |

### T1: 要件 6 `e2e-verify` の推奨モデル

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/agents/policies.ts`、`src/agents/__test__/policies.test.ts`、`src/__test__/setup-agents.test.ts` |
| 要点 | `RECOMMENDED["e2e-verify"]` を `["sonnet"]` にする。`EXPECTED_RECOMMENDED` を同じ値に。`setup-agents.test.ts:472-480`(`claude-gpt-6-astra` の `recommendedFor`)と `:1851-1857`(`--models` の gpt-astra の役割)から `e2e-verify` を外す |
| 担当 | 軽量な実装 |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。`scripts/` に差分が出ることを確認する |
| コミット | `feat(agent-policy): e2e-verify の推奨モデルから gpt-astra を外す` |

### T1b: 要件 9 `gemini-flash` とベンダー `gemini` の削除

| 項目 | 内容 |
| --- | --- |
| 対象(実装) | `src/agents/policies.ts`、`src/agents/fragments.ts`、`src/agents/compose.ts`、`src/agents/live-models.ts`、`src/setup-agents.ts` |
| 対象(テスト) | `policies.test.ts`、`compose.test.ts`、`live-models.test.ts`、`discipline-role-table.test.ts`、`setup-agents.test.ts` |
| 要点(実装) | 設計書 §5.2 の `MODELS` と §5.2b の表。`ModelId` と `MODELS` から `gemini-flash` を削除し、`Vendor` を 4 値にし、`COLORS` / `VENDOR_COLORS` / `--vendor` の検証 / 推定失敗の文言 / `vendorFor` の `antigravity` の case を追随させる。`RECOMMENDED["doc-writing"]` から `gemini-flash` を外す(`doc-writing` の行は T2 で行ごと消える。このタスクでは `["sonnet", "gpt-terra"]` にして型を通す) |
| 要点(テスト) | 設計書 §7.4 の全行。`EXPECTED_RECOMMENDED["doc-writing"]` を実装と同じ暫定値にする |
| 担当 | 通常の実装(型の削除に伴う追随で、新しい構造を決めない) |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。`grep -rn "gemini" plugins/agent-policy/src` が、`antigravity` を `unknown` と期待する検査と `--vendor gemini` の拒否の検査だけになる |
| コミット | `feat(agent-policy): ModelId gemini-flash とベンダー gemini を削除する` |

SKILL.md と README の `gemini` の記述は T9 / T10 で直す。

### T2: 要件 1 `doc-writing` の廃止と執筆基準の標準化

| 項目 | 内容 |
| --- | --- |
| 対象(実装) | `src/agents/roles.ts`、`src/agents/policies.ts`、`src/agents/vocabulary.ts`、`src/agents/compose.ts` |
| 対象(断片) | `assets/roles/{ja,en}/doc-writing.md`(削除)、`assets/roles/{ja,en}/_common.md`、`general.md`、`design-plan.md` |
| 対象(規律) | `references/orchestration-discipline.md` |
| 対象(テスト) | `roles.test.ts`、`fragments.test.ts`、`policies.test.ts`、`compose.test.ts`、`setup-agents.test.ts` |
| 要点(実装) | 設計書 §5.1-5.3 のうち `doc-writing` の削除と執筆の節。`RoleId` / `ROLES` / `ASSIGNMENTS` / `RECOMMENDED` / `SOLO_DENIED_ROLES` から削る。`Vocabulary` に執筆の見出しを足し、`compose()` が `withAgent` に関わらず advisor 節の後・`## 制約` の前に出す |
| 要点(断片) | 設計書 §5.7 のうち `_common.md` の (1) 執筆の節と (3) Agent tool の節の L20-32 の書き換え、`general.md` の文書作成の復帰(description・When to invoke・Core Responsibilities)、`design-plan.md` L31「文書の文体は、担当表の『文書作成』の役割の規律に従う」の削除(ja / en)。執筆基準の出典は旧 `doc-writing.md` の §作業手順(削除前に読む) |
| 要点(規律) | 設計書 §5.8(担当表の行削除と L26 の例の差し替え)と §5.9 のうち要件 1 の行(§オーケストレーターが自ら担う作業 の冒頭、執筆基準の小見出し、§文書作成を委譲するとき の改題と撤去・言い換え、§サブエージェントの規律 L107 の削除) |
| 要点(テスト) | 役割 16 件の固定値(`roles.test.ts:11-43`、`fragments.test.ts:57` / `:64`、`policies.test.ts` の期待値表とテスト名、`rolesFor("sonnet")` から `doc-writing` を外す、`setup-agents.test.ts:543` / `:610` / `:737-754`、`:1850` の gpt-terra の役割を `["explore"]` に)。`compose.test.ts` は設計書 §7.2 の全行 |
| 担当 | 複雑または重要な実装(型・断片・規律が同時に動き、全定義の本文が変わる) |
| スキル | `prompt-smith:prompt-smith`(断片と規律の部分) |
| 検証 | lint / typecheck / test / build。`grep -rn "doc-writing" plugins/agent-policy/assets plugins/agent-policy/references plugins/agent-policy/src --include=*.ts --include=*.md` がテストの期待値だけになる(`context-map` は T3 で消えるため、このタスクでは検査しない)。`node plugins/agent-policy/scripts/setup-agents.mjs --check --model-id sonnet --name t --roles code-review --lang en --scope claude --dir "$(mktemp -d)"` 等で合成結果に `## Writing` が出ることを目視する |
| コミット | `feat(agent-policy): 役割 doc-writing を廃止し執筆基準を全定義の共通部分へ移す` |

依頼文に次を書く。

- 執筆の節は `## 制約` の直前、advisor 節より後。`withAgent` を条件にしない。
- `_common.md`(ja / en それぞれ)で触る行: アドバイザー節(ja L11-16 / en L11-16。T2 では Agent tool の節との整合に要る範囲だけ。基準の書き換えは T7)、Agent tool の節(ja L18-32 / en L18-32。L20 の「相談と再委譲の 2 つだけ」を「相談だけ」に書き直し、L21-32 を撤去する)、執筆の節の新規挿入位置(Agent tool の節と §制約 の間)。触らない行: §制約 L34 以降(L42 は T3)。
- `_common.md` の `## Agent tool の制約` の見出しは変えない。書き換え後の本文に残す語で `compose.test.ts:213-232` の検査を作り直す。実装とテストで同じ語を使う。
- `compose.ts` の `COLORS` は触らない(T1b で `gemini` を消した状態を保つ)。
- 規律の「文書の執筆を委譲するとき」は、完成文を載せない規則と「本文に載せる」の添え書きを残す(GOTCHA-002)。撤去するのは F1、L74 の執筆と文体の委譲、L80 の 3 項目だけである。
- 規律に置く執筆基準と `_common.md` の執筆の節は読者が違うため重複を許す(設計書 §4.1)。
- `_common.md` の L42(context-map 条項)は T3 で直す。このタスクでは触らない。

### T3: 要件 5 `explore-lead` と context-map の廃止

| 項目 | 内容 |
| --- | --- |
| 対象(実装) | `src/agents/roles.ts`、`src/agents/policies.ts` |
| 対象(断片・文書) | `assets/roles/{ja,en}/explore-lead.md`(削除)、`explore.md`、`design-plan.md`、`_common.md`(§制約 L42 だけ)、`assets/context-map-template.md`(削除)、`references/context-map-guide.md`(削除) |
| 対象(規律) | `references/orchestration-discipline.md` |
| 対象(テスト) | `roles.test.ts`、`fragments.test.ts`、`policies.test.ts`、`compose.test.ts`、`marker-scan.test.ts`、`session-start.test.ts`、`setup-agents.test.ts` |
| 要点(実装) | `explore-lead` を `RoleId` / `ROLES` / `ASSIGNMENTS` / `RECOMMENDED` から削る。`explore` の label を「コードベース探索」にする |
| 要点(断片) | 設計書 §5.7 の `explore.md` と `design-plan.md` の context-map の一般化、`_common.md` の (4) |
| 要点(規律) | 設計書 §5.8(担当表の行削除と `explore` の役割名)、§5.9 の §分析(context-map と「コードベース探索実働」)、§5.10 の §コードベース探索 と §設計・実装計画の規律 1-2 項目 |
| 要点(テスト) | 役割 15 件の固定値。`roles.test.ts:44-58` を `design-plan` だけにし `explore` の label を足す。`compose.test.ts:119-122` / `:248` / `:261`(`:433` / `:467` のフィクスチャは任意)、`marker-scan.test.ts:309`、`session-start.test.ts:654` / `:732` / `:802`、`setup-agents.test.ts` の件数と ID 列。設計書 §7.2 の「合成した定義に `doc-writing` と `context-map` が現れない」検査(ja / en)をこのタスクで足す。禁止語はこの 2 つだけで、「文書作成」は含めない |
| 担当 | 複雑または重要な実装 |
| スキル | `prompt-smith:prompt-smith`(断片と規律の部分) |
| 検証 | lint / typecheck / test / build。`grep -rn "context-map\|explore-lead\|探索統括\|探索実働" plugins/agent-policy/src plugins/agent-policy/assets plugins/agent-policy/references` が、`compose.test.ts:433` / `:467` のフィクスチャ(変更は任意)を除いて 0 件。`ls plugins/agent-policy/references` が `orchestration-discipline.md` だけ |
| コミット | `feat(agent-policy): 役割 explore-lead と context-map を廃止し探索を explore へ直接委譲する` |

### T4: 要件 2 レビュー 2 役割の改名

| 項目 | 内容 |
| --- | --- |
| 対象(実装) | `src/agents/roles.ts`、`src/agents/policies.ts` |
| 対象(断片) | `git mv assets/roles/{ja,en}/independent-review.md → design-review.md`、`git mv assets/roles/{ja,en}/doc-review.md → knowledge-elicitation.md` |
| 対象(規律) | `references/orchestration-discipline.md` |
| 対象(テスト) | `roles.test.ts`、`fragments.test.ts`、`policies.test.ts`、`compose.test.ts`、`setup-agents.test.ts` |
| 要点(実装) | 設計書 §5.1 / §5.2 の 2 行。位置は旧 ID の位置のまま。`SOLO_DENIED_ROLES` の `doc-review` を `knowledge-elicitation` に |
| 要点(断片) | 設計書 §5.5。`design-review` は frontmatter の `id` / `label` を変え、本文を引き継ぐ。制約文の冒頭の役割スコープ句は新しい役割名に合わせる。`knowledge-elicitation` は frontmatter の 4 項目を変え、対象を任意の成果物へ広げる |
| 要点(規律) | 担当表の 2 行、§委譲先の解決 L55 の役割名、§設計・実装計画の規律 のレビューの 2 項目(設計書 §5.10 の 3-4 項目) |
| 要点(テスト) | 期待値表・ID 列・`rolesFor("sonnet")`・`compose.test.ts:251-254`(検査文字列を新しいスコープ句に)・`setup-agents.test.ts:950-961` / `:1012` |
| 担当 | 複雑または重要な実装 |
| スキル | `prompt-smith:prompt-smith`(断片と規律の部分) |
| 検証 | lint / typecheck / test / build。`grep -rn "independent-review\|doc-review\|独立レビュー" plugins/agent-policy/src plugins/agent-policy/assets plugins/agent-policy/references` が 0 件 |
| コミット | `feat(agent-policy): レビュー役割を design-review と knowledge-elicitation へ改名する` |

### T5: 要件 3 `adversarial-review` の新設

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/agents/roles.ts`、`src/agents/policies.ts`、`assets/roles/{ja,en}/adversarial-review.md`(新規)、`references/orchestration-discipline.md`(担当表の 1 行)、テスト 5 本 |
| 要点 | 設計書 §5.1 / §5.2 の `adversarial-review` の行。`ROLES` の `gate-review` の直後。`SOLO_DENIED_ROLES` の末尾。断片は設計書 §5.6 の要点で ja / en を対で作る |
| 要点(テスト) | 役割 16 件の固定値。`roles.test.ts` に label・kind・tools の検査、`fragments.test.ts` に `adversary`、`setup-agents.test.ts:469` の `claude-gpt-6-sol` の `recommendedFor` を `["complex-impl", "adversarial-review"]`(`sortRoleIds` の順)に。`compose.test.ts:587-597` の英語純度検査を、`ROLES` の全 id を 1 件ずつ en で合成して日本語文字と日本語約物が無いことを見る形に広げる |
| 担当 | 通常の実装 |
| スキル | `prompt-smith:prompt-smith`(断片の部分) |
| 検証 | lint / typecheck / test / build。`roleOrder("advisor") === ROLES.length - 1` が通る。§設計・実装計画の規律 に `adversarial-review` が現れない |
| コミット | `feat(agent-policy): 敵対的レビューの役割 adversarial-review を追加する` |

### T6: 要件 7 実装 4 役割の基準

| 項目 | 内容 |
| --- | --- |
| 対象 | `assets/roles/{ja,en}/escalation.md` / `complex-impl.md` / `normal-impl.md` / `light-impl.md`、`references/orchestration-discipline.md` |
| 要点 | 設計書 §5.7 の 4 断片の行、§5.9 の §モデル別役割の運用 の行。規律は上から評価する旨と escalation の運用規律を持つ。断片は自分の役割の条件だけを書く(設計書 §4.8) |
| 担当 | 通常の実装 |
| スキル | `prompt-smith:prompt-smith` |
| 検証 | lint / typecheck / test / build(`scripts/` に差分が出ない)。`wc -c plugins/agent-policy/skills/custom-policy/SKILL.md plugins/agent-policy/references/orchestration-discipline.md` の合計を記録し、T7 の追記分を足しても 30,720B に収まる見込みを確かめる |
| コミット | `feat(agent-policy): 実装 4 役割の振り分けを観測できる基準にし escalation の発火条件を定める` |

### T7: 要件 8 advisor の基準

| 項目 | 内容 |
| --- | --- |
| 対象 | `assets/roles/{ja,en}/_common.md`(§アドバイザーへの相談 だけ)、`assets/roles/{ja,en}/advisor.md`、`references/orchestration-discipline.md` |
| 要点 | 設計書 §5.7 の `_common.md` (2) と `advisor.md` の行、§5.9 の §分析 の advisor 条項と §サブエージェントの規律 L108 |
| 担当 | 通常の実装 |
| スキル | `prompt-smith:prompt-smith` |
| 検証 | lint / typecheck / test / build(`scripts/` に差分が出ない)。`compose.test.ts` の advisor 節の検査(`:201`、`:213`、`:214`、`:552`)が通る。`wc -c plugins/agent-policy/skills/custom-policy/SKILL.md plugins/agent-policy/references/orchestration-discipline.md` の合計が 30,720B 以下 |
| コミット | `feat(agent-policy): アドバイザーへ相談する条件とオーケストレーターの相談規律を定める` |

`light-impl.md` の「アドバイザーへ相談せず差し戻す」は変えない(設計書 §4.9)。依頼文に明記する。

### T8: 要件 4 CLI `--recommended`

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/setup-agents.ts`、`src/agents/policies.ts`(`RECOMMENDED` の並び)、`src/__test__/setup-agents.test.ts`、`src/agents/__test__/policies.test.ts` |
| 要点 | 設計書 §4.5 / §4.6 / §4.11 / §5.4。`RECOMMENDED` を §5.2 の並びへ並べ替える(`ASSIGNMENTS` は変えない)。`recommendedRolesFor` を削除する。`--recommended` と `--model-id` / `--name` / `--model` / `--vendor` / `--keep` の併用を `ok: false` で拒否する |
| 要点(テスト) | `EXPECTED_RECOMMENDED` を並べ替え後の順にする。`--list-coverage` の `models` を順序込みで検査している箇所があれば追随させる。設計書 §7.3 の全行。describe「--models による推奨一括」を describe「--recommended」へ書き換え、describe「廃止フラグ」に `--models` を足し、`:355-369` を書き換え、応答型を直す。custom を要するケースは `--scope custom` を明示する。ヘルパーに scope を焼き込まない |
| 担当 | 複雑または重要な実装(CLI 引数と応答の形という公開インターフェースを変える) |
| スキル | 不要 |
| 検証 | lint / typecheck / test / build。`node plugins/agent-policy/scripts/setup-agents.mjs --check --recommended --scope claude --lang ja --dir "$(mktemp -d)"` が 16 件の `results` を返し、各要素に `roleId` がある。`--models sonnet` と `--recommended --name x` が `ok: false` を返す。`grep -n "recommendedRolesFor" plugins/agent-policy/src/setup-agents.ts` が 0 件 |
| コミット | `feat(agent-policy): setup-agents の既定を 1 役割 1 定義にし --models を --recommended へ置き換える` |

依頼文に次を書く。

- 個別経路(`--model-id … --name … --model … --roles …`)、`--list-coverage`、`--list-roles`、`--list-live-models`、`--merge` / `--keep`、MCP の付与、翻訳断片の処理は変えない。
- `--recommended` の vendor は ModelSpec から取り、`resolveVendor` を通さない。個別経路は `resolveVendor` のまま。
- `results[]` の `roleId` は `--recommended` 経路の要素だけが持つ。

### T9: SKILL.md

| 項目 | 内容 |
| --- | --- |
| 対象 | `skills/setup-agents/SKILL.md` |
| 要点 | 設計書 §5.12 の全行。MCP 既定の列挙は 6 件(`complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general` / `design-plan`)。ステップ 1b と 6b の未カバー役割の生成は `--check --recommended --roles <uncovered…>` → `--write --merge --recommended --roles <uncovered…>` にし、6b の定義名・モデル ID の対話は 5b へ寄せる。ベンダーの列挙を 4 値にし、既定エイリアスの対応から `gemini-flash` を外す。frontmatter は変えない |
| 担当 | 通常の実装 |
| スキル | `prompt-smith:prompt-smith` |
| 検証 | `grep -n "\-\-models\|modelsDropped\|doc-writing\|explore-lead\|gemini" plugins/agent-policy/skills/setup-agents/SKILL.md` が 0 件。記載したコマンドの引数が T8 の CLI で受理されることを、`--check` 系のコマンドを一時ディレクトリで実行して確かめる |
| コミット | `docs(agent-policy): setup-agents の手順を役割単位の生成に書き換える` |

依頼文に、ウィザードの各分岐で「どう聞くか」(`AskUserQuestion` の選択肢と候補数の規則)を書き残すよう明記する。分岐の条件だけを書くと質問が飛ぶ。

### T10: README

| 項目 | 内容 |
| --- | --- |
| 対象 | `plugins/agent-policy/README.md`、ルート `README.md` |
| 要点 | 設計書 §5.11 の全行。移行節「0.19 系から 0.20 系へ」は「0.18 系から 0.19 系へ」の直前に置く。モデル表は 9 種にする。L146-150 の Antigravity の注記は `gemini-flash` の行と一緒に削除する。ルート README は L100 / L104 / L106 だけを変える |
| 担当 | 通常の実装 |
| スキル | 不要(README は prompt-smith の対象外) |
| 検証 | 役割表が 16 行で `ROLES` の順と一致し、モデル表が 9 行。`grep -n "context-map\|Gemini\|17種" README.md` が 0 件。プラグイン README で context-map と gemini が現れるのは古い移行節と新しい移行節だけ |
| コミット | `docs(agent-policy): README を 0.20 の役割構成に追随させる` |

### T11: バージョン

| 項目 | 内容 |
| --- | --- |
| 対象 | `plugins/agent-policy/.claude-plugin/plugin.json`、`plugins/agent-policy/package.json`、`scripts/`(生成物) |
| 要点 | 両方の `version` を `0.20.0-dev` にする。`pnpm run build` を実行し、差分があれば同じコミットに含める |
| 担当 | 軽量な実装 |
| スキル | 不要 |
| 検証 | 2 ファイルの `version` が一致する。lint / typecheck / test が通る |
| コミット | `chore(agent-policy): 0.20.0-dev` |

### T12: 統合検証(オーケストレーター)

次を順に実行し、出力を記録する。

1. `pnpm run build` の後、`git status --short plugins/agent-policy/scripts` に差分が無い。
2. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test`。テスト件数の増減が本改修の追加・削除分だけである。
3. `wc -c plugins/agent-policy/skills/custom-policy/SKILL.md plugins/agent-policy/references/orchestration-discipline.md` の合計が 30,720B 以下(claude-model-policy 側は custom より小さいため測らない)。超えたら止めてユーザーへ報告する(設計書 §4.10)。
4. `grep -rn "doc-writing\|explore-lead\|independent-review\|doc-review\|context-map" plugins/agent-policy/src plugins/agent-policy/assets plugins/agent-policy/references plugins/agent-policy/skills` の結果が、移行・履歴を説明する箇所とテストの否定の検査だけ。
5. `node plugins/agent-policy/scripts/setup-agents.mjs --list-roles --lang ja --dir "$PWD"` が 16 役割を設計書 §5.1 の順で返す。
6. `node plugins/agent-policy/scripts/setup-agents.mjs --check --recommended --scope claude --lang ja --dir "$(mktemp -d)"` が 16 件を返し、定義名が `<model-id>-<default-name>` である。
7. `--scope custom` でも 6 を実行し、照会が成功した環境で各役割に `RECOMMENDED` の先頭(設計書 §5.2)が採られる。先頭の既定エイリアスが実在しない役割は次の候補になり、その事実を記録する。

### T13: コードレビュー(並列、読み取りのみ)

| ID | 内容 | 担当 |
| --- | --- | --- |
| T13a | T1-T11(T1b を含む)の全差分のコードレビュー。必ず見る点: (1) `SOLO_DENIED_ROLES`・担当表・`EXPECTED_AGENT_TOOL` の Agent Tool が一致する (2) `_common.md` の見出しが `vocabulary.ts` と一致し、執筆の見出しが ja / en で `vocabulary.ts` と一致する (3) 執筆の節が `withAgent` に依存しない (4) `--recommended` が vendor を ModelSpec から取り、個別経路は `resolveVendor` のまま (5) `roleId` の形が設計書 §4.5 どおりで、応答に `modelsDropped` / `rolesDropped` が無く、個別のフラグとの併用を拒否する (6) en 断片に日本語が無い (7) 断片に `###` が無い (8) `RECOMMENDED` が設計書 §5.2 の並びで、`ASSIGNMENTS` が変わっていない (9) `Vendor` が 4 値で、`vendorFor` に `antigravity` の case が無い (10) `recommendedRolesFor` が残っていない | コードレビュー |
| T13b | ARCHITECTURE への影響確認。削除・新規・改名したファイルがドメインマップの glob に収まり、ARCHITECTURE が役割 ID・context-map・`references/context-map-guide.md` を名指ししていないことを確かめる。取りこぼしは修正せず報告する | コードベース探索実働(T3 以降は「コードベース探索」) |

依頼文に「ファイルを変更しない」「報告のみを返す」「使用してよい tools を読み取り系に限定する」を明記する。

### T14: 最終突き合わせ(オーケストレーター)

全差分を分割せず一度に読み、設計書 §5 と突き合わせる。特に次を確かめる。

1. 役割 16 種の並びが `roles.ts`・担当表・プラグイン README・`--list-roles` で同じ。
2. 改名した 2 役割と `explore` の役割名が `roles.ts`・ja 断片・担当表・README・規律の本文で揃っている。
3. 執筆基準が `_common.md`(ja/en)と規律の 2 箇所にあり、内容が食い違っていない。
4. 次の対応表の各行で、条件の数と内容が一致する。

   | 規律側 | 定義側 |
   | --- | --- |
   | §モデル別役割の運用 の `escalation` の基準 | `escalation.md`(ja / en)の When to invoke |
   | 同 `complex-impl` の基準 | `complex-impl.md`(ja / en)の When to invoke |
   | 同 `normal-impl` の基準 | `normal-impl.md`(ja / en)の When to invoke |
   | 同 `light-impl` の基準 | `light-impl.md`(ja / en)の When to invoke |
   | §分析 の advisor 条項、§サブエージェントの規律 のアドバイザー条項 | `_common.md`(ja / en)§アドバイザーへの相談、`advisor.md`(ja / en)の When to invoke |

5. MCP 既定の列挙が SKILL.md と README で同じ 6 件。
6. 規律 §サブエージェントの規律 に doc-writing の条項が無く、残りの条項がすべて「サブエージェントは〜」で始まる。

食い違いは §7 に記録し、該当タスクをやり直す。

### T15: Serena メモリ(オーケストレーター)

| 項目 | 内容 |
| --- | --- |
| 対象 | `.serena/memories/agent_policy/core.md`、`.serena/memories/core.md` |
| 要点 | 設計書 §5.14。Serena の `edit_memory` / `write_memory` で行う。サブエージェントへ委譲しない |
| 検証 | `grep -n "doc-writing\|explore-lead\|independent-review\|doc-review" .serena/memories/agent_policy/core.md .serena/memories/core.md` の結果が、廃止・改名の経緯を書いた箇所だけ |
| コミット | `docs: Serena メモリを agent-policy 0.20 に追随させる` |

### T16: このリポジトリの `.claude/agents/` の再生成(オーケストレーター)

設計書 §5.16 の表のとおり処置する。既存の定義名と役割構成を保ち、個別経路(`--model-id … --name … --model … --roles …`)で保持マージする。`--recommended` は使わない(既定名で別の定義を作ってしまうため)。敵対的レビューの定義の名前とモデル(推奨は `opus` / `gpt-sol`)は、着手時にユーザーへ確認する(設計書 §10-1)。`complex-reviewer` の `e2e-verify` に出る推奨外の警告は受容する。手順は GOTCHA-001 に従う。

1. `.claude/agents/` を別ディレクトリ(例: `/tmp/agents-backup-2026-09-24/`)へ複製する。
2. 14 定義の `agent-policy-role`・`model`・`tools` の MCP・`disallowedTools` を一覧にする。`disallowedTools` を持つのは 7 定義(`code-reviewer` / `complex-reviewer` / `docs-reviewer` / `general-explore` / `independent-tech-adviser` / `realtime-researcher` / `technical-adviser`)。
3. `document-writer.md` の削除はユーザーの手で行う(既存ファイルの削除はユーザーが `!` で実行する運用)。絶対パスで示す。
4. 各定義の生成の前に `--check` を実行し、`mcpCurrent.servers` と `mcpCurrent.denyTools` を控える。`--write` に `--mcp-servers` を渡すときは、控えた `denyTools` を `--mcp-deny` に渡す。
5. 各定義を、現在の `name`・`model`・役割構成で `--write --merge --model-id <model-id> --name <name> --model <model> --roles <…>` により生成する。役割を変えるのは次の 3 定義だけである。`knowledge-elicitationer` は `--roles knowledge-elicitation`、`docs-reviewer` は `--roles design-review`、`system-planner` は `--roles design-plan`。
6. ユーザーが決めた名前とモデルで、敵対的レビューの定義を `--roles adversarial-review` で新設する。
7. 生成後、複製との `diff -r` を取り、`disallowedTools` と MCP の行が削除されていないことを確かめる。
8. `--list-coverage --scope custom` の `uncovered` が空(または作らないと決めた役割だけ)であることを確かめる。`grep -l "agent-policy-role:.*\(doc-writing\|explore-lead\|independent-review\|doc-review\)" .claude/agents/*.md` が 0 件であることを確かめる。

`.claude/agents` は `.gitignore:14` で追跡外のため、コミットを伴わない。

## 3. 依存関係

```
T0 ─ T1 ─ T1b ─ T2 ─ T3 ─ T4 ─ T5 ─┬─ T6 ─┐
                              ├─ T7 ─┼─ T8 ─ T9 ─ T10 ─ T11 ─ T12 ─┬─ T13a ─┬─ T14 ─ T15 ─ T16
                              │      │                              └─ T13b ─┘
```

- T1-T5(T1b を含む)は `roles.ts` / `policies.ts` / 担当表 / テストの固定値を順に書き換えるため、直列にする。並列にすると同じ固定値を別々に書き換えて衝突する。
- T1b は T2 より前に置く。`RECOMMENDED["doc-writing"]` を暫定値にしてから、T2 が行ごと消す。
- `RECOMMENDED` の並べ替えは T8 で行う。T2-T5 は既存の行の並びを保ったまま行を削除・改名・追加する。
- T6 と T7 は対象の断片が重ならないが、どちらも `references/orchestration-discipline.md` を触る。T6 は §モデル別役割の運用、T7 は §分析 と §サブエージェントの規律 L108 だけを触ると依頼文で限定すれば並列に出せる。限定できないときは直列にする。T7 は `_common.md` の §アドバイザーへの相談 だけを触り、T2 が足した執筆の節と縮小した Agent tool の制約に触れない。
- T8 は T5 の後に置く。`--recommended` のテストは最終の 16 役割で書く。
- T9 は T8 の後に置く。SKILL.md に書くコマンドは T8 の CLI で確かめる。
- T10 は T9 の後に置く。README の非対話モードと MCP の説明を SKILL.md と揃える。
- T11 は全変更の後に置く。
- T15 は T11 の後に置く(バージョンが決まってから書く)。
- T16 は T11 の後に置く(`scripts/` と断片が最終形になってから生成する)。

## 4. タスク間で共有する契約

依頼文へ転記し、担当が推測で決めないようにする。

**最終の役割の並び(16 件。`ROLES` の定義順)**

```
complex-impl, normal-impl, light-impl, escalation, general, design-plan,
explore, realtime-research, e2e-verify, design-review, knowledge-elicitation,
code-review, final-review, gate-review, adversarial-review, advisor
```

**タスクごとの役割集合**

| 完了時点 | 件数 | 前タスクからの差 |
| --- | --- | --- |
| T0 | 17 | — |
| T2 | 16 | `doc-writing` を削除 |
| T3 | 15 | `explore-lead` を削除 |
| T4 | 15 | `independent-review` → `design-review`、`doc-review` → `knowledge-elicitation` |
| T5 | 16 | `adversarial-review` を `gate-review` の直後へ追加 |

**固定値**

`ASSIGNMENTS`・`RECOMMENDED`・Agent Tool は設計書 §5.2 の表、label・kind・tools は §5.1 の表を正本とする。`RECOMMENDED` の並びは T8 の完了時点で §5.2 の表の順になる(T8 より前のタスクは既存の並びを保つ)。

**モデルとベンダー(T1b 以降)**

- `MODELS` は 9 件: `opus, sonnet, haiku, fable, gpt-sol, gpt-terra, gpt-luna, gpt-astra, grok`。
- `Vendor` は 4 値: `gpt, grok, claude, none`。色は `gpt:yellow / grok:red / claude:blue / none:blue`。`COLORS` / `VENDOR_COLORS` は `gemini` を削除するだけで、値の追加は無い。
- `--vendor` のエラー文言: `vendor: must be gpt, grok, claude or none`。推定失敗の文言: `… pass --vendor gpt|grok|claude|none`。
- `vendorFor`: `openai → gpt` / `xai → grok` / `anthropic → claude` / それ以外(`antigravity` を含む)→ `unknown`。新設・改名した役割の frontmatter は次のとおり。

| 役割 | label(ja) | default-name | kind | tools |
| --- | --- | --- | --- | --- |
| `design-review` | 設計書・実装計画書のレビュー | `docs-reviewer` | readonly | `Read, Grep, Glob, Bash` |
| `knowledge-elicitation` | 暗黙知の抽出・理解レビュー | `knowledge-elicitor` | readonly | `Read, Grep, Glob` |
| `adversarial-review` | 敵対的レビュー | `adversary` | readonly | `Read, Grep, Glob, Bash` |
| `explore`(label だけ変更) | コードベース探索 | `explorer`(維持) | readonly | 維持 |

**`rolesFor("sonnet")` の期待値(T4 以降、7 件)**

```
normal-impl, general, explore, realtime-research, e2e-verify, design-review, code-review
```

途中の状態は次のとおり。

| 完了時点 | `rolesFor("sonnet")` |
| --- | --- |
| T2 | 7 件: normal-impl, general, explore, realtime-research, e2e-verify, independent-review, code-review |
| T3 | T2 と同じ 7 件 |
| T4 | `independent-review` が `design-review` に変わる(上の最終形) |

**`_common.md` の見出し**

| 節 | ja | en | 出力条件 |
| --- | --- | --- | --- |
| アドバイザー | `## アドバイザーへの相談` | `## Consulting an advisor` | `withAgent` |
| Agent tool | `## Agent tool の制約` | `## Agent tool limits` | `withAgent` |
| 執筆(新設) | `## 文書の執筆` | `## Writing` | 常に |
| 制約 | `## 制約` | `## Constraints` | 常に |

**MCP 既定の列挙(T9 / T10)**

`complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general` / `design-plan`

## 5. コミット

| # | タスク | メッセージ |
| --- | --- | --- |
| 1 | T1 | `feat(agent-policy): e2e-verify の推奨モデルから gpt-astra を外す` |
| 1b | T1b | `feat(agent-policy): ModelId gemini-flash とベンダー gemini を削除する` |
| 2 | T2 | `feat(agent-policy): 役割 doc-writing を廃止し執筆基準を全定義の共通部分へ移す` |
| 3 | T3 | `feat(agent-policy): 役割 explore-lead と context-map を廃止し探索を explore へ直接委譲する` |
| 4 | T4 | `feat(agent-policy): レビュー役割を design-review と knowledge-elicitation へ改名する` |
| 5 | T5 | `feat(agent-policy): 敵対的レビューの役割 adversarial-review を追加する` |
| 6 | T6 | `feat(agent-policy): 実装 4 役割の振り分けを観測できる基準にし escalation の発火条件を定める` |
| 7 | T7 | `feat(agent-policy): アドバイザーへ相談する条件とオーケストレーターの相談規律を定める` |
| 8 | T8 | `feat(agent-policy): setup-agents の既定を 1 役割 1 定義にし --models を --recommended へ置き換える` |
| 9 | T9 | `docs(agent-policy): setup-agents の手順を役割単位の生成に書き換える` |
| 10 | T10 | `docs(agent-policy): README を 0.20 の役割構成に追随させる` |
| 11 | T11 | `chore(agent-policy): 0.20.0-dev` |
| 12 | T15 | `docs: Serena メモリを agent-policy 0.20 に追随させる` |

- すべてのメッセージの末尾に、セッションの指示にある Co-Authored-By の行を付ける。
- 本計画書と設計書は、ユーザー承認の後にコミット 1 の前で別にコミットする(`docs(agent-policy): 役割再編の設計書と実装計画書を追加する`)。
- 各コミットの時点で lint / typecheck / test が通る。コミットの前に `git status --short` を見て、本改修と無関係なファイルを含めない。

## 6. リスクと対処

| リスク | 対処 |
| --- | --- |
| T2-T5 の担当が最終形(16 件)の固定値を先取りし、そのタスクの時点でテストが落ちる | §4 の「タスクごとの役割集合」を依頼文へ転記し、完了時点の集合で書くよう明記する |
| T2 の担当が `_common.md` の Agent tool の制約の見出しを変え、節が合成結果から消える | 依頼文で見出しを変えないと明記する。`compose.test.ts` の検査が検出する |
| T2 の担当が「文書の執筆を委譲するとき」を丸ごと消し、GOTCHA-002 の対策が失われる | 依頼文に撤去する 3 項目を明示し、他は言い換えて残すと書く。T14 で確認する |
| T2 と T3 が `_common.md` の同じ節(§制約)を触る | T2 は L42 に触れず、T3 だけが L42 を直すと依頼文で限定する。直列のため同時編集にはならない |
| T4 の `git mv` と frontmatter の変更を別々に行い、途中で `compose.test.ts` の断片整合検査(ファイル名と id の一致)が落ちる | 同じタスクの中で両方を済ませる。タスクの完了時点で判定する |
| en の断片・`_common.md` に日本語が入る | 依頼文で明記する。`compose.test.ts:587` が検出する |
| T6 と T7 を並列に出し、`orchestration-discipline.md` の同じ箇所を触って衝突する | §3 のとおり触る節を限定する。限定できなければ直列にする |
| 規律の合計が 30,720B を超える | T6 / T7 で `wc -c` を記録し、T12 で判定する。超えたら止めて報告する |
| T8 の担当が既存ケースのヘルパーに `--scope custom` を焼き込み、scope を検査しているケースの意図を変える | 依頼文で「ケースごとに明示する。ヘルパーに焼き込まない」と書く |
| T8 の担当が個別経路の vendor 解決まで ModelSpec に変える | 依頼文で「個別経路は `resolveVendor` のまま」と書く。T13a の確認点 (4) |
| T9 の担当がウィザードの分岐条件だけを書き、「どう聞くか」を落とす | 依頼文で明記する(過去に 3 回起きた) |
| T16 で `disallowedTools` と MCP の付与が失われる | GOTCHA-001 の手順(T16 の 1・4・7) |
| T16 で旧 ID のマーカーを持つ定義を見落とし、対応表から役割が消える | T16 の 8 の grep で確認する |
| 敵対的レビュー定義の名前とモデルを確認しないまま T16 に着手する | §8 の対応表に従い、T16 の手順 6 の前にユーザーへ確認する |
| T2 の担当が `_common.md` の §制約(L34 以降)まで触り、T3 の L42 の変更と衝突する | T2 の依頼文に触る行と触らない行を ja / en それぞれで明記する |
| 規律の純増が 3,983B を超え、`custom-policy` の SKILL.md との合計が 30,720B を超える | §1 の手順(撤去の先行 → 条項の短縮 → 報告)。T6 / T7 / T12 で測る |
| T1b の担当が `live-models.test.ts` の `antigravity` の行を消し、推定が `unknown` に戻ったことが検査されなくなる | 依頼文で「行を消さず、期待値を `unknown` にする」と書く(設計書 §4.12) |
| T8 の担当が `RECOMMENDED` と一緒に `ASSIGNMENTS` も並べ替える | 依頼文で「`ASSIGNMENTS` は変えない」と書く。`discipline-role-table.test.ts` が担当表と `ASSIGNMENTS` の一致を検査するため、変えれば落ちる |
| T16 で `--recommended` を使い、既存の定義名と別に `<model-id>-<default-name>` の定義を作ってしまう | T16 の記述で個別経路に限定した。生成後に `ls .claude/agents` の件数が 14(document-writer を除き敵対的レビューを足した数)であることを確かめる |

## 7. 設計書との食い違い

計画立案時に検出した食い違いは、設計書 §3.3 に記録した 5 件(`setup-agents.ts` に MCP の役割列挙が無い、`recommendedRolesFor` の呼び出し元、`design-plan` 断片の削除対象の行、このリポジトリの定義の推奨外、依頼文に無かった検査と更新対象)である。いずれもオーケストレーターが記録どおりに扱うと決定した(2026-09-24)。実装中に見つけた食い違いは、次の形でこの節へ追記する。

| # | 検出タスク | 設計書の記述 | 実際 | 判断 |
| --- | --- | --- | --- | --- |

## 8. 未解決事項と着手の関係

設計書 §10 に残った項目が、どのタスクの着手を止めるかを示す。

| 設計書 §10 | 内容 | 止めるタスク |
| --- | --- | --- |
| 1 | このリポジトリに新設する敵対的レビュー定義の名前とモデル | T16 の手順 6(着手時にユーザーへ確認する) |

## 9. Done 条件

設計書 §11 に、本計画書で足した次の項目を加える。

- T0 の baseline と T12 の結果が記録されている。
- 各コミットの時点で lint / typecheck / test が通っている。
- `src/` を変えたコミット(1、1b、2-5、8、11)に `scripts/` の差分が含まれ、`assets/` と `references/` だけを変えたコミット(6、7)に `scripts/` の差分が無い。
- T13a / T13b の報告と T14 の突き合わせで見つかった食い違いが §7 に記録され、解消されている。
- T16 の前後の `diff -r` で、`disallowedTools` と MCP の行の削除が無い。
