# agent-policy setup-agents の MCP deny 保持を安全化する起動プロンプト

以下を goal コマンドの入力として使う。

---

agent-policy 0.19.2-dev の setup-agents で、`--mcp-servers` を指定して再生成すると既存の MCP deny が消える挙動を見直せ。これは意図的な実装であり、修正方法は引き継ぎ書の確定事実・判断・比較に従って決める。

## 入力文書

`harness-docs/handover/2026-09-17-agent-policy-setup-agents-deny-preservation-handover.md` を最初に読む。現在地、確定事実、推奨する方針、選択肢、完了条件、スコープ外、参照先はこの 1 本にある。context-map と過去の会話記録は読み直さない。

## 進め方

1. `git status` と HEAD を確認する。本件と無関係な未コミット変更は触らない。
2. `pnpm run lint`、`pnpm run typecheck`、`pnpm run test` を実行し、baseline を確認する。
3. 引き継ぎ書 §2 の実装・テスト・`GOTCHA-001`・README・setup-agents スキルを開く。
4. 引き継ぎ書 §3 の A〜C を比較して修正方針を選ぶ。推奨は A と C の併用である。設計判断は、設計書を新規作成するか既存文書へ追記して記録する。
5. 実装とテストを変更する。現行テストが deny 消失を正としているため、テストが通らないことを理由に変更を諦めず、テストの意図から変更する。
6. README、手順、メモリを引き継ぎ書 §4 に従って追随させる。AI 向け指示書の執筆は担当表の「文書作成」役へ委譲する。
7. `GOTCHA-001` に、採用方針と修正内容を理由として `[解決済み]` タグを付ける。
8. `pnpm run lint`、`pnpm run typecheck`、`pnpm run test` を通す。`src/` を変更するため `pnpm run build` を実行し、生成された `scripts/` の差分を同じコミットに入れる。
9. バージョンを上げ、関連する変更を適切な単位でコミットする。

## 制約

- `--mcp-deny` を毎回明示する運用だけで解決したことにしない。再発しない実装と診断を検討する。
- 切断済みサーバーの deny を残さないという現行実装の意図を失わない。
- `harness-docs/GOTCHAS.md` を直接編集しない。`node <metatron の CLI> tag-gotcha --id GOTCHA-001 --tag 解決済み --reason "<理由>"` を使う。
- `plugins/agent-policy/.claude-plugin/plugin.json` と `package.json` のバージョンを揃えて上げる。開始時点は `0.19.2-dev` である。
- 手順が変わる場合だけ `plugins/agent-policy/skills/setup-agents/SKILL.md` を追随させる。
- `.serena/memories/agent_policy/core.md` と食い違う場合は追随させる。
- ブランチを切らない。`git push` に `--force` 系を付けない。`plugins/*/scripts/` を直接編集しない。
- 本件と無関係な作業ツリーの変更を revert・削除・上書き・コミット混入しない。

## 完了報告に含めること

- 採用した方針と、採用しなかった案の扱い
- 実装・テスト・文書・メモリ・`GOTCHA-001` の追随結果
- 実行した検証と結果
- 変更後のプラグインバージョンとコミット一覧
- 残る判断事項または未解決事項
