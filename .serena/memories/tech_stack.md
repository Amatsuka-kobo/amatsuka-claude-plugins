Repo root **is** the build system — a pnpm workspace covering every plugin (this changed; there is
no longer a per-plugin toolchain).

- Runtime: Node >= 26 (Volta-pinned: node 26.3.1, pnpm 11.8.0 — root `package.json`)
- Package manager: **pnpm** only. Workspace members (`pnpm-workspace.yaml`):
  `plugins/basic-design`, `plugins/codiel`, `plugins/codiel/raguel-mcp`, `plugins/task-utility`,
  `plugins/revelation`, `plugins/pitcrew`. `allowBuilds: esbuild`.
- Language: TypeScript strict, ESM, `noEmit` (root `tsconfig.json`; includes `plugins/*/src/**`,
  `plugins/*/build.ts`, raguel-mcp's src/build; excludes generated `plugins/*/scripts` and
  `raguel-mcp/dist`).
- Build: each package has its own `build.ts` running esbuild directly; root `pnpm build` =
  `pnpm -r build`. See `mem:conventions` for the src→scripts bundle rule.
- Test: **Vitest, run from root only** (`vitest.config.ts`, pool `forks`, 20s timeout).
  Include glob is `plugins/**/__test__/**/*.test.ts` — tests live in `__test__/` dirs next to the
  code, NOT colocated as `foo.test.ts` siblings. A test placed outside `__test__/` never runs.
- Lint/format: Biome (`biome.json`) — 2-space, lineWidth 80, double quotes, semicolons `asNeeded`,
  no trailing commas, organizeImports on. Ignores `dist`/`scripts`/`docs`/`node_modules`.
- Only non-dev runtime deps: raguel-mcp (`@modelcontextprotocol/sdk`, `zod` v4, `picomatch`, `yaml`)
  and basic-design (`elkjs`, pinned exact).

Commands: `mem:suggested_commands`. Definition-of-done: `mem:task_completion`.
