# agent-policy モデルエイリアスの柔軟化設計

- 日付: 2026-09-23
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: 過去の廃止経緯(エイリアス環境変数)、cliproxyapi.config.example.yaml の oauth-model-alias
- セッション ID: 7f7b3895-0bf7-49e6-a1f6-058a9f002b65

---

## セッション 1: agent-policyでモデルエイリアスの版番号なし化を実現する方式の検討

# phyllis998

> agent-policyが対応するClaude以外のモデルについて、それぞれのモデルの今後のバージョンアップに対して柔軟に備えられるように、model指定にgpt-sol、のような短いエイリアスを指定できるような仕組みを作りたいです。アイディアを一緒に考えてください。

# AI

Using superpowers:brainstorming で設計を練る前に、まず過去の廃止経緯(エイリアス変数)を確認。

## 理解の書き戻し

- **やりたいこと**: 定義の `model:` に `gpt-sol` 的な版番号なしの短い名前を書き、GPT 5.6→5.7 等の更新時に各プロジェクトの定義を書き換えずに済ませる
- **前提(コードから確認)**:
  - 現状の `model` 値は `claude-gpt-5-6-sol` 等、**版番号を含むプロキシ側エイリアス**(`cliproxyapi.config.example.yaml` の `oauth-model-alias`)
  - この名前は `MODELS[].model` の既定値、生成済み `.claude/agents/*.md` 14 件中 8 件、設定例の 3 箇所に散在
  - **Claude Code が `model:` を解決する層はプロキシだけ**。agent-policy の hook はファイルを書かない設計(SessionStart は検証・注入のみ)。旧 `AMATSUKA_AGENT_*_ALIAS` 環境変数は「プロキシに無い名前で沈黙故障」を理由に廃止済み
- **分類**: architectural 寄り(setup-agents・SessionStart・設定例に跨る)。今はアイディア段階 → 案出しと合意まで。

## 推奨: A. エイリアスをプロキシ層で版番号なしにする

理由: Claude Code が `model:` を読む経路上で名前を差し替えられるのはプロキシのみ。agent-policy 内に別の対応表を持つと、廃止済みの env エイリアスと同じ構造(プロキシと表の二重管理 → 不一致 → 沈黙故障)に戻る。プロキシ側の `oauth-model-alias` は既存機能で、追加コード不要。

具体:
- `oauth-model-alias` の `alias` を `claude-gpt-sol` / `claude-gpt-terra` / `claude-gpt-luna` / `claude-gpt-astra` / `claude-grok` / `claude-gemini-flash` に(`claude-` 接頭辞は Claude Code の受理条件のため維持。要確認)
- `MODELS[].model` 既定値を同名に変更(6 行)。SessionStart の `/v1/models` 実在検証・`recommendedForAlias` の照合は無変更で機能
- 版更新の作業 = 設定 yaml の `name:` 1 行 + プロキシ再起動。定義・プラグインは無変更
- 版を固定したいプロジェクトは、従来通り版付きエイリアスをプロキシに併記し `--model` で指定(両立可)
- 移行: 設定例に新旧エイリアスを併記 → このリポの定義を setup-agents で再生成 → 旧エイリアス削除

## 対案

**B. agent-policy 内に対応表 + `setup-agents --sync-models`**
- `.claude/agent-policy/models.json`(短名→実在エイリアス)を持ち、CLI が既存定義の `model:` 行だけ書換。SessionStart は定義値 ≠ 表の値で「再同期せよ」通知
- 利点: プロキシ設定を触れない利用者でも agent-policy 内で完結
- 欠点: プロキシ機能の再実装。hook はファイル書換不可 → 版更新ごとに手動 sync 必須。二重管理で沈黙故障の構造が復活

**C. Claude Code 自体のエイリアス機構**
- `ANTHROPIC_DEFAULT_*_MODEL` は Claude enum 4 値限定。任意名の対応表は無い → 不成立(Context7 で最新仕様を確認する価値はある)

## 判断軸

- 変更量: A 小(既定値 6 行+設定例+README) / B 中(CLI・hook・テスト)
- 版更新時の作業: A yaml 1 行 / B 表 1 行 + 全プロジェクトで sync 実行
- 版 pin の可否: A 併記で可 / B 表の設計次第
- 沈黙故障リスク: A 低(実在検証が既存) / B 中(表とプロキシの乖離)
- 過去の却下案との整合: A 整合 / B env エイリアス廃止理由と衝突

## 質問(1 つ)

A で進める前提で設計を詰めてよいか。B を選びたい理由(例: プロキシ設定を利用者に触らせたくない、プロジェクトごとに解決先を変えたい)があれば、それを教えてほしい。

前ターンの質問(A で進めるか、B を選ぶ理由があるか)への回答待ち。

## セッション 2: B案の詳細解説:内部対応表による版管理戦略

# AI

記録完了通知のみ。ユーザーの回答待ち継続。

前ターンの質問: **A(プロキシ層で版番号なしエイリアス)で進めるか、B(agent-policy 内対応表)を選ぶ理由があるか。**

記録タスク完了通知のみ。ユーザー入力なし → 回答待ち継続。

質問は据え置き: **A(プロキシ層で版番号なしエイリアス)で進めるか、B を選ぶ理由があるか。**

# phyllis998

> Bについてもう少し詳しく解説おねがいします

# AI

## B の詳細: agent-policy 内で短名を解決する

### 前提となる制約

- Claude Code は定義ファイルの `model:` をそのまま API へ送る。hook は差し替えできない
- agent-policy の hook は設計上ファイルを書かない(SessionStart は検証と注入だけ)
- → 短名を実在エイリアスへ置換する作業は、**必ず CLI による定義ファイルの書換**として起きる。起動時の自動解決は不可

### B の最小形は既に半分ある

- `MODELS[].id`(`gpt-sol`)が短名、`MODELS[].model`(`claude-gpt-5-6-sol`)が解決先。この表はプラグインに内蔵
- 版更新 = プラグイン側で `MODELS[].model` 変更 → 利用者は setup-agents ウィザード再実行
- 欠けているもの 3 つ:
  1. 生成済み定義が「どの短名から作られたか」を覚えていない。frontmatter に書かれるのは `agent-policy-role` と `agent-policy-vendor` のみ。`model` 値から逆引きするしかない
  2. `model:` 行だけを書き換える軽い CLI が無い。ウィザード全体を回す必要がある
  3. 起動時に「定義の `model` が表の現在値と違う」を検知する仕組みが無い(実在検証はあるが、旧版エイリアスがプロキシに残る限り通る)

### B の構成要素

1. **短名の記録**: 生成時に frontmatter へ `agent-policy-model: gpt-sol` を書く。`model:` は解決後の実在エイリアスのまま(Claude Code 互換)
2. **解決表の置き場**(2 変種):
   - B-1 プラグイン内蔵表のみ: `MODELS[].model` が唯一の正本。版更新はプラグインのリリース
   - B-2 利用者上書き表: `~/.claude/agent-policy/models.json` または `.claude/agent-policy/models.json` に `{ "gpt-sol": "claude-gpt-5-7-sol" }`。内蔵表を既定、上書き表が優先
3. **`setup-agents --sync-models`**: `.claude/agents/` を走査し、`agent-policy-model` を持つ定義の `model:` 行だけを表の現在値へ書換。`--check` で差分表示、`--write` で適用。既存の diff 保護(`--merge`/`--keep`)を流用
4. **SessionStart の乖離検知**: 実在検証に加え、`agent-policy-model` の解決先 ≠ `model` なら「`--sync-models` を実行せよ」を注入。フォールバックはしない(旧版も実在するため動作はする)

### 版更新時の流れ

- B-1: プラグイン更新 → SessionStart が乖離通知 → 各プロジェクトで `--sync-models --write`
- B-2: 表 1 行編集(+ プロキシ側に新エイリアス追加) → 同上

### 弱点

- **二重管理**: 表の値とプロキシの `oauth-model-alias` を両方合わせる必要がある。B-2 は特に、廃止済み env エイリアスと同じ「表にはあるがプロキシに無い」構造。実在検証で沈黙故障は防げるが、フォールバック発生
- **手動 sync 必須**: プロジェクト数ぶん実行。hook が書けない制約は変えられない
- **実装量**: frontmatter キー追加、sync コマンド、乖離検知、テスト。A は既定値 6 行
- B-1 は「版更新のたびにプラグインリリース」で、柔軟性の獲得幅が小さい

### B が A に勝つ条件

- プロキシ設定を触れない・触らせたくない利用者がいる
- プロジェクトごとに同じ短名を別の解決先にしたい(例: あるプロジェクトだけ旧版 pin)
- プロキシを CLIProxyAPI 以外に替える可能性があり、エイリアス機能に依存したくない

この 3 つのいずれかに該当するか。該当しなければ A を推奨したまま。

B の解説は前ターンに提示済み。回答待ち: **B が勝つ 3 条件(プロキシ設定を触らせたくない / プロジェクト別 pin / プロキシ乗換)のいずれかに該当するか。**
