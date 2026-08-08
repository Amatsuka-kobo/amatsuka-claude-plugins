# agent-policy codex-grok-policy / setup-grok 設計書

- 作成日: 2026-08-09
- ステータス: ユーザーレビュー待ち
- 対象プラグイン: `plugins/agent-policy/`(0.1.1-dev → 0.2.0-dev)
- 前提資料:
  - `plugins/agent-policy/skills/with-codex-policy/SKILL.md`(ベースとなる方針)
  - `plugins/agent-policy/skills/setup-gpt/SKILL.md` と `assets/gpt-*.template.md`(ウィザードとテンプレートの雛形)
  - `plugins/agent-policy/references/orchestration-discipline.md`(共通規律。本設計では変更しない)

---

## 1. 目的と背景

with-codex-policy(Claude + Codex 併用)をベースに、Grok 4.5 を加えた三社構成の運用方針
`codex-grok-policy` を追加する。あわせて、方針が参照する Grok エージェント定義を生成する
ウィザード `setup-grok` とテンプレート `grok.template.md` を追加する。

Grok 4.5 の調査(2026-08-08 実施)で確認した特性:

- 強み: long-horizon なエージェント実行(SWE Marathon 首位)、トークン効率と低単価
  (出力トークンが Opus 4.8 max 比 約 1/4.2、$2/$6 per 1M)、組み込み Web/X 検索。
- 弱み: 最難問の raw accuracy は Fable/Opus が優位、マルチエージェント統括力は劣後、
  200K トークン超のリクエストは単価 2 倍。

Codex が実装帯を持つ構成では、Grok を実装帯へ横滑りさせても追加価値が小さい。
現体制のどのモデルも持たない能力 —— **異ベンダーの独立視点**と**リアルタイム情報アクセス**
—— を足す配置が、限界効用を最大にする。

## 2. 要件(対話で確定済み)

| 論点 | 選択肢 | 決定 |
| --- | --- | --- |
| Grok の役割 | A 探索実働のみ置換 / B 中間実働帯を置換 / C long-horizon 帯新設 / D 独立レビュー+リアルタイム調査の新設 | **D** |
| 新設 2 役割の既存方針への逆輸入 | する / しない | **しない**(codex-grok-policy / with-grok-policy に閉じる) |
| 共通規律 `orchestration-discipline.md` の変更 | する / しない | **しない**(方針固有節を SKILL.md 側に置く) |
| セットアップ手段 | 手動配置 / setup-gpt 拡張 / 専用ウィザード新設 | **専用ウィザード `setup-grok` を新設** |
| 既定のモデルエイリアス | — | **`claude-grok-4-5`** |
| 実装時の作成手段 | — | **SKILL.md 類は `prompt-smith:prompt-smith`、Agent 定義テンプレートは `prompt-smith:agent-creator` を使用** |
| with-grok-policy(Claude + Grok のみ) | 本設計に含める / 分ける | **分ける**(別設計。§8 に引き継ぎ事項のみ記録) |

## 3. 設計判断

### 3-1. Grok の役割は「置換」でなく「新設」とする(案D)

ユーザーが Grok 4.5 本体に役割案を質問して得た「前提検証・レッドチーム」役の提案
(2026-08-08 の対話で共有されたもの。モデルの自己申告であることに留意)を、
次の 2 点を修正して採用する。

1. 役割の価値の源泉を「推論力の優位」ではなく「**異ベンダーの独立性 + 低コスト**」と定義する。
   Intelligence Index で Grok は Fable/GPT-5.5/Opus の下位であり、「真理検証者」ではない。
   設計者(Opus)と同ベンダーのレビュアーは学習データ由来の盲点が相関する。異ベンダーの
   レビュアーはこの相関を切る。これがレッドチーム配置の実効的な根拠である。
2. 指摘の採否判断はオーケストレーターに残す。Grok の役割は「反証の提示」までとする。
   もっともらしいが的外れな指摘のトリアージは、既存規律の「レビュー後にオーケストレーターが
   補足修正」と同じ形で吸収する。

「リアルタイム情報調査」は、提案中で唯一、調査結果が固有能力として裏付けた担当であり、
そのまま採用する。

### 3-2. 新設 2 行は方針固有の帯であり、既存 2 方針には追加しない

役割行を全方針に揃えるか方針固有にするかは「その役割の価値がモデル構成に依存するか」で
決まる。独立レビューは異ベンダーがいる構成でしか価値が生じないため、Grok を含む方針にだけ
置く。claude-model-policy(単一ベンダー)では原理的に成立せず、with-codex-policy への追加は
GPT Sol のレビュー能力の裏付けがないまま全利用プロジェクトの手番とコストを増やす。

共通規律が行名で参照する帯(軽量な実装 / コードベース探索統括・実働 / 設計書・実装計画書の
レビュー / アドバイザー)は改名・統合しない。それ以外の行は方針ローカルに追加してよい。
ただし追加行は claude-model-policy に読み替え先がないため、フォールバックを方針側で定義する
(§3-3)。

### 3-3. 新設行のフォールバックは「省略」と「Opus 代行」

- **独立レビュー**: Grok 不可時は**省略**する(Haiku レビュー + オーケストレーター補足という
  既存フローに縮退)。Opus で代行すると設計者と同ベンダーになり、独立性という存在意義が
  消えるため、代行より省略が正直である。
- **リアルタイム情報調査**: Grok 不可時は「調査・分析」帯(`Opus`)+ WebSearch で代行する。

### 3-4. Grok エージェントは 1 定義で 2 役割を担う

`.claude/agents/grok.md` の 1 ファイルとし、独立レビューとリアルタイム情報調査は依頼文
(ブリーフ)で切り替える。役割ごとにファイルを分けない理由: 両役割とも「読む・調べる・
報告する」で完結し、tools が同一(書き込み系不要)であり、分けても frontmatter の差が出ない。

tools は `Read, Grep, Glob, Bash, WebSearch, WebFetch` とする。`Write`/`Edit` は与えない
(レビューと調査は成果物を持たず、報告のみを返す)。`Agent` tool も与えない(調査で確認した
マルチエージェント統括力の弱み、および「助言・指摘のみを返す」役割定義と整合)。

### 3-5. プロキシ経由では Grok の組み込み検索は使えない前提を置く

Grok 4.5 の「組み込み Web/X 検索」は xAI API の機能であり、Claude Code から ProxyAPI 経由で
モデルを呼ぶ構成では利用できない可能性が高い。リアルタイム情報調査は Claude Code の
`WebSearch`/`WebFetch` tool を Grok モデルが操作する形で実現する。X エコシステムへの
アクセスは保証されないことをテンプレートの役割定義に明記する。

### 3-6. レビューフローは Haiku 帯の後段に Grok を直列で挟む

```
1. Opus が設計書・実装計画書を作成
2. Haiku 帯レビュー(理解+暗黙知抽出)          ← 既存・共通規律の必須ゲート
3. Grok 独立レビュー(前提検証・反証提示)        ← 新設・codex-grok-policy 固有
4. オーケストレーターが 2. 3. の指摘を採否判断し補足修正
5. ユーザーへ提示・承認
```

Haiku(書かれていないことの可視化)と Grok(書かれていることへの攻撃)は直交しており、
統合しない。Grok には設計書・実装計画書の**原本のみ**を読ませ、Haiku の指摘は渡さない。
先行レビューの指摘を見せると視点が引きずられ、独立性が損なわれるためである。
この手順は codex-grok-policy の SKILL.md 内に方針固有節として記述し、共通規律には触れない。

### 3-7. 方針選択の判別は codex-grok-policy 側の description に閉じる

既存 2 方針の description(`gpt-*.md` の有無で選ぶ)は変更しない。codex-grok-policy の
description に「`.claude/agents/` に gpt-sol/terra/luna.md **と grok.md がすべて**存在する
プロジェクトではこちらを使い、grok.md が無ければ with-codex-policy を使う」と優先関係を
記述する。実際の運用では各プロジェクトの CLAUDE.md が方針名を明示するため、description の
判別は補助線である。CLAUDE.md の明示指定とファイル有無の判別が食い違う場合は
CLAUDE.md が優先される(ユーザー指示が description に優先するという既存の一般則のとおり)。

## 4. 成果物の構成

```
plugins/agent-policy/
  skills/
    codex-grok-policy/
      SKILL.md                       # 新規
    setup-grok/
      SKILL.md                       # 新規
      assets/
        grok.template.md             # 新規
  .claude-plugin/plugin.json         # version 0.2.0-dev へ、description を 3 プロファイルに更新
```

既存ファイル(with-codex-policy / claude-model-policy / setup-gpt / references/)は変更しない。

## 5. codex-grok-policy SKILL.md の設計

with-codex-policy をベースに、次の差分を持つ。

### 5-1. モデル別役割(担当表)

| 役割 | モデル |
| --- | --- |
| 調査・分析 | `Opus` |
| **リアルタイム情報調査(最新動向・外部エコシステム)** | **`Grok`** |
| 設計書・実装計画書(WBS)の作成 | `Opus` |
| コードベース探索統括 | `Opus` |
| コードベース探索実働 | `GPT Terra` / `GPT Luna` |
| 複雑または重要な実装 | `GPT Sol` |
| 通常の実装 | `GPT Terra` |
| 軽量な実装 | `GPT Luna` |
| コードレビュー | `Sonnet` |
| 設計・計画・実装のアドバイザー | `Fable` / `Opus` |
| 設計書・実装計画書のレビュー(理解したこと+暗黙知抽出) | `Haiku` |
| **設計書・実装計画書の独立レビュー(前提検証・反証提示)** | **`Grok`** |
| その他のタスク | `GPT Terra` |

「軽量な実装」帯(Agent Tool 不許可)の規定は with-codex-policy と同じ(`GPT Luna` と
`Haiku`)。`Grok` にも Agent Tool を許可しない(定義ファイル側で tools から除外)。

### 5-2. 方針固有節

- **独立レビューの手順**: §3-6 のフロー。Grok への依頼文に「反証の提示までを担い、採否は
  オーケストレーターが判断する」ことを明記する。
- **リアルタイム情報調査の使いどころ**: 最新動向・リリース情報・外部エコシステムの調査を
  「調査・分析」(Opus)から分離して Grok へ回す判定基準は「外部の最新情報へのアクセスが
  主目的か」である。思考の深さが主目的の調査は従来どおり Opus。
- **新設 2 行のフォールバック**(§3-3)。
- **Grok dispatch の方法**: GPT と同じく、定義ファイルを持つ Agents は定義本文を依頼文に
  同梱して `grok` エージェントへ dispatch し、`model` 上書きは使わない。1 定義 2 役割の
  切り替えは依頼文で行う: 依頼文の冒頭で「独立レビュー」「リアルタイム情報調査」の
  どちらの役割かを必ず明示し、対応する Output Format(§7)を指定する。

### 5-3. 実行帯の解決順

with-codex-policy の解決順に Grok の確認を加える。確認のタイミングは既存規定と同じ
「実務タスク着手前」の 1 回であり、タスクごとに再判定しない。

1. GPT: `.claude/agents/gpt-{sol,terra,luna}.md` → 既存の解決順(定義 → codex:rescue →
   setup-gpt 案内 + claude-model-policy 代行)をそのまま用いる。
2. Grok: `.claude/agents/grok.md` が存在すればそれを使う。存在しない、またはローカル
   プロキシ経由で呼び出せない場合は、ユーザーへ `agent-policy:setup-grok` の実行を案内し、
   生成完了(またはスキップ)までは §3-3 のフォールバック(独立レビュー省略 /
   リアルタイム調査は Opus + WebSearch)で運用する。

Grok には codex:rescue に相当する代替経路がないため、解決順は 2 段である。

## 6. setup-grok スキルの設計

setup-gpt の 4 ステップ構成を踏襲し、対象を 1 エージェントに縮約する。

- **ステップ 1: 前提確認** — Grok 系モデルを配信するプロキシ経由で Claude Code を起動して
  いるか、`/v1/models` にエイリアスが含まれるかを確認する。setup-gpt と同じく検証コマンドは
  実行させず、確認方法の提示に留める。満たせない場合は
  「codex-grok-policy の Grok 帯はフォールバック運用になる」旨を案内して終了する。
- **ステップ 2: エイリアス確認** — 既定値 `claude-grok-4-5` を提示して確認する。
  クライアント側エイリアスでありモデル本体の ID ではない旨の補足は setup-gpt と同文。
- **ステップ 3: 生成** — `assets/grok.template.md` の `{{MODEL_ALIAS}}` を置換し、
  `.claude/agents/grok.md` へ出力する。既存ファイルの上書き確認は setup-gpt と同じ。
- **ステップ 4: 後処理案内** — CLAUDE.md への追記文例(codex-grok-policy への切り替えを
  含む)を提示する。自動では書き込まない。

setup-gpt は変更しない。両方を使うプロジェクトは setup-gpt → setup-grok の順に実行する。

## 7. grok.template.md の設計

gpt-*.template.md と同じ構造(frontmatter + When to invoke + Core Responsibilities +
作業手順 + 制約 + Output Format)を持つ。

- frontmatter: `name: grok` / `model: {{MODEL_ALIAS}}` / `color: red` /
  `tools: Read, Grep, Glob, Bash, WebSearch, WebFetch`。
  `Read`/`Grep`/`Glob` は独立レビュー時に、設計書が言及するコード・ファイルの実在と記述の
  整合を確かめるために使う(反証には現物の確認が要る)。
- When to invoke: 独立レビュー(前提検証・反証提示)とリアルタイム情報調査の 2 用途。
- 制約:
  - 成果物(ファイル)を作らない。報告のみを返す。
  - 独立レビューでは反証の提示までを担い、採否判断をしない。
  - リアルタイム情報調査では、X 由来・ソーシャル由来の情報を未検証として明示し、
    一次情報源の URL を添える。
  - アドバイザーへの相談はしない(迷いは報告して差し戻す。gpt-luna と同じ規定)。
- Output Format: レビュー時は「指摘(前提/仮定/楽観)ごとに、根拠・反証・影響範囲」、
  調査時は「情報源 URL 付きの要約と鮮度(いつ時点の情報か)」。

作成時は `prompt-smith:agent-creator` の規格(description 要件・frontmatter 検証)に従う。

## 8. with-grok-policy への引き継ぎ事項(本設計のスコープ外)

- 担当表は既存の行名を維持して Grok を GPT の穴へ写像する:
  探索実働 → `Grok`、通常の実装 → `Grok`、軽量な実装 → `Grok` または `Haiku`、
  その他 → `Grok`。独立レビュー・リアルタイム情報調査の 2 行も置く。
- **未決**: 「複雑または重要な実装」を `Opus` に戻すか `Grok` に任せるか。調査結果
  (最難問の raw accuracy は Claude 優位)からは Opus 推奨だが、設計時に改めて確認する。
- grok.template.md は実装帯用の記述を持たないため、with-grok-policy 設計時に
  実装帯向けテンプレート(または grok.md の拡張)を検討する。

## 9. 実装手順

1. `prompt-smith:prompt-smith` をロードし、codex-grok-policy / setup-grok の SKILL.md を作成する。
2. `prompt-smith:agent-creator` をロードし、grok.template.md を作成する。
3. plugin.json の version を 0.2.0-dev へ、description を 3 プロファイル構成へ更新する。
4. 既存 2 方針・共通規律・setup-gpt に差分が出ていないことを確認する。
5. Serena メモリ `agent_policy/core` を 3 プロファイル構成へ追従させる。
