# metatron の ADR・GOTCHAS をオプトインにする設計と実装計画

- 日付: 2026-10-08
- 対象: `plugins/metatron`(0.4.0-dev)、`plugins/codiel`(1.0.0)
- 状態: 承認済み(2026-10-08)

## 1. 要件と受け入れ基準

ADR の記録は `AMATSUKA_METATRON_ENABLE_ADR`、GOTCHAS の記録は `AMATSUKA_METATRON_ENABLE_GOTCHAS` が有効なときだけ行う。
codiel も同じ 2 変数に従い、ADR 候補と GOTCHAS 候補をそれぞれの変数が有効な run でだけ残す。

ユーザーとの合意(2026-10-08):

| 論点 | 決定 |
| --- | --- |
| 無効時に止める範囲 | 注入・スキル手順・書き込み CLI を止める。`get adr` / `get gotchas` と保護 hook(`guard-docs`)の拒否は残す。既存ファイルは変更しない |
| codiel の判定箇所 | `check-intent-env` の出力に載せ、run の開始時に state へ保存する。スキルは state を見る |
| 有効の判定 | 値を trim して小文字にし、`1` / `true` / `on` のどれかなら有効。未設定・空・それ以外の値は無効 |
| ADR の記録 | 新しい ADR を追加する |
| ADR 候補が無効の run で 3 条件を満たす判断 | どこにも残さない。持続層への取り込みでは従来どおり除外する。intent 文書と design.md には元の記述が残る |
| バージョン | metatron 0.4.0-dev → 0.5.0-dev、codiel 1.0.0 → 1.0.1 |

受け入れ基準:

- A1. 2 変数が未設定の環境で、SessionStart と SubagentStart の注入文に ADR 一覧・GOTCHAS の目次と本文・ADR と GOTCHAS の記録を促す行が出ない。
- A2. 2 変数が有効な環境で、注入文が改修前とバイト単位で一致する。
- A3. 一方だけ有効な環境で、注入文が §3-1 の文面になる。4 通りの組み合わせをテストで固定する。
- A4. 無効な側の書き込み CLI が、変数名を含むメッセージで非 0 終了し、ファイルを変更しない。
- A5. 無効な側があっても `get adr` / `get gotchas` は従来どおり返り、`guard-docs` は従来どおり直接編集を拒否する。
- A6. `get config` の出力に 2 変数の判定結果が載る。
- A7. codiel の `check-intent-env` が 2 変数の判定結果を出力する。`codiel-state init` は必須の引数で受け取った値を state に保存する。
- A8. codiel のスキルは、state の値が false の候補種別について判定も記録も写しもしない。
- A9. `pnpm run lint` / `typecheck` / `test` / `build` が通る。テストは 2 変数を設定したシェルと未設定のシェルの両方で通る。

## 2. 変数の読み取り

- 判定関数は metatron と codiel にそれぞれ独立に置く(ARCHITECTURE の「他プラグインの `src/` を import しない」)。
- 形は agent-policy の `gateEnabled(env)`(`plugins/agent-policy/src/hooks/delegation-gate.ts:92`)に揃え、`process.env` を引数で受ける。
- metatron は `src/lib/features.ts` に `readFeatures(env): { adr: boolean; gotchas: boolean }` を置く。
- codiel は `src/check-intent-env.ts` 内に同じ判定を置く。環境変数の判定結果は「実行環境の事実」として出力し、スクリプトが事実だけを返す建て付けを保つ。
- 値域のずれは、codiel の `src/hooks/__test__/lib.test.ts` と同じ形の 2 者比較テストで検出する。テストは metatron の `readFeatures` と codiel の判定に同じ入力の組を与え、結果の一致を確かめる。
- 2 変数は `metatron.config.json` の契約(`references/config-schema.md`)に載せない。
- 変数はセッションの起動時に決まる。注入は SessionStart の値、CLI は実行ごとの値を使う。変数を変えたら新しいセッションを始める(README に書く)。

## 3. metatron の挙動

`ADR` 列は ADR 変数、`GOTCHAS` 列は GOTCHAS 変数が無効のときの挙動を示す。有効のときは改修前と同じ。

| 経路 | ADR 無効 | GOTCHAS 無効 |
| --- | --- | --- |
| 注入: ADR 一覧(`renderAdrSummary`) | 出さない | 影響なし |
| 注入: GOTCHAS 目次と直近 N 件(`renderGotchas`) | 影響なし | 出さず、GOTCHAS.md を読まない |
| 注入: 文面(タイトル・`cliLines`・`recordingLines`・`delegationLines`・`buildInitGuide`) | §3-1 | §3-1 |
| 注入: 文書の有無の判定 | 影響なし | GOTCHAS.md だけがあるときは文書ゼロとして扱う |
| 注入: SubagentStart | SessionStart と同じ規則 | SessionStart と同じ規則 |
| CLI 書き込み | `stage-adr`、staging の種別が `adr` の `commit-architecture`、`shrink-adr-candidate` を拒否 | `init-gotchas`、`append-gotcha`、`tag-gotcha`、`remove-gotcha-candidate` を拒否 |
| CLI 読み取り | `get adr`、`scan-adr-candidates` は従来どおり | `get gotchas`、`get gotchas-template`、`scan-gotcha-candidates` は従来どおり |
| `diff-architecture` | `## ADR 一覧` が無くても `section_missing` にしない | 影響なし |
| `stage-architecture` | `## ADR 一覧` の保護(`architecture.ts:417-425`・`:1077-1089`)は従来どおり | 影響なし |
| `get config` | `features.adr: false` | `features.gotchas: false` |
| `guard-docs` | 拒否は従来どおり。理由の文面は §3-3 | 拒否は従来どおり。理由の文面は §3-3 |

### 3-1. 注入の文面

両方有効の文面は改修前の定数と一致させる。片方が無効のときは次のとおり置き換える。両方無効のときは両方の置き換えを当てる。

| 箇所 | ADR 無効 | GOTCHAS 無効 |
| --- | --- | --- |
| `GUIDE_TITLE` | 変えない | `# metatron: プロジェクトの前提` |
| `cliLines` の「読む:」の行 | `/ node M get adr` を除く | `node M get gotchas --query <語> /` を除く |
| `cliLines` の「記録:」「タグ:」の行 | 変えない | 出さない |
| `cliLines` の「ADR:」の行 | 出さない | 変えない |
| `recordingLines` の 1〜2 行目 | `依頼の完了報告の前に、失敗に GOTCHAS へ残すものが無いか確かめる。` と `残すなら recording-gotchas の承認手順で記録する。` | `依頼の完了報告の前に、判断に ADR へ残すものが無いか確かめる。` と `残すなら updating-architecture の承認手順で記録する。` |
| `recordingLines` の 3〜4 行目(codiel の候補) | 変えない | 変えない |
| `delegationLines` | 変えない | `サブエージェントには SubagentStart hook が ARCHITECTURE を注入する。` と `委譲の依頼文には、ARCHITECTURE の原文も要約も書き写さない。` |
| `buildInitGuide` の 1 文目 | 変えない | `このプロジェクトにはまだ ARCHITECTURE が無い。**`/metatron:init` で作成する。**` |

- 両方無効のときは `recordingLines` を 4 行とも出さない。
- `recordingLines` の予算(4 行で 200 文字以内)は 4 通りの変種すべてで守る。テスト I13d を変種ごとに測る形に直す。
- テストの固定文字列(`inject-context.test.ts:28-87` の GUIDE・INIT_GUIDE・RECORDING_LINES・DELEGATION_LINES)は、組み合わせごとの変種に分ける。

### 3-2. CLI のゲート

- ゲートは CLI 層(`src/cli/`)に置き、lib には置かない。`src/testing/append-gotcha-entry.ts` など lib を直接呼ぶテストは影響を受けない。
- サブコマンドと変数の対応は `main.ts` の 1 箇所にまとめる。`commit-architecture` だけは staging の種別を読んでから判定する(`commit.ts`)。
- 拒否は入力を読む前に行い、ファイルに触れない。
- 拒否の終了コードは、`shrink-adr-candidate` と `remove-gotcha-candidate` を含めてすべて 1 とする。終了コード 3 は「やり直せば通りうる拒否」の契約なので使わない。`main.ts` の冒頭コメントと `references/cli-usage.md` にこの例外を書く。
- 拒否メッセージは変数名と有効にする値を含める。
- `diff-architecture` は `analysis.ts` で変数を読み、`DiffArchitectureInput` に足す項目で `diffArchitectureInner` へ渡す。`ARCHITECTURE_SECTIONS` は変えない(`architecture.ts` と同期する決まりがある)。

### 3-3. `guard-docs` の理由文

- 有効な側は従来の文面のままにする。
- 無効な側は、CLI の案内を「記録は無効(有効にするには `<変数名>=1`)」の趣旨に置き換える。拒否する CLI へ誘導しない。

## 4. codiel の挙動

- `check-intent-env` の出力に `knowledgeRecording: { adr: boolean; gotchas: boolean }` を足す。
- `codiel-state init` に `--adr-candidates <on|off>` と `--gotcha-candidates <on|off>` を足す。`--knowledge-target` と同じく `oneOf` の必須引数とし、渡し忘れを失敗にする。
- `knowledgeRecording` の true/false を on/off に読み替えて渡すのは、`orchestrating-runs` の §0 の判断表と `capturing-intent` の init 手順である。
- state に `candidates: { adr: boolean; gotchas: boolean }` を足し、`newState` の Pick 一覧にも加える。
- state にこの項目が無い(改修前に作った)run は、両方 false として扱う。
- 値は run の開始時に決めて固定する。`resume.md` の「§0 の判定をやり直す」から、この 2 行を除く。
- 候補を書くかどうかの判定は、正本の `adr-candidates.md` と `gotcha-candidates.md` の冒頭に書く。
- 「`knowledgeTarget` によらず候補を書く」と定めた規範文も、変数が有効な種別に限ると書き換える。対象は `intent-format.md:270`・`:314`・`:326`、`persistent-layer.md:27`、`phase-finalize.md:14`・`:23`、`phase-intent-sync.md:9` である。
- 持続層への取り込み(`persistent-layer.md` の手順 4 と 8)は、3 条件を満たす判断を従来どおり除外する。ADR 候補が無効の run では、除外した判断を ADR 候補にも書かない。
- 無効な run では、前の try が残した候補も持続層へ写さない。
- 候補一覧の「なし」の理由の列挙(`adr-candidates.md:73-74`、`gotcha-candidates.md:68-70`、`orchestrating-runs/SKILL.md:306`)に「無効(環境変数が未設定)」を足す。
- `knowledgeTarget` の意味(持続層へ写すかどうか)は変えない。
- hooks(`guard-write` など)は `knowledgeTarget` も候補も読まないので変えない。

## 5. スキルと文書

metatron:

- 各スキルは先頭で `get config` を 1 回呼び、`features` で手順を分岐する。CLI の拒否を踏んでから分岐しない。
- `capturing-architecture`:
  - GOTCHAS 無効なら、台帳の生成(承認 1 回分)と手順 9 を飛ばす。
  - ADR 無効なら手順 8 を飛ばす。
  - 承認回数の記述を条件付きにする。
  - 手順 1 の「9 単位が埋まっていて台帳だけが無い」分岐は、GOTCHAS 無効なら `/metatron:update` を案内して終える。
- `updating-architecture`:
  - ADR 無効なら `## ADR` と `## ADR 候補の取り込み` を飛ばす。ADR を求める依頼には変数の設定を案内して止める。
  - ADR 無効なら「セクションの欠落」(`SKILL.md:31`)で `## ADR 一覧` を扱わない。
  - GOTCHAS 無効なら手順 8 を飛ばす。
- `recording-gotchas`: GOTCHAS 無効なら変数の設定を案内して止める。
- `references/cli-usage.md`: 無効時に拒否するコマンド、終了コード 1 の例外、`diff-architecture` の条件を書く。
- `README.md`: 「環境変数」表を足す(agent-policy の README の形)。設定場所はプロジェクトの `.claude/settings.json` の `env`(コミットする)を推奨する。`:118` の「環境変数によるパス指定はありません」は残す。
- `docs/rationale.md`: 既定を無効にした理由を足す。`:155-165` の「設定の食い違いが見えない」への答えとして、プロジェクトの `.claude/settings.json` に置けば共有されることを書く。

codiel:

- 正本 2 本(`adr-candidates.md`・`gotcha-candidates.md`)の冒頭と「なし」の理由。
- §4 に挙げた規範文 5 か所。`intent-format.md` を変えるので、`plugins/codiel/docs/format-change-checklist.md` の該当項目をすべて追随させる。
- `orchestrating-runs/SKILL.md` §0 の判断表、`capturing-intent/SKILL.md` の init 引数、`orchestrating-runs/references/resume.md`。
- `README.md`、`docs/DESIGN.md`、`docs/skill-flowcharts.md:586`。

リポジトリ全体:

- ルート `README.md` の Metatron のセクションと Codiel / Metatron の関係。
- `.serena/memories/metatron/core.md` と `codiel/core.md`。
- 本リポジトリの `.claude/settings.json` の `env` に 2 変数を `"1"` で足す(ユーザー承認を要する)。足さないと、このリポジトリのセッションから ADR 一覧と GOTCHAS の注入が消える。

## 6. テストの隔離

- vitest は `pnpm run test` を起動したシェルの環境を継承する。§5 で `.claude/settings.json` に 2 変数を足すと、このリポジトリのセッションでは常に有効の状態で走る。
- 子プロセスを起動するヘルパは、継承した env から 2 変数を消し、呼び出し側が値を明示して渡す形にする。対象は次のとおり。
  - metatron `inject-context.test.ts` の `childEnv()`・`runHook`・`injectSubagent`(`injectSubagent` に env の引数を足す)。
  - metatron `cli.test.ts` の `runCli`(env の引数を足す。既存の ADR・GOTCHAS の書き込みは両方有効を渡す)。
  - codiel `check-intent-env.test.ts` の `runScript`。
- `buildForSubagent` も env を引数で受ける。
- 既存の ADR・GOTCHAS のテストは両方有効を渡して改修前の期待値を保つ。S6 の書き込みサブコマンド総当たりも両方有効を既定にする。
- 新しいテストは次を固定する。
  - 4 通りの組み合わせの注入文(SessionStart と SubagentStart)。
  - 無効時の書き込み CLI の拒否、終了コード 1、ファイル無変更。
  - `get config` の `features`、`diff-architecture` の `section_missing`、`guard-docs` の理由文。
  - codiel の `check-intent-env` 出力、`codiel-state init` の保存と必須引数の欠落時の失敗、項目が無い state の扱い。
  - 2 者比較テスト(§2)。
- 完了時に、2 変数を `1` にしたシェルと未設定のシェルの両方で `pnpm run test` を通す。

## 7. バージョン

- metatron は 0.4.0-dev → 0.5.0-dev。
- codiel は 1.0.0 → 1.0.1。
- どちらも `plugin.json` と `package.json` を揃える。

## 8. ADR

- 新しい ADR-015「[metatron] ADR と GOTCHAS の記録を環境変数でオプトインにし、codiel の候補も同じ変数に従わせる」を足す。
- ADR-013 は状態を `採用` のまま残す。ADR-015 の本文に、ADR-013 の「候補を手元に書く」範囲を変数が有効な種別へ狭めたと書く。
- ADR-015 の本文に、ADR 候補が無効の run では 3 条件を満たす判断がどこにも残らないことを書く。
- 記録は `metatron:updating-architecture` を起動して行う。CLI のゲート実装後に記録するので、このセッションでは `AMATSUKA_METATRON_ENABLE_ADR=1` を前置して CLI を実行する。

## 9. 実装計画

| Step | 内容 | 担当(役割) | 依存 |
| --- | --- | --- | --- |
| 1 | metatron src: `features.ts`、`inject-context.ts`、CLI のゲート、`get config`、`diff-architecture`、`guard-docs`、テスト、build | 複雑な実装(lead-implementer) | なし |
| 2 | codiel src: `check-intent-env`、`codiel-state`、2 者比較テスト、既存テストの init 引数追随、build | 通常の実装(general-implementer) | なし |
| 3 | metatron のスキル・references・README・rationale、バージョン 0.5.0-dev | 通常の実装(general-implementer、prompt-smith を指定) | 1 |
| 4 | codiel のスキル・references・README・DESIGN・skill-flowcharts、format-change-checklist の追随、バージョン 1.0.1 | 通常の実装(general-implementer、prompt-smith を指定) | 2 |
| 5 | ルート README、Serena メモリ、`.claude/settings.json`、ADR-015 | オーケストレーター | 3, 4 |
| 6 | 変数あり・なしでの lint / typecheck / test / build、section-reference-inventory の登録簿の追随、コードレビュー | オーケストレーター、コードレビュー(code-reviewer) | 5 |

- Step 1 と 2 は並列に進める。Step 3 と 4 も並列に進める。
- 並列の間、各担当は自分のプラグインのテスト(`pnpm --filter <plugin>-scripts test` など)だけを通す。リポジトリ全体の検査は Step 6 で行う。
- Step 4 で codiel の skills・references に `ARCHITECTURE` や `## ADR 一覧` の形の文字列を新しく書いたら、metatron の `section-reference-inventory.test.ts` が失敗しうる。登録簿の追随は Step 6 で行う。
- コミットは metatron src・codiel src・metatron 文書・codiel 文書・リポジトリ全体と ADR に分ける。
- `hooks.json` は変えないが注入の挙動が変わるので、完了後に新しいセッションで注入文を確かめるようユーザーに依頼する。
