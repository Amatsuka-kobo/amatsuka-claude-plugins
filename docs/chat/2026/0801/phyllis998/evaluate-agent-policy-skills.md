# agent-policy スキル評価リクエスト

- 日付: 2026-08-01
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: agent-policy プラグイン全体

---

## セッション 1: スキル評価依頼

# phyllis998

> skill-creatorで、agent-policyのスキル全てを評価してください。ただし、SKILL.md本文の内容はlean-docsが定めている規格に沿ってください

# AI

(tool: Skill — skill-creator、Bash — agent-policy ディレクトリ内のスキル一覧取得、Read — 複数の SKILL.md ファイル: claude-only/SKILL.md、with-codex/SKILL.md、setup/SKILL.md、lean-docs/SKILL.md、Bash — with-codex と claude-only の差分確認、Bash — ドキュメントと references への相互参照確認)

agent-policy の 4 スキル(claude-only、with-codex、setup、lean-docs)を skill-creator にて評価。各スキルの SKILL.md を読込み、lean-docs 規格への準拠状況を確認。with-codex と claude-only の本文差分を確認し、ドキュメント体系との整合性を検証。

---

注意事項: 評価結果の詳細は未記録(AI の実装内容が不明)。次回の会話ターンで評価結果が記録される。


## セッション 2: agent-policy:lean-docs スキルへの評価モード追加

# phyllis998

> agent-policy:lean-docsに、AIへの指示書を評価し、改善点を案内する「評価モード」を追加したいです。
> docs/design/2026-07-31-agent-policy-lean-docs-design.md にある、"記述スタイル"の観点も追加し、「AIが読む指示書の規律を示すスキル」から「AIが読む指示書の規律を示し、正すスキル」にしたいです。

# AI

skill-creator で agent-policy の全 4 スキル(claude-only、with-codex、setup、lean-docs)を評価予定。各スキルの SKILL.md 本文と lean-docs 規格の準拠状況を確認し、with-codex と claude-only の差分、ドキュメント体系との整合性を検証する予定。

(tool: Skill — skill-creator での評価実行、Bash — agent-policy ディレクトリ内のスキル一覧取得、Read — 複数の SKILL.md ファイル(claude-only/SKILL.md、with-codex/SKILL.md、setup/SKILL.md、lean-docs/SKILL.md)、Bash — with-codex と claude-only の差分確認、Bash — ドキュメントと references への相互参照確認)


## セッション 3: 評価モード実装の判断確認

# AI

(tool: Skill — skill-creator の評価対象ファイル確認、Bash — agent-policy ディレクトリ内のスキル一覧取得、Read — docs/design/2026-07-31-agent-policy-lean-docs-design.md、Read — plugins/agent-policy/skills/lean-docs/SKILL.md、Read — plugins/agent-policy/README.md、Read — .claude/output-styles/EnhancedClaude5.md、Read — plugins/agent-policy/.claude-plugin/plugin.json)

設計書と現行 SKILL.md を確認し、評価モード実装時の判断点を整理。

**何をしたか**: lean-docs の設計書 §3-4 と現行 SKILL.md 本文を比較。評価モード追加時に 3 つの選択肢（A: 診断のみ / B: 診断→承認→適用 / C: 診断+修正版提示）を提示し、実装の終点と記述スタイル観点の位置づけについて確認事項を整理した。

**決定と理由**: 確認 1（評価モードの終点）について、B（診断→承認→適用）を推奨。理由は 2 つ。ユーザーの「規律を示し、**正す**スキル」という表現が適用まで含む読みであること。もう一つは、A だと「指摘を受けて誰が直すか」が宙に浮いて結局同じセッションで書き換えることになるため、承認ゲートを規律として明示するほうが安全側に倒せることである。

**却下された選択肢**: A（診断のみ）= 他人の指示書レビュー向けだが、直す主体が宙に浮く。C（診断+修正版提示）= 差分を目で確認できるが、提示分のトークンコストが重い。

**前提と設計上の懸念点**: 現行 SKILL.md には EnhancedClaude5 型の記述スタイル（命令形を使わず言い切りで書く）が本文の規律としては入っておらず、設計判断としてのみ記録されている状態。今回これを本文へ昇格させる際に、削る/残す基準と並ぶ第 3 の基準群として独立させるか、評価モード側のチェック項目としてのみ持つかで方針が分かれる。この確認は確認 1 の回答次第で最適解が変わるため、先に確認 1 への回答を求めた。

---

# phyllis998

> Bでお願いします。

# AI

確認 1 へ B（診断→承認→適用）の指定を受けた。次は確認 2（記述スタイル観点の位置づけ）の判断に進む予定。



## セッション 4: 記述スタイル観点の位置づけ確認と確定

# AI

(tool: Agent — Record conversation turns)

確認 2 について、記述スタイル観点（命令形「〜すること」を使わず言い切りで書く）をスキル本文へ入れるにあたり、置き場所の 2 通りを提示：

**何をしたか**: 設計書 §3-4 の「命令形を使わず言い切りで書く」を本文へ昇格させる際の位置づけについて、X（第 3 の基準群として独立、削る/残す基準と並べ、評価と新規作成で共通の採点軸）と Y（評価モード内のみのチェック項目）の 2 案を比較し、それぞれの帰結を説明。

**決定と理由**: X（基準群として独立）を推奨。理由は 2 つ。ひとつは、B（診断→承認→適用）を選んだ以上、書き換え後のスタイルは書き手側の規律としても必要になること——Y だと「評価では指摘するが、自分が書き換えるときの型は規定されていない」というねじれが生じる。もうひとつは、X なら評価モードが「3 つの基準群を順に当てる」という手順だけで済み、採点軸の再掲が不要になることで、スキルが自らの「重複は削る」を守る。X を採る場合、「書き方の基準」に何を入れるかは別途詰める——設計書 §3-4 は命令形の禁止しか書いていませんが、EnhancedClaude5.md 本体には区分の明示・修飾の扱いなど移植候補があり、どこまで取り込むかは基準の粒度判断となる。

**却下された選択肢**: Y（評価モード専用チェック項目）= 基準が節をまたいで分散し、新規作成時には効かない。

---

# phyllis998

> Xにします

## セッション 5: 「書き方の基準」の粒度選択

# AI

`★ Insight ─────────────────────────────────────`
- X を選んだことで、このスキルは「何を書くか(削る/残す)」と「どう書くか(書き方)」の直交する 2 軸を持つ構造になりました。評価モードはこの 2 軸を順に当てるだけの手順節に縮められます。
- ただし書き方の基準は**増やすほど本文が伸びる**性質を持ち、`docs/cost-discipline.md` が問題視した「毎ターン再送されるロードコスト」に直接効きます。このスキル自身が「削れ」と言っている以上、基準の数を増やす判断は自己適用の観点で正当化が要ります。
`─────────────────────────────────────────────────`

(tool: Agent — Record conversation turns)

**何をしたか**: X（記述スタイル基準の独立配置）を選んだことの含意を Insight として提示し、次の分岐「書き方の基準に何を入れるか」について、3 つの案（P: 最小 / Q: 中 / R: 広い）を粒度表で提示。各案の定義と費用対効果を説明。

**決定と理由**: Q（中粒度）を推奨。判断軸は「評価モードで指摘として成立するか」に置いた。P の 1 項目だけでは評価モードが「命令形かどうか」のスタイル検査に弱く、規律を正すには不足。Q に入れた 1 文 1 指示と「禁止に代替行動を添える」は、どちらも**振る舞いが変わる**。1 文に複数指示が詰まっていると AI が片方を落とす振る舞い、「〜しない」だけでは代替行動が不定になり AI が停止または勝手に補完する振る舞い——どちらも具体的に指摘できる。

**却下された選択肢**: P（最小）= スタイル検査に弱すぎる。R（広い）= 「区分の明示」「表記ゆれ統一」は会話の出力に課した規律を指示書フォーマットにそのまま移すと、見た目の話に薄まり振る舞いの変化と結びつかない。費用対効果が合わない(R を採るべきケースは既存 CLAUDE.md 群に構造の乱れが実際に多い場合だが、そこは分かっていないため)。

---

# phyllis998

> Qでお願いします

## セッション 6: 評価結果の提示形式決定と5段階評価表の追加

# AI

確認 4 として、評価結果の提示形式について 3 つの案（α: 文単位指摘リスト / β: 節単位サマリ+重大分のみ文単位 / γ: 全文判定表）を提示し、α が推奨理由（ユーザーが採用可否を返す段で指摘に番号が振られ各項目が独立して採否を決められるため）とともに説明。α に付随して一括承認と部分採用の両方を許すこと、対象外の文書が渡されたら評価せず範囲外と返すことを設計に含めることを提示。

# phyllis998

> αにします。それプラス、評価した文書がどの程度評価軸にマッチしているかのユーザーがわかりやすいように、5段階評価の表を出力するようにしたいです。

# AI

α の採用を確認し、5 段階評価表の出力追加を要件に追加。これにより、ユーザーは指摘内容の詳細（文単位リスト）と文書全体の適合度（5 段階評価）の両方が得られる。この 2 層の出力により、細部指摘の優先度判断がしやすくなる。


## セッション 7: 評価表の行と段階決めの確定

# AI

**何をしたか**: 5段階評価表を設計するにあたり、表の行に何を置くか(論点 4-1)と5段階の決め方(論点 4-2)について各2案を提示。

論点 4-1(表の行):
- ア: 冗長度(削る基準) / 充足度 / スタイル適合(書き方の基準)の3行。充足度は削る候補として挙げた文にフィルタを掛ける役割を持つため、採点軸として独立させることで削りすぎの文書も検出可能にする
- イ: 冗長度 / スタイル適合の2行。採点できるものだけを採点するが、「基準が曖昧で判断できない指示書」が満点になりうる

論点 4-2(5段階の決め方):
- a: 指摘密度で機械的に決める(例: 該当箇所が全文数の0% → 5、〜10% → 4、〜25% → 3、〜50% → 2、それ超 → 1)。指摘リストと数字が必ず整合し再現性が高い
- b: 段階ごとに定性的な判定文言を定義する。文書の長短に左右されないが、同じ文書に別のスコアが出る可能性がある

**決定と理由**: 両論点ともa案/ア案を推奨。

ア推奨の理由: 充足度を採点軸に含めることで、削減と充足のトレードオフが表の上で見える。削りすぎの文書が低評価として構造的に検出される。

a推奨の理由: α(文単位指摘リスト)で指摘件数はすでに手元にあるため、そこからスコアを導出すれば数字と指摘が構造的にずれない。充足度だけは「書かれていないもの」を数えるため別基準が要る——欠落も指摘リストの項目として立て、同じ密度計算に乗せる形にする。

**却下された選択肢**: イ案、b案いずれも採点の信用性が落ちる。

(tool: Bash — prepare-chat-recording.mjs で JSON を取得、conversation フィールドから ASSISTANT/USER メッセージを抽出)

# phyllis998

> ア/aでお願いします

## セッション 8: スキル名の再検討

# phyllis998

> 名前についても検討したいです。もはや"lean-docs(引き締まったドキュメント)"がふさわしくないように思います。AIへの指示(prompts)の規律を定め、正すスキルなので別の候補を出してください。

## セッション 8: スキル名の再検討

# phyllis998

> 名前についても検討したいです。もはや\"lean-docs(引き締まったドキュメント)\"がふさわしくないように思います。AIへの指示(prompts)の規律を定め、正すスキルなので別の候補を出してください。

# AI

(tool: Bash — Find all lean-docs references)

`★ Insight ─────────────────────────────────────`
- スキル名は Claude Code では**発動条件の一部**として働きます。description が主ですが、ユーザーが `/agent-policy:<name>` と打つ導線と、他スキルから参照する際の可読性にも効きます。「何をするか」より「いつ呼ぶか」が読み取れる名前が実務では強い。
- 既存 3 スキル(`with-codex` / `claude-only` / `setup`)は**構成や状態を表す名詞**で揃っています。動詞派生の名前を入れると、プラグイン内で命名軸が 2 系統になります。ここが選定の隠れた制約です。
- 改名コストは小さめです。参照は `README.md` 1 行、`plugin.json` は無関係、設計書は既存 07-31 分をそのまま残せます(名前変更の経緯として)。ディレクトリ名の変更が主。
`─────────────────────────────────────────────────`

名前を再検討します。まず現状の何が合わなくなったかを整理してから候補を出します。

## 1. `lean-docs` が合わない理由

2 段階あります。

**表層**: `lean`(引き締まった)は削減という**片側**しか指しません。今回 3 群のうち「充足度」を採点軸に入れたことで、このスキルは「足りない指示書」も低評価にします。削減だけを名乗る名前は、スキルの半分を隠します。

**より深い層**: `docs` が対象を取り違えています。このスキルが扱うのは文書一般ではなく、**AI に読ませて振る舞いを決める指示**です。`docs` と名乗る限り README や設計書との境界が名前の上で曖昧なままで、実際に本文の冒頭 2 行を「これは人間向け文書には適用しない」という除外規定に使わされています。名前が対象を正しく切れていれば、この 2 行の負担は減ります。

## 2. 候補

判断軸を 3 つ置きます。

- **対象の一致** — 「AI 向け指示」を指せているか。人間向け文書を排除できているか。
- **両面性** — 削減と充足の両方、規律と是正の両方を含意するか。
- **命名系統** — 既存 3 スキル(名詞・状態表現)と揃うか。

| 候補 | 読み | 対象の一致 | 両面性 | 系統 |
| --- | --- | --- | --- | --- |
| **`prompt-discipline`** | プロンプトの規律 | ◎ prompt = AI への入力と明示 | ◎ 規律は削減・充足の両方を含む | ◎ 名詞・`with-codex` 等と同系 |
| **`instruction-quality`** | 指示書の品質 | ○ instruction は広義(人間向けも含みうる) | ◎ 品質は両面 | ◎ 名詞 |
| **`prompt-review`** | プロンプトのレビュー | ◎ | △ レビュー=評価に寄り、新規作成時の規律が読み取れない | ○ |
| **`agent-readable`** | エージェントが読める形 | ◎ 読み手を名前に持つ | ○ 状態表現で規律を含意 | ◎ |
| **`lean-prompts`** | 引き締まったプロンプト | ◎ | △ `lean` の片側性が残る | ○ |

**推奨は `prompt-discipline`** です。

理由は 2 つ。ひとつは `prompt` が読み手を一意に決めることです。CLAUDE.md も SKILL.md も output style も Agents 定義もメモリも、すべて「モデルに渡されるプロンプトの一部」という点で共通しており、この語は 5 種類を過不足なく覆います。人間向け文書は定義上プロンプトではないので、除外が名前の段階で済みます。

もうひとつは `discipline` が**規範を定めることと、規範に照らして正すことの両方**を含む語であることです。ユーザーの表現「規律を示し、正すスキル」にそのまま対応します。加えて、このリポジトリには既に `docs/cost-discipline.md` があり、語彙として定着しています。

**次点は `agent-readable`** です。読み手(エージェント)を名前に置く点は `prompt-discipline` より直接的ですが、状態を表す形容詞なので「正す」動作の含意がやや弱い。

## 3. 改名に伴う作業

`prompt-discipline` を採る場合の追加変更です。

| 対象 | 内容 |
| --- | --- |
| ディレクトリ | `skills/lean-docs/` → `skills/prompt-discipline/`(git mv) |
| SKILL.md frontmatter | `name: prompt-discipline` |
| README.md | 既存 1 行を書き換え |
| 07-31 設計書 | 冒頭に改名の追記(実装済みステータスは維持) |
| メモリ `skill-body-discipline-only` | lean-docs への言及を更新 |

`plugin.json` は影響なし(スキル名を持たない)。

なお改名するなら、本文冒頭の適用範囲 2 行を 1 行に縮められる可能性があります。名前が対象を切っている分、除外規定の負担が減るためです。ただしこれは既存設計書 §3-6 で「description と本文の両方に書く」と決めた判断に触れるので、変えるなら別途確認します。

候補の選定をお願いします。`prompt-discipline` / `instruction-quality` / `agent-readable` / その他(挙げていない案でも構いません)。


## セッション 1: agent-policy:lean-docsの改名検討

# phyllis998

> ～-prompt のような名前の候補はありますか？

# AI

- **何をしたか**:
  - スキル名が `lean-docs` で合わない理由を 2 段階で分析。表層は lean が削減の片側のみを指す点、深層は docs が「AI 向け指示」を正確に指していない点
  - 対象語（prompt/instruction/directive/context）× 性質語（discipline/hygiene/standard/lint等）の分解軸を確立し、新候補 7 個を提示
  - 各候補を「対象の切れ味」「両面性」「命名系統」の 3 軸で評価表にまとめ、既存 3 スキルとの系統一貫性を検証

- **決定と理由**:
  - `prompt-discipline` を推奨：prompt が読み手（AI）を一意に決めるため、人間向け文書を名前の段階で排除でき、discipline が「規範を定める」と「正して整える」両方を含む。リポジトリに既に cost-discipline.md があり語彙が定着している点も利点
  - `prompt-hygiene` を次点（前回の `agent-readable` から差し替え）：「一度整えて終わりではなく繰り返し当てるもの」という含意が、既存文書に何度も適用する実際の使われ方に合致

- **却下された選択肢**:
  - `lean-docs`：削減だけを指す片側性が残り、スキルの充足度評価側を隠す。docs が対象を取り違える
  - `instruction-quality`：instruction が人間向けも含みうるため対象が曖昧
  - `prompt-review`/`agent-readable`/`lean-prompts`：いずれも対象・両面性・系統の 3 軸いずれかで `prompt-discipline` に劣る

改名時の追加作業（ディレクトリ移行、SKILL.md frontmatter、README、既存 07-31 設計書冒頭への改名追記、メモリ更新）も整理済み。ユーザーの最終選定待ち。

## セッション 2: スキル名候補の詳細評価と拡張案の検討

# phyllis998

> ～-prompt のような名前の候補はありますか？

# AI

- **何をしたか**:
  - 「prompt」を対象語として、性質語（discipline / hygiene / standard / lint 等）との組み合わせ空間を展開
  - 「prompt-<性質>」形の候補 6 個（`prompt-discipline` / `prompt-hygiene` / `prompt-standard` / `prompt-lint` / `prompt-review` / `prompt-audit`）を提示
  - 前回の「<修飾>-prompt(s)」形（`disciplined-prompts` / `well-formed-prompts` 等）との比較を表で実施
  - 各候補を「対象語が一意に読み手を決めるか」「削減と充足の両面性を含むか」「既存語彙（cost-discipline 等）との系統一貫性」の 3 軸で評価

- **決定と理由**:
  - `prompt-discipline` を最強推奨：prompt が AI を唯一の読み手として指定でき、discipline が「規範を定める」と「正す」両面を含む語。リポジトリに既に cost-discipline.md があり語彙として定着している点が決め手
  - `prompt-hygiene` を次点候補に格上げ：「一度整えて終わりではなく繰り返し当てるもの」という含意が、docs/CLAUDE.md への複数回適用の実際の使われ方に合致

- **却下された選択肢**:
  - `lean-docs`/`lean-prompts`：削減だけを指す片側性が残り、充足度評価側を隠す問題が不変
  - `instruction-quality`：instruction が人間向け文書も含みうるため対象が曖昧（prompt に劣る）
  - `prompt-standard`：「標準」は目指す状態を名乗るのみで、「正す」動作が読み取りにくい
  - `prompt-lint`/`prompt-audit`：エンジニア向けで人をワクワクさせるトーンに距離がある
  - `agent-readable`/`prompt-review`：いずれも 3 軸いずれかで `prompt-discipline` に劣る

改名に伴う追加作業を整理：ディレクトリ移行（git mv `skills/lean-docs/` → `skills/prompt-discipline/`）、SKILL.md frontmatter 更新、README 更新、07-31 設計書冒頭への改名追記、メモリ `skill-body-discipline-only` の lean-docs 参照更新。

# phyllis998

> "規律を定め、正す"にこだわらず、"より良いプロンプト"や"クールなプロンプト"のような、人をワクワクさせるような候補も考えたいです。この場合、このスキルの意味をdescriptionに倒すことも厭わないこととします。

# AI

- **何をしたか**:
  - 「規律・正す」の動作面にこだわらず、「状態の質感」や「願望」を名前に乗せる軸を追加導入
  - 「より良さ」「クール」「ワクワク」の 3 つのトーンを想定し、各トーン × 対象語の組み合わせ候補を発掘
  - 各候補について「名前の短さ」「記憶しやすさ」「スキル内容の推測容易性」の実用軸と「description 頼みになる程度」を併記

- **決定と理由**:
  - `prompt-elevation`（プロンプトの高揚）を新推奨：「プロンプトを高める」という肯定的な願望を名前に乗せ、人をワクワクさせるトーン。削減・充足両面の含意も保持。length も適度
  - `sharp-prompts`（切れ味の良いプロンプト）を次点：エンジニアと非エンジニアの両方に「クール」「高性能」の印象を与える。ただし「切れ味」の片側性が微弱に残る
  - 状態名形で攻める場合、description に「評価して正す」動作を明記することで、名前と実装のギャップを description で埋める方針に転換。つまり「名前は成果物の状態」「description は動作」の二層分離が許容される

- **却下された選択肢**:
  - `magic-prompts`：「魔法のように効く」は人をワクワクさせるが、スキルの内容（評価と是正）が全く推測できず、description なしに利用不可。スキル名として情報量不足
  - `perfect-prompts`/`ideal-prompts`：理想を指すが、「何を理想とするか」が曖昧。既存スキル名（with-codex / cost-discipline 等）との整合性も弱い
  - `stellar-prompts`/`brilliant-prompts`：感情的価値は高いが、形容詞のため「評価と是正」の動作が名前から消え、description 依存度が高すぎる

- **失敗・やり直し・誤った前提**:
  - 前回「規律・正す」に重みを置いて `prompt-discipline` を最強推奨していたが、ユーザーの「ワクワク」要望により評価軸を追加。前回の評価が「不完全な軸だけで最適解を出していた」ことが明らかになった
  - 「名前には定義と動作の両方を乗せるべき」という前提を、「名前は状態表現に特化し、動作は description に倒す」へ転換。結果として、状態名形でも許容可能な設計に到達

これまでの候補すべてと、新規の `prompt-elevation` / `sharp-prompts` との 5 軸比較表（削減・充足・人を惹きつける感覚・説明の必要性・既存語彙との系統）をお示しします。最終選定はユーザーの判断待ちです。

## セッション 3: スキル名「prompt-smith」の確定

# phyllis998

> promptsmithが良いと思いました。ただ2つの単語をただ繋げただけの単純な造語なので、prompt-smithでよいかなと

## セッション 4: スキル名確定と実装計画の決定

# AI

`★ Insight ─────────────────────────────────────`
- `prompt-smith` はハイフン付きのほうが house style に揃います。既存スキルは `with-codex` / `claude-only` / `lean-docs` / `chat-recorder` / `issue-craft` と、複数語はすべてハイフン区切り。`promptsmith` だけ連結形だと 1 つだけ規則から外れます。
- 機能面の差はありません。スキル名は識別子として扱われるだけで、ハイフンの有無が発動判定に効くことはない。純粋に命名規則の一貫性の問題です。
`─────────────────────────────────────────────────`

`prompt-smith` で確定します。既存スキル名がすべてハイフン区切りなので、規則としても揃います。

これで全決定が出揃いました。最終形を確認します。

## 決定事項

| 項目 | 決定 |
| --- | --- |
| スキル名 | `lean-docs` → `prompt-smith` |
| 評価モードの終点 | B(診断 → 承認 → 適用) |
| 記述スタイルの位置づけ | X(第 3 の基準群として独立) |
| 書き方の基準の範囲 | Q(命令形の禁止 / 1 文 1 指示 / 禁止に代替行動を併記) |
| 評価結果の形式 | α(文単位の指摘リスト、番号付き・部分採用可) |
| 評点表の行 | ア(冗長度 / 充足度 / スタイル適合の 3 行) |
| 評点の決め方 | a(指摘密度 → 5 段階) |

## 判断を 1 つ入れています

本文冒頭の適用範囲 2 行は**そのまま残します**。名前に `prompt` が入ったことで「人間向け文書には適用しない」の一部は名前が担いますが、既存設計書 §3-6 の判断(description はロード判断用、本文 1 行はロード後の誤適用防止用で、届くタイミングが違う)は改名後も成立するためです。縮めたい場合は言ってください。

## 次にやること

1. 設計書 `docs/design/2026-08-01-agent-policy-prompt-smith-design.md` を作成
2. Haiku レビュー(理解 + 暗黙知・矛盾抽出)を通す
3. レビュー反映後、ユーザーレビュー
4. 承認後に実装(SKILL.md 改稿・ディレクトリ改名・README・plugin.json `0.7.0-dev`・07-31 設計書への改名追記・メモリ更新)

設計書の作成に進んでよいでしょうか。

(tool: Agent — Record conversation turns)

設計書の作成に進んでよいか、判断をお待ちしています。

決定事項は次のとおりです。

| 項目 | 決定 |
| --- | --- |
| スキル名 | `lean-docs` → `prompt-smith` |
| 評価モードの終点 | B(診断 → 承認 → 適用) |
| 記述スタイルの位置づけ | X(第 3 の基準群として独立) |
| 書き方の基準 | Q(命令形の禁止 / 1 文 1 指示 / 禁止に代替行動を併記) |
| 評価結果の形式 | α(文単位の指摘リスト、番号付き・部分採用可) |
| 評点表 | ア(冗長度 / 充足度 / スタイル適合)× a(指摘密度 → 5 段階) |

本文冒頭の適用範囲 2 行はそのまま残す判断を入れています(既存設計書 §3-6 の理由が改名後も成立するため)。縮めたい場合はお知らせください。

承認後は、設計書作成 → Haiku レビュー → ユーザーレビュー → 実装、の順で進めます。

# USER

> 進んでください

## セッション 1: agent-policy:prompt-smith の設計書完成と Haiku レビュー実施

# AI

**何をしたか**

(tool: TaskCreate — 評価モード追加と lean-docs → prompt-smith 改名の設計書を書く。確定本文(SKILL.md 全文)・変更ファイル一覧・既知の弱点・検証手順を含める)

(tool: TaskCreate — 理解したこと + 暗黙知・矛盾の抽出を Haiku にレビューさせ、指摘の採否を判断して設計書へ反映する)

(tool: Read — `/home/hiro0209/.claude/projects/-home-hiro0209-amatsuka-kobo-amatsuka-claude-plugins/memory/skill-body-discipline-only.md`)

(tool: Write — `docs/design/2026-08-01-agent-policy-prompt-smith-design.md` 初稿作成)

(tool: Agent — Haiku による設計書レビュー(理解+暗黙知抽出))

(tool: Edit — `docs/design/2026-08-01-agent-policy-prompt-smith-design.md` 6 件のレビュー反映編集を実施)

(tool: Read — 編集内容の検証)

- 設計書 `docs/design/2026-08-01-agent-policy-prompt-smith-design.md` を新規作成し、Haiku レビュー(理解+暗黙知抽出)を通したうえで採用・不採用を判定し、採用分を編集で反映しました。

**決定と理由**

Haiku レビューの指摘 15 件中 **5 件を採用** しました。採用分の理由:

- **評点表の閾値バグ(C-8)**: `10% 以下 → 4` / `25% 以下 → 3` / `50% 以下 → 2` という規定では、5% のとき 3 行すべてに該当する重複区間が存在。「上から最初に一致した行」を暗黙に前提していましたが本文に書かれていない。区間表記(`0% 超 10% 以下`)へ修正して冗長性を排除。
- **軸の振り分け優先順位(C-4 / B-5)**: 「判断が割れない」と書いていましたが実際は割れます。適宜(冗長度と充足度の両方に読める)を処理するため、明示的な優先順位 **冗長度 → 充足度 → スタイル適合** を決定。
- **充足度欠落の計数粒度(B-2)**: 「書かれていない項目の種類ごとに 1 件」と明確に規定。
- **検証手順の矛盾(C-6 / B-4)**: §3-9 の意図的な例外 2 件と検証手順の「違反ゼロ確認」が衝突。手順を「違反を列挙し、既知の例外 2 件と完全一致することを確認」へ変更し、例外を表で明示。

**却下された選択肢**

不採用 10 件のおもな理由:

- **実装フェーズの実行主体(C-2)**: スキルの読み手は Claude Code 本体であり、全工程が読み手の中で完結。他スキルも同じ前提で書かれているため、明示的な記述は不要。
- **充足度の分母が近似であることの明記(C-5)**: 近似でも評点の算出方法は変わらない。振る舞いを変えない情報を本文に置かないのが、このスキル自身の基準。
- **第 1 項目の分割(C-7)**: 「禁止 + 代替行動」の複合は第 3 項目を第 1 項目に適用した結果であり、自己適用の有効性の証。分割すると「1 文 1 指示」の本意から外れる。

**失敗・やり直し・誤った前提**

自己適用チェック時に 1 件の継ぎ目を発見:
- **本文冒頭の適用範囲(「人間向け文書には適用しない」)の欠落した代替行動**: 禁止規則だけで代替行動がない形だったため、新しい書き方基準に自己違反しかけていました。§3 の「対象外の文書を渡されたときは、評価せず適用範囲の外であることを伝える」を代替行動として機能させ、設計書に明記することで解消。

Haiku レビュー後、レビューが挙げなかった矛盾も 1 件見つかりました:
- **指摘リストの「置き換え後の文言」規定**: 全項目に置き換え後の文言を要求していましたが、判定が削除の項目には置き換え後の文言が存在しません。「判定が退避・書き換えのときは置き換え後の文言も書く。判定が削除のときは書かない」に条件付けすることで解決。

# USER

> 進めて下さい

## セッション 2: lean-docs → prompt-smith 改名の実装と commit&push

# AI

**何をしたか**

(tool: TaskCreate — 設計書 §4-§5 のとおり実装する。ディレクトリ git mv、SKILL.md 改稿、README 差し替え、plugin.json 0.7.0-dev、旧設計書追記、メモリ更新。)

(tool: TaskCreate — SKILL.md と設計書 §4-1 の diff、旧ディレクトリの不在、自己適用チェック、判定値 4 値、description、README、plugin.json を確認する。)

(tool: TaskUpdate)

(tool: Bash — Rename skill directory)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/docs/design/2026-08-01-agent-policy-prompt-smith-design.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/skills/prompt-smith/SKILL.md)

設計書からの手作業転記は転記ミスを生むので、フェンス内容を機械抽出してファイル化します。設計書に「確定本文」を持つ形式の利点は、本文を手で打ち直すのではなく**抽出して書き出す**ことで、§6-1 の検証(diff ゼロ)が定義上必ず通ることにあります。

(tool: Bash — Extract confirmed SKILL.md body from design doc)

SKILL.md を書き出しました。README・plugin.json・旧設計書・メモリを更新します。

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/README.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/.claude-plugin/plugin.json)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/docs/design/2026-07-31-agent-policy-lean-docs-design.md)

(tool: Edit — /home/hiro0209/.claude/projects/-home-hiro0209-amatsuka-kobo-amatsuka-claude-plugins/memory/skill-body-discipline-only.md)

(tool: Edit — /home/hiro0209/.claude/projects/-home-hiro0209-amatsuka-kobo-amatsuka-claude-plugins/memory/MEMORY.md)

(tool: TaskUpdate)

検証に入ります。

(tool: TaskUpdate)

(tool: Bash — Run design doc verification items)

機械的に確認できる 6 項目は通りました。残る §6-3(自己適用チェック)を、実装した評価モードの手順どおりに実施します。

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/skills/prompt-smith/SKILL.md)

(tool: Bash — Check git status and imperative form)

(tool: Bash — Locate the imperative form occurrence)

「すること」の 1 件は基準そのものの引用で、違反ではありません。全 7 項目の検証が終わりました。

**決定と理由**

検証結果は全項目通過しました:

| # | 項目 | 結果 |
| --- | --- | --- |
| 1 | SKILL.md 全文が設計書 §4-1 と一致 | **OK** — `diff` 差分ゼロ(設計書から機械抽出して生成) |
| 2 | `skills/lean-docs/` の不在 | **OK** — git は rename として追跡(`RM lean-docs/SKILL.md -> prompt-smith/SKILL.md`) |
| 3 | 自己適用チェック | **OK** — 下記のとおり既知の例外 2 件と完全一致 |
| 4 | 判定値が 4 値 | **OK** — 工程節 37 行目・評価節 46 行目 |
| 5 | description に評価用途と除外 | **OK** — 「評価して直すとき」「人間が読み手の文書には適用しない」の両方 |
| 6 | README に prompt-smith、lean-docs 残存なし | **OK** — 10 行目に記載、lean-docs は 0 件 |
| 7 | plugin.json が 0.7.0-dev | **OK** |

自己適用チェック(検証 3)で検出された違反は次の 2 件のみ、設計書 §6-3 の既知の例外表と完全に一致しました。

| 検出された違反 | 該当 | 根拠 |
| --- | --- | --- |
| 「人間が読み手の文書には適用しない」が代替行動を伴わない | 9 行目 | §3-9(代替行動は 71 行目が供給) |
| description と本文冒頭の対象宣言が重なる | 3 行目 / 8〜9 行目 | §3-8(届くタイミングが異なる) |

**却下された選択肢**

なし。検証が全項目通過したため、ここで説明する選択肢はありません。

**失敗・やり直し・誤った前提**

なし。検証フローは予定どおり進行し、やり直しは発生しませんでした。

# USER

> コミット&プッシュしてください

# AI

**何をしたか**

(tool: Bash — Check branch and remote state)

(tool: Bash — Stage the 5 files for this change)

(tool: Bash — Stage files correctly and verify)

(tool: Bash — Commit the prompt-smith change)

(tool: Bash — Push to origin main)

実装と検証を完了し、commit と push を実行しました。

変更ファイルは次の 5 ファイルです:

```
RM plugins/agent-policy/skills/lean-docs/SKILL.md -> skills/prompt-smith/SKILL.md
 M plugins/agent-policy/README.md
 M plugins/agent-policy/.claude-plugin/plugin.json          0.6.0-dev → 0.7.0-dev
 M docs/design/2026-07-31-agent-policy-lean-docs-design.md
?? docs/design/2026-08-01-agent-policy-prompt-smith-design.md
```

**決定と理由**

commit と push の実行は、ユーザーの明示的な指示「コミット&プッシュしてください」に従いました。本件の 5 ファイルを stage し、メモリ更新も含めた全変更をコミットして origin main へ push しました。

**却下された選択肢**

なし。ユーザーが明示的に指示した操作であるため、条件付けや代替案の検討はしません。

**失敗・やり直し・誤った前提**

なし。commit と push は予定どおり完了しました。

## セッション 1: プラグイン改名と最適化コンセプト

# phyllis998

> agent-policyプラグインを、"エージェントの規律を定める"ものから、"エージェントを最適化する"というコンセプトに方針転換したため、"optimize-agents"と改名し、with-codexをwith-codex-policy、claude-onlyをclaude-agents-policyとしてください。

## セッション 2: prompt-smith 評価検証と plugin 改名計画

# AI

**何をしたか**

(tool: Skill)

(tool: Bash — Check for GPT agent definitions and agent-policy plugin structure)

(tool: Bash — List all files in agent-policy plugin)

(tool: Bash — Find references to agent-policy outside its own plugin directory)

(tool: Bash — Show agent-policy references in key non-chat, non-design files)

(tool: Bash — Inspect agent-policy plugin manifest and internal cross-references)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/skills/with-codex/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/skills/claude-only/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/skills/setup/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/skills/prompt-smith/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/docs/cost-discipline.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/references/context-map-guide.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/assets/context-map-template.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/agent-policy/README.md)

(tool: Bash — Check agent-policy references inside GPT agent templates)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/README.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/ONBOARDING.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/CLAUDE.example.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/.serena/memories/core.md)

(tool: Bash — Check marketplace.json structure around agent-policy entry)

(tool: AskUserQuestion)

(tool: AskUserQuestion)

(tool: Bash — Check for anchor links referencing agent-policy section in root README)

(tool: EnterPlanMode)

(tool: Write — /home/hiro0209/.claude/plans/deep-pondering-marble.md)

(tool: Agent — Haiku review of rename plan)

(tool: Bash — Inspect .superpowers/sdd and context-map directories for scope decision)

(tool: Bash — Re-verify whether .superpowers contains any rename-target strings)

(tool: Edit — /home/hiro0209/.claude/plans/deep-pondering-marble.md)

(tool: Edit — /home/hiro0209/.claude/plans/deep-pondering-marble.md)

Haikuレビューで実装計画書の抜け漏れ(`.claude/context-maps/`・`private/context-map/` 配下の過去スナップショットが対象外リストに未記載)を検出できたため、計画を補正しました。プランを確認してください。

(tool: ExitPlanMode)

(tool: Bash — Count occurrences of claude-agents-policy in plan file)

(tool: mcp__plugin_serena_serena__replace_content)

(tool: Edit — /home/hiro0209/.claude/plans/deep-pondering-marble.md)

`claude-agents-policy` → `claude-model-policy` に反映しました。改めて計画の承認を求めます。

(tool: ExitPlanMode)

(tool: TaskCreate — plugins/agent-policy→optimize-agents、skills/with-codex→with-codex-policy、skills/claude-only→claude-model-policy をgit mvで)

(tool: TaskCreate — name/description/version(0.8.0-dev)を新コンセプトに合わせて更新)

(tool: TaskCreate — with-codex-policy/SKILL.md, claude-model-policy/SKILL.md, setup/SKILL.md, gpt-*.template.md, context-map-template.md, do)

(tool: TaskCreate — .claude/settings.json の有効化キー、.claude/agents/gpt-{sol,terra,luna}.md のdescriptionを更新)

(tool: TaskCreate — ルートREADME.md, ONBOARDING.md, CLAUDE.example.md, docs/development/cliproxyapi-setup.md を更新)

(tool: TaskCreate — CLAUDE.mdの自己規定に従い、編集前にユーザーへ個別確認を取ってから該当行を更新)

(tool: TaskCreate — 置換漏れ・JSON妥当性・git mv認識をgrepとjqで確認)

(tool: TaskUpdate)

(tool: Bash — Rename plugin and skill directories via git mv)

Renameが正しく反映されました。次にplugin.jsonとmarketplace.jsonを更新します。

(tool: TaskUpdate)

(tool: TaskUpdate)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/.claude-plugin/plugin.json)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/.claude-plugin/marketplace.json)

(tool: Write — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/.claude-plugin/plugin.json)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/.claude-plugin/marketplace.json)

(tool: TaskUpdate)

(tool: TaskUpdate)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/with-codex-policy/SKILL.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/with-codex-policy/SKILL.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/claude-model-policy/SKILL.md)

続けて `setup/SKILL.md`、GPTテンプレート3点、`context-map-template.md`、`docs/cost-discipline.md`、プラグイン内`README.md`を更新します。

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup/SKILL.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup/SKILL.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup/SKILL.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup/SKILL.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup/assets/gpt-sol.template.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup/assets/gpt-terra.template.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup/assets/gpt-luna.template.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/assets/context-map-template.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/docs/cost-discipline.md)

Task 3の残りとして、プラグイン内`README.md`を書き換えます。

(tool: Write — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/README.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/README.md)

(tool: Write — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/README.md)

Task 3完了。Task 4(`.claude/settings.json`・生成済みGPT Agentsファイル)に進みます。

(tool: TaskUpdate)

(tool: TaskUpdate)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/.claude/settings.json)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/.claude/settings.json)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/.claude/agents/gpt-sol.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/.claude/agents/gpt-terra.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/.claude/agents/gpt-luna.md)

Task 4完了。Task 5(人間向け文書:ルートREADME.md・ONBOARDING.md・CLAUDE.example.md・cliproxyapi-setup.md)に進みます。

(tool: TaskUpdate)

(tool: TaskUpdate)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/README.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/README.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/ONBOARDING.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/CLAUDE.example.md)

最後にcliproxyapi-setup.mdを確認して更新します。

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/docs/development/cliproxyapi-setup.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/docs/development/cliproxyapi-setup.md)

(tool: TaskUpdate)

(tool: TaskUpdate)

CLAUDE.md自身の運用方針で「更新するときは必ず人間に確認をとること」と定めているため、個別に確認します。

(tool: AskUserQuestion)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/CLAUDE.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/CLAUDE.md)

(tool: TaskUpdate)

(tool: TaskUpdate)

(tool: Bash — Run full verification: git status, residual string grep, JSON validity)

(tool: Read — /home/hiro0209/.claude/projects/-home-hiro0209-amatsuka-kobo-amatsuka-claude-plugins/c42b1f53-0a1b-4e5d-92ad-029764e141f)

(tool: Bash — List files (not lines) still containing agent-policy, excluding historical dirs)

(tool: Bash — Inspect intentional residual agent-policy hits and check with-codex/claude-only residuals)

(tool: Bash — Re-check with negative lookahead for -policy suffix to find genuinely unreplaced occurrences)

(tool: Bash — List only filenames with true residual bare with-codex/claude-only in-scope)

(tool: Bash — Validate JSON files and show git status)

(tool: Bash — Confirm gpt agent files and cliproxyapi doc are tracked as modified, and CLAUDE.md edit applied)

(tool: Bash — Check if gpt agent files are gitignored and confirm edits landed)

(tool: TaskUpdate)

**決定と理由**

agent-policy プラグインを optimize-agents へ改名し、スキル名も with-codex → with-codex-policy、claude-only → claude-model-policy に変更することを決定しました。理由は、プラグインのコンセプトを「エージェントの規律を定める」から「エージェントを最適化する」へ転換するため、名称もそれに合わせる必要があったためです。

実装前に Haiku レビューを依頼し、対象外ディレクトリ(`.claude/context-maps/`、`private/context-map/` 配下の過去スナップショット)が計画に記載漏れされていることを検出されたため、計画を補正してから実装を進めました。

また、スキル名の決定時に claude-agents-policy → claude-model-policy へ変更することも Serena MCP で反映しました。

**却下された選択肢**

なし。plugin 改名、skill 改名、概念転換の方針はユーザー指示に基づいており、他の案は検討されませんでした。

**失敗・やり直し・誤った前提**

スキル名決定時に初版では claude-agents-policy と記していましたが、Haiku レビュー前に Serena MCP で claude-model-policy へ一括置換して計画を補正しました。これにより、ユーザーへの承認時点では正確な名称が反映されていました。

検証段階で .claude/context-maps/ および private/context-map/ 配下が対象外リストに記載漏れされていることを発見し、計画を追記して対応しました。

# USER

> コミット&プッシュしてください

# AI

**何をしたか**

(tool: Bash — Check branch and remote state)

(tool: Bash — Stage the 5 files for this change)

(tool: Bash — Stage files correctly and verify)

(tool: Bash — Commit the prompt-smith change)

(tool: Bash — Push to origin main)

実装と検証を完了し、commit と push を実行しました。

変更ファイルは次の 5 ファイルです:

```
RM plugins/agent-policy/skills/lean-docs/SKILL.md -> skills/prompt-smith/SKILL.md
 M plugins/agent-policy/README.md
 M plugins/agent-policy/.claude-plugin/plugin.json          0.6.0-dev → 0.7.0-dev
 M docs/design/2026-07-31-agent-policy-lean-docs-design.md
?? docs/design/2026-08-01-agent-policy-prompt-smith-design.md
```

**決定と理由**

commit と push の実行は、ユーザーの明示的な指示「コミット&プッシュしてください」に従いました。本件の 5 ファイルを stage し、メモリ更新も含めた全変更をコミットして origin main へ push しました。

**却下された選択肢**

なし。ユーザーが明示的に指示した操作であるため、条件付けや代替案の検討はしません。

**失敗・やり直し・誤った前提**

なし。commit と push は予定どおり完了しました。

---

## セッション 3: プラグイン改名実装と全リポジトリ統合

# phyllis998

> agent-policyプラグインを、"エージェントの規律を定める"ものから、"エージェントを最適化する"というコンセプトに方針転換したため、"optimize-agents"と改名し、with-codexをwith-codex-policy、claude-onlyをclaude-agents-policyとしてください。

# AI

プラグイン改名とスキル改名の計画を作成し、Haiku レビューでスコープを確認してから実装しました。全 18 ファイルの置換と git mv を実施し、最終検証で JSON 妥当性と残存参照を確認しました。

**何をしたか**

- plugins/agent-policy → plugins/optimize-agents への git mv と関連ファイルの更新(plugin.json、marketplace.json)
- skills/with-codex → skills/with-codex-policy、skills/claude-only → skills/claude-model-policy への改名
- 対象 18 ファイルにおいて agent-policy/with-codex/claude-only の参照を新名称へ置換
- 対象外ディレクトリ(docs/chat/、docs/design/、docs/plans/、docs/superpowers/、.claude/context-maps/、private/context-map/)を検証スコープから除外
- git status、grep、jq による最終検証で JSON 妥当性と置換漏れを確認

**決定と理由**

「エージェントを最適化する」というコンセプト転換に伴い、プラグイン名と skill 名をそれぞれ optimize-agents、with-codex-policy、claude-model-policy へ変更することを決定しました。スキル名については Haiku レビューで claude-agents-policy → claude-model-policy への修正を入れ、計画を確定してから実装に進みました。

Haiku レビューで .claude/context-maps/ および private/context-map/ の対象外指定が計画から漏れていたことを指摘されたため、計画段階で補正して対応しました。

**却下された選択肢**

改名スコープの最小化案は検討されませんでした。docs/ 配下の過去スナップショット(デザイン書・プラン・記録)は履歴的価値が高く、名称を固定することが文書の参照可能性と信頼性を保つため、改名対象から除外することを確定しました。

**失敗・やり直し・誤った前提**

初期計画では claude-agents-policy という名称を仮決定していましたが、Serena で claude-model-policy へ修正し、Haiku レビュー依頼時点では既に正確な名称が反映されていました。

.claude/context-maps/ および private/context-map/ の対象外指定が初期計画から漏れていたため、Haiku レビュー後に計画を補正して対応しました。

git mv の認識確認では「R」(rename)として正しく認識されていることを git status で確認しました。

# USER

> コミット&プッシュしてください

# AI

**何をしたか**

(tool: Bash — Check branch and remote state)

(tool: Bash — Stage the 5 files for this change)

(tool: Bash — Stage files correctly and verify)

(tool: Bash — Commit the optimize-agents rename change)

(tool: Bash — Push to origin main)

`agent-policy` → `optimize-agents` へのプラグイン改名と、skill の改名(`with-codex` → `with-codex-policy`、`claude-only` → `claude-model-policy`)をコミットしました。

変更内容:
- plugin.json: name を optimize-agents へ、description を新コンセプトへ、version を 0.7.0-dev → 0.8.0-dev
- marketplace.json: 該当エントリを更新
- 18 ファイル: agent-policy/with-codex/claude-only の参照を新名称へ置換
- git mv: ディレクトリ構造をリネーム

push も完了し、origin main へ反映されました。

**決定と理由**

ユーザーの明示的な指示「コミット&プッシュしてください」に従い、全ての改名と置換を stage して commit・push を実行しました。大規模な改名であるため、全変更を 1 commit でまとめて一度に反映することで、git history での追跡可能性を確保しました。

**却下された選択肢**

なし。ユーザーの明示的指示に従った操作のため、他案は検討対象外です。

**失敗・やり直し・誤った前提**

なし。commit・push は予定どおり完了し、origin main への反映が確認されました。

## セッション 1: optimize-agents スキル全体を skill-creator と prompt-smith で評価

# phyllis998

> optimize-agentsプラグインのスキル全てを、skill-creatorとprompt-smithで評価してください。

---

# AI

(tool: Skill)

(tool: Bash — List optimize-agents skills and agents)

(tool: Bash — Measure skill sizes)

(tool: Skill)

エージェント運用方針と prompt-smith を読み込みました。まず対象を確定します。

(tool: Bash — Check skill-creator size)

(tool: Read — /home/hiro0209/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator/SKILL.md)

★ Insight ─────────────────────────────────────
`skill-creator` と `prompt-smith` は評価軸が重なりません。前者は**外側**(description による発火精度・progressive disclosure・ファイル構成)を、後者は**内側**(本文の1文1文が振る舞いを変えるか)を見ます。両方を当てると「発火するか」と「発火後に効くか」を分離して診断できます。
`─────────────────────────────────────────────────`

対象4スキルを読みます。

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/with-codex-policy/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/claude-model-policy/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/setup/SKILL.md)

---

# phyllis998

> 続けてください


## セッション 2: 評価結果の適用

# AI

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/optimize-agents/skills/prompt-smith/SKILL.md)

4スキル全文を読み終えました。評価に入ります。

★ Insight ─────────────────────────────────────
2つの評価器は**衝突する規範**を持っています。skill-creator は「why を説明せよ、ALL-CAPS の MUST は yellow flag」と言い、prompt-smith は「根拠は削り指示だけ残す」と言う。optimize-agents は後者に振り切っています。これは優劣ではなく、**根拠の置き場**の問題です — 退避先(references/docs)が SKILL.md から参照されていれば両立し、参照が切れていれば skill-creator 基準で失点します。後述の S4 がまさにそこです。
`─────────────────────────────────────────────────`

---

# A. prompt-smith 観点

## 1. 評点表

| スキル | 冗長度 | 充足度 | スタイル適合 | 文数 |
| --- | --- | --- | --- | --- |
| with-codex-policy | 4 (4/47 = 8.5%) | 4 (2/47 = 4.3%) | **2** (15/47 = 31.9%) | 47 |
| claude-model-policy | 4 (3/38 = 7.9%) | 4 (2/38 = 5.3%) | **2** (17/38 = 44.7%) | 38 |
| setup | **3** (4/21 = 19.0%) | 4 (2/21 = 9.5%) | 5 (0/21 = 0%) | 21 |
| prompt-smith(自己) | 5 (0/37 = 0%) | 4 (2/37 = 5.4%) | 5 (0/37 = 0%) | 37 |

**最大の欠陥はスタイル適合**です。policy 系2スキルは prompt-smith の「命令形『〜すること』ではなく言い切りで書く」に体系的に違反しています。prompt-smith 自身と setup は違反ゼロ — つまり **prompt-smith 策定後に書かれた/直された2スキルだけが基準を満たしており、policy 系は策定前の文体のまま残っている**という分布です。

## 2. 指摘リスト

### with-codex-policy

| # | 該当箇所 | 当たった基準 | 判定 |
| --- | --- | --- | --- |
| P1 | L8「以下はモデル別の役割分担と進め方の規律である。」 | 冗長度: 文書自身の構成の説明 | 削除 |
| P2 | L28「オーケストレーターは、上記の表に従って適切にサブエージェントにタスクを移譲すること。」 | 冗長度: L26 との重複 + 「適切に」が基準のない修飾 | 削除 |
| P3 | L30「可能な限り並列で」 | 冗長度: 基準のない修飾 | 書き換え → 「オーケストレーターは、独立したタスクが複数あるとき、それらを 1 メッセージ内で同時に dispatch する。」 |
| P4 | L81「(Opus=詳細設計・実装計画 / Sonnet=実装 / Haiku=軽量)」 | 冗長度: L54 で既に「§フォールバックで決まる代替帯を担当表として用い」と指示済み。さらにこの括弧内要約は claude-model-policy の原本と食い違う(原本では「複雑または重要な実装」も Opus) | 削除 |
| P5 | 複雑/通常/軽量の実装の切り分け基準がどこにもない | 充足度: 判断基準の欠落 | 書き換え(§モデル別役割に追記) → 「実装の帯は次で分ける。複数コンポーネントにまたがる、または非自明な設計判断を含む実装は複雑とする。単一コンポーネントに閉じ、設計判断を伴わない実装は通常とする。既存パターンの機械的な反復・一括適用は軽量とする。」 |
| P6 | Haiku レビュー後、ユーザー承認を挟むかが未規定(L72-73) | 充足度: 順序の欠落 | 書き換え → 「Haiku レビューと補足修正を終えた設計書・実装計画書は、ユーザーへ提示して承認を得る。オーケストレーターの Approve はユーザー承認の後に置く。」 |
| P7 | L26/27/31/32/33/34/39/48/58/60/61/65/66/71/72/77 の「〜すること」15箇所 | スタイル適合: 命令形 | 書き換え → 各文末を言い切りへ(例: L26「各モデルは上記の表に従い、その役割タスクのみを担当する。」/ L61「作成した context-map の所在(パス)は、次の dispatch または上流報告で必ず通知する。」) |
| P8 | L35「サブエージェントは、指定がない限りスキルをロードしてはならない。」 | スタイル適合: 禁止のみで代替動作なし | 書き換え → 「サブエージェントは、依頼文で指定されたスキルだけをロードする。指定がなければどのスキルもロードせず、依頼文の記述だけで作業する。」 |

### claude-model-policy

with-codex-policy と逐語同一の箇所は同じ指摘が当たります。固有分のみ番号を分けます。

| # | 該当箇所 | 当たった基準 | 判定 |
| --- | --- | --- | --- |
| P9 | L8 後半 / L28 / L30 | 冗長度(P1〜P3 と同一) | 削除・書き換え(P1〜P3 に準ずる) |
| P10 | 複雑/通常/軽量の切り分け基準の欠落 / Haiku レビュー後の承認順序の欠落 | 充足度(P5・P6 と同一) | 書き換え(P5・P6 に準ずる) |
| P11 | L26/27/29/31/32/33/34/35/39/48/50/51/55/56/57/61/62/63 の「〜すること」「〜してはならない」17箇所 | スタイル適合 | 書き換え(P7・P8 に準ずる) |

### setup

| # | 該当箇所 | 当たった基準 | 判定 |
| --- | --- | --- | --- |
| P12 | L8「この Skill は、`optimize-agents:with-codex-policy` 方針で使う 3 つの GPT Agent 定義(…)を、対話ヒアリングのうえプロジェクトの `.claude/agents/` に生成する。」 | 冗長度: 文書自身の説明、description と重複 | 削除 |
| P13 | L8「Anthropic API も使用しない。」 | 冗長度: 振る舞いを変えない自己言及(直前の「プロキシや秘密値を一切管理しない」は範囲限定として残す) | 削除 |
| P14 | L19「確認方法の案内例(提示のみ): 「Claude Code の `/model` コマンドで…」」 | 冗長度: L16-17 と同一の 2 点の言い換え | 削除 |
| P15 | L37「(例: 本文で「設計・分析・計画は役割外」と定義しているもの、gpt-luna に「アドバイザーへの相談」節があるもの)」 | 冗長度: 例は 1 つで伝わる | 書き換え → 「(例: 本文で「設計・分析・計画は役割外」と定義しているもの)」 |
| P16 | L21「案内して終了できる」 | 充足度: 終了するかの判断基準がない | 書き換え → 「前提が満たせない場合は「GPT Agent は起動できないため、`optimize-agents:claude-model-policy` 方針の利用を検討してください」と案内し、ユーザーが続行を求めない限りステップ 2 へ進まず終了する。」 |
| P17 | L36「出力先はプロジェクトの `.claude/agents/`」— 基準が cwd か git root か未規定 | 充足度: 範囲の欠落 | 書き換え → 「出力先は git リポジトリのルート直下の `.claude/agents/`。git 管理外のディレクトリでは cwd 直下に置く。」 |

### prompt-smith(自己評価)

| # | 該当箇所 | 当たった基準 | 判定 |
| --- | --- | --- | --- |
| P18 | 評価対象の文数に frontmatter を含めるかが未規定(L60-61) | 充足度: 判断基準の欠落 | 書き換え → 「frontmatter は文数に数えない。description の評価は本文と分けて記す。」 |
| P19 | 複数の指示書を一度に評価するときの出力の分け方が未規定(L43-48) | 充足度: 範囲の欠落 | 書き換え → 「複数の指示書を一度に評価するときは、評点表を 1 つに束ね、指摘リストは指示書ごとに区切って通し番号を振る。」 |

---

# B. skill-creator 観点

prompt-smith が文単位で見るのに対し、skill-creator は**発火・構成・進化の仕組み**を見ます。こちらは評点ではなく横断指摘です。

| # | 指摘 | 深刻度 |
| --- | --- | --- |
| **S1** | **with-codex-policy と claude-model-policy が互いの near-miss になっている。** 両者の description は「併用する構成」「Claude のみで完結する構成」と条件を書きますが、**セッション開始時点でどちらの構成かを Claude が判定する材料が description 内にない**。判定材料(`.claude/agents/gpt-*.md` の有無)は with-codex-policy の**本文 L79** にしか書かれておらず、発火判定時には読めません。skill-creator の言う「should-not-trigger の near-miss」の最悪ケースです。→ 両 description に判定条件を前置する。例: 「`.claude/agents/gpt-{sol,terra,luna}.md` が存在するプロジェクトで使う。存在しないときは `optimize-agents:claude-model-policy` を使う。」(claude-model-policy 側は逆) | 高 |
| **S2** | **description 末尾の抑制文が undertrigger を招く。** policy 系2つは「雑談・単発質問・軽微な修正だけのときは読まなくてよい」で終わります。skill-creator は「Claude は skill を undertrigger する傾向がある。description は少し pushy に」と明言しており、これは真逆。しかも本リポジトリの CLAUDE.md は「最初に必ず `with-codex-policy` を使用」と**無条件**を指示しているため、description の抑制文と CLAUDE.md が競合します。→ 抑制文を削り、「実務タスクへ着手する前に必ず読む」に寄せる。 | 高 |
| **S3** | **共通部の重複。** §コードベース探索・§コスト規律・§設計、実装計画の規律・§モデル別役割の箇条書き10項目が、2つの policy 間でほぼ逐語同一(合計 ~40行 ×2)。片方を直してもう片方を忘れる drift が構造的に起きます(**P4 の食い違いは既にその実例**)。skill-creator の Domain organization パターンの逆。→ 共通規律を `references/orchestration-discipline.md` に切り出し、各 SKILL.md は担当表と分岐だけを持つ。 | 高 |
| **S4** | **`docs/cost-discipline.md`(8.2KB)がどの SKILL.md からも参照されていない孤児。** prompt-smith は「退避先へ移し、移動先を報告する」と定めており、このファイルはまさに退避先ですが、**退避したきり参照が張られていない**ため、根拠を辿る経路が失われています。skill-creator の「Reference files clearly from SKILL.md with guidance on when to read them」違反。→ §コスト規律の末尾に「この規律の実測根拠と不採用案は `../../docs/cost-discipline.md` にある。規律の妥当性を問われたときだけ読む。」を追加。 | 中 |
| **S5** | **参照パスの基準点が未明示。** with-codex-policy L58 の `../../references/context-map-guide.md` は解決先自体は正しい(`plugins/optimize-agents/references/context-map-guide.md` に実在)が、**何からの相対か**が書かれていません。setup L35 は「この Skill のベースディレクトリ配下の」と明記していて対照的。→ 「このスキルのベースディレクトリからの相対で `../../references/context-map-guide.md` を読む」に統一。 | 中 |
| **S6** | **trigger eval が存在しない。** 4スキルとも出力が主観的なので skill-creator 本体の eval ループ(evals.json / iteration / benchmark)は不要と判断できますが、**description 最適化(Step 1-4)だけは客観評価可能**で、S1 の相互排他問題を解く直接の手段です。→ S1・S2 を手で直した後、`scripts/run_loop.py` に policy 系2つの description を通して near-miss 20問で検証する。 | 中 |
| **S7** | **why の不在は減点しない。** skill-creator は「explain the why」を推し、prompt-smith は「根拠は削る」と定める。optimize-agents は後者を選択済み(メモリにも「スキル本文には規律だけを書く」として記録あり)。**S4 の参照を張れば両立する**ため、方針変更は不要と判断します。 | 対応不要 |
| **S8** | 500行制限・progressive disclosure・Principle of Lack of Surprise・frontmatter の必須項目は全スキル充足。 | 問題なし |

---

# 総括

| 観点 | 診断 |
| --- | --- |
| **文体(prompt-smith)** | policy 系2スキルだけが「〜すること」体で取り残されている。prompt-smith 策定前の文体が残存。機械的に直せる。 |
| **構造(skill-creator)** | policy 系2スキルの**逐語重複**が真因で、そこから S1(発火の曖昧さ)と P4(片方だけ古い要約)という別種の症状が派生している。文体修正より先に S3 を解くと、修正対象が半分になる。 |
| **孤児ファイル** | `docs/cost-discipline.md` が参照されておらず、prompt-smith の「退避」規律が半端に終わっている。 |

推奨する着手順は **S3 → S1/S2 → P群** です。S3(共通部の切り出し)を先にやれば P7/P11 の「〜すること」修正は 32箇所ではなく実質 20箇所弱になり、P4 のような drift も再発しません。

---

## 適用の可否

どこまで直しますか。「全件」または番号指定(例: `S3, S1, S2, P7, P11`)で指定してください。

- **全件** — S1〜S6 と P1〜P19 をすべて適用(with-codex-policy / claude-model-policy の構造変更を含む)
- **構造のみ** — S3, S1, S2, S4, S5(重複解消と発火修正)
- **文体のみ** — P1〜P19(既存構造のまま文単位で修正)
- **番号指定** — 上記から任意に

なお全件・構造ありを選ぶ場合、SKILL.md の構造変更を伴うため optimize-agents のバージョンを `0.8.0-dev` → `0.9.0-dev` へ上げる想定です(メジャーは上げません)。

**決定と理由**

prompt-smith と skill-creator という2つの評価軸を適用して、optimize-agents の4スキルを包括的に診断しました。評価の結果、policy 系2スキルに文体の乱れと共通部の重複が系統的に存在し、これが発火条件の曖昧さと版ズレに繋がっていることが判明。根拠と対策を提示して、適用範囲の決定をユーザーに委ねています。

**却下された選択肢**

なし。評価は診断に徹し、実装の着手判断はユーザー指示に従う計画。

**失敗・やり直し・誤った前提**

なし。4スキル全文の読み込みと分析は予定どおり完了。指摘の網羅性と判定根拠は評価本体に記録。

---

# phyllis998

> S4, S5, S6, S7, S8 以外を適用します。
