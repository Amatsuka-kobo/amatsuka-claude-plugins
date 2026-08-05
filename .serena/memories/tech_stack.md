Repo root **is** the build system — a pnpm workspace covering every script-bearing plugin.

- Runtime: Node >= 26 (Volta-pinned: node 26.3.1, pnpm 11.8.0 — root `package.json`).
  Plugin READMEs state a lower **consumer** floor of Node >= 22 (bundles are `node26`-targeted
  but only need a modern runtime); the >= 26 requirement is for building this repo.
- Package manager: **pnpm** only. Workspace members (`pnpm-workspace.yaml`): `plugins/basic-design`,
  `plugins/codiel`, `plugins/codiel/raguel-mcp`, `plugins/chat-history`, `plugins/gh-utility`,
  `plugins/revelation`, `plugins/pitcrew`, `plugins/raphael`, `plugins/prefetch`,
  `plugins/guidepost`. `allowBuilds: esbuild`.
  `plugins/agent-policy` and `plugins/prompt-smith` are **not** workspace members — they ship
  markdown only (no `package.json`, no `build.ts`, no `scripts/`).
- Language: TypeScript strict, ESM, `noEmit` (root `tsconfig.json`).
- Build: each package has its own `build.ts` running esbuild directly; root `pnpm build` =
  `pnpm -r build`. See `mem:conventions` for the src→scripts bundle rule.
- Test: **Vitest, run from root only** (`vitest.config.ts`, pool `forks`, 20s timeout).
  Include glob is `plugins/**/__test__/**/*.test.ts` — tests live in `__test__/` dirs next to the
  code, NOT colocated as `foo.test.ts` siblings. A test placed outside `__test__/` never runs.
- Lint/format: Biome (`biome.json`) — 2-space, lineWidth 80, double quotes, semicolons `asNeeded`,
  no trailing commas, organizeImports on. Ignores `dist`/`scripts`/`docs`/`node_modules`/`.vscode`.
- Frontmatter schema check: mdbase (`mdbase.yaml` + `_types/*.md`), surfaced through the
  `mdbase-lsp` LSP in-editor. Not wired into `pnpm test` — nothing fails CI-style on a schema break.
- Only non-dev runtime deps: raguel-mcp (`@modelcontextprotocol/sdk`, `zod` v4, `picomatch`, `yaml`)
  and basic-design (`elkjs`, pinned exact). Every other plugin is Node stdlib (+ `git`/`gh` CLI).

Commands: `mem:suggested_commands`. Definition-of-done: `mem:task_completion`.
