`plugins/pitcrew` (0.10.2 — released, non-`-dev`). Turns orchestration wait-time into human
parallel-review time. Design spec: `harness-docs/superpowers/specs/2026-07-16-pitcrew-design.md`.
Note `src/lib/__test__/capture-rules.test.ts:10` asserts that `docs/superpowers/specs/x.md` matches
the default artifact glob `docs/**/*.md` — that string is a glob fixture, not a doc reference, and
must not be rewritten to `harness-docs/`.
Workspace pkg `pitcrew-scripts`. Deps: Node stdlib + git CLI only. `build.ts` bundles `src/**` →
committed `scripts/*.mjs` (`mem:conventions` src→scripts rule).

## Model — hooks-only, no MCP, no agents

Two layers, both driven by `hooks/hooks.json` (no `.mcp.json`, no agents):

- **Capture** → writes review items to `.pitcrew/review/NNN-*.md` with frontmatter
  (kind `diff`/`artifact`/`test`, source agent, target paths, base/head).
  - `SubagentStop` → diff of that subagent's work.
  - `PostToolUse` Write|Edit → artifact files (`docs/**/*.md`; `docs/chat/` always excluded).
  - `PostToolUse` / `PostToolUseFailure` Bash → test/build command results (success vs failure).
- **Inject** → feeds human comments from `.pitcrew/comments/c-<n>.md` back into the running session.
  - `PreToolUse` Write|Edit → `urgent` comments matching the target path, to the agent about to
    touch it (first-come, one agent).
  - `Stop` → `normal` comments (+ leftover unmatched `urgent`) to the main session at turn boundary.
  - The split above is the default `injection_timing: hybrid`; `immediate` / `turn-boundary` move
    both classes to one channel. `Stop` also sweeps up any urgent comment no `PreToolUse` matched.
  - at-most-once; injected comments move to `comments/processed/`. `run.json` updates serialized via
    `.pitcrew/run.lock` (stale >10s auto-reclaimed; lock failure → proceed unlocked).

## Surfaces

- Skill `pitcrew` (`skills/pitcrew/SKILL.md`) — the **agent-facing** half: how to read an injected
  `[pitcrew]` comment (urgency/paths/base), treat it as a fresh human instruction outranking the
  current task, and **never write into `.pitcrew/` directly** (hooks own all state).
- Commands: `/pitcrew:serve` (browser viewer — local `127.0.0.1` HTTP + token, SSE live-reload,
  2-pane review; `serve.json` while running), `/pitcrew:watch` (guides launching the **TUI** viewer
  `scripts/watch.mjs`, which the **user runs themselves** — Claude must not launch it),
  `/pitcrew:config`.
- Config `.claude/pitcrew.local.md` (flat frontmatter, `mem:conventions` `.local.md` pattern):
  `viewer` (files/browser/tui), `capture_targets`, `artifact_globs`, `test_commands`,
  `injection_timing` (hybrid/turn-boundary/immediate), `theme`, `port` (7373). Missing/broken →
  defaults.

## src/ layout

`src/lib/` (capture-rules, config, git, review, comments, state, lock, atomic, watch, run,
hook-io, viewer-ops, frontmatter), `src/hooks/` (the 4 capture/inject entry points),
`src/server/` (browser viewer: http.ts/serve.ts/ui.html), `src/tui/` (watch viewer:
main/loop/render/editor/keymap), `src/testing/`. Tests in `__test__/` beside each module.

## Gotchas

- `.pitcrew/` is runtime state, gitignore-recommended; reset = delete the whole dir. Agents/skills
  must not edit under it.
- pitcrew, raphael and guidepost all inject via `PreToolUse` + `Stop` and all keep an at-most-once
  processed/ queue — when debugging "my comment/question/antibody arrived twice or never", check
  which plugin owns the queue before touching shared assumptions.
