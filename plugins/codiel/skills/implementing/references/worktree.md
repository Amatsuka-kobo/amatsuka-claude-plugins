# worktree 内での作業

`implement.steps` の `parallel` グループのステップは、依頼文が渡す brief ファイル(`.codiel/runs/<slug>/try-<n>/steps/step-<k>/brief.md`)の絶対パスを Read し、実行モード・ドメインマップ・担当タグ・担当範囲・worktree の絶対パス・触るファイル・前提ステップ・環境準備のコマンド・委譲の種類・実行する通すテストを、そこに書かれた値として確認する。
`serial` グループのステップと、方式 b の最終ステップは worktree を作らず、run ブランチ上で直接作業する。

worktree で作業するステップは、実装に入る前に依存をインストールする。コマンドは brief の `## 環境準備` の値を使う。「なし」のときは、その worktree の lockfile の種類に合う `writing-dev-plans` の既定のコマンドを使い、対応する lockfile が無ければインストールを省く。
