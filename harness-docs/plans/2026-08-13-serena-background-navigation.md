# 背景サブエージェントへのシンボル探索経路の付与(Serena 経由)

改訂 2(独立レビュー反映後)

## 目的

背景(並列)実行のサブエージェントに、grep より精度の高いシンボル探索手段を与える。

## 背景と根拠

### 事実 1: background サブエージェントは LSP を失う

公式ドキュメント `sub-agents#available-tools` が定める第 2 フィルタは、background 実行のサブエージェントが保持する組み込みツールを次に限定する。

> `Read`, `Grep`, `Glob`, `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`, `Monitor`, `TaskStop`, `SendMessage`, `Artifact`

`LSP` は含まれない。一方 **MCP ツールは全て保持される**。v2.1.198 以降 background が既定であり、並列 dispatch は background を意味する。削除はエラーを伴わない(`tools` が 1 件も解決しない場合を除く)。

現行のエージェント定義における `LSP` の有無は次のとおり。

| 定義 | `tools` の `LSP` |
| --- | --- |
| `gpt-sol` / `gpt-terra` / `gpt-luna` / `grok-implementer` | あり(背景実行では削除される) |
| `grok-researcher` | **なし**(もともと Grep / Glob 中心) |

したがって本計画は、4 本にとっては「失われた LSP の補償」、`grok-researcher` にとっては「探索精度の新規付与」にあたる。

### 事実 2: grep はこのリポジトリで構造的にノイズを出す

`CLAUDE.md` の規約により `plugins/*/scripts/*.mjs`(esbuild バンドル出力)を git 管理下に置いている。バンドルはソースのシンボルをインライン展開するため、grep に必ず混入する。

実測(`plugins/codiel/src/codiel-state.ts` の `readState`):

| 手段 | 結果 |
| --- | --- |
| LSP `findReferences` | 2 件(正解) |
| `git grep -l` | 8 ファイル(バンドル 5 + docs 2 のノイズ + 正解 1) |

### 事実 3: Serena は `.md` に対して偽診断を出している

`.serena/project.yml` の `language_servers` は `typescript` のみ。同ファイルのコメントどおり先頭の言語サーバーがフォールバックとして使われるため、`.md` が tsserver に渡される。

実測: `README.md` の診断 638 件(全て `"source": "typescript"`、122,657 文字)。全て偽陽性。

**この問題の影響範囲は限定的である。** 本計画がサブエージェントに許可するのは探索系 5 ツールのみで、`get_diagnostics_for_file` を含まない。したがってサブエージェントは偽診断を取得する経路を持たない。実害を受けるのは、診断ツールを直接呼ぶメインセッションだけである。

### 事実 4: Serena の markdown backend は Marksman

`solidlsp/ls_config.py` の `Language.MARKDOWN` が `solidlsp.language_servers.marksman.Marksman` に解決される。バージョンは `DEFAULT_MARKSMAN_VERSION = "2024-12-18"` に固定され、GitHub Releases から自動ダウンロード・sha256 検証のうえ `~/.serena/language_servers/` に配置される。手動インストールは不要。

`MARKDOWN` は `is_experimental()` に含まれるため自動検出されず、`project.yml` への明示が必須である。

### 事実 5: `.claude/agents/` は生成物である

`.gitignore` に `.claude/agents` があり、実体は `agent-policy:setup-gpt` / `setup-grok` が `plugins/agent-policy/skills/setup-*/assets/*.template.md` から生成する。テンプレートを更新しなければ、次回 setup 実行で変更が失われる。

### 事実 6: Grok は利用可能

初回の独立レビュー dispatch は `unknown provider for model claude-grok-4-5` で失敗したが、`cliproxyapi.config.yaml` の `oauth-model-alias` に `xai: name: "grok-4.5" / alias: "claude-grok-4-5"` が追加され、以後 `grok-researcher` は正常に起動する。独立レビューは実施済みである。

## 変更内容

### 変更 1: `.serena/project.yml` に markdown を追加

```yaml
language_servers:
- typescript
- markdown
```

`typescript` を先頭に維持する。先頭は既定言語かつフォールバックであり、`.ts` の扱いを変えないため。

**位置づけ**: 事実 3 のとおり、これは変更 2 の前提ではなく独立した改善である。メインセッションで `.md` の診断を呼んだときの偽陽性を止めることが目的であり、サブエージェントの探索精度には寄与しない。変更 2〜5 とは切り離して実施・撤回できる。

### 変更 2-A: 探索系 5 本(全 5 エージェント共通)

| ツール | 用途 | grep に対する優位 |
| --- | --- | --- |
| `find_symbol` | 名前パスでのシンボル取得 | 定義の一意特定 |
| `find_referencing_symbols` | 参照検索 | バンドル出力・docs のノイズ排除 |
| `get_symbols_overview` | ファイルのシンボル一覧 | 全文 Read の回避 |
| `find_declaration` | 宣言へのジャンプ | 別プラグインの export 追跡 |
| `find_implementations` | 実装の列挙 | interface からの逆引き |

`search_for_pattern` と `read_file` は Grep / Read と重複するため含めない。`get_diagnostics_for_file` は診断側の機能であり、今回のスコープ外。

追加する文字列:

```
mcp__plugin_serena_serena__find_symbol, mcp__plugin_serena_serena__find_referencing_symbols, mcp__plugin_serena_serena__get_symbols_overview, mcp__plugin_serena_serena__find_declaration, mcp__plugin_serena_serena__find_implementations
```

**allowlist(個別列挙)を選ぶ理由**は、サーバー全体許可が危険で他に手段がないからではない。制御手段は他にも存在する(`permissions.deny` の `mcp__` ルール、`disallowedTools`、Serena 側の `read_only` / `excluded_tools` / `fixed_tools`。後者 3 つは `.serena/project.yml` の 80・85・95 行に実在する)。allowlist を選ぶ理由は次の 2 点である。

- **fail-safe である**: Serena に新しいツールが増えたとき、denylist 方式では自動的に許可されてしまうが、allowlist 方式では自動的に閉じている。Serena は upstream の更新が速く、`uvx --from git+...` で常に最新を引く構成であるため、この差は実質的である。
- **コンテキストが最小である**: 背景でも MCP ツールは全保持されるため、サーバー全体を許可すると 29 ツール分の定義を毎回支払う。5 本なら概算 7〜8k 文字に収まる。

なお `mcp__plugin_serena_serena__execute_shell_command` が `.claude/settings.json` の Bash ルール(`deny: sudo *` 等)の対象外であることは事実だが、これは allowlist を選ぶ理由の一つであって唯一の理由ではない。

### 変更 2-B: 編集系 6 本(実装帯 4 本のみ)

`grok-researcher` は読み取り専用の契約を維持するため対象外とする。それ以外の 4 本には編集系も許可する。

| ツール | 用途 | Edit / Write に対する優位 |
| --- | --- | --- |
| `replace_symbol_body` | 関数・メソッドの本体を名前パスで置換 | 置換前に本文を Read して `old_string` を組み立てる必要がない |
| `insert_after_symbol` | 指定シンボルの直後に挿入 | 挿入位置の行番号を数えなくてよい |
| `insert_before_symbol` | 指定シンボルの直前に挿入 | 同上。import 行の追加にも使える |
| `rename_symbol` | コードベース全体のリネーム | **他に手段がない**。Edit の全置換では文字列一致の誤爆を避けられない |
| `replace_in_files` | 複数ファイルの一括置換。`dry_run` で候補を出し `occurrence_ids` で選択適用 | **他に手段がない**。適用対象を選んでから確定できる |
| `replace_content` | 単一ファイルの正規表現置換 | `先頭.*?末尾` のワイルドカードで長い置換ができ、本文を丸ごと引用しなくてよい |

`safe_delete_symbol` は含めない。シンボルの削除はオーケストレーターまたはユーザーの判断に残す。

`create_text_file` は Write と重複するため含めない。

### 変更 2-C: 除外するツールと理由

| 除外するツール | 理由 |
| --- | --- |
| `execute_shell_command` | `.claude/settings.json` の Bash ルール(`deny: sudo *` / `rm -rf /`、`ask: git push *` / `rm *`)が適用されない実行経路になる。Bash で代替できる |
| `write_memory` / `delete_memory` / `edit_memory` / `rename_memory` | `.serena/memories/` は git 管理下の共有知識であり、サブエージェントに書き換えさせない |
| `activate_project` | MCP サーバーはセッション共有プロセスであり、サブエージェントがプロジェクトを切り替えるとメインセッションの解決先まで変わる |
| `get_diagnostics_for_file` | 診断側の機能。ユーザー判断により今回は対象外 |
| `search_for_pattern` / `read_file` | Grep / Read と重複する |

### 変更 2-D: コンテキスト増分(実測)

Serena のツール説明文(`apply()` docstring)を実測した値。JSON schema のオーバーヘッドは含まない。

| 区分 | 本数 | 文字数 |
| --- | --- | --- |
| 探索系 | 5 | 5,904 |
| 編集系 | 6 | 6,116 |
| 実装帯 4 本の合計 | 11 | **12,020** |
| `grok-researcher` | 5 | **5,904** |

参考として、アクティブな全 29 ツールを許可した場合の docstring 合計は約 17,000 文字である。編集系を足しても、サーバー全体許可より小さい。

### 変更 3: 対象エージェント 5 本

| エージェント | 帯 | 探索系 5 本 | 編集系 6 本 | 位置づけ |
| --- | --- | --- | --- | --- |
| `gpt-sol` | 複雑または重要な実装 | ○ | ○ | LSP 喪失の補償 + シンボル単位編集 |
| `gpt-terra` | 通常の実装 / 探索実働 | ○ | ○ | 同上 |
| `gpt-luna` | 軽量な実装 / 探索実働 | ○ | ○ | 一括適用が主務のため `replace_in_files` / `rename_symbol` の寄与が最も大きい |
| `grok-implementer` | 通常の実装 | ○ | ○ | LSP 喪失の補償 + シンボル単位編集 |
| `grok-researcher` | 独立レビュー / 探索実働 | ○ | **×** | 探索精度の新規付与。読み取り専用契約を維持する |

`grok-researcher` にのみ編集系を与えない。この 1 本は担当表で「独立レビュー」を担い、レビュー対象を書き換えられないことがレビューの独立性の前提であるため。

### 変更 4: テンプレートと生成物の両方を更新

| ファイル | 区分 |
| --- | --- |
| `plugins/agent-policy/skills/setup-gpt/assets/gpt-sol.template.md` | 生成元(git 管理) |
| `plugins/agent-policy/skills/setup-gpt/assets/gpt-terra.template.md` | 生成元(git 管理) |
| `plugins/agent-policy/skills/setup-gpt/assets/gpt-luna.template.md` | 生成元(git 管理) |
| `plugins/agent-policy/skills/setup-grok/assets/grok-implementer.template.md` | 生成元(git 管理) |
| `plugins/agent-policy/skills/setup-grok/assets/grok-researcher.template.md` | 生成元(git 管理) |
| `.claude/agents/*.md` 5 本 | 生成物(gitignore) |

生成物は**手動で編集する**。`agent-policy:setup-gpt` / `setup-grok` の再実行は使わない。これらは対話ヒアリングを伴うウィザードであり、`tools` 行以外の本文も再生成されるため、今回の変更範囲を超える差分が入る。テンプレートと生成物の `tools` 行は同一文字列にする。

### 変更 5: 探索規律の追記(2 本立て)

追記先は `plugins/agent-policy/references/context-map-guide.md` の §生産側の規律 とする。

`orchestration-discipline.md` の §コードベース探索 ではなく、この位置を選ぶ理由は 2 つある。

- `orchestration-discipline.md` は 4 プロファイル(codex-grok / with-codex / with-grok / claude-model)すべてが読む共通規律であり、Serena を持たないプロジェクトにも適用されてしまう。
- `context-map-guide.md` は「ファイル探索・コードベース探索が必要なときだけ読む」と `orchestration-discipline.md` §コードベース探索 が指定しており、探索手段の使い分けを置く場所として整合する。

追記する規律は 2 本とする。

**規律 A(Serena の使い分け)**: Serena の探索ツールが許可されている場合、シンボルの定義・参照・実装を追う場面ではそれらを使い、Grep は自由文字列の検索に限る。条件付きの書き方にし、許可されていない環境で空振りしないようにする。

**規律 B(Grep の除外パス)**: Grep でコードを探すときは、バンドル出力(`plugins/*/scripts/`)を対象から外す。これは Serena の有無にかかわらず効き、追加コストがゼロである。ソースとバンドルが同じシンボルを持つのは本リポジトリの構造上避けられないため、規律として明記する。

**規律 C(worktree 下では Serena の編集系を使わない)**: git worktree に隔離されたサブエージェントは、Serena の編集系ツールを使わず `Edit` / `Write` を使う。理由は変更 2-B に編集系を含めたことで新たに生じた問題であり、リスク表に詳述する。

規律 A と B は排他ではない。B は安価にノイズの大半を落とし、A は同名の別シンボル・コメント内の一致・部分文字列一致といった B では落ちない誤りを防ぐ。規律 C は A・B とは別の軸で、編集系ツールの適用範囲を制限する。

### 変更 6: バージョンと README

`plugins/agent-policy/.claude-plugin/plugin.json` を `0.4.2-dev` から `0.5.0-dev` に上げる。エージェントに新しいツール権限と探索規律を与える変更であり、`CLAUDE.md` の「軽量の変更はパッチ、それ以外はマイナー」に照らしてマイナーに該当する。プレリリース中のため `-dev` は維持する。`agent-policy` は `package.json` を持たないため、揃えるべき版は他にない。

ルート `README.md` の agent-policy の節に、背景サブエージェントが Serena の探索ツールを使う構成になったことを 1〜2 行で追記する。

## 検証

1. `pnpm lint` / `pnpm typecheck` / `pnpm test`(TS の変更はないが規律どおり実行する)
2. Serena を再有効化し、`get_diagnostics_for_file README.md` が `"source": "typescript"` の診断を返さないことを確認する
3. `gpt-terra` を background で 1 本起動し、次を報告させる。
   - (a) 自身が実際に保持しているツール名の一覧
   - (b) `plugins/codiel/src/codiel-state.ts` の `readState` に対する `find_referencing_symbols` の呼び出し結果
   - (c) 呼び出し時に権限の承認待ちが発生したかどうか
   - 合格条件: (a) に **11 ツールすべて**(探索系 5 + 編集系 6)が含まれ、(b) が 1 件(`latestTry` からの参照)を返し、(c) が「承認待ちなし」であること。LSP が (a) に含まれないことは想定どおりであり、失敗ではない。`execute_shell_command` と memory 系が (a) に含まれていないことも併せて確認する。
4. 検証 3 が (a) で失敗した場合、サーバー名の推定が誤っている。実際のサーバー名を実測して `tools` 行を修正し、やり直す。
5. 検証 3 が (c) で承認待ちを報告した場合、`.claude/settings.json` の `permissions.allow` に `mcp__plugin_serena_serena__*` を追加する。追加しないと、並列実行した探索がすべてメインセッションの承認待ちで直列化する。

## 検証結果(2026-08-13 実施)

| 検証 | 結果 |
| --- | --- |
| 1. `pnpm lint` / `typecheck` / `test` | **通過**。lint 300 ファイル修正なし、typecheck エラーなし、テスト 126 ファイル 1,125 件全通過 |
| 2. Serena の `.md` 診断 | **通過**(MCP サーバー再起動後)。下記参照 |
| 3. `gpt-terra` の background 実機確認 | **通過**。下記参照 |
| 4. サーバー名の修正 | 不要。検証 3 で `plugin_serena_serena` が正しいと確定した |
| 5. `permissions.allow` への追加 | 不要。検証 3(c) が「承認待ちなし」だった |

### 検証 3 の詳細

`gpt-terra` を background で起動して得た結果。

- 探索系 5 本・編集系 6 本の**計 11 本すべてを保持**していた。
- `LSP` は保持していなかった。事実 1 の予測どおりであり、失敗ではない。
- `execute_shell_command` は保持していなかった。allowlist が意図どおり働いている。
- `find_referencing_symbols`(`readState` / `plugins/codiel/src/codiel-state.ts`)は `latestTry` からの参照 1 件を返した。合格条件どおり。
- 権限の承認待ちは発生しなかった。

これにより、計画時点で最大の未確定事項だった「`mcp__plugin_serena_serena__*` というプレフィックス表記が allowlist で解決されるか」と「承認待ちで並列探索が直列化しないか」の両方が解消した。

### 検証 2 の詳細

初回は失敗した。`.serena/project.yml` の記述は正しいにもかかわらず、Serena の応答は `Active language servers: typescript.` のままで、Marksman はダウンロードされず、`README.md` の診断は 667 件すべて `"source": "typescript"` だった。

原因は、Serena の MCP サーバーがセッション共有の常駐プロセスであり、プロジェクトの言語サーバー構成を**プロセス起動時に読み込む**ことにある。`activate_project` は既に有効なプロジェクトに対して言語サーバーを再構築しない。

MCP サーバーを再起動して再実施したところ、次のとおり通過した。

| 項目 | 結果 |
| --- | --- |
| `activate_project` の応答 | `Active language servers: typescript, markdown` |
| Marksman の取得 | `~/.serena/language_servers/static/Marksman/marksman`(21MB)を取得 |
| `README.md` の診断 | **0 件**(667 件の TypeScript 偽エラーが消えた) |
| `plugins/codiel/src/codiel-state.ts` の診断 | 0 件(TypeScript 側に回帰なし) |
| `find_referencing_symbols`(`readState`) | `latestTry` からの参照 1 件(回帰なし) |

`project.yml` の `language_servers` を変更したときは MCP サーバーの再起動が要る。この点は運用メモリに記録した。

## リスク

| リスク | 内容 | 対処 |
| --- | --- | --- |
| **worktree 隔離の素通り(編集系を足したことで発生)** | Serena の `relative_path` は MCP サーバーが有効化しているプロジェクトルート(= メインチェックアウトの絶対パス)を基準に解決される。一方、worktree 隔離が検査するのは `Edit` / `Write` / `NotebookEdit` と Bash / PowerShell / Monitor の作業ディレクトリだけで、MCP ツールは検査対象外である。したがって worktree に隔離されたサブエージェントが Serena の編集系を呼ぶと、**worktree ではなくメインチェックアウトを書き換える**。隔離の迂回であると同時に、意図と異なるファイルを編集する正しさの問題でもある | 規律 C として明文化する。加えて、`isolation: worktree` を伴う dispatch では編集系を渡さない運用とする |
| 権限プロンプトによる直列化 | `tools` の許可は可視性の話であり、実行時の承認免除ではない。背景サブエージェントの承認プロンプトはメインセッションに出る | 検証 3(c)・検証 5 で確定させる |
| プレフィックス未解決 | `mcp__plugin_serena_serena__*` の表記が誤っていた場合、一部だけ欠落してもエラーにならない | 検証 3 の合格条件を 5 ツールすべての存在確認とした |
| MCP-in-background 仕様の後退 | 「背景でも MCP を全保持」は現行ドキュメントの記述だが、過去に逆の記述があった時期がある(GitHub Issue #19964) | 本計画は単一障害点としてこの仕様に依存する。仕様が反転した場合、変更 2〜5 は無効化する。その場合は規律 B(Grep 除外パス)のみが残る |
| Marksman の初回取得 | GitHub Releases へのネットワークアクセスが必要 | 取得失敗時は変更 1 を撤回する。変更 2〜5 には影響しない |
| Marksman が experimental | 起動安定性・md シンボル品質は未計測 | 変更 1 は独立して撤回可能。TS の探索には影響しない |
| コンテキスト増 | 実装帯 4 本で 12,020 文字 / エージェント、`grok-researcher` で 5,904 文字(変更 2-D の実測) | 見合わない場合は、説明文の大きい `find_symbol`(2,684)・`replace_in_files`(2,520)・`replace_content`(1,630)から順に外す |

## 不採用

| 案 | 不採用の理由 |
| --- | --- |
| サーバー全体 `mcp__plugin_serena_serena` の許可 | fail-safe でない(新ツールが自動的に許可される)。29 ツール分のコンテキストを支払う |
| サーバー全体許可 + `disallowedTools` で危険ツールを除外 | 同上。denylist は Serena の更新のたびに追随が必要で、漏れが即座に穴になる |
| Serena 側の `fixed_tools` / `read_only` でサーバー公開ツールを固定 | Serena の設定はメインセッションにも一律に効くため、オーケストレーターが編集系ツールを失う |
| `safe_delete_symbol` の追加 | シンボルの削除はオーケストレーターまたはユーザーの判断に残す |
| `get_diagnostics_for_file` の追加 | 診断側の機能。ユーザー判断により今回は対象外 |
| 依頼文への `pnpm typecheck` 追加 | 同上 |
| 親がシンボル解決し、子は Read/Grep のみ | 既存の context-map 規律がこの形であり、それでも実働側の探索が必要な場面が残るため本計画を立てている。排他ではなく併存する |
| fork による LSP 保持 | 親モデルを継承し `model` 上書きが無視されるため、GPT / Grok への委譲と両立しない |
| `setup-gpt` / `setup-grok` の再実行による生成物更新 | 対話ウィザードであり、`tools` 行以外の本文も再生成されるため差分が変更範囲を超える |
| Grep の除外パス規律「のみ」で済ませる | 安価で有効だが、同名の別シンボル・コメント内の一致・部分文字列一致は落とせない。**不採用ではなく併用**とし、規律 B として変更 5 に取り込んだ |

## レビュー結果の反映

### 実施したレビュー

| 帯 | 状態 |
| --- | --- |
| 設計書・実装計画書のレビュー(`Haiku`) | 実施済み |
| 独立レビュー(`Grok Researcher`) | 実施済み(初回は Grok 不達で失敗、alias 追加後に再実行) |

独立レビューには制約があった。再実行時点で計画書に本節(Haiku レビューの記録)が含まれていたため、「原本のみを読ませる」条件を完全には満たせていない。依頼文で本節を読み飛ばすよう指示して独立性を確保したが、完全な分離ではない。

### Haiku レビューの採否

| 指摘 | 採否 | 反映先 |
| --- | --- | --- |
| 使用規律の追記先が未確定 | 採用 | 変更 5。`context-map-guide.md` §生産側の規律 に確定し、理由を明記 |
| テンプレート更新後の生成物更新方法が未記述 | 採用 | 変更 4。手動編集とし、理由を明記 |
| バージョンの粒度が未確定 | 採用 | 変更 6。`0.4.2-dev` → `0.5.0-dev` |
| 検証 3 の手順と合格条件が具体的でない | 採用 | 検証 3〜5 を具体化 |
| README への追記内容が未確定 | 採用 | 変更 6 に追記箇所を明記 |
| `gpt-luna.template.md` に `LSP` が含まれていない | 却下 | 事実誤認。同ファイル 6 行目に `LSP` がある |
| `.claude/agents/` は空 | 却下 | 事実誤認。5 本が存在する |
| `tools` 行への追記方法が不明 | 却下 | 既存行が `, ` 区切りの平文であり、同形式で足りる |

### 独立レビューの採否

| 指摘 | 採否 | 反映 |
| --- | --- | --- |
| 事実 1c「5 本すべてに `LSP`」は誤り。`grok-researcher` には無い | **採用** | 事実 1 を実測に基づき訂正。`grok-researcher` の位置づけを「新規付与」に変更 |
| 変更 1(markdown)は変更 2 の必須前提ではない。許可 5 ツールに診断系が無いため、サブエージェントは偽診断に触れない | **採用** | 事実 3 と変更 1 を書き直し、独立した改善として位置づけ直した |
| 「サーバー全体許可は Bash ルールを迂回するので個別列挙一択」は制御手段を過小評価。`permissions.deny` / `disallowedTools` / Serena の `read_only`・`excluded_tools`・`fixed_tools` が存在する | **採用** | 変更 2 の理由を fail-safe とコンテキスト最小に書き換え。制御手段の存在を明記。`.serena/project.yml` 80・85・95 行に実在することを確認済み |
| 検証 3 の合格条件が 1 ツールのみで、他 4 本の欠落を見逃す | **採用** | 合格条件を 5 ツールすべての存在確認に変更 |
| `tools` の許可と権限プロンプト免除は別。背景の承認待ちがメインに出る | **採用** | 検証 3(c)・検証 5・リスク表に追加 |
| Grep の除外パスだけでノイズの大半は落ちる(単純代替) | **採用(併用として)** | 規律 B として変更 5 に取り込んだ。排他ではない |
| MCP-in-background 仕様の履歴が不安定(Issue #19964) | **採用** | リスク表に単一障害点として明記 |
| Marksman が experimental で実害が未計測 | 採用 | リスク表に追加 |
| 事実 6「Grok が起動できない」は覆っている | **採用** | 事実 6 を書き直した |
| `ls_config.py:718` の行番号がずれている | 採用 | 行番号参照を削除し、シンボル名参照に変更 |
| Serena 側 `fixed_tools` でサーバー公開ツールを固定する案 | 却下 | Serena の設定はメインセッションにも一律に効き、オーケストレーターが編集系ツールを失う。§不採用 に記載 |
| 親がシンボル解決し子は Read/Grep のみ、という案 | 却下 | 既存の context-map 規律が既にこの形であり、それでも実働側の探索が残る。§不採用 に記載 |
| 事実 2 の「8 ファイル」、事実 3 の「638 件」は再実測していない | 保留 | いずれもオーケストレーターが本セッションで実測した値である。再測は行わない |
| 5 ツールのコンテキスト増分が概算のままである | 採用 | 変更 2-D で実測に置き換えた |

### ユーザー指示による方針変更(改訂 2 の後)

`grok-researcher` 以外のエージェントに付与する Serena ツールは読み取り専用である必要はない、との指示を受けた。これにより次を変更した。

| 項目 | 変更前 | 変更後 |
| --- | --- | --- |
| 許可するツール | 探索系 5 本のみ | 探索系 5 本 + 編集系 6 本(変更 2-B) |
| 対象 | 全 5 エージェントに同一の集合 | 実装帯 4 本に 11 本、`grok-researcher` に 5 本 |
| コンテキスト増分 | 5,904 文字 / エージェント | 実装帯 12,020 文字、researcher 5,904 文字 |
| 新たに生じたリスク | — | worktree 隔離の素通り(リスク表の 1 行目)。規律 C を追加して対処 |

この変更で `rename_symbol` と `replace_in_files` が実装帯に入る。いずれも `Edit` / `Write` では代替できない機能であり、特に「軽量な実装(既存パターンの機械的な反復・一括適用)」を担う `gpt-luna` への寄与が大きい。
