`plugins/agent-policy` (0.19.6-dev, pkg `agent-policy-scripts`) and `plugins/prompt-smith`
(0.4.0-dev, pkg `prompt-smith-scripts`) — the two halves of the former `optimize-agents`, split in
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
`2026-09-07-agent-policy-orchestrator-analysis-design.md` (**current**, adds the 2 upstream bands)
+ its plan `harness-docs/plans/2026-09-07-agent-policy-orchestrator-analysis-implementation.md`,
`2026-09-09-agent-policy-profile-unification-design.md` (**current, 2nd ed., the 0.18.0-dev
candidate-set model**) + its plan
`harness-docs/plans/2026-09-09-agent-policy-profile-unification-implementation.md` (2nd ed.),
`2026-09-16-agent-policy-doc-writing-role-design.md` (**current, the 0.19.0-dev `doc-writing`
role + `gemini` vendor + Agent-tool-by-role-only change**) + its plan
`harness-docs/plans/2026-09-16-agent-policy-doc-writing-role-plan.md`,
plus `2026-08-09-prompt-smith-skill-creator-port-design.md`.
Its §11 lists 15 rejected alternatives — read it before re-proposing anything about fragment
distribution, per-hook scope predicates, or `--policy`.
Accumulated rationale: `docs/old/optimize-agents-record/`.

## Current shape (2026-09-04, the two-profile reorganisation)

Three earlier generations are recorded in git but **must not be cited as current**: the 2026-08-16
"7 bundled agents, hook writes files" model, the 2026-08 4-preset model with separate `setup-gpt` /
`setup-grok` skills, and the 2026-08-25 four-policy model (claude-model / with-codex / with-grok /
codex-grok). All are gone.

The plugin now ships **two profiles**, selected by `AMATSUKA_AGENT_AUTO_INJECTION`
(`none` / `claude` / `custom`; the three legacy values `with-codex` / `with-grok` /
`with-codex-grok` are treated as `custom` and draw a migration notice):

- **claude** — `claude-model-policy`. Zero setup. Holds **no table** and, since 0.18.0-dev, **no
  resolution order either**: one paragraph saying the delegate's `model` comes from the 担当表's
  "Claude モデル" column, and that *who* to delegate to follows the discipline's §委譲先の解決.
  **SessionStart now injects a marker table here too**, narrowed to the claude-only candidate set.
- **custom** — `custom-policy`. Also no table and no resolution order since 0.18.0-dev. Its one
  paragraph says external-vendor definitions are *also* candidates, and points at §委譲先の解決;
  the "Claude モデル" column is only the read-across target when a delegate's `model` is undecided.
  Models and roles are not constrained against each other.

**Delegate resolution lives in ONE place since 0.18.0-dev**: `orchestration-discipline.md`
§委譲先の解決, with two subsections. *委譲先の候補*: project `.claude/agents/` definitions whose
`model` runs on Claude (`sonnet`/`opus`/`haiku`/`fable`/`inherit`/absent) **and** whose
`agent-policy-vendor` is absent/`claude`/`none`; custom adds external-vendor definitions on top.
The table's **2nd line** tells the reader which scope is in force. The candidate set applies to
**both** step 1 and step 2. *解決順*: (1) role present in the marker table → that definition;
(2) absent but a candidate's remit fits → that definition; (3) otherwise built-ins (`readonly` →
`Explore`, `impl` → `general-purpose`). **Built-ins are the LAST resort, not the first choice** —
the old "readonly bands go to `Explore`" wording was wrong and is gone from both skills.
`independent-review` never advances past step 1; it is skipped rather than read across.

**Terminology since 0.17.1-dev (2026-09-09): the word 「帯」 is gone.** A role band is just
「役割」; the table's first column is 「役割名」. **The discipline section is `## 担当表`** (renamed
from `## 役割` in the same 0.17.1-dev working tree) and the policy skills' 「実行役割の解決順」
section **no longer exists** — 0.18.0-dev folded it into the discipline's 「委譲先の解決」. Hook-injected strings (`marker-scan.ts`,
`delegation-gate.ts`) and `assets/roles/ja/{_common,escalation}.md` use 「役割」 too; generated
`.claude/agents/*.md` keep 「帯」 until regenerated (harmless). The user found 「帯」 unclear
Japanese; 「役割ラベル」 was rejected because it collides with `ROLES[].label`. Design docs from
0.17.0 and earlier still say 「帯」 — read them as 「役割」. Do not reintroduce 「帯」.

**The 担当表 lives in exactly one place since 0.17.0-dev (2026-09-09)**: `references/
orchestration-discipline.md` **§担当表** — 17 rows × 5 columns (役割名 / RoleId / 種別 / Agent Tool /
Claude モデル). Its canonical sources are `ROLES[].label/id/kind`, `allowsAgentTool`, and
`ASSIGNMENTS["claude-model-policy"]`; `src/agents/__test__/discipline-role-table.test.ts` pins all
five columns and also asserts that **neither policy SKILL.md contains a Markdown table** (any line
starting with `|`) nor a `## 担当表` / `## 役割` / `## 役割の帯` / `## モデル別役割` /
`## 役割の帯と推奨モデル` heading. **Two traps in that test** (both fixed in 0.18.0-dev): its
heading regex must match `## 担当表`, and its separator-row parser must accept `/^-+$/` — the
working-tree table uses long dash runs, not exactly `---`, so fixing only the heading leaves the
same 8 failures with a different message. `## 委譲先の解決` sits **after** the 担当表 section's
table and its four trailing bullets — putting it right after the heading would make
`extractRoleBandSection` (which stops at the next `## `) lose the table and re-break those 8. The
old `policy-skill-assignments.test.ts` is deleted. Design:
`harness-docs/design/2026-09-09-agent-policy-band-catalog-consolidation-design.md`.

- **No agent definitions ship.** `agents/`, `src/agents/presets.ts` and `build-presets.ts` were
  deleted. Naming `agent-policy:gpt-sol` etc. no longer resolves; the replacement is `setup-agents`
  generating a recommended set.
- **3 skills**: `claude-model-policy`, `custom-policy`, `setup-agents`.
- `src/`: `setup-agents.ts` (the CLI), `agents/{policies,live-models,roles,fragments,compose,
  vocabulary,mcp,hash}.ts`, `hooks/{session-start,subagent-start,delegation-gate,parallel-nudge}.ts`,
  `testing/{run-ts.ts,fake-models-server.ts,fake-claude.mjs}`.

### Role fragments and the 17 role IDs

**17 role IDs since 2026-09-16 (0.19.0-dev)**: `complex-impl, normal-impl, light-impl, escalation,
general, design-plan, doc-writing, explore-lead, explore, realtime-research, e2e-verify,
independent-review, doc-review, code-review, final-review, gate-review, advisor`.

**`doc-writing` (文書作成 / Document Authoring), added 0.19.0-dev**: `kind: impl`, full impl tool
set, **Agent Tool 否** (in `SOLO_DENIED_ROLES`, appended at the end), `ASSIGNMENTS` = Sonnet,
`RECOMMENDED` = `["sonnet", "gemini-flash", "gpt-terra"]`, default-name `writer`. Sits right after
`design-plan` — **not** at the end, because `roles.test.ts` pins `roleOrder("advisor") ===
ROLES.length - 1`. Remit: documents that AI reads (Skills / Agents / Rules / References / CLAUDE.md /
Output Styles / hook-injected text / prompts / handover notes), code comments, other documents, and
— for design docs / plans / context-maps — **only the write-up/revision/translation after the content
is decided**; the first draft stays with `design-plan` / `explore-lead` (discipline L166 unchanged).
`general` lost its documentation remit (now routine maintenance + "fits no other role"). The ja
fragment carries the writing discipline (意訳 not 直訳, correct grammar, concise, no roundabout
phrasing, minimal citations) plus 4 Japanese wording examples (版→バージョン, 緑/赤→パス/失敗,
凍結文書→確定版の文書, 台帳→一覧/管理表/ログ); the en fragment has the discipline only.
**Fragment bodies must not use `###`** — `fragments.ts` collects body lines per `## ` heading, so a
`###` line is swallowed into the previous section and leaks into other roles' bullets on compose.

**Two re-delegation rules were added with it (design §2.4 D / §2.5 F).** *D1 (subagent-facing)*:
impl-role subagents writing a **file-persisted document** must re-delegate to the 「文書作成」
definition if the marker table has one, else write it themselves (no hand-back); report bodies are
out of scope; design-plan/explore-lead write the first draft themselves. It lives in `_common.md`'s
`## Agent tool の制約` / `## Agent tool limits` section (emitted only when `withAgent` is true) and
is the 10th 「サブエージェントは〜」 clause in the discipline. Re-delegation requests in both
language `_common.md` fragments must not include finished prose ready to use in the target file.
**The en `_common.md` must contain no Japanese** — `compose.test.ts` has an English-purity check; a
「文書作成」 label was tried and reverted. Both language `doc-writing.md` fragments require the
Document Authoring role to treat requester-supplied finished prose as a draft and rewrite it in its
own words instead of transcribing it. *F1 (orchestrator-facing)*: four bullets at the end of
§オーケストレーターが自ら担う作業 — the orchestrator does not write file-persisted documents
itself (incl. handover notes and `docs/prompts/` goal prompts), passes decided content + target path
+ references in the request, and document-authoring requests contain only facts, decisions,
constraints, acceptance criteria, outline, terminology, and reference paths as bullets, tables, or
keywords; target-file-style paragraphs and finished prose ready to paste are excluded. Requirement
and judgement bullets in a request remain out of scope for the file-writing rule. These clauses are
in `references/orchestration-discipline.md`, `assets/roles/ja/_common.md`,
`assets/roles/en/_common.md`, `assets/roles/ja/doc-writing.md`, and `assets/roles/en/doc-writing.md`.

**Delegation-request examples (0.19.6-dev).** An explanatory example from a requester was copied
verbatim into a document in three consecutive attempts; `harness-docs/GOTCHAS.md` records the
failure as `GOTCHA-002`. The rule reverses the default: requesters mark an example only when it is
to appear in the produced document, with `本文に載せる`; every unmarked example is explanatory
request context. Three sender rules were added to §文書作成を委譲するとき: mark only
output examples; state in the request that marked examples are not a closed list; and, when asking
for an item in an AI-facing document to be rewritten, provide the decision criteria first, add an
example only if the criteria alone do not convey the result, and do not delegate until those criteria
can be stated. §サブエージェントの規律 gained two corresponding recipient rules: treat unmarked
examples as explanatory context and write independently chosen wording; present marked examples
with the decision criteria rather than as a closed list. The recipient rules are in this section
because only its clauses are transcribed into a delegation request; the sender rules apply only to
the requester. Both `assets/roles/ja/_common.md` and `assets/roles/en/_common.md` gained two
matching rules: sender-side rules in nested bullets for re-delegation request contents, and
recipient-side rules in the constraints section. The English fragment says to mark examples intended
for the produced document without reproducing the Japanese marker, because `compose.test.ts`
enforces English purity. Two alternatives were rejected: adding examples to the L74 allow-list
would make every example unconditionally usable and erase the distinction; banning explanatory
examples would miss the cause, because two of the three failures happened without an example.
`pnpm run test` passed (2307 passed / 2 skipped), as did `pnpm run lint` and `pnpm run typecheck`.

**Agent Tool is decided by role only since 0.19.0-dev.** `allowsAgentTool(ids)` lost its `model`
argument; `AGENT_DENIED_MODELS` (Haiku) is gone; `light-impl` moved to Agent Tool 可. The
`ComposeInput.modelId` / `Target.composeModelId` plumbing was **removed in 0.19.1-dev**
(2026-09-16, commit `99eb595`); it had been assigned in 3 places and read in none, and neither the
type checker nor lint could see it (an optional interface field with no reader). `Target.modelId`
(the recommended-model id) is a different thing and stays.

The older two — `design-plan`
(設計書・実装計画書(WBS)の作成) and `explore-lead` (コードベース探索統括) — sit between `general`
and `explore`, are `kind: impl`, carry the complex-impl tool set, are Agent-tool-allowed, and are
Opus-only in both `ASSIGNMENTS` and `RECOMMENDED`. They used to be labelled "orchestrator's own
work"; that premise (orchestrator = Opus) was wrong because the orchestrator's model is
session-dependent. **Every band in the 担当表 is a subagent role.** The orchestrator keeps only
dispatch / requirement fixing / adoption decisions / approval / analysis (analysis = cross-checking
reports, requirement analysis, root-cause analysis — legwork may be delegated, conclusions may
not). That declaration lives in **one place only**: `orchestration-discipline.md` §オーケストレーター
が自ら担う作業. It is deliberately **not** repeated in either policy SKILL.md (prompt-smith's
no-duplication rule). `compose.test.ts` also checks `assets/roles/en` (id/default-name/tools/kind
must match ja; `label` may differ).

Fragment loading is otherwise unchanged from the previous generation (3-stage resolution, vendor overlays last-wins via a map,
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
  values.
- **Candidate-set canon, added 0.18.0-dev.** `type CandidateScope = "claude-only" | "with-external"`;
  `CLAUDE_ENUM_MODELS = ["sonnet","opus","haiku","fable"]` (**this order** — the wizard's
  presentation order, NOT `MODELS`' definition order, which starts with opus; the test compares the
  two as *sets*); non-exported `CLAUDE_RESOLVED = CLAUDE_ENUM_MODELS + "inherit"`;
  `runsOnClaude(model)` (true for `undefined`); `candidateScopeFor(value)` → `with-external` for
  custom-family, `claude-only` for `claude`, else `undefined`. **All three hooks call
  `candidateScopeFor`** — do not add a per-hook predicate; only the undefined fallback differs
  (SessionStart decides from its validation result, SubagentStart emits `NO_MARKERS`,
  delegation-gate falls to `claude-only`).
- **`policyForInjection` must NOT be used to derive the CLI's `--scope` default.** It only `trim()`s
  (no lowercase) and returns `undefined` for the three legacy values, so `with-codex` and `CuStOm`
  would make the CLI and the hooks disagree on the same env. Use `candidateScopeFor`.
- **Gone**: `aliasEnv` on `ModelSpec`, `resolveModelValue`, `rolesAcrossPolicies`. The four
  `AMATSUKA_AGENT_*_ALIAS` env vars are **no longer read**; SessionStart only warns that they are
  ignored. Model existence is grounded in the proxy's `/v1/models`, so alias substitution has no
  problem left to solve.
- `modelsFor()` / `rolesFor(model)` lost their policy argument — they are claude-only.
- `allowsAgentTool(ids)` — role-only since 0.19.0-dev (the `model?` parameter and
  `AGENT_DENIED_MODELS` were removed).
- **`gemini-flash` ModelId + `gemini` Vendor, added 0.19.0-dev.** `MODELS` now has 10 entries;
  `gemini-flash` is appended at the end (index 9) so the `MODELS.at(7)`/`at(8)` assertions stay
  intact. `model: "claude-gemini-3-8-flash"`, colour `green`. `Vendor` =
  `"gpt" | "grok" | "gemini" | "claude" | "none"`; `COLORS` / `VENDOR_COLORS` / the `--vendor`
  validator / the inference-failure message all list 5 values. No `.gemini.md` overlay fragment.

### `live-models.ts` — grounding in the proxy

`fetchLiveModels(env)` GETs `<ANTHROPIC_BASE_URL>/v1/models` once, 3 s timeout, and **never
throws** — every failure folds into `{ok: false, reason}` (`no-base-url` / `http-<status>` /
`timeout` / `parse-error` / `fetch-failed`). Auth is one shot: `ANTHROPIC_AUTH_TOKEN` as Bearer →
`ANTHROPIC_API_KEY` as `x-api-key` → unauthenticated. **No variable is assumed to exist.** Vendor
is inferred from lowercased `owned_by` (`openai`→gpt, `xai`→grok, `anthropic`→claude,
`antigravity`→gemini since 0.19.0-dev, else unknown — **`google` is deliberately NOT mapped**; it
was never observed, and `antigravity` is the measured value CLIProxyAPI returns for Gemini aliases).
The return type is `LiveVendor = Exclude<Vendor, "none"> | "unknown"` (imports `Vendor` from
`fragments.ts`; the old local union is gone). Adding a case is **not** type-enforced — forgetting it
only surfaces as a `resolveVendor` throw when the live query succeeds. Claude enums are never put in `ids`; callers add them separately.

Measured against CLIProxyAPI: client-side aliases appear verbatim in `data[].id`, `owned_by` came
back lowercase for all 8 entries, unauthenticated returns 401 `Missing API key`.

### The four hooks

| hook | matcher | what it does |
| --- | --- | --- |
| SessionStart | — | injects the policy skill; under custom, validates model existence first |
| SubagentStart | — | injects **only** the marker table, scoped by `candidateScopeFor` (claude → claude-only, custom-family → with-external, else the `NO_MARKERS` line). The discipline fragment is **gone** since 0.18.0-dev |
| PreToolUse | `Edit\|Write\|NotebookEdit\|mcp__.*` | delegation gate (opt-in; denies edits to protected globs) |
| PreToolUse | `Task\|Agent` | parallel nudge (on by default; one fixed additionalContext line dispatching independent work in the same message; sequence only when the previous output is needed or the workflow prescribes sequential order) |

**Marker-table row format since 0.19.1-dev (2026-09-16)**: each row is
`- <role label> [<RoleId>]: <definition name(s)>`. The generated common-discipline clauses
(`_common.md`, **both** languages) and the discipline's two 「サブエージェントは〜」 clauses look
rows up **by RoleId, not by label text** — this is what lets `--lang en` definitions match a table
whose labels are always Japanese. `marker-scan.ts`'s role-line template is the only place the
format is decided; `marker-scan.test.ts` pins both the whole table (`toBe`) and the per-row shape
(`/^- .+ \[[^\]]+\]: /` — deliberately **not** `[a-z0-9-]+`, because project-defined role ids have
no documented charset and `my_role` must pass). Design:
`harness-docs/design/2026-09-16-agent-policy-role-table-language-design.md`.

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
   annotated with its vendor, `with-external` scope) + the unknown-role notice. **Any absent, or the
   query failed → fall back to claude for the whole session**, list the offending definitions
   (max 10 + "他 N 件"), name the reason, and add a one-line repair hint. **Since 0.18.0-dev the
   marker table IS injected on fallback**, narrowed to the `claude-only` candidate set, together with
   `unknownRoleBlock` over the same narrowed set (`claudeBlocks()`); block order is
   policy → reason → repair → table. The `claude` branch uses the same helper.

The judgement freezes at SessionStart; a proxy recovering mid-session goes unnoticed. `build()` is
async now, but the outer try/catch still guarantees stderr + exit 0 and no file writes.

**Known accepted divergence — do NOT "fix" it in code.** On a custom→claude fallback, SessionStart
narrows to `claude-only` (it knows the validation failed) while SubagentStart and delegation-gate
still see only the env var and stay `with-external`, so the child's table lists external
definitions the parent already ruled out. SubagentStart cannot query the proxy (a per-spawn HTTP
round trip was rejected in `two-profile-design` §13), and recording the fallback in a state file was
rejected because it is project-scoped: a concurrent *successful* custom session's children would be
wrongly clamped to `claude-only`, a wider harm than the one being closed. The chosen cover is a
discipline clause telling the orchestrator to state, in the request text, that external-vendor
definitions are not delegation targets when a fallback was announced. Forgetting it degrades to
today's behaviour — no worse.

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

### `setup-agents` — both scopes since 0.18.0-dev

**`--scope claude|custom`** is the entry point (wizard step 0b asks once, then threads the value
through *every* CLI call). It maps to `CandidateScope`; **omitted, it defaults to
`candidateScopeFor(process.env.AMATSUKA_AGENT_AUTO_INJECTION) ?? "claude-only"`** — the CLI did not
read that env var before 0.18, so this is a behaviour change (README migration item 6 spells it
out). `--scope claude` never queries the proxy (`--list-live-models` and the normal `--write` path
both skip `fetchLiveModels`), drops non-Claude ids from `--models` into `modelsDropped`, **rejects
`--model-id gpt-sol` and a non-enum `--model`** (the `--model-id` path sits outside the `--models`
filter, so it needs its own guard), excludes external-vendor definitions from `--list-coverage`
coverage, and sources uncovered-role recommendations from `ASSIGNMENTS["claude-model-policy"]`
instead of `RECOMMENDED`. `CLAUDE_ENUMS` is gone; `policies.ts`' `CLAUDE_ENUM_MODELS` is the canon.
The removed-flag message is now `use --scope claude|custom to choose the candidate scope`.

**Test trap**: `setup-agents.test.ts`' `AMBIENT_ENV_VARS` deliberately strips
`AMATSUKA_AGENT_AUTO_INJECTION` from child processes, so **every pre-existing case runs as
"injection unset" → `claude-only`**, which breaks the ~42 cases whose helpers (`check()`,
`writeArgs()`) hardcode `--model-id gpt-sol`. Callers pass `--scope custom` explicitly; do **not**
bake it into the helpers, or the new default becomes untestable.

### `setup-agents` — earlier notes

Wizard: language → live models → per-model name/model/roles/vendor/keep → MCP servers.
Non-interactive `--yes` means "generate the recommended set".

- **Gone**: `--policy`, `--list-policies`, `--list-models`. Passing them returns `ok: false`.
- **New**: `--list-live-models` (`{ok, reason?, models:[{id, vendor, recommendedFor}], claudeEnums}`)
  and `--vendor gpt|grok|gemini|claude|none` (5 values since 0.19.0-dev).
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

## The two policy skills and the shared 担当表

Neither skill holds a table, and since 0.18.0-dev neither holds a resolution order either — both are
down to one paragraph plus their profile-specific notes. The shared discipline is
`references/orchestration-discipline.md` (**24,316 B**, holds both the 担当表 and
§委譲先の解決) and, for exploration only, `references/context-map-guide.md` (6,169 B); the two
total **30,485 B**, leaving **235 B** below the 30,720 B ceiling. Before adding another clause,
remove an existing one or split the document. `assets/context-map-template.md` is the template.
**`references/subagent-discipline.md` was deleted in 0.18.0-dev** — SubagentStart no longer ships a
discipline fragment, so the "サブエージェントは〜" clauses (now **12**, a contiguous block in
§モデル別役割の運用) reach children only by transcription into the request text, plus the generated
definitions' own `_common.md` body. Under `none`/unset that leaves `_common.md` as the sole path —
an **intentional** degradation, not a regression.

`RECOMMENDED` in `policies.ts` still exists but is now **setup-agents-only** (`--list-live-models`
`recommendedFor`, `--list-coverage` `models`); no skill shows it. Read values from `policies.ts` —
as of 0.19.0-dev: complex-impl→Opus/GPT Sol, design-plan/explore-lead→Opus only,
doc-writing→Sonnet/Gemini Flash/GPT Terra, normal-impl→Sonnet/GPT
Luna/Grok, light-impl→Haiku/GPT Luna/Grok, general→Sonnet/GPT Luna, explore→Sonnet/Grok/GPT Terra,
realtime-research/independent-review→Sonnet/Grok, doc-review→Haiku, code-review→Sonnet,
escalation/final-review/gate-review/advisor→Fable/GPT Astra, e2e-verify→Sonnet/GPT Astra.
In `ASSIGNMENTS` (claude profile, = the 担当表's "Claude モデル" column) advisor is **Fable only**
since 0.16.0-dev. When Fable cannot start, subagents hand the question back instead of consulting.
The 担当表 rows use `ROLES[].label` verbatim (no parenthetical annotations any more); the test
matches by exact equality.

Three rules that used to be duplicated across both SKILLs now live only in the discipline:
Agent-Tool denial (now the 担当表's "Agent Tool" column), the "name the band + Output Format in the
request" rule, and the read-only-band-to-Write/Edit-definition wording. The independent-review
procedure is also discipline-only (§設計・実装計画の規律); custom keeps just its skip-exception.
`ja/_common.md` L14 says 「対応表」 (was 「担当表」 — subagents never see the 担当表).

Rules that bite:

- Agent tool is denied to advisor / doc-review / code-review / final-review / gate-review /
  doc-writing (solo). **`light-impl` is allowed it since 0.19.0-dev**, and Haiku no longer strips it.
  `design-plan` and `explore-lead` are allowed it: explore-lead re-delegates legwork to `explore`,
  design-plan consults the advisor; all impl roles may re-delegate file-persisted documents to
  `doc-writing`.
- Upstream flow since 0.16: explore-lead writes the context-map → **orchestrator** judges
  §未解決事項 and fixes requirements → design-plan writes design/WBS → doc-review (Haiku) →
  independent-review (Sonnet, original only) → orchestrator adopts/rejects → user approval → Approve.
- **Execution-tier resolution is profile-independent since 0.18.0-dev** and lives in the discipline's
  §委譲先の解決 (see above). Both profiles use the same three steps; only the *candidate set* differs,
  and the marker table's 2nd line announces which one is in force. `independent-review` is still
  skipped rather than advanced past step 1, because a same-vendor reviewer shares the designer's
  blind spots. Reading a role across to the 担当表's "Claude モデル" column now only decides the
  delegate's `model`, not *which definition* to use.
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
| `run-trigger-eval.mjs` | registers the target skill in a temp sandbox **outside the repo** and starts each child with `--setting-sources project` / `--strict-mcp-config` / `--settings '{"disableAllHooks":true}'` / `--no-session-persistence`, so only the CLI's built-in skills compete; runs each eval query through `claude -p`, counts a fire only when the stream-JSON shows a `Skill` tool call, and **records CLI start-up/execution failures as `errors` instead of folding them into "did not fire"** (it reads the `result` event's `is_error`; upstream treats every `result` as a non-fire). If every run of any one query fails it returns no result and fails |
| `improve-description.mjs` | generates a new `description` from failing queries; retries missing tags, **treats the UTF-8 byte length of the best-scoring description (floor 680) as the budget and rewrites anything over it** (upstream's "100-200 words / 1024 characters" is not used), records runs |
| `run-loop.mjs` | splits the eval set into train/holdout, iterates measure→improve, emits best-result JSON + HTML report; **the result JSON records `environment`**, and the loop stops when **train passes every query OR the holdout is perfect** (upstream only looks at train). A configuration whose holdout leaves train empty is rejected |
| `generate-report.mjs` | renders the loop history / train-test scores / per-query results as HTML (library, not a standalone CLI) |

`src/lib/` splits out `claude-cli`, `parse-skill-md`, `pool`, `sandbox`, `split-eval-set`,
`stream-parse`, `types`. `evals/{agent-creator,prompt-smith,skill-creator}.json` hold 20 queries
each; `skills/skill-creator/assets/eval-review.html` is the review UI. Everything routes through
`claude -p` — no Anthropic API (`mem:core`).
