# metatron の GOTCHAS と raphael の抗体の棲み分けを見直すための引き継ぎ書

- 日付: 2026-09-18
- 引き継ぎ元: `GOTCHA-002` を記録し、現行の棲み分け基準の取りこぼしを確認したセッション
- 引き継ぎ先: `agent-policy` の委譲規律の改善後に、metatron と raphael の知識の置き場を見直すセッション
- 対象プラグイン: `plugins/metatron`、`plugins/raphael`

## 現在地

| 項目 | 状態 |
| --- | --- |
| 課題 | **未対応**。一般則でありながら抗体の trigger pattern で捕まえられない知識に、現行基準では置き場がない |
| 発生記録 | **記録済み**。`harness-docs/GOTCHAS.md` の `GOTCHA-002` を、失われるよりよいと判断して例外的に記録した |
| 原因 | **確認済み**。判定軸が知識の一般性だけであり、抗体として発火可能かを扱っていない |
| 次の目的 | 棲み分け基準を見直し、一般性と抗体の発火可能性の組み合わせで知識を取りこぼさないようにする |

この件は、`agent-policy` の委譲規律の改善より**後に**進める。先行する作業の引き継ぎは `harness-docs/handover/2026-09-18-agent-policy-delegation-example-handover.md` にある。

先に棲み分けを変えると、`GOTCHA-002` が抗体へ移る可能性がある。その場合、agent-policy 側の「GOTCHAS からの昇格」という立て付けが崩れる。agent-policy 側が先に規律へ反映されれば、`GOTCHA-002` の内容は規律に吸収され、台帳のエントリをどちらへ分類するかは実害を持たなくなる。

## 次セッションが最初にやること

1. `harness-docs/handover/2026-09-18-agent-policy-delegation-example-handover.md` を読み、agent-policy の委譲規律の改善が完了していることを確認する。
2. 本引き継ぎ書、`plugins/metatron/references/gotchas-format.md` の「Raphael の抗体との棲み分け」、`harness-docs/GOTCHAS.md` の `GOTCHA-002`、判断の経緯を読む。
3. 一般則と、抗体の trigger pattern で発火可能な知識を区別するために、現行の判定基準に何が不足しているかを整理する。
4. 検討案を比較して棲み分け基準を決め、関連する文書・実装・バージョン・検証を追随させる。

---

## 1. 確認済みの基準と空白

`plugins/metatron/references/gotchas-format.md` の「Raphael の抗体との棲み分け」は、次を定める。

> 判定は「その知識を別のリポジトリに持っていっても成立するか」で行う。成立するなら Raphael の抗体、そのリポジトリでしか意味を持たないなら GOTCHAS とする。Raphael が未導入の環境でも、別のリポジトリで成立する一般則は記録しない。

現行の判定軸は、知識の一般性だけである。抗体として実際に発火できるかは判定に含まれない。

Raphael の抗体は、PreToolUse hook の trigger pattern（正規表現）で発火する。PostToolUse イベントに対応する抗体は、Raphael CLI が `trigger.event` で PreToolUse だけを対応するため作成不可と判断され、非採用になった事例がある。

このため、別のリポジトリでも成立する一般則であっても、正規表現で発火条件を捕まえられなければ、現行基準では次のどちらにも置けない。

- GOTCHAS: 一般則であるため対象外になる。
- 抗体: trigger pattern を書けないため作成できない。

## 2. 実際に起きたこと

`harness-docs/GOTCHAS.md` の `GOTCHA-002` は、この取りこぼしに当たる。

- 知識の内容は「委譲の依頼文では、説明用の例示と成果物へ書く内容を区別する」であり、別のリポジトリでも成立する一般則である。
- 発火条件は「`Agent` tool を呼ぶときの依頼文が説明用の例示を含むか」であり、正規表現では判定できない。
- 独立にレビューさせた結果は「抗体に属する」だったが、抗体側には受け皿がない。

このセッションでは、知識が失われるよりよいと判断して GOTCHAS へ記録した。この判断は現行基準に反しており、個別の例外ではなく基準そのものを見直す必要がある。

---

## 3. 検討する点

次は未検証であり、実装前に比較して扱いを決める必要がある。

1. 棲み分けの判定軸に「抗体として trigger を書けるか」を加え、一般則でも trigger を書けないものを GOTCHAS とする。
2. GOTCHAS 側に、一般則を受け入れる条件を明記する。
3. 抗体側の trigger の仕組みを広げる。候補には PostToolUse への対応、tool 引数の内容による判定がある。
4. 第 3 の置き場を設ける。

案 3 は raphael の実装変更を伴うため影響が大きい。案 1 と案 2 は文書の変更で済む。これらの案を、本引き継ぎ書の記述だけから結論として扱わない。

---

## 4. 影響範囲と制約

- `plugins/metatron/references/gotchas-format.md` の「Raphael の抗体との棲み分け」を見直す。これは AI 向け指示書である。
- `plugins/metatron/skills/recording-gotchas/SKILL.md` は棲み分けの判断を参照しているため、基準を変えた場合は追随を確認する。
- `plugins/raphael/` の抗体の作成規律と `agents/antibody-synthesizer` は、抗体を非採用にする判断基準を持つ。選んだ方針に応じて追随範囲を確認する。
- `plugins/metatron/docs/format-change-checklist.md` は、`gotchas-format.md` の書式と規則の変更に追随するチェックリストである。同ファイルを変更した場合は、該当節の項目をすべて追随させる。
- `.raphael/antibodies/` を更新する場合は、直接編集せず `plugins/raphael/scripts/update-antibody.mjs` を使う。
- 触ったプラグインのバージョンを上げる。`plugin.json` と `package.json` があるプラグインは、両方を同じ値にそろえる。
- `pnpm run lint` は `Found N infos` と表示しても、終了コードが 0 なら合格である。

---

## 5. スコープ外

- `GOTCHA-002` の内容そのもの。これは先行する agent-policy 側の作業で扱う。
- 既存の抗体の内容。

---

## 6. 参照

- 現行の棲み分け基準: `plugins/metatron/references/gotchas-format.md`
- 実例: `harness-docs/GOTCHAS.md` の `GOTCHA-002`
- 判断の経緯: `docs/chat/2026/0918/phyllis998/0151-prompt-smith-stage1-implementation.md`
- 先行する作業: `harness-docs/handover/2026-09-18-agent-policy-delegation-example-handover.md`
