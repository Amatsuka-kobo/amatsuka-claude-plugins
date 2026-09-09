# agent-policy 帯カタログの共通規律への集約と重複規律の一本化 設計書

- 作成日: 2026-09-09
- 対象プラグイン: `plugins/agent-policy`
- 現行バージョン: `0.16.0-dev` → `0.17.0-dev`
- 状態: 設計(実装前・第 2 版。第 1 版へのレビュー結果の採否をオーケストレーターが確定させ、反映済み)
- 関連: `harness-docs/design/2026-09-07-agent-policy-orchestrator-analysis-design.md`(上流 2 帯のサブエージェント化)、`2026-08-31-agent-policy-two-profile-design.md`(2 プロファイル化)

## 1. 上書きする決定

本設計は、既存の設計書 2 本で確定した決定のうち次を**明示的に上書きする**。既存の設計書そのものは編集しない。上書きの記録はこの節が正本である。

### 1.1 `2026-08-31-agent-policy-two-profile-design.md`

| 箇所 | 元の決定 | 本設計の決定 | 根拠 |
| --- | --- | --- | --- |
| §4.2 L99 | 「**担当表は帯(RoleId 10 種)+ 推奨モデル列のみ。** 担当モデル列は持たない」 | custom-policy は担当表そのものを持たない。帯のカタログは共通規律 `references/orchestration-discipline.md` の §役割の帯 に 1 つだけ置く。推奨モデル列は SKILL.md から消し、どこにも移さない | 推奨列は実行コードから一切読まれないのに、custom セッションでは SessionStart で必ずプロンプトへ載る。未割当帯の読み替え(手順 2)と同帯複数定義の選択のとき、`claude-model-policy` の担当表の超集合として競合信号になる。カタログを 2 箇所に置く費用に見合う便益が無い |
| §5.1 L160 | 「`RECOMMENDED` は setup の推奨マークと **custom-policy スキルの推奨列の正本**になる」 | `RECOMMENDED` は setup-agents だけの正本とする。`RECOMMENDED` 自体は残す(`src/setup-agents.ts` L179 / L185-190 / L208 / L691-708 / L800 / L820 が使う) | 推奨列が SKILL.md から消えるため、「SKILL の列の正本」という役目だけが失われる。CLI 側の役目は変わらない |
| §12 L376 | 「文書検証: custom-policy スキルの帯一覧が RoleId と一致し、**推奨列が `RECOMMENDED` と一致すること**」 | 推奨列との一致テストを削除する。文書検証の対象を共通規律 §役割の帯 の表へ移す | 検証対象の列が消えるため。`RECOMMENDED` の値そのものは `src/agents/__test__/policies.test.ts` の `EXPECTED_RECOMMENDED`(L35-52)が引き続き固定する |
| §4.1 L90 / ユーザー決定 L30 | 「スキル `claude-model-policy` を維持する。**担当表は現行どおり Claude モデル名で帯を固定する**」「2 プロファイル構成(claude = レガシー・**モデル名担当表**・role-id 無関係 / custom = **role-id 担当表**)」 | どちらのプロファイルも自前の担当表を持たない。両者が同じ 1 つの表(共通規律 §役割の帯)を読む | 本改修後、2 プロファイルの差は「どの表を持つか」ではなく「**解決順の違い**」になる。claude は表の「Claude モデル」列を直接使い、custom はまず役割マーカーの対応表を引き、決まらない帯だけ同じ列へ読み替える。プロファイルの識別は表の所有ではなく解決順が担う |
| §4.2 L117-119 / L128、§11 L356 | 実行帯の解決順 手順 2・セッション途中の不達・規律のモデル注入起動のいずれも「読み替え先 = `claude-model-policy` の同帯モデル」 | 読み替え先を共通規律 §役割の帯 の「Claude モデル」列に差し替える | §6.2 のとおり、custom が成立したセッションでは `claude-model-policy` が注入されず(`src/hooks/session-start.ts` L122-131)、参照が解決できない。当時この 3 箇所は同じ設計判断から同時に書かれたため、まとめて差し替える |

### 1.2 `2026-09-07-agent-policy-orchestrator-analysis-design.md`

| 箇所 | 元の決定 | 本設計の扱い | 根拠 |
| --- | --- | --- | --- |
| ユーザー決定 4 | 「宣言は共通規律の定義文に 1 箇所だけ置く。両 SKILL.md には置かない(同じ規律を複数の指示書に書かない)」 | **覆さない。拡張する。** 同じ原則を、宣言だけでなく「帯のカタログ表」と「3 文書に重複する 3 種の規律」にも適用する | 元の決定の根拠(同じ規律を複数の指示書に書かない)が、そのまま表と重複規律にも当てはまる |
| ユーザー決定 11 | 「custom-policy の推奨モデルは、この 2 行とも `Opus` のみにする」 | 列自体が消えるため、決定の対象が消滅する | §1.1 のとおり |
| §4.3 | 「担当表の表本体は 2 行のモデル欄を両プロファイルとも `Opus` のまま**維持**し」 | 両 SKILL.md から表本体を削除する | §1.1、および §6.2(手順 2 のギャップ)の解決に表の統合が必要 |
| §4.3 | 「`custom-policy` L14 の既存段落(「担当表が持つのは役割の帯だけである。…」)は**変更しない**」 | 書き換える。推奨モデルに言及する第 3 文を削除し、担当表の所在を共通規律へ向ける | 推奨列が消えるため第 3 文が指す対象が無くなる |
| §4.5 | L5 の定義文を「読み込んだ方針の §モデル別役割(または §役割の帯と推奨モデル)の表を指す」とする | 「この文書の §役割の帯 の表を指す」に書き換える。方針スキルへの間接参照を廃止する | 表が共通規律へ移るため。間接参照が指す先が消える |
| §4.9 / L109 | 「この帯の解決は方針の**「独立レビューの手順」**に従う」 | 「方針の**「実行帯の解決順」**に従う」に書き換える | 両 SKILL の「独立レビューの手順」節を削除するため、参照先が消える |
| §4.9 L305 | 「両方針スキルの「独立レビューの手順」節(claude L39-46 / custom L64-73)は既に同じ順序を書いており、**変更しない**」 | 両節を**削除する** | 3 文書に同じ手順が重複している(要件 4-3)。手順の本体は規律 §設計・実装計画の規律 が持ち、custom 固有の省略規定だけを「実行帯の解決順」の例外へ残す |

### 1.3 依頼で確定した要件のうち、本設計が調整するもの(オーケストレーター決定 2026-09-09)

依頼の要件 6 は「claude-model-policy に残すもの: 帯→モデルの表(`ASSIGNMENTS` との一致テストは維持)」とする。一方、要件 7 は選択肢 (a) を採った場合「両 SKILL.md の表が消え、規律の 1 表に集約される」と明記している。

**オーケストレーター決定: 要件 7 (a) を採用し、要件 6 の「表を残す」部分は成立しないものとする。** `ASSIGNMENTS` との一致テストは維持するが、検査対象は共通規律 §役割の帯 の「Claude モデル」列になる。claude-model-policy に残るのは「実行帯の解決順」と、表の所在を指す 1 文である。この調整は要件 7 が明示的に予告した帰結である。

## 2. 背景と目的

`plugins/agent-policy` は、役割の帯(band)のカタログを **3 箇所**に持っている。

1. `src/agents/roles.ts` の `ROLES`(16 件。`id` / `label` / `kind` / `tools` の正本)と `src/agents/policies.ts` の `ASSIGNMENTS` / `SOLO_DENIED_ROLES`(モデル割当と Agent Tool 可否の正本)。
2. `skills/claude-model-policy/SKILL.md` L14-31 の「モデル別役割」表(16 行 × 帯名 / モデル)。
3. `skills/custom-policy/SKILL.md` L16-33 の「役割の帯と推奨モデル」表(16 行 × 帯名 / 推奨モデル)。

さらに同じ規律が 3 つの指示書(共通規律・両 SKILL)に重複して書かれている。この構造から次の問題が出ている。

- **推奨モデル列が競合信号になる。** custom-policy は SessionStart で必ずロードされるため、推奨列は毎 custom セッションのプロンプトに載る。しかし実行コードはこの列を読まない。読むのは `src/agents/__test__/policy-skill-assignments.test.ts` L23-27 / L93-105 だけである。委譲先は役割マーカーの対応表が決めるにもかかわらず、`claude-model-policy` の担当表の超集合であるモデル名の並びが同じ文脈に置かれ、未割当帯の読み替え(custom-policy L45 の手順 2)と同帯複数定義の選択の判断を濁す。
- **「担当表」の定義が間接参照になっている。** `references/orchestration-discipline.md` L5 は「読み込んだ方針の §モデル別役割(または §役割の帯と推奨モデル)の表を指す」と書く。規律は自身の中で完結せず、どちらの方針がロードされたかに依存する。
- **同じ規律が 3 文書に散っている。** Agent Tool 禁止 6 帯(規律 L25 / custom L36 / claude L33)、読み取り帯を実装定義へ委譲するときの文言(規律 L81 / custom L59-61 / claude L35-37 / `references/subagent-discipline.md` L10)、独立レビューの手順(規律 L104-111 / custom L63-72 / claude L39-46)。
- **custom セッションで解決できない参照が 3 箇所ある。** `custom-policy` L45(手順 2)、L76(セッション途中の読み替え)、規律 L39(モデル注入起動)はいずれも「`claude-model-policy` の同じ帯のモデルへ読み替える」と書く。しかし custom が成立したセッションで注入されるのは `custom-policy` だけであり(`src/hooks/session-start.ts` L122-131 の `successBlocks`)、`claude-model-policy` は注入されない。読み替え先の表がその場に無い。

本改修は次を行う。

1. 帯のカタログを共通規律の §役割の帯 に 1 つだけ置く(帯名 / RoleId / 種別 / Agent Tool の可否 / Claude モデル)。両 SKILL.md の表を削除する。
2. 「担当表」の定義を規律自身の表を指すものに書き換え、間接参照を廃止する。
3. 3 文書に重複する 3 種の規律を共通規律 1 箇所へ一本化する。
4. custom-policy の推奨モデル列を廃止する。推奨の正本は `RECOMMENDED` と setup-agents CLI だけにする。
5. 上記に伴う文書・テスト・README・バージョンの追随。

コード(`src/**/*.ts`)の**振る舞いは変更しない**。変更するのはテスト 1 本の入替えと、`.ts` に対しては 0 行である。

## 3. ユーザー決定(2026-09-09。本設計はこれを前提とし、覆さない)

1. 帯カタログを共通規律へ移す。列は 帯名 / RoleId / 種別 / Agent Tool の可否。帯名の正本は `ROLES[].label`、可否の正本は `SOLO_DENIED_ROLES`。表と正本の一致をテストで固定する。
2. 規律 L5 の間接参照を廃止する。hooks・`_common.md`・`context-map-guide.md` との整合を保ち、コード変更は最小(文言のみ、または無変更が望ましい)にする。
3. custom-policy から担当表(帯 + 推奨モデル列)を削除する。推奨モデル列は SKILL.md のどこにも残さず、README にも移さない。推奨の正本は `RECOMMENDED` と setup-agents CLI のみ。`RECOMMENDED` は維持する。custom-policy と `RECOMMENDED` の一致テストは削除する。
4. 3 文書に重複する 3 種の規律を共通規律 1 箇所へ一本化し、両 SKILL.md から削除する。
5. custom-policy に残すもの: 実行帯の解決順(手順 1-2 と独立レビュー例外)、セッション途中で委譲先が使えなくなったときの規定、dispatch の規律のうち custom 固有の項、この方針が読み込まれる条件。表は持たない。
6. claude-model-policy に残すもの: 帯→モデルの対応(`ASSIGNMENTS` との一致テストは維持)、実行帯の解決順。帯名は規律の表と同じ文字列を使う。重複規律は削除する。→ 要件 7 (a) の採用に伴う調整は §1.3。
7. 手順 2 のギャップは案 (a)(規律の表に「Claude モデル」列を足して統合)を推奨とし、規律サイズと claude プロファイルへの影響を評価して決める。
8. 規律 + `context-map-guide.md` + `subagent-discipline.md` の合計が 30KB を超えないこと(この 30KB の出所と、規律 L101 との関係は §4.3)。
9. 本設計が覆す既存設計書の決定を明示的に列挙する(§1)。
10. バージョンはマイナーを上げて `0.17.0-dev` とする。README の移行節に「0.16 → 0.17」を書く。
11. 付随更新: `plugins/agent-policy/README.md`、ルート `README.md`(記述があれば)、Serena メモリ `agent_policy/core`。

### 3.1 オーケストレーター決定(2026-09-09。第 1 版のレビュー結果に対する採否)

1. 要件 7 (a) を採用し、要件 6 の「表を残す」は成立しないものとする(§1.3)。
2. `claude-model-policy` L34 / `custom-policy` L55(委譲時の帯明示と Output Format 指定)を共通規律へ 1 行として引き上げ、両 SKILL から削除する(§6.5)。
3. `custom-policy` L57 は残す(§6.6)。
4. `assets/roles/ja/_common.md` L14 の「担当表の」を「対応表の」へ直す(§7.11)。
5. `references/context-map-guide.md` L12 の「・最終レビュー」を削除する(§7.10)。
6. 推奨モデル列廃止の運用上の実効は、運用後の検証課題として残す(§11.2-1)。

## 4. 前提(実測)

### 4.1 コードの現況

| 対象 | 実測 |
| --- | --- |
| `src/agents/roles.ts` L1 | `RoleKind = "impl" \| "readonly"` |
| 同 L3-19 | `RoleId` 16 種 |
| 同 L29-126 | `ROLES` 16 件。`label` / `kind` / `tools` を保持。並び順は `complex-impl, normal-impl, light-impl, escalation, general, design-plan, explore-lead, explore, realtime-research, e2e-verify, independent-review, doc-review, code-review, final-review, gate-review, advisor` |
| `src/agents/policies.ts` L124-146 | `ASSIGNMENTS["claude-model-policy"]` が 16 帯。値は `complex-impl:opus / normal-impl:sonnet / light-impl:haiku / escalation:fable / general:sonnet / design-plan:opus / explore-lead:opus / explore:sonnet / realtime-research:sonnet / e2e-verify:sonnet / independent-review:sonnet / doc-review:haiku / code-review:sonnet / final-review:fable / gate-review:fable / advisor:fable` |
| 同 L149-166 | `RECOMMENDED` が 16 帯 |
| 同 L174-181 | `SOLO_DENIED_ROLES = ["light-impl", "advisor", "doc-review", "code-review", "final-review", "gate-review"]`。**`export` されていない**(モジュール内 `const`) |
| 同 L183-186 | `allowsAgentTool(ids, model?)`。`AGENT_DENIED_MODELS`(`haiku`)と `SOLO_DENIED_ROLES` で判定 |
| `src/setup-agents.ts` L179 / L190 / L208 / L708 / L800 / L820 | `RECOMMENDED` を実際に読む 6 箇所。`--list-live-models` の `recommendedFor`(L708)と `--list-coverage` の `models`(L820)を生成する。**`RECOMMENDED` の削除はできない**(L31 は import、L185 は `recommendedForAlias` の関数先頭、L691 はコメント) |
| `src/agents/policies.ts` L122-123 / L148 | 担当表を SKILL.md が持つ前提のコメント。「claude-model-policy 専用の担当表。…担当表が変わったらここも変える」「custom プロファイルの推奨。custom-policy の担当表と一致させる」 |
| `src/agents/fragments.ts` L210 / L255-258 / L288 | 翻訳断片の stale 判定。`bundledDir` は `ja` / `en` 以外の言語に対して **`assets/roles/en` を返す**(L210)。`source-hash` は英語断片の本文ハッシュである(L288 / L299)。ja 断片の変更は翻訳断片の stale 判定に影響しない |
| `src/hooks/session-start.ts` L122-131 | `successBlocks` は `policyBlock("custom-policy", …)` / `markerTable` / `unknownRoleBlock` の 3 ブロックのみ。custom 成立時に `claude-model-policy` は注入されない |
| `src/hooks/marker-scan.ts` L138-143 | `roleLabel` は `roleById(role)?.label` を返し、無ければ `.claude/agent-policy/roles/` の `label` を読む |
| 同 L207-209 | 対応表の見出し文言「次の Agent は役割マーカーを宣言している。**担当表**の該当する帯は、これらを優先して使う。同じ帯に複数あるときは依頼内容に近いものを選ぶ。」 |
| `src/hooks/delegation-gate.ts` L327-332 | deny 文言「delegation-gate: メインセッションでこの層のファイルは編集しない運用方針である。**担当表の帯に従い** Agent tool で委譲する。…」 |
| `src/hooks/subagent-start.ts` L263 | `references/subagent-discipline.md` を読み込んでサブエージェントへ注入する |

### 4.2 文書の現況(変更対象行)

| ファイル | 行 | 現在の文言(要点) |
| --- | --- | --- |
| `references/orchestration-discipline.md` | L5 | 「以下で「担当表」とは、読み込んだ方針の §モデル別役割(または §役割の帯と推奨モデル)の表を指す。帯の名前は担当表の行名で参照する。」 |
| 同 | L25 | Agent Tool 非許可 6 帯の列挙 |
| 同 | L39 | 「…`claude-model-policy` の運用では、帯モデルはその担当表が定める Claude のモデルである。…帯モデルが Claude 以外のときは、`claude-model-policy` の同じ帯のモデルへ読み替える。」 |
| 同 | L55 | 合成対象 15 帯の列挙 |
| 同 | L81 | 「読み取りの帯で合成するときは、依頼文に「ファイルを変更しない」「報告のみを返す」を重ねる。」 |
| 同 | L109 | 「…この帯の解決は方針の「独立レビューの手順」に従う(対応表に無いときは省略する)。」 |
| `skills/custom-policy/SKILL.md` | L3 | frontmatter `description` の冒頭「**役割の帯(role-id)だけを担当表に持ち**、委譲先をプロジェクトの Agent 定義に付いた役割マーカーで解決する構成でのエージェント運用方針。…」 |
| 同 | L12-33 | 「## 役割の帯と推奨モデル」節 + 16 行の表 |
| 同 | L14 | 「担当表が持つのは役割の帯だけである。…推奨モデルは構成を作るときの参考であり、委譲先を拘束しない。」 |
| 同 | L35-36 | モデル・役割の組合せ非制約 / Agent Tool 非許可 6 帯 |
| 同 | L45 | 手順 2「対応表に無い帯は、`claude-model-policy` の同じ帯のモデルへ読み替える。…」 |
| 同 | L59-61 | 読み取り帯を実装定義へ委譲するときの明記事項 |
| 同 | L63-72 | 「## 独立レビューの手順」節 |
| 同 | L76 | 「その帯を `claude-model-policy` の同じ帯へ読み替えて続行する。」 |
| `skills/claude-model-policy/SKILL.md` | L12-31 | 「## モデル別役割」節 + 16 行の表 |
| 同 | L33 | Agent Tool 非許可 6 帯 |
| 同 | L34 | 6 帯を挙げて「依頼文の冒頭でどの役割かを明示し、その役割の Output Format を指定する」 |
| 同 | L35-37 | 読み取り帯を実装定義へ委譲するときの明記事項 |
| 同 | L39-46 | 「## 独立レビューの手順」節 |
| 同 | L48-55 | 「## 実行帯の解決順」節 |
| `references/subagent-discipline.md` | L10 | 「読み取りの作業を実装帯の定義へ再委譲するときは、依頼文に「ファイルを変更しない」「報告のみを返す」を明記する。」 |
| `references/context-map-guide.md` | L12 | 「オーケストレーター \| セッションを主導し、dispatch・要件確定・採否判断・承認・分析**・最終レビュー**を行う役割。**担当表**のどの帯も自ら担わない」 |
| `assets/roles/ja/_common.md` | L14 | 「**担当表**の「設計・計画・実装のアドバイザー」帯の定義を使う。…」 |
| `assets/roles/en/_common.md` | L14 付近 | 「Use the definition for the "design, planning, and implementation advisor" band.」— 担当表に相当する語を持たない(**変更不要**) |
| `README.md`(プラグイン) | L45 | 「\| `claude` \| `agent-policy:claude-model-policy` を注入します。**Claude のモデル名で帯を固定する担当表であり**、Agent 定義のセットアップは不要です。 \|」 |
| 同 | L109-128 | 役割 ID 16 種の表(**変更不要**) |
| 同 | L206-213 | 「0.15 系から 0.16 系へ移行する場合」の節 |
| ルート `README.md` | L112 | 「claude プロファイルは Claude のモデル名で役割の帯を固定し、セットアップなしで利用できます。custom プロファイルは**役割の帯(role-id)だけを持つ担当表**を使い、…」 |
| 同 | L59 | プラグイン一覧の説明。帯の表・推奨モデル列への言及は無い(**変更不要**) |

### 4.3 サイズの実測

| ファイル | 現在 |
| --- | --- |
| `references/orchestration-discipline.md` | 12,510 B |
| `references/context-map-guide.md` | 6,184 B |
| `references/subagent-discipline.md` | 910 B |
| 3 本合計 | 19,604 B |
| `skills/custom-policy/SKILL.md` | 7,294 B |
| `skills/claude-model-policy/SKILL.md` | 4,632 B |

**30KB という数値の出所について。** 規律 L101 は「委譲先にロードさせるスキルは、`wc -c` で本文と参照文書の合計を測る。30KB を超えるものは、指定があってもロードさせず…」と書く。この条項の主語は「**委譲先にロードさせる 1 つのスキル**(本文 + そのスキルが参照する文書)」であり、`references/` の 3 ファイルを束ねた合計ではない。本設計で 3 本合計を測るのは、依頼の**要件 8** が「合計(規律 + context-map-guide + subagent-discipline)で 30KB を超えないこと」を制約として指定したためである。以下、この上限を「要件 8 の上限」と呼ぶ(規律 L101 そのものの適用ではない)。

### 4.4 テストの現況

| ファイル | 内容 |
| --- | --- |
| `src/agents/__test__/policy-skill-assignments.test.ts` | 両 SKILL.md の表を読み、`ASSIGNMENTS` / `RECOMMENDED` と突き合わせる。SKILL.md を読む**唯一**のテストである(`grep -rln "SKILL.md" src/` の結果がこの 1 本) |
| 同 L54-91 | `parseTable`。行の第 1 セルを `startsWith(label)` で照合し、第 2 セル内のバッククォート語を `MODEL_IDS`(L39-49)でモデル ID に解決する。未知語で throw(L82-86)、複数一致で throw(L72-77)、第 2 セル欠落で行スキップ(L65) |
| `src/agents/__test__/policies.test.ts` L16-33 / L35-52 | `EXPECTED_CLAUDE_ASSIGNMENTS` / `EXPECTED_RECOMMENDED` が 16 帯の値を固定する(検証は L103 / L111) |
| 現況 | `references/orchestration-discipline.md` を読むテストは**存在しない** |

### 4.5 変えない前提

- `src/**/*.ts` の**振る舞いを変えない**。`ROLES` / `ASSIGNMENTS` / `RECOMMENDED` / `SOLO_DENIED_ROLES` / `allowsAgentTool` / hooks / setup-agents はいずれも実行される行の変更が 0 である。変更するのは `policies.ts` の説明コメント 2 箇所(L122-123 / L148)だけで、これは実体に合わせた追随である(§7.14)。
- `assets/roles/**` の役割断片 16 本 × 2 言語は無変更。変更するのは `assets/roles/ja/_common.md` L14 の 1 語だけである(§7.11)。`en/_common.md` は該当する語を持たないため無変更。
- `assets/context-map-template.md` は無変更。
- 実装計画書(WBS)は本設計書のスコープ外である。

## 5. 全体像

```
変更前                                   変更後
─────────────────────────────────────    ─────────────────────────────────────
roles.ts / policies.ts(コード正本)      roles.ts / policies.ts(コード正本)
   │                                        │
   ├─ 一致テスト ─→ claude SKILL の表        └─ 一致テスト ─→ 規律 §役割の帯 の表
   │                (16 行 帯名/モデル)                      (16 行
   └─ 一致テスト ─→ custom SKILL の表                          帯名/RoleId/種別/
                    (16 行 帯名/推奨)                          Agent Tool/Claude モデル)
                                                                    ↑
規律 ── 担当表とは「読み込んだ方針の表」          規律 ── 担当表とはこの表 ──┘
規律 L25 ┐                                       規律 §役割の帯 の Agent Tool 列に統合
custom L36├ Agent Tool 禁止 6 帯(3 重)           (SKILL 側は削除)
claude L33┘
規律 L81 ┐                                       規律 §モデル別役割の運用 に 1 箇所
custom L59├ 読み取り帯の委譲文言(4 重)          (SKILL 側は削除。subagent-discipline
claude L35│                                        は配布物のため残す)
subagent L10┘
規律 L104┐                                       規律 §設計・実装計画の規律 に 1 箇所
custom L63├ 独立レビュー手順(3 重)              (SKILL 側は削除。custom は
claude L39┘                                        「解決順」節の例外だけを残す)

custom 手順 2 ─→ claude-policy の表              custom 手順 2 ─→ 規律の Claude モデル列
  (custom セッションでは未注入 = 解決不能)         (規律は両プロファイルで読まれる)
規律 L39 ─→ claude-policy の表(同上)            規律 L39 ─→ 自身の Claude モデル列
custom L76 ─→ claude-policy の表(同上)          custom L76 ─→ 規律の Claude モデル列
```

セッションあたりのプロンプト量(規律 + 該当 SKILL)。変更後は §7 の変更後全文を組み立てて実測した値である。

| 対象 | 変更前 | 変更後 |
| --- | --- | --- |
| `references/orchestration-discipline.md` | 12,510 B | 14,149 B(表ブロック +2,192 B、重複削除 −553 B、ネット **+1,639 B**) |
| `skills/claude-model-policy/SKILL.md` | 4,632 B | 1,655 B |
| `skills/custom-policy/SKILL.md` | 7,294 B | 3,942 B |
| claude セッション(規律 + SKILL) | 17,142 B | **15,804 B** |
| custom セッション(規律 + SKILL) | 19,804 B | **18,091 B** |
| 要件 8 の 3 本合計 | 19,604 B | **21,243 B**(上限 30,720 B、余裕 9,477 B) |

上表は §11.1 の決定 2(委譲時の帯明示を規律へ引き上げ)と決定 4(`context-map-guide.md` L12 の「・最終レビュー」削除)を反映する前の値である。決定 2 は claude / custom の各 SKILL から 1 行を落として規律へ 1 行を足すため差引き数十 B、決定 4 は `context-map-guide.md` を約 21 B 縮める。いずれも結論(3 本合計が上限を大きく下回り、両プロファイルのセッション量が減る)を動かさない。**実装後に `wc -c` で確定させる**(§9.4)。

## 6. 設計判断

### 6.1 要件 2 の用語 —— 「担当表」を維持する

**決定: 用語「担当表」を維持し、定義だけを書き換える。「帯」への統一は行わない。**

| 案 | 評価 |
| --- | --- |
| A. 「担当表」を維持(採用) | 定義文を「この文書の §役割の帯 の表を指す」に書き換えるだけで済む。`src/hooks/marker-scan.ts` L208・`src/hooks/delegation-gate.ts` L329・`references/context-map-guide.md` L12 の既存文言がそのまま正しい参照になり、**hooks のコード変更は 0 行**である。要件 2 の「コード変更は最小、無変更が望ましい」を満たす |
| B. 「帯」へ統一 | `marker-scan.ts` / `delegation-gate.ts` の文字列とそのテスト、`context-map-guide.md`、README を書き換える必要がある。得られるのは語の統一だけで、判断分岐は 1 つも変わらない。ハーネスの挙動を変える改修に文字列変更を混ぜる分、回帰の面が広がる。不採用 |

**訂正(独立レビューで検出)。** 案 A の評価に当初「`assets/roles/ja/_common.md` L14 もそのまま正しい参照になる」と書いたが、これは誤りである。同 L14 の読者は**サブエージェント**であり、サブエージェントは共通規律も方針スキルも読まない(規律 L30-31、`_common.md` L27-29)。サブエージェントへ届く規律は `references/subagent-discipline.md` だけであり(`src/hooks/subagent-start.ts` L263)、その L8 は同じ規定を「**対応表**の「設計・計画・実装のアドバイザー」の帯の定義を使う」と書く。したがって `ja/_common.md` L14 の「担当表の」は「対応表の」でなければならない。これは 0.16 以前から存在する食い違いであり、本改修で直す(§7.11)。用語「担当表」の維持という決定自体は変わらない。

なお用語「帯」は現行文書でも並行して使われており(「担当表の該当する**帯**」「6 **帯**」)、A を採っても「担当表 = 帯の一覧表」「帯 = その 1 行」という関係は保たれる。新設する節の見出しを「役割の帯」とすることで、両語が同じ対象を指すことが表の見出し行(帯名 / RoleId / …)からも読める。

### 6.2 要件 7 の選択 —— (a) を採用する

**決定: (a) 規律の §役割の帯 の表に「Claude モデル」列を加え、`claude-model-policy` の表を統合する。**

決め手は、当初想定していた「custom-policy 手順 2 のギャップ」が**手順 2 だけの問題ではない**という実測である。「`claude-model-policy` の同じ帯のモデルへ読み替える」という指示は 3 箇所にある。

| 箇所 | 文言 | custom セッションでの解決可否 |
| --- | --- | --- |
| `custom-policy` L45(実行帯の解決順 手順 2) | 「対応表に無い帯は、`claude-model-policy` の同じ帯のモデルへ読み替える」 | 不可(`claude-model-policy` は未注入) |
| `orchestration-discipline` L39(モデル注入起動) | 「帯モデルが Claude 以外のときは、`claude-model-policy` の同じ帯のモデルへ読み替える」 | 不可 |
| `custom-policy` L76(セッション途中の失効) | 「その帯を `claude-model-policy` の同じ帯へ読み替えて続行する」 | 不可 |

(b)(custom 本文に読み替え先を書く)は 3 箇所のうち 1 箇所しか直さないうえ、Claude モデルの一覧を custom-policy に書き戻すことになり、要件 3(推奨モデル列を SKILL.md のどこにも残さない)の趣旨と正面から衝突する。(c)(現状維持 + Skill tool での追加ロードを明記)は、規律 L26「サブエージェントに方針スキルをロードさせない」とは矛盾しないもののオーケストレーター自身に追加ロードを課すもので、読み替えという例外処理のために 4.6KB のスキルを毎回ロードさせる費用が見合わない。

(a) は 3 箇所すべてを、両プロファイルで必ず読まれる 1 つの表への参照に置き換える。

**規律サイズへの影響:** 表ブロックの追加が +2,192 B、L25 の 6 帯列挙・L55 の 15 帯列挙・L81 の削除と統一規律の追加で −553 B。差引き **+1,639 B** で規律は 14,149 B となり、要件 8 の 3 本合計は 21,243 B(上限 30,720 B に対して余裕 9,477 B)である。

**claude プロファイルへの影響:** `claude-model-policy` から表が消え、SKILL.md は 1,655 B になる。表の所在を指す 1 文を冒頭に置き、既存の L10「共通規律を併せて読み、これに従う」と合わせて到達性を担保する。claude セッションのプロンプト総量は 17,142 B → 15,804 B へ減る。リスクは §10 に記載する。

### 6.3 要件 4-2 の `subagent-discipline.md` の扱い —— 残す

**決定: `references/subagent-discipline.md` L10 は変更せずに残す。**

根拠は読者と配布経路が違うことである。

- `orchestration-discipline.md` の読者はオーケストレーターである(同 L1-3 が明示)。
- `subagent-discipline.md` は `src/hooks/subagent-start.ts` L263 がファイルとして読み、SubagentStart の additionalContext としてサブエージェントへ注入する。サブエージェントは方針スキルも共通規律も読まない(規律 L30-31、`_common.md` L27-29)。
- したがって L10 を削除すると、この規律がサブエージェントへ届く経路が**完全に消える**。

「同じ規律を複数の指示書に書かない」という原則は、同じ読者が両方を読む場合に競合・分岐を生むことを避けるためのものである。ここでは読者集合が交わらないため原則の射程外である。文言も 1 行に圧縮済み(オーケストレーター向けの 3 項目に対し、サブエージェント向けは「ファイルを変更しない」「報告のみを返す」の 2 点)であり、追加の削減余地は無い。

削除対象は `custom-policy` L59-61 と `claude-model-policy` L35-37 の 2 箇所、および規律 L81(§役割の帯 の種別列を使う統一規律に吸収)である。

### 6.4 独立レビュー手順のプロファイル差分

(a) の採用により、**claude プロファイル固有の差分は消滅する**。`claude-model-policy` L44 の「`Sonnet` へ独立レビューを dispatch する」は、規律の §役割の帯 の `independent-review` 行の Claude モデル列(`Sonnet`)と、同 SKILL の「実行帯の解決順」から導出できる。したがって `claude-model-policy` には独立レビューに関する記述を一切残さない。

custom プロファイル固有の差分(対応表に無いときは省略する / 他の帯で代行しない)は、既存の `custom-policy` L47(手順 2 の例外)に「他の帯で代行しない」を足すことで吸収し、「独立レビューの手順」節は丸ごと削除する。

### 6.5 委譲時の帯明示と Output Format 指定(オーケストレーター決定 2026-09-09)

`claude-model-policy` L34 は「独立レビュー・リアルタイム情報調査・探索実働・重要な実装の最終レビュー・E2E 動作検証・設計書の最終ゲートレビューを委譲するときは、依頼文の冒頭でどの役割かを明示し、その役割の Output Format を指定する」と書き、`custom-policy` L55 は「依頼文の冒頭で、その委譲が担う帯を明示し、その役割の Output Format を指定する」と書く。同一の規律を、claude 側は対象帯を 6 つ列挙する形で、custom 側は全帯を対象とする形で持っている。

**決定: 共通規律の §モデル別役割の運用 へ「オーケストレーターは、委譲の依頼文の冒頭でその委譲が担う帯を明示し、その帯の Output Format を指定する」の 1 行として引き上げ、両 SKILL から削除する。**

根拠は 3 つある。

- 要件 4 が挙げる 3 種と同じ性質(同じ規律が複数の指示書にある)である。要件 4 の列挙は例示であり、同種の重複を残す理由が無い。
- claude 側の 6 帯列挙は、`ROLES` から導けない手書きの部分集合である。帯が増えるたびに追随が要るうえ、列挙外の帯(実装帯など)では帯名も Output Format も指定しなくてよいと読めてしまう。全帯を対象にする custom 側の書き方が正しい。
- 本改修で claude 側の他の箇条(L33 / L35-37)が消えるため、L34 だけが表を失った SKILL に取り残される。

引き上げ後、`claude-model-policy` は「実行帯の解決順」節と冒頭 2 段落だけになる。

### 6.6 `custom-policy` L57 の扱い(オーケストレーター決定 2026-09-09)

「名指しで dispatch する Agents の起動形態は、共通規律の §委譲先の実行モデルの確定 に従う。合成する場合の手順もその節に従う」は、規律への一方向の相互参照である。規律 L36 が既に逆向きの参照(「帯に対して委譲先を選ぶ役割ベースの dispatch にはこの節を当てず、方針の「実行帯の解決順」に従って…」)を持つため冗長ではあるが、**決定: 残す。** 規律とは別の指示書から読み始めた場合に、名指し dispatch と役割ベース dispatch の境界へ到達する経路を保つ。削除しても得られるのは 100 B 程度である。

## 7. 各変更の詳細

### 7.1 `references/orchestration-discipline.md` — 冒頭の定義と §役割の帯 の新設

変更前(L1-5):

```markdown
# オーケストレーション共通規律

この文書の読者はオーケストレーターである。「サブエージェントは〜」で始まる条項は、依頼文への転記と、生成した定義の本文でサブエージェントへ届ける。

以下で「担当表」とは、読み込んだ方針の §モデル別役割(または §役割の帯と推奨モデル)の表を指す。帯の名前は担当表の行名で参照する。
```

変更後:

```markdown
# オーケストレーション共通規律

この文書の読者はオーケストレーターである。「サブエージェントは〜」で始まる条項は、依頼文への転記と、生成した定義の本文でサブエージェントへ届ける。

以下で「担当表」とは、この文書の §役割の帯 の表を指す。帯の名前は担当表の「帯名」列の値で参照する。

## 役割の帯

| 帯名 | RoleId | 種別 | Agent Tool | Claude モデル |
| --- | --- | --- | --- | --- |
| 複雑または重要な実装 | `complex-impl` | `impl` | 可 | `Opus` |
| 通常の実装 | `normal-impl` | `impl` | 可 | `Sonnet` |
| 軽量な実装 | `light-impl` | `impl` | 否 | `Haiku` |
| 行き詰まり時のエスカレーション | `escalation` | `impl` | 可 | `Fable` |
| その他のタスク | `general` | `impl` | 可 | `Sonnet` |
| 設計書・実装計画書(WBS)の作成 | `design-plan` | `impl` | 可 | `Opus` |
| コードベース探索統括 | `explore-lead` | `impl` | 可 | `Opus` |
| コードベース探索実働 | `explore` | `readonly` | 可 | `Sonnet` |
| リアルタイム情報調査 | `realtime-research` | `readonly` | 可 | `Sonnet` |
| E2E 動作検証・ブラウザ/GUI 操作 | `e2e-verify` | `readonly` | 可 | `Sonnet` |
| 設計書・実装計画書の独立レビュー | `independent-review` | `readonly` | 可 | `Sonnet` |
| 設計書・実装計画書のレビュー | `doc-review` | `readonly` | 否 | `Haiku` |
| コードレビュー | `code-review` | `readonly` | 否 | `Sonnet` |
| 重要な実装の最終レビュー | `final-review` | `readonly` | 否 | `Fable` |
| 設計書の最終ゲートレビュー | `gate-review` | `readonly` | 否 | `Fable` |
| 設計・計画・実装のアドバイザー | `advisor` | `readonly` | 否 | `Fable` |

- 「RoleId」は Agent 定義の `agent-policy-role` マーカーに書く値である。
- 「種別」は `impl` が成果物ファイルを書く帯、`readonly` が読み取りと報告だけの帯である。
- 「Agent Tool」は、その帯として起動したサブエージェントに Agent Tool を許可してよいかである。
- 「Claude モデル」は、その帯を Claude のモデルだけで実行するときのモデルである。`claude-model-policy` の運用では帯のモデルそのものであり、`custom-policy` の運用では委譲先が決まらない帯の読み替え先である。
```

節の位置は L5 の定義文の直後、既存の `## オーケストレーターが自ら担う作業` の直前とする。定義文の指す対象が直後に来る並びにする。

帯名は `src/agents/roles.ts` の `ROLES[].label` と一字一句一致させる。旧 SKILL の表にあった括弧書きの補足(「リアルタイム情報調査(最新動向・外部エコシステム)」「E2E動作検証・ブラウザ/GUI操作を伴う確認」など)は落とす。規律本文の他の箇所(L94・L107-109・旧 L55)は既に `label` と同じ文字列で帯を参照しており、これで文書全体の帯名が 1 種類に揃う。

### 7.2 同 — §モデル別役割の運用(L25 の置換と統一規律の追加)

変更前(L25):

```markdown
- オーケストレーターは、担当表の「軽量な実装」「設計・計画・実装のアドバイザー」「設計書・実装計画書のレビュー」「コードレビュー」「重要な実装の最終レビュー」「設計書の最終ゲートレビュー」の 6 帯以外のサブエージェントに Agent Tool を許可する。
```

変更後(L25 の位置に 1 行、その直後に統一規律 2 件を挿入):

```markdown
- オーケストレーターは、担当表の「Agent Tool」列が「可」の帯のサブエージェントにだけ Agent Tool を許可する。
- オーケストレーターは、委譲の依頼文の冒頭でその委譲が担う帯を明示し、その帯の Output Format を指定する。
- オーケストレーターは、担当表の「種別」が `readonly` の帯を `Write` / `Edit` を持つ定義へ委譲するとき、依頼文に次を明記する。合成して起動するときも同じである。
  - 使用してよい tools を読み取り系に限定すること(`Read` / `Grep` / `Glob`、読み取りに限った `Bash`、必要なら `WebSearch` / `WebFetch`)
  - ファイルを変更しないこと、報告のみを返すこと
```

2 行目は `claude-model-policy` L34 と `custom-policy` L55 の一本化である(§6.5)。L19-24 と L26-32 は変更しない。

### 7.3 同 — L39(モデル注入起動)

変更前:

```markdown
- モデル注入起動 — `subagent_type`・tools・本文を元定義のまま使い、`model` param だけを注入する。注入するのは `model` 未宣言・`inherit` の定義に対する帯モデルである。`claude-model-policy` の運用では、帯モデルはその担当表が定める Claude のモデルである。`custom-policy` の運用では、帯モデルは役割マーカーの対応表でその帯に解決された定義の `model` である。帯モデルが Claude 以外のときは、`claude-model-policy` の同じ帯のモデルへ読み替える。
```

変更後:

```markdown
- モデル注入起動 — `subagent_type`・tools・本文を元定義のまま使い、`model` param だけを注入する。注入するのは `model` 未宣言・`inherit` の定義に対する帯モデルである。`claude-model-policy` の運用では、帯モデルは担当表の「Claude モデル」列である。`custom-policy` の運用では、帯モデルは役割マーカーの対応表でその帯に解決された定義の `model` である。帯モデルが Claude 以外のときは、担当表の「Claude モデル」列へ読み替える。
```

### 7.4 同 — L55(合成の対象)

変更前:

```markdown
合成の対象とする帯は、「複雑または重要な実装」「通常の実装」「軽量な実装」「行き詰まり時のエスカレーション」「設計書・実装計画書(WBS)の作成」「コードベース探索統括」「コードベース探索実働」「リアルタイム情報調査」「E2E 動作検証・ブラウザ/GUI 操作」「設計書・実装計画書の独立レビュー」「設計書・実装計画書のレビュー」「コードレビュー」「重要な実装の最終レビュー」「設計書の最終ゲートレビュー」「設計・計画・実装のアドバイザー」の 15 帯とする。「その他のタスク」は合成しない。
```

変更後:

```markdown
合成の対象とする帯は、担当表のうち「その他のタスク」を除く全帯とする。「その他のタスク」は合成しない。
```

これも帯カタログの二重管理の解消である。現行の 15 帯列挙は `ROLES` から機械的に導ける集合(全帯 − `general`)を手で書き写したものであり、帯が増減するたびに追随が要る。表への参照に変えれば追随が不要になる。

### 7.5 同 — L81 の削除(§合成したときの tools)

変更前(L77-81):

```markdown
- built-in の tools は外部定義の tools を上限とし、外部定義に無い `Write` / `Edit` / `Bash` は使わない。
- ホスト frontmatter の `mcp__*` は、外部定義の tools に無くても使う。
- 外部本文が明示的に禁じる操作は、`mcp__*` の規則より優先して行わない。
- 読み取りの帯で合成するときは、依頼文に「ファイルを変更しない」「報告のみを返す」を重ねる。
```

変更後(最終行を削除):

```markdown
- built-in の tools は外部定義の tools を上限とし、外部定義に無い `Write` / `Edit` / `Bash` は使わない。
- ホスト frontmatter の `mcp__*` は、外部定義の tools に無くても使う。
- 外部本文が明示的に禁じる操作は、`mcp__*` の規則より優先して行わない。
```

内容は §7.2 の統一規律(「合成して起動するときも同じである」)へ吸収される。

### 7.6 同 — L109(独立レビューの参照先)

変更前:

```markdown
- 続いて担当表の「設計書・実装計画書の独立レビュー」の帯へ、原本のみを渡して dispatch する。他のレビューの指摘は渡さない。この帯の解決は方針の「独立レビューの手順」に従う(対応表に無いときは省略する)。
```

変更後:

```markdown
- 続いて担当表の「設計書・実装計画書の独立レビュー」の帯へ、原本のみを渡して dispatch する。他のレビューの指摘は渡さない。依頼文に「反証の提示までを担い、採否はオーケストレーターが判断する」と明記する。この帯の委譲先の解決は方針の「実行帯の解決順」に従う。
```

両 SKILL の「独立レビューの手順」節が消えるため、(1) 参照先を「実行帯の解決順」へ差し替え、(2) 各 SKILL の手順 3 にあった「反証の提示までを担い、採否はオーケストレーターが判断する」を規律側へ引き上げる。L106-108・L110-111 は変更しない。これで §設計・実装計画の規律 が独立レビューの手順(順序・原本のみ・依頼文の文言・採否判断)を単独で完結して持つ。

### 7.7 `skills/claude-model-policy/SKILL.md` — 全文

変更前: L1-55(frontmatter + 「モデル別役割」節 + 「独立レビューの手順」節 + 「実行帯の解決順」節)。

変更後(frontmatter は変更しない):

```markdown
---
name: claude-model-policy
description: Claude モデル(Fable/Opus/Sonnet/Haiku)のみで完結する構成でのエージェント運用方針。`AMATSUKA_AGENT_AUTO_INJECTION` が `claude` のときに使う。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に必ず読む。
---

# エージェント運用方針(Claude のみ)

あなたはオーケストレーターである。

`../../references/orchestration-discipline.md` を併せて読み、これに従う。担当表(帯名・RoleId・種別・Agent Tool の可否・Claude モデル)はその文書の §役割の帯 にある。

## 実行帯の解決順

この節は役割ベース dispatch の解決順である。名指しの dispatch は共通規律の §委譲先の実行モデルの確定 の判定フローに従う。

実務タスク着手前に確認し、以後はタスクごとに再判定しない。

担当表の「Claude モデル」列のモデルを、dispatch 時の `model` 上書きで指定して起動する。担当表の「種別」が `readonly` の帯はビルトイン `Explore`、`impl` の帯は `general-purpose` へ委譲する。
```

削除するのは L12-31(表と見出し)、L33(Agent Tool 6 帯 → 規律 §7.2 へ)、L34(委譲時の帯明示と Output Format 指定 → 規律 §7.2 へ。§6.5)、L35-37(読み取り帯の委譲文言 → 規律 §7.2 へ)、L39-46(独立レビューの手順 → 規律 §7.6 と表へ)である。frontmatter の `description` は変更しない(表の所有に言及していないため)。

L54-55 の「担当表のモデルで分岐する。Claude 帯は…」は、分岐先が 1 つしか無い記述だったため、参照先を「Claude モデル」列に変えたうえで断定形にした。あわせて `2026-09-07` 設計 §8-4 が指摘していた「番号付きリストが 1 項目だけ」の不自然さも解消する(現行は既に番号が外れており、本改修では文だけを差し替える)。

### 7.8 `skills/custom-policy/SKILL.md` — 全文

変更前: L1-83。

変更後(frontmatter の `description` 冒頭を実体に合わせて書き換える):

```markdown
---
name: custom-policy
description: 委譲先をプロジェクトの Agent 定義に付いた役割マーカー(role-id)で解決する構成でのエージェント運用方針。ベンダーを問わず、帯ごとに対応する定義へ委譲する。`AMATSUKA_AGENT_AUTO_INJECTION` が `custom`(または旧値の `with-codex` / `with-grok` / `with-codex-grok`)で、SessionStart がモデルの実在検証に成功したときに使う。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に必ず読む。
---

# エージェント運用方針(カスタム構成)

あなたはオーケストレーターである。

`../../references/orchestration-discipline.md` を併せて読み、これに従う。担当表(帯名・RoleId・種別・Agent Tool の可否・Claude モデル)はその文書の §役割の帯 にある。

この構成では、どの定義へ委譲するかを SessionStart フックが注入する役割マーカーの対応表が決める。担当表の「Claude モデル」列は委譲先を拘束せず、委譲先が決まらない帯の読み替え先としてだけ使う。モデルと役割の組合せは制約しない。

## 実行帯の解決順

この節は役割ベース dispatch の解決順である。名指しの dispatch は共通規律の §委譲先の実行モデルの確定 の判定フローに従う。

実務タスク着手前に一度確定し、以後はタスクごとに再判定しない。

1. マーカー対応表にある帯は、その定義を使う。同じ帯に複数あるときは依頼内容に近いものを選ぶ。
2. 対応表に無い帯は、担当表の「Claude モデル」列のモデルへ読み替える。読み替えた後は、dispatch 時の `model` 上書きで実行帯を指定し、担当表の「種別」が `readonly` の帯はビルトイン `Explore`、`impl` の帯は `general-purpose` へ委譲する。

手順 2 の例外は「設計書・実装計画書の独立レビュー」の帯である。この帯は読み替えず、独立レビューを省略する。他の帯で代行しない。同じベンダーのモデルによるレビューは独立性を持たないためである。

手順 2 は、一部の帯だけを定義した構成を成立させるための構成の既定である。故障時のフォールバックとは別物である。

## dispatch の規律

委譲先のベンダーを問わず、次を守る。

- 依頼文に「この tools のみ使用」と明記する。
- 名指しで dispatch する Agents の起動形態は、共通規律の §委譲先の実行モデルの確定 に従う。合成する場合の手順もその節に従う。
- 外部 Agent の enum 宣言を適用する場合を除き、`model` 上書きは使わない。

## セッション途中で委譲先が使えなくなったとき

- その帯を担当表の「Claude モデル」列へ読み替えて続行する。
- 「設計書・実装計画書の独立レビュー」の帯だけは読み替えず、省略する。
- 次のセッションの SessionStart が改めて検証する。恒久的な対処はそこに委ねる。

## この方針が読み込まれる条件

SessionStart フックは、`AMATSUKA_AGENT_AUTO_INJECTION` が custom 系の値であり、かつ役割マーカー付き定義の `model` がプロキシに実在することを確かめてから、この方針を注入する。検証が成立しなかったセッションでは `claude-model-policy` が注入され、この方針は読み込まれない。
```

主な差分:

| 旧 | 扱い |
| --- | --- |
| L3 の `description` 冒頭「役割の帯(role-id)だけを担当表に持ち、」 | 削除し、「委譲先を…役割マーカー(role-id)で解決する構成での」に一本化する。表を持たなくなる実体に合わせる。description の改稿は `prompt-smith:skill-creator` の担当であり、実装計画でその旨を指定する(§12-5) |
| L12-33(「役割の帯と推奨モデル」節 + 16 行の表) | 削除。冒頭の 1 文で担当表の所在を示す |
| L14 の第 1・第 2 文(担当表が持つのは帯だけ / 委譲先は対応表が決める) | 冒頭段落へ移し、「Claude モデル」列の位置づけを追記 |
| L14 の第 3 文(推奨モデルは参考) | 削除(推奨列が消えるため対象が無い) |
| L35(モデルと役割の組合せを制約しない) | 冒頭段落の末尾へ移す |
| L36(Agent Tool 6 帯) | 削除(規律 §7.2 と表の Agent Tool 列へ) |
| L45(手順 2) | 読み替え先を担当表の「Claude モデル」列へ変更。読み替え後の記述から「Claude 帯の解決に従い」を外し、種別列で `Explore` / `general-purpose` を選ぶ形に直す |
| L47(手順 2 の例外) | 「他の帯で代行しない」を追加(旧 L72 から移設) |
| L55(依頼文の冒頭で帯と Output Format) | 削除(規律 §7.2 へ引き上げ。§6.5) |
| L57(名指し dispatch は共通規律に従う) | **残す**(§6.6 の決定) |
| L59-61(読み取り帯の委譲文言) | 削除(規律 §7.2 へ) |
| L63-72(独立レビューの手順) | 削除。手順は規律 §設計・実装計画の規律 が持ち、custom 固有の省略規定は「実行帯の解決順」の例外に集約する |
| L76(セッション途中の読み替え) | 読み替え先を担当表の「Claude モデル」列へ変更 |

### 7.9 `references/subagent-discipline.md`

**変更しない。** 根拠は §6.3。

### 7.10 `references/context-map-guide.md` L12

変更前:

```markdown
| オーケストレーター | セッションを主導し、dispatch・要件確定・採否判断・承認・分析・最終レビューを行う役割。担当表のどの帯も自ら担わない |
```

変更後:

```markdown
| オーケストレーター | セッションを主導し、dispatch・要件確定・採否判断・承認・分析を行う役割。担当表のどの帯も自ら担わない |
```

「・最終レビュー」を削除する。共通規律 L9 のオーケストレーター定義は「dispatch・要件確定・採否判断・承認・分析」の 5 つであり、「重要な実装の最終レビュー」「設計書の最終ゲートレビュー」はいずれも帯として存在する(担当表)。同じ行の後半「担当表のどの帯も自ら担わない」と正面から矛盾していた。用語「担当表」はそのまま維持する(§6.1)ため、この行の変更は「・最終レビュー」の 7 文字だけである。

`context-map-guide.md` の他の行(L37 の消費側の読む深さ、L40 の map 作成者)は変更しない。

### 7.11 `assets/roles/ja/_common.md` L14

変更前:

```markdown
- 担当表の「設計・計画・実装のアドバイザー」帯の定義を使う。プロジェクトに該当する定義があればその名前で、無ければ `model` 上書きで `Fable` を指定して起動する。`Fable` が起動できないときは相談せず、差し戻しで解決する。
```

変更後:

```markdown
- 対応表の「設計・計画・実装のアドバイザー」帯の定義を使う。プロジェクトに該当する定義があればその名前で、無ければ `model` 上書きで `Fable` を指定して起動する。`Fable` が起動できないときは相談せず、差し戻しで解決する。
```

根拠(§6.1 の訂正): この断片の読者はサブエージェントであり、サブエージェントは共通規律も方針スキルも読まない(規律 L30-31、`_common.md` L27-29)。サブエージェントが持つのは SubagentStart が注入する役割マーカーの**対応表**だけであり(`src/hooks/marker-scan.ts` の `markerTable` と `references/subagent-discipline.md` L5 の `<!-- marker-table -->`)、同 L8 は同じ規定を既に「対応表の」と書いている。「担当表の」は 0.16 以前から存在する誤りである。

`assets/roles/en/_common.md` は**変更しない**。該当箇所(「Use the definition for the "design, planning, and implementation advisor" band.」)に担当表/対応表に相当する語が無く、訳し分けの対象になっていないためである。

### 7.12 `src/hooks/marker-scan.ts` / `src/hooks/delegation-gate.ts`

**変更しない。** L208 の「担当表の該当する帯は、これらを優先して使う」と L329 の「担当表の帯に従い Agent tool で委譲する」は、用語「担当表」の維持によりそのまま整合する。要件 2 の「コード変更は最小(無変更が望ましい)」を満たし、hooks の変更は 0 行になる。

### 7.13 `src/agents/policies.ts` のコメント 2 箇所

実行される行は変更しない。担当表が SKILL.md にある前提で書かれた説明コメントだけを実体へ追随させる。

変更前(L122-123):

```ts
// claude-model-policy 専用の担当表。フォールバック先と外部モデルの読み替え先を兼ねる。
// 複数モデルを持つ帯がある。担当表が変わったらここも変える。
```

変更後:

```ts
// 共通規律 §役割の帯 の「Claude モデル」列の正本。claude プロファイルの帯モデルであり、
// custom プロファイルでは委譲先が決まらない帯の読み替え先を兼ねる。値を変えたら規律の表も変える。
```

変更前(L148):

```ts
// custom プロファイルの推奨。custom-policy の担当表と一致させる。
```

変更後:

```ts
// custom プロファイル向けの推奨。setup-agents の提示だけに使う。方針スキルは推奨列を持たない。
```

これにより `src/**/*.ts` の差分は**振る舞い変更 0 行・コメント 2 箇所**になる。`pnpm run build` の出力(`scripts/`)にコメントが含まれるかはバンドラの設定次第であるため、実装時に `git diff --stat plugins/agent-policy/scripts` を確認し、差分が出た場合は同じコミットへ含める(§12-6)。

### 7.14 `plugins/agent-policy/README.md`

| 対象 | 変更 |
| --- | --- |
| L45(`claude` プロファイルの説明) | 「Claude のモデル名で帯を固定する担当表であり」→ 表の所在が変わるため書き換える(下記) |
| L109-128(役割 ID 16 種の表) | **変更しない**。役割 ID の一覧は README の役目であり、規律の表(帯名 / RoleId / 種別 / Agent Tool / Claude モデル)とは列も読者も異なる。README は利用者が setup 前に読む文書、規律はセッションに載る指示書である |
| L130-142(推奨モデル ID 9 種) | **変更しない**。setup-agents の入力値の説明であり、帯ごとの推奨列ではない |
| §旧バージョンからの移行(L206 の直後) | 「0.16 系から 0.17 系へ移行する場合」の節を新設する(下記) |

L45 の変更前:

```markdown
| `claude` | `agent-policy:claude-model-policy` を注入します。Claude のモデル名で帯を固定する担当表であり、Agent 定義のセットアップは不要です。 |
```

L45 の変更後:

```markdown
| `claude` | `agent-policy:claude-model-policy` を注入します。役割の帯の一覧は共通規律にあり、その「Claude モデル」列で帯を固定します。Agent 定義のセットアップは不要です。 |
```

追加する移行節:

```markdown
0.16 系から 0.17 系へ移行する場合は、次を確認してください。

1. 役割の帯の一覧(帯名・役割 ID・種別・Agent Tool の可否・Claude モデル)を `references/orchestration-discipline.md` の「役割の帯」節へ集約しました。`claude-model-policy` と `custom-policy` の表は削除しています。両方針スキルは以前から共通規律を必読としているため、動作は変わりません。
2. `custom-policy` の推奨モデル列を廃止しました。推奨は `agent-policy:setup-agents` の提示(`--list-live-models` の `recommendedFor`、`--list-coverage` の `models`)だけで参照します。セッション中に推奨モデルの一覧が要るときは setup-agents を使ってください。
3. custom プロファイルで対応表に無い帯を読み替えるとき、読み替え先は共通規律の「役割の帯」表の「Claude モデル」列になりました。以前は `claude-model-policy` の表を参照する記述でしたが、custom が成立したセッションではその方針が注入されないため、参照が解決できませんでした。
4. 役割 ID・役割断片・フックの動作は変更していません。生成済みの Agent 定義はそのまま使えます。setup-agents の再実行も不要です。ただし共通断片 `_common.md`(日本語)のアドバイザー相談の項で、参照先の呼称を「担当表」から「対応表」へ直しました。サブエージェントへ届くのは役割マーカーの対応表だけであるためです。この変更は次回以降に生成する定義へ反映されます。
```

### 7.15 ルート `README.md` L112

L59(プラグイン一覧の説明)は変更しない。帯の表・推奨モデル列に触れていないためである。L112 は「custom プロファイルは**役割の帯(role-id)だけを持つ担当表**を使い」と書いており、custom が担当表を所有する前提であるため書き換える。

変更前:

```markdown
claude プロファイルは Claude のモデル名で役割の帯を固定し、セットアップなしで利用できます。custom プロファイルは役割の帯(role-id)だけを持つ担当表を使い、プロジェクトの Agent 定義に付いた役割マーカーで委譲先を決めます。`agent-policy:setup-agents` で 16 の役割帯と GPT Astra を含む 9 つの推奨モデル ID から構成を一括生成できます。<br>
```

変更後:

```markdown
役割の帯の一覧は共通規律に 1 つだけ持ちます。claude プロファイルはその表の Claude モデル列で帯を固定し、セットアップなしで利用できます。custom プロファイルは同じ表を使い、プロジェクトの Agent 定義に付いた役割マーカー(role-id)で委譲先を決めます。`agent-policy:setup-agents` で 16 の役割帯と GPT Astra を含む 9 つの推奨モデル ID から構成を一括生成できます。<br>
```

「16 の役割帯」「9 つの推奨モデル ID」の数は変わらない。

### 7.16 バージョン

`plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` の `version` を `0.16.0-dev` → `0.17.0-dev` にする。変更が文書中心でも、3 文書の構造変更と担当表の所在変更を含むためマイナーを上げる(保護パス規約「変更が多いときはマイナーを上げる」)。

## 8. 影響ファイル

新規:

- `plugins/agent-policy/src/agents/__test__/discipline-role-table.test.ts`

変更(文書):

- `plugins/agent-policy/references/orchestration-discipline.md`(§7.1-7.6)
- `plugins/agent-policy/references/context-map-guide.md`(§7.10。L12 の「・最終レビュー」削除)
- `plugins/agent-policy/skills/claude-model-policy/SKILL.md`(§7.7)
- `plugins/agent-policy/skills/custom-policy/SKILL.md`(§7.8。本文と frontmatter `description`)
- `plugins/agent-policy/assets/roles/ja/_common.md`(§7.11。L14 の「担当表の」→「対応表の」)
- `plugins/agent-policy/README.md`(§7.14。L45 と移行節)
- ルート `README.md`(§7.15。L112)

変更(コード。振る舞い変更 0 行):

- `plugins/agent-policy/src/agents/policies.ts`(§7.13。説明コメント 2 箇所)

変更(メタ):

- `plugins/agent-policy/.claude-plugin/plugin.json`(`0.17.0-dev`)
- `plugins/agent-policy/package.json`(`0.17.0-dev`)

削除:

- `plugins/agent-policy/src/agents/__test__/policy-skill-assignments.test.ts`(§9.1 の後継テストへ置換)

変更しない(確認済み):

- `plugins/agent-policy/src/**/*.ts` — `policies.ts` のコメント 2 箇所を除き全ファイル。実行される行の変更は 0
- `plugins/agent-policy/references/subagent-discipline.md`(§6.3)
- `plugins/agent-policy/assets/roles/en/_common.md`、`assets/roles/{ja,en}/<role>.md` 16 本 × 2、`assets/context-map-template.md`(§7.11、§4.5)
- `plugins/agent-policy/skills/setup-agents/SKILL.md`
- ルート `README.md` L59
- `.claude-plugin/marketplace.json`

実装完了後に更新するもの:

- `.serena/memories/agent_policy/core.md` — 実測した現況は L1 が `0.16.0-dev`、L48 の見出しが「### Role fragments and the 16 role IDs」であり、どちらも 0.16 時点に追随済みである(当初この設計書に書いた「`0.14.0-dev` のまま」「10 role IDs」は誤りで、2026-09-07 設計書 §8-5 の記述をそのまま引き写したことによる。訂正した)。本改修で更新するのは次の 3 点である。(1) L1 のバージョンを `0.17.0-dev` へ。(2) L179「## The two policy skills — role tables」節 — 両 SKILL が表を持つ前提の記述を、表は共通規律 §役割の帯 の 1 箇所であり `RECOMMENDED` は setup-agents 専用になった旨へ改める(節名も `role tables` から実体に合う名へ)。(3) L206「Custom's execution-tier resolution」— 手順 2 の読み替え先が共通規律の「Claude モデル」列になった旨。あわせて設計書の一覧へ本設計書を追加する。
- `harness-docs/ARCHITECTURE.md` — grep した限り ARCHITECTURE が `agent-policy` を名指しするのは ADR-001(MCP ツールの許可はサーバー単位、禁止はツール単位)だけであり、役割 ID・帯・フック構成は載っていない。**本改修は ARCHITECTURE に影響しないと判断する**。新規ファイルはテスト 1 本のみで、既存のドメインマップ glob の範囲内に入る見込みだが、実装時に確認する。取りこぼしがあれば `/metatron:update` で追随する。

## 9. テスト方針

### 9.1 後継テスト `src/agents/__test__/discipline-role-table.test.ts`(新設)

配置は `.claude/rules/metatron/testing-policy.md` に従い、判定の正本である `src/agents/roles.ts` / `policies.ts` と同じディレクトリの `__test__/` に置く。既存の `policy-skill-assignments.test.ts` が `src/agents/__test__/` から `skills/*/SKILL.md` を読んでいたのと同じ先例に倣う。

検査内容:

| # | 検査 | オラクル |
| --- | --- | --- |
| 1 | `## 役割の帯` 節が存在し、表を 1 つ持つ | — |
| 2 | 表のデータ行数が `ROLES.length` と等しい | `ROLES` |
| 3 | 行の並びが `ROLES` の定義順と一致する | `ROLES` |
| 4 | 各行の「帯名」セルが `role.label` と**完全一致**する | `ROLES[].label` |
| 5 | 各行の「RoleId」セルのバッククォート語が `role.id` と一致する | `ROLES[].id` |
| 6 | 各行の「種別」セルのバッククォート語が `role.kind` と一致する | `ROLES[].kind` |
| 7 | 各行の「Agent Tool」セルが `allowsAgentTool([role.id]) ? "可" : "否"` と一致する | `allowsAgentTool`(`SOLO_DENIED_ROLES` は非公開のため関数を使う) |
| 8 | 各行の「Claude モデル」セルのバッククォート語を `MODEL_IDS` で解決した配列が `ASSIGNMENTS["claude-model-policy"][role.id]` と一致する | `ASSIGNMENTS` |
| 9 | 未知のモデル語で例外を投げる(合成入力) | — |
| 10 | 未知の帯名で例外を投げる(合成入力) | — |

**現行 `parseTable`(L54-91)は流用できない。** 旧表は 2 列(帯名 / モデル)であり、パーサは第 2 セルのバッククォート語をモデル名として `MODEL_IDS` で解決し、未知語で throw する(L78-87)。新表の第 2 セルは **RoleId**(`` `complex-impl` `` 等)であるため、同じパーサを当てると全行が「未知のモデル『complex-impl』」で throw する。再利用できるのは `MODEL_IDS` 辞書(L39-49)と「未知語は黙って捨てず throw する」という方針だけである。

新パーサの仕様:

- `## 役割の帯` 見出しから次の `## ` 見出しの直前までを節として切り出す(現行 `parseSkillAssignments` L98-105 と同じ方式。節が無ければ throw)。
- 節内の `|` で始まる行を集める。**先頭のヘッダ行**(`| 帯名 | RoleId | …`)と**区切り行**(セルが `---` だけで構成される行)を明示的にスキップする。行内容による推測ではなく、位置とパターンの両方で判定する。
- 残った各行を `split("|").slice(1, -1)` で分割し、**5 セルであることを検査**する(セル数が違えば throw)。セルは**列インデックス**で取り出す(0=帯名、1=RoleId、2=種別、3=Agent Tool、4=Claude モデル)。第 2 セル欠落による行スキップ(現行 L65)は行わない。
- 帯名(0 列)は `role.label` と**完全一致**で照合する。旧テストが `startsWith` の前方一致(L67-70)だったのは SKILL の表が「リアルタイム情報調査(最新動向・外部エコシステム)」のように括弧書きを持っていたためであり、新表は `label` そのものを書く。完全一致にすることで括弧書きの再混入と label のずれを両方検出でき、前方一致の複数マッチ判定(L72-77)も不要になる。
- 未知の帯名は throw する。ヘッダ行と区切り行を先に除外しているため、「照合できない行は無視する」という逃げ道を持たせない。
- RoleId(1 列)・種別(2 列)はバッククォート語を 1 つ取り出す。
- Agent Tool(3 列)は文字列「可」「否」で判定し、それ以外の値は throw する。
- Claude モデル(4 列)はバッククォート語をすべて取り出し、`MODEL_IDS` で解決する。未知語は throw する(現行 L82-86 と同じ)。

合成入力による負のテスト(現行 L124-140)も 5 列で書き直す。

- 未知のモデル語: `| コードレビュー | \`code-review\` | \`readonly\` | 否 | \`Claude 5\` |` → `/未知のモデル「Claude 5」/`
- 未知の帯名: `| 未知の帯 | \`code-review\` | \`readonly\` | 否 | \`Sonnet\` |` → 帯名が解決できない旨で throw
- 正常系: `| コードレビュー | \`code-review\` | \`readonly\` | 否 | \`Sonnet\` |` が通る

**削除するもの**: `POLICY_SKILLS` による 2 スキルのループ(L12-37 / L142-168)、`RECOMMENDED` との突合せ(L26 / L93-105 の custom 経路)、`parseSkillAssignments` の 2 スキル引数。

### 9.2 表の再混入を検出する負のテスト(同ファイル内に追加)

カタログを 1 箇所に保つという本改修の目的は、規律の表が正本であるという検査だけでは守れない。SKILL.md 側へ表が再び書かれても、規律側の表が正しいままなら §9.1 の検査は通ってしまう。二重管理の再発は必ず検出したいので、次を追加する。

| # | 検査 | 対象 |
| --- | --- | --- |
| 11 | `skills/claude-model-policy/SKILL.md` に Markdown 表が無い(`|` で始まる行が 1 行も無い)、かつ「役割の帯」「モデル別役割」の見出しが無い | claude SKILL |
| 12 | `skills/custom-policy/SKILL.md` に Markdown 表が無い(同上)、かつ「役割の帯」の見出しが無い | custom SKILL |

判定は「`|` で始まる行が無いこと」を主とし、見出しの不在を補助にする。両 SKILL は変更後に表を 1 つも持たないため(§7.7・§7.8 の変更後全文)、この検査は素直に書ける。将来 SKILL に表を足す正当な理由が出たときは、このテストを外す判断とセットで行うことになり、二重管理が意図せず戻ることを防げる。

### 9.3 既存テストへの影響

Grep で確認した結果、追随が要るテストは無い。

| 対象 | 判定 |
| --- | --- |
| `src/agents/__test__/policies.test.ts` | `ASSIGNMENTS` / `RECOMMENDED` / `allowsAgentTool` の値を直接固定するテスト。コードの振る舞い無変更のため追随不要。`RECOMMENDED` の値は L35-52 の `EXPECTED_RECOMMENDED` が引き続き固定するため、SKILL との突合せを外しても値の回帰は検出できる |
| `src/agents/__test__/roles.test.ts` | `ROLES` 無変更のため追随不要 |
| `src/agents/__test__/compose.test.ts` / `fragments.test.ts` | `assets/roles/**` 無変更のため追随不要 |
| `src/__test__/setup-agents.test.ts` | `RECOMMENDED` 無変更のため追随不要 |
| `src/hooks/__test__/session-start.test.ts` / `subagent-start.test.ts` / `marker-scan.test.ts` / `delegation-gate.test.ts` | フックの文字列を変更しないため追随不要。`subagent-start.test.ts` L230 は `references/subagent-discipline.md` の存在に依存するが、同ファイルは無変更 |
| SKILL.md を読むテスト | `policy-skill-assignments.test.ts` の 1 本だけ(`grep -rln "SKILL.md" src/` で確認)。これを削除するため、SKILL.md の文言を変えても落ちるテストは無くなる |

### 9.4 サイズの検証

実装後に次を実行し、要件 8 の上限を満たすことを確認して記録に残す(規律 L101 そのものの適用ではない。§4.3)。

```bash
wc -c plugins/agent-policy/references/orchestration-discipline.md \
      plugins/agent-policy/references/context-map-guide.md \
      plugins/agent-policy/references/subagent-discipline.md \
      plugins/agent-policy/skills/claude-model-policy/SKILL.md \
      plugins/agent-policy/skills/custom-policy/SKILL.md
```

`references/` 3 本の合計が 30,720 B(30KB)未満であること。見込みは 21,243 B から §11.1 の決定 2 / 決定 4 の反映分(数十 B)を差し引いた値であり、実行結果で確定させる(§5)。SKILL 2 本も同時に測り、§5 の表を実測値へ更新する。

### 9.5 実装順序

1. 後継テスト(§9.1 の検査 1-10 と §9.2 の検査 11-12)を先に書き、現行の規律・SKILL に対して落ちることを確認する(テスト先行)。
2. 規律を改訂して検査 1-10 を通す。
3. 両 SKILL.md を改訂して検査 11-12 を通す。
4. 旧テスト `policy-skill-assignments.test.ts` を削除する。
5. `context-map-guide.md`・`assets/roles/ja/_common.md`・`policies.ts` のコメントを追随させる。
6. README 2 本・バージョンを追随させ、`wc -c` でサイズを確定する。

## 10. リスクと受容

| リスク | 受容の理由と対処 |
| --- | --- |
| `claude-model-policy` が約 2.2KB になり、モデル割当を自身の中に持たなくなる。共通規律を読まないオーケストレーターは帯もモデルも知らないまま作業を始めうる | 両 SKILL は以前から L10 で共通規律を必読としており、規律を読まない経路は今も同じだけ壊れている(規律にしか無い条項が多数ある)。加えて冒頭に「担当表(…)はその文書の §役割の帯 にある」と所在を明記し、欠けている情報が何でどこにあるかを 1 文で示す。受容する |
| 共通規律に Claude のモデル名が入り、ベンダー中立でなくなる | 規律は既に `Fable`(L27)と `claude-model-policy`(L39)を名指ししている。中立性は元から成立しておらず、本改修はむしろ名指し先の文書参照を減らす。列名を「Claude モデル」として、custom 運用では読み替え先にすぎないことを表の直下に明記する |
| 表が規律に入ることで、規律が「毎セッション読む指示書」から「カタログ」寄りになる | 表は 16 行・約 1.5KB であり、削除する重複規律(6 帯列挙 × 3、15 帯列挙、読み取り帯の文言 × 3、独立レビュー手順 × 2)の合計より小さい。セッションあたりのプロンプト総量は両プロファイルとも減る(§5) |
| 推奨モデル列が消えることで、custom 構成を作るときの参考情報がセッション内から失われる | 推奨は構成を作る場面(setup)でしか使わない。setup-agents は `--list-live-models` の `recommendedFor`(`src/setup-agents.ts` L708)と `--list-coverage` の `models`(同 L820)で同じ情報を実在モデルと突き合わせた形で返すため、静的な列より正確である。README の移行節でこの経路を案内する |
| custom-policy の「独立レビューの手順」節が消え、手順が規律側にしか無くなる | 規律 §設計・実装計画の規律 L106-111 が順序・原本のみ・依頼文の文言・採否判断をすべて持つ(§7.6 で補強)。custom 固有の省略規定は「実行帯の解決順」の例外として残る。custom-policy を読む経路は必ず規律も読む |
| 帯名を `label` 完全一致に揃えることで、旧表の括弧書き(「(最新動向・外部エコシステム)」等)が持っていた補足が失われる | 補足は `assets/roles/{ja,en}/*.md` の `description` と本文が持っており、生成された Agent 定義の側で読者に届く。担当表は帯を一意に指すための表であり、説明の場ではない |
| 用語「担当表」を維持したため、表の見出しは「役割の帯」で本文の呼称は「担当表」という二重呼称が残る | 定義文(L5)が両者を明示的に結ぶ。統一するには hooks 2 ファイルの文字列とテスト、`_common.md` ja/en、`context-map-guide.md` の改訂が要り、挙動を変えない改修に回帰面を広げるため見送る(§6.1) |
| SKILL.md を検査するテストが 1 本も無くなる | SKILL.md からカタログが消えるため、機械検査すべき二重管理も消える。残るのは散文だけであり、散文の正しさはテストで固定できる性質のものではない。カタログの二重管理は新テストが規律に対して固定する |
| `RECOMMENDED` が SKILL との突合せを失い、値が実態から乖離しても気付きにくくなる | `policies.test.ts` L35-52 の `EXPECTED_RECOMMENDED` が 16 帯の値を固定しており、無断の変更は落ちる。乖離の検出力は「もう 1 箇所の手書きの表と一致するか」から「テストの期待値と一致するか」に変わるだけで、弱まらない |
| `assets/roles/ja/_common.md` を変更すると、`ja` / `en` 以外の言語の翻訳断片が stale 判定になり、再翻訳または英語ソースでの上書きが要る | **実測の結果、この経路は成立しない。**`src/agents/fragments.ts` L209-212 の `bundledDir` は `ja` / `en` 以外の言語に対して `assets/roles/**en**` を返し、L288 の `bodyHash` と L299 の `source-hash` はいずれも**英語断片**の本文から計算される(L298 が `source-lang: en` を書き込むのもこのためである)。本改修は `en/_common.md` を変更しない(§7.11)ため、翻訳断片の `source-hash` は一致したままであり、L259 の stale 判定にも L292 の上書き判定にも掛からない。ja 断片の変更が翻訳へ波及する経路は存在しない。既存の翻訳断片は英語由来のため「対応表」の語も持たず、追随作業は発生しない |
| `ja/_common.md` の「担当表」→「対応表」により、既に生成済みの Agent 定義と新規生成の定義で文言が食い違う | 生成済み定義は合成時にファイルへ焼き込まれるため、再生成するまで旧文言のまま残る。どちらの語も「アドバイザー帯の定義を使う」という同じ動作を指し、旧文言でも動作は変わらない(サブエージェントには `subagent-discipline.md` L8 の「対応表の」が SubagentStart から別途届く)。README の移行節でこの差を明示する(§7.14) |
| `policies.ts` のコメント変更が `pnpm run build` の出力に現れ、`scripts/` に差分が出る | 出た場合は同じコミットへ含める(規約「`plugins/*/src/` を変更したなら `pnpm run build` を実行し、`scripts/` の差分が同じコミットにある」)。差分が出るか否かはバンドラのコメント保持設定次第であり、実装時に `git diff --stat` で確認する。振る舞いは変わらないため、差分の有無は結果に影響しない |

## 11. 解決済みの論点と未解決事項

### 11.1 解決済み(オーケストレーター決定 2026-09-09)

第 1 版で挙げた論点 1-4 は、独立レビューの結果を踏まえてオーケストレーターが採否を確定した。決定内容は本文へ反映済みである。

| # | 論点 | 決定 | 反映先 |
| --- | --- | --- | --- |
| 1 | `claude-model-policy` L34(委譲時の帯明示と Output Format 指定)が `custom-policy` L55 と重複している | **採用。**共通規律の §モデル別役割の運用 へ 1 行として引き上げ、両 SKILL から削除する | §6.5、§7.2、§7.7、§7.8 |
| 2 | `custom-policy` L57(名指し dispatch は共通規律に従う)の削除是非 | **残す。**規律とは別の指示書から読み始めた場合に、名指し dispatch と役割ベース dispatch の境界へ到達する経路を保つ | §6.6、§7.8 |
| 3 | `assets/roles/ja/_common.md` L14 の「担当表の」と `subagent-discipline.md` L8 の「対応表の」の食い違い | **採用。**`ja/_common.md` L14 を「対応表の」へ直す。サブエージェントへ届くのは対応表だけである。`en/_common.md` は該当語を持たないため変更しない | §6.1 の訂正、§7.11、§10 |
| 4 | `context-map-guide.md` L12 がオーケストレーターの担当に「最終レビュー」を含み、共通規律 L9 の 5 つと食い違う | **採用。**「・最終レビュー」を削除し、規律 L9 の 5 つ(dispatch・要件確定・採否判断・承認・分析)へ揃える | §7.10 |

### 11.2 未解決事項

1. **推奨モデル列の廃止による運用上の実効。** custom セッションから推奨列が消えたときに、未割当帯の読み替え(実行帯の解決順 手順 2)と同帯複数定義の選択が実際に安定するかは未計測である。本改修の動機の一つが「推奨列が競合信号になる」という仮説(§2)であり、その効果は運用後に観測して判断する。悪化が観測された場合の戻し先は「setup-agents を呼んで推奨を確認する」経路であり、SKILL への表の復活ではない(§9.2 の検査 11-12 がそれを阻む)。

## 12. 実施手順と Done 条件

1. 本設計書(第 2 版)をユーザーへ提示して承認を得る。第 1 版に対する「設計書・実装計画書のレビュー」帯と「設計書・実装計画書の独立レビュー」帯のレビューは実施済みで、採否はオーケストレーターが確定した(§1.1・§1.2 の追加行、§6.5・§6.6、§7.10・§7.11・§7.13・§7.14・§7.15、§9.1・§9.2、§10、§11.1)。
2. 承認後、本設計書を入力に実装計画書(WBS)を別途起こす。本設計書には含めない。
3. 着手時に最新の `git status` と HEAD で対象を再確認し、`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の baseline を記録する。無関係な未コミット変更を revert しない。
4. §9.5 の順序で実装する。
5. 担当の割り当て:
   - AI が読む指示書の本文(`skills/*/SKILL.md` の本文・`references/*.md`・`assets/roles/ja/_common.md`)の改修は、`prompt-smith:prompt-smith` スキルをロードした担当に行わせる。
   - `skills/custom-policy/SKILL.md` の frontmatter `description`(§7.8)は、スキル定義の description の改稿にあたるため `prompt-smith:skill-creator` をロードした担当に行わせる。発火測定の要否もその担当が判断する。
   - README 2 本・設計書・Serena メモリ・テストコード・`policies.ts` のコメントは上記スキルの対象外とする。
6. Done 条件:
   - `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
   - `src/agents/__test__/discipline-role-table.test.ts` が 16 帯すべてを 5 列とも正本と一致させ(検査 1-10)、両 SKILL に表が無いこと(検査 11-12)を確認して通り、`policy-skill-assignments.test.ts` が削除されている。
   - `plugins/agent-policy/src/**/*.ts` の差分が**振る舞い変更 0 行・`policies.ts` のコメント 2 箇所のみ**であること(`git diff plugins/agent-policy/src` で確認)。`pnpm run build` を実行し、`scripts/` に差分が出た場合は同じコミットへ含める。
   - `plugins/agent-policy/.claude-plugin/plugin.json` と `package.json` が揃って `0.17.0-dev`。
   - `wc -c` で `references/` 3 本の合計が 30,720 B 未満であり、実測値が記録されている(§9.4)。
   - `plugins/agent-policy/README.md` に「0.16 系から 0.17 系へ移行する場合」の節があり、L45 が追随している。ルート `README.md` L112 が追随している。
   - `.serena/memories/agent_policy/core.md` の 3 点(§8)が更新されている。
   - ARCHITECTURE への影響が無いことを確認した記録を残す。影響があれば `/metatron:update` で追随する。
