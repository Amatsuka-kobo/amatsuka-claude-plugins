## Plugin directory layout (per `plugins/<name>/`)

- `.claude-plugin/plugin.json` — required manifest (name/description/version).
- `commands/*.md`, `agents/*.md`, `skills/<skill-name>/SKILL.md`, `hooks/hooks.json` — standard
  Claude Code component dirs, present only if needed.
- `references/*.md` — AI-read shared discipline / reference fragments (agent-policy, prompt-smith,
  gh-utility). `docs/` — human-read design & rationale. `README.md` — only what a **user** must read
  to use the plugin. This three-way split is mandated by repo `CLAUDE.md`.
- `package.json` (`build` script only) + `build.ts` (esbuild) + `src/` + `scripts/` — only for
  script-bearing plugins. `agent-policy` / `prompt-smith` ship markdown only.
- `.mcp.json` — bundled MCP servers, paths via `${CLAUDE_PLUGIN_ROOT}` (only codiel → `raguel`).
- Distributable only once also listed in root `.claude-plugin/marketplace.json`.
- Frontmatter of `agents/*.md`, `commands/*.md`, `skills/*/SKILL.md` is schema-checked by mdbase
  (`_types/{agent,command,skill}.md`); `.raphael/antibodies/*.md` by `_types/antibody.md`.

## src/ → scripts/ bundle rule (hard convention)

`src/**/*.ts` is the source of truth; `plugins/<name>/scripts/*.mjs` are esbuild output and are
**committed to git** (plugin consumers must not need a build step). Same for
`raguel-mcp/dist/server.mjs` (`dist/` is only for the special server case). Touch `src/` → run root
`pnpm build` → commit the regenerated bundle in the same commit. Never hand-edit `scripts/*.mjs`.
Hooks/skills invoke the bundle, e.g. `node "${CLAUDE_PLUGIN_ROOT}/scripts/guard-bash.mjs"`, so an
unbuilt change ships as a no-op. (`codiel/scripts/install-harness.sh` and
`guidepost/scripts/ui.html` are copied/hand-written assets, not esbuild output.)

Tests go in `__test__/` dirs beside the code (`src/hooks/__test__/lib.test.ts`) — the root vitest
include glob only picks those up. Fixtures under `src/fixtures/`, fakes under `src/testing/`
(`src/testing/run-ts.ts` is the shared helper for spawning a hook as a child process pre-build).

## Versioning (repo `CLAUDE.md`)

Each plugin versions independently: bump the changed plugin's
`plugins/<plugin>/.claude-plugin/plugin.json` proportionally to the change. Format `n1.n2.n3`, with
`-dev` (or `-alpha.n4`) for prereleases — everything is `-dev` except pitcrew (0.10.1) and
chat-history (0.5.0). Bump minor/patch/pre autonomously; **a major (n1) bump always requires asking
the human**. Keep the sibling `package.json` version in sync — standing policy for every plugin
that has one. A plugin change must also be reflected in the root `README.md` plugin table.

## Skill conventions

- Frontmatter `description` states the trigger in Japanese and, for user-directed skills, ends with
  「明示的な依頼があったときのみ使い、自律的には発動しない」.
- Bodies are written to the `prompt-smith:prompt-smith` standard (see `mem:agent_policy/core`):
  discipline only — rationale, background and provenance belong in `docs/`.
- Written in superpowers' style (checklists, flowcharts, Red-Flags tables, HARD-GATE sections), but
  no plugin here has a runtime dependency on the superpowers plugin — each is self-contained.
- Common skill invariants: discuss in the user's language; never generate/save without explicit
  approval; on STOP always state reason + user's next action; report raw errors rather than
  silently switching to a workaround.
- Optional per-project settings live in `.claude/<plugin>.local.md` with **flat frontmatter**
  (basic-design's `drive_folder_id`, `raphael.local.md`, `pitcrew.local.md`); a missing or invalid
  key falls back to the built-in default per key, never wholesale.

## Runtime-state dirs (all gitignore-recommended, agents must not hand-edit)

`.pitcrew/`, `.raphael/` (except `antibodies/`, which is a shared asset meant to be committed),
`.guidepost/`, `.prefetch/`, `.claude/context-maps/`. Hooks and bundled CLIs own these; skills read
them through the provided scripts. Writes are "temp file + rename" atomic throughout.

## Codiel-specific (no-API invariant: `mem:core`; MCP internals: `mem:codiel/raguel_mcp`)

- No fixed human-approval checkpoints; human touchpoints are Raguel ASK/STOP verdicts and triage
  (filing followup issues is always user-directed, never automatic).
- Implementer/reviewer domain split: frontend / backend / data (+ doc/security reviewers). Target
  projects where this doesn't fit collapse to a single `generic` domain, declared in that project's
  `docs/ARCHITECTURE.md`.
- Hooks enforce phase-level (not agent-level) write/command restrictions and default to `ask`, not
  `deny`, to tolerate false positives — `plugins/codiel/hooks/hooks.json` +
  `src/hooks/{guard-bash,guard-write,stop-guard,subagent-stop}.ts`, phase state via
  `src/codiel-state.ts`.
- Full flow spec (9 phases, state model, test-asset model, retry loop):
  `plugins/codiel/docs/DESIGN.md`; `docs/{ARCHITECTURE,GOTCHAS}.example.md` are templates copied
  into target projects.
