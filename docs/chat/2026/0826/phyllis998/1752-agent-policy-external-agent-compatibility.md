# agent-policyの外部エージェント定義との互換性検証

- 日付: 2026-08-26
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: 不明
- セッション ID: 1997a087-a8b8-4304-913f-93b6590ad5f2

---

## セッション 1: agent-policyの外部エージェント定義との互換性を検証

# phyllis998

> 現在のagent-policyプラグインが、独自のエージェント定義を使ったワークフロープラグインや、利用者が自前で作ったエージェント定義などと共存し、それらを適切に担当表に当てはめることができるかを監査してください。

## セッション 2: 監査結論の提示と引継資料準備

# AI

監査中。対象: 役割解決順序、外部 Agent 定義取込、Workflow 専用 Agent 保護、重名衝突、テスト網羅。

監査継続中。

監査エージェント完了待ち。

# 監査結論

**共存: 条件付き可。自動担当割当: 未完成。**

- ワークフロープラグイン固有 Agent: namespaced 名称＋直接 dispatch → 共存可能。
- 専用 Agent を担当表へ自動転用しない設計 → 正解。`agent-policy-role` 宣言時だけ割当対象にすべき。
- 利用者自作 Agent: トップ階層 `.claude/agents/*.md`＋role marker なら概ね動作。
- `~/.claude/agents`、ネスト Agent、プラグイン Agent、孫 Agent 以降への割当伝播 → 不完全。
- よって「任意 Agent 定義を認識し、全実行階層で担当表へ割当」は未達。

`★ Insight ─────────────────────────────────────`
専用 Workflow Agent は汎用担当表へ推測割当すると壊れる。正しい境界 = 「存在は共存」「担当表参加は marker で明示 opt-in」。
`─────────────────────────────────────────────────`

## 重大所見

### 1. Agent 発見範囲不足 — High

`plugins/agent-policy/src/hooks/session-start.ts:67`

SessionStart scanner 対象 = project `.claude/agents`。以下未認識:

- user scope `~/.claude/agents`
- plugin `agents/`
- CLI/API 経由 Agent

Claude Code 側には見えるが agent-policy 担当表には見えない。

原因:

1. 独自 filesystem scan 使用
2. Claude Code 解決済み Agent registry と非同期
3. 結果、実行可能 Agent 集合 ≠ 担当表候補集合

### 2. ネスト Agent 未認識 — High

`plugins/agent-policy/src/hooks/session-start.ts:94`

scanner 非再帰。例:

```text
.claude/agents/reviewers/security.md
```

Claude Code がロードしても marker 未検出。担当表注入・alias 検査・不足 role 警告すべて対象外。

### 3. 割当情報が親セッション限定 — High

`plugins/agent-policy/assets/roles/ja/_common.md:13`

marker→Agent 名対応 SessionStart 親コンテキストだけへ注入。

例:

```text
advisor → arbiter
```

親は `arbiter` 選択可能。実装 subagent は対応表不所持 → Fable/Opus fallback。Workflow 内再委譲ほどズレ拡大。

原因:

1. role 解決 = SessionStart 注入依存
2. dispatch payload へ解決済み表未同梱
3. 子 Agent 独自 fallback 実行

### 4. 廃止 Agent が担当表へ残留 — High

現セッション実証:

- `grok-researcher` を role marker 優先先として注入
- 同じ SessionStart 内で「廃止済み、削除対象」と注入

つまり stale project Agent を検知しても、担当候補から除外しない。警告系と role 解決系の判定不一致。

### 5. preset 名＋alias 一致で marker 完全性検査回避 — High

`plugins/agent-policy/src/hooks/session-start.ts:231`

例:

```yaml
name: gpt-terra
model: my-terra
```

alias 一致だけで検査通過。`agent-policy-role: explore` しかなくても `normal-impl` / `general` 不足警告なし。

結果: Agent 存在確認成功、担当表網羅性失敗。

## 中所見

### 6. active policy 外 role まで要求 — Medium

`plugins/agent-policy/src/hooks/session-start.ts:247`

`codex-grok-policy` 使用時も、別 policy で Grok が担う `normal-impl` / `light-impl` / `general` まで不足判定。

正しい custom Grok 定義でも偽警告。検証対象 = preset 横断 union ではなく active policy role set が必要。

### 7. MCP 列挙失敗時 fail-open 上書き — High

`plugins/agent-policy/src/agents/mcp.ts:83`

`claude mcp list` timeout・CLI 不在・非ゼロ終了 → 空 server 集合扱い。

`--write --merge` 続行 → 既存 `mcp__*` grant 削除。外部 Agent 共存時、必要 tool 権限を一時障害だけで破壊。

必要挙動: 列挙失敗時 write 中止。

### 8. `--check` が新規 frontmatter key を説明しない — Medium

`plugins/agent-policy/src/setup-agents.ts:340`

新 template のみ存在する `disallowedTools` 等を差分表示しない。`identical: false` だけ返る。

権限制限追加を利用者が事前判断不能。

### 9. frontmatter parser 不一致 — Medium

`plugins/agent-policy/src/setup-agents.ts:115`

SessionStart と setup CLI で delimiter / whitespace 処理差異。末尾空白付き `model:`:

- SessionStart: trim 後 alias 一致
- `--check`: 差分扱い

同一 Agent へ異なる判定。

## 軽微所見

- `plugins/agent-policy/src/hooks/session-start.ts:145`  
  同名 custom role label を filesystem 順で選択。`roles/en` / `roles/fr` 共存時、OS 依存言語。
- `plugins/agent-policy/src/agents/fragments.ts:110`  
  bulk setup 中、同じ fragment 群を約22回再読込。正しさ影響なし、同期 I/O 浪費。

## 現状で安全な運用

- Workflow 専用 Agent: marker 未宣言、Workflow が直接 dispatch。
- 担当表へ参加させる custom Agent: top-level `.claude/agents/*.md` に配置し、必要 role 全宣言。
- 子 Agent 再委譲: 親と同じ割当が使われる前提を置かない。
- `setup-agents --write --merge`: `claude mcp list` 正常確認後だけ実行。
- 重名回避。公式 Claude Code plugin 仕様上、plugin Agent は自動登録、名前衝突は上書きでなくエラー。

## 推奨修正順

1. Claude Code 解決済み Agent 一覧を正本化。最低限 project/user/plugin scope＋再帰 scan。
2. 専用 Workflow Agent は marker 明示時だけ担当表参加。
3. 解決済み role map を全 dispatch payload へ同梱。
4. active policy 単位で role 完全性検証。
5. deprecated / invalid Agent を候補集合から除外。
6. MCP 列挙失敗時 write 禁止。
7. parser 共通化＋scope/nesting/親子再委譲/衝突/MCP failure の matrix test。

**判定: 現状「共存」は可能。「適切な自動担当割当」は project top-level Agent の親セッション内だけ。一般解として未達。**

静的監査のみ。変更なし。テスト実行証跡なし。

別件: 原始人 statusline バッジ未設定。必要なら `statusline-setup` で設定可能。

以上。

監査結果 前報どおり。

# phyllis998

> 今回の結果を引き継ぎ資料に書き出してください
