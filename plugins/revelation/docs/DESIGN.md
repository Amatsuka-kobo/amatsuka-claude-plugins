# Revelation フック層 設計

日付: 2026-07-10
ステータス: 承認済み(実装前)

## 0. 背景と問題

Revelation のスキル群(`fable-method` / `fable-restraint` / `fable-subagents`)は、モデルが description の意味的マッチングで自発的に invoke する「pull 型」の仕組みに依存している。しかし実運用で、下位モデル(Sonnet/Haiku)は**該当場面でもスキルをそもそも invoke しない**ことが確認された。README の「既知の制約」に予見されていたとおり、規律を最も必要とするモデルほど自発的な invoke の規律が弱い。

対策は、モデルの自発性に依存しない仕組み — (a) 内容を push する(注入)、(b) 決定的に強制する(フックでゲート)— のいずれかに寄せる必要がある。本設計はこの2つを軽量に組み合わせたハイブリッド構成を採る。

検討した代替案:

- **SessionStart 注入のみ** — 実装は最軽量だが、長セッションでの忘却に対する保険がない。
- **PreToolUse ゲートのみ** — 強制力は最強だが、`fable-method` の「着手前」に対応する自然なツールゲートがなくカバレッジに穴が残る。

## 1. 全体像

revelation プラグインに `hooks/` を追加する。スキル本体(`skills/*/SKILL.md`)は変更しない。

```
plugins/revelation/
├── hooks/
│   ├── hooks.json                      # SessionStart + PreToolUse の定義
│   ├── trigger-map.md                  # 第1層で注入するトリガー表(約10行)
│   └── scripts/
│       ├── inject-trigger-map.mjs      # 第1層: SessionStart
│       ├── remind-skill.mjs            # 第2層: PreToolUse
│       └── remind-skill.test.mjs       # node --test 用ユニットテスト
└── skills/                             # 変更なし
```

pull 型(自発 invoke)→ 第1層(push)→ 第2層(enforcement)の三段構えで、上の層が壊れても下の層が拾う。

## 2. 第1層: SessionStart トリガー表注入

- `inject-trigger-map.mjs` が `hooks/trigger-map.md` を読み、SessionStart の `additionalContext` として注入する。
- 内容は**トリガー表のみ**(約10行):
  - 複数ステップの実装・調査・デバッグに着手する前 → `revelation:fable-method` を invoke
  - コード変更・git 操作・テスト失敗・ユーザーからの指摘 → `revelation:fable-restraint` を invoke
  - サブエージェント起動前 → `revelation:fable-subagents` を invoke
  - 「該当したら応答・作業を始める前に必ず Skill ツールで invoke せよ」という強い指示文
- チートシート全文を注入しない理由:
  1. スキル本体との二重管理になる。
  2. 「読んだ気」になって invoke しなくなる逆効果を避ける。表は「いつ・どれを」だけを教え、中身はスキル invoke で取らせる。

## 3. 第2層: PreToolUse リマインド(1回だけの差し戻し)

| matcher | 対象スキル | 意図 |
| --- | --- | --- |
| `Edit\|Write` | `fable-restraint` | 最初のコード変更の直前に規律を読ませる |
| `Agent\|Task` | `fable-subagents` | 最初のサブエージェント起動の直前に読ませる |

- `remind-skill.mjs` は stdin のフック入力から `transcript_path` を取り、トランスクリプトを grep して該当スキルの invoke 履歴を確認する。
- **未読なら** `permissionDecision: "deny"` +「先に `revelation:fable-restraint` を Skill ツールで invoke してから再試行せよ」という理由を返す。deny の理由はモデルにフィードバックされるため、下位モデルでも決定的に invoke へ誘導される。
- **セッションごと・スキルごとに最大1回**だけ差し戻す。差し戻し時にセッション ID をキーとするマーカーファイル(OS の一時ディレクトリ配下)を置き、2回目以降は素通しにしてループを防ぐ。
- 既読(invoke 履歴あり)なら素通し。
- `fable-method` は第2層では扱わない。「着手前」に対応する自然なツールゲートがないため、第1層のトリガー表に任せる。TodoWrite をゲートにする案は、TODO を書かないまま着手するケースを拾えないため過剰な複雑化と判断した。
- codiel の `guard-*.mjs` と同じ command フック構造であり、リポジトリの既存パターンに沿う。

## 4. エラー処理・エッジケース

- transcript が読めない・形式が想定外・マーカーファイルの書き込み失敗 → **素通し(フェイルオープン)**。規律の補助でユーザーの作業を止めない。
- 上位モデル(Fable/Opus)のセッションでも発火するが、トリガー表約10行は無害、差し戻しも最大1回ずつなので許容する。フック入力からモデル名を確実に取得できないため、モデル判別による出し分けは将来課題(§6)。
- PreToolUse はサブエージェントのツール呼び出しにも効くため、第2層はサブエージェント内の無規律も部分的にカバーする。ただしサブエージェントの中には Skill ツールを持たないものもあり、その場合 deny メッセージの指示(Skill ツールで invoke してから再試行)には従えない。deny メッセージ末尾に「Skill ツールが使えない環境ではそのまま同じ操作を再試行すればよい(2回目は素通しされる)」旨を明記し、1回だけの差し戻しで詰まないようにしている。
- スラッシュコマンド等、Skill の `tool_use` 以外の経路でスキル内容を得た場合は `hasSkillInvocation` の既読判定に引っかからず、初回の Edit/Write/Task/Agent で1回 deny される。実害は小さく(2回目以降は素通し)、判定ロジックを複雑化させないためこの挙動を許容する。

## 5. 検証

- **ユニットテスト**: `node --test plugins/revelation/hooks/scripts/*.test.mjs`。transcript のフィクスチャ(invoke 済み/未 invoke/読めない)を与えて deny/allow 判定とマーカーの一回性を確認する。
- **実機確認**: Sonnet/Haiku セッションを起動し、以下を観測する。
  1. セッション冒頭にトリガー表が注入される。
  2. スキル未読のまま Edit/Write すると1回だけ差し戻され、モデルがスキルを invoke してから再試行する。
  3. invoke 後および2回目以降は素通しになる。

## 6. 将来課題

- フック入力または環境からモデル名を判別できるようになったら、上位モデルのセッションでは第1層・第2層をスキップする。
- 実運用データを見て、第2層の対象ツール(例: `Bash` の git 操作)や差し戻し回数の調整を検討する。
