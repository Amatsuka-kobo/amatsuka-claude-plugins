# ARCHITECTURE ドメインマップ依存の解消(codiel / sandalphon)引き継ぎ書

- 日付: 2026-09-15
- 引き継ぎ元: 調査・方針決定セッション(実装は未着手)
- 引き継ぎ先: 実装設計セッション(まず設計書と実装計画書を起こす)
- 対象プラグイン: `plugins/codiel`(0.6.0-dev)、`plugins/sandalphon`(0.1.2-dev)、影響確認のみ `plugins/metatron`(0.2.0-dev)

## 現在地

| 工程 | 状態 |
| --- | --- |
| 事実調査 | **完了**。消費者 5 系統を一次確認済み(§4)。本書の `path:line` は 2026-09-15 時点の実ファイルで検証済み |
| 方針決定 | **確定**。案G＋ を採用(§2)。ユーザー決定 4 件を反映(§2.3) |
| アドバイザー助言 | 3 名(claude / grok / gpt)完了。**結論が割れた**。割れた理由と採否は §3 |
| 設計書 | **未着手**。§6 の未解決事項を潰してから起こす |
| 実装計画書(WBS) | **未着手** |
| 実装 | **未着手** |

**この文書だけを読んで作業を再開できるように書いてある。** context-map や過去の会話記録を読み直す必要はない。

## 次セッションが最初にやること

1. `git status` と HEAD を確認する。作業ツリーに本件と無関係な未コミット変更がある。**触らない**(revert・削除・上書き・コミット混入すべて禁止)。
2. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` で baseline を再現する。
3. **§6 の未解決事項 5 件をユーザーと詰める。**ここが埋まらないと設計書を書けない(特に 6-1 は自動縮退の形を決める前提)。
4. §6 が埋まったら設計書 → 実装計画書の順に起こす。設計書は Haiku レビューを先に通す(プロジェクトの必須手順)。
5. 契約凍結文書への影響(§6-5)が「要る」と判定されたら、**実装を止めてユーザーに確認する**(`harness-docs/design/2026-08-16-file-contract-freeze.md:18` の規定)。

---

## 1. 作業の目的

`harness-docs/ARCHITECTURE.md` の `## ドメインマップ`(` ```json metatron:domains ` ブロック)に対する **codiel と sandalphon の必須依存を解消する**。

解消したい中身は 2 つある。

- **codiel が ARCHITECTURE を書く経路をなくす。**`/codiel:init` が最小 ARCHITECTURE を生成し、`CLAUDE.example.md` が対象プロジェクトへ「乖離したら ARCHITECTURE を更新せよ」を配布している。ARCHITECTURE は metatron の資産であり、codiel が作成・修復する立場にない。
- **ドメインマップが無いと run が始まらない状態をやめる。**`orchestrating-runs/SKILL.md:70-72` が `domains: null` を「ハーネス未初期化」と断定して run を終了させる。

**「読むな」ではない。**ユーザーの意向の核心は「codiel が ARCHITECTURE を**書く**な」である(確認済み)。有効なマップがあるときに読んで境界に使うことは、案G＋ でも維持する。

---

## 2. 確定した方針: 案G＋

### 2.1 採用する案

1. **ARCHITECTURE のドメインマップは metatron の構造記述として残す。codiel は作成・修復しない。**
2. **codiel はドメインマップなしでも汎用実行を提供する。**ただし「ドメイン別境界を設けないモード」であることを明示して選択・記録する。
3. **「マップを使わない」と「使うはずのマップを読めない」を分ける。後者を自動で前者に変えない。**
4. **任意ドメイン名でも担当者の選択が必ず決まるようにする。**専門担当がなければ汎用担当を使い、元のドメイン名と範囲は維持する。
5. **sandalphon の委譲判定からドメイン可読性を外す。**初期化の外形、利用可能コマンド、実行先での最終検証を分ける。

### 2.2 開始判断の表(案G＋の中核)

| 状態 | 判断 |
|---|---|
| 初期化済み・マップ未設定・汎用実行を選択済み | 通す。metatron の導入を要求しない |
| 初期化済み・マップ未設定・汎用実行の選択が不明 | 境界なしで実行することを確認してから通す。恒久ファイルの生成はしない |
| 有効なマップがある | 対応する担当範囲で通す。ただし任意キーのルーティングを解決できることが必要 |
| 配置されたマップが不正、またはマップ利用中の run で消失 | 一旦止めて確認する。修復、または明示的な汎用モードへの切替・再計画を選ぶ |
| ハーネスの初期化が途中、必要な実行基盤が利用不可 | 止める。ARCHITECTURE の欠落とは別の理由を示す |

**これは「ドメインがなくても構わない」であって、「必要な前提を取得できなかったら全部既定値にする」ではない。**この区別が案G と案G＋ を分ける唯一の点であり、次セッションが最も踏み外しやすいところである(理由は §3.3)。

### 2.3 ユーザーが確定させた前提(再議論しない)

1. **「codiel が ARCHITECTURE を書くな」が意向の核心。**「読むな」ではない。
2. **codiel は dev ステータスであり、実利用者はゼロとみなす。**移行パスの実装は不要。ただし契約変更のユーザー確認は不要にならない。
3. **metatron 不在でも利用者が独自の複数ドメイン境界を設定できることは、必須要件ではない。**← これが案A ではなく案G＋ を採る決め手。
4. **codiel には大規模な設計変更が予定されている。**ユーザーの言葉:

   > implementer・planner・reviewer・architect などの Agents を削除し、Codiel 内部でしか使わないような専門的な Agents のみを残すようにし、現在 Agents 定義としている指示文を Skills に変えてサブエージェントに読ませる方式に変更します。これには agent-policy との併用強化を行うという目的があります。

   この将来設計との関係は §8。

---

## 3. 却下された案と、その却下理由

**次セッションが同じ案を再提案しないために残す。**

### 3.1 案A: 正本を `.codiel/config.json` へ移す(claude 推奨・却下)

- 内容: `{ version: 1, domains: { "<name>": ["<glob>"] } }` を新設し、codiel と sandalphon の両方から `metatron:domains` 読み取り実装を削除する。glob の基準を docRoot から codielRoot へ切り替える。sandalphon は `codielReady` の入力を `.codiel/config.json` の可読性に差し替える。「ドメイン名 → スキル名」の対応は持たせない。
- claude の根拠: 将来設計後も write ゲートは残り、その構造は「名前 → glob 配列」で変わらないので手戻りしない。codiel が Markdown フェンスの状態機械(`plugins/codiel/src/hooks/lib.ts:347-511`)を捨てられる。契約 §1 の 3 実装が metatron 単独に縮む。座標系が 1 つになる。
- **却下理由**: ユーザーが「独自ドメイン境界の設定は必須要件ではない」と判断した(§2.3-3)ため、新しい恒久設定・契約・ルート探索・自己変更保護を導入する必要が消えた。**claude の前提の 1 つは 2 名から否定されている**(§3.4-1)。

### 3.2 受け皿候補として検討し不成立だった案(B / C / D)

> 注記: A のラベルはブリーフで明示されている。B〜D のラベルは、調査時に列挙された受け皿候補への割り当てを再構成したものである。**ラベルの対応よりも内容と却下理由が重要**であり、次セッションは内容で照合すること。

| 案 | 内容 | 却下理由(一次確認済み) |
|---|---|---|
| B | `raguel.config.yaml` の**最上位**に `domains:` を置く | **不成立。**`plugins/codiel/raguel-mcp/src/config/schema.ts:75-85` の `configSchema` は素の `z.object()` で `.strict()` も `.passthrough()` も無い。zod の既定は未知キーの **strip**。エラーも出ず結果から黙って消える。**3 名一致で不成立** |
| C | `raguel.config.yaml` の `rules.<ruleId>` 配下に置く | 意味論が「ルールのパラメータ」であり構造記述ではない。さらに `rules."plan/scope-keywords".domains` が既存で、意味は**キーワード文字列の配列**(`plugins/codiel/raguel-mcp/src/rules/plan/scopeKeywords.ts:39-41`)。名前が衝突する |
| D | ドメインマップを metatron へ完全に寄せ、codiel を metatron 必須にする | codiel の write ゲート・implementer/reviewer 選択が metatron 必須になり、metatron 無しでは run が起動不能になる。`plugins/codiel/README.md:21`「Codiel は単体で完結します」と正面衝突する |

### 3.3 案G(grok 推奨・部分採用、ただし核心部を修正)

- 内容: 正本を動かさない。`/codiel:init` が ARCHITECTURE を書くのをやめ、`orchestrating-runs` §0 が domains 不在時に in-memory で generic 縮退する。契約凍結 §1 は触らない。
- grok の根拠: `{"generic":["**"]}` は既に第一級の運用モード。「ドメインが無い」を「未初期化」ではなく「generic」と読めば新ファイルは不要。保護パスの先例(正本は消費者が持つ)をドメインマップに転用するのは範疇の誤り — 保護パスは Raguel 単一消費だが、ドメインマップは複数解釈を持つよう `harness-docs/design/2026-08-16-metatron-design.md:560-572` でわざと汎用化された。
- **採用された部分**: 「正本を動かさない」「writer だけ止める」。
- **修正された部分(重要)**: **`domains: null` の一括 generic 縮退は採らない。**理由は次の gpt の指摘。

### 3.4 案G＋(gpt 推奨・採用)

案G の方向は妥当だが、そのままでは不十分。gpt の決定的な指摘 2 点:

1. **`domains: null` は複数の異なる状態の混合である。**`plugins/codiel/src/hooks/lib.ts:484-503` の `readDomainsResult` は、ARCHITECTURE 不在(`:487`)・ブロック不在(`:491`)・JSON パース失敗(`:497`)・形式不正(`validateDomainsValue`、`:451-463`)・例外(`:500-501`)のすべてを `domains: null` に落とす。そして **`:487` と `:500-501` は `warnings: []` を返す**(警告が空)。したがって「warnings を表示して generic にすれば安全」はこの戻り値では成立しない。「明示された generic」(init で聞き取りと承認を経た有効な宣言)と「null」は同じではない。
2. **コード層の素通しは、run 開始を許してよいことの根拠にならない。**`plugins/codiel/docs/DESIGN.md:385` と `harness-docs/design/2026-08-16-metatron-design.md:571-574` が、hook の条件付き境界判定と run の開始条件を**別々に**定めている。この非対称は事故ではなく設計である(§4.2)。

さらに gpt の運用上の指摘:

- **停止条件の削除は、代替の実行規則を導入した結果として行う。それ自体を独立した修正にしない。**`plugins/codiel/skills/writing-dev-plans/SKILL.md:30-37,76-86` はマップを読んで分類し単一ドメインのステップへ分割するが、**マップ不在時の分類方法が定義されていない**。停止条件だけ外すと、planner が分類規則を持たないまま走る。

### 3.5 2 名以上が独立に一致した点(信頼度が高い。覆すには新証拠が要る)

1. **「Agents → Skills でも消費責務は自動では減らない」**(grok と gpt が独立に指摘)。削除されるのは担当者定義の**置き場所**であって、計画の分割・実装範囲の指定・レビュー観点の選択・write ゲートという**責務**ではない。**claude の「消費者が 3 系統のうち 2 つ消える」という前提は 2 名から否定された。**
2. **「ドメイン名 → スキル名」の対応をドメイン定義に持たせない**(claude と gpt が一致)。本リポジトリ自身の ARCHITECTURE(`harness-docs/ARCHITECTURE.md:93-101`)は `impl`/`prompt`/`bundle`/`manifest`/`docs` の 5 ドメインであり、`frontend`/`backend`/`data` のどれでもない。持たせると既存の穴を新しい形で再生産する。
3. **`raguel.config.yaml` 最上位は受け皿にならない**(3 名一致。根拠は §3.2 案B)。
4. **既存の穴(ドメイン名は任意なのに行き先が 3 値固定)は要対処**(grok と gpt が一致)。gpt は「移管より先、または前提チェック変更と同じ一貫した変更単位で塞ぐべき。将来設計まで放置しない」とする。
5. **ADR は今切る。将来設計とは別の ADR にする**(3 名一致)。

---

## 4. 現状の事実(再調査不要。すべて 2026-09-15 に一次確認済み)

### 4.1 ドメインマップの消費者

| # | 消費者 | 出典 | 挙動 |
|---|---|---|---|
| 1 | codiel: write ゲート | `plugins/codiel/src/hooks/guard-write.ts:153-174` | ドメイン未登録なら `ask`(`:159-166`)、glob 範囲外なら `ask`(`:167-174`)。**ただし `:156` の `if (domains)` により、定義が読めなければ境界判定ブロックを丸ごと飛ばして `:177` の `pass()` に落ちる** |
| 2 | codiel: planner の分類 | `plugins/codiel/skills/writing-dev-plans/SKILL.md:30-37`(マップを読む)、`:76-77`(タグ値はマップのキー)、`:81-86`(未分類ファイルの扱い) | 「ファイルがあれば必ず読む」「無ければスキップする」。**マップ不在時の分類規則は無い** |
| 3 | codiel: implementer ディスパッチ | `plugins/codiel/skills/orchestrating-runs/SKILL.md:195-205` | **対応表はスキル本文にハードコード。**設定ファイルにもエージェント定義側にも対応表は無い。`codiel-implementer-<ドメイン名>` の命名規則一致に依存 |
| 4 | codiel: reviewer 選択参加 | `plugins/codiel/skills/orchestrating-runs/SKILL.md:198-202`、`plugins/codiel/agents/codiel-reviewer-{frontend,backend,data}.md:3` | diff が触れたドメインで選択参加。`-doc` / `-security` は常時参加 |
| 5 | sandalphon: 委譲判定 | `plugins/sandalphon/src/check-intent-env.ts:514-543`(`readDomains`)、`:594`(`codielReady = codielDirExists && domains.domainsReadable`)、`:795-799`(出力) | 消費側は `plugins/sandalphon/skills/bridging-execution/SKILL.md:39,48,51-53` と `plugins/sandalphon/references/sandalphon-common.md:42` |
| 6 | metatron 自身 | `plugins/metatron/src/lib/scan.ts:1558`(`diffDomains` 定義)・`:1648`(呼び出し)、`plugins/metatron/src/cli/get.ts:206-238`、`plugins/metatron/skills/capturing-architecture/SKILL.md:67,88,90,114` | **この系統は残す。**metatron の構造記述としての正当な消費 |

**ブリーフの表は 5 系統だったが、実際には指示層の面がもう 1 つある。**`plugins/codiel/skills/implementing/SKILL.md:16,34,37,93` が implementer 本人にドメイン glob を読ませている(`:37`「ARCHITECTURE の `## ドメインマップ` を読む」、`:93`「自分のドメインに割り当てられた glob」)。**作業単位の数え漏れに注意**(§5 の表に含めてある)。

### 4.2 指示層はフェイルクローズド、コード層は縮退(この非対称は設計である)

- 指示層: `plugins/codiel/skills/orchestrating-runs/SKILL.md:68-72`。`domains` が `null` または形式不正なら「ハーネスが未初期化である」と断定し、`/codiel:init` を案内して **run をここで終了する**。
- コード層: `plugins/codiel/src/hooks/guard-write.ts:155-156` の実装コメント原文 —「ドメイン定義が無い・読めない環境で新たに書き込みを止めるのは配線の目的ではない。」
- **テストで固定されている**: `plugins/codiel/src/hooks/__test__/guard-write.test.ts:308-316`「ドメインマップが読めない(ARCHITECTURE が無い)なら domain 設定があっても素通し」— `src/app/page.tsx` も `anywhere/x.ts` も `toBe(null)`(hook 無出力 = 素通し)。`:295-306` は「マップが在るのにドメイン名が無い場合だけ `ask`」、`:318-328` は「generic 縮退では domain generic はどのパスでも素通し」。
- **根拠**: `plugins/codiel/docs/DESIGN.md:385`(hook は「`domain` が無いとき・ドメインマップが読めないときは境界を課さない」)と `harness-docs/design/2026-08-16-metatron-design.md:571-574`(「metatron はデータの意味を写像までしか定義せず、強制力を与えない。『読めなければ run を止める』というフェイルクローズドは Codiel 側の解釈として存続する」)。

**移管の実害は指示層の側に出る。**コード層は既に縮退設計になっている。

### 4.3 write ゲートが作動する前提条件(4 つすべて必要)

1. アクティブな run がある(`guard-write.ts:104-105`。無ければ `pass()`)
2. フェーズが `CODE_PHASES`(`implement` / `test-loop` / `fix-loop`)
3. `run.state.domain` が設定済み(`:134-136`。ドメイン別 implementer/reviewer へ委譲中のみ入る。`set-domain` / `clear-domain` は `orchestrating-runs/SKILL.md:207-214`)
4. 書き込み先が `.codiel/` 配下でない(`:136`)

### 4.4 `/codiel:init` の現状(writer を止める対象)

- ドメイン分割を AskUserQuestion で聞く: `plugins/codiel/skills/initializing-harness/SKILL.md:72`「**ドメイン分割だけ**を聞く」。
- 全文提示と明示承認を経て書く: `:74-75`、HARD-GATE `:175-176`。
- `{"generic":["**"]}` への縮退も同じ経路: `:91`。**実行時の自動フォールバックではない。**
- **HARD-GATE `:180-181` の原文**:「**聞いた内容をコードベースの解析結果で置き換えない**。ドメインマップと保護パスはユーザーの回答からのみ生成する。不明ならユーザーに聞く。」→ **ドメインを init で聞かなくなると、この HARD-GATE の文面更新が要る。**
- 現状調査は 4 点(`:30-36`): A=ARCHITECTURE / B=`CLAUDE.md` / C=`raguel.config.yaml` / D=`.codiel/` の 3 ディレクトリ。`:39`「GOTCHAS は確認対象に含めない」。
- 検証は `:129-150`(hooks・オーケストレーターと同一の解析系 `readDomainsResult` で読めることを確認)、完了報告は `:152-161`。
- 修復の例外 `:163-172`: JSON 不正時にユーザー承認を得て該当ブロックのみ置換する。**これが「codiel が ARCHITECTURE を修復する」経路であり、案G＋ 1 で消える対象。**

### 4.5 対象プロジェクトへ配布される依存(見落とし注意)

`plugins/codiel/CLAUDE.example.md` は `/codiel:init` が**対象プロジェクトの CLAUDE.md へ書き込む雛形**である(`initializing-harness/SKILL.md:120-127`)。ここに 2 つの依存が埋まっている。

- `:31-33`(規則 1): 「すべてのフェーズ(init〜finalize)の作業開始前に、**ARCHITECTURE のドメインマップを確認し**」
- `:46-49`(規則 5): 「実装の過程でドメインマップが ARCHITECTURE の記述と食い違っていることに気づいたら、**その場で ARCHITECTURE を更新する**。更新せず気づかないふりをして進めた場合、後で発覚した際に GOTCHAS へ記録される対象になる。」

**規則 5 は「codiel が ARCHITECTURE を書く」を対象プロジェクトの常駐ルールとして配布している。**案G＋ 1 と正面から衝突するので、必ず作業単位に含めること。なお `CLAUDE.example.md:11` は「7 項目は DESIGN.md §9 に定義された規則そのまま」としているため、`plugins/codiel/docs/DESIGN.md` 側の追随も要る。

### 4.6 契約凍結文書

- 正本: `harness-docs/design/2026-08-16-file-contract-freeze.md` §1(`:22-86`)。マーカー名 `metatron:domains`、データ形式、検証 4 項目(`:77-86`)。
- `:18` の規定:「本書の内容を変更する必要が生じたときは、**実装を止めてユーザーに確認する**。」
- **gpt の指摘(確認済み)**: `:64-75` が「例外(PreToolUse hook の限界)」として、警告の到達経路 3 つを列挙し、その 1 つに **`:70`「skills の検証コマンド(codiel `initializing-harness` の手順 5、`orchestrating-runs` の §0)」を名指ししている。**案G＋ で §0 と init 手順 5 を作り替えるなら、**契約文書に一切触れないとは言い切れない。**§6-5 で判定すること。
- `:53-54` は既に「ドメイン名は任意の文字列。`frontend` / `backend` / `data` は例であり固定語彙ではない」「分割が馴染まないプロジェクトは `{ "generic": ["**"] }` に縮退させる」と定めている。**契約側は任意キーを許しており、穴は消費側にある**(§4.7)。

### 4.7 既存の穴: 任意ドメイン名の行き先が無い

- 契約(`file-contract-freeze.md:53`)と init(`initializing-harness/SKILL.md:90`)は**ドメイン名を任意の文字列と定める**。
- しかし実在する implementer は `frontend` / `backend` / `data` の 3 種のみ。`orchestrating-runs/SKILL.md:197-205` の対応表は `frontend`/`backend`/`data` + `generic` の 4 値しか扱わない。
- **本リポジトリ自身の ARCHITECTURE がこの穴に落ちている**: `harness-docs/ARCHITECTURE.md:93-101` のキーは `impl` / `prompt` / `bundle` / `manifest` / `docs`。`/codiel:run` をこのリポジトリで回すと、planner が付けるタグに対応する implementer が存在しない。
- 最小の対処: 「専門対応がないドメインを汎用担当へ送る。ただしドメインタグと glob は維持する」。**ただし `plugins/codiel/agents/codiel-implementer-backend.md:15-17` は「`[domain: backend]` タグのみ」「縮退モードでは `[domain: generic]` タグのみ」「他ドメインのステップには着手しない」という規律を持つため、その規律も合わせる必要がある**(`-frontend.md:15-17` / `-data.md:15-17` も同型)。

### 4.8 登録簿とテスト

- `plugins/metatron/src/fixtures/section-reference-inventory.json` の分類 **B は 12 件で、すべて codiel**。内訳(すべて `reference: "ドメインマップ"`):

  `CLAUDE.example.md` / `agents/codiel-implementer-{backend,data,frontend}.md` / `agents/codiel-reviewer-doc.md` / `commands/init.md` / `skills/implementing/SKILL.md` / `skills/initializing-harness/SKILL.md` / `skills/orchestrating-runs/SKILL.md` / `skills/preparing-design-agendas/SKILL.md` / `skills/writing-design-docs/SKILL.md` / `skills/writing-dev-plans/SKILL.md`

- `plugins/metatron/src/__test__/section-reference-inventory.test.ts` が V1/V2/V3 を固定する。V1 は分類 A がゼロであること、V2 は未登録参照で落ちる、V3 は登録済みなのに実体が無いと落ちる。
- **したがって、上記 12 ファイルからドメインマップ参照を消すと V3 が落ちる。**登録簿の更新を同じ変更単位に入れること。

### 4.9 その他の一次確認済みの事実

- **Raguel の設定解決**: `plugins/codiel/raguel-mcp/src/config/loader.ts:49-61` が `RAGUEL_CONFIG` 環境変数 → **MCP プロセスの cwd** → 内蔵 defaults の順。**ローカルに `raguel.config.yaml` が存在することは、実際にその設定が使われている証明にならない**(MCP プロセスの cwd 次第)。
- **`globToRegExp`**: `plugins/codiel/src/hooks/lib.ts:42-56`。`**` は `.*` になる。全体は `^...$` でアンカーされるが、`.*` は `../` にも一致するため、**`generic` の `**` は親方向の相対パスをそれ自体では排除しない**(§7-6)。
- **`plugins/sandalphon/docs/rationale.md` は実在する**(§9 参照)。`:51-68` に `codielReady` を複合条件にした理由が書かれている。

---

## 5. 次セッションでやること(案G＋の実装範囲)

**まだ WBS ではない。**§6 の未解決事項が埋まってから設計書 → 実装計画書に展開する。以下は追随先の棚卸しである。

| # | 作業単位 | 対象 | 案G＋ のどの項目か |
|---|---|---|---|
| W1 | init から ARCHITECTURE の生成・修復を外す | `skills/initializing-harness/SKILL.md:42-98`(手順 1 全体)、`:163-172`(修復の例外)、`:19`(チェックリスト)、`:30-32`(現状調査 A)、`:129-150`(手順 5 検証)、`:152-161`(完了報告)、HARD-GATE `:180-181`、Red Flags `:188,193` | 1 |
| W2 | run §0 の停止条件を実行モードの決定に置き換える | `skills/orchestrating-runs/SKILL.md:52-78`(特に `:68-72`) | 2・3 |
| W3 | ディスパッチプロンプトへ実行モードを明示入力として渡す | `skills/orchestrating-runs/SKILL.md:190`(パス埋め込み)、§3 のプロンプト本体 | §5 の設計上の注意 |
| W4 | ドメイン設定・解除と再開処理をモード対応にする | `skills/orchestrating-runs/SKILL.md:207-214`、再開手順(`:79-89` 周辺)、`plugins/codiel/src/hooks/guard-write.ts:134-176` | 3・§7-1 |
| W5 | planner の入力と分類規則(マップ不在時の分類方法を定義) | `skills/writing-dev-plans/SKILL.md:30-37`、`:76-77`、`:81-86`(未分類ファイル規則) | 4・§3.4 |
| W6 | implementer / reviewer の汎用条件 | `skills/implementing/SKILL.md:16,34,37,93`、`agents/codiel-implementer-{backend,frontend,data}.md:15-17,20-21`、`agents/codiel-reviewer-{backend,frontend,data}.md:3,26`、`agents/codiel-reviewer-doc.md:25` | 4 |
| W7 | 任意ドメイン名 → 汎用担当のルーティング規則 | `skills/orchestrating-runs/SKILL.md:195-205`(対応表)、W6 の各 agent 定義 | 4・§4.7 |
| W8 | 常駐用運用ルールから ARCHITECTURE 書き込み指示を外す | **`CLAUDE.example.md:25-27,31-33,46-49`**、`docs/DESIGN.md` §9(`:389-396` 周辺) | 1・§4.5 |
| W9 | sandalphon の `codielReady` の意味を変える | `plugins/sandalphon/src/check-intent-env.ts:594,795-799`、`skills/bridging-execution/SKILL.md:39,48,51-53`、`references/sandalphon-common.md:41-42`、`docs/rationale.md:51-68` | 5 |
| W10 | 節名参照の登録簿を追随させる | `plugins/metatron/src/fixtures/section-reference-inventory.json`(分類 B 12 件)、`src/__test__/section-reference-inventory.test.ts` | §4.8 |
| W11 | README・コマンド説明の追随 | `plugins/codiel/README.md:21-24`、`plugins/codiel/commands/init.md:2`、ルート `README.md` | 規約「Done の条件」 |
| W12 | ADR を切る | `harness-docs/ARCHITECTURE.md` の `## ADR 一覧`。タイトルは `[codiel] <タイトル>` の形。**将来設計とは別の ADR にする**(3 名一致) | §3.5-5 |
| W13 | 契約凍結文書の追随判定 | `harness-docs/design/2026-08-16-file-contract-freeze.md:64-75` | §6-5 |

**`plugins/sandalphon/skills/capturing-intent/SKILL.md:81` は消さない。**ここは `domainsReadable` が true のときだけ ASIS 探索を絞り込む**任意参照**であり、本文自身が「ドメインマップが無い環境でも探索は成立するため、これは強化であって前提ではない」と明記している。**「必須依存の解消」と「任意参照の全廃」は別である。**

### 設計上の最重要注意(gpt の指摘)

**オーケストレーターだけが in-memory generic を知り、planner は ARCHITECTURE を読み直す設計にしてはいけない。**

実行に使うモード・マップは、**明示した入力として渡す**。読み物としての ARCHITECTURE と区別する。現状 `writing-dev-plans/SKILL.md:30-32` は「ディスパッチプロンプトで指定された ARCHITECTURE を読む」「ファイルがあれば必ず読む」であり、**ファイルを読ませる形**になっている。ここを「渡されたモードとマップを使う」形へ変えないと、§7-2 の三重状態が発生する。

### Done の条件(プロジェクト規約より)

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
- `plugins/*/src/` を変更したなら `pnpm run build` を実行し、`plugins/*/scripts/` の差分が同じコミットにある(**W9 は `src/` を触るので該当**)。
- 改修したプラグインの `plugin.json` と `package.json` のバージョンが揃って上がっている(codiel 0.6.0-dev / sandalphon 0.1.2-dev から)。
- ルートの `README.md` に反映されている。
- ARCHITECTURE に影響する変更をしたなら `/metatron:update` で追随させている。
- 指示書(SKILL.md / agents / references / CLAUDE.example.md)の文面確定は `prompt-smith:prompt-smith` を起動して行う(規約)。

---

## 6. 未解決事項(次セッションが最初に判断すべきこと)

### 6-1. ドメイン未設定を汎用モードとする確認を、いつ取るか

**自動縮退の形を決める前に必要。**選択肢:

- (a) init で一度確認し、結果を記録する
- (b) 各 run の開始時に確認する
- (c) 承認済みの運用方針として固定し、都度確認しない

§2.2 の表は「汎用実行の選択が不明」なら「境界なしで実行することを確認してから通す。**恒久ファイルの生成はしない**」としている。(a) は「記録」が恒久ファイルを意味するなら表と衝突しうる。**表の意図(恒久ファイルを作らない)と、§7-1 の再開問題(in-memory のみでは再開を扱えない)の両立が論点。**

### 6-2. 「未初期化」の判定基準

gpt の見解:「現行の init 手順を保つなら**両方**(`.codiel/` と `raguel.config.yaml`)を見る。ただしディレクトリとファイルの存在だけでは足りず、運用ルールと設定の妥当性も見る。」

出典: `initializing-harness/SKILL.md:28-39`(現状調査の 4 点 A〜D)、`:100-150`(手順 2〜5)。**A(ARCHITECTURE)を外したあと、B/C/D で何を「初期化済み」とするかを決める。**

### 6-3. sandalphon の `codielReady` の扱い

gpt は **(c) を推奨**: 環境スクリプトは**事実を返す**。`ready` ではなく `detected` / `handoffCandidate` 相当の意味にする。実行可否は codiel の preflight が決める。

- 現状: `check-intent-env.ts:594` で `codielReady = codielDirExists && domains.domainsReadable`。
- 消費側: `bridging-execution/SKILL.md:48`「委譲を選択肢に出すのは `codielReady` が true のときだけ」、`:51-53` が `domainsReadable: false` の案内先を分岐、`sandalphon-common.md:42` が同じ分岐を持つ。
- **`docs/rationale.md:51-68` は「複合条件にした理由」を正面から論じている。**変更するならここも追随が要る(`:56-60` の論拠「選ばせた選択肢が必ず失敗するのは、選択肢を出さないことより体験として悪い」は、codiel が汎用モードで通るようになれば前提が崩れる)。
- `capturing-intent/SKILL.md:81` は任意参照なので消さない(§5)。

### 6-4. 既存の穴(§4.7)をいつ塞ぐか

gpt は「移管より先、または**同じ一貫した変更単位で**」とする。放置して将来設計へ送らない。W7 と W6 の順序・粒度の問題。

### 6-5. 契約凍結文書への影響範囲

`file-contract-freeze.md:64-75` が警告の到達先として `initializing-harness` 手順 5 と `orchestrating-runs` §0 を名指ししている(§4.6)。**W1・W2 でこの 2 つを作り替えるなら、契約側の記述が事実と食い違う。**

- 追随が要るかを確認する。
- **要るなら `:18` に従い、実装を止めてユーザーに確認する。**

---

## 7. 見落とされているリスク(gpt 指摘の 8 点。全文)

1. **run 中・再開時のモード変化。**最初はマップなしで汎用実行し、後から有効なマップが出現すると hook が再読して `generic` 未登録の `ask` を返しうる。逆にマップ消失で境界が消える。実行モードを記録し、途中の出現・消失を暗黙のモード変更にしないこと。**in-memory のみでは再開を扱えない。**(→ 6-1 と直結)

2. **指示と hook の入力が別物になる三重状態。**planner が文書から再分類し、オーケストレーターが仮想 generic を使い、hook が実ファイルを読む、という状態を作らない。

3. **未分類ファイルの既存矛盾。**`writing-dev-plans/SKILL.md:81-86` の「どの glob にも当たらない共有コードを利用側のドメインへ入れる」規則は、`guard-write.ts:167-174` の範囲外 `ask` と衝突する(タグは付くが glob には一致しないため ask になる)。どのドメインにも属さないパスの承認・再計画方針が要る。

4. **A を将来採る場合の設定自己変更。**`guard-write.ts:126-136` は `.codiel/` 配下をドメイン境界から免除する。そこへ境界設定を置くなら、作業者が境界自体を変更できないよう別の保護が要る。

5. **ルート変更は独立した破壊的変更。**docRoot → codielRoot の切替は同じ glob の意味を変える(`guard-write.ts:137-151` のコメントが 2 つの座標系の食い違いを詳述している)。**案G＋ ではこの変更を混ぜない。**

6. **`generic` はプロジェクト外への隔離を保証しない。**`globToRegExp`(`lib.ts:42-56`)では `**` が `.*` になり、**親方向の相対パスをそれ自体では排除しない**。「全プロジェクト内で自由」という説明と実際のパス安全性を同一視しないこと。

7. **GOTCHAS の所有権は別途残る。**`plugins/codiel/skills/recording-gotchas/SKILL.md:49-60` が metatron 不在時の直接追記を指示している(`:60`「metatron が無い | 直接追記する(拒否は起きない)」)。**ただしこれは別改修で対応中**であり、本件のスコープ外。
   - 設計書: `harness-docs/design/2026-09-15-metatron-init-gotchas-design.md`
   - 実装計画書: `harness-docs/plans/2026-09-15-metatron-init-gotchas-plan.md`
   - **本件と同じファイル(`recording-gotchas/SKILL.md`、`CLAUDE.example.md`)を触る可能性があるため、着手順とコンフリクトに注意する。**

8. **文書レビューによる間接的な書き込み要求。**ARCHITECTURE 更新漏れを「修正必須の所見」にすると、実装担当が更新へ戻ってしまう。codiel は**乖離を報告し、所有者による更新へ引き渡す**規律に合わせること。
   - 該当箇所: `plugins/codiel/agents/codiel-reviewer-doc.md:25`「ARCHITECTURE のドメインマップと実装が乖離していないことを確認する」、`CLAUDE.example.md:46-49`(規則 5)。

---

## 8. 将来設計(Agents → Skills)との関係

- **ドメインマップの消費責務は Agents 削除では自動的に減らない**(grok と gpt が独立に指摘。§3.5-1)。
- gpt の提案する責務分担 — **3 つに分ける**:

  | 層 | 内容 | 持ち主 |
  |---|---|---|
  | 構造マップ | どのファイルがどの関心事に属するか | metatron の文書資産 |
  | 実行範囲 | この作業でどこを担当するか | codiel の実行上の宣言 |
  | 担当者と専門指示 | 誰にどの技能で作業させるか | codiel の手順と外部担当割当の接続面 |

- 対応規則が必要になるとしても「ドメイン名 → スキル名」の**一対一とは限らない**。実装とレビューで必要なスキルが違い、レビューには常時参加の観点もある(`codiel-reviewer-doc` / `-security` は `orchestrating-runs/SKILL.md:202` で常時参加)。「**フェーズ／役割 × ドメイン → スキル集合＋既定担当**」として考える方が自然。
- **この対応は構造マップに混ぜず、codiel のディスパッチ層に置く**(claude と gpt が一致。§3.5-2)。

---

## 9. このセッションで確定させた「確認が必要だった事実」

### 9-1. `plugins/sandalphon/docs/rationale.md` は**実在する**(確定)

- gpt は「この作業環境には存在しなかった」と報告したが、**誤りである**。
- 2026-09-15 時点で `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/sandalphon/docs/rationale.md` が存在し(10000 bytes、更新 2026-08-16)、`:51-68` の見出しは「## ハーネス初期化の判定を複合条件にした理由」である。claude と grok の引用は正しい。
- 内容(要点): `codielReady` を `.codiel/` の存在だけで判定しない理由(`:53-54`)、`/codiel:run` のフェイルクローズド条件がドメイン定義の可読性にあること(`:56-57`)、中途半端な初期化状態の誤判定を避けること(`:58-60`)、文書と Codiel 固有資産をフィールドとして分けた理由(`:62-65`)、記法変更に対して安全側に倒れること(`:67-68`)。
- **次セッションへの含意**: 6-3 で `codielReady` を変えるなら、この rationale の `:56-60` が論拠ごと古くなる。追随先に含めること(W9)。

### 9-2. このリポジトリで `/codiel:run` のディスパッチが実際に機能するか(**未確認のまま**)

- 静的読解では「担当を決める規則が欠落している」と判定した(§4.7。本リポジトリのドメインキーは `impl`/`prompt`/`bundle`/`manifest`/`docs` で、implementer は `frontend`/`backend`/`data` のみ)。
- **実際の run は実行していない。**次セッションが実測で確かめるかどうかは判断に委ねる。実測する場合、run は GitHub Issue を起点にし `.codiel/` へ書き込むため、**捨ててよい Issue と作業ツリーで行うこと**。

---

## 10. スコープ外(このセッションで手を出さない)

- **正本の移動**(案A / B / C / D)。§3 で却下済み。再提案しない。
- **docRoot → codielRoot のルート基準変更**(§7-5)。独立した破壊的変更として分離する。
- **将来設計(Agents → Skills)そのものの実装**。本件の ADR とは別に切る(§3.5-5)。
- **GOTCHAS の所有権移管**(§7-7)。別改修が進行中。
- **`capturing-intent/SKILL.md:81` の任意参照の削除**(§5)。
