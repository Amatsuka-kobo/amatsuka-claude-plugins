# 保護パス

> この文書は metatron の管理下にある。直接編集は PreToolUse hook が拒否する。更新は metatron の CLI(`stage-rules` → `commit-rules`)で行う。CLI の絶対パスは、セッション冒頭の注入文または hook の拒否メッセージに載っている。

## 触らないパス

- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md` — Edit / Write / NotebookEdit は metatron の hook が拒否する。ARCHITECTURE の更新は `stage-architecture` → `commit-architecture`、ADR は `stage-adr` → `commit-architecture`、GOTCHAS の追記は `append-gotcha`、タグ付けは `tag-gotcha` を使う。
- `plugins/*/scripts/` と `plugins/*/dist/` — バンドル出力。対応する `src/` を変更し、`pnpm run build` で再生成する。
- `.raphael/antibodies/` — 抗体の更新は `plugins/raphael/scripts/update-antibody.mjs` で行う。一覧と詳細の取得は `plugins/raphael/scripts/list-antibodies.mjs` を使う。適用の前に `patch --dry-run` で変更後を確認する。
- `.serena/memories/` — Serena の `write_memory` / `edit_memory` で変更する。

## 変更に慎重を要するパス

- `.claude-plugin/marketplace.json` — プラグインを追加または削除するときだけ変更する。変更後、対応する `plugins/<plugin>/.claude-plugin/plugin.json` があることを確認する。
- `plugins/*/.claude-plugin/plugin.json` — プラグインを改修したらバージョンを上げる。`package.json` を持つプラグインは `version` を同じ値に揃える。バージョンは `n1.n2.n3` の形式とし、プレリリースは `-dev` を付ける。通常はパッチ(n3)を上げ、変更が多いときはマイナー(n2)を上げる。自動で上げるのはマイナーまでとし、メジャー(n1)を上げるときは人間に確認する。
- `plugins/*/hooks/hooks.json` — 全セッションの挙動が変わる。変更後、新しいセッションで発火することを確認する。
- `pnpm-workspace.yaml` — スクリプトを持つプラグインを追加したときに追記する。
- `tsconfig.json` と `biome.json` と `vitest.config.ts` — 全プラグインに影響する。変更後 `pnpm run typecheck` と `pnpm run lint` と `pnpm run test` をすべて通す。
- `CLAUDE.md` — 全セッションに注入される。ARCHITECTURE と内容が重ならないことを確認する。
- `plugins/metatron/references/architecture-format.md` と `gotchas-format.md` と `config-schema.md` — 書式と規則の契約。変更したら `plugins/metatron/docs/format-change-checklist.md` の該当節の項目をすべて追随させる。`config-schema.md` を変更したときは 3 プラグインの独立実装を追随させ、3 者比較テストを通す。
- `plugins/sandalphon/references/intent-format.md` — intent 文書の書式契約。変更したら `plugins/sandalphon/docs/format-change-checklist.md` の項目をすべて追随させる。
