# sandalphon 共通規律

`capturing-intent` / `bridging-execution` / `executing-intent` のいずれかを読むときは、併せてこの文書も読む。

## 基本方針

経路の選択はグレースフルデグラデーション、承認はフェイルクローズドとする。

- 使えない経路は選択肢に出さず、理由を 1 行添えて畳む。エラーで止めない。
- 承認ゲートと外部公開行為の承認は、取れなければ止まる。畳む対象にしない。
- 経路の欠落を承認の省略に流用しない。経路は畳んだうえで、残った経路の承認は通常どおり取る。

## 大原則

- ディスカッションはユーザーが使用する言語を厳守する。
- intent 文書と issue 本文の言語は、Phase 1 で 1 回だけ別に確認する。
- 外部から見える操作(起票・ラベル付与)は、ユーザーの明示承認を得るまで行わない。
- STOP するときは「理由」と「次にユーザーがすべきこと」を伝えて終了する。

## 環境チェック

最初のフェーズで 1 回実行し、得た JSON を後続フェーズでも使い回す。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-intent-env.mjs"
```

- 出力 JSON の事実に基づいて判断する。
- ARCHITECTURE / GOTCHAS のパスは固定値で持たず、`projectDocs` の解決結果を使う。

## 畳む経路の対応表

| 条件 | 畳む経路 | 添える案内 |
| --- | --- | --- |
| `isGitRepo: false` | issue 経路。作業ブランチも作らない | intent 文書はカレントディレクトリ基準の保存先を絶対パスで提示し、確認を取ってから保存する |
| `repoSlug: null` | issue 経路 | remote が無い、または GitHub 以外である旨 |
| `ghInstalled: false` | issue 経路。GitHub 操作系 MCP Tool が使えるならそちらを使い、畳まない | `gh` の導入 |
| `ghAuthenticated: false` | 同上 | `gh auth login` を実行すれば issue 起票も使える |
| 利用可能スキルに `issue-craft` が無い | 委譲。自前起票に切り替える | なし |
| 利用可能コマンドに `/codiel:run` が無い | Codiel 委譲。言及もしない | なし |
| `codielHarness.dirExists: false` | Codiel 委譲 | `/codiel:init` を実行すると次回から委譲できる |
| `projectDocs.domainsReadable: false` | Codiel 委譲 | `/metatron:init` が使えるならそれを、使えなければ `/codiel:init` の最小 ARCHITECTURE 生成を案内する |
| `testRunner.detected: false` | 自動テストによる検証。手動検証手順へ縮退する | なし |
| `blankIssuesEnabled: false` かつ `templates` が空でない | 何も畳まない | 自前起票で本文がテンプレートと衝突するときは、衝突内容を提示して 3 択でユーザーに選ばせる |
| metatron が未導入 | 何も畳まない | なし |
| 利用可能ツールに `mcp__raguel__*` が無い | 何も畳まない | `/codiel:run` は Raguel MCP 接続が無いと開始しない |

## 畳んだことの報告

- 畳んだ経路は必ず 1 行で理由を報告する。無言で選択肢を減らさない。
- 1 行は「理由 + 使えるようにする方法」に収める。

例: `gh が未認証のため issue 起票は行わなかった(gh auth login で有効になる)。`

## 自前起票

- Issue 本文は一時ファイルに書き、`gh issue create --title <title> --body-file <一時ファイル>` で渡す。
- 全文提示と明示承認は sandalphon 側で行う。

## 失敗時

- 生のエラーをそのままユーザーに報告して停止する。
- 勝手なリトライをしない。代替手段へ切り替えない。
- どこまで処理済みかを報告に含める。intent 文書が保存済みなら、そこから再実行できる旨を添える。
