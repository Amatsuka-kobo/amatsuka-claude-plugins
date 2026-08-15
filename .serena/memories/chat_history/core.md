`plugins/chat-history` (0.6.0 — released, non-`-dev`). Persists conversations to `docs/chat/` so future agents
and humans can audit what was decided and why. Split out of `task-utility` in commit 849d3c7;
`gh-utility` took the issue skills. Workspace pkg `chat-history-scripts`. Node stdlib + `git` only.
Rationale: `plugins/chat-history/docs/rationale.md`.

## Model — Stop hook nudges, a background subagent writes

`hooks/hooks.json` has exactly one hook: `Stop` → `scripts/check-chat-recorded.mjs`. It never
blocks the turn; it injects a minimal `additionalContext` (≤1200 chars, values only — the procedure
lives in the agent definition) telling the main agent to dispatch `chat-recorder` in the background.

- **Opt-in**: only fires when the target project has a `docs/chat/` directory.
- **Trigger**: last substantive user message is newer than the recorded line (state file is
  user-local, git-untracked). Works from turn 1; at most one attempt per real message, guarded by a
  lock + attempted-line number.
- `chat-recorder` (model `haiku`, `background: true`, tools `Bash, Write`) runs
  `prepare-chat-recording.mjs` → Write to a temp file → `commit-chat-recording.mjs` (append, INDEX
  update, validation, state commit). It must not Read/Edit existing records or INDEX.md directly.
  It is explicitly told to ignore the project's CLAUDE.md workflow/agent-policy instructions and to
  load no skills — this is both a prompt-injection guard and a cost guard.
- User utterances are extracted verbatim from the raw transcript JSONL, so verbatimness is
  structural rather than a promise the model keeps.

Bundles: `check-chat-recorded.mjs` (the Stop hook), `prepare-chat-recording.mjs`,
`commit-chat-recording.mjs`, `extract-conversation.mjs`, `find-chat-records.mjs`. State resolution
and the legacy-dir migration live in `src/chat-recording-state.ts`.

## Records and index

Path: `docs/chat/YYYY/MMDD/<git user.name>/<kebab-slug>.md`. Same deliverable + same purpose →
append a new session heading to the existing file rather than creating a new one.
`docs/chat/INDEX.md` holds **one line per record file** (path | date | author | one-line gist),
path-ascending, maintained by `commit-chat-recording.mjs`. The canonical format spec is
`skills/chat/SKILL.md` — its body is handed to chat-recorder verbatim at runtime as `skillContract`,
so renaming or dropping a section directly changes recorder output.

## Skills

`chat` (record/append — the auto-record path), `recall` (keyword search over records; candidates via
`find-chat-records.mjs`, reading delegated to the `chat-reader` subagent so the main context stays
clean), `resume` (latest own record → previous progress + carry-over, via
`find-chat-records.mjs --latest` + `chat-reader`).

## Gotchas

- Runtime state/lock live under `~/.claude/chat-history/chat-recorder/`. The old
  `~/.claude/task-utility/chat-recorder/` is migrated automatically by the Stop hook (0.6.0,
  2026-08-05). The migration is split on purpose: `resolveStateRoot()` is a pure read-side resolver
  that **keeps returning the legacy root** until the new one exists, and `migrateLegacyStateDir()`
  does the one-shot rename, called only from the hook (the write entry point). That ordering is
  what prevents a failed rename from reading an empty state and re-recording the whole
  conversation. An explicit `TASK_UTILITY_CHAT_STATE_DIR` opts out of migration entirely.
- Tests in `src/hooks/__test__/` still assert `task-utility:chat-recorder`; that is intentional —
  they guard `hasRunningRecorder`'s normalization (match on the last `:`-segment), which is what
  makes the detector survive the id change.
- Repo `CLAUDE.md` forbids every agent except chat-recorder / chat-reader from reading
  `docs/chat/**` unless the user explicitly asks.
- Background dispatch can stall if `Bash`/`Write` permission prompts are on; the fix is the user's
  `~/.claude/settings.json` `permissions`, never a plugin-side override.
- `skills/chat/SKILL.md` is a runtime contract, not just documentation — its body is handed to
  chat-recorder verbatim, so renaming a section changes recorder output.