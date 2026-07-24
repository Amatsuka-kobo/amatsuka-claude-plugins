# chat-recorder パフォーマンス改善 設計セッション

- 日付: 2026-07-24
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 設計案(未実装・未コミット)
- 前提: `plugins/task-utility/agents/chat-recorder.md`, `plugins/task-utility/hooks/hooks.json`, `plugins/task-utility/src/hooks/check-chat-recorded.ts`, `plugins/task-utility/src/extract-conversation.ts`, `plugins/task-utility/skills/chat/SKILL.md`

---

## セッション1: ボトルネック分析と改善案の設計

# phyllis998

> task-utilityプラグイン内のchat-recorderエージェントとhooksの改善を行います。
> 現在チャットの記録速度が遅く、かなりの待ち時間が発生しています。パフォーマンスを改善する策を考えてください

# AI

## 分析

前提資料の調査を行い、stop フックの流れを確認した。主要なパフォーマンスボトルネックは以下の通り：

1. **毎ターン全量抽出**: `extract-conversation.ts` が毎回トランスクリプト全体を解析し、既に記録済みの発言も含めて出力している
2. **全文上書き**: `check-chat-recorded.ts` の差し戻し指示に従い、chat-recorder が記録ファイルを Read で全文読み込み → Write で全文上書きしている
3. **累積トークン消費**: ファイルサイズが増えるにつれ(会話が長くなる)、毎ターンの入出力トークンが単調増加する構造

この設計では、100 ターンの会話でも最後のターンは「会話全量 + 記録全文」(合計 3〜4 万トークン)の入出力が発生し、記録専門のエージェントにしては無視できない待ち時間が生じている。

## 改善案の採用

2 つの改善案を組み合わせることで決定：

**案 A**: 差分抽出 + 追記専用化
- `extract-conversation.ts` に `--since-line <N>` オプションを追加。前回記録した行番号以降のターンだけを抽出
- `check-chat-recorded.ts` で最後の記録行番号を取得し、それを抽出コマンドに埋め込む
- chat-recorder に追記指示を与える(全文上書き禁止)

**案 B**: USER 発言の機械的な引用整形
- `extract-conversation.ts` で USER 発言を引用ブロック形式(`> ` 前置)に整形して出力
- chat-recorder は整形済みブロックをそのまま転記するだけで、SKILL.md の「一字も変えない」契約がスクリプト側で保証される
- 手作業での引用ブロック化という error-prone な作業を排除

## 設計案

### 1. `extract-conversation.ts` — 差分抽出と引用整形

- `--since-line <N>` オプションを追加。N 行目以前をスキップし、それ以降の発言だけを抽出
- 行カウントは `check-chat-recorded.ts` と同一のロジック(空行・パース不能行も含めて加算)を使用し、両者の行番号が常に一致することを不変条件とする
- USER 発言を引用ブロック形式(`> ` 前置)で整形して出力。段落の空行も `> ` で表現する
- ASSISTANT 側は現状どおり(text とツールヒントの列挙)。要約作成は引き続き Haiku の仕事

### 2. `check-chat-recorded.ts` — 行番号の受け渡し

- 走査で得た `lastRecord` を差し戻し reason 内の抽出コマンドに `--since-line ${lastRecord}` として埋め込む(`lastRecord === -1` のときは付けない = 全量抽出)
- 差し戻し文面に「追記は全文上書きでなく末尾追記で行う」旨の指示を明示的に追加

### 3. `agents/chat-recorder.md` — 追記専用の手順に改訂

- **既存ファイルの確認**: 全文 Read をやめ、Glob で候補特定後 `tail -n 60` で末尾(最終セッション番号)だけ確認
- **追記方法**: 新セッション部分を Write で**スクラッチパッド上の一時ファイル**に書き、`cat 一時ファイル >> 記録ファイル` で追記。ヒアドキュメント(`<<EOF`)のエスケープ問題を回避しつつ、出力トークンは新規分のみに限定
- **新規作成時**: 従来どおり Write で作成(初回はファイルが小さいので全文出力は許容)
- **INDEX.md / ヘッダー更新**: Edit ツールを追加導入し、既存行の要旨更新・ヘッダーの成果物追記は Edit の部分置換で実施
- **全文の再出力を明示的に禁止**する一文を厳守事項に追加

### 4. 波及作業

- `pnpm build` でバンドル済み `scripts/*.mjs` を再生成しコミット(利用者はビルド不要の原則を維持)
- テスト追加: `--since-line` の行番号一致性、USER 発言の引用整形の正確性、reason への `--since-line` 埋め込みの動作確認
- `plugins/task-utility/plugin.json` のマイナーバージョンアップ(現行バージョンから n2 を +1)

## 期待効果

毎ターンの chat-recorder 実行における入出力が「会話全量 + 記録全文」(合計 3〜4 万トークン)から「新規ターン分のみ」(数百〜数千トークン)に縮小する。その結果、記録にかかる待ち時間が会話の全体長にほぼ非依存になり、ターン内容量に比例する一定時間に短縮される。

## 重要設計ポイント

**行番号一致の不変条件**: 2 つのスクリプト間で行番号を契約する設計では、「同じ数え方をする」ことが暗黙になりがちである。本設計ではカウントロジックを共通の不変条件としてテストで固定し、片方だけが空行スキップを入れるなどの差異で静かに番号がずれる事態を防止する。

**一時ファイル経由の追記**: ヒアドキュメント(`<<EOF`)は本文中に区切り文字が現れると壊れる問題をはらんでいる。一時ファイル経由の `cat >>` は、この問題を構造的に回避する定石である。



## セッション2: 設計書作成・Haiku レビュー・補足修正

# phyllis998

> これで進めてください

# AI

ユーザーの承認を受けて、設計書作成フェーズに進みました。

## 実施内容

1. **設計書の新規作成**
   - 本リポジトリの慣習に従い `docs/design/YYYY-MM-DD-<topic>-design.md` 形式で作成
   - ファイル名: `docs/design/2026-07-24-chat-recorder-performance-design.md`
   - 設計書には背景・問題・採用方針・変更内容・テスト計画・波及作業を記載

2. **Haiku による設計レビュー**
   - Haiku エージェントに設計書を審査依頼
   - 有効だった指摘 5 点を反映：
     1. 行カウント統一方向が不明記 → 現行の extract-conversation は空行・パース不能行を数えない一方、check-chat-recorded 側は全行加算のため、「extract-conversation 側を check-chat-recorded に揃える方向」「現行実装の変更を伴うこと」を明記
     2. `--since-line` 境界値が曖昧 → 「`lineNo <= N` を読み飛ばし → 最初の USER 実発言まで ASSISTANT 断片を捨てる」という 2 段階判定を具体例付きで定義
     3. 引用整形の細則が未定義 → 変換規則(各行 `> ` 前置、空行は `>` のみ、改行構造は保持)と「引用記号の付加は本文改変ではない」という契約解釈を明記
     4. SKILL.md を変更しない理由が不明 → 「SKILL.md は完成形の契約、本改修は引用記号を付ける主体の移動のみ」と追記
     5. テスト粒度・追加先が曖昧 → 既存テストファイルへの追加であること、境界値ケース(N=0/途中/最終行以降)を明記
   - 「chat-recorder.md に未だ Edit が追加されていない」という指摘は、設計書(未実装の変更仕様)と現状ファイルの混同と判断、対応不要

3. **設計書の補足修正**
   - Haiku の指摘 5 点すべてを設計書に反映
   - 孤立 ASSISTANT 断片の処理におけるトレードオフも追加

## 成果と決定

- 設計書 `docs/design/2026-07-24-chat-recorder-performance-design.md` 完成(Haiku レビュー済み、補足修正反映済み)
- 実装フェーズの委譲先: `.claude/agents/` に gpt-sol/terra/luna が未生成のため、このセッションでは claude-only 担当表(実装=Sonnet)で代行する方針を案内
- 次フェーズ: ユーザーレビュー → 実装計画書作成 → Subagent-Driven 実装へ進行

---

状態: ユーザーレビュー待ち(設計書 `docs/design/2026-07-24-chat-recorder-performance-design.md` 完成、Haiku 指摘 5 点反映・補足修正完了)

次の作業: ユーザーレビュー → 実装計画書作成 → Subagent-Driven 実装フェーズへ進む


## セッション3: 実装計画書作成・Subagent-Driven 実装・ブランチレビュー

# phyllis998

> 進めてください

# AI

ユーザーの承認を受けて、実装計画書作成とサブエージェント駆動による実装フェーズに進みました。

## 実施内容

### 1. 実装計画書の作成

- ファイル名: `docs/plans/2026-07-24-chat-recorder-performance-implementation.md`
- Haiku レビュー済み設計書をベースに実装計画を作成
- 5 つのタスクに分解：
  - **Task 1**: `extract-conversation.ts` に `--since-line` オプション実装（行番号の差分抽出機能）
  - **Task 2**: `extract-conversation.ts` で USER 発言の引用ブロック機械整形
  - **Task 3**: `check-chat-recorded.ts` の差し戻し reason に `--since-line` を埋め込む処理実装
  - **Task 4**: `agents/chat-recorder.md` を追記専用設計に改訂（全文上書き禁止、tail 確認、スクラッチパッド経由の追記）
  - **Task 5**: バンドル再生成（`pnpm build`）、テスト追加・検証、プラグインバージョンアップ

### 2. Subagent-Driven 実装

全 5 タスクについて Implementer エージェント → Reviewer エージェント（spec + quality）の流れで実装・審査を実施。結果：

- **Task 1** (`--since-line` オプション）: 9/9 テスト pass。実装ダブルで行カウント一致性を検証。
- **Task 2**（引用整形）: 指摘なく承認。USER 発言の段落構造、空行処理も正確に実装。
- **Task 3**（フック reason 更新）: 指摘なく承認。reason 本文への `--since-line` 埋め込みと、「追記は全文上書きでなく末尾追記」の指示を確認。
- **Task 4**（chat-recorder.md 改訂）: 指摘なく承認。tail による末尾確認、スクラッチパッド一時ファイル経由の `cat >>` 追記、Edit ツール導入による要旨更新の実装を確認。
- **Task 5**（バンドル・テスト・検証）: `pnpm test` 919/919 pass、typecheck・lint クリーン。プラグインバージョンを `0.5.0-dev` に更新。バンドル再生成完了。

### 3. 全体レビュー

- **ブランチ全体レビュー(Opus)**を実施
- ブロッキング指摘なし
- **Minor 3 件**を指摘：実装に支障がない軽微な指摘
- これらは修正コミット `0791977` にて反映
- **再レビュー**をバックグラウンドで実施中

## 成果物

- 設計書: `docs/design/2026-07-24-chat-recorder-performance-design.md`
- 実装計画書: `docs/plans/2026-07-24-chat-recorder-performance-implementation.md`（main コミット `8ba9b50`）
- feature/chat-recorder-performance ブランチコミット：
  - `29c8808`: Task 1 実装（`--since-line` オプション）
  - `571f2de`: Task 2 実装（引用整形）
  - `81b0d80`: Task 3 実装（フック reason 更新）
  - `446cc37`: Task 4 実装（chat-recorder 追記専用化）
  - `d57e43c`: Task 5 実装（バンドル・テスト・検証）
  - `0791977`: 最終レビュー Minor 3 件修正

## 現在の状態

- 全タスク実装完了・個別レビュー承認済み
- 全体ブランチレビュー実施、Minor 3 件修正反映
- 再レビュー待機中
- マージ未実施

---

状態: 最終レビュー再検証中。全実装・修正完了、マージ予定
