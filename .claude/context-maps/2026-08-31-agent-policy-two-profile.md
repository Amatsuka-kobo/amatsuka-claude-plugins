# Context Map: agent-policy 2 プロファイル化(claude / custom)

**作成日**: 2026-08-31
**作成者**: Fable(探索統括)。探索実働: Grok(agent-policy:grok)
**対象タスク**: agent-policy を claude / custom の 2 プロファイル構成へ再編し、setup-agents を /v1/models 接地の custom 専用ウィザードへ改修、delegation gate と並列促し hook を同梱する。
**関連するBlueprintセクション**: harness-docs/design/2026-08-24 / 2026-08-25 / 2026-08-27 の agent-policy 設計 3 本

---

## 1. 目的・スコープ

- 4 方針(claude-model / with-codex / with-grok / codex-grok)を claude(レガシー・モデル名担当表)と custom(role-id 担当表 + マーカー解決)の 2 プロファイルへ再編する。
- スコープ内: 方針スキル再編、policies.ts 再構造、/v1/models クライアント、SessionStart の検証+全体一括フォールバック、setup-agents 改修、delegation gate 同梱(opt-in)、PreToolUse(Task) 並列促し。
- スコープ外: このリポジトリ自身の運用切替(env 変更・ローカル gate の撤去)、SubagentStart の機構変更、監査所見 4〜11。

## 2. 現在のコードベース構造(0.13.1-dev)

### 2.2 重要なファイル一覧

| ファイルパス | 役割 | 重要度 |
| --- | --- | --- |
| `src/agents/policies.ts` | 担当表正本。POLICIES 4 件(`policies.ts:40-57`)・MODELS 8 件(`60-129`, aliasEnv 4 変数)・ASSIGNMENTS 4×10(`133-182`)・AGENT_DENIED_MODELS/SOLO_DENIED_ROLES(`187-196`)・resolveModelValue(`242-249`) | High |
| `src/hooks/session-start.ts` | 注入 5 ブロック(policy/marker/unknownRole/setup/retired)。`AMATSUKA_AGENT_AUTO_INJECTION` 分岐(`53-61`)。ALIASES(`30-51`)。RETIRED(`17-22`)。fail-open | High |
| `src/hooks/marker-scan.ts` | `.claude/agents/*.md` の frontmatter 走査 → MarkedAgent{name,model,roles,tools}。markerTable(`186-210`) | High |
| `src/hooks/subagent-start.ts` | SubagentStart 配布。deny-list 選別、`references/subagent-discipline.md` + marker 表合成、9500 字上限、fail-open | Medium |
| `src/setup-agents.ts` | CLI。parseArgs(`784-918`)。`--policy` 必須系、`--list-*` 7 種、`--write/--merge/--keep`、モデル解決は resolveModelValue | High |
| `hooks/hooks.json` | SessionStart + SubagentStart(matcher なし、timeout 10) | High |
| `skills/{4 方針}/SKILL.md` | 担当表 + dispatch 節 + 独立レビュー手順 + フォールバック + 実行帯の解決順 | High |
| `skills/setup-agents/SKILL.md` | 7 ステップウィザード。allowed-tools で CLI 限定 | High |
| `references/orchestration-discipline.md` | 共通規律。§委譲先の実行モデルの確定(判定フロー 8 行、「帯モデル」概念) | High |
| `assets/roles/{ja,en}/` | _common + 役割 10 断片 + `realtime-research.grok.md`(ベンダー別 overlay、`fragments.ts:123-152`) | Medium |
| `build.ts` | 3 エントリ → scripts/*.mjs + buildPresets(ja 断片から agents/{gpt-sol,gpt-terra,gpt-luna,grok}.md 生成) | Medium |
| リポジトリ `.claude/settings.json:69-82` + `tools/delegation_gate.py` + `scripts/direct-edit.sh` | ローカル delegation gate(同梱版の原型)。agent_id で subagent 素通し、mtime TTL 7200 | High |

## 3. 関連モジュール・データフロー

- policies.ts → setup-agents.ts(選択肢・検証)/ session-start.ts(注入)/ build-presets.ts(同梱プリセット導出)。
- marker-scan.ts → session-start.ts / subagent-start.ts が共用(対応表の同一性テストあり)。
- 断片(assets/roles) → fragments.ts → compose.ts → setup CLI / build-presets。

## 4. 既存パターン・規約

- フックは読むだけで書かない・fail-open(stderr + exit 0)。
- `.claude/agents/` への書き込みは setup CLI のみ(スキルは Write 禁止・Edit パス限定)。
- 担当表はコード正本(policies.ts)、スキルの表は表示用。プリセットは導出でずれ防止。
- プラグインスクリプトは TypeScript → esbuild → scripts/*.mjs(git 管理)。
- ANTHROPIC_API_KEY を前提にしない(CLAUDE.md 規律)。

## 5. 変更の影響範囲

### 5.1 直接影響

- policies.ts(POLICIES 2 件化・RECOMMENDED 新設・aliasEnv 廃止)、session-start.ts(setupBlock 置換・フォールバック判定)、setup-agents.ts(custom 専用化・live models)、hooks.json(PreToolUse 2 エントリ追加)、方針スキル(3 本削除・custom-policy 新設・claude-model-policy 改訂)、setup-agents SKILL、orchestration-discipline(帯モデル定義)、build.ts、README。

### 5.2 間接波及

- subagent-start.ts: 機構は不変だが、custom フォールバック時に親(claude 表)と子(marker 表)の解決が乖離し得る。
- 8/27 設計の判定フロー: 「帯モデル」の参照先が custom で marker 定義の model になる。enum 読み替え先として claude-model-policy の ASSIGNMENTS 維持が必須。
- 同梱プリセット 4 定義(agents/*.md): custom の実行帯の解決順から役割が消えるため存廃判断が要る。
- 既存テスト群(policies/presets/compose/setup-agents/session-start/subagent-start)。

### 5.3 変更を避ける箇所

- marker-scan.ts の走査契約(SessionStart/SubagentStart の対応表同一性)。
- subagent-discipline.md と SubagentStart の合成・切り詰め機構。
- 断片フォーマット・翻訳機構(source-hash)・compose の語彙機構。

## 6. 守るべき既存契約

- `agent-policy-role` マーカーの意味(帯参加 + 合成ホスト候補)。既存生成定義は無改変で custom に有効であること。
- setup CLI の応答形式(ok/error、results 配列)と `--check/--write/--merge/--keep` の差分保護。
- フックの fail-open と「ファイルを書かない」原則(gate の TTL フラグは解除 CLI = ユーザー操作の書き込みであり、hook 実行経路では書かない)。
- Claude Code 仕様: PreToolUse は plain stdout が Claude に届かず、`hookSpecificOutput.additionalContext` が必要。deny の reason は Claude に見える。matcher は英数+`|` で exact 列挙。
- /v1/models 実測(2026-08-31、CLIProxyAPI): `{data:[{id, owned_by}]}`。エイリアス名が id に載る。owned_by = openai/anthropic/xai。

## 7. 未解決事項(Open Questions)

| # | 質問内容 | 影響度 | 上流報告先 | 現状の仮定 |
| --- | --- | --- | --- | --- |
| 1 | 同梱 GPT/Grok プリセット 4 定義の存廃(custom では役割ベース解決から外れる) | High | ユーザー | 廃止を推奨(二重管理解消)。設計書で要承認 |
| 2 | Agent tool の hook 上の tool_name(`Task` か `Agent` か) | Medium | 実装時検証 | `Task|Agent` の exact 列挙 matcher で両対応 |
| 3 | 並列促し hook の既定(有効 or 無効) | Medium | ユーザー | 既定有効 + opt-out env を提案 |
| 4 | /v1/models の認証(ANTHROPIC_AUTH_TOKEN 無し環境) | Low | 実装時検証 | Bearer(AUTH_TOKEN) → x-api-key(API_KEY) → 無認証の順で 1 回試行、失敗は照会失敗扱い |

## 8. テスト戦略

- 既存: vitest、`plugins/**/__test__/**/*.test.ts`、runTs 子プロセス実行、fake バイナリは src/testing/。
- 追加方向: live-models のパースとフォールバック(HTTP は src/testing のフェイクサーバー)、session-start の custom 検証分岐、gate 判定(glob/agent_id/TTL/config 欠落)、nudge 出力、policies 2 件化の網羅、setup CLI の新フラグ検証。

## 9. 依存関係・リスク・制約

- hooks.json 変更は全セッション挙動に波及(保護パス規律: 新セッションで発火確認)。
- PreToolUse(broad matcher) は MCP 呼び出しごとに node 起動コスト(env off なら即終了)。
- gate は Bash 経由の書き込みを技術的に止めない(文言のみ。ローカル版と同じ穴)。
- セッション途中のプロキシ状態変化は検知しない(SessionStart 時点の判定で固定)。

## 10. 推奨アプローチ

1. policies.ts の 2 プロファイル化と RECOMMENDED を先に確定(全変更の正本)。
2. live-models クライアント → session-start 検証フロー → setup-agents 改修の順。
3. gate / nudge は独立モジュールとして並行実装可。
4. スキル・規律文書の改訂は実装と同コミット系列で追随。
5. 旧スキルディレクトリ削除はクラシファイア拒否時ユーザーの手で。

## 11. 補足・暗黙知

- 過去の不採用案を再提案しない: UserPromptSubmit 毎ターン注入、output style への system prompt 原文引用、割当マップ、派生定義生成、CLAUDE.md 焼き込み。
- フォールバックは全体一括(ユーザー決定 2026-08-31)。帯単位は不採用。
- 旧 injection 値 3 種は custom 扱い + 移行通知(ユーザー決定)。
- 8/27 設計の「ASSIGNMENTS は変更しない」は本改修で上書きされる(方針転換)。

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に従う。機密情報は記録しない。*
