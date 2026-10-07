# Context Map: chat-recorder ヘッドレス完全バックグラウンド化

**作成日**: 2026-07-24
**作成者**: Fable(with-codex 方針。通常は GPT Sol だが、本セッションでは最上位オーケストレーターが要件検討過程で全関連ファイルを読了・実機検証済みのため、再探索を避けて直接蒸留した)
**対象タスク**: Stop フックの block+dispatch 方式をやめ、フック自身が detached の `claude -p`(Haiku)を起動して記録をバックグラウンド化し、ターン終了時の待ち時間をゼロにする
**関連するBlueprintセクション**: docs/design/2026-07-24-chat-recorder-performance-design.md の「却下した選択肢 案C」の再検討(実機検証により解禁)

---

## 1. 目的・スコープ

- 毎ターンの会話記録でメインセッションが待たされる構造(メインモデル差し戻し処理 → chat-recorder 同期実行 → 完了報告)を、フック起点のヘッドレス実行に置き換える。
- スコープ内: `check-chat-recorded.ts`(Stop フック)、`agents/chat-recorder.md`、抽出スクリプト、新規スクリプト、hooks.json、README、plugin.json バージョン。
- スコープ外: `skills/chat/SKILL.md` の記録フォーマット契約(完成形は変えない)、chat-reader / chat-recall / resume 側。

## 2. 重要なファイル一覧

| ファイルパス | 役割 | 重要度 |
|---|---|---|
| `plugins/task-utility/src/hooks/check-chat-recorded.ts` | Stop フック本体。トランスクリプト走査で lastUserTurn/lastRecord/lastNag を行番号比較し、未記録なら decision:block で差し戻し | High |
| `plugins/task-utility/src/extract-conversation.ts` | 発言抽出。`--since-line N` 差分抽出・USER 引用整形済み | High |
| `plugins/task-utility/agents/chat-recorder.md` | 記録専用 Haiku サブエージェント定義(現方式の中核。ヘッドレス化後の役割を再定義する) | High |
| `plugins/task-utility/hooks/hooks.json` | Stop フック登録(timeout: 15) | High |
| `plugins/task-utility/skills/chat/SKILL.md` | 記録ファイルの完成形契約(変更禁止) | Medium |
| `plugins/task-utility/build.ts` | esbuild。entryPoints に登録→ `scripts/*.mjs` へバンドル(git 管理、利用者ビルド不要) | Medium |
| `plugins/task-utility/src/__test__/`・`src/hooks/__test__/` | vitest(`pnpm test`、ルートから。runTs() で子プロセス実行) | Medium |
| `plugins/task-utility/.claude-plugin/plugin.json` | 現バージョン 0.5.0-dev → 0.6.0-dev へ | Low |

## 3. 現行データフロー

1. Stop フックがトランスクリプト(JSONL)を全行走査。「実ユーザー発言」より「記録イベント」(docs/chat/ への Write/Edit、または chat-recorder への Agent dispatch)が古ければ block。
2. reason には NAG_MARKER(`<!--chat-recorder-nag-->`)を先頭に埋め、「実発言 1 回につき差し戻し 1 回」で無限ループを防止。
3. メインエージェントが chat-recorder(Haiku)へ dispatch(トランスクリプトパス・抽出コマンド・SKILL.md パス・git ユーザー名・成果物・前提を同梱)。**dispatch 自体が次回走査での記録証跡になる**(サブエージェントの Write は isSidechain で見えないため)。
4. chat-recorder: 抽出 Bash → SKILL.md Read → Glob → grep/tail → 追記分 Write(/tmp)→ cat >> → INDEX Edit(約 9〜10 往復)。

## 4. 実機検証で確定した事実(2026-07-24、Claude Code 2.1.218、WSL2)

- `--bare` はサブスク認証不可。「Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper」(--help 明記)。「Not logged in」で即失敗 → **採用不可**(リポジトリ必須要件: API キー前提禁止)。
- 非 bare `claude -p` は API キーなし(OAuth サブスク認証)で動作。scratchpad cwd 3.0 秒、実プロジェクト cwd 6.3 秒、`--strict-mcp-config` 付与で 3.6 秒。
- `--settings '{"disableAllHooks":true}'` で Stop フック発火を完全抑止(マーカーファイル実験で確認)→ 記録セッションの自己差し戻し再帰を防げる。
- `--allowedTools "Write" --permission-mode acceptEdits` でヘッドレス書き込み成功。
- nohup detached 起動は親シェル即終了後も完走(pid 分離・ファイル生成確認)。
- `--strict-mcp-config` は「--mcp-config 指定分以外の MCP を無視」(--help)。ユーザー方針: **MCP 等のロードは削れるだけ削る**。
- 非 bare でもプラグインのロード自体を無効化するフラグは --help に見当たらない(--plugin-dir は追加のみ)。

## 5. 変更の影響範囲

### 5.1 直接
- `check-chat-recorded.ts`: block+reason 生成 → 「ヘッドレス recorder の detached spawn +状態管理」へ全面改修。
- `agents/chat-recorder.md`: ヘッドレスセッションに役割移行(エージェント定義を廃止するか、フォールバック用に残すかは設計判断)。
- `hooks/hooks.json`: timeout・(必要なら)async 化の見直し。

### 5.2 間接
- README(フローの説明)、docs/design/ の既設計書との整合(案C 却下理由の更新)。
- chat-recall / resume スキル: 記録ファイルの完成形が不変なら影響なし(確認のみ)。

### 5.3 変更を避ける箇所
- `skills/chat/SKILL.md`(完成形契約)。`extract-conversation.ts` の行カウント契約(check-chat-recorded と同一ロジック、テストで固定済み)。

## 6. 守るべき既存契約

- **API 不使用**: Anthropic API クライアント・ANTHROPIC_API_KEY 前提を導入しない。`claude` CLI ヘッドレス(ユーザーの既存サブスク認証)は明示的に許可(CLAUDE.md)。
- **利用者ビルド不要**: バンドル `scripts/*.mjs` を git 管理。ソース変更時 `pnpm build`。
- フックスクリプトは常に exit 0(JSON 出力で判断を伝える)契約(README)。
- 行カウント: split("\n") 直後・スキップ判定前に加算。空行・パース不能行も 1 行(extract と check の共通不変条件)。
- NAG_MARKER によるループ防止セマンティクス(方式変更後も「1 実発言 = 最大 1 記録試行」に相当する抑止が要る)。
- docs/chat/ の読み取り禁止(chat-recorder / chat-reader 以外)。

## 7. 未解決事項(Open Questions)

| # | 質問内容 | 影響度 | 上流報告先 | 現状の仮定 |
|---|---|---|---|---|
| 1 | 記録証跡の置き換え: dispatch 証跡が消えるため、状態ファイル(記録済み行数)の置き場所・形式・トランスクリプトとの対応付け(session id?)をどうするか | High | 最上位 | ローカル状態ファイル(git 非追跡)。transcript パスまたは session id をキーにする |
| 2 | メタ情報の質: 現方式はメインエージェントが会話文脈から成果物・前提・GitHub 名を供給。ヘッドレスでは誰が供給するか | High | 最上位 | git config はスクリプト取得可。成果物はトランスクリプトの tool_use から機械抽出(ヒント提示)、GitHub 名は git 名で代用し初回のみ確認 |
| 3 | フォールバック: claude CLI が起動できない環境(spawn 失敗・サンドボックス)で現行 block+dispatch 方式へ退避するか | High | 最上位 | 退避する(全ユーザーが使える要件)。spawn 失敗検知時は現行 reason を出す |
| 4 | 多重起動の排他: 短い間隔のターン連発時のロック方式(ロックファイル? 起動前の生存確認?) | Medium | 戦術 | pid 付きロックファイル+stale 判定 |
| 5 | 失敗の可視化: ログ置き場と、次回フック実行時の通知手段(Stop フックの systemMessage / additionalContext?) | Medium | 戦術 | ログファイル+次回フックで stderr か systemMessage |
| 6 | recorder セッションの allowedTools / permission-mode の最小集合(Bash をパターンで絞れるか) | Medium | 戦術 | Read,Write,Edit,Glob,Bash(node/cat/tail/grep パターン) |
| 7 | Windows(非 WSL)での detached spawn 互換(Node child_process spawn detached) | Medium | 戦術 | Node spawn({detached:true, stdio:'ignore'})+unref で対応可 |
| 8 | 案A 部品(prepare/commit スクリプト統合)を同時に入れるか(レイテンシは不可視化されるがトークン消費・堅牢性に効く) | Low | 戦術 | 入れる(ヘッドレスプロンプトの手順が短く安定する) |

## 8. テスト戦略

- 既存: vitest、`plugins/**/__test__/**/*.test.ts`、runTs() による子プロセス実行、stdin モックパターンあり。
- 追加方向: フックの spawn 判断ロジック(状態ファイル比較・ロック・フォールバック分岐)は「spawn する/しない/フォールバック」の判定を純粋関数化して単体テスト。実際の claude 起動はテストではモック(コマンド差し替え可能に)。
- エッジ: コンパクションでトランスクリプトが縮む(行番号が過去より小さくなる)場合の状態ファイル整合。連続ターンの並走。claude 不在環境。

## 9. 依存関係・リスク・制約

- `claude` CLI 2.1.218 の挙動に依存(disableAllHooks / --strict-mcp-config / -p の OAuth)。バージョン差リスクは フォールバック(#3)で吸収する方針。
- ヘッドレスセッションは非 bare のためプラグ価ロードが走る(無効化不可)。MCP は --strict-mcp-config で遮断可能。
- 並走セッションはサブスク quota を比例消費(公式 docs)。Haiku・小プロンプトで軽微。
- Stop フックの timeout(現 15 秒)内に spawn+exit する必要(検証では spawn は即時)。

## 10. 推奨アプローチ(高レベル)

1. フック改修: 走査ロジックは維持しつつ、block の代わりに「状態ファイル比較 → 必要なら detached spawn → exit 0」。spawn 失敗時のみ現行 block 文面へフォールバック。
2. ヘッドレス起動構成: `claude -p <prompt> --model haiku --settings '{"disableAllHooks":true}' --strict-mcp-config --allowedTools ... --permission-mode acceptEdits`(Node spawn detached、cwd=プロジェクト)。
3. recorder プロンプトはフックが組み立て(抽出コマンド・SKILL.md パス・追記先規約・メタ情報ヒントを同梱)。案A 部品(prepare/commit)で手順を短縮。
4. 状態・ロック・ログは 1 つのローカルディレクトリに集約(git 非追跡を案内)。
5. 段階: スクリプト+単体テスト → フック切り替え → 実セッションでの動作検証 → バージョン 0.6.0-dev。

## 11. 補足・暗黙知

- 「dispatch 自体を記録証跡と見なす」現行トリックは、サブエージェントの書き込みがメイントランスクリプトから不可視(isSidechain)なことへの対処だった。ヘッドレス化では書き込み主体がプロセスごと外に出るため、証跡は状態ファイルに一本化するのが素直。
- 過去の失敗経緯: 一時ファイル名の $$ 展開不整合(cab5a71)、セッション番号取得の堅牢化(0791977)など、LLM が手順を誤る余地は繰り返し問題化している。機械化(スクリプト化)への寄せは堅牢性改善でもある。
- 旧設計書が案C(バックグラウンド実行)を却下した理由は「バージョン・環境によるサポート差」。今回それを実機検証+フォールバック設計で解消するというストーリーで、設計書間の整合を取ること。

---

**次のステップ提案**:

- この Context Map を基に詳細設計を作成する(担当: GPT、codex プラグイン経由)。
- 特に確認してほしい Open Questions: #1(状態管理)、#2(メタ情報の質)、#3(フォールバック)。

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に従う。*

> ⚠ 注意: この context-map に API キー・トークン・パスワード等の機密情報を記録しないこと。
