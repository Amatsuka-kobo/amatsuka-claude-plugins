# native-japanese 0.2.0-dev 強化 引き継ぎ書

- 日付: 2026-09-29
- 引き継ぎ元: 設計・計画セッション(設計書と実装計画書はユーザー承認済み。実装は未着手)
- 引き継ぎ先: 実装セッション
- 対象プラグイン: `plugins/native-japanese`(0.1.0-dev → 0.2.0-dev)

## 現在地

| 工程 | 状態 |
| --- | --- |
| 設計書 | **承認済み**。`harness-docs/design/2026-09-28-native-japanese-enforcement-design.md`(コミット 346abd77) |
| 実装計画書 | **承認済み**。`harness-docs/plans/2026-09-28-native-japanese-enforcement-plan.md`(コミット 46d027b0) |
| レビュー | 設計書と計画書のそれぞれに、knowledge-elicitationer と docs-reviewer のレビューを通し、指摘を反映した |
| GOTCHAS | lindera の罠を GOTCHA-003(フィールド名の逆転)と GOTCHA-004(ESM バンドルの失敗)に記録した |
| 実装 | **未着手**。計画書の T0 から始める |

## 改修の要点

ユーザーが「規律が弱い」と判断したのは、プログラムファイル内のコメントと文書である。会話は、別のプラグインが会話の口調だけを圧縮しているため、弱いかどうかを判断できず、対象外とした。

採用した施策は次の 5 つである。記号は設計書と同じにしている。

- A: 測定 CLI
- B: `discipline.md` の適用範囲に、翻訳調・避ける語・結論を先に書く規律は、どの口調でも適用すると明記する
- D: A の測定結果から `discipline.md` を組み直す
- E: UserPromptSubmit で、300 文字以内の要約を毎ターン注入する
- F: PostToolUse で書き込みを検査し、`decision: "block"` で差し戻す

会話を検査する C は採用しない。

さらに、lindera 6.2.0(N-API)と IPADIC 6.2.0 による形態素解析の層を加える。辞書と `.node` は初回に自動で取得する。取得できないあいだは、正規表現の層だけで検査する。

## セッションで確定した決定(再提案しない)

- **環境変数は 2 つ。**
  - `AMATSUKA_NATIVE_JAPANESE_CHECK=off` で、書き込み後の検査を止める。
  - `AMATSUKA_NATIVE_JAPANESE_MORPH=off` で、形態素解析の取得と使用を止める。
- **HTML も抜き出しの対象にする。** 対象は `.html` と `.htm` で、パーサーの依存は増やさない。
- **設計書と計画書も検査の対象にする。** ignore-file の目印は `discipline.md` にだけ置く。
- **`description` の文言。** `plugin.json`・`marketplace.json`・ルートの `README.md` の 3 か所を、次の文言でそろえる。`marketplace.json` の変更は、protected-paths に対するユーザー指示の例外である。

  「日本語の出力に翻訳調や決まり文句を避けて結論から書く規律を注入し、コメントと文書は書き込んだ後に検査して直させ、AIが正しい日本語を書けるようにするプラグイン」

- **prompt-smith の扱い。**
  - 今回の設計書・計画書・実施記録には、prompt-smith を当てない。
  - `discipline.md` と `reminder.md` の編集(T16・T17)では、prompt-smith を当てる。
  - 規約 `.claude/rules/metatron/conventions.md` の「`harness-docs/**/*.md` を prompt-smith の対象にする」は意図どおりである。prompt-smith 側が設計書を対象外としている記述のほうが誤りで、ユーザーが後で直す。規約から外す提案はしない。
- **sha256 の照合は取得直後の 1 回だけにする。** hook の中では、サイズと mtime だけを比べる。
- **ADR を 1 件足す。** 実行時にネイティブコードを取得する方式について記録する(計画書 T7)。

## ユーザーの承認が要る地点

| 地点 | タスク | 内容 |
| --- | --- | --- |
| A1 | T7 | ADR の草案。承認を得てから、取得の実装(T9)に進む |
| A2 | T16 | `discipline.md` の改稿。prompt-smith が「適用するか」を尋ねる地点を兼ねる |
| A3 | T20 の前 | IPADIC の NOTICE の扱い。辞書を再配布せず、取得物と一緒に置いた `NOTICE.txt` を README で示す方針でよいか |

T15 のうち Serena の編集の確認は、ユーザーの対話セッションで行ってもらう。ヘッドレス実行では Serena が起動しないためである。

## 実装時に踏みやすい点

- **lindera のフィールド名は、名前と中身が逆である。** `conjugation_form` に活用型、`conjugation_type` に活用形が入る。添字 `details[4]` と `details[5]` で読む(GOTCHA-003)。
- **npm の `lindera` パッケージは import しない。** ESM でバンドルすると `Dynamic require of "fs"` で失敗する。`.node` を `createRequire(import.meta.url)` で直接読み込む(GOTCHA-004)。
- **`.node` の tarball 内のパスは、OS ごとに接尾辞が違う。** linux には `-gnu`、windows には `-msvc` が付く。設計書セクション 2-5 の表のとおりに書く。
- **辞書は `lindera-ipadic-6.2.0.zip` だけを取得する。** neologd の辞書は取得しない。URL と sha256 は、計画書セクション 4 の契約に固定してある。
- **`discipline.md` を読むのはエントリポイントだけにする。** `src/lib/` から読むと、バンドル後にパスがずれる。
- **ヘッドレス実行はリポジトリの外で行う。** リポジトリ内で `claude -p` を実行すると、chat-history の hook が会話記録を作る。実行するときは、`--setting-sources "" --strict-mcp-config` を付けて隔離する。記録ができてしまったら、`docs/chat/` のファイルと `INDEX.md` の行を消す。
- **agent-policy の版を確認する。** 2026-09-28 に、このリポジトリの project スコープの導入記録が古い版(0.7.0-dev)に固定されていた。そのため、セッション開始時に方針の注入がスキップされていた。`claude plugin update <name>@amatsuka-claude-plugins --scope project` で更新済みである。再発したら、SessionStart の注入文に「エージェント運用方針(カスタム構成)」が出ているかを確認する。

## 設計時の検証で残した資材(/tmp、読むだけ)

- `/tmp/nj-morph/`: 計測スクリプト、lindera の辞書の展開物、バンドルの検証物
- `/tmp/nj-pin/`: sha256 の計算に使った tarball 6 種と辞書の zip
- `/tmp/nj-direct*.mjs`: `.node` を直接読み込む方式の検証

いずれも OS を再起動すると消える可能性がある。その場合は計画書どおりに取り直す。

## スコープ外

- 会話の最終応答の検査(C)
- Bash による書き込みの検査
- linux-x64 以外の 5 種の実機での確認。README に「未検証」と書く。

## 参照

- 設計書: `harness-docs/design/2026-09-28-native-japanese-enforcement-design.md`
- 実装計画書: `harness-docs/plans/2026-09-28-native-japanese-enforcement-plan.md`
- 前回の設計書と計画書: `harness-docs/design/2026-09-26-native-japanese-design.md`、`harness-docs/plans/2026-09-26-native-japanese-plan.md`
- GOTCHAS: GOTCHA-003、GOTCHA-004(`node plugins/metatron/scripts/metatron.mjs get gotchas --query lindera`)
- 会話記録: `docs/chat/2026/0928/phyllis998/native-japanese-guideline-reinforcement.md`
