# raguel-mcp 実装セッション(M1〜M4)

- 日付: 2026-07-07
- 参加者: hiro0209, AI (Claude Fable 5)
- 成果物: Raguel MCP 本体の全実装(`src/` 一式、274 テスト、dist ビルド)、`.mcp.json` 修正
- 前提: `docs/DESIGN.md`(設計書)と `docs/chat/2026/0707/raguel-mcp-design-session.md`(設計セッション)

---

## セッション1: 実装依頼と計画立案

# hiro0209

Codielプラグインの中核システムで、AIの暴走を防ぐためのツールを提供するMCPサーバー、Raguel MCPを実装してください。設計書はdocs/DESIGN.mdで、設計書の作成チャット記録はdocs/chat/2026/0707/raguel-mcp-design-session.mdにあります。

# AI

プランモードで設計書・セッション記録・既存の足場(package.json / esbuild ビルド / `.mcp.json`)を確認し、スコープを質問。

→ hiro0209 の回答: **M1〜M4 全部**(推奨案)を採用。M5(Codiel オーケストレーター組み込み)のみ次回へ。

Plan エージェントによる詳細計画を経て、以下の実装計画を提示し承認を得た:

- **Phase 0(足場)**: 依存追加(zod v4 / yaml / picomatch / vitest)、`vitest.config.ts`、`.mcp.json` の stdio 修正、共有型 `src/core/types.ts`、stderr 専用ロガー
- **Phase 1(4 レーン並列、Sonnet サブエージェント分担)**:
  - レーン A: config(defaults / zod スキーマ / 不変条件検証 / loader・configHash)
  - レーン B: ルールエンジン(§5 全 14 ルール + diff パーサ)+ 重さ判定(§6 昇格のみ床)
  - レーン C: ケースファイル(ハッシュチェーン)+ 判例ストア(自前 BM25 決定論検索 + シード判例 9 件)
  - レーン D: LLM 判定パネル(`claude -p` ヘッドレス、6 パネリスト、再帰防止の多層防御)
- **Phase 2(統合、メインが担当)**: 合成規則 `verdict.ts`、`pipeline.ts`、6 MCP ツール、`server.ts`、ゴールデンテスト
- 設計書の曖昧点への推奨解(エントロピー検出、5-gram Jaccard 類似度、BM25 合成スコア、projectId 導出、claude CLI 引数など)も計画に織り込み

## セッション2: 実装の実行

# AI

計画通りに実行。経過と主な出来事:

1. **Phase 0**: 依存導入(zod 4.4.3 / vitest 4.1.10)、`.mcp.json` を設計書 §13 の `node` + stdio 形式へ修正、共有型・ロガーを作成。実機の `claude --help` でフラグ(`--tools` / `--json-schema` / `--strict-mcp-config` / `--bare`)の実在を確認
2. **合成規則の先行実装**: レーン並列実行中に、メイン(Fable)が心臓部 `src/core/verdict.ts`(§2 の 6 規則 × 不変条件)をテーブル駆動テスト 21 件付きで実装
3. **4 レーン完了**(Sonnet サブエージェント並列): config 35 件 / ルール 115 件 / ケースファイル・判例 35 件 / パネル 52 件のテストがそれぞれ green。全体 typecheck もクリーン
4. **Phase 2 統合**: `pipeline.ts`(ルールパス → 重さ判定 → 判例検索 → パネル → meta → 合成 → 証拠永続化、前フェーズ証拠のハッシュチェーン検証で改竄は即 STOP)、6 ツール、フェイルクローズドラッパー(内部例外は MCP エラーでなく `verdict: onError` の正常応答)、再帰ガード付き `server.ts`
5. **ゴールデンテスト 16 件 + MCP 統合スモーク 5 件**: 無害 diff → PROCEED、保護パス / `curl|sh` / シークレット → STOP、ASK 床、steelman 全反駁 → PROCEED、分散 ASK、provider none → ASK、再提出ループ 3 回 → STOP、record_outcome 判例化と改竄拒否、など全通過

**実装中に判明した問題と修正 2 点**:

- **esbuild banner の識別子衝突**: banner が宣言する `url` が zod v4 の `url` 関数とトップレベルで衝突し dist が起動不能 → banner を `__raguelFileURLToPath` 等の衝突しない名前に修正
- **claude CLI の `--bare` は認証まで外す**: パネリスト起動が「Not logged in」で全滅。実機検証の結果 `--bare` / `--setting-sources ""` がユーザーのログイン情報(user 設定ソース)を落とすことを特定 → 武装解除は `--tools "" --disable-slash-commands --strict-mcp-config --mcp-config '{"mcpServers":{}}'` の組み合わせに変更(`claudeCli.ts` にコメントで記録)

**最終検証結果**:

- `pnpm typecheck` / `pnpm test`(**274 件全通過**)/ biome / `pnpm build` すべてクリーン
- ビルド済み `dist/server.mjs` の stdio initialize ハンドシェイク成功、6 ツール登録、stdout 非汚染
- 実機スモーク: 無害 diff → PROCEED(trivial・パネル起動なし)、`.github/**` → STOP、シークレット → STOP。ケースファイルが `~/.raguel/cases/` に生成されハッシュチェーン検証 OK
- **実 claude CLI での standard ティア実行**: adversarial(sonnet)が「自動生成と言いつつ生成スクリプトがないハードコード」を confidence 88 で攻撃、confidence 閾値未満の所見は info 降格、meta のスキーマ不一致 1 回は自動リトライで回復、再提出ループも検知して **ASK**。法廷モデルが設計意図通りに機能することを実機で確認
- 再帰ガード(`RAGUEL_PANELIST=1` で即終了)動作確認済み

注意事項: コミットは未実施(ユーザー確認待ち)。次の作業は M5(Codiel オーケストレーターへの組み込み — フェーズ間ゲートとしての呼び出し規約・`record_outcome` の運用整備)。
