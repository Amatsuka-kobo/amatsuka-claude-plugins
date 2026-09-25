# jevriel (0.1.0-dev)

MCP server that lets Claude Code delegate typed judgements to TypeSafe AI's Jev (`jev-latest`).
Jev returns only noul (probability), choice, and score — never text. Design:
`harness-docs/design/2026-09-25-jevriel-design.md`; plan (with implementation record §7/§10):
`harness-docs/plans/2026-09-25-jevriel-plan.md`.

## Layout

- `.mcp.json` → `node ${CLAUDE_PLUGIN_ROOT}/dist/server.mjs` (package `jevriel-scripts`, build entry
  `src/server.ts` only; `dist/` changes only when the server's import graph changes).
- `src/jev/` client (SDK 0.6.0, `logLevel: "off"` so the SDK never writes to stdout), budget
  (51,200 / 25,600 token caps, 4 concurrent batches), verdict (thresholds → satisfied/unsatisfied/
  uncertain).
- `src/tools/` judging.ts (jev_ask, classify_items, rank_items, check_claims, assess_action),
  api.ts (api_check, api_run_goal), browser.ts (browser_setup, browser_check, browser_run_goal).
- `src/api/` http (redact, sanitizeUrl, isHostAllowed — browser tools reuse these), template
  (`{{inputs.*}}` / `{{steps.*}}`), loop.
- `src/browser/` playwright (resolution), snapshot (actionables from `ariaSnapshotJSON()`), driver
  (`GoalDriver` + Playwright impl; `observe()` also returns `notes` for dismissed dialogs / closed
  popups), loop.
- `src/evidence.ts` — evidence under `<project>/.jevriel/runs/<browser|api>/<name>/<timestamp>/`
  (`result.json` = tool output, written last; `log.json`; browser adds `final.png`, `step-<n>.png`,
  `trace.zip`). `evidence: always|on_failure|none`, default always. `projectDir` =
  `CLAUDE_PROJECT_DIR ?? cwd`.
- `skills/judging/SKILL.md`, `evals/judging.json`.

## Invariants

- Without `TYPESAFE_API_KEY` the server still starts; every tool except `browser_setup` returns
  `not_configured`.
- User data goes in state keys, never in instructions or noul `criteria`; `inputs` values never
  reach Jev (only key names).
- Playwright: only `import type`; runtime `createRequire(<projectDir|~/.cache/jevriel>/package.json)`,
  project version must be ≥1.63.0. `browser_setup` installs `playwright@~1.63.0` + Chromium into
  `~/.cache/jevriel`. `resolve("playwright/package.json")` works (exports expose it).
- Default-mode `ariaSnapshotJSON()` already omits aria-hidden nodes; the `ariaHidden` flag only
  appears in `mode: "ai"`, which jevriel does not use.
- Tool descriptions, skill and references must not name other plugins; only README's
  "Codiel との併用" section may.
- WSL/Ubuntu dev machines may lack `libasound.so.2` for Chromium; users fix it with
  `sudo npx playwright install-deps chromium`.
