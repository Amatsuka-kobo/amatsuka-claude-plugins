# Context Map: raphael プラグイン

**作成日**: 2026-07-24
**作成者**: GPT Sol(with-codex 方針・探索担当)
**対象タスク**: 承認済み raphael 設計を、既存プラグインのビルド・hook I/O・Stop 差し戻し・additionalContext パターンに接続し、詳細実装計画へ落とす。
**関連するBlueprintセクション**: 設計書 §2 抗体データ設計、§3 コンポーネント構成、§4 スコープ境界、§5 テスト方針、§6 実装の進め方

---

## 1. 目的・スコープ

- `plugins/raphael/` 新設前に、踏襲すべき構成・hook 契約・テスト方式・ルート設定への影響を圧縮する。
- スコープ内: codiel の TS→`.mjs` ビルド、pitcrew の hook I/O テスト、task-utility の Stop 差し戻し、prefetch の `additionalContext`、workspace/vitest。スコープ外: `docs/chat/`、Codiel/GOTCHAS 連携実装、API クライアント。

## 2. 現在のコードベース構造

### 2.1 主要ディレクトリ・ファイル構成（簡潔に）

```text
plugins/
├── codiel/       package.json + build.ts + src/ → scripts/*.mjs
├── pitcrew/      src/**/__test__/*.test.ts + src/testing/run-ts.ts
├── task-utility/ Stop hook の block/reason 差し戻し
├── prefetch/     UserPromptSubmit additionalContext の最小例
└── raphael/      現時点では未作成
root/
├── package.json          build/test/typecheck/lint と共有 devDependencies
├── pnpm-workspace.yaml   明示列挙式
├── vitest.config.ts      plugins/**/__test__/**/*.test.ts
└── tsconfig.json         plugins/*/src/**/*.ts と plugins/*/build.ts を包含
```

### 2.2 重要なファイル一覧（変更・参照が見込まれるもの）

| ファイルパス | 役割・内容の概要 | 重要度 | 備考 |
|---|---|---|---|
| `docs/superpowers/specs/2026-07-22-raphael-plugin-design.md` | 承認済み仕様 | High | 実装計画の正本 |
| `plugins/codiel/build.ts` | esbuild の entryPoints→`scripts/`、ESM、node26 | High | raphael が踏襲 |
| `plugins/pitcrew/src/testing/run-ts.ts` | TS hook を子プロセス実行する test helper | High | hook I/O 統合テストに複製 |
| `plugins/pitcrew/src/hooks/__test__/inject-pre-tool-use.test.ts` | stdin→stdout `hookSpecificOutput.additionalContext` 検証 | High | 沈黙経路も検証 |
| `plugins/task-utility/src/hooks/check-chat-recorded.ts` | Stop の `decision:block`/`reason` と再差し戻し防止 | High | `check-distill-needed` の基準 |
| `plugins/prefetch/scripts/check-prefetch-manifest.mjs` | `additionalContext` JSON 形式 | High | 発火時だけ 1 行 JSON |
| `pnpm-workspace.yaml` / `.claude-plugin/marketplace.json` | 新規 package / plugin 登録 | High | 明示追加が必要 |
| `vitest.config.ts` / `tsconfig.json` | テスト・型検査の glob | Medium | raphael は既存 glob に自動包含 |

## 3. 関連モジュール・コンポーネント

```text
hook stdin JSON
  ├─ PostToolUseFailure(Bash) / PostToolUse(Edit,Write) / UserPromptSubmit
  │    → detect-infection → infections/<session>.jsonl + state.json
  ├─ PreToolUse(Bash,Edit,Write)
  │    → antibody parser + trigger matcher → additionalContext + stats 更新
  └─ Stop
       → cleanup + 未蒸留件数判定 → decision:block/reason
                                      → antibody-synthesizer
                                           → list/update scripts
```

- hook entry は薄くし、JSONL・frontmatter・設定・マッチング・atomic I/O を `src/lib/` に分離するのが pitcrew の既存流儀。
- `/raphael:review` と synthesizer は `list-antibodies.mjs` / `update-antibody.mjs` を共有し、LLM の直接 frontmatter 編集を避ける。

## 4. 既存の実装パターン・規約

- ビルド: `tsx build.ts` → esbuild `bundle:true`, `outdir:"./scripts"`, `.js`→`.mjs`, `platform:"node"`, `format:"esm"`, `target:"node26"`。`scripts/` は git 管理、`dist/` は使わない。
- テスト: `runTs()` が `tsx/cli` 経由でソースを実行。tmp project を作り、stdin JSON・env・stdout・ファイル副作用を検証し、finally で削除する。
- hooks: 不正 stdin・対象なし・内部例外は原則無出力 exit 0。PreToolUse の注入は `{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:"..."}}`。
- Stop 差し戻し: `{decision:"block",reason:"..."}`。`stop_hook_active` と永続 marker/state を用いて無限ループを防ぐ。
- 書き込み: 同一ディレクトリの一時ファイル→rename。短命 hook は設定を毎回読み、設定不在・不正値は既定値へ落とす。
- ルート設定: workspace は plugin ごとの明示列挙。vitest/tsconfig は glob 済みで通常変更不要。

## 5. 変更の影響範囲（Impact Analysis）

### 5.1 直接影響を受ける箇所

- `plugins/raphael/**`: manifest、docs、hooks、TS source、tests、build outputs、agent、command、skillを新規作成。
- `pnpm-workspace.yaml`: `plugins/raphael` を追加。
- `.claude-plugin/marketplace.json`: raphael を登録。
- `pnpm-lock.yaml`: workspace package 追加に伴う更新。
- ルート `README.md`: 配布プラグイン一覧と概要追加。

### 5.2 間接的に波及する可能性がある箇所

- ルート `pnpm build/test/typecheck/lint`: raphael が再帰ビルド・glob 対象へ加わる。
- 利用先プロジェクトの `.gitignore`: `.raphael/infections/`, `.raphael/state.json`, `.claude/raphael.local.md` を推奨し、`.raphael/antibodies/` は commit 推奨。プラグインは自動変更しない。
- 全 Bash/Edit/Write: PreToolUse が常時走るため、非マッチ時の完全無出力とフェイルオープンが性能・安全上の最重要契約。

### 5.3 変更を避けるべき・最小限に留めるべき箇所

- Codiel 本体と GOTCHAS/Raguel: v0.1 は `source` の受け入れ余地だけで連携しない。
- ルート `vitest.config.ts` / `tsconfig.json`: 既存 glob で包含されるため変更不要。
- `CLAUDE.md`: 変更不要かつ人間確認が必要な管理対象。
- `docs/chat/**`: 読まない・変更しない。

## 6. 守るべき既存契約・インターフェース

- Plugin version は `0.1.0-dev` から開始し、package も同版に揃える。
- Anthropic API / API client / `ANTHROPIC_API_KEY` を使わない。LLM は Claude Code の synthesizer サブエージェントだけ。
- source of truth は `src/*.ts`、配布実行物は `scripts/*.mjs`。source 変更後は `pnpm build` 必須。
- hook stdout は機械可読 JSON 1 件または空文字のみ。診断ログを stdout に混ぜない。
- `additionalContext` は `hookSpecificOutput.hookEventName` を実イベント名に合わせる。
- Stop は `stop_hook_active` を尊重し、同じ未蒸留集合に対する再差し戻しを防ぐ。
- `PostToolUseFailure` が失敗捕捉の既存イベント。設計書の「Bash exit code ≠ 0」は hook payload に常に数値 exit code があるとは限らず、failure event/error から判定する必要がある。
- frontmatter/JSONL/state の更新は atomic replace。JSONL 追記・distilled 更新も read-modify-write で一貫したファイルを生成する。

## 7. 未解決事項・不明点（Open Questions）

| # | 質問内容 | 影響度 | 上流報告先(役割) | 現状の仮定 |
|---|---|---|---|---|
| 1 | 設計書はコマンド失敗を `PostToolUse` の exit code 非0としているが、既存実測契約は `PostToolUseFailure` であり、`tool_response` に数値 exit code が無い場合がある。hooks に `PostToolUseFailure(Bash)` を追加してよいか | High | 最上位オーケストレーター | 追加する。exit code を抽出できる時だけ除外リストを精密適用し、最低限 failure event + error を証拠化する |
| 2 | 同一抗体へ複数 hook が並行更新すると atomic rename だけでは lost update を防げない | Medium | 戦術オーケストレーター | v0.1 の単一セッション前提を優先し、ロックは導入せず、統計欠損の可能性を既知制約として文書化する |
| 3 | 設計書の「蒸留済みマークは update-antibody.mjs と同系」は責務名と不一致(感染記録も更新する) | Low | 戦術オーケストレーター | CLI 名は仕様どおり維持し、`mark-distilled` 操作を同 CLI に持たせる |

## 8. テスト戦略・既存テスト

- Unit: frontmatter parse/serialize/validation、JSONL schema/I/O、config、regex compile/match、scope glob、retry normalization、command failure exclusions、rejection vocabulary、edit overlap、expiry/selection。
- Hook I/O integration: pitcrew と同じ `runTs` + tmp project。各 hook に JSON stdin を流し、stdout JSON/空、感染ファイル、state、stats、cleanup を観測。
- 最重要境界: inoculate 非マッチ/壊れた抗体/壊れた stdin は無出力、最大3件・新しい順、Bashではscope無視、Edit/Writeではプロジェクト外パス拒否。
- Stop: threshold 未満、threshold 到達、`stop_hook_active`、同一集合 nag-once、掃除、壊れた JSONL のフェイルオープン。
- 全体: `pnpm build && pnpm test && pnpm lint && pnpm typecheck`。生成 `scripts/*.mjs` も代表 fixture で smoke 実行する。

## 9. 依存関係・リスク・制約

- ランタイム依存は Node 標準ライブラリのみとし、YAML/glob ライブラリを追加しない。必要な frontmatter と glob は仕様範囲の小さな実装に限定する。
- ユーザー発言・コマンド・エラー抜粋には機密が入り得る。文字数/行数上限を設け、完全な tool input/output を保存しない。
- ユーザー差し戻し語は短い語の部分一致で誤検知しやすい。日本語は句中一致、英語の `no` は先頭応答に限定するなど境界を定義する。
- 抗体 regex はユーザー/LLM 生成物。無効 regex は抗体単位でスキップし、hook 全体を落とさない。v0.1 では ReDoS の完全防御はせず、pattern 長上限を設ける。

## 10. 推奨アプローチ（高レベル）

- まず file formats/config/atomic I/O の共有基盤を固定し、次に感知・接種・Stop を独立実装する。
- hook は薄く、判定ロジックを純粋関数へ寄せて unit と fixture stdin の二層で検証する。
- `PostToolUseFailure` を command failure の正経路として hooks に配線し、`PostToolUse` は Edit/Write churn と取得可能な成功履歴に使う。
- management CLI を唯一の抗体/感染更新経路にし、command と synthesizer は同じ JSON 出力契約を使う。
- 配布前に workspace/marketplace/docs/version/build outputs を一括で仕上げる。

## 11. 補足・暗黙知の可能性が高いポイント

- 既存 plan は新規 plugin で workspace/marketplace/lockfile/README を明示タスク化する。設計書の構成図だけではこのルート変更が抜けやすい。
- `scripts/` は biome/tsconfig の対象外で、品質検証は source に対して行い、build 後の生成物は差分と smoke で確認する。
- Stop の block は失敗ではなく、メインエージェントにサブエージェント起動を促す制御出力。通常 hook のフェイルオープン方針と区別する。
- `/raphael:review` は command Markdown が UI オーケストレーションを担い、状態変更は必ず `update-antibody.mjs` へ委譲する。

---

**次のステップ提案**:

- Open Question #1 の `PostToolUseFailure` 追加を前提に詳細 WBS を作る。
- 計画承認時に #1 と #2 を明示し、実装移行は最上位オーケストレーターの Approve 後とする。

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に定義された役割・チェックポイントに従い、本文は小さく蒸留された状態に保つ。*

> 注意: この context-map に API キー・トークン・パスワード・プロキシの秘密値などの機密情報を記録しないこと。保存先が git 追跡対象の場合に漏えいするおそれがある。
