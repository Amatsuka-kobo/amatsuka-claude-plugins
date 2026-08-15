`plugins/agent-policy` (0.6.0-dev, pkg `agent-policy-scripts`) and `plugins/prompt-smith`
(0.3.0-dev, pkg `prompt-smith-scripts`) — the two halves of the former `optimize-agents`, split in
commit 849d3c7 (2026-08). **Both are now script-bearing pnpm workspace members**; the older note
that they ship markdown only is obsolete. **This repo runs under agent-policy itself** — the
per-user `CLAUDE.local.md` names the policy skill to load first (currently
`agent-policy:codex-grok-policy`).

Design docs live in `harness-docs/design/` (moved out of `docs/design/` on 2026-08-14):
`2026-07-19-agent-policy-design.md`, `2026-08-01-agent-policy-prompt-smith-design.md`,
`2026-08-09-agent-policy-{codex-grok,with-grok}-policy-design.md`,
`2026-08-14-agent-policy-headless-setup-design.md`, plus
`2026-08-09-prompt-smith-skill-creator-port-design.md`.
Accumulated rationale (out-of-scope decisions, cost analysis, prompt-smith scope, why `<example>`
blocks are not used): `docs/optimize-agents-record/` — still under the old name, still the place to
look before re-litigating a decision.

## agent-policy — who does the work

Four mutually exclusive profile skills selected by which agent definitions exist in
`.claude/agents/` (gpt-{sol,terra,luna}.md and/or grok-{researcher,implementer}.md), plus two
generator skills:

| `.claude/agents/` has | policy skill |
| --- | --- |
| gpt-* and grok-* | `codex-grok-policy` |
| gpt-* only | `with-codex-policy` |
| grok-* only | `with-grok-policy` |
| neither | `claude-model-policy` |

An explicit policy name in CLAUDE.md / CLAUDE.local.md beats the file-presence heuristic.

- `codex-grok-policy` — Claude + Codex + Grok. Adds two policy-local role rows on top of
  with-codex-policy: independent design-doc review (premise-challenge/red-team) and
  realtime-info research. Uses `grok-researcher` only — GPT holds the impl tiers.
- `with-grok-policy` — Claude + Grok, no Codex. Opus takes "complex/important impl";
  `Grok Implementer` takes normal + light impl + misc; `Grok Researcher` takes exploration legwork
  plus the two Grok-specific rows.
- `with-codex-policy` — Claude + Codex GPT tiers (Sol / Terra / Luna via a local proxy).
- `claude-model-policy` — Opus / Sonnet / Haiku only.

Role tiers (with-codex → claude-only): analysis/design/planning/exploration-lead → `Opus`;
exploration legwork → `GPT Terra`/`Luna` → `Sonnet`/`Haiku`; complex impl → `GPT Sol` → `Opus`;
normal impl & misc → `GPT Terra` → `Sonnet`; light impl → `GPT Luna` → `Haiku`; code review →
`Sonnet`; advisor → `Fable`/`Opus`; design-doc review (understanding + tacit-knowledge extraction)
→ `Haiku`, and this review is **mandatory before showing a design doc or plan to the user**.
The "light impl" tier (`GPT Luna` / `Haiku`) must not be granted the Agent tool.

Grok-specific rules that bite:

- **Grok's value is cross-vendor independence + low cost, NOT superior reasoning.** That is why
  the unavailable-Grok fallback for independent review is SKIP, not delegate-to-Opus — a
  same-vendor reviewer shares the designer's blind spots and defeats the purpose. Realtime
  research falls back to Opus + WebSearch; impl/exploration tiers fall back to claude-model-policy.
- Independent review runs AFTER the Haiku review but reads **only the original document** — never
  Haiku's findings, or its viewpoint gets anchored. Haiku surfaces what is unwritten; Grok attacks
  what is written. Orthogonal, never merged.
- The definition is split in two so tools enforce the boundary: `grok-researcher`
  (Read/Grep/Glob/Bash/WebSearch/WebFetch + Serena read-only — report-only, no Agent) vs
  `grok-implementer` (adds Write/Edit/Skill/LSP/Agent + Serena editing). Route by "does this
  change files".
- **with-grok-policy does not split normal vs light impl.** Both are `Grok Implementer` with the
  Agent tool always allowed — an explicit documented exception to the shared discipline's
  "no Agent tool for the light-impl tier". The table keeps both row names because the shared
  discipline references tiers *by row name*.

## agent-policy — the generator CLI (added 2026-08-14, commit d55c187)

`src/setup-agents.ts` → bundled `scripts/setup-agents.mjs` is the single implementation behind both
wizard skills; they declare `allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *)`.

- Flags: `--profile gpt|grok`, `--check`, `--overwrite`, `--agents`, `--alias`, `--dir`.
  One JSON line on stdout. Interactive mode uses `--check` then `--agents … --overwrite`.
- `setup-gpt --yes` = `--profile gpt --overwrite`; `setup-grok --yes` = `--profile grok --overwrite`
  — no prompts, default aliases, all templates overwritten. Also usable directly from CI/scripts
  (`scripts/setup-workspace.sh` calls it headlessly).
- Templates: `skills/setup-gpt/assets/gpt-{sol,terra,luna}.template.md`,
  `skills/setup-grok/assets/grok-{researcher,implementer}.template.md`; `{{MODEL_ALIAS}}` is
  substituted. Default aliases `claude-gpt-5-6-{sol,terra,luna}` and `claude-grok-4-5`.
- Commit 74f86e2 added **Serena tools to all five templates** — symbol search (5 tools) for every
  agent, plus the 6 editing tools for Sol/Terra/Luna/Implementer but not Researcher. The matching
  rule ("use Serena to trace definitions/references/implementations") was added to
  `context-map-guide.md`.

## agent-policy — the shared discipline

Each profile skill holds **only** its role table plus profile-specific dispatch rules. The shared
discipline lives in `references/orchestration-discipline.md` (4.9KB) and, for exploration,
`references/context-map-guide.md` (6.0KB, read only when the task needs codebase exploration);
`assets/context-map-template.md` is the map template. Load-bearing rules:

- **`model` override at dispatch is enum-only** (`sonnet`/`opus`/`haiku`/`fable`). Custom aliases
  like `claude-gpt-5-6-sol` are rejected before execution and are valid **only** in an agent
  definition's frontmatter `model`. Verified 2026-07-20. This is why the GPT path dispatches by
  injecting the agent definition's body into the request text instead of overriding `model`.
- An agent whose frontmatter pins a concrete `model` is honoured as-is; only `inherit`/unset agents
  (including built-ins `Explore`/`Plan`/`general-purpose`) get retiered by the role table.
- Cost discipline: never load a skill whose body+references exceed 30KB into a subagent — transcribe
  the needed clauses into the request instead; batch ≥3-turn exploration into one dispatch; do
  2-turn transcription work yourself; no per-task commits or repo-wide grep verification in subs.
- context-map: `.claude/context-maps/YYYY-MM-DD-<slug>.md`, gitignored here. Only its §未解決事項
  propagates upward; the full map is shared by **path**, and implementers receive transcribed
  fragments, never the whole map.

## prompt-smith — how the instructions are written

Three skills:

- `prompt-smith` — the standard for AI-facing instruction docs. Scope is decided by **location**:
  CLAUDE.md, SKILL.md, `commands/*.md`, output styles, agent definition bodies, memories, and
  anything under a `references/` dir (any plugin). README / `docs/` / tutorials are out of scope
  even when an instruction doc links to them. Core rule: keep only text that changes behaviour —
  strip rationale, provenance, duplication, and criterion-free hedges (「適宜」「必要に応じて」).
  Exception: "lookup" blocks (external-spec copies, schema/field definitions, exhaustive lists) are
  exempt from the duplication/example/provenance criteria.
- `agent-creator` — creating and auditing agent definition files (frontmatter + placement + tools +
  `model`), per `references/agent-definition-spec.md` and `references/description-guide.md`.
- `skill-creator` — **a TypeScript port of Anthropic's official skill-creator** (2026-08-09/10,
  Apache-2.0, see `LICENSE`/`NOTICE`/`docs/skill-creator-port-rationale.md`). Owns skill/command
  authoring, eval-set creation and the description improvement loop. The official plugin was
  removed from this workspace precisely because the names collide.

The port's four bundles (`src/*.ts` → `scripts/*.mjs`, node26 target):

| bundle | role |
| --- | --- |
| `run-trigger-eval.mjs` | registers the target skill in a temp sandbox, runs each eval query through `claude -p`, counts a fire only when the stream-JSON shows a `Skill` tool call |
| `improve-description.mjs` | generates a new `description` from failing queries; retries missing tags, shortens >1024 chars, records runs |
| `run-loop.mjs` | splits the eval set into train/holdout, iterates measure→improve, emits best-result JSON + HTML report |
| `generate-report.mjs` | renders the loop history / train-test scores / per-query results as HTML (library, not a standalone CLI) |

`src/lib/` splits out `claude-cli`, `parse-skill-md`, `pool`, `sandbox`, `split-eval-set`,
`stream-parse`, `types`. `evals/{agent-creator,prompt-smith,skill-creator}.json` hold 20 queries
each; `skills/skill-creator/assets/eval-review.html` is the review UI. Everything routes through
`claude -p` — no Anthropic API (`mem:core`).
