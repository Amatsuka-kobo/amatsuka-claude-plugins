# 前の try の intent の扱い

入口が intent パスのときに、手順 2 の前に読む。手順 2 は intent の frontmatter と本文を読む。実装の途中で止まった try の intent は、run ブランチ `codiel/<slug>` にコミットされている。手順 1 の 4 でそのブランチへ切り替え済みなので、intent は作業ツリーにある。

手順 0 は frontmatter の `run` と state の `intent` で、終端でない run(再開の候補)を探す。この確認は、入口のパスのファイル名の slug で、終端になった前の try を探す。

- 入口のパスのファイル名の slug で `node <plugin-root>/scripts/codiel-state.mjs get --slug <slug>` を実行し、最新の try の state を読む。run が無いとき、state の `intent` が入口のパスと違うとき、終端でないとき(手順 0 で扱う)は、以降を行わない。
- 最新の try の `stopReason` が `commit-failed` なら、作業ツリーに残した intent をそのまま使う。承認済みの新しいバージョンは作業ツリーにしか無い。
- 最新の try の `branch` が `null`(文書だけで終えた try)なら、intent は開始時のブランチにコミット済みである。

最新の try が `stopped` で、`stopReason` が `raguel-stop` か、`humanApproved` の無い `verdict: "STOP"` のフェーズを持つときは、STOP を受けたフェーズとその `evaluationId` を示し、新しい try を作ってよいかをユーザーに確かめる。

- 承認されたら、手順 5 の (4) の `init` に `--human-approved` を付ける。承認されなければ run を始めない。
- 前の try から run ブランチに残るコードは、新しい try の `carry-over` フェーズのゲートで評価する。文書は新しい try の各フェーズで書き直し、そのフェーズのゲートで評価する。

手順 5 の (1) は、前の try の intent と同じパスに承認済みのドラフトを書く。
