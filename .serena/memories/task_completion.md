Before considering any change under `plugins/*/src/` (incl. `raguel-mcp/src/`) done, from the
repo root:

1. `pnpm test` — vitest (root only; new tests must sit in a `__test__/` dir or they don't run)
2. `pnpm typecheck` — tsc --noEmit
3. `pnpm lint` — biome check .
4. `pnpm build` — regenerate `plugins/*/scripts/*.mjs` / `raguel-mcp/dist/server.mjs` and **commit
   the bundle diff together with the source change** (`mem:conventions`)
5. Bump the touched plugin's `.claude-plugin/plugin.json` version (major bump ⇒ ask the human)

For markdown/JSON-only changes (skills/agents/commands/hooks/marketplace.json) there is no build or
test step: sanity-check JSON validity, consider `plugin-dev:plugin-validator`, and still apply the
version bump rule.

Editing `CLAUDE.md` requires human confirmation, and mirror any shared content into
`CLAUDE.example.md`.

No CI runs these — nothing catches a skipped step for you.
