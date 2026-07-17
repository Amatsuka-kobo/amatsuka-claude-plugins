## Plugin directory layout (per `plugins/<name>/`)

- `.claude-plugin/plugin.json` — required manifest (name/description/version).
- `commands/*.md`, `agents/*.md`, `skills/<skill-name>/SKILL.md`, `hooks/hooks.json` — standard
  Claude Code component dirs, present only if needed (basic-design/revelation have skills only).
- `package.json` (`build` script only) + `build.ts` (esbuild) + `src/` + `scripts/` — see below.
- `.mcp.json` — bundled MCP servers, paths via `${CLAUDE_PLUGIN_ROOT}` (only codiel → `raguel`).
- Distributable only once also listed in root `.claude-plugin/marketplace.json`.

## src/ → scripts/ bundle rule (hard convention)

`src/**/*.ts` is the source of truth; `plugins/<name>/scripts/*.mjs` are esbuild output and are
**committed to git** (plugin consumers must not need a build step). Same for
`raguel-mcp/dist/server.mjs`. Touch `src/` → run root `pnpm build` → commit the regenerated bundle
in the same commit. Never hand-edit `scripts/*.mjs`. Hooks/skills invoke the bundle, e.g.
`node "${CLAUDE_PLUGIN_ROOT}/scripts/guard-bash.mjs"`, so an unbuilt change ships as a no-op.
(`codiel/scripts/install-harness.sh` is hand-written, not generated.)

Tests go in `__test__/` dirs beside the code (`src/hooks/__test__/lib.test.ts`) — the root vitest
include glob only picks those up. Fixtures under `src/fixtures/`, fakes under `src/testing/`.

## Versioning (repo `CLAUDE.md`)

Each plugin versions independently: bump the changed plugin's
`plugins/<plugin>/.claude-plugin/plugin.json` proportionally to the change. Format `n1.n2.n3`, with
`-alpha.n4` / `-dev` for prereleases (all four plugins are currently `-dev`). Bump minor/patch/pre
autonomously; **a major (n1) bump always requires asking the human**. Keep the sibling
`package.json` version in sync (they currently match).

## Skill conventions

- Frontmatter `description` states the trigger in Japanese and, for user-directed skills, ends with
  「明示的な依頼があったときのみ使い、自律的には発動しない」.
- Written in superpowers' style (checklists, flowcharts, Red-Flags tables, HARD-GATE sections), but
  no plugin here has a runtime dependency on the superpowers plugin — each is self-contained.
- Common skill invariants: discuss in the user's language; never generate/save without explicit
  approval; on STOP always state reason + user's next action; report raw errors rather than
  silently switching to a workaround.
- Optional per-project settings live in `.claude/<plugin>.local.md` (e.g. basic-design's
  `drive_folder_id`).

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
