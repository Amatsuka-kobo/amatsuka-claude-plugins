`plugins/agent-policy` (0.14.0-dev, pkg `agent-policy-scripts`) and `plugins/prompt-smith`
(0.3.2-dev, pkg `prompt-smith-scripts`) — the two halves of the former `optimize-agents`, split in
commit 849d3c7 (2026-08). Both are script-bearing pnpm workspace members. **This repo runs under
agent-policy itself**, selected by the env var `AMATSUKA_AGENT_AUTO_INJECTION` (see below), not by
CLAUDE.local.md prose.

Design docs live in `harness-docs/design/`:
`2026-07-19-agent-policy-design.md`, `2026-08-01-agent-policy-prompt-smith-design.md`,
`2026-08-09-agent-policy-{codex-grok,with-grok}-policy-design.md`,
`2026-08-14-agent-policy-headless-setup-design.md` (**superseded**),
`2026-08-16-agent-policy-bundled-agents-design.md` (**superseded**),
`2026-08-25-agent-policy-setup-agents-design.md` (**superseded**),
`2026-08-27-agent-policy-external-agent-model-assignment-design.md` (composition; still in force),
`2026-08-31-agent-policy-two-profile-design.md` (**current**) + its plan
`harness-docs/plans/2026-09-04-agent-policy-two-profile-implementation.md`,
plus `2026-08-09-prompt-smith-skill-creator-port-design.md`.
Accumulated rationale: `docs/old/optimize-agents-record/`.

## Current shape (2026-09-04, the two-profile reorganisation)

Three earlier generations are recorded in git but **must not be cited as current**: the 2026-08-16
"7 bundled agents, hook writes files" model, the 2026-08 4-preset model with separate `setup-gpt` /
`setup-grok` skills, and the 2026-08-25 four-policy model (claude-model / with-codex / with-grok /
codex-grok). All are gone.

The plugin now ships **two profiles**, selected by `AMATSUKA_AGENT_AUTO_INJECTION`
(`none` / `claude` / `custom`; the three legacy values `with-codex` / `with-grok` /
`with-codex-grok` are treated as `custom` and draw a migration notice):

- **claude** — `claude-model-policy`. Claude model names pin each role band. Zero setup. Every
  reference to the role-marker mechanism was removed from this skill; the resolution order is now
  just "dispatch with a `model` override, read-only bands to built-in `Explore`, impl bands to
  `general-purpose`".
- **custom** — `custom-policy`. The 担当表 holds **role bands only**, plus a *recommended* model
  column that binds nothing. The actual delegate comes from the role-marker table SessionStart
  injects. Models and roles are not constrained against each other.

- **No agent definitions ship.** `agents/`, `src/agents/presets.ts` and `build-presets.ts` were
  deleted. Naming `agent-policy:gpt-sol` etc. no longer resolves; the replacement is `setup-agents`
  generating a recommended set.
- **3 skills**: `claude-model-policy`, `custom-policy`, `setup-agents`.
- `src/`: `setup-agents.ts` (the CLI), `agents/{policies,live-models,roles,fragments,compose,
  vocabulary,mcp,hash}.ts`, `hooks/{session-start,subagent-start,delegation-gate,parallel-nudge}.ts`,
  `testing/{run-ts.ts,fake-models-server.ts,fake-claude.mjs}`.

### Role fragments and the 10 role IDs

Unchanged from the previous generation (3-stage resolution, vendor overlays last-wins via a map,
`vocabulary.ts` per-language headings, `languageMismatch` warning). One addition: `Vendor` now
includes `"none"`, which means *no overlay, colour `blue`*. `"none"` is folded to `undefined`
before reaching `loadFragments` — there is no `.none.md` fragment.

### `policies.ts` — what is canonical now

- `ASSIGNMENTS: Record<"claude-model-policy", Record<RoleId, ModelId[]>>` — the claude profile's
  table. Doubles as the fallback target and as the read-across target when retiering a non-Claude
  band to an enum.
- `RECOMMENDED: Record<RoleId, ModelId[]>` — the custom profile's *recommendation*. Values are
  inherited verbatim from the old `codex-grok-policy` row and pinned by a test.
- `isCustomInjection(value)` — trims + lowercases, then matches `custom` plus the three legacy
  values. Both SessionStart and SubagentStart route through it, so the two cannot drift.
- **Gone**: `aliasEnv` on `ModelSpec`, `resolveModelValue`, `rolesAcrossPolicies`. The four
  `AMATSUKA_AGENT_*_ALIAS` env vars are **no longer read**; SessionStart only warns that they are
  ignored. Model existence is grounded in the proxy's `/v1/models`, so alias substitution has no
  problem left to solve.
- `modelsFor()` / `rolesFor(model)` lost their policy argument — they are claude-only.
- `allowsAgentTool(ids, model?)` takes the model optionally; omitted, only the role-based exclusion
  applies (the free-alias path cannot know the ModelId).

### `live-models.ts` — grounding in the proxy

`fetchLiveModels(env)` GETs `<ANTHROPIC_BASE_URL>/v1/models` once, 3 s timeout, and **never
throws** — every failure folds into `{ok: false, reason}` (`no-base-url` / `http-<status>` /
`timeout` / `parse-error` / `fetch-failed`). Auth is one shot: `ANTHROPIC_AUTH_TOKEN` as Bearer →
`ANTHROPIC_API_KEY` as `x-api-key` → unauthenticated. **No variable is assumed to exist.** Vendor
is inferred from lowercased `owned_by` (`openai`→gpt, `xai`→grok, `anthropic`→claude, else
unknown). Claude enums are never put in `ids`; callers add them separately.

Measured against CLIProxyAPI: client-side aliases appear verbatim in `data[].id`, `owned_by` came
back lowercase for all 8 entries, unauthenticated returns 401 `Missing API key`.

### The four hooks

| hook | matcher | what it does |
| --- | --- | --- |
| SessionStart | — | injects the policy skill; under custom, validates model existence first |
| SubagentStart | — | always distributes the discipline fragment; the marker table **only under custom-family injection** |
| PreToolUse | `Edit\|Write\|NotebookEdit\|mcp__.*` | delegation gate (opt-in; denies edits to protected globs) |
| PreToolUse | `Task\|Agent` | parallel nudge (on by default; one fixed additionalContext line) |

**Matcher semantics, measured**: a value containing only alphanumerics / `_` / `-` / space / `,` /
`|` is an **exact enumeration**; anything else makes it a **JavaScript regex**. So `Task|Agent`
matches those two names and `mcp__.*` matches every MCP tool. The dispatch tool is named
**`Agent`**, not `Task`, in CLI 2.1.260 — the enumeration covers both.

Also measured: a subagent's own tool calls carry `agent_id` + `agent_type`; the main session's do
not. That one difference is what lets the gate wave subagents through.

### SessionStart's custom validation — it still never writes files

1. Scan `.claude/agents/` and keep **only definitions carrying a non-empty `agent-policy-role`**.
   Zero of them → fall back to claude and say "not created, or unreadable" (`scanAgents` folds read
   failures into an empty array, so the two cases are indistinguishable).
2. From those definitions' `model` values, drop the Claude enums, `inherit`, and a missing `model`
   key. Empty remainder → hold without querying.
3. Otherwise query live models. All present → inject `custom-policy` + the marker table (each row
   annotated with its vendor) + the unknown-role notice. **Any absent, or the query failed → fall
   back to claude for the whole session**, list the offending definitions (max 10 + "他 N 件"), name
   the reason, and add a one-line repair hint. The marker table is **not** injected on fallback.

The judgement freezes at SessionStart; a proxy recovering mid-session goes unnoticed. `build()` is
async now, but the outer try/catch still guarantees stderr + exit 0 and no file writes.

### `delegation-gate.ts` — opt-in, measured to work

Eight early returns; deny is reachable only at the last. Opt-in needs **both**
`AMATSUKA_AGENT_DELEGATION_GATE` ∈ {`1`,`true`,`on`} **and** a project config at
`.claude/agent-policy/delegation-gate.json` (`denyGlobs` required; `mcpTools` and `ttlSeconds`
optional). Built-in `Edit`/`Write` (`file_path`) and `NotebookEdit` (`notebook_path`) are always in
scope. Glob matching uses `node:path`'s `matchesGlob` — no hand-rolled implementation. The deny
reason embeds the marker table, so the model is told *who* to delegate to.

`--direct on|off|status` touches a TTL flag file. **That is the only write path**; the hook path
writes nothing. Known holes, accepted: Bash writes cannot be stopped, and the AI could run
`--direct on` itself — the wording forbids both and compliance is all there is.

Verified 2026-09-04 in a sandbox (`claude -p --plugin-dir <plugin>`): the deny fired, the model
quoted the reason verbatim, did not route around it, and noticed on its own that the suggested
delegate lacked `Write`.

### `setup-agents` — custom-only now

Wizard: language → live models → per-model name/model/roles/vendor/keep → MCP servers.
Non-interactive `--yes` means "generate the recommended set".

- **Gone**: `--policy`, `--list-policies`, `--list-models`. Passing them returns `ok: false`.
- **New**: `--list-live-models` (`{ok, reason?, models:[{id, vendor, recommendedFor}], claudeEnums}`)
  and `--vendor gpt|grok|claude|none`.
- `--model <alias>` is checked against live `ids` + Claude enums **on `--write`**; a failed query
  skips the check and passes with a warning.
- `--models <csv>` still means recommended ModelIds. On a successful query, IDs whose default alias
  is absent are dropped and reported in `modelsDropped`; on a failed query nothing is dropped and a
  warning is emitted instead. Warnings ride in the response JSON's `warnings` array — stdout JSON is
  the only channel back to the skill.
- The 担当表 constraint is **gone**: any role may go to any model. Off-recommendation pairings
  warn rather than reject. The impl/readonly kind-mixing warning stays.
- `agent-policy-vendor` is written into generated frontmatter (omitted when `none`) and read back by
  `marker-scan.ts`. **It had to be added to the composition allow-list in
  `orchestration-discipline.md`** — without that, every generated definition becomes
  composition-ineligible and the 2026-08-27 composition mechanism dies.
- Diff protection (`--check` / `--write` / `--merge` / `--keep`), fragment translation and MCP grant
  are **unchanged**. The test helper lost its fixed `--policy`, but all 16 merge/keep test names
  survived the rewrite.

### A known design inconsistency (reported, unresolved)

Design §7.2 says the non-interactive mode asks nothing; §7.1 says `--vendor` is required when the
inference is `unknown`. Both cannot hold. The implementation stops with `ok: false` and the skill
directs the user to finish interactively. Harmless in practice (all 8 measured entries inferred
cleanly), but do not treat either clause as absolute.

## The two policy skills — role tables

Each holds its own table plus profile-specific dispatch rules; the shared discipline is
`references/orchestration-discipline.md` and, for exploration only, `references/context-map-guide.md`.
`assets/context-map-template.md` is the template.

`claude-model-policy` keeps a model column (`ASSIGNMENTS`). `custom-policy`'s column is a
*recommendation* (`RECOMMENDED`) whose values match the old codex-grok row: complex-impl→GPT Sol,
normal-impl/general→GPT Terra, light-impl→GPT Luna, explore/realtime-research/independent-review→
Grok, doc-review→Haiku, code-review→Sonnet, advisor→Fable/Opus. `policy-skill-assignments.test.ts`
pins both tables against their canonical source; the parser matches a row by `startsWith(label)`,
which is why rows may carry parenthetical annotations.

Rules that bite:

- The light-impl tier is denied the Agent tool.
- **Custom's execution-tier resolution**: (1) a band present in the marker table uses that
  definition; (2) a band absent from it is read across to `claude-model-policy`'s model for the same
  band — **except independent-review, which is skipped rather than read across**, because a
  same-vendor reviewer shares the designer's blind spots. Step 2 is the *configuration default* for
  partial setups, not the failure fallback (that one is whole-session and lives in SessionStart).
- Mid-session unavailability of a delegate follows the same rule: read across, except
  independent-review which is skipped.
- Independent review runs AFTER the doc-review band but reads **only the original document** — never
  the other reviewer's findings, or its viewpoint gets anchored. The orchestrator decides adoption.
- Dispatching a read-only role to an implementation-tier agent (one holding `Write`/`Edit`) requires
  spelling out in the request: restrict tools to read-only, change no files, return a report only.

## The shared discipline (`references/orchestration-discipline.md`)

- **`model` override at dispatch is enum-only** (`sonnet`/`opus`/`haiku`/`fable`). Custom aliases
  like `claude-gpt-5-6-sol` are valid **only** in an agent definition's frontmatter. This is why the
  GPT/Grok path dispatches by injecting the definition body into the request text and forbids
  `model` override.
- `CLAUDE_CODE_SUBAGENT_MODEL`, if set, overrides a definition's frontmatter `model` — do not set it
  when per-definition models matter.
- An agent whose frontmatter pins a concrete `model` is honoured as-is; only `inherit`/unset agents
  (incl. built-ins `Explore`/`Plan`/`general-purpose`) get retiered.
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

The port's four bundles (`src/*.ts` → `scripts/*.mjs`, node22 target):

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
