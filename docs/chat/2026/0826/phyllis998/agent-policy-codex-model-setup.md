# agent-policy Codex モデル定義の確認

- 日付: 2026-08-26
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: agent-policy モデル定義の確定
- 前提: agent-policy プラグインのドキュメント

---

## セッション 1: Codex モデル定義名の確認（Terra/Grok）

# AI

表示・生成、ja 使用。

GPT(Codex系)・Grok 併用ポリシー。各ベンダー前提確認:

- **GPT**: Claude Code が gpt-sol/terra/luna 配信ローカルプロキシ経由起動か。プロキシ `/v1/models` 応答に使用予定エイリアスあるか。
- **Grok**: 同様に grok 配信ローカルプロキシ経由起動か。`/v1/models` に grok エイリアスあるか。

コマンド実行不要。現況のみ確認。

全モデル既存定義なし → 全部新規。

| モデル | 定義名 | model値 | 役割 |
|---|---|---|---|
| Sonnet | sonnet-code-reviewer | sonnet | コードレビュー |
| Haiku | haiku-reviewer | haiku | 設計書・計画書レビュー |
| Fable | fable-adviser | fable | アドバイザー |
| GPT Sol | gpt-sol-lead-implementer | claude-gpt-5-6-sol | 複雑・重要実装 |
| GPT Terra | gpt-terra | claude-gpt-5-6-terra | 通常実装・その他タスク |
| GPT Luna | gpt-luna-light-implementer | claude-gpt-5-6-luna | 軽量実装 |
| Grok | grok | claude-grok-4-6 | 探索実働・リアルタイム調査・独立レビュー |

GPT Terra と Grok の定義名、自由記述で指定を。具体的にどんな名前にするか。

GPT Terra、Grok の定義名、自由記述で指定を選択。具体的な名前を教えてほしい。

- GPT Terra: 既定 `gpt-terra` の代わりに何とするか
- Grok: 既定 `grok` の代わりに何とするか

# phyllis998

> GPT Terra: gpt-terra-implementer
> Grok: grok-researcher

## セッション 2: GPT Terra・Grok の定義名確定

# phyllis998

> ARCHITECTUREの変更を行いたいです。
> tobe: 現在scriptsフォルダの説明には、今あるスクリプトの具体的な説明が書かれている
> asis: 一般的な説明 "ターミナルで手動実行するためのShellScriptを置く" に変え、tools "AIが使用するPythonスクリプトツールを置く" を追加したい

> ARCHITECTUREの変更を行いたいです。
> asis: 現在scriptsフォルダの説明には、今あるスクリプトの具体的な説明が書かれている
> tobe: 一般的な説明 "ターミナルで手動実行するためのShellScriptを置く" に変え、tools "AIが使用するPythonスクリプトツールを置く" を追加したい

## セッション 3: ARCHITECTURE の scripts・tools フォルダ説明を確定

# AI

現状確認。`scripts/` 中身: install-proxy.sh / setup-workspace.sh / start-proxy.sh の3本、全部シェルスクリプト。`tools/` は既に空フォルダとして存在(追跡外)。

ARCHITECTURE.md 該当箇所(58行目):
```
├── scripts/    開発環境のセットアップとローカルプロキシの起動スクリプトを置く(言語不問)
```

変更に伴い2点、判断要る。

桁揃え確認OK(説明列37文字目統一)。stage-architecture 実行、diff確認。

stage完了。warnings なし。diff:

```diff
--- harness-docs/ARCHITECTURE.md (現行)
+++ harness-docs/ARCHITECTURE.md (stage)
@@ -55,7 +55,8 @@
 ├── .claude-plugin/marketplace.json  配布するプラグインの一覧を宣言する
 ├── .claude/rules/metatron/          metatron が管理する規律を置く
 ├── harness-docs/                    設計書・実装計画書と ARCHITECTURE・GOTCHAS を置く
-├── scripts/                         開発環境のセットアップとローカルプロキシの起動スクリプトを置く(言語不問)
+├── scripts/                         ターミナルで手動実行するための ShellScript を置く
+├── tools/                           AI が使用する Python スクリプトツールを置く
 ├── docs/                            人間向けの文書と会話記録を置く
 │   └── prompts/                     別セッションの起動プロンプトを置く
 ├── .raphael/                        raphael の抗体を置く
@@ -93,7 +94,7 @@
   "impl": [...],
   "prompt": [...],
   "bundle": [...],
-  "manifest": [..., "vitest.config.ts", "scripts/**"],
+  "manifest": [..., "vitest.config.ts", "scripts/**", "tools/**"],
   "docs": [...]
```

stagingId: `af462587-0651-4ccb-931c-7b05e241d0c4`(24時間程度で失効)。

これで確定(commit-architecture)してよいか。

バックグラウンド処理起動済み。

ARCHITECTURE.md 変更は stage 済み(stagingId: `af462587-0651-4ccb-931c-7b05e241d0c4`)、`commit-architecture` 実行の承認待ち。

ARCHITECTURE.md の変更、`stage-architecture` まで完了しています(stagingId: `af462587-0651-4ccb-931c-7b05e241d0c4`)。内容は以下の通りです。

- `scripts/` の説明を「ターミナルで手動実行するための ShellScript を置く」に変更
- `tools/` を新設し「AI が使用する Python スクリプトツールを置く」を追加
- ドメインマップの `manifest` に `tools/**` を追加

この内容で `commit-architecture` を実行してよろしいでしょうか。承認いただければ確定します。

raphael の蒸留サブエージェント(`a46c52e4edb5941af`)は実行中のため、重複起動はしていません。

ARCHITECTURE.md の変更は `commit-architecture` 実行の承認待ちのままです。

# phyllis998

> 承認します。

## セッション 4: ARCHITECTURE の scripts・tools フォルダ説明を確定

# AI

ARCHITECTURE.md 更新完了。

- `scripts/`:「ターミナルで手動実行するための ShellScript を置く」
- `tools/`:「AI が使用する Python スクリプトツールを置く」(新設)
- ドメインマップ `manifest` に `tools/**` 追加

`git status` 上は `harness-docs/ARCHITECTURE.md` が変更対象として現れます(コミットは未実行、必要ならお申し付けください)。

ARCHITECTURE.md の変更は反映済み、コミットは未実行のままです。他にご指示があればどうぞ。

chat-recorder のバックグラウンド記録が完了しました。記録内容そのものはユーザー応答に含めない運用のため詳細は割愛します。

ARCHITECTURE.md の変更は反映済み、コミットは未実行のままです。他にご指示があればどうぞ。

# phyllis998

> 追加依頼です。
> AIがSerenaを使ってPythonスクリプトを書けるように、Serenaの言語サーバー設定にPython相当のモノを追加し、探索と編集ruleに追加してください

## セッション 5: Python スクリプト編集対応と conventions.md 更新

# AI

`.serena/project.yml` の `language_servers` に `python` を追加済みです(通常ファイル編集、保護対象外)。**Serena の言語サーバー設定は MCP 再起動まで反映されません。** 反映確認は次回 Serena 再起動後に行ってください。

`conventions.md` の変更は stage 済みです(stagingId: `f9ecaed6-fbd2-470d-9f3f-9d585232f2c9`)。

```diff
--- .claude/rules/metatron/conventions.md (現行)
+++ .claude/rules/metatron/conventions.md (stage)
@@ -5,7 +5,7 @@
 ## 探索と編集
 
 - コードベースの探索は Serena のシンボルツールで行う。0 件でも結論にせず Grep で裏を取る。
-- TypeScript / JavaScript / Markdown の作成と編集は Serena の編集ツールで行う。
+- TypeScript / JavaScript / Markdown / Python の作成と編集は Serena の編集ツールで行う。
 - ライブラリ・フレームワーク・CLI・API の仕様、セットアップ手順、コード生成の方法が要るときは Context7 で取る。Web 検索より優先する。
 
 ## プラグイン開発
```

補足: Serena の Python 言語サーバーは既定で Pyright(追加インストール不要、Context7 で確認済み)。BasedPyright / Jedi 等の代替もあるが、指定なければ Pyright 相当の `python` で問題ないと判断しました。

この内容で `commit-rules` を実行してよろしいでしょうか。

`conventions.md` の変更、`commit-rules` 実行の承認待ちのままです。

conventions.md の変更、`commit-rules` 実行の承認待ちのままです。

# phyllis998

> 承認します

## セッション 6: 必須ツール導入スクリプト作成

# phyllis998

> このプロジェクトの必須ツールをインストールするためのスクリプトを作成してください

## セッション 7: スクリプト実装を GPT Terra に委譲

# AI

GPT Terra へ `scripts/install-toolchain.sh` の実装を委譲した。完了通知が届き次第、レビューして報告する。

# phyllis998

> gh cliは、auth login真でお願いします
