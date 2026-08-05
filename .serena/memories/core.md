## What this repo is

`amatsuka-claude-plugins` — a Claude Code plugin **marketplace** (not an app), plus the TypeScript
sources that build each plugin's bundled scripts.

- `.claude-plugin/marketplace.json` — marketplace manifest; a plugin is only distributable once
  listed here (name/source/description).
- `plugins/<name>/` — one dir per plugin. Script-bearing plugins are pnpm workspace packages;
  doc-only plugins (`agent-policy`, `prompt-smith`) are not. Layout + bundle conventions:
  `mem:conventions`. Toolchain: `mem:tech_stack`.
- `_types/*.md` + `mdbase.yaml` — mdbase typed-markdown schemas (`agent`, `skill`, `command`,
  `antibody`) validating frontmatter of `plugins/*/{agents,commands}/*.md`,
  `plugins/*/skills/*/SKILL.md`, `.raphael/antibodies/*.md`. Checked by the `mdbase-lsp` LSP
  (`mem:suggested_commands` — not part of `pnpm test`). `docs/` and `.serena/` are excluded.
- `docs/chat/<year>/<mmdd>/*.md` — session chat-log archive, written by chat-history's
  chat-recorder. **Repo `CLAUDE.md` forbids reading these** unless you are the chat-recorder /
  chat-reader agent or the user explicitly asks.
- `docs/{design,plans}/`, `docs/superpowers/{specs,plans}/` — design specs & implementation plans
  (all four are live; `docs/superpowers/` holds the older superpowers-format ones).
  `docs/optimize-agents-record/`, `docs/handover/`, `docs/agents-*-old.md` — historical rationale
  kept at repo root rather than under `plugins/*/docs/`, contrary to `CLAUDE.md`'s doc-placement
  rule; not a mistake to "fix" unasked.
- `docs/development/cliproxyapi-setup.md`, `ONBOARDING.md` — dev-env setup (Volta/node, uv+Serena,
  Context7, LSPs incl. mdbase-lsp, optional Codex/CLIProxyAPI).
- `TERMS.md` — Japanese ToS; notably forbids using this service to generate
  illustration/Live2D/3D-model assets.

## Distributed plugins (11, see `.claude-plugin/marketplace.json`)

Only **pitcrew (0.10.1)** and **chat-history (0.5.0)** are released; every other plugin is `-dev`.

- **codiel** (0.2.1-dev) — GitHub-issue-driven orchestrator: analyze → design → implement → test →
  PR → review, gated by the bundled `raguel` MCP server. Largest/most complex.
  Flow spec: `plugins/codiel/docs/DESIGN.md`. MCP internals: `mem:codiel/raguel_mcp`.
- **basic-design** (0.6.1-dev) — brainstorm-driven basic-design deliverables via spec-JSON →
  .drawio + HTML. Details: `mem:basic_design/core`.
- **pitcrew** (0.10.1) — hooks-only parallel-review layer: captures orchestration artifacts to
  `.pitcrew/review/` and injects human comments back into the session. Details: `mem:pitcrew/core`.
- **raphael** (0.1.1-dev) — failure-immunity: detects failure signals into `.raphael/infections/`,
  distills them into antibodies, re-injects only on deterministic `PreToolUse` match.
  Details: `mem:raphael/core`.
- **guidepost** (0.1.1-dev) — turns a commit range / PR diff into an AI-guided code-reading tour in
  a browser viewer, with reader questions injected back into the session.
  Details: `mem:guidepost/core`.
- **chat-history** (0.5.0) — chat logging / recall / resume skills + chat-recorder & chat-reader
  agents. Details: `mem:chat_history/core`.
- **gh-utility** (0.5.0-dev) — GitHub issue skills (`issue-craft` / `issue-split` / `issue-triage`)
  sharing `references/github-issue-common.md`; scripts wrap `gh`/REST, skills own the judgement.
- **agent-policy** (0.1.0-dev) — the model-tiering / orchestration discipline this repo itself runs
  under. Doc-only. Details: `mem:agent_policy/core`.
- **prompt-smith** (0.1.0-dev) — standards for writing AI-facing instruction docs (`prompt-smith`)
  and creating/auditing agent definitions (`agent-creator`). Doc-only, no scripts, no package.json.
  Scope is decided by location: `references/` + CLAUDE.md/SKILL.md/commands/output-style/agents;
  README & `docs/` are explicitly out of scope.
- **prefetch** (0.2.1-dev) — speculative background prefetch just before a user-input wait; single
  `UserPromptSubmit` hook (`check-prefetch-manifest.mjs`) nagging only when `.prefetch/` holds
  uncollected results.
- **revelation** (0.2.1-dev) — skills teaching smaller models Fable5's working style. Deprecated
  (README says 非推奨) and disabled in `.claude/settings.json`.

## 2026-08 plugin split — mostly resolved

`task-utility` → `chat-history` + `gh-utility`, and `optimize-agents` → `agent-policy` +
`prompt-smith` (commit 849d3c7). The follow-up rename pass landed 2026-08-05 (chat-history 0.5.1,
gh-utility 0.5.1-dev, revelation 0.2.2-dev): skill dispatch ids, hook injection text, both READMEs,
root README, ONBOARDING and the agent-policy/prompt-smith skill bodies now use the new ids.

The state dir migration (`~/.claude/task-utility/chat-recorder/` →
`~/.claude/chat-history/chat-recorder/`) shipped in chat-history 0.6.0: the Stop hook renames it
once, with a read-side fallback to the legacy root so a failed rename never looks like empty state.

Deliberately still on the old name — do not "fix" these:

- `SKIP_AGENT_TYPES` in `plugins/revelation/src/remind-skill.ts` holds **both** ids so projects
  still running the old plugin keep the pass-through.
- Tests asserting `task-utility:chat-recorder` in `chat-history/src/hooks/__test__/` guard the
  `hasRunningRecorder` normalization (last-`:`-segment match), i.e. backward compatibility.
- The env var `TASK_UTILITY_CHAT_STATE_DIR` keeps its name — renaming it would silently drop any
  existing override.
- `docs/optimize-agents-record/`, `docs/{design,plans,superpowers}/` keep the old names as
  historical record.

## Project-wide invariant — no Anthropic API usage

Everything LLM-related must work **without `ANTHROPIC_API_KEY`**: it goes through Claude Code
itself (main session / subagents) or a headless `claude` CLI subprocess (subscription auth).
Never add an Anthropic API client, and never design a flow that requires the user to run a bundled
CLI/script by hand — the user-facing surface is Claude Code skills/commands only. Documented as
「最重要」 in `plugins/codiel/docs/DESIGN.md` §0 and in repo `CLAUDE.md`; it binds every plugin here.

## Per-user files that are gitignored (not misconfiguration)

`.gitignore` covers `CLAUDE.md`, `.claude/agents/`, `.claude/context-maps/`, `private/`, `*.local.*`,
`.pitcrew/`, `.prefetch/`, `.superpowers/`, `.raphael/{infections,state.json,log}`, and
`cliproxyapi.config.yaml` / `static/management.html`. Only `.claude/settings.json` and
`.claude/output-styles/EnhancedClaude5.md` are tracked under `.claude/`.
`CLAUDE.md` is copied per user from `CLAUDE.example.md`, whose 「エージェント運用方針」 section is a
fill-in guide (paste the `agent-policy:with-codex-policy` or `:claude-model-policy` line).
There is **no tracked `codex/` dir** any more — the GPT agent definitions now live only as
per-user `.claude/agents/gpt-{sol,terra,luna}.md`, generated by `agent-policy:setup-gpt`.
Do not "fix" a missing/empty `.claude/agents` or `CLAUDE.md`.
Editing `CLAUDE.md` requires human confirmation, and any change also present in
`CLAUDE.example.md` must be mirrored there.
