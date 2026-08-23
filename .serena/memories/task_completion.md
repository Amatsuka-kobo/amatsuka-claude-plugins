The canonical definition of done is `harness-docs/ARCHITECTURE.md` §規約. In this repository,
metatron's SessionStart hook injects the full ARCHITECTURE document, while the root `CLAUDE.md`
only identifies the repository and points to that document. The available commands are recorded in
`mem:suggested_commands`; source-to-bundle facts are in `mem:conventions`.

No CI runs these checks. Markdown/JSON-only changes also have no automated validation: `plugin-dev`
(and its validator) was removed in commit ea72cbc, and the mdbase/`_types` frontmatter-schema check
was retired in commit 9ed55dd.
