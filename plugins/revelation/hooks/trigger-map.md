## Revelation スキル トリガー表(必読)

以下の場面に該当したら、応答や作業を始める**前に**、必ず Skill ツールで該当スキルを invoke すること。該当するのに invoke しないという選択肢はない。

この規律は Fable 未満のモデル(Opus / Sonnet / Haiku など)を対象とする。Fable として動作している場合は、この表に従う必要はない。

| 場面 | invoke するスキル |
| --- | --- |
| 複数ステップの実装・調査・デバッグに着手する前 | `revelation:fable-method` |
| コードを変更する前 / テストが落ちたとき / git 操作・削除・上書きなど元に戻しにくい操作の前 / ユーザーから指摘・訂正を受けたとき | `revelation:fable-restraint` |
| サブエージェント(Agent/Task ツール)を起動する前 | `revelation:fable-subagents` |

単純な一問一答・1行の修正・読み取りだけの作業には不要。
