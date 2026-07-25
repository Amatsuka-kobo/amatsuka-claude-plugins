# chat-recorder ヘッドレス失敗時のフォールバック設計

- 日付: 2026-07-25
- 対象: `plugins/task-utility`（`chat-recording-state.ts` / `hooks/check-chat-recorded.ts` / `commit-chat-recording.ts`）
- 前提: `829ae01`（一時ファイルを Claude 設定ディレクトリ外へ退避）適用済み

## 1. 背景と問題

ヘッドレス化以降、`~/.claude` 配下の sensitive file 保護により recorder が毎回失敗していたが、この障害は **7 回連続で失敗しても誰にも気づかれなかった**。原因は障害そのものではなく、失敗が可視化・救済されない設計にある。

現行のフォールバック（`decision: "block"` によるサブエージェント委譲）は次の 2 経路でしか発火しない。

- `resolveClaudeCommand()` が null（`claude` が PATH にない、または不正な差し替え）
- `spawnRecorder()` が spawn 自体に失敗

つまり **spawn に成功したあとの失敗は一切救済されない**。spawn 成功時点で `attemptedLine` が `lastUserTurn` まで進むため、次回フックの `decideRecordingAction` は `already-attempted` の noop か、`lastError` が未通知のときだけ 1 回の `notify` を返して終わる。記録は永久に失われる。

さらに、`ensureStateDirs()` が throw する経路（`829ae01` で追加した一時ディレクトリの所有者検証を含む）は `check-chat-recorded.ts` 最上位の `catch` に握りつぶされ、ログにも残らず完全に無音で終わる。

## 2. 目的

1. ヘッドレス recorder が繰り返し失敗する状況で、記録を失わずサブエージェント委譲へ退避する
2. 記録不能な状態をユーザーに見える形にする

非目的: recorder 自体の成功率向上、失敗原因の自動診断。

## 3. 設計

### 3.1 連続失敗カウンタ

`RecordingState` に `consecutiveFailures?: number` を追加する。省略可とし、読み出しは `state.consecutiveFailures ?? 0` で扱う。既存の状態ファイルはフィールドを持たないため、この既定値によって移行なしで互換を保つ。

**加算する箇所**（いずれも「1 回の試行が結果を残さず終わった」ことが確定した時点）

| 箇所 | 契機 |
|---|---|
| `check-chat-recorded.ts` | stale lock を回収したとき（＝前回の recorder が完走しなかった） |
| `commit-chat-recording.ts` | `commit-validation` 失敗時 |
| `commit-chat-recording.ts` | `commit` 失敗時 |

**0 にリセットする箇所**

| 箇所 | 契機 |
|---|---|
| `commit-chat-recording.ts` | commit 成功（`recordedLine` 更新）時 |
| `chat-recording-state.ts` | `reconcileGeneration()` が世代交代を検出したとき |

**1 試行 = 1 加算の保証**

放置すると二重加算・自己加算が起きる経路が 2 つある。

1. commit が失敗を書いた試行のロックは commit 側で削除されないため、次回フックが同じ試行を stale lock として回収し、commit 失敗と合わせて 2 回加算する
2. block 経路（§3.3）とフォールバック経路は spawn せずにロックを作るため、そのロックが次回 stale 回収され、**失敗していないのに加算される**（block がさらなる block を呼ぶ自己増殖）

→ **決定**: stale lock 回収時の加算は、次の両方を満たす場合に限る。

- `lock.pid !== null` — 実際に recorder を spawn した試行であること。`pid: null` のロックは block / フォールバックが残したものであり、ヘッドレスの失敗ではないので数えない（経路 2 を構造的に排除）
- `state.lastError?.attemptId !== lock.attemptId` — その試行の失敗が commit 側で既に記録済みでないこと（経路 1 を排除）

### 3.2 block 判定

`RecordingDecision` に `{ action: "block"; targetLine: number; reason: string }` を追加する。

`decideRecordingAction()` の判定順（既存の順序を保ち、`attemptedLine` 判定の**手前**に挿入）:

1. `lastUserTurn === -1` → noop
2. `lastUserTurn <= recordedLine` → noop
3. `hasActiveLock` → noop
4. **`consecutiveFailures >= FALLBACK_THRESHOLD` → block**（新規）
5. `attemptedLine >= lastUserTurn` → notify または noop
6. → spawn

`FALLBACK_THRESHOLD = 2`。1 回の失敗は一過性（CLI の一時エラー等）でありうるため即座に諦めず、2 回連続で失敗したらヘッドレスを断念してサブエージェントへ委譲する。

判定 4 を判定 5 より先に置くのが要点である。失敗した試行では `attemptedLine >= lastUserTurn` が既に成立しているため、後ろに置くと block に到達できない。

### 3.3 block 時の挙動

既存のフォールバック経路（`claude` 不在時）と同じ形にそろえる。すなわち `acquireLock()` → plan 書き込み → `decision: "block"` + `fallbackReason` を返し、`attemptedLine` は進めない。委譲先のサブエージェントは plan と `attemptId` を使って `prepare` → Write → `commit` を実行する。

ロック取得は省略できない。`commit-chat-recording.ts` は冒頭で `updateHeartbeat(paths.lockPath, args.attemptId)` を呼び、ロックが無いか `attemptId` が一致しなければ例外を投げる。委譲先の commit を成立させるには、block 時にもロックが必要である。

残した `pid: null` のロックは、後続フックが heartbeat 30 秒経過で stale 回収する（既存挙動）。この回収では §3.1 の `lock.pid !== null` 条件により加算されない。これが無ければ block が自分で作ったロックによって失敗カウンタが増え続け、block が永久に解除されない。

`lastNotifiedAttemptId` は block 時に `state.lastError?.attemptId` へ更新する。block の reason が失敗の存在をユーザーに伝えるため、直後に同じ失敗を `systemMessage` で二重通知する必要はない。

無限ループの防止は既存の `NAG_MARKER` 機構に委ねる。block の reason は `NAG_MARKER` で始まり、transcript に user メッセージとして残る。次回フックの `scanTranscript` が `lastNag > lastUserTurn` を検出し、`main()` 冒頭の early return が働くため、同一実発言に対する二度目の block は起きない。ユーザーが次の実発言をすると `lastUserTurn > lastNag` に戻り、そこで委譲が済んでいなければ再度 block する。これは意図した挙動である。

### 3.4 状態ディレクトリ準備の失敗

`ensureStateDirs()` を `try`/`catch` で囲み、失敗時は握りつぶさず `systemMessage` を出力して return する。

block を返さない理由: 一時ディレクトリが使えない場合、委譲先のサブエージェントも同じ `tempDir` へ Write して `commit` に渡す必要があるため、委譲しても同じ理由で失敗する。救済不能であることをユーザーへ伝えるのが正しい。

メッセージには失敗したディレクトリのパスと理由を含める。ログは書けない可能性がある（`logDir` の作成自体が失敗しうる）ため、ログ出力には依存しない。

フックの出力契約は stdout への JSON 1 個であり、`{ systemMessage }` と `{ decision, reason }` は併用しない。この経路では `{ systemMessage }` だけを出力して return する。

## 4. 変更対象

| ファイル | 変更 |
|---|---|
| `src/chat-recording-state.ts` | `RecordingState.consecutiveFailures?`、`RecordingDecision` に `block`、`FALLBACK_THRESHOLD`、`decideRecordingAction` の判定 4、`reconcileGeneration` のリセット |
| `src/hooks/check-chat-recorded.ts` | stale lock 回収時の加算、block 分岐、`ensureStateDirs` の catch |
| `src/commit-chat-recording.ts` | 成功時リセット、失敗 2 経路での加算 |

`scripts/*.mjs` は `pnpm build` で再生成。`plugin.json` は `0.6.1-dev` → `0.6.2-dev`。

## 5. テスト

単体（`decideRecordingAction`）:

- `consecutiveFailures` が閾値未満なら spawn
- 閾値以上なら block（`attemptedLine >= lastUserTurn` でも block になること）
- `hasActiveLock` は block より優先される
- `lastUserTurn <= recordedLine` は block より優先される

統合（フック実行）:

- 失敗する fixture コマンドを 2 回実行すると 2 回目以降が `decision: "block"` になり、reason に `NAG_MARKER` と `task-utility:chat-recorder` を含む
- stale lock 回収で `consecutiveFailures` が 1 だけ増える（同一 `attemptId` の二重加算がない）
- `ensureStateDirs` が失敗する状況（`tempDir` をシンボリックリンクに差し替え）で `systemMessage` が出力され、無音で終わらない

commit:

- commit 成功で `consecutiveFailures` が 0 に戻る
- commit 失敗で `consecutiveFailures` が増える

## 6. リスク

- **閾値 2 が短すぎる/長すぎる**: 短いと一過性の失敗でサブエージェント委譲（＝メインコンテキスト消費）に落ちる。長いと記録の欠落が続く。2 は「一過性を 1 回許容する」最小値として選ぶ。
- **既存状態ファイルとの互換**: `consecutiveFailures` 未定義を 0 とみなすため、既に失敗が蓄積している状態ファイルはカウンタ 0 から数え直す。今回の障害で失敗中のセッションは、次の失敗 2 回を経てから block に落ちる。許容する。
