Repo root **is** the build system — a pnpm workspace covering every plugin.

- Runtime: Node >= 26 (Volta-pinned: node 26.3.1, pnpm 11.8.0 — root `package.json`).
  Plugin READMEs state a lower **consumer** floor (Node >= 22 for most bundles; prompt-smith's
  bundles target node26); the >= 26 requirement is for building this repo.
- Package manager: **pnpm** only. `pnpm-workspace.yaml` now lists **12 members** — every plugin
  (`agent-policy`, `basic-design`, `codiel`, `chat-history`, `gh-utility`, `revelation`, `pitcrew`,
  `raphael`, `prefetch`, `guidepost`, `prompt-smith`) plus the nested `plugins/codiel/raguel-mcp`.
  `allowBuilds: esbuild`. The old "agent-policy / prompt-smith are markdown-only non-members" rule
  is gone as of 2026-08.
- Root devDeps: `typescript ^6.0.3`, `vitest ^4.1.10`, `@biomejs/biome ^2.5.0`, `esbuild ^0.28.1`,
  `tsx ^4.22.4`, `@types/node ^26`.
- Language: TypeScript strict, ESM, `noEmit` (root `tsconfig.json`; `moduleResolution: bundler`,
  `isolatedModules`). `include` covers `plugins/*/src/**`, `plugins/*/build.ts` and the raguel-mcp
  equivalents; `exclude` covers `plugins/*/scripts` and `raguel-mcp/dist`.
- Build: each package has its own `build.ts` running esbuild directly (via `tsx`); root
  `pnpm build` = `pnpm -r build`. See `mem:conventions` for the src→scripts bundle rule.
- Test: **Vitest, run from root only** (`vitest.config.ts`, pool `forks`, 20s timeout).
  Include glob is `plugins/**/__test__/**/*.test.ts` — tests live in `__test__/` dirs next to the
  code, NOT colocated as `foo.test.ts` siblings. Verified 2026-08-15: all 127 `*.test.ts` files sit
  under `__test__/`; a test placed outside never runs.
- Lint/format: Biome (`biome.json`, schema 2.5.3) — 2-space, lineWidth 80, double quotes,
  semicolons `asNeeded`, no trailing commas, `recommended` lint preset, assist/organizeImports on.
  Ignores `dist`/`scripts`/`docs`/`node_modules`/`.vscode` — note `harness-docs` is not listed
  (irrelevant, since only `**/*.ts` and `**/*.js` are in scope).
- `.vscode/settings.json`: format-on-save with `biomejs.biome` as the TS/JS formatter; watcher and
  search exclude `.superpowers`, `.pitcrew`, `dist`, `node_modules` and generated `scripts/*.mjs`.
- Frontmatter schema check: mdbase (`mdbase.yaml` spec_version 0.3.0 + `_types/{agent,command,
  skill,antibody}.md`), surfaced through the `mdbase-lsp` LSP in-editor. Excludes `.git`,
  `.mdbase`, `node_modules`, `docs`, `harness-docs`, `.serena`. Not wired into `pnpm test` —
  nothing fails CI-style on a schema break.
- Only non-dev runtime deps: raguel-mcp (`@modelcontextprotocol/sdk`, `zod` v4, `picomatch`, `yaml`)
  and basic-design (`elkjs`, pinned exact at 0.11.1). Every other plugin is Node stdlib
  (+ `git`/`gh`/`claude` CLI).

Commands: `mem:suggested_commands`. Definition-of-done: `mem:task_completion`.
