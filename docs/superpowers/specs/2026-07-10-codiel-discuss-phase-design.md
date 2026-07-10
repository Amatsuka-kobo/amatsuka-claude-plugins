# Codiel discuss フェーズ導入 設計書

日付: 2026-07-10
対象: `plugins/codiel`

## 目的

Codiel の設計工程に、ユーザーとのディスカッション(ブレインストーミング)を常設フェーズとして
導入する。期待する効果は次の 4 つ:

1. **要件の曖昧さの対話的解消** — issue.md の「不明点」を ASK 裁定だけに頼らず、早い段階で対話的に潰す
2. **設計の方向性の共同決定** — 方針(案A/案B)の選択にユーザーの意見・好みを反映する
3. **設計書レビューの対話化** — design.md 完成後にユーザーとウォークスルーし、疑問点・修正を対話で反映する
4. **スコープ・優先度の合意** — 今回の run でやること/後続 Issue に回すことの線引きを設計前に握る

## 決定事項(ブレインストーミングでの合意)

| 論点 | 決定 |
|---|---|
| 発動条件 | **常に実施**。オプトインや条件発動にはしない |
| 実施主体 | **アジェンダ駆動型**。設計の思考(論点抽出・案の比較)は architect、対話の進行と記録はオーケストレーター、決定はユーザー |
| state 上の位置づけ | **新フェーズ `discuss`(非 GATED)** を init と design の間に新設。complete-phase で完了 |
| ウォークスルー | 独立フェーズにせず **design フェーズ内** の手順とする(state 変更を最小化) |
| Raguel ゲート | discuss にはゲートを置かない(triage と同じ「人間が直接参加するフェーズ」の扱い)。合意内容の検査は後続の `evaluate_design` が design.md と discussion.md の整合として担う |
| init ゲート | 従来どおり維持(Issue 解釈の品質検査として discuss と独立) |

## 原則の改定(DESIGN.md §1)

現行の「人間の固定承認ポイントは設けない。人間が介入するのは Raguel が ASK / STOP を出したときのみ」
を改め、**「設計工程は人間と共同で行う」**モデルに転換する。常設の人間参加ポイントは次の 3 つ:

1. **discuss フェーズ**(新設) — 要件・方向性・スコープの合意形成
2. **design ウォークスルー**(design フェーズ内) — 設計書の対話的レビュー
3. **triage フェーズ**(既存) — medium/low 指摘の起票指示

それ以外のフェーズは従来どおり完全自律(Raguel の ASK / STOP のみが介入契機)。

## フェーズ構成

```
[0] init → [1] discuss(新設) → [2] design → [3] test-spec ∥ dev-plan → [4] implement → …(以降は現行どおり)
```

### discuss フェーズ(3 ステップ)

1. **アジェンダ作成** — `codiel-architect` を新スキル `preparing-design-agendas` でディスパッチする。
   - 入力: `issue.md`、`docs/ARCHITECTURE.md`、`docs/GOTCHAS.md`、既存コードの調査(Read/Grep/Glob)
   - 出力: `try-<n>/agenda.md`。論点ごとに「背景 / 選択肢(2 つ以上) / トレードオフ / 推奨案」を列挙する
   - **issue.md の「## 不明点」は必ず論点に含める**(要件の曖昧さ解消をここで担保)
   - スコープの線引き(今回やる/後続 Issue に回す)が割れうる場合は、それ自体を論点にする
2. **ディスカッション** — オーケストレーターが新スキル `facilitating-design-discussions` に従い進行する。
   - 論点を一つずつ AskUserQuestion で提示する(選択肢+トレードオフ+推奨案を添える)
   - ユーザーが深掘りを求めた論点は通常ターンの自由議論に切り替える
   - **「すべて推奨案で進める」ショートカットを提示する**(常時実施でもテンポを保つため)。
     選択された場合は全論点に推奨案を採用として記録し、最終確認に進む
3. **合意の記録** — 合意事項を `try-<n>/discussion.md` に記録し、ユーザーに全体の最終確認をとってから
   `complete-phase` する。

### design フェーズの改修

- architect(`writing-design-docs`)の入力に `discussion.md` を追加する。
  **discussion.md の合意に反する設計は禁止**。合意から逸脱する必要が生じた場合は、design.md に
  書かずウォークスルーで論点として再提示する
- architect の執筆完了後、**オーケストレーターが design.md の要点をユーザーに提示する(ウォークスルー)**。
  - 修正要望があれば、要望を添えて architect を再ディスパッチし、再度ウォークスルーする
  - ユーザー承認後に `evaluate_design` → `pass-gate`(Raguel ゲートの位置・意味は不変)
  - ウォークスルーの修正往復に試行上限は設けない(人間がループ内にいるため暴走リスクがない)

## 成果物

```
.codiel/runs/<runId>/try-<n>/
  agenda.md        # 論点リスト(architect が執筆)
  discussion.md    # 合意記録(オーケストレーターが記録)
```

- いずれも文書系フェーズの成果物コミット規約に従い、**オーケストレーターがコミットする**
  (discuss は complete-phase 直後、agenda.md はディスカッション開始前でよい)
- PR に含まれるため、人間レビュアーが「なぜこの設計になったか」の合意の経緯を diff 上で追える

### agenda.md の書式

```markdown
# agenda: <issue タイトル>

## 論点 1: <論点名>

- 背景: <なぜこれが分岐点か。issue.md / ARCHITECTURE.md / 既存コードの根拠>
- 選択肢A: <概要> — トレードオフ: <...>
- 選択肢B: <概要> — トレードオフ: <...>
- 推奨: <A or B>。理由: <...>

## 論点 2: <issue.md の不明点由来の論点>
...
```

### discussion.md の書式

```markdown
# discussion: <issue タイトル>

## 論点 1: <論点名>

- 状態: 決定 | 未決
- 決定: <ユーザーが選んだ内容>
- 理由: <ユーザーの発言に基づく理由>
- 却下案: <却下された選択肢と理由>
```

- 各論点に「状態」を持たせる。**中断再開時は未決論点から対話を再開する**ための機構

## 責務分離と HARD-GATE

「オーケストレーターは自分で設計しない」(orchestrating-runs の HARD-GATE)との整合:

- `discussion.md` は**ユーザーの決定の記録**であって設計の執筆ではない。既存の `review-<n>.md`
  (reviewer 所見のオーケストレーターによる統合記録)と同じ「進行管理としての記録」に分類する。
  orchestrating-runs の HARD-GATE 節にこの分類を注記する
- 設計の思考(論点抽出・案の比較)は architect、決定はユーザー、記録と進行はオーケストレーター、
  という三権分立を保つ

新スキル `facilitating-design-discussions` に置く HARD-GATE:

- **合意の捏造禁止** — ユーザーが決めていないことを「決定」として記録しない。
  未決のまま先へ進む必要が生じたら「未決」として残し、ユーザーにその旨を明示する
- **アジェンダの改変禁止** — architect の選択肢・トレードオフを歪めて提示しない。
  オーケストレーター自身の意見で誘導しない(推奨案の出所は常に agenda.md)

## 変更ファイル一覧

| 対象 | 変更 |
|---|---|
| `skills/preparing-design-agendas/SKILL.md` | **新規**。architect 用: 論点抽出の基準(方針分岐・不明点・スコープ線引き)、agenda.md の書式、Red Flags(「論点を少なく見せる」「推奨案だけ書いて比較を省く」等) |
| `skills/facilitating-design-discussions/SKILL.md` | **新規**。オーケストレーター用: 論点の提示順序、AskUserQuestion と自由議論の使い分け、「すべて推奨案で」ショートカット、discussion.md の記録書式、最終確認、HARD-GATE(合意の捏造禁止・アジェンダの改変禁止) |
| `skills/orchestrating-runs/SKILL.md` | フェーズ進行表に discuss 行を追加(非 GATED・complete-phase)。design 行にウォークスルー手順を追加。チェックリスト・フローチャート更新。HARD-GATE に discussion.md の分類注記 |
| `skills/writing-design-docs/SKILL.md` | 入力に discussion.md を追加。「合意に反する設計の禁止」チェック項目。方針セクションは合意を参照する |
| `skills/raguel-gating/SKILL.md` | `evaluate_design` の objective に「discussion.md の合意との整合」を含める。init ゲートの objective に「不明点は後続 discuss フェーズで対話的に解消される」文脈を追加(不明点の存在だけを理由に ASK に倒れる必要がないことを Raguel に伝える) |
| `agents/codiel-architect.md` | 2 モード対応(preparing-design-agendas / writing-design-docs のどちらのスキルで動くかはディスパッチプロンプトで指定される旨を記載)。ツール権限は現行のまま(Read, Grep, Glob, Write) |
| `scripts/codiel-state.mjs` | フェーズ順序表に `discuss` を挿入(init の次)。GATED 集合には**入れない** |
| `hooks/scripts/guard-write.mjs` | `DOC_PHASES` に `discuss` を追加 |
| `hooks/scripts/stop-guard.mjs` | ブロックメッセージの正当停止の例示に discuss(論点回答待ち)とウォークスルー待ちを追記(機構は既存のまま。stop_hook_active による 2 回目通過で対応済み) |
| `hooks/scripts/subagent-stop.mjs` | discuss フェーズのアジェンダ作成ディスパッチに対する agenda.md の存在検証を追加 |
| `docs/DESIGN.md` | §1 原則改定、§2 フロー図に discuss 追加、§3 成果物ツリーに agenda.md / discussion.md 追加、§6 スキル表に 2 スキル追加、§10 ディレクトリ構成更新 |
| 各テスト(`codiel-state` / hooks の `*.test.mjs`) | フェーズ順序・DOC_PHASES の変更に追随 |
| `.claude-plugin/plugin.json` | マイナーバージョンアップ |

## 再開

- `state.phase = discuss` で再開した場合:
  - `agenda.md` が無い → アジェンダ作成(architect ディスパッチ)から
  - `agenda.md` が有り `discussion.md` が無い/未決論点が残る → 未決論点から対話を再開
  - 全論点が決定済み → 最終確認 → complete-phase
- design フェーズのウォークスルー途中で中断した場合は、design.md が存在するので
  ウォークスルーの再提示から再開する(state.phase = design のまま)

## エラーハンドリング

- ディスカッション中にユーザーが「この Issue 自体を進めるべきでない」と判断した場合は、
  通常の中止手順(`codiel-state stop --reason`)で run を停止する(discuss 固有の機構は設けない)
- ディスカッションの結果、issue.md の解釈自体が誤っていたと判明した場合は、discussion.md に
  その旨を記録して進める(design が discussion.md を正とする)。issue.md の書き直しのための
  init 差し戻しは行わない(フェーズ逆行は state 機構が許さないため、正誤の優先順位で解決する)

## テスト

- `codiel-state.mjs`: discuss を含むフェーズ順序の遷移テスト(init → discuss → design の強制、
  discuss の complete-phase、GATED でないことの検証)を既存テストの様式で追加
- `guard-write.mjs`: discuss フェーズ中の `.codiel/**` 書き込み許可・コード領域書き込み ask のテスト追加
- スキル(SKILL.md)は宣言的文書のため自動テスト対象外(現行方針どおり)

## 非スコープ

- `/codiel:test` への影響なし
- reviewer / implementer / test 系フェーズの変更なし(reviewer-doc の検査観点に
  「design.md と discussion.md の整合」を一行追加するのみ)
- raguel-mcp 本体(評価ルール・ツール)の変更なし
