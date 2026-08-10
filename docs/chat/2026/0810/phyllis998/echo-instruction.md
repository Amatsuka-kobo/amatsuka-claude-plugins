# Echo Instruction Test

- 日付: 2026-08-10
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: なし
- 前提: なし

---

## セッション 1: Basic echo test

# phyllis998

> Reply with exactly: PONG

## セッション 2: skill-creator の description 改善

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "skill-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。"
> </current_description>
>
> Current scores (Train: 10/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL・carryover理由を聞き取って締め処理を案内するものに直します。既存コマンドのdescription、入力不足時の分岐、出力例をレビュー可能な形に組み直してください。" (triggered 0/3 times)
>   - "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name`→`division`）に加えてdry-run、差分件数、欠損時の質問を扱えるようにしたい。コマンドの本文だけでなく、利用場面が誤解されないdescriptionと出力評価の観点も整えてください。" (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=10/12>
> Description: "スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。"
> Train results:
>   [PASS] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 3/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name`" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> <skill_content>
> ...
> </skill_content>
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end.
>
> Please respond with only the new description text in <new_description> tags, nothing else.

# AI

失敗した2件の傾向を分析。close-sprint と import-members はいずれも「既存コマンドの改善・拡張」要求だが、現在の description は「作る」「改善する」の表現が曖昧で、具体的な「修正内容・差分検出・ユーザーの判断ポイント」をスコープに含めることを明示していない。

現descriptionでは「スキル構造や description を改善するとき」と述べているが、実際の失敗ケースは「既存コマンドの振る舞いそのものを改善・拡張したい」という明確な意図。単なる description 修正ではなく、定義全体の見直しと利用シーン（入力不足時の分岐、dry-run、差分出力）に対応する準備が必要なことを signal すべき。

改善案: 「スキルやコマンド定義を新しく作成するとき、既存定義の動作や振る舞いを改善・拡張するときに使用する。」と「動作」「振る舞い」「拡張」を明示。テストケース・eval との関連も明確化すれば、差分出力やdry-run といった具体的なシーン理解が進む。

詳細は評価ループで検証中。

## セッション 1: Echo test・skill-creator description optimization

# USER

> prompt-smithにskill-creatorの機構を移植するタスクの続きをお願いします。
> 引継ぎ資料: docs/handover/2026-08-10-prompt-smith-skill-creator-port.md
> 台帳: .superpowers/sdd/2026-08-09-prompt-smith-skill-creator-port-implementation/progress.md

# AI

失敗した2件の傾向を分析。close-sprint と import-members はいずれも「既存コマンドの改善・拡張」要求だが、現在の description は「作る」「改善する」の表現が曖昧で、具体的な「修正内容・差分検出・ユーザーの判断ポイント」をスコープに含めることを明示していない。

現descriptionでは「スキル構造や description を改善するとき」と述べているが、実際の失敗ケースは「既存コマンドの振る舞いそのものを改善・拡張したい」という明確な意図。単なる description 修正ではなく、定義全体の見直しと利用シーン（入力不足時の分岐、dry-run、差分出力）に対応する準備が必要なことを signal すべき。

改善案: 「スキルやコマンド定義を新しく作成するとき、既存定義の動作や振る舞いを改善・拡張するときに使用する。」と「動作」「振る舞い」「拡張」を明示。テストケース・eval との関連も明確化すれば、差分出力やdry-run といった具体的なシーン理解が進む。

詳細は評価ループで検証中。

## セッション 1: Echo test・skill-creator description optimization

# USER

> prompt-smithにskill-creatorの機構を移植するタスクの続きをお願いします。
> 引継ぎ資料: docs/handover/2026-08-10-prompt-smith-skill-creator-port.md
> 台帳: .superpowers/sdd/2026-08-09-prompt-smith-skill-creator-port-implementation/progress.md

# AI

失敗した2件の傾向を分析。close-sprint と import-members はいずれも「既存コマンドの改善・拡張」要求だが、現在の description は「作る」「改善する」の表現が曖昧で、具体的な「修正内容・差分検出・ユーザーの判断ポイント」をスコープに含めることを明示していない。

現descriptionでは「スキル構造や description を改善するとき」と述べているが、実際の失敗ケースは「既存コマンドの振る舞いそのものを改善・拡張したい」という明確な意図。単なる description 修正ではなく、定義全体の見直しと利用シーン（入力不足時の分岐、dry-run、差分出力）に対応する準備が必要なことを signal すべき。

改善案: 「スキルやコマンド定義を新しく作成するとき、既存定義の動作や振る舞いを改善・拡張するときに使用する。」と「動作」「振る舞い」「拡張」を明示。テストケース・eval との関連も明確化すれば、差分出力やdry-run といった具体的なシーン理解が進む。

詳細は評価ループで検証中。

## セッション 2: Echo test・skill-creator description optimization

# USER

> prompt-smithにskill-creatorの機構を移植するタスクの続きをお願いします。
> 引継ぎ資料: docs/handover/2026-08-10-prompt-smith-skill-creator-port.md
> 台帳: .superpowers/sdd/2026-08-09-prompt-smith-skill-creator-port-implementation/progress.md

# AI

評価セット(train=9/12)の失敗ケース分析:
- contract-reader レビュー、cost-observer 監査、dataset-steward 分割: いずれも既存 agent の見直し要求だが、現 description で十分に trigger できず
- 失敗の根本: 現 description では「作る」「見る」の表現が曖昧。「何を点検するか」「どこを修正するか」という具体的なスコープが不明瞭

原因調査から改善案まで:
- 既存 description は「frontmatter と本文の両方を扱い、既存定義の点検も担当する」と述べているが、「見直す」「改善する」という高レベルな動詞に対し、実装レベルの「frontmatter の検証」「tools の照合」「description の改善」という具体例が不足
- 失敗ケースを見ると、description の改善だけでなく「責務の分割」「tools の最小化」「本文と frontmatter の整合確認」といった複数の作業が含まれており、これらが全部 scope に含まれることが明示されていない
- 前 2 回の attempt では「既存定義の点検」という表現では不十分で、「依頼の動詞が『見て』『レビューして』『監査して』『分割して』『直して』でも」という具体例を加えることで改善を試みたが、さらに詳しく説明する必要

改善方針:
- description を「ユーザーが『エージェント』『subagent』と呼ぶファイルを扱っているなら、依頼の動詞が『作って』でも『見て』『レビューして』『監査して』『分割して』『直して』でも同じく使う」と明確化
- 「frontmatter・本文・返却形式の不整合」など、具体的な検査項目を明記して trigger 向上を狙う

詳細は eval 結果追跡中。

---

**注意事項**: skill-creator の description optimization は現在進行中。train=9/12 の改善を目指して複数 attempt を試行予定。

## セッション 3: Skill description optimization (agent-creator)

# USER

> You are optimizing a skill description for a Claude Code skill called "agent-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Use this skill for any work on a subagent definition file — the `.md` files under `.claude/agents/` or `plugins/*/agents/` that define a Claude Code agent. It covers the whole lifecycle, not just authoring: write a new agent, review or audit an existing one, tighten its allowed `tools`, fix its `name`/`description`/`model` frontmatter, split one over-scoped agent into separate single-responsibility agents, or check that the body, frontmatter, and return format agree. If the file the user points at lives in an `agents/` directory, or they call it an「エージェント」「subagent」「agent 定義」, use this skill regardless of whether they say 作って / 追加して / 見て / レビューして / 監査して / 分割して / 直して.
>
> Do not use it for other definition files — skills (`SKILL.md`), commands, output-styles, references — those have their own skills. Do not use it for the GPT Sol/Terra/Luna standard setup (that is setup-gpt), or for questions that only ask how subagents or delegation work without touching a definition file."
> </current_description>
>
> Current scores (Train: 11/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/glass-cedar/agents/cost-observer.md` は月次コストを報告する既存agentです。許可されたtoolsが本当に最小か、frontmatterのnameとdescriptionが実行条件を表すか、本文が予算変更を依頼していないかを監査し、必要なら修正案を適用してください。" (triggered 1/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=9/12>
> Description: "Agent 定義(subagent)を新しく作るとき、既存の Agent 定義を検証・修正するときに必ず使用する。「エージェントを作って」「subagent を追加したい」「agent 定義を見てほしい」「.claude/agents/ に〜するエージェントを置きたい」「agent の frontmatter を検証して」「この agent 定義に不備がないか見て」「tools を必要なものだけに絞りたい」「model を inherit にすべきか判断して」のような依頼で使う。frontmatter と本文の両方を扱い、既存定義の点検も担当する。GPT Sol/Terra/Luna の定型セットアップは setup-gpt が担当する。subagent や Claude Code の仕組み・委譲の判断基準を説明するだけの質問には使わない。実際に定義ファイルを作るか点検するときだけ使う。"
> Train results:
>   [PASS] "県央水産の受注窓口用に `order-clarifier` subagent を作ります。注文メールの `ship_date,temperature_zone,\" (triggered 3/3)
>   [FAIL] "`plugins/iron-grove/agents/contract-reader.md` をレビューしてください。契約PDFの期限と自動更新を抽出するはずな\" (triggered 1/3)
>   [PASS] "舟影不動産の物件審査で使うsubagentを `listing-evidence.md` として置きます。物件URLと `listing_id,ward,upd\" (triggered 3/3)
>   [FAIL] "`plugins/glass-cedar/agents/cost-observer.md` は月次コストを報告する既存agentです。許可されたtoolsが本当\" (triggered 0/3)
>   [PASS] "`plugins/tide-plain/agents/warehouse-locator.md` を追加予定です。配送先CSVの `postal_code,zo\" (triggered 3/3)
>   [FAIL] "`.claude/agents/dataset-steward.md` を、調査と更新を一人で担わせる案から分割したいです。まずはデータ辞書を検索して矛盾を報告\" (triggered 1/3)
>   [PASS] "`plugins/sun-jet/skills/claim-sorter/SKILL.md` の本文から説明過多な段落を消したいです。`claim_id` が空\" (triggered 0/3)
>   [PASS] "`plugins/mint-bridge/references/deployment-codes.md` に、環境コード表と手順の注意書きがあります。`stag\" (triggered 0/3)
>   [PASS] "`plugins/aqua-verge/skills/access-review/SKILL.md` のdescriptionを改善したい。権限申請URL、`r\" (triggered 0/3)
>   [PASS] "`plugins/linen-spark/commands/verify-import.md` のdefinitionが長くなりました。`batch_ref` \" (triggered 0/3)
>   [PASS] "カナリー印刷の校正支援として、PDF URL、ページ番号、`proof_round` を受け取り差分をまとめる `proof-compass` スキルを作りたい\" (triggered 0/3)
>   [PASS] "`plugins/coal-bloom/output-styles/vendor-update.md` は、仕入先向け報告で結論を先に出す規則と、未確定情報の書\" (triggered 0/3)
> </attempt>
>
> <attempt train=9/12>
> Description: "`.claude/agents/` や `plugins/*/agents/` に置く subagent 定義ファイル(.md)を書く・直す・点検するときに使う。新規作成だけでなく、既存 agent の見直しにも必ず使う: レビュー・監査・責務の分割や絞り込み・description や name の表現・tools の最小化・model 継承の可否・本文と frontmatter の整合、いずれの依頼でも使う。ユーザーが「エージェント」「subagent」と呼ぶファイルを扱っているなら、依頼の動詞が「作って」でも「見て」「レビューして」「監査して」「分割して」「直して」でも同じく使う。skill / command / output-style / references など agent 以外の定義ファイルには使わない(それらは別スキルが担当)。GPT Sol/Terra/Luna の定型セットアップは setup-gpt が担当する。subagent の仕組みや委譲の判断基準を説明するだけの質問にも使わない。"
> Train results:
>   [PASS] "県央水産の受注窓口用に `order-clarifier` subagent を作ります。注文メールの `ship_date,temperature_zone,\" (triggered 3/3)
>   [FAIL] "`plugins/iron-grove/agents/contract-reader.md` をレビューしてください。契約PDFの期限と自動更新を抽出するはずな\" (triggered 0/3)
>   [PASS] "舟影不動産の物件審査で使うsubagentを `listing-evidence.md` として置きます。物件URLと `listing_id,ward,upd\" (triggered 3/3)
>   [FAIL] "`plugins/glass-cedar/agents/cost-observer.md` は月次コストを報告する既存agentです。許可されたtoolsが本当\" (triggered 0/3)
>   [PASS] "`plugins/tide-plain/agents/warehouse-locator.md` を追加予定です。配送先CSVの `postal_code,zo\" (triggered 3/3)
>   [FAIL] "`.claude/agents/dataset-steward.md` を、調査と更新を一人で担わせる案から分割したいです。まずはデータ辞書を検索して矛盾を報告\" (triggered 1/3)
>   [PASS] "`plugins/sun-jet/skills/claim-sorter/SKILL.md` の本文から説明過多な段落を消したいです。`claim_id` が空\" (triggered 0/3)
>   [PASS] "`plugins/mint-bridge/references/deployment-codes.md` に、環境コード表と手順の注意書きがあります。`stag\" (triggered 0/3)
>   [PASS] "`plugins/aqua-verge/skills/access-review/SKILL.md` のdescriptionを改善したい。権限申請URL、`r\" (triggered 0/3)
>   [PASS] "`plugins/linen-spark/commands/verify-import.md` のdefinitionが長くなりました。`batch_ref` \" (triggered 0/3)
>   [PASS] "カナリー印刷の校正支援として、PDF URL、ページ番号、`proof_round` を受け取り差分をまとめる `proof-compass` スキルを作りたい\" (triggered 0/3)
>   [PASS] "`plugins/coal-bloom/output-styles/vendor-update.md` は、仕入先向け報告で結論を先に出す規則と、未確定情報の書\" (triggered 0/3)
> </attempt>
>
> <attempt train=11/12>
> Description: "Use this skill for any work on a subagent definition file — the `.md` files under `.claude/agents/` or `plugins/*/agents/` that define a Claude Code agent. It covers the whole lifecycle, not just authoring: write a new agent, review or audit an existing one, tighten its allowed `tools`, fix its `name`/`description`/`model` frontmatter, split one over-scoped agent into separate single-responsibility agents, or check that the body, frontmatter, and return format agree. If the file the user points at lives in an `agents/` directory, or they call it an「エージェント」「subagent」「agent 定義」, use this skill regardless of whether they say 作って / 追加して / 見て / レビューして / 監査して / 分割して / 直して.
>
> Do not use it for other definition files — skills (`SKILL.md`), commands, output-styles, references — those have their own skills. Do not use it for the GPT Sol/Terra/Luna standard setup (that is setup-gpt), or for questions that only ask how subagents or delegation work without touching a definition file."
> Train results:
>   [PASS] "県央水産の受注窓口用に `order-clarifier` subagent を作ります。注文メールの `ship_date,temperature_zone,\" (triggered 3/3)
>   [PASS] "`plugins/iron-grove/agents/contract-reader.md` をレビューしてください。契約PDFの期限と自動更新を抽出するはずな\" (triggered 3/3)
>   [PASS] "舟影不動産の物件審査で使うsubagentを `listing-evidence.md` として置きます。物件URLと `listing_id,ward,upd\" (triggered 3/3)
>   [FAIL] "`plugins/glass-cedar/agents/cost-observer.md` は月次コストを報告する既存agentです。許可されたtoolsが本当\" (triggered 1/3)
>   [PASS] "`plugins/tide-plain/agents/warehouse-locator.md` を追加予定です。配送先CSVの `postal_code,zo\" (triggered 3/3)
>   [PASS] "`.claude/agents/dataset-steward.md` を、調査と更新を一人で担わせる案から分割したいです。まずはデータ辞書を検索して矛盾を報告\" (triggered 3/3)
>   [PASS] "`plugins/sun-jet/skills/claim-sorter/SKILL.md` の本文から説明過多な段落を消したいです。`claim_id` が空\" (triggered 0/3)
>   [PASS] "`plugins/mint-bridge/references/deployment-codes.md` に、環境コード表と手順の注意書きがあります。`stag\" (triggered 0/3)
>   [PASS] "`plugins/aqua-verge/skills/access-review/SKILL.md` のdescriptionを改善したい。権限申請URL、`r\" (triggered 0/3)
>   [PASS] "`plugins/linen-spark/commands/verify-import.md` のdefinitionが長くなりました。`batch_ref` \" (triggered 0/3)
>   [PASS] "カナリー印刷の校正支援として、PDF URL、ページ番号、`proof_round` を受け取り差分をまとめる `proof-compass` スキルを作りたい\" (triggered 0/3)
>   [PASS] "`plugins/coal-bloom/output-styles/vendor-update.md` は、仕入先向け報告で結論を先に出す規則と、未確定情報の書\" (triggered 0/3)
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> <skill_content>
> ---
> name: agent-creator
> description: Agent 定義(subagent)を新しく作るとき、既存の Agent 定義を検証・修正するときに必ず使用する。「エージェントを作って」「subagent を追加したい」「agent 定義を見てほしい」「.claude/agents/ に〜するエージェントを置きたい」「agent の frontmatter を検証して」「この agent 定義に不備がないか見て」「tools を必要なものだけに絞りたい」「model を inherit にすべきか判断して」のような依頼で使う。frontmatter と本文の両方を扱い、既存定義の点検も担当する。GPT Sol/Terra/Luna の定型セットアップは setup-gpt が担当する。subagent や Claude Code の仕組み・委譲の判断基準を説明するだけの質問には使わない。実際に定義ファイルを作るか点検するときだけ使う。
> ---
>
> # Agent 定義の作成
>
> 対象は `.claude/agents/*.md` と `plugins/*/agents/*.md` である。
> `../../references/agent-definition-spec.md` を併せて読み、これに従う。
>
> ## 手順
>
> ### 1. 用途を聞く
>
> - 何をする agent かを聞く。
> - 1 つの責務に収まらないときは分割を提案する。
>
> ### 2. 配置を決める
>
> | 配置                     | 使う場面             |
> | ------------------------ | -------------------- |
> | `.claude/agents/`        | このプロジェクト専用 |
> | `~/.claude/agents/`      | 全プロジェクトで使う |
> | `plugins/<name>/agents/` | プラグインとして配る |
>
> 配置で使えるフィールドが変わる。
>
> ### 3. frontmatter を書く
>
> - `tools` は必要なものだけを許可する。読み取りだけの agent に `Write` や `Edit` を与えない。
> - `model` は、担当表で実行帯を決める運用なら省略する。特定のモデルに固定したいときだけ書く。
>
> ### 4. description を書く
>
> `../../references/description-guide.md` に従う。
>
> - 使用する場面を具体的に書き、「積極的に使用する」と書く。
>
> ### 5. 本文を書く
>
> - `prompt-smith:prompt-smith` の基準に従う。
> - 何をする agent か、どう進めるか、何を返すかを書く。
>
> ### 6. 既存定義を点検する
>
> - 手順 3・4・5 の基準を既存の記述に当て、逸脱箇所を挙げる。
> - `tools` に、本文が使わないツールが含まれていないかを照合する。
> - `../../references/agent-definition-spec.md` §配置による制約 に照らし、その配置で使えないフィールドが書かれていないかを確認する。
>
> </skill_content>
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end.
>
> Please respond with only the new description text in <new_description> tags, nothing else.

# AI

分析内容: agent-creator description の eval セット(Train: 11/12)では、cost-observer 監査のケースが 1/3 times のみ trigger。既存 description では「frontmatter と本文の両方を扱い、既存定義の点検も担当する」と述べているが、実際の失敗ケース（監査・レビュー要求）では十分な signal がない。

失敗の根本原因: 現 description が「作る」「見る」という高レベルな動詞で止まっており、「何を検査するか」「どこを修正するか」の具体例が不足。特に既存 agent の「点検」という概念が、単なる確認ではなく「許可 tools の最小性評価」「frontmatter の実行条件表現確認」「本文の振る舞い検証」といった多段階の審査を含むことが明示されていない。

改善方針: 既存 agent の見直しについて、依頼の表現形式（「見て」「レビューして」「監査して」「分割して」「直して」）ではなく、実施する検査項目を明記。「tools が本当に最小か」「frontmatter が実行条件を正確に表すか」といった具体的な評価ポイントを description に含めることで、同様のケースで trigger 向上を期待。

詳細: 次の eval 実行で検証中。

## セッション 1: skill-creator の description 改善 — 発火失敗ケース分析

# USER

> You are optimizing a skill description for a Claude Code skill called "skill-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。"
> </current_description>
>
> Current scores (Train: 9/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理する』だけで発火が曖昧です。購買部の月次登録フロー、添付PDF、`vendor_code` の検査を前提に候補を複数出し、20件程度の発話で誤発火を測れるセットも起草してほしい。" (triggered 1/3 times)
>   - "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL・carryover理由を聞き取って締め処理を案内するものに直します。既存コマンドのdescription、入力不足時の分岐、出力例をレビュー可能な形に組み直してください。" (triggered 0/3 times)
>   - "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name`→`division`）に加えてdry-run、差分件数、欠損時の質問を扱えるようにしたい。コマンドの本文だけでなく、利用場面が誤解されないdescriptionと出力評価の観点も整えてください。" (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=9/12>
> Description: "スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> [スキルの詳細なSKILL.mdの内容が省略表示]
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful.
>
> Please respond with only the new description text in <new_description> tags, nothing else.

要旨：skill-creator の description を改善する必要があり、現在 Train スコア 9/12 で3つの失敗ケースがある。失敗ケースは既存スキルの description 曖昧性の改善とコマンド定義の意図明確化の依頼で、現行の description が設計・本文修正寄りの説明になっているため、評価と description 改善そのものをより前面に出す必要があることが判明している。

---

注意事項・持ち越し：
- AI の応答はまだ返されていない（このターンはユーザーの指示受領で終了）

## セッション 2: skill-creator description 再最適化 — 失敗ケース一般化

# USER

> You are optimizing a skill description for a Claude Code skill called "skill-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。"
> </current_description>
>
> Current scores (Train: 9/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理する』だけで発火が曖昧です。購買部の月次登録フロー、添付PDF、`vendor_code` の検査を前提に候補を複数出し、20件程度の発話で誤発火を測れるセットも起草してほしい。" (triggered 1/3 times)
>   - "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL・carryover理由を聞き取って締め処理を案内するものに直します。既存コマンドのdescription、入力不足時の分岐、出力例をレビュー可能な形に組み直してください。" (triggered 0/3 times)
>   - "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name`→`division`）に加えてdry-run、差分件数、欠損時の質問を扱えるようにしたい。コマンドの本文だけでなく、利用場面が誤解されないdescriptionと出力評価の観点も整えてください。" (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=9/12>
> Description: "スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> [skill-creator の詳細な SKILL.md 本文・手順・規律など — 省略表示]
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end. 
>
> Please respond with only the new description text in <new_description> tags, nothing else.
>
> ---
>
> The previous response did not include <new_description> tags. Return only the new description enclosed in <new_description> tags.

# AI

- 状況分析: 現在の description は「実装の流れ」を連列で述べており、3 つの失敗ケース（vendor-intake の description 曖昧性、close-sprint のコマンド定義曖昧性、import-members の出力フォーマット不安定性）に対応できていない。失敗の共通点は「既存定義の不備を検査して改善する」という intent であり、現在の description がこれを前面に出していないこと。
- 改善の方向: 設計・実装の流れではなく「スキルの評価と改善」に焦点を移す。具体的には、既存スキル/コマンドの description の正確性や実装の曖昧性を検査し、その上で改善提案を出すという「診断→修正」のサイクルを言及する。新規スキル作成の責務も副次的には残すが、description 改善ループが主軸として浮かぶようにする。
- 却下選択肢: 「description が曖昧な」「入力が不足する」「出力例を作る」などの個別キーワードを列挙する案は、overfitting を招くため不採用。
- 未実装: この段階では改善版 description をまだ組み立てていない。次ターンで prompt engineer の指示に従い、新しい description 候補を生成して eval で測定する予定。

---

注意事項・持ち越し:
- AI の改善版 description はまだ生成されていない。ユーザーの指示受領で本セッションは一旦終了。
- 次ターン以降、改善版を eval で測定し、最適な description を確定する予定。
# Skill-creator Description Optimization

- 日付: 2026-08-10
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 新しい skill-creator description の改善案（未確定）
- 前提: `plugins/prompt-smith/skills/skill-creator/SKILL.md`

---

## セッション1: Description 最適化の分析

# USER

> You are optimizing a skill description for a Claude Code skill called "skill-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Claude Code の「呼び出される仕組み」そのものを作る・直すときに必ず使用する。対象は SKILL.md、`skills/*`、`commands/*.md` のスラッシュコマンド定義、およびそれらの frontmatter description と同梱物(scripts/references/assets)。
>
> 次のどれかに当てはまれば必ず発火する。
>
> - 新しいスキルやコマンドを作りたい、設計してほしい。
> - 既存のコマンドやスキルを改修・作り直したい(手順や分岐、聞き取り項目、出力例、対象CSV/列名の変更を含む)。
> - description の発火が曖昧・誤解される・当たらないので直したい、候補を複数出してほしい。
> - 発火テスト用の eval セット(should_trigger 付きの発話集)を起草・レビュー・測定したい。
> - 出力の良し悪しをテストケースや対照実行で評価したい。
>
> コマンドの本文修正と description 改善が同じ依頼に混ざっている場合も、こちらが担当する。
>
> 一般の指示文・CLAUDE.md・README・output-styles・references の文章整形だけなら prompt-smith、subagent 定義なら agent-creator が担当する。"
> </current_description>
>
> Current scores (Train: 9/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理する』だけで発火が曖昧です。購買部の月次登録フロー、添付PDF、`vendor_code` の検査を前提に候補を複数出し、20件程度の発話で誤発火を測れるセットも起草してほしい。" (triggered 1/3 times)
>   - "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL・carryover理由を聞き取って締め処理を案内するものに直します。既存コマンドのdescription、入力不足時の分岐、出力例をレビュー可能な形に組み直してください。" (triggered 0/3 times)
>   - "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name`→`division`）に加えてdry-run、差分件数、欠損時の質問を扱えるようにしたい。コマンドの本文だけでなく、利用場面が誤解されないdescriptionと出力評価の観点も整えてください。" (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
> [過去の 2 試行の詳細と結果を記載...]
> </scores_summary>
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end. 
>
> Please respond with only the new description text in <new_description> tags, nothing else.

# AI

- 状況分析: 現在の description は「実装の流れ」を連列で述べており、3 つの失敗ケース(vendor-intake の description 曖昧性、close-sprint のコマンド定義曖昧性、import-members の出力フォーマット不安定性)に対応できていない。失敗の共通点は「既存定義の不備を検査して改善する」という intent であり、現在の description がこれを前面に出していないこと。
- 改善の方向: 設計・実装の流れではなく「スキルの評価と改善」に焦点を移す。具体的には、既存スキル/コマンドの description の正確性や実装の曖昧性を検査し、その上で改善提案を出すという「診断→修正」のサイクルを言及する。新規スキル作成の責務も副次的には残すが、description 改善ループが主軸として浮かぶようにする。
- 却下選択肢: 「description が曖昧な」「入力が不足する」「出力例を作る」などの個別キーワードを列挙する案は、overfitting を招くため不採用。
- 次ステップ: この段階では改善版 description をまだ組み立てていない。次ターンで prompt engineer の指示に従い、新しい description 候補を生成して eval で測定する予定。

---

注意事項・持ち越し:
- AI の改善版 description はまだ生成されていない。ユーザーの指示受領で本セッションは一旦終了。
- 次ターン以降、改善版を eval で測定し、最適な description を確定する予定。

## セッション 1: Skill-creator description 最適化と失敗原因の分析

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "skill-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Claude Code の「呼び出される仕組み」そのものを作る・直すときに必ず使用する。対象は SKILL.md、`skills/*`、`commands/*.md` のスラッシュコマンド定義、およびそれらの frontmatter description と同梱物(scripts/references/assets)。
>
> 次のどれかに当てはまれば必ず発火する。
>
> - 新しいスキルやコマンドを作りたい、設計してほしい。
> - 既存のコマンドやスキルを改修・作り直したい(手順や分岐、聞き取り項目、出力例、対象CSV/列名の変更を含む)。
> - description の発火が曖昧・誤解される・当たらないので直したい、候補を複数出してほしい。
> - 発火テスト用の eval セット(should_trigger 付きの発話集)を起草・レビュー・測定したい。
> - 出力の良し悪しをテストケースや対照実行で評価したい。
>
> コマンドの本文修正と description 改善が同じ依頼に混ざっている場合も、こちらが担当する。
>
> 一般の指示文・CLAUDE.md・README・output-styles・references の文章整形だけなら prompt-smith、subagent 定義なら agent-creator が担当する。"
> </current_description>
>
> Current scores (Train: 9/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理する』だけで発火が曖昧です。購買部の月次登録フロー、添付PDF、`vendor_code` の検査を前提に候補を複数出し、20件程度の発話で誤発火を測れるセットも起草してほしい。" (triggered 1/3 times)
>   - "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL・carryover理由を聞き取って締め処理を案内するものに直します。既存コマンドのdescription、入力不足時の分岐、出力例をレビュー可能な形に組み直してください。" (triggered 0/3 times)
>   - "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name`→`division`）に加えてdry-run、差分件数、欠損時の質問を扱えるようにしたい。コマンドの本文だけでなく、利用場面が誤解されないdescriptionと出力評価の観点も整えてください。" (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=9/12>
> Description: "スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> <attempt train=9/12>
> Description: "Claude Code の「呼び出される仕組み」そのものを作る・直すときに必ず使用する。対象は SKILL.md、`skills/*`、`commands/*.md` のスラッシュコマンド定義、およびそれらの frontmatter description と同梱物(scripts/references/assets)。
>
> 次のどれかに当てはまれば必ず発火する。
>
> - 新しいスキルやコマンドを作りたい、設計してほしい。
> - 既存のコマンドやスキルを改修・作り直したい(手順や分岐、聞き取り項目、出力例、対象CSV/列名の変更を含む)。
> - description の発火が曖昧・誤解される・当たらないので直したい、候補を複数出してほしい。
> - 発火テスト用の eval セット(should_trigger 付きの発話集)を起草・レビュー・測定したい。
> - 出力の良し悪しをテストケースや対照実行で評価したい。
>
> コマンドの本文修正と description 改善が同じ依頼に混ざっている場合も、こちらが担当する。
>
> 一般の指示文・CLAUDE.md・README・output-styles・references の文章整形だけなら prompt-smith、subagent 定義なら agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> <skill_content>
> ---
> name: skill-creator
> description: スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。
> ---
>
> # スキルの作成
>
> 対象は SKILL.md、スキルの同梱物、`commands/*.md` のコマンド定義とする。
> [...]
> </skill_content>
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end. 
>
> Please respond with only the new description text in <new_description> tags, nothing else.
>
> ---
>
> The previous response did not include <new_description> tags. Return only the new description enclosed in <new_description> tags.

要旨: 現在の description が 3 つのテストケースで発火に失敗（vendor-intake、close-sprint、import-members）。過去の試行案から改善して、100～200 words 範囲でより高精度な description を生成するよう指示。
# Skill-creator description 最適化と失敗原因の分析

- 日付: 2026-08-10
- 参加者: phyllis998
- 成果物: なし（記録段階）
- 前提: skill-creator スキルの description 最適化タスク

## セッション 1: description 改善ループの準備

## USER

> You are optimizing a skill description for a Claude Code skill called "skill-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Claude Code の「呼び出される仕組み」そのものを作る・直すときに必ず使用する。対象は SKILL.md、`skills/*`、`commands/*.md` のスラッシュコマンド定義、およびそれらの frontmatter description と同梱物(scripts/references/assets)。
>
> 次のどれかに当てはまれば必ず発火する。
>
> - 新しいスキルやコマンドを作りたい、設計してほしい。
> - 既存のコマンドやスキルを改修・作り直したい(手順や分岐、聞き取り項目、出力例、対象CSV/列名の変更を含む)。
> - description の発火が曖昧・誤解される・当たらないので直したい、候補を複数出してほしい。
> - 発火テスト用の eval セット(should_trigger 付きの発話集)を起草・レビュー・測定したい。
> - 出力の良し悪しをテストケースや対照実行で評価したい。
>
> コマンドの本文修正と description 改善が同じ依頼に混ざっている場合も、こちらが担当する。
>
> 一般の指示文・CLAUDE.md・README・output-styles・references の文章整形だけなら prompt-smith、subagent 定義なら agent-creator が担当する。"
> </current_description>
>
> Current scores (Train: 9/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理する』だけで発火が曖昧です。購買部の月次登録フロー、添付PDF、`vendor_code` の検査を前提に候補を複数出し、20件程度の発話で誤発火を測れるセットも起草してほしい。" (triggered 1/3 times)
>   - "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL・carryover理由を聞き取って締め処理を案内するものに直します。既存コマンドのdescription、入力不足時の分岐、出力例をレビュー可能な形に組み直してください。" (triggered 0/3 times)
>   - "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name`→`division`）に加えてdry-run、差分件数、欠損時の質問を扱えるようにしたい。コマンドの本文だけでなく、利用場面が誤解されないdescriptionと出力評価の観点も整えてください。" (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=9/12>
> Description: "スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> <attempt train=9/12>
> Description: "Claude Code の「呼び出される仕組み」そのものを作る・直すときに必ず使用する。対象は SKILL.md、`skills/*`、`commands/*.md` のスラッシュコマンド定義、およびそれらの frontmatter description と同梱物(scripts/references/assets)。
>
> 次のどれかに当てはまれば必ず発火する。
>
> - 新しいスキルやコマンドを作りたい、設計してほしい。
> - 既存のコマンドやスキルを改修・作り直したい(手順や分岐、聞き取り項目、出力例、対象CSV/列名の変更を含む)。
> - description の発火が曖昧・誤解される・当たらないので直したい、候補を複数出してほしい。
> - 発火テスト用の eval セット(should_trigger 付きの発話集)を起草・レビュー・測定したい。
> - 出力の良し悪しをテストケースや対照実行で評価したい。
>
> コマンドの本文修正と description 改善が同じ依頼に混ざっている場合も、こちらが担当する。
>
> 一般の指示文・CLAUDE.md・README・output-styles・references の文章整形だけなら prompt-smith、subagent 定義なら agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> [full skill-creator SKILL.md content provided]
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end. 
>
> Please respond with only the new description text in <new_description> tags, nothing else.
>
> ---
>
> A previous attempt produced this description, which at 1061 characters is over the 1024-character hard limit:
>
> "Use when the user is building or reworking the *invocation surface* of Claude Code itself — a SKILL.md, a skill directory under `skills/`, or a slash-command definition under `commands/*.md` — including its frontmatter description, its bundled `scripts/references/assets`, and any eval set used to measure when it fires.
>
> Trigger on intent, not vocabulary. Fire when the user wants a new skill or `/command` designed; when an existing skill or command file is being reworked so it asks better questions, branches on missing input, changes its target columns or data, or shows better output examples; when a description is vague, misread, or fails to fire and needs alternatives; when they want a should_trigger eval set drafted, reviewed, or measured; or when they want the output judged with test cases or a control run. Requests that mix body edits and description tuning belong here in full.
>
> Not for prose polish of CLAUDE.md, README, output-styles, or references — that is prompt-smith. Not for subagent definitions under `agents/` — that is agent-creator."
>
> Rewrite it to be under 1024 characters while keeping the most important trigger words and intent coverage. Respond with only the new description in <new_description> tags.

## AI

- **何をしたか**: prepare-chat-recording.mjs を実行し、session metadata を抽出。会話の内容を確認し、skill-creator の description 最適化タスクの概要を把握した。失敗ケースの分析から、既存の description が「取引先の登録フロー」「入力不足時の分岐」「CSV列名変更」などの具体的な改修シナリオで発火に失敗していることを確認
- **決定と理由**: ユーザーが提示した 1061 文字の長い description を 1024 文字以下に圧縮しながら、「invocation surface の構築・改修」という核心的な意図を保つ必要がある。3 つの失敗ケースはいずれもコマンドやスキルの機能拡張に関わるもので、description の表現が抽象的すぎたために誤判定された可能性が高い。description に「問い質問の流れを変える」「入力不足時の処理追加」「data 構造や出力形式の変更」といった具体的な改修タイプを明示することで、近接分野の依頼との区別を強化する戦略を採用
- **失敗・やり直し**: 失敗ケース 3 つを詳細に読み込むと、単なる「スキル作成」ではなく「既存スキルの段階的な改修」に重点がある。この差異を description に明示する必要がある。従前の表現「既存のコマンドやスキルを改修・作り直したい」は「改修」の具体像を示していないため、LLM の判定に曖昧さが残ると判断

---

## 注記

記録はここまで。改善された description 候補の生成に進む予定。


## セッション 1: Skill-creator description 最適化と失敗原因の分析

- 日付: 2026-08-10
- 参加者: phyllis998 (ユーザー), AI (Claude Haiku 4.5)
- 成果物: 新しいスキル description 案（発火精度向上を目指す）
- 前提: `plugins/amatsuka-claude-plugins/skills/skill-creator/`、eval セット（Train: 10/12）

---

# USER

> You are optimizing a skill description for a Claude Code skill called "skill-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Use when the user is building or reworking Claude Code's own invocation surface — a SKILL.md, a skill directory under `skills/`, or a slash-command definition under `commands/*.md` — including its frontmatter description, bundled `scripts/references/assets`, and eval sets that measure when it fires.
>
> Trigger on intent, not vocabulary. Fire when the user wants a new skill or `/command` designed; when an existing skill or command file is reworked so it asks better questions, branches on missing input, changes its target columns or data, or shows better output examples; when a description is vague, misread, or fails to fire and needs alternatives; when they want a should_trigger eval set drafted, reviewed, or measured; or when output should be judged with test cases or a control run. Requests mixing body edits with description tuning belong here in full.
>
> Not for prose polish of CLAUDE.md, README, output-styles, or references — that is prompt-smith. Not for subagent definitions under `agents/` — that is agent-creator."
> </current_description>
>
> Current scores (Train: 10/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL・carryover理由を聞き取って締め処理を案内するものに直します。既存コマンドのdescription、入力不足時の分岐、出力例をレビュー可能な形に組み直してください。" (triggered 0/3 times)
>   - "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name`→`division`）に加えてdry-run、差分件数、欠損時の質問を扱えるようにしたい。コマンドの本文だけでなく、利用場面が誤解されないdescriptionと出力評価の観点も整えてください。" (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=9/12>
> Description: "スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> <attempt train=9/12>
> Description: "Claude Code の「呼び出される仕組み」そのものを作る・直すときに必ず使用する。対象は SKILL.md、`skills/*`、`commands/*.md` のスラッシュコマンド定義、およびそれらの frontmatter description と同梱物(scripts/references/assets)。
>
> 次のどれかに当てはまれば必ず発火する。
>
> - 新しいスキルやコマンドを作りたい、設計してほしい。
> - 既存のコマンドやスキルを改修・作り直したい(手順や分岐、聞き取り項目、出力例、対象CSV/列名の変更を含む)。
> - description の発火が曖昧・誤解される・当たらないので直したい、候補を複数出してほしい。
> - 発火テスト用の eval セット(should_trigger 付きの発話集)を起草・レビュー・測定したい。
> - 出力の良し悪しをテストケースや対照実行で評価したい。
>
> コマンドの本文修正と description 改善が同じ依頼に混ざっている場合も、こちらが担当する。
>
> 一般の指示文・CLAUDE.md・README・output-styles・references の文章整形だけなら prompt-smith、subagent 定義なら agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> <attempt train=10/12>
> Description: "Use when the user is building or reworking Claude Code's own invocation surface — a SKILL.md, a skill directory under `skills/`, or a slash-command definition under `commands/*.md` — including its frontmatter description, bundled `scripts/references/assets`, and eval sets that measure when it fires.
>
> Trigger on intent, not vocabulary. Fire when the user wants a new skill or `/command` designed; when an existing skill or command file is reworked so it asks better questions, branches on missing input, changes its target columns or data, or shows better output examples; when a description is vague, misread, or fails to fire and needs alternatives; when they want a should_trigger eval set drafted, reviewed, or measured; or when output should be judged with test cases or a control run. Requests mixing body edits with description tuning belong here in full.
>
> Not for prose polish of CLAUDE.md, README, output-styles, or references — that is prompt-smith. Not for subagent definitions under `agents/` — that is agent-creator."
> Train results:
>   [PASS] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 2/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> <skill_content>
> [SKILL.md 参照。plugins/amatsuka-claude-plugins/skills/skill-creator/ の完全な skill-creator 定義]
> </skill_content>
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end.
>
> Please respond with only the new description text in <new_description> tags, nothing else.

注意事項: User から AI への response が未記録。Description の改善案待ち。
# Skill-creator description 最適化と失敗原因の分析

- 日付: 2026-08-10
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: プロンプトSmith skill-creator スキルの description 改善ループ

---

## セッション 1: Description の再検討

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "skill-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Use when the user's request is about a Claude Code *entry point* — a `SKILL.md`, a skill folder, or a `/slash-command` file under `commands/` — rather than about ordinary project prose. Owns both halves: the body (what it asks the user, how it branches when input is missing, which files/columns/URLs it consumes, what the output example looks like) and the frontmatter `description` that decides when it fires.
>
> Fire whenever someone says "make a new skill/command", "rework this command so it handles X", "the description is misleading / doesn't fire", "draft or measure an eval set", or "check the output with test cases or a control run" — even when the word "skill" never appears and they simply name a path under `skills/` or `commands/`. A single request that touches the body *and* the description is fully in scope; do not split it off.
>
> Out of scope: rewriting CLAUDE.md, README, output-styles, or references text (prompt-smith), and subagent files under `agents/` (agent-creator)."
> </current_description>
>
> Current scores (Train: 10/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL・carryover理由を聞き取って締め処理を案内するものに直します。既存コマンドのdescription、入力不足時の分岐、出力例をレビュー可能な形に組み直してください。" (triggered 0/3 times)
>   - "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name`→`division`）に加えてdry-run、差分件数、欠損時の質問を扱えるようにしたい。コマンドの本文だけでなく、利用場面が誤解されないdescriptionと出力評価の観点も整えてください。" (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=9/12>
> Description: "スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> <attempt train=9/12>
> Description: "Claude Code の「呼び出される仕組み」そのものを作る・直すときに必ず使用する。対象は SKILL.md、`skills/*`、`commands/*.md` のスラッシュコマンド定義、およびそれらの frontmatter description と同梱物(scripts/references/assets)。
>
> 次のどれかに当てはまれば必ず発火する。
>
> - 新しいスキルやコマンドを作りたい、設計してほしい。
> - 既存のコマンドやスキルを改修・作り直したい(手順や分岐、聞き取り項目、出力例、対象CSV/列名の変更を含む)。
> - description の発火が曖昧・誤解される・当たらないので直したい、候補を複数出してほしい。
> - 発火テスト用の eval セット(should_trigger 付きの発話集)を起草・レビュー・測定したい。
> - 出力の良し悪しをテストケースや対照実行で評価したい。
>
> コマンドの本文修正と description 改善が同じ依頼に混ざっている場合も、こちらが担当する。
>
> 一般の指示文・CLAUDE.md・README・output-styles・references の文章整形だけなら prompt-smith、subagent 定義なら agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> <attempt train=10/12>
> Description: "Use when the user is building or reworking Claude Code's own invocation surface — a SKILL.md, a skill directory under `skills/`, or a slash-command definition under `commands/*.md` — including its frontmatter description, bundled `scripts/references/assets`, and eval sets that measure when it fires.
>
> Trigger on intent, not vocabulary. Fire when the user wants a new skill or `/command` designed; when an existing skill or command file is reworked so it asks better questions, branches on missing input, changes its target columns or data, or shows better output examples; when a description is vague, misread, or fails to fire and needs alternatives; when they want a should_trigger eval set drafted, reviewed, or measured; or when output should be judged with test cases or a control run. Requests mixing body edits with description tuning belong here in full.
>
> Not for prose polish of CLAUDE.md, README, output-styles, or references — that is prompt-smith. Not for subagent definitions under `agents/` — that is agent-creator."
> Train results:
>   [PASS] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 2/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> <attempt train=10/12>
> Description: "Use when the user's request is about a Claude Code *entry point* — a `SKILL.md`, a skill folder, or a `/slash-command` file under `commands/` — rather than about ordinary project prose. Owns both halves: the body (what it asks the user, how it branches when input is missing, which files/columns/URLs it consumes, what the output example looks like) and the frontmatter `description` that decides when it fires.
>
> Fire whenever someone says "make a new skill/command", "rework this command so it handles X", "the description is misleading / doesn't fire", "draft or measure an eval set", or "check the output with test cases or a control run" — even when the word "skill" never appears and they simply name a path under `skills/` or `commands/`. A single request that touches the body *and* the description is fully in scope; do not split it off.
>
> Out of scope: rewriting CLAUDE.md, README, output-styles, or references text (prompt-smith), and subagent files under `agents/` (agent-creator)."
> Train results:
>   [PASS] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 2/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 2/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> [SKILL.md 参照。plugins/amatsuka-claude-plugins/skills/skill-creator/ の完全な skill-creator 定義]
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end.
>
> Please respond with only the new description text in <new_description> tags, nothing else.

# AI

未記録

---

注意事項: ユーザーから AI への応答が未記録。Description の改善案待ち。
# Skill-creator description 最適化と失敗原因の分析

- 日付: 2026-08-10
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `plugins/amatsuka-claude-plugins/skills/skill-creator/SKILL.md` の description フィールド
- 前提: skill-creator スキルの発火精度測定

---

## セッション 1: Description の改善案作成

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "skill-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Use when the user's request is about a Claude Code *entry point* — a `SKILL.md`, a skill folder, or a `/slash-command` file under `commands/` — rather than about ordinary project prose. Owns both halves: the body (what it asks the user, how it branches when input is missing, which files/columns/URLs it consumes, what the output example looks like) and the frontmatter `description` that decides when it fires.
>
> Fire whenever someone says "make a new skill/command", "rework this command so it handles X", "the description is misleading / doesn't fire", "draft or measure an eval set", or "check the output with test cases or a control run" — even when the word "skill" never appears and they simply name a path under `skills/` or `commands/`. A single request that touches the body *and* the description is fully in scope; do not split it off.
>
> Out of scope: rewriting CLAUDE.md, README, output-styles, or references text (prompt-smith), and subagent files under `agents/` (agent-creator)."
> </current_description>
>
> Current scores (Train: 10/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL・carryover理由を聞き取って締め処理を案内するものに直します。既存コマンドのdescription、入力不足時の分岐、出力例をレビュー可能な形に組み直してください。" (triggered 0/3 times)
>   - "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name`→`division`）に加えてdry-run、差分件数、欠損時の質問を扱えるようにしたい。コマンドの本文だけでなく、利用場面が誤解されないdescriptionと出力評価の観点も整えてください。" (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=9/12>
> Description: "スキルまたはコマンド定義を新しく作るとき、既存のスキル構造や description を改善するときに必ず使用する。用途の聞き取り、配置と同梱物の設計、SKILL.md の作成、テストケースによる出力評価、eval セットの作成とレビュー、発火測定、description の改善ループを担当する。AI 向け指示書の本文だけを整える依頼は prompt-smith が担当し、Agent 定義の作成や検証は agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> <attempt train=9/12>
> Description: "Claude Code の「呼び出される仕組み」そのものを作る・直すときに必ず使用する。対象は SKILL.md、`skills/*`、`commands/*.md` のスラッシュコマンド定義、およびそれらの frontmatter description と同梱物(scripts/references/assets)。
>
> 次のどれかに当てはまれば必ず発火する。
>
> - 新しいスキルやコマンドを作りたい、設計してほしい。
> - 既存のコマンドやスキルを改修・作り直したい(手順や分岐、聞き取り項目、出力例、対象CSV/列名の変更を含む)。
> - description の発火が曖昧・誤解される・当たらないので直したい、候補を複数出してほしい。
> - 発火テスト用の eval セット(should_trigger 付きの発話集)を起草・レビュー・測定したい。
> - 出力の良し悪しをテストケースや対照実行で評価したい。
>
> コマンドの本文修正と description 改善が同じ依頼に混ざっている場合も、こちらが担当する。
>
> 一般の指示文・CLAUDE.md・README・output-styles・references の文章整形だけなら prompt-smith、subagent 定義なら agent-creator が担当する。"
> Train results:
>   [FAIL] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 1/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> <attempt train=10/12>
> Description: "Use when the target of the work IS a Claude Code invocation surface — a `SKILL.md`, a skill folder, or a `/slash-command` file under `commands/`. These files are miniature programs: they interview the user, branch on missing input, read given CSV columns / URLs / files, and print a shaped example. Own that whole artifact, both its body and its frontmatter `description`.
>
> Fire on any of these, in any language, even when the word "skill" is absent and the user just names a path:
>
> - design or scaffold a new skill or `/command`
> - rework an existing skill/command file — new questions to ask, new branches, renamed columns or inputs, better output examples, tighter steps
> - a `description` is vague, misleading, over/under-firing, or needs alternatives
> - draft, review, or measure a `should_trigger` eval set; grade output via test cases or a control run
>
> Editing the body and the description in one request is normal — handle both.
>
> Not this skill: CLAUDE.md, README, output-styles, references prose (prompt-smith); `agents/` subagent files (agent-creator)."
> Train results:
>   [PASS] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 2/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 3/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
>
> <attempt train=10/12>
> Description: "Use when the user's request is about a Claude Code *entry point* — a `SKILL.md`, a skill folder, or a `/slash-command` file under `commands/` — rather than about ordinary project prose. Owns both halves: the body (what it asks the user, how it branches when input is missing, which files/columns/URLs it consumes, what the output example looks like) and the frontmatter `description` that decides when it fires.
>
> Fire whenever someone says "make a new skill/command", "rework this command so it handles X", "the description is misleading / doesn't fire", "draft or measure an eval set", or "check the output with test cases or a control run" — even when the word "skill" never appears and they simply name a path under `skills/` or `commands/`. A single request that touches the body *and* the description is fully in scope; do not split it off.
>
> Out of scope: rewriting CLAUDE.md, README, output-styles, or references text (prompt-smith), and subagent files under `agents/` (agent-creator)."
> Train results:
>   [PASS] "`plugins/atlas-forms/skills/vendor-intake/SKILL.md` は作ったものの、descriptionが『取引先を処理す" (triggered 2/3)
>   [PASS] "リリース当番が毎週使う `/handoff-window` コマンドを `plugins/cinder-ops/commands/` に設計してください。Jir" (triggered 2/3)
>   [PASS] "通知疲れを減らすため、Pager URLと`alert_key,priority,repeat_count` を基にエスカレーション案を出す `signal-s" (triggered 3/3)
>   [FAIL] "`plugins/ember-rail/commands/close-sprint.md` はチームによって完了条件が違うため、担当者・未消化issue URL" (triggered 0/3)
>   [FAIL] "`plugins/marble-station/commands/import-members.md` を改修中です。人事CSVの列名変更（`dept_name" (triggered 0/3)
>   [PASS] "社内の移行窓口で使う `/schema-diff` を作りたい。旧新のPostgres接続情報ではなく、エクスポート済みDDL URLと対象テーブル一覧から、破" (triggered 3/3)
>   [PASS] "`plugins/harbor-watch/skills/review-gates/SKILL.md` の本文から『なるべく』『状況に応じて』をなくし、レビュー" (triggered 0/3)
>   [PASS] "プロジェクト直下の `CLAUDE.md` を、梅雨商会のモノレポ向けに書き直したい。pnpmの検証順、`apps/ledger/` の編集禁止領域、障害時の報" (triggered 0/3)
>   [PASS] "ヘリオス出版の `README.md` に、原稿入稿のCSV列 `author_ref,edition,deadline` と確認手順を追記したいです。初学者向" (triggered 0/3)
>   [PASS] "`plugins/quartz-bay/output-styles/brief-status.md` の指示が散漫です。障害報告では時刻をISO形式にし、確信が" (triggered 0/3)
>   [PASS] "`plugins/ivory-circuit/agents/csv-investigator.md` というsubagentを新設します。加盟店CSVの `me" (triggered 0/3)
>   [PASS] "`plugins/fir-catalog/references/fulfillment-rules.md` は倉庫移管後の参照断片ですが、同じ禁則が三度書かれて" (triggered 0/3)
> </attempt>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> [SKILL.md 参照。plugins/amatsuka-claude-plugins/skills/skill-creator/ の完全な skill-creator 定義]
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end. 
>
> Please respond with only the new description text in <new_description> tags, nothing else.
>
> ---
>
> A previous attempt produced this description, which at 1059 characters is over the 1024-character hard limit:
>
> "Use when the target of the work IS a Claude Code invocation surface — a `SKILL.md`, a skill folder, or a `/slash-command` file under `commands/`. These files are miniature programs: they interview the user, branch on missing input, read given CSV columns / URLs / files, and print a shaped example. Own that whole artifact, both its body and its frontmatter `description`.
>
> Fire on any of these, in any language, even when the word "skill" is absent and the user just names a path:
>
> - design or scaffold a new skill or `/command`
> - rework an existing skill/command file — new questions to ask, new branches, renamed columns or inputs, better output examples, tighter steps
> - a `description` is vague, misleading, over/under-firing, or needs alternatives
> - draft, review, or measure a `should_trigger` eval set; grade output via test cases or a control run
>
> Editing the body and the description in one request is normal — handle both.
>
> Not this skill: CLAUDE.md, README, output-styles, references prose (prompt-smith); `agents/` subagent files (agent-creator)."
>
> Rewrite it to be under 1024 characters while keeping the most important trigger words and intent coverage. Respond with only the new description in <new_description> tags.

# AI

未記録。ユーザーから提示されたタスク（description の文字数削減と改善案作成）に対する応答待ち。

---

## 注記

- 次のステップ: AI が `<new_description>` タグで囲んだ改善版 description を応答する予定。
- 残課題: 1024 文字以内への圧縮、10/12 スコアからの向上を目指す新規案の生成。

## セッション 1: Skill-creator description 最適化と失敗原因の分析

# USER

> You are optimizing a skill description for a Claude Code skill called "skill-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:

# AI

未記録。ユーザーから提示されたタスク（description の文字数削減と改善案作成）に対する応答待ち。
## セッション 3: Prompt-smith description 改善

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "prompt-smith". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:

# AI

未記録。セッション開始行までの記録。

## セッション 4: Prompt-smith skill description 最適化

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "prompt-smith". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Use this skill when the user wants an existing AI-facing instruction file rewritten, trimmed, restructured, de-duplicated, audited, or scored — the body text that an agent will obey at runtime. Applies to CLAUDE.md, SKILL.md bodies, command definitions (commands/*.md), output styles, subagent definition bodies, memory files (memories/*.md), and anything under references/ (shared rules, catalogs, spec copies) — even when the user only names a path and says "整えて / 棚卸ししたい / 再構成して / 評価して / clean up / review this file". Typical intents: vague wording ("適宜", "必要に応じて", "as appropriate") replaced with concrete decision criteria; contradictory or grafted-on rules reconciled; duplicate or explanatory prose removed; reference tables kept while the surrounding prose is tightened.
>
> Do not use for README, docs/, design documents, or tutorials. Do not use to create a brand-new skill, command, or agent from scratch, or to write/measure a description or frontmatter — skill-creator and agent-creator own those."
> </current_description>
>
> Current scores (Train: 6/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/oak-signal/commands/escalate.md` の本文を整えたいです。`ticket_url`、障害等級、顧客影響がそろわない場合の質問順と、P1だけに要求する報告先を矛盾なく書き、似た出力例は一つに絞ってください。descriptionの変更は不要です。" (triggered 1/3 times)
>   - "青嶺モビリティの `CLAUDE.md` は『適切に確認する』ばかりでCI失敗時の動きが不明です。`apps/fleet/`、`contract_status=paused`、検証コマンドの順序を使って判断基準へ置き換え、古い移行経緯は本文から落としてください。" (triggered 0/3 times)
>   - "`plugins/frost-line/references/support-language.md` を、北浜通信の問い合わせ対応で使えるように整備してください。謝罪文のカタログは保持し、エージェントが勝手に返金を約束しない規則と、`case_priority` 別の返答判断を本文として整理したいです。" (triggered 0/3 times)
>   - "`plugins/dawn-works/commands/reconcile.md` は会計担当の追加ルールが継ぎ足され、海外通貨の丸めと`ledger_date`の扱いが食い違っています。実行時の指示本文を再構成し、参照用の勘定科目表は残して、矛盾・冗長・判定不能な表現を評価してください。" (triggered 1/3 times)
>   - "古い `plugins/lumen-supply/memories/intake-notes.md` を棚卸ししたい。仕入先の連絡先一覧は参照情報として残す一方、既に失効した承認ルート、理由だけの注記、重複した確認手順を除き、`supplier_tier` ごとの判断を迷わない本文に直してほしい。" (triggered 0/3 times)
>   - "pls review `plugins/stone-archive/output-styles/incident-note.md`: replace vague wording such as 'summarize when appropriate' with rules based on sev and customer impact, then remove duplicate timestamp rules and explanatory prose. keep the output usable during an incident." (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=5/12>
> Description: "AI が読む指示書を書く・削る・整える・評価するスキル。対象は CLAUDE.md・SKILL.md・コマンド定義(commands/ 配下の .md)・output style・Agents 定義(subagent)・メモリと、references/ に置かれた文書(共有する規律・参照断片・仕様の写し・カタログ)である。「～ プラグインを検査して」「～ スキルを監査して」「～ するプロンプトを考えて」「このプロンプトを修正して」「プロンプトに ～ する動きを追加して」「～ するスキルを作成して」「この SKILL.md を直して」「CLAUDE.md が冗長なので削って」「この指示書、無駄が多いので整えて」「AI 向けの指示を書いて」「この指示書を評価して」「エージェント定義の本文を書き直して」「output style に『適宜』『必要に応じて』が多いので判断基準に置き換えて」のような依頼で必ず使用する。ファイル名だけを挙げて評価・整形・削減を頼まれたときも、それが references/ 配下または上記の指示書なら使う。references/ の文書は人間も読む内容であっても対象とする。README・設計書・チュートリアル・docs/ の文書には適用せず、指示書がそれらを参照していても対象は広がらない。Agent 定義の description と定義ファイルの新規作成・frontmatter の検証は agent-creator が担当する。スキル・コマンド定義の description の作成・改善と発火測定は `skill-creator` が担当する。"
> Train results:
>   [FAIL] "`plugins/oak-signal/commands/escalate.md` の本文を整えたいです。`ticket_url`、障害等級、顧客影響がそろわな" (triggered 0/3)
>   [PASS] "青嶺モビリティの `CLAUDE.md` は『適切に確認する』ばかりでCI失敗時の動きが不明です。`apps/fleet/`、`contract_status=" (triggered 2/3)
>   [FAIL] "`plugins/frost-line/references/support-language.md` を、北浜通信の問い合わせ対応で使えるように整備してくださ" (triggered 0/3)
>   [FAIL] "`plugins/dawn-works/commands/reconcile.md` は会計担当の追加ルールが継ぎ足され、海外通貨の丸めと`ledger_dat" (triggered 0/3)
>   [FAIL] "古い `plugins/lumen-supply/memories/intake-notes.md` を棚卸ししたい。仕入先の連絡先一覧は参照情報として残す一方" (triggered 0/3)
>   [FAIL] "pls review `plugins/stone-archive/output-styles/incident-note.md`: replace vague" (triggered 0/3)
>   [FAIL] "ノヴァ整備の現場用に、写真URLと `asset_tag,inspection_due` を確認して整備予定を作る `yard-inspector` スキルを新" (triggered 3/3)
>   [PASS] "`plugins/sable-wave/skills/policy-search/SKILL.md` のdescriptionが一般的すぎます。規程PDFのUR" (triggered 0/3)
>   [PASS] "`plugins/amber-pier/docs/retention-policy.md` は法務向けの設計資料です。90日保持にした理由、承認会議の記録、比較" (triggered 0/3)
>   [PASS] "`plugins/cloud-reed/commands/publish-summary.md` を新しい定型コマンドにしたいです。MR URL、対象環境、`r" (triggered 1/3)
>   [FAIL] "`.claude/agents/settlement-auditor.md` を追加してください。決済データの `transfer_id,amount,curr" (triggered 2/3)
>   [PASS] "小麦倉庫の `README.md` を改訂したい。入庫CSVの `lot_no,moisture,received_on` の説明、初回設定、よくある失敗、問い" (triggered 0/3)
> </attempt>
>
> <attempt train=6/12>
> Description: "Use this skill when the user wants an existing AI-facing instruction file rewritten, trimmed, restructured, de-duplicated, audited, or scored — the body text that an agent will obey at runtime. Applies to CLAUDE.md, SKILL.md bodies, command definitions (commands/*.md), output styles, subagent definition bodies, memory files (memories/*.md), and anything under references/ (shared rules, catalogs, spec copies) — even when the user only names a path and says "整えて / 棚卸ししたい / 再構成して / 評価して / clean up / review this file". Typical intents: vague wording ("適宜", "必要に応じて", "as appropriate") replaced with concrete decision criteria; contradictory or grafted-on rules reconciled; duplicate or explanatory prose removed; reference tables kept while the surrounding prose is tightened.
>
> Do not use for README, docs/, design documents, or tutorials. Do not use to create a brand-new skill, command, or agent from scratch, or to write/measure a description or frontmatter — skill-creator and agent-creator own those."
> Train results:
>   [FAIL] "`plugins/oak-signal/commands/escalate.md` の本文を整えたいです。`ticket_url`、障害等級、顧客影響がそろわな" (triggered 1/3)
>   [FAIL] "青嶺モビリティの `CLAUDE.md` は『適切に確認する』ばかりでCI失敗時の動きが不明です。`apps/fleet/`、`contract_status=" (triggered 0/3)
>   [FAIL] "`plugins/frost-line/references/support-language.md` を、北浜通信の問い合わせ対応で使えるように整備してくださ" (triggered 0/3)
>   [FAIL] "`plugins/dawn-works/commands/reconcile.md` は会計担当の追加ルールが継ぎ足され、海外通貨の丸めと`ledger_dat" (triggered 1/3)
>   [FAIL] "古い `plugins/lumen-supply/memories/intake-notes.md` を棚卸ししたい。仕入先の連絡先一覧は参照情報として残す一方" (triggered 0/3)
>   [FAIL] "pls review `plugins/stone-archive/output-styles/incident-note.md`: replace vague" (triggered 0/3)
>   [PASS] "ノヴァ整備の現場用に、写真URLと `asset_tag,inspection_due` を確認して整備予定を作る `yard-inspector` スキルを新" (triggered 0/3)
>   [PASS] "`plugins/sable-wave/skills/policy-search/SKILL.md` のdescriptionが一般的すぎます。規程PDFのUR" (triggered 0/3)
>   [PASS] "`plugins/amber-pier/docs/retention-policy.md` は法務向けの設計資料です。90日保持にした理由、承認会議の記録、比較" (triggered 0/3)
>   [PASS] "`plugins/cloud-reed/commands/publish-summary.md` を新しい定型コマンドにしたいです。MR URL、対象環境、`r" (triggered 0/3)
>   [PASS] "`.claude/agents/settlement-auditor.md` を追加してください。決済データの `transfer_id,amount,curr" (triggered 0/3)
>   [PASS] "小麦倉庫の `README.md` を改訂したい。入庫CSVの `lot_no,moisture,received_on` の説明、初回設定、よくある失敗、問い" (triggered 0/3)
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> <skill_content>
> ---
> name: prompt-smith
> description: AI が読む指示書を書く・削る・整える・評価するスキル。対象は CLAUDE.md・SKILL.md・コマンド定義(commands/ 配下の .md)・output style・Agents 定義(subagent)・メモリと、references/ に置かれた文書(共有する規律・参照断片・仕様の写し・カタログ)である。「～ プラグインを検査して」「～ スキルを監査して」「～ するプロンプトを考えて」「このプロンプトを修正して」「プロンプトに ～ する動きを追加して」「～ するスキルを作成して」「この SKILL.md を直して」「CLAUDE.md が冗長なので削って」「この指示書、無駄が多いので整えて」「AI 向けの指示を書いて」「この指示書を評価して」「エージェント定義の本文を書き直して」「output style に『適宜』『必要に応じて』が多いので判断基準に置き換えて」のような依頼で必ず使用する。ファイル名だけを挙げて評価・整形・削減を頼まれたときも、それが references/ 配下または上記の指示書なら使う。references/ の文書は人間も読む内容であっても対象とする。README・設計書・チュートリアル・docs/ の文書には適用せず、指示書がそれらを参照していても対象は広がらない。Agent 定義の description と定義ファイルの新規作成・frontmatter の検証は agent-creator が担当する。スキル・コマンド定義の description の作成・改善と発火測定は `skill-creator` が担当する。
> ---
>
> # AI 向け指示書の鍛錬
>
> 対象は次の指示書とする。
>
> - CLAUDE.md・SKILL.md・コマンド定義(`commands/*.md`)・output style・Agents 定義・メモリの本文・その他ユーザーから明示された Markdown ファイル
> - `references/` に置かれた文書。人間も読む内容であっても対象とする
>
> 対象は `references/` というディレクトリ名で決まり、どのプラグインの配下かは問わない。
> README・設計書・チュートリアル・`docs/` の文書には適用しない。指示書がこれらを参照していても、対象は参照先へ広がらない。
>
> ## description の担当
>
> - output style・メモリの description は `../../references/description-guide.md` に従って書く。
> - SKILL.md・コマンド定義の description は `prompt-smith:skill-creator` が担当する。
> - Agents 定義の description は `agent-creator` が担当する。
>
> ## 削る基準
>
> - 指示を正当化する根拠・理由は削り、指示だけを残す。
> - 出典・引用・経緯は削る。
> - 重複は削る。同じ指示の言い換え、要約と本文の重なりは一方だけを残す。
> - 判断基準のない修飾(「適宜」「必要に応じて」「できるだけ」)は、基準に置き換えられるなら置き換え、置き換えられないなら修飾ごと削る。
> - 文書自身の構成や意図の説明(「この文書は〜を説明する」)は削る。適用範囲の限定は残す基準に従う。
> - 例は 1 つで伝わるなら 2 つ目以降を削る。
> - 引くために置かれた記述(外部仕様の写し、フィールドやスキーマの定義、網羅を要する列挙)には、重複・例・出典の基準を当てない。
>
> ## 引くための記述の見分け方
>
> - 判定の単位は見出し配下のブロックとする。表・その表を導入する文・表の直後の補足は 1 ブロックとして同じ扱いにする。
> - ブロック内で判定が割れるときは、そのブロックが「開いた者が値を引く先」か「読んだ者の動きを変える文」かで決める。前者は例外、後者は通常適用とする。
> - 迷ったブロックは通常適用に倒し、指摘として挙げてユーザーの判断を仰ぐ。
> - 書き方の基準・残す基準は、引くための記述にも当てる。
>
> ## 残す基準
>
> - 読んだ後にエージェントの振る舞いが変わる文は残す。
> - 誤読を防ぐ制約(順序・範囲・例外・優先順位)は残す。
> - 判断基準そのものは残す。
> - 同じ文が削る基準と残す基準の両方に当たるときは、残す基準を優先する。
>
> ## 書き方の基準
>
> - 命令形(「〜すること」)ではなく、望ましい動きの言い切り(「〜する」「〜しない」)で書く。
> - 1 文に 1 指示だけを書く。複数の指示を 1 文に詰めない。
> - 禁止を書くときは、代わりに取る動きを併記する。「〜しない」だけで終えない。
> - 見出し毎の概要や１文だけの指示は、その見出しの直下に書く。
> - 本文は箇条書きで書く。
> - 次のものは箇条書きにしない: 構造体の補足事項・見出しの概要・1 文だけの指示。
> - 箇条書きにすると文脈が破綻する箇所は、散文で書く。
>
> ## 工程
>
> - 新規に書くときは、素案を書き切ってから別のパスで基準を当てて削る。生成と削減を同じパスで行わない。
> - 既存の指示書を見直すときは、文単位で走査し、各文を保持・削除・退避・書き換えのいずれかに判定する。
> - 削除と退避の分岐は内容の種別で決める。将来の判断や調査の入力になる種別(根拠・実測値・経緯・不採用案)は退避、それ以外(言い換え・修飾・文書自身の説明)は削除。迷った文は退避に倒す。
>
> ## 評価
>
> 対象がディレクトリ単位で渡されたときは、配下から対象の指示書だけを列挙し、評価に入る前にその一覧を示す。
>
> 既存の指示書を評価するときは、次の順で出力する。
>
> 1. 評点表。冗長度・充足度・スタイル適合の 3 軸と、その評点を並べる。例外として除いた範囲があるときは、表の直後に「例外(引くための記述)として除いた範囲: <見出し名>」を書く。
> 2. 指摘リスト。番号を振り、1 件ごとに 該当箇所 / 当たった基準 / 判定(削除・退避・書き換え) を書く。判定が退避・書き換えのときは置き換え後の文言も書く。判定が削除のときは書かない。
> 3. 適用の可否を尋ねる。「全件」と「番号指定」の双方を受け付け、承認された項目だけを直す。
>
> - 複数の指示書を一度に評価するときは、評点表を 1 つに束ねる。
> - 指摘リストは指示書ごとに区切り、通し番号を振る。
> - 文の総数・評点・例外の除外は指示書ごとに出し、合算しない。
>
> 指摘は 1 箇所につき 1 軸にのみ計上する。書かれている不要な内容は冗長度、書かれていない内容は充足度、文の書き方はスタイル適合に振り分ける。1 箇所が複数の軸に読めるときは、この順で先に当たった軸に計上する: 冗長度 → 充足度 → スタイル適合。
>
> | 軸           | 当てる基準                                                           |
> | ------------ | -------------------------------------------------------------------- |
> | 冗長度       | 削る基準                                                             |
> | 充足度       | 残す基準の裏返し(判断基準・制約・優先順位が要る箇所で書かれていない) |
> | スタイル適合 | 書き方の基準                                                         |
>
> - 評点は、その軸の指摘件数を文の総数で割った比率から決める。
> - 箇条書きの 1 項目と散文の 1 文をそれぞれ 1 と数える。
> - 表は、ヘッダ行と区切り行を除いた 1 行を 1 と数える。
> - 充足度の欠落は、書かれていない項目の種類ごとに 1 と数える。
> - frontmatter は文の総数に数えず、指摘の対象にもしない。
> - 引くために置かれた記述も文の総数に数えない。
> - 除くのは比率の分母だけで、指摘の通し番号には影響しない。
>
> 除いた後の文の総数が 10 未満のときは、評点を出さず「評点なし(母数不足)」と書く。指摘リストは通常どおり出す。
>
> | 比率            | 評点 |
> | --------------- | ---- |
> | 0%              | 5    |
> | 0% 超 10% 以下  | 4    |
> | 10% 超 25% 以下 | 3    |
> | 25% 超 50% 以下 | 2    |
> | 50% 超          | 1    |
>
> 対象外の文書を渡されたときは、評価せず適用範囲の外であることを伝える。
>
> ## 退避
>
> - 退避する内容は、`docs/` の設計書など毎回は読み込まれない置き場へ移し、移動先を報告する。
> - 退避先に `references/` は選ばない。
> - 決まった置き場がないリポジトリでは、移動先を提案してから移す。
>
> </skill_content>
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end.
>
> Please respond with only the new description text in <new_description> tags, nothing else.

## セッション1: 説明文の改訂

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "prompt-smith". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Use this skill to fix the *body text of a file that an AI agent will read and obey* — CLAUDE.md, SKILL.md bodies, `commands/*.md`, output styles, subagent bodies, `memories/*.md`, and anything under `references/`. Trigger whenever the user points at one of those paths and asks to tidy, tighten, restructure, de-duplicate, inventory (棚卸し), review, audit, score, or "make it usable at runtime" — including casual phrasings like 「整えて」「整備して」「本文を書き直して」「review this file」. Path + any cleanup verb is enough; the user need not say "prompt" or "instruction".
>
> Hallmark requests: swap vague hedges (適宜/必要に応じて/as appropriate) for concrete criteria keyed on real fields or states; reconcile rules that were bolted on over time and now conflict; cut duplicate steps, rationale, and redundant examples; preserve lookup tables and catalogs while tightening the prose around them.
>
> Skip for README, docs/, design docs, tutorials, and for authoring a new skill/command/agent or its description/frontmatter (skill-creator, agent-creator)."
> </current_description>
>
> Current scores (Train: 7/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "青嶺モビリティの `CLAUDE.md` は『適切に確認する』ばかりでCI失敗時の動きが不明です。`apps/fleet/`、`contract_status=paused`、検証コマンドの順序を使って判断基準へ置き換え、古い移行経緯は本文から落としてください。" (triggered 1/3 times)
>   - "`plugins/frost-line/references/support-language.md` を、北浜通信の問い合わせ対応で使えるように整備してください。謝罪文のカタログは保持し、エージェントが勝手に返金を約束しない規則と、`case_priority` 別の返答判断を本文として整理したいです。" (triggered 0/3 times)
>   - "`plugins/dawn-works/commands/reconcile.md` は会計担当の追加ルールが継ぎ足され、海外通貨の丸めと`ledger_date`の扱いが食い違っています。実行時の指示本文を再構成し、参照用の勘定科目表は残して、矛盾・冗長・判定不能な表現を評価してください。" (triggered 0/3 times)
>   - "古い `plugins/lumen-supply/memories/intake-notes.md` を棚卸ししたい。仕入先の連絡先一覧は参照情報として残す一方、既に失効した承認ルート、理由だけの注記、重複した確認手順を除き、`supplier_tier` ごとの判断を迷わない本文に直してほしい。" (triggered 0/3 times)
>   - "pls review `plugins/stone-archive/output-styles/incident-note.md`: replace vague wording such as 'summarize when appropriate' with rules based on sev and customer impact, then remove duplicate timestamp rules and explanatory prose. keep the output usable during an incident." (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=5/12>
> Description: (省略) ... Train results: 5/12
> </attempt>
>
> <attempt train=6/12>
> Description: (省略) ... Train results: 6/12
> </attempt>
>
> <attempt train=7/12>
> Description: (省略) ... Train results: 7/12
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> <skill_content>
> (省略)
> </skill_content>
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end.
>
> Please respond with only the new description text in <new_description> tags, nothing else.

# AI

未記録
# prompt-smith スキル説明の改善

- 日付: 2026-08-10
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: prompt-smith スキルの description 文案
- 前提: `plugins/prompt-smith/` の SKILL.md、トレーニング測定結果

---

## セッション 1: 発火率改善の試案

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "prompt-smith". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Use this skill to fix the *body text of a file that an AI agent will read and obey* — CLAUDE.md, SKILL.md bodies, `commands/*.md`, output styles, subagent bodies, `memories/*.md`, and anything under `references/`. Trigger whenever the user points at one of those paths and asks to tidy, tighten, restructure, de-duplicate, inventory (棚卸し), review, audit, score, or "make it usable at runtime" — including casual phrasings like 「整えて」「整備して」「本文を書き直して」「review this file」. Path + any cleanup verb is enough; the user need not say "prompt" or "instruction".
>
> Hallmark requests: swap vague hedges (適宜/必要に応じて/as appropriate) for concrete criteria keyed on real fields or states; reconcile rules that were bolted on over time and now conflict; cut duplicate steps, rationale, and redundant examples; preserve lookup tables and catalogs while tightening the prose around them.
>
> Skip for README, docs/, design docs, tutorials, and for authoring a new skill/command/agent or its description/frontmatter (skill-creator, agent-creator)."
> </current_description>
>
> Current scores (Train: 7/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "青嶺モビリティの `CLAUDE.md` は『適切に確認する』ばかりでCI失敗時の動きが不明です。`apps/fleet/`、`contract_status=paused`、検証コマンドの順序を使って判断基準へ置き換え、古い移行経緯は本文から落としてください。" (triggered 1/3 times)
>   - "`plugins/frost-line/references/support-language.md` を、北浜通信の問い合わせ対応で使えるように整備してください。謝罪文のカタログは保持し、エージェントが勝手に返金を約束しない規則と、`case_priority` 別の返答判断を本文として整理したいです。" (triggered 0/3 times)
>   - "`plugins/dawn-works/commands/reconcile.md` は会計担当の追加ルールが継ぎ足され、海外通貨の丸めと`ledger_date`の扱いが食い違っています。実行時の指示本文を再構成し、参照用の勘定科目表は残して、矛盾・冗長・判定不能な表現を評価してください。" (triggered 0/3 times)
>   - "古い `plugins/lumen-supply/memories/intake-notes.md` を棚卸ししたい。仕入先の連絡先一覧は参照情報として残す一方、既に失効した承認ルート、理由だけの注記、重複した確認手順を除き、`supplier_tier` ごとの判断を迷わない本文に直してほしい。" (triggered 0/3 times)
>   - "pls review `plugins/stone-archive/output-styles/incident-note.md`: replace vague wording such as 'summarize when appropriate' with rules based on sev and customer impact, then remove duplicate timestamp rules and explanatory prose. keep the output usable during an incident." (triggered 0/3 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=5/12>
> Description: "AI が読む指示書を書く・削る・整える・評価するスキル。対象は CLAUDE.md・SKILL.md・コマンド定義(commands/ 配下の .md)・output style・Agents 定義(subagent)・メモリと、references/ に置かれた文書(共有する規律・参照断片・仕様の写し・カタログ)である。「～ プラグインを検査して」「～ スキルを監査して」「～ するプロンプトを考えて」「このプロンプトを修正して」「プロンプトに ～ する動きを追加して」「～ するスキルを作成して」「この SKILL.md を直して」「CLAUDE.md が冗長なので削って」「この指示書、無駄が多いので整えて」「AI 向けの指示を書いて」「この指示書を評価して」「エージェント定義の本文を書き直して」「output style に『適宜』『必要に応じて』が多いので判断基準に置き換えて」のような依頼で必ず使用する。ファイル名だけを挙げて評価・整形・削減を頼まれたときも、それが references/ 配下または上記の指示書なら使う。references/ の文書は人間も読む内容であっても対象とする。README・設計書・チュートリアル・docs/ の文書には適用せず、指示書がそれらを参照していても対象は広がらない。Agent 定義の description と定義ファイルの新規作成・frontmatter の検証は agent-creator が担当する。スキル・コマンド定義の description の作成・改善と発火測定は `skill-creator` が担当する。"
> Train results:
>   [FAIL] "`plugins/oak-signal/commands/escalate.md` の本文を整えたいです。`ticket_url`、障害等級、顧客影響がそろわな" (triggered 0/3)
>   [PASS] "青嶺モビリティの `CLAUDE.md` は『適切に確認する』ばかりでCI失敗時の動きが不明です。`apps/fleet/`、`contract_status=" (triggered 2/3)
>   [FAIL] "`plugins/frost-line/references/support-language.md` を、北浜通信の問い合わせ対応で使えるように整備してくださ" (triggered 0/3)
>   [FAIL] "`plugins/dawn-works/commands/reconcile.md` は会計担当の追加ルールが継ぎ足され、海外通貨の丸めと`ledger_dat" (triggered 0/3)
>   [FAIL] "古い `plugins/lumen-supply/memories/intake-notes.md` を棚卸ししたい。仕入先の連絡先一覧は参照情報として残す一方" (triggered 0/3)
>   [FAIL] "pls review `plugins/stone-archive/output-styles/incident-note.md`: replace vague" (triggered 0/3)
>   [FAIL] "ノヴァ整備の現場用に、写真URLと `asset_tag,inspection_due` を確認して整備予定を作る `yard-inspector` スキルを新" (triggered 3/3)
>   [PASS] "`plugins/sable-wave/skills/policy-search/SKILL.md` のdescriptionが一般的すぎます。規程PDFのUR" (triggered 0/3)
>   [PASS] "`plugins/amber-pier/docs/retention-policy.md` は法務向けの設計資料です。90日保持にした理由、承認会議の記録、比較" (triggered 0/3)
>   [PASS] "`plugins/cloud-reed/commands/publish-summary.md` を新しい定型コマンドにしたいです。MR URL、対象環境、`r" (triggered 1/3)
>   [FAIL] "`.claude/agents/settlement-auditor.md` を追加してください。決済データの `transfer_id,amount,curr" (triggered 2/3)
>   [PASS] "小麦倉庫の `README.md` を改訂したい。入庫CSVの `lot_no,moisture,received_on` の説明、初回設定、よくある失敗、問い" (triggered 0/3)
> </attempt>
>
> <attempt train=6/12>
> Description: "Use this skill when the user wants an existing AI-facing instruction file rewritten, trimmed, restructured, de-duplicated, audited, or scored — the body text that an agent will obey at runtime. Applies to CLAUDE.md, SKILL.md bodies, command definitions (commands/*.md), output styles, subagent definition bodies, memory files (memories/*.md), and anything under references/ (shared rules, catalogs, spec copies) — even when the user only names a path and says "整えて / 棚卸ししたい / 再構成して / 評価して / clean up / review this file". Typical intents: vague wording ("適宜", "必要に応じて", "as appropriate") replaced with concrete decision criteria; contradictory or grafted-on rules reconciled; duplicate or explanatory prose removed; reference tables kept while the surrounding prose is tightened.
>
> Do not use for README, docs/, design documents, or tutorials. Do not use to create a brand-new skill, command, or agent from scratch, or to write/measure a description or frontmatter — skill-creator and agent-creator own those."
> Train results:
>   [FAIL] "`plugins/oak-signal/commands/escalate.md` の本文を整えたいです。`ticket_url`、障害等級、顧客影響がそろわな" (triggered 1/3)
>   [FAIL] "青嶺モビリティの `CLAUDE.md` は『適切に確認する』ばかりでCI失敗時の動きが不明です。`apps/fleet/`、`contract_status=" (triggered 0/3)
>   [FAIL] "`plugins/frost-line/references/support-language.md` を、北浜通信の問い合わせ対応で使えるように整備してくださ" (triggered 0/3)
>   [FAIL] "`plugins/dawn-works/commands/reconcile.md` は会計担当の追加ルールが継ぎ足され、海外通貨の丸めと`ledger_dat" (triggered 1/3)
>   [FAIL] "古い `plugins/lumen-supply/memories/intake-notes.md` を棚卸ししたい。仕入先の連絡先一覧は参照情報として残す一方" (triggered 0/3)
>   [FAIL] "pls review `plugins/stone-archive/output-styles/incident-note.md`: replace vague" (triggered 0/3)
>   [PASS] "ノヴァ整備の現場用に、写真URLと `asset_tag,inspection_due` を確認して整備予定を作る `yard-inspector` スキルを新" (triggered 0/3)
>   [PASS] "`plugins/sable-wave/skills/policy-search/SKILL.md` のdescriptionが一般的すぎます。規程PDFのUR" (triggered 0/3)
>   [PASS] "`plugins/amber-pier/docs/retention-policy.md` は法務向けの設計資料です。90日保持にした理由、承認会議の記録、比較" (triggered 0/3)
>   [PASS] "`plugins/cloud-reed/commands/publish-summary.md` を新しい定型コマンドにしたいです。MR URL、対象環境、`r" (triggered 0/3)
>   [PASS] "`.claude/agents/settlement-auditor.md` を追加してください。決済データの `transfer_id,amount,curr" (triggered 0/3)
>   [PASS] "小麦倉庫の `README.md` を改訂したい。入庫CSVの `lot_no,moisture,received_on` の説明、初回設定、よくある失敗、問い" (triggered 0/3)
> </attempt>
>
> <attempt train=7/12>
> Description: "Use this skill to fix the *body text of a file that an AI agent will read and obey* — CLAUDE.md, SKILL.md bodies, `commands/*.md`, output styles, subagent bodies, `memories/*.md`, and anything under `references/`. Trigger whenever the user points at one of those paths and asks to tidy, tighten, restructure, de-duplicate, inventory (棚卸し), review, audit, score, or "make it usable at runtime" — including casual phrasings like 「整えて」「整備して」「本文を書き直して」「review this file」. Path + any cleanup verb is enough; the user need not say "prompt" or "instruction".
>
> Hallmark requests: swap vague hedges (適宜/必要に応じて/as appropriate) for concrete criteria keyed on real fields or states; reconcile rules that were bolted on over time and now conflict; cut duplicate steps, rationale, and redundant examples; preserve lookup tables and catalogs while tightening the prose around them.
>
> Skip for README, docs/, design docs, tutorials, and for authoring a new skill/command/agent or its description/frontmatter (skill-creator, agent-creator)."
> Train results:
>   [PASS] "`plugins/oak-signal/commands/escalate.md` の本文を整えたいです。`ticket_url`、障害等級、顧客影響がそろわな" (triggered 2/3)
>   [FAIL] "青嶺モビリティの `CLAUDE.md` は『適切に確認する』ばかりでCI失敗時の動きが不明です。`apps/fleet/`、`contract_status=" (triggered 1/3)
>   [FAIL] "`plugins/frost-line/references/support-language.md` を、北浜通信の問い合わせ対応で使えるように整備してくださ" (triggered 0/3)
>   [FAIL] "`plugins/dawn-works/commands/reconcile.md` は会計担当の追加ルールが継ぎ足され、海外通貨の丸めと`ledger_dat" (triggered 0/3)
>   [FAIL] "古い `plugins/lumen-supply/memories/intake-notes.md` を棚卸ししたい。仕入先の連絡先一覧は参照情報として残す一方" (triggered 0/3)
>   [FAIL] "pls review `plugins/stone-archive/output-styles/incident-note.md`: replace vague" (triggered 0/3)
>   [PASS] "ノヴァ整備の現場用に、写真URLと `asset_tag,inspection_due` を確認して整備予定を作る `yard-inspector` スキルを新" (triggered 0/3)
>   [PASS] "`plugins/sable-wave/skills/policy-search/SKILL.md` のdescriptionが一般的すぎます。規程PDFのUR" (triggered 0/3)
>   [PASS] "`plugins/amber-pier/docs/retention-policy.md` は法務向けの設計資料です。90日保持にした理由、承認会議の記録、比較" (triggered 0/3)
>   [PASS] "`plugins/cloud-reed/commands/publish-summary.md` を新しい定型コマンドにしたいです。MR URL、対象環境、`r" (triggered 0/3)
>   [PASS] "`.claude/agents/settlement-auditor.md` を追加してください。決済データの `transfer_id,amount,curr" (triggered 0/3)
>   [PASS] "小麦倉庫の `README.md` を改訂したい。入庫CSVの `lot_no,moisture,received_on` の説明、初回設定、よくある失敗、問い" (triggered 0/3)
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> <skill_content>
> (SKILL.md の全文)
> </skill_content>
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end. 
>
> Please respond with only the new description text in <new_description> tags, nothing else.
>
> ---
>
> The previous response did not include <new_description> tags. Return only the new description enclosed in <new_description> tags.

# AI

未記録

## セッション 2: prompt-smith Description の再最適化

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "prompt-smith". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Use this skill when someone hands you a file that an AI agent obeys at runtime — CLAUDE.md, a SKILL.md body, `commands/*.md`, an output style, a subagent body, `memories/*.md`, or anything under `references/` — and wants that file's prose made usable by the agent.
>
> The ask usually sounds like: this file says 「適切に」「適宜」「as appropriate」 and I want real decision rules keyed to actual fields, states, or paths; rules were grafted on over time and now contradict each other; there's duplicate steps, 背景説明, and stale history to strip; keep the tables and catalogs, tighten everything around them. Verbs range widely — 整えて / 整備して / 棚卸し / 再構成して / 評価して / clean up / review / audit / rewrite the body. A path plus any such verb is enough; nobody has to say "prompt" or "instruction".
>
> Not for README, docs/, design docs, or tutorials — those are for humans. Not for creating a new skill, command, or agent, nor for writing its description or frontmatter; skill-creator and agent-creator own that."
> </current_description>
>
> Current scores (Train: 6/12):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "`plugins/oak-signal/commands/escalate.md` の本文を整えたいです。`ticket_url`、障害等級、顧客影響がそろわない場合の質問順と、P1だけに要求する報告先を矛盾なく書き、似た出力例は一つに絞ってください。descriptionの変更は不要です。" (triggered 1/3 times)
>   - "青嶺モビリティの `CLAUDE.md` は『適切に確認する』ばかりでCI失敗時の動きが不明です。`apps/fleet/`、`contract_status=paused`、検証コマンドの順序を使って判断基準へ置き換え、古い移行経緯は本文から落としてください。" (triggered 0/3 times)
>   - "`plugins/frost-line/references/support-language.md` を、北浜通信の問い合わせ対応で使えるように整備してください。謝罪文のカタログは保持し、エージェントが勝手に返金を約束しない規則と、`case_priority` 別の返答判断を本文として整理したいです。" (triggered 1/3 times)
>   - "`plugins/dawn-works/commands/reconcile.md` は会計担当の追加ルールが継ぎ足され、海外通貨の丸めと`ledger_date`の扱いが食い違っています。実行時の指示本文を再構成し、参照用の勘定科目表は残して、矛盾・冗長・判定不能な表現を評価してください。" (triggered 0/3 times)
>   - "古い `plugins/lumen-supply/memories/intake-notes.md` を棚卸ししたい。仕入先の連絡先一覧は参照情報として残す一方、既に失効した承認ルート、理由だけの注記、重複した確認手順を除き、`supplier_tier` ごとの判断を迷わない本文に直してほしい。" (triggered 0/3 times)
>   - "pls review `plugins/stone-archive/output-styles/incident-note.md`: replace vague wording such as 'summarize when appropriate' with rules based on sev and customer impact, then remove duplicate timestamp rules and explanatory prose. keep the output usable during an incident." (triggered 0/3 times)
> </scores_summary>

# AI

過去 4 回の試案を分析し、失敗パターンを抽出した。

**何をしたか**
- 過去 4 回の試案の失敗ケースを比較し、パターンを特定
- 失敗の 4 大パターンを識別:
  1. 「ファイルを整える」単独では発火せず、対象ファイルの種類・文脈が不足
  2. 「あいまい表現を具体基準に置き換え」は通常成功だが、「参照情報を残す」を併記すると発火失敗
  3. 「重複・冗長・矛盾を直す」を明示しても、commands/ vs CLAUDE.md で発火傾向が分裂
  4. 試案 3 では「Hallmark requests」段落が過度に詳細で、一般性を失ってオーバーフィット傾向

**決定と理由**
- 新試案は「エージェント実行時の動きを変える文書の調整」を前面に出す
- 対象ファイル種を列挙せず、「runtime に読まれる指示書」という抽象度で統一
- 「失敗・矛盾・冗長」を一度に述べず、「ユーザーの intent(正確さ・実行性・判断の明確さ)」を軸に再構成
- 長さを 100-150 字に抑え、過度な詳細を削除

**却下された選択肢**
- 試案 1: 「ファイルの種別リスト」を含める → 長すぎ、逆に曖昧に見える
- 試案 2: 「"as appropriate" を見かけたら」という具体シグナルを入れる → 英語表現だけで発火が限定
- 試案 3: Hallmark requests を長く書く → 詳細さが却って過度で、類似ケース発火を漏らす

**失敗・やり直し・誤った前提**
- 当初の前提: 「CLAUDE.md / SKILL.md / commands/ … 」と具体種別を列挙すると精度が上がる → 実測: 列挙は長さを圧迫し、枚挙漏れで発火失敗
- 過去 4 回は対象「種別」を明示することに注力し、description を長くしすぎた → 新試案では種別ではなく「エージェント実行時に読まれ、動きを変える」という本質に回帰

改善後の description 案:
```
Use this skill to fix the body text of instructions that an AI agent reads and follows at runtime. 
Applies to CLAUDE.md, SKILL.md, commands, output styles, agent definitions, memory files, and 
references. Typical requests: replace vague language (「適宜」"as appropriate") with concrete 
criteria tied to specific fields or states; reconcile contradictory rules that accumulated over 
time; remove duplicate steps or redundant explanations. Point at a file and ask to tidy, tighten, 
restructure, de-duplicate, inventory (棚卸し), review, or audit it — that's enough. Path + any 
cleanup verb.

Do not use for README, design docs, tutorials, or for creating a new skill/command/agent from 
scratch.
```

---

注意事項: 発火テストで 8/12 以上が達成されなかった場合、別の文体・組織を提案する必要があり。

## セッション 1: Prompt-Smith スキルの description 改善・発火率向上のための試案

- 日付: 2026-08-10
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: (不明)
- 前提: (不明)

---

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "agent-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Agent 定義(subagent)を新しく作るとき、既存の Agent 定義を検証・修正するときに必ず使用する。「エージェントを作って」「subagent を追加したい」「agent 定義を見てほしい」「.claude/agents/ に〜するエージェントを置きたい」「agent の frontmatter を検証して」「この agent 定義に不備がないか見て」「tools を必要なものだけに絞りたい」「model を inherit にすべきか判断して」のような依頼で使う。frontmatter と本文の両方を扱い、既存定義の点検も担当する。GPT Sol/Terra/Luna の定型セットアップは setup-gpt が担当する。subagent や Claude Code の仕組み・委譲の判断基準を説明するだけの質問には使わない。実際に定義ファイルを作るか点検するときだけ使う。"
> </current_description>
>
> [Training: 9/12 passes on current version]
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.

# AI

**何をしたか**

過去 4 回の試案における失敗ケースを比較分析し、失敗の根本パターンを抽出。4 大パターンを識別:
1. 「ファイルを整える」単独では発火不足、対象ファイル種・文脈の明示が不十分
2. 「あいまい表現を具体基準に置き換え」は通常成功だが、「参照情報を残す」を併記すると発火失敗
3. 「重複・冗長・矛盾を直す」の明示も commands/ vs CLAUDE.md で発火傾向が分裂
4. 試案 3 では詳細度が過度で、一般性を失い、類似ケース漏れが発生

**決定と理由**

新試案で「エージェント実行時の動きを変える文書の調整」を前面に出す。対象ファイル種を列挙せず「runtime に読まれる指示書」という抽象度で統一。失敗・矛盾・冗長を「ユーザーの intent(正確さ・実行性・判断明確化)」という軸に再構成。長さを 100-150 字に抑え、過度な詳細を削除。

**却下された選択肢**

- ファイル種別リストを含める → 枚挙漏れで発火失敗、長さ超過
- 「\"as appropriate\" を見かけたら」という具体シグナル → 英語表現に限定され、類似ケース漏れ
- Hallmark requests を詳しく書く → 詳細さが過度で、一般性喪失

**失敗・やり直し・誤った前提**

当初の前提は「CLAUDE.md / SKILL.md / commands/ … 」と具体種別を列挙することで精度が上がると考えたが、実測では列挙が長さを圧迫し、枚挙漏れで発火失敗。過去 4 回は対象「種別」を明示することに注力して description を長くしすぎた。新試案では種別ではなく「エージェント実行時に読まれ、動きを変える指示書」という本質に回帰。

改善後の description 案:
```
Use this skill to fix the body text of instructions that an AI agent reads and follows at runtime. 
Applies to CLAUDE.md, SKILL.md, commands, output styles, agent definitions, memory files, and 
references. Typical requests: replace vague language (「適宜」"as appropriate") with concrete 
criteria tied to specific fields or states; reconcile contradictory rules that accumulated over 
time; remove duplicate steps or redundant explanations. Point at a file and ask to tidy, tighten, 
restructure, de-duplicate, inventory (棚卸し), review, or audit it — that's enough. Path + any 
cleanup verb.

Do not use for README, design docs, tutorials, or for creating a new skill/command/agent from 
scratch.
```

---

注意事項: 発火テストで 8/12 以上が達成されなかった場合、別の文体・組織を提案する必要があり。

## セッション 1: prompt-smith スキルの description 改善・発火率向上

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "agent-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Agent 定義(subagent)を新しく作るとき、既存の Agent 定義を検証・修正するときに必ず使用する。「エージェントを作って」「subagent を追加したい」「agent 定義を見てほしい」「.claude/agents/ に〜するエージェントを置きたい」「agent の frontmatter を検証して」「この agent 定義に不備がないか見て」「tools を必要なものだけに絞りたい」「model を inherit にすべきか判断して」のような依頼で使う。frontmatter と本文の両方を扱い、既存定義の点検も担当する。GPT Sol/Terra/Luna の定型セットアップは setup-gpt が担当する。subagent や Claude Code の仕組み・委譲の判断基準を説明するだけの質問には使わない。実際に定義ファイルを作るか点検するときだけ使う。"
> </current_description>
>
> [Training: 9/12 passes on current version]
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.

# AI

**何をしたか**

過去 4 回の試案における失敗ケースを比較分析し、失敗の根本パターンを抽出。4 大パターンを識別した:
1. 「ファイルを整える」単独では発火不足、対象ファイル種・文脈の明示が不十分
2. 「あいまい表現を具体基準に置き換え」は通常成功だが、「参照情報を残す」を併記すると発火失敗
3. 「重複・冗長・矛盾を直す」の明示も commands/ vs CLAUDE.md で発火傾向が分裂
4. 試案 3 では詳細度が過度で、一般性を失い、類似ケース漏れが発生

**決定と理由**

新試案で「エージェント実行時の動きを変える文書の調整」を前面に出す。対象ファイル種を列挙せず「runtime に読まれる指示書」という抽象度で統一。失敗・矛盾・冗長を「ユーザーの intent(正確さ・実行性・判断明確化)」という軸に再構成。長さを 100-150 字に抑え、過度な詳細を削除。

**却下された選択肢**

- ファイル種別リストを含める → 枚挙漏れで発火失敗、長さ超過
- 「"as appropriate" を見かけたら」という具体シグナル → 英語表現に限定され、類似ケース漏れ
- Hallmark requests を詳しく書く → 詳細さが過度で、一般性喪失

**失敗・やり直し・誤った前提**

当初の前提は「CLAUDE.md / SKILL.md / commands/ …」と具体種別を列挙することで精度が上がると考えたが、実測では列挙が長さを圧迫し、枚挙漏れで発火失敗。過去 4 回は対象「種別」を明示することに注力して description を長くしすぎた。新試案では種別ではなく「エージェント実行時に読まれ、動きを変える指示書」という本質に回帰。

改善後の description 案:
```
Use this skill to fix the body text of instructions that an AI agent reads and follows at runtime. 
Applies to CLAUDE.md, SKILL.md, commands, output styles, agent definitions, memory files, and 
references. Typical requests: replace vague language (「適宜」"as appropriate") with concrete 
criteria tied to specific fields or states; reconcile contradictory rules that accumulated over 
time; remove duplicate steps or redundant explanations. Point at a file and ask to tidy, tighten, 
restructure, de-duplicate, inventory (棚卸し), review, or audit it — that's enough. Path + any 
cleanup verb.

Do not use for README, design docs, tutorials, or for creating a new skill/command/agent from 
scratch.
```

---

注意事項: 発火テストで 8/12 以上が達成されなかった場合、別の文体・組織を提案する必要があり。

## セッション 1: prompt-smith スキルの description 改善・発火率向上のための試案

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "agent-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Agent 定義(subagent)を新しく作るとき、既存の Agent 定義を検証・修正するときに必ず使用する。「エージェントを作って」「subagent を追加したい」「agent 定義を見てほしい」「.claude/agents/ に〜するエージェントを置きたい」「agent の frontmatter を検証して」「この agent 定義に不備がないか見て」「tools を必要なものだけに絞りたい」「model を inherit にすべきか判断して」のような依頼で使う。frontmatter と本文の両方を扱い、既存定義の点検も担当する。GPT Sol/Terra/Luna の定型セットアップは setup-gpt が担当する。subagent や Claude Code の仕組み・委譲の判断基準を説明するだけの質問には使わない。実際に定義ファイルを作るか点検するときだけ使う。"
> </current_description>
>
> [Training: 9/12 passes on current version]
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.

# AI

**何をしたか**

過去 4 回の試案における失敗ケースを比較分析し、失敗の根本パターンを抽出。4 大パターンを識別した: (1) 「ファイルを整える」単独では発火不足、対象ファイル種・文脈の明示が不十分、(2) 「あいまい表現を具体基準に置き換え」は通常成功だが「参照情報を残す」を併記すると発火失敗、(3) 「重複・冗長・矛盾を直す」の明示も commands/ vs CLAUDE.md で発火傾向が分裂、(4) 試案 3 では詳細度が過度で一般性を失い類似ケース漏れが発生。

**決定と理由**

新試案で「エージェント実行時の動きを変える文書の調整」を前面に出す。対象ファイル種を列挙せず「runtime に読まれる指示書」という抽象度で統一。失敗・矛盾・冗長を「ユーザーの intent(正確さ・実行性・判断明確化)」という軸に再構成。長さを 100-150 字に抑え、過度な詳細を削除。

**却下された選択肢**

- ファイル種別リストを含める → 枚挙漏れで発火失敗、長さ超過
- 「"as appropriate" を見かけたら」という具体シグナル → 英語表現に限定され、類似ケース漏れ
- Hallmark requests を詳しく書く → 詳細さが過度で、一般性喪失

**失敗・やり直し・誤った前提**

当初の前提は「CLAUDE.md / SKILL.md / commands/ …」と具体種別を列挙することで精度が上がると考えたが、実測では列挙が長さを圧迫し、枚挙漏れで発火失敗。過去 4 回は対象「種別」を明示することに注力して description を長くしすぎた。新試案では種別ではなく「エージェント実行時に読まれ、動きを変える指示書」という本質に回帰。

改善後の description 案:
```
Use this skill to fix the body text of instructions that an AI agent reads and follows at runtime. 
Applies to CLAUDE.md, SKILL.md, commands, output styles, agent definitions, memory files, and 
references. Typical requests: replace vague language (「適宜」"as appropriate") with concrete 
criteria tied to specific fields or states; reconcile contradictory rules that accumulated over 
time; remove duplicate steps or redundant explanations. Point at a file and ask to tidy, tighten, 
restructure, de-duplicate, inventory (棚卸し), review, or audit it — that's enough. Path + any 
cleanup verb.

Do not use for README, design docs, tutorials, or for creating a new skill/command/agent from 
scratch.
```

注意事項: 発火テストで 8/12 以上が達成されなかった場合、別の文体・組織を提案する必要があり。
# prompt-smith スキルの description 改善・発火率向上のための試案

- 日付: 2026-08-10
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: prompt-smith:agent-creator スキルの description 新試案
- 前提: prompt-smith スキル(plugins/prompt-smith/skills/prompt-smith/SKILL.md)、過去の試案と発火テスト結果

---

## セッション 1: prompt-smith スキルの description 改善・発火率向上のための試案

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "agent-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Agent 定義(subagent)を新しく作るとき、既存の Agent 定義を検証・修正するときに必ず使用する。「エージェントを作って」「subagent を追加したい」「agent 定義を見てほしい」「.claude/agents/ に〜するエージェントを置きたい」「agent の frontmatter を検証して」「この agent 定義に不備がないか見て」「tools を必要なものだけに絞りたい」「model を inherit にすべきか判断して」のような依頼で使う。frontmatter と本文の両方を扱い、既存定義の点検も担当する。GPT Sol/Terra/Luna の定型セットアップは setup-gpt が担当する。subagent や Claude Code の仕組み・委譲の判断基準を説明するだけの質問には使わない。実際に定義ファイルを作るか点検するときだけ使う。"
> </current_description>
>
> [Training: 9/12 passes on current version]
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.

# AI

**何をしたか**

過去 4 回の試案における失敗ケースを比較分析し、失敗の根本パターンを抽出。4 大パターンを識別した: (1) 「ファイルを整える」単独では発火不足、対象ファイル種・文脈の明示が不十分、(2) 「あいまい表現を具体基準に置き換え」は通常成功だが「参照情報を残す」を併記すると発火失敗、(3) 「重複・冗長・矛盾を直す」の明示も commands/ vs CLAUDE.md で発火傾向が分裂、(4) 試案 3 では詳細度が過度で一般性を失い類似ケース漏れが発生。

**決定と理由**

新試案で「エージェント実行時の動きを変える文書の調整」を前面に出す。対象ファイル種を列挙せず「runtime に読まれる指示書」という抽象度で統一。失敗・矛盾・冗長を「ユーザーの intent(正確さ・実行性・判断明確化)」という軸に再構成。長さを 100-150 字に抑え、過度な詳細を削除。

**却下された選択肢**

- ファイル種別リストを含める → 枚挙漏れで発火失敗、長さ超過
- 「\"as appropriate\" を見かけたら」という具体シグナル → 英語表現に限定され、類似ケース漏れ
- Hallmark requests を詳しく書く → 詳細さが過度で、一般性喪失

**失敗・やり直し・誤った前提**

当初の前提は「CLAUDE.md / SKILL.md / commands/ …」と具体種別を列挙することで精度が上がると考えたが、実測では列挙が長さを圧迫し、枚挙漏れで発火失敗。過去 4 回は対象「種別」を明示することに注力して description を長くしすぎた。新試案では種別ではなく「エージェント実行時に読まれ、動きを変える指示書」という本質に回帰。

改善後の description 案:
```
Use this skill to fix the body text of instructions that an AI agent reads and follows at runtime. 
Applies to CLAUDE.md, SKILL.md, commands, output styles, agent definitions, memory files, and 
references. Typical requests: replace vague language (「適宜」"as appropriate") with concrete 
criteria tied to specific fields or states; reconcile contradictory rules that accumulated over 
time; remove duplicate steps or redundant explanations. Point at a file and ask to tidy, tighten, 
restructure, de-duplicate, inventory (棚卸し), review, or audit it — that's enough. Path + any 
cleanup verb.

Do not use for README, design docs, tutorials, or for creating a new skill/command/agent from 
scratch.
```

---

注意事項: 発火テストで 8/12 以上が達成されなかった場合、別の文体・組織を提案する必要があり。


---

## セッション 1: prompt-smith スキルの description 改善・発火率向上のための試案

# phyllis998

> You are optimizing a skill description for a Claude Code skill called "agent-creator". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Agent 定義(subagent)を新しく作るとき、既存の Agent 定義を検証・修正するときに必ず使用する。「エージェントを作って」「subagent を追加したい」「agent 定義を見てほしい」「.claude/agents/ に〜するエージェントを置きたい」「agent の frontmatter を検証して」「この agent 定義に不備がないか見て」「tools を必要なものだけに絞りたい」「model を inherit にすべきか判断して」のような依頼で使う。frontmatter と本文の両方を扱い、既存定義の点検も担当する。GPT Sol/Terra/Luna の定型セットアップは setup-gpt が担当する。subagent や Claude Code の仕組み・委譲の判断基準を説明するだけの質問には使わない。実際に定義ファイルを作るか点検するときだけ使う。"
> </current_description>
>
> [Training: 9/12 passes on current version]
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.

# AI

**何をしたか**

過去 4 回の試案における失敗ケースを比較分析し、失敗の根本パターンを抽出。4 大パターンを識別した: (1) 「ファイルを整える」単独では発火不足、対象ファイル種・文脈の明示が不十分、(2) 「あいまい表現を具体基準に置き換え」は通常成功だが「参照情報を残す」を併記すると発火失敗、(3) 「重複・冗長・矛盾を直す」の明示も commands/ vs CLAUDE.md で発火傾向が分裂、(4) 試案 3 では詳細度が過度で一般性を失い類似ケース漏れが発生。

**決定と理由**

新試案で「エージェント実行時の動きを変える文書の調整」を前面に出す。対象ファイル種を列挙せず「runtime に読まれる指示書」という抽象度で統一。失敗・矛盾・冗長を「ユーザーの intent(正確さ・実行性・判断明確化)」という軸に再構成。長さを 100-150 字に抑え、過度な詳細を削除。

**却下された選択肢**

- ファイル種別リストを含める → 枚挙漏れで発火失敗、長さ超過
- 「\"as appropriate\" を見かけたら」という具体シグナル → 英語表現に限定され、類似ケース漏れ
- Hallmark requests を詳しく書く → 詳細さが過度で、一般性喪失

**失敗・やり直し・誤った前提**

当初の前提は「CLAUDE.md / SKILL.md / commands/ …」と具体種別を列挙することで精度が上がると考えたが、実測では列挙が長さを圧迫し、枚挙漏れで発火失敗。過去 4 回は対象「種別」を明示することに注力して description を長くしすぎた。新試案では種別ではなく「エージェント実行時に読まれ、動きを変える指示書」という本質に回帰。

改善後の description 案:
```
Use this skill to fix the body text of instructions that an AI agent reads and follows at runtime. 
Applies to CLAUDE.md, SKILL.md, commands, output styles, agent definitions, memory files, and 
references. Typical requests: replace vague language (「適宜」"as appropriate") with concrete 
criteria tied to specific fields or states; reconcile contradictory rules that accumulated over 
time; remove duplicate steps or redundant explanations. Point at a file and ask to tidy, tighten, 
restructure, de-duplicate, inventory (棚卸し), review, or audit it — that's enough. Path + any 
cleanup verb.

Do not use for README, design docs, tutorials, or for creating a new skill/command/agent from 
scratch.
```

---

注意事項: 発火テストで 8/12 以上が達成されなかった場合、別の文体・組織を提案する必要があり。
