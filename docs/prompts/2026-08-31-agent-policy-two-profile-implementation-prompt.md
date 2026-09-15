# agent-policy 2 プロファイル化 実装セッション起動プロンプト

以下を /goal コマンドの入力として使う。

---

agent-policy プラグインの「2 プロファイル化(claude / custom)」を実装する。

## 入力文書

- 設計書(正本): `harness-docs/design/2026-08-31-agent-policy-two-profile-design.md`
- context-map: `.claude/context-maps/2026-08-31-agent-policy-two-profile.md`
- 参考(現行機構の設計): `harness-docs/design/2026-08-25-agent-policy-setup-agents-design.md`、`harness-docs/design/2026-08-27-agent-policy-external-agent-model-assignment-design.md`

設計書はレビュー(doc-review 帯 + independent-review 帯)とユーザー承認を経た確定版である。設計判断を問い返さず、設計書の記述を正として実装する。設計書と実装が食い違う事実を発見したときだけ、実装を止めてユーザーへ報告する。

## 進め方

1. セッションに注入された agent-policy の運用方針スキルを最初に読み、その規律(担当表・並列 dispatch・レビュー手順)に従う。
2. 最新の `git status` と HEAD を確認し、`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の baseline を記録する。本改修と無関係な未コミット変更・未追跡ファイルは revert・削除・上書きしない。
3. 設計書 §10 の実機検証(PreToolUse の tool_name、additionalContext の到達、/v1/models の認証分類、旧 injection 値の挙動、hooks 発火)を**実装より先に**行う。食い違いがあれば設計書へ反映し、ユーザーへ報告して承認を得てから続行する。
4. 設計書から実装計画(タスク分割・順序・各タスクの検証方法)を立案し、doc-review 帯のレビューを通してからユーザーへ提示し、承認を得て実装に入る。
5. テストを先に書いてから実装する(設計書 §12 のテスト方針)。
6. スキル・エージェント定義・references の新規作成と改稿は、プロジェクトの規約が指定するツール(prompt-smith 系)を使う。

## 制約

- バージョンは `0.13.1-dev` → `0.14.0-dev`。`plugin.json` と `package.json` を揃える。
- `plugins/*/scripts/` と `plugins/*/agents/` は手で編集しない。`src/` を変更して `pnpm run build` で再生成し、差分を同じコミットに含める。
- Anthropic API クライアントを追加しない。`ANTHROPIC_API_KEY` を前提にしない(live models クライアントは設計書 §5.2 の認証フォールバックに従う)。
- 旧スキルディレクトリ・同梱プリセットの削除がクラシファイアに拒否されたときは、絶対パスを提示してユーザーの手で実行してもらう。
- フックは fail-open(例外時 stderr + exit 0、ファイルを書かない)を維持する。

## Done 条件(設計書 §14 と同一)

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
- `src/` 変更に対応する `scripts/` 差分と `agents/` の削除が同じコミットにある。
- ルート README・`plugins/agent-policy/README.md`(移行節)・`.claude-plugin/marketplace.json` に反映済み。
- hooks.json の追加エントリが新セッションで発火することを確認済み。
- `/metatron:update` で ARCHITECTURE(同梱エージェント表・フック構成)を追随させる。
- `.serena/memories/` のうち方針スキル 4 本を前提とする記述を更新する。
