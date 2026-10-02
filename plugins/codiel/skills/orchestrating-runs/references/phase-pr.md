# pr の運転

pr に入ったときに読む。開始前の `git status --short` の確認は、本文 2.1 の確認義務に従う。手順は §0 で判定した連携モードで分かれる。

## github

1. 次の読み取りだけの Bash で PR テンプレートを探す。
   ```
   find . -maxdepth 2 -iname 'pull_request_template.*'
   ```
   - 対象は、`.github/`・リポジトリのルート・`docs/` にある `pull_request_template.md` / `.txt`(大文字小文字を区別しない)だけにする。`.github/` → ルート → `docs/` の順で、最初に見つかったものを使う。
   - `PULL_REQUEST_TEMPLATE/` の下にしかヒットが無いときは使わない。
2. 本文を組み立てる。内容は `<plugin-root>/references/github-writing.md` の「PR 本文」に従い、要望・経緯は転記せずリンクだけを置く。
   - テンプレートを使うときは、見出しの構成を保ち、記入の案内の HTML コメントを消す。`<!-- codiel:generated -->` などの codiel のマーカーは残す。
   - codiel が必ず書く項目(変更の説明、intent 文書へのリンク、Issue を入口にした run の `Closes #N`、テストの結果)に当たる見出しが無ければ、末尾に足す。
   - PR 本文に入れない内容(要望・受け入れ基準・原文・run の経緯)を求める見出しには、intent 文書へのリンクを書く。
   - 同意・署名・人の確認を表すチェックボックス(行動規範への同意、CLA の署名、「テストした」など)は付けずに残し、人が確かめる項目であることを本文に書く。
   - テンプレートが見つからなければ、`github-writing.md` の執筆規則だけに従って書く。
   - `imageUpload` に使える手段があれば、E2E のレポートの画像など関連する画像を、画像の縮退の順序で載せる。
   - 本文には `<!-- codiel:generated -->` を含める。
3. 本文を Write ツールで `.codiel/runs/<slug>/try-<n>/reports/pr-body.md` に書く。
4. `git push -u origin <state.branch>` を実行してから、別の Bash 呼び出しで PR を作る。gh の `-T` / `--template`・`--fill` 系・`--web` / `-w` は使わず、次の形で呼ぶ。
   ```
   gh pr create --title "<タイトル>" --body-file .codiel/runs/<slug>/try-<n>/reports/pr-body.md
   ```
5. 作成後に次を実行する。
   ```
   node <plugin-root>/scripts/codiel-state.mjs complete-phase pr --slug <slug> --pr-url <URL>
   ```

## local

push しない。run ブランチと base は `state.branch` / `state.baseBranch` にある。

1. 次を `--pr-url` なしで呼ぶ。
   ```
   node <plugin-root>/scripts/codiel-state.mjs complete-phase pr --slug <slug>
   ```
2. 完了報告に、ベースブランチへ取り込むためのマージ手順(マージ元のブランチ名とマージ先)を載せる。
