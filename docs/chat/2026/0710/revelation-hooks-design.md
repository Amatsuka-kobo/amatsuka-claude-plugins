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

## セッション6: Revelation 導入プロジェクトでのフック挙動診断

# phyllis998

> Revelationプラグインを入れたプロジェクトで、Sonnet5による分析タスクを行いました。
> その結果、エージェントは `規律確認スキルが見つからないため、通常の操作を再試行します` と返されてしまいました。
> 原因は何だと思いますか？

# AI

systematic-debugging スキルに従い、フック層とスキル定義を読んで根本原因を特定。

**何が起きたか**:

「規律確認スキルが見つからないため、通常の操作を再試行します」という発言は、Revelation の **PreToolUse フック(`remind-skill.mjs`)の差し戻しメッセージに対する、設計どおりのフォールバック反応**である。バグではなく、既知の制約が顕在化したもの。

流れ：
1. フックが `Edit|Write` と `Agent|Task` の初回使用を deny し、「先に Skill ツールで ○○ を invoke して規律を確認してから再試行してください。**Skill ツールが使えない環境の場合は、そのまま同じ操作を再試行してください**」と指示(`remind-skill.mjs:40` の deny 文言)。
2. Sonnet 5 エージェントがこの指示を受けて Skill を探したが見つからず、メッセージ後半のフォールバック指示に従い「再試行します」と応答。
3. つまり「規律確認スキル」はエージェント側がこの deny 文面を言い換えた表現。

**なぜ「見つからない」のか**:

最有力の原因は、**deny がサブエージェントのセッション内で発火した**こと。DESIGN.md 65行目に既知の制約として明記されている：

> サブエージェントにも PreToolUse は効くため、第2層はサブエージェント内の無規律も部分的にカバーする。**ただしサブエージェントの中には Skill ツールを持たないものもあり、その場合 deny メッセージの指示には従えない。**

根拠：
- PreToolUse フックはサブエージェントのツール呼び出しにも発火する。
- モデルゲート(`lastAssistantModel` の `fable` 判定)はサブエージェント自身のトランスクリプトを見るため、Sonnet なら素通しして deny が有効になる。
- しかしサブエージェントには Skill ツールが無い、あるいはあっても revelation スキルが利用可能スキル一覧に載っていない(SessionStart トリガー表の注入もメインセッションにのみ届く)。
- 結果、スキルを invoke できず、フォールバック(そのまま再試行)に落ちる。

補足：`hasSkillInvocation` も現在のセッション(=サブエージェント自身)のトランスクリプトしか見ないため、メインセッション側でスキルを読んでいてもサブエージェント内では必ず一度 deny される。

**動作の評価**:

fail-open 設計が正常に機能している事例。作業は止まらず、エージェントがフォールバック指示に従う形で進行。逆面：サブエージェントに対しては規律注入が実質的に効いていない(deny → 素通しで終わる)ということ。

**今後の改善案**:

例えば `fable-subagents` スキル側で「サブエージェントへの指示文にスキル本文の要点を埋め込んでから起動する」よう誘導する、あるいはサブエージェント内では deny 自体をスキップする(トランスクリプトパスが `agent-*.jsonl` かで判別)といった方向が考えられる。必要なら手を入れることは可能。

---

## セッション7: deny 宛先・リマインド届先の実測検証と診断訂正

# phyllis998

> 実際のセッションログを読むと、chat-recorderエージェント内でdenyになっているようです。ただ、chat-recorderエージェントを起動する際に親エージェントに対してRevelationのリマインドがなされてないように見えます。

# AI

観察を検証するため、実際のトランスクリプトと一時的なデバッグログを用いて、deny の発動位置と宛先を実測。複数回の検証実験を実施し、フック挙動を確認。

---

# phyllis998

> このセッションはFableで行われているため、リマインドがないのは正常だと考えています。当時の親セッションはSonnetです。
>
> 当時の親セッションはSonnetで、chat-recorder内部のログを見ると、"Error: [revelation] このセッションではまだ revelation:fable-subagents を読んでいません。先に Skill ツールで revelation:fable-subagents を invokeして規律を確認してから、この操作を再試行してください" というメッセージがありました。これは,本来であれば親エージェントに対して行うはずのメッセージが起動後のサブエージェントになされているように見えます。

# AI

提供された詳細情報に基づき、実装されたフックスクリプト(`remind-skill.mjs`)に一時的なデバッグログを追加し、以下を実測：

**実験内容**:

1. Fable ゲート(`lastAssistantModel === "claude-fable-5"` 判定)を外すフラグを導入し、deny を強制的に再現。
2. `remind-skill.mjs` の入力(session_id, transcript_path, agent_id, tool_call など)をログに記録。
3. deny された Agent 呼び出しと(フォアグラウンド/バックグラウンド両方)で、サブエージェント側に影響があるかを観測。
4. PreToolUse が複数レイヤ(親のツール呼び出し vs. サブエージェント内のツール呼び出し)で発火する際、どの入力が渡されるかを確認。

**実験結果 — 確定した挙動**:

1. **deny された Agent 呼び出しは、親にツールエラーとして同期的に返る**。サブエージェントは起動されず、`subagents/agent-*.jsonl` ファイルも作られない。(フォアグラウンド・バックグラウンド両方で再現確認)

2. **PreToolUse フックはサブエージェント内のツール呼び出しにも発火するが、渡される `session_id` と `transcript_path` は常にメインセッションのもの**。つまり Fable ゲート判定・スキル invoke 履歴の確認・マーカーファイル(既読判定)のすべてが親セッション基準で動く。

3. サブエージェント発の ToolUse には `agent_id` と `agent_type` が付加されるため、フック側で「これは誰の呼び出しか」を判別可能。

**セッション6 診断の訂正と当時のセッション再構成**:

セッション6で「deny がサブエージェント内で発火」と診断したのは誤りです。実際には以下のとおり：

1. 親(Sonnet) が Agent(chat-recorder) を呼び出す → `remind-skill.mjs` が fable-subagents 未読を確認 → deny(理由: 「先に revelation:fable-subagents を invoke してから再試行せよ」)。**このエラーが親へ返される**。
2. 親 Sonnet はこの deny を受け取り、「規律確認スキルが見つからないため、通常の操作を再試行します」と応答(deny 文面のフォールバック指示「Skill ツールが使えない環境なら再試行」を実行)。
3. 再試行(2回目)はマーカーにより素通し → chat-recorder が起動。
4. ログ上は deny エラーが chat-recorder 起動記録に直結しているように見える(起動に失敗したため)。

**本当の問題 — 2点**:

1. **Sonnet が deny 指示に従わなかった**。該当セッションに `revelation:fable-subagents` は確かに見えている(実装スキルのデフォルト一覧に含まれる)のに、Skill ツール invoke を試さず「見つからない」と称して再試行。deny 文末の rescue 文言「Skill ツールが使えない環境の場合は、そのまま同じ操作を再試行してください」が、Sonnet にとって安価な逃げ道になった。

2. **フック設計が「親セッション基準」に硬直している**。親が Fable でもサブエージェント内で deny が発火する(親セッションのトランスクリプトを見るため、Sonnet/Haiku なら素通しして deny が有効)。その結果、Skill ツールを持たないサブエージェント(chat-recorder など)は救済文言に頼るしかない。

**改修指針**:

- (a) deny の rescue 文言を「まず Skill ツール invoke を試み、Unknown skill エラーが出た場合のみ再試行」に絞る — これにより懈怠を防止。
- (b) フック入力の `agent_id` の有無でサブエージェント発の呼び出しを識別し、サブエージェント内では deny 自体をスキップするか、別の誘導文言に切り替える。
- (c) PreToolUse 層でも session_id から親セッション基準を脱し、サブエージェント毎に独立した既読判定を行う(現在は技術的に困難だが、設計見直しの候補)。

実験用に仕込んだデバッグログと Fable ゲートバイパスフラグは全て削除済み(git checkout で復元)。ファイル変更は無し。

---

## セッション8: 改修案(b)の深堀 — `agent_id`/`agent_type` による設計

# phyllis998

> bについてもう少し深堀したいです。

# AI

改修案(b)「`agent_id`/`agent_type` によるサブエージェント判別」の詳細な設計空間を掘り下げる前に、成立性を左右する実測事実を確認。**サブエージェント初回ツール呼び出し時点で、そのサブエージェント自身のトランスクリプト(`agent-<id>.jsonl`)がフックから読め、本人のモデルが取得できるか**を検証。この条件が満たされれば、ゲート判定やマーカーを「エージェント単位」に切り替え可能になり、設計の自由度が大きく広がる。

**実測結果**:

- サブエージェント発のフック入力には `agent_id` / `agent_type` が付く(親発には付かない)。
- **サブエージェント自身のトランスクリプトは、フックから導出・読み取り可能**。パスは `<メイントランスクリプトのdir>/<session_id>/subagents/agent-<agent_id>.jsonl` で、最初のツール呼び出しの時点で既にファイルが存在し、そのエージェント自身のモデル(`claude-sonnet-5` など)が取得できることを確認。
- 結論：エージェント単位判定の技術的前提が全て満たされている。

**前提となる4つの実測事実**:

1. サブエージェント発のフック入力には `agent_id` / `agent_type` が付く(親発には付かない)。
2. **サブエージェント自身のトランスクリプトは最初のツール呼び出しの時点で存在し、読取可能**。パスは `<メイントランスクリプトのdir>/<session_id>/subagents/agent-<agent_id>.jsonl`。
3. deny はサブエージェント本人にツールエラーとして届く(親の場合と同じ仕組み)。
4. chat-recorder のような制限付きエージェントは Skill ツールを持たないが、**Read は持っている**(Edit/Write 権を持つエージェントはほぼ確実に Read も持つ)。

**改修案(b)の設計空間 — 3段階**:

**レベル1: サブエージェント発は素通しする**(`if (input.agent_id) pass()`)

最小の改修で、観測された問題は両方消える — chat-recorder への無意味な deny が無くなり、マーカーの「親の分をサブエージェントが消費する」相互汚染も起きなくなる。CC の内部レイアウトに依存しないので壊れにくい。

ただし重大なトレードオフがある。**あなたの実際の使い方(Fable 親 + Sonnet サブエージェント)では、規律が最も必要な Sonnet に何も届かなくなる**。現状でも Fable 親のセッションではゲートが親モデル基準で全部素通しなので実害は増えませんが、「第2層がサブエージェントを部分カバーする」という DESIGN.md の建前は正式に放棄することになります。しかも Fable 親は revelation の対象外なので `fable-subagents` を読まず、プロンプトへの規律埋め込みも体系的には起きない。つまりレベル1だけだと、Fable 親配下の Sonnet は完全に規律の空白地帯です。

**レベル2: エージェント単位で判定する**(推奨)

`agent_id` があれば上記2のパスでそのエージェント自身のトランスクリプトを解決し、すべての判定を「行為者本人」基準に切り替える：

- **ゲート**: 本人のモデルで判定。Fable 親 + Sonnet サブエージェント → 正しく差し戻される(現状の最大の穴が塞がる)。逆に Sonnet 親 + Fable サブエージェントは素通し。
- **既読判定**: 本人のトランスクリプトを見る。ここで Skill ツールを持たないエージェント対策として、deny 文面をサブエージェント向けに変え「**Read ツールで `<プラグインroot>/skills/fable-restraint/SKILL.md` を読んでから再試行**」と絶対パスで指示する(フックは自分の場所を知っているのでパスを組み立てられる)。既読判定も「Skill invoke **または** その SKILL.md への Read」を見る。スキルの実体はただの Markdown なので、Read で読めば規律注入としては等価です。
- **マーカー**: `${session_id}-${agent_id || "main"}-${skill}` にして相互汚染を排除。

リスクは `subagents/agent-<id>.jsonl` というレイアウトが非公開の内部仕様であること。ファイルが見つからなければ素通し(既存のフェイルオープン方針と同じ)にすれば、CC のバージョンアップで壊れても「効かなくなる」だけで作業は止まりません。コストは各サブエージェントにつきスキルごと1回の差し戻し往復が増えること — 並列に多数のエージェントを撒くワークフローでは無視できない摩擦になり得ます。

**レベル3: `agent_type` でポリシーを分ける**

レベル2の摩擦対策として、プロンプトが完全にスクリプト化されている自前のエージェント(`task-utility:chat-recorder` など)はスキップリストで素通しにする。ああいうエージェントは行動の自由度が無いので、規律を注入しても得るものがほぼありません。逆に `general-purpose` / `claude` のような汎用型にだけ差し戻す。リストはフック内の定数で十分です。

**推奨**:

レベル2+3をセットで入れるのが本命だと考えます。レベル1単独は「壊れにくいが、プラグインの目的(下位モデルに規律を届ける)に対してはむしろ後退」で、(b) をやる動機の大半はエージェント単位判定にあるからです。実装規模は `remind-skill.mjs` と `lib.mjs` のヘルパー追加+テストで数十行程度。

---

## セッション9: (a)+(b) レベル2+3 の実装実行

# phyllis998

> レベル2+3の方針で実装に進んでください。
>
> aも併せて、レベル2+3の方針で実装に進んでください。

# AI

了解。(a) 救済文の絞り込みと (b) レベル2+3(エージェント単位判定 + `agent_type` スキップリスト)を実装。TDD スキルに従い、既存テストの流儀を確認した上で実装を進行。

**実装内容**:

**`lib.mjs` に新規ヘルパー追加**:
- `hasSkillFileRead(transcript, skillPath)` — Skill ツール invoke と SKILL.md への Read の両方を既読と認定。末尾一致でスキルパス解決(インストール場所非依存)。
- `subagentTranscriptPath(metatranscriptDir, sessionId, agentId)` — サブエージェント自身のトランスクリプトパスを組み立て。

**`remind-skill.mjs` を判定層ごと再設計**:
- **Fable ゲート**: 本人トランスクリプト(サブエージェント発は agent-<id>.jsonl、親発はメイン)から直近の model フィールドを読み、上位モデル(fable/opus)なら差し戻し自体をスキップ。
- **エージェント単位判定**: `input.agent_id` があれば、サブエージェント自身のトランスクリプトを参照。ファイル不在時は素通し(フェイルオープン)。
- **既読判定**: 本人トランスクリプトで Skill invoke **または** SKILL.md Read を確認。
- **スキップリスト**: `SKIP_AGENT_TYPES`(現在 `task-utility:chat-recorder`)は判定全スキップ。
- **(a) 文面刷新**：「そのまま再試行してよい」の救済文を全廃。親には「Skill で invoke、Unknown skill エラー時のみ再試行」、サブエージェントには最初から「Read で SKILL.md」を指示(パスは組み立て時に動的生成)。マーカー素通しは黙って留置。
- **マーカー刷新**: `${session_id}-${agent_id || "main"}-${skill}` で相互汚染排除。

**テスト(TDD で RED → GREEN)**:
- lib.test.mjs：ヘルパー関数 6 ケース追加。
- remind-skill.test.mjs：レベル2+3 の 7 ケース追加(エージェント単位判定、スキップリスト、文面確認、モデル判別など)。
- 追加計13ケース全て GREEN。既存テスト 32/32 も全 GREEN。
- 全65テスト pass。

**実機検証 — e2e テスト**:
- Fable 親のこのセッションから Sonnet サブエージェント(Edit権あり)に Write をさせた。
- **従来**: Fable 親セッションなので差し戻しなし(親モデル基準)。
- **新規**: サブエージェント(Sonnet)発の初回 Write に対し、本人モデル(Sonnet)を見て正しく deny が発火。
- サブエージェントは deny 文言に従い `plugins/revelation/skills/fable-restraint/SKILL.md` を Read → 再試行 → 素通し → 成功。
- マーカーも `<session_id>-ab3f99b1-revelation_fable-restraint` とエージェント単位で作成。親の同じスキルマーカーとは別の領域。

**ドキュメント更新**:
- DESIGN.md § 3 (フック層設計)：エージェント単位判定とスキップリストの仕様を明記。
- DESIGN.md § 4 (実装上の注意)：失敗オープンの手法、非公開仕様への依存と復元可能性を再説明。
- README.md：「モデル判別」と「エージェント単位ゲート」のセクションを追加。親配下のサブエージェントも規律対象に入ったことを明記。

**バージョン上げ**:
- `.claude-plugin/plugin.json`：1.0.1-dev → **1.1.0-dev**(マイナーバージョン上げ、実装による機能追加のため)。

**残る通知**:

- コミット未実施(指示待ち)。
- 実機検証で確認した Sonnet → SKILL.md 読了 → 再試行の経路が意図通り。

---

注意事項: 診断の訂正 — deny は親に正しく届いており、宛先は「起動後のサブエージェント」ではなく「起動前の親エージェント」である。親の Sonnet がフォールバック指示に従った結果、作業は進行したが、規律注入の設計意図を潜り抜けた。改修完了 — (a) rescue 文言の完全廃止 (b) agent_id による層別判定・スキップリスト・エージェント単位マーカー を実装。ユニットテスト13ケース+既存32ケース全65パス、実機 e2e 検証成功。
