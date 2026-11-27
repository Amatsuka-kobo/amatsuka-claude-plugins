---
name: placing-instructions
description: 今後の振る舞いを残すとき、書く前に置き場(CLAUDE.md・paths 付きの rules・スキル・hook・memory・ARCHITECTURE)を判定して案を示すために必ず使用する。「今後はこうして」「覚えておいて」「ルールにして」「次から〜しないで」のように置き場を指定せずに頼まれたときと、ユーザーの訂正を受けて自分で memory などに残そうとするときが該当する。ARCHITECTURE や CLAUDE.md を名指しした更新、文面の推敲、hook の設定そのものの依頼には使わない。
---

# 指示の置き場の判定

残す内容の置き場を決め、案を示す。ARCHITECTURE に当たる内容だけを書き込みまで進め、それ以外の書き込みはセッションに任せる。

## 手順

1. 残す内容を、1 つの決まりまたは 1 つの事実ごとに分ける。
2. 1 件ずつ `../../references/instruction-placement.md` の「文面の置き場」に上から当てる。ARCHITECTURE と CLAUDE.md の区別は `../../references/document-boundary.md` に従う。
3. 例外なく守らせる決まりには、「強制の案」も当てる。
4. 置き場の案をユーザーに示し、承認を得る。自分で残そうとした内容も同じく承認を得る。
5. 承認された置き場ごとに進める。
   - ARCHITECTURE: ARCHITECTURE があれば `updating-architecture` スキルを起動し、承認済みの依頼された変更として渡す。
   - ARCHITECTURE が無いとき: `capturing-architecture` スキルで初版を作るかを尋ねる。作らないと決まったら、CLAUDE.md を代わりの置き場として示し直す。
   - それ以外: 案を示して終える。書き込みはセッションに任せる。
6. 判定が memory でない内容は、memory に保存しない。自動 memory の規則が保存を促していても、この判定を優先する。

## 提示の形

1 件を 1 行で示す。次は例示であり、値は実際の内容に置き換える。

```
1. 「PR の本文に close #<番号> を書く」 → CLAUDE.md(5 行目: 作業の進め方の決まり)
2. 「plugins/*/scripts/ を手で編集しない」 → ARCHITECTURE(3 行目: 成果物の決まり) / 強制の案: hook で Edit を止める
3. 「応答は結論から書く」 → memory(2 行目: 利用者 1 人の好み)
```

- 当たった行の番号と性質を添える。
- 強制の案に当たるときは、同じ行に併記する。

## 担わないこと

- 指示書の文面を書く規律と、hook や permissions の設定の手順は扱わない。案として示した後、書き込みはセッションに任せる。
