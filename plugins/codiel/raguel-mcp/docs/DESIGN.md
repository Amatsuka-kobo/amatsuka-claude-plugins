# raguel-mcp 設計書

Codiel オーケストレーターの基幹システム。AI が出力した成果物(判断・仕様・設計・コード)を Raguel 自身が読んで検査し、
**PROCEED(続行) / ASK(人に確認) / STOP(停止)** の判定を返す MCP サーバー。

名前の由来は「他の天使たちの行いを監視し、正す天使 Raguel(ラグエル)」。
嬉々としてコーディングする天使 Codiel を見張る天使、という関係を表す。

この文書は Raguel 単体の設計を書く。codiel との間で結ぶファイル形式と pass-gate の検査(契約)の正本は
[`../../docs/raguel-contract.md`](../../docs/raguel-contract.md) で、この文書は要点だけを §16 に載せる。
利用者が読む運用の説明(設定の書き方、プロバイダーの選び方、外部への送信)は
[`../../README.md`](../../README.md) の「Raguel の運用」にある。

以下、`src/` は `plugins/codiel/raguel-mcp/src/` を指す。

## 1. 設計原則

1. **最終判定は決定論的** — LLM 判定を含むすべてのシグナルは、設定に宣言された閾値と合成規則によって機械的に判定へ写像される。決定論的なのは「どの観点をいつ走らせ、結果をどう合成するか」であり、パネリストそのものは LLM 判定である(§7)。
2. **フェイルクローズド** — 内部エラー・LLM のタイムアウト・設定の不備など、判定不能な状況では必ず `ASK` に倒す。エラーが `PROCEED` になる経路を作らない。
3. **説明可能性** — すべての判定は「どのルールが・どの証拠で・どう発火したか」を findings と reasons で返し、証拠をケースファイル(§10)に残す。
4. **STOP は 4 種の確かな危険に限る** — STOP を出せるのは秘密情報・保護パス・破壊操作・改竄の 4 種だけで、改竄以外は人が誤検知と裁定すれば通せる(§5.1、§4.3)。優先順位は `STOP > ASK > PROCEED` のままで、LLM のスコアが良くても STOP は下がらない。
5. **Raguel が評価対象を自分で読む** — 呼び出し側が渡す要約や本文を検査しない。git の差分とファイルを Raguel が読み、その sha256 と HEAD を記録して、codiel の pass-gate が照合する。PROCEED は実物を検査した結果を意味する。
6. **成果物は信頼しない入力** — 検査対象にはプロンプトインジェクションが含まれ得る前提で、ランダムなノンス付きのデリミタで囲んだデータとして渡す。
7. **基盤の障害は内容の懸念と分ける** — 障害で ASK になった評価は `judgeStatus: degraded` を持ち、再提出の数にも判例にも入らない(§9)。
8. **失敗から成長する** — 人の裁定と事後の障害を判例として蓄積し、以後の判定の参考入力に還流させる(§12)。

## 2. 判定モデル

```ts
type Verdict = "PROCEED" | "ASK" | "STOP"
type JudgeStatus = "ok" | "degraded"        // 基盤が正常に判定できたか(§9)
type Severity = "info" | "ask" | "stop"
type WeightTier = "trivial" | "standard" | "critical"
```

応答(`EvaluationResult`。型は `src/core/types.ts`)は次のフィールドを持つ。

| フィールド | 内容 |
| --- | --- |
| `evaluationId`・`runId`・`phase`・`kind`・`attempt` | 識別。evaluationId は内部エラーでも必ず一意の UUID。attempt は run とフェーズの組ごとの番号 |
| `verdict`・`judgeStatus`・`degradedReasons` | 判定と、基盤の状態。degraded のとき、原因を `{ source, reason }` の列で持つ |
| `weightTier` | trivial / standard / critical |
| `findings` | ルール層とパネルの所見。severity の重い順に 50 件まで。切ったら `reasons` に件数を書く |
| `reasons`・`decisionPoint` | 判定の理由(接頭辞つきの定型文)と、ASK・STOP のとき人が判断することの 1 文。どちらも合成規則から決定論で作る |
| `subject` | `{ repoPath, head, base?, files: [{ path, sha256 }] }`。評価対象の出所 |
| `meta` | critical で meta を起動したときの軸別スコアと rationale |
| `casePath` | 証拠のディレクトリ。証拠の全文は応答に含めない |
| `policy` | `{ configHash, configSource, version: 2, buildVersion, protectedPaths: { excludedDefaults, generated } }` |
| `contextJudge` | `{ enabled, status, adjustments }`。Jev の文脈判定の結果(§8) |

`policy.buildVersion` は raguel-mcp の `package.json` の `version` で、MCP サーバーが名乗るバージョンと同じ値である(`build.ts` が esbuild の `define` で埋め込む)。

## 3. 判定パイプライン

```
codiel(オーケストレーター)
  │ evaluate_*(runId, phase, objective, baseRef | paths | decision)
  ▼
[1] 入力の検証 ── 誤りは isError で返し、記録しない
[2] 評価対象の取得 ── git diff / ファイルを Raguel が読む。sha256 と HEAD を記録
[3] ルール層 ── STOP 4 種 / ask / info。前フェーズ証拠の改竄検知
[4] 文脈判定(任意) ── Jev が stop → ask、info → ask、tier の下限を調整
[5] 重さ判定 ── code だけ trivial がある。文書は standard 以上
[6] パネル ── standard: adversarial(文書は前フェーズの証拠があれば ∥ crosscheck)→ steelman
              critical: adversarial ∥ crosscheck → steelman → meta
[7] 合成 ── 決定論。judgeStatus(ok / degraded)を決める
[8] 記録 ── ケースファイル・評価の索引・ハッシュチェーン
  │ EvaluationResult
  ▼
codiel-state pass-gate ── 索引・verdict.json・裁定の記録・HEAD を照合
```

- 設定は評価ごとに読み直す(mtime で判定)。読み込みに失敗したら、評価対象を先に取ってから ASK・degraded で返し、所見に設定のパスと理由を載せる(§14.4)。
- ルール層に stop があればパネルも Jev も起動せず STOP を返す。
- 空の差分は [2] の後に [4]〜[7] を飛ばして PROCEED になり、[8] の記録を書く(§4.2)。[3] のうち前フェーズの改竄の検証だけは、空の差分でも行う。
- `subject.head` は、プロジェクトルートが git の管理外のときと、最初のコミットが無いリポジトリで文書と判断を評価したときに `null` になる。索引の `head` も同じである。evaluate_code は HEAD を解決できなければ入力の誤りにする。
- 前フェーズ(§16.1)の最新 attempt の改竄を [3] で検証する。不一致は `casefile/tampered`(stop)である。前フェーズの提出本文の先頭 4000 文字、ルール層の ask 以上の ruleId、meta の rationale、人の裁定を、tier と verdict に関係なく crosscheck と meta に渡す。
- [2]〜[7] を通して締切(既定 600 秒)が効く(§9)。

## 4. MCP ツール

ツールは 8 本である。

| ツール | 入力(主要フィールド) | 用途 |
| --- | --- | --- |
| `evaluate_decision` | `runId`, `phase`, `objective`, `decision`, `optionsConsidered?`, `rollbackPlan?` | AI が下した判断の検査 |
| `evaluate_plan` | `runId`, `phase`, `objective`, `paths`(1〜20 件) | 仕様・作業計画のファイルの検査 |
| `evaluate_design` | `runId`, `phase`, `objective`, `paths`(1〜20 件) | 設計文書のファイルの検査 |
| `evaluate_code` | `runId`, `phase`, `objective`, `baseRef`, `paths?`, `testResults?` | HEAD までの git 差分の検査 |
| `record_outcome` | `evaluationId`, `outcome`, `ruling?`, `notes?` | 判定の結末と人の裁定の記録 |
| `list_rules` | `kind?` | 有効なルール・設定できるパラメータ・プロバイダーの解決結果・設定の出所 |
| `list_precedents` | `outcome?`, `phase?`, `includeRetired?` | 判例の一覧(保守用) |
| `retire_precedent` | `id`, `reason` | 判例の退役(保守用) |

入力はすべて厳格なスキーマ(`z.strictObject`)で、旧入力の `diff`・`files`・`plan`・`steps`・`constraints`・`design`・`requirements` は未知のキーとして isError になる。要約を渡せば PROCEED を取れる抜け道を残さないためである。入力の誤りは判定を返さず、ケースファイルにも索引にも書かない。内部エラーは一意の evaluationId を発行し、ASK・degraded で索引に書く。

### 4.1 共通の入力とフェーズ

`phase` は必須で、codiel のゲート付き 9 フェーズ(intent・design・test-spec・dev-plan・test-code・implement・test-loop・intent-sync・fix-loop)のどれかである。フェーズの表は `src/codiel/phases.ts` にあり、表の kind とツールが合わなければ入力の誤りになる。`repoPath`(任意)は、プロジェクトルートと git の共通ディレクトリが同じ作業ツリーだけを受ける。省略時はプロジェクトルートである。

### 4.2 evaluate_code の差分の作り方と空の差分

1. `baseRef` を `git rev-parse --verify --end-of-options <baseRef>^{commit}` でコミットに解決する。`-` で始まる値は入力の誤りである。
2. 比べる終点は常に HEAD で、任意の終点は受けない。pass-gate が HEAD の一致を見るためである。
3. `paths`(無ければ作業ツリー全体)に未コミットの変更があれば入力の誤りにする。評価した内容と作業ツリーが食い違ったまま記録を残さないためである。
4. `core.quotePath=false` などを固定した書式で `git diff` を実行する。差分が 20 MB を超えたら入力の誤りにする。
5. 差分が空、または差分のファイルがすべて E2E のレポートか生成物(§5.3)なら、Jev・重さ判定・パネルを通さずに PROCEED・trivial とし、`code/no-change`(info)を残す。変更の無いフェーズ(修正の要らない test-loop など)がこれに当たる。差分が空でないときは、レポートと生成物に `common/secrets` を当て、stop が出れば STOP にする。記録は通常どおり書くので pass-gate はそのまま照合できる。前フェーズの改竄の検証(§3 の [3])は変更なしでも行い、改竄があれば `casefile/tampered` の STOP にする。

plan・design の `paths` は repoPath 相対で、実体パスが repoPath の内側にある通常のファイル(1 MB 以下、UTF-8)だけを受ける。追跡されていないファイルも読む。本文は `=== <path> ===` の見出し行でつなぎ、見出し行はルール層の検査から外す。decision は `decision`・`optionsConsidered`・`rollbackPlan` をこの順に見出し行でつなぐ。

### 4.3 record_outcome と人の裁定

`ruling` はフェーズのゲートでの人の裁定を表す。受け付ける組み合わせは次のとおりで、ほかは `recorded: false` と理由を返す。

| ruling | outcome | 受け付ける評価 | 判例 |
| --- | --- | --- | --- |
| `as-is` | approved | verdict が ASK | judgeStatus が ok のときだけ作る |
| `false-positive` | approved | verdict が STOP で、`casefile/tampered` の所見を持たない | 作る。`notes` が必須 |
| `revise` | rejected | verdict が ASK か STOP | judgeStatus が ok のときだけ作る |
| なし | approved / rejected / incident | すべて | judgeStatus が ok のときだけ作る |

裁定はすべて `outcomes.jsonl` に書き、判例を作らない組み合わせも記録を残す。`casefile/tampered` の STOP は覆せない。改竄は成果物の懸念ではなく記録の信頼の問題だからである。`incident`(PROCEED したのに実害が出た)は見逃しの記録で、最も価値の高い判例になる。

### 4.4 保守用ツール

`list_precedents` と `retire_precedent` は、人か、人に頼まれたオーケストレーターが使う。codiel の run は呼ばない。退役は判例のファイルを消さず、索引に `retiredAt` と `retireReason` を書く。退役した判例は検索に出ない。退役できるのはプロジェクトの判例だけで、内蔵のシード判例は `precedent.seedCatalog: false` でまとめて外す。

## 5. ルール層

### 5.1 STOP を出せるのは 4 種に限る

| 種 | ルール | 既定 severity |
| --- | --- | --- |
| 秘密情報 | `common/secrets` | stop |
| 保護パス | `code/protected-paths` | stop |
| 破壊操作 | `code/destructive-ops` | stop |
| 改竄 | `casefile/tampered`(Raguel 本体が出す。設定不可) | stop |

ほかのルールは設定で `severity: stop` にできない(読み込みエラー)。パネルと meta は STOP を出せない。`onError` は `ASK` だけを受け付ける。キーは既存の設定を読み込みエラーにしないために残してある。

### 5.2 ルール一覧

`sealed` のルールは設定で無効化できず、severity を既定より軽くできない。

| ルール ID | 内容 | 既定 | sealed |
| --- | --- | --- | --- |
| `common/secrets` | API キー・トークン・秘密鍵・`user:pass@` の形の検出。エントロピーの判定は語を `/` と `.` で区切った部分に当て、英大文字・英小文字・数字の 3 種を含む 20 文字以上の部分だけを測る。`://` を含む行も対象にし(URL のクエリに埋めた鍵を拾うため)、lockfile と `node_modules` の行だけを除く。一致したトークンは先頭 4 文字だけを残して伏せ、`01-rules.json`・verdict.json・応答・`submission.txt` のすべてで伏せる | stop | ✔ |
| `common/injection-marker` | インジェクションの徴候。`system-prompt-forgery` は命令の語と同じ行にあるときだけ一致させる | ask | ✔ |
| `common/resubmission-loop` | 同じ run・フェーズの過去の attempt との類似(MinHash の推定 Jaccard、既定 0.85、上限 0.95)。前回の ruleId が消えた再提出、人の裁定を経た attempt、degraded の attempt は比べない。stop には上げない | ask | ✔ |
| `common/max-size` | 本文の大きさの上限 | ask | |
| `code/protected-paths` | 保護 glob(既定 `.github/**`・`infra/**`・`**/*.env*`)への変更。`excludeDefaults` と `generated` を持つ(§5.3) | stop | ✔ |
| `code/destructive-ops` | `rm -rf` の `/`・`~`・`$HOME`・未クォートの変数展開、`git push --force` と `+<refspec>`、`git reset --hard` と `git clean -f`、`DROP TABLE`・`DROP DATABASE`・`TRUNCATE`、`WHERE` の無い `DELETE FROM` | stop | ✔ |
| `code/unsafe-exec` | `eval(`・`new Function(`・外部入力を渡す `child_process`・`curl \| sh`・`chmod 777` | ask | ✔ |
| `code/max-diff-lines` | 差分の行数の上限(既定 500) | ask | |
| `code/test-deletion` | テストの削除・skip 化(Go・Python・Java の命名と skip 表記を含む) | ask | |
| `code/new-dependency` | package.json の依存ブロックの内側の新しい名前 | ask | |
| `plan/irreversible-ops` | 不可逆な操作の語(語幹一致)。パネルの入力になる | info | |
| `plan/max-steps` | plan のステップ数。`## Step N` の見出しを数え、無ければ番号付きリストを数える | info | |
| `plan/scope-keywords` | objective に含まれない領域への言及 | info | |
| `decision/no-alternatives` | 代替案の検討の記載が無い | info | |
| `decision/no-rollback` | 不可逆な判断なのに rollback の記載が無い | info | |
| `precedent/failure-match` | 失敗判例に合致した(判例の id を message に書く)。判定は動かさない | info | |

- `.md`・テストファイル・コメント行では、`code/destructive-ops` は stop を ask に、`code/unsafe-exec` は ask を info に下げる。ファイルの種別は Raguel が組んだ diff のパスで決まる。
- info の所見は判定を動かさず、パネルへのプロンプトの「ルール層の所見」に入る。
- 所見はルールとファイルの組ごとに 1 件へ集約し、抜粋は最初の 3 か所だけを残す。`01-rules.json` は 500 件までとする。
- 各ルールは `params` のスキーマ(名前・型・既定値・和集合か置換か)を持ち、list_rules がそれを載せる。

### 5.3 保護パスの除外・生成物の宣言・E2E のレポート

`code/protected-paths` は 2 つのパラメータを持つ。

| パラメータ | 既定 | 意味 |
| --- | --- | --- |
| `excludeDefaults` | `[]` | 既定の glob のうち保護から外すもの。既定の glob と文字列で完全に一致するものだけを受ける |
| `generated` | `[]` | 生成物の glob。固定部(ワイルドカードを含む最初のセグメントより前)が空の glob は受けない |

- 保護の glob は、既定の glob と利用者の `globs` の和集合から `excludeDefaults` を除いたものである。
- `generated` に当たるパスは、保護パス・重さ判定・パネルの入力・Jev の対象から外し、`common/secrets` だけを当てる。パネルには「生成物: `<パス>`(`<行数>` 行の変更)」の 1 行だけを渡す。生成物と保護パスの両方に当たるパスは生成物として扱う。
- 名前の変更(rename)は、移動元と移動先の両方のパスで判定する。どちらかが保護パスなら `code/protected-paths` を当て、生成物・レポートとして外すのは両方が外す対象のときだけにする。重さの変更ファイル数と近接、`code/test-deletion` も移動元を見る。保護パスのファイルを外へ移して保護を抜ける経路を塞ぐためである。
- 差分が生成物だけなら `code/generated-only`(info)を出し、手書きの変更を生成物に見せかける抜け道の手がかりにする。
- 外した既定の glob と `generated` は `policy.protectedPaths` と list_rules に毎回出る。
- E2E のレポートは、`.codiel/config.json` の `testsDir` の配下で、`testsDir` からの相対パスに `reports/` のセグメントを含むファイルである。利用者の設定なしに生成物と同じに扱い、レポートだけの差分は変更なしとして PROCEED にする。判定は codiel の `isE2eReport` と同じである(`src/config/paths.ts`)。

## 6. 重さ判定

| kind | 基礎点 | 加点 | tier の下限 |
| --- | --- | --- | --- |
| code | 20 | 変更行数 `min(40, floor(行数 / 25) × 5)`、変更ファイル数 `min(20, 2 × 件数)`、保護パス近接 25、新しい依存 15 | なし |
| design・plan・decision | 30 | 本文の文字数 `min(30, floor(文字数 / 4000) × 5)`。plan はステップ数 `min(20, (件数 − 5) × 2)` | standard |

- tier の閾値は `weight.tiers`(standard 30、critical 70)である。
- trivial になるのは code の小さな差分だけである。文書は常に standard 以上である。
- ルール層に ask 以上の所見があれば下限を standard に、`code/protected-paths` か `plan/irreversible-ops` の ask 以上の所見があれば critical にする。
- 保護パス近接は、保護 glob の固定部が 1 セグメント以上あり、変更パスがその固定部で始まるときに加点する。
- 重さ判定は tier を上げる方向にだけ働く。危険な変更を軽く見せてパネルを避ける攻撃を、これで封じる。
- Jev の文脈判定が有効なら、被害と取り消しにくさの水準で tier の下限を上げうる(§8)。

## 7. LLM 判定パネルとプロバイダー

### 7.1 パネルの構成

| tier | 手順 | meta |
| --- | --- | --- |
| trivial | パネルなし | なし |
| standard(code) | adversarial → steelman | なし。合成は決定論 |
| standard(文書) | 前フェーズの証拠があれば adversarial と crosscheck を並列、無ければ adversarial だけ → steelman | なし。合成は決定論 |
| critical | adversarial と crosscheck を並列 → steelman → meta | あり |

| 役割 | 立場 | 職務 |
| --- | --- | --- |
| adversarial | 検察 | 成果物がなぜ失敗するかを攻める。セキュリティ(権限・機密情報・インジェクション・破壊的操作・サプライチェーン)と成果物が暗黙に置く前提を必ず点検し、具体的な失敗の筋書きがあるものだけを所見にする。無ければ所見は 0 件でよい |
| steelman | 弁護 | adversarial と crosscheck の所見に 1 件ずつ反駁するか認める |
| crosscheck | 鑑識 | 成果物の主張を事実(リポジトリ・objective・前フェーズの承認済みの証拠)と突合する。未達と逸脱の両方向を見る |
| meta | 裁判官 | 独立した子プロセスで、ケースファイルの証拠だけを読み、最終根拠文と軸別スコアを出す |

- steelman は adversarial が有効なときだけ起動する。adversarial が失敗したら steelman は起動しない。
- 軸のキーは「100 = 問題なし」と読める名前にし、すべてのプロンプトに「スコアは 0〜100 の整数で、100 は問題が無いこと」と書く(向きを書かないと同じ run の中でスコアの向きが逆転した)。軸は評価の種類(decision・plan・design・code)で固定である(`src/panel/rubrics.ts`)。
- 判例の検索結果は adversarial と meta に「参考: 類似の過去の裁定」として、日付と outcome と ruling を添えて渡す。
- 成果物はデリミタで囲んだデータとして渡し、システムプロンプトで成果物内の指示に従わないことを明示する。証拠ファイルへの引用にも同じ枠づけと抜粋長の上限を当てる。
- パネルの構成は設定で変えられない。空にして黙って PROCEED させる構成を作れないようにするためである。

### 7.2 合成規則

次の順に当て、最初に決まったものを採る。

1. ルール層に stop があれば STOP。パネルは起動しない。
2. adversarial と crosscheck の所見のうち、severity が ask で confidence が `judge.thresholds.confidence`(既定 70)以上で、steelman に反駁されていないものを採用する。反駁されたものと閾値未満のものは info にする。steelman 自身の所見は判定を動かさない。
3. 基盤の障害があれば `judgeStatus` を degraded にし、ASK。
4. ルール層に ask があれば ASK。
5. 採用された所見があれば ASK。
6. trivial なら PROCEED。
7. standard なら PROCEED。パネルのスコアと乖離度は記録するが、判定に使わない。
8. critical で、adversarial と crosscheck の共通の軸のスコアの差が `judge.thresholds.maxVariance`(既定 30)を超えたら ASK。
9. critical で meta のいずれかの軸が `judge.thresholds.proceed`(既定 80)未満なら ASK。
10. PROCEED。

パネルと meta の自由記述(rationale・message)は合成の入力にしない。判定に影響できるのは severity・confidence・スコアの構造化フィールドだけである。

### 7.3 プロバイダーは claude と codex から選ぶ

パネリストと meta は `claude` か `codex` で動かす。どちらも「プロンプトを受けて JSON を返す」実装で、共通のインターフェース(`src/panel/provider.ts` の `JudgeProvider`)を持つ。プロンプトの組み立ては共有し、子プロセスの起動だけが違う。

| キー | 値 | 既定 |
| --- | --- | --- |
| `judge.provider` | `claude` / `codex` / `none` | `claude` |
| `judge.model` | 文字列 | なし(プロバイダーの既定) |
| `panel.perPanelist.<名前>.provider` | `claude` / `codex` | `judge.provider` |
| `panel.perPanelist.<名前>.model` | 文字列 | 下の規則 |

- `<名前>` は adversarial・steelman・crosscheck・meta である。
- model は、`perPanelist.<名前>.model`、そのパネリストの provider が `judge.provider` と同じなら `judge.model`、プロバイダーごとの既定、の順に解決する。別のプロバイダー向けの model 名が流れ込まないようにするためである。
- claude の既定は adversarial が `sonnet`、ほかが `haiku` である。codex は model を指定せず CLI の既定に任せる。
- `none` は `judge.provider` だけに置け、LLM を起動しない。パネルが要る評価はすべて degraded の ASK になる。設定 1 行で LLM の検査を黙って外せないようにするためである。
- 起動した子プロセスへは `RAGUEL_PANELIST=1` を渡す。この値を持つプロセスでは raguel-mcp が起動せず、パネリストが Raguel を呼び返す再帰を防ぐ。

### 7.4 claude の隔離

```
claude -p --output-format json --model <model> --tools "" --disable-slash-commands
       --strict-mcp-config --mcp-config '{"mcpServers":{}}'
       --setting-sources project --no-session-persistence
       --json-schema <$schema を除いた JSON Schema>
```

- cwd は呼び出しごとに作る空の一時ディレクトリで、終わったら消す。プロンプトは stdin で渡す。
- `--setting-sources project` と空の cwd の組み合わせで、ログインは保たれ、利用者の hooks・CLAUDE.md・プラグインは読まれない。実機で確かめた(claude 2.1.284。hooks は 0 件、利用者のプラグインは読まれず、CLAUDE.md は 0 件)。
- `--strict-mcp-config` は、プラグイン同梱の MCP サーバーも claude.ai のコネクタも、モデルに渡さない。モデルに見えるツールは構造化出力の `StructuredOutput` だけである。
- env は `process.env` に `RAGUEL_PANELIST=1` を足したものである。鍵を除く操作はしない。子プロセスの `claude` が利用者の `ANTHROPIC_API_KEY` を使うかは利用者の裁量で、プラグインは Anthropic API を必須にしない。
- JSON Schema から `$schema` を外す。付いていると CLI が拒否する。

### 7.5 codex の隔離と既知の限界

```
codex exec --ephemeral --ignore-user-config --skip-git-repo-check
           --sandbox read-only
           --disable shell_tool --disable unified_exec --disable hooks
           --output-schema <一時ディレクトリ>/schema.json
           -o <一時ディレクトリ>/last-message.json
           [-m <model>] -
```

- プロンプトは stdin で渡す。cwd・スキーマ・出力は呼び出しごとの空の一時ディレクトリに置く。応答は `-o` のファイルを読んで zod で検証する。
- 認証は `CODEX_HOME` だけで通る。
- `--output-schema` は全プロパティを `required` に並べ `additionalProperties: false` を付けた厳格な形を要る(無いスキーマは 400 になる)。任意の欄は `null` を許す型にして必須に並べ、読んだ後で `null` を取り除く(`toStrictSchema`・`stripOptionalNulls`)。
- 実機の確認(codex-cli 0.144.1)で、`--sandbox read-only` は cwd へのファイルの作成を止め、`--disable shell_tool --disable unified_exec` は cwd の外のファイルの読み取りとシェルの使用を止めた。付けないと cwd の外のファイルを読めた。
- **既知の限界**: `$CODEX_HOME/AGENTS.md` は止められず、読まれる。`--ignore-user-config`、`-c project_doc_max_bytes=0`、`--disable hooks` のどれを足しても読まれた。`--ignore-rules` は execpolicy の `.rules` を読まないフラグで、`AGENTS.md` には効かない。利用者がそこに書いた指示は、パネリストの判定に混じりうる。既定のプロバイダーは claude で、codex は利用者が選んだときだけ使う。
- codex を選ぶと、成果物(差分・ファイルの本文・前フェーズの証拠)が OpenAI へ送られる。

## 8. Jev による文脈判定は任意の補強である

正規表現と語彙の判定は文脈を見ないので、説明文やテストの固定データで誤検知し、否定文や中身の無い欄を見逃す。そこで、ルール層と重さ判定の一部を TypeSafe AI の Jev(`@typesafe-ai/sdk`、鍵は環境変数 `TYPESAFE_API_KEY`)で文脈判定できる。

- 既定は無効である(`contextJudge.enabled: false`)。無効のときの挙動は、§5 の決定論の規則そのものである。鍵の無い利用者は決定論で動く。
- 正規表現の判定を土台に残し、Jev は文脈で絞るか上げるだけである。Jev は単独で STOP も PROCEED も出さない。動かせる向きは、`code/destructive-ops` の stop → ask と、語彙系の info → ask(`plan/irreversible-ops`・`plan/scope-keywords`・`decision/no-rollback`・`decision/no-alternatives`)、および再提出・injection-marker・重さの「上げる」向きだけである。`code/unsafe-exec` は確率を message に添えるだけで severity を変えない。
- 閾値は `contextJudge.thresholds.lower`(既定 0.5、下げる向き)と `raise`(既定 0.7、上げる向き)である。確率が閾値の間にあるときは決定論の結果のままにする。
- `contextJudge.timeoutMs` の既定は 20000 で、`judge.deadlineMs` を超える値は読み込みエラーにする。2 つの問い合わせを並列に送る。
- 送る本文は `common/secrets` の伏せ字を当てた後のものである。入力が上限(合計 51,200 トークン相当、1 つの値 25,600)を超えた対象は、本文を切らずに決定論の結果に残す。切ると、切った先を見ないまま判定を下げうるためである。
- `common/secrets`・`code/protected-paths`・`casefile/tampered` が stop を出したときは Jev を呼ばない(成果物を外部へ送らず、判定も変わらないため)。
- 鍵が無い・Jev が失敗した・入力が上限を超えた、のいずれかのときは、その対象を決定論の結果で判定し、`contextJudge/unavailable`(info)の所見と `reasons` に原因を残す。`judgeStatus` は ok のままである。再試行はしない。
- 質問の ID・確率・水準・当てた変更は `07-context.json` に残す(本文は入れない)。
- 有効にすると、成果物が伏せ字の後で TypeSafe AI へ送られる。

## 9. 基盤の障害を内容の懸念と分ける

- 次のどれかが起きたら `judgeStatus` を degraded にし、`degradedReasons` に書く。パネリストか meta の失敗(再試行の後)、締切の超過、プロバイダーの `unavailable`、内部エラー、設定の読み込みの失敗。
- degraded の評価の verdict は ASK である。ルール層に stop があれば STOP のままで、`judgeStatus` は ok である。
- 失敗の所見 `panel/<名前>-error` は判例の firedRules と再提出の比較に入れない。

| 失敗 | 再試行 |
| --- | --- |
| タイムアウト・nonzero-exit・spawn の失敗 | 1 回。締切までの残りが 30 秒未満なら行わない |
| スキーマの不一致 | 1 回 |
| Jev の失敗 | 行わない。決定論の結果で進む |

締切と時間は次の既定である。

| 設定 | 既定 | 意味 |
| --- | --- | --- |
| `judge.timeoutMs` | 180000 | 1 回の呼び出しの時間の上限。`judge.deadlineMs` を超える値は読み込みエラー |
| `judge.deadlineMs` | 600000(上限 1800000) | ゲート全体の締切。超えた波は障害になり、子プロセスを SIGKILL して `degradedReasons` に `deadline` と書く |

- 1 回の呼び出しの時間は `min(judge.timeoutMs, 締切までの残り − 3000)` である。
- Claude Code は MCP の呼び出しが 120 秒を超えるとバックグラウンドへ移し、完了の通知で結果を返す。この移行を正規の経路とし、codiel は通知を待つ。所要の実測は standard が code 106 秒・文書 119 秒、critical が 243 秒で、1 回の呼び出しの最長は steelman の約 106 秒だった。
- ツールのハンドラの `extra.signal` が abort したら、動いている子プロセスをすべて SIGKILL し、Jev の呼び出しを止め、その attempt のディレクトリを消して索引に書かない。`progressToken` があるときは、ステップごとに進捗を通知する。

## 10. ケースファイル・評価の索引・裁定の記録

```
<casesDir>/
  cases/<projectId>/
    evaluations.jsonl                     評価の索引
    outcomes.jsonl                        裁定の記録
    <runId>/<phase>/attempt-NN/
      subject.json  submission.txt  00-synthesis.json  01-rules.json
      02-weight.json  03-adversarial.md  04-steelman.md  05-crosscheck.md
      06-precedents.json  07-context.json  08-meta.md
      submission-digest.json  verdict.json
  precedents/<projectId>/
    index.json  <id>.json
```

- `casesDir` は、`cases` と `precedents` の親である。既定は `~/.raguel` で、作業ツリーの外に置く。判定対象の AI が自分のケースファイルを書き換えて無罪の証拠を作る攻撃への一次防壁である。
- 証拠ファイルの名前は上の 12 件に固定する。attempt はフェーズ単位で番号を振る。
- projectId は `storage.projectId` があればそれを使う。無ければ git の共通ディレクトリの実体パスから `<名前>-<sha256 の先頭 12 文字>` を作るので、どの worktree から評価しても同じ値になる。この算出は旧版と違い、旧版のケースファイルと判例は引き継がない(シード判例は残る)。
- プロジェクトルートは、codiel の `findMainRoot` と同じアルゴリズムの独立実装で決める(`src/project/root.ts`)。`.codiel/config.json` はプロジェクトルートから探す。
- `submission-digest.json` は、本文の正規化した sha256 と、5-gram の MinHash 署名(128 個の 32 bit の整数)を持つ。固定長なので、大きな本文でも記録が膨らまない。
- 証拠・索引・判例は、同じディレクトリの一時ファイルに書いて rename する。読めない索引と `index.json` は上書きせずに例外にする。
- 保持の上限(`storage.retention` の `maxRuns` 200・`maxDays` 90)は、run ごとの最後の評価の時刻で判定し、消す run の行を索引からも消す。索引に無い evaluationId は「評価の記録が無い(掃除済みか、存在しない)」と返し、改竄とは別の文言にする。
- ログは stderr にだけ出す(stdout は MCP の通信専用)。レベルは環境変数 `RAGUEL_LOG_LEVEL`(`debug`・`info`・`warn`・`error`、既定 `info`)で変える。

## 11. 改竄はハッシュチェーンで検出し、書き込みは codiel の guard が止める

```
seed = sha256("raguel-v2|" + evaluationId + "|" + runId + "|" + phase + "|" + attempt
              + "|" + verdict + "|" + judgeStatus + "|" + (prevChainHead ?? "none"))
head = 既知の証拠ファイルを名前順に H(prev + name + ":" + sha256) で畳み込む(初期値 seed)
```

- verdict と judgeStatus をチェーンの入力に含めるので、verdict.json だけを書き換えると `chainHead` が合わなくなる。`prevChainHead` で前の attempt の差し替えや削除も検出する。
- 照合するのは既知の証拠ファイル名だけで、エディタの一時ファイルなどは無視する。
- チェーンは秘密の鍵を持たないので、計算手順を知る者はすべてを書き直せる。書き直しを防ぐのは codiel の guard で、run が active か awaiting_human の間、`.codiel/config.json`・`RAGUEL_CONFIG` のファイル・`casesDir` の配下への書き込みを拒む。チェーンが検出するのは部分的な書き換えである。
- 検証の不一致は `casefile/tampered`(stop)になり、人の裁定でも覆せない。

## 12. 判例は人の裁定と incident だけから作る

- 判例を作るのは `record_outcome` だけで、§4.3 の表の「判例」列に従う。判定対象の AI は判例ストアに書けない。degraded の評価からは作らない。
- 判例は `phase` と `ruling` を持つ。`firedRules` から `panel/*-error`・`kernel/*`・`rule-error` を除く。
- 検索は決定論(kind・発火ルールの指紋・変更パスの重なり・語彙類似)で、埋め込みも API も使わない。退役した判例は除く。
- 上位 `precedent.topN`(既定 5)を adversarial と meta の参考入力にし、`06-precedents.json` に残す。上位に rejected か incident で合成スコア 0.5 以上のものがあれば、`precedent/failure-match`(info)を出す。判定は動かさない。
- コールドスタート対策として、AI の一般的な失敗パターン(存在しない API の幻覚、テスト削除による偽装パス、スコープ肥大など)を内蔵のシード判例として同梱する。
- 失敗判例の合致だけが所見になり、approved 判例は参考情報に留める。その時の文脈での承認は、次の文脈に自動で延ばせないためである。

## 13. 不変条件

設定でどう変えても壊れない制約である。

1. **弁護は検察なしに存在できない** — steelman は adversarial が起動したときだけ起動する。
2. **昇格のみ** — 重さ判定・steelman の反駁・approved 判例は、ルール層と sealed ルールの所見を下げられない。降格できるのはパネル発の所見だけである。Jev が動かせる向きは §8 の限られた向きに限る。
3. **sealed ルール** — `common/secrets`・`common/injection-marker`・`common/resubmission-loop`・`code/protected-paths`・`code/destructive-ops`・`code/unsafe-exec` は設定で無効化できず、severity を既定より軽くできない。例外は `code/protected-paths` の `excludeDefaults` と `generated` で、名指しした既定の glob と生成物だけを外せ、外したものは応答に出る。
4. **meta の独立性** — meta は別の子プロセスで起動する。成果物を作ったコンテキストとは状態を共有せず、入力はケースファイルの証拠だけで、ツールも実行できない。
5. **分散は ASK に倒す** — critical で、パネル間のスコアの乖離が閾値を超えたら平均せず ASK。
6. **証拠・判例の書き込みは Raguel 本体の専権** — 検証の不一致は STOP である。
7. **自由記述は判定を動かせない** — 判定に影響できるのは構造化フィールドだけである。
8. **`onError: PROCEED` は指定できない** — フェイルクローズド。
9. **STOP は 4 種に限る** — パネルと meta は STOP を出せない。

## 14. 設定

### 14.1 置き場と読む順

設定は JSON で書く。次の順に読み、最初に見つかったものだけを使う。

1. 環境変数 `RAGUEL_CONFIG` が指すファイル。中身は `raguel` キーの値と同じ形の JSON オブジェクトである。
2. プロジェクトルートの `.codiel/config.json` の `raguel` キー。
3. 内蔵の既定値。

- `raguel.config.yaml` は廃止した。Raguel は YAML を読まず、残っていても YAML に縮退しない。`/codiel:init` が中身を `raguel` キーへ移す。
- `config.json` が無い・`raguel` キーが無いときは既定値を使う。JSON として読めない・`raguel` がオブジェクトでないときは読み込みの失敗である(§14.4)。
- Raguel が見るのは `raguel` キーの中と `testsDir` である。`runsDir` は codiel のキーで、Raguel は検証も解釈もしない。
- `testsDir` は、`RAGUEL_CONFIG` を設定したときも、プロジェクトルートの `.codiel/config.json` から読む。読み方は codiel の `readCodielConfig` と同じで、キーが無ければ `docs/codiel/tests` を使い、文字列でない・空・絶対パス・`..` を含む値は読み込みの失敗にする。Raguel だけが既定値で動くと、codiel と違う場所をレポートとみなすためである。
- `policy.configSource` は `env:<パス>`・`cwd:<config.json の絶対パス>`・`defaults` のどれかである。表示と記録だけに使う。

### 14.2 キー

利用者は変えたいキーだけを書く。値は既定の例で、`<...>` は利用者が書く値の説明である。

```json
{
  "raguel": {
    "version": 1,
    "onError": "ASK",
    "storage": {
      "casesDir": "~/.raguel",
      "projectId": "<任意>",
      "retention": { "maxRuns": 200, "maxDays": 90 }
    },
    "judge": {
      "provider": "claude",
      "model": "<任意>",
      "timeoutMs": 180000,
      "deadlineMs": 600000,
      "maxConcurrency": 4,
      "thresholds": { "proceed": 80, "confidence": 70, "maxVariance": 30 }
    },
    "weight": { "tiers": { "standard": 30, "critical": 70 } },
    "panel": {
      "perPanelist": { "adversarial": { "provider": "<任意>", "model": "<任意>" } }
    },
    "contextJudge": {
      "enabled": false,
      "model": "<任意>",
      "timeoutMs": 20000,
      "thresholds": { "lower": 0.5, "raise": 0.7 }
    },
    "precedent": { "seedCatalog": true, "topN": 5 },
    "rules": {
      "<ruleId>": { "enabled": true, "severity": "<info | ask | stop>", "<パラメータ>": "<値>" }
    }
  }
}
```

### 14.3 検証とマージ

- すべてのオブジェクトは厳格で、未知のキー・ルール ID・パラメータ・未知の `version` は読み込みエラーにする。厳しくするつもりの設定が黙って効かない事態を防ぐためである。
- マージは、オブジェクトは再帰、配列は置換とする。例外は、ルールの `params` のスキーマが「和集合」と宣言した配列(`code/protected-paths.globs`、`common/secrets.allowPatterns` など)で、既定値との和集合にする。
- sealed ルールの無効化・severity の引き下げ、stop にできないルールの `severity: stop`、不正な正規表現や広すぎる `allowPatterns`(空文字列に一致する、内蔵の見本の秘密情報に一致する)、`excludeDefaults` の既定に無い文字列、固定部が空の `generated` は読み込みエラーにする。`allowPatterns` は行ではなくトークンに当てる。
- `judge.deadlineMs` が 1800000 を超える、`judge.timeoutMs` と `contextJudge.timeoutMs` が `judge.deadlineMs` を超える、`contextJudge.thresholds` の `lower` が `raise` 以上か 0〜1 の外、`resubmission-loop.similarityThreshold` が 0.95 を超える、も読み込みエラーである。
- `perPanelist` のキーは adversarial・steelman・crosscheck・meta だけで、`perPanelist.<名前>.provider` に `none` は置けない。`judge.provider` と `perPanelist.<名前>.provider` は `claude`・`codex`・`none` だけを受ける。

### 14.4 設定が壊れていても起動し、次の評価で直る

設定が壊れていても、サーバーは起動する。評価は ASK・degraded を返し、所見に設定のパスと理由を載せる。list_rules は理由を返す。評価ごとに設定を読み直すので、直したら次の評価からその設定を使う。

## 15. モジュール構成

```
src/
  server.ts              エントリポイント。stdio transport でツールを登録。RAGUEL_PANELIST=1 なら起動しない
  tools/                 MCP ツール(evaluate* 4 本・recordOutcome・listRules・listPrecedents・retirePrecedent)
  codiel/phases.ts       codiel のフェーズの表
  project/root.ts        プロジェクトルート・projectId・casesDir の解決
  subject/               git 差分の作成、ファイルの読み込み、repoPath の検証、決定の本文
  core/                  pipeline・verdict(合成規則)・weight・invariants・types・log
  rules/                 ルールのレジストリと params の表。common/ code/ plan/ decision/
  context/               Jev の呼び出し(jev.ts)と、質問の組み立て・結果の当て方(judge.ts)
  panel/                 provider・claudeCli・codexCli・runner・prompts・rubrics・schema・panelists/
  casefile/              store(索引・裁定・証拠)・hashchain・digest(MinHash)
  precedent/             store・retrieval・seed/
  config/                schema・defaults・loader・paths(testsDir と E2E のレポートの判定)
  testing/               fake-claude.mjs・fake-codex.mjs(子プロセスとして起動する fake)
```

依存は `@modelcontextprotocol/sdk`・`@typesafe-ai/sdk`・`picomatch`・`zod` である。judge は `claude` と `codex` の CLI を子プロセスで起動するので、追加の依存は要らない。テストは vitest で、対象と同じディレクトリの `__test__/` に置く。パネルと Jev は fake に差し替え、実際の `claude`・`codex`・Jev の API は呼ばない。

## 16. codiel との契約

契約の正本は [`../../docs/raguel-contract.md`](../../docs/raguel-contract.md) である。要点は次のとおりで、変えるときは `../../docs/format-change-checklist.md` の「Raguel との契約」に従って追随させる。

### 16.1 フェーズの表

| フェーズ | ステージ番号 | kind | ツール |
| --- | --- | --- | --- |
| intent | 0 | decision | evaluate_decision |
| design | 2 | design | evaluate_design |
| test-spec | 3 | plan | evaluate_plan |
| dev-plan | 3 | plan | evaluate_plan |
| test-code | 4 | code | evaluate_code |
| implement | 5 | code | evaluate_code |
| test-loop | 6 | code | evaluate_code |
| intent-sync | 7 | design | evaluate_design |
| fix-loop | 10 | code | evaluate_code |

あるフェーズの前フェーズは、ステージ番号がそれより小さいゲート付きフェーズすべてである。test-spec と dev-plan は同じステージなので互いに前フェーズにならない。

### 16.2 記録の形と pass-gate の検査

- Raguel が書く記録は 3 つで、評価の索引(`evaluations.jsonl`)、裁定の記録(`outcomes.jsonl`)、attempt ごとの `verdict.json` である。すべて `schemaVersion: 2` を持つ。
- codiel の `codiel-state pass-gate` はこれらを自分の実装で読み、evaluationId・runId・フェーズ・verdict の一致、最後の評価であること、`--human-approved` のときの裁定(ASK は `as-is`、STOP は `false-positive`)、code 系フェーズの `subject.head` と `subject.base`(検査 8。`subject.paths` があれば通さない)、文書のフェーズの sha256(検査 9。フェーズごとに期待するファイルが `subject.files` に含まれることも要る)を照合する。ASK に `--verdict PROCEED` を付けても通らない。
- pass-gate は通したときの HEAD を `phases.<phase>.passedHead` に記録し、start-phase は直前に通ったゲート付きフェーズの `passedHead` が今の HEAD と等しいことを要る(フェーズの間の連続性)。pass-gate の後にコミットを足すと、次の start-phase が失敗する。
- 既知の限界として、intent-sync のゲートは、書き換えるべきファイルがすべて評価されたかを照合しない。書き換えるファイルが run ごとに違うので、評価したファイルが変わっていないことだけを見る。
- 両者は互いの src を import せず、同じ形を独立に実装する。2 者比較のテストだけが両方を読み、置き場の解決・projectId・`testsDir`・E2E のレポートの判定・pass-gate の検査が等しいことを確かめる。

## 17. 旧設計から変えたこと

初版の設計は、次の点で改めた。読み比べる人のための記録である。

- 原則「STOP は覆せない」を改め、STOP を 4 種に絞って、改竄以外は人の裁定で通せるようにした。`judge.canStop` は廃止した。
- 評価の入力を、呼び出し側が本文を渡す形から、Raguel が git とファイルを読む形へ置き換えた。フェーズを必須にし、attempt をフェーズ単位で数える。
- 前提監査のパネリストと判例調査のパネリストは撤去し、職務を adversarial と参考入力に移した。standard は meta を持たない。
- 設定の置き場を、リポジトリ直下の `raguel.config.yaml` から、`.codiel/config.json` の `raguel` キー(JSON)へ移した。旧 YAML の設定は `/codiel:init` が移す。
- パネルのモデルは、プロバイダー(claude / codex)とパネリストごとの上書きで決める。旧設計にあった、評価の種類ごとにモデルを切り替える設定は無い。
- `code/dangerous-patterns` を、破壊操作(stop)と実行・権限(ask)の 2 つのルール ID に分けた。
- 判定に `judgeStatus` を足し、基盤の障害を内容の懸念と分けた。
