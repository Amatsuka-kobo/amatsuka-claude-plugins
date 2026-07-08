All dev commands apply only inside `plugins/codiel/raguel-mcp/` (root repo has nothing to build/test).
README explicitly says to work with that folder open in the editor so Biome's extension applies.

```bash
cd plugins/codiel/raguel-mcp
pnpm install        # first-time setup (pnpm required, not npm/yarn)
pnpm test           # vitest run
pnpm run build       # tsx scripts/build.ts -> dist/server.mjs
pnpm run typecheck   # tsc --noEmit
```

No repo-root lint/test/CI exists — a plugin-only change (skills/agents/commands/hooks markdown
or JSON) has no automated check beyond the `plugin-dev:plugin-validator` agent/skill.

Linux dev machine; no non-standard shell command forms noted beyond the above.
