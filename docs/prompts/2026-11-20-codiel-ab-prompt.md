# codiel の run の前後比較(Subtask #15) セッション起動プロンプト

以下を goal コマンドの入力として使う。作業場所は worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-codiel-ab`(ブランチ `feat/codiel-ab`)である。

---

Subtask #15(codiel の run の前後比較スキル)を、隔離環境での計測まで終えて閉じる。

## 最初に読む文書

1. `harness-docs/handover/2026-11-20-codiel-ab-handover.md`(現在地・決まったこと・未決のこと・踏みやすい点)
2. `tools/codiel_ab.py` と `.claude/skills/codiel-ab/SKILL.md`
3. GitHub の Issue #15 と親の Story #13

引き継ぎ書の「決まったこと」は再検討しない。

## 進め方

1. `grep -c svm /proc/cpuinfo` と `ls -l /dev/kvm` と `sbx version` で、隔離環境の状態を確かめる。
2. sbx が使えないときは、引き継ぎ書の導入手順のうち残っている手順をユーザーに示し、結果を待つ。`svm` が見えないままなら、隔離の別の方法を `AskUserQuestion` で尋ねる。
3. sbx が使えたら、引き継ぎ書の「ツールを直す箇所」のとおり `tools/codiel_ab.py` を直す。
4. 短い試行を 1 本回し、引き継ぎ書の「未決のこと」の sbx に関わる項目を確かめる。試行の前に、トークンの見込みをユーザーに示して承認を得る。
5. ぶれの基準の 4 本を新しい `--out` で回す。`--before` と `--after` の両方に `6fe8dafa` を渡し、モデルは `sonnet,opus`、規模は標準とする。
6. `judge` と `report` を実行し、題を「<日付> ぶれの基準(標準)」にして台帳に残す。
7. `prompt-smith:skill-creator` の手順 8〜12 で、eval セット 20 問を作り、ユーザーの承認を得て、description を測って直す。
8. コミットを整理し、PR を作る。#15 を閉じ、Projects の status を Done にする。

## 制約

- 隔離環境ができるまで、run を回さない。
- `sbx run claude -- -p` を使わない。`sbx exec -i` で起動する。
- `sudo`・WSL の再起動・Docker のログイン・サンドボックス内の `/login` は、ユーザーに頼む。
- run は 1 本ずつ順に回す。題材 `~/codiel-cost-bench` を直接変えない。
- 隔離なしで採った `2026-11-18-baseline` の記録を、ぶれの基準に混ぜない。
- `SKILL.md` と `assets/*.md` は `prompt-smith:prompt-smith` の規律で書く。
- コミットはパスを指定して行う。`docs/chat/` の変更を混ぜない。
- #16〜#18 には着手しない。

## Done の条件

- `tools/codiel_ab.py` が sbx の中で run を回し、記録を取り出せる。
- ぶれの基準の 4 本が有効な run として完走し、結果が `assets/ledger.jsonl` にある。
- `.claude/skills/codiel-ab/evals/codiel-ab.json` があり、description が測定の最良のものになっている。
- `pnpm run lint`・`typecheck`・`test` が通る。
- PR が作られ、#15 の完了条件をすべて満たしている。
