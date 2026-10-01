# Raguel を層ごとに作り直す 設計書

- 作成日: 2026-09-28
- 状態: 設計(第 7 版)・承認済み(2026-09-29。第 6 版も 2026-09-29 に承認)。実装中に、実機確認 1〜3・5〜8 の結果で §6.7.2・§6.7.3・§11 の【要確認】を確定値に直し、実機確認 4・9 の結果で §6.4.4・§6.12.1・§15 の 2・4 を確定した。W4 のレビューを受けて、§6.2.2 の手順 6・7、§6.4.2(`://` の行のエントロピー、rename)、§6.9.4(`head` の null)、§6.13.1(改竄の STOP)、§6.13.3(検査 8・9 と、フェーズの間の連続性)、§7.1(設定の行)、§13 を改めた(いずれも 2026-09-29、ユーザー承認)。2026-09-30 には、codiel の手動確認 O4C-6 を受けて `subject.ignoreUncommitted` を足した(§6.2.2 の手順 3、§6.2.5、§6.12.1、§6.12.3、§11。ユーザー承認)。未コミットの検査から外すパスを宣言する設定である
- 対象: `plugins/codiel/raguel-mcp`(主)、codiel で Raguel を使う箇所(`skills/raguel-gating`、`skills/orchestrating-runs`、`src/codiel-state.ts`、`src/hooks/guard-write.ts`・`guard-bash.ts`)
- バージョン: codiel `1.0.0` → `1.0.0-dev`、raguel-mcp の `package.json` `0.0.1-dev` → `0.0.2-dev`(§8。2026-09-29 にユーザーの指示で改めた。旧目標は `1.1.0-dev`・`0.1.0-dev`)
- 入力: ユーザー合意の決定 R1〜R24(2026-09-28〜29)、所見 `harness-docs/handover/2026-09-28-raguel-redesign-findings.md`(以下「所見」。A1 などの番号はこの文書のもの)、引継ぎ `harness-docs/handover/2026-09-28-raguel-redesign-handover.md`
- 先行設計: `harness-docs/design/2026-09-27-codiel-intent-driven-design.md`(以下「codiel 設計」)の §6.1.1・§6.2.2・§6.13.2・§6.14(決定 83)、`plugins/codiel/raguel-mcp/docs/DESIGN.md`(以下「旧 DESIGN」)
- 実装計画書(WBS): `harness-docs/plans/2026-09-29-raguel-redesign-plan.md`

第 2 版では、レビューのうちオーケストレーターが採った 7 件を直した。プロジェクトルートを codiel の `findMainRoot` と同じアルゴリズムの独立実装に改め、projectId と書き分けた(§6.2.1、§6.9.1、§6.14、§11)。`code/dangerous-patterns` を破壊操作と実行の 2 つのルール ID に分けた(§4、§6.4、§6.12)。`--setting-sources project` の確認を着手前の最初の確認にし、代替の候補と判断を足した(§6.7.2、§7.2、§15)。MinHash の定義(§6.9.3)と、既知の証拠ファイルの範囲(§6.10)を明記した。jev を試験的な選択肢にした(§1、§6.7.4、§7.2、§9、§15)。所見文の読み手がオーケストレーターであることと、人に聞く質問文の規則を足した(§6.13.1)。第 3 版では、ユーザーが決めた第 2 版の未決事項 3〜6 を決定 R15〜R18 として §1 に足し、文書の standard での crosscheck(§6.6.1、§6.6.3、§6.8、§7.1、§11)、pass-gate の追加の検査の採用(§6.13.3)、ASK の回数の上限の撤去(§6.13.1)、ADR の 1 本化(§9、§14)を反映して、§15 から 4 件を消した。第 4 版では、ユーザーの決定で R14 を改めて jev をパネルのプロバイダーから外し(§6.7、§7、§12、§15)、R19 を足してルール層と重さ判定の一部を Jev の任意の文脈判定で補うようにした(§4、§6.3、§6.4.4、§6.5、§6.8、§6.12、§7、§9〜§12、§15)。第 5 版では、codiel 1.0.0 の手動確認の所見(§3.5)を受けたユーザーの決定 R20〜R22 を足し、保護パスの既定の除外と生成物の宣言(§6.4.2、§6.12、§9、§11)、締切の延長とバックグラウンドへの移行を正規の経路にすること(§5、§6.8、§6.12、§7.2、§11、§12、§15)、空の差分を正規の入力にすること(§6.2.2、§6.13.1、§7.1)を反映した。第 6 版では、codiel の M4 で `raguel.config.yaml` が `.codiel/config.json` の `raguel` キーへ移ることを出発点の前提に取り込み(R23、§3.1)、設定の置き場・形式・guard の対象・configSource・依存・文書の記述を改めた(§3.2、§6.2.5、§6.3、§6.9.1、§6.12、§6.13.3、§6.13.4、§6.14、§8〜§12)。第 7 版では、codiel の M4-C(`7130f69c`)の結果を出発点に取り込み(§3.1)、ユーザーの決定 R24(Raguel が `testsDir` を読み、E2E のレポートを生成物と同じに扱う)を足し(§6.2.2、§6.4.2、§6.12、§6.14、§7.1)、configSource の文言の確定(§6.2.5)、`findMainRoot` の M4 後のアルゴリズムへの追随(§6.9.1)、raguel-gating の応急処置の撤去と退避先(§6.13.1)、guard の順序(§6.13.4)、ADR-009 との関係(§9)を反映した。

ファイルパスは次のとおり略記する。R は `plugins/codiel/raguel-mcp/src`、C は `plugins/codiel`。行番号は、第 6 版までは HEAD `c37ab969` で確かめた値である。第 7 版で codiel 側(`C/src/**`・`C/skills/**`)の行を引くときは、M4-C の後のコミット `7130f69c` で確かめた値にし、「(`7130f69c`)」を添える。R の行番号は `c37ab969` の値のままで、M4 と M4-C が変えた `R/config/loader.ts` などは作り直しで書き換える。

---

## 1. 確定済みの決定(この設計の前提)

次の決定はユーザーが確定させた。本設計はこれを覆さず、別案も提示しない。「具体化」列が本設計の該当セクションを指す。

| # | 論点 | 決定 | 具体化 |
| --- | --- | --- | --- |
| R1 | 作り直しの形 | MCP ツール面と、rules・weight・panel・casefile・precedent の層構成を残し、層ごとに改修する。M4 の応急処置 11 件を土台にする | §3、§5、§6 |
| R2 | 評価対象の真正性 | Raguel が評価対象を自分で読む。evaluate_code は `baseRef` と任意の `paths` から git diff を自分で作り、diff の書式を固定する。evaluate_plan・evaluate_design はファイルパスを受けて読む。読んだ内容の sha256 と HEAD を記録する。evaluate_decision は判断文のまま | §6.2.2〜§6.2.4、§6.9 |
| R3 | STOP と人の裁定 | 改竄検知以外のルール由来の STOP は、人が誤検知と裁定すれば record_outcome を経て通せる。裁定は判例に残す。resubmission-loop は、前回の ruleId が消えた再提出と、人の裁定を経た attempt を比較から外す | §6.2.7、§6.4.2、§6.13.1 |
| R4 | ルールと LLM の分担・重さ | design・plan・decision は常に standard 以上。trivial は code の小さな差分だけ。不可逆キーワードの重さの加点は廃止。語彙ヒューリスティックのルールは info に下げてパネルの入力にする。STOP は秘密情報・保護パス・破壊操作・改竄の 4 種だけで、ほかは最大 ASK | §6.4、§6.5 |
| R5 | パネル構成 | standard は adversarial と steelman で、合成は決定論(meta なし)。critical は adversarial・steelman・crosscheck・meta。assumption と precedent のパネリストは撤去する。軸は「100 = 問題なし」に揃えてプロンプトに書く。スコアの乖離は同じ立場のパネリスト同士で測る | §6.6 |
| R6 | 基盤の障害と内容の懸念 | 応答に `judgeStatus: ok \| degraded` を足す。nonzero-exit とタイムアウトは 1 回だけ再試行し、なお失敗なら ASK。degraded の ASK は resubmission-loop と判例から外す。codiel は degraded の ASK で「再評価 / そのまま承認 / 止める」を人に聞く。ゲート全体に締切を置き(第 5 版で R21 により既定 600 秒へ改めた)、`extra.signal` で子プロセスを止め、進捗を通知する | §6.8、§6.13.1 |
| R7 | 判例 | 判例を生むのは人の裁定(approved・rejected・誤検知の override)と incident だけ。`panel/*-error`・`kernel/*` を firedRules から除き、degraded の評価は判例にしない。検索結果は adversarial と meta の参考入力にし、失敗判例の合致は info 所見にする。一覧と退役の保守ツールを足す | §6.2.9、§6.11 |
| R8 | パネリストの隔離 | 子プロセスの env はそのまま引き継ぐ。`--setting-sources project`、空の一時 cwd、`--no-session-persistence`、`--strict-mcp-config`、ツール無効を付ける。引数は vitest で固定し、hooks・CLAUDE.md が読まれないことは `claude -p` の実機で 1 回確かめる(費用があるので実装時にユーザーに先に確かめる) | §6.7.2、§7 |
| R9 | 設定と sealed | 未知のトップレベルキー・ルール ID・パラメータと未知の version は読み込みエラー。sealed ルールは無効化・severity の引き下げ・全一致の allowPatterns・不正な正規表現を拒む。allowPatterns はトークンに当てる。配列は sealed ルールのリストだけ既定値との和集合、ほかは置換。list_rules に設定できるパラメータを載せる | §6.12 |
| R10 | codiel との結合契約 | codiel のフェーズ列を Raguel に埋め込み、evaluate_* はフェーズ名を受ける。attempt・再提出・前フェーズ証拠をフェーズ単位で扱い、順序は codiel のフェーズ列で解く。前フェーズの本文(上限付き)は tier と verdict に関係なく保存する。フェーズ列を変えたときの追随の手当てを持つ | §6.1、§6.14 |
| R11 | pass-gate の検証 | codiel-state の pass-gate が Raguel の評価の索引と verdict.json を読み、evaluationId・runId・フェーズ・verdict の一致を確かめる。`--human-approved` なら裁定の記録も確かめる。code 系フェーズは記録の HEAD と現在の HEAD の一致を確かめる。記録の形式は契約として文書にし、実装は各自で持つ | §6.9、§6.13.3、§6.14 |
| R12 | 改竄からの保護 | ハッシュチェーンの入力に verdict・evaluationId・runId・前の attempt の head を入れ、照合は既知の証拠ファイル名に限る。codiel の guard は run が active の間 Raguel の設定(第 6 版で R23 により `.codiel/config.json` に改めた)と `~/.raguel` への書き込みを拒む | §6.10、§6.13.4 |
| R13 | 範囲 | 所見 A1〜J4 の全件について「直す / 応急処置のまま残す / 扱わない」と設計箇所を表で決める | §4 |
| R14 | パネルのプロバイダー | パネリストと meta は claude / codex を設定で切り替えられる。既定は claude。全体の値とパネリストごとの上書きを持つ。codex は `codex exec` を子プロセスで起動する。2 プロバイダーを 1 つのインターフェースの実装として並べ、fake で vitest を書く。jev はパネルのプロバイダーにしない(第 4 版で改めた。ユーザー決定) | §6.7、§7、§9、§12 |
| R15 | 文書のゲートの crosscheck | 文書のゲートの standard では、前フェーズの証拠があれば crosscheck を adversarial と並列に起動する。meta は critical だけに残す | §6.6.1、§6.6.3、§6.8、§7.1、§11 |
| R16 | pass-gate の追加の検査 | 検査 8 の `subject.base` の照合、検査 9 の文書の sha256、fix-loop の評価の範囲をフェーズ全体にする変更をすべて採る | §6.13.1、§6.13.3 |
| R17 | ASK の回数の上限 | codiel の「同一フェーズで ASK が 3 回続いたら止める」を撤去する。ASK のたびに人が裁定するので、回数の上限は要らない | §6.13.1 |
| R18 | ADR | ADR 候補 3 件を、1 本の ADR「[codiel] Raguel の作り直し」にまとめ、3 つの判断を要点として並べる | §9、§14 |
| R19 | Jev による文脈判定 | ルール層と重さ判定の一部を、Jev(`@typesafe-ai/sdk` 0.6.0、鍵 `TYPESAFE_API_KEY`)の noul・score の質問で文脈判定する。対象は破壊操作と実行の候補、injection-marker、語彙系の 4 ルール、再提出と重さの 4 つ。既定は無効で、有効にしたときだけ使い、鍵が無い利用者は決定論で動く。Jev が動かせるのは stop → ask と語彙系の info → ask の 2 方向と、再提出の ask・重さの上げ・injection-marker の ask の追加だけで、単独で STOP も PROCEED も出さない。秘密情報・保護パス・計数・構造解析・改竄検知・合成規則は決定論に残す | §6.4.4、§6.5、§6.8、§6.12、§7、§9 |
| R20 | 保護パスの既定の除外と生成物(所見 K1) | `code/protected-paths` に、既定の glob を名指しで外すパラメータと、生成物の glob を宣言するパラメータを足す。外せるのは既定の glob だけで、外した glob は list_rules と応答に出す。宣言した生成物のパスは、保護パス・重さ・パネル・Jev の対象から外し、common/secrets だけを当てる | §6.4.2、§6.12、§9、§11 |
| R21 | 締切の延長(所見 K2) | 1 回の呼び出しの既定を 180 秒、ゲート全体の既定を 600 秒にする。Claude Code が 120 秒で MCP の呼び出しをバックグラウンドへ移すのを正規の経路とし、codiel は完了の通知を待つ。進捗の通知とキャンセルは残す。値は実機で見直す | §5、§6.8、§6.12、§7.2、§11、§12、§15 |
| R22 | 空の差分(所見 K4) | 空の差分を正規の入力にする。ルール層・パネル・Jev を通さずに PROCEED を返し、変更なしの info を残す。評価の記録は書くので pass-gate は通常どおり照合できる。codiel はフェーズの開始の HEAD を渡すだけで、run 全体の差分を渡さない | §6.2.2、§6.13.1、§7.1 |
| R23 | 設定の置き場 | M4 で `raguel.config.yaml` が廃止され、中身が `.codiel/config.json` の `raguel` キー(JSON、内蔵の既定値への差分)へ移るのを前提にする。YAML の記述をすべて改める。作り直しでは `<プロジェクトルート>/.codiel/config.json` を読む。guard の対象、configSource の形、契約の文書と 2 者比較テストも新しい置き場に合わせる | §3.1、§6.9.1、§6.12、§6.13.4、§6.14、§8〜§12 |
| R24 | testsDir と E2E のレポート(2026-09-29) | Raguel は `.codiel/config.json` の `testsDir` を読み、codiel の `readCodielConfig` と同じ規則と既定値を独立に実装する。`<testsDir>/**/reports/**` は生成物と同じに扱い(common/secrets だけを当て、保護パス・重さ・パネル・Jev から外す)、レポートだけの差分は変更なし(R22)として PROCEED にする。利用者の設定も呼び出し側の入力も要らない | §6.2.2、§6.4.2、§6.12、§6.14、§7.1 |

R8 の env の扱いの根拠: 「Anthropic API を使えない利用者も全プラグインを使える」(`harness-docs/ARCHITECTURE.md:5`、ADR-005)は、プラグインが Anthropic API を必須にしないことを指す。利用者の環境に `ANTHROPIC_API_KEY` があり、子プロセスの `claude` がそれを使うのは利用者の裁量である(ユーザー決定 2026-09-28)。そのため所見 C3・H2 のうち鍵に関する部分は扱わない(§4)。

---

## 2. 背景と目的

O2-4・O3-1 の 25 件の評価で、Raguel は run を止めるか素通しさせるかのどちらかに偏った(所見「評価の記録の集計」)。STOP 3 件はすべて codiel 自身が作るパスへの common/secrets の誤検知(A1)、PROCEED 19 件はすべて LLM を通らない trivial(B2)、パネルの起動 12 回はすべて `--json-schema` の拒否で失敗した(C1)。加えて、呼び出し側が渡す要約をそのまま検査していた(F1)ため、PROCEED は成果物の実物を検査した結果になっていなかった。

作り直しの目的は次の 3 つである。

- 検査対象を Raguel 自身が読んだ実物にし、その記録を codiel の pass-gate が照合する(R2・R11)。
- STOP を 4 種の確かな危険に絞り、それ以外の懸念を LLM パネルと人の裁定に回す(R3・R4・R5)。
- 基盤の障害を内容の懸念と分け、障害で run と判例が汚れないようにする(R6・R7)。

---

## 3. 前提

### 3.1 出発点は M4-C の後の HEAD(`7130f69c` 以降)である

実装は、codiel の M4 と M4-C が終わった後の HEAD(`intent-driven-development` の `7130f69c` 以降。codiel `1.0.0`)から始める。その時点の raguel-mcp には応急処置 11 件(codiel 設計 §6.14.1 の Raguel 側 5 件、§6.14.2 の codiel 側 6 件)が入っている。この worktree の src にはまだ入っていないので、応急処置の内容は codiel 設計 §6.14 の記述を正とする。

M4 では、Raguel の設定の置き場と形式も変わる(ユーザー決定 2026-09-28。codiel の intent 駆動化の実装セッションからの知らせ)。本設計はこれを出発点に含める(R23)。

- `raguel.config.yaml` は廃止され、中身は `.codiel/config.json` の新しいキー `raguel` へ移る。値の形は旧 `raguel.config.yaml` と同じ内蔵の既定値への差分で、JSON で書く。`config.json` が持つキーは `testsDir`・`runsDir`・`raguel` の 3 つで、git で共有する。
- M4 の Raguel は、環境変数 `RAGUEL_CONFIG` が指すファイル、`<cwd>/.codiel/config.json` の `raguel`、内蔵の既定値、の順に読む。`RAGUEL_CONFIG` が指すファイルも `raguel` の値と同じ形の JSON である。Raguel は YAML を読まなくなり、`yaml` の依存を外す。
- 応急処置 (3) の振る舞い(呼び出しごとに mtime で読み直す、protected-paths の globs の和集合、configSource)は保たれる。
- `raguel.config.yaml` を持つプロジェクトでは、`/codiel:init` が中身を `config.json` の `raguel` へ写し、承認を得て YAML を消す。Raguel は YAML に縮退しない。移していないプロジェクトでは、codiel の初期化の判定で `/codiel:run` が止まり、`/codiel:init` を案内する。
- M4 で直すのは `R/config/loader.ts` と、関係するテスト(`tools.test.ts`・`pipeline.golden.test.ts` の該当箇所)である。

M4-C(codiel 設計の決定 84〜109、§6.15〜§6.19)は、`.codiel` の構成を組み直した。`7130f69c` で確かめた事実のうち、本設計に関わるものは次のとおりである。

- 上の設定の移行は M4-C で入った。`R/config/loader.ts`(`7130f69c`)の configSource は `env:<パス>`・`cwd:<config.json の絶対パス>`・`defaults` の 3 種で、`config.json` はあるが `raguel` キーが無いときは `defaults` になる。読み直しは、`RAGUEL_CONFIG` か cwd の `config.json` のパスと mtime で判定する。raguel-mcp の `package.json` から `yaml` は消えた。
- `C/src/codiel-state.ts:318`(`7130f69c`)の `readCodielConfig(codielRoot)` は `{ testsDir, runsDir }` を返し、`raguel` は読まない。既定は `testsDir` が `docs/codiel/tests`、`runsDir` が `docs/codiel/runs` である(`:212-213`)。JSON でない、オブジェクトでない、値が文字列でない・空・絶対パス・`..` のセグメントを含む、のどれかは例外を投げる。CLI の `codiel-state config` と `codiel-state gitignore` がこれを使う。
- run の間に codiel が `.codiel/config.json` を書く手順は無い。書くのは run の外の `/codiel:init` だけである。雛形は `C/skills/initializing-harness/config.example.json` である。
- E2E のレポートは `<testsDir>/e2e/{frontend,backend,cli}/<名前>/reports/<YYYYMMDD-HHMMSS>-<slug>-try<n>/` に置かれ、`results.json`・`summary.md`・`failure.md` がコミットされる。オーケストレーターは evaluate_code の前にレポートをコミットする。M4-C の raguel-gating は、`git diff` に `':(exclude,glob)<testsDir>/**/reports/**'` を足してレポートを外し、空かどうかも外した後の diff で決める(`C/skills/raguel-gating/SKILL.md:66`(`7130f69c`)、codiel 設計 §6.17.4、決定 104)。
- M4-C の応急処置(codiel 決定 97)で、raguel-gating の対応表の implement・test-loop・fix-loop の行に「そのフェーズの差分が空なら `git diff <base>...HEAD` を渡す」が足された(`SKILL.md:58`(`7130f69c`))。
- guard-write の判定の順序は、state.json の deny、active run、`state.intent`、config を 1 回読む(不正なら null)、未記録の GOTCHAS の退避先 1 ファイルを通す、`docs/intents/**`、文書フェーズ、コード系フェーズ、の順になった(codiel 設計 §6.17.6)。`findActiveRun` の後に `status !== "active"` で通す分岐があり、awaiting_human の run では以降の判定をすべて通す(`C/src/hooks/guard-write.ts:229-230`(`7130f69c`))。guard-bash の state.json の判定は、`parseCommands` の語の列で見る `writesStateJson` になった(`guard-bash.ts:754`(`7130f69c`)、決定 96)。
- 誤検知の退避先(未記録の GOTCHAS)は `<runsDir>/<slug>/unrecorded-gotchas.md`、run が無いときは `.codiel/reports/unrecorded-gotchas.md` になった(raguel-gating `SKILL.md:137`(`7130f69c`))。
- `findMainRoot` は git を呼ばない形になった(`C/src/hooks/lib.ts:575-580`(`7130f69c`)。§6.9.1)。
- ARCHITECTURE に ADR-009(`.codiel/config.json` に testsDir・runsDir・raguel を集め、run の文書を git で共有し、state と報告を手元に残す)が足された。`R/../docs/DESIGN.md` は今も `raguel.config.yaml` を説明している。
- codiel の手動確認 O4C-6〜O4C-8 は、作り直しの後へ回った(ユーザー決定。手順と確認項目は codiel 計画書 §6.8)。

raguel-mcp は codiel プラグイン内の独立した pnpm workspace(`pnpm-workspace.yaml` の `plugins/codiel/raguel-mcp`)で、`raguel-mcp/build.ts` が `dist/server.mjs` を作る。`dist/` は手で編集しない。テストはルートの vitest(`vitest.config.ts` の `plugins/**/__test__/**/*.test.ts`)が実行する。

### 3.2 応急処置 11 件の引き継ぎ

| 応急処置 | 本設計での扱い |
| --- | --- |
| (1) JSON Schema から `$schema` を外す | 残す。claude と codex のプロバイダーが共有する(§6.7)。fake-claude が `$schema` の混入を失敗にする(§7.1) |
| (2) secrets のエントロピー判定からパス・diff 見出しを外す、既知パターンは `://` の行でも照合、`sk-` に語境界 | 土台に残し、トークンの分割・見出しの構造的な除外・伏せ字を足す(§6.4.2) |
| (3) 評価ごとの設定の読み直し、protected-paths の globs の和集合、configSource | 残す。和集合を sealed ルールのリスト全般へ広げ(§6.12)、起動時の扱いを揃える(§6.12.4)。読む `.codiel/config.json` を、M4 の `<cwd>/.codiel/config.json` から `<プロジェクトルート>/.codiel/config.json` へ改める(§6.9.1) |
| (4) dangerous-patterns を `.md`・テスト・コメント行で ask | 残す。破壊操作だけを STOP にする分割の中へ組み込む(§6.4.2) |
| (5) plan の欄をつなぐ、ハンクの無い diff と両渡しを入力の誤りに | 入力そのものを置き換える(§6.2)。入力の誤りを isError で返す形は残す(§6.2.6) |
| (6) STOP を人が裁定する経路 | 正規の設計にする(§6.2.7、§6.13.1) |
| (7) STOP で止めた try の次は人の承認 | 正規の設計にし、state だけでなく Raguel の記録でも確かめる(§6.13.3) |
| (8) 全文と git diff の実物を渡す | Raguel が自分で読む形に置き換える(§6.2) |
| (9) ツール名の修正 | 残す |
| (10) 委譲を前景で出す | 残す |
| (11) objective の本体と注記、test-code の Red の注記 | 残す。`testResults` はパネルの参考入力になる(§6.2.2) |

### 3.3 変えない前提

- 判定は `PROCEED` / `ASK` / `STOP` の 3 値で、優先は STOP > ASK > PROCEED である。
- 判定不能は ASK に倒す(フェイルクローズド)。
- パネル・meta の自由記述(rationale・message)は合成の入力にしない(旧 DESIGN §10 の不変条件 7)。
- 成果物は信頼しない入力として、ランダムなノンス付きのデリミタで囲んで渡す(`R/panel/prompts.ts` の `frameUntrusted`)。
- ケースファイルは作業ツリーの外(既定 `~/.raguel`)に置く。
- `raguelRunId = <slug>-try-<n>` と、codiel の `STAGES`・`GATED`(`C/src/codiel-state.ts:119-145`)は codiel 設計のまま使う。

### 3.4 探索結果と実コードの食い違い

所見と引継ぎの記述は、この worktree のコードとおおむね一致した。食い違いと補足は次のとおりである。

- この worktree の `C/skills/orchestrating-runs/SKILL.md:167-171` は test-code を持たず `.codiel/specs/` を使う M3 時点の記述で、`C/src/codiel-state.ts:119-145` は test-code を持つ。M4 で揃うので、本設計は M4 後の姿(codiel 設計 §6.1.1・§6.13)を前提にする。
- パネルの fake は `R/panel/testing/fake-claude.mjs` にある。テスト方針(`.claude/rules/metatron/testing-policy.md`)は子プロセスのエントリポイントを `src/testing/` に置くと定めるので、作り直しで `R/testing/` へ移す(§7.1)。
- `R/panel/claudeCli.ts:143-146` のコメントは、`--setting-sources ""` がログインを外すため使わないと書く。R8 の `--setting-sources project` はログインを保つと推定するが、実機で確かめる(§7.2)。
- `.serena/memories/codiel/raguel_mcp.md` は codiel `0.4.1-dev`、パネリスト 6 種(assumption・precedent を含む)を前提に書かれており、作り直しの後は食い違う(§9)。

### 3.5 codiel 1.0.0 の手動確認で見えたこと

codiel 1.0.0 の手動確認 O4-1a・O4-1b(2026-09-28、commit `bbb82f27`、応急処置の入った raguel-mcp)で、別のセッションが次の 4 件を報告した。評価の記録は `~/.raguel/cases` にある。

| # | 所見 | 本設計での扱い |
| --- | --- | --- |
| K1 | 応急処置 (3) で `code/protected-paths` の globs が既定値との和集合になり、利用者は `infra/**`・`.github/**` の保護を外せない。IaC を直す run と CI を直す run は、implement の evaluate_code が毎回 STOP になる。ビルドの出力をソースと同じコミットに入れる規約(このリポジトリの `plugins/*/scripts/**` など)で生成物を保護パスに入れても、同じく毎回 STOP になる。O4-1b は、保護パスから `scripts/**` と `dist/**` を外して回避した | R20(§6.4.2、§6.12) |
| K2 | adversarial が 60000 ms でタイムアウトし、ASK になった。O4-1a で 1 回、O4-1b で 2 回続けて起きた。O4-1b では、同じ run の中で meta のスコアの向きが逆転した(80/85/80 → 20/15/25) | R21(§6.8)。向きの逆転は R5 の「100 = 問題なし」の根拠(§6.6.2) |
| K3 | `plan/irreversible-ops` が「非 ASCII 文字を取り除く」の「削除」を拾った(evaluationId `a99cbf00-df2b-46e8-b000-6419745f2b5b`)。panel/assumption は仕様の曖昧さで 5 件の ASK を出した | 第 4 版で手当て済み。語彙系の info 化と Jev の文脈判定(所見 A8、§6.4.2、§6.4.4)、assumption の撤去(§6.6.1) |
| K4 | 変更の無いフェーズ(修正の要らない test-loop)では差分が空になり、応急処置はこれを入力の誤りにした。O4-1b は run 全体の diff を渡して ASK になった(evaluationId `c1351661-5c45-45b4-9cb2-7b18f5126c00`) | R22(§6.2.2、§6.13.1) |

---

## 4. 所見の扱い

「扱い」は、直す・応急処置のまま残す・扱わない のどれかである。「応急処置」列は codiel 設計 §6.14 の番号で、「部分」は所見の一部だけを手当てするもの。

| 所見 | severity | 扱い | 理由 | 設計箇所 | 応急処置 |
| --- | --- | --- | --- | --- | --- |
| A1 | critical | 直す | (2) は見出し行の除外を文字列の形で判定する。Raguel が diff と見出しを自分で組むので、見出しを構造的に外し、`/` を含む語を区切って測れる | §6.4.2 | (2) 部分 |
| A2 | critical | 直す | (2) で既知パターンの素通りは塞がる。`user:pass@` の形を足す | §6.4.2 | (2) |
| A3 | high | 直す | R9 | §6.12.3 | なし |
| A4 | high | 直す | R4 で STOP を破壊操作に絞る。`code/dangerous-patterns` を `code/destructive-ops`(stop)と `code/unsafe-exec`(ask)に分け、見逃しのパターンを足す。Jev が有効なら、実行されない候補の stop を ask に下げる | §6.4.2、§6.4.4 | (4) 部分 |
| A5 | critical | 直す | (4) の引き下げを 2 つのルール ID の正規の規則として残し、ファイルの種別を Raguel が自分で知る。Jev が有効なら文脈でも絞る | §6.4.2、§6.4.4 | (4) |
| A6 | high | 直す | R2 で diff の書式を固定する。引用符付きのパスの復号も入れる | §6.2.2、§6.4.2 | なし |
| A7 | medium | 直す | R4 で info に下げる。日本語の語彙は足さない(パネルが読むため)。Jev が有効なら、objective の外へ及ぶかを文脈で問い ask に上げうる | §6.4.2、§6.4.4 | なし |
| A8 | medium | 直す | 語幹一致と片仮名語を足す。info の所見でもパネルの入力になる。Jev が有効なら、不可逆な操作を行うかを文脈で問う | §6.4.2、§6.4.4 | なし |
| A9 | medium | 直す | design から外し、`## Step N` の見出しを数える。info に下げる | §6.4.2 | なし |
| A10 | medium | 直す | package.json の依存ブロックだけを見る。npm 以外のマニフェストは扱わない(§13) | §6.4.2 | なし |
| A11 | medium | 直す | Go・Python・Java の命名規則と skip 表記を足す | §6.4.2 | なし |
| A12 | medium | 直す | `system prompt` の誤検知だけ直す。語順の変形は adversarial に任せ、Jev が有効なら文脈判定で ask を足す | §6.4.2、§6.4.4 | なし |
| A13 | medium | 直す | Raguel が組む diff から接頭辞の無いパスと新規ファイルの印を得る | §6.6.2 | なし |
| A14 | high | 直す | R9 | §6.12.2 | なし |
| B1 | high | 直す | R4。Jev が有効なら、キーワードの加点の代わりに被害と取り消しにくさの水準で tier を上げる | §6.5、§6.4.4 | なし |
| B2 | high | 直す | R4 | §6.5 | なし |
| B3 | medium | 直す | 近接判定を固定部の最長接頭辞で行う | §6.5 | なし |
| C1 | critical | 応急処置のまま残す | (1) で原因が消える。再発は fake-claude の引数検査で止める | §6.7.2、§7.1 | (1) |
| C2 | high | 直す | R5 | §6.6 | なし |
| C3 | high | 直す(設定の読み込み)/ 扱わない(鍵) | 読み込みは R8。鍵はユーザー決定(§1 の R8 の根拠) | §6.7.2 | なし |
| C4 | medium | 直す | R6 | §6.8 | なし |
| C5 | medium | 直す | `panel.standard`・`panel.critical` を空にできなくし、`provider: none` を degraded の ASK に固定する | §6.7.1、§6.12.3 | なし |
| D1 | critical | 直す | R2・R3・R11。(6)(7) を正規の設計にし、Raguel の記録で照合する | §6.2、§6.13 | (6)(7) |
| D2 | high | 直す | R6 | §6.8 | なし |
| D3 | high | 直す | 内部エラーにも一意の evaluationId を発行し、索引に書く | §6.2.6 | (5) 部分 |
| D4 | high | 直す | R11 | §6.13.3 | なし |
| D5 | critical | 直す | R3。Jev が有効なら、修正ありとみなした似た再提出が前回の指摘に対処したかを問う | §6.4.2、§6.4.4 | なし |
| D6 | medium | 直す | 応答に `reasons` と `decisionPoint` を足す | §6.2.5 | なし |
| E1 | critical | 応急処置のまま残す | (3) で解ける。起動時に設定が壊れていても止まらない扱いだけ足す | §6.12.4 | (3) |
| E2 | critical | 直す | (3) の和集合を sealed ルールのリスト全般の規則にする | §6.12.2 | (3) |
| F1 | critical | 直す | R2。呼び出し側が本文を渡す入力を廃止する | §6.2 | (5) 部分、(8) |
| F2 | high | 直す | R10 | §6.1、§6.3 | なし |
| F3 | high | 応急処置のまま残す | (11) と M4 の本体でスキルに test-code が入る。Raguel 側はフェーズ列の埋め込み(§6.1)で test-code を知る | §6.1 | (11) 部分 |
| F4 | medium | 直す | R10 | §6.1、§6.9 | (11) 部分 |
| F5 | high | 応急処置のまま残す | (10) で前景の委譲に揃う | なし | (10) |
| F6 | critical | 直す | plan・design は本文を Raguel が読む。decision の欄はすべて検査の本文に入れる。Jev が有効なら、`rollbackPlan` と `optionsConsidered` の中身を文脈で問う | §6.2.3、§6.2.4、§6.4.4 | (5) 部分 |
| G1 | high | 直す | 一致箇所の抜粋と提出本文の保存 | §6.4.2、§6.9 | (8) 部分 |
| G2 | high | 直す | R7 | §6.11 | なし |
| G3 | medium | 直す | 最後の評価の時刻で掃除し、索引も一緒に掃除する。「掃除済み」と改竄を別の文言にする | §6.9.5 | なし |
| G4 | medium | 直す | 一時ファイルと rename で書き、読めない索引を上書きしない | §6.9.5 | なし |
| G5 | medium | 直す | projectId を git の共通ディレクトリから作る | §6.9.1 | なし |
| G6 | medium | 直す | R12 | §6.10 | なし |
| G7 | high | 直す | R3。誤検知の裁定を record_outcome で判例に残す | §6.2.7、§6.13.1 | なし |
| G8 | medium | 直す | R12 | §6.10、§6.13.4 | なし |
| H1 | medium | 直す | 一致したトークンを伏せ字にしてから保存・応答する | §6.4.2 | なし |
| H2 | high | 扱わない | C3 の鍵の部分と同じ事象。ユーザー決定により鍵を除く強制をしない | なし | なし |
| I1 | medium | 直す | fake の子プロセスで引数とスキーマを検査し、欠けた分岐にテストを足す | §7.1 | なし |
| I2 | medium | 直す | R6。スキルにバックグラウンドへ移ったときの扱いを書く | §6.8、§6.13.1 | なし |
| I3 | medium | 直す | 所見をルールとファイルの組で集約して上限を置き、ダイジェストを固定長にする | §6.4.3、§6.9.3 | なし |
| J1 | low | 応急処置のまま残す | (9) で直る | なし | (9) |
| J2 | low | 直す | `server.ts` と応答のビルドバージョンを package.json から取る | §6.2.5、§8 | なし |
| J3 | low | 直す | 旧 DESIGN を書き直し、README に運用のセクションを足す | §9 | なし |
| J4 | low | 直す | 作り直しと同時に依存を上げる | §8 | なし |

---

## 5. 全体像

```
codiel(オーケストレーター)
  │ evaluate_*(runId, phase, objective, baseRef | paths | decision)
  ▼
[1] 入力の検証 ── 誤りは isError で返し、記録しない
[2] 評価対象の取得 ── git diff / ファイルを Raguel が読む。sha256 と HEAD を記録
[3] ルール層 ── STOP 4 種 / ask / info。前フェーズ証拠の改竄検知
[4] 文脈判定(任意) ── Jev が stop → ask、info → ask、tier の下限を調整
[5] 重さ判定 ── code だけ trivial がある。文書は standard 以上
[6] パネル ── standard: adversarial(∥ crosscheck)→ steelman
              critical: adversarial ∥ crosscheck → steelman → meta
              プロバイダー: claude / codex(パネリストごと)
[7] 合成 ── 決定論。judgeStatus(ok / degraded)を決める
[8] 記録 ── ケースファイル・評価の索引・ハッシュチェーン
  │ EvaluationResult(verdict, judgeStatus, reasons, subject, casePath ...)
  ▼
codiel-state pass-gate ── 索引・verdict.json・裁定の記録・HEAD を照合
```

[2]〜[7] を通して締切(既定 600 秒)が効く。締切を過ぎたパネリストは障害として扱う(§6.8)。呼び出しが 120 秒を超えると Claude Code がバックグラウンドへ移し、codiel は完了の通知を待つ(R21)。

空の差分(R22)は [2] の後に [3]〜[7] を飛ばして PROCEED になり、[8] の記録だけを書く(§6.2.2)。

---

## 6. 各構成要素の設計

### 6.1 codiel のフェーズ列を埋め込む

Raguel は codiel のゲート付きフェーズを定数として持つ。`R/codiel/phases.ts`(新設)に置き、codiel の `STAGES`・`GATED`(`C/src/codiel-state.ts:119-145`)と同じ値にする。

| フェーズ | ステージ番号 | kind | ツール |
| --- | --- | --- | --- |
| intent | 0 | decision | evaluate_decision |
| design | 2 | design | evaluate_design |
| test-spec | 3 | plan | evaluate_plan |
| dev-plan | 3 | plan | evaluate_plan |
| test-code | 4 | code | evaluate_code |
| implement | 5 | code | evaluate_code |
| test-loop | 6 | code | evaluate_code |
| intent-sync | 7 | design | evaluate_design |
| fix-loop | 10 | code | evaluate_code |

- ステージ番号は codiel の `STAGES` の添字である。ゲートの無いステージ(discuss・pr・review・triage・finalize)も番号を数える。
- evaluate_* は `phase` を必須で受け、表の kind とツールが合わなければ入力の誤りにする(evaluate_plan に `phase: "implement"` を渡すなど)。
- attempt・再提出の比較・前フェーズ証拠は run とフェーズの組で扱う(所見 F4)。
- あるフェーズの前フェーズは、ステージ番号がそれより小さいゲート付きフェーズすべてである。test-spec と dev-plan は同じステージなので、互いに前フェーズにならない。
- 旧 `PHASE_ORDER`(`R/core/pipeline.ts:41`)は廃止する。

追随の手当ては §6.14 に置く。

### 6.2 MCP ツールの入出力

#### 6.2.1 共通の入力

| 入力 | 型 | 旧 | 新 |
| --- | --- | --- | --- |
| `runId` | string | 必須。`^[A-Za-z0-9._-]{1,64}$` | 変えない |
| `phase` | enum(§6.1 の 9 値) | なし | 必須 |
| `objective` | string | 必須 | 変えない |
| `repoPath` | string(絶対パス) | なし | 任意。git を実行する作業ツリー。省略時はプロジェクトルート(§6.9.1) |

`repoPath` は次の順に検証し、どれかに外れたら入力の誤りにする。

1. 絶対パスで、ディレクトリとして在る。
2. `git -C <repoPath> rev-parse --path-format=absolute --git-common-dir` が成功する。
3. その結果の実体パスが、プロジェクトルート(§6.9.1)で同じコマンドを実行した結果の実体パスと等しい。同じリポジトリの別の worktree は通り、別のリポジトリは通らない。プロジェクトルートが git の管理外なら、`repoPath` を受けない。

照合するのは git の共通ディレクトリであり、プロジェクトルートの位置ではない。利用者が自分で作った worktree でサーバーが起動したとき、プロジェクトルートはその worktree になる(§6.9.1)が、メインの作業ツリーを `repoPath` に渡しても共通ディレクトリが同じなので通る。

codiel のゲートは、並列の worktree をマージした後に run ブランチ(メインの作業ツリー)で呼ぶ(codiel 設計 §6.6.4 の手順 10、§6.13.2 の手順 8)。そのため codiel は `repoPath` を渡さなくてよい。`repoPath` は worktree で直接ゲートを呼ぶ使い方のために置く。

#### 6.2.2 evaluate_code

| 入力 | 旧 | 新 |
| --- | --- | --- |
| `diff` | unified diff の全文 | 廃止 |
| `files` | `{path, content}[]` | 廃止 |
| `baseRef` | なし | 必須。比べる起点のコミット |
| `paths` | なし | 任意。repoPath 相対のパスの列。差分をこの範囲に絞る |
| `testResults` | 受け取るが使わない | 任意。パネルの参考入力と共通ルールの対象にする |

Raguel は次の手順で差分を作る。

1. `baseRef` が `-` で始まれば入力の誤りにする。`git rev-parse --verify --end-of-options <baseRef>^{commit}` でコミットに解決し、失敗したら入力の誤りにする。
2. HEAD を `git rev-parse HEAD` で得る。比べる終点は常に HEAD とし、任意の終点は受けない。pass-gate が HEAD の一致を見る(§6.13.3)ためである。
3. `git status --porcelain --untracked-files=no -- <paths>`(`paths` が無ければ作業ツリー全体)が空でなければ入力の誤りにする。評価した内容と作業ツリーが食い違ったまま記録を残さないためである。未追跡のファイルは評価に入らず、後でコミットすれば HEAD が変わって pass-gate で止まる。設定 `subject.ignoreUncommitted`(glob の列、既定は空。§6.12.1)に当たるパスの未コミットの変更は、この検査で数えない。会話記録を `docs/chat/` に追記するプラグインのように、run と関係の無いファイルを同じ作業ツリーで書き続ける仕組みがある。その作業ツリーでは、code 系のゲートのたびに入力の誤りになる。codiel の手動確認 O4C-6 の local の run では、そのファイルを run ブランチへコミットして回避していた。これを受けて足した(2026-09-30、ユーザー決定)。当たるパスの変更は未コミットのまま評価に入らず、後でコミットすれば HEAD が変わって pass-gate で止まる。宣言した glob は応答の `policy.ignoreUncommitted` と list_rules に出す。この検査では `git status` に `-z` を足して読む。空白を含むパス名と、名前の変更(移動元と移動先の組)を取り違えないためである。名前の変更とコピーは、移動元と移動先の両方が `subject.ignoreUncommitted` に当たるときだけ数えない。設定を読めないときは、何も外さない。
4. 次の固定した書式で `git diff` を実行する。環境変数 `GIT_LITERAL_PATHSPECS=1` を付け、`paths` をパス指定の魔法の書式として解釈させない。

```
git -C <repoPath> -c core.quotePath=false -c diff.noprefix=false -c diff.mnemonicPrefix=false
    -c diff.relative=false -c color.ui=never
    diff --no-ext-diff --no-textconv --no-color --src-prefix=a/ --dst-prefix=b/
    --find-renames --unified=3 <base> <head> -- <paths...>
```

5. 差分が 20 MB を超えたら入力の誤りにする。これはメモリを守る上限で、内容の大きさの懸念は `common/max-size` が ask で扱う。
6. 差分が空なら、正規の入力として扱う(R22)。ルール層・Jev の文脈判定・重さ判定・パネルを通さずに、verdict を PROCEED、`weightTier` を trivial にし、`code/no-change`(info。`baseRef` と HEAD の間にこのフェーズの変更が無い)の所見を 1 件残す。subject(`base` と `head`、`files` は空)・verdict.json・索引は通常どおり書くので、pass-gate の検査(§6.13.3。検査 8 の起点はフェーズの開始の HEAD のまま)はそのまま当たる。修正の要らない test-loop のように変更の無いフェーズがこれに当たる(所見 K4)。前フェーズの改竄の検証(§6.3 の手順 3)は、変更なしでも行い、改竄があれば `casefile/tampered` の STOP にする(2026-09-29、W4 のレビューを受けたユーザー決定)。
7. 差分のファイルがすべて E2E のレポート(`<testsDir>/**/reports/**`。§6.4.2)なら、手順 6 と同じく変更なしとして扱う(R24)。レポートと生成物しかない差分も同じである。レポートと生成物には common/secrets だけを当て(§6.4.2)、stop が出れば STOP にする。`code/no-change` の message に、レポートだけの差分であることと、レポートのパスの件数を書く。subject の `files` にはレポートのファイルを載せる。レポートは evaluate_code の前にコミットされる(§3.1)ので、レポートを除くと空になるフェーズがこれに当たる。

手順 3 は手順 6 より前にある。コミットした差分が空でも、`paths` の範囲に未コミットの変更があれば入力の誤りになる。変更をコミットし忘れたまま「変更なし」で通ることは無い。

diff の書式が固定されるので、`--no-prefix`・`quotePath`・外部 diff・色による取りこぼし(所見 A6)は起きない。ファイル名にタブや引用符があると git は `quotePath=false` でも引用符で囲むので、parseDiff は引用符付きのパスと 8 進エスケープを復号する。解釈できないファイル見出しは `rule-error`(ask)にする。

`testResults` は信頼しない入力として adversarial と crosscheck に渡し、common/secrets と common/injection-marker の対象にする。判定の根拠にはしない。

#### 6.2.3 evaluate_plan と evaluate_design

| ツール | 入力 | 旧 | 新 |
| --- | --- | --- | --- |
| evaluate_plan | `plan`・`steps`・`constraints` | 文字列と配列 | 廃止 |
| evaluate_plan | `paths` | なし | 必須。1〜20 件 |
| evaluate_design | `design`・`requirements` | 文字列と配列 | 廃止 |
| evaluate_design | `paths` | なし | 必須。1〜20 件 |

- `paths` は repoPath 相対のパスである。各パスの実体パスが repoPath の実体パスの内側にあり、通常のファイルで、1 MB 以下で、UTF-8 として読めなければ入力の誤りにする。
- 追跡されていないファイルも読む。design.md と dev-plan.md はゲートを通った後にコミットされる(`C/skills/orchestrating-runs/SKILL.md:195-197`(`7130f69c`)の「ゲート通過直後」)ためである。
- 検査の本文は、ファイルごとに見出し行 `=== <path> ===` を置いてつなぐ。Raguel は見出し行の位置を持ち、ルール層の検査から外す(所見 A1 の files[] の見出しの問題が構造的に消える)。
- ファイルごとのバイト列の sha256 と、読んだ時点の HEAD を記録する(§6.9.2)。
- codiel が渡すファイルは次のとおりである。design は `design.md`、test-spec は作成・更新した `spec.md` と `cases.md`、dev-plan は `dev-plan.md`、intent-sync は書き換えた intent と持続層のファイルである。

呼び出し側が本文を渡す旧入力は残さない。要約を渡せば PROCEED を取れる抜け道(所見 F1)が、旧入力が残る限り塞がらないためである。

#### 6.2.4 evaluate_decision

| 入力 | 旧 | 新 |
| --- | --- | --- |
| `decision` | 必須 | 変えない |
| `optionsConsidered` | 受け取るが本文に入らない | 検査の本文に入れる |
| `rollbackPlan` | 受け取るが本文に入らない | 検査の本文に入れる |

検査の本文は `decision`、`optionsConsidered`(番号付きの行)、`rollbackPlan` をこの順に見出し行でつないだものにする。見出し行はルール層の検査から外す。sha256 は本文全体について記録し、HEAD も記録する(所見 F6)。

#### 6.2.5 応答

| フィールド | 旧 | 新 |
| --- | --- | --- |
| `evaluationId` | UUID。内部エラーは固定値 `internal-error` | 常に UUID |
| `runId` | あり | 変えない |
| `phase` | なし | 足す |
| `kind` | なし | 足す |
| `attempt` | なし | 足す(フェーズ単位の番号) |
| `verdict` | あり | 変えない |
| `judgeStatus` | なし | `ok` / `degraded` |
| `degradedReasons` | なし | `judgeStatus` が degraded のとき、パネリスト名と原因の列 |
| `weightTier` | あり | 変えない |
| `findings` | 全件 | 上限付き(§6.4.3) |
| `reasons` | ケースファイルの `00-synthesis.json` だけ | 応答に足す |
| `decisionPoint` | なし | ASK と STOP のとき、人が判断することを 1 文で |
| `subject` | なし | `{ repoPath, head, base?, files: [{ path, sha256 }] }` |
| `meta` | あり | 変えない |
| `casePath` | あり(内部エラーは空文字) | 常にあり |
| `policy` | `{ configHash, version: 1 }` | `{ configHash, configSource, version: 2, buildVersion, protectedPaths: { excludedDefaults, generated }, ignoreUncommitted }`(§6.4.2、§6.2.2 の手順 3) |
| `contextJudge` | なし | `{ enabled, status, adjustments }`(§6.4.4) |

- `decisionPoint` は合成規則から決定論で作る定型文である。所見 0 件の ASK(degraded など)でも、何を判断するかを示す(所見 D6)。
- `configSource` は M4 の実装(`R/config/loader.ts`(`7130f69c`))の値をそのまま使う。`env:<RAGUEL_CONFIG のパス>`・`cwd:<config.json の絶対パス>`・`defaults` の 3 種で、`config.json` はあるが `raguel` キーが無いときも `defaults` である。作り直しでは config.json を cwd ではなくプロジェクトルートから探すが(§6.9.1)、接頭辞 `cwd:` は変えない。値には読んだ config.json の絶対パスが入るのでどのファイルかは分かり、この値を解釈するプログラムは無い(表示と記録だけに使う)。接頭辞を変えると、M4 の応答と記録を読み比べるときに同じ出所が別の表記になるためである。
- `buildVersion` は raguel-mcp の `package.json` の `version` である(§8)。

#### 6.2.6 入力の誤りと内部エラー

- 入力の誤りは、判定を返さず MCP のツールエラー(`isError: true`)と理由の 1 文で返す。ケースファイルと索引に書かない(応急処置 (5) の形を保つ)。
- 内部エラー(ルール層の外の例外、ケースファイルの書き込みの失敗など)は、一意の evaluationId を発行し、verdict を ASK、`judgeStatus` を degraded にして索引に書く。これで人の裁定と record_outcome の経路が使える(所見 D3)。書き込みそのものが失敗したときは、isError で返す。

#### 6.2.7 record_outcome

| 入力 | 旧 | 新 |
| --- | --- | --- |
| `evaluationId` | 必須 | 変えない |
| `outcome` | `approved` / `rejected` / `incident` | 変えない |
| `ruling` | なし | 任意。`as-is` / `false-positive` / `revise` |
| `notes` | 任意 | `false-positive` のときは必須 |

`ruling` はフェーズのゲートでの人の裁定を表し、無いときは run 全体の結末(PR のマージ・却下・incident)を表す。受け付ける組み合わせは次のとおりで、ほかは `recorded: false` と理由で返す。

| ruling | outcome | 受け付ける評価 | 判例 |
| --- | --- | --- | --- |
| `as-is` | approved | verdict が ASK | judgeStatus が ok のときだけ作る |
| `false-positive` | approved | verdict が STOP で、`casefile/tampered` の所見を持たない | 作る |
| `revise` | rejected | verdict が ASK か STOP | judgeStatus が ok のときだけ作る |
| なし | approved / rejected / incident | すべて | judgeStatus が ok のときだけ作る |

- 裁定はすべて裁定の記録(`outcomes.jsonl`。§6.9.4)に書く。判例を作らない組み合わせも記録は残し、pass-gate がそれを読む。
- `casefile/tampered` の STOP は覆せない。改竄は成果物の懸念ではなく記録の信頼の問題だからである。
- 応答は `{ recorded, precedentId | null, reason? }` とする。

#### 6.2.8 list_rules

- ルールごとに、設定できるパラメータの一覧(名前・型・既定値・現在値・sealed での制約)を載せる(所見 A3)。
- `configSource`・`buildVersion`・プロバイダーの解決結果(パネリストごとの provider と model)を載せる。
- 設定の読み込みに失敗しているときは、ルール一覧の代わりに失敗の理由と設定のパスを返す(§6.12.4)。

#### 6.2.9 list_precedents と retire_precedent

保守用のツールを 2 つ足す(R7)。codiel の run は呼ばず、人か、人に頼まれたオーケストレーターが使う。

| ツール | 入力 | 出力 |
| --- | --- | --- |
| `list_precedents` | `outcome?`・`phase?`・`includeRetired?`(既定 false) | 判例の `id`・`source`・`phase`・`outcome`・`ruling`・`firedRules`・`recordedAt`・`retiredAt` の列 |
| `retire_precedent` | `id`・`reason` | `{ retired, reason? }` |

- 退役は判例ファイルを消さず、索引に `retiredAt` と `retireReason` を書く。退役した判例は検索に出ない。手で消すと索引との不整合が改竄として扱われる問題(所見 G2)を避けるためである。
- 退役できるのはプロジェクトの判例だけである。内蔵のシード判例は `precedent.seedCatalog: false` でまとめて外す。

### 6.3 判定パイプライン

1. 設定(`RAGUEL_CONFIG` が指す JSON か、プロジェクトルートの `.codiel/config.json` の `raguel`。§6.12)を読み直す(応急処置 (3))。読み込みに失敗したら、内部エラーと同じ形(ASK・degraded)で返し、所見に設定のパスと理由を載せる。
2. 入力を検証し、評価対象を読む(§6.2)。
3. 同じ run の前フェーズ(§6.1)の最新 attempt を集め、改竄を検証する。不一致があれば `casefile/tampered`(stop)の所見を出す。
4. 同じ run とフェーズの過去の attempt のダイジェストを読む。
5. ルール層を実行する(§6.4)。
6. Jev の文脈判定が有効なら、ルール層の結果に文脈判定を当てる(§6.4.4)。無効なら何もしない。
7. 重さを判定する(§6.5)。
8. ルール層に stop が無く tier が trivial でなければ、判例を検索し、パネルを実行する(§6.6)。
9. 合成する(§6.6.3)。
10. ケースファイルを書き、verdict.json を確定し、索引に追記する(§6.9)。
11. 保持の上限を超えた run を掃除する(§6.9.5)。

前フェーズ証拠は crosscheck と meta に渡す。中身は前フェーズごとに、提出本文の先頭 4000 文字(`submission.txt`)、ルール層の ask 以上の所見の ruleId、meta の rationale(あれば)、人の裁定(あれば `ruling` と `notes`)である。tier と verdict に関係なく渡す(所見 F2)。旧実装は PROCEED で meta のある attempt の `08-meta.md` だけを使った(`R/core/pipeline.ts:104-142`)。

### 6.4 ルール層

#### 6.4.1 STOP を出せるのは 4 種に限る

| 種 | ルール | 既定 severity |
| --- | --- | --- |
| 秘密情報 | `common/secrets` | stop |
| 保護パス | `code/protected-paths` | stop |
| 破壊操作 | `code/destructive-ops` | stop |
| 改竄 | `casefile/tampered`(kernel が出す。設定不可) | stop |

- ほかのルールは設定で `severity: stop` にできない。設定したら読み込みエラーにする(§6.12.3)。
- `judge.canStop`(旧 DESIGN §2 の 6、`R/core/verdict.ts:15`)は廃止する。パネルと meta は STOP を出せない。
- `onError` は `ASK` だけを受け付ける。既存の設定(M4 で `.codiel/config.json` の `raguel` へ写したもの)の `"onError": "ASK"` を読み込みエラーにしないため、キーは残す。基盤の障害で STOP にする経路は無くなる(R6)。

#### 6.4.2 ルールごとの変更

| ルール | 新しい既定 | sealed | 変更 | 根拠 |
| --- | --- | --- | --- | --- |
| `common/secrets` | stop | ✔ | 下の「秘密情報の検出」 | A1、A2、H1 |
| `common/injection-marker` | ask | ✔ | `system-prompt-forgery` を、命令の語(ignore・無視・従え 等)と同じ行にあるときだけ一致させる。Jev が有効なら文脈判定で ask を足す(§6.4.4) | A12 |
| `common/resubmission-loop` | ask | ✔ | 下の「再提出の判定」。stop への昇格を廃止する | D5、R4 |
| `common/max-size` | ask | | 変えない | |
| `code/protected-paths` | stop | ✔ | globs は既定値との和集合(§6.12.2)。既定の glob の名指しの除外と、生成物の宣言を足す(下の「保護パスの既定の除外と生成物」) | E2、K1 |
| `code/destructive-ops`(新設) | stop | ✔ | 下の「危険なパターン」の破壊操作。Jev が有効なら文脈判定で stop を ask に下げうる(§6.4.4) | A4、A5 |
| `code/unsafe-exec`(新設) | ask | ✔ | 下の「危険なパターン」の実行と権限。Jev の文脈判定は所見の message に添えるだけ(§6.4.4) | A4、A5 |
| `code/dangerous-patterns` | 廃止 | | 上の 2 つに分ける | A4 |
| `code/max-diff-lines` | ask | | 変えない | |
| `code/test-deletion` | ask | | `*_test.go`・`test_*.py`・`tests/`・`*Test.java` と、`@unittest.skip`・`@pytest.mark.skip`・`t.Skip(`・`@Disabled` を足す | A11 |
| `code/new-dependency` | ask | | package.json は `dependencies`・`devDependencies`・`peerDependencies`・`optionalDependencies` のブロックの内側だけを見る。削除行と突き合わせ、新しい名前だけを数える | A10 |
| `plan/irreversible-ops` | info | | 語幹一致にする(`deploy\w*`・`migrations?`・`force[-\s]push`)。デプロイ・マイグレーション・リリース・破棄・上書きを既定の語に足す。Jev が有効なら文脈判定で ask に上げうる(§6.4.4) | A8、B1 |
| `plan/max-steps` | info | | plan だけに当てる。`^#+\s*Step\s*\d+` の見出しを優先して数え、無ければ番号付きリストを数える | A9 |
| `plan/scope-keywords` | info | | info に下げる。Jev が有効なら文脈判定で ask に上げうる(§6.4.4) | A7 |
| `decision/no-alternatives` | info | | info に下げる。Jev が有効なら文脈判定で ask に上げうる(§6.4.4) | R4、F6 |
| `decision/no-rollback` | info | | info に下げる。Jev が有効なら文脈判定で ask に上げうる(§6.4.4) | R4、F6 |
| `precedent/failure-match` | info | | 新設。§6.11 | R7 |

info の所見は判定を動かさず、adversarial・steelman・crosscheck・meta へのプロンプトの「ルール層の所見」に入る。

秘密情報の検出は、応急処置 (2) を土台に次を足す。

- 検査の対象は評価対象の本文だけである。diff のファイル見出し(`diff --git`・`index`・`---`・`+++`・`rename`・`similarity`)とファイルの見出し行は、Raguel が位置を持って外す。文字列の形で判定しない。
- エントロピーの判定は、語を `/` と `.` で区切った各部分に当てる。部分が 20 文字以上で、英大文字・英小文字・数字のうち 3 種を含むときだけ測る。閾値は 4.0 のまま据える。パスや slug は小文字と数字と `-` で書かれることが多く、3 種の条件で外れる。`://` を含む行もエントロピーの判定の対象にする(URL のクエリに埋めた鍵を拾うため。ホスト名とパスの部分は区切りと 3 種の条件で外れる)。lockfile と `node_modules` の行の除外は残す(2026-09-29、W4 のレビューを受けたユーザー決定)。
- `user:pass@` の形(`[a-z][a-z0-9+.-]*://[^\s:/@]+:[^\s@/]+@`)を既知パターンに足す(所見 A2)。
- 所見の抜粋は一致した行の前後 1 行と行番号とし、一致したトークンは先頭 4 文字だけを残して `*` で伏せる。`01-rules.json`・verdict.json・応答・`submission.txt` のすべてで伏せる(所見 H1)。record_outcome の `notes` も、`outcomes.jsonl` と判例の `lesson` に保存する前に同じ規則で伏せる。誤検知の裁定の理由に、オーケストレーターが検出値を書き写すためである。偽の鍵の run(2026-10-01)で、`outcomes.jsonl` に平文が残ったのを受けて足した(ユーザー決定)。
- `allowPatterns` はトークンに当てる(行に当てない)。

危険なパターンは、旧 `code/dangerous-patterns` を 2 つのルール ID に分けて持つ。設定の `severity` はルール ID ごとに 1 つなので、1 つの ID の中で型ごとに既定を変えると、sealed の「既定より軽くしない」の検査(§6.12.3)が決まらないためである。

| ルール ID | パターン | 既定 | sealed |
| --- | --- | --- | --- |
| `code/destructive-ops` | `rm -rf` の `/`・`/*`・`~`・`~/`・`$HOME`・未クォートの変数展開(`"$X"/` を含む)、`git push` の `--force` と `+<refspec>`、`git reset --hard` と `git clean -f` の組、`DROP TABLE`・`DROP DATABASE`・`TRUNCATE`、`WHERE` を持たない `DELETE FROM`(文末の `;` まで複数行を見る) | stop | ✔ |
| `code/unsafe-exec` | `eval(`(メソッド呼び出し `.eval(` を除く)、`new Function(`、外部入力を渡す `child_process` の呼び出し、`curl \| sh`、`chmod 777` | ask | ✔ |

現行の検査(`R/rules/code/dangerousPatterns.ts:19-77`)の行き先は次のとおりである。

| 現行の検査 | 行き先 |
| --- | --- |
| `eval` | `code/unsafe-exec` |
| `new-function` | `code/unsafe-exec` |
| `child-process-external-input` | `code/unsafe-exec` |
| `rm-rf-root-or-home` | `code/destructive-ops`(対象を広げる) |
| `pipe-download-to-shell` | `code/unsafe-exec` |
| `chmod-777` | `code/unsafe-exec`(破壊操作ではなく権限の付与であるため) |
| `force-push-main` | `code/destructive-ops`(`+<refspec>` と main 以外のブランチへ広げる) |
| `drop-table` | `code/destructive-ops`(`DROP DATABASE`・`TRUNCATE` を足す) |
| `delete-without-where` | `code/destructive-ops`(複数行を見る) |

- `code/unsafe-exec` も sealed にする。コード注入の経路を、利用者が設定 1 行で黙って消せないようにするためである。
- 応急処置 (4) の規則を 2 つの ID に当てる。`.md`・テストファイル・コメント行では、`code/destructive-ops` は stop を ask に、`code/unsafe-exec` は ask を info に下げる。ファイルの種別は Raguel が組んだ diff のパスから決まる。
- 設定に旧 ID `code/dangerous-patterns` を書いたら、`code/destructive-ops` と `code/unsafe-exec` を名指しする読み込みエラーにする(§6.12.2)。
- `.exec(` は、直前が `child_process` の識別子(`cp`・`childProcess`・`child_process` の import 名)のときだけ一致させる(所見 A4 の `RE.exec(...)` の誤検知)。

保護パスの既定の除外と生成物(R20、所見 K1)は、`code/protected-paths` の 2 つのパラメータで表す。

| パラメータ | 型 | 既定 | 意味 |
| --- | --- | --- | --- |
| `excludeDefaults` | 文字列の列 | `[]` | 既定の glob(`.github/**`・`infra/**`・`**/*.env*`)のうち、保護から外すもの。既定の glob と文字列で完全に一致するものだけを受ける |
| `generated` | glob の列 | `[]` | 生成物のパス。ビルドの出力をソースと同じコミットに入れる規約の生成物(このリポジトリの `plugins/*/scripts/**`・`plugins/*/dist/**` など)を書く |

- 保護パスの判定に使う glob は、既定の glob から `excludeDefaults` を除き、利用者の `globs` との和集合を取ったものである(§6.12.2)。
- `generated` に当たるパスは、`code/protected-paths`・重さ判定(変更行数・ファイル数・保護パス近接)・パネルの入力・Jev の文脈判定の対象から外す。ほかのルールのうち当てるのは `common/secrets` だけである。パネルには、生成物のファイルごとに「生成物: `<パス>`(`<行数>` 行の変更)」の 1 行だけを渡す。
- `generated` と保護パスの両方に当たるパスは、生成物として扱う。生成物を保護パスに入れて毎回 STOP になる(K1)のを解くためである。
- 名前の変更(rename)は、移動元と移動先の両方のパスで判定する。どちらかが保護パスなら `code/protected-paths` を当て、生成物・レポートとして外すのは両方が外す対象のときだけにする。重さの変更ファイル数と近接、`code/test-deletion` も移動元を見る。保護パスのファイルを外へ移して保護を抜ける経路を塞ぐためである(2026-09-29、W4 のレビュー)。
- 外した既定の glob と `generated` は、list_rules と応答の `policy.protectedPaths: { excludedDefaults, generated }` に出す。黙って外れないようにするためである。
- 差分に生成物のファイルがあり、生成物でないファイルの変更が 1 つも無ければ、`code/generated-only`(info)の所見を出し、生成物のパスを message に書く。生成物に見せかけた手書きの変更を、オーケストレーターと人が見分ける手がかりにする(§11)。

E2E のレポート(R24)は、利用者の設定なしに生成物と同じに扱う。

- レポートは、`.codiel/config.json` の `testsDir`(§6.12.1)の配下で、`testsDir` からの相対パスに `reports/` のセグメントを含むファイルである。判定は codiel の `isE2eReport`(`C/src/hooks/guard-write.ts:119-124`(`7130f69c`))と同じにし、`testsDir` が `.` ならリポジトリ全体を配下とみなす。
- レポートのパスには `common/secrets` だけを当て、`code/protected-paths`・重さ判定・パネルの入力・Jev の文脈判定から外す。パネルへの 1 行の渡し方は `generated` と同じで、「E2E のレポート: `<パス>`」とする。
- レポートだけの差分は変更なしとして PROCEED にする(§6.2.2 の手順 7)。レポートと生成物しかない差分には、`code/generated-only` ではなく `code/no-change` を出す。
- `policy.protectedPaths` には出さない。利用者が決める値ではなく、codiel の置き場の規則だからである。list_rules には、レポートとして外す `testsDir` の値を載せる。
- 呼び出し側の入力は要らない。M4-C の raguel-gating が `git diff` に付けていたレポートの除外(§3.1)は、Raguel が差分を自分で作るので要らなくなる(§6.13.1)。
- 抜け道にならない理由は次のとおりである。`testsDir` は `.codiel/config.json` にあり、run の間は codiel の guard が config.json への書き込みを拒む(§6.13.4)。レポートの置き場の外のファイルは、名前に `reports` を含んでも `testsDir` の配下でなければ外れない。

再提出の判定(`common/resubmission-loop`)は次のとおりにする。

- 比べる相手は、同じ run・同じフェーズの過去の attempt のうち、verdict が ASK か STOP で、judgeStatus が ok で、裁定の記録を持たないものである。
- 相手の attempt のルール層の ask 以上の ruleId の集合が空でなく、そのどれも今回のルール層で出ていなければ、修正ありとみなして比べない。Jev が有効なら、修正ありとみなした相手のうち類似度が閾値以上のものについて、文脈判定で前回の指摘への対処を問う(§6.4.4)。
- 残った相手と、今回の本文の類似度(§6.9.3 の固定長ダイジェストで推定する Jaccard)が閾値(既定 0.85、上限 0.95)以上なら ask の所見を出す。stop には上げない。
- パラメータ `stopAfter` は廃止する。設定にあれば読み込みエラーにする(§6.12.2)。

#### 6.4.3 所見の件数に上限を置く

- ルール層の所見は、ルールとファイルの組ごとに 1 件へ集約し、件数を message に書く。抜粋は最初の 3 か所だけを残す(所見 I3 の 346 件の例)。
- 応答の `findings` は 50 件までとし、severity の重い順に並べて切る。切ったときは `reasons` に切った件数を書く。
- `01-rules.json` は 500 件までとする。

#### 6.4.4 Jev による文脈判定は任意の補強である

正規表現と語彙の判定は文脈を見ないので、説明文やテストの固定データで誤検知し(所見 A4・A5・A12)、否定文や中身の無い欄を見逃す(所見 A7・A8・B1・F6)。そこで、ルール層と重さ判定の一部を TypeSafe AI の Jev で文脈判定する(R19)。

- Jev は `@typesafe-ai/sdk`(0.6.0)で呼ぶ。raguel-mcp の `package.json` の依存に足し、jevriel の src は import しない(`harness-docs/ARCHITECTURE.md:48`)。呼び出しの形は `plugins/jevriel/src/jev/client.ts:73-109` を参考にし、`R/context/`(新設)に独立に書く。
- 鍵は環境変数 `TYPESAFE_API_KEY` である。
- 既定は無効で、設定で有効にしたときだけ使う。無効のときの挙動は、§6.4.2 の決定論の規則(info 化、拡張子とコメント行による引き下げなど)そのものである。鍵の無い利用者は決定論で動く(ユーザー決定)。
- 正規表現の判定を土台に残し、Jev は文脈で絞るか上げるだけである。Jev は単独で STOP も PROCEED も出さない。

設定のキーは次のとおりにする。

| キー | 既定 | 意味 |
| --- | --- | --- |
| `contextJudge.enabled` | `false` | 文脈判定を使うか |
| `contextJudge.model` | なし(SDK の既定) | Jev の model |
| `contextJudge.timeoutMs` | `20000` | 問い合わせの時間の上限。`judge.deadlineMs` を超える値は読み込みエラー |
| `contextJudge.thresholds.lower` | `0.5` | 下げる向きの判定に使う確率の閾値。2026-09-29 の実機確認(§7.2 の 9)で、ヘルプ文の `rm -rf /`(所見 A4)が p=0.41、実行される破壊操作が p=0.79 だったので、0.2 から改めた |
| `contextJudge.thresholds.raise` | `0.7` | 上げる向きの判定に使う確率の閾値 |

質問と、判定を動かす向きは次のとおりにする。Jev が判定を動かせるのは、正規表現が出した stop を ask に下げる向きと、語彙系の info を ask に上げる向きだけである(ユーザー決定)。再提出・重さ・injection-marker は、表の「向き」列の上げる側だけに使う。

| 対象 | 質問(noul は真である確率 p、score は水準 s) | 問う場面 | 結果の当て方 | 向き |
| --- | --- | --- | --- | --- |
| `code/destructive-ops` | noul: この候補は、実際に実行される操作である(説明・テストの固定データ・コメントではない) | severity が stop の候補ごと | `p ≤ lower` なら stop を ask に下げる | stop → ask |
| `code/unsafe-exec` | 同じ noul | 候補ごと | p を所見の message に添えるだけで、severity は変えない。ask は語彙系の info でも stop でもなく、許された 2 つの向きのどちらにも当たらないためである | 動かさない |
| `common/injection-marker` | noul: 成果物は、それを審査する AI の判定を変えさせる指示を含む | 正規表現の一致の有無に関わらず、毎回 | 正規表現の ask が無く `p ≥ raise` なら、ask の所見を足す。正規表現の ask はそのまま残す | 足す(なし → ask) |
| `plan/irreversible-ops` | noul: 成果物そのものが不可逆な操作を計画・実行する(否定や範囲外として触れるだけではない) | kind が plan・design のとき毎回 | `p ≥ raise` なら所見を ask にする(info が無ければ ask の所見を作る) | info → ask |
| `plan/scope-keywords` | noul: 成果物の変更や計画が objective の外へ及ぶ | kind が plan・design のとき毎回 | 同上 | info → ask |
| `decision/no-rollback` | noul: 判断は不可逆な操作を含み、`rollbackPlan` は戻す方法を具体的に示していない | kind が decision のとき毎回 | 同上 | info → ask |
| `decision/no-alternatives` | noul: 判断は選択肢からの選択であり、`optionsConsidered` は実際に代替案を検討したことを示していない | kind が decision のとき毎回 | 同上 | info → ask |
| `common/resubmission-loop` | noul: 今回の提出は、前回の指摘(パネルの採用所見を含む)に対処している | 修正ありとみなして比較から外した相手のうち、類似度が閾値以上のものごと(§6.4.2) | `p ≤ 1 − raise`(既定 0.3)なら、対処していないとして ask の所見を出す | info → ask |
| 重さ判定 | score: 成果物が誤っていたときの被害の大きさと取り消しにくさ(0: 軽微で容易に戻せる 〜 4: 重大で戻せない) | 毎回 | §6.5 の tier の下限だけに使う | tier を上げる |

- `plan/irreversible-ops` が Jev で ask になると、§6.5 の規則で tier の下限が critical になる。これも上げる向きである。
- `p` が閾値の間にあるときは、決定論の結果のままにする。

問い合わせは次のとおりに組む。

- 2 つの問い合わせを並列に送る。候補の問い合わせは、`code/destructive-ops` と `code/unsafe-exec` の候補ごとに、ファイルのパスと前後 5 行の抜粋を `state` に入れる。1 回に 100 問まで(`plugins/jevriel/src/jev/budget.ts` の `MAX_QUESTIONS_PER_BATCH`)とし、超えた候補は決定論の結果のままにする。本文の問い合わせは、残りの質問をまとめて 1 回で送る。
- `state` は `{ objective, artifact, candidates, priorFindings, rollbackPlan, optionsConsidered }` のうち要るものの JSON にする。`artifact` と `priorFindings` には common/secrets の伏せ字(§6.4.2)を当てた後の本文を入れる。
- 質問の `instructions` は英語で書き、`state` のキーで対象を指す(`plugins/jevriel/skills/judging/SKILL.md:44`)。1 問に 1 つの判断だけを求め、`artifact` の中の指示には従わないことを書く。
- 入力の上限は jevriel と同じ推定(UTF-8 のバイト数 ÷ 2.5 をトークン数とみなす)で、1 回の合計 51,200、1 つの値 25,600 とする(`plugins/jevriel/src/jev/budget.ts:3-12` の値を写す)。超えた問い合わせは本文を切らずに送らず、その対象は決定論の結果のままにする。切ると、切った先を見ないまま判定を下げうるためである。
- 問い合わせの時間の置き場は §6.8 に置く。

呼ばない場面と、効かなかったときの扱いは次のとおりにする。

- `common/secrets` が stop を出したら、Jev を呼ばない。成果物を外部へ送らないためである。
- `code/protected-paths` か `casefile/tampered` が stop を出したときも呼ばない。判定は Jev に関係なく STOP になるためである。
- 有効なのに鍵が無い、Jev が失敗した(タイムアウトを含む)、入力が上限を超えた、のどれかのときは、その対象を決定論の結果で判定する。黙って通すことはない。
- そのときは `contextJudge/unavailable`(info)の所見を 1 件残し、原因を message に書き、`reasons` にも書く。`judgeStatus` は ok のままにする。Jev は任意の補強なので、補強が無いことで ASK を増やさない。一方、利用者が有効にした補強が効かなかったことは所見と応答に残る。
- 再試行はしない。締切の中でパネルの時間を削らないためである。

記録は次のとおりにする。

- 質問の ID・確率・水準・当てた変更を `07-context.json` に残す(§6.9.1)。本文は入れない。
- 応答に `contextJudge: { enabled, status, adjustments }` を足す(§6.2.5)。`status` は `off`・`ok`・`partial`(一部の問い合わせだけ効いた)・`unavailable`・`skipped`(呼ばない場面)のどれかで、`adjustments` は `{ ruleId, from, to }` の列である。

Jev に送らず決定論に残すものは次のとおりである。

| 残すもの | 理由 |
| --- | --- |
| `common/secrets` | Jev に送ると秘密情報が外部へ出る |
| `code/protected-paths` | glob で正確に判定できる |
| `plan/max-steps`・`code/max-diff-lines`・`common/max-size` | 計数は Jev が苦手である(`plugins/jevriel/skills/judging/SKILL.md:56-59`) |
| `code/new-dependency`・`code/test-deletion` | diff の構造の解析で足りる |
| `casefile/tampered` と合成規則(§6.6.3) | 判定の土台を決定論に保つ |

### 6.5 重さ判定

| kind | 基礎点 | 加点 | tier の下限 |
| --- | --- | --- | --- |
| code | 20 | 変更行数 `min(40, floor(行数 / 25) × 5)`、変更ファイル数 `min(20, 2 × 件数)`、保護パス近接 25、新しい依存 15 | なし |
| design・plan・decision | 30 | 本文の文字数 `min(30, floor(文字数 / 4000) × 5)`。plan はステップ数 `min(20, (件数 − 5) × 2)`(5 件以下は 0) | standard |

- tier の閾値は `weight.tiers` の既定(standard 30、critical 70)を据える。
- code が trivial(30 点未満)になるのは、変更が 25 行未満なら 4 ファイルまで、25〜49 行なら 2 ファイルまでで、ほかの加点が無いときである。旧配点で trivial だった 49 行・4 ファイル(所見 B2)は 33 点で standard になる。1 ファイル 5000 行は 62 点で standard のままである。
- 不可逆キーワードの加点(`R/core/weight.ts:99-102`)は廃止する(所見 B1)。
- Jev の文脈判定が有効なら(§6.4.4)、被害と取り消しにくさの水準 s(0〜4 を四捨五入)で tier の下限を上げる。s が 3 以上なら standard、4 なら critical にする。下げる向きには使わない。キーワードの加点の代わりに、文脈で重さを見るためである。
- ルール層に ask 以上の所見があれば、tier の下限を standard にする(現行どおり)。
- `code/protected-paths` か `plan/irreversible-ops` の所見が ask 以上のときだけ、tier の下限を critical にする。旧実装は severity を問わず critical にした(`R/core/weight.ts:138-147`)。
- 保護パス近接は、保護 glob の固定部(ワイルドカードを含む最初のセグメントより前)が 1 セグメント以上あり、変更パスのセグメント列がその固定部で始まるときに加点する。雛形の `src/server/auth/**` は `src/server/auth` で比べ、`src/utils/format.ts` は近接にならない(所見 B3)。固定部の求め方は codiel 設計 §6.6.2 の重なりの判定と同じである。

### 6.6 パネル

#### 6.6.1 構成

| tier | 手順 | meta |
| --- | --- | --- |
| trivial | パネルなし | なし |
| standard(code) | adversarial → steelman | なし。合成は決定論 |
| standard(文書) | 前フェーズの証拠があれば adversarial と crosscheck を並列、無ければ adversarial だけ → steelman | なし。合成は決定論 |
| critical | adversarial と crosscheck を並列 → steelman → meta | あり |

- 文書は kind が design・plan・decision の評価である(design・test-spec・dev-plan・intent-sync・intent のゲート)。前フェーズの証拠は §6.3 の前フェーズ(§6.1)の最新 attempt が 1 件以上あることをいう。intent(decision)は最初のゲート付きフェーズなので前フェーズを持たず、standard では crosscheck を起動しない(R15)。
- meta は critical だけで起動する。
- assumption と precedent のパネリストは撤去する(`R/panel/panelists/assumption.ts`・`precedent.ts`)。前提の監査は adversarial の職務に入れ、判例は adversarial と meta への参考入力にする(§6.11)。
- steelman は、adversarial と crosscheck の所見に 1 件ずつ反駁するか認める。adversarial が失敗したら steelman は起動しない(現行の不変条件 1)。crosscheck だけが成功したときは、crosscheck の所見に反駁させる。
- `panel.standard` と `panel.critical` は設定で変えられない構成にし、キーを廃止する。設定にあれば読み込みエラーにする。変えられると、空にして黙って PROCEED させる構成(所見 C5)が作れるためである。

#### 6.6.2 ルーブリックとプロンプト

軸のキーを「100 = 問題なし」と読める名前に改める(所見 C2)。

| kind | 軸 |
| --- | --- |
| decision | `objective_alignment`・`risk_awareness`・`reversibility`・`alternatives_considered` |
| plan | `objective_alignment`・`scope_fit`・`procedure_completeness`・`risk_controlled` |
| design | `requirement_coverage`・`appropriate_complexity`・`consistency` |
| code | `objective_alignment`・`no_unintended_changes`・`no_breaking_changes` |
| meta の追加軸 | `blast_radius_contained` |

- すべてのパネリストと meta のプロンプトに、「スコアは 0〜100 の整数で、100 は問題が無いこと、0 は重大な問題があることを表す」と書く。向きを書かないと、同じ run の中で meta のスコアの向きが逆転した(O4-1b で 80/85/80 → 20/15/25。§3.5 の K2)。
- adversarial の職務から「セキュリティ観点の攻撃を必ず 1 件以上含める」(`R/panel/panelists/adversarial.ts:39-41`)を外す。代わりに、セキュリティ(権限・機密情報・インジェクション・破壊的操作・サプライチェーン)と、成果物が暗黙に置く前提を必ず点検し、具体的な失敗の筋書きがあるものだけを所見にし、無ければ所見は 0 件でよいと書く。
- crosscheck への事実表は、Raguel が組んだ diff から `a/`・`b/` を除いたパスと新規ファイルの印を使う。新規ファイルは「新規」と書き、「不在」と書かない(所見 A13)。
- 判例の検索結果は adversarial と meta のプロンプトに「参考: 類似の過去の裁定」として、日付と outcome と ruling を添えて渡す。

#### 6.6.3 合成規則

次の順に当て、最初に決まったものを採る。すべて決定論である。

1. ルール層に stop があれば STOP。パネルは起動しない。
2. パネルの所見を分類する。adversarial と crosscheck の所見(standard と critical のどちらでも、起動したものすべて)を steelman の反駁の対象にする。そのうち、severity が ask で confidence が `judge.thresholds.confidence`(既定 70。旧 60)以上で、steelman に反駁されていないものを採用する。反駁されたものと閾値未満のものは info にする。steelman 自身の所見は info として残し、判定を動かさない。
3. 障害があれば(§6.8)`judgeStatus` を degraded にし、ASK。
4. ルール層に ask があれば ASK。
5. 採用された所見があれば ASK。
6. trivial なら PROCEED。
7. standard なら PROCEED。adversarial・crosscheck・steelman のスコアは記録するが、判定に使わない。攻める立場と守る立場のスコアは食い違うのが当然だからである。文書の standard で adversarial と crosscheck が並んでも、乖離度は測らない。standard は meta を持たず、乖離で ASK にしても何を判断すべきかを示す根拠が無いためである。乖離度は `00-synthesis.json` に記録だけ残す。
8. critical なら、同じ立場のパネリスト(adversarial と crosscheck)の共通の軸のスコアの差が `judge.thresholds.maxVariance`(既定 30)を超えたら ASK。
9. critical で meta のいずれかの軸が `judge.thresholds.proceed`(既定 80)未満なら ASK。
10. PROCEED。

confidence の閾値を 60 から 70 へ上げるのは、standard で adversarial の所見がそのまま ASK になる率(所見 C2)を下げるためである。値は実機確認(§7.2)の結果で見直す。

### 6.7 プロバイダー

#### 6.7.1 共通のインターフェースはプロンプトの単位のまま残す

パネルのプロバイダーは claude と codex の 2 つである(R14)。どちらもプロンプトを受けて JSON を返すので、現行の `JudgeProvider`(`R/panel/provider.ts:22-25`)のプロンプトとスキーマを渡す形を残し、実装を 2 つ並べる。

```ts
interface JudgeProvider {
  readonly name: "claude" | "codex"
  invoke<T>(call: JudgeCall<T>, ctl: CallControl): Promise<T>
}
// JudgeCall: 現行どおり(role、model、prompt、schema、jsonSchema)
// CallControl: timeoutMs、signal(AbortSignal)
```

- プロンプトの組み立て(`R/panel/panelists/*.ts`・`prompts.ts`)は 2 つのプロバイダーで共有し、子プロセスの起動だけを変える。
- 失敗は `JudgeError` で返す。理由に `unavailable`(バイナリが無い、`provider: none`)を足す。

設定のキーは次のとおりにする。

| キー | 値 | 既定 |
| --- | --- | --- |
| `judge.provider` | `claude` / `codex` / `none` | `claude` |
| `judge.model` | 文字列 | なし(プロバイダーの既定) |
| `panel.perPanelist.<名前>.provider` | `claude` / `codex` | `judge.provider` |
| `panel.perPanelist.<名前>.model` | 文字列 | 下の規則 |

- `<名前>` は adversarial・steelman・crosscheck・meta である。
- model の解決は、`perPanelist.<名前>.model`、そのパネリストの provider が `judge.provider` と同じなら `judge.model`、プロバイダーごとの既定、の順に行う。別のプロバイダー向けの model 名が流れ込まないようにするためである。
- プロバイダーごとの既定は、claude が adversarial に `sonnet`・ほかに `haiku`(現行 `R/config/defaults.ts:33-40` と同じ)、codex は model を指定しない(CLI の既定に任せる)。旧設定の `perPanelist.adversarial.model: sonnet` の既定は、この表へ移す。
- `none` は `judge.provider` だけに置ける。LLM を一切起動せず、パネルが要る評価はすべて degraded の ASK になる。design・plan・decision は standard 以上なので、`none` ではこれらが常に ASK になる。黙って PROCEED する構成を作らないためである(所見 C5)。

#### 6.7.2 claude

`claude -p` の起動を次の形にする。

```
claude -p --output-format json --model <model> --tools "" --disable-slash-commands
       --strict-mcp-config --mcp-config '{"mcpServers":{}}'
       --setting-sources project --no-session-persistence
       --json-schema <$schema を除いた JSON Schema>
```

- cwd は呼び出しごとに `fs.mkdtemp` で作る空のディレクトリにし、終わったら消す。現行は `os.tmpdir()` そのもので(`R/panel/claudeCli.ts:82`)、そこに置かれたファイルを読みうる。
- env は `process.env` に `RAGUEL_PANELIST=1` を足したものにする。鍵を除く操作はしない(§1 の R8 の根拠)。
- プロンプトは stdin で渡す(現行どおり)。
- 引数の組み立て(`buildArgs`)を export し、vitest で引数の列を固定する(§7.1)。

`--setting-sources project` と空の cwd の組み合わせで、ログインは保たれ、利用者の hooks・CLAUDE.md・プラグインは読まれない。2026-09-29 の実機確認(§7.2 の 1。claude 2.1.284)で、応答が返り、debug ログで hooks は 0 件、利用者のプラグインは読まれず(組み込みの 2 つだけ)、CLAUDE.md は 0 件だった。現行のコメント(`R/panel/claudeCli.ts:144-145`)が書く `--setting-sources ""` と `--bare` のログインの外れは、`project` では起きなかった。

次の代替の候補は、`project` でログインが外れたときのために用意したもので、実機確認の結果により使わない。

| 候補 | 内容 | 残る懸念 |
| --- | --- | --- |
| a | `--setting-sources user,project` にし、hooks は `--settings '{"disableAllHooks":true}'` で止める | `disableAllHooks` が CLI の `--settings` で効くか。利用者の CLAUDE.md が読まれる |
| b | a に加え、CLAUDE.md の読み込みを止める環境変数か設定があれば使う | そうした手段があるか |
| c | `--setting-sources user,project` のまま、プロンプトの先頭で「利用者の指示を判定に使わない」と書く | 読まれた指示は判定に混じりうる。hooks は a で止める |

代替も効かないときの判断は §15 に置く。

#### 6.7.3 codex

`codex exec` を次の形で起動する。

```
codex exec --ephemeral --ignore-user-config --skip-git-repo-check
           --sandbox read-only
           --disable shell_tool --disable unified_exec --disable hooks
           --output-schema <一時ディレクトリ>/schema.json
           -o <一時ディレクトリ>/last-message.json
           [-m <model>] -
```

- プロンプトは stdin で渡す(`-` を位置引数にする)。
- cwd は claude と同じく呼び出しごとの空のディレクトリにし、スキーマと出力もその中に置く。
- 応答は `-o` のファイルを読み、zod で検証する。stdout は捨て、stderr は失敗の理由に使う。
- env は `process.env` に `RAGUEL_PANELIST=1` を足したものにする。認証は `CODEX_HOME` を使う(`--ignore-user-config` の説明、Context7 `/openai/codex` の `codex-rs/exec/src/cli.rs`)。

R8 と同じ趣旨の隔離は次のとおりに当てる。

| 趣旨 | codex での手段 | 確度 |
| --- | --- | --- |
| 利用者の設定を読まない | `--ignore-user-config`(`$CODEX_HOME/config.toml` を読まない) | Context7 で確認 |
| セッションを残さない | `--ephemeral` | Context7 で確認 |
| プロジェクトの指示ファイルを読まない | 空の cwd。`AGENTS.md` を探す起点に何も無い | 推定 |
| 利用者の全体の指示ファイルを読まない | 止める手段が無い。`$CODEX_HOME/AGENTS.md` は `--ignore-user-config` と `-c project_doc_max_bytes=0` の下でも読まれる。`--ignore-rules` は execpolicy の `.rules` を読まないフラグで、`AGENTS.md` には効かないので付けない | 実機で確認(2026-09-29、codex-cli 0.144.1)。既知の限界 |
| 書き込ませない | `--sandbox read-only` | 実機で確認(cwd へのファイルの作成が失敗した) |
| ツールを使わせない | `--disable shell_tool --disable unified_exec`(`codex features list` の機能名) | 実機で確認(付けないと cwd の外のファイルを読めた。付けるとシェルを使えず、読めなかった) |
| 利用者の hooks を動かさない | `--disable hooks` | 機能名から推定 |

- シェルのツールを無効にしたので、成果物に仕込まれた指示で codex が利用者のファイルを読み、所見に書き写す経路は塞がる。
- `$CODEX_HOME/AGENTS.md` は読まれるので、利用者がそこに書いた指示はパネリストの判定に混じりうる。この限界をリスク(§11)とし、README に書く。
- `--output-schema` のスキーマは、全プロパティを `required` に並べ `additionalProperties: false` を付けた厳格な形にする。`additionalProperties: false` の無いスキーマは 400(`'additionalProperties' is required to be supplied and to be false`)で失敗する(実機で確認)。任意の欄(`evidence` など)は `null` を許す型にして必須に並べ、読んだ後で `null` を取り除く。

### 6.8 基盤の障害を内容の懸念と分ける

- 次のどれかが起きたら、その評価の `judgeStatus` を degraded にし、`degradedReasons` に書く。パネリストか meta の失敗(再試行の後)、締切の超過、プロバイダーの `unavailable`、内部エラー(§6.2.6)、設定の読み込みの失敗(§6.3)。
- degraded の評価の verdict は ASK である。ルール層に stop があれば STOP のまま(パネルは起動しない)で、`judgeStatus` は ok である。
- 失敗の所見は `panel/<名前>-error` のまま残すが、判例の firedRules と再提出の比較には入れない(§6.4.2、§6.11)。

再試行は次のとおりにする。

| 失敗 | 再試行 |
| --- | --- |
| タイムアウト・nonzero-exit・spawn の失敗(claude・codex) | 1 回。締切までの残りが 30 秒未満なら行わない |
| スキーマの不一致 | 1 回(現行どおり。`R/panel/claudeCli.ts:50-74`) |
| Jev の文脈判定の失敗(§6.4.4) | 行わない。決定論の結果で進む |

締切は次のとおりにする。

- ゲート全体の締切 `judge.deadlineMs` の既定は 600000(R21)、上限は 1800000 とし、上限を超える設定は読み込みエラーにする。上限は、止まった子プロセスが評価を際限なく抱え続けないためのものである。
- 1 回の呼び出しの時間は `min(judge.timeoutMs, 締切までの残り − 3000)` とする。`judge.timeoutMs` の既定は 180000(R21。旧 60000)とし、`judge.deadlineMs` を超える値は読み込みエラーにする。O4-1a・O4-1b で adversarial が 60000 ms で 3 回タイムアウトした(§3.5 の K2)。
- Claude Code は MCP の呼び出しが 120 秒を超えるとバックグラウンドへ移す(`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`、引継ぎ「踏みやすい点」)。本設計はこれを正規の経路とし、codiel は完了の通知を待つ(§6.13.1)。Claude Code の MCP の呼び出し自体の時間の上限が 600 秒の締切より短くないかは【要確認】とする(§7.2 の 10)。
- Jev の文脈判定(§6.4.4)は、ルール層の後・重さ判定の前に、最大 2 回の問い合わせを並列に行う 1 つのステップとして置く。時間は `min(contextJudge.timeoutMs, 締切までの残り − 3000)` で、`contextJudge.timeoutMs` の既定は 20000 とする。パネルの波に使える時間はその分減る。
- standard は 2 つの波(adversarial と、文書で前フェーズの証拠があれば crosscheck、次に steelman)が直列に並ぶ。crosscheck は adversarial と並列なので、波の数は増えない。
- critical は 3 つの波(adversarial と crosscheck、steelman、meta)が直列に並ぶので、各波が平均 199 秒を超えると締切に届く。締切を超えた波は障害になる。実際の所要は実機で測る(§7.2)。

キャンセルと進捗は次のとおりにする。

- ツールのハンドラの第 2 引数 `extra.signal` が abort したら、動いている子プロセスをすべて SIGKILL し、Jev の呼び出しを止め、その attempt のディレクトリを消して索引に書かない。MCP TypeScript SDK 1.29.0 では、ハンドラの `extra` が `signal` と `sendNotification` を持つ(Context7 `/modelcontextprotocol/typescript-sdk/v1.29.0` の `docs/protocol.md`)。
- `extra._meta?.progressToken` があるときだけ、`notifications/progress` をステップごとに送る。ステップは、評価対象の取得、ルール層、Jev の文脈判定(有効なときだけ)、パネルの各波の開始と終了、合成である。Claude Code が progressToken を付けるかは【要確認】とする。
- 締切で打ち切った呼び出しも SIGKILL し、`degradedReasons` に `deadline` と書く。

### 6.9 ケースファイル・評価の索引・裁定の記録

このセクションの形式は、codiel の pass-gate が読む契約である(R11)。変えるときは §6.14 の手当てに従う。

#### 6.9.1 置き場

```
<casesDir>/
  cases/<projectId>/
    evaluations.jsonl                     評価の索引
    outcomes.jsonl                        裁定の記録
    <runId>/<phase>/attempt-NN/
      subject.json                        評価対象の出所
      submission.txt                      検査した本文(秘密情報は伏せ字)
      00-synthesis.json
      01-rules.json
      02-weight.json
      03-adversarial.md
      04-steelman.md
      05-crosscheck.md
      06-precedents.json                  判例の検索結果
      07-context.json                     Jev の文脈判定の結果(有効なときだけ)
      08-meta.md
      submission-digest.json
      verdict.json
  precedents/<projectId>/
    index.json
    <id>.json
```

- 置き場の解決は、設定(`RAGUEL_CONFIG` が指す JSON、無ければプロジェクトルートの `.codiel/config.json` の `raguel`)の `storage.casesDir`、無ければ `~/.raguel` の順である。`~` はホームディレクトリに展開する。

プロジェクトルートと projectId は別の概念である。プロジェクトルートは `.codiel/config.json` を探すディレクトリで、projectId はケースファイルと判例を束ねるキーである。

- プロジェクトルートは、codiel の `findMainRoot`(`C/src/hooks/lib.ts:551-580`(`7130f69c`))と同じアルゴリズムで決め、raguel-mcp に独立に実装する。起点はサーバーの cwd である。第 6 版までは、`c37ab969` の `findMainRoot` に合わせて手順 1 を `git worktree list --porcelain` で書いていた。M4 がこれを git を呼ばない形に改めたので、第 7 版で追随した。
  1. 起点のパスが `/.codiel/worktrees/` を含む(`CODIEL_WORKTREES_RE`、`:562`(`7130f69c`))なら、最初に現れるその位置より前を返す。git は呼ばず、実体化もしない(論理パスのまま返す)。
  2. 起点から親へたどり、`.codiel` を持つ最初のディレクトリを返す(`findProjectRoot`、`:551-559`(`7130f69c`))。
  3. 見つからなければ起点を返す。
- 利用者が自分で作った worktree(パスが `/.codiel/worktrees/` を含まないもの)は、メインの作業ツリーへ付け替えない。その worktree が `.codiel` を持てばそこがプロジェクトルートになり、持たなければ起点(cwd)になる。
- M4 からの変更: M4 の Raguel は `<cwd>/.codiel/config.json` を読む(§3.1)。本設計は `<プロジェクトルート>/.codiel/config.json` を読む。プロジェクトルートの手順 2 は `.codiel` を持つ祖先をたどるので、cwd がサブディレクトリのときも codiel の worktree の中のときも、M4 の形より正しく config.json を見つけ、codiel-state と同じ設定を読む。cwd がプロジェクトルートそのものなら、M4 と同じファイルを読む。
- `projectId` は `storage.projectId` があればそれを使う。無ければ git の共通ディレクトリ(`git rev-parse --path-format=absolute --git-common-dir` の実体パス)から `<名前>-<sha256(共通ディレクトリの実体パス) の先頭 12 文字>` を作る。`<名前>` は、共通ディレクトリの basename が `.git` ならその親ディレクトリの basename、そうでなければ(bare リポジトリなど)共通ディレクトリの basename から末尾の `.git` を除いたものである。git の管理外では、プロジェクトルートの実体パスで同じ形を作る。
- projectId はプロジェクトルートを使わずに共通ディレクトリだけから決まるので、どの worktree から評価しても同じ値になる(所見 G5)。codiel-state も同じ規則で求める。
- 旧 projectId(`R/casefile/store.ts:106-123`)の履歴と判例は引き継がない(§11)。
- attempt はフェーズ単位で番号を振る(所見 F4)。
- 証拠ファイルの名前はこの一覧に固定する。旧 `06-assumption.md`・`07-precedent.md` は作らない。

#### 6.9.2 subject.json と verdict.json

```jsonc
// subject.json(例。値は実際の評価のものになる)
{
  "repoPath": "/abs/path/to/repo",
  "head": "<40 桁のコミット>",
  "base": "<40 桁のコミット>",        // evaluate_code だけ
  "paths": ["src/a.ts"],               // 指定があったときだけ
  "files": [{ "path": "src/a.ts", "sha256": "<64 桁>", "isNew": false }]
}
```

- evaluate_code の `files` は diff に現れたファイルで、`sha256` は HEAD の blob の内容の sha256(削除は `null`)とする。
- evaluate_plan・evaluate_design の `files` は読んだファイルで、`sha256` は読んだバイト列の sha256 とする。
- evaluate_decision は `files` を空にし、`contentSha256` に本文の sha256 を持つ。

verdict.json は次のフィールドを持つ。

| フィールド | 内容 |
| --- | --- |
| `schemaVersion` | `2` |
| `evaluationId`・`runId`・`phase`・`kind`・`attempt` | 識別 |
| `verdict`・`judgeStatus`・`degradedReasons`・`weightTier` | 判定 |
| `findings`・`reasons`・`meta` | 判定の中身 |
| `subject` | subject.json と同じ内容 |
| `policy` | `{ configHash, configSource, version: 2, buildVersion }` |
| `at` | ISO 8601 |
| `prevChainHead` | 同じ run・同じフェーズの 1 つ前の attempt の `chainHead`。無ければ `null` |
| `evidence` | 既知の証拠ファイルの `{ name, sha256 }` の列 |
| `chainHead` | §6.10 |

#### 6.9.3 submission-digest.json

- 本文を正規化した sha256 と、5-gram の MinHash 署名(128 個の 32 bit の整数)を持つ。旧実装は 5-gram のハッシュ集合を全件持ち、20 万字で約 435 KB になった(所見 I3)。
- 正規化は、Unicode の NFC、空白の連続を 1 つの半角空白へ圧縮、前後の空白の除去、小文字化の順に行う。
- 5-gram は Unicode のコードポイント単位で取る(UTF-16 のコード単位ではない)。正規化後が 5 コードポイント未満なら、全体を 1 つの 5-gram とみなす。
- 各 5-gram を UTF-8 のバイト列にして FNV-1a 32 bit で整数 `x` にし、i = 0〜127 について `h_i(x) = (a_i × x + b_i) mod p mod 2^32` を計算する。`p = 4294967311`(2^32 より大きい素数)、`a_i`(1 以上)と `b_i` は固定の種から決定論で作った定数とし、コードに持つ。署名の i 番目は、全 5-gram の `h_i` の最小値である。本文が空なら、128 個すべてを `2^32 − 1` にする。
- 類似度は、128 個の位置のうち 2 つの署名の値が一致した位置の数 ÷ 128 とする。
- 正規化・ハッシュ・定数のどれかを変えたら、ダイジェストの `schemaVersion` を上げ、古い版のダイジェストとは比べない。

#### 6.9.4 評価の索引と裁定の記録

`evaluations.jsonl` は評価ごとに 1 行を追記する。

```jsonc
{ "schemaVersion": 2, "evaluationId": "...", "runId": "...", "phase": "implement",
  "kind": "code", "attempt": 1, "casePath": "/abs/.../attempt-01",
  "verdict": "ASK", "judgeStatus": "ok", "head": "<40 桁>", "at": "..." }
```

- `head` は、プロジェクトルートが git の管理外のときと、最初のコミットが無いリポジトリで文書と判断を評価したときに `null` になる。subject.json と verdict.json の `subject.head` も同じである。evaluate_code は HEAD を解決できなければ入力の誤りにする。

`outcomes.jsonl` は record_outcome が記録したものごとに 1 行を追記する。

```jsonc
{ "schemaVersion": 2, "evaluationId": "...", "runId": "...", "phase": "implement",
  "outcome": "approved", "ruling": "as-is", "notes": "...",
  "precedentId": "prec-...", "at": "..." }
```

- `ruling` と `precedentId` は無ければ `null` とする。
- 同じ evaluationId に複数の行があれば、後の行を正とする。
- 行の追記は `appendFileSync` の 1 回の書き込みで行う。

#### 6.9.5 書き込みと掃除

- verdict.json・`index.json`・掃除で書き直す索引は、同じディレクトリの一時ファイルに書いて rename する(所見 G4)。
- `index.json` と索引の行が読めないときは、上書きせずに例外にする。旧実装は読めない `index.json` を空とみなし、次の記録で既存の判例を消した(`R/precedent/store.ts:62-66`)。
- 読めない証拠・ダイジェストは、パスを添えて warn を出す。
- 保持の上限(`storage.retention.maxRuns` 200、`maxDays` 90)は、run ごとの最後の評価の `at` で判定する(旧実装はディレクトリの mtime。`R/casefile/store.ts:358-379`)。消す run の行は `evaluations.jsonl` と `outcomes.jsonl` からも消す。
- record_outcome と前フェーズ証拠の読み込みで、索引に evaluationId が無いときは「評価の記録が無い(掃除済みか、存在しない)」と返し、改竄とは別の文言にする(所見 G3)。

### 6.10 改竄からの保護

ハッシュチェーンを次の形にする(旧 `R/casefile/hashchain.ts:26-35` は証拠のファイル名と sha256 だけを畳み込んだ)。

```
seed = sha256("raguel-v2|" + evaluationId + "|" + runId + "|" + phase + "|" + attempt
              + "|" + verdict + "|" + judgeStatus + "|" + (prevChainHead ?? "none"))
head = 既知の証拠ファイルを名前順に H(prev + name + ":" + sha256) で畳み込む(初期値 seed)
```

- verdict.json の `verdict` や `judgeStatus` だけを書き換えると `chainHead` が合わなくなる(所見 G8)。
- 既知の証拠ファイルは、§6.9.1 の attempt のディレクトリの一覧から verdict.json を除いたもの(`subject.json` から `submission-digest.json` まで)である。head の畳み込みと verdict.json の `evidence` の列も、この範囲で行う。
- 照合はこの既知の証拠ファイル名に限る。ほかのファイル(エディタの一時ファイルなど)は無視する(所見 G6)。
- `prevChainHead` を前の attempt の verdict.json の `chainHead` と照らし、前の attempt の差し替えや削除を検出する。
- チェーンは秘密の鍵を持たないので、計算手順を知る者はすべてを書き直せる。書き直しを防ぐのは codiel の guard(§6.13.4)であり、チェーンが検出するのは部分的な書き換えである。

### 6.11 判例

- 判例を作るのは record_outcome だけで、§6.2.7 の表の「判例」列に従う。degraded の評価からは作らない(R7)。
- `firedRules` から `panel/*-error`・`kernel/*`・`rule-error` を除く(所見 G2)。
- 判例は `phase` と `ruling` を持つ。
- 検索(`R/precedent/retrieval.ts`)は、退役した判例を除いて現行の重み(`:13-17`)で行う。
- 上位 `precedent.topN`(既定 5)を adversarial と meta の参考入力にし、`06-precedents.json` に残す。
- 上位のうち outcome が rejected か incident で、合成スコアが 0.5 以上のものがあれば、`precedent/failure-match`(info)の所見を 1 件出し、判例の id を message に書く。判定は動かさない。
- 旧 precedent パネリスト(`R/panel/panelists/precedent.ts`)の「当てはめ」は、adversarial と meta が参考入力を読むことで代える。

### 6.12 設定

#### 6.12.1 形

設定は JSON で書く。置き場と読む順は次のとおりで、最初に見つかったものだけを使う(M4 の形を前提にする。§3.1)。

1. 環境変数 `RAGUEL_CONFIG` が指すファイル。中身は `raguel` の値と同じ形の JSON オブジェクトである。
2. プロジェクトルート(§6.9.1)の `.codiel/config.json` の `raguel` キーの値。
3. 内蔵の既定値。

- Raguel は YAML を読まない。旧 `raguel.config.yaml` が残っていても読まず、YAML に縮退しない。移すのは `/codiel:init` の役目である(§3.1)。
- `config.json` が無いとき、または `raguel` キーが無いときは内蔵の既定値を使う。
- `config.json` か `RAGUEL_CONFIG` のファイルが JSON として読めないとき、`raguel` の値がオブジェクトでないときは読み込みの失敗にする(§6.12.4)。
- Raguel が見るのは、`raguel` キーの中と `testsDir` である(R24)。`runsDir` は codiel のキーなので、Raguel は検証も解釈もしない。§6.12.2 の「未知のキーを拒む」は `raguel` の値の中に当てる。
- `testsDir` は、`RAGUEL_CONFIG` を設定したときも、プロジェクトルートの `.codiel/config.json` から読む。`RAGUEL_CONFIG` のファイルは `raguel` の値の形で `testsDir` を持たず、`testsDir` は codiel の置き場の規則だからである。
- `testsDir` の読み方は、codiel の `readCodielConfig`(`C/src/codiel-state.ts:318`(`7130f69c`))と同じ規則と既定値を独立に実装する。`config.json` かキーが無ければ `docs/codiel/tests` を使う。値が文字列でない・空・絶対パス・`..` のセグメントを含むときは不正とし、`./` と末尾の `/` を落としてから使う。
- `testsDir` が不正なときは、`raguel` の値が不正なときと同じく読み込みの失敗にする(§6.12.4)。codiel も同じ値で `readCodielConfig` が例外を投げ、`codiel-state config` が失敗し、guard-write が ask にする。Raguel だけが既定値で動くと、codiel と違う場所をレポートとみなすためである。

`raguel` の値は `version: 1` を据え、スキーマを厳格にする。受け付けるのは次のキーだけである。値は既定の例であり、`<...>` は利用者が書く値の説明である。利用者は変えたいキーだけを書く。

```json
{
  "raguel": {
    "version": 1,
    "onError": "ASK",
    "storage": {
      "casesDir": "~/.raguel",
      "projectId": "<任意>",
      "retention": { "maxRuns": 200, "maxDays": 90 }
    },
    "judge": {
      "provider": "claude",
      "model": "<任意>",
      "timeoutMs": 180000,
      "deadlineMs": 600000,
      "maxConcurrency": 4,
      "thresholds": { "proceed": 80, "confidence": 70, "maxVariance": 30 }
    },
    "weight": { "tiers": { "standard": 30, "critical": 70 } },
    "panel": {
      "perPanelist": { "adversarial": { "provider": "<任意>", "model": "<任意>" } }
    },
    "contextJudge": {
      "enabled": false,
      "model": "<任意>",
      "timeoutMs": 20000,
      "thresholds": { "lower": 0.5, "raise": 0.7 }
    },
    "precedent": { "seedCatalog": true, "topN": 5 },
    "subject": { "ignoreUncommitted": [] },
    "rules": {
      "<ruleId>": { "enabled": true, "severity": "<info | ask | stop>", "<パラメータ>": "<値>" }
    }
  }
}
```

`judge.provider` の値は `claude`・`codex`・`none` のどれかである。

#### 6.12.2 検証とマージ

- zod のオブジェクトはすべて厳格(未知のキーを拒む)にする。旧実装は `z.looseObject` と `z.record(z.string(), ...)` で未知のキーを通した(`R/config/schema.ts:25-28`、`:75-85`)。
- `version` は `1` だけを受ける。
- `rules` のキーは登録済みのルール ID だけを受ける。パラメータはルールごとのスキーマで検証する。各ルールは `params` のスキーマ(名前・型・既定値)を持ち、list_rules もそれを使う。
- 旧設定にあったキーのうち、廃止するもの(`judge.canStop`、`panel.trivial`・`panel.standard`・`panel.critical`、`common/resubmission-loop.stopAfter`)は、廃止を名指しする理由の文言で読み込みエラーにする。
- 廃止したルール ID `code/dangerous-patterns` は、後継の `code/destructive-ops` と `code/unsafe-exec` を名指しする文言で読み込みエラーにする。
- マージは、オブジェクトは再帰、配列は置換とする。例外は sealed ルールのリストのパラメータ(`code/protected-paths.globs`、`common/secrets.allowPatterns` など、ルールの `params` のスキーマで「和集合」と宣言したもの)で、既定値との和集合にする(応急処置 (3) を一般化。所見 E2)。
- `code/protected-paths` の保護の glob は、和集合を取った後で `excludeDefaults` に挙げた既定の glob を取り除いたものである(R20)。`excludeDefaults` は既定の glob の文字列だけを受け、利用者の `globs` を取り除く手段にはならない。`generated` は和集合を取らない(既定は空)。
- この規則は README と `/codiel:init` のスキルの本文に書く(§9)。雛形は JSON で注釈を書けないためである。

#### 6.12.3 sealed ルールと不変条件

設定の読み込みで次を検査し、違反は読み込みエラーにする。

| 検査 | 根拠 |
| --- | --- |
| sealed ルールの `enabled: false` | 現行(`R/core/invariants.ts:46-55`) |
| sealed ルールの severity を既定より軽くする(`code/destructive-ops` は stop、`code/unsafe-exec` は ask を下回れない) | A3 |
| stop にできないルールの `severity: stop` | R4 |
| `allowPatterns` の不正な正規表現 | A3 |
| 空文字列に一致する `allowPatterns`、または内蔵の見本の秘密情報(`sk-ant-api03-` の形、`AKIA` の形、`ghp_` の形、PEM の見出し)のどれかに一致する `allowPatterns` | A3 |
| `resubmission-loop.similarityThreshold` が 0.95 を超える | 現行の緩和の限度 |
| `judge.deadlineMs` が 1800000 を超える。`judge.timeoutMs` が `judge.deadlineMs` を超える | R6、R21 |
| `code/protected-paths.excludeDefaults` に既定の glob と完全に一致しない文字列 | R20 |
| `code/protected-paths.generated` に、固定部(ワイルドカードを含む最初のセグメントより前)が空の glob(`**/*`・`*.js` など) | R20。リポジトリ全体を生成物にする宣言を防ぐ |
| `subject.ignoreUncommitted` に、固定部が空の glob | §6.2.2 の手順 3。作業ツリー全体を未コミットの検査から外す宣言を防ぐ |
| `code/protected-paths.generated` と `subject.ignoreUncommitted` に、否定の glob(`!docs/**` のように `!` で始まるもの) | 否定の glob は固定部が空でないので上の 2 行の検査を通るが、指定したパスの外のすべてに一致する。手動確認 O4C-6 の後の修正のレビューで見つかった(2026-09-30) |
| `perPanelist` のキーが adversarial・steelman・crosscheck・meta 以外 | R5 |
| `perPanelist.<名前>.provider: none` | §6.7.1 |
| `judge.provider` と `perPanelist.<名前>.provider` に `claude`・`codex`・`none` 以外(旧版の `jev` を含む) | R14 |
| `contextJudge.timeoutMs` が `judge.deadlineMs` を超える | R19 |
| `contextJudge.thresholds` の `lower` が `raise` 以上、または 0〜1 の外 | R19 |

`excludeDefaults` と `generated` は sealed ルールの緩和であり、検査の表の「既定より軽くしない」の例外として許す(R20)。理由は次の 3 つである。

- 既定の保護のままだと、IaC を直す run と CI を直す run は implement のゲートが毎回 STOP になり、正当な作業が進まない(§3.5 の K1)。応急処置 (3) の和集合の後は、利用者に外す手段が無かった。
- 外せるのは名指しした既定の glob だけで、任意のパターンを受けない。外したものと生成物の宣言は `policy` と list_rules に出るので、黙って外れることは無い。
- `.codiel/config.json` と `RAGUEL_CONFIG` のファイルへの書き込みは、run が active か awaiting_human の間 codiel の guard が拒む(§6.13.4)。run の途中で AI が保護を外すことはできない。

#### 6.12.4 読み込みの失敗

- 起動時に設定(`.codiel/config.json` の `raguel` か、`RAGUEL_CONFIG` のファイル)が壊れていても、サーバーは起動する。評価は ASK・degraded を返し、所見に設定のパスと理由を載せる。list_rules は理由を返す。旧実装は起動を失敗させ(`R/server.ts:33`)、Claude Code を再起動するまで直せなかった。
- 評価ごとの読み直し(応急処置 (3))で直ったら、次の評価からその設定を使う。

### 6.13 codiel 側の変更

#### 6.13.1 raguel-gating

| 変更 | 受け入れ基準 |
| --- | --- |
| フェーズ→ツール対応表の「渡すもの」を新しい入力にする。intent は判断文、design は `paths: [design.md]`、test-spec は `paths`(spec.md と cases.md)、dev-plan は `paths: [dev-plan.md]`、test-code・implement・test-loop・fix-loop は `baseRef`(そのフェーズを始めたときの HEAD)、intent-sync は `paths`(書き換えたファイル)。全行に `phase` を書く | 表の 9 行がそれぞれ §6.1 の phase と §6.2 の入力を持つ。`diff`・`files`・`plan`・`design` の語が表に無い |
| fix-loop のゲートは、fix-loop を始めたときの HEAD から現在の HEAD までを 1 回で評価する。修正ごとの範囲を渡す旧規則をやめる | fix-loop の行の `baseRef` がフェーズの開始の HEAD である |
| code 系フェーズの `baseRef` には、変更が無くてもフェーズの開始の HEAD を渡す。空の差分は PROCEED と「変更なし」の info で返る(§6.2.2、R22)。run 全体の差分や、ほかのフェーズの起点を渡して空を避ける運用をしない | 手順に、空の差分でも起点を変えない旨と、run 全体の差分を渡さない旨の 2 文がある |
| M4-C の応急処置(codiel 決定 97)で対応表の implement・test-loop・fix-loop の行に足した「そのフェーズの差分が空なら `git diff <base>...HEAD` を渡す」(`SKILL.md:58`(`7130f69c`))を消す。空の差分は Raguel が PROCEED で返す(R22) | `grep -n '<base>...HEAD' plugins/codiel/skills/raguel-gating/SKILL.md` が 0 件 |
| M4-C で足した、`git diff` にレポートの除外の pathspec を付ける規則と、除外した後の diff で空を決める規則(`SKILL.md:66`(`7130f69c`)、codiel 決定 104)を消す。Raguel が差分を自分で作り、レポートを外す(R24、§6.4.2) | `grep -n 'exclude,glob' plugins/codiel/skills/raguel-gating/SKILL.md` が 0 件 |
| STOP の手順(応急処置 (6))の「誤検知として続ける」の record_outcome を `outcome: approved, ruling: false-positive, notes: <裁定の理由>` にする。所見に `casefile/tampered` があれば、誤検知の選択肢を出さずに止める。人には AskUserQuestion で聞かず、止めた理由(改竄の所見の要約と `decisionPoint`)を報告する(AskUserQuestion の選択肢は 2 件以上が要るので、選択肢を「止める」だけにできない。2026-09-29 に改めた)。誤検知の 1 件の退避先は M4-C の `<runsDir>/<slug>/unrecorded-gotchas.md`(run が無いときは `.codiel/reports/unrecorded-gotchas.md`)のまま揃える(`SKILL.md:137`(`7130f69c`)) | 手順に `ruling: false-positive` がある。改竄の STOP では AskUserQuestion を使わずに止め、理由を報告する。退避先のパスが 2 つとも手順にある |
| ASK の裁定 A は、再評価の前に `record_outcome(outcome: rejected, ruling: revise, notes: <人の指示>)` を記録する。旧規則の「最終的な裁定が固まったら記録」をやめる | 裁定 A の手順で record_outcome が evaluate の呼び直しより前にある |
| ASK の裁定 B は `record_outcome(outcome: approved, ruling: as-is)` を記録する | 裁定 B の手順に `ruling: as-is` がある |
| `judgeStatus` が degraded の ASK では、所見と `degradedReasons` を示し、AskUserQuestion で「再評価 / そのまま承認 / 止める」を聞く。再評価は evaluate を呼び直し、そのまま承認は裁定 B と同じ手順、止めるは `stop --reason raguel-degraded` | 手順に 3 択がある |
| 「同一フェーズで ASK が 3 回続いたら再提出をやめ、STOP の手順で止める」(`C/skills/raguel-gating/SKILL.md:103`(`7130f69c`))を撤去する。ASK のたびに人が裁定するので、回数の上限は要らない(R17) | スキルにこの規則が無い |
| evaluate がバックグラウンドへ移ったら、完了の通知を待ち、その間に evaluate を呼び直さない | 手順に 1 文ある |
| `decisionPoint` と `reasons` を人への提示に含める | ASK・STOP の提示の手順に 2 つの語がある |
| ASK・STOP・degraded の ASK で人に聞くときは、懸念の要約(何が、どこで)と `decisionPoint` を AskUserQuestion の質問文の中に入れ、応答の本文だけに書かない。所見の原文は添えない | 3 つの場面の AskUserQuestion の手順に、質問文へ要約と `decisionPoint` を入れる規則がある |

所見文(`findings` の `message` と `evidence`)を読むのはオーケストレーターであり、人に届くのはオーケストレーターが組んだ要約と質問だけである。現行の raguel-gating も要約の提示を求める(`C/skills/raguel-gating/SKILL.md:82-83`(`7130f69c`))が、要約を出さずに人に聞いた例があった(ユーザーの報告)。質問文そのものに要約を入れる規則は、この欠落を防ぐためのものである。

#### 6.13.2 orchestrating-runs

| 変更 | 受け入れ基準 |
| --- | --- |
| ゲートの手順から「全文を渡す」「git diff を渡す」の記述(応急処置 (8))を、raguel-gating の対応表の参照に置き換える | 渡すものを書いた行が raguel-gating の表だけにある |
| 「失敗の記録」の契機に「degraded の評価を人が止めると裁定した」は入れない(障害は対象プロジェクトの失敗ではない) | 契機の表が変わらない |
| code 系フェーズの `start-phase` の後に、そのフェーズの開始の HEAD が state に記録されることを前提として書く(§6.13.3) | 手順に 1 文ある |

#### 6.13.3 codiel-state

Raguel の記録を読む処理を `C/src/raguel-records.ts`(新設)に置く。置き場の解決(§6.9.1)・索引と裁定の記録の読み込み・verdict.json の読み込みを持ち、raguel-mcp の src は import しない(R11)。設定は `.codiel/config.json` の `raguel` キー(JSON)なので、`JSON.parse` で読み、codiel の `package.json` に依存を足さない。M4-C の `readCodielConfig`(`C/src/codiel-state.ts:318`(`7130f69c`))は `testsDir`・`runsDir` だけを返し `raguel` を読まないので、`raguel.storage` は `raguel-records.ts` が同じ config.json から読む。`testsDir` が要るとき(2 者比較テスト)は `readCodielConfig` を使う。プロジェクトルートの探し方は `findMainRoot` と同じにする(§6.9.1)。M4-C の `config`・`gitignore` のサブコマンドと `isLegacy`(`:293`(`7130f69c`))の振る舞いは変えない。コマンドの位置は `init`(`:680`)・`start-phase`(`:787`)・`pass-gate`(`:853`)・`mark-ask`(`:908`)である(いずれも `7130f69c`)。

| コマンド | 変更 | 受け入れ基準 |
| --- | --- | --- |
| `start-phase` | test-code・implement・test-loop・fix-loop では、`git rev-parse HEAD` をフェーズの `startHead` に記録する。加えて、直前に passed になったゲート付きフェーズの `passedHead` があれば、フェーズの間の連続性を確かめる。直前が code 系フェーズなら、今の HEAD が `passedHead` と等しいことを要る。直前が文書のフェーズなら、`passedHead..HEAD` の変更がそのフェーズの `subject.files`(検査 9 で sha256 を照合した文書)だけであることを要る。文書のフェーズの成果物はゲート通過の直後にコミットする運用(`C/skills/orchestrating-runs/SKILL.md` の 2.1、§6.2.3)を保つためである。同じステージの test-spec と dev-plan は、両方の `subject.files` を合わせて見る(2026-09-29、W4 のレビューを受けたユーザー決定) | 4 フェーズで `phases.<phase>.startHead` が 40 桁のコミットになる。直前の code 系フェーズの pass-gate の後にコミットを足すと、start-phase が「評価の後にコミットがある」旨で失敗する。直前の文書のフェーズの後に、評価した文書のほかのファイルをコミットしても同じく失敗する |
| `pass-gate` の記録 | 通したときの HEAD を `phases.<phase>.passedHead` に記録する(すべてのゲート付きフェーズ。git の管理外では記録しない) | passed のフェーズが `passedHead` を持つ |
| `pass-gate` | 下の検査をすべて通ったときだけ通す | 検査ごとに、外れた入力で非ゼロ終了するテストがある |
| `mark-ask` | `--kind raguel` では `--evaluation-id` を必須にし、索引の行があり、`runId`・`phase` が合い、`verdict` が `--verdict`(既定 ASK)と等しいことを確かめる | 存在しない evaluationId と、verdict の食い違いで非ゼロ終了する |
| `init` | 同じ slug の最新の try について、state の検査(codiel 設計 §6.2.2)に加え、その try の `raguelRunId` の索引の行に、judgeStatus が ok の STOP で、`false-positive` の裁定の記録を持たないものがあれば、`--human-approved` を要る | STOP を state に記録しないまま止めた try の次の `init` が、`--human-approved` なしで失敗する(codiel 設計 §6.14.3 の限界が閉じる) |
| `init` | 新しい state に `raguelContract: 2` を記録する | 新しい state がこのフィールドを持つ |

pass-gate の検査は次のとおりである。

1. 索引に `--evaluation-id` の行がある。
2. 行の `runId` が state の `raguelRunId`、`phase` がコマンドのフェーズと等しい。
3. その行が、同じ run・同じフェーズの索引の最後の行である。後の評価で ASK が出た後に、前の PROCEED で通さないためである。
4. 行の `verdict` が `--verdict` と等しい。
5. 行の `casePath` の verdict.json が読め、`evaluationId`・`runId`・`phase`・`verdict` が索引の行と等しい。
6. `--human-approved` が無ければ、verdict が PROCEED である。
7. `--human-approved` があれば、裁定の記録に同じ evaluationId の行があり、verdict が ASK なら `ruling` が `as-is`、STOP なら `false-positive` である。
8. code 系フェーズ(test-code・implement・test-loop・fix-loop)では、verdict.json の `subject.head` が現在の `git rev-parse HEAD` と等しく、`subject.base` がフェーズの `startHead` と等しい。さらに `subject.paths` が無いことを要り、`paths` で範囲を絞った評価では通さない(2026-09-29、W4 のレビューを受けたユーザー決定)。
9. 文書のフェーズ(design・test-spec・dev-plan・intent-sync)では、`subject.files` の各ファイルの現在の sha256 が記録と等しい。加えて、フェーズごとに期待するファイルが `subject.files` に含まれる。design は run の文書の置き場の `design.md`、dev-plan は `dev-plan.md`、test-spec は `testsDir` 配下の `spec.md` か `cases.md` が 1 件以上である。intent-sync は書き換えるファイルが可変なので、期待するファイルを照合しない(§13。2026-09-29、W4 のレビューを受けたユーザー決定)。
10. state に `raguelContract: 2` が無い run(この作り直しより前に作った run)では、pass-gate は検査の代わりに次の文言で失敗する。

```
codiel: この run は Raguel の記録の形式が古い(raguelContract なし)ため、この版ではゲートを通せない。`codiel-state stop --slug <slug> --reason migrate` で止めてから、`/codiel:run <intent パス>` で同じ intent の新しい try を始める。
```

`<slug>` と `<intent パス>` は state の値に置き換えて出す。`migrate` は codiel 設計 §6.2.4 と同じ値である。

検査 8 の `subject.base` の照合と検査 9、§6.13.1 の fix-loop の評価の範囲をフェーズ全体にする変更は、ユーザーが採った(R16)。検査 8 の `subject.base` の照合は、フェーズの差分の一部だけを評価させる(`baseRef` を後ろへずらす)抜け道を塞ぐ。検査 9 は、ゲートの後で文書を書き換えてからコミットする抜け道を塞ぐ。

#### 6.13.4 hook

| hook | 変更 | 受け入れ基準 |
| --- | --- | --- |
| guard-write | run が active か awaiting_human の間、`.codiel/config.json` の全体、`RAGUEL_CONFIG` が指すファイル、`casesDir` の配下への書き込み(Write と Edit)を deny する。置き場は、M4-C の判定の順序(§3.1、codiel 設計 §6.17.6)の「active run」の手順の中で、`findActiveRun` の直後、`status !== "active"` で通す分岐より前とする(`C/src/hooks/guard-write.ts:229-230` の間(`7130f69c`))。この分岐は awaiting_human の run で以降の判定をすべて通すので、後ろに置くと awaiting_human の間を守れない。`state.intent`・config を読む手順・未記録の GOTCHAS の退避先より前になるので、退避先のファイルや config の不正の扱いに左右されない | 2 つの状態の run で、3 種のパスへの Write と Edit が deny になる。run が無ければ通る。M4-C の guard-write のテスト(判定の順序、E2E のレポート、`<runsDir>/` の ask、退避先)がそのまま通る |
| guard-bash | 同じ条件(`findActiveRun` が run を返したとき。`guard-bash.ts:798`(`7130f69c`))で、同じパスを対象にするリダイレクト・`tee`・`sed -i`・`cp`・`mv`・`rm`・`dd`・`install` を deny する。判定は、M4-C の state.json の判定(`writesStateJson`。`guard-bash.ts:754-790`(`7130f69c`)、codiel 決定 96)と同じく `parseCommands` の語の列に当て、閉じていないクォートのときは `splitLoosely` の語で見る | 各コマンドの形が deny になる。M4-C の guard-bash のテスト(state.json の判定の誤検知の再発)がそのまま通る。複雑なシェル構文による回避は既知の限界として codiel 設計 §6.8 の書き方に倣って記録する |
| stop-guard | 変えない | |

awaiting_human の間も守るのは、人の裁定を待つ間に設定を緩める操作(所見 G8 の「common/secrets を無効化する案」)を防ぐためである。利用者が設定を変えるときは、run を止めるか、自分の手で変える。

`.codiel/config.json` は `raguel` のほかに codiel の `testsDir`・`runsDir` を持つ。guard は `raguel` キーだけでなく、ファイル全体への書き込みを拒む。判断の軸と、ツールごとの実現の可否は次のとおりである。

| 軸 | ファイル全体を拒む | `raguel` キーの変更だけを拒む |
| --- | --- | --- |
| Write で設定を緩める操作を止める | できる(パスで判定) | 書き込む全文を JSON として読み、`raguel` を今のファイルと比べれば判定できる |
| Edit で設定を緩める操作を止める | できる(パスで判定) | 置き換えの前後の文字列から編集後の全文を組み立てて比べる必要があり、組み立てに失敗したときの扱いが要る |
| Bash で設定を緩める操作を止める | state.json と同じ文字列の照合で、書き込みの形を止められる | `jq` や `sed` の結果を実行前に知る手段が無く、判定できない |
| codiel 自身の正当な書き込みを止めない | run の間に codiel が config.json を書く手順は無い。書くのは run の外の `/codiel:init` である。codiel-state は Node の中からファイルを書くので hook に掛からない | 同じ |

Bash でキー単位の判定ができず、run の間に codiel が config.json を書かないので、ファイル全体を拒む。run の間に `testsDir` を変えることも止まるが、testsDir を変えると記録済みのテストの保護(codiel 設計 §6.13.6)が狂うので、run の間に変えない方がよいと推定する。run の間に codiel が config.json を書く手順は、M4-C の後(`7130f69c`)にも無い。書くのは run の外の `/codiel:init` だけである(§3.1)。

### 6.14 契約の文書と追随の手当て

- 契約の正本を `C/docs/raguel-contract.md`(新設)に置く。中身は、§6.1 のフェーズの表、§6.9 のファイル形式と置き場の解決(`RAGUEL_CONFIG` の JSON、プロジェクトルートの `.codiel/config.json` の `raguel`、既定の `~/.raguel` の順。§6.12.1)、§6.2.7 の裁定の組み合わせ、§6.13.3 の pass-gate の検査である。Raguel の DESIGN と codiel の設計はこの文書を参照する。
- `C/docs/format-change-checklist.md` に「Raguel との契約」のセクションを足し、契約を変えたときに追随させるものを並べる。raguel-mcp の `R/codiel/phases.ts` と `R/casefile/`、codiel の `C/src/codiel-state.ts` の `STAGES`・`GATED` と `C/src/raguel-records.ts`、raguel-gating の対応表、2 者比較テスト、である。
- 2 者比較テストを 2 本置く。
  - `R/codiel/__test__/phases.test.ts`: codiel の `STAGES`・`GATED` を相対パスで import し、Raguel のフェーズの表(フェーズ名・ステージ番号・ゲートの有無)と一致することを確かめる。
  - `C/src/__test__/raguel-records.test.ts`: raguel-mcp の CaseStore で一時ディレクトリに評価と裁定を書き、codiel の `raguel-records.ts` で読んで pass-gate の検査が通ること、置き場の解決と projectId が両者で等しいことを確かめる。プロジェクトルートと projectId の比較は、少なくとも次の 4 つの起点で行う。codiel の worktree(`.codiel/worktrees/<slug>/<名前>`)の中、利用者が自分で作った worktree で `.codiel` を持つもの、同じく `.codiel` を持たないもの、git の管理外のディレクトリである。置き場の解決は、加えて次の 4 つで比べる。プロジェクトルートのサブディレクトリを起点にしたとき(M4 の `<cwd>/.codiel/config.json` では見つからない形)、`config.json` に `raguel` キーが無いとき、`raguel.storage.casesDir` を書いたとき、`RAGUEL_CONFIG` を設定したとき。`testsDir` の解決(R24)は、codiel の `readCodielConfig` と Raguel の読み方の結果が等しいことを、キーが無い(既定の `docs/codiel/tests`)、`./` と末尾の `/` の付いた値、`.`、不正な値(文字列でない・空・絶対パス・`..`。両方が失敗する)で確かめる。E2E のレポートの判定は、codiel の `isE2eReport` と Raguel の判定が同じパスの列で同じ答えを返すことを確かめる。
- checklist の「Raguel との契約」には、`testsDir` の読み方とレポートの判定(codiel の `readCodielConfig`・`isE2eReport` と Raguel の対応する関数)も並べる。
- どちらもテスト時だけの依存である。codiel 設計 §6.10.3 の扱い(`__test__/` はバンドルに入らない)に倣う。

---

## 7. テスト方針

### 7.1 vitest

テストは対象ソースと同じディレクトリの `__test__/` に置き、子プロセスとして起動する fake は `R/testing/` に置く(`.claude/rules/metatron/testing-policy.md`)。

| 対象 | 確かめること | 根拠 |
| --- | --- | --- |
| `R/testing/fake-claude.mjs`(移設) | 受け取った引数に §6.7.2 のフラグがすべてあり、`--json-schema` の値が JSON として読め、`$schema` を持たず、`type: "object"` を持つことを検査する。外れたら実際の CLI と同じく非ゼロで終わる。cwd が空のディレクトリであることも検査する | I1、C1 |
| `R/testing/fake-codex.mjs`(新設) | §6.7.3 のフラグ、`--output-schema` のファイルが厳格な形のスキーマであること、`-o` のファイルへの書き出し、stdin のプロンプト | R14 |
| 2 プロバイダーの同じ入力 | 同じ JudgeCall に対し、claude と codex の実装が同じ形の応答を返す | R14 |
| Jev の文脈判定 | `JevCall` の型の fake の関数を注入し、noul・score の回答を返す。§6.4.4 の対象(破壊操作と実行の候補、injection-marker、語彙系の 4 ルール、再提出と重さ)ごとに、無効のときに決定論の規則と同じ結果になること、有効で下げる・上げる(unsafe-exec は message だけ変わる)こと、鍵が無い・例外・タイムアウト・上限超過で決定論の結果と `contextJudge/unavailable` の info になり `judgeStatus` が ok のままのこと。`common/secrets` の stop で呼ばれないこと、送る `state` が伏せ字済みであること | R19 |
| `claude` の `buildArgs` | 引数の列を固定値と比べる | R8 |
| git からの差分 | 一時リポジトリで、worktree の `repoPath`、別のリポジトリの拒否、`core.quotePath=true` と `diff.noprefix=true` と `diff.external` を設定したリポジトリでの固定書式、日本語のファイル名、未コミットの変更の拒否、`-` で始まる baseRef の拒否 | R2、A6 |
| 空の差分 | 空の差分で、ルール層・Jev・パネルが呼ばれずに PROCEED・trivial・`code/no-change` の info が返ること。subject・verdict.json・索引が書かれ、pass-gate の検査(検査 8 を含む)が通ること。差分が空で `paths` の範囲に未コミットの変更があれば入力の誤りになること | R22 |
| 保護パスの除外と生成物 | `excludeDefaults` で既定の glob が外れ、`policy` と list_rules に出ること。既定に無い文字列と固定部が空の `generated` が読み込みエラーになること。生成物のパスで protected-paths・重さ・パネル・Jev が当たらず、common/secrets だけが当たること。生成物だけの差分で `code/generated-only` の info が出ること | R20 |
| testsDir と E2E のレポート | `testsDir` のキーが無いときの既定、`RAGUEL_CONFIG` を設定したときもプロジェクトルートの config.json から読むこと、不正な値で読み込みの失敗になること。レポートのパスで protected-paths・重さ・パネル・Jev が当たらず common/secrets だけが当たること。レポートだけの差分とレポートと生成物だけの差分で PROCEED・`code/no-change` になり、記録が書かれること。`testsDir` の外の `reports/` は外れないこと | R24 |
| ファイルの読み込み | repoPath の外・シンボリックリンク越し・1 MB 超・UTF-8 でないファイルの拒否 | R2 |
| ルール層 | §6.4.2 の各変更。所見 A1 の 60 行の標本で common/secrets が出ないこと、A2 の `user:pass@`、A4 の見逃しの型、伏せ字 | A1〜A12、H1 |
| 再提出の判定 | 前回の ruleId が消えた再提出、裁定のある attempt、degraded の attempt が比較から外れる | D5 |
| 重さ判定 | §6.5 の点数の例(49 行・4 ファイルで 33 点、文書が standard を下回らない) | B1〜B3 |
| 合成規則 | §6.6.3 の各分岐。standard でスコアと乖離度が判定を動かさないこと。文書の standard で crosscheck の所見も steelman の反駁で降格すること | C2、R15 |
| パネルの構成 | 文書の standard で、前フェーズの証拠があるときだけ crosscheck が起動し、intent では起動しないこと。meta が critical でだけ起動すること | R15 |
| パイプライン | 前フェーズ改竄の STOP、meta 失敗の degraded、締切の打ち切り、`extra.signal` の abort で子プロセスが止まり索引に書かれないこと(所見 I1 が挙げた分岐を含む) | I1、R6 |
| ケースファイル | チェーンが verdict の書き換えを検出すること、未知のファイルを無視すること、前の attempt の差し替えの検出、一時ファイルと rename、読めない `index.json` を上書きしないこと、掃除が索引を消すこと、`latestAttemptDir`・`resolveProjectId`・`sweepRetention` の `maxDays` | G3〜G8、I1 |
| 設定 | §6.12.2・§6.12.3 の各エラー、sealed のリストの和集合、起動時に壊れた設定でも起動すること。§6.12.1 の読む順(`RAGUEL_CONFIG` の JSON、プロジェクトルートの `.codiel/config.json` の `raguel`、既定)、サブディレクトリの cwd から config.json を見つけること、`raguel` キーが無いときに既定を使うこと、`runsDir` を検証しないこと(`testsDir` は §6.12.1 と R24 のとおり検証し、不正なら読み込みの失敗)、壊れた JSON と `raguel` がオブジェクトでないときに読み込みの失敗になること、`raguel.config.yaml` だけがあるときに読まず既定で動くこと | A3、A14、E2、R23 |
| 判例 | firedRules の除外、degraded から作らないこと、退役、`precedent/failure-match` | G2、R7 |
| codiel-state | §6.13.3 の検査ごとのテスト | R11 |
| hook | §6.13.4 の各 deny | R12 |
| 2 者比較 | §6.14 の 2 本 | R10、R11 |

パネルの応答は `R/panel/testing/fakeProvider.ts` の系統で与え、実際の `claude`・`codex`・Jev は呼ばない。`fakeProvider.ts` と `fixtures.ts` は複数のテストから使うヘルパーなので、`R/panel/__test__/helpers/` へ移す(テスト方針)。

### 7.2 実機確認

次の確認は実際に `claude -p`・`codex exec`・Jev の API を起動し、費用がかかる。実装時に、実行する前にユーザーに確かめる。結果は実装計画書の記録に残す。

| # | プロバイダー | 確かめること |
| --- | --- | --- |
| 1 | claude | 実装の着手前に最初に行う。`--setting-sources project` と空の cwd で、ログインが保たれ、利用者の hooks・CLAUDE.md・プラグインが読まれない(hook の副作用のファイルや、CLAUDE.md にだけ書いた指示の反映の有無で見る)。ログインが外れたら §6.7.2 の代替の候補 a〜c を順に確かめる |
| 2 | claude | `$schema` を除いたスキーマで `structured_output` が返る |
| 3 | claude | `--strict-mcp-config` がプラグイン同梱の MCP サーバーまで止める(所見「確かめられなかった事項」) |
| 4 | claude | standard と critical の 1 評価の所要時間を測り、1 回の呼び出しの既定 180 秒とゲートの締切 600 秒(R21)が足りるかを確かめる |
| 5 | codex | 読み取り専用のサンドボックスを指定するフラグの綴りと効果 |
| 6 | codex | シェルのツールを無効にできるか。できなければ、どこまで読めるか |
| 7 | codex | `--ignore-user-config` と `--ignore-rules` の下で、利用者の `AGENTS.md` が読まれないか |
| 8 | codex | `--output-schema` が厳格な形を要るか。認証が `CODEX_HOME` だけで通るか |
| 9 | Jev | 文脈判定の noul・score の回答の形が §6.4.4 の当て方と合う。2 つの問い合わせの所要時間が `contextJudge.timeoutMs`(20000)に収まる。`lower`・`raise` の閾値で、既知の誤検知(所見 A4・A5・A12)と見逃し(A7・A8・F6)の標本が意図どおりに動く |
| 10 | 共通 | Claude Code が evaluate の呼び出しに progressToken を付けるか。120 秒でバックグラウンドへ移ったときの完了の通知の形。MCP の呼び出しの時間の上限が 600 秒の締切より短くないか |
---

## 8. バージョン

| 対象 | 現在 | 新 |
| --- | --- | --- |
| codiel `plugin.json`・`package.json` | `1.0.0` | `1.0.0-dev`(2026-09-29 にユーザーの指示で改めた) |
| raguel-mcp `package.json` | `0.0.1-dev` | `0.0.2-dev`(同上) |
| MCP サーバーが名乗るバージョン | `"0.1.0"` 固定(`R/server.ts:45`) | `package.json` の `version` |
| `policy.version` | `1`(`R/core/pipeline.ts:38`) | `2` |
| ケースファイルの `schemaVersion` | なし | `2` |
| 設定の `version` | `1` | `1` のまま |

- サーバーのバージョンは、`raguel-mcp/build.ts` の esbuild の `define` で `package.json` の `version` を埋め込む。tsconfig の `resolveJsonModule` を触らないためである。応答の `policy.buildVersion` も同じ値を使う(所見 J2)。
- 依存は作り直しと同時に上げる(所見 J4)。`@modelcontextprotocol/sdk` 1.30 系、`zod` 4.6 系、`picomatch` 4.0.7 を目安とし、上げた版は実装時の最新で決める。`@typesafe-ai/sdk` は jevriel と同じ `0.6.0` を足す。
- `yaml` は M4-C で raguel-mcp の依存から外れた(`7130f69c` の `raguel-mcp/package.json`。§3.1)。作り直しでも戻さない。codiel の `package.json` にも依存を足さない(§6.13.3)。

---

## 9. 文書の追随

| 文書 | 変更 |
| --- | --- |
| `plugins/codiel/raguel-mcp/docs/DESIGN.md` | 本設計に合わせて書き直す。判定モデル(`judgeStatus`・`subject`)、パイプライン、ツールの入出力、ルールの表(STOP 4 種)、重さ判定、パネル構成とプロバイダー、ケースファイルの配置(`<phase>/attempt-NN`)、判例、不変条件、設定(`casesDir` が `cases` と `precedents` の親であること。所見 J3)。今も残る `raguel.config.yaml` の設定の説明は撤去し、`.codiel/config.json` の `raguel` キーと `testsDir` の読み方に置き換える(§3.1、§6.12.1)。旧 §11 の「kind ごとにモデルを上書き」は削る。契約の詳細は `C/docs/raguel-contract.md` を参照させる |
| `plugins/codiel/README.md` | Raguel の運用のセクションを足す。設定の置き場(`.codiel/config.json` の `raguel` キーを JSON で書くこと、`RAGUEL_CONFIG` のファイルも JSON であること、YAML は読まないこと)と読み直し、配列のマージ規則、パネルのプロバイダー(claude / codex)の選び方と codex の認証、Jev の文脈判定(既定は無効、有効にする設定、鍵 `TYPESAFE_API_KEY`、有効にすると成果物が伏せ字の後で TypeSafe AI へ送られること、効かなかったときは決定論で動くこと)、codex を選ぶと成果物が OpenAI へ送られること、codex のツールの限界(§6.7.3)、ケースファイルとログの置き場、`list_precedents`・`retire_precedent` の使いどころ、保護パスの既定の除外(`excludeDefaults`)と生成物の宣言(`generated`)とその限界(§11)、評価が 120 秒を超えるとバックグラウンドへ移り完了の通知で返ること(R21)、E2E のレポートを Raguel が評価から外すこと(R24) |
| `plugins/codiel/skills/initializing-harness/` の雛形とスキル | M4-C で雛形は `C/skills/initializing-harness/config.example.json` に移っている(§3.1)。その上で、スキルの本文に残る設定のマージの説明を、配列の和集合と置換の規則に改める(所見 E2。旧 `SKILL.md:58-60` の「差分オーバーレイ」は M4-C で書き換わったので、`7130f69c` の本文で該当箇所を探す)。JSON には注釈を書けないので、規則の説明はスキルの本文と README に置く。`storage.projectId` の書き方を例に足す(所見 G5)。`code/protected-paths` の `excludeDefaults` と `generated` の書き方と、使う場面(IaC・CI を直すプロジェクト、生成物をコミットする規約)を例に足す(R20) |
| ルートの `README.md` | codiel の行に Raguel のプロバイダーの選択を 1 文で足す |
| `C/docs/raguel-contract.md`・`C/docs/format-change-checklist.md` | §6.14 |
| `.serena/memories/codiel/raguel_mcp.md` | バージョン、パネリストの構成、プロバイダー、ケースファイルの配置、fake の置き場を改める。Serena の `edit_memory` で行う |

ARCHITECTURE への影響は次のとおりである。ADR の追加は、実装時に `metatron:updating-architecture` を起動して行う。

- ADR 候補: [codiel] Raguel の作り直し(R18。1 本にまとめる)。採用した結論の要点は次の 3 つである。
  - パネルのプロバイダーを claude / codex から選べる。既定は claude で、Anthropic API を必須にしない要件は既定で満たす。codex は ADR-005 の外部 API にあたる。
  - ルール層と重さ判定の一部を、任意で Jev に文脈判定させられる。既定は無効で、Jev は stop → ask と info → ask などの限られた向きにだけ判定を動かす。Jev は ADR-005 の外部 API にあたる。
  - Raguel は評価対象を自分で読み、codiel の pass-gate は Raguel の記録(索引・verdict.json・裁定)を照合する。両者は同じファイル契約を独立に実装する。
  - Raguel の STOP は秘密情報・保護パス・破壊操作・改竄の 4 種に限り、改竄以外は人の誤検知の裁定で通せる。旧 DESIGN の原則「STOP は覆せない」を上書きする。
- ADR-009(`.codiel/config.json` に testsDir・runsDir・raguel を集め、run の文書を git で共有し、state と報告を手元に残す)との関係は、新しい ADR の影響範囲に 1 文で書く。Raguel は ADR-009 が集めた `.codiel/config.json` から `raguel` と `testsDir` を読み、置き場を増やさない。ADR-009 の本文は書き換えず、上書きもしない。
- ディレクトリ構成とレイヤー構造は変わらない。raguel-mcp の依存に `@typesafe-ai/sdk` が加わるが、技術スタックの表はプラグイン固有の依存を載せない(`harness-docs/ARCHITECTURE.md:25`)。

---

## 10. 影響ファイル一覧

raguel-mcp(`R/`):

| ファイル | 変更 |
| --- | --- |
| `server.ts` | バージョンの埋め込み、ツール 2 本の追加、起動時の設定の失敗で止まらない |
| `tools/*.ts` | 入力の置き換え(§6.2)。`listPrecedents.ts`・`retirePrecedent.ts` を新設 |
| `subject/`(新設) | git からの差分の作成、ファイルの読み込み、repoPath の検証 |
| `codiel/phases.ts`(新設) | フェーズの表 |
| `core/types.ts`・`pipeline.ts`・`verdict.ts`・`weight.ts`・`invariants.ts` | §6.3〜§6.6、§6.12.3 |
| `rules/**` | §6.4 |
| `panel/provider.ts`・`runner.ts`・`prompts.ts`・`rubrics.ts`・`schema.ts`・`panelists/*` | §6.6、§6.7。`assumption.ts`・`precedent.ts` を削除 |
| `panel/claudeCli.ts`・`panel/codexCli.ts`(新設) | §6.7 |
| `context/jev.ts`・`context/judge.ts`(新設) | §6.4.4。Jev の呼び出しと、質問の組み立て・結果の当て方 |
| `casefile/store.ts`・`hashchain.ts` | §6.9、§6.10 |
| `precedent/store.ts`・`retrieval.ts` | §6.11 |
| `config/schema.ts`・`defaults.ts`・`loader.ts` | §6.12。`loader.ts` は M4-C で `.codiel/config.json` の `raguel` を読む形になっている。作り直しで、探す起点をプロジェクトルートに改め、`testsDir` の読み方と E2E のレポートの判定を足す(§6.9.1、§6.12.1、R24) |
| `testing/fake-claude.mjs`(移設)・`testing/fake-codex.mjs`(新設) | §7.1 |
| `../package.json`・`../build.ts`・`../dist/server.mjs`(ビルドで再生成) | §8 |
| `../docs/DESIGN.md` | §9 |

codiel(`C/`):

| ファイル | 変更 |
| --- | --- |
| `src/raguel-records.ts`(新設) | §6.13.3 |
| `src/codiel-state.ts` | start-phase・pass-gate・mark-ask・init(§6.13.3) |
| `src/hooks/guard-write.ts`・`guard-bash.ts` | §6.13.4 |
| `scripts/*.mjs`(ビルドで再生成) | |
| `skills/raguel-gating/SKILL.md`・`skills/orchestrating-runs/SKILL.md` | §6.13.1、§6.13.2 |
| `skills/initializing-harness/` | §9 |
| `docs/raguel-contract.md`(新設)・`docs/format-change-checklist.md`・`README.md` | §6.14、§9 |
| `package.json`・`.claude-plugin/plugin.json` | §8。依存は足さない |

そのほか: ルートの `README.md`、`.serena/memories/codiel/raguel_mcp.md`、ARCHITECTURE(ADR。§9)。

---

## 11. リスク

| リスク | 影響 | 手当て |
| --- | --- | --- |
| codiel と Raguel で置き場の解決がずれる(MCP サーバーと Bash の `RAGUEL_CONFIG` が違う、2 つの独立実装のプロジェクトルートか projectId の規則がずれる、サーバーの cwd と codiel-state の cwd が違うディレクトリを指す) | 違う設定を読む、または pass-gate が正しい評価を見つけられず run が進まない | 2 者比較テスト(§6.14 の 4 つの起点)。pass-gate の失敗の文言に、読んだ設定と索引のパスを出す |
| 利用者が自分で作った worktree で `.codiel` を持たずに Claude Code を起動する | プロジェクトルートが cwd になり、メインの作業ツリーの `.codiel/config.json` を読まない | `findMainRoot` の意図(付け替えない)に揃えた結果である。README に、設定はプロジェクトルートに置くと書く |
| guard が `.codiel/config.json` の全体を拒む(§6.13.4) | run の間は `testsDir`・`runsDir` も AI が変えられない | run の間に codiel が config.json を書く手順は無い(`7130f69c` で確かめた)。変えるときは run を止めるか、利用者が自分の手で変える |
| codiel と Raguel で `testsDir` の読み方か、E2E のレポートの判定がずれる(R24) | Raguel がレポートでないファイルを評価から外すか、レポートを評価して差分が空にならない | 2 者比較テストで、`readCodielConfig` と Raguel の `testsDir` の解決、`isE2eReport` と Raguel のレポートの判定を突き合わせる(§6.14)。どちらかを変えるときは checklist で追随させる |
| 締切を延ばしたことで、評価が数分かかる | run の進みが遅くなる。バックグラウンドへ移った評価の完了の通知を codiel が取りこぼすと、run が止まる | 待つ手順を §6.13.1 に置き、完了の通知の形を §7.2 の 10 で確かめる。値は実機で測って見直す(§7.2 の 4、§15) |
| 生成物の宣言(`generated`)が、生成物に見せかけた手書きの変更の抜け道になる | 宣言したパスの変更は、保護パス・重さ・パネル・Jev を通らない | 次の 4 つで手当てする。common/secrets は生成物にも必ず当てる。生成物だけの差分には `code/generated-only` の info を出す。固定部が空の glob は宣言できない(§6.12.3)。宣言は `policy` に出し、run の間は `.codiel/config.json` への書き込みを guard が拒む(§6.13.4)。生成物と、それを作るソースの対応を決める規則は持たない(プロジェクトごとに違うため)。§13 の既知の限界に置く |
| `excludeDefaults` で `infra/**` などの保護を外したまま、外した事情が過ぎても残る | IaC や CI の変更が STOP されない | `policy` と list_rules に毎回出る。README に、run が終わったら戻すことを書く |
| codex と Jev(有効なとき)に成果物が外部へ送られる | ルール層が見逃した秘密情報が外へ出る | `common/secrets` の stop でパネルも Jev も呼ばない。Jev へは伏せ字の後の本文を送る。README に書く。既定は claude で、Jev は無効 |
| Jev が破壊操作の stop を誤って ask に下げる | 実行される破壊操作が人の裁定に回る | STOP ではなくなるが PROCEED にはならず、人が ASK を裁定する。閾値 `lower` は実機で見直す(§15) |
| Jev の問い合わせが締切の時間を使う | パネルの時間が最大 20 秒減る | 有効にしたときだけ起きる。600 秒の締切に比べて小さい。所要は §7.2 の 9 で測る |
| codex のシェルのツールが利用者のファイルを読む | 読んだ内容がケースファイルに残る | `--disable shell_tool --disable unified_exec` で塞ぐ(§6.7.3。実機確認の 6 で確認) |
| `subject.ignoreUncommitted` にソースのパスを宣言する | 未コミットのコードの変更が、評価に入らないままテストの結果に効く | 宣言は `policy.ignoreUncommitted` と list_rules に毎回出る。固定部が空の glob は宣言できない(§6.12.3)。run の間は guard が `.codiel/config.json` への書き込みを拒む(§6.13.4)。README に、run と関係の無いファイルの置き場だけを書くと記す |
| codex が `$CODEX_HOME/AGENTS.md` を読む | 利用者の全体の指示がパネリストの判定に混じる | 止める手段が無い(実機確認の 7)。README に既知の限界として書く。既定のプロバイダーは claude で、codex は利用者が選んだときだけ使う |
| 人の裁定の真正性を機械で確かめられない | オーケストレーターが自分で record_outcome を呼べば、裁定を装える | codiel のスキルの HARD-GATE で禁じる(現行どおり)。§13 の既知の限界 |
| projectId の算出が変わる | 旧ケースファイルと旧判例が見えなくなる | 引き継がない。シード判例は残る。README に書く |
| ツールの入力が互換でなくなる | codiel `1.0.0` のスキルでは呼べない | codiel と raguel-mcp を同じリリース(codiel `1.0.0-dev`)で出す。旧 run は migrate で止める(§6.13.3 の検査 10) |
| fix-loop の評価の範囲がフェーズ全体になる | 修正ごとの評価より diff が大きく、重さが上がる | 範囲を広げる代わりに、評価の一部だけを見せる抜け道が塞がる |
| 文書の standard で crosscheck が並列に起動する(R15) | 起動数と費用が増え、crosscheck の所見による ASK が増えうる。並列なので所要時間はほぼ増えない | crosscheck の所見も steelman の反駁の対象にし、confidence の閾値を通ったものだけを採る(§6.6.3)。ASK の率は §7.2 の後に見直す |

---

## 12. 不採用案

| 案 | 決定 | 理由 |
| --- | --- | --- |
| 全面的に書き直す | R1 | 層構成とツール面は所見の対象外で、壊れていたのは各層の規則だった。書き直すと M4 の応急処置と既存のテストを捨てる |
| ルールだけに縮める(パネルを外す) | R1 | 語彙のルールは誤検知と見逃しの両方が多く(A4・A7〜A12)、ルールだけでは内容を見られない |
| 現構成に最小の修正だけを入れる | R1 | 要約を渡せる入力(F1)と自己申告の pass-gate(D4)が残り、PROCEED が実物の検査を意味しない |
| 呼び出し側が本文を渡す旧入力を残す | R2 | 要約を渡して PROCEED を取る抜け道が残る |
| 評価の終点を任意のコミットにする | §6.2.2 | pass-gate が HEAD を照合する契約と合わない |
| STOP を覆せない原則を保つ | R3 | 誤検知 1 回で try が終わり、AI が人を通さず次の try を作った(D1) |
| 不可逆キーワードの加点を設定の語彙に合わせて残す | R4 | 否定文でも一致し、語彙の一致は重さの根拠として弱い(B1) |
| 語彙のルールを ask のまま残す | R4 | design の 84 件中 54 件が max-steps で ASK になった(A9) |
| 単一の審査パネリストで判定する | R5 | 反駁役が無いと、攻める職務の所見がそのまま ASK になる(C2) |
| assumption と precedent を独立のパネリストとして残す | R5 | 起動数と所要時間が増える。O4-1b では assumption が仕様の曖昧さだけで 5 件の ASK を出した(§3.5 の K3)。職務は adversarial と参考入力で代えられる |
| 締切を 110 秒に収めてバックグラウンドへ移さない | R21 | adversarial が 60 秒で 3 回タイムアウトし(§3.5 の K2)、110 秒では standard の 2 つの波も収まらない |
| 空の差分を入力の誤りにする | R22 | 修正の要らないフェーズを通せず、run 全体の差分を渡す回避で ASK になった(§3.5 の K4) |
| `excludeDefaults` に任意のパターンを受ける | R20 | 保護を黙って広く外せる。既定の glob の名指しで K1 は解ける |
| `raguel.config.yaml` が残っていれば YAML に縮退して読む | R23 | M4 で廃止した置き場を Raguel が読み続けると、2 つの置き場の食い違いが残る。移行は `/codiel:init` が行う(§3.1) |
| config.json を M4 と同じく `<cwd>` から探す | R23 | cwd がサブディレクトリや codiel の worktree のときに見つからないか、別の設定を読む。プロジェクトルートからなら codiel-state と同じ設定を読む(§6.9.1) |
| M4-C のとおり、呼び出し側が `git diff` の pathspec で E2E のレポートを外す | R24 | Raguel は差分を自分で作る(R2)ので、呼び出し側の除外は届かない。入力に除外を足すと、評価から外す範囲を呼び出し側が決められる抜け道になる |
| E2E のレポートを利用者に `generated` で宣言させる | R24 | レポートの置き場は codiel の規則で決まり、利用者の設定を要らない。宣言を忘れると、レポートだけの差分が変更ありとして評価される |
| `testsDir` が不正なとき、Raguel だけ既定値で動く | §6.12.1 | codiel と違う場所をレポートとみなし、評価から外す範囲が食い違う |
| configSource の接頭辞を、プロジェクトルートから探す形に合わせて `project:` などに改める | §6.2.5 | 値は表示と記録にだけ使い、絶対パスでファイルは分かる。M4 の記録と読み比べるときに、同じ出所が別の表記になる |
| guard で `raguel` キーの変更だけを拒む | §6.13.4 | Bash の `jq`・`sed` による書き換えをキー単位で判定できず、緩める操作を止め切れない |
| 障害をそのまま ASK として扱う | R6 | 障害の ASK が再提出の数と判例を汚し、人が同じ承認を繰り返した(D2) |
| 障害を PROCEED にする | R6 | フェイルクローズドに反する |
| 判例を全評価から作る | R7 | 障害由来の所見が検索を汚した(G2) |
| 子プロセスの env から鍵を除く | R8 | 鍵を使うのは利用者の裁量である(ユーザー決定)。要件はプラグインが Anthropic API を必須にしないことである |
| 設定の未知のキーを警告だけにする | R9 | 厳しくするつもりの設定が黙って効かない(A14) |
| 配列をすべて和集合にする | R9 | 緩める方向の配列(allowPatterns 以外の語彙の列など)を利用者が置き換えられなくなる |
| フェーズを自由文字列で受ける | R10 | 前フェーズの順序を Raguel が解けず、綴りの誤りが別のフェーズとして記録される |
| codiel の run が kind だけを渡す | R10 | test-spec と dev-plan、implement と test-loop と fix-loop が混線する(F4) |
| pass-gate の自己申告を保つ | R11 | ASK に `--verdict PROCEED` を付けても通る(D4) |
| codiel が raguel-mcp の src を import して記録を読む | R11 | 実装層の禁止依存に当たり、配布物に raguel-mcp のコードが入る |
| Raguel 側だけで保護する(チェーンの強化だけ) | R12 | 鍵の無いチェーンは全体の書き直しを防げない。書き込みそのものを止めるのは hook である |
| チェーンに秘密の鍵を使う | §6.10 | 鍵を置く場所を判定対象の AI も読める |
| jev をパネリストにする(各パネリストを質問に分解する) | R14 | Jev は所見文を生成できない。所見文の読み手のオーケストレーターが、確率と定型文から正しく判断できるかが分からない(ユーザー決定) |
| Jev に本文を切り詰めて渡す | §6.4.4 | 切った先を見ずに判定を下げうる |
| Jev に単独で STOP か PROCEED を出させる | R19 | 文脈判定は任意の補強であり、判定の土台は決定論に保つ |
| Jev が効かなかったときに degraded にする | §6.4.4 | 任意の補強が無いことで ASK を増やす |
| Jev に秘密情報や計数の判定を任せる | R19 | 秘密情報が外部へ出る。計数は Jev が苦手である |
| プロバイダーを kind ごとに切り替える | §6.7.1 | 旧 DESIGN §11 に書いたが実装されず(J3)、要求も無い |
| `provider: none` を「ルールだけで PROCEED する」モードにする | §6.7.1 | 設定 1 行で LLM の検査を黙って外せる(C5) |

---

## 13. 範囲外と既知の限界

- 人の裁定の真正性。record_outcome を呼んだのが人の答えを受けたオーケストレーターかどうかを、Raguel と codiel は確かめられない。codiel のスキルの規律に頼る。
- ハッシュチェーンの全体の書き直し(§6.10)。guard を通らない書き込み(利用者の手、codiel を通さないセッション)は止めない。
- guard-bash のシェル構文による意図的な回避(codiel 設計 決定 69 と同じ扱い)。
- npm 以外のマニフェストの依存の追加(所見 A10 の `pyproject.toml`・`Gemfile`・`uv.lock`)。
- injection-marker の語順の変形(所見 A12 の後半)。adversarial が読む。
- 英小文字と数字だけで書かれた秘密情報のエントロピーによる検出(§6.4.2 の 3 種の条件で外れる)。既知の形のパターンは引き続き当たる。
- `testsDir` の配下で、`reports/` のセグメントを含むパスに置いた手書きのテストやコード(R24)。レポートとして評価から外れる。codiel の guard-write も同じパスをレポートとして扱う(`isE2eReport`)。
- 生成物と、それを作るソースの対応の検証(R20)。宣言した生成物のパスに手で書いた変更は、`code/generated-only` の info と common/secrets のほかには検査されない。
- ARCHITECTURE の禁止依存の文言がテストコードを除くと明記しない点。codiel 設計 §13 と同じく範囲外とする。
- 旧 projectId のケースファイルと判例の移行。
- intent-sync のゲートで、書き換えるべきファイルがすべて評価されたかの照合(§6.13.3 の検査 9)。書き換えるファイルが run ごとに違うので、評価したファイルが変わっていないことだけを見る。

---

## 14. Done 条件

- `pnpm run lint` と `pnpm run typecheck` と `pnpm run test` が通る。
- `pnpm run build` を実行し、`plugins/codiel/scripts/` と `plugins/codiel/raguel-mcp/dist/` の差分が同じコミットにある。
- codiel の `plugin.json` と `package.json` が `1.0.0-dev`、raguel-mcp の `package.json` が `0.0.2-dev` で、MCP サーバーが同じ値を名乗る(§8)。
- §4 の「直す」の所見ごとに、§7.1 のテストがある。
- §7.2 の実機確認を、ユーザーに確かめた上で行い、結果を実装計画書に記録している。【要確認】の項目は、結果に合わせて本設計と README を直している。
- §9 の文書を更新している。ADR「[codiel] Raguel の作り直し」を `metatron:updating-architecture` で足している。
- `.serena/memories/codiel/raguel_mcp.md` の食い違いを直している。
- ルートの `README.md` に反映している。
- 編集内容を適切に分けて git にコミットしている。

---

## 15. 未決事項

1. §7.2 の実機確認の結果による変更。codex のサンドボックスとツールの無効化が実現できないとき、codex をプロバイダーに残すか(README の限界で済ませるか)はユーザーが決める。
2. (確定。2026-09-29、ユーザー決定)既定の `judge.timeoutMs`(180000)・`judge.deadlineMs`(600000、上限 1800000)と confidence の閾値(70)は据え置く。§7.2 の 4 の実測は、standard が code 106 秒・文書 119 秒、critical が 243 秒で、再試行と degraded は無く、1 回の呼び出しの最長は steelman の約 106 秒だった。
3. `--setting-sources project` でログインが外れ、§6.7.2 の代替の候補 a〜c も効かないときの扱い。選択肢は、利用者の設定を読むことを既知の限界として受け入れ README に書く、claude を既定のプロバイダーから外す、の 2 つである。Anthropic API を必須にしない要件は既定のプロバイダーで満たす必要があるので、後者を選ぶときは既定を何にするかも併せて決める。ユーザーが決める。
4. (確定。2026-09-29、ユーザー決定)Jev の文脈判定の閾値は `lower` を 0.2 から 0.5 に改め、`raise` 0.7 と重さの水準の境(3 以上で standard、4 で critical)は据え置く。§7.2 の 9 の標本 7 件のうち、見逃し(A7・A8・F6)は ask に上がり、否定文の不可逆キーワードは info のまま、実行される破壊操作は p=0.79 で stop のままだった。ヘルプ文の `rm -rf /`(A4)は p=0.41 で、0.2 では下がらなかった。
