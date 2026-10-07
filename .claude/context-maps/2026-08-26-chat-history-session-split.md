# Context Map: chat-history の記録先を 1 セッション 1 ファイルにする

**作成日**: 2026-08-26
**作成者**: Opus(探索統括)
**対象タスク**: 複数の Claude Code セッションが 1 つの記録ファイルに同居する現状を、1 セッション 1 ファイルへ変える。会話記録の粒度(原文記録・`## セッション N` の区切り)は変えない。
**関連する ARCHITECTURE セクション**: レイヤー構造(指示層 / 配布物層 / 実装層)、ディレクトリ構成(`docs/chat/`)

---

## 1. 目的・スコープ

記録ファイルの分割軸を「トピック(曖昧)」から「Claude Code セッション(機械的に判定可能)」へ変える。

- スコープ内: 記録先ファイルの選択ロジック、新規ファイルの命名契約、日付ディレクトリの基準、それらに従属する指示層(SKILL.md / chat-recorder)・文書・テスト
- スコープ外: 本文の粒度契約(原文記録)、`## セッション N` の採番と文言、既存の同居ファイルの分割移行、recall / resume スキルの検索ロジック

## 2. 現在のコードベース構造

### 2.1 構成

```
plugins/chat-history/
├── src/
│   ├── prepare-chat-recording.ts   記録先の選択・本文抽出・plan 更新
│   ├── commit-chat-recording.ts    本文合成・追記/新規書き込み・INDEX 更新・検証
│   ├── chat-recording-state.ts     state / lock / 世代交代 / 発火判定
│   ├── extract-conversation.ts     transcript から本文を機械生成
│   ├── find-chat-records.ts        recall / resume 用の検索
│   └── hooks/check-chat-recorded.ts  Stop フック本体
├── skills/chat/SKILL.md            記録フォーマットの正本(実行時契約)
├── agents/chat-recorder.md         記録エージェントの手順
└── docs/rationale.md               設計根拠
```

### 2.2 重要なファイル

| ファイルパス | 役割・内容の概要 | 重要度 | 備考 |
|--------------|------------------|--------|------|
| `src/prepare-chat-recording.ts` | 記録先の選択(バグの所在)、prefix 算出の実装先 | High | 171 行目に単一候補フォールバック |
| `src/commit-chat-recording.ts` | パス検証(`validKebabMarkdown` / `allowedNewRecordDir`)、`flag: "wx"` | High | 引数契約の変更対象 |
| `agents/chat-recorder.md` | 新規パスの決定を LLM に委ねている手順 4 | High | `--record-path` の呼び出し元 |
| `skills/chat/SKILL.md` | 「保存場所」節がトピック単位の分割を規定 | High | 契約の正本 |
| `src/chat-recording-state.ts` | `state.recordPath` / `reconcileGeneration` | Medium | 世代交代時に recordPath を手放す |
| `src/find-chat-records.ts` | パス構造から日付・作業者を読む | Low | ファイル名に非依存。変更不要 |
| `src/extract-conversation.ts` | 本文の機械生成 | Low | 粒度不変のため対象外 |

## 3. 関連モジュール・データフロー

```
Stop フック(check-chat-recorded)
  → state/lock/plan を書き、additionalContext を注入
  → メインが chat-recorder をバックグラウンド起動
    → prepare-chat-recording  : 記録先を決め、本文を bodyFile へ書き、plan へ確定値を格納
    → chat-recorder(LLM)     : 要旨 / INDEX 行 / ヘッダー / 新規パス を Write
    → commit-chat-recording   : plan と突き合わせて検証し、追記または新規作成、INDEX 更新、state 確定
```

state は `~/.claude/chat-history/chat-recorder/<projectKey>/state/<sessionKey>.json`。`sessionKey` は `session_id` のハッシュで、**セッション単位で既に分かれている**。

## 4. 既存の実装パターン・規約

- 記録先の決定は必ずスクリプト側が行い、LLM には短いメタ情報だけを書かせる(`docs/rationale.md`「本文を chat-recorder に書かせない理由」)
- `prepare` が plan に確定値を書き、`commit` が plan と引数を突き合わせて検証する(片側だけでは成立しない二段検証)
- 検証に落ちたら記録せず、state に `lastError` を残して次ターンへ持ち越す
- テストは `src/__test__/` と `src/hooks/__test__/`、vitest、node 環境

## 5. 変更の影響範囲

### 5.1 直接影響を受ける箇所

- `src/prepare-chat-recording.ts`: 単一候補フォールバックの削除、セッション開始時刻の取得、prefix と日付ディレクトリの算出、plan への格納
- `src/commit-chat-recording.ts`: `--record-path` から `--record-slug` への引数契約変更、ファイル名の合成と検証
- `agents/chat-recorder.md`: 手順 2 / 4 の記述(パス決定 → スラッグ決定)
- `skills/chat/SKILL.md`: 「保存場所」節の分割軸、`## セッション N` の意味の明記
- `src/__test__/prepare-chat-recording.test.ts`: 「state.recordPath のファイルが無ければ単一候補判定に戻る」テストが仕様変更で不成立
- `src/__test__/commit-chat-recording.test.ts`: `recordPath` を渡す全ケースと、`expected .../<kebab-case>.md` のエラーメッセージ検証

### 5.2 間接的に波及する可能性がある箇所

- `README.md` / `docs/rationale.md`: 分割軸の説明
- `plugin.json` / `package.json`: バージョン
- recall / resume スキル: 挙動は改善方向に変わる(`--latest N` が「直近 N セッション」を指すようになる)が、コード変更は不要

### 5.3 変更を避けるべき箇所

- `src/extract-conversation.ts`: 本文の粒度は不変というユーザー指示
- `src/chat-recording-state.ts` の `reconcileGeneration`: compaction では発火しないことを実測で確認済み。触ると記録の重複リスクを持ち込む
- 既存の記録ファイル: 過去記録は改変しない

## 6. 守るべき既存契約・インターフェース

- `commit` は plan に無い値を受け付けない。新規パスは `allowedNewRecordDir` 直下・kebab-case・`.md` に限る
- 新規作成は `flag: "wx"`。既存ファイルを上書きしない
- INDEX.md は 1 記録ファイル 1 行、パス昇順
- 失敗時は記録ファイルと INDEX を元のサイズ・内容へ巻き戻す
- `state.recordPath` があるセッションは、日をまたいでもそのファイルへ追記し続ける
- chat-recorder は `bodyFile` を読まない・書かない

## 7. 未解決事項・不明点

| # | 質問内容 | 影響度 | 上流報告先 | 現状の仮定 |
|---|----------|--------|------------|------------|
| 1 | セッション開始 timestamp を持つ最初の行の型が将来変わらないか | Medium | オーケストレーター | 先頭 3 行(`last-prompt` / `mode` / `permission-mode`)は timestamp を持たない。「最初に timestamp を持つ行」を採る |
| 2 | 同一分に 2 セッションが開始した場合の prefix 衝突 | Low | オーケストレーター | `flag: "wx"` で失敗し次ターンへ持ち越す。実運用では起きにくいが設計書で扱う |
| 3 | 既存の同居ファイルを分割移行するか | Low | ユーザー | 移行しない(過去記録を改変しない) |

## 8. テスト戦略・既存テスト

- 既存: `prepare-chat-recording.test.ts`(335 行)、`commit-chat-recording.test.ts`(447 行)が命名契約に直接依存
- 追加すべき方向: 新セッションが既存ファイルへ追記しないこと、prefix がローカル時刻であること、日跨ぎセッションの継続、prefix 衝突時に既存を壊さないこと
- エッジケース: timestamp を持つ行が 1 つも無い transcript、タイムゾーン境界(UTC 日付とローカル日付が異なる)、`--record-slug` に不正文字

## 9. 依存関係・リスク・制約

- Node.js 標準ライブラリのみ。外部依存なし
- タイムゾーンはローカル基準。テストは TZ を固定して書く必要がある
- 記録が失敗しても会話は継続する(記録の失敗は致命ではない)が、失敗が続くと未記録ターンが溜まる

## 10. 推奨アプローチ

1. `prepare` に「セッション開始のローカル日時」を求める純関数を切り出し、日付ディレクトリと prefix の両方をそこから導く
2. 単一候補フォールバックを削除し、`selected = resumable` のみとする
3. `commit` の引数を `--record-path` から `--record-slug` へ変え、ファイル名の合成を `commit` 側に閉じる
4. 指示層(SKILL.md / chat-recorder)を後から追随させる。実装より先に変えると契約がずれる
5. 既存記録は移行しない

## 11. 補足・暗黙知

- `## セッション N` の「セッション」は Claude Code のセッションではなく、**同一ファイルへの追記回**を指す。1 セッション 1 ファイルにすると語が二重になるが、粒度不変の指示に従い文言は維持する。SKILL.md で意味を明記して混同を防ぐ
- `prepare` が全文から `lastSessionNumber` を拾うのは、原文記録で 1 セッションが末尾 60 行の窓を超えて番号を見失った過去の不具合への対処(コード内コメントに経緯あり)
- 状態ディレクトリの環境変数名が `TASK_UTILITY_CHAT_STATE_DIR` のままなのは、プラグイン分割時に意図的に据え置いたもの。直し漏れではない

---

**次のステップ提案**:

- この context-map を基に設計書を作成する
- Open Question #2(同一分の prefix 衝突)の扱いを設計書で明示する

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に従う。*
