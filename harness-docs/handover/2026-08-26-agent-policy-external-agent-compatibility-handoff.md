# agent-policy 外部 Agent 共存・担当表割当監査 引き継ぎ

## 目的

現在の `agent-policy` プラグインについて、次の観点を監査した結果を次セッションへ引き継ぐ。

- 独自 Agent 定義を持つワークフロープラグインと共存できるか
- 利用者が作成した Agent 定義を認識できるか
- 外部 Agent を担当表の実行帯へ適切に割り当てられるか
- 親 Agent から子 Agent へ再委譲した場合も割当が維持されるか
- Agent 定義の更新や MCP 設定障害が既存 Agent を破壊しないか

監査日は 2026-08-26。監査は読取専用で実施し、`agent-policy` のコード変更は行っていない。

## 結論

現状の評価は次のとおり。

- ワークフロープラグイン固有 Agent との共存は、namespaced 名称とワークフローからの直接 dispatch を使う限り可能。
- 専用 Agent を担当表へ自動転用しない設計は妥当。担当表への参加は `agent-policy-role` marker による明示的な opt-in とするべき。
- 利用者自作 Agent の担当表割当は、project scope のトップ階層 `.claude/agents/*.md` に置かれた定義では概ね機能する。
- user scope、ネストした project Agent、plugin Agent、子 Agent への割当伝播には未対応または欠陥がある。
- 「Claude Code が実行可能な任意 Agent を認識し、全実行階層で担当表へ割り当てる」一般解にはなっていない。

したがって、共存は条件付きで可能だが、外部 Agent の自動担当割当は未完成と判断した。

## 設計上維持するべき境界

- ワークフロー専用 Agent は、marker を宣言しない限り担当表へ参加させない。
- Agent の description や tools から実行帯を推測しない。
- `agent-policy-role` marker を宣言した Agent だけを担当表候補にする。
- ワークフロー専用 Agent は、そのワークフローのオーケストレーターが直接 dispatch する。
- 担当表へ参加した Agent については、親セッションだけでなく再委譲先にも同じ解決結果を渡す。

専用 Agent を汎用実装帯やレビュー帯へ推測割当すると、ツール制限、入力契約、出力形式、オーケストレーター専用という前提を壊す。このため、外部 Agent の「共存」と「担当表への参加」は分けて扱う。

## 監査所見

### 1. Agent 発見範囲が Claude Code の実行可能集合と一致しない

- 重要度: High
- 根拠: `plugins/agent-policy/src/hooks/session-start.ts:67`

SessionStart hook は project の `.claude/agents` を独自に走査している。次の Agent は Claude Code 側で実行可能でも、agent-policy の担当表候補へ入らない。

- user scope の `~/.claude/agents`
- plugin の `agents/`
- CLI や他の設定経路から登録された Agent

根本原因は、agent-policy が Claude Code の解決済み Agent registry ではなく、限定された filesystem scan を正本としていることにある。その結果、Claude Code が認識する Agent 集合と agent-policy が割当可能と判断する Agent 集合が分離する。

### 2. ネストした project Agent を検出しない

- 重要度: High
- 根拠: `plugins/agent-policy/src/hooks/session-start.ts:94`

scanner は非再帰。たとえば `.claude/agents/reviewers/security.md` が Claude Code にロードされても、role marker、alias、role 完全性の検査対象にならない。

必要な対応は、Claude Code と同じ探索規則を使うか、少なくとも project Agent を再帰走査すること。

### 3. role marker の解決結果が親セッションにしか存在しない

- 重要度: High
- 根拠: `plugins/agent-policy/assets/roles/ja/_common.md:13`

marker から Agent 名への対応表は SessionStart で親セッションへ注入される。実装 Agent がさらに advisor や reviewer を呼ぶ場合、子 Agent は親の解決済み対応表を持たない。

例として `advisor` role に任意名 `arbiter` を割り当てても、親は `arbiter` を選択できる一方、子 Agent は既定の Fable または Opus へ fallback し得る。

原因は次の二段階。

1. role 解決が SessionStart のコンテキスト注入だけに依存している。
2. dispatch payload に解決済み role map を同梱していない。

### 4. 廃止済み Agent が担当表候補から除外されない

- 重要度: High
- 根拠: 2026-08-26 の実セッションで観測

同じ SessionStart 出力内で、`grok-researcher` が role marker 優先先として注入される一方、「廃止済みで削除対象」とも注入された。

これは stale project Agent の検知処理と role 解決処理が別基準で動いていることを示す。廃止または無効と判断した Agent は、警告するだけでなく担当表候補集合から除外する必要がある。

### 5. preset 名と model alias の一致だけで role 完全性検査を回避できる

- 重要度: High
- 根拠: `plugins/agent-policy/src/hooks/session-start.ts:231`

preset 名を持つ定義の model alias が期待値と一致すると、role marker が不足していても警告されない。

例として `.claude/agents/gpt-terra.md` が期待 alias を使い、`agent-policy-role: explore` だけを宣言した場合、`normal-impl` や `general` の不足を検出できない。

Agent ファイルの存在確認、model alias の一致、active policy に必要な role の完全性は別々に検証する必要がある。

### 6. active policy ではなく preset 横断 role union を要求する

- 重要度: Medium
- 根拠: `plugins/agent-policy/src/hooks/session-start.ts:247`

`codex-grok-policy` で Grok が担当する role を正しく宣言していても、別 policy でのみ Grok が担う `normal-impl`、`light-impl`、`general` まで不足警告の対象になる。

検証対象は preset が取り得る全 role の union ではなく、現在有効な policy の role set に限定する必要がある。

### 7. MCP 列挙失敗時に空集合として merge write を続行する

- 重要度: High
- 根拠: `plugins/agent-policy/src/agents/mcp.ts:83`

`claude mcp list` が timeout、CLI 不在、非ゼロ終了になった場合、全 MCP server が存在しないものとして処理される。`--write --merge` を続行すると、既存 Agent の有効な `mcp__*` tool grant を削除し得る。

一時的な外部障害が Agent 定義の破壊へ変換されるため、MCP 列挙に失敗した場合は write を中止する fail-closed 動作が必要。

### 8. `--check` が template 側だけにある frontmatter key を説明しない

- 重要度: Medium
- 根拠: `plugins/agent-policy/src/setup-agents.ts:340`

新 template にだけ `disallowedTools` などの key が追加された場合、`--check` は `identical: false` を返しても追加予定 key を表示しない。

利用者は次の write で権限制限が追加されることを事前確認できない。比較処理は既存側と template 側の key union を対象にする必要がある。

### 9. SessionStart と setup CLI の frontmatter parser が一致しない

- 重要度: Medium
- 根拠: `plugins/agent-policy/src/setup-agents.ts:115`

両処理で delimiter と whitespace の扱いが異なる。末尾空白付き `model:` は SessionStart では trim 後に一致し、`--check` では semantic change と判定され得る。

frontmatter parse と正規化処理を共通化する必要がある。

### 10. custom role label の言語選択が filesystem 順に依存する

- 重要度: Low
- 根拠: `plugins/agent-policy/src/hooks/session-start.ts:145`

`roles/en/triage.md` と `roles/fr/triage.md` のように複数言語で同じ custom role を定義した場合、`readdirSync` の返却順で label が決まる。OS や filesystem によって SessionStart の言語が変わり得る。

有効 locale の明示選択と deterministic sort が必要。

### 11. bulk setup が同じ fragment を繰り返し読む

- 重要度: Low
- 根拠: `plugins/agent-policy/src/agents/fragments.ts:110`

`codex-grok-policy` の一括生成で、default name の生成、composition、role description 比較ごとに同じ fragment directory を再読込する。監査では約 22 回の同期 scan/read が発生する経路を確認した。

正しさへの直接影響はない。1 回ロードした fragment map を処理単位で共有すれば解消できる。

## Claude Code 仕様との関係

Context7 で公式 Claude Code リポジトリの plugin structure を確認した。

- plugin の `agents/` にある Markdown Agent は自動発見される。
- plugin component は統合して登録される。
- 同名 conflict は暗黙上書きではなくエラーになる。
- `claude agents` コマンドは Claude Code 2.1.50 で追加され、設定済み Agent の一覧取得経路として利用できる。

参照:

- <https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/plugin-structure/SKILL.md>
- <https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/plugin-structure/references/manifest-reference.md>
- <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

`claude agents` の出力が機械可読形式を保証するかは未確認。実装で利用する場合は、現在の CLI 契約を追加確認する。

## 推奨修正順

### P0: Agent discovery と role 解決を一貫させる

1. Claude Code の解決済み Agent 一覧を取得できる正式経路を調査する。
2. 正式 registry を直接取得できない場合は、project、user、plugin の各 scope を同じモデルへ正規化する adapter を作る。
3. project scope の filesystem fallback は再帰走査する。
4. 各 Agent に source scope、namespace、definition path、resolved name を保持する。
5. duplicate name や conflict は曖昧な優先順位で選ばず、エラーとして扱う。

### P0: marker を明示 opt-in として固定する

1. marker 未宣言の workflow 専用 Agent は担当表候補から除外する。
2. description、tools、Agent 名から role を推測しない。
3. deprecated、invalid、conflict 状態の Agent は警告後も候補へ残さない。
4. active policy の role set だけで完全性を検証する。

### P0: 解決済み role map を再委譲先へ伝播する

1. 親 SessionStart 注入だけを正本にしない。
2. GPT/Grok Agent へ定義本文を同梱する既存 dispatch 処理に、解決済み role map も同梱する。
3. 実装 Agent が advisor、reviewer、explorer を再委譲する場合も同じ map を使う。
4. map に該当 role がない場合だけ policy fallback を使う。

### P1: setup と検証を fail-closed にする

1. MCP server 列挙失敗時は Agent ファイルを書き換えない。
2. `--check` は既存と template の key union を比較する。
3. SessionStart と setup CLI で frontmatter parser と正規化処理を共通化する。
4. alias 一致と role 完全性を独立して検証する。

### P2: deterministic 化と性能改善

1. locale を明示選択する。
2. directory entry を sort してから処理する。
3. fragment map を setup 単位でキャッシュする。

## 必要なテスト行列

最低限、次の組合せを追加する。

### Agent scope

- project top-level Agent
- project nested Agent
- user Agent
- plugin Agent
- 同名 Agent conflict
- deprecated project override

### policy と role

- `claude-model-policy`
- `codex-grok-policy`
- policy ごとの必須 role 完全一致
- 他 policy にだけ存在する role を要求しないこと
- marker 未宣言 Agent を割り当てないこと
- marker 複数宣言

### dispatch 階層

- 親から直接 dispatch
- 実装 Agent から advisor へ再委譲
- 実装 Agent から reviewer へ再委譲
- fallback 使用
- project custom Agent が fallback より優先されること

### setup 安全性

- `claude mcp list` 成功
- timeout
- CLI 不在
- 非ゼロ終了
- template 側だけにある frontmatter key
- trailing whitespace
- delimiter 差異
- 複数 locale

## 現時点の安全な運用条件

修正前は次の運用に限定する。

- Workflow 専用 Agent は marker を宣言せず、Workflow から直接 dispatch する。
- 担当表へ参加させる custom Agent はトップ階層 `.claude/agents/*.md` に置く。
- custom Agent は active policy で必要な role marker を明示する。
- 子 Agent が親と同じ custom role map を使う前提を置かない。
- `setup-agents --write --merge` は `claude mcp list` の正常動作確認後にだけ実行する。
- Agent 名を他 scope や他 plugin と重複させない。

## 未実施事項

- `agent-policy` の修正
- 修正設計書の作成
- 実装計画書の作成
- unit test の追加
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run build`
- Claude Code 実機での project/user/plugin Agent 解決順検証
- `claude agents` の機械可読出力契約確認

監査エージェントの結果にはテスト実行証跡が含まれていない。このため、監査所見は静的解析結果として扱い、修正着手前に既存テストと再現テストを実行する。

## 次セッション開始手順

1. この文書を読む。
2. `git status` を確認し、既存の未コミット変更を上書きしない。
3. 各所見の対象コードを現行 HEAD で再確認する。
4. 既存テストを実行して baseline を記録する。
5. P0 の discovery、marker opt-in、role map 伝播について設計を作る。
6. 設計書と実装計画書を Haiku reviewer、Grok independent reviewer の順でレビューする。
7. 承認後、テストを先に追加して実装する。
8. plugin version、README、bundle、必要な architecture 文書を Done 条件に従って更新する。

## 作業ツリーに関する注意

監査開始時点で、この監査と無関係な未コミット変更および未追跡ファイルが存在していた。次セッションでは、それらを revert、削除、上書きしない。修正対象を決める前に最新の `git status` と diff を確認する。
