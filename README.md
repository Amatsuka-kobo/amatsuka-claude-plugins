# あまつか Claude Plugins

あまつか工房産 Claude Code 用プラグインを管理・配布するための Marketplace です。
各プラグインを利用する前に、[利用規約](TERMS.md)をよく読み、これを必ず守ってください。

### 開発者へ

環境構築やその他開発手法などは[ここ](ONBOARDING.md)に記載してあります。

## 利用方法

ここには簡易的に利用方法を記載します。詳しくは[公式のドキュメント](https://code.claude.com/docs/ja/discover-plugins)を参照してください。

### Node.js のインストール

あまつか Claude Plugins は、TypeScript で開発を行っています。
プラグイン同梱のスクリプトはバンドルされた JavaScript であるため、npm install などは必要としませんが node コマンドを使用しているため、Node.js が必要となります。
任意の方法で Node.js が動く環境をご準備ください。

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

**⚠注意⚠** 開発中ステータスのプラグインは破壊的変更を行う可能性があります。

| 名前         | 説明                                                                                                                                                                | ステータス |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Codiel       | GitHub issue の内容を取得し、設計・開発・PR起票・レビューを一気通貫で行うオーケストレーター                                                                         | 開発中     |
| Raphael      | 失敗を感染記録→抗体→発火時だけ注入へ変換し、広さ検査と効果フィードバックで質を選別して再発を防止するプラグイン                                                                      | 開発中     |
| Revelation   | Claude の 最上位モデル (Fable5) の振る舞いなどを下位モデルに覚えさせるためのスキル (非推奨)                                                                         | 開発停止     |
| Prefetch     | ユーザー入力待ちの直前に、次に必要となる読み取り主体の作業をバックグラウンドで先行実行し、回答後の待ち時間を短縮するプラグイン                                      | 開発中     |
| Pitcrew      | オーケストレーション実行中の成果物(diff・設計書・テスト結果)を .pitcrew/ のレビューキューへ逐次書き出し、人間の並走レビューを可能にするプラグイン                   | リリース   |
| GuidePost    | コミット範囲や PR の diff を、依存順に並べた AI 同行のコードリーディングツアーに変換し、読中の疑問をその場でセッションへ届ける                                      | 開発中     |
| chat-history | チャットの履歴を保存・検索するためのプラグイン                                                                                                                      | リリース   |
| gh-utility   | GitHub関連のユーティリティスキル群                                                                                                                                  | 開発中     |
| basic-design | 基本設計フェーズの成果物(図4種・API一覧・非機能要件)をブレインストーミングで作成するオーケストレーター付きツール群                                                  | 開発中     |
| agent-policy | エージェント運用を最適化するプラグイン。Claude のモデル名で役割を固定する "claude" プロファイルと、プロジェクトの Agent 定義に付いた役割マーカーで委譲先を決める "custom" プロファイルを提供する | 開発中     |
| prompt-smith | エージェントに渡すプロンプトの無駄を省き、AIが読んでより理解しやすく出力の品質を上げるプロンプト設計・改善・最適化のためのプラグイン  | 開発中     |
| Metatron     | プロジェクトアーキテクチャ・失敗知識・規律(rules)を管理し、毎セッション AI のコンテキストへ注入するプラグイン | 開発中     |
| Sandalphon   | ユーザーの願い(TOBE)を聞き取って現状(ASIS)と突き合わせ、intent 文書に固定して issue へ起票し、実行系へ引き渡すオーケストレーター                                          | 開発中     |

各プラグインの詳しい説明は、それぞれのフォルダ内（`plugins/<plugin-name>/`）にあるREADMEを参照してください。

---

### Codiel 👀🌿

GitHub issue の内容を取得し、設計・開発・PR起票・レビューを一気通貫で行うことができるプラグインです。<br>
`/codiel:init` は保護パスの聞き取りだけを行い、ARCHITECTURE の散文や GOTCHAS は生成しません。ドメインマップが無くても動きますが、Metatron を併用するとシステム概要・レイヤー構造・テスト方針・ADR まで含む豊かな前提を持てます。<br>
※ Codiel とは、Code + el（ヘブライ語で神を意味する、大天使の名前に付く接尾辞）の造語です。天使（👀🌿）が嬉々としてコーディングする様をイメージしています。

### Raphael

失敗や差し戻しを感染記録として蓄積し、蒸留した抗体を発火条件に一致した操作へだけ注入する、再発防止プラグインです。<br>
抗体を作る際は trigger の広さを検査して広すぎるものを拒否し、注入後の再発(misses)を数えて効いていない抗体を候補として提示します。<br>
AI に同じ失敗を繰り返させないようにする仕組みを提供します。

### Revelation

Claude の最上位モデルである Fable5 の振る舞いや、サブエージェントの運用方法などをまとめたスキル群。<br>
下位モデルである Opus/Sonnet/Haiku にこれを読み込ませることで、頭の構造を変えずとも**より仕事ができるモデル**にすることが目的。<br>
※1 Revelation とは、神の啓示 (Divine Revelation) を語源にしています。天使が神 (Fable5) からの啓示を授けるようなイメージです。
※2 現在は非推奨です。

### Prefetch

設計承認や質問回答などでユーザーの入力を待つ間に、「承認後に高確率で必要になる読み取り主体の作業」をバックグラウンドで投機的に先行実行するプラグインです。<br>
回答が届いた時点で有効な成果だけを回収して即利用し、外れた予測は破棄します。
※ 外れた予測分のトークンはちゃんと消費するので注意！

### chat-history

セッション記録をドキュメントに残して「過去に何をしていたか」を把握できるようにし、再開や参照を容易にするプラグインです。

### gh-utility

GitHub への起票・Issue 分解・Issue 整理など、GitHubでの開発業務を包括的に支援するためのプラグインです。

### basic-design

ER 図、シーケンス図、システム構成図、画面遷移図、API 一覧、非機能要件を整理するなど、基本設計を包括的に支援するためのプラグインです。

### agent-policy

Claude Code を使う時のエージェント運用を最適化するプラグインです。<br>
モデル別役割分担・大まかな設計/実装フロー・アドバイザー運用・並列原則・コードベース探索のコスト効率化施策として context-map の作成指針をスキルとして配布します。<br>

#### カスタムエージェント

全17種の役割を定義し、`setup-agents` で役割毎にプロジェクトに最適化した Agents 定義を作成できます。(任意)<br>
Claude Code ではモデルIDの接頭辞に `claude` と付いたモデルを指定した Agents 定義をサブエージェントとして呼び出すことができ、それをプラグインでサポートするための施策も用意しています。。<br>
`setup-agents` で最初に選択するプロファイルを `custom` にし、他ベンダーのモデルを指定した Agents 定義を作成してください。(推奨モデルとして GPT・Grok・Gemini をサポート)<br>
`custom` プロファイルで利用するモデルは、`agent-policy:setup-agents` がプロキシーサーバーの `/v1/models` の実応答から選びます。<br>
Agents 定義の名前、本文、その他フロントマターは利用者が自由に編集できます。<br>
既存定義がある状態で setup を実行すると、差分を確認したうえで利用者が加えた編集を保持できます。<br>

#### 環境変数

環境変数 `AMATSUKA_AGENT_AUTO_INJECTION` にプロファイルを指定することで、SessionStart hookで規律スキルを使用するように促すことができます。 `none(規定値)` / `claude` / `custom` から選んでください。

### prompt-smith

AI が読み手となる指示書(CLAUDE.md・SKILL.md・コマンド定義・Agents 定義・`references/` 配下の文書・他)を、無駄なく理解しやすい形に設計・改善するプラグインです。<br>
AI 向け指示書の作成・改善は `prompt-smith`、スキルとコマンド定義の作成・description の評価・改善は `skill-creator`、Agent 定義の作成・検証は `agent-creator` が担当します。

### Metatron 📜

プロジェクトアーキテクチャ(`ARCHITECTURE.md`)・失敗知識(`GOTCHAS.md`)・規律(`.claude/rules/metatron/` 配下の `conventions.md` / `protected-paths.md` / `testing-policy.md`)の 3 種を管理するプラグインです。ARCHITECTURE と GOTCHAS は毎セッションの冒頭で AI のコンテキストへ注入し、rules は Claude Code の公式機構で起動時に読み込まれ、サブエージェントのコンテキストにも渡ります。<br>
3 種への書き込み口を CLI に一本化し、書式の検証・連番の採番・GOTCHAS が追記のみであることを機械的に保証します。AI による直接編集は PreToolUse hook が拒否し、CLI の絶対パス付きで正しい書き込み口へ案内します。<br>
`/metatron:init` がコードベース解析から ARCHITECTURE と rules 3 ファイルを初回生成し、承認を経て GOTCHAS の空の台帳を作成します。`/metatron:update` は現行コードとの乖離を検出して更新します。設定ファイル `metatron.config.json` は任意で、無ければ全項目が既定値で動きます。既定の `paths.architecture` と `paths.gotchas` はそれぞれ `docs/ARCHITECTURE.md` と `docs/GOTCHAS.md`、`paths.rulesDir` は `.claude/rules/metatron` です。<br>
※ Metatron とは、神の記録を司り人の行いを書き留める天の書記天使の名前です。

### Sandalphon

ユーザーの「やりたいこと」(TOBE)を聞き取り、ソフトウェアの現状(ASIS)と突き合わせて intent 文書に固定し、GitHub issue という形で実行系へ届けるオーケストレーターです。<br>
成果物は `docs/intents/YYYY-MM-DD-<slug>.md` に残る intent 文書(ASIS / TOBE / 受け入れ基準 / 実装方針 / 合意済み事項 / 非スコープ / 未確定事項)であり、issue はその派生物です。<br>
`/sandalphon:run` で聞き取りから引き渡しまでを進めます。承認ゲートは「取り消しコストが跳ね上がる直前」の 2 点だけに置き、issue の起票は外部公開行為としてゲートとは別に必ず全文提示と承認を経ます。<br>
※ Sandalphon とは、人間の祈り・願いを束ねて天へ届ける天使の名前です。

### Metatron / Sandalphon / Codiel の関係

この3つのプラグインは連携することができます。(それぞれ独立して使用することも可)
TOBE → intent → issue → 実装という一続きの流れを分担します。<br>
Codiel は Metatron が無くてもドメインマップなしで動作し、Sandalphon が無くても通常の自動開発ワークフローを実行します。<br>
Sandalphon は Codiel が無くても intent 文書を残して自前実行まで行えます。Metatron も他の2つが無いところで、ARCHITECTURE・GOTCHAS・rules を管理するプラグインとして単体で運用価値があります。<br>
これらのプラグインは、プラグインの生成ファイル(ARCHITECTURE / GOTCHAS / metatronが管理するrules / intent 文書)とコンテキストで相互補完を行います。
