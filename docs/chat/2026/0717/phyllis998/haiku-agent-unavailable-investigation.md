# Haiku エージェント使用不可の原因調査

- 日付: 2026-07-17
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: なし(トラブルシューティング調査のみ、リポジトリ変更なし)
- 前提: なし

---

## セッション1: 原因の特定と根本原因分析

# phyllis998

> この環境では、claude-haiku-4-5エージェントが使用できないようです。原因を調べてください

# AI

環境設定とエージェント定義を調査。核心を確認するため、実際に haiku モデルのサブエージェント起動を試行した結果、決定的なエラーメッセージ `502 unknown provider for model claude-haiku-4-5 ... check your inference gateway (127.0.0.1:8317)` を取得。

環境構造の発見:
- この環境は本物の Anthropic API に直接つながっていない
- ローカルの推論ゲートウェイ「CLI Proxy API Server」(pixel-agents、`127.0.0.1:8317`)経由でモデルを呼んでいる
- ゲートウェイはモデル名→プロバイダの対応表を持ち、未知の名前には 502 を返す

ゲートウェイ `/v1/models` 検査結果:
- Haiku は完全な日付付き ID `claude-haiku-4-5-20251001` で登録されている
- 日付なしエイリアス `claude-haiku-4-5` の対応は存在しない
- 他のモデル(Opus/Sonnet/Fable/GPT)が動く理由: それらの設定値がゲートウェイの登録 ID と一致しているから

検証済みの直接テスト(ゲートウェイ POST `/v1/chat/completions`):

| モデル文字列 | 結果 |
|---|---|
| `claude-haiku-4-5`(現在の環境変数値) | **502 unknown provider** |
| `claude-haiku-4-5-20251001`(完全 ID) | **200 OK** ✅ |
| `claude-haiku-4-5[1m]` | 502 unknown provider |

設定元の特定:
- `~/.bash_profile:7`: `export ANTHROPIC_SMALL_FAST_MODEL="claude-haiku-4-5"` 
- `~/.bashrc:120`: claude-gu エイリアス内 `ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5`
- 実行中プロセスの環境変数にも両変数が `claude-haiku-4-5` で存在

根本原因の確定:
Claude Code に渡されている Haiku のモデル ID(`claude-haiku-4-5`)が、この環境の推論ゲートウェイに登録されていない。ゲートウェイは `claude-haiku-4-5-20251001` という完全な日付付き ID のみを認識し、短いエイリアスに対応するプロバイダが無いため 502 を返す。

修正方法:
Haiku 用の環境変数を、ゲートウェイが実際に配信している ID に合わせる:
- `~/.bash_profile:7` を `export ANTHROPIC_SMALL_FAST_MODEL="claude-haiku-4-5-20251001"` に変更
- `~/.bashrc:120` の alias 内の `ANTHROPIC_DEFAULT_HAIKU_MODEL` も `claude-haiku-4-5-20251001` に変更

注意点:
- 現在のセッションには効かない(環境変数はプロセス起動時に読み込まれるため、修正後に `claude` を再起動する必要がある)
- `ANTHROPIC_DEFAULT_HAIKU_MODEL` が実行中プロセスに存在している点から、別の起動経路(pixel-agents ランチャー等)から注入されている可能性がある
- 再起動後も直らない場合は設定ファイル参照元の追加確認が必要

---

注意事項: 本調査はトラブルシューティングのみ。修正実行とその検証は別途実施が必要。
