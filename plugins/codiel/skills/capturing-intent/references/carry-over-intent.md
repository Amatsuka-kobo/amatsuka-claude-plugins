# 前の try からの intent の持ち込み

入口が intent パスのときに、手順 2 の前に読む。手順 2 は intent の frontmatter と本文を読む。実装の途中で止まった try の intent は、その run ブランチにしか無い。

手順 0 は frontmatter の `run` と state の `intent` で、終端でない run(再開の候補)を探す。この持ち込みは、入口のパスのファイル名の slug で、終端になった前の try を探す。

- 入口のパスのファイル名の slug で `node <plugin-root>/scripts/codiel-state.mjs get --slug <slug>` を実行し、最新の try の state を読む。run が無いとき、state の `intent` が入口のパスと違うとき、終端でないとき(手順 0 で扱う)は持ち込まない。
- 最新の try の `stopReason` が `commit-failed` なら持ち込まず、作業ツリーに残した intent をそのまま使う。承認済みの新しいバージョンは作業ツリーにしか無い。
- 最新の try の `branch` が `null`(文書だけで終えた try)なら持ち込まない。intent は開始時のブランチにコミット済みである。
- それ以外は `git checkout <最新の try の branch> -- <intent パス>` で同じパスに持ち込む。失敗したら(run ブランチを消した場合など)、出力を示してユーザーに確かめる。この時点では active run が無いので、応答を待って止まれる。

持ち込みとは別に、最新の try が `stopped` で、`stopReason` が `raguel-stop` か、`humanApproved` の無い `verdict: "STOP"` のフェーズを持つときは、STOP を受けたフェーズとその `evaluationId` を示し、新しい try を作ってよいかをユーザーに確かめる。

- 承認されたら、手順 5 の (4) の `init` に `--human-approved` を付ける。承認されなければ run を始めない。
- 前の try の成果物(intent 以外)を新しい try で使うときは、それを作るフェーズを新しい try で進め、そのフェーズのゲートを通してから後のフェーズの入力にする。ゲートを通さずに run ブランチへ持ち込まない。

try-2 以降の新しい run ブランチは、開始時のブランチから切る。手順 5 の (1) は、持ち込んだ intent と同じパスに承認済みのドラフトを書く。
