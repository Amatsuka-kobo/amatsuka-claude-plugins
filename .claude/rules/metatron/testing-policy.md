# テスト方針

> この文書は metatron の管理下にある。直接編集は PreToolUse hook が拒否する。更新は metatron の CLI(`stage-rules` → `commit-rules`)で行う。CLI の絶対パスは、セッション冒頭の注入文または hook の拒否メッセージに載っている。

- ユニットテストは vitest で書く。E2E テストは持たない。
- テストは対象ソースと同じディレクトリの `__test__/` に置く。`src/lib/adr.ts` のテストは `src/lib/__test__/adr.test.ts` とする。
- テストファイル名は `<対象ファイル名>.test.ts` とする。複数のモジュールにまたがる統合テストは、入口のあるディレクトリの `__test__/` に置く。
- 複数のテストから使うヘルパーは `__test__/helpers/` に置き、`.test.ts` を付けない。
- 子プロセスとして起動するエントリポイントと故障注入は `src/testing/` に置く。lint と型検査の対象外にするものは拡張子を `.mjs` にする。
- テストが読み込む固定データは `src/fixtures/` に置く。
- vitest が拾うのは `plugins/**/__test__/**/*.test.ts` だけである。この外に置いたテストは実行されない。
- 実行環境は node、プロセス分離は forks、タイムアウトは 20 秒とする。
