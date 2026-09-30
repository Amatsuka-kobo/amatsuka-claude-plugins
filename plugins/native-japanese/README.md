# native-japanese

日本語で書く出力（会話の返答・コード内のコメント・コミットメッセージ・文書）に、書き方の規律を注入する Claude Code プラグインです。スキルと違い、呼び出さなくても毎回届きます。

## 動作要件

フックとスクリプトは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。

Claude Code 本体はネイティブバイナリで配布され Node.js を同梱しないため、未導入の場合は別途インストールしてください。

## 導入

Claude Code で Marketplace を追加します。

```text
/plugin marketplace add https://github.com/Amatsuka-kobo/amatsuka-claude-plugins
```

Marketplace から `native-japanese` をインストールします。

```text
/plugin native-japanese
```

プロジェクト単位またはユーザー単位で導入する場合はスコープを指定します。

```text
/plugin native-japanese --scope project
/plugin native-japanese --scope user
```

インストール後は Claude Code のセッションを再起動してフックを反映してください。

## 注入される内容

`references/discipline.md` を、先頭の目印の行(`<!-- native-japanese: ignore-file -->`)を除いて、セッション開始時とサブエージェント起動時に注入します。本文は 9,000 文字以内に保ち、次の 5 つのセクションで日本語の書き方を定めています。口調を別の指示が定めていても適用する項目を、前の 3 つに集めています。

- `## 適用範囲` は、規律の対象と別の指示との優先関係を定めます。
- `## 翻訳調の言い換え` は、英語の構文を写した表現の書き換え方と、英語由来の語を日本語で表すときの表記を定めます。表に無い直訳語の判断のしかたも、ここにあります。
- `## 避ける語` は、具体的な事実や条件に置き換える表現を定めます。
- `## 構成` は、結論から書く構成や見出し、箇条書きの使い方を定めます。
- `## 文` は、語順、読点、一文の内容、段落や文末の組み立て方を定めます。

プロンプトを送信するたびに、`references/reminder.md` の要約(300 文字以内)も注入します。口調と文体は別の指示に任せたまま、翻訳調の型・直訳語・避ける語を、会話・コメント・文書のすべてで直すよう促します。

## 届くタイミング

SessionStart（起動・再開・`/clear`・`/compact`・fork）と SubagentStart（すべてのサブエージェント）では、規律の本文が届きます。UserPromptSubmit(プロンプトの送信ごと)では要約が届きます。

## 書き込み後の検査

ファイルへの書き込みが終わるたびに、PostToolUse の hook が書いた日本語を検査します。対象のツールは次のとおりです。

- Claude Code の Write、Edit、MultiEdit、NotebookEdit
- MCP サーバーの編集ツールのうち、名前が `replace_content` `replace_symbol_body` `insert_after_symbol` `insert_before_symbol` `replace_in_files` `create_text_file` `replace_lines` `insert_at_line` のもの(Serena の編集ツールが該当します)

Bash のコマンドで書き込んだファイルは検査しません。

検査する範囲は拡張子で決まり、そのうちひらがなかカタカナを含む行だけを見ます。

| 拡張子 | 検査する範囲 |
| --- | --- |
| `.md` `.mdx` `.markdown` `.txt` | 全行。コードフェンスの中とインラインコードは除きます |
| `.ts` `.tsx` `.js` `.mjs` `.cjs` `.jsx` `.java` `.kt` `.go` `.rs` `.c` `.h` `.cpp` `.cs` `.swift` `.dart` `.scala` | `//` 以降、`/* */` の内側、`*` で始まる行 |
| `.py` `.sh` `.bash` `.zsh` `.rb` `.yaml` `.yml` `.toml` `.r` `.pl` | `#` 以降。`.py` は三重引用符の内側も見ます |
| `.sql` `.lua` `.hs` | `--` 以降 |
| `.html` `.htm` | `<script>` `<style>` `<pre>` `<code>` などを除いた本文。段落や見出しの単位でファイル全体から取り出し、今回の編集範囲に重なる違反だけを扱います |
| NotebookEdit のセル | `markdown` のセルは Markdown と同じ範囲、`code` のセルは `//` 以降と `#` 以降 |

表に無い拡張子のファイルは検査しません。

検査は 2 つの層で行います。正規表現の層は、避ける語、翻訳調の型、英語由来の語の直訳(規律の表の「避ける訳」)を探します。形態素解析の層は、無生物主語の文、同じ文末表現の連続、長すぎる文、連体修飾の重なりの 4 つを、文を品詞に分けて判定します。形態素解析の層は、後述の取得物がそろってから働きます。

違反が見つかると、hook は `{"decision": "block", "reason": "<差し戻し文>"}` を返します。差し戻し文には違反の行と直し方を 10 件まで載せ、Claude に書き直させます。書き込みそのものは取り消しません。引用・固有名詞・識別子・コード例として意図して書いた箇所と、検査の誤りと判断した箇所は、直さずに残してよいと差し戻し文で伝えます。

差し戻しは書き込みごとに判定します。同じ違反でも、新しい書き込みに再び現れれば差し戻します。ファイルのパス、規則、該当部分、書き込んだ本文の 4 つがそろって同じときだけ、2 回目以降を差し戻しません。サブエージェントの書き込みも、親のセッションと同じ記録で判定します。意図して残す箇所が繰り返し差し戻されるファイルは、`<!-- native-japanese: ignore-file -->` の目印で検査から外してください。

差し戻し文には、直訳語・翻訳調・避ける語の違反を先に、文の組み立ての違反を後に載せます。表に無い直訳語は検査で拾えないため、編集した範囲を読み直すよう差し戻し文で促します。

## 形態素解析の取得物

形態素解析に使うバインディングと辞書は、プラグインに同梱していません。初回の SessionStart で、hook から切り離した子プロセスが次の 2 つを取得します。セッションの開始は取得を待ちません。

| 取得物 | 取得元 | サイズ |
| --- | --- | --- |
| lindera の N-API バインディング | npm registry の `lindera-<OS>-<CPU>` パッケージの tarball。linux-x64 では `https://registry.npmjs.org/lindera-linux-x64-gnu/-/lindera-linux-x64-gnu-6.2.0.tgz` です。中の `.node` 1 ファイルだけを使います | 2.1〜2.7MB |
| IPADIC の辞書 | GitHub の lindera v6.2.0 のリリースにある `https://github.com/lindera/lindera/releases/download/v6.2.0/lindera-ipadic-6.2.0.zip` | 10.5MB |

通信量は合わせて約 13MB です。どちらも取得した直後に、コードに固定した sha256 と照合します。

置き場所は `${CLAUDE_PLUGIN_DATA}/morph/lindera-6.2.0/` です。`CLAUDE_PLUGIN_DATA` は Claude Code がプラグインごとに用意するディレクトリで、`--plugin-dir` で読み込んだときは `~/.claude/plugins/data/native-japanese-inline/` でした。ディスクの使用量は約 54MB です(linux-x64 での実測。`.node` が 7.6MB、辞書の 10 ファイルが計 約 47MB)。

取得に失敗すると、それから 24 時間は取得を試みません。取得が終わるまでと、取得できない環境では、正規表現の層だけで検査します。

## IPADIC のライセンス

本プラグインは辞書を再配布しません。利用者の環境が、lindera の公式のリリースから辞書を取得します。

IPADIC は、NAIST(奈良先端科学技術大学院大学)と ICOT の条件のもとで配布されています。条件の全文は、取得物と一緒に置かれる `${CLAUDE_PLUGIN_DATA}/morph/lindera-6.2.0/ipadic/NOTICE.txt` で読めます。

lindera は MIT License です。

## 対応する OS

形態素解析を使えるのは、lindera 6.2.0 がバインディングを npm に公開している次の 6 種です。

- linux-x64(glibc)
- linux-arm64(glibc)
- darwin-x64
- darwin-arm64
- win32-x64
- win32-arm64

動作を確かめたのは linux-x64(WSL2)だけで、残りの 5 種は未検証です。musl の Linux と、上記以外の環境では形態素解析を使わず、正規表現の層だけで検査します。

## 違反を数える測定 CLI

書き込み後の検査と同じ規則で、過去の変更や会話記録の違反を数えられます。

```bash
node <プラグインルート>/scripts/measure.mjs --git HEAD~20..HEAD
node <プラグインルート>/scripts/measure.mjs --transcripts ~/.claude/projects/<プロジェクト>/ --since 2026-09-26
```

| オプション | 意味 |
| --- | --- |
| `--git <range>` | `git diff <range>` で加わった行を検査します |
| `--transcripts <dir>` | `<dir>` 以下の会話記録(`*.jsonl`)から、書き込みのツールに渡した本文を検査します。書き手(main かサブエージェントの種類)ごとにも数えます |
| `--since <YYYY-MM-DD>` | `--transcripts` で、その日以降の記録だけを対象にします |
| `--data-dir <dir>` | 形態素解析の取得物があるディレクトリ。省略すると環境変数 `CLAUDE_PLUGIN_DATA` を使います |
| `--format json\|text` | 出力の形式。既定は `text` です |

測定 CLI は Claude Code の外で動かすので、`CLAUDE_PLUGIN_DATA` は通常ありません。形態素解析の規則も数えるときは、`--data-dir` に `CLAUDE_PLUGIN_DATA` の実体を渡してください。Marketplace から導入した場合は `~/.claude/plugins/data/native-japanese-amatsuka-claude-plugins` のような名前になります。取得物が無ければ正規表現の層だけを数え、形態素解析を使えなかった理由を出力に書きます。測定 CLI は取得を始めません。

## 他の口調指示との関係

口調や文体（敬体と常体、圧縮した口調、体言止めなど）を `CLAUDE.md`、output style、ほかの注入が定めている場合、その項目だけは別の指示に従います。翻訳調の言い換え、避ける語、最初の一文に結論を書く規律の 3 つは、口調の指示があっても適用します。会話にも、コード内のコメントと文書にも適用します。

## 無効にする方法

プラグインごと止めるときは、`/plugin` の管理画面で `native-japanese` を無効にし、セッションを再起動してください。

検査の全部または一部を止めるときは、次の環境変数を `off` にします。Claude Code を起動するシェルか、`settings.json` の `env` に設定してください。

| 環境変数 | 止まるもの | 続くもの |
| --- | --- | --- |
| `AMATSUKA_NATIVE_JAPANESE_CHECK=off` | 書き込み後の検査のすべてと、形態素解析の取得 | 規律と要約の注入 |
| `AMATSUKA_NATIVE_JAPANESE_MORPH=off` | hook での形態素解析の取得と使用 | 正規表現の層の検査、規律と要約の注入 |

## 規律を直すとき

`references/discipline.md` を編集してください。ビルドは不要です。本文が 9,000 文字を超えるとテストが失敗します。

## 由来

`references/discipline.md` の規律は、[coji/natural-japanese](https://github.com/coji/natural-japanese) v1.5.0(MIT License)の文体憲法・禁止語のカタログ・翻訳調のパターン集・読みやすさの原則から、書く瞬間に当てられる項目を抜き出し、常に適用する規律として組み直したものです。

natural-japanese は、文書を作るときに呼び出して設計・執筆・検査・収束の工程を回すスキルです。本プラグインは文書を仕上げる工程を持たず、規律を常に届け、書き込んだ箇所を検査して差し戻します。両者は併用できます。併用すると本プラグインの規律が下地になり、文書を仕上げる工程は natural-japanese が担います。

## ライセンス

MIT License です。詳細は `LICENSE` を参照してください。
