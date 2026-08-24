# RULES 記入例

`.claude/rules/metatron/` に置く 3 ファイルの記入例。内容は自分のプロジェクトの実態に置き換える。
以下のコードブロックの中身が、そのまま 1 ファイルの全文にあたる。書式は `references/rules-format.md` にある。

frontmatter は書かない。1 行目を `# 見出し`、2 行目を管理者表示行とする。
更新は `stage-rules` → `commit-rules` で行い、ファイルを直接編集しない。

## conventions.md

```markdown
# 規約

> この文書は metatron の管理下にある。直接編集は PreToolUse hook が拒否する。更新は metatron の CLI(`stage-rules` → `commit-rules`)で行う。CLI の絶対パスは、セッション冒頭の注入文または hook の拒否メッセージに載っている。

<!-- 記入ガイド
コーディング規約・ブランチ運用・完了条件を書く。
言語やフォーマッタの既定と同じ内容は書かない。
禁止事項には代わりに取る手段を併記する。
-->

- **コーディング**: Biome のフォーマットに従う。`any` を使わない。型が定まらないときは `unknown` で受け、絞り込んでから使う。
- **依存追加**: 追加するライブラリは ARCHITECTURE の `## 技術スタック` に行を足してから使う。
- **ブランチ**: `main` を基底とする。作業ブランチは `feat/<要約>` または `fix/<要約>`。
- **PR**: タイトルは `[#<issue 番号>] <要約>`。本文に実行した検証コマンドとその結果を書く。
- **完了条件**: 対象 issue の受け入れ基準を満たす / `pnpm test`・`pnpm lint`・`pnpm typecheck`・`pnpm build` が通る / 変更した層の E2E が通る。
```

## protected-paths.md

```markdown
# 保護パス

> この文書は metatron の管理下にある。直接編集は PreToolUse hook が拒否する。更新は metatron の CLI(`stage-rules` → `commit-rules`)で行う。CLI の絶対パスは、セッション冒頭の注入文または hook の拒否メッセージに載っている。

<!-- 記入ガイド
触らないパスと、変更に慎重を要するパスを分けて書く。
触らないパスには、変更が必要になったときに取る手順を併記する。
慎重を要するパスには、変更してよい条件(何を確認し、どのテストを通すか)を書く。
-->

**触らない**

- `prisma/migrations/**`: 適用済みのマイグレーションを書き換えない。変更が要るときは新しいマイグレーションを追加する。
- `.github/workflows/**`: CI 定義は変更しない。変更が要るときは人間に確認する。

**慎重を要する**

- `src/server/auth/**`: 認証・認可の実装。変更したら `pnpm test src/server/auth` を通し、権限の境界のケースが増えていることを確認する。
- `src/lib/**`: 全ドメインから参照される。変更したら `pnpm test` を全件実行する。
```

## testing-policy.md

```markdown
# テスト方針

> この文書は metatron の管理下にある。直接編集は PreToolUse hook が拒否する。更新は metatron の CLI(`stage-rules` → `commit-rules`)で行う。CLI の絶対パスは、セッション冒頭の注入文または hook の拒否メッセージに載っている。

<!-- 記入ガイド
ユニットテストと E2E の役割分担、テストファイルの配置規約と命名規約を書く。
新規テストをどこへ足すかが、読んだだけで決まる粒度にする。
-->

- **ユニットテスト**: Vitest を使う。テスト対象と同じディレクトリに `<対象>.test.ts` として置く
  (`src/server/task-service.ts` なら `src/server/task-service.test.ts`)。
  分岐を持つ関数には異常系のケースを 1 件以上書く。
- **E2E**: Playwright を使う。`tests/e2e/<画面名>.spec.ts` に置く。対象ブラウザは Chromium だけとする。
- カバレッジの数値目標は設けない。
```
