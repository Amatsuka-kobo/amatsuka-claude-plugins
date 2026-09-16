# GOTCHAS

このプロジェクトで AI が実際にやってしまった失敗のパターンを蓄積する。
発見された失敗を、下記のフォーマットで追記していく。

## 運用ルール

- 新しいものを上に追加する。
- 同じパターンが 5 件以上蓄積されたら、スキルまたは Hook への昇格を検討する。
- 解決済みの項目は `[解決済み]` タグを付けて残す。削除しない。
- 陳腐化した項目は `[対象外]` タグを付けて残す。削除しない。

## 記入テンプレート

### [YYYY-MM-DD] GOTCHA-NNN: 失敗のタイトル

**タスク**: (何をしようとしていたか)
**失敗内容**: (具体的に何を間違えたか)
**原因 (推測)**: (なぜそうなったか)
**対策**: (今後 AI はどう振る舞うべきか)
**昇格候補**: Yes / No (スキルや Hook にするべきか)

## 失敗パターン一覧

### [2026-09-17] GOTCHA-001: setup-agents の再生成で disallowedTools を消した

**タスク**: agent-policy の役割断片を変更した後、このリポジトリの .claude/agents/ にある 14 の Agent 定義を plugins/agent-policy/scripts/setup-agents.mjs で再生成し、本文の変更を反映しようとした。
**失敗内容**: --write --merge --mcp-servers で再生成するときに --mcp-deny を渡さず、再生成した 10 定義のうち disallowedTools を持つ 5 定義（complex-reviewer、docs-reviewer、general-explore、document-writer、realtime-researcher）から設定を消した。これにより、読み取り専用の役割を持つ定義から、Serena の書き込み系ツール 11 個の禁止が外れた。バックアップとの差分で削除を見つけ、--mcp-deny を明示して再生成し復元した。
**原因 (推測)**: 書き込み前の --check が frontmatter.keysOnlyInExisting に disallowedTools を返したため、保持マージの対象だと誤認した。keysOnlyInExisting はテンプレートにない既存キーを列挙するだけで保持を示さず、MCP 由来の frontmatter は --mcp-* 引数から再構築されるため、--mcp-deny を省くと空になる。生成後の kept が空配列であることが唯一の兆候だったが、書き込み後にしか確認できなかった。
**対策**: plugins/agent-policy/scripts/setup-agents.mjs の --write に --mcp-servers を渡すときは、同じコマンドに、事前の --check が返す mcpCurrent.denyTools を値として --mcp-deny も渡す。git 追跡外の .claude/agents/ を再生成する前に別ディレクトリへ複製する。生成後に複製との差分を取り、削除された行がないことを確認する。
**昇格候補**: Yes
