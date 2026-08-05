`plugins/agent-policy` (0.1.0-dev) and `plugins/prompt-smith` (0.1.0-dev) — the two halves of the
former `optimize-agents`, split in commit 849d3c7 (2026-08). Markdown only: no `package.json`,
no `build.ts`, no `scripts/`, not pnpm workspace members. **This repo runs under agent-policy
itself** — repo `CLAUDE.md` mandates `agent-policy:with-codex-policy` as the first thing to load.

Design docs: `docs/design/2026-07-*-agent-policy-*.md`,
`docs/design/2026-08-01-agent-policy-prompt-smith-design.md`.
Accumulated rationale (out-of-scope decisions, cost analysis, prompt-smith scope, why `<example>`
blocks are not used): `docs/optimize-agents-record/` — still under the old name, still the place to
look before re-litigating a decision.

## agent-policy — who does the work

Two mutually exclusive profile skills selected by whether `.claude/agents/gpt-{sol,terra,luna}.md`
exist, plus a generator:

- `with-codex-policy` — Claude + Codex GPT tiers (Sol / Terra / Luna via a local proxy).
- `claude-model-policy` — Opus / Sonnet / Haiku only.
- `setup-gpt` — interactive wizard writing `.claude/agents/gpt-*.md` from
  `skills/setup-gpt/assets/*.template.md`, substituting `{{MODEL_ALIAS}}`. Manages no proxy or
  secrets. (Renamed from `setup` in old 0.12.0 — `/…:setup` no longer exists.)

Each profile skill holds **only** its role table plus profile-specific dispatch rules; the shared
discipline lives in `references/orchestration-discipline.md` and, for exploration,
`references/context-map-guide.md` (read only when the task needs codebase exploration).

Role tiers (with-codex → claude-only): analysis/design/planning/exploration-lead → `Opus`;
exploration legwork → `GPT Terra`/`Luna` → `Sonnet`/`Haiku`; complex impl → `GPT Sol` → `Opus`;
normal impl & misc → `GPT Terra` → `Sonnet`; light impl → `GPT Luna` → `Haiku`; code review →
`Sonnet`; advisor → `Fable`/`Opus`; design-doc review (understanding + tacit-knowledge extraction)
→ `Haiku`, and this review is **mandatory before showing a design doc or plan to the user**.
The "light impl" tier (`GPT Luna` / `Haiku`) must not be granted the Agent tool.

Load-bearing rules that bite in practice:

- **`model` override at dispatch is enum-only** (`sonnet`/`opus`/`haiku`/`fable`). Custom aliases
  like `claude-gpt-5-6-sol` are rejected before execution and are valid **only** in an agent
  definition's frontmatter `model`. Verified 2026-07-20. This is why the GPT path dispatches by
  injecting the agent definition's body into the request text instead of overriding `model`.
- An agent whose frontmatter pins a concrete `model` is honoured as-is; only `inherit`/unset agents
  (including built-ins `Explore`/`Plan`/`general-purpose`) get retiered by the role table.
- Cost discipline: never load a skill whose body+references exceed 30KB into a subagent — transcribe
  the needed clauses into the request instead; batch ≥3-turn exploration into one dispatch; do
  2-turn transcription work yourself; no per-task commits or repo-wide grep verification in subs.
- context-map: `.claude/context-maps/YYYY-MM-DD-<slug>.md` from `assets/context-map-template.md`,
  gitignored here. Only its §未解決事項 propagates upward; the full map is shared by **path**, and
  implementers receive transcribed fragments, never the whole map.

## prompt-smith — how the instructions are written

- `prompt-smith` — the standard for AI-facing instruction docs. Scope is decided by **location**:
  CLAUDE.md, SKILL.md, `commands/*.md`, output styles, agent definition bodies, memories, and
  anything under a `references/` dir (any plugin). README / `docs/` / tutorials are out of scope
  even when an instruction doc links to them. Core rule: keep only text that changes behaviour —
  strip rationale, provenance, duplication, and criterion-free hedges (「適宜」「必要に応じて」).
  Exception: "lookup" blocks (external-spec copies, schema/field definitions, exhaustive lists) are
  exempt from the duplication/example/provenance criteria.
- `agent-creator` — creating and auditing agent definition files (frontmatter + placement + tools +
  `model`), per `references/agent-definition-spec.md` and `references/description-guide.md`
  (description length cap 1536 chars; no `<example>` blocks, unlike `plugin-dev`).

## Identifier rename status (2026-08-05)

Skill bodies, root `README.md` and `ONBOARDING.md` now use `agent-policy:*` / `prompt-smith:*`.
The one remaining `optimize-agents:prompt-smith` is `CLAUDE.example.md:14`, left in place because
CLAUDE.md-family edits require human confirmation. `docs/optimize-agents-record/` keeps the old
name as historical record.