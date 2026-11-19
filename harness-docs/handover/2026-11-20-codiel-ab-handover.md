# codiel の run の前後比較(Subtask #15) 引き継ぎ書

- 日付: 2026-11-20
- 引き継ぎ元: Story #13(codiel の指示層の簡素化)の起票と、Subtask #15 の初版を作ったセッション
- 引き継ぎ先: 隔離環境を整え、ぶれの基準を計測して #15 を閉じるセッション
- 作業場所: worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-codiel-ab`(ブランチ `feat/codiel-ab`)。PR は未作成

## 現在地

| 工程 | 状態 |
| --- | --- |
| Issue | 起票済み。Story #13、Subtask #15(前後比較スキル)・#16(設計書)・#17(小スキル 3 本の改修)・#18(orchestrating-runs の改修)。#15 と #13 は In Progress |
| ツールとスキルの初版 | コミット済み(`091a1535`)。`tools/codiel_ab.py`、`.claude/skills/codiel-ab/SKILL.md`、`assets/answers.json`・`contracts.json`・`judge.md` |
| 隔離なしの試行 | 改修前・sonnet・規模 標準の 1 本が完走した。記録は `/home/hiro0209/codiel-ab-out/2026-11-18-baseline/runs/before/sonnet-1/` |
| 隔離環境(sbx) | 未導入。この WSL2 に `/dev/kvm` が無い。ユーザーの手で行う手順を示し、結果を待っている |
| ツールの sbx 対応 | 未着手 |
| ぶれの基準の計測 | 未着手。隔離環境で 4 本とも採り直す |
| スキルの eval セットと description の測定 | 未着手 |

## 決まったこと

再検討しない。

- run は、人への質問に規則で代理回答する自動実行で回す。
- 比較する項目は、コスト・run の進み方・成果物の質・指示への違反の 4 つである。
- ぶれの基準は、同じコミット `6fe8dafa` を改修前後の両方に渡し、sonnet と opus で 1 回ずつ、規模 標準の計 4 本で採る。
- codiel の hook が確認を求めた操作は拒否して数える。Raguel の ASK は「このまま承認」、STOP は「妥当として止める」で答える。
- run は Docker Sandboxes(sbx)の中で回す。WSL の入れ子の仮想化を直して sbx を入れる。隔離環境ができるまで、隔離なしで run を回さない。
- #16〜#18 は #15 が終わってから着手する。

## 未決のこと

- `.wslconfig` に `nestedVirtualization=true` を足して WSL を再起動した後、`svm` と `/dev/kvm` が見えるか。見えないときは、Windows の `sbx.exe` を使う方法か通常の Docker コンテナでの隔離かを、ユーザーに尋ねる。
- sbx の中で、サブスクリプション認証の `/login` の状態が後から作るサンドボックスに引き継がれるか。
- sbx の中で、TTY なしの stdin と stdout を数時間やり取りできるか。
- sbx の中で、Playwright と Chromium が動き、npm のレジストリへ出られるか。
- sbx の中の transcript の場所。`/home/agent/.claude/projects` は推定である。
- `report` の「review の回数」が、fix-loop を通らない run で 2 と出た。`review-*.md` の数え方を確かめる。
- 止めた 2 本目の claude プロセス(PID 2022461)が残っていないか。

## sbx の導入手順(ユーザーの手で行う)

1. `C:\Users\<ユーザー名>\.wslconfig` の `[wsl2]` に `nestedVirtualization=true` を足し、PowerShell で `wsl --shutdown` を実行する。
2. WSL で `grep -c svm /proc/cpuinfo` が 1 以上を返し、`sudo modprobe kvm_amd` の後に `/dev/kvm` があることを確かめる。
3. `curl -fsSL https://get.docker.com | sudo REPO_ONLY=1 sh && sudo apt install docker-sbx` を実行する。
4. `sudo usermod -aG kvm $USER` の後、`sbx login` と `sbx policy init balanced` を実行する。
5. サンドボックスの中で Claude Code の `/login` を行う。

## ツールを直す箇所

- `drive` の claude の起動を、`sbx create --name <名前> claude <題材の複製> <codiel の複製>:ro` と `sbx exec -i -w <dir> <名前> claude -p ...` に置き換える。
- `sbx run claude -- -p` は全許可のフラグが付くので使わない。
- `snapshot` は、state・transcript・Raguel の記録を `sbx cp` で取り出し、`sbx rm --force` で片付ける。
- `permit` は、hook の ask 以外のツール呼び出しをすべて許可する。セキュリティレビューが MEDIUM と指摘した箇所であり、隔離の中だけで動く形にする。
- ツールを直したら、`.claude/skills/codiel-ab/SKILL.md` の手順を合わせる。

## 踏みやすい点

- この worktree では、`cd` や heredoc を含む複合の Bash コマンドが拒否される。ファイルは Write で作り、コマンドは 1 つずつ実行する。
- `sudo`、`wsl.exe` の再起動、Docker のログインは、このセッションから実行できない。ユーザーに頼む。
- 題材 `~/codiel-cost-bench` は remote を持たず、`server.js` が port 3000 を使う。run は 1 本ずつ順に回す。
- `claude -p` の `result` 行はターンの終わりであり、run の終わりではない。run の終わりは state の phase で判定する。
- 隔離なしで採った 1 本目は、隔離後の run と実行環境が違う。ぶれの基準に混ぜない。
- 委譲した探索が、題材 `~/codiel-cost-bench` のブランチを一時的に切り替えて戻した。作業ツリーに変更は残っていない。ユーザーへは未報告である。
- `assets/ledger.jsonl` はまだ無い。`report --ledger` が初回に作る。

## 参照

- Issue: Amatsuka-kobo の #13・#15・#16・#17・#18。Projects は「Codiel Agent」(project 3)
- 既存の同種のツール: `tools/native_japanese_ab.py`、`.claude/skills/native-japanese-ab/`、`tools/codiel_run_usage.py`
- 計測の出力: `/home/hiro0209/codiel-ab-out/2026-11-18-baseline/`、ログ `/home/hiro0209/codiel-ab-out/2026-11-18-baseline.log`
