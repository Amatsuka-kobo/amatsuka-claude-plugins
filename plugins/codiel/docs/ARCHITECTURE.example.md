# ARCHITECTURE

<!-- 記入ガイド
このファイルはプロジェクトの技術的前提を宣言する唯一の資料です。Codiel の各サブエージェント
(analyst / architect / test-designer / planner / implementer / tester / reviewer)は作業前に
必ずこのファイルを読みます。特に「ドメインマップ」と「コマンド定義」は hooks・オーケストレーターが
機械的に参照するため、記入必須です(未記入だと Codiel は run を開始しません = フェイルクローズド)。
1 段落でプロジェクト概要(何のためのプロダクトか・利用者・主要な技術的制約)を書いてください。
-->

Codiel が導入された架空の SaaS プロダクト「Tsukuyomi」を例とする。社内チーム向けのタスク管理
Web アプリケーションで、Next.js によるフロントエンド、Node.js(Express)によるバックエンド API、
PostgreSQL(Prisma)によるデータ層の 3 層構成を取る。認証は社内 SSO(OIDC)に依存し、単一リポジトリ
(monorepo ではない)で frontend/backend/data を同一プロジェクト内のディレクトリで分離している。

## 技術スタック

<!-- 記入ガイド
言語・フレームワーク・主要ライブラリとバージョン方針(固定/幅を持たせる等)を表にする。
implementer・reviewer がコーディングスタイルや依存追加の妥当性を判断する材料になる。
-->

| 区分 | 採用技術 | バージョン方針 |
|---|---|---|
| 言語 | TypeScript | 5.x系。strict モード必須 |
| フロントエンド | Next.js (App Router) | 14.x。メジャーバージョンは手動でのみ更新 |
| バックエンド | Express | 4.x |
| ORM / データ層 | Prisma | 5.x。マイグレーションは `prisma migrate` のみで行う |
| パッケージマネージャ | pnpm | 9.x。`npm` / `yarn` の併用禁止 |
| 主要ライブラリ | React 18 / Zod / React Query | 追加ライブラリは design フェーズで妥当性を明記すること |

## ディレクトリ構成と責務

<!-- 記入ガイド
主要ディレクトリをツリーで示し、各領域の責務を1行で説明する。ドメインマップ(次節)の
glob パターンと矛盾しないこと。 -->

```
src/
  app/           # Next.js App Router のページ・レイアウト(frontend)
  components/    # 再利用可能な UI コンポーネント(frontend)
  server/        # Express アプリ本体・ミドルウェア・ルーティング(backend)
  api/           # API ハンドラ(コントローラ層、backend)
  lib/           # フロントエンド/バックエンド共有のユーティリティ(ドメイン横断)
prisma/
  schema.prisma  # スキーマ定義(data)
  migrations/    # マイグレーション履歴(data)
db/
  seed.ts        # 開発用シードスクリプト(data)
tests/
  e2e/           # Playwright による E2E テスト実行基盤(codiel-tester が使用)
```

## ドメインマップ

<!-- 記入ガイド
frontend / backend / data それぞれが書き込んでよいパスを glob で宣言する。
hooks(guard-write)と implementer/reviewer のディスパッチ選択がこのブロックを機械的に読む
(hooks/scripts/lib.mjs の readDomains が「```json codiel:domains」で始まるフェンスブロックを
正規表現で抽出する)。
- ブロックの開始行は必ず ```json codiel:domains(スペース区切りでこの文字列そのまま)にする
- ブロック内は有効な JSON のみ(コメント不可)
- ドメイン分割が馴染まない小規模プロジェクト・CLI ツール等では `{ "generic": ["**"] }` に
  縮退させてよい(縮退モード)。その場合 implementer / reviewer も汎用 1 体構成で動作する
-->

以下はドメインごとにコード変更の書き込み許可パスを宣言するブロックである。この形式(開始行の
文字列・JSON のキー構造)を変更しないこと。hooks とオーケストレーターがこの通りに解析する。

```json codiel:domains
{
  "frontend": ["src/app/**", "src/components/**"],
  "backend": ["src/server/**", "src/api/**"],
  "data": ["prisma/**", "db/**"]
}
```

ドメイン分割が馴染まないプロジェクトでは `{ "generic": ["**"] }` とする(縮退モード)。

## コマンド定義

<!-- 記入ガイド
test / lint / build / typecheck の実行コマンドを表にする。tester のスクリプト作成と
オーケストレーターの検証(回帰テストの一部)がここを読む。プロジェクトのルートで実行できる
形にすること(cwd の指定が必要ならコマンドに含める)。 -->

| コマンド | 実行内容 |
|---|---|
| test | `pnpm test`(Vitest によるユニットテスト一式) |
| e2e | `pnpm exec playwright test`(`.codiel/specs/**/scripts/` 配下を実行対象に含める) |
| lint | `pnpm lint`(ESLint + Biome) |
| typecheck | `pnpm typecheck`(`tsc --noEmit`) |
| build | `pnpm build` |

## テスト方針

<!-- 記入ガイド
E2E フレームワークと実行方法(writing-test-specs / scripting-tests スキルが従う)、
ユニットテストの要否・フレームワーク・配置規約(implementer の TDD が従う)を書く。
-->

- **E2E**: Playwright を採用する。`.codiel/specs/<unit-id>/scripts/` にケース ID と対応する
  spec ファイルを配置し、`pnpm exec playwright test .codiel/specs/**/scripts/` で実行する。
  ブラウザは Chromium のみを既定とする(CI 時間短縮のため)。
- **ユニットテスト**: 必須。フレームワークは Vitest。配置規約はテスト対象と同じディレクトリに
  `*.test.ts` として置く(例: `src/server/user-service.ts` → `src/server/user-service.test.ts`)。
  implementer は TDD(RED→GREEN→REFACTOR)の一部としてこれを作成する。カバレッジの数値目標は
  設けないが、分岐を持つロジック関数には最低 1 件の異常系ケースを必須とする。

## 保護パス

<!-- 記入ガイド
raguel.config.yaml の code/protected-paths と一致させること(片方だけ更新して乖離させない)。
implementer・hooks・reviewer が「触ってはいけない/触るときは特に慎重を要する」パスを把握する。 -->

以下は `raguel.config.yaml` の `code/protected-paths` と同じ内容を保つこと。

```
prisma/migrations/**   # 適用済みマイグレーションの改変は原則禁止(新規追加のみ許可)
.github/workflows/**   # CI 設定の変更は design フェーズで明示レビューを経ること
src/server/auth/**     # 認証・認可ロジック。security レビューを必ず通す
```

## 規約

<!-- 記入ガイド
コーディング規約・ブランチ/PR 命名・ベースブランチ・Definition of Done を書く。
orchestrating-runs のブランチ作成・PR 作成・fix-loop の完了判定が参照する。 -->

- **コーディング規約**: ESLint(`@typescript-eslint/recommended` ベース)+ Biome フォーマッタに従う。
  `any` 型の使用は原則禁止(やむを得ない場合はコメントで理由を明記)。
- **ブランチ命名**: `codiel/issue-<番号>-try-<n>`(Codiel が自動生成。手動作成しない)。
- **ベースブランチ**: `main`。
- **PR 命名**: `[#<issue番号>] <要約>`。本文に設計書・テスト仕様書・テストケースへのリンクを含める。
- **Definition of Done**: 対象 issue の受け入れ基準を全て満たす / 影響を受ける unit の E2E ケースが
  全件 OK / 既存 unit の回帰テストが全件 OK / lint・typecheck・build が通る / critical・high の
  レビュー指摘がゼロ。
