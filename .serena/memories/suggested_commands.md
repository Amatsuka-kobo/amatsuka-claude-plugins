All dev commands run **from the repo root** (pnpm workspace). Per-plugin `cd` is not needed and
per-plugin `test`/`typecheck` scripts do not exist — only `build` does.

```bash
pnpm install         # first-time setup (pnpm only, never npm/yarn)
pnpm test            # vitest run  (root config; globs plugins/**/__test__/**/*.test.ts)
pnpm typecheck       # tsc --noEmit
pnpm lint            # biome check .
pnpm build           # pnpm -r build -> each plugin's src/ -> scripts/*.mjs (+ raguel dist/server.mjs)
pnpm --filter basic-design-generator build   # single package
```

Workspace package names differ from plugin names — `<plugin>-scripts` for most
(`agent-policy-scripts`, `prompt-smith-scripts`, `chat-history-scripts`, `gh-utility-scripts`,
`codiel-scripts`, `revelation-scripts`, `pitcrew-scripts`, `raphael-scripts`, `prefetch-scripts`,
`guidepost-scripts`), plus `basic-design-generator` and `raguel-mcp`.

## Repo-level shell scripts (`scripts/`)

- `setup-workspace.sh` — one-shot new-workspace setup: `pnpm install`, `pnpm build`, then headless
  generation of the GPT/Grok agent definitions into `.claude/agents/`.
- `install-mdbase.sh` — fetches/builds `mdbase-lsp` + `mdbase-rs` and installs the LSP.
- `install-proxy.sh` / `start-proxy.sh` — CLIProxyAPI install (writes `cliproxyapi.config.yaml`
  from `cliproxyapi.config.example.yaml`, sets the local auth key) and launch. This proxy is what
  makes the GPT/Grok model aliases (`claude-gpt-5-6-*`, `claude-grok-4-5`) resolvable.

## Verification gaps

No CI. A markdown/JSON-only plugin change (skills/agents/commands/hooks/marketplace.json) has **no
automated check at all** beyond the editor-side `mdbase-lsp` frontmatter schema check
(`mdbase.yaml` + `_types/`). The `plugin-dev` plugin — and with it
`plugin-dev:plugin-validator` — was removed from this workspace in 2026-08 (commit ea72cbc), so do
not cite it as a validation step any more.

Linux/WSL2 dev machine. Env setup (Volta, uv/Serena, Context7, LSPs incl. mdbase-lsp, optional
CLIProxyAPI): `docs/ONBOARDING.md` (moved down from the repo root in the 2026-08-14 docs split;
its `CLAUDE.example.md` copy step is stale — see `mem:core`).
