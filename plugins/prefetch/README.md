# prefetch

ユーザー入力待ちの直前に、回答後に高確率で必要となる読み取り主体の探索をバックグラウンドで先行実行し、回答後の立ち上がり時間を短縮する Claude Code プラグインです。

CPU の投機実行と同様に、「次に必要になりそうで、外れても副作用がない作業」だけを先に進めます。予測が外れた場合や先行探索が失敗した場合は成果を破棄し、通常フローへ戻ります。

## 導入

Claude Code で Marketplace を追加します。

```text
/plugin marketplace add https://github.com/Amatsuka-kobo/amatsuka-claude-plugins
```

Marketplace から `prefetch` をインストールします。

```text
/plugin prefetch
```

プロジェクト単位またはユーザー単位で導入する場合はスコープを指定します。

```text
/plugin prefetch --scope project
/plugin prefetch --scope user
```

インストールまたはフック設定の更新後は、Claude Code のセッションを再起動してフックを反映してください。

## `.gitignore` の設定

prefetch の成果はプロジェクトルートの `.prefetch/` に保存されます。これはセッションローカルな投機成果であり、リポジトリへコミットしません。利用プロジェクトの `.gitignore` に次の 1 行を追加してください。

```gitignore
.prefetch/
```

プラグインは `.gitignore` を自動変更しません。

## 動作モデル

### 1. 予測

Claude が次のようなユーザー入力待ちに入る直前、回答後に必要となる読み取り主体の作業を予測します。

- AskUserQuestion による質問
- ExitPlanMode による計画承認依頼
- 設計、計画、スペックのレビュー依頼

どの回答でも必要になる影響範囲調査、既存実装パターンの確認、関連テストケースの洗い出しなどの no-regret な作業を優先します。有用な予測がなければ何も起動しません。

### 2. 先行実行

予測した作業をバックグラウンドサブエージェントへ渡し、ユーザーが回答を考えている間に実行します。

- 先行作業は読み取り主体のみ
- コード、設定、通常ドキュメントは変更しない
- 成果は `.prefetch/<task-id>/result.md` のみに保存
- 先行サブエージェントはスキルをロードしない
- 既定モデルは `haiku`、複数モジュール間の契約を追う深い探索だけ `sonnet`
- 1 回の入力待ちにつき最大 3 件。前回の `running` を含む合計も最大 3 件

### 3. 回収

次のユーザー入力を受けたターンの冒頭で `.prefetch/manifest.md` を確認します。

- 回答の有効条件に合致する成果だけを読み、`harvested` にする
- 合致しない成果は読まずに `discarded` にする
- 失敗した探索は `failed` にして通常フローへ戻る
- 実行中の成果は、待つ価値があれば完了を待ち、そうでなければ通常作業を先に進める

UserPromptSubmit フックは manifest に `running` または `done` がある場合だけ回収リマインダーをコンテキストへ注入します。manifest がない場合や全件回収済みの場合は何も出力しません。

## manifest

`.prefetch/manifest.md` は次の形式です。

```markdown
# prefetch manifest

| task-id | 予測内容 | 有効条件 | 状態 | 成果パス |
|---|---|---|---|---|
| fr-001 | 対象モジュールの既存実装パターンを調査する | 提示した設計案が承認された場合 | running | .prefetch/fr-001/result.md |
```

状態は次の順に遷移します。

```text
running → done → harvested
               → discarded
running → failed
```

manifest を更新するのはメインエージェントだけです。先行サブエージェントは manifest に触れず、自分の `result.md` だけを書きます。

## ガードレール

- Anthropic API、API キー、外部 API クライアントを使用しません
- 他のプラグインに依存しません
- 予測ミスは成果を破棄するだけで、コードへの副作用を残しません
- prefetch が失敗・未完了でも本作業を止めません
- `.prefetch/` 以外へ先行書き込みを行いません

## 構成

```text
plugins/prefetch/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   └── hooks.json
├── scripts/
│   └── check-prefetch-manifest.mjs
├── skills/
│   └── prefetch/
│       └── SKILL.md
└── README.md
```

このプラグインは Markdown、JSON、Node.js の `.mjs` だけで構成され、ビルドは不要です。
