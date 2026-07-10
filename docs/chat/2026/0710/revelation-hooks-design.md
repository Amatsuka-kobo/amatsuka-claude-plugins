# Revelation プラグイン フック層設計

- 日付: 2026-07-10
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `plugins/revelation/docs/DESIGN.md`(コミット `0e47f97`)、`docs/superpowers/plans/2026-07-10-revelation-hooks.md`(コミット `207f7f2`)、feat/revelation-hooks ブランチ（コミット `d59c940` / `5fe2da6` / `ecee165` / `ad4b9b9` / `e24d414`）、main @ `e24d414`（マージ完了）
- 前提: `plugins/revelation/README.md`(既知の制約)、`plugins/revelation/skills/*/SKILL.md`(スキル定義)、`plugins/codiel/hooks/hooks.json`、`plugins/task-utility/hooks/hooks.json`、`plugins/revelation/docs/DESIGN.md`(§4/§6)、`.superpowers/sdd/progress.md`(開発台帳)

---

## セッション1: 下位モデルの規律低下への対策検討

# phyllis998

> 下位モデルでrevelationプラグインが適切に使われていない問題が発生しています。対策を考えてください。

# AI

brainstorming スキルに従い、対策検討を開始。

**調査フェーズ**:

1. **revelation プラグインの現状確認**
   - README.md から既知の制約を確認：下位モデル(Sonnet/Haiku)では pull 型(モデルの自発 invoke)に依存しており、「読んだ気」になって invoke しなくなる逆効果が生じる
   - スキル定義確認：`fable-method`・`fable-restraint`・`fable-subagents` が存在
   - フック設定確認：`plugins/codiel/hooks/hooks.json` と `plugins/task-utility/hooks/hooks.json` にはフック定義あり、但し revelation にはなし

2. **失敗形の確認**：実装可能な対策を検討するため、ユーザーに対して「下位モデルで具体的にどの場面で invoke されないか」「スキル本体(SKILL.md)の修正は許容か」という2つの質問を実施。

3. **意思決定プロセス**：ユーザーの回答から、以下3案を提示。
   - 案1：スキル本体を下位モデル向けに書き直す(SKILL.md の分岐版を追加)
   - 案2：フック層(hooks/)を追加し、SessionStart で「トリガー表」を注入 + PreToolUse でゲーション
   - 案3(ハイブリッド)：案2をベースに、スキル本体との二重管理を避ける設計

ユーザーは案3(ハイブリッド)を選択。

---

## セッション2: 設計案の詳細提示

# AI

案3に基づき、フック層設計案を詳述。

**全体像** — revelation プラグインに `hooks/` を追加し、スキル本体(SKILL.md)は変更しない。pull 型(モデルの自発 invoke)の上に、2層の push/enforcement を重ねる。

**第1層: SessionStart トリガー表注入**

- `hooks/hooks.json` に SessionStart フックを追加し、`hooks/scripts/inject-trigger-map.mjs` が `hooks/trigger-map.md`(約10行)を additionalContext として注入。
- 内容はチートシート全文ではなく**トリガー表のみ**：「複数ステップのタスクに着手する前 → `revelation:fable-method` を invoke」「コード変更・git 操作・テスト失敗・ユーザーからの指摘 → `revelation:fable-restraint`」「サブエージェント起動前 → `revelation:fable-subagents`」+「該当したら応答前に必ず invoke せよ」という強い指示文。
- 注入量を絞る理由：チートシート全文を注入するとスキル本体との二重管理になり、また「読んだ気」になって invoke しなくなる逆効果を避けるため。表は「いつ・どれを」だけを教え、中身はスキル invoke で取らせる。

**第2層: PreToolUse リマインド(1回だけの差し戻し)**

- matcher `Edit|Write` → `fable-restraint` 未読なら差し戻し。matcher `Agent`(または Task)→ `fable-subagents` 未読なら差し戻し。
- `hooks/scripts/remind-skill.mjs` が transcript を grep して該当スキルの invoke 履歴を確認。未読なら deny + 「先に `revelation:fable-restraint` を invoke してから再試行せよ」という理由を返す。**セッションごと・スキルごとに最大1回**(scratchpad 側にマーカーファイルを置いてループを防止)。既読なら素通し。
- `fable-method` は「着手前」に対応する自然なツールゲートがないため第2層では扱わず、第1層のトリガー表に任せる(妥協点。TodoWrite をゲートにする案もあるが、TODO を書かないまま着手するケースを拾えないため過剰な複雑化と判断)。
- codiel の `guard-*.mjs` と同じ command フック構造なので、リポジトリの既存パターンに沿う。テストも既存の `node --test plugins/*/scripts/*.test.mjs` 方式に載せられる。

**エラー処理・エッジケース**:

- transcript が読めない/形式が想定外 → **素通し**(フェイルオープン)。規律の補助でユーザーの作業を止めない。
- 上位モデル(Fable/Opus)セッションでも発火するが、トリガー表10行は無害、差し戻しも1回だけなので許容(フック入力からモデル名を確実に取れないため、モデル判別は将来課題として README に記載)。
- サブエージェントにも PreToolUse は効くため、第2層はサブエージェント内の無規律も部分的にカバーする。

**検証方法**:

- フックスクリプトは `node --test` のユニットテスト(transcript フィクスチャを与えて deny/allow 判定を確認)。
- 実機確認は Sonnet/Haiku セッションを起動し、(1) セッション冒頭にトリガー表が注入される、(2) スキル未読のまま Edit すると1回差し戻される、(3) invoke 後は素通り、を観測。

**保存先の確認**: 設計ドキュメントの保存先は、brainstorming スキルのデフォルト(`docs/superpowers/specs/`)ではなく、リポジトリの慣例に合わせて `plugins/revelation/docs/DESIGN-hooks.md` を提案。

---

## セッション3: 設計ドキュメント作成・コミット

# phyllis998

> 設計ドキュメントの保存先はplugins/revelation/docs/DESIGN.mdでお願いします。

# AI

保存先を `plugins/revelation/docs/DESIGN.md` に変更し、設計ドキュメントを作成してコミット。

セルフレビュー(プレースホルダ・矛盾・曖昧さ)を実施 — 問題なし。

**成果物**: `plugins/revelation/docs/DESIGN.md` (コミット `0e47f97`)

**記録内容**:
- ハイブリッド設計案全体(第1層 SessionStart トリガー表注入 + 第2層 PreToolUse リマインド)
- 検討した代替案3案を却下理由つきで記載
- モデル判別による出し分けを将来課題として明記

---

## セッション4: 実装計画の作成と実装実行

# phyllis998

> 実装計画に進んでください

# AI

スペック承認を受け、writing-plans スキルで実装計画を作成。

**実装計画の作成**:

- `docs/superpowers/plans/2026-07-10-revelation-hooks.md` に詳細計画を記載し、コミット `207f7f2`。
- Task 1〜4 の内訳：
  1. `lib.mjs` + `lib.test.mjs` — transcript 読み込み・スキル invoke 履歴 grep などの共通ユーティリティ(TDD で実装)
  2. `trigger-map.md` + `inject-trigger-map.mjs` — SessionStart フック層
  3. `remind-skill.mjs` — PreToolUse リマインド層
  4. `hooks.json` + `README.md` + ルート `CLAUDE.md` — フック設定・ドキュメント・設定反映

**サブエージェント駆動開発の選択と実行**:

- `feat/revelation-hooks` ブランチを作成し、subagent-driven-development スキルで Task 1〜4 を並行実行。
- 各タスクは実装者(Sonnet) → タスクレビュアー(Sonnet) → 承認の流れで進行。
- Task 1(lib.mjs)：TDD で実装、テスト 5/5 pass で承認(コミット `d59c940`)。
- Task 2(トリガー表注入)：inject-trigger-map.mjs とテスト実装、spec・quality 両面で承認(コミット `5fe2da6`)。
- Task 3(PreToolUse リマインド)：remind-skill.mjs とテスト実装、spec・quality 両面で承認(コミット `ecee165`)。
- Task 4(設定・ドキュメント)：hooks.json / README.md / CLAUDE.md 反映、spec・quality 両面で承認(コミット `ad4b9b9`)。

**最終ブランチレビューと修正**:

- 最上位モデル(Fable)による最終ブランチレビューを実施。全差分を review-package スキルで生成し精査。

**発見された指摘**:

- **Critical 1件(欠陥)**: `emit("allow")` を使用しており、これは Claude Code の許可システムをバイパスして Edit/Write/Agent を自動承認にしてしまう欠陥。計画時点の誤設計。「allow 時は無出力」に修正する必要があり、これにより素通し(設計で意図した動作)を実現。
- **Important 1件(文言)**: Skill なしサブエージェント(Task 実行者)への deny 文言がなかった。「先に `revelation:fable-restraint` を invoke してから再試行せよ」という誘導文言を追記する必要あり。

**修正コミット `e24d414`**:

- `emit("allow")` を削除し、allow 時は無出力にする実装に統一。
- deny 文言を `remind-skill.mjs` に追記。
- DESIGN.md に § 4(実装上の注意・バイパスの防止方法)を追記。
- テスト追加(ユニットテスト 14/14 pass + 既存 32/32 pass)。

**再レビュー中**: 修正内容の再評価が進行中。

**フォローアップ指摘**: レビュアーが指摘として「codiel の `guard-write.mjs` / `guard-bash.mjs` にも同型の `emit("allow")` バイパスが既存である」と記載。本ブランチの範囲外だが、マージ後に対応要否を検討する価値あり。

---

## セッション5: 最終レビュー・マージ・Fable自身による hooks 参照の問題検討

# AI

再レビュー完了 — **Ready to merge: Yes**(Critical/Important とも解消を独立実行で確認、退行なし)。

**マージ実行**:

- `feat/revelation-hooks` ブランチを `main` に fast-forward マージ(main @ `e24d414`)。
- マージ後全テスト実行: 46/46 pass。
- feature ブランチ削除済み。
- .superpowers/sdd/progress.md 更新済み。

---

# phyllis998

> codielへのフォローバックをサブエージェントに委譲し、修正お願いします。
> 並行して答えていただきたい質問が、このRevelationプラグインをFable自身が使うことは想定していません。Hooksを入れることによって、Fable自身がこれを見てしまうことはありませんか?

# AI

codiel の修正をバックグラウンドのサブエージェントに委譲。並行して Fable 自身がフック層を見てしまう可能性についての質問に回答。

**回答: はい、現状は Fable 自身にも見えます。**

**第1層(SessionStart トリガー表)の影響**:

- モデルを問わず全セッションに約10行が注入される(設計上の許容)。
- 問題は量よりも文言。トリガー表は「該当したら必ず Skill ツールで invoke せよ」と強く書かれているため、素直に従う Fable が本来不要な revelation スキルを invoke してしまう可能性あり。
- 実害はスキル1本分のコンテキスト消費程度だが、無駄になる。

**第2層(PreToolUse 差し戻し)の影響**:

- Fable のセッションでも、スキル未読のまま最初の Edit/Write / Agent を行うと1回 deny される。
- マーカーにより1セッション1スキル1回限りだが、毎セッション発生する(Fable は律儀にスキルを invoke してから再試行)。

**当時モデル判別を見送った理由**:

- 設計時点で、フックの stdin 入力にモデル名が含まれないと判断した(DESIGN.md §6 の将来課題)。

**裏取りとしての新発見**:

- transcript の assistant メッセージに `"model":"claude-fable-5"` が記録されていることを確認(このセッションの transcript で検証済み)。
- PreToolUse が発火する時点では assistant メッセージが必ず存在するため、第2層は transcript から直近のモデル ID を読み、上位モデル(fable/opus)なら差し戻し自体をスキップ可能。
- `remind-skill.mjs` は既に transcript を開いているので追加コストはほぼゼロ。

**第1層の緩和方法**:

- 新規セッション開始時点では transcript に assistant メッセージが未生成のため、確実なモデル判別ができない。
- 現実的な緩和: トリガー表に「これは下位モデル向けの規律であり、Fable/Opus 等の上位モデルはこの表に従う必要はない」と1行足す(注入は残るが誤 follow を防ぐ)。

**提案**: ①第2層のモデル判別スキップ(transcript の model フィールド利用)+ ②トリガー表への上位モデル除外文の追記をセットで実装。いずれも小さい変更で、既存のテストパターンに載せられる。

**codiel の修正状況**:

- `guard-write.mjs` / `guard-bash.mjs` の許可バイパス修正は、ご指示どおりサブエージェントに委譲。
- ブランチ: `fix/codiel-pretooluse-pass`。
- サブエージェント作業中。完了後に私(Fable)がレビューしてからマージ予定。

---

注意事項: main へのマージ完了(e24d414、テスト 46/46 pass)。Fable が hooks 層を見てしまう問題への対応案(第2層モデル判別スキップ + トリガー表上位モデル除外文)の実装要否について、ユーザー回答待ち段階。codiel 修正は fix/codiel-pretooluse-pass ブランチでサブエージェント作業中。origin への push はまだ未実施(main はローカルで 7 コミット先行)。
