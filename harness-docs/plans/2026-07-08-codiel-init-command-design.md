# Codiel 初期化コマンド分離 設計書

- 日付: 2026-07-08
- 対象: `plugins/codiel`
- ステータス: 設計承認済み(実装前)

## 背景と目的

現状、ハーネス資産(`docs/ARCHITECTURE.md` / `docs/GOTCHAS.md` / `CLAUDE.md` / `.codiel/`)の配置は
`/codiel:run` の前提チェック(orchestrating-runs §0)が `install-harness.sh` を実行することで行われる。
この方式には次の問題がある。

1. example(架空プロジェクト Tsukuyomi)がそのままコピーされるだけで、対象プロジェクトに合った
   内容(特に機械可読なドメインマップ・コマンド定義)はユーザーの全面手動記入に依存する。
2. 既存 `CLAUDE.md` があると skip され、「Codiel ハーネス運用ルール」節の手動マージが必要になる。
3. `raguel.config.yaml`(保護パス等)は配置対象外で、ARCHITECTURE.md の「保護パス」節との
   整合(DESIGN.md が要求)が初期化時点から保証されない。
4. run 開始という文脈で初期化が発生するため、「run を始めたつもりが記入依頼で終了する」体験になる。

本改修では初期化を専用コマンド `/codiel:init` に分離し、対話インタビューによって
プロジェクトに合った ARCHITECTURE.md / CLAUDE.md / raguel.config.yaml を生成する。
`/codiel:run` は資産配置を行わず、未初期化なら `/codiel:init` を案内して終了する
(フェイルクローズドの性質は維持)。

## 決定事項(ユーザー承認済み)

| 論点 | 決定 |
|---|---|
| 生成方式 | 対話インタビュー形式(コードベース解析はしない。AskUserQuestion で1テーマずつ質問し、回答から生成) |
| 既存ファイルの扱い | 自動マージ(CLAUDE.md は運用ルール節がなければ末尾追記、ARCHITECTURE.md は不足セクションのみ補完。書き込み前に差分提示→承認) |
| 初期化範囲 | `raguel.config.yaml` も含める(保護パスを ARCHITECTURE.md と同一回答から同時生成し整合を構造的に保証) |
| 実装構造 | コマンド+専用スキル(`commands/init.md` → `skills/initializing-harness/SKILL.md`)。`install-harness.sh` は機械的配置のみに縮小 |

## 全体像

```
【現状】 /codiel:run → 前提チェック → (ARCHITECTURE.md なし) → install-harness.sh 実行
         → example コピー → 「記入してください」→ run 終了

【改修後】/codiel:init → 現状調査 → 機械的配置(install-harness.sh 縮小版)
         → 対話インタビュー → 生成物ドラフト提示 → 承認 → 書き込み → 検証 → 完了報告
         /codiel:run  → 前提チェック → (未初期化) → 「/codiel:init を実行してください」と案内して終了
```

新規は `commands/init.md`(薄いエントリ)と `skills/initializing-harness/SKILL.md`(実体)。
`/codiel:run`(`commands/run.md` → orchestrating-runs スキル)と同じ「コマンド→スキル」パターンに従う。

## `/codiel:init` の処理フロー(initializing-harness スキル)

### Step 1 — 現状調査(モード判定)

対象プロジェクトで次を確認し、**不足しているものだけ**を以降の対象にする。

- `docs/ARCHITECTURE.md` の存在と、` ```json codiel:domains ` フェンスブロックの有無・パース可否
- `CLAUDE.md` の存在と「## Codiel ハーネス運用ルール」節の有無
- `docs/GOTCHAS.md` の存在
- `raguel.config.yaml` の存在
- `.codiel/{specs,runs,reports}/` の存在

全部揃っていれば「初期化済み」と報告して終了する。再実行は自然に「補完モード」
(不足分だけ質問・生成)になり、冪等である。中断からの再開も専用の状態を持たず
この性質で吸収する。

### Step 2 — 機械的配置

縮小版 `install-harness.sh` を実行する。責務は次の 2 点のみ。

- `.codiel/specs` / `.codiel/runs` / `.codiel/reports` の mkdir
- `docs/GOTCHAS.example.md` → `docs/GOTCHAS.md` の copy-if-absent
  (GOTCHAS は空のジャーナルであり、インタビュー不要。機械コピーが適切)

ARCHITECTURE.md / CLAUDE.md のコピー行は削除する(スキルが生成するため)。
example ファイル(`ARCHITECTURE.example.md` / `CLAUDE.example.md`)は削除せず、
スキルが構造・機械可読ブロック形式・記入ガイドの参照元として読む。

### Step 3 — 対話インタビュー

AskUserQuestion で 1 テーマずつ質問する。コードベース解析は行わず、選択肢は一般的な候補
+Other とする。補完モードでは不足セクションに対応する質問だけを行う。

| # | テーマ | 反映先 |
|---|---|---|
| 1 | プロジェクト概要(1段落) | ARCHITECTURE 冒頭 |
| 2 | 技術スタック(言語/FW/パッケージマネージャ/バージョン方針) | 技術スタック表 |
| 3 | ディレクトリ構成と各領域の責務 | ディレクトリ構成節 |
| 4 | ドメイン分割(frontend/backend/data の glob、または `{ "generic": ["**"] }` 縮退) | ` ```json codiel:domains ` ブロック |
| 5 | コマンド定義(test/lint/typecheck/build/e2e) | コマンド定義表 |
| 6 | テスト方針(E2E フレームワーク・ユニットテスト規約) | テスト方針節 |
| 7 | 保護パス | ARCHITECTURE「保護パス」節 + `raguel.config.yaml` の両方 |
| 8 | 規約(ベースブランチ/ブランチ・PR 命名/Definition of Done) | 規約節 |

### Step 4 — 生成と自動マージ

回答から 3 ファイルのドラフトを作り、**書き込み前に差分(新規ファイルは全文)を提示して
承認を得てから** Write / Edit する。

- `docs/ARCHITECTURE.md`
  - 新規: example の構造・機械可読ブロック形式(開始行 ` ```json codiel:domains ` そのまま、
    ブロック内は有効な JSON のみ)に厳密準拠して全文生成。
  - 既存: 既存内容を読み、不足セクションのみ追記。既存記述は書き換えない。
- `CLAUDE.md`
  - 「## Codiel ハーネス運用ルール」節がなければ末尾に追記(7 ルールは CLAUDE.example.md の
    固定文言)。節があれば触らない。
- `raguel.config.yaml`
  - Raguel の設定は内蔵デフォルトへの深マージ差分(raguel-mcp `src/config/loader.ts`)なので、
    プロジェクト固有の上書き(主に `rules."code/protected-paths".globs`)だけを書いた
    最小オーバーレイを生成する。デフォルト全量はコピーしない。

### Step 5 — 検証(フェイルクローズドの前倒し)

run 開始時に初めて発覚していた不備を init 完了時点で検出する。

1. `node -e` で hooks の `lib.mjs` の `readDomains` を呼び、生成した domains ブロックが
   実際にパースできることを確認する(hooks・オーケストレーターと同一の解析系で検証する)。
2. ARCHITECTURE.md「保護パス」節と `raguel.config.yaml` の globs の一致を確認する。

検証に失敗したら該当ファイルを修正して再検証する(失敗のまま完了報告しない)。

### Step 6 — 完了報告

配置・生成したファイル一覧と、次のアクションとして `/codiel:run <issue番号>` を案内する。

## `/codiel:run` 側の変更

`skills/orchestrating-runs/SKILL.md` §0(前提チェック)の手順 3 を差し替える。

- 変更前: `install-harness.sh` を Claude 自身が実行 → 雛形生成を確認 → 記入依頼 → run 終了
- 変更後: `docs/ARCHITECTURE.md` がない、または domains ブロックが読めない場合、
  「`/codiel:init` を実行して初期化してください」と案内して **run を開始しない**。
  install-harness.sh は実行しない。

手順 1・2・4(ARCHITECTURE.md 確認・domains 確認・raguel MCP 確認)は変更しない。

## 影響ファイル一覧

| ファイル | 変更 |
|---|---|
| `plugins/codiel/commands/init.md` | **新規**: initializing-harness スキルを起動する薄いエントリ(run.md と同形式) |
| `plugins/codiel/skills/initializing-harness/SKILL.md` | **新規**: 上記フロー全体を規定 |
| `plugins/codiel/skills/initializing-harness/raguel.config.example.yaml` | **新規**: raguel.config.yaml 生成時の形式リファレンス(最小オーバーレイの例) |
| `plugins/codiel/scripts/install-harness.sh` | **縮小**: mkdir + GOTCHAS コピーのみに |
| `plugins/codiel/skills/orchestrating-runs/SKILL.md` | §0 手順 3 を init 案内に変更(チェックリスト 0 の文言も追随) |
| `plugins/codiel/CLAUDE.example.md` | 記入ガイドコメントの install-harness.sh 言及を initializing-harness に更新 |
| `plugins/codiel/docs/DESIGN.md` | §9(ハーネス資産)ほか install-harness 言及箇所を初期化フローの新設計に更新 |
| `plugins/codiel/README.md` | セットアップ手順を `/codiel:init` ベースに更新 |

## エラーハンドリング

- **インタビュー中断**: 専用の中断状態は持たない。再実行すれば Step 1 の補完モードで
  不足分から再開される。
- **git 管理外プロジェクト**: 警告のみで続行する(init 自体は git を必要としない)。
- **検証失敗(Step 5)**: 修正→再検証。失敗のまま完了報告しない。
- **ユーザーがドラフトを否認**: 該当テーマのインタビューに戻って回答を修正し再生成する。
- **既存ファイルの機械可読部分が壊れている場合**(domains ブロックの JSON 不正・raguel.config.yaml の
  YAML 不正・保護パス不整合): 「追記のみ」原則の例外として、問題箇所と修正案を提示しユーザーの
  明示承認を得た上で該当ブロック・該当キーのみを置換する(最終レビューの指摘を受けて追記)。

## テスト計画

- `install-harness.sh` 縮小版: 既存の `*.test.mjs` パターンに準拠した動作確認テスト
  (新規ディレクトリ作成・GOTCHAS copy-if-absent・ARCHITECTURE/CLAUDE を作らないこと)。
- 手動シナリオ(サンプルプロジェクト): (a) 新規初期化 (b) 既存 CLAUDE.md ありの補完
  (c) 初期化済みでの再実行(no-op 報告)。
- 既存テスト(hooks / codiel-state / raguel-mcp)が引き続き green であること。

## スコープ外

- コードベース解析によるドラフト自動生成(将来の拡張候補。今回は対話インタビューのみ)。
- 既存 ARCHITECTURE.md の内容の書き換え・リライト(不足セクションの追記のみ)。
- orchestrating-runs のフェーズ進行そのものの変更。
