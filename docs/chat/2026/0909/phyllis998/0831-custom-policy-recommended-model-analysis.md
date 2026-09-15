# agent-policy: custom-policy推奨モデル列の検証

- 日付: 2026-09-09
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 分析・検証結果(設計への入力)
- 前提: `plugins/agent-policy/references/orchestration-discipline.md`、`plugins/agent-policy/skills/custom-policy/SKILL.md`、`harness-docs/design/2026-08-31-agent-policy-two-profile-design.md`
- セッション ID: 090dab89-e042-4e6e-a7f3-57c1bc8e5c89

---

## セッション 1: custom-policy推奨モデル列の必要性を検証

# phyllis998

> 現在agent-policy:custom-policyは、setup-agentsで生成するエージェントの推奨モデル担当表を持ちます。これが必ずここに記載される意味があるのかどうか調査・分析してください

# AI

調査開始。まず規律スキルと Serena マニュアルを読む。

調査対象を並列で読む。

## 結論

custom-policy の推奨モデル列は、オーケストレーターの挙動を一切変えない。残す根拠は「人間向け参考」と「正本との同期テスト」だけで、どちらも SKILL.md に置く必然性なし。帯名の列は必須、推奨モデル列は削除可。

## 根拠

**1. 実行時、誰も推奨列を読まない**

- 委譲先の解決順(`skills/custom-policy/SKILL.md:44-45`)は 2 段。手順 1 = マーカー対応表、手順 2 = `claude-model-policy` の同帯モデルへ読み替え。推奨列はどちらにも登場しない。
- セッション途中の不達規定(同 L76-77)も読み替え先は claude 表。推奨列は不使用。
- `model` 上書きは enum 限定(`references/orchestration-discipline.md:39`)。`GPT Sol` 等の推奨値はそもそも dispatch に渡せない。
- 本文自身が「委譲先を拘束しない」「推奨から外れる構成も有効」(L14, L35)と宣言。規律として無効化済み。

**2. 「構成を作るときの参考」は別経路で満たされている**

- 構成を作るのは `setup-agents`。推奨の出典は `src/agents/policies.ts:149` の `RECOMMENDED`。
- CLI が `recommendedFor`(`--list-live-models`)と役割ごとの `models`(`--list-coverage`)で利用者へ提示(`src/setup-agents.ts:691, 820`)。
- setup-agents の対話中、オーケストレーターは custom-policy をロードしない(custom-policy は実務タスク着手前に読む方針スキル)。SKILL.md の表は setup 時に参照されない。

**3. 残存コスト = 二重管理**

- `src/agents/__test__/policy-skill-assignments.test.ts` が SKILL.md の表を `RECOMMENDED` と 16 行一致でピン留め。使われない列を同期するためだけのテスト。
- 2026-08-31 設計 §4.2 は同梱プリセット廃止の根拠に「担当表(推奨)との一致維持という二重管理」を挙げた(L134)。同じ論理が推奨列自身に当てはまる。
- パーサは節内のバッククォート語を全てモデル名として解釈(未知語で throw)。節の散文編集に制約。
- スキル本文規律(`prompt-smith`: 挙動を変える文だけ残す)に照らし、「参考」列は本文に置く種類の情報でない。

**4. 帯名の列は必須**

- 共通規律は「担当表 = 方針の §役割の帯と推奨モデル の表」「帯は行名で参照」(`orchestration-discipline.md:5`)。Agent Tool 禁止 6 帯、合成対象 15 帯、独立レビュー手順はすべて行名で参照。表の骨格は残す。

## 副次的発見

手順 2 の読み替えは「`claude-model-policy` の同帯モデル」を要求するが、custom セッションではそのスキル未注入。オーケストレーターが Skill tool で追加ロードする前提。推奨列を削っても状況不変、置き換え案 B なら解消。

## 案

**推奨: 案 A**。承認済み設計「担当モデル列は持たない」と整合、二重管理解消。

判断軸: 設計との整合 / 二重管理 / 手順 2 のギャップ解消 / 変更量。

- **案 A: 推奨列削除、帯名(+RoleId)のみ** — 設計整合◎。二重管理消滅。テストは帯名 16 行一致へ縮退。人間向けの役割→推奨モデル表は `README.md` に追加(現状 README は役割 ID 表とモデル ID 表を別々に持ち、対応を欠く)。手順 2 ギャップは残る。
- **案 B: 推奨列を「対応表に無いときのモデル」(`ASSIGNMENTS`)へ置換** — 列が手順 2 と不達規定の実体になり挙動を変える。ギャップ解消。ただし設計の「担当モデル列は持たない」に反する→ユーザー判断要。テストは `ASSIGNMENTS` ピンへ変更。
- **案 C: 現状維持** — 変更量ゼロ。二重管理とテスト制約は継続。

案 A の影響ファイル: `skills/custom-policy/SKILL.md`、`policy-skill-assignments.test.ts`、`README.md`、`orchestration-discipline.md:5` の節名参照(見出し変更時)、設計書 2026-08-31 §4.2 への追記、Serena メモリ `agent_policy/core`。

`★ Insight ─────────────────────────────────────`
- 正本 `RECOMMENDED` は CLI 経由で利用者へ届く。SKILL.md の写しは「AI が読む文書に人間向け情報を置いた」形。
- 指示書の表は行名が参照キー。列を削っても行名を保てば下流規律は無傷。
`─────────────────────────────────────────────────`

調査結果は上記のとおり。案 A / B / C のどれで進めるか判断待ち。

## セッション 2: 推奨モデル列削除案のgrok独立レビュー依頼

# AI

案 A / B / C の判断待ち。

# phyllis998

> 本当にその案が有効なのか、grokにレビューさせてください

# AI

grok-docs-reviewer へ独立レビューを dispatch 済み。完了通知待ち。

Grok レビュー実行中。完了通知待ち。

## セッション 3: 帯カタログを共通規律へ移設する案 G の検討

# AI

Grok レビュー継続中。完了通知待ち。

## Grok レビューの採否

Grok(grok-docs-reviewer)の指摘 10 件を突き合わせた。結論の骨格は維持、ただし 3 点を訂正。

**採用(分析の訂正)**

- **「挙動を一切変えない」は過大** → 訂正。custom-policy は SessionStart が必ずロードさせるため、推奨列は毎セッションのプロンプトに載る。未割当帯の手順 2(claude 表へ読み替え)と、同帯複数定義の選択で、推奨列(例: 通常の実装 `Sonnet / GPT Luna / Grok`)が claude 表(`Sonnet` のみ)の超集合として競合信号になる。削除理由は「無効果」ではなく「競合信号の除去」。
- **案 A も設計を覆す** → 訂正。2026-08-31 設計 §4.2「担当表は帯 + 推奨モデル列のみ」、§5.1「RECOMMENDED は推奨列の正本」、2026-09-07 決定 11「2 行とも Opus のみ」は列の存続が前提。A も B も設計更新が要る。覆さないのは C だけ。
- **パーサ範囲** → 訂正。未知語 throw は表の第 2 セル内のみ。散文の箇条書きは対象外。ただし列削除時はパーサ改修必須(第 2 セル欠落で行スキップ→16 行一致が全滅)。

**採用(補足)**

- README 移設は規約上の必然でない。推奨は setup-agents ウィザードが CLI で出す。README に足すと新たな二重管理。
- 手順 2 のギャップ(claude-model-policy 未注入)は事実。かつ推奨列の存否と独立の問題。

**不採用**

- 「二重管理は設計が選んだ契約であり事故でない」→ 事実として正しいが、契約であっても「読者(オーケストレーター)に不要な情報」の判断は覆らない。設計を更新すれば済む。

## 改訂した案

推奨: **案 D + F**。

判断軸: 競合信号の除去 / 二重管理 / 手順 2 ギャップ / 設計更新の要否。

- **案 D(A の改良)**: SKILL.md から推奨列を削除、README にも移さない。正本は `RECOMMENDED` と CLI のみ。競合信号◎、二重管理◎(テストは帯名一致へ縮退+パーサ改修)。設計更新要。
- **案 F(D と併用)**: 手順 2 の読み替え先を custom-policy 本文に書き、claude-model-policy の追加ロード不要にする。ギャップ解消。列問題と独立に実施可。
- **案 B**: 推奨列を ASSIGNMENTS へ置換。ギャップ解消するが「担当モデル列は持たない」を覆す。D+F で同じ効果を列なしで得られるため劣後。
- **案 C**: 現状維持。競合信号と二重管理が残る。

案 D+F の影響: `custom-policy/SKILL.md`(列削除・L14 段落・手順 2 本文)、`policy-skill-assignments.test.ts`(パーサ)、`orchestration-discipline.md:5`(節名参照)、設計書 2 本への改訂追記、Serena メモリ `agent_policy/core`、README 変更なし。

進めるなら設計書更新→実装の順。着手判断待ち。

# phyllis998

> 推奨モデル列が必要かどうかの前に、担当表が必要かどうか、共通規律を書き換えることはできないかを見てください

# AI

## 結論

担当表(帯カタログ)は custom-policy に不要。共通規律へ移せる。推奨列問題は消滅。

## 現状の構造

**帯名の正本は既に SKILL.md でない**

- 帯名の正本: `src/agents/roles.ts` の `ROLES[].label`。マーカー対応表(`marker-scan.ts:143`)、delegation-gate、setup-agents すべてここから帯名を出す。
- 共通規律は帯名を既に全部持つ: 合成対象 15 帯(`orchestration-discipline.md:55`)+「その他のタスク」= 16 帯。Agent Tool 禁止 6 帯(L25)。上流フロー(L94-110)。
- 規律 L5 だけが「担当表 = 方針スキルの表」と外部参照。この 1 行が表を SKILL.md に縛る。

**custom-policy の表が担う実効機能 = 帯名の列挙のみ**。推奨列は前回分析どおり競合信号。帯名列挙は規律が既に持つ。

**3 文書間の重複(挙動を変える規律が 3 箇所)**

- Agent Tool 禁止 6 帯: 規律 L25、custom L36、claude L33。
- 読み取り帯を実装定義へ委譲する文言: 規律 L81、custom L59-61、claude L35-37、subagent-discipline L10。
- 独立レビュー手順(原本のみ・指摘を渡さない・採否はオーケストレーター): 規律 L108-110、custom L63-71、claude L39-46。

`prompt-smith` 規律(同じ規律を複数の指示書に書かない)違反が既にある。2026-09-07 設計は「宣言は規律 1 箇所」を決定したが、表と重複規律は残した。

## 案

**推奨: 案 G**。判断軸: 単一正本 / 重複削減 / claude プロファイルへの影響 / 設計更新量。

- **案 G: 帯カタログを共通規律へ移し、方針スキルは差分だけ持つ**
  - 規律 L5 を「担当表 = 本文書の §役割の帯 の表」に書き換え。表は 16 帯 × (帯名 / RoleId / 種別 impl・readonly / Agent Tool 可否)。`ROLES` と一致をテストで固定(`kind` と `SOLO_DENIED_ROLES` も突き合わせ可)。
  - 重複規律 3 種を規律へ一本化。両 SKILL.md から削除。
  - custom-policy に残るもの: 実行帯の解決順(手順 1-2 + 独立レビュー例外)、セッション途中の不達、`model` 上書き禁止。表なし。約 2KB。
  - claude-model-policy に残るもの: 帯→モデル表(規律の帯名を参照)、解決順。モデル拘束が本体→表は残す。
  - 単一正本◎、重複◎、claude 影響: 表の帯名列は規律参照へ。設計更新: 2026-08-31 §4.2、2026-09-07 §4.5 L5 定義と決定 4 の拡張。
- **案 D: 推奨列だけ削除(前回案)** — 表は残る。重複 3 種は残る。設計更新は同程度。G の部分集合。
- **案 H: custom-policy 廃止、規律+マーカー表のみ** — 解決順と不達規定の置き場が規律内「custom のとき」節になり、claude 利用者が読む規律が増える。SessionStart の注入対象も変更。劣後。
- **案 C: 現状維持** — 重複と競合信号継続。

**案 G の影響ファイル**: `references/orchestration-discipline.md`、両 `SKILL.md`、`policy-skill-assignments.test.ts`(custom 側は規律の表 vs `ROLES` へ差し替え)、`context-map-guide.md:12`(用語不変・要確認のみ)、設計書 2 本の改訂、`README.md`(役割表は既にある・変更小)、Serena メモリ `agent_policy/core`。hooks のコード変更なし(`担当表の帯` の文言は規律に表が移っても成立)。

**規律サイズ**: 12.5KB → 約 13.5KB。30KB 転記規則の範囲内。

`★ Insight ─────────────────────────────────────`
- 規律 L5 の「読み込んだ方針の表を指す」は 2 プロファイルの表を抽象化する間接参照。プロファイル差分がモデル列だけになった今、帯カタログを規律に置けば間接参照そのものが不要。
- `ROLES` が帯名正本なら、指示書の表は `ROLES` 由来の写しであるべき。写しは 1 箇所(規律)に限れば二重管理は 1 本のテストで済む。
`─────────────────────────────────────────────────`

案 G で設計書作成へ進むか判断待ち。

案 G の採否判断待ち。

## セッション 4: 案 G 採択、帯カタログ統合設計書の作成を開始

# AI

案 G の採否判断待ち。

# phyllis998

> 案Gで進めてください

# AI

system-planner へ設計書執筆を dispatch 済み。完了後、haiku-reviewer → grok-docs-reviewer の順でレビューし、採否判断してから提示する。完了通知待ち。

設計書執筆中。完了通知待ち。

## セッション 5: 並列レビュー手順確認と設計書執筆開始

# AI

設計書執筆中。完了通知待ち。

# phyllis998

> haikuレビューと独立レビューは並行して回せるはずです

# AI

了解。独立レビューは原本のみ読む(他レビューの指摘を渡さない)ため逐次依存なし。設計書完成後、両レビューを 1 メッセージで並列 dispatch する。

設計書はまだ執筆中。完了通知待ち。

設計書執筆中。完了通知待ち。

## セッション 6: 帯カタログ統合設計の承認と実装計画の開始

# AI

設計書執筆中。完了通知待ち。

設計書完成。両レビューを並列 dispatch。

設計書完成: `harness-docs/design/2026-09-09-agent-policy-band-catalog-consolidation-design.md`。haiku-reviewer と grok-docs-reviewer を並列 dispatch 済み。両完了後に採否判断→提示。

設計中の主要判断(system-planner 報告):
- 用語「担当表」維持。定義文のみ規律の表へ変更→`.ts` 変更 0 行
- subagent-discipline は残す(SubagentStart 配布物、サブエージェントは規律を読まない)
- 要件 7 は (a) 採用: ギャップが 3 箇所(custom L45 / 規律 L39 / custom L76)→両 SKILL の表消滅、規律 1 表に集約
- 規律 12.5KB→約 13.7KB。claude セッション総量は減少

未解決 5 件はレビュー後にまとめて提示。

Haiku レビュー受領。Grok 独立レビュー完了待ち。両者揃ってから採否判断して提示。

両レビュー受領。採否判断→system-planner へ設計書改訂を依頼。

両レビュー受領→採否確定→system-planner へ改訂を依頼済み。改訂完了後にユーザーへ提示。

**採否の概要**

採用(設計書訂正):
- §1.3 の要件 6 / 7(a) 矛盾 → 7(a) 採用で確定
- 未解決 5 件のうち 11-1(claude L34 規律へ引き上げ)、11-3(`_common.md` ja「担当表」→「対応表」)、11-4(context-map-guide L12「最終レビュー」削除)を採用。11-2 は残す、11-5 は運用課題
- Grok 反証: 上書き表の漏れ 3 件、既存パーサ流用不可(第 2 セルが RoleId で throw)、サイズ実測値(規律 14,149 B / 3 本 21,243 B)、影響ファイル漏れ 4 件(ルート README L112、custom description、plugin README L45、`policies.ts` コメント 2 行)、Serena メモリ現況の誤記

不採用:
- 列名のベンダー中立化(列の意味は「対応表に無いときの Claude モデル」で正確)
- 括弧書き削除の情報損失

改訂完了通知待ち。

設計書第 2 版完成。要点を自分で確認してから提示。

設計書第 2 版を確認済み。提示。

## 設計書

`harness-docs/design/2026-09-09-agent-policy-band-catalog-consolidation-design.md`(第 2 版、約 87KB)

## 変更の骨子

**共通規律 `orchestration-discipline.md`**
- L5 定義文「担当表 = この文書の §役割の帯 の表」。直後に 16 行 × 5 列表(帯名 / RoleId / 種別 / Agent Tool / Claude モデル)新設
- Agent Tool 6 帯列挙 → 表の列参照。合成対象 15 帯列挙 → 「その他のタスク」除く全帯
- 委譲時の帯明示 + Output Format 指定、読み取り帯の委譲文言、独立レビューの「反証まで・採否はオーケストレーター」を規律へ一本化
- L39 の読み替え先を「担当表の Claude モデル列」へ。claude-model-policy 名指し消滅

**両 SKILL.md**
- 表・Agent Tool 6 帯・読み取り帯文言・独立レビュー手順節をすべて削除
- claude: 1,655 B(解決順のみ)。custom: 3,942 B(解決順 + 例外 + dispatch 規律 + 不達規定)
- custom description 冒頭「役割の帯だけを担当表に持ち」→「役割マーカーで解決する構成での」

**付随**
- `ja/_common.md` L14「担当表」→「対応表」、`context-map-guide.md` L12「・最終レビュー」削除
- `policies.ts` コメント 2 箇所のみ変更。振る舞い変更 0 行、hooks 無変更
- README 2 本、バージョン `0.17.0-dev`、Serena メモリ

**テスト**
- 新設 `discipline-role-table.test.ts`: 規律の表を `ROLES` / `allowsAgentTool` / `ASSIGNMENTS` と 5 列突合 + 両 SKILL に表が無い negative test
- 旧 `policy-skill-assignments.test.ts` 削除。既存パーサ流用不可(第 2 セルが RoleId で throw)→新パーサ仕様 8 項

**サイズ実測**: 規律 14,149 B、references 3 本 21,243 B(上限 30,720 B)。セッション総量は両プロファイルとも減少

## レビュー採否の要点

- Haiku: 要件 6/7(a) 矛盾の確定方法 → §1.3 と §3.1 にオーケストレーター決定として明記
- Grok: 上書き表の漏れ 3 件追加、パーサ流用不可、サイズ実測、影響ファイル 4 件追加、Serena メモリ現況訂正
- 私の指示の誤り 1 件: 「`ja/_common.md` 変更で翻訳断片が stale になる」→ system-planner が `fragments.ts` L209-212 で反証。翻訳元は常に `en` 断片、ja 変更は波及しない。§10 に却下根拠付きで記載

## 未解決 1 件

推奨列廃止の運用上の実効は未計測。運用後に観測。

承認なら実装計画書(WBS)へ進む。

# phyllis998

> 承認します

# AI

承認受領。実装計画書(WBS)を system-planner へ依頼。

実装計画書を system-planner へ依頼済み。完了後、haiku-reviewer と grok-docs-reviewer を並列でレビュー→採否→提示。完了通知待ち。

実装計画書執筆中。完了通知待ち。

## セッション 7: 実装計画書完成・両レビュー・T1 着手

# AI

実装計画書執筆中。完了通知待ち。

実装計画書完成。両レビューを並列 dispatch。

実装計画書完成: `harness-docs/plans/2026-09-09-agent-policy-band-catalog-consolidation-implementation.md`。17 タスク・6 フェーズ。haiku-reviewer と grok-docs-reviewer を並列 dispatch 済み。

計画中の発見: 「軽量な実装」「コードベース探索実働」は `Skill` tool を持たない(`roles.ts`)→ prompt-smith をロードする 6 タスクは「通常の実装」へ寄せた。

両レビュー完了後に採否→提示。

Haiku レビュー受領。Grok 独立レビュー完了待ち。

両レビュー受領。採否確定→計画書改訂を依頼。

採否確定→system-planner へ計画書改訂を依頼済み。

**採用 15 件の要点**
- フェーズ 1 完了条件の誤り(検査 9-10 と正常系は合成入力で T1 時点から緑)
- T4 の転記範囲を frontmatter 以下に限定(設計書 §7.8 全文は frontmatter を含み T11 と衝突)
- T16 → T17 順序でメモリ項の Done 判定を T17 へ
- T13 は機械コマンドのみ、残りを T16 チェックリストへ。`git status` 追加(新テストは untracked)
- 検査 11-12 の見出し判定を行頭一致に(変更後本文が「§役割の帯」を含む)
- `scripts/` 差分は 0 が正常(esbuild は通常コメント非出力)
- `MODEL_IDS` は非 export→コピー必須
- prompt-smith の評価工程省略を依頼文に明記

**不採用 3 件**: リスク表の重複整理、散文一致の自動化、T11 発火測定の判定フロー

改訂完了通知待ち。

実装計画書第 2 版完成。提示。

## 実装計画書

`harness-docs/plans/2026-09-09-agent-policy-band-catalog-consolidation-implementation.md`

## WBS(17 タスク・6 フェーズ)

- **フェーズ 1(直列)**: T1 新テスト `discipline-role-table.test.ts`(検査 1-12、新パーサ 8 項)。完了条件: 1-8 と 11-12 が赤、9-10 と正常系が緑
- **フェーズ 2(並列 4)**: T2 規律改訂 / T3 claude SKILL / T4 custom SKILL 本文(frontmatter 不可触) / T5 旧テスト削除。4 件揃ってからオーケストレーターが `pnpm run test` 1 回で全体 green 判定
- **フェーズ 3(並列 3、フェーズ 2 と統合可)**: T6 context-map-guide L12 / T7 `ja/_common.md` L14 / T8 `policies.ts` コメント 2 箇所
- **フェーズ 4(並列 3)**: T9 plugin README / T10 ルート README / T11 custom description(skill-creator)
- **フェーズ 5(直列)**: T12 バージョン `0.17.0-dev` + build(`scripts/` 差分 0 が期待値)
- **フェーズ 6**: T13 機械検証 / T14 コードレビュー / T15 ARCHITECTURE 影響確認(並列 3)→ T16 最終突き合わせ → T17 Serena メモリ

**帯割当**: prompt-smith をロードする 5 タスクは「通常の実装」。テスト・README・バージョンは「軽量な実装」(Agent 不使用を依頼文で明記)。

## レビュー採否(15 採用 / 3 不採用)

Grok が実装を止める強度と判定した 3 件を含め採用済み: フェーズ 1 完了条件の誤り、T4 の frontmatter 転記衝突、T16 が未実施の T17 を Done 判定する問題。他: 見出し判定の行頭固定、`MODEL_IDS` コピー、`git status` 追加、prompt-smith 評価工程省略、サイズ判定 ±1,000 B。

承認なら実装着手。

# phyllis998

> 承認します

# AI

承認受領。実装着手。まず計画書 §5(共有契約)と T1 を読む。

T1 を「複雑または重要な実装」= gpt-sol-lead-implementer へ dispatch。

T1 完了待ち。フェーズ 2〜3 は T1 の赤確認後に 7 並列で dispatch(計画書が統合を許容)。T1 完了通知待ち。

T1 実装中。完了通知待ち。

## セッション 8: 「帯」から「役割」への用語置換提案と影響分析

# AI

T1 実装中。完了通知待ち。

T1 完了。期待どおりの赤/緑。フェーズ 2+3 を 7 並列で dispatch。設計書の変更前後全文を依頼文へ転記する。

T1 完了(赤/緑内訳が期待どおり)。フェーズ 2+3 の T2〜T8 を 7 並列 dispatch 済み。全完了後に `pnpm run test` で全体 green 判定→フェーズ 4 へ。

T6 完了。残り 6 タスク実行中。

T6・T7 完了。残り 5 タスク実行中。

T8 完了。lint の 4 件は metatron の既存 info(T1 も報告済み、本改修と無関係)。baseline で確認する。

T2 完了。13 検査全 pass の報告→T3/T4 も既に適用済みの可能性。lint 4 info は既存(metatron、exit 0)。T3/T4/T5 完了待ち。

T5 完了。T3/T4 完了待ち。

T4 完了。T3 完了待ち。

T2〜T8 全完了(T3 の 1 件失敗は T4 前の時点の観測。T4 完了後は 13 件 pass)。フェーズ 2+3 完了判定を実行。

全体 green(2172 pass、baseline 2163 → +13 −4 = +9 で整合)。フェーズ 4 を 3 並列 dispatch。

フェーズ 2+3 完了。全体 green(2172 pass、baseline +9 = 新 13 − 旧 4 で整合)。フェーズ 4(T9/T10/T11)を 3 並列 dispatch 済み。

T10 完了。T9/T11 完了待ち。

T9・T10 完了。T11 完了待ち。

フェーズ 4 完了。フェーズ 5(T12)へ。

フェーズ 4 完了(T9/T10/T11)。T12(バージョン + build)dispatch 済み。完了後、フェーズ 6(T13 自分 / T14 code-reviewer / T15 探索実働)を並列。

T12 実行中。完了後フェーズ 6 へ。

T12 完了(差分 0 期待どおり)。フェーズ 6: T14/T15 を並列 dispatch、T13 は自分で実行。

T13 完了。全項目 green:

- lint: 4 info(metatron 既存、exit 0)/ typecheck OK / test 2172 pass
- `scripts/` 差分 0(期待どおり)
- `src` 差分: 旧テスト削除 + `policies.ts` コメント 2 箇所 + 新テスト untracked。振る舞い変更 0 行
- references 3 本合計 21,372 B(見込み 21,243 ± 1,000 内、上限 30,720 内)。規律 14,299 B
- バージョン両方 `0.17.0-dev`

T14(コードレビュー)/ T15(ARCHITECTURE 影響)完了待ち。その後 T16 最終突き合わせ → T17 メモリ更新。

T14/T15 完了待ち。

T14/T15 完了、指摘なし。T16 最終突き合わせ: 全差分を自分で読む。

T16: 文書差分全件を突き合わせ、設計書 §7 の変更後全文と一致。新テスト本文と Serena メモリを読む。

T16 完了、食い違いなし。T17: Serena メモリ更新。対象箇所を読む。

T17 完了。最終確認: 変更ファイル一覧と、本改修の差分に限定した状態。

## 実装完了

案 G(帯カタログを共通規律へ集約)の全 17 タスク完了。未コミット。

**Done 条件の検証結果**
- lint: 4 info(metatron 既存、本改修対象外)/ typecheck: OK / test: 2172 pass(baseline 2163 + 新 13 − 旧 4)
- `src` 差分: 振る舞い変更 0 行、`policies.ts` コメント 2 箇所、旧テスト削除、新テスト追加
- `scripts/` 差分: 0(期待どおり)
- バージョン: `plugin.json` / `package.json` とも `0.17.0-dev`
- references 3 本合計 21,372 B(見込み ±1,000 内、上限 30,720 B 内)
- コードレビュー(T14): 指摘なし。設計書変更後全文との一致を確認
- ARCHITECTURE 影響(T15): なし。ADR-001 と矛盾なし
- Serena メモリ `agent_policy/core` 更新済み

**変更ファイル**
- 規律: `references/orchestration-discipline.md`(§役割の帯 新設、重複規律 3 種を一本化)
- SKILL: `claude-model-policy`(1,359 B)/ `custom-policy`(3,786 B、description 改稿含む)
- 付随: `context-map-guide.md` L12、`ja/_common.md` L14、`policies.ts` コメント
- README 2 本、バージョン 2 ファイル
- テスト: `discipline-role-table.test.ts` 新設、`policy-skill-assignments.test.ts` 削除
- 文書: 設計書・実装計画書(harness-docs)

**未コミット差分に含まれる無関係ファイル**: `.raphael/`(抗体 synthesizer が生成)、`docs/chat/`、`docs/prompts/`、`cliproxyapi.config.example.yaml`。コミット時は分離要。

**注意点**: 規律 §役割の帯 の変更は次セッションから有効。現セッションのオーケストレーター(私)は旧 SKILL を読んだ状態で動作中。

コミットするなら指示を。

実装完了(前回報告のとおり)。コミット指示待ち。

実装完了済み。コミット指示待ち。

Synthesizer 1 件が既に実行中(前ターン起動)。その完了で 3 件は処理される見込み。重複起動を避け、完了を待つ。

蒸留完了(16/16)。実装完了済み、コミット指示待ち。

# phyllis998

> "帯"という言葉が日本語的に意味がわかりずらいため、別の言葉に言い換えたいです。"役割ラベル"などにできませんか？

# AI

用語変更の影響範囲を調査。

## 結論

可能。ただし「役割ラベル」は既存語と衝突するので、推奨は **「役割」単独 + 必要箇所だけ「役割名」**。

## 現状の用語構造

`ROLES` の実体は 3 つ。文書側の「帯」はこれらの総称。

- `id`(`complex-impl` 等)→ 文書では「RoleId」「役割 ID」(19 箇所)
- `label`(「複雑または重要な実装」等)→ 文書では「帯名」「役割名」(5 箇所)
- `kind`(`impl` / `readonly`)→ 「種別」

「帯」出現: agent-policy 内 20 ファイル・約 90 箇所。うち `src/*.ts` の実行文字列 2 箇所(hooks 注入文)、コメント 5 箇所、テスト名 20 箇所前後。

## 案

**推奨: 案 1「役割」**。判断軸: 既存語との衝突 / 置換後の日本語の自然さ / 変更量。

- **案 1「役割」**: 「役割の帯」→「役割」、「帯名」→「役割名」、「その帯の定義」→「その役割の定義」、「実行帯の解決順」→「実行役割の解決順」。既存の「役割 ID」「役割名」「役割マーカー」「役割断片」と体系が揃う。衝突なし。自然さ◎。
- **案 2「役割ラベル」**: `label`(帯名)を指す語としては正確。だが「帯」は `id` / `label` / `kind` の総称であり、「役割ラベルの委譲先」「役割ラベルに対応する定義」は `label` 文字列に委譲する意味に読める。`ROLES[].label` との混同要。不採用推奨。
- **案 3「役割区分」**: 総称としては正確。「役割区分の解決順」は硬い。案 1 で十分。

## 影響範囲(案 1)

- 規律・両 SKILL・README 2 本・context-map-guide・テンプレート・`plugin.json` description: 散文置換
- `src/hooks/marker-scan.ts:208` / `delegation-gate.ts:329`: 注入文字列 2 箇所 → テスト 4 本の期待値追随
- `src/agents/policies.ts` コメント 5 行、新テストのメッセージ・`describe` 名・見出し正規表現(`^## 役割の帯` → `^## 役割`)
- `assets/roles/ja/{_common,escalation}.md` → 生成済み `.claude/agents/*.md` 8 本は再生成まで旧文言(動作影響なし)
- `plugins/prompt-smith/skills/agent-creator/SKILL.md:43`「実行帯」1 箇所
- 設計書・計画書 2 本(承認済み、編集しない方針なら用語注記を追加)
- Serena メモリ

**注意**: 規律の見出し `## 役割の帯` → `## 役割` に変えると、新テストの見出し検査と両 SKILL の「§役割の帯 にある」参照を同時に変える必要あり(テストが固定)。

**今回の改修(0.17.0-dev 未コミット)に含めるか、別改修にするか**。含めるなら設計書へ用語決定を 1 節追記して実装。指示待ち。

用語案の判断待ち(案 1「役割」推奨。今回改修に含めるか別改修かも併せて)。

## セッション 9: 用語統一「帯」→「役割」を別改修に分離決定

# phyllis998

> 別改修にしてください

# AI

了解。用語変更は別改修。次回のために要望をメモリへ保存。

用語変更を別改修としてメモリに記録済み(推奨案「役割」、影響範囲付き)。

現状: 0.17.0-dev 改修は実装完了・未コミット。コミットするなら指示を。

コミット指示待ち。

## セッション 10: 用語改修(帯→役割)を dispatch・メモリ削除・コミット完了

# phyllis998

> メモリに保存せず、コミット後にこのセッションで対応してください

# AI

了解。メモリ削除→コミット→用語改修をこのセッションで。

15 ファイル stage 済み(無関係な chat / raphael / proxy 設定は除外)。コミット。

コミット `a01c39d` 完了。用語「役割」で確定。本改修は用語置換のみで設計判断が単純なため、影響箇所の全件を洗い出してから実装する。

コミット `a01c39d` 完了(15 ファイル)。メモリ削除済み。

用語改修(帯→役割、0.17.1-dev)を「複雑または重要な実装」へ dispatch 済み。対象: 規律・SKILL 3・断片 2・テンプレート・hooks 注入文字列 2・テスト 7・README 2・plugin.json・agent-creator SKILL。完了後、コードレビュー→Serena メモリ更新→コミット。

用語改修実装中。完了通知待ち。
