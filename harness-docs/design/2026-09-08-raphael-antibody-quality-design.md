# raphael 抗体の質の改善(検知・trigger 精度・効果フィードバック)設計書

- 作成日: 2026-09-08
- 対象プラグイン: `plugins/raphael`
- 現行バージョン: `0.1.1-dev` → `0.2.0-dev`
- 状態: 設計(実装前・第 3 版。レビューで確定した事実 F1〜F7 と裁定 R1〜R12 を反映。第 3 版は実測 F7 に基づく裁定 R12 のみの小規模改訂)
- 入力 context-map: `.claude/context-maps/2026-09-08-raphael-antibody-quality.md`
- 関連文書: `plugins/raphael/DESIGN.md`(§4 抗体データモデル / §5 Infection record と state / §6 感知契約 / §7 設定 / §8 Stop cleanup と蒸留 / §9 Management CLI)

## 1. 背景と目的

### 1.1 観測された事実

raphael はこのリポジトリで約 1.5 か月稼働しており、次の状態になっています。

| 観測 | 実測値 |
| --- | --- |
| 抗体ファイル数(`.raphael/antibodies/*.md`) | 56 件 |
| `stats.fired` が 100 を超える抗体 | 16 件 |
| 最多発火の抗体 | 1,230 回 |
| infection record の総数(`.raphael/infections/*.jsonl` の行数) | 178 行 |
| そのうち `command-failure` | 176 件(残りは `retry-loop` などが数件) |
| 178 件のうち `tool_use_id` を持つもの | 178 件(全件) |
| 蒸留催促(Stop hook の `decision: "block"`) | ほぼ毎セッション発生 |
| 抗体ファイルの git 未コミット変更(`git status` の modified) | 28 件(発火統計の書き換えによるもの) |

この節の数値はレビュー時点の実測です(裁定 R10)。context-map の数値と食い違う箇所は、本設計書の値を正とします。

この設計を書いている最中にも、`ab-2026-0803-002`(pattern `&&.*[|;]`)が、失敗と何の関係もない読み取り専用のコマンドに対して注入されました。B1 の問題には再現性があります。

**注入の広さの定量化(事実 F7)。** Claude Code の transcript 137 セッション分から Bash 呼び出し 1,607 回(一意 1,514 件)を母集団として、現 56 抗体の pattern 一致率を実測しました。

| 観測 | 実測値 |
| --- | --- |
| 母集団(Bash 呼び出し / 一意コマンド) | 1,607 回 / 1,514 件 |
| active・confirmed 46 件のうち **1 件以上**の抗体に一致する Bash 呼び出し | **43.43%** |
| 同 **2 件以上**の抗体に一致する Bash 呼び出し | **17.49%** |
| `command-failure` の件数と失敗率 | 177 件 → 約 **11%** |
| 一致率が最大の抗体 | `ab-2026-0803-002` **23.96%**(直近 500 件では 29.00%)|
| 2 番目以下 | `ab-2026-0828-001` 8.65% / `ab-2026-0817-001` 6.29% / `ab-2026-0827-002` 5.85% / `ab-2026-0907-001` 5.48% / lint 系 3 件(`ab-2026-0810-001` / `ab-2026-0810-006` / `ab-2026-0824-005`)各 4.36% / `ab-2026-0801-001` 4.29%。残りは 4% 未満 |
| セッションあたりの一意コマンド数 | 中央値 0、最大 218、50 件以上は 12/137 セッション |

読み方は次のとおりです。Bash 実行のうち**失敗するのは約 11%** にすぎないのに、**43%** に何らかの抗体が注入され、**17%** には 2 件以上が同時に注入されています。すなわち注入の大半は、失敗と無関係なコマンドに対して起きています。§1.2 の 3(trigger が広すぎる)は、この規模で常時発生している問題です。

### 1.2 問題の構造

観測から読み取れる問題は 4 つに分かれます。

1. **検知が広すぎる。** TDD の red テスト、lint、型検査のような「意図した失敗」がすべて `command-failure` として記録されます。infection の 99% が `command-failure` であることと、蒸留催促がほぼ毎セッション出ることは、同じ原因から来ています。加えて、失敗した直後に自分で直して成功したコマンド(自己解決)も infection として残り続けます。
2. **蒸留閾値の数え方が実態と合っていない。** 閾値は「未蒸留 infection の **ID 件数**」で数えます。したがって同一の失敗を 3 回繰り返しただけで閾値 3 に到達し、「3 種類の未解決の問題がたまった」ことを表現できていません。

   **`fingerprint` は原因ではありません(事実 F1)。** `detect-infection.ts` の `recordFingerprint`(L58-68)は、`eventSeq` が `null` のとき `sha256(kind\0normalizedTarget)` を返します。`eventSeq` は `tool_use_id` があるときに `null` になるため、実データ 178 件は**全件が eventSeq を含まない fingerprint** を持ちます。すなわち同一コマンドの複数失敗は、現行でも既に同一 fingerprint です。催促がほぼ毎セッション出る実因は次の 2 つです。

   - 閾値を **record の件数**で数えていること(同じ失敗の反復がそのまま件数に積み上がる)。
   - nag digest が **session 単位の `state.json`** にあること(集合が変わらなくても、セッションが変われば再び催促される)。

   本改修は fingerprint に手を触れず、この 2 点だけを直します。
3. **trigger が広すぎても止まらない。** `update-antibody.mjs create` には、pattern がどれだけ広い範囲に当たるかを検査する仕組みがありません。`&&.*[|;]` のような pattern が作られると、以後すべての複合コマンドに注入され続けます。fired が 1,230 回という数字は、抗体が効いた証拠ではなく trigger が広すぎる証拠です。
4. **効果を測る手段がない。** `stats` にあるのは `fired` と `last_fired` だけであり、「注入したのに同じ失敗が起きた」を数えていません。効かない抗体を見つける方法がなく、抗体は増える一方です。さらに `stats` が抗体 Markdown の frontmatter に入っているため、**発火するたびに git 追跡ファイルが dirty になります**。

### 1.3 本改修が行うこと

| 記号 | 内容 |
| --- | --- |
| A0 | コマンド履歴 `.raphael/commands.jsonl` の新設(広さ検査と audit の母集団)|
| A1 | benign 既定リストの拡張(テスト・lint・型検査ランナーの exit 1 / exit 2、およびシグナル終了)|
| A2 | 自己解決の記録(失敗の後に同じコマンドが成功したら infection を `resolved` にする)|
| A3 | 蒸留閾値を「未解決の再発キーの種類数」で数え、nag digest をプロジェクト単位へ移す |
| B1 | trigger の広さ検査(`create` / `patch` の preflight で母集団への一致率を測り、広すぎれば拒否)|
| B2 | misses の計測と `ineffective` / `noisy` 候補の提示 |
| B3 | synthesizer の判断を一問から二問へ(汎用性ゲートの追加)|
| B4 | stats を frontmatter から `.raphael/stats.json` へ分離し、移行 operation を同梱 |
| C | 既存 56 件の棚卸し(決定的な `audit` operation と review 導線)|

### 1.4 オーケストレーターによる裁定(本設計はこれを前提とし、覆さない)

context-map §7 の未解決事項 #1〜#14 は、着手前にすべて裁定済みです。本設計は次を前提とします。

1. ~~`recurrence_key` を `InfectionRecordV1` の追加フィールドとして新設する~~ → **R1 により差し替え。** 再発キーは保存フィールドにせず、読み取り時に `details` から計算する純関数として定義する。`InfectionRecordV1` の schema は変えない。既存 `fingerprint` も変更しない。
2. B2 の突合せ鍵は「抗体 id × recurrence_key」。`inoculate.ts` が注入時に予測 recurrence_key を `state.injected` へ記録し、`detect-infection.ts` が失敗記録時に突き合わせる。
3. benign 既定リストを拡張する。~~exit code 128 以上は failure としない~~ → **R3 により `{130, 137, 143}` のみへ限定。** 組込み拡張分は config で無効化できる可逆設計にする。リポジトリ固有のコマンドを組込みに入れない。
4. 自己解決は PostToolUse の成功時に `state.recent_commands` を見て判定し、infection record へ `resolved` / `resolved_at` を追記する。`recent_commands` の上限を 20 から 50 へ。
5. 広さ検査は CLI の `create` / `patch` preflight にのみ実装し、PreToolUse には足さない。~~母集団 10 件未満はスキップ~~ → **R2 により母集団を `commands.jsonl` へ差し替え、下限を 50 件へ。** ~~一致率 30% 超で拒否~~ → **R12 により既定閾値を 10% へ引き下げ。**
6. misses は `stats.json` に持つ。`ineffective` は候補提示のみで、自動的に status を変えない。
7. `confirmed` は synthesizer から不変のまま。`/raphael:review` に格下げ操作を追加する。
8. stats 分離の移行は、reader の読み取り時のみ旧 `stats` key を許容し、`migrate-stats` operation を同一コミットで提供する。
9. `.raphael/stats.json` は単一 JSON、atomic 置換、欠損・破損時は 0 / null とみなす。孤児 entry は Stop hook が削除する。`.gitignore` へ追記する。
10. C の棚卸しは決定的スクリプト(`audit` operation)で行い、LLM による再蒸留は行わない。
11. B3 の第 2 問は共有機能の導入ではなく品質検査である旨を DESIGN.md の対象外節へ注記する。synthesizer の「一問だけ」制約を「二問」へ書き換える。
12. nag digest を `stats.json` の `distill.last_nag_digest` へ移す。閾値は未解決 recurrence_key の種類数で数える。
13. config の未知 key 無視は据え置き。
14. stats 書き込みに失敗しても注入は通す(フェイルオープン優先)。
15. バージョンは `0.2.0-dev`。

### 1.5 レビュー後の裁定(R1〜R12。§1.4 と食い違う場合はこちらが優先する)

第 1 版に対する独立レビューで、次の事実が確定しました。

| 記号 | 確定した事実 |
| --- | --- |
| F1 | `recordFingerprint` は `tool_use_id` があるとき eventSeq を含めない。実データ 178 件は全件 `tool_use_id` あり。同一コマンドの複数失敗は既に同一 fingerprint。催促の実因は件数で数えることと、nag digest が session 単位にあること |
| F2 | 広さ検査の母集団を「失敗コマンド」にすると `&&.*[|;]`(ab-2026-0803-002)の一致率は約 10% にとどまり `keep` に倒れる。注入は全 Bash に起きるため、母集団は「実行された全コマンド」でなければ広さを測れない |
| F3 | 接頭辞比較だけでは `cd … && pnpm vitest` / `pnpm --dir X vitest` / `TZ=… pnpm vitest` / `pnpm -C …` / `pnpm exec tsc` / `pnpm exec biome` を落とせない。176 件中、正規化なしの拡張リストで落ちるのは 78 件。`pnpm run typecheck` は exit 2 |
| F4 | exit ≥128 を一律 non-failure にすると git の fatal(128 / 129)を消す |
| F5 | `check-distill-needed.ts` の現行 `run()` は saveState 失敗時に stdout を出さない(block しない) |
| F6 | 実測: `fired > 100` は 16 件、最多 1,230、dirty 抗体は 28 件。`validateRecord` は `infection-store.ts` L201-215 |
| F7 | transcript 137 セッション・Bash 呼び出し 1,607 回(一意 1,514 件)に対する実測。全 Bash 呼び出しの 43.43% が 1 件以上、17.49% が 2 件以上の抗体に一致する。失敗率は約 11%。一致率は `ab-2026-0803-002` の 23.96% が最大で、2 番目は 8.65% と急落する。直近 500 件に窓を切ると同抗体は 29.00% まで上がる。セッション単位の一意コマンド数は中央値 0、最大 218 |

これを受けた裁定は次のとおりです。

| 記号 | 裁定 | 反映先 |
| --- | --- | --- |
| R1 | `recurrence_key` を保存フィールドにしない。読み取り時に `details` から計算する純関数 `recurrenceKeyOf(record)` として定義する。`InfectionRecordV1` の schema は変えない。`state.injected` の `recurrence_key` は保持する | §3.1 / §3.2 / §7 |
| R2 | コマンド履歴 `.raphael/commands.jsonl` を新設し、広さ検査と audit の母集団をそこから作る | §3.6 / §4.4 / §4.8 |
| R3 | benign 判定を正規化してから接頭辞比較する。拡張リストは exit 1 と 2 の両方へ適用する。exit ≥128 は `{130, 137, 143}` のみ non-failure | §4.1 |
| R4 | audit に `noisy` 指標を持たせ、`recommendation` を noisy / ineffective の組み合わせで決める | §4.8 |
| R5 | stats 分離と `migrate-stats` と `.gitignore` 追記を 1 ステップ・1 コミットに統合する | 実装計画書 §2 |
| R6 | Stop hook は nag digest の書き込みに失敗しても block しない(現行と同じ) | §4.3 |
| R7 | `inoculate` は fire 記録と state 保存をそれぞれ個別の try で包み、どちらが失敗しても注入する | §4.7 |
| R8 | 実装計画は直列とし、並列グループを廃止する | 実装計画書 §3 |
| R9 | 自己解決の成功条件は `failed === false && exit_code === 0` とする。benign の exit 1 / 2 を成功と扱わない | §4.2 |
| R10 | 数値・行番号を F6 の実測に合わせる | §1.1 ほか |
| R11 | Haiku レビュー由来の補足(merge 規則、破損の定義、型不正時の縮退、並び順、synthesizer の問 2 の判定基準、retry-loop の再発キー、メモリ参照名)を各節へ反映する | §3.3 / §3.4 / §4.6 / §4.8 |
| R12 | 広さ検査の既定閾値を 30% から **10%** へ下げる(config key `breadth_max_ratio` と範囲 1–100 は据え置き)。母集団は `commands.jsonl` の全件(上限 2,000)とし、直近 N 件の窓は設けない。`commands.jsonl` の上限 2,000 行と母集団下限 50 件は据え置く。根拠は F7 | §3.6 / §4.4 / §4.8 / §8 / §9.1 / §12 |

**context-map §7 #6 の注記。** context-map の「現状の仮定」は裁定前のものです。本設計書の §1.4 と §1.5 が優先します。食い違う場合は本設計書を正とします。

## 2. 変更しないこと

次は本改修の対象外であり、意図的に現状を維持します。

- **metatron の GOTCHAS との棲み分け。** どのリポジトリへ持っていっても成立する一般則は抗体、このリポジトリ限定の事情は GOTCHAS という分担を変えません。raphael の指示層(skills / agents / commands / references)には他プラグインの名前を書きません。
- **フェイルオープン契約。** `inoculate.ts` L112-114、`detect-infection.ts` L355-357、`check-distill-needed.ts` L149-150、`hook-io.ts` の握り潰しをそのまま残します。新設する stats 読み書き・`commands.jsonl` の追記と切り詰め・再発キー計算・miss 加算のいずれが失敗しても、注入と検知は止めません。hook の timeout 15 秒も変えません。裁定 R6 と R7 は、この契約を各経路で具体化したものです。
- **Anthropic API を使わない。** API クライアント、API キー、外部 LLM 呼び出しを追加しません。広さ検査も audit も決定的な Node.js 処理です。
- **frontmatter の許可 key と出現順序の契約。** `frontmatter.ts` が key 集合と順序を厳密に検証する方式そのものは維持します(§4.4 のとおり `stats` ブロックだけが許可集合から外れます)。
- **`fingerprint` の意味。** 既存の `recordFingerprint`(eventSeq があるときだけ連結する)を変えません。`schema_version` も 1 のままです。
- **`InfectionRecordV1` の schema(裁定 R1)。** 再発キーを保存フィールドとして足しません。追加するのは `resolved` / `resolved_at` の 2 つの任意フィールドだけです。
- **抗体 ID の形式**(`^ab-\d{4}-\d{4}-\d{3}$`)、**status の 3 値**(`active` / `expired` / `confirmed`)、**CLI の 1 行 JSON 契約と exit code**(0 成功 / 1 I-O / 2 その他)。
- **`.raphael/antibodies/` を CLI 経由でのみ書き換える規律。** 移行も棚卸しも CLI operation で行い、手書き編集も外部スクリプトも使いません。
- **`plugins/raphael/scripts/` を直接編集しない規律。** `src/` を変更して `pnpm run build` で再生成します。
- **config の未知 key を無言で無視する仕様。** 新 key を足しても厳格化はしません(裁定 #13)。

## 3. データモデルの変更

### 3.1 `InfectionRecordV1` の追加フィールド

`src/lib/types.ts` L41-56 の `InfectionRecordV1` に **2 つ**の任意フィールドを足します。`schema_version` は 1 のままです。**再発キーは保存しません**(裁定 R1)。

```ts
export interface InfectionRecordV1 {
  schema_version: 1
  id: string
  ts: string
  kind: InfectionKind
  session: string
  hook_event: "PostToolUse" | "PostToolUseFailure" | "UserPromptSubmit"
  tool: RaphaelToolName | null
  tool_use_id: string | null
  input_digest: string
  evidence: string
  fingerprint: string
  details: InfectionDetails
  distilled: boolean
  distilled_at: string | null
  resolved?: boolean             // 追加: 自己解決したか
  resolved_at?: string | null    // 追加: 自己解決を観測した時刻(ISO 8601)
}
```

2 つとも任意フィールドです。既存の 178 件はどちらも持ちませんが、`infection-store.ts` の `validateRecord`(**L201-215**)は許可 key 集合を検査していないため、そのままでも読めます。ただし**値が存在する場合の型検査を追加します**。

| フィールド | 検査 |
| --- | --- |
| `resolved` | 未定義、または boolean |
| `resolved_at` | 未定義、`null`、または ISO 8601 の日時文字列 |

上のいずれかを満たさない行は、既存の壊れた行と同じく `parseInfectionLine` が `null` を返して読み飛ばします(cleanup では原文のまま保持されます)。

`JSON.stringify` は値が `undefined` のプロパティを出力しないため、新規に書く record でも `resolved` を持たせない限り JSONL の見た目は変わりません。**新規 record の書き込み経路は本改修で変わりません。**

### 3.2 再発キー(`recurrence_key`)の定義

新設する `src/lib/recurrence.ts` が 1 つの関数を公開します。

```ts
export function recurrenceKey(kind: InfectionKind, target: string): string
// 実装: sha256Hex(`${kind}\0${target}`)
```

`target` は kind ごとに次の「安定した射影」を使います。**eventSeq も timestamp も含みません。**

| kind | target | 備考 |
| --- | --- | --- |
| `command-failure` | `details.normalized_command` | `fingerprint` の `normalizedTarget` と完全に一致する |
| `retry-loop` | `details.normalized_command` | `fingerprint` の `normalizedTarget` は末尾に `\0` + exit code 列を含むが、再発キーでは除く。**kind ラベルは `command-failure` を使い、同一コマンドの両 record が同じ鍵になるようにする** |
| `user-rejection` | `details.matched_pattern` | `fingerprint` は `prompt_excerpt` を使うが、同じ差し戻しでも文面が変わるため matched_pattern を使う |
| `edit-churn` | `details.file_path` | `fingerprint` の `normalizedTarget`(`churnWindowTarget`)は各編集の `ts` を含むため再発の同定に使えない |

`command-failure` は裁定 #1 の式(`sha256(kind + "\0" + normalizedTarget)`)と完全に一致します。他の 3 kind は `normalizedTarget` に時刻や可変の抜粋が含まれており、そのまま使うと再発キーが毎回異なって A3 の目的を達成できないため、安定射影に置き換えています(この差分は §12 の未解決事項として明示します)。実データの 99% は `command-failure` であるため、実務上の影響はありません。

**`retry-loop` の再発キーについて。** `retry-loop` の target も `details.normalized_command` であり、**`command-failure` と同じ値になります**。同一コマンドについて `command-failure` の record と `retry-loop` の record が両方あっても、再発キーの集合では 1 種類として数えられます。これは意図した挙動です(同じコマンドが繰り返し失敗しているという 1 つの問題だからです)。ただし kind が異なると `sha256(kind\0target)` の値も異なるため、**kind を含めずに target だけで射影する**ことでこの同一化を実現します。すなわち:

```ts
export function recurrenceKey(kind: InfectionKind, target: string): string
// command-failure と retry-loop は、どちらも kind ラベル "command-failure" で計算する
```

`recurrenceKeyOf` は `retry-loop` の record に対しても `recurrenceKey("command-failure", details.normalized_command)` を返します。`inoculate` が Bash 注入時に計算する予測キーも同じ式なので、B2 の突合せは両 kind に対して成立します。

**読み取り時の計算(裁定 R1)。** 再発キーは JSONL に保存しません。`src/lib/infection-store.ts` に次の**純関数**を追加します。

```ts
export function recurrenceKeyOf(record: InfectionRecordV1): string
```

`record.details` から上表の target を組み立てて計算するだけです。record は読み取り専用として扱い、書き込み経路(`appendRecord`)には一切手を入れません。既存 178 件も新規 record も同じ経路で同じ値が得られるため、移行も後方互換の分岐も不要です。

`state.injected` の `recurrence_key` はこれとは別で、**保存フィールドとして残します**。注入の時点(PreToolUse)には infection record が存在しないため、`inoculate` が計算した予測値を state に置いておく必要があるからです(§3.3)。

### 3.3 `state.injected` の拡張と `recent_commands` の変更

`RaphaelStateV1`(`types.ts` L58-86)を次のように変えます。

```ts
export interface RaphaelStateV1 {
  schema_version: 1
  session: string
  next_event_seq: number
  recent_commands: Array<{
    ts: string
    normalized_command: string
    failed: boolean
    exit_code: number | null
    infection_id: string | null
    resolved?: boolean            // 追加: 自己解決の二重計上を防ぐ印
  }>
  recent_edits: Array<{ ts: string; file_path: string; line_start: number; line_end: number }>
  last_tool: { ts: string; tool: RaphaelToolName; input_digest: string } | null
  injected: Array<{
    ts: string
    antibody_id: string
    trigger_fingerprint: string
    recurrence_key: string | null // 追加: Bash 以外は null
  }>
  // last_distill_nag_digest は削除(stats.json へ移動)
}
```

- `recent_commands` の保持上限を **20 件から 50 件へ**引き上げます(`state-store.ts` L156 の `slice(-20)`、`detect-infection.ts` L173 の `slice(-20)`)。**根拠**: 実データで、1 セッション内に同じコマンドの失敗と、その後の成功との間に 20 件を超えるコマンド実行が挟まる例が観測されました。上限 20 のままでは A2 の自己解決が取りこぼされます。50 件は、その観測を余裕をもって覆う値です。
- `injected` の `recurrence_key` は、`inoculate.ts` が Bash に注入するときだけ `sha256("command-failure\0" + normalizeCommand(command))` を入れ、Edit / Write では `null` を入れます。
- `last_distill_nag_digest` を型と `createInitialState` から外します。`validateState` はこの key の検査を削除します。既存の `state.json` にこの key が残っていても、`validateState` は許可 key 集合を検査しないため読めます(`normalizeState` のスプレッドで素通りするだけで、誰も参照しません)。
- `validateState` の `isRecentCommand` / `isInjected` は、追加フィールドが存在する場合だけ型を検査します。`recurrence_key` は `null` または 64 桁 hex、`resolved` は boolean です。**型が合わないときは、そのフィールドだけを初期値**(`recurrence_key` は `null`、`resolved` は `false`)**に落とし、entry 自体は捨てません**(裁定 R11)。miss を数え落とすだけで、他の entry まで失うことを避けます。

**`injected` の畳み込みについて。** `normalizeState`(L146-152)は `injected` を抗体 ID ごとに最新 1 件へ畳み込みます。この挙動は変えません。結果として、同じ抗体が別々のコマンドに連続して注入された場合、古い方の `recurrence_key` は失われ、その miss は数えられません。miss は**過小に数えられる方向にしか誤らない**ため、`ineffective` の誤検出を生みません。この性質を意図的な設計として DESIGN.md に記載します。

### 3.4 `.raphael/stats.json` の schema

新設ファイルです。プロジェクトごとに 1 つ、セッションを跨いで永続します。

```jsonc
{
  "schema_version": 1,
  "antibodies": {
    "ab-2026-0724-001": {
      "fired": 12,            // 0 以上の整数
      "last_fired": "2026-09-07",  // YYYY-MM-DD または null
      "misses": 3,            // 0 以上の整数
      "last_miss": "2026-09-05"    // YYYY-MM-DD または null
    }
  },
  "distill": {
    "last_nag_digest": null   // 64 桁 lowercase SHA-256 hex または null
  }
}
```

- 書き込みは `atomic.ts` の `writeFileAtomic`(temp + rename)を使います。
- **欠損・破損・schema 不一致のいずれでも、全体を初期値**(`{schema_version:1, antibodies:{}, distill:{last_nag_digest:null}}`)**とみなします。** 例外を投げません。
- **「破損」の定義(裁定 R11)。** 次のいずれかに当てはまるときだけ、全体を初期値とみなします。
  1. JSON の parse に失敗する。
  2. top-level が object でない(配列・数値・文字列・`null` を含む)。
  3. `antibodies` が object でない。

  **個別 entry の型不正は「破損」に当たりません。** その entry だけを初期値(`{fired:0, last_fired:null, misses:0, last_miss:null}`)に落とし、他の entry と `distill` は保持します。`distill` が object でない、または `last_nag_digest` が 64 桁 hex でも `null` でもないときは、`distill` だけを `{last_nag_digest:null}` に落とします。
- 個別 entry の欠損は `{fired:0, last_fired:null, misses:0, last_miss:null}` とみなします。
- **`last_fired` / `last_miss` の merge は新しい日付を採ります(max。裁定 R11)。** 文字列の `YYYY-MM-DD` はコードポイント比較が日付順と一致するため、単純な大小比較で判定します。片方が `null` なら他方を採ります。両方 `null` なら `null` です。
- key が `^ab-\d{4}-\d{4}-\d{3}$` に一致しない entry、値が上の型に合わない entry は読み込み時に落とします。
- 並行 PreToolUse による lost update は起こりえます(read-modify-write のため)。fired が数え落とされるだけで整合性は壊れないので、ロックを導入しません。
- **孤児 entry の削除。** Stop hook が `listAntibodies` の ID 集合に無い entry を `antibodies` から取り除きます。

新設 `src/lib/stats-store.ts` の公開 API:

```ts
export interface AntibodyStats { fired: number; last_fired: string | null; misses: number; last_miss: string | null }
export interface RaphaelStatsV1 { schema_version: 1; antibodies: Record<string, AntibodyStats>; distill: { last_nag_digest: string | null } }

export function statsFilePath(projectDir: string): string
export function loadStats(projectDir: string): RaphaelStatsV1        // 例外を投げない
export function saveStats(projectDir: string, stats: RaphaelStatsV1): void
export function statsFor(stats: RaphaelStatsV1, id: string): AntibodyStats  // 欠損は 0 / null
export function recordFire(projectDir: string, id: string, now?: Date): AntibodyStats
export function recordMiss(projectDir: string, id: string, now?: Date): AntibodyStats
export function pruneOrphanStats(projectDir: string, knownIds: readonly string[]): number
export function setNagDigest(projectDir: string, digest: string | null): void
```

### 3.5 frontmatter からの stats 除去

`Antibody`(`types.ts` L102-111)から `stats` を外します。

```ts
export interface Antibody {
  id: string
  created: string
  source: string
  trigger: AntibodyTrigger
  status: AntibodyStatus
  expires: string
  body: string
}
```

`AntibodyStats` の定義は `types.ts` から `stats-store.ts` へ移し、フィールドを 4 つ(`fired` / `last_fired` / `misses` / `last_miss`)に増やします。

**新しい frontmatter の形。**

```markdown
---
id: ab-2026-0724-001
created: 2026-07-24
source: "infection-20260724-120000000-a1b2c3d4"
trigger:
  event: PreToolUse
  tool: Bash
  pattern: "pnpm\\s+test"
  scope: "src/**"
status: active
expires: 2026-08-23
---

テストの前に対象パッケージと既知の失敗条件を確認すること。
```

許可 key と順序は `id` / `created` / `source` / `trigger` / `status` / `expires` / `body` になります。

**reader の猶予(裁定 #8)。** `parseAntibodyMarkdown` は、`status:` の次の行が `stats:` で始まる場合に、`stats:` 行と続くインデント行(`  fired:` / `  last_fired:`)を**読み飛ばします**。読み飛ばした値は捨てず、内部専用の返り値として `migrate-stats` に渡せるようにします。

```ts
export interface ParsedAntibody { antibody: Antibody; legacyStats: { fired: number; last_fired: string | null } | null }
export function parseAntibodyMarkdownWithLegacy(markdown: string): ParsedAntibody
export function parseAntibodyMarkdown(markdown: string): Antibody  // 既存シグネチャ。legacy を捨てて antibody だけ返す
```

`serializeAntibodyMarkdown` は `stats` ブロックを**書きません**。`validateAntibody` の許可 key から `stats` を外します(`stats` を含むオブジェクトを渡すと `antibody.stats: is not supported` で拒否します)。

結果として、移行前の抗体ファイルは「読めるが、何か 1 つでも書き込み operation を通すと stats ブロックが消える」状態になります。`migrate-stats` はこの性質を使って、統計値を `stats.json` へ写しつつファイルを書き直します。

### 3.6 `.raphael/commands.jsonl`(A0。裁定 R2)

**なぜ要るか(事実 F2)。** 広さ検査の母集団を「失敗したコマンド」にすると、母集団そのものが偏ります。実測では `&&.*[|;]`(ab-2026-0803-002)の失敗コマンド母集団に対する一致率は約 10% にとどまり、閾値を下回って `keep` に倒れます(第 2 版の閾値 30% はもちろん、裁定 R12 の 10% でも厳密な超過での比較のため境界上で通ってしまいます)。全コマンドを母集団にすれば、同じ pattern の一致率は 23.96% になります(事実 F7)。しかし**注入は失敗コマンドではなく全 Bash 実行に対して起きます**。「どれだけ広く注入されるか」を測るには、母集団も「実行された全コマンド」でなければなりません。infection JSONL と `state.recent_commands` は、どちらもこの母集団になりません(前者は失敗のみ、後者は現セッションの直近 50 件のみ)。

**新設ファイル。** プロジェクトごとに 1 つ、セッションを跨いで永続する JSONL です。gitignore します。

```jsonc
{"ts":"2026-09-08T01:02:03.456Z","session":"abc123","normalized_command":"pnpm run lint","exit_code":0,"failed":false}
```

| フィールド | 型 |
| --- | --- |
| `ts` | ISO 8601 の文字列 |
| `session` | 文字列 |
| `normalized_command` | 文字列(`state.recent_commands` と同じ正規化・同じ redaction を通したもの) |
| `exit_code` | 整数または `null` |
| `failed` | boolean(`classifyCommandOutcome` の判定結果) |

**書き込み。** `detect-infection.ts` の `processBash` が、**成功・失敗を問わず** 1 行追記します(`PostToolUse` と `PostToolUseFailure` の両方)。追記は既存の infection JSONL と同じ append 経路を使い、**失敗しても握り潰します**(フェイルオープン)。

**切り詰め。** Stop hook(`check-distill-needed.ts`)が、行数が **2,000 行**を超えていたら先頭から超過分を削ります(古い順に捨てる)。切り詰めも失敗を握り潰します。PostToolUse 側では切り詰めません(毎回全読みするコストを避けるため)。

**読み取り。** `src/lib/command-log.ts`(新規)が次を公開します。

```ts
export function commandLogPath(projectDir: string): string
export function appendCommandLog(projectDir: string, entry: CommandLogEntry): void  // 例外を投げない
export function readCommandLog(projectDir: string): CommandLogEntry[]               // 例外を投げない
export function truncateCommandLog(projectDir: string, maxLines: number): number    // 例外を投げない
```

parse できない行は読み飛ばします。ファイルが無いときは空配列です。

**母集団としての使い方。** 広さ検査と audit は `readCommandLog` の `normalized_command` を**重複排除**し、コードポイント昇順に並べ、**上限 2,000 件**で切り詰めたものを母集団とします。infection JSONL と `state.recent_commands` は母集団に使いません。母集団が **50 件未満**のときは検査せず `breadth: { checked: false, reason: "corpus_too_small" }` を返します(第 1 版の 10 件から引き上げ。全コマンドが母集団になったぶん、意味のある比率を出すには 50 件が要ります)。**閾値は 10% です(裁定 R12。第 2 版の 30% から引き下げ)。**

**保持上限と下限の据え置き(裁定 R12。事実 F7)。** 実測の全履歴が 1,607 件であり、上限 2,000 行なら現時点の履歴を全件保持できます。下限 50 件も、プロジェクト全体では十分に満たされます。`commands.jsonl` は**プロジェクト単位**のファイルなので、セッション単位の一意コマンド数(中央値 0、最大 218)は下限の判定に影響しません。

**直近 N 件の窓は設けません(裁定 R12)。** F7 では、母集団を直近 500 件に絞ると `ab-2026-0803-002` の一致率が 23.96% から 29.00% へ動きました。窓を切ると作業の内容によって判定が揺れ、同じ pattern が日によって通ったり拒否されたりします。母集団は常に `commands.jsonl` の全件(上限 2,000)とし、揺れを避けます。

**A2 との関係。** A2 の自己解決も原理的には `commands.jsonl` を見れば判定できますが、**実装は `state.recent_commands` のままとします。** 自己解決はセッション内で完結する現象であり(§4.2 のセッション境界)、`recent_commands` 50 件で十分だからです。commands.jsonl を読むぶんの I-O を PostToolUse の成功パスに足しません。

## 4. 各機能の仕様

### 4.1 A1: benign 既定リストの拡張

対象は `src/lib/detect-command.ts` です。

**組込み拡張リスト。** 現行の `BUILTIN_BENIGN_EXIT1_COMMANDS`(L3-12)を「基本 8 件」として残し、別定数として拡張分を持ちます。

```ts
// 既存。exit 1 のときだけ、正規化なしの生コマンドに対して接頭辞比較する(現行のまま)
const BUILTIN_BENIGN_EXIT1_COMMANDS = [
  "grep", "rg", "git grep", "diff", "git diff --quiet", "cmp", "test", "["
] as const

// 追加。exit 1 と exit 2 の両方に適用し、§下記の正規化を通してから比較する
const EXTENDED_BENIGN_RUNNERS = [
  "vitest", "jest", "mocha", "pytest", "biome", "eslint", "prettier", "tsc"
] as const

// 追加。`pnpm run <x>` / `pnpm <x>` / `npm run <x>` の script 名として比較する
const EXTENDED_BENIGN_SCRIPTS = ["test", "lint", "typecheck", "check"] as const
```

このリストにはリポジトリ固有のスクリプト名を入れません。上に挙げたものはいずれも、パッケージマネージャの標準ライフサイクル名(`test` / `lint` / `typecheck` / `check`)か、ツールの実行ファイル名です。

**コマンドの正規化(裁定 R3。事実 F3)。** 生のコマンド文字列への接頭辞比較だけでは、実データ 176 件のうち 78 件しか拾えません。`cd … && pnpm vitest`、`pnpm --dir X vitest`、`TZ=… pnpm vitest`、`pnpm -C …`、`pnpm exec tsc`、`pnpm exec biome` がすべて漏れるためです。拡張リストの比較対象は、次の順で正規化してから作ります。

| 段 | 内容 | 例 |
| --- | --- | --- |
| (b) | `&&` / `;` / `\|\|` で分割し、**最後のセグメント**を対象にする | `cd x && pnpm vitest` → `pnpm vitest` |
| (a) | セグメント先頭の環境変数代入(`NAME=value` の連続)を除去する | `TZ=UTC pnpm vitest` → `pnpm vitest` |
| (d) | 先頭の `npx` / `pnpm dlx` を読み飛ばす | `npx vitest` → `vitest` |
| (c) | 先頭が `pnpm` / `npm` / `yarn` のとき、続く `--dir <path>` / `-C <path>` / `--filter <name>` / `exec` / `run` を読み飛ばす | `pnpm --dir x exec tsc` → `tsc` |
| (e) | 残った実行ファイルが絶対パス・相対パスなら basename にする | `/home/u/node_modules/.bin/biome` → `biome` |

- (b) を (a) より先に行うのは、環境変数代入がセグメントごとに現れうるためです。分割してから先頭の代入を落とします。
- (c) の読み飛ばしは繰り返し適用します(`pnpm -C x run test` のような並びに対応するため)。
- (c) で `run` を読み飛ばした結果が `EXTENDED_BENIGN_SCRIPTS` のいずれかなら benign です。`pnpm test` のように `run` が無い形も、先頭が `pnpm` / `npm` / `yarn` なら script 名として比較します。
- (c)(d) をすべて剥がした結果の第 1 語が `EXTENDED_BENIGN_RUNNERS` のいずれかなら benign です。

**exit code の適用範囲。**

| リスト | 適用する exit code | 比較対象 |
| --- | --- | --- |
| `BUILTIN_BENIGN_EXIT1_COMMANDS`(既存 8 件) | 1 のみ(現行のまま) | 生のコマンド文字列 |
| `benign_exit1_commands`(config の追加分) | 1 のみ(現行のまま) | 生のコマンド文字列 |
| `EXTENDED_BENIGN_RUNNERS` / `EXTENDED_BENIGN_SCRIPTS` | **1 と 2 の両方** | 上の正規化を通した文字列 |

exit 2 まで含めるのは、`pnpm run typecheck` が exit 2 で終わることが実測で確認されているためです(事実 F3)。`grep` の exit 2 は「エラー」であって「一致なし」ではないため、既存 8 件は exit 1 限定のまま据え置きます。

**接頭辞比較の性質。** `commandStartsWith`(L160-165)は接頭辞の直後が空白か終端であることを要求します。したがって `pnpm test` は `pnpm test:unit` に一致しません(直後が `:` のため)。この性質は既存の挙動であり、変えません。正規化後の比較にも同じ規則を適用します。README に明記します。

**シグナル終了(裁定 R3。事実 F4)。** exit code が **`130`(SIGINT)、`137`(SIGKILL)、`143`(SIGTERM)のときだけ** failure としません。ユーザーの中断やタイムアウトであって AI の失敗ではないからです。**`128` 以上を一律に除外しません。** git は `fatal:` を exit 128 / 129 で返すため、一律に除外すると本物の失敗を消してしまいます。

**新しい判定式。**

```ts
const SIGNAL_EXIT_CODES = new Set([130, 137, 143])

const failedByEvent = input.hookEvent === "PostToolUseFailure"
const failedByCode = input.hookEvent === "PostToolUse" && exitCode !== null && exitCode !== 0
const benign = isBenignExit1Command(command, exitCode, additional, extendedEnabled)
const signalled = exitCode !== null && SIGNAL_EXIT_CODES.has(exitCode)
failed = (failedByEvent || failedByCode) && !benign && !signalled
```

`failedByEvent` が真(`PostToolUseFailure`)でも `signalled` と `benign` は failure を打ち消します。現行も `benign` は `PostToolUseFailure` を打ち消しているため、この構造は変わりません。

**可逆性。** 新しい config key `benign_exit1_extended`(boolean、既定 `true`)を追加します。`false` にすると `EXTENDED_BENIGN_RUNNERS` / `EXTENDED_BENIGN_SCRIPTS` と正規化を一切使わず、改修前と同じ基本 8 件 + `benign_exit1_commands` の挙動に戻ります。`isBenignExit1Command` のシグネチャに `extendedEnabled: boolean` を足します(既定値 `true`)。key 名は第 1 版から据え置きます(exit 2 も対象になりますが、config の互換を優先します)。

### 4.2 A2: 自己解決

**記録の契機(裁定 R9)。** `detect-infection.ts` の `processBash` で、**`outcome.failed === false` かつ `outcome.exit_code === 0`** のときだけ成功として扱います。

- **exit code が `null` のときは成功と扱いません。** 失敗の証拠が無いだけであり、成功した証拠も無いためです。
- **benign と判定された exit 1 / exit 2 も成功と扱いません。** benign は「infection として記録しない」だけであり、「そのコマンドがうまくいった」ことを意味しません。TDD の red を 1 回挟んだだけで、以前の本物の失敗が解決済みになるのは誤りです。

**判定。** `state.recent_commands` を走査し、次をすべて満たす entry を「解決された失敗」とします。

- `normalized_command` が今回の成功コマンドの `normalized_command` と等しい
- `failed === true`
- `infection_id !== null`
- `resolved !== true`(二重計上の防止)

**更新。** 該当 entry の `infection_id` を集め、次を行います。

1. `markInfectionsResolved(projectDir, session, ids, now)` を呼び、対象 record に `resolved: true` と `resolved_at: <ISO 8601>` を書き込む。既に `resolved` な record は数えない。既に `distilled` な record も更新する(蒸留済みでも解決の事実は残す)。
2. 対象 entry の `resolved` を `true` にする。

`markInfectionsResolved` は `markInfectionsDistilled`(`infection-store.ts` L101-126)と同じ構造で `infection-store.ts` に実装します。失敗は握り潰し、成功したコマンドの記録処理は止めません。

**セッション境界。** `recent_commands` は session スクラッチであり、session が変われば初期化されます。前セッションの失敗を今セッションの成功で解決したことにはしません。これは意図した保守的な挙動です。

**蒸留と retention への影響。**

- `resolved === true` の record は、未解決 recurrence_key の集計から除外します(§4.3)。
- cleanup(`check-distill-needed.ts` の `cleanupInfections`)の削除条件を次に拡張します。
  - `distilled === true` かつ `distilled_at` が 14 日より古い → 削除(現行のまま)
  - `resolved === true` かつ `resolved_at` が 14 日より古い → 削除(追加)
  - どちらの時刻も parse できないときは削除しない(現行の `Number.isFinite` 判定を踏襲)
- synthesizer は `resolved: true` の record を**低優先**として扱います。読むこと自体は禁じませんが、抗体化の判断では「一度は自力で直せた失敗」として扱い、他に材料があるならそちらを優先します。

### 4.3 A3: 蒸留閾値と nag

**閾値の数え方。** `cleanupProject` の返り値を次に変えます。

```ts
export interface CleanupResult {
  undistilledIds: string[]           // 従来どおり(reason の表示に使う)
  unresolvedRecurrenceKeys: string[] // 追加: 重複排除済み・コードポイント昇順
}
```

`unresolvedRecurrenceKeys` は、全 session JSONL の record のうち `distilled === false` かつ `resolved !== true` のものについて `recurrenceKeyOf(record)` を計算し、重複を排除したものです。

判定を `undistilledIds.length >= distillThreshold` から `unresolvedRecurrenceKeys.length >= distillThreshold` へ変えます。これにより「同じ失敗を 3 回」では催促されず、「違う問題が 3 種類たまった」ときだけ催促されます。

**nag digest。** `computeDistillNagDigest` の入力を infection ID の集合から recurrence_key の集合へ変えます(関数の実装 — 重複排除・コードポイント昇順・NUL 区切りの SHA-256 — はそのままです)。保存先を `state.last_distill_nag_digest` から `stats.json` の `distill.last_nag_digest` へ移します。

`stats.json` はセッションを跨いで残るため、同じ未解決集合に対する催促は**プロジェクト全体で一度だけ**になります。新しい種類の失敗が増えて集合が変わったときにだけ再通知されます。

**reason 文面。** `buildReason` の「未蒸留 infection 件数」の行を次の 2 行にします。

```
未解決の失敗の種類数: <unresolvedRecurrenceKeys.length>
未蒸留 infection 件数: <undistilledIds.length>
```

他の行は変えません。

**フェイルオープン(裁定 R6。事実 F5)。** 読み込みと書き込みで扱いを分けます。

- **読み込みに失敗**したときは `last_nag_digest = null` とみなし、通常どおり催促します(催促が重複するだけで、セッションは止まりません)。
- **書き込みに失敗**したときは `logError` に流し、**`decision: "block"` を出しません**。現行 `run()`(`check-distill-needed.ts` L131-152)は `saveState` が投げた場合に catch へ抜けて stdout を出さない、すなわち block しない挙動になっています。この挙動を維持します。digest を保存できていないのに block すると、次のセッションでも同じ催促が出続けて抑止が効かないためです。催促が 1 回落ちるだけで、次の Stop で改めて催促されます。

この扱いは「注入は止めない」フェイルオープン(§4.7)とは方向が逆に見えますが、どちらも「機構の失敗でユーザーの作業を妨げない」という同じ規律です。

### 4.4 B1: trigger の広さ検査

**適用箇所。** `update-antibody.mjs` の `create` と `patch`(`trigger` を含む patch のみ)の preflight です。**`PreToolUse` には一切足しません。**

**適用条件。** `trigger.tool` が `Bash` または `*` のときだけ検査します。`Edit` / `Write` の trigger は編集テキストに対して評価されるものであり、コマンド列の母集団に照らしても意味がないため、`{ breadth: { checked: false, reason: "tool_not_applicable" } }` を返して通します。

**母集団(裁定 R2。事実 F2)。** 新設 `src/lib/breadth.ts` の `buildBreadthCorpus(projectDir)` は、**`.raphael/commands.jsonl` の `normalized_command` だけ**を使います(§3.6)。

- 重複を排除し、コードポイント昇順に並べます。
- **上限 2,000 件**とし、超える場合は末尾(コードポイント順で後ろ)を切り捨てます。これは正規表現の総当たり評価が pathological pattern で長時間かかることを防ぐための保険です。
- **infection JSONL と `state.recent_commands` は母集団に使いません。** 前者は失敗コマンドに偏っており(F2)、後者は現セッション分しかありません。

**判定。**

```
corpus_size = corpus.length
corpus_size < breadth_min_corpus (既定 50)  →  skipped(検査せず通す)
matched     = corpus.filter(c => new RegExp(pattern).test(c)).length
ratio       = matched / corpus_size
ratio > breadth_max_ratio / 100 (既定 10)   →  拒否
```

**既定値 10% の根拠(裁定 R12。事実 F7)。** 第 2 版の 30% では、最も広い `ab-2026-0803-002`(実測 23.96%)ですら通過してしまい、安全弁として働きません。実測の分布は 23.96% の次が 8.65% で急落しており、10% はこの谷に落ちます。すなわち既定 10% は、**最広の 1 件だけを切り、残りの正当な抗体をすべて通します**。

比較は**厳密な超過**です。ちょうど 10.0% は通します。正規表現は `match-antibody.ts` と同じく flag なしの `new RegExp(pattern)` で構築します(構築に失敗する pattern は、その前段の `validateAntibody` が既に弾いています)。

**成功時の返り値。** `create` / `patch` の結果 JSON に `breadth` を足します。

```jsonc
{ "ok": true, "antibody": { ... },
  "breadth": { "checked": true, "corpus_size": 214, "matched": 12, "ratio": 0.056 } }
```

母集団不足のとき:

```jsonc
{ "ok": true, "antibody": { ... },
  "breadth": { "checked": false, "reason": "corpus_too_small", "corpus_size": 4 } }
```

**拒否時の返り値。** 抗体は作成も更新もされません。exit code は 2(validation 系)です。

```jsonc
{ "ok": false,
  "error": {
    "code": "PATTERN_TOO_BROAD",
    "message": "trigger.pattern: matches 41.1% of 214 known commands (limit 10%)",
    "field": "trigger.pattern"
  },
  "breadth": { "checked": true, "corpus_size": 214, "matched": 88, "ratio": 0.411,
               "samples": ["git status", "pnpm run build", "ls -la", "cat README.md", "node scripts/x.mjs"] }
}
```

`samples` は、**一致した母集団をコードポイント昇順に並べた先頭 5 件**です(裁定 R11)。母集団自体がコードポイント昇順なので、一致集合の順序もそのまま決まり、同じ入力に対して常に同じサンプルが返ります。secret redaction は `commands.jsonl` への書き込み時に済んでいるため、追加の redaction は行いません。

**config key。**

| key | 既定 | 範囲 |
| --- | ---: | --- |
| `breadth_max_ratio` | `10` | 整数 1–100(百分率) |
| `breadth_min_corpus` | `50` | 整数 1–5000 |

**dry-run。** `--dry-run` は現状 `patch` 専用です。広さ検査は dry-run でも実行し、拒否されるなら dry-run の時点で `PATTERN_TOO_BROAD` を返します。これにより synthesizer は本実行の前に拒否を知れます。

**synthesizer 側の代替行動。** 拒否は synthesizer を沈黙させかねないため、`agents/antibody-synthesizer.md` に次を明記します。

> `PATTERN_TOO_BROAD` で拒否されたら、trigger の pattern を、その失敗を再現しうる形へ絞って一度だけ再試行する。返された `samples` を見て、無関係なコマンドが一致していることを確認してから絞る。絞り込んでもなお拒否される、または絞ると本来防ぎたい失敗に一致しなくなる場合は、その infection を非採用として報告する。抗体を作れなかったこと自体は失敗ではない。

### 4.5 B2: misses と ineffective 候補

**注入側の記録。** `inoculate.ts` は、`tool_name === "Bash"` のとき

```ts
const injectedRecurrenceKey = recurrenceKey("command-failure", normalizeCommand(command))
```

を計算し、`state.injected` の各 entry に `recurrence_key` として入れます。Edit / Write では `null` を入れます。

**失敗側の突合せ。** `detect-infection.ts` が `command-failure` の record を追記した直後に次を行います。

1. 今回の失敗の `key = recurrenceKey("command-failure", outcome.normalized_command)` を計算する。
2. `state.injected` を走査し、`entry.recurrence_key === key` かつ `now - Date.parse(entry.ts) <= miss_window_minutes * 60_000` かつ `>= 0` の entry を集める。
3. 集まった各 `antibody_id` について `recordMiss(projectDir, id, now)` を呼ぶ。同じ antibody_id は 1 回だけ数える。
4. **全体を try/catch で囲み、失敗しても記録処理を止めない。**

`state.injected` は抗体 ID ごとに最新 1 件へ畳み込まれているため、同じ抗体が短時間に別コマンドへ注入されると、古い方の miss は数えられません(§3.3)。この過小計上は許容します。

同じ session で同じコマンドを 3 回連続失敗させた場合、3 回とも同じ抗体に miss が付きます。「注入されたのに直らなかった」ことが 3 回起きたのは事実であり、過大計上とはみなしません。

**config key。**

| key | 既定 | 範囲 |
| --- | ---: | --- |
| `miss_window_minutes` | `30` | 整数 1–1440 |
| `ineffective_min_fired` | `10` | 整数 1–1000 |
| `ineffective_miss_ratio` | `50` | 整数 1–100(百分率)|

**ineffective の判定式。**

```
ineffective = fired >= ineffective_min_fired
           && misses * 100 >= fired * ineffective_miss_ratio
```

整数演算で書き、浮動小数の丸めに依存しません。既定では `fired >= 10 && misses / fired >= 0.5` です。

**自動遷移は行いません。** `ineffective` は status ではなく、`stats.json` の値から毎回導かれる派生指標です。抗体ファイルには一切書きません。

**ユーザー却下との区別。** context-map §7 #6 は「ユーザー却下の `expired` と ineffective 候補を区別するか」を論点に挙げていました。**区別は不要**と結論します(裁定 R11 で維持が確認されました。context-map に書かれた「現状の仮定」は裁定前のものであり、本節が優先します)。理由は次のとおりです。

- 自動的に status を変える経路が無いため、`expired` になった抗体は必ず「人間の却下」か「期限切れ」の結果であり、ineffective が原因で `expired` になることはありません。
- `ineffective` は `fired` と `misses` から毎回計算される派生値であり、status とは直交します。ineffective な抗体が `active` のままでも、`confirmed` でも、`expired` でも矛盾しません。
- したがって新しい status も新しいフィールドも要りません。

**`list-antibodies.mjs` の変更。**

- JSON 出力の各 entry に `stats` を `{ fired, last_fired, misses, last_miss }` として付けます(抗体ファイルからではなく `stats.json` から join します)。これにより `commands/review.md` の既存参照(`stats.last_fired`)がそのまま動きます。
- 各 entry に `ineffective: boolean` を付けます。
- 新しいフィルタ `--ineffective` を追加します。`ineffective === true` の抗体だけを返します。`--status` / `--id` とは AND です。
- テーブル出力の列を `ID / STATUS / FIRED / MISSES / LAST_FIRED / EXPIRES / SOURCE` にします(`MISSES` を `FIRED` の直後へ挿入)。

**`/raphael:review` の変更。**

- queue mode の並び順を「ineffective 候補を先頭へ」に変えます。すなわち第 1 キーが `ineffective` の降順、以下は既存どおり `stats.last_fired` 降順(null 末尾)→ `created` 降順 → `id` 昇順です。
- 詳細表示に `misses`、`last_miss`、`ineffective` を加えます。
- `status === "confirmed"` かつ `ineffective === true` の抗体には、詳細表示の冒頭に警告を出します。文面は「この抗体は confirmed ですが、注入後に同じ失敗が <misses> 回再発しています(発火 <fired> 回)。内容の見直しか格下げを検討してください。」とします。

### 4.6 B3: synthesizer の二問と confirmed の格下げ

**二問。** `agents/antibody-synthesizer.md` L16 の「判断基準は一問だけとする」を次に置き換えます。

> - 1 件の infection につき、判断基準は次の二問とする。**両方が Yes のときだけ抗体にする。**
>   - 問 1: この知識を次回知らないと、同じ失敗をするか。
>   - 問 2: この知識は、別のリポジトリへ持っていっても成立するか。
> - 問 2 が No のもの(このリポジトリのディレクトリ構成、固有のスクリプト名、このプロジェクトだけの設定値に依存する知識)は、抗体にせず非採用として報告する。

同 L47-49 の「一問で選別し」の節見出しと本文も二問に合わせて書き換えます。判断表(L53-59)は変えません。

**問 2 の判定者と判定基準(裁定 R11)。** 問 2 は **synthesizer 自身が判定します。** 人間にもオーケストレーターにも問い返しません。判定基準を次のとおり具体化して synthesizer 定義に書きます。

> - **このリポジトリのファイルパス・スクリプト名・設定値・ディレクトリ構成に依存する記述を body に含むなら No。**
> - **言語やツールチェーンの一般的な挙動(コマンドの構文、ツールの既定動作、標準的な API の制約)なら Yes。**

判定に迷う場合は、body から固有名詞を取り除いても知識が成立するかを見ます。取り除くと意味が失われるなら No です。

**位置づけの明記。** 問 2 は「抗体をプロジェクト間で共有する機能」ではありません。共有機能は DESIGN.md L408 で対象外と明記されており、その判断は変えません。問 2 は「この知識が一般則かどうか」を測る**品質検査**です。DESIGN.md の §10 範囲に注記を足します(§6 参照)。

**confirmed の扱い。** synthesizer から見た `confirmed` は不変のままです(L17、L45、L103 を変えません)。代わりに `/raphael:review` に**格下げ**操作を足します。

- 操作選択(review.md L59-64)に `格下げ` を追加します。
- 対象は `status === "confirmed"` の抗体だけです。他の status では選択肢を出しません。
- 実行は `set-status "<id>" active` です。既存の遷移表(`update-antibody.ts` L262-271)は `confirmed → active` を既に許可しているため、CLI 側の変更は不要です。
- queue mode では counter `downgraded` を 1 増やして次へ進みます。§6 の summary table にこの counter を加えます。

### 4.7 B4: stats 分離と `migrate-stats`

**書き込み経路の移設。**

| 現在 | 変更後 |
| --- | --- |
| `antibody-store.recordAntibodyFire` が抗体 `.md` を書き換える | `stats-store.recordFire` が `stats.json` を書き換える。`antibody-store` から `recordAntibodyFire` を削除する |
| `inoculate.ts` L83-91 が fire 記録の成功を注入の前提にする | fire 記録は best-effort。**成否にかかわらず注入する**(裁定 #14) |
| `match-antibody.compareAntibodies` が `left.stats.last_fired` を読む | `matchAntibodies` の options に `stats: Record<string, AntibodyStats>` を渡し、そこから引く。未指定なら全件 `last_fired: null` 相当 |
| `update-antibody.ts` の `extend` が `current.stats.last_fired` を読む | `loadStats` から引く。`null` なら従来どおり `stats.last_fired: is required to extend` |
| `update-antibody.ts` の `record-fire` が `recordAntibodyFire` を呼ぶ | `stats-store.recordFire` を呼ぶ。返り値 JSON は `{ ok: true, antibody, stats }` |
| `list-antibodies.ts` が `antibody.stats` を読む | `loadStats` から join する |

**`inoculate.ts` の新しい流れ(裁定 R7)。** 現行 L83-91 は `recordAntibodyFire` が投げた抗体を `fired` に入れず、`fired.length === 0` なら注入せずに終わります。すなわち**統計の保存失敗が注入の失敗になっています**。これを次に変えます。

```
matched.selected が空 → 終了
→ try { recordFires(projectDir, selected.map(a => a.id)) } catch { /* 無視 */ }
→ try { state.injected へ push し saveState } catch { /* 無視 */ }
→ additionalContext を matched.selected から組み立てて出力
```

- **fire 記録と state 保存を、それぞれ独立した `try` で包みます。** 片方が失敗しても、もう片方は試みます。
- **どちらが失敗しても `additionalContext` を出します。** 注入の入力は `matched.selected` であり、統計にも state にも依存させません。
- `recordFires` は 1 回の `loadStats` / `saveStats` で全 selected 分をまとめて更新します(注入 1 回につき `stats.json` の書き込みは 1 回)。
- 外側の包括 `catch`(L112-114 相当)は残します。ここまでのいずれでも捕まらなかった例外に対して、stdout を出さずに終わります。

**`migrate-stats` operation。**

```text
printf '{}' | node scripts/update-antibody.mjs [--dir <dir>] [--dry-run] migrate-stats
```

動作:

1. `.raphael/antibodies/*.md` を列挙し、各ファイルを `parseAntibodyMarkdownWithLegacy` で読む。
2. `legacyStats !== null` のファイルについて:
   - `stats.json` の該当 entry を `{ fired: max(既存 fired, legacy.fired), last_fired: 新しい方の日付, misses: 既存 misses ?? 0, last_miss: 既存 last_miss ?? null }` に更新する。
   - 抗体ファイルを `serializeAntibodyMarkdown` で書き直す(`stats` ブロックが消える)。
3. `legacyStats === null` のファイルは触らない(冪等性)。
4. パースできないファイルは触らず、`errors` に載せる。
5. `--dry-run` のときはファイルも `stats.json` も書かず、結果だけ返す。

返り値:

```jsonc
{ "ok": true, "dry_run": false, "migrated": 56, "skipped": 0,
  "ids": ["ab-2026-0724-001", "..."],
  "errors": [{ "file": "broken.md", "message": "..." }] }
```

`max` を取るのは、移行を 2 回走らせたり、移行前に `stats.json` へ書き込みが起きたりしても値が減らないようにするためです。

**`--dry-run` の許可対象。** 現行は `patch` だけです(`update-antibody.ts` L105-110)。`migrate-stats` と `audit` を許可対象に加えます。`audit` は本来読み取り専用なので `--dry-run` は無視されますが、誤用でエラーにしないために許可します。

**Stop hook の孤児削除。** `check-distill-needed.ts` の `cleanupProject` に `pruneOrphanStats(projectDir, listAntibodies(projectDir).antibodies.map(a => a.id))` を足します。`listAntibodies` は `expireAntibodies` が既に呼んでいるので、結果を使い回します。読み込みや書き込みに失敗しても cleanup 全体を止めません。

### 4.8 C: `audit` operation と棚卸し導線

**operation。**

```text
printf '{}' | node scripts/update-antibody.mjs [--dir <dir>] audit
```

読み取り専用です。抗体ファイルにも `stats.json` にも書きません。

対象は `status` が `active` または `confirmed` の抗体すべてです。`expired` は対象外です。

各抗体について次を計算します。

- `breadth`: §4.4 と同じ母集団(`commands.jsonl`)・同じ計算。`trigger.tool` が `Edit` / `Write` のときは `{ checked: false, reason: "tool_not_applicable" }`、母集団不足のときは `{ checked: false, reason: "corpus_too_small" }`。
- `noisy`(裁定 R4): `breadth.checked === true && breadth.ratio > breadth_max_ratio / 100`。「広すぎて、関係の無いコマンドにまで注入されている」ことを表す指標です。第 1 版の `over_breadth` を改名し、返り値のフィールド名も `noisy` にします。**既定閾値 10% でも `noisy` が付くのは実測で最広の 1 件だけです**(事実 F7)。lint 系の抗体(`ab-2026-0810-001` など、各 4.36%)は広さ検査では捕まりません。それらは `ineffective`(B2 の misses)側で判定されます。2 つの指標は互いに補い合うものであり、`noisy` が付かないことは「その抗体が妥当である」ことを意味しません。
- `ineffective`: §4.5 の式。「注入しても同じ失敗が続いている」ことを表します。
- `recommendation`: 2 つの指標の**組み合わせ**で決めます(裁定 R4)。

| `noisy` | `ineffective` | `recommendation` | 読み方 |
| --- | --- | --- | --- |
| true | true | `expire` | 広く撒かれ、しかも効いていない。残す理由が無い |
| true | false | `narrow` | 効いてはいるが広すぎる。pattern を絞る |
| false | true | `expire` | 狙いは合っているのに効いていない。本文を見直すか失効させる |
| false | false | `keep` | 現状維持 |

返り値:

```jsonc
{ "ok": true,
  "corpus_size": 214,
  "thresholds": { "breadth_max_ratio": 10, "ineffective_min_fired": 10, "ineffective_miss_ratio": 50 },
  "results": [
    { "id": "ab-2026-0803-002", "status": "active",
      "trigger": { "tool": "Bash", "pattern": "&&.*[|;]" },
      "fired": 1230, "misses": 3,
      "breadth": { "checked": true, "corpus_size": 214, "matched": 88, "ratio": 0.411,
                   "samples": ["git status", "..."] },
      "noisy": true, "ineffective": false, "recommendation": "narrow" }
  ],
  "summary": { "keep": 38, "narrow": 15, "expire": 3 },
  "errors": [] }
```

**並び順(裁定 R11)。** `results` は次の順で並べます。

1. `recommendation` 順: `expire` → `narrow` → `keep`
2. 同じ `recommendation` 内では `breadth.ratio` の**降順**(`checked: false` の抗体は ratio を `-1` とみなして末尾へ)
3. 同率なら `id` の昇順

**review 導線。** `/raphael:review` の対象選択(review.md L30-35)に選択肢を 1 つ足します。

- `audit 結果を順にレビュー`

これを選ぶと、まず `audit` を実行して結果を表示し、`recommendation` が `expire` または `narrow` の抗体だけを queue snapshot に固定して、既存の 1 件ずつの操作フローへ流します。各抗体の詳細表示に `recommendation` と `breadth.ratio`、一致した `samples` を添えます。`recommendation` は提案であり、承認・却下・編集・格下げ・スキップの選択はユーザーが行います。**自動で status を変えません。**

**LLM による再蒸留は行いません。** 既存 56 件を synthesizer に読み直させて作り直す案は採りません(§7 の不採用案)。

## 5. 移行手順(既存利用者向け)

同一コミットで提供する 3 ステップです。README に手順として記載します。

### 手順 1: `.gitignore` に追記する

```gitignore
.raphael/stats.json
.raphael/commands.jsonl
```

このリポジトリ自身の `.gitignore` の「# Raphael」節(L18-22)にも同じ 2 行を足します。**この追記は、stats 分離と `migrate-stats` と同じコミットに入れます**(裁定 R5)。

### 手順 2: `migrate-stats` を実行する

```bash
# まず変更内容を確認する
printf '{}' | node plugins/raphael/scripts/update-antibody.mjs --dry-run migrate-stats

# 問題なければ実行する
printf '{}' | node plugins/raphael/scripts/update-antibody.mjs migrate-stats
```

実行後、抗体ファイルから `stats` ブロックが消え、値が `.raphael/stats.json` へ移ります。この 1 回だけは抗体ファイルが全件 dirty になるので、内容を確認してコミットします。**以後、発火では抗体ファイルが dirty になりません。**

### 手順 3: `audit` で棚卸しする

```bash
printf '{}' | node plugins/raphael/scripts/update-antibody.mjs audit
```

結果を見て、`/raphael:review` の `audit 結果を順にレビュー` で 1 件ずつ判断します。

**注意。** `audit` の広さ検査は `.raphael/commands.jsonl` を母集団にします。このファイルは改修後の PostToolUse が書き始めるため、**改修直後は空**です。母集団が 50 件に満たない間は全抗体が `corpus_too_small` となり、`noisy` は付きません。実用的な棚卸しは、通常の作業を数十コマンドぶん行ったあとに実施します。

### 移行しなかった場合の挙動

`migrate-stats` を実行しなくても、抗体は読めます(reader が `stats` ブロックを読み飛ばすため)。ただし次の状態になります。

- 発火統計は `stats.json` 側にしか積まれず、frontmatter の古い値は表示されません(`list-antibodies` は `stats.json` から join するため、全件 `fired: 0` に見えます)。
- 何らかの書き込み operation(`patch` / `set-status` / `extend`)を通した抗体だけ、その時点で `stats` ブロックが消えます。

したがって移行は必須ではありませんが、強く推奨します。README にこの旨を書きます。

## 6. 影響する文書一覧

| ファイル | 変更内容 |
| --- | --- |
| `plugins/raphael/DESIGN.md` L76 | `node26` → `node22`(`build.ts` L17 との食い違いの修正。既存の誤記)|
| 同 §4 L135-175 | frontmatter 例から `stats` を削除。フィールド表から `stats.fired` / `stats.last_fired` の 2 行を削除し、統計の所在が `.raphael/stats.json` である旨を追記 |
| 同 §4.1 L176-184 | 「発火統計の保存に失敗した抗体は注入しない」を「発火統計の保存に失敗しても注入する。統計は best-effort である」へ。`last_fired` の出所が `stats.json` である旨を追記 |
| 同 §5.1 L188-255 | `InfectionRecordV1` の 2 フィールド追加(`resolved` / `resolved_at`)と、再発キーが**読み取り時の計算であって保存フィールドではない**旨、および §3.2 の定義表 |
| 同 §5.2 L256-295 | `RaphaelStateV1` の変更(`injected.recurrence_key` / `recent_commands.resolved` の追加、`last_distill_nag_digest` の削除、`recent_commands` 上限 50)。`injected` の畳み込みが miss を過小計上する性質の明記 |
| 同 §5 に新節 5.3 | `.raphael/stats.json` の schema と欠損・破損時の規約(§3.4)|
| 同 §5 に新節 5.4 | `.raphael/commands.jsonl` の schema、書き込み契機、切り詰め、母集団としての使い方(§3.6)|
| 同 §6.1 L298-306 | benign 拡張リストと正規化、exit 2 への適用、シグナル終了(`130` / `137` / `143` のみ)の扱い |
| 同 §7 L338-357 | config 表に新 key 6 件(`benign_exit1_extended` / `breadth_max_ratio` / `breadth_min_corpus` / `miss_window_minutes` / `ineffective_min_fired` / `ineffective_miss_ratio`)|
| 同 §8 L359-370 | 閾値が recurrence_key の種類数であること、nag digest の保存先、resolved の retention、孤児 entry の削除 |
| 同 §9 L371-403 | operation 表に `migrate-stats` と `audit` を追加。`create` / `patch` の広さ検査と `PATTERN_TOO_BROAD`。`list-antibodies` の `--ineffective` と新しい列 |
| 同 §10 L404-409 | 「プロジェクト間共有は対象外」の直後に、B3 の問 2 が共有機能ではなく汎用性の品質検査である旨を注記 |
| 同 §6 の PostToolUse 節 | Bash の成功・失敗を問わず `.raphael/commands.jsonl` へ 1 行追記すること |
| 同 §8 の Stop 節 | `commands.jsonl` を 2,000 行へ切り詰めること |
| `plugins/raphael/README.md` L36-49 | `.gitignore` 推奨に `.raphael/stats.json` と `.raphael/commands.jsonl` を追加 |
| 同 L57-79 | frontmatter 例から `stats` を削除 |
| 同 L81-137 | config テンプレートと表に新 key 6 件。benign 拡張リストの説明と接頭辞比較の性質 |
| 同 L104-117 の直後 | 移行手順(§5)を新節として追加 |
| 同 L139-143 | `/raphael:review` の説明に格下げと audit 導線 |
| 同 L145-155 | データ保存先の表に `.raphael/stats.json` の行を追加 |
| 同 L168-183 | 手動シナリオを本改修の実機検証(実装計画書 §6)に合わせて更新 |
| `plugins/raphael/agents/antibody-synthesizer.md` L16 | 一問 → 二問(§4.6)|
| 同 L38-46 | injected 突合せの節に、misses が自動で数えられるようになったこと、`list-antibodies --json` の `misses` / `ineffective` を判断材料に使えることを追記 |
| 同 L47-51 | 節見出しと本文を二問に合わせる |
| 同 L76-90 | create preflight に `PATTERN_TOO_BROAD` 時の代替行動(§4.4)を追加 |
| `plugins/raphael/commands/review.md` L20,24 | 一覧の並び順(ineffective 優先)と表示列(misses / ineffective)|
| 同 L30-35 | 対象選択に `audit 結果を順にレビュー` を追加 |
| 同 L41 | counter に `downgraded` を追加 |
| 同 L53-55 | 詳細表示に `misses` / `last_miss` / `ineffective` / confirmed 警告 |
| 同 L59-64 | 操作選択に `格下げ` を追加(confirmed のときだけ)|
| 同 L174-176 | summary table に `downgraded` を追加 |
| `plugins/raphael/skills/raphael/SKILL.md` L13 | 蒸留通知の契機を「未解決の失敗の種類数」に更新 |
| 同 に新節 | **trigger の粒度の規律を新設**(§8)|
| 同 L28-30 | 保存先に `stats.json` を追加 |
| `plugins/raphael/.claude-plugin/plugin.json` | `version` を `0.2.0-dev` へ |
| `plugins/raphael/package.json` | `version` を `0.2.0-dev` へ |
| `.gitignore`(リポジトリルート)L18-22 | 「# Raphael」節に `.raphael/stats.json` と `.raphael/commands.jsonl` |
| `README.md`(リポジトリルート) L51,76-79 | raphael の説明に、質による選別(広さ検査・効果フィードバック)を反映 |
| Serena メモリ `raphael/core`(実体は `.serena/memories/raphael/core.md`) | 記述が本改修と食い違うなら Serena の `edit_memory` で更新する。本設計書と実装計画書では参照名を `raphael/core` に統一する |

`harness-docs/ARCHITECTURE.md` は、raphael の内部構造を節として持たない場合は変更不要です。実装計画書の最終ステップで実際に確認し、影響があれば `/metatron:update` で追随させます。

## 7. 不採用案と理由

| 案 | 不採用の理由 |
| --- | --- |
| **`fingerprint` の意味を変える**(eventSeq を外して再発キーそのものにする) | **そもそも不要でした(事実 F1)。** `recordFingerprint` は `tool_use_id` があるとき eventSeq を含めず、実データ 178 件は全件がその形です。同一コマンドの複数失敗は現行でも同一 fingerprint であり、「毎回異なる」という第 1 版の前提は誤りでした。加えて `detect-infection.ts` L249-253 の edit-churn 重複判定は eventSeq 込みの一意性に依存しており、意味を変えると壊れます。触りません |
| **`recurrence_key` を `InfectionRecordV1` の保存フィールドにする**(第 1 版の案・裁定 #1) | **裁定 R1 で取り下げました。** 保存すると、書き込み経路の変更、`validateRecord` の追加検査、欠損時の補完分岐、既存 178 件との二重経路がすべて必要になります。再発キーは `details` から一意に決まる純粋な射影なので、読み取り時に計算すれば同じ結果が得られます。schema を触らないぶん、既存データを壊す余地もありません |
| **`schema_version` を 2 へ繰り上げる** | 追加フィールドは `resolved` / `resolved_at` の 2 つだけで、どちらも任意であり、旧 reader は無視できます。version を上げると `validateRecord` が 1 と 2 の両方を扱う分岐を持つことになり、178 件の既存 record を移行する必要も生じます。互換を壊す変更が無いので上げません |
| **広さ検査の母集団を失敗コマンド(infection JSONL)にする**(第 1 版の案) | **事実 F2 で否定されました。** 失敗コマンドを母集団にすると `&&.*[|;]` の一致率は約 10% にとどまり、明らかに広すぎる pattern が `keep` に倒れます(閾値を 10% へ下げた裁定 R12 の後でも、厳密な超過で比較するため境界上に落ちて通ってしまいます。全コマンドを母集団にすれば同じ pattern は 23.96% になり、確実に切れます)。注入は全 Bash 実行に対して起きるため、母集団も実行された全コマンドでなければ「広さ」を測れません。コマンド履歴(§3.6)を新設する費用は、指標が意味を持たないことに比べれば安く付きます |
| **exit code 128 以上を一律に non-failure とする**(第 1 版の案) | **事実 F4 で否定されました。** git は `fatal:` を exit 128 / 129 で返します。一律に除外すると、最も拾いたい種類の失敗を消してしまいます。シグナル由来として確度が高い `130` / `137` / `143` だけに絞ります |
| **misses が閾値を超えた抗体を自動で `expired` にする** | 誤って失効させたときの復旧は人間の手を要し、しかも「効かないと判定された理由」が残りません。`ineffective` は `fired` と `misses` から毎回導ける派生値なので、候補として提示すれば十分です。加えて、注入と失敗の突合せは `state.injected` の畳み込みにより本質的に不完全であり(§3.3)、この精度で自動失効させるのは危険です |
| **PreToolUse でも広さ検査を行う** | hook の timeout は 15 秒であり、全 JSONL を走査したうえで抗体ごとに正規表現を母集団全件へ当てる処理を、毎ツール実行で行うわけにはいきません。広さは抗体を**作るとき**に一度決まる性質なので、CLI の preflight で十分です。context-map §9 のリスク(中)にもこの点が挙がっています |
| **既存 56 件を synthesizer に再蒸留させる** | 56 件 × 本文を Haiku に読ませても、判断が非決定的で再現できず、コストもかかります。広さ検査と ineffective 判定は決定的に計算できるため、`audit` で機械的に候補を出し、判断だけを人間が行う方が速く、監査可能です |
| **`.raphael/stats.json` を抗体ごとのファイルに分ける** | 並行 PreToolUse の lost update を減らせますが、56 個以上の小さなファイルが増え、孤児の掃除も面倒になります。fired の数え落としは実害が無く、単一 JSON + atomic 置換で十分です |
| **config の未知 key を厳格にエラーにする** | 新 key を 6 つ足すため typo の危険は増えますが、厳格化すると既存利用者の設定ファイルが壊れる可能性があります。裁定 #13 のとおり据え置きます |
| **`status` に `retire` を新設して ineffective 由来の失効を区別する** | 自動遷移を行わない以上、`expired` の理由は常に人間か期限切れです。区別する対象が存在しません(§4.5)|

## 8. `skills/raphael/SKILL.md` に新設する規律

skill 本文には規律だけを書き、根拠は本設計書と DESIGN.md に置きます。新設する節の内容は次のとおりです(最終的な文言は `prompt-smith:prompt-smith` をロードした担当が整えます)。

> ## trigger の粒度
>
> - trigger の `pattern` は、その抗体が防ぐ失敗を**再現しうるコマンドの形**に一致させる。コマンドの構文的な特徴(`&&`、パイプ、リダイレクト、引用符)だけに一致させない。
> - 失敗したコマンドに現れた識別子(サブコマンド名、オプション名、対象のツール名)を pattern に含める。含められないなら、その知識は抗体にしない。
> - 抗体は `create` と `patch` の preflight で広さを検査される。母集団の 10% を超えるコマンドに一致する pattern は拒否される。拒否されたら pattern を絞って一度だけ再試行し、絞れないなら非採用とする。
> - 抗体にするのは、次の二問がどちらも Yes のものだけとする。問 1「この知識を次回知らないと、同じ失敗をするか」、問 2「この知識は、別のリポジトリへ持っていっても成立するか」。

## 9. テスト方針

vitest のみです。E2E は持ちません。テストは対象と同じディレクトリの `__test__/` に置き、ファイル名は `<対象ファイル名>.test.ts` とします。既存の定石(`fs.mkdtempSync` で一時 project root を作り、`CLAUDE_PROJECT_DIR` を環境変数で差し替え、`src/testing/run-ts.ts` で子プロセス実行)に従います。fixture はテストファイル内にインラインで書きます(`src/fixtures/` は作りません)。

### 9.1 context-map §8 の (a)〜(h)

| 記号 | 内容 | 置き場所 |
| --- | --- | --- |
| (a) | benign 判定の分類表。TDD の red(`pnpm vitest` exit 1)、lint(`pnpm run lint` exit 1)、型検査(`pnpm run typecheck` **exit 2**)、**正規化の 5 段**(`cd x && pnpm vitest` / `pnpm --dir x vitest` / `TZ=UTC pnpm vitest` / `pnpm -C x run test` / `pnpm exec biome` / `/abs/path/node_modules/.bin/tsc` がいずれも benign になること)、探索の exit 2(`grep` は exit 1 のみ benign なので exit 2 は failure のまま)、シグナル終了(exit 130 / 137 / 143 は non-failure、**exit 128 / 129 は failure のまま**)、`pnpm test:unit` が `pnpm test` に一致しないこと、`benign_exit1_extended: false` で拡張分と正規化がまとめて無効になること | `src/lib/__test__/detect-command.test.ts` |
| (b) | 再発キーが同一コマンドの複数失敗で一致すること。`recurrenceKeyOf` が `details` だけから計算され、保存フィールドを読まないこと。4 kind すべての target の取り方。`command-failure` と `retry-loop` の同一コマンドが同じ鍵になること。`inoculate` が計算する予測キーと一致すること | `src/lib/__test__/recurrence.test.ts`(新規)/ `src/lib/__test__/infection-store.test.ts` |
| (i) | コマンド履歴。成功コマンドも失敗コマンドも 1 行追記されること。parse できない行が読み飛ばされること。2,000 行超が先頭から切り詰められること。書き込みに失敗しても `processBash` が続くこと。母集団が重複排除・コードポイント昇順・上限 2,000 件になること | `src/lib/__test__/command-log.test.ts`(新規)/ `src/__test__/detect-infection.test.ts` / `src/__test__/check-distill-needed.test.ts` |
| (c) | 自己解決。失敗 → 同じコマンドの成功(`failed === false && exit_code === 0`)で `resolved: true` と `resolved_at` が付くこと。**benign と判定された exit 1 / exit 2 では resolved にしないこと**。**exit code が `null` では resolved にしないこと**。二重に成功しても 2 回目は数えないこと。session が変われば解決しないこと。resolved が未解決集合から外れること。resolved が 14 日で削除されること | `src/__test__/detect-infection.test.ts` / `src/__test__/check-distill-needed.test.ts` |
| (d) | 種類数閾値と件数閾値の違い。同じコマンドの 3 回失敗(件数 3・種類数 1)では催促しない。違う 3 コマンドの失敗(件数 3・種類数 3)では催促する | `src/__test__/check-distill-needed.test.ts` |
| (e) | 広さ検査の一致率計算と境界。**母集団は `commands.jsonl` だけから作られ、infection JSONL と `recent_commands` を含まないこと**。母集団 49 件で skipped、50 件で検査。ratio がちょうど 10%(既定)で通り、10% 超で拒否。`samples` が一致集合のコードポイント昇順先頭 5 件であること。`Edit` trigger は `tool_not_applicable`。`--dry-run patch` でも拒否されること。config で閾値を変えられること | `src/lib/__test__/breadth.test.ts`(新規)/ `src/__test__/update-antibody.test.ts` |
| (f) | misses の加算条件と ineffective 判定。窓内の同一 recurrence_key で加算、窓外では加算しない、別 recurrence_key では加算しない、同一抗体を 2 重に数えない。`fired: 9, misses: 9` は ineffective でない、`fired: 10, misses: 5` は ineffective、`fired: 10, misses: 4` は ineffective でない | `src/__test__/detect-infection.test.ts` / `src/lib/__test__/stats-store.test.ts`(新規) |
| (g) | stats 分離後の frontmatter round-trip と旧形式の移行。旧形式(stats あり)が読めること、serialize すると stats が消えること、`validateAntibody` が `stats` key を拒否すること、`migrate-stats` が値を `stats.json` へ移して冪等であること、`--dry-run` が何も書かないこと、2 回目の実行が `migrated: 0` を返すこと | `src/lib/__test__/frontmatter.test.ts` / `src/__test__/update-antibody.test.ts` |
| (h) | nag のプロジェクト単位抑止。session A で催促 → session B で同じ未解決集合なら催促しない。集合が変われば催促する。**`stats.json` の書き込みに失敗したときは `decision:"block"` を出さないこと**(裁定 R6) | `src/__test__/check-distill-needed.test.ts` |
| (j) | audit の `noisy`。`noisy && ineffective` → `expire`、`noisy` のみ → `narrow`、`ineffective` のみ → `expire`、どちらでもない → `keep`。並び順(`expire` → `narrow` → `keep`、同順位は ratio 降順 → id 昇順、`checked:false` は ratio 末尾) | `src/__test__/update-antibody.test.ts` |
| (k) | フェイルオープン。`recordFires` が投げても `additionalContext` が出ること。`saveState` が投げても `additionalContext` が出ること。両方投げても出ること(裁定 R7) | `src/__test__/inoculate.test.ts` |

### 9.2 エッジケース

| ケース | 期待 |
| --- | --- |
| 抗体 0 件 | `audit` が `{ok:true, results:[], summary:{keep:0,narrow:0,expire:0}}`。`list-antibodies --ineffective` が空配列 |
| `stats.json` 欠損 | 全抗体が `fired:0, misses:0, last_fired:null, last_miss:null`。注入は通常どおり行われる |
| `stats.json` が壊れた JSON | 例外を投げず、欠損と同じ扱い。次の書き込みで正しい JSON に置き換わる |
| `stats.json` に抗体ファイルの無い ID | `list-antibodies` は無視する。Stop hook が削除する |
| 抗体ファイルはあるが `stats.json` に entry が無い | 欠損扱い(0 / null)。エラーにしない |
| 同一 session の並行 PreToolUse | `stats.json` の lost update は許容。例外を投げない |
| `.raphael/` が読めない権限 | `inoculate` は無出力で終了、`detect-infection` は `logError`、`check-distill-needed` は `logError`。いずれもツール実行とセッション終了をブロックしない |
| `commands.jsonl` が存在しない | 母集団は空。`corpus_too_small` として全件通す。`audit` は全件 `checked: false` |
| `commands.jsonl` に壊れた行がある | その行だけ読み飛ばす。例外を投げない |
| `commands.jsonl` が 2,000 行を大きく超えたまま Stop が失敗し続ける | 母集団側の上限 2,000 件で頭打ちになるため、検査時間は有界。ファイルサイズだけが伸びる |
| `stats.json` の個別 entry が型不正 | その entry だけ初期値。他の entry と `distill` は保持する(全体を初期化しない) |
| `state.injected` の `recurrence_key` が型不正 | そのフィールドだけ `null`。entry は捨てない |
| pattern が pathological(`(a+)+$` 等)| 母集団上限 2,000 件により、最悪でも有限時間で終わる。CLI なので hook の 15 秒制約は掛からない |
| `resolved` / `resolved_at` が不正な値の record | `parseInfectionLine` が `null` を返す。cleanup では原文を保持する |
| exit code が `null` の `PostToolUse` | 現行どおり failure と推定しない。シグナル判定も benign 判定も掛からない |
| `migrate-stats` を移行済みプロジェクトで実行 | `migrated: 0, skipped: <全件>`。ファイルを書かない |

### 9.3 既存テストの追随

`stats` をインライン fixture に持つ既存 6 ファイル(`frontmatter.test.ts` / `antibody-store.test.ts` / `match-antibody.test.ts` / `inoculate.test.ts` / `update-antibody.test.ts` / `list-antibodies.test.ts`)は、fixture から `stats` ブロックを外し、必要なものは `stats.json` を組み立てる形へ書き換えます。`state-store.test.ts` は `last_distill_nag_digest` の検査を落とし、`recurrence_key` / `resolved` / 上限 50 の検査を足します。`check-distill-needed.test.ts` は nag の保存先変更に追随します。

## 10. リスク

| リスク | 度合 | 対処 |
| --- | --- | --- |
| stats 分離の移行で既存 56 件が読めなくなる | 高 | reader が旧 `stats` ブロックを読み飛ばす猶予を持つ(§3.5)。`migrate-stats` を同一コミットで提供する。移行しなくても読めることをテストで固定する |
| 検知を絞りすぎて infection が枯れ、蒸留の材料が無くなる | 高 | `benign_exit1_extended: false` で改修前の挙動に戻せる。組込みリストにリポジトリ固有のコマンドを入れない。実機検証(実装計画書 §6)で「意図しない失敗はきちんと拾われること」も確認する |
| `commands.jsonl` が育つまで広さ検査が働かない | 中 | 改修直後は母集団が空で、50 件たまるまで検査がスキップされます。通常の作業なら数十分で満たされます。移行手順(§5)と実機検証(実装計画書 §6)に、母集団が育ってから audit する旨を明記します |
| PostToolUse の追記が増えて hook が重くなる | 低 | 追記は 1 行の append のみで、読み取りを伴いません。切り詰めは Stop 側に寄せてあります。失敗はすべて握り潰します |
| 広さ検査が厳しすぎて synthesizer が抗体を作れず沈黙する | 中 | 既定閾値を 10% へ下げた(裁定 R12)ぶん、この方向のリスクは第 2 版より大きくなります。ただし実測(F7)では 10% を超えるのは 56 件中 1 件だけであり、現存の抗体の 98% は通ります。母集団 50 件未満はスキップ。閾値は config で変更可能。synthesizer 定義に代替行動(絞って 1 回再試行 → 非採用として報告)を明記する。拒否時の返り値に `samples` を含め、なぜ広いのかを判断できるようにする |
| miss の突合せが `state.injected` の畳み込みで取りこぼす | 中 | 過小計上の方向にしか誤らないことを設計で保証し、DESIGN.md に明記する。`ineffective` を自動失効の根拠にしない |
| `Antibody` 型から `stats` を外すと 6 ファイル以上が同時に型エラーになる | 中 | B4 を独立した先行ステップとし、`types.ts` / `frontmatter.ts` / `antibody-store.ts` / `stats-store.ts` / `match-antibody.ts` / 3 つの CLI と、対応するテスト、`migrate-stats`、`.gitignore` の追記までを **1 コミット**で扱う(裁定 R5。実装計画書 §2 ステップ 1)|
| nag digest の移行で、移行直後に一度だけ催促が重複する | 低 | `stats.json` が空なので `last_nag_digest` は `null` となり、次の Stop で 1 回催促されます。実害が無いので許容し、README の移行手順に注記します |

## 11. Done の条件

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` がすべて通る。
- `plugins/raphael/src/` の変更に対して `pnpm run build` を実行し、`plugins/raphael/scripts/` の差分が同じコミットにある。
- `plugin.json` と `package.json` の `version` がともに `0.2.0-dev`。
- §6 の文書がすべて追随している。ルート `README.md` の raphael 節に反映されている。
- `.serena/memories/` の記述と食い違わない。
- ARCHITECTURE に影響があるかを実際に確認し、あれば `/metatron:update` で追随させている。
- 実装計画書 §6 の実機検証が完了している。

## 12. 未解決事項

裁定済みの #1〜#15 と R1〜R12 は再検討しません。執筆中に新たに生じた、オーケストレーターの確認を要する点だけを挙げます。第 2 版・第 3 版で解消した項目は取り消し線で残します。

| # | 内容 | 影響度 | 現状の設計 |
| --- | --- | --- | --- |
| N1 | 裁定 #1 は `recurrence_key` を `sha256(kind + "\0" + normalizedTarget)` と定めていますが、`command-failure` 以外の 3 kind では `normalizedTarget` に timestamp や可変の抜粋が含まれ、そのままでは再発キーとして機能しません。§3.2 では kind ごとの安定射影に置き換えています。**裁定 R1 により保存フィールドではなくなったため、この差分は JSONL の互換に影響しません**(読み取り時の計算の定義が変わるだけです) | 低 | 安定射影で実装する。`retry-loop` は `command-failure` と同じ鍵になる |
| ~~N7~~ | ~~`commands.jsonl` の保持上限 2,000 行と、母集団の下限 50 件は、実測に基づく見積りではなく設計時の判断です~~ → **解消(裁定 R12・事実 F7)。** 実測の全履歴 1,607 件は上限 2,000 に収まり、全件を保持できます。下限 50 件もプロジェクト全体では十分に満たされます(`commands.jsonl` はプロジェクト単位なので、セッション単位の一意数の中央値 0 は下限判定に影響しません)。あわせて広さ検査の既定閾値を 30% から 10% へ下げました | — | — |
| N2 | 裁定 #5 は error code を `pattern_too_broad`(小文字)と指定していますが、既存 CLI の error code はすべて大文字スネーク(`VALIDATION_ERROR` / `NOT_FOUND` / `IO_ERROR` / `RUNTIME_ERROR` / `INVALID_JSON`)です。§4.4 では既存の契約に合わせて `PATTERN_TOO_BROAD` としています | 低 | `PATTERN_TOO_BROAD` で実装する |
| N3 | 広さ検査を `trigger.tool` が `Bash` / `*` のときに限定しました(母集団がコマンド列であるため)。裁定 #5 はこの限定に触れていません。`Edit` / `Write` の trigger には広さ検査が掛からないままになります。**ユーザーが許容済み(2026-09-08)。「Edit / Write は様子見」との判断であり、本改修では対処しません** | 中 | Bash / `*` に限定する。Edit / Write 用の母集団(編集テキスト)は本改修では作らない |
| N4 | シグナル終了(`130` / `137` / `143`)を failure としない扱いに、config による無効化スイッチを設けていません(`benign_exit1_extended` は拡張リストと正規化にだけ掛かります)。裁定 #3 は可逆性を exit 1 の拡張分についてのみ求めています。**裁定 R3 で対象が 3 コードに絞られたため、影響範囲は第 1 版より小さくなりました。ユーザーが許容済み(2026-09-08)。kill されたコマンドを記録する運用が無いため、無効化スイッチは要りません** | 低 | この 3 コードは無条件で failure から外す |
| ~~N5~~ | ~~infection 件数 177 と 178 の差~~ → **解消。** 実測 178 件で確定(F6・裁定 R10) | — | — |
| N6 | Serena メモリ `raphael/core`(実体は `.serena/memories/raphael/core.md`)は実在します。本改修の内容と食い違う記述があれば更新が要ります | 低 | 実装計画書の最終ステップで内容を読み、食い違う箇所を `edit_memory` で更新する |
