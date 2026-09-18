# 2026-09-17 測定改善の実機確認

## 隔離の実機確認(段 1)

### 測定の条件

- 日付: 2026-09-18
- `claude --version`: 2.1.274 (Claude Code)
- 対象コミット: S1-6 完了時点(`0eb83e2`)と診断出力の修正(`1626bff`)
- probe 資産: `~/prompt-smith-probe/`。リポジトリ外の一時資産であり、commit しない。
- probe スキル名: `ps-isolation-probe`。CLI 組み込みスキルとの競合を排除するため、無意味語 `ZZQPROBE` を使う。
- probe eval: 3 問。すべて `should_trigger: true`。

### 相 1: 対照とガード

リポジトリ外の空ディレクトリから実行した。

- `init` イベントの `skills` 件数は、対照 17、隔離 17 だった。
- 隔離側の 17 件は、CLI 組み込みスキルの名前と完全に一致した。名前は `batch`、`claude-api`、`code-review`、`dataviz`、`debug`、`deep-research`、`design`、`design-sync`、`doctor`、`fewer-permission-prompts`、`loop`、`run`、`run-skill-generator`、`simplify`、`update-config`、`verify`、`workflow-authoring` である。
- `~/.claude/skills/<name>/SKILL.md` は 0 件だった。実体は `~/.claude/skills/synced/<uuid>/<name>/SKILL.md` と 2 階層深い位置にあり、読み込み対象外である。
- `init.skills` に載るのは CLI 組み込みとユーザースキルだけであり、プラグインが同梱するスキルは載らない。
- hook イベント数は、対照が 2 件(`SessionStart:startup`)、隔離が 0 件だった。
- `TMPDIR` ガードでは、`TMPDIR` をリポジトリ配下にして `run-trigger-eval.mjs` を起動すると終了コード 1 になった。`claude` は 1 プロセスも起動しなかった。`createSandbox` が `spawn` より前で throw するためである。stderr には `.claude` の絶対パスと、`TMPDIR` を `.claude` を持たない場所へ変える対処が出た。

### 相 2: 基準点

- `git status --porcelain=v1` の行数は 11 だった。
- `~/.claude/backups/` の件数は 0 だった。

### 相 3: 我々のコードを通す

リポジトリルートから実行した。

- 改善案生成の経路(`callClaudeText`)の出力は `<probe>OK</probe>` のみだった。hook の通知への応答は混ざらなかった。
- 陽性対照として `run-trigger-eval.mjs` を 3 問 × 1 実行した。`summary` は `{"total":3,"passed":3,"failed":0}` であり、各問の `trigger_rate` は 1.0 だった。

### 相 4: 照合

- `git status --porcelain=v1` は前後で完全に一致し、差分はなかった。
- `~/.claude.json` は JSON としてパースでき、`.claude.json.tmp.*` の残骸は 0 件だった。
- `~/.claude/backups/` の件数は、前 0、後 0 だった。
- 出力 JSON の `errors` は 0 だった。
- `environment` は `{"base_url":"http://127.0.0.1:8317","auth_source":"ANTHROPIC_AUTH_TOKEN","model":"sonnet"}` だった。トークンの値は含まれない。

### 既定モデルのライブ確認(段 2)

`--model` を省いたときに既定の `sonnet` が実際に使われることを、CLI から確認した。単体テストはライブラリ関数を直接呼ぶ経路だけを対象にしており、`main` が `values.model` をそのまま渡す経路はライブ起動でしか通らない。スモークテストは引数なしで起動するため、`--model` より手前の他の必須チェックで失敗する。

段 1 と同じ `~/prompt-smith-probe/` の probe 資産を使い、3 エントリを `--model` 無しで起動した。

- `run-trigger-eval.mjs` は終了コード 0 だった。`environment.model` は `"sonnet"`、`errors` は 0、`summary` は `{"total":3,"passed":3,"failed":0}` だった。
- `run-loop.mjs` は終了コード 0 だった。`environment.model` は `"sonnet"`、`exit_reason` は `"all_passed (iteration 1)"` だった。probe が全問通ったため、改善案生成は呼ばれなかった。
- `improve-description.mjs` は終了コード 0 だった。`<new_description>` を含む応答を 1 回で取得し、stdout に `description` が出た。このエントリの出力は `environment` を持たない。
- `git status --porcelain=v1` は前後で完全に一致した。

## eval 差し替えの種別台帳

段 5 の測定では、基準 6 の問（担当境界の正例）の合否を他の true 問と分けて拾う必要がある。eval セットの JSON スキーマは `query` と `should_trigger` の 2 キーから変えないため、種別を追える手段はこの台帳だけである。

### 種別

- **基準 5** — 現行 description に出てくる行為を指す語をそのまま含んでいた問を、同じ意図の別語彙で言い直したもの。
- **基準 6-内部** — 同じプラグイン内の別スキルが担当しそうに見えて、実はこのスキルが担当する依頼。
- **基準 6-外部** — CLI 組み込みスキルが担当しそうに見えて、実はこのスキルが担当する依頼。
- **起動経路の被覆** — そのスキルが最も素直に想定している言い回しが eval に 1 問も無かったため足したもの。
- **レビュー・監査の被覆** — 実際の依頼で最もよく使われる語が、基準 5 の言い換えで全問から消えていたため戻したもの。
- **AI の問題起点** — ARCHITECTURE と GOTCHAS が AI のための文書であることに対応し、「AI がうまく動かない」を起点とする依頼。

### 対応表

| eval ファイル | index | query | 種別 |
| --- | ---: | --- | --- |
| `plugins/prompt-smith/evals/prompt-smith.json` | 0 | `plugins/cobalt-reef/skills/renewal-check/SKILL.md` の説明欄が広すぎるように見えるので見てほしいのですが、説明欄は変えないでください。実際には、`renewal_date` が空のときの確認順、`account_state=closed` の停止条件、重複した例の扱いを本文で整理し、担当者が迷わず処理できる規則にしたいです。 | 基準 6-内部 |
| `plugins/prompt-smith/evals/prompt-smith.json` | 1 | 青嶺モビリティの `CLAUDE.md` で『注意して確かめる』とある箇所を、CIが落ちた時の対応に具体化したいです。`apps/fleet/` で `contract_status=paused` の場合を例に、確かめるための処理を行う順番を決め、移行の経緯を述べた段落は取り除いてください。 | 基準 5 |
| `plugins/prompt-smith/evals/prompt-smith.json` | 2 | `plugins/oak-signal/commands/escalate.md` のAI向け指示書をレビューしてください。`ticket_url`、障害等級、顧客影響がそろわない場合の質問順と、P1だけに要求する報告先に矛盾がないか確かめ、判断が分かれる箇所と似た出力例を整理したいです。descriptionは変えないでください。 | レビュー・監査の被覆 |
| `plugins/prompt-smith/evals/prompt-smith.json` | 3 | 問い合わせの内容から緊急度と対応部署を判断し、判断理由も添えるプロンプトを作ってください。曖昧な依頼への確認方法、出力形式、誤った断定を避けるルールまで設計したいです。 | 起動経路の被覆(プロンプトの新規作成) |
| `plugins/prompt-smith/evals/prompt-smith.json` | 4 | このファイルを簡潔にしてレビューしてください。`plugins/opal-summit/output-styles/outage-update.md` は障害連絡用のAI向け指示書で、`severity` と `customer_impact` に応じた書き分けが説明に埋もれています。判断できない言い回しと重複した時刻規則を洗い出し、運用中に使える内容へまとめたいです。 | 基準 6-外部 |
| `plugins/prompt-smith/evals/prompt-smith.json` | 7 | `plugins/mist-garden/skills/catalog-repair/SKILL.md` の既存プロンプトを修正して、商品URLの再試行回数と `sku_state=retired` の除外条件を加える動きを追加してください。現場担当が参照するエラーコード一覧は残したまま、本文の順序・例・禁止事項を整合するよう見直したいです。 | 起動経路の被覆(プロンプトの修正・追加) |
| `plugins/prompt-smith/evals/prompt-smith.json` | 9 | 東港商事の `plugins/dawn-works/commands/settlement-runbook.md` は、外貨の端数処理と `ledger_date` の決め方が食い違っています。作業の流れを組み替え、勘定科目表は引ける状態で残したまま、同じ規則の繰り返しや解釈が一通りに定まらない箇所を洗い出してください。 | 基準 5 |
| `plugins/prompt-smith/evals/agent-creator.json` | 0 | 経理チームの問い合わせを一次整理して担当別に引き継ぐエージェントを作りたいです。対象外の依頼を見分ける基準、親に渡す情報、必要最小限のtoolsとmodel設定まで含めて設計してください。 | 起動経路の被覆(エージェントの新規作成) |
| `plugins/prompt-smith/evals/agent-creator.json` | 1 | 北条製薬の `plugins/iron-grove/agents/contract-reader.md` は、契約PDFから期限と自動更新を抜き出す係なのに、交渉まで引き受ける状態です。記録を書き換えることとシェル実行を許さず、受け持つ範囲、先頭の設定欄、上位の担当へ返す項目を照合して、ずれをなくしてください。 | 基準 5 |
| `plugins/prompt-smith/evals/agent-creator.json` | 2 | `plugins/copper-cove/agents/claims-triage.md` の言い回しを読みやすくしたいです。ただし、中心にある問題は `Read, Bash, Write` を全部許していることと、照合結果の報告に加えて返金判断まで受け持たせていることです。請求番号と `claim_state` を調べる係だけに絞るため、許可操作、責務、親への返答項目を見直してください。 | 基準 6-内部 |
| `plugins/prompt-smith/evals/agent-creator.json` | 4 | 社内の調査作業を任せる Agents 定義を整えたいです。情報を収集して根拠つきで親へ報告する役割について、責務境界、許可する操作、入力と出力の契約、配置先を決めてください。 | 起動経路の被覆(Agents 定義) |
| `plugins/prompt-smith/evals/agent-creator.json` | 7 | 権限の確認が多くて煩わしいです。`plugins/cedar-fog/agents/release-noter.md` では、変更を保存する操作やシェル実行まで許可されていますが、リリース番号と `deploy_at` を読むだけの係にしたいです。確認を減らす設定を足すのではなく、この定義の許可範囲と親へ返す内容を必要最小限にしてください。 | 基準 6-外部 |
| `plugins/prompt-smith/evals/agent-creator.json` | 8 | 舟影不動産の `plugins/glass-quay/agents/listing-evidence.md` のAgent定義を監査してください。物件URLと `listing_id,ward,updated_at` から記載漏れの証拠箇所だけを列挙する責務に照らし、過剰なtools、親への返答形式、ユーザーへ連絡しない制約、model設定が整合しているか見直したいです。 | レビュー・監査の被覆 |
| `plugins/prompt-smith/evals/agent-creator.json` | 9 | 月次費用の集計係 `plugins/glass-cedar/agents/cost-observer.md` について、使える手段を絞り込み、冒頭の識別子と短い案内文が呼び出す場面を示せているか、手順内に予算を動かすよう促す文が紛れ込んでいないかを照らし合わせて、該当する部分を改めてください。 | 基準 5 |
| `plugins/prompt-smith/evals/skill-creator.json` | 2 | 購買部の月次登録用に `plugins/atlas-forms/skills/vendor-intake/` の入口文を見直したいです。添付PDFと `vendor_code` の確認を頼む会話だけが選ばれるよう候補を比べ、20件ほどの発話例で誤った呼び出しを数え、もっとも区別できる表現に改めてください。 | 基準 5 |
| `plugins/prompt-smith/evals/skill-creator.json` | 3 | 毎週のふりかえりで、議論と前回のアクションを整理して次の担当を決めるみたいなことをするスキルが欲しいです。どこに置くか、必要な参照情報、発火条件、出力を確かめる会話例まで考えてください。 | 起動経路の被覆(抽象的な作成依頼) |
| `plugins/prompt-smith/evals/skill-creator.json` | 4 | 人事CSVの列名が `dept_name` から `division` に変わった `plugins/marble-station/commands/import-members.md` で、試行だけの実行、件数の食い違い、空欄を尋ね返す流れまで扱えるようにしたいです。実行手順を改めるだけでなく、呼び出す場面が伝わる先頭の案内と、結果の良し悪しを確かめる観点も用意してください。 | 基準 5 |
| `plugins/prompt-smith/evals/skill-creator.json` | 6 | 社内の移行窓口で使う `plugins/amber-arch/commands/schema-diff.md` のコマンド定義をレビューしてください。エクスポート済みDDL URLと対象テーブル一覧を受け取る用途について、破壊的変更・ロールバック手順・確認質問の扱い、frontmatter、参照資料、期待出力が矛盾なく分かれているか見直したいです。 | レビュー・監査の被覆 |
| `plugins/prompt-smith/evals/skill-creator.json` | 8 | `plugins/jetty-craft/skills/incident-labeler/SKILL.md` の手順を読みやすく直したいです。ところが、実際に困っているのは `incident_ref` と `severity` を含む会話で選ばれず、対象外の障害報告にも反応することです。説明欄の候補を比べ、発話例を20件作って選択の誤りを確かめながら、もっとも区別できる表現へ改めてください。 | 基準 6-内部 |
| `plugins/prompt-smith/evals/skill-creator.json` | 9 | 店舗改装プロジェクトの `fixture-plan` を用意したいです。店舗図面URL、改装日、拠点名、`fixture_batch` から準備手順を出す用途について、`plugins/atlas-lab/skills/` に含めるか `.claude/skills/` に置くかを決め、必要な参照資料や定型素材を仕分けし、近いが使わない相談も含む検証用の会話セットを組みたいです。 | 基準 6-外部 |
| `plugins/metatron/evals/capturing-architecture.json` | 0 | サブエージェントやコーディングエージェントがこのリポジトリの構成を繰り返し取り違え、そのたびに apps/ と packages/ の責務を説明し直しています。原因を調べると ARCHITECTURE がまだ 1 枚もありませんでした。コードと rules を確認して初版の ARCHITECTURE を作り、各節を確認しながら定着させてください。 | AI の問題起点 |
| `plugins/metatron/evals/capturing-architecture.json` | 1 | 新しく導入した AI ツールが各ディレクトリの責務を取り違え、変更先を誤る状態です。確認したところ、このリポジトリには ARCHITECTURE がまだ 1 枚もありません。コードベースと rules を調べ、技術スタック・構造・ディレクトリ責務を含む初版を、内容を確認しながら作成してください。 | AI の問題起点 |
| `plugins/metatron/evals/capturing-architecture.json` | 2 | `/codiel:init` 後の `docs/ARCHITECTURE.md` は `## ドメインマップ` の一節だけです。既存のマップを維持したまま、リポジトリと rules を調べて不足する技術スタック・レイヤー構造・検証手順の草案をそろえ、節ごとに確認しながら通常の構成へ整えてください。 | 基準 6-内部 |
| `plugins/metatron/evals/capturing-architecture.json` | 4 | 開発参加者が参照できるよう、`docs/ARCHITECTURE.md` が存在しないこのモノレポの技術資料を新設したいです。`apps/` と `packages/`、ワークスペース設定を調査し、技術要素・層ごとの責務・実行手順を草案化して、内容を確認しながら初回版を完成させてください。 | 基準 5 |
| `plugins/metatron/evals/capturing-architecture.json` | 7 | 四条プロダクツの受注システム、設計資料が Confluence と Slack に散らばってて全体像の文書がありません。コードベースを解析してアーキテクチャ文書に起こし、レイヤー構造とコマンド定義を確定させてください。 | 基準 6-外部 |
| `plugins/metatron/evals/capturing-architecture.json` | 9 | Next.js の画面、Hono のサービス、PostgreSQL、Vitest で構成する新規プロジェクトです。未作成の `ARCHITECTURE.md` に、各要素の関係とディレクトリの担当範囲、開発・検証コマンドを整理した参照資料を、実装を確認したうえでまとめてください。 | 基準 5 |
| `plugins/metatron/evals/updating-architecture.json` | 0 | `ADR-0015` として、単一クライアント化に伴い GraphQL から REST へ移行する選択を後から追える形に残したいです。関連する `ADR-0004` は根拠が失われているため、理由を整理して廃止扱いへ変更し、ARCHITECTURE との整合も確認してください。 | 基準 6-内部 |
| `plugins/metatron/evals/updating-architecture.json` | 1 | ドメインマップの `src/legacy/**` は削除済みで、`src/billing/` はどの区分にも載っていません。実在しない参照先と分類漏れを調べ、現在のディレクトリ構成が正しく表れるよう ARCHITECTURE の該当箇所を改めてください。 | 基準 5 |
| `plugins/metatron/evals/updating-architecture.json` | 2 | AI が既存の ARCHITECTURE の古い説明を正しいものとして扱い、実装と違う場所に変更を加えようとしています。実装と rules を突き合わせて不一致を洗い出し、ARCHITECTURE と必要な rules を整合するよう更新してください。 | AI の問題起点 |
| `plugins/metatron/evals/updating-architecture.json` | 4 | `.claude/settings.json` の設定を変更する相談に見えますが、`plugins/*/dist/` を直接変更できない運用へ切り替えました。`harness-docs/ARCHITECTURE.md` の `## 保護パス` と各領域の責務を、rules と実装を突き合わせて見直し、必要な記述を更新してください。 | 基準 6-外部 |
| `plugins/metatron/evals/updating-architecture.json` | 5 | AI が保護すべき領域を把握できず、直接変更してはいけない場所を触ろうとしています。現行の rules と実装上の管理方法を確認し、ARCHITECTURE の `## 保護パス` と対応する rules を更新して、保護対象と変更方法を一致させてください。 | AI の問題起点 |
| `plugins/metatron/evals/updating-architecture.json` | 8 | `infra/terraform/` は運用上、直接変更を受け付けない範囲になったのに、ARCHITECTURE と rules の `## 保護パス` に反映されていません。実際の管理方法と他の一覧を確認し、変更を制限する領域の記述を整合させてください。 | 基準 5 |
| `plugins/metatron/evals/recording-gotchas.json` | 0 | 別のセッションで作業したサブエージェントが、CLI の絶対パスを推測して実行し、以前と同じ失敗を繰り返しました。次のエージェントが回避できるよう、再発条件と具体的な対処を確認して GOTCHAS の台帳に記録し、関連する項目にも必要なタグを付けてください。 | AI の問題起点 |
| `plugins/metatron/evals/recording-gotchas.json` | 1 | Vitest の設定が不足するとテストが 0 件のまま成功する失敗は、対策を記録して一度は直したはずなのに別の AI の作業で再発しました。既存の GOTCHAS の台帳を確認し、対策が効かなかった条件を追記または更新して、再発箇所を識別できるタグを整えてください。 | AI の問題起点 |
| `plugins/metatron/evals/recording-gotchas.json` | 2 | `GT-0014` の lock 取得失敗は、再試行処理を導入してから発生しなくなりました。履歴は消さず、対策の内容を根拠に状態を解消済みとして印を付け、台帳のほかの項目との扱いも確認してください。 | 基準 5 |
| `plugins/metatron/evals/recording-gotchas.json` | 3 | `.claude/rules/` の読み込み順を誤った失敗を `GOTCHAS.md` の `GT-0011` に残していますが、実際には生成された rules が原因でした。事実を確認して修正版の記録を加え、従来の項目は理由付きで対象外にする印を付けてください。 | 基準 6-内部 |
| `plugins/metatron/evals/recording-gotchas.json` | 4 | `GT-0003` が想定していた `pnpm install` の挙動は、パッケージマネージャー更新後には当てはまらなくなりました。現在の条件を別の項目として記し、元の記録には理由を添えて対象外の印を付けてください。 | 基準 5 |
| `plugins/metatron/evals/recording-gotchas.json` | 9 | 今日の振り返りメモとして、`plugins/raphael/scripts/update-antibody.mjs` を使わず `.raphael/antibodies/` を手で直して更新を失った件を共有したいです。このリポジトリ固有の再発条件と回避手順を整理し、記録する価値を判断したうえで必要なら GOTCHAS に残してください。 | 基準 6-外部 |

### 補足

- 段 5 で使うのは基準 6 の 12 問（内部 6 問・外部 6 問）であり、`results[]` から手で拾う。
- `should_trigger: false` の 60 問は 1 文字も変更していない。
- 据え置いた問は、`updating-architecture` の 7 と 9、`recording-gotchas` の 5（いずれも AI の提案への回答という実運用の主経路を表す）と 8（既存の別語彙問）である。英語の問 3 問（`prompt-smith` の 6、`agent-creator` の 5、`skill-creator` の 5）も据え置いた。

## 発火測定の結果と判定(段 5)

### 測定の条件

- 日付: 2026-09-18
- 測定時刻: 11:32〜11:47
- CLI の版には食い違いがある。基準点の記録は 2.1.275 だが、16 本すべてを実行した版は 2.1.276 である。`~/.local/share/claude/versions/2.1.276` の切り替え時刻は 11:27:29 で、最初の測定(11:32:12)より前だった。16 本すべてを同じ版で測定しており、版は混在していない。
- eval セットの版: prompt-smith はコミット `85b2025`、metatron はコミット `0cdbd4b`
- 16 本すべての `errors` は 0 であり、`environment` は 1 種類で一致した。
- `git status --porcelain=v1` は測定の前後で完全に一致した。

### 集計値

#### ベースライン(6 スキル・360 spawn)

| スキル | description バイト | true 平均 | false 平均 | passed |
| --- | ---: | ---: | ---: | --- |
| `prompt-smith` | 1612 | 0.10 | 0.03 | 11/20 |
| `agent-creator` | 1154 | 0.20 | 0.03 | 12/20 |
| `skill-creator` | 518 | 0.63 | 0.00 | 17/20 |
| `capturing-architecture` | 587 | 1.00 | 0.00 | 20/20 |
| `updating-architecture` | 589 | 1.00 | 0.00 | 20/20 |
| `recording-gotchas` | 504 | 0.90 | 0.00 | 20/20 |

#### 比較 A(metatron 短縮前 vs 現行・360 spawn)

| スキル | 短縮前 バイト | 短縮前 passed | 現行 バイト | 現行 passed |
| --- | ---: | --- | ---: | --- |
| `capturing-architecture` | 1034 | 17/20 | 587 | 20/20 |
| `updating-architecture` | 766 | 17/20 | 589 | 20/20 |
| `recording-gotchas` | 1120 | 15/20 | 504 | 20/20 |
| **合計** | | **49/60** | | **60/60** |

#### 比較 B(現行 vs 600 バイト案・240 spawn)

| スキル | 現行 バイト | 現行 passed | 現行 true平均 | 短縮案 バイト | 短縮案 passed | 短縮案 true平均 | 短縮案 false平均 |
| --- | ---: | --- | ---: | ---: | --- | ---: | ---: |
| `prompt-smith` | 1612 | 11/20 | 0.07 | 658 | 16/20 | 0.93 | 0.30 |
| `agent-creator` | 1154 | 12/20 | 0.20 | 613 | 20/20 | 1.00 | 0.00 |
| **合計** | | **23/40** | | | **36/40** | | |

### 段 5 より前の測定値の扱い

段 5 より前に取ったすべての測定値を破棄した。理由は次の 4 点である。

1. 常駐していたユーザースキルとプラグインのスキルが、隔離により競争相手から消えた。
2. `readResultError` の導入で、起動失敗が発火 0 から分離され、母数が変わった。
3. 既定モデルが `sonnet` に固定された。
4. eval の問を差し替えた。

隔離直後のベースラインには 1 と 2 が同時に入っており、どちらがどれだけ効いたかは分離できない。

### 判定

- 比較 A(60 問)は短い側が 11 問優位、比較 B(40 問)は短い側が 13 問優位だった。閾値は 3 問である。
- 閾値 3 問の根拠は、既存の規律「1〜2 問の差で description や実装を疑わない」である。この規律を下回る差で規律を書き換えない。
- 両方が同じ方向を示したため、設計書 §13.4 の 5 分岐のうち「確定」を採る。
- 比較 B は 40 問であり、比較 A の 60 問より分解能が低い。

### 観測

1. **長さと発火率が逆相関している。** ベースラインで 500〜600 バイト帯の 4 本は true 平均が 0.63〜1.00、1100 バイト超の 2 本は 0.10〜0.20 だった。
2. **誤発火でも短い側が優れている。** `updating-architecture` の短縮前は false 平均 0.20 だが、現行は 0.00 だった。長い description は正例を取りこぼすだけでなく、負例も引き込んでいた。
3. **例外が 1 つある。** `prompt-smith` の 600 バイト案は false 平均が 0.07 から 0.30 へ上がった。true 平均は 0.07 から 0.93 へ改善したが、誤発火が増えたため passed は 16/20 に留まった。担当境界の記述は落としていない。
4. **基準 6 の問は長い description でほぼ全滅した。** 12 問のうち 7 問が長い側で 0.00 だった。担当境界の判断は description の長さに最も敏感である。
5. 基準 6 の 12 問のうち、両案とも 3/3 で通ったのは `updating-architecture` の 2 問だけだった。短縮前が 766 バイトと元々短く、差が出にくい帯にある。

#### 基準 6 の 12 問

| スキル | 種別 | index | 長い側 | 短い側 |
| --- | --- | ---: | ---: | ---: |
| `prompt-smith` | 内部 | 0 | 0.00 | 1.00 |
| `prompt-smith` | 外部 | 4 | 0.00 | 1.00 |
| `agent-creator` | 内部 | 2 | 0.00 | 1.00 |
| `agent-creator` | 外部 | 7 | 0.00 | 1.00 |
| `skill-creator` | 内部 | 8 | — | 0.33(ベースライン 1 点) |
| `skill-creator` | 外部 | 9 | — | 1.00(ベースライン 1 点) |
| `capturing-architecture` | 内部 | 2 | 0.00 | 1.00 |
| `capturing-architecture` | 外部 | 7 | 0.33 | 1.00 |
| `updating-architecture` | 内部 | 0 | 1.00 | 1.00 |
| `updating-architecture` | 外部 | 4 | 1.00 | 1.00 |
| `recording-gotchas` | 内部 | 3 | 0.00 | 1.00 |
| `recording-gotchas` | 外部 | 9 | 0.67 | 0.67 |

### 衝突の観測

- 対象: `agent-creator` / `--max-iterations 3` / `--holdout 0.4`
- `exit_reason`: `max_iterations (3)`

| 反復 | 案のバイト数 | train | test |
| ---: | ---: | --- | --- |
| 1 | 1154 | 7/12 | 5/8 |
| 2 | 712 | 7/12 | 5/8 |
| 3 | 1106 | 7/12 | 5/8 |

- 3 反復とも train 7/12・test 5/8 であり、スコアはまったく変わらなかった。
- `best_description` は反復 1 の原文(1154 バイト)で、どの反復も原文を上回らなかった。
- 衝突の判定条件は 2 つある。条件 1 は基準 6 の 2 問がすべての反復で不合格であること、条件 2 は案が予算の上限に張り付き、最終反復が初回より短くなっていないことである。
- 条件 2 は成立しない。予算 1154 に対して案は 712 まで縮み、最終 1106 は初回 1154 より短い。
- 条件 1 は評価できない。基準 6 の外部境界の問が holdout 側へ分割され、反復ごとの結果に現れなかった。内部境界の問は 3 反復とも 0.00 で不合格だった。
- したがって衝突が実在するとは判定しない。条件 1 が評価不能であることを記録する。

### 改善ループについての観測

- ループが生成した 712 バイトの案は、元の 1154 バイトと同じスコアだった。
- 一方、比較 B で人手により書いた 613 バイトの案は 20/20 を取った。
- 実装計画書の決定 D9(比較 B の案をループに作らせず実装担当が書く)を裏づける実測になった。ループの出力を測っていた場合、測っているものが「短縮の効果」なのか「そのループの出来」なのか分離できなかった。

### 運用注意

- `~/.claude/backups/` は測定の前後とも 0 件だった。
- 測定中に CLI の自動更新が走ると、その間マシンが停止しうる。今回 11:12〜11:27 に WSL が停止し、その時間帯に実行したパイロットは 60 spawn が軒並みタイムアウトした。タイムアウトは設計上 `not_triggered` に分類され、`errors` に計上されないため、全問が発火 0 で `errors` も 0 という結果になる。同じ 60 spawn は停止中に 10 分 40 秒、正常時に 36 秒だった。
- 測定中に他の重い並行セッションを走らせない。

## 短縮で誤発火が増えた要因(prompt-smith)

### 観測

`prompt-smith` の 600 バイト案では誤発火が増えた。一方、`agent-creator` の 600 バイト案は誤発火 0 を保った。

| スキル | 案 | true 平均 | false 平均 |
| --- | --- | ---: | ---: |
| `prompt-smith` | 現行 1612 バイト | 0.07 | 0.07 |
| `prompt-smith` | 短縮 658 バイト | 0.93 | 0.30 |
| `agent-creator` | 現行 1154 バイト | 0.20 | 0.00 |
| `agent-creator` | 短縮 613 バイト | 1.00 | 0.00 |

### 誤発火した問

`prompt-smith` の短縮案で新たに誤発火した `should_trigger: false` の問は 3 問だった。いずれも description が他スキルの担当と明示している領域だった。

- スキルの新設について、配置・同梱物・description・eval を一式で頼む問。担当は `skill-creator` であり、現行 0.33 から短縮 1.00 になった。
- `.claude/agents/` 配下の定義ファイル全体の点検を頼む問。担当は `agent-creator` であり、現行 0.00 から短縮 1.00 になった。
- コマンド定義の新設を頼む問。担当は `skill-creator` であり、現行 0.00 から短縮 1.00 になった。

一方、既存の `SKILL.md` の description 改善と測定セットの作成を頼む問は、担当が `skill-creator` であるにもかかわらず、現行 0.33 から短縮 0.00 へ改善した。

### 要因

担当境界の記述そのものは落ちていない。短縮案にも、Agents 定義の description・新規作成・frontmatter 検証は `agent-creator`、スキル・コマンド定義の description 作成・改善と発火測定は `skill-creator` が担当するという記述がある。

#### 第 1 層: 適用範囲を絞る限定が落ちた

現行の description は、ファイル名だけを挙げて評価・整形・削減を頼む場合にも、それが `references/` 配下または上記の指示書なら使う、という限定を持つ。短縮案ではこれが「対象ファイル名を挙げて評価・整形・削減を頼まれた場合も使う」に縮まり、限定の部分が落ちた。そのため、他スキルが担当するファイルを名指しした依頼も、「対象ファイル名を挙げた依頼」に読める。

#### 第 2 層: 対象の列挙と除外の宣言が同じ語を共有している

短縮案は冒頭で `Agents 定義`・`SKILL.md`・`commands/` を自分の対象として挙げ、末尾ではその一部を他スキルの担当として除外する。同じ語が対象と除外の両方に現れる。

現行の 1612 バイト版にも同じ構造があるが、間に発動例が 13 個あり、その大半は本文の改稿を指している。この例示群は、`Agents 定義` に対する `prompt-smith` の担当範囲が本文だけであることを暗黙に示していた。短縮で例示群が消え、除外の宣言だけが残ったことで、対象の列挙のほうが強く効いたと説明できる。

除外の書き方は `agent-creator` と対照的である。`agent-creator` の短縮案は、skill・command・output-style・references のファイルを対象外と、対象の種類で除外している。対象である `agents/` 配下と除外が同じ語で重ならない。一方、`prompt-smith` では重なっている。

### 結論

この観測からは、誤発火が増えた要因は長さそのものではなく、「対象の列挙」と「除外の宣言」が同じ語を共有していることだと説明できる。短縮で例示群が消えると、その重なりを暗黙に解消していた情報も失われる。

### 未解決

- この説明は 1 スキル 1 案の観測から導いたものであり、独立した検証はしていない。
- 対象と除外が重ならない書き方の案を測れば確かめられるが、本改修では測っていない。

## 実施の過程で判明した 2 点

### 合格条件を差し替えた

実装計画書 S1-7 相 1 Step 2 の合格条件は、「隔離側の `skills` 件数が減り、CLI 組み込みだけの件数(17)になる」だった。

この条件の前半は成立しなかった。剥がすべき上乗せが環境に存在しないためであり、フラグの不調ではない。設計書が実測した時点は、対照 25(= 組み込み 17 + ユーザースキル 8)だった。その後、ユーザースキルの配置が変わった。

代替の検出口として hook イベント数を採った。`--settings '{"disableAllHooks":true}'` が CLI に届いて効いていることを直接示す。hook の抑止は、改修前に `docs/chat/` へ書き込んでいた当の機構である。

差し替え後の合格条件は次のとおりである。

1. 隔離側の 17 件が CLI 組み込みスキルの名前と一致する。
2. hook が対照で発火し、隔離で発火しない。

`--setting-sources` と `--strict-mcp-config` の効きは、この検査では確かめられない。相 3 の陽性対照と、相 4 の `git status` 一致が受け持つ。

### 実装計画書の計測手順に欠陥があった

計画書は `head -1` で `init` イベントを掴む前提だった。対照側では hook の `system/hook_started` イベントが `init` より先に流れるため、先頭行を取ると `skills` が 0 件と出る。

実際、最初の実行で「対照 0 / 隔離 17」という逆転が観測された。`type == "system"` かつ `subtype == "init"` の行を探す形に直した。probe スクリプトは `~/prompt-smith-probe/count-skills.sh` にあり、理由をコメントで残してある。

## 発見した実装の欠陥とその修正

### `TMPDIR` ガードの診断が操作者に届かなかった

経路は次のとおりである。

1. `createSandbox` がガード例外を投げる。
2. `runEval` の問ごとの `catch` が `{status:"error", message}` へ変換する。メッセージはここまで保持される。
3. `assertMeasurable` が固定文の `MeasurementFailedError` を投げ、原因テキストを捨てる。

症状は、`TMPDIR` がリポジトリ内にあると伝えるべき場面で、認証を環境変数へ切り替えるよう表示されたことだった。

これは probe 固有の問題ではない。ネットワーク障害、モデル名の誤り、権限不足も同じく認証の案内にすり替わる。

`1626bff` で、`assertMeasurable` のシグネチャと結果 JSON のスキーマを変えず、`errors > 0` のときの stderr 警告へ、重複を除いた原因メッセージを最大 5 件まで添えるよう修正した。修正後、ガードの診断が `Cause:` の行として stderr に出ることを実機で確認した。
