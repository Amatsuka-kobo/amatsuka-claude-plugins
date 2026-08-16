# intent駆動開発プラグイン 企画・設計相談

- 日付: 2026-08-16
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明(企画フェーズ)
- 前提: `plugins/codiel/README.md`, `plugins/codiel/docs/DESIGN.md`, `plugins/gh-utility/README.md`, `plugins/agent-policy/references/orchestration-discipline.md`, `.claude-plugin/marketplace.json`

---

## セッション1: 企画フェーズの相談

# phyllis998

> intent駆動開発を行うためのプラグインを新しく作成したいです。
> ソフトウェアの現状(ASIS)と、ユーザーのやりたいこと(TOBE)を把握し、実装方針の策定・テスト作成・ドキュメント作成更新・実装を自立的に行うものにしたいです。
> Codielとgh-utilityとの連携も意識し、GitHub上にASIS・TOBEやその他補足情報などを記したissueを起票するフェーズをオプションに、自立実行をCodielのワークフローにそってそれを補強するような形を想定したものにしたいです。
> ただし、それぞれがインストールされていない状況でも実行できるように、汎用的なものにしたいです。
> このアイディアは抽象的なモノであり、まだほとんど何も決まっていないです。アイディア出しから、方針の策定をお願いします。

# AI

実装前の調査と分析:
- Codiel(設計→テスト→実装→PR→レビュー→修正を自律実行)、gh-utility(Issue/Sub-issue/トリアージの操作)の READMEs と Codiel の DESIGN.md を読了
- orchest-discipline.md の規律(モデル別役割・context-map・コスト規律・設計書検証の流れ)を確認
- marketplace.json で既存 7 プラグインの役割分担(revelation: 小モデルの仕事ぶり・basic-design: 基本設計・pitcrew: 成果物レビューキュー・prompt-smith: プロンプト設計)を把握

提案する構造と役割分担:
1. **Intent-Analyzer** スキル(新規): ASIS/TOBE を構造化(現状のボトルネック・技術負債・外部制約をASISとして、ユーザーの目指す状態をTOBEとして)。両者のギャップから「何を実装すべきか」の領域を抽出。インタビュー形式で対話的に進める
2. **Plan-Generator** スキル(新規): Intent-Analyzer の出力を基に、実装方針・テスト戦略・ドキュメント計画を策定。Codiel の dev-plan フェーズとの互換性を保つ形式で出力
3. オプション統合: gh-utility の issue-craft を活用し、抽出した ASIS/TOBE/Gap/Plan を GitHub Issue に自動起票。Codiel の `/codiel:run` で引き継ぎ可能な形式で
4. 独立実行モード: gh-utility/Codiel が未インストールでも、Intent-Analyzer と Plan-Generator は claude CLI ヘッドレス実行で動作。出力は `.intent-plan/` 配下にローカル保存

選定理由:
- **既存の Codiel ワークフローへの補強**: Codiel は GitHub Issue から入るため、その前段(要件・スコープ・実装方針の合意)を担当することで、issue 起票の質と discussion フェーズの効率が向上
- **オプショナルな GitHub 統合**: Codiel/gh-utility が無い環境でも、LocalFS へ markdown 出力により単独で use case を満たす。GitHub ありなら自動連携
- **粒度の棲み分け**: Revelation(小モデルの仕事ぶり学習) と異なり、intent-plan は「要件→設計方針」という初期フェーズに特化。AI の暴走を防ぐため、ユーザー決定ゲート(ASIS/TOBE の確認、Gap 抽出の妥当性)を常設する

却下した選択肢:
- ❌ 「Codiel の前に完全に独立した専用オーケストレーターを作る」: Codiel が既に orchestration-discipline の最適化を体現しているため、二重構造は cost(token)と保守性で得られるものより失われるものが大きい。「補強」の立場が賢い
- ❌ 「ASIS/TOBE の分析を LLM 完全自動で行う」: ビジネス文脈・技術的制約・人間の優先順位が ASIS/TOBE に深く関わるため、human-in-the-loop が必須。複数回のユーザー確認ゲートを組み込む

次のステップ:
1. 上記の「構造と役割分担」「選定理由」「却下理由」をまとめた context-map 作成(harness-docs/ へ配置)
2. Intent-Analyzer スキルの skill-contract 設計(インタビュー質問項目・構造化出力形式・ユーザーゲート位置)
3. 同様に Plan-Generator の contract 設計
4. オプション統合(issue-craft との連携) / 独立実行モード(ローカル保存)の実装細則決定
5. Context-map / 設計書草稿をユーザーに提示・承認を得たのち、実装へ

---

注意事項: 企画段階のため、実装スケープ・必要なスキル数・他プラグインとの依存性などはまだ確定していない。次段階で context-map 作成時に確定させる必要あり。

## セッション2: 実装連携の相談

# phyllis998

> 案Aでよいです。
> Codielとgh-utility側の、新プラグインとの連携に向けた変更はどんなものが想定されますか?

案A(1コマンド+フェーズスキル分割)を承認。Codielとgh-utilityの側で必要な変更内容を質問。

## セッション3: スコープ確定とネーミング決定、設計書執筆の開始

# phyllis998

> 1~3を今回のスコープに含めたいです。
> 新プラグインのネーミングはどうしますか？

# AI

連携改修 1〜3 をスコープに含めることを確定。新プラグインのネーミング候補を提示:

(tool: AskUserQuestion — ネーミング選択肢の提示)

候補 4 案を提示(Sandalphon 推奨・Gabriel・Metatron・機能名系)。各案の背景と役割との対応関係を説明。Sandalphon が「ユーザーの願い(TOBE)を束ねて実行系へ届ける」という方向性で完全一致、天使名系統で Codiel/Raguel/Raphael と一貫するため推奨候補。

ユーザーの応答から Sandalphon を選択。

(tool: Bash — harness-docs の命名規則確認)

(tool: Bash — design 配下の命名規則確認)

既存設計書の命名規則を確認し、新規設計書のファイル名命名規約を検証。

(tool: Agent — claude Opus へ Sandalphon 設計書執筆を dispatch)

Opus(Claude Opus 5 モデル)へ設計書執筆を非同期タスクとして dispatch。設計書の構成(context-map・Intent-Analyzer/Plan-Generator スキルの contract・連携仕様)と検証フロー(Haiku レビュー → Grok 独立レビュー → ユーザー提示)を指示。

(tool: Agent — dispatched task 確認)

設計書執筆を Opus へ dispatch 済み(バックグラウンド実行)。完了後は Haiku レビュー → Grok 独立レビュー → 採否判断 → 提示の順で進める予定。

---

注意事項: 設計書執筆は非同期で進行中。Haiku/Grok レビューおよびユーザー提示は後続セッションでの対応となる。

## セッション1: intent駆動開発プラグイン企画・実装連携確認・ネーミング決定

# AI

スコープ確定(連携改修 1〜3 含む)。ネーミング — 既存は天使名系(Codiel/Raguel/Raphael)+機能名系の混在。Codiel の兄弟格 → 天使名系推奨。候補提示。

(tool: AskUserQuestion)

(tool: Bash — harness-docs の命名規則確認)

(tool: Bash — design 配下の命名確認)

Opus へ設計書執筆を dispatch。

(tool: Agent — Sandalphon 設計書を執筆)

設計書執筆を Opus へ dispatch 済み(バックグラウンド)。完了後: Haiku レビュー → Grok 独立レビュー → 採否判断 → 提示、の順で進める。

(tool: Agent — 会話ターンを記録)

設計書執筆(Opus)進行中。完了通知待ち。

記録完了。設計書執筆(Opus)完了待ち継続。

# phyllis998

> 今回のタスクは、OpusによるDynamic Workflowのテストを兼ねています。
> このセッションでは設計書までを行い、別セッションでOpusに依頼したいと思います。
> プロンプトを考えてください。

今回のタスクが Opus の Dynamic Workflow テストを兼ねることを確認。このセッションで設計書までを完了し、実装は次セッションで Opus へ依頼予定。プロンプト作成を要求。

# AI

案Aでよいです(スコープ確定済み)。Codiel・gh-utility 側での連携に向けた変更を整理。

---

却下した選択肢:
- ❌ 「Codiel の前に完全に独立した専用オーケストレーターを作る」: Codiel が既に orchestration-discipline の最適化を体現しているため、二重構造は cost(token)と保守性で得られるものより失われるものが大きい。「補強」の立場が賢い
- ❌ 「ASIS/TOBE の分析を LLM 完全自動で行う」: ビジネス文脈・技術的制約・人間の優先順位が ASIS/TOBE に深く関わるため、human-in-the-loop が必須。複数回のユーザー確認ゲートを組み込む

次のステップ:
1. 上記の「構造と役割分担」「選定理由」「却下理由」をまとめた context-map 作成(harness-docs/ へ配置)
2. Intent-Analyzer スキルの skill-contract 設計(インタビュー質問項目・構造化出力形式・ユーザーゲート位置)
3. 同様に Plan-Generator の contract 設計
4. オプション統合(issue-craft との連携) / 独立実行モード(ローカル保存)の実装細則決定
5. Context-map / 設計書草稿をユーザーに提示・承認を得たのち、実装へ

---

注意事項: 企画段階のため、実装スケープ・必要なスキル数・他プラグインとの依存性などはまだ確定していない。次段階で context-map 作成時に確定させる必要あり。

## セッション2: 実装連携の相談

# phyllis998

> 案Aでよいです。
> Codielとgh-utility側の、新プラグインとの連携に向けた変更はどんなものが想定されますか?

案A(1コマンド+フェーズスキル分割)を承認。Codielとgh-utilityの側で必要な変更内容を質問。

## セッション3: スコープ確定とネーミング決定、設計書執筆の開始

# phyllis998

> 1~3を今回のスコープに含めたいです。
> 新プラグインのネーミングはどうしますか？

# AI

連携改修 1〜3 をスコープに含めることを確定。新プラグインのネーミング候補を提示:

(tool: AskUserQuestion — ネーミング選択肢の提示)

候補 4 案を提示(Sandalphon 推奨・Gabriel・Metatron・機能名系)。各案の背景と役割との対応関係を説明。Sandalphon が「ユーザーの願い(TOBE)を束ねて実行系へ届ける」という方向性で完全一致、天使名系統で Codiel/Raguel/Raphael と一貫するため推奨候補。

ユーザーの応答から Sandalphon を選択。

(tool: Bash — harness-docs の命名規則確認)

(tool: Bash — design 配下の命名規則確認)

既存設計書の命名規則を確認し、新規設計書のファイル名命名規約を検証。

(tool: Agent — claude Opus へ Sandalphon 設計書執筆を dispatch)

Opus(Claude Opus 5 モデル)へ設計書執筆を非同期タスクとして dispatch。設計書の構成(context-map・Intent-Analyzer/Plan-Generator スキルの contract・連携仕様)と検証フロー(Haiku レビュー → Grok 独立レビュー → ユーザー提示)を指示。

(tool: Agent — dispatched task 確認)

設計書執筆を Opus へ dispatch 済み(バックグラウンド実行)。完了後は Haiku レビュー → Grok 独立レビュー → 採否判断 → 提示の順で進める予定。

---

注意事項: 設計書執筆は非同期で進行中。Haiku/Grok レビューおよびユーザー提示は後続セッションでの対応となる。

## セッション 2: 実装連携の相談

# phyllis998

> 案Aでよいです。
> Codielとgh-utility側の、新プラグインとの連携に向けた変更はどんなものが想定されますか?

案A(1コマンド+フェーズスキル分割)を承認。Codielとgh-utilityの側で必要な変更内容を質問。

# AI

Codielとgh-utilityの連携改修を説明。Codiel側では analyzing-issues スキルに intent マーカー写像規約を追加、preparing-design-agendas スキルで合意済み事項を論点から除外する機構が必要。gh-utility側では issue-craft スキルに完成済み本文の持ち込みモードを追加。

両プラグインともパッチバージョン上げで対応。sandalphon は これらのスキルの出力を intent-issue フォーマットに変換し、frontmatter とメタデータを付加して起票または保存。

---

## セッション 3: スコープ確定とネーミング決定、設計書執筆の開始

# phyllis998

> 1~3を今回のスコープに含めたいです。
> 新プラグインのネーミングはどうしますか?

連携改修 1〜3 をスコープに含めることを要求。新プラグインのネーミング決定を依頼。

# AI

連携改修 1〜3 をスコープに含めることを確定。新プラグインのネーミング候補を提示:

(tool: AskUserQuestion — ネーミング選択肢の提示)

候補 4 案を提示(Sandalphon 推奨・Gabriel・Metatron・機能名系)。各案の背景と役割との対応関係を説明。Sandalphon が「ユーザーの願い(TOBE)を束ねて実行系へ届ける」という方向性で完全一致、天使名系統で Codiel/Raguel/Raphael と一貫するため推奨候補。

ユーザーの応答から Sandalphon を選択。

(tool: Bash — harness-docs の命名規則確認)

(tool: Bash — design 配下の命名規則確認)

既存設計書の命名規則を確認し、新規設計書のファイル名命名規約を検証。

(tool: Agent — claude Opus へ Sandalphon 設計書執筆を dispatch)

Opus(Claude Opus 5 モデル)へ設計書執筆を非同期タスクとして dispatch。設計書の構成(context-map・Intent-Analyzer/Plan-Generator スキルの contract・連携仕様)と検証フロー(Haiku レビュー → Grok 独立レビュー → ユーザー提示)を指示。

(tool: Agent — dispatched task 確認)

設計書執筆を Opus へ dispatch 済み(バックグラウンド実行)。完了後は Haiku レビュー → Grok 独立レビュー → 採否判断 → 提示の順で進める予定。

---

注意事項: 設計書執筆は非同期で進行中。Haiku/Grok レビューおよびユーザー提示は後続セッションでの対応となる。

## セッション 4: ARCHITECTURE/GOTCHAS分離スコープ決定

# phyllis998

> 1. ARCHITECTUREとGOTCHASの分離方針によっても変更する必要があると思いますが、一旦これでよいです。
> 2. aで進めてください

sandalphon 設計書の内容を確認し承認。ARCHITECTURE/GOTCHAS 分離は第 2 トラック設計書を先に作る方式(案 a)を選択。

# AI

- Codiel 側の改修(initializing-harness 分割、orchestrating-runs 参照調整、recording-gotchas の帰属判断)は sandalphon と独立して実施可能。分離後も docs/ARCHITECTURE.md・docs/GOTCHAS.md パスを維持し、sandalphon から Codiel への参照は ARCHITECTURE.md / GOTCHAS.md の「パスにあれば読む」構成で対応
- 分離スコープの未確定項目(新プラグインが init インタビュー全体か ARCHITECTURE/GOTCHAS 生成だけか、recording-gotchas スキルの帰属、raguel.config.yaml の所属、命名)は次セッション冒頭の質問で確定予定
- 案 a(今セッションで第 2 設計書)によって、実装セッションを 1 回に集約でき、ワークフローテストの規模も最大化される点が評価理由

## セッション 5: domains ブロック配置方針の検討

# AI

Codiel 側の initializing-harness と recording-gotchas スキルの実体を把握した上で、domains JSON のおき場の妥当性を検討。

domains JSON は ARCHITECTURE.md 内の「## ドメインマップ」節に置かれた機械可読 JSON フェンスブロック（```json codiel:domains```で始まるフェンス）。内容はドメイン別のコード変更書き込み許可パス glob で、Codiel の hooks(guard-write)がこれで implementer の書き込みを機械的に検査し、scripts/lib.mjs の readDomains 関数が正規表現抽出する。/codiel:run 開始時に読めない場合はフェイルクローズド。

ARCHITECTURE.md は 2 種の内容が同居している:
1. 人間向けの汎用アーキテクチャ記述（概要・技術スタック・ディレクトリ構成と責務・コマンド定義・テスト方針・保護パス・規約）— どのツールでも価値あり、新プラグインが管理すべき内容
2. Codiel 専用の機械可読データ（domains JSON = 書き込み権限の enforcement 定義）— ドメインマップの散文説明から導かれるが、実体は Codiel の実行制御設定

散文の「ドメインマップ」節（各領域の責務説明）は 1 として ARCHITECTURE に残し、移すのは JSON ブロックだけ。保護パス glob が既に raguel.config.yaml にあるため、書き込み許可 glob も同居が自然。新プラグインは他ツールの埋込ブロック保全義務を負わない構成が推奨される点を説明。

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/codiel/skills/initializing-harness/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/codiel/skills/recording-gotchas/SKILL.md)

(tool: Bash — ARCHITECTURE.example.md の domains ブロック確認)

domains JSON の置き場についてユーザーの判断を待つ。

# phyllis998

> ドメインマップについて、これは本当にCodielの固有資産として運用するのがただしいでしょうか。Codiel以外に価値はないですか？

domains ブロックが本当に Codiel 固有資産として運用するのが正しいか、Codiel 以外に価値があるかについて逆質問。


## セッション 6: ドメインマップ汎用化方針の確定

# AI

ドメインマップの置き場を再検討し、データと enforcement の混同を解きほぐした。

**主な発見**: domains JSON（ドメイン別コード変更書き込み許可パス glob）は Codiel 固有だが、その背後にあるドメイン分割の宣言（frontend は src/app/** と src/components/** のような領域→パス写像）は汎用資産。sandalphon（ASIS 探索スコープ決定、実装方針での影響範囲宣言、Phase 3 作業範囲明示）、汎用オーケストレーション（並列サブエージェント担当分割、レビュー担当ルーティング）、人間向け責務・所有権宣言（オンボーディング）で価値あり。

**決定**: ドメインマップを新プラグインの一級フィールドとして ARCHITECTURE 記録に残す。中立名マーカー（例: ```` ```json harness:domains ```` 等）に改称し、新プラグイン命名後に正確な名前を決定。新プラグインスキーマの一部になることで「他ツールの埋込ブロック保全義務」問題は消滅（外来ブロックではなく自分のスキーマフィールド化）。Codiel は消費者に回り、`readDomains` 参照先を中立マーカー+共有パス設定に変更。旧 `codiel:domains` は後方互換で読み続ける。保護パス glob は raguel.config との二重管理構造が既にあるため今回は現状維持。

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/codiel/skills/initializing-harness/SKILL.md)
(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/codiel/skills/recording-gotchas/SKILL.md)

# phyllis998

> この形で進めてください

ドメインマップ汎用化方針（中立マーカー化、新プラグイン一級フィールド化、Codiel 後方互換性維持）を承認。

## セッション 7: Codiel 後方互換廃止の確定

# phyllis998

> codielの後方互換は不要です。ステータスは\"開発中\"であり、現状使う人はいないと仮定します。

# AI

Codiel 後方互換廃止方針を確定。開発中ステータスであり、現在の利用者なしを前提に、domains マーカー移行時に Codiel 側の互換分岐（readDomains の旧マーカー読み込み、recording-gotchas スキルの参照先調整等）をすべて削除。

## セッション 8: MCP としての価値検証（独立反証レビュー開始）

# AI

Codiel 後方互換廃止方針（開発中・利用者ゼロ前提、旧マーカーと既存 ARCHITECTURE.md の互換配慮を骨子から削除）を確定。

Metatron 設計書執筆を dispatch（sandalphon 設計書執筆エージェントを再利用 — Codiel 内部と設計スタイルを把握済み）。完了後のフロー: Haiku+Grok レビュー → 採否 → 反映 → sandalphon 設計書の波及更新 → 両設計書+実装プロンプト最終版の提示。

Metatron 設計書執筆進行中。完了通知待ち。

(tool: SendMessage)
(tool: Agent — grok-researcher — MCP 化価値の独立反証レビュー)

# phyllis998

> MCPの価値について議論がしたいです。
> 現状の設計でMCPとしてたてる価値はありますか？
> あなたの考えをまず聞いて、同時に反証レビュアーをdispatchして考えさせてください

MCP としての価値検証、現設計での MCP 化の正当性、反証レビュアーの dispatch を要望。

## セッション 9: C1案確定・ライブラリ共有方針とドメイン配置の最終調整


## セッション 9: C1案確定・ライブラリ共有方針とドメイン配置の最終調整

# AI

俺の見解を先に、同時に Grok を反証レビューへ dispatch。

Grok dispatch 済み(結論を出さず判断材料提示+実運用事実の調査を指示。俺の見解は渡していない)。

## 俺の見解: **現設計では MCP の価値は薄い。正直、CLI スクリプト+スキルで足りる**

### なぜか(2 層)

**第 1 層: 読み経路が全部 MCP を迂回している。**

現設計の読み手を並べると:

| 読み手 | 経路 |
|---|---|
| SessionStart 注入 | Hook スクリプトがファイル直読(MCP 不可の実行文脈) |
| Codiel guard-write hooks | 決定的スクリプトがファイル直読(同上) |
| セッション中の全文参照 | ファイルが git 管理の Markdown なので Read ツールで読める |

つまり MCP に残る仕事は**書き込み(検証・採番・追記専用強制)だけ**。

**第 2 層: 書き込み検証は常駐プロセスを要求しない。**

書き込みゲートウェイの価値(スキーマ検証・GOTCHA-NNN 採番・追記専用・無効化追記・domains JSON の整合検証)は本物。だがこれは `metatron-cli record-gotcha --input draft.json` のような**決定的 CLI(バンドル済みスクリプト、Bash 実行)で同一の保証**が得られる。gh-utility の check-issue-env.mjs・Codiel の lib.mjs と同じ既存パターン。呼び出し頻度も低い(初回生成 1 回・乖離更新・失敗時追記)ので、常駐の応答性も要らない。

### MCP を選ぶことで増えるコスト

- ユーザーの登録負担(.mcp.json / プラグイン MCP の有効化)+常駐プロセス管理
- ツールスキーマの毎セッション固定トークンコスト(呼ばないセッションでも払う)
- サブエージェント・ヘッドレス実行での可用性問題(設計自体が「MCP 不在でも注入成立」のフォールバックを既に要求している = 不在が常態と認めている)
- dist/ 常駐プロセスの実装・保守コスト

### Raguel との対比(MCP が正当な例)

raguel-mcp は run 実行中に**高頻度でゲート判定を返す対話的ツール**であり、セッション内で何度も呼ばれ、判定ロジックの状態を持つ。Metatron は低頻度の記録操作で、状態はファイルそのもの。前例があるから MCP、は成立しない。

### MCP が価値を持つ条件(将来)

- 保存を内部 DB・クロスプロジェクト知識へ拡張するとき
- GOTCHAS の検索(類似失敗の照合など)をセッション中に高頻度で提供するとき
- 書き込みを Bash 権限なしの環境でも許可したいとき

### 推奨

**案 B へ転換: MCP をやめ、決定的 CLI(scripts/ バンドル)+スキルで書き込み規律を強制。** SessionStart 注入は変更なし(元々ファイル直読)。将来 MCP に昇格できる形で CLI のコマンド体系を設計しておく。実装コストも下がる。

Grok の反証(A/B 両面+実運用事実の裏取り)が届いたら突き合わせて最終判断を提示する。なお Metatron 設計書の執筆が MCP 前提で進行中 — 結論確定後に修正指示を出す。

Grok 反証レビューの完了待ち。届き次第、俺の見解と突き合わせて最終判断を提示する。

記録完了。Grok 反証レビュー待ち継続。

Grok レビュー到着。突き合わせ結果と最終判断の提案。

## 突き合わせの要点

**俺の見解と一致**: 読み経路(SessionStart 注入・Codiel hooks・セッション中の Read)は全部ファイル直読で MCP を迂回。MCP の存在理由は低頻度の書き込み検証に縮退。raguel-mcp の前例は高頻度ゲート用途でプロファイルが別 — 前例は MCP 採用の根拠にならない。

**Grok が俺の案(B: CLI+スキル)にも刺した反証(妥当)**:

- **A も B も「呼び出しは任意」という同じ穴を持つ**。MCP ツールがあってもスキルに CLI を書いても、モデルが Write/Edit で正本ファイルを直接編集すれば検証・採番・追記専用はすべてスキップされる。「機械的強制」はどちらでも幻想
- 本当の強制点は **PreToolUse deny hook**(対象ファイルへの直接 Edit/Write を deny し、CLI 経由のみ許可)。これは A を選んでも結局必要
- B 単体はスキーマ発見性が MCP より弱い(引数ミス・手順スキップ増)

**Grok の事実発見(重要)**: 現行 Codiel の `guard-write` は **domains を実は読んでいない**(readDomains は lib に実装済みだが hook に未配線。ARCHITECTURE.example.md の「hooks が機械的に読む」はオーバーステート)。→ Metatron 設計で「誰が domains を機械読するか」を明確に固定する必要あり。

## 最終判断(推奨): C1 案 — MCP 廃止、三点セットへ

```
共有 TypeScript ライブラリ(検証・採番・追記・スキーマ)
  ├─ 決定的 CLI(scripts/ バンドル、Bash 実行)← AI の書き込み窓口
  ├─ PreToolUse deny hook ← 正本ファイルへの直接 Edit/Write を拒否(真の機械的強制)
  └─ SessionStart hook ← 注入(従来どおり直読、同ライブラリで読む)
```

- A の強制(実は hook が担う)と B の軽量(常駐なし・登録なし・スキーマトークンなし)を両取り
- 検証ロジックの正本はライブラリ → hook と CLI で共有、二重実装なし
- 発見性の弱さは、SessionStart 注入文に「記録・更新は metatron CLI 経由(直接編集は hook が拒否)」の 1 行を含めて補う
- 将来、クロスプロジェクト知識・高頻度検索が要件化したら MCP へ昇格(CLI のコマンド体系をツール名に写せる形で設計)

**C1 で確定してよいか?** 確定なら Metatron 設計書へ修正指示(MCP → C1 構成、guard-write 未配線の事実の反映、deny hook 仕様の追加)を送る。

Metatron 設計書の初版完成(全 16 節・1231 行、**MCP 前提のまま** — MCP 議論の前に dispatch していたため)。執筆エージェント自身の懸念にも「常駐 MCP が 2 つになる」が挙がっており、C1 案と符合。

状況整理:

- **設計書**: `harness-docs/design/2026-08-16-metatron-design.md`(MCP 版)。stage→commit の 2 段階承認ゲート、注入 2 層(目次全件+直近 5 件全文)、Codiel 未導入時フォールバック等は C1 でもそのまま流用可能な設計
- **保留中**: C1 案(MCP 廃止 → ライブラリ+CLI+PreToolUse deny hook)の確定
- C1 確定なら、Haiku+Grok レビューの**前に** C1 への書き換えを執筆エージェントへ指示する(MCP 版をレビューさせるのは無駄になるため)

C1 で確定するか、回答待ち。

C1 確定の回答待ち継続。

Raphael 蒸留完了(抗体 1 件 extend、3 infection 処理済み)。C1 確定の回答待ち継続。

# phyllis998

> 共有TypeScriptライブラリとは、codielとmetatronの共有という解釈であっていますか？

# AI

半分違う。正確には:

## 「共有ライブラリ」の第一義 = **metatron 内部の 3 実行文脈の共有**

```
metatron の共有ライブラリ(パース・検証・採番・パス解決)
  ├─ CLI(record-gotcha 等)        ← AI の書き込み窓口
  ├─ PreToolUse deny hook          ← 直接編集の拒否判定
  └─ SessionStart hook             ← 注入時の読み取り・要約
```

MCP 案の問題「検証ロジックがサーバー内に閉じ、hook(MCP 不可の文脈)と二重実装になる」の解消が主目的。

## Codiel とのランタイム共有は**不可**

プラグインは独立配布でインストールパスが互いに不定(`CLAUDE_PLUGIN_ROOT` は自プラグインのみ)。Codiel のバンドル済み hook が metatron のバンドルを import することはできない。**プラグイン間で共有するのは「コード」ではなく「ファイル契約」**(metatron.config.json のスキーマ+マーカー形式+文書パス既定値)。Codiel は自前の lib(既存 lib.ts)でその契約を読む。

## ただし、ソースレベル共有は可能(選択肢)

このリポジトリはモノレポなので、契約の読み取り実装(config 解決+マーカー抽出)を workspace パッケージとして 1 本書き、**codiel と metatron 双方の build.ts が各自のバンドルに焼き込む**ことはできる。配布後も各プラグインは自分のコピーを持つので独立性は保たれる。Metatron 設計書の執筆エージェントが挙げた懸念 2「パス解決規則の実装が 3 つ(metatron / codiel / sandalphon)になる」の軽減策になる — 実装は 1 ソース、バンドルは 3 つ、ズレはビルド時点で同一。

C1 確定時はこのソース共有方式も設計書へ含める想定。C1 で確定してよいか?

C1 確定の回答待ち。

# phyllis998

> 無理に共有することはないです。
> もう一つの論点として、利用者がcodielのみを使う場合、Metatronが提供するARCHITECTUREとGOTCHASは持ちません。Codiel単体ではそれを参照しないようにできますか？

## セッション 10: Codiel単体動作の原則化、共有ライブラリ非強制化


## セッション 10: Codiel単体動作の原則化、共有ライブラリ非強制化

# AI

了解(ソース共有は不要)。単体動作の問いへの回答: **可能。ただし「参照しない」より筋の良い形がある — 「Metatron に依存せず、ファイル契約だけに依存する」**。

## Codiel が ARCHITECTURE/GOTCHAS に依存している深さの分解

| 依存 | 性質 | 単体時の扱い |
|---|---|---|
| domains ブロック | **機械的必須**(run のフェイルクローズド条件・ディスパッチ境界) | 何らかの出所が必須 |
| コマンド定義・技術スタック・規約等の散文 | エージェントが読む文脈 | optional 化可能(あれば読む) |
| GOTCHAS 参照(agenda 作成時) | 文脈 | optional 化可能(なければスキップ) |
| GOTCHAS 追記(recording-gotchas) | Codiel 自身の学習ループ | 単体でも自前で追記継続(現行どおり) |

## 提案する原則

**Codiel は「Metatron プラグイン」を一切参照しない。参照するのは「ファイル契約」(共有設定+マーカー形式)だけ。**

ファイルはただの Markdown なので、書き手が Metatron である必要はない:

1. **Codiel 単体**: `/codiel:init` が **domains ブロックだけの最小 ARCHITECTURE.md** を生成(散文なし。マーカーは中立形式に準拠)。GOTCHAS は recording-gotchas が現行どおり自前で作成・追記。散文文脈・GOTCHAS 参照は「あれば読む」— なければ静かにスキップ
2. **Metatron 併用**: 同じファイルが Metatron の管理下に入り、解析ドラフト生成・対話更新・SessionStart 注入・書き込み検証(deny hook)が乗る。**単体時に作った最小ファイルはそのまま昇格**(移行作業ゼロ)
3. 二重管理なし: domains の正本は常にファイル 1 箇所。raguel.config への複製はしない

これで「Codiel 単体で完結」「Metatron 導入で強化」が両立し、sandalphon と同じグレースフルデグラデーションパターンに揃う。

## 確認 2 点

1. **C1 案**(MCP 廃止 → metatron 内部共有ライブラリ+CLI+PreToolUse deny hook。プラグイン間はファイル契約のみ、ソース共有なし)
2. **上記の単体動作原則**(Codiel はファイル契約のみに依存、init が最小 domains 雛形を生成)

両方確定なら、Metatron 設計書へまとめて修正指示 → Haiku+Grok レビュー → sandalphon 波及更新 → 実装プロンプト最終化、へ進む。

C1+単体動作原則の確定回答待ち。

蒸留完了(抗体 1 件新規作成、9 infection 処理済み)。C1+単体動作原則の確定回答待ち継続。

C1+単体動作原則の確定回答待ち。

蒸留完了(全 5 件重複・既存抗体でカバー済み)。C1+単体動作原則の確定回答待ち継続。

会話記録のバックグラウンド処理が失敗(`commit-chat-recording.mjs` の `plan.sessionNumber must be a positive integer` 検証エラーが再発、既知の抗体でも回避不能)。chat-history プラグインのバグの可能性 — 本タスクとは別件のため、必要なら後で調査タスク化を。

本題: C1+Codiel 単体動作原則の確定回答待ち。

C1+単体動作原則の確定回答待ち。

蒸留完了(全 6 件重複)。C1+単体動作原則の確定回答待ち継続。

C1+単体動作原則の確定回答待ち。

記録成功(復旧)。C1+単体動作原則の確定回答待ち継続。

# phyllis998

> この設計で進めてください

# AI

半分違う。正確には:

## 「共有ライブラリ」の第一義 = **metatron 内部の 3 実行文脈の共有**

```
metatron の共有ライブラリ(パース・検証・採番・パス解決)
  ├─ CLI(record-gotcha 等)        ← AI の書き込み窓口
  ├─ PreToolUse deny hook          ← 直接編集の拒否判定
  └─ SessionStart hook             ← 注入時の読み取り・要約
```

MCP 案の問題「検証ロジックがサーバー内に閉じ、hook(MCP 不可の文脈)と二重実装になる」の解消が主目的。

## Codiel とのランタイム共有は**不可**

プラグインは独立配布でインストールパスが互いに不定(`CLAUDE_PLUGIN_ROOT` は自プラグインのみ)。Codiel のバンドル済み hook が metatron のバンドルを import することはできない。**プラグイン間で共有するのは「コード」ではなく「ファイル契約」**(metatron.config.json のスキーマ+マーカー形式+文書パス既定値)。Codiel は自前の lib(既存 lib.ts)でその契約を読む。

## ただし、ソースレベル共有は可能(選択肢)

このリポジトリはモノレポなので、契約の読み取り実装(config 解決+マーカー抽出)を workspace パッケージとして 1 本書き、**codiel と metatron 双方の build.ts が各自のバンドルに焼き込む**ことはできる。配布後も各プラグインは自分のコピーを持つので独立性は保たれる。Metatron 設計書の執筆エージェントが挙げた懸念 2「パス解決規則の実装が 3 つ(metatron / codiel / sandalphon)になる」の軽減策になる — 実装は 1 ソース、バンドルは 3 つ、ズレはビルド時点で同一。

C1 確定時はこのソース共有方式も設計書へ含める想定。C1 で確定してよいか?

C1 確定の回答待ち。

# phyllis998

> 共有TypeScriptライブラリとは、codielとmetatronの共有という解釈であっていますか？

# AI

半分違う。正確には:

## 「共有ライブラリ」の第一義 = **metatron 内部の 3 実行文脈の共有**

```
metatron の共有ライブラリ(パース・検証・採番・パス解決)
  ├─ CLI(record-gotcha 等)        ← AI の書き込み窓口
  ├─ PreToolUse deny hook          ← 直接編集の拒否判定
  └─ SessionStart hook             ← 注入時の読み取り・要約
```

MCP 案の問題「検証ロジックがサーバー内に閉じ、hook(MCP 不可の文脈)と二重実装になる」の解消が主目的。

## Codiel とのランタイム共有は**不可**

プラグインは独立配布でインストールパスが互いに不定(`CLAUDE_PLUGIN_ROOT` は自プラグインのみ)。Codiel のバンドル済み hook が metatron のバンドルを import することはできない。**プラグイン間で共有するのは「コード」ではなく「ファイル契約」**(metatron.config.json のスキーマ+マーカー形式+文書パス既定値)。Codiel は自前の lib(既存 lib.ts)でその契約を読む。

## ただし、ソースレベル共有は可能(選択肢)

このリポジトリはモノレポなので、契約の読み取り実装(config 解決+マーカー抽出)を workspace パッケージとして 1 本書き、**codiel と metatron 双方の build.ts が各自のバンドルに焼き込む**ことはできる。配布後も各プラグインは自分のコピーを持つので独立性は保たれる。Metatron 設計書の執筆エージェントが挙げた懸念 2「パス解決規則の実装が 3 つ(metatron / codiel / sandalphon)になる」の軽減策になる — 実装は 1 ソース、バンドルは 3 つ、ズレはビルド時点で同一。

C1 確定時はこのソース共有方式も設計書へ含める想定。C1 で確定してよいか?

C1 確定の回答待ち。

# phyllis998

> 無理に共有することはないです。
> もう一つの論点として、利用者がcodielのみを使う場合、Metatronが提供するARCHITECTUREとGOTCHASは持ちません。Codiel単体ではそれを参照しないようにできますか?

## セッション 11: prompt-smith基準の適用可否、Codiel単体での参照性


## セッション 11: prompt-smith基準の適用可否、Codiel単体での参照性

# AI

C1+単体動作原則で確定。Metatron 設計書の C1 書き換えを執筆エージェントへ指示。

C1 改稿を dispatch 済み。完了後: Haiku+Grok レビュー(C1 版に対して) → 採否・反映 → sandalphon 波及更新 → 両設計書+実装プロンプト最終化、の順で進める。

C1 改稿(バックグラウンド)完了待ち。

記録完了。C1 改稿の完了待ち継続。

C1 改稿の完了待ち継続。

蒸留完了(全 4 件重複)。C1 改稿の完了待ち継続。

C1 改稿完了(1521 行)。レビュー工程へ — Haiku と Grok を並列 dispatch。

両レビュー dispatch 済み(並列)。改稿者の自己申告懸念(recording-gotchas 側の拒否時リカバリ記述欠落など)もレビュー結果と合わせて採否判断し、まとめて反映する。完了通知待ち。

Haiku レビュー完了(誤読なし・記述整理系の指摘 11 件)。Grok 独立レビューの完了待ち。

Grok 独立レビュー完了。重大な事実発見が 2 つ(公式仕様裏取り済み): **SessionStart 注入は 10,000 文字キャップ**(設計の 32KiB 前提が崩壊)、**サブエージェントへの注入継承は保証されない**(Codiel agents の optional 化は危険)。採否判断して改稿指示を送る。

レビュー完了・採否判断済み・反映指示を dispatch。サマリ:

## レビュー結果(Metatron C1 版)

**Haiku**: 誤読なし。記述整理系 11 件(図と本文の依存方向、「参照しない」の定義曖昧など)→ 大半採用。

**Grok(公式ドキュメント裏取り付き)**: 28 件。重大 4 件:

1. **SessionStart 注入は 10,000 文字キャップ**(公式仕様)— 設計の 32KiB 予算は上限の外。超過分はファイル退避+プレビュー置換になり「読まない判断の再発」そのもの → 注入予算を 10k 基準に再設計、CLI 案内を最優先保持へ
2. **サブエージェントへの注入継承は保証なし** — Codiel の各 agent の文書参照を optional 化すると品質劣化 → agents は従来どおり必読を維持、optional 化はメインセッション文脈限定へ
3. **Codiel agents/*.md が docs/ パスをハードコード** — パス設定可能化が agent 層で空洞化 → agents 改修を実装範囲に追加
4. **ルート解決の基準が Codiel(.codiel 祖先)と metatron(config 祖先→git→cwd)で不一致** — 同一 cwd でも別 root を見る → ルート解決規則をファイル契約に含めて 1 本化

**採否**: 採用 17 項目(上記+セクション 0 更新経路、CLI 呼び出しは一時ファイル渡し、append 原子性、NotebookEdit 追加、パス正規化、CLAUDE.example 整合など)、不採用 4 系統(旧マーカー互換復活=ユーザー決定に反する、staging tmp 変更、PowerShell 対策、承認形骸化の追加対策)。

反映完了後: sandalphon 設計書の波及更新 → 両設計書の最終提示+実装プロンプト(Dynamic Workflow 用)の確定、で本セッションの成果物が揃う。

# phyllis998

> ARCHITECTURE.mdとGOTCHAS.mdの内容についてです。
> これらは基本的にAIが読む為のモノになります。したがってprompt-smithの基準が適用されると考えます。
> Metatronにこの基準を入れ込むことはできますか？これら2つの文書用に最適化してよいです。

# AI

半分違う。正確には:

## 「共有ライブラリ」の第一義 = **metatron 内部の 3 実行文脈の共有**

```
metatron の共有ライブラリ(パース・検証・採番・パス解決)
  ├─ CLI(record-gotcha 等)        ← AI の書き込み窓口
  ├─ PreToolUse deny hook          ← 直接編集の拒否判定
  └─ SessionStart hook             ← 注入時の読み取り・要約
```

MCP 案の問題「検証ロジックがサーバー内に閉じ、hook(MCP 不可の文脈)と二重実装になる」の解消が主目的。

## Codiel とのランタイム共有は**不可**

プラグインは独立配布でインストールパスが互いに不定(`CLAUDE_PLUGIN_ROOT` は自プラグインのみ)。Codiel のバンドル済み hook が metatron のバンドルを import することはできない。**プラグイン間で共有するのは「コード」ではなく「ファイル契約」**(metatron.config.json のスキーマ+マーカー形式+文書パス既定値)。Codiel は自前の lib(既存 lib.ts)でその契約を読む。

## ただし、ソースレベル共有は可能(選択肢)

このリポジトリはモノレポなので、契約の読み取り実装(config 解決+マーカー抽出)を workspace パッケージとして 1 本書き、**codiel と metatron 双方の build.ts が各自のバンドルに焼き込む**ことはできる。配布後も各プラグインは自分のコピーを持つので独立性は保たれる。Metatron 設計書の執筆エージェントが挙げた懸念 2「パス解決規則の実装が 3 つ(metatron / codiel / sandalphon)になる」の軽減策になる — 実装は 1 ソース、バンドルは 3 つ、ズレはビルド時点で同一。

C1 確定時はこのソース共有方式も設計書へ含める想定。C1 で確定してよいか?

C1 確定の回答待ち。

# phyllis998

> 共有TypeScriptライブラリとは、codielとmetatronの共有という解釈であっていますか？

# AI

半分違う。正確には:

## 「共有ライブラリ」の第一義 = **metatron 内部の 3 実行文脈の共有**

```
metatron の共有ライブラリ(パース・検証・採番・パス解決)
  ├─ CLI(record-gotcha 等)        ← AI の書き込み窓口
  ├─ PreToolUse deny hook          ← 直接編集の拒否判定
  └─ SessionStart hook             ← 注入時の読み取り・要約
```

MCP 案の問題「検証ロジックがサーバー内に閉じ、hook(MCP 不可の文脈)と二重実装になる」の解消が主目的。

## Codiel とのランタイム共有は**不可**

プラグインは独立配布でインストールパスが互いに不定(`CLAUDE_PLUGIN_ROOT` は自プラグインのみ)。Codiel のバンドル済み hook が metatron のバンドルを import することはできない。**プラグイン間で共有するのは「コード」ではなく「ファイル契約」**(metatron.config.json のスキーマ+マーカー形式+文書パス既定値)。Codiel は自前の lib(既存 lib.ts)でその契約を読む。

## ただし、ソースレベル共有は可能(選択肢)

このリポジトリはモノレポなので、契約の読み取り実装(config 解決+マーカー抽出)を workspace パッケージとして 1 本書き、**codiel と metatron 双方の build.ts が各自のバンドルに焼き込む**ことはできる。配布後も各プラグインは自分のコピーを持つので独立性は保たれる。Metatron 設計書の執筆エージェントが挙げた懸念 2「パス解決規則の実装が 3 つ(metatron / codiel / sandalphon)になる」の軽減策になる — 実装は 1 ソース、バンドルは 3 つ、ズレはビルド時点で同一。

C1 確定時はこのソース共有方式も設計書へ含める想定。C1 で確定してよいか?

C1 確定の回答待ち。

# phyllis998

> 無理に共有することはないです。
> もう一つの論点として、利用者がcodielのみを使う場合、Metatronが提供するARCHITECTUREとGOTCHASは持ちません。Codiel単体ではそれを参照しないようにできますか?

## セッション 12: 設計フェーズ最終化と実装プロンプト確認


## セッション 12: 設計フェーズ最終化と実装プロンプト確認

# AI

Metatron 設計書のレビュー反映完了(1883 行)。残るは sandalphon 設計書の波及更新 → 最終提示。波及更新を dispatch。

sandalphon 波及更新を dispatch 済み。完了後、両設計書+実装プロンプト最終版をまとめて提示する。

sandalphon 波及更新の完了待ち。

記録完了。sandalphon 波及更新の完了待ち継続。

sandalphon 波及更新の完了待ち継続。

sandalphon 波及反映完了。**設計フェーズ全工程完了**。最終成果物を提示する。

まずセッション間引き継ぎ用のメモリを保存。

# 設計フェーズ完了 — 最終報告

## 成果物(いずれもレビュー反映済み・ユーザーレビュー可)

| 文書 | 内容 |
|---|---|
| `harness-docs/design/2026-08-16-sandalphon-design.md`(15 節・1360 行) | intent 駆動開発プラグイン。ASIS/TOBE 把握 → issue 起票(オプション) → Codiel 委譲 or 軽量自前実行。metatron 波及(projectDocs 検出再編・metatron:domains・ファイル契約パス解決)反映済み |
| `harness-docs/design/2026-08-16-metatron-design.md`(16 節・1883 行) | ARCHITECTURE/GOTCHAS の Codiel 分離。C1 構成(共有ライブラリ+CLI+deny hook+SessionStart 注入)。10k 文字キャップ・サブエージェント非継承・agents 改修・ルート解決契約化まで反映済み |

レビュー実績: 両設計書とも Haiku(理解+矛盾)+Grok(独立反証・公式仕様裏取り)を通過。MCP 化はこの過程で撤回し C1 へ転換。

## 実装セッション用プロンプト(最終版)

```markdown
# 依頼: metatron+sandalphon プラグインの実装(Opus Dynamic Workflow テスト)

承認済み設計書 2 本を読み、これに従って実装する。
- harness-docs/design/2026-08-16-metatron-design.md
- harness-docs/design/2026-08-16-sandalphon-design.md

## この依頼の特別ルール

- 今回は Opus による Dynamic Workflow のテストを兼ねる。オーケストレーションには Workflow ツールを使う(ワークフロー使用を明示的に許可する)。
- agent-policy の GPT/Grok 帯への委譲は今回行わない。実装・探索・レビューはすべて Claude モデル(Workflow のサブエージェント)で構成する。
- 規模はタスクに合わせて動的に決める。並列化できる独立作業(metatron の lib/CLI/hooks、sandalphon のスキル 3 種+検出スクリプト、codiel/gh-utility 改修)は並列に、検証・レビューはワークフローの verify ステージに置く。
- 着手前に、両設計書の理解とワークフロー編成計画(フェーズ・エージェント数・並列構成)を提示し、承認を得てから実行する。

## 作業範囲と順序(各設計書の実装手順節に従う)

1. metatron ファイル契約の凍結(metatron 設計 N0。マーカー名・config スキーマ・パス解決規則・既定パス)— 全作業の先行依存
2. plugins/metatron 本体: 共有ライブラリ(src/lib)、CLI(scripts/ バンドル)、PreToolUse deny hook、SessionStart 注入 hook、commands/init、skills、references(フォーマット正本)、README、plugin.json、package.json、build.ts
3. plugins/sandalphon 本体: commands/run、skills(capturing-intent / bridging-execution / executing-intent)、check-intent-env(契約の独立実装)、references(intent 文書・intent-issue・handoff-contract 正本)、README、plugin.json、package.json、build.ts
4. codiel 改修(マイナー上げ): initializing-harness 縮小+最小 domains フォールバック、readDomains/ルート解決の契約追随、recording-gotchas の 2 分岐+拒否時リカバリ、analyzing-issues(intent 写像)、preparing-design-agendas(合意済み除外)、agents 12 ファイル 23 箇所の固定パス除去(prompt-smith:agent-creator 経由)、CLAUDE.example.md / ARCHITECTURE.example.md の宣言訂正
5. gh-utility 改修(パッチ上げ): issue-craft の持ち込みモード(固定開始句契約)
6. 登録・反映: marketplace.json、pnpm-workspace.yaml、ルート README.md

## 順守事項(CLAUDE.md より特に)

- Skills の作成・改修は prompt-smith:skill-creator、Agents 定義は prompt-smith:agent-creator、references/ 等の AI 向け文書は prompt-smith:prompt-smith を使う。
- TypeScript / Markdown の編集は Serena を使う。
- src/ 変更後は pnpm build を実行し、生成物差分を同じコミットに含める。
- コミット前に pnpm lint・pnpm typecheck・pnpm test を通す。
- Anthropic API・ANTHROPIC_API_KEY 前提の実装はしない。MCP サーバーは作らない(設計で撤回済み。C1 構成に従う)。
- 設計書と実装が食い違う判断が必要になったら、実装を止めてユーザーに確認する。
- 両設計書の「未解決事項」節に残る選択肢は、着手前の編成計画提示時に推奨案とともに確認を取る。

## 完了条件

- pnpm build / lint / typecheck / test が全通過している(両設計書のテスト計画のケースを含む)。
- 新規スキルが skill-creator の評価手順を通っている。
- 機能単位でコミットされている。
- 結果報告に、作成・変更ファイル一覧と、Workflow 実行の構成(フェーズ・エージェント数・token 規模)を含める。
```

## 残タスク(このセッション外)

1. 両設計書のユーザーレビュー(修正指示あればこのセッションで反映可)
2. 設計書 2 本+`docs/chat/` 記録のコミット(指示があれば実行)
3. 別セッションで上記プロンプトを実行(実装)
4. 別件: chat-history の `commit-chat-recording.mjs` で `plan.sessionNumber` 検証エラーが断続的に発生(抗体作成済み・記録は最終的に成功)— 余裕があれば調査タスク化を推奨

蒸留完了(新規抗体 1 件・重複 2 件)。設計フェーズの成果物は前回報告のとおり提示済み — 設計書 2 本のレビューと実装プロンプトの確認待ち。

# phyllis998

> ARCHITECTURE.mdとGOTCHAS.mdの内容についてです。
> これらは基本的にAIが読む為のモノになります。したがってprompt-smithの基準が適用されると考えます。
> Metatronにこの基準を入れ込むことはできますか？これら2つの文書用に最適化したいです。
> それと、これら2つの文書の書式も変更したいと考えています。
>
> [ARCHITECTURE.md]
> - 冒頭に"システム概要"として、システム全体のアーキテクチャ図(Mermaid図)を追加したい
> - 技術スタック表の下に、"レイヤー構造"として、レイヤー構造と依存方向、禁止される依存方向を明記したいです。
> - ファイルの末尾に、"ADR一覧"として、システム開発におけるアーキテクチャの重要な設計判断を追加していく形にしたいです。ただし、本当に重要であるもののみを対象とする。
>
> ---
>
> ### ADR-001: [判断のタイトル]
>
> - 状態: 採用/提案/廃止
> - 決定日: YYYY-MM-DD
> - 決定者: [氏名またはチーム名]
>
> #### 背景
>
> (何を決めようとしたか、どういう制約があったか)
>
> #### 検討した選択肢
>
> 1. [選択肢A]: メリット/デメリット
> 2. [選択肢B]: メリット/デメリット
> 3. [選択肢C]: メリット/デメリット
>
> #### 採用した結論
>
> [選択肢X]を採用する。
>
> #### 理由
>
> (なぜこの選択肢が最適と判断したか)
>
> #### 影響範囲
>
> (この判断が影響する範囲、制約を受ける他の判断)
>
> ---
>
> [GOTCHAS.md]
> ファイルの内容を丸ごと変えたいです。
> 具体的には、以下の内容をそのまま採用したいです。
>
> # GOTCHAS
>
> このファイルは、プロジェクトで AI が実際にやってしまった失敗のパターンを蓄積するためのものです。
> 運用していく中で発見された失敗を、規定のフォーマットに沿って追記していきます。
>
> ## 運用ルール
>
> - 失敗を発見したら、**新しいものを上に**追加する。
> - 5件以上同じパターンが蓄積されたら、スキル or Hook への昇格を検討する。
> - 解決済みのものは `[解決済み]` 、陳腐化されたものは `[対象外]` タグを付けて残す (削除しない)
>
> ## 記入テンプレート
>
> 以下をコピーして使ってください。
>
> ```markdown
> ### [YYYY-MM-DD] GOTCHA-NNN: 失敗のタイトル
>
> **タスク**: (何をしようとしていたか)
>
> **失敗内容**: (具体的に何を間違えたか)
>
> **原因 (推測)**: (なぜそうなったか)
>
> **対策**: (今後 AI はどう振る舞うべきか)
>
> **翔鶴候補**: yes / No (スキルや Hook にするべきか)
> ```
>
> ---
>
> ## 失敗パターン一覧
>
> (失敗をここに列挙する)

# AI

ARCHITECTURE.md と GOTCHAS.md について、両者ともに **prompt-smith 基準を適用した文書としてメタトロン設計に組み込める**ことを確認しました。設計書に反映します。

**ARCHITECTURE.md** は以下の構成に変更します:
1. 冒頭に「システム概要」としてシステム全体を表す Mermaid アーキテクチャ図を配置
2. 技術スタック表の直後に「レイヤー構造」セクションを追加(依存方向・禁止される依存を明記)
3. ファイル末尾に「ADR 一覧」セクションを追加(重要な設計判断のみ。ADR-001 から順に追加)
4. ADR のテンプレートはユーザーが示した形式をそのまま採用

**GOTCHAS.md** は新規フォーマットに完全置換します:
- 運用ルール 3 項(新規追加の位置・昇格基準・タグ戦略)
- 記入テンプレート(タスク/失敗内容/原因/対策/昇格候補)
- 失敗パターン一覧区間(運用開始時は空)

両文書とも Metatron の references セクションに配置し、プラグインの README で「AI 向けドキュメント」として位置付けます。設計書への反映は 1 時間以内に完了予定です。

# phyllis998

> 共有TypeScriptライブラリとは、codielとmetatronの共有という解釈であっていますか？

# AI

半分違う。正確には:

## 「共有ライブラリ」の第一義 = **metatron 内部の 3 実行文脈の共有**

```
metatron の共有ライブラリ(パース・検証・採番・パス解決)
  ├─ CLI(record-gotcha 等)        ← AI の書き込み窓口
  ├─ PreToolUse deny hook          ← 直接編集の拒否判定
  └─ SessionStart hook             ← 注入時の読み取り・要約
```

MCP 案の問題「検証ロジックがサーバー内に閉じ、hook(MCP 不可の文脈)と二重実装になる」の解消が主目的。

## Codiel とのランタイム共有は**不可**

プラグインは独立配布でインストールパスが互いに不定(`CLAUDE_PLUGIN_ROOT` は自プラグインのみ)。Codiel のバンドル済み hook が metatron のバンドルを import することはできない。**プラグイン間で共有するのは「コード」ではなく「ファイル契約」**(metatron.config.json のスキーマ+マーカー形式+文書パス既定値)。Codiel は自前の lib(既存 lib.ts)でその契約を読む。

## ただし、ソースレベル共有は可能(選択肢)

このリポジトリはモノレポなので、契約の読み取り実装(config 解決+マーカー抽出)を workspace パッケージとして 1 本書き、**codiel と metatron 双方の build.ts が各自のバンドルに焼き込む**ことはできる。配布後も各プラグインは自分のコピーを持つので独立性は保たれる。Metatron 設計書の執筆エージェントが挙げた懸念 2「パス解決規則の実装が 3 つ(metatron / codiel / sandalphon)になる」の軽減策になる — 実装は 1 ソース、バンドルは 3 つ、ズレはビルド時点で同一。

C1 確定時はこのソース共有方式も設計書へ含める想定。C1 で確定してよいか?

C1 確定の回答待ち。

# phyllis998

> 無理に共有することはないです。
> もう一つの論点として、利用者がcodielのみを使う場合、Metatronが提供するARCHITECTUREとGOTCHASは持ちません。Codiel単体ではそれを参照しないようにできますか?

## セッション 13: メタトロン設計書統合と依存関係設計確定

## セッション 13: メタトロン設計書統合と依存関係設計

# AI

可能。統合方針を決めて改稿を dispatch する。

## 統合方針(設計への落とし込み)

**1. prompt-smith 基準の組み込み**

- プラグイン間参照は不可 → prompt-smith の基準(削る/残す/書き方)から **ARCHITECTURE/GOTCHAS 向けに特化した執筆規律を metatron の references/ に正本として焼き込む**
- 適用の使い分けを規律化: 常時注入される部分(概要・レイヤー構造・技術スタック等)は削る基準を強く適用(注入 10k 予算に直結)。ADR 一覧・GOTCHAS エントリは prompt-smith のいう「引くための記述」に該当し、削る基準の例外+書式厳守で扱う
- 機械検証(CLI)は構造・スキーマまで。文体基準の適用はスキル側の執筆規律(検証の責務分界を明記)

**2. 書式変更の影響処理**

- ARCHITECTURE: 3 節追加(冒頭「システム概要」Mermaid 図 / 技術スタック直下「レイヤー構造」依存方向+禁止依存 / 末尾「ADR 一覧」重要判断のみ)→ stage-architecture の heading キー拡張、ADR 追加も stage→commit 経由(承認必須の性質に合致)、注入縮退規則に「ADR はタイトル一覧へ縮退」を追加
- GOTCHAS: 指定書式を全面採用。設計との整合調整 — 先頭追加(新しいものを上)に append-gotcha の挿入位置・採番ロジックを変更、[解決済み]/[対象外] タグは invalidate-gotcha の写像先に変更(「削除しない」は既存の追記のみ規律と整合)、「5 件同パターンで昇格検討」と Raphael 棲み分け節の整合を調整
- 1 点訂正: テンプレの「**翔鶴候補**」は「**昇格候補**」の変換ミスと判断し、そちらで採用(違ったら指摘を)

改稿 dispatch 済み(執筆規律の references 焼き込み+ARCHITECTURE 3 節追加+GOTCHAS 全面書式変更と CLI/注入/テストの追随)。完了後に変更点を報告する。

改稿完了待ち。

記録完了。書式変更の改稿完了待ち継続。

書式変更の反映完了(metatron 設計書: 2235 行)。

## 反映内容

**A. AI 向け執筆規律**(§6-5 新設): prompt-smith の 3 基準(削る/残す/書き方)を 2 文書向けに特化し `references/writing-discipline.md` へ正本として焼き込み。常時注入節は削る基準を強く適用、ADR・GOTCHAS エントリは「引くための記述」として例外(書式厳守+簡潔化のみ)。CLI は構造検証まで、文体はスキルの責務と分界。

**B. ARCHITECTURE 3 節追加**: 冒頭「システム概要」(Mermaid 必須)/技術スタック直下「レイヤー構造」(禁止依存の明記)/末尾「ADR 一覧」(指定書式・stage→commit 承認・ADR-NNN 採番)。10 セクション構成へ。注入では ADR はタイトル+状態一覧のみ(全文は `get adr`)。

**C. GOTCHAS 全面刷新**: 指定書式を採用(新しいものを上・5 件で昇格検討・タグで残す・新テンプレート)。先頭挿入に伴い採番と原子性設計を調整。Raphael 棲み分けは「別リポジトリでも同じ対策が要るか」の 1 問判定+「昇格先はプロジェクトのスキル/Hook(Raphael 抗体ではない)」で整合。

## 設計者判断 3 点(異議あれば指摘を)

1. **`invalidate-gotcha` → `tag-gotcha` へ改名**(`[解決済み]` は「無効化」ではないため名前を実態に合わせた)
2. **`overview` 疑似キー廃止**(「システム概要」節の新設で見出しなし区画の歪みが消えたため統合)
3. **ADR の「本当に重要」= 3 条件の論理積**(覆すコストが大きい/選択肢が実在した/理由が自明でない)— 運用で調整可能な仮置き

実装上の注意として「Mermaid ブロック内の `##` をセクション見出しと誤認しない解析」がテスト対象に追加済み(A13)。

設計書 2 本+実装プロンプト(前掲)は最終状態。レビューして問題なければ、コミット指示または実装セッションへ。

# phyllis998

> 一応設計書のレビューを通してください

# AI

ARCHITECTURE.md と GOTCHAS.md について、両者ともに **prompt-smith 基準を適用した文書としてメタトロン設計に組み込める**ことを確認しました。設計書に反映します。

**ARCHITECTURE.md** は以下の構成に変更します:
1. 冒頭に「システム概要」としてシステム全体を表す Mermaid アーキテクチャ図を配置
2. 技術スタック表の直後に「レイヤー構造」セクションを追加(依存方向・禁止される依存を明記)
3. ファイル末尾に「ADR 一覧」セクションを追加(重要な設計判断のみ。ADR-001 から順に追加)
4. ADR のテンプレートはユーザーが示した形式をそのまま採用

**GOTCHAS.md** は新規フォーマットに完全置換します:
- 運用ルール 3 項(新規追加の位置・昇格基準・タグ戦略)
- 記入テンプレート(タスク/失敗内容/原因/対策/昇格候補)
- 失敗パターン一覧区間(運用開始時は空)

両文書とも Metatron の references セクションに配置し、プラグインの README で「AI 向けドキュメント」として位置付けます。設計書への反映は 1 時間以内に完了予定です。

# phyllis998

> 共有TypeScriptライブラリとは、codielとmetatronの共有という解釈であっていますか？

# AI

半分違う。正確には:

## 「共有ライブラリ」の第一義 = **metatron 内部の 3 実行文脈の共有**

```
metatron の共有ライブラリ(パース・検証・採番・パス解決)
  ├─ CLI(record-gotcha 等)        ← AI の書き込み窓口
  ├─ PreToolUse deny hook          ← 直接編集の拒否判定
  └─ SessionStart hook             ← 注入時の読み取り・要約
```

MCP 案の問題「検証ロジックがサーバー内に閉じ、hook(MCP 不可の文脈)と二重実装になる」の解消が主目的。

## Codiel とのランタイム共有は**不可**

プラグインは独立配布でインストールパスが互いに不定(`CLAUDE_PLUGIN_ROOT` は自プラグインのみ)。Codiel のバンドル済み hook が metatron のバンドルを import することはできない。**プラグイン間で共有するのは「コード」ではなく「ファイル契約」**(metatron.config.json のスキーマ+マーカー形式+文書パス既定値)。Codiel は自前の lib(既存 lib.ts)でその契約を読む。

## ただし、ソースレベル共有は可能(選択肢)

このリポジトリはモノレポなので、契約の読み取り実装(config 解決+マーカー抽出)を workspace パッケージとして 1 本書き、**codiel と metatron 双方の build.ts が各自のバンドルに焼き込む**ことはできる。配布後も各プラグインは自分のコピーを持つので独立性は保たれる。Metatron 設計書の執筆エージェントが挙げた懸念 2「パス解決規則の実装が 3 つ(metatron / codiel / sandalphon)になる」の軽減策になる — 実装は 1 ソース、バンドルは 3 つ、ズレはビルド時点で同一。

C1 確定時はこのソース共有方式も設計書へ含める想定。C1 で確定してよいか?

C1 確定の回答待ち。

# phyllis998

> 無理に共有することはないです。
> もう一つの論点として、利用者がcodielのみを使う場合、Metatronが提供するARCHITECTUREとGOTCHASは持ちません。Codiel単体ではそれを参照しないようにできますか?

## セッション 14: 設計書確定・Codiel単体での参照管理検討

# AI

再レビュー実施(書式変更後の metatron 設計書が対象。sandalphon との契約整合も確認)。Haiku+Grok 並列 dispatch。

両レビュー dispatch 済み(Haiku: 全体+2 設計書間整合、Grok: 改稿部分集中・処理済み論点は除外)。完了後に採否判断して報告する。

レビュー完了待ち。

Haiku 再レビュー完了: 矛盾なし・旧仕様残存なし・2 設計書間の契約整合も確認済み。Grok 再レビュー(改稿部分の反証)の完了待ち。

記録完了。Grok 再レビューの完了待ち継続。

Grok 再レビューの完了待ち継続。

Grok 再レビュー完了 — 改稿部分に実質的な指摘あり(自己矛盾 1 件・破壊経路 1 件・規範不足・更新漏れ)。採否判断して最終修正を dispatch。

レビュー結果と対応状況:

## 再レビュー結果

**Haiku**: 矛盾・不整合なし。旧仕様の残存なし。2 設計書間の契約(マーカー・config・パス解決・codielReady 式・CLI 形式)も全一致。

**Grok(改稿部分集中)**: 有効な指摘あり。重大 5 件を採用:

1. **自己矛盾**: GOTCHAS を「引く記述=通読させない」例外としつつ直近 N 件を全文注入している → 例外の定義を「根拠フィールドを削らない」に限定し、簡潔化は全面適用へ
2. **ADR 破壊経路**: stage-architecture の「ADR 一覧」丸ごと差し替えで採番・検証・削除禁止をすべて迂回できた → ADR 一覧の変更を stage-adr に一本化(他経路はエラー)
3. **セクション分割の規範不足**: Mermaid フェンス内 `##` の扱いがテスト期待にしかない → フェンス状態機械を規範アルゴリズムとして本文化、注入も同一パーサと明記
4. **ADR 状態変更理由が書式上どこにも残らない** → GOTCHAS タグと対称の「状態変更行」追記書式を定義
5. **Codiel 単体の直接追記が新書式(先頭挿入・雛形)に未追随** → recording-gotchas 改修仕様へ明記

中規模 7 件(段階番号の更新漏れ・CLI 案内追随・ロック対応明確化・タグ検出規則・実測値修正・Mermaid 図の抑制規律・昇格候補の集計オプション)も採用。不採用 2 件(人間手編集のロストアップデート=git 保険で受容、縮退順序変更)。

最終修正を執筆エージェントへ dispatch 済み。完了報告をもって設計書は確定版とする。

再レビューの採用指摘 12 件の反映完了。**設計書 2 本、確定版**。

## レビュー工程の最終結果

| 設計書 | 状態 |
|---|---|
| `harness-docs/design/2026-08-16-metatron-design.md`(16 節・2426 行) | レビュー 3 巡(初回 Haiku+Grok → C1 転換後 Haiku+Grok → 書式変更後 Haiku+Grok)を通過。最終巡の指摘もすべて採否処理済み |
| `harness-docs/design/2026-08-16-sandalphon-design.md`(15 節・1360 行) | レビュー済み+metatron 契約との整合を Haiku が最終確認(食い違いなし) |

最終巡で直った主要点: 執筆規律の例外定義を「根拠系フィールドを削らない」に限定(全文注入との自己矛盾解消)、ADR 変更経路を stage-adr へ一本化(破壊経路封鎖)、フェンス状態機械の規範化(Mermaid 内 `##` 問題)、ADR 状態変更理由の永続化書式、Codiel 単体追記の新書式追随、実測値ベースの注入予算見積もり(約 11,400 文字 → 9,000 予算のため GOTCHAS 蓄積時は縮退が通常運用で発動する旨明記済み)。

## 残タスク

1. 設計書 2 本+会話記録のコミット(指示があれば実行)
2. 別セッションで実装プロンプト(前掲・変更不要)を実行 — Opus Dynamic Workflow テスト

# phyllis998

> 1. 設計書を承認します。会話記録も含めてコミットしてください。
> 2. プロンプトを改めて書き出してください

## セッション 14: 設計書確定・Codiel単体での参照管理検討

# phyllis998

> 無理に共有することはないです。
> もう一つの論点として、利用者がcodielのみを使う場合、Metatronが提供するARCHITECTUREとGOTCHASは持ちません。Codiel単体ではそれを参照しないようにできますか?
