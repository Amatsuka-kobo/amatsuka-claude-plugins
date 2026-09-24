## What this repo is

`amatsuka-claude-plugins` — a Claude Code plugin **marketplace** (not an app), plus the TypeScript
sources that build each plugin's bundled scripts.

Technical preconditions and operating conventions are canonical in
`harness-docs/ARCHITECTURE.md`, which was added in 2026-08. metatron's SessionStart hook injects
its full text at the start of each session in this repository; the root `CLAUDE.md` now contains
only the repository overview and that pointer.

- `.claude-plugin/marketplace.json` — marketplace manifest; a plugin is only distributable once
  listed here (name/source/description). 13 entries, matching the root `README.md` table 1:1
  (verified 2026-08-17; metatron + sandalphon added 2026-08-16).
- `plugins/<name>/` — one dir per plugin. All 13 are pnpm workspace packages. Layout + bundle
  conventions: `mem:conventions`. Toolchain: `mem:tech_stack`.
- **mdbase / typed-markdown frontmatter checking is gone** (commit 9ed55dd, 2026-08): `mdbase.yaml`,
  `_types/{agent,command,skill,antibody}.md` and `scripts/install-mdbase.sh` were deleted from their
  working locations and re-added as an archive under `docs/old/mdbase-record/`; `mdbase-lsp` was
  dropped from `enabledPlugins`. **There is now no schema check of any frontmatter anywhere** —
  do not cite `_types/` or the LSP as a validation step. (`plugins/raphael/src/lib/frontmatter.ts`
  validates only Raphael antibodies and is unrelated.)
- Root `.mcp.json` — two servers: `github` (http, `https://api.githubcopilot.com/mcp/`, bearer from
  env `GITHUB_PERSONAL_ACCESS_TOKEN`) and `serena` (stdio, `uvx --from git+…/serena
  start-mcp-server`, context `claude-code`, dashboard off). `harness-docs/ARCHITECTURE.md` records
  the Context7 requirement for library documentation and Serena for codebase exploration + TS/MD
  editing.
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
- `harness-docs/ARCHITECTURE.md` is the repository's technical source of truth. The directory also
  holds `design/` (25 files), `plans/` (14), `handover/`, and `superpowers/{specs,plans}` — every
  design specification and implementation plan. Its documentation-operation facts supersede the
  former root `CLAUDE.md` text. `design/2026-08-16-file-contract-freeze.md` は設計書ではなく
  metatron / codiel / sandalphon / gh-utility が実装中に直接読む**凍結された契約**である
  (`mem:file_contract`)。
- Consequence: any doc citing `docs/design/…`, `docs/plans/…`, `docs/superpowers/…` for a *repo*
  design spec is stale. Two look-alikes that must NOT be rewritten: basic-design's skills write
  their deliverables to `docs/design/<kind>/` of the **target** project, and
  `plugins/pitcrew/src/lib/__test__/capture-rules.test.ts:10` asserts `docs/superpowers/specs/x.md`
  matches the default artifact glob `docs/**/*.md`.
- `docs/chat/<year>/<mmdd>/<author>/*.md` + `docs/chat/INDEX.md` —
  `harness-docs/ARCHITECTURE.md` restricts reading these to the chat-recorder / chat-reader agent or
  an explicit user request; use `chat-history:recall`.
- `TERMS.md` — Japanese ToS; notably forbids using this service to generate illustration/Live2D/
  3D-model assets.

## Distributed plugins (13, see `.claude-plugin/marketplace.json`)

Only **pitcrew (0.10.2)** and **chat-history (0.7.0)** are released; every other plugin is `-dev`.
Manifest and sibling `package.json` versions were all in sync as of 2026-08-24.

**metatron / sandalphon / codiel の連携** — 願い → intent → issue → 実装という一続きの流れを
分担するが、**互いに独立して動く。**
codiel は metatron が無くても単体で完結し、ドメインマップが無い場合も `unscoped` モードで run を
開始できる。sandalphon は codiel が無くても intent 文書と自前実行まで行き、metatron は単体で記録・注入として価値がある。

**連携手段はファイル契約(ARCHITECTURE / GOTCHAS / intent 文書の書式)とモデルコンテキストの
2 つだけ。** プラグイン間の依存宣言も、互いのインストール位置の参照も一切無い。したがって同じ規則が
3 実装に独立に写されており、一致の担保はテスト 1 本しかない — 詳細は `mem:file_contract`。
2026-08-17 に外部の独立レビュー指摘(致命 2・重大 2・契約の割れ 4)を修正し、3 プラグインの
パッチバージョンを上げた(コミット a345f82 / f394cd0 / b468c5e、契約と設計書の追随は 10a5866)。

- **codiel** (0.8.0-dev) — GitHub-issue-driven orchestrator gated by the bundled `raguel` MCP
  server. Largest/most complex. 2026-08-16 に ARCHITECTURE / GOTCHAS の管理を metatron へ移し、
  `/codiel:init` の散文インタビューを廃止、guard-write にドメイン境界を配線した。
  Details: `mem:codiel/core`; MCP internals: `mem:codiel/raguel_mcp`.
- **metatron** (0.3.7-dev) — ARCHITECTURE / GOTCHAS を独立資産として記録・更新し毎セッション注入する。
  共有ライブラリ + CLI + 2 hook の構成で常駐プロセスを持たず、真の強制点は PreToolUse deny hook だけ。
  Details: `mem:metatron/core`.
- **sandalphon** (0.2.0-dev) — Issue が生まれる前の上流区間(願い → intent 文書 → 起票 →
  実行系への引き渡し)を担うオーケストレーター。codiel の前段。状態永続機構を持たない。
  Details: `mem:sandalphon/core`.
- **basic-design** (0.6.2-dev) — brainstorm-driven basic-design deliverables via spec-JSON →
  .drawio + HTML. Details: `mem:basic_design/core`.
- **pitcrew** (0.10.2) — hooks-driven parallel-review layer: captures orchestration artifacts to
  `.pitcrew/review/` and injects human comments back into the session. Details: `mem:pitcrew/core`.
- **raphael** (0.2.1-dev) — failure-immunity: detects failure signals into `.raphael/infections/`,
  distills them into antibodies (38 committed under `.raphael/antibodies/` as of 2026-08-17), and
  re-injects only on deterministic `PreToolUse` match. Details: `mem:raphael/core`.
- **guidepost** (0.1.1-dev) — turns a commit range / PR diff into an AI-guided code-reading tour in
  a browser viewer, with reader questions injected back into the session.
  Details: `mem:guidepost/core`.
- **chat-history** (0.7.0) — chat logging / recall / resume skills + chat-recorder & chat-reader
  agents. The record format flipped from summary to **verbatim** on 2026-08-16, so records are
  bimodal and readers must branch on the date. Details: `mem:chat_history/core`.
- **gh-utility** (0.5.2-dev) — GitHub issue skills (`issue-craft` / `issue-split` / `issue-triage`)
  sharing `references/github-issue-common.md`; scripts (`check-issue-env`, `list-issues`,
  `link-sub-issue`) wrap `gh`/REST, skills own the judgement. `issue-craft` は 2026-08-16 に
  **持ち込みモード**を得た: 固定開始句「持ち込みモード: 以下の完成済み本文で起票」で起動されたときだけ
  入り、渡された `title` / `body` を一切書き換えず(誤字修正・整形・要約・見出し並べ替えもしない)
  ブレインストーミングを飛ばして起票する。全文提示 → 明示承認のゲートは省略しない。判定は固定句の
  一致だけで行い推測で入らない。仕様の正本は `mem:file_contract` §10。
- **agent-policy** (0.10.0-dev) — the model-tiering / orchestration discipline this repo itself runs
  under. Since 2026-08-25 it **ships 4 agent definitions built from role fragments, injects the
  policy skill and a 役割 → Agent 名 table from a `SessionStart` hook, and offers one `setup-agents`
  wizard** (the old `setup-gpt` / `setup-grok` pair was merged into it; the 2026-08-16 "7 definitions,
  hook writes files" model is gone). Details: `mem:agent_policy/core`.
- **prompt-smith** (0.3.2-dev) — standards for AI-facing instruction docs (`prompt-smith`), agent
  definitions (`agent-creator`) and skill authoring + description eval loop (`skill-creator`, a
  TypeScript port of Anthropic's official skill-creator). Details: `mem:agent_policy/core`.
- **prefetch** (0.2.1-dev) — speculative background prefetch just before a user-input wait; single
  `UserPromptSubmit` hook (`check-prefetch-manifest.mjs`) nagging only when `.prefetch/` holds
  uncollected results.

## 2026-08 plugin split — resolved

`task-utility` → `chat-history` + `gh-utility`, and `optimize-agents` → `agent-policy` +
`prompt-smith` (commit 849d3c7). Identifier rename pass landed 2026-08-05; the state-dir migration
(`~/.claude/task-utility/chat-recorder/` → `~/.claude/chat-history/chat-recorder/`) shipped in
chat-history 0.6.0 with a read-side fallback so a failed rename never looks like empty state.

Deliberately still on the old name — do not "fix" these:

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
「最重要」 in `plugins/codiel/docs/DESIGN.md` §0 and `harness-docs/ARCHITECTURE.md`; it binds every
plugin here.
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
- **`.claude/agents/` holds this repo's own custom-profile setup** — 8 definitions, each carrying an
  `agent-policy-role` marker: `gpt-sol-lead-implementer` (complex-impl), `gpt-terra-general-implementer`
  (normal-impl + general), `gpt-luna-light-implementer` (light-impl), `grok-researcher`
  (explore + realtime-research), `grok-docs-reviewer` (independent-review), `haiku-reviewer`
  (doc-review), `sonnet-code-reviewer` (code-review), `fable-adviser` (advisor). SessionStart reads
  them into the marker table it injects; **the hook writes nothing** — the files come from
  `agent-policy:setup-agents` or by hand. `grok-researcher` is on the plugin's RETIRED list, so the
  hook nags to delete it. The agent-policy plugin itself ships **no** agent definitions since
  0.14.0-dev, and the `AMATSUKA_AGENT_*_ALIAS` env vars are no longer read.
- The protected-path treatment of `CLAUDE.md` is defined in `harness-docs/ARCHITECTURE.md`.
- `private/` holds the user's own scratch (`context-map/`, story drafts); `.superpowers/sdd/` holds
  hundreds of historical task briefs/reports/review diffs. Both are noise for code work.
