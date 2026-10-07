# Context Map: chat-recorder 正系統化(headless 経路の廃止)+ 非同期記録

**作成日**: 2026-07-31
**作成者**: Opus(探索統括)
**対象タスク**: headless recorder(detached `claude -p`)を記録品質の理由で廃止し、chat-recorder サブエージェントを正系統に戻す。同時に (a) 記録中も会話を継続でき、(b) hook 注入テキストによるメインコンテキスト汚染を最小化する
**関連するBlueprintセクション**: `docs/design/2026-07-24-chat-recorder-performance-design.md` / `2026-07-24-chat-recorder-headless-recording-design.md` / `2026-07-25-chat-recorder-failure-fallback-design.md`(いずれも今回の方針転換で前提が反転する)

---

## 1. 目的・スコープ

- Stop フックが detached `claude -p` を起動する経路を削除し、`agents/chat-recorder.md` を唯一の記録主体にする。
- 同時に、旧方式の欠点(Agent tool の同期起動でターン終了が待たされる/ block reason 12 行がメインに注入される)を再導入しない。
- **スコープ内**: `src/hooks/check-chat-recorded.ts`、`src/chat-recording-state.ts`、`agents/chat-recorder.md`、`hooks/hooks.json`、README、テスト、`plugin.json`。
- **スコープ外**: `skills/chat/SKILL.md` の記録フォーマット契約、`prepare-chat-recording.ts` / `commit-chat-recording.ts` の入出力契約、`extract-conversation.ts`、`find-chat-records.ts`、chat-reader / chat-recall / resume。

## 2. 現在のコードベース構造

### 2.1 構成

```
plugins/task-utility/
├── hooks/hooks.json            Stop のみ(timeout 15)
├── src/
│   ├── hooks/check-chat-recorded.ts   451行 ← 改修の中心
│   ├── chat-recording-state.ts        494行 ← 状態/ロック/判定(headless 前提が多い)
│   ├── prepare-chat-recording.ts      234行 ← 両経路共有(維持)
│   ├── commit-chat-recording.ts       320行 ← 両経路共有(維持)
│   ├── extract-conversation.ts        差分抽出(維持)
│   └── find-chat-records.ts           chat-recall/resume 用(無関係)
├── scripts/*.mjs               build.ts(esbuild)によるバンドル。git 管理・要再生成
├── agents/chat-recorder.md     現在「フォールバック専用」(tools: Bash, Write / haiku)
└── skills/chat/SKILL.md        記録フォーマットの正本(headless への言及は一切なし)
```

### 2.2 重要ファイル

| ファイルパス | 役割 | 重要度 | 備考 |
|---|---|---|---|
| `plugins/task-utility/src/hooks/check-chat-recorded.ts` | Stop フック本体。走査→判定→spawn or block | High | headless 部分(L105-250, L364-438)が削除対象 |
| `plugins/task-utility/src/chat-recording-state.ts` | state/lock/plan/log パス、`scanTranscript`、`decideRecordingAction`、`isStaleLock` | High | 一部は残す。§5.3 参照 |
| `plugins/task-utility/agents/chat-recorder.md` | 記録エージェント定義 | High | description の「フォールバック専用」を正系統へ書き換え |
| `plugins/task-utility/hooks/hooks.json` | Stop 登録 + description 文言 | High | description に「バックグラウンド recorder」表記あり |
| `plugins/task-utility/README.md` L29-38 | 「会話の自動記録(Stop フック + バックグラウンド recorder)」節 | High | 節ごと書き換え |
| `plugins/task-utility/src/prepare-chat-recording.ts` / `commit-chat-recording.ts` | 記録手順の機械化。両経路共有 | High | **削除しない**。CLI 契約は維持 |
| `plugins/task-utility/skills/chat/SKILL.md` | 記録フォーマット契約 | Medium | **変更不要**(headless の記述は元々ない) |
| `src/hooks/__test__/check-chat-recorded.test.ts` (13件) | headless spawn を fixture で検証 | Medium | 半数近くが削除・書き換え対象 |
| `src/hooks/__test__/chat-recording-decision.test.ts` (8件) | 判定純関数のテスト | Medium | block/失敗カウンタ系が対象 |
| `plugins/task-utility/.claude-plugin/plugin.json` | version `0.6.4-dev` | Low | マイナー更新(0.7.0-dev 想定) |

## 3. 関連モジュール・現行データフロー

Stop フック(`check-chat-recorded.mjs`)1 プロセスで完結する:

1. stdin JSON(`cwd`/`transcript_path`/`session_id`/`stop_hook_active`)を読む。`docs/chat/` 不在なら即 return(オプトイン)。
2. `sessionKey` = session_id または transcript 絶対パスの SHA-256 先頭 24 文字。状態ルートは `~/.claude/task-utility/chat-recorder/<projectKey>/{state,locks,logs,plans,temp}`(`TASK_UTILITY_CHAT_STATE_DIR` / `CLAUDE_CONFIG_DIR` で上書き可。temp が Claude 設定ディレクトリ内になる場合は `os.tmpdir()` へ退避 = Write の sensitive file 拒否回避)。
3. `scanTranscript()` が JSONL を全行走査し `lastUserTurn` / `lastNag`(NAG_MARKER) / `toolHints`(最大 20 件)を取る。`lastNag > lastUserTurn` なら return。
4. `decideRecordingAction(scan, state, hasActiveLock)` が `noop` / `notify` / `spawn` / `block` を返す。
5. `spawn`: ロック取得(`flag:"wx"`)→ plan 書き込み → `spawn(claude, [-p, prompt, --model haiku, --settings {"disableAllHooks":true}, --strict-mcp-config, --allowedTools Bash,Write, --permission-mode acceptEdits, --add-dir…, --append-system-prompt …], {detached:true, stdio:[ignore,logFd,logFd]})` → `unref()` → exit。**フックは記録完了を待たない**。
6. recorder(別プロセスの haiku)が `prepare-chat-recording.mjs` → 本文/INDEX 1 行を temp へ Write → `commit-chat-recording.mjs` を実行。commit が追記/新規作成・INDEX 更新・検証・`recordedLine` 確定・ロック解除を原子的に行う。

### block(差し戻し)に至る 3 経路

- `consecutiveFailures >= 2`(`FALLBACK_THRESHOLD`)。判定名 `repeated-failures`。`attemptedLine` 判定より手前に置かれている(失敗試行では attemptedLine が既に進んでいるため)。
- `resolveClaudeCommand()` が `null`(claude 不在 / `TASK_UTILITY_CLAUDE_COMMAND` が不正)。
- `spawnRecorder()` が spawn に失敗。

いずれも同じ `fallbackReason()` を出す。**これがコンテキスト汚染の実体**: `check-chat-recorded.ts` L175-198、**12 行 / 約 1,200〜1,800 字**。構成は NAG_MARKER、未記録の説明、「メインで記録せず subagent へ委譲せよ」、`Agent` 起動指示、transcript 絶対パス、**prepare の完全コマンド行**、**commit の完全コマンド行**、SKILL.md 絶対パス、メタ情報の注意、追記の注意、例外条件。長さの大半は 2 本のフルコマンド文字列。`decision:"block"` の reason はトランスクリプトに `type:"user"` として残るため、記録対象会話にも混ざりうる(現状は `scanTranscript` / `extract-conversation` が `startsWith("<")` と NAG_MARKER で除外)。

block 以外の出力: `notify` 時と状態ディレクトリ作成失敗時は `systemMessage`(1 行)。それ以外は無出力。フックは常に exit 0(最上位 catch で `exitCode = 0`)。

## 4. 既存の実装パターン・規約

- **API 不使用**(CLAUDE.md 必須要件)。`claude` CLI ヘッドレスは明示的に許可されているが、今回はそれ自体を廃止する。
- **利用者ビルド不要**: `src/` 変更後 `pnpm build` でバンドルを再生成し `scripts/*.mjs` の差分もコミット。`chat-recording-state.ts` は独立エントリではなく 3 バンドルへインライン展開される(= 1 箇所の変更で 3 ファイルの生成物が変わる)。
- フックスクリプトは常に exit 0、判断は stdout の JSON で伝える。
- 行カウント契約: `split("\n")` 直後・スキップ判定前に加算。空行・パース不能行も 1 行。`scanTranscript` と `extract-conversation` で同一。
- テストは vitest、`plugins/**/__test__/*.test.ts`、`runTs()` で子プロセス実行、stdin モック。
- 判定は純関数(`decideRecordingAction` / `isStaleLock`)に切り出して単体テストする。

### 同一リポジトリの参照可能な先行事例(性能最適化の手がかり)

- `plugins/prefetch`: Agent tool を `run_in_background: true` で起動し、**UserPromptSubmit** フックで「未回収成果があるときだけ」`hookSpecificOutput.additionalContext` に**短い 1 段落**を注入して回収させる。`src/check-prefetch-manifest.ts` が実装。→ 「非同期起動 + 短い注入」の完成形が既に repo 内にある。
- `plugins/guidepost`: `src/lib/injection.ts` の `renderInjection(questions, projectDir, maxChars)` が「Stop reason と PreToolUse additionalContext の上限内に収める」ため注入文を切り詰め、全文は外部ファイルを参照させる。→ **注入テキスト長を明示的に制御する既存パターン**。
- `plugins/raphael`: PreToolUse の `additionalContext` に一致した抗体本文だけを注入(常駐指示を増やさない設計)。

## 5. 変更の影響範囲

### 5.1 直接影響を受ける箇所(削除・改修)

- `src/hooks/check-chat-recorded.ts`:
  - 削除候補: `RECORDER_SYSTEM_PROMPT`(L39-40)、`buildRecorderPrompt()`(L105-153)、`buildClaudeArgs()`(L155-173)、`resolveClaudeCommand()` + `executableOnPath()`(L63-103)、`spawnRecorder()`(L210-250)、`main()` 内の spawn 分岐(L364-438)。
  - 改修: `fallbackReason()` → 短い「chat-recorder を background 起動せよ」文へ縮小(§10)。
- `src/chat-recording-state.ts`: `FALLBACK_THRESHOLD` と `consecutiveFailures`、`isStaleLock` の pid 生存確認(`isProcessAlive` / `process.kill(pid,0)`)、`RecordingLock.pid`、`decideRecordingAction` の `block`/`spawn` アクション名。
- `agents/chat-recorder.md`: frontmatter `description` の「ヘッドレス recorder を起動できない環境で…フォールバック専用」を正系統の記述へ。本文の手順(prepare→temp Write→commit)は**そのまま使える**。`tools: Bash, Write` / `model: haiku` は要判断(§7 #4)。
- `hooks/hooks.json`: `description` の「バックグラウンド recorder で記録し、起動不能時のみ…委譲」文言。イベントを UserPromptSubmit へ移すなら構造も変わる。
- `README.md` L29-38 の節全体(L31 の `claude -p` 記述、L35 の記録セッション構成、L36 のフォールバック、L37 失敗ログ、L38 状態ディレクトリ)。
- `.claude-plugin/plugin.json`: `0.6.4-dev` → マイナー更新。
- 生成物: `scripts/check-chat-recorded.mjs`、`scripts/prepare-chat-recording.mjs`、`scripts/commit-chat-recording.mjs`(state 変更が 3 バンドルへ波及)。

### 5.2 間接的に波及する箇所

- テスト: `check-chat-recorded.test.ts` の headless 依存 8 件程度(「detached fixture を起動し attemptedLine を保存」「claude コマンド不在では block」「相対パス・引数付きコマンド差し替えを拒否」「spawn 引数は hook/MCP を止め…add-dir する」「recorder prompt は prepare/commit と限定責務を含む」「連続失敗が閾値に達したら block」「pid:null ロックの回収では失敗を数えない」)。`chat-recording-decision.test.ts` の block/失敗カウンタ系 3 件程度。
- 設計書 3 本(`2026-07-24-*` ×2、`2026-07-25-chat-recorder-failure-fallback-design.md`)は前提が反転する。旧設計が案C(バックグラウンド化)を却下→解禁と往復している経緯があるため、新設計書で経緯を接続すること。
- `docs/superpowers/specs/2026-07-22-raphael-plugin-design.md` L159 が「task-utility chat-recorder と同じ方式」で Stop 差し戻しを説明している(参照の整合)。
- `CLAUDE.md` / `CLAUDE.example.md` L22 の「chat-recorder / chat-reader 以外は docs/chat を読まない」規約 → chat-recorder が正系統になっても文言変更は不要。L10 の「claude CLI ヘッドレス実行」許可条項も他プラグイン(codiel)が依拠しているため**削除しないこと**。

### 5.3 変更を避ける・最小限に留める箇所

- `skills/chat/SKILL.md`: 記録フォーマット契約の正本。headless への言及はなく、今回の変更で触る理由がない。
- `prepare-chat-recording.ts` / `commit-chat-recording.ts`: CLI 引数(`--project/--transcript/--session-key/--attempt-id/--target-line/--body-file/--index-line-file/[--record-path]`)と JSON 出力は chat-recorder エージェントの手順が直接依存する。**state/lock/plan の attemptId・targetLine 一致検証**があるため、状態管理を削りすぎると commit が通らなくなる。
- `extract-conversation.ts` の抽出区間 `(sinceLine, targetLine]` と行カウント契約。直近 `a6e0015` で「ASSISTANT を丸ごと捨てていた」バグを修正済み(記録品質に直結。実測 22〜97 字 → 4,701〜7,137 字)。
- `find-chat-records.ts` / chat-reader / chat-recall / resume。

## 6. 守るべき既存契約

- **記録フォーマット**(`skills/chat/SKILL.md`): パス `docs/chat/YYYY/MMDD/<git user.name>/<kebab-case>.md`。ヘッダー(タイトル+日付/参加者/成果物/前提)→ `## セッション N: <要旨>` → `# <ユーザー名>` / `# AI` → 末尾「注意事項と次の作業」。ユーザー発言は `>` 引用で原文、AI 発言は構造化要約。
- **INDEX.md**: 1 記録ファイル = 1 行。`` - `相対パス` | YYYY-MM-DD | 作業者名 | 要旨 ``。パス昇順、追記時は既存行を更新(行を増やさない)。
- **読み取り側の契約**: `resume` は末尾「注意事項と次の作業」節と最初の `# タイトル` に依存。`chat-recall` は INDEX 行(パス/日付/作業者/要旨の 4 列)を検索対象にし、INDEX 不在時は本文 grep へフォールバック。`find-chat-records.ts` は `docs/chat/YYYY/MMDD/<user>/*.md` 構造からパス・日付・user を復元し、常に exit 0 で JSON を返す。`unindexed` 検出も同構造に依存。
- **commit の永続化契約**(注: git commit ではない): 本文は空でなく 1 MiB 以下、`>` 引用ブロックを含む、追記時は `## セッション` を含む。INDEX 行は 1 行・8 KiB 以下。新規ファイル名は `^[a-z0-9]+(?:-[a-z0-9]+)*\.md$` かつ `allowedNewRecordDir` 直下のみ。新規は `flag:"wx"`。失敗時はサイズ復元と INDEX ロールバックを試み、不能なら `manualRepairRequired`。
- **API 不使用**(CLAUDE.md)。**利用者ビルド不要**(バンドル git 管理)。**フックは常に exit 0**。
- **ループ防止セマンティクス**: 「1 実発言 = 最大 1 回の記録試行」。現在は NAG_MARKER + `attemptedLine` + ロックの三重。方式変更後も等価な抑止が必要。
- **`docs/chat/` 読み取り禁止**(chat-recorder / chat-reader 以外)。

## 7. 未解決事項・不明点(Open Questions)

| # | 質問内容 | 影響度 | 上流報告先(役割) | 現状の仮定 |
|---|---|---|---|---|
| 1 | 「品質に不満」の具体的中身は何か。headless 固有(recorder が別セッションで会話文脈を持たない/haiku 固定/`--append-system-prompt` による抑制)なのか、prepare/commit 機械化そのものが原因なのか。原因が後者なら chat-recorder へ戻しても改善しない | High | 最上位オーケストレーター | headless 固有(会話文脈の欠如とメタ情報の質)と仮定。ユーザーに具体例を確認すべき |
| 2 | 起動経路: Stop の block(reason 短縮)か、UserPromptSubmit の additionalContext か、両者のハイブリッドか | High | 最上位 | ハイブリッド。通常は UserPromptSubmit で短く注入、セッション最終ターン救済のため Stop に低頻度の保険を残す |
| 3 | `run_in_background: true` の Agent 起動で記録品質が保てるか。バックグラウンド subagent の Bash/Write が permission プロンプトに掛かると停止しうる(headless の `--permission-mode acceptEdits` 相当が失われる) | High | 最上位 | **要検証**。実機で 1 回流して確認する |
| 4 | chat-recorder の model/tools: haiku 固定のままか、上位モデルへ上げるか(#1 の原因が品質なら効く)。tools は `Bash, Write` で足りる | High | 最上位 | 品質不満の主因が判明するまで保留 |
| 5 | UserPromptSubmit へ寄せた場合、セッション最終ターンが未記録で残る穴をどう塞ぐか(SessionEnd では Agent tool を使えない) | Medium | 戦術オーケストレーター | 次セッション冒頭で追いつく(state のウォーターマークが残るため可能)+ resume スキルでの補完 |
| 6 | background agent の完了通知がメインに届いたとき、メインが「記録完了しました」と語り出すこと自体が汚染になる。抑止方法 | Medium | 戦術 | agent の最終報告を 1 行に固定し、起動指示に「完了報告への言及は不要」と明記 |
| 7 | 状態管理の削減幅(§10-3)。`consecutiveFailures` / pid 生存確認 / heartbeat をどこまで削るか。commit 側の attemptId 検証との整合 | Medium | 戦術 | pid 系は削除、attemptId/targetLine/ロック/ウォーターマークは維持 |
| 8 | 短縮した reason / additionalContext に prepare・commit のフルコマンドを載せない場合、その情報をどこへ移すか(chat-recorder.md 本文に固定するとプラグインルートの絶対パスが解決できない) | Medium | 戦術 | `${CLAUDE_PLUGIN_ROOT}` はエージェント定義内で展開されるか要検証。不可なら短い 1 コマンドのラッパースクリプトに畳む |
| 9 | 旧 headless 経路のユーザーローカル状態(`~/.claude/task-utility/chat-recorder/`)の後方互換。version 不一致の state をどう扱うか | Low | 戦術 | `STATE_VERSION` を上げ、旧世代は初期状態として作り直す(記録の重複は `recordedLine` 引き継ぎで回避可否を要検討) |

## 8. テスト戦略・既存テスト

- 既存: vitest 全 27 件(chat 記録関連)。`check-chat-recorded.test.ts` 13 件、`chat-recording-decision.test.ts` 8 件、`chat-recording-state.test.ts` 6 件。加えて prepare/commit/extract/find に各テストあり。
- 削除・反転が要る: headless spawn fixture 系(spawn 引数検証、recorder prompt 検証、claude コマンド解決、pid:null ロック、連続失敗 block)。
- 追加方向: (a) 「注入する/しない」の判定を純関数化して単体テスト、(b) 注入テキストの**長さ上限**をテストで固定する(guidepost の `renderInjection` + そのテストが手本)、(c) 「1 実発言 = 最大 1 回」の抑止がイベント種別を変えても保たれること、(d) 記録中断時に `recordedLine` が進んでおらず次回追いつけること(冪等性)。
- エッジ: compaction でトランスクリプトが縮む(`reconcileGeneration` の世代交代)。同一日に複数セッション(`f08e4b7` で `state.recordPath` 優先に修正済み)。日跨ぎセッション。並走セッション。

## 9. 依存関係・リスク・制約

- Claude Code の `Agent` tool `run_in_background` パラメータの可用性(バージョン依存)。起動失敗時は「何もしない=次回追いつく」に倒すのが安全。
- バックグラウンド subagent はセッションと運命共同体(セッション終了・`/clear` で死ぬ)。headless の detached プロセスにはあった「親が死んでも完走する」性質は失われる。**commit の原子性とウォーターマークの冪等性が生命線**。
- サブエージェントの書き込みは `isSidechain` でメイントランスクリプトから不可視。旧々方式が「dispatch 自体を記録証跡と見なす」トリックを使っていた原因。**状態ファイルのウォーターマークは必ず残すこと**(dispatch 証跡方式へ戻してはいけない)。
- 技術的負債として認識すべき点: 同じ「記録手順」が hook の reason 文字列と `agents/chat-recorder.md` の 2 箇所に重複記述されている。今回の縮小で一本化する好機。
- `prepare-chat-recording.ts` は記録先ディレクトリにローカル日付、プロンプト内 date に `toISOString()`(UTC)を使っており、UTC 境界でずれうる(既知の小バグ、今回のスコープ外だが記録先の分岐に影響しうる)。

## 10. 推奨アプローチ(高レベル)

1. **まず #1(品質不満の中身)をユーザーに確認**してから設計に入る。原因が prepare/commit の機械化にあるなら、経路の付け替えだけでは解決しない。
2. **起動は非同期に**: hook は「chat-recorder を `run_in_background: true` で起動し、結果を待たずにターンを終えよ」とだけ指示する。メイン側コストは短い注入 + Agent 1 コール + 完了通知に収まり、旧同期方式の 65 秒問題は再発しない。
3. **注入テキストを 2〜3 行へ**: 手順・契約・prepare/commit のフルコマンドは `agents/chat-recorder.md` 側(subagent の system prompt)へ寄せ、注入には transcript パスと attemptId 程度だけを残す。guidepost の `renderInjection(maxChars)` に倣い**上限をコードで固定しテストで守る**。
4. **イベントは UserPromptSubmit を第一候補**(prefetch と同型、Stop の差し戻し体験がなくなる)。ただし最終ターンの穴(#5)があるため Stop 側の保険を残すか判断する。
5. **状態は「削るもの/残すもの」を明確に**: 削る = `consecutiveFailures`、pid 生存確認、heartbeat、`resolveClaudeCommand`、ログ FD。残す = `recordedLine` ウォーターマーク、ロック(mtime ベースの stale 期限で単純化)、attemptId/targetLine(commit 検証が依存)、「起動済み」マーカー。
6. 段階: 判定純関数 + 注入文の縮小 → テスト差し替え → chat-recorder.md の正系統化 → 実セッション検証(#3 の permission 挙動を必ず実機で見る) → README/設計書の整合 → `pnpm build` + バンドル差分コミット → 0.7.0-dev。

## 11. 補足・暗黙知の可能性が高いポイント

- headless 化は 2026-07-24 に「案C は環境差でサポートできない」と一度却下されたものを、実機検証(Claude Code 2.1.218 / WSL2)で解禁して入れた経緯がある。今回の廃止はその往復の 3 度目にあたるため、新設計書で「何が変わって判断が反転したか(=品質)」を明記しないと、将来また往復する。
- 直近 2 コミット(`f08e4b7` 記録先の断片化、`a6e0015` 抽出が AI の作業本体を全消し)は**いずれも記録品質のバグ**で、headless 経路固有ではなく prepare/extract 側にあった。ユーザーの品質不満がこれらの修正前の記録を見ての判断である可能性がある(#1)。
- LLM に手順を任せると繰り返し事故が起きた履歴がある(一時ファイル名の `$$` 展開不整合 `cab5a71`、セッション番号取得の堅牢化 `0791977`)。prepare/commit への機械化はその対策でもあるため、chat-recorder 復帰時に手順を LLM 側へ戻すのは退行になりうる。
- `--bare` は API キー必須でサブスク認証不可のため過去に却下済み。API 不使用要件に関わるので再検討しないこと。
- Stop の block reason はトランスクリプトに `type:"user"` として残り、記録対象の会話にも混入しうる。現在は NAG_MARKER と `startsWith("<")` で除外されている。注入経路を変えるとこの除外条件も合わせて見直す必要がある。

---

**次のステップ提案**:

- この Context Map を基に詳細設計を作成してよいか。ただし **Open Question #1(品質不満の具体的中身)の確認が先**。
- 特に確認してほしい Open Questions: #1(品質不満の実体)、#2(起動経路の選択)、#3(background subagent の permission 挙動 = 要実機検証)、#4(chat-recorder の model)。

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に従い、本文は小さく蒸留された状態に保つ。API キー・トークン・パスワードなどの機密情報を記録しないこと。*
