## Plugin directory layout (per `plugins/<name>/`)

- `.claude-plugin/plugin.json` — required manifest (name/description/version).
- `commands/*.md`, `agents/*.md`, `skills/<skill-name>/SKILL.md`, `hooks/hooks.json` +
  `hooks/scripts/*.mjs` — standard Claude Code plugin component dirs, present only if the plugin
  needs them (revelation/task-utility only have `skills/`).
- `.mcp.json` — declares bundled MCP servers, referencing `${CLAUDE_PLUGIN_ROOT}` for paths
  (see codiel's `raguel` server entry).
- A plugin is only distributable once it also has an entry in the root
  `.claude-plugin/marketplace.json`.

## Codiel-specific conventions (see `mem:core` for the no-API invariant, `mem:codiel/raguel_mcp`
for raguel-mcp internals)

- Skills are written in superpowers' style (checklists, process flowcharts, Red-Flags tables,
  HARD-GATE sections) but Codiel has **no runtime dependency on the superpowers plugin** —
  it's self-contained.
- No fixed human-approval checkpoints; the only human touchpoints are when Raguel's gate emits
  ASK/STOP, or the triage phase (filing followup issues is always user-directed, never automatic).
- Domain split for implementers/reviewers: frontend / backend / data (+ doc/security reviewers).
  Projects where this split doesn't fit collapse to a single `generic` domain (implementer +
  reviewer), per each target project's `docs/ARCHITECTURE.md` declaration.
- hooks enforce phase-level (not agent-level) write/command restrictions, and default to `ask`
  rather than `deny` to tolerate false positives — see `plugins/codiel/hooks/hooks.json`.
- Full flow spec (9 phases, state model, test-asset model, retry loop): `plugins/codiel/docs/DESIGN.md`.
