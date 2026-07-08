Root of the repo has **no build system** — it's a plugin marketplace of markdown/JSON files
(skills, agents, commands, hooks configs). No root `package.json`.

The one exception is `plugins/codiel/raguel-mcp/` — a standalone TypeScript/Node ESM package:
- Runtime: Node (Volta-pinned: node 26.3.1, pnpm 11.8.0 — see `raguel-mcp/package.json` `volta`/`devEngines`)
- Package manager: **pnpm** (has its own `pnpm-workspace.yaml`, separate from repo root)
- Language: TypeScript (strict, `tsc --noEmit` for typecheck)
- Build: `tsx scripts/build.ts` → bundles to `dist/server.mjs` via esbuild (entry point wired into
  `plugins/codiel/.mcp.json` as the `raguel` MCP server)
- Test: Vitest (`*.test.ts` colocated with source, no separate `test/` tree)
- Lint/format: Biome (`biome.json`)
- Key deps: `@modelcontextprotocol/sdk` (MCP server), `zod` v4, `picomatch`, `yaml`

Details on raguel-mcp's internal architecture: `mem:codiel/raguel_mcp`.
