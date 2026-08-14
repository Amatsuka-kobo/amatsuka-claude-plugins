# agent-policy with-grok-policy 設計書(Grok 定義の 2 分割を含む)

- 作成日: 2026-08-09
- ステータス: ユーザーレビュー待ち
- 対象プラグイン: `plugins/agent-policy/`(0.2.0-dev → 0.3.0-dev)
- 前提資料:
  - `docs/design/2026-08-09-agent-policy-codex-grok-policy-design.md`(Grok 役割の調査と決定。§8 が本設計の引き継ぎ元)
  - `plugins/agent-policy/skills/codex-grok-policy/SKILL.md`(0.2.0-dev で追加。本設計で改名の影響を受ける)
  - `plugins/agent-policy/references/orchestration-discipline.md`(共通規律。本設計でも変更しない)

---

## 1. 目的と背景

Claude(Fable/Opus/Sonnet/Haiku)と Grok のみで完結する運用方針 `with-grok-policy` を追加する。
Codex 系 GPT を使えない環境で、codex-grok-policy と同じ役割体系を保ったまま運用できるようにする。

codex-grok-policy では Grok を「独立レビュー」「リアルタイム情報調査」の 2 役割に限定した。
GPT が抜ける with-grok-policy では、Grok が実装帯も担う。Grok の long-horizon 実装力と
トークン効率(SWE Marathon 首位、出力トークンが Opus 4.8 max 比 約 1/4.2)は、ここで回収する。

## 2. 要件(対話で確定済み)

| 論点 | 選択肢 | 決定 |
| --- | --- | --- |
| Grok の定義ファイル構成 | 1 ファイル拡張 / 実装用を別ファイル / 帯ごとに 3 ファイル | **実装用を別ファイルで追加(2 ファイル)** |
| 定義ファイルの名前 | — | **`grok-researcher`(報告専用)/ `grok-implementer`(実装用)** |
| 「複雑または重要な実装」 | Opus / Grok / Fable | **`Opus`** |
| 「軽量な実装」 | Haiku / Grok | **`Grok`** |
| 通常/軽量の帯の扱い | 分けて Agent Tool 可否を変える / 分けない | **分けない**(§3-2) |

## 3. 設計判断

### 3-1. Grok の定義を役割で 2 分割する

codex-grok-policy で導入した `grok.md`(報告専用。tools に Write/Edit/Agent を持たない)は、
実装帯を担えない。実装用の tools を同じファイルへ足すと、codex-grok-policy が依拠する
「成果物を作らない」制約が tools レベルで担保されなくなる。

そこで 2 ファイルに分ける。役割の境界が tools の差として現れ、誤用が構造的に防がれる。

| 定義 | tools | 担う帯 |
| --- | --- | --- |
| `grok-researcher` | Read, Grep, Glob, Bash, WebSearch, WebFetch | 独立レビュー / リアルタイム情報調査 / コードベース探索実働 |
| `grok-implementer` | Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent | 通常の実装 / 軽量な実装 / その他のタスク |

`grok-researcher` は 0.2.0-dev の `grok.md` の**改名**であり、内容は「コードベース探索実働」の
追加のみとする(§4-1)。`grok-implementer` は `gpt-terra.template.md` を範として新規に書く。

### 3-2. 通常の実装と軽量な実装を帯として分けない

既存 2 方針で通常(`GPT Terra` / `Sonnet`)と軽量(`GPT Luna` / `Haiku`)を分けていたのは、
両者が別のモデルであり、安いモデルへ機械的作業を寄せることに意味があったからである。
本方針では双方を同じ `Grok Implementer` が担うため、この区別は担当表の上でしか存在しない。

同一のエージェントに対して「通常なら Agent Tool 可、軽量なら不可」を切り替えると、
dispatch のたびにツール集合を組み替える手数が増える。区別が生む便益はなく、手数だけが残る。

そこで本方針では、通常の実装と軽量な実装で Agent Tool の可否を分けない。
`Grok Implementer` には常に Agent Tool を許可し、アドバイザー相談の可否も分けない。

これは共通規律の「担当表の『軽量な実装』の帯以外のサブエージェントに Agent Tool を許可する」
に対する、本方針での明示的な例外である。共通規律そのものは変更せず、with-grok-policy の
SKILL.md に例外として書く。担当表には既存の行名(通常の実装 / 軽量な実装)を残し、
どちらも `Grok Implementer` を割り当てる。行名を残すのは、共通規律が行名で帯を参照するためである。

`Haiku` は本方針の担当表で「設計書・実装計画書のレビュー」帯のみを担う。この帯は
Agent Tool を許可しない対象として残る。

### 3-3. 複雑または重要な実装は Opus が担う

codex-grok-policy 設計 §8 で未決としていた論点である。

調査(2026-08-08)では、Grok 4.5 の Artificial Analysis Intelligence Index は 54 で 4 位
(Fable 5・GPT-5.5・Opus 4.8 の下)、DeepSWE では Fable / GPT-5.5 に劣後する。
最難問の raw accuracy は Claude が優位であり、この帯を Grok に渡す根拠がない。
設計・統括を担う Opus が最難問の実装も担うことで、コンテキストの引き継ぎ損失も減る。

`Fable` を充てない理由は、既存 2 方針が `Fable` をアドバイザー専用に位置づけており、
実装帯へ入れると体系から逸脱するためである。

### 3-4. コードベース探索実働は grok-researcher が担う

codex-grok-policy では探索実働を `GPT Terra` / `GPT Luna` が担っていた。GPT が抜ける本方針では
Grok が引き受ける(codex-grok-policy 設計 §8 の引き継ぎ事項)。

探索実働は読み取りだけで完結する。`grok-researcher` の tools はそのまま探索に適合し、
`grok-implementer` の書き込み権限は探索には不要である。最小権限の原則に従い researcher に置く。

これに伴い `grok-researcher` の「When to invoke」へ探索実働の項を足す。gpt-sol / gpt-terra /
gpt-luna がいずれも探索実働の項を持つのと同じ形である。

### 3-5. 独立レビューは with-grok-policy でも成立する

設計者が Claude、レビュアーが Grok である限り、異ベンダーによる盲点の非相関という価値は
保たれる。codex-grok-policy と同じ手順(原本のみを読ませ、Haiku の指摘は渡さない)を用いる。

### 3-6. Grok 不可時のフォールバックは claude-model-policy へ寄せる

with-grok-policy で Grok が使えないと、実装帯と探索実働が空く。この状態は
`claude-model-policy` の担当表そのものであるため、実行帯の解決順で claude-model-policy へ
読み替える。探索実働も claude-model-policy の同名行(`Sonnet` / `Haiku`)へ読み替わる。

claude-model-policy に対応行がない新設 2 行のフォールバックは codex-grok-policy と同じ
(独立レビューは省略、リアルタイム調査は Opus + WebSearch)。

## 4. 既存成果物への影響

### 4-1. `grok.md` → `grok-researcher.md` の改名

0.2.0-dev で追加した codex-grok-policy / setup-grok / grok.template.md は、いずれも
`grok` という定義名を前提にしている。本設計の 2 分割に合わせて改名する。

| ファイル | 変更 |
| --- | --- |
| `skills/setup-grok/assets/grok.template.md` | `grok-researcher.template.md` へ改名。frontmatter の `name` を `grok-researcher` へ。「When to invoke」に探索実働を追加 |
| `skills/setup-grok/assets/grok-implementer.template.md` | 新規作成 |
| `skills/setup-grok/SKILL.md` | 2 ファイル生成へ拡張。出力先は `.claude/agents/grok-{researcher,implementer}.md` |
| `skills/codex-grok-policy/SKILL.md` | 定義名の参照を `grok-researcher` へ |

改修が要る行は次のとおり(0.2.0-dev 時点の行番号)。

| ファイル:行 | 現在の記述 | 変更後 |
| --- | --- | --- |
| codex-grok-policy:3 | description の `grok.md` (2 箇所) | `grok-researcher.md` |
| codex-grok-policy:44 | 「`grok` エージェントへ dispatch」 | 「`grok-researcher` エージェントへ dispatch」 |
| codex-grok-policy:74 | 「`.claude/agents/grok.md` が存在すれば」 | 「`.claude/agents/grok-researcher.md` が存在すれば」 |
| setup-grok:3 | description の「Grok エージェント定義(grok)」「grok.md 不在時」 | 2 定義の生成を示す記述へ |
| setup-grok:25 | 「grok → `claude-grok-4-5`」 | 2 定義に同じエイリアスを適用する記述へ |
| setup-grok:31-34 | 単一テンプレートの読み込み・出力・上書き確認 | 2 テンプレートのループへ(§4-3) |
| setup-grok:41 | 追記文例の `grok.md` | `grok-{researcher,implementer}.md` |

codex-grok-policy は `grok-implementer` を使わない。GPT が実装帯を持つためである。
setup-grok は両方を生成し、どちらの方針でも同じウィザードで揃うようにする。

改名は 0.2.0-dev のリリース直後であり、既存利用者はいない前提とする。旧 `grok.md` に対する
移行案内は設けない。

### 4-2. setup-grok のステップ 2 の既定値

- `grok-researcher` → `claude-grok-4-5`
- `grok-implementer` → `claude-grok-4-5`

同一モデルを 2 定義で使う。エイリアスは 1 回のヒアリングで両方へ適用し、別々には尋ねない。

### 4-3. setup-grok ステップ 3 の生成フロー

2 テンプレートを同じ手順で処理する。

1. `assets/grok-researcher.template.md` と `assets/grok-implementer.template.md` を読み込む。
2. 各テンプレートの `{{MODEL_ALIAS}}` を、ステップ 2 で確定した同一のエイリアスへ置換する。
3. `.claude/agents/grok-researcher.md` と `.claude/agents/grok-implementer.md` へ出力する。
4. 既存ファイルがあるときは、ファイルごとと一括の双方を選べる形で上書き可否を確認する
   (setup-gpt の 3 ファイル生成と同じ扱い)。

## 5. with-grok-policy SKILL.md の設計

### 5-1. モデル別役割(担当表)

| 役割 | モデル |
| --- | --- |
| 調査・分析 | `Opus` |
| リアルタイム情報調査(最新動向・外部エコシステム) | `Grok Researcher` |
| 設計書・実装計画書(WBS)の作成 | `Opus` |
| コードベース探索統括 | `Opus` |
| コードベース探索実働 | `Grok Researcher` |
| 複雑または重要な実装 | `Opus` |
| 通常の実装 | `Grok Implementer` |
| 軽量な実装 | `Grok Implementer` |
| コードレビュー | `Sonnet` |
| 設計・計画・実装のアドバイザー | `Fable` / `Opus` |
| 設計書・実装計画書のレビュー(理解したこと+暗黙知抽出) | `Haiku` |
| 設計書・実装計画書の独立レビュー(前提検証・反証提示) | `Grok Researcher` |
| その他のタスク | `Grok Implementer` |

- 通常の実装と軽量な実装はどちらも `Grok Implementer` が担い、Agent Tool の可否を分けない(§3-2)。
- `Grok Researcher` には Agent Tool を許可しない(定義ファイルの tools から除く)。
- `Haiku`(設計書・実装計画書のレビュー帯)にも Agent Tool を許可しない。

`Grok Researcher` と `Grok Implementer` の振り分けは、成果物を残すかどうかで決める。
ファイルを変更する作業は Implementer、読んで報告するだけの作業は Researcher である。

### 5-2. 方針固有節

- **実行帯が Grok の場合の dispatch**: 定義本文を依頼文へ同梱し、`model` 上書きは使わない。
  `grok-researcher` へ dispatch するときは「独立レビュー」「リアルタイム情報調査」「探索実働」の
  どれかを冒頭で明示する。軽量な実装として `grok-implementer` へ dispatch するときは §3-2 の
  ツール制限を依頼文に書く。
- **独立レビューの手順**: codex-grok-policy と同一(Haiku → Grok 原本レビュー → 採否判断)。
- **Grok が利用不可のときのフォールバック**: §3-6。
- **実行帯の解決順**: `.claude/agents/grok-researcher.md` / `grok-implementer.md` が存在すれば
  それを使う。無ければ `agent-policy:setup-grok` の実行を案内し、生成完了(またはスキップ)
  までは `claude-model-policy` の担当表 + 新設 2 行のフォールバックで代行する。

### 5-3. 方針の選択関係

description に次の優先関係を書く。

| `.claude/agents/` の状態 | 使う方針 |
| --- | --- |
| gpt-* と grok-* が揃う | `codex-grok-policy` |
| gpt-* のみ | `with-codex-policy` |
| grok-* のみ | `with-grok-policy` |
| どちらも無い | `claude-model-policy` |

CLAUDE.md の明示指定がファイル有無の判別と食い違う場合は CLAUDE.md が優先される。

## 6. grok-implementer.template.md の設計

`gpt-terra.template.md` と同じ構造(frontmatter + When to invoke + Core Responsibilities +
作業手順 + アドバイザーへの相談 + 制約 + Output Format)を持つ。

- frontmatter: `name: grok-implementer` / `model: {{MODEL_ALIAS}}` / `color: orange` /
  `tools: Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent`
- When to invoke: 通常の実装 / 一括適用・反復変換 / ドキュメント・設定の編集 /
  ビルド・テストの実行 / その他の一般作業。複雑または重要な実装は Opus、レビューと調査は
  `grok-researcher` に委ねる旨を書く。
- Core Responsibilities: 指示された作業を既存のリポジトリ規約に合わせて遂行する。
  作業範囲を指示の範囲に留める。
- 作業手順: 対象ファイルの現状を確認してから変更する。多数の対象へ同じ変更を適用するときは、
  先に全リストを確定させ、1〜2 件で内容を確認してから残りへ展開する。検証手段があれば実行する。
  長時間の作業では途中経過を報告に残す(Grok の long-horizon 特性を活かす形)。
- アドバイザーへの相談: 判断に迷ったときだけ `Fable`(不可なら `Opus`)サブエージェントを
  呼ぶ。依頼文に「助言のみを返す」「Agent ツールを使用しない」と明記する。
  gpt-terra.template.md と同一の規定を用いる。
- 制約: `Agent` tool はアドバイザー相談専用とし、作業委譲には使わない。
  ブリーフで指定されたスキル以外をロードしない。

作成時は `prompt-smith:agent-creator` の規格に従う。

## 7. 成果物の構成

```
plugins/agent-policy/
  skills/
    with-grok-policy/
      SKILL.md                             # 新規
    setup-grok/
      SKILL.md                             # 改修(2 ファイル生成へ)
      assets/
        grok-researcher.template.md        # grok.template.md からの改名 + 探索実働の追加
        grok-implementer.template.md       # 新規
    codex-grok-policy/
      SKILL.md                             # 改修(定義名の参照を grok-researcher へ)
  .claude-plugin/plugin.json               # version 0.3.0-dev、description を 4 プロファイルへ
```

`with-codex-policy` / `claude-model-policy` / `setup-gpt` / `references/` は変更しない。

## 8. 実装手順

1. `prompt-smith:prompt-smith` をロードし、with-grok-policy の SKILL.md を作成、
   setup-grok と codex-grok-policy の SKILL.md を改修する。
2. `prompt-smith:agent-creator` をロードし、grok-researcher.template.md の改名+追記と
   grok-implementer.template.md の新規作成を行う。
3. plugin.json の version を 0.3.0-dev へ、description を 4 プロファイル構成へ更新する。
4. `claude plugin validate` を実行し、既存 3 スキル・共通規律に差分が出ていないことを確認する。
5. Serena メモリ `agent_policy/core` を 4 プロファイル構成へ追従させる。
