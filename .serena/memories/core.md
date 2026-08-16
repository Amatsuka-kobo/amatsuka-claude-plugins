## What this repo is

`amatsuka-claude-plugins` — a Claude Code plugin **marketplace** (not an app), plus the TypeScript
sources that build each plugin's bundled scripts.

- `.claude-plugin/marketplace.json` — marketplace manifest; a plugin is only distributable once
  listed here (name/source/description). 11 entries, matching the root `README.md` table 1:1
  (verified 2026-08-16).
- `plugins/<name>/` — one dir per plugin. All 11 are pnpm workspace packages. Layout + bundle
  conventions: `mem:conventions`. Toolchain: `mem:tech_stack`.
- **mdbase / typed-markdown frontmatter checking is gone** (commit 9ed55dd, 2026-08): `mdbase.yaml`,
  `_types/{agent,command,skill,antibody}.md` and `scripts/install-mdbase.sh` were deleted from their
  working locations and re-added as an archive under `docs/old/mdbase-record/`; `mdbase-lsp` was
  dropped from `enabledPlugins`. **There is now no schema check of any frontmatter anywhere** —
  do not cite `_types/` or the LSP as a validation step. (`plugins/raphael/src/lib/frontmatter.ts`
  validates only Raphael antibodies and is unrelated.)
- Root `.mcp.json` — two servers: `github` (http, `https://api.githubcopilot.com/mcp/`, bearer from
  env `GITHUB_PERSONAL_ACCESS_TOKEN`) and `serena` (stdio, `uvx --from git+…/serena
  start-mcp-server`, context `claude-code`, dashboard off). Repo `CLAUDE.md` mandates Context7 for
  library docs and Serena for all codebase exploration + TS/MD editing.
- `.claude/settings.json` (tracked) — model `claude-opus-5[1m]`, `outputStyle: EnhancedClaude5`,
  `env.ANTHROPIC_DEFAULT_FABLE_MODEL = claude-fable-5[1m]`, permissions lists, **no `hooks` key**,
  and 11 `enabledPlugins`: the four local ones (agent-policy, chat-history, prompt-smith, raphael)
  plus context7, claude-security, explanatory-output-style, security-guidance, superpowers,
  genshijin, codex. `plugin-dev`, `mcp-server-dev`, the official `skill-creator` and `mdbase-lsp`
  have all been removed over 2026-08 — none of them is available as a validation step.
- `.claude/settings.local.json` (gitignored, per-user) carries the switches that actually drive this
  session: `env.AMATSUKA_AGENT_AUTO_INJECTION` (currently `claude` — selects the agent-policy skill,
  see `mem:agent_policy/core`), `env.GENSHIJIN_DEFAULT_MODE`, `enabledMcpjsonServers: [serena,
  context7]` and `disabledMcpjsonServers: [github]` — so the root `.mcp.json` github server is off
  in practice. Look here, not in the tracked settings, when behaviour seems unexplained.

## docs/ vs harness-docs/ — split 2026-08-14 (commits 113481f, 561dc48)

Human-read material stays in `docs/`; AI-read material moved to `harness-docs/`.

- `docs/` now holds only: `chat/` (session archive), `development/cliproxyapi-setup.md`,
  `agents-{claude-only,with-codex}-old.md`, `ONBOARDING.md` (**moved down from the repo root**), and
  `old/` — the retirement shelf, currently `old/mdbase-record/` and `old/optimize-agents-record/`.
- `harness-docs/` holds `design/` (24 files), `plans/` (14), `handover/`, `superpowers/{specs,plans}`
  — every design spec and implementation plan. Repo `CLAUDE.md` says **do not read `docs/`** and
  **write new design/plan docs into `harness-docs/`**.
- Consequence: any doc citing `docs/design/…`, `docs/plans/…`, `docs/superpowers/…` for a *repo*
  design spec is stale. Two look-alikes that must NOT be rewritten: basic-design's skills write
  their deliverables to `docs/design/<kind>/` of the **target** project, and
  `plugins/pitcrew/src/lib/__test__/capture-rules.test.ts:10` asserts `docs/superpowers/specs/x.md`
  matches the default artifact glob `docs/**/*.md`.
- `docs/chat/<year>/<mmdd>/<author>/*.md` + `docs/chat/INDEX.md` — **repo `CLAUDE.md` forbids
  reading these** unless you are the chat-recorder / chat-reader agent or the user explicitly asks;
  use `chat-history:recall`.
- `TERMS.md` — Japanese ToS; notably forbids using this service to generate illustration/Live2D/
  3D-model assets.

## Distributed plugins (11, see `.claude-plugin/marketplace.json`)

Only **pitcrew (0.10.2)** and **chat-history (0.7.0)** are released; every other plugin is `-dev`.
Manifest and sibling `package.json` versions were all in sync as of 2026-08-16.

- **codiel** (0.4.1-dev) — GitHub-issue-driven orchestrator gated by the bundled `raguel` MCP
  server. Largest/most complex. Details: `mem:codiel/core`; MCP internals: `mem:codiel/raguel_mcp`.
- **basic-design** (0.6.2-dev) — brainstorm-driven basic-design deliverables via spec-JSON →
  .drawio + HTML. Details: `mem:basic_design/core`.
- **pitcrew** (0.10.2) — hooks-driven parallel-review layer: captures orchestration artifacts to
  `.pitcrew/review/` and injects human comments back into the session. Details: `mem:pitcrew/core`.
- **raphael** (0.1.1-dev) — failure-immunity: detects failure signals into `.raphael/infections/`,
  distills them into antibodies (36 committed under `.raphael/antibodies/` as of 2026-08-16), and
  re-injects only on deterministic `PreToolUse` match. Details: `mem:raphael/core`.
- **guidepost** (0.1.1-dev) — turns a commit range / PR diff into an AI-guided code-reading tour in
  a browser viewer, with reader questions injected back into the session.
  Details: `mem:guidepost/core`.
- **chat-history** (0.7.0) — chat logging / recall / resume skills + chat-recorder & chat-reader
  agents. The record format flipped from summary to **verbatim** on 2026-08-16, so records are
  bimodal and readers must branch on the date. Details: `mem:chat_history/core`.
- **gh-utility** (0.5.1-dev) — GitHub issue skills (`issue-craft` / `issue-split` / `issue-triage`)
  sharing `references/github-issue-common.md`; scripts (`check-issue-env`, `list-issues`,
  `link-sub-issue`) wrap `gh`/REST, skills own the judgement.
- **agent-policy** (0.7.0-dev) — the model-tiering / orchestration discipline this repo itself runs
  under. Since 2026-08-16 it **ships 7 agent definitions and injects the policy skill from a
  `SessionStart` hook keyed on an env var**; the old `setup-gpt` / `setup-grok` generator skills are
  deleted. Details: `mem:agent_policy/core`.
- **prompt-smith** (0.3.1-dev) — standards for AI-facing instruction docs (`prompt-smith`), agent
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
- `docs/old/optimize-agents-record/` and `docs/agents-*-old.md` keep the old names as historical
  record.

## Project-wide invariant — no Anthropic API usage

Everything LLM-related must work **without `ANTHROPIC_API_KEY`**: it goes through Claude Code
itself (main session / subagents) or a headless `claude` CLI subprocess (subscription auth).
Never add an Anthropic API client, and never design a flow that requires the user to run a bundled
CLI/script by hand — the user-facing surface is Claude Code skills/commands only. Documented as
「最重要」 in `plugins/codiel/docs/DESIGN.md` §0 and in repo `CLAUDE.md`; it binds every plugin here.
(raguel-mcp's panel and prompt-smith's eval loop both shell out to `claude -p` for this reason.)

## Per-user files and gitignore (not misconfiguration)

`.gitignore`: `node_modules`, `.superpowers/`, `.pitcrew/`, `.prefetch/`, `static/management.html`,
`cliproxyapi.config.yaml`, `.claude/agents`, `.claude/context-maps`, `.raphael/{infections/,
state.json,log/}`, `.claude/raphael.local.md`, `private/`, `*.local.*` — with the single negation
`!CLAUDE.local.example.md`. `.worktreeinclude` mirrors that list minus the CLIProxyAPI entries and
the negation, to carry per-user state into `git worktree` checkouts.

- **`CLAUDE.md` is git-tracked**; there is no `CLAUDE.example.md` any more. Per-user notes live in
  the gitignored `CLAUDE.local.md`, seeded from the tracked `CLAUDE.local.example.md`. Which agent
  policy applies is now set by `AMATSUKA_AGENT_AUTO_INJECTION` in `.claude/settings.local.json`,
  not by prose in CLAUDE.local.md. `docs/ONBOARDING.md` still references the removed
  `CLAUDE.example.md` — stale.
- **`.claude/agents/` is normally empty.** All GPT/Grok/Claude researcher definitions ship inside
  the agent-policy plugin; a file appears there only when an `AMATSUKA_AGENT_*_ALIAS` env var
  differs from the default and the SessionStart hook writes an override. Do not "fix" an empty
  `.claude/agents`, and treat leftover files there as stale generator output.
- Editing `CLAUDE.md` requires human confirmation.
- `private/` holds the user's own scratch (`context-map/`, story drafts); `.superpowers/sdd/` holds
  hundreds of historical task briefs/reports/review diffs. Both are noise for code work.
