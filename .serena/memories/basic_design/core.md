`plugins/basic-design` (0.6.2-dev) — brainstorm-driven basic-design deliverables. Design spec:
`harness-docs/superpowers/specs/2026-07-12-basic-design-plugin-design.md`.

## Model

Diagrams are never authored directly: a skill brainstorms with the user, emits a **spec JSON**
(the committed source), then runs the bundled CLI to render `.drawio` + single-file `.html`.
Deliverables land in `docs/design/<kind>/`. Diagram types: `er`, `screen-flow`, `architecture`,
`sequence` (`src/types.ts` `DiagramType`).

CLI contract (`scripts/design-gen.mjs`, built from `src/design-gen-cli.ts`):
`node design-gen.mjs <foo.spec.json> --format <drawio|html|both>` (default `both`); output basename
strips `.spec.json`; failures print `{ok:false, errors:[...]}` to stdout and exit 1. Skills must
report those errors raw and only retry by fixing the spec.

Pipeline: `validate.ts` (hand-written validator, not zod) → `layout/graph.ts` (elkjs; er /
screen-flow / architecture) or `layout/sequence.ts` (hand-rolled) → `decorate.ts` (+ `theme.ts`,
`render/icons.ts`) → `render/drawio.ts` (via `xml-util.ts`) / `render/html.ts`.

## Skills

`basic-design` (entry orchestrator: overview brainstorm → pick deliverables → run each skill,
passing format/destination down so sub-skills skip re-asking), `er-diagram`, `screen-flow`,
`system-architecture`, `sequence-diagram`, `api-list`, `nfr-checklist`, `shared/drive-upload.md`.

Google Drive upload is opt-in: `drive_folder_id` in `.claude/basic-design.local.md`, checked by
`scripts/check-drive-config.mjs`, uploaded through Drive MCP tools (never a bundled uploader).

## Gotchas

- `elkjs` is pinned to an exact version. Updating it: bump exact version → install →
  test/typecheck/build → regenerate `samples/` → eyeball the HTML/drawio → commit lockfile, bundle
  and samples together.
- `samples/*.{spec.json,drawio,html}` and `src/fixtures/complex-*.spec.json` are layout regression
  material — layout changes must refresh them.
- `elkjs` is pinned at exactly `0.11.1` (no `^`/`~`).
- Deliverables land in `docs/design/<kind>/` of the **target** project. In this repo there is no
  `docs/design/` any more — plugin design docs live in `harness-docs/design/` — so nothing here
  collides with basic-design output.
