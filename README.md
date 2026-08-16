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

| 名前         | 説明                                                                                                                                                                | ステータス |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Codiel       | GitHub issue の内容を取得し、設計・開発・PR起票・レビューを一気通貫で行うオーケストレーター                                                                         | 開発中     |
| Raphael      | 失敗を感染記録→抗体→発火時だけ注入へ変換し、決定的な hook で再発を防止するプラグイン                                                                                | 開発中     |
| Revelation   | Claude の 最上位モデル (Fable5) の振る舞いなどを下位モデルに覚えさせるためのスキル (非推奨)                                                                         | 開発中     |
| Prefetch     | ユーザー入力待ちの直前に、次に必要となる読み取り主体の作業をバックグラウンドで先行実行し、回答後の待ち時間を短縮するプラグイン                                      | 開発中     |
| Pitcrew      | オーケストレーション実行中の成果物(diff・設計書・テスト結果)を .pitcrew/ のレビューキューへ逐次書き出し、人間の並走レビューを可能にするプラグイン                   | リリース   |
| GuidePost    | コミット範囲や PR の diff を、依存順に並べた AI 同行のコードリーディングツアーに変換し、読中の疑問をその場でセッションへ届ける                                      | 開発中     |
| chat-history | チャットの履歴を保存・検索するためのプラグイン                                                                                                                      | リリース   |
| gh-utility   | GitHub関連のユーティリティスキル群                                                                                                                                  | 開発中     |
| basic-design | 基本設計フェーズの成果物(図4種・API一覧・非機能要件)をブレインストーミングで作成するオーケストレーター付きツール群                                                  | 開発中     |
| agent-policy | あまつか工房のエージェント運用を最適化する(モデル別役割分担・設計/実装フロー・context-map)スキル群と 7 種のサブエージェント定義を同梱し、Claude+Codex+Grok 併用 / Claude+Codex 併用 / Claude+Grok 併用 / Claude オンリーの 4 プロファイルで提供する | 開発中     |
| prompt-smith | エージェントに渡すプロンプトの無駄を省き、AIが読んでより理解しやすく出力の品質を上げることができるものを作るためのプロンプト設計・改善・最適化のためのプラグイン  | 開発中     |
| Metatron     | プロジェクトの技術的前提(ARCHITECTURE)と失敗知識(GOTCHAS)を記録・更新し、毎セッションの冒頭で AI のコンテキストへ注入するプラグイン                                | 開発中     |
| Sandalphon   | ユーザーの願いを聞き取って現状(ASIS)と突き合わせ、intent 文書に固定して issue へ起票し、実行系へ引き渡すオーケストレーター                                          | 開発中     |

各プラグインの詳しい説明は、それぞれのフォルダ内（`plugins/<plugin-name>/`）にあるREADMEを参照してください。

---

### Codiel 👀🌿

GitHub issue の内容を取得し、設計・開発・PR起票・レビューを一気通貫で行うことができるプラグインです。<br>
`/codiel:init` はドメイン分割と保護パスの聞き取りだけを行い、ARCHITECTURE の散文や GOTCHAS は生成しません。Metatron が無くても最小の ARCHITECTURE を自前で作って動きますが、Metatron を併用するとシステム概要・レイヤー構造・テスト方針・ADR まで含む豊かな前提を持てます。<br>
Sandalphon が起票した intent issue を分析するときは、issue のセクションを要約せずそのまま転記し、合意済みの分岐を設計フェーズで再質問しません。<br>
詳しくはプラグイン本体の [README.md](plugins/codiel/README.md) や、設計思想などをまとめた [DESIGN.md](plugins/codiel/docs/DESIGN.md) を見てください。<br>
※ Codiel とは、Code + el（ヘブライ語で神を意味する、大天使の名前に付く接尾辞）の造語です。天使（👀🌿）が嬉々としてコーディングする様をイメージしています。

### Raphael

失敗や差し戻しを感染記録として蓄積し、蒸留した抗体を発火条件に一致した操作へだけ注入する、再発防止プラグインです。<br>
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

GitHub への起票・Issue 分解・Issue 整理など、GitHubでの開発業務を包括的に支援するためのプラグインです。<br>
`issue-craft` は持ち込みモードを持ち、Sandalphon などが組み立て済みの本文を渡してきた場合は、それを一切書き換えずに全文提示と承認だけを経て起票します。

### basic-design

ER 図、シーケンス図、システム構成図、画面遷移図、API 一覧、非機能要件を整理するなど、基本設計を包括的に支援するためのプラグインです。

### agent-policy

Claude Code を使う時のエージェント運用を最適化するプラグインです。<br>
モデル別役割分担・大まかな設計/実装フロー・アドバイザー運用・並列原則・コードベース探索のコスト効率化施策として context-map の作成指針をスキルとして配布します。<br>
Claude Researcher / GPT Sol・Terra・Luna・Researcher / Grok Researcher・Implementer の 7 種のサブエージェント定義を同梱しており、セットアップなしに `agent-policy:<name>` として呼び出せます。<br>
環境変数 `AMATSUKA_AGENT_AUTO_INJECTION` を設定すると、SessionStart フックがセッション開始時に対応する方針スキル(`agent-policy:claude-model-policy` / `agent-policy:with-codex-policy` / `agent-policy:with-grok-policy` / `agent-policy:codex-grok-policy`)へ従う旨を自動で注入します。任意のプロジェクトへ CLAUDE.md の追記なしで同じ最適化施策を持ち込めます。<br>
同梱定義は Serena MCP のシンボル探索ツールと編集ツールを許可します。サブエージェントは既定でバックグラウンド実行され、その際に組み込みの LSP ツールが失われるため、シンボル単位の探索と編集を MCP 経由で確保しています。<br>
Codex 系 / Grok 系のモデルエイリアスをローカルプロキシ(ProxyAPI サーバー)の別名に合わせたいときは、`AMATSUKA_AGENT_GPT_SOL_ALIAS` などのエイリアス変数を設定します。既定値と異なる値を設定すると、SessionStart フックが該当定義をプロジェクトの `.claude/agents/` へ生成します。<br>

### prompt-smith

AI が読み手となる指示書(CLAUDE.md・SKILL.md・コマンド定義・Agents 定義・`references/` 配下の文書)を、無駄なく理解しやすい形に設計・改善するプラグインです。<br>
AI 向け指示書の作成・改善は `prompt-smith`、スキルとコマンド定義の作成・description の評価・改善は `skill-creator`、Agent 定義の作成・検証は `agent-creator` が担当します。

### Metatron 📜

プロジェクトの技術的前提(`docs/ARCHITECTURE.md`)と失敗知識(`docs/GOTCHAS.md`)を記録・更新し、毎セッションの冒頭で AI のコンテキストへ注入するプラグインです。<br>
2 文書への書き込み口を決定的な CLI に一本化し、書式の検証・連番の採番・GOTCHAS が追記のみであることを機械で保証します。正本への直接編集は PreToolUse hook が拒否し、CLI の絶対パス付きで正しい窓口へ案内します。<br>
`/metatron:init` がコードベース解析から ARCHITECTURE を初回生成し、`/metatron:update` が現行コードとの乖離を検出して更新します。設定ファイル `metatron.config.json` は任意で、無ければ全項目が既定値で動きます。<br>
※ Metatron とは、神の記録を司り人の行いを書き留める天の書記天使の名前です。

### Sandalphon

ユーザーの「やりたいこと」を聞き取り、ソフトウェアの現状(ASIS)と突き合わせて intent 文書に固定し、GitHub issue という形で実行系へ届けるオーケストレーターです。<br>
Codiel が「Issue #N がある」ところから始まるのに対し、Sandalphon は**その Issue が生まれる前の上流区間**を担当します。成果物は `docs/intents/YYYY-MM-DD-<slug>.md` に残る intent 文書(ASIS / TOBE / 受け入れ基準 / 実装方針 / 合意済み事項 / 非スコープ / 未確定事項)であり、issue はその派生物です。<br>
`/sandalphon:run` で聞き取りから引き渡しまでを進めます。承認ゲートは「取り消しコストが跳ね上がる直前」の 2 点だけに置き、issue の起票は外部公開行為としてゲートとは別に必ず全文提示と承認を経ます。<br>
※ Sandalphon とは、人間の祈り・願いを束ねて天へ届ける天使の名前です。

### Metatron / Sandalphon / Codiel の関係

3 つは願い → intent → issue → 実装という一続きの流れを分担しますが、**互いに独立して動きます。**<br>
Codiel は Metatron が無くても単体で完結し(最小の ARCHITECTURE を自前で作ります)、Sandalphon は Codiel が無くても intent 文書を残して自前実行まで行えます。Metatron も他の 2 つが無いところで、ARCHITECTURE と GOTCHAS の記録・注入として単体で価値があります。<br>
連携手段は**ファイル契約**(ARCHITECTURE / GOTCHAS / intent 文書の書式)と**モデルコンテキスト**の 2 つだけで、プラグイン間の依存宣言もインストール位置の参照もありません。片方だけを入れても壊れず、両方を入れると噛み合います。
