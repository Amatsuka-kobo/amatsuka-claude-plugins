# metatron から ADR 機能と GOTCHAS 機能を消し、ARCHITECTURE とドメインマップだけを管理する

- 対象: Issue #46(親 Story #44)
- 変更するプラグイン: metatron 0.6.0-dev → 0.6.1-dev、codiel 1.1.3 → 1.1.4
- 並行する #47(codiel 1.1.5)はこの PR の後にマージする

## metatron が管理するのは ARCHITECTURE とドメインマップだけになる

ADR と GOTCHAS は環境変数によるオプトインになっていた(ADR-015)。このリポジトリでも両方を無効にしており、codiel も #45 で ADR 候補と GOTCHAS 候補を書かなくなった。受け取り手と利用者が無くなったため、両機能を消す。

この PR で次のことを行う。

- ADR・GOTCHAS に関わる 13 個のサブコマンドを消す。対象は `get adr`・`get gotchas`・`get gotchas-template`・`stage-adr`・`stage-gotcha`・`commit-gotchas`・`init-gotchas`・`append-gotcha`・`tag-gotcha`・`scan-adr-candidates`・`shrink-adr-candidate`・`scan-gotcha-candidates`・`remove-gotcha-candidate` である。
- 残る 8 個(`get config`・`get architecture`・`get domains`・`scan`・`diff-architecture`・`stage-architecture`・`commit-architecture`・`link-claude-md`)から、ADR・GOTCHAS に関わる分岐と出力を消す。
- 環境変数 `AMATSUKA_METATRON_ENABLE_ADR`・`AMATSUKA_METATRON_ENABLE_GOTCHAS` と、`metatron.config.json` の `paths.gotchas` を読まなくする。
- codiel の `metatron.config.json` の独立実装から GOTCHAS のパスを消す。
- 見出しの許可リストから `ADR 一覧` を外し、既存の ARCHITECTURE に残った `## ADR 一覧` を `stage-architecture` の削除で消せるようにする。

範囲外は次のとおりである。

- このリポジトリの `harness-docs/ARCHITECTURE.md` の ADR 一覧と `harness-docs/GOTCHAS.md` の移動は #48 で行う。ARCHITECTURE の保護パスは `references/gotchas-format.md` を名指ししており、この PR で消すファイルを #48 のマージまで指し続ける。ARCHITECTURE は `/metatron:update` でしか変えられず、ADR 一覧の移動と同じ更新で直すほうが手順が 1 回で済むため、この食い違いを許容する。
- ADR-002・ADR-007・ADR-015 の状態の書き換えは #48 で ADR 一覧と一緒に扱う。
- #43 の指摘は、この PR のブランチに積む別の PR(スタック PR)で扱う。
- `.serena/memories/` の更新は、マージ後に main で行う。

## 決定事項

| 項目 | 決定 | 決めた人 |
| --- | --- | --- |
| 既存の ARCHITECTURE に残る `## ADR 一覧` | 許可リストに無いセクションとして扱う。本文の差し替えは `unknown_heading` で拒否し、`remove: true` による削除を受け付ける | 利用者 |
| 残った `## ADR 一覧` の検出 | `diff-architecture` が `legacy_section` の所見を出す。`updating-architecture` は、本文を別のファイルへ退避するかを利用者に確かめてから削除する | 設計者 |
| `metatron.config.json` に残った `paths.gotchas` | 契約 §2 の未知キーと同じく、警告を出さずに無視する。`config-schema.md` には廃止したキーとして 1 行書く | 設計者 |
| ロック処理(`withFileLock`・`lock_timeout`) | `src/lib/file-lock.ts` へ移し、`commit-architecture` が引き続き使う。テストは移さずに書き直す | 設計者 |
| 消したサブコマンドの終了 | トップレベルの 10 個は `unknown_subcommand` で終了コード 2。`get` の 3 対象は `unknown_target` で終了コード 0(読み取り経路の契約のまま) | 設計者 |
| `feature_disabled` と終了コード 3 | エラー種別と `EXIT_SHRINK_PENDING` を消す | 設計者 |
| staging の種別 | `adr`・`gotchas` を消し、`architecture` だけにする | 設計者 |

## 残った `## ADR 一覧` は退避を確かめてから削除する

3 つの扱いを比べ、案 1 を採る。

| 軸 | 案 1: 削除を許す | 案 2: 未知のセクションとして残す | 案 3: 本文を metatron が別ファイルへ移す |
| --- | --- | --- | --- |
| 利用者がセクションを消す手段 | `stage-architecture` の `remove: true` | hook を切って手で消す | 新しいサブコマンド |
| 本文の行き先 | 利用者が選ぶ。スキルが退避を確かめる | 残る | metatron が決めたパス |
| 実装の変更 | 専用の拒否と照合を外す | 無し | サブコマンドの追加 |

案 1 には、外す処理が 2 つある。

- `validateHeadingKey` が `ADR 一覧` に返す専用のエラー(`adr_heading`)。
- `prepareArchitectureUpdate` が適用の後に行う `adrSectionSnapshot` の照合。`## ADR 一覧` の数か原文が変わると `invalid_body` を返す。stage-adr の採番を迂回させないための照合で、ADR 機能が無くなれば守る対象が無い。

この 2 つを外すと、削除は `allowUnlisted` の経路で通り、差し替えは許可リストに無いので `unknown_heading` で拒否される。この経路は `ADR 一覧` に限らず、許可リストに無いすべてのセクションの削除を受け付ける。これは今の実装と同じ挙動であり、この PR では変えない。

`legacy_section` の所見は `ADR 一覧` だけを対象にする。手書きで追加した他のセクションは利用者の意図によるもので、所見を出さない。所見の `detail` には、ADR 機能を廃止したことと、`remove: true` で削除できることを書く。退避の確認は `updating-architecture` のスキルが行う。Story #44 はこのリポジトリの ADR 一覧を `docs/old/metatron/` へ移すと決めた。ほかのプロジェクトでも、本文を残したい利用者が削除の前に写せるようにする。

## `paths.gotchas` は警告を出さずに無視する

契約 §2 は未知キーを無視し、エラーにしないと定める。`paths.gotchas` は廃止後に未知キーになるので、同じ扱いにする。警告は出さない。残っていても害が無く、警告を出すと設定を書いた利用者が毎回それを見ることになる。codiel の独立実装も同じ扱いにし、2 者比較テストは `gotchasPath` を突き合わせない。

パスの規則のうち、次の 3 つは `gotchas` の値だけで確かめていた。これらは `architecture` の値に置き換えて残す。

- 拒否は項目単位で、ほかの項目は残ること(`config.test.ts`)。残る項目が `architecture` だけになるので、「`architecture` を拒否すると既定値に落ち、警告が 1 行積まれる」の検査に変える。
- Windows 形式の区切りでのルート脱出(`config.test.ts` の R4-f)。
- 区切りを正規化した後のルート脱出(codiel の `check-intent-env.twoway-crlf.test.ts`)。

## ロック処理を独立したファイルへ移し、テストを書き直す

`gotchas.ts` の `withFileLock`・`lockPathFor`・ロックの定数を `src/lib/file-lock.ts` へ移す。エラーのクラスは `FileLockError` とし、`code` は `lock_timeout` のまま保つ。export 名は `withFileLock`・`lockPathFor`・`LOCK_RETRY_INTERVAL_MS`・`LOCK_MAX_RETRIES`・`LOCK_STALE_MS`・`FileLockError` とする。`commit-architecture` の出力の `error` も `lock_timeout` のまま変えない。

今のロックのテストは GOTCHAS の台帳と ADR を通して検査しており、そのまま移せない。`file-lock.test.ts` に次の 4 つを書き直す。

- FL1: ロックが取られている間、`withFileLock` は `lock_timeout` を投げ、`fn` を呼ばない(旧 G15)。
- FL2: `LOCK_STALE_MS` を過ぎたロックは取り直す(旧 G16)。
- FL3: `fn` が例外を投げてもロックを外す(旧 G17)。
- FL4: 対象のファイルが違えば、互いのロックをブロックしない(旧 G22)。

あわせて `cli.test.ts` に、ロックを先に置いた状態で `commit-architecture` が `lock_timeout` で失敗し、ARCHITECTURE を書き換えないことのテストを追加する。今は `adr.test.ts` だけがこの経路を確かめている。複数プロセスの排他のテスト(旧 G14)は、子プロセスの入口 `append-gotcha-entry.ts` ごと消す。排他の仕組みは `openSync` の `wx` に依存しており、FL1 が同じ仕組みを確かめる。

## 残るサブコマンドから分岐と出力を消す

| サブコマンド | 消すもの |
| --- | --- |
| `get config` | 出力の `gotchas`・`features`、`cli` の消したサブコマンドの項目、`inputSchemas` の消したサブコマンドの項目 |
| `link-claude-md` | `features.gotchas` による分岐。CLAUDE.md に足すのは ARCHITECTURE の @メンションだけになる |
| `diff-architecture` | `adrEnabled` の分岐と、`skipped` の「ADR の状態の陳腐化」の行。`legacy_section` を追加する |
| `stage-architecture`・`commit-architecture` | `adr` の種別と ADR の拒否。`acceptedKinds` は `architecture` だけになる |

staging の種別から `adr`・`gotchas` を消す。変更前に作られた staging が残っていると、`parseRecord` が読めずに既存のエラーになる。staging の有効期限は 30 分なので、移行の処理は作らない。

`link-claude-md` が過去に CLAUDE.md へ書いた `@docs/GOTCHAS.md` の行は、metatron が消さない。README の移行の注意に、手で消すよう書く。

## 注入文と hook

- SessionStart の注入文は、`get architecture` と、ARCHITECTURE の更新に `updating-architecture` を使うという案内だけを出す。消すのは、記録を促す文(`recordingLines`)と、GOTCHAS・ADR の CLI の案内である。hook は SessionStart だけが登録されている。
- `guard-docs` が拒否するのは ARCHITECTURE への書き込みだけになる。GOTCHAS のパスは保護しない。

## 影響範囲

metatron の実装とテスト:

- 消すファイル: `src/lib/` の `adr.ts`・`adr-candidates.ts`・`gotcha-candidates.ts`・`features.ts`・`gotchas.ts` とそれぞれのテスト、`src/cli/` の `adr-candidate.ts`・`gotcha-candidate.ts`・`gotcha.ts`、`src/testing/append-gotcha-entry.ts`。
- 直すファイル: `cli/main.ts`・`get.ts`・`stage.ts`・`commit.ts`・`paths.ts`・`output.ts`・`claude-md.ts`・`analysis.ts`、`lib/architecture.ts`(`ADR_HEADING` と照合)・`scan.ts`(`ARCHITECTURE_SECTIONS`・`adrEnabled`・`legacy_section`)・`staging.ts`・`config.ts`、`inject-context.ts`・`guard-docs.ts`。
- 直すテスト: `guard-docs.test.ts`・`inject-context.test.ts`・`cli.test.ts`・`architecture.test.ts`・`config.test.ts`・`scan.test.ts`・`staging.test.ts`。
- `section-reference-inventory.json` は変えない。codiel の 2 ファイルの登録は ARCHITECTURE への言及によるもので、GOTCHAS の文を消しても残る。ほかのプラグインの指示層に `ADR 一覧` の参照は無い。

metatron の指示層と文書:

- 消すファイル: `skills/recording-gotchas/`、`references/gotchas-format.md`、`docs/GOTCHAS.example.md`、`evals/recording-gotchas.json`。
- ADR・GOTCHAS の記述を消すファイル: `skills/updating-architecture`・`skills/capturing-architecture`、`commands/init.md`・`commands/audit.md`、`references/` の `architecture-format.md`・`cli-usage.md`・`config-schema.md`・`writing-discipline.md`、`docs/ARCHITECTURE.example.md`・`docs/rationale.md`、`evals/capturing-architecture.json`・`evals/updating-architecture.json`、`README.md`、`hooks/hooks.json` の description、`plugin.json` とルートの `marketplace.json` の description。
- `/metatron:init` の承認は、GOTCHAS の台帳の生成が無くなるので 5 回から 4 回に戻る。
- `docs/format-change-checklist.md` と `harness-docs/design/2026-08-16-file-contract-freeze.md` を追随させる。

codiel:

- `hooks/lib.ts` の `DEFAULT_GOTCHAS_PATH` と `DocPaths.gotchas`、`check-intent-env.ts` の `projectDocs.gotchas` を消す。
- テストの `check-intent-env.*.test.ts`・`helpers/check-intent-env-fixtures.ts`・`hooks/__test__/lib.test.ts`・`install-harness.test.ts` を直す。
- `skills/initializing-harness/SKILL.md`・`commands/init.md` から、GOTCHAS の台帳を作らないと述べる文を消す。`README.md` と `docs/DESIGN.md` の、GOTCHAS を metatron の資産とする記述を直す。`docs/DESIGN.md` の経緯の記述は残す。
- `skills/orchestrating-runs/references/failure-records.md` の、改修前の GOTCHAS 候補を読まないという規則は残す。過去の run の領域ファイルに残る記述への規則で、metatron の有無に関わらない。
- `pnpm run build` で `scripts/` を作り直す。

ルートの `README.md` の metatron と codiel の項目から、ADR・GOTCHAS と持続層の候補の取り込みの記述を消す。

## 完了の条件

- `pnpm run lint`・`pnpm run typecheck`・`pnpm run test`・`pnpm run build` が通り、`plugins/*/scripts/` の差分が同じコミットにある。
- `plugin.json` と `package.json` のバージョンが、metatron は 0.6.1-dev、codiel は 1.1.4 で揃っている。
