# metatron init による GOTCHAS 台帳の生成 設計書

- 作成日: 2026-09-15
- 対象プラグイン: `plugins/metatron`(主)、`plugins/codiel`(従)
- 現行バージョン: metatron `0.2.0-dev` → `0.3.0-dev`、codiel `0.6.0-dev` → `0.7.0-dev`(§6.9)
- 状態: 設計(**第 3 版**。レビュー 2 件の全指摘を反映し、U2 のユーザー回答を反映)
- 入力: `.claude/context-maps/2026-09-15-metatron-init-gotchas.md`
- 対の実装計画書: `harness-docs/plans/2026-09-15-metatron-init-gotchas-plan.md`
- 関連: `harness-docs/design/2026-08-16-metatron-design.md`(§7-6 承認の要否 / §9-1 初回生成フロー / §10-4 Codiel 連携 / §12-2 状況別の挙動。本設計が §10-4 と §9-1 と §12-2 の一部を上書きする)
- 凍結契約(`harness-docs/design/2026-08-16-file-contract-freeze.md`)の扱い: **§7-3 は改訂不要。§12 は改訂必須**(§6.7。ユーザー確認 U1)

### 第 3 版の変更点(第 2 版からの差分)

| # | 変更 | 節 |
| --- | --- | --- |
| 1 | **U2 がユーザー回答により確定。** `install-harness.sh` L5 は「文面を修正する」ではなく**行ごと削除する**。ユーザー確認の待ち事項ではなくなった | §6.12、§7.12、§12-2 O6 |
| 2 | 削除範囲を一次確認し、L5 が単独の独立したコメント行であることを確定 | §6.12 (1) |
| 3 | codiel の `scripts/` に残る他の GOTCHAS 言及(`lib.mjs` / `guard-write.mjs`)を調査し、**削除対象外**と判定 | §6.12 (2) |
| 4 | `protected-paths.md` の「`plugins/*/scripts/` = バンドル出力」の綻びの扱いを決め、**T17 への統合を採用** | §6.12 (3)、§7.13 |
| 5 | **U1 は (a)(b)(c) すべてユーザー承認済み。** 凍結契約へ適用する | §12-1 |

### 第 2 版の変更点(第 1 版からの差分)

| # | 変更 | 節 |
| --- | --- | --- |
| 1 | 凍結契約 §12(サブコマンド表・ロック表)の改訂が**必須**であることを追加。第 1 版は §7-3 だけを見て「§7 は改訂不要」と結論していた | §6.7、§12-1 U1 |
| 2 | `exists` による承認スキップを `hasContent` による判定へ改めた。空ファイルで init がスキップするのに注入は「無い」側に倒れる矛盾を解消 | §6.1、§6.3、§7.3 |
| 3 | 「staging の保護はゼロ」「`already_exists` が `file_changed` を完全包含」を撤回。空ファイル競合の窓が残ることを明記し、リスクとして受容 | §6.2、§10 リスク 8 |
| 4 | §1.4 の「init 未実施時の挙動は現行のまま」を、codiel 経路では偽であるため書き分けた | §1.4 |
| 5 | 「記録できないとき」のレポートパスを実レイアウト(`.codiel/runs/<runId>/try-<n>/reports/`)へ修正 | §6.4、§7.10 |
| 6 | 追随対象に metatron `commands/init.md`、`.claude/rules/metatron/protected-paths.md`、`README.md` L59、`capturing-architecture/SKILL.md` の description とタイトルを追加 | §7.13、§7.8 |
| 7 | HARD-GATE L160(diff 全文提示)が GOTCHAS 承認を詰まらせる問題への書き分けを追加 | §7.8 (9) |
| 8 | codiel `recording-gotchas` の手順 2(読み取り)と手順 6(`git add`)の分岐を追加 | §6.6、§7.10 |
| 9 | 出典誤り 5 件を修正(C-1〜C-5) | §4.2、§6.1、§6.2、§6.8、§7.6 |

---

## 1. 上書きする決定

本設計は、既存の設計書で確定した決定のうち次を**明示的に上書きする**。既存の設計書そのものは編集しない。上書きの記録はこの節が正本である(`2026-09-09-agent-policy-subagent-discipline-removal-design.md` §1 と同じ運用)。

### 1.1 `2026-08-16-metatron-design.md` §10-4(L1779-1782)

原文(L1779-1782):

> **`docs/GOTCHAS.md` が存在しない場合**: 単体環境では Codiel が台帳ごと新規作成する
> (現行は `/codiel:init` を案内していたが、記録の契機は失敗発生時であり、
> そこで「初期化してください」と止めるのは学習機会の損失になる)。
> 併用環境では `append-gotcha` が台帳ごと作る。

| 箇所 | 元の決定 | 本設計の決定 | 根拠 |
| --- | --- | --- | --- |
| L1779-1780 | 単体環境では Codiel が台帳ごと新規作成する | **Codiel は台帳を作らない。** 記録できないときは §6.4 の縮退に従う | §6.4 |
| L1782 | 併用環境では `append-gotcha` が台帳ごと作る | **通常は `/metatron:init` が承認を得て作る。** `append-gotcha` の自動生成は**フォールバックとして残す**(削らない) | §6.2 / §6.5 |
| L1754-1760(三分岐の表) | 「併用・案内あり」「併用・案内が失われた」「単体環境」の 3 状態すべてで直接追記により成立させる | **三分岐を廃止し 2 状態にする。** CLI の案内があれば CLI、無ければ §6.4 の縮退へ倒す | §6.4 / §11.4 |

### 1.2 同設計書 §9-1(L1454)

| 箇所 | 元の記述 | 本設計の決定 |
| --- | --- | --- |
| L1454 | 「6. GOTCHAS の台帳を初期化(空でよい。append-gotcha が必要時に作る)」 | 括弧書きの限定を外す。init フローの手順として**実際に台帳を生成する**。ただし生成は stage/commit の 2 段階ではなく `init-gotchas` の 1 回で行う(§6.2) |

### 1.3 同設計書 §12-2(L1955)

| 箇所 | 元の記述 | 本設計の決定 |
| --- | --- | --- |
| L1955 | 「GOTCHAS が存在しない \| 注入: ARCHITECTURE だけを注入。`append-gotcha` が台帳ごと作る」 | 前段(注入の挙動)は不変。後段は「通常は `/metatron:init` が作る。init を経ずに記録が発生したときは `append-gotcha` が台帳ごと作る」へ読み替える |

### 1.4 「学習機会の損失」の論拠との関係(依頼文の設計事項 5)

L1780-1781 の論拠は「**記録の契機は失敗発生時であり、そこで『初期化してください』と止めるのは学習機会の損失になる**」である。

**(a) 論拠そのものとは衝突しない。** この論拠が禁じているのは「**台帳が無いことを理由に記録を止めること**」であって、「**あらかじめ台帳を作っておくこと**」ではない。両者は排他ではなく、後者は前者を強める。反転しているのは「**既定の生成主体はどちらか**」の 1 点である。

- 本設計は `append-gotcha` の自動生成フォールバック(`gotchas.ts` L616-620)を**一切変更しない**。
- 逆に、現行のままだと**台帳はユーザーの承認なしに、失敗が起きた瞬間に、run の途中で生まれる**。metatron が管理する 5 ファイル(ARCHITECTURE・rules 3 本・GOTCHAS)のうち、GOTCHAS だけが「いつの間にか hook の保護下に入り、毎セッション注入の対象になっている」状態になる。どのファイルを metatron の管理下に置くかの同意を取る場所は init であり、失敗発生時ではない。
- 併せて、台帳が存在すると `get gotchas` が `not_created`(`get.ts` L289-306)ではなく `entries: []` を返す。「台帳はあるがまだ空である」と「台帳が無い」は、次に触るエージェントにとって別の事実である。

**(b) ただし「挙動は現行のまま」ではない。** metatron の CLI 経路(`append-gotcha`)の挙動は不変だが、**codiel 経路の挙動は変わる**。決定 3(直接追記の削除)の帰結であり、(a) とは別の話として書き分ける。

| 状況 | 現行(`2026-08-16-metatron-design.md` L1754-1760) | 本設計 |
| --- | --- | --- |
| 併用・CLI の案内あり | CLI で追記 | **不変。** CLI で追記 |
| 併用・案内が失われた | 直接追記 → deny → 拒否メッセージの CLI で再実行 | **変わる。** 台帳へ即時入らず §6.4 の持ち越しになる |
| 単体環境(metatron 非導入) | 直接追記(hook が無いので通る) | **変わる。** 台帳は生まれず §6.4 の持ち越しになる |

**いずれの場合も run は止めない。** 失われるのは即時性であって記録そのものではない(§6.4)。この帰結は §10 のリスク 3・4 で受容する。

**この §1.4 の本文を、そのまま `capturing-architecture/SKILL.md` へは書かない。** スキル本文には規律だけを置き、根拠はこの設計書に残す(規約「スキル本文には規律だけを書く」)。

---

## 2. 背景と目的

`/metatron:init` は ARCHITECTURE の 6 セクションと rules の 3 ファイルを生成するが、GOTCHAS の台帳を生成しない。`capturing-architecture/SKILL.md` L154 が「GOTCHAS の台帳は初回生成では作らない。最初のエントリを記録するときに `append-gotcha` が台帳ごと作る。」と明文で定めている。一方 SessionStart の注入(`inject-context.ts` L110)は「このプロジェクトにはまだ ARCHITECTURE も GOTCHAS も無い。**`/metatron:init` で作成する。**」と読める文面を出す。

ユーザーは「init が台帳を生成する」へ設計を反転させることを承認済みである。本設計はその反転を、CLI・指示層・参照層・凍結契約・codiel 側の整合まで含めて確定させる。

**目的**: `/metatron:init` の承認フローの中で GOTCHAS の台帳を生成できるようにし、同時に codiel 側に残る「GOTCHAS を直接追記する」経路を廃止して、台帳への書き込み主体を metatron の CLI 1 本に揃える。

---

## 3. 確定済みの要件(オーケストレーター確定。本設計はこれを前提とし、覆さない)

1. 実装方式は**案 i(metatron CLI に新サブコマンドを追加)**で確定。案 ii(スキルが Write で雛形を書く)と案 iii(`append-gotcha` にエントリ無しモードを追加)は採らない。
2. GOTCHAS の生成を `/metatron:init` の**承認フローに載せる**。
3. codiel 側の **GOTCHAS 直接追記フォールバックを削除**する。
4. `plugins/codiel/CLAUDE.example.md` L25-27 の三分岐も削除する。ただし**削るのは GOTCHAS に関する部分だけ**とし、ARCHITECTURE に関する記述は今回変更しない(判断材料は §6.10)。
5. **O1 = 網羅検査テストを含める。O2 = codiel はマイナー。O3 = ARCHITECTURE 側の非対称は本改修で扱わない。O4 / O5 は §12 の既定どおり。**
6. **U1 のユーザー確認は、オーケストレーターがメインセッションでユーザーへ直接問う。** 実装者が自分で問うステップにしない。
7. **U2 は確定済み**(ユーザー回答)。`plugins/codiel/scripts/install-harness.sh` L5 の GOTCHAS への言及は、**文面を直すのではなく行ごと削除する**(§6.12)。

---

## 4. 前提(実測。2026-09-15 時点の working tree)

### 4.1 生成の材料は既に純関数として存在する

| 対象 | 位置 | 事実 |
| --- | --- | --- |
| 雛形本文 | `plugins/metatron/src/lib/gotchas.ts` L530-555 `TEMPLATE_LINES` | 補間も `scan` 由来の値も含まない。4 節構成。**プロジェクト間で不変の定型文** |
| 雛形の描画 | 同 L558-560 `renderGotchasTemplate()` | `TEMPLATE_LINES.join("\n")` を返すだけの純関数 |
| 追記時の自動生成 | 同 L607-664 `buildAppendedText()`(L616-620) | `existing === null` または空白のみなら雛形から作る。**本設計はここを変更しない** |
| 書き込みの型 | 同 L887-918 `appendGotcha()` | `withFileLock`(L809)→ `mkdirSync` → `writeFileSync`。staging を使わない直接書き込み |

`gotchas.ts` の冒頭コメント L11-12 は「ファイルへの書き込み経路は `appendGotcha` / `tagGotcha` の 2 つしか無く、『削除・改変禁止』が指示ではなく構造として成立する」と宣言している。**この不変条件は本設計でも維持する**(§6.3 の `already_exists` 拒否がその手段である)。

### 4.2 案 ii が成立しない理由(再確認済み)

`plugins/metatron/hooks/hooks.json` L17 の matcher が `Edit|Write|NotebookEdit`、`src/guard-docs.ts` L220 / L236 / L245 が GOTCHAS パスと厳密一致で `deny` する。dangling symlink を辿るため**ファイル未作成でも拒否される**。テストが固定している: `src/__test__/guard-docs.test.ts` L179(D6)、**L216-243(D7b。deny 判定の引用としては L230-239。L241-242 は素通しの対比アサーション)**。

### 4.3 GOTCHAS 側に stage 相当の下地は無い

- `architecture.ts` L857 `prepareArchitectureUpdate` / `rules.ts` L131 `prepareRulesUpdate` に相当する「diff を返すが書かない」純関数が `gotchas.ts` に存在しない。
- `StagingKind`(`src/lib/staging.ts` L33)は 3 値。`isStagingKind`(L219)がリテラル比較で書かれ、`parseRecord`(L276、判定は L280)がそれを使う。
- `commit.ts` の `runCommit` は `acceptedKinds`(L37 / L69 / L135 / L144)で受け入れる kind を絞る。

### 4.4 CLI の構造

| 箇所 | 内容 |
| --- | --- |
| `src/cli/main.ts` L31 | `READ_SUBCOMMANDS = new Set(["get", "scan", "diff-architecture"])` |
| 同 L33-41 | `WRITE_SUBCOMMANDS`(7 個) |
| 同 L54-56 | `main(argv, cwd: string = process.cwd())`。**`--cwd` フラグは存在しない**(`args.ts` L18-50 の `parseArgs` にも `BOOLEAN_FLAGS` にも無い)。`src/metatron-cli.ts` は `main(process.argv.slice(2))` を呼ぶだけで cwd を渡さない。**したがって対象文書は常に「実行時のカレントディレクトリから解決した docRoot」で決まる**(§4.9 / §10 リスク 9) |
| `src/cli/paths.ts` L36-63 | `INPUT_SCHEMAS`。`tag-gotcha`(L59-62)は `--input` を取らないが `usage` キーで載っている(**先例**) |
| 同 L65-88 | `USAGE_LINES` |
| `src/cli/get.ts` L441-448 | `GET_TARGETS`(6 個)。L474-478 の `unknown_target` がこの配列を案内に使う |
| 同 L115-125 | `get config` の `cli` オブジェクト。7 つのコマンド行を持つ。**`init-gotchas` / `gotchas-template` は無い** |
| 同 L128 | `inputSchemas: INPUT_SCHEMAS`。`INPUT_SCHEMAS` へ足せば `get config` の出力には自動で載る |
| `src/cli/gotcha.ts` L1-4 | 冒頭コメント「どちらも承認を要さない追記操作である(設計書 §7-6)」 |
| `src/cli/output.ts` | `emitResult` / `emitReadFailure` / `emitWriteFailure`(既定 exit 1)/ `EXIT_USAGE = 2` |
| `plugins/metatron/build.ts` | entryPoints は 3 本。**新規ファイルを足しても変更は要らない** |

### 4.5 承認フローの 2 レイヤー構造

| レイヤー | 粒度 | 現状 |
| --- | --- | --- |
| ドラフト単位 | 起草と対話確認の粒度 | **9 単位**(L59-71 の表) |
| 承認対象 | stage と承認と commit の粒度 | **4 対象**(L96-98) |

HARD-GATE は L158-167。**L159**(承認なしに commit しない)/ **L160**(diff を全文提示せずに承認を求めない)/ **L161**(4 対象を 1 回の承認でまとめない)/ **L162**(`diff.truncated` が true のまま承認を求めない)。

**「4 対象」の語は 2 箇所にあり、意味が違う。**

| 箇所 | 意味 | 本設計での扱い |
| --- | --- | --- |
| L96「4 対象分の stage をまとめて先に発行しない」 | **stage を発行する対象の数**。GOTCHAS は stage を持たない | **4 のまま残す** |
| L161「4 対象を 1 回の承認でまとめない」 | **承認を得る対象の数**。GOTCHAS を含む | **5 へ変える** |

### 4.6 雛形固定を承認フローに載せる前例と、その限界

rules の 3 単位は `scan` の解析結果に依らず `docs/RULES.example.md` の固定テンプレートを既定ドラフトとして提示する(SKILL.md L73)。それでも stage → diff 全文提示 → 個別承認 → commit を通る。

**ただし前例は半分しか効かない。** `RULES.example.md` L3 は「内容は自分のプロジェクトの実態に置き換える」と書き、ユーザーの指摘はそのまま `body` に反映されて書き込まれる。対して GOTCHAS の `TEMPLATE_LINES` は不変の定型文であり、書き換えを促す文言も、書き換えを受け取る入力経路も無い。この差が §6.1 の判断を要求する。

### 4.7 凍結契約 §7-3(改訂不要と判定した箇所)

`harness-docs/design/2026-08-16-file-contract-freeze.md` §7-3 は L448-454。L453-454 の原文:

> - 台帳または `## 失敗パターン一覧` 節が無ければ、雛形ごと作成する
>   (冒頭説明・運用ルール・記入テンプレート・空の一覧節を含む)。

この 2 行は `### 7-3. 挿入位置と採番` の配下にあり、**挿入操作(= `append-gotcha`)の規約**として書かれている。

### 4.8 凍結契約 §12(改訂が必須になる箇所)

同文書 §12 は **L676-751**。本改修で**偽になる**のは次の 2 箇所である。

| 箇所 | 現状 | なぜ偽になるか |
| --- | --- | --- |
| **L683-698 のサブコマンド網羅表** | 15 行。`get config` 〜 `tag-gotcha`。`get rules` は L689、`append-gotcha` は L697 | `init-gotchas` も `get gotchas-template` も無い。表は網羅を意図しており(`cli.test.ts` L1 がこのテスト群を「契約 §12 の検証」と自己定義している)、サブコマンドが増えれば偽になる |
| **L746-749 のロック表** | L748 は `` `<gotchas パス>.lock` `` を取るのが `append-gotcha` / `tag-gotcha` の 2 つだけと明記 | `initGotchasLedger` は `withFileLock`(`gotchas.ts` L809)を使うため、3 つ目の取得者が生まれる |

**L18**: 「本書の内容を変更する必要が生じたときは、実装を止めてユーザーに確認する。」 → §6.7 / U1 へ接続する。

なお **L711-714 の「staging の保証」は 4 点**であり、`references/cli-usage.md` L148-154 の 5 点とは粒度が違う(cli-usage 側が `tampered` と `staging_unavailable` を足している)。§6.2 の表はこのうち**凍結契約 §12 L711-714 の 4 点**を出典として使う。

### 4.9 承認要否の出典は凍結契約ではなく設計書である

`2026-08-16-metatron-design.md` §7-6(L1239-1249)の表が `append-gotcha` / `tag-gotcha` を「承認不要」とし、理由を L1244 で述べる。凍結契約 §7-6(L494-500)は「記録の判断」であり承認には触れない。したがって**承認を課すこと自体は凍結契約の変更を要しない**(変更が要るのは §12 の網羅表とロック表であって、承認の規約ではない)。

### 4.10 `exists` の意味(空ファイルの扱い)

| 実装 | 空ファイル(0 バイト)/ 空白のみのファイルの扱い |
| --- | --- |
| `src/cli/input.ts` の `readDocument`(L95-114) | `readFileSync` が成功すれば **`exists: true`**。中身は見ない |
| `src/cli/get.ts` L99-103(`get config` の `gotchas.exists`) | 同上。`readDocument` の結果をそのまま返す |
| `src/lib/gotchas.ts` L617(`buildAppendedText`) | `trim() === ""` を「内容なし」として雛形から作り直す |
| `src/inject-context.ts` L153-162(`readGotchas`) | `trim() === ""` なら **`null`**(= 台帳が無い側へ倒れる) |

**`exists` と「内容がある」は一致しない。** この差を無視すると §6.1 の承認スキップ条件が注入の挙動と食い違う(第 1 版の誤り)。§6.3 / §7.3 で `hasContent` を導入して揃える。

### 4.11 変えない前提

- `append-gotcha` の自動生成フォールバック(`gotchas.ts` L616-620)。
- `get gotchas` の `not_created` 応答(`get.ts` L289-306)。文面だけ §7.9 で直す。
- `tag-gotcha` が台帳未存在で `not_found` を返す非対称。
- 読み取り系は常に exit 0、書き込み系は拒否・失敗で非 0、という 2 層のフェイル方針。
- `READ_SUBCOMMANDS`(`gotchas-template` は `get` の**対象**であってサブコマンドではない)。
- `src/inject-context.ts`(§6.11)と `build.ts` の entryPoints。

---

## 5. 全体像

```
/metatron:init
  └─ capturing-architecture スキル
       1. 現状確認          get config(architecture / rules 3 / gotchas の exists を見る)★gotchas を追加
       2. 事実の収集        scan
       3. ドラフトの起草    9 単位(変更なし。GOTCHAS は起草しない)
       4. 対話ウォークスルー 9 単位(変更なし)
       5. stage             stage-architecture 1 回・stage-rules 3 回(★stage 対象は 4 のまま)
       6. 提示と承認        ★承認 4 回 → 5 回(ARCHITECTURE 1・rules 3・GOTCHAS 1)
            └ GOTCHAS の提示材料は get gotchas-template(読・常に exit 0)で得る ★新設
       7. 書き込み          commit-architecture 1 回・commit-rules 3 回
                            ★+ init-gotchas 1 回(stage を経ない 1 回の書き込み)
       8. 完了報告          ★台帳のパスを報告に含める
```

| サブコマンド | 層 | 役割 |
| --- | --- | --- |
| `get gotchas-template` | 読(常に exit 0) | 書き込まずに、雛形の全文・解決先パス・`exists` と `hasContent` を返す。**承認の材料** |
| `init-gotchas` | 書(拒否は非 0) | 雛形だけの台帳を新規作成する。**内容のある台帳があるときは拒否する**(`already_exists`) |

---

## 6. 設計判断

### 6.1 決定: 承認で提示するもの・同意を求めるもの(依頼文の設計事項 1)

**結論。ユーザーに求める同意は「この台帳を、この絶対パスに、作ってよいか」の可否 1 点とする。提示するのは (a) 解決された絶対パスと docRoot 相対パス、(b) 雛形の全文、(c) 作成後に生じる 2 つの帰結、の 3 つとする。同時に「本文はこの場では書き換えられない」ことを明示する。**

| # | 提示するもの | 出どころ | なぜ要るか |
| --- | --- | --- | --- |
| a | 台帳の絶対パスと docRoot 相対パス | `get gotchas-template` の `path` / `relative` | **ここだけが実質的に決まる余地のある値である。** `metatron.config.json` の `paths.gotchas` と docRoot 解決の結果で決まる。**一般の既定値は `docs/GOTCHAS.md`**(凍結契約 L509)だが、**本リポジトリ自身は `metatron.config.json` L4 で `harness-docs/GOTCHAS.md` に上書きしている**。どこに作られるかは環境ごとに違うため、必ず実測値を見せる。docRoot と起動ディレクトリがずれている環境では `get config` が警告を返す(`get.ts` L76-81。テスト S10) |
| b | 雛形の全文 | 同 `template` | 「何を書き込むのか見せずに承認を求めない」という規律を GOTCHAS でも破らないため |
| c | 作成後の帰結 2 つ | スキル本文の固定文 | ① 直接編集が PreToolUse hook に拒否されるようになる、② SessionStart の注入対象に入る。この 2 つは**このファイルを作ることで新たに課される制約**であり、同意の対象そのものである |

**明示すること。** 雛形の本文は書式契約で固定されており、`init-gotchas` は本文を入力に取らない。本文の変更要望が出たときは、その場で書き換えず、**台帳の作成を保留して書式契約の変更として扱う**。この一文が無いと、提示された全文に対する指摘を受けた AI が、書き換えた本文を Write で書こうとして hook に拒否される(§4.2)無駄な往復が起きる。

**スキップの条件は `exists` ではなく `hasContent` とする。**

| `get gotchas-template` の戻り | スキルの挙動 |
| --- | --- |
| `hasContent: true` | 提示も承認も行わない。既存の台帳がある旨を報告し、`init-gotchas` を実行しない |
| `hasContent: false`(ファイルが無い、または空・空白のみ) | 提示 → 承認 → `init-gotchas` を実行する |

`exists` で分岐すると、**空の `GOTCHAS.md` を持つプロジェクトで init が「既にある」とスキップする一方、注入は `readGotchas`(`inject-context.ts` L153-162)が `trim() === ""` で `null` を返すため「台帳が無い」側に倒れ続ける**(§4.10)。CLI は呼べば直せるのにスキルが呼ばせない、という状態になる。`hasContent` で揃えればこの矛盾は起きない。

**rules の前例との関係(§4.6 の限界への回答)。** rules は「書き換えを受け取る」ので提示が指摘の受け皿として機能する。GOTCHAS は受け皿を持たないので、提示は**通知**として機能し、承認は**可否**として機能する。同じ「提示 → 承認」の形を取りながら意味が違うことを、スキル本文で言い分ける。

### 6.2 決定: 二段構えにせず、一発生成にする(依頼文の設計事項 2)

**結論。`stage-gotchas` / `commit-gotchas` の二段構えは採らない。`get gotchas-template`(読)で材料を取り、承認を得てから `init-gotchas`(書)を 1 回実行する。**

凍結契約 §12 L711-714 が定める staging の保証 4 点を、1 つずつ当てる。

| # | 凍結契約 §12 の保証(L711-714) | GOTCHAS の雛形生成に効くか |
| --- | --- | --- |
| 1 | diff を計算せずに書き込むことはできない | **効かない。** before は「存在しない(または空)」、after は固定文字列。diff は雛形の全文そのものであり、`get gotchas-template` で同じものが得られる |
| 2 | staging は単回使用かつ有効期限つき(既定 30 分) | **ほぼ効かない。** 単回使用と期限は「古い案が遅れて適用される」事故を防ぐが、案が 1 つしか存在しない。ただし「承認トークンが無い」こと自体は保証の差であり、ゼロではない(下記) |
| 3 | stage 後に対象ファイルが変化していたら commit は失敗する(`file_changed`) | **部分的に効く。** §6.3 の `already_exists` が大半を代替するが、**完全には包含しない**(下記) |
| 4 | `commit-*` は対応する kind の staging だけを受ける(`staging_kind_mismatch`) | **効かない。** kind が 1 つしかない |

**#3 が完全には包含されないこと(第 1 版の誤りの訂正)。** `already_exists` が拒否するのは「**内容のある**ファイル」だけである(§6.3)。`get gotchas-template` と `init-gotchas` の間に**空・空白のみのファイルが現れた**場合、staging なら `baseHash: null` → ファイル出現の差で `file_changed` になり**止まる**が、`init-gotchas` は雛形で**上書きして進む**。したがって「保護はゼロ」「完全包含」は誤りであり、**空ファイル競合の窓が残る**。

**それでも一発生成を採る理由。** この窓で失われるデータは無い。上書きされるのは空・空白のみのファイルであり、エントリを 1 件も含まない。失われるのは「止まって知らせる」という振る舞いだけである。一方でコストは実在する。

- `StagingKind`(`staging.ts` L33)への `"gotchas"` 追加 → `isStagingKind`(L219)→ `parseRecord`(L280)への波及。
- `gotchas.ts` への `prepare` 相当の新設(§4.3)。入力を取らない prepare は「常に同じ値を返す関数」であり、存在自体が不自然になる。
- `commit.ts` の `acceptedKinds` 拡張または `runCommitGotchas` の新設と、そのすべてのテスト。

この窓は §10 のリスク 8 として明示し、受容する。

**#2 について。** 一発生成には承認トークンが無いため、`init-gotchas` は理屈のうえでは何度でも呼べる。ただし実効は冪等である —— 内容があれば `already_exists` で拒否され、空・空白なら同一の雛形が書かれる。

**一貫性の観点はどう扱うか。** 「他の単位と同じく二段にする」という一貫性の要請は、形式(stage → commit)ではなく**規律(書き込む内容を全文提示して承認を得てから書く)**の側で満たす。この規律は §6.1 の提示要件と HARD-GATE の追加(§7.8 (9))で保たれる。

なお、**「差分を計算せずに書き込む経路が CLI 全体に存在しない」わけではない。** `references/cli-usage.md` L150 の主語は `commit-architecture` / `commit-rules` の 2 つであり、`append-gotcha` は既に staging 無しで書き込んでいる(`gotchas.ts` L887-918)。`init-gotchas` は `append-gotcha` と同じ層に属する 3 本目であって、新しい例外ではない。

### 6.3 決定: `init-gotchas` は内容のある台帳を上書きしない

**結論。`withFileLock` の下で対象ファイルを読み、内容があれば `already_exists` を返して非 0 終了する。書き込みは行わない。**

これは本設計で最も重要な不変条件である。`init-gotchas` は固定文字列を書くので、素朴に実装すると**既存の全エントリを消す**。`gotchas.ts` L11-12 が宣言する「削除・改変禁止が構造として成立する」性質を、3 本目の書き込み経路を足すことで壊してはならない。

判定は `buildAppendedText`(L617)の意味論に揃える。

| 対象ファイルの状態 | `exists` | `hasContent` | `init-gotchas` の挙動 |
| --- | --- | --- | --- |
| 存在しない | `false` | `false` | 雛形を書いて `ok: true, created: true` |
| 存在するが空、または空白のみ | `true` | `false` | 雛形を書いて `ok: true, created: true` |
| 内容がある(節が壊れていても) | `true` | `true` | **`already_exists` で非 0 終了。1 バイトも書かない** |

`already_exists` のメッセージには、既存の台帳のパスと「エントリの追記は `append-gotcha`」の案内を載せる。

### 6.4 決定: 「記録できないとき」の規定(依頼文の設計事項 4)

**結論。run を止めない。記録を黙って捨てもしない。エントリ本文を run のレポートと完了報告に残し、「次にこの台帳へ追記する手段」をユーザーへ案内する。**

決定 3 によって、codiel 側には「CLI の案内がコンテキストに無い」状態で記録の契機が起きる経路が残る(§1.4 (b) の 2 行目と 3 行目)。現行はこれを「直接追記」で吸収し、併用環境では deny hook の拒否メッセージから CLI パスを回収していた。直接追記を削ると回収経路も消える。**代替の probe は置かない**(インストール検出とパス推測の禁止は維持する。§6.6)。

規定は次のとおりとする。

- **記録の契機が起きたら、エントリは必ず組み立てる。** CLI の可否を先に見て、組み立て自体を省略しない。
- **CLI の案内があるときは `append-gotcha` で追記する。** 台帳が無ければ `append-gotcha` が台帳ごと作る。
- **CLI の案内が無いときは、台帳への追記を行わない。** 直接編集を試みない。代わりに次の 2 箇所へ同じエントリ本文を残す。
  - run のレポート。**アクティブな run があれば `.codiel/runs/<runId>/try-<n>/reports/`、無ければ `.codiel/reports/`**(`plugins/codiel/docs/DESIGN.md` L160-171 の実レイアウト)。いずれも `.codiel/` 配下であり、`guard-write.ts` L135-136 の免除(`codielRel.startsWith(".codiel/")`)に入るため、`domain` 設定中でも `ask` にならない。
  - ユーザーへの完了報告の本文。
- **報告には「この記録はまだ台帳に入っていない」ことと、入れる手段を明記する。**
- **run は止めない。** 記録手段の不在は、実装・テスト・PR の成否と無関係である。

**パスは `.codiel/` 配下でなければならない。** ルート直下の `runs/<runId>/reports/` は免除の対象外であり(`guard-write.ts` L135-136 は `codielRel` の前方一致で判定する)、`domain` 設定中のコードフェーズでは `ask` に倒れる。`ask` は人間の応答を待つため、「run を止めない」という本規定の目的と衝突する。

この規定は「記録の契機で止めない」という §1.4 (a) の論拠と同じ向きを向いている。失われるのは即時性であって記録そのものではない。次のセッションでは注入が再び届くため、**記録できない状態は恒久ではなく持ち越しである**。

### 6.5 決定: サブコマンド名(依頼文の設計事項 3)

既存の命名規則は `<動詞>-<対象>` であり、対象の単複が粒度を表している。

| 既存 | 対象 | 単複 |
| --- | --- | --- |
| `append-gotcha` / `tag-gotcha` | エントリ 1 件 | 単数 |
| `get gotchas` | 台帳(エントリの集合) | 複数 |

新設する操作の対象は**エントリではなく台帳**である。したがって複数形を採る。

| 採用 | 理由 |
| --- | --- |
| **`init-gotchas`**(書) | 動詞 `init` が `/metatron:init` と対応し、この操作が init フローのものであることが名前で分かる |
| **`get gotchas-template`**(読) | `GET_TARGETS`(`get.ts` L441-448)の 7 種目としてハイフン付きの複合名を足す。フラグ案を採らない理由は §11.3 |

### 6.6 決定: codiel 側で残す規律と削る規律

| `plugins/codiel/skills/recording-gotchas/SKILL.md` の箇所 | 扱い |
| --- | --- |
| L43(手順 2。台帳のパスを解決し既存エントリを読む) | **書き換え。** 台帳が無いときに読むものが無いことを明記する。**パス解決は codiel 自身の `scripts/lib.mjs`(L14-16)で行っており metatron の CLI を使わないので、この手順は CLI の有無に依らず動く**(§14 の訂正 2 を参照) |
| L47(手順 6。台帳を `git add` してコミット) | **書き換え。** 台帳へ書けたときだけ `git add` する。書けなかったときはレポートを対象にする |
| L51-52(案内が無ければ直接追記 / 拒否されたら CLI で再実行) | **削除**し、CLI 経由のみへ書き換える |
| L54 第 1 文「metatron のインストール有無を検出しない。」 | **削除**(三分岐を支えるための宣言であり、分岐が消えれば不要) |
| L54 第 2-3 文(パスを推測しない / 使ってよいパスは案内と拒否メッセージのものだけ) | **残す**。パス推測の禁止は分岐と独立に必要 |
| L56-60(三分岐の表) | **削除**し、2 状態へ差し替える |
| L66(直接追記するときは書式を同じにする) | **書き換え** |
| L64-95(エントリの書式・タグ) | **残す**。`append-gotcha` の入力と §6.4 の報告の両方で使う |
| L97-125(「台帳が無いとき」節と雛形本文) | **節ごと削除**。雛形の写しを codiel から無くす |
| L140 / L141(Red Flags 2 行) | **書き換えて残す** |

雛形の写しを削除することで、`docs/format-change-checklist.md` L25 の追随先(「codiel: `skills/recording-gotchas/SKILL.md` の書式の写し」)は**エントリ書式の写しだけ**に縮む。この行自体も §7.13 で追随させる。

### 6.7 決定: 凍結契約は §7-3 が改訂不要、§12 が改訂必須(依頼文の設計事項 7)

**結論。§7-3 の改訂は要らない。しかし §12 の改訂は必須である。ユーザー確認(U1)の範囲を §12 まで広げる。**

#### (1) §7-3 —— 改訂不要(第 1 版の判定を維持する)

§4.7 のとおり、L453-454 は `### 7-3. 挿入位置と採番` の配下にあり、**挿入操作の規約**である。

- 「`append-gotcha` **だけ**が作る」とは書かれていないため、生成主体が増えても §7-3 と矛盾しない。
- codiel が「雛形ごと作成する」操作をやめることも §7-3 に反しない。§7-3 は挿入を行う実装に対する規約であり、**挿入を行わない実装**を縛らない。

**明確化の追記(任意)。** §7-3 の末尾へ 1 行を足すと誤読を防げる。規則を変えず経路を明記するだけであり、採否はユーザー確認に委ねる。

> - 台帳の新規作成は `/metatron:init`(`init-gotchas`)と、台帳が無い状態での挿入(`append-gotcha`)の 2 経路で起きる。いずれも同じ雛形を書く。内容のある台帳に対する新規作成は拒否する。

#### (2) §12 —— 改訂必須(第 1 版の見落とし)

§4.8 のとおり、§12 の 2 つの表が**本改修で偽になる**。§12 は「CLI の入出力規約」そのものであり、`cli.test.ts` L1 がテスト群を「契約 §12 の検証」と自己定義している以上、表と実装の乖離は契約の破れである。

**改訂案(必須)。**

**(a) サブコマンド網羅表(L683-698)へ 2 行を足す。**

L689(`get rules`)の直後へ:

```
| `get gotchas-template` | 読 |
```

L697(`append-gotcha`)の直前へ:

```
| `init-gotchas` | 書 |
```

**(b) ロック表(L746-749)の L748 を差し替える。**

変更前:

```
| `<gotchas パス>.lock` | `append-gotcha` / `tag-gotcha` |
```

変更後:

```
| `<gotchas パス>.lock` | `init-gotchas` / `append-gotcha` / `tag-gotcha` |
```

**(c) §12 の「staging の保証」(L709-714)は変更しない。** `init-gotchas` は staging を使わないため、4 点の主張は現状のまま真である。

L18 が「本書の内容を変更する必要が生じたときは、実装を止めてユーザーに確認する」と定めているため、**(a) と (b) は必須だがユーザー確認を経てから適用する**。確認が得られない場合は本改修を完了させられない(§12-1 U1 の既定値の扱いを参照)。

### 6.8 決定: ADR を起票する(依頼文の設計事項 6)

**結論。ADR-002 として起票する。**

起票の閾値は `references/architecture-format.md` L94-97(ADR 一覧節の**書き方**を定めた箇所であり、閾値ではない)ではなく、**凍結契約 §6-3(L387-395)の 3 条件**である。「**3 つすべてを満たすものだけ**を ADR にする。」

| # | 条件(凍結契約 L391-393) | 本件の該当 |
| --- | --- | --- |
| 1 | **覆すコストが大きい。** 後から変えると複数コンポーネントに波及する、またはデータ移行を伴う | **満たす。** CLI の公開インターフェース 2 本と、codiel 側の雛形削除・配布物(`CLAUDE.example.md`)の変更に波及する。覆すには 2 プラグインと凍結契約 §12 を戻す必要がある |
| 2 | **選択肢が実在した。** 比較した代替を具体的に挙げられる | **満たす。** 案 i / 案 ii / 案 iii / 現状維持、および二段構え / 一発生成 |
| 3 | **理由が自明でない。** コードや設定を読んだだけでは「なぜそうしたか」が分からない | **満たす。** 「なぜ init が作るのか」「なぜ二段構えでないのか」「なぜ codiel が直接追記をやめたのか」は実装から読み取れない |

起票内容:

| 項目 | 内容 |
| --- | --- |
| タイトル | `[metatron] GOTCHAS の台帳は init が承認を得て生成する` |
| 状態 | 採用 |
| 決定日 | 実装日 |
| 背景 | init が ARCHITECTURE と rules を作る一方 GOTCHAS を作らず、台帳は失敗記録の副作用として承認なしに生まれていた。SessionStart の注入文(`inject-context.ts` L110)とも食い違っていた |
| 選択肢 | ① init が新サブコマンドで生成する(採用) ② スキルが Write で雛形を書く(deny hook が拒否するため不成立) ③ `append-gotcha` にエントリ無しモードを足す(同一サブコマンドが承認要と不要の両方を持ち、設計書 §7-6 と衝突) ④ 現状維持(注入文と実装の食い違いが残る) |
| 結論 | ① を採用。`init-gotchas`(書)と `get gotchas-template`(読)を新設し、init の**承認**対象を 4 から 5 へ増やす(**stage** 対象は 4 のまま)。staging の 2 段階は用いない |
| 根拠 | 雛形は固定文字列で既存とのマージが無く、staging の保証 4 点(凍結契約 §12 L711-714)のうち実効があるのは `file_changed` のみで、それも `already_exists` が大半を代替する。残る空ファイル競合の窓はデータ損失を伴わないため受容する。`append-gotcha` の自動生成フォールバックは残し、失敗発生時に止まらない性質を維持する |
| 影響 | codiel は GOTCHAS の直接追記と雛形の写しを失う。CLI の案内が無い環境では記録を run のレポートへ持ち越す。凍結契約 §12 の 2 表を改訂する(§7-3 は不変) |

ADR の追加は ARCHITECTURE の直接編集ではなく `stage-adr` → `commit-architecture` で行う(`references/architecture-format.md` L96)。現在 ADR-001 のみなので CLI が ADR-002 を採番する。

### 6.9 決定: バージョン

| プラグイン | 現行 | 新 | 理由 |
| --- | --- | --- | --- |
| metatron | `0.2.0-dev` | `0.3.0-dev` | CLI に 2 サブコマンドを追加し、init の承認フローを変える。`src/` / 指示層 / 参照層 / README の広範囲に及ぶためマイナー |
| codiel | `0.6.0-dev` | `0.7.0-dev` | **O2 で確定。** 文書化された振る舞いの廃止と、対象プロジェクトへ配布される `CLAUDE.example.md` の変更を含む |

`plugin.json` と `package.json` を同じ値で揃える。`.serena/memories/codiel/core.md` L1 は現在 `0.5.2-dev` と**既に実体(0.6.0-dev)から遅れている**ため、併せて `0.7.0-dev` へ直す(§7.13)。

### 6.10 判断材料: `CLAUDE.example.md` の ARCHITECTURE 側をどうするか(O3 により今回は変更しない)

L25-27 は ARCHITECTURE と GOTCHAS の両方を 1 つの規則で束ねている。要件 §3-4 により、今回削るのは GOTCHAS に関する部分だけである。結果として**非対称が生まれる**。

改修後の状態: ARCHITECTURE は「案内があれば CLI、無ければ直接編集、拒否されたら再実行」(現状維持)、GOTCHAS は「CLI 経由のみ」。

**非対称を許容してよい理由。**

1. 直接編集が失敗したときの損失が違う。ARCHITECTURE の更新は「後で直せる記述の更新」だが、GOTCHAS の直接追記は**採番の衝突と既存エントリの破壊**を招きうる。
2. ARCHITECTURE には codiel 自身の実装が読む機械可読ブロックがあり、codiel が単体環境で最小 ARCHITECTURE を自前生成する経路が現に存在する(`initializing-harness/SKILL.md` L70-98)。GOTCHAS にはその種の自前生成経路がもう無い。
3. 配布される雛形は規則を減らすほど配布先の挙動が読みやすくなる。両方を一度に変えると効果測定が難しい。

**将来 ARCHITECTURE 側も揃えるときの論点。** 単体環境では ARCHITECTURE の直接編集を止める代替手段が無い。**O3 により、この判断は別件(ドメインマップ移管)と一緒に扱う。**

**規則 2(L34-37)の扱い —— 今回は変更しない。** L34-37 は「失敗したら recording-gotchas の基準に従い GOTCHAS に追記する」と書き、CLI 専用化の後も「追記」と読める。

- **変更しない理由**: 「追記する」は結果の記述であって手段の記述ではない。手段は同じ規則が名指しする `recording-gotchas` スキルが持ち、そのスキルは §7.10 で CLI 専用に書き換わる。規則 2 は「既存エントリの削除・改変はしない」という不変条件も併せ持っており、そこは改修後も真である。
- **将来変えるときの案**: 「`recording-gotchas` スキルの手段に従って GOTCHAS へ記録する(台帳へ入らないときは同スキルの持ち越し手順に従う)」。今回は入れない。判断を残すに留める。

### 6.11 決定: `inject-context.ts` は変更しない

- L110-112 の `buildInitGuide` は「このプロジェクトにはまだ ARCHITECTURE も GOTCHAS も無い。**`/metatron:init` で作成する。**」と書く。本改修によりこの文は**事実に追いつく**。
- L78-91 の `cliLines` はセッション中の操作を並べる。台帳の生成は init フローの 1 回限りの操作であり、`buildInitGuide` が既に `/metatron:init` を名指ししている。
- この案内は**注入予算の超過時にも決して削らない**ブロックである。行を増やすと削れない部分が恒久的に太る。
- 変更しないことで `src/__test__/inject-context.test.ts` L23-66 の全文一致も無変更で済む。

代わりに `guard-docs.ts` の `gotchasReason`(L174-183)へ 1 行足す(§7.5)。予算制約が無く、かつ「GOTCHAS を Write しようとした AI」という最適な相手に届く。

### 6.12 決定: `install-harness.sh` の GOTCHAS 言及は行ごと削除する(U2 の確定)

**結論。`plugins/codiel/scripts/install-harness.sh` L5 を削除する。文面の修正はしない。**

ユーザーの回答(原文): 「GOTCHAS を Codiel の領分から完全に移行するため、そもそもそのコメントが不要に感じます。」

**理由。** GOTCHAS が metatron の領分へ完全移行するため、codiel のインストールスクリプトが GOTCHAS に言及する必要そのものが無くなる。「なぜ配置しないか」を説明する必要があるのは、**配置する候補として検討される場合だけ**であり、管轄外の資産についてはその前提が成立しない。第 2 版の案(主語を metatron へ差し替える)は、言及を残す以上「codiel は GOTCHAS の配置を検討したうえで見送っている」という読みを温存してしまう。

#### (1) 削除範囲(一次確認済み)

`install-harness.sh` は全 13 行で、L2-L6 がコメントブロックである。

| 行 | 内容 | 扱い |
| --- | --- | --- |
| L1 | `#!/usr/bin/env bash` | 不変 |
| L2 | スクリプトの目的(`.codiel/` ディレクトリを配置する) | 不変 |
| L3-4 | 「ARCHITECTURE / CLAUDE.md / raguel.config.yaml は initializing-harness スキル(`/codiel:init`)が生成するため、このスクリプトでは扱わない。」(**2 行にまたがる 1 文**) | 不変 |
| **L5** | 「GOTCHAS は失敗を記録する時点で recording-gotchas スキルが台帳ごと作成するため、ここでは配置しない。」 | **削除** |
| L6 | 使い方 | 不変 |
| L7-13 | `set -euo pipefail` 以降の本体 | 不変 |

- **L5 は 1 行で完結した独立の文である。** L3-4 の文とは別の文であり、前後に継続関係が無い(L3-4 は「ARCHITECTURE / CLAUDE.md / raguel.config.yaml」を主語とし、L5 は「GOTCHAS」を主語とする別の文)。
- **コメント行なので構文に影響しない。** 削除後も L7 の `set -euo pipefail` 以降は不変であり、スクリプトの意味も変わらない。
- 削除後のコメントブロックは「目的 → 扱わないもの(3 点)→ 使い方」の 3 段に整い、**GOTCHAS という語がファイルから消える**。

#### (2) codiel の `scripts/` に残る他の GOTCHAS 言及 —— 削除しない

調査の結果、`plugins/codiel/scripts/` 配下の GOTCHAS 言及は次の 3 ファイルにある。

| ファイル | 該当 | 扱い |
| --- | --- | --- |
| `install-harness.sh` L5 | 台帳の**生成主体**を説明する散文コメント | **削除**(上記) |
| `lib.mjs` L44 / L185-189 / L293 | `DEFAULT_GOTCHAS_PATH = "docs/GOTCHAS.md"` と `resolveDocPaths` の `gotchas` キー | **削除しない** |
| `guard-write.mjs` L105 / L246-250 | 同上(`lib.ts` を bundle した結果として inline されたもの) | **削除しない** |

**`lib.mjs` / `guard-write.mjs` を削除しない理由は 3 つある。**

1. **性質が違う。** これらは台帳の**生成**ではなく**パス解決**である。ファイル契約 §3 のルート解決と `paths.gotchas` の適用を codiel が独立実装している部分であり(`plugins/codiel/src/hooks/lib.ts`)、「GOTCHAS がどこにあるか」を知る機能である。領分の移管は「誰が作るか」を変えるのであって、「どこにあるかを知ってよいか」を変えない。
2. **現に使われている。** codiel の `recording-gotchas/SKILL.md` L14-16 は `resolveDocPaths(process.cwd()).gotchas` で台帳のパスを解決する。この経路は本改修後も残る(§7.10 (a) の手順 2)。削除すると台帳のパスを知る手段が消え、`append-gotcha` に渡す対象も既存エントリの読み取り先も分からなくなる。
3. **バンドル出力である。** `guard-write.mjs` と `lib.mjs` は `plugins/codiel/build.ts` の entryPoints(`guard-write` / `lib`)から生成される。手で編集してはならず、変えるなら `src/hooks/lib.ts` を変えて再生成する必要がある。本改修は `plugins/codiel/src/` を変更しない。

したがって**削除するのは `install-harness.sh` L5 の 1 行だけ**である。

#### (3) `protected-paths.md` の綻びの扱い —— T17 へ統合する

U2 の背景にあった綻びは、削除方針でも残る。**削除もまた `plugins/*/scripts/` への手編集だからである。**

- `.claude/rules/metatron/protected-paths.md` の「触らないパス」は `plugins/*/scripts/` と `plugins/*/dist/` を「バンドル出力。対応する `src/` を変更し、`pnpm run build` で再生成する」と定める。
- **`install-harness.sh` はバンドル出力ではない**(一次確認済み)。`plugins/codiel/build.ts` の entryPoints は `guard-bash` / `guard-write` / `stop-guard` / `subagent-stop` / `codiel-state` / `lib` の 6 つで、`install-harness` は無い。`.sh` は esbuild の出力形式でもない。参照しているのは `src/__test__/install-harness.test.ts` だけであり、それはこのスクリプトを**実行して検証する**テストであって生成元ではない。
- したがって規則の文言(「`plugins/*/scripts/` はすべてバンドル出力」)が事実と合っていない。このまま放置すると、**本改修の実装者が「保護パスだから触れない」と判断して削除を見送る**か、規則を破った自覚のないまま編集することになる。

**決定: T17(`protected-paths.md` の更新)へ統合する。** 統合が成立する理由は次のとおり。

- 変更対象は**同じ 1 ファイル**(`.claude/rules/metatron/protected-paths.md`)である。
- `stage-rules` の入力は `{ name, body, reason }` で、**`body` はファイル全文**である(`references/cli-usage.md` L92-103)。1 回の staging が扱えるのは 1 ファイルだが、**そのファイル内の変更箇所数に制限は無い**。したがって「GOTCHAS の更新手段に `init-gotchas` を足す」(本改修に必須)と「`plugins/*/scripts/` の例外を明記する」(U2 が露呈させた綻び)は、**1 回の `stage-rules` → `commit-rules` で同時に直せる**。
- 分けると、同じファイルに対して stage → 承認 → commit を 2 周することになり、diff の提示も 2 回になる。得るものが無い。

**追記案**(「触らないパス」の `plugins/*/scripts/` の項へ 1 文):

> - `plugins/*/scripts/` と `plugins/*/dist/` — バンドル出力。対応する `src/` を変更し、`pnpm run build` で再生成する。**例外は `plugins/codiel/scripts/install-harness.sh` で、これは手書きのシェルスクリプトであり `src/` の対応物を持たない。直接編集してよい。**

**この追記の採否は O6 とする**(§12-2)。本改修に必須なのは L7 の GOTCHAS の更新手段だけであり、例外の明記は U2 が露呈させた隣接する綻びの解消である。`protected-paths.md` の更新は `commit-rules` の前に diff 全文提示と承認を経るため、いずれにせよユーザーの目に触れる。

**不採用案: `install-harness.sh` を `scripts/` の外へ移す。** 規則を変えずに実体を規則へ合わせる案だが、テストのパス(`src/__test__/install-harness.test.ts` L8-10)と、このスクリプトを呼ぶ `initializing-harness` スキルの記述の両方を追随させる必要がある。本改修と無関係な移動であり、範囲が広がる。採らない。

---

## 7. 各変更の詳細

### 7.1 `plugins/metatron/src/lib/gotchas.ts` —— 台帳生成の関数を足す

冒頭コメント L11-12 を書き換える。

変更前:

```
// CLI・hook・テストがこのファイルだけを窓口にする。ファイルへの書き込み経路は
// appendGotcha / tagGotcha の 2 つしか無く、「削除・改変禁止」が指示ではなく構造として成立する。
```

変更後:

```
// CLI・hook・テストがこのファイルだけを窓口にする。ファイルへの書き込み経路は
// initGotchasLedger / appendGotcha / tagGotcha の 3 つしか無く、「削除・改変禁止」が
// 指示ではなく構造として成立する。initGotchasLedger は内容のある台帳を必ず拒否するため、
// 既存エントリを消しうる経路は 3 つのどれにも無い。
```

`GotchaErrorCode`(L24-28)へ `"already_exists"` を足す。`appendGotcha`(L887)の直前へ新設する。

```ts
export interface InitGotchasResult {
  path: string
  created: boolean
  bytesWritten: number
}

/**
 * 雛形だけの台帳を新規作成する(設計書 2026-09-15 §6.2・§6.3)。
 *
 * 内容のある台帳があるときは `already_exists` を投げ、1 バイトも書かない。
 * 固定文字列を書くサブコマンドなので、この拒否がエントリ保護の唯一の担保である。
 * 空白のみのファイルを「内容なし」と扱うのは buildAppendedText と同じ判定である。
 */
export function initGotchasLedger(gotchasPath: string): InitGotchasResult {
  return withFileLock(gotchasPath, () => {
    const existing = readTextIfExists(gotchasPath)
    if (existing !== null && existing.trim() !== "") {
      throw new GotchaError(
        "already_exists",
        `${gotchasPath} は既に存在します。既存の台帳を上書きしません。エントリの追記は append-gotcha を使ってください。`
      )
    }
    const text = renderGotchasTemplate()
    fs.mkdirSync(path.dirname(gotchasPath), { recursive: true })
    fs.writeFileSync(gotchasPath, text)
    return {
      path: gotchasPath,
      created: true,
      bytesWritten: Buffer.byteLength(text)
    }
  })
}
```

`readTextIfExists` は同モジュール内の非公開関数(`appendGotcha` L904 が使用)であり、そのまま使える。新たに export しない。

### 7.2 `plugins/metatron/src/cli/gotcha.ts` —— `runInitGotchas` を足す

冒頭コメント L1-4 を書き換える。

変更後:

```
// `init-gotchas` / `append-gotcha` / `tag-gotcha`(契約 §6・§11・§12、設計書 §7-4)。
//
// append-gotcha と tag-gotcha は承認を要さない追記操作である(設計書 §7-6)。
// init-gotchas は台帳そのものを作る操作であり、**承認を得てから呼ぶ**
// (設計書 2026-09-15 §6.1。CLI は承認の有無を判定できないため、規律は
// capturing-architecture/SKILL.md の HARD-GATE が持つ)。
// いずれも拒否は非 0 終了で返し、そのとき対象ファイルには 1 バイトも書き込まない。
```

関数本体(`runAppendGotcha` L48 の直前へ置く)。

```ts
export function runInitGotchas(ctx: GotchaContext): void {
  const command = "init-gotchas"
  const config = loadConfig(ctx.cwd)
  try {
    const result = initGotchasLedger(config.gotchasPath)
    noteWarnings(config.warnings)
    emitResult(command, {
      ok: true,
      written: true,
      created: result.created,
      path: result.path,
      relative: config.gotchasRelative,
      bytesWritten: result.bytesWritten,
      warnings: config.warnings
    })
  } catch (error) {
    failFromError(command, error, {
      written: false,
      path: config.gotchasPath
    })
  }
}
```

`failFromError`(L29-42)が `GotchaError.code` をそのまま `error` に載せるため、`already_exists` と `lock_timeout` はどちらも exit 1 で返る。入力を取らないため `loadInputJson` は呼ばない。

### 7.3 `plugins/metatron/src/cli/get.ts` —— `get gotchas-template` を足す

**(a) `GET_TARGETS`(L441-448)へ `"gotchas-template"` を足す。** `unknown_target` の案内(L474-478)がこの配列を使うため、足さないと新対象が案内に載らない。

**(b) `runGet` の switch(L450-)へ case を足す。**

**(c) ハンドラを新設する。** 読み取り層なので**常に exit 0**。

```ts
export function runGetGotchasTemplate(ctx: GetContext): void {
  const command = "get gotchas-template"
  const config = configOf(ctx.cwd)
  const file = readDocument(config.gotchasPath)
  const hasContent = file.exists && file.text.trim() !== ""
  const warnings = [...config.warnings, ...file.warnings]
  noteWarnings(warnings)
  emitResult(command, {
    ok: true,
    path: config.gotchasPath,
    relative: config.gotchasRelative,
    exists: file.exists,
    hasContent,
    template: renderGotchasTemplate(),
    next: hasContent ? null : commandLine("init-gotchas"),
    warnings
  })
}
```

- **`exists` と `hasContent` を両方返す。** `exists` は `readDocument` の意味(ファイルが読めたか)のままにして `get config` L99-103 と揃え、スキルの分岐は `hasContent` で行う(§4.10 / §6.1)。
- `ok` は常に `true`。台帳の有無は読み取り層にとって異常ではない。
- `next` は `hasContent` が `true` のとき `null`。

**(d) `get config` の `cli` オブジェクト(L115-125)へ 2 行を足す。**

```ts
      initGotchas: commandLine("init-gotchas"),
      getGotchasTemplate: commandLine("get gotchas-template"),
```

`inputSchemas`(L128)は `INPUT_SCHEMAS` をそのまま載せるため、§7.5 で `INPUT_SCHEMAS` に `init-gotchas` を足せば自動で反映される。しかし `cli` オブジェクトは**手で列挙している**ため、足さないと `get config` から新サブコマンドのコマンド行が取れない。

### 7.4 `plugins/metatron/src/cli/main.ts` —— 層の宣言とディスパッチ

| 箇所 | 変更 |
| --- | --- |
| L5-9 の冒頭コメント | 書き込み経路の列挙へ `init-gotchas` を足す |
| L18 の import | `runInitGotchas` を `./gotcha.js` から足す |
| L33-41 `WRITE_SUBCOMMANDS` | `"init-gotchas"` を足す(7 → 8 個) |
| L87-121 の switch | `case "init-gotchas": runInitGotchas(ctx); return` を `case "append-gotcha"` の直前へ置く |

`READ_SUBCOMMANDS`(L31)は変更しない。

### 7.5 `plugins/metatron/src/cli/paths.ts` と `src/guard-docs.ts` —— 案内の追随

`INPUT_SCHEMAS`(L36-63)へ `init-gotchas` を足す(`tag-gotcha` L59-62 の先例に従う)。

```ts
  "init-gotchas": {
    usage: "init-gotchas",
    note: "入力を取らない。雛形だけの台帳を新規作成する。内容のある台帳があるときは already_exists で拒否する。実行の前にユーザーの承認を得ること。"
  },
```

`USAGE_LINES`(L65-88)。読み取りの節(L72 の `get gotchas` の次)へ `get gotchas-template`、書き込みの節(L86 の `append-gotcha` の直前)へ `init-gotchas`。

`src/guard-docs.ts` の `gotchasReason`(L174-183)。`append-gotcha` の案内行(L178)の直後へ 2 行を挿入する。

```ts
    "台帳がまだ無いときは、ユーザーの承認を得てから新規作成してください:",
    `  node ${cli} init-gotchas`,
```

存在判定はしない。この関数は hook から呼ばれ、hook はフェイルオープンであるため、案内の分岐のために I/O を増やさない。

### 7.6 `plugins/metatron/references/cli-usage.md` —— 正本の追随

この文書を「CLI の呼び出しの正本」として参照するのは **metatron の 2 スキル**である(`capturing-architecture/SKILL.md` L16、`recording-gotchas/SKILL.md` L16)。**codiel の `recording-gotchas/SKILL.md` は参照しない** —— 同ファイル L14-16 は codiel 自身の `scripts/lib.mjs` の `resolveDocPaths` を `node -e` で呼ぶ形であり、metatron の参照層に依存しない。

1. サブコマンド表(L11-27)へ 2 行。`get gotchas` の次に `get gotchas-template`(読)、`append-gotcha` の前に `init-gotchas`(書)。
2. 「書き込み系の入力 JSON」(L48-117)へ `### init-gotchas` を新設する(`### append-gotcha` L105 の直前)。

```markdown
### init-gotchas

入力 JSON を持たない。オプションも取らない。

- 書き込む内容は雛形で固定されており、変更できない。
- 内容のある台帳があるときは `already_exists` で拒否され、対象ファイルは変化しない。
- 空・空白のみのファイルは「内容なし」として扱い、雛形で作り直す。
- **実行の前にユーザーの承認を得る。** CLI は承認の有無を判定できない。提示する材料は `get gotchas-template` で取る。
```

3. 「stage から commit の 2 段階」(L119-)へ 1 行。

```markdown
GOTCHAS の台帳の新規作成(`init-gotchas`)とエントリの追記(`append-gotcha`)は 2 段階を取らない。前者は書き込む内容が雛形に固定されており差分が定数であるため、後者は既存を壊さない追記であるためである。
```

### 7.7 `plugins/metatron/references/gotchas-format.md` L14 —— 主語の是正

変更後:

> - 台帳は `/metatron:init` が `init-gotchas` で作る。内容のある台帳があるとき `init-gotchas` は拒否し、既存を上書きしない。
> - init を経ずに追記が起きたときは、台帳または `## 失敗パターン一覧` 節が無ければ `append-gotcha` が雛形ごと作る。
> - いずれの場合も自前でファイルを作らない。雛形の本文を写して持たない。

### 7.8 `plugins/metatron/skills/capturing-architecture/SKILL.md` —— 承認フローへの組み込み

変更は 10 箇所。

**(1) 手順の一覧(L31-38)。**

```
- [ ] 5. stage(`stage-architecture` 1 回・`stage-rules` 3 回)
- [ ] 6. 提示と承認(合計 5 回。ARCHITECTURE 1・rules 3・GOTCHAS 1)
- [ ] 7. 書き込み(`commit-architecture` 1 回・`commit-rules` 3 回・`init-gotchas` 1 回)
```

**(2) 手順 1 現状確認(L42)。**

```
- `get config` で ARCHITECTURE の解決先パスと存在の有無、`rules.dir` と 3 ファイルそれぞれの `exists`、GOTCHAS の解決先パスと `exists` を確認する。
```

**(3) 手順 1 の終了判定(L48)。**

```
- 対象の 9 単位(下記)がすべて埋まっており、かつ GOTCHAS の台帳に内容があるときは初回生成ではない。`/metatron:update` を案内して終了する。
- 9 単位が埋まっていて GOTCHAS の台帳だけが無い(または空である)ときは、手順 2 から 5 を飛ばし、手順 6 と 7 の GOTCHAS の分だけを行う。
```

**(4) ドラフト単位の表(L59-71)は変更しない。** 9 単位のままとする。表の直後へ 1 行を足す。

```
- GOTCHAS の台帳はこの 9 単位に含めない。起草するものが無いため、手順 6 で承認対象として扱う。
```

**(5) 手順 5(L95-96)。** stage の対象が 4 つのままであることを明示する。**L96 の「4 対象」は残す。**

```
- stage を要する対象は 4 つ(ARCHITECTURE 1・rules 3)である。GOTCHAS は stage を持たない。
- stage を要する対象 1 つにつき、stage → 手順 6 の承認 → 手順 7 の commit を回す。4 対象分の stage をまとめて先に発行しない。
```

**(6) 手順 6(L132)。**

```
- 承認は対象ごとに得る。ARCHITECTURE 1 回と rules 3 回と GOTCHAS 1 回で合計 5 回になる。
```

節の末尾へ新設する小節:

```markdown
### GOTCHAS の台帳

- `get gotchas-template` を実行する。分岐は `hasContent` で行う。`exists` では分岐しない(空のファイルがあるときに判断を誤る)。
- `hasContent` が `true` のときは、提示も承認も行わない。既存の台帳がある旨を手順 8 で報告し、手順 7 の `init-gotchas` を実行しない。
- `hasContent` が `false` のときは、返った `path` と `relative` と `template` を提示する。
- 提示するのは次の 3 つとする。
  1. 台帳を作る絶対パスと、docRoot からの相対パス。
  2. `template` の**全文**。要約・抜粋に置き換えない。
  3. 作成後は、この台帳への直接編集が PreToolUse hook に拒否されるようになること、および毎セッションの注入対象に入ることの 2 点。
- 求める承認は「この台帳をこのパスに作ってよいか」の可否 1 点とする。本文の良し悪しを問わない。
- **本文はこの場では書き換えられないことを併せて伝える。** 雛形は書式の契約で固定されており、`init-gotchas` は本文を入力に取らない。
- 本文の変更を求められたときは、台帳の作成を保留する。書式の契約の変更として扱い、このセッションでは作らない。保留したことを手順 8 で報告する。
- パスが意図と違うと指摘されたときは作成しない。`metatron.config.json` の `paths.gotchas` を直すのはユーザーの作業であり、このスキルは行わない。
```

**(7) 手順 7(L143-148)。** 末尾へ足す。

```markdown
- GOTCHAS の承認を得た後に `init-gotchas` を実行する。`--staging-id` も `--input` も取らない。
- `already_exists` で拒否されたときは、承認を得てから実行するまでの間に台帳が作られている。**再実行しない。** 既存の台帳があることを手順 8 で報告する。
- `lock_timeout` で拒否されたときは、同じ文書へ書く別プロセスの完了を待って再実行する。ロックファイルを手で消さない。
```

**(8) 手順 8(L154)。**

```
- GOTCHAS の台帳を作ったときは、そのパスを報告する。台帳は空であり、失敗を記録するときに `append-gotcha` でエントリが入る。
- 既に台帳があって作らなかったとき、承認が得られず作らなかったときは、その事実と理由を報告する。
```

**(9) HARD-GATE(L158-167)。** **L160 の書き分けが必須である。**

| 行 | 変更 |
| --- | --- |
| L159 | 対象へ `init-gotchas` を加える |
| **L160** | 「**diff を全文提示せずに承認を求めない。**」→「**書き込む内容を全文提示せずに承認を求めない。** stage を経る 4 対象は `diff` の全文を、GOTCHAS は `get gotchas-template` の `template` の全文を提示する。」 |
| L161 | 「**4 対象を 1 回の承認でまとめない。**」→「**5 対象を 1 回の承認でまとめない。** 承認は ARCHITECTURE 1 回と rules 3 回と GOTCHAS 1 回に分ける。」 |
| **L162** | 先頭へ限定を足す。「**stage を経る 4 対象で `diff.truncated` が `true` のまま承認を求めない。**」(GOTCHAS に `diff.truncated` は無い) |
| 新規 | 「**`already_exists` を握り潰して既存の台帳を消さない。** 拒否されたら再実行せず報告する。」 |
| 新規 | 「**GOTCHAS の雛形を Write / Edit で書かない。** 生成は `init-gotchas` だけで行う。」 |

L160 を書き分けないと、承認対象が 5 つになった後に「GOTCHAS にも diff が要る」と読める。GOTCHAS の提示には diff が存在しないため、文字どおり従うと承認ゲートが詰まる。

**(10) description(L3)とタイトル(L6)。** どちらも現在「ARCHITECTURE と rules」の範囲で書かれている。

| 箇所 | 現状 | 変更 |
| --- | --- | --- |
| L6 | `# ARCHITECTURE と rules の初回生成` | `# ARCHITECTURE と rules と GOTCHAS の初回生成` |
| L3 | 「プロジェクトのアーキテクチャ文書(ARCHITECTURE)を初めて作るとき、…」 | 生成物に rules 3 ファイルと GOTCHAS の空の台帳が含まれることを 1 文で足す。**発火条件(いつ使うか)と他スキルとの境界は変えない** |

### 7.9 `plugins/metatron/skills/recording-gotchas/SKILL.md` と `get.ts` L294 —— 近道封じと文面

**(a) スキル(手順 2 の最終行)。**

```
- `error: "not_created"` は台帳が未作成という事実であって異常ではない。`/metatron:init` を経ていないプロジェクトと、台帳が手で消されたプロジェクトで起きる。
- 台帳が無いときも `append-gotcha` が雛形ごと作る。記録を止めて初期化を案内しない。自前でファイルを作らない。
- 記録の途中で `init-gotchas` を呼ばない。台帳の生成は承認を要する操作であり、失敗の記録はその承認を待たない。
```

最後の 1 行が要点である。新サブコマンドを足したことで「台帳が無い → `init-gotchas` を呼べばよい」という誤った近道が見えるようになる。塞がないと `append-gotcha` が承認不要である理由(設計書 §7-6 L1244)が実質的に失われる。

**(b) `src/cli/get.ts` L294 の `not_created` メッセージ。** 主生成が init に移った後も、この経路はフォールバックとして真である。ただし主語が古いので次へ差し替える。

変更前: `` `${config.gotchasPath} は未作成です。append-gotcha が台帳ごと作成します。` ``

変更後: `` `${config.gotchasPath} は未作成です。/metatron:init が台帳を作ります。init を経ずに記録するときは append-gotcha が台帳ごと作成します。` ``

### 7.10 `plugins/codiel/skills/recording-gotchas/SKILL.md` —— 直接追記の廃止

§6.6 の表に従う。差し替える箇所の全文を示す。

**(a) 手順(L40-47)。** 2 項目を書き換える。

```markdown
2. 台帳のパスを解決する。台帳が既にあれば既存エントリを読み、同じ事実が記録済みでないかを確かめる。台帳がまだ無いときは読むものが無いので、そのまま次へ進む。
...
6. 台帳へ追記できたときは、台帳を `git add` し、`codiel(gotchas): <一行要約> (issue-N try-M)` の形式でコミットする。「記録できないとき」に倒れたときは、台帳ではなく書き出したレポートを同じ形式でコミットする。run が特定できないときだけ `(issue-N try-M)` を省く。
```

手順 2 のパス解決は L14-16 の `node -e` + `resolveDocPaths` で行う。**これは codiel 自身の同梱スクリプトであり、metatron の CLI を必要としない。** したがって CLI の案内が無い環境でも手順 2 は動く。

**(b)「書き込み手段」節(L49-62)の全文。**

```markdown
## 書き込み手段

- **metatron CLI の案内がコンテキストにあれば、それを使って追記する。** エントリの JSON を一時ファイルへ書き、案内された絶対パスの CLI を `append-gotcha --input <一時ファイルのパス>` で実行する。
- **CLI の案内がコンテキストに無いときは、台帳へ追記しない。** 「記録できないとき」に従う。

metatron のプラグインルート・ソース・CLI パスを推測しない。使ってよい CLI のパスは、コンテキストに現れた案内と拒否メッセージに載っていたものだけとする。

| 状態 | 経路 |
|---|---|
| CLI の案内がコンテキストにある | 案内された CLI の `append-gotcha` で追記する |
| CLI の案内がコンテキストに無い | 台帳へ書かず、「記録できないとき」に従って持ち越す |

CLI に渡す JSON は `{ title, date?, task, mistake, cause, countermeasure, promotionCandidate }` とする。`task` / `mistake` / `cause` / `countermeasure` / `promotionCandidate` が下記 5 フィールドに対応する。`date` を省くと当日日付になる。採番・挿入位置・台帳が無いときの雛形の作成は CLI が行う。
```

**(c)「エントリの書式」の L66。**

```
「記録できないとき」の報告に載せるエントリも、CLI に渡すときと同じ書式で書く。
```

**(d)「台帳が無いとき」節(L97-125)を節ごと削除し、次へ差し替える。**

```markdown
### 台帳が無いとき

台帳が無くても記録を止めない。`append-gotcha` が台帳ごと作る。初期化コマンドをユーザーへ案内して待たない。

台帳の雛形をこのスキルから書かない。雛形の本文は metatron の書式契約が持つ。
```

**(e)「記録できないとき」節を新設する**(「台帳が無いとき」の直後、HARD-GATE の直前)。

```markdown
### 記録できないとき

CLI の案内がコンテキストに無いときは、台帳へ追記できない。このとき次の順で行う。

1. エントリは必ず組み立てる。書けないことを先に確認して、組み立て自体を省略しない。
2. 台帳への直接編集を試みない。直接編集は metatron が導入された環境では hook に拒否され、導入されていない環境では書式と採番の保証が無いまま台帳が生まれる。
3. 組み立てたエントリを「未記録の GOTCHAS」としてレポートへ書く。書き先はアクティブな run があれば `.codiel/runs/<runId>/try-<n>/reports/`、無ければ `.codiel/reports/` とする。**どちらも `.codiel/` 配下である。** この外に書くと書き込みが `ask` に倒れ、run が止まる。
4. 同じ本文をユーザーへの完了報告にも載せる。
5. 報告に、台帳へ入れる手段を添える。metatron が導入されていれば「次のセッションで注入される CLI の案内から `append-gotcha` で追記する」、導入されていなければ「`/metatron:init` で台帳を作ってから追記する」と書く。
6. run は止めない。記録手段の不在は実装・テスト・PR の成否と無関係である。

記録できない状態は持ち越しであって放棄ではない。エントリの本文が残っていれば、次のセッションで台帳へ入る。
```

**(f) Red Flags(L140-141)。**

| 思考 | 現実(変更後) |
|---|---|
| 「CLI の案内が無いので記録できなかった」 | エントリを組み立てて run のレポートと完了報告に残せる。次のセッションで台帳へ入る。黙って捨てない。 |
| 「台帳が無いので初期化を待つ」 | `append-gotcha` が台帳ごと作る。初期化コマンドを待たない。 |

### 7.11 `plugins/codiel/CLAUDE.example.md` L25-27 —— GOTCHAS だけを分離する

変更後:

```
- ARCHITECTURE を更新するときは、コンテキストに更新用 CLI の案内があればその CLI を経由する。
  案内が無ければ直接編集する。直接編集が hook に拒否されたときは、拒否メッセージに示された
  CLI で実行し直す。
- GOTCHAS は直接編集しない。更新用 CLI の案内があればその CLI を経由する。案内が無いときは
  記録内容を報告に残し、台帳へ入れる手段を添える。
```

L31-33(規則 1)と L34-37(規則 2)は変更しない(§6.10)。

### 7.12 その他の追随(codiel 側)

| ファイル | 現状 | 変更後 |
| --- | --- | --- |
| `commands/init.md` L2 の description 末尾 | 「GOTCHAS は生成せず、失敗を記録する時点で台帳ごと作られる」 | 「GOTCHAS は生成しない(台帳の生成は metatron が行う)」 |
| `scripts/install-harness.sh` **L5** | 「GOTCHAS は失敗を記録する時点で recording-gotchas スキルが台帳ごと作成するため、ここでは配置しない。」 | **行ごと削除する**(文面の差し替えではない)。GOTCHAS は codiel の管轄外になるため、言及そのものが不要になる。削除後このファイルに GOTCHAS の語は残らない。根拠と削除範囲は §6.12 |
| `skills/initializing-harness/SKILL.md` L39 | 「…失敗を記録する時点で `recording-gotchas` が台帳ごと作成する。」 | 「GOTCHAS は確認対象に含めない。台帳の生成は metatron が行う(`/metatron:init`)。codiel は台帳を作らない。」 |
| `docs/DESIGN.md` L395 | 「…失敗を記録する時点で `recording-gotchas` が台帳ごと作成する。」 | 「GOTCHAS は `/codiel:init` の対象ではない。台帳の生成は metatron が行う。記録時に台帳が無ければ `append-gotcha` が台帳ごと作る。codiel は台帳を作らない。」 |
| `docs/DESIGN.md` の `### GOTCHAS` 節(L427-436 付近) | 記録の契機と書式の歴史的記述 | 「記録の契機」の行の後へ 1 行: 「台帳の生成と書き込みは metatron の CLI が行う。CLI の案内が無い環境では、記録を run のレポートへ持ち越す(設計書 `2026-09-15-metatron-init-gotchas-design.md` §6.4)。」 |
| `README.md` L21-24 | 「Codiel は単体で完結します。」 | 同段落の末尾へ 1 文: 「GOTCHAS の台帳は metatron が管理します。metatron が無い環境では、失敗の記録は run のレポートと完了報告に残り、台帳へは追記されません。」 |
| `src/__test__/install-harness.test.ts` L44 のテスト名 | 「…(記録時に recording-gotchas が台帳ごと作る)」 | 「GOTCHAS.md は作成しない(台帳の生成は metatron が行う)」。**アサーションは変更しない** |

### 7.13 その他の追随(metatron 側とリポジトリ共通)

| ファイル | 変更 |
| --- | --- |
| **`plugins/metatron/commands/init.md` L2** | description が「ARCHITECTURE を初めて生成する」で GOTCHAS にも rules にも触れていない。生成物に rules 3 ファイルと GOTCHAS の空の台帳が含まれることを足す。**codiel 側の `commands/init.md` を追随させるのに metatron 側を放置すると非対称が残る** |
| `plugins/metatron/README.md` L25(`/metatron:init` の説明) | 生成するものへ「`.claude/rules/metatron/` の 3 ファイル」と「GOTCHAS の空の台帳(承認を経て作る)」を足す |
| 同 CLI の表(L37-53 付近) | `get gotchas-template` と `init-gotchas` の 2 行を足す |
| **同 L59(「なぜ CLI を通すのか」)** | 「差分を計算せずに書き込む経路がコマンド体系上存在しません」は `append-gotcha` の時点で既に偽であり、`init-gotchas` でさらに偽になる。「ARCHITECTURE と rules の更新には差分を計算せずに書き込む経路がありません」へ**主語を限定する** |
| ルート `README.md` L132 | ARCHITECTURE と rules 3 ファイルと GOTCHAS の空の台帳を生成することを明記する |
| **`.claude/rules/metatron/protected-paths.md`** | **2 箇所を 1 回の `stage-rules` → `commit-rules` でまとめて直す**(§6.12 (3))。① L7: GOTCHAS の更新手段を `append-gotcha` / `tag-gotcha` の 2 本として列挙しているため `init-gotchas` を足す(**本改修に必須**)。② 「触らないパス」の `plugins/*/scripts/` の項: `install-harness.sh` が手書きで `src/` の対応物を持たない例外を明記する(**O6。採否はオーケストレーター**)。**このファイルは Claude Code の rules 機構で毎セッション読まれる。** 直接編集は hook が拒否する |
| `plugins/metatron/docs/format-change-checklist.md` | GOTCHAS 節(L22-25)へ 2 行を足す(`capturing-architecture/SKILL.md` の GOTCHAS の承認節、`references/cli-usage.md` の `init-gotchas` の節)。併せて **L25 の「codiel: `skills/recording-gotchas/SKILL.md` の書式の写し」を「codiel: `skills/recording-gotchas/SKILL.md` の**エントリ**書式の写し(台帳の雛形は持たない)」へ改める**(§6.6 で雛形の写しが消えるため) |
| `harness-docs/ARCHITECTURE.md` | ADR-002 を `stage-adr` → `commit-architecture` で追加する(§6.8)。**それ以外の節は変更しない。`/metatron:update` は実行しない** |
| `harness-docs/design/2026-08-16-file-contract-freeze.md` §12 | §6.7 (2) の (a) と (b)。**U1 のユーザー確認を経てから適用する** |
| `.serena/memories/metatron/core.md` | `/metatron:init` の説明へ GOTCHAS の生成を足す。冒頭のバージョン表記(`0.1.6-dev`)を `0.3.0-dev` へ直す |
| `.serena/memories/codiel/core.md` | L1 のバージョン(`0.5.2-dev` → `0.7.0-dev`)。L16-21 の `install-harness.sh` の行と `recording-gotchas` の三分岐の記述を CLI 専用の 2 状態へ書き換える |
| `.serena/memories/file_contract.md` | §12 の要約にサブコマンド一覧やロック表の写しがあるかを確認し、あれば追随する(O4) |

---

## 8. 影響ファイル

### 8.1 metatron(実装層)

`src/lib/gotchas.ts` / `src/cli/gotcha.ts` / `src/cli/get.ts` / `src/cli/main.ts` / `src/cli/paths.ts` / `src/guard-docs.ts` / `scripts/*.mjs`(build による再生成)。

**変更しない**: `src/inject-context.ts`(§6.11)、`src/lib/staging.ts`、`src/cli/stage.ts`、`src/cli/commit.ts`、`build.ts`。

### 8.2 metatron(指示層・参照層・文書)

`skills/capturing-architecture/SKILL.md`(description・タイトル・本文・HARD-GATE)/ `skills/recording-gotchas/SKILL.md` / **`commands/init.md`** / `references/cli-usage.md` / `references/gotchas-format.md` / `README.md`(L25・CLI の表・**L59**)/ `docs/format-change-checklist.md` / `.claude-plugin/plugin.json` / `package.json`。

### 8.3 codiel

`skills/recording-gotchas/SKILL.md` / `CLAUDE.example.md` / `skills/initializing-harness/SKILL.md` / `commands/init.md` / `scripts/install-harness.sh`(L5 を削除)/ `docs/DESIGN.md` / `README.md` / `src/__test__/install-harness.test.ts`(テスト名のみ)/ `.claude-plugin/plugin.json` / `package.json`。

### 8.4 リポジトリ共通

ルート `README.md` / `harness-docs/ARCHITECTURE.md`(ADR-002 のみ、CLI 経由)/ **`.claude/rules/metatron/protected-paths.md`**(`stage-rules` 経由)/ **`harness-docs/design/2026-08-16-file-contract-freeze.md` §12**(U1)/ `.serena/memories/metatron/core.md` / `.serena/memories/codiel/core.md`。

---

## 9. テスト方針

### 9.1 新規(`src/lib/__test__/gotchas.test.ts`)

| ID | 内容 | 固定する事実 |
| --- | --- | --- |
| GI1 | 台帳も親ディレクトリも無い状態で `initGotchasLedger` | 4 節がすべて含まれる。`created: true`。`parseGotchas().entries` が 0 件。親ディレクトリが作られる |
| GI2 | 内容のある台帳がある状態 | `GotchaError.code === "already_exists"`。**ファイルがバイト単位で不変** |
| GI3 | 空白のみ(`"   \n\n"`)の台帳がある状態 | 雛形で作り直される(`buildAppendedText` L617 の判定に揃っている) |
| GI4 | GI1 の直後に `appendGotcha` | `created: false`、`id === "GOTCHA-001"` |
| GI5 | ― | `renderGotchasTemplate()` の戻り値と GI1 で書かれた内容が一致する |

### 9.2 新規・改修(`src/cli/__test__/cli.test.ts`)

| 対象 | 変更 |
| --- | --- |
| `READ_INVOCATIONS`(L197-214) | `["get", "gotchas-template"]` を足す。S5 の異常環境すべてで exit 0 と妥当な JSON が自動的に検証される |
| `REJECTIONS`(S6) | `init-gotchas`(既存の `docs/GOTCHAS.md` がある状態)を足し `error: "already_exists"` を固定する |
| 新規 1 | 「`get gotchas-template` → `init-gotchas` で台帳が作られ、再実行は `already_exists` で拒否され台帳は不変」。`exists` / `hasContent` が作成前後で変わること、`template` とファイル内容が一致することを併せて固定 |
| 新規 2 | 「台帳が無い状態でも `get gotchas-template` は `ok: true`」 |
| **新規 3** | **「空白のみの `GOTCHAS.md` があるとき `get gotchas-template` は `exists: true` / `hasContent: false` を返し、`init-gotchas` が雛形で作り直す」。** GI3 は lib 単体の検証であり、CLI 経由で `exists` と `hasContent` が食い違う挙動は別に固定する必要がある(§6.1 の分岐がここに依存する) |

### 9.3 改修(`src/__test__/guard-docs.test.ts`)

GOTCHAS への Write が deny されるときの `permissionDecisionReason` に `init-gotchas` と `append-gotcha` の両方が載ることを 1 ケースで固定する。既存の D6(L179)/ D7 / D7b(L216-243)は判定のみを見ており文面を見ていないため無変更で通る。

### 9.4 網羅検査(O1 = 含める。**配置に注意**)

| ID | 内容 | 置く場所 |
| --- | --- | --- |
| SC1 | `READ_SUBCOMMANDS` と `WRITE_SUBCOMMANDS` の全要素が `USAGE_LINES` のいずれかの行に現れる | **`USAGE_LINES` を更新するタスクと同じタスク**。`WRITE_SUBCOMMANDS` の更新(main.ts)より後に置かないと赤のまま残る |
| SC2 | `WRITE_SUBCOMMANDS` の全要素が `references/cli-usage.md` の本文に現れる | **`cli-usage.md` を更新するタスクと同じタスク** |

SC2 はリポジトリ内の相対パスを読むため、`section-reference-inventory.test.ts` と同じく「配布物に含まれないテスト」の扱いになる。

### 9.5 改修不要と確認済みのテスト

| テスト | 理由 |
| --- | --- |
| `gotchas.test.ts` L127-145(G1) | `appendGotcha` 単体。init を呼ばない |
| `cli.test.ts` L232(S5) | `READ_INVOCATIONS` への追加で自動的に新対象も覆う |
| `src/__test__/inject-context.test.ts` L23-66 | `inject-context.ts` を変更しないため無変更 |
| `plugins/codiel/src/__test__/install-harness.test.ts` L44-61 | アサーションは変更せず、テスト名のみ追随 |
| `src/__test__/section-reference-inventory.test.ts` | `TERMS` は ARCHITECTURE の見出しと rules のファイル名。GOTCHAS の語は対象外 |

### 9.6 実装順序

1. `gotchas.ts` のテスト(GI1-GI5)→ 実装。
2. CLI の実装(`gotcha.ts` → `get.ts` → `main.ts`)→ CLI テスト。
3. `paths.ts`(+ SC1)→ `guard-docs.ts` → そのテスト。
4. `pnpm run build` で `scripts/` を再生成。
5. 指示層・参照層(`cli-usage.md` + SC2)。
6. codiel 側。
7. バージョン・README・メモリ・ADR・rules(`protected-paths.md`)。

---

## 10. リスクと受容

| # | リスク | 対策 | 受容の判断 |
| --- | --- | --- | --- |
| 1 | `init-gotchas` が既存の台帳を消す | §6.3 の `already_exists` 拒否をロック下で行う。GI2 がバイト単位の不変を固定 | 対策後は受容 |
| 2 | `recording-gotchas` が失敗記録の途中で `init-gotchas` を呼び、承認を待って run が止まる | §7.9 で「記録の途中で `init-gotchas` を呼ばない」を明記 | 対策後は受容 |
| 3 | codiel 単体環境で失敗記録が台帳へ入らなくなる | §6.4 の縮退 | **受容する。** 単体環境の codiel はもともと GOTCHAS の注入も `get gotchas` も持たない |
| 4 | 併用環境で注入が失われた run の記録が、deny メッセージ経由で回収できなくなる | 同上 | **受容する。** 回収経路の維持には「まず直接編集を試す」が要り、それは必ず 1 回の拒否を発生させる |
| 5 | 承認が「可否 1 点」に薄まり形式化する | §6.1 の提示 3 点のうち (a) パスと (c) 帰結が実質的な判断材料になる | 受容 |
| 6 | `install-harness.sh` の編集が保護パスの規則(`plugins/*/scripts/` はバンドル出力)に触れる。**削除方針でも残る**(削除もまた `scripts/` への手編集であるため) | 規則の文言が事実と合っていない(このファイルはバンドル出力ではない)。`protected-paths.md` へ例外を明記して解消する。T17 の 1 回の `stage-rules` に同梱する(§6.12 (3)、O6) | 対策後は受容。O6 が否決された場合は綻びが残るが、削除自体は §6.12 の確定事項として実施する |
| 7 | 注入の予算が増える | `inject-context.ts` を変更しない。空の台帳の要約は数行に収まる | 受容 |
| 8 | **`get gotchas-template` と `init-gotchas` の間に空・空白のみのファイルが現れると、staging なら `file_changed` で止まるところを雛形で上書きして進む(空ファイル競合の窓)** | 塞がない。上書きされるのは空・空白のみのファイルであり、**失われるデータが無い**。失われるのは「止まって知らせる」振る舞いだけである | **受容する**(§6.2) |
| 9 | **CLI の対象文書は実行時の cwd から解決した docRoot で決まり、`--cwd` フラグが無い。検証手順を誤るとリポジトリ自身の正本(`harness-docs/GOTCHAS.md`)を実体化させ、以後 PreToolUse が Write を deny する** | 検証は**空の一時ディレクトリへ `cd` し、CLI を絶対パスで呼ぶ**。tmp にリポジトリの `metatron.config.json` を持ち込まない。実装計画の T3 / T20 に手順として書く | 対策後は受容(§12-2 O5 と接続) |

---

## 11. 不採用案

### 11.1 スキルが Write で雛形を書く(案 ii)

**不成立。** matcher と厳密一致 deny により、ファイル未作成でも拒否される(§4.2)。hook を GOTCHAS だけ緩めれば、直接編集を止めるという metatron の唯一の強制点が崩れる。

### 11.2 `append-gotcha` にエントリ無しモードを足す(案 iii)

**不採用。** `buildAppendedText`(L607-664)は雛形作成後に必ず 1 件のエントリを挿入し、「雛形だけ」の分岐が無い。`validateGotchaInput`(L471-524)は `title` と `promotionCandidate` を必須にしている。加えて設計書 §7-6 が `append-gotcha` を「承認不要」と定めているため、同一サブコマンドが承認要と不要の両方を持つことになり衝突する。

### 11.3 `get gotchas --template` のフラグ案

**不採用。** `get gotchas` は台帳が無いとき `ok: false, error: "not_created"` を返す(L289-306)。雛形が欲しいのはまさにその状況であり、`ok: false` の応答に「使ってほしい値」を載せることになる。

### 11.4 codiel の直接追記を残す(要件 §3-3 の反対案)

**要件により不採用。** 残した場合、台帳の書式・採番・雛形の写しが codiel 側に残り続け、`format-change-checklist.md` の追随先が減らない。また「案内の有無で metatron の有無を近似する」分岐が残り、外れたときの回復に deny hook の拒否を必ず 1 回通す必要がある。

### 11.5 採らなかったサブコマンド名

| 候補 | 不採用の理由 |
| --- | --- |
| `create-gotchas` | 動詞が init フローとの対応を示さない |
| `init-gotcha`(単数) | 対象はエントリ 1 件ではなく台帳である |
| `stage-gotchas` / `commit-gotchas` | 二段構えを前提とする名前。§6.2 と不整合 |
| `init-ledger` | リポジトリの語彙に「ledger」が無い。CLI の対象名は文書名で統一されている |
| `get gotchas-skeleton` / `-scaffold` | 既存の文書が一貫して「雛形」= template を使っている |

### 11.6 ADR を起票しない

**不採用。** 凍結契約 §6-3 の 3 条件をすべて満たす(§6.8)。

### 11.7 `2026-08-16-metatron-design.md` を直接編集して論拠を書き換える

**不採用。** 先例(`2026-09-09-...-design.md` §1)は「既存の設計書は編集せず、新しい設計書の §1 で上書きを記録する」である。書き換えると「いつ何が覆ったか」が読めなくなる。§1 と ADR-002 の 2 箇所に記録を置く。

### 11.8 凍結契約 §12 の改訂を避けるために、サブコマンドを追加せず既存に相乗りする

**不採用。** 相乗り先は `append-gotcha` しかなく、それは案 iii(§11.2)そのものである。§12 の改訂は 2 行の追加と 1 行の差し替えで済み、ユーザー確認の手順も既に定まっている(L18)。契約を守るために設計を歪めるより、契約を正しく更新するほうが小さい。

---

## 12. 確認事項と確定事項

### 12-1. ユーザー確認の結果

| # | 事項 | 必須か | 確認結果 |
| --- | --- | --- | --- |
| **U1** | **凍結契約の改訂。** (a) §12 サブコマンド表(L683-698)へ 2 行追加、(b) §12 ロック表 L748 の差し替え、(c) §7-3(L453-454)への明確化 1 行追記 | **(a) と (b) は必須。(c) は任意** | **(a)(b)(c) すべてユーザー承認済み。実装で適用する。** |

**U2 は解決済み。** ユーザーの回答により「`install-harness.sh` L5 を行ごと削除する」が確定した(§6.12)。ユーザー確認の待ち事項ではなくなり、通常の実装タスクへ移した(実装計画書 T13)。

### 12-2. 確定済み(オーケストレーター判断)

| # | 事項 | 決定 |
| --- | --- | --- |
| O1 | 網羅検査テスト SC1 / SC2 を含めるか | **含める。** ただし配置は §9.4 のとおり `USAGE_LINES` / `cli-usage.md` の更新と同じタスクへ置く |
| O2 | codiel のバージョン | **マイナー(`0.7.0-dev`)** |
| O3 | `CLAUDE.example.md` の ARCHITECTURE 側の非対称 | **本改修では扱わない。** 別件(ドメインマップ移管)と一緒に扱う |
| O4 | `.serena/memories/file_contract.md` の追随 | **実装時に確認し、§12 の写し(サブコマンド一覧・ロック表)があれば追随する。無ければ変更しない** |
| O5 | 本リポジトリ自身で `/metatron:init` を実行して台帳を作るか | **Done 条件に含めない。** 実行はユーザーの判断による。**§10 リスク 9 のとおり、検証手順が誤ってこれを既成事実化しないようにする** |
| **O6** | **`protected-paths.md` の「触らないパス」へ `install-harness.sh` の例外を明記するか**(§6.12 (3))。本改修に必須なのは L7 の GOTCHAS の更新手段だけで、例外の明記は U2 が露呈させた隣接する綻びの解消である | **既定は「明記する」。** T17 の 1 回の `stage-rules` に同梱すれば追加コストがほぼ無く、明記しないと以後も同じ判断迷いが再発する。否決された場合は L7 の更新だけを行う |

---

## 13. 実施手順と Done 条件

手順の詳細は `harness-docs/plans/2026-09-15-metatron-init-gotchas-plan.md` にある。

- [ ] `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` がすべて通る。
- [ ] `pnpm run build` を実行し、`plugins/metatron/scripts/` の差分が同じコミットにある。
- [ ] metatron の `plugin.json` と `package.json` がともに `0.3.0-dev`、codiel の両ファイルがともに `0.7.0-dev`。
- [ ] ルート `README.md` と 2 つのプラグイン `README.md` に反映されている。
- [ ] ADR-002 が `stage-adr` → `commit-architecture` で `harness-docs/ARCHITECTURE.md` に入っている。
- [ ] `.claude/rules/metatron/protected-paths.md` L7 に `init-gotchas` が入っている(`stage-rules` → `commit-rules` 経由)。
- [ ] **凍結契約 §12 の 2 表が改訂されている(U1 (a)(b))。得られなかった場合はその事実が記録されている。**
- [ ] `.serena/memories/metatron/core.md` と `.serena/memories/codiel/core.md` が改修後の記述と食い違わない(バージョン表記を含む)。
- [ ] codiel の `recording-gotchas/SKILL.md` に GOTCHAS の雛形ブロックが残っていない。
- [ ] `capturing-architecture/SKILL.md` で、**承認**の文脈に「4 対象」が残っていない(**stage** の文脈の「4 対象」は残っていてよい)。
- [ ] HARD-GATE の L160 と L162 が、stage を経る 4 対象と GOTCHAS で書き分けられている。
- [ ] **検証手順がリポジトリ自身の `harness-docs/GOTCHAS.md` を作っていない**(`git status` と `ls harness-docs/` で確認)。
- [ ] **`plugins/codiel/scripts/install-harness.sh` に GOTCHAS の語が残っていない**(L5 が削除されている)。
- [ ] §12-1 の U1 について、ユーザー確認の結果が記録されている。

---

## 14. レビュー指摘のうち、一次確認で誤りと判明したもの

| # | 指摘 | 一次確認の結果 |
| --- | --- | --- |
| 1 | 「codiel `recording-gotchas` の手順 2 は、CLI が無いときは `get gotchas` もできない」 | **誤り。** 同スキルは `get gotchas` を使わない。台帳のパス解決は L14-16 の `node -e` + **codiel 自身の** `scripts/lib.mjs` の `resolveDocPaths` で行い、既存エントリの読み取りは解決したパスへの直読である。metatron の CLI に依存しないため、CLI の案内が無い環境でも手順 2 は動く。**ただし「台帳が無いときに読むものが無い」ことが未記載である点は真**なので、§7.10 (a) で手順 2 を書き換える |

上記以外の指摘(A-1、B-1〜B-12、C-1〜C-5、D-1〜D-10)は、すべて一次ファイルで裏が取れた。
