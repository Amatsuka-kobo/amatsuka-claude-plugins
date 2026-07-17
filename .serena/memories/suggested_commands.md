All dev commands run **from the repo root** (pnpm workspace). Per-plugin `cd` is not needed and
per-plugin `test`/`typecheck` scripts do not exist — only `build` does.

```bash
pnpm install         # first-time setup (pnpm only, never npm/yarn)
pnpm test            # vitest run  (root config; globs plugins/**/__test__/**/*.test.ts)
pnpm typecheck       # tsc --noEmit
pnpm lint            # biome check .
pnpm build           # pnpm -r build -> each plugin's src/ -> scripts/*.mjs (+ raguel dist/server.mjs)
pnpm --filter basic-design-generator build   # single package (workspace pkg names differ from
                                             # plugin names: codiel-scripts, revelation-scripts,
                                             # task-utility-scripts, basic-design-generator, raguel-mcp)
```

Note: some plugin READMEs still say `cd plugins/<x> && pnpm test && pnpm typecheck` — stale; those
scripts are root-only.

No CI. A markdown/JSON-only plugin change (skills/agents/commands/hooks/marketplace.json) has no
automated check beyond `plugin-dev:plugin-validator`.

Linux/WSL2 dev machine. Env setup (Volta, uv/Serena, Context7, LSPs): `ONBOARDING.md`.
