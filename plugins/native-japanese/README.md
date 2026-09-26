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

`references/discipline.md` の全文を、セッション開始時とサブエージェント起動時に注入します。本文は 9,000 文字以内に保ち、次の 6 節で日本語の書き方を定めています。

- `## 適用範囲` は、規律の対象と別の指示との優先関係を定めます。
- `## 構成` は、結論から書く構成や見出し、箇条書きの使い方を定めます。
- `## 文` は、語順、読点、一文の内容、段落や文末の組み立て方を定めます。
- `## 翻訳調の言い換え` は、英語の構文を写した表現の書き換え方を定めます。
- `## 避ける語` は、具体的な事実や条件に置き換える表現を定めます。
- `## 訳語` は、英語由来の語を日本語で表すときの表記を定めます。

## 届くタイミング

SessionStart（起動・再開・`/clear`・`/compact`・fork）と SubagentStart（すべてのサブエージェント）の両方で、同じ本文が届きます。

## 他の口調指示との関係

口調や文体（敬体と常体、圧縮した口調、体言止めなど）を `CLAUDE.md`、output style、ほかの注入が定めている場合、その項目だけは別の指示に従います。翻訳調の言い換えや結論を先に書く規律は残ります。

## 無効にする方法

`/plugin` の管理画面で `native-japanese` を無効にし、セッションを再起動してください。規律の一部だけを止める設定はありません。

## 規律を直すとき

`references/discipline.md` を編集してください。ビルドは不要です。本文が 9,000 文字を超えるとテストが失敗します。

## 由来

`references/discipline.md` の規律は、[coji/natural-japanese](https://github.com/coji/natural-japanese) v1.5.0(MIT License)の文体憲法・禁止語のカタログ・翻訳調のパターン集・読みやすさの原則から、書く瞬間に当てられる項目を抜き出し、常に適用する規律として組み直したものです。

natural-japanese は、文書を作るときに呼び出して設計・執筆・検査・収束の工程を回すスキルです。本プラグインは工程も検査スクリプトも持たず、規律だけを常に届けます。両者は併用できます。併用すると本プラグインの規律が下地になり、文書を仕上げる工程は natural-japanese が担います。

## ライセンス

MIT License です。詳細は `LICENSE` を参照してください。
