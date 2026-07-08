## What this repo is

`amatsuka-claude-plugins` — a Claude Code plugin **marketplace** (not an app). Root is mostly
markdown/JSON config; the only real source code lives inside `plugins/codiel/raguel-mcp/`
(a TypeScript/Node subproject — see `mem:codiel/raguel_mcp`).

- `.claude-plugin/marketplace.json` — marketplace manifest, lists the 3 distributed plugins
  (name/source/description). Adding a plugin requires an entry here.
- `plugins/<name>/` — one dir per plugin, each with its own `.claude-plugin/plugin.json`.
  Plugin structure conventions (commands/agents/skills/hooks layout): `mem:conventions`.
- `docs/chat/<year>/<mmdd>/*.md` — session chat-log archive (design/implementation discussions),
  written retroactively, not read by any tooling.
- `docs/plans/` — dated implementation plan docs.
- `TERMS.md` — Japanese ToS for the marketplace; governs generated-content usage restrictions
  (notably: forbids using this service to generate illustrations/Live2D/3D model assets).

## Distributed plugins (see `.claude-plugin/marketplace.json`)

- **codiel** (α) — GitHub-issue-driven orchestrator: design → implement → test → PR → review,
  gated by the `raguel` MCP server. By far the largest/most complex plugin.
  Module memory: `mem:codiel/raguel_mcp`.
- **revelation** (開発中) — skills that teach smaller models (Opus/Sonnet/Haiku) to replicate
  Fable5's task-decomposition/self-verification working style.
- **task-utility** (開発中) — misc workflow utility skills (e.g. chat-log saving).

## Project-wide invariant — no Anthropic API usage

Codiel/Raguel **must work without `ANTHROPIC_API_KEY`** — everything LLM-related goes through
Claude Code itself (main session / subagents) or Raguel's internal headless `claude` CLI calls
(subscription auth, not API auth). No direct Anthropic API client is ever added, and no flow may
require the user to run a bundled CLI/script by hand — the only user-facing surface is Claude Code
slash commands. This is documented as "最重要" in `plugins/codiel/docs/DESIGN.md` §0 and is a hard
constraint on any future design in this repo, not just Codiel. Do not propose API-call or
standalone-CLI-based designs here.

## Agent-tiering convention (repo `CLAUDE.md`)

Investigative/analytical work → strongest available model (Opus/Fable). Routine work → Sonnet.
Lightweight/mechanical work → Haiku.
