`plugins/agent-policy` (0.10.0-dev, pkg `agent-policy-scripts`) and `plugins/prompt-smith`
(0.3.2-dev, pkg `prompt-smith-scripts`) — the two halves of the former `optimize-agents`, split in
commit 849d3c7 (2026-08). Both are script-bearing pnpm workspace members. **This repo runs under
agent-policy itself**, selected by the env var `AMATSUKA_AGENT_AUTO_INJECTION` (see below), not by
CLAUDE.local.md prose.

Design docs live in `harness-docs/design/`:
`2026-07-19-agent-policy-design.md`, `2026-08-01-agent-policy-prompt-smith-design.md`,
`2026-08-09-agent-policy-{codex-grok,with-grok}-policy-design.md`,
`2026-08-14-agent-policy-headless-setup-design.md` (**superseded**),
`2026-08-16-agent-policy-bundled-agents-design.md` (**superseded**),
`2026-08-25-agent-policy-setup-agents-design.md` (**current**) + matching plan in
`harness-docs/plans/`, plus `2026-08-09-prompt-smith-skill-creator-port-design.md`.
Accumulated rationale: `docs/old/optimize-agents-record/`.

## Current shape (2026-08-25, the `setup-agents` consolidation)

Two earlier generations are recorded in git but **must not be cited as current**: the 2026-08-16
"7 bundled agents, hook writes files" model, and the 2026-08 4-preset model with separate
`setup-gpt` / `setup-grok` skills. Both are gone.

- **4 agent definitions ship** in `agents/`: `gpt-sol` (`claude-gpt-5-6-sol`), `gpt-terra`
  (`claude-gpt-5-6-terra`), `gpt-luna` (`claude-gpt-5-6-luna`), `grok` (`claude-grok-4-6`).
  They are **build artifacts**: `src/agents/build-presets.ts` composes them from role fragments,
  so never hand-edit `agents/*.md`.
- **Retired definitions** (`claude-researcher`, `gpt-researcher`, `grok-researcher`,
  `grok-implementer`) are listed in `session-start.ts` `RETIRED`; the hook nags to delete them if
  they linger in a project's `.claude/agents/`.
- **5 skills**: the 4 policy skills plus `setup-agents` (`setup-gpt` / `setup-grok` were merged
  into it — do not cite those names).
- `src/`: `setup-agents.ts` (the CLI), `agents/{policies,presets,roles,fragments,compose,
  vocabulary,mcp,hash,build-presets}.ts`, `hooks/session-start.ts`, `testing/`.
  `scripts/` holds `setup-agents.mjs` and `session-start.mjs`.

### Role fragments and the 10 role IDs

`assets/roles/{ja,en}/` each hold 12 files: the 10 role fragments plus `_common.md` and the
vendor overlay `realtime-research.grok.md`. Role IDs: `complex-impl`, `normal-impl`, `light-impl`,
`general`, `explore`, `realtime-research`, `independent-review`, `doc-review`, `code-review`,
`advisor`.

`fragments.ts` resolves fragments in 3 stages (plugin `<lang>/` → project
`.claude/agent-policy/roles/` → project `<lang>/`), with vendor overlays applied **last-wins via a
map**, not by appending. `vocabulary.ts` supplies per-language headings, list separators and quote
marks; `ja` gets JA, **everything else gets EN** (translated languages keep English headings —
only body text and `label`/`description` are translated, because the composer matches sections by
heading).

**A project fragment must use the selected language's heading set.** A `## 作業手順` / `## 制約`
fragment composed under `--lang en` loses those sections entirely; `languageMismatch` warns.

### `policies.ts` is the canonical 担当表

`ASSIGNMENTS: Record<PolicyName, Record<RoleId, ModelId[]>>` is the single source of truth for
"which model may take which role under which policy". The prose tables in the 4 policy skills
mirror it (40 cells, verified identical 2026-08-25) but **nothing binds them** — a mismatch is
possible and would not be caught by tests.

`MODELS` assigns a distinct `color` per model — opus=blue, sonnet=purple, haiku=pink, fable=orange,
gpt-sol=yellow, gpt-terra=green, gpt-luna=cyan, grok=red. Vendor-level colors are dead from the CLI
path (Claude-band definitions would otherwise all be blue).

### SessionStart hook — it never writes files

`scripts/session-start.mjs` (`src/hooks/session-start.ts`, timeout 10, always exits 0):

1. Maps `AMATSUKA_AGENT_AUTO_INJECTION` to a policy skill via `policyForInjection` (in
   `policies.ts` — the hook no longer keeps its own copy) and injects "load this skill first".
2. Scans the project's `.claude/agents/` for the frontmatter marker `agent-policy-role` and injects
   a 役割 → Agent 名 table. Unknown role IDs are resolved against project fragments at
   `.claude/agent-policy/roles/<id>.md` **and** `roles/<lang>/<id>.md`.
3. Reports alias mismatches (env var differs from default and no project definition covers it) and
   retired definitions.

**It generates nothing.** Definition generation is `setup-agents`'s job only.

### `setup-agents`

Interactive wizard: language → policy → models → per-model name/model/roles/keep → MCP servers.
Non-interactive with `--yes`. Subcommands: `--list-policies` / `--list-models` / `--list-roles` /
`--list-mcp` / `--check-fragments` / `--scaffold-fragments`, plus `--check` (diff) and `--write`.

- The skill's frontmatter is `disallowed-tools: Write` with `Edit` limited to
  `**/.claude/agent-policy/roles/**`, because Claude Code matches `Edit(path)` against permissions
  but **not** `Write(path)`. Rationale is in design §6.5 / §10.2, deliberately not in the SKILL body.
- **MCP**: allowlist is server-level (from `claude mcp list`, so the names are guaranteed to exist);
  denylist is tool-level (a wrong entry is harmless). Writing a nonexistent tool name into `tools`
  can silently drop other allowed tools — hence the asymmetry.
- The previous MCP choice is **reverse-engineered from the generated definitions**
  (`agent-policy-role` + `tools`'s `mcp__*`); there is no config file. `mcpCurrentOf` returns names
  **without** the `mcp__` prefix; `resolveMcp` compares on `toolPrefix(name)`. This round-trip only
  closes because `toolPrefix` is idempotent on its own output (it preserves exactly the
  `A-Za-z0-9_-` it emits).
- **MCP is granted per definition, not per role.** One `--write` applies the same servers to every
  target, so a model holding both impl and readonly roles gets it on the whole definition.
- `automaticKeep` excludes `mcp__*` and `disallowedTools` — a disconnected server's stale entry must
  not survive `--merge`.
- `LSP` was removed from every role's `tools`: Claude Code strips it from background subagents, and
  agent-policy's agents are parallel-by-design, so parallel ≈ background.

## The four policy skills — role tables

Each holds only its role table + profile-specific dispatch rules; the shared discipline is
`references/orchestration-discipline.md` (5.1KB) and, for exploration only,
`references/context-map-guide.md` (6.0KB). `assets/context-map-template.md` (3.9KB) is the template.

Rows common to all four: 調査・分析 + 設計書/実装計画書の作成 + コードベース探索統括 → `Opus`;
コードレビュー → `Sonnet`; アドバイザー → `Fable`/`Opus`; 設計書・実装計画書のレビュー → `Haiku`,
**mandatory before showing any design doc or plan to the user**.

| row | claude-model | with-codex | with-grok | codex-grok |
| --- | --- | --- | --- | --- |
| リアルタイム情報調査 | `Sonnet` | `GPT Terra` | `Grok` | `Grok` |
| コードベース探索実働 | `Sonnet` | `GPT Terra` | `Grok` | `Grok` |
| 独立レビュー | `Sonnet` | `GPT Terra` | `Grok` | `Grok` |
| 複雑または重要な実装 | `Opus` | `GPT Sol` | `Opus` | `GPT Sol` |
| 通常の実装 / その他 | `Sonnet` | `GPT Terra` | `Grok` | `GPT Terra` |
| 軽量な実装 | `Haiku` | `GPT Luna` | `Grok` | `GPT Luna` |

Rules that bite:

- The light-impl tier is denied the Agent tool (`GPT Luna` / `Haiku`). `AGENT_CAPABLE` in
  `roles.ts` is `complex-impl` / `normal-impl` / `general` only.
- **Execution-tier resolution is role-marker based, not name based.** Order: (1) a definition the
  SessionStart hook injected via `agent-policy-role`; (2) otherwise the 担当表 model — Claude bands
  dispatch with a `model` override to built-in `Explore`/`general-purpose`, GPT/Grok bands use the
  bundled `agent-policy:<name>`; (3) if the local proxy is unreachable, the skill's own
  §フォールバック. Do not assume project definitions are named `gpt-sol`/`grok` — they are not fixed.
- Independent review runs AFTER the Haiku review but reads **only the original document** — never
  Haiku's findings, or its viewpoint gets anchored. The orchestrator decides adoption; the reviewer
  only supplies counter-arguments.
- `claude-model-policy`'s independent review is same-vendor and says so outright
  (「独立性は限定的である」). In with-grok / codex-grok the Grok-unavailable fallback for independent
  review is **SKIP, not delegate to Opus** — a same-vendor reviewer shares the designer's blind
  spots. Realtime research falls back to Opus + WebSearch.
- Each policy's §フォールバック names **only the vendors that policy actually has**. `with-codex`
  must not mention Grok, `with-grok` must not mention GPT.
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
