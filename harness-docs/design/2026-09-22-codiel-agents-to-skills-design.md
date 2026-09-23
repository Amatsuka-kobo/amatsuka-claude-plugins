# codiel の同梱 Agent 定義を撤去し、ディスパッチ先を作業内容で表す 設計書

- 作成日: 2026-09-22
- 対象プラグイン: `plugins/codiel`(主)、`plugins/agent-policy`(従)、`plugins/metatron`(登録簿 fixtures とバージョンのみ)
- 現行バージョン: codiel `0.8.0-dev` → `0.9.0-dev`、agent-policy `0.19.6-dev` → `0.19.7-dev`、metatron `0.3.7-dev` → `0.3.8-dev`(§5.9)
- 状態: 設計(第 2 版。2026-09-23 のユーザー指摘を 6 段階で反映した。§1 を参照)
- 入力: `.claude/context-maps/2026-09-22-codiel-agents-to-skills.md`(事実の正本)、オーケストレーター確定事項(2026-09-22)
- 先行設計: `harness-docs/design/2026-09-15-codiel-domain-map-decoupling-design.md`。同書 `:322` が本設計を将来設計として予告している
- ADR: 本件で 1 件を新規に切る(§6.10)。ADR-003(`harness-docs/ARCHITECTURE.md:181`)とは別件であり、同 ADR を改訂しない

---

## 1. 確定済みの決定(この設計の前提)

次の 12 件はオーケストレーターとユーザーが 2026-09-22 から 2026-09-23 にかけて確定させた。本設計はこれを前提とし、覆さない。別案も提示しない。**判断が付いていない論点は残っていない(§12)。**

**決定 2 と 3 は 2026-09-23 のユーザー指摘により 2 段階で改めた。**

- **1 段階目(解決機構を外す)。** 当初は「役割マーカーの対応表の RoleId で解決する」と codiel の指示層に書く形だったが、併用時は解決規則がセッションに注入済みであり、codiel が重ねて書くと二重管理になる。単体運用時は機構そのものが存在しない(§10 の不採用案 17)。
- **2 段階目(役割名も外す)。** 残っていた「役割の文言で表す」もやめ、作業内容だけを渡す形にした。役割名を固定すると作業の重さに応じた委譲先の選択が消えるためである(§10 の不採用案 18)。改定後の codiel が持つのは、作業内容と委譲の種別と縮退規則だけである(§5.2、§5.3)。

**決定 5 も 2026-09-23 のユーザー指摘により改めた(3 段階目)。** 当初は implementer のドメイン別注意と reviewer の観点をスキル本文へ統合する形だったが、観点と注意はそれぞれ強化・追加する予定があり、1 つの本文に統合するとノイズになる。観点ごとに個別ファイルとし、そのスキルのディレクトリ配下の `references/` へ置く(§5.5、§10 の不採用案 19)。

**決定 1 も 2026-09-23 のユーザー指摘により改めた(4 段階目)。** 当初は `codiel-tester` を残す 3 体に含めていたが、Bash + Write/Edit + Playwright という組合せは「成果物を書く委譲」の tools として一般的であり、tester の固有規律はスキル本文で表せる。残すのは 2 体とし、13 体を削除する(§5.1、§10 の不採用案 1)。あわせて、それまで未解決事項に挙げていた「残る Agent の `model` 未宣言」を決定 11 として解決した(§5.11)。

**決定 12 は 2026-09-23 のユーザー指摘で追加した(5 段階目)。** `codiel-tester` を廃止するとテストスクリプトを書いて実行し commit する作業が E2E 検証系の委譲先へ向かうが、`e2e-verify` は現状 readonly でこの作業を受けられない。種別を `impl` へ昇格させる(§5.8、§6.11、§10 の不採用案 20)。

**未解決事項は 2026-09-23 のユーザー指摘で 0 件になった(6 段階目)。** review の 6 観点を 1 dispatch にまとめる案は不採用で確定した(§10 の不採用案 3)。発火測定の見直し時期は、codiel のスキルが名指しでしか起動せず description が発火に影響しないため、論点自体が消えた(§5.10)。決定 11 と合わせて、判断が付いていない論点は残っていない(§12)。

| # | 論点 | 決定 | 本設計での具体化 |
| --- | --- | --- | --- |
| 1 | 残す Agent の範囲 | **2 体を残し 13 体を削除する。** 残すのは `codiel-analyst` / `codiel-test-designer` | §5.1、§6.3 |
| 2 | フェーズ → 委譲先の決め方 | **各フェーズの委譲を作業内容で表す。役割名も解決機構も書かない。** codiel が書くのは、サブエージェントに委譲すること・何をやらせるか・成果物を書く委譲か読み取りだけの委譲かの 3 点である | §5.2、§6.2 |
| 3 | 解決の規律が無いセッション | **ビルトインへ縮退する。** 成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore` | §5.3 |
| 4 | スキル本文の届け方 | **依頼文で絶対パスを示して「読め」と指示する。** そのフェーズで読んでよいスキルをすべて列挙する | §5.4、§6.2 |
| 5 | 削除する Agent の固有部の行き先 | **観点ごとに個別ファイルとし、スキルディレクトリ配下の `references/` に置く。** プラグイン直下の `references/` も `assets/` も作らない | §5.5、§6.1 |
| 6 | 依頼文テンプレート | **`orchestrating-runs/SKILL.md` §3 を書き換える。** 作業内容・スキルの絶対パス・読み取り限定条項・git 操作禁止・転記欄を持たせる | §5.6、§6.2 |
| 7 | SubagentStop hook | **廃止する。** src / build エントリ / hooks.json / バンドルを削除する | §5.7、§6.4 |
| 8 | agent-policy 側の追随 | **スコープに含める。** parallel-nudge の注入文(F6)と orchestration-discipline の 1 条項(F7) | §5.8、§6.5、§6.6 |
| 9 | バージョン | codiel はマイナー、agent-policy と metatron はパッチを上げる | §5.9 |
| 10 | description の発火測定 | **行わない。** description からは Agent 名だけを外す | §5.10 |
| 11 | 残る 2 体の `model` | **宣言しない。** オーケストレーターのモデルを継承したままでよい | §5.11 |
| 12 | `e2e-verify` の種別 | **`readonly` から `impl` へ昇格させる。** tools は impl 役割の既定にする。Agent Tool の可否とモデル割当は変えない | §5.8、§6.11 |

---

## 2. 背景と目的

### 2.1 解こうとしている問題

利用者は、プラグイン同梱の汎用 Agent より、インストール先プロジェクトの `.claude/agents/` にある最適化済み Agent を優先したい。プロジェクト側の定義は model・MCP tools・本文がそのプロジェクトに合わせてある。

現状の codiel はこれに届かない。`orchestrating-runs/SKILL.md:176` が「`subagent_type` にフェーズ担当のエージェント名(`codiel-analyst` 等)を指定して行う」と定め、フェーズ進行表(`:130-142`)が担当を `codiel-*` で固定している。名指し dispatch は「そのまま起動」に倒れるため、プロジェクト最適化(model / MCP / 本文)が届かない。同梱 15 定義はいずれも `model` を宣言しておらず、メインセッションのモデルを継承するのでコストも下がらない。この非互換は 2026-09-10 の検査で所見 F2 として記録されている(`docs/chat/2026/0910/phyllis998/1155-codiel-agent-policy-compatibility.md`)。

### 2.2 利用者の方針

2026-09-15 の引継ぎ書 §2.3-4(`harness-docs/handover/2026-09-15-codiel-domain-map-decoupling-handover.md:71-75`)は、implementer・planner・reviewer・architect などの Agent を削除し、codiel 内部でしか使わない専門的な Agent のみを残し、指示文を Skills に変えてサブエージェントに読ませる、と定める。目的は役割マーカー方式のエージェント運用方針との併用強化である。

### 2.3 先行設計が予告していた実施

2026-09-15 設計書は、そのとき新設した generic 2 体も将来 Skills 化の対象であるとし、「担当範囲と観点の定義は Skill の本文へ移る。消えるのは frontmatter(`tools` / `description`)と `subagent_type` による選択機構である」と書いた(同 `:322`)。本設計はその将来設計の実施である。新設から 1 週間で撤去することになるが、あのとき Agent として作った理由(同 `:316-320`)は「観点の歪みは担当者の実体に依存しない」「今ドメイン非依存の観点を定義すれば、それがそのまま Skills へ移る」であり、移行そのものは織り込み済みである。

### 2.4 目的

codiel の run を、同梱 Agent の名前ではなく**作業内容**で駆動する形にする。委譲先はセッションに注入された運用の規律が決め、codiel は「どのスキルを読ませて、何を作らせるか」だけを持つ。そうした規律が無い環境では Claude Code のビルトイン定義へ縮退し、codiel 単体運用の約束(`plugins/codiel/README.md:20`「Codiel は単体で完結します。」、ルート `README.md:147`)を維持する。

### 2.5 agent-policy 側で上書きする先行の値

**本設計は `e2e-verify` の種別 `readonly` を上書きする(§5.8 の F8)。** この値を設計判断として正当化した先行の節は無い。`harness-docs/design/2026-09-07-agent-policy-orchestrator-analysis-design.md` が新設したのは `design-plan` と `explore-lead` の 2 種であり、同書が `e2e-verify` に触れるのは命名パターンの例示(`:124`)と `ROLES` の並び順の引用(`:136`)だけで、`kind` を論じた節(同書の `#### kind`)も新設 2 種だけを対象にしている。`readonly` という値は `harness-docs/design/2026-09-09-agent-policy-band-catalog-consolidation-design.md` の §役割の帯(同書 `:326`)に担当表の全文として書き写され、そのまま `roles.ts` へ引き継がれてきた。**上書きの対象は特定の設計判断ではなく、引き継がれてきた値そのものである。**

---

## 3. 前提(実測。2026-09-22 時点の working tree)

### 3.1 baseline

- HEAD: `e70a804`。作業ツリーの差分は本改修と無関係なものだけである。内訳は `.claude/settings.json` の変更、`docs/chat/INDEX.md` の変更、`docs/chat/2026/0922/**` の未追跡の会話記録、および本設計書と計画書自身(`harness-docs/design/2026-09-22-*.md` と `harness-docs/plans/2026-09-22-*.md`)の未追跡ファイルである。
- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の緑は着手時に再取得して記録する(計画書 T0)。

### 3.2 現行のディスパッチ経路

`/codiel:run`(`commands/run.md:8`)→ `orchestrating-runs` §2 のフェーズ進行表で担当 Agent 名を引く → §4(`:217-219`)で「利用可能なエージェント一覧」に `codiel-implementer-X` / `codiel-reviewer-X` があるかを判定し、無ければ generic へ縮退 → `subagent_type` に `codiel-*` を固定指定(`:176`)→ §3 のテンプレート本文が「あなたは <エージェント名> として、codiel プラグインの <スキル名> スキルを Skill ツールで起動し」と命じる(`:180-181`)→ Agent 定義の本文が「最初に <スキル> スキルを読む」と重ねて命じる → スキル本文が実手順を供給する。

指示が 3 層(テンプレート・Agent 定義・スキル)に分かれており、Agent 定義の層は「スキルを読め」「ARCHITECTURE / GOTCHAS を読め」「職務は〜に限る」「報告形式」の繰り返しで占められている。固有の内容は implementer のドメイン別注意と reviewer の観点リストだけである。

### 3.3 残す 2 体と削除する 13 体

`plugins/codiel/agents/` は 15 ファイル・合計 45,677 B である。

残す 2 体。

| ファイル | 担当 | tools(frontmatter) | 残す理由 |
| --- | --- | --- | --- |
| `codiel-analyst.md`(1,876 B) | init | Read, Grep, Glob, Write, Bash, Context7, GitHub Issue 読み取り群 | 成果物が `.codiel/**` の `issue.md` に閉じる。Bash は `gh issue view` の読み取りに限る規律(`:21-23`)を持つ |
| `codiel-test-designer.md`(1,680 B) | test-spec | Read, Grep, Glob, Write, Edit, Context7 | `.codiel/specs/<unit-id>/` の spec / cases だけを書き、`scripts/` に触れない(`:15-16`)。**Bash 無し・Write/Edit 有り**という組み合わせは一般役割の既定 tools に無い |

削除する 13 体。

| ファイル | サイズ | 固有部 | 移し先 |
| --- | --- | --- | --- |
| `codiel-architect.md` | 1,921 B | 2 モードの切り替え(`:11-13`) | 依頼文テンプレート(§6.2) |
| `codiel-planner.md` | 1,573 B | 報告形式のドメイン内訳(`:18`) | 依頼文テンプレート |
| `codiel-implementer-frontend.md` | 3,218 B | UI / 状態管理 / アクセシビリティ / 既存画面との一貫性(`:22-25`)、Playwright での表示・遷移確認(`:40`) | `skills/implementing/references/frontend.md`(§6.1) |
| `codiel-implementer-backend.md` | 2,716 B | API 互換性 / エラーハンドリング / 入力検証(`:20-22`) | `skills/implementing/references/backend.md` |
| `codiel-implementer-data.md` | 3,051 B | 可逆マイグレーション / `design.md` に無い破壊的変更は実行せず報告(`:22-24`) | `skills/implementing/references/data.md` |
| `codiel-implementer-generic.md` | 3,000 B | 無し。`:15-25` は `implementing/SKILL.md:36-40, 83-84, 93-103` と重複 | 移す内容が無い(注意ファイルも作らない) |
| `codiel-reviewer-frontend.md` | 3,824 B | 観点 7 項目(`:20-26`) | `skills/reviewing-diffs/references/frontend.md`(§6.1) |
| `codiel-reviewer-backend.md` | 3,643 B | 観点 6 項目(`:20-25`) | `skills/reviewing-diffs/references/backend.md` |
| `codiel-reviewer-data.md` | 3,891 B | 観点 10 項目(`:20-29`) | `skills/reviewing-diffs/references/data.md` |
| `codiel-reviewer-doc.md` | 3,776 B | 観点 9 項目(`:21-29`) | `skills/reviewing-diffs/references/doc.md` |
| `codiel-reviewer-security.md` | 4,071 B | 観点 9 項目(`:21-29`)。うち `:28`(原則 medium 以上)は `reviewing-diffs/SKILL.md:72-73` に既出。`:29`(実害が起こりうるかで critical / high / medium を判断する)は既出ではない | `skills/reviewing-diffs/references/security.md` |
| `codiel-reviewer-generic.md` | 3,761 B | 観点 6 項目(`:23-28`) | `skills/reviewing-diffs/references/generic.md` |
| `codiel-tester.md` | 3,676 B | 書き込み境界を自身の規律で守る旨(`:29-30`)、完了報告の 4 項目(`:41`)、Context7 での仕様確認(`:45`)、Playwright での切り分けと合否の根拠(`:46-49`) | 固有規律は `scripting-tests` / `running-regression-tests` へ(§6.1) |

`codiel-implementer-generic.md` に固有部が無いことは実測で確認した。担当タグの絞り込み(`:15-17`)は `implementing/SKILL.md:36-40` に、`.codiel/specs/**` への書き込み禁止(`:24-25`)は同 `:83-84`(HARD-GATE)に、1 ステップ 1 コミット(`:26-29`)は同 `:60-76`(コミット責務)に、担当範囲外への書き込み禁止(`:20-23`)は同 `:93-103`(ドメイン規律)に、それぞれ既にある。

### 3.4 SubagentStop の実測

- `plugins/codiel/src/hooks/subagent-stop.ts` は 41 行。`ARTIFACTS`(`:7-12`)に init / discuss / design / dev-plan の 4 フェーズだけを持ち、`in_progress` がちょうど 1 つのときに成果物の存在と非空を検査して block する(`:25-38`)。
- `agent_type` / `agent_id` を読んでいない。`:20-24` のコメントが「Stop したのがどのサブエージェントか一意に識別できない」を理由に、複数 in_progress のときは検査ごとスキップすると書く。
- テストは無い。`plugins/codiel/src/hooks/__test__/` にあるのは `guard-bash.test.ts` / `guard-write.test.ts` / `lib.test.ts` / `stop-guard.test.ts` の 4 本である。
- `hooks/hooks.json:9-11` が SubagentStop を登録し、`build.ts:9` がバンドルのエントリに入れ、`scripts/subagent-stop.mjs` が生成物として存在する。
- 成果物の存在確認は `orchestrating-runs/SKILL.md:212-213` に「ディスパッチ後、成果物ファイルが実際に存在し空でないことを確認してから raguel-gating のゲート手順に進む(サブエージェントの報告を鵜呑みにしない)」として既にある。

### 3.5 参照文書の残量

- `plugins/agent-policy/references/orchestration-discipline.md` = 24,227 B、`plugins/agent-policy/references/context-map-guide.md` = 6,169 B。合計 **30,396 B**。30,720 B までの残りは **324 B** である。

**30,720 B という上限の出典を正しく押さえる。** `orchestration-discipline.md:181` の条項は「委譲先にロードさせるスキルは、`wc -c` で本文と参照文書の合計を測る。30KB を超えるものは、指定があってもロードさせず」であり、**主語は委譲先にロードさせるスキル**である。参照文書 2 本の合計そのものに 30,720 B を当てるのは、条項の直接の帰結ではなく、本リポジトリの運用上の約束である(Serena メモリ `agent_policy/core` に記録がある)。**制約自体は本設計でも維持する。** 出典が運用上の約束であることを明示しておくのは、後から「条項にそう書いてある」と誤読して別の文書へ同じ上限を当てることを防ぐためである。

- 追加する条項の位置は §オーケストレーターが自ら担う作業(`:58`)である。**F7 の 1 文は半角括弧で書いても 315〜321 B になり、残量 324 B とほぼ同じである。** したがって既存文の削減は「超えたときの対処」ではなく**既定の手順**として扱う(§6.6)。

### 3.6 決定: `orchestrating-runs/SKILL.md` に 30,720 B の上限を当てない

現在 **30,111 B** である。§3 のテンプレート拡張でこの値を超えうるが、**上限は当てない。**

理由は §3.5 と同じ出典の問題である。`orchestration-discipline.md:181` の主語は「委譲先にロードさせるスキル」であり、`orchestrating-runs` は**オーケストレーター自身が読むスキル**なので条項の対象ではない。参照文書 2 本に上限を当てる運用上の約束も、委譲先へ配る文書についてのものである。

**実装時に `wc -c` の実測を取り、報告に記録する。** 閾値による合否判定は行わない。値が大きく増えたときに構成を見直すかどうかは、実測を見てから別途判断する。

### 3.7 変えない前提

- `plugins/codiel/src/hooks/guard-write.ts` / `guard-bash.ts` / `stop-guard.ts` / `src/codiel-state.ts` / `raguel-mcp/`。いずれも Agent 名・`subagent_type` に依存しない。ドメイン境界の根拠は宣言された `domain` の値である(`docs/DESIGN.md:385`)。
- ドメインマップの契約(ADR-003、`harness-docs/design/2026-08-16-file-contract-freeze.md`)。
- sandalphon。`plugins/sandalphon/references/handoff-contract.md` と `plugins/sandalphon/skills/bridging-execution/SKILL.md` は codiel の Agent 名を 1 件も持たない。
- 実行モード(`mapped` / `unscoped`)と `set-domain` / `clear-domain` の運用(`orchestrating-runs/SKILL.md:223-241`)。
- `plugins/codiel/src/hooks/__test__/guard-write.test.ts`。書き換えが要ると判断した時点で実装を止めて報告する。

---

## 4. 全体像

移行後の経路は次の形になる。

```
/codiel:run
  └─ orchestrating-runs スキル
       §0 前提チェックと実行モードの決定           (変更なし)
       §1 run の解決                               (変更なし)
       §2 フェーズ進行表
          ★「担当エージェント」列を「委譲先の決め方」列へ置き換える
            名指し 2 フェーズ(init / test-spec)はそのまま
            残りは委譲の種別と作業内容で表す
       §3 ディスパッチプロンプトの規約
          ★冒頭を「サブエージェントであること + 作業内容 + 読むスキルの絶対パス」へ
          ★読み取り限定条項 / git 操作禁止 / 委譲規律の転記欄を足す
       §4 ドメインディスパッチ
          ★実在判定を廃す。タグは依頼文と set-domain で渡す
          ★解決の規律が無ければビルトインへ縮退する規則を置く
  委譲先(プロジェクトの定義 / ビルトイン)
       依頼文の絶対パスで SKILL.md を Read する
       →  implementing / fixing-failures / reviewing-diffs ... が手順を供給する
       依頼文の絶対パスで観点ファイルを Read する
       →  skills/implementing/references/<タグ>.md       … ドメイン別の注意
       →  skills/reviewing-diffs/references/<観点>.md    … 観点別の確認項目
```

Agent 定義の層が消え、指示は「依頼文 → スキル本文 + 観点ファイル」の 2 層になる。

各決定が解く問題の対応は次のとおり。

| # | 決定 | 解く問題 | 該当 |
| --- | --- | --- | --- |
| 1 | 13 体を削除し 2 体を残す | 名指し dispatch がプロジェクト最適化を通さない(F2) | §5.1 |
| 2 | 委譲を役割の言葉で表す | 同上。委譲先の決定をセッション側に委ねる | §5.2 |
| 3 | ビルトインへ縮退する | 解決の規律が無い環境で run が始まらなくなる | §5.3 |
| 4 | スキルの絶対パスを渡して読ませる | Skill ツールを持たない委譲先に本文が届かない | §5.4 |
| 5 | 固有部を観点ごとの個別ファイルにする | `reviewing-diffs:93` の参照先が消える | §5.5 |
| 6 | 依頼文テンプレートを書き換える | 名乗り・tools 制限・コミット責務の根拠が Agent 定義に依存している | §5.6 |
| 7 | SubagentStop を廃止する | 子の子の停止で脱出不能になる(F4) | §5.7 |
| 8 | agent-policy を追随させる | 逐次要求と並列促しの衝突(F6)、スキル駆動ワークフローとの優先順未定義(F7) | §5.8 |

---

## 5. 設計判断

### 5.1 残す Agent は 2 体とし、13 体を削除する

**決定。`codiel-analyst`(init)と `codiel-test-designer`(test-spec)を残す。frontmatter と本文は原則そのままとする。残る 13 体を削除する。**

**理由。** 判断軸は「成果物が `.codiel/**` に閉じ、かつ tools の組合せが一般の委譲先と合わないこと」である。この 2 体はどちらも満たす。

- `codiel-analyst`。成果物は `issue.md` に閉じる。tools は Bash を `gh issue view` の読み取りに限る規律(`codiel-analyst.md:21-23`)と GitHub MCP の読み取り群であり、Bash を作業用に持つ一般の実装帯とも、Bash を持たない読み取り帯とも合わない。
- `codiel-test-designer`。成果物は `.codiel/specs/<unit-id>/` の `spec.md` と `cases.md` に閉じ、`scripts/` に触れない(`codiel-test-designer.md:15-16`)。tools は **Bash 無し・Write/Edit 有り**であり、`plugins/agent-policy/src/agents/roles.ts` の impl 役割の既定 tools(Bash を含む)にも readonly 役割の既定 tools(Write / Edit を持たない)にも合致しない。この組合せが「成果物は書くが自分ではコミットしない」という現行の責務分配(`orchestrating-runs/SKILL.md:153-154`、`writing-test-specs/SKILL.md:87`)の根拠になっている。

**`codiel-tester` を残さない理由。** tools は Read / Grep / Glob / Edit / Write / Bash / Context7 / Playwright である(`codiel-tester.md:4`)。Bash + Write/Edit + Playwright という組合せは「成果物を書く委譲」の tools として一般的であり、規律の側で E2E 検証を担う委譲先も汎用の実装帯も選べる。tester の固有規律(期待値を緩めない・プロダクトコードを直さない・broken と NG を混同しない)は権限ではなく文面で表せるものであり、その大半は既に `scripting-tests` と `running-regression-tests` の本文と HARD-GATE にある。残りもスキル本文へ移せる(§6.1)。残した場合は `/codiel:test` と test-loop A だけが名指し dispatch のまま残り、プロジェクト最適化(model / MCP / 本文)がその経路に届かない状態が続く。

設計・計画・実装・レビュー・テストは一般の委譲先で表せる。ドメイン別 implementer 3 体の違いは注意事項だけであり、reviewer 6 体の違いは観点リストだけである。どちらも観点ファイルとして表せる(§5.5)。

**不採用案 1: `codiel-tester` を残す。** tools の組合せが一般的であり、固有規律はスキル本文で表せるため採らない。**ユーザー指摘(2026-09-23、4 段階目)。**

**不採用案 2: 全 15 体を削除する。** `codiel-analyst` と `codiel-test-designer` の tools の組合せが一般の委譲先と合わないため採らない。test-designer を一般の委譲先へ送ると「Bash を持たないから自分ではコミットしない」という責務分配の根拠が消え、analyst を送ると Bash を読み取りに限る規律が権限で保証されなくなる。

### 5.2 フェーズごとの委譲を作業内容で表す

**決定。codiel の指示層が各フェーズの委譲について書くのは次の 3 つだけである。委譲先を名指しでも役割名でも指定しない。**

1. **サブエージェントに委譲すること。** オーケストレーター自身が実行しないことは明記する(単体完結の原則。`orchestrating-runs/SKILL.md:285-290` の HARD-GATE と同じ趣旨)。
2. **何をやらせるか。** 作業の内容を、読ませるスキルと入出力ファイルで表す。
3. **成果物を書く委譲か、読み取りだけの委譲か。** 依頼文の tools 限定条項(§5.6-2)と縮退先の決定(§5.3)に使う。

対応は次のとおりとする。「作業内容」列は入力ファイルから出力ファイルへの要約であり、実装時は `orchestrating-runs/SKILL.md` の入力・出力の各列がそのまま対応する。

| フェーズ | 委譲の種別 | 作業内容(入力 → 出力) | 読ませるスキル | `set-domain` | 並列 |
| --- | --- | --- | --- | --- | --- |
| [0] init | 名指し `codiel-analyst` | Issue → `issue.md` | `analyzing-issues`(Agent 定義が読む) | しない | — |
| [1] discuss(アジェンダ作成) | 成果物を書く委譲 | `issue.md` → `agenda.md` | `preparing-design-agendas` | しない | — |
| [2] design | 成果物を書く委譲 | `issue.md` + `discussion.md` → `design.md` | `writing-design-docs` | しない | — |
| [3a] test-spec | 名指し `codiel-test-designer` | `design.md` → `spec.md` / `cases.md` | `writing-test-specs`(Agent 定義が読む) | しない | dev-plan と 2 体並列 |
| [3b] dev-plan | 成果物を書く委譲 | `design.md` → `dev-plan.md` | `writing-dev-plans` | しない | test-spec と 2 体並列 |
| [4] implement | 成果物を書く委譲 | `dev-plan.md` の担当ステップ → コード diff + ユニットテスト | `implementing` + `fixing-failures` | `mapped` では担当タグ | **逐次 1 体ずつ** |
| [5A] test-loop(スクリプト安定化) | 成果物を書く委譲 | `cases.md` → `scripts/` + `test-run-<n>.md` | `scripting-tests` + `running-regression-tests` | しない | — |
| [5B] test-loop(TDD 修正) | 成果物を書く委譲 | NG ケースの再現手順・期待結果・実際の結果 → コード修正 diff | `implementing` + `fixing-failures` | `mapped` では担当タグ | 逐次 |
| [6] pr | オーケストレーター本体 | — | — | — | — |
| [7] review | 読み取りだけの委譲 | diff + `design.md` + `.codiel/specs/**` → 指定観点の所見一覧(テキスト) | `reviewing-diffs` | しない(`clear-domain`) | 観点ごと 1 dispatch、並列可 |
| [8] fix-loop(修正) | 成果物を書く委譲 | `review-<n>.md` の critical/high → コード修正 diff | `implementing` + `fixing-failures` | `mapped` では担当タグ | 逐次 |
| [8] fix-loop(回帰) | 成果物を書く委譲 | `scripts/` → `test-run-<n+1>.md` | `running-regression-tests` | しない | — |
| [8] fix-loop(再レビュー) | 読み取りだけの委譲 | 更新された diff + 反論済み所見一覧 → 所見一覧(テキスト) | `reviewing-diffs` | しない | 並列可 |
| [9] triage | オーケストレーター本体 | — | `filing-followup-issues` | — | — |
| [10] finalize | オーケストレーター本体 | — | `recording-gotchas`(STOP / incident 時のみ) | — | — |

**作業の重さに応じた委譲先の選択は規律側が行う。** codiel は作業内容を渡すだけである。軽い変更か、複数コンポーネントにまたがる設計判断を含むか、行き詰まって上位へ上げるべきかの判断を codiel の側で固定しない。

**委譲先の選び方も書かない。** 候補の絞り込みも、候補が複数あるときの決め方も、セッションに注入された運用の規律の仕事である。codiel が重ねて書くと二重管理になり、規律が変わったときに食い違う。

**review の dispatch 単位は観点ごとに 1 件とする。** diff が触れたドメインタグの観点 + `doc` + `security`(常時)+ 専門観点が無いタグは generic 観点、という選択規則は現行(`orchestrating-runs/SKILL.md:219`)の構造を保つ。観点は依頼文で指定する。読み取りだけの委譲であり `set-domain` しないので並列に出してよい。

**review では `set-domain` を一切行わない。** 現行の `orchestrating-runs/SKILL.md:234`「`mapped` でドメイン別 reviewer を 1 体だけディスパッチするときも、担当するドメインタグを `set-domain` に渡す」は**削除する**。`set-domain` の値は `guard-write` の書き込み境界の根拠であり(`docs/DESIGN.md:385`)、書き込みをしない委譲に対して設定する意味がない。上の表の `set-domain` 列(review は「しない」)と §4.1 の記述を一致させる。

**理由(名指しを init と test-spec の 2 フェーズに残すこと)。** 名指しは「プロジェクト最適化が届かない」という問題そのものだが、§5.1 のとおりこの 2 体には一般の委譲先と合わない tools の組合せがある。名指しを残しても、利用者がプロジェクト側で同名の定義を置けば Claude Code の仕様により上書きされる。

**test-loop A と fix-loop の回帰は「成果物を書く委譲」になる。** 作るのは `.codiel/specs/<unit-id>/scripts/` のスクリプトとレポートであり、委譲先は自分の変更を自分でコミットする(§5.6-4)。テスト固有の規律は `scripting-tests` と `running-regression-tests` の本文が供給する(§6.1)。

**理由(解決機構にも役割名にも注入元の名前にも言及しないこと)。**

第 1 に、運用方針を併用しているセッションでは、委譲先を決める規則がすでに注入されている。codiel が同じ規則を重ねて書けば二重管理になり、規律が変わったときに食い違う。単体運用のセッションでは機構そのものが存在しないので、機構に言及した指示は意味を持たない。

第 2 に、**役割名を固定すると作業の重さに応じた選択の余地が消える。** 最近のモデルは役割を指定しなくても作業内容から適切な委譲先を選ぶ。一方、codiel が implement フェーズに特定の役割名を書けば、その時点ですべての実装がその帯にしか行かなくなる。複数コンポーネントにまたがる設計判断を含む実装を重い帯へ、行き詰まりをエスカレーションの帯へ上げる経路が、codiel の文面によって塞がれる。作業の重さはステップごとに違うので、固定すべきものではない。

どちらの理由からも、codiel が書くべきものは「サブエージェントに委譲すること」「何をやらせるか」「成果物を書く委譲か読み取りだけの委譲か」と、解決の相手が無いときの行き先(§5.3)だけである。あわせて `harness-docs/ARCHITECTURE.md:50` の「指示層と参照層に他プラグインの名前を書かない」にも当然に適合する。

**不採用案: review の 6 観点を 1 dispatch にまとめる。** 現行の並列前提(`docs/DESIGN.md:367`)を崩し、1 体が 6 観点を順に見ることになるため採らない。まとめると「観点ごとに確認した項目と確認方法を報告する」(`reviewing-diffs:44`)の粒度も保てなくなる。**ユーザーが 2026-09-23 に不採用で確定させた。**見直しの論点として残さない。

### 5.3 解決の規律が無いときはビルトインへ縮退する

**決定。codiel が §4 に置く規則は 1 つだけである。「委譲先は、セッションに注入されているエージェント運用の規律に従って決める。そのような規律が無いときは、成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore` へ dispatch する。」**

**委譲先を決める手順そのものは書かない。** 候補の絞り込み、作業の重さに応じた帯の選択、description による担当範囲の一致を使うかどうか、候補が複数あるときの決め方は、すべて規律側の仕事である。codiel はそのどれにも触れない。

**理由(縮退先の選び方)。** codiel は「単体で完結します」を約束しており(`plugins/codiel/README.md:20`、ルート `README.md:147`)、この約束を維持するには解決の相手が無いときの行き先が要る。`general-purpose` と `Explore` は Claude Code のビルトイン定義であり、どの環境にも存在する。`Explore` は読み取り専用(`Edit` / `Write` / `NotebookEdit` を持たない)なので、reviewer が自分で直して自己承認する経路(`docs/DESIGN.md:371-372`)を権限レベルで塞ぐ現行の保証を、review フェーズに限って維持できる。

**縮退が効く範囲は読み取りだけの委譲に限らない。** 文書系フェーズ(discuss / design / dev-plan)も `general-purpose` へ落ちる。`general-purpose` は全ツールを持つため、**文書系フェーズの「git 操作をしない」(§5.6-4)は依頼文の規律だけで担保される。** hook 側は助けにならない。`guard-bash.ts:124-152` の `ALWAYS_DENY` は作業ツリー外への `rm -rf`・`curl | sh`・force push・保護ブランチへの push・シェル経由の `state.json` 書き込みの 5 件であり、`git commit` は含まれない。**この後退は受容する。** 縮退はもともと解決の規律が無い環境のための経路であり、そこでは権限による分離そのものが利用できない。誤って委譲先がコミットしても、オーケストレーターが `pr` フェーズの前に `git status --short` で未コミット差分を確認する手順(`orchestrating-runs/SKILL.md:169-171`)が壊れるだけで、run の成果物は失われない。

**不採用案 1: 汎用 Agent を 1〜2 体同梱して縮退先にする。** 定義の保守が残り、本設計の目的(同梱 Agent の撤去)を部分的に取り消すため採らない。

**不採用案 2: 解決の規律が無ければ run を開始しない。** 単体運用の約束を捨てることになるため採らない。2026-09-15 設計が「ドメインマップが無くても run を始める」へ倒した判断とも逆向きになる。

### 5.4 スキル本文と観点ファイルは絶対パスを示して「読め」と指示する

**決定。依頼文で「codiel プラグインの <スキル名> スキル(`<plugin-root>/skills/<name>/SKILL.md`)を読み、その手順に従う」と指示する。`<plugin-root>` は `orchestrating-runs/SKILL.md:23-31` の「プラグインルート参照規約」で解決済みの絶対パスを埋める。依頼文には、そのフェーズで読んでよいスキルをすべて列挙する。観点ファイル(§5.5)も同じ列に同じ形で列挙する。**

フェーズごとの列挙は §5.2 の表の「読ませるスキル」列が正本である。implement / test-loop B / fix-loop 修正は `implementing` と `fixing-failures` の 2 本、test-loop A は `scripting-tests` と `running-regression-tests` の 2 本、review と再レビューは `reviewing-diffs` の 1 本、discuss は `preparing-design-agendas`、design は `writing-design-docs`、dev-plan は `writing-dev-plans` である。

**観点ファイルを足す規則。**

| 委譲 | 足すパス | 条件 |
| --- | --- | --- |
| 実装(implement / test-loop B / fix-loop の修正) | `<plugin-root>/skills/implementing/references/<担当タグ>.md` | `mapped` で、そのファイルが**存在するときだけ**足す。存在しなければ足さない(注意なし。現行 generic と同じ)。`unscoped` では足さない |
| review / 再レビュー | `<plugin-root>/skills/reviewing-diffs/references/<観点>.md` | 観点ごとに 1 本を必ず足す。6 観点すべてのファイルが常に存在する |

**存在の確認はオーケストレーターがファイルの有無で行う。** `Glob` または `ls` で `skills/implementing/references/` を見て、担当タグと同名の `.md` があるかを判定する。委譲先に探させない。ドメインタグは任意の文字列を取りうる(`file-contract-freeze.md:53-54`)ため、`frontend` / `backend` / `data` 以外のタグでは対応するファイルが無いのが通常である。

**ファイル名はドメインタグ名・観点名と一致させる。** 依頼文がパスを機械的に組み立てられるようにするためである。別名の対応表を作らない。

**理由(Skill ツールではなく Read にすること)。** readonly 役割の既定 tools に `Skill` は含まれない(`plugins/agent-policy/src/agents/roles.ts`)。本リポジトリの `.claude/agents/` 14 定義でも `Skill` を持つのは 6 体だけである。review の委譲先は readonly を想定するため、Skill ツールに依存すると本文が届かない。`Read` はどの委譲先も持つ。

**理由(全スキルを列挙すること)。** セッションに注入される委譲規律には「サブエージェントは、依頼文で指定されたスキルだけをロードする」という条項がある。一方 codiel のスキルは連鎖する。`implementing/SKILL.md:20-21` が修正モードで `fixing-failures` へ、`scripting-tests` が `running-regression-tests` へ送る。依頼文が 1 本しか挙げなければ、転記された条項が連鎖の先を止める。これが 2026-09-10 検査の所見 F5 である。**codiel 側で、そのフェーズが必要とするスキルを最初から全部挙げることで解消する。** 規律の側は変えない(§5.8)。

**不採用案 1: 常に本文を依頼文へ転記する。** 1 run で 13 回前後の dispatch が起き、6〜10 KB のスキル本文をその回数ぶんコンテキストへ載せることになるため採らない。

**不採用案 2: 常に Skill ツールで起動させる。** Skill を持たない readonly 定義へ届かないため採らない。

### 5.5 削除する Agent の固有部は観点ごとの個別ファイルにする

**決定。implementer 3 体のドメイン別注意と reviewer 6 体の観点リストを、観点ごとの個別ファイルにする。置き場はそのスキルのディレクトリ配下の `references/` とする。プラグイン直下の `references/` も `assets/` も作らない。architect / planner / generic 2 体の本文は共通定型であり、依頼文テンプレートへ移す。**

新設するのは 9 ファイルである。

| ファイル | 内容の出所 |
| --- | --- |
| `plugins/codiel/skills/implementing/references/frontend.md` | `codiel-implementer-frontend.md:22-25`(UI / 状態管理 / アクセシビリティ / 既存画面との一貫性)と `:40-42`(画面確認) |
| `plugins/codiel/skills/implementing/references/backend.md` | `codiel-implementer-backend.md:20-22`(API 互換性 / エラーハンドリング / 入力検証) |
| `plugins/codiel/skills/implementing/references/data.md` | `codiel-implementer-data.md:22-24`(可逆なマイグレーション、`design.md` に明記のない破壊的変更は実行せず報告) |
| `plugins/codiel/skills/reviewing-diffs/references/frontend.md` | `codiel-reviewer-frontend.md:20-26` |
| `plugins/codiel/skills/reviewing-diffs/references/backend.md` | `codiel-reviewer-backend.md:20-25` |
| `plugins/codiel/skills/reviewing-diffs/references/data.md` | `codiel-reviewer-data.md:20-29` |
| `plugins/codiel/skills/reviewing-diffs/references/doc.md` | `codiel-reviewer-doc.md:21-29` |
| `plugins/codiel/skills/reviewing-diffs/references/security.md` | `codiel-reviewer-security.md:21-27` と `:29` |
| `plugins/codiel/skills/reviewing-diffs/references/generic.md` | `codiel-reviewer-generic.md:23-28` |

**ファイル名はドメインタグ名・観点名と一致させる**(§5.4)。

**理由(1 つのスキル本文へ統合しないこと)。** 観点と注意はそれぞれ強化・追加する予定がある。1 つの本文に統合すると、ある観点を厚くしたときに他の観点を読む委譲先にとってノイズになる。ファイルを分けておけば、依頼文が渡すのはその委譲に要る 1 本だけで済み、追加・強化も 1 ファイルに閉じる。

**理由(プラグイン直下の `references/` にしないこと)。** `harness-docs/ARCHITECTURE.md:33` の参照層の定義は「複数の指示から共有する規律と断片を置く」である。ここで作る 9 ファイルは `implementing` と `reviewing-diffs` のそれぞれ 1 スキルからしか読まれず、この定義に当たらない。読み手が 1 スキルに閉じるなら、そのスキルの一部として同居させる。前例は `plugins/basic-design/skills/*/references/`(6 スキル)と `plugins/prompt-smith/skills/skill-creator/assets/` である。

**理由(参照先が 1 ディレクトリで済むこと)。** `reviewing-diffs:93` が「各 `codiel-reviewer-*` エージェント定義に記載する」と 6 ファイルへ飛ばしているのが現在の構造である。飛ばす先を 1 ディレクトリにまとめ、どのファイルを読むかは依頼文が名指しする形にすると、スキル本文から所在の記述が消える。

**metatron の走査対象には入る。** `section-reference-inventory.test.ts:58` の `walkMd` はサブディレクトリを再帰的に辿り、同 `:68` が `skills/` を `walkMd` に渡す。したがって `skills/reviewing-diffs/references/doc.md` は V2 の対象になる。既に `plugins/basic-design/skills/api-list/references/template.md` が登録簿に載っている(fixtures `:4-8`)ことがこの動きの実例である。登録の追加は §6.7 で扱う。

**generic の扱い。** reviewer 側は `generic.md` を作る(正しさ・不整合・回帰リスクに限り、専門観点や好みを持ち込まない)。implementer 側は generic の注意ファイルを作らない。専門の注意が無いタグは注意なしであり、現行の `codiel-implementer-generic.md` に固有部が無いこと(§3.3)と一致する。

**generic を所見書式の観点リストにも足す。** `reviewing-diffs/SKILL.md:53` の所見書式は `- 観点: frontend|backend|data|doc|security` であり、generic が入っていない。generic 観点のファイルを持つ以上、書式の側にも足さないと generic の所見が書式に適合しなくなる。

**security の severity 規則の分担。** 「原則 medium 以上」は既に `reviewing-diffs/SKILL.md:72-73` にあるので本文に残し、主語だけを security 観点へ直す。「実害が起こりうるかで critical / high / medium を判断する」(`codiel-reviewer-security.md:29`)は本文に無いので `security.md` に置く。

**Playwright は tools の話であり、ファイルへ移しても届かない。** `codiel-implementer-frontend.md:40-42` は「実装した画面の表示・遷移・入力挙動の確認は Playwright MCP のブラウザ操作で行う」「完了の根拠はテストコマンドの実行結果とする」「MCP ツールが未接続のときは、コードリーディングとテストコマンドで代替する」と、既に条件付きで書かれている。`implementing/references/frontend.md` もこの条件付きの形で書く。つまり「Playwright MCP が使えるときは表示・遷移を確認する。使えないときはテストコマンドの結果を根拠にする」である。**委譲先に Playwright が付与されていなければ確認は行われない。** これはファイルの書き方では解けない。`codiel-reviewer-frontend.md` と `codiel-tester.md` の Playwright(いずれも frontmatter の `tools` に `mcp__playwright` を持つ)は移し先が無く、作業内容で表した review にも test-loop にも届かない。**決定 1 の改定で `codiel-tester` も削除するため、Playwright を frontmatter で保証する経路は 1 つも残らない。**リスクとして受容する(§9 のリスク 8)。`scripting-tests` へ移す Playwright の規律も同じ条件付きの形で書く(§6.1)。

**指示書の文面確定は `prompt-smith:prompt-smith` で行う。** 新設する 9 ファイルも AI が読む指示書であり、同じ規約(`.claude/rules/metatron/conventions.md` の「AI 向けの指示書」)の対象である。計画書の各タスクに起動を明記する。**残る 2 体の本文は変更しないので、`prompt-smith:agent-creator` は本改修では起動しない**(§6.3)。

**不採用案 1: `plugins/codiel/references/` を新設して観点ファイルを置く。** 参照層の定義は「複数の指示から共有する規律と断片」であり、1 スキルからしか読まれないファイルは当たらないため採らない。

**不採用案 2: 観点を `assets/` の資料として置く。** 指示ではなく資料として扱うことになり、「読まなくてもよい」余地を作るため採らない。

**不採用案 3: 9 ファイルをスキル本文へ統合する。** 観点と注意は個別に強化・追加する予定があり、統合するとノイズになるため採らない(§10 の不採用案 19)。

### 5.6 依頼文テンプレートを書き換える

**決定。`orchestrating-runs/SKILL.md` §3(`:173-213`)と §4(`:215-241`)を次のとおり改める。**

1. **冒頭の名乗り。** 「あなたは <エージェント名> として」(`:180`)をやめ、サブエージェントであること・そのフェーズの作業内容・読むスキルと観点ファイルの絶対パスの列挙、の形にする。役割名は書かない。観点ファイルを足す規則は §5.4 にある。
2. **読み取りだけの委譲(review)。** 「使用してよい tools を読み取り系に限定すること」「ファイルを変更しないこと」「報告のみを返すこと」を入れる。委譲先が `Write` / `Edit` を持つ定義になりうるため、`Explore` へ縮退したときと同じ制約を文面で課す。
3. **実装の委譲。** 担当タグ・実行モード・ドメインマップ(現行 `:193-195`)は維持する。ドメイン別の注意は §5.4 の規則で観点ファイルの絶対パスとして渡す。
4. **文書系フェーズ(discuss / design / dev-plan)。** 「git 操作をしない」を入れる。成果物のコミットはオーケストレーターが行う(§2.1 の現行規約)を維持し、その理由を「Bash を持たないから」(`:153-154`)から「文書系フェーズの委譲先は git 操作をしないから」へ書き換える。実装・テストの委譲先が自分でコミットする規約(`:166-168`)は変えない。
5. **転記欄。** テンプレート末尾に、セッションの規律が依頼文への転記を求める条項があればそれを置く欄を設ける。codiel は条項の中身も、どの仕組みが条項を注入するのかも書かない。
6. **§4 の実在判定を廃す。** `:217-219` の「`codiel-implementer-X` が自分の利用可能なエージェント一覧にあれば」という判定をやめ、タグは依頼文と `set-domain` で渡す形にする。`:218` の `initializing-harness/SKILL.md:53-55` への参照を同時に消す。implementer を 1 体ずつ逐次ディスパッチする規律(`:238`)は維持する。
7. **§2 フェーズ進行表(`:128-142`)と §4.1 の「ドメインに紐づかないサブエージェント」列挙(`:237`)** を §5.2 の対応へ合わせる。
8. **§4.1 の `:234`(「`mapped` でドメイン別 reviewer を 1 体だけディスパッチするときも、担当するドメインタグを `set-domain` に渡す」)を削除する。** review は読み取りだけの委譲であり `set-domain` しない(§5.2)。この 1 行が残ると §2 の表と §4.1 が食い違う。

**理由(コミット責務の根拠を書き換えること)。** 現行の根拠は委譲先の frontmatter に Bash が無いことである。作業内容で表した委譲では、実装の委譲先も文書系の委譲先も Bash を持ちうるため、この根拠は成立しなくなる。責務の分配そのものは維持したいので、根拠を「持っていない」から「やらせない」へ移す。

**理由(`:218` の参照を消すこと)。** 参照先の `initializing-harness/SKILL.md:53-55` は保護パスのヒアリング手順であり、同ファイル全 108 行に「利用可能なエージェント一覧」の語は出現しない。参照は既に実体を失っている(context-map §7 論点 9)。実在判定そのものを廃すので、同じ変更で解消する。

**理由(転記欄に中身を書かないこと)。** 委譲規律の条項は注入元が持つ資産であり、codiel が写しを持つと二重管理になる。codiel が持つのは「転記する」という指示だけにする。

**不採用案: テンプレートを役割ごとに分割して複数用意する。** §3 が 1 つのテンプレートで全フェーズを賄う現行構造を崩し、`orchestrating-runs/SKILL.md` の肥大を招くため採らない。差分は「前提」ブロックの項目で表す。

### 5.7 SubagentStop hook を廃止する

**決定。`plugins/codiel/src/hooks/subagent-stop.ts`、`build.ts:9` のエントリ、`hooks/hooks.json:9-11` の SubagentStop、バンドル `plugins/codiel/scripts/subagent-stop.mjs` を削除する。**

**理由 1(脱出不能になる)。** この hook は run state だけで判定し、停止した子を識別しない(§3.4)。孫サブエージェントが停止した時点でも hook は「in_progress フェーズの成果物が無い」を理由に block し、孫は `Write` を持たないので成果物を書いて脱出できない。これが 2026-09-10 検査の所見 F4 である。

**孫が生まれる条件を正確に置く。** `roles.ts:62-65` の `design-plan` の既定 tools は `Read` / `Grep` / `Glob` / `Write` / `Edit` / `Bash` / `Skill` であり、**`Agent` は含まれない**。既定のままなら孫は生まれない。孫が生まれるのは次の 2 つの場合である。

1. プロジェクトの定義が `Agent` を足しているとき。本リポジトリの `.claude/agents/system-planner.md:6` は `Agent` を持ち、アドバイザーへ相談できる。
2. 解決の規律が無く、ビルトイン `general-purpose`(全ツール)へ縮退したとき(§5.3)。

どちらも実際に起こる構成であり、「既定では起きないから放置してよい」とは言えない。

**理由 2(二重である)。** 成果物の存在確認は `orchestrating-runs/SKILL.md:212-213` にオーケストレーターの義務として既にある。hook を消しても検査は残る。

**discuss だけは `:212-213` の対象外だが、代替がある。** discuss は Raguel ゲートを持たず(`orchestrating-runs/SKILL.md:131` のゲート種別は `complete-phase`)、`:212-213` の「ゲート手順に進む前に確認する」という文言の対象に入らない。しかし `facilitating-design-discussions/SKILL.md:71` が中断再開の規定として「`agenda.md` が無い → アジェンダ作成(architect のディスパッチ)から」を持つ。`agenda.md` が書かれないまま止まっても、次の起動で作成から再開される。SubagentStop の block と同じ結果に到達する。

**理由 3(失うテストが無い)。** `subagent-stop.test.ts` は存在しない(§3.4)。振る舞いを変える案(`agent_type` で絞る)を採るなら先にテストが要るが、廃止なら要らない。

**不採用案 1: `agent_type` で codiel の残る 2 Agent に絞る。** init 以外の文書フェーズは作業内容で表す委譲になり、codiel 側が委譲先の名前を知らないため絞り込みが成立しない。残る価値が init の `issue.md` だけになり、オーケストレーター側の確認で足りる。識別子の設計を新たに背負う割に得るものが無いため採らない。

**不採用案 2: 維持する。** 理由 1 の脱出不能が残るため採らない。

**追随。** `docs/DESIGN.md:386`(§8 の SubagentStop 行)を削除し、同 `:385` の「hooks はツール呼び出しの発行元エージェントを識別できないため、エージェント名ではなく宣言された domain を境界の根拠にする」は PreToolUse についての記述なので残す。hooks.json を変更した後、新しいセッションで PreToolUse と Stop が発火することを確認する(`.claude/rules/metatron/protected-paths.md` の規約)。

### 5.8 agent-policy 側を追随させる

**決定。parallel-nudge の注入文(F6)と orchestration-discipline の 1 条項(F7)を変え、役割 `e2e-verify` の種別を `impl` へ昇格させる(F8)。F5 は codiel 側で解消し、規律は変えない。codiel の名前は agent-policy の指示層・参照層に書かない。**

**F6: parallel-nudge の注入文。** `plugins/agent-policy/src/hooks/parallel-nudge.ts:5-6` の `PARALLEL_NUDGE` を、逐次にする条件に「ワークフローの手順が逐次を定めるとき」を加えた文へ変える。`plugins/agent-policy/src/hooks/__test__/parallel-nudge.test.ts:6-7` に同じ全文がハードコードされ `:27-32` の `toEqual` で照合されているので、両方を揃える。

**理由。** この hook は `Task|Agent` の PreToolUse で毎回注入され、「逐次にするのは前の出力に依存するときだけである」と述べる。codiel は `orchestrating-runs/SKILL.md:238` で「ドメイン別 implementer は 1 体ずつ逐次ディスパッチする」を要求する。逐次にする理由は前の出力への依存ではなく、run state が持てる `domain` が 1 つだけであること(同 `:239`)である。現行の文面はこの正当な逐次を否定する。

**F7: ワークフローの手順を優先する条項。** `plugins/agent-policy/references/orchestration-discipline.md` の §オーケストレーターが自ら担う作業(`:58`)に、コマンドで起動したスキルの手順(スキル駆動のワークフロー)がこの規律のオーケストレーター条項(自ら実行しない・文書を自ら書かない・サブエージェントに毎タスク commit させない)と衝突するときはワークフローの手順を優先する、という条項を 1 文加える。

**理由。** codiel の run は `discussion.md` への記録とウォークスルーの進行をオーケストレーター自身に行わせ(`orchestrating-runs/SKILL.md:288-290`)、実装・テストの委譲先に毎ステップ commit させる(同 `:166-168`)。どちらも規律のオーケストレーター条項(`orchestration-discipline.md:60, 72, 182`)と正面から衝突する。どちらを採るかが明文化されておらず、セッションごとに判断が割れる。

**制約。** 参照文書 2 本の合計は 30,396 B で、30,720 B まで 324 B しか無い(§3.5)。**F7 の 1 文は半角括弧で書いても 315〜321 B になり、残量とほぼ同じである。** したがって既存文の削減は「超えたときの対処」ではなく**既定の手順**として扱う。条項を足すのと同じ変更単位で、削減候補の選定を `prompt-smith:prompt-smith` に委ねて実施する。計画書のタスクにも条件付きではなく既定の手順として書く(§6.6)。

**2026-09-10 検査の所見のうち、追随が要るのは F6 と F7 だけである。** F1(役割経路と名指し経路が併存する構成そのものの指摘)は、本設計で名指しが 3 フェーズに限られることで成立済みとなる。F3(custom 構成で codiel の定義を合成して起動する経路)は、名指し dispatch の廃止によって対象が消える。F5 は §5.4 のとおり codiel 側で解消する。したがって agent-policy に手を入れるのは F6(注入文)と F7(優先順の条項)の 2 点に限る。

**F5 を規律側で直さない理由。** 「依頼文で指定されたスキルだけをロードする」はスキルの無自覚なロードによるコスト増を防ぐ条項であり、緩めるとその目的が崩れる。codiel の側で必要なスキルを全部列挙すれば衝突は消える(§5.4)。片方だけを直す方が影響範囲が小さい。

**F8: `e2e-verify` を `impl` 種別へ昇格させる。** `plugins/agent-policy/src/agents/roles.ts` の `ROLES` にある `e2e-verify`(実測 `:91-96`)の `kind` を `"readonly"` から `"impl"` へ、`tools` を `["Read", "Grep", "Glob", "Bash"]` から impl 役割の既定 `["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]` へ変える。既定の値は同ファイルの他の impl 役割(`complex-impl` は実測 `:31-36`)から取る。

**変えないもの。** `RoleId` union の並び順(`:14`)、Agent Tool の可否(「可」のまま)、`ASSIGNMENTS`(Sonnet。`policies.ts:148`)、`RECOMMENDED`(Sonnet / GPT Astra。同 `:170`)、`label`、`default-name`(`e2e-verifier`)である。

**理由。** `codiel-tester` を廃止すると(§5.1)、テストスクリプトを書いて実行し、レポートを出し、自分の変更をコミットする作業が E2E 検証系の委譲先へ向かう。現状の `e2e-verify` は `tools` に `Write` / `Edit` を持たず、役割の断片本文も「成果物(ファイル)を作らず、報告のみを返す」と定めているため、この作業を受けられない。種別を上げないかぎり、codiel の test-loop は E2E 検証の役割を使えない。

**役割のスコープが広がることは織り込み済みである。** 昇格後の `e2e-verify` は「動かして報告するだけ」の役割ではなく、「依頼された範囲でテストスクリプトを作成・修正して実行し、結果を報告する」役割になる。この拡大はユーザーが 2026-09-23 に承知の上で決めた。「検証対象の永続データを変更しない」という制約は残し、成果物を作らない制約だけを外す。

**先行設計は `e2e-verify` を readonly として正当化していない。** `harness-docs/design/2026-09-07-agent-policy-orchestrator-analysis-design.md` が新設したのは `design-plan` と `explore-lead` の 2 種であり、同書が `e2e-verify` に触れるのは命名パターンの例示(`:124`)と `ROLES` の並び順の引用(`:136`)だけである。readonly という値は `harness-docs/design/2026-09-09-agent-policy-band-catalog-consolidation-design.md` の §役割の帯(同書 `:326`)に担当表の全文として書き写され、そのまま引き継がれてきた。本設計はこの値を上書きする。**上書きの対象は特定の設計判断ではなく、引き継がれてきた値そのものである。**

**双方向の名前の禁止。** codiel の指示層に注入元のプラグイン名を書かないのと同じく、agent-policy の指示層・参照層にも codiel の名前を書かない(`harness-docs/ARCHITECTURE.md:50`)。F7 の条項は「コマンドで起動したスキルの手順」という一般形で書き、F8 で書き換える役割の断片にも codiel の名前を書かない。

**不採用案: `e2e-verify` を readonly のままにし、codiel のテスト委譲を一般の実装帯へ向ける。** E2E スクリプトの作成と実行はブラウザ / GUI 操作の知識を要し、E2E 検証の役割が担うのが自然であるため採らない。

### 5.9 バージョン

**決定。**

| プラグイン | 現行 | 新 | 根拠 |
| --- | --- | --- | --- |
| codiel | `0.8.0-dev` | **`0.9.0-dev`** | Agent 13 体の削除、観点ファイルの新設、ディスパッチ規約の全面改訂、hook 1 本の廃止。影響範囲が広いのでマイナーを上げる |
| agent-policy | `0.19.6-dev` | **`0.19.7-dev`** | 注入文 1 本、参照文書 1 条項、役割 1 件の種別変更。パッチ |
| metatron | `0.3.7-dev` | **`0.3.8-dev`** | 登録簿 fixtures のみ。成果物の変化を問わず規約を適用する(2026-09-15 設計書 §5.8 でユーザーが確定)。直前の追随コミット `e25b27e` も同じ扱い |

現行値は実測である(`plugins/codiel/package.json:3` / `plugins/codiel/.claude-plugin/plugin.json:4` / `plugins/agent-policy/package.json:3` / `plugins/agent-policy/.claude-plugin/plugin.json:4` / `plugins/metatron/package.json:3` / `plugins/metatron/.claude-plugin/plugin.json:4`)。3 プラグインとも `plugin.json` と `package.json` を揃えて上げる。

### 5.10 description の発火測定を行わない

**決定。description を変える 5 スキル(`implementing` / `fixing-failures` / `reviewing-diffs` / `scripting-tests` / `running-regression-tests`)について、`prompt-smith:skill-creator` による発火測定を行わない。description からは Agent 名だけを外し、他の語と文の形は変えない。**

**理由。codiel のスキルは description による自律的な発火を使っていない。** 起動経路は 2 つしかない。1 つはコマンドからの名指しであり、`commands/run.md:8` が `orchestrating-runs` を、`commands/init.md:5` が `initializing-harness` を、`commands/test.md:8` が `running-regression-tests` を、いずれも Skill ツールで名指しして起動する。もう 1 つはオーケストレーターからの名指しのディスパッチである。本改修後はフェーズ用スキルを依頼文の絶対パスで `Read` させるため(§5.4)、この性質はさらに強まる。モデルが description を読んで自ら発火を決める経路は、どのフェーズにも無い。

したがって description の文面が発火率に与える影響を測る意味がない。測定の仕組み(codiel の `evals/`)を持たないことも問題にならない。codiel が dev ステータスであることは補助的な事実にすぎず、測らない主たる根拠ではない。

**変更を Agent 名の除去に限る。** 例えば `implementing` の description(`:3`)は「codiel-implementer-frontend / -backend / -data が使用する」の部分だけを役割の言い方へ置き換え、残りの文は触らない。description を変える 5 スキルは `implementing` / `fixing-failures` / `reviewing-diffs` / `scripting-tests` / `running-regression-tests` である。

**不採用案: 5 スキルの description を作り直す。** 発火に影響しない文面を触ることになり、変更量だけが増えるため採らない。

### 5.11 残る 2 体は `model` を宣言しない

**決定。`codiel-analyst.md` と `codiel-test-designer.md` は frontmatter に `model` を持たない現状のままとする。両者はオーケストレーターのモデルを継承する。**

**理由。** init と test-spec はどちらも 1 回の run につき 1 回ずつしか起動しない。モデルを分けても run 全体のコストはほとんど動かず、宣言を持つことで「プラグイン側が固定した model がプロジェクトの意図を上書きする」という別の問題を招く。宣言しないほうが、利用者がプロジェクト側で同名の定義を置いたときに model の選択もその定義に委ねられる。ユーザーが 2026-09-23 に判断した。

**`model` パラメータの注入は本設計のスコープ外である。** 依頼文から委譲先のモデルを指定する仕組みを codiel が持つかどうかは、本改修では扱わない。

---

## 6. 各変更の詳細

### 6.1 W1 — 削除する Agent の固有部を観点ごとの個別ファイルにする

#### 新設する 9 ファイル

| ファイル | 内容 |
| --- | --- |
| `skills/implementing/references/frontend.md` | UI / 状態管理 / アクセシビリティ / 既存画面との一貫性(`codiel-implementer-frontend.md:22-25`)。画面の表示・遷移の確認は**条件付きで書く**(「Playwright MCP が使えるときは表示・遷移を確認する。使えないときはテストコマンドの結果を根拠にする」。根拠は同 `:40-42`) |
| `skills/implementing/references/backend.md` | API 互換性 / エラーハンドリング / 入力検証(`codiel-implementer-backend.md:20-22`) |
| `skills/implementing/references/data.md` | 可逆なマイグレーション、`design.md` に明記のない破壊的変更は実行せず報告(`codiel-implementer-data.md:22-24`) |
| `skills/reviewing-diffs/references/frontend.md` | `codiel-reviewer-frontend.md:20-26` の確認項目 |
| `skills/reviewing-diffs/references/backend.md` | `codiel-reviewer-backend.md:20-25` の確認項目 |
| `skills/reviewing-diffs/references/data.md` | `codiel-reviewer-data.md:20-29` の確認項目 |
| `skills/reviewing-diffs/references/doc.md` | `codiel-reviewer-doc.md:21-29` の確認項目。**ARCHITECTURE への言及(`:25` の「ARCHITECTURE のドメインマップと実装の乖離を確認する」と `:26` の「修正必須の所見にせず、所有者への報告として出す」)はこのファイルに入る**。登録簿の追加が要る(§6.7) |
| `skills/reviewing-diffs/references/security.md` | `codiel-reviewer-security.md:21-27` の確認項目 + `:29`(実害が起こりうるかで critical / high / medium を判断する)。`:28`(原則 medium 以上)は `reviewing-diffs/SKILL.md:72-73` に既出なので入れない |
| `skills/reviewing-diffs/references/generic.md` | `codiel-reviewer-generic.md:23-28` の確認項目。正しさ・不整合・回帰リスクに限り、専門観点や好みを持ち込まない |

**implementer 側の generic は作らない。** 専門の注意が無いタグは注意なしである(§5.5)。**9 ファイルはいずれも AI が読む指示書**であり、文面の確定は `prompt-smith:prompt-smith` で行う。

#### `plugins/codiel/skills/implementing/SKILL.md`

| 箇所 | 現状 | 変更 |
| --- | --- | --- |
| `:3`(description) | 「codiel-implementer-frontend / -backend / -data が使用する」 | Agent 名を除去する。他の文は変えない(§5.10) |
| `:10-11`(概要) | 「`codiel-implementer-X` または `codiel-implementer-generic` が implement フェーズおよび」 | 「実装を担うサブエージェントが」の趣旨へ改める |
| `:62`(コミット責務) | 「implementer は Bash を持つため、`codiel-planner` / `codiel-architect`(Bash なし・orchestrating-runs がゲート通過後にコミット)とは異なり」 | 根拠を §5.6-4 の形へ書き換える。「文書系フェーズの委譲先は git 操作をしない」を対比に使う |
| 手順 2(`:39-41`)の近く | — | **1 文を足す。** 「依頼文でドメイン別の注意のパスが渡されたときは、それを読み、実装中の注意として従う」の趣旨。**「ドメイン別の注意」の節は設けない** |
| `:36-40` / `:41` / `:83-84` / `:93-103` | 担当タグの絞り込み・ARCHITECTURE を読み物として渡す旨・`.codiel/specs/**` 禁止・ドメイン規律 | **変更しない。** `codiel-implementer-generic.md` の本文はここに含まれている(§3.3)。`:41` は ARCHITECTURE への言及であり、登録簿(`implementing/SKILL.md` の 4 エントリ)の根拠になっているので落とさない |

#### `plugins/codiel/skills/reviewing-diffs/SKILL.md`

| 箇所 | 現状 | 変更 |
| --- | --- | --- |
| `:3`(description) | 「codiel-reviewer-frontend / -backend / -data / -doc / -security が PR diff をレビューするとき使用する」 | Agent 名を観点の言い方へ置き換える。他の文は変えない |
| `:10`(概要) | 「`codiel-reviewer-{frontend,backend,data,doc,security}` が review フェーズおよび」 | 「レビューを担うサブエージェントが、依頼文で指定された観点で」の趣旨へ改める |
| `:26`(観点の指定) | 「自分の観点(frontend/backend/data/doc/security。**詳細は各エージェント定義**)に絞って診るが」 | 観点は依頼文で指定される旨と、詳細は依頼文で渡される観点ファイルにある旨へ改める |
| `:53`(所見書式) | 「- 観点: frontend\|backend\|data\|doc\|security」 | **`generic` を足す。** generic 観点のファイルを持つ以上、書式に無いと generic の所見が書式に適合しない |
| `:72-73`(severity) | 「`codiel-reviewer-security` の指摘は原則 medium 以上を検討する(セキュリティ上の懸念は「好み」に分類されにくいため)」 | **主語を security 観点へ改めるだけ**とする。原則 medium 以上という規律は変えない。`codiel-reviewer-security.md:29` は `references/security.md` へ置くのでここには足さない |
| `:77-78`(所見の統合) | 「全 reviewer(選択参加の frontend/backend/data + 常時参加の doc/security)」 | 観点の言い方へ改める |
| `:91-93`(観点別の焦点) | 「観点ごとの具体的な確認項目は各 `codiel-reviewer-*` エージェント定義に記載する。」の 1 行 | **6 観点の本文は書かない。** 「観点ごとの確認項目は依頼文で渡される観点ファイルにある。渡された観点ファイルを読み、その項目で確認する」の趣旨へ改める |
| `:96-98`(HARD-GATE) | 「reviewer は Edit/Write を持たない読み取り専用の役割であり」 | 権限の断定をやめ、「読み取り系 tools に限って作業する委譲であり」の趣旨へ改める。修正しないという規律は変えない |

**`reviewing-diffs/SKILL.md` 本文に ARCHITECTURE への言及は入らない。** doc 観点の確認項目は `references/doc.md` に入るためである。登録簿の追加先も同ファイルになる(§6.7)。

#### `plugins/codiel/skills/fixing-failures/SKILL.md`

| 箇所 | 現状 | 変更 |
| --- | --- | --- |
| `:3`(description) | 「codiel-implementer-frontend / -backend / -data が NG ケース・レビュー所見を修正するとき使用する」 | Agent 名を役割の言い方へ置き換える |
| `:10` | 「`codiel-implementer-frontend` / `-backend` / `-data` が test-loop の (B) TDD 修正ループ、および」 | 同上 |

#### `codiel-tester.md` の固有規律を 2 スキルへ移す

`codiel-tester.md` の本文は `:7-49` である(`:9-23` 職務と手順、`:25-41` 規律、`:43-49` ツール運用)。全行を `scripting-tests/SKILL.md` と `running-regression-tests/SKILL.md` に突き合わせた結果、**まだ無いのは次の 4 項目だけ**である。

| `codiel-tester.md` の行 | 内容 | 移し先 | 書き方 |
| --- | --- | --- | --- |
| `:29-30` | 「guard-write hook が機械的に守るのは `spec.md` / `cases.md` への書き込みを ask にする部分まで」「hooks はエージェント個体を識別できないため、この境界は自身の規律で守る」 | `scripting-tests/SKILL.md`(HARD-GATE の近く) | 「エージェント個体」を「呼び出し元の委譲先」の言い方へ改める。hook が守る範囲と、残りを自分の規律で守ることの対比は保つ |
| `:41` | 完了報告の 4 項目(実行ケース数 / OK・NG・broken の内訳 / レポートパス / コミットハッシュ) | `running-regression-tests/SKILL.md`(レポート書式の節の後) | 委譲先がオーケストレーターへ返す報告の形として書く。レポート本文の書式(`:82-109`)とは別物である |
| `:45` | ライブラリ・フレームワークの仕様確認は Context7(`resolve-library-id` → `query-docs`)で行い、記憶で書かない | `scripting-tests/SKILL.md` | Context7 が使えるときの手順として書く |
| `:46-49` | Playwright MCP のブラウザ操作で失敗原因を切り分け NG を再現する / 合否の判定はスクリプトの実行結果のみを根拠にする / 手動操作の結果を根拠にしない / MCP 未接続時はコードリーディングとテストコマンドで代替する | `scripting-tests/SKILL.md` | **条件付きで書く。**「使えるときはブラウザ操作で切り分ける。使えないときはコードリーディングとテストコマンドで代替する」。合否の根拠をスクリプトの実行結果に限る規律は条件に関わらず適用する |

**既出につき移さない項目**(突き合わせ済み)。

| `codiel-tester.md` の行 | 既出の場所 |
| --- | --- |
| `:11-13`(最初に `scripting-tests` を読む、回帰では `running-regression-tests` も読む) | 依頼文がスキルの絶対パスを列挙して渡す(§5.4)。スキル本文へは移さない |
| `:14`(フレームワークと実行コマンドの解決順) | `scripting-tests/SKILL.md:31-36` |
| `:15`(`cases.md` の各ケースを `scripts/` へ) | 同 `:11-12`、`:30`、チェックリスト `:55-58` |
| `:16`(1 ケース ID = 1 テスト) | 同 `:37` |
| `:17`(スクリプトを実行する) | 同 チェックリスト `:62` |
| `:18`(レポート先) | `running-regression-tests/SKILL.md:29-31`、`:70-71` |
| `:19-22`(NG ケースの 4 項目) | `scripting-tests/SKILL.md:67-69`、`running-regression-tests/SKILL.md:58-59`、`:94-97` |
| `:23`(正式なレポート書式は `running-regression-tests` に従う) | `scripting-tests/SKILL.md:70` |
| `:27-28`(プロダクトコード・`cases.md`・`spec.md` に書き込まない) | `scripting-tests/SKILL.md:90-91`(HARD-GATE) |
| `:31`(異常終了のときだけスクリプトを直す) | 同 `:25`、チェックリスト `:63-64` |
| `:32`(正常完走で食い違えばプロダクトのバグ) | 同 `:26`、チェックリスト `:65-66` |
| `:33-34`(NG のプロダクトコードを直さない、修正は別へ委ねる) | 同 `:26`、`:90-93`(HARD-GATE) |
| `:35-36`(アサーションを緩めない、sleep で誤魔化さない) | 同 `:49`、`:92-93`、Red Flags `:103-104` |
| `:37`(判断がつかないときは ASK) | 同 `:71-72`、`:94-95` |
| `:38-40`(区切りごとにコミットする、まとめない) | 同 `:73-74`、`:86-87` |
| `:39`(コミットメッセージの形) | 同 `:83` |

**`scripting-tests/SKILL.md:78` の根拠を書き換える。** 現在は「`codiel-tester` は Bash を保持するため、自分の変更を自分でコミットする」である。`codiel-tester` が消えると権限の断定が根拠にならないので、**「テストの委譲先は自分の変更を自分でコミットする」**へ書き換える。根拠を「持っている」から「そう定める」へ移す点は §5.6-4 と同じ扱いである。

#### その他の Agent 名を持つスキルとコマンド

| ファイル | 箇所 | 変更 |
| --- | --- | --- |
| `skills/analyzing-issues/SKILL.md` | `:10` | `codiel-analyst` は残るので**変更しない** |
| `skills/writing-test-specs/SKILL.md` | `:10` / `:87` | `codiel-test-designer` は残るので**変更しない** |
| 同 | `:17`(「実行する自動テストスクリプトは test-loop フェーズで `codiel-tester` が書く」) | **Agent 名を外す。** 「test-loop フェーズで書かれる」の趣旨へ改める |
| `skills/scripting-tests/SKILL.md` | `:3`(description) | **Agent 名を外す。** 外すのは Agent 名だけで、他の語と文の形は変えない(§5.10) |
| 同 | `:10`(「`codiel-tester` が test-loop フェーズの (A) スクリプト安定化ループで使うスキル」) | **Agent 名を外す。** 「test-loop フェーズの (A) スクリプト安定化ループを担う委譲先が使うスキル」の趣旨へ |
| 同 | `:78`(コミット責務の根拠) | **根拠を書き換える**(上記「`codiel-tester.md` の固有規律を 2 スキルへ移す」を参照) |
| `skills/running-regression-tests/SKILL.md` | `:3`(description) | **Agent 名を外す。** 外すのは Agent 名だけである |
| 同 | `:10`(「`codiel-tester` が test-loop フェーズおよび `/codiel:test`(単独実行)で使うスキル」) | **Agent 名を外す。** 委譲の言い方へ改める |
| `commands/test.md` | `:11`(「codiel-tester サブエージェントに『対象 unit のスクリプト実行(必要ならスクリプト安定化)と結果レポート作成』をディスパッチしてください」) | **Agent 名を外す。** 「サブエージェントに〜をディスパッチしてください」の形を保ち、名指しだけをやめる。委譲先の決め方は `orchestrating-runs` の §4 と同じ規則に従う(§5.3) |
| `skills/preparing-design-agendas/SKILL.md` | `:10`(`codiel-architect` が使う) | 役割の言い方へ改める |
| `skills/writing-design-docs/SKILL.md` | `:10`(同上) | 同上 |
| `skills/writing-dev-plans/SKILL.md` | `:10`(`codiel-planner` が使う) | 同上 |
| `skills/fixing-review-findings/SKILL.md` | `:57`(「diff のドメインに応じた `codiel-reviewer-*`(+ 常時参加の doc/security)を再ディスパッチし」) | 観点ごとの再 dispatch の言い方へ改める。手順そのものは変えない |

**`preparing-design-agendas/SKILL.md:10` と `writing-design-docs/SKILL.md:10` では ARCHITECTURE の語を落とさない。** 両ファイルとも Agent 名と ARCHITECTURE の言及が同じ段落にあり、両ファイルとも登録簿に登録済みである(`preparing-design-agendas` は「ドメインマップ」B・「(ARCHITECTURE への言及)」C・「システム概要」D・「技術スタック」D・「レイヤー構造」D、`writing-design-docs` も同型)。Agent 名を消すときに段落ごと書き換えて ARCHITECTURE の語が消えると、V3 が「登録済みなのに実体が無い」で落ちる。

### 6.2 W2 — `orchestrating-runs/SKILL.md` のディスパッチ規約を書き換える

| 箇所 | 現状 | 変更 |
| --- | --- | --- |
| `:128-142`(§2 フェーズ進行表) | 「担当エージェント」列に `codiel-*` の名前 | **列の意味を「委譲の種別と作業内容」へ変える。** 名指し 3 フェーズは Agent 名を残し、残りは「成果物を書く委譲」「読み取りだけの委譲」と作業内容を書く(§5.2 の表が正本)。役割名は書かない |
| `:144-149`(表の下の注) | test-spec / dev-plan の 2 体並列、ドメインディスパッチの参照、fix-loop のスキップ | 並列の記述は維持する。ドメインディスパッチの参照先は §4 のまま |
| `:151-172`(§2.1 コミット規約) | `:153-154` が「`codiel-architect` / `codiel-test-designer` / `codiel-planner` は Bash を持たず」、`:166-167` が「担当サブエージェント(implementer / `codiel-tester`。いずれも Bash を保持)が自分の変更を自分でコミットする」 | `:153-154` は根拠を「文書系フェーズの委譲先は git 操作をしない」へ書き換える(§5.6-4)。`:166-167` は **`codiel-tester` の名前と「いずれも Bash を保持」の断定を外し**、「コード系フェーズの委譲先は自分の変更を自分でコミットする」へ書き換える。責務の分配そのものは変えない。`:156-165`(文書系はオーケストレーターがコミット)と `:169-171`(`pr` 前の `git status --short` 確認)は**維持する** |
| `:173-178`(§3 前文) | 「`subagent_type` にフェーズ担当のエージェント名(`codiel-analyst` 等)を指定して行う」 | 委譲先の表し方を 2 通り(名指し / 作業内容による委譲。後者の解決はセッションの規律に従い、規律が無ければビルトイン)として書き直す |
| `:179-208`(テンプレート本文) | 「あなたは <エージェント名> として、codiel プラグインの <スキル名> スキルを Skill ツールで起動し」 | §5.6 の 1・2・3・4・5 を反映する。「## 読むスキル」にスキルの絶対パスを列挙し、「## 前提」は既存 5 項目(ARCHITECTURE / GOTCHAS / 実行モード / ドメインマップ / 担当タグ)に「ドメイン別の注意の節名」を足す。読み取り限定条項と git 操作禁止は該当フェーズにだけ入れる。末尾に委譲規律の転記欄を置く |
| `:210-213`(テンプレートの下の注) | 解決済みの値を埋める、成果物の存在確認 | **維持する。** 成果物の存在確認は SubagentStop 廃止(§5.7)後の唯一の検査になるため、義務であることを明示する |
| `:215-221`(§4 ドメインディスパッチ) | `:217-219` の実在判定と generic 縮退、`:218` の dangling reference | **実在判定を廃す。** 委譲は §5.2 の種別と作業内容で表し、タグは依頼文と `set-domain` で渡す。`:218` を削除する。`:220-221`(タグの値をそのまま渡す、`unscoped` では `set-domain` しない)は**維持する** |
| 新規(§4 内) | — | **§5.3 の 1 文を置く。** 「委譲先は、セッションに注入されているエージェント運用の規律に従って決める。そのような規律が無いときは、成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore` へ dispatch する。」の趣旨。決め方の手順そのものは書かない |
| `:223-241`(§4.1) | `:234` が「`mapped` でドメイン別 reviewer を 1 体だけディスパッチするときも、担当するドメインタグを `set-domain` に渡す」、`:237` が「ドメインに紐づかないサブエージェント(`codiel-analyst` / `codiel-architect` / …)」と 7 体を列挙 | **`:234` を削除する**(review は読み取りだけの委譲であり `set-domain` しない。§5.2)。`:237` の列挙をフェーズと役割の言い方へ改める。`:238`(implementer は 1 体ずつ逐次)と `:239`(複数同時のときは `clear-domain`)は**維持する** |
| `:285-297`(HARD-GATE) | オーケストレーターは自分で実装・レビュー・テスト作成をしない、等 | **変更しない** |
| `:299-307`(Red Flags) | 「サブエージェントより自分でやった方が速い」の行が「権限を最小化したサブエージェントに任せる」を根拠にする | 根拠を「依頼文で範囲と tools を限定した委譲」へ改める。他の行は変えない |
| `:23-31`(プラグインルート参照規約) | `<plugin-root>` の解決 | **変更しない。** §5.4 のスキル絶対パスはここで解決した値を使う |
| `:53-94`(§0)・`:96-121`(§1)・`:243-283`(§5・§6) | 前提チェック・run 解決・ループ運転・再開 | **変更しない** |

### 6.3 W3 — Agent 13 体を削除する

| 対象 | 変更 |
| --- | --- |
| `agents/codiel-architect.md`、`codiel-planner.md`、`codiel-implementer-{frontend,backend,data,generic}.md`、`codiel-reviewer-{frontend,backend,data,doc,security,generic}.md`、`codiel-tester.md` | **`git rm` で削除する。** 計 13 ファイル |
| `agents/codiel-analyst.md` | 削除される Agent 名への言及なし。**変更しない** |
| `agents/codiel-test-designer.md` | 同上。**変更しない** |

削除後、`plugins/codiel/agents/` に残るのは **2 ファイル**である。`codiel-tester.md` はファイルごと消えるので、本文の修正(`:34` の「修正は該当ドメインの implementer に委ねる。」など)は行わない。固有規律の移し替えは §6.1 が扱う。**残る 2 体の本文を直す作業は無くなったので、`prompt-smith:agent-creator` の起動も要らない。**

### 6.4 W4 — SubagentStop hook を廃止する

| 対象 | 変更 |
| --- | --- |
| `plugins/codiel/src/hooks/subagent-stop.ts` | `git rm` で削除する |
| `plugins/codiel/build.ts:9` | `"subagent-stop": "./src/hooks/subagent-stop.ts",` の行を削除する。他の 5 エントリは変えない |
| `plugins/codiel/hooks/hooks.json:9-11` | `SubagentStop` のキーごと削除する。`PreToolUse` 2 件と `Stop` 1 件は変えない |
| `plugins/codiel/scripts/subagent-stop.mjs` | `git rm` で削除する。**手で編集しない**(保護パス規約)。`pnpm run build` 後に他の 5 つの `.mjs` に差分が出ないことを確認する |
| `plugins/codiel/docs/DESIGN.md:386` | §8 の表から SubagentStop の行を削除する。`:385`(PreToolUse の境界判定と「hooks はツール呼び出しの発行元エージェントを識別できない」)と `:387`(Stop)は**変更しない** |

hooks.json の変更後、新しいセッションで PreToolUse と Stop が発火することを確認し、その記録を残す。

### 6.5 W5 — parallel-nudge の注入文を変える(F6)

| 対象 | 変更 |
| --- | --- |
| `plugins/agent-policy/src/hooks/parallel-nudge.ts:5-6` | `PARALLEL_NUDGE` の文面に、逐次にしてよい条件として「ワークフローの手順が逐次を定めるとき」を加える。文面の確定は `prompt-smith:prompt-smith` で行う |
| `plugins/agent-policy/src/hooks/__test__/parallel-nudge.test.ts:6-7` | ハードコードされた全文を同じ値へ揃える。`:20-33` と `:35-40` のテスト構造は変えない |
| `plugins/agent-policy/scripts/` | `pnpm run build` で再生成し、差分を同じコミットに入れる |

`plugins/agent-policy/hooks/hooks.json` の `matcher: "Task|Agent"` と `AMATSUKA_AGENT_PARALLEL_NUDGE` による無効化の仕組みは変えない。

### 6.6 W6 — orchestration-discipline に優先順の条項を足す(F7)

| 対象 | 変更 |
| --- | --- |
| `plugins/agent-policy/references/orchestration-discipline.md`(§オーケストレーターが自ら担う作業。`:58` 以降) | コマンドで起動したスキルの手順がこの規律のオーケストレーター条項と衝突するときはワークフローの手順を優先する、という条項を 1 文加える。衝突しうる条項は `:60`(自ら実行しない)、`:72`(文書を自ら書かない)、`:182`(毎タスク commit させない)である。codiel の名前は書かない |
| 同ファイル(既存文) | **既存文の削減を既定の手順として行う。** 条項 1 文は半角括弧で書いても 315〜321 B になり、残量 324 B とほぼ同じである(§3.5)。追加してから測って超えていたら削る、という順序では手戻りになる。削る箇所の選定は `prompt-smith:prompt-smith` に委ね、削った箇所と理由を報告に残す |

追加後に `wc -c plugins/agent-policy/references/*.md` の合計が 30,720 B 以下であることを確認する。この 30,720 B は `:181` の条項の直接の帰結ではなく本リポジトリの運用上の約束である(§3.5)が、制約としては維持する。

### 6.7 W7 — 節名参照の登録簿を追随させる

対象: `plugins/metatron/src/fixtures/section-reference-inventory.json`(全 41 エントリ。うち `plugins/codiel/agents/` が 17)

| 操作 | 内訳 |
| --- | --- |
| 削除 | 削除する 13 体のうち、登録簿にエントリを持つ 12 体に対応する **16 エントリ**(`:22-26` architect 1 / `:28-38` implementer-backend 2 / `:40-50` implementer-data 2 / `:52-62` implementer-frontend 2 / `:64-68` planner 1 / `:70-74` reviewer-backend 1 / `:76-80` reviewer-data 1 / `:82-92` reviewer-doc 2 / `:94-98` reviewer-frontend 1 / `:100-104` reviewer-security 1 / `:172-176` implementer-generic 1 / `:178-182` reviewer-generic 1) |
| 残す | `:16-20`(`codiel-analyst.md` の「(ARCHITECTURE への言及)」分類 C)の 1 件 |
| 追加 | `plugins/codiel/skills/reviewing-diffs/references/doc.md` の 2 件。「ドメインマップ」分類 B(doc 観点が ARCHITECTURE のドメインマップとの乖離を確認するため)と「(ARCHITECTURE への言及)」分類 C |

差引で 41 − 16 + 2 = **27 エントリ**になる。

**`codiel-tester.md` を削除しても登録簿の件数は動かない。** 同ファイルは登録簿に 1 件も登録されていない(fixtures に現れる `plugins/codiel/agents/` の 17 件は `codiel-analyst` 1 / `codiel-architect` 1 / `codiel-implementer-backend` 2 / `-data` 2 / `-frontend` 2 / `-generic` 1 / `codiel-planner` 1 / `codiel-reviewer-backend` 1 / `-data` 1 / `-doc` 2 / `-frontend` 1 / `-security` 1 / `-generic` 1 であり、`codiel-tester.md` と `codiel-test-designer.md` は含まれない)。したがって決定 1 を 2 体 / 13 体へ改めても、削除するエントリは 16 件のままであり、差引の 27 も変わらない。`codiel-test-designer.md` は残るが引き続き未登録であり、本改修でも ARCHITECTURE に言及しないので登録しない。

**追加が要る判定の根拠。** 検出は `section-reference-inventory.test.ts:93-106` の `termsIn` の 4 形と、`:112-116` の `referencesIn`(本文に `ARCHITECTURE` の文字列があれば `(ARCHITECTURE への言及)` を足す)で行われる。新設する `references/doc.md` には「ARCHITECTURE のドメインマップ」の形が入り、形 (d)(`ARCHITECTURE[^\n]{0,40}` + 節名)で「ドメインマップ」が検出される。

**スキル配下の `references/` は走査対象に入る。** `targets()`(`:63-81`)は `skills/` を `walkMd` に渡し(`:68`)、`walkMd` はサブディレクトリを再帰的に辿る(`:58`)。既に `plugins/basic-design/skills/api-list/references/template.md` が登録簿に載っている(fixtures `:4-8`)ことがこの動きの実例である。**実装時に `:63-81` を読んで再帰を確認してから登録する。**

**他の 8 ファイルと 2 つの SKILL.md には追加が要らない。** `implementing/references/` の 3 ファイルと `reviewing-diffs/references/` の doc 以外の 5 ファイルは ARCHITECTURE に言及しない。`reviewing-diffs/SKILL.md` は本文に 6 観点を書かないので ARCHITECTURE を含まないままである。`implementing/SKILL.md` は既に 4 エントリ(fixtures `:112-122` と `:184-193`)を持ち、足す 1 文は ARCHITECTURE の節名を持ち込まない。

**分類 A はゼロを維持する**(V1、`section-reference-inventory.test.ts:122-129`)。追加する 2 件は B と C である。

### 6.8 W8 — 文書とメモリの追随

| 対象 | 変更 |
| --- | --- |
| `plugins/codiel/docs/DESIGN.md:318-372`(§7 Agents) | 「ツール制限 = 構造的ハーネス」の見出しと本文を、残る 2 体 + 作業内容で表す委譲の構成へ書き換える。`:328-335`(文書系・分析系の表)は analyst と test-designer の 2 行に絞る。`:337-348`(実装系 3 体)、**`:349-353`(テスト系。`codiel-tester` の 1 行)**、`:355-369`(レビュー系 5 体)の表を削除し、委譲先の選択がセッションの規律に委ねられることと観点の所在(`reviewing-diffs` の節と `references/`)を記す。`:324-326`(MCP 付与方針)は残る 2 体に合わせて書き直す。**同 `:326` は Playwright の付与先を `codiel-implementer-frontend` / `codiel-tester` / `codiel-reviewer-frontend` と名指ししているので、付与先が委譲先の定義側の判断になることを書く。**`:370-372`(利益相反経路の封鎖)は、権限に加えて依頼文の tools 限定条項とスキル本文の HARD-GATE が担うことを書き添える |
| 同 `:260-268`(§ `/codiel:test`) | `:264`(「codiel-tester をディスパッチし」)と `:268`(「tester の書き込み先は」)から Agent 名を外す。`/codiel:test` がサブエージェントへディスパッチすること自体は変えない |
| 同 `:480-492`(ディレクトリ構成の `agents/`) | 列挙を `codiel-analyst.md` と `codiel-test-designer.md` の 2 件に絞る。`:487` の `codiel-tester.md` を含め、削除する 13 体の行を消す |
| 同 `:374-388`(§8 Hooks) | `:386` の SubagentStop 行を削除する(§6.4) |
| `plugins/codiel/docs/skill-flowcharts.md:646, 647, 649, 651` | ディスパッチ先ノードのラベルを新しい委譲先に合わせる。`:646`(discuss)・`:647`(design)・`:649`(dev-plan)・`:651`(implement)を役割の言い方へ改める。`:645`(init の `codiel-analyst`)と `:648`(test-spec の `codiel-test-designer`)は残る 2 体を指すので**変更しない**。`:652`(test-loop の「(A)tester (B)implementer」)・`:654`(review)・`:655`(fix-loop の「implementer/tester/reviewer」)は Agent 名ではなく役割語なので変えない |
| 同 `:639`(precheck ノード) | 「前提チェック\nARCHITECTURE.md / raguel MCP」を現行の §0 に合わせる。§0 が見るのは B + C + D と Raguel MCP であり、ARCHITECTURE は見ない(2026-09-15 の変更に追随していない)。同じファイルを編集するのでこの機会に直す |
| `plugins/codiel/README.md:57`(「スキル/エージェント構成」) | 残る 2 体と、作業内容で表す委譲の構成に合わせて言い換える |
| 同 `:76`(推奨 MCP の説明「`context7`、`github`、`playwright` を MCP サーバーとして登録すると、対応する Codiel エージェントが仕様確認、GitHub 情報の参照、画面挙動の確認に活用します」) | **「対応する Codiel エージェント」を、Playwright を使うのがテスト・実装・レビューの委譲先であることを示す形へ書き換える。** 同梱 Agent ではなく、それらの作業を受ける委譲先が使うこと、委譲先に MCP が付与されているかはプロジェクト側の定義次第であること、未接続でもエラーにならず他のツールで継続することを書く。GitHub は読み取り系ツールだけを許可する旨(同文後半)は変えない |
| 同 `:68-70`(セットアップ手順 2) | 「ARCHITECTURE が無ければ最小構成の `docs/ARCHITECTURE.md` が作成されます」を**削る**。2026-09-15 の決定(codiel は ARCHITECTURE を書かない)に反している。同じファイルを編集するのでこの機会に直す |
| ルート `README.md:68-72`(Codiel 節)・`:143-149`(3 者の関係) | 個別 Agent 名は無いので、単体運用の約束(`:147`)が維持されることを確認するに留める。プラグイン改修の反映として、必要なら Codiel 節の説明を 1 文更新する |
| `.serena/memories/codiel/core.md:86-94`(`## Agents (15) and domain split`) | 見出しの件数と内容を残る 2 体 + 作業内容で表す委譲へ書き換える。`:89` の `codiel-tester` / implementers / reviewers の列挙も同時に直す。`:109`(hooks 一覧の SubagentStop)も直す。`:135`(guard-write の gotcha)の「tester」は役割を指す一般語なので**変えなくてよい**。**Serena の `write_memory` / `edit_memory` で行う** |
| `.serena/memories/agent_policy/core.md:236`(parallel nudge の行) | 注入文の変更を反映する。同じく Serena のツールで行う |
| 同 `:94-96`(17 role IDs の一覧)・`:357-359`(参照文書の残量)・`:367-373`(`RECOMMENDED` の値) | **役割一覧に種別(`kind`)の記述は無い**(実測)。`e2e-verify` の昇格で必須の追随は生じない。`:357-359` の「30,720 B の上限に対し残り 324 B」は F7 の実施後の値へ直す。`:367-373` の `e2e-verify` → Sonnet / GPT Astra は変えない |

### 6.9 W9 — バージョンを上げる

`plugins/codiel/.claude-plugin/plugin.json:4` と `plugins/codiel/package.json:3` を `0.9.0-dev` に、`plugins/agent-policy/` の同 2 ファイルを `0.19.7-dev` に、`plugins/metatron/` の同 2 ファイルを `0.3.8-dev` にする。

### 6.10 W10 — ADR を切る

`metatron:updating-architecture` スキルを Skill ツールで起動して行う。`stage-adr` → `commit-architecture` の CLI 実行だけでは手順が足りない(diff-architecture・get rules・草案の第三者検査の 3 手順が要る)。

- タイトルの趣旨: 「[codiel] ディスパッチ先を作業内容で表し、選択をセッションの運用方針に委ねる」。タイトルの形は `[<プラグイン名>] <タイトル>`(`.claude/rules/metatron/conventions.md` の文書配置)。
- 決定: 同梱 Agent を 2 体(`codiel-analyst` / `codiel-test-designer`)に絞り、残るフェーズの委譲先を名指しでも役割名でも指定せず、作業内容と委譲の種別だけを渡す。あわせて agent-policy の役割 `e2e-verify` を `readonly` から `impl` へ昇格させる。
- 文脈: 名指し dispatch がプロジェクト最適化を通さないこと(F2)、ツール制限による構造的ハーネスが文面の規律へ移ること。
- 帰結: `docs/DESIGN.md` §7 の「ツール制限 = 構造的ハーネス」が部分的に成立しなくなること、SubagentStop の廃止。**あわせて、codiel は委譲先を名指しでも役割名でも指定せず、作業内容と委譲の種別だけを渡すこと、選択はセッションの運用方針に委ねること、方針が無い環境ではビルトインへ縮退することを書く。** ADR はリポジトリ共通の文書であり、指示層でも参照層でもないので両プラグインの名前を書ける。
- ADR-003(`harness-docs/ARCHITECTURE.md:181`)は別件であり、改訂しない。
- ARCHITECTURE 本文の構造変更は無い。`agents/` ディレクトリは残るため、レイヤー構造(`:27-50`)とディレクトリ構成(`:52-84`)は変わらない。

### 6.11 W11 — `e2e-verify` を `impl` 種別へ昇格させる

§5.8 の F8 の実施である。**行番号はすべて実測(2026-09-23)であり、着手時に再確認する。**

| 対象 | 変更 |
| --- | --- |
| `plugins/agent-policy/src/agents/roles.ts:91-96`(`ROLES` の `e2e-verify` エントリ) | `kind`(`:94`)を `"readonly"` → `"impl"`、`tools`(`:95`)を `["Read", "Grep", "Glob", "Bash"]` → `["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]` へ変える。`id` と `label` は変えない |
| 同 `:14`(`RoleId` union の `e2e-verify`) | **変更しない。並び順を動かさない。** `roles.test.ts:137-146` が `roleOrder("advisor") === ROLES.length - 1` を検査しており、`ROLES` の並びを動かすとこのテストの前提が崩れる |
| `plugins/agent-policy/src/agents/__test__/roles.test.ts:65` と `:77-81` | `:65` のフィルタ条件(`["escalation", "final-review", "e2e-verify", "gate-review"].includes(role.id)`)はそのままでよい。`:77-81` の `e2e-verify` の期待値オブジェクトの `kind` と `tools` を新しい値へ揃える |
| 同 `:119-124`(「読み取り役割に Write / Edit を含まない」) | **変更しない。** `kind === "readonly"` でフィルタするため、`e2e-verify` は自動的に対象から外れる |
| 同 `:23`(17 件の ID 配列) | **変更しない。** ID も並びも変わらない |
| `plugins/agent-policy/references/orchestration-discipline.md:19`(担当表の `e2e-verify` 行) | 「種別」列を `readonly` → `impl` へ変える。**行の並びは変えない。** 他の列(役割名 / RoleId / Agent Tool「可」/ Claude モデル `Sonnet`)も変えない。表のヘッダは `:7`、種別の定義文は `:28` にあり、どちらも変えない |
| `plugins/agent-policy/assets/roles/ja/e2e-verify.md` | frontmatter の `tools`(`:6`)と `kind`(`:7`)を `roles.ts` と同じ値へ揃える。「## Core Responsibilities」(`:14-16`)に、依頼された範囲でテストスクリプトを作成・修正し実行する旨を足す。「## 制約」の `:26`「**E2E 動作検証として依頼されたときは**、成果物(ファイル)を作らず、報告のみを返す。」を**外す**。`:27`「検証対象の永続データを変更しない」は**残す**。`:28`(操作手段が使えないときは未検証として報告)も残す。「## Output Format」(`:30-35`)に、作成・変更したファイルの項を足す |
| `plugins/agent-policy/assets/roles/en/e2e-verify.md` | 同じ変更を英語で行う。`:26` の "do not create deliverable files. Return a report only." を外し、`:27` の永続データの制約は残す |
| 両言語の一致 | `id` / `default-name`(`e2e-verifier`)/ `tools` / `kind` を ja と en で一致させる。`compose.test.ts` が ja / en の一致を検査する。`label`(ja「E2E 動作検証・ブラウザ/GUI 操作」/ en「E2E Verification and Browser/GUI Operation」)と `description` は言語ごとに異なってよい |
| 文面の確定 | 両言語の断片と担当表は AI が読む指示書である。`prompt-smith:prompt-smith` を起動して確定する |
| `plugins/agent-policy/scripts/` | `pnpm run build` で再生成する。役割の定義は `session-start.mjs`(`:152` 付近)・`subagent-start.mjs`(`:69` 付近)・`delegation-gate.mjs`(`:70` 付近)・`setup-agents.mjs`(`:283` / `:437` / `:457` 付近)の各バンドルに埋め込まれているため、**`parallel-nudge.mjs` 以外の `.mjs` にも差分が出る。** 手で編集しない |

**変更しないもの。** `plugins/agent-policy/src/agents/policies.ts:148`(`ASSIGNMENTS` の `e2e-verify: ["sonnet"]`)と `:170`(`RECOMMENDED` の `e2e-verify: ["sonnet", "gpt-astra"]`)。どちらも役割 ID をキーにしており `kind` を見ない。

**通るはずのテスト(変更は要らないが、実装時に実行して確認する)。**

| テスト | 位置 | 通る理由 |
| --- | --- | --- |
| `discipline-role-table.test.ts:176-178` | 担当表の「種別」列と `ROLES` の `kind` を `toEqual` で突き合わせる | **`e2e-verify` を名指ししておらず、`ROLES` から導出する。** ただし `roles.ts` と担当表の**両方**を直さなければ落ちる。片方だけの変更を許さない安全網として働く |
| `compose.test.ts:135` | `frontmatter(build(["e2e-verify"])).tools` が `Agent` を含む | Agent Tool の可否は変えないため不変 |
| `fragments.test.ts:68` | `fragments.get("e2e-verify")?.defaultName === "e2e-verifier"` | `default-name` を変えないため不変 |
| `setup-agents.test.ts:1011` | `agentToolFor("e2e-verify") === true` | 同上。`:476` / `:748` / `:1853` も ID と並びに依存するだけで不変 |
| `policies.test.ts:31` / `:51` / `:71` | ASSIGNMENTS / RECOMMENDED / Agent Tool の期待値 | いずれも変えないため不変。`:217` / `:258` も同様 |
| `marker-scan.test.ts:305` | `roleLabel({}, "e2e-verify")` が label を返す | `label` を変えないため不変 |

**実装時に `grep -rn "e2e-verify" plugins/agent-policy/src` で全件を洗い、`impl` / `readonly` の kind に依存する箇所が他に無いことを確認する。** 2026-09-23 時点の実測では、`src` 配下のヒットは `policies.ts:148, :170`、`roles.ts:14, :92`、および上記のテスト群だけである。

**`plugins/agent-policy/README.md:123` は変更しない。** 組み込み役割 ID の表(`:109-129`)は役割 ID と内容の 2 列であり、**種別(`kind`)の列も記述も持たない**(実測)。

---

## 7. 影響ファイル一覧

### 7.1 codiel(削除)

| ファイル | 操作 |
| --- | --- |
| `plugins/codiel/agents/codiel-architect.md` | 削除 |
| `plugins/codiel/agents/codiel-planner.md` | 削除 |
| `plugins/codiel/agents/codiel-implementer-frontend.md` | 削除 |
| `plugins/codiel/agents/codiel-implementer-backend.md` | 削除 |
| `plugins/codiel/agents/codiel-implementer-data.md` | 削除 |
| `plugins/codiel/agents/codiel-implementer-generic.md` | 削除 |
| `plugins/codiel/agents/codiel-reviewer-frontend.md` | 削除 |
| `plugins/codiel/agents/codiel-reviewer-backend.md` | 削除 |
| `plugins/codiel/agents/codiel-reviewer-data.md` | 削除 |
| `plugins/codiel/agents/codiel-reviewer-doc.md` | 削除 |
| `plugins/codiel/agents/codiel-reviewer-security.md` | 削除 |
| `plugins/codiel/agents/codiel-reviewer-generic.md` | 削除 |
| `plugins/codiel/agents/codiel-tester.md` | 削除(固有規律は §6.1 のとおり `scripting-tests` / `running-regression-tests` へ移す) |
| `plugins/codiel/src/hooks/subagent-stop.ts` | 削除 |
| `plugins/codiel/scripts/subagent-stop.mjs` | 削除(生成物。`git rm` で消し、build で再生成されないことを確認する) |

### 7.2 codiel(指示層)

| ファイル | 変更箇所 |
| --- | --- |
| `plugins/codiel/skills/orchestrating-runs/SKILL.md` | §2 表(`:128-142`)、§2.1(`:153-154`、`:166-167`)、§3(`:173-213`)、§4(`:215-221`)、§4.1(`:234`、`:237`)、Red Flags(`:304`) |
| `plugins/codiel/skills/implementing/SKILL.md` | `:3`、`:10-11`、`:62`、手順 2 の近くに 1 文を追加 |
| `plugins/codiel/skills/implementing/references/frontend.md` | **新規** |
| `plugins/codiel/skills/implementing/references/backend.md` | **新規** |
| `plugins/codiel/skills/implementing/references/data.md` | **新規** |
| `plugins/codiel/skills/reviewing-diffs/SKILL.md` | `:3`、`:10`、`:26`、`:53`、`:72-73`、`:77-78`、`:91-93`、`:96-98` |
| `plugins/codiel/skills/reviewing-diffs/references/frontend.md` | **新規** |
| `plugins/codiel/skills/reviewing-diffs/references/backend.md` | **新規** |
| `plugins/codiel/skills/reviewing-diffs/references/data.md` | **新規** |
| `plugins/codiel/skills/reviewing-diffs/references/doc.md` | **新規**(ARCHITECTURE に言及する。登録簿 +2 の対象) |
| `plugins/codiel/skills/reviewing-diffs/references/security.md` | **新規** |
| `plugins/codiel/skills/reviewing-diffs/references/generic.md` | **新規** |
| `plugins/codiel/skills/fixing-failures/SKILL.md` | `:3`、`:10` |
| `plugins/codiel/skills/fixing-review-findings/SKILL.md` | `:57` |
| `plugins/codiel/skills/preparing-design-agendas/SKILL.md` | `:10` |
| `plugins/codiel/skills/writing-design-docs/SKILL.md` | `:10` |
| `plugins/codiel/skills/writing-dev-plans/SKILL.md` | `:10` |
| `plugins/codiel/skills/writing-test-specs/SKILL.md` | `:17` |
| `plugins/codiel/skills/scripting-tests/SKILL.md` | `:3`、`:10`、`:78`、および §6.1 の 4 項目の追記 |
| `plugins/codiel/skills/running-regression-tests/SKILL.md` | `:3`、`:10`、および §6.1 の完了報告 1 項目の追記 |
| `plugins/codiel/commands/test.md` | `:11` |

### 7.3 codiel(実装層・配布物・文書)

| ファイル | 変更箇所 |
| --- | --- |
| `plugins/codiel/build.ts` | `:9` |
| `plugins/codiel/hooks/hooks.json` | `:9-11` |
| `plugins/codiel/docs/DESIGN.md` | `:318-372`、`:386` |
| `plugins/codiel/docs/skill-flowcharts.md` | `:646`、`:647`、`:649`、`:651` |
| `plugins/codiel/README.md` | `:57`、`:76` |
| `plugins/codiel/.claude-plugin/plugin.json` | `:4` |
| `plugins/codiel/package.json` | `:3` |

### 7.4 agent-policy

| ファイル | 変更箇所 |
| --- | --- |
| `plugins/agent-policy/src/hooks/parallel-nudge.ts` | `:5-6` |
| `plugins/agent-policy/src/hooks/__test__/parallel-nudge.test.ts` | `:6-7` |
| `plugins/agent-policy/src/agents/roles.ts` | `:94`(`kind`)、`:95`(`tools`)。`:14` の並びは変えない |
| `plugins/agent-policy/src/agents/__test__/roles.test.ts` | `:77-81`(`e2e-verify` の期待値の `kind` と `tools`) |
| `plugins/agent-policy/assets/roles/ja/e2e-verify.md` | frontmatter `:6`・`:7`、本文「Core Responsibilities」「制約」「Output Format」 |
| `plugins/agent-policy/assets/roles/en/e2e-verify.md` | 同じ箇所を英語で |
| `plugins/agent-policy/scripts/` | build で再生成。`parallel-nudge.mjs` に加え、役割定義を埋め込む `session-start.mjs` / `subagent-start.mjs` / `delegation-gate.mjs` / `setup-agents.mjs` にも差分が出る |
| `plugins/agent-policy/references/orchestration-discipline.md` | §オーケストレーターが自ら担う作業(`:58` 以降)に 1 文追加。既存文の削減を既定の手順として伴う。あわせて担当表の `:19` の「種別」列を `impl` へ |
| `plugins/agent-policy/README.md` | **変更しない。** 組み込み役割 ID の表(`:109-129`)に種別の列も記述も無い(§6.11) |
| `plugins/agent-policy/.claude-plugin/plugin.json` | `:4` |
| `plugins/agent-policy/package.json` | `:3` |

### 7.5 metatron

| ファイル | 変更箇所 |
| --- | --- |
| `plugins/metatron/src/fixtures/section-reference-inventory.json` | 16 件削除、2 件追加 |
| `plugins/metatron/.claude-plugin/plugin.json` | `:4` |
| `plugins/metatron/package.json` | `:3` |

### 7.6 リポジトリ共通

| ファイル | 変更箇所 |
| --- | --- |
| `harness-docs/ARCHITECTURE.md` | ADR 1 件の追加のみ(`metatron:updating-architecture` 経由) |
| `README.md` | Codiel 節の反映 |
| `.serena/memories/codiel/core.md` | `:86-94`、`:109` |
| `.serena/memories/agent_policy/core.md` | `:236`、`:357-359`。`:94-96` と `:367-373` は種別を持たないので変更しない(§6.8) |
| `.claude/agents/complex-reviewer.md` | **変更しない**(§9 のリスク 9) |

### 7.7 変更しないもの(`git diff` が空であることを検証する)

`plugins/codiel/src/hooks/guard-write.ts`、`plugins/codiel/src/hooks/guard-bash.ts`、`plugins/codiel/src/hooks/stop-guard.ts`、`plugins/codiel/src/hooks/lib.ts`、`plugins/codiel/src/codiel-state.ts`、`plugins/codiel/src/codiel-state-cli.ts`、`plugins/codiel/raguel-mcp/`、`plugins/codiel/src/hooks/__test__/`(4 本すべて)、`plugins/codiel/src/__test__/codiel-state.test.ts`、`plugins/sandalphon/`。

---

## 8. テスト方針

### 8.1 既存テストを書き換えない範囲

- `plugins/codiel/src/hooks/__test__/guard-write.test.ts`。`:337` に Agent 名がコメントとして出るだけで、assertion は Agent 名に依存しない。書き換えが要ると判断した時点で実装を止めて報告する。
- `plugins/codiel/src/hooks/__test__/guard-bash.test.ts` / `lib.test.ts` / `stop-guard.test.ts`。
- `plugins/codiel/src/__test__/codiel-state.test.ts`。
- `plugins/metatron/src/__test__/section-reference-inventory.test.ts`。fixtures 側を直して V1 / V2 / V3 を通す。
- 3 者比較テスト(`plugins/sandalphon/src/__test__/check-intent-env.test.ts` の 16f 群、`plugins/metatron/src/lib/__test__/config.test.ts` の R4 群)。本改修は `DomainsRead` にも設定解決にも触れないので無傷であるべきである。

### 8.2 更新が要る既存テスト

- `plugins/agent-policy/src/hooks/__test__/parallel-nudge.test.ts:6-7`。注入文のハードコード全文を `parallel-nudge.ts:5-6` と揃える。`:27-32` の `toEqual` 構造と `:35-40` の無効化ケースは変えない。
- `plugins/agent-policy/src/agents/__test__/roles.test.ts:77-81`。`e2e-verify` の期待値オブジェクトの `kind` と `tools` を新しい値へ揃える(§6.11)。同ファイルの `:23`・`:65`・`:119-124`・`:137-146` は変えない。

**assertion を変える既存テストはこの 2 本だけである。** `discipline-role-table.test.ts` は `ROLES` と担当表から導出するので変更が要らないが、`roles.ts` と `orchestration-discipline.md:19` の両方を直さないと落ちる(§6.11)。

### 8.3 新規テスト

**追加しない。**

理由は 2 つある。第 1 に、本改修の変更対象の大半が指示層の文書であり、vitest で固定できる振る舞いを持たない。第 2 に、削除する `subagent-stop.ts` にはもともとテストが無く(§3.4)、削除で失うカバレッジがない。振る舞いを変えるのではなく丸ごと消すため、変更前の振る舞いを固定するテストを先に起こす必要がない。

### 8.4 検証の代替手段

自動テストが効かない部分は次で確かめる。

| 検証対象 | 手段 |
| --- | --- |
| 削除した 13 の Agent 名が残っていない | `grep -rn 'codiel-\(architect\|planner\|implementer\|reviewer\|tester\)' plugins/codiel/skills plugins/codiel/commands plugins/codiel/agents` が 0 件。**`tester` を検査語に加える**(決定 1 の改定による)。`codiel-state` は別語なので誤検出しない |
| `agents/` に 2 ファイルだけ残る | `ls plugins/codiel/agents/` |
| SubagentStop が消えている | `grep -n SubagentStop plugins/codiel/hooks/hooks.json` が 0 件、`ls plugins/codiel/scripts/subagent-stop.mjs` が存在しない |
| build 出力に想定外の差分が無い | `pnpm run build` 後に `git status --short plugins/codiel/scripts plugins/agent-policy/scripts` を確認。codiel 側は `subagent-stop.mjs` の削除のみ。agent-policy 側は `parallel-nudge.mjs` に加え、役割定義を埋め込む `session-start.mjs` / `subagent-start.mjs` / `delegation-gate.mjs` / `setup-agents.mjs` にも差分が出る(§6.11) |
| `e2e-verify` が `impl` になっている | `grep -n 'e2e-verify' -A3 plugins/agent-policy/src/agents/roles.ts` の `kind` が `"impl"`、`tools` が impl 既定の 7 件。`grep -n 'e2e-verify' plugins/agent-policy/references/orchestration-discipline.md` の種別列が `impl`。ja / en の断片の frontmatter が両方 `kind: impl` |
| 参照文書の合計 | `wc -c plugins/agent-policy/references/*.md` の合計が 30,720 B 以下 |
| `orchestrating-runs` の大きさ | `wc -c plugins/codiel/skills/orchestrating-runs/SKILL.md` の**実測を記録する**。閾値による合否判定は行わない(§3.6) |
| 変えないものが無傷 | `git diff --stat` が §7.7 の列挙に一切触れていない |
| hook の発火 | hooks.json 変更後、新しいセッションで PreToolUse(Bash と Edit/Write)と Stop が発火することを確認し、記録を残す |

### 8.5 登録簿テストの 3 方向

| 検査 | 本改修での落ち方 | 対処 |
| --- | --- | --- |
| V1(`:122-129`。分類 A がゼロ) | 落ちない | 追加する 2 件を B と C にする |
| V2(`:131-145`。未登録の参照で落ちる) | 新設する `reviewing-diffs/references/doc.md` に ARCHITECTURE 言及とドメインマップ参照が入ると落ちる(`walkMd` が `skills/` を再帰走査するため。§6.7) | 2 件を追加する |
| V3(`:147-160`。登録済みなのに実体が無いと落ちる) | Agent 13 体の削除のうち、登録簿にエントリを持つ 12 体分の 16 件が stale になり落ちる。**`codiel-tester.md` は未登録なので削除しても V3 に影響しない**(§6.7) | 16 件を削除する |

**登録簿の変更は、それを必要にする本文の変更と同じコミットに入れる。** 追加 2 件は `reviewing-diffs/references/doc.md` の新設と同一コミット、削除 16 件は Agent 13 体の削除と同一コミットである。登録簿だけを別コミットにすると、必ずどちらかの側が赤の中間状態を作る。

**追加と削除を別コミットに分けても V1〜V3 は赤にならない。** V2 は実ファイルを走査して未登録の参照を探すので、`doc.md` を新設したコミットの時点で 2 件が登録されていれば通る。V3 は登録済みエントリのファイル実在と参照残存を見るが、まだ削除していない 13 体は実在しているので通る。Agent 削除コミットで 16 件を同時に外せば、そこでも V3 は通る。**削除済みのファイルは `targets()`(`section-reference-inventory.test.ts:64-75`)の走査対象に出ないので、V2 が取り残すこともない。**

---

## 9. リスクと受容

| # | リスク | 受容の理由・対処 |
| --- | --- | --- |
| 1 | **ツール制限による構造的ハーネスが全面的に後退する。** 「テスターが期待値を緩めて合格させる」「レビューアーが自分で直して自己承認する」を権限で塞いでいた保証(`docs/DESIGN.md:370-372`)が、どちらも文面の規律へ移る。あわせて、文書系フェーズの「git 操作をしない」も文面の規律だけになる | **テスター側の権限的保証は失われる。** `codiel-tester` を残せば「`cases.md` / `spec.md` への書き込みが `guard-write` で ask になる」「プロダクトコードを直さない規律が名指しの定義に紐づく」という保証が維持できたが、決定 1 の改定によりこの Agent は削除する(§5.1)。保証は `scripting-tests/SKILL.md:89-96` と `running-regression-tests/SKILL.md:113-120` の HARD-GATE へ**全面的に移る**。`guard-write` hook が `spec.md` / `cases.md` への書き込みを ask にする部分だけは委譲先を問わず残り(hook は呼び出し元を識別しないため。§6.1 で移す `codiel-tester.md:29-30`)、それ以外は文面が担う。レビュー側は、解決の規律がある環境ではコードレビューの役割が読み取り専用の定義へ結び付くことを期待でき、規律が無い環境ではビルトインの `Explore`(読み取り専用)へ縮退する。どちらでもない経路に対しては依頼文の読み取り限定条項(§5.6-2)と `reviewing-diffs` の HARD-GATE が残る。文書系フェーズは `general-purpose`(全ツール)へ落ちうるため `guard-bash` は助けにならない(`ALWAYS_DENY` に `git commit` は無い。§5.3)。**構造的な保証が文面の規律へ全面的に移ることを受容する。**これは ADR の帰結として記録する(§6.10) |
| 2 | **委譲先の本文が codiel の規律と食い違う。** プロジェクト側の定義が独自の手順や報告形式を持つ | 依頼文がスキルの絶対パスと手順への追従を明示し、スキル本文の HARD-GATE が優先する形にする。食い違いが run を壊した場合は Raguel のゲートと成果物の存在確認で止まる |
| 3 | **`orchestrating-runs/SKILL.md` が大きくなる。** 現在 30,111 B | §3.6 のとおり 30,720 B の上限は当てない(条項の主語は委譲先にロードさせるスキルであり、これはオーケストレーター自身が読むスキルである)。実装時に `wc -c` の実測を記録し、大きく増えたときに構成を見直すかどうかは実測を見てから別途判断する |
| 4 | **参照文書 2 本の合計が上限を超える。** 残り 324 B に対し F7 の条項が 315〜321 B(§3.5) | 既存文の削減を既定の手順として行う(§6.6)。条項を足してから測って超えていたら削る、という順序にしない |
| 5 | **description の変更で 5 スキルの発火が変わる** | **該当しない。** codiel のスキルはコマンドと依頼文からの名指しでしか起動せず、description をモデルが読んで自律的に発火させる経路を使っていない(§5.10)。description の文面は発火率に影響しないので、リスクとして成立しない |
| 6 | **run の実地検証ができない。** ディスパッチ規約は文書であり自動テストが効かない | §8.4 の grep と目視で構造を確かめる。実 run での検証は本改修の完了条件に含めない |
| 7 | **`name` を失うことで Claude Code の上書き機構が効かなくなる。** プロジェクト側で `codiel-implementer-backend.md` を定義していた利用者は上書き先を失う | codiel は dev ステータスであり、そうした利用者はいない前提で受容する。移行の案内は書かない |
| 8 | **Playwright を frontmatter で保証する経路が 1 つも残らない。** `codiel-reviewer-frontend.md` と `codiel-tester.md` の `mcp__playwright` は移し先が無い。スキル本文へ書いても tools は付与されない | 委譲先が Playwright を持つかはプロジェクト側の定義次第である。`reviewing-diffs` の確認項目はコードリーディングと `gh pr diff` で成立する形に保ち、ブラウザ確認を前提にしない。`implementing` の frontend の注意と `scripting-tests` の切り分け手順は「使えるときはブラウザ操作で確認する。使えないときはコードリーディングとテストコマンドで代替する」という条件付きで書く(§5.5、§6.1)。`e2e-verify` の昇格(§5.8 の F8)によって、ブラウザ操作を伴う作業が E2E 検証の役割へ向かう経路は残る。**受容する** |
| 9 | **このリポジトリの `.claude/agents/complex-reviewer.md` が `e2e-verify` の `impl` 化に追随しない。** 同定義は `e2e-verify` / `final-review` / `gate-review` の 3 役割のホストであり(`:8`)、`tools`(`:6`)は `Read, Grep, Glob, Bash, Agent` と MCP で `Write` / `Edit` を持たない。codiel のテスト委譲がこの定義へ解決されると、`Write` を持たない定義に当たる。**規律の解決順は候補の `tools` を見ないため、実行時に差し戻される** | **本改修では `complex-reviewer.md` を再生成しない。** 同定義は `final-review` と `gate-review`(いずれも `readonly` のまま)も担っており、`impl` の既定 tools へ丸ごと寄せると読み取り専用であるべき 2 役割の保証が消える。対処は、利用者が `agent-policy:setup-agents` で `e2e-verify` 単独の `impl` 定義を作ることである。再生成するときは GOTCHA-001 の `--mcp-deny` の教訓に従う。**このリポジトリでの追随は本改修のスコープ外とし、受容する** |
| 10 | **`e2e-verify` のスコープが広がる。** 「動かして報告するだけ」の役割が、テストスクリプトを作成・修正して実行し、成果物をコミットする役割になる | ユーザーが 2026-09-23 に承知の上で決めた(§5.8 の F8)。「検証対象の永続データを変更しない」という制約は残すので、検証対象そのものを壊す経路は塞がれたままである。**受容する** |

---

## 10. 不採用案(まとめ)

各節に記した不採用案を 1 箇所に集める。再提案しない。

| # | 案 | 不採用の理由 | 出典 |
| --- | --- | --- | --- |
| 1 | `codiel-tester` を残す | Bash + Write/Edit + Playwright は「成果物を書く委譲」の tools として一般的であり、規律の側で E2E 検証の委譲先も汎用の実装帯も選べる。固有規律はスキル本文で表せ、その大半は既に `scripting-tests` と `running-regression-tests` にある。残すと `/codiel:test` と test-loop A だけが名指し dispatch のまま残り、プロジェクト最適化が届かない。**ユーザー指摘(2026-09-23、4 段階目)** | §5.1 |
| 2 | 全 15 体を削除する | `codiel-analyst`(Bash を `gh issue view` に限る規律 + GitHub MCP 読み取り群)と `codiel-test-designer`(Bash 無し・Write/Edit 有り)の tools の組合せが一般の委譲先と合わない | §5.1 |
| 3 | review の 6 観点を 1 dispatch にまとめる | 現行の並列前提(`docs/DESIGN.md:367`)を崩し、観点ごとの報告粒度(`reviewing-diffs:44`)も保てない。**ユーザーが 2026-09-23 に不採用で確定させた。**見直しの論点として残さない | §5.2 |
| 4 | 汎用 Agent を 1〜2 体同梱して縮退先にする | 定義の保守が残り、目的を部分的に取り消す | §5.3 |
| 5 | 解決の規律が無ければ run を開始しない | 単体運用の約束を捨てる | §5.3 |
| 6 | 常にスキル本文を依頼文へ転記する | 1 run 13 回前後 × 6〜10 KB のコンテキスト増 | §5.4 |
| 7 | 常に Skill ツールで起動させる | Skill を持たない readonly 定義に届かない | §5.4 |
| 8 | `plugins/codiel/references/`(プラグイン直下)を新設して観点ファイルを置く | 参照層の定義は「複数の指示から共有する規律と断片」(`ARCHITECTURE.md:33`)であり、1 スキルからしか読まれないファイルは当たらない。読み手が 1 スキルに閉じるならそのスキルの一部として同居させる | §5.5 |
| 9 | 観点を `assets/` の資料として置く | 「読まなくてもよい」余地を作る | §5.5 |
| 10 | 依頼文テンプレートを役割ごとに分割する | `orchestrating-runs` の肥大を招く | §5.6 |
| 11 | SubagentStop を `agent_type` で codiel の残る 2 体に絞る | 作業内容で表した委譲先の名前を codiel が知らない。残る価値が init だけになる | §5.7 |
| 12 | SubagentStop を維持する | 孫サブエージェントの脱出不能(F4)が残る | §5.7 |
| 13 | F5 を規律側(「指定されたスキルだけをロードする」)の緩和で直す | 無自覚なスキルロードを防ぐ目的が崩れる。codiel 側で解消する方が影響範囲が小さい | §5.8 |
| 14 | 5 スキルの description を作り直す | codiel のスキルは名指しでしか起動せず、description が発火に影響しない。影響しない文面を触ることになり、変更量だけが増える | §5.10 |
| 15 | 文書系フェーズ(discuss / design / dev-plan)を「文書作成」の役割へ委譲する | その役割の既定 tools に `Agent` が無く(`roles.ts:67-72`)孫が生まれないという利点はあるが、「文書作成」の担当範囲は**内容が確定した後の文章化**である。設計書と実装計画書の初稿を書くのは「設計書・実装計画書(WBS)の作成」の担当範囲であり、役割の定義を曲げることになる | §5.3 |
| 16 | 該当する役割の定義が無いときの解決手順(候補の絞り込み・description による担当範囲の一致など)を codiel 側に書く | 解決はセッションの規律の仕事である。codiel が重ねて書くと二重管理になり、規律が変わったときに食い違う | §5.3 |
| 17 | codiel の指示層で委譲先の解決機構(対応表・RoleId・行の形・候補範囲)を明示する | 運用方針を併用しているセッションでは解決規則がすでに注入されており、codiel が重ねて書けば二重管理になる。単体運用のセッションでは機構そのものが存在しないので、機構に言及した指示は意味を持たない。**ユーザー指摘(2026-09-23、1 段階目)** | §5.2、§5.3 |
| 18 | codiel の指示層で委譲先を役割名(担当表の役割名)で表す | 役割名を固定すると、作業の重さに応じた帯の選択が消える。実装をすべて同じ帯へ送ることになり、複数コンポーネントにまたがる実装を重い帯へ、行き詰まりをエスカレーションの帯へ上げる経路が codiel の文面によって塞がれる。最近のモデルは作業内容から適切な委譲先を選べるので、固定する必要もない。**ユーザー指摘(2026-09-23、2 段階目)** | §5.2 |
| 19 | implementer 3 体の注意と reviewer 6 体の観点を `implementing` / `reviewing-diffs` の本文へ統合する | 観点と注意はそれぞれ強化・追加する予定があり、1 つの本文に統合するとノイズになる。ファイルを分ければ依頼文が渡すのはその委譲に要る 1 本だけで済む。**ユーザー指摘(2026-09-23、3 段階目)** | §5.5 |
| 20 | `e2e-verify` を `readonly` のままにし、codiel のテスト委譲を一般の実装帯へ向ける | E2E スクリプトの作成と実行はブラウザ / GUI 操作の知識を要し、E2E 検証の役割が担うのが自然である。一般の実装帯へ向けると、ブラウザ操作の手順を知らない委譲先にテストスクリプトの安定化を任せることになる。**ユーザー指摘(2026-09-23、5 段階目)** | §5.8 |
| 21 | `e2e-verify` の昇格に合わせて `.claude/agents/complex-reviewer.md` を再生成する | 同定義は `final-review` と `gate-review`(いずれも `readonly` のまま)も担っており、`impl` の既定 tools へ丸ごと寄せると読み取り専用であるべき 2 役割の保証が消える。対処は利用者が `e2e-verify` 単独の `impl` 定義を作ることである | §9 のリスク 9 |

---

## 11. Done 条件

- [ ] `plugins/codiel/agents/` に `codiel-analyst.md` / `codiel-test-designer.md` の **2 ファイル**だけが残る。
- [ ] `plugins/codiel/skills/implementing/references/` に `frontend.md` / `backend.md` / `data.md` の 3 ファイル、`plugins/codiel/skills/reviewing-diffs/references/` に `frontend.md` / `backend.md` / `data.md` / `doc.md` / `security.md` / `generic.md` の 6 ファイルがある。
- [ ] `plugins/codiel/skills/**/SKILL.md` と `plugins/codiel/commands/*.md` に、削除した 13 の Agent 名が 1 件も出現しない(検査語に `codiel-tester` を含める。`codiel-state` は CLI 名なので対象外)。
- [ ] `codiel-tester.md` の固有規律 4 項目(§6.1 の表)が `scripting-tests/SKILL.md` と `running-regression-tests/SKILL.md` にあり、`scripting-tests:78` のコミット責務の根拠が権限の断定から書き換わっている。
- [ ] `orchestrating-runs/SKILL.md` の依頼文テンプレートが、作業内容・委譲の種別・ビルトインへの縮退・読むスキルの絶対パス列挙・読み取り限定条項・git 操作禁止・転記欄を持つ。
- [ ] `plugins/codiel/skills/**` と `plugins/codiel/commands/**` に、解決機構の語(「対応表」「RoleId」「役割マーカー」)と担当表の役割名(「設計書・実装計画書(WBS)の作成」「通常の実装」「コードレビュー」「複雑または重要な実装」「エスカレーション」)が 1 件も出現しない。「サブエージェントに委譲する」「成果物を書く委譲」「読み取りだけの委譲」のような一般語は対象外とする。
- [ ] `plugins/codiel/hooks/hooks.json` に `SubagentStop` が無く、`plugins/codiel/scripts/subagent-stop.mjs` が存在せず、`pnpm run build` の出力に想定外の差分が出ない。
- [ ] `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る(metatron の V1〜V3、agent-policy の parallel-nudge テストを含む)。
- [ ] `plugins/agent-policy/references/` の 2 ファイルの合計が 30,720 B 以下である。
- [ ] `roles.ts` の `e2e-verify` の `kind` が `"impl"`、`tools` が impl 役割の既定 7 件であり、`orchestration-discipline.md:19` の担当表の種別列が `impl`、ja / en 両方の役割断片の frontmatter が `kind: impl` で一致している。
- [ ] codiel `0.9.0-dev` / agent-policy `0.19.7-dev` / metatron `0.3.8-dev` が `plugin.json` と `package.json` で揃って上がっている。
- [ ] ADR が 1 件増え、その「帰結」節に §6.10 の内容が書かれている。`plugins/codiel/README.md`・ルート `README.md`・`docs/DESIGN.md`・`docs/skill-flowcharts.md`・Serena メモリ 2 本が追随している。
- [ ] `wc -c plugins/codiel/skills/orchestrating-runs/SKILL.md` の実測が報告に記録されている(閾値判定はしない)。
- [ ] hooks.json の変更後、新しいセッションで PreToolUse と Stop が発火することを確認した記録がある。
- [ ] §7.7 に挙げたファイルの `git diff` が空である。
- [ ] 編集内容が §6 の W 単位に沿って git にコミットされている。

---

## 12. 未解決事項

**未解決事項は無い。** 判断が付いていない論点は 1 件も残っていない。実装はこの設計書と計画書だけで着手できる。

**解決済みとして §12 から外した論点。** それぞれ何がどう決まったかを 1 行で残す。

| 論点 | 決着 |
| --- | --- |
| 残る Agent の `model` 未宣言をどう扱うか | **宣言しない。**残る 2 体はオーケストレーターのモデルを継承する。init と test-spec は run に 1 回ずつで、モデルを分ける価値が小さい(決定 11、§5.11) |
| review の 6 観点を 1 dispatch にまとめる余地 | **不採用で確定。**観点ごとに 1 dispatch を出す現行の構造を保つ(§5.2、§10 の不採用案 3) |
| `prompt-smith:skill-creator` による発火測定を行わない判断の見直し時期 | **見直しの論点自体が消えた。**codiel のスキルはコマンドと依頼文からの名指しでしか起動せず、description が発火に影響しない。測る対象が無いので、いつ測るかという問いも立たない(§5.10) |
| 対応表の消費契約の固定方法 | **契約自体が消えた。**codiel が解決機構にも役割名にも言及しなくなり、行の形にも候補範囲にも依存しなくなったため、固定する対象が無い(決定 2、§5.2) |
| `orchestrating-runs/SKILL.md` が 30KB を超えたときの扱い | **上限を当てない。**`orchestration-discipline.md:181` の主語は委譲先にロードさせるスキルであり、オーケストレーター自身が読むスキルは対象外である。実測を記録するだけとする(§3.6) |
