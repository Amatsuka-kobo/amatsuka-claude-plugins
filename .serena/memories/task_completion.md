The canonical definition of done is the root `CLAUDE.md` 「完了条件」. `harness-docs/ARCHITECTURE.md`
is read through the `@harness-docs/ARCHITECTURE.md` line in `CLAUDE.md` (metatron no longer injects
its text); its 「変更時の追随」 lists what to update together when a path changes. The available commands are recorded in
`mem:suggested_commands`; source-to-bundle facts are in `mem:conventions`.

No CI runs these checks. Markdown/JSON-only changes also have no automated validation: `plugin-dev`
(and its validator) was removed in commit ea72cbc, and the mdbase/`_types` frontmatter-schema check
was retired in commit 9ed55dd.
