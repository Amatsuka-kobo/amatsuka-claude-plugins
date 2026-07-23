# raphael 失敗免疫系プラグイン Implementation Plan

**Goal:** セッション中の失敗兆候を決定的 hook で感染記録へ残し、Stop 時だけ Claude Code サブエージェントが抗体へ蒸留し、以後の PreToolUse で一致した抗体だけを `additionalContext` として注入する `raphael` v0.1.0-dev を実装する。

**Architecture:** `src/` の TypeScript を正本とし、Node 標準ライブラリだけで感染 JSONL・セッション state・抗体 Markdown/YAML frontmatter を管理する。hook entry は薄く、判定・I/O・schema validation を `src/lib/` に集約する。esbuild で `scripts/*.mjs` へバンドルし、生成物を git 管理する。LLM は `antibody-synthesizer` サブエージェントだけが使用し、Anthropic API・API client・`ANTHROPIC_API_KEY` は一切使わない。

**Input design:** `docs/superpowers/specs/2026-07-22-raphael-plugin-design.md`(ユーザー承認済み)

**Context map:** `.claude/context-maps/2026-07-24-raphael-plugin.md`

## Global Constraints

- Anthropic API、外部 LLM API、API key、API client を追加しない。
- ランタイム依存は Node.js >= 26 の標準ライブラリだけとする。YAML/glob ライブラリを追加しない。
- `src/**/*.ts` が唯一の編集対象。配布実行物は `scripts/*.mjs`。`dist/` は作らない。
- **ビルド方針の確定:** Task 1 では build script を登録せず、Task 2〜10 は source/test の実装と `pnpm test` / `pnpm lint` / `pnpm typecheck` だけを行う。`scripts/` が未生成の中間状態は意図的であり、実装完了扱い・レビュー依頼・配布をしてはならない。Task 11 で build script を登録して初回 `pnpm build` を行い、Task 2〜10 の全 source に対応する生成物を一括生成する。タスク単位で commit する運用でも source-only commit は Task 11 までの一時状態とし、Task 11 の生成物 commit までを不可分の実装単位とする。Task 11 以後に `src/` を変更した場合は、同じタスク内で必ず `pnpm build` を実行して生成差分を含める。
- hooks は、意図した Stop 差し戻し以外はフェイルオープンとする。不正 stdin、壊れた設定、壊れた抗体、I/O エラーでセッションを止めない。
- hook の stdout は、契約 JSON 1 件または空文字だけとし、ログ・説明文を混ぜない。
- `.raphael/infections/` と `.raphael/state.json` はローカル状態、`.raphael/antibodies/` は共有可能な成果物として扱う。
- v0.1 は単一セッション運用を前提とし、セッション間ロックは実装しない。すべての置換書き込みは同一ディレクトリ内 temp file → rename とする。
- Codiel / GOTCHAS / Raguel は変更しない。`source` を自由文字列として将来連携の余地だけ残す。
- テストは vitest。hook I/O は pitcrew と同じ `runTs()` + fixture stdin + tmp project 方式で検証する。
- 各実装タスクは原則 TDD(失敗テスト→実装→対象テスト成功)で進める。

## 確定設計 A: ユーザー差し戻し語彙(日英)

以下は **v0.1 の最終組み込み語彙リスト**である。組み込み語彙は「高確信の句中一致」と「短語の先頭一致」を分ける。大文字小文字、全角/半角空白を正規化し、英語は `i` flag、日本語は Unicode 文字列として評価する。設定 `rejection_patterns` はこの組み込みリストへ追加し、置換しない。

### 日本語

**句中一致(文中のどこでも検知):**

| pattern id | 正規表現 |
|---|---|
| `ja-not-that` | `そう(じゃない|ではない)` |
| `ja-wrong-target` | `(それ|そこ)(じゃない|ではない)` |
| `ja-not-intended` | `(意図|お願いしたこと|頼んだこと)と(違う|異なる)` |
| `ja-restore` | `(元に)?戻して` |
| `ja-cancel` | `(取り消して|取り消しにして)` |
| `ja-redo` | `(やり直して|最初からやって)` |
| `ja-misunderstood` | `(勘違いしている|誤解している)` |
| `ja-dont-change` | `(勝手に変えないで|そこは変えないで)` |

**先頭一致(短語の誤爆を抑制):**

| pattern id | 正規表現 |
|---|---|
| `ja-no` | `^(いや|いえ)[、,。!！\s]` |
| `ja-wrong` | `^(違う|違います|違いますね|違います。)(?:[、,。!！\s]|$)` |

`修正して`、`変更して`、単独の `ダメ` は通常の新規依頼にも現れやすいため組み込みには含めない。

### 英語

**句中一致:**

| pattern id | 正規表現 |
|---|---|
| `en-thats-wrong` | `\b(that(?:'s| is) wrong|that(?:'s| is) not right)\b` |
| `en-not-requested` | `\b(not what i (asked|requested|meant|wanted))\b` |
| `en-revert-that` | `\b(revert|undo|roll back) (that|this|the last change)\b` |
| `en-redo` | `\b(start over|do it again|try again)\b` |
| `en-misunderstood` | `\b(you misunderstood|you misread)\b` |
| `en-dont-change` | `\b(do not|don't) change (that|this)\b` |

**先頭一致:**

| pattern id | 正規表現 |
|---|---|
| `en-no` | `^(no|nope)[,.:;!\s]` |
| `en-wrong` | `^(wrong|incorrect)[,.:;!\s]` |
| `en-imperative-revert` | `^(please\s+)?(revert|undo|roll back)(?:[\s,.!]|$)` |

- 1 prompt につき `user-rejection` は 1 レコードだけ作る。複数一致時は表の先頭の pattern id を採用する。
- XML 風 harness/meta 注入(`<system-reminder>` 等)で始まる入力は対象外とする。
- `prompt` 抜粋は最大 1,000 文字、感染記録の `evidence` は最大 2,000 文字とする。

## 確定設計 B: 感染記録 JSONL schema v1

保存先は `.raphael/infections/session-<sha256(session_id)先頭16桁>.jsonl`。1 行 1 JSON object、UTF-8、末尾改行あり。record ID は `infection-YYYYMMDD-HHMMSSmmm-<random 4 bytes hex>` とし、永続連番の競合を避ける。

```ts
type InfectionKind =
  | "command-failure"
  | "retry-loop"
  | "user-rejection"
  | "edit-churn"

type InfectionDetails =
  | {
      type: "command-failure"
      command: string                 // redaction 後、最大 1,000 文字
      normalized_command: string
      exit_code: number | null
      output_tail: string             // 末尾最大20行かつ2,000文字
    }
  | {
      type: "retry-loop"
      command: string
      normalized_command: string
      consecutive_failures: number    // v0.1 は必ず 3 以上
      exit_codes: Array<number | null>// 最新3件
    }
  | {
      type: "user-rejection"
      prompt_excerpt: string
      matched_pattern: string         // 上表の id または config:<index>
      previous_tool: {
        tool: "Bash" | "Edit" | "Write"
        input_digest: string
      } | null
    }
  | {
      type: "edit-churn"
      file_path: string               // project-relative POSIX path
      line_start: number
      line_end: number
      edits_in_window: number         // v0.1 は必ず 3 以上
    }

interface InfectionRecordV1 {
  schema_version: 1
  id: string
  ts: string                         // ISO 8601 UTC
  kind: InfectionKind
  session: string
  hook_event:
    | "PostToolUse"
    | "PostToolUseFailure"
    | "UserPromptSubmit"
  tool: "Bash" | "Edit" | "Write" | null
  tool_use_id: string | null
  input_digest: string               // redaction 後、最大500文字
  evidence: string                   // 人間/蒸留向け要約、最大2,000文字
  fingerprint: string                // sha256 hex。kind+正規化対象から生成
  details: InfectionDetails
  distilled: boolean                 // 新規時 false
  distilled_at: string | null        // mark 時 ISO、未処理は null
}
```

### schema 運用規則

- reader は `schema_version !== 1`、必須 field 不足、details.type と kind の不一致を invalid record としてスキップする。ファイル全体は捨てない。
- `TOKEN|KEY|SECRET|PASSWORD|PASSWD` を含む環境変数代入と `Authorization: Bearer ...` は保存前に `<redacted>` へ置換する。
- `command-failure` と、その3回目から派生する `retry-loop` は別レコードとして併存してよい。
- 同一 hook 入力の二重処理は `tool_use_id + kind` を第一キーとする。`tool_use_id` が無い場合は、hook 受信時に state の同一 process 内で割り当てる単調増加 `event_seq` を fingerprint 入力へ含め、`session + hook_event + event_seq + kind + fingerprint` を代替キーとする。時刻の秒丸めだけを dedupe key に使わないため、同一秒内に別々の同型 tool use が発生しても統合しない。process 再送で event_seq を再現できない場合の重複排除は best-effort とし、異なる実イベントを落とすより重複記録を許容する。
- `distilled` 更新は対象 JSONL を read-modify-write し、temp→rename する。append と置換が同時に起こる lost update は単一セッション前提の既知制約とする。

## 確定設計 C: `.raphael/state.json` schema v1

```ts
interface RaphaelStateV1 {
  schema_version: 1
  session: string
  next_event_seq: number              // tool_use_id 不在時の代替イベント識別子
  recent_commands: Array<{
    ts: string
    normalized_command: string
    failed: boolean
    exit_code: number | null
    infection_id: string | null
  }>                              // 最大20件
  recent_edits: Array<{
    ts: string
    file_path: string
    line_start: number
    line_end: number
  }>                              // 最大50件
  last_tool: {
    ts: string
    tool: "Bash" | "Edit" | "Write"
    input_digest: string
  } | null
  injected: Array<{
    ts: string
    antibody_id: string
    trigger_fingerprint: string
  }>
  last_distill_nag_digest: string | null
}
```

- session が現在の hook input と違う場合は新しい初期 state に切り替える。
- `next_event_seq` は1から開始し、`tool_use_id` 不在の hook event を受理するたびに採番して atomic 保存する。
- `injected` は同一 session・同一 antibody を1件にコアレスし、最新 ts を保持する。
- Stop 差し戻し後は、未蒸留 infection ID をコードポイント昇順にソートし、NUL (`\0`) 区切りで連結した UTF-8 bytes の **SHA-256 lowercase hex** を `last_distill_nag_digest` に保存する。同じ集合では再 block せず、新規感染で集合が変われば再通知できる。

## 確定設計 D: `/raphael:review` UI flow

`commands/review.md` が UI オーケストレーションを担い、抗体を直接編集しない。読み取りは `list-antibodies.mjs --json`、更新は `update-antibody.mjs` のみを使う。

1. **一覧取得**
   - active → confirmed → expired の順、各群内は `stats.last_fired` 降順(null は末尾)→`created` 降順→`id` 昇順。
   - 件数、ID、status、tool、pattern、scope、fired、last_fired、expires、本文先頭80文字を Markdown table で表示する。
   - 抗体が0件なら「レビュー対象なし」と報告して終了する。
2. **対象選択(AskUserQuestion 1回目)**
   - `active を順番にレビュー(推奨)`
   - `IDを指定してレビュー`(Other に ID 入力)
   - `confirmed / expired も含めて選ぶ`(Other に ID 入力)
   - `終了`
3. **1件の詳細表示**
   - frontmatter 全項目、本文、source、発火統計、期限状態を表示する。
4. **操作選択(AskUserQuestion 2回目以降、1件ごと)**
   - `承認` → status を `confirmed`。期限は保持するが評価時は無視する。
   - `却下` → status を `expired`。ファイルは削除しない。
   - `編集` → 次の編集 flow へ。
   - `スキップ/終了` → queue mode なら次へ、ID mode なら終了。
5. **編集 flow**
   - 編集対象を `trigger` / `本文` / `両方` / `キャンセル` から選ぶ。
   - trigger は `tool`、`pattern`、任意 `scope` を対話で受け取る。空入力は現値維持、scope に `-` を指定した場合だけ削除する。
   - 本文は自由入力で受け取る。空入力は現値維持とし、空本文への更新は禁止する。
   - `update-antibody.mjs patch --dry-run <id>` に JSON patch を stdin で渡し、regex・tool・scope・本文・schema を検証する。
   - 変更前/変更後を表示し、`この変更を適用` / `修正して再入力` / `キャンセル` を確認する。
   - 適用時だけ dry-run なしで同じ patch を渡す。
6. **更新後**
   - CLI の JSON result を確認し、成功時は再取得した要約を表示する。失敗時はファイルを直接直さず、validation error を示して同じ item の操作選択へ戻る。
   - queue mode は未処理 active の次 item へ進み、最後に confirmed / expired / edited / skipped 件数を報告する。

明示的な削除操作は v0.1 に設けない。「却下」は監査可能な `expired` への遷移とする。

## 確定設計 E: hook と CLI の主要契約

### command failure

- command failure は既存コードベースの実測契約に合わせ、`PostToolUseFailure` の Bash を正経路とする。`PostToolUse` Bash も受けるが、明示 exit code を抽出できて非0の場合だけ failure とみなす。
- `tool_response` の実測形は string、または `{stdout?: string, stderr?: string}` object であり、既存 pitcrew 実装では exit code が含まれない。将来/環境差で数値が付く場合だけ、object の `exit_code`、`exitCode`、`code` をこの優先順で参照し、値は finite integer number または10進整数 string のみ受理する。それ以外は `error` string の `(?:status code|exit code)\s+(-?\d+)` を case-insensitive で抽出し、取得不能は null とする。PostToolUse で exit code が null の場合は出力文言から失敗推定せず、command-failure を作らない。
- 以下は **v0.1 の最終 benign exit-1 組み込みリスト**である: `grep`, `rg`, `git grep`, `diff`, `git diff --quiet`, `cmp`, `test`, `[`。exit code 1 の時だけ除外し、config `benign_exit1_commands` は追加扱いとする。
- normalized command は trim + 連続空白の1空白化だけ。v0.1 は引用符・option・path の意味解析をしない。

### edit churn

- PostToolUse Edit の `new_string` を編集後ファイル内で一意に発見できた場合、その開始/終了行を footprint とする。
- `new_string` が空、複数箇所一致、ファイル読取不能、project 外 path の場合は footprint を記録せず、churn count に含めない。誤検知より偽陰性を選ぶ。
- 同一 session・同一 file で行区間が重なる footprint が3件に達した時点で1件記録する。同じ3件から重複作成せず、4件目以降は直近3件の集合 fingerprint が変わった場合のみ再評価する。

### antibody matching / injection

- status が `active` または `confirmed` の抗体だけ評価する。active で `expires < 今日(UTC)` は `expired` に遷移して評価しない。confirmed への昇格時も `expires` field と元の値は frontmatter に残し、null化・削除・再計算をしないが、matcher と cleanup は confirmed の `expires` を常に無視する。
- `tool` は完全一致、`*` は Bash/Edit/Write 全対象。
- `pattern` は tool input の対象文字列へ正規表現で評価する。Bash は `command`、Edit は `old_string + "\n" + new_string`、Write は `content`。対象文字列は最大20,000文字に切る。
- `scope` は Edit/Write の project-relative POSIX path にだけ適用し、Bash では無視する。glob は `*`, `**`, `?` のみを実装する。
- match は `last_fired` 降順(null は末尾)→`created` 降順→`id` 昇順で、config `max_injections`(既定3、1〜10)まで。
- output は `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": "..." } }`。各本文に `[raphael:<id>]` 見出しを付け、合計9,000文字で安全に切り詰める。
- 非マッチ時、無効 regex しかない場合、stdin/config/store が壊れた場合は完全無出力。

### management CLI

`update-antibody.mjs` は次の operation を提供し、request body は stdin JSON、result/error は stdout JSON とする。exit code は **0=成功(対象なし・confirmedへのextend no-opを含む)、1=実行時/I/Oエラー(読取不能、atomic rename失敗等)、2=呼び出し/validationエラー(未知operation、引数不足、不正JSON、schema違反、not found、既存ID衝突)** に固定する。`list-antibodies.mjs` も 0=成功、1=I/Oエラー、2=引数エラーを使う。

- `create`: draft から新規抗体を atomic 作成。既存 ID は拒否。
- `patch <id>`: trigger/body/source の部分更新。`--dry-run` は書き込まない。
- `set-status <id> <active|expired|confirmed>`
- `extend <id>`: `last_fired + default_expiry_days`、ただし `created + 90日` を上限とする。
- `record-fire <id>`: fired +1、last_fired=今日。hook 内部は同じ store 関数を直接使い、子 process は起動しない。
- `mark-distilled`: stdin の `{ ids: string[] }` を感染 JSONL に反映する。

`list-antibodies.mjs` は human table(既定)と `--json` を提供し、`--status`、`--id`、`--include-body` を受ける。JSON mode は command / synthesizer の安定契約とする。

---

# WBS

## Phase 1: Foundation

### Task 1: ベースライン確認と plugin scaffold

**目的**

新規 plugin を workspace に認識させ、後続の source/test を追加できる最小骨格を作る。build entry が未作成 source を参照して途中の `pnpm build` を壊さないよう、この時点では build script を登録しない。

**対象ファイル**

- Create: `plugins/raphael/.claude-plugin/plugin.json`
- Create: `plugins/raphael/package.json`
- Create: `plugins/raphael/src/testing/run-ts.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`(`pnpm install` の結果)

**実装要点**

- manifest: name `raphael`、version `0.1.0-dev`。
- package: name `raphael-scripts`、version `0.1.0-dev`、private、type module。build script は Task 11 で追加。
- Task 2〜10 の `src/` は scripts 未生成の source-only 中間状態として実装する。Task 11 の一括 build まで配布可能・実装完了とはみなさず、Task 11 の生成物追加を必須の後続作業として追跡する。
- `run-ts.ts` は pitcrew の同期 helper を踏襲する。

**完了条件**

- 着手前 `pnpm test && pnpm lint && pnpm typecheck` の baseline を記録する。既存失敗があれば変更せず上流報告する。
- `pnpm install` 後、lockfile に workspace package が反映される。
- 既存 test/lint/typecheck が通る。

**想定担当:** GPT Terra(通常)

---

### Task 2: 共通 type・config・hook I/O・atomic I/O

**目的**

schema と設定値をコード上の唯一の契約にし、すべての hook/CLI が共有する安全な I/O 基盤を作る。

**対象ファイル**

- Create: `plugins/raphael/src/lib/types.ts`
- Create: `plugins/raphael/src/lib/atomic.ts`
- Create: `plugins/raphael/src/lib/hook-io.ts`
- Create: `plugins/raphael/src/lib/config.ts`
- Test: `plugins/raphael/src/lib/__test__/atomic.test.ts`
- Test: `plugins/raphael/src/lib/__test__/hook-io.test.ts`
- Test: `plugins/raphael/src/lib/__test__/config.test.ts`

**実装要点**

- この計画の Infection/State/Antibody/HookInput/Config type を `types.ts` に定義する。
- **Task 2 の `RaphaelConfig` と次の key 一覧を設定契約の唯一の確定源とする。Task 3〜10 は独自 key/default を仮定・追加せず、変更が必要なら先に Task 2 の契約とテストを更新する。**
- config は `.claude/raphael.local.md` の flat frontmatter を読み、次の key だけを受理する。
  - `detect_command_failure: boolean`(既定 true)
  - `detect_retry_loop: boolean`(既定 true)
  - `detect_user_rejection: boolean`(既定 true)
  - `detect_edit_churn: boolean`(既定 true)
  - `retry_threshold: integer`(既定3、範囲2〜10)
  - `edit_churn_threshold: integer`(既定3、範囲2〜10)
  - `distill_threshold: integer`(既定3、範囲1〜100)
  - `default_expiry_days: integer`(既定30、範囲1〜365)
  - `max_injections: integer`(既定3、範囲1〜10)
  - `rejection_patterns: string[]`(既定[]、組み込みへ追加)
  - `benign_exit1_commands: string[]`(既定[]、組み込みへ追加)
  - `antibodies_git_policy: "commit" | "ignore"`(既定 `commit`。README/review案内に使うだけで、hookは`.gitignore`を自動変更しない。infections/state/logはこの値にかかわらず常にignore推奨)
- 配列は JSON array syntax のみを許可する。壊れた値は field 単位で上記 default に戻し、未知 key は無視する。
- hook project dir は `CLAUDE_PROJECT_DIR` → stdin.cwd → `process.cwd()`。
- error log は `.raphael/log/errors.log`。ログ失敗も握り潰す。

**完了条件**

- atomic overwrite 後に temp file が残らない。
- 不正 stdin は null、不正 config は default、未知 key は無視される。
- config の regex array にカンマ・バックスラッシュを含めても JSON として往復する。
- 対象 unit test、lint、typecheck が通る。

**想定担当:** GPT Terra(通常)

---

### Task 3: 感染 JSONL store と session state store

**目的**

schema v1 の validation、redaction、append/rewrite、session scratch の上限管理を一箇所へ閉じ込める。

**対象ファイル**

- Create: `plugins/raphael/src/lib/redact.ts`
- Create: `plugins/raphael/src/lib/infection-store.ts`
- Create: `plugins/raphael/src/lib/state-store.ts`
- Test: `plugins/raphael/src/lib/__test__/redact.test.ts`
- Test: `plugins/raphael/src/lib/__test__/infection-store.test.ts`
- Test: `plugins/raphael/src/lib/__test__/state-store.test.ts`

**実装要点**

- JSONL は空行/壊れた行/未知 schema を個別 skip し、有効行を失わない。
- append は既存有効+無効 raw 行を保持して temp→rename する。mark-distilled は有効対象行だけを書き換える。
- infection ID generator、session filename の SHA-256 hash、`last_distill_nag_digest` の SHA-256 helper を実装する。
- state は load 時に validation し、壊れていれば current session の初期値へ戻す。`next_event_seq` の採番・保存も state store の責務とする。
- recent_commands 20、recent_edits 50、injected は antibody ID でコアレスする。
- churn footprint 復元失敗(`new_string` が空/複数一致、file read不能、project外path)は別 kind を作らず、その Edit を recent_edits と churn count の両方から除外する。一方、last_tool の input_digest は UserPromptSubmit との関連付け用に更新してよい。

**完了条件**

- schema の4 kind が serialize/parse できる。
- secret-like command/prompt が保存前に redaction される。
- 途中に壊れた JSONL 行があっても前後の有効 record を読める。
- mark-distilled で `distilled=true` と `distilled_at` が対象 ID だけ更新される。
- session 変更で state が reset され、`next_event_seq` が初期化される。同一秒内の別々の同型 event は dedupe されず、同じ tool_use_id の再送だけが dedupe される。
- footprint 復元不能な Edit は感染 record/recent_edits を増やさず、last_tool 以外に副作用を持たない。
- 対象 unit test、lint、typecheck が通る。

**想定担当:** GPT Sol(複雑: schema/I/O 整合性)

## Phase 2: Infection detection

### Task 4: 純粋な検知 algorithm

**目的**

hook から分離した決定的 detector を実装し、境界・誤検知を unit test で固定する。

**対象ファイル**

- Create: `plugins/raphael/src/lib/detect-command.ts`
- Create: `plugins/raphael/src/lib/detect-rejection.ts`
- Create: `plugins/raphael/src/lib/detect-edit-churn.ts`
- Test: `plugins/raphael/src/lib/__test__/detect-command.test.ts`
- Test: `plugins/raphael/src/lib/__test__/detect-rejection.test.ts`
- Test: `plugins/raphael/src/lib/__test__/detect-edit-churn.test.ts`

**実装要点**

- 確定設計 E の実測 payload 契約どおり、数値/10進整数 string の `tool_response.exit_code`→`exitCode`→`code`、次に error string から exit code を抽出する。PostToolUse の exit code 不明は failure 扱いしない。
- 最終 benign exit-1 リスト、command normalization、3連続 failure を実装する。
- 確定設計 A の最終日本語10/英語9 pattern と config 追加 pattern を実装する。invalid config regex は個別 skip。
- Edit footprint は post-edit file 中の unique `new_string` だけを採用する。重複/空/範囲不明は null。
- overlap は閉区間 `[start,end]` の交差で判定する。

**完了条件**

- `grep/rg/diff/test/[` 等の exit1 が除外され、exit2 は除外されない。
- 同一 normalized command の連続失敗3回だけ retry-loop。間に成功/別 command が入ると reset。
- `違うファイルを検索して` のように先頭 rejection でない文を誤検知しない。
- `違う。戻して`、`No, that's wrong`、`please undo the last change` は検知する。
- unique `new_string` から正しい行区間を得て、重なる3編集だけ churn を返す。
- 対象 unit test、lint、typecheck が通る。

**想定担当:** GPT Sol(複雑: detector 境界と偽陽性設計)

---

### Task 5: `detect-infection` hook と hook 配線前半

**目的**

PostToolUse/PostToolUseFailure/UserPromptSubmit の stdin を detector と store へ結線し、感染記録と state の一貫した副作用を作る。

**対象ファイル**

- Create: `plugins/raphael/src/detect-infection.ts`
- Test: `plugins/raphael/src/__test__/detect-infection.test.ts`
- Create: `plugins/raphael/hooks/hooks.json`(detect event だけを先行登録)

**実装要点**

- hooks は次を登録する。
  - `PostToolUse` matcher `Bash|Edit|Write`
  - `PostToolUseFailure` matcher `Bash`
  - `UserPromptSubmit` matcher なし
- Bash failure は `PostToolUseFailure` を正経路とし、PostToolUse は確定設計 E の field/型規則で明示 exit code を取得できた場合のみ failure 判定する。
- Bash failure ごとに recent_commands を更新し、3連続時は command-failure に加えて retry-loop を記録する。
- Edit/Write は last_tool を更新するが、churn detector は Edit だけ。
- UserPromptSubmit は `prompt` field(実 payload の候補 key は `prompt`→`user_prompt`)を読み、直前の state.last_tool を details に添える。
- detector 無効設定、対象外 tool、壊れた stdin は無出力 exit 0。

**完了条件**

- fixture stdin から4 kind の感染 record が生成される。
- command failure benign exclusion はファイルを作らない。
- 同一 hook input の二重実行が best-effort dedupe される。
- stdout は全ケース空で、壊れた stdin でも process が成功する。
- state history 上限と last_tool 更新が観測できる。
- `hooks.json` の command は `${CLAUDE_PLUGIN_ROOT}/scripts/detect-infection.mjs` を参照する。
- 対象 hook I/O test、lint、typecheck が通る。

**想定担当:** GPT Terra(通常)

## Phase 3: Antibody store and inoculation

### Task 6: 抗体 frontmatter parser / serializer / validator

**目的**

抗体 Markdown を機械側が安全に読み書きできる限定 YAML frontmatter 実装と schema validation を作る。

**対象ファイル**

- Create: `plugins/raphael/src/lib/frontmatter.ts`
- Create: `plugins/raphael/src/lib/antibody-store.ts`
- Test: `plugins/raphael/src/lib/__test__/frontmatter.test.ts`
- Test: `plugins/raphael/src/lib/__test__/antibody-store.test.ts`

**実装要点**

- parser/serializer は抗体 schema の固定形だけを扱う。任意 YAML parser は作らない。
- 必須: id, created, source, trigger.event/tool/pattern, status, stats.fired/last_fired, expires、本文非空。
- optional: trigger.scope。status は active/expired/confirmed。
- 抗体 ID は `ab-YYYY-MMDD-NNN` に固定する。作成日のローカル日付を `YYYY-MMDD` とし、`.raphael/antibodies/ab-YYYY-MMDD-*.md` の有効ID最大連番+1を3桁zero-padする(例 `ab-2026-0724-001`)。同日999件を超えた場合は validation error とし、IDを再利用しない。採番後のatomic createで既存衝突が起きた場合は最新一覧を再読して最大3回まで再採番し、それでも衝突すればI/O errorにする。
- pattern 最大1,000文字、本文最大9,000文字、source 最大500文字。`source` はスペックどおり由来種別を制限しない自由文字列であり、500文字はファイル肥大化を防ぐ長さ上限だけで、enum化・prefix制約はしない。invalid regex は validation error。
- confirmed へのstatus更新でも expires field/valueを保持する。confirmedの期限無視は matcher/cleanup の責務であり、serializerは null化しない。
- serializer は key 順を固定し、pattern/scope/source は JSON string quote して round-trip を保証する。
- list は不正ファイルを `errors` として返し、有効抗体の利用を継続する。

**完了条件**

- 設計書の抗体例が parse→serialize→parse で等価になる。
- quote、backslash、colon、`#`、空 scope、null last_fired を正しく扱う。
- invalid status/tool/regex/本文空を拒否する。
- `ab-YYYY-MMDD-NNN` の日次採番、既存最大値+1、衝突再試行、999件上限を検証する。
- atomic create/patch と、既存 ID 上書き拒否を検証する。
- confirmed への往復で expires のbyte-level値が保持される。
- 対象 unit test、lint、typecheck が通る。

**想定担当:** GPT Sol(複雑: 限定 YAML と更新不変条件)

---

### Task 7: trigger matcher・expiry・selection

**目的**

PreToolUse の高速で決定的な抗体選択を純粋関数として実装する。

**対象ファイル**

- Create: `plugins/raphael/src/lib/match-antibody.ts`
- Test: `plugins/raphael/src/lib/__test__/match-antibody.test.ts`

**実装要点**

- tool input 対象文字列、scope glob、status/expiry、sort、limit、9,000文字 rendering を分離する。
- expired active は `antibody-store` の status update 対象 ID として返し、matcher 自身は I/O しない。
- glob は project-relative POSIX path に対する anchored regex へ変換する。`**/` は0階層も許可する。
- regex は抗体単位で try/catch。1件の壊れた pattern で全体を失敗させない。

**完了条件**

- Bash/Edit/Write/*、scope match/miss、Bash scope ignore、project 外 path、active/confirmed/expired を網羅する。
- 最大3件・last_fired 新しい順・tie-break が仕様どおり。
- invalid regex を skip し、他の抗体は発火する。
- 9,000文字以下で抗体境界と ID が分かる context を生成する。
- 対象 unit test、lint、typecheck が通る。

**想定担当:** GPT Terra(通常)

---

### Task 8: `inoculate` hook

**目的**

PreToolUse stdin を抗体 matcher へ結線し、発火時だけ additionalContext と統計更新を行う。

**対象ファイル**

- Create: `plugins/raphael/src/inoculate.ts`
- Test: `plugins/raphael/src/__test__/inoculate.test.ts`
- Modify: `plugins/raphael/hooks/hooks.json`(PreToolUse 追加)

**実装要点**

- PreToolUse matcher は `Bash|Edit|Write`。
- match した抗体だけ `record-fire` 相当の store 関数で fired/last_fired を atomic 更新し、state.injected を更新する。
- stats update に失敗した抗体は context へ注入しない。I/O 成功済みの抗体だけを output に含める。
- expired active は best-effort で status=expired に更新する。
- output の `hookEventName` は `PreToolUse` 固定。

**完了条件**

- 単一/複数 match の additionalContext JSON、順序、limit を hook I/O test で検証する。
- non-match、抗体0件、invalid stdin、invalid antibody、project 外 Edit/Write は完全無出力。
- fired +1、last_fired、state.injected が成功時だけ更新される。
- 「沈黙の正しさ」を専用 test 名で明示する。
- 対象 hook I/O test、lint、typecheck が通る。

**想定担当:** GPT Terra(通常)

## Phase 4: Distillation control and management

### Task 9: Stop cleanup / distill-needed hook

**目的**

未蒸留 record が閾値に達した時だけ synthesizer 起動を差し戻し、古い処理済み record と抗体期限を掃除する。

**対象ファイル**

- Create: `plugins/raphael/src/check-distill-needed.ts`
- Test: `plugins/raphael/src/__test__/check-distill-needed.test.ts`
- Modify: `plugins/raphael/hooks/hooks.json`(Stop 追加)

**実装要点**

- `stop_hook_active` は即時無出力。
- 全 session file の未蒸留 record を列挙し、threshold 未満は無出力。
- threshold 以上かつ、未蒸留 ID をコードポイント昇順→NUL区切り→UTF-8→SHA-256 lowercase hex にした digest が state.last_distill_nag_digest と異なる時だけ差し戻し候補とする。
- **順序と復帰:** (1) cleanupを完了、(2) reasonをメモリ上で完成、(3) `last_distill_nag_digest` を更新した state 全体を temp→rename でatomic保存、(4) 保存成功後にだけ `{decision:"block",reason}` を stdout へ1回出す。state保存に失敗した場合は stdoutを完全無出力にしてexit 0のフェイルオープンとし、旧digestを維持するため次回Stopで再試行できる。stdout write失敗は復旧不能だが、digest保存済みのため同一集合を自動再blockせず、次の新規infectionでdigestが変わった時に再通知する。
- reason は `Agent` で `raphael:antibody-synthesizer` を起動すること、対象 project、`list-antibodies.mjs --json --include-body` と `update-antibody.mjs` の絶対 plugin path、未蒸留件数を含む。感染内容そのものは reason に展開しない。
- 14日より古い distilled record を削除し、空になった session file は削除する。
- active で expires を過ぎた抗体を expired にする。
- 注入後成功フィードバックの判断は synthesizer が state.injected と current session infections を読む。hook は判断しない。

**完了条件**

- threshold 未満/到達、stop_hook_active、SHA-256 digest の決定性、同一 digest 再停止、新規 infection 追加後の再通知を検証する。
- state atomic保存失敗時はblock JSONを出さず、旧digestのままで次回再試行できることを故障注入で検証する。
- output は task-utility と同じ `decision:block` / `reason` 契約。
- 14日境界、壊れた JSONL、空 file cleanup を検証する。
- reason に infection evidence や secret が含まれない。
- 対象 hook I/O test、lint、typecheck が通る。

**想定担当:** GPT Sol(複雑: Stop lifecycle・nag-once・cleanup)

---

### Task 10: list/update management CLI

**目的**

command と synthesizer が共有する唯一の読み取り/更新 interface を実装し、LLM の手書き編集を排除する。

**対象ファイル**

- Create: `plugins/raphael/src/list-antibodies.ts`
- Create: `plugins/raphael/src/update-antibody.ts`
- Test: `plugins/raphael/src/__test__/list-antibodies.test.ts`
- Test: `plugins/raphael/src/__test__/update-antibody.test.ts`

**実装要点**

- CLI contract は「確定設計 E」に従う。
- project dir は `--dir` を受け、省略時は `CLAUDE_PROJECT_DIR`→cwd。
- stdout JSON は `{ok:true,...}` / `{ok:false,error:{code,message,field?}}`。human list だけ table text。
- exit code は確定設計 E の体系を共通利用する: 0=成功/no-op、1=I/O/実行時エラー、2=引数・JSON・schema・not found・既存ID衝突などの呼び出し/validationエラー。stderrへ診断を重複出力せず、machine-readable errorはstdout JSONに一本化する。
- patch dry-run は normalized 完成形と diff summary を返す。
- status transition は active↔expired、active/expired→confirmed、confirmed→active/expired を許可する。
- extend は confirmed には no-op success、active/expired は status active に戻して期限を計算する。

**完了条件**

- 全 operation の成功/validation failure/not found/dry-run/no overwriteを子process testで検証し、それぞれ exit 0/1/2 の分類をassertする。
- list JSON の sort/filter/body inclusion が安定する。
- mark-distilled が infection store を正しく更新する。
- invalid request で対象 file の byte content が変わらない。
- 対象 CLI test、lint、typecheck が通る。

**想定担当:** GPT Terra(通常)

---

### Task 11: build pipeline と全 hook bundle

**目的**

codiel と同じ TS→`scripts/*.mjs` 配布構成を完成させ、source と bundle の挙動を一致させる。

**対象ファイル**

- Create: `plugins/raphael/build.ts`
- Modify: `plugins/raphael/package.json`(`scripts.build` 追加)
- Generate: `plugins/raphael/scripts/detect-infection.mjs`
- Generate: `plugins/raphael/scripts/inoculate.mjs`
- Generate: `plugins/raphael/scripts/check-distill-needed.mjs`
- Generate: `plugins/raphael/scripts/list-antibodies.mjs`
- Generate: `plugins/raphael/scripts/update-antibody.mjs`

**実装要点**

- esbuild: bundle, platform node, format esm, target node26, outExtension `.mjs`, sourcemap false, outdir scripts。
- Task 2〜10 の source-only 中間状態をここで解消し、5 entry を初回一括bundleする。以後のsource変更は同一タスク内で再buildする。
- lib の単独 bundle は作らず、5 entry に内包する。
- scripts の shebang が必要なら entry source の先頭へ置き、bundle output で保持されることを確認する。
- Task 5/8/9 で段階的に編集した `hooks/hooks.json` をここで最終契約として再検証する。最終版は `PostToolUse(Bash|Edit|Write)`、`PostToolUseFailure(Bash)`、`UserPromptSubmit`→`detect-infection.mjs`、`PreToolUse(Bash|Edit|Write)`→`inoculate.mjs`、`Stop`→`check-distill-needed.mjs` を各1回だけ登録し、全commandが `${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs` を参照する。重複event/matcher/command、欠落entry、`dist/`参照を禁止する。

**完了条件**

- `pnpm build` が成功し5 bundle が生成される。`dist/` は存在しない。
- build を2回行って差分が増えない。
- source hook I/O fixture の代表ケースを bundle にも stdin で流し、同じ stdout/side effect を得る。
- `hooks.json` をJSON parseし、上記最終event matrix、各登録1回、全script存在、commandとのbasename一致を自動testまたは検証scriptで確認する。
- `pnpm test && pnpm lint && pnpm typecheck` が通る。

**想定担当:** GPT Luna(軽量: 定型 build 設定・生成確認)

## Phase 5: LLM synthesis and user review

### Task 12: `antibody-synthesizer` agent

**目的**

未蒸留 infection を低コストで選別し、management CLI だけを使って抗体作成/修正/失効/延長/mark を行う agent prompt を実装する。

**対象ファイル**

- Create: `plugins/raphael/agents/antibody-synthesizer.md`

**実装要点**

- model は低コスト側を選ぶが、具体 model はリポジトリの agent frontmatter 慣習を確認して設定する。
- allowed tools は Read/Bash に絞り、Edit/Write で抗体を直接触ることを禁止する。
- 必須フロー:
  1. 未蒸留 infection JSONL を読む。
  2. `list-antibodies.mjs --json --include-body` で既存を読む。
  3. 「次回知らないと同じ失敗をするか」で選別。
  4. 同一 trigger は extend、同型別対象は patch 汎化、新規は create、悪い抗体は patch/expired。
  5. 対象 infection は採用/非採用にかかわらず、判断完了後に mark-distilled。
- injected 抗体と同 session infection の突き合わせで、成功なら extend、再発なら pattern 修正/失効を検討する。
- patch/create 前に dry-run を必須とする。

**完了条件**

- prompt に Anthropic API や CLI 直接操作をユーザーへ要求する記述がない。
- 抗体/感染 record の直接編集を禁止し、全更新 operation が management CLI に対応する。
- duplicate/extend/generalize/new の判断表、90日上限、confirmed 不変、非採用 mark を明記する。
- path は `${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs` を使う。
- Markdown/frontmatter の形式検査が通る。

**想定担当:** GPT Sol(複雑: 蒸留判断プロトコル)

---

### Task 13: `/raphael:review` command

**目的**

確定した UI flow を command prompt として実装し、confirmed 昇格・却下・安全な編集を対話的に提供する。

**対象ファイル**

- Create: `plugins/raphael/commands/review.md`

**実装要点**

- 「確定設計 D」の全 step と AskUserQuestion option を明記する。
- queue mode の対象は開始時点の active 抗体 snapshot とし、`stats.last_fired` 降順(nullは末尾)→`created` 降順→`id` 昇順に固定する。各操作後も同じsnapshot順を維持し、途中で新規作成/更新された抗体は次回 `/raphael:review` で扱う。ID mode と confirmed/expired 指定 mode は一覧のgroup sort(active→confirmed→expired、group内は同順)を使う。
- Bash で使えるのは list/update scripts の呼び出しだけ。抗体 file を Read して表示する場合も更新は CLI に限定する。
- destructive delete は提供しない。却下は expired。
- cancel は一切変更なし。empty/invalid input は再質問または skip し、推測で更新しない。
- queue mode の summary を定義する。

**完了条件**

- zero/queue/id/edit/cancel/error の全 branch が prompt から一意に追える。
- 承認、却下、trigger edit、body edit、dry-run confirmation の command line/JSON input が Task 10 の CLI 契約と一致する。
- `confirmed` のみ期限評価なしであり、expires field/value自体は残して無視する説明がある。
- queue mode の snapshot と `last_fired`→`created`→`id` の順序が一意に記載される。
- command Markdown/frontmatter の形式検査が通る。

**想定担当:** GPT Terra(通常)

---

### Task 14: raphael skill

**目的**

メインエージェントへ動作モデル、Stop 差し戻し時の synthesizer 起動、review 利用時の契約を小さく提供する。

**対象ファイル**

- Create: `plugins/raphael/skills/raphael/SKILL.md`

**実装要点**

- 日常セッションで常時ロードする大量マニュアルにしない。trigger description は Stop reason / infection distillation / review の具体語を中心にする。
- 感知/蒸留/接種の3段、API不使用、決定的 hook、`.raphael/` の保存方針を説明する。
- Stop reason が指定する agent を起動し、同一未蒸留集合で繰り返さないことを明記する。

**完了条件**

- skill が設計書の責務境界を変えない。
- API/client/key を要求しない。
- command/agent/script 名が実装と一致する。
- skill Markdown/frontmatter の形式検査が通る。

**想定担当:** GPT Luna(軽量)

## Phase 6: Documentation, registration, verification

### Task 15: README / DESIGN / ignore policy documentation

**目的**

利用者と保守者へ導入、データライフサイクル、設定、安全性、手動検証を文書化する。

**対象ファイル**

- Create: `plugins/raphael/README.md`
- Create: `plugins/raphael/DESIGN.md`

**実装要点**

- README: install、再起動、`.gitignore` 推奨、設定 template、`/raphael:review`、データ保存先、トラブル時フェイルオープン。
- 推奨 ignore:
  - `.raphael/infections/`
  - `.raphael/state.json`
  - `.raphael/log/`
  - `.claude/raphael.local.md`
  - `.raphael/antibodies/` は ignore せず commit 推奨。
- DESIGN は承認スペックを実装後の正確な component/file/CLI schema に同期する。承認済み design の意味を変更しない。
- infection に command/prompt excerpt が入ること、secret redaction は best-effort であり commit 禁止であることを明記する。

**完了条件**

- config の全 key、default、日英追加 pattern、benign commands の追加方法が例示される。
- src→scripts、生成物 git 管理、dist 不使用が記載される。
- manual scenario 3件と、bundle smoke の実行方法が記載される。
- docs 内の path/version/script 名が実物と一致する。

**想定担当:** GPT Terra(通常)

---

### Task 16: Marketplace / root README 登録

**目的**

新 plugin を配布一覧へ公開し、リポジトリ全体から発見可能にする。

**対象ファイル**

- Modify: `.claude-plugin/marketplace.json`
- Modify: `README.md`

**実装要点**

- marketplace に name/source/description を追加する。
- root README の表と plugin 紹介節に raphael を追加する。
- manifest/package は `0.1.0-dev` のまま。新規 plugin のため追加 bump はしない。

**完了条件**

- JSON が parse でき、source directory と manifest name が一致する。
- root README の一覧と詳細に raphael がある。
- plugin description が「失敗を感染記録→抗体→発火時だけ注入」と分かる。

**想定担当:** GPT Luna(軽量)

---

### Task 17: 全自動検証と hook I/O matrix

**目的**

unit、hook source、bundle、repository regression を一括検証し、実装完了の客観的証拠を作る。

**対象ファイル**

- Modify if needed: `plugins/raphael/src/**/__test__/*.test.ts`
- Verify: `plugins/raphael/scripts/*.mjs`
- Verify: repository root configs and lockfile

**検証 matrix**

1. Unit: atomic/config/redaction/JSONL/state/frontmatter/detectors/matcher/store。
2. Detect hook I/O: 4 kinds、最終 benign list、exit-code field/type、同一秒別event、dedupe、invalid stdin、disabled setting。
3. Inoculate hook I/O: one/many/limit/scope/expiry/confirmed expires保持/stat update/non-match silence/error silence。
4. Stop hook I/O: threshold/nag-once/SHA-256 digest/state保存故障時の再試行/new digest/cleanup/stop_hook_active/error silence。
5. CLI I/O: list JSON/human、ID採番、create/patch dry-run/status/extend/fire/mark、exit 0/1/2、invalid no-write。
6. hooks manifest: 最終event matrix、重複なし、全commandのbundle存在・basename一致。
7. Bundle smoke: 上記各 hook/CLI の代表 fixture を `node scripts/*.mjs` に流す。

**完了条件**

- `pnpm build` 成功。
- `pnpm test` 全件成功。
- `pnpm lint` 成功。
- `pnpm typecheck` 成功。
- `git diff --check` 成功。
- `find plugins/raphael -type d -name dist` が0件。
- scripts は最新 source から再生成済みで、二度目 build 後に追加差分なし。Task 2〜10 の source-only 中間状態が残っていない。
- hooks.json の最終event matrixがTask 11の契約どおりで、重複登録・欠落・存在しないscript参照がない。
- 検証結果の command、exit code、test 件数を上流報告に記録する。

**想定担当:** GPT Terra(通常)

---

### Task 18: 手動 end-to-end 検証

**目的**

Claude Code hook/Stop/command/agent の実環境統合を、自動 fixture では確認できない利用者視点で検証する。

**対象ファイル**

- No code change expected
- Test project の `.raphael/**` と `.claude/raphael.local.md`

**手動シナリオ**

1. 同じ非 benign Bash を3回失敗させ、command-failure + retry-loop が記録される。
2. Stop で1度だけ block され、antibody-synthesizer が起動し、infection が distilled になり抗体が生成/更新される。
3. 次 session の同型 PreToolUse で `[raphael:<id>]` context が注入され、非一致 command は無注入。
4. `/raphael:review` で confirmed、expired、trigger/body edit、cancel を確認する。
5. 期限切れ active と14日超 distilled cleanup を fixture date または既存 file で確認する。

**完了条件**

- 3つの設計書必須 scenario と review/expiry lifecycle が実環境で観測できる。
- hook error や抗体不正時にも通常操作が継続する。
- 手動でのみ確認した事項を自動検証済みと混同せず報告する。

**想定担当:** GPT Sol(複雑: 複数コンポーネント統合)

## Dependency / Dispatch Order

```text
Task 1
  → Task 2
      → Task 3
          → Task 4 → Task 5
          → Task 6 → Task 7 → Task 8
          → Task 9
          → Task 10
Task 5 + 8 + 9 + 10 → Task 11
Task 10 + 11 → Task 12 + Task 13 (並列可)
Task 11 → Task 14 + Task 15 + Task 16 (並列可)
Task 12〜16 → Task 17 → Task 18
```

- Task 4 と Task 6 は Task 3 完了後に並列化できる。
- Task 9 と Task 10 は Task 3/6 の必要 interface が確定後に並列化できる。
- 実装担当へは context-map 全文を渡さず、該当 Task の Global Constraints・確定設計断片・対象 file・完了条件だけを brief に転記する。

## Task Summary

| Phase | Tasks | 主な成果 |
|---|---:|---|
| 1. Foundation | 1〜3 | scaffold、config/I/O、感染/state schema |
| 2. Infection detection | 4〜5 | 4種 detector と detect hook |
| 3. Antibody/inoculation | 6〜8 | 抗体 store、matcher、PreToolUse 注入 |
| 4. Distillation/management | 9〜11 | Stop 差し戻し、CLI、bundle |
| 5. LLM/review | 12〜14 | synthesizer、review command、skill |
| 6. Docs/release/verify | 15〜18 | docs、marketplace、全自動/手動検証 |

合計 **18 Tasks / 6 Phases**。

## Approval Gate / Known Concerns

- 実装移行は最上位オーケストレーターの Approve 後とする。
- 計画では、設計書の PostToolUse 表記を既存実測契約に合わせて `PostToolUseFailure(Bash)` 追加として具体化した。これは command failure 検知成立のための重要判断である。
- atomic rename は torn write を防ぐが、複数 session の read-modify-write lost update は防がない。v0.1 の単一 session 制約として受け入れる。
- edit churn は hook input に行番号がないため、unique `new_string` の post-edit file 内位置から footprint を復元する。復元不能時は検知しないため偽陰性が残る。
- secret redaction は best-effort である。infections/state/log を commit しない運用が主防御となる。
- Haikuレビューは完了し、本計画へ内部矛盾・未定義契約の指摘を反映済み。実装移行前には戦術オーケストレーターの補足確認と最上位オーケストレーターのApproveを経る。
