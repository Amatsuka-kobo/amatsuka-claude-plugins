# Claude Code モデル選択機能について

- 日付: 2026-07-11
- 参加者: phyllis998, AI (Claude Sonnet 5)
- 成果物: `docs/development/cliproxyapi-setup.md`（編集）、`ONBOARDING.md`（編集）
- 前提: Claude Code の `/model` コマンド、`/status` コマンドの機能、`docs/development/cliproxyapi-setup.md`、`cliproxyapi.config.example.yaml`、`CLAUDE.md` のエージェント運用方針

---

## セッション1: モデル一覧の閲覧方法

# phyllis998

> Claude Codeは自分が現在使用可能なモデルリストを閲覧できますか？

# AI

Claude Code には 2 つの方法でモデル情報を確認できる機能がある。

- `/model` を引数なしで実行すると、現在選択可能なモデル一覧が表示され、そこから選択可能。
- `/status` コマンドでも現在使用中のモデル名を確認できる。

ユーザーが `/model` に Sonnet 5 を指定してコマンド実行した場合は、その指定が直接反映される。一覧を見たいだけなら、引数を省略して `/model` を実行することで確認できる。

---

## セッション2: モデル自身による認識可能性（カスタムモデル）

# phyllis998

> /modelでユーザーが閲覧するのではなく、モデル自身が使用できるモデルを認識できるかの話です。特に、Fable,Opus,Sonnet,Haiku以外のカスタムモデルはどうでしょうか。

# AI

claude-code-guide エージェントに調査を依頼。調査結果（以下）により、モデル自身が利用可能なモデル一覧を能動的に認識・列挙する手段がないことが判明した。

**主な発見:**

1. **自己申告は静的な情報のみ**: システムプロンプトに埋め込まれる "You are powered by the model named Sonnet 5" のような一文は、セッション開始時に一度だけ注入される情報で、動的に更新・問い合わせできない。「今の自分が何か」は分かるが、「他に何が選べるか」を能動的に把握できない。

2. **モデル一覧を返すツールが存在しない**: `/model` はユーザーが対話的に叩く CLI コマンドであり、アシスタントが呼び出せる Bash 以外のツール（利用可能モデル一覧を返す API など）は用意されていない。Bash で Claude 内部の状態を覗く公式な手段も存在しない。

3. **カスタムエイリアスは "ただの文字列"**: clipproxyapi 経由で設定した OAuth モデルエイリアスなどのカスタム名は、`.claude/settings.json` や環境変数に書かれた設定値がそのまま model 指定として使われるだけ。Claude Code 側(≒アシスタント)がそれを「公式モデルか、独自エイリアスか」と区別して認識する仕組みは存在しない。

結論: いかなるモデル（公式・カスタムを問わず）であっても、モデル自身はシステム全体のモデル一覧を把握していない。

---

## セッション3: サブエージェント起動時のモデル選択の仕組み

# phyllis998

> 使えるモデルの把握ができないのであれば、サブエージェントを起動するときにどうやってモデルを選択していますか？

# AI

「モデル一覧を把握する」問題とは別の仕組みで選択している。ツール定義そのものが選択肢を固定的に列挙しているため、外部から動的発見する必要がない。

**実装方式:**

1. **`model` パラメータの enum による固定選択肢**: Agent ツールのスキーマに `enum: ["sonnet", "opus", "haiku", "fable"]` と明記されており、モデル一覧を動的に発見するのではなく、このツールスキーマに列挙された固定の選択肢から選んでいるだけ。「システム全体のモデル一覧」の把握を必要としない。

2. **`model` 省略による透過的な継承**: `model` パラメータを省略するとサブエージェントは呼び出し元（メインセッション）の現在のモデルをそのまま継承する。clipproxyapi 経由のカスタムエイリアスのように、実際のモデル識別子を知らないカスタムモデルであっても、「省略＝継承」という仕組みのおかげで、モデルを明示的に識別することなく透過的に伝播させられる。このリポジトリの fable-subagents スキルにも「迷ったら model を指定せず継承する」と明記されている。

3. **`subagent_type` による専用ルーティング**: GPT-5.6 系（Sol/Terra/Luna）は `model` パラメータの enum に含まれていないため、`model` を直接指定する代わりに `codex:codex-rescue` のような専用の `subagent_type` を選ぶことでルーティングされる。つまり「どの LLM を使うか」の決定は、(a) `model` enum からの選択、(b) `subagent_type` の選択、という 2 つの独立したレイヤーに分かれており、どちらも「システム全体のモデル一覧」を能動的に発見することを必要としない。

**CLAUDE.md の運用方針との関係:**

CLAUDE.md に記載されたエージェント運用方針（「GPT-5.6 Sol はレビュー・調査に、Opus は複雑なコーディングに」等）は、上記の (a)(b) のどちらのレイヤーを使うかを判断するための**人間が定めたルール**であり、モデル自身が自力で発見した情報ではない。アシスタントはそのルール適用するために、モデル一覧を把握している必要がない。

結論: 「モデルが一覧を知らない」という状況は、ツール設計と固定的な選択肢、継承、ルーティング層の分離により、問題にならない。

---

## セッション4: カスタムモデルでのサブエージェント起動設定

# phyllis998

> カスタムモデルでサブエージェントを起動させるにはどのように設定すればよいですか?
> Agentツールのmodelパラメータにどうやって追加しますか?

# AI

**結論: Agent ツール自身の `model` パラメータには、カスタムエイリアス文字列を直接追加することはできない。**

Agent ツールスキーマの `model` パラメータは `enum: ["sonnet", "opus", "haiku", "fable"]` に固定されており、これはハーネス側の実装で決め打ちされたツール定義である。ユーザー側の設定では変更不可。

**実際にカスタムモデルでサブエージェントを起動する方法は以下の3つ:**

**1. カスタム subagent 定義ファイルの frontmatter `model:` フィールド（推奨）**

`.claude/agents/*.md` の frontmatter `model:` は、`sonnet`/`opus`/`haiku`/`fable`/`inherit` に限定されず、フルモデルID文字列をそのまま受け付ける。例えば:

```yaml
---
name: gpt-sol-reviewer
description: レビュー・調査・分析を GPT-5.6 Sol に委任する
model: claude-gpt-5-6-sol
tools: Read, Grep, Glob
---
```

このように `model: claude-gpt-5-6-sol` と書いた専用エージェント定義ファイルを `.claude/agents/` 配下に作成し、Agent ツールの `subagent_type` パラメータでこのエージェント名を指定して起動する。Agent ツールの `model` パラメータは使わない。

**2. `CLAUDE_CODE_SUBAGENT_MODEL` 環境変数**

全サブエージェント・Agent Team に一律適用される最優先の上書き変数。モデル解決の優先度は (1) この環境変数が最優先、次に (2) per-invocation `model` パラメータ、(3) サブエージェント frontmatter `model`、(4) メインセッションのモデル。特定エージェント個別の指定には不向き（全サブエージェント一律固定に用いる）。

**3. `ANTHROPIC_CUSTOM_MODEL_OPTION` 環境変数**

```bash
export ANTHROPIC_CUSTOM_MODEL_OPTION="claude-gpt-5-6-sol"
export ANTHROPIC_CUSTOM_MODEL_OPTION_NAME="GPT-5.6 Sol via CLIProxyAPI"
```

メインセッションの `/model` ピッカーに1エントリだけカスタムモデルを追加する機能で、モデル文字列の検証もスキップされる。ただしこれは「メインセッションの `/model` 選択肢を増やす」ものであり、サブエージェント個別指定とは別軸。

**なぜ `claude-gpt-5-6-sol` のような未知の文字列が検証エラーにならないのか:**

Claude Code のモデル文字列検証（既知のエイリアス・`claude-` 接頭辞・`modelOverrides` 等のチェック）は、**Anthropic API に直接接続している時のみ**動作する。カスタム `ANTHROPIC_BASE_URL`（この repo の cliproxyapi 設定がまさにこれ）使用時は、検証がスキップされ、任意の文字列がそのままプロキシに渡される。

**推奨される実装方法:**

この repo の agent 運用方針（GPT-5.6 Sol にレビュー・調査を委任等）を実現するには、**方法1の専用 subagent 定義ファイルを用意するのが最も素直**。

---

## セッション5: 存在しないカスタムモデルが公式 API に送られた場合の挙動

# phyllis998

> claude-gpt-5-6-solが存在しない、Anthropic公式に向けてリクエストが送られる場合に、agents定義のフロントマターにclaude-gpt-5-6-solと書かれている場合の挙動はどうなりますか？

# AI

**モデル文字列検証のメカニズム:**

Anthropic 公式 API へリクエストが送られる場合、Claude Code のモデル文字列チェックは以下のルールで動作する（ドキュメント "model-config.md" より）:

```
On the Anthropic API, Claude Code recognizes:
- a model alias
- an entry from the /model picker
- any name that starts with `claude-`
- a value you configured yourself as a custom model option or in modelOverrides
```

つまり `claude-gpt-5-6-sol` は文字列として `claude-` で始まっているという理由だけで、**ローカル構文チェックは通過**する。「本当に Anthropic にそのモデルIDが存在するか」まではこの段階ではチェックしていない。

ただしこのチェック自体は、Agent SDK の `setModel()` や Desktop app 経由のモデル切り替えを想定した記述で、`--model` フラグ・`ANTHROPIC_MODEL` 環境変数・`model` 設定フィールドについては**チェックの対象外**と明記されている。サブエージェント frontmatter の `model:` もこれらと同様、事前の文字列検証を経由しない設定値である可能性が高い。

**起動後の挙動:**

1. サブエージェント定義に `model: claude-gpt-5-6-sol` が書かれたまま Anthropic 公式 API（`ANTHROPIC_BASE_URL` 未設定）へリクエストが送られた場合、起動時点ではエラーにならず、そのままサブエージェントが API リクエストを送ろうとする。

2. Anthropic のバックエンドには実在しないモデルID なので、**リクエスト自体が API レベルで失敗**する（ドキュメントの言う「There's an issue with the selected model」に相当するエラー。`--model` / `ANTHROPIC_MODEL` / `model` 設定に不正な値を入れた場合と同じ扱い）。

3. 結果として、そのサブエージェントの初回 API 呼び出しが失敗し、呼び出し元の `Agent`/`Workflow` からは「エージェントがエラーで落ちた」という形で見える（セッションの現在のモデルが変わるわけではなく、そのサブエージェント個別の起動が失敗する形）。

**この repo での実際の影響:**

現在の cliproxyapi 構成では `ANTHROPIC_BASE_URL` を独自プロキシに向けているため、上記の「公式 API へ直接送られる」ケースには該当しない。上記の失敗パターンが起きるのは、たとえば以下のような状況:

- `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` を unset して「通常の接続へ戻す」操作をした後、`model: claude-gpt-5-6-sol` を書いたエージェント定義を残したまま起動してしまった場合。

プロキシを介さない通常の接続に戻す際は、該当するカスタムモデルを指定したエージェント定義も一緒に無効化するか、`model: inherit` に戻すべき。

---

## セッション6: Codex 前提をドキュメントに明記

# phyllis998

> cliproxyapiは任意設定です。codexを使用できる人だけがこの設定を行うことが推奨されます。どう対策すればよいでしょうか。

# AI

README.md・ONBOARDING.md・`docs/development/cliproxyapi-setup.md` を確認し、「任意設定」という記載は存在するが「Codex アカウントを持っていることが前提」という条件が明示されていないことを検出。

**実施した対応:**

1. **`docs/development/cliproxyapi-setup.md`**: 冒頭に追記。GPT-5.6 系エイリアス（`cliproxyapi.config.yaml` の `oauth-model-alias` で Codex OAuth ログイン`--codex-login` 経由で公開）が Codex アカウント前提であること、Codex を持たない場合はこの設定をしても新モデルが利用可能にならないこと、CLAUDE.md のエージェント運用フォールバック方針（「GPT 系モデルが使用できないときは Opus/Sonnet/Haiku で運用する」）に従ってよいことを記載。

2. **`ONBOARDING.md`**: 冒頭「ゴール」節と末尾「任意設定」節の両箇所に、「Codex アカウントを持つメンバーのみ実施」という前提条件を追記。

**効果:**

新規メンバーがドキュメントを読んだ時点で「Codex がなければこの設定は不要」と即座に判断でき、設定の必要がない人が無駄に手順を試行錯誤することなくなる。

---

## セッション7: Codex がない場合のエージェント定義の安全な配置

# phyllis998

> model: claude-gpt-5-6-sol としたagents定義がある場合、何かしらの形でこのエージェントが起動してしまう場合があると思います。codexを持っていない人はどのように対策すればよいでしょうか。

# AI

**現状確認:**

リポジトリ内を grep で検索し、実際には `model: claude-gpt-5-6-sol` を指定したエージェント定義ファイルは**まだ存在しない**ことを確認した。セッション4で「カスタムモデル用に `.claude/agents/` に専用ファイルを作るのが推奨」と提案したパターンがまだ実装されていないだけである。つまりこれは「今ある問題を直す」のではなく「今後そういう定義を作るときにどう設計すべきか」という**設計方針の話**。

**根本的な対策:**

サブエージェント定義のスコープ優先順位（公式ドキュメント subagents.md より）:

```
Managed settings（組織） > --agents フラグ（セッション） > .claude/agents/（プロジェクト、Git管理下） > ~/.claude/agents/（ユーザー個人） > プラグイン agents/
```

もし `model: claude-gpt-5-6-sol` と書いたファイルを**プロジェクトの `.claude/agents/`（Git管理下）に置いてしまうと**、Codex を持たないメンバーにもそのエージェント定義がリポジトリ経由でそのまま配られてしまう。Claude はそのエージェント定義が存在する限り `subagent_type` として選択できるため、CLAUDE.md のルーティング方針に従ってそのエージェントを呼び出そうとし、Codex を持たない人の環境では `ANTHROPIC_BASE_URL` が通常 Anthropic API に向いているため、公式 API に `claude-gpt-5-6-sol` リクエストが送られて失敗する（セッション5で確認した挙動）。

**最も確実な対策: エージェント定義自体を Git 管理下に置かない**

`cliproxyapi.config.yaml` 自体が「サンプルをコピーしてローカルにだけ置く、Git にコミットしない」という扱いになっているのと同じパターンを踏襲する:

1. 実際の `model: claude-gpt-5-6-sol` エージェント定義は、`~/.claude/agents/`（ユーザースコープ、リポジトリの外）に置く。
2. Codex を持つメンバーだけが cliproxyapi のセットアップと合わせて個人環境に追加する形。
3. Codex を持たないメンバーの環境にはそのエージェント定義自体が存在しないため、Claude 側も選択しようがなく、失敗しようがない。
4. リポジトリには「テンプレート」として `docs/development/` 配下にサンプルファイルを置く（`cliproxyapi.config.example.yaml` と同じ扱い）。
5. cliproxyapi セットアップ手順の中で「このテンプレートを `~/.claude/agents/` にコピーしてください」と案内する形が既存パターンと整合する。

**CLAUDE.md フォールバック方針の位置づけ:**

CLAUDE.md に記載されたフォールバック方針（「GPT 系モデルが使用できないときは Opus/Sonnet/Haiku で運用する」）は、あくまで**運用上の指示であってエージェント定義の存在自体を止める力はない**。上記のスコープ管理と併用する**補助策**という位置づけ。

**次のステップについてユーザーに確認:**

この設計方針を `docs/development/cliproxyapi-setup.md` に記載するか、実際にそのエージェント定義を作る段階になってから記載するかをユーザーの意向に委ねた（回答時点で docs への記載は実施していない）。

---

注意事項: セッション1〜7 で、Claude Code のモデル選択・サブエージェント起動・カスタムモデル設定、cliproxyapi の Codex 依存性、および Codex がない場合のエージェント定義の安全な配置設計についての一連の調査と対応が完了。セッション7では設計方針の確認までが完了し、実装（テンプレートファイルの作成や docs への記載）はまだ。本ドキュメント内容は「セッション7 回答時点」での状態を反映。
