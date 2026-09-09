# agent-policy 帯カタログの共通規律への集約と重複規律の一本化 実装計画書

- 作成日: 2026-09-09
- 対象プラグイン: `plugins/agent-policy`
- バージョン: `0.16.0-dev` → `0.17.0-dev`
- 設計書(正本): `harness-docs/design/2026-09-09-agent-policy-band-catalog-consolidation-design.md`(第 2 版)
- **設計書のユーザー承認: 2026-09-09(承認済み)**
- 着手時の HEAD: `644b78a`
- baseline: `pnpm run test` 成功(Test Files 157 passed | 1 skipped (158)、Tests 2163 passed | 2 skipped (2165)、Duration 74.90s)
- 版注: 第 1 版。

この計画書は設計書からタスク分割・順序・検証方法だけを立てるものであり、設計判断を上書きしない。設計書と実装が食い違う事実を見つけたときは、実装を止めてオーケストレーターへ報告する。報告を受けたオーケストレーターは §8「設計書との食い違い」へ追記し、設計書の修正要否を判断する。

## 1. 進め方の共通規律

- 各タスクはテストを先に書いてから実装する。本改修ではテストが 1 本(§2 のフェーズ 1・T1)に集約されるため、T1 を単独のフェーズとして先行させる。
- `plugins/agent-policy/scripts/` は手で編集しない。`src/` を変更し `pnpm run build` で再生成する。
- **本改修は `src/**/*.ts` の振る舞いを変えない。** 変更してよいのは `src/agents/policies.ts` の説明コメント 2 箇所(L122-123 / L148)と、テストディレクトリだけである(設計書 §4.5 / §7.13)。実行される行に差分を出したくなったときは、実装を止めてオーケストレーターへ報告する。
- ロードさせるスキル(設計書 §12-5):
  - AI が読む指示書の本文(`references/*.md`・`skills/*/SKILL.md` の**本文**・`assets/roles/ja/_common.md`)の改修は、`prompt-smith:prompt-smith` をロードした担当に行わせる。本体 8,959 B + 参照文書 `references/description-guide.md` 1,804 B = **10,763 B**(30KB 未満)であり、そのままロードさせてよい。
  - `skills/custom-policy/SKILL.md` の frontmatter `description` の改稿は、`prompt-smith:skill-creator` をロードした担当に行わせる。本体 12,163 B + 参照文書 1,804 B = **13,967 B**(30KB 未満)。
  - README 2 本・テストコード・`policies.ts` のコメント・バージョン・生成物には**スキルをロードさせない**。
- **`Skill` tool を持たない帯へスキル付きタスクを割り当てない(重要)。** `src/agents/roles.ts` L46 のとおり `ROLES` カタログ上の「軽量な実装」の `tools` は `Read, Grep, Glob, Write, Edit, Bash` であり `Skill` を含まない。「コードベース探索実働」(L76)も持たない。したがって `prompt-smith:*` をロードするタスク(T2 / T3 / T4 / T6 / T7 / T11)は、`Skill` を持つ帯へ割り当てる。**これは `ROLES` カタログ(= setup が生成する既定の tools)の話であり、実際に委譲される定義の tools はプロジェクトごとに異なりうる**(§4 の注記)。
- 指示書の改修タスク(T2 / T3 / T4 / T6 / T7)では、**`prompt-smith:prompt-smith` の評価工程(既存指示書の評価 → 承認 → 修正)を省略させる。** 適用する文言は設計書で確定済みであり、担当が評価から入り直す必要は無い。依頼文に「評価工程は省略し、設計書の『変更後』をそのまま適用する。文言を創作しない」と明記する。
- 委譲するタスクの依頼文には、対象ファイル・設計書の該当節・テストのパス・使用してよい tools・報告形式・§5 の共有契約を転記する。方針スキルはロードさせない。
- 指示書の改修タスクでは、**設計書の「変更前」「変更後」のコードブロックを依頼文へそのまま転記する**。担当が文言を創作しないようにする。
- 同一フェーズ内のタスクは 1 メッセージで並列に dispatch する。フェーズ間は直列とする。
- 設計判断・要件の追加・スコープ拡大は担当が決めず、オーケストレーターへ差し戻す。
- 本改修と無関係な未コミット変更(会話記録・`cliproxyapi.config.example.yaml` など)は触らない。revert もしない。

### 中間状態の許容範囲(必読)

赤が残ってよいのは**フェーズ 1 だけ**である。T1 が新テストを書いた時点では、規律にまだ表が無く、両 SKILL にはまだ表があるため、**ライブ文書を読む検査だけ**が落ちる。これは設計どおりの red であり、フェーズ 2 で解消する。

**合成入力の検査(9・10・正常系)はライブ文書を読まないため、正しく実装されていれば T1 の時点で緑になる。**「12 検査すべてが赤」ではない点に注意する。

| フェーズ | 検査 | T1 完了時の期待 | 解消するフェーズ |
| --- | --- | --- | --- |
| 1 | 検査 1-8(規律 `## 役割の帯` の表を読む) | **赤**(節が存在しないため) | 2(T2) |
| 1 | 検査 9(未知のモデル語で throw)・検査 10(未知の帯名で throw)・正常系(5 列の 1 行が通る) | **緑**(合成入力であり文書を読まない) | — |
| 1 | 検査 11(claude SKILL に表が無い) | **赤**(まだ表がある) | 2(T3) |
| 1 | 検査 12(custom SKILL に表が無い) | **赤**(まだ表がある) | 2(T4) |
| 1 | 上記以外のテスト | **緑**のまま。`policy-skill-assignments.test.ts` はこの時点でまだ存在し、通り続ける | — |

合成入力の検査が T1 の時点で赤になった場合は、パーサの実装に誤りがある(文書を読んでいる、または 5 列の解釈が違う)。実装を直してから T1 を完了とする。

`pnpm run lint` と `pnpm run typecheck` は**全フェーズで通る**。テストが赤でも型エラーは許容しない。フェーズ 2 以降は `pnpm run test` の全体 green を完了条件にできる。

## 2. タスク分割

### フェーズ 1: 後継テストの新設(直列 1)

| ID | 内容 | 対象 | 担当帯 | スキル |
| --- | --- | --- | --- | --- |
| T1 | `src/agents/__test__/discipline-role-table.test.ts` を新規作成する。設計書 §9.1 の検査 1-10(規律 §役割の帯 の表と `ROLES` / `allowsAgentTool` / `ASSIGNMENTS` の一致)と §9.2 の検査 11-12(両 SKILL に表が無いこと)を実装する。パーサは §5 に転記した「新パーサの仕様」8 項に従って**新規に書く**。既存 `policy-skill-assignments.test.ts` の `parseTable` は流用しない(第 2 セルが RoleId になり `MODEL_IDS` の未知語 throw に掛かるため)。合成入力の負のテスト 3 ケース(未知のモデル語 / 未知の帯名 / 正常系)も 5 列で書く。既存 `policy-skill-assignments.test.ts` は**削除しない**(T5 が行う) | `src/agents/__test__/discipline-role-table.test.ts`(新規) | 複雑または重要な実装 | 不要 |

- **`MODEL_IDS` は旧テストから import しない。** `policy-skill-assignments.test.ts` L39-49 の `MODEL_IDS` は `const` であり `export` されていない。加えて同ファイルは T5 で削除される。**新ファイルへ値をコピーする**(§5 に全 9 件を転記済み)。
- **検査 11-12 の見出し判定は行頭一致にする。** 両 SKILL の変更後本文には「担当表(…)はその文書の **§役割の帯** にある」という散文が入るため、文字列包含で判定すると恒久的に赤になる。正規表現の行頭アンカーを使い、`^## 役割の帯$` / `^## モデル別役割$` / `^## 役割の帯と推奨モデル$` の**見出し行**だけを検出する(`multiline` フラグ、または行ごとの `startsWith("## ")` 判定)。設計書 §9.2 の「「役割の帯」「モデル別役割」の見出しが無い」もこの解釈で読む。主たる判定は「`|` で始まる行が 1 行も無いこと」であり、見出しの不在はその補助である。
- T1 の検証:
  - `pnpm exec vitest run plugins/agent-policy/src/agents/__test__/discipline-role-table.test.ts` を実行し、§1 の中間状態表のとおり **検査 1-8 と 11-12 が赤、検査 9-10 と正常系が緑**であることを確認する。合成入力の検査まで赤になったらパーサの実装誤りであり、直してから完了とする。
  - `pnpm run typecheck` がエラー 0。
  - `pnpm run lint` が通る。
  - `pnpm exec vitest run plugins/agent-policy/src/agents/__test__/policy-skill-assignments.test.ts` が通り続けること(まだ削除していない)。
- T1 が使う期待値は §5 の共有契約であり、担当はそれ以外から値を推測しない。`SOLO_DENIED_ROLES` は `export` されていないため、Agent Tool 列のオラクルには `allowsAgentTool([role.id])` を使う(設計書 §9.1 の検査 7)。
- 完了条件: 新テストが存在し、赤・緑の内訳が §1 の中間状態表と一致し、typecheck と lint が通る。

### フェーズ 2: 規律・両 SKILL・旧テスト削除(並列 4)

4 タスクの対象ファイルは互いに重ならない。1 メッセージで並列に dispatch する。

| ID | 内容 | 対象 | 担当帯 | スキル |
| --- | --- | --- | --- | --- |
| T2 | 共通規律の改訂 5 件。(a) L5 の定義文を「この文書の §役割の帯 の表を指す」へ書き換え、その直後に `## 役割の帯` 節(16 行 5 列の表 + 列の説明 4 項)を新設(設計書 §7.1)。(b) L25 を「Agent Tool 列が「可」の帯にだけ許可する」へ置換し、直後に統一規律 2 件(委譲時の帯明示と Output Format 指定 / 読み取り帯を `Write`・`Edit` を持つ定義へ委譲するときの明記事項)を挿入(§7.2)。(c) L39 の読み替え先を担当表の「Claude モデル」列へ(§7.3)。(d) L55 の 15 帯列挙を表参照へ(§7.4)。(e) L81 を削除(§7.5)。(f) L109 を書き換え(§7.6) | `references/orchestration-discipline.md` | 通常の実装 | **`prompt-smith:prompt-smith`** |
| T3 | `claude-model-policy/SKILL.md` を設計書 §7.7 の変更後全文にする。削除するのは L12-31(表と見出し)・L33・L34・L35-37・L39-46。冒頭に担当表の所在を示す 1 文を足し、「実行帯の解決順」の本文を「Claude モデル」列と「種別」列を使う形へ差し替える。**frontmatter は変更しない** | `skills/claude-model-policy/SKILL.md` | 通常の実装 | **`prompt-smith:prompt-smith`** |
| T4 | `custom-policy/SKILL.md` の**本文**(frontmatter の閉じ `---` より後)を設計書 §7.8 の変更後の内容にする。削除するのは L12-33(表と見出し)・L14 第 3 文・L36・L55・L59-61・L63-72。書き換えるのは L45(手順 2 の読み替え先)・L47(例外に「他の帯で代行しない」を追加)・L76。L57 は**残す**(§6.6)。**frontmatter は 1 文字も変更しない**(`description` の改稿は T11 が行う) | `skills/custom-policy/SKILL.md`(本文のみ) | 通常の実装 | **`prompt-smith:prompt-smith`** |
| T5 | `src/agents/__test__/policy-skill-assignments.test.ts` を削除する。検査対象(両 SKILL の表)が消えるため後継テスト T1 へ置き換わる(設計書 §8「削除」) | `src/agents/__test__/policy-skill-assignments.test.ts`(削除) | 軽量な実装 | 不要 |

- T2 の検証: `pnpm exec vitest run plugins/agent-policy/src/agents/__test__/discipline-role-table.test.ts` の**検査 1-8 が通る**こと(検査 9-10 と正常系は T1 の時点で既に緑)。表の 16 行が §5 の共有契約と一字一句一致すること。帯名は `ROLES[].label` そのものであり、旧 SKILL の表にあった括弧書き(「(最新動向・外部エコシステム)」等)を書かないこと。
- T3 の検証: 同テストの**検査 11 が通る**こと(claude SKILL に `|` で始まる行が 1 行も無い)。検査 12 は T4 の担当分であり、T3 の完了条件に含めない。
- T4 の検証: 同テストの**検査 12 が通る**こと(custom SKILL に `|` で始まる行が 1 行も無い)。検査 11 は T3 の担当分であり、T4 の完了条件に含めない。あわせて `git diff` で frontmatter に差分が無いことを確認する。
- T5 の検証: ファイルが存在しないこと。`git status` に削除として現れること。
- **フェーズ 2 の実行手順**:
  1. 4 タスクを 1 メッセージで並列に dispatch する。
  2. 4 件の完了報告を待つ。**各担当は自分の検査(T2 → 1-8、T3 → 11、T4 → 12、T5 → ファイルの不在)だけを実行・報告する。** 他タスクの未完了によって落ちている検査を自分の失敗として扱わない。
  3. 4 件すべての報告が揃ったら、オーケストレーターが `pnpm run test` を 1 回実行して全体 green を判定する。
- **フェーズ 2 の完了条件**: `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の全体が通る。新テストの 12 検査がすべて green で、`policy-skill-assignments.test.ts` が存在しない。baseline からのテスト数の増減が、T1 で追加した検査と T5 で削除した検査の差分だけであること。

### フェーズ 3: 付随文書の追随(並列 3)

3 タスクの対象ファイルは互いに重ならない。**フェーズ 2 とも対象が重ならないため、オーケストレーターの判断でフェーズ 2 と統合し 7 並列で dispatch してもよい。** ここで分けているのは、フェーズ 2 の完了条件(テスト全 green)を単純に保つためである。

| ID | 内容 | 対象 | 担当帯 | スキル |
| --- | --- | --- | --- | --- |
| T6 | `context-map-guide.md` L12 の用語表から「・最終レビュー」を削除し、共通規律 L9 のオーケストレーター定義(dispatch・要件確定・採否判断・承認・分析)へ揃える(設計書 §7.10)。同じ行の後半「担当表のどの帯も自ら担わない」は**変更しない**。L37 / L40 / L81 も変更しない | `references/context-map-guide.md` | 通常の実装 | **`prompt-smith:prompt-smith`** |
| T7 | `assets/roles/ja/_common.md` L14 の「担当表の」を「対応表の」へ直す(設計書 §7.11)。同行の他の部分と他の行は変更しない。`assets/roles/en/_common.md` は**変更しない**(該当語を持たない) | `assets/roles/ja/_common.md` | 通常の実装 | **`prompt-smith:prompt-smith`** |
| T8 | `src/agents/policies.ts` の説明コメント 2 箇所を設計書 §7.13 の変更後の文言に差し替える(L122-123 の 2 行ブロックと L148 の 1 行)。**実行される行は 1 行も変更しない**。`ASSIGNMENTS` / `RECOMMENDED` / `SOLO_DENIED_ROLES` / `allowsAgentTool` の値と実装に触れない | `src/agents/policies.ts`(コメントのみ) | 軽量な実装 | 不要 |

- T6 / T7 の検証: 変更が設計書の「変更後」と一字一句一致すること。文書検証テストは無いため、T16 の一括突き合わせで確認する。
- T8 の検証: `git diff plugins/agent-policy/src/agents/policies.ts` の差分がコメント行だけであること。`pnpm run typecheck` と `pnpm run test` が通ること。
- T7 の副次確認: 断片の整合性検査(`compose.test.ts`)は `_common.md` の本文を検査しないため落ちない。落ちた場合は報告する。
- **フェーズ 3 の完了条件**: `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の全体が通る。

### フェーズ 4: README と description(並列 3)

3 タスクの対象ファイルは互いに重ならない。README 2 本は独立であり、`custom-policy/SKILL.md` はフェーズ 2 の T4 が既に本文を確定させている。

| ID | 内容 | 対象 | 担当帯 | スキル |
| --- | --- | --- | --- | --- |
| T9 | `plugins/agent-policy/README.md` の 2 件。(a) L45 の `claude` プロファイル行を設計書 §7.14 の変更後の文言へ。(b) §旧バージョンからの移行 の L206 直後へ「0.16 系から 0.17 系へ移行する場合」の節(4 項目)を新設する。文面は設計書 §7.14 のコードブロックをそのまま使う。L109-128 の役割 ID 表と L130-142 の推奨モデル ID 表は**変更しない** | `plugins/agent-policy/README.md` | 軽量な実装 | 不要 |
| T10 | ルート `README.md` L112 を設計書 §7.15 の変更後の文言へ差し替える。「16 の役割帯」「9 つの推奨モデル ID」の数は変えない。L59 は**変更しない**。`.claude-plugin/marketplace.json` も変更しない | `README.md` | 軽量な実装 | 不要 |
| T11 | `skills/custom-policy/SKILL.md` の frontmatter `description` を設計書 §7.8 の変更後の文言へ差し替える(冒頭の「役割の帯(role-id)だけを担当表に持ち、」を削り、「委譲先をプロジェクトの Agent 定義に付いた役割マーカー(role-id)で解決する構成での」に一本化)。**本文は T4 が確定済みであり変更しない**。発火測定の要否は担当が `skill-creator` の手順に従って判断し、実施したときは結果を報告する | `skills/custom-policy/SKILL.md`(frontmatter のみ) | 通常の実装 | **`prompt-smith:skill-creator`** |

- T9 / T10 は README であり `prompt-smith` の対象外である(設計書 §12-5)。
- T11 の検証: `description` に旧文言「担当表に持ち」が残っていないこと。SessionStart の注入経路は `description` を読まないため機能影響は無いが、`pnpm run test` が通ることを確認する。
- **フェーズ 4 の完了条件**: `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の全体が通る。

### フェーズ 5: バージョンと build(直列 1)

| ID | 内容 | 対象 | 担当帯 | スキル |
| --- | --- | --- | --- | --- |
| T12 | `plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` の `version` を `0.17.0-dev` へ揃える(設計書 §7.16)。その後 `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分を確認する。**差分 0 が期待値である。**差分が出たら内容を報告する(`scripts/` は手で編集しない) | `.claude-plugin/plugin.json` / `package.json` / `scripts/`(生成物) | 軽量な実装 | 不要 |

- T12 の検証: 2 ファイルの `version` がともに `0.17.0-dev`。`git diff --stat plugins/agent-policy/scripts` が**空**であること。
- **`scripts/` の差分が 0 になる根拠(実測)**: `plugins/agent-policy/build.ts` は esbuild を `legalComments` の指定なしで呼ぶため、通常コメントはバンドル出力へ残らない。現行の `plugins/agent-policy/scripts/setup-agents.mjs` にも T8 が触る 2 箇所のコメント文字列は 1 件も含まれていない(`grep -c` で 0 件)。したがって T8 のコメントのみの変更では `scripts/` に差分が出ない。**差分が出た場合は前提が崩れているため、内容を報告してからコミットへ含めるか判断する。**
- **フェーズ 5 の完了条件**: バージョンが揃い、`pnpm run build` 後に `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。

### フェーズ 6: 統合検証(T13・T14・T15 は並列 3、その後 T16 → T17 は直列)

| ID | 内容 | 担当帯 | スキル |
| --- | --- | --- | --- |
| T13 | **統合検証(機械コマンドの実行と記録に限る)。** 次を順に実行し、出力を記録する。散文の突き合わせは行わない(T16 の担当)。(1) `pnpm run build`。(2) `pnpm run lint`。(3) `pnpm run typecheck`。(4) `pnpm run test` — baseline(Test Files 157 passed \| 1 skipped、Tests 2163 passed \| 2 skipped)からの増減が T1 の追加分と T5 の削除分だけであることを確認する。(5) `git diff --stat plugins/agent-policy/scripts` — 空であることを確認する(T12 の根拠)。(6) `git diff plugins/agent-policy/src` と `git status --short plugins/agent-policy/src` の**両方**を見る。`git diff` は追跡済みファイルの変更(= `policies.ts` のコメント 2 箇所と `policy-skill-assignments.test.ts` の削除)だけを示し、**新規テストファイルは untracked のため `git diff` に出ない**。`git status --short` で `?? .../discipline-role-table.test.ts` を確認し、その中身を全文読む。結論として「振る舞い変更 0 行・`policies.ts` のコメント 2 箇所・テストファイルの追加 1 / 削除 1」であることを確認する。(7) `wc -c plugins/agent-policy/references/orchestration-discipline.md plugins/agent-policy/references/context-map-guide.md plugins/agent-policy/references/subagent-discipline.md plugins/agent-policy/skills/claude-model-policy/SKILL.md plugins/agent-policy/skills/custom-policy/SKILL.md` を実行し、実測値を §8 へ記録する | オーケストレーター | 不要 |
| T14 | 変更差分のコードレビュー。新テストのパーサが設計書 §9.1(本計画書 §5 に転記)の 8 項の仕様どおりか、検査 1-12 に抜けが無いか、検査 11-12 の見出し判定が行頭アンカーになっているか、`MODEL_IDS` が旧テストから import されずコピーされているか、`policies.ts` の差分がコメントだけか、削除したテストの検査項目が後継へ移っているかを見る | コードレビュー | 不要 |
| T15 | ARCHITECTURE への影響確認。設計書 §8 のとおり本改修は ARCHITECTURE 本文に影響しない見込みである。(a) `harness-docs/ARCHITECTURE.md` が `agent-policy` を名指しするのが ADR-001 だけであること、(b) 新規ファイル(`src/agents/__test__/discipline-role-table.test.ts`、本計画書)がドメインマップの glob に入ることを確認する。取りこぼし・食い違いが 1 つでもあれば**修正せず報告する**(追随は `/metatron:update` で行う) | コードベース探索実働 | 不要 |
| T16 | **オーケストレーターによる最終突き合わせ。** 全差分(`git diff` と新規・削除ファイル)を分割せず一度に読み、次を突き合わせる。(1) 設計書 §7.1-7.16 の「変更前」「変更後」と実際の差分が一致すること。(2) 帯名 16 種が `roles.ts` の `label` と規律 §役割の帯 の表で完全に同一であること。(3) 一本化した 3 種の規律(Agent Tool 可否 / 読み取り帯の委譲文言 / 独立レビュー手順)と、§11.1 の決定 2(委譲時の帯明示)が、規律の 1 箇所にだけあり両 SKILL に重複していないこと。(4) `references/subagent-discipline.md` と `assets/roles/en/_common.md` が無変更であること。(5) 下の「T16 の Done 条件チェックリスト」を上から順に確認すること。要約の要約では判断しない | オーケストレーター | 不要 |
| T17 | `.serena/memories/agent_policy/core.md` の更新(設計書 §8)。(1) L1 のバージョンを `0.17.0-dev` へ。(2) L179「## The two policy skills — role tables」節を、表は共通規律 §役割の帯 の 1 箇所であり `RECOMMENDED` は setup-agents 専用になった実体へ改める(節名も追随)。(3) L206「Custom's execution-tier resolution」の読み替え先を共通規律の「Claude モデル」列へ。(4) 設計書の一覧へ本設計書を追加。**このタスクはオーケストレーター自身が行う。** `.serena/memories/` は保護パスであり、更新は Serena の `write_memory` / `edit_memory` で行う必要があるが、サブエージェントはこれらの tool を持たないため委譲できない | オーケストレーター | 不要 |

- T14 / T15 の依頼文には「ファイルを変更しない」「報告のみを返す」を明記する(設計書 §7.2 の統一規律)。T15 の「コードベース探索実働」は `readonly` の帯である。
- T16 で食い違いが見つかった場合は §8 へ記録し、該当フェーズのタスクをやり直す。
- **T16 と T17 の順序。** T16 の時点では Serena メモリがまだ未更新である。したがって **T16 のチェックリストにメモリ項を含めない**。設計書 §12-6 のメモリ項は T17 で満たし、T17 の完了をもって Done 条件の全項目が揃う。この順序を入れ替えない(メモリ更新はバージョン確定後でなければ書けないため)。

#### T16 の Done 条件チェックリスト

設計書 §12-6 の各項を、どのタスクが満たすかで割り振ったものである。T16 は「他タスクが満たした」項目を実際の差分で追認する。

| 設計書 §12-6 の項 | 満たすタスク | T16 での確認方法 |
| --- | --- | --- |
| `lint` / `typecheck` / `test` が通る | T13 | T13 の記録を確認 |
| 新テストが検査 1-12 を通し、旧テストが削除されている | T13 | T13 の記録と `git status` を確認 |
| `src` の差分が振る舞い変更 0 行 + コメント 2 箇所 | T13 | T13 の記録と、T16 が読む全差分で追認 |
| `pnpm run build` と `scripts/` 差分 | T12 / T13 | `git diff --stat plugins/agent-policy/scripts` が空 |
| `plugin.json` と `package.json` が `0.17.0-dev` | T12 | 2 ファイルを直接読む |
| `wc -c` で `references/` 3 本の合計が 30,720 B 未満 | T13 | T13 の記録と §8 の記入を確認 |
| プラグイン README に移行節があり L45 が追随、ルート README L112 が追随 | T9 / T10 | **T16 が 3 箇所を直接読む** |
| `subagent-discipline.md` と `en/_common.md` が無変更 | — | **T16 が `git status` で不在を確認** |
| ARCHITECTURE への影響が無いことの確認記録 | T15 | T15 の報告を確認 |
| Serena メモリの 3 点が更新されている | **T17** | **T16 の対象外。T17 の完了で満たす** |

- T13 の (7) の実測値の判定基準:
  - 設計書 §5 の見込み値は 規律 14,149 B / claude SKILL 1,655 B / custom SKILL 3,942 B / `references/` 3 本合計 21,243 B である。
  - 3 本合計が **21,243 B ± 1,000 B** に収まれば正常とする(§11.1 の決定 2・決定 4 の反映で数十 B 動く想定)。
  - ±1,000 B を超えたら実装の取り違えを疑い、**報告する**(内容を確認してから続行の可否を判断する)。
  - **30,720 B を超えたら失敗**とし、設計書 §9.4 の制約違反として実装を止める。
- **設計書 §5 のサイズ表は更新しない。** 設計書はユーザー承認済み(2026-09-09)であり、実装で編集しない。T13 (7) の実測値は本計画書 §8 の「実測値の記録」へ書く。

## 3. 依存関係

```
T1 ─┬─ T2 ─┐
    ├─ T3 ─┤          T6 ─┐        T9 ──┐
    ├─ T4 ─┼─(F2完了)─┼─ T7 ─┼─(F3完了)─┼─ T10 ─┼─(F4完了)─ T12 ─┬─ T13 ─┐
    └─ T5 ─┘          T8 ─┘        T11 ─┘                        ├─ T14 ─┼─ T16 ─ T17
                                                                  └─ T15 ─┘
```

- T1(テスト)は全実装タスクに先行する。T1 が red を確認するまでフェーズ 2 へ進まない。
- フェーズ 2 の 4 タスクは対象ファイルが重ならず、順序も問わない。ただし新テストの検査 1-10 は T2、検査 11-12 は T3 と T4 の両方が揃って初めて green になる。
- T5(旧テスト削除)は T3 / T4 と並列でよい。旧テストは両 SKILL の表を読むため、T3 / T4 が先に完了すると旧テストが「節が見つからない」で落ちる。**同一フェーズ内で両方を適用してからフェーズ完了を判定する**ことで、赤の窓を作らない。
- フェーズ 3 の 3 タスクはフェーズ 2 と対象が重ならないため、統合して 7 並列にしてもよい(§2 のフェーズ 3 の注記)。
- T11 は T4 と同じファイルを触るため、必ず T4 の完了後に行う(フェーズ 4)。T4 は本文だけ、T11 は frontmatter だけを扱う。
- T12 の `pnpm run build` は T8 の `src/` 変更を前提にする。文書だけを変える T2-T4 / T6 / T7 / T9-T11 は build に影響しない。
- **T17 は T16 の後に置く。**T17 は T12 の確定値(バージョン `0.17.0-dev`)を前提にするため T12 より後でなければならず、一方で T16 の時点ではメモリがまだ未更新である。そのため T16 のチェックリストからメモリ項を外し(§2 のフェーズ 6)、T17 の完了をもって Done 条件が全項揃う構成にしている。この順序を入れ替えない。

## 4. 委譲先

セッションに注入された役割マーカー対応表の帯で解決する。対応表に無い帯は共通規律 §役割の帯 の「Claude モデル」列へ読み替える(本改修後の規定。改修中は現行の `claude-model-policy` の担当表でよい)。

| 担当帯 | 割り当てるタスク |
| --- | --- |
| 複雑または重要な実装 | T1 |
| 通常の実装 | T2 / T3 / T4 / T6 / T7 / T11 |
| 軽量な実装 | T5 / T8 / T9 / T10 / T12 |
| コードベース探索実働 | T15 |
| コードレビュー | T14 |
| オーケストレーター | T13 / T16 / T17 |

- **スキルをロードするタスク(T2 / T3 / T4 / T6 / T7 / T11)を「軽量な実装」へ割り当てない。** `ROLES` カタログ上の同帯の `tools` に `Skill` が無いためである(§1)。
- **`ROLES` の tools と、実際に委譲される定義の tools は別物である(注記)。** 上の制約は setup が生成する既定の tools を根拠にしたものであり、プロジェクトの生成済み定義がそれと一致する保証は無い。本リポジトリの現状では「軽量な実装」と「通常の実装」が同一の定義(`gpt-luna`)へ解決され、その定義は `Skill` と `Agent` の両方を持つ。したがって:
  - 「軽量な実装」へ dispatch するタスク(T5 / T8 / T9 / T10 / T12)の依頼文には、**Agent tool を使わないことを明示的に書く**。定義側に `Agent` があっても帯の規定が優先する(共通規律 §7.2 の Agent Tool 列)。
  - 逆に、`Skill` を持たない定義へ解決される環境では T2 等が実行できない。dispatch 前に委譲先定義の `tools` を確認し、`Skill` が無ければ `Skill` を持つ帯へ振り替える。
- 「軽量な実装」「コードレビュー」の帯には Agent tool を許可しない。依頼文に「この tools のみ使用」「Agent tool は使わない」と、迷いは相談ではなく差し戻しで解決することを明記する。
- T1 を「複雑または重要な実装」にする理由: 新パーサを仕様から書き起こす作業であり、列インデックスでの取り出し・ヘッダと区切り行のスキップ・3 種の throw 条件・12 検査の構成を同時に満たす必要があるため。既存パーサの改造ではない。

## 5. タスク間で共有する契約

並列実装者が推測で決めないよう、次を依頼文へ転記する。**T1(テストの期待値)と T2(規律の表)は、この表を唯一の出典とする。**

規律 `references/orchestration-discipline.md` の `## 役割の帯` に置く表(設計書 §7.1):

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

- 行の並びは `ROLES` の定義順であり、上表のとおりである。並べ替えない。
- 帯名は `src/agents/roles.ts` の `ROLES[].label` と**一字一句一致**させる。括弧書きの補足を足さない。
- 種別は `ROLES[].kind`、Agent Tool は `allowsAgentTool([id])`(`可` = `true` / `否` = `false`)、Claude モデルは `ASSIGNMENTS["claude-model-policy"][id]` を `MODEL_IDS` の表示名へ写したものである。
- 表の直下に置く列の説明 4 項の文面は、設計書 §7.1 の変更後全文をそのまま使う。

テストのオラクル(T1):

```ts
// 帯名 = ROLES[i].label(完全一致)
// RoleId = ROLES[i].id
// 種別 = ROLES[i].kind
// Agent Tool = allowsAgentTool([ROLES[i].id]) ? "可" : "否"
//   ※ SOLO_DENIED_ROLES は export されていないため、必ず allowsAgentTool を使う
// Claude モデル = ASSIGNMENTS["claude-model-policy"][ROLES[i].id]
// 行数 = ROLES.length、行の並び = ROLES の定義順
```

新パーサの仕様(設計書 §9.1。T1 の依頼文へ**全 8 項をそのまま転記する**):

1. `## 役割の帯` 見出しから次の `## ` 見出しの直前までを節として切り出す(旧 `parseSkillAssignments` L98-105 と同じ方式)。節が無ければ throw する。
2. 節内の `|` で始まる行を集める。**先頭のヘッダ行**(`| 帯名 | RoleId | …`)と**区切り行**(セルが `---` だけで構成される行)を明示的にスキップする。行内容による推測ではなく、位置とパターンの両方で判定する。
3. 残った各行を `split("|").slice(1, -1)` で分割し、**5 セルであることを検査**する(セル数が違えば throw)。
4. セルは**列インデックス**で取り出す(0 = 帯名、1 = RoleId、2 = 種別、3 = Agent Tool、4 = Claude モデル)。第 2 セル欠落による行スキップは行わない。
5. 帯名(0 列)は `role.label` と**完全一致**で照合する。前方一致・複数マッチ判定は使わない。
6. 未知の帯名は throw する。ヘッダ行と区切り行を先に除外しているため、「照合できない行は無視する」という逃げ道を持たせない。
7. RoleId(1 列)・種別(2 列)はバッククォート語を 1 つ取り出す。Agent Tool(3 列)は文字列「可」「否」で判定し、それ以外の値は throw する。
8. Claude モデル(4 列)はバッククォート語をすべて取り出し、`MODEL_IDS` で解決する。未知語は throw する。

`MODEL_IDS`(T1 が新ファイルへ**コピー**する。旧テストは非 export かつ T5 で削除されるため import しない):

```ts
const MODEL_IDS = {
  Opus: "opus",
  Sonnet: "sonnet",
  Haiku: "haiku",
  Fable: "fable",
  "GPT Sol": "gpt-sol",
  "GPT Terra": "gpt-terra",
  "GPT Luna": "gpt-luna",
  "GPT Astra": "gpt-astra",
  Grok: "grok"
} as const satisfies Record<string, ModelId>
```

検査 11-12(SKILL に表が無いこと)の判定(T1):

```ts
// 主判定: 本文に /^\|/m にマッチする行が 1 行も無いこと
// 補助判定: /^## 役割の帯$/m /^## モデル別役割$/m /^## 役割の帯と推奨モデル$/m の
//           いずれにもマッチしないこと(見出し行のみ。本文中の「§役割の帯 にある」に
//           反応しないよう、必ず行頭アンカーを使う)
```

負のテストの合成入力(T1。5 列で書く):

```
| コードレビュー | `code-review` | `readonly` | 否 | `Claude 5` |   → /未知のモデル「Claude 5」/ で throw
| 未知の帯     | `code-review` | `readonly` | 否 | `Sonnet`   |   → 帯名が解決できない旨で throw
| コードレビュー | `code-review` | `readonly` | 否 | `Sonnet`   |   → 通る
```

## 6. リスクと対処

| リスク | 対処 |
| --- | --- |
| T1 の担当が既存 `parseTable` を流用し、第 2 セルの RoleId を `MODEL_IDS` に通して全行 throw させる | 設計書 §9.1 に「流用不可」と明記済み。T1 の依頼文には §5 の新パーサ仕様 8 項を全文転記する。`MODEL_IDS` は旧テストが非 export かつ T5 で削除されるため、値を新ファイルへコピーする |
| 検査 11-12 の見出し判定を文字列包含で書き、両 SKILL 本文の「§役割の帯 にある」に反応して恒久的に赤になる | T1 の依頼文に「行頭アンカー(`/^## 役割の帯$/m` 等)を使う」と明記する(§5)。主判定は `/^\|/m` の不在であり、見出しは補助である |
| T1 の完了判定を「12 検査すべて赤」と誤解し、緑になった合成入力の検査を失敗とみなして実装を歪める | §1 の中間状態表で検査ごとの期待(1-8 と 11-12 が赤、9-10 と正常系が緑)を明示した。T1 の依頼文へ同表を転記する |
| フェーズ 2 の並列担当が、他タスク未完了で落ちている検査を自分の失敗として扱い、担当外のファイルを直す | §2 のフェーズ 2 の実行手順で、各担当が実行・報告する検査を 1 つに限定した(T2 → 1-8、T3 → 11、T4 → 12、T5 → 不在確認)。全体 green の判定はオーケストレーターが 1 回で行う |
| T3 / T4 が先に完了し T5 が遅れると、`policy-skill-assignments.test.ts` が「節が見つからない」で落ちる | T5 を同じフェーズ 2 に置き、4 タスクをすべて適用してからフェーズ完了を判定する(§3) |
| スキルを必要とするタスクを「軽量な実装」へ割り当て、`Skill` tool が無くてロードできない | §1 と §4 に帯の制約を明記した。dispatch 前に担当帯の `tools` を確認する |
| T4 と T11 が同じ `custom-policy/SKILL.md` を触り、並列 dispatch で衝突する | フェーズを分けた(T4 = フェーズ 2 本文、T11 = フェーズ 4 frontmatter)。各依頼文に「本文だけ」「frontmatter だけ」と明記する |
| 設計書 §7.8 の変更後コードブロックが frontmatter を含むため、T4 の担当が「全文を転記」と受け取って `description` まで書き換える | T4 の依頼文へ転記するのは **frontmatter の閉じ `---` より後だけ**とし、「frontmatter は 1 文字も変更しない」と明記する。T4 の検証に「`git diff` で frontmatter に差分が無いこと」を含める |
| 指示書の担当が設計書の文言を創作する | 設計書の「変更前」「変更後」のコードブロックを依頼文へそのまま転記する。担当は差分のみを適用する |
| `prompt-smith:prompt-smith` の評価工程(評価 → 承認 → 修正)に入り、設計書の確定文言と別の案を出す | T2 / T3 / T4 / T6 / T7 の依頼文に「評価工程は省略し、設計書の『変更後』をそのまま適用する。文言を創作しない」と明記する(§1) |
| T8 が `policies.ts` の実行される行に触れてしまう | 依頼文に「コメント 2 箇所のみ。`ASSIGNMENTS` / `RECOMMENDED` / `SOLO_DENIED_ROLES` / `allowsAgentTool` の値と実装に触れない」と明記する。T13 の (6) で `git diff` を全文読んで確認する |
| `scripts/` を手で編集してしまう | T12 だけが `pnpm run build` を実行する。他タスクの依頼文に「`scripts/` を触らない」と書く |
| `.serena/memories/` を Edit / Write で触ってしまう | T17 はオーケストレーター自身が Serena の `write_memory` / `edit_memory` で行う。サブエージェントへ委譲しない |
| 規律の改訂が広く、`orchestration-discipline.md` を読む全セッションの挙動が変わる | 変更は表の集約と重複の削除であり、規律が持つ判断内容は増減していない。T16 の一括突き合わせで、削除した規律が規律側の 1 箇所に確かに残っていることを確認する |
| 帯名を `label` 完全一致へ揃えた結果、規律本文の他の箇所(L94 / L107-109 など)の帯名と表記が食い違う | それらは既に `label` と同じ文字列である(設計書 §7.1)。T16 の (2) で 16 種の帯名の同一性を確認する |
| 表の再混入が将来の改修で起きる | T1 の検査 11-12(両 SKILL に表が無いこと)が恒久的な防波堤になる。テストを外すときは二重管理を戻す判断とセットになる |

## 7. Done 条件

設計書 §12-6 に、本計画書で追加した項目を足したものである。**最後の 1 項(Serena メモリ)は T17 で満たすため、Done 条件が全項揃うのは T17 の完了時点である。**

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る(T13)。
- `src/agents/__test__/discipline-role-table.test.ts` が検査 1-12 をすべて通し、`policy-skill-assignments.test.ts` が削除されている(T13)。
- `git diff plugins/agent-policy/src` と `git status --short plugins/agent-policy/src` を合わせて、**振る舞い変更 0 行・`policies.ts` のコメント 2 箇所・テストファイルの追加 1 と削除 1** だけである(T13)。
- `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分が**空**である。差分が出た場合は内容を報告したうえで同じコミットに含めている(T12 / T13)。
- `plugins/agent-policy/.claude-plugin/plugin.json` と `package.json` が揃って `0.17.0-dev` である(T12。T16 が追認)。
- `wc -c` で `references/` 3 本の合計が 30,720 B 未満であり、実測値が §8 の表に記録されている(T13)。
- `plugins/agent-policy/README.md` に「0.16 系から 0.17 系へ移行する場合」の節があり、L45 が追随している。ルート `README.md` L112 が追随している(T9 / T10。T16 が 3 箇所を直接読んで追認)。
- `references/subagent-discipline.md` と `assets/roles/en/_common.md` が無変更である(T16)。
- ARCHITECTURE への影響が無いことを確認した記録が残っている。影響があれば `/metatron:update` で追随している(T15)。
- オーケストレーターが全差分を一度に読んで設計書と突き合わせ、食い違いが無いことを確認している(T16)。
- `.serena/memories/agent_policy/core.md` の 3 点が更新されている(**T17。T16 の対象外**)。

## 8. 設計書との食い違い

現時点で検出した食い違いは無い。実装中に見つけた食い違いは、実装を止めてオーケストレーターへ報告し、この節へ次の形式で追記する。

| # | 検出タスク | 設計書の記述 | 実際 | 判断 |
| --- | --- | --- | --- | --- |
| — | — | — | — | — |

計画立案時に実測で追認した設計書の記述(食い違いなし):

| 設計書 | 記述 | 実測 |
| --- | --- | --- |
| 冒頭 / §7.16 | 現行バージョン `0.16.0-dev` | `plugin.json` / `package.json` とも `0.16.0-dev` |
| §4.1 | `SOLO_DENIED_ROLES` は `export` されていない | `policies.ts` L174 は `const`。テストは `allowsAgentTool` を使う必要がある |
| §4.1 | `RECOMMENDED` を読むのは `setup-agents.ts` の 6 箇所 | L179 / L190 / L208 / L708 / L800 / L820 で確認 |
| §4.3 | 規律 12,510 B / guide 6,184 B / subagent-discipline 910 B / custom SKILL 7,294 B / claude SKILL 4,632 B | `wc -c` で一致 |
| §4.4 | SKILL.md を読むテストは `policy-skill-assignments.test.ts` の 1 本だけ | `grep -rln "SKILL.md" plugins/agent-policy/src` の結果が同ファイルのみ |
| §4.4 | 規律を読むテストは存在しない | `grep -rn "orchestration-discipline" plugins/agent-policy/src` が 0 件 |
| §10 | 翻訳断片の `source-hash` は英語断片由来であり、ja の変更で stale にならない | `fragments.ts` L209-212 の `bundledDir` が非 ja/en に対して `en` を返し、L288 / L299 が英語本文をハッシュすることを確認 |
| §12-5 | `prompt-smith:prompt-smith` / `skill-creator` は 30KB 未満 | 10,763 B / 13,967 B(本体 + `references/description-guide.md`) |
| §7.13 / §10 | `policies.ts` のコメント変更が `scripts/` に差分を出すか | 出ない。`build.ts` は esbuild を `legalComments` 指定なしで呼び、現行 `scripts/setup-agents.mjs` に当該コメント文字列は 0 件 |

### 実測値の記録(T13 の (7) で記入する)

**設計書 §5 のサイズ表は更新しない**(承認済みのため)。実測値はここへ記録する。

| 対象 | 設計書 §5 の見込み | 実測(T13 で記入) |
| --- | --- | --- |
| `references/orchestration-discipline.md` | 14,149 B | |
| `references/context-map-guide.md` | 6,163 B(6,184 − 21) | |
| `references/subagent-discipline.md` | 910 B(無変更) | |
| **`references/` 3 本合計** | **21,243 B**(判定: ±1,000 B 以内で正常 / 30,720 B 超で失敗) | |
| `skills/claude-model-policy/SKILL.md` | 1,655 B | |
| `skills/custom-policy/SKILL.md` | 3,942 B | |

計画立案時に補正した点(設計判断に影響なし):

| # | 箇所 | 内容 |
| --- | --- | --- |
| 1 | 委譲先の帯 | 「軽量な実装」と「コードベース探索実働」の `tools` に `Skill` が無い(`roles.ts` L46 / L76)。スキルをロードするタスクはこれらの帯へ割り当てられないため、§4 の割り当てで「通常の実装」へ寄せた |

## 9. 未解決事項

1. 推奨モデル列の廃止による運用上の実効(未割当帯の読み替えと同帯複数定義の選択が安定するか)は未計測である(設計書 §11.2-1)。運用後に観測して判断する。本改修のスコープ外とする。
2. 本改修のコミット分割(1 コミットか、テスト / 規律・SKILL / 付随文書・README の 3 コミットか)は決めていない。フェーズ 6 の完了時にオーケストレーターが決める。
3. T11 の `description` 改稿にあたり発火測定(`skill-creator` の手順)を行うかは担当の判断に委ねる。実施した場合は結果を報告し、`description` の再改稿が必要と判断されたときはオーケストレーターへ差し戻す。
