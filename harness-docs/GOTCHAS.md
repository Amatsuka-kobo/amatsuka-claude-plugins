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

### [2026-09-18] GOTCHA-002: 委譲の依頼文に書いた説明用の例が成果物へ入った

**タスク**: AI が読む指示書の 1 項目の改訂を、文書作成の役割へ委譲した。
**失敗内容**: 依頼文に説明のために挙げた語の例が、成果物の本文へそのまま入った。判断の軸を示すはずの項目が、特定の語を列挙して「これらを避ける」と読める文になった。
**原因 (推測)**: 委譲先は依頼文に現れた例を要件の一部として扱う。説明のための例か成果物に書く内容かを区別しないと、例が本文へ入る。
**対策**: orchestration-discipline.md に従って文書作成を委譲するとき、依頼文の各例に、成果物の本文へ書くものか説明のためのものかを明記する。説明のためのものには「本文には書かない」と添える。plugins/*/skills/*/SKILL.md と plugins/*/references/ と .claude/rules/ の項目を書き換える依頼では、語の例を渡さず判断の軸だけを渡す。
**昇格候補**: Yes

### [2026-09-17] GOTCHA-001: setup-agents の再生成で disallowedTools を消した

**タスク**: agent-policy の役割断片を変更した後、このリポジトリの .claude/agents/ にある 14 の Agent 定義を plugins/agent-policy/scripts/setup-agents.mjs で再生成し、本文の変更を反映しようとした。
**失敗内容**: --write --merge --mcp-servers で再生成するときに --mcp-deny を渡さず、再生成した 10 定義のうち disallowedTools を持つ 5 定義（complex-reviewer、docs-reviewer、general-explore、document-writer、realtime-researcher）から設定を消した。これにより、読み取り専用の役割を持つ定義から、Serena の書き込み系ツール 11 個の禁止が外れた。バックアップとの差分で削除を見つけ、--mcp-deny を明示して再生成し復元した。
**原因 (推測)**: 書き込み前の --check が frontmatter.keysOnlyInExisting に disallowedTools を返したため、保持マージの対象だと誤認した。keysOnlyInExisting はテンプレートにない既存キーを列挙するだけで保持を示さず、MCP 由来の frontmatter は --mcp-* 引数から再構築されるため、--mcp-deny を省くと空になる。生成後の kept が空配列であることが唯一の兆候だったが、書き込み後にしか確認できなかった。
**対策**: plugins/agent-policy/scripts/setup-agents.mjs の --write に --mcp-servers を渡すときは、同じコマンドに、事前の --check が返す mcpCurrent.denyTools を値として --mcp-deny も渡す。git 追跡外の .claude/agents/ を再生成する前に別ディレクトリへ複製する。生成後に複製との差分を取り、削除された行がないことを確認する。
**昇格候補**: Yes
