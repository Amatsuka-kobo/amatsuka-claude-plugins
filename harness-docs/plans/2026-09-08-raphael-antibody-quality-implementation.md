# raphael 抗体の質の改善 実装計画書

- 作成日: 2026-09-08
- 対象プラグイン: `plugins/raphael`
- バージョン: `0.1.1-dev` → `0.2.0-dev`
- 設計書(正本): `harness-docs/design/2026-09-08-raphael-antibody-quality-design.md`
- 入力 context-map: `.claude/context-maps/2026-09-08-raphael-antibody-quality.md`
- 着手時の HEAD: `2eebb1e`
- 版注: 第 3 版(設計書 §1.5 の裁定 R1〜R12 を反映。第 3 版は実測 F7 に基づく裁定 R12 — 広さ検査の既定閾値 30% → 10%、保持上限と下限の据え置き確定 — の反映のみ)

この計画書は設計書からタスク分割・順序・検証方法だけを立てるものであり、設計判断を上書きしません。設計書と実装が食い違う事実を見つけたときは、実装を止めてオーケストレーターへ報告してください。報告を受けたオーケストレーターが §7「設計書との食い違い」へ追記し、設計書の修正要否を判断します。

## 1. 進め方の共通規律

- 各ステップはテストを先に書いてから実装します。テストのパスは各ステップの表に明記しています。
- **ステップは直列に進めます(裁定 R8)。** 並列グループを設けません。各ステップの完了時点で `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通ることだけを条件とします。
- **各ステップは 1 コミット単位です。** 例外はステップ 1 だけで、その中間状態は §2 のステップ 1 に明示します。
- `plugins/raphael/scripts/` は手で編集しません。`src/` を変更し `pnpm run build` で再生成し、**生成された `scripts/*.mjs` の差分を同じコミットに含めます**。`src/` を変更したすべてのコミットが対象です。
- `.raphael/antibodies/` の実データは、実機検証(§6)まで触りません。テストは `fs.mkdtempSync` の一時ディレクトリで行います。
- AI が読む指示書(`agents/antibody-synthesizer.md` / `commands/review.md` / `skills/raphael/SKILL.md`)の改修は、`prompt-smith:prompt-smith` スキルをロードした担当に行わせます。依頼文に「`prompt-smith:prompt-smith` スキルをロードしてから作業する」と明記してください。`README.md` / `DESIGN.md` / 設計書 / Serena メモリはこの対象外です。
- 委譲するタスクの依頼文には、対象ファイル・テストのパス・テスト先行・使用してよい tools・報告形式・§4 の共有契約を転記します。方針スキルはロードさせません。
- 本改修と無関係な未コミット変更(会話記録、`cliproxyapi.config.example.yaml`、抗体ファイルの既存 dirty など)は触りません。revert もしません。
- 着手前に `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` を 1 度実行し、baseline の結果(テストファイル数・テスト数)をこの計画書の §7 へ記録してください。

## 2. WBS

### ステップ 1: stats の分離・`migrate-stats`・`.gitignore`(B4 全体。裁定 R5)

**この 1 コミットが最大です。** `Antibody` 型から `stats` を外すと、参照している全モジュールとテストが同時に型エラーになるため分割できません。加えて裁定 R5 により、**移行手段(`migrate-stats`)と `.gitignore` の追記を同じコミットに含めます。** reader の猶予だけがあって移行手段が無い中間コミットを残さないためです。

| 項目 | 内容 |
| --- | --- |
| 変更ファイル | `src/lib/types.ts`(`Antibody` から `stats` 削除、`AntibodyStats` を移設)/ `src/lib/stats-store.ts`(**新規**)/ `src/lib/frontmatter.ts`(旧 `stats` ブロックの読み飛ばしと `parseAntibodyMarkdownWithLegacy`、serializer と `validateAntibody` から `stats` 除去)/ `src/lib/antibody-store.ts`(`recordAntibodyFire` 削除、`createAntibody` から `stats` 初期値削除)/ `src/lib/match-antibody.ts`(`matchAntibodies` の options に `stats` を受け取り、`compareAntibodies` がそこから `last_fired` を引く)/ `src/inoculate.ts`(`recordFires` へ切り替え、**fire 記録と state 保存をそれぞれ個別の try で包み、どちらが失敗しても注入する**(裁定 R7)、`state.injected` へ `recurrence_key: null` を暫定で入れる)/ `src/update-antibody.ts`(`extend` と `record-fire` を `stats-store` 経由へ、`migrate-stats` operation の追加、`--dry-run` の許可対象に `migrate-stats` を加える)/ `src/list-antibodies.ts`(`stats.json` から join、`MISSES` 列追加)/ `src/check-distill-needed.ts`(`pruneOrphanStats` の呼び出し追加)/ `.gitignore`(ルート。「# Raphael」節 L18-22 へ `.raphael/stats.json` と `.raphael/commands.jsonl`) |
| 追加テスト | `src/lib/__test__/stats-store.test.ts`(**新規**。load / save / 欠損 / **破損の 3 条件**(JSON parse 失敗・top-level が object でない・`antibodies` が object でない)/ **個別 entry の型不正でその entry だけ初期値になり全体は保持されること** / `statsFor` の既定値 / `recordFire` / `recordFires` / `recordMiss` / **`last_fired` / `last_miss` の merge が max になること** / `pruneOrphanStats` / atomic 置換)。`src/lib/__test__/frontmatter.test.ts`(旧形式が読めること、`legacyStats` が返ること、serialize で `stats` が消えること、`validateAntibody` が `stats` key を `antibody.stats: is not supported` で拒否すること、round-trip)。`src/lib/__test__/match-antibody.test.ts`(`stats` を options で渡したときの並び順、未指定なら全件 `last_fired: null` 扱い)。`src/__test__/update-antibody.test.ts`(`migrate-stats`: 旧形式 3 件を移行し `stats.json` へ値が移ること・`.md` から `stats` が消えること / 2 回目の実行が `migrated: 0` を返すこと / `--dry-run` が何も書かないこと / 既存 `stats.json` の値と `max` で merge されること / パースできないファイルが `errors` に載り触られないこと / 抗体 0 件で `migrated: 0`)。`src/__test__/inoculate.test.ts`(**`recordFires` が投げても `additionalContext` が出ること / `saveState` が投げても出ること / 両方投げても出ること**)。既存 5 ファイル(`antibody-store` / `inoculate` / `update-antibody` / `list-antibodies` / `check-distill-needed`)の fixture から `stats` ブロックを除去し、必要なものは `stats.json` を組み立てる形へ書き換え |
| 完了条件 | `pnpm run lint` / `typecheck` / `test` が全体で通る。`pnpm run build` の差分が同コミットにある。`stats.json` が無い project で `inoculate` が従来どおり注入すること、**fire 記録に失敗しても state 保存に失敗しても `additionalContext` が出ること**がテストで固定されている。旧形式の抗体 `.md` が読めることと、`migrate-stats` の冪等性がテストで固定されている。`.gitignore` の 2 行が入っている |

**中間状態の許容。** このステップの作業中に限り、型エラーとテスト失敗が残る状態を許容します。許容するのは上表の「変更ファイル」と「追加テスト」に挙げた範囲だけです。それ以外にエラーが出た場合は、原因を解消してからステップ 1 を完了とします。コミット時点ではエラー 0・テスト全 green です。

**注意。** `src/update-antibody.ts` の `triggerField`(L279-291)は `validateAntibody` へダミー抗体を渡して trigger だけ検証しています。ダミーから `stats` を外してください。`src/lib/antibody-store.ts` の `createAntibody`(L151-160)も同様です。

### ステップ 2: A0 コマンド履歴 `.raphael/commands.jsonl`(裁定 R2)

広さ検査(ステップ 7)と audit(ステップ 9)の母集団を作る土台です。**この 2 つより先に入れる必要があります。**

| 項目 | 内容 |
| --- | --- |
| 変更ファイル | `src/lib/command-log.ts`(**新規**。`commandLogPath` / `appendCommandLog` / `readCommandLog` / `truncateCommandLog`。いずれも例外を投げない)/ `src/detect-infection.ts`(`processBash` で成功・失敗を問わず 1 行追記。`PostToolUse` と `PostToolUseFailure` の両方)/ `src/check-distill-needed.ts`(Stop 時に 2,000 行へ切り詰め) |
| 追加テスト | `src/lib/__test__/command-log.test.ts`(**新規**。追記と読み取りの往復 / parse できない行の読み飛ばし / ファイル不在で空配列 / 2,000 行超が先頭から切り詰められること / 書き込み不能な path で例外を投げないこと)。`src/__test__/detect-infection.test.ts`(成功コマンドでも 1 行増えること / 失敗コマンドでも 1 行増えること / `exit_code` と `failed` が `classifyCommandOutcome` の結果と一致すること / 追記に失敗しても `recent_commands` の更新と infection 記録が続くこと)。`src/__test__/check-distill-needed.test.ts`(切り詰めが行われること / 切り詰めに失敗しても cleanup 全体が止まらないこと) |
| 完了条件 | lint / typecheck / test が通る。build 差分が同コミットにある。**追記も切り詰めも失敗が握り潰されること**がテストで固定されている |

### ステップ 3: A1 benign 既定リストの拡張と正規化(裁定 R3)

| 項目 | 内容 |
| --- | --- |
| 変更ファイル | `src/lib/detect-command.ts`(`EXTENDED_BENIGN_RUNNERS` / `EXTENDED_BENIGN_SCRIPTS` の追加、**設計書 §4.1 の正規化 5 段**、拡張リストを exit 1 と 2 の両方へ適用、`isBenignExit1Command` に `extendedEnabled` 引数、`SIGNAL_EXIT_CODES = {130, 137, 143}` の判定)/ `src/lib/config.ts`(`benign_exit1_extended` の parse)/ `src/lib/types.ts`(`RaphaelConfig.benignExit1Extended`)/ `src/detect-infection.ts`(config を `classifyCommandOutcome` / `detectCommandFailure` へ渡す経路) |
| 追加テスト | `src/lib/__test__/detect-command.test.ts`(設計書 §9.1 (a) の分類表を網羅。TDD red の exit 1 / `pnpm run typecheck` の **exit 2** / 正規化 5 段(`cd x && pnpm vitest` / `pnpm --dir x vitest` / `TZ=UTC pnpm vitest` / `pnpm -C x run test` / `pnpm exec biome` / 絶対パスの `.bin/tsc`)/ `grep` の exit 2 は failure のまま / exit 130・137・143 は non-failure / **exit 128・129 は failure のまま** / `pnpm test:unit` が `pnpm test` に一致しないこと / `benign_exit1_extended: false` で拡張分と正規化がまとめて無効になること / `benign_exit1_commands` の追加が拡張の有無に関わらず効くこと)。`src/lib/__test__/config.test.ts`(新 key の既定値と不正値のフォールバック)。`src/__test__/detect-infection.test.ts`(拡張リストに一致する失敗が infection として記録されないこと) |
| 完了条件 | lint / typecheck / test が通る。build 差分が同コミットにある。既存の benign 8 件の挙動が変わっていないこと(exit 1 限定・正規化なし)がテストで固定されている |

### ステップ 4: 再発キーの導入(裁定 R1)

**schema は変えません。** 保存フィールドを足さず、読み取り時に計算する純関数だけを足します。

| 項目 | 内容 |
| --- | --- |
| 変更ファイル | `src/lib/recurrence.ts`(**新規**。`recurrenceKey(kind, target)` と kind ごとの target 抽出。`retry-loop` は kind ラベル `command-failure` を使う)/ `src/lib/infection-store.ts`(**純関数 `recurrenceKeyOf(record)` の追加のみ。`validateRecord` と書き込み経路は触らない**) |
| 追加テスト | `src/lib/__test__/recurrence.test.ts`(**新規**。4 kind の target 抽出、同一コマンドの複数失敗で値が一致すること、`command-failure` と `retry-loop` の同一コマンドが同じ鍵になること)。`src/lib/__test__/infection-store.test.ts`(`recurrenceKeyOf` が `details` だけから計算されること、既存 178 件と同じ形の record — 保存フィールドを持たない record — で値が得られること) |
| 完了条件 | lint / typecheck / test が通る。build 差分が同コミットにある。**`InfectionRecordV1` の型と JSONL の書き込み内容が本ステップで変わっていない**ことを diff で確認済み |

### ステップ 5: A2 自己解決(裁定 R9)

| 項目 | 内容 |
| --- | --- |
| 変更ファイル | `src/lib/types.ts`(`recent_commands` へ `resolved?`、`InfectionRecordV1` へ `resolved?` / `resolved_at?`)/ `src/lib/state-store.ts`(`isRecentCommand` の任意フィールド検査 — **型不正はそのフィールドだけ初期値にして entry は捨てない** —、`slice(-20)` → `slice(-50)`)/ `src/lib/infection-store.ts`(`markInfectionsResolved`、`validateRecord` の任意フィールド検査)/ `src/detect-infection.ts`(成功時の突合せと解決記録、`slice(-20)` → `slice(-50)`)/ `src/check-distill-needed.ts`(resolved の 14 日 retention) |
| 追加テスト | `src/__test__/detect-infection.test.ts`(設計書 §9.1 (c)。失敗 → 成功で `resolved` が付くこと / **benign と判定された exit 1 では resolved にしないこと** / **benign と判定された exit 2 では resolved にしないこと** / **`exit_code` が `null` では resolved にしないこと** / 2 回目の成功では数えないこと / 別コマンドの成功では解決しないこと / session が変われば解決しないこと / 解決処理が失敗しても成功コマンドの記録が続くこと)。`src/lib/__test__/state-store.test.ts`(上限 50、`resolved` の検査、型不正時のフィールド単位の縮退)。`src/lib/__test__/infection-store.test.ts`(`markInfectionsResolved` の冪等性)。`src/__test__/check-distill-needed.test.ts`(resolved かつ 14 日超の record が削除されること、`resolved_at` が parse できない record は削除しないこと) |
| 完了条件 | lint / typecheck / test が通る。build 差分が同コミットにある。**成功条件が `failed === false && exit_code === 0` であることがテストで固定されている** |

### ステップ 6: A3 蒸留閾値と nag のプロジェクト単位化(裁定 R6)

| 項目 | 内容 |
| --- | --- |
| 変更ファイル | `src/check-distill-needed.ts`(`CleanupResult` に `unresolvedRecurrenceKeys`、閾値判定の変更、nag digest の保存先変更、`buildReason` の文面、**書き込み失敗時に block しない**)/ `src/lib/state-store.ts`(`last_distill_nag_digest` の削除、`validateState` から検査除去)/ `src/lib/types.ts`(同)/ `src/lib/stats-store.ts`(`setNagDigest` の利用) |
| 追加テスト | `src/__test__/check-distill-needed.test.ts`(設計書 §9.1 (d)(h)。同一コマンドの 3 回失敗では催促しない / 異なる 3 コマンドでは催促する / resolved を除外する / distilled を除外する / session をまたいで同じ集合では再催促しない / 集合が変われば再催促する / `stats.json` 欠損時は催促する / **`stats.json` の書き込みに失敗したときは `decision:"block"` を出さないこと**)。`src/lib/__test__/state-store.test.ts`(旧 `last_distill_nag_digest` を持つ state.json が読めること) |
| 完了条件 | lint / typecheck / test が通る。build 差分が同コミットにある。**digest の保存に失敗したときに block しないことがテストで固定されている**(現行 `run()` L131-152 と同じ挙動) |

### ステップ 7: B1 広さ検査(裁定 R2)

| 項目 | 内容 |
| --- | --- |
| 変更ファイル | `src/lib/breadth.ts`(**新規**。`buildBreadthCorpus` は `commands.jsonl` だけを読む — **全件から重複排除し上限 2,000 件。直近 N 件の窓は設けない**(裁定 R12)— / `evaluateBreadth`)/ `src/lib/config.ts`(`breadth_max_ratio`(**既定 10**)/ `breadth_min_corpus`(既定 50))/ `src/lib/types.ts`(`RaphaelConfig` の 2 key)/ `src/update-antibody.ts`(`create` と trigger を含む `patch` の preflight、`PATTERN_TOO_BROAD`、成功時の `breadth` フィールド) |
| 追加テスト | `src/lib/__test__/breadth.test.ts`(**新規**。母集団が `commands.jsonl` だけから作られること / **infection JSONL と `state.recent_commands` を含まないこと** / 重複排除・コードポイント昇順・2,000 件上限 / 一致率計算 / **既定閾値が 10 であること** / ちょうど 10% は通り 10% 超で拒否 / `samples` が一致集合のコードポイント昇順先頭 5 件で決定的)。`src/__test__/update-antibody.test.ts`(設計書 §9.1 (e)。母集団 49 件で `corpus_too_small` / 50 件で検査 / 広い pattern の `create` が拒否され抗体ファイルが作られないこと / exit code 2 / `patch --dry-run` でも拒否されること / trigger を含まない `patch` では検査しないこと / `Edit` trigger が `tool_not_applicable` / config で閾値を変えられること)。`src/lib/__test__/config.test.ts`(新 key) |
| 完了条件 | lint / typecheck / test が通る。build 差分が同コミットにある。拒否時に抗体ファイルが作成・更新されていないことがテストで固定されている |

### ステップ 8: B2 misses と ineffective

| 項目 | 内容 |
| --- | --- |
| 変更ファイル | `src/lib/types.ts`(`injected` へ `recurrence_key`、`RaphaelConfig` の 3 key)/ `src/lib/state-store.ts`(`isInjected` の検査 — **型不正はそのフィールドだけ `null` にして entry は捨てない**)/ `src/lib/config.ts`(`miss_window_minutes` / `ineffective_min_fired` / `ineffective_miss_ratio`)/ `src/lib/stats-store.ts`(`isIneffective(stats, config)`)/ `src/inoculate.ts`(注入時の `recurrence_key` 記録。ステップ 1 で入れた暫定 `null` を本実装へ)/ `src/detect-infection.ts`(失敗記録時の突合せと `recordMiss`)/ `src/list-antibodies.ts`(`ineffective` フィールドと `--ineffective` フィルタ、`MISSES` 列はステップ 1 で導入済み) |
| 追加テスト | `src/__test__/inoculate.test.ts`(Bash 注入で `recurrence_key` が記録されること / Edit・Write では `null` / **記録に失敗しても注入が続くこと**)。`src/__test__/detect-infection.test.ts`(設計書 §9.1 (f)。窓内で加算 / 窓外では加算しない / 別 recurrence_key では加算しない / 同一抗体を 2 重に数えない / `retry-loop` の record でも同じ鍵で突き合わせられること / `recordMiss` の失敗で記録処理が止まらないこと)。`src/lib/__test__/stats-store.test.ts`(`fired:9,misses:9` は false / `fired:10,misses:5` は true / `fired:10,misses:4` は false / config で閾値を変えられること)。`src/__test__/list-antibodies.test.ts`(`--ineffective` フィルタ、`ineffective` フィールド、`--status` との AND) |
| 完了条件 | lint / typecheck / test が通る。build 差分が同コミットにある |

### ステップ 9: C `audit` operation(裁定 R4)

| 項目 | 内容 |
| --- | --- |
| 変更ファイル | `src/update-antibody.ts`(`audit` operation、`--dry-run` の許可対象に加える) |
| 追加テスト | `src/__test__/update-antibody.test.ts`(抗体 0 件で空結果 / `expired` が対象外 / **`recommendation` の 4 通り**(`noisy && ineffective` → `expire`、`noisy` のみ → `narrow`、`ineffective` のみ → `expire`、どちらでもない → `keep`)/ 並び順(expire → narrow → keep、同順位は ratio 降順 → id 昇順、`checked:false` は ratio 末尾)/ `summary` の集計 / 読み取り専用であること — 実行後に抗体ファイル・`stats.json`・`commands.jsonl` の内容が変わらないこと / 母集団不足のとき全件 `corpus_too_small` で `noisy` が付かないこと / **`thresholds.breadth_max_ratio` が既定で `10` として返ること**(裁定 R12)/ **ratio がちょうど 10% の抗体に `noisy` が付かず、10% 超で付くこと**) |
| 完了条件 | lint / typecheck / test が通る。build 差分が同コミットにある。**読み取り専用であることがテストで固定されている** |

### ステップ 10: 指示書の改修(B3 と review 導線)

**`prompt-smith:prompt-smith` をロードした担当に委譲します。** 設計書の変更前・変更後の文言を依頼文へ転記し、担当が文言を創作しないようにします。3 ファイルは互いに重なりませんが、裁定 R8 により**直列に進めます**(10a → 10b → 10c)。

| ID | 内容 | 対象 |
| --- | --- | --- |
| 10a | B3 の二問(設計書 §4.6)。L16 の「一問だけ」を二問へ。**問 2 は synthesizer 自身が判定し、判定基準は「このリポジトリのファイルパス・スクリプト名・設定値・ディレクトリ構成に依存する記述を body に含むなら No、言語やツールチェーンの一般的な挙動なら Yes」であることを明記**。L47-51 の節見出しと本文を追随。L38-46 に misses / ineffective を判断材料として使える旨を追記。L76-90 の create preflight へ `PATTERN_TOO_BROAD` 時の代替行動を追加 | `agents/antibody-synthesizer.md` |
| 10b | 一覧の並び順(ineffective 優先)と表示列(misses / last_miss / ineffective)。対象選択に `audit 結果を順にレビュー` を追加。操作選択に `格下げ`(confirmed のときだけ)を追加。counter に `downgraded` を追加し summary table にも反映。confirmed かつ ineffective の警告表示。**audit の推奨値は `expire` / `narrow` / `keep` の 3 値であることと、`noisy` の意味** | `commands/review.md` |
| 10c | 蒸留通知の契機を「未解決の失敗の種類数」へ。保存先に `stats.json` と `commands.jsonl` を追加。**trigger の粒度の規律を新設**(設計書 §8 の 4 箇条) | `skills/raphael/SKILL.md` |

- 完了条件: 3 ファイルとも、他プラグインの名前を含まないこと。`raphael:antibody-synthesizer` 以外のサブエージェント名を書かないこと。CLI の呼び出し例が実装と一致すること(`--ineffective` / `migrate-stats` / `audit` の綴りと operand 数)。
- このステップは `src/` を変更しないため、build は不要です。lint / typecheck / test は通ったままです。

### ステップ 11: DESIGN.md と README.md の追随

| 項目 | 内容 |
| --- | --- |
| 変更ファイル | `plugins/raphael/DESIGN.md`(設計書 §6 の表の全項目。**L76 の `node26` → `node22` の誤記修正**と、新節 5.3(`stats.json`)・5.4(`commands.jsonl`)を含む)/ `plugins/raphael/README.md`(設計書 §6 の表の全項目。移行手順の新節を含む) |
| 追加テスト | なし |
| 完了条件 | DESIGN.md の config 表が `src/lib/config.ts` の `DEFAULT_CONFIG` と 1 対 1 で一致すること。README の config テンプレートに新 key 6 件が入っていること。operation 表に `migrate-stats` と `audit` があること。データ保存先の表に `stats.json` と `commands.jsonl` の行があること。`.gitignore` の追記はステップ 1 で済んでいるので**ここでは触らない** |

### ステップ 12: 版上げ・ルート README・メモリ・ARCHITECTURE 判断

| 項目 | 内容 |
| --- | --- |
| 変更ファイル | `plugins/raphael/.claude-plugin/plugin.json`(`0.2.0-dev`)/ `plugins/raphael/package.json`(`0.2.0-dev`)/ `README.md`(ルート。L51 の一覧行と L76-79 の raphael 節に、質による選別 — 広さ検査と効果フィードバック — を反映)/ Serena メモリ **`raphael/core`**(実体は `.serena/memories/raphael/core.md`。内容を読み、本改修と食い違う記述を Serena の `edit_memory` で更新) |
| 追加テスト | なし |
| 完了条件 | 2 つの version が同じ値。ルート README に反映済み。メモリ `raphael/core` に stats と commands の所在・新 operation・新 config key の記述が反映されている。`harness-docs/ARCHITECTURE.md` を実際に読んで raphael への言及の有無を確認し、影響があれば `/metatron:update` で追随させている(無ければ「影響なし」と報告する) |

### ステップ 13: 実機検証

§6 の手順を実施します。コミットは不要ですが、結果をオーケストレーターへ報告します。

## 3. 依存関係と進行順

**直列に進めます(裁定 R8)。** 並列グループは設けません。

```
1 (stats 分離 + migrate-stats + .gitignore)
→ 2 (commands.jsonl)
→ 3 (benign 拡張)
→ 4 (再発キー)
→ 5 (自己解決)
→ 6 (閾値と nag)
→ 7 (広さ検査)
→ 8 (misses と ineffective)
→ 9 (audit)
→ 10 (指示書 10a → 10b → 10c)
→ 11 (DESIGN / README)
→ 12 (版上げ・メモリ・ARCHITECTURE)
→ 13 (実機検証)
```

順序の根拠は次のとおりです。

| 順序 | 理由 |
| --- | --- |
| 1 が最初 | `Antibody` 型の変更が全モジュールに波及するため、他の変更と混ぜられません |
| 2 が 7・9 より前 | 広さ検査と audit の母集団が `commands.jsonl` だからです(裁定 R2) |
| 4 が 5・6・8 より前 | 自己解決の集計・閾値・miss の突合せがいずれも再発キーを使います |
| 5 が 6 より前 | 閾値の集計が `resolved` を除外します |
| 7・8 が 9 より前 | audit の `noisy` は広さ検査、`ineffective` は misses に依存します |
| 10 が 9 の後 | CLI の operation 名と error code が確定してからでないと、指示書の例が実装と食い違います |
| 11・12 が最後 | 文書は実装が確定してから追随させます |

**担当帯。** ステップ 1・4・7 は「複雑または重要な実装」、ステップ 2・3・5・6・8・9 は「通常の実装」、ステップ 10 は「通常の実装」(`prompt-smith:prompt-smith` をロード)、ステップ 11・12 は「軽量な実装」、ステップ 13 はオーケストレーター自身または「E2E 動作検証」の帯へ委譲します。**1 メッセージにつき 1 ステップだけを dispatch します。**

## 4. ステップ間で共有する契約

委譲する各タスクの依頼文へ、関係する項目を転記してください。

1. **`stats.json` の schema**(設計書 §3.4)。`schema_version: 1`、`antibodies` は ID をキーとする map、`distill.last_nag_digest`。**破損は「JSON parse 失敗 / top-level が object でない / `antibodies` が object でない」の 3 条件だけ**で、その場合のみ全体を初期値とみなす。個別 entry の型不正はその entry だけ初期値。**例外を投げない。**
2. **`commands.jsonl` の schema**(設計書 §3.6)。`{ts, session, normalized_command, exit_code, failed}` の 1 行 JSON。成功・失敗を問わず PostToolUse で追記。Stop で 2,000 行へ切り詰め。読み書きとも例外を投げない。
3. **再発キーの計算式**(設計書 §3.2)。`sha256Hex(kind + "\0" + target)`。target は kind ごとの安定射影。**JSONL には保存せず、読み取り時に `details` から計算する。** `retry-loop` は kind ラベル `command-failure` を使う。
4. **error code の書式**。既存 CLI に合わせて大文字スネーク。新設は `PATTERN_TOO_BROAD` の 1 つだけ。exit code は validation 系なので 2。
5. **CLI の返り値**。1 行 JSON。成功は `{"ok":true,...}`、失敗は `{"ok":false,"error":{"code","message","field?"}}`。
6. **フェイルオープン**。stats の読み書き、`commands.jsonl` の追記と切り詰め、再発キーの計算、miss の加算、広さ検査の母集団構築は、いずれも失敗しても hook を止めない。
   - `inoculate.ts`: fire 記録と state 保存をそれぞれ個別の try で包み、**どちらが失敗しても `additionalContext` を出す**(裁定 R7)。
   - `detect-infection.ts`: `logError` に流して処理を続ける。
   - `check-distill-needed.ts`: `logError` に流す。**nag digest の書き込みに失敗したときは `decision:"block"` を出さない**(裁定 R6)。
7. **config の追加 key と既定値**(6 件)。

| key | 既定 | 型・範囲 |
| --- | ---: | --- |
| `benign_exit1_extended` | `true` | boolean |
| `breadth_max_ratio` | `10` | 整数 1–100 |
| `breadth_min_corpus` | `50` | 整数 1–5000 |
| `miss_window_minutes` | `30` | 整数 1–1440 |
| `ineffective_min_fired` | `10` | 整数 1–1000 |
| `ineffective_miss_ratio` | `50` | 整数 1–100 |

8. **テスト配置**。`plugins/**/__test__/**/*.test.ts` の外は実行されません。ヘルパーは `__test__/helpers/`、fixture はテストファイル内にインライン(`src/fixtures/` は作らない)。

## 5. Done の条件

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` がすべて通る。
- `plugins/raphael/src/` を変更したすべてのコミットで `pnpm run build` を実行し、`plugins/raphael/scripts/` の差分が同じコミットに含まれている。
- `plugins/raphael/.claude-plugin/plugin.json` と `plugins/raphael/package.json` の `version` がともに `0.2.0-dev`。
- ルート `README.md` の raphael 節に本改修が反映されている。
- Serena メモリ `raphael/core` が本改修と食い違わない。
- `harness-docs/ARCHITECTURE.md` への影響有無を実際に確認済み。影響があれば `/metatron:update` で追随済み。
- §6 の実機検証がすべて成功している。

## 6. 実装後の実機検証手順

このリポジトリ自身(`/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins`)を対象に、新しいセッションで行います。hook は再起動しないと反映されないため、**必ずセッションを再起動してから始めてください。**

### 検証 0: 移行(前提)

```bash
printf '{}' | node plugins/raphael/scripts/update-antibody.mjs --dry-run migrate-stats
printf '{}' | node plugins/raphael/scripts/update-antibody.mjs migrate-stats
```

- `migrated` が 56 前後であること(実行時点の抗体数)。
- `.raphael/stats.json` が生成され、`fired` の合計が移行前の frontmatter の合計と一致すること。
- 抗体ファイルから `stats` ブロックが消えていること。
- この時点では抗体ファイル全件が dirty になります。内容を確認してコミットします。

### 検証 1: 意図した失敗を 3 回起こしても催促が出ない

```bash
pnpm vitest run plugins/raphael/src/lib/__test__/frontmatter.test.ts -t "存在しないテスト名"
```

のように、**exit 1 で終わるテストランナーの実行を 3 回**行い、セッションを終了します。

- 期待: `.raphael/infections/` に新しい `command-failure` record が**増えないこと**(benign 拡張により failure と判定されない)。
- 期待: `.raphael/commands.jsonl` には**行が増えること**(成功・失敗を問わず記録するため)。
- 期待: Stop hook が蒸留催促を**出さないこと**。
- 対照として、意図しない失敗(存在しないコマンド、例: `node plugins/raphael/scripts/no-such-file.mjs`)を 3 種類実行した場合は、record が 3 件記録され、再発キーが 3 種類になり、催促が出ることを確認します。同じコマンドを 3 回繰り返した場合は種類数 1 なので催促が出ないことも確認します。
- 対照として、`git status` を存在しないリポジトリで実行するなどして **exit 128 が failure として記録されること**も確認します。

### 検証 2: 無関係な読み取りコマンドに抗体が付かない

`ab-2026-0803-002` の pattern は `&&.*[|;]` です。`&&` の後にパイプまたはセミコロンが要ります。**実際に pattern へ一致する形**のコマンドを使います。

```bash
ls -la && cat plugins/raphael/README.md | head -3
```

このコマンドは失敗と何の関係もない読み取り専用の操作です。

- 期待: `ab-2026-0803-002` が注入されないこと(pattern を絞るか失効させた**後**の確認です。対処前は一致するため注入されます)。
- 期待: 母集団が育ったあとの `audit` で、`ab-2026-0803-002`(pattern `&&.*[|;]`)が **`noisy: true`**(`breadth.ratio` が既定閾値 10% を超える)であり、`recommendation` が **`narrow` 以上**(`narrow` または `expire`)であること。**この判定は上のコマンド 1 本に対するものではなく、`commands.jsonl` の母集団全体に対する一致率で決まります。** 実測(設計書 §1.1 の F7)では同抗体の一致率は 23.96% です。
- **`ab-2026-0810-001`(pattern `pnpm.*lint`)は期待値から外します。** 実測の一致率は 4.36% であり、既定閾値 10% を下回るため `noisy` になりません。**lint 系の抗体は広さ検査では捕まらず、B2 の `misses`(`ineffective`)で判定されます。** 広さ検査だけを見て「lint 系が捕まらないのは不具合だ」と判断しないでください。
- **母集団を先に育てます。** `commands.jsonl` の一意コマンド数が 50 件を超えるまで通常の作業を行ってから audit を実行します。件数は次で確認します。

```bash
wc -l .raphael/commands.jsonl
printf '{}' | node plugins/raphael/scripts/update-antibody.mjs audit
```

- 期待: `ab-2026-0803-002` の `breadth.ratio` が閾値 10% を超え、`noisy: true` であること。`audit` の返り値の `thresholds.breadth_max_ratio` が `10` であること。
- 期待: `/raphael:review` の `audit 結果を順にレビュー` で、この抗体が queue の先頭付近に並ぶこと。
- 対処(pattern を絞る、または失効させる)後、同じ読み取りコマンドを実行して注入されないことを確認します。

### 検証 3: `migrate-stats` 後に抗体が dirty にならない

検証 0 のコミット後、通常の作業を 10 分ほど行い(抗体が何度か注入される状態にして)、次を実行します。

```bash
git status --porcelain .raphael/antibodies/
git status --porcelain .raphael/stats.json .raphael/commands.jsonl
```

- 期待: **どちらの出力も空であること。** 発火は `stats.json` にだけ記録され、抗体ファイルは変更されません。`stats.json` と `commands.jsonl` は `.gitignore` により追跡されません。

### 報告

検証 0〜3 の結果と、期待と異なった点をオーケストレーターへ報告します。異なった点があれば §7 へ追記します。

## 7. 設計書との食い違い

実装中に発見した、設計書の記述と実際のコードの食い違いをここへ追記します。実装者は自分で設計を変えず、報告してください。

### #1 `stats.json` の「schema 不一致」の扱い(ステップ 1 で発見。設計書内の記述の食い違い)

- **事実**: 設計書 §3.4 の箇条書き 2 番目は「欠損・**破損・schema 不一致**のいずれでも、全体を初期値とみなします」と書いています。一方、直後の箇条書き 3 番目(裁定 R11)は「『破損』の定義。次の**いずれかに当てはまるときだけ**、全体を初期値とみなします」として、(1) JSON parse 失敗、(2) top-level が object でない、(3) `antibodies` が object でない、の 3 条件を排他的に列挙しています。この 3 条件に `schema_version` の不一致は含まれません。実装計画書 §4 の共有契約 1 も「破損は 3 条件だけ」と明記しています。
- **判断**: 後から出た、より具体的で排他的な裁定 R11 の 3 条件を正とします。`schema_version` の値だけが 1 でないファイルは全体初期化せず、有効な entry を保持したまま返り値を `schema_version: 1` へ正規化します。現時点で `schema_version` は 1 しか存在せず、仮に将来 2 が来ても entry の型検査が個別に落とすため、この扱いで整合します。
- **反映**: 実装は 3 条件のみで全体初期化します。設計書 §3.4 の箇条書き 2 番目の「schema 不一致」という語は、3 番目の定義に吸収されるものとして扱います(設計判断の変更ではありません)。

### #2 リビルドした hook スクリプトは即座にライブになる(ステップ 1 完了後に発見)

- **事実**: §6 は「hook は再起動しないと反映されないため、必ずセッションを再起動してから始めてください」と書いていますが、hook の登録内容は `node <plugin>/scripts/<name>.mjs` というコマンド行であり、Node はそのファイルを毎回新しく読み込みます。したがって `pnpm run build` で `scripts/*.mjs` を再生成した時点で、実行中のセッションでも新しいコードが動きます。実際、ステップ 1 のビルド直後から `.raphael/stats.json` が実データ側に生成され、発火が記録され始めました。セッション再起動が要るのは `hooks.json` の登録内容そのもの(イベントとスクリプトの対応)を変えたときだけです。
- **影響**: ステップ 1 以降、`serializeAntibodyMarkdown` は `stats` ブロックを書きません。よって `migrate-stats` の実行前に抗体へ書き込み operation(`create` / `patch` / `extend` / `set-status`)を通すと、その抗体の frontmatter から発火統計が消えます。消えた統計は `migrate-stats` では回収できません(`legacyStats === null` となり skipped として素通りするため)。
- **判断**: 実装期間中は抗体への書き込みを行いません。具体的には、Stop hook が要求する抗体蒸留(`raphael:antibody-synthesizer` の起動)を、§6 の検証 0(`migrate-stats`)が完了するまで見送ります。未蒸留 record は蓄積したままで構いません。
- **自動失効による損失は差し迫っていない**ことを確認済みです。`matchAntibodies` が自動失効させるのは `status === "active"` かつ `expires < today` の抗体だけであり(`match-antibody.ts:66`)、`confirmed` は対象外です。2026-09-08 時点で active な抗体のうち最も早い期限は `ab-2026-0801-002` の 2026-09-14 であり、実装完了までの猶予があります。

### #3 ステップ 4 は `scripts/` の差分を生まない(ステップ 4 で発見)

- **事実**: ステップ 4 が足すのは `recurrenceKey` と `recurrenceKeyOf` の 2 つの純関数だけであり、呼び出し元の追加は本ステップでは禁止されています(呼び出し元はステップ 5・6・8 で入ります)。`plugins/raphael/build.ts` は 5 つの CLI エントリポイントを esbuild で bundle するため、どのエントリポイントからも参照されない関数は tree shaking で落とされます。結果として `pnpm run build` は成功しますが `plugins/raphael/scripts/*.mjs` の差分は生成されません。
- **判断**: このステップはソースのみの変更としてコミットします。§1 と §5 の「`src/` を変更したすべてのコミットに `scripts/` の差分がある」という規則の目的は「配布物が古いまま残らないこと」であり、build を実行して差分が出ないことは、この時点のソースに対する正しい出力が既にコミット済みであることを意味します。目的は満たされています。
- **確認**: `pnpm run build` を実行した後に `git status --porcelain -- plugins/raphael/scripts` が空であることを確認済みです。build 設定の変更も、差分を作るための呼び出し元の先取り追加も行いません。

### baseline

着手前に実行した lint / typecheck / test の結果をここへ記録してください。

- 計測日: 2026-09-08 / 計測時の HEAD: `2108a5b`
- `pnpm run lint`: 成功(exit 0)。373 ファイルを検査、fixes なし、info 4 件。
- `pnpm run typecheck`: 成功(exit 0)。`tsc --noEmit` がエラー 0。
- `pnpm run test`: 成功(exit 0)。テストファイル 153 passed / 1 skipped(計 154)、テスト 2046 passed / 2 skipped(計 2048)。

## 8. 未解決事項

設計書 §12 の N1〜N7 をそのまま引き継ぎます。**第 1 版で挙げた N1〜N3 のうち、実装の着手前に確認が要るものは残っていません。**

| # | 内容 | 影響するステップ | 状態 |
| --- | --- | --- | --- |
| N1 | 再発キーの target を、`command-failure` 以外の 3 kind で安定射影に置き換えている(裁定 #1 の文言との差分)| ステップ 4 | 裁定 R1 により保存フィールドでなくなったため、JSONL の互換に影響しない。**着手前の確認は不要** |
| N2 | error code を `PATTERN_TOO_BROAD`(大文字)にしている(裁定 #5 の文言との差分)| ステップ 7 | 既存 CLI の契約に合わせる。確認不要 |
| N3 | 広さ検査を `trigger.tool` が `Bash` / `*` のときに限定している | ステップ 7、9 | 母集団がコマンド列であるため。**ユーザーが許容済み(Edit / Write は様子見)。** 確認不要 |
| ~~N7~~ | ~~`commands.jsonl` の保持上限 2,000 行と母集団の下限 50 件は設計時の判断であり、実測の裏付けが無い~~ | ステップ 2、7、9 | **解消(裁定 R12・事実 F7)。** 実測の全履歴 1,607 件が上限 2,000 に収まるため上限は据え置き。下限 50 件も据え置き(`commands.jsonl` はプロジェクト単位のため、セッション単位の一意数の中央値 0 は判定に影響しない)。あわせて広さ検査の既定閾値を 30% → **10%** へ引き下げ済み |

N4(シグナル終了に無効化スイッチを設けない)は**ユーザーが許容済み**(kill されたコマンドを記録する運用が無いため)。N6(メモリ `raphael/core` の更新)は実装の判断に影響しません。N5 は解消済みです。
