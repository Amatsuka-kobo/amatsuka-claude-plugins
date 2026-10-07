# Context Map: metatron init が GOTCHAS.md を生成しない件の事実調査

**作成日**: 2026-09-15
**作成者**: Claude Opus 5 (1M context)(コードベース探索統括の役割)
**対象タスク**: (1) `/metatron:init` が `harness-docs/GOTCHAS.md` を生成しない事象が設計通りか実装漏れかの判定。(2) 案2(init で GOTCHAS を生成する方向へ設計を変える)採用後の、Codiel に残る GOTCHAS 経路・ドメインマップの去就・領分移管の影響範囲の調査。
**関連するBlueprintセクション**: `harness-docs/design/2026-08-16-metatron-design.md` §8-7(フェイルオープン)/ §9-1(初回生成フロー)/ §10-4(Codiel 連携)/ §12-2(状況別の挙動)

---

## 1. 目的・スコープ

- 判定対象は「GOTCHAS が init で作られないこと」が意図的設計か実装漏れかの一点。
- スコープ内: 起動経路・CLI 実装・設計文書・codiel との比較・現状の実体。
- スコープ外: 実装の変更、README/文面の修正そのもの(判断はオーケストレーター)。

## 2. 現在のコードベース構造

### 2.1 関係する構成

```
plugins/metatron/
├── commands/init.md            → capturing-architecture スキルを起動するだけ
├── skills/capturing-architecture/SKILL.md   ARCHITECTURE + rules3 の初回生成
├── skills/recording-gotchas/SKILL.md        GOTCHAS 追記の唯一の入口
├── references/gotchas-format.md             台帳の書式契約
└── src/
    ├── cli/main.ts             9 サブコマンド(init は無い)
    ├── lib/gotchas.ts          append-gotcha / tag-gotcha 本体
    ├── lib/config.ts           paths.gotchas の解決
    └── inject-context.ts       SessionStart 注入(init 案内文を含む)
plugins/codiel/scripts/install-harness.sh    GOTCHAS を作らないと明記
metatron.config.json            paths.gotchas = harness-docs/GOTCHAS.md
```

### 2.2 重要なファイル一覧

| ファイルパス | 役割・内容の概要 | 重要度 | 備考 |
|--------------|------------------|--------|------|
| `plugins/metatron/skills/capturing-architecture/SKILL.md:154` | 「GOTCHAS の台帳は初回生成では作らない」と明記 | High | 最も直接的な一次証拠 |
| `plugins/metatron/src/lib/gotchas.ts:616-620` | 台帳未存在時に雛形ごと新規作成するフォールバック | High | 生成口はここだけ |
| `plugins/metatron/src/cli/get.ts:290-306` | `get gotchas` は未存在で `not_created` を返し exit 0 | High | 異常扱いしない設計 |
| `plugins/metatron/src/inject-context.ts:110-112` | 「ARCHITECTURE も GOTCHAS も無い。`/metatron:init` で作成する」 | High | 誤解を生みうる文面 |
| `plugins/codiel/scripts/install-harness.sh:5` | GOTCHAS をここでは配置しないと明記 | High | codiel も同じ思想 |
| `plugins/codiel/commands/init.md:2` | 「GOTCHAS は生成せず、失敗を記録する時点で台帳ごと作られる」 | High | codiel 側の明文 |
| `plugins/codiel/skills/recording-gotchas/SKILL.md:141` | 「記録の契機は失敗発生時であり、そこで止めれば学習機会を失う」 | High | 非生成の WHY の一次記述 |
| `plugins/codiel/src/hooks/lib.ts:73-84` | codiel も `metatron.config.json` の `paths.gotchas` を読む | Medium | 設定は共通、実装は独立 |
| `harness-docs/design/2026-08-16-metatron-design.md:1955` | 「GOTCHAS が存在しない → append-gotcha が台帳ごと作る」 | High | 設計書の異常系表 |
| `harness-docs/design/2026-08-16-metatron-design.md:1454` | init フロー手順 6「GOTCHAS の台帳を初期化(空でよい…)」 | Medium | 字面が紛らわしい |
| `plugins/metatron/README.md:25` | init 説明。ARCHITECTURE のみ言及、GOTCHAS・rules に触れない | Medium | 利用者向けの穴 |
| `plugins/metatron/src/lib/gotchas.ts:990-993` | `tag-gotcha` は未存在で `not_found` を投げる | Low | append とは非対称 |

## 3. 関連モジュール・データフロー

- **init 経路**: `/metatron:init` → `commands/init.md` → `capturing-architecture` スキル → `scan` → `stage-architecture` / `stage-rules` → `commit-architecture` / `commit-rules`。この経路に GOTCHAS は一切登場しない。CLI に `init` サブコマンドは存在しない。
- **GOTCHAS 経路(別系統)**: 失敗の発生 → `recording-gotchas` スキル → `append-gotcha --input` → 台帳が無ければ雛形ごと生成。
- 2 経路は交差しない。init から GOTCHAS 生成へ到達する呼び出しは存在しない。
- **codiel も同型**: `/codiel:init` → `initializing-harness`(ARCHITECTURE 最小構成・`.codiel/`・`raguel.config.yaml`・CLAUDE.md 節のみ)。GOTCHAS は `recording-gotchas` が記録時に作る。
- 設定は両プラグイン共通で `metatron.config.json` の `paths.gotchas`(既定 `docs/GOTCHAS.md`)。`raguel.config.yaml` は Raguel のルール専用で GOTCHAS パスを持たない。両者はソースを共有せず同じ規則を独立実装する。

## 4. 既存の実装パターン・規約

- 3 種の管理対象(ARCHITECTURE / GOTCHAS / rules)への書き込み口を CLI に一本化し、直接編集は PreToolUse hook が拒否する。
- 読み取り系は常に exit 0 のフェイルオープン。「未作成」は事実として返す正常系であり、異常ではない。
- ARCHITECTURE と rules は「事前に宣言する」資産なので init で作る。GOTCHAS と `## ADR 一覧` は「起きてから記録する」資産なので init の対象外。この対称性が設計全体を貫く。

## 5. 変更の影響範囲(Impact Analysis)

### 5.1 直接影響を受ける箇所(もし文面を直す判断になった場合)

- `plugins/metatron/src/inject-context.ts:110-112`: 文面を変えると `src/__test__/inject-context.test.ts:49-50` の期待値も追随が必要。`src/` 変更につき `pnpm run build` で `scripts/` の再生成が要る。
- `plugins/metatron/README.md:25`: init が作るもの(ARCHITECTURE + rules3)と作らないもの(GOTCHAS・ADR 一覧)の明示。

### 5.2 間接的に波及する箇所

- `harness-docs/design/2026-08-16-metatron-design.md:1454` の手順 6 の字面。設計書は保護対象ではないが、実装と読み合わせる人が再び混乱しうる。

### 5.3 変更を避けるべき箇所

- `append-gotcha` の生成フォールバック、`get gotchas` の `not_created` 応答。いずれも設計・テスト・3 文書で一貫しており、触る理由がない。
- `harness-docs/GOTCHAS.md` を人手で作ること。書式契約上 `append-gotcha` が作る。

## 6. 守るべき既存契約・インターフェース

- `references/gotchas-format.md:14`「台帳または `## 失敗パターン一覧` 節が無いときは、`append-gotcha` が雛形ごと作る。自前でファイルを作らない。」
- `get gotchas` の未存在応答は `ok:false / error:"not_created" / exists:false / entries:[] / exit 0`。
- 雛形は `# GOTCHAS` 見出し・運用ルール・記入テンプレート・空の `## 失敗パターン一覧` を含む(`src/lib/gotchas.ts:530-560`)。
- `paths.gotchas` 既定値は `docs/GOTCHAS.md`(`src/lib/config.ts:22`)。本リポジトリは `harness-docs/GOTCHAS.md` に上書き。
- **4 プラグイン例外規定**(`harness-docs/ARCHITECTURE.md:50`、原文):「指示層と参照層に、リポジトリルート固有のパスや他プラグインの名前を書かない。参照が要る内容は、プラグイン内に閉じた表現へ書き換える。例外は、プラグイン間の連携を前提に設計された `sandalphon` `codiel` `metatron` `gh-utility` の 4 プラグイン同士の言及のみ。」
- **実装層の依存規則**(`harness-docs/ARCHITECTURE.md:48`、原文):「実装層は他プラグインの `src/` を import しない。同じ規則が複数のプラグインに要るときは、各プラグインで独立に実装し、規則を変えたときは同じ規則を持つ全プラグインの実装を追随させる。」← **この行に例外の記述は無い。** 例外(`:50`)は指示層・参照層の「言及」に係る。
- **節名参照の登録簿**: `plugins/metatron/src/fixtures/section-reference-inventory.json`(B=12 / C=18 / D=9 件)と `src/__test__/section-reference-inventory.test.ts`(V1〜V3)。V1 は分類 A がゼロであることを固定、V2 は未登録参照で落ち、V3 は登録済みなのに実体が無いと落ちる。B(ドメインマップ依存)12 件はすべて codiel。

## 6-2. Q1 / Q2 の要点(今回の追加調査)

**Q1: Codiel に GOTCHAS を作る経路は残っているか → 残っている。**
- 唯一の write 経路は `plugins/codiel/skills/recording-gotchas/SKILL.md`。`:97-125` に雛形が埋め込まれ、台帳が無ければ**雛形ごと新規作成**する(`:99`)。
- 書き込み手段の三分岐(`:56-60`):CLI 案内あり → `append-gotcha` / 案内を失った → 直接追記し拒否されたら CLI / **metatron が無い → 直接追記(拒否は起きない)**。`:54`「metatron のインストール有無を検出しない」。
- 契機は 4 つ(`:20-27`):Raguel STOP / ループ上限超過の中止裁定 / `record_outcome(incident)` / fix-loop 完了時の設計漏れ発覚。STOP 経路の呼び出しは `skills/raguel-gating/SKILL.md:118`。
- **init 経路には無い**: `scripts/install-harness.sh:5` と `skills/initializing-harness/SKILL.md:39` が明示的に非生成。`src/__test__/install-harness.test.ts:44-61` が「作らない」「既存を変更しない」を固定。
- codiel の `src/` に GOTCHAS を読み書きするコードは無い(`src/hooks/lib.ts` のパス解決のみ)。codiel に SessionStart hook は無く、注入もしない(`plugins/codiel/hooks/hooks.json`)。実体の書き込みはオーケストレーターの Edit/Write で行われる。

**Q2: ドメインマップを Codiel に残す意味 → 実行時消費者が 3 系統実在し、理由も明文化されている。**
- **コードによる消費(最重要)**: `plugins/codiel/src/hooks/guard-write.ts:153-174`。`readDomainsResult(cwd)` でマップを読み、ドメイン未登録なら `ask`(`:159-166`)、glob 範囲外なら `ask`(`:167-174`)。PreToolUse の書き込み境界制御。
- **実装者ディスパッチ**: `skills/writing-dev-plans/SKILL.md:30-34` で `[domain: ...]` タグを付与 → `skills/orchestrating-runs/SKILL.md:195-200` でタグに応じて implementer を選択。
- **レビュアー選択参加**: `skills/orchestrating-runs/SKILL.md:198-202`、各 `agents/codiel-reviewer-*.md:3`。
- **Raguel は参照しない**(`raguel.config.yaml` に domains キー無し。`raguel-mcp` の `scopeKeywords.ts` の "domain" は業務ドメイン語彙で無関係)。
- **残した理由の明文**(`harness-docs/design/2026-08-24-metatron-rules-expansion-design.md:508`):「`## ドメインマップ`(```json metatron:domains ``` ブロック)への参照だけを残す。これは機械可読ブロックであり、実装が決定的に読む必要がある。」同 `:520` の表:「ドメインマップ | 要る(実装のディスパッチ先を決める)| ARCHITECTURE の機械可読ブロック。読み続ける」。
- **前提の訂正**: 「保護パスは metatron の rules に移管済み」は**このリポジトリ自身の** harness-docs の節の移管であって、codiel が対象プロジェクトで使う保護パスではない。後者の正本は元々 `raguel.config.yaml`(同 `:521`「codiel 自身の資産」)であり、移管の対象になったことがない。
- codiel は metatron の `get domains` を呼ばない。自前パーサ(`src/hooks/lib.ts:385-509`)で独立実装する。

## 7. 未解決事項・不明点(Open Questions)

| # | 質問内容 | 影響度 | 上流報告先(役割) | 現状の仮定 |
|---|----------|--------|------------------|------------|
| 1 | SessionStart の init 案内文(`inject-context.ts:110`)が「ARCHITECTURE も GOTCHAS も無い → init で作成する」と読め、init が GOTCHAS も作ると誤解させる。文面を直すか否か | High | 最上位オーケストレーター | 挙動は設計通りで、文面だけが誤解を生んでいる |
| 2 | `README.md:25` の init 説明が rules3 の生成にも GOTCHAS 非生成にも触れていない。追記するか | Medium | 最上位オーケストレーター | 利用者向け説明の不足 |
| 3 | 設計書 §9-1 手順 6「GOTCHAS の台帳を初期化」の字面を実装に合わせるか(括弧書きは「作らない」と読める) | Low | 最上位オーケストレーター | 実装が正、字面が紛らわしいだけ |
| 4 | `tag-gotcha` は台帳未存在で `not_found` エラー、`append-gotcha` は自動生成という非対称。意図的か | Low | 最上位オーケストレーター | タグ付け対象が無い以上エラーが妥当で意図的 |
| 5 | 案2 採用後、codiel の `recording-gotchas` の「metatron が無い → 直接追記」経路を残すか削るか。削ると codiel 単体での失敗記録が失われ、README の「Codiel は単体で完結します」と衝突する | High | 最上位オーケストレーター | 単体動作の約束を優先して残す |
| 6 | ドメインマップを metatron へ寄せるか。寄せると codiel の write ゲート・implementer/reviewer 選択が metatron 必須になり、fail-closed の run が metatron 無しで起動不能になる | High | 最上位オーケストレーター | 消費者が codiel 側にあるため現状維持 |
| 7 | 4 プラグイン例外(`ARCHITECTURE.md:50`)は「言及」に係り、実装層の import 禁止(`:48`)には例外が無い。移管で codiel が metatron の生成物に機能依存する場合、どちらの規則で評価するか | Medium | 最上位オーケストレーター | 言及は例外内、機能依存は別問題として扱う |
| 8 | `plugins/codiel/src/hooks/__test__/lib.test.ts:7-9` が metatron の `src/` をテスト限定で import している。`:48` の「実装層」にテストが含まれるかは原文から判定不能 | Low | 最上位オーケストレーター | 3 者一致検証のための既知の例外 |
| 11 | 決定1: ドメイン定義の移管先に受け皿が無い。`raguel.config.yaml` の最上位は strip で黙殺、`.codiel/` は境界判定の対象外、`rules.<id>` は意味論が違ううえ `domains` が別用途で使用済み。どこへ置くか | High | 最上位オーケストレーター | schema.ts を改修して新設する以外に道が無い |
| 12 | 決定1: 任意ドメイン名に対応する implementer/reviewer が存在しない(3 種のみ)。移管とは独立の既存の穴だが、持ち主を変えるなら決着が要る | Medium | 最上位オーケストレーター | 4 値(frontend/backend/data/generic)に制限する |
| 13 | 決定2: `CLAUDE.example.md:25-27` が同じ三分岐を ARCHITECTURE と GOTCHAS の両方について持ち、対象プロジェクトへ配布される。ここも削るか | High | 最上位オーケストレーター | 同時に削る |
| 14 | 決定2: 「記録できないとき」の振る舞いが未定義。削ると単体環境で到達しうる。記録を諦めるか、run を止めるか、別の場所に残すか | High | 最上位オーケストレーター | 記録を諦めて続行し、その旨を報告する |
| 15 | 決定3: 実装方式で設計書 §7-6 との衝突が決まる。案 iii は「`append-gotcha` は承認不要」と正面衝突、案 i なら表に 1 行増えるだけ | High | 最上位オーケストレーター | 案 i を採る |
| 16 | 決定3: 雛形が完全固定のため「何を提示して承認させるか」が薄い。rules は書き換え前提の雛形なので前例としては半分しか効かない | Medium | 最上位オーケストレーター | パスと全文を提示して 1 回承認を得る |
| 17 | 決定3: 二段構え(stage/commit)にするか一発生成か。競合検知系が効く場面が乏しく、`gotchas.ts` に prepare 相当が無い | Medium | 最上位オーケストレーター | 一発生成にする |

## 8. テスト戦略・既存テスト

- `plugins/metatron/src/lib/__test__/gotchas.test.ts:127-145` (G1) 空台帳への追記で雛形ごと作成され `GOTCHA-001` が採番される。
- `plugins/metatron/src/cli/__test__/cli.test.ts:232` 「ARCHITECTURE も GOTCHAS も無い環境でも読み取り系は exit 0」。
- `plugins/codiel/src/__test__/install-harness.test.ts:44` 「GOTCHAS.md は作成しない」を明示的にアサート。
- `plugins/metatron/src/__test__/inject-context.test.ts:49-50` init 案内文の文面を固定。
- init 側に GOTCHAS 生成を期待するテストは存在しない。

## 9. 依存関係・リスク・制約

- `src/` を変更したら `pnpm run build` で `scripts/` を再生成し、同じコミットに差分を入れる規約がある。
- `harness-docs/GOTCHAS.md` と ARCHITECTURE は metatron の hook が直接編集を拒否する保護パス。
- 改修する場合は `plugin.json` と `package.json` のバージョンを揃えて上げる必要がある(現在 `0.2.0-dev`)。

## 10. 推奨アプローチ(高レベル)

**前提の変更**: as-is は設計通りだが、ユーザーは案2(init で GOTCHAS を生成する)を採用した。以下は案2を前提にした整理である。

1. CLI 実現方式は **案 i(新サブコマンド)が唯一きれいに成立する**。案 ii は hook が拒否、案 iii は意味論が歪む(§12)。
2. `inject-context.ts:110-112` の案内文は、案2 では**そのまま正しくなる**ので変更不要。実装が追いついたことの確認だけ要る。
3. README `:25` への追記と、`gotchas-format.md:14` の主語の是正が要る。
4. 設計書 `:1779-1782` は「学習機会の損失だから作らない」を非生成の論拠にしている。metatron だけ反転する理由の説明を書き足さないと、同一文書内で論拠が衝突する。
5. codiel 側は触らない判断が取りうる(§7 #5・#6)。触らなければ既存テストは 3 件とも修正不要。

## 11-2. 【確定】ドメインマップが無いときの codiel の挙動(一次確認済み)

**結論の事実: ドメインマップが読めないとき、書き込みは `ask` にならず素通し(pass)する。** ゲートそのものが無効化される。

読み取り不能の全ケースが `domains: null` に落ちる(`plugins/codiel/src/hooks/lib.ts`):
- ARCHITECTURE が無い → `:487`
- `metatron:domains` ブロックが無い → `:491`
- JSON パース失敗 → `:497`
- 値の形が契約 §1 を満たさない(非オブジェクト / キー 0 個 / 空配列 / 非文字列 glob)→ `validateDomainsValue`(`:451-463`)
- 例外 → `:500-501`

`toDomainMap(null)` は `null` を返し(`guard-write.ts:35`)、`if (domains)`(`:156`)が偽になって境界判定ブロックを丸ごと飛ばし、`:177` の `pass()` に落ちる。実装コメント `:155`「ドメイン定義が無い・読めない環境で新たに書き込みを止めるのは配線の目的ではない。」

**テストで固定されている**(`plugins/codiel/src/hooks/__test__/guard-write.test.ts`):
- `:308-316`「ドメインマップが読めない(ARCHITECTURE が無い)なら domain 設定があっても素通し」— `src/app/page.tsx` も `anywhere/x.ts` も `toBe(null)`(hook 無出力=素通し)。
- `:295-306`「ドメインマップに無い domain 名は ask」— **マップが在るのにドメイン名が無い場合だけ `ask`**。
- `:318-328`「generic 縮退(`**`)では domain generic はどのパスでも素通し」。

**ゲートが作動する前提条件(4 つすべてが必要)**:
1. アクティブな run がある(`guard-write.ts:104-105`。無ければ `pass()`)
2. フェーズが `CODE_PHASES`(`implement` / `test-loop` / `fix-loop`。`:22-26`)
3. `run.state.domain` が設定済み(`:134-136`。ドメイン別 implementer/reviewer へ委譲中のみ入る)
4. 書き込み先が `.codiel/` 配下でない(`:136`)

**解釈候補(判断はしない)**: ドメインマップを metatron へ移しても、metatron 非導入環境では `domains: null` となり、この write ゲートは**既存の設計どおり素通しへ縮退する**。つまり codiel の run は止まらず、失われるのは「ドメイン境界の助言的チェック」だけである。一方で `orchestrating-runs/SKILL.md:68-72` の §0 前提チェック(指示層)は依然として run を止める側なので、**コード層は縮退するが指示層はフェイルクローズド**という非対称が残る。移管の実害はこの指示層の側に出る。

### 11-2b. ドメイン消費の周辺事実(調査E)

- **発火条件**: codiel の `hooks/hooks.json` の PreToolUse matcher は `Bash`(guard-bash)と **`Edit|Write`**(guard-write)。metatron 側の `Edit|Write|NotebookEdit` とは異なり **NotebookEdit を含まない**。
- **ドメイン以外の判定入力**(`guard-write.ts`):`.codiel/runs/**/state.json` への書き込みは無条件 `deny`(`:79-83`)/ アクティブ run 無しは `pass()`(`:104-105`)/ `DOC_PHASES` はコード領域への書き込みを `ask`(`:108-115`)/ `CODE_PHASES` では `.codiel/specs/**/{spec,cases}.md` を `ask`(`:117-121`)/ どちらにも属さないフェーズ(pr・review・triage・finalize)は `.codiel/` 外を `ask`(`:179-181`)/ 予期しない例外は `ask`(`:182-187`、フェイルクローズド)。
- **読み出し元とパス解決**: ARCHITECTURE を `resolveDocPaths(startDir).architecture` で解決(`lib.ts:486`)。`findDocRoot`(`lib.ts:150-169`)が ① `metatron.config.json` を持つ最近傍祖先 → ② `git rev-parse --show-toplevel` → ③ 開始ディレクトリ の 3 段。設定ファイルが無いのは正常扱いで警告を出さない。既定は `docs/ARCHITECTURE.md`(`lib.ts:75`)。
- **ドメイン名の出どころ(指示層)**: `writing-dev-plans/SKILL.md:30-34` は ARCHITECTURE のドメインマップを**実際に読む**ことを明示(「ファイルがあれば必ず読む」「無ければスキップする」)。LLM の推論に委ねる記述は無い。タグ値はマップのキーそのもの(`:76-77`)。
- **ドメイン名 → エージェントの対応**: `orchestrating-runs/SKILL.md:195-205` の**スキル本文にハードコード**。設定ファイルにもエージェント定義側にも対応表は無い。`codiel-implementer-<ドメイン名>` という命名規則の一致に依存。generic 縮退時は implementer=`codiel-implementer-backend`、reviewer=doc+security+backend の 3 体(`:203-205`)。
- **【潜在的な穴】任意ドメイン名の行き先が無い**: `initializing-harness/SKILL.md:90`「ドメイン名は任意の文字列にする。`frontend` / `backend` は例であり固定語彙ではない。」と書かれているが、実在する implementer エージェントは `frontend` / `backend` / `data` の 3 種のみで、`generic` を含む 4 値以外をディスパッチ先へ対応付ける記述はどのスキルにも無い(調査E が grep で確認、情報なし)。**移管とは独立に現存する不整合**だが、ドメインの持ち主を設計し直すなら決着が要る。
- **`{"generic":["**"]}` を書く主体**: `/codiel:init`(`initializing-harness/SKILL.md:70-94`)。ユーザーへ AskUserQuestion でドメイン分割を聞き、分割が馴染まなければ縮退形へ組み立て、**全文提示と明示承認を経てから**書く(HARD-GATE `:175-176`)。実行時の自動フォールバックではない。`/codiel:run` 側がこの値を新規生成する記述は無い。

## 11-3. codiel 側の設定の受け皿(調査F)

- **`.codiel/` は状態と出力の専用領域**。`install-harness.sh:10` が作るのは `specs` / `runs` / `reports` の 3 つだけで、設定ファイルは無い。`guard-write.ts:126-133` は「`.codiel/` 配下はハーネス自身の運用資産で、どのドメインにも属さない」と明記し、ドメイン境界の対象外にしている。ここをドメイン定義の置き場にすると、境界を判定する主体が判定対象外領域に定義を置く形になる。
- **`raguel.config.yaml` はプロジェクトルート**に置かれ、`raguel-mcp/src/config/loader.ts` が `resolve(process.cwd(), "raguel.config.yaml")` で読む。
- **最上位スキーマは拡張の受け皿にならない**(一次確認済み): `schema.ts:75-85` の `configSchema` は素の `z.object()` で、`.strict()` も `.passthrough()` も無い。zod の既定は未知キーの **strip**(エラーにはならないが結果から黙って消える)。したがって `domains:` をトップレベルに足しても**エラーにならないまま無視される**。受け皿にするには `schema.ts` の改修が要る。
- **`rules.<ruleId>` 配下だけは拡張可能**: `ruleSettingsSchema = z.looseObject({...})`(`schema.ts:25-28`)、`rules: z.record(z.string(), ruleSettingsSchema)`(`:84`)。ただし意味論は「ルールのパラメータ」である。
- **名前の衝突**: `rules."plan/scope-keywords".domains` が既存で、意味は**キーワード文字列の配列**(`rules/plan/scopeKeywords.ts:39-41`)。パスの glob ではない。`code/protected-paths.globs` は**ドメインに紐付かない単一のフラット配列**(`rules/code/protectedPaths.ts:21-23`)。「ドメイン名 → glob 配列」というマップ構造を置ける既存の場所はスキーマ上に無い。
- **codiel が `metatron.config.json` から読むのは 2 つだけ**: `paths.architecture` と `paths.gotchas`(`src/hooks/lib.ts:299-323`)。ドメイン関連のキーは読まない。未知キーは無視しエラーにしない(`:298`)。ファイルが無いのは正常扱いで警告も出ない(`:264-272`)。
- **init の書き先は環境によらず不変**: `/metatron:init` が有る場合(a: metatron に任せる / b: 最小生成)も無い場合も、最終的に同一の「最小 ARCHITECTURE の生成」節(`initializing-harness/SKILL.md:70-98`)へ合流し、書き先は ARCHITECTURE の `metatron:domains` ブロックで分岐しない。分岐が変えるのは「誰がいつ書くか」だけである。
- **ドメイン分割と保護パスは聞き取りも書き先も分離済み**: ドメインは手順1 → ARCHITECTURE、保護パスは手順3 → `raguel.config.yaml` の `rules."code/protected-paths".globs`(`SKILL.md:109-118`)。

## 11-4. 決定2(GOTCHAS 直接追記フォールバック削除)の影響(調査G)

**削る対象は指定された 4 箇所より多い**(`plugins/codiel/skills/recording-gotchas/SKILL.md`、全 142 行を走査):

| 行 | 内容 |
|---|---|
| `:51-52` | 「案内があればそれを使い、**なければ直接追記する**」「直接追記が hook に拒否されたら…」 |
| `:54` | 「metatron のインストール有無を検出しない」 |
| `:56-60` | 三分岐の表(`:58` 案内喪失時、`:60` metatron 無し) |
| `:66` | 「**直接追記するとき**は、CLI を使わないだけで書式を同じにする」 |
| `:97-125` | 「台帳が無いとき」節と雛形本文。`:99`「初期化コマンドをユーザーへ案内して止めない」 |
| `:140-141` | Red Flags 2 行(「hook に拒否されたので記録できなかった」「台帳が無いので初期化を待つ」) |

**最重要の追随先**: `plugins/codiel/CLAUDE.example.md:25-27`(一次確認済み)は**同じ三分岐ロジックの複製**であり、しかも ARCHITECTURE と GOTCHAS の両方を対象に、**対象プロジェクトの CLAUDE.md へ書き込まれる雛形**として一般化されている。
> 「ARCHITECTURE / GOTCHAS を更新するときは、コンテキストに更新用 CLI の案内があればその CLI を経由する。**案内が無ければ直接編集する。**」「直接編集が hook に拒否されたときは、拒否メッセージに示された CLI で実行し直す。」

同ファイル `:31-33`(規則1)は全フェーズの作業前に ARCHITECTURE のドメインマップを確認せよと定めており、**ドメインマップ依存もこの雛形経由でユーザープロジェクトへ伝播している**。

**「記録できないとき」の規定は存在しない**(`記述なし`)。`:140` は「拒否されたら CLI で実行し直せ」という回復手順だけで、その回復も失敗した場合の扱いは無い。

**呼び出し元の既存の欠落**(決定2 とは独立): 4 契機のうち呼び出し元スキルに明示の起動手順があるのは STOP のみ(`raguel-gating/SKILL.md:118`)。ループ上限超過・`record_outcome(incident)`・設計漏れ発覚の 3 契機は、呼び出し元(`orchestrating-runs` / `raguel-gating` / `fixing-review-findings`)に起動手順が見当たらない。

**テストは落ちない**: `plugins/codiel/src/__test__/install-harness.test.ts:44-61` は `install-harness.sh` の挙動を固定するもので、記録時に誰が台帳を作るかには関与しない(無関係)。`section-reference-inventory.json` に `recording-gotchas` のエントリは 0 件で、当該 SKILL.md は本文に `ARCHITECTURE` の語を含まないため V2 / V3 にも掛からない。codiel 側の他の GOTCHAS 関連テストは存在しない。

**追随が要る文書**: `docs/DESIGN.md:395` と `:427-436` / `README.md:21` / `commands/init.md:2` / `scripts/install-harness.sh:5`(コメント)/ `skills/initializing-harness/SKILL.md:39` / **`harness-docs/design/2026-08-16-metatron-design.md:1741-1802`(三分岐を正面から設計根拠として記述。最大の食い違い)**。`harness-docs/design/2026-08-16-file-contract-freeze.md` §7-3(`:453-454`)は「台帳または節が無ければ雛形ごと作成する」を**凍結された契約**として持つため、誰が作るかを変えるなら契約との整合確認が要る。`.claude-plugin/marketplace.json` と `agents/*.md` は食い違いなし。

## 12. 案2 の実装ポイント(変更が要る箇所)

### 12.1 CLI 実現方式の成立可否

| 案 | 成立 | 根拠 |
|---|---|---|
| **i. 新サブコマンド**(例 `init-gotchas`)| **成立** | `renderGotchasTemplate()`(`src/lib/gotchas.ts:558-560`)は雛形テキストを返す純関数。`appendGotcha`(`:887-918`)の `withFileLock` → 書き込みパターンを踏襲できる。CLI 経由なので hook の対象外 |
| **ii. スキルが Write で書く** | **不成立** | `hooks/hooks.json:17` の matcher が `Edit\|Write\|NotebookEdit`。`guard-docs.ts:220,236,245` が GOTCHAS パスと厳密一致で `deny`。**ファイル未作成でも拒否される**(`:45-119` の `realpathOrParent` が親ディレクトリ経由で判定)。テストが固定: `src/__test__/guard-docs.test.ts:181`(D6 Write→deny)、`:216-239`(D7b dangling symlink=未作成でも deny) |
| **iii. `append-gotcha` にエントリ無しモード** | **成立するが歪む** | `buildAppendedText`(`:607-664`)は雛形作成後に必ず 1 件のエントリを挿入する(`:634-663`)。「雛形だけ」の分岐が無い。`validateGotchaInput`(`:471-524`)は `title`(`:475-476`)と `promotionCandidate`(`:495-501`)を必須にしている。緩和＋新分岐＋型変更が要り、「エントリ無しの append」という語義矛盾が実装に残る |

案 i を採る場合の変更点: `src/cli/main.ts:31`(READ)または `:33-41`(WRITE)への追加、`:87-121` の switch に case 追加、`src/cli/paths.ts:65-88` の `USAGE_LINES`、入力を取るなら `:36-63` の `INPUT_SCHEMAS`、実装関数(`src/cli/gotcha.ts` と同型)。

### 12.2 スキル・文書・設計書

| 対象 | 現状 | 要る変更 |
|---|---|---|
| `skills/capturing-architecture/SKILL.md:154` | 「GOTCHAS の台帳は初回生成では作らない」 | **必須の書き換え**(非生成の明文そのもの) |
| 同 `:59-71` | ドラフト 9 単位の表。GOTCHAS 無し | GOTCHAS を 10 番目にするか要判断。他 9 単位は「解析→ドラフト→対話確認」だが GOTCHAS は雛形固定で性質が違う |
| 同 `:93-98`, `:130-132` | stage/承認は「4 対象」(ARCHITECTURE 1 + rules 3) | 承認フローに載せるなら 5 対象へ。載せないなら据え置き |
| 同 `:158-167` HARD-GATE | GOTCHAS の項目なし。ADR は `:166` にある | 承認を課すなら 1 行追加 |
| `src/inject-context.ts:110-112` | 「ARCHITECTURE も GOTCHAS も無い → init で作成する」 | **変更不要**(案2 で記述が事実に追いつく) |
| `src/__test__/inject-context.test.ts:49-50` | 文面を全文一致で固定 | inject-context を変えないなら**変更不要** |
| `README.md:25` | init 説明。GOTCHAS にも rules にも触れない | **追記が要る** |
| `references/gotchas-format.md:14` | 「`append-gotcha` が雛形ごと作る。自前でファイルを作らない」 | 生成経路が増えるので主語の是正が要る |
| `skills/recording-gotchas/SKILL.md:51` | 「`not_created` は異常ではない」 | 手動削除時のフォールバックとしては案2後も真。要否は判断待ち |
| 設計書 `:1454`(§9-1 手順6)| 「GOTCHAS の台帳を初期化(空でよい。append-gotcha が必要時に作る)」 | 「空でよい」の限定を外す |
| 設計書 `:1955`(§12-2)| 「GOTCHAS が存在しない → append-gotcha が台帳ごと作る」 | フォールバックとしては真。「通常は init で作る」の注記が要る |
| 設計書 `:1779-1782` | 非生成の論拠(学習機会の損失)。**Codiel 単体環境の記述** | metatron だけ反転する理由の説明が要る |

### 12.4 決定3(GOTCHAS を init の承認フローに載せる)の材料(調査H + 一次確認)

**承認フローの構造**: 9 単位(ドラフト確定の粒度)と 4 対象(stage/承認の粒度)は別レイヤー。ARCHITECTURE の 6 節は 1 回の `stage-architecture` に束ねられ(`SKILL.md:97`)、rules は 1 ファイル 1 回で 3 回(`:98`)。計 4。GOTCHAS を足すなら 5 対象になり、HARD-GATE `:160` の「**4 対象を 1 回の承認でまとめない**」の文言も連動する。

**【重要】雛形固定を承認フローに載せる前例は既にある**: rules の 3 単位は `scan` の解析結果に依らず、`docs/RULES.example.md` の固定テンプレートを既定ドラフトとして提示する(`SKILL.md:73`)。それでも他の単位と同じ stage → diff 全文提示 → 個別承認 → commit を通り、「雛形固定なら承認を省く」例外規定は無い。**ただし性質差がある**: rules の雛形は「プロジェクトごとに書き換える前提」(`RULES.example.md:3`)なのに対し、GOTCHAS の `TEMPLATE_LINES`(`src/lib/gotchas.ts:530-555`)は補間も scan 由来の値も含まない**プロジェクト間で不変の定型文**で、書き換えを促す文言も無い。「何を提示して何を承認させるか」の中身が薄くなる。

**【H の主張を訂正】凍結契約は GOTCHAS の承認不要を定めていない**(一次確認済み):
- `harness-docs/design/2026-08-16-file-contract-freeze.md` の §7-6(`:494-500`)は「**記録の判断**」= 1 問の記録判断フローであり、承認には一切触れない。同文書で `承認` が出るのは `:672` の 1 箇所のみで、intent-issue 持ち込みモードの話であり GOTCHAS とは無関係。
- 「承認を要さない」の出典は**凍結契約ではなく設計書**である。`src/cli/gotcha.ts:1-4` の原文は「契約 §6・§11、設計書 §7-4」「どちらも承認を要さない追記操作である(**設計書** §7-6)」と、契約と設計書を書き分けている。
- 実体は `harness-docs/design/2026-08-16-metatron-design.md:1239-1249`「7-6. 承認が要るもの・要らないもの」の表。`append-gotcha` / `tag-gotcha` が**不要**、理由は「記録の契機は多くが失敗発生時(Codiel の run 中)であり、そこで人間の承認を待つと、自律実行を売りにしたフローが失敗のたびに止まる」(`:1244`)。
- **したがって決定3 は凍結契約の変更を要しない。** §7-6 が承認不要としているのは「run 中の失敗記録(`append-gotcha`)」であり、決定3 が承認を課したいのは「init 時の台帳生成」で、操作も契機も別である。
- **ただし実装方式で衝突の有無が変わる**: 案 i(新サブコマンド)なら §7-6 の表に行が 1 つ増えるだけで既存の「`append-gotcha` は承認不要」は保たれる。**案 iii(`append-gotcha` にエントリ無しモードを足す)を選ぶと、同一サブコマンドが承認要と不要の両方を持つことになり §7-6 の表と正面から衝突する。**

**GOTCHAS 側には stage 相当の下地が無い**: `append-gotcha` / `tag-gotcha` は staging を使わない直接書き込み(`withFileLock` → `fs.writeFileSync`、`gotchas.ts:903-917` / `:989-1004`)。`architecture.ts` の `prepareArchitectureUpdate` / `rules.ts` の `prepareRulesUpdate` に相当する「diff を返すが書かない」純関数が `gotchas.ts` に存在しない。二段構えにするならこれを新設する必要がある。`StagingKind`(`src/lib/staging.ts:33`)への `"gotchas"` 追加も要る(`isStagingKind` → `parseRecord` の検証に波及)。

**二段構えが担保しているもの**(GOTCHAS に要るかの判断材料): 検証成功後にしか `stagingId` を発行しない / diff を stage 時点で計算し返す / `recordHash` による改竄検知 / `already_used`・`expired`・`file_changed` の検出 / 消費の印を書き込み前に付ける。雛形生成は「固定文字列を新規ファイルへ書くだけ」で既存とのマージが無いため、これらのうち競合検知系が効く場面は乏しい。

**サブコマンド追加で触る箇所**: `main.ts:31`(READ)/ `:33-41`(WRITE)/ `:14-28`(import)/ `:87-121`(switch)、`paths.ts:36-63`(`INPUT_SCHEMAS`)/ `:65-88`(`USAGE_LINES`)、`cli.test.ts:197-214`(`READ_INVOCATIONS`。read 系のときのみ)。二段構えなら加えて `staging.ts:33`、新 `runStageXxx`(`stage.ts:309-419` が雛形)、新 `runCommitXxx` または `acceptedKinds` 拡張(`commit.ts:132-147`)。
**依頼範囲外だが追随が要るもの**: `src/guard-docs.ts:174-190`(`gotchasReason` の案内文言。現状 `append-gotcha` / `tag-gotcha` しか案内しない)、`src/inject-context.ts:81-87`(注入されるコマンド例。`:82` は `append-gotcha` の直書き行のみ)、`references/cli-usage.md`(`SKILL.md:16` が正本として参照)。
**機械的な網羅検査は無い**: `WRITE_SUBCOMMANDS` を走査して拒否シナリオの充足を検証するテストは存在しない(調査H が grep で 0 件)。追加漏れは目視レビュー頼み。

### 12.3 テストと追随

- **既存テストは 3 件とも修正不要**: `gotchas.test.ts:127-145`(G1)と `cli.test.ts:232`(S5)は `appendGotcha` 単体と読み取り系 exit 0 の検証で init を呼ばない。`plugins/codiel/src/__test__/install-harness.test.ts:44-61` は codiel のシェルスクリプトの検証。ただし codiel 側コメントの思想説明は metatron 反転後に食い違う。
- `docs/format-change-checklist.md:22-25` の GOTCHAS 節の追随先は 2 項目のみ(`file-contract-freeze.md` §7、codiel の `recording-gotchas/SKILL.md` の写し)。**同節は「書式」の変更を対象とし、案2 は「生成契機」の変更**なので該当するか要判断。
- ADR の基準は `references/architecture-format.md:95`「アーキテクチャ上の重要な設計判断」の一文のみ。閾値の記述は無い(情報なし)。

## 11. 補足・暗黙知の可能性が高いポイント

- GOTCHAS 非生成は「記録の契機は失敗発生時であり、そこで『初期化してください』と止めるのは学習機会の損失になる」という理由に基づく(設計書 `:1780-1781`、`plugins/codiel/skills/recording-gotchas/SKILL.md:141`)。
- 書式の正本は `harness-docs/design/2026-08-16-file-contract-freeze.md` §7。metatron は `references/gotchas-format.md` として独立コピーを持つが、codiel は独立ファイルを持たずスキル本文に雛形を埋め込む。ファイルをバイト列として書き出すコード実装は metatron 側にしか無く、codiel は「手順の指示」のみを持つ非対称構造である。
- 該当のスキル記述(`SKILL.md:154`)と CLI の生成フォールバックは、いずれも metatron 初出コミット `1e4508b` で同時に入っている。後付けの取り繕いではなく初期からの設計である。
- 本リポジトリ自身が `harness-docs/GOTCHAS.md` 未作成のまま運用されており、設計書 `2026-08-24-metatron-rules-expansion-design.md:356` がその状態を前提として引用している。git 履歴上、当該ファイルは一度も存在したことがない。
- `harness-docs/superpowers/` 配下には metatron 分離前の Codiel 時代の設計書が残り、`copy_if_absent` で GOTCHAS.md を作る旧方式を記述している。現行仕様と取り違えないこと。

---

**次のステップ提案**:

- 挙動は変えない前提で、§7 #1 と #2(案内文面と README)の是正可否をオーケストレーターが判断する。
- 特に確認してほしい Open Question: #1(SessionStart 案内文が誤解の発生源か)。

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に従い、本文は小さく蒸留された状態に保つ。API キー・トークン・パスワードなどの機密情報を記録しないこと。*
