# metatron の GOTCHAS と raphael の抗体の棲み分けを見直す実装プロンプト

以下を goal コマンドの入力として使う。

---

`agent-policy` の委譲規律の改善が完了した後、metatron の GOTCHAS と raphael の抗体の棲み分け基準を見直せ。最初に `harness-docs/handover/2026-09-18-metatron-raphael-boundary-handover.md` を全文読み、確定事項、未決定の検討点、スコープを守ること。

この件を `agent-policy` の委譲規律の改善より先に進めてはならない。先に棲み分けを変えると、`GOTCHA-002` が抗体へ移る可能性があり、agent-policy 側の「GOTCHAS からの昇格」という立て付けが崩れる。先行作業の引き継ぎは `harness-docs/handover/2026-09-18-agent-policy-delegation-example-handover.md` にある。

## 目的

一般則でありながら抗体の trigger pattern（正規表現）で捕まえられない知識を、GOTCHAS と抗体のどちらからも取りこぼさない棲み分け基準を定める。

## 確認済みの事実

- `plugins/metatron/references/gotchas-format.md` は、別のリポジトリでも成立する知識を Raphael の抗体、そのリポジトリでしか意味を持たない知識を GOTCHAS とする。現行の判定軸は知識の一般性だけである。
- 抗体は PreToolUse hook の trigger pattern で発火する。Raphael CLI は `trigger.event` で PreToolUse だけを対応するため、PostToolUse イベントに対応する抗体は作成不可として非採用になった事例がある。
- このため、一般則でも正規表現で発火条件を捕まえられない知識は、GOTCHAS では一般則であるため対象外になり、抗体では trigger を書けないため作成できない。
- `harness-docs/GOTCHAS.md` の `GOTCHA-002` はこの実例である。知識の内容は、委譲の依頼文で説明用の例示と成果物へ書く内容を区別するという一般則である。一方、`Agent` tool を呼ぶ依頼文が説明用の例示を含むかは正規表現で判定できない。
- 独立にレビューさせた結果は `GOTCHA-002` を抗体に属するとしたが、抗体側には受け皿がない。このセッションでは知識が失われるよりよいと判断して GOTCHAS へ記録した。この判断は現行基準に反しており、基準自体の見直しが必要である。

## 検討する点

1. 判定軸に、抗体として trigger を書けるかを加え、一般則でも trigger を書けないものを GOTCHAS とする。
2. GOTCHAS 側に、一般則を受け入れる条件を明記する。
3. 抗体側の trigger の仕組みを広げる。候補には PostToolUse への対応、tool 引数の内容による判定がある。
4. 第 3 の置き場を設ける。

案 3 は raphael の実装変更を伴うため影響が大きい。案 1 と案 2 は文書の変更で済む。これらの案を本プロンプトの記載だけから結論として扱わず、比較して選んだ方針と根拠を報告すること。

## 影響範囲と制約

- `plugins/metatron/references/gotchas-format.md` の「Raphael の抗体との棲み分け」を見直す。`plugins/metatron/skills/recording-gotchas/SKILL.md` は棲み分けの判断を参照しているため、基準を変えた場合は追随を確認すること。
- `plugins/raphael/` の抗体の作成規律と `agents/antibody-synthesizer` は、抗体を非採用にする判断基準を持つ。選んだ方針に応じて追随範囲を確認すること。
- `plugins/metatron/references/gotchas-format.md` を変更した場合、`plugins/metatron/docs/format-change-checklist.md` の該当節の項目をすべて追随させること。
- `.raphael/antibodies/` を更新する場合は、直接編集せず `plugins/raphael/scripts/update-antibody.mjs` を使うこと。
- 触ったプラグインのバージョンを上げる。`plugin.json` と `package.json` があるプラグインは、両方を同じ値にそろえること。
- `pnpm run lint` は `Found N infos` と表示しても、終了コードが 0 なら合格とすること。
- `GOTCHA-002` の内容そのものと、既存の抗体の内容は変更しないこと。

## 完了報告に含めること

- agent-policy 側の先行作業が完了していることの確認結果
- 選んだ棲み分け基準、一般則かつ trigger を書けない知識の扱い、判断の根拠
- metatron と raphael の関連文書・実装への追随内容
- バージョン変更、実行した検証、変更したファイル
- 未決定または残る懸念
