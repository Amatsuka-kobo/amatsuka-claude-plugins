# metatron が「今後はこうして」の置き場を判定表で決め、案を示すスキルを持つ

Issue: #53(親 Story #49)

## 判定表は別の文書に置き、ARCHITECTURE と CLAUDE.md の行だけ境界の定義を参照する

判定表は新しい `references/instruction-placement.md` に置く。`references/document-boundary.md` には入れない。

- `document-boundary.md` は、`updating-architecture`・`capturing-architecture`・`architecture-format.md`・`writing-discipline.md` が「ARCHITECTURE か CLAUDE.md か」の 2 択として読んでいる。7 つの置き場の表を入れると、「置き場でない方から消す」の読みが崩れる。
- Issue #53 は「同じ文書にあるか、その定義を参照している」を求めている。判定表の ARCHITECTURE と CLAUDE.md の行は、`document-boundary.md` を参照し、基準を書き写さない。

## 判定表は文面の置き場を決め、強制の案は別に示す

### 文面の置き場

上から順に当て、最初に当たった行の置き場を採る。

| 順 | 内容の性質 | 置き場 |
| --- | --- | --- |
| 1 | 設定ファイルやコードの 1 か所から全部得られ、方針・使い分け・前提を何も加えていない | 書かない |
| 2 | 利用者 1 人だけの好みや環境の事情(応答の口調、手元の環境のパス) | memory |
| 3 | 成果物の決まり(`document-boundary.md` の ARCHITECTURE の側) | ARCHITECTURE |
| 4 | 特定のパスを触るときだけ要り、compaction の後に一時的に読まれなくなっても困らない決まり | `paths` 付きの rules |
| 5 | 作業の進め方の決まり(`document-boundary.md` の CLAUDE.md の側)。たまにしか行わない作業に付く決まりも含む | CLAUDE.md |
| 6 | ときどき行う作業の手順そのもの(ステップの列) | スキル |
| 7 | 上のどれにも当たらない事実や参照先(期限、外部のダッシュボードの場所) | memory |

- 1 行目は `writing-discipline.md` の「設定ファイルの写し」と同じ 2 条件にする。導けるだけでは「書かない」にしない。読まずに誤る内容は残す。
- 2 行目の memory は、worktree をまたいで共有される。`CLAUDE.local.md` は作った worktree にしか無いので、ユーザーが名指ししたときだけ置き場にする。
- 2 行目を 3 行目より先に置くので、「全員に当たるか」で上書きする規定は要らない。
- 4 行目の補足: `paths` 付きの rules は、compaction の後、該当するファイルに次に触れるまでコンテキストから消える。消えると困る決まりは rules に置かない。rules に残すなら `paths` を外す(毎セッション読まれる)か、5 行目の CLAUDE.md に置く。
- 5 行目と 6 行目の分け方: 「PR の本文に close を書く」のような手順に付く決まりは 5 行目の CLAUDE.md、「リリースの 8 つのステップ」のような手順の列そのものは 6 行目のスキルとする。

### 強制の案

文面の置き場とは別に、例外なく守らせる決まりかを判定する。当たるときは、文面の置き場に加えて強制の手段を案として示す。

| 決まりの形 | 強制の手段 |
| --- | --- |
| 特定のツールの呼び出しやパスへの書き込みを止める | hook または permissions の deny |
| 構造の決まり(import の方向など) | ARCHITECTURE の検査の定義(#52 で作る。それまでは hook か lint) |
| 完了の前に必ず行う検査 | Stop hook など |

- 強制の手段は文面を置き換えない。文面が無いと、AI は止められた理由と代わりの手段を知らない。
- hook や permissions の設定の手順は、このスキルでは書かない。案として示し、書き込みはセッションに任せる。

## スキル `placing-instructions` を新設する

置き場: `plugins/metatron/skills/placing-instructions/SKILL.md`

### 発火

- ユーザーが今後の振る舞いを残すよう頼み、置き場を名指ししていないとき(「今後はこうして」「覚えておいて」「ルールにして」「次から〜しないで」)。
- AI が自分で今後の振る舞いを残そうとしたとき(ユーザーの訂正を受けて memory に保存しようとしたときを含む)。
- 置き場を名指しした依頼(「ARCHITECTURE の禁止事項に足して」「CLAUDE.md に書いて」)は、このスキルではなく、その置き場を扱う手順が担う。

### 手順

1. 残す内容を、1 つの決まりまたは 1 つの事実ごとに分ける。
2. 1 件ずつ「文面の置き場」の表に上から当て、置き場・当たった行・理由を示す。強制の案に当たるときは併せて示す。
3. 置き場の案をユーザーに示し、承認を得る。AI が自分で残そうとした経路でも同じく承認を得る。
4. 承認された置き場ごとに次のとおり進める。
   - ARCHITECTURE: ARCHITECTURE があれば `updating-architecture` スキルを起動し、承認済みの依頼された変更として渡す。無ければ、初回生成(`capturing-architecture`)で作るかを尋ね、作らないと決まったら CLAUDE.md を代わりの置き場として示す。
   - それ以外: スキルは案を示して終え、書き込みはセッションに任せる。
5. 判定が memory でない内容は memory に保存しない。セッションの自動 memory の規則が保存を促していても、判定を優先する。

出力の形(例示であり、値は実際の内容に置き換える):

```
1. 「PR の本文に close #<番号> を書く」 → CLAUDE.md(5 行目: 作業の進め方の決まり)
2. 「plugins/*/scripts/ を手で編集しない」 → ARCHITECTURE の禁止事項(3 行目) / 強制の案: hook で Edit を止める
```

### 担わないこと

指示書の文面を書く規律、hook の設定の手順、codiel と gh-utility を除く他のプラグインの名前。指示層の規則に従う。

## SessionStart の案内に 1 行を加える

ARCHITECTURE の有無に関わらず、次の 1 行を案内文に加える。

「今後の振る舞いを残すとき(頼まれたときも、自分で memory などに残そうとするときも)は、書く前に Skill ツールで metatron:placing-instructions を起動し、置き場を決める。」

- 注入文は毎セッション読まれる。1 行に留め、判定表の中身は書かない。
- 順序を保証するのはこの 1 行とスキルの description の文面だけである。memory の保存は Write で行われ、スキルが選ばれない経路が残る。hook で memory への書き込みを止める案は、正当な保存まで止めるので採らない。

## evals

- `plugins/metatron/evals/placing-instructions.json` に 20 問を置く。`should_trigger: true` は 10 問、`false` は 10 問とする。
- true には、置き場を名指ししない残す依頼、AI の提案への回答(「ルールにしておいて」)、memory に保存しかけた訂正を入れる。
- false の near-miss は、置き場を名指しした ARCHITECTURE や CLAUDE.md の更新、CLAUDE.md の文面の推敲、hook の設定の依頼、memory の一覧を見る依頼、一回限りの作業指示とする。
- `updating-architecture.json` の true のうち、ARCHITECTURE を名指しした問は、新しいスキルの false の側と重ならない。
- 本来は eval セットの HTML でユーザーの承認を得てから保存する。ユーザーの不在中に進めるため、承認は PR のレビューで代え、description の改善ループは回さない。

## 変更するファイル

| ファイル | 変更 |
| --- | --- |
| `references/instruction-placement.md` | 新規。判定表と強制の案 |
| `skills/placing-instructions/SKILL.md` | 新規 |
| `evals/placing-instructions.json` | 新規 |
| `src/inject-context.ts`・`src/__test__/inject-context.test.ts` | 案内の 1 行 |
| `scripts/inject-context.mjs` | ビルドの差分(`src/` と同じコミット) |
| `hooks/hooks.json` | description に置き場の案内を加える |
| `README.md`(metatron・ルート) | スキルの説明と SessionStart の行 |
| `docs/format-change-checklist.md` | 判定表を変えたときと、`document-boundary.md` を変えたときに判定表を見直す項目 |

- SKILL.md と references は、編集の前に `prompt-smith:prompt-smith` を起動する。スキルの新設は `prompt-smith:skill-creator` に従う。
- `.serena/memories/metatron/core.md` の SessionStart の案内とスキルの数は、マージ後に main で更新する。
- バージョンは `0.6.4-dev` のまま据え置く。origin/main は `0.6.3-dev`、origin/dev は `0.6.4-dev` で、dev に main へ未反映の metatron のバージョンアップがある。Issue の「パッチバージョンを上げ」は CLAUDE.md の規則が優先する。

## PR のレビューで改めた点

- 判定表の 2 行目は成果物に現れないものに限り、どのリポジトリにも当てる好みはユーザー単位の CLAUDE.md に置く。「私の好み」と言われた PR やコミットの決まりが memory に落ちるのを防ぐ。
- スキル(手順の列)の行を CLAUDE.md(決まり)の行より先に置く。手順の列は作業の進め方でもあり、後に置くと CLAUDE.md で確定する。
- 事実や参照先は、リポジトリの全員が使うなら CLAUDE.md、1 人だけなら memory とする。
- ユーザーが置き場を名指しした件は表に当てない。memory に保存しない条件は、判定ではなく承認された置き場で決める。
- 否認された件と選び直された件の扱い、ARCHITECTURE の件を最後に回す順序、初版の作成後に `updating-architecture` へ渡す経路、既に memory にある内容を消す案を手順に加えた。
- 強制の案を当てる条件を「ユーザーが例外を認めないと述べた」「違反すると取り消せない損害が出る」とした。
- スキルが終わった後に自動 memory が同じ内容を保存する経路は、文面では塞げない限界として残る。

## 完了の条件

- `pnpm run lint`・`pnpm run typecheck`・`pnpm run test`・`pnpm run build` が通り、`scripts/` の差分が `src/` と同じコミットにある。
- 注入文に案内の 1 行(`metatron:placing-instructions` を含む行)が出ることを、ARCHITECTURE がある場合と無い場合の両方で確かめるテストがある。
