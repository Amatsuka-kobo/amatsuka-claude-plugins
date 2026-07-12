# ONBOARDING.md 精査・再構成の設計セッション

- 日付: 2026-07-11
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `docs/superpowers/specs/2026-07-11-onboarding-rewrite-design.md`、`docs/superpowers/plans/2026-07-11-onboarding-rewrite.md`（ユーザーが確認中、コミット未作成）
- 前提: `ONBOARDING.md`、`README.md`、`CLAUDE.md`、`scripts/install-mdbase.sh`、`scripts/start-proxy.sh`、`cliproxyapi.config.yaml`、`.gitignore`、`.claude-plugin/marketplace.json`、Context7公式資料、CLIProxyAPI公式設定例

---

## セッション1: ONBOARDING.md 精査と再構成方針の設計

# phyllis998

> ONBOARDING.mdを精査してください。優先度が低いものは削除してください。ただしその場合は確認を取ってください。ジュニアエンジニアが読みやすい粒度に書き換えて下さい。

# AI

ユーザー確認を取りながら ONBOARDING.md の精査と再構成方針を設計した。

**調査プロセス:**

brainstorming スキルを使い、関連資料（ONBOARDING.md、README.md、CLAUDE.md、最近のコミット履歴）を確認。現状の課題は「必須環境構築手順」と「任意の高度な設定（Codex/CLIProxyAPI/Claude Code 接続）」が同じ階層に混在し、ジュニア読者が必須範囲を判別しにくいこと。また、複数の LSP 設定手順が繰り返され、説明の粒度がばらつている。

調査中に `cliproxyapi.config.yaml` に接続用キー形式の値が3件含まれ、Git の追加対象になっていることを検出。実際の秘密情報かサンプル値かは判断できないため変更していないが、コミット前の無効化・サンプル化・Git 管理対象外化のいずれかを検討すべき状態。

**ユーザー確認:**

文書の対象読者と削除範囲について段階的に確認。

1. 対象読者確認：工房メンバー（ジュニアエンジニア含む）向け、WSL2/Linux 中心のセットアップ資料
2. 削除判断基準の確認：「削除」だけでなく「別ページへ分離」も有効であることの説明を提示
3. 構成案の提示：以下の3つの案から選択
   - **案1（推奨）: 段階型＋任意設定を別ページへ分離** — ONBOARDING.md は必須手順に絞り、Codex/CLIProxyAPI は新ページ `docs/development/cliproxyapi-setup.md` へ移行
   - 案2: 単一ファイル内で必須・任意を分離 — ファイルは増やさず、前半を必須、後半を「任意設定」にする
   - 案3: 最小オンボーディング＋リンク集 — 一次情報のみに絞るが、リンク先資料が不足しており初心者に負担

ユーザーは案1を採用することで合意。

**削除対象の確定:**

ユーザーが明示的に削除を認めた低優先度情報：
- Claude Code 1.x/2.x 別の固定モデルID と環境変数例
- CLIProxyAPI の実行ファイル名が配布形態で異なり、読み替えが必要という曖昧な説明

保持対象（削除しない）：
- macOS の Homebrew インストール手順
- OAuth 認証手順
- Codex CLI 設定手順
- 接続用トークンの手順

**設計内容:**

1. **ONBOARDING.md の役割**: 工房メンバーが WSL2/Linux を中心とした開発環境を準備し、各ツールが利用可能になったことを確認するまでを案内。開発フローやテスト方法は扱わず、CLAUDE.md など既存資料へ責務を残す。

2. **章構成**:
   - この文書の対象とゴール
   - 対象環境と前提ツール
   - 必須セットアップ
   - LSP の用途とインストール
   - セットアップ確認
   - 任意設定へのリンク
   - トラブル時の確認先

3. **コマンド説明の粒度**: 各コマンドに「どこで実行するか」「成功すると何が確認できるか」を短く添える。

4. **LSP の再構成**: 4つの LSP（pyright、vtsls、bash-language-server、mdbase-lsp）は削除せず、最初に用途と対象言語を表で示す。その後、インストール手順を段階的に説明。mdbase-lsp のスクリプトが Debian/Ubuntu 系の apt と sudo を前提とし、システムパッケージ導入、Git clone、Rust ビルド、シンボリックリンク作成を行うことを事前に明記。

5. **CLIProxyAPI の分離**: 詳細手順を新ページ `docs/development/cliproxyapi-setup.md` へ移行。ONBOARDING.md には、CLIProxyAPI が任意であること、何のような場合に必要か、詳細ページへのリンクだけを残す。別ページでは、Linux と macOS のインストール手順、OAuth/API キー設定、Claude Code との連携を残す。

6. **安全性**: 認証情報を Git に含めない警告を冒頭と該当箇所に置く。`cliproxyapi.config.yaml` 自体にキー形式の値が入っているため、文書にはプレースホルダー値のみ使用し、実値の引用を避ける。

**設計の検証:**

仕様書として固定する前に、Markdown 形式、矛盾、曖昧さ、リンク先ファイルの実在性を確認。仕様書として `docs/superpowers/specs/2026-07-11-onboarding-rewrite-design.md` に保存。既存の未コミット変更が多いため、仕様書作成までは行うがコミットは行わない。

---

## セッション2: Context7 セットアップと CLIProxyAPI の設定分離

# phyllis998

> Context7のセットアップ方法をどこかに追加したいです。どこに入れるのが適切だと考えられますか？(npx ctx7 setup --claude --mcp -y)
> また、cliproxyapi.config.yamlについては、.gitignoreに入れつつも、サンプルファイルとして残しておきたいです。サンプルファイルには、oauth-excluded-modelsの設定項目を残しておきたいですが、現在設定していない不要な項目コメントアウトは削除したいです。

# AI

Context7 と CLIProxyAPI の設定分離について、配置方針と実装方針を設計へ統合した。

**Context7 の配置:**

Context7 は補完・静的診断を行う LSP ではなく、Claude Code が最新ドキュメントを取得する MCP（Machine Context Protocol）サーバーである。そのため LSP セクションの中ではなく、**LSP セクションの直前に「Claude Code の共通ツール」という新セクションを設置する**のが適切。Serena MCP の接続確認と合わせて説明し、役割の違いを初心者に明示できる。

Context7 公式資料では確認省略オプションとして `--yes` が明記されており、`-y` の正式な短縮形は確認できなかった。将来の互換性とジュニア向けの明瞭さを優先し、公式表記の次のコマンドを採用する。

```bash
npx ctx7 setup --claude --mcp --yes
```

セットアップ後の確認方法は以下。

```bash
claude mcp list
claude mcp logs context7
```

デフォルトはグローバル設定であり、工房メンバーの共通 Claude Code 環境という目的に合う。プロジェクト限定にしたい場合の補足として `--project` オプションの説明を別途追加。

**CLIProxyAPI の設定分離:**

`cliproxyapi.config.yaml` はすでに Git インデックスに追加されているため、`.gitignore` へ追加するだけでは不十分。実装時には、ファイルをローカルに残したまま次の操作でインデックスから外す必要がある。

```bash
git rm --cached -- cliproxyapi.config.yaml
```

新たに `cliproxyapi.config.example.yaml` をサンプルファイルとして Git 管理対象にする。実設定とサンプル設定の内容は以下のように分離。

**実設定（cliproxyapi.config.yaml）:**
- 各メンバーのローカル実設定
- `.gitignore` に追加
- ファイル自体は削除せず、Gitの追跡対象からのみ外す

**サンプル設定（cliproxyapi.config.example.yaml）:**
- Gitで共有するサンプル
- 実際のキーは含めない
- 現在の `oauth-excluded-models.claude` と `oauth-excluded-models.codex` の値は維持
- 未使用機能の設定、説明コメント、コメントアウトされたプロバイダー例は削除
- 最小限の構成として、以下項目のみを記載：
  - `host`、`port`、`auth-dir`
  - `api-keys`（プレースホルダー値）
  - `oauth-excluded-models`（現在の除外モデル一覧のみ）

初回セットアップの手順に次のコピーコマンドを案内。

```bash
cp cliproxyapi.config.example.yaml cliproxyapi.config.yaml
```

**設計の更新:**

Context7 の配置、CLIProxyAPI の分離方針、サンプル設定の内容を設計仕様と実装計画へ統合。形式チェック完了。

---

## セッション3: Node.js と uv を必須ツール化

# phyllis998

> serena MCPに接続するのに必要なuvと、各プラグインのスクリプトを実行するのに必要・ctx7 setupを実行するのに必要なnode.jsも必須ツールに含めたいです。

# AI

Volta で管理する Node.js LTS と Serena MCP 用の uv を必須ツールとして設計に統合した。

**Node.js の導入方針:**

Node.js 本体の管理には、プロジェクト方針に従い Volta を採用。Volta は Node.js、npm、npx のバージョンを一括管理でき、複数プロジェクト間での環境の統一を実現する。

公式の Unix/Linux 向けインストール手順は以下。

```bash
curl https://get.volta.sh | bash
```

インストール後に新しいターミナルを開き、最新の LTS 版 Node.js を導入。バージョン番号を省略した次のコマンドが自動的に LTS を選択する。

```bash
volta install node
```

確認対象は以下のコマンドで、すべてバージョンが表示されることを確認。

```bash
volta --version
node --version
npm --version
npx --version
```

Node.js が必要な理由をジュニア向けに明記。

- 各プラグインの `.mjs` スクリプトを実行する（`node plugins/task-utility/scripts/extract-conversation.mjs` など）
- スクリプト系テストを実行する（`node --test plugins/codiel/scripts/*.test.mjs` など）
- LSP をグローバルにインストールする（`npm install -g pyright` など）
- Context7 をセットアップする（`npx ctx7 setup --claude --mcp --yes`）

**uv と Serena MCP の導入方針:**

`uv` は Python 開発一般ではなく、**Claude Code が Serena MCP サーバーを起動するための必須ランタイム**として説明する。Serena 自体の Manual を取得して起動方法を確認し、存在しないコマンドをオンボーディングへ記載しない。

公式の WSL2/Linux 向け導入手順は以下。

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

インストール後に新しいターミナルを開き、以下を確認。

```bash
uv --version
uvx --version
```

`uv` のセットアップ後、Claude Code 側の Serena MCP 接続状態を確認。次のコマンドで登録済みの MCP サーバー一覧を表示。

```bash
claude mcp list
```

現在の環境では、以下の登録が正常に接続されていることを確認できた。

```
plugin:serena:serena: uvx --from git+https://github.com/oraios/serena serena start-mcp-server - Connected
context7: https://mcp.context7.com/mcp - Connected
```

ONBOARDING.md では、この一覧の `plugin:serena:serena` が `Connected` であれば、Serena のセットアップ確認完了と案内する。手動で `uvx` コマンドを実行させるのではなく、Claude Code の自動起動を前提とした構成にする。

**設計の更新:**

必須ツールの順序を以下のように整理。

1. Volta
2. Node.js LTS
3. npm／npx
4. uv／uvx

「Claude Code の共通ツール」セクションの構成も以下に更新。

1. Serena MCP の接続確認
2. Context7 のセットアップ

実装計画では、Volta インストール、Node.js 導入、`uv` インストール、各確認コマンドの詳細手順を具体化。秘密情報、リンク、Git 追跡状態の最終検証項目も追加。すべてのファイル修正と形式チェックを完了。

---

## セッション4: 実装フェーズ（Task 1〜3・最終検証）

# phyllis998

> 実装に移ってください

# AI

executing-plans スキルで Task 1〜3 の実装と最終検証を実行した。

**実装方針の決定:**

既存の未コミット変更（ONBOARDING.md、cliproxyapi.config.yaml）を土台とするため、作業ツリーは作らず現ブランチ `feat/task-utility-issue-craft` で実装を進行。ベースラインとして、既存スクリプトテスト 82 件すべての成功を確認。

**Task 1: CLIProxyAPI 設定分離（実設定とサンプルの分離）**

- `cliproxyapi.config.yaml` を `.gitignore` へ追加
- Git インデックスから外す：`git rm --cached -- cliproxyapi.config.yaml`
- ファイルはローカルに保持
- `cliproxyapi.config.example.yaml` を新規作成
  - `host`、`port`、`auth-dir` のみを記載
  - `api-keys` はプレースホルダー値
  - `oauth-excluded-models` の現在値（Claude、Codex）を保持
  - 未使用の設定項目、説明コメント、コメントアウト例は削除

**Task 1 中の課題と復帰:**

実装中に `scripts/start-proxy-api.sh` への誤った変更が検出された（計画では `start-proxy.sh` が対象）。レビューで指摘を受け、起動スクリプト名を元の `start-proxy.sh` に復元してから Task 1 を再レビュー。最終承認で Findings なし。

**Task 2: CLIProxyAPI 詳細手順ページ（docs/development/cliproxyapi-setup.md）**

新規作成。以下を含む：

- WSL2/Linux と macOS のインストール手順
- `cp cliproxyapi.config.example.yaml cliproxyapi.config.yaml` の初回セットアップ
- Codex OAuth 認証手順
- Claude OAuth 認証手順
- `--no-browser` オプションの用法
- `scripts/start-proxy.sh` での起動方法
- Codex CLI の接続設定
- Claude Code の接続用トークン設定
- 通常接続への戻し方
- キーのコミット防止、シェル履歴管理に関する注意

承認基準：削除承認範囲の遵守、macOS/OAuth 手順の保持、実キーの非記載、実ファイルリンクの正確性。個別レビュー承認、Findings なし。

**Task 3: ONBOARDING.md 全面再構成**

Volta/Node.js、uv/Serena、Context7、LSP を依存順に再構成。

- **対象環境とゴール**: 工房メンバー向け、WSL2/Linux 中心
- **必須ツール段階**:
  1. Volta（`curl https://get.volta.sh | bash`）
  2. Node.js LTS（`volta install node`）
  3. npm、npx の確認
  4. uv（`curl -LsSf https://astral.sh/uv/install.sh | sh`）
  5. uvx の確認
- **Claude Code の共通ツール**:
  1. Serena MCP 接続確認：`claude mcp list` で `plugin:serena:serena` が `Connected`
  2. Context7 セットアップ：`npx ctx7 setup --claude --mcp --yes`
- **LSP**: 4種類（pyright、vtsls、bash-language-server、mdbase-lsp）の用途一覧と段階的インストール
  - mdbase-lsp スクリプトが apt、sudo、Git clone、Rust ビルドを行う点を明記
- **セットアップ確認**: 一括確認コマンド
- **任意設定**: CLIProxyAPI 詳細ページへのリンク
- **トラブル時の確認先**

最終レビューで、「Context7 セットアップには Node.js と npx が必要」という明記の不足を検出（Minor）。追加行を明記して再レビュー実施。最終承認、Findings なし。

**最終検証**

以下の 4 項目を全検証：

1. **Markdown・YAML の空白チェック**：`git diff --check` で全項目成功
2. **参照ファイルと相対リンク**：計画対象ファイルの実在性、リンク先の正確性を確認
3. **Git 追跡状態**：
   - `cliproxyapi.config.yaml` が `.gitignore` に登録かつ Git インデックス外
   - `cliproxyapi.config.example.yaml` がトラック可能
4. **秘密情報の非記載**：既知のローカル接続用キーがトラック対象ファイルに含まれないことを確認
5. **スクリプト系テスト**：
   ```
   tests 82
   pass 82
   fail 0
   ```

**成果物の状態**

```
MM .gitignore                                              （既存ステージ変更に今回追記が重なる）
 M ONBOARDING.md                                          （修正）
?? cliproxyapi.config.example.yaml                        （新規）
?? docs/development/cliproxyapi-setup.md                  （新規）
?? docs/superpowers/plans/2026-07-11-onboarding-rewrite.md （新規）
?? docs/superpowers/specs/2026-07-11-onboarding-rewrite-design.md （新規）
```

`cliproxyapi.config.yaml` は既存ローカル設定を保持（Git 追跡対象外）。`scripts/start-proxy.sh` の既存ステージ状態は変更なし。

**総合結果**

- Task 1：CLIProxy 設定分離 — Approved、Findings なし
- Task 2：CLIProxy 詳細ページ — Approved、Findings なし
- Task 3：ONBOARDING.md 再構成 — Approved、Findings なし（Minor 1 件検出後に修正）
- 最終検証：全項目成功、テスト 82/82 pass
- **最終仕様・品質レビュー：Approved、Findings なし**

コミット・マージ・push は実施していない（ユーザー指示どおり）。ブランチ `feat/task-utility-issue-craft` の作業ツリーに変更を保持。

---

注意事項: 全実装と最終レビューが完了。コミット・マージ・push は行っていない。既存未コミット変更（ONBOARDING.md、cliproxyapi.config.yaml、.gitignore）とともに現ブランチに保持。
