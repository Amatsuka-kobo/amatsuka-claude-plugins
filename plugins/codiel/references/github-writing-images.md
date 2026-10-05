## 画像の載せ方

縮退の順序は、文書の種類で 2 つに分かれる。

| 順 | Issue・PR・コメント全般 | レビュー本文 |
| --- | --- | --- |
| 1 | `gh` が 2.99.0 以上で、リモートのホストが `github.com` か `*.ghe.com` なら `--attach` で載せる | claude-in-chrome が使えれば、ブラウザから GitHub に画像をアップロードし、得た URL をレビュー本文に書く |
| 2 | claude-in-chrome が使えれば、ブラウザからアップロードして得た URL を本文に書く | `gh` が 2.99.0 以上でホストが `github.com` か `*.ghe.com` なら、画像付きの本文を `gh pr comment --attach` で投稿し、承認・変更要求の判定だけを `gh pr review` で行う |
| 3 | どちらも使えなければ、画像をローカルに保存し、本文に添付できなかった理由と保存パスを書く | 同左 |

- `--attach` を使うのは、`gh` が 2.99.0 以上で、かつ `origin` のホストが `github.com` か `*.ghe.com` のときだけである。GHES のホストでは使わず、次の順へ縮退する。
- `--attach` に渡すパスは、本文に書いた `![alt](./file.png)` の相対パスと一致させる。`#` の後ろに alt を書ける(例: `--attach './file.png#alt'`)。`gh pr review` には `--attach` が無いため、レビュー本文の画像は表の 2 系統目に従う。
- 使える手段は、run の state の `imageUpload` フィールドで判定する。
- local モードの run は、常にローカル保存を採る。
- ローカルに保存するときの保存先は、run の `reports/` である。E2E のレポートの画像を証拠に使うときは、画像の置き場(実行ごとのディレクトリ。`e2e-report-format.md`)を本文に書く。
- 画像の可視性はリポジトリの可視性に従う。private リポジトリの画像は `private-user-images.githubusercontent.com` から配信され、閲覧権限のある人にだけ見える。画像を載せる前に、公開してよい画像かを確かめる。
- アップロードは取り消せない外部公開行為である。

## ブラウザでの画像アップロード

ブラウザが使えて、対象リポジトリに書き込める GitHub アカウントにログイン済みであることが前提である。

対象の Issue または PR の画面を新しいタブで開く。コメント欄(Add a comment のフォーム)にある `type=file` の入力を探し、画像を渡す。「Attach files」のボタンは押さない。押すと OS のファイル選択画面が開き、そこから先を操作できなくなる。数秒待つと、コメント欄の `textarea`(`name="comment[body]"`)に `<img src="https://github.com/user-attachments/assets/<uuid>" ...>` が入るので、この値から `user-attachments` の URL だけを取り出す。取り出したら、`textarea` の値を空にしたうえで入力イベントを送り、未投稿の下書きを破棄する。そのうえでタブを閉じ、取り出した URL を本文の `![alt](URL)` に使う。

ログイン画面が出る、`type=file` の入力が見つからない、待っても URL が入らないときは、いずれも操作の失敗として次の順へ縮退する。
