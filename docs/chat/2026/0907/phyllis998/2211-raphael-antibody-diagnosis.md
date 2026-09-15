# Raphael 抗体機構の診断

- 日付: 2026-09-07
- 参加者: phyllis998、AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: 不明
- セッション ID: cdf852f0-2ad3-4f42-9b2c-804045ce1144

---

## セッション 1: raphael 抗体機構を調査、不必要な蒸留発生の原因を診断

# phyllis998

> raphaelプラグインの改修を行います。
> 現在このプラグインで生成される抗体があまり意味を成していないのではないか、不必要に蒸留が必要な状況になりすぎているのではないかという疑念があります。
> まずは調査を行い、対応方針を考えてください。
>
> as-is: raphaelの抗体が適切に注入されず、結果不必要に蒸留が可能な状況になりすぎている
> to-be: raphaelの抗体が正しく機能し、AIが失敗を繰り返さなくなる
> goal: 調査・分析、必要であればcontext-map・設計書・実装計画書・実装用に/goalコマンドへ渡すプロンプトの生成

# AI

custom-policy 読込 → Serena 手引 → raphael スキル → 調査開始。

## セッション 2: メタトロン GOTCHAS との棲み分けを踏まえ、提案 B を trigger 精度と効果フィードバックへ再構成

# AI

調査完了。分析まとめ中。追加確認不要。

## 結論

抗体は「正しく注入されていない」のではなく、**過剰に注入されている**。真因は検知側と蒸留側の 2 層。

## 観測事実

- 抗体 56 件。うち fired 100 超が 17 件、最多 `ab-2026-0803-002`(`&&.*[|;]`)は 1,209 回。
- この調査中も毎 Bash に 1〜3 件注入。直前の `grep -rl` に lint 抗体 3 件(1 件は韓国語本文)が付いた。コマンド内容と無関係。
- infection 177 件中 176 件が `command-failure`。`retry-loop` 1、`edit-churn` 1、`user-rejection` 0。
- command-failure の内訳: TDD の red テスト 68、lint/typecheck 36、探索コマンドの exit 2(ファイル無し等)19、kill 5、他 49。
- 蒸留閾値 3。`last_distill_nag_digest` はセッション単位 → 新セッションごとに再催促。

## なぜ(2 層)

**層 1: 検知が「失敗」と「作業の正常な赤」を区別しない**
- `PostToolUseFailure` の Bash を全部 infection 化。TDD の red、lint 初回失敗、`ls` の存在確認は意図した失敗だが同列に記録。
- → 3 件で閾値到達 → ほぼ毎セッション蒸留催促 → ユーザー観測「不必要に蒸留」。

**層 2: 蒸留が汎用知識を広い正規表現で抗体化する**
- synthesizer は `model: haiku`、判断基準は「知らないと再発するか」の一問のみ。プロジェクト固有の落とし穴でなく「biome は import 順を直す」「git は `--` で分離」など一般則を抗体化。
- trigger が `pnpm.*lint` `git.*commit|git.*add` `&&.*[|;]` `\|.*jq.*\.` のように広く、ほぼ全コマンドに一致 → 発火数だけ伸びる。
- `confirmed` は不変 + expires 無視 → 広い抗体が永続。fired 数は「有効性」ではなく「正規表現の広さ」を測っている。
- 効果検証は synthesizer が同一セッション内の再発を見るだけ。抗体発火中に同種失敗が続いた証拠あり(08-25 セッション: lint 抗体発火下で `pnpm run lint` 失敗 7 回)。この信号を使う機構なし。

**層 3(副作用)**: 発火のたび frontmatter の stats を書き換え → `.raphael/antibodies/` が常時 dirty(今 24 件 M)。抗体コミットの意味が薄れる。

## 対応方針(推奨順)

推奨: **A + B を一体で改修**。C は A/B 後に判断。

判断軸: 蒸留催促の頻度 / 注入の適合率 / 実装コスト / 既存抗体の扱い

**A. 検知の質を上げる(催促を減らす)**
- 意図した失敗を除外: テスト・lint・typecheck の exit 1 を既定 benign に。同一コマンドが後続で成功したら infection を「自己解決」として蒸留対象から外す(retry-loop の逆)。
- 閾値を「件数」から「未解決 fingerprint 種類数」へ。nag digest をプロジェクト単位に。
- コスト: 小。`detect-command.ts` `check-distill-needed.ts` 中心。

**B. 抗体の質を上げる(注入の適合率)**
- synthesizer の判断基準にプロジェクト固有性を追加。一般則は非採用。trigger の広さ検査(既存コマンド履歴に対する一致率が閾値超なら拒否)を CLI 側で決定的に実施。
- 効果フィードバック: 「発火後 N 分内に同 fingerprint 失敗」を `stats.misses` として記録。misses/fired が高い抗体を自動 `expired` または review 対象へ。
- `confirmed` の永続を見直す(review で明示更新可に)。
- stats を frontmatter から `.raphael/stats.json`(gitignore)へ分離 → 抗体ファイルが dirty にならない。
- コスト: 中。frontmatter 契約変更 → 既存 56 件の移行必要。

**C. 既存抗体の棚卸し**
- 現 56 件を A/B の新基準で再選別。一般則は削除、プロジェクト固有(chat-recorder フラグ、metatron CLI、agent-policy roles 三点同期)だけ残す。手作業または新 synthesizer で再蒸留。

**D. 現状維持 + 設定だけ**(非推奨)
- `benign_exit1_commands` に lint/test を追加、`distill_threshold` を上げる。層 2 が残る。

## 確認したいこと

1. A+B 一体で進める方針で良いか。B の frontmatter 契約変更(stats 分離)まで踏み込むか。
2. 次段の成果物は規律どおり: context-map(探索統括帯)→ 設計書・実装計画書(system-planner)→ Haiku レビュー → /goal 用プロンプト。この順で進めてよいか。
3. 既存抗体 56 件の棚卸し(C)は今回スコープに含めるか、別作業か。

上記 3 点の回答待ち。

記録完了。ユーザー回答待ち(上記 3 点)。

# phyllis998

> Bについて、Metatronno

> Bについて、MetatronのGOTCHASとの棲み分けはどうなりますか？

# AI

重要 発見。metatron 側の棲み分け規定は、私の B 案と**逆**。

## 現行の棲み分け(metatron `gotchas-format.md`)

- 判定軸: 「別リポジトリへ持っていっても成立するか」
- 成立する(一般則)→ **Raphael 抗体**
- そのリポジトリ限定 → **GOTCHAS**
- 昇格先はスキル/Hook。GOTCHAS → 抗体の昇格は禁止。

つまり現行設計では、`git は -- で分離`、`biome は import 順を直す` のような一般則こそ Raphael の担当。私が「一般則を抗体化するのが問題」と書いた B は、この棲み分けを壊す。訂正。

さらに事実: このリポジトリの GOTCHAS は**未作成**(`not_created`)。契機を持つ呼び出し元(codiel run 等)が動いていないため、プロジェクト固有の失敗は記録先がなく、raphael にも一般則しか残らない構造。`ab-2026-0907-001`(roles/policies/test 三点同期)や chat-recorder フラグの抗体は本来 GOTCHAS 側。

## B の再定義

問題の核は「一般則を抗体化すること」ではなく、**「一般則の抗体を、失敗の文脈と無関係に広い正規表現で撒くこと」**。棲み分けは維持し、B を次に絞る。

- **B1. trigger 精度**: 一般則の抗体は「失敗を再現しうる形」に一致させる。`pnpm.*lint` ではなく、lint 失敗の直後の再実行や、対象ファイルの Edit に限定。CLI 側で広さ検査(直近コマンド履歴への一致率上限)。
- **B2. 効果フィードバック**: 発火後の同 fingerprint 失敗を `misses` として計測。misses 高い抗体は失効候補。
- **B3. 振り分け**: synthesizer に metatron と同じ 1 問(「別リポジトリで成立するか」)を持たせ、No のものは抗体化せず「GOTCHAS 候補」として報告に載せる。raphael は他プラグイン名を書けない規約 → 「プロジェクト固有の失敗は抗体にせず報告に残す」と書き、接続はこのリポジトリの CLAUDE.md 側で行う。
- **B4. stats 分離**(dirty 対策)は棲み分けと無関係。単独で判断可。

## 判断軸

- 一般則 vs 固有 → 既存規定を維持(変更しない)
- 注入の適合率 → B1/B2 で改善
- 固有失敗の受け皿 → B3 + GOTCHAS 台帳の初回作成(このリポジトリの運用課題、raphael 改修外)

## 確認

1. 棲み分けは現行維持で B1〜B3 に絞る、で良いか。
2. B3 の「GOTCHAS 候補の報告」を raphael スコープに含めるか、synthesizer は一般則以外を黙って非採用にするだけにするか。
3. 前回の質問 3 点(A+B 一体・成果物の順序・既存抗体の棚卸し)も併せて回答願う。

回答待ち(棲み分け 2 点 + 前回 3 点)。

## セッション 3: Raphael 抗体と GOTCHAS の棲み分けを確認、B 案を B1-B4 に精密化

# AI

記録完了。回答待ち。

# phyllis998

> 1. それでよい
> 2. スコープに含めない
> 3. A+B+C

# AI

確定要件固定 → 探索統括帯(system-planner)へ context-map 作成を dispatch。

context-map 作成中(system-planner 実行中)。完了通知後、§未解決事項を判断し設計書へ進む。

context-map 作成中。完了通知待ち。

## セッション 4: 未解決 7 件(N1-N7)を影響度別に分析し判断軸を提示

# AI

記録完了。context-map 作成継続中。

context-map 完成。未解決 14 件を裁定し、設計書・実装計画書の執筆を dispatch。

裁定の要点:
- 再発キー `recurrence_key` 新設(eventSeq 抜き)。既存 fingerprint 不変。
- B2 突合せ = 抗体 id × recurrence_key、30 分窓。
- benign 拡張はテスト/lint/型検査ランナーの一般 prefix。exit ≥128 は失敗扱いしない。可逆。
- 広さ検査は CLI の create/patch のみ。一致率 30% 超で拒否。
- ineffective = fired≥10 かつ misses/fired≥0.5。自動失効なし、review 先頭へ。
- confirmed は review で格下げ可。
- stats は `.raphael/stats.json` へ。`migrate-stats` と `audit` を CLI 新設。棚卸しは決定的スクリプト。
- 版 0.2.0-dev。

完了後、Haiku レビュー → 独立レビュー(grok-docs-reviewer)→ 採否判断 → ユーザー提示。

N1〜N4 は妥当。採用。Haiku レビューと独立レビューを並列 dispatch。

設計書・実装計画書 完成。Haiku レビューと独立レビュー(grok)を並列実行中。両方の結果を突き合わせて採否判断後、ユーザーへ提示。

Haiku レビュー受領。独立レビュー待ち。両方揃ってから採否判断。

独立レビューの指摘 #1〜#6 は実データ検証済みで重い。設計の前提 2 点(母集団・fingerprint)が崩れている。裁定を改めて修正 dispatch。

両レビュー突き合わせ完了 → 改訂 dispatch 中。

採否の要点:
- **独立レビューの High 6 件を全採用**。設計前提 2 点が実データで崩れていた。fingerprint は既に同一失敗で同値(催促の実因は件数集計と session 単位 digest)。広さ検査の母集団は失敗コマンドでは足りず、実行された全コマンド履歴(`commands.jsonl` 新設)が必要。benign 接頭辞比較は `cd … &&` `pnpm --dir` `TZ=…` を落とさない → 正規化を強化。exit ≥128 は 130/137/143 のみに絞る。
- **移行は 1 コミットへ統合、並列グループ廃止、Stop/inoculate のフェイルオープン明文化。**
- **Haiku 指摘は曖昧箇所の明確化として反映**(merge 規則、破損定義、audit 並び順、問 2 の判定基準)。
- 不採用: Haiku 4.2(母集団 2,000 件切り詰めの精度)は R2 で母集団自体を差し替えたため解消。

改訂完了後、再レビューは行わず私が差分を確認してユーザーへ提示。

補足 2(retry-loop の kind ラベル)は懸念あり。確認。

文書確認済。/goal 用プロンプトを作成。

成果物 4 点 完成。ユーザー承認待ち。

## 成果物

- context-map: `.claude/context-maps/2026-09-08-raphael-antibody-quality.md`
- 設計書: `harness-docs/design/2026-09-08-raphael-antibody-quality-design.md`(約 90KB)
- 実装計画書: `harness-docs/plans/2026-09-08-raphael-antibody-quality-implementation.md`(13 ステップ直列)
- /goal 用プロンプト: `docs/prompts/2026-09-08-raphael-antibody-quality-implementation-prompt.md`

## レビューで設計前提が 2 点崩れ、改訂済み

- **fingerprint は原因でなかった。** 実データ 178 件は全件 tool_use_id あり → 同一失敗は既に同一 fingerprint。催促の実因は「件数集計」と「session 単位の nag digest」。再発キーは保存せず読み取り時の純関数へ変更。
- **広さ検査の母集団は失敗コマンドでは測れない。** `&&.*[|;]` の一致率は失敗集合で約 10%。注入は全 Bash に起きる → `.raphael/commands.jsonl`(全実行コマンド履歴、gitignore)を新設し母集団にする。
- 他: benign 判定に正規化 5 段(環境変数除去・`&&` 末尾セグメント・`pnpm --dir/-C/exec/run` 読み飛ばし・basename 比較)、exit ≥128 は 130/137/143 のみ、移行を 1 コミットへ統合、並列廃止、Stop/inoculate のフェイルオープン明文化。

## 最終設計の骨子

- A0 commands.jsonl / A1 benign 拡張(可逆)/ A2 自己解決 / A3 閾値を再発キー種類数へ・nag をプロジェクト単位へ
- B1 広さ検査(create/patch のみ、30% 超で拒否)/ B2 misses と ineffective(自動失効なし)/ B3 synthesizer 二問 / B4 stats を `.raphael/stats.json` へ + `migrate-stats`
- C `audit` operation(noisy × ineffective → keep/narrow/expire)+ review 導線
- 版 0.2.0-dev

## 確認

1. 設計書・計画書を読み承認するか(私の Approve はユーザー承認後)。
2. 未解決 N3(広さ検査は Bash/`*` のみ、Edit/Write 非対象)、N4(130/137/143 に無効化スイッチなし)、N7(2,000 行 / 50 件は設計値)を許容するか。
3. 承認後、新セッションで上記プロンプトを /goal に渡して実装。

# phyllis998

> 未解決事項について解説してください

# AI

設計書 §12 の未解決 6 件(N5 は解消済み)。いずれも「裁定の文言」と「実装で取った形」の差分。着手を止める性質のものなし。

## N1: 再発キーの射影(影響 低)

- **裁定**: `sha256(kind + "\0" + normalizedTarget)`。
- **問題**: command-failure 以外 3 kind は normalizedTarget が可変値含む。retry-loop は exit code 列、edit-churn は各編集の ts、user-rejection は prompt 抜粋 → 同じ失敗でも毎回別キー → 種類数で数えられない。
- **取った形**: kind ごと安定射影。command-failure と retry-loop は `normalized_command`(kind ラベルも `command-failure` に統一 → 同一コマンドの両 record が 1 種類)、edit-churn は `file_path`、user-rejection は `matched_pattern`。
- **なぜ低**: R1 で保存フィールドでなくなり JSONL 互換に影響なし。実データ 99% は command-failure で裁定式と完全一致。

## N2: error code の表記(影響 低)

- 裁定 `pattern_too_broad` → 既存 CLI は全て大文字スネーク(`VALIDATION_ERROR` 等)→ `PATTERN_TOO_BROAD`。表記統一のみ。

## N3: 広さ検査は Bash / `*` のみ(影響 中)

- **理由**: 母集団が `commands.jsonl` のコマンド列。Edit/Write の trigger は編集テキストに一致させるため、コマンド列で広さを測れない。
- **残る穴**: Edit/Write 向け抗体は広さ無検査。現在 56 件は全て Bash → 実害なし。将来 Edit/Write 抗体が増えたら、編集テキスト履歴の母集団を別途設計。
- **許容判断の軸**: 今 Edit/Write 抗体を作る予定があるか。無ければ許容。

## N4: シグナル終了に無効化スイッチなし(影響 低)

- 130(SIGINT)/137(SIGKILL)/143(SIGTERM)は無条件で failure から外す。`benign_exit1_extended: false` はこれに掛からない。
- **理由**: ユーザー中断や timeout kill は AI の失敗でない。R3 で 128 以上一律から 3 コードに絞ったため、git fatal(128/129)は failure のまま残る。
- **許容判断の軸**: kill された事象を infection に残したい運用があるか。無ければ許容。

## N6: Serena メモリ `raphael/core`(影響 低)

- 現メモリは「stats は frontmatter」「33 件」等の旧記述。実装最終ステップで `edit_memory` 更新。作業項目であり判断不要。

## N7: 数値の根拠なし(影響 低)

- `commands.jsonl` 上限 2,000 行、母集団下限 50 件は設計時の見積り。実測裏付けなし。
- **リスク**: 同じコマンド反復で一意数が伸びず 50 未満 → 検査 skip し続ける。逆に上限 2,000 で古い履歴が消え、一致率が直近の作業に偏る。
- **対処**: 実機検証 2 で一意コマンド数を記録。config key で変更可。運用後に調整。

## まとめ

- 判断不要(作業のみ): N2, N6
- 許容確認が要る: N3(Edit/Write 抗体の予定)、N4(kill を記録したいか)、N7(数値は暫定で運用調整)
- N1 は設計上の必然。承認のみ。

承認と N3/N4/N7 の許容判断 待ち。

## セッション 5: 未解決事項 N1-N7 の詳細説明と許容判断軸

# AI

記録完了。承認と N3/N4/N7 の判断 待ち。

# phyllis998

> N3: Edit/Wrightは様子見
> N4: 特にそういった運用はない
> N7: 裏どりすることは可能ですか？

# AI

N7 裏取り可能。Claude Code のセッション transcript(`~/.claude/projects/.../*.jsonl`)に全 Bash 呼び出しが残る → 過去の実コマンド列から一意数と一致率を実測できる。探索実働帯へ委譲。

N3・N4 了承(設計変更なし)。N7 は transcript から実測中。結果で 2,000 / 50 / 30% を確定し設計書へ反映。

N7 実測 進行中。完了通知待ち。

## セッション 6: N7 実測で閾値 10% へ引き下げ、設計書第 3 版確定

# AI

記録完了。N7 実測 継続中。

実測結果: **30% は何も止めない**。最悪抗体 `ab-2026-0803-002` でも一意コマンド比 25.4%。設計値の再検討要。

一意化が原因の疑いあり(`pnpm run lint` 300 回でも 1 件扱い)。「注入される Bash 呼び出しの割合」は非一意で測るべき。追加実測。

N7 一次結果: 総 Bash 1,607 回、一意 1,514。30% 閾値は全 56 抗体を通過(最大 25.4%)。一意母集団だと反復コマンドが 1 件に潰れるため、非一意で再集計中。結果で閾値を確定。

蒸留(バックグラウンド)と N7 非一意再集計、並行実行中。両結果待ち。今回の催促自体が「調査中の意図的失敗 3 件で閾値到達」= 設計書 §1.2 問題 1 の実例。

N7 裏取り 完了。結論: **30% は安全弁として機能しない → 10% へ引き下げ**。

実測(transcript 137 セッション、Bash 1,607 回):
- 最広 `ab-2026-0803-002` でも全体比 24%(直近 500 件では 29%)。30% は何も止めない。
- 次点は 8.65%、以下 6%・5.9%・5.5%・4.4%…と急落 → 10% で最広 1 件だけを切り、正当な抗体は通る。
- 全 Bash の 43% に 1 件以上、17% に複数抗体が付く。これが「無関係注入」の実態数値。
- 失敗率 11%。母集団 1,607 > 下限 50、< 上限 2,000 → 両値は据え置き妥当。commands.jsonl はプロジェクト単位なのでセッション単位の 50 未達(12/137)は問題なし。

設計書へ反映 dispatch。

設計書へ R12(閾値 10%、2,000 / 50 据え置き、N3・N4・N7 解消)反映中。蒸留 synthesizer も並行実行中。両完了後、最終状態を報告。

蒸留完了: 3 件全て非採用(調査中の一過性失敗)。抗体変更なし。設計書の R12 反映 待ち。

176/177 の差は集計時刻の違い(調査中に infection 1 件追加)。併記で問題なし。/goal プロンプトも第 3 版と整合するよう 1 行追記。

全成果物 確定(設計書・計画書 第 3 版)。

## N7 裏取り結果 → 設計変更

- transcript 137 セッション、Bash 1,607 回を母集団に 56 抗体の一致率を実測。
- 最広 `ab-2026-0803-002` でも 24%。30% は何も止めない → **既定閾値 10% へ**(次点 8.65% で分布に谷あり。現 56 件中 55 件通過)。
- 2,000 行 / 50 件は据え置き(全履歴 1,607 で全保持可、50 は十分)。
- 定量化した実態: 全 Bash の 43% に抗体 1 件以上、17% に複数付く。失敗率 11%。

## 未解決の最終状態

- N1・N2: 設計上の必然、承認のみ
- N3・N4: ユーザー許容(設計書に注記済)
- N6: 実装最終ステップの作業
- N7: 解消(R12)

## 成果物

- context-map: `.claude/context-maps/2026-09-08-raphael-antibody-quality.md`
- 設計書 第 3 版: `harness-docs/design/2026-09-08-raphael-antibody-quality-design.md`
- 実装計画書 第 3 版: `harness-docs/plans/2026-09-08-raphael-antibody-quality-implementation.md`
- /goal プロンプト: `docs/prompts/2026-09-08-raphael-antibody-quality-implementation-prompt.md`

副産物: 途中の Stop 催促で蒸留 1 回実行 → 3 件全て非採用(調査中の一過性失敗)。設計書 §1.2 問題 1 の実例。

## 次

承認後、新セッションで上記プロンプトを `/goal` へ。コミットは指示があれば行う(現状 未コミット: 上記 4 ファイル + 会話記録)。

# phyllis998

> コミットしてください

# AI

今回の成果物 4 点 + context-map のみコミット。settings.json・cliproxy・過去の会話記録・抗体 stats は無関係 → 対象外。

コミット完了: `2108a5b` (3 ファイル、+1,354 行)。

注記:
- 初回 `git add` は `.claude/context-maps/` が gitignore 対象で失敗 → context-map を外して再コミット。context-map はローカルのみ(実装セッションはパス参照で読める)。
- `.raphael/antibodies/`(stats 更新の dirty 28 件)、`.claude/settings.json`、`cliproxyapi.config.example.yaml`、会話記録、過去 2 件の prompts は今回と無関係 → 未コミットのまま。
- git 警告: `.git/gc.log` 残存で自動 gc 停止中。`git prune` 推奨(本作業と無関係)。

次: 新セッションで `docs/prompts/2026-09-08-raphael-antibody-quality-implementation-prompt.md` を `/goal` へ。

作業完了。コミット `2108a5b`。次は新セッションで /goal。
