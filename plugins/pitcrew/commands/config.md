---
description: pitcrew の対話式セットアップ。捕捉対象・注入タイミング・ビューア・テーマ・ポートを .claude/pitcrew.local.md に保存する
---

pitcrew の設定を対話で確認し、`.claude/pitcrew.local.md`(プロジェクトルート基準)に保存してください。
以下の手順に厳密に従うこと。

## 手順

### 1. 現在値の読み取り

`.claude/pitcrew.local.md` があれば読み、frontmatter の現在値を対話の初期値にする。
無ければ既定値を初期値にする:

| キー | 既定値 | 意味 |
| --- | --- | --- |
| `viewer` | `files` | ビューア(browser / tui / files)。tui は後続ステージで実装予定 |
| `capture_targets` | `[diff, artifact, test]` | 捕捉対象の組み合わせ |
| `artifact_globs` | `["docs/**/*.md"]` | 成果物として捕捉する glob(設定時は既定を置き換え) |
| `test_commands` | `[]` | テスト・ビルド判定に追加するコマンド接頭辞(既定リストに追加) |
| `injection_timing` | `hybrid` | hybrid / turn-boundary / immediate |
| `theme` | `device` | ブラウザビューアの初期テーマ(device / light / dark) |
| `port` | `7373` | ブラウザビューアの待受ポート(1〜65535) |

### 2. 対話(AskUserQuestion を使う)

1 回目の AskUserQuestion で次の 4 問を聞く(各問の初期候補は現在値を最初に置き「(現在)」を付ける):

1. **ビューア**: 「ファイル直接(エディタ)」「ブラウザ(/pitcrew:serve で起動)」「TUI(後続ステージで実装予定)」
2. **捕捉対象**(multiSelect): 「コード diff」「成果物ファイル」「テスト・ビルド結果」
3. **注入タイミング**: 「ハイブリッド — urgent は即時・normal はターン境界(推奨)」「ターン境界のみ — 全コメントを Stop で注入」「即時のみ — 全コメントをパス一致で即時注入(取り残しはターン境界で回収)」
4. **ブラウザビューアのテーマ初期値**: 「デバイス追従」「ライト」「ダーク」

2 回目の AskUserQuestion で次の 3 問を聞く:

1. **成果物 glob**: 「既定のまま(docs/**/*.md)」「変更する(Other で glob をカンマ区切り入力)」
   - 注意書きとして「glob 自体にカンマは使えない」ことを options の description に含める
2. **テストコマンドの追加**: 「追加しない」「追加する(Other でコマンド接頭辞をカンマ区切り入力)」
3. **ブラウザビューアのポート**: 「7373(既定)」「変更する(Other でポート番号を入力)」

### 3. 保存

回答をまとめて `.claude/pitcrew.local.md` を次の形式で書く(`.claude/` が無ければ作成):

```markdown
---
viewer: files
capture_targets: [diff, artifact, test]
artifact_globs: ["docs/**/*.md"]
test_commands: []
injection_timing: hybrid
theme: device
port: "7373"
---

# pitcrew 設定

`/pitcrew:config` で生成。手で編集しても有効(次の hook 起動から反映される)。

- viewer: browser | tui | files
- capture_targets: diff / artifact / test の組み合わせ(外した種別は捕捉しない)
- artifact_globs: 成果物として捕捉する glob(設定時は既定 docs/**/*.md を置き換え。空配列は既定のまま。docs/chat/ は常に除外)
- test_commands: テスト・ビルド判定の追加コマンド接頭辞(既定リストに追加)
- injection_timing: hybrid | turn-boundary | immediate
- theme: ブラウザビューアの初期テーマ(device | light | dark)
- port: ブラウザビューアの待受ポート
```

書式の制約(hooks 側のパーサがフラット YAML しか読めないため厳守):

- frontmatter はフラットな key-value とインライン配列(`[a, b]`)のみ。ネスト・複数行は不可
- glob のように `*` や `/` を含む値は `"` で囲む
- `port` は `"7373"` のように引用して書く
- 配列要素にカンマを含めない

**ユーザーが対話を途中でやめた(キャンセルした)場合は、ファイルを一切変更せず「設定は変更しませんでした」と伝えて終了する。**

### 4. .gitignore の提案

保存後、プロジェクトの `.gitignore` を確認し、`.pitcrew/` と `.claude/pitcrew.local.md` のうち無いものがあれば「`.pitcrew/`(ローカル状態)と `.claude/pitcrew.local.md`(個人設定)は .gitignore への追記を推奨します。追記しますか?」と確認し、同意されたら無いものだけを追記する。両方とも既にあれば何もしない。

### 5. リセットの案内(最後に 1 回だけ確認)

「`.pitcrew/`(レビューキュー・コメント・実行状態)をリセットしますか? 通常は不要です」と確認する。
同意された場合のみ `.pitcrew/` ディレクトリを丸ごと削除する(全状態がこの配下に閉じているため、削除で初期状態に戻る)。拒否・無回答なら何もしない。

### 6. 完了報告

保存した設定の要約(変更点があれば変更前 → 変更後)を表で示して終了する。
