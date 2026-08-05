Before considering any change under `plugins/*/src/` (incl. `raguel-mcp/src/`) done, from the
repo root:

1. `pnpm test` — vitest (root only; new tests must sit in a `__test__/` dir or they don't run)
2. `pnpm typecheck` — tsc --noEmit
3. `pnpm lint` — biome check .
4. `pnpm build` — regenerate `plugins/*/scripts/*.mjs` / `raguel-mcp/dist/server.mjs` and **commit
   the bundle diff together with the source change** (`mem:conventions`)
5. Bump the touched plugin's `.claude-plugin/plugin.json` (and its `package.json`) version
   (major bump ⇒ ask the human)
6. Reflect the change in the root `README.md` plugin table if it added/changed a plugin

For markdown/JSON-only changes (skills/agents/commands/hooks/marketplace.json) there is no build or
test step: sanity-check JSON validity, check frontmatter against `_types/` (the `mdbase-lsp` LSP
does this in-editor), consider `plugin-dev:plugin-validator`, and still apply steps 5–6.

Editing `CLAUDE.md` requires human confirmation, and mirror any shared content into
`CLAUDE.example.md`.

No CI runs these — nothing catches a skipped step for you.
