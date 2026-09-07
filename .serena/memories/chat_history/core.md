`plugins/chat-history` (0.8.0 — released, non-`-dev`). Persists conversations to `docs/chat/` so future
agents and humans can audit what was decided and why. Split out of `task-utility` in commit 849d3c7;
`gh-utility` took the issue skills. Workspace pkg `chat-history-scripts`. Node stdlib + `git` only.
Rationale: `plugins/chat-history/docs/rationale.md`.

## Model — Stop hook nudges, a background subagent writes

`hooks/hooks.json` has exactly one hook: `Stop` → `scripts/check-chat-recorded.mjs` (timeout 15).
It never blocks the turn; it injects a minimal `additionalContext` (values only — the procedure
lives in the agent definition) telling the main agent to dispatch `chat-recorder` in the background.

- **Opt-in**: only fires when the target project has a `docs/chat/` directory.
- **Trigger**: last substantive user message is newer than `state.recordedUserTurn` (state file is
  user-local, git-untracked). Works from turn 1; at most one attempt per real message, guarded by a
  lock + `attemptedUserTurn`.
- **Range (0.8.1, 2026-09-07)**: `targetLine = max(lastUserTurn, lastAssistantTurn)`, so the AI
  reply to the last prompt is recorded in the same attempt. Before 0.8.1 the target was
  `lastUserTurn` and records stopped at the last user prompt. `recordedLine` (extraction start) and
  `recordedUserTurn` (new-turn / generation detection) are therefore distinct fields;
  `migrateState` backfills the `*UserTurn` fields from `recordedLine`/`attemptedLine` when missing.
  The hook writes `plan.userTurnLine`; commit stores it as `recordedUserTurn`. Extra AI replies to
  the same prompt (e.g. after a background-task notification) land in the next user turn's range.
- `chat-recorder` (model `haiku`, `background: true`, tools `Bash, Write`) runs
  `prepare-chat-recording.mjs` → Write to temp files → `commit-chat-recording.mjs`. It is
  explicitly told to ignore the project's CLAUDE.md workflow/agent-policy instructions and to load
  no skills — prompt-injection guard + cost guard.

Bundles (1:1 with `src/*.ts`): `check-chat-recorded.mjs`, `prepare-chat-recording.mjs`,
`commit-chat-recording.mjs`, `extract-conversation.mjs`, `find-chat-records.mjs`. State resolution
and the legacy-dir migration live in `src/chat-recording-state.ts`.

## 2026-08-16 — the format flipped from summary to verbatim

Commits d865324, 1913b71, 2febb59, dfecfa7, 5617e85, 271189d (0.6.0 → 0.7.0). This is the single
most load-bearing fact about this plugin:

- **The script writes the body; the model no longer does.** `prepare-chat-recording.ts` extracts the
  turns from the transcript JSONL and writes the whole body to a temp file. `chat-recorder` authors
  exactly four artefacts: the one-line session gist (`sessionTitleFile`), the one-line INDEX gist
  (`indexSummaryFile`), the header on new records only (`headerFile`), and the topic slug on new
  records only (`--record-slug`). It never reads or writes the body.
- User turns: heading `# <作業者名>`, verbatim inside a `>` quote block. AI turns: heading `# AI`,
  verbatim **as plain prose, not quoted**. Only message `text` is kept — **tool-use records and
  thinking blocks are excluded** (1913b71).
- File shape: header (`# <題名>` + 日付/参加者/成果物/前提 + script-added
  `- セッション ID: <session_id>`) → `---` → body split by `## セッション N: <要旨>`.
- **Records are now bimodal and readers must branch on the date.** Pre-2026-08-16 records hold
  *summarized* AI turns inside quote blocks and carry a 「注意事項と次の作業」 section;
  2026-08-16-and-later records hold verbatim prose and have no such section. `agents/chat-reader.md`
  and `skills/resume/SKILL.md` both encode this date branch — resume pulls carry-over items from the
  trailing `# AI` block of the last session in the new format. When quoting an old record, the
  reader must state that the text is a summary. `skills/recall/SKILL.md` has no date branch.
- Session numbering scans the **entire record file** with `/^##\s*セッション\s*(\d+)/gm`, not the
  60-line tail window (5617e85). Verbatim sessions routinely exceed 60 lines, and the old window
  lost the heading and restarted at 1, producing duplicate numbers. `tailContext` (the context
  handed to chat-recorder) is still the 60-line tail — only the numbering changed.
  `commit-chat-recording.ts` additionally validates `plan.sessionNumber` is a positive integer to
  catch a new commit script paired with an old prepare (`## セッション undefined`).

## Records and index

Path: `docs/chat/YYYY/MMDD/<git user.name>/<HHMM>-<kebab-slug>.md`; `YYYY/MMDD` and `HHMM` come
from the session start time in local time, and the script obtains the worker name. **One Claude Code
session equals one record file**: only a continuing/reopened same session appends to its existing
state-selected file; a different session creates a new file even for the same topic. New-file
collisions receive a numeric suffix.

`docs/chat/INDEX.md` holds **one line per record file** (path | date | author | one-line gist),
path-ascending. `chat-recorder` writes only the final gist to `indexSummaryFile`;
`commit-chat-recording.ts` composes the path, `recordDate`, `workerName`, and gist into the INDEX
line. Appending to an existing record re-composes and replaces that line rather than adding one.
The canonical format spec is `skills/chat/SKILL.md` — its body is handed to chat-recorder verbatim
at runtime as `skillContract`, so renaming or dropping a section directly changes recorder output.

## Responsibility split

- `prepare-chat-recording.ts` — picks the target file strictly from the current session's saved
  `state.recordPath`, fixes `sessionNumber`, writes the full body to `bodyFile`, returns
  `skillContract`, and upgrades the hook's v1 plan to v2. The v2 plan supplies script-owned
  `recordTarget`, `allowedNewRecordDir`, `recordFilePrefix`, `recordDate`, `workerName`, and
  `sessionId`. Writes nothing but the plan and temp files.
- `commit-chat-recording.ts` — validates plan schema v2 and its definitive values before using
  `recordTarget`; validates the recorder's `sessionTitleFile` / `indexSummaryFile` / `headerFile`;
  assembles the header (including the session ID), `## セッション {n}: {要旨}`, and body; writes the
  record (`wx` for new, append for existing) and re-composed INDEX.md, verifies, rolls back on
  failure, commits state.
- `find-chat-records.mjs` — `--latest` and INDEX-mode hits are sorted newest-first by record date,
  breaking same-day ties by mtime descending. This keeps path-ascending INDEX order from dropping
  newer records when recall caps results.

## Skills

`chat` (record/append — the auto-record path), `recall` (keyword search; candidates via
`find-chat-records.mjs`, reading delegated to the `chat-reader` subagent so the main context stays
clean), `resume` (latest own record → previous progress + carry-over, via
`find-chat-records.mjs --latest` + `chat-reader`).

## Gotchas

- Runtime state/lock live under `<CLAUDE_CONFIG_DIR|~/.claude>/chat-history/chat-recorder/`. The old
  `task-utility/chat-recorder/` is migrated by `migrateLegacyStateDir()`, called only from the Stop
  hook (the write entry point), while `resolveStateRoot()` is a pure read-side resolver that **keeps
  returning the legacy root** until the new one exists. That ordering is what prevents a failed
  rename from reading empty state and re-recording the whole conversation. An explicit
  `TASK_UTILITY_CHAT_STATE_DIR` (deliberately still the old name) opts out entirely.
- Temp files fall back to `os.tmpdir()/chat-history-recorder-<uid>/<projectKey>/temp` when the
  normal location sits under `CLAUDE_CONFIG_DIR` — Write there is refused as a sensitive path.
- Tests in `src/hooks/__test__/` still assert `task-utility:chat-recorder`; intentional — they guard
  `hasRunningRecorder`'s last-`:`-segment normalization, which is what survives the id change.
- `harness-docs/ARCHITECTURE.md` forbids every agent except chat-recorder / chat-reader from reading
  `docs/chat/**` (INDEX.md included) unless the user explicitly asks.
- Background dispatch can stall if `Bash`/`Write` permission prompts are on; the fix is the user's
  `~/.claude/settings.json` `permissions`, never a plugin-side override.
