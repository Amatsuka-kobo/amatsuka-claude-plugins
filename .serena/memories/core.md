## What this repo is

`amatsuka-claude-plugins` — a Claude Code plugin **marketplace** (not an app), plus the TypeScript
sources that build each plugin's bundled scripts.

- `.claude-plugin/marketplace.json` — marketplace manifest; a plugin is only distributable once
  listed here (name/source/description).
- `plugins/<name>/` — one dir per plugin. **All 11 are pnpm workspace packages** as of 2026-08:
  `agent-policy` and `prompt-smith` gained `src/` + `scripts/` + `package.json` and are no longer
  markdown-only. Layout + bundle conventions: `mem:conventions`. Toolchain: `mem:tech_stack`.
- `_types/*.md` + `mdbase.yaml` — mdbase typed-markdown schemas (`agent`, `skill`, `command`,
  `antibody`) validating frontmatter of `plugins/*/{agents,commands}/*.md`,
  `plugins/*/skills/*/SKILL.md`, `.raphael/antibodies/*.md`. Checked by the `mdbase-lsp` LSP
  (`mem:suggested_commands` — not part of `pnpm test`). `mdbase.yaml` excludes `.git`, `.mdbase`,
  `node_modules`, `docs`, `harness-docs`, `.serena` — both prose-doc trees are out of scope, so
  design specs and plans never need type frontmatter.
- Root `.mcp.json` (added 2026-08, commit a16ef76) — two servers for this repo's own sessions:
  `github` (http, `https://api.githubcopilot.com/mcp/`, bearer from env
  `GITHUB_PERSONAL_ACCESS_TOKEN`) and `serena` (stdio, `uvx --from git+…/serena start-mcp-server`,
  context `claude-code`, dashboard off). Repo `CLAUDE.md` mandates Context7 for library docs and
  Serena for all codebase exploration + TS/MD editing.
- `.claude/settings.json` (tracked) — default model `claude-opus-5[1m]`, `outputStyle:
  EnhancedClaude5`, no `hooks` key, permissions allow/deny/ask lists, and the enabled-plugin set:
  the five local ones (agent-policy, chat-history, prompt-smith, raphael + marketplace entries)
  plus context7, claude-security, explanatory-output-style, security-guidance, superpowers,
  mdbase-lsp, genshijin, codex. **`plugin-dev`, `mcp-server-dev` and the official `skill-creator`
  were removed 2026-08 (commit ea72cbc)** — `plugin-dev:plugin-validator` is no longer available as
  a validation step; prompt-smith's own `skill-creator` replaced the official one.

## docs/ vs harness-docs/ — split 2026-08-14 (commits 113481f, 561dc48)

Human-read material stays in `docs/`; AI-read material moved to `harness-docs/`.

- `docs/` now holds only: `chat/` (session archive), `development/cliproxyapi-setup.md`,
  `optimize-agents-record/` (historical rationale), `agents-{claude-only,with-codex}-old.md`,
  and `ONBOARDING.md` (**moved down from the repo root**).
- `harness-docs/` holds `design/`, `plans/`, `handover/`, `superpowers/{specs,plans}` — every
  design spec and implementation plan. Repo `CLAUDE.md` says **do not read `docs/`** and **write
  new design/plan docs into `harness-docs/`**.
- Consequence: any doc citing `docs/design/…`, `docs/plans/…`, `docs/superpowers/…` for a *repo*
  design spec is stale — the file is under `harness-docs/` now. All known stragglers were fixed
  2026-08-15. Two look-alikes that must NOT be rewritten: basic-design's skills write their
  deliverables to `docs/design/<kind>/` of the **target** project, and
  `plugins/pitcrew/src/lib/__test__/capture-rules.test.ts:10` asserts `docs/superpowers/specs/x.md`
  matches the default artifact glob `docs/**/*.md`.
- `docs/chat/<year>/<mmdd>/<author>/*.md` — **repo `CLAUDE.md` forbids reading these** unless you
  are the chat-recorder / chat-reader agent or the user explicitly asks; use `chat-history:recall`.
- `TERMS.md` — Japanese ToS; notably forbids using this service to generate illustration/Live2D/
  3D-model assets.

## Distributed plugins (11, see `.claude-plugin/marketplace.json`)

Only **pitcrew (0.10.2)** and **chat-history (0.6.0)** are released; every other plugin is `-dev`.

- **codiel** (0.4.1-dev) — GitHub-issue-driven orchestrator gated by the bundled `raguel` MCP
  server. Largest/most complex. Details: `mem:codiel/core`; MCP internals: `mem:codiel/raguel_mcp`.
- **basic-design** (0.6.2-dev) — brainstorm-driven basic-design deliverables via spec-JSON →
  .drawio + HTML. Details: `mem:basic_design/core`.
- **pitcrew** (0.10.2) — hooks-driven parallel-review layer: captures orchestration artifacts to
  `.pitcrew/review/` and injects human comments back into the session. Details: `mem:pitcrew/core`.
- **raphael** (0.1.1-dev) — failure-immunity: detects failure signals into `.raphael/infections/`,
  distills them into antibodies, re-injects only on deterministic `PreToolUse` match.
  Details: `mem:raphael/core`.
- **guidepost** (0.1.1-dev) — turns a commit range / PR diff into an AI-guided code-reading tour in
  a browser viewer, with reader questions injected back into the session.
  Details: `mem:guidepost/core`.
- **chat-history** (0.6.0) — chat logging / recall / resume skills + chat-recorder & chat-reader
  agents. Details: `mem:chat_history/core`.
- **gh-utility** (0.5.1-dev) — GitHub issue skills (`issue-craft` / `issue-split` / `issue-triage`)
  sharing `references/github-issue-common.md`; scripts (`check-issue-env`, `list-issues`,
  `link-sub-issue`) wrap `gh`/REST, skills own the judgement.
- **agent-policy** (0.6.0-dev) — the model-tiering / orchestration discipline this repo itself runs
  under, plus the `setup-agents` CLI that generates GPT/Grok agent definitions.
  Details: `mem:agent_policy/core`.
- **prompt-smith** (0.3.0-dev) — standards for AI-facing instruction docs (`prompt-smith`), agent
  definitions (`agent-creator`) and skill authoring + description eval loop (`skill-creator`, a
  TypeScript port of Anthropic's official skill-creator). Details: `mem:agent_policy/core`.
- **prefetch** (0.2.1-dev) — speculative background prefetch just before a user-input wait; single
  `UserPromptSubmit` hook (`check-prefetch-manifest.mjs`) nagging only when `.prefetch/` holds
  uncollected results.
- **revelation** (0.2.2-dev) — three `fable-*` skills teaching smaller models Fable 5's working
  style, injected by `SessionStart` + `PreToolUse` hooks. README marks it 非推奨.

## 2026-08 plugin split — resolved

`task-utility` → `chat-history` + `gh-utility`, and `optimize-agents` → `agent-policy` +
`prompt-smith` (commit 849d3c7). Identifier rename pass landed 2026-08-05; the state-dir migration
(`~/.claude/task-utility/chat-recorder/` → `~/.claude/chat-history/chat-recorder/`) shipped in
chat-history 0.6.0 with a read-side fallback so a failed rename never looks like empty state.

Deliberately still on the old name — do not "fix" these:

- `SKIP_AGENT_TYPES` in `plugins/revelation/src/remind-skill.ts` holds **both** ids.
- Tests asserting `task-utility:chat-recorder` in `chat-history/src/hooks/__test__/` guard the
  `hasRunningRecorder` normalization (last-`:`-segment match), i.e. backward compatibility.
- The env var `TASK_UTILITY_CHAT_STATE_DIR` keeps its name — renaming it would silently drop any
  existing override, and setting it opts out of migration entirely.
- `docs/optimize-agents-record/` and `docs/agents-*-old.md` keep the old names as historical record.

## Project-wide invariant — no Anthropic API usage

Everything LLM-related must work **without `ANTHROPIC_API_KEY`**: it goes through Claude Code
itself (main session / subagents) or a headless `claude` CLI subprocess (subscription auth).
Never add an Anthropic API client, and never design a flow that requires the user to run a bundled
CLI/script by hand — the user-facing surface is Claude Code skills/commands only. Documented as
「最重要」 in `plugins/codiel/docs/DESIGN.md` §0 and in repo `CLAUDE.md`; it binds every plugin here.
(raguel-mcp's panel and prompt-smith's eval loop both shell out to `claude -p` for this reason.)

## Per-user files and gitignore (not misconfiguration)

`.gitignore`: `node_modules`, `.superpowers/`, `.pitcrew/`, `.prefetch/`, `static/management.html`,
`cliproxyapi.config.yaml`, `.claude/agents`, `.claude/context-maps`, `.raphael/{infections,
state.json,log}`, `.claude/raphael.local.md`, `private/`, `*.local.*` — with the single negation
`!CLAUDE.local.example.md`. `.worktreeinclude` mirrors that list (minus `static/`,
`cliproxyapi.config.yaml`) to carry per-user state into `git worktree` checkouts.

- **`CLAUDE.md` is now git-tracked**; there is no `CLAUDE.example.md` any more. Per-user
  orchestration policy lives in the gitignored `CLAUDE.local.md`, seeded from the tracked
  `CLAUDE.local.example.md` (which lists all four agent-policy variants as commented examples).
  `docs/ONBOARDING.md` still references the removed `CLAUDE.example.md` — stale.
- There is **no tracked `codex/` dir**; GPT/Grok agent definitions live only as per-user
  `.claude/agents/{gpt-sol,gpt-terra,gpt-luna,grok-researcher,grok-implementer}.md`, generated by
  `agent-policy:setup-gpt` / `:setup-grok`. Do not "fix" a missing/empty `.claude/agents`.
- Editing `CLAUDE.md` requires human confirmation.
- `private/` holds the user's own scratch (`context-map/`, story drafts); `.superpowers/sdd/` holds
  hundreds of historical task briefs/reports/review diffs. Both are noise for code work.
