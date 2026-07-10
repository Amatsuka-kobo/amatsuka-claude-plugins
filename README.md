# あまつか Claude Plugins

あまつか工房産 Claude Code 用プラグインを管理・配布するための Marketplace です。
各プラグインを利用する前に、[利用規約](TERMS.md)をよく読み、これを必ず守ってください。

### 開発者へ

環境構築やその他開発手法などは[ここ](ONBOARDING.md)に記載してあります。

## 利用方法

ここには簡易的に利用方法を記載します。詳しくは[公式のドキュメント](https://code.claude.com/docs/ja/discover-plugins)を参照してください。

### Marketplace の追加

あまつか Claude Plugins のように、非公式コミュニティ産の Marketplace は以下のようにして Claude Code に追加することができます。

```bash
/plugin marketplace add <このリポジトリのURL>
```

### プラグインのインストール

Marketplace を追加後、このリポジトリにあるプラグインをインストールすることができます。

```bash
# プラグインの一覧を表示
/plugin

# プラグインをインストール
/plugin <plugin-name>

# スコープを指定してインストール
/plugin <plugin-name> --scope project
/plugin <plugin-name> --scope user
```

## 配布プラグイン

| 名前         | 説明                                                                                        | ステータス |
| ------------ | ------------------------------------------------------------------------------------------- | ---------- |
| Codiel       | GitHub issue の内容を取得し、設計・開発・PR起票・レビューを一気通貫で行うオーケストレーター | α版        |
| Revelation   | Claude の 最上位モデル (Fable5) の振る舞いなどを下位モデルに覚えさせるためのスキル          | 開発中     |
| task-utility | タスクの進め方を支援するユーティリティ群                                                    | 開発中     |

各プラグインの詳しい説明は、それぞれのフォルダ内（`plugins/<plugin-name>/`）にあるREADMEを参照してください。

---

### Codiel 👀🌿

GitHub issue の内容を取得し、設計・開発・PR起票・レビューを一気通貫で行うことができるプラグインです。<br>
詳しくはプラグイン本体の [README.md](plugins/codiel/README.md) や、設計思想などをまとめた [DESIGN.md](plugins/codiel/docs/DESIGN.md) を見てください。<br>
※ Codiel とは、Code + el（ヘブライ語で神を意味する、大天使の名前に付く接尾辞）の造語です。天使（👀🌿）が嬉々としてコーディングする様をイメージしています。

### Revelation

Claude の最上位モデルである Fable5 の振る舞いや、サブエージェントの運用方法などをまとめたスキル群。<br>
下位モデルである Opus/Sonnet/Haiku にこれを読み込ませることで、頭の構造を変えずとも**より仕事ができるモデル**にすることが目的。<br>
※ Revelation とは、神の啓示 (Divine Revelation) を語源にしています。天使が神 (Fable5) からの啓示を授けるようなイメージです。

### task-utility

あまつか工房で Claude Code を使うときの便利ツールなどをまとめたものです。
