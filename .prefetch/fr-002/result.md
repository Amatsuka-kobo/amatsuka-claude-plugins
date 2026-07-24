# task-utility プラグインへのスクリプト追加手順（先行探索結果）

## 結論: 新規スクリプト追加の具体的手順

### 1. ソース配置場所
```
plugins/task-utility/src/<script-name>.ts
```
- 先頭に `#!/usr/bin/env node` を配置
- TypeScript で実装
- ESM モジュール形式（`import` 使用）

### 2. build.ts への登録方法（必須）
**ファイル**: `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/task-utility/build.ts` (L3-19)

build.ts の `entryPoints` オブジェクトに次の行を追加：
```typescript
"<script-name>": "./src/<script-name>.ts",
```

例）
- L6: `"check-issue-env": "./src/check-issue-env.ts",`
- L7: `"extract-conversation": "./src/extract-conversation.ts",`
- L8: `"find-chat-records": "./src/find-chat-records.ts",`
- L11: `"check-chat-recorded": "./src/hooks/check-chat-recorded.ts"`（hooks/ サブディレクトリの例）

### 3. バンドル出力先（自動生成）
```
plugins/task-utility/scripts/<script-name>.mjs
```
- esbuild により TypeScript ソースから自動バンドル
- Node.js 26 以上対応（target: "node26"）
- ESM 形式（outExtension: `.js` → `.mjs`）
- sourcemap なし、コマ区切り後の実行可能形式

### 4. テストの書き方（規約）
**ファイル位置**: `plugins/task-utility/src/__test__/<script-name>.test.ts`

**vitest 設定**: `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/vitest.config.ts` (L5)
```
include: ["plugins/**/__test__/**/*.test.ts"]
```

**テスト実行**: リポジトリルートから `pnpm test`

**テスト実装規約**:
1. `runTs()` ユーティリティを使用（`src/testing/run-ts.ts` L8-17 で定義）
   - tsx 経由で子プロセス実行
   - 引数: スクリプトパス, 引数配列, execFileSync オプション
   - 戻り値: stdout の文字列

2. テストで使用するスクリプトのパス取得:
   ```typescript
   import { fileURLToPath } from "node:url"
   const SCRIPT = fileURLToPath(new URL("../extract-conversation.ts", import.meta.url))
   ```

3. 一時ファイル・ディレクトリ管理:
   ```typescript
   import fs from "node:fs"
   import os from "node:os"
   import path from "node:path"
   
   const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prefix-"))
   // ...
   fs.rmSync(path.dirname(file), { recursive: true, force: true })
   ```

4. JSON 出力スクリプトのテスト例:
   ```typescript
   function runScript(args: string[]) {
     return JSON.parse(runTs(SCRIPT, args))
   }
   ```

5. 標準入力をシミュレートする場合（check-chat-recorded.ts など）:
   ```typescript
   const stdout = runTs(SCRIPT, [], { input: JSON.stringify({...}) })
   ```

## 根拠となるファイルパスと行番号

### build 定義
- `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/task-utility/build.ts` L3-19
  - esbuild.build() 呼び出し
  - entryPoints オブジェクトの構造（L5-12）
  - outdir: "./scripts" (L13)
  - outExtension: { ".js": ".mjs" } (L14)
  - platform: "node", format: "esm" (L15-16)
  - target: "node26" (L18)

### パッケージ定義
- `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/task-utility/package.json` L6
  - scripts.build: "tsx build.ts"
- `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/package.json` L6
  - pnpm build: "pnpm -r build" (全プラグインを再帰実行)

### テスト定義
- `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/vitest.config.ts` L5
  - テストパターン: "plugins/**/__test__/**/*.test.ts"
- `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/task-utility/src/testing/run-ts.ts` L8-17
  - runTs() ユーティリティの実装

### 既存スクリプト例
- `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/task-utility/src/extract-conversation.ts`
  - シェバング (L1)
  - stdin/stdout の取り扱い
  - プロセス引数パース (L7-20)
  - 終了ステータス管理 (L13)
  
- `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/task-utility/src/hooks/check-chat-recorded.ts`
  - stdin から JSON 読み込み (L19)
  - stdout に JSON 出力 (L102)
  - 常に exit 0 契約 (実装に明示されず、README L31 に「常に exit 0」の記載)

### テスト例
- `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/task-utility/src/__test__/extract-conversation.test.ts` L1-21
  - runTs() の使用方法
  - 一時ファイル生成・破棄パターン

- `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/task-utility/src/__test__/find-chat-records.test.ts` L16-28
  - 複雑なテストフィクスチャの生成パターン

- `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/task-utility/src/__test__/check-issue-env.test.ts` L11-22
  - 環境変数（PATH）制御・モックのパターン

## 関連する既存パターン、契約、影響範囲

### 既存スクリプトの設計契約
1. **シェバング必須**
   - 全スクリプト先頭に `#!/usr/bin/env node` を配置
   - Linux/macOS で直接実行可能にする

2. **引数パース**
   - process.argv.slice(2) で引数を取得
   - オプション形式の統一: `--option <value>` または `--flag`
   - 形式エラー時は stderr に使用法を出力し、適切なステータスで終了

3. **入出力の標準化**
   - JSON 出力スクリプトは常に exit 0（スキルが判断を行う）
   - stdin 読み込みはスクリプト自身が行う（check-chat-recorded.ts は JSON.parse(fs.readFileSync(0, "utf8"))）
   - エラーは JSON の ok/error フィールドに含める

4. **エラー処理**
   - FS 操作は全て try/catch で守る（find-chat-records.ts L70-79）
   - クラッシュさせず、exit 0 で JSON 結果を返す契約

5. **トランスクリプト処理の標準化**
   - 行カウント: split("\n") 直後、スキップ判定前に加算
   - 空行・パース不能行も 1 行と数える
   - extract-conversation.ts と check-chat-recorded.ts で共通の数え方を採用

### バンドル・デプロイメントの影響
- `plugins/task-utility/scripts/*.mjs` は git 管理対象
- `pnpm build` 実行後、diff に scripts/ の新規 .mjs ファイルが含まれる
- 変更時は必ず `pnpm build` してから git add すること
- プラグイン利用者はビルド不要（pre-built .mjs を使用）

### テストの契約
- 全テストは `pnpm test` でリポジトリルートから実行
- timeout: 20_000ms (vitest.config.ts L8)
- 子プロセス実行のため pool: "forks" 使用
- 一時ファイルはテスト終了後に必ず削除（rmSync）

### スクリプト配置の柔軟性
- src/ 直下に配置するのが標準（extract-conversation, find-chat-records など）
- src/hooks/ サブディレクトリにも配置可能（check-chat-recorded.ts）
- build.ts のエントリポイントで相対パス指定するだけで対応

## 未解決事項

なし。build.ts、package.json、vitest.config.ts、既存スクリプト・テストから必要な情報はすべて抽出できた。

## チャット記録パフォーマンス改善への適用例

新規スクリプト `optimize-chat-records.ts` を追加する場合：

1. **src/optimize-chat-records.ts** を作成（TypeScript、ESM）
2. **build.ts** の entryPoints に追加：
   ```typescript
   "optimize-chat-records": "./src/optimize-chat-records.ts",
   ```
3. **src/__test__/optimize-chat-records.test.ts** で vitest テスト実装
4. **pnpm build** を実行して scripts/optimize-chat-records.mjs を生成
5. スキル内で `node "${pluginRoot}/scripts/optimize-chat-records.mjs" <args>` で呼び出し
