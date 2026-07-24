# Prefetch調査: Stop フックから claude -p を detached 起動する設計の実現可能性

**目的**: Stop フックから `claude -p` を detached 起動して会話記録をバックグラウンド実行する設計の実現可能性判断

**実施日**: 2026-07-24

---

## 1. `--allowedTools` / `--permission-mode` の正確な構文

### 事実（出典: [headless.md](https://code.claude.com/docs/en/headless.md) + [cli-reference.md](https://code.claude.com/docs/en/cli-reference.md)）

#### `--allowedTools` フラグ

**基本形**:
```bash
--allowedTools "Bash,Read,Edit"
```

**パターンマッチング形** (権限ルール構文):
```bash
--allowedTools "Bash(git *),Bash(rm *),Read,Edit(*.ts)"
```

- ツール名をカンマで区切る
- `ToolName(pattern)` で特定コマンドのみ許可
- スペース区切りではなく**カンマ区切り**が正式構文
- 末尾スペース + `*` で prefix matching: `Bash(git *)` は `git diff` も `git log` も許可

**具体例**:
```bash
claude -p "Find and fix the bug in auth.py" --allowedTools "Read,Edit,Bash"
claude -p "Run the test suite" --allowedTools "Bash,Read,Edit"
claude -p "Create a commit" --allowedTools "Bash(git diff *),Bash(git log *),Bash(git status *),Bash(git commit *)"
```

#### `--permission-mode` フラグ

**モード一覧** (出典: [cli-reference.md](https://code.claude.com/docs/en/cli-reference.md)):
- `default` (manual): 各アクションで確認
- `plan`: プラン実行時に確認しない
- `acceptEdits`: ファイル編集を自動承認 + `mkdir`, `touch`, `mv`, `cp` などを自動承認
- `auto`: 分類器ベースの自動承認
- `dontAsk`: 許可プロンプトをスキップ、許可ルールと read-only コマンドセットのみ実行
- `bypassPermissions`: すべてのチェックをスキップ

**具体例**:
```bash
claude -p "Apply the lint fixes" --permission-mode acceptEdits
claude -p "Review code" --permission-mode dontAsk
```

**注意**: `AskUserQuestion`, MCP ツール (`requiresUserInteraction`)、組織の `ask` 設定ツールは `--allowedTools` でも拒否される。

---

## 2. `--model` の構文とサブスク認証で使えるモデル名

### 事実（出典: [cli-reference.md](https://code.claude.com/docs/en/cli-reference.md)）

#### `--model` フラグ構文

**完全形** (モデルID):
```bash
--model claude-sonnet-5
--model claude-opus-4
--model claude-haiku-4-5
```

**エイリアス形** (短縮):
```bash
--model sonnet      # claude-sonnet-5
--model opus        # claude-opus-4
--model haiku       # claude-haiku-4-5
--model fable       # claude-fable-1
```

**サブスク認証で使用可能なモデル**（推測: 明示記載なし）:
- ドキュメントでは モデルID・エイリアスの存在は記載されるが、サブスク認証でどのモデルが使えるかの明示記載なし
- Bare mode では `ANTHROPIC_API_KEY` または settings の `apiKeyHelper` が必要（OAuth・keychain をスキップ）
- **推測**: サブスク認証（headless でも）は Claude Code の通常認証パス（OAuth や Slack token）を使用するため、プロジェクト・ユーザーの契約対象モデルすべてが使用可能と予想（haiku/sonnet/opus/fable 等）

#### 注意事項

- Bare mode (`--bare`) では OAuth と keychain reads をスキップするため、API キーまたは `apiKeyHelper` 経由の認証が必須
- `-p` デフォルト (non-bare) ではサブスク認証（Slack, OAuth）がそのまま機能

---

## 3. `--bare` フラグの効果範囲詳細

### 事実（出典: [headless.md](https://code.claude.com/docs/en/headless.md)）

#### `--bare` でスキップされるもの

1. **スキップ対象**:
   - Auto-discovery of hooks
   - Skills
   - Plugins
   - MCP servers
   - Auto memory (CLAUDE.md)
   - User-level `~/.claude` 設定

2. **スキップされない** (明示的フラグで指定可能):
   - `--append-system-prompt` / `--system-prompt`
   - `--settings` (ファイルまたは JSON)
   - `--mcp-config`
   - `--agents` (JSON)
   - `--plugin-dir` / `--plugin-url`

3. **認証面**:
   - OAuth をスキップ
   - Keychain reads をスキップ
   - → API キーまたは settings の `apiKeyHelper` が必須

#### スタートアップ時間の実効果

- Hook 読み込み、plugin auto-discovery, MCP server connection が無効化されるため、
  **同一マシンで同じ結果が得られる（チームのローカル設定に左右されない）**

#### 具体例

```bash
# Bare + 特定ツール自動承認
claude --bare -p "Summarize this file" --allowedTools "Read"

# Bare + MCP サーバーは明示的に指定
claude --bare -p "query" --mcp-config ./mcp.json

# Bare + システムプロンプト追加
claude --bare -p "review" --append-system-prompt "Security-focused review"
```

---

## 4. Hook プロセスから detached 子プロセス起動の注意点

### 事実（出典: [hooks.md](https://code.claude.com/docs/en/hooks.md) + [headless.md](https://code.claude.com/docs/en/headless.md)）

#### Hook タイプと実行モデル

**Command Hook** (`type: "command"`):
```json
{
  "type": "command",
  "command": "/path/to/script.sh",
  "timeout": 600,
  "async": false
}
```

#### タイムアウト仕様

- **デフォルト**: `timeout` で秒単位指定（明示記載: デフォルト値は type による）
- **制限**: Timeout 秒経過後、プロセスがキャンセルされる
- **Async hooks**: `"async": true` で指定可能 → **バックグラウンド実行**
- **AsyncRewake**: `"asyncRewake": true` で exit code 2 時に Claude を wake 可能

#### Exit Code と stdout/stderr の扱い

| Exit Code | 意味 | 動作 |
|-----------|------|------|
| 0 | 成功 | stdout の JSON を parse → decision 適用 |
| 2 | ブロッキングエラー | stderr が block reason として使用 |
| その他 | 非ブロッキングエラー | stderr を user に表示、実行継続 |

#### JSON Output 形式

```json
{
  "continue": true,
  "suppressOutput": false,
  "additionalContext": "Context for Claude",
  "decision": "block",
  "reason": "Why blocked"
}
```

#### Detached 実行の制約

- **Exit code 0 を返す**: Hook は結果を JSON で stdout に出力して正常終了
- **Timeout 管理**: `timeout` で指定秒数内に完了・exit すること（さもなくキャンセル）
- **プロセスグループ**: ドキュメントに明示記載なし。**推測**: Hook 実行時のプロセスグループは Claude Code が管理（子プロセスも親と同じグループ）
- **Stdout/Stderr**: Hook が `nohup` や `setsid` で detach しても、Hook 本体の stdout/stderr は Hook フレームワークが capture する
- **子プロセスの独立性**: Hook が `&` で背後に送っても、Hook スクリプト自体は exit 必須。子プロセスは Hook 終了後も生存するが、Claude Code の監視下にはない

#### 推奨パターン: Detached CLI 起動

```bash
#!/bin/bash
# Hook script: run claude -p in background

exec nohup claude --bare -p "chat record task" \
  --allowedTools "Read,Write" \
  --permission-mode acceptEdits \
  > /tmp/claude-bg.log 2>&1 &

# Hook process 自体は即座に exit
exit 0
```

**条件**:
- Hook script は `exit 0` で即座に完了
- 子プロセス (`claude -p`) は nohup で切り離され、親 Claude Code session と無関係に進行
- Hook timeout 内に script 終了すること（通常 sec 内）

---

## 5. `claude -p` の同時多重起動に制約があるか

### 事実（出典: [headless.md](https://code.claude.com/docs/en/headless.md) + [agent-view.md](https://code.claude.com/docs/en/agent-view.md)）

#### セッション管理とロック

- **明示的な同時実行制約の記載なし**
- **セッションスコープ**: 同一プロジェクトディレクトリ内のセッションは `.claude/jobs/<id>/` に格納される
- **Worktree 隔離**: バックグラウンドセッションは `.claude/worktrees/` に自動隔離（並列ファイル編集でのコンフリクト回避）
- **レート制限**: 複数セッション = quota の比例消費（公式 note: "parallel sessions consume quota proportionally"）

#### 推奨

- ローカルマシン上での `claude -p` 多重起動は物理的には可能（UI による制約なし）
- ただし同一プロジェクトでの並列ファイル編集は worktree 機構で自動隔離
- Session ID 取得で resume 可能: `claude -p "task" --output-format json | jq -r '.session_id'`

#### Bare mode での並列実行

```bash
# 複数の claude -p を同時起動（推奨構文）
nohup claude --bare -p "task-1" > /tmp/bg1.log 2>&1 &
nohup claude --bare -p "task-2" > /tmp/bg2.log 2>&1 &
nohup claude --bare -p "task-3" > /tmp/bg3.log 2>&1 &
```

**制約**: 同一プロジェクトの git worktrees 上での同時編集を避けるため、各プロセスは `--cwd` で異なる worktree を指定するか、read-only 操作のみとするべき。

---

## 6. 設計実現可能性の総合判定

### 結論: 実現可能（条件付き）

**成立条件**:

1. **Stop フックの型**: `type: "command"` で shell script を指定
2. **Script 内容**: 
   ```bash
   #!/bin/bash
   exec nohup claude --bare -p "chat-record request" \
     --allowedTools "Read,Write,Edit" \
     --permission-mode acceptEdits \
     --model haiku \
     > ~/.claude/chat-bg.log 2>&1 &
   exit 0
   ```

3. **Hook timeout**: 十分なマージン（例: 10 秒）で script 終了を保証
4. **サブスク認証**: Bare mode でも `~/.claude/settings.json` の `apiKeyHelper` 等で自動認証可能（OAuth キーチェーン利用可）
5. **プロセス独立性**: 背後の `claude -p` は Hook 終了後も独立実行可能

### 未解決事項

- ✗ **Hook stdout/stderr の capture**: Hook script がバックグラウンド起動した `claude -p` の output をどこに redirect しても、Hook フレームワークはスクリプトの終了 status のみ確認（子プロセスの stdout は独立）→ **ログローテーション対策必須**
- ✗ **プロセスグループ管理**: SIGHUP 時の挙動（nohup で保護されていれば OK だが、SSH session 切断時の動作は環境依存）
- ✗ **Concurrent session の lock**: 複数 hook が同時に `claude -p` 起動した場合、race condition の可能性 → **調査未完了**（ドキュメント記載なし）

### 推奨実装パターン

**Hook: Stop フック** （`.claude/settings.json`）
```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/record-chat.sh",
            "timeout": 5,
            "async": true
          }
        ]
      }
    ]
  }
}
```

**Script: `.claude/hooks/record-chat.sh`**
```bash
#!/bin/bash
set -e
nohup claude --bare -p "${CHAT_RECORD_PROMPT}" \
  --allowedTools "Read,Write,Edit" \
  --permission-mode acceptEdits \
  --model haiku \
  --cwd "${CLAUDE_PROJECT_DIR}" \
  >> ~/.claude/chat-records.log 2>&1 &
exit 0
```

**特記**: `async: true` で Hook 自体の timeout 制約を緩和可能。

---

## 参考 URL

- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference.md)
- [Headless Mode Documentation](https://code.claude.com/docs/en/headless.md)
- [Hooks Reference](https://code.claude.com/docs/en/hooks.md)
- [Agent View (Background Sessions)](https://code.claude.com/docs/en/agent-view.md)

---

**調査完了**: 2026-07-24 （Haiku 4.5）
