# pr の運転

pr に入ったときに読む。開始前の `git status --short` の確認は、本文 2.1 の確認義務に従う。手順は §0 で判定した連携モードで分かれる。

## github

1. 次の読み取りだけの Bash で PR テンプレートを探す。
   ```
   find . -maxdepth 2 -iname 'pull_request_template.*'
   ```
   - 対象は、`.github/`・リポジトリのルート・`docs/` にある `pull_request_template.md` / `.txt`(大文字小文字を区別しない)だけにする。`.github/` → ルート → `docs/` の順で、最初に見つかったものを使う。
   - `PULL_REQUEST_TEMPLATE/` の下にしかヒットが無いときは使わない。
2. 本文を組み立てる。内容は `<plugin-root>/references/github-writing-pr.md` に従い、要望・経緯は転記せずリンクだけを置く。文の書き方は `<plugin-root>/references/github-writing.md` の執筆規則にも従う。
   - テンプレートを使うときは、見出しの構成を保ち、記入の案内の HTML コメントを消す。`<!-- codiel:generated -->` などの codiel のマーカーは残す。
   - codiel が必ず書く項目(変更の説明、intent 文書へのリンク、Issue を入口にした run の `Closes #N`、テストの結果)に当たる見出しが無ければ、末尾に足す。
   - PR 本文に入れない内容(要望・受け入れ基準・原文・run の経緯)を求める見出しには、intent 文書へのリンクを書く。
   - 同意・署名・人の確認を表すチェックボックス(行動規範への同意、CLA の署名、「テストした」など)は付けずに残し、人が確かめる項目であることを本文に書く。
   - テンプレートが見つからなければ、`github-writing.md` の執筆規則だけに従って書く。
   - `imageUpload` に使える手段があれば、E2E のレポートの画像など関連する画像を、`<plugin-root>/references/github-writing-images.md` にある「Issue・PR・コメント全般」の縮退の順序で載せる。
   - 本文には `<!-- codiel:generated -->` を含める。
3. 本文を Write ツールで `.codiel/runs/<slug>/try-<n>/reports/pr-body.md` に書く。
4. push の前に、リポジトリに `codiel` ラベルがあるかを `gh label list --search codiel --json name` で確かめる。このコマンドが失敗したときは、下の `gh pr create` の失敗と同じ分け方で人に頼む。結果に、名前が大文字小文字を区別せずに `codiel` と一致するものがあれば、ラベルがあるとする。
   - 無ければ、`node <plugin-root>/scripts/codiel-state.mjs mark-ask pr --slug <slug> --kind confirm` で待ち、AskUserQuestion で「作る(推奨)」「自分で用意してから続ける」「中止」のどれかを聞く。run の中の PR はラベルが無いと作れない(hook が拒否する)ので、ラベル無しで続ける選択肢は無い。init と intent ではラベルを作らずに続けられるが、ここでは用意できるまで聞く。
   - 「作る」なら `gh label create codiel --color 1D76DB --description "codiel が対応する Issue と PR"` で作る。失敗したら、エラーの文言を示して同じ質問をし直す。
   - 「作る」か「自分で用意してから続ける」の後は、`resume` してからラベルの有無を確かめ直す。まだ無ければ、もう一度 `mark-ask` して同じ質問をする。
   - 「中止」なら、本文 §2.4 の手順で待ちを片付けてから `stop --slug <slug> --reason ask-aborted` で止める。

   ラベルがあることを確かめたら、state に `issue` があり、その Issue に `codiel` が無ければ(`gh issue view <番号> --json labels`)、聞かずに `gh issue edit <番号> --add-label codiel` で足す。続けて `git push -u origin <state.branch>` を実行する。続けて、別の Bash 呼び出しで `gh pr list --head <state.branch> --state all --json url,state` を実行し、同じブランチの PR を確かめる。
   - `state` が `OPEN` の PR があれば、作り直さず、`gh pr edit <URL> --title "<タイトル>" --body-file .codiel/runs/<slug>/try-<n>/reports/pr-body.md --add-label codiel` で今の try の本文に更新する。その URL を手順 5 の `--pr-url` に使う。
   - PR が無いとき、または `CLOSED` か `MERGED` だけのときは、`gh pr create` で新しく作る。gh の `-T` / `--template`・`--fill` 系・`--web` / `-w` は使わず、次の形で呼ぶ。
   ```
   gh pr create --title "<タイトル>" --label codiel --body-file .codiel/runs/<slug>/try-<n>/reports/pr-body.md
   ```
   run の中の PR は `gh pr create --label codiel` で作る。GitHub MCP の PR を作成するツールはラベルを渡せないので、hook が常に拒否する。`--label codiel` の無い `gh pr create` も hook が拒否する。
   `gh pr create` が失敗したときは、エラーの文言で原因を分ける。
   - 同じブランチの `OPEN` の PR が既にあるとき(文言に `already exists` と URL が出る)は、その URL に `gh pr edit` で同じ更新を行い、手順 5 の `--pr-url` に使う。
   - 認証切れなど人の操作が要るときは、`node <plugin-root>/scripts/codiel-state.mjs mark-ask pr --slug <slug> --kind confirm` で待ち、`gh auth login` などの対応を人に頼む。答えを得たら `resume` し、手順 4 の `gh pr create` からやり直す。
   - 原因が分からないときは、エラーの文言を示して同じ `mark-ask` で待ち、人の指示を得る。
5. 作成後(または既存の PR を更新した後)に次を実行する。
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
