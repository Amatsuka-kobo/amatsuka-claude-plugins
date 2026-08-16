`plugins/raphael` (0.1.1-dev) — a failure-immune system: accumulate failure signals, distill them
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
2. `Stop` → `check-distill-needed.mjs` nudges when undistilled records reach `distill_threshold`
   (default 3), and cleans distilled records older than 14 days. Distillation is the **only** LLM
   step, done by the `antibody-synthesizer` subagent (tools `Read, Bash` — it must go through the
   management CLI, never edit antibody files directly).
3. `PreToolUse` (Bash|Edit|Write) → `inoculate.mjs` evaluates `active`/`confirmed` antibodies and
   injects at most `max_injections` (default 3) bodies as `additionalContext`, headed `[raphael:<id>]`,
   updating `stats.fired` / `last_fired`.

## Data & CLI

`.raphael/antibodies/<id>.md` — Markdown + YAML frontmatter (`id` = `ab-YYYY-MMDD-NNN`, `trigger`
{event, tool, pattern, scope}, `status`, `stats`, `expires`). Validated at runtime by
`plugins/raphael/src/lib/frontmatter.ts` (id/date/tool/status checks) — the former mdbase
`_types/antibody.md` schema was retired in 2026-08 (`mem:core`). `trigger.scope` applies to Edit/Write POSIX paths only, ignored for
Bash. **Antibodies are meant to be committed** (shared prevention asset); `infections/`, `state.json`,
`log/` and `.claude/raphael.local.md` must be gitignored — infections contain raw failed commands
and prompt excerpts, and redaction is best-effort only.

Never hand-edit an antibody: `list-antibodies.mjs` reads, `update-antibody.mjs` writes (JSON patch,
supports `--dry-run`). `/raphael:review` drives approve (`confirmed`) / reject (→ `expired`, file
kept) / edit through those two only.

## Config & failure posture

`.claude/raphael.local.md`, flat frontmatter, allow-listed keys; an invalid value falls back per
key, not wholesale. Keys: the four `detect_*` toggles, `retry_threshold`, `edit_churn_threshold`,
`distill_threshold`, `default_expiry_days`, `max_injections`, `rejection_patterns` (**adds to** the
built-in vocabulary), `benign_exit1_commands` (adds to built-ins `grep`/`rg`/`git grep`/`diff`/
`git diff --quiet`/`cmp`/`test`/`[`; applies to exit code 1 only), `antibodies_git_policy`.

Every hook **fails open**: any error means no injection / no detection / no block — never a broken
turn. Malformed antibody records are skipped individually, not en masse.

This repo dogfoods raphael: `.raphael/antibodies/` is tracked and holds 33 antibodies as of
2026-08-15 (grew from ~18 in late July). Detector ids are `command-failure`, `retry-loop`,
`user-rejection`, `edit-churn` (`src/lib/infection-store.ts`).
