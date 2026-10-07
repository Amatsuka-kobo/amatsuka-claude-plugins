# Context Map: metatron の管理対象文書を `.claude/rules/` へ拡大する

**作成日**: 2026-08-24
**作成者**: Opus(探索統括)。探索実働は Grok Researcher 7 体へバッチ委譲した。
**対象タスク**: 設計書 `harness-docs/design/2026-08-24-metatron-rules-expansion-design.md` の §16(14 ステップ)を実装計画書(WBS)へ分解する。
**関連する設計書セクション**: §4〜§16(とくに §14 追随先・§15 テスト・§16 順序)

---

## 1. 目的・スコープ

metatron の管理対象を ARCHITECTURE + GOTCHAS の 2 種から、`.claude/rules/metatron/` 配下の 3 ファイルを加えた 3 種へ拡大する。ARCHITECTURE の `## 規約` `## 保護パス` `## テスト方針` を rules へ移し、サブエージェントへ規律が届く状態にする。

- スコープ内: `plugins/metatron/`、codiel の指示層(節名参照の削除)、このリポジトリ自身の移行、契約凍結文書と README の追随。
- スコープ外: codiel / sandalphon の config 実装(`paths.rulesDir` は未知キーとして無視されるため)、既存プロジェクトの移行経路(利用者が居ない)。

## 2. 現在のコードベース構造

```
plugins/metatron/
├── src/
│   ├── lib/       config.ts / architecture.ts / scan.ts / staging.ts / adr.ts / gotchas.ts / emit.ts
│   ├── cli/       main.ts / get.ts / stage.ts / commit.ts / paths.ts / input.ts / output.ts / args.ts / diff.ts / analysis.ts / gotcha.ts
│   ├── guard-docs.ts     PreToolUse deny hook
│   ├── inject-context.ts SessionStart 注入 hook
│   ├── testing/   run-ts.ts(子プロセス起動ヘルパ)/ fault-config.mjs
│   └── __test__/ + lib/__test__/ + cli/__test__/
├── references/  architecture-format.md / writing-discipline.md / config-schema.md / cli-usage.md / gotchas-format.md
├── skills/      capturing-architecture / updating-architecture / recording-gotchas
├── docs/        ARCHITECTURE.example.md / GOTCHAS.example.md / format-change-checklist.md / rationale.md
└── hooks/hooks.json
```

`src/fixtures/` は未作成(ARCHITECTURE の規約上、テストの固定データの置き場)。`src/lib/rules.ts` も未作成。

### 変更・参照が見込まれる主要ファイル

| ファイル | 役割 | 重要度 |
| --- | --- | --- |
| `src/lib/config.ts` | `paths` 解決。`resolveConfiguredPath:156-201` が拒否規則を持つ | High |
| `src/lib/architecture.ts` | `ARCHITECTURE_HEADINGS:24-35` / `validateHeadingKey:360-394` / `applySectionChanges:714` | High |
| `src/lib/scan.ts` | `ARCHITECTURE_SECTIONS:25-36`(独立複製)/ `section_missing` 検出 `:1623-1633` | High |
| `src/lib/staging.ts` | `StagingKind:29` / `isStagingKind:215-217` / `commitStaging:453-556` | High |
| `src/cli/main.ts` | `READ_SUBCOMMANDS:30` / `WRITE_SUBCOMMANDS:32-38` / switch `:84-112` | High |
| `src/cli/commit.ts` | `runCommitArchitecture:29-100`。**kind を照合しない** | High |
| `src/cli/paths.ts` | `INPUT_SCHEMAS:35-56` / `USAGE_LINES:58-78` | Medium |
| `src/guard-docs.ts` | `comparisonKey:155-159` / 一致判定 `:203-216` / 理由文 `:161-182` | High |
| `src/inject-context.ts` | `cliLines:78-89` / 段階縮退 `plans:249-278` / 予算適用 `:477-491` | Medium |
| `plugins/codiel/skills/**`, `agents/**` | 節名参照 14 ファイル(設計書 §14-2 の 13 行表) | High |
| `harness-docs/design/2026-08-16-file-contract-freeze.md` | §4-1:229 / §4-3:284 / §7:470 / §11:641 | Medium |

## 3. 関連モジュール・データフロー

- `loadConfig(cwd)` → `ResolvedConfig`(`docRoot` / `architecturePath` / `gotchasPath` / `injection` / `warnings: string[]`)。CLI・guard・inject の 3 者すべてがこれを唯一の入口として使う。`paths.rulesDir` を足せば 3 者へ自動的に伝わる。
- 書き込みは `stage-*` → `staging.ts` に単一ターゲットのレコードを保存 → `commit-*` が `withFileLock` の下で `commitStaging` を呼ぶ、の 2 段。
- `parseArchitecture`(分割)は見出し許可リストに依存しない。許可リストが効くのは **検証・挿入順序・欠落検出・CLI 案内** の 4 箇所だけである。

## 4. 既存の実装パターン・規約

- サブコマンドは kebab-case(`stage-architecture`)、`get` の対象はスペース区切り 1 語(`get architecture`)、エラーコードは snake_case(`not_created` / `unknown_heading`)。
- 読み取り系は常に exit 0。未作成は `error: "not_created"` で返し、異常にしない。
- 警告は `string[]`。オブジェクト化は 3 実装とテストを一斉に壊す。
- テスト ID は接頭辞で系統が決まる。`A*`(architecture)/ `C*`・`R4-*`(config)/ `D*`(guard)/ `G*`(gotchas)/ `I*`(inject)/ `R-A*`(adr)/ `S*`(scan・CLI)/ `T*`(staging)。
- テストは子プロセス起動(`testing/run-ts.ts`)で CLI を叩く。vitest は `plugins/**/__test__/**/*.test.ts` だけを拾い、タイムアウトは 20 秒。

## 5. 変更の影響範囲

### 5.1 直接影響

`config.ts` / `architecture.ts` / `scan.ts` / `staging.ts` / `cli/*` / `guard-docs.ts` / `inject-context.ts` と、対応する 7 本のテスト。`references/` 5 本、`skills/` 2 本、`docs/` 3 本、`README.md`。

### 5.2 間接的に波及

- **CLI 案内が三重管理**。`INPUT_SCHEMAS` / `USAGE_LINES`(`cli/paths.ts`)、`cliLines`(`inject-context.ts`)、`architectureReason` / `gotchasReason`(`guard-docs.ts`)が独立に同じことを広告する。さらに `inject-context.test.ts:28-57` がテスト側で `GUIDE` / `INIT_GUIDE` を再定義している。片方だけ変えると I1 / I3 / I13 / I21 が落ちる。
- **見出し許可リストが二重管理**。`ARCHITECTURE_HEADINGS`(architecture.ts)と `ARCHITECTURE_SECTIONS`(scan.ts)は import 関係が無い。片方だけ 7 節にすると、移行済みプロジェクトで `diff-architecture` が 3 節を欠落として報告し続ける。
- codiel の指示層。設計書 §14-2 の 13 行表に載らない参照が実測で追加検出された(§7-1)。

### 5.3 変更を避けるべき箇所

- `staging.ts` の単一ターゲット構造。「書き込み系が非 0 で終わったとき、対象ファイルは 1 バイトも変わっていない」(`references/cli-usage.md:33`)の根拠である。`StagingKind` に値を足すだけに留める。
- codiel / sandalphon の config 実装と 3 者比較テスト(metatron `config.test.ts:242-306` の `R4-*`、sandalphon `check-intent-env.test.ts:828+` の 16f、codiel `hooks/__test__/lib.test.ts:638+`)。`paths.rulesDir` は未知キーとして無視されるため対象外(設計書 §14-3)。

## 6. 守るべき既存契約

| 契約 | 出典 |
| --- | --- |
| 書き込み系が非 0 で終わったとき対象ファイルは 1 バイトも変わっていない | `references/cli-usage.md:33`、契約凍結 §11 |
| 読み取り系は常に exit 0。未作成は `not_created` | `cli/main.ts:29-30`、`cli/output.ts:31-40` |
| セクション分割はフェンス状態機械。許可リストと独立 | 契約凍結 §4-2、設計書 §9-3 |
| `unclosed_fence` は書き込み拒否 / 読み取り継続の 2 層 | 契約凍結 §4-3:284-297 |
| 正本への Edit / Write / NotebookEdit は deny hook が拒否する | `hooks/hooks.json:17` |
| 契約凍結文書を変更するときは実装を止めてユーザーに確認する | 契約凍結 `:18`。設計書の承認をこの確認とする(§14-3) |

## 7. 未解決事項

実装計画書 §「承認を要する読み替え」の 8 件に統合済み。ユーザー承認で確定させる。

| # | 内容 | 影響度 | 採る読み替え |
| --- | --- | --- | --- |
| 1 | `commit-architecture` は `kind` を照合していない。設計書 §15 の「kind 不一致の拒否」は新規実装になる | High | `commit-architecture` は `{architecture, adr}`、`commit-rules` は `{rules}` を受ける照合を新設する |
| 2 | codiel の節名参照が設計書 §14-2 の 13 行表を超える | High | 表を出発点とし、インベントリテストで分類 A ゼロを機械確定する |
| 3 | インベントリの検出正規表現の形を設計書が定めていない | High | 4 形に限定し、加えて `ARCHITECTURE` の全言及を登録対象にする |
| 4 | サブエージェント到達プローブが `claude` CLI とネットワークに依存する | High | 既定でスキップし、`METATRON_RULES_PROBE=1` のときだけ実行する |
| 5 | `remove: true` で `## ADR 一覧` を消せるかが未定義 | Medium | 従来どおり `adr_heading` で拒否する |
| 6 | `ResolvedConfig` のフィールド名 | Low | `rulesDirPath` / `rulesDirRelative` |
| 7 | 設計書 §14 の「同じコミット」と §16 のステップ分割が衝突する | Medium | §16 を優先。§9-2 の 2 箇所だけ 1 コミット必須 |
| **8** | **§16 の列挙順どおりステップ 9(注入の CLI 案内)を先に置くと、注入が縮退した状態でステップ 10・11 を実行することになる** | **High** | **Task 9 を区間 2 の最後に実行する。実行順 1→…→8→10→11→9** |

### #8 の根拠(実測)

- 着手前の注入は 8,918 文字、`injection.maxChars` は 9,000、残り予算 **82 文字**。
- Task 9 の追加は CLI 案内 2 行(161)+ 改行(2)+ 中間文の差分(36)= **+199 文字**。設計書の見積もり「約 +150」より大きい。
- 設計書 §12-2 の実測では **+155 文字で 8,918 → 1,326** へ落ちる。`archMode: "outline"` まで一気に到達する。
- 列挙順どおりだと、`## 保護パス` と `## 規約` が消えた状態で codiel の指示層 15 ファイルを書き換えることになる。本設計が解こうとしている問題を実装中に自ら作る。
- Task 9 は Task 3 にしか依存しない。最後へ回しても §16 の依存関係を 1 つも崩さない。

## 8. テスト戦略・既存テスト

- 既存 7 ファイル、いずれもユニット + 子プロセス経由の CLI 統合。E2E は持たない。
- 設計書 §15 が落ちるテストを ID で名指ししている。完了条件は既存 ID へ紐づけられる。
- 新規 ID は既存の接頭辞体系を延長する(`C13`〜 / `T9` / `A20`〜 / `D15`〜 / `I22`〜 / `S7`〜)。rules 単体は新接頭辞 `RL*`、インベントリは `V*`、プローブは `P*`。
- **落ちないことを確認する**テストがある。`staging.test.ts` の `T1`〜`T8d`(単一ターゲット構造が変わっていない証拠)。

### 実測値(2026-08-24 時点、このリポジトリ)

| 項目 | 値 |
| --- | --- |
| `harness-docs/ARCHITECTURE.md` 総文字数 | 8,204(`## ADR 一覧` は存在せず 9 節) |
| テスト方針 / 保護パス / 規約 | 531 / 1,720 / 1,481(計 3,732) |
| 注入 `additionalContext` | 8,918 文字、縮退マーカー(`を Read すること`)なし |
| `injection.maxChars` | 9,000(既定。`metatron.config.json` は `paths` のみ指定) |

## 9. 依存関係・リスク・制約

- `.claude/rules/` は未作成。`.gitignore:13` は `.claude/context-maps` のみ除外。rules は git 追跡下に入る。
- 注入予算の残りは 82 文字。ARCHITECTURE への追記は移行(ステップ 12)より前に行うと崖に落ちる。設計書 §16 のステップ 13 がこの制約を根拠に追記を後置している。
- `metatron.config.json` は `paths` を `harness-docs/` へ上書き済み。既定値 `docs/ARCHITECTURE.md` をハードコードしない。
- metatron の版は `0.1.6-dev`。マイナーを上げて `0.2.0-dev` にする。

## 10. 推奨アプローチ

1. 設計書 §16 の 14 ステップを Task 1〜14 に 1 対 1 で対応させる。依存グラフ(1→2→{3,5}→{4,6}、10→11→12→13)を崩さない。
2. 区間 2(Task 1〜11)と区間 3(Task 12〜14)の境界を明示する。区間 3 だけが正本へ書き込み、承認ゲートを持つ。
3. §7 の未解決 7 件を「承認を要する読み替え」として計画書の冒頭に集め、実装中に判断させない。
4. 「落ちないことを確認するテスト」を完了条件へ明記し、退行を検出可能にする。

## 11. 補足・暗黙知

- 迂回の禁止が設計書 §16-1 に場面別で書かれている。実装セッションの終了時に一時スクリプト・hook 無効化が残っていないことの確認が完了条件に入る。
- `plugins/basic-design/skills/api-list/references/template.md:27` の `## 規約` はインベントリの偽陽性候補。ARCHITECTURE の節ではないため分類 D で登録する。
- metatron の `README.md:25`(ADR は空の節を置く)と `capturing-architecture/SKILL.md:70`(空の節も作らない)が既に食い違っている。本変更のスコープ外であり、触らない。

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に従う。*
