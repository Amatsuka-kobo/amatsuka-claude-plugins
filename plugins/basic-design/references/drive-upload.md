# Google Drive アップロード手順(オプトイン)

成果物のローカル保存が完了した**後**に、この手順を実行する。

## 1. 設定の確認

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-drive-config.mjs"
```

- `configured: false` → **何もしない。ユーザーに Drive の話を一切しない**。手順はここで終了
- `configured: true` → `driveFolderId` を使って手順 2 へ

## 2. アップロードの提案と実行

ユーザーに「Drive 設定があるので、生成物を Google Drive にアップロードしますか?」と確認する(明示承認制)。承認されたら:

1. 自分の利用可能ツール一覧から、**Google Drive へのファイルアップロードができる MCP Tool** を探す
2. **見つかった場合**: 対象ファイル(生成物 .drawio / .html / .md のみ。**spec JSON は対象外**)を `driveFolderId` のフォルダへアップロードする
   - **アップロード前に同名ファイルの有無を必ず扱う**: Drive 上のファイル一覧・検索ができるツールがあればそれで確認し、既にある場合は「上書き更新か、別名で追加か」をユーザーに確認する。確認手段が無い場合は「同名ファイルの有無を確認できない(重複や意図しない上書きが起こりうる)」ことを伝え、**続行するかをユーザーに確認してから**実行する
   - 成功したら、アップロード先(ファイル名と可能なら URL)を報告する
   - 失敗したら生のエラーをそのまま報告して STOP(ローカル保存は完了している。勝手なリトライをしない)
3. **見つからない場合**: 次を伝えて STOP:
   - ローカル保存は完了していること(パス一覧)
   - Drive 系 MCP サーバーの導入が必要なこと(例: `claude mcp add` で Google Drive 対応の MCP サーバーを追加)
   - 手動アップロードの方法: [drive.google.com](https://drive.google.com) で対象フォルダを開き、生成物をドラッグ&ドロップ

## 3. Web 版 Draw.io での開き方(.drawio をアップロードした場合)

app.diagrams.net → 「Open Existing Diagram」→ Google Drive を選択 → アップロードしたファイルを選ぶ、と案内する。

## 設定の登録(ユーザーが明示的に依頼したときのみ)

「Drive 連携を設定したい」と依頼されたら、`.claude/basic-design.local.md` を次の形式で作成するよう案内する(このファイルは通常 gitignore 対象。リポジトリの .gitignore に `.claude/*.local.md` が無ければ追加を提案する):

```markdown
---
drive_folder_id: "1AbCdEfGh..."   # Drive のフォルダ URL 末尾の ID
---
```
