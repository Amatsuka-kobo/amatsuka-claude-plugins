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

### [2026-09-28] GOTCHA-004: lindera の npm パッケージを ESM でバンドルすると Dynamic require で落ちた

**タスク**: native-japanese の hook(esbuild で ESM の .mjs にバンドルする)から lindera 6.2.0(N-API)を使えるか確かめるため、npm の lindera パッケージを import してバンドルした。
**失敗内容**: esbuild の --format=esm でバンドルした成果物を実行すると、Error: Dynamic require of "fs" is not supported で失敗した。lindera の index.js が内部で require('fs') を呼び、esbuild がこれを ESM 非対応の動的 require に変換していた。
**原因 (推測)**: lindera の npm パッケージは CommonJS 前提で書かれ、プラットフォーム別の .node を require で選ぶ。このリポジトリの ARCHITECTURE は配布物を ESM の .mjs と定めており、パッケージをそのまま import するとこの前提に反する。
**対策**: plugins/native-japanese で lindera を使うときは、npm の lindera パッケージを import せず、取得した .node を createRequire(import.meta.url) で直接読み込む(設計書 harness-docs/design/2026-09-28-native-japanese-enforcement-design.md のセクション 2-3)。バンドル後は pnpm run build の成果物 scripts/*.mjs を node で実行し、形態素解析の違反が 1 件以上返ることを確かめる。
**昇格候補**: No

### [2026-09-28] GOTCHA-003: lindera の conjugation_form と conjugation_type を名前どおりに読みかけた

**タスク**: native-japanese 0.2.0-dev の形態素解析層の設計で、lindera 6.2.0(N-API)と IPADIC 6.2.0 から活用型と活用形を取り出そうとした。
**失敗内容**: conjugation_form を活用形、conjugation_type を活用型だとフィールド名から読みかけた。実際は逆で、conjugation_form に「サ変・スル」などの活用型、conjugation_type に「基本形」などの活用形が入る。kuromoji の conjugated_form と conjugated_type も対応が逆になる。
**原因 (推測)**: lindera の IPADIC の metadata.json は、MeCab の CSV の列(活用型、活用形の順)とフィールドの英語名の対応を入れ替えている。名前だけで判断し、値を見なかった。
**対策**: plugins/native-japanese/src/ で lindera のトークンから活用を読むときは、フィールド名でなく details の添字で読む(details[4] が活用型、details[5] が活用形)。「短縮することができる」を解析し、「する」の details[4] が「サ変・スル」になることをテストで固定する。
**昇格候補**: No

### [2026-09-18] GOTCHA-002: [解決済み] 委譲の依頼文に書いた説明用の例が成果物へ入った

**タスク**: AI が読む指示書の 1 項目の改訂を、文書作成の役割へ委譲した。
**失敗内容**: 依頼文に説明のために挙げた語の例が、成果物の本文へそのまま入った。判断の軸を示すはずの項目が、特定の語を列挙して「これらを避ける」と読める文になった。
**原因 (推測)**: 委譲先は依頼文に現れた例を要件の一部として扱う。説明のための例か成果物に書く内容かを区別しないと、例が本文へ入る。
**対策**: orchestration-discipline.md に従って文書作成を委譲するとき、依頼文の各例に、成果物の本文へ書くものか説明のためのものかを明記する。説明のためのものには「本文には書かない」と添える。plugins/*/skills/*/SKILL.md と plugins/*/references/ と .claude/rules/ の項目を書き換える依頼では、語の例を渡さず判断の軸だけを渡す。
**昇格候補**: Yes
**[解決済み] (2026-09-18)**: 対策を plugins/agent-policy/references/orchestration-discipline.md の §文書作成を委譲するとき と §サブエージェントの規律 へ条項として入れた (0.19.6-dev)。依頼文の例は、本文へ載せるものにだけ添え書きを付け、添え書きの無いものを説明として扱う。

### [2026-09-17] GOTCHA-001: setup-agents の再生成で disallowedTools を消した

**タスク**: agent-policy の役割断片を変更した後、このリポジトリの .claude/agents/ にある 14 の Agent 定義を plugins/agent-policy/scripts/setup-agents.mjs で再生成し、本文の変更を反映しようとした。
**失敗内容**: --write --merge --mcp-servers で再生成するときに --mcp-deny を渡さず、再生成した 10 定義のうち disallowedTools を持つ 5 定義（complex-reviewer、docs-reviewer、general-explore、document-writer、realtime-researcher）から設定を消した。これにより、読み取り専用の役割を持つ定義から、Serena の書き込み系ツール 11 個の禁止が外れた。バックアップとの差分で削除を見つけ、--mcp-deny を明示して再生成し復元した。
**原因 (推測)**: 書き込み前の --check が frontmatter.keysOnlyInExisting に disallowedTools を返したため、保持マージの対象だと誤認した。keysOnlyInExisting はテンプレートにない既存キーを列挙するだけで保持を示さず、MCP 由来の frontmatter は --mcp-* 引数から再構築されるため、--mcp-deny を省くと空になる。生成後の kept が空配列であることが唯一の兆候だったが、書き込み後にしか確認できなかった。
**対策**: plugins/agent-policy/scripts/setup-agents.mjs の --write に --mcp-servers を渡すときは、同じコマンドに、事前の --check が返す mcpCurrent.denyTools を値として --mcp-deny も渡す。git 追跡外の .claude/agents/ を再生成する前に別ディレクトリへ複製する。生成後に複製との差分を取り、削除された行がないことを確認する。
**昇格候補**: Yes
