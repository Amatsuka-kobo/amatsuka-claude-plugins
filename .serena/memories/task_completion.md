Before considering any change under `plugins/*/src/` (incl. `raguel-mcp/src/`) done, from the
repo root:

1. `pnpm test` — vitest (root only; new tests must sit in a `__test__/` dir or they don't run)
2. `pnpm typecheck` — tsc --noEmit
3. `pnpm lint` — biome check .
4. `pnpm build` — regenerate `plugins/*/scripts/*.mjs` / `raguel-mcp/dist/server.mjs` and **commit
   the bundle diff together with the source change** (`mem:conventions`)
5. Bump the touched plugin's `.claude-plugin/plugin.json` version **and its `package.json`**
   (they drift — check both; major bump ⇒ ask the human)
6. Reflect the change in the root `README.md` plugin table if it added/changed a plugin

For markdown/JSON-only changes (skills/agents/commands/hooks/marketplace.json) there is no build or
test step: sanity-check JSON validity, check frontmatter against `_types/` (the `mdbase-lsp` LSP
does this in-editor), and still apply steps 5–6. There is no validator command any more —
`plugin-dev` was removed from this workspace in 2026-08.

New design docs and implementation plans go to `harness-docs/`, not `docs/` (`mem:core`).
Editing `CLAUDE.md` requires human confirmation.

No CI runs any of this — nothing catches a skipped step for you.
