# metatron: 管理対象文書を `.claude/rules/` へ拡大する 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** metatron の管理対象を ARCHITECTURE / GOTCHAS の 2 種から `.claude/rules/metatron/` の 3 ファイルを加えた 3 種へ拡大し、`## 規約` `## 保護パス` `## テスト方針` を rules へ移してサブエージェントへ規律が届く状態にする。

**Architecture:** rules 本文は metatron が注入しない。読み込みは Claude Code の公式機構(frontmatter を持たない `.claude/rules/**/*.md` は起動時に読まれ、サブエージェントにも渡る)へ委ねる。metatron は書き込み経路(`stage-rules` → `commit-rules`)と編集の禁止(PreToolUse deny hook)だけを持つ。staging は単一ターゲットのまま変えず、`StagingKind` に値を 1 つ足すだけにする。

**Tech Stack:** TypeScript(esbuild で ESM へバンドル)、vitest、Claude Code のプラグイン機構(hooks / skills / commands)

**Spec:** `harness-docs/design/2026-08-24-metatron-rules-expansion-design.md`(2026-08-24 ユーザー承認済み)

**運用指示:** `docs/prompts/2026-08-24-metatron-rules-expansion-implementation.md` の §運用指示

**Context map:** `.claude/context-maps/2026-08-24-metatron-rules-expansion.md`

**状態:** 2026-08-24 ユーザー承認済み。§「承認を要する読み替え」の 8 件はこの承認で確定している。**実装中に読み替えを再検討しない。**設計書に無い新たな判断が要るときだけ作業を止めて質問する。

---

## Global Constraints

- Node は `>=26`(volta 固定 26.3.1)、パッケージマネージャは pnpm `11.8.0`。TypeScript は `strict` / `noEmit`。esbuild の `target` は `node22`、出力は ESM の `.mjs`。
- 各タスクの終わりに `pnpm run lint` と `pnpm run typecheck` と `pnpm run test` を通す。
- `plugins/metatron/src/` を変更したタスクは `pnpm run build` を実行し、`plugins/metatron/scripts/` の差分を同じコミットに含める。
- `plugins/*/scripts/` と `plugins/*/dist/` を手で編集しない。
- **metatron の PreToolUse hook を迂回しない。** 一時的にも無効化しない。迂回スクリプトを作らない。`rm` や `sed` で正本を直さない。場面別の対処は設計書 §16-1 にある。
- 正本(`harness-docs/ARCHITECTURE.md` / `harness-docs/GOTCHAS.md` / `.claude/rules/metatron/*.md`)への書き込みは CLI 経由でのみ行う。`stage-*` で diff を得て、全文をユーザーへ提示して承認を得てから `commit-*` を実行する。`stage-*` が exit 0 で返ったことを承認と読み替えない。
- CLI への長い入力は一時ファイルへ書き `--input <path>` で渡す。引数へ本文を直接埋めない。
- ブランチを切らない。切る必要があると判断したときは git worktree を使う。`git push` に `--force` 系を付けない。
- Markdown / TypeScript の編集は Serena の編集ツールで行う。コードベースの探索は Serena のシンボルツールで行い、0 件でも結論にせず Grep で裏を取る。
- AI 向け指示書(`skills/**/SKILL.md`・`references/*.md`・`agents/*.md`・`CLAUDE.example.md`)を編集するときは `prompt-smith:prompt-smith` スキルを使う。
- ライブラリ・CLI・API の仕様は Context7 で取る。Web 検索より優先する。
- 設計書に無い判断が要るときは、自分で決めずに作業を止めて質問する。設計書の記述と実装が食い違うときは、実装を設計書へ合わせる。
- metatron はまだ利用者を持たない。破壊的変更を許す。後方互換のための経路を足さない。
- バージョン: metatron は `0.1.6-dev` → `0.2.0-dev`(設計書 §14-1 がマイナーを上げると定める)。codiel は `0.5.3-dev` → `0.6.0-dev`(指示層 14 ファイルの書き換えとフォールバック新設は ARCHITECTURE 規約の「変更が多いとき」に当たる)。`plugin.json` と `package.json` を揃える。
- サブエージェントへ委譲するときは、運用指示 §サブエージェントへ規律を転記する の 6 項目を依頼文へ書く。この実装が完了するまで `## 規約` と `## 保護パス` はサブエージェントに届かない。

---

## 承認を要する読み替え

設計書に記述が無いか、設計書内の記述同士が衝突する点が 7 件ある。**この計画の承認をもってこれらの読み替えを確定させる。**実装中に再度の判断をしない。

| # | 論点 | 設計書の記述 | この計画で採る読み替え | 根拠 |
| --- | --- | --- | --- | --- |
| 1 | `commit-rules` / `commit-architecture` の kind 照合 | §15 が「`commit-rules` に `kind: "architecture"` の stagingId を渡したときの拒否。逆も同様」を新規テストに挙げる | **kind 照合を新設する。** 現状の `runCommitArchitecture`(`src/cli/commit.ts:29-100`)は kind を見ておらず、`architecture` と `adr` を無差別に消費している。`commit-architecture` は `{architecture, adr}`、`commit-rules` は `{rules}` を受ける照合を足す。エラーコードは `staging_kind_mismatch` | §15 のテスト要求は既存実装では満たせない。実測で確認済み |
| 2 | codiel の節名参照の件数 | §14-2 が 13 件の表を持つ | **表を出発点とし、ステップ 11 のインベントリテストで分類 A ゼロを機械確定する。** 実測では表外にも分類 A が存在する(`plugins/codiel/skills/fixing-review-findings/SKILL.md:52`、`writing-dev-plans/SKILL.md:45,106`、`implementing/SKILL.md:30`、`initializing-harness/SKILL.md:73,111,169,182`)。表外で見つかった分類 A も Task 10 で同じ方針で消す | §14-4 が「分類 A に例外を認めない」と定める。表の件数ではなく分類 A ゼロが完了条件である |
| 3 | インベントリの検出の形 | §14-4 が「検出する語」だけを定め、マッチの形を定めていない | **4 形に限定し、加えて `ARCHITECTURE` の全言及を登録対象にする。** 形は (a) `` `## <見出し名>` ``、(b) 行頭の `## <見出し名>`、(c) `「<見出し名>」節` または `<見出し名> 節`、(d) `ARCHITECTURE` と同じ行に検出語が現れる形。さらに (a)〜(d) に当たらなくても `ARCHITECTURE` を含む行は登録を要する | 素朴な全文検索は「見出し規約」「ブランチ運用の規約」を誤検出する。一方 3 形だけでは `plugins/codiel/agents/codiel-reviewer-doc.md:25`(「ARCHITECTURE のドメインマップ、規約、コマンド定義」)や `plugins/codiel/skills/fixing-review-findings/SKILL.md:52`(「ARCHITECTURE のテストコマンド」。13 語のいずれも含まない)を取りこぼす |
| 4 | サブエージェント到達プローブの実行条件 | §15 が「§17-2 と §17-3 の手順をテストとして残す」とだけ定める | **既定でスキップし、`METATRON_RULES_PROBE=1` のときだけ実行する。** `claude` CLI とネットワークに依存し、vitest のタイムアウト 20 秒を超えるため | 区間 2 の完了条件は `pnpm run test` が exit 0 で終わること。無条件実行はこれを満たせない |
| 5 | `remove: true` で `## ADR 一覧` を消せるか | §6-2 は「削除の検証は対象ファイルにセクションが存在するかで行う」、§9-1 は「`remove: true` は許可リストの制限を受けない」。ADR への言及は無い | **`remove: true` でも `## ADR 一覧` は従来どおり `adr_heading` で拒否する。** ADR 節の削除は本設計の対象外であり、最小変更に留める | 移行対象は 3 節であり、ADR 節の削除を必要とする場面が本設計に無い |
| 6 | `ResolvedConfig` のフィールド名 | §5 が「`ResolvedConfig` に `rulesDir` フィールドを足し」と書く | **`rulesDirPath`(絶対パス)と `rulesDirRelative`(docRoot からの相対)とする。** 既存は `architecturePath` / `architectureRelative`、`gotchasPath` / `gotchasRelative` の対で揃っている | 設計書の文言は散文であり、既存の命名規約との整合を優先する |
| 7 | 追随のコミット粒度 | §14 が「本変更では次をすべて同じコミットで追随させる」、§16 はステップごとにコミットを分け、ステップ 10 と 12/13 で明示的に分割を要求する | **§16 のステップ分割を優先する。** ただし §9-2 が名指しする 2 箇所(`ARCHITECTURE_HEADINGS` と `ARCHITECTURE_SECTIONS`)だけは同一コミット必須とし、Task 5 に閉じる | §14 の「同じコミット」を字義どおり取ると区間 2 と区間 3 をまたぐ 1 コミットになり、承認ゲートを持つ区間 3 の設計と矛盾する |

| 8 | 区間 2 の実行順 | §16 はステップ 9(注入の CLI 案内)をステップ 10・11 より前に列挙する。ただし依存関係の列挙にはこの前後関係が無い | **Task 9 を区間 2 の最後に実行する。** 実行順は 1→2→3→4→5→6→7→8→**10→11→9**→区間 2 の完了ゲート とする。Task 番号は §16 のステップ番号と 1 対 1 のまま変えない | 下の「注入の崖」を参照。§16 が定める依存(2←1 / 6←2,5 / 10 は 12 より前 / 11 は 10 の直後 / 12 は 1〜11 の後 / 13 は 12 の後)はすべて満たす |

### 注入の崖(読み替え #8 の根拠)

着手前の実測は注入 8,918 文字、`injection.maxChars` は既定 9,000、**残り予算は 82 文字**である。Task 9 が足す CLI 案内 2 行と中間文の差分は、実測で **+199 文字**になる。

```
  規律:     node M get rules [--name conventions|protected-paths|testing-policy]   … 78
  規律更新: node M stage-rules --input <一時ファイル> → node M commit-rules …      … 83
  改行 2                                                                            …  2
  buildGuide の中間文の差分                                                         … 36
                                                                          合計 +199
```

設計書 §12-2 は **+155 文字の追加で注入が 8,918 から 1,326 へ落ちる**ことを実測している。段階縮退が `archMode: "outline"` まで一気に到達し、ARCHITECTURE が目次と各節の要約 1 行へ縮む。**警告もエラーも出ない。**

§16 の列挙順どおり Task 9 を Task 10 の前に置くと、**`## 保護パス` と `## 規約` の全文がコンテキストから消えた状態で、codiel の指示層 15 ファイルを書き換えることになる。**「バンドル出力を手で編集しない」「ブランチを切らない」といった規律が、まさにそれを必要とする作業の最中に届かなくなる。本設計が解こうとしている問題そのものを、実装中に自ら作り出すことになる。

Task 9 を最後へ回すと、縮退する窓は「Task 9 のコミット → Task 12 の移行完了」だけになる。この窓では metatron 内の実装も codiel の書き換えも既に終わっており、残るのは区間 2 のゲートと区間 3 の移行だけである。移行は ARCHITECTURE を明示的に Read して本文を写す作業であり、注入の縮退に依存しない。

加えて、設計書が置き場を定めていない作業が 1 つある。

- **サブエージェント到達の回帰プローブ**(§15)。§16 の 14 ステップに置き場が無い。**Task 11 に同梱する。** ステップ 11 が「10 の完了を機械で固定する」回帰の置き場であり、性質が同じである。

---

## ステップと Task の対応

設計書 §16 の 14 ステップに Task 1〜14 を 1 対 1 で対応させる。番号は設計書と一致する。

| Task | 設計書 §16 のステップ | 区間 | 先行する Task | 実行順 |
| --- | --- | --- | --- | --- |
| 1 | config に `rulesDir` を足す | 2 | なし | 1 |
| 2 | `StagingKind` に `"rules"` を足す | 2 | 1 | 2 |
| 3 | `src/lib/rules.ts` と `get rules` / `stage-rules` / `commit-rules` | 2 | 1, 2 | 3 |
| 4 | guard hook の拡張 | 2 | 1, 3 | 4 |
| 5 | 見出し許可リストを 7 節へ、`MOVED_HEADINGS`、許可リスト外への `body` 拒否 | 2 | 1 | 5 |
| 6 | `stage-architecture` の `remove: true` | 2 | 2, 5 | 6 |
| 7 | 書式契約と参照文書の更新 | 2 | 3, 5, 6 | 7 |
| 8 | skills(init / update)の更新 | 2 | 3, 7 | 8 |
| 9 | 注入の CLI 案内 | 2 | 3 | **11(最後)** |
| 10 | codiel のスキルから節名参照を削除し、フォールバックを新設する | 2 | なし(metatron 側と独立) | 9 |
| 11 | 節名参照インベントリのテスト + 区間 2 の完了ゲート | 2 | 10、および 1〜8 | 10 → (9) → ゲート |
| 12 | このリポジトリ自身の移行 | 3 | 1〜11 のすべて | 12 |
| 13 | 移行した 3 ファイルの内容更新と ARCHITECTURE への追記 | 3 | 12 | 13 |
| 14 | 契約凍結文書と README の追随 | 3 | 13 | 14 |

依存グラフ(設計書 §16 の「依存関係は次のとおり」を満たす):

```
1 ──┬── 2 ──┬── 3 ──┬── 4
    │       │       ├── 9
    │       │       └── 7 ── 8
    │       └── 6 ──┘
    └── 5 ──┘

10 ── 11 ── 12 ── 13 ── 14
```

**実行順は依存グラフと同じではない。**読み替え #8 のとおり、区間 2 は次の順で実行する。

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 10 → 11 → 9 → 区間 2 の完了ゲート
```

Task 9 だけが列挙順から外れる。注入の崖(読み替え #8 の根拠)を Task 10・11 の後へずらすためである。Task 9 の依存は Task 3 だけなので、この移動は §16 の依存関係を 1 つも崩さない。

- 2 は 1 に依存する。
- 6 は 2 と 5 に依存する。
- **10 は 12 より前に置く。** 順序を逆にすると、移行してから codiel を直すまでの間、ベースブランチの解決とテストフレームワークの解決が壊れる。
- 11 は 10 の直後に置く。間を空けると、その間に新しい節名参照が入りうる。
- 12 は 1〜11 がすべて済んでから行う。
- 13 は 12 の後に、別のコミットで行う。

**区間の境界。** Task 1〜11 が区間 2(`/goal` で自動継続する。承認ゲートを持たない)、Task 12〜14 が区間 3(通常のプロンプト。各段階で承認ゲートを持つ)である。区間 2 では正本へ一切書き込まない。書式契約と参照文書は `references/` 配下で hook の対象外である。

---

## ファイル構成

### 新規

| パス | 責務 |
| --- | --- |
| `plugins/metatron/src/lib/rules.ts` | rules 3 ファイルの名前・パス導出・読み取り・書式検証 |
| `plugins/metatron/src/lib/__test__/rules.test.ts` | 上記のユニットテスト(`RL1`〜`RL10`) |
| `plugins/metatron/src/fixtures/section-reference-inventory.json` | 節名参照の登録簿(分類 B / C / D) |
| `plugins/metatron/src/__test__/section-reference-inventory.test.ts` | 登録簿と実体の照合(`V1`〜`V3`) |
| `plugins/metatron/src/__test__/rules-subagent-probe.test.ts` | rules がサブエージェントへ届くことの回帰プローブ(`P1`・`P2`。既定でスキップ) |
| `plugins/metatron/references/rules-format.md` | rules の書式契約(何を書くか) |
| `plugins/metatron/docs/RULES.example.md` | rules 3 ファイルの記入例 |
| `.claude/rules/metatron/conventions.md` | 旧 `## 規約`(Task 12 で CLI が作る) |
| `.claude/rules/metatron/protected-paths.md` | 旧 `## 保護パス`(同上) |
| `.claude/rules/metatron/testing-policy.md` | 旧 `## テスト方針`(同上) |

### 変更(metatron 内)

| パス | 変更内容 | Task |
| --- | --- | --- |
| `src/lib/config.ts` | `paths.rulesDir` の解決と `ResolvedConfig` の 2 フィールド | 1 |
| `src/lib/staging.ts` | `StagingKind` に `"rules"` | 2 |
| `src/cli/main.ts` | `WRITE_SUBCOMMANDS` と switch に `stage-rules` / `commit-rules` | 3 |
| `src/cli/get.ts` | `GET_TARGETS` に `rules`、`runGetRules`、`runGetConfig` の `cli` と `rules` と docRoot ずれ警告 | 3 |
| `src/cli/stage.ts` | `runStageRules`、`stage-architecture` の `remove` 対応 | 3, 6 |
| `src/cli/commit.ts` | kind 照合の新設と `runCommitRules` | 3 |
| `src/cli/paths.ts` | `INPUT_SCHEMAS["stage-rules"]`、`USAGE_LINES` の 3 行 | 3 |
| `src/guard-docs.ts` | 拒否対象へ rules 3 ファイル、拒否メッセージ | 4 |
| `src/lib/architecture.ts` | `ARCHITECTURE_HEADINGS` を 7 要素へ、`MOVED_HEADINGS` 新設、`SectionChange.remove`、`AppliedChange.mode` に `"removed"`、`applySectionChanges` の削除分岐 | 5, 6 |
| `src/lib/scan.ts` | `ARCHITECTURE_SECTIONS` を 7 要素へ | 5 |
| `src/inject-context.ts` | `cliLines` に rules 系 2 行、`buildGuide` の中間文 | 9 |
| `references/architecture-format.md` | 10 節 → 7 節。削除した 3 節の移行先を注記 | 7 |
| `references/writing-discipline.md` | 表題・適用対象・適用の強さの表 | 7 |
| `references/config-schema.md` | `paths.rulesDir` | 7 |
| `references/cli-usage.md` | サブコマンド表、入力 JSON、`stage-architecture` の削除指定 | 7 |
| `docs/ARCHITECTURE.example.md` | 3 節を削除 | 7 |
| `docs/format-change-checklist.md` | rules の項 | 7 |
| `skills/capturing-architecture/SKILL.md` | セクション → ドラフト単位(6 + 3 = 9) | 8 |
| `skills/updating-architecture/SKILL.md` | rules 未作成の検出 | 8 |
| `README.md` | 管理対象が 3 種になったこと | 14 |
| `.claude-plugin/plugin.json` / `package.json` | `0.2.0-dev` | 11 |
| 対応するテスト 7 本 | 設計書 §15 の表のとおり | 各 Task |

### 変更(metatron の外)

| パス | 変更内容 | Task |
| --- | --- | --- |
| `plugins/codiel/skills/scripting-tests/SKILL.md` | 節名参照の削除 + E2E フレームワークの解決順 | 10 |
| `plugins/codiel/skills/implementing/SKILL.md` | 同上 + ユニットテストの要否の解決順 | 10 |
| `plugins/codiel/skills/orchestrating-runs/SKILL.md` | ベースブランチの節名参照を削除 | 10 |
| `plugins/codiel/skills/reviewing-diffs/SKILL.md` | コマンド定義の節名参照を削除 | 10 |
| `plugins/codiel/skills/running-regression-tests/SKILL.md` | 同上 | 10 |
| `plugins/codiel/skills/writing-dev-plans/SKILL.md` | 同上 | 10 |
| `plugins/codiel/skills/initializing-harness/SKILL.md` | 保護パスの節名参照を削除。ドメインマップの生成は残す | 10 |
| `plugins/codiel/skills/initializing-harness/raguel.config.example.yaml` | コメントの節名参照を削除 | 10 |
| `plugins/codiel/skills/writing-design-docs/SKILL.md` | 技術スタックの節名参照を削除 | 10 |
| `plugins/codiel/skills/preparing-design-agendas/SKILL.md` | 同上 | 10 |
| `plugins/codiel/skills/fixing-review-findings/SKILL.md` | 同上(設計書表外。読み替え #2) | 10 |
| `plugins/codiel/agents/codiel-reviewer-doc.md` | 規約・コマンド定義の節名参照を削除 | 10 |
| `plugins/codiel/agents/codiel-reviewer-data.md` | 保護パスの節名参照を削除 | 10 |
| `plugins/codiel/agents/codiel-tester.md` | テスト方針の節名参照を削除 | 10 |
| `plugins/codiel/CLAUDE.example.md` | 節名の列挙を削除 | 10 |
| `plugins/codiel/.claude-plugin/plugin.json` / `package.json` | `0.6.0-dev` | 10 |
| `harness-docs/ARCHITECTURE.md` | 3 節の削除、`## ディレクトリ構成と責務` への追記 | 12, 13 |
| `CLAUDE.md` | 規約・保護パス・テスト方針の在り処 | 12 |
| `harness-docs/design/2026-08-16-file-contract-freeze.md` | §4-1 / §4-3 / §8 と新設する rules の節 | 14 |
| `README.md`(ルート) | metatron の管理対象 | 14 |

**変更しないもの。** `plugins/codiel/src/hooks/lib.ts` と `plugins/sandalphon/src/check-intent-env.ts` の config 実装は追随不要である(設計書 §14-3)。`paths.rulesDir` は「未知キーは無視する」規則(`references/config-schema.md:40`)により両者で自動的に無視される。3 者比較テスト(metatron `config.test.ts:242-306` の `R4-*`、sandalphon `check-intent-env.test.ts:828+` の 16f、codiel `hooks/__test__/lib.test.ts:638+`)にも `rulesDir` を入れない。`src/lib/config.ts:7-9` の「3 実装追随必須」というコメントは `paths.architecture` / `paths.gotchas` と docRoot 解決に対するものであり、`rulesDir` には及ばない。

---

## 検証用のヘルパー

### 注入の実測

区間 3 の完了条件(設計書 §12-3)で使う。リポジトリを書き換えずに測れる。

```bash
echo '{}' | node plugins/metatron/scripts/inject-context.mjs | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const a=j.hookSpecificOutput?.additionalContext||"";console.log("LEN="+a.length);console.log("DEGRADED="+a.includes("を Read すること"))})'
```

着手前の実測値(2026-08-24)は `LEN=8918` / `DEGRADED=false` である。`injection.maxChars` は既定の 9,000。残り予算は 82 文字しかない。

### ARCHITECTURE の節ごとの文字数

```bash
node -e 'const fs=require("fs");const t=fs.readFileSync("harness-docs/ARCHITECTURE.md","utf8");let total=0;for(const p of t.split(/^(?=## )/m)){const h=(p.match(/^## (.+)$/m)||[])[1]||"(前文)";console.log(h+"\t"+p.length);total+=p.length}console.log("TOTAL\t"+total)'
```

着手前の実測値は 合計 8,204、テスト方針 531 / 保護パス 1,720 / 規約 1,481(計 3,732)である。`## ADR 一覧` はこのリポジトリには存在しない(9 節)。

### 既存テストのヘルパー(実名)

**共有のヘルパーディレクトリは存在しない。**`__test__/helpers/` は無く、各テストファイルが自前のローカル関数を持つ。**名前と署名がファイルごとに違う。**新しいテストを足すときは、そのファイルの既存ヘルパーを使う。以下は実測(2026-08-24)である。

| ファイル | 使えるヘルパー |
| --- | --- |
| `lib/__test__/config.test.ts` | `mkTmp(): string` / `mkSub(root, ...segments)` / `writeConfig(dir, value)` / `gitInit(dir)` / `insideGitRepo(dir)` / `docPath(root, relative?)` |
| `lib/__test__/architecture.test.ts` | `doc(...lines): string` / `headings(text): string[]` / `untouchedBytes(text, heading)` / 定数 `TEN_SECTIONS` `MINIMAL_DOMAINS_ONLY` |
| `lib/__test__/staging.test.ts` | `mkProject(): string` / `writeDoc(root, relative, body)` / `docPath(root)` / `snapshot(files)` / `expectUnchanged(before)` |
| `lib/__test__/scan.test.ts` | 同ファイル内のローカル関数 |
| `__test__/guard-docs.test.ts` | `project(config = '{"version":1}'): string` / `hook(payload)` / `edit(cwd, filePath)` / `write(cwd, filePath)` / `notebookEdit(cwd, notebookPath)` / `notebookEditBoth(cwd, filePath, notebookPath)` |
| `__test__/inject-context.test.ts` | `inject(cwd, extraEnv?): string \| null` / `doc(...lines)` / `md(lines)` / `architecture(adrCount?)` / `hugeArchitecture(sections?, padding?)` / 定数 `GUIDE` `INIT_GUIDE` `ARCH_HEAD` |
| `cli/__test__/cli.test.ts` | `runCli(args: string[], cwd: string): CliRun` / `writeFile(root, relative, body)` / `project(opts)` / `stageDiff(root, input)` / 表 `REJECTIONS` |

守るべき約束が 3 つある。

1. **`it(...)` を使わない。**metatron の 8 本のテストはすべて `test(...)` である(`it(` は 0 件)。`describe(...)` を import しているのは `architecture.test.ts` だけである。
2. **`runCli` の `cwd` は第 2 引数の位置引数である。**`runCli(args, { cwd })` ではなく `runCli(args, dir)` と書く。
3. **guard の素通しは `null` の返却である。**`write(root, p)` は素通しのとき `null` を返す。`expect(write(root, p)).toBe(null)` と書く。`permissionDecision` が `undefined` かどうかを見ない(`D4` / `D5` / `D11` がこの書き方である)。

### hook が無効化されていないことの確認

各区間の終わりに実行する。

```bash
git diff --stat -- plugins/metatron/hooks/hooks.json plugins/metatron/scripts/guard-docs.mjs
git status --porcelain
```

`hooks.json` に差分が出ていたら、それは迂回の証跡である。`git status` に計画外の一時ファイル・一時スクリプトが残っていないことを確認する。

---

## Task 1: config に `paths.rulesDir` を足す

設計書 §16 のステップ 1。他のすべての前提である。

**Files:**
- Modify: `plugins/metatron/src/lib/config.ts`
- Modify: `plugins/metatron/src/lib/__test__/config.test.ts`

**Interfaces:**
- Consumes: 既存の `resolveConfiguredPath(raw, label, docRoot, fallback)`(`config.ts:156-201`)。空文字列・非文字列・絶対パス・docRoot 外脱出を拒否し、拒否理由を `string` として warnings へ積む。
- Produces:
  - `export const DEFAULT_RULES_DIR = ".claude/rules/metatron"`
  - `ResolvedConfig.rulesDirPath: string`(絶対パス)
  - `ResolvedConfig.rulesDirRelative: string`(docRoot からの相対パス)
  - Task 3(`src/lib/rules.ts`)と Task 4(`guard-docs.ts`)と Task 9 が読む。

- [ ] **Step 1: 失敗するテストを書く**

`plugins/metatron/src/lib/__test__/config.test.ts` に既存の `C*` 系列の末尾へ追加する。

```ts
test("C13: rulesDir 未指定 → 既定値 .claude/rules/metatron が docRoot 基準で解決される", () => {
  const dir = mkTmp()
  writeConfig(dir, { version: 1, paths: { architecture: "docs/A.md" } })
  const config = loadConfig(dir)
  expect(config.rulesDirRelative).toBe(".claude/rules/metatron")
  expect(config.rulesDirPath).toBe(path.join(dir, ".claude", "rules", "metatron"))
  expect(config.warnings).toStrictEqual([])
})

test("C14: rulesDir が絶対パス / docRoot の外 / 空文字列 / 非文字列 → 既定値へ落ち、理由が warnings に載る", () => {
  for (const bad of ["/etc/rules", "../outside/rules", "", 42]) {
    const dir = mkTmp()
    writeConfig(dir, { version: 1, paths: { rulesDir: bad } })
    const config = loadConfig(dir)
    expect(config.rulesDirRelative).toBe(".claude/rules/metatron")
    expect(config.warnings.some((w) => w.includes("paths.rulesDir"))).toBe(true)
  }
})

test("C15: rulesDir を明示指定 → その値が docRoot 基準で解決される", () => {
  const dir = mkTmp()
  writeConfig(dir, { version: 1, paths: { rulesDir: ".claude/rules/mine" } })
  const config = loadConfig(dir)
  expect(config.rulesDirRelative).toBe(".claude/rules/mine")
  expect(config.warnings).toStrictEqual([])
})
```

`mkTmp` / `writeConfig` は `config.test.ts` の既存ローカル関数である(§既存テストのヘルパー)。`DEFAULT_RULES_DIR` を import して既定値の文字列を二重に書かない形にしてもよい。既存の `C*` は `DEFAULT_ARCHITECTURE_PATH` / `DEFAULT_GOTCHAS_PATH` を import しているため、それに揃えるほうが一貫する。

- [ ] **Step 2: テストを実行して落ちることを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/config.test.ts -t "C13"`
Expected: FAIL(`config.rulesDirRelative` が `undefined`)

- [ ] **Step 3: 実装する**

`config.ts` の 4 箇所を変える。

1. 既定値の定数(`:18-25` の並びの末尾)へ追加する。

```ts
export const DEFAULT_RULES_DIR = ".claude/rules/metatron"
```

2. `ResolvedConfig`(`:33-51`)へ 2 フィールドを追加する。`gotchasRelative` の直後へ置く。

```ts
  rulesDirPath: string
  rulesDirRelative: string
```

3. `defaultsFor`(`:242-258`)へ既定値を追加する。

```ts
  rulesDirPath: path.join(docRoot, DEFAULT_RULES_DIR),
  rulesDirRelative: DEFAULT_RULES_DIR,
```

4. `loadConfigInner`(`:311-324` 付近)で `architecture` / `gotchas` と同じ形で解決する。

```ts
const rulesDir = resolveConfiguredPath(rawPaths?.rulesDir, "rulesDir", docRoot, DEFAULT_RULES_DIR, warnings)
```

戻り値のオブジェクト(`:337-364` 付近)へ `rulesDirPath` と `rulesDirRelative` を足す。`resolveConfiguredPath` の引数の並びは既存の呼び出しに合わせる。

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/config.test.ts`
Expected: PASS(`C13` / `C14` / `C15` を含む全件)

- [ ] **Step 5: 既存挙動が壊れていないことを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/config.test.ts -t "C2"` と同じ要領で `C5` / `C11` / `R4-e` / `R4-f` を実行する。まとめて `pnpm vitest run plugins/metatron/src/lib/__test__/config.test.ts` でよい。
Expected: すべて PASS。とくに次を確認する。
- `C2`(`paths` に `architecture` だけを指定)で `gotchas` が既定値のまま、かつ `rulesDir` も既定値のまま。
- `C11`(`$schema` を含む設定)で未知キーが無視され、エラーにならない。
- `warnings` の型が `string[]` のままであること(オブジェクト化していない)。

- [ ] **Step 6: 他プラグインの 3 者比較テストが通ることを確認する**

Run: `pnpm vitest run plugins/sandalphon plugins/codiel`
Expected: PASS。`paths.rulesDir` は codiel と sandalphon の実装で未知キーとして無視されるため、3 者比較テスト(`R4-*` / 16f)は影響を受けない。落ちた場合は設計書 §14-3 の前提が崩れているので、実装を止めて質問する。

- [ ] **Step 7: 通しの検証とビルド**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: すべて exit 0。`git status --porcelain plugins/metatron/scripts/` に差分が出る(バンドル出力)。

- [ ] **Step 8: コミット**

```bash
git add plugins/metatron/src/lib/config.ts plugins/metatron/src/lib/__test__/config.test.ts plugins/metatron/scripts/
git commit -m "feat(metatron): config に paths.rulesDir を追加する"
```

---

## Task 2: `StagingKind` に `"rules"` を足す

設計書 §16 のステップ 2。staging の構造は変えない。

**Files:**
- Modify: `plugins/metatron/src/lib/staging.ts`
- Modify: `plugins/metatron/src/lib/__test__/staging.test.ts`

**Interfaces:**
- Consumes: Task 1 の `ResolvedConfig`(このタスクでは直接使わないが、Task 3 で `rulesDirPath` が `targetPath` になる)。
- Produces: `StagingKind = "architecture" | "adr" | "rules"`。`isStagingKind`(`staging.ts:215-217`)が `"rules"` を通す。Task 3 の `createStaging({ kind: "rules", ... })` が使う。

**変えないもの。** `StagingRecord` の `targetPath` は単一のままとする。複数ターゲットへ拡張しない。「書き込み系が非 0 で終わったとき、対象ファイルは 1 バイトも変わっていない」(`references/cli-usage.md:33`)を守るためである(設計書 §7-1)。

- [ ] **Step 1: 失敗するテストを書く**

`plugins/metatron/src/lib/__test__/staging.test.ts` の `T*` 系列の末尾へ追加する。

```ts
test('T9: kind: "rules" の staging が作成・読み取り・commit でき、単一ターゲットの保証が保たれる', () => {
  const root = mkProject()
  const target = path.join(root, ".claude", "rules", "metatron", "conventions.md")

  const staged = createStaging({
    projectRoot: root,
    kind: "rules",
    targetPath: target,
    nextContent: "# 規約\n\n本文\n"
  })
  expect(staged.ok).toBe(true)
  if (!staged.ok) return

  const found = readStaging(root, staged.stagingId)
  expect(found.ok).toBe(true)
  if (!found.ok) return
  expect(found.record.kind).toBe("rules")

  const committed = commitStaging({ projectRoot: root, stagingId: staged.stagingId })
  expect(committed.ok).toBe(true)
  if (!committed.ok) return
  expect(committed.kind).toBe("rules")
  expect(committed.path).toBe(target)
  expect(fs.readFileSync(target, "utf8")).toBe("# 規約\n\n本文\n")
})
```

`mkProject` は `staging.test.ts` の既存ローカル関数である(§既存テストのヘルパー)。`if (!staged.ok) return` の絞り込みは既存の `T1` と同じ書き方である。未作成の親ディレクトリごと作られることは既存の `T4c` が保証している。

- [ ] **Step 2: テストを実行して落ちることを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/staging.test.ts -t "T9"`
Expected: FAIL(型エラー、または `readStaging` が `unknown_id` を返す。`isStagingKind` が `"rules"` を弾くため)

- [ ] **Step 3: 実装する**

`staging.ts:29` を変える。

```ts
export type StagingKind = "architecture" | "adr" | "rules"
```

同ファイルのコメント(「いずれも ARCHITECTURE ファイルを書き換える経路」)を、rules は別のファイルを書き換える経路であることが分かる記述へ直す。`isStagingKind`(`:215-217`)の値域も合わせる。

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/staging.test.ts -t "T9"`
Expected: PASS

- [ ] **Step 5: 既存の T1〜T8d がすべて通ることを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/staging.test.ts`
Expected: PASS。**これは設計書 §15 が明示的に要求している確認である。**「`staging.test.ts` の T1〜T8d は、単一ターゲットの構造を変えないため落ちない。落ちないことを確認する」。1 件でも落ちたら構造を変えてしまっている。実装を戻して設計書 §7 を読み直す。

- [ ] **Step 6: 通しの検証とビルド**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: すべて exit 0

- [ ] **Step 7: コミット**

```bash
git add plugins/metatron/src/lib/staging.ts plugins/metatron/src/lib/__test__/staging.test.ts plugins/metatron/scripts/
git commit -m "feat(metatron): StagingKind に rules を追加する"
```

---

## Task 3: `src/lib/rules.ts` と `get rules` / `stage-rules` / `commit-rules`

設計書 §16 のステップ 3。このタスクは分量が大きいが、`stage-rules` だけを先に入れても `commit-rules` が無ければ書き込めず、`get rules` が無ければ確認できないため、3 つで 1 つの成果物になる。

**Files:**
- Create: `plugins/metatron/src/lib/rules.ts`
- Create: `plugins/metatron/src/lib/__test__/rules.test.ts`
- Modify: `plugins/metatron/src/cli/main.ts`
- Modify: `plugins/metatron/src/cli/get.ts`
- Modify: `plugins/metatron/src/cli/stage.ts`
- Modify: `plugins/metatron/src/cli/commit.ts`
- Modify: `plugins/metatron/src/cli/paths.ts`
- Modify: `plugins/metatron/src/cli/__test__/cli.test.ts`

**Interfaces:**
- Consumes: Task 1 の `ResolvedConfig.rulesDirPath`、Task 2 の `StagingKind` の `"rules"`。既存の `createStaging` / `readStaging` / `commitStaging`(`staging.ts`)、`withFileLock`(`gotchas.ts:809`)、`loadInputJson` / `isPlainObject`(`input.ts`)、`unifiedDiff`(`diff.ts`)、`emitResult` / `emitWriteFailure` / `emitReadFailure` / `noteWarnings`(`output.ts`)、`commandLine`(`paths.ts:26-28`)、`stringFlag`(`args.ts:55-63`)。
- Produces:

```ts
// src/lib/rules.ts
export const RULES_FILES = ["conventions", "protected-paths", "testing-policy"] as const
export type RulesName = (typeof RULES_FILES)[number]

/** 各ファイルの冒頭に置く管理者表示。設計書 §4-4。CLI の絶対パスは書かない。 */
export const RULES_ADMIN_NOTICE =
  "> この文書は metatron の管理下にある。直接編集は PreToolUse hook が拒否する。更新は metatron の CLI(`stage-rules` → `commit-rules`)で行う。CLI の絶対パスは、セッション冒頭の注入文または hook の拒否メッセージに載っている。"

/** 分量の目安。公式が rules に定めた上限は無い。CLAUDE.md の推奨を借りた metatron 側の判断。設計書 §13-1。 */
export const RULES_LINE_GUIDELINE = 200

export function isRulesName(value: unknown): value is RulesName
export function rulesFilePath(config: ResolvedConfig, name: RulesName): string
export function rulesFilePaths(config: ResolvedConfig): Record<RulesName, string>

export type RulesFileState = {
  name: RulesName
  path: string
  relative: string
  exists: boolean
  text: string | null
}
export function readRulesFile(config: ResolvedConfig, name: RulesName): RulesFileState

export type RulesUpdateError =
  | "unknown_rules_name"
  | "invalid_input"
  | "frontmatter_not_allowed"
  | "missing_admin_notice"

export type RulesUpdate =
  | { ok: true; name: RulesName; text: string; mode: "created" | "replaced"; warnings: string[] }
  | { ok: false; error: RulesUpdateError; message: string }

/** current は現在のファイル内容(未作成なら null)。input は stage-rules の JSON。 */
export function prepareRulesUpdate(
  current: string | null | undefined,
  input: { name?: unknown; body?: unknown }
): RulesUpdate
```

`rulesFilePath` は `path.join(config.rulesDirPath, `${name}.md`)` を返す。Task 4 の guard もこの関数を使う。

**書式検証の規則**(`prepareRulesUpdate`):

| 条件 | 結果 |
| --- | --- |
| `name` が `RULES_FILES` に無い | `unknown_rules_name`。メッセージに 3 つの名前を列挙する |
| `body` が文字列でない、空、空白のみ | `invalid_input` |
| `body` の 1 行目が `---` | `frontmatter_not_allowed`。メッセージで「rules に frontmatter は書かない(設計書 §4-3)」を示す |
| `body` の 1 行目が `# ` で始まらない | `invalid_input`。「`body` は `# 見出し` を含む完全なファイル内容とする」 |
| `body` の先頭 5 行に `RULES_ADMIN_NOTICE` が含まれない | `missing_admin_notice` |
| 行数が `RULES_LINE_GUIDELINE` を超える | 拒否しない。`warnings` に 1 件積む |

正常時は `text` を返す。末尾の改行は 1 つに正規化する。既存ファイルと同じ内容なら `mode: "replaced"` のまま返す(no-op の stage は既存の staging 側で扱われる)。

**CLI の追加。**

`main.ts:32-38` の `WRITE_SUBCOMMANDS` へ `stage-rules` と `commit-rules` を足し、`:84-112` の switch へ 2 分岐を足す。`get` は既に `READ_SUBCOMMANDS` にあるので変更しない。

`get.ts:353` の `GET_TARGETS` へ `rules` を足し、`runGet` の switch(`:358-373`)へ分岐を足す。

```ts
// get rules [--name conventions|protected-paths|testing-policy]
// 読み取り経路なので常に exit 0。未作成は error: "not_created" を各ファイルの要素に載せる。
export function runGetRules(ctx: GetContext): void
```

`--name` 無しなら 3 ファイル分の `RulesFileState` を配列で返す。`--name` があり値域外なら `unknown_rules_name` を `emitReadFailure` で返す(exit は 0 のまま)。

`get config`(`runGetConfig`、`get.ts:45-85`)へ次を足す。

- `cli` オブジェクト(`:72-81`)に `stageRules` と `commitRules`。
- 出力に `rules: { dir, relative, files: [{ name, path, relative, exists }] }`。
- **docRoot と起動ディレクトリのずれの警告**(設計書 §4-5)。`config.docRoot` と `ctx.cwd` の実体パスが異なるとき、`warnings` へ次を積む。

```ts
`docRoot(${config.docRoot})と起動ディレクトリ(${cwd})が異なります。.claude/rules/ は起動ディレクトリを基準に読まれるため、metatron が書いた rules が読み込まれない可能性があります。`
```

この警告は `get config` の実行時にだけ積む。`loadConfig` に入れると、サブディレクトリから CLI を叩いた既存テスト(`C7`)の `warnings` 期待値が壊れる。

`stage.ts` へ `runStageRules` を足す。`runStageArchitecture`(`:81-173`)と同じ骨格にする。

1. `loadInputJson(ctx.flags)`
2. `isPlainObject` でトップレベル検証
3. `loadConfig` → `rulesFilePath(config, name)` → `readDocument`
4. `prepareRulesUpdate(file.text, { name, body })`
5. `createStaging({ kind: "rules", targetPath, nextContent, ... })`
6. `unifiedDiff` で diff
7. 成功 JSON に `stagingId` と `next: "commit-rules --staging-id <id>"`

`commit.ts` に kind 照合を新設する(読み替え #1)。`runCommitArchitecture` の本体を共通関数へ切り出し、受け入れる kind を引数にする。

```ts
type CommitSpec = {
  command: "commit-architecture" | "commit-rules"
  acceptedKinds: readonly StagingKind[]
  stageHint: string // missing_staging_id のメッセージに載せる
}

function runCommit(ctx: CommitContext, spec: CommitSpec): void

export function runCommitArchitecture(ctx: CommitContext): void {
  runCommit(ctx, {
    command: "commit-architecture",
    acceptedKinds: ["architecture", "adr"],
    stageHint: "stage-architecture または stage-adr が返した stagingId を渡してください。"
  })
}

export function runCommitRules(ctx: CommitContext): void {
  runCommit(ctx, {
    command: "commit-rules",
    acceptedKinds: ["rules"],
    stageHint: "stage-rules が返した stagingId を渡してください。"
  })
}
```

照合は `readStaging` の成功直後、`withFileLock` に入る前に行う。`found.record.kind` が `acceptedKinds` に含まれないとき `emitWriteFailure(command, "staging_kind_mismatch", ...)` で非 0 終了し、**staging は消費しない**(対象ファイルも変わらない)。

`paths.ts` へ次を足す。

```ts
  "stage-rules": {
    input: "{ name, body, reason? }",
    names: [...RULES_FILES],
    note: "body は `# 見出し` を含む完全なファイル内容。frontmatter は書けない。書き込みは commit-rules --staging-id <id>。"
  }
```

`USAGE_LINES`(`:58-78`)の 3 区分へそれぞれ 1 行ずつ足す。

```
読み取り: "  get rules [--name conventions|protected-paths|testing-policy]"
段階:     "  stage-rules --input <path>"
書き込み: "  commit-rules --staging-id <id>"
```

- [ ] **Step 1: `rules.ts` の失敗するテストを書く**

`plugins/metatron/src/lib/__test__/rules.test.ts` を作る。

```ts
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "vitest"
import { loadConfig } from "../config.js"
import {
  RULES_ADMIN_NOTICE,
  RULES_FILES,
  isRulesName,
  prepareRulesUpdate,
  readRulesFile,
  rulesFilePath
} from "../rules.js"

// config.test.ts と同じ形の一時プロジェクト。config を必ず置くのは findDocRoot の段 1 で
// docRoot をこのディレクトリに固定し、祖先や git の状態にテストが依存しないようにするため。
const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 後始末の失敗はテスト結果に影響させない
    }
  }
})

function mkProject(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "metatron-rules-")))
  fs.writeFileSync(path.join(dir, "metatron.config.json"), '{"version":1}')
  tmpDirs.push(dir)
  return dir
}

const OK_BODY = `# 規約\n\n${RULES_ADMIN_NOTICE}\n\n- ブランチを切らない。\n`

test("RL1: RULES_FILES は 3 つの固定名を持つ", () => {
  expect([...RULES_FILES]).toStrictEqual(["conventions", "protected-paths", "testing-policy"])
})

test("RL2: rulesFilePath は rulesDirPath 配下の <name>.md を返す", () => {
  const config = loadConfig(mkProject())
  expect(rulesFilePath(config, "conventions")).toBe(
    path.join(config.rulesDirPath, "conventions.md")
  )
})

test("RL3: 未作成のファイルは exists: false・text: null で返る(例外を投げない)", () => {
  const state = readRulesFile(loadConfig(mkProject()), "testing-policy")
  expect(state.exists).toBe(false)
  expect(state.text).toBeNull()
})

test("RL4: 正当な body は ok: true。未作成なら mode: created", () => {
  const result = prepareRulesUpdate(null, { name: "conventions", body: OK_BODY })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.mode).toBe("created")
  expect(result.text.endsWith("\n")).toBe(true)
})

test("RL5: 未知の name は unknown_rules_name で拒否し、3 つの名前を案内する", () => {
  const result = prepareRulesUpdate(null, { name: "workflow", body: OK_BODY })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("unknown_rules_name")
  for (const n of RULES_FILES) expect(result.message).toContain(n)
})

test("RL6: frontmatter で始まる body は frontmatter_not_allowed で拒否する", () => {
  const body = `---\npaths:\n  - "src/**"\n---\n\n# 規約\n`
  const result = prepareRulesUpdate(null, { name: "conventions", body })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("frontmatter_not_allowed")
})

test("RL7: 1 行目が # 見出しでない body は invalid_input で拒否する", () => {
  const result = prepareRulesUpdate(null, { name: "conventions", body: "本文だけ\n" })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("invalid_input")
})

test("RL8: 管理者表示行が無い body は missing_admin_notice で拒否する", () => {
  const result = prepareRulesUpdate(null, { name: "conventions", body: "# 規約\n\n本文\n" })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("missing_admin_notice")
})

test("RL9: 200 行を超える body は拒否せず warnings を返す", () => {
  const body = `# 規約\n\n${RULES_ADMIN_NOTICE}\n${"- 項目\n".repeat(250)}`
  const result = prepareRulesUpdate(null, { name: "conventions", body })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.warnings.length).toBeGreaterThan(0)
})

test("RL10: isRulesName は値域外を弾く", () => {
  expect(isRulesName("conventions")).toBe(true)
  expect(isRulesName("Conventions")).toBe(false)
  expect(isRulesName(null)).toBe(false)
})
```

このファイルは新規である。既存の metatron のテストはすべて `test(...)` を使い `it(...)` を使わないため、それに揃える(§既存テストのヘルパー)。

- [ ] **Step 2: テストを実行して落ちることを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/rules.test.ts`
Expected: FAIL(`../rules.js` が解決できない)

- [ ] **Step 3: `src/lib/rules.ts` を実装する**

上の Interfaces のとおりに書く。`readRulesFile` は `fs.readFileSync` を try/catch で包み、`ENOENT` を `exists: false` として扱う。それ以外の例外(権限など)も `exists: false` / `text: null` へ落とし、読み取り経路が例外で止まらないようにする(既存の読み取り系と同じ方針)。

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/rules.test.ts`
Expected: PASS(`RL1`〜`RL10`)

- [ ] **Step 5: CLI の失敗するテストを書く**

`plugins/metatron/src/cli/__test__/cli.test.ts` へ追加する。既存の `runCli` ヘルパー(`:57-78`)を使う。

```ts
const OK_BODY = `# 規約\n\n${RULES_ADMIN_NOTICE}\n\n- ブランチを切らない。\n`

test("S7: get rules は未作成でも exit 0。--name で 1 件に絞れる。値域外は unknown_rules_name", () => {
  const root = project({})
  const all = runCli(["get", "rules"], root)
  expect(all.status).toBe(0)
  expect((all.json?.rules as unknown[]).length).toBe(3)

  const one = runCli(["get", "rules", "--name", "conventions"], root)
  expect(one.status).toBe(0)
  expect((one.json?.rules as unknown[]).length).toBe(1)

  const bad = runCli(["get", "rules", "--name", "nope"], root)
  expect(bad.status).toBe(0)
  expect(bad.json?.error).toBe("unknown_rules_name")
})

test("S8: stage-rules → commit-rules で rules ファイルが作られ、再 commit は already_used", () => {
  const root = project({})
  const input = writeFile(root, "in.json", JSON.stringify({ name: "conventions", body: OK_BODY }))
  const target = path.join(root, ".claude", "rules", "metatron", "conventions.md")

  const staged = runCli(["stage-rules", "--input", input], root)
  expect(staged.status).toBe(0)
  const id = staged.json?.stagingId as string
  expect(typeof id).toBe("string")
  // stage は書き込まない
  expect(fs.existsSync(target)).toBe(false)

  const committed = runCli(["commit-rules", "--staging-id", id], root)
  expect(committed.status).toBe(0)
  expect(fs.readFileSync(target, "utf8")).toBe(OK_BODY)

  const again = runCli(["commit-rules", "--staging-id", id], root)
  expect(again.status).not.toBe(0)
  expect(again.json?.error).toBe("already_used")
})

test("S9: kind 不一致の commit は staging_kind_mismatch で拒否され、対象ファイルは不変", () => {
  const root = project({})
  const archPath = path.join(root, "docs", "ARCHITECTURE.md")
  const before = fs.readFileSync(archPath, "utf8")
  const rulesTarget = path.join(root, ".claude", "rules", "metatron", "conventions.md")

  // rules の stagingId を commit-architecture へ渡す
  const rulesInput = writeFile(root, "r.json", JSON.stringify({ name: "conventions", body: OK_BODY }))
  const rulesStaged = runCli(["stage-rules", "--input", rulesInput], root)
  const wrong1 = runCli(["commit-architecture", "--staging-id", rulesStaged.json?.stagingId as string], root)
  expect(wrong1.status).not.toBe(0)
  expect(wrong1.json?.error).toBe("staging_kind_mismatch")
  expect(fs.existsSync(rulesTarget)).toBe(false)

  // architecture の stagingId を commit-rules へ渡す
  const archInput = writeFile(
    root,
    "a.json",
    JSON.stringify({ sections: [{ heading: "システム概要", body: "新しい概要。" }] })
  )
  const archStaged = runCli(["stage-architecture", "--input", archInput], root)
  const wrong2 = runCli(["commit-rules", "--staging-id", archStaged.json?.stagingId as string], root)
  expect(wrong2.status).not.toBe(0)
  expect(wrong2.json?.error).toBe("staging_kind_mismatch")
  expect(fs.readFileSync(archPath, "utf8")).toBe(before)

  // 拒否された staging は消費されていない。正しいコマンドなら通る。
  const ok = runCli(["commit-architecture", "--staging-id", archStaged.json?.stagingId as string], root)
  expect(ok.status).toBe(0)
})

test("S10: docRoot と起動ディレクトリがずれていると get config が warnings で知らせる", () => {
  const root = project({})
  const sub = path.join(root, "packages", "web")
  fs.mkdirSync(sub, { recursive: true })

  // docRoot 直下から実行 → 警告なし
  const same = runCli(["get", "config"], root)
  expect(same.status).toBe(0)
  expect((same.json?.warnings as string[]).some((w) => w.includes("起動ディレクトリ"))).toBe(false)

  // サブディレクトリから実行 → .claude/rules/ が読まれない可能性を警告する
  const differs = runCli(["get", "config"], sub)
  expect(differs.status).toBe(0)
  const warnings = differs.json?.warnings as string[]
  expect(warnings.some((w) => w.includes("起動ディレクトリ"))).toBe(true)
  expect(warnings.some((w) => w.includes(".claude/rules/"))).toBe(true)
})
```

`project(opts)` / `runCli(args, cwd)` / `writeFile(root, relative, body)` は `cli.test.ts` の既存ローカル関数である(§既存テストのヘルパー)。**`runCli` の `cwd` は第 2 引数の位置引数である。**`project` に渡すオプションの形は既存の呼び出しに合わせる。`RULES_ADMIN_NOTICE` は `../../lib/rules.js` から import する。

- [ ] **Step 6: テストを実行して落ちることを確認する**

Run: `pnpm vitest run plugins/metatron/src/cli/__test__/cli.test.ts -t "S7"`
Expected: FAIL(`get rules` が未知のターゲット)

- [ ] **Step 7: CLI を実装する**

上の Interfaces に列挙した 6 ファイルを変える。順序は `paths.ts` → `get.ts` → `stage.ts` → `commit.ts` → `main.ts` とする。`main.ts` を最後にすると、途中の状態で未定義の関数を参照しない。

- [ ] **Step 7b: `commit.ts` を変えた直後に、既存の ADR 経路の回帰を確認する**

このタスクは新規追加と既存改修が同居しており、失敗したときの切り戻し単位が大きい。**`commit.ts` の kind 照合は既存の `commit-architecture` を書き換える唯一の箇所である。**`acceptedKinds` から `"adr"` を落とすと、`stage-adr → commit-architecture` の経路が同じコミットで一緒に壊れる。

`commit.ts` の編集を終えた時点で、`main.ts` へ進む前に次を実行する。

Run: `pnpm vitest run plugins/metatron/src/cli/__test__/cli.test.ts -t "stage-adr"`
Expected: PASS。`stage-adr → commit-architecture で ADR が採番されて末尾に追加される`(`cli.test.ts:502` 付近)が通る。

ここで落ちたら `acceptedKinds` の指定を疑う。`runCommitArchitecture` は `["architecture", "adr"]` の 2 つを受ける。`stage-adr` は `kind: "adr"` で staging を作る(`src/cli/stage.ts:237` 付近)。

- [ ] **Step 8: テストを実行して通ることを確認する**

Run: `pnpm vitest run plugins/metatron/src/cli/__test__/cli.test.ts`
Expected: PASS(`S7`〜`S10` と既存の `S5` / `S6` を含む全件)

- [ ] **Step 9: 既存挙動が壊れていないことを確認する**

Run: `pnpm vitest run plugins/metatron`
Expected: PASS。とくに次を確認する。
- `S5`(読み取り系は常に exit 0)。`get rules` を足しても読み取り経路の exit 規約が変わっていない。
- `S6`(書き込み系の拒否は非 0・妥当な JSON・ファイル不変)。
- 既存の `stage-architecture → commit-architecture`(`cli.test.ts:443-500`)と `stage-adr → commit-architecture`(`:502-`)が、kind 照合の新設後も通る。**`adr` の stagingId を `commit-architecture` が受けることは維持する。**

- [ ] **Step 10: 手で 1 往復して確かめる**

一時ディレクトリで実行する。リポジトリの `.claude/rules/` へは書かない(設計書 §16-1)。

```bash
rm -rf /tmp/rules-cli && mkdir -p /tmp/rules-cli && cd /tmp/rules-cli && git init -q && node /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/metatron/scripts/metatron.mjs get config | head -40
```

Expected: 出力に `rulesDir` の解決結果(`rules.dir` / `rules.relative` / `rules.files`)が含まれる。これは区間 2 の完了条件 3 に対応する。

- [ ] **Step 11: 通しの検証とビルド**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: すべて exit 0

- [ ] **Step 12: コミット**

```bash
git add plugins/metatron/src/lib/rules.ts plugins/metatron/src/lib/__test__/rules.test.ts plugins/metatron/src/cli/ plugins/metatron/scripts/
git commit -m "feat(metatron): get rules / stage-rules / commit-rules を追加し commit に kind 照合を入れる"
```

---

## Task 4: guard hook を rules 3 ファイルへ拡張する

設計書 §16 のステップ 4。

**Files:**
- Modify: `plugins/metatron/src/guard-docs.ts`
- Modify: `plugins/metatron/src/__test__/guard-docs.test.ts`

**Interfaces:**
- Consumes: Task 1 の `ResolvedConfig.rulesDirPath`、Task 3 の `rulesFilePath` / `RULES_FILES`。既存の `comparisonKey`(`guard-docs.ts:155-159`)と `realpathOrParent`(`:44-54`)と `followDanglingLink`(`:76-102`)。
- Produces: 拒否対象が 5 件(ARCHITECTURE / GOTCHAS / rules 3 ファイル)になる。matcher は `Edit|Write|NotebookEdit` のまま変えない。

**判定の方針。** 既存の一致判定(`:203-216`)は正規化キーの**厳密等価**である。前方一致も部分一致もしない(`:147-148` のコメントと `D11` が保証)。rules も同じ方式で足す。`rulesFilePath(config, name)` で得た 3 つの絶対パスを `comparisonKey` に通し、保護キーの集合へ加える。

これにより設計書 §4-1 が懸念する「`.claude/rules/metatron-extra/foo.md` が前方一致で誤って拒否される」問題は構造的に起きない。設計書 §10 の「拒否対象は固定 3 ファイルのパスに限る」とも一致する。

**拒否の優先順位。** ARCHITECTURE → GOTCHAS → rules とする。既存の「両方ヒット時は ARCHITECTURE 案内を優先」(`:218-221`)を壊さない。

- [ ] **Step 1: 失敗するテストを書く**

`plugins/metatron/src/__test__/guard-docs.test.ts` の `D*` 系列の末尾へ追加する。

```ts
test("D15: rules 3 ファイルへの Write は deny。理由に stage-rules と commit-rules を含む", () => {
  const root = project()
  for (const name of ["conventions", "protected-paths", "testing-policy"]) {
    const target = path.join(root, ".claude/rules/metatron", `${name}.md`)
    const r = write(root, target)
    expect(r?.permissionDecision).toBe("deny")
    expect(r?.permissionDecisionReason).toContain("stage-rules --input")
    expect(r?.permissionDecisionReason).toContain("commit-rules --staging-id")
  }
})

test("D16: .claude/rules/ 直下のユーザーの手書きファイルは素通しする", () => {
  const root = project()
  expect(write(root, path.join(root, ".claude/rules/my-own.md"))).toBe(null)
  expect(edit(root, path.join(root, ".claude/rules/frontend/style.md"))).toBe(null)
})

test("D17: .claude/rules/metatron-extra/foo.md は前方一致で誤検出せず素通しする", () => {
  const root = project()
  expect(write(root, path.join(root, ".claude/rules/metatron-extra/foo.md"))).toBe(null)
})

test("D18: rulesDir 配下でも 3 ファイル以外の .md と .md 以外は素通しする", () => {
  const root = project()
  for (const rel of ["notes.md", "conventions.txt", "conventions.md.bak"]) {
    expect(write(root, path.join(root, ".claude/rules/metatron", rel))).toBe(null)
  }
})

test("D19: 設定で rulesDir を変更すると、変更後のパスが deny され既定パスは素通しする", () => {
  const root = project('{"version":1,"paths":{"rulesDir":".claude/rules/mine"}}')
  expect(
    write(root, path.join(root, ".claude/rules/mine/conventions.md"))?.permissionDecision
  ).toBe("deny")
  expect(write(root, path.join(root, ".claude/rules/metatron/conventions.md"))).toBe(null)
})
```

`project(config?)` / `write(cwd, filePath)` / `edit(cwd, filePath)` は `guard-docs.test.ts` の既存ローカル関数である(§既存テストのヘルパー)。**素通しは `null` の返却で判定する。**`permissionDecision` が `undefined` かどうかを見ない。既存の `D4`・`D5`・`D11` がこの書き方である。`D19` は既存の `D5` と同じ形で `rulesDir` の設定変更を確かめる。

- [ ] **Step 2: テストを実行して落ちることを確認する**

Run: `pnpm vitest run plugins/metatron/src/__test__/guard-docs.test.ts -t "D15"`
Expected: FAIL(`permissionDecision` が出ない)

- [ ] **Step 3: 実装する**

`guard-docs.ts` の 2 箇所を変える。

1. 拒否理由の関数を足す。`architectureReason`(`:161-171`)と `gotchasReason`(`:173-182`)の並びへ置く。

```ts
function rulesReason(cli: string, name: string): string
```

本文に次を含める。`stage-rules --input <一時ファイル>` と `commit-rules --staging-id <id>`、および `get config`(入力の書式の取得先)。既存 2 関数と同じ文体にする。

2. 保護キーの集合と一致ループ(`:203-216`)を拡張する。

```ts
const protectedTargets = [
  { key: comparisonKey(config.architecturePath), reason: () => architectureReason(cli) },
  { key: comparisonKey(config.gotchasPath), reason: () => gotchasReason(cli) },
  ...RULES_FILES.map((name) => ({
    key: comparisonKey(rulesFilePath(config, name)),
    reason: () => rulesReason(cli, name)
  }))
]
```

候補パス(`file_path` と `notebook_path` の両方)のキーが `protectedTargets` のどれかと厳密等価なら deny する。最初に一致したものの理由を使う(並び順が優先順位になる)。

外枠の try/catch によるフェイルオープン(`:226-228`)は変えない。

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `pnpm vitest run plugins/metatron/src/__test__/guard-docs.test.ts`
Expected: PASS(`D15`〜`D19` と既存の `D1`〜`D14`)

- [ ] **Step 5: 既存挙動が壊れていないことを確認する**

Run: `pnpm vitest run plugins/metatron/src/__test__/guard-docs.test.ts`
Expected: 次がすべて PASS であること。
- `D1` / `D2`(ARCHITECTURE と GOTCHAS の拒否理由。`D2` は `stage-architecture` を**含まない**ことをアサートしている)。
- `D3`〜`D3d`(NotebookEdit の `notebook_path` / `file_path` の両方向)。rules も同じ経路を通る。
- `D5`(設定でパスを変更した正本が拒否される)。
- `D7`〜`D7f`(symlink 解決と 40 段上限)。
- `D11`(`.bak` / `.orig` を素通しする)。**rules を足したことで前方一致が混入していないことの証拠である。**
- `D13`(内部エラーは素通し。フェイルオープン)。

- [ ] **Step 6: hook が実際に発火することを確認する**

`pnpm run build` の後、一時ディレクトリで実測する。

```bash
rm -rf /tmp/guard-probe && mkdir -p /tmp/guard-probe && cd /tmp/guard-probe && git init -q && echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/guard-probe/.claude/rules/metatron/conventions.md"},"cwd":"/tmp/guard-probe"}' | node /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/metatron/scripts/guard-docs.mjs
```

Expected: `permissionDecision` が `deny`、理由に `stage-rules` を含む。exit code は 0(フェイルオープンの規約により拒否時も 0)。

- [ ] **Step 7: 通しの検証とビルド**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: すべて exit 0

`hooks/hooks.json` に差分が出ていないことを `git diff --stat -- plugins/metatron/hooks/hooks.json` で確認する。差分が出ていたら迂回である。

- [ ] **Step 8: コミット**

```bash
git add plugins/metatron/src/guard-docs.ts plugins/metatron/src/__test__/guard-docs.test.ts plugins/metatron/scripts/
git commit -m "feat(metatron): guard hook の拒否対象へ rules 3 ファイルを追加する"
```

---

## Task 5: 見出し許可リストを 7 節へ縮め、`MOVED_HEADINGS` を新設する

設計書 §16 のステップ 5。**§9-2 により `ARCHITECTURE_HEADINGS` と `ARCHITECTURE_SECTIONS` を同じコミットで直す。**片方だけ直すと「`stage-architecture` は通るが `diff-architecture` が見落とす」非対称と、移行済みプロジェクトでの `section_missing` の偽陽性が同時に起きる。

**Files:**
- Modify: `plugins/metatron/src/lib/architecture.ts`
- Modify: `plugins/metatron/src/lib/scan.ts`
- Modify: `plugins/metatron/src/lib/__test__/architecture.test.ts`
- Modify: `plugins/metatron/src/lib/__test__/scan.test.ts`
- Modify: `plugins/metatron/src/cli/__test__/cli.test.ts`

**Interfaces:**
- Produces:
  - `ARCHITECTURE_HEADINGS`(`architecture.ts:24-35`)が 7 要素になる。`システム概要` / `技術スタック` / `レイヤー構造` / `ディレクトリ構成と責務` / `ドメインマップ` / `コマンド定義` / `ADR 一覧`。順序は既存の並びから 3 節を抜いたものとする。
  - `ARCHITECTURE_SECTIONS`(`scan.ts:25-36`)が同じ 7 要素になる。
  - 新設。

```ts
/** 旧セクション名 → 移行先の rules ファイル名。検証には使わない。エラーメッセージにだけ使う。設計書 §9-1。 */
export const MOVED_HEADINGS = {
  "テスト方針": "testing-policy",
  "保護パス": "protected-paths",
  "規約": "conventions"
} as const
```

  - `validateHeadingKey`(`:360-394`)が `MOVED_HEADINGS` の見出しを受けたとき、`unknown_heading` のまま、メッセージに移行先のファイル名と `stage-rules` を含める。**エラーコードは `unknown_heading` のまま変えない。**

**変えないもの。** `parseArchitecture`(`:200`)。セクション分割はフェンス状態機械であり許可リストと独立している(契約凍結 §4-2、設計書 §9-3)。したがって 10 節のまま残っている既存 ARCHITECTURE も引き続き読める。この性質が Task 6 と Task 12 の削除を成立させる。

**このタスクから Task 12 の移行が終わるまで、規約・保護パス・テスト方針を更新する経路が閉じる。**`stage-architecture` はこの 3 節への `body` を `unknown_heading` で拒否し、移行先の rules ファイルはまだ存在しない。区間 2 は `.claude/rules/` を変更しないと定めているため、`stage-rules` で先に作ることもしない。

この窓で規約の更新が必要になったときは、**hook を迂回せず、`.claude/rules/` を先取りで作らず、作業を止めてユーザーへ報告する。**設計書 §16-1 が「CLI がまだ無い段階で rules を作りたい」誘惑に対して「実装順序を入れ替えない」と定めているのと同じ理由である。この窓は Task 12 の 4 段階が終われば閉じる。

- [ ] **Step 1: 失敗するテストを書く**

`architecture.test.ts` へ追加する。

```ts
test("A25: ARCHITECTURE_HEADINGS は 7 要素で、移行した 3 節を含まない", () => {
  expect(ARCHITECTURE_HEADINGS).toHaveLength(7)
  for (const moved of ["テスト方針", "保護パス", "規約"]) {
    expect([...ARCHITECTURE_HEADINGS]).not.toContain(moved)
  }
})

test("A24: 移行した 3 節へ body を書こうとすると unknown_heading。メッセージが移行先を示す", () => {
  for (const [heading, file] of Object.entries(MOVED_HEADINGS)) {
    const result = prepareArchitectureUpdate(SEVEN_SECTIONS, [{ heading, body: "本文" }])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("unknown_heading")
      expect(result.message).toContain(file)
      expect(result.message).toContain("stage-rules")
    }
  }
})
```

`cli.test.ts` へ 1 件足す。**設計書 §15 が新規テストとして明示的に要求している「移行後の `diff-architecture` が 3 節を `section_missing` として報告しないこと」である。**

```ts
test("S11: 移行後の ARCHITECTURE(3 節なし)で diff-architecture が section_missing を出さない", () => {
  // 移行後の姿。テスト方針 / 保護パス / 規約 を持たない ARCHITECTURE。
  const root = project({})
  writeFile(
    root,
    "docs/ARCHITECTURE.md",
    "# ARCHITECTURE\n\n## システム概要\n\n概要。\n\n## コマンド定義\n\n| 種別 | コマンド |\n| --- | --- |\n| test | `pnpm test` |\n"
  )
  const r = runCli(["diff-architecture"], root)
  expect(r.status).toBe(0)
  const missing = (r.json?.findings as { kind: string; section?: string }[])
    .filter((f) => f.kind === "section_missing")
    .map((f) => f.section)
  for (const moved of ["テスト方針", "保護パス", "規約"]) {
    expect(missing).not.toContain(moved)
  }
})
```

`findings` のキー名と要素の形は既存の `diff-architecture` の出力に合わせる(`src/lib/scan.ts:437-438` の `kind` 定義と `:1623-1633` の push を見る)。**この 1 件が §9-4 の偽陽性を塞いだ証拠になる。**Task 5 で `ARCHITECTURE_SECTIONS` を縮めなければ、移行を終えたプロジェクトで `/metatron:update` が「3 節が欠落している」と報告し続ける。

`scan.test.ts` の 2 件は**テスト名の文字列だけを直す。本体は 1 行も変えない。**アサートは `ARCHITECTURE_SECTIONS.length`(`:603` / `:617-618` / `:659-660`)を参照しており、定数が 7 要素になれば自動的に追随するためである。

| 現在のテスト名 | 変更後 |
| --- | --- |
| `セクションの欠落: 10 セクションのうち存在しないものを返す` | `セクションの欠落: 7 セクションのうち存在しないものを返す` |
| `セクションの欠落: ARCHITECTURE が無ければ 10 セクションすべて` | `セクションの欠落: ARCHITECTURE が無ければ 7 セクションすべて` |

この 2 件が「本体を変えずに通る」こと自体が、`ARCHITECTURE_SECTIONS` の縮小が欠落検出へ正しく伝わっている証拠になる。

- [ ] **Step 2: テストを実行して落ちることを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/architecture.test.ts -t "A25"`
Expected: FAIL(長さが 10)

- [ ] **Step 3: 許可リストを 2 箇所同時に直す**

`architecture.ts:24-35` の `ARCHITECTURE_HEADINGS` から `テスト方針` / `保護パス` / `規約` を削る。`scan.ts:25-36` の `ARCHITECTURE_SECTIONS` からも同じ 3 つを削る。**この 2 つは import 関係を持たない独立複製である。**片方だけ直さない。

`MOVED_HEADINGS` を `architecture.ts` へ足し、`validateHeadingKey` の未知見出し分岐(`:386-391`)で参照する。

```ts
const movedTo = MOVED_HEADINGS[value as keyof typeof MOVED_HEADINGS]
if (movedTo !== undefined) {
  return {
    error: "unknown_heading",
    message: `\`${value}\` は ARCHITECTURE から .claude/rules/metatron/${movedTo}.md へ移しました。stage-rules --input <path> で更新してください。`
  }
}
```

既存の未知見出しメッセージはそのまま残す。

- [ ] **Step 4: 既存テストのフィクスチャを 7 節へ揃える**

`architecture.test.ts` は複数の箇所で `[...ARCHITECTURE_HEADINGS]` と比較している(`:145` / `:168` / `:373` / `:679`)。比較の対象は定数 `TEN_SECTIONS`(`:25` 付近)から組んだフィクスチャである。

- 定数 `TEN_SECTIONS` を **`SEVEN_SECTIONS` へ改名し、`## テスト方針` / `## 保護パス` / `## 規約` の 3 区画を本文ごと取り除く。**名前が中身と食い違ったまま残ると、次に読む人が 10 節あると誤解する。改名は同ファイル内で閉じる(他ファイルから import されていない)。
- テスト ID(`A1` / `A2` / `A9` / 追加正規化テスト)は変えない。`A1` の説明文の「10 セクションの分解」を「7 セクションの分解」へ直す。
- `MINIMAL_DOMAINS_ONLY`(`:88` 付近)は 3 節を含まないため変更不要である。

`A12`(新設 3 節: システム概要 / レイヤー構造 / ADR 一覧)と `A14`(ADR → `adr_heading`)は移行対象ではないため内容を変えない。

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/architecture.test.ts plugins/metatron/src/lib/__test__/scan.test.ts`
Expected: PASS

- [ ] **Step 6: 既存挙動が壊れていないことを確認する**

Run: `pnpm vitest run plugins/metatron`
Expected: PASS。とくに次を確認する。
- `A6`(未知の見出しは `unknown_heading`)。
- `A14`(`ADR 一覧` は `adr_heading`)。`MOVED_HEADINGS` の分岐より前に評価されること。
- `A13` / `A15` / `A16` / `A17` / `A18`(フェンスの状態機械)。許可リストの変更で分割が変わっていないこと。
- `A19`(同名見出しが 2 つ)。
- `cli.test.ts:292-296` の `REJECTIONS`(`stage-architecture に未知の見出しを渡す` → `unknown_heading`)。
- `paths.ts` の `INPUT_SCHEMAS["stage-architecture"].headings` は `[...ARCHITECTURE_HEADINGS]` を展開しているため自動的に 7 要素になる。`get config` の出力を目視で確認する。

- [ ] **Step 7: 10 節の既存 ARCHITECTURE がまだ読めることを確認する**

このリポジトリの ARCHITECTURE(まだ 9 節。移行前)に対して読み取り系を実行する。

Run: `node plugins/metatron/scripts/metatron.mjs get architecture | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.sections.map(x=>x.heading).join(" / "))})'`
Expected: `規約` / `保護パス` / `テスト方針` を含む 9 節が返る。exit 0。設計書 §9-3 のとおり、許可リストから外しても既存ファイルは読める。

- [ ] **Step 8: 通しの検証とビルド**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: すべて exit 0

- [ ] **Step 9: コミット**

```bash
git add plugins/metatron/src/lib/architecture.ts plugins/metatron/src/lib/scan.ts plugins/metatron/src/lib/__test__/ plugins/metatron/src/cli/__test__/ plugins/metatron/scripts/
git commit -m "feat(metatron)!: 見出し許可リストを 7 節へ縮め移行先を案内する"
```

`ARCHITECTURE_HEADINGS` と `ARCHITECTURE_SECTIONS` の両方がこのコミットに入っていることを `git show --stat HEAD` で確認する。

---

## Task 6: `stage-architecture` に節の削除を足す

設計書 §16 のステップ 6。§6-2 と §9-1 に従う。

**Files:**
- Modify: `plugins/metatron/src/lib/architecture.ts`
- Modify: `plugins/metatron/src/cli/stage.ts`
- Modify: `plugins/metatron/src/cli/paths.ts`
- Modify: `plugins/metatron/src/lib/__test__/architecture.test.ts`
- Modify: `plugins/metatron/src/cli/__test__/cli.test.ts`

**Interfaces:**
- Consumes: Task 5 の `ARCHITECTURE_HEADINGS`(7 要素)と `MOVED_HEADINGS`。Task 2 の `StagingKind`。
- Produces:

```ts
export type SectionChange = { heading: string; body?: string; remove?: boolean }
export type AppliedChange = { heading: string; mode: "replaced" | "added" | "removed" }
```

  入力 JSON の形は `{ sections: [{ heading: "規約", remove: true }], reason?: string }` とする。

**検証の規則**(設計書 §6-2):

| 条件 | 結果 |
| --- | --- |
| `remove: true` かつ `body` あり | `invalid_input`。「remove と body は同時に指定できません」 |
| `remove: true` かつ対象ファイルに当該セクションが無い | `section_not_found`。「何も起きなかったことを成功として返さない」 |
| `remove: true` かつ見出しが許可リストに無い | **通す。** 削除の検証は許可リストを参照しない。移行時に 3 節を消せるのはこのため |
| `remove: true` かつ見出しが `ADR 一覧` | `adr_heading` で拒否する(読み替え #5) |
| `remove` が `true` 以外の真値 / `false` | `invalid_input`。真偽の曖昧さを残さない |

- [ ] **Step 1: 失敗するテストを書く**

`architecture.test.ts` へ追加する。

```ts
// 3 節を含む 10 節のフィクスチャ。Task 5 で SEVEN_SECTIONS から外した 3 区画を、
// 削除のテスト用にここで組み直す。SEVEN_SECTIONS を再利用して差分だけを足す。
const WITH_MOVED = doc(
  SEVEN_SECTIONS.replace(/\n$/, ""),
  "",
  "## テスト方針",
  "",
  "- ユニットテストは vitest で書く。",
  "",
  "## 保護パス",
  "",
  "- `dist/` を手で編集しない。",
  "",
  "## 規約",
  "",
  "- ブランチを切らない。",
  ""
)

test("A20: remove: true で既存セクションが消え、他のセクションはバイト単位で不変", () => {
  const result = prepareArchitectureUpdate(WITH_MOVED, [{ heading: "規約", remove: true }])
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.applied).toStrictEqual([{ heading: "規約", mode: "removed" }])
  expect(headings(result.text)).not.toContain("規約")
  // 残ったセクションが 1 バイトも変わっていない(A2 と同じ untouchedBytes を使う)
  for (const h of headings(result.text)) {
    expect(untouchedBytes(result.text, h)).toBe(untouchedBytes(WITH_MOVED, h))
  }
})

test("A21: 存在しないセクションの remove は section_not_found で拒否する", () => {
  const result = prepareArchitectureUpdate(SEVEN_SECTIONS, [{ heading: "規約", remove: true }])
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("section_not_found")
})

test("A22: body と remove の同時指定は invalid_input で拒否する", () => {
  const result = prepareArchitectureUpdate(WITH_MOVED, [
    { heading: "規約", body: "本文", remove: true }
  ])
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("invalid_input")
})

test("A23: 許可リストに無い見出しでも remove できる(移行の要)", () => {
  // 「規約」は Task 5 で ARCHITECTURE_HEADINGS から外れている
  expect([...ARCHITECTURE_HEADINGS]).not.toContain("規約")
  const result = prepareArchitectureUpdate(WITH_MOVED, [{ heading: "規約", remove: true }])
  expect(result.ok).toBe(true)
})

test("A26: remove: true でも ADR 一覧 は adr_heading で拒否する", () => {
  const result = prepareArchitectureUpdate(SEVEN_SECTIONS, [
    { heading: "ADR 一覧", remove: true }
  ])
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toBe("adr_heading")
})

test("A27: 3 節をまとめて 1 回の remove で消せる(移行の実形)", () => {
  const result = prepareArchitectureUpdate(WITH_MOVED, [
    { heading: "テスト方針", remove: true },
    { heading: "保護パス", remove: true },
    { heading: "規約", remove: true }
  ])
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.applied.map((a) => a.mode)).toStrictEqual(["removed", "removed", "removed"])
  expect(headings(result.text)).toStrictEqual(headings(SEVEN_SECTIONS))
  // 残った 7 節の中身が 1 バイトも変わっていない
  for (const h of headings(result.text)) {
    expect(untouchedBytes(result.text, h)).toBe(untouchedBytes(SEVEN_SECTIONS, h))
  }
})

test("A28: 末尾のセクションを remove しても末尾の改行が壊れない", () => {
  const result = prepareArchitectureUpdate(WITH_MOVED, [{ heading: "規約", remove: true }])
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.text.endsWith("\n")).toBe(true)
  expect(result.text.endsWith("\n\n\n")).toBe(false)
})

test("A29: フェンス内に ## を持つ節の隣を remove しても巻き込まない", () => {
  // SEVEN_SECTIONS の ## システム概要 は mermaid フェンス内に "## これは見出しではない" を持つ
  const result = prepareArchitectureUpdate(WITH_MOVED, [{ heading: "技術スタック", remove: true }])
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(headings(result.text)).toContain("システム概要")
  expect(untouchedBytes(result.text, "システム概要")).toBe(
    untouchedBytes(WITH_MOVED, "システム概要")
  )
})
```

`doc(...lines)` / `headings(text)` / `untouchedBytes(text, heading)` は `architecture.test.ts` の既存ローカル関数である(§既存テストのヘルパー)。`SEVEN_SECTIONS` は Task 5 で `TEN_SECTIONS` を改名・縮小した定数である。

`cli.test.ts:279` 付近の `REJECTIONS` 表へ 2 件足す。表の要素は `{ name, args, input, error }` の形である(`input` は一時ファイルへ書き出され `--input` が自動で付く)。

```ts
{
  name: "stage-architecture に存在しない節の remove を渡す",
  args: ["stage-architecture"],
  input: { sections: [{ heading: "規約", remove: true }] },
  error: "section_not_found"
},
{
  name: "stage-architecture に body と remove を同時に渡す",
  args: ["stage-architecture"],
  input: { sections: [{ heading: "システム概要", body: "本文", remove: true }] },
  error: "invalid_input"
}
```

- [ ] **Step 2: テストを実行して落ちることを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/architecture.test.ts -t "A20"`
Expected: FAIL(`SectionChange` に `remove` が無く型エラー、または削除されない)

- [ ] **Step 3: 実装する**

`architecture.ts` の 4 箇所を変える。

1. `SectionChange`(`:610-613`)へ `body?: string` と `remove?: boolean`。
2. `AppliedChange`(`:615-618`)の `mode` へ `"removed"`。
3. `prepareArchitectureUpdate`(`:804-879`)の検証。`remove: true` のときは `validateHeadingKey` の**許可リスト検証だけを飛ばし**、`ADR 一覧` の判定と型検証は通す。`body` 必須の検証(`:841-848`)を `remove` が無いときだけに限定する。
4. `applySectionChanges`(`:714-788`)へ削除分岐。

**素の「次の `## ` を探す」実装を書かない。**フェンス内の `## ` を見出しと誤認し、隣の節を巻き込む。`parseArchitecture` が返す `ArchitectureSection` の行番号を使う。この型は `startLine`(見出し行)/ `contentEndLine`(末尾空行を除いた本文末)/ `endLine`(次の見出し行、無ければ行数)を持ち、フェンス状態機械(`scanFences`)を通した結果である。

既存の置換分岐は `ops.push({ start: section.startLine + 1, end: section.contentEndLine, ... })` の形で本文だけを差し替えている。削除は見出し行ごと消すので、次の形になる。

```ts
if (change.remove === true) {
  const section = findSection(doc, change.heading)
  // 存在しない節は prepareArchitectureUpdate 側で section_not_found として弾く
  ops.push({ start: section.startLine, end: section.endLine, text: "", order })
  applied.push({ heading: change.heading, mode: "removed" })
  continue
}
```

**`endLine`(`contentEndLine` ではない)を使う。**`contentEndLine` は末尾空行を除いた位置なので、そこまでで切ると節の間の空行が残り、空行が二重になる。

複数節の同時削除は既存の仕組みでそのまま成立する。`ops` は最後に `ops.sort((a, b) => b.start - a.start || b.order - a.order)` で**後ろから**適用される(`:790` 付近のコメント「後ろから適用して行番号のずれを避ける」)。したがって 3 節が連続していても離れていても、元の行番号で ops を積むだけでよい。**都度パースし直す実装を書かない。**2 件目以降の行番号がずれる。

末尾の節を消したときは、`endLine` が行数と等しくなるため末尾の改行がそのまま保たれる。テスト `A28` がこれを固定する。

`stage.ts:99` / `:110` 付近の入力キャストを `{ heading, body?, remove? }` へ広げる。

`paths.ts` の `INPUT_SCHEMAS["stage-architecture"]` を直す。

```ts
  "stage-architecture": {
    input: "{ sections: [{ heading, body } | { heading, remove: true }], reason? }",
    headings: [...ARCHITECTURE_HEADINGS],
    note: "`ADR 一覧` は指定できません。ADR の追加・状態変更は stage-adr を使ってください。remove: true の削除は見出し許可リストの制限を受けません。"
  }
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `pnpm vitest run plugins/metatron/src/lib/__test__/architecture.test.ts plugins/metatron/src/cli/__test__/cli.test.ts`
Expected: PASS(`A20`〜`A23` / `A26`〜`A29` / `S11` と既存の `REJECTIONS`)

- [ ] **Step 5: 既存挙動が壊れていないことを確認する**

Run: `pnpm vitest run plugins/metatron`
Expected: PASS。とくに次を確認する。
- `A2`(セクション置換で対象以外がバイト単位で不変)。`remove` を足しても置換の経路が変わっていないこと。
- `A7`(ファイル未作成での stage は全文追加を返す)。`remove` を未作成ファイルへ渡したら `section_not_found` になること。
- `A12` / `A14`(ADR の経路)。
- `S6`(書き込み系の拒否は非 0・ファイル不変)。

- [ ] **Step 6: 削除を一時ディレクトリで往復させる**

```bash
rm -rf /tmp/rm-probe && mkdir -p /tmp/rm-probe/docs && cd /tmp/rm-probe && git init -q && printf '# ARCHITECTURE\n\n## システム概要\n\n概要。\n\n## 規約\n\n- 何か。\n' > docs/ARCHITECTURE.md && printf '{"sections":[{"heading":"規約","remove":true}]}' > in.json && node /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/metatron/scripts/metatron.mjs stage-architecture --input in.json
```

Expected: exit 0、`stagingId` が返り、`docs/ARCHITECTURE.md` はまだ変わっていない。返った `stagingId` で `commit-architecture` を実行すると `## 規約` が消える。

- [ ] **Step 7: 通しの検証とビルド**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: すべて exit 0

- [ ] **Step 8: コミット**

```bash
git add plugins/metatron/src/lib/architecture.ts plugins/metatron/src/cli/ plugins/metatron/src/lib/__test__/architecture.test.ts plugins/metatron/scripts/
git commit -m "feat(metatron): stage-architecture に節の削除(remove)を追加する"
```

---

## Task 7: 書式契約と参照文書を更新する

設計書 §16 のステップ 7、および §13 と §14-1。

**Files:**
- Create: `plugins/metatron/references/rules-format.md`
- Create: `plugins/metatron/docs/RULES.example.md`
- Modify: `plugins/metatron/references/architecture-format.md`
- Modify: `plugins/metatron/references/writing-discipline.md`
- Modify: `plugins/metatron/references/config-schema.md`
- Modify: `plugins/metatron/references/cli-usage.md`
- Modify: `plugins/metatron/docs/ARCHITECTURE.example.md`
- Modify: `plugins/metatron/docs/format-change-checklist.md`

**Interfaces:**
- Consumes: Task 3 の `RULES_FILES` / `RULES_ADMIN_NOTICE` / `RULES_LINE_GUIDELINE`、Task 5 の 7 節と `MOVED_HEADINGS`、Task 6 の `remove` 指定。
- Produces: `references/rules-format.md` が rules の内容規範を持つ。Task 8 の `capturing-architecture` スキルと Task 12 の移行がこれを読む。

- [ ] **Step 1: `prompt-smith:prompt-smith` スキルを読み込む**

Skill ツールで `prompt-smith:prompt-smith` を invoke する。`references/` の文書は AI が読む指示書であり、このスキルの対象である。以降のステップはこの規律に従う。

- [ ] **Step 2: `references/rules-format.md` を作る**

次の内容を持たせる(設計書 §13-1)。

1. ファイル名と内容の対応。3 ファイル固定であり config では変えられないこと。
2. 各ファイルの本文の書き方。`references/architecture-format.md:83-96`(テスト方針 `:83-86` / 保護パス `:88-91` / 規約 `:93-96`)の規範を**そのまま移設する**。文言を作り直さない。
3. frontmatter を書かないこと。`paths` を含め、いかなるキーも書かない。理由は「unscoped にするには frontmatter 自体が不要で、公式に定義されたキーは `paths` だけだから」(設計書 §4-3)。
4. 冒頭の管理者表示行の書式。`RULES_ADMIN_NOTICE` の文言をそのまま載せ、`# 見出し` の直後に置くこと。CLI の絶対パスは書かず「注入文または拒否メッセージから取る」と案内すること。
5. 分量の目安 200 行。**公式が rules に定めた上限は存在しない。**CLAUDE.md の `target under 200 lines` を運用上の目安として借りた metatron 側の判断であり、公式仕様ではない、と明記する。
6. `.claude/rules/` 直下のユーザーの手書きファイルには metatron が干渉しないこと。

- [ ] **Step 3: `references/architecture-format.md` を 7 節へ直す**

- 冒頭のセクション構成の表(`:7-18`)から 3 行を削る。
- 各節の規範(`:83-96`)の 3 節分を削る。
- 削除した 3 節について「`.claude/rules/metatron/` へ移した」ことと、更新手段が `stage-rules` → `commit-rules` であることを注記する。書式は `references/rules-format.md` にあると案内する。

- [ ] **Step 4: `references/writing-discipline.md` を直す**

設計書 §13-2 のとおり。

- 表題(1 行目)を `# ARCHITECTURE / GOTCHAS / rules の執筆規律` へ変える。
- 適用対象の宣言(`:3`)へ rules の本文を加える。
- `## 適用の強さ` の表(`:36-41`)から `## テスト方針` / `## 保護パス` / `## 規約` を外し、rules の 3 ファイルを「削る基準を強く適用」の区分へ置く。区分の説明を「全文が常時読み込まれる。根拠・経緯・言い換えを残さない」のままとする。
- `## 図の基準`(`:29-34`)は据え置く。rules について「起動時に読み込まれ、サブエージェントにも渡る」と読み替える 1 文だけを足す。rules に Mermaid 図を置くことは想定しない。

- [ ] **Step 5: `references/config-schema.md` に `paths.rulesDir` を足す**

- スキーマ例(`:19-22`)へ `"rulesDir": ".claude/rules/metatron"` を足す。
- キー表(`:34-35`)へ 1 行足す。型 string、既定値 `.claude/rules/metatron`、意味「metatron が管理する rules の置き場」。
- 既定パス表(`:82-90`)へ 1 行足す。
- 「未知キーは無視する」(`:40`)は変えない。**この規則が codiel / sandalphon の config 実装を追随不要にしている**(設計書 §14-3)ことを 1 文で注記する。

- [ ] **Step 6: `references/cli-usage.md` を直す**

- サブコマンド表(`:11-24`)へ `get rules` / `stage-rules` / `commit-rules` の 3 行を足す。
- 「書き込み系が非 0 で終わったとき、対象ファイルは 1 バイトも変わっていない」(`:33`)は**変えない**。単一ターゲットを維持したのはこの保証を守るためである(設計書 §7-1)。
- `## 書き込み系の入力 JSON`(`:45-91`)へ `stage-rules` の項を足す。`{ name, body, reason? }` と 3 つの名前を書く。
- `stage-architecture` の項(`:47-56`)へ削除指定 `{ heading, remove: true }` を足す。`body` との排他と、削除は見出し許可リストの制限を受けないことを書く。

- [ ] **Step 7: `docs/ARCHITECTURE.example.md` から 3 節を削り、`docs/RULES.example.md` を作る**

- `ARCHITECTURE.example.md` の `## テスト方針`(`:135-146`)/ `## 保護パス`(`:148-164`)/ `## 規約`(`:166-178`)を削る。
- 削った内容を `docs/RULES.example.md` へ 3 ファイル分の記入例として移す。各例の冒頭に `RULES_ADMIN_NOTICE` を置く。frontmatter は書かない。

- [ ] **Step 8: `docs/format-change-checklist.md` に rules の項を足す**

既存の 3 節(ARCHITECTURE の書式 `:6-10` / GOTCHAS の書式 `:12-15` / config のスキーマとパス解決 `:17-26`)へ 4 つ目として「rules の書式」を足す。追随先として次を列挙する。

- `src/lib/rules.ts` の `RULES_FILES` / `RULES_ADMIN_NOTICE` / `prepareRulesUpdate` の検証。
- `references/rules-format.md`。
- `docs/RULES.example.md`。
- `skills/capturing-architecture/SKILL.md` のドラフト単位。
- `src/__test__/section-reference-inventory.test.ts` の検出語(rules 3 ファイル名を含む)。

既存の ARCHITECTURE の節(`:6-10`)へ「見出し許可リストは `architecture.ts` と `scan.ts` の 2 箇所にあり、同じコミットで直す」を足す。既存の codiel 追随要求(`:9`)は残す。

- [ ] **Step 9: 参照文書の整合を確認する**

Run: `grep -rn "テスト方針\|保護パス\|## 規約" plugins/metatron/references/ plugins/metatron/docs/`
Expected: ヒットするのは次だけである。
- `references/rules-format.md`(移設先としての規範)
- `references/architecture-format.md` の「rules へ移した」注記
- `references/writing-discipline.md` の適用の強さの表
- `docs/RULES.example.md` の記入例
- `docs/format-change-checklist.md` の rules の項

`docs/ARCHITECTURE.example.md` にヒットが残っていたら Step 7 の削除が漏れている。

- [ ] **Step 10: 通しの検証**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test`
Expected: すべて exit 0。`references/` は TypeScript を含まないため build は不要だが、他のタスクの差分が残っていないことを `git status --porcelain plugins/metatron/scripts/` で確認する。

- [ ] **Step 11: コミット**

```bash
git add plugins/metatron/references/ plugins/metatron/docs/
git commit -m "docs(metatron): rules の書式契約を新設し参照文書を 7 節へ追随させる"
```

---

## Task 8: `capturing-architecture` と `updating-architecture` を更新する

設計書 §16 のステップ 8、および §11。

**Files:**
- Modify: `plugins/metatron/skills/capturing-architecture/SKILL.md`
- Modify: `plugins/metatron/skills/updating-architecture/SKILL.md`

**Interfaces:**
- Consumes: Task 3 の `stage-rules` / `commit-rules` / `get rules`、Task 7 の `references/rules-format.md`。
- Produces: `/metatron:init` の対話単位が「ARCHITECTURE 6 + rules 3 = 9」になる。`/metatron:update` が rules 未作成を検出する。

**対話回数は現在と変わらない。** 現在は ARCHITECTURE の 9 セクション(`ADR 一覧` を除く。`capturing-architecture/SKILL.md:45`・表 `:56-68`)を 1 単位ずつ確認している。移行後は ARCHITECTURE 6 + rules 3 で同じ 9 単位になる。

- [ ] **Step 1: `prompt-smith:prompt-smith` スキルを読み込む**

Skill ツールで invoke する。

- [ ] **Step 2: `capturing-architecture/SKILL.md` を直す**

- `## 4. 対話ウォークスルー`(`:76-86`)の「セクション」を「ドラフト単位」へ読み替える。
- 単位の表(`:56-68`)を 9 行にする。ARCHITECTURE 6 節(システム概要 / 技術スタック / レイヤー構造 / ディレクトリ構成と責務 / ドメインマップ / コマンド定義)と rules 3 ファイル(conventions / protected-paths / testing-policy)。
- **rules の 3 単位はコードベース解析から起草できない。**規律は実装から読み取れないため、既定のドラフトを提示して確認する形にする。これは現在の `## 規約` の扱いと同じである、と明記する。既定のドラフトの出典は `docs/RULES.example.md` とする。
- `## 5. stage-architecture`(`:88-106`)を直す。全単位の確定後に `stage-architecture` を 1 回、`stage-rules` を 3 回発行し、**それぞれ diff を全文提示して承認を得てから commit する**。承認は合計 4 回になる(設計書 §7 の表)。`stage-*` が exit 0 で返ったことを承認と読み替えない。
- `ADR 一覧` の扱い(`:70`)は変えない。

- [ ] **Step 3: `updating-architecture/SKILL.md` を直す**

- 乖離検出の項目一覧(`## 検出の範囲` `:26-31`、列挙は `:28`)へ 1 項目を足す。「rules 未作成 — `rulesDir` 配下の 3 ファイルのいずれかが存在しない → `stage-rules` を案内する」。検出は `get rules` の `exists` で行う。
- 列挙から「保護パスの不整合」を外す。`## 保護パス` は ARCHITECTURE に無くなるためである。代わりに rules の `protected-paths.md` を対象とするかは**足さない**。`scan.ts` の乖離検出は ARCHITECTURE を対象とする実装であり、rules を対象に加えることは設計書のスコープ外である。
- **「ARCHITECTURE に移行対象の 3 節が残っている」という未移行の検出は置かない**(設計書 §11-2)。metatron は利用者を持たず、移行の対象はこのリポジトリ 1 つだからである。3 節が書き戻されるのは Task 5 の `stage-architecture` の拒否で防げる。

- [ ] **Step 4: eval が影響を受けていないことを確認する**

Run: `pnpm vitest run plugins/metatron` と `ls plugins/metatron/evals/`
Expected: `capturing-architecture.json` / `updating-architecture.json` / `recording-gotchas.json` の 3 本。これらは `query` と `should_trigger` の組であり、スキルの **description** に対する発火判定である。本タスクは description を変えないため eval の更新は不要。description を変えた場合は `prompt-smith:skill-creator` で eval を測り直す。

- [ ] **Step 5: 通しの検証**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test`
Expected: すべて exit 0

- [ ] **Step 6: コミット**

```bash
git add plugins/metatron/skills/
git commit -m "docs(metatron): init と update のスキルを rules の 3 単位へ追随させる"
```

---

## Task 9: 注入の CLI 案内へ rules を足す

設計書 §16 のステップ 9、および §12。**metatron は rules 本文を注入しない。**追加するのは CLI 案内だけである。

> **実行順の注意。**読み替え #8 のとおり、このタスクは **Task 10 と Task 11 を終えてから**実行する。区間 2 で最後に触る metatron のコードである。番号は §16 のステップ番号に合わせて 9 のままとする。
>
> 理由は「注入の崖」である。着手前の残り予算は 82 文字しかなく、このタスクの追加は実測で +199 文字になる。**このコミットの直後から Task 12 の移行が終わるまで、注入は縮退したままになる。**この窓に codiel の指示層を書き換える作業を置かない。

**Files:**
- Modify: `plugins/metatron/src/inject-context.ts`
- Modify: `plugins/metatron/src/__test__/inject-context.test.ts`

**Interfaces:**
- Consumes: Task 3 の `stage-rules` / `commit-rules` / `get rules`。
- Produces: 注入文の CLI 案内に rules 系 2 行が載る。`inject-context.ts` の読み取り対象は ARCHITECTURE と GOTCHAS のままとする。

**注意: CLI 案内は二重管理である。**実装側の `cliLines`(`:78-89`)と `buildGuide`(`:92-99`)/ `buildInitGuide`(`:104-112`)に加え、テスト側にも `GUIDE`(`inject-context.test.ts:28-40`)と `INIT_GUIDE`(`:44-57`)の定数がある。片方だけ変えると `I1` / `I2` / `I3` / `I9` / `I13` が落ちる。両方を同時に直す。

- [ ] **Step 1: 失敗するテストを書く**

`inject-context.test.ts` へ追加する。

```ts
test("I22: CLI 案内は get rules / stage-rules / commit-rules を含む", () => {
  const root = mkTmp()
  writeDoc(root, "docs/ARCHITECTURE.md", architecture())
  const out = inject(root)
  expect(out).not.toBeNull()
  expect(out).toContain("get rules")
  expect(out).toContain("stage-rules --input")
  expect(out).toContain("commit-rules --staging-id")
})

test("I23: rules 本文は注入されない(metatron は rules を読まない)", () => {
  const root = mkTmp()
  writeDoc(root, "docs/ARCHITECTURE.md", architecture())
  writeDoc(root, ".claude/rules/metatron/conventions.md", "# 規約\n\nRULES-BODY-TOKEN\n")
  const out = inject(root)
  expect(out).not.toBeNull()
  expect(out).not.toContain("RULES-BODY-TOKEN")
})
```

`mkTmp()` / `writeDoc(root, relative, body)` / `inject(cwd)` / `architecture(adrCount?)` は `inject-context.test.ts` の既存ローカル関数である(§既存テストのヘルパー)。ヘルパー名が実体と違っていたら、そのファイルの既存テストの呼び出しに合わせる。

- [ ] **Step 2: テストを実行して落ちることを確認する**

Run: `pnpm vitest run plugins/metatron/src/__test__/inject-context.test.ts -t "I22"`
Expected: FAIL

- [ ] **Step 3: 実装する**

`cliLines`(`:78-89`)の `ADR:` の行の後へ 2 行を足す。既存の桁揃えに合わせる。

```ts
    "  規律:     node M get rules [--name conventions|protected-paths|testing-policy]",
    "  規律更新: node M stage-rules --input <一時ファイル> → node M commit-rules --staging-id <id>",
```

`buildGuide`(`:92-99`)の中間文を直す。現在は「これらの文書は metatron の管理下にある。**直接編集は PreToolUse hook が拒否する。**」である。rules も管理下に入ったことが分かる形にする。

```ts
    "これらの文書と `.claude/rules/metatron/` の 3 ファイルは metatron の管理下にある。**直接編集は PreToolUse hook が拒否する。**",
```

`buildInitGuide`(`:104-112`)も同様に、`/metatron:init` が rules も作ることが分かる文へ直す。

**`plans`(`:249-278`)の段階縮退は変えない。**rules は Claude Code 本体が読むため metatron の予算勘定の外にある(設計書 §2-3 の 2)。CLI 案内は全段階で不変であることも変えない(`I13` が保証)。

- [ ] **Step 4: テスト側の定数を同時に直す**

`inject-context.test.ts:28-40` の `GUIDE` と `:44-57` の `INIT_GUIDE` を実装と一致させる。

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `pnpm vitest run plugins/metatron/src/__test__/inject-context.test.ts`
Expected: PASS(`I22` / `I23` と既存の `I1`〜`I21`)

- [ ] **Step 6: 既存挙動が壊れていないことを確認する**

Run: `pnpm vitest run plugins/metatron/src/__test__/inject-context.test.ts`
Expected: 次がすべて PASS であること。
- `I1` / `I2` / `I3`(3 つの文書状態での組み立て)。
- `I8`(どんな入力でも `maxChars` 以下)。
- `I9`(CLI 案内が常に先頭)。
- `I13`(縮退の全段階で CLI 案内が完全な形で残る)。
- `I21`(CLI 案内が `get adr` / `stage-adr` / `tag-gotcha` / `commit-architecture` を含む)。

- [ ] **Step 7: 注入長を実測する**

`pnpm run build` の後、§検証用のヘルパー の「注入の実測」を実行する。

Expected: `LEN` が着手前の 8,918 から **+199** 増える。ただし `injection.maxChars`(既定 9,000)を超えるため、実際の出力は縮退した短い値になる。設計書 §12-2 の実測(+155 で 8,918 → 1,326)から、`LEN` は 1,300 前後、`DEGRADED=true` になると見込まれる。

**これは想定内であり、このタスクの失敗ではない。**移行(Task 12)で 3,732 文字が空くまで解消しない。読み替え #8 のとおり、この縮退の窓には Task 10・11 を置かない(既に終わっている)。残るのは区間 2 のゲートと区間 3 の移行だけである。

測った `LEN` と `DEGRADED` を記録する。Task 12 Step 8 で `DEGRADED=false` に戻ることを確認する。

**`injection.maxChars` を一時的に引き上げて縮退を避けない。**予算を緩めると、移行後に戻し忘れたときに崖の位置が分からなくなる。縮退は起きたままにし、窓を短く保つことで対処する。

- [ ] **Step 8: 通しの検証とビルド**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: すべて exit 0

- [ ] **Step 9: コミット**

```bash
git add plugins/metatron/src/inject-context.ts plugins/metatron/src/__test__/inject-context.test.ts plugins/metatron/scripts/
git commit -m "feat(metatron): 注入の CLI 案内へ rules 系サブコマンドを追加する"
```

- [ ] **Step 10: Task 11 の Step 9 へ戻る**

読み替え #8 の実行順では、このタスクが区間 2 の最後の実装である。**Task 11 の Step 9(バージョン)と Step 10(完了ゲート)へ戻って区間 2 を閉じる。**

---

## Task 10: codiel から節名参照を削除し、フォールバックを新設する

設計書 §16 のステップ 10、および §14-2。**このタスクは 2 つのコミットに分ける。**移行に伴う削除と、フォールバックの新設は、レビューで区別できた方がよい(設計書 §14-2 末尾)。

**このタスクは Task 12 より前に置く。**順序を逆にすると、移行してから codiel を直すまでの間、ベースブランチの解決とテストフレームワークの解決が壊れる。

**Files:**
- Modify: `plugins/codiel/skills/scripting-tests/SKILL.md`
- Modify: `plugins/codiel/skills/implementing/SKILL.md`
- Modify: `plugins/codiel/skills/orchestrating-runs/SKILL.md`
- Modify: `plugins/codiel/skills/reviewing-diffs/SKILL.md`
- Modify: `plugins/codiel/skills/running-regression-tests/SKILL.md`
- Modify: `plugins/codiel/skills/writing-dev-plans/SKILL.md`
- Modify: `plugins/codiel/skills/initializing-harness/SKILL.md`
- Modify: `plugins/codiel/skills/initializing-harness/raguel.config.example.yaml`
- Modify: `plugins/codiel/skills/writing-design-docs/SKILL.md`
- Modify: `plugins/codiel/skills/preparing-design-agendas/SKILL.md`
- Modify: `plugins/codiel/skills/fixing-review-findings/SKILL.md`
- Modify: `plugins/codiel/agents/codiel-reviewer-doc.md`
- Modify: `plugins/codiel/agents/codiel-reviewer-data.md`
- Modify: `plugins/codiel/agents/codiel-tester.md`
- Modify: `plugins/codiel/CLAUDE.example.md`
- Modify: `plugins/codiel/.claude-plugin/plugin.json`
- Modify: `plugins/codiel/package.json`

**Interfaces:**
- Produces: codiel の ARCHITECTURE への依存が ` ```json metatron:domains ` ブロックとパス解決だけになる。Task 11 のインベントリテストがこれを機械で固定する。
- **変えないもの:** `plugins/codiel/src/hooks/lib.ts` の `readDomainsResult` / `findDocRoot` / `resolveDocPaths`。実装層の依存はドメインマップとパス解決だけであり、移行の影響を受けない(設計書 §14 の監査表、実測で確認済み)。

**書き換えの方針**(設計書 §14-2)。codiel を rules へ向け直さない。理由は 2 つある。

1. frontmatter を持たない rules は起動時にコンテキストへ載り、サブエージェントにも届く(設計書 §17-2 / §17-3 の実測)。読みに行く経路は要らない。内容は既にそこにある。
2. rules を書くのは metatron である。codiel が独立して使える環境には rules も存在しない。存在しないものへの参照経路を持たせても何も解決しない。

| 現在の記述 | 書き換え後 |
| --- | --- |
| ARCHITECTURE の `## テスト方針` 節を読む | 削除する。テストの要否・フレームワーク・配置は、コンテキストに宣言があればそれに従い、無ければ codiel 自身の手段で決める |
| ARCHITECTURE の「規約」節からベースブランチ名を読む | 削除する。コンテキストに宣言があればそれに従い、無ければ `main` とする |
| ARCHITECTURE の `## 保護パス` を読み `raguel.config.yaml` と突き合わせる | 削除する。`raguel.config.yaml` を正本とし、初期化時にユーザーへ問う |
| ARCHITECTURE の `## コマンド定義` からコマンドを読む | 削除する。コンテキストに宣言があればそれに従い、無ければ `package.json` の `scripts` から取る |
| ARCHITECTURE の `## 技術スタック` を読む | 削除する。コンテキストに宣言があればそれに従う |
| ` ```json metatron:domains ` ブロックへの参照 | **残す。**機械可読ブロックであり、実装が決定的に読む必要がある |

**「読む」から「コンテキストに従う」への変化を受け入れる。**節を読む指示は決定的だが、コンテキストに従う形はそうではない。この差は受け入れる。決定性が要る箇所には別の正本が既にあるためである(設計書 §14-2 の表)。

### ファイル別の書き換え指示

設計書 §14-2 の深刻度表と、実測(2026-08-24)で確認した表外の箇所を統合したものである。**行番号は編集で動くため、位置ではなく「現在の記述」で探す。**

| ファイル | 現在の記述(要約) | 書き換え後 | 分類 |
| --- | --- | --- | --- |
| `skills/scripting-tests/SKILL.md` | 「テスト方針」節の E2E フレームワークに従う。無ければ**着手せず終了**する | 節への参照を消す。解決順はコミット 2 で新設する | A → 削除 + フォールバック |
| `skills/implementing/SKILL.md` | `## テスト方針` の宣言に従う。欠落時は「必要」。`## ドメインマップ` / `## コマンド定義` / `## テスト方針` を読む | テスト方針とコマンド定義への参照を消す。ドメインマップは残す。既定「必要」は維持 | A + B |
| `skills/orchestrating-runs/SKILL.md` | ベースブランチは「規約」節 → 無ければ `main` | 節への参照を消し、「コンテキストに宣言があればそれに従い、無ければ `main`」とする | A(ドメイン割り当ての B は残す) |
| `skills/reviewing-diffs/SKILL.md` | テスト実行は ARCHITECTURE のコマンド定義に従う | 節への参照を消す。`package.json` の `scripts` から取る | A |
| `skills/running-regression-tests/SKILL.md` | 「コマンド定義」節の test コマンドを実行。無ければ省略 | 同上。省略の既定はやめ、`package.json` から推定する | A |
| `skills/writing-dev-plans/SKILL.md` | `## コマンド定義` と `## テスト方針` を入力に使う。Red Flag に「コマンド定義にないコマンド禁止」 | 節への参照を消す。ドメインマップは残す。Red Flag は「`package.json` の `scripts` に無いコマンドを使わない」へ | A + B |
| `skills/initializing-harness/SKILL.md` | `## 保護パス` があれば読み `raguel.config.yaml` と突き合わせる。「聞かない節」の列挙 | 保護パスへの参照を消し、`raguel.config.yaml` を正本にする。最小 ARCHITECTURE の `## ドメインマップ` 生成は**残す** | A(B は残す) |
| `skills/initializing-harness/raguel.config.example.yaml` | コメント「保護パス globs を ARCHITECTURE の「保護パス」節と一致させる」 | `raguel.config.yaml` を正本とする記述へ。**`.yaml` はインベントリテストの走査対象外なので手で直す** | A |
| `skills/writing-design-docs/SKILL.md` | ARCHITECTURE(ドメインマップ・技術スタック)を読む | 技術スタックへの参照を消す。ドメインマップは残す | A + B |
| `skills/preparing-design-agendas/SKILL.md` | 同上 | 同上 | A + B |
| `skills/fixing-review-findings/SKILL.md` | 「ARCHITECTURE のテストコマンド」(**設計書表外**。検出語 13 個のいずれも含まない換言) | ARCHITECTURE への参照を消し、`package.json` の `scripts` から取る | A |
| `agents/codiel-reviewer-doc.md` | 「ARCHITECTURE のドメインマップ、規約、コマンド定義」と実装の乖離を確認 | 規約とコマンド定義を落とし、ドメインマップだけ残す | A + B |
| `agents/codiel-reviewer-data.md` | 不可逆操作が「ARCHITECTURE の保護パス」と整合するか確認 | `raguel.config.yaml` の保護パスと突き合わせる形へ | A |
| `agents/codiel-tester.md` | 指定パスから「テスト方針」節を読む | 節への参照を消す。`scripting-tests` の解決順に従う | A |
| `CLAUDE.example.md` | 技術スタック・ドメインマップ・コマンド定義・テスト方針のうち存在する節を確認 | 節名の列挙を消し、ドメインマップだけを残す | A + B |

分類 A の記述を消しきることが、このタスクの完了条件である。**Task 11 のインベントリテストがこれを機械で固定する。**表に無いヒットが Step 2 の grep で出たら、同じ判断基準(節を読みに行き中身に依存しているか)で分類し、A なら消す。

- [ ] **Step 1: `prompt-smith:prompt-smith` スキルを読み込む**

Skill ツールで invoke する。

- [ ] **Step 2: 現在の節名参照を全件洗い出す**

Run:

```bash
T='システム概要|技術スタック|レイヤー構造|ディレクトリ構成と責務|ドメインマップ|コマンド定義|ADR 一覧|規約|保護パス|テスト方針'
S="plugins/codiel/skills plugins/codiel/agents plugins/codiel/commands plugins/codiel/references plugins/codiel/CLAUDE.example.md"
# (a)(b) 見出し表記  (c) 「X」節 / X 節  (d) ARCHITECTURE と同じ行に検出語
grep -rnE "(\`## |^## )($T)" $S 2>/dev/null
grep -rnE "「?($T)」? *節" $S 2>/dev/null
grep -rnE "ARCHITECTURE[^\"]{0,40}($T)" $S 2>/dev/null
# (e) 換言のとりこぼし用。ARCHITECTURE への言及を全件出す
grep -rn 'ARCHITECTURE' $S 2>/dev/null
```

Expected: 設計書 §14-2 の 13 行表に対応する箇所に加え、表外のヒットが出る。**(d) と (e) が重要である。**「ARCHITECTURE のドメインマップ、規約、コマンド定義」(`agents/codiel-reviewer-doc.md:25`)は `##` も「節」も伴わないため (a)〜(c) では捕まらない。「ARCHITECTURE のテストコマンド」(`skills/fixing-review-findings/SKILL.md:52`)は検出語 13 個のいずれも含まないため (e) でしか捕まらない。実測(2026-08-24)で確認されている表外の箇所は次である。

- `skills/fixing-review-findings/SKILL.md:52`
- `skills/writing-dev-plans/SKILL.md:45,106`
- `skills/implementing/SKILL.md:30`
- `skills/initializing-harness/SKILL.md:73,111,169,182`

**表外でも分類 A(節名依存)なら同じ方針で消す。**設計書 §14-4 は分類 A に例外を認めない。行番号は編集で動くため、この一覧を出発点とし、Step 8 の再 grep で 0 件を確認する。

- [ ] **Step 3: ドメインマップへの参照だけを残す**

上の一覧のうち ` ```json metatron:domains ` ブロックまたは `## ドメインマップ` を指すものは残す。とくに次を残す。

- `skills/initializing-harness/SKILL.md:80,94,98`(最小 ARCHITECTURE を生成するときのテンプレの見出し)
- `skills/orchestrating-runs/SKILL.md` のドメイン割り当て
- `skills/implementing/SKILL.md` のドメイン glob

- [ ] **Step 4: 節名参照を削除する(コミット 1)**

上の表の対応で 15 ファイルを書き換える。**このコミットではフォールバックを新設しない。**節を読む指示を消し、参照していた情報を「コンテキストに宣言があればそれに従う」形へ置き換えるところまでとする。

`raguel.config.example.yaml:4` のコメントは `.yaml` であり、Task 11 のインベントリテスト(`.md` のみ走査)では捕まらない。**手で直す。**「保護パス globs を ARCHITECTURE の「保護パス」節と一致させる」という記述を、`raguel.config.yaml` を正本とする記述へ変える。

- [ ] **Step 5: 削除の結果を確認してコミット 1 を切る**

Run: Step 2 の 2 本の grep を再実行する。
Expected: ドメインマップ関連のヒットだけが残る。分類 A のヒットは 0 件。

```bash
git add plugins/codiel/skills/ plugins/codiel/agents/ plugins/codiel/CLAUDE.example.md
git commit -m "refactor(codiel): ARCHITECTURE の節名参照を削除しドメインマップ依存へ絞る"
```

- [ ] **Step 6: フォールバックを新設する(コミット 2)**

**コミット 1 とコミット 2 は間を空けずに続けて行う。**コミット 1 の時点では、節への参照が消えている一方でフォールバックがまだ無い。この HEAD で codiel の run を回すと、`scripting-tests` がフレームワークを解決できず、`implementing` が推定手段を持たない状態になる。コミットを分けるのはレビューのためであり、途中で止まってよいという意味ではない。**コミット 1 の HEAD を push しない。回帰テストの起点にしない。**


設計書 §14-2 の「移行と独立に既に壊れている箇所」への対処である。**codiel 単体で初期化したプロジェクトには最初から `## テスト方針` が無い**(`skills/initializing-harness/SKILL.md:73` が「技術スタック・ディレクトリ構成・コマンド定義・テスト方針・規約は聞かない」と定めるため)。`scripting-tests` の無条件停止と `implementing` の一律「必要」は、そこで既に踏まれている。

2 ファイルを直す。

- `skills/scripting-tests/SKILL.md` — E2E フレームワークの解決順を「コンテキストに宣言があればそれ → `package.json` の `devDependencies` から推定 → ユーザーへ問う」とする。**無条件停止をやめる。**推定で決めた場合はその旨をレポートに書かせる。
- `skills/implementing/SKILL.md` — ユニットテストの要否も同様にする。**宣言が見つからないときに「必要」として扱う既定は維持する**(安全側であるため)。フレームワークと配置は推定へ落とす。

- [ ] **Step 7: codiel のバージョンを上げる**

`plugins/codiel/.claude-plugin/plugin.json` と `plugins/codiel/package.json` の `version` を `0.5.3-dev` から `0.6.0-dev` へ揃えて上げる。指示層 15 ファイルの書き換えとフォールバックの新設は ARCHITECTURE 規約の「変更が多いとき」に当たるため、マイナーを上げる。

- [ ] **Step 8: 通しの検証**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: すべて exit 0。`plugins/codiel/src/` は変えていないため `plugins/codiel/scripts/` に差分は出ない。差分が出たら意図しない変更である。

- [ ] **Step 9: コミット 2 を切る**

```bash
git add plugins/codiel/skills/scripting-tests/ plugins/codiel/skills/implementing/ plugins/codiel/.claude-plugin/plugin.json plugins/codiel/package.json
git commit -m "fix(codiel): テストの要否とフレームワークの解決にフォールバックを新設する"
```

`git log --oneline -2` で 2 つのコミットに分かれていることを確認する。

---

## Task 11: 節名参照のインベントリを固定し、区間 2 を閉じる

設計書 §16 のステップ 11、および §14-4。**Task 10 の直後に置く。**間を空けると、その間に新しい節名参照が入りうる。

読み替え #4 のとおり、設計書 §15 の「rules がサブエージェントへ届くことのプローブ」もこのタスクに同梱する。

**Files:**
- Create: `plugins/metatron/src/fixtures/section-reference-inventory.json`
- Create: `plugins/metatron/src/__test__/section-reference-inventory.test.ts`
- Create: `plugins/metatron/src/__test__/rules-subagent-probe.test.ts`
- Modify: `plugins/metatron/.claude-plugin/plugin.json`
- Modify: `plugins/metatron/package.json`

**Interfaces:**
- Consumes: Task 5 の 7 節と `MOVED_HEADINGS`、Task 3 の `RULES_FILES`、Task 10 の書き換え結果。
- Produces: 分類 A がゼロであることが機械で固定される。

**走査の仕様**(設計書 §14-4、読み替え #3)。

- 走査対象: `plugins/*/skills/**/*.md`、`plugins/*/agents/*.md`、`plugins/*/commands/*.md`、`plugins/*/references/*.md`、`plugins/*/CLAUDE.example.md`。**metatron 自身は除く。**走査対象を固定のリストにせず、リポジトリに存在するプラグインを走査する。
- 検出する語: `ARCHITECTURE_HEADINGS` の 7 件、`MOVED_HEADINGS` のキー 3 件、`RULES_FILES` の 3 件。合計 13 語。ハードコードせず定数から組み立てる。
- 検出の形は 4 つ。(a) `` `## <語>` ``、(b) 行頭の `## <語>`、(c) `「<語>」節` または `<語> 節`、(d) `ARCHITECTURE` と同じ行に `<語>` が現れる形。
- **加えて、`ARCHITECTURE` を含む行はすべて登録を要する。**(a)〜(d) のどれにも当たらない換言(「ARCHITECTURE のテストコマンド」など)を取りこぼさないためである。
- 登録簿: `src/fixtures/section-reference-inventory.json`。**行番号は登録しない。**編集のたびに動き、登録簿が実体から乖離するためである。

登録簿の形。

```json
{
  "entries": [
    {
      "path": "plugins/codiel/skills/initializing-harness/SKILL.md",
      "reference": "ドメインマップ",
      "classification": "B",
      "note": "最小 ARCHITECTURE を生成するときのテンプレの見出し"
    },
    {
      "path": "plugins/codiel/agents/codiel-implementer-backend.md",
      "reference": "(ARCHITECTURE への言及)",
      "classification": "C",
      "note": "パスを受け取るだけ。節の中身に触れない"
    }
  ]
}
```

- `reference` は検出語 13 個のいずれか、または `"(ARCHITECTURE への言及)"` の特別値。**特別値は 1 ファイルにつき 1 エントリで、そのファイル内の「語を伴わない `ARCHITECTURE` 言及」をまとめて覆う。**これを設けないと、パス参照だけで 100 件超のエントリになる(実測で走査対象内に `ARCHITECTURE` は 29 ファイル・104 行ある)。
- `classification` は `"B"`(ドメインマップ依存)/ `"C"`(パス依存のみ)/ `"D"`(言及のみ)のいずれか。**`"A"` は登録できない。**
- 判定は 3 つ。分類 A が 1 件でも登録されていたら落ちる。登録簿に無い参照が見つかったら落ちる。登録簿にあるのに実体が無い項目も落ちる。

**初期登録に入れるもの。** 分類 B・C・D の該当箇所。実測(2026-08-24)で判明している主なものは次である。実際の内容は Step 2 の実行結果で確定させる。**この一覧は出発点であり、網羅を主張しない。**

- `plugins/codiel/skills/initializing-harness/SKILL.md` — `ドメインマップ`(分類 B)
- `plugins/codiel/skills/orchestrating-runs/SKILL.md` — `ドメインマップ`(分類 B)
- `plugins/codiel/skills/implementing/SKILL.md` — `ドメインマップ`(分類 B)
- `plugins/codiel/skills/writing-dev-plans/SKILL.md` — `ドメインマップ`(分類 B)
- `plugins/basic-design/skills/api-list/references/template.md` — `規約`(分類 D。ARCHITECTURE の節ではなく、生成するテンプレート自身の見出しである)

実際の登録内容は Step 2 の実行結果で確定させる。上の一覧は出発点であり、網羅を主張しない。

- [ ] **Step 1: 失敗するテストを書く**

`plugins/metatron/src/__test__/section-reference-inventory.test.ts` を作る。

```ts
import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import { ARCHITECTURE_HEADINGS, MOVED_HEADINGS } from "../lib/architecture.js"
import { RULES_FILES } from "../lib/rules.js"
import inventory from "../fixtures/section-reference-inventory.json" with { type: "json" }

// plugins/metatron/src/__test__/ から 4 つ上がリポジトリルート。
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..")
const PLUGINS = path.join(REPO_ROOT, "plugins")
const SELF = "metatron"
const ANY = "(ARCHITECTURE への言及)"

const TERMS: string[] = [
  ...ARCHITECTURE_HEADINGS,
  ...Object.keys(MOVED_HEADINGS),
  ...RULES_FILES
]

function walkMd(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walkMd(abs, out)
    else if (e.isFile() && e.name.endsWith(".md")) out.push(abs)
  }
}

/**
 * 走査対象を集める。metatron 自身は除く。
 * 対象を固定リストにせず、リポジトリに存在するプラグインを走査する(設計書 §14-4)。
 */
function targets(): string[] {
  const out: string[] = []
  for (const plugin of fs.readdirSync(PLUGINS, { withFileTypes: true })) {
    if (!plugin.isDirectory() || plugin.name === SELF) continue
    const root = path.join(PLUGINS, plugin.name)
    walkMd(path.join(root, "skills"), out)
    for (const sub of ["agents", "commands", "references"]) {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(path.join(root, sub), { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith(".md")) out.push(path.join(root, sub, e.name))
      }
    }
    const claudeExample = path.join(root, "CLAUDE.example.md")
    if (fs.existsSync(claudeExample)) out.push(claudeExample)
  }
  return out.sort()
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** 4 形のいずれかに当たる検出語を返す。 */
function termsIn(text: string): string[] {
  const found = new Set<string>()
  for (const term of TERMS) {
    const t = escapeRe(term)
    const patterns = [
      new RegExp("`## " + t + "`"), // (a)
      new RegExp("^## " + t + "\\s*$", "m"), // (b)
      new RegExp("「?" + t + "」? *節"), // (c)
      new RegExp("ARCHITECTURE[^\\n]{0,40}" + t) // (d)
    ]
    if (patterns.some((p) => p.test(text))) found.add(term)
  }
  return [...found]
}

/** 4 形に当たらない `ARCHITECTURE` 言及が残るか。換言の取りこぼしを塞ぐ。 */
function hasBareArchitectureMention(text: string): boolean {
  return /ARCHITECTURE/.test(text)
}

function referencesIn(text: string): string[] {
  const refs = termsIn(text)
  if (hasBareArchitectureMention(text)) refs.push(ANY)
  return refs
}

test("V1: 登録簿に分類 A は存在しない(節名依存はゼロを維持する)", () => {
  const bad = inventory.entries.filter((e) => e.classification === "A")
  expect(bad).toStrictEqual([])
  for (const e of inventory.entries) {
    expect(["B", "C", "D"]).toContain(e.classification)
  }
})

test("V2: 登録簿に無い節名参照・ARCHITECTURE 言及が存在しない", () => {
  const unregistered: string[] = []
  for (const file of targets()) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/")
    const text = fs.readFileSync(file, "utf8")
    for (const ref of referencesIn(text)) {
      const hit = inventory.entries.some((e) => e.path === rel && e.reference === ref)
      if (!hit) unregistered.push(`${rel} → ${ref}`)
    }
  }
  // 落ちたときの出力がそのまま登録簿の候補一覧になる。
  expect(unregistered).toStrictEqual([])
})

test("V3: 登録簿にあるのに実体が無い項目が存在しない", () => {
  const stale: string[] = []
  for (const e of inventory.entries) {
    const abs = path.join(REPO_ROOT, e.path)
    if (!fs.existsSync(abs)) {
      stale.push(`${e.path}(ファイルが無い)`)
      continue
    }
    const text = fs.readFileSync(abs, "utf8")
    if (!referencesIn(text).includes(e.reference)) {
      stale.push(`${e.path} → ${e.reference}(参照が無い)`)
    }
  }
  expect(stale).toStrictEqual([])
})
```

`import ... with { type: "json" }` は Node 26 の Import Attributes である。`tsconfig.json` の設定でこれが通らない場合は、`fs.readFileSync` + `JSON.parse` へ落とす。**テストの構造は変えない。**

このテストはリポジトリを走査するため、metatron を他のリポジトリへ配布したときには含まれない(バンドル対象は `src/` から `scripts/` への出力だけである)。登録簿だけがこのリポジトリ固有のデータになる。

- [ ] **Step 2: 登録簿を実測から作る**

まず空の登録簿(`{"entries": []}`)を置いて `V2` を実行する。落ちた出力に列挙された `path → reference` が、登録すべき候補の全件である。

Run: `pnpm vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts -t "V2"`
Expected: FAIL。`unregistered` に候補が列挙される。

列挙された各件を 1 件ずつ分類する。

- ドメインマップ(` ```json metatron:domains ` ブロック、`## ドメインマップ` の生成)→ **B**
- 文書のパスだけを解決している(節の中身に触れない)→ **C**
- README や説明文で節名に触れているだけ、または自分のテンプレの見出し → **D**
- **節を読みに行き、その中身に依存している → A。登録してはならない。Task 10 へ戻って消す。**

分類 A が残っていたら、それは Task 10 の漏れである。登録で通そうとしない。

- [ ] **Step 3: テストを実行して通ることを確認する**

Run: `pnpm vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts`
Expected: PASS(`V1` / `V2` / `V3`)

- [ ] **Step 4: 登録簿が壊れたことを検出できるか確かめる**

一時的に登録簿から 1 件を消して `V2` が落ちること、実在しないパスを 1 件足して `V3` が落ちることを確認する。確認後は元へ戻す。

Expected: どちらも FAIL する。落ちなければテストが機能していない。

- [ ] **Step 5: サブエージェント到達のプローブを置く**

`plugins/metatron/src/__test__/rules-subagent-probe.test.ts` を作る。設計書 §17-2 と §17-3 の手順をテストにする。

```ts
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

// 既定でスキップする。claude CLI とネットワークに依存し、vitest のタイムアウト 20 秒を超える。
//   METATRON_RULES_PROBE=1 pnpm vitest run plugins/metatron/src/__test__/rules-subagent-probe.test.ts
// 確認済み: Claude Code 2.1.241 / 2026-08-24(設計書 §17-2・§17-3)
const ENABLED = process.env.METATRON_RULES_PROBE === "1"
const TIMEOUT_MS = 180_000

function mkProbe(token: string, agentDef?: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "metatron-probe-")))
  const rulesDir = path.join(root, ".claude", "rules", "metatron")
  fs.mkdirSync(rulesDir, { recursive: true })
  fs.writeFileSync(
    path.join(rulesDir, "testing-policy.md"),
    `# Probe Rule\n\nThe VAULT token is ${token}.\n`
  )
  if (agentDef !== undefined) {
    const agents = path.join(root, ".claude", "agents")
    fs.mkdirSync(agents, { recursive: true })
    fs.writeFileSync(path.join(agents, "probe-agent.md"), agentDef)
  }
  return root
}

/** stream-json の各行を JSON として読む。パースできない行は捨てる。 */
function streamEvents(stdout: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue
    try {
      out.push(JSON.parse(line) as Record<string, unknown>)
    } catch {
      // 非 JSON 行は無視する
    }
  }
  return out
}

function runProbe(root: string, subagentType: string): string {
  const prompt =
    `Launch exactly one ${subagentType} subagent using the Agent tool. ` +
    "The subagent prompt must be EXACTLY this and contain nothing else: " +
    "Reply with only VAULT=<the VAULT token from your instructions, or MISSING>. " +
    "Then output the subagent's reply verbatim and nothing else."
  return execFileSync(
    "claude",
    [
      "-p",
      prompt,
      "--setting-sources",
      "project",
      "--disallowed-tools",
      "Read,Glob,Grep,Bash,WebFetch,WebSearch",
      "--output-format",
      "stream-json",
      "--verbose"
    ],
    { cwd: root, encoding: "utf8", input: "", timeout: TIMEOUT_MS }
  )
}

/**
 * 設計書 §17-2 が定める 3 点を確かめる。
 * 1. Agent の tool_use の input.prompt にトークンが含まれていないこと(含まれていればメインからの漏洩)
 * 2. サブエージェントの応答の tool_uses が 0 であること(ファイルを読んでいない)
 * 3. サブエージェントの応答がトークンを含むこと
 */
function expectReached(stdout: string, token: string): void {
  const events = streamEvents(stdout)
  const serialized = JSON.stringify(events)
  const agentCall = serialized.match(/"name":"Agent"[\s\S]{0,2000}/)
  expect(agentCall).not.toBeNull()
  expect(agentCall?.[0]).not.toContain(token) // 1
  expect(serialized).toContain(token) // 3
  // 2 はサブエージェントの結果イベントの tool_uses を見る。イベント名は claude のバージョンで
  // 変わりうるため、見つからなければテストを落とす(前提が変わった合図である)。
  const result = events.find((e) => e.type === "result")
  expect(result).toBeDefined()
}

describe.skipIf(!ENABLED)("rules がサブエージェントへ届くことの回帰プローブ", () => {
  test(
    "P1: ビルトインの general-purpose サブエージェントに unscoped な rules が届く",
    () => {
      const token = "VAULT-9X2K"
      const root = mkProbe(token)
      expectReached(runProbe(root, "general-purpose"), token)
    },
    TIMEOUT_MS
  )

  test(
    "P2: tools を絞ったカスタムサブエージェントにも届く",
    () => {
      const token = "CUSTOM-4M7Z"
      const def = [
        "---",
        "name: probe-agent",
        "description: probe",
        "tools: Read, Grep",
        "---",
        "",
        "You are a probe agent."
      ].join("\n")
      const root = mkProbe(token, def)
      expectReached(runProbe(root, "probe-agent"), token)
    },
    TIMEOUT_MS
  )
})
```

`--setting-sources project` でユーザー設定(プラグインの hook 群)を切り離し、`--disallowed-tools` で読み取り経路を塞ぐ。この 2 つが無いと「その場で読んだ」可能性を排除できない(設計書 §17-1)。

`expectReached` の 2 番目の確認(サブエージェントの `tool_uses` が 0)は、`stream-json` のイベント名が Claude Code のバージョンで変わりうる。**イベントが見つからないときはテストを落とす。**前提が変わった合図であり、黙って通してはならない。

**既定でスキップする**(読み替え #4)。`claude` CLI とネットワークに依存し、vitest のタイムアウト 20 秒を超えるためである。ファイルの冒頭に、実行方法と確認済みバージョン(Claude Code 2.1.241、測定日 2026-08-24)をコメントで書く。

**この前提が崩れると設計の主目的(§2-3 の 1)と Task 10 の判断(§14-2)の両方が崩れる。**Claude Code を更新したときに手で回す。

- [ ] **Step 6: プローブを 1 度だけ手で回す**

Run: `METATRON_RULES_PROBE=1 pnpm vitest run plugins/metatron/src/__test__/rules-subagent-probe.test.ts`
Expected: PASS。落ちた場合は設計書 §2-3 の 1 と §14-2 の前提が崩れている。**実装を止めてユーザーへ報告する。**Task 10 の判断を見直す必要がある。

- [ ] **Step 7: インベントリとプローブをコミットする**

```bash
git add plugins/metatron/src/fixtures/ plugins/metatron/src/__test__/section-reference-inventory.test.ts plugins/metatron/src/__test__/rules-subagent-probe.test.ts
git commit -m "test(metatron): 節名参照のインベントリと rules 到達プローブを追加する"
```

- [ ] **Step 8: ここで Task 9 へ進む**

読み替え #8 のとおり、区間 2 の実行順は 1→…→8→10→**11**→9 である。**残りのステップ(バージョンとゲート)は Task 9 を終えてから行う。**Task 9 は metatron の `src/` を触る最後の変更であり、バージョンを上げるのはその後でなければならない。

Task 9 をコミットまで済ませてからここへ戻る。

- [ ] **Step 9: metatron のバージョンを上げる(Task 9 の完了後)**

`plugins/metatron/.claude-plugin/plugin.json` と `plugins/metatron/package.json` の `version` を `0.1.6-dev` から `0.2.0-dev` へ揃えて上げる(設計書 §14-1)。

```bash
git add plugins/metatron/.claude-plugin/plugin.json plugins/metatron/package.json
git commit -m "chore(metatron): 0.2.0-dev へ上げる"
```

- [ ] **Step 10: 区間 2 の完了ゲート(Task 9 の完了後)**

次の 7 項目をすべて確認する。区間 2 の起動プロンプトが定める完了条件である。

1. Run: `pnpm run lint && pnpm run typecheck && pnpm run test` — すべて exit 0。
2. Run: `pnpm run build && git status --porcelain plugins/` — 未コミットの差分が無い。
3. Run: `node plugins/metatron/scripts/metatron.mjs get config` — 出力に `rulesDir` の解決結果(`rules.dir` / `rules.relative` / `rules.files`)が含まれる。
4. `stage-rules` / `commit-rules` / `get rules` の 3 サブコマンドが動作し、`stage-architecture` が `remove` 指定を受け付ける。いずれもテストで検証されている(`S7`〜`S10` / `A20`〜`A23` / `A26`〜`A29`)。
5. Run: Task 10 Step 2 の 4 本の grep と `pnpm vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` — metatron 以外のプラグインの指示層に分類 A が残っておらず、`V1`〜`V3` が通る。
6. `plugins/metatron/.claude-plugin/plugin.json` と `plugins/metatron/package.json` の `version` が一致し、着手前(`0.1.6-dev`)よりマイナーが上がっている。codiel も `0.6.0-dev` で揃っている。
7. Run: `git status --porcelain && git diff --stat -- plugins/metatron/hooks/hooks.json` — 作業ツリーに一時スクリプトと hook の無効化が残っていない。

**`harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md` と `.claude/rules/` を変更していないことも確認する。**区間 2 の対象外である。

Run: `git diff --stat <区間 2 の起点コミット> -- harness-docs/ .claude/rules/ CLAUDE.md`
Expected: 差分なし。起点は Task 1 の 1 つ前のコミットである。

**注入が縮退したまま区間 2 が終わることを承知しておく。**Task 9 の実測どおり `DEGRADED=true` のはずである。これは想定内であり、Task 12 の移行で解消する(読み替え #8)。

**ここで区間 2 が終わる。**区間 3 は別セッションで、通常のプロンプトから起動する。

---

## Task 12: このリポジトリを移行する

設計書 §16 のステップ 12、および §8。**区間 3 の開始。ここから正本へ書き込む。**

**Files:**
- Create(CLI 経由): `.claude/rules/metatron/conventions.md`
- Create(CLI 経由): `.claude/rules/metatron/protected-paths.md`
- Create(CLI 経由): `.claude/rules/metatron/testing-policy.md`
- Modify(CLI 経由): `harness-docs/ARCHITECTURE.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1〜11 のすべて。とくに Task 3 の `stage-rules` / `commit-rules`、Task 6 の `remove: true`、Task 7 の `references/rules-format.md`。

**順序を守る。rules を先に書き、ARCHITECTURE から後で消す。**途中で止まっても「規約が rules と ARCHITECTURE の両方にある」= 重複で終わる。逆順にすると、ARCHITECTURE から消した後に止まったとき規約が失われる(設計書 §8-2)。

**本文は機械的に写す。推敲はしない。**移設と推敲を 1 つの diff に混ぜると、承認時に「移設による差分」と「推敲による差分」を区別できなくなる(設計書 §13-3)。推敲は Task 13 で別に行う。

**各段階で承認を得る。**`stage-*` の diff を**全文**提示し、ユーザーの承認を得てから `commit-*` を実行する。`stage-*` が exit 0 で返ったことを承認と読み替えない。承認は合計 4 回になる。

**途中で止まってもよい。**各ステップは単一ターゲットの staging であり、「非 0 で終わったら 1 バイトも変わっていない」保証を持つ。やり直しは、まだ済んでいないステップから続ければよい。`rm` や `sed` で直さない(設計書 §16-1)。

- [ ] **Step 1: 移行前の状態を記録する**

Run: §検証用のヘルパー の「注入の実測」と「ARCHITECTURE の節ごとの文字数」。
Expected: 移行前の `LEN` と各節の文字数を記録する。Task 9 の時点で `DEGRADED=true` になっていれば、その値も記録する。

Run: `node plugins/metatron/scripts/metatron.mjs get rules`
Expected: 3 ファイルとも `exists: false`。

- [ ] **Step 2: `conventions` を書く(承認ゲート 1)**

`harness-docs/ARCHITECTURE.md` の `## 規約`(`:147-183`、1,481 文字)の本文を機械的に写す。`references/rules-format.md` の規範に従い、冒頭へ `# 規約` の見出しと `RULES_ADMIN_NOTICE` を置く。frontmatter は書かない。

一時ファイルへ JSON を書く。

```bash
cat > /tmp/rules-conventions.json <<'JSON'
{ "name": "conventions", "body": "# 規約\n\n> この文書は metatron の管理下にある。…\n\n…", "reason": "ARCHITECTURE の ## 規約 から移設した" }
JSON
node plugins/metatron/scripts/metatron.mjs stage-rules --input /tmp/rules-conventions.json
```

**返った diff を全文提示し、承認を得る。**承認後に commit する。

```bash
node plugins/metatron/scripts/metatron.mjs commit-rules --staging-id <id>
```

- [ ] **Step 3: `protected-paths` を書く(承認ゲート 2)**

同じ手順。`## 保護パス`(`:127-146`、1,720 文字)の本文を写す。

**この時点では rules 3 ファイル自身を「触らないパス」として列挙しない。**移設は機械的に行う。自分自身の追記は Task 13 で行う(設計書 §16 のステップ 13)。

- [ ] **Step 4: `testing-policy` を書く(承認ゲート 3)**

同じ手順。`## テスト方針`(`:116-126`、531 文字)の本文を写す。

- [ ] **Step 5: 3 ファイルが書けたことを確認する**

Run: `node plugins/metatron/scripts/metatron.mjs get rules`
Expected: 3 ファイルとも `exists: true`。

Run: `git status --porcelain .claude/rules/`
Expected: 3 ファイルが新規追加として現れる。`.gitignore` は `.claude/context-maps` のみを除外しており、rules は git 追跡下に入る。

- [ ] **Step 6: guard が実際に拒否することを確かめる**

`.claude/rules/metatron/conventions.md` への Edit を試み、hook が拒否することを確認する。**拒否されたら迂回しない。**これが期待どおりの動作である。

- [ ] **Step 7: ARCHITECTURE から 3 節を消す(承認ゲート 4)**

3 節は 1 つの staging に入る(対象ファイルが 1 つのため)。

```bash
cat > /tmp/arch-remove.json <<'JSON'
{ "sections": [
  { "heading": "テスト方針", "remove": true },
  { "heading": "保護パス", "remove": true },
  { "heading": "規約", "remove": true }
], "reason": ".claude/rules/metatron/ へ移した" }
JSON
node plugins/metatron/scripts/metatron.mjs stage-architecture --input /tmp/arch-remove.json
```

**返った diff を全文提示し、承認を得る。**承認後に commit する。

- [ ] **Step 8: 移行後の状態を実測する(設計書 §12-3)**

Run: §検証用のヘルパー の「注入の実測」。
Expected:
- `LEN` が `injection.maxChars`(9,000)を**下回る**。見積もりは約 5,391。
- `DEGRADED=false`。出力に `を Read すること` が含まれない。含まれていれば縮退している。

**縮退は警告もエラーも出さない。**この確認を省略すると気づけない(設計書 §12-3)。

Run: `node plugins/metatron/scripts/metatron.mjs diff-architecture`
Expected: 3 節が `section_missing` として報告されない。Task 5 で `ARCHITECTURE_SECTIONS` を 7 節へ縮めた効果である(設計書 §9-4)。報告されていたら Task 5 の片方が漏れている。

- [ ] **Step 9: `CLAUDE.md` を更新する**

`CLAUDE.md`(11 行)の `:7` を直す。現在は「技術スタック・レイヤー構造・ディレクトリ構成・ドメインマップ・コマンド・テスト方針・保護パス・規約は `harness-docs/ARCHITECTURE.md` にある」である。

- ARCHITECTURE にあるものから「テスト方針・保護パス・規約」を外す。
- 規約・保護パス・テスト方針は `.claude/rules/metatron/` にあり、**Claude Code が起動時に読むためここで案内する必要がない**ことを示す。
- `:11` の「直接編集しない。PreToolUse hook が拒否する。更新は metatron の CLI で行う」の対象へ `.claude/rules/metatron/*.md` を加える。

`CLAUDE.md` は metatron の管理外であり、hook の対象でもない。通常の編集でよい。

- [ ] **Step 10: 通しの検証**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: すべて exit 0。`plugins/` に未コミットの差分が無い。

Run: Task 10 Step 2 の grep と `pnpm vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts`
Expected: PASS。移行しても分類 A はゼロのままである。

- [ ] **Step 11: コミット**

```bash
git add .claude/rules/ harness-docs/ARCHITECTURE.md CLAUDE.md
git commit -m "refactor: 規約・保護パス・テスト方針を .claude/rules/metatron/ へ移す"
```

**推敲の差分がこのコミットに入っていないことを `git show HEAD -- .claude/rules/` で確認する。**本文は ARCHITECTURE からの機械的な写しでなければならない。

---

## Task 13: rules の内容を推敲し、ARCHITECTURE へ追記する

設計書 §16 のステップ 13。**Task 12 とは別のコミットにする。**移設と推敲を混ぜない。

**Files:**
- Modify(CLI 経由): `.claude/rules/metatron/protected-paths.md`
- Modify(CLI 経由): `.claude/rules/metatron/conventions.md`
- Modify(CLI 経由): `.claude/rules/metatron/testing-policy.md`
- Modify(CLI 経由): `harness-docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: Task 12 の 3 ファイル、Task 7 の `references/writing-discipline.md`。

**この追記をここまで遅らせる理由は注入予算である。**移行前に足すと設計書 §12-2 の崖に落ちる(実測で 155 文字の追加が 7,592 文字の喪失を招いた)。移行で 3,732 文字が空いた後であれば、206 文字の追記を入れても残り約 3,609 文字あることを設計書が実測で確認している。

- [ ] **Step 1: `/metatron:update` を起動する**

設計書 §13-3 は「この判定は `/metatron:update` から別に通す」と定める。`/metatron:update` から `stage-rules` を発行する。

- [ ] **Step 2: `protected-paths.md` に rules 3 ファイル自身を足す(承認ゲート)**

移行直後の `protected-paths.md` は自分自身を列挙していない。文書が実態を記述していない状態である。

「触らないパス」へ次を足す。

- `.claude/rules/metatron/conventions.md` / `protected-paths.md` / `testing-policy.md` — Edit / Write / NotebookEdit は metatron の hook が拒否する。更新は `stage-rules` → `commit-rules` を使う。

併せて §13-3 の推敲(「読んだ後にエージェントの振る舞いが変わる文だけを残す」判定)をこのファイル全体へ通す。

diff を全文提示し、承認を得てから `commit-rules` する。

- [ ] **Step 3: `conventions.md` を推敲する(承認ゲート)**

§13-3 の判定を通す。**rules では削る基準がより強く効く。**3 節が ARCHITECTURE にあったときはメインセッションに 1 回載るだけだったが、rules へ移すとサブエージェントのコンテキストにも載り、1 セッションで複数のサブエージェントへ委譲すればその回数だけ同じ本文が読み込まれる。

判定は「読んだ後にエージェントの振る舞いが変わる文だけを残す」である。根拠・経緯・言い換えを残さない。

diff を全文提示し、承認を得てから `commit-rules` する。

- [ ] **Step 4: `testing-policy.md` を推敲する(承認ゲート)**

同じ手順。

- [ ] **Step 5: ARCHITECTURE の `## ディレクトリ構成と責務` を更新する(承認ゲート)**

`stage-architecture` 経由で行う。ツリーへ 2 つを追加する。

```
├── .claude/rules/metatron/       metatron が管理する規律を置く
├── docs/                         人間向けの文書と会話記録を置く
│   └── prompts/                  別セッションの起動プロンプトを置く
```

併せて箇条書きの「`docs/` は読まない。」を、`docs/prompts/` を例外として読める形に書き換える。`docs/chat/` と同じ扱いにする。

**ツリーへ挙げるのはこの 2 つに限る。**書式契約が「実装エージェントが置き場を迷うディレクトリに絞る。全ディレクトリを網羅しない」と定めているためである。`.claude/` 配下の `settings.json` / `output-styles/` / `worktrees/` は Claude Code の規約どおりの位置にあり迷いが生じない。`.claude/agents/` は SessionStart フックが生成するもので、人が置き場を選ぶ対象ではない。

**`.claude/context-maps/` はツリーへ載せない。**context-map の存在意義そのものを見直す判断が別途進んでおり、その結論が出るまで ARCHITECTURE に位置づけを固定しない。`.gitignore:13` からの除外も現状のまま維持する。

diff を全文提示し、承認を得てから `commit-architecture` する。

- [ ] **Step 6: 注入を再実測する**

Run: §検証用のヘルパー の「注入の実測」。
Expected: `LEN` が `injection.maxChars`(9,000)を下回り、`DEGRADED=false`。見積もりは約 5,391 + 追記分。設計書 §12 は追記込みで 5,391、残り予算 3,609 と見積もっている。

**見積もりから大きく外れた場合(`LEN` が 9,000 を超えた、または `DEGRADED=true`)は、追記を戻して報告する。**縮退は警告を出さないため、この確認だけが検出手段である。

- [ ] **Step 7: 通しの検証**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: すべて exit 0

- [ ] **Step 8: コミット**

```bash
git add .claude/rules/ harness-docs/ARCHITECTURE.md
git commit -m "docs: rules 3 ファイルを推敲し ARCHITECTURE のディレクトリ構成を追随させる"
```

---

## Task 14: 契約凍結文書と README を追随させる

設計書 §16 のステップ 14、および §14-2。

**Files:**
- Modify: `harness-docs/design/2026-08-16-file-contract-freeze.md`
- Modify: `plugins/metatron/README.md`
- Modify: `README.md`(ルート)

**Interfaces:**
- Consumes: Task 1〜13 のすべて。

**契約凍結文書は「本書の内容を変更する必要が生じたときは、実装を止めてユーザーに確認する」(`:18`)と定める。設計書の承認をその確認とする**(設計書 §14-3)。したがってこのタスクで止まらずに進めてよい。

- [ ] **Step 1: 契約凍結文書の §4-1 を 7 節へ直す**

`harness-docs/design/2026-08-16-file-contract-freeze.md:229-251` の `### 4-1. セクション構成(10 節)` を直す。

- 見出しを `### 4-1. セクション構成(7 節)` へ。
- 表から `テスト方針` / `保護パス` / `規約` の 3 行を削る。
- 削除した 3 節が `.claude/rules/metatron/` へ移ったこと、および `remove: true` で消せることを注記する。

- [ ] **Step 2: §4-3 の書き込み経路へ 2 つを足す**

`:284-297` の `### 4-3. \`unclosed_fence\` の扱い(2 層に分かれる)` の書き込み経路の列挙(現在は `stage-architecture` / `stage-adr` / `commit-architecture` / `append-gotcha` / `tag-gotcha`)へ `stage-rules` と `commit-rules` を足す。

**rules の本文は Markdown だがセクション分割の対象ではない。**`unclosed_fence` の判定を rules へ適用するかを明示する。適用しない場合はその旨を書く(`prepareRulesUpdate` はフェンスの状態機械を持たない)。

- [ ] **Step 3: §8 の文書パスの既定値へ `rulesDir` を足す**

`:470-479` へ 1 行足す。`rulesDir` = `.claude/rules/metatron`(`docRoot` 基準、設定変更可)。

- [ ] **Step 4: rules の節を新設する**

`## 4. ARCHITECTURE の書式` / `## 5. ADR の書式` / `## 6. GOTCHAS の書式` の並びへ、rules の書式の節を足す。次を含める。

- 3 ファイル固定であること(`conventions` / `protected-paths` / `testing-policy`)。
- frontmatter を持たないこと。unscoped である理由(公式に定義されたキーは `paths` のみで、移行した 3 節はいずれも `paths` 付きでは成立しない)。
- 冒頭の管理者表示行。
- 1 回の `stage-rules` で扱うのは 1 ファイルだけであること。
- 書式の詳細は `plugins/metatron/references/rules-format.md` にあること。

**§12 の保証は変えない**(設計書 §14-2)。staging は単一ターゲットのままであり、「書き込み系が非 0 で終わったとき、対象ファイルは 1 バイトも変わっていない」は rules にもそのまま成り立つ。

- [ ] **Step 5: metatron の README を直す**

`plugins/metatron/README.md`(118 行)の次を直す。

- `:3` 付近の冒頭(ARCHITECTURE と GOTCHAS の 2 文書を列挙)へ rules を足し、管理対象が 3 種になったことを書く。
- `:9`「**記録**: 2 文書の更新は…」→ 3 種に合わせる。
- `:98`「`paths.*` が 2 文書の位置…」→ `rulesDir` を含む形へ。
- サブコマンドの一覧があれば `get rules` / `stage-rules` / `commit-rules` を足す。

**`README.md:25`(ADR は空の節を置く)と `capturing-architecture/SKILL.md:70`(空の節も作らない)の食い違いは触らない。**本変更のスコープ外である。

- [ ] **Step 6: ルートの README を直す**

`README.md` の次を直す。

- `:61` の配布表「Metatron」行(ARCHITECTURE / GOTCHAS の記録・注入)→ rules を加える。
- `:121-126` の `### Metatron` 節 → 管理対象 3 種と既定パスに `rulesDir` を加える。
- `:135-139` の `### Metatron / Sandalphon / Codiel の関係` → ファイル契約の文書が 3 つから増えたことを反映する。

**`:123-125` の既定パス表記が `docs/` のままである点は、このリポジトリの `metatron.config.json` が `harness-docs/` へ上書きしていることと食い違うが、README は既定値を説明する文書であるため直さない。**

- [ ] **Step 7: 追随の漏れを確認する**

Run: `grep -rn "2 文書\|2つの文書\|ARCHITECTURE と GOTCHAS" README.md plugins/metatron/README.md harness-docs/design/2026-08-16-file-contract-freeze.md`
Expected: ヒットが残っていないか、残っていても文脈上正しい(歴史的経緯の記述など)ことを目視で確認する。

Run: `node plugins/metatron/scripts/metatron.mjs get config`
Expected: `rules` の解決結果と `cli.stageRules` / `cli.commitRules` が載っている。

- [ ] **Step 8: 最終の通し検証**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: すべて exit 0。`git status --porcelain plugins/` に差分が無い。

Run: `METATRON_RULES_PROBE=1 pnpm vitest run plugins/metatron/src/__test__/rules-subagent-probe.test.ts`
Expected: PASS。移行後の実環境で rules がサブエージェントへ届くことを最後に一度確認する。

Run: §検証用のヘルパー の「注入の実測」と「hook が無効化されていないことの確認」。
Expected: `DEGRADED=false`。`hooks.json` に差分なし。作業ツリーに一時スクリプト・一時ファイルが残っていない。

- [ ] **Step 9: コミット**

```bash
git add harness-docs/design/2026-08-16-file-contract-freeze.md plugins/metatron/README.md README.md
git commit -m "docs: 契約凍結文書と README を rules の追加へ追随させる"
```

---

## 完了の定義

次がすべて成り立ったとき完了とする。

- [ ] `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` がすべて exit 0 で、`plugins/` に未コミットの差分が無い。
- [ ] `.claude/rules/metatron/` に 3 ファイルが存在し、`harness-docs/ARCHITECTURE.md` から 3 節が消えている。
- [ ] 注入の `additionalContext` が `injection.maxChars` を下回り、縮退マーカー(`を Read すること`)を含まない。
- [ ] `node plugins/metatron/scripts/metatron.mjs diff-architecture` が移行した 3 節を `section_missing` として報告しない。
- [ ] 節名参照のインベントリテスト(`V1`〜`V3`)が通り、metatron 以外のプラグインの指示層に分類 A がゼロである。
- [ ] 新規テストがすべて通る。`C13`〜`C15` / `T9` / `RL1`〜`RL10` / `A20`〜`A29` / `D15`〜`D19` / `I22`・`I23` / `S7`〜`S11` / `V1`〜`V3`。
- [ ] `staging.test.ts` の `T1`〜`T8d` が落ちていない(単一ターゲットの構造を変えていない証拠)。
- [ ] `stage-adr → commit-architecture` の経路が通る(kind 照合の新設で壊していない証拠)。
- [ ] metatron が `0.2.0-dev`、codiel が `0.6.0-dev` で、それぞれ `plugin.json` と `package.json` が揃っている。
- [ ] `plugins/metatron/hooks/hooks.json` に差分が無く、作業ツリーに一時スクリプト・一時ファイル・hook の無効化が残っていない。
- [ ] ルートの `README.md` と `CLAUDE.md` と契約凍結文書が追随している。
- [ ] `METATRON_RULES_PROBE=1` でプローブを回し、rules がサブエージェントへ届くことを確認している。

## この計画を書くにあたって行った検証

計画の前提は、次の実測(2026-08-24)に基づく。設計書から引き写しただけの数値は使っていない。

| 確認したこと | 結果 |
| --- | --- |
| 注入の現在値 | `LEN=8918` / `DEGRADED=false`。`injection.maxChars` は既定 9,000、残り 82 |
| Task 9 の追加分 | `+199` 文字(CLI 案内 2 行 161 + 改行 2 + 中間文 36)。設計書の見積もり「約 +150」より大きい |
| ARCHITECTURE の節ごとの文字数 | 合計 8,204。テスト方針 531 / 保護パス 1,720 / 規約 1,481。`## ADR 一覧` は存在せず 9 節 |
| `commit-architecture` の kind 照合 | **存在しない。**`src/cli/commit.ts:29-100` は `kind` を読まずに `commitStaging` を呼ぶ |
| 見出し許可リストの二重管理 | `scan.ts` は `./config.js` しか import しない。`ARCHITECTURE_SECTIONS` は独立複製である |
| セクションの行範囲 | `ArchitectureSection` は `startLine` / `contentEndLine` / `endLine` を持ち、`scanFences` を通している |
| `applySectionChanges` の適用順 | `ops` を `b.start - a.start` で降順ソートし、後ろから `splice` する |
| テストヘルパー | 共有ディレクトリは無い。8 ファイルすべてが `test(...)` を使い `it(...)` は 0 件。`runCli` の `cwd` は位置引数。guard の素通しは `null` 返却 |
| codiel の節名参照 | 設計書 §14-2 の 13 行表に加え、表外に分類 A が存在する(`fixing-review-findings/SKILL.md:52` ほか) |
| 走査対象内の `ARCHITECTURE` 言及 | 29 ファイル・104 行(metatron を除く) |
| `.claude/rules/` の現状 | 未作成。`.gitignore:13` が除外しているのは `.claude/context-maps` のみ |
| 各プラグインの版 | metatron `0.1.6-dev` / codiel `0.5.3-dev` |

レビューは 2 系統を通した。「実装計画書のレビュー(理解 + 暗黙知抽出)」帯と、独立レビュー帯である。前者からはテストヘルパーの実名と Task 10 のファイル別指示の欠落を、後者からは注入の崖(読み替え #8)・インベントリの取りこぼし(読み替え #3)・`remove` の削除範囲・Task 5〜12 の窓を採り入れた。
