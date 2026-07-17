## What this repo is

`amatsuka-claude-plugins` — a Claude Code plugin **marketplace** (not an app), plus the TypeScript
sources that build each plugin's bundled scripts.

- `.claude-plugin/marketplace.json` — marketplace manifest; a plugin is only distributable once
  listed here (name/source/description).
- `plugins/<name>/` — one dir per plugin, each its own pnpm workspace package.
  Layout + build/bundle conventions: `mem:conventions`. Toolchain: `mem:tech_stack`.
- `docs/chat/<year>/<mmdd>/*.md` — session chat-log archive, written by task-utility's
  chat-recorder. **Repo `CLAUDE.md` forbids reading these** unless you are the chat-recorder /
  chat-reader agent or the user explicitly asks.
- `docs/superpowers/{specs,plans}/` — current home of design specs & implementation plans
  (`docs/plans/` holds older dated docs).
- `docs/development/cliproxyapi-setup.md`, `ONBOARDING.md` — dev-env setup (Volta/node, uv+Serena,
  Context7, LSPs, optional Codex/CLIProxyAPI).
- `TERMS.md` — Japanese ToS; notably forbids using this service to generate
  illustration/Live2D/3D-model assets.

## Distributed plugins (4, see `.claude-plugin/marketplace.json`)

- **codiel** (0.2.0-dev) — GitHub-issue-driven orchestrator: analyze → design → implement → test →
  PR → review, gated by the bundled `raguel` MCP server. Largest/most complex.
  Flow spec: `plugins/codiel/docs/DESIGN.md`. MCP internals: `mem:codiel/raguel_mcp`.
- **basic-design** (0.6.0-dev) — brainstorm-driven basic-design deliverables (ER / screen-flow /
  architecture / sequence diagrams, API list, NFR checklist) via spec-JSON → .drawio + HTML.
  Details: `mem:basic_design/core`.
- **task-utility** (0.4.0-dev) — workflow utility skills (chat logging/recall/resume, GitHub issue
  craft/split/triage) + chat-recorder/chat-reader agents.
- **revelation** (0.2.0-dev) — skills teaching smaller models to replicate Fable5's working style
  (task decomposition / self-verification). Disabled by default in `.claude/settings.json`.

## Project-wide invariant — no Anthropic API usage

Everything LLM-related must work **without `ANTHROPIC_API_KEY`**: it goes through Claude Code
itself (main session / subagents) or a headless `claude` CLI subprocess (subscription auth).
Never add an Anthropic API client, and never design a flow that requires the user to run a bundled
CLI/script by hand — the user-facing surface is Claude Code skills/commands only. Documented as
"最重要" in `plugins/codiel/docs/DESIGN.md` §0 and in repo `CLAUDE.md`; it binds every plugin here,
not just Codiel.

## Per-user files that are gitignored (not misconfiguration)

`CLAUDE.md` and `.claude/agents/` are in `.gitignore`. `CLAUDE.md` is copied from
`CLAUDE.example.md` per user, with an agent-policy section pasted from either `agents-with-codex.md`
(Codex users) or `agents-claude-only.md` (Claude-only users). `codex/gpt-{sol,terra,luna}.md` are
the tracked GPT agent definitions; `.claude/agents/*.md` symlinks into them are each user's opt-in.
Do not "fix" a missing/empty `.claude/agents` or `CLAUDE.md`.
Editing `CLAUDE.md` requires human confirmation, and any change also present in
`CLAUDE.example.md` must be mirrored there.

## Agent-tiering convention (repo `CLAUDE.md`, sourced from `agents-with-codex.md`)

Fable/Opus: orchestration, analysis, design, planning, audit, advice only — no implementation.
Review → Sonnet (heavy/final review → orchestrator itself). Complex implementation → `GPT Sol`;
normal implementation & other tasks → `GPT Terra`; lightweight tasks → `GPT Luna`.
(Claude-only variant maps these to Opus/Sonnet/Haiku.) Design docs & implementation plans must be
reviewed by `Haiku` first, and its stated understanding fed back into the doc. Subagents may call a
`Fable` advisor when stuck, but must not grant Agent Tool to agents they spawn.
