# prompt-smith:skill-creator 移植 設計書

- 作成日: 2026-08-09
- 対象プラグイン: `plugins/prompt-smith`(現行 `0.2.0-dev` → `0.3.0-dev`)
- 移植元: Anthropic 公式プラグイン `skill-creator`(Apache License 2.0)

## 1. 背景と目的

このリポジトリの 45 スキルには eval セットが 1 つも無い。スキルを作るときも評価するときも、発火精度を測る手段が無い状態が続いている。

公式 `skill-creator` は description 改善ループ(測る → 直す → 測り直す → 最良を選ぶ)を持つが、現行の Claude Code では測定が機能しない。測定対象を `.claude/commands/` へ登録するためである。

公式ドキュメントは、カスタムコマンドが skills へ統合され `.claude/commands/` のファイルも引き続き**コマンドとして**機能すると述べる一方、Claude が自動でロードする能力は skills 側の追加機能として挙げている。Agent SDK のドキュメントはより明確で、`.claude/commands/` を legacy 形式と呼び、スラッシュ呼び出しと Claude による自律的な起動の**両方**を満たすのは `.claude/skills/<name>/SKILL.md` だとする。

出典: [Extend Claude with skills](https://code.claude.com/docs/en/skills) / [Agent SDK - Slash commands](https://code.claude.com/docs/en/agent-sdk/slash-commands)(2026-08-09 参照)

つまり `.claude/commands/` に置いた測定対象は `/名前` でしか起動されない。検出側は `Skill` ツール呼び出しを見ているので、結果が常に「発火せず」になる。

2026-08-01 の実測でも、同一 description・同一クエリで登録先を `.claude/skills/` に変えると、あるスキルの発火が 1/8 から 8/8 になっている。この事実は抗体 `ab-2026-0802-001` に記録されている。

この故障に気づかず description を書き換えると、壊れた測定に合わせて本番を改悪する。

「コマンドと skills は別系統である」という言い方は現行仕様に照らして不正確である。統合はされており、違いは**自動ロードの可否**にある。

本設計は、この改善ループを TypeScript へ全面移植し、測定の欠陥を直したうえで `prompt-smith` プラグインの独立スキルとして持つ。公式 `skill-creator` への依存を無くす。

### 現状の指示書が抱える問題

`plugins/prompt-smith/skills/prompt-smith/SKILL.md` の §description の担当(16-29 行)は、SKILL.md とコマンド定義の description を公式 `skill-creator` へ委ね、26 行目で「`skill-creator` が発火を測る反復を提案したときは、そのまま従う」と書いている。

つまり現行の指示書は、壊れた測定器に従えと指示している。

### 過去の判断との関係

| 判断 | 日付 | 本設計での扱い |
| --- | --- | --- |
| `optimize-agents` に skill-eval 機構を構築 | 2026-08-02 | — |
| skill-eval と測定機構を「冗長」として削除 | 2026-08-03 | 復活させない。新規に移植する |
| `optimize-agents` を `agent-policy` と `prompt-smith` に分解 | 2026-08-03 以降 | 移植先は `prompt-smith` |
| 「skill-creator のコードは流用せず独立実装とする」 | 2026-08-02 設計書 §6 | **明示的に覆す**。読んで移植し、Apache-2.0 の条件を満たす |

削除した `run-trigger-eval.mjs` を復活させない理由は、あれが測定しかできず、description を提案する機能を持たないためである。今回必要なのは測定と改善が閉じたループである。

## 2. 確定事項

| 事項 | 決定 | 決定者 |
| --- | --- | --- |
| 実行系 | skill-creator の改善ループを全面移植し、公式プラグインへの依存を無くす | ユーザー |
| 移植の言語 | TypeScript | ユーザー |
| 測定器の対応範囲 | `run_eval.py` が担っていた範囲(発火測定)に限る。output eval・ベンチマーク集計は移植しない | ユーザー |
| 判定ロジック | `<skill-name>-skill-` の前方一致 | ユーザー |
| 登録先 | `.claude/commands/` ではなく skills ディレクトリ。`disable-model-invocation: false` を明示 | ユーザー |
| eval セット | skill-creator が生成するものと完全に同一 | ユーザー |
| HTML レポートと eval レビュー UI | 両方移植する | ユーザー |
| 改善プロンプト | 英文のまま移植する。訳出も基準の差し替えもしない | ユーザー |
| 移植先 | `plugins/prompt-smith` | ユーザー |
| スキルの形態 | `prompt-smith:skill-creator` として独立スキルにする | ユーザー |
| 本文の基準 | 作るスキルの本文は `prompt-smith:prompt-smith` の基準に従う | ユーザー |
| 呼び出しの向き | `skill-creator` → `prompt-smith`(`agent-creator` と同じ経路) | ユーザー |
| 適用範囲 | プラグイン利用者にも配る | ユーザー |
| 出力の評価 | 測定器は作らないが、手作業の手順として本文に書く。機能を落とさない | ユーザー |
| packaging | 対象外。`package_skill.py` は移植しない | ユーザー |

「eval セットが完全に同一」が指すのは、**成果物の形式と作り方**(§6.1)である。train/test 分割に使う乱数列は対象外で、そこは §4.3 のとおり移植元と一致しない。

## 3. 成果物の構成

```
plugins/prompt-smith/
├── .claude-plugin/plugin.json          ← 0.2.0-dev → 0.3.0-dev
├── package.json                        ← 新設
├── build.ts                            ← 新設
├── LICENSE                             ← 新設(Apache-2.0 本文)
├── NOTICE                              ← 新設(帰属と変更点)
├── README.md                           ← 新設
├── src/
│   ├── run-trigger-eval.ts             ← run_eval.py の移植
│   ├── improve-description.ts          ← improve_description.py の移植
│   ├── run-loop.ts                     ← run_loop.py の移植
│   ├── generate-report.ts              ← generate_report.py の移植
│   ├── lib/
│   │   ├── parse-skill-md.ts           ← utils.py の移植
│   │   ├── stream-parse.ts             ← 新規(判定の純関数)
│   │   ├── sandbox.ts                  ← 新規(測定用の一時ディレクトリ構築)
│   │   ├── split-eval-set.ts           ← run_loop.py の分割部
│   │   ├── claude-cli.ts               ← 新規(claude -p の起動)
│   │   └── pool.ts                     ← 新規(ProcessPoolExecutor の代替)
│   └── __test__/*.test.ts
├── scripts/                            ← バンドル出力(git 管理)
├── skills/
│   ├── skill-creator/
│   │   ├── SKILL.md                    ← 新規
│   │   └── assets/eval-review.html     ← eval_review.html の移植
│   ├── prompt-smith/SKILL.md           ← §description の担当 を差し替え
│   └── agent-creator/SKILL.md          ← 変更なし
├── references/
│   ├── description-guide.md            ← 改稿(skill 専用の規律を移し、確かめ方を削除)
│   └── agent-definition-spec.md        ← 変更なし
├── evals/
│   ├── skill-creator.json              ← 新規
│   ├── prompt-smith.json               ← 新規
│   └── agent-creator.json              ← 新規
└── docs/
    └── skill-creator-port-rationale.md ← 新規
```

### 3.1 執筆の規律

新規・改稿するスキル本文(`skills/*/SKILL.md`)は `prompt-smith` の基準で書く。根拠・出典・経緯・実測値は本文に書かず `docs/skill-creator-port-rationale.md` へ置く。

本設計書が挙げている根拠と実測値も、スキル本文には持ち込まない。

## 4. 移植の対象と差分

移植は 5 ファイル。差分は測定の欠陥に関わる 4 点、乱数に関わる 1 点、記録の追加 1 点に限る。それ以外は挙動を変えない。

| 移植元 | 行数 | 移植先 | 差分 |
| --- | --- | --- | --- |
| `scripts/run_eval.py` | 310 | `src/run-trigger-eval.ts` | §4.1 の 4 点 + §4.6 の追加 |
| `scripts/improve_description.py` | 247 | `src/improve-description.ts` | なし |
| `scripts/run_loop.py` | 328 | `src/run-loop.ts` | §4.3 の 1 点 |
| `scripts/generate_report.py` | 326 | `src/generate-report.ts` | なし |
| `scripts/utils.py` | 47 | `src/lib/parse-skill-md.ts` | なし |
| `assets/eval_review.html` | — | `skills/skill-creator/assets/eval-review.html` | なし |

移植しないもの: `aggregate_benchmark.py`・`package_skill.py`・`quick_validate.py`・`eval-viewer/generate_review.py`・`agents/*.md`。これらは output eval とベンチマークの領域であり、§2 で対応範囲外と決めた。

### 4.1 run-trigger-eval の 4 修正

| # | `run_eval.py` | 移植版 | 根拠 |
| --- | --- | --- | --- |
| 1 | `<project>/.claude/commands/<clean>.md` に登録 | `<tmp>/.claude/skills/<clean>/SKILL.md` に登録し、frontmatter の `disable-model-invocation` を `false` にする | `.claude/commands/` は自動ロードの対象として公式に挙げられていない(§1) |
| 2 | `clean_name`(`<name>-skill-<hash>`)が累積 JSON に含まれるかで照合 | `<skill-name>-skill-` の前方一致で照合 | §4.1.1 |
| 3 | cwd = `find_project_root()` が返す実リポジトリのルート | cwd = run ごとの一時ディレクトリ | 実リポジトリを cwd にすると、そのリポジトリのプロジェクトスキルが同席し、発火競合が測定に混入する |
| 4 | `Skill` と `Read` の両方を発火とみなす | `Skill` のみを発火とみなす | skills として登録すれば、コマンドファイルを Read する間接経路が生じない |

修正 3 に伴い `find_project_root()` は移植しない。

`disable-model-invocation` の既定値は `false` である。よって修正 1 の後半は、発火を新たに有効化するものではない。効くのは**測定対象の SKILL.md が `disable-model-invocation: true` を持っていた場合**であり、そのときサンドボックス側で `false` へ**置換**する。キーが無い場合のみ追加する。追記で二重キーにしない。

#### 4.1.1 前方一致にする判断とその限界

移植元は完全一致ではなく `clean_name in accumulated_json` の部分文字列照合である。本設計はこれを `<skill-name>-skill-` の前方一致に緩める。

| 論点 | 評価 |
| --- | --- |
| 名前の変形に強くなるか | サンドボックスはプロジェクトスキルとして登録するため、プラグインの名前空間接頭辞(`plugin:name`)は付かない。**前方一致は接頭辞が前に付く変形には効かない**。効くのは末尾側の変形だけである |
| 偽陽性が入るか | 判定を確定させるのは `Skill` ツールの `content_block` に限る(修正 4)。他ツールの入力に接頭辞が現れる経路は塞がれている。残るのは `Skill` の入力の別フィールドに接頭辞が現れる場合のみで、実際には起きない |
| hash を判定に使わない影響 | この run 専用インスタンスであることの同一性を捨てる。run ごとに一時ディレクトリを分けるため、同じ接頭辞を持つ別インスタンスは同席しない |

前方一致は移植元より偽陽性側へ振れる変更である。安全側にあるのは修正 4 との組み合わせによる。単体で採用しない。

#### 維持する挙動

- `claude -p <query> --output-format stream-json --verbose --include-partial-messages [--model <id>]`
- 環境変数から `CLAUDECODE` を除いて起動する
- 最初の `content_block_start` が `tool_use` の時点で判定し、プロセスを kill する
- `content_block_delta` の `input_json_delta` を累積して名前を照合する
- `content_block_stop` / `message_stop` で確定する
- `assistant` メッセージによるフォールバック判定(ただし修正 4 に従い `Skill` のみを見る)
- `should_trigger: true` は `trigger_rate >= trigger_threshold`、`false` は `trigger_rate < trigger_threshold` で合格
- 既定値: `--runs-per-query 3` / `--num-workers 10` / `--timeout 30` / `--trigger-threshold 0.5`

合否条件は移植元(`run_eval.py` 231-234 行)のとおりとする。削除済みの旧リポジトリ実装は `false` を発火率 0 でのみ合格としていたが、この規則は採らない。`--runs-per-query 3` のとき、旧規則では 1/3 が不合格、移植元では合格になる。両者は別物である。

#### サンドボックスの構築

```
<tmp>/                                  ← run ごとに新規作成し、run の終了時に削除する
└── .claude/
    └── skills/
        └── <skill-name>-skill-<hash>/  ← ディレクトリ名がコマンド名になる
            └── SKILL.md
```

| 項目 | 決定 |
| --- | --- |
| 一時ディレクトリの場所 | OS の tmpdir 配下。**祖先に `.claude` を持たない場所**に作る。リポジトリ内に作らない |
| 生成と破棄 | `run-trigger-eval` が run ごとに作り、判定の確定後に削除する。プロセスが異常終了しても OS の tmpdir 掃除に委ねられる位置に置く |
| `hash` | 8 桁の乱数 hex。run ごとに引き直す |
| ディレクトリ名 | `<skill-name>-skill-<hash>`。frontmatter の `name` と一致させる |
| SKILL.md | 元ファイルをコピーし、`name` を差し替え、`disable-model-invocation` を `false` にする。他は触らない |

祖先に `.claude` を持たない場所を選ぶのは、プロジェクトスキルの探索が cwd から上へ辿るためである。

description を抽出して組み立て直す方式は採らない。YAML の引用や複数行スカラーが崩れる余地を残さないためである。

`hash` は判定には使わないが、名前には残す。モデルが実在する名前を見て呼んだことの担保になる。

本文中の `${CLAUDE_PLUGIN_ROOT}` はサンドボックスで解決しない。第一手のツール呼び出しで判定を打ち切るため、発火判定には影響しない。

#### 隔離できる範囲とできない範囲

修正 3 が隔離するのは**プロジェクトスキルだけ**である。次のものは cwd に依存せず常に同席する。

| 種別 | 場所 | 同席するか |
| --- | --- | --- |
| プロジェクトスキル | cwd から祖先の `.claude/skills/` | 隔離できる |
| ユーザースキル | `~/.claude/skills/` | **同席する** |
| プラグインのスキル | 有効なプラグイン | **同席する** |
| 同梱スキル | Claude Code 本体 | **同席する** |

したがって測定値は「description の単独の発火率」ではなく、「測定した環境に常駐するスキル群との競争に勝った率」である。測定者の環境が変われば値が動く。

この制約は消せない。**同じ環境で測った値どうしだけを比較する**という規律で受ける(§8.1)。`environment`(§4.6)に記録するのは認証経路とモデルであり、常駐スキルのカタログまでは記録しない。

#### CLI

移植元の引数名をそのまま使う。`--skill-path` は SKILL.md ではなく**スキルディレクトリ**を指す。

```
node scripts/run-trigger-eval.mjs \
  --skill-path <スキルディレクトリ> \
  --eval-set <eval セット JSON のパス> \
  [--description <上書きする description>] \
  [--runs-per-query 3] [--num-workers 10] [--timeout 30] \
  [--trigger-threshold 0.5] [--model <id>] [--verbose] \
  [--out <結果 JSON のパス>]
```

`--out` は移植元に無い追加である。移植元は stdout に JSON を出す。`--out` 省略時は移植元と同じく stdout に出す。

#### 出力 JSON

`improve-description` が読む形式なので、キー名を移植元から変えない。

```json
{
  "skill_name": "測定したスキル名",
  "description": "測定した description",
  "environment": { "base_url": "...", "auth_source": "ANTHROPIC_AUTH_TOKEN", "model": "claude-opus-5" },
  "results": [
    { "query": "...", "should_trigger": true, "trigger_rate": 1.0, "triggers": 3, "runs": 3, "pass": true }
  ],
  "summary": { "total": 20, "passed": 18, "failed": 2 }
}
```

`environment` 以外のキーは移植元(`run_eval.py` 235-256 行)と同一である。`skill_name` と `trigger_rate` を落とさない。

### 4.2 improve-description

移植元の挙動をそのまま写す。

- 失敗した問(発火漏れ・誤発火)を分類してプロンプトに埋める
- 過去の試行を `<attempt>` として積み、同じ方向を繰り返さないよう指示する
- `claude -p --output-format text` に **stdin 経由**でプロンプトを渡す(SKILL.md 本文を含むため argv 長を超えうる)
- `<new_description>` タグから抽出する。タグが無ければ全文を使う
- 1024 文字を超えたら、同じプロンプトに超過分を添えて 1 回だけ再依頼する。再依頼の結果がなお 1024 文字を超えていても、そのまま採用する(移植元と同じ)
- `log_dir` が指定されていれば `improve_iter_<n>.json` に往復を記録する

プロンプト本文(移植元 79-142 行)は英文のまま写す。訳出しない。このリポジトリの `description-guide` の規律も組み込まない。移植元が改良されたとき、差分を照合できる状態を保つためである。

### 4.3 run-loop の 1 修正

`split_eval_set` は `random.seed(42)` と `random.shuffle` で層化分割している。Python の Mersenne Twister と同じ乱数列は Node の標準 API では再現できない。

**seed 付き PRNG を自前で持ち、Fisher-Yates で層化シャッフルする。** seed は移植元と同じ 42 を既定とする。乱数列は移植元と一致しないが、実行間の再現性は保たれる。

配列順のまま分割する案は採らない。eval セットは should-trigger を先にまとめて書かれることが多く、その場合「最初に書いた問だけが常に test 側に入る」偏りが固定される。

#### 維持する挙動

- `should_trigger` で層化し、それぞれから `holdout` 割合を test へ回す。各群から最低 1 問は test に入れる
- train と test を 1 バッチで測り、結果をクエリ文字列で振り分ける
- 履歴から `test_` で始まるキーを落として改善モデルへ渡す(test スコアを見せない)
- train が全問合格したら打ち切る
- 最良は **test スコア**で選ぶ。test が無いときのみ train スコアで選ぶ
- `live_report_path` が指定されていれば、反復ごとに自動更新付き HTML を書き出す

#### CLI

```
node scripts/run-loop.mjs \
  --eval-set <path> --skill-path <スキルディレクトリ> --model <id> \
  [--description <上書き>] [--max-iterations 5] [--holdout 0.4] \
  [--runs-per-query 3] [--num-workers 10] [--timeout 30] \
  [--trigger-threshold 0.5] [--verbose] \
  [--report auto|none|<path>] [--results-dir <dir>]
```

返す JSON は移植元と同じキー構成(`best_description` / `best_score` / `best_train_score` / `best_test_score` / `exit_reason` / `history` ほか)とする。

### 4.4 generate-report

`generate_html(output, autoRefresh, skillName) -> string` の契約で移植する。反復ごとのスコア推移と、問ごとの合否を表示する。

### 4.5 parse-skill-md

frontmatter から `name` と `description` を取り出す。YAML のブロックスカラー(`>` `|` `>-` `|-`)の継続行連結を含めて移植する。

### 4.6 environment の記録(追加)

`claude -p` は親プロセスの環境変数を継承するため、起動に使ったエイリアスによって認証経路が変わる。異なる経路で測った結果を比較しても意味がない。

`run-trigger-eval` の出力に `environment` を足す。

| キー | 内容 |
| --- | --- |
| `base_url` | `ANTHROPIC_BASE_URL` の値。未設定なら `"(default)"` |
| `auth_source` | 設定されている認証系変数の**名前**。`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `(claude.ai login)` のいずれか |
| `model` | `--model` に渡した値 |

**トークンやキーの値は記録しない。** 変数名と URL だけを残す。

これは移植元に無い追加である。NOTICE に変更点として記載する。

## 5. ライセンス

移植元は Apache License 2.0(著作権者 Anthropic)。コードを読んで移植するため、成果物は Derivative Works にあたる。clean-room 実装ではない。

Apache-2.0 §4 の各項に対応させる。

| 条項 | 内容 | 対応 |
| --- | --- | --- |
| §4(a) | 受領者にライセンスのコピーを渡す | `plugins/prompt-smith/LICENSE` に Apache-2.0 全文を置く |
| §4(b) | 変更したファイルに、変更した旨の目立つ通知を付す | 各移植ソースのヘッダに、移植元ファイル名・変更点・Apache-2.0 の boilerplate を書く。**バンドル出力にも esbuild の `banner` で同じ通知を載せる** |
| §4(c) | 派生物のソース形式に、元の Work のソースに含まれる著作権・特許・商標・帰属の通知を保持する | 移植元の `.py` に Copyright ヘッダは無い。保持すべきソース内表示は存在しない。帰属はヘッダに Anthropic の著作権表示を新たに書いて示す |
| §4(d) | Work が NOTICE ファイルを含む場合、派生物にもその帰属通知を含める | **移植元に NOTICE ファイルは無いため、この義務は発動しない** |

`plugins/prompt-smith/NOTICE` は §4(d) の義務としてではなく、帰属を 1 箇所にまとめる慣行として置く。§4(c) の代替ではない。

対象は Python ソースに限らない。次も Derivative Works として扱い、ヘッダまたは冒頭コメントに通知を書く。

- `improve-description.ts` に埋め込む英文プロンプト(移植元 `improve_description.py` 79-142 行)
- `skills/skill-creator/assets/eval-review.html`(移植元 `assets/eval_review.html`)

バンドル出力 `scripts/*.mjs` は git 管理され、プラグイン利用者が受け取る実行形である。ここに §4(b) の通知が載らないと、利用者の手元に変更表示が届かない。

2026-08-02 設計書 §6 の「コードは流用せず独立実装とする」を覆した経緯も NOTICE に残す。

## 6. eval セット

### 6.1 形式と作り方

skill-creator の Description Optimization Step 1 に完全準拠する。独自の書き方基準は持たない。

```json
[
  { "query": "ユーザーが実際に打ちそうな依頼文", "should_trigger": true },
  { "query": "近いが別の対応が要る依頼文", "should_trigger": false }
]
```

| 項目 | 内容 |
| --- | --- |
| 問数 | 20 問 |
| 内訳 | should-trigger 8-10 問 / should-not-trigger 8-10 問 |
| クエリの性質 | 具体的で現実的。ファイルパス・仕事や状況の背景・列名と値・会社名・URL・短い前置きを含める |
| 表記 | 小文字・略語・タイプミス・口語を混ぜる。長さも混ぜる |
| 難度 | 明快な例ではなく境界事例を選ぶ |
| 作業量 | 1 手で終わる問は作らない。多段の作業や専門的な判断を要する問にする |
| should-not-trigger | 語や概念を共有するが別の対応が要る near-miss で埋める。明らかに無関係な問いは入れない |

「1 手で終わる問は作らない」は、Claude が自力で処理できる依頼ではスキルを参照しないためである(移植元 SKILL.md §How skill triggering works)。単純な問は description の質によらず発火しないので、測定の材料にならない。

### 6.2 置き場

skill-creator は eval セットを `<skill-name>-workspace/` という一時領域に置く前提で、永続的な置き場を定めていない。再利用するには永続化が要るので、ここだけこのリポジトリの判断で決める。

| 形態 | 置き場 |
| --- | --- |
| プラグイン同梱 | `plugins/<plugin>/evals/<skill-name>.json` |
| プロジェクトのスキル | `.claude/skills/<name>/evals/<name>.json` |
| ユーザーのスキル | `~/.claude/skills/<name>/evals/<name>.json` |

測定対象と一緒に移動し、同じ版管理に乗る形にする。

### 6.3 承認

`skills/skill-creator/assets/eval-review.html` のプレースホルダを置換して一時ファイルに書き出し、ブラウザで開く。

| プレースホルダ | 置換する値 |
| --- | --- |
| `__EVAL_DATA_PLACEHOLDER__` | eval セットの JSON 配列(引用符で囲まない) |
| `__SKILL_NAME_PLACEHOLDER__` | スキル名 |
| `__SKILL_DESCRIPTION_PLACEHOLDER__` | 現行の description |

ユーザーが編集して "Export Eval Set" を押すと `~/Downloads/eval_set.json` に落ちる。

回収の手順を決めておく。UI はダウンロードするだけで、保存先へは運ばない。

1. ユーザーがエクスポートを終えたと告げるまで待つ。
2. `~/Downloads/` から `eval_set*.json` を探し、**更新時刻が最も新しいもの**を取る。ブラウザは同名ファイルを `eval_set (1).json` のように増やすため、名前で決めない。
3. 内容が §6.1 の条件(20 問、内訳、形式)を満たすかを確かめる。満たさなければユーザーに差し戻す。
4. §6.2 の置き場へ保存する。
5. 回収したファイルは `~/Downloads/` から消さない。

ダウンロードが見つからないときは、ユーザーに保存先を尋ねる。推測で古いファイルを拾わない。

## 7. スキルの担当境界と呼び出しの向き

```
ユーザー「スキルを作って」/「description を直して」
      ↓
prompt-smith:skill-creator          ← 入口
      ├─ 本文        → prompt-smith:prompt-smith の基準に従う
      ├─ description → 自前(改善ループ)
      └─ eval        → 自前
```

`agent-creator` と同じ経路である。`agent-creator` も手順の 1 ステップとして `prompt-smith` の基準を参照し、`prompt-smith` 側は本文に節を持たず description の 1 文で境界を宣言している。

`skill-creator` が `prompt-smith` へ委ねるのは**文章の書き方**である。スキルというパッケージの構造(三層のロード、同梱物の置き分け、行数の目安)は `prompt-smith` の対象外なので、`skill-creator` が自前で持つ(§8.4)。

| スキル | 担当 | 担当しない |
| --- | --- | --- |
| `prompt-smith` | AI 向け指示書の**本文** | SKILL.md・コマンド定義の description、Agent 定義、測定 |
| `skill-creator` | **スキル・コマンド定義**の作成、description の作成と改善、eval セット、発火測定、出力の評価 | 本文の**文章**の書き方、Agent 定義 |
| `agent-creator` | **Agent 定義**の作成・検証 | スキルの作成、測定 |

### 7.1 逆向きの経路を削除する

現行 `prompt-smith/SKILL.md` の §description の担当(16-29 行)は `prompt-smith` → `skill-creator` の向きで書かれている。これを残すと双方向になり、循環しうる。

14 行を削除し、3 行に差し替える。

- output style・メモリの description は `../../references/description-guide.md` に従って書く。
- SKILL.md・コマンド定義の description は `prompt-smith:skill-creator` が担当する。
- Agents 定義の description は `agent-creator` が担当する。

境界の宣言は `prompt-smith` の **description** に足す。`agent-creator` について既に書かれているのと同じ形にする。

> スキル・コマンド定義の description の作成・改善と発火測定は `skill-creator` が担当する。

現行 27 行目の「反復の途中で本文へ及ぶ提案が出たときは、その提案だけを外す」という但し書きも削除する。改善ループは description しか書き換えないので、本文の基準と description の基準が同じファイルを取り合う事態が構造として起きない。

## 8. skill-creator スキルの手順

| 順 | 手順 | 内容 |
| --- | --- | --- |
| 1 | 用途を聞く | 何をするスキルか / いつ発火すべきか / 出力の形式 / テストケースが要るか。会話に既に手順が現れているときはそこから抽出し、埋まらない箇所だけ聞く |
| 2 | 詳細を詰める | edge case・入出力形式・例示ファイル・成功条件・依存を聞く。使える MCP があれば先に調べ、材料を持って臨む |
| 3 | 配置を決める | プラグイン同梱 / `.claude/skills/` / `~/.claude/skills/` |
| 4 | 構成を決める | SKILL.md 単体か、`scripts/` / `references/` / `assets/` を伴うか(§8.4) |
| 5 | 本文を書く | `prompt-smith:prompt-smith` の基準に従う。構造は §8.4 |
| 6 | description を書く | §8.2 と `references/description-guide.md` |
| 7 | 出力を評価する | §8.5。手順 1 でテストケースが要ると判断したときだけ行う |
| 8 | eval セットの有無を確かめる | 無ければ §6.1 に従って 20 問作る |
| 9 | 承認を得る | §6.3 のレビュー UI に流し込む |
| 10 | 保存する | §6.2 の置き場へ |
| 11 | 改善ループを回す | `run-loop.mjs` |
| 12 | 適用する | `best_description` を SKILL.md に書き、before/after とスコアを示す |

既存スキルの description だけを直す依頼では 1-7 を飛ばして 8 から入る。

手順 1 でテストケースの要否を決める基準は、出力が客観的に検証できるかである。ファイル変換・データ抽出・コード生成・決まった手順の実行は検証できるので作る。文体やデザインのように人の判断が要るものは作らない。型に応じた既定を提案し、決めるのはユーザーとする。

### 8.1 本文に書く規律

左列を `skills/skill-creator/SKILL.md` の本文に書く。右列は本文に書かず `docs/skill-creator-port-rationale.md` へ置く。

| 本文に書く規律 | 退避する根拠 |
| --- | --- |
| 1〜2 問の差で description や実装を疑わない。同条件で測り直す | 同一クエリ 10 回の測定で 0/10〜3/10 の振れ幅が実測されている |
| 過去の測定と比べるときは `environment` の一致を確かめる | `claude -p` は起動エイリアス由来の環境変数を継承する |
| スコアは測定した環境に依存する。有効なプラグインやユーザースキルが変わった後の値を、変わる前の値と比べない | ユーザースキル・プラグインのスキル・同梱スキルは cwd に依存せず同席する(§4.1) |
| 全問が発火 0 で返ったときは、description ではなくタイムアウトを疑い、`--timeout` を伸ばして測り直す | 既定 30 秒はローカルプロキシ経由では足りない可能性がある |
| 公式 `skill-creator` プラグインの `run_eval.py` / `run_loop.py` は使わない | 登録先が `.claude/commands/` で、自動ロードの対象として公式に挙げられていない |

最後の規律を本文に書く理由は、抗体 `ab-2026-0802-001` がこのリポジトリのローカル資産であり、配布先には存在しないためである。抗体があるからと本文で省略しない。

「測定は一時ディレクトリを cwd にして行う」は本文に書かない。測定器の実装が担保するものであり、スキルを使う側の動きを変えないためである。

### 8.2 本文に載せる description の規律

`references/description-guide.md` のうち、**skill とコマンド定義にしか当たらない規律**を本文へ移す。共通の基準は guide に残し、本文から参照する。

本文へ移すもの。移す根拠は 2 通りに分かれる。

| 本文へ移す規律 | 移植対象の中の所在 | 移す根拠 |
| --- | --- | --- |
| `description` を 1024 字以内にする | `improve_description.py:132` | 移植済みプロンプトに入るが、改善ループが書き換えるときにしか効かない。手順 4 で初版を書くときのために本文へ置く |
| 100〜200 words 相当へ収める。発火精度を落としてでもこの範囲へ収める | 同 132 行 | 同上 |
| 上限に触れたときは、個別の記述を意図のまとまりへ言い換えて縮める | 同 167-172 行(再依頼プロンプト) | 同上 |
| 「必ず使用する」と言い切る。「〜に役立つ」「〜のときに参照できる」のような控えめな表現にしない | 公式 `SKILL.md:67`(散文)。**移植対象外** | 移植のどこにも入らない。載せなければ失われる |
| ユーザーがその語を明示しない場面も、発動する場面として書く | 同 67 行。**移植対象外** | 同上 |

skill-creator は description の書き方を 2 箇所に分けて持っている。**作るときの指針は SKILL.md の散文、直すときの指針は improve プロンプト**である。本設計はスクリプトとアセットだけを移植するため、後者しか手に入らない。前者にあたる 2 行を本文で補う。

長さの 3 行は移植済みプロンプトと重複するが、効く場面が違う。プロンプト側は改善ループが description を書き換えるときに効き、本文側は §8 手順 4 で初版を書くときに効く。

`skill-creator` は本文の冒頭で `../../references/description-guide.md` を参照し、共通の基準に従う。`agent-creator` と同じ形である。

### 8.3 description-guide.md の改稿

| 対象 | 変更 |
| --- | --- |
| 適用範囲(3-8 行) | `skill-creator` の可否による分岐を削除する。対象は SKILL.md・コマンド定義・Agents 定義・output style・メモリのままとする |
| §書く内容(10-21 行) | 変更しない |
| §発火率を上げるための施策(23-28 行) | skill 専用の 2 行(27-28)を §8.2 へ移す。移動により「Agents 定義には適用しない」(25 行)が指す対象が消えるため、この但し書きも削る。残る 26 行は Agents 節として置き直す |
| §長さの上限(30-35 行) | skill 専用の 3 行(33-35)を §8.2 へ移す。同じ理由で 32 行の但し書きも削る。節ごと無くなる |
| §配布するスキル・Agents 定義の書き方(37-41 行) | 変更しない |
| §直したときの確かめ方(43-56 行) | **削除する** |

§直したときの確かめ方 を削る理由は、14 行すべてが移植後の実体と重なるためである。

| guide の記述 | 移植後の実体 |
| --- | --- |
| 20 問、8〜10 / 8〜10 | §6.1 |
| ファイルパス・列名・口語・タイプミスを混ぜる | §6.1 |
| 1 手で終わる問は作らない | §6.1 |
| 各問を 3 回実行する | `--runs-per-query 3` |
| 6 対 4 に分け、4 割で採否を決める | `--holdout 0.4` と test スコアでの best 選択 |
| 改稿は 5 回まで | `--max-iterations 5` |
| 語を足さずに文構造と語の選び方を変える | 移植した改善プロンプト |

削除する 14 行の内容は `docs/skill-creator-port-rationale.md` に、移植前の姿として記録する。

この改稿により、Agent 定義の description には測定手段が示されない状態になる。`agent-creator` は静的検査のみを担い、発火の測定手段を持たない。これは移植前から変わらない。

### 8.4 本文に載せるスキル作成の知識

`prompt-smith` は指示書の**文章**の基準であり、スキルという**パッケージの構造**の知識を持たない。次は本スキルが自前で持つ。

#### 三層のロード

| 層 | 内容 | 読まれる時 |
| --- | --- | --- |
| メタデータ | `name` と `description` | 常時 |
| 本文 | SKILL.md の本体 | 発火した時 |
| 同梱物 | `scripts/` / `references/` / `assets/` | 必要になった時 |

- SKILL.md は 500 行以内を目安にする。超えるときは階層を足し、どこを読むかの指示を本文に書く。
- `references/` の文書が 300 行を超えるときは目次を付ける。
- 同梱物の役割で置き場を分ける。`scripts/` は決まりきった処理の実行体、`references/` は必要時に読む文書、`assets/` は出力に使う素材とする。
- 複数のドメインを扱うスキルは、ドメインごとに `references/` を分け、本文には選び方だけを書く。

#### 書き方のパターン

- 出力の形式が決まっているときは、テンプレートで示す。
- 例は Input と Output の組で示す。
- 英語で書くスキルの本文は imperative(`Use this skill for`)で書く。`prompt-smith` の「命令形ではなく言い切りで書く」は**日本語の文体を対象にした規律**であり、英語には当てない。方向はどちらも同じで、説明ではなく指示として書くことを求めている。

#### 安全

悪意あるスキル、内容と説明が食い違うスキルは作らない。依頼を受けても応じず、代わりに何ができるかを示す。

#### 既存スキルを更新するとき

- `name` とディレクトリ名を変えない。
- 読み取り専用の場所にあるときは、書き込める場所へコピーしてから編集する。

#### frontmatter

`compatibility` は、必要なツールや依存があるときだけ書く。

#### 相手に合わせた言葉選び

スキルを作る相手の習熟度は幅が広い。会話の手がかりから判断する。「評価」「ベンチマーク」はそのまま使ってよい。「JSON」「assertion」は、相手が知っていると分かる手がかりが出るまで短い説明を添える。

### 8.5 出力の評価

測定器は作らない(§2)。サブエージェントを使う手作業の手順として本文に書く。

#### 手順

| 順 | 手順 |
| --- | --- |
| 1 | 現実的な試行プロンプトを 2-3 個作り、ユーザーに見せて合意する |
| 2 | 各プロンプトについて、スキルを渡した実行と渡さない実行を**同じターンで**サブエージェントに起動する |
| 3 | 実行中に assertion(客観的に検証できる合否条件)を起草し、ユーザーに説明する |
| 4 | 完了通知に含まれるトークン数と所要時間を記録する |
| 5 | 出力を採点し、2 構成の差を見る |
| 6 | ユーザーに出力を見せ、評価を聞く |
| 7 | 本文を直す |
| 8 | 2 に戻る |

対照は、新規に作るスキルではスキルを渡さない実行とする。既存スキルを直すときは、編集前の版を控えておき、それを対照とする。

#### 規律

- 2 構成の差を見る。スキルを渡した側だけでは、assertion が緩いのかスキルが効いているのか区別できない。
- 両構成とも合格する assertion には識別力がない。作り直す。
- 主観的な出力(文体・デザイン)に assertion を無理に付けない。人の判断に委ねる。
- 機械的に検証できる assertion はスクリプトで確かめる。目視で数えない。
- 完了通知のトークン数と所要時間は、その場でしか取れない。届いた順に記録する。
- 個別の試行プロンプトに合わせて本文を細かくしない。失敗から意図のまとまりへ一般化する。
- 複数の試行で同じ補助スクリプトが書かれていたら、それを同梱物にする。
- 効いていない記述を消して測り直す。足すだけにしない。

#### 手順 4 の記録

サブエージェントの完了通知にはトークン数と所要時間が含まれる。これは通知の時点でしか取れず、後から復元できない。届いた通知を順に処理し、まとめて後で読もうとしない。

### 8.6 公式 SKILL.md との対応

移植で機能が落ちていないことを確かめるための対応表である。`docs/skill-creator-port-rationale.md` にも残す。

| 公式 `SKILL.md` の節 | 移植後の所在 |
| --- | --- |
| 冒頭の全体像(10-30 行) | §8 手順 |
| Communicating with the user(32-41 行) | §8.4 相手に合わせた言葉選び |
| Capture Intent(47-54 行) | §8 手順 1 |
| Interview and Research(56-60 行) | §8 手順 2 |
| Write the SKILL.md(62-69 行) | §8 手順 5-6、§8.4 frontmatter |
| Anatomy(73-84 行) | §8.4 三層のロード |
| Progressive Disclosure(86-99 行) | 同上 |
| Domain organization(100-109 行) | 同上 |
| Principle of Lack of Surprise(111-113 行) | §8.4 安全 |
| Writing Patterns(115-135 行) | §8.4 書き方のパターン、`prompt-smith` |
| Writing Style(137-139 行) | `prompt-smith` §工程・§書き方の基準 |
| Test Cases(141-161 行) | §8.5 手順 1 |
| Running and evaluating test cases(163-288 行) | §8.5 手順 2-6 |
| Improving the skill(292-321 行) | §8.5 手順 7-8、§8.5 規律 |
| Advanced: Blind comparison(325-329 行) | **移植しない** |
| Description Optimization(333-404 行) | §8 手順 8-12、§6、スクリプト |
| How skill triggering works(396-400 行) | §6.1 |
| Package and Present(408-416 行) | **移植しない** |
| Claude.ai / Cowork(420-455 行) | **移植しない** |
| 既存スキルの更新(438-441 行) | §8.4 既存スキルを更新するとき |

移植しない 3 つの理由。

| 節 | 理由 |
| --- | --- |
| Blind comparison | 2 版の優劣を独立エージェントに判定させる仕組み。公式自身が任意と位置づけており、人のレビューで足りる |
| Package and Present | `.skill` へ固めて渡す経路。このリポジトリはプラグインとして配る運用であり、使わない |
| Claude.ai / Cowork | 実行環境ごとの手順の読み替え。本スキルは Claude Code を前提とする |

## 9. ビルド基盤

`plugins/prompt-smith` は現在 `src/` も `package.json` も持たない。既存 9 プラグインと同形式で新設する。

### package.json

```json
{
  "name": "prompt-smith-scripts",
  "version": "0.3.0-dev",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsx build.ts" }
}
```

### build.ts

esbuild で `bundle: true` / `outdir: "./scripts"` / `outExtension: { ".js": ".mjs" }` / `platform: "node"` / `format: "esm"` / `sourcemap: false`。entryPoints のキー名が出力ファイル名になる。

| キー | ソース |
| --- | --- |
| `run-trigger-eval` | `./src/run-trigger-eval.ts` |
| `improve-description` | `./src/improve-description.ts` |
| `run-loop` | `./src/run-loop.ts` |
| `generate-report` | `./src/generate-report.ts` |

### pnpm-workspace.yaml

`packages` に `plugins/prompt-smith` を追加する。**これを忘れると `pnpm build` が対象にしない。**

## 10. テスト

`plugins/prompt-smith/src/__test__/*.test.ts` に置く。vitest。

| 対象 | 方法 |
| --- | --- |
| stream-json のパース | 純関数に切り出し、固定の JSON 行列から発火判定を検証 |
| 前方一致の照合 | 累積 JSON 文字列と接頭辞の組み合わせを網羅 |
| 合否ロジック | 発火率と `should_trigger` としきい値の組み合わせを網羅 |
| frontmatter パース | ブロックスカラー 4 種と引用の有無を検証 |
| サンドボックス構築 | tmpdir に構築させ、`name` の差し替えと `disable-model-invocation` の追加を検証 |
| 層化分割 | 同じ入力で 2 回呼んで同じ分割になること、各群から最低 1 問が test に入ること |
| 1024 文字超の再依頼 | `claude -p` の呼び出しを差し替え、長い応答を返させて再依頼が 1 回だけ起きることを検証 |

`claude -p` の実起動はテストしない。プロセス起動部分を差し替え可能にする。

## 11. 検証

### 11.1 対照実験(移植の妥当性)

同一 description・同一クエリを、`.claude/commands/` へ登録する経路と `.claude/skills/` へ登録する経路の両方で測り、**発火率に差が出ること**を確認する。

これは単体テストではなく、手で 1 回行う検証手順である。§10 の「`claude -p` の実起動はテストしない」と矛盾しない。

差が出なかったときの扱いを先に決めておく。

| 観測 | 疑う対象 | 次に行うこと |
| --- | --- | --- |
| skills 経路だけ発火する | — | 想定どおり。合格 |
| どちらも発火しない | 測定器の実装、またはタイムアウト | `--timeout` を伸ばして再測。stream-json の生ログを読み、`Skill` の `content_block` が来ているかを直接見る |
| どちらも同じだけ発火する | **前提**(`.claude/commands/` が自動ロードされないという §1 の診断) | 実装ではなく前提を疑う。公式ドキュメントを再確認し、§1・§4.1#1・抗体の記述を改める |

「差が出ない = 実装不良」と決めつけない。commands と skills の統合は進行中の変更であり、`.claude/commands/` の自動ロード可否は Claude Code の版で変わりうる。

### 11.2 自己適用

`prompt-smith` / `agent-creator` / `skill-creator` の 3 スキルの eval セットを作り、`run-loop.mjs` を最後まで回す。

| 確認 | 内容 |
| --- | --- |
| ループが完走する | `best_description` と `best_score` が返る |
| レポートが出る | HTML が生成され、反復ごとのスコアが表示される |
| 境界が測れる | `skill-creator` の should-not-trigger 側に `prompt-smith`(本文の改稿)と `agent-creator`(Agent 定義)が正解の依頼を入れ、誤発火しないことを確かめる |

### 11.3 段階的な検証

| 段階 | 検証 |
| --- | --- |
| 基盤 | `pnpm build` が `prompt-smith-scripts` を対象にし、`scripts/*.mjs` が生成される |
| 測定器 | §11.1 の対照実験が通る |
| 改善 | `improve-description.mjs` 単体が `<new_description>` を返す |
| ループ | §11.2 が通る |

## 12. 影響範囲

### 12.1 新規

- `plugins/prompt-smith/package.json` / `build.ts` / `LICENSE` / `NOTICE` / `README.md`
- `plugins/prompt-smith/src/` / `scripts/`
- `plugins/prompt-smith/skills/skill-creator/SKILL.md` / `assets/eval-review.html`
- `plugins/prompt-smith/evals/*.json`(3 本)
- `plugins/prompt-smith/docs/skill-creator-port-rationale.md`

### 12.2 変更

| ファイル | 変更 |
| --- | --- |
| `pnpm-workspace.yaml` | `plugins/prompt-smith` を追加 |
| `plugins/prompt-smith/.claude-plugin/plugin.json` | `0.2.0-dev` → `0.3.0-dev` |
| `plugins/prompt-smith/skills/prompt-smith/SKILL.md` | §description の担当 を §7.1 のとおり差し替え。description に境界の 1 文を追加 |
| `plugins/prompt-smith/references/description-guide.md` | §8.3 のとおり改稿。skill 専用の 5 行を `skill-creator` の本文へ移し、§直したときの確かめ方 14 行を削除 |
| ルート `README.md` | prompt-smith の提供スキルに `skill-creator` を追加 |
| `.raphael/antibodies/ab-2026-0802-001.md` | 代替として指すパスを移植版へ。`plugins/raphael/scripts/update-antibody.mjs patch` を使い、`.raphael/antibodies/*.md` を手で編集しない |

### 12.3 変更しないもの

- `plugins/prompt-smith/references/agent-definition-spec.md`
- `plugins/prompt-smith/skills/agent-creator/SKILL.md`(改稿後の `description-guide.md` を参照し続ける。参照先の節の増減は受けるが、記述は変えない)
- `.claude-plugin/marketplace.json`(コンポーネントは自動検出)

## 13. リスク

| リスク | 影響 | 対処 |
| --- | --- | --- |
| 公式 `skill-creator` と名前が重なる | available_skills に同用途の description が 2 つ並び、発火が割れる | 公式プラグインを外す。外さない場合は description で境界を明示し、eval の should-not-trigger 側に相手が正解の依頼を入れて測る |
| 移植で改善ループの挙動が変わる | 壊れたループが回り続ける | §11.1 の対照実験と §11.2 の自己適用で確かめる |
| `--timeout` の既定 30 秒がローカルプロキシ環境で足りない | 全問がタイムアウトし「発火せず」になる | 初回測定で全問が 0 のときはタイムアウトを疑う。伸ばして再測する規律を本文に書く |
| 測定のばらつき | 1〜2 問の差で description を疑う誤診 | §8.1 の規律を本文に書く |
| `${CLAUDE_PLUGIN_ROOT}` がサンドボックスで解決しない | 測定対象が原文と異なる | 第一手で打ち切るため発火判定には影響しない。docs に注記する |
| ユーザースキル・プラグインのスキル・同梱スキルを隔離できない | スコアが測定者の環境に依存し、他マシンや過去の値と比較できない | 消せない制約として受ける。§8.1 に「環境が変わった後の値を前の値と比べない」を書く |
| `.claude/commands/` が将来 自動ロードされるようになる | §1 の診断が失効し、移植の前提が崩れる | §11.1 の判定表で「どちらも同じだけ発火する」を前提の疑いに割り当てておく |
| 前方一致が名前空間接頭辞に効かない | サンドボックス以外の形態で測ろうとしたとき発火漏れになる | サンドボックスはプロジェクトスキルとして登録するため接頭辞は付かない。この形態を変えるときは §4.1.1 を読み直す |

## 14. 実装順序

| 順 | 作業 | 完了条件 |
| --- | --- | --- |
| 0 | `LICENSE` / `NOTICE` を置く | 移植コードを 1 行も置く前に完了している |
| 1 | ビルド基盤(`package.json` / `build.ts` / workspace 登録) | `pnpm build` の出力に `prompt-smith-scripts` が現れる |
| 2 | `src/lib/*` + テスト | vitest が §10 の項目すべてで通る。サンドボックスの一時ディレクトリが、祖先に `.claude` を持たない場所に作られることを含む |
| 3 | `run-trigger-eval` + テスト | §11.1 の対照実験で skills 経路だけが発火する。他の 2 つの観測になった場合は表に従って切り分ける |
| 4 | `improve-description` | 単体で `<new_description>` を返す |
| 5 | `run-loop` + `generate-report` | 3 問程度の小さな eval で 2 反復回る |
| 6 | `eval-review.html` の移植 | プレースホルダ 3 つを置換してブラウザで開き、エクスポートできる |
| 7 | `skills/skill-creator/SKILL.md` | §8.6 の対応表の「移植後の所在」が、本文または参照先にすべて存在する。「移植しない」と記した 3 節を除く |
| 8 | `prompt-smith/SKILL.md` の差し替え | §7.1 の 3 行に置き換わり、逆向きの経路が残っていない |
| 8.5 | `references/description-guide.md` の改稿 | §8.3 の 6 行すべてが済み、`grep -n "skill-creator を使えない\|直したときの確かめ方" description-guide.md` が 0 件 |
| 9 | `evals/*.json` 3 本 | 各 20 問、内訳が §6.1 を満たす |
| 10 | 自己適用 | §11.2 が通る |
| 11 | README・plugin.json・抗体・docs | §12.2 のすべて |

### 依存関係

- 段 0 は段 2 以降の前提。ライセンス表示のないまま移植コードを置かない
- 段 3 は段 2 の純関数が揃ってから。パーサ単体が通らないうちに実測へ進まない
- 段 5 は段 3 と段 4 の両方を前提とする
- 段 10 は段 3・5・9 の三つを前提とする
- 段 8 は段 7 の後。`prompt-smith` から経路を外す前に、受け側のスキルが存在している必要がある
- 段 8.5 も段 7 の後。`description-guide.md` から規律を削る前に、移し先である `skill-creator` の本文が存在している必要がある

## 15. 判断を保留した事項

| 事項 | 状況 |
| --- | --- |
| 公式 `skill-creator` プラグインを外すか | ユーザー環境の設定であり、リポジトリの変更ではない。§13 で影響だけを示す |
| output eval とベンチマーク集計 | §2 で対応範囲外と決めた。必要になった時点で別途設計する |
| `--timeout` の既定値 | 移植元どおり 30 秒とする。ローカルプロキシ環境で足りるかは初回測定で判定する |
| 移植元が更新されたときの同期 | 追従の手順を決めていない。移植元のバージョンと参照日を NOTICE に記録し、差分の照合は人が行う |
| 常駐スキルのカタログを `environment` に記録するか | 記録できれば環境差の切り分けが進むが、`claude -p` から一覧を取る手段を確認していない。今回は記録しない |
| 他プラグインへの eval 展開 | `prompt-smith` の 3 スキル以外は未着手 |
