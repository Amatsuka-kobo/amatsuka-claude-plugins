# Codiel同梱Agentのスキル化設計

- 日付: 2026-09-22
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 設計書・WBS (執筆中)
- 前提: agent-policy外部Agent割当設計、Codiel引継ぎ書
- セッション ID: ad26f790-766d-4985-b358-7cc29035014e

---

## セッション 1: Codiel同梱Agentのスキル化設計を開始

# phyllis998

> プラグインインストール先のプロジェクト最適化の観点から、Codielの同梱AgentsをSkillsにしてしまいたい件の設計を行います。
> このプロジェクトのどこかに、そのことについて議論した記録が残っているはずなので申し訳ないですが探し出してください。
> 今回は設計と引継ぎをゴールとします。

# AI

探索→設計→引継ぎ。まず規律ロード。

探索継続中。記録 2 本特定済み(0915 引継ぎ書 §2.3-4 / §8、0910 の互換性調査)。chat-reader 読解中。並行して設計材料を収集。

探索完了、要件分析中。Claude Code 機構(skills frontmatter / SubagentStop 入力)の裏取りを待ちつつ、引継ぎスキルと設計書書式を確認。

探索完了。要件確定 → 規律どおり context-map 作成を探索統括へ委譲(残りの一次確認込み)。

探索結果と Claude Code 仕様の裏取りが揃った。context-map 作成は並行中。設計を左右する判断 4 点を先に確認する。

要件確定。設計書と WBS の執筆を委譲。

設計書執筆中(system-planner)。完了後 doc-review(Haiku)→ independent-review(grok)→ 採否 → 提示 → 引継ぎ書。待機。

設計書・WBS 執筆中(system-planner、opus)。完了通知後にレビュー 2 段(doc-review → independent-review)へ進む。

## セッション 2: 設計書・計画の承認レビューと改訂完了

# AI

記録探索完了、方針 4 点確定、設計書・WBS 執筆中。現状の中間報告。

## 見つけた記録

- **方針の原発言**: 2026-09-15 のドメインマップ分離セッション(`docs/chat/2026/0915/phyllis998/1915-codiel-domain-decoupling-investigation.md:584`)。「将来的には Codiel の同梱 Agents を大方削除し、Skills に落とす予定(agent-policy との共存強化施策)」。引継ぎ書 `harness-docs/handover/2026-09-15-codiel-domain-map-decoupling-handover.md` §2.3-4 と §8 に転記済み。
- **動機の根拠**: 2026-09-10 の互換検査(`docs/chat/2026/0910/phyllis998/1155-codiel-agent-policy-compatibility.md`)。名指し dispatch は「原本を特定できない → そのまま起動」に倒れ、プロジェクト最適化(model / MCP / 本文)が届かない(F2)。所見 F4(SubagentStop 誤 block)、F5(スキル連鎖と転記条項の衝突)、F6(parallel-nudge と逐次規律の衝突)、F7(優先順未定義)は判断待ちのまま未着手。
- **将来設計の制約**: 設計書 `harness-docs/design/2026-09-15-codiel-domain-map-decoupling-design.md` §5.5 が「Skills 化で残るもの・消えるもの」を記載済み。

## 確定した方針(回答済み 4 点)

1. 残す Agent: analyst / test-designer / tester の 3 体。12 体削除。
2. 対応表が無いセッション: ビルトイン(general-purpose / Explore)へ縮退。
3. スキル本文の届け方: 依頼文で「codiel:<skill> を読め」と指示(Read があれば Skill ツール不要)。
4. agent-policy 側の追随(F5/F6/F7): スコープに含める。

## 進行中

- context-map 完成: `.claude/context-maps/2026-09-22-codiel-agents-to-skills.md`
- 設計書 + WBS 執筆中(system-planner)。完了後 doc-review → independent-review → 採否 → 提示 → 引継ぎ書の順。

記録完了。設計書執筆(system-planner)と Raphael 蒸留は継続中。完了通知待ち。

設計書執筆と抗体蒸留、継続中。完了通知待ち。

抗体蒸留完了(5 件、新規抗体なし)。設計書執筆(system-planner)継続中。完了通知待ち。

設計書執筆(system-planner)継続中。完了通知待ち。

設計書・WBS 完成。レビュー 2 段を並列 dispatch(doc-review: knowledge-elicitationer / independent-review: docs-reviewer)。

設計書・WBS 完成。レビュー 2 段(doc-review: haiku / independent-review: grok)並列実行中。

設計担当報告の食い違い 9 点は実ファイル側を正として反映済み。判断要の 1 点: README:68-70 と flowcharts:639 の古い記述(ARCHITECTURE 生成の残骸)はスコープ外として計画書に含めていない。

レビュー完了後に採否判断 → 提示 → 引継ぎ書。待機。

doc-review 到着。independent-review 待ち。両方揃ってから設計書を読んで突き合わせる(要約の要約で判断しない)。

doc-review 完了。independent-review(grok)継続中。両方揃ったら設計書全文を読んで採否判断。待機。

両レビュー到着。設計書全文と計画書の該当節を読み、突き合わせる。

両レビューを設計書・計画書の実文と突き合わせた。採否を決め、修正を設計担当へ戻す。

レビュー採否確定、設計担当が改訂中。採否の要点:

- **採用 24 件**: 事実訂正 6(作業ツリー、対応表 2 行目、30KB の出典、orchestrating-runs に上限を当てない、登録簿コミット分割は成立、flowcharts 行)、設計補強 9(review の set-domain 行削除、RoleId 行欠落時の縮退、縮退の影響範囲、Playwright は届かない、孫リスクの条件、所見書式に generic、F1/F3 の扱い、doc-writing 案を不採用に記録、消費契約は ADR + テストコメントで固定)、計画修正 9(C3 を C2 の後、T4 検証範囲、T3/T1 の登録簿保護、T14→T12、T18-10、完了条件の具体化、README/flowcharts の古い記述 2 件を T13 に含める、context-map 所在)。
- **不採用 4 件**: 二重状態は赤ではない、ARCHITECTURE 保護と DESIGN.md 編集は別ファイル、並列は現行維持、T16 の依存図配置。

改訂完了後、ユーザー提示 → 引継ぎ書。待機。

完了通知は来たが報告本文が届いていない。改訂結果をファイルで確認する。

改訂を実ファイルで確認済み(採用 24 件すべて反映)。ユーザー承認に進む。

## 設計書・実装計画書 完成。承認依頼

- 設計書: `harness-docs/design/2026-09-22-codiel-agents-to-skills-design.md`(95KB、§1〜12)
- 実装計画書: `harness-docs/plans/2026-09-22-codiel-agents-to-skills-plan.md`(59KB、T0〜T20、8 コミット)
- context-map: `.claude/context-maps/2026-09-22-codiel-agents-to-skills.md`(git 追跡外)

### 設計の骨子

- **残す 3 体**: analyst / test-designer / tester。**削除 12 体**: architect / planner / implementer 4 / reviewer 6。
- **委譲先**: discuss・design・dev-plan → `design-plan`、implement・test-loop B・fix-loop 修正 → `normal-impl`、review・再レビュー → `code-review`(観点ごと 1 dispatch、並列可)。対応表が無い、または該当 RoleId の行が無い役割はビルトイン(`general-purpose` / `Explore`)へ縮退。
- **スキルの届け方**: 依頼文に絶対パスを列挙し「読め」と指示。フェーズが必要とするスキルを全部挙げて F5(スキル連鎖と転記条項の衝突)を codiel 側で解消。
- **固有部の行き先**: implementer の注意 → `implementing` の新節「ドメイン別の注意」、reviewer 6 観点 → `reviewing-diffs` の「観点別の焦点」節(所見書式にも generic を追加)。新 `references/` は作らない。
- **SubagentStop hook 廃止**(F4 の孫脱出不能。成果物確認はオーケストレーターの既存義務が代替)。
- **agent-policy 追随**: parallel-nudge 文言(F6)、規律に「コマンド起動したスキルの手順が優先」の 1 文(F7、残量 324B のため既存文削減を既定手順化)。
- **消費契約の固定**: 対応表の行の形と 2 行目の候補範囲を ADR の「帰結」と marker-scan.test.ts のコメントに記す。
- **バージョン**: codiel 0.9.0-dev / agent-policy 0.19.7-dev / metatron 0.3.8-dev。

### レビュー結果

doc-review(haiku)と independent-review(grok)の指摘 41 件のうち 24 件採用・反映済み。主な反映: 対応表 2 行目の候補範囲も契約に含める、30KB 上限は orchestrating-runs に当てない、review の set-domain 行(L234)を削除、Playwright は本文へ移しても届かない(リスク 8 として受容)、C3(Agent 削除)を C2(orchestrating-runs 改訂)の後に固定、README:68-70 と flowcharts:639 の古い記述を T13 に含める。

### 未解決事項(§12、完了条件に含めない)

1. 残る 3 Agent の `model` 未宣言(コストは下がらない)
2. review 6 観点を 1 dispatch にまとめる余地
3. 発火測定を行わない判断の見直し時期

### 受容したリスク

構造的ハーネス(tools 制限)が文面の規律へ後退する。tester 側は Agent が残るので保証維持、review 側は対応表の readonly 定義か `Explore` 縮退で維持、`Write` を持つ定義が `code-review` に結び付く経路だけ依頼文の限定条項で担保。

承認をいただければ、引継ぎ書(`harness-docs/handover/`)と goal プロンプト(`docs/prompts/`)を作成してコミットします。修正点があれば指摘してください。

# phyllis998

> 委譲先の決め方について、役割マーカー云々はagent-policy併用の場合既に役割マーカーや対応表についての知識が付いているはずで、Codiel側で言及する必要はないように感じます。

# AI

採用。codiel は機構(対応表・RoleId・行の形)を知らず、役割を言葉で表すだけにする。設計書へ反映を指示。

指摘採用。変更の要点:

- codiel は解決機構(対応表・RoleId・行の形)に一切言及しない。各フェーズの委譲を「設計書・実装計画書(WBS)の作成」「通常の実装」「コードレビュー」の役割の言葉で表すだけ。
- 解決はセッションに注入された運用の規律に委ねる。規律が無ければビルトインへ縮退。
- 副次効果: 消費契約(行の形・候補範囲)が消滅 → ADR の帰結と marker-scan.test.ts のコメント追加を撤回。§3.4、§5.8 の契約固定、T10 の該当項目を削除。
- 役割の文言は担当表の役割名と揃えるが硬い契約ではない(規律の解決順が文言の不一致を吸収)。

設計担当が改訂中。完了後、§5.2 表・§5.3・計画 §5.1 を提示。

設計担当(system-planner)が改訂中。完了通知待ち。

## セッション 3: Codiel設計簡素化: 機構参照を廃止

# AI

記録完了。設計書改訂(system-planner)継続中。完了通知待ち。

設計書改訂継続中。完了通知待ち。

# phyllis998

> 役割の名指しも必要ないように感じます。最近のAIは賢いので、agent-policyがある

# AI

報告本文が届いていない。改訂結果をファイルで確認。

残存 5 件はすべて「言及しない」という決定の記述と検証条件。機構への依存は消えている。指示された 3 箇所を確認。

改訂確認済み。指摘は反映されている。

## 改訂後の要点

**設計書 §5.2 の表(委譲先列)**

- init / test-spec / test-loop A / fix-loop 回帰: 名指し(analyst / test-designer / tester)
- discuss・design・dev-plan: 役割「設計書・実装計画書(WBS)の作成」
- implement・test-loop B・fix-loop 修正: 役割「通常の実装」(逐次 1 体ずつ)
- review・再レビュー: 役割「コードレビュー」(観点ごと 1 dispatch、並列可、set-domain しない)

**§5.3 縮退規則(codiel が §4 に置く唯一の規則)**

> 委譲先は、セッションに注入されているエージェント運用の規律に従って役割から決める。そのような規律が無いときは、成果物を書く役割は `general-purpose`、読み取りだけの役割は `Explore` へ dispatch する。

候補の絞り込み・複数候補の選び方・役割が無いときの扱いは規律側の仕事として書かない。

**消えたもの**: §3.4(対応表の行の形)、消費契約の ADR 記載と marker-scan.test.ts コメント、RoleId 分岐。役割の文言は担当表と揃えるが硬い契約ではない(§5.8)。

**受け入れ基準に追加**: codiel の指示層に「対応表」「RoleId」「役割マーカー」の語が 0 件(T18-12)。

この内容で承認いただければ、引継ぎ書と goal プロンプトを作成し、設計書・計画書・引継ぎ書・プロンプト・会話記録をコミットします。

承認待ち。承認後、引継ぎ書と goal プロンプトの作成 → コミットへ進む。

## セッション 4: Codiel設計簡素化: 役割名指定を廃止

# phyllis998

> 役割の名指しも必要ないように感じます。最近のAIは賢いので、役割を指定しなくとも"やること"によって適切なエージェントに委譲してくれます。もちろんCodiel単体完結の原則があるので"サブエージェントに委譲する"ことを明記する必要はありますが。
> それに、「通常の実装」と明記してしまうとすべての実装を「通常の実装」帯にしか委譲しなくなってしまいます。

# AI

採用。役割名も消す。codiel が書くのは「サブエージェントに委譲する」「何をやらせるか」「読み取りだけか成果物を書くか」だけ。「通常の実装」固定の弊害も同意。設計書へ反映指示。

指摘採用。変更の要点:

- codiel が書くのは 3 つだけ: **サブエージェントに委譲する**こと、**何をやらせるか**(読ませるスキル + 入出力ファイル)、**成果物を書く委譲か読み取りだけの委譲か**(tools 限定条項と縮退先の決定用)。
- 役割名(「通常の実装」等)は書かない。作業の重さに応じた帯の選択(複雑な実装 / エスカレーション)は規律側に委ねる。
- 縮退規則は「規律が無ければ、成果物を書く委譲は `general-purpose`、読み取りだけは `Explore`」のみ。
- 禁止語リストに担当表の役割名を追加(T18-12)。

設計担当が改訂中。完了後、§5.2 表・§5.3・計画 §5.1 を提示。

記録完了。設計書改訂(system-planner)継続中。完了通知待ち。

設計書改訂継続中。完了通知待ち。

設計書改訂(system-planner)継続中。完了通知待ち。

## セッション 5: 役割名指定廃止で設計簡素化

# AI

記録完了。設計書改訂継続中。完了通知待ち。

設計書改訂継続中。完了通知待ち。

報告本文未着。ファイルで確認。

残存はすべて決定・不採用案・禁止語リストの文脈。指示した 3 箇所を確認。

改訂確認済み。指摘 2 点とも反映されている。

## 改訂後の骨子(2 段階目)

**codiel が委譲について書くのは 3 つだけ**

1. サブエージェントに委譲すること(オーケストレーター自身は実行しない)
2. 何をやらせるか(読ませるスキル + 入出力ファイル)
3. 成果物を書く委譲か、読み取りだけの委譲か

**§5.2 の表(委譲の種別列)**

- 名指し: init(analyst)/ test-spec(test-designer)/ test-loop A・fix-loop 回帰(tester)
- 成果物を書く委譲: discuss / design / dev-plan / implement / test-loop B / fix-loop 修正
- 読み取りだけの委譲: review / 再レビュー(観点ごと 1 dispatch、並列可、set-domain しない)

**§5.3 縮退規則(§4 に置く唯一の規則)**

> 委譲先は、セッションに注入されているエージェント運用の規律に従って決める。そのような規律が無いときは、成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore` へ dispatch する。

作業の重さに応じた帯の選択(複雑な実装・エスカレーション)は規律側の仕事。codiel は固定しない。

**禁止語(T18-12)**: 「対応表」「RoleId」「役割マーカー」+ 担当表の役割名 5 種。`orchestrating-runs` で許す一般語は「サブエージェントに委譲する」「読み取りだけの委譲」など。

**不採用案に追加**: #17 解決機構の明示、#18 役割名での指定(いずれもユーザー指摘 2026-09-23)。

承認いただければ、引継ぎ書と goal プロンプトを作成してコミットします。

# phyllis998

> implementerとreviewerの観点をすべてそれぞれ1つのスキルに統合することはやめたいです。
> これらの観点は、それぞれ強化・追加する予定があり、すべて1つのスキルに統合してしまうとノイズになってしまいます。

# AI

採用。統合をやめ、観点・注意を個別ファイルに分ける。置き場の判断が要る(決定 #5 の「references/ も assets/ も作らない」を覆す)。

置き場の候補と評価:

- **`references/implementing/<domain>.md` と `references/reviewing/<viewpoint>.md`**: 複数の指示から共有する断片の置き場として ARCHITECTURE の定義と一致。metatron の登録簿テスト(V2)が `references/` 直下のみ走査するため、サブディレクトリなら登録不要。ただし ARCHITECTURE のドメインマップ `prompt` に `plugins/*/references/**` が含まれ、指示層として prompt-smith の対象になる(観点は指示書なので適切)。
- **観点ごとに独立スキル(`skills/reviewing-frontend/` 等)**: 依頼文で Read させるので発火は不要。ただし SKILL.md 1 つずつ frontmatter と description が要り、増設のたびに skill-creator の手順が乗る。過剰。
- **`assets/`**: 「実行時に読み込む素材」の定義。不採用案 #9 の理由(「読まなくてもよい」余地)は依頼文で明示 Read させれば消えるが、指示書としての監査対象(prompt-smith)から外れるので不適。

推奨: `references/` にサブディレクトリを切る。依頼文が観点ファイルの絶対パスを列挙する形(スキルと同じ届け方)。

指摘は正しい。`implementing` と `reviewing-diffs` からしか読まれないなら「複数の指示から共有」に当たらず、`references/` の定義から外れる。

見落としていた選択肢: **スキルディレクトリの配下**。Claude Code のスキルは `skills/<name>/` に SKILL.md 以外の補助ファイルを置ける(prompt-smith 自身が `skills/prompt-smith/references/` を持つ前例あり。skill-creator も `assets/`)。

推奨: `skills/implementing/references/<domain>.md` と `skills/reviewing-diffs/references/<viewpoint>.md`。

- 読み手が 1 スキルに閉じるので、スキルの一部として同居する。ARCHITECTURE の `references/` 定義(プラグイン直下)にも抵触しない。
- prompt-smith の対象(`references/` というディレクトリ名で決まり、どのプラグインの配下かは問わない)。
- metatron の登録簿テストは `skills/` を再帰走査するので、ARCHITECTURE に言及する `reviewing/doc.md` は登録が要る(統合案でも同じく 2 件登録だったので増減なし)。
- 依頼文はスキルと同じ列に絶対パス(`<plugin-root>/skills/implementing/references/<タグ>.md`)を足す。
- 増設は同じディレクトリへファイル追加のみ。

渡し方は「担当タグに対応するファイルがあれば絶対パスを渡す。無ければ注意なし。unscoped は注意なし」を既定にする。

この配置で進めてよいか。異論なければ設計書へ反映する。

## セッション 6: 観点ファイルの配置をスキルディレクトリ配下に決定

# AI

意見は一致。プラグイン直下の `references/` は「複数の指示から共有」の定義に当たらず不適。

代案: **スキルディレクトリ配下**。`skills/implementing/references/<domain>.md` と `skills/reviewing-diffs/references/<viewpoint>.md`。

- 読み手が 1 スキルに閉じるので、そのスキルの一部として同居。前例あり(prompt-smith は `skills/prompt-smith/references/`、skill-creator は `skills/skill-creator/assets/`)。
- prompt-smith の監査対象(ディレクトリ名 `references/` で決まり、位置は問わない)。
- metatron 登録簿テストは `skills/` を再帰走査。ARCHITECTURE に言及する `reviewing-diffs/references/doc.md` は登録が要る(統合案の 2 件と同数)。
- 依頼文はスキルと同じ列に絶対パス(`<plugin-root>/skills/implementing/references/<タグ>.md`)を足す。増設はファイル追加のみ。

渡し方の既定: 担当タグに対応するファイルがあれば絶対パスを渡す。無ければ注意なし。unscoped も注意なし(現行 generic と同じ)。review は観点ごとに対応ファイルを渡す。

この配置で設計書へ反映してよいか。

配置案(スキルディレクトリ配下の `references/`)への回答待ち。

# phyllis998

> その配置で進めてください

# AI

決定 #5 改定を設計担当へ指示済み。変更の要点:

- 観点 9 ファイルを `skills/implementing/references/{frontend,backend,data}.md` と `skills/reviewing-diffs/references/{frontend,backend,data,doc,security,generic}.md` に個別配置。
- スキル本文は「依頼文で渡された観点ファイルを読んで従う」の 1 文のみ。
- 依頼文は担当タグ / 観点に対応するファイルの絶対パスをスキルと同じ列に列挙。存在しなければ注意なし。
- 登録簿の +2 は `doc.md` へ移る(差引 27 は同じ)。

完了後、§5.5・§6.1・T1 / T2 を提示。待機。

設計書改訂(system-planner)継続中。完了通知待ち。

## セッション 7: Agent削減と観点ファイル配置を決定

# AI

記録完了。設計書改訂継続中。完了通知待ち。

設計書改訂継続中。完了通知待ち。

# phyllis998

> 残るエージェントのモデル定義についてです。まず、codiel-testerも廃止し、skillsに落とし込みます。e2e-verifyかgeneral-purposeに委譲されるはずです。
> 他2つはオーケストレータ―と同じモデルで構いません

# AI

決定 #1 改定: 残す Agent は analyst / test-designer の 2 体、tester も削除。§12-1(model 未宣言)は「継承で構わない」として解決。

一点だけ整合を確認する。tester は `.codiel/specs/**/scripts/` とレポートを書き、区切りごとに commit する(成果物を書く委譲)。縮退先は `general-purpose`。e2e-verify は readonly 帯なので、規律側が選ぶなら成果物を書く帯になる。この点は設計書で「委譲の種別: 成果物を書く委譲」と表すだけで、帯の選択は規律側に委ねる(役割名を書かない決定と同じ扱い)。

指摘 4 点目を設計担当へ指示済み(3 点目の反映中なので、まとめて 1 回で反映させる)。変更の要点:

- 残す Agent は analyst / test-designer の 2 体。tester も削除(13 体削除)。
- tester の委譲は「成果物を書く委譲」。固有規律(期待値不変・アサーション緩和禁止・区切りごと commit 等)は `scripting-tests` / `running-regression-tests` に無い項目だけ足す。Playwright は条件付きで記載。
- 残る 2 体の `model` は継承のまま(§12-1 解決)。
- 未解決事項は 2 件(review 観点の統合余地、発火測定の見直し時期)。

完了後、§5.1・§5.2 表・§12 を提示。待機。

設計書改訂(system-planner、指摘 3・4 をまとめて反映中)。完了通知待ち。

## セッション 8: e2e-verify昇格と観点ファイル配置の決定

# phyllis998

> スコープが広がってしまいますが、e2e-verifyをimpl帯に昇格させたいです

# AI

採用。tester の作業(スクリプトを書き、実行し、commit する)が e2e-verify に行くなら impl 種別が要る。影響範囲を先に実ファイルで確認する。

影響範囲を確認済み。設計担当へ W11(e2e-verify の impl 昇格)を追加指示。

設計担当が指摘 3 の反映を終えて停止したところに、指摘 4・5 の指示がキューに入った状態。次のツールラウンドで受け取る。進捗を確認する。

指摘 3 反映済み、指摘 4 は着手中(17:27 更新)、指摘 5 は未着手。設計担当が継続作業中。完了通知待ち。

設計担当が指摘 4・5 を反映中。完了通知待ち。

# phyllis998

> 再開してください

# AI

セッションが再起動している。状態を確認する。

設計担当サブエージェントはセッション終了で失われた。設計書は指摘 3・4 まで反映済み、指摘 5(e2e-verify の impl 昇格)が途中。計画書は指摘 4・5 とも未反映。残りを確認する。

§1 の決定表は #1〜#12 まで更新済み。本体の節が追随途中。残りを特定する。

ユーザー指摘を受領。「review の 6 観点を 1 dispatch」は不採用で確定、未解決事項から外す。計画書の反映状況を確認してから、残作業をまとめて委譲する。

計画書は指摘 3 まで反映済み。残りを一括で委譲する。

セッション再開。前のセッションの設計担当エージェントは失われていたので、残作業を新しい担当へ引き継いだ。

## 再開時点の状態

- 設計書: 決定表(#1〜#12)とヘッダの改定注記だけが更新済み。本体の節が「3 体 / 12 体」のまま未追随。
- 計画書: 指摘 3(観点の個別ファイル化)まで反映済み。指摘 4・5 は未反映。
- git: 設計書・計画書・会話記録が未追跡のまま。コミットはまだ無い。

## 委譲した残作業

1. **決定 1 の本体追随**: tester も削除して 2 体 / 13 体。tester の固有規律を `scripting-tests` と `running-regression-tests` へ移す突き合わせ表を新設。§5.11(残る 2 体は model 継承)を新設。
2. **決定 12 の本体追随**: `e2e-verify` を impl 種別へ昇格。roles.ts・テスト・担当表・両言語の断片・README・メモリが対象。agent-policy はマイナー(0.20.0-dev)へ。このリポジトリの complex-reviewer は再生成せず、Write を持たない定義に当たるリスクを受容として記載。
3. **未解決事項の整理**: 3 件すべてを解消してゼロ件にする。review の 6 観点を 1 dispatch にまとめる案は不採用で確定。発火測定は、codiel のスキルが名指し起動で発火経路を使わないため原理的に不要という根拠へ差し替え。

完了後、§5.1 と §12 の全文を確認して提示する。

設計書・計画書の改訂作業が進行中。完了通知を待つ。

## セッション 9: プラグイン3体の版情報確認と改訂待機

# AI

設計書・計画書の改訂が進行中。完了通知を待つ。

設計書・計画書の改訂が進行中。完了通知を待つ。

# phyllis998

> agent-policyのバージョンはパッチバージョンアップ据え置きで大丈夫です

# AI

agent-policy はパッチ据え置き(0.19.7-dev)で訂正を送った。3 プラグインのバージョンは codiel 0.9.0-dev、agent-policy 0.19.7-dev、metatron 0.3.8-dev になる。改訂完了を待つ。

設計書・計画書の改訂完了を待つ。

## セッション 10: codiel 役割再設計の完全設計・計画書完成

# AI

設計書・計画書の改訂完了を待つ。

設計書・計画書の改訂完了を待つ。

改訂完了。報告の重要な発見を実ファイルで検証する。

検証完了。報告の 4 つの重要な発見はすべて実ファイルで裏が取れた。

## 設計書・実装計画書が完成

- 設計書: `harness-docs/design/2026-09-22-codiel-agents-to-skills-design.md`(949 行)
- 実装計画書: `harness-docs/plans/2026-09-22-codiel-agents-to-skills-plan.md`(896 行、22 タスク)
- **未解決事項はゼロ件**。5 つの論点すべてが決着した。

## 改訂で判明した重要な事実

**先行設計は `e2e-verify` の readonly を正当化していなかった。** 2026-09-07 の設計書が新設したのは `design-plan` と `explore-lead` の 2 つだけで、`e2e-verify` には命名パターンの例示と並び順の引用でしか触れていない。`readonly` という値は 2026-09-09 の設計書に担当表の写しとして書かれ、そのまま引き継がれてきた。上書きの対象は「引き継がれてきた値そのもの」であり、設計判断の節ではない。この事実を設計書に明記した。

**`codiel-tester` の参照が 7 箇所追加で見つかった。** 改訂前の設計書が「維持する」「変更しない」と書いていた箇所に残っていた。内訳はディスパッチ規約のコミット規約、フェーズ進行表 2 行、DESIGN.md の 4 箇所、Serena メモリ。

**受け入れ検証の grep が `tester` を拾わない設定だった。** 検査語が architect / planner / implementer / reviewer の 4 つしかなく、tester を削除しても検出できない状態だった。全箇所に追加した。

**`e2e-verify` の昇格は 4 つのバンドルに差分を出す。** 役割定義は 3 つの hook と setup-agents のバンドルに埋め込まれており、`readonly` の出現数がそれぞれ 9 件と 14 件ある。「差分は parallel-nudge.mjs だけ」という完了条件は成立しないため、条件を分割した。

**`prompt-smith:agent-creator` を起動するタスクが消えた。** 残る 2 体は変更せず、削除する 13 体はファイルごと消えるため、Agent 定義の本文を直す作業が 1 つも残らない。

## 最終的な設計

残す Agent は `codiel-analyst` と `codiel-test-designer` の 2 体。13 体を削除。委譲は作業内容と種別(成果物を書く / 読み取りだけ)だけで表し、役割名も解決機構も書かない。観点は 9 個の個別ファイルへ。SubagentStop hook を廃止。`e2e-verify` を impl 種別へ昇格。バージョンは codiel 0.9.0-dev、agent-policy 0.19.7-dev、metatron 0.3.8-dev。

承認いただければ、引継ぎ書と goal プロンプトを作成し、設計書・計画書・引継ぎ書・プロンプト・会話記録をコミットします。

# phyllis998

> 引継ぎ書とプロンプトを作成してコミットしてください

# AI

承認を受領。引継ぎ書と goal プロンプトの作成を文書作成の役割へ委譲する。

引継ぎ書とプロンプトの執筆を委譲した。完成後にコミットする。
