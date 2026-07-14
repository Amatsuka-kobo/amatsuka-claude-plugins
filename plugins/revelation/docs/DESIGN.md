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
├── scripts/
│   ├── inject-trigger-map.mjs          # 第1層: SessionStart のバンドル
│   └── remind-skill.mjs                # 第2層: PreToolUse のバンドル
├── src/
│   ├── inject-trigger-map.ts           # 第1層: SessionStart のソース
│   ├── remind-skill.ts                 # 第2層: PreToolUse のソース
│   └── __test__/                       # vitest ユニットテスト
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

- `remind-skill.mjs` は stdin のフック入力から**行為者本人**のトランスクリプトを特定し、該当スキルの既読履歴を確認する。サブエージェント発の呼び出しでは `transcript_path` が常にメインセッションを指す(実測)ため、入力の `agent_id` から本人の transcript(`<transcript の dir>/<session_id>/subagents/agent-<agent_id>.jsonl`)を引く。
- **未読なら** `permissionDecision: "deny"` +「先に読んでから再試行せよ」という理由を返す。deny の理由はモデルにフィードバックされるため、下位モデルでも決定的に誘導される。誘導先は行為者により変える:
  - メインセッション → Skill ツールで invoke(失敗時は Read で SKILL.md 直読みのフォールバックを案内)。
  - サブエージェント → 最初から Read ツールで SKILL.md の絶対パスを読ませる(Skill ツールを持たないエージェントがあるため。スキルの実体は Markdown なので Read でも規律注入として等価)。
- 「指示に従わずそのまま再試行してよい」とは**案内しない**。マーカーによる2回目素通しは詰み防止の安全網であって、文面で宣伝すると下位モデルが「スキルが見つからない」と称して安易に逃げる(実際に観測された)。
- **行為者ごと・スキルごとに最大1回**だけ差し戻す。マーカーファイルのキーは `セッションID-agent_id(メインは "main")-スキル名`。エージェント単位にすることで、サブエージェントの差し戻しが親の枠を消費する相互汚染を防ぐ。
- 既読(Skill invoke 履歴、または該当 SKILL.md への Read 履歴)なら素通し。
- プロンプトが完全にスクリプト化された自前エージェント(`SKIP_AGENT_TYPES`、例: `task-utility:chat-recorder`)は素通し。行動の自由度が無く、差し戻しの往復コストに見合わないため。
- `fable-method` は第2層では扱わない。「着手前」に対応する自然なツールゲートがないため、第1層のトリガー表に任せる。TodoWrite をゲートにする案は、TODO を書かないまま着手するケースを拾えないため過剰な複雑化と判断した。
- codiel の `guard-*.mjs` と同じ command フック構造であり、リポジトリの既存パターンに沿う。

## 4. エラー処理・エッジケース

- transcript が読めない・形式が想定外・マーカーファイルの書き込み失敗 → **素通し(フェイルオープン)**。規律の補助でユーザーの作業を止めない。
- この規律の対象は Fable 未満のすべてのモデル(Opus を含む)。第2層(`scripts/remind-skill.mjs`、ソース: `src/remind-skill.ts`)は**行為者本人**の transcript の assistant イベントの `message.model` から Fable を判別し、本人が Fable なら差し戻しをスキップする(`lastAssistantModel`、`plugins/revelation/src/lib.ts`)。Fable 親 + Sonnet サブエージェントの構成でも、Sonnet サブエージェントには正しく差し戻される。第1層(SessionStart)は発火時点で assistant メッセージが存在せずコードでの判別ができないため、`trigger-map.md` 側の文言(「Fable として動作している場合はこの表に従う必要はない」)で対処する。
- PreToolUse はサブエージェントのツール呼び出しにも発火する(実測)。そのときフック入力の `session_id` / `transcript_path` はメインセッションのもので、`agent_id` / `agent_type` フィールドが追加される。本人の transcript は `subagentTranscriptPath` で導出する。このレイアウトは Claude Code の非公開の内部仕様のため、ファイルが存在しなければ**素通し(フェイルオープン)** — 将来レイアウトが変わっても「効かなくなる」だけで作業は止まらない。
- deny された Task/Agent 呼び出しではサブエージェントは起動されず、transcript ファイルも作られない(実測)。deny の理由は呼び出し元(親)にツールエラーとして返る。
- スラッシュコマンド等、Skill の `tool_use` 以外の経路でスキル内容を得た場合は `hasSkillInvocation` の既読判定に引っかからず、初回の Edit/Write/Task/Agent で1回 deny される。実害は小さく(2回目以降は素通し)、判定ロジックを複雑化させないためこの挙動を許容する。

## 5. 検証

- **ユニットテスト**: root で `pnpm test` を実行する(テストソース: `plugins/revelation/src/__test__/*.test.ts`)。transcript のフィクスチャ(invoke 済み/未 invoke/読めない)を与えて deny/allow 判定とマーカーの一回性を確認する。
- **実機確認**: Sonnet/Haiku セッションを起動し、以下を観測する。
  1. セッション冒頭にトリガー表が注入される。
  2. スキル未読のまま Edit/Write すると1回だけ差し戻され、モデルがスキルを invoke してから再試行する。
  3. invoke 後および2回目以降は素通しになる。

## 6. 将来課題

- 第2層(PreToolUse)でのモデル判別・Fable スキップは実装済み。残るのは第1層(SessionStart)での確実なモデル判別のみ — SessionStart 発火時点では transcript に assistant メッセージが無いことがあり、コードでの判別ができないため、現状は `trigger-map.md` の文言で対処している。
- 実運用データを見て、第2層の対象ツール(例: `Bash` の git 操作)や差し戻し回数の調整を検討する。
