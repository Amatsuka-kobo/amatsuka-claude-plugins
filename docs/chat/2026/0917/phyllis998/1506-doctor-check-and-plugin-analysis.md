# プロジェクト Doctor チェックと使用状況分析

- 日付: 2026-09-17
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `.claude/skills/session-handover/SKILL.md`、`.claude/skills/cliproxyapi-investigation/SKILL.md`、eval review HTML 2件
- 前提: プロジェクト拡張機能の使用状況監査、CLAUDE.md スキル化検討
- セッション ID: 7cfaddac-074e-45c2-ac03-2e0712c30b8a

---

## セッション 1: Doctor チェック実行と未使用拡張の検出

# AI

/model コマンド実行結果のみ。追加作業なし。

インストール調査・使用状況調査・hook/拒否コマンド調査を並列実行。加えて version/auto-mode/LOCAL ファイル存在確認を直接実施。

check2/3/7/8 完了。fork 3件(setup / usage-context / hooks-denial)実行中。

- check7: インストール済み 2.1.274、最新 2.1.274 → 最新
- check8: `~/.claude/settings.json` に `defaultMode: auto` 既設定、project/local 上書きなし → 健全
- check2: `~/.claude/CLAUDE.md` / `CLAUDE.local.md`(祖先含む) 全て不在 → 重複なし
- check3/4: リポジトリ内 checked-in 文書は root `CLAUDE.md` と `.claude/rules/metatron/` 3ファイルのみ。全て数百〜2000字程度で40,000字閾値に遠く及ばない。内容精査:
  - root `CLAUDE.md`: 「スクリプトツール」「git運用」は普遍的制約・安全規則で維持。「セッション引継ぎ」「モデル通信エラー時」の2節はタスク限定手順 → check4 のスキル化候補
  - `.claude/rules/metatron/` 3ファイル: 全て導出不能な運用知識(hook挙動・保護パス・完了条件)で「already lean」
  - 参考: `protected-paths.md` と `conventions.md` にプラグインのバージョン付与規則が重複記載(この doctor チェックの対象外だが一応記録)

fork 完了待ち。

fork 2件完了、check1+6(使用状況)待ち。

- check0: インストール正常、設定ファイル全パースOK、agent定義14件重複・破損なし、skill定義該当なし → 提案なし
  - 補足(要判断): GOTCHA-001 記載の5定義中 `document-writer` に `disallowedTools` が現状なし。他4件にはあり。書込み系ロールゆえ意図的可能性、壊れてはいない → 本体判断待ち、doctor提案外
- check5: フック実測2268件、timeout/error/cancelled 0件、閾値超過なし → 警告なし
- check9: 拒否記録3件のみ、全て `user-rejected` かつ AskUserQuestion/Agent(対象外) → 提案ルールなし

check1+6 待ち。

報告未提示のまま質問を送った。先に全体報告を出す。

## 概要

未使用の拡張機能・重複記載を発見。安全に削除可能: プラグイン2件(lifetime使用0件)。要確認: 1件(信号なし)。任意の軽微整理: CLAUDE.md 2節のスキル化。全て取り消し可能。

## 詳細表

スキャン窓: 直近50ファイル・全43プロジェクト横断、mtime 2026-09-17 14:29–15:11(JST)に集中 → 実質約42分。複数ツールで「14件」が不自然に揃う → 検証的セッション1回の可能性あり。**lifetime カウンタ(skillUsage/pluginUsage)を主判断材料とし、窓内シグナルは補助情報として弱め扱い**。

| Component | Type | Scope | Uses (total) | Used in window? | Est. resident tokens | Verdict |
|---|---|---|---|---|---|---|
| serena | MCP server | project (.mcp.json) | n/a(no counter); plugin 791 lifetime | Yes(300+回) | ~1.5k–3.8k(非deferred) | Keep — 探索基盤、conventions.md必須 |
| github | MCP server | project (.mcp.json) | n/a(no counter) | No(本セッションのツール一覧にも不在) | 不明(未接続疑い) | Keep — codiel reviewer系エージェント依存、誤削除リスク大。接続状態は `/mcp` で別途確認(本チェック範囲外) |
| context7 | plugin(context7-mcp skill)+MCP | project | skill 2 / plugin 48(lifetime) | Yes(14×2) | 小(resident 2ツール) | Keep — 少量だが実使用、低コスト |
| agent-policy | plugin, skills | project | custom-policy 16 / setup-agents 17 / claude-model-policy 10(lifetime) | Yes | ~560 | Keep — 現行3スキル体制で稼働中 |
| chat-history | plugin, 3 skills | project | chat 1(lifetime、他要確認) | Yes(1) | ~375 | Keep — セッション継続用途 |
| prompt-smith | plugin, 3 skills | project | prompt-smith 56 / skill-creator 15 / agent-creator 5(lifetime) | Yes | ~550 | Keep — conventions.md必須、高頻度 |
| raphael | plugin, 1 skill | project | raphael 3 / review 2(lifetime) | No | ~60 | Keep — 低頻度だが指定インシデント対応ツール |
| codiel | plugin, 17 skills+13 agents | project | skill直接ヒット0件、raguel MCP(evaluate_*)は窓内14回実行 | 部分的(MCP経由) | ~2.5k(最大単一寄与) | Keep(要注意) — スキル呼出は窓内ゼロだがMCP実行痕跡あり。窓が薄いため断定回避 |
| gh-utility | plugin, 3 skills | project | 0(skillUsage/pluginUsage共にlifetime) | No | ~450 | **Remove** — lifetime含め完全未使用 |
| metatron | plugin, 3 skills | project | init 4 / update 4 / updating-architecture 5 / recording-gotchas 2(lifetime) | Yes | ~725 | Keep — conventions.md必須、活発 |
| sandalphon | plugin, 3 skills | project | 0(pluginUsage lifetime) | No | ~725 | **Remove候補** — lifetime含め完全未使用。設計完了の記憶はあるが呼出実績なし |
| claude-security | plugin, 15 agents | project | plugin 545(lifetime) | 直近ヒット疑い | ~970(agent一覧最大級) | Keep — 実使用あり |
| explanatory-output-style | plugin, output style(受動) | project | plugin 539(lifetime、カウント方式に疑義あり※) | 信号なし相当 | ~0 | 要確認 — 受動系、既定は削除推奨 |
| security-guidance | plugin(受動) | project | plugin 15,707(lifetime) | 信号なし(受動) | ~0 | Keep — コスト0、lifetime極めて高くバックグラウンド稼働濃厚 |
| superpowers | plugin, 14 skills | project | brainstorming 49等、lifetime高水準 | Yes | ~600 | Keep — 最多使用スキル群 |
| genshijin | plugin, 7 skills+3 agents | project | plugin 1,842(lifetime) | Yes(本セッション稼働中) | ~95(過小評価疑い) | Keep — 本セッションの口調を直接駆動 |
| CLAUDE.md(root) | checked-in doc | project | n/a | n/a | ~397(1,587字) | Keep、2節はcheck4移行候補 |
| .claude/rules/metatron/*.md(3ファイル) | checked-in doc | project | n/a | n/a | ~1,900(7,598字) | Keep — 導出不能な運用知識、削減対象なし |

※explanatory-output-style: ルール上「output style単体プラグインは使用カウンタが増えない」はずだが539件記録あり。実際の切替回数ではなくセッション読込回数の可能性、信頼度低い。

## Check別提案

**Check 0(セットアップ健全性)** — 問題なし、提案なし。付記(範囲外・要ユーザー確認): agent-policyのプラグインキャッシュが現行スキル構成(custom-policy/setup-agents)と食い違う疑いあり / claude-securityのキャッシュに0.10.2.3と0.11.0が共存 / document-writerのfrontmatterに`disallowedTools`なし(GOTCHA-001記載の他4定義にはあり、破損ではない)。いずれも `/plugin` で確認推奨。

**Check 1(未使用拡張)**
- gh-utility プラグイン削除。`.claude/settings.local.json` に `"enabledPlugins": {"gh-utility@<marketplace>": false}` を追加(project側checked-inで有効化のためlocal側でfalse必須。正確なmarketplaceキーは適用直前に settings.json から確認)
- sandalphon プラグイン削除。同機構、`"enabledPlugins": {"sandalphon@<marketplace>": false}`
- explanatory-output-style: 使うか確認。使わないなら同機構で削除

**Check 2(LOCAL CLAUDE.md重複)** — 該当ファイル(`~/.claude/CLAUDE.md`、`CLAUDE.local.md`祖先含む)すべて不在。提案なし。

**Check 3(checked-in CLAUDE.md圧縮)** — root CLAUDE.md・metatron rules 3ファイルとも既に簡潔(最大でも7,598字、40,000字閾値に遠く及ばず)。導出可能な記述なし。提案なし。参考: `protected-paths.md` と `conventions.md` にプラグインバージョン規則が重複記載あり(check2/3範囲外、両ファイルとも編集はmetatron CLI経由必須のため本doctorでは対応不可)。

**Check 4(遅延ロード移行)** — root CLAUDE.mdの「セッションの引継ぎ」「モデルの通信エラーが起きた時」(+関連する「goalコマンド」定義)をスキル化候補として提示。該当~530字(~130トークン)。移行後は1行descriptionのみ常駐。**削減量小さい(~100トークン)、任意**。リポジトリ規約によりCLAUDE.md編集はprompt-smithプラグイン経由必須 — 選択時は直接Editでなくprompt-smithスキルを起動する。

**Check 7(バージョン)** — インストール済み2.1.274、latestチャンネル最新も2.1.274 → 最新。提案なし。

**Check 8(auto mode)** — `~/.claude/settings.json` に `defaultMode: auto` 既設定、project/local上書きなし → 健全。提案なし。

**Check 9(拒否コマンド事前承認)** — 窓内の拒否記録3件、全てuser-rejectedかつAskUserQuestion/Agent対象(読み取り専用Bash/MCP対象外)。提案なし。

→ Check 8・9とも提案なしのため、権限変更ゲートはスキップ。

## 警告(Check 5・6)

**Check 5** — 遅いフックなし。2,268イベント全成功、timeout/error/cancelled 0件。Stop系worst 1808msは単発外れ値(typical 28ms)、継続的遅延なし。

**Check 6** — 常駐コンテキスト概算: スキル一覧~5.9kトークン(200kウィンドウなら1%予算超過、settings.json記載の1M Opus想定なら余裕。本セッションはSonnet 5稼働のため200k想定が妥当)。エージェント一覧~3.9kトークン(codiel 13体・claude-security 15体が最大寄与)。CLAUDE.md+rules~2.3kトークン。MCP非deferred(serena/context7/codiel-raguel)概算1.5k–4kトークン。githubMCPは接続状態不明のため計上不可。正確な値は`/context`推奨。

---

個別に選ぶ、との回答。4グループから多肢選択で確認する。

CLAUDE.md スキル化のみ適用。プロジェクト規約(conventions.md)により CLAUDE.md 編集・SKILL.md 作成は prompt-smith プラグイン経由必須。直接 Edit/Write せず prompt-smith:skill-creator を起動する。

skill-creator 手順は面接+eval セット作成(20問)+ブラウザレビュー+改善ループまで含む重厚な工程。今回の対象は既書き内容2節(~100トークン節約)のアーカイブ的移行で、この重さと釣り合うか判断要る。

docs/cliproxyapi/ の既存記録を先に確認、手順の重複聞き取りを避ける。

2 SKILL.md 作成済み、eval レビュー用 HTML 2件 作成済み。ブラウザで開いて `Export Eval Set` を押す作業が要る。

- `/tmp/eval-review-session-handover.html`
- `/tmp/eval-review-cliproxyapi-investigation.html`

各20問(true 10/false 10)入り。中身を見て query 編集・削除・追加も可。押すと `~/Downloads/` に `eval_set_session-handover.json` / `eval_set_cliproxyapi-investigation.json` が落ちる。両方エクスポート完了したら教えて。回収して検証・保存し、改善ループ(`run-loop.mjs`)へ進む。

# phyllis998

> evalsに関してですが、この後skill-creatorの改修を行いもう少し短くするようにする予定です。
> 改修内容は @plugins/prompt-smith/docs/improvement-backlog.md にあります。
> これを元に今回のセッションで行うevalsとそれを用いた改善ループに適用してください。
> なお、改修自体はまた別のセッションでやります。

# AI

改修バックログ反映。cliproxyapi-investigation は主経路が曖昧(ユーザー明示依頼か、AI自身が症状を検知して自発着手か)。session-handover は CLAUDE.md記述からユーザー明示依頼が主経路と判断、据え置き。

B の true 問10問中5問を「AI提案への短い返答」形式へ差替。A(session-handover)はユーザー明示依頼が主経路のため据え置き。

11問(true側)になっている。line71 の重複気味な問を除いて10問に戻す。

10/10 確定。A(session-handover)は据え置き。両方ブラウザで開いて `Export Eval Set` を押してほしい。

- `/tmp/eval-review-session-handover.html`
- `/tmp/eval-review-cliproxyapi-investigation.html`(B は5問差替済み)

両方エクスポートしたら教えて。回収後は Sonnet 固定・cwd 隔離(中立tmpディレクトリから絶対パスで起動)で `run-loop.mjs` を回す。

(記録処理をバックグラウンドで起動。ユーザー向け作業はブラウザでの eval エクスポート待ち。)

## セッション 2: eval セット修正とエクスポート手順の実施

# AI

チャット記録完了(バックグラウンド)。応答文には反映しない扱いなので特に報告事項なし。eval エクスポート待ち継続。

(記録タスクの完了通知。既に処理済み。ユーザー入力ではないので応答不要、eval エクスポート待ち継続。)

# phyllis998

> 両方エクスポートしました

# AI

~/Downloads/ 自体が存在しない。エクスポート先どこ?ブラウザのダウンロード保存先設定を確認してほしい(推測で古いファイルは選ばない)。

(記録バックグラウンド起動。~/Downloads/ 保存先の回答待ち)

## セッション 3: evalセットのエクスポート保存先確認

# AI

(記録完了、応答不要。~/Downloads/ 保存先の回答待ち継続。)

(処理済み通知。応答不要、ユーザー回答待ち継続。)

# phyllis998

> WSLなのでWindowsのブラウザでは開くことが難しい&Orcaのアプリ内ブラウザではExportできなかったです。

# AI

eval セット保存済み。改善ループ起動する。バックログの回避策(中立tmpディレクトリから絶対パス起動、`--model claude-sonnet-5` 固定)を適用、2件バックグラウンド実行。

2件バックグラウンド実行中(最大5イテレーション×3回測定×20問、時間かかる)。完了で通知くる。

(記録バックグラウンド起動。改善ループ2件は実行中。)
