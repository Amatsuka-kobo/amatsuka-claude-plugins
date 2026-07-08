For any change under `plugins/codiel/raguel-mcp/`, before considering the task done, run (from
that dir): `pnpm test`, `pnpm run typecheck`. Biome lint is enforced via editor integration
(no separate `pnpm lint` script defined as of onboarding) — check `biome.json` if a lint script
is added later.

For changes elsewhere in the repo (skills/agents/commands/hooks markdown or JSON, marketplace.json),
there is no automated test/build step — sanity-check JSON validity and consider running the
`plugin-dev:plugin-validator` agent.
