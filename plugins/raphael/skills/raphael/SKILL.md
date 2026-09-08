---
name: raphael
description: Stop reason、infection distillation、antibody synthesizer、antibody review、再発防止、接種や injection の相談・レビュー時に使う。通常セッションでは常時ロードしない。
---

# raphael

Raphael は、失敗を感染記録へ残し、蒸留した抗体を必要な操作へだけ注入する再発防止プラグインです。Anthropic API、API client、API key は使いません。

## 動作モデル

1. **感知**: 決定的な hook が `Bash` の失敗・retry loop、ユーザー差し戻し、編集チャーンを検知し、secret を best-effort redaction した infection record を保存する。
2. **蒸留**: Stop hook の Stop reason が未解決の失敗の種類数を基準に蒸留を促したら、理由に指定された `raphael:antibody-synthesizer` を Agent tool で起動する。同じ失敗を 3 回繰り返しても 1 種類として数え、失敗の後に同じコマンドが成功したもの(自己解決)は数から除く。Stop reason には「未解決の失敗の種類数」と「未蒸留 infection 件数」の 2 行が出る。Stop reason に記載された絶対 plugin path を使い、次の実装済み script を指定する。
   - `scripts/list-antibodies.mjs --json --include-body`
   - `scripts/update-antibody.mjs`
3. **接種**: `scripts/inoculate.mjs` が PreToolUse で一致する active/confirmed antibody の body を `additionalContext` として注入する。抗体が一致しない操作には注入しない。

## Stop reason の扱い

- Stop reason の要求を、通常の回答や手動要約で済ませず、必ず `subagent_type: "raphael:antibody-synthesizer"` の起動契約として扱う。
- synthesizer は同じ未蒸留 infection 集合を繰り返し処理しない。蒸留対象を確定したら `update-antibody.mjs` の実装済み操作で記録を `mark-distilled` し、抗体の確認・更新を行う。
- 感染内容や secret をメイン会話へ展開せず、レビューや更新の判断に必要な最小限だけを扱う。

## review 契約

review では、`list-antibodies.mjs --json --include-body` で抗体を読み、frontmatter、trigger (`PreToolUse`)、tool/pattern/scope、status、expiry、body、source を確認する。状態変更や期限延長は `update-antibody.mjs` だけで行い、`.raphael/antibodies/` の Markdown と infection の ID の対応を確認する。API/client/key の追加や、hook に LLM 判断を埋め込む変更はしない。

## trigger の粒度

- trigger の `pattern` は、その抗体が防ぐ失敗を**再現しうるコマンドの形**に一致させる。コマンドの構文的な特徴(`&&`、パイプ、リダイレクト、引用符)だけに一致させない。
- 失敗したコマンドに現れた識別子(サブコマンド名、オプション名、対象のツール名)を pattern に含める。含められないなら、その知識は抗体にしない。
- 抗体は `create` と `patch` の preflight で広さを検査される。母集団の 10% を超えるコマンドに一致する pattern は拒否される。拒否されたら pattern を絞って一度だけ再試行し、絞れないなら非採用とする。
- 抗体にするのは、次の二問がどちらも Yes のものだけとする。問 1「この知識を次回知らないと、同じ失敗をするか」、問 2「この知識は、別のリポジトリへ持っていっても成立するか」。

## 保存と失敗時

プロジェクト固有の状態は `.raphael/` に保存する。主な保存先は `infections/*.jsonl`、`antibodies/*.md`、`state.json`、`log/` である。

- `stats.json` — 抗体ごとの発火回数(`fired` / `last_fired`)と miss 回数(`misses` / `last_miss`)、および蒸留催促の抑止 digest。抗体 Markdown の frontmatter からは統計を外したため、発火しても抗体ファイルは変更されない。
- `commands.jsonl` — Bash の実行履歴。成功・失敗を問わず記録し、trigger の広さ検査と棚卸しの母集団になる。

`stats.json` と `commands.jsonl` は git 管理から外す。hook や script の失敗はフェイルオープンとし、通常の Claude Code セッションを止めない。
