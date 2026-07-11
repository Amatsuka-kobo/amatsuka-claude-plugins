# ONBOARDING.md への CLIProxyAPI セットアップ手順 追記

- 日付: 2026-07-11
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `ONBOARDING.md` に Codex が利用できる場合の CLIProxyAPI セットアップ手順、および Claude Code が利用できる場合のセットアップ手順を追記。コミット未作成。
- 前提: リポジトリの CLAUDE.md、既存の ONBOARDING.md、CLIProxyAPI の Context7 ドキュメント（公式インストーラー、Homebrew、--codex-login、~/.codex/config.toml 設定）、Codex セットアップ確認結果（Codex CLI インストール済み・ログイン済み）、CLIProxyAPI 公式ドキュメント（Claude Code の環境変数、--claude-login、--no-browser、OAuth コールバックポート 54545）

---

## セッション1: CLIProxyAPI セットアップ手順を ONBOARDING.md に追記

# phyllis998

> ONBOARDING.mdに、Codexが使える場合に、CLIProxyAPIのセットアップを促す文言とそのセットアップ方法を追記してください。

# AI

CLIProxyAPI の現行セットアップ手順を Context7 から確認し、既存の `ONBOARDING.md` の構成に合わせて追記を実施した。

**実施内容:**

- 環境から Codex CLI インストール済み・ログイン済みであることを確認
- Context7 ドキュメントから、公式インストーラー、Homebrew、--codex-login、~/.codex/config.toml の設定方法を抽出
- 以下を `ONBOARDING.md` に追記：
  - Linux / macOS での CLIProxyAPI インストール方法
  - `cliproxyapi.config.yaml` の最小設定例
  - `--codex-login` による Codex OAuth 認証手順
  - `scripts/start-proxy.sh` を使った起動方法
  - `~/.codex/config.toml` の接続設定（`model_provider` と `base_url`）
  - API キーを実際の値へ置き換える注意書きと Git コミット対象外に関する明記
  - CLIProxyAPI を使わない状態へ戻す方法

**設計の判断:**

CLIProxyAPI はローカルの `127.0.0.1:8317` で待ち受け、Codex の OAuth 認証情報をプロキシ側で管理する構成。API キーは「プロキシへの接続用」としてのみ機能し、外部サービスの認証情報ではないため、サンプル値をそのまま使わないことを onboarding に明記。認証情報をリポジトリへコミットしない注意を手順へ明示した。

**検証:**

`git diff --check` を通過。変更対象は `ONBOARDING.md` のみであることを確認。

---

## セッション2: Claude Code セットアップ手順を ONBOARDING.md に追記

# phyllis998

> ONBORDING.mdのCLIProxyAPIのClaude Codeのセットアップ方法も追加してください

# AI

Claude Code を CLIProxyAPI 経由で利用するための設定手順を調査し、既存の Codex 手順に続く新規セッションとして ONBOARDING.md に追記した。

**調査プロセス:**

- Serena で既存の `ONBOARDING.md`、`cliproxyapi.config.yaml`、`scripts/start-proxy.sh` の構成を確認
- プロジェクト未選択エラーが発生したため `activate_project` で解決
- Context7 で CLIProxyAPI の公式ドキュメントから Claude Code 対応の仕様を確認
- WebFetch で公式ガイドから確定値を取得：`http://127.0.0.1:8317`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`--claude-login`、`--no-browser`、OAuth コールバックポート `54545`

**実施内容:**

既存の Codex 手順の後ろに、Claude Code 用の新規節を追加：

- Claude Code の OAuth 認証方式（`--claude-login`、`--no-browser` での認証フロー）
- OAuth コールバックポート `54545` の役割と設定
- CLIProxyAPI の API キーを使う場合の環境変数設定（`ANTHROPIC_BASE_URL=http://127.0.0.1:8317`、`ANTHROPIC_AUTH_TOKEN`）
- Claude Code 2.x / 1.x それぞれのモデル指定用環境変数
- `scripts/start-proxy.sh` でプロキシを起動してから Claude CLI を実行する流れ
- CLIProxyAPI を使わない状態へ戻す方法
- API キーをシェル履歴や Git に保存しない注意

**設計の判断:**

OAuth 認証では Claude の認証情報を CLIProxyAPI 側で管理し、Claude Code にはローカルプロキシの接続先だけを指定する方針。API キー方式では `ANTHROPIC_AUTH_TOKEN` を使い、CLIProxyAPI の `api-keys` と同じ値でプロキシへの接続を認証する構成。既存の `cliproxyapi.config.yaml` に実キーが含まれているため、ドキュメントではプレースホルダー値のみ使用し、実値の引用を避けた。

**検証:**

`git diff --check` を通過。ドキュメントのみの変更であることを確認。テストは実行していない。

---

注意事項: コミット未作成。`ONBOARDING.md` の編集は完了しているが、その他の未コミット変更（`.claude/settings.json`、`.gitignore`、`CLAUDE.md`、`cliproxyapi.config.yaml`、`docs/chat/2026/0710/codiel-discuss-phase-design.md`、`scripts/start-proxy.sh`）と並行している可能性あり。既存の `cliproxyapi.config.yaml` に実キーと思われる値が残っているため、別作業としてキーのローテーションと Git 管理対象からの除外を検討が必要。テストスイートの実行は完了していない。
