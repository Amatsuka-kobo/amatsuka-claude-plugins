`plugins/agent-policy` (0.7.0-dev, pkg `agent-policy-scripts`) and `plugins/prompt-smith`
(0.3.1-dev, pkg `prompt-smith-scripts`) — the two halves of the former `optimize-agents`, split in
commit 849d3c7 (2026-08). Both are script-bearing pnpm workspace members. **This repo runs under
agent-policy itself**, now selected by the env var `AMATSUKA_AGENT_AUTO_INJECTION` (see below), not
by CLAUDE.local.md prose.

Design docs live in `harness-docs/design/`:
`2026-07-19-agent-policy-design.md`, `2026-08-01-agent-policy-prompt-smith-design.md`,
`2026-08-09-agent-policy-{codex-grok,with-grok}-policy-design.md`,
`2026-08-14-agent-policy-headless-setup-design.md` (**describes the now-removed setup CLI**),
`2026-08-16-agent-policy-bundled-agents-design.md` + matching plan, plus
`2026-08-09-prompt-smith-skill-creator-port-design.md`.
Accumulated rationale (out-of-scope decisions, cost analysis, prompt-smith scope, why `<example>`
blocks are not used): `docs/old/optimize-agents-record/` (moved under `docs/old/` in 2026-08).

## 2026-08-16 rewrite — bundled agents + env-var injection

Commits 59f8b86, 84000f8, ada0848, 2299cc9, fa004dd, 35bf3c5, ba3f8cc, 7a0df17, c9d709d.
The whole "each user generates their own agent definitions" model is **gone**:

- `setup-gpt` / `setup-grok` skills, `src/setup-agents.ts`, `scripts/setup-agents.mjs` and the five
  `*.template.md` agent templates **no longer exist**. `scripts/setup-workspace.sh` lost its two
  `claude -p "/agent-policy:setup-*"` lines. Do not cite any of them.
- **7 agent definitions ship inside the plugin** (`plugins/agent-policy/agents/`), each with a
  pinned frontmatter `model`:

  | agent | `model` | Agent tool | Write/Edit + Serena edit |
  | --- | --- | --- | --- |
  | `claude-researcher` | `sonnet` | no | no |
  | `gpt-researcher` | `claude-gpt-5-6-terra` | no | no |
  | `gpt-sol` | `claude-gpt-5-6-sol` | yes | yes |
  | `gpt-terra` | `claude-gpt-5-6-terra` | yes | yes |
  | `gpt-luna` | `claude-gpt-5-6-luna` | no | yes |
  | `grok-researcher` | `claude-grok-4-5` | no | no |
  | `grok-implementer` | `claude-grok-4-5` | yes | yes |

  All three `*-researcher` agents are report-only (Read/Grep/Glob/Bash/WebSearch/WebFetch + Serena
  find-tools + GitHub read tools). `gpt-researcher` deliberately reuses the **terra** alias.
- Sole hook: `SessionStart` → `scripts/session-start.mjs` (`src/hooks/session-start.ts`, timeout 10).
  It (1) maps `AMATSUKA_AGENT_AUTO_INJECTION` to a policy skill name and injects "load this skill
  first" as additionalContext; (2) writes `.claude/agents/<name>.md` **only when an alias env var
  differs from the default**, by rewriting the bundled definition's `model:` line; (3) reports
  generated/stale/failed files. Fail-open: always exits 0.
- Env vars (all read in `session-start.ts`):
  `AMATSUKA_AGENT_AUTO_INJECTION` = `claude` | `with-codex` | `with-grok` | `with-codex-grok` |
  `none`/unset (unknown value ⇒ warning only, no injection);
  `AMATSUKA_AGENT_GPT_SOL_ALIAS` (`claude-gpt-5-6-sol`),
  `AMATSUKA_AGENT_GPT_TERRA_ALIAS` (`claude-gpt-5-6-terra`, applies to gpt-terra **and**
  gpt-researcher), `AMATSUKA_AGENT_GPT_LUNA_ALIAS` (`claude-gpt-5-6-luna`),
  `AMATSUKA_AGENT_GROK_ALIAS` (`claude-grok-4-5`, both grok agents). `claude-researcher` has no
  alias var.
- `src/` is now just `hooks/session-start.ts` (+ its `__test__`) and `testing/run-ts.ts`;
  `scripts/` holds only `session-start.mjs`.
- **Skill selection is env-var driven, not the old `.claude/agents/` file-presence heuristic.**
  An empty `.claude/agents/` is the normal state — never "fix" it.

## The four policy skills — role tables

Each holds only its role table + profile-specific dispatch rules; the shared discipline is
`references/orchestration-discipline.md` (4.9KB) and, for exploration only,
`references/context-map-guide.md` (6.0KB). `assets/context-map-template.md` (3.9KB) is the template.

Rows common to all four: analysis + design-doc/plan authoring + exploration lead → `Opus`;
code review → `Sonnet`; advisor → `Fable`/`Opus`; design-doc review (understanding + tacit
knowledge) → `Haiku`, **mandatory before showing any design doc or plan to the user**.

Rows that differ (note: **exploration legwork, realtime research and independent review are now
dedicated `*-researcher` rows in every profile** — they used to be impl-tier work):

| row | claude-model | with-codex | with-grok | codex-grok |
| --- | --- | --- | --- | --- |
| realtime research | `Claude Researcher` | `GPT Researcher` | `Grok Researcher` | `Grok Researcher` |
| exploration legwork | `Claude Researcher` | `GPT Researcher` | `Grok Researcher` | `Grok Researcher` |
| independent review | `Claude Researcher` | `GPT Researcher` | `Grok Researcher` | `Grok Researcher` |
| complex impl | `Opus` | `GPT Sol` | `Opus` | `GPT Sol` |
| normal impl / misc | `Sonnet` | `GPT Terra` | `Grok Implementer` | `GPT Terra` |
| light impl | `Haiku` | `GPT Luna` | `Grok Implementer` | `GPT Luna` |

Rules that bite:

- The light-impl tier and every `*-researcher` are denied the Agent tool.
  **with-grok-policy is the documented exception**: `Grok Implementer` covers normal *and* light
  impl and always keeps the Agent tool.
- Independent review runs AFTER the Haiku review but reads **only the original document** — never
  Haiku's findings, or its viewpoint gets anchored. Haiku surfaces what is unwritten; the
  researcher attacks what is written. The orchestrator decides adoption; the reviewer only supplies
  counter-arguments.
- `claude-model-policy`'s independent review is same-vendor and its definition says so outright
  (「独立性は限定的である」). In with-grok/codex-grok the Grok-unavailable fallback for independent
  review is **SKIP, not delegate to Opus** — a same-vendor reviewer shares the designer's blind
  spots. Realtime research falls back to Opus + WebSearch; impl/exploration tiers fall back to the
  claude-model table (codex-grok reads exploration back onto `GPT Terra`/`Luna`).
- Dispatching to a `*-researcher` requires naming the role — 独立レビュー / リアルタイム情報調査 /
  探索実働 — in the **first line** of the request, plus that role's Output Format.
- Execution-tier resolution (checked once per session, not per task): project
  `.claude/agents/<name>.md` → bundled `agent-policy:<name>` → for GPT, the `codex@openai-codex`
  plugin (`/codex:rescue --model gpt-5.6-{sol,terra,luna}`) → claude-model table. For Grok, step 3
  is the SKIP/fallback section.

## The shared discipline (`references/orchestration-discipline.md`)

- **`model` override at dispatch is enum-only** (`sonnet`/`opus`/`haiku`/`fable`). Custom aliases
  like `claude-gpt-5-6-sol` are valid **only** in an agent definition's frontmatter. This is why the
  GPT/Grok path dispatches by injecting the definition body into the request text and forbids
  `model` override.
- An agent whose frontmatter pins a concrete `model` is honoured as-is (all 7 bundled ones do);
  only `inherit`/unset agents (incl. built-ins `Explore`/`Plan`/`general-purpose`) get retiered.
- Cost discipline: never load a skill whose body+references exceed 30KB into a subagent — transcribe
  the needed clauses instead; batch ≥3-turn exploration into one dispatch; no per-task commits or
  repo-wide grep verification in subagents.
- Subagents load **only** the skills named in their request; if none are named, they load none.
- context-map: `.claude/context-maps/YYYY-MM-DD-<slug>.md`, gitignored here. Only §未解決事項
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
