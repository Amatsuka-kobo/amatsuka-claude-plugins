# metatron が「今後はこうして」の置き場を判定表で決め、案を示すスキルを持つ

Issue: #53(親 Story #49)

## 判定表は別の文書に置き、ARCHITECTURE と CLAUDE.md の行だけ境界の定義を参照する

判定表は新しい `references/instruction-placement.md` に置く。`references/document-boundary.md` には入れない。

- `document-boundary.md` は、`updating-architecture`・`capturing-architecture`・`architecture-format.md`・`writing-discipline.md` が「ARCHITECTURE か CLAUDE.md か」の 2 択として読んでいる。7 つの置き場の表を入れると、「置き場でない方から消す」の読みが崩れる。
- Issue #53 は「同じ文書にあるか、その定義を参照している」を求めている。判定表の ARCHITECTURE と CLAUDE.md の行は `document-boundary.md` を参照し、基準を書き写さない。

## 判定表は文面の置き場を決め、強制の案は別に示す

判定表の正本は `references/instruction-placement.md` である。要点は次のとおり。

| 順 | 内容の性質 | 置き場 |
| --- | --- | --- |
| 1 | 設定ファイルやコードの 1 か所から全部得られ、方針などを何も加えていない | 書かない |
| 2 | 利用者 1 人だけに当てる好みや環境の事情 | memory、全リポジトリならユーザー単位の `~/.claude/CLAUDE.md` |
| 3 | 成果物の決まり | ARCHITECTURE |
| 4 | 特定のパスを触るときだけ要り、compaction の後に読まれなくなっても困らない決まり | `paths` 付きの rules |
| 5 | ときどき行う作業の手順そのもの | スキル |
| 6 | 作業の進め方の決まりと、作業に使う参照先 | CLAUDE.md |
| 7 | 上のどれにも当たらない事実 | 全員が知るべきなら CLAUDE.md、1 人だけが使うか古くなるなら memory |

決めた理由:

- 1 行目は `writing-discipline.md` の「設定ファイルの写し」と同じ 2 条件にする。導けるだけでは書かないにしない。
- 2 行目は、本人だけに当てると述べた好みと、成果物に現れない好みに限る。「私の好み」と言われても、他の人も従うことになるコミットや PR の決まりは 3 行目以降に当てる。Issue の背景の事例(PR の出し方が memory に入った件)を防ぐためである。
- 2 行目を 3 行目より先に置くので、「全員に当たるか」で上書きする規定は要らない。
- memory は worktree をまたいで読まれる。`CLAUDE.local.md` は作った worktree にしか無いので、名指しされたときだけ置き場にする。
- 5 行目(手順の列)を 6 行目(決まり)より先に置く。手順の列は作業の順序でもあるので、後に置くと 6 行目で確定し、ときどき使う手順が毎セッション読まれる。
- 作業に使う参照先(ダッシュボードの場所など)は全員が使うので、`document-boundary.md` の作業の進め方に含めて CLAUDE.md に置く。期限のように古くなる事実は CLAUDE.md に置かない。
- `paths` 付きの rules は compaction の後に消えるので、消えると困る決まりは `paths` を外すか CLAUDE.md に置く。

強制の案は、ユーザーが例外を認めないと述べた決まりと、違反すると取り消せない損害が出る決まりに当てる。手段は hook・permissions の deny・lint などの検査・Stop hook とし、文面の置き場に加えて示す。文面を置き換えない。構造の決まりの手段は、#52 で ARCHITECTURE の検査の定義ができたら差し替える(チェックリストに項目を置く)。

## スキル `placing-instructions`

置き場: `plugins/metatron/skills/placing-instructions/SKILL.md`。手順の正本は SKILL.md である。

- 発火: 置き場を名指しせずに今後の振る舞いを残すよう頼まれたときと、AI が訂正を受けて自分で残そうとするとき。置き場の名前を挙げた依頼(「memory に保存して」「CLAUDE.md に書いて」)は発火の対象外とし、スキルの中でも表に当てない。「覚えておいて」「ルールにして」は置き場の名前ではない。
- 件ごとに判定し、置き場の案を示して承認を得る。否認された件は示し直すか残さないかを尋ね、ユーザーが選んだ置き場はそのまま採る。
- memory に保存してよいのは、承認された置き場が memory の件だけとする。判定から承認までの間と、残さないと決まった件も保存しない。
- 名指しの件は承認済みとして扱う。
- 既に memory にある内容の置き場が別に決まったときと、残さないと決まったときは、`MEMORY.md` の索引から項目を探し、その内容の部分だけを消す案を示して承認を得る。Issue の事例は保存した後の訂正だったので、予防だけでは足りない。
- ARCHITECTURE 以外の件の案を示し終えてから ARCHITECTURE の件に進む。ARCHITECTURE の件の memory は、書き込みが済んだ後に消し、書き込まれなかったときは残す。ARCHITECTURE があれば `updating-architecture` に承認済みの依頼された変更として渡す。無ければ初版を作るかを尋ね、作ったら同じ件を `updating-architecture` に渡す。作らないと決まったら CLAUDE.md を示し直す。
- ARCHITECTURE 以外の書き込みはセッションに任せる。指示書の文面の規律、hook の設定の手順、codiel と gh-utility を除く他のプラグインの名前は持たない。

## SessionStart の案内に 1 行を加える

ARCHITECTURE の有無に関わらず、次の 1 行を案内文に加える。

「今後の振る舞いを残すとき(置き場を指定されたときを除き、頼まれたときも、自分で memory などに残そうとするときも)は、書く前に Skill ツールで metatron:placing-instructions を起動し、置き場を決める。」

- 注入文は毎セッション読まれる。1 行に留め、判定表の中身は書かない。
- 順序を保証するのはこの 1 行とスキルの文面だけである。memory の保存は Write で行われ、スキルが選ばれない経路と、スキルが終わった後に自動 memory が同じ内容を保存する経路が残る。hook で memory への書き込みを止める案は、正当な保存まで止めるので採らない。

## `document-boundary.md` の変更

- 作業の進め方に「作業に使う参照先」を加える。判定表の 6 行目が参照するためである。
- 判定例の「TypeScript は strict を有効にする → ARCHITECTURE」を「ビルド出力は手で編集せず、`src/` を直して再生成する → ARCHITECTURE の禁止事項」に差し替える。strict は `tsconfig.json` の 1 項目から全部得られ、判定表の 1 行目(書かない)と食い違っていた。出力先だけの例もビルド定義の 1 項目から得られるので、方針を含む例にする。

## evals

- `plugins/metatron/evals/placing-instructions.json` に 20 問を置く(true 10・false 10)。
- true には、置き場を名指ししない残す依頼、AI の提案への回答、memory に保存しかけた訂正を入れる。
- false の near-miss は、置き場を名指しした更新(ARCHITECTURE・CLAUDE.md・memory)、CLAUDE.md の文面の推敲、hook の設定、memory の一覧を見る依頼、一回限りの作業指示とする。
- evals は発火だけを測る。どの行に当たるかの正しさは測らない。
- 本来は eval セットの HTML でユーザーの承認を得てから保存する。ユーザーの不在中に進めるため、承認は PR のレビューで代え、description の改善ループは回さない。

## 変更するファイル

| ファイル | 変更 |
| --- | --- |
| `references/instruction-placement.md` | 新規。判定表と強制の案 |
| `references/document-boundary.md` | 参照先の追加と判定例の差し替え |
| `skills/placing-instructions/SKILL.md` | 新規 |
| `evals/placing-instructions.json` | 新規 |
| `src/inject-context.ts`・`src/__test__/inject-context.test.ts` | 案内の 1 行 |
| `scripts/inject-context.mjs` | ビルドの差分(`src/` と同じコミット) |
| `hooks/hooks.json` | description に置き場の案内を加える |
| `README.md`(metatron・ルート) | スキルの説明と SessionStart の行 |
| `docs/format-change-checklist.md` | 判定表を変えたとき、境界を変えたとき、検査の定義ができたときの見直し |

- SKILL.md と references は、編集の前に `prompt-smith:prompt-smith` を起動する。スキルの新設は `prompt-smith:skill-creator` に従う。
- `.serena/memories/metatron/core.md` の SessionStart の案内とスキルの数は、マージ後に main で更新する。
- バージョンは `0.6.4-dev` のまま据え置く。origin/main は `0.6.3-dev`、origin/dev は `0.6.4-dev` で、dev に main へ未反映の metatron のバージョンアップがある。Issue の「パッチバージョンを上げ」は CLAUDE.md の規則が優先する。

## 完了の条件

- `pnpm run lint`・`pnpm run typecheck`・`pnpm run test`・`pnpm run build` が通り、`scripts/` の差分が `src/` と同じコミットにある。
- 注入文に案内の 1 行(`metatron:placing-instructions` を含む行)が出ることを、ARCHITECTURE がある場合と無い場合の両方で確かめるテストがある。
