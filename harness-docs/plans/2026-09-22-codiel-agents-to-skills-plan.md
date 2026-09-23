# codiel の同梱 Agent 定義の撤去と作業内容によるディスパッチ 実装計画書

- 作成日: 2026-09-22
- 対象プラグイン: `plugins/codiel`(主)、`plugins/agent-policy`(従)、`plugins/metatron`(登録簿 fixtures とバージョンのみ)
- バージョン: codiel `0.8.0-dev` → `0.9.0-dev`、agent-policy `0.19.6-dev` → `0.19.7-dev`、metatron `0.3.7-dev` → `0.3.8-dev`
- 設計書(正本): `harness-docs/design/2026-09-22-codiel-agents-to-skills-design.md`
- context-map(事実の正本): `.claude/context-maps/2026-09-22-codiel-agents-to-skills.md`
- タスク数: **22**(T0〜T20 の連番に T2b と T11b を足し、T8 を欠番にしたもの)
- コミット単位: **8**(C1〜C8)
- 状態: 第 2 版(2026-09-23 のユーザー指摘を 6 段階で反映。§0.1 を参照)

**番号の扱い。** T8 は決定 1 の改定によりタスクが消滅したが、**番号は繰り上げずに欠番として残す**。§3 の依存図と §7 の Done 条件チェックリストが T 番号で参照し合っているため、繰り上げると参照が壊れる。追加分は既存タスクの直後に `b` を付けた枝番(T2b・T11b)で表す。

この計画書は設計書からタスク分割・順序・検証方法だけを立てるものであり、**設計判断を上書きしない**。設計書と実装が食い違う事実を見つけたときは、実装を止めてオーケストレーターへ報告する。報告を受けたオーケストレーターは §8「設計書との食い違い」へ追記し、設計書の修正要否を判断する。

---

## 0. 前提と baseline

**入力は 2 つある。** 設計判断の正本は `harness-docs/design/2026-09-22-codiel-agents-to-skills-design.md`、**事実(行番号・サイズ・既存契約)の正本は context-map `.claude/context-maps/2026-09-22-codiel-agents-to-skills.md`** である。着手時に両方を読む。context-map は `.gitignore:13` により追跡対象外なので、無い場合は設計書 §3 の実測値を使う。

### 0.1 オーケストレーターが確定済みの判断(着手時にこれを前提とする)

| # | 事項 | 決定 |
| --- | --- | --- |
| 1 | 残す Agent | `codiel-analyst` / `codiel-test-designer` の **2 体**。残る **13 体**(`codiel-tester` を含む)を削除する。tester の固有規律は `scripting-tests` / `running-regression-tests` へ移す(設計書 §6.1) |
| 2 | 委譲先の表し方 | **各フェーズの委譲を作業内容で表す。役割名も解決機構(役割マーカー・対応表・RoleId・行の形・候補範囲)も書かない。** codiel が書くのは、(1) サブエージェントに委譲すること、(2) 何をやらせるか(読ませるスキルと入出力ファイル)、(3) 成果物を書く委譲か読み取りだけの委譲か、の 3 点である |
| 3 | 解決の規律が無い環境 | 成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore`。候補の絞り込み・作業の重さに応じた帯の選択・候補が複数あるときの決め方は、すべて規律側の仕事であり codiel は書かない |
| 4 | スキル本文の届け方 | 依頼文に絶対パスを書いて `Read` させる。そのフェーズで読んでよいスキルを全部列挙する |
| 5 | 固有部の移し先 | **観点ごとに個別ファイルとし、そのスキルのディレクトリ配下の `references/` に置く**(計 9 ファイル)。プラグイン直下の `references/` も `assets/` も作らない |
| 6 | SubagentStop hook | 廃止する |
| 7 | agent-policy の追随 | parallel-nudge の注入文(F6)と orchestration-discipline の 1 条項(F7)。F1 は成立済み、F3 は対象が消えるので追随不要 |
| 8 | 発火測定 | **行わない。** codiel のスキルはコマンド(`commands/run.md:8` / `init.md:5` / `test.md:8`)と依頼文からの名指しでしか起動せず、description をモデルが読んで自律的に発火させる経路を使っていない。description の文面は発火率に影響しないので、測る意味がない。description からは Agent 名だけを外す(設計書 §5.10) |
| 9 | `orchestrating-runs/SKILL.md` のサイズ | 30,720 B の上限は当てない。実測を記録するだけとする |
| 10 | 残る 2 体の `model` | **宣言しない。** オーケストレーターのモデルを継承したままでよい。init と test-spec は run に 1 回ずつで、モデルを分ける価値が小さい(設計書 §5.11) |
| 11 | `e2e-verify` の種別 | **`readonly` から `impl` へ昇格させる。** tools は impl 役割の既定 `["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]` にする。Agent Tool の可否(可)・`ASSIGNMENTS`(Sonnet)・`RECOMMENDED`(Sonnet / GPT Astra)・`RoleId` の並び順は変えない(設計書 §5.8 の F8、§6.11) |

**この表の番号は設計書 §1 の決定表とは独立である。** 対応は、本書 #1〜#5 が設計書 #1〜#5、#6 が設計書 #7、#7 が設計書 #8、#8 が設計書 #10、#9 が設計書 §3.6、**#10 が設計書 #11、#11 が設計書 #12** である。設計書の #6(依頼文テンプレート)と #9(バージョン)は本書では §5.3 と T15 が扱う。

**決定 2 と 3 は 2026-09-23 のユーザー指摘により 2 段階で改めた。** 1 段階目は解決機構(対応表・RoleId)への言及をやめた。併用時は解決規則がセッションに注入済みで二重管理になり、単体運用時は機構そのものが存在しないためである。これに伴い旧 #9(対応表の消費契約の置き場)は**論点ごと消滅した**。2 段階目は残っていた役割名もやめ、作業内容だけを渡す形にした。役割名を固定すると作業の重さに応じた帯の選択(複雑な実装・エスカレーション)が消えるためである。

**決定 5 も 2026-09-23 のユーザー指摘により改めた(3 段階目)。** 観点と注意はそれぞれ強化・追加する予定があり、1 つのスキル本文に統合するとノイズになる。観点ごとに個別ファイルとし、そのスキルのディレクトリ配下の `references/` へ置く(設計書 §5.5)。

**決定 1 も 2026-09-23 のユーザー指摘により改めた(4 段階目)。** `codiel-tester` も削除し、残すのは 2 体にする。Bash + Write/Edit + Playwright という組合せは「成果物を書く委譲」の tools として一般的であり、tester の固有規律はスキル本文で表せるためである(設計書 §5.1)。これに伴い **T2 の後に新タスク T2b(tester の固有規律の移し替え)を足し、旧 T8(`codiel-tester.md` の本文修正)を欠番にした。**

**決定 11 は 2026-09-23 のユーザー指摘で追加した(5 段階目)。** `codiel-tester` の廃止でテストスクリプトを書いて実行し commit する作業が E2E 検証系の委譲先へ向かうが、`e2e-verify` は現状 `readonly` でこの作業を受けられない。**T11b(`e2e-verify` の impl 昇格)を足した。**

**未解決事項は 2026-09-23 のユーザー指摘で 0 件になった(6 段階目)。** §9 を参照。

### 0.2 baseline(着手時に取得して記録する)

| 項目 | 値 |
| --- | --- |
| HEAD | `4bdf799`(2026-09-23 実装着手時に取得。2026-09-22 時点は `e70a804`) |
| `git status --short` | 2026-09-22 時点の内訳は、`.claude/settings.json` の変更、`docs/chat/INDEX.md` の変更、`docs/chat/2026/0922/**` の未追跡の会話記録、本設計書と計画書自身(`harness-docs/design/2026-09-22-*.md` と `harness-docs/plans/2026-09-22-*.md`)の未追跡ファイルである。いずれも本改修と無関係なので、コミットに混ぜない。2026-09-23 着手時は `.claude/settings.json`・`cliproxyapi.config.example.yaml`・`docs/chat/INDEX.md` の変更と `docs/chat/2026/0923/` の未追跡。設計書・計画書は `2bebe8d` でコミット済み。同じく触らない |
| `pnpm run lint` | 緑(2026-09-23。387 files、infos 4 件、エラーなし) |
| `pnpm run typecheck` | 緑(2026-09-23。`tsc --noEmit` 終了コード 0) |
| `pnpm run test` | 緑(2026-09-23。Test Files 160 passed / 1 skipped (161)、Tests 2315 passed / 2 skipped (2317)) |
| 現行バージョン | codiel `0.8.0-dev` / agent-policy `0.19.6-dev` / metatron `0.3.7-dev` |
| `orchestrating-runs/SKILL.md` の変更後サイズ | 30,950 B(2026-09-23、C2 時点。閾値判定はしない) |
| hook 発火確認 | T20 の確認日時と、発火を確認したフック名を書き込む |

**この表は T0 と T6 と T20 が書き込む。** 計画書は保護パスではないので、実測値を残す先としてここを使う。

baseline は `plugins/codiel/` に限定せず**リポジトリ全体**で取る。ルート `package.json` の `build` と `test` は全 workspace を対象にするためである。

### 0.3 変更前の実測値(検証条件の起点。2026-09-22 計測)

| 項目 | 値 |
| --- | --- |
| `plugins/codiel/agents/` のファイル数 | 15(**変更前の値**。削除後は 2 になる。T7 と T18-1 で確認する) |
| 同ディレクトリの合計サイズ | 45,677 B(**変更前の値**。削除後は `codiel-analyst.md` 1,876 B + `codiel-test-designer.md` 1,680 B = 3,556 B になる) |
| `plugins/codiel/agents/codiel-tester.md` | 3,676 B・49 行。本文は `:7-49`(`:9-23` 職務と手順、`:25-41` 規律、`:43-49` ツール運用)。**登録簿には 1 件も登録されていない** |
| `plugins/codiel/skills/orchestrating-runs/SKILL.md` | 30,111 B |
| `plugins/codiel/skills/implementing/SKILL.md` | 9,708 B(変更後も**大きく増えない**。足すのは 1 文だけである) |
| `plugins/codiel/skills/reviewing-diffs/SKILL.md` | 8,525 B(変更後も**大きく増えない**。6 観点の本文は置かず、`references/` の個別ファイルへ出す) |
| `plugins/codiel/skills/*/references/` | **現在ゼロ。本改修で 9 ファイルを新設する** |
| `plugins/agent-policy/references/orchestration-discipline.md` | 24,227 B |
| `plugins/agent-policy/references/context-map-guide.md` | 6,169 B |
| 上 2 者の合計 | 30,396 B(30,720 B まで残り 324 B)。F7 の条項 1 文は半角括弧で書いても 315〜321 B になる |
| `section-reference-inventory.json` の総エントリ数 | 41 |
| うち `plugins/codiel/agents/` のエントリ数 | 17。内訳は `codiel-analyst` 1 / `codiel-architect` 1 / `codiel-implementer-backend` 2 / `-data` 2 / `-frontend` 2 / `-generic` 1 / `codiel-planner` 1 / `codiel-reviewer-backend` 1 / `-data` 1 / `-doc` 2 / `-frontend` 1 / `-security` 1 / `-generic` 1。**`codiel-tester.md` と `codiel-test-designer.md` は含まれない**(実測)。したがって tester を削除しても登録簿の件数は動かず、差引 41 − 16 + 2 = 27 は変わらない |
| `plugins/agent-policy/src/agents/roles.ts` の `e2e-verify` | `ROLES` エントリは `:91-96`。`kind`(`:94`)= `"readonly"`、`tools`(`:95`)= `["Read", "Grep", "Glob", "Bash"]`。`RoleId` union は `:14`(17 種中 11 番目) |
| impl 役割の既定 tools | `["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]`(`complex-impl` は `roles.ts:31-36`)。例外は `light-impl`(`:43-48`)で `Skill` を欠く |
| `plugins/codiel/scripts/` の `.mjs` | 6(`codiel-state` / `guard-bash` / `guard-write` / `lib` / `stop-guard` / `subagent-stop`) |
| `plugins/codiel/src/hooks/__test__/` のテスト | 4(`guard-bash` / `guard-write` / `lib` / `stop-guard`。`subagent-stop` のテストは無い) |

### 0.4 触ってはならないもの

- **`plugins/codiel/src/hooks/__test__/guard-write.test.ts` を書き換えない。** 書き換えが要ると判断した時点で実装を止めて報告する。
- `plugins/codiel/src/hooks/__test__/` の他の 3 本と `plugins/codiel/src/__test__/codiel-state.test.ts` を書き換えない。
  - 例外(2026-09-23 のユーザー判断。§8 を参照): T9 で `stop-guard.test.ts` から SubagentStop の参照とテスト群だけを削除する。Stop のテストは変えない。
- **`plugins/metatron/src/__test__/section-reference-inventory.test.ts` を書き換えない。** fixtures 側を直して V1 / V2 / V3 を通す。
- **3 者比較テストを書き換えない**: `plugins/sandalphon/src/__test__/check-intent-env.test.ts` の 16f 群、`plugins/metatron/src/lib/__test__/config.test.ts` の R4 群。
- **`plugins/*/scripts/` を手で編集しない。** ファイルの削除は `git rm`、内容の変更は `src/` を直して `pnpm run build` で再生成する。**このタスク分割に `scripts/` を手編集するタスクは 1 つも無い。**
- `plugins/codiel/src/hooks/guard-write.ts` / `guard-bash.ts` / `stop-guard.ts` / `lib.ts`、`plugins/codiel/src/codiel-state.ts` / `codiel-state-cli.ts`、`plugins/codiel/raguel-mcp/`、`plugins/sandalphon/` を変更しない。
- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md` と `.claude/rules/metatron/*.md` を Edit / Write で触らない。ADR は `metatron:updating-architecture` を起動して行う。
- `.serena/memories/` の変更は Serena の `write_memory` / `edit_memory` で行う。
- `plugins/codiel/agents/codiel-analyst.md` と `codiel-test-designer.md` を変更しない(削除される Agent 名への言及が無いため)。`model` も宣言しない(§0.1 の決定 10)。
- **`plugins/agent-policy/src/agents/roles.ts` の `RoleId` union(`:14`)の並び順を変えない。** `roles.test.ts:137-146` が `roleOrder("advisor") === ROLES.length - 1` を検査している。
- **`plugins/agent-policy/README.md` を変更しない。** 組み込み役割 ID の表(`:109-129`)に種別(`kind`)の列も記述も無い(設計書 §6.11)。
- **`.claude/agents/complex-reviewer.md` を再生成しない。** `e2e-verify` の impl 化に追随させない(設計書 §9 のリスク 9)。

---

## 1. 進め方の共通規律

- **フェーズの境界では常に緑にする。** 赤が残ってよいのはタスクの内部だけである。
- **指示書の文面確定は `prompt-smith:prompt-smith` を Skill ツールで起動して行う。** 対象は `SKILL.md` / `commands/*.md` / `references/*.md` / フックが注入する文である。各タスクの手順に起動を明記してある。
- **`prompt-smith:agent-creator` は本改修では起動しない。** 残る 2 体の Agent 定義は変更せず、削除する 13 体はファイルごと消えるため、Agent 定義の本文を直す作業が無い(設計書 §6.3)。
- **description は Agent 名の除去だけを行い、`prompt-smith:skill-creator` による発火測定は行わない**(設計書 §5.10)。
- `src/` を変更したタスクは、同じタスク内で `pnpm run build` を実行し、`scripts/` の差分が同じコミットに入ることを確認する。
- **登録簿の追加は T2 と、削除は T7 と同じコミットに入れる。** 登録簿だけを別コミットにすると必ず赤の中間状態ができる。追加と削除を別々のコミットへ分けること自体は問題ない(設計書 §8.5)。理由は §3 に示す。
- ブランチを切らない。`git push` に force 系のフラグを付けない。
- **依頼文の生成規則(委譲するとき必須)。** 次をすべて転記する。
  1. 対象ファイルの**絶対パス**と、そのタスクが書き込んでよいパスの列挙。
  2. 設計書の該当節番号と、その節の表・全文ブロック。
  3. §5 の共有契約のうち、そのタスクに必要な小節だけ。
  4. §6 のうち、そのタスクの ID が挙がっている行の全文。
  5. §0.4「触ってはならないもの」の全文。
  6. 使用してよい tools、`Agent` tool の可否、報告形式。

### 中間状態の許容範囲

- T1 の完了時点で `skills/implementing/references/` に 3 ファイルができるが、implementer の Agent 定義もまだ残っている。内容が二重になるだけで赤にはならない。
- T2 の完了時点で `skills/reviewing-diffs/references/` に 6 ファイルができ、reviewer の Agent 定義も残っている。同上。**ただし `doc.md` の登録 2 件を同じコミットに入れないと V2 が落ちる。**
- T2b の完了時点で `scripting-tests` / `running-regression-tests` に tester の固有規律が入るが、`codiel-tester.md` もまだ残っている。内容が二重になるだけで赤にはならない。
- **T1・T2・T2b を終えるまで T7(Agent の削除)に着手しない。** 観点と注意と tester の固有規律の移し先が無いまま削除すると、内容が失われる。
- T9 の完了時点で `docs/DESIGN.md:386` の SubagentStop 行が残る。**T12** で直す。文書の食い違いであり赤にはならない。
- T11b の完了時点で、このリポジトリの `.claude/agents/complex-reviewer.md` は `e2e-verify` の impl 化に追随していない。**これは受容する**(設計書 §9 のリスク 9)。テストは落ちない。

---

## 2. タスク分割

### フェーズ 0: 準備(直列 1)

#### T0: baseline の取得

- 対象: なし(計測のみ)
- 手順:
  1. `git rev-parse --short HEAD` と `git status --short` を記録する。
  2. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` を実行し、結果を §0.2 の表へ記入する。
  3. §0.3 の実測値を `wc -c` と `ls` で再取得し、記録値と一致することを確認する。
- 完了条件:
  - lint / typecheck / test が**着手前に緑**である。赤があれば本改修に入らず報告する。
  - **§0.2 の表に HEAD・`git status --short` の内訳・lint / typecheck / test の結果が書き込まれている。** 計画書は保護パスではないので直接書き込んでよい。表が空のまま次のタスクへ進まない。
- 検証コマンド: `pnpm run lint && pnpm run typecheck && pnpm run test`
- 起動するスキル: なし
- コミット: なし

---

### フェーズ 1: スキル本文への統合と依頼文テンプレートの改訂(直列)

**このフェーズを終えるまで T7 に着手しない。**

#### T1: ドメイン別の注意を 3 ファイルに起こし、`implementing/SKILL.md` を直す

- 対象:
  - 新規: `plugins/codiel/skills/implementing/references/frontend.md` / `backend.md` / `data.md`
  - 変更: `plugins/codiel/skills/implementing/SKILL.md`
- 設計書: §5.4、§5.5、§6.1
- 参照元(読むだけ。この時点では削除しない): `plugins/codiel/agents/codiel-implementer-frontend.md:22-25, 40-42`、`codiel-implementer-backend.md:20-22`、`codiel-implementer-data.md:22-24`
- 変更:
  1. **3 ファイルを新設する。** ファイル名はドメインタグ名と一致させる(依頼文が `skills/implementing/references/<タグ>.md` の形でパスを組み立てるため)。
     - `frontend.md`: UI / 状態管理 / アクセシビリティ / 既存画面との一貫性。**画面確認は条件付きで書く**(「Playwright MCP が使えるときは表示・遷移を確認する。使えないときはテストコマンドの結果を根拠にする」)。
     - `backend.md`: API 互換性 / エラーハンドリング / 入力検証。
     - `data.md`: 可逆なマイグレーション / `design.md` に明記のない破壊的変更は実行せず報告。
     - **generic のファイルは作らない**(専門の注意が無いタグは注意なし)。
     - 3 ファイルとも ARCHITECTURE に言及しない(登録簿の追加を発生させない)。
  2. `:3`(description)から Agent 名を外す。他の文は変えない。
  3. `:10-11`(概要)の `codiel-implementer-X` / `-generic` を役割の言い方へ改める。
  4. `:62`(コミット責務)の根拠を「Bash を持たないから」から「文書系フェーズの委譲先は git 操作をしないから」へ書き換える。
  5. 手順 2(`:39-41`)の近くに **1 文を足す**。「依頼文でドメイン別の注意のパスが渡されたときは、それを読み、実装中の注意として従う」の趣旨。**「ドメイン別の注意」の節は設けない。**
  6. `:36-40` / `:83-84` / `:93-103` は変更しない。`codiel-implementer-generic.md` の本文はここに含まれている(設計書 §3.3)。
  7. **`:41` の ARCHITECTURE への言及を落とさない。** 同ファイルは登録簿に 4 エントリ登録済みであり、ARCHITECTURE の語が消えると V3 が落ちる。
- 完了条件:
  - `plugins/codiel/skills/implementing/references/` に `frontend.md` / `backend.md` / `data.md` の 3 ファイルがあり、`generic.md` は無い。
  - 各ファイルが現行 Agent 定義の固有部を持つ。`frontend.md` に「アクセシビリティ」と「Playwright」、`backend.md` に「エラーハンドリング」と「入力検証」、`data.md` に「マイグレーション」と「破壊的変更」が含まれる。
  - `implementing/SKILL.md` に「ドメイン別の注意」という節見出しが**無い**。
  - `implementing/SKILL.md` に、渡されたドメイン別の注意を読む旨の 1 文がある。
  - `grep -n 'codiel-implementer' plugins/codiel/skills/implementing/SKILL.md` が 0 件。
  - `grep -c ARCHITECTURE plugins/codiel/skills/implementing/SKILL.md` が変更前と同じかそれ以上。
  - 3 ファイルに `ARCHITECTURE` が 0 件。
  - 登録簿テストが緑(エントリ数は 41 のまま変わらない)。
- 検証コマンド:
  - `ls plugins/codiel/skills/implementing/references/`(3 件)
  - `grep -c 'アクセシビリティ\|Playwright' plugins/codiel/skills/implementing/references/frontend.md`、`grep -c 'エラーハンドリング\|入力検証' plugins/codiel/skills/implementing/references/backend.md`、`grep -c 'マイグレーション\|破壊的変更' plugins/codiel/skills/implementing/references/data.md`(いずれも 1 以上)
  - `grep -c ARCHITECTURE plugins/codiel/skills/implementing/references/*.md`(すべて 0)
  - `grep -c 'codiel-implementer' plugins/codiel/skills/implementing/SKILL.md`(0)
  - `grep -n 'ドメイン別の注意' plugins/codiel/skills/implementing/SKILL.md`(節見出しではなく、渡されたパスを読む旨の 1 文であること)
  - `pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts`
  - `wc -c plugins/codiel/skills/implementing/SKILL.md`(**大きく増えないこと**。足すのは 1 文だけである)
- 起動するスキル: `prompt-smith:prompt-smith`(SKILL.md と新設 3 ファイルはいずれも AI が読む指示書である)
- コミット: C1

#### T2: 観点を 6 ファイルに起こし、`reviewing-diffs/SKILL.md` を直し、登録簿へ 2 件足す

- 対象:
  - 新規: `plugins/codiel/skills/reviewing-diffs/references/frontend.md` / `backend.md` / `data.md` / `doc.md` / `security.md` / `generic.md`
  - 変更: `plugins/codiel/skills/reviewing-diffs/SKILL.md`、`plugins/metatron/src/fixtures/section-reference-inventory.json`
- 設計書: §5.4、§5.5、§6.1、§6.7
- 参照元(読むだけ): `plugins/codiel/agents/codiel-reviewer-frontend.md:20-26`、`codiel-reviewer-backend.md:20-25`、`codiel-reviewer-data.md:20-29`、`codiel-reviewer-doc.md:21-29`、`codiel-reviewer-security.md:21-27, 29`、`codiel-reviewer-generic.md:23-28`
- 変更:
  1. **6 ファイルを新設する。** ファイル名は観点名と一致させる。内容は上記の参照元をそのまま移す。
     - `security.md` には `codiel-reviewer-security.md:29`(実害が起こりうるかで critical / high / medium を判断する)を入れる。`:28`(原則 medium 以上)は `SKILL.md:72-73` に既出なので入れない。
     - `doc.md` には ARCHITECTURE への言及(`codiel-reviewer-doc.md:25-26`)が入る。**このファイルだけが登録簿の追加対象になる。**
     - `frontend.md` は**ブラウザ確認を前提にしない形で書く**。`codiel-reviewer-frontend.md` の Playwright は移し先が無く、委譲先が持つとは限らない(設計書 §9 のリスク 8)。
  2. `:91-93`(観点別の焦点)の「観点ごとの具体的な確認項目は各 `codiel-reviewer-*` エージェント定義に記載する。」を、「観点ごとの確認項目は依頼文で渡される観点ファイルにある。渡された観点ファイルを読み、その項目で確認する」の趣旨へ改める。**6 観点の本文は書かない。**
  3. `:72-73`(severity)は**主語を security 観点へ改めるだけ**にする。原則 medium 以上という規律は変えない。`:29` の内容は `references/security.md` へ置くのでここには足さない。
  4. `:53`(所見書式)の「- 観点: frontend|backend|data|doc|security」へ **`generic` を足す**。
  5. `:3` / `:10` / `:26` / `:77-78` / `:96-98` の Agent 名と権限の断定を、観点と依頼文の言い方へ改める。`:26` は「詳細は依頼文で渡される観点ファイルにある」旨へ、`:96-98` は「Edit/Write を持たない読み取り専用の役割であり」を「読み取り系 tools に限って作業する委譲であり」の趣旨へ変える。修正しないという規律は変えない。
  6. **着手前に `section-reference-inventory.test.ts:63-81` を読み、`walkMd` が `skills/` のサブディレクトリを再帰的に辿ることを確認する。** 辿らないなら登録は不要になるので、その事実を §8 へ記録して報告する。
  7. **同じコミットで `section-reference-inventory.json` へ 2 件を足す。** `plugins/codiel/skills/reviewing-diffs/references/doc.md` の「ドメインマップ」分類 B と「(ARCHITECTURE への言及)」分類 C。`note` は既存エントリの書き方に揃える。
- 完了条件:
  - `plugins/codiel/skills/reviewing-diffs/references/` に 6 ファイルがある。
  - 各ファイルが現行 Agent 定義の観点を持つ。`frontend.md` に「アクセシビリティ」、`backend.md` に「エラーハンドリング」、`data.md` に「マイグレーション」、`doc.md` に「ARCHITECTURE」、`security.md` に「実害」、`generic.md` に「回帰リスク」が含まれる。
  - `reviewing-diffs/SKILL.md` に 6 観点の確認項目の本文が**無く**、観点ファイルを読む旨の記述がある。
  - 所見書式の観点リストに `generic` がある。
  - `grep -n 'codiel-reviewer' plugins/codiel/skills/reviewing-diffs/SKILL.md` が 0 件。
  - `reviewing-diffs/SKILL.md` に `ARCHITECTURE` が 0 件(doc 観点は `references/doc.md` にある)。
  - 登録簿のエントリ数が 41 → 43 になる。
  - V1 / V2 / V3 が緑。
- 検証コマンド:
  - `ls plugins/codiel/skills/reviewing-diffs/references/`(6 件)
  - `grep -c アクセシビリティ .../frontend.md`、`grep -c エラーハンドリング .../backend.md`、`grep -c マイグレーション .../data.md`、`grep -c ARCHITECTURE .../doc.md`、`grep -c 実害 .../security.md`、`grep -c 回帰リスク .../generic.md`(いずれも 1 以上。`...` は `plugins/codiel/skills/reviewing-diffs/references`)
  - `grep -c ARCHITECTURE plugins/codiel/skills/reviewing-diffs/SKILL.md`(0)
  - `pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts`
  - `grep -c 'codiel-reviewer' plugins/codiel/skills/reviewing-diffs/SKILL.md`(0)
  - `grep -c '"path"' plugins/metatron/src/fixtures/section-reference-inventory.json`(43)
  - `wc -c plugins/codiel/skills/reviewing-diffs/SKILL.md`(13 KB 前後に収まること)
- 起動するスキル: `prompt-smith:prompt-smith`(SKILL.md のみ。fixtures は指示書ではない)
- コミット: C1

#### T2b: `codiel-tester.md` の固有規律を `scripting-tests` / `running-regression-tests` へ移す

- 対象:
  - 変更: `plugins/codiel/skills/scripting-tests/SKILL.md`、`plugins/codiel/skills/running-regression-tests/SKILL.md`
- 設計書: §5.1、§6.1 の「`codiel-tester.md` の固有規律を 2 スキルへ移す」
- 参照元(読むだけ。この時点では削除しない): `plugins/codiel/agents/codiel-tester.md:7-49`
- 変更:
  1. **設計書 §6.1 の突き合わせ表に従い、4 項目だけを移す。** 表の「既出につき移さない項目」に挙がっている行は移さない(重複を作らない)。
     - `codiel-tester.md:29-30`(hook が守る範囲と、残りを自分の規律で守ること)→ `scripting-tests/SKILL.md` の HARD-GATE の近く。「エージェント個体」を「呼び出し元の委譲先」の言い方へ改める。
     - `codiel-tester.md:41`(完了報告の 4 項目)→ `running-regression-tests/SKILL.md` のレポート書式の節の後。レポート本文の書式(`:82-109`)とは別に、委譲先がオーケストレーターへ返す報告の形として書く。
     - `codiel-tester.md:45`(Context7 での仕様確認)→ `scripting-tests/SKILL.md`。
     - `codiel-tester.md:46-49`(Playwright での切り分け・再現確認、合否の根拠、未接続時の代替)→ `scripting-tests/SKILL.md`。**条件付きで書く**(「使えるときはブラウザ操作で切り分ける。使えないときはコードリーディングとテストコマンドで代替する」)。合否の根拠をスクリプトの実行結果に限る規律は条件に関わらず適用する。
  2. **`scripting-tests/SKILL.md:78` の根拠を書き換える。** 「`codiel-tester` は Bash を保持するため、自分の変更を自分でコミットする」→「テストの委譲先は自分の変更を自分でコミットする」の趣旨。権限の断定をやめる。
  3. `scripting-tests/SKILL.md:3`(description)と `:10`(概要)から Agent 名を外す。description は Agent 名の除去だけを行う(§0.1 の決定 8)。
  4. `running-regression-tests/SKILL.md:3`(description)と `:10`(概要)から Agent 名を外す。同上。
  5. **両ファイルの既存の HARD-GATE・Red Flags・判定基準・レポート書式を弱めない。** 移すのは追記であり、既存の規律の削除ではない。
- 完了条件:
  - `grep -c 'codiel-tester' plugins/codiel/skills/scripting-tests/SKILL.md plugins/codiel/skills/running-regression-tests/SKILL.md` が両方 0。
  - `scripting-tests/SKILL.md` に `Context7` と、Playwright を条件付きで使う旨と、hook が守る範囲の記述がある。
  - `running-regression-tests/SKILL.md` に完了報告の 4 項目(実行ケース数 / OK・NG・broken の内訳 / レポートパス / コミットハッシュ)がある。
  - `scripting-tests/SKILL.md:78` 付近のコミット責務の根拠に「Bash を保持するため」が無い。
  - 両ファイルに `ARCHITECTURE` が 0 件のまま(登録簿の追加を発生させない)。
- 検証コマンド:
  - `grep -c 'codiel-tester' plugins/codiel/skills/scripting-tests/SKILL.md plugins/codiel/skills/running-regression-tests/SKILL.md`(両方 0)
  - `grep -c 'Context7\|Playwright' plugins/codiel/skills/scripting-tests/SKILL.md`(1 以上)
  - `grep -c 'コミットハッシュ' plugins/codiel/skills/running-regression-tests/SKILL.md`(1 以上)
  - `grep -n 'Bash を保持' plugins/codiel/skills/scripting-tests/SKILL.md`(0 件)
  - `grep -c ARCHITECTURE plugins/codiel/skills/scripting-tests/SKILL.md plugins/codiel/skills/running-regression-tests/SKILL.md`(両方 0)
  - `pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts`
- 起動するスキル: `prompt-smith:prompt-smith`(両ファイルとも AI が読む指示書である)
- コミット: C1

#### T3: 残りのスキルから削除対象の Agent 名を外す

- 対象:
  - `plugins/codiel/skills/fixing-failures/SKILL.md:3, 10`
  - `plugins/codiel/skills/fixing-review-findings/SKILL.md:57`
  - `plugins/codiel/skills/preparing-design-agendas/SKILL.md:10`
  - `plugins/codiel/skills/writing-design-docs/SKILL.md:10`
  - `plugins/codiel/skills/writing-dev-plans/SKILL.md:10`
  - **`plugins/codiel/skills/writing-test-specs/SKILL.md:17`**(「実行する自動テストスクリプトは test-loop フェーズで `codiel-tester` が書く」)
  - **`plugins/codiel/commands/test.md:11`**(「codiel-tester サブエージェントに『対象 unit のスクリプト実行(必要ならスクリプト安定化)と結果レポート作成』をディスパッチしてください」)
- 設計書: §6.1 の「その他の Agent 名を持つスキルとコマンド」
- 変更: 削除対象の Agent 名を役割・観点の言い方へ改める。手順そのものは変えない。`fixing-review-findings:57` は「diff のドメインに応じた reviewer を再ディスパッチする」という手順を観点ごとの再 dispatch の言い方で保つ。`writing-test-specs:17` は「test-loop フェーズで書かれる」の趣旨へ。`commands/test.md:11` は「サブエージェントに〜をディスパッチしてください」の形を保ち、名指しだけをやめる。
- **`scripting-tests/SKILL.md:3, :10, :78` と `running-regression-tests/SKILL.md:3, :10` は T2b が扱う。** ここでは触らない(同じファイルを 2 つのタスクで編集しない)。
- **`preparing-design-agendas/SKILL.md:10` と `writing-design-docs/SKILL.md:10` では ARCHITECTURE の語を落とさない。** 両ファイルとも Agent 名と ARCHITECTURE の言及が同じ段落にあり、両ファイルとも登録簿に登録済みである(それぞれ「ドメインマップ」B・「(ARCHITECTURE への言及)」C・「システム概要」D・「技術スタック」D・「レイヤー構造」D の 5 件)。段落ごと書き換えて ARCHITECTURE の語が消えると V3 が落ちる。
- **変更しない**: `analyzing-issues/SKILL.md:10`(`codiel-analyst`)、`writing-test-specs/SKILL.md:10, 87`(`codiel-test-designer`)。いずれも残る 2 体を指している。
- 完了条件:
  - `grep -rn 'codiel-\(architect\|planner\|implementer\|reviewer\|tester\)' plugins/codiel/skills plugins/codiel/commands` が `orchestrating-runs/SKILL.md` 以外で 0 件。**検査語に `tester` を含める**(決定 1 の改定による)。
  - `preparing-design-agendas/SKILL.md` と `writing-design-docs/SKILL.md` の `grep -c ARCHITECTURE` が変更前と同じかそれ以上。
  - `commands/test.md` に `codiel-tester` が 0 件で、サブエージェントへディスパッチする手順そのものは残っている。
  - 登録簿テストが緑。
- 検証コマンド:
  - 上記 grep
  - `pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts`
- 起動するスキル: `prompt-smith:prompt-smith`
- コミット: C1

#### T4: `orchestrating-runs/SKILL.md` §2 とコミット規約を書き換える

- 対象: `plugins/codiel/skills/orchestrating-runs/SKILL.md:123-172`
- 設計書: §5.2、§5.6-4、§6.2
- 変更:
  1. `:128-142` のフェーズ進行表の「担当エージェント」列を「委譲の種別と作業内容」へ変える。**名指しは init と test-spec の 2 フェーズだけ**とし、Agent 名を残す。残りは「成果物を書く委譲」「読み取りだけの委譲」と作業内容を書く。**`:136`(test-loop A)と `:140`(fix-loop)の `codiel-tester` は「成果物を書く委譲」へ変える。** 設計書 §5.2 の表が正本である。**禁止語リスト(§5.6)の語は書かない。**
  2. `:144-149` の注は維持する(test-spec と dev-plan の 2 体並列、fix-loop のスキップ)。
  3. `:153-154` の「`codiel-architect` / `codiel-test-designer` / `codiel-planner` は Bash を持たず」を、「文書系フェーズの委譲先は git 操作をしない」という根拠へ書き換える。
  4. **`:166-167` の「担当サブエージェント(implementer / `codiel-tester`。いずれも Bash を保持)が自分の変更を自分でコミットする」から Agent 名と「いずれも Bash を保持」の断定を外し**、「コード系フェーズの委譲先は自分の変更を自分でコミットする」へ書き換える。責務の分配そのものは変えない。
  5. `:156-165`(文書系はオーケストレーターがコミット)と `:169-171`(`pr` 前の `git status --short` 確認)は維持する。
- 完了条件:
  - **§2 フェーズ進行表の 13 行**(`:130-142` の本体行。ヘッダ `:128` と区切り `:129` を除く)すべてに委譲の種別と作業内容が書かれている。
  - `:123-172` の範囲に削除される Agent 名が 1 件も残らない(`codiel-tester` を含む)。
  - `:123-172` の範囲に §5.6 の禁止語が 1 件も無い。
- 検証コマンド: `sed -n '123,172p' plugins/codiel/skills/orchestrating-runs/SKILL.md | grep -c 'codiel-architect\|codiel-planner\|codiel-implementer\|codiel-reviewer\|codiel-tester'`(0)、`sed -n '123,172p' plugins/codiel/skills/orchestrating-runs/SKILL.md | grep -c '対応表\|RoleId\|役割マーカー\|設計書・実装計画書(WBS)の作成\|通常の実装\|コードレビュー\|複雑または重要な実装\|エスカレーション'`(0)。**ファイル全体の grep は T6 の完了条件で行う**(T4 の時点では §3 と §4 に Agent 名が残っているため、全体 grep はここでは 0 にならない)
- 起動するスキル: `prompt-smith:prompt-smith`
- コミット: C2

#### T5: §3 の依頼文テンプレートを書き換える

- 対象: `plugins/codiel/skills/orchestrating-runs/SKILL.md:173-213`
- 設計書: §5.2、§5.3、§5.4、§5.6-1/2/3/5、§6.2。共有契約は本書 §5.1〜§5.3
- 変更:
  1. `:173-178` の前文を、委譲先の表し方 2 通り(名指し / 作業内容による委譲。後者の解決はセッションの規律に従い、規律が無ければビルトイン)として書き直す。解決機構にも役割名にも言及しない。
  2. `:179-208` のテンプレートを設計書 §5.6-1/2/3/5 の形へ改める。冒頭はサブエージェントであることと**そのフェーズの作業内容**(§5.1 の表の「作業内容」列)、続いて**読むスキルと観点ファイルの絶対パス列挙**。「## 前提」の既存 5 項目(ARCHITECTURE / GOTCHAS / 実行モード / ドメインマップ / 担当タグ)は維持する。読み取りだけの委譲には tools 限定・変更禁止・報告のみの 3 条項、文書系フェーズには git 操作禁止を入れる。末尾の転記欄は「セッションの規律が依頼文への転記を求める条項があれば、ここに置く」の趣旨とし、**条項の中身も、どの仕組みが条項を注入するのかも書かない**。
  2-b. **観点ファイルを足す規則を §3 に書く**(設計書 §5.4 の表)。
     - 実装の委譲(implement / test-loop B / fix-loop の修正): `mapped` で `<plugin-root>/skills/implementing/references/<担当タグ>.md` が**存在するときだけ**足す。存在しなければ足さない。`unscoped` では足さない。
     - review / 再レビュー: 観点ごとに `<plugin-root>/skills/reviewing-diffs/references/<観点>.md` を必ず足す(6 観点すべてのファイルが常に存在する)。
     - **存在の確認はオーケストレーターが `Glob` または `ls` で行う。** 委譲先に探させない。ドメインタグは任意の文字列を取りうるため、`frontend` / `backend` / `data` 以外では対応するファイルが無いのが通常である。
  3. `:210-213` を維持し、成果物の存在確認がオーケストレーターの義務であることを明示する(SubagentStop 廃止後の唯一の検査になるため)。
  4. `<plugin-root>` の解決は `:23-31` の既存規約をそのまま使う。同節は変更しない。
- 完了条件:
  - テンプレートが、作業内容・スキルと観点ファイルの絶対パス列挙・読み取り限定条項・git 操作禁止・転記欄の 5 つを持つ。
  - 観点ファイルを足す規則(存在確認を含む)が §3 にある。
  - フェーズごとに読ませるスキルの列挙が設計書 §5.2 の表と一致する。
  - 「Skill ツールで起動」という指示がテンプレートから消えている。
  - §3 に §5.6 の禁止語が無い。
- 検証コマンド: `grep -n 'Skill ツール' plugins/codiel/skills/orchestrating-runs/SKILL.md`(§3 に残っていないこと)、`sed -n '173,213p' plugins/codiel/skills/orchestrating-runs/SKILL.md | grep -c '対応表\|RoleId\|役割マーカー\|設計書・実装計画書(WBS)の作成\|通常の実装\|コードレビュー\|複雑または重要な実装\|エスカレーション'`(0)
- 起動するスキル: `prompt-smith:prompt-smith`
- コミット: C2

#### T6: §4・§4.1・Red Flags を書き換え、サイズを測る

- 対象: `plugins/codiel/skills/orchestrating-runs/SKILL.md:215-241, 299-307`
- 設計書: §5.2、§5.3、§5.6-6/7、§6.2
- 変更:
  1. `:217-219` の実在判定を廃す。`:218` の `initializing-harness/SKILL.md:53-55` への参照を削除する(参照先は実体を失っている)。
  2. §4 に §5.2 の 1 文を置く。「委譲先は、セッションに注入されているエージェント運用の規律に従って決める。そのような規律が無いときは、成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore` へ dispatch する。」の趣旨。**決め方の手順そのもの(候補の絞り込み・作業の重さに応じた帯の選択・description による担当範囲の一致・候補が複数あるときの決め方)は書かない。**
  3. `:220-221`(タグの値をそのまま渡す、`unscoped` では `set-domain` しない)は維持する。
  4. **`:234`(「`mapped` でドメイン別 reviewer を 1 体だけディスパッチするときも、担当するドメインタグを `set-domain` に渡す」)を削除する。** review は読み取りだけの委譲であり `set-domain` しない(設計書 §5.2)。この 1 行が残ると §2 の表と §4.1 が食い違う。
  5. `:237` の 7 体の列挙(`codiel-analyst` / `codiel-architect` / `codiel-test-designer` / `codiel-planner` / `codiel-tester` / `codiel-reviewer-doc` / `codiel-reviewer-security`)をフェーズと作業内容の言い方へ改める。残る 2 体は名指しのままでよいが、削除する 5 体の名前は残さない。`:238`(implementer は 1 体ずつ逐次)と `:239`(複数同時のときは `clear-domain`)は維持する。
  6. `:304`(Red Flags の「サブエージェントより自分でやった方が速い」)の根拠を「依頼文で範囲と tools を限定した委譲」へ改める。他の行は変えない。
  7. `:53-94`(§0)・`:96-121`(§1)・`:243-283`(§5・§6)・`:285-297`(HARD-GATE)は変更しない。
- 完了条件:
  - `grep -n 'initializing-harness' plugins/codiel/skills/orchestrating-runs/SKILL.md` が 0 件。
  - 縮退先(`general-purpose` / `Explore`)が §4 にある。
  - §4.1 に「reviewer にも `set-domain` を渡す」という趣旨の記述が残っていない。
  - `codiel-implementer` / `codiel-reviewer` / `codiel-architect` / `codiel-planner` / `codiel-tester` が**ファイル全体で 0 件**(T4・T5・T6 の累積で達成する)。
  - §5.6 の禁止語が**ファイル全体で 0 件**。
  - **`wc -c` の実測を §0.2 の表へ書き込む。** 閾値による合否判定は行わない(設計書 §3.6。`orchestration-discipline.md:181` の主語は委譲先にロードさせるスキルであり、`orchestrating-runs` はオーケストレーター自身が読むスキルである)。
- 検証コマンド: `wc -c plugins/codiel/skills/orchestrating-runs/SKILL.md`(実測を記録)、`grep -c 'codiel-implementer\|codiel-reviewer\|codiel-architect\|codiel-planner\|codiel-tester' plugins/codiel/skills/orchestrating-runs/SKILL.md`(0)、`grep -c '対応表\|RoleId\|役割マーカー\|設計書・実装計画書(WBS)の作成\|通常の実装\|コードレビュー\|複雑または重要な実装\|エスカレーション' plugins/codiel/skills/orchestrating-runs/SKILL.md`(0)、`grep -n 'set-domain' plugins/codiel/skills/orchestrating-runs/SKILL.md`(reviewer に渡す行が無いこと)
- 起動するスキル: `prompt-smith:prompt-smith`
- コミット: C2

---

### フェーズ 2: Agent 定義の削除(直列。T1・T2・T2b・T6 の完了が前提)

**C2(T4〜T6)が終わるまで着手しない。** `orchestrating-runs` が削除済みの Agent 名を `subagent_type` に指定したままの状態で Agent を消すと、その中間状態の run は委譲先を解決できずに壊れる。

#### T7: Agent 13 体を削除し、登録簿から 16 件を外す

- 対象: `plugins/codiel/agents/` の 13 ファイル、`plugins/metatron/src/fixtures/section-reference-inventory.json`
- 設計書: §6.3、§6.7
- 変更:
  1. 次の 13 ファイルを `git rm` する。`codiel-architect.md`、`codiel-planner.md`、`codiel-implementer-frontend.md`、`codiel-implementer-backend.md`、`codiel-implementer-data.md`、`codiel-implementer-generic.md`、`codiel-reviewer-frontend.md`、`codiel-reviewer-backend.md`、`codiel-reviewer-data.md`、`codiel-reviewer-doc.md`、`codiel-reviewer-security.md`、`codiel-reviewer-generic.md`、**`codiel-tester.md`**。
  2. **同じコミットで**登録簿から該当 16 エントリを削除する。内訳は設計書 §6.7 の表。`plugins/codiel/agents/codiel-analyst.md` の 1 件は残す。**`codiel-tester.md` は登録簿に 1 件も無いので、13 体目を足しても削除件数は 16 のままである**(§0.3)。
  3. **T2b の完了を前提とする。** tester の固有規律を `scripting-tests` / `running-regression-tests` へ移す前にファイルを消すと、内容が失われる。
- 完了条件:
  - `ls plugins/codiel/agents/` が `codiel-analyst.md` / `codiel-test-designer.md` の **2 件のみ**。
  - 登録簿のエントリ数が 43 → 27 になる。
  - `grep -c 'codiel/agents' plugins/metatron/src/fixtures/section-reference-inventory.json` が 1。
  - V1 / V2 / V3 が緑。
- 検証コマンド:
  - `ls plugins/codiel/agents/`
  - `pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts`
  - `pnpm run test`
- 起動するスキル: なし(削除と JSON 編集のみ)
- コミット: C3

#### T8: 欠番

**決定 1 の改定により消滅した。** 旧 T8 は `codiel-tester.md:34` の本文修正だったが、同ファイルは T7 で削除されるため作業が無くなった。固有規律の移し替えは **T2b** が担う。

**番号は繰り上げない。** §3 の依存図と §7 の Done 条件チェックリストが T 番号で参照し合っているためである。

---

### フェーズ 3: SubagentStop の廃止(直列)

#### T9: hook の実装・エントリ・登録・バンドルを削除する

- 対象: `plugins/codiel/src/hooks/subagent-stop.ts`、`plugins/codiel/build.ts:9`、`plugins/codiel/hooks/hooks.json:9-11`、`plugins/codiel/scripts/subagent-stop.mjs`
- 設計書: §5.7、§6.4
- 変更:
  1. `git rm plugins/codiel/src/hooks/subagent-stop.ts`。
  2. `build.ts:9` の `"subagent-stop": "./src/hooks/subagent-stop.ts",` を削除する。他の 5 エントリは変えない。
  3. `hooks/hooks.json` から `SubagentStop` のキーごと削除する。`PreToolUse` の 2 件と `Stop` の 1 件は変えない。
  4. `git rm plugins/codiel/scripts/subagent-stop.mjs`。**手で編集しない。**
  5. `pnpm run build` を実行する。
- 完了条件:
  - `grep -n SubagentStop plugins/codiel/hooks/hooks.json` が 0 件。
  - `ls plugins/codiel/scripts/` が 5 つの `.mjs` と `install-harness.sh` のみ。
  - `pnpm run build` 後、`git status --short plugins/codiel/scripts/` の差分が `subagent-stop.mjs` の削除だけである。他の 5 つの `.mjs` に差分が出ない。
  - `pnpm run typecheck` と `pnpm run test` が緑。
- 検証コマンド: `pnpm run build && git status --short plugins/codiel/scripts/ && pnpm run typecheck && pnpm run test`
- 起動するスキル: なし
- コミット: C4

---

### フェーズ 4: agent-policy の追随(直列)

#### T10: parallel-nudge の注入文を変える(F6)

- 対象: `plugins/agent-policy/src/hooks/parallel-nudge.ts:5-6`、`plugins/agent-policy/src/hooks/__test__/parallel-nudge.test.ts:6-7`
- 設計書: §5.8(F6)、§6.5
- 変更:
  1. `PARALLEL_NUDGE` の文面に、逐次にしてよい条件として「ワークフローの手順が逐次を定めるとき」を加える。文面の確定は `prompt-smith:prompt-smith` で行う。codiel の名前は書かない。
  2. テストの `:6-7` のハードコード全文を同じ値へ揃える。`:20-33` と `:35-40` のテスト構造は変えない。
  3. `pnpm run build` を実行し、`plugins/agent-policy/scripts/parallel-nudge.mjs` の差分を同じコミットに入れる。
- 完了条件:
  - `plugins/agent-policy/src/hooks/parallel-nudge.ts` と `__test__/parallel-nudge.test.ts` の文字列が完全一致する。
  - `pnpm exec vitest run plugins/agent-policy/src/hooks/__test__/` が緑。
  - `AMATSUKA_AGENT_PARALLEL_NUDGE=0` での無効化が引き続き動く(既存テストで担保)。
  - `git status --short plugins/agent-policy/scripts/` の差分が `parallel-nudge.mjs` だけである。**これは T10 の時点での条件である。** T11b が役割定義を変えると `session-start.mjs` / `subagent-start.mjs` / `delegation-gate.mjs` / `setup-agents.mjs` にも差分が出る(T11b の完了条件)。
  - `plugins/agent-policy/src/hooks/__test__/marker-scan.test.ts` に**差分が無い**(消費契約の固定は行わない。設計書 §5.8)。`:305` の `roleLabel({}, "e2e-verify")` は `label` を変えないので T11b でも影響しない。
- 検証コマンド: `pnpm run build && pnpm exec vitest run plugins/agent-policy/src/hooks/__test__/ && git status --short plugins/agent-policy/scripts/`
- 起動するスキル: `prompt-smith:prompt-smith`(注入文はフックが注入する文であり指示書に当たる)
- コミット: C5

#### T11: orchestration-discipline に優先順の条項を足す(F7)

- 対象: `plugins/agent-policy/references/orchestration-discipline.md`(§オーケストレーターが自ら担う作業。`:58` 以降)
- 設計書: §5.8(F7)、§6.6
- 変更:
  1. コマンドで起動したスキルの手順(スキル駆動のワークフロー)がこの規律のオーケストレーター条項と衝突するときはワークフローの手順を優先する、という条項を **1 文**加える。衝突しうる条項は `:60`(自ら実行しない)、`:72`(文書を自ら書かない)、`:182`(毎タスク commit させない)。
  2. codiel の名前を書かない。一般形で書く。
  3. **既存文の削減を既定の手順として行う。** 条項 1 文は半角括弧で書いても 315〜321 B になり、残量 324 B とほぼ同じである(§0.3)。追加してから測って超えていたら削る、という順序では手戻りになるので、条項の起草と削減候補の選定を同じ往復で行う。削る箇所の選定は `prompt-smith:prompt-smith` の判断に委ね、削った箇所と理由を報告に記す。
- 完了条件:
  - 条項が §オーケストレーターが自ら担う作業 にある。
  - `wc -c plugins/agent-policy/references/*.md` の合計が **30,720 B 以下**。この値は `:181` の条項の直接の帰結ではなく本リポジトリの運用上の約束だが(設計書 §3.5)、制約としては維持する。
  - 削った箇所と理由が報告にある。
  - `grep -c codiel plugins/agent-policy/references/orchestration-discipline.md` が 0。
- 検証コマンド: `wc -c plugins/agent-policy/references/*.md`、`grep -c -i codiel plugins/agent-policy/references/orchestration-discipline.md`
- 起動するスキル: `prompt-smith:prompt-smith`
- コミット: C5

#### T11b: `e2e-verify` を `impl` 種別へ昇格させる

- 対象:
  - `plugins/agent-policy/src/agents/roles.ts:91-96`
  - `plugins/agent-policy/src/agents/__test__/roles.test.ts:77-81`
  - `plugins/agent-policy/references/orchestration-discipline.md:19`(担当表)
  - `plugins/agent-policy/assets/roles/ja/e2e-verify.md` と `plugins/agent-policy/assets/roles/en/e2e-verify.md`
  - `.serena/memories/agent_policy/core.md`
- 設計書: §5.8(F8)、§6.11
- **T11 と同一ファイル(`orchestration-discipline.md`)を触るので、T11 の直後に続けて行い、同じコミット C5 に入れる。**
- **着手時に行番号を再確認する。** 上記はすべて 2026-09-23 の実測値である。
- 手順(この順で行う):
  1. **`roles.ts`。** `ROLES` の `e2e-verify` エントリ(`:91-96`)の `kind`(`:94`)を `"readonly"` → `"impl"`、`tools`(`:95`)を `["Read", "Grep", "Glob", "Bash"]` → `["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]` へ変える。`id` と `label` は変えない。**`RoleId` union(`:14`)の並び順を変えない**(`roles.test.ts:137-146` が `roleOrder("advisor") === ROLES.length - 1` を検査する)。
  2. **`roles.test.ts`。** `:77-81` の `e2e-verify` の期待値オブジェクトの `kind` と `tools` を新しい値へ揃える。`:23`(17 件の ID 配列)・`:65`(フィルタ条件)・`:119-124`(読み取り役割に Write / Edit を含まない)・`:137-146`(`roleOrder`)は変えない。`:119-124` は `kind === "readonly"` でフィルタするため `e2e-verify` が自動的に外れる。
  3. **担当表。** `orchestration-discipline.md:19` の「種別」列を `readonly` → `impl` へ。**行の並びを変えない。** 他の列(役割名 / RoleId / Agent Tool「可」/ Claude モデル `Sonnet`)も変えない。表のヘッダ(`:7`)と種別の定義文(`:28`)も変えない。
  4. **役割断片 ja / en。** `assets/roles/ja/e2e-verify.md` と `en/e2e-verify.md` の frontmatter の `tools`(`:6`)と `kind`(`:7`)を `roles.ts` と同じ値へ。「## Core Responsibilities」(`:14-16`)に、依頼された範囲でテストスクリプトを作成・修正し実行する旨を足す。「## 制約」の `:26`(ja「成果物(ファイル)を作らず、報告のみを返す」/ en "do not create deliverable files. Return a report only.")を**外す**。`:27`(検証対象の永続データを変更しない)と `:28`(操作手段が使えないときは未検証として報告)は**残す**。「## Output Format」に作成・変更したファイルの項を足す。**`id` / `default-name`(`e2e-verifier`)/ `tools` / `kind` を ja と en で一致させる**(`compose.test.ts` が検査する)。
  5. **README とメモリ。** `plugins/agent-policy/README.md` は**変更しない**(組み込み役割 ID の表 `:109-129` に種別の列も記述も無い)。`.serena/memories/agent_policy/core.md` も役割一覧に種別の記述が無いので必須の追随は無いが、`:357-359`(参照文書の残量)は T11 の実施後の値へ直す。**Serena の `write_memory` / `edit_memory` で行う。**
  6. `pnpm run build` を実行する。
- **変更しない**: `plugins/agent-policy/src/agents/policies.ts:148`(`ASSIGNMENTS`)と `:170`(`RECOMMENDED`)。どちらも役割 ID をキーにしており `kind` を見ない。
- 完了条件:
  - `roles.ts` の `e2e-verify` の `kind` が `"impl"`、`tools` が impl 既定の 7 件。
  - `orchestration-discipline.md:19` の種別列が `impl`。
  - ja / en 両方の frontmatter が `kind: impl` かつ同じ `tools` を持つ。
  - ja / en 両方の「制約」から「成果物を作らず報告のみ」が消え、「永続データを変更しない」が残っている。
  - `pnpm run test` が緑(agent-policy の全テスト。とくに `discipline-role-table.test.ts` / `compose.test.ts` / `roles.test.ts` / `policies.test.ts` / `setup-agents.test.ts` / `fragments.test.ts` / `marker-scan.test.ts`)。
  - `pnpm run build` が通り、`plugins/agent-policy/scripts/` の差分が `parallel-nudge.mjs`(T10)・`session-start.mjs`・`subagent-start.mjs`・`delegation-gate.mjs`・`setup-agents.mjs` に収まる。**役割定義は複数のバンドルに埋め込まれているので、`parallel-nudge.mjs` 以外にも差分が出るのが正常である。**
  - `grep -rn "e2e-verify" plugins/agent-policy/src` を実行し、`impl` / `readonly` の kind に依存する箇所が他に無いことを確認した記録がある。
  - `wc -c plugins/agent-policy/references/*.md` の合計が 30,720 B 以下(T11 と合わせて確認する)。
  - `grep -c -i codiel plugins/agent-policy/references plugins/agent-policy/assets -r` が 0。
- 検証コマンド:
  - `grep -n -A5 '"e2e-verify"' plugins/agent-policy/src/agents/roles.ts`
  - `grep -n 'e2e-verify' plugins/agent-policy/references/orchestration-discipline.md`
  - `grep -n 'kind:\|tools:\|default-name:' plugins/agent-policy/assets/roles/ja/e2e-verify.md plugins/agent-policy/assets/roles/en/e2e-verify.md`
  - `grep -rn "e2e-verify" plugins/agent-policy/src`
  - `pnpm run test && pnpm run build && git status --short plugins/agent-policy/scripts/`
  - `wc -c plugins/agent-policy/references/*.md`
- 起動するスキル: `prompt-smith:prompt-smith`(担当表と両言語の役割断片は AI が読む指示書である。`roles.ts` / `roles.test.ts` は対象外)
- コミット: C5

---

### フェーズ 5: 文書・メモリ・バージョンの追随

#### T12: `docs/DESIGN.md` を追随させる

- 対象: `plugins/codiel/docs/DESIGN.md:260-268`(§ `/codiel:test`)、`:318-372`(§7 Agents)、`:386`(§8 の SubagentStop 行)、`:480-492`(ディレクトリ構成)
- 設計書: §6.4、§6.8
- 変更:
  1. §7 の見出しと本文を、残る 2 体 + 作業内容で表す委譲の構成へ書き換える。`:328-335` の表を analyst と test-designer の 2 行に絞り、`:337-348`(実装系 3 体)、**`:349-353`(テスト系。`codiel-tester` の 1 行)**、`:355-369`(レビュー系 5 体)の表を削除する。委譲先の選択がセッションの規律に委ねられること、観点の所在が `reviewing-diffs` の「観点別の焦点」節と `references/` であることを記す。`:324-326`(MCP 付与方針)を残る 2 体に合わせる。**`:326` は Playwright の付与先を `codiel-implementer-frontend` / `codiel-tester` / `codiel-reviewer-frontend` と名指ししているので、付与先が委譲先の定義側の判断になる旨へ書き換える。**`:370-372`(利益相反経路の封鎖)に、権限に加えて依頼文の tools 限定条項とスキル本文の HARD-GATE が担う旨を書き添える。
  2. **`:264`(「codiel-tester をディスパッチし」)と `:268`(「tester の書き込み先は」)から Agent 名を外す。** `/codiel:test` がサブエージェントへディスパッチすること自体は変えない。
  3. `:386` の SubagentStop 行を削除する。`:385`(PreToolUse の境界判定と「hooks はツール呼び出しの発行元エージェントを識別できない」)と `:387`(Stop)は変更しない。
  4. **`:480-492` のディレクトリ構成の `agents/` の列挙を `codiel-analyst.md` と `codiel-test-designer.md` の 2 件に絞る。** `:487` の `codiel-tester.md` を含め、削除する 13 体の行を消す。
- 完了条件:
  - §8 の表の本体行は変更前が **7 行**(`:381-387`。PreToolUse 5 行 + SubagentStop 1 行 + Stop 1 行。ヘッダ `:379` と区切り `:380` を除く)。**変更後は 1 行減って 6 行**(PreToolUse 5 行 + Stop 1 行)になる。着手時に実測して一致を確認してから削る。
  - 削除された 13 体の名前がファイル全体に残らない。
- 検証コマンド: `grep -n 'SubagentStop' plugins/codiel/docs/DESIGN.md`(0 件)、`grep -c 'codiel-implementer\|codiel-reviewer\|codiel-architect\|codiel-planner\|codiel-tester' plugins/codiel/docs/DESIGN.md`(0)
- 起動するスキル: なし(`docs/` は設計文書であり指示書ではない)
- コミット: C6

#### T13: `skill-flowcharts.md` と README 2 本を追随させる

- 対象: `plugins/codiel/docs/skill-flowcharts.md:646, 647, 649, 651`、`plugins/codiel/README.md:57, 76`、ルート `README.md:68-72`
- 設計書: §6.8
- 変更:
  1. flowchart のディスパッチ先ノードのラベル(`:646` discuss / `:647` design / `:649` dev-plan / `:651` implement)を新しい委譲先へ合わせる。`:645`(init の `codiel-analyst`)と `:648`(test-spec の `codiel-test-designer`)は残る 2 体を指すので変更しない。`:652`(test-loop の「(A)tester (B)implementer」)・`:654`(review)・`:655`(fix-loop の「implementer/tester/reviewer」)は Agent 名ではなく役割語なので変更しない。
  2. **`skill-flowcharts.md:639` の precheck ノード**「前提チェック\nARCHITECTURE.md / raguel MCP」を現行の §0 に合わせる。§0 が見るのは B + C + D と Raguel MCP であり、ARCHITECTURE は見ない(2026-09-15 の変更に追随していない)。同じファイルを編集するのでこの機会に直す。
  3. `plugins/codiel/README.md:57`(「スキル/エージェント構成」)を、残る 2 体と、作業内容で表す委譲の構成に合わせて言い換える。`:76`(推奨 MCP の「対応する Codiel エージェントが仕様確認、GitHub 情報の参照、画面挙動の確認に活用します」)は、**Playwright を使うのがテスト・実装・レビューの委譲先であることを示す形へ書き換える**。同梱 Agent ではなくそれらの作業を受ける委譲先が使うこと、委譲先に MCP が付与されているかはプロジェクト側の定義次第であることを書く。未接続でもエラーにならない旨と GitHub が読み取り系だけである旨(同文の後半)は変えない。
  4. **`plugins/codiel/README.md:68-70`(セットアップ手順 2)**の「ARCHITECTURE が無ければ最小構成の `docs/ARCHITECTURE.md` が作成されます」を削る。2026-09-15 の決定(codiel は ARCHITECTURE を書かない)に反している。同じファイルを編集するのでこの機会に直す。
  5. ルート `README.md` の Codiel 節(`:68-72`)を、プラグイン改修の反映として必要な範囲で更新する。単体運用の約束(`:147`)が維持されることを確認する。
- 完了条件:
  - flowchart と README 2 本に削除された 13 体の名前が残らない(`codiel-tester` を含む。`:652` / `:655` の役割語「tester」は対象外)。
  - `plugins/codiel/README.md` に「最小構成の `docs/ARCHITECTURE.md` が作成されます」の趣旨の記述が無い。
  - `skill-flowcharts.md:639` の precheck ノードが ARCHITECTURE を前提チェックの対象として挙げていない。
- 検証コマンド:
  - `grep -rn 'codiel-implementer\|codiel-reviewer\|codiel-architect\|codiel-planner\|codiel-tester' plugins/codiel/docs plugins/codiel/README.md README.md`(0 件)
  - `grep -n 'ARCHITECTURE' plugins/codiel/README.md`(生成を約束する記述が無いこと)
  - `grep -n 'precheck' plugins/codiel/docs/skill-flowcharts.md`(ラベルを目視)
- 起動するスキル: なし
- コミット: C6

#### T14: Serena メモリを追随させる

- 対象: `.serena/memories/codiel/core.md:86-94, 109`、`.serena/memories/agent_policy/core.md:236`
- 設計書: §6.8
- 変更:
  1. `codiel/core.md` の `## Agents (15) and domain split`(`:86`)を、残る **2 体** + 作業内容で表す委譲の構成へ書き換える。見出しの件数も直す。`:89` の `codiel-tester` / implementers / reviewers の列挙も同時に直す。`:109` の hooks 一覧から SubagentStop を外す。`:135`(guard-write の gotcha)の「tester」は役割を指す一般語なので**変えなくてよい**。
  2. `agent_policy/core.md:236` の parallel nudge の行に、注入文の変更を反映する。
  3. **`agent_policy/core.md` の役割一覧(`:94-96` の 17 role IDs)と `RECOMMENDED`(`:367-373`)には種別(`kind`)の記述が無い**(実測)。`e2e-verify` の昇格による必須の追随は無い。`:357-359`(参照文書の残量)は T11b が直すので、ここでは重複して直さない。
- **`write_memory` / `edit_memory` で行う。** Edit / Write で直接触らない。
- 完了条件: 2 つのメモリが本改修後の構成と食い違わない。
- 検証コマンド: メモリを読み直して目視
- 起動するスキル: なし(Serena のツールを使う)
- コミット: C6

#### T15: バージョンを上げる

- 対象: `plugins/codiel/.claude-plugin/plugin.json:4`、`plugins/codiel/package.json:3`、`plugins/agent-policy/.claude-plugin/plugin.json:4`、`plugins/agent-policy/package.json:3`、`plugins/metatron/.claude-plugin/plugin.json:4`、`plugins/metatron/package.json:3`
- 設計書: §5.9、§6.9
- 変更: codiel を `0.9.0-dev`、agent-policy を **`0.19.7-dev`**、metatron を `0.3.8-dev` にする。agent-policy は役割 1 件の種別変更を含むがパッチに留める(2026-09-23 のユーザー判断)。
- 完了条件: 3 プラグインとも `plugin.json` と `package.json` の値が一致する。
- 検証コマンド: `grep -n '"version"' plugins/{codiel,agent-policy,metatron}/.claude-plugin/plugin.json plugins/{codiel,agent-policy,metatron}/package.json`
- 起動するスキル: なし
- コミット: C7

---

### フェーズ 6: ADR(オーケストレーターが実施)

#### T16: ADR を 1 件切る

- 対象: `harness-docs/ARCHITECTURE.md` の ADR 一覧(`:122` 以降)
- 設計書: §6.10
- 手順: **`metatron:updating-architecture` を Skill ツールで起動して行う。** `stage-adr` → `commit-architecture` の CLI 実行だけでは手順が足りない(diff-architecture・get rules・草案の第三者検査の 3 手順が要る)。
- 内容: タイトルの趣旨は「[codiel] ディスパッチ先を作業内容で表し、選択をセッションの運用方針に委ねる」。決定・文脈・帰結は設計書 §6.10 に列挙してある。**「帰結」節には「codiel は委譲先を名指しでも役割名でも指定せず、作業内容と委譲の種別だけを渡す。選択はセッションの運用方針に委ね、方針が無い環境ではビルトインへ縮退する」を含める。** ADR-003(`:181`)は別件であり改訂しない。ARCHITECTURE 本文の構造変更は無い。
- 完了条件:
  - `node plugins/metatron/scripts/metatron.mjs get adr` の出力に新しい ADR が現れる。
  - その ADR の「帰結」に上記の 2 文が書かれている。
  - `harness-docs/ARCHITECTURE.md` の ADR 一覧以外の節に差分が無い。
- 検証コマンド: `node plugins/metatron/scripts/metatron.mjs get adr`、`git diff harness-docs/ARCHITECTURE.md` を目視
- 起動するスキル: `metatron:updating-architecture`
- コミット: C8(`commit-architecture` が行う)

---

### フェーズ 7: 統合検証(直列。T17 → T18 → T19 → T20)

#### T17: 静的検証

- 手順:
  1. `pnpm run lint`
  2. `pnpm run typecheck`
  3. `pnpm run test`
  4. `pnpm run build` を実行し、`git status --short` に `plugins/*/scripts/` の未コミット差分が出ないことを確認する。
- 完了条件: 4 つすべてが緑で、build 後の差分がゼロ。
- 検証コマンド: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && git status --short`
- コミット: なし

#### T18: 受け入れ基準の grep 検証

- 手順と完了条件:

| # | 検証 | コマンド | 期待 |
| --- | --- | --- | --- |
| 1 | `agents/` に **2 ファイル**だけ残る | `ls plugins/codiel/agents/` | `codiel-analyst.md` / `codiel-test-designer.md` |
| 2 | 削除した **13** の Agent 名がスキルとコマンドに残らない | `grep -rn 'codiel-\(architect\|planner\|implementer\|reviewer\|tester\)' plugins/codiel/skills plugins/codiel/commands plugins/codiel/agents` | 0 件。**検査語に `tester` を含める** |
| 3 | 文書にも残らない | `grep -rn 'codiel-\(architect\|planner\|implementer\|reviewer\|tester\)' plugins/codiel/docs plugins/codiel/README.md README.md` | 0 件。`skill-flowcharts.md:652` / `:655` の役割語「tester」は `codiel-` 接頭辞を持たないので拾われない |
| 4 | SubagentStop が消えている | `grep -rn SubagentStop plugins/codiel/` | 0 件 |
| 5 | バンドルが 5 本 | `ls plugins/codiel/scripts/*.mjs` | 5 件 |
| 6 | 参照文書の合計 | `wc -c plugins/agent-policy/references/*.md` | 合計 30,720 B 以下 |
| 7 | orchestrating-runs の大きさ | `wc -c plugins/codiel/skills/orchestrating-runs/SKILL.md` | **実測が §0.2 の表に記録されていること。閾値判定はしない**(設計書 §3.6) |
| 8 | 登録簿のエントリ数 | `grep -c '"path"' plugins/metatron/src/fixtures/section-reference-inventory.json` | 27 |
| 9 | バージョン | `grep -n '"version"' plugins/{codiel,agent-policy,metatron}/.claude-plugin/plugin.json plugins/{codiel,agent-policy,metatron}/package.json` | `0.9.0-dev` / `0.19.7-dev` / `0.3.8-dev` が対で一致 |
| 10 | agent-policy の指示層・参照層に codiel の名前が無い | `grep -ri codiel plugins/agent-policy/references plugins/agent-policy/skills plugins/agent-policy/agents` | 一致ゼロ(`grep` の終了コードは 1 になる)。**`plugins/agent-policy/commands` は存在しないので対象に含めない**(含めると `grep` が終了コード 2 で失敗する)。`plugins/agent-policy/agents` は存在するが空である |
| 11 | ADR が増えている | `node plugins/metatron/scripts/metatron.mjs get adr` | 新しい ADR が現れる |
| 12 | codiel の指示層に禁止語が無い | `grep -rn '対応表\|RoleId\|役割マーカー\|設計書・実装計画書(WBS)の作成\|通常の実装\|コードレビュー\|複雑または重要な実装\|エスカレーション' plugins/codiel/skills plugins/codiel/commands` | 0 件(§5.6)。「サブエージェントに委譲する」「成果物を書く委譲」「読み取りだけの委譲」のような一般語は対象外 |
| 13 | agent-policy のテストに差分が無い | `git diff plugins/agent-policy/src/hooks/__test__/marker-scan.test.ts` | 空 |
| 14 | 観点ファイルが 9 本ある | `ls plugins/codiel/skills/implementing/references/ plugins/codiel/skills/reviewing-diffs/references/` | implementing 側 3 件(`frontend` / `backend` / `data`)、reviewing-diffs 側 6 件(+ `doc` / `security` / `generic`) |
| 15 | tester の固有規律が移っている | `grep -c 'Context7\|Playwright' plugins/codiel/skills/scripting-tests/SKILL.md`、`grep -c 'コミットハッシュ' plugins/codiel/skills/running-regression-tests/SKILL.md`、`grep -n 'Bash を保持' plugins/codiel/skills/scripting-tests/SKILL.md` | 前 2 者は 1 以上、最後は 0 件 |
| 16 | `e2e-verify` の種別が `impl` | `grep -n -A5 '"e2e-verify"' plugins/agent-policy/src/agents/roles.ts` | `kind: "impl"`、`tools` が `["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]` |
| 17 | 担当表の種別列が `impl` | `grep -n 'e2e-verify' plugins/agent-policy/references/orchestration-discipline.md` | `:19` の種別列が `impl`。他の列と行の並びは変わらない |
| 18 | 役割断片の ja / en が一致 | `grep -n 'id:\|default-name:\|tools:\|kind:' plugins/agent-policy/assets/roles/ja/e2e-verify.md plugins/agent-policy/assets/roles/en/e2e-verify.md` | `id` / `default-name` / `tools` / `kind` が両言語で同一。`kind` は `impl` |
| 19 | `e2e-verify` の kind 依存箇所が他に無い | `grep -rn "e2e-verify" plugins/agent-policy/src` | ヒットは `policies.ts:148, :170`(ID キー。kind を見ない)と `roles.ts` とテスト群のみ |

- コミット: なし

#### T19: 「変えないもの」の差分が空であることの検証

- 手順: baseline のコミット(T0 で記録した HEAD)からの diff を取り、次のパスに一切差分が無いことを確認する。

```
git diff <baseline-HEAD> --stat -- \
  plugins/codiel/src/hooks/guard-write.ts \
  plugins/codiel/src/hooks/guard-bash.ts \
  plugins/codiel/src/hooks/stop-guard.ts \
  plugins/codiel/src/hooks/lib.ts \
  plugins/codiel/src/codiel-state.ts \
  plugins/codiel/src/codiel-state-cli.ts \
  plugins/codiel/src/hooks/__test__/ \
  plugins/codiel/src/__test__/ \
  plugins/codiel/raguel-mcp/ \
  plugins/sandalphon/ \
  plugins/metatron/src/__test__/section-reference-inventory.test.ts
```

- 完了条件: 出力が空である。1 行でも出たら原因を特定し、意図しない変更なら戻す。`guard-write.test.ts` に差分があった場合は実装を止めて報告する(§0.4)。
- コミット: なし

#### T20: hook の発火確認(人手)

- 手順:
  1. すべてのコミットを終えた後、**新しいセッション**を開く。
  2. codiel の PreToolUse(Bash と Edit/Write)と Stop が発火することを確認する。
  3. SubagentStop が発火しないことを確認する。
  4. **§0.2 の表の「hook 発火確認」行へ、確認日時と発火を確認したフック名を書き込む。**
- 完了条件: §0.2 の表に確認日時と発火したフック名が書き込まれている。
- 根拠: `.claude/rules/metatron/protected-paths.md` の「`plugins/*/hooks/hooks.json` — 全セッションの挙動が変わる。変更後、新しいセッションで発火することを確認する」。
- コミット: なし

---

## 3. 依存関係

```
T0 (baseline)
 ├─> T1 (implementing 統合) ─┐
 ├─> T2 (reviewing-diffs 統合 + 登録簿 +2) ─┤
 ├─> T2b (tester の固有規律を 2 スキルへ) ──┤
 ├─> T3 (残りのスキル) ──────┘
 │        └─> [C1]
 │              └─> T4 -> T5 -> T6 (orchestrating-runs。同一ファイルなので直列)
 │                       └─> [C2]
 │                             └─> T7 (Agent 13 体削除 + 登録簿 -16)
 │                                      └─> [C3]     ※ T8 は欠番
 │
 ├─> T9 (SubagentStop 廃止 + build)      └─> [C4]   ※ 他と独立。T0 の後ならいつでも可
 └─> T10 (nudge + テスト) -> T11 (discipline の条項) -> T11b (e2e-verify の impl 昇格)
                                         └─> [C5]   ※ 他と独立。T0 の後ならいつでも可

T12 -> T13 -> T14 (文書・メモリ)         └─> [C6]   ※ T7・T9 の後
T15 (バージョン)                         └─> [C7]
T16 (ADR)                                └─> [C8]   ※ C1〜C7 の後
T17 -> T18 -> T19 -> T20 (統合検証)                ※ 最後
```

**順序を固定する理由。**

| 制約 | 理由 |
| --- | --- |
| T1・T2 が T7 より先 | 観点と注意の移し先が無いまま Agent を削除すると内容が失われる |
| **T2b が T7 より先** | 同じ理由。`codiel-tester.md` の固有規律の移し先が無いまま削除すると内容が失われる |
| **T11 → T11b が直列** | どちらも `orchestration-discipline.md` を編集する。並行すると衝突する。T11 が §オーケストレーターが自ら担う作業 に条項を足し、T11b が担当表の `:19` を直す |
| T2b が T3 と独立 | 触るファイル(`scripting-tests` / `running-regression-tests`)が重ならない。同じコミット C1 に入れる |
| **C2(T4〜T6)が T7 より先** | `orchestrating-runs` が削除済みの Agent 名を `subagent_type` に指定したまま Agent を消すと、その中間状態の run は委譲先を解決できずに壊れる。指示側を先に切り替え、定義の削除は後にする |
| 登録簿の +2 が T2 と同一コミット | `reviewing-diffs/SKILL.md` に ARCHITECTURE 言及が入った瞬間に V2 が落ちる |
| 登録簿の −16 が T7 と同一コミット | Agent を削除した瞬間に V3 が 16 件で落ちる |
| T4 → T5 → T6 が直列 | すべて `orchestrating-runs/SKILL.md` の同一ファイル。並行すると衝突する |
| T12 が T7・T9 より後 | `docs/DESIGN.md` は削除の結果を書くため |
| T16 が C1〜C7 の後 | ADR の「帰結」が確定した実装を指すため |
| T20 が最後 | hooks.json の最終形で確認する必要がある |

**並列にしてよいもの。** C4(T9)と C5(T10・T11・T11b)は他のどのコミットとも独立である。C1 のフェーズと同時に進めてよい。**C3 は独立ではない**(C2 の後でなければならない)。

---

## 4. 委譲先

| タスク | 役割 | 起動するスキル | 備考 |
| --- | --- | --- | --- |
| T0 | `general` | — | 計測のみ |
| T1・T2・T2b・T3 | `normal-impl` | `prompt-smith:prompt-smith` | SKILL.md の本文と、**新設する 9 ファイル**(T1 で 3 本、T2 で 6 本)を書く。いずれも AI が読む指示書である。T2 の fixtures 編集は同じ委譲先が行う。T2b は設計書 §6.1 の突き合わせ表に従って 4 項目だけを移す |
| T4・T5・T6 | `normal-impl` | `prompt-smith:prompt-smith` | 同一ファイルなので 1 体に連続して行わせる |
| T7 | `light-impl` | — | ファイル削除と JSON の機械的な編集 |
| T8 | — | — | **欠番**(決定 1 の改定により消滅) |
| T9 | `normal-impl` | — | src / build / hooks.json の編集と build |
| T10 | `normal-impl` | `prompt-smith:prompt-smith` | 注入文はフックが注入する文であり指示書 |
| T11 | `normal-impl` | `prompt-smith:prompt-smith` | 参照層の条項。既存文の削減を伴う |
| T11b | `normal-impl` | `prompt-smith:prompt-smith` | 担当表と両言語の役割断片は指示書。`roles.ts` / `roles.test.ts` の変更は同じ委譲先が続けて行う。T11 と同一ファイルを触るので **T11 と同じ委譲先に連続して行わせる** |
| T12・T13 | `normal-impl` | — | `docs/` と README は指示書ではない |
| T14 | `general` | — | Serena のメモリツール |
| T15 | `light-impl` | — | 6 ファイルの数値変更 |
| T16 | **オーケストレーター** | `metatron:updating-architecture` | ADR は委譲しない |
| T17・T18・T19 | `general` | — | 検証専用。1 回の dispatch にまとめる |
| T20 | **人手** | — | 新しいセッションでの確認 |

**共通の依頼文条項。** 読み取りだけの検証(T17〜T19)を `Write` / `Edit` を持つ定義へ委譲するときは、tools を読み取り系に限ること・ファイルを変更しないこと・報告のみを返すことを依頼文に明記する。

---

## 5. タスク間で共有する契約

### 5.1 フェーズ → 委譲先 → 読ませるスキル(T4・T5・T6 が実装。T1・T2 が前提にする)

設計書 §5.2 の表が正本である。実装時は必ずそちらを参照する。**委譲先は名指しでも役割名でも指定せず、「委譲の種別」と「作業内容」で表す。**

| フェーズ | 委譲の種別 | 作業内容(入力 → 出力) | 読ませるスキル |
| --- | --- | --- | --- |
| [0] init | 名指し `codiel-analyst` | Issue → `issue.md` | `analyzing-issues`(Agent 定義が読む) |
| [1] discuss(アジェンダ作成) | 成果物を書く委譲 | `issue.md` → `agenda.md` | `preparing-design-agendas` |
| [2] design | 成果物を書く委譲 | `issue.md` + `discussion.md` → `design.md` | `writing-design-docs` |
| [3a] test-spec | 名指し `codiel-test-designer` | `design.md` → `spec.md` / `cases.md` | `writing-test-specs`(Agent 定義が読む) |
| [3b] dev-plan | 成果物を書く委譲 | `design.md` → `dev-plan.md` | `writing-dev-plans` |
| [4] implement | 成果物を書く委譲 | `dev-plan.md` の担当ステップ → コード diff + ユニットテスト | `implementing` + `fixing-failures` |
| [5A] test-loop(スクリプト安定化) | 成果物を書く委譲 | `cases.md` → `scripts/` + `test-run-<n>.md` | `scripting-tests` + `running-regression-tests` |
| [5B] test-loop(TDD 修正) | 成果物を書く委譲 | NG ケースの再現手順・期待結果・実際の結果 → コード修正 diff | `implementing` + `fixing-failures` |
| [7] review | 読み取りだけの委譲 | diff + `design.md` + `.codiel/specs/**` → 指定観点の所見一覧(テキスト) | `reviewing-diffs` |
| [8] fix-loop(修正) | 成果物を書く委譲 | `review-<n>.md` の critical/high → コード修正 diff | `implementing` + `fixing-failures` |
| [8] fix-loop(回帰) | 成果物を書く委譲 | `scripts/` → `test-run-<n+1>.md` | `running-regression-tests` |
| [8] fix-loop(再レビュー) | 読み取りだけの委譲 | 更新された diff + 反論済み所見一覧 → 所見一覧(テキスト) | `reviewing-diffs` |

- **名指しが残るのは init と test-spec の 2 フェーズだけである。** test-loop A と fix-loop の回帰は「成果物を書く委譲」になった(決定 1 の改定)。
- 委譲のたびに「サブエージェントに委譲すること」を明記する(オーケストレーター自身は実行しない)。
- 「委譲の種別」は依頼文の tools 限定条項と §5.2 の縮退先の決定に使う。
- 作業の重さに応じた委譲先の選択は規律側が行う。codiel は作業内容を渡すだけである。
- 読ませるスキルは依頼文にすべて列挙する。
- [6] pr / [9] triage / [10] finalize はオーケストレーター本体が担い、委譲しない。

### 5.2 ビルトインへの縮退(T5・T6 が実装)

§4 に置くのは次の 1 文の趣旨だけである。

> 委譲先は、セッションに注入されているエージェント運用の規律に従って決める。そのような規律が無いときは、成果物を書く委譲は `general-purpose`、読み取りだけの委譲は `Explore` へ dispatch する。

- 成果物を書く委譲(discuss / design / dev-plan / implement / test-loop B / fix-loop の修正)→ `general-purpose`
- 読み取りだけの委譲(review / 再レビュー)→ `Explore`
- **決め方の手順そのものは書かない。** 候補の絞り込み、作業の重さに応じた帯の選択、description による担当範囲の一致を使うかどうか、候補が複数あるときの決め方は、すべて規律側の仕事である(設計書 §5.3)。

### 5.3 依頼文テンプレートが持つべき 5 要素(T5 が実装)

1. サブエージェントであることと、そのフェーズの作業内容(§5.1 の表の「作業内容」列)。役割名は書かない。
2. 読むスキルと観点ファイルの絶対パス列挙(`<plugin-root>/skills/<name>/SKILL.md` と `<plugin-root>/skills/<name>/references/<タグまたは観点>.md` の形。`<plugin-root>` は `orchestrating-runs/SKILL.md:23-31` で解決済みの値を埋める。観点ファイルを足す規則は T5 の変更 2-b)。
3. 読み取りだけの委譲に対する 3 条項(tools を読み取り系に限る・ファイルを変更しない・報告のみを返す)。
4. 文書系フェーズ(discuss / design / dev-plan)に対する「git 操作をしない」。
5. セッションの規律が依頼文への転記を求める条項があればそれを置く欄(codiel は条項の中身も、どの仕組みが条項を注入するのかも書かない)。

既存の「## 前提」5 項目(ARCHITECTURE / GOTCHAS / 実行モード / ドメインマップ / 担当タグ)は維持し、実装の委譲にだけ「ドメイン別の注意の節名」を足す。

### 5.4 登録簿の操作(T2 が +2、T7 が −16)

| タイミング | 操作 | 件数 | 結果 |
| --- | --- | --- | --- |
| T2 と同一コミット | `plugins/codiel/skills/reviewing-diffs/references/doc.md` の 2 件を追加(「ドメインマップ」B、「(ARCHITECTURE への言及)」C) | +2 | 41 → 43 |
| T7 と同一コミット | 削除する 13 体のうち、登録簿にエントリを持つ 12 体に対応する 16 件を削除 | −16 | 43 → 27 |

**スキル配下の `references/` が走査対象に入る根拠。** `targets()`(`section-reference-inventory.test.ts:63-81`)は `skills/` を `walkMd` に渡し、`walkMd` はサブディレクトリを再帰的に辿る。既に `plugins/basic-design/skills/api-list/references/template.md` が登録簿に載っている(fixtures `:4-8`)。**T2 は着手前にこの再帰を実測で確認する。**

`plugins/codiel/agents/codiel-analyst.md` の 1 件は残す。`codiel-test-designer.md` は残るが現在も未登録であり、本改修でも登録しない。**`codiel-tester.md` も未登録なので、削除しても登録簿の件数は動かない**(§0.3)。分類 A は作らない(V1)。

**追加と削除を別コミットへ分けても赤にならない。** V2 は実ファイルを走査して未登録の参照を探すので、`doc.md` を新設した C1 の時点で 2 件が登録されていれば通る。V3 は登録済みエントリのファイル実在を見るが、C1 の時点で 13 体はまだ実在するので通る。C3 で 16 件を同時に外せばそこでも通る。削除済みのファイルは `targets()`(`section-reference-inventory.test.ts:64-75`)の走査対象に出ないので、V2 が取り残すこともない。**禁じているのは登録簿だけを独立したコミットにすることである。**

### 5.5 コミット単位

| # | 含むタスク | メッセージの趣旨 |
| --- | --- | --- |
| C1 | T1・T2・T2b・T3 | 削除する Agent の観点と注意を観点ファイル 9 本と 2 スキルへ移す(登録簿 +2 を含む) |
| C2 | T4・T5・T6 | ディスパッチ規約を作業内容による委譲へ書き換える |
| C3 | T7 | 同梱 Agent 定義 13 体を削除する(登録簿 −16 を含む) |
| C4 | T9 | SubagentStop hook を廃止する |
| C5 | T10・T11・T11b | 逐次の条件とワークフロー優先を明記し、`e2e-verify` を impl へ昇格させる(agent-policy) |
| C6 | T12・T13・T14 | 文書とメモリを追随させる |
| C7 | T15 | 3 プラグインのバージョンを上げる |
| C8 | T16 | ADR を追加する(`commit-architecture` が行う) |

各コミットの末尾に、セッション冒頭で指定された帰属行を付ける。

### 5.6 codiel の指示層で使わない語(禁止語リスト)

`plugins/codiel/skills/**` と `plugins/codiel/commands/**` に次の語を書かない。T4・T5・T6 の完了条件と T18-12 で検査する。

| 分類 | 語 |
| --- | --- |
| 解決機構 | `対応表` / `RoleId` / `役割マーカー` |
| 担当表の役割名 | `設計書・実装計画書(WBS)の作成` / `通常の実装` / `コードレビュー` / `複雑または重要な実装` / `エスカレーション` |

**一般語は対象外である。** 「サブエージェントに委譲する」「成果物を書く委譲」「読み取りだけの委譲」「レビュー」「実装」といった、役割名を指していない普通の言葉は使ってよい。検査は上の表の語を完全一致で拾う grep で行う。

検査コマンド:

```
grep -rn '対応表\|RoleId\|役割マーカー\|設計書・実装計画書(WBS)の作成\|通常の実装\|コードレビュー\|複雑または重要な実装\|エスカレーション' plugins/codiel/skills plugins/codiel/commands
```

---

## 6. 想定される失敗と対策

| # | 失敗 | 兆候 | 対策 |
| --- | --- | --- | --- |
| F1 | 登録簿の更新をコミットから外す | V2 または V3 が落ちる | §5.4 のとおり同一コミットに入れる。T2 と T7 の完了条件に vitest の実行を入れてある |
| F2 | `orchestrating-runs/SKILL.md` の大きさに閾値を当ててしまう | T6 で「30,720 B 超過」を理由に作業を止める | **この文書には上限を当てない**(設計書 §3.6)。実測を §0.2 の表へ記録するだけである |
| F3 | 参照文書 2 本の合計が上限を超える | T11 の `wc -c` | 条項の起草と同じ往復で既存文を削る(既定の手順)。削った箇所と理由を報告に記す |
| F4 | `scripts/` を手で編集する | `git diff plugins/*/scripts/` に build 以外の変更 | T9 と T10 は `pnpm run build` の実行を完了条件に入れてある。削除は `git rm` のみ |
| F5 | `guard-write.test.ts` を書き換えたくなる | T19 の diff に出る | 書き換えが要ると判断した時点で実装を止めて報告する |
| F6 | 残す 2 体まで消す | T18-1 の `ls` | 削除リストは T7 に明記してある。`codiel-analyst` / `codiel-test-designer` は対象外 |
| F18 | `codiel-tester.md` の固有規律を移す前に削除する | T18-15 の grep | **T2b を T7 より先に完了させる**(§3)。移す 4 項目は設計書 §6.1 の表にある |
| F19 | 移す 4 項目のほかに、既出の規律まで 2 スキルへ重複して書く | 目視。`scripting-tests` / `running-regression-tests` が大きく膨らむ | 設計書 §6.1 の「既出につき移さない項目」の表に従う。移すのは 4 項目だけである |
| F20 | `roles.ts` の `RoleId` の並び順を動かす | `roles.test.ts:137-146` が落ちる(`roleOrder("advisor") === ROLES.length - 1`) | `kind` と `tools` だけを変える。並びは触らない(T11b の手順 1) |
| F21 | `roles.ts` だけを直して担当表を直し忘れる、またはその逆 | `discipline-role-table.test.ts:176-178` が落ちる | 両方を同じタスク(T11b)の中で直す。この test は `ROLES` と担当表を突き合わせる安全網である |
| F22 | 役割断片の ja と en が食い違う | `compose.test.ts` が落ちる | `id` / `default-name` / `tools` / `kind` を両言語で一致させる(T11b の手順 4) |
| F23 | T11b の build で `parallel-nudge.mjs` 以外の `.mjs` に差分が出たのを異常と判断して止まる | — | **正常である。** 役割定義は `session-start.mjs` / `subagent-start.mjs` / `delegation-gate.mjs` / `setup-agents.mjs` にも埋め込まれている(設計書 §6.11) |
| F24 | `.claude/agents/complex-reviewer.md` を再生成してしまう | `git diff .claude/agents/` | **本改修では再生成しない**(§0.4、設計書 §9 のリスク 9)。同定義は `final-review` / `gate-review` も担っており、impl の既定 tools へ寄せると読み取り専用の保証が消える |
| F7 | agent-policy の文書に codiel の名前を書く | T18 の検証 10 | 一般形で書く。`ARCHITECTURE.md:50` の禁止事項 |
| F8 | codiel の指示層に解決機構・役割名・注入元のプラグイン名を書く | T18-12 の grep | 書いてよいのは委譲の種別と作業内容(§5.1)と §5.2 の縮退の 1 文だけである。禁止語は §5.6 にある |
| F9 | 観点の移し替えで内容が抜ける | T1・T2 の grep | 移す前に元の Agent 定義の観点節を並べ、新設ファイルと 1 項目ずつ突き合わせる。完了条件の grep 語はその抜き取り検査である |
| F16 | 観点ファイルをプラグイン直下の `plugins/codiel/references/` に置く | 目視 | 置き場は**スキルディレクトリ配下**の `references/` である(設計書 §5.5)。参照層の定義に当たらない |
| F17 | `implementing/references/generic.md` を作ってしまう | T1 の `ls`(3 件) | 専門の注意が無いタグは注意なしである。generic のファイルは作らない |
| F10 | description を作り直してしまう | `git diff` の行数 | 変更は Agent 名の除去だけに限る(設計書 §5.10) |
| F11 | ADR を CLI だけで足す | — | `metatron:updating-architecture` を起動する。`stage-adr` → `commit-architecture` 単独では手順が足りない |
| F12 | C2 より先に Agent を削除する | `orchestrating-runs` が削除済みの名前を指したままになる | §3 の依存関係のとおり C2 → C3 の順を守る |
| F13 | Agent 名を消すときに ARCHITECTURE の語も落とす | T1・T3 の `grep -c ARCHITECTURE` と登録簿テスト | 対象は `implementing:41`、`preparing-design-agendas:10`、`writing-design-docs:10`。段落ごと書き換えない |
| F14 | `pnpm --filter metatron-scripts test` を使う | コマンドが見つからない | `plugins/metatron/package.json:6` の scripts は `build` のみである。登録簿テストは `pnpm exec vitest run plugins/metatron/src/__test__/section-reference-inventory.test.ts` で実行する |
| F15 | T18-10 の grep で存在しないディレクトリを指定する | `grep` が終了コード 2 で失敗する | **`plugins/agent-policy/commands` は存在しない。** 対象は `references` / `skills` / `agents` の 3 つである(`agents` は存在するが空)。一致ゼロのとき `grep` は終了コード 1 を返すので、`&&` で連結せず単独で実行して出力を見る |

---

## 7. Done 条件チェックリスト

設計書 §11 と同じものを、検証タスクの割り当て付きで再掲する。

- [ ] `plugins/codiel/agents/` に **2 ファイル**だけが残る(T18-1)
- [ ] `skills/implementing/references/` に 3 ファイル、`skills/reviewing-diffs/references/` に 6 ファイルがある(T18-14)
- [ ] `codiel-tester.md` の固有規律 4 項目が `scripting-tests` / `running-regression-tests` にあり、`scripting-tests:78` の根拠が書き換わっている(T2b・T18-15)
- [ ] スキルとコマンドに削除した **13** の Agent 名が出現しない(T18-2)
- [ ] 文書にも出現しない(T18-3)
- [ ] 依頼文テンプレートが §5.3 の 5 要素(作業内容・スキルの絶対パス列挙・読み取り限定条項・git 操作禁止・転記欄)を持つ(T5 の完了条件)
- [ ] `hooks.json` に SubagentStop が無く、`scripts/subagent-stop.mjs` が無い(T18-4・T18-5)
- [ ] `pnpm run build` の出力に未コミット差分が出ない(T17-4)
- [ ] `pnpm run lint` / `typecheck` / `test` が通る(T17)
- [ ] 参照文書 2 本の合計が 30,720 B 以下(T18-6)
- [ ] `orchestrating-runs/SKILL.md` の実測が §0.2 の表に記録されている(T18-7。閾値判定はしない)
- [ ] 登録簿が 27 エントリ(T18-8)
- [ ] 3 プラグインのバージョンが対で上がっている(T18-9)
- [ ] agent-policy の指示層・参照層に codiel の名前が無い(T18-10)
- [ ] `e2e-verify` の `kind` が `impl`、`tools` が impl 既定の 7 件、担当表の種別列が `impl`、ja / en の役割断片が一致している(T18-16〜19)
- [ ] ADR が 1 件増え、その「帰結」に設計書 §6.10 の内容が書かれている(T16・T18-11)
- [ ] codiel の指示層に §5.6 の禁止語(解決機構の語と担当表の役割名)が無い(T18-12)
- [ ] `marker-scan.test.ts` に差分が無い(T18-13)
- [ ] README・DESIGN.md・flowcharts・Serena メモリが追随している(T12・T13・T14)
- [ ] 「変えないもの」の diff が空(T19)
- [ ] hooks.json 変更後、新しいセッションで PreToolUse と Stop の発火を確認した記録がある(T20)
- [ ] 変更が C1〜C8 の単位でコミットされている

---

## 8. 設計書との食い違い

実装中に設計書と実ファイルの食い違いを見つけたら、この節へ追記してからオーケストレーターへ報告する。設計判断の修正要否はオーケストレーターが決める。

- **2026-09-23(T9)**: §0.3 と設計書 §3.4 は「`subagent-stop` のテストは無い」とするが、実際は `plugins/codiel/src/hooks/__test__/stop-guard.test.ts:10` が `new URL("../subagent-stop.ts", import.meta.url)` で削除対象のソースを参照し、`:132-305` に SubagentStop のテスト 11 件がある。§0.4 は同ファイルの書き換えを禁じているため、`subagent-stop.ts` を削除すると typecheck / test が落ち、T9 の完了条件と両立しない。ユーザー判断(2026-09-23): `stop-guard.test.ts` から `:10` の `subagent-stop.ts` の参照と `:132-305` の SubagentStop テスト群だけを削除し、Stop のテストは変えない。§0.4 に例外として追記した。
- **2026-09-23(T5)**: 本書 §5.3 末尾と設計書 §6.2 の表は「## 前提」に「ドメイン別の注意の節名」を足すとするが、設計書 §5.6-3 と §5.5(3 段階目の改定)ではドメイン別の注意は観点ファイルの絶対パスとして渡し、節は存在しない。§5.6-3 を正本とし、テンプレートに節名の項目を置かず、「## 観点ファイル」の絶対パス列挙で渡す形にした。
- **2026-09-23(T18-12)**: 禁止語 grep が `raguel-gating/SKILL.md:40, 46` と `fixing-review-findings/SKILL.md:49` の「フェーズ→ツール対応表」を 3 件拾う。いずれも baseline(`4bdf799`)から存在し、Raguel の evaluate ツールの割当表を指す語であって、委譲先の解決機構の「対応表」ではない。誤検知として扱い、変更しない。
- **2026-09-23(T17〜T19 の結果)**: lint(386 files、エラーなし)・typecheck・test(Test Files 160 passed / 1 skipped、Tests 2305 passed / 2 skipped。baseline 2315 から SubagentStop のテスト 10 件を削除した分)・build(後の差分なし)がすべて緑。T18 は #12 の誤検知を除き期待どおり(#6 は 30,485 B、#8 は 27)。T19 の差分は §0.4 の例外とした `stop-guard.test.ts` のみ。

---

## 9. 未解決事項

**未解決事項は無い。** 設計書 §12 と同じく 0 件である。計画側で新たに判断する論点も無い。実装はこの計画書と設計書だけで着手できる。

**解決済みとして外した論点。** それぞれ何がどう決まったかを 1 行で残す。

| 論点 | 決着 |
| --- | --- |
| 残る Agent の `model` 未宣言の扱い | **宣言しない。**残る 2 体はオーケストレーターのモデルを継承する(§0.1 の決定 10、設計書 §5.11) |
| review の 6 観点を 1 dispatch にまとめる余地 | **不採用で確定。**観点ごとに 1 dispatch を出す現行の構造を保つ(設計書 §10 の不採用案 3) |
| 発火測定を行わない判断の見直し時期 | **見直しの論点自体が消えた。**codiel のスキルは名指しでしか起動せず description が発火に影響しないため、いつ測るかという問いが立たない(§0.1 の決定 8、設計書 §5.10) |
| 対応表の消費契約の固定方法 | **契約自体が消えた。**codiel が解決機構にも役割名にも依存しなくなり、固定する対象が無い(§0.1 の決定 2) |
| `orchestrating-runs/SKILL.md` のサイズ上限 | **上限を当てない。**T6 は実測を §0.2 の表へ記録するだけである(§0.1 の決定 9、設計書 §3.6) |

実装中に新たな論点が出たときは §8「設計書との食い違い」へ追記し、オーケストレーターへ報告する。計画側で判断しない。
