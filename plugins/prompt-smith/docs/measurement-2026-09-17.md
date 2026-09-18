# 2026-09-17 測定改善の実機確認

## 隔離の実機確認(段 1)

### 測定の条件

- 日付: 2026-09-18
- `claude --version`: 2.1.274 (Claude Code)
- 対象コミット: S1-6 完了時点(`0eb83e2`)と診断出力の修正(`1626bff`)
- probe 資産: `~/prompt-smith-probe/`。リポジトリ外の一時資産であり、commit しない。
- probe スキル名: `ps-isolation-probe`。CLI 組み込みスキルとの競合を排除するため、無意味語 `ZZQPROBE` を使う。
- probe eval: 3 問。すべて `should_trigger: true`。

### 相 1: 対照とガード

リポジトリ外の空ディレクトリから実行した。

- `init` イベントの `skills` 件数は、対照 17、隔離 17 だった。
- 隔離側の 17 件は、CLI 組み込みスキルの名前と完全に一致した。名前は `batch`、`claude-api`、`code-review`、`dataviz`、`debug`、`deep-research`、`design`、`design-sync`、`doctor`、`fewer-permission-prompts`、`loop`、`run`、`run-skill-generator`、`simplify`、`update-config`、`verify`、`workflow-authoring` である。
- `~/.claude/skills/<name>/SKILL.md` は 0 件だった。実体は `~/.claude/skills/synced/<uuid>/<name>/SKILL.md` と 2 階層深い位置にあり、読み込み対象外である。
- `init.skills` に載るのは CLI 組み込みとユーザースキルだけであり、プラグインが同梱するスキルは載らない。
- hook イベント数は、対照が 2 件(`SessionStart:startup`)、隔離が 0 件だった。
- `TMPDIR` ガードでは、`TMPDIR` をリポジトリ配下にして `run-trigger-eval.mjs` を起動すると終了コード 1 になった。`claude` は 1 プロセスも起動しなかった。`createSandbox` が `spawn` より前で throw するためである。stderr には `.claude` の絶対パスと、`TMPDIR` を `.claude` を持たない場所へ変える対処が出た。

### 相 2: 基準点

- `git status --porcelain=v1` の行数は 11 だった。
- `~/.claude/backups/` の件数は 0 だった。

### 相 3: 我々のコードを通す

リポジトリルートから実行した。

- 改善案生成の経路(`callClaudeText`)の出力は `<probe>OK</probe>` のみだった。hook の通知への応答は混ざらなかった。
- 陽性対照として `run-trigger-eval.mjs` を 3 問 × 1 実行した。`summary` は `{"total":3,"passed":3,"failed":0}` であり、各問の `trigger_rate` は 1.0 だった。

### 相 4: 照合

- `git status --porcelain=v1` は前後で完全に一致し、差分はなかった。
- `~/.claude.json` は JSON としてパースでき、`.claude.json.tmp.*` の残骸は 0 件だった。
- `~/.claude/backups/` の件数は、前 0、後 0 だった。
- 出力 JSON の `errors` は 0 だった。
- `environment` は `{"base_url":"http://127.0.0.1:8317","auth_source":"ANTHROPIC_AUTH_TOKEN","model":"sonnet"}` だった。トークンの値は含まれない。

### 既定モデルのライブ確認(段 2)

`--model` を省いたときに既定の `sonnet` が実際に使われることを、CLI から確認した。単体テストはライブラリ関数を直接呼ぶ経路だけを対象にしており、`main` が `values.model` をそのまま渡す経路はライブ起動でしか通らない。スモークテストは引数なしで起動するため、`--model` より手前の他の必須チェックで失敗する。

段 1 と同じ `~/prompt-smith-probe/` の probe 資産を使い、3 エントリを `--model` 無しで起動した。

- `run-trigger-eval.mjs` は終了コード 0 だった。`environment.model` は `"sonnet"`、`errors` は 0、`summary` は `{"total":3,"passed":3,"failed":0}` だった。
- `run-loop.mjs` は終了コード 0 だった。`environment.model` は `"sonnet"`、`exit_reason` は `"all_passed (iteration 1)"` だった。probe が全問通ったため、改善案生成は呼ばれなかった。
- `improve-description.mjs` は終了コード 0 だった。`<new_description>` を含む応答を 1 回で取得し、stdout に `description` が出た。このエントリの出力は `environment` を持たない。
- `git status --porcelain=v1` は前後で完全に一致した。

## 実施の過程で判明した 2 点

### 合格条件を差し替えた

実装計画書 S1-7 相 1 Step 2 の合格条件は、「隔離側の `skills` 件数が減り、CLI 組み込みだけの件数(17)になる」だった。

この条件の前半は成立しなかった。剥がすべき上乗せが環境に存在しないためであり、フラグの不調ではない。設計書が実測した時点は、対照 25(= 組み込み 17 + ユーザースキル 8)だった。その後、ユーザースキルの配置が変わった。

代替の検出口として hook イベント数を採った。`--settings '{"disableAllHooks":true}'` が CLI に届いて効いていることを直接示す。hook の抑止は、改修前に `docs/chat/` へ書き込んでいた当の機構である。

差し替え後の合格条件は次のとおりである。

1. 隔離側の 17 件が CLI 組み込みスキルの名前と一致する。
2. hook が対照で発火し、隔離で発火しない。

`--setting-sources` と `--strict-mcp-config` の効きは、この検査では確かめられない。相 3 の陽性対照と、相 4 の `git status` 一致が受け持つ。

### 実装計画書の計測手順に欠陥があった

計画書は `head -1` で `init` イベントを掴む前提だった。対照側では hook の `system/hook_started` イベントが `init` より先に流れるため、先頭行を取ると `skills` が 0 件と出る。

実際、最初の実行で「対照 0 / 隔離 17」という逆転が観測された。`type == "system"` かつ `subtype == "init"` の行を探す形に直した。probe スクリプトは `~/prompt-smith-probe/count-skills.sh` にあり、理由をコメントで残してある。

## 発見した実装の欠陥とその修正

### `TMPDIR` ガードの診断が操作者に届かなかった

経路は次のとおりである。

1. `createSandbox` がガード例外を投げる。
2. `runEval` の問ごとの `catch` が `{status:"error", message}` へ変換する。メッセージはここまで保持される。
3. `assertMeasurable` が固定文の `MeasurementFailedError` を投げ、原因テキストを捨てる。

症状は、`TMPDIR` がリポジトリ内にあると伝えるべき場面で、認証を環境変数へ切り替えるよう表示されたことだった。

これは probe 固有の問題ではない。ネットワーク障害、モデル名の誤り、権限不足も同じく認証の案内にすり替わる。

`1626bff` で、`assertMeasurable` のシグネチャと結果 JSON のスキーマを変えず、`errors > 0` のときの stderr 警告へ、重複を除いた原因メッセージを最大 5 件まで添えるよう修正した。修正後、ガードの診断が `Cause:` の行として stderr に出ることを実機で確認した。
