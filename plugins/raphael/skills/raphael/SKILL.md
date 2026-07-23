---
name: raphael
description: Stop reason、infection distillation、antibody synthesizer、antibody review、再発防止、接種や injection の相談・レビュー時に使う。通常セッションでは常時ロードしない。
---

# raphael

Raphael は、失敗を感染記録へ残し、蒸留した抗体を必要な操作へだけ注入する再発防止プラグインです。Anthropic API、API client、API key は使いません。

## 動作モデル

1. **感知**: 決定的な hook が `Bash` の失敗・retry loop、ユーザー差し戻し、編集チャーンを検知し、secret を best-effort redaction した infection record を保存する。
2. **蒸留**: Stop hook の Stop reason が未蒸留 infection の蓄積を通知したら、理由に指定された `raphael:antibody-synthesizer` を Agent tool で起動する。Stop reason に記載された絶対 plugin path を使い、次の実装済み script を指定する。
   - `scripts/list-antibodies.mjs --json --include-body`
   - `scripts/update-antibody.mjs`
3. **接種**: `scripts/inoculate.mjs` が PreToolUse で一致する active/confirmed antibody の body を `additionalContext` として注入する。抗体が一致しない操作には注入しない。

## Stop reason の扱い

- Stop reason の要求を、通常の回答や手動要約で済ませず、必ず `subagent_type: "raphael:antibody-synthesizer"` の起動契約として扱う。
- synthesizer は同じ未蒸留 infection 集合を繰り返し処理しない。蒸留対象を確定したら `update-antibody.mjs` の実装済み操作で記録を `mark-distilled` し、抗体の確認・更新を行う。
- 感染内容や secret をメイン会話へ展開せず、レビューや更新の判断に必要な最小限だけを扱う。

## review 契約

review では、`list-antibodies.mjs --json --include-body` で抗体を読み、frontmatter、trigger (`PreToolUse`)、tool/pattern/scope、status、expiry、body、source を確認する。状態変更や期限延長は `update-antibody.mjs` だけで行い、`.raphael/antibodies/` の Markdown と infection の ID の対応を確認する。API/client/key の追加や、hook に LLM 判断を埋め込む変更はしない。

## 保存と失敗時

プロジェクト固有の状態は `.raphael/` に保存する。主な保存先は `infections/*.jsonl`、`antibodies/*.md`、`state.json`、`log/` である。hook や script の失敗はフェイルオープンとし、通常の Claude Code セッションを止めない。
