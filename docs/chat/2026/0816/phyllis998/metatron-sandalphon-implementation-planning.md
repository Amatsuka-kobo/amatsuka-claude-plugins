# metatron/sandalphon プラグイン実装計画

- 日付: 2026-08-16
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: harness-docs/design/2026-08-16-metatron-design.md、harness-docs/design/2026-08-16-sandalphon-design.md

---

## セッション 1: metatron/sandalphon実装のワークフロー編成

# phyllis998

> # 依頼: metatron+sandalphon プラグインの実装(Opus Dynamic Workflow テスト)
>
> 承認済み設計書 2 本を読み、これに従って実装する。
> - harness-docs/design/2026-08-16-metatron-design.md
> - harness-docs/design/2026-08-16-sandalphon-design.md
>
> ## この依頼の特別ルール
>
> - 今回は Opus による Dynamic Workflow のテストを兼ねる。オーケストレーションには Workflow ツールを使う(ワークフロー使用を明示的に許可する)。
> - agent-policy の GPT/Grok 帯への委譲は今回行わない。実装・探索・レビューはすべて Claude モデル(Workflow のサブエージェント)で構成する。
> - 規模はタスクに合わせて動的に決める。並列化できる独立作業(metatron の lib/CLI/hooks、sandalphon のスキル 3 種+検出スクリプト、codiel/gh-utility 改修)は並列に、検証・レビューはワークフローの verify ステージに置く。
> - 着手前に、両設計書の理解とワークフロー編成計画(フェーズ・エージェント数・並列構成)を提示し、承認を得てから実行する。
>
> ## 作業範囲と順序(各設計書の実装手順節に従う)
>
> 1. metatron ファイル契約の凍結(metatron 設計の実装手順 N0。マーカー名・config スキーマ・パス解決規則・既定パス・文書書式)— 全作業の先行依存
> 2. plugins/metatron 本体: 共有ライブラリ(src/lib: パーサ[フェンス状態機械]・検証・採番・パス解決)、CLI(scripts/ バンドル。stage/commit・append-gotcha・tag-gotcha・stage-adr 等)、PreToolUse deny hook、SessionStart 注入 hook(10,000 文字キャップ・6 段階縮退)、commands/init、skills、references(文書フォーマット正本+writing-discipline.md)、README、plugin.json、package.json、build.ts
> 3. plugins/sandalphon 本体: commands/run、skills(capturing-intent / bridging-execution / executing-intent)、check-intent-env(ファイル契約の独立実装)、references(intent 文書・intent-issue・handoff-contract 正本)、README、plugin.json、package.json、build.ts
> 4. codiel 改修(マイナー上げ): initializing-harness 縮小+最小 domains フォールバック、readDomains/ルート解決の契約追随、recording-gotchas の新書式追随+2 分岐+拒否時リカバリ、analyzing-issues(intent 写像)、preparing-design-agendas(合意済み除外)、agents 12 ファイル 23 箇所の固定パス除去(prompt-smith:agent-creator 経由)、CLAUDE.example.md / ARCHITECTURE.example.md の刷新
> 5. gh-utility 改修(パッチ上げ): issue-craft の持ち込みモード(固定開始句契約)
> 6. 登録・反映: marketplace.json、pnpm-workspace.yaml、ルート README.md
>
> ## 順守事項(CLAUDE.md より特に)
>
> - Skills の作成・改修は prompt-smith:skill-creator、Agents 定義は prompt-smith:agent-creator、references/ 等の AI 向け文書は prompt-smith:prompt-smith を使う。
> - TypeScript / Markdown の編集は Serena を使う。
> - src/ 変更後は pnpm build を実行し、生成物差分を同じコミットに含める。
> - コミット前に pnpm lint・pnpm typecheck・pnpm test を通す。
> - Anthropic API・ANTHROPIC_API_KEY 前提の実装はしない。MCP サーバーは作らない(設計で撤回済み。C1 構成に従う)。
> - 設計書と実装が食い違う判断が必要になったら、実装を止めてユーザーに確認する。
> - 両設計書の「未解決事項」節に残る選択肢は、着手前の編成計画提示時に推奨案とともに確認を取る。
>
> ## 完了条件
>
> - pnpm build / lint / typecheck / test が全通過している(両設計書のテスト計画のケースを含む)。
> - 新規スキルが skill-creator の評価手順を通っている。
> - 機能単位でコミットされている。
> - 結果報告に、作成・変更ファイル一覧と、Workflow 実行の構成(フェーズ・エージェント数・token 規模)を含める。
