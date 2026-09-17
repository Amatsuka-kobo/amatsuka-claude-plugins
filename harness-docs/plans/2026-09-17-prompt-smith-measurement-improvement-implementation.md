# prompt-smith 発火測定・description 改善ループの改修 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 発火測定と改善案生成の子プロセスをリポジトリ外へ隔離し、起動失敗を不発火と区別し、CLI の既定と `--help` を揃え、打ち切り条件と長さの予算を直し、eval セットの作成基準を 6 本のセットへ適用したうえで、最大 1140 回の測定で長さの規律を確定させる。

**Architecture:** `plugins/prompt-smith/src/` の 4 エントリ(`run-trigger-eval` / `improve-description` / `run-loop` / `generate-report`)と `src/lib/` の純関数群。隔離の実体は `spawn` へ渡す argv(`ISOLATION_ARGS`)と cwd(リポジトリ外の一時ディレクトリ)にあり、テストは実プロセスを起こさずに argv と後始末の順序を固定する。規律側は `skills/skill-creator/SKILL.md` と `evals/*.json` が持つ。

**Tech Stack:** TypeScript / Node / esbuild(バンドル) / vitest(テスト) / pnpm workspace / `claude` CLI(`claude -p`)

**設計書:** `harness-docs/design/2026-09-17-prompt-smith-measurement-improvement-design.md`(第 6 版)

**context-map:** `.claude/context-maps/2026-09-17-prompt-smith-improvement.md`

**要件の出発点:** `plugins/prompt-smith/docs/improvement-backlog.md`

---

## Global Constraints

- **設計を覆さない。** 本計画は設計書の確定内容を順序と単位へ割るだけである。設計書に無い機能を足さない。判断が要るものは「判断が要る場面」と「未解決事項」へ回す。
- **`plugins/*/src/` を変更したタスクは、コミット前に必ず `pnpm run build` を実行し、`plugins/prompt-smith/scripts/` の差分を同じコミットへ入れる。** `scripts/` と `dist/` は保護パスであり、手で編集しない。
- **`SKILL.md` と `references/` の編集は `prompt-smith:prompt-smith` を使用し、その規律に従う**(規約「AI 向けの指示書」)。設計書が挙げる根拠・実測値・出典を本文へ持ち込まない。根拠は設計書と `plugins/prompt-smith/docs/` に置く。
- **`.serena/memories/` は Serena の `write_memory` / `edit_memory` で変更する。** git 管理下にあるので、変更したらコミットする。
- **`.raphael/antibodies/` は本改修の対象外。** 触らない。
- ブランチを切らない(`CLAUDE.md`)。worktree が要ると判断したときは `scripts/setup-workspace.sh` を使う。
- 移植部分の各ファイル冒頭の著作権表示と「移植時の変更点」コメントを消さない。挙動を変えたタスクは、**同じコミットで**ファイル冒頭のコメントと `plugins/prompt-smith/NOTICE` の変更点一覧を更新する(Apache-2.0 §4(b))。
- テストは `plugins/prompt-smith/src/__test__/*.test.ts`。ヘルパーは `__test__/helpers/` に置き `.test.ts` を付けない。`vi.mock` を使わない(既存 11 本に 1 つも無い)。`claude` を実起動するテストを書かない。
- 変えない契約: `selectBest`(`run-loop.ts` L79-86)、`splitEvalSet` の seed 既定 42、`stream-parse.ts` の発火判定ロジック(閾値 0.5 / 第 1 ツールで打ち切り / 前方一致)、`isDirectRun` のファイル名ディスパッチ、eval セット JSON のスキーマ(`query` / `should_trigger` の 2 キー・20 問・true 10 / false 10)、`buildSandboxSkillMd` の `disable-model-invocation: false` 強制、改善プロンプトは英文。
- **測定を伴う作業を段 1 の完了前に行わない。** 隔離前に `claude -p` を回すと Stop hook が発火し、`docs/chat/` にファイルが作られる(バックログ §1 の実害)。
- コミットメッセージは Conventional Commits(日本語)。末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。
- 測定の生成物(結果 JSON・ログ)はリポジトリの外に置く。**`git status --porcelain=v1` が測定の前後で完全一致することが、項目 1 の中心的な合格条件である**(設計書 §3.9 手順 5)。

---

## ステップの全体像

ID は `S<段>-<連番>`。段は設計書 §2.1 の段構成に対応する。

| ID | 要約 | 前提 | 種別 |
| --- | --- | --- | --- |
| S1-1 | `prompt-smith` を `0.4.0-dev` へ繰り上げる | なし | 版 |
| S1-2 | `sandbox.ts` に `createIsolatedWorkspace` と祖先 `.claude` 検出を足す | S1-1 | コード |
| S1-3 | `claude-cli.ts` に隔離フラグ・cwd・`close` 待ちを入れる | S1-2 | コード |
| S1-4 | `stream-parse.ts` に `readResultError` を足す | S1-1 | コード |
| S1-5 | `run-trigger-eval.ts` を 3 値化し、`errors` を集計する | S1-2, S1-3, S1-4 | コード |
| S1-6 | `run-loop.ts` に `measurement_failed` を入れる | S1-5 | コード |
| S1-7 | 隔離が効いていることを実機で確かめる(4 相 10 手順) | S1-6 | 検証 |
| S1-8 | `SKILL.md` の測定の規律(L219-225)を隔離後の前提へ改める | S1-7 | 規律 |
| S2-1 | `defaults.ts` を新設し、`--model` の既定を `sonnet` にする | **S1-8** | コード |
| S2-2 | `run-loop` の結果に `environment` を記録する | S2-1 | コード |
| S2-3 | 3 エントリに `--help` を足す | S2-1 | コード |
| S2-4 | README と `SKILL.md` L62-85 を段 2 の変更へ追随させる | S2-3 | 規律 |
| S2-5 | 3 エントリを `--model` 無しでライブ起動して確かめる | S2-3, **S1-7**(probe 資産) | 検証 |
| S3-1 | 打ち切り条件を OR にし、train 空を拒否する | S2-2 | コード |
| S3-2 | 長さの予算(UTF-8 バイト)を改善プロンプトへ入れる | S2-1, **S3-1**(同一ファイル) | コード |
| S3-3 | `parseSkillMd` が空行を含むブロックスカラーを最後まで読むようにする | S1-1 | コード |
| S4-1 | `SKILL.md` に eval セットの作成基準 6 つを足す | S2-4 | 規律 |
| S4-2 | `eval-review.html` に基準の一覧を表示する | S4-1 | コード |
| S4-3 | `prompt-smith` 3 本の eval の true 問を 4 問ずつ差し替える | S4-2 | データ |
| S4-4 | `metatron` 3 本の eval を同様に差し替え、`0.3.6-dev` へ上げる | S4-2, **S1-7**(同一文書) | データ・版 |
| S5-1 | 測定の準備(短縮前の復元・比較 B の案・保存先・事前控え) | S1-7, S3-3, S4-3, S4-4 | 測定 |
| S5-2 | パイロット 1 本(60 spawn)を観察付きで回す | S5-1 | 測定 |
| S5-3 | ベースライン 360 回 | S5-2 | 測定 |
| S5-4 | 比較 A 360 回(metatron の短縮前 vs 現行) | S5-2 | 測定 |
| S5-5 | 比較 B 240 回(長い 2 スキルの現行 vs 600 バイト案) | S5-2 | 測定 |
| S5-6 | 集計・判定・基準 6 の判別力の観測・衝突観測 180 回 | S5-3, S5-4, S5-5 | 測定 |
| S5-7 | 測定結果と判定を `docs/` へ記録する | S5-6 | 文書 |
| S6-1 | §13.4 の分岐に応じて `SKILL.md` L131-139 を改稿する | S5-7 | 規律 |
| S6-2 | `LENGTH_TARGET` / `LENGTH_FLOOR` を確定させる | S5-7 | コード |
| S6-3 | 残りの追随(ルート README・rationale・Serena メモリ) | S6-1 | 文書 |
| S6-4 | Done 条件の総点検 | S6-2, S6-3 | 検証 |

### 依存関係の要点

```
S1-1 ─┬─ S1-2 ── S1-3 ─┐
      ├─ S1-4 ─────────┼─ S1-5 ── S1-6 ── S1-7 ── S1-8 ── S2-1 ─┬─ S2-2 ── S3-1 ── S3-2
      └─ S3-3 ──────────┘                    │                   └─ S2-3 ─┬─ S2-4 ── S4-1 ── S4-2 ─┬─ S4-3
                                             └───────────────────────────→ S2-5                    └─ S4-4
                                             └──────────────────────────────────────────────────────→ S4-4
                                                                     ↓
      S1-7 ∧ S3-3 ∧ S4-3 ∧ S4-4 ──→ S5-1 ── S5-2 ── S5-3 ── S5-4 ── S5-5 ── S5-6 ── S5-7 ─┬─ S6-1 ── S6-3 ─┐
                                                 (直列。並列実行しない)                      └─ S6-2 ─────────┴─ S6-4
```

- **「コードを書いてよい」と「測ってよい」は別である。** 差し替えた問を実際に測ってよいのは段 5 だけである(設計書 §2.1 の表)。段 4 の途中で `run-trigger-eval.mjs` を叩かない。
- **設計書の「段 4 は段 1〜3 と並行可」の実体は、段 3 との並行だけである。** S4-1 が `SKILL.md` を触り、その行番号が S2-4 の編集に依存するため、**段 1・2 とは順序がある。** 設計書が「並行可」と書いたのは「測定を待たずに書いてよい」という意味であり、この順序と矛盾しない。段 3(`run-loop.ts` / `improve-description.ts` / `parse-skill-md.ts`)と段 4(`SKILL.md` / `eval-review.html` / `evals/*.json`)は触るファイルが重ならないので、実際に並行できる。
- **S3-3 は S1-1 の後ならいつでも着手できる。** 段 3 に置いてあるのは設計書 §11 の項目割り当てに従ったためで、依存は無い。ただし**比較 B(S5-5)の前提**なので、S5-1 より前に必ず終える。
- **S2-1 は S1-8 の後に置く。** `defaults.ts` が 3 エントリに同時に触ることに加え、**S1-8 と S2-4 が同じ `SKILL.md` を触る**ため、段 1 を閉じてから段 2 へ入る形に固定する。
- **S5-3 / S5-4 / S5-5 に順序の制約は無いが、「独立」は「任意順の直列」の意味である。** 段 5 は「測定中は他作業を行わない」「同じホームを使う他プロセスの書き込みも避ける」を条件にしている(設計書 §13.3 / §3.6)。**3 群を並列に走らせると、同一 HOME で `claude -p` が重なり、設計書 §16 #15 が観測した「他プロセスによる `~/.claude.json` の書き込み」を自分で作り出す。並列実行しない。**
- **S6-2 は分岐が「反転」または「保留」のときだけ実体を持つ。** それ以外は据え置きの確認だけで終わる。

### 同じファイルを複数のステップが触る

**順序を守らないと git の衝突と行番号のずれが起きる。**

| ファイル | 触るステップ(この順に) | 注意 |
| --- | --- | --- |
| `src/run-loop.ts` | S1-6 → S2-1 → S2-2 → S2-3 → S3-1 → S3-2 | 6 ステップが触る。**1 つずつ順に終える** |
| `src/improve-description.ts` | S2-1 → S2-3 → S3-2 | S3-2 が本体を大きく書き換える |
| `src/run-trigger-eval.ts` | S1-5 → S2-1 → S2-3 | |
| `src/lib/types.ts` | S1-5 → S2-1 → S2-2 | |
| `src/lib/defaults.ts` | S2-1(新設)→ S3-2(定数を追加)→ S6-2(値の確定) | |
| `src/__test__/run-loop.test.ts` | S1-5 → S1-6 → S2-2 → S3-1 → S3-2 | **L30-45 の `selectBest` 3 ケースはどのステップでも変えない** |
| `NOTICE` | S1-3 → S1-5 → S2-2 → S3-1 → S3-2 → S3-3 → S4-2 | 節ごとに番号付きで追記する |
| `skills/skill-creator/SKILL.md` | S1-8 → S2-4 → S4-1 → S6-1 | 下表 |
| `docs/measurement-2026-09-17.md` | S1-7(作成)→ S2-5 → S4-4 → S5-7 | **どのステップも「無ければ作成し、あれば節を追記する」。Write で上書きしない** |

#### `SKILL.md` の 4 ステップ

`plugins/prompt-smith/skills/skill-creator/SKILL.md`(現在 232 行)。**行番号は段を経るごとにずれる。後のステップは、前のステップを反映した実ファイルを読んでから編集する。** 設計書が示す行番号は改修前のものである。

| ステップ | 触る箇所(改修前の行番号) | 前のステップによるずれ |
| --- | --- | --- |
| S1-8 | L219-225(測定の規律) | 無し(最初) |
| S2-4 | L62-85(改善ループの実行) | **S1-8 のぶんはずれない**(S1-8 は L219 以降で後方) |
| S4-1 | L55(既存スキルの入り口)/ L141-162(eval セットの形式)/ L160 / L185(回収検査) | **L141 以降は S2-4 のぶんずれる。L219-225 を S1-8 が書き換えているので、L185 の位置も実ファイルで確かめる** |
| S6-1 | L131-139(description の規律) | **S2-4 のぶんずれる**(S4-1 は L141 以降なので L131-139 には効かない) |

**4 つの編集箇所は互いに重ならない**(L55・L62-85 / L131-139 / L141-185 / L219-225)。順序を守れば内容は順序に依存しないが、**行番号は依存する。**

---

## File Structure

| ファイル | 変更 | 担当ステップ |
| --- | --- | --- |
| `plugins/prompt-smith/.claude-plugin/plugin.json` | `0.3.5-dev` → `0.4.0-dev` | S1-1 |
| `plugins/prompt-smith/package.json` | 同上 | S1-1 |
| `plugins/prompt-smith/src/lib/sandbox.ts` | `createIsolatedWorkspace` 新設・祖先 `.claude` 検出・`createSandbox` 載せ替え | S1-2 |
| `plugins/prompt-smith/src/lib/claude-cli.ts` | `ISOLATION_ARGS` / `buildSpawnOptions` / `buildEvalArgs` / `buildTextArgs` / `killThenSettle` / `callClaudeText` の DI | S1-3 |
| `plugins/prompt-smith/src/lib/stream-parse.ts` | `readResultError` 追加 | S1-4 |
| `plugins/prompt-smith/src/lib/types.ts` | `errors` 2 箇所・`LoopResult.environment`・`RunLoopOptions.model?` | S1-5, S2-1, S2-2 |
| `plugins/prompt-smith/src/run-trigger-eval.ts` | 3 値化・`aggregateOutcomes` / `assertMeasurable`・`--model` 既定・`--help` | S1-5, S2-1, S2-3 |
| `plugins/prompt-smith/src/run-loop.ts` | `measurement_failed`・`environment`・OR 打ち切り・train 空 guard・予算・`--model` 既定・`--help` | S1-6, S2-1, S2-2, S2-3, S3-1, S3-2 |
| `plugins/prompt-smith/src/improve-description.ts` | `budget`・長さ指示・短縮閾値・`--model` 既定・`--help` | S2-1, S2-3, S3-2 |
| `plugins/prompt-smith/src/lib/defaults.ts` | **新規** | S2-1(`DEFAULT_MODEL` / `DEFAULTS`)、S3-2(`LENGTH_TARGET` / `LENGTH_FLOOR` / `byteLength`) |
| `plugins/prompt-smith/src/lib/cli-help.ts` | **新規** | S2-3 |
| `plugins/prompt-smith/src/lib/parse-skill-md.ts` | ブロックスカラーの空行 | S3-3 |
| `plugins/prompt-smith/src/generate-report.ts` | **変更しない** | — |
| `plugins/prompt-smith/build.ts` | **変更しない**(エントリ 4 本のまま) | — |
| `plugins/prompt-smith/src/__test__/sandbox.test.ts` | 拡張(L184-199 は変えない) | S1-2 |
| `plugins/prompt-smith/src/__test__/claude-cli.test.ts` | 拡張 | S1-3 |
| `plugins/prompt-smith/src/__test__/stream-parse.test.ts` | 拡張(既存ケースは変えない) | S1-4 |
| `plugins/prompt-smith/src/__test__/run-trigger-eval.test.ts` | **新規** | S1-5 |
| `plugins/prompt-smith/src/__test__/helpers/fake-child-process.ts` | **新規** | S1-3 |
| `plugins/prompt-smith/src/__test__/cli-help.test.ts` | **新規** | S2-3 |
| `plugins/prompt-smith/src/__test__/run-loop.test.ts` | fixture に `errors` / Case A・B / train 空 / `environment` / 予算。**L30-45 の `selectBest` 3 ケースは変えない** | S1-5, S2-2, S3-1, S3-2 |
| `plugins/prompt-smith/src/__test__/generate-report.test.ts` | fixture に `environment` と `errors` | S1-5, S2-2 |
| `plugins/prompt-smith/src/__test__/improve-description.test.ts` | L74-85 の置き換えと追加 | S3-2 |
| `plugins/prompt-smith/src/__test__/bundle-cli-smoke.test.ts` | `--help` のケース追加・`runWithArguments` | S2-3 |
| `plugins/prompt-smith/src/__test__/parse-skill-md.test.ts` | 空行を含むブロックスカラー(既存ケースは変えない) | S3-3 |
| `plugins/prompt-smith/src/__test__/run-trigger-eval-options.test.ts` | **変更しない** | — |
| `plugins/prompt-smith/scripts/*.mjs` | `pnpm run build` の生成物 | src を触る全ステップ |
| `plugins/prompt-smith/skills/skill-creator/SKILL.md` | L219-225 / L62-85 / L55・L141-162・L160・L185 / L131-139 | S1-8, S2-4, S4-1, S6-1 |
| `plugins/prompt-smith/skills/skill-creator/assets/eval-review.html` | 基準一覧の静的表示 | S4-2 |
| `plugins/prompt-smith/evals/*.json`(3 本) | true 問を 4 問ずつ差し替え | S4-3 |
| `plugins/metatron/evals/*.json`(3 本) | 同上 | S4-4 |
| `plugins/metatron/.claude-plugin/plugin.json` / `package.json` | `0.3.5-dev` → `0.3.6-dev` | S4-4 |
| `plugins/prompt-smith/NOTICE` | 変更点の追記(挙動を変えたステップごと。**番号を重複させない**) | S1-3, S1-5, **S2-2**, S3-1, S3-2, S3-3, S4-2 |
| `plugins/prompt-smith/README.md` | L17-22 の CLI 引数表と、認証の案内 1 行 | S2-4 |
| `plugins/prompt-smith/docs/measurement-2026-09-17.md` | **新規**(実機確認・既定モデルのライブ確認・種別台帳・測定結果と判定)。**どのステップも節を追記する。Write で上書きしない** | S1-7, S2-5, S4-4, S5-7 |
| `~/prompt-smith-probe/`(**リポジトリ外**) | probe スキル / 3 問 eval / `probe-call.mts`。**一時資産。commit しない** | S1-7(作成), S2-5(再利用) |
| `~/prompt-smith-measure-2026-09-17/`(**リポジトリ外**) | 測定の入力(復元した description・短縮案)と出力 17 本。**commit しない** | S5-1〜S5-6 |
| `plugins/prompt-smith/docs/skill-creator-port-rationale.md` | L46 に時点を付け、隔離後の定義を足す | S6-3 |
| `plugins/prompt-smith/references/description-guide.md` | **変更しない**(設計書 §10.2) | — |
| `README.md`(ルート) | §prompt-smith(L123-126)に 1 文 | S6-3 |
| `.serena/memories/agent_policy/core.md` | L426-429 の 3 bundle | S6-3 |
| `harness-docs/design/2026-08-09-…` / `harness-docs/plans/2026-08-09-…` / `harness-docs/handover/2026-08-10-…` | **変更しない**(記録。設計書 §10.8) | — |

---

# 段 1: 隔離と起動失敗の分離

**この段が終わるまで `claude -p` を伴う作業を一切しない。**

---

### S1-1: バージョンを `0.4.0-dev` へ繰り上げる

規約は改修時に `plugin.json` と `package.json` を揃えて上げることを求める。段の最後にまとめると、中間のコミットが `0.3.5-dev` のまま隔離済みの CLI を持つことになる(設計書 §2.1)。

**Files:**
- Modify: `plugins/prompt-smith/.claude-plugin/plugin.json`
- Modify: `plugins/prompt-smith/package.json`

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: 2 ファイルの `version` を `0.4.0-dev` にする**

- [ ] **Step 2: 揃っていることを確かめる**

Run: `grep -h '"version"' plugins/prompt-smith/.claude-plugin/plugin.json plugins/prompt-smith/package.json`
Expected: 2 行とも `"version": "0.4.0-dev"`

- [ ] **Step 3: ビルド出力が変わらないことを確かめる**

`build.ts` の `banner` にバージョンは入っていないため、`scripts/` は変わらない。

Run: `pnpm run build && git status --short plugins/prompt-smith/scripts`
Expected: 差分なし

- [ ] **Step 4: Commit**

```bash
git add plugins/prompt-smith/.claude-plugin/plugin.json plugins/prompt-smith/package.json
git commit -m "$(cat <<'EOF'
chore(prompt-smith): バージョンを 0.4.0-dev へ上げる

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Step 2 の 2 行が一致する。`pnpm run test` が通る |
| 機械 | `git status --short plugins/prompt-smith/scripts` が空 |

---

### S1-2: `sandbox.ts` に一時 cwd の下層関数と祖先 `.claude` の検出を足す

設計書 §3.3 / §3.7。

**Files:**
- Modify: `plugins/prompt-smith/src/lib/sandbox.ts`
- Test: `plugins/prompt-smith/src/__test__/sandbox.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `function createIsolatedWorkspace(): Promise<Sandbox>` — `mkdtemp(join(tmpdir(), "prompt-smith-cwd-"))` を作って返す。`SKILL.md` を書かない
  - `createSandbox(skillMd, cleanName)` は `createIsolatedWorkspace` の結果へ `.claude/skills/<cleanName>/SKILL.md` を書き足すだけになる

**変更の要点**

- **`Sandbox` 型(L22-25)と `createSandbox` のシグネチャ(L132-146)を変えない。** 設定ディレクトリを作らない方式なので、第 3 版にあった `Workspace` 型は要らない。
- 祖先 `.claude` の検出に、設計書 §3.7 の 3 条件をすべて課す。**どれを外しても本番が動かなくなるか、既存テストが無効になる。**
  1. **走査の起点は、作った一時ディレクトリの「親」。自分自身を含めない。** self を含めると測定用の `.claude` 自身で throw し、本番の 60 spawn が 1 つも動かない。
  2. 比較は `realpath` で行う。
  3. **キャッシュのキーは `realpath(tmpdir())`。「このプロセスは安全」という boolean にしない。** boolean だと `pool: "forks"` の同一プロセスで、先の成功が後段の偽装テストを無効化する。
- throw するメッセージに、見つかった `.claude` の絶対パスと「`TMPDIR` を `.claude` を持たない場所へ変える」という対処を入れる。

- [ ] **Step 1: 失敗するテストを書く**

`src/__test__/sandbox.test.ts` へ次を足す。**既存 L184-199 は変えない。**

- `createIsolatedWorkspace` が一時ディレクトリを 1 つ作り、`SKILL.md` を書かない。
- `cleanup` でそのディレクトリが消える。
- `TMPDIR` をリポジトリ配下へ偽装したとき throw する。**既存 L184-199 のケースと同一ファイル(= 同一プロセス)で両方通ること。**

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/sandbox.test.ts`
Expected: FAIL(`createIsolatedWorkspace` が無い)

- [ ] **Step 3: 実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/sandbox.test.ts`
Expected: PASS。**既存ケースと新規の偽装ケースが同一実行で両方通る**

- [ ] **Step 5: ビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`
Expected: すべて成功

- [ ] **Step 6: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 測定用の一時 cwd を切り出し、祖先の .claude を検出する

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Step 4 が PASS。とくに同一プロセスでの 2 ケース同時通過 |
| 機械 | `pnpm run lint && pnpm run typecheck && pnpm run test` が通る |
| 機械 | `git status --short plugins/prompt-smith/scripts` が空(build 済み) |
| 人 | `Sandbox` 型と `createSandbox` のシグネチャが変わっていない |

---

### S1-3: `claude-cli.ts` に隔離フラグ・cwd・`close` 待ちを入れる

設計書 §3.2 / §3.3。**隔離の実体は argv にある。** このステップで入る `ISOLATION_ARGS` のテストが、隔離の回帰を防ぐ唯一の自動的な砦になる。

**Files:**
- Modify: `plugins/prompt-smith/src/lib/claude-cli.ts`
- Create: `plugins/prompt-smith/src/__test__/helpers/fake-child-process.ts`
- Test: `plugins/prompt-smith/src/__test__/claude-cli.test.ts`
- Modify: `plugins/prompt-smith/NOTICE`

**Interfaces:**
- Consumes: `createIsolatedWorkspace`(S1-2)
- Produces:
  - `const ISOLATION_ARGS` — `--setting-sources project` / `--strict-mcp-config` / `--settings '{"disableAllHooks":true}'` / `--no-session-persistence`
  - `function buildSpawnOptions(cwd: string, env?: NodeJS.ProcessEnv): { cwd: string; env: NodeJS.ProcessEnv }`
  - `function buildEvalArgs(query: string, model: string | undefined): string[]`
  - `function buildTextArgs(model: string | undefined): string[]`
  - `function killThenSettle(child: ChildProcess, settle: () => void): void`
  - `type SpawnFn` / `interface ClaudeTextDeps { spawn?: SpawnFn; createWorkspace?: () => Promise<Sandbox> }`
  - `callClaudeText(prompt, model, timeoutSeconds = 300, deps?)`

**変更の要点**

- **`buildEnv` は変えない。** `buildIsolatedEnv` を作らない。環境変数に足すものは無い。
- `buildSpawnOptions` は `Sandbox` ではなく **cwd の文字列**を取る。`claude-cli.ts` から `sandbox.ts` への型の依存を作らない。
- `--settings` の値は JSON 文字列を argv の 1 要素として渡す。`spawn` はシェルを経由しないので引用符を足さない。
- `buildEvalArgs` は `-p` / `--output-format stream-json` / `--verbose` / `--include-partial-messages` / `--model` の**現行の並びを変えず**、末尾に `ISOLATION_ARGS` を足す。
- `callClaudeText`:
  - 先頭で `createWorkspace()` を呼び、`try { … } finally { await workspace.cleanup() }` で包む。
  - **`stdio` を指定しない。** 既定の `pipe` を使う。プロンプトを stdin へ書く経路(現行 L84-85)があるため、測定側の `["ignore", "pipe", "ignore"]` を写すと動かなくなる。
  - タイムアウト時は `killThenSettle(child, () => reject(timeoutError))`。**`close` を待ってから reject し、`finally` の cleanup が待機の内側に入る。**
  - `error` イベントは `close` が来ないので即座に reject する。
  - `deps` は省略時に本番実装へ落ちる。`vi.mock` を使わない。
- `killThenSettle` は現行 `runSingleQuery` の `finish`(L83-88)と同じ判定を持つ。未終了なら `once("close")` を登録してから SIGKILL、終了済みなら即 `settle`。

- [ ] **Step 1: `fake-child-process.ts` を書く**

`spawn` の戻り値を模す最小の EventEmitter。`stdout` / `stderr` / `stdin`(`write` / `end`)、`kill`、`exitCode`、`signalCode` を持つ。**`kill` を呼んでも自動では `close` を出さず、テストが明示的に発火させる**(待機の有無を区別するため)。S1-5 の `run-trigger-eval.test.ts` からも使う。

- [ ] **Step 2: 失敗するテストを書く**

`src/__test__/claude-cli.test.ts` へ次を足す。

- `buildEvalArgs` / `buildTextArgs` が `ISOLATION_ARGS` の要素を**正しい順序と組で**含む(`--setting-sources` の値が `project`、`--settings` の値が `{"disableAllHooks":true}`、`--strict-mcp-config` と `--no-session-persistence` が付く)。`--model` の位置が変わらない。
- **`buildEnv` の結果に `CLAUDE_CONFIG_DIR` を足さない。**
- `buildSpawnOptions` が `cwd` に渡された文字列を返す。
- `killThenSettle` が未終了なら `close` を待ち、終了済みなら即座に settle する。
- `callClaudeText` が `stdio` を指定しない(stdin が書ける)。
- タイムアウト時に `close` を待ってから reject する。
- 正常時・reject 時のどちらでも `cleanup` が 1 回だけ呼ばれる。

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/claude-cli.test.ts`
Expected: FAIL

- [ ] **Step 4: 実装する**

- [ ] **Step 5: ファイル冒頭のコメントと `NOTICE` を更新する**

`NOTICE` の `improve_description.py -> src/improve-description.ts` の節と、`run_eval.py -> src/run-trigger-eval.ts` の節へ次を足す(設計書 §11.1)。

- 子プロセスを、専用の一時 cwd と `--setting-sources project` / `--strict-mcp-config` / `--settings '{"disableAllHooks":true}'` / `--no-session-persistence` で起動する。**上流は cwd も設定の読み込み元も絞らない。**
- 一時ディレクトリの削除を、子プロセスの `close` を待ってから行う。

- [ ] **Step 6: ビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`
Expected: すべて成功

- [ ] **Step 7: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts plugins/prompt-smith/NOTICE
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 改善案生成の子プロセスを一時 cwd と隔離フラグで起動する

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Step 2 の全ケースが PASS |
| 機械 | `pnpm run lint && pnpm run typecheck && pnpm run test` が通る |
| 機械 | `git status --short plugins/prompt-smith/scripts` が空 |
| 人 | `NOTICE` の変更点一覧に 2 項目が入っている |
| 人 | `buildEnv` のシグネチャと挙動が変わっていない |

---

### S1-4: `stream-parse.ts` に `readResultError` を足す

設計書 §3.3 / §3.4。**`TriggerDetector.push` と `judge` には手を触れない。**

**Files:**
- Modify: `plugins/prompt-smith/src/lib/stream-parse.ts`
- Test: `plugins/prompt-smith/src/__test__/stream-parse.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `function readResultError(line: string): string | null`

**変更の要点**

- `type === "result"` かつ `is_error === true` のときだけ文字列を返す。
- **`subtype` を判定に使わない。** 認証失敗時も `subtype` は `"success"` になる。
- 既存 L52-54(`result` を無条件に「発火しなかった」と確定させる箇所)には手を入れない。呼び出し側(S1-5)が `readResultError` を**先に**通すことで塞ぐ。

- [ ] **Step 1: 失敗するテストを書く**

- `is_error: true` の `result` 行で文字列を返す。
- `is_error: false` では `null` を返す。
- **`subtype: "success"` かつ `is_error: true` で文字列を返すことを、明示的に固定する。**
- `result` 以外の行では `null` を返す。壊れた JSON でも throw しない。

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/stream-parse.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: 既存ケースが無傷であることを確かめる**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/stream-parse.test.ts`
Expected: PASS。既存の `judge` / `TriggerDetector` のケースが 1 つも書き換わっていない

- [ ] **Step 5: ビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`

- [ ] **Step 6: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): result イベントの is_error を読み取る関数を足す

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | `subtype: "success"` かつ `is_error: true` で文字列が返るテストが PASS |
| 機械 | 既存の `stream-parse.test.ts` のケースが 1 つも変更されていない(`git diff` で確認) |
| 機械 | `pnpm run lint && pnpm run typecheck && pnpm run test` が通る |

---

### S1-5: `run-trigger-eval.ts` を 3 値化し、`errors` を集計する

設計書 §3.3 / §3.4。**このステップがいちばん壊しやすい。**

**Files:**
- Modify: `plugins/prompt-smith/src/run-trigger-eval.ts`
- Modify: `plugins/prompt-smith/src/lib/types.ts`
- Create: `plugins/prompt-smith/src/__test__/run-trigger-eval.test.ts`
- Modify: `plugins/prompt-smith/src/__test__/run-loop.test.ts`(fixture に `errors: 0`)
- Modify: `plugins/prompt-smith/src/__test__/generate-report.test.ts`(fixture に `errors`)
- Modify: `plugins/prompt-smith/NOTICE`

**Interfaces:**
- Consumes: `createSandbox`(S1-2)、`buildEvalArgs` / `buildSpawnOptions` / `killThenSettle`(S1-3)、`readResultError`(S1-4)
- Produces:
  - `interface RunSingleQueryOptions` — `query` / `skillName` / `skillContent` / `description` / `timeout` / `model` / `spawn?` / `createSandbox?`
  - `type QueryOutcome = { status: "triggered" } | { status: "not_triggered" } | { status: "error"; message: string }`
  - `export async function runSingleQuery(options: RunSingleQueryOptions): Promise<QueryOutcome>`
  - `function aggregateOutcomes(evalSet, jobs, outcomes, triggerThreshold): { results: EvalResultItem[]; errors: number }`
  - `class MeasurementFailedError extends Error` / `function assertMeasurable(results: EvalResultItem[]): void`
  - `runEval(options, deps?: { runSingleQuery?: typeof runSingleQuery })`
  - `EvalResultItem.errors`(必須)/ `EvalResult.errors`(必須)

**変更の要点**

- **`outcomes[index] ? 1 : 0` を残さない。** `QueryOutcome` は 3 値ともオブジェクトで**すべて truthy** である。この行を残すと `not_triggered` も `error` も発火として数えられ、**全問 100% 発火になる。型もテストも、この配線バグを自動では止めない。**
- `spawn` に渡す第 3 引数は `{ ...buildSpawnOptions(sandbox.dir), stdio: ["ignore", "pipe", "ignore"] }`。**`stdio` の現行指定を維持する。**
- ストリームの各行は、**`readResultError` を先に通してから** `detector.push` へ渡す。`null` でなければ `error` として確定させる。
- `finish` を `killThenSettle` の呼び出しへ置き換える。**cleanup を `finally` に置く現行の位置(L116-117)を動かさない。**
- 分類は設計書 §3.4 の表のとおり。**タイムアウトは `not_triggered` のまま変えない。**
- `assertMeasurable` は **1 問でも `runs === 0`(その問の全実行が `error`)のとき `MeasurementFailedError`** を投げる。部分失敗(3 回中 1 回)は投げず `errors` に残して続ける。
- `MeasurementFailedError` のメッセージに、**設定ファイルに依存する認証(`apiKeyHelper` / `awsAuthRefresh` / settings の `env`)を使っている場合は環境変数による認証へ切り替える**、という案内を含める(設計書 §3.6)。
- `runEval` は `pool` → `aggregateOutcomes` → `assertMeasurable` → 組み立て、の 4 手。`errors > 0` のときは stderr に警告を 1 行書く。
- **`EvalSummary` は変えない。** `RunEvalOptions` に DI の口を足さない。DI は `runEval` の**第 2 引数**に置く。

- [ ] **Step 1: 失敗するテストを書く**

`src/__test__/run-trigger-eval.test.ts`(新規)。`fake-child-process.ts` を使う。

- `runSingleQuery` が `spawn` へ渡す第 2 引数に `ISOLATION_ARGS` が入り、第 3 引数の `cwd` と `stdio` が期待どおり。
- **`is_error: true` の `result` 行が `{ status: "error" }` になる(`subtype: "success"` でも)。**
- `error` イベントと非ゼロ終了も `error` に、`is_error: false` の完走が `not_triggered` に、タイムアウトが `not_triggered` になる。
- 例外が出ても `sandbox.cleanup` が呼ばれ、それが `close` の後である。
- `aggregateOutcomes` が `error` を `runs` に数えず `errors` に数える。
- `assertMeasurable` が「1 問の全実行が error」で throw し、部分失敗では throw しない。
- **`runEval` の結合テスト**(第 2 引数で `runSingleQuery` を差し替え)。2 問 × 3 実行。1 問は `triggered` と `not_triggered` を混ぜ、もう 1 問は全実行を `error` にする。**truthy バグがあると `not_triggered` が発火として数えられ、`triggers` の期待値が合わずに落ちる。**

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/run-trigger-eval.test.ts`
Expected: FAIL

- [ ] **Step 3: `types.ts` に `errors` を足す**

`EvalResultItem.errors: number` と `EvalResult.errors: number` を**必須**にする。旧コードは `errors` を供給できないのでコンパイルが通らなくなる。

- [ ] **Step 4: `run-trigger-eval.ts` を実装する**

- [ ] **Step 5: 落ちた既存 fixture を直す**

`run-loop.test.ts` の `allPass` / `failing` / `mixed`(L76-92 ほか)と `generate-report.test.ts` L4-15 の fixture に `errors: 0` を足す。**`run-loop.test.ts` L30-45 の `selectBest` 3 ケースは変えない。変更が必要になったら確定事項に反した合図である。**

- [ ] **Step 6: 配線バグが止まることを実際に確かめる**

`runEval` の集計行を一時的に `outcomes[index] ? 1 : 0` へ戻し、結合テストが落ちることを見る。**確認したら戻す。** コミットしない。

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/run-trigger-eval.test.ts`
Expected: 一時改変で FAIL、戻して PASS

- [ ] **Step 7: `NOTICE` を更新する**

- 起動失敗を発火なしと区別して `errors` に記録する。**`result` イベントの `is_error` を見る(上流は `result` を無条件に「発火なし」とする)。** 1 問でも全実行が失敗したら結果を返さず失敗させる。

- [ ] **Step 8: ビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`

- [ ] **Step 9: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts plugins/prompt-smith/NOTICE
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 起動失敗を不発火と区別して errors に集計する

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | 新規テストの全ケースが PASS |
| 機械 | **Step 6 で、truthy バグを入れると結合テストが落ちる**ことを目視した |
| 機械 | `run-loop.test.ts` L30-45 が無変更(`git diff` で確認) |
| 機械 | `pnpm run lint && pnpm run typecheck && pnpm run test` が通る |
| 人 | `MeasurementFailedError` のメッセージに認証の案内が入っている |
| 人 | `EvalSummary` と `RunEvalOptions` が広がっていない |

---

### S1-6: `run-loop.ts` に `measurement_failed` を入れる

設計書 §3.4 末尾。

**Files:**
- Modify: `plugins/prompt-smith/src/run-loop.ts`
- Test: `plugins/prompt-smith/src/__test__/run-loop.test.ts`

**Interfaces:**
- Consumes: `MeasurementFailedError`(S1-5)
- Produces: `exit_reason` の新しい値 `measurement_failed (iteration N): <message>`

**変更の要点**

- `runEval` の呼び出し(L215-226)を `try` / `catch` で包み、`exit_reason` を `measurement_failed (iteration N): <message>` にして打ち切る。
- **`history` が空(= 反復 1 で失敗)のときは再 throw する。** `selectBest`(L79-86)は `reduce` に初期値を持たないため、空配列を渡すと TypeError になる。既存の `improve_failed` 経路(L320-329)も記録を push した後にしか起きないので、同じ形に揃う。

- [ ] **Step 1: 失敗するテストを書く**

- 反復 2 で `runEval` が throw したとき、`exit_reason` が `measurement_failed (iteration 2): …` になり、`best_description` が反復 1 のものになる。
- 反復 1 で throw したとき、`runLoop` 自体が throw する(`selectBest` に空配列を渡さない)。

- [ ] **Step 2: テストが落ちることを確かめる → 実装 → 通ることを確かめる**

Run: `pnpm exec vitest run plugins/prompt-smith/src/__test__/run-loop.test.ts`

- [ ] **Step 3: ビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`

- [ ] **Step 4: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 測定不能を打ち切り理由として記録する

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | 2 ケースが PASS |
| 機械 | `pnpm run lint && pnpm run typecheck && pnpm run test` が通る |

---

### S1-7: 隔離が効いていることを実機で確かめる

設計書 §3.9。**自動テストは `spawn` の引数を固定するだけで、CLI が実際に設定を読まないことは示さない。リポジトリを書き換える欠陥だったので、修正後は実機で確認する。**

#### 手順の組み替え(設計書 §3.9 からの意図的な変更)

設計書 §3.9 は、手順 1 で `git status` を控え、手順 2 で**隔離フラグ無しの対照**をリポジトリルートから叩き、手順 5 で手順 1 との完全一致を求める。**この順序のままでは合格できない。**

**手順 2 は、バックログ §1 が「Stop hook が発火して `docs/chat/` に 4 件作られた」と記録した条件そのものである。対照実行が、自分の合格条件(手順 5)を汚染する。** 書かれたとおりに踏むと手順 5 が必ず落ち、対照を省くか基準点を取り直すか生成物を消すかに流れ、**隔離の中心的な検証が成立しなくなる。**

設計書の意図(隔離の前後を比べる/リポジトリが無傷である)を保ったまま、4 相へ組み替える。

| 相 | 内容 | cwd | そこに置く根拠 |
| --- | --- | --- | --- |
| 1 | 対照実行(フラグ無し/有り)と `TMPDIR` ガードの確認 | **リポジトリ外**(`$PROBE_DIR`) | 対照が見ているのは**ユーザー層とプラグイン層**であり、この層は HOME 由来なので cwd を変えても比較は成立する。リポジトリ外で叩けばプロジェクト hooks が発火せず、リポジトリを汚さない |
| 2 | `git status --porcelain=v1` の基準点を取る | — | **基準点を対照の後ろへ移す。** 相 1 は我々のコードを通らない生の `claude -p` であり、隔離の実効を測る対象ではない |
| 3 | 我々のコードを通す確認(改善案生成の経路・陽性対照) | **リポジトリルート** | 設計書の前提どおり。コードが自分で一時 cwd へ逃がすので、隔離が効いていれば汚れない。**一時ディレクトリから起動すると、直っていなくても症状が出ない** |
| 4 | 照合(`git status` の完全一致・`~/.claude.json` の健全性・出力 JSON) | — | |

**相 1 の cwd をリポジトリ外にする理由はもう 1 つある。** このリポジトリは現在プロジェクトスキル(`.claude/skills/`)を持つ。リポジトリルートから対照を取ると件数にそれが混ざる。**リポジトリ外の空ディレクトリで両方を叩けば、差はユーザー層とプラグイン層だけになり、設計書 §1.3 が測ったものと同じ差になる。**

**Files:**
- Create: `plugins/prompt-smith/docs/measurement-2026-09-17.md`(**無ければ作成し、あれば節を追記する。** S4-4 が同じファイルを触る)
- Create(リポジトリ外・一時): `$PROBE_DIR/probe-skill/SKILL.md` / `$PROBE_DIR/probe-eval.json` / `$PROBE_DIR/probe-call.mts`

**Interfaces:**
- Consumes: S1-6 までのビルド済み `scripts/*.mjs`
- Produces: 実機確認の記録と、**S2-5 が再利用する probe 資産**

#### 相 1: 対照とガード(リポジトリ外)

- [ ] **Step 1: probe 資産を作る**

**すべてリポジトリの外に置く。** 測定の合格条件(`git status` の完全一致)を自分で壊さないためである。

```bash
export REPO=/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
export PROBE_DIR=~/prompt-smith-probe
mkdir -p "$PROBE_DIR/probe-skill" "$PROBE_DIR/empty-cwd"
```

`$PROBE_DIR/probe-skill/SKILL.md`:

```markdown
---
name: ps-isolation-probe
description: 依頼文に `ZZQPROBE` という語が含まれるときに必ず使用する。ZZQPROBE の点検・確認・報告・集計のすべてがこのスキルの担当である。他のどのスキルも ZZQPROBE を扱わない。
---

# ZZQPROBE の点検

- 依頼された ZZQPROBE の操作を行い、結果を 1 行で返す。
```

`$PROBE_DIR/probe-eval.json`(**3 問。`parseEvalSet` は問数を検査しないので 20 問は要らない**):

```json
[
  { "query": "ZZQPROBE の点検をお願いします。結果を 1 行で教えてください。", "should_trigger": true },
  { "query": "きのう仕込んだ ZZQPROBE、いまどうなってる? 集計まで見たい", "should_trigger": true },
  { "query": "ZZQPROBE の確認と報告をまとめてやってほしい", "should_trigger": true }
]
```

**`ZZQPROBE` という無意味な語を使うのは、CLI 組み込みスキル 17 件との競合を確実に無くすためである。** 陽性対照が「隔離が行き過ぎている」以外の理由で落ちる余地を消す。

- [ ] **Step 2: フラグの到達確認(対照。リポジトリ外)**

```bash
cd "$PROBE_DIR/empty-cwd"

count_skills() {
  claude -p "$@" --output-format stream-json --verbose "hi" 2>/dev/null \
    | head -1 \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s);console.log((e.skills??[]).length)})'
}

echo "control: $(count_skills)"
echo "isolated: $(count_skills --setting-sources project --strict-mcp-config --settings '{"disableAllHooks":true}' --no-session-persistence)"
ls -1 ~/.claude/skills/*/SKILL.md 2>/dev/null | wc -l
```

Expected:

- **隔離側が減る。** 設計書 §1.3 の実測は対照 25 → 隔離 17(**8 件減**)で、`~/.claude/skills/` の `SKILL.md` も 8 件だった。
- **合格条件は「減ること」と「隔離側が CLI 組み込みだけの件数(実測時点で 17)になること」の 2 つ。** 差が 8 件であることは参考値として記録する。
- **増減の内訳は問わない。** 設計書 §16 #17 のとおり、`init.skills` の減少分と `~/.claude/skills/` の一対一の出所同定は未完である。**件数だけを見る。**
- 減らなければフラグが効いていない。フラグの綴りと値、`--settings` の JSON が argv の 1 要素として渡っているかを疑う。

- [ ] **Step 3: `TMPDIR` ガードのライブ確認**(設計書 §14 項目 1)

**vitest の偽装(S1-2)とは別に、CLI 起動でも throw することを確かめる。** この検査は `createIsolatedWorkspace` の中で起きるので、**`claude` は 1 プロセスも起動しない。**

```bash
cd "$REPO"
mkdir -p "$REPO/.ps-tmpdir-probe"
TMPDIR="$REPO/.ps-tmpdir-probe" node plugins/prompt-smith/scripts/run-trigger-eval.mjs \
  --skill-path "$PROBE_DIR/probe-skill" \
  --eval-set "$PROBE_DIR/probe-eval.json" \
  --model sonnet --runs-per-query 1
echo "exit=$?"
rm -rf "$REPO/.ps-tmpdir-probe"
```

Expected: 終了コードが 1。stderr に**見つかった `.claude` の絶対パス**と `TMPDIR` を変える対処が出る。`claude` のプロセスが起動していない。

**後始末を必ず行う。** `.ps-tmpdir-probe` は未追跡ディレクトリなので、残すと相 2 の基準点に入り込む。

#### 相 2: 基準点

- [ ] **Step 4: 事前の控えを取る**

```bash
cd "$REPO"
git status --porcelain=v1 > "$PROBE_DIR/git-before.txt"
cp ~/.claude.json "$PROBE_DIR/claude-json-before.json"
ls -1 ~/.claude/backups/ | wc -l > "$PROBE_DIR/backups-before.txt"
claude --version > "$PROBE_DIR/cli-version.txt"
```

Expected: `git-before.txt` に `.ps-tmpdir-probe` が入っていない(Step 3 の後始末ができている)。

#### 相 3: 我々のコードを通す(リポジトリルート)

- [ ] **Step 5: 改善案生成の経路の再現確認**

**`improve-description.mjs` のバンドルは `callClaudeText` を再エクスポートしないので、バンドル越しに任意のプロンプトを流せない。** ソースを直接叩く。**cwd はリポジトリルートにする**(そうでないと、直っていなくても症状が出ない)。

`$PROBE_DIR/probe-call.mts`:

```ts
import { callClaudeText } from "/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/prompt-smith/src/lib/claude-cli.ts"

const out = await callClaudeText(
  "次の行をそのまま 1 行だけ出力せよ。他には何も書くな。\n<probe>OK</probe>",
  "sonnet",
  120
)
process.stdout.write(`--- BEGIN ---\n${out}\n--- END ---\n`)
```

```bash
cd "$REPO"
pnpm exec tsx "$PROBE_DIR/probe-call.mts"
```

Expected: 出力が `<probe>OK</probe>` だけである。**バックログ §1 が観測した「SessionStart hook の通知への応答」が混ざらない。** 混ざるなら `--settings '{"disableAllHooks":true}'` が argv の扱いで壊れている(`-p` は validation に失敗した settings を**黙って無視する**)。

- [ ] **Step 6: 陽性対照**

設計書 §15 は、この手順を「**権限ルールの消失と第 1 ツール打ち切りの合成**に対する唯一の検出口」と位置づけている。省略しない。

```bash
cd "$REPO"
node plugins/prompt-smith/scripts/run-trigger-eval.mjs \
  --skill-path "$PROBE_DIR/probe-skill" \
  --eval-set "$PROBE_DIR/probe-eval.json" \
  --model sonnet --runs-per-query 1 \
  --out "$PROBE_DIR/probe-result.json"
```

Expected: **`summary.passed` が 3、`summary.failed` が 0、各問の `trigger_rate` が 1.0(3 実行が 3 とも発火)。** 1 問でも落ちたら**隔離が行き過ぎている。** 疑う順は「`--setting-sources` の値(`project` か)→ cwd が一時ディレクトリか → CLI 版 → **`--verbose` で LS / Bash / Read が先に出ていないか**」。

**`--model sonnet` を明示的に渡す。** S1-7 は S2-1(既定モデルの導入)より前にあるため、省略すると `environment.model` が `null` になり Step 8 の確認が成立しない。

#### 相 4: 照合

- [ ] **Step 7: リポジトリが無傷であることを確かめる**

```bash
cd "$REPO"
git status --porcelain=v1 > "$PROBE_DIR/git-after.txt"
diff "$PROBE_DIR/git-before.txt" "$PROBE_DIR/git-after.txt"
```

Expected: **差分なし。** `docs/chat/` に新規ファイルが無い。**これが新方式の中心的な合格条件である。**

- [ ] **Step 8: `~/.claude.json` と出力 JSON を見る**

- `~/.claude.json` が **JSON としてパースできる。** `.claude.json.tmp.*` や破損ファイルの残骸が無い。**内容が変わっていること自体は正常である**(設計書 §3.6)。
- `probe-result.json` の `errors` が **0**。`environment` の 3 キーが載り、`model` が `"sonnet"`、トークンの値が入っていない。0 でないときは設計書 §3.4 の分類を見て、認証失敗と発火失敗を取り違えていないかを確かめる。
- `~/.claude/backups/` の件数を控えと比べる(設計書 §3.6 の運用注意)。

- [ ] **Step 9: 記録を書く**

`plugins/prompt-smith/docs/measurement-2026-09-17.md` に `## 隔離の実機確認(段 1)` の節を作り、9 手順の観測値を残す。**ファイルが無ければ作成し、あれば節を追記する**(S4-4 が同じファイルへ別の節を書く)。

記録する値: 対照/隔離の `init.skills` 件数と差、`~/.claude/skills/` の件数、`claude --version`、`git status` の一致、`~/.claude/backups/` の前後、`probe-result.json` の `summary` と `errors`。

- [ ] **Step 10: Commit**

```bash
git add plugins/prompt-smith/docs/measurement-2026-09-17.md
git commit -m "$(cat <<'EOF'
docs(prompt-smith): 隔離の実機確認の結果を記録する

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**`$PROBE_DIR` は消さない。S2-5 が再利用する。**

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Step 2 で隔離側の件数が減り、**CLI 組み込みだけの件数(実測時点で 17)**になる。内訳は問わない |
| 機械 | Step 3 が終了コード 1 で、stderr に `.claude` の絶対パスが出る。`claude` が起動していない |
| 機械 | Step 4 の `git-before.txt` に `.ps-tmpdir-probe` が無い |
| 機械 | Step 7 の `diff` が空 |
| 機械 | Step 8 で `~/.claude.json` がパースでき、残骸が 0 件。`errors` が 0。`environment.model` が `"sonnet"` |
| 機械 | Step 6 が `summary.passed === 3` / `failed === 0` |
| 人 | Step 5 の出力が `<probe>OK</probe>` だけで、hook の通知への応答を含まない |

**ここが落ちたら段 5 へ進まない。** 対処は「ロールバックの手順」の §A を見る。

---

### S1-8: `SKILL.md` の測定の規律を隔離後の前提へ改める

設計書 §10.3。**項目 1 の追随そのものである。** 段 6 に置くと、隔離済みの測定器に対して隔離前提の比較規律が残る。

**このステップは AI 向けの指示書の編集である。`prompt-smith:prompt-smith` を使用し、その規律に従う。**

**Files:**
- Modify: `plugins/prompt-smith/skills/skill-creator/SKILL.md`(L219-225)

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: `prompt-smith:prompt-smith` をロードする**

- [ ] **Step 2: L223 を書き換える**

現行は「有効なプラグインやユーザースキルが変わった後の値を、変わる前の値と比べない」。項目 1 でこの前提が消える。**残るのは CLI の版・組み込みスキル・モデルの解決先であり、これらが変わった後の値を前の値と比べない**、とする。

- [ ] **Step 3: 4 行を足す**

- `errors` が 0 でない測定の結果は比較に使わない。原因を直して測り直す。
- `environment` は文字列として比べる。`sonnet` と `claude-sonnet-5` を同じものとして扱わない。
- `--model` は毎回同じ書き方で渡す。
- 既定モデルを変えた後、eval の問を差し替えた後は、それ以前の値を捨ててベースラインを取り直す。

- [ ] **Step 4: 変えない行を確かめる**

L221 / L222 / L224 / L225 は変えない。**「測定は隔離した一時環境で行う」は本文に書かない**(測定器の実装が担保するものであり、スキルを使う側の動きを変えない)。

- [ ] **Step 5: 自己評価**

`prompt-smith:prompt-smith` の 3 軸(冗長度・充足度・スタイル適合)で見る。設計書が挙げる根拠・実測値を本文へ持ち込んでいないことを確かめる。

- [ ] **Step 6: Commit**

```bash
git add plugins/prompt-smith/skills/skill-creator/SKILL.md
git commit -m "$(cat <<'EOF'
docs(prompt-smith): 測定の規律を隔離後の前提へ改める

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | L221 / L222 / L224 / L225 に相当する行が無変更(`git diff` で確認) |
| 人 | `prompt-smith` の 3 軸で問題が無い |
| 人 | 実測値・根拠・出典が本文に入っていない |

---

# 段 2: 結果記録と CLI の揃え

---

### S2-1: `defaults.ts` を新設し、`--model` の既定を `sonnet` にする

設計書 §5。**既定の適用はライブラリ関数の側で行う。`main` だけで当てると、ライブラリ経路で `undefined` が残り、測定が黙ってユーザー設定のモデル(多くの環境で opus 系)へ落ちる。**

**Files:**
- Create: `plugins/prompt-smith/src/lib/defaults.ts`
- Modify: `plugins/prompt-smith/src/run-trigger-eval.ts` / `src/run-loop.ts` / `src/improve-description.ts`
- Modify: `plugins/prompt-smith/src/lib/types.ts`
- Test: `plugins/prompt-smith/src/__test__/run-loop.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `DEFAULT_MODEL = "sonnet"` / `DEFAULTS`(`runsPerQuery: 3` / `numWorkers: 10` / `timeout: 30` / `triggerThreshold: 0.5` / `holdout: 0.4` / `maxIterations: 5` / `improveTimeout: 300`)

**変更の要点**

- **`LENGTH_TARGET` / `LENGTH_FLOOR` / `byteLength` はここでは作らない。** S3-2 で同じファイルへ足す(使うステップで足し、未使用の定数を置かない)。
- `run-loop` L418 と `improve-description` L382 の `--model` 必須チェックを外す。
- `runEval` / `runLoop` / `improveDescription` の分割代入で `model = DEFAULT_MODEL` とする。`main` は `values.model` をそのまま渡す。
- `RunLoopOptions.model` を `model?: string` にし、`RunEvalOptions.model?: string` と揃える。
- `parseNumericOption` の呼び出し側(`run-trigger-eval.ts` L266-283、`run-loop.ts` L473-498)と `runLoop` の分割代入(L178-184)が、すべて `DEFAULTS` を参照する。**数値既定の値そのものは変えない。**

- [ ] **Step 1: 失敗するテストを書く**

- `runLoop` / `runEval` / `improveDescription` を `model` 無しで直接呼ぶと `sonnet` が使われる。
- `environment.model` が `null` にならない。

- [ ] **Step 2: テストが落ちることを確かめる → 実装 → 通ることを確かめる**

- [ ] **Step 3: スモークテストが壊れていないことを確かめる**

`bundle-cli-smoke.test.ts` の既存 3 ケースは、`--model` のチェックが他の必須チェックより後ろにあるため壊れない(設計書 §6.2)。壊れたらそれは想定外であり、原因を調べる。

Run: `pnpm run build && pnpm exec vitest run plugins/prompt-smith/src/__test__/bundle-cli-smoke.test.ts`
Expected: PASS

- [ ] **Step 4: ビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`

- [ ] **Step 5: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): --model の既定を sonnet にし、既定値を defaults へ集約する

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | `model` 無しの直接呼び出しで `sonnet` になるテストが PASS |
| 機械 | スモークの既存 3 ケースが PASS |
| 機械 | `grep -rn "model is required" plugins/prompt-smith/src` が 0 件 |
| 機械 | `pnpm run lint && pnpm run typecheck && pnpm run test` が通る |
| 人 | 数値既定の値が 1 つも変わっていない |

---

### S2-2: `run-loop` の結果に `environment` を記録する

設計書 §4。

**Files:**
- Modify: `plugins/prompt-smith/src/lib/types.ts` / `src/run-loop.ts`
- Test: `plugins/prompt-smith/src/__test__/run-loop.test.ts` / `src/__test__/generate-report.test.ts`
- Modify: `plugins/prompt-smith/NOTICE`

**Interfaces:**
- Consumes: `describeEnvironment`(既存)
- Produces: `LoopResult.environment: Environment`

**変更の要点**

- `LoopResult`(`types.ts` L61-74)に `environment` を足す。**位置は `exit_reason` の直後**とし、`EvalResult` の並び(`skill_name` / `description` / `environment`)と読み口を揃える。
- `runLoop`(L171-360)の冒頭で `describeEnvironment(model)` を**1 回だけ**呼び、`makeLoopResult`(L98-129)へ引数で渡す。反復ごとの `onIteration`(L258-269)にも同じ値が載る。
- **トークンやキーの値は記録しない**(3 キーは `base_url` / `auth_source` / `model`)。
- `generate-report.ts` は**変更しない。** 表示項目を増やすのは要件の外。ただし `LoopResult` が必須キーを増やすので `generate-report.test.ts` L4-15 の fixture に `environment` を足す。

- [ ] **Step 1: 失敗するテストを書く → 実装 → 通ることを確かめる**

- [ ] **Step 2: `NOTICE` を更新する**(設計書 §11.1 の 9 行目)

**`NOTICE` の既存の項目 5(`environment` を記録する)は `run_eval.py -> src/run-trigger-eval.ts` の節にあり、`run-loop` の話ではない。** `run_loop.py -> src/run-loop.ts` の節へ**新しい番号の項目**として足す(現在この節は 9 と 13 を持つので、次に空いている番号を使う)。

- 結果 JSON に `environment` を記録する。上流は記録しない。

**このステップを落とすと Apache-2.0 §4(b) の通知が `run-loop` の挙動変更に対して欠ける。**

- [ ] **Step 3: ビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`

- [ ] **Step 4: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts plugins/prompt-smith/NOTICE
git commit -m "$(cat <<'EOF'
feat(prompt-smith): run-loop の結果に environment を記録する

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | `LoopResult` に 3 キーが載るテストが PASS |
| 機械 | 結果 JSON にトークンの値が含まれないことを assert している |
| 機械 | `pnpm run lint && pnpm run typecheck && pnpm run test` が通る |

---

### S2-3: 3 エントリに `--help` を足す

設計書 §6。

**Files:**
- Create: `plugins/prompt-smith/src/lib/cli-help.ts`
- Create: `plugins/prompt-smith/src/__test__/cli-help.test.ts`
- Modify: `plugins/prompt-smith/src/run-trigger-eval.ts` / `src/run-loop.ts` / `src/improve-description.ts`
- Modify: `plugins/prompt-smith/src/__test__/bundle-cli-smoke.test.ts`

**Interfaces:**
- Consumes: `DEFAULTS` / `DEFAULT_MODEL`(S2-1)
- Produces: `interface HelpOption` / `interface HelpSpec` / `function renderHelp(spec: HelpSpec): string`

**変更の要点**

- 各エントリは自分の `HelpSpec` を定義し、`defaultValue` には `DEFAULTS` / `DEFAULT_MODEL` の値を**文字列リテラルで書かず参照で**入れる。
- `main` の先頭、`parseArgs` の直後・**必須チェックの前**に `if (values.help) { process.stdout.write(renderHelp(spec)); return }` を置く。
- 出力は stdout、終了コードは 0。各エントリの `options` に `help: { type: "boolean", default: false }` を足す。**短縮形(`-h`)は足さない。**
- **`--help` は単独指定でのみ動く。** `parseArgs` を 2 度呼ぶ作りにしない。
- スモークへ `runWithArguments(name, args): { stdout, stderr, status }` を足す。**`scripts/` を再生成しないとこのテストは落ちる。ビルドを先に実行する。**

- [ ] **Step 1: `cli-help.test.ts` を書く(`renderHelp` の純関数テスト)**

- [ ] **Step 2: 実装する**

- [ ] **Step 3: ビルドしてからスモークのケースを足す**

Run: `pnpm run build`

追加するケース:
- 3 本それぞれに `--help` を渡すと終了コード 0 で stdout に usage が出て、stderr が空になる。
- help の本文に自分のエントリ名が含まれ、**他エントリの必須フラグ文言(`--eval-results` / `--eval-set`)が含まれない。** `isDirectRun` のファイル名ディスパッチが help でも効いていることを確かめる。

- [ ] **Step 4: ビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`

- [ ] **Step 5: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 3 エントリに --help を足す

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | 3 本とも `--help` で終了コード 0、stdout に usage、stderr が空 |
| 機械 | 他エントリの必須フラグ文言を含まない |
| 機械 | 既定値の表示が `DEFAULTS` の値と一致する |
| 機械 | `pnpm run lint && pnpm run typecheck && pnpm run test` が通る |

---

### S2-4: README と `SKILL.md` L62-85 を段 2 の変更へ追随させる

設計書 §10.4 / §10.5。

**`SKILL.md` の編集は `prompt-smith:prompt-smith` を使用する。**

**Files:**
- Modify: `plugins/prompt-smith/README.md`(L17-22 の CLI 引数表)
- Modify: `plugins/prompt-smith/skills/skill-creator/SKILL.md`(L62-85)

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: `plugins/prompt-smith/README.md` の引数表を直す**

| 行 | 変更 |
| --- | --- |
| `run-trigger-eval` の行 | 任意の並びに `--help` を足す |
| `improve-description` の行 | `--model` を**必須から任意へ移す**。`--help` を足す |
| `run-loop` の行 | `--model` を**必須から任意へ移す**。`--help` を足す |

**`--model` を省略したときの既定(`sonnet`)は 1 箇所にまとめて書き、3 行に繰り返さない。**

- [ ] **Step 2: `MeasurementFailedError` の案内を README に 1 行書く**

設定ファイルに依存する認証(`apiKeyHelper` / `awsAuthRefresh` / settings の `env`)を使っている環境では測定が通らないこと、環境変数による認証へ切り替えること(設計書 §3.6)。**`--help` には載せない。**

- [ ] **Step 3: `SKILL.md` L62-85 を直す**

- L65-72 のコマンド例から `--model "<model-id>"` を必須の並びから外す。
- 既定を上書きしたいときだけ `--model` を渡す、という 1 行を足す。
- `--help` で一覧と既定値を出せる、という 1 行を足す。

- [ ] **Step 4: Commit**

```bash
git add plugins/prompt-smith/README.md plugins/prompt-smith/skills/skill-creator/SKILL.md
git commit -m "$(cat <<'EOF'
docs(prompt-smith): --model の既定と --help を README と SKILL.md へ反映する

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | README の引数表に `--model` が必須として残っていない |
| 人 | 既定値の記述が 1 箇所にまとまっている |
| 人 | `prompt-smith` の 3 軸で問題が無い |

---

### S2-5: 3 エントリを `--model` 無しでライブ起動して確かめる

設計書 §14 の項目 3・4 は「**3 エントリを `--model` 無しで起動**。加えて `runLoop` / `runEval` / `improveDescription` を `model` 無しで直接呼ぶ単体テスト」を求める。**S2-1 が満たすのは後半だけである。**

**スモークテスト(`bundle-cli-smoke.test.ts`)は引数なしで起動するので、`--model` より前にある他の必須チェックに当たって落ちる。`main` が `values.model` をそのまま渡す経路は、ライブ起動でしか通らない。**

**Files:**
- 変更なし(確認のみ)

**Interfaces:**
- Consumes: S1-7 が作った `$PROBE_DIR` の probe 資産、S2-3 までのビルド済み `scripts/*.mjs`
- Produces: なし

**このステップは `claude -p` を 7 回ほど呼ぶ。** probe の 3 問を 2 回(`run-trigger-eval` と `run-loop`)と、改善案生成を 1 回である。**段 1 の隔離が効いているので、リポジトリは汚れない。**

- [ ] **Step 1: 事前の控えを取る**

```bash
export REPO=/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
export PROBE_DIR=~/prompt-smith-probe
cd "$REPO"
git status --porcelain=v1 > "$PROBE_DIR/git-before-s2-5.txt"
```

- [ ] **Step 2: `run-trigger-eval` を `--model` 無しで起動する**

```bash
node plugins/prompt-smith/scripts/run-trigger-eval.mjs \
  --skill-path "$PROBE_DIR/probe-skill" \
  --eval-set "$PROBE_DIR/probe-eval.json" \
  --runs-per-query 1 \
  --out "$PROBE_DIR/s2-5-eval.json"
```

Expected: 起動する。`environment.model` が **`"sonnet"`**(`null` ではない)。`errors` が 0。

- [ ] **Step 3: `run-loop` を `--model` 無しで起動する**

```bash
node plugins/prompt-smith/scripts/run-loop.mjs \
  --eval-set "$PROBE_DIR/probe-eval.json" \
  --skill-path "$PROBE_DIR/probe-skill" \
  --runs-per-query 1 --holdout 0 --max-iterations 1 --report none \
  > "$PROBE_DIR/s2-5-loop.json"
```

Expected: `--model is required` で落ちない。`environment.model` が **`"sonnet"`**。probe は全問通るので `exit_reason` が `all_passed (iteration 1)` になり、**改善案生成は呼ばれない**(このステップの費用を抑えるために `--holdout 0` と `--max-iterations 1` を使う)。

- [ ] **Step 4: `improve-description` を `--model` 無しで起動する**

```bash
node plugins/prompt-smith/scripts/improve-description.mjs \
  --eval-results "$PROBE_DIR/s2-5-eval.json" \
  --skill-path "$PROBE_DIR/probe-skill" \
  --log-dir "$PROBE_DIR/s2-5-logs" --iteration 1 \
  > "$PROBE_DIR/s2-5-improve.json"
```

Expected: `--model is required` で落ちない。`<new_description>` を含む応答が 1 回で得られ、stdout に `description` が出る。

**`improve-description` の出力は `environment` を持たない。** ここで確かめるのは「必須チェックが外れ、既定が当たって起動する」ことであり、既定値そのものは S2-1 の単体テストが固定している。

- [ ] **Step 5: リポジトリが無傷であることを確かめる**

```bash
git status --porcelain=v1 | diff "$PROBE_DIR/git-before-s2-5.txt" -
```

Expected: **差分なし。**

- [ ] **Step 6: 観測値を記録に足す**

`plugins/prompt-smith/docs/measurement-2026-09-17.md` の `## 隔離の実機確認(段 1)` の下へ、`### 既定モデルのライブ確認(段 2)` として 3 エントリの結果を 3 行で足す。

- [ ] **Step 7: Commit**

```bash
git add plugins/prompt-smith/docs/measurement-2026-09-17.md
git commit -m "$(cat <<'EOF'
docs(prompt-smith): 既定モデルのライブ確認の結果を記録する

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | 3 本とも `--model is required` で落ちない |
| 機械 | `run-trigger-eval` と `run-loop` の `environment.model` が `"sonnet"` |
| 機械 | `errors` が 0 |
| 機械 | Step 5 の `diff` が空 |
| 人 | `improve-description` が `<new_description>` を返した |

---

# 段 3: 打ち切り条件と長さの予算

---

### S3-1: 打ち切り条件を OR にし、train 空を拒否する

設計書 §7。**`selectBest`(L79-86)を変更しない。**

**Files:**
- Modify: `plugins/prompt-smith/src/run-loop.ts`
- Test: `plugins/prompt-smith/src/__test__/run-loop.test.ts`
- Modify: `plugins/prompt-smith/NOTICE`

**Interfaces:**
- Consumes: なし
- Produces: `exit_reason` の新しい値 `holdout_maxed (iteration N)`

**変更の要点**

```ts
if (record.train_failed === 0) {
  exitReason = `all_passed (iteration ${iteration})`
  break
}
if (testSet.length > 0 && record.test_failed === 0) {
  exitReason = `holdout_maxed (iteration ${iteration})`
  break
}
```

- 論理的には `train_failed === 0 || (hasTestSet && test_failed === 0)`。**`exit_reason` を分けるために 2 つの guard として書く。** `all_passed` は現行と同じ条件・同じ意味を保つ。
- `runLoop` の反復に入る**前**に、`splitEvalSet` の結果 `trainSet.length === 0` を拒否する guard を置く。`--holdout` を下げるか問を増やすよう促すメッセージで throw する。**黙って反復 1 で `all_passed` と称して停止する既存の挙動を、意図的に変える。**

- [ ] **Step 1: 失敗するテストを書く**

| 検証 | 内容 |
| --- | --- |
| **Case A の停止** | train 満点・test 未満点 → 反復 1 で停止、`exit_reason` が `all_passed`、`improveDescription` が呼ばれない。**既存 L94-111 は Case C(両方満点)なのでこれを検出しない** |
| **Case B の停止** | train 未満点・test 満点 → 反復 1 で停止、`exit_reason` が `holdout_maxed` |
| Case B の best 不変 | test 満点に達した反復より後に、より高い train を出す反復が続く履歴でも、`best_description` が最初に test 満点へ達した反復のものになる |
| Case D の継続 | 両方未満点 → `max_iterations` まで回る |
| `holdout: 0` の退化 | test 無しのとき `train_failed === 0` で `all_passed` になる |
| train が空 | `holdout` を大きくして train が空になる eval で throw する |

- [ ] **Step 2: テストが落ちることを確かめる → 実装 → 通ることを確かめる**

- [ ] **Step 3: `selectBest` の 3 ケースが無傷であることを確かめる**

Run: `git diff plugins/prompt-smith/src/__test__/run-loop.test.ts`
Expected: L30-45 相当の `selectBest` 3 ケースに変更が無い。**変更が入っていたら要件違反の合図であり、実装を見直す。**

- [ ] **Step 4: `NOTICE` を更新する**

- 打ち切り条件に「holdout が全問合格」を加える。上流は train の全問合格だけを見る。
- holdout により train が空になる構成を拒否する。

- [ ] **Step 5: ビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`

- [ ] **Step 6: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts plugins/prompt-smith/NOTICE
git commit -m "$(cat <<'EOF'
feat(prompt-smith): holdout 満点でも改善ループを打ち切る

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Case A / B / D / `holdout: 0` / train 空の 5 ケースが PASS |
| 機械 | Case B で `best_description` が現行実装と一致する |
| 機械 | `selectBest` の実装とその 3 ケースが無変更 |
| 機械 | `pnpm run lint && pnpm run typecheck && pnpm run test` が通る |

---

### S3-2: 長さの予算(UTF-8 バイト)を改善プロンプトへ入れる

設計書 §8。

**Files:**
- Modify: `plugins/prompt-smith/src/lib/defaults.ts`(`LENGTH_TARGET` / `LENGTH_FLOOR` / `byteLength` を追加)
- Modify: `plugins/prompt-smith/src/improve-description.ts`
- Modify: `plugins/prompt-smith/src/run-loop.ts`
- Test: `plugins/prompt-smith/src/__test__/improve-description.test.ts` / `src/__test__/run-loop.test.ts`
- Modify: `plugins/prompt-smith/NOTICE`

**Interfaces:**
- Consumes: `selectBest`(既存)
- Produces: `LENGTH_TARGET = 600` / `LENGTH_FLOOR = 680` / `byteLength(value: string): number` / `ImprovePromptInput.budget: number`(**必須**)

**変更の要点**

- `byteLength` は `Buffer.byteLength(value, "utf8")`。**`String.length` で description の長さを測る箇所を `src/` に 1 つも残さない。** 混在すると英語 description だけ予算が 3 倍近く厳しくなる。
- 予算の算出は `Math.max(byteLength(best.description), LENGTH_FLOOR)`。`best` は `selectBest(history, testSet.length > 0)` の結果。**最新ではない。**
- **`budget` は `ImprovePromptInput` の必須フィールドにする。** 省略時に `currentDescription` の長さへ落ちるフォールバックを置かない。置くと `runLoop` が渡し忘れたときに「最新を追う」経路が黙って再開する。
  - `runLoop`: `Math.max(byteLength(selectBest(history, hasTestSet).description), LENGTH_FLOOR)`
  - `improve-description` 単独 CLI: `Math.max(byteLength(evalResults.description), LENGTH_FLOOR)`
- `buildImprovePrompt` は **L159 の 1 行だけ**を差し替える。伝えるのは次の 4 点。
  1. 現行 description のバイト数(`byteLength(currentDescription)`)
  2. 新しい案が超えてはならないバイト数(`budget`)
  3. 目標とするバイト数(`LENGTH_TARGET`)
  4. 失敗を埋めるとき、節を**足す**のではなく既存の節を言い換える・統合する・削ることで賄うこと
  - **単位が UTF-8 バイト数であることを明示し、英語ならバイト数と文字数がほぼ一致し日本語なら 1 字が約 3 バイトになる、という換算を 1 文添える。**
  - **「短い方が強い」という主張は書かない。** 段 5 で反転したときにプロンプト本文の撤回が要る。数値だけを渡す。
- L154-157 の段落、L161-165 の 4 つの tips は変更しない。**L167 行末の `${" "}` を落とさない。**
- `buildShortenPrompt`: 本文の `1024` を `budget` に差し替え、**単位がバイト数であることを明示**し、「削る・統合する方を、言い回しの圧縮より先に試す」を足す。
- **再依頼は 1 回だけ、という移植元の挙動を変えない。** 2 回目もなお超過ならそのまま採用して測る。
- `--max-chars` のようなオプションを足さない。

#### `improve-description.ts` の `description.length` は 4 箇所ある。すべて直す

**設計書 §8.4 は L322 の `over_limit` と L330 の閾値しか名指ししていないが、同じ関数に長さを測る箇所が 4 つある。2 つだけ直すと、同じ transcript の中で文字とバイトが混ざる。**

| 行 | 現行 | 改修後 |
| --- | --- | --- |
| L321 | `transcript.char_count = description?.length ?? null` | `transcript.byte_count = description !== null ? byteLength(description) : null` |
| L322 | `transcript.over_limit = description !== null && description.length > 1024` | `… && byteLength(description) > budget` |
| L330 | `if (description.length > 1024) {` | `if (byteLength(description) > budget) {` |
| L350 | `transcript.rewrite_char_count = shortened?.length ?? null` | `transcript.rewrite_byte_count = shortened !== null ? byteLength(shortened) : null` |

**キー名を `char_count` → `byte_count` / `rewrite_char_count` → `rewrite_byte_count` へ変える。** 設計書 §15 は段 5 で `improve_iter_*.json` の往復を読むと定めており、**バイト数を保持するキーが `char_count` のままだと読み手が単位を取り違える。** 変えても壊れるものは無い(`char_count` を読むコードは `src/` にも `scripts/` にも無く、書き込み側 2 箇所だけである)。

**`budget` の値を transcript へ別途足さない。** `transcript.prompt` が改善プロンプト全文を保持しており、S3-2 の変更によりその本文に予算のバイト数が明示されるので、**`over_limit` の基準値は transcript だけから復元できる。**

- [ ] **Step 1: 失敗するテストを書く**

`improve-description.test.ts` L74-85(`"1024 characters"` / `"100-200 words"` を assert)を次へ置き換える。

| 検証 | 内容 |
| --- | --- |
| 現行バイト数の明示 | 出力に `byteLength(currentDescription)` の値が含まれる |
| 予算の明示 | 出力に `budget` の値が含まれ、「超えない」趣旨の指示と**単位がバイト数である旨**が付く |
| 目標の明示 | 出力に `LENGTH_TARGET`(600)の値が含まれる |
| 旧文言の消去 | `"100-200 words"` と `"1024 characters"` を含まない |
| 行末の空白 | L167 に当たる行が、**末尾の半角スペースを保ったまま**出力に現れる |
| 短縮経路の閾値 | 予算 + 1 **バイト**の案で `buildShortenPrompt` が 1 回だけ走り、予算ちょうどの案では走らない |
| 再依頼の回数 | 2 回目も超過のとき、そのまま採用して 3 回目を呼ばない |
| **予算が最良に紐づくこと** | `runLoop` が渡す `budget` が、最新ではなく `selectBest` の結果のバイト数に `LENGTH_FLOOR` を下限として当てた値。**最新の案がより長い履歴で固定する** |
| **床が効くこと** | 最良 description が `LENGTH_FLOOR` より短いとき、`budget` が `LENGTH_FLOOR` になる |
| **言語非依存** | 日本語 300 字(900 バイト)と英語 900 字(900 バイト)の description が**同じ `budget` を得る。** `String.length` を使っていると前者が 300、後者が 900 になって落ちる |

- [ ] **Step 2: テストが落ちることを確かめる → 実装 → 通ることを確かめる**

- [ ] **Step 3: `String.length` の残存を確かめる**

Run:
```bash
grep -rn "description\.length\|description?\.length\|shortened?\.length" plugins/prompt-smith/src --include=*.ts
grep -rn "char_count" plugins/prompt-smith/src --include=*.ts
```
Expected: どちらも **0 件。** 上の 4 箇所がすべて `byteLength` とバイト基準のキー名へ移っている。**配列の `.length` は対象外なので、この grep は description を名指しする形に限定してある。**

- [ ] **Step 4: `NOTICE` を更新する**

- 長さの指示を、最良 description の **UTF-8 バイト数**を予算とする方式へ差し替える。上流の「100-200 words / 1024 characters」は使わない。

- [ ] **Step 5: ビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`

- [ ] **Step 6: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts plugins/prompt-smith/NOTICE
git commit -m "$(cat <<'EOF'
feat(prompt-smith): 改善案の長さを最良 description のバイト数で縛る

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Step 1 の全検証が PASS |
| 機械 | `grep -rn "1024 characters\|100-200 words" plugins/prompt-smith/src` が 0 件 |
| 機械 | **Step 3 の 2 つの grep がどちらも 0 件**(4 箇所すべてがバイト基準へ移っている) |
| 機械 | `${" "}` の行が出力に残るテストが PASS |
| 機械 | `pnpm run lint && pnpm run typecheck && pnpm run test` が通る |
| 人 | `budget` にフォールバックが無い(必須フィールドである) |
| 人 | プロンプト本文に「短い方が強い」という主張が書かれていない |
| 人 | transcript のキーが `byte_count` / `rewrite_byte_count` になっている |

---

### S3-3: `parseSkillMd` が空行を含むブロックスカラーを最後まで読む

設計書 §13.2。**比較 B(S5-5)の前提である。** 直さないと `agent-creator` の比較が 175 バイト対 600 バイトになり、短縮の測定として成立しない。

**Files:**
- Modify: `plugins/prompt-smith/src/lib/parse-skill-md.ts`
- Test: `plugins/prompt-smith/src/__test__/parse-skill-md.test.ts`
- Modify: `plugins/prompt-smith/NOTICE`

**Interfaces:**
- Consumes: なし
- Produces: なし(挙動の修正)

**変更の要点**

- `parseSkillMd` L67-73 は字下げのない行で継続を打ち切るため、**空行で止まる。** `sandbox.ts` の `replaceDescription` L107-122 は空行を明示的に読み飛ばしてブロックの一部として扱う。**同じファイルに対して 2 つの実装が別の値を返している。**
- `parseSkillMd` を `replaceDescription` に合わせる。空行をブロックの一部として読み飛ばす。**3 行程度の変更で、空行を含まない description(他の 5 本)では挙動が変わらない。**

- [ ] **Step 1: 失敗するテストを書く**

- 空行を含むブロックスカラーの description が全段落連結で返る。
- **既存ケースは変えない。**

- [ ] **Step 2: テストが落ちることを確かめる → 実装 → 通ることを確かめる**

- [ ] **Step 3: 実ファイルで確かめる**

`plugins/prompt-smith/skills/agent-creator/SKILL.md` を `parseSkillMd` に通し、**1154 バイト**が得られることを確かめる(修正前は 175 バイト)。他の 5 本のバイト数が設計書 §13.2 の表と一致することも見る。

| スキル | 期待バイト数 |
| --- | ---: |
| `prompt-smith` | 1612 |
| `agent-creator` | 1154 |
| `skill-creator` | 518 |
| `capturing-architecture` | 587 |
| `updating-architecture` | 589 |
| `recording-gotchas` | 504 |

- [ ] **Step 4: `NOTICE` を更新する**

- **ブロックスカラーの description で空行を読み飛ばす。** 上流は字下げのない行で継続を打ち切るため、空行を含む description が第 1 段落で切れる。**`utils.py -> parse-skill-md.ts: No behavioural changes` の記述を改める。**

- [ ] **Step 5: ビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`

- [ ] **Step 6: Commit**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts plugins/prompt-smith/NOTICE
git commit -m "$(cat <<'EOF'
fix(prompt-smith): 空行を含むブロックスカラーの description を最後まで読む

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | 空行ケースのテストが PASS。既存ケースが無変更 |
| 機械 | Step 3 の 6 スキルのバイト数が表と一致する |
| 機械 | `pnpm run lint && pnpm run typecheck && pnpm run test` が通る |
| 人 | `NOTICE` の `utils.py` の節から `No behavioural changes` が消えている |

---

# 段 4: eval セットの作成基準と既存 eval への適用

**段 1〜3 と並行して着手してよい。ただし「書いてよい」と「測ってよい」を区別する。**

| 段 4 の作業 | 段 1 の完了前にやってよいか |
| --- | --- |
| `SKILL.md` の基準追加、`eval-review.html` の表示追加 | **よい** |
| eval セットの問を書き、差し替える | **よい**(ファイル編集のみ) |
| 差し替えた問を実際に測って確かめる | **だめ。段 5 で行う** |

---

### S4-1: `SKILL.md` に eval セットの作成基準 6 つを足す

設計書 §9.1 / §9.2 / §9.5 / §9.6。

**AI 向けの指示書の編集である。`prompt-smith:prompt-smith` を使用する。**

**Files:**
- Modify: `plugins/prompt-smith/skills/skill-creator/SKILL.md`

**Interfaces:**
- Consumes: なし
- Produces: なし

**編集前に、S2-4 を反映した実ファイルを読む。行番号がずれている。**

- [ ] **Step 1: 6 基準を `### 形式` の箇条書きへ足す**

現行 11 項目は残す。**問数 20 は変えない。**

| # | 内容 | 適用条件 |
| --- | --- | --- |
| 1 | eval を作る前に、そのスキルの主な起動経路をユーザーに聞く。経路は「ユーザーが目的を明示して依頼する」と「AI が提案し、ユーザーがそれに答える」の 2 通りがある | 無条件 |
| 2 | 提案への回答の形を `should_trigger: true` の問に入れる | **経路が「提案への回答」のとき** |
| 3 | 提案への回答を書くとき、AI の発言をなぞる形にしない | **基準 2 を適用するとき** |
| 4 | 短い問を作るとき、下限は対象を指す語が 1 つ残るところとする。測定は会話履歴を持たない単発実行であり、「お願いします」だけの返答はどのスキルへの依頼か判定できない | **短い問を作るとき**(経路を問わない) |
| 5 | description が使う語だけで true 問を作らない。同じ行為を指す別の語を混ぜる | 無条件 |
| 6 | 別のスキルが担当しそうに見えて、実はこのスキルが担当する依頼を `should_trigger: true` に入れる | 無条件 |

- **基準 3 と 4 だけ Input と Output の対で例示する**(本文 L112「例は Input と Output の組で示す」に従う)。他の 4 つは例示なし。
- **小見出しを新設しない。** この節が 1 枚のリストとして読まれる作りを崩さない。
- **配置は基準 6 だけを分ける。** 基準 1〜5 は箇条書きの末尾へ続け、**基準 6 は現行 L161-162(負例の 2 行)の直後へ置く。** 負例と対であることを配置で示し、平行な構文で書く(「`should_trigger: false` は…で埋める」に対して「`should_trigger: true` には…を入れる」)。
- **現行 L161-162 は変更しない。** 公式の負例定義と既に整合している。

- [ ] **Step 2: L160 を直す**

現行「1 手で終わる問は作らない」は基準 4 の短い問と字面で衝突する。**制約の対象は作業量であって問の長さではない。**

- 制約の対象が作業であることを明示する(「1 手で終わる**作業**を求める問は作らない」)。
- 問の短さを作業量の基準にしない、という 1 文を足す。

- [ ] **Step 3: L185 の回収検査に基準 4・5・6 を足す**

機械的検査は現行の 3 つ(20 問・内訳・JSON 形式)のままとし、**増やした分は人が見る項目として書く。** 基準 6 を入れないとレビュー工程をすり抜ける。

- [ ] **Step 4: L55 の入り口を直す**

現行の手順 8 は「eval セットの有無を確かめる」で、**有れば何もせず手順 9 へ進む。** この入り口では新基準が既存 eval に一度も当たらない。

手順 8 を「eval セットの有無と、基準を満たすかを確かめる。満たさない問は差し替える」に変える。**手順の追加や順序の変更はしない。**

- [ ] **Step 5: 自己評価**

`prompt-smith:prompt-smith` の 3 軸。既存 11 項目と重複していないこと、適用条件が書かれていること、基準 6 が負例 2 行と平行な構文で隣接して置かれていることを見る。

- [ ] **Step 6: Commit**

```bash
git add plugins/prompt-smith/skills/skill-creator/SKILL.md
git commit -m "$(cat <<'EOF'
docs(prompt-smith): eval セットの作成基準を 6 つ足す

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | `### 形式` の箇条書きが 11 → 17 項目になっている。問数 20 の記述が変わっていない |
| 機械 | 現行 L161-162 に相当する 2 行が無変更 |
| 人 | 基準 2・3・4 に適用条件が書かれている |
| 人 | 基準 6 が負例 2 行の直後にあり、平行な構文である |
| 人 | 基準 3・4 だけが Input / Output の対で例示されている |
| 人 | `prompt-smith` の 3 軸で問題が無い |

---

### S4-2: `eval-review.html` に基準の一覧を表示する

設計書 §9.5。

**Files:**
- Modify: `plugins/prompt-smith/skills/skill-creator/assets/eval-review.html`
- Modify: `plugins/prompt-smith/NOTICE`

**Interfaces:**
- Consumes: S4-1 で確定した 17 項目
- Produces: なし

**変更の要点**

- 既存 11 項目と新 6 基準を、**静的な一覧として画面に出す。**
- **判定ロジックを足さない。** 語彙の重なり・作業量・担当境界はいずれも機械的に判定できない。
- `__EVAL_DATA_PLACEHOLDER__` / `__SKILL_NAME_PLACEHOLDER__` / `__SKILL_DESCRIPTION_PLACEHOLDER__` の 3 つのプレースホルダの名前と意味を変えない(`SKILL.md` の承認手順が参照している)。

- [ ] **Step 1: 一覧の表示を足す**

- [ ] **Step 2: ブラウザで開いて確かめる**

プレースホルダを実データへ置換した HTML を開き、一覧が見えること、`Export Eval Set` が従来どおり動くことを確かめる。**対象システムのデータを変更する操作は行わない。**

- [ ] **Step 3: `NOTICE` を更新する**

- **`assets/eval_review.html` の「No behavioural changes」を改める。** eval セットの作成基準を静的に表示する。

- [ ] **Step 4: Commit**

```bash
git add plugins/prompt-smith/skills/skill-creator/assets/eval-review.html plugins/prompt-smith/NOTICE
git commit -m "$(cat <<'EOF'
feat(prompt-smith): eval レビュー UI に作成基準の一覧を出す

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | 3 つのプレースホルダ名が無変更 |
| 人 | 17 項目が画面に出る。判定ロジックが足されていない |
| 人 | `Export Eval Set` が従来どおり動く |
| 人 | `NOTICE` の該当節から `No behavioural changes` が消えている |

---

### S4-3: `prompt-smith` 3 本の eval の true 問を 4 問ずつ差し替える

設計書 §9.3 / §9.4.4。

**Files:**
- Modify: `plugins/prompt-smith/evals/prompt-smith.json` / `skill-creator.json` / `agent-creator.json`

**Interfaces:**
- Consumes: S4-1 の基準 5・6
- Produces: なし

**変更の要点**

| 種別 | 問数 | 扱い |
| --- | --- | --- |
| 基準 5(description に無い語で言い直した問) | 2 | 差し替え |
| 基準 6(担当境界の正例) | 2 | 差し替え |
| 据え置き | 6 | 変えない |

- **問の総数と true / false の内訳を変えない。** 差し替えるのは true 側だけで、**false 10 問は触らない。**
- 3 スキルとも主な起動経路は「ユーザーが明示して依頼する」である。**基準 2・3 は適用しない。**
- 基準 5 の選定: 現行 description に現れる語をそのまま含む true 問を挙げ、**語の重なりが大きい順に 2 問**を採る。同じ意図を description に無い語で言い直す。
- 基準 6 の 2 問:
  - **1 問目は同じプラグイン内の他のスキルとの境界**(例: `skill-creator` に対して「本文を整える依頼に見えるが実は description の改善」)。
  - **2 問目はプラグイン外**(CLI 組み込みスキル、または一般的な作業に見える依頼)。隔離後も同席する組み込みスキル 17 件に対しては**本物の競争が起きる**ので、ここを狙う。
- 差し替えた 4 問が**基準 4 の下限**(対象を指す語が 1 つ残る)と **L160 の作業量の条件**を満たすことを併せて確かめる。

- [ ] **Step 1: 現行の true 問を読み、基準 5 の差し替え元 2 問を選ぶ**

- [ ] **Step 2: 差し替え後の 4 問を書く**

- [ ] **Step 3: `eval-review.html` でユーザーの承認を得る**

`SKILL.md` の「承認と回収」の手順に従う。**回収検査を、機械が見る項目と人が見る項目に分ける。S4-4 も同じ手順を使う。**

**機械が見る(提示の前に実装担当が自分で潰す)**

| # | 検査 | 手段 |
| --- | --- | --- |
| 1 | 20 問である | Step 4 の `node -e` |
| 2 | true 10 / false 10 である | 同上 |
| 3 | `query` の重複が無い | 同上 |
| 4 | JSON 形式が `parseEvalSet` を通る | 同上 |
| 5 | false 10 問が無変更である | `git diff` |
| 6 | 基準 4(短い問に対象を指す語が 1 つ残る)を差し替えた 4 問が満たす | 目視だが判定は一意 |
| 7 | 基準 5 の 2 問が、現行 description に現れる語を含まない | `description` と問を突き合わせる |

**人が見る(ユーザーの判断)**

| # | 判断 | なぜ機械にできないか |
| --- | --- | --- |
| 1 | 基準 1 の起動経路の読みが正しいか(このスキルの主な経路は明示依頼で合っているか) | 実運用の知識に依る |
| 2 | 基準 2・3 の適用条件の判断が正しいか(適用しない/据え置くという判断) | 同上 |
| 3 | 基準 6 の 2 問が「別のスキルが担当しそうに見えるが実はこのスキル」になっているか | 担当境界は機械的に判定できない |
| 4 | 差し替えた問が現実の依頼文として自然か | 同上 |
| 5 | L160(1 手で終わる作業を求めない)を満たすか | 作業量は機械的に判定できない |

**却下されたときの手順**

1. **却下理由を、上の「人が見る」5 項目のどれに当たるかで受け取る。** どれにも当たらない指摘(たとえば「20 問では足りない」)は**設計の変更にあたるので、直さずユーザーへ差し戻す**(問数 20 は確定事項である)。
2. 指摘された問だけを書き直し、**機械が見る 7 項目を再度通してから**再提示する。
3. **指摘が「基準 6 の 2 問が内部境界に偏っている」であれば、2 問とも作り直す。** 内部 1 問・外部 1 問という配分は設計書 §9.4.4 の決定であり、片方だけ直すと配分が崩れる。
4. 再提示を繰り返しても合意に至らないときは、**問を作り直し続けずユーザーへ差し戻す。** 基準そのものの解釈が割れている合図である。

- [ ] **Step 4: JSON の形が守られていることを確かめる**

Run:
```bash
for f in plugins/prompt-smith/evals/*.json; do
  node -e "const a=require('./$f');console.log('$f',a.length,a.filter(x=>x.should_trigger).length,new Set(a.map(x=>x.query)).size)"
done
```
Expected: 各行が `20 10 20`(20 問・true 10 問・query の重複なし)

- [ ] **Step 5: Commit**

```bash
git add plugins/prompt-smith/evals
git commit -m "$(cat <<'EOF'
feat(prompt-smith): eval セットの true 問を新基準で 4 問ずつ差し替える

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Step 4 が 3 本とも `20 10 20` |
| 機械 | false 10 問が無変更(`git diff` で確認) |
| 人 | ユーザーが `eval-review.html` で承認した |
| 人 | 基準 6 の 2 問が内部境界 1 問・外部 1 問に分かれている |
| 人 | 差し替えた 4 問が基準 4 と L160 を満たす |

**このステップで測定を行わない。**

---

### S4-4: `metatron` 3 本の eval を差し替え、`0.3.6-dev` へ上げる

設計書 §9.3。**基準 2・3 は §8 の実験で既にファイルへ入っているので触らない。** 足りないのは基準 5 と 6 だけである。

**Files:**
- Modify: `plugins/metatron/evals/capturing-architecture.json` / `updating-architecture.json` / `recording-gotchas.json`
- Modify: `plugins/metatron/.claude-plugin/plugin.json` / `plugins/metatron/package.json`
- Modify: `plugins/prompt-smith/docs/measurement-2026-09-17.md`(種別の台帳)

**Interfaces:**
- Consumes: S4-1 の基準 5・6
- Produces: 差し替えた 24 問の種別対応表

**変更の要点**

- 配分は S4-3 と同じ(基準 5 が 2 問・基準 6 が 2 問・据え置き 6 問)。**足りない基準の数が同じなら問数を変える理由がない。**
- **差し替え元は明示依頼の問から選ぶ。** §8 で入った提案への回答 3 問(`updating-architecture` と `recording-gotchas`)は据え置く。あれは実運用の主経路を表している。
- `capturing-architecture` は明示依頼が主。**基準 2・3 を適用しない。**
- `metatron` の内部境界は既に実害が観測された箇所である(`capturing-architecture` と `updating-architecture` の誤発火が 1.00 だった)。負例側では捕まえていたが**正例側は未整備**なので、基準 6 の 1 問目をここへ置く価値が prompt-smith 側より高い。
- `recording-gotchas` の既存の別語彙問(「メモ残しといて」)と基準 5 の 2 問が重複しないよう、既存の true 問を読んでから選ぶ。

- [ ] **Step 1: 現行 6 問(提案への回答 3 問を含む)を読み、差し替え元を選ぶ**

- [ ] **Step 2: 差し替え後の 4 問 × 3 本を書く**

- [ ] **Step 3: `eval-review.html` でユーザーの承認を得る**

**S4-3 Step 3 の「機械が見る 7 項目 / 人が見る 5 項目 / 却下されたときの手順」をそのまま使う。** metatron 固有の追加として、人が見る項目に次の 2 つを足す。

- **提案への回答 3 問(基準 2・3)が据え置かれているか。** `updating-architecture` と `recording-gotchas` の実運用の主経路を表しており、外すと経路の実態を反映しない eval に戻る。
- `recording-gotchas` の基準 5 の 2 問が、既存の別語彙問(「メモ残しといて」)と重複していないか(設計書 §16 #21)。

- [ ] **Step 4: 種別の台帳を書く**

`plugins/prompt-smith/docs/measurement-2026-09-17.md` に `## eval 差し替えの種別台帳` を足し、**6 本 × 4 問 = 24 問**の query と種別(基準 5 / 基準 6-内部 / 基準 6-外部)の対応表を書く。**段 5 の §13.5 で基準 6 の 12 問を手で拾うために要る。** eval スキーマを変えずに種別を追う唯一の手段である。

**このファイルは S1-7 が先に作っている。節を追記する。Write で上書きしない。** S1-7 より先に S4-4 へ着手した場合は、このステップでファイルを新規作成してよい(S1-7 側も「無ければ作成し、あれば追記」と書いてある)。

- [ ] **Step 5: バージョンを上げる**

`plugins/metatron/.claude-plugin/plugin.json` と `plugins/metatron/package.json` を `0.3.5-dev` → `0.3.6-dev`。**eval の差し替えのみなのでパッチ。**

- [ ] **Step 6: JSON の形とビルドを確かめる**

**`pnpm run build` はワークスペース全体を再生成する。実行の前に、他プラグインの `scripts/` が既にクリーンであることを確かめる。**

```bash
git status --short plugins/*/scripts
```
Expected: **空。** 空でなければ、直前の `src/` 変更のコミットが build 出力を含んでいない。**S4-4 の問題ではないので、先にそれを解消してから戻る。**

```bash
for f in plugins/metatron/evals/*.json; do
  node -e "const a=require('./$f');console.log('$f',a.length,a.filter(x=>x.should_trigger).length,new Set(a.map(x=>x.query)).size)"
done
pnpm run build && git status --short plugins/*/scripts
```
Expected: 各行が `20 10 20`。**`plugins/*/scripts` に差分なし**(eval JSON は `src/` ではないのでバンドルに影響しない)。`plugins/prompt-smith/scripts` に差分が出たら、それは S4-4 の変更ではなく前段の build 忘れである。

- [ ] **Step 7: Commit**

```bash
git add plugins/metatron/evals plugins/metatron/.claude-plugin/plugin.json plugins/metatron/package.json \
        plugins/prompt-smith/docs/measurement-2026-09-17.md
git commit -m "$(cat <<'EOF'
feat(metatron): eval セットの true 問を新基準で 4 問ずつ差し替える (0.3.6-dev)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Step 6 が 3 本とも `20 10 20`、`plugins/metatron/scripts` に差分なし |
| 機械 | `plugin.json` と `package.json` がともに `0.3.6-dev` |
| 機械 | 提案への回答 3 問と false 10 問が無変更(`git diff` で確認) |
| 人 | ユーザーが承認した |
| 人 | 種別台帳が 24 問すべてを網羅している |

---

# 段 5: 測定(最大 1140 回)

**段 1〜4 のすべてが終わってから着手する。** 測定値を非連続にする要因が 4 つあり(常駐スキルの消失・母数の変更・既定モデル・eval の差し替え)、**すべてを通過してから 1 度だけ測る。段 5 より前に取ったすべての測定値を破棄する。**

**測定中は他作業を行わない。** 同一マシンで `claude -p` を 1000 回以上走らせるため、並行作業がレート制限と測定条件に影響する。**同じホームを使う他プロセスの書き込みも避ける**(設計書 §3.6)。

## 段 5 の構造

```
S5-1 (準備)        全比較の入力をここで作る
  ├ 短縮前 3 本(git から復元)      → S5-4 が使う
  ├ 600 バイト案 2 本(新規作成)     → S5-5 が使う
  └ 保存先・事前控え・CLI 版         → S5-2〜S5-7 が使う
       ↓
S5-2 (パイロット)  60 spawn を観察付きで回し、健全性を確かめる
       ↓
S5-3 → S5-4 → S5-5  測定本体(任意順だが直列。並列実行しない)
       ↓
S5-6 (集計・判定・衝突観測)
       ↓
S5-7 (記録)
```

**S5-1 が 3 群すべての入力を作る。** S5-3 / S5-4 / S5-5 に互いの順序の制約は無いが、**どれも S5-1 が無いと着手できない。**

## 設計書 §13.3 との数値差

設計書 §13.3 は合計を **960 回**(ベースライン 360 + 比較 A 360 + 比較 B 240)としている。**本計画は 1140 回である。** 差の 180 回は、設計書 §13.5 が求める「項目 7 との衝突の観測」(改善ループを 1 スキルで 1 回回す)の実コストで、**設計書の 960 という数にはこの分が含まれていない。** ユーザーの決定により、対象を `agent-creator`、`--max-iterations 3` とした。**設計書 §13.3 の表を改訂するかは別途判断する**(未解決 P8)。

## 測定の共通条件

| 項目 | 値 |
| --- | --- |
| モデル | `--model sonnet`(**既定と同じでも毎回明示的に渡す。`environment` を文字列として比べるため**) |
| 反復 | `--runs-per-query 3` |
| 並列 | `--num-workers 10`(既定。下げる根拠は実測で出ていない) |
| eval | 段 4 で差し替えた後のセット |
| 実行体 | `plugins/prompt-smith/scripts/run-trigger-eval.mjs`(`run-loop` ではない) |
| 保存先 | `${MEASURE_DIR}`(**リポジトリの外**。既定案: `~/prompt-smith-measure-2026-09-17/`) |

**保存先をリポジトリの外に置く理由**は、`git status --porcelain=v1` の前後完全一致が項目 1 の合格条件だからである。

## 実行の単位と本数

**1 回の `run-trigger-eval.mjs` 起動 = 20 問 × 3 = 60 spawn。** これが再開の最小単位である。

| 群 | 本数 | spawn | 出力ファイル |
| --- | ---: | ---: | --- |
| ベースライン | 6 | 360 | `${MEASURE_DIR}/baseline/<skill>.json` |
| 比較 A(metatron 3 スキル × 2 案) | 6 | 360 | `${MEASURE_DIR}/compare-a/<skill>-before.json` / `-current.json` |
| 比較 B(長い 2 スキル × 2 案) | 4 | 240 | `${MEASURE_DIR}/compare-b/<skill>-current.json` / `-short.json` |
| **衝突観測**(`run-loop` を `agent-creator` で 1 回、`--max-iterations 3`) | 1 | **最大 180** | `${MEASURE_DIR}/collision/<timestamp>/results.json` |
| 合計 | **17** | **最大 1140** | |

**衝突観測の 180 回は上限である。** `run-loop` は `all_passed` / `holdout_maxed` で早期に打ち切られうる。加えて、改善案生成の text 呼び出しが**反復ごとに 1〜2 回**(短縮の再依頼を含む)走る。これは 60 spawn の eval と桁が違うので本数に数えない。

---

### S5-1: 測定の準備

**Files:**
- Create: `${MEASURE_DIR}/`(リポジトリ外)
- Create: `${MEASURE_DIR}/descriptions/*.txt`(短縮前と比較 B の案)

**Interfaces:**
- Consumes: S1-7(実機確認済み)、S3-3(`parseSkillMd` 修正済み)、S4-3 / S4-4(差し替え済み eval)
- Produces: 測定に渡す description のテキスト 5 本

- [ ] **Step 1: 保存先を作る**

```bash
export MEASURE_DIR=~/prompt-smith-measure-2026-09-17
mkdir -p "$MEASURE_DIR"/{baseline,compare-a,compare-b,descriptions,logs}
```

- [ ] **Step 2: metatron の短縮前 description を git から取り出す**

**コミット `5325f6f`(`fix(metatron): 3 スキルの description を短縮し発火率を改善する`)がその変更であり、その親 `5325f6f^` に短縮前の値がある。** `--description` で渡せるので**ファイルを書き戻す必要はない。git の状態を変えない。**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
for s in capturing-architecture updating-architecture recording-gotchas; do
  git show "5325f6f^:plugins/metatron/skills/$s/SKILL.md" \
    > "$MEASURE_DIR/descriptions/$s-before.SKILL.md"
done
```

frontmatter の `description:` の値だけを取り出して `$MEASURE_DIR/descriptions/<skill>-before.txt` へ保存する。**取り出しには修正後の `parseSkillMd` と同じ規則(ブロックスカラーの空行を読み飛ばす)を使う。**

- [ ] **Step 3: 復元したものが記録と一致することを確かめる**

| スキル | 短縮前(`5325f6f^`) | 現行 |
| --- | --- | --- |
| `capturing-architecture` | 460 字 / **1034 バイト** | 211 字 / 587 バイト |
| `updating-architecture` | 302 字 / **766 バイト** | 223 字 / 589 バイト |
| `recording-gotchas` | 448 字 / **1120 バイト** | 188 字 / 504 バイト |

Expected: 字数がバックログ §7 の記録(460 / 302 / 448)と完全に一致する。**一致しないなら復元元の同定が誤っている。**

- [ ] **Step 4: 比較 B の 600 バイト案を作る**

`prompt-smith`(1612 バイト)と `agent-creator`(1154 バイト)を 600 バイト前後へ縮めた案を作る。

**作り方(ユーザーの決定)**

| # | 規律 |
| --- | --- |
| 1 | **実装担当が自分で短縮する。** 改善ループ(`run-loop`)に作らせない。ループの出力を測ると、測っているのが「短縮の効果」なのか「そのループの出来」なのか分かれなくなる |
| 2 | **`prompt-smith:prompt-smith` を使用し、その規律に従う。** ユーザーの意図に焦点を当てる、他スキルと区別がつく、発動する場面を言い切る、といった基準はこのスキルが持つ |
| 3 | **2 スキルで作り方を揃える。** 判定を 2 スキル合計 40 問で行うため、縮め方の方針が違うと「方針の比較」にならない。**どの節を残し、どの節を統合し、どの節を削ったかを、2 本で同じ順序で決める** |
| 4 | **元の description が持つ担当境界の記述(「〜は別のスキルが担当する」)を落とさない。** 基準 6 の問がこれを測る |
| 5 | 目標は 600 バイト前後。**580〜660 バイトに収める**(`LENGTH_TARGET` を中心に ±10% 程度) |

`$MEASURE_DIR/descriptions/<skill>-short.txt` へ保存する。**SKILL.md は書き換えない。** 測定は `--description` で渡す。

- [ ] **Step 5: 案をユーザーに提示し、承認を得る**

**2 本の全文を提示する。** 併せて次を添える。

- 各案のバイト数(`byteLength` で測った値)と、元からの削減率
- **縮め方の方針**(Step 4 の #3 で決めた、残した節・統合した節・削った節)
- 落としていない担当境界の記述

**却下されたら、指摘を反映して再提示する。** 承認されるまで測定へ進まない。**ユーザーの指摘が「2 本で方針が揃っていない」であれば、片方だけを直さず両方を作り直す。**

- [ ] **Step 6: 事前の控えを取る**

```bash
export REPO=/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
git -C "$REPO" status --porcelain=v1 > "$MEASURE_DIR/git-before.txt"
cp ~/.claude.json "$MEASURE_DIR/claude-json-before.json"
ls -1 ~/.claude/backups/ | wc -l > "$MEASURE_DIR/backups-before.txt"
claude --version > "$MEASURE_DIR/cli-version.txt"
git -C "$REPO" rev-parse HEAD > "$MEASURE_DIR/repo-head.txt"
node -e 'const {realpathSync}=require("node:fs");const {tmpdir}=require("node:os");console.log(realpathSync(tmpdir()))' \
  > "$MEASURE_DIR/tmpdir.txt"
```

**`claude --version` と `tmpdir` の実体パスを控えるのは、再開時の照合に要るからである**(「中断と再開の手引き」)。CLI が測定の途中で更新されると `environment` は変わらないのに測定条件が変わる。`environment` だけでは検出できない。

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Step 3 の字数が 460 / 302 / 448 と一致する |
| 機械 | `$MEASURE_DIR/descriptions/` に 5 本の `.txt`(before 3 本・short 2 本)がある |
| 機械 | short 2 本のバイト数がいずれも **580〜660** に入る |
| 機械 | `$MEASURE_DIR` に `cli-version.txt` / `repo-head.txt` / `tmpdir.txt` / `git-before.txt` がある |
| 機械 | `tmpdir.txt` の値がリポジトリの絶対パスの配下でない |
| 機械 | `git status --porcelain=v1` が S4-4 のコミット直後と同じ |
| 人 | 比較 B の 2 案をユーザーが承認した |
| 人 | 2 案の作り方(縮め方の方針)が揃っており、担当境界の記述が落ちていない |

---

### S5-2: パイロット 1 本(60 spawn)を観察付きで回す

**60 spawn のフル eval は未検証である**(設計書 §16 #14。実測は 20 spawn まで)。**最初の 1 本を観察付きで回し、健全性を確かめてから残りへ進む。**

- [ ] **Step 1: ベースラインの 1 本目を回す**

```bash
node plugins/prompt-smith/scripts/run-trigger-eval.mjs \
  --skill-path plugins/prompt-smith/skills/skill-creator \
  --eval-set plugins/prompt-smith/evals/skill-creator.json \
  --model sonnet --runs-per-query 3 \
  --out "$MEASURE_DIR/baseline/skill-creator.json"
```

- [ ] **Step 2: 健全性を確かめる**

| 確認 | 期待 |
| --- | --- |
| `errors` | **0** |
| `~/.claude.json` | JSON としてパースできる。`.claude.json.tmp.*` の残骸が無い |
| `git status --porcelain=v1` | `$MEASURE_DIR/git-before.txt` と完全一致 |
| `environment` | `base_url` / `auth_source` / `model: "sonnet"` |
| 発火の分布 | 全問 0 でない。**全問 0 なら `--timeout` を疑う**(SKILL.md の測定の規律) |

- [ ] **Step 3: 全問不発火のときの切り分け**

`--verbose` で PASS/FAIL の分布を見る。**権限ルールの消失と第 1 ツール打ち切りの合成**により、description 以前の理由で全問が落ちる経路がある(設計書 §15)。LS / Bash / Read が先に出ていないかを見る。

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | `errors` が 0 |
| 機械 | `git status --porcelain=v1` が控えと完全一致 |
| 機械 | `~/.claude.json` がパースできる |
| 人 | 発火の分布が全問 0 でない |

**ここが落ちたら残り 15 本へ進まない。** 対処は「ロールバックの手順」の §B。

---

### S5-3: ベースライン 360 回

6 スキル × 20 問 × 3 回。**S5-2 で 1 本済んでいるので残り 5 本(300 spawn)。**

- [ ] **Step 1: 残り 5 本を順に回す**

| # | スキル | `--skill-path` | `--eval-set` | 出力 |
| --- | --- | --- | --- | --- |
| 1 | `skill-creator` | `plugins/prompt-smith/skills/skill-creator` | `plugins/prompt-smith/evals/skill-creator.json` | S5-2 で済 |
| 2 | `prompt-smith` | `plugins/prompt-smith/skills/prompt-smith` | `plugins/prompt-smith/evals/prompt-smith.json` | `baseline/prompt-smith.json` |
| 3 | `agent-creator` | `plugins/prompt-smith/skills/agent-creator` | `plugins/prompt-smith/evals/agent-creator.json` | `baseline/agent-creator.json` |
| 4 | `capturing-architecture` | `plugins/metatron/skills/capturing-architecture` | `plugins/metatron/evals/capturing-architecture.json` | `baseline/capturing-architecture.json` |
| 5 | `updating-architecture` | `plugins/metatron/skills/updating-architecture` | `plugins/metatron/evals/updating-architecture.json` | `baseline/updating-architecture.json` |
| 6 | `recording-gotchas` | `plugins/metatron/skills/recording-gotchas` | `plugins/metatron/evals/recording-gotchas.json` | `baseline/recording-gotchas.json` |

- [ ] **Step 2: 1 本ごとに `errors` と `git status` を確かめる**

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | `baseline/` に 6 本の JSON が揃う |
| 機械 | 全 6 本の `errors` が 0 |
| 機械 | 全 6 本の `environment` が一致する |
| 機械 | `git status --porcelain=v1` が控えと完全一致 |

---

### S5-4: 比較 A 360 回(metatron の短縮前 vs 現行)

**目的: バックログ §7 の実験を、隔離後・Sonnet で再現する。**

**2 案は同一バッチで測る。** `skill-creator` は「連続測定では先に走った方が高く出る傾向がある」を記録しており、順序のバイアスと案の差が混ざるのを避ける。**現行側をベースラインと重複して測り直すのは意図的である。**

- [ ] **Step 1: 3 スキルそれぞれについて、短縮前 → 現行 の順に続けて回す**

```bash
for s in capturing-architecture updating-architecture recording-gotchas; do
  node plugins/prompt-smith/scripts/run-trigger-eval.mjs \
    --skill-path "plugins/metatron/skills/$s" \
    --eval-set "plugins/metatron/evals/$s.json" \
    --description "$(cat "$MEASURE_DIR/descriptions/$s-before.txt")" \
    --model sonnet --runs-per-query 3 \
    --out "$MEASURE_DIR/compare-a/$s-before.json"

  node plugins/prompt-smith/scripts/run-trigger-eval.mjs \
    --skill-path "plugins/metatron/skills/$s" \
    --eval-set "plugins/metatron/evals/$s.json" \
    --model sonnet --runs-per-query 3 \
    --out "$MEASURE_DIR/compare-a/$s-current.json"
done
```

- [ ] **Step 2: 1 本ごとに `errors` と `git status` を確かめる**

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | `compare-a/` に 6 本の JSON が揃う |
| 機械 | 全 6 本の `errors` が 0、`environment` が一致 |
| 機械 | `-before.json` の `description` が短縮前の値になっている |
| 機械 | `git status --porcelain=v1` が控えと完全一致 |

**注意:** `updating-architecture` の短縮前は 766 バイトで、落ちる帯の下端にあたる。**3 スキルのうち最も差が出にくい。** 判定は 60 問合計で行う(設計書 §16 #24)。

---

### S5-5: 比較 B 240 回(長い 2 スキルの現行 vs 600 バイト案)

**目的: 実際に改善余地のある対象で測る。この測定はそのまま項目 7 の成果になる。**

**前提: S3-3(`parseSkillMd` の修正)が入っていること。** 直す前に測ると `agent-creator` の現行側が 175 バイトになり、短縮の測定として成立しない。

- [ ] **Step 1: 2 スキルそれぞれについて、現行 → 短縮案 の順に続けて回す**

```bash
for s in prompt-smith agent-creator; do
  node plugins/prompt-smith/scripts/run-trigger-eval.mjs \
    --skill-path "plugins/prompt-smith/skills/$s" \
    --eval-set "plugins/prompt-smith/evals/$s.json" \
    --model sonnet --runs-per-query 3 \
    --out "$MEASURE_DIR/compare-b/$s-current.json"

  node plugins/prompt-smith/scripts/run-trigger-eval.mjs \
    --skill-path "plugins/prompt-smith/skills/$s" \
    --eval-set "plugins/prompt-smith/evals/$s.json" \
    --description "$(cat "$MEASURE_DIR/descriptions/$s-short.txt")" \
    --model sonnet --runs-per-query 3 \
    --out "$MEASURE_DIR/compare-b/$s-short.json"
done
```

- [ ] **Step 2: `agent-creator` の現行側が 1154 バイトであることを確かめる**

出力 JSON の `description` のバイト数を測る。**175 バイトなら S3-3 が入っていない。**

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | `compare-b/` に 4 本の JSON が揃う |
| 機械 | 全 4 本の `errors` が 0、`environment` が一致 |
| 機械 | `agent-creator-current.json` の `description` が 1154 バイト |
| 機械 | `git status --porcelain=v1` が控えと完全一致 |

---

### S5-6: 集計・判定・基準 6 の判別力の観測・衝突観測

設計書 §13.4 / §13.5。**Step 4 が 180 回の測定を伴う。** Step 1〜3 は S5-3〜S5-5 の出力を読むだけである。

- [ ] **Step 1: 比較 A と比較 B を集計する**

比較の単位は 1 案あたり、**比較 A が 60 問**(3 スキル × 20 問)、**比較 B が 40 問**(2 スキル × 20 問)。

| 各比較の結果 | 読み |
| --- | --- |
| 短い側が **3 問以上**優位 | 短縮が効く |
| 差が 1〜2 問 | 判定できない |
| 長い側が **3 問以上**優位 | 短縮が効かない |

**閾値 3 問の根拠は `SKILL.md` の既存規律「1〜2 問の差で description や実装を疑わない」である。** この規律を下回る差で規律を書き換えない。**比較 B は問数が少ないぶん分解能が低い**ことを判定の記録に添える。

- [ ] **Step 2: 2 つの比較を突き合わせる**

| 比較 A | 比較 B | 判定 | 項目 7b の扱い |
| --- | --- | --- | --- |
| 効く | 効く | **確定** | 設計書 §10.1 のとおり改稿。定数を据え置く |
| 効く | 効かない / 判定不能 | **限定付き** | 規律は「測って決める」を主にし、600 バイトは弱い目安として書く。`LENGTH_FLOOR` は据え置く |
| 効かない / 判定不能 | 効く | **新しい実測を採る** | §10.1 のとおり改稿し、比較 A が再現しなかった事実を `docs/` に残す |
| 効かない | 効かない | **反転** | §10.1 の改稿を撤回。L135 の反転だけを行い、600 バイトの目安は書かない。定数を測定値に合わせて取り直す |
| 判定不能 | 判定不能 | **保留** | 規律を変えない。L135 の反転だけ行う。定数は暫定のまま未解決へ戻す |

**項目 7a(予算という仕組み)はどの分岐でも撤回しない。**

- [ ] **Step 3: 基準 6 の判別力を観測する**

**12 問(6 スキル × 2 問)**の合否を `results[]` から手で拾い、他の true 問と分けて記録する。どの問がどの種別かは S4-4 の種別台帳にある。

- **10 問は 2 案比較ができる**(比較 A の metatron 6 問、比較 B の 4 問)。`skill-creator` の 2 問はベースライン 1 点のみ。
- **両案とも 3/3 で通る問は判別力が無い。差し替える。**(既存規律「両構成とも合格する assertion には識別力がない」の eval 版)
- 組み込みスキル狙いの問(2 問目)が落ちたときは、`claude -p` を直接叩いて stream を読み、**組み込みスキルが発火したのか、何も発火しなかったのか**を切り分ける。前者なら本物の競争が測れている。後者なら description が届いていないだけである。**この切り分けは手作業である。**

- [ ] **Step 4: 項目 7 との衝突を観測する(最大 180 回)**

**対象は `agent-creator`、`--max-iterations 3`(ユーザーの決定)。** `agent-creator` を選ぶのは、比較 B の対象であり(改善余地が実在する)、`prompt-smith`(1612 バイト)より短いぶん反復あたりの改善案生成が安いためである。

**`--results-dir` を必ず渡す。** `improveDescription` は `logDir` が未指定だと transcript を書かない。`run-loop` の `logDir` は `--results-dir` からしか埋まらないので、**これを省くと `improve_iter_*.json` が 1 つも残らず、観測そのものができない**(設計書 §16 #18)。

```bash
cd "$REPO"
mkdir -p "$MEASURE_DIR/collision"
node plugins/prompt-smith/scripts/run-loop.mjs \
  --eval-set plugins/prompt-smith/evals/agent-creator.json \
  --skill-path plugins/prompt-smith/skills/agent-creator \
  --model sonnet --runs-per-query 3 --max-iterations 3 --holdout 0.4 \
  --report none \
  --results-dir "$MEASURE_DIR/collision" \
  > "$MEASURE_DIR/collision/stdout.json"
```

出力先: `$MEASURE_DIR/collision/<timestamp>/results.json` と `$MEASURE_DIR/collision/<timestamp>/logs/improve_iter_*.json`。

- [ ] **Step 5: 衝突の有無を判定する**

各反復について次を並べる。

| 拾う値 | 所在 |
| --- | --- |
| その反復の案のバイト数 | `logs/improve_iter_N.json` の `byte_count`(S3-2 で `char_count` から改名) |
| その反復の予算 | `logs/improve_iter_N.json` の `prompt` 本文に明示されている |
| 基準 6 の 2 問の合否 | `results.json` の `history[N].results[]` から、S4-4 の種別台帳で特定した 2 問を拾う |

**衝突が実在すると判定する条件は、次の 2 つが**ともに**成り立つときだけとする。**

| # | 条件 |
| --- | --- |
| 1 | **基準 6 の 2 問が、すべての反復で不合格である**(`pass: false`。3 実行のうち発火が `--trigger-threshold 0.5` に届かない) |
| 2 | **案が予算の上限に張り付いている。** すべての反復の案のバイト数が「その反復の予算 × 0.9」以上であり、かつ**最終反復の案が初回反復の案より短くなっていない** |

- **1 と 2 の両方が成り立つ** → 衝突が実在する。§9.4.3 で退けた (b) を検討の俎上に載せる(ロールバックの手順 §E)。**このステップでは実装しない。**
- **1 だけが成り立つ** → 基準 6 の問が description の届かない場所にある。予算とは無関係なので、問の作りを見直す(ロールバックの手順 §D と同じ扱い)。
- **2 だけが成り立つ** → 縮む力が働いていない。設計書 §16 #2 の (d)(反復ごと 2 案)またはラチェットの検討対象になるが、**基準 6 との衝突ではない。**
- **どちらも成り立たない** → 案が短くなりながら基準 6 が通っている。バックログ §7 の観測(境界の問題は短縮で解ける)が true 側でも成り立っている。

**`run-loop` が `all_passed` / `holdout_maxed` で反復 1 や 2 で止まったときは、条件 2 の「最終反復と初回反復の比較」が成立しない。** そのときは「判定できない」として記録し、衝突が実在するとは書かない。

- [ ] **Step 6: 事後の控えと突き合わせる**

```bash
git -C "$REPO" status --porcelain=v1 > "$MEASURE_DIR/git-after.txt"
diff "$MEASURE_DIR/git-before.txt" "$MEASURE_DIR/git-after.txt"
ls -1 ~/.claude/backups/ | wc -l
claude --version | diff "$MEASURE_DIR/cli-version.txt" -
```

Expected: `git` の `diff` が空。**`claude --version` の `diff` も空**(測定の途中で CLI が更新されていない)。更新されていたら「ロールバックの手順」の §F を見る。

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Step 6 の `git` の `diff` が空 |
| 機械 | Step 6 の `claude --version` の `diff` が空 |
| 機械 | `~/.claude.json` がパースできる |
| 機械 | 16 本の eval すべての `errors` が 0 |
| 機械 | 16 本すべての `environment` が一致する |
| 機械 | 衝突観測の `logs/improve_iter_*.json` が 1 つ以上ある(`--results-dir` を渡し忘れていない) |
| 人 | §13.4 の 5 分岐のどれかが選ばれている |
| 人 | 基準 6 の 12 問のうち、両案とも 3/3 で通る問が無い(あれば差し替える) |
| 人 | 衝突の判定が Step 5 の 4 通りのどれかに落ちている |

---

### S5-7: 測定結果と判定を記録する

**Files:**
- Modify: `plugins/prompt-smith/docs/measurement-2026-09-17.md`

- [ ] **Step 1: 記録を書く**

| 節 | 内容 |
| --- | --- |
| 測定の条件 | CLI 版、`environment` の 3 キー、eval の版(コミットハッシュ)、日時 |
| 非連続の宣言 | **段 5 より前のすべての測定値を破棄した。** 理由は 4 つ(常駐スキルの消失・`readResultError` による母数変更・既定モデル・eval の差し替え)。**隔離直後のベースラインには競争相手の消失と母数変更の 2 つが同時に入っており、どちらがどれだけ効いたかは分離できない** |
| ベースライン | 6 スキルの発火率 |
| 比較 A | 60 問合計の差と判定 |
| 比較 B | 40 問合計の差と判定。**分解能が低いことの注記** |
| 突き合わせ | §13.4 の 5 分岐のどれか |
| 基準 6 | 12 問の合否と判別力の評価 |
| 衝突の観測 | 案のバイト数の推移と基準 6 の合否 |
| 運用注意 | `~/.claude/backups/` の増加、測定中に他の重い並行セッションを走らせないこと |

**測定の生データ(`$MEASURE_DIR` の 16 本の eval JSON と衝突観測の一式)はリポジトリへ入れない。** 記録するのは集計値と判定である。

- [ ] **Step 2: Commit**

```bash
git add plugins/prompt-smith/docs/measurement-2026-09-17.md
git commit -m "$(cat <<'EOF'
docs(prompt-smith): 隔離後の発火測定の結果と判定を記録する

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | `git status --short` に `$MEASURE_DIR` 由来のファイルが現れない |
| 人 | 5 分岐のどれを採ったかが 1 行で読める |
| 人 | 非連続の宣言が書かれている |

---

# 段 6: 長さの規律と残りの追随

---

### S6-1: `SKILL.md` L131-139 を分岐に応じて改稿する

設計書 §10.1。**S5-6 で選ばれた分岐に従う。**

**AI 向けの指示書の編集である。`prompt-smith:prompt-smith` を使用する。**

**編集前に、S4-1 を反映した実ファイルを読む。行番号がずれている。**

**Files:**
- Modify: `plugins/prompt-smith/skills/skill-creator/SKILL.md`

- [ ] **Step 1: 分岐が「確定」または「新しい実測を採る」のとき、次のとおり改稿する**

| 行 | 現行 | 改修後 |
| --- | --- | --- |
| L133 | `description` は 1024 字以内にする | **条件付きに変える。** Claude.ai へ昇格させる見込みがあるスキルに限る |
| L134 | 100〜200 words 相当へ収める | **置き換える。** 測らないときの目安を **600 バイト前後(UTF-8)** とし、日本語なら約 200 字・英語なら約 100 words に相当する、と換算を添える |
| L135 | 発火精度より 100〜200 words 相当の範囲を優先する | **削除して反転させる。** 発火率を優先し、測れるときは測って高い方を採る |
| L136 | 上限に触れたときは、個別の記述を意図のまとまりへ言い換えて縮める | **残す。** 短縮の方向を示す唯一の行である |
| — | (無い) | **足す。** `description` と `when_to_use` の合算を 1536 字以内にする。**この上限はスクリプトが検査しない** |

**規律本文を言語非依存に書く。**

| # | 方針 |
| --- | --- |
| 1 | **主たる数値はバイト数で書く。**「600 バイト前後にする」 |
| 2 | **換算を併記する。**「日本語なら約 200 字、英語なら約 100 words にあたる」 |
| 3 | **どちらの言語で書くかを規律で決めない。** 長さの節に言語の指示を混ぜない(言語の選択は L113 が扱う別の論点である) |

**換算は「根拠」ではなく「読み替えのための補助」として置く。実測値や公式の数値は本文に書かない。**

- [ ] **Step 2: 分岐が「限定付き」のとき**

規律は「測って決める」を主にし、600 バイトは弱い目安として書く。

- [ ] **Step 3: 分岐が「反転」または「保留」のとき**

**§10.1 の改稿を撤回する。L135 の反転だけを行い(発火率を優先する、は実測に反しない)、600 バイトの目安は書かない。**

- [ ] **Step 4: 自己評価 → Commit**

```bash
git add plugins/prompt-smith/skills/skill-creator/SKILL.md
git commit -m "$(cat <<'EOF'
docs(prompt-smith): description の長さの規律を発火率基準へ改める

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

**機械的な条件は分岐ごとに違う。** 反転・保留のときは L134「100〜200 words 相当へ収める」が**残る**ので、「`100〜200 words` が 0 件」を全分岐に課すと排他になる。

| 分岐 | 機械的な条件 |
| --- | --- |
| 確定 / 新しい実測を採る | `grep -n "100〜200 words\|100-200 words" <SKILL.md>` が **0 件**。かつ `600 バイト` が本文にある。かつ `1536` が本文にある |
| 限定付き | 同上。ただし `600 バイト` は目安としての文脈で現れる |
| **反転 / 保留** | **`grep -n "600 バイト" <SKILL.md>` が 0 件。** L133・L134 に相当する 2 行が**無変更**(`git diff` で確認)。L135 に相当する行が「発火精度より…を優先する」から発火率優先へ反転している |

**全分岐に共通する条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | L135 に相当する「発火精度より 100〜200 words 相当の範囲を優先する」が**どの分岐でも消えている。** この反転だけは実測に反しないため、反転・保留でも行う |
| 機械 | L136 に相当する行(言い換えて縮める)が残っている |
| 人 | 選ばれた分岐と本文の内容が、上の表と一致している |
| 人 | 実測値・根拠・出典が本文に入っていない |
| 人 | `prompt-smith` の 3 軸で問題が無い |
| 人 | **確定・限定付き・新しい実測のときのみ**、本文が言語非依存になっている(「200 字前後」だけを書いていない) |

---

### S6-2: `LENGTH_TARGET` / `LENGTH_FLOOR` を確定させる

**分岐が「反転」または「保留」のときだけ実体を持つ。** それ以外は据え置きの確認で終わる。

**Files:**
- Modify: `plugins/prompt-smith/src/lib/defaults.ts`(分岐によっては変更なし)
- Test: `plugins/prompt-smith/src/__test__/improve-description.test.ts`(値を参照しているなら追随)

- [ ] **Step 1: 分岐ごとの扱い**

| 分岐 | `LENGTH_TARGET` | `LENGTH_FLOOR` |
| --- | --- | --- |
| 確定 | 600 のまま | 680 のまま |
| 限定付き | 600 のまま | **680 のまま**(実測の落ちる帯より下にあるため害がない) |
| 新しい実測を採る | 600 のまま | 680 のまま |
| **反転** | **測定値に合わせて取り直す** | **同上** |
| 保留 | 暫定のまま(未解決へ戻す) | 同上 |

- [ ] **Step 2: 値を変えたときはビルドと全体テスト**

Run: `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm run test`

- [ ] **Step 3: Commit(値を変えたときのみ)**

```bash
git add plugins/prompt-smith/src plugins/prompt-smith/scripts
git commit -m "$(cat <<'EOF'
fix(prompt-smith): 長さの予算の定数を測定結果へ合わせる

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | 値を変えたなら `pnpm run test` が通り、`scripts/` の差分が同じコミットにある |
| 人 | 分岐と定数の扱いが表と一致する |

---

### S6-3: 残りの追随

設計書 §10.6 / §10.7 / §10.8。

**Files:**
- Modify: `README.md`(ルート。§prompt-smith)
- Modify: `plugins/prompt-smith/docs/skill-creator-port-rationale.md`(L46)
- Modify: `.serena/memories/agent_policy/core.md`(L426-429)

- [ ] **Step 1: ルート `README.md`**

§prompt-smith(L123-126)に、**発火測定が隔離した一時環境で走ること**を 1 文で足す。**L60 の一覧表(状態: 開発中)は変えない。**

- [ ] **Step 2: `skill-creator-port-rationale.md` L46**

「競争に勝った率」は公式由来ではなく、2026-08-09 の移植設計が cwd 隔離後の残差に付けた操作的定義である。項目 1 でその前提(ユーザースキルとプラグインが同席する)が消える。

**L46 を削除せず、2026-09-17 の隔離までの定義として時点を付けて残し、隔離後の定義を足す。** これは現役の根拠文書であると同時に経緯の文書でもある。

**同じ文書の L22(上流の欠陥の説明)は隔離後も真なので変更しない。**

- [ ] **Step 3: `.serena/memories/agent_policy/core.md` L426-429**

**Serena の `write_memory` / `edit_memory` で変更する**(保護パス)。手で編集しない。

| bundle | 追随内容 |
| --- | --- |
| `run-trigger-eval.mjs` | 一時 sandbox に加えて `--setting-sources project` ほかのフラグで設定の読み込み元を絞ること、起動失敗を発火 0 と区別すること |
| `improve-description.mjs` | 「shortens >1024 chars」を**「最良 description の UTF-8 バイト数を予算として超過分を書き直す」**へ |
| `run-loop.mjs` | 出力に `environment` が載ること、打ち切り条件が train 全問合格または holdout 満点であること |

**設計書 §10.7 は `improve-description.mjs` の追随内容を「最良 description の**字数**を予算として」と書いているが、これは第 5 版までの単位である。第 6 版が長さの単位を UTF-8 バイト数へ変えた際に §10.7 の文面が追随していない**(設計書 §17 の第 6 版の記述が単位変更を宣言している)。**上表の「バイト数」が正しい。設計書 §10.7 を正としてメモリへ「字数」と書かない。**

- [ ] **Step 4: 変更しない文書を確かめる**

Run: `git status --short harness-docs/`
Expected: 本計画で新規に作った `harness-docs/plans/2026-09-17-…` 以外に差分が無い。**`harness-docs/design/2026-08-09-…` / `harness-docs/plans/2026-08-09-…` / `harness-docs/handover/2026-08-10-…` は記録であり、遡って書き換えない。**

- [ ] **Step 5: Commit**

```bash
git add README.md plugins/prompt-smith/docs/skill-creator-port-rationale.md .serena/memories/agent_policy/core.md
git commit -m "$(cat <<'EOF'
docs: 隔離後の測定観を README・rationale・メモリへ追随させる

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Step 4 の `git status` に過去の設計書・実装計画書・handover が現れない |
| 人 | rationale L46 が削除ではなく時点付きで残っている |
| 人 | メモリが Serena のツールで更新されている |

---

### S6-4: Done 条件の総点検

`.claude/rules/metatron/conventions.md` の Done 条件を 1 行ずつたどる。

- [ ] **Step 1: 機械的な確認**

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
git status --short plugins/prompt-smith/scripts plugins/metatron/scripts
grep -h '"version"' plugins/prompt-smith/.claude-plugin/plugin.json plugins/prompt-smith/package.json
grep -h '"version"' plugins/metatron/.claude-plugin/plugin.json plugins/metatron/package.json
```

Expected:
- lint / typecheck / test / build がすべて成功
- `scripts/` に差分なし
- `prompt-smith` が 2 行とも `0.4.0-dev`、`metatron` が 2 行とも `0.3.6-dev`

- [ ] **Step 2: 人が見る確認**

| # | 条件 | 所在 |
| --- | --- | --- |
| 1 | ルートの `README.md` に反映されている | S6-3 |
| 2 | ARCHITECTURE に影響する変更をしたなら `/metatron:update` で追随させた | 下記 |
| 3 | `.serena/memories/` と食い違わない | S6-3 |
| 4 | 編集内容が適切に分けてコミットされている | 全ステップ |
| 5 | `NOTICE` の変更点一覧が設計書 §11.1 の**全 9 項目**を網羅している | 下表 |

**条件 5 の内訳。** 設計書 §11.1 の表は 9 行ある。**そのうち「結果 JSON に `environment` を記録する」は `run_loop.py` の節に要る**(`run_eval.py` の節の既存項目 5 は `run-trigger-eval` の話であり、代用にならない)。

| §11.1 の項目 | `NOTICE` のどの節へ | 入れるステップ |
| --- | --- | --- |
| 一時 cwd と隔離フラグ 4 種 | `run_eval.py` と `improve_description.py` | S1-3 |
| `close` を待ってから一時ディレクトリを消す | 同上 | S1-3 |
| 起動失敗を `errors` に記録し `is_error` を見る | `run_eval.py` | S1-5 |
| 1 問でも全実行が失敗したら結果を返さない | 同上 | S1-5 |
| **結果 JSON に `environment` を記録する** | **`run_loop.py`** | **S2-2** |
| 打ち切り条件に holdout 全問合格を加える | `run_loop.py` | S3-1 |
| train が空になる構成を拒否する | 同上 | S3-1 |
| 長さの指示を UTF-8 バイト予算へ差し替える | `improve_description.py` | S3-2 |
| ブロックスカラーの空行を読み飛ばす(`No behavioural changes` を改める) | `utils.py` | S3-3 |
| `eval_review.html` の `No behavioural changes` を改める | `assets/eval_review.html` | S4-2 |

Run: `grep -c "^  [0-9]" plugins/prompt-smith/NOTICE`
Expected: 既存 14 項目 + 追加分。**番号が重複していない。**

**条件 2 について。** 本改修は既存プラグインの内部実装・規律・eval データの変更であり、ドメインマップやレイヤー構造を変えない。**ARCHITECTURE への影響があるかはユーザーが判断する**(「判断が要る場面」参照)。影響があると判断されたときは `metatron:updating-architecture` を起動する。**実装計画書の手順で ADR を足さない**(ADR の追加はスキルの起動が前提である)。

- [ ] **Step 3: 未解決事項の棚卸し**

設計書 §16 の 25 項目のうち、段 5 で解決したもの(#3 / #11 / #14 / #23 / #24 など)と、残ったものを整理してユーザーへ報告する。

**受け入れ条件**

| 種別 | 条件 |
| --- | --- |
| 機械 | Step 1 のすべてが期待どおり |
| 人 | Step 2 の 5 条件が満たされている |
| 人 | 未解決事項の棚卸しがユーザーへ報告されている |

---

## 中断と再開の手引き

### どこで中断してよいか

**各ステップの Commit が済んだ時点が、安全な中断点である。** 段 5 だけは別で、**1 本の `run-trigger-eval.mjs` が終わった時点**(= 出力 JSON が書かれた時点)が中断点になる。

### 再開時に最初にやること

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
git log --oneline -15
git status --short
grep -h '"version"' plugins/prompt-smith/.claude-plugin/plugin.json plugins/prompt-smith/package.json
pnpm run build && git status --short plugins/prompt-smith/scripts
```

コミットログの最後のメッセージを「ステップの全体像」の表と突き合わせ、次の ID を決める。**`scripts/` に差分が出たら、直前のステップが build を忘れている。** その差分を単独でコミットせず、直前のコミットへ含めるか、`chore(prompt-smith): バンドル出力を再生成する` として直ちにコミットする。

### 段 5 の再開

**測定は 17 本の独立した実行であり、出力ファイルの有無が進捗そのものである。** `--out` は `runEval` が完走した後にだけ書かれるので、**60 spawn の途中で止まればファイルは残らない。書きかけの JSON は出ない。**

- [ ] **再開 1: 環境が変わっていないことを確かめる**

```bash
export REPO=/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins
export MEASURE_DIR=~/prompt-smith-measure-2026-09-17

claude --version | diff "$MEASURE_DIR/cli-version.txt" -
git -C "$REPO" rev-parse HEAD | diff "$MEASURE_DIR/repo-head.txt" -
git -C "$REPO" status --porcelain=v1 | diff "$MEASURE_DIR/git-before.txt" -
node -e 'const {realpathSync}=require("node:fs");const {tmpdir}=require("node:os");console.log(realpathSync(tmpdir()))' \
  | diff "$MEASURE_DIR/tmpdir.txt" -
node -e 'JSON.parse(require("node:fs").readFileSync(process.env.HOME+"/.claude.json","utf8"));console.log("ok")'
ls -1 ~/.claude/backups/ | wc -l
```

| 落ちた `diff` | 意味と対処 |
| --- | --- |
| `claude --version` | **CLI が更新された。** `environment` は `--model` の文字列しか持たないので、**この差は `environment` の照合では検出できない。** 設計書 §15 の「CLI を更新したらベースラインを取り直す」に従い、**全 17 本を捨てて測り直す** |
| `rev-parse HEAD` | 中断中にコミットが増えた。eval セットや `src/` が変わっていないかを `git diff` で見る。測定対象が変わっていれば測り直す |
| `git status` | 中断中にリポジトリが変わった。同上 |
| `tmpdir` | **`TMPDIR` が変わった。** リポジトリ配下を指していないかを確かめる。指していれば S1-2 のガードが発火して全問 `error` になる |
| `~/.claude.json` がパースできない | 「ロールバックの手順」の §B を見る |

- [ ] **再開 2: 進捗をペア単位で確かめる**

**`ls` の有無だけを進捗にしない。** 比較 A / B は 2 案を同一バッチで測る条件があるため、**ペアの間で中断すると 1 ファイルだけが残り、それが「済んだ 1 本」に見える。**

```bash
ls -1 "$MEASURE_DIR"/baseline "$MEASURE_DIR"/compare-a "$MEASURE_DIR"/compare-b "$MEASURE_DIR"/collision 2>/dev/null
```

| 群 | 単位 | 期待されるファイル | 揃っていないときの扱い |
| --- | --- | --- | --- |
| ベースライン | **1 本** | `baseline/{skill-creator,prompt-smith,agent-creator,capturing-architecture,updating-architecture,recording-gotchas}.json` | **欠けている 1 本だけを回し直す** |
| 比較 A | **ペア** | `compare-a/<skill>-before.json` と `compare-a/<skill>-current.json` | **片方だけなら、残っている方も消して 2 本とも測り直す** |
| 比較 B | **ペア** | `compare-b/<skill>-current.json` と `compare-b/<skill>-short.json` | 同上 |
| 衝突観測 | **1 本** | `collision/<timestamp>/results.json` と `logs/improve_iter_*.json` | `results.json` が無ければ回し直す。**`logs/` が空なら `--results-dir` を渡し忘れているので回し直す** |

**ペアを片方だけ残さない理由。** 2 案の比較は「連続測定では先に走った方が高く出る傾向がある」(設計書 §13.3)を打ち消すために同一バッチで測る。時間を空けて片割れを測ると、その打ち消しが効かず、**順序のバイアスと案の差が混ざる。**

- [ ] **再開 3: 最初の 1 本で `environment` を照合する**

再開後に最初に書けたファイルの `environment` を、中断前のファイルのものと**文字列として**比べる。一致しなければ測定条件が変わっている。

### 段 5 を中断したまま他の作業へ移らない

測定中は他作業を行わない、という条件が前提にある(設計書 §13.3)。**中断して別の重いセッションを走らせると、同じホームを使う他プロセスの書き込みが混ざる**(設計書 §3.6)。中断するなら、そのマシンで `claude` を使う作業も止める。

### 段 4 を先に着手して中断した場合

段 4 は段 1〜3 と並行してよい。**ただし段 4 のコミットが段 1〜3 のコミットの間に挟まっても構わない。** 順序の制約は「S4-1 の前に S2-4 が済んでいること」「段 5 の前に S4-3 / S4-4 が済んでいること」の 2 つだけである。

---

## ロールバックの手順

### §A: S1-7(隔離の実機確認)が落ちたとき

**段 5 へ進まない。** 落ちた手順ごとに疑う先が違う。

| 落ちた手順 | 疑う順 | コードを戻すか |
| --- | --- | --- |
| **Step 2**(`init.skills` が減らない) | フラグの綴りと値 → `--settings` の JSON が argv の 1 要素として渡っているか → CLI 版 | **戻さない。** S1-3 の実装を直す |
| **Step 3**(`TMPDIR` ガードが throw しない) | 走査の起点が一時ディレクトリの「親」になっているか → `realpath` で比較しているか → キャッシュのキーが `realpath(tmpdir())` か | 戻さない。S1-2 を直す |
| **Step 5**(probe に hook の通知が混ざる) | `--settings '{"disableAllHooks":true}'` が壊れていないか(`-p` は validation に失敗した settings を**黙って無視する**) | 戻さない。S1-3 を直す |
| **Step 6**(陽性対照が 3/3 にならない) | `--setting-sources` の値が `project` か → cwd が一時ディレクトリか → CLI 版 → **権限ルールの消失と第 1 ツール打ち切りの合成**(`--verbose` で LS / Bash / Read が先に出ていないか) | 戻さない。ただし最後の要因なら**設計書 §15 の想定リスクが実現している。ユーザーへ報告して判断を仰ぐ** |
| **Step 7**(`git status` が一致しない) | hooks が生きている。Step 5 と同じ。**加えて、Step 3 の `.ps-tmpdir-probe` の後始末を忘れていないか** | 戻さない。S1-3 を直す |
| **Step 8**(`errors` が 0 でない) | 設計書 §3.4 の分類 → 認証経路(`apiKeyHelper` / `awsAuthRefresh` / settings の `env` を使っていないか) | 戻さない。**認証が原因なら環境変数による認証へ切り替える。コードの欠陥ではない** |

**S1-2〜S1-6 を revert する状況は、隔離方式そのものが成立しないと分かったときだけである。** そのときは設計書 §3.5.1(空の `CLAUDE_CONFIG_DIR`)を含む代替の再検討が要るので、**ユーザーへ差し戻す。**

### §B: S5-2(パイロット)が落ちたとき

**残り 15 本へ進まない。**

| 症状 | 対処 |
| --- | --- |
| `errors` が 0 でない | §A の Step 8 と同じ |
| `git status` が一致しない | §A の Step 7 と同じ。**リポジトリに作られたファイルを消す前に、何が作られたかを記録する** |
| 全問不発火 | §A の Step 6 と同じ |
| `~/.claude.json` が壊れた / 残骸が出た | **60 spawn で初めて出た事象である**(設計書 §16 #14)。`$MEASURE_DIR/claude-json-before.json` から復元し、`--num-workers` を下げて再試行するかをユーザーへ諮る。**並列度を下げる判断はユーザーが行う** |

### §C: S5-6 の判定が「反転」だったとき

**撤回するのは 7b(規律)と定数だけである。7a(予算という仕組み)はどの分岐でも撤回しない。** 予算は「最良を超えない」という相対的な上限であり、最適な絶対バイト数が何であっても、青天井の膨張を止める働きは変わらない。

| 対象 | 扱い |
| --- | --- |
| S1-2〜S1-6(隔離・`errors`) | **撤回しない** |
| S2-1〜S2-4(既定・`environment`・`--help`) | **撤回しない** |
| S3-1(打ち切りの OR 化) | **撤回しない** |
| S3-2 の**仕組み**(`budget` / `byteLength` / 短縮閾値) | **撤回しない** |
| S3-2 の**定数**(`LENGTH_TARGET` / `LENGTH_FLOOR`) | **測定値に合わせて取り直す**(S6-2) |
| S3-3(`parseSkillMd`) | **撤回しない**(欠陥の修正であり、規律と独立している) |
| S4-1〜S4-4(eval の基準と差し替え) | **撤回しない** |
| S6-1(L131-139 の改稿) | **§10.1 の改稿を撤回する。L135 の反転だけを行い、600 バイトの目安は書かない** |

**S6-1 は S5-6 の後にあるので、「撤回」ではなく「最初からその形で書く」ことになる。** これが段 6 を測定の後に置いた理由である(設計書 §2「同じ段に置くと、測定で方向が反転したときに撤回範囲が切り分けられない」)。

### §D: 基準 6 の 12 問に判別力が無かったとき

両案とも 3/3 で通る問は差し替える(S5-6 Step 3)。**差し替えた問を測り直すかはユーザーが決める。** 測り直すなら、その比較群(A または B)の 2 案を両方とも回し直す。

### §E: 基準 6 と項目 7 の衝突が実在したとき

**S5-6 Step 5 の条件 1 と 2 が**ともに**成り立ったときだけである。** 設計書 §9.4.3 で退けた (b)(eval スキーマへ種別を持たせ、改善プロンプトへ区別して渡す)を**検討の俎上に載せる。実装しない。** スキーマ変更は `parseEvalSet` の契約と 6 本の eval セット、`eval-review.html` の表示に波及する。**設計の変更にあたるので、ユーザーへ差し戻す。**

条件 2 だけが成り立ったときは衝突ではない。設計書 §16 #2 の (d)(反復ごと 2 案)またはラチェットの検討対象であり、**これも設計の変更なのでユーザーへ差し戻す。**

### §F: 測定の途中で `claude` CLI が更新されたとき

**`environment` の 3 キーは `--model` へ渡した文字列しか持たないので、CLI の更新をこの照合では検出できない。** 検出口は `claude --version` の控えとの `diff` だけである(S5-1 Step 6 / 再開 1 / S5-6 Step 6)。

| 検出した時点 | 対処 |
| --- | --- |
| 再開時(再開 1) | **測り終えた分をすべて捨て、S5-2 のパイロットから測り直す。** 設計書 §15「CLI を更新したらベースラインを取り直す」に従う |
| 全測定の後(S5-6 Step 6) | 同上。**部分的に測り直して継ぎ合わせない。** どの本がどの版で測られたかを後から復元できない |

**自動更新を止められない環境では、測定に入る前にユーザーへ相談する。** 17 本を捨てる判断はユーザーが行う。

---

## 検証の全体像

| 対象 | いつ | どう確かめるか |
| --- | --- | --- |
| 祖先 `.claude` の検出 | S1-2 | `TMPDIR` を偽装して throw。**既存ケースと同一プロセスで両方通る** |
| 隔離フラグ | S1-3 | `buildEvalArgs` / `buildTextArgs` の出力を固定。**新方式では隔離の実体が argv にあり、ここが唯一の自動的な砦である** |
| 後始末の順序 | S1-3 | `killThenSettle` + fake child。`close` の後に `cleanup` |
| `subtype: success` の罠 | S1-4 / S1-5 | `is_error: true` かつ `subtype: "success"` が `error` になる |
| **3 値化の配線** | S1-5 | `runEval` の結合テスト。**truthy 集計バグを入れると落ちることを目視する** |
| 隔離の実効 | S1-7 相 1・4 | `init.skills` の件数が CLI 組み込みだけになる + `git status --porcelain=v1` の前後完全一致 |
| **`TMPDIR` ガードのライブ挙動** | S1-7 相 1 Step 3 | `TMPDIR` をリポジトリ配下にして CLI 起動 → 終了コード 1 と `.claude` の絶対パス。**vitest の偽装(S1-2)とは別の検出口** |
| **陽性対照** | S1-7 相 3 Step 6 | probe スキル 3 問が `summary.passed === 3`。設計書 §15 が「権限ルール消失 × 第 1 ツール打ち切り」の唯一の検出口とした手順 |
| 既定モデル(ライブラリ) | S2-1 | ライブラリ関数を `model` 無しで直接呼ぶ |
| **既定モデル(CLI)** | S2-5 | **3 エントリを `--model` 無し・他の必須フラグ付きでライブ起動する。** `main` が `values.model` をそのまま渡す経路は、ここでしか通らない |
| `environment` | S2-2 | 結果 JSON の 3 キー。トークンの値が入らない |
| **`NOTICE` の網羅** | S6-4 | 設計書 §11.1 の全項目が `NOTICE` にある。**`run-loop` の `environment` は `run_loop.py` の節に要る**(`run_eval.py` の節の項目 5 では代用にならない) |
| `--help` | S2-3 | スモークで 3 本を `--help` 起動。他エントリの文言を含まない |
| 打ち切りの整合 | S3-1 | Case A / B / D / `holdout: 0` / train 空。**`best_description` が現行実装と一致する** |
| 予算の紐づけ | S3-2 | `selectBest` の結果に紐づく。床が効く。**日本語 300 字と英語 900 字が同じ budget** |
| **長さの単位の一貫** | S3-2 | `description.length` が 4 箇所とも `byteLength` へ移り、transcript のキーが `byte_count` / `rewrite_byte_count` になっている |
| `${" "}` の保持 | S3-2 | 末尾の空白込みの部分文字列を照合 |
| ブロックスカラー | S3-3 | `agent-creator` の実ファイルで 1154 バイト |
| eval の形 | S4-3 / S4-4 | 6 本とも `20 10 20` |
| 60 spawn の健全性 | S5-2 | `errors` が 0、`~/.claude.json` が無傷 |
| 短縮の優位 | S5-6 | 比較 A(60 問)と比較 B(40 問)の突き合わせ |
| 基準 6 の判別力 | S5-6 | 12 問の合否。両案 3/3 の問が無い |
| 配布物 | S6-4 | `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build` + `scripts/` の差分なし |

---

## 判断が要る場面

| 場面 | 誰が決めるか |
| --- | --- |
| S1-7 相 3 Step 6 の陽性対照が落ち、原因が「権限ルールの消失と第 1 ツール打ち切りの合成」だったとき | ユーザー。設計書 §15 の想定リスクが実現しており、隔離方式の再検討が要る |
| S1-7 が落ち、隔離方式そのものが成立しないと分かったとき | ユーザー。設計書 §3.5.1 の取り下げ案を含む再検討になる |
| S4-3 / S4-4 の差し替え後の 24 問が妥当かどうか | ユーザー。S4-3 Step 3 の「人が見る 5 項目」を判断する |
| S5-1 の比較 B の 600 バイト案 2 本 | ユーザー。全文を見て承認する。却下なら指摘を反映して再提示する |
| S5-2 で `~/.claude.json` が壊れたときに `--num-workers` を下げるか | ユーザー。**実測では 10 並列 × 2 バッチで問題が出ておらず、下げる根拠は出ていない** |
| 測定の途中で `claude` CLI が更新されたとき、17 本を捨てて測り直すか | ユーザー(ロールバックの手順 §F) |
| S5-6 の突き合わせが「判定不能 × 判定不能」だったとき、測り直すか保留にするか | ユーザー |
| S5-6 Step 5 で衝突が実在したとき、eval スキーマを拡張するか | ユーザー。設計の変更にあたる |
| S5-6 Step 5 で条件 2 だけが成り立ったとき、(d) やラチェットへ進むか | ユーザー。設計の変更にあたる |
| S6-4 で ARCHITECTURE への影響があるかどうか | ユーザー。影響があるなら `metatron:updating-architecture` を起動する |
| 設計書 §13.3 の測定回数(960)を 1140 へ改訂するか | ユーザー(未解決 P8) |

---

## 本計画が下した決定

**設計書が定めていない事項のうち、本計画で値を固定したもの。** 実装担当はこれらを未決として扱わない。**変えたくなったらユーザーへ差し戻す。**

| # | 事項 | 決定 | 根拠 |
| --- | --- | --- | --- |
| D1 | 測定記録の置き場 | `plugins/prompt-smith/docs/measurement-2026-09-17.md`(新規)。S1-7 が作り、S2-5 / S4-4 / S5-7 が**節を追記する** | 設計書 §2.2「根拠は `plugins/prompt-smith/docs/` に置く」。`skill-creator-port-rationale.md` は移植の経緯の文書であり、測定記録を混ぜると役割が濁る |
| D2 | 測定の生データの保存先 | `~/prompt-smith-measure-2026-09-17/`(**リポジトリ外**)。probe 資産は `~/prompt-smith-probe/` | `git status --porcelain=v1` の前後完全一致が項目 1 の中心的な合格条件である(設計書 §3.9) |
| D3 | バックログ §1 の失効行(`--bare`) | **ファイルを変更しない** | 設計書 §1.2 の「バックログは改修時の入力であり、改修後の正本ではない」を編集不要の根拠と読んだ。§11 の変更ファイル一覧にも無い |
| D4 | `defaults.ts` の育て方 | S2-1 で `DEFAULT_MODEL` / `DEFAULTS`、S3-2 で `LENGTH_TARGET` / `LENGTH_FLOOR` / `byteLength` | 未使用の定数を段をまたいで置かない。**最終形は設計書 §5.3 と同一である** |
| D5 | `NOTICE` の更新単位 | **挙動を変えたステップのコミットへ都度含める** | Apache-2.0 §4(b) は「変更したファイルに」通知を求める。網羅は S6-4 Step 2 の条件 5 で点検する |
| D6 | `SKILL.md` を触る 4 ステップの順序 | S1-8 → S2-4 → S4-1 → S6-1 に固定 | 4 箇所は重ならないが**行番号は前のステップに依存する。** 並行編集は git の衝突も起こす |
| D7 | transcript のキー名 | `char_count` → `byte_count`、`rewrite_char_count` → `rewrite_byte_count` | 段 5 で `improve_iter_*.json` を読む(設計書 §15)。バイトを保持するキーが `char_count` だと単位を取り違える。読む側のコードは存在しない |
| D8 | 衝突観測の対象と反復 | `agent-creator`、`--max-iterations 3`、`--results-dir` 必須 | **ユーザーの決定。** `agent-creator` は比較 B の対象で改善余地が実在し、`prompt-smith` より短いぶん反復が安い |
| D9 | 比較 B の 600 バイト案の作り方 | **実装担当が `prompt-smith:prompt-smith` の規律で短縮し、全文を提示して承認を得る。2 スキルで作り方を揃える** | **ユーザーの決定。** ループに作らせると「短縮の効果」と「ループの出来」が分かれなくなる |
| D10 | S1-7 の手順の並び | 対照(リポジトリ外)→ git 基準点 → 隔離側(リポジトリルート)→ 照合 | 設計書 §3.9 の並びのままでは、対照実行が自分の合格条件を汚染する(S1-7 の冒頭に詳述) |

---

## 未解決事項

設計書 §16 の 25 項目は本計画では解かない。**本計画の作成と 2 度のレビューを経て残ったものだけを挙げる。**

| # | 事項 | 影響度 | 現状の仮定 |
| --- | --- | --- | --- |
| P8 | **本計画の測定回数(最大 1140)が設計書 §13.3 の 960 と食い違う。** 差の 180 回は設計書 §13.5 が求める衝突観測の実コストで、§13.3 の内訳に含まれていない | Low | **本計画の 1140 で進める**(ユーザーが対象と反復回数を決めた)。設計書 §13.3 の表を改訂するかは別途判断する。改訂しない場合、設計書と計画で数が食い違ったまま残る |
| P9 | **S1-7 の probe 資産(probe スキル・3 問 eval・`probe-call.mts`)を、リポジトリの固定資産にするかどうか** | Low | **リポジトリ外の一時資産とする。** 中身は本計画に全文があるので再現できる。ただし**隔離の回帰を将来も確かめたいなら、`src/fixtures/` へ置いて自動化する余地がある**(テスト方針は「テストが読み込む固定データは `src/fixtures/` に置く」と定める)。今回は `claude` を実起動するため自動テストにできず、要件の外に置いた |
| P10 | **`~/.claude/skills/` と `init.skills` の減少分の一対一の同定が未完のまま、S1-7 相 1 Step 2 の合格条件を「件数」だけに置いている** | Low | 設計書 §16 #17 の判断を引き継ぐ。**件数が減り、隔離側が CLI 組み込みだけの件数になれば合格とする。** 内訳の同定はしない |

---

*本計画は `harness-docs/design/2026-09-17-prompt-smith-measurement-improvement-design.md`(第 6 版)の確定内容を順序と単位へ割ったものである。設計の判断を覆す変更が要ると分かったときは、計画を直さずユーザーへ差し戻す。*
