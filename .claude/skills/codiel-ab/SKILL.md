---
name: codiel-ab
description: codiel の指示書(skills・references・commands)や run の手順を変更したとき、改修前後の codiel で同じ題材の run を人なしで回し、コスト・run の進み方・成果物の質・指示への違反を表で比べるために必ず使用する。「codiel の前後比較して」「改修で run が悪くなってないか測って」「ぶれの基準を取り直して」などが該当する。トークンの集計だけ、他のプラグインの測定、run を 1 回動かすだけの確認には使わない。
---

# codiel の run の前後比較

改修前と改修後の codiel で同じ題材の run を自動で回し、4 項目(コスト・run の進み方・成果物の質・指示への違反)を比べる。

## 採取する

リポジトリのルートで実行する。次は例示であり、値は実際の内容に置き換える。

```bash
setsid nohup python3 tools/codiel_ab.py run \
  --before <変更前のコミット> --after <変更後のコミット> \
  --out ~/codiel-ab-out/<日付>-<題> \
  --answers .claude/skills/codiel-ab/assets/answers.json \
  --scale 標準 --models sonnet,opus --runs 1 \
  > ~/codiel-ab-out/<日付>-<題>.log 2>&1 < /dev/null &
```

- 採取の前に、run の本数(モデルの数 × 回数 × 2)と、1 本が数千万トークンを使うことをユーザーに示し、承認を得る。
- `--before` には指示書を変えた最初のコミットの親を、`--after` には最後のコミットを渡す。
- 変更をまだコミットしていないときは、`--after WORKTREE` を渡す。
- 変えたスキルが読まれる規模を `--scale` に渡す。`軽量` の run は discuss と design を通らない。
- モデルには Sonnet と上位モデルの両方を含める。
- run は 1 本ずつ順に回り、1 本に数時間かかる。セッションから切り離して起動し、ログの `end` の行で進み具合を確かめる。
- 新しい比較は、まだ無い `--out` で始める。`--out` はリポジトリの外の、再起動で消えない場所に置く。
- 途中で止まった採取は、同じ引数と同じ `--out` でもう一度実行する。終わった run は採り直されない。
- 題材は `<out>/work` の下へ複製されるので、元の題材のリポジトリは変わらない。

## 人への質問に代理で答える規則

run の中の質問には、`assets/answers.json` の規則が上から順に当たり、最初に当たった規則で答える。

- 規則の `when` は選択肢のラベルに当てる正規表現で、`pick` は選ぶラベルに当てる正規表現である。
- どの規則にも当たらない質問は、先頭の選択肢で答えたうえで「規則に無い質問」として表に出る。
- 「規則に無い質問」が出たら、その質問に当たる規則を `answers.json` に足す。足した後は、新しい `--out` で両方を採り直す。
- 規則を変えると前後の条件が変わるので、過去の台帳の値と比べない。
- Raguel の ASK は「このまま承認」、STOP は「妥当として止める」で答える。
- codiel の hook が確認を求めた操作は拒否され、「hook が確認を求めた操作」として数えられる。

## 質を判定する

採取が終わってから実行する。同じモデル・同じ回の前後の成果物を、どちらが改修後かを伏せて比べさせる。

```bash
python3 tools/codiel_ab.py judge --out <out> --prompt .claude/skills/codiel-ab/assets/judge.md --reps 2
```

- 判定は回ごとに左右を入れ替える。`--reps` は偶数にする。
- 判定の観点を変えるときは `assets/judge.md` を直す。直した後は、`<out>/judge` を消して判定し直す。

## 結果を読む

```bash
python3 tools/codiel_ab.py report --out <out> --contracts .claude/skills/codiel-ab/assets/contracts.json
```

- 「有効な run」が 0 の run は、複製した codiel を読んでいない。比較から外し、原因を直して採り直す。
- 「finalize まで完走」が 0 の run は、「run ごとの記録」の終わり方と止めた理由を読む。
- 終わり方が `idle`・`max-hours`・`max-replies` の run は、道具が打ち切った run である。`<out>/runs/<前後>/<モデル>-<回>/stream.jsonl` の末尾を読み、止まった場面を報告する。
- 前後の差は、台帳にある「ぶれの基準」の同じ指標の差と比べる。ぶれの基準の差を超えない差は、差があると判定しない。
- 「契約の違反」と「hook が確認を求めた操作」が改修後だけで増えたときは、「run ごとの記録」の内容を読み、削った規律との対応を報告する。
- 質の判定は、改修後の勝ちと改修前の勝ちの数を、ぶれの基準の同じ観点の数と比べる。

### 契約の検査を足す

`assets/contracts.json` は、指示書を変えても保つ書式を検査する。

- 改修で残すと決めた書式の契約を、検査として足す。
- `target` には `commits` か、`<out>/runs/<前後>/<モデル>-<回>/` からの glob を書く。
- `require` には全部が当たるべき正規表現を、`forbid` には当たってはならない正規表現を書く。
- `skip` に当たる対象は検査しない。
- 足した検査が改修前の run でも違反になるときは、検査の正規表現が誤っている。正規表現を直す。

## 台帳に残す

```bash
python3 tools/codiel_ab.py report --out <out> --contracts .claude/skills/codiel-ab/assets/contracts.json \
  --ledger .claude/skills/codiel-ab/assets/ledger.jsonl --title "<日付> <題>"
python3 tools/codiel_ab.py ledger --ledger .claude/skills/codiel-ab/assets/ledger.jsonl
```

- 報告の前に、比較の結果を台帳に残す。`--title` は同じ日の別の比較と区別できる題にする。
- 同じコミット同士を比べた結果は、題を「<日付> ぶれの基準(<規模>)」にして残す。
- codiel の手順・代理回答の規則・題材・モデルの解決先のどれかが変わった後は、ぶれの基準を採り直す。
- `ledger` が出す表は、過去の比較と同じ列で並ぶ。

## 報告する

報告には次を書く。

- 前後のコミット、規模、モデル、回数、打ち切った run の本数
- `report` が出した表。列を変えずに載せる
- ぶれの基準を超えた指標と、その前後の値
- 規則に無い質問、契約の違反、hook が確認を求めた操作の内容
- 質の判定の数と、判定の理由の実例を前後 1 つずつ
- 改修を採るか戻すかの判断に使える所見

## 台帳をコミットする

規則・検査・判定の観点を直すか、台帳に行を足したときは、報告の後に `assets/` をコミットする。
