# raphael 設計書

- プラグイン: `raphael`
- manifest version: `0.1.0-dev`
- 実装同期先: `plugins/raphael/`
- ステータス: 承認済み設計を Task 1–11 の実装に同期

## 1. コンセプト

raphael は、セッション中の失敗兆候を infection record として蓄積し、次回同種の操作を行う前に「抗体」として予防指示を注入する失敗免疫系プラグインである。

```text
感染記録 ──→ 抗体の蒸留 ──→ PreToolUse での予防注入
   ↑                                  │
   └──── 失敗・差し戻し・編集チャーン ────┘
```

1. **感知**: `PostToolUse`、`PostToolUseFailure`、`UserPromptSubmit` が失敗兆候を決定的に検知し、`.raphael/infections/` に JSONL を追記する。
2. **抗体生成**: `Stop` フックは未蒸留 infection が閾値以上であることを判定し、蒸留を促す。蒸留は Claude Code のサブエージェントが判断する唯一の LLM 処理である。
3. **予防接種**: `PreToolUse` が保存済み抗体の trigger を決定的に評価し、一致した抗体本文だけを `additionalContext` に注入する。

フックの感知・マッチング・永続化には Anthropic API、API キー、外部 API クライアントを用いない。LLM を使う蒸留も Claude Code のサブエージェント機構に閉じる。

学習成果を常駐の必読ファイルではなく決定的なフックマッチングへ変換するため、抗体が増えても通常時のコンテキストコストはゼロである。代わりに、パターンが一致しない偽陰性は許容する。`confirmed` は偽陰性を補正する機構ではなく、有用な抗体を有効期限による自然減衰から保護する機構である。

## 2. 実装構成

### 2.1 配置とビルド

```text
plugins/raphael/
├── .claude-plugin/plugin.json
├── README.md
├── DESIGN.md
├── package.json
├── build.ts
├── hooks/hooks.json
├── src/
│   ├── detect-infection.ts
│   ├── inoculate.ts
│   ├── check-distill-needed.ts
│   ├── list-antibodies.ts
│   ├── update-antibody.ts
│   ├── testing/run-ts.ts
│   ├── __test__/
│   └── lib/
│       ├── antibody-store.ts
│       ├── atomic.ts
│       ├── config.ts
│       ├── detect-command.ts
│       ├── detect-edit-churn.ts
│       ├── detect-rejection.ts
│       ├── frontmatter.ts
│       ├── hook-io.ts
│       ├── infection-store.ts
│       ├── match-antibody.ts
│       ├── redact.ts
│       ├── state-store.ts
│       ├── types.ts
│       └── __test__/
├── scripts/
│   ├── detect-infection.mjs
│   ├── inoculate.mjs
│   ├── check-distill-needed.mjs
│   ├── list-antibodies.mjs
│   └── update-antibody.mjs
├── agents/
│   └── antibody-synthesizer.md
├── commands/
│   └── review.md
└── skills/
    └── raphael/
        └── SKILL.md
```

`src/` は TypeScript のソースであり、`build.ts` が esbuild で Node.js ESM bundle を `scripts/*.mjs` として生成する。bundle target は `node22`、source map は生成しない。

`dist/` は使用しない。`scripts/` はビルド生成物だが Git 管理する。利用者はビルド不要であり、保守者が `src/` を変更したときだけ次を実行して、対応する `scripts/*.mjs` の差分もコミットする。

```bash
pnpm --dir plugins/raphael build
```

### 2.2 コンポーネント責務

| ソース | 生成 script | 責務 |
|---|---|---|
| `src/detect-infection.ts` | `scripts/detect-infection.mjs` | command failure、retry loop、user rejection、edit churn を検知して infection/state を更新 |
| `src/inoculate.ts` | `scripts/inoculate.mjs` | 有効な抗体を選択・発火記録し、`PreToolUse` の `additionalContext` を出力 |
| `src/check-distill-needed.ts` | `scripts/check-distill-needed.mjs` | 蒸留済み感染の retention cleanup、期限切れ抗体の失効、蒸留通知の Stop block を行う |
| `src/list-antibodies.ts` | `scripts/list-antibodies.mjs` | 抗体の一覧・フィルタ・JSON 出力 |
| `src/update-antibody.ts` | `scripts/update-antibody.mjs` | 抗体の作成・更新・状態遷移・期限延長・蒸留済みマーク |
| `src/lib/antibody-store.ts` | 各 script に bundle | 抗体ファイルの read/list/create/patch/status/fire/extend |
| `src/lib/frontmatter.ts` | 各 script に bundle | 厳密な抗体 frontmatter の parse、validation、serialize |
| `src/lib/infection-store.ts` | 各 script に bundle | infection JSONL の append/read/parse/mark と SHA-256 補助 |
| `src/lib/state-store.ts` | 各 script に bundle | `.raphael/state.json` の session state 読み書きと編集 footprint 更新 |
| `src/lib/detect-command.ts` | `detect-infection.mjs` に bundle | exit code 抽出、benign exit 1、コマンド正規化、retry loop |
| `src/lib/detect-rejection.ts` | `detect-infection.mjs` に bundle | 日英の差し戻しパターン検知 |
| `src/lib/detect-edit-churn.ts` | `detect-infection.mjs` に bundle | 重なる編集 window の検知 |
| `src/lib/match-antibody.ts` | `inoculate.mjs` に bundle | tool/scope/regex の抗体マッチングと context 整形 |
| `src/lib/redact.ts` | infection 関連 script に bundle | command/prompt など保存前の best-effort redaction |
| `src/lib/atomic.ts` | 各書込み script に bundle | temp file + rename による原子的書込み |
| `src/lib/hook-io.ts` | hook script に bundle | hook stdin の読取り、project directory 解決、エラーログ |
| `agents/antibody-synthesizer.md` | 生成物なし | 未蒸留 infection を選別し、management CLI 経由で抗体へ蒸留する専用サブエージェント |
| `commands/review.md` | 生成物なし | `/raphael:review` の対話的な抗体レビュー UI |
| `skills/raphael/SKILL.md` | 生成物なし | Stop reason、蒸留、review の動作モデルをメインエージェントへ伝える skill |

## 3. フック配線とフェイルオープン

`hooks/hooks.json` はすべての hook command を `node "${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs"` として配線する。各 hook の timeout は 15 秒である。

| Hook event | matcher | script | 動作 |
|---|---|---|---|
| `PreToolUse` | `Bash|Edit|Write` | `inoculate.mjs` | active/confirmed 抗体を評価し、一致時だけ予防指示を注入 |
| `PostToolUse` | `Bash|Edit|Write` | `detect-infection.mjs` | Bash failure、Edit churn、直前ツール情報を記録 |
| `PostToolUseFailure` | `Bash` | `detect-infection.mjs` | Bash failure の正経路として記録 |
| `UserPromptSubmit` | 指定なし | `detect-infection.mjs` | ユーザー差し戻しを記録 |
| `Stop` | 指定なし | `check-distill-needed.mjs` | cleanup と、必要時の蒸留通知 |

`PreToolUse` は stdin/config/store/regex などが壊れている場合に stdout を出さず、注入を見送る。検知処理と Stop cleanup も、失敗を元のツール実行やセッション終了へ伝播しない。この fail-open は、raphael の障害が通常の Claude Code 作業を停止させないための契約である。

成功時の `PreToolUse` 出力 schema は次である。

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "[raphael:ab-YYYY-MMDD-NNN]\n..."
  }
}
```

非マッチ、無効 regex のみ、またはエラー時には完全無出力である。

## 4. 抗体データモデル

抗体は `.raphael/antibodies/<id>.md` に 1 件ずつ保存する Markdown + YAML frontmatter である。`src/lib/frontmatter.ts` は field 順序と許可 key を厳密に検証する。

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

| Field | 型・制約 | 意味 |
|---|---|---|
| `id` | `ab-YYYY-MMDD-NNN` | 抗体 ID |
| `created` | `YYYY-MM-DD` | 作成日 |
| `source` | 最大 500 文字の文字列 | 由来。infection ID、`manual`、外部ツール名などの自由文字列 |
| `trigger.event` | `PreToolUse` | 発火イベント |
| `trigger.tool` | `Bash`、`Edit`、`Write`、`*` | 対象ツール |
| `trigger.pattern` | 最大 1,000 文字の有効な JavaScript 正規表現 | tool input に対する発火条件 |
| `trigger.scope` | 任意文字列 | Edit/Write の project-relative POSIX path に対する glob 条件 |
| `status` | `active`、`expired`、`confirmed` | 抗体の状態 |
| `expires` | `YYYY-MM-DD` | 有効期限。confirmed でも field は保持する |
| 本文 | 空白のみ不可、最大 9,000 文字 | 発火時に追加する予防指示 |

frontmatter は機械側の発火条件であり、本文は LLM 向けの指示である。フックは本文を解釈しない。発火統計(`fired` / `last_fired` / `misses` / `last_miss`)は抗体 frontmatter ではなく、プロジェクト単位の `.raphael/stats.json` に保存する。

### 4.1 マッチングと注入

- 評価対象は `active` と `confirmed` の抗体だけである。`active` かつ `expires < フック実行環境の今日（ローカル日付）` のものは `expired` へ遷移して評価しない。`confirmed` は `expires` を常に無視する。
- `tool` は完全一致、`*` は Bash/Edit/Write のすべてに一致する。
- `pattern` の対象は Bash では `command`、Edit では `old_string + "\n" + new_string`、Write では `content` である。対象文字列は最大 20,000 文字へ切り詰める。
- `scope` は Edit/Write の project-relative POSIX path にだけ適用し、Bash では無視する。glob は `*`、`**`、`?` を扱う。
- 複数マッチは `last_fired` 降順（`null` は末尾）、`created` 降順、`id` 昇順で並べ、`max_injections`（既定 3、1–10）までを選ぶ。
- 選んだ各本文には `[raphael:<id>]` 見出しを付け、合計 9,000 文字で安全に切り詰める。
- 発火統計の保存に失敗しても注入する。統計は best-effort であり、注入の成否は統計保存に依存しない。`last_fired` は抗体 frontmatter ではなく `.raphael/stats.json` から取得する。state の `injected` も、統計保存の成否にかかわらず注入対象を記録する。

## 5. Infection record と state

### 5.1 Infection JSONL schema v1

保存先は `.raphael/infections/session-<sha256(session_id)先頭16桁>.jsonl` である。UTF-8 の 1 行 1 JSON object、末尾改行ありとする。ID は `infection-YYYYMMDD-HHMMSSmmm-<random 4 bytes hex>` であり、永続連番の競合を避ける。

```ts
type InfectionKind =
  | "command-failure"
  | "retry-loop"
  | "user-rejection"
  | "edit-churn"

type InfectionDetails =
  | {
      type: "command-failure"
      command: string
      normalized_command: string
      exit_code: number | null
      output_tail: string
    }
  | {
      type: "retry-loop"
      command: string
      normalized_command: string
      consecutive_failures: number
      exit_codes: Array<number | null>
    }
  | {
      type: "user-rejection"
      prompt_excerpt: string
      matched_pattern: string
      previous_tool: { tool: "Bash" | "Edit" | "Write"; input_digest: string } | null
    }
  | {
      type: "edit-churn"
      file_path: string
      line_start: number
      line_end: number
      edits_in_window: number
    }

interface InfectionRecordV1 {
  schema_version: 1
  id: string
  ts: string
  kind: InfectionKind
  session: string
  hook_event: "PostToolUse" | "PostToolUseFailure" | "UserPromptSubmit"
  tool: "Bash" | "Edit" | "Write" | null
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

`resolved` と `resolved_at` は任意フィールドです。`resolved` は boolean、`resolved_at` は `null` または ISO 8601 の日時文字列で、型が不正な record は個別に読み飛ばします。

**再発キーは保存フィールドではない。** `recurrence_key` は `InfectionRecordV1` の JSONL に保存せず、読み取り時に `details` から計算します。計算は `sha256Hex("${kind}\0${target}")` とし、target は kind ごとに次の安定した射影を使います。event sequence と timestamp は含めません。

| kind | target | 備考 |
|---|---|---|
| `command-failure` | `details.normalized_command` | `fingerprint` の `normalizedTarget` と一致 |
| `retry-loop` | `details.normalized_command` | `command-failure` と同じ kind ラベルを使い、同一コマンドを同じ鍵にする |
| `user-rejection` | `details.matched_pattern` | 可変の prompt 本文ではなく一致した pattern を使う |
| `edit-churn` | `details.file_path` | timestamp を含む編集 window ではなくファイルパスを使う |

`recurrenceKeyOf(record)` はこの定義に従う純関数です。再発キーは読み取り時にのみ得られ、保存時の schema や `appendRecord` は変更しません。

`command` は redaction 後に最大 1,000 文字、`output_tail` は末尾最大 20 行かつ 2,000 文字、`prompt_excerpt` は最大 1,000 文字、`input_digest` は最大 500 文字、`evidence` は最大 2,000 文字である。

reader は `schema_version !== 1`、必須 field 不足、または `details.type` と `kind` の不一致を invalid record として個別にスキップする。ファイル全体は破棄しない。

保存前に `TOKEN`、`KEY`、`SECRET`、`PASSWORD`、`PASSWD` を含む環境変数代入と `Authorization: Bearer ...` を `<redacted>` に置換する。ただし redaction は best-effort であり、infections を機密情報非含有とみなしてはならない。`.raphael/infections/` は Git commit 禁止である。

同一 hook 入力の重複処理は `tool_use_id + kind` を第一キーとする。`tool_use_id` がない場合は state の `event_seq` を fingerprint 入力へ含める。process 再送で event sequence を再現できない場合、異なる実イベントを落とすより重複を許容する。

`command-failure` と、その 3 回目から派生する `retry-loop` は別 record として併存してよい。`distilled` の更新は JSONL を read-modify-write し、temp file から rename する。append と置換の同時実行による lost update は単一セッション前提の既知制約である。

### 5.2 State schema v1

`.raphael/state.json` はセッションスクラッチである。

```ts
interface RaphaelStateV1 {
  schema_version: 1
  session: string
  next_event_seq: number
  recent_commands: Array<{
    ts: string
    normalized_command: string
    failed: boolean
    exit_code: number | null
    infection_id: string | null
    resolved?: boolean
  }>
  recent_edits: Array<{
    ts: string
    file_path: string
    line_start: number
    line_end: number
  }>
  last_tool: {
    ts: string
    tool: "Bash" | "Edit" | "Write"
    input_digest: string
  } | null
  injected: Array<{
    ts: string
    antibody_id: string
    trigger_fingerprint: string
    recurrence_key: string | null
  }>
}
```

現在の hook input の session が state の `session` と異なる場合は、初期 state に切り替える。`next_event_seq` は 1 から開始し、`tool_use_id` のない受理イベントごとに採番して atomic 保存する。`recent_commands` は最大 **50 件**、`recent_edits` は最大 50 件とする。`injected` は同一 session・同一 antibody を 1 件にコアレスし、最新 timestamp を保持する。`last_distill_nag_digest` は state から削除し、nag digest は `.raphael/stats.json` の `distill.last_nag_digest` に保存する。

`injected` が抗体 ID ごとに最新 1 件へ畳み込まれるため、同じ抗体が別々のコマンドに連続して注入された場合、古い `recurrence_key` が失われ、その miss は数えられない。この性質により miss は過小計上される方向にしか誤らず、`ineffective` の誤検出は生まれない。

### 5.3 `.raphael/stats.json` schema

`.raphael/stats.json` はプロジェクトごとに 1 つ、セッションを跨いで永続する統計ファイルである。発火・miss 統計と蒸留通知の digest を抗体 Markdown から分離して保持する。

```jsonc
{
  "schema_version": 1,
  "antibodies": {
    "ab-2026-0724-001": {
      "fired": 12,
      "last_fired": "2026-09-07",
      "misses": 3,
      "last_miss": "2026-09-05"
    }
  },
  "distill": {
    "last_nag_digest": null
  }
}
```

- 書き込みは temp file + rename の atomic 置換で行い、読み書きはいずれも例外を外へ投げない。
- 欠損時は初期値(`{schema_version:1, antibodies:{}, distill:{last_nag_digest:null}}`)とみなす。
- **破損とみなす条件は次の 3 つだけ**である。JSON parse 失敗、top-level が object でない(`null`・配列・数値・文字列を含む)、`antibodies` が object でない。この場合だけ全体を初期値へ戻す。
- 個別 entry の型不正は全体破損ではない。その entry だけを初期値(`fired:0, last_fired:null, misses:0, last_miss:null`)に落とし、他の entry と `distill` は保持する。個別 entry の欠損も同じ初期値とみなす。
- `distill` が object でない、または `last_nag_digest` が 64 桁 lowercase SHA-256 hex と null のいずれでもない場合は、`distill` だけを `{last_nag_digest:null}` に落とす。
- `last_fired` と `last_miss` を merge するときは max(新しい日付)を採る。片方が null なら他方、双方 null なら null とする。
- ID 形式に一致しない entry は読み込み時に落とす。Stop hook は抗体ファイルの ID 集合に無い孤児 entry も削除する。

### 5.4 `.raphael/commands.jsonl` schema と母集団

`.raphael/commands.jsonl` はプロジェクトごとに 1 つ、セッションを跨いで永続するコマンド履歴であり、gitignore 対象である。

```jsonc
{"ts":"2026-09-08T01:02:03.456Z","session":"abc123","normalized_command":"pnpm run lint","exit_code":0,"failed":false}
```

各行は `ts`(ISO 8601 文字列)、`session`(文字列)、`normalized_command`(state と同じ正規化・redaction 済みの文字列)、`exit_code`(整数または null)、`failed`(boolean)を持つ JSON object である。parse できない行は読み飛ばし、ファイルが無いときは空配列とする。

`detect-infection.ts` の `processBash` は PostToolUse と PostToolUseFailure の両方で、Bash の成功・失敗を問わず 1 行を追記する。追記は失敗しても握り潰し、hook を止めない。Stop hook は 2,000 行を超えた場合に先頭から超過分を削り、これも失敗を握り潰す。PostToolUse 側では切り詰めない。

広さ検査と `audit` は `commands.jsonl` の `normalized_command` を重複排除し、コードポイント昇順に並べ、上限 2,000 件で切り詰めたものを母集団とする。infection JSONL と `state.recent_commands` は母集団に使わない。母集団が 50 件未満なら検査せず `breadth: { checked: false, reason: "corpus_too_small" }` として通す。直近 N 件の窓は設けず、常に履歴全体(上限 2,000 件)を使う。

## 6. 感知契約

### 6.1 Command failure と retry loop

- command failure の正経路は `PostToolUseFailure` の Bash である。`PostToolUse` の Bash も、明示 exit code が抽出できて非 0 の場合だけ failure とみなす。
- exit code は `tool_response` object の `exit_code`、`exitCode`、`code` をこの順に調べる。有限整数 number または 10 進整数 string だけを受理する。取得できなければ `error` の `(?:status code|exit code)\s+(-?\d+)` を case-insensitive に評価し、なお不明なら `null` とする。
- `PostToolUse` で exit code が `null` の場合、出力文言から failure を推定しない。
- 通常の `state.recent_commands` 用の command 正規化は trim と連続空白の 1 空白化だけである。benign 拡張リストの比較では、次の 5 段を順番に適用する。
  1. `&&` / `;` / `||` で分割し、最後のセグメントを対象にする。
  2. セグメント先頭の環境変数代入(`NAME=value` の連続)を除去する。
  3. 先頭の `npx` / `pnpm dlx` を読み飛ばす。
  4. 先頭が `pnpm` / `npm` / `yarn` のとき、`--dir <path>` / `-C <path>` / `--filter <name>` / `exec` / `run` を読み飛ばす(繰り返し適用)。
  5. 残った実行ファイルが絶対パス・相対パスなら basename にする。
- benign の組込み拡張リストは runner(`vitest`、`jest`、`mocha`、`pytest`、`biome`、`eslint`、`prettier`、`tsc`)と script(`test`、`lint`、`typecheck`、`check`)である。正規化後の接頭辞を比較し、exit 1 と exit 2 の両方へ適用する。既存の基本リスト(`grep`、`rg`、`git grep`、`diff`、`git diff --quiet`、`cmp`、`test`、`[`)と config の `benign_exit1_commands` は exit 1 のみに、生のコマンド文字列への接頭辞比較で適用する。
- `commandStartsWith` は接頭辞の直後が空白または終端であることを要求する。そのため `pnpm test` は `pnpm test:unit` に一致しない。
- exit code が `130`(SIGINT)、`137`(SIGKILL)、`143`(SIGTERM)のときだけ failure としない。`128` / `129` を含むその他の 128 以上は failure のまま扱う。
- `detect-infection.ts` の `processBash` は Bash の成功・失敗を問わず、`PostToolUse` と `PostToolUseFailure` の両方で `.raphael/commands.jsonl` に 1 行追記する。追記に失敗しても hook は止めない。
- retry loop は同じ正規化済みコマンドが既定 3 回以上連続 failure したときに記録する。類似コマンド判定はしない。

### 6.2 User rejection

大文字小文字と全角/半角空白を正規化し、英語は `i` flag、日本語は Unicode 文字列として評価する。1 prompt につき作る `user-rejection` record は 1 件だけであり、複数一致では組み込み表の先頭を採用する。`<system-reminder>` のような XML 風 tag で始まる入力は対象外とする。

**日本語の句中一致**

| ID | 正規表現 |
|---|---|
| `ja-not-that` | `そう(じゃない|ではない)` |
| `ja-wrong-target` | `(それ|そこ)(じゃない|ではない)` |
| `ja-not-intended` | `(意図|お願いしたこと|頼んだこと)と(違う|異なる)` |
| `ja-restore` | `(元に)?戻して` |
| `ja-cancel` | `(取り消して|取り消しにして)` |
| `ja-redo` | `(やり直して|最初からやって)` |
| `ja-misunderstood` | `(勘違いしている|誤解している)` |
| `ja-dont-change` | `(勝手に変えないで|そこは変えないで)` |

**日本語の先頭一致**: `ja-no` の `^(いや|いえ)[、,。!！\s]`、`ja-wrong` の `^(違う|違います|違いますね|違います。)(?:[、,。!！\s]|$)`。

**英語の句中一致**: `en-thats-wrong`、`en-not-requested`、`en-revert-that`、`en-redo`、`en-misunderstood`、`en-dont-change`。それぞれの regex は `src/lib/detect-rejection.ts` の `BUILTIN_PATTERNS` を正とする。

**英語の先頭一致**: `en-no` の `^(no|nope)[,.:;!\s]`、`en-wrong` の `^(wrong|incorrect)[,.:;!\s]`、`en-imperative-revert` の `^(please\s+)?(revert|undo|roll back)(?:[\s,.!]|$)`。

`修正して`、`変更して`、単独の `ダメ` は通常の新規依頼にも現れやすいため、組み込みには含めない。設定の `rejection_patterns` は組み込みに追加する。追加 pattern は `iu` flag で評価し、不正な regex は個別にスキップする。追加 pattern に一致した `matched_pattern` は `config:<index>` ではなく、設定した pattern 文字列そのものである。

### 6.3 Edit churn

`PostToolUse` の Edit で、`new_string` を編集後ファイルから一意に発見できた場合だけ、その開始・終了行を footprint とする。`new_string` が空、複数箇所一致、ファイルを読めない、project 外 path のいずれかでは footprint を記録せず、churn count にも含めない。

同じ session・file で行区間が重なる footprint が既定 3 件に達した時点で `edit-churn` を記録する。同じ 3 件から重複 record を作らず、4 件目以降は直近 window の fingerprint が変わった場合だけ再評価する。

## 7. 設定

`.claude/raphael.local.md` は YAML 全般ではなく flat frontmatter として parse する。不存在または frontmatter 全体が不正な場合は既定設定へ戻り、不正な field は個別に既定値へ戻す。

| File key | 既定値 | 許容値 |
|---|---:|---|
| `detect_command_failure` | `true` | `true` / `false` |
| `detect_retry_loop` | `true` | `true` / `false` |
| `detect_user_rejection` | `true` | `true` / `false` |
| `detect_edit_churn` | `true` | `true` / `false` |
| `retry_threshold` | `3` | 整数 2–10 |
| `edit_churn_threshold` | `3` | 整数 2–10 |
| `distill_threshold` | `3` | 整数 1–100 |
| `default_expiry_days` | `30` | 整数 1–365 |
| `max_injections` | `3` | 整数 1–10 |
| `rejection_patterns` | `[]` | 文字列の JSON array |
| `benign_exit1_commands` | `[]` | 文字列の JSON array |
| `benign_exit1_extended` | `true` | boolean |
| `breadth_max_ratio` | `10` | 整数 1–100(百分率) |
| `breadth_min_corpus` | `50` | 整数 1–5000 |
| `miss_window_minutes` | `30` | 整数 1–1440 |
| `ineffective_min_fired` | `10` | 整数 1–1000 |
| `ineffective_miss_ratio` | `50` | 整数 1–100(百分率) |
| `antibodies_git_policy` | `commit` | `commit` / `ignore` |

`antibodies_git_policy` は設定として読み込むが、現実の Git ignore/commit は利用者の `.gitignore` と運用で決める。推奨は `commit` である。

## 8. Stop cleanup と蒸留

`check-distill-needed.mjs` は Stop hook が再入中の場合、または session ID がない場合は何もしない。通常の Stop 時は次を行う。

1. `distilled: true` かつ `distilled_at` から 14 日より古い infection record、または `resolved: true` かつ `resolved_at` から 14 日より古い record を削除する。不正な日時は削除しない。
2. `active` かつ `expires < 今日` の抗体を `expired` へ遷移する。
3. `.raphael/stats.json` から抗体ファイルに存在しない孤児 entry を削除する。
4. `.raphael/commands.jsonl` が 2,000 行を超えていれば、先頭から超過分を削除する。
5. 未蒸留かつ未解決の infection から再発キーを計算し、重複排除した**未解決の再発キーの種類数**が `distill_threshold` 以上で、集合 digest が前回通知分と異なる場合に `decision: "block"` と蒸留を促す reason を出力する。同じ失敗の反復は 1 種類として数える。

nag digest は state ではなく `.raphael/stats.json` の `distill.last_nag_digest` に保存する。`stats.json` の読み込みに失敗した場合は null とみなして催促し、digest の書き込みに失敗した場合はログに流して block しない。cleanup、孤児 entry の削除、commands の切り詰めなどの失敗も、通常のツール実行やセッション終了を止めない。

蒸留担当は未蒸留 infection と既存抗体を参照し、次回同じ状況で同じ失敗を防ぐ知識だけを抗体にする。実質的に同じ trigger は既存抗体の期限延長、同型で対象が異なるものは pattern の汎化、新規で表現できない場合だけ新規抗体を作る。抗体と infection の更新は下記 management CLI 経由で行い、frontmatter を手書き編集しない。

`commands/review.md` は `/raphael:review` の対話的 UI を定義する。コマンドは抗体の一覧、承認(`confirmed`)、却下(`expired`)、格下げ(`confirmed` から `active`)、編集を担い、読み取りには `list-antibodies.mjs`、更新には `update-antibody.mjs` だけを使用する。編集は `patch --dry-run` による検証と、同一 JSON patch の明示確認後の適用を必須とする。

## 9. Management CLI

### 9.1 共通契約

`update-antibody.mjs` は stdin から request body の JSON を受け取り、stdout に result/error JSON を 1 行で出力する。`--dir <project-dir>` を省略した場合は `CLAUDE_PROJECT_DIR`、さらに未設定なら current working directory を使う。すべての operation は stdin に有効な JSON を必要とする。

終了コードは 0 が成功（対象なし、confirmed の `extend` no-op を含む）、1 が実行時/I/O error、2 が呼び出し/validation error である。

```text
node scripts/update-antibody.mjs [--dir <project-dir>] <operation> [operands...]
```

| Operation | operands | stdin JSON | 動作 |
|---|---|---|---|
| `create` | なし | `{ "source", "trigger", "expires", "body" }` | draft から新規抗体を atomic 作成。既存 ID は拒否 |
| `patch` | `<id>` | `source`、`trigger`、`body` の任意 subset | 部分更新。`--dry-run` 時は書かずに normalized antibody と `diff` を返す |
| `set-status` | `<id> <active|expired|confirmed>` | 任意の有効 JSON | 状態遷移。すべての異状態間遷移を許可 |
| `extend` | `<id>` | 任意の有効 JSON | `last_fired + default_expiry_days` と `created + 90 日` の早い方へ延長。confirmed は no-op |
| `record-fire` | `<id>` | 任意の有効 JSON | `fired` を +1、`last_fired` を今日へ更新 |
| `mark-distilled` | なし | `{ "ids": string[] }` | infection JSONL の対象 record を蒸留済みにする |
| `migrate-stats` | なし | 有効な JSON | 旧 frontmatter の `stats` を `.raphael/stats.json` へ移し、抗体を書き直す。`--dry-run` 対応 |
| `audit` | なし | 有効な JSON | `commands.jsonl` を母集団に広さと効果を決定的に棚卸しする。読み取り専用。`--dry-run` 対応 |

`create` と `trigger` を含む `patch` は、Bash または `*` の trigger に対して `commands.jsonl` の母集団への一致率を preflight 検査する。母集団 50 件未満、または Edit / Write trigger は検査をスキップする。ratio が `breadth_max_ratio` を厳密に超える場合は抗体を作成・更新せず、exit code 2 と次の error を返す。

```jsonc
{ "ok": false,
  "error": { "code": "PATTERN_TOO_BROAD", "field": "trigger.pattern", "message": "trigger.pattern: matches 41.1% of 214 known commands (limit 10%)" },
  "breadth": { "checked": true, "corpus_size": 214, "matched": 88, "ratio": 0.411,
               "samples": ["git status", "pnpm run build", "ls -la", "cat README.md", "node scripts/x.mjs"] } }
```

ちょうど閾値の一致率は通し、超過だけを拒否する。`--dry-run` は `patch`、`migrate-stats`、`audit` で使用でき、`create` では使用できない。

`list-antibodies.mjs` は stdin を使わない。

```text
node scripts/list-antibodies.mjs [--json] [--include-body] [--id <id>] [--status <active|expired|confirmed>] [--ineffective] [--dir <dir>]
```

- `--json` は `{ "ok": true, "antibodies": [...], "errors": [...] }` を出力する。
- `--include-body` がない JSON 出力では抗体本文を除外する。
- `--status`、`--id`、`--ineffective` は AND 条件で絞り込む。`--ineffective` は ineffective 候補だけを返す。
- JSON 出力の各 entry は `stats`(`fired` / `last_fired` / `misses` / `last_miss`)と `ineffective` を含む。
- テーブル出力の列は `ID / STATUS / FIRED / MISSES / LAST_FIRED / EXPIRES / SOURCE` である。並び順は `id` 昇順である。
- list の終了コードは成功 0、I/O error 1、引数/validation error 2 である。

## 10. 範囲

v0.1 の対象は command failure、retry loop、user rejection、edit churn の 4 検知、Stop による蒸留通知、PreToolUse 正規表現注入、抗体の状態・期限管理である。

対象外はプロジェクト間共有、Codiel の GOTCHAS との自動変換、多言語の包括的な差し戻し検知、類似抗体のベクトル検索、セッション途中の LLM 抗体生成、類似コマンドの retry 判定、セッション間の同時実行ロックである。Codiel との将来連携のため、抗体の `source` は自由文字列とする。

なお、synthesizer の二問の問 2 はプロジェクト間共有機能ではなく、抗体本文が別のリポジトリでも成立する一般則かを確認する汎用性の品質検査である。

## 11. 検証方針

`src/__test__/` と `src/lib/__test__/` には vitest の unit/integration test を置く。重点は frontmatter、atomic I/O、config、redaction、infection/state store、command/rejection/edit 検知、antibody matching、hook I/O、CLI と Stop cleanup である。

手動検証は次を最低限とする。

1. 同じ失敗する Bash command を 3 回実行し、infection 記録と Stop の蒸留通知を確認する。
2. `active` 抗体に一致するツール操作を行い、`additionalContext`、発火統計、state の注入記録を確認する。
3. 期限切れ active 抗体が `expired` となり注入されないことを確認し、review UI 実装後は confirmed/expired 遷移と編集 validation を確認する。

bundle の smoke は次で行う。

```bash
pnpm --dir plugins/raphael build
node plugins/raphael/scripts/list-antibodies.mjs --dir "$(mktemp -d)" --json
```

空の一時プロジェクトに対する 2 行目は、成功時に空の `antibodies` と `errors` を含む JSON を返す。
