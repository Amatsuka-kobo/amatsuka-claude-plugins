`plugins/raphael` (0.2.1-dev) — a failure-immune system: accumulate failure signals, distill them
into "antibodies", and re-inject a preventive instruction **only** when a later tool call matches
the antibody's trigger. Design: `plugins/raphael/DESIGN.md` (at plugin root, not `docs/`).
Workspace pkg `raphael-scripts`. Node stdlib only.

## Why it is shaped this way

The point is to avoid growing a permanently-resident instruction file. Matching is deterministic
regex in a `PreToolUse` hook, so the steady-state context cost of N antibodies is zero, at the price
of accepted false negatives. `confirmed` status does not fix false negatives — it protects a useful
antibody from expiry decay.

## Flow

1. `PostToolUse` / `PostToolUseFailure` (Bash|Edit|Write) / `UserPromptSubmit` →
   `detect-infection.mjs` appends JSONL to `.raphael/infections/session-<sha256(sid)[0:16]>.jsonl`.
   Four detectors: command failure, retry loop (same normalized command), user rejection (JA/EN
   vocabulary, extensible), edit churn (overlapping edits to one file).
2. `Stop` → `check-distill-needed.mjs` nudges when the number of **unresolved recurrence-key kinds**
   reaches `distill_threshold` (default 3), excluding repeated occurrences of the same failure and
   self-resolved infections, and cleans distilled records older than 14 days. The nag digest lives in
   `stats.json` at `distill.last_nag_digest` and suppresses duplicate nudges per project. Distillation
   is the **only** LLM step, done by the `antibody-synthesizer` subagent (tools `Read, Bash` — it must
   go through the management CLI, never edit antibody files directly). Non-adoption splits into two
   kinds: an infection that fails either of the synthesizer's two screening questions carries no
   retained value, while one that passes both but still fails to get a workable trigger pattern
   written for it (including a `PATTERN_TOO_BROAD` rejection) remains valid knowledge. The
   synthesizer distinguishes the two in its final report.
3. `PreToolUse` (Bash|Edit|Write) → `inoculate.mjs` evaluates `active`/`confirmed` antibodies and
   injects at most `max_injections` (default 3) bodies as `additionalContext`, headed `[raphael:<id>]`.
   Fire statistics are recorded in `.raphael/stats.json`; antibody files are not rewritten, and an
   inability to save statistics does not prevent injection.

## Data & CLI

`.raphael/antibodies/<id>.md` — Markdown + YAML frontmatter (`id` = `ab-YYYY-MMDD-NNN`, `trigger`
{event, tool, pattern, scope}, `status`, `expires`, `body`). The allowed keys are only `id`, `created`,
`source`, `trigger`, `status`, `expires`, and `body`; `stats` is not frontmatter. Validated at runtime
by `plugins/raphael/src/lib/frontmatter.ts` (id/date/tool/status checks) — the former mdbase
`_types/antibody.md` schema was retired in 2026-08 (`mem:core`). `trigger.scope` applies to Edit/Write
POSIX paths only, ignored for Bash. **Antibodies are meant to be committed** (shared prevention asset);
`infections/`, `state.json`, `stats.json`, `commands.jsonl`, `log/` and `.claude/raphael.local.md` must
be gitignored — infections contain raw failed commands and prompt excerpts, and redaction is
best-effort only.

`.raphael/stats.json` is a single atomically replaced JSON file holding per-antibody `fired`,
`last_fired`, `misses`, and `last_miss`, plus `distill.last_nag_digest`. Missing or corrupt data is
treated as initial state without throwing; the Stop hook removes orphan entries. `.raphael/commands.jsonl`
records every Bash execution, successful or failed, one line at a time; the Stop hook truncates it to
2,000 lines. It is the population for breadth checks and audit.

Never hand-edit an antibody: `list-antibodies.mjs` reads, `update-antibody.mjs` writes (JSON patch,
supports `--dry-run`). The CLI also provides `migrate-stats` and `audit`; `list-antibodies` supports
`--ineffective`, and `--dry-run` is available for `patch`, `migrate-stats`, and `audit`.
`/raphael:review` drives approve (`confirmed`) / reject (→ `expired`, file kept) / edit / downgrade
(`confirmed` → `active`) through those two only, and can review audit results in sequence.

## Config & failure posture

`.claude/raphael.local.md`, flat frontmatter, allow-listed keys; an invalid value falls back per
key, not wholesale. The 18 keys are the four `detect_*` toggles, `retry_threshold`,
`edit_churn_threshold`, `distill_threshold`, `default_expiry_days`, `max_injections`,
`rejection_patterns` (**adds to** the built-in vocabulary), `benign_exit1_commands`,
`benign_exit1_extended`, `breadth_max_ratio`, `breadth_min_corpus`, `miss_window_minutes`,
`ineffective_min_fired`, `ineffective_miss_ratio`, and `antibodies_git_policy`. The custom
`benign_exit1_commands` list is for exit 1 only. Built-in extended commands (vitest, jest, mocha,
pytest, biome, eslint, prettier, tsc, and scripts named `test`, `lint`, `typecheck`, or `check`) are
normalized before comparison and apply to exit codes 1 and 2; exit codes 130, 137, and 143 are not
failures, while 128 and 129 remain failures.

Recurrence keys are not stored in JSONL: they are computed on read by pure functions
`recurrence.ts:recurrenceKey` and `infection-store.ts:recurrenceKeyOf` from `details`. The `retry-loop`
detector uses the `command-failure` kind label, so both kinds for the same command share one key.
After a failure, a later same-command result with `failed === false && exit_code === 0` marks that
infection `resolved` / `resolved_at`; benign exit 1 / 2 and `exit_code: null` are not success.
`ineffective` is a derived candidate flag, not a status and never auto-transitions: `fired >= 10`
and `misses * 100 >= fired * 50`.

Every hook **fails open**: any error means no injection / no detection / no block — never a broken
turn. Malformed antibody records are skipped individually, not en masse.

This repo dogfoods raphael: `.raphael/antibodies/` is tracked and holds 56 antibodies as of
2026-09-08 (grew from ~18 in late July). Detector ids are `command-failure`, `retry-loop`,
`user-rejection`, `edit-churn` (`src/lib/infection-store.ts`).
