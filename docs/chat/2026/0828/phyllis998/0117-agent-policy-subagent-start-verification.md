# agent-policy SubagentStart 実装後検証

- 日付: 2026-08-28
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明（検証計画の確認）
- 前提: harness-docs/plans/2026-08-27-agent-policy-external-agent-model-assignment.md、harness-docs/design/2026-08-27-agent-policy-external-agent-model-assignment-design.md、docs/prompts/2026-08-27-agent-policy-subagent-start-verification-prompt.md
- セッション ID: 0e0c48d7-46ca-4e35-aa9d-3e0f08ceec47

---

## セッション 1: SubagentStart 役割マーカー配布機構の検証手順確認

# phyllis998

> # agent-policy SubagentStart 実装後検証（Task 8）
>
> ## 現在地
>
> `plugins/agent-policy` の「外部 Agent へのモデル割当と最適化定義の合成」は実装・コミット済みである（`ede0481`、バージョン 0.13.0-dev、21 ファイル）。残っているのは実装計画の Task 8（実装後検証）だけで、これは `hooks.json` の変更がセッション開始時にしか読まれないため、実装セッションでは実施できなかった。
>
> 実装セッションで済んでいること:
>
> - Task 0〜7 完了。lint / typecheck / build 通過、agent-policy のテストは 288 passed
> - バンドル出力へ直接 stdin を与える範囲の実測は完了済み。`gpt-sol-lead-implementer` → 注入あり（748 字）、`haiku-reviewer` / `Explore` / `Plan` / `agent-policy:gpt-luna` → 注入なし、`chat-recorder` → 注入あり（847 字、走査対象外の未知 type）
> - 全体テストのうち 4 件（codiel 2・metatron 1・sandalphon 1）が 20 秒タイムアウトで落ちるが、agent-policy を除外しても同じ 4 件が落ちるため本改修とは無関係な環境由来のフレーキーと確定済み
>
> ## 読む文書
>
> 1. 実装計画書 `harness-docs/plans/2026-08-27-agent-policy-external-agent-model-assignment.md` の Task 8
> 2. 設計書 `harness-docs/design/2026-08-27-agent-policy-external-agent-model-assignment-design.md` の §8（実機検証項目・実測結果）、§5（配布機構）、§1（判定フロー）
> 3. 実装 `plugins/agent-policy/src/hooks/subagent-start.ts`（照合規則と deny-list）
>
> ## 事前準備（未了ならここから）
>
> フック入力の生の形を記録するため、プロジェクトの `.claude/settings.json`（または `settings.local.json`）へ SubagentStart のデバッグフックを追加する。**プラグインの `hooks.json` は触らない。**
>
> ```json
> {
>   "hooks": {
>     "SubagentStart": [
>       {
>         "hooks": [
>           { "type": "command", "command": "cat >> /tmp/subagent-start-input.jsonl" }
>         ]
>       }
>     ]
>   }
> }
> ```
>
> `cat >> file` は stdin をファイルへ追記して stdout に何も出さず exit 0 で終わるため、agent-policy のフックと併存しても注入を壊さない。
>
> **追加した時点で一度セッションを開き直す。** hooks はセッション開始時にしか読まれない。開き直した後のセッションで以下を実施する。
>
> ## 検証項目
>
> ### 1. SubagentStart の発火と注入の到達
>
> 実装帯の Agent（`gpt-sol-lead-implementer`）を 1 つ dispatch し、依頼文で次を求める。
>
> > あなたに注入された追加コンテキストに「あなたはサブエージェントである」の宣言と役割マーカーの対応表が含まれているか。含まれるなら、対応表の行をそのまま引用して返せ。ファイルは変更せず、報告のみを返せ。
>
> **期待**: 宣言と、10 行の対応表（複雑または重要な実装 / 通常の実装 / 軽量な実装 / その他のタスク / コードベース探索実働 / リアルタイム情報調査 / 設計書・実装計画書の独立レビュー / 設計書・実装計画書のレビュー / コードレビュー / 設計・計画・実装のアドバイザー）が返る。SessionStart がこのセッションへ注入した対応表と同一の内容であること。
>
> ### 2. `agent_type` の実表記（設計 §8.6 の残項目）
>
> `/tmp/subagent-start-input.jsonl` を読み、記録された `agent_type` の表記を種別ごとに確認する。カバーすべき種別は 4 つ:
>
> - project 定義（`.claude/agents/` のもの。例: `gpt-sol-lead-implementer`）
> - 同梱プリセット（`agent-policy:gpt-terra` 等）
> - **他プラグイン定義**（未測。`chat-history:chat-recorder` を 1 回 dispatch するか、Stop hook の自動記録を発火させて記録を得る）
> - **ビルトイン**（未確定。`Explore` を 1 回 dispatch する）
>
> **期待**: 設計 §8.6 の実測（project 定義とビルトインは末段のみ = `"gpt-sol-lead-implementer"` / `"general-purpose"`）と整合すること。
>
> **不一致だった場合の対応**:
>
> - ビルトインの実表記が `Explore` / `Plan` 以外（名前空間付き等）だったら、`subagent-start.ts` の `exactMatches` にある builtin 判定を実表記へ追随させる。**テストを先に直してから実装を直す**（`subagent-start.test.ts` の「ビルトイン Explore には注入しない」「ビルトイン Plan には注入しない」）
> - 他プラグイン定義が `plugin:name` 形式だった場合、現行実装は完全形で当たらず末段一致へ落ちる。末段が project / 同梱のどれとも衝突しなければ未知 type として注入される（設計どおり）。衝突する場合は複数ヒットで注入側へ倒れる（これも設計どおり）。**実装の変更は不要**だが、実測した形式を報告に残す
>
> ### 3. 機械契約 Agent への注入副作用（重要）
>
> `chat-recorder` は走査対象外（他プラグイン定義）のため注入が届く。これは設計 §5 の「過剰配布側に倒す」判断どおりで、確認すべきは**注入されても機械契約が壊れないこと**である。
>
> 手順:
>
> 1. 通常どおり 1 ターン会話し、Stop hook 経由の chat-recorder 自動記録を発火させる
> 2. `docs/chat/` の該当ファイルに記録が正常に追記されたことを確認する
> 3. chat-recorder が記録以外の行動（再委譲・方針スキルのロード）を始めていないことを、そのエージェントの報告内容から確認する
> 4. `raphael:antibody-synthesizer`（Agent tool を持たない定義）でも同様に確認する。未蒸留 infection があれば Stop hook が起動を促すので、その 1 回で足りる
>
> **期待**: どちらも正常に完走し、注入された規律に引きずられた余計な行動をしない。
>
> **問題が出た場合**: 注入内容が機械契約 Agent の動作を変えたことになる。設計 §5 の過剰配布判断の再検討が要るため、**実装を独断で変えずに事象を報告する**。
>
> ### 4. 合成 dispatch の一連（設計 §8.8）
>
> 検証用の外部 Agent 定義を `.claude/agents/` へ一時的に置く。条件は次のとおり。
>
> - `agent-policy-role` マーカーを**持たない**（帯参加はしない）
> - `model` を宣言しない
> - `tools` は `Read, Grep, Glob` のみ
> - frontmatter は `name` / `description` / `tools` だけ（適用除外 3 に落ちないこと）
> - 本文に、その作業の役割記述と、検証しやすい禁止条項を 1 つ入れる（例:「出力に箇条書きを使わない」）
>
> この定義を名指しで dispatch する前に、共通規律 `plugins/agent-policy/references/orchestration-discipline.md` の §委譲先の実行モデルの確定 の判定フローを上から評価し、どの行で確定するかを記録する。読み取り帯の作業を割り当てれば判定フロー 7（合成）に落ちるはずである。
>
> 合成手順どおりに dispatch する:
>
> - ホストは対応表のその帯の定義
> - 依頼文の冒頭でホストが担う役割名を明示
> - 外部定義の本文（frontmatter より後の全文）を役割定義として同梱
> - 外部本文の禁止条項がホスト本文の同種規定より優先することを明記
> - 読み取り帯なので「ファイルを変更しない」「報告のみを返す」を重ねる
>
> **期待**: ホストが差し戻さずに作業し、外部本文の禁止条項（箇条書きを使わない等）を守った出力を返す。
>
> 続けて、同じ定義に `model: haiku` を足した版でもう 1 ケース実施する。判定フロー 8 に落ち、合成 + `model` param での宣言値適用になる。**期待**: Haiku で実行される（子の応答の粒度、または起動時の表示で確認）。
>
> ### 5. アドバイザー再委譲（設計 §8.9）
>
> 実装帯（`gpt-sol-lead-implementer`）へ、判断に迷う要素を含む小さな作業を依頼し、依頼文に「判断に迷ったらアドバイザーへ相談せよ」を含める。
>
> **期待**: 注入された対応表の `fable-adviser` が相談先に選ばれる（`Fable` の直指定ではなく、対応表の定義名が使われる）。サブエージェントの報告で相談先を確認する。
>
> ### 6. 移行期の運用条件
>
> 設計書の「移行期の運用条件」節を読み、本実装で緩和されるのが「子 Agent が親と同じ custom role map を使う前提を置かない」の 1 点のみであることを確認する。残りの条件（custom Agent のトップ階層配置と active policy の marker 明示、`setup-agents --write --merge` 前の `claude mcp list` 正常確認、Agent 名の他 scope・他 plugin との非重複）は、監査所見 1・2 および 4〜11 の修正まで継続する。
>
> ## 後片付け（忘れると次セッション以降に影響する）
>
> 1. `.claude/settings.json`（または `settings.local.json`）から追加したデバッグフックを削除する
> 2. `/tmp/subagent-start-input.jsonl` を削除する
> 3. 検証用に置いた外部 Agent 定義を `.claude/agents/` から削除する
> 4. 削除後、`git status` で作業ツリーに検証用の残骸が無いことを確認する
>
> ## 制約
>
> - 実装（`plugins/agent-policy/src/`）を変えるのは、項目 2 でビルトインの実表記が不一致だった場合だけである。その場合も**テストを先に直してから実装を直す**
> - 実装を変えたら `pnpm run build` で `scripts/` を再生成し、`src/` の変更と同じコミットに含める。`scripts/` を手で編集しない
> - ブランチを切らない。`git push` に `--force` 系を付けない
> - 作業ツリーには本改修と無関係な未コミット変更（`.raphael/` の抗体、`docs/chat/`）がある。revert・削除・上書き・コミット混入のいずれもしない
> - フックは常に exit 0 を守る。stdout に注入 JSON 以外を出さない
> - 設計で不採用が確定した案（割当マップ・派生定義生成・CLAUDE.md 焼き込み・反転注入・監査所見 1〜2/4〜11 の修正）に手を出さない
>
> ## 完了報告に含めること
>
> - 検証項目 1〜6 それぞれの実測結果
> - **`agent_type` の実表記**（4 種別すべて）。設計 §8.6 の残項目がこれで閉じる
> - **機械契約 Agent への注入副作用の有無**（chat-recorder と raphael の 2 種）
> - 合成 dispatch 2 ケース（未宣言 / enum 宣言）の成否と、判定フローのどの行で確定したか
> - アドバイザー再委譲で実際に選ばれた相談先
> - 実装を追随させた場合は、その差分と lint / typecheck / test / build の結果
> - 「移行期の運用条件のうち、本実装で緩和されるのは親子 map 非仮定のみ」の明記
> - 残課題（あれば）とその扱いの提案

> @docs/prompts/2026-08-27-agent-policy-subagent-start-verification-prompt.md

## セッション 2: SubagentStart 実機検証の完了と実測結果分析

# AI

規律読了。設計 §1/§5/§8、実装 `subagent-start.ts`、Task 8 確認済み。デバッグフックは `settings.local.json` に既在、`/tmp/subagent-start-input.jsonl` は未生成 → このセッションでまだ SubagentStart 未発火。

`★ Insight ─────────────────────────────────────`
- deny-list は 3 経路: ①project 定義で `tools` に `Agent` 無し ②同梱 `agents/*.md` 実走査で Agent 無し ③ビルトイン `Explore`/`Plan` 完全形。それ以外は全部注入 = 過剰配布側に倒す設計。
- `exactMatches` は同梱だけ `agent-policy:` 接頭辞も見る。他プラグインの `plugin:name` は完全形で当たらず末段一致へ落ちる → 末段が衝突しなければ「未知 type」扱いで注入される。
- `chat-recorder` への注入は設計どおりの副作用。壊れないことの確認が Task 8 の要点。
`─────────────────────────────────────────────────`

まず項目 1・2 を並列実測。

待機中に項目 4 の準備を進める。

`Explore` → `agent_type: "Explore"`（末段のみ）、注入なし。`agent-policy:gpt-terra` → 完全形 `"agent-policy:gpt-terra"`、注入あり（宣言 + 対応表 10 行 + 規律 5 項目）。

項目 4 の検証用外部定義を作る。

項目 1 完了。注入文 = 宣言 + 対応表 10 行 + 規律 5 項目、約 750 字。SessionStart がこのセッションへ注入した対応表と全 10 行一致。

項目 4・5 を並列実測。ホストは「コードベース探索実働」帯 = `grok-researcher`。判定フロー: 1〜6 いずれも非該当（原本は自作で特定可、frontmatter は `name`/`description`/`tools` のみ、帯適合、対応表に定義あり、MCP 固有依存なし、義務衝突なし）→ **行 7 で確定（合成）**。haiku 版は `model` enum 宣言あり → **行 8**。

ケース B 完了: 判定フロー 8 → `claude-haiku-4-5-20251001` で実行、外部本文の箇条書き禁止を完全遵守（散文のみ）。

待機中に注入サイズ差（実装セッション実測 748 字 vs 847 字）を確認。

ケース A も完了（散文のみ、禁止条項遵守）。deny-list の実挙動が debug 出力で確定:
- `Explore` → `deny=builtin:Explore`
- `agent-policy:gpt-luna` → `deny=bundled:gpt-luna:without-Agent`
- `chat-history:chat-recorder` / `raphael:antibody-synthesizer` → **deny されず注入**（走査対象外の未知 type）

`★ Insight ─────────────────────────────────────`
- 注入サイズは全 type で 748 字（fragment 348 + table 422、marker 行置換で -22）。実装セッションの 847 字は当時の policy/定義差によるもので、今の実機値は project 定義・同梱・未知 type すべて同一。
- `grok-researcher` / `grok-docs-reviewer` / `sonnet-code-reviewer` は frontmatter に `Agent` が無く **deny される**。規律「軽量帯とアドバイザー帯以外に Agent Tool を許可する」と定義の実態が食い違っている（setup-agents 側の話でスコープ外だが観察として残す）。
`─────────────────────────────────────────────────`

中間報告。項目 5 は実行中。

## 実測結果（項目 1・2・4・6）

**1. 発火と注入到達** — 成立。`gpt-sol-lead-implementer` に注入到達、内容は宣言 +対応表 10 行 + 規律 5 項目、**748 字**。対応表は SessionStart がこのセッションへ注入したものと全 10 行一致。

**2. `agent_type` 実表記** — 4 種別のうち 3 種確定（実フック入力 `/tmp/subagent-start-input.jsonl`）:

| 種別 | 実表記 | 照合 | 注入 |
|---|---|---|---|
| project 定義 | `gpt-sol-lead-implementer` | `exact:project` | あり |
| 同梱プリセット | `agent-policy:gpt-terra` | `exact:bundled`（接頭辞あり） | あり |
| ビルトイン | `Explore` | `exact:builtin` | **なし**（deny） |
| 他プラグイン | Stop hook 待ち | — | — |

設計 §8.6 の実測（project・ビルトインとも末段のみ）と整合。同梱は名前空間付き完全形で来るが `exactMatches` の `agent-policy:` 分岐が拾う。**実装の追随は不要。**

**4. 合成 dispatch 2 ケース** — 両方成立。ホストは `grok-researcher`。

- ケース A（`model` 未宣言）: **判定フロー 7 で確定**。散文のみ・箇条書き 0・見出し 0 → 外部本文の禁止条項が守られた
- ケース B（`model: haiku`）: **判定フロー 8 で確定**。自己申告 `claude-haiku-4-5-20251001`。proxy alias ホストへの enum 上書きが Claude 実行になることを実機で再確認。禁止条項も遵守

**6. 移行期の運用条件** — 引き継ぎ書の 6 条件のうち緩和されるのは「子 Agent が親と同じ custom role map を使う前提を置かない」の 1 点のみ。ただし**起動プロンプトの残存条件の列挙が 1 つ漏れている**: 「Workflow 専用 Agent は marker を宣言せず Workflow から直接 dispatch する」も継続条件。

## 追加観察（設計内で閉じるが報告対象）

`grok-researcher` / `grok-docs-reviewer` / `sonnet-code-reviewer` は frontmatter に `Agent` が無く **deny される**。規律は「軽量帯とアドバイザー帯以外に Agent Tool を許可する」だが、実定義に Agent が無い。deny 自体は設計どおり（再委譲しない定義に対応表は不要、迷いは差し戻しで解決）。setup-agents 側の話でスコープ外。

なお `.claude/agents` は `.gitignore:14` で除外済み → 検証用定義は `git status` に出ない。後片付けは `ls` で確認する。

検証用 `.md` 2 本は通常日本語で書いた（genshijin 口調は非適用）。以後の文書生成もこの方針で進める。

項目 5（アドバイザー再委譲）の結果待ち。

**他プラグイン定義の実表記が確定**: `chat-history:chat-recorder`（名前空間付き完全形）。`exactMatches` で当たらず → 末段 `chat-recorder` も project/bundled に無し → `unknown` → 注入。設計どおりで**実装変更不要**。

chat-recorder は正常完走（157 行の記録ファイル生成、再委譲・スキルロードなし）。

raphael の蒸留促しが今回の Stop で出なかったため、発火条件を確認。

項目 3 の raphael 側で判断が要る。Stop hook の蒸留促しは `distillThreshold: 3` で発火するが、現在の未蒸留 infection は 1 件のため本セッション中に自然発火しない見込み。

項目 5 完了。**相談先は `fable-adviser`**（対応表の定義名。`Fable` 直指定ではない）。注入された規律どおりに解決された。

副産物として実装セッションの「847 字」の正体が判明: `additionalContext` 本体が 748 字、**JSON シリアライズ後の hook stdout 全体が 847 字**。両者は別物で矛盾していない。

`★ Insight ─────────────────────────────────────`
- サブエージェント側は自分で hook を読み取り実行して 748/847 の両方を測っている。deny-list も切り詰めも通らない通常経路では 500 字の余裕はほぼ未使用。
- 未解決点として上がった「10,000 が parsed 値の上限か raw JSON stdout の上限か」は実装計画の範囲外だが、後者なら `String.length` 基準の切り詰めは形式保証にならない（JSON エスケープで膨張する）。今回は実測 847 < 9500 で問題化しない。
`─────────────────────────────────────────────────`

残るのは項目 3 の raphael 側だけ。先ほどの質問ツールは取り下げる。状況だけ述べる:

Stop hook の蒸留促しは `distillThreshold: 3`。現在の未蒸留 infection は 1 件のみで、このセッション中に自然発火しない。`raphael:antibody-synthesizer` へ注入が届くこと自体は確認済み（`match=unknown:none deny=no`、`chat-history:chat-recorder` と同じ経路）。未確認なのは「注入されても完走し、余計な行動をしないこと」の実機部分。

手動で dispatch すれば確認できるが、蒸留が走ると `.raphael/antibodies/` に追加または更新が入る。既に 20 件超の未コミット変更がある作業ツリーにさらに足す形になるため、指示を待つ。

- 手動 dispatch してよいか
- chat-recorder（同じく Agent tool を持たない他プラグイン定義）の完走確認で代替し、raphael 個別は未実施として報告するか

どちらで進めるか指示があれば、残りを終えて後片付け（デバッグフック削除・`/tmp/subagent-start-input.jsonl` 削除・検証用定義 2 本削除）に入る。

# phyllis998

> 手動で dispatch してよい

## セッション 3: setup-agents のAgent ツール付与バグ根本原因を特定

# AI

承認確認。nag の文面と同じ入力で dispatch する。

蒸留前スナップショット取得（抗体 54 件、`.raphael/` の git 変更 22 件）。synthesizer の完走を待つ。

synthesizer の完走待ち。

synthesizer 完走待ち。

synthesizer 完走。4 件処理（新規抗体 `ab-2026-0828-001` 作成、3 件非採用）、CLI 経由、再委譲・スキルロードなし。**項目 3 は両サンプルとも合格。**

後片付けに入る前に差分と収集データを確定。

差分は想定どおり（抗体 2 件が統計更新、新規 1 件追加。既存の未コミット変更は無傷）。

**`fable-adviser` と `raphael:antibody-synthesizer` もフック入力に記録されており、nested spawn での SubagentStart 発火が実機で再確認できた。**

後片付けに入る。

> **確認:** 次のファイルを削除します。いずれもこの検証セッションで作成した一時ファイルです。
> - `.claude/agents/verify-external-reader.md`（検証用に作成した外部 Agent 定義）
> - `.claude/agents/verify-external-reader-haiku.md`（同上、`model: haiku` 版）
> - `/tmp/subagent-start-input.jsonl`（収集済み。全 10 レコードの `agent_type` は上記で確定済み）
> - `/tmp/raphael-before.txt` / `/tmp/raphael-after.txt`（比較用スナップショット）
>
> リポジトリの既存ファイルは 1 つも対象に含みません。

後片付け完了。`git status` の残骸ゼロ、`settings.local.json` は JSON 妥当。

---

# Task 8 実装後検証 完了報告

## 検証項目 1〜6 の実測結果

### 1. SubagentStart の発火と注入の到達 — **合格**

`gpt-sol-lead-implementer` に注入到達。内容は「あなたはサブエージェントである」宣言 + 対応表 10 行 + 規律 5 項目、**748 字**。対応表は SessionStart がこのセッションへ注入したものと**全 10 行一致**。

### 2. `agent_type` の実表記 — **4 種別すべて確定。設計 §8.6 の残項目は閉じた**

| 種別 | 実表記 | 照合結果 | 注入 |
|---|---|---|---|
| project 定義 | `gpt-sol-lead-implementer` | `exact:project` | あり |
| 同梱プリセット | `agent-policy:gpt-terra` | `exact:bundled` | あり |
| **他プラグイン定義** | `chat-history:chat-recorder` / `raphael:antibody-synthesizer` | `unknown:none` | あり |
| **ビルトイン** | `Explore` | `exact:builtin` | なし（deny） |

- project 定義・ビルトインは**末段のみ**。設計 §8.6 の実測と整合
- 同梱プリセットは**名前空間付き完全形**で来るが、`exactMatches` の `agent-policy:${name}` 分岐が拾う
- 他プラグイン定義も**名前空間付き完全形**。完全形で当たらず、末段（`chat-recorder` / `antibody-synthesizer`）も project / bundled に存在しないため `unknown` へ落ち、設計どおり注入側へ倒れた

**ビルトインの実表記は `Explore` そのもので、`exactMatches` の deny 判定と一致。実装の追随は不要。** よって lint / typecheck / test / build の再実行も発生していない。

deny-list の実挙動（バンドル出力へ直接 stdin を与えた debug 出力）:

```
Explore                      → deny=builtin:Explore
agent-policy:gpt-luna        → deny=bundled:gpt-luna:without-Agent
verify-external-reader       → deny=project:verify-external-reader:without-Agent
chat-history:chat-recorder   → match=unknown:none deny=no  (注入)
raphael:antibody-synthesizer → match=unknown:none deny=no  (注入)
```

### 3. 機械契約 Agent への注入副作用 — **2 種とも合格。副作用なし**

**chat-recorder**（Stop hook 経由の自動記録、2 回）: `docs/chat/2026/0828/phyllis998/0117-agent-policy-subagent-start-verification.md` へ正常追記（session 1 で +29 行、session 2 で +287 行）。再委譲なし、方針スキルのロードなし、報告は記録結果 1 行のみ。

**raphael:antibody-synthesizer**: Stop hook の促しは `distillThreshold: 3` 未満で発火しなかったため、承認を得て手動 dispatch。未蒸留 4 件を処理し、新規抗体 `ab-2026-0828-001` 作成 + 3 件非採用。management CLI 経由で完走。再委譲なし（そもそも tools に `Agent` が無い）、方針スキルのロードなし。

**設計 §5 の「過剰配布側に倒す」判断は、実機で機械契約を壊さないことが確認できた。**

### 4. 合成 dispatch — **2 ケースとも成立**

ホストは「コードベース探索実働」帯の `grok-researcher`。判定フロー評価は行 1〜6 すべて非該当（原本は特定可、frontmatter は `name`/`description`/`tools`(+`model`) のみ、帯適合、対応表に定義あり、外部固有 MCP なし、義務条項の衝突なし）。

| ケース | 外部定義の `model` | 確定行 | 結果 |
|---|---|---|---|
| A | 未宣言 | **判定フロー 7**（合成、モデルはホスト frontmatter） | 散文のみ・箇条書き 0・見出し 0 → 外部本文の禁止条項を遵守 |
| B | `haiku`（enum） | **判定フロー 8**（合成 + `model` param で宣言値適用） | 自己申告 `claude-haiku-4-5-20251001`。禁止条項も遵守 |

ケース B は、proxy alias を frontmatter に持つホストへの enum 上書きが Claude 実行になること（設計 §8 項目 2）の実機再確認にもなっている。両ケースともホストは差し戻さずに作業した。

### 5. アドバイザー再委譲 — **合格**

`gpt-sol-lead-implementer` へ判断作業を委譲し「判断に迷ったらアドバイザーへ相談せよ」を含めたところ、**相談先に `fable-adviser` が選ばれた**（`Fable` の直指定ではなく、注入された対応表の定義名）。フック入力 `/tmp/subagent-start-input.jsonl` にも `fable-adviser` が記録されており、**nested spawn でも SubagentStart が発火する**（設計 §8 項目 4）ことが実機で再確認できた。

### 6. 移行期の運用条件 — **確認済み**

**本実装で緩和されるのは「子 Agent が親と同じ custom role map を使う前提を置かない」の 1 点のみである。** 残りは監査所見 1・2 および 4〜11 の修正まで継続する:

- Workflow 専用 Agent は marker を宣言せず Workflow から直接 dispatch する
- 担当表へ参加させる custom Agent はトップ階層 `.claude/agents/*.md` に置く
- custom Agent は active policy で必要な role marker を明示する
- `setup-agents --write --merge` は `claude mcp list` の正常動作確認後にだけ実行する
- Agent 名を他 scope や他 plugin と重複させない

**起動プロンプトの残存条件の列挙は 1 つ漏れていた** — 1 番目の「Workflow 専用 Agent は marker を宣言せず Workflow から直接 dispatch」がプロンプト本文の括弧内に含まれていない。引き継ぎ書の原文では 6 条件あり、緩和 1・継続 5 が正しい。

---

## 副産物: 「847 字」の正体

実装セッションの記録にある「chat-recorder → 847 字」と、今回の実機 748 字は**矛盾していない**。

- `additionalContext` の中身 = **748 字**
- hook stdout の JSON シリアライズ後全体 = **847 字**

今回 project 定義・同梱・未知 type のすべてで `fragment-size=348 / table-size=422 / context-size=748` と同一値だった。

`★ Insight ─────────────────────────────────────`
- この差が意味を持つのは切り詰めの契約面。`truncateContext` は `additionalContext` の `String.length`（748）で判定するが、もし 10,000 上限が raw stdout（847）側の制約なら、JSON エスケープによる膨張分は保証の外に出る。今回は実測 847 ≪ 9500 なので問題化しない。
- deny-list が「Agent tool の有無」を基準にしているのは、対応表の存在意義が**再委譲先の解決**だから。再委譲しない Agent に配るのは純粋なトークン浪費になる。ただしこの判定は project / 同梱だけが走査対象で、他プラグイン定義は tools を読めないため一律注入側へ倒れる — これが chat-recorder / raphael に届いた理由。
`─────────────────────────────────────────────────`

---

## 残課題と扱いの提案

**1. 規律と実定義の食い違い（本改修のスコープ外）**

`grok-researcher` / `grok-docs-reviewer` / `sonnet-code-reviewer` は frontmatter に `Agent` を持たず deny される。共通規律は「『軽量な実装』と『設計・計画・実装のアドバイザー』の帯以外のサブエージェントに Agent Tool を許可する」としており、この 3 帯には本来 `Agent` があるはず（`haiku-reviewer` / `gpt-luna-light-implementer` / `fable-adviser` に無いのは方針どおりで正しい）。

deny 自体は設計に照らして正しい挙動（再委譲しない定義に対応表は不要、迷いは差し戻しで解決）。**提案: setup-agents の tools 構成の課題として別途起票する。本改修の実装は変えない。**

**2. `additionalContext` 上限の意味論が未確定**

10,000 が parsed 値の上限か raw JSON stdout の上限かがリポジトリ内で確定していない。後者なら `String.length` 基準の切り詰めは形式的な保証にならない。**提案: 現状維持（9,500）。実測 847 で余裕が大きく、変更の便益がない。確定が必要になった時点で調べる。**

**3. 移行期の運用条件の残存 5 項目** — 監査所見 1・2 および 4〜11 の別課題として継続。

**4. 実装帯サブエージェントの実行コスト** — 項目 5 の dispatch は 39 tool_uses / 385 秒 / 約 87k tokens を要した。判断作業の委譲としては重い。**提案: 対応表の advisor 解決自体は正しく機能しているので機構の問題ではない。依頼文で調査範囲を絞る運用側の話として扱う。**

---

## 作業ツリーの状態

セッション開始時からの増分は次のとおりで、**検証用の残骸はゼロ**:

- `.raphael/antibodies/ab-2026-0802-006.md` / `ab-2026-0808-002.md` / `ab-2026-0816-005.md` — 抗体注入・蒸留による統計更新
- `.raphael/antibodies/ab-2026-0828-001.md` — 蒸留で新規作成（未追跡）
- `docs/chat/2026/0828/` — 本セッションの会話記録（未追跡）

削除済み: デバッグフック（`settings.local.json` の `hooks` ブロック）、`/tmp/subagent-start-input.jsonl`、検証用外部 Agent 定義 2 本、比較用スナップショット 2 本。既存の未コミット変更は 1 つも触っていない。

**実装（`plugins/agent-policy/src/`）は 1 行も変更していない。** 追随が必要な不一致が出なかったため、`pnpm run build` も走らせていない。

# phyllis998

> setup-agentsでAgentツールが付与されない問題について、調査・修正お願いします

# AI

setup-agents の tools 付与を調査する。バグ修正なので手順スキルを先に通す。

Phase 1: 根本原因調査。まず現象の確認と実装の所在特定。

現象を確定。role マーカー別の `Agent` 付与状況:

| role | 帯 | Agent | 期待 |
|---|---|---|---|
| complex-impl | 複雑または重要な実装 | あり | ✓ |
| normal-impl, general | 通常の実装 / その他 | あり | ✓ |
| light-impl | 軽量な実装 | なし | ✓（規律どおり） |
| doc-review | 設計書レビュー | なし | ✓（Haiku は軽量帯扱い） |
| advisor | アドバイザー | なし | ✓（規律どおり） |
| **explore** | コードベース探索実働 | **なし** | ✗ |
| **realtime-research** | リアルタイム情報調査 | **なし** | ✗ |
| **independent-review** | 独立レビュー | **なし** | ✗ |
| **code-review** | コードレビュー | **なし** | ✗ |

4 つの role で不足。tools の組み立て箇所を追う。

**根本原因を特定。** `plugins/agent-policy/src/agents/roles.ts:87-92`:

```ts
// Agent tool を許可する実装役割。orchestration-discipline の
// 「軽量な実装の帯に Agent Tool を許可しない」に従い light-impl を除く。
const AGENT_CAPABLE: readonly RoleId[] = ["complex-impl", "normal-impl", "general"]
```

実装は「**`kind: "impl"` の 4 役割から `light-impl` を除いた集合**」として書かれている。しかし規律の集合は「**全 10 帯から `light-impl` と `advisor` を除いた 8 帯**」。`readonly` 系 6 役割が丸ごと落ちている。コメントの「実装役割」という語に、`impl` 限定という誤った前提が固定されている。

ただし帯ごとの可否は policy 依存の可能性がある（設計 §5 に「軽量帯への Agent tool 可否は profile 依存 — with-grok-policy では軽量帯 = Grok に許可される」との注記）。修正範囲を確定するため規定を突き合わせる。

規定の全体像が揃った。**Agent tool の可否は role 単体では決まらない。**

| policy | 追加規定 | 実効的な禁止 |
|---|---|---|
| claude-model-policy | 「`Haiku` には許可しない」 | doc-review, light-impl(=Haiku), advisor |
| with-codex-policy | 「`GPT Luna` と `Haiku` に許可しない」 | light-impl, doc-review, advisor |
| with-grok-policy | 「軽量帯の規定は `Grok` に適用しない」+「`Haiku` に許可しない」 | doc-review, advisor のみ（**light-impl は許可**） |
| codex-grok-policy | 「`GPT Luna` と `Haiku` に許可しない」 | light-impl, doc-review, advisor |

`allowsAgentTool` の呼び出し文脈に policy/model が渡っているかを確認する。

`ComposeInput` に policy / ModelId が無い（`model` は alias 解決後の文字列）。ただし 4 policy の規定を突き合わせると、**判定は policy を知らなくても `ModelId` と `RoleId` だけで表現できる**:

```
Agent 不可 ⟺ model ∈ {haiku, gpt-luna}  または  role が advisor のみ
```

- claude-model: light-impl=haiku ✗ / doc-review=haiku ✗ / 他 sonnet・opus ✓
- with-codex・codex-grok: light-impl=gpt-luna ✗ / doc-review=haiku ✗ / 他 ✓
- with-grok: light-impl=**grok ✓**（規定どおり例外が再現される）/ doc-review=haiku ✗

呼び出し側が `ModelId` を持っているかを確認する。

`Target` は `modelId: spec.id` を持つが、`composeInputFor` がそれを `ComposeInput` へ渡していない（`setup-agents.ts:270-286`）。修正の足場は既にある。

設計時の判断を確認する。

Phase 1 完了。**根本原因が 3 層で確定した。**

**層 1（直接）** — `plugins/agent-policy/src/agents/roles.ts:87-92`。`AGENT_CAPABLE` が impl 系 3 役割のみで、readonly 系 6 役割が構造的に落ちる。

**層 2（設計）** — バグではなく**設計どおり**。`harness-docs/design/2026-08-24-agent-policy-role-based-setup-design.md:113`:

> `Agent` は、選ばれた役割に `complex-impl` / `normal-impl` / `general` のいずれかが含まれるときだけ付与する。

**層 3（設計時の推論の誤り）** — §5.2 の根拠は「`light-impl` を含んでいても重い実装役割を併せ持つなら付与してよい。『不可が 1 つでもあれば不可』にすると `complex-impl` + `explore` で `gpt-sol` を再現できなくなる」。この推論は *「light-impl を含む定義にどう付けるか」* だけを解き、*「readonly 単独の定義に要るか」* を検討していない。共通規律は**除外リスト**（「軽量な実装とアドバイザーの帯**以外**に許可」）だが、設計はこれを**許可リスト**へ反転させる際に集合を取り違えた。

**なぜ露見しなかったか** — 設計書 §8.1 自身が「`grok` プリセットは `normal-impl` を含むため §5.2 により `Agent` が付き、この例外を満たす」と書いている。同梱プリセットは役割の和集合を持つため偶然 impl 役割を含み、穴が塞がって見えていた。project 定義で role を絞った瞬間に露出する。

修正案の妥当性を詰めるため既存テストを確認する。

既存テストが誤った規則を固定している（`roles.test.ts:96` が `allowsAgentTool(["explore","independent-review"]) === false` を期待、`compose.test.ts:102` が `explore` 単独に Agent 無しを期待）。テストを先に直す対象。

Phase 2・3 まで完了。修正が 5 ファイル + テスト + 設計書訂正に及ぶため、計画の承認を取る。

計画に必要な残りの契約を確認する。

循環参照の実態を確認した。`policies.ts` は `roles.ts` を**値として** import しているため、判定をモデル依存にするなら `allowsAgentTool` を `policies.ts` 側へ移すのが自然（依存方向 policies → roles を保てる）。`policy-skill-assignments.test.ts` は担当表のみ検査しており、Agent tool の可否は未検査。

計画確定の前に 2 点確認する。

設計書は旧文書へ訂正追記、`.claude/agents/` の再生成も実施。計画を書く。

計画を書いた。規約に従い、提示前にレビューを 2 系列通す。

レビュー待機中に自分でも影響範囲を裏取りする。

本文への影響を 1 つ見落としていた。`compose.ts:77-85` は `withAgent` で **frontmatter だけでなく本文も分岐**する。

```ts
if (withAgent) { body.push(vocabulary.advisorHeading, ...) }   // ## アドバイザーへの相談
const constraints = [...(withAgent ? common.get(vocabulary.agentConstraintHeading) ?? [] : []), ...]  // ## Agent tool の制約
```

読み取り帯 3 定義には、この 2 節が新たに入る。内容を確認する。

2 節の内容は読み取り帯にも整合する（「`Agent` tool はアドバイザー相談専用。作業委譲目的では使用しない」）。`modelId` 必須化の影響範囲を数える。

`build()` ヘルパーが `overrides` を受けるため、`modelId` の既定値を 1 箇所足せば大半のテストは通る。判明した追加事項を計画へ反映する。

節番号を整合させる。

計画を更新した。レビュー 2 系列の結果を待っている状態。

現時点の計画の骨子:

**判定規則の置き換え** — `withAgent = (advisor 以外の役割を 1 つ以上持つ) && (modelId ∉ {haiku, gpt-luna})`。4 policy の規定を policy 引数なしで再現でき、with-grok-policy の「軽量帯の規定を Grok に適用しない」例外も追加分岐なく満たされる。

**判定の移設** — `allowsAgentTool` を `roles.ts` から `policies.ts` へ。`policies.ts` が `roles.ts` を値 import しているため、逆向きに `ModelId` を持ち込むと循環になる。

**`modelId` の受け渡し** — `Target` は既に `modelId: spec.id` を持つが `composeInputFor` が渡していない。この経路を繋ぐ。

**副次的変更** — `Agent` が付く 3 定義には本文に `## アドバイザーへの相談` と `## Agent tool の制約` の 2 節が入る。tools だけの変更ではない。

レビューが返り次第、指摘を反映して計画を確定する。

計画モード中はファイル書き込みを伴う起動を控える（会話記録は計画の承認後に走らせる）。レビュー 2 系列の結果を待っている。

Haiku レビューが返った。1 点、事実確認が要る指摘がある。Haiku は同梱プリセットの役割集合を `gpt-sol = [complex-impl, normal-impl, general, code-review, advisor]` と報告しているが、`ASSIGNMENTS` では `code-review` は全 policy で `sonnet`、`advisor` は `fable`/`opus` であり、`gpt-sol` には解決されないはず。実データで確定する。

実データで確定した。**Haiku の役割集合の報告は誤り**（`code-review` / `advisor` / `doc-review` を余分に含めていた）。実際は設計書 §8.1 の表どおり:

```
gpt-sol   [complex-impl]                                             → Agent あり
gpt-terra [normal-impl, general, explore, realtime-research, indep]  → Agent あり
gpt-luna  [light-impl]                                               → Agent なし
grok      [normal-impl, light-impl, general, explore, realtime, indep] → Agent あり
```

新規則を当てても 4 つとも**不変**（結論は Haiku と一致、根拠が異なる）。採用する指摘を計画へ反映する。

Haiku の指摘のうち、テスト設計に関する 3 点（ヘルパー既定値・40 組テストの実装形・プリセット役割集合の実データ）を計画へ反映した。`allowsAgentTool` の置き場所については Haiku が代替案（`roles.ts` 残留 / 新モジュール）を挙げているため、Grok の独立レビューと突き合わせてから決める。

Grok レビューの結果を待っている。

Grok の独立レビューが計画の穴を複数突いている。採否判断の前に、実害の大きい 2 点を自分で検証する。

Grok の指摘が 3 点とも実データで裏付けられた。

- `automaticKeep`（`setup-agents.ts:499-514`）は `mcp__*` と `disallowedTools` を**意図的に除外**する（コメント: 「切断済みサーバーのツール名が生き残り続ける」）。`--write --merge` で MCP を渡さないと Serena と denylist が落ちる
- `compose.test.ts:353` は `tools` を `"Read, Grep, Glob"` と**完全一致比較**。計画の修正リストに無い
- `presets.test.ts:88,107,120` に直接 `compose({...})` が 3 箇所。同上

計画の前提が 3 点崩れた。判断が要る分岐を確認する。

3 点とも確定した。判定規則を修正する:

```
Agent 不可 ⟺ modelId ∈ {haiku, gpt-luna}
          または  light-impl / advisor 以外の役割を 1 つも持たない
```

`light-impl` 単独・`advisor` 単独・その 2 つだけの組は不可。`light-impl` + `complex-impl` は可（設計 §5.2 の元の意図）。共通規律の除外リストを §5.2 の「複数役割を兼ねる定義は帯そのものではない」で補正した形になり、規律の文言に最も忠実になる。

計画を全面改訂する。

両レビューの採否を整理した。

**Grok（独立レビュー）から採用した指摘 — 計画の前提が崩れたもの**

1. テスト修正リストが不完全。`presets.test.ts:88,107,120` と `compose.test.ts` の直接 `compose()` 10 箇所、特に `353` 行の `tools` 完全一致比較と `169-171` 行が抜けていた → 全て追加
2. `setup-agents.test.ts:807/833/853-854` は新規則でも**真偽が変わらない**。「新規則に合わせる」は誤り → 訂正し、実際に値が変わる `--check` 経路（sonnet×code-review、grok×explore のみ、with-grok×light-impl のみ）を新規テストに
3. `light-impl` 単独 Grok の本文矛盾 → 判定規則そのものを変更
4. `--write --merge` は `mcp__*` と `disallowedTools` を落とす → ウィザード経由へ変更
5. 設計書の旧規則は §5.2 だけでなく §8.1・§13.1 にもある → 追随対象に追加
6. 移設理由の「循環するから」は成立しない（type-only import は循環しない）→ 理由を「モデル方針データの集約」に訂正
7. 40 組は単一役割のみで、CLI が実際に合成する混成を覆わない → `rolesFor` の実混成テストを追加
8. `subagent-start.test.ts` が同梱定義から Agent 無しを動的に 1 件探しており、その役は現行 `gpt-luna` → 壊してはならない前提として明記

**Haiku から採用** — テストヘルパーの既定 `modelId`（`gpt-terra`）、40 組テストの実装形。

**Haiku の報告のうち訂正したもの** — 同梱プリセットの役割集合。`gpt-sol = [complex-impl, normal-impl, general, code-review, advisor]` と報告されたが、実データは `[complex-impl]` のみ。結論（4 つとも不変）は変わらない。

`★ Insight ─────────────────────────────────────`
今回の修正は「許可リストを除外リストへ戻す」ものだが、単純に反転させると副作用が 2 つ出る。`light-impl` 単独の Grok が本文と矛盾する定義になること、プロジェクト独自役割が「付かない」から「付く」へ反転すること。前者は §5.2 の「複数役割を兼ねる定義は帯そのものではない」の対偶を明示的に規則へ組み込んで塞ぎ、後者は除外リスト方式の必然として受け入れる — という形で、規律の文言に忠実な側へ寄せた。
`─────────────────────────────────────────────────`

計画承認。実装に入る。まず着手時の baseline と、編集の委譲条件を確認する。

計画承認。`tools/delegation_gate.py` の deny 対象は `plugins/*/src/**` と `plugins/*/skills/**` を含むため、実装は委譲する。設計書（`harness-docs/`）とバージョン・ビルドは gate 対象外なので自分で行う。

baseline を取りつつ、実装 2 件を並列で委譲する。

実装の委譲中に、gate 対象外の設計書訂正を進める。§13.1 の該当記述を確認する。

`★ Insight ─────────────────────────────────────`
設計書の旧規則は 3 箇所に分散していた（§5.2 の規則本体、§8.1 の「grok は normal-impl を含むから付く」という根拠、§13.1 のテスト契約）。独立レビューがなければ §5.2 だけ直して内部矛盾を残していた。仕様を書き換えるときは「その仕様に依存した記述」を全文検索する必要がある — 規則そのものより、規則を引用した箇所のほうが見つけにくい。
`─────────────────────────────────────────────────`

設計書に訂正を入れる。元の記述は履歴として残し、訂正を追記する形にする。

`with-grok-policy` の文面明確化が完了（例外は両帯を担う定義に限ると明記された）。設計書 §13.1 のテスト契約も訂正する。

設計書 3 箇所の訂正が完了。テスト baseline を確認する。

バージョンを上げる。

自分の担当分（設計書 3 箇所の訂正、`with-grok-policy` 文面の明確化、バージョン 0.13.1-dev）が完了。実装の委譲とテスト baseline の完了を待っている。

実装完了。報告を検証する。

実装は計画どおり。`allowsAgentTool` が `policies.ts` にあり、`roles.ts` から除去されている。ビルドして生成物の差分を確認する。

全体ビルドが 10 分でタイムアウト。agent-policy だけをビルドする。

単体ビルドもタイムアウト。gpt-sol の報告にあった「WSL2 の `wslpath` hang」を踏んでいる可能性がある。pnpm を経由せず直接実行する。

esbuild + `buildPresets` のみの単純な構成。どこで hang するか切り分ける。

node も esbuild も正常。`tsx` の起動が疑わしい。esbuild 部分を node で直接実行して切り分ける。

`tsx` の起動が hang していた（esbuild 自体は即座に完了）。環境要因で本改修とは無関係。バックグラウンドの残骸を止めてから `buildPresets` を実行する。

生成物の差分は `scripts/session-start.mjs` と `setup-agents.mjs` のみ。**`agents/*.md` は 4 つとも差分ゼロ** — 計画の想定どおり。`subagent-start.mjs` も `allowsAgentTool` を使わないため不変。

自分でも品質ゲートを走らせる。

`pnpm run build` の hang 原因が確定した — `pnpm -r build` が各プラグインで `tsx build.ts` を起動するため、tsx の hang を全ワークスペース分踏む。lint / typecheck / test は tsx を経由しないので直接叩く。

typecheck も 300 秒でタイムアウト。gpt-sol が使った PATH shim の仮説を確認する。

`/mnt/c` は PATH に 0 個。Windows パス仮説は外れ。tsc は hang ではなく単に遅い可能性が高いので background へ回し、その間に生成物の実挙動を確認する。

`--check` で 6 定義の `agentTool` を実測する。

変化すべき 3 定義が `agentTool: True` になった。不変であるべき 3 定義も確認する。

`with-grok × grok × light-impl 単独` も `False`。ユーザー決定どおりに動いている。全 7 パターンが期待値と一致。

品質ゲートの結果と README の要否を確認する。

README に Agent tool の付与規則は無い（140 行は **MCP** の付与単位の話で別ロジック）。混同がないか確認する。

実装と検証がほぼ完了した。現状を報告する。

## 完了したもの

**実装**（委譲、11 ファイル / +212 −54）— `allowsAgentTool` を `policies.ts` へ移し、`(RoleId[], ModelId)` の 2 引数化。`roles.ts` から `AGENT_CAPABLE` を除去。`ComposeInput.modelId` を必須にして `Target.modelId` から通した。参照は `compose.ts` の 2 箇所のみで、`mcp.ts` は `kind` を一切使わない別ロジックなので影響なし。

**生成物** — `agents/*.md` は**4 プリセットとも差分ゼロ**（計画の想定どおり）。更新されたのは `scripts/session-start.mjs` と `setup-agents.mjs` の 2 つ。`subagent-start.mjs` は `allowsAgentTool` を使わないため不変。

**`--check` による実挙動の実測** — 7 パターンすべて期待値と一致:

| 定義 | roles | model | agentTool |
|---|---|---|---|
| grok-researcher | explore, realtime-research | grok | **True**（修正） |
| grok-docs-reviewer | independent-review | grok | **True**（修正） |
| sonnet-code-reviewer | code-review | sonnet | **True**（修正） |
| haiku-reviewer | doc-review | haiku | False（不変） |
| gpt-luna-light-implementer | light-impl | gpt-luna | False（不変） |
| fable-adviser | advisor | fable | False（不変） |
| （with-grok の検証用） | light-impl | grok | **False**（決定どおり） |

**文書** — 設計書 §5.2・§8.1・§13.1 に訂正を追記、`with-grok-policy/SKILL.md` の文面を明確化、バージョンを 0.13.1-dev へ。README は Agent tool の付与規則を記述していないため変更不要。

## 判明した環境の問題（本改修とは無関係）

`pnpm run build`（= `pnpm -r build` → 各プラグインで `tsx build.ts`）が **tsx の起動で hang** する。esbuild 自体は数秒で完了し、`/mnt/c` は PATH に 1 つもないので Windows パス経由の遅延でもない。今回は esbuild を node から直接呼んでバンドルし、`buildPresets` も同様に実行した。生成結果は正しい。

`tsc --noEmit` も 400 秒でタイムアウトするため background で継続中。

## 残り

- `typecheck` / `lint` / `test` の自己検証（走行中。委譲先は agent-policy 290 件・全体 1930 件の通過を報告済み）
- `.claude/agents/` の再生成 — ウィザード経由と決めたため、`claude mcp list` の正常確認後に**あなたの手で** `/agent-policy:setup-agents` を実行してもらう必要がある。CLI で `--write --merge` を直に叩くと `automaticKeep` が `mcp__serena` と `disallowedTools` を落とす

蒸留を委譲した。`tsc` は継続中。完了を待っている。

蒸留完了（4 件とも非採用、抗体作成 0 件、作業ツリーへの追加なし）。typecheck の進捗を確認する。

tsc プロセスが **4 つ並走**していた。timeout で kill したはずの残骸が競合して全体を遅くしている。整理して 1 本だけ走らせる。

`sleep` は foreground で禁止されていた。プロセス状態だけ確認する。

tsc は一掃できた。baseline の vitest が 2 プロセス残っているので止め、クリーンな状態で順に走らせる。

`pkill -f vitest` が自身のシェルにマッチして自殺していた。pkill を使わず状態だけ見る。

プロセスが一掃された。単独で typecheck を走らせる。

単独でもタイムアウト。競合ではなく tsc 自体が遅い（WSL2 + 巨大 node_modules）。background へ回し、Rust 製で高速な biome を先に実行する。

biome も 180 秒でタイムアウト（gpt-sol は「370 files checked」と報告しており本来は数秒）。background の tsc と競合している。tsc を止めて biome を単独で走らせる。

biome も単独で 4 分超。370 ファイルなら数秒のはずで、システム側を疑う。

**load average 0.06 — システムは完全にアイドル。** CPU も I/O も使っていないのに 4 分終わらない = プロセスが何かを待ってブロックしている。`node_modules/.bin/` 経由の実行が疑わしい（tsx・tsc・biome すべて `.bin` 経由で、node から直接 import した esbuild だけが動いた）。

**原因が確定した。** pnpm が生成する `node_modules/.bin/` のシムスクリプトが hang する（`biome --version` すら 15 秒でタイムアウト）。一方、実体を node で直接叩くと即座に応答する。gpt-sol が報告していた「WSL2 の PATH shim 回避」と同じ現象。

実体を直接叩いて品質ゲートを走らせる。

**typecheck 通過（exit 0）。** 実体を直接叩くと即座に完了した。biome と vitest も同様に実行する。

**lint 通過（exit 0）。370 ファイルを 247ms で検査。** infos 4 件は metatron の既存分で error 0。テストも実行する。

**3 つの品質ゲートすべて通過。**

- typecheck: exit 0
- lint: exit 0（370 files / 247ms、error 0、infos 4 は metatron の既存分）
- test: exit 0（**152 files passed / 1930 tests passed**、65 秒）

既知のフレーキー 4 件も落ちていない。最終状態を確認する。

本改修は 17 ファイル / +414 −236。既存の未コミット変更（`.raphael/` の抗体、`docs/chat/`）は無傷。

---

# 完了報告

## 根本原因（3 層）

1. **直接** — `roles.ts:87-92` の `AGENT_CAPABLE` が `["complex-impl","normal-impl","general"]` の 3 つのみ。readonly 系 6 役割が構造的に落ちる
2. **設計** — バグではなく設計どおり。設計書 §5.2 が「`complex-impl` / `normal-impl` / `general` のいずれかが含まれるときだけ付与する」と明記していた
3. **推論の誤り** — 共通規律は「軽量な実装とアドバイザーの帯**以外**に許可」という**除外リスト**。設計はこれを**許可リスト**へ反転させる際に集合を取り違えた。§5.2 は「light-impl を含む定義にどう付けるか」だけを解き、「readonly 単独の定義に要るか」を検討していない

**露見しなかった理由** — 同梱プリセットは役割の和集合を持つため偶然 impl 役割を含む。設計書 §8.1 自身が「`grok` は `normal-impl` を含むから付く」と書いており、穴が塞がって見えていた。project 定義で role を絞った瞬間に露出する。

## 修正

判定規則を除外リストへ戻した:

```
Agent 不可 ⟺ modelId ∈ {haiku, gpt-luna}
          または  light-impl / advisor 以外の役割を 1 つも持たない
```

`allowsAgentTool` を `policies.ts` へ移し `(RoleId[], ModelId)` の 2 引数化。`ComposeInput.modelId` を必須にし、既に存在していた `Target.modelId` から経路を繋いだ。

## 検証（すべて実測）

| ゲート | 結果 |
|---|---|
| typecheck | exit 0 |
| lint | exit 0（370 files / 247ms、error 0） |
| test | exit 0（**152 files / 1930 tests passed**） |
| build | `agents/*.md` 4 プリセットとも**差分ゼロ**（想定どおり） |

`--check` による実挙動 7 パターンが全て期待値と一致。`grok-researcher` / `grok-docs-reviewer` / `sonnet-code-reviewer` が `True` へ、`haiku-reviewer` / `gpt-luna-light-implementer` / `fable-adviser` と `with-grok × light-impl 単独` は `False` のまま。

**文書** — 設計書 §5.2・§8.1・§13.1 に訂正を追記（独立レビューがなければ §5.2 だけ直して内部矛盾を残していた）。`with-grok-policy/SKILL.md` の「可否を分けない」を両帯を担う定義に限る旨へ明確化。バージョン 0.13.1-dev。

## 副次的に判明した環境問題（本改修とは無関係）

**pnpm が生成する `node_modules/.bin/` のシムスクリプトが hang する。** `biome --version` すら 15 秒でタイムアウトする一方、実体を `node` で直接叩くと即座に応答する。load average 0.06 でシステムはアイドルだった — CPU も I/O も使わずブロックしていた。

これが `pnpm run build`（`pnpm -r build` → 各プラグインで `tsx build.ts`）の 10 分タイムアウトの正体でもある。回避策:

```
node node_modules/typescript/bin/tsc --noEmit          # typecheck
node node_modules/@biomejs/biome/bin/biome check .      # lint
node node_modules/vitest/vitest.mjs run                 # test
```

`★ Insight ─────────────────────────────────────`
この症状は「重い処理が遅い」と誤診しやすい。実際 tsc を 4 プロセス並走させて競合を疑うところまで回り道した。決め手は load average 0.06 — 4 分経っても CPU を全く使っていないなら、それは遅いのではなく**待っている**。計算量の問題と待機の問題は、負荷指標を見れば一発で切り分けられる。
`─────────────────────────────────────────────────`

## 残タスク

**`.claude/agents/` の再生成** — あなたの手で実行が必要です。`claude mcp list` の正常動作を確認してから `/agent-policy:setup-agents` をウィザードで実行してください。CLI で `--write --merge` を直に叩くと `automaticKeep` が `mcp__serena` と `disallowedTools` を意図的に除外するため、3 定義が持つ Serena と denylist が落ちます。

再生成で `Agent` が付くのは 3 定義。差分提示では tools だけでなく本文にも `## アドバイザーへの相談` と `## Agent tool の制約` の 2 節が現れます（意図した変更です）。

コミットは指示がないため行っていません。また、`.bin` シムの hang は繰り返し踏む落とし穴なので、GOTCHAS への記録を提案します（`metatron` の `append-gotcha`）。実施しますか。

# phyllis998

> コミットしてください
