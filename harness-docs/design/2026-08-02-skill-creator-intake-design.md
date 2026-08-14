# 設計書: skill-creator の観点を optimize-agents へ取り込む

**作成日**: 2026-08-02
**作成者**: Opus
**context-map**: `.claude/context-maps/2026-08-02-skill-creator-intake.md`
**対象プラグイン**: `optimize-agents`(現 0.11.1-dev → 0.12.0-dev)

---

## 1. 背景と目的

`skill-creator`(claude-plugins-official, Apache 2.0)を分析し、optimize-agents に取り込む価値のある観点を移植する。分析の結果、採用 5 件・既充足 3 件・不採用 5 件に分類した。本設計書は採用 5 件の実装方針を定める。

### ユーザー確定事項(2026-08-02)

| 事項 | 決定 |
| --- | --- |
| 着手順 | A(静的検査)→ C(eval 先行)→ D(assertion 基準)→ E(分割) |
| 本文の執筆スタイル | 衝突部分は現行 `prompt-smith` を優先。skill-creator の執筆論は取り込まない |
| description の方針 | **実測で決める**。差 3 問以上で勝者採用、1〜2 問なら現行維持 |
| eval セットの問数 | 増やさない。E は規律をテキストで書き、自動分割は実装しない |
| A の検査仕様 | **Claude Code 仕様のみ**。API / claude.ai 仕様は検査しない |
| **F: commands を対象に加える**(追加要件) | `.claude/commands/` とプラグインの `commands/` も AI 向け指示書として扱う |

### 仕様の分岐(2026-08-02 に判明)

SKILL.md の frontmatter 仕様は**サーフェスごとに異なる**。

| | Claude API / claude.ai | Claude Code |
| --- | --- | --- |
| 出典 | platform.claude.com `agent-skills/overview` | code.claude.com `skills` |
| `name` | **必須**。64 字以内、小文字英数字ハイフン、予約語 `anthropic`/`claude` 不可 | **任意**。表示名。省略時はディレクトリ名 |
| `description` | **必須**。1024 字以内 | 推奨。省略時は本文の第 1 段落 |
| 長さの上限 | `description` 単体で 1024 字 | `description` + `when_to_use` の**合算で 1536 字**(一覧で切り詰め) |
| 許容キー | 6 種(`name`/`description`/`license`/`allowed-tools`/`metadata`/`compatibility`) | 17 種(下記) |

Claude Code の 17 フィールド: `name` / `description` / `when_to_use` / `argument-hint` / `arguments` / `disable-model-invocation` / `user-invocable` / `allowed-tools` / `disallowed-tools` / `model` / `effort` / `context` / `agent` / `background` / `hooks` / `paths` / `shell`

### commands と skills の関係(2026-08-02 確認)

公式は次を明記している。

> **Custom commands have been merged into skills.** A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way.

> Files in `.claude/commands/` still work and support the same [frontmatter](#frontmatter-reference).

**command は skill と同一の frontmatter 仕様を持つ。**差は次の 2 点だけ。

| | skill | command |
| --- | --- | --- |
| コマンド名の由来 | ディレクトリ名(プラグインでは frontmatter `name`) | **ファイル名(拡張子なし)** |
| 付随ファイル | ディレクトリを持てる(`scripts/` 等) | 単一ファイル |
| 名前衝突時 | skill が優先 | skill に負ける |

`name` フィールドは command でも許容されるが、コマンド名を決めない(ファイル名が決める)。表示ラベルにのみ効く。

skill-creator の `quick_validate.py` は前者(API 仕様)を検査する。`package_skill.py` による zip 化 → claude.ai アップロードとセットで設計されているため。**このリポジトリは Claude Code プラグインの Marketplace であり、claude.ai へのアップロード経路を持たない。**存在しない制約で引っかける検査器は偽陽性を生むため、後者のみを検査する。

判明の経緯: `plugins/optimize-agents/skills/claude-model-policy/` が予約語 `claude` を含みながら正常動作していたことから、API 仕様の予約語制限が Claude Code に適用されないことが分かった。

### プラグインスキルにおける `name` の意味

`name` はコマンド名の最終セグメントを決める。`my-plugin/skills/review/SKILL.md` に `name: fancy` を書くと `/my-plugin:fancy` になる。**ディレクトリ名との不一致は不正ではなく仕様である。**

`plugins/optimize-agents/skills/setup-gpt/` の `name: setup` は `/optimize-agents:setup` を生む。README の表記が正しく、context-map に「不一致」と記録した項目は**誤りだった**。W1 として警告する設計は取り下げる。

### `claude plugin validate` の実効範囲(2026-08-02 実測)

`claude plugin validate plugins/optimize-agents` を実行したところ、検査対象は `plugin.json` のみで、SKILL.md の frontmatter は見ていない(author 未指定の warning 1 件のみ)。context-map §7b に「skill/agent/command の frontmatter を検査する」と記録していたが、実測では manifest に限られた。A はこの空白を埋める。

---

## 2. 全体像

| # | 項目 | 成果物 | 種別 |
| --- | --- | --- | --- |
| A | skill / command の静的検査 | `src/check-skill-definition.ts` + テスト + バンドル | 新規スクリプト |
| B | description の方針決定 | 実測レポート + `references/description-guide.md` の改稿 | 実測 + 改稿 |
| C | eval 先行 | `skills/skill-eval/SKILL.md` に節を追加 | 規律追加 |
| D | assertion の質の基準 | `skills/skill-eval/SKILL.md` §チェッカーを書く に追加 | 規律追加 |
| E | train/test 分割 | `skills/skill-eval/SKILL.md` に節を追加 | 規律追加 |
| F | commands を対象範囲へ追加 | `prompt-smith` / `skill-eval` / `description-guide` の対象記述 | 対象拡張 |

A は独立している。C・D・E は同一ファイル(`skill-eval/SKILL.md`)を触るため、まとめて 1 度の改稿にする。B は測定結果が出るまで改稿できないため最後に置く。

### 本文の執筆基準

**この作業で書き加える本文はすべて `optimize-agents:prompt-smith` の基準に従う。** C・D・E・F で SKILL.md と `references/` に追記する文はいずれも prompt-smith の対象範囲にある。

適用する基準:

| 基準 | この作業での意味 |
| --- | --- |
| 指示だけを残し、根拠は書かない | 「なぜこの規律が要るか」は設計書と `docs/` に置く。SKILL.md には規律だけを書く |
| 言い切りで書く | 「〜すること」ではなく「〜する」「〜しない」 |
| 1 文 1 指示 | 複数の指示を 1 文に詰めない |
| 禁止には代替を併記 | 「〜しない」で終えず、代わりに取る動きを書く |
| 判断基準のない修飾を置かない | 「適宜」「必要に応じて」を使わず基準を書く |
| 生成と削減を別パスにする | 素案を書き切ってから、別のパスで基準を当てて削る |

### 適用対象

| 対象 | prompt-smith を当てるか |
| --- | --- |
| `skills/skill-eval/SKILL.md` の本文(C / D / E / F) | 当てる |
| `skills/prompt-smith/SKILL.md` の本文(F) | 当てる |
| `references/description-guide.md`(B / F) | **当てる**。`references/` 配下は prompt-smith の対象範囲 |
| `references/` に新設する文書があれば | 当てる |
| 各スキルの frontmatter `description`(B / F) | **当てない**。`description-guide.md` に従う |

`description-guide.md` は 0.11.1 で `references/` を対象に加えた時点から prompt-smith の対象である。B での改稿・F での適用範囲追記の双方に基準を当てる。

**「引くための記述」の例外**(prompt-smith §引くための記述の見分け方): `description-guide.md` の §Agents 定義での違い にある「公式ドキュメントに基づく準用」の列挙は、実装者が値を引く先ではなく読んだ者の動きを変える文なので、通常適用とする。B / F で追加する 1536 字の制約表など、外部仕様の写しにあたる部分だけを例外とする。迷ったブロックは通常適用に倒し、指摘として挙げる。

各改稿の完了後、`prompt-smith` の §評価 で自己評価し、冗長度・充足度・スタイル適合の 3 軸で評点を出す(§9 検証方法)。評点が 3 以下の軸があれば、その指摘を反映してから次の段へ進む。

### 実行順序

ユーザー指示の着手順は A → C → D → E。B はこれと別枠で「優先的に取り込む」指示があり、測定に時間がかかるため次の順で進める。

| 段 | 作業 | 依存 |
| --- | --- | --- |
| 1 | A の実装・テスト・ビルド・実地確認(skill + command) | なし |
| 2 | C・D・E を `skill-eval/SKILL.md` に 1 度で改稿 | なし(A と並行可) |
| 3 | F の対象拡張(`prompt-smith` / `skill-eval` / `description-guide`) | 段 2(同じファイルを触る) |
| 4 | B の B 案 description を 3 スキル分作成 | 段 3。**A 案は「F 適用後の description」であり、着手前の現状ではない** |
| 5 | B の測定(巡 1 → 巡 2) | 段 4 |
| 6 | 判定 → `description-guide.md` 改稿 → README / docs 更新 → バージョン繰り上げ | 段 5 |

段 5 は測定に時間がかかり、その間の他作業は行わない(同一マシンで `claude -p` を 640 回走らせるため、並行作業がレート制限と測定条件に影響する)。

### B と E の関係

E(過学習の検出)を実装しないまま B(方針の実測)を行うため、「B の測定結果自体が eval セットへの過学習を含む」可能性が残る。

ただし B は**改稿の反復ではなく 2 案の一発比較**である。A 案は 2026-08-01 以前に確定した既存 description で、80 問を見て直したものではない。B 案も「skill-creator の方針で書く」という独立の基準から作り、失敗クエリを見て個別に調整することはしない。反復による過学習は起きない構造になっている。

E の規律は、B の後に行う個別改稿から効く。

---

## 3. A: skill / command の静的検査

### 3.1 なぜ要るか

Agent 定義には `check-agent-definition.mjs` があるが、SKILL.md と command には対応物がない。リポジトリは SKILL.md 43 本、command 7 本を抱えている。`claude plugin validate` は plugin.json しか見ないため(§1 実測)、frontmatter を検査する手段がどこにもない。

command は skill と同一の frontmatter 仕様を持つ(§1)ため、**1 本の検査器で両方を扱う**。分岐はコマンド名の解決だけに閉じる。

### 3.2 検査項目

Claude Code 仕様のみを検査する。「壊れると発火・起動が失敗する」ものを errors、「壊れないが意図どおり動かない可能性がある」ものを warnings とする。skill / command で検査項目は共通とし、差は §3.2b に示す。

#### errors

| # | 条件 | メッセージ |
| --- | --- | --- |
| E1 | frontmatter が先頭 `---` で始まらない | `frontmatter が見つからない` |
| E2 | frontmatter の終端 `---` がない | `frontmatter の終端が見つからない` |
| E3 | `name` があり `^[a-z0-9][a-z0-9-]*[a-z0-9]$` に不一致(1 字の場合は `^[a-z0-9]$`) | `name は英小文字・数字・ハイフンのみで指定し、先頭と末尾はハイフン以外にする` |
| E4 | `description` が未指定、かつ本文が空 | `description も本文も無い。どちらか一方は要る` |
| E5 | 未知のトップレベルキー | `使用できない frontmatter フィールド: <key>` |

**E3**: `name` は任意フィールドだが、書いた場合はコマンド名の最終セグメントになる。大文字・空白・記号を含む値はコマンドとして解決できない。公式に明示の形式規定はないため、Agent 定義側(`check-agent-definition.ts`)と同じ `^[a-z0-9-]+$` を基本とし、先頭・末尾ハイフンの禁止を足す。

`--`(ハイフン連続)は禁止しない。API 仕様には制約があるが Claude Code にはなく、`when_to_use` のようなアンダースコア命名も許容される実態がある以上、根拠のない制約を足さない。

**E4**: Claude Code は `description` 省略時に本文の第 1 段落を使う。両方無いと発火の手がかりが一切なくなる。片方があれば error にしない。

**E5**: 17 フィールド以外を弾く。未知キーは Claude Code に無視されるため動作は壊れないが、typo(`allowed_tools` / `whenToUse` 等)を検出できる唯一の手段になる。**Agent 定義側は同じ条件を warning にしている**が、こちらは error とする。SKILL.md はフィールド数が多く typo の余地が大きいこと、キー名の揺れが黙って無視される害が大きいことによる。

許容キー: `name` / `description` / `when_to_use` / `argument-hint` / `arguments` / `disable-model-invocation` / `user-invocable` / `allowed-tools` / `disallowed-tools` / `model` / `effort` / `context` / `agent` / `background` / `hooks` / `paths` / `shell`

#### warnings

| # | 条件 | メッセージ |
| --- | --- | --- |
| W1 | `description` が未指定 | `description が未指定。本文の第 1 段落が使われる` |
| W2 | `description` + `when_to_use` が 1536 字超 | `description と when_to_use の合計が 1536 文字を超えている(N 文字)。一覧で切り詰められる` |
| W3 | 同上が 1300 字超 1536 字以下 | `description と when_to_use の合計が上限に近い(N 文字 / 1536)` |
| W4 | 本文が 500 行超 | `本文が 500 行を超えている(N 行)。references/ への分割を検討する` |
| W5 | `context: fork` があり `agent` が未指定 | `context: fork に対する agent が未指定` |

**W2 が A の中核**。Claude Code は `description` + `when_to_use` を合算して 1536 字で切り詰める。切り詰められた description は発火判断そのものを壊すが、実行時に何のエラーも出ない。`description-guide.md` が「長さを理由に削らない」と定めている以上、上限に触れたことを知る手段がこの検査しかない。

**W3** は事前警告。閾値 1300 字は上限の 85% とし、改稿 1 回分の余裕を見る。現行の最長は `prompt-smith` の約 747 字(49%)。

**W5** は `context: fork` の運用ミス検出。`agent` 未指定でも既定の subagent で動くが、意図した agent 型を指定し忘れた可能性が高い。

#### 検査しないもの

| 項目 | 理由 |
| --- | --- |
| `name` の 64 字上限 | API 仕様。Claude Code に規定なし |
| 予約語 `anthropic` / `claude` | API 仕様。`claude-model-policy` が正常動作している |
| XML タグ(`<` `>`) | API 仕様。Claude Code に規定なし |
| `name` とディレクトリ名の一致 | **不一致は仕様**。プラグインスキルでは `name` がコマンド名を決める |
| `description` 単体の 1024 字 | Claude Code の上限は合算 1536 字 |
| YAML の完全な構文解釈 | `parseFrontmatter` の範囲に合わせる(Agent 定義側と同じ制約) |

### 3.2b skill と command の差

検査項目は共通。差は次の 2 点のみ。

| # | 対象 | 条件 | 判定 |
| --- | --- | --- | --- |
| W6 | command のみ | `name` が指定されている | warning: `command の name はコマンド名を決めない。呼び出し名はファイル名(<basename>)になる` |
| — | command のみ | ファイル名が `^[a-z0-9][a-z0-9-]*$` に不一致 | error(E3 を `name` ではなくファイル名に当てる) |

**W6 の理由**: command の呼び出し名はファイル名で決まる。`name` を書いても表示ラベルにしか効かないため、skill と同じ感覚で `name` を書いた作者は、意図と異なるコマンド名になっていることに気づけない。現在リポジトリの command 7 本はいずれも `name` を持たず、`description`(+ `argument-hint`)だけを使っている。

**ファイル名への E3 適用**: skill では `name` かディレクトリ名がコマンド名になるため `name` を検査する。command ではファイル名がコマンド名になるため、そちらに同じ形式規則を当てる。

対象の判別はパスで行う。`commands/` 配下の `.md` を command、`SKILL.md` を skill とする。`--type skill|command` で明示指定もできるようにし、判別できないパスではこの引数を要求する。

### 3.3 CLI 契約

`check-agent-definition.ts` の契約をそのまま踏襲する。

```bash
node plugins/optimize-agents/scripts/check-skill-definition.mjs <パス> [--type skill|command]
```

stdout に整形 JSON:

```json
{
  "path": "plugins/foo/skills/bar/SKILL.md",
  "type": "skill",
  "name": "bar",
  "command": "/foo:bar",
  "errors": [],
  "warnings": ["description と when_to_use の合計が上限に近い(1402 文字 / 1536)"]
}
```

command の場合:

```json
{
  "path": "plugins/raphael/commands/review.md",
  "type": "command",
  "name": "review",
  "command": "/raphael:review",
  "errors": [],
  "warnings": []
}
```

- `type`: パスから判別(`commands/` 配下の `.md` → command、`SKILL.md` → skill)。`--type` があればそれを優先する
- `name`: skill は frontmatter の値、未指定ならディレクトリ名。command はファイル名(拡張子なし)
- `command`: 解決後の呼び出し名。パスから plugin / project / personal を判別して組み立てる

`name` を書き換えたときにコマンド名がどう変わるかは実行するまで分からないため、検査器が明示する。command で `name` を書いても `command` は変わらないことが、この出力で見える。

終了コード: `0` = errors なし / `1` = errors あり / `2` = 引数不正・読込失敗・`--type` が判別できない。

`--scope` に相当する引数は持たない。検査項目が配置場所に依存しないため。`command` の組み立てにのみパスを使う。

### 3.4 実装方針

- `src/lib/frontmatter.ts` の `parseFrontmatter` をそのまま使う(Agent 定義固有の前提は入っていない)
- `check-agent-definition.ts` の関数分割(`usage` / `parseArgs` / `checkDefinition` + トップレベルの実行部)を踏襲する
- `build.ts` の `entryPoints` に `"check-skill-definition": "./src/check-skill-definition.ts"` を追加する
- skill-creator の `quick_validate.py` はコードを流用しない。公式 best-practices に明記された制約の独立実装とする(Apache 2.0 の帰属表示を要さない形にする)

### 3.5 テスト

`src/__test__/check-skill-definition.test.ts`。既存 `check-agent-definition.test.ts` と同形式(tmpdir + `spawnSync` で CLI 起動 + stdout の JSON 検証 + `afterEach` で削除)。

全 17 ケース。

**skill(10 ケース)**:

| # | ケース | 期待 |
| --- | --- | --- |
| 1 | 正常(`name` + `description` + 本文) | errors 0 / warnings 0 / 終了 0 / `command` が `/plugin:name` |
| 2 | E1 frontmatter なし | errors に E1 |
| 3 | E2 終端 `---` なし | errors に E2 |
| 4 | E3 `name: Foo_Bar`(大文字・記号) | errors に E3 |
| 5 | E3 `name: -foo`(先頭ハイフン) | errors に E3 |
| 6 | E4 `description` なし + 本文空 | errors に E4 |
| 7 | E5 `allowed_tools`(typo) | errors に E5 |
| 8 | W1 `description` なし + 本文あり | warnings に W1 / errors 0 / 終了 0 / `name` がディレクトリ名 |
| 9 | W2 `description` + `when_to_use` が 1600 字 | warnings に W2 / W3 は出ない |
| 10 | W3 同上が 1400 字 | warnings に W3 / W2 は出ない |
| 11 | W4 本文 520 行 | warnings に W4 |
| 12 | W5 `context: fork` + `agent` なし | warnings に W5 |

**command(5 ケース)**:

| # | ケース | 期待 |
| --- | --- | --- |
| 13 | 正常(`description` + 本文、`name` なし) | errors 0 / warnings 0 / `name` と `command` がファイル名由来 |
| 14 | W6 `name: other` を指定 | warnings に W6 / `command` はファイル名のまま |
| 15 | ファイル名 `Deploy_App.md` | errors に E3(ファイル名に対する形式違反) |
| 16 | E5 + W2(`allowed_tools` typo + 1600 字) | command でも共通項目が効く |
| 17 | `--type` 明示(`commands/` 外のパス) | `--type command` で command として検査される |

W1 / W2 / W3 / W4 / W5 は skill / command で同一のコードパスを通るため、command 側では代表として W2 のみ(ケース 16)を検査する。判定を skill / command で分岐させない実装を前提とし、分岐する実装になった場合はケースを追加する。

ケース 9 と 10 は境界の検証を兼ねる。W2 と W3 は排他(1536 字超なら W2 のみ、1300〜1536 字なら W3 のみ)で、両方が同時に出ないことを確認する。

`--type` を判別できないパス(`commands/` 配下でも `SKILL.md` でもない)に `--type` なしで実行した場合、終了コード 2 になることもケース 17 で併せて検証する。

### 3.6 実地確認

リポジトリ内の SKILL.md 43 本と command 7 本に実行し、結果を集計する。

**期待**: errors 0 件、warnings 0 件。

| 対象 | 現状 |
| --- | --- |
| SKILL.md 43 本 | 全て `name` + `description` のみ。最長 description 約 747 字(上限の 49%)。本文 500 行超は 0 本(最長 325 行) |
| command 7 本 | 全て `description` のみ、または `description` + `argument-hint`。`name` を持つものは 0 本(W6 に当たらない)。本文は 7〜176 行 |

**warnings が 0 件でも検査器の価値は下がらない。**現状が健全であることの確認と、今後の変更に対する回帰防止が目的である。実データが閾値(W3 の 1300 字、W4 の 500 行)に一度も当たらないぶんは、テストケース 9〜11 で発火を担保する。

`setup-gpt` の `name: setup` は仕様どおりであり、検出対象ではない。context-map に「不一致」と記録した項目は誤りだったため、実地確認の期待値から外す。

---

## 4. B: description の方針決定

### 4.1 現状

| | 現行(description-guide.md) | skill-creator |
| --- | --- | --- |
| 長さ | 長さを理由に削らない | 100-200 words 目安。精度を犠牲にしてもこの範囲 |
| 例示 | 2 つ目以降も残す。一致のためにある | 個別クエリの列挙を禁止。カテゴリへ一般化 |
| 言い換え | 残す。一致する依頼文の幅が広がる | (言及なし) |
| 語形 | 「必ず使用する」と書く | 命令形。"Use this skill for" |
| 人称 | (規定なし) | (規定なし。ただし公式は三人称を明記) |
| 焦点 | (規定なし) | 実装詳細でなくユーザーの意図 |
| 他スキルとの境界 | 近いスキルが担当する場面を書く | distinctive で即座に識別可能に |

現行は 2026-08-01 に task-utility 6 スキル 168 問で測った実測(158/168 → 161/168)を根拠に持つ。skill-creator 流を同条件で測った記録はない。

### 4.2 検証すべき仮説(測定の前に)

skill-creator が「個別クエリを列挙するな」と言う理由は、プロンプト本文に明記されている:

> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.

**どちらも発火精度そのものの主張ではない。**②はコンテキスト圧迫の話であり、①は eval セットへの過学習の話である。

現行の最長 description は `prompt-smith` の約 747 字で、Claude Code の上限 1536 字(`description` + `when_to_use` 合算)の 49%。英語 100-200 words は概ね 600-1300 字に相当する。**現行は既に skill-creator の想定範囲内に収まっている可能性がある。**

なお skill-creator の 1024 字は API 仕様の値であり、Claude Code では 1536 字。skill-creator が「hard limit」として置いた制約は、このリポジトリでは 1.5 倍の余裕がある。

この仮説が正しければ、両者は排他ではなく、取り込むべきは「一般化」ではなく「上限を意識する規律」と「三人称・命令形・意図への焦点」だけになる。

測定はこの仮説の検証を兼ねる。

### 4.3 測定設計

#### 対象

optimize-agents 自身の 3 スキル(`prompt-smith` / `skill-eval` / `agent-creator`)、既存 eval セット 80 問。

| 種別 | prompt-smith | skill-eval | agent-creator | 計 |
| --- | ---: | ---: | ---: | ---: |
| trigger | 8 | 8 | 8 | 24 |
| short | 8 | 8 | 8 | 24 |
| fp | 8 | 12 | 12 | 32 |

#### 2 案の作成

- **A 案**: **F 適用後**の description(現行 747 / 419 / 451 字 + command の例示追加分)。着手前の現状ではない。F で書き加えた分も「現行の方針で書いたもの」として扱う
- **B 案**: skill-creator 流で書き直す
  - 個別の依頼文例示 → ユーザー意図のカテゴリへ一般化
  - 100-200 words 相当(日本語で 400-600 字目安)へ圧縮
  - 三人称・命令形
  - 実装詳細でなく意図に焦点
  - 他スキルとの境界は「distinctive」の観点で書き直す

**3 スキルを一括で書き換える。** fp セットは「担当が近い別スキルが正解の依頼」であり、3 スキルは互いにこの関係にある(prompt-smith = 本文 / skill-eval = description + 測定 / agent-creator = Agent 定義)。1 スキルだけ替えると、そのスキルが他スキルの fp 問を奪う・譲る動きが起きて、変化が「その改稿の効果」なのか「境界の移動」なのか切り分けられない。

trigger / short セットは「そのスキルが正解の依頼」なので原理的には独立だが、発火判断は available_skills 全体を見て行われるため、他スキルの description 変化が影響しないとは言い切れない。**3 スキル一括**にすれば、この点も含めて「2 つの方針セット全体の比較」として意味が通る。

#### 測定手順

skill-eval が記録している「連続測定では先に走った方が高く出る傾向がある」を踏まえ、**順序を入れ替えた 2 巡**を行う。

```
巡 1: A案 → B案
巡 2: B案 → A案
```

各巡で 3 スキル × 3 種 = 9 回のランナー起動。`--runs 2 --workers 6` を全巡で固定。

合計 = 2 案 × 2 巡 × 9 = 36 回のランナー起動、80 問 × 2 案 × 2 巡 × 2 runs = 640 回の `claude -p`。

各測定の `environment`(`base_url` / `auth_source` / `model`)が全巡で一致していることを確認する。不一致があればその巡は破棄して測り直す。

#### 判定

比較の単位は **1 案あたり 160 問**(80 問 × 2 巡)。A 案 160 点満点、B 案 160 点満点で、両者を比べる。

| 差(160 問中) | 判定 |
| --- | --- |
| 3 問以上 | 勝者の方針を `description-guide.md` に採用 |
| 1〜2 問 | 現行(A 案)維持 |
| 0 | 現行維持 |

閾値 3 の根拠: skill-eval が「1〜2 問の差で description を直さない」と定めている。この規律を下回る差で方針を覆さない、という一貫性から 3 を採る。2 巡で測るため 160 問中の 3 問(1.9%)であり、1 巡 80 問での 1.5 問相当にあたる。

**3 種の内訳も見る。** 合計だけで判断しない(skill-eval の既存規律)。合計で勝っていても substantive / short / fp のいずれかが 2 問以上落ちていれば、内訳を報告して判断を仰ぐ。

**巡ごとの一貫性も見る。** 巡 1 と巡 2 で勝敗が逆転した場合、差は測定ノイズの範囲にある。合計差が 3 以上でも現行維持とし、内訳を報告する。

### 4.3b 既存の回帰基準との関係

context-map §5 に記録された回帰基準(task-utility 6 スキル 168 問: substantive 46/48, short 46/48, fp 69/72)は **task-utility の測定値**であり、B の測定対象(optimize-agents 3 スキル 80 問)とは対象が異なる。直接の比較対象にはならない。

B では **A 案自身の巡 1 と巡 2 の一致度**を測定系の健全性指標として使う。同一 description・同一問題で巡をまたいだ差が 5 問(3%)を超える場合、測定系が不安定と判断してその測定を破棄する。skill-eval の「スコアが動かないときは測定系を疑う」の裏返しにあたる。

### 4.4 測定とは独立に取り込む項目

測定結果によらず `description-guide.md` に追加する。これらは現行と衝突しない。

| 項目 | 出典 | 追加先 |
| --- | --- | --- |
| 三人称で書く。「〜をお手伝いします」「あなたは〜できます」を避ける | 公式(system prompt へ注入されるため視点の不統一が discovery を壊す) | §書く内容 |
| `description` と `when_to_use` の合計を 1536 字以内にする | 公式(Claude Code。超過分は一覧で切り詰められる) | §書く内容(新設の制約節) |
| 実装の仕組みでなくユーザーの意図に焦点を置く | skill-creator | §書く内容 |
| 他スキルと注意を奪い合う。即座に識別できる表現にする | skill-creator | §書く内容 |
| 改稿が失敗し続けるときは文構造・言い回しを変える | skill-creator | §直したときの確かめ方 |

「命令形で書く」は現行の「必ず使用する」と方向が一致するため、既存の記述に統合する。

**取り込まない公式仕様**: `name` の 64 字上限・予約語禁止・XML タグ禁止・`description` 単体 1024 字は、いずれも API / claude.ai 仕様であり Claude Code には適用されない(§1)。`description-guide.md` に書かない。

「長さを理由に削らない」と 1536 字上限は矛盾しない。前者は**簡潔さを目的とした削減**を禁じる規律、後者は**プラットフォームの物理上限**である。改稿の結果として上限に触れたときは、削るのではなく `when_to_use` への分割を検討する — この判断も §書く内容 に書く。

### 4.5 Agents 定義への波及

`description-guide.md` は `skill-eval`(SKILL.md 用)と `agent-creator`(Agent 定義用)の両方から参照される。§Agents 定義での違い は「skill 向けの基準を準用する」「実測はない」と明記している。

B の改稿では:

- §書く内容 の変更は Agents 節にも自動的に波及する(準用の構造をそのまま維持)
- **1536 字の上限は SKILL.md 固有**であることを明記する。Agent 定義の description に長さ制限は公式に確認できていない。`when_to_use` フィールドも Agent 定義には存在しない
- 「実測の有無を出典として書き分ける」現行の規律を壊さない。B 案採用時は「2026-08-02、optimize-agents 3 スキル 80 問 × 2 巡で測定」と出典を書く

---

## 5. C: eval 先行(baseline を先に測る)

### 5.1 なぜ要るか

skill-eval は「直したら測る」を持つが「書く前に測る」を持たない。公式・skill-creator の双方が evaluation-driven development を推している:

> 1. スキル無しで代表タスクを回し、失敗を記録する
> 2. その gap を突く eval を 3 本作る
> 3. baseline を測る
> 4. gap を埋める最小限の本文を書く
> 5. 反復

器は既にある。`run-output-eval.ts` の `without_skill` 構成が baseline 測定そのもの。

### 5.2 追加する規律(skill-eval/SKILL.md)

新設節「新しいスキルを作るとき」を §出力契約を測る の前に置く。内容:

- スキルを書く前に、スキル無しで代表タスクを実行し、失敗を記録する
- 記録した失敗を突く eval を作る。失敗しなかった項目は eval にしない
- `without_skill` だけで測り、baseline を得る
- baseline で通る assertion は、スキルの効果を測れない。落とすか書き直す
- 本文は、記録した失敗を埋める分だけ書く

最後の項目は prompt-smith の「素案を書き切ってから別のパスで削る」と整合する。C は「何を書くか」を絞る規律、prompt-smith は「書いたものをどう削るか」の規律で、工程が異なる。

### 5.3 既存スキルの改稿に適用するか

**適用しない。**この節は新規作成時に限る。

既存スキルの改稿では baseline が定義できない。「スキル無し」で測っても、既に本文が存在する以上それは baseline ではなく削除案の測定になる。既存スキルを改稿するときの比較対象は改稿前のスキルであり、それは skill-eval が既に持つ「直したら測る」の枠組みで扱う。

節の見出しを「新しいスキルを作るとき」とし、適用範囲を見出しで示す。

---

## 6. D: assertion の質の基準

### 6.1 なぜ要るか

skill-eval §チェッカーを書く は `grading.json` のスキーマと呼出契約だけを持つ。**何を assertion にすべきかの基準がない。**「ファイルが存在する」だけの assertion は、間違った成果物でも通る。

skill-eval は既に「両構成が同じ点数なら、その assertion に識別力はない」を持つが、これは事後判定。D はその事前版にあたる。

### 6.2 追加する規律(skill-eval/SKILL.md §チェッカーを書く)

- 成果物の存在だけを見る assertion は書かない。内容が正しいことを見る
- 間違った成果物でも通る assertion は、識別力がない。何が書かれているかを確かめる
- 検証できない assertion は書かない。主観的な品質は checker で測らない
- assertion 名は、何を確かめているかが読んで分かる語にする

最後の項目は `grader.md` の "descriptive names — they should read clearly in the benchmark viewer" に由来する。このリポジトリにビューアはないが、`benchmark.md` の表に出るため同じ理由が成り立つ。

`grader.md` の他の規律(実ファイルを検査する / 部分点なし / 不確実なら fail)は移さない。決定的プログラムである checker では構造的に満たされるため。

---

## 7. E: train/test 分割

### 7.1 なぜ要るか

skill-eval は全問を測り、その結果を見て description を直す。同じ問題を見て直し、同じ問題で測る — 過学習が構造的に起きる。

description-guide の「除外だけを足さない」はこの症状への対処だが、**過学習が起きたことを検出する手段がない。**

### 7.2 実装しない理由

`run_loop.py` は 40% holdout。現状 1 スキルあたり 8〜12 問なので test が 3〜5 問になり、1 問が 20〜33% に相当する。skill-eval の「1〜2 問の差で直さない」と両立しない。

ユーザー判断により、eval セットの拡充は行わない。よって自動分割ロジックは実装せず、規律のみをテキストで書く。

### 7.3 追加する規律(skill-eval/SKILL.md)

§ばらつきを疑う の後に節を追加:

- 直すときに見る問と、直した後に測る問を分ける
- 分けるときは、種別ごと・`should_trigger` の真偽ごとに分ける。fp だけを取り置くと、正例側の過学習を検出できない
- 取り置いた問で測った結果が、見て直した問より大きく落ちるときは、その改稿は eval セットに過学習している
- 問数が足りず分けられないときは、分けずに測る。ただし改稿の採否を、見て直した問のスコアだけで決めない

最後の項目が現状に対する実効的な規律になる。

---

## 7.5 F: commands を対象範囲へ追加

### 7.5.1 なぜ要るか

command は AI が読む指示書である。`.claude/commands/deploy.md` と `.claude/skills/deploy/SKILL.md` は同じ `/deploy` を作り、同じ frontmatter 仕様を持つ(§1)。にもかかわらず optimize-agents の 3 スキルはいずれも command を対象に含めていない。

| スキル | 現在の対象 | command の扱い |
| --- | --- | --- |
| `prompt-smith` | CLAUDE.md / SKILL.md / output style / Agents 定義 / メモリの本文、`references/` | 記載なし |
| `skill-eval` | SKILL.md の description、skill の発火・出力 | 記載なし |
| `agent-creator` | `.claude/agents/*.md` / `plugins/*/agents/*.md` | 対象外(Agent 定義のみ) |

リポジトリには command が 7 本ある(codiel 3 / pitcrew 3 / raphael 1)。本文は 7〜176 行で、`raphael/commands/review.md` は 176 行と SKILL.md の中央値を超える。**指示書として実質的な分量を持ちながら、どの規律の対象でもない。**

### 7.5.2 担当の割り当て

skill との対応関係から、既存の担当分割をそのまま延長する。

| 対象 | 担当スキル | 根拠 |
| --- | --- | --- |
| command の**本文** | `prompt-smith` | SKILL.md 本文と同じ扱い。AI が読む指示書の本文 |
| command の **description** | `skill-eval` | skill の description と同一仕様(1536 字合算・発火判断) |
| command の**静的検査** | A の検査器 | skill と同一の frontmatter 仕様 |

`agent-creator` は変更しない。command は Agent 定義ではない。

### 7.5.3 変更内容

**`prompt-smith/SKILL.md`**:

- 本文の対象記述に「`commands/` に置かれたコマンド定義の本文」を加える
- description の例示に command を指す依頼を加える(「このコマンドの本文を直して」「review.md が長いので削って」)
- description の対象列挙に command を加える

**`skill-eval/SKILL.md`**:

- §description の書き方 の対象に command を加える
- 測定については **skill に限る現行の制約を維持する**。理由は次項

書き方と測定で対象が異なるため、本文で書き分ける。現行の冒頭は「対象は SKILL.md の frontmatter にある description である」だが、これを次の 2 文に分ける。

- description を書く対象: SKILL.md と `commands/` のコマンド定義
- 測定する対象: skill のみ

現行 description の「測定対象は skill に限り、Agent 定義の発火は測らない」は残し、command も測らないことを加える。

**`references/description-guide.md`**:

- 冒頭の適用範囲に command を加える
- `when_to_use` との合算 1536 字の制約(§4.4)は skill と command に共通で効くと明記する

### 7.5.4 command の発火測定を行わない理由

`run-trigger-eval.ts` は一時ワークスペースの `.claude/skills/<name>/SKILL.md` に対象を配置し、最初のツール呼び出しが `Skill` かで発火を判定する。command を測るには次が要る。

- 配置先を `.claude/commands/<name>.md` に変える
- 発火の検出方法を確かめる(command 起動が `Skill` ツールとして観測されるかは未確認)

`skill-eval-rationale.md` には、旧 `run_eval.py` が `.claude/commands/` に登録して測っていたが「現行 Claude Code では commands と skills が別系統で、自然文依頼では command が選ばれない」ため常に発火せずになった、という記録がある。**自然文依頼で command が自律発火するかどうか自体が未検証**である。

公式は command について `disable-model-invocation` フィールドを持つと記しており、既定では Claude が自動でロードしうる。だが実際の発火挙動を測った記録はこのリポジトリにない。

したがって F では **description の書き方の規律だけを command に広げ、測定は対象外のまま**とする。測定の可否は別途検証する(§11 未解決事項 #6)。

`skill-eval` の description に「測定対象は skill に限る」と既に書かれているため、この記述は維持する。description の書き方が command にも及ぶことと、測定が skill に限ることを、本文で書き分ける。

### 7.5.5 CLAUDE.md への波及

確認済み(2026-08-02)。両ファイルとも同一の記述を持つ。

| ファイル | 記述 |
| --- | --- |
| `CLAUDE.md` | SKILL.md の本文・その他の AI 向け指示書は `optimize-agents:prompt-smith` の基準で書くこと |
| `CLAUDE.example.md:14` | 同上 |

command は「その他の AI 向け指示書」に含まれる。**両ファイルとも変更しない。**

CLAUDE.md の更新には人間の確認が要る運用(CLAUDE.md 運用方針)だが、変更しないため確認も不要。

---

## 8. 変更ファイル一覧

| ファイル | 変更 | 項目 |
| --- | --- | --- |
| `plugins/optimize-agents/src/check-skill-definition.ts` | 新規 | A |
| `plugins/optimize-agents/src/__test__/check-skill-definition.test.ts` | 新規 | A |
| `plugins/optimize-agents/build.ts` | entryPoints に 1 行追加 | A |
| `plugins/optimize-agents/scripts/check-skill-definition.mjs` | 生成物(git 管理) | A |
| `plugins/optimize-agents/skills/skill-eval/SKILL.md` | 節追加 3 箇所 + 対象記述 + description | C / D / E / F |
| `plugins/optimize-agents/skills/prompt-smith/SKILL.md` | 対象記述 + description | F |
| `plugins/optimize-agents/references/description-guide.md` | 改稿 + 適用範囲 | B / F |
| `plugins/optimize-agents/skills/agent-creator/SKILL.md` | 検証コマンドの追記 | A |
| `plugins/optimize-agents/README.md` | スクリプト表 1 行、スキル説明、アップデート注意 | A / B / F |
| `plugins/optimize-agents/docs/skill-creator-intake.md` | 新規(分析結果と不採用の根拠、仕様分岐の記録) | 全体 |
| `plugins/optimize-agents/docs/description-out-of-scope.md` | B の測定結果を追記 | B |
| `plugins/optimize-agents/.claude-plugin/plugin.json` | 0.11.1-dev → 0.12.0-dev | 全体 |

`skills/*/SKILL.md` の description(3 本)は B の測定結果次第で変更する。

F で `prompt-smith` と `skill-eval` の description を変えるため、**B の測定は F の適用後に行う**(§2 実行順序の段 2 → 段 3 の依存に F を含める)。

---

## 9. 検証方法

| 項目 | 方法 | 合格条件 |
| --- | --- | --- |
| A | `pnpm test` | 新規 14 ケースが全通過 |
| A | `pnpm build` | `scripts/check-skill-definition.mjs` が生成される |
| A | SKILL.md 43 本 + command 7 本に実行 | errors 0 件。warnings が出た場合は個別に妥当性を判断する |
| B | 80 問 × 2 案 × 2 巡 | `environment` が全巡一致。A 案の巡間差が 5 問以内。判定表に従って方針決定 |
| C/D/E/F | `prompt-smith` で自己評価 | 冗長度・充足度・スタイル適合の 3 軸で評点 |
| F | `skill-eval` の trigger eval | `prompt-smith` / `skill-eval` の description 変更後、80 問のスコアが変更前以上 |
| 全体 | `claude plugin validate plugins/optimize-agents` | 既存と同じ(author の warning 1 件のみ) |

A の実地確認で errors が出た場合、検査項目が厳しすぎるのか対象が実際に不正なのかを個別に判断する。43 + 7 本は現に動作しているので、**errors が出たら検査器側を疑うのが既定**とする。

F の回帰測定は B の段(段 5)に統合してよい。F 適用後の description が B の A 案になるため、B の巡 1 で A 案を測ればそれが F の回帰確認を兼ねる。ただし F 単体でスコアが落ちた場合、B の比較の前提が崩れるため、**F の適用直後に 1 度測って現行値と比べる**。

---

## 10. リスクと制約

| リスク | 対処 |
| --- | --- |
| B の測定に 640 回の `claude -p` が要り、時間とレート制限を消費する | 巡ごとに分けて実行し、`environment` を確認しながら進める。破棄が出たらその巡だけ測り直す。測定中は他作業を行わない |
| 測定順序のバイアス | 順序を入れ替えた 2 巡で相殺する。巡ごとに勝敗が逆転したらノイズと判断する |
| 3 スキル同時書き換えによる相互干渉 | 2 案とも 3 スキル一括で作る。1 スキルずつ替えない |
| **公式仕様の再変更** | Claude Code の frontmatter 仕様は拡張が続いている(17 フィールドのうち複数に min-version 注記あり)。検査器の許容キー一覧は陳腐化する。E5 を error にする以上、新フィールド追加時に検査器が誤って弾く。README に「許容キー一覧は Claude Code のバージョンに追従が要る」と明記し、docs に出典 URL と確認日を残す |
| A の実地確認で予期しない errors が出る | 43 本は現に動作している。errors が出たら検査器側を疑うのが既定 |

### 制約

- Anthropic API 不使用(CLAUDE.md)。`claude -p` のサブスク認証に閉じる
- スクリプトは TypeScript。`src/` → `scripts/` にバンドルし、生成物も git 管理
- skill-creator は Apache 2.0。A はコード流用しない。検査項目も skill-creator(API 仕様)ではなく Claude Code 公式ドキュメントから独立に導く
- `run-trigger-eval.ts` の判定ロジック(発火率 0.5 / fp 厳密 0 / 第 1 ツールで打ち切り)は変えない
- `parseFrontmatter` は YAML を完全解釈しない。ネストした値(`hooks` の中身等)は検査対象外

---

## 11. 未解決事項

| # | 事項 | 影響度 | 現状の仮定 |
| --- | --- | --- | --- |
| 1 | B の B 案をどこまで「skill-creator 流」にするか | High | §4.3 の 4 項目(一般化・圧縮・三人称命令形・意図焦点)をすべて適用する。中途半端に適用すると何を測ったのか分からなくなる |
| 2 | short セットの位置づけ | Medium | skill-creator は短いクエリを poor test case と断じるが、このリポジトリでは 46/48 で発火している。B の測定で short の内訳を見れば実態が分かる。測定結果を見てから判断する |
| 3 | E5(未知キー)を error にするか warning にするか | Medium | error とする。Agent 定義側は warning だが、SKILL.md はフィールドが 17 種と多く typo の余地が大きい。ただし §10 のとおり仕様追従の負債を負う。実運用で誤検出が出たら warning へ下げる |
| 4 | W3 の閾値 1300 字 | Low | 上限 1536 の 85%。現行最長が 747 字(49%)なので余裕が大きい。実データで一度も当たらない可能性が高いが、テストケースで発火は担保する |
| 5 | `command` フィールドの解決ロジック | Low | パスに `/plugins/<name>/skills/` を含めば `/<plugin>:<name>`、`.claude/skills/` 配下なら `/<dir>`。ネストした `.claude/skills/` の名前衝突時のパス付き解決(`/apps/web:deploy`)までは実装しない |
| 6 | command の発火測定を行えるか | Medium | 未検証。`.claude/commands/` に配置した対象が自然文依頼で発火するか、発火が `Skill` ツールとして観測されるかが分かっていない。F では規律のみを広げ、測定は skill に限る現行を維持する。検証は別タスク |
| 7 | F で `prompt-smith` の description が長くなる | Medium | 現在約 747 字。command の例示を足すと 900 字前後になる見込みで、上限 1536 字には余裕がある。ただし B の測定で「圧縮した方が強い」と出た場合、F の追記と B の方針が逆向きに働く。F は段 3、B は段 5 なので、B の B 案は F 適用後の description を出発点として作る |

---

## 11.5 実装中の実測(2026-08-02)

### F の依頼例追加が正例の発火を落とした

F の初回改稿で `prompt-smith` の description に「対象列挙への追記」と「依頼文の例示 3 種」を同時に足したところ、`evals/trigger/prompt-smith.json` の発火が落ちた。

| 構成 | 結果 |
| --- | --- |
| 改稿前(HEAD) | 3/3 |
| 改稿前の description + F 適用後の本文 | 3/3 |
| F 適用後の description(例示 3 種を含む) | 1/3 |
| 対象列挙のみ追記(例示なし) | 8/8 |

本文の改稿は発火に影響しない。原因は description に足した別ドメインの例示である。

**採った判断(ユーザー承認済み)**: F は最小改稿(対象列挙のみ)とする。command 向けの依頼例は、command を指す eval 問を作って効果を測ってから足す。

**`description-guide.md` への反映**: §対象を広げるとき を新設し、「§削らない の『例示は残す』は同じ対象を指す言い換えに当てる。別種の対象を指す例示には当てない」と書き分けた。

この結果は §4.2 の仮説(現行は既に skill-creator の想定範囲内)と整合する。skill-creator が「個別クエリを列挙するな」と言う理由の①(overfitting 回避)は、別ドメインの例示については発火精度の面でも成り立っていた。

### B の測定対象の変更

F を最小改稿にしたため、B の A 案は当初想定(851 字)ではなく 769 字になる。`agent-creator` は F の対象外(Agent 定義のみ扱う)なので HEAD のまま 447 字。

| スキル | A 案(最小改稿後) | HEAD からの差 |
| --- | ---: | ---: |
| prompt-smith | 769 字 | +26 |
| skill-eval | 449 字 | +30 |
| agent-creator | 447 字 | 0 |

---

## 12. 修正履歴

**2026-08-02 初版**: skill-creator の `quick_validate.py` と platform.claude.com の best-practices を典拠に §3.2 を作成。

**2026-08-02 改訂**: Haiku レビューの指摘(予約語の部分一致が既存スキルを誤検出しないか)を受けて実地確認したところ、`plugins/optimize-agents/skills/claude-model-policy/` が予約語 `claude` を含みながら正常動作していた。調査の結果、SKILL.md の frontmatter 仕様が API / claude.ai 版と Claude Code 版で異なることが判明。§1 に仕様の分岐を追記し、§3.2 の検査項目を Claude Code 仕様へ全面的に書き直した。あわせて §4.4 の「公式仕様として無条件採用」から API 固有の制約を除いた。

context-map に「`setup-gpt` の `name` がディレクトリ名と不一致」と記録した項目は、プラグインスキルの仕様(`name` がコマンド名を決める)に照らして誤りだった。W1 として警告する設計は取り下げた。

**2026-08-02 追加要件**: ユーザーから「optimize-agents は commands を見ていない。これも AI への指示書なので対象としたい」との指示。§7.5 に F を新設し、A の検査器を skill / command 共通に拡張、`prompt-smith` / `skill-eval` / `description-guide` の対象範囲を広げる設計を追加した。command が skill と同一の frontmatter 仕様を持つこと(公式「Custom commands have been merged into skills」)を確認済み。command の発火測定は未検証のため対象外とし、§11 #6 に残した。

**2026-08-02 追加指示**: 「今回の変更にも prompt-smith は有効。本文の変更はこれに従う」「references も同様」との指示。§2 に §本文の執筆基準 と §適用対象 を新設し、C・D・E・F で書き加える本文と `references/description-guide.md` の改稿に prompt-smith の基準を当てることを明記した。frontmatter の description のみ対象外(`description-guide.md` に従う)。

**2026-08-02 再レビュー反映**: テストケースの網羅漏れを指摘され、W3(1300〜1536 字)・W4(500 行超)のケースが無いこと、command 側で共通 warning を 1 件も検査していないことを修正。14 ケース → 17 ケースへ。あわせて B の A 案が「F 適用後の description」であることを §2 と §4.3 の両方に明記し、`CLAUDE.example.md` の確認結果(変更不要)を §7.5.5 に記録した。
