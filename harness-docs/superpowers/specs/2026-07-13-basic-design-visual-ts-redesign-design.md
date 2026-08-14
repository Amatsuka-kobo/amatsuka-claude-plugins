# basic-design 図生成の TypeScript 化 + ビジュアル刷新 設計

- 日付: 2026-07-13
- 対象: `plugins/basic-design`(図生成パイプライン全体)
- 関連: `docs/superpowers/specs/2026-07-12-basic-design-plugin-design.md`(初版設計)

## 背景と目的

basic-design が生成する図(システム構成図・画面遷移図・ER図・シーケンス図)は、現状「白背景+黒枠」の簡素な見た目で、以下の課題がある。

1. **視覚的な情報量が少ない**: ノード種別・ゾーンの区別が形状と配置のみで、色・アイコンによる意味づけがない
2. **重なりの未対策領域**: ノード同士とノード×エッジは対策済みだが、「エッジ同士の重なり」「エッジラベルとライン/ノード/他ラベルの重なり」は未対策
3. **自作レイアウトの限界**: `route.mjs` の直交ルーティングとグリッド配置は自前実装で、上記を解決しようとするとアルゴリズムの複雑さが増す一方

また、リポジトリ全体を JavaScript から TypeScript へ移行する方針(raguel-mcp の構成に合わせる)が決まっており、**本改修を TS 化の第一弾として実施する**。TS 化により外部依存(ビルド時)が許容されるため、レイアウトエンジン elkjs を導入して重なり問題を根本解決する。

## 決定事項(ブレインストーミングの結論)

| 論点 | 決定 |
| --- | --- |
| 対象形式 | HTML を主軸に凝る。.drawio は再現可能な範囲で追随 |
| デザイン方向 | モダンドキュメント風(意味のある色分け・柔らかい影と角丸・アイコン付きノード・読みやすいタイポグラフィ) |
| 重なり対策 | ラベル重なりまで対策(エッジラベルの背景板+衝突しない配置、平行エッジの分離) |
| 色・アイコンの情報源 | 既存フィールドから自動推定+spec の任意フィールドで上書き |
| 対象図種 | 4種すべて(図種固有の作り込み含む) |
| 実装順序 | 本改修を TS 化第一弾とする(basic-design の scripts を TS 化しつつ elkjs 導入) |

## 全体構成

### パッケージ構成(raguel-mcp 準拠、出力先は現行の scripts/ を維持)

```
plugins/basic-design/
├── package.json        # pnpm / vitest / typecheck / esbuild build(raguel-mcp と同系)
├── tsconfig.json       # raguel-mcp と同設定(strict, esnext, bundler resolution)
├── build.ts            # esbuild: src/cli.ts → scripts/design-gen.mjs、
│                       #          src/check-drive-config.ts → scripts/check-drive-config.mjs
├── src/
│   ├── cli.ts              # 現 design-gen.mjs 相当(引数・JSON 出力仕様は不変)
│   ├── check-drive-config.ts
│   ├── validate.ts         # spec バリデーション(現 validate.mjs 移植)
│   ├── types.ts            # Spec / Layout / Theme の型定義
│   ├── layout/
│   │   ├── graph.ts        # 構成図・画面遷移図・ER図: elkjs 呼び出し共通部
│   │   └── sequence.ts     # シーケンス図: 現行ロジック移植(ELK 不使用)
│   ├── decorate.ts         # 色・アイコン割当(純関数)
│   ├── theme.ts            # デザイントークン(パレット・影・フォント・角丸)
│   ├── render/
│   │   ├── html.ts
│   │   ├── drawio.ts
│   │   └── icons.ts        # インライン SVG アイコンセット
│   ├── xml-util.ts
│   └── *.test.ts           # vitest(src 併置)
├── scripts/
│   ├── design-gen.mjs          # esbuild 単一バンドル(コミット対象)
│   └── check-drive-config.mjs  # 同上
└── skills/ / samples / .claude-plugin/(既存のまま)
```

- ビルド成果物(単一バンドル .mjs)を**現行と同じ `scripts/` に出力**するため、各 SKILL.md の実行コマンド `node "${CLAUDE_PLUGIN_ROOT}/scripts/design-gen.mjs"` は**変更不要**
- ソースは `src/` に置き、esbuild スクリプトは出力先の `scripts/` と紛れないようパッケージルートの `build.ts` とする
- 旧 `scripts/lib/**`・`scripts/route.mjs`・`scripts/*.test.mjs`・`scripts/test-helpers.mjs` は削除(elkjs とテスト移植が代替)。移行完了後の `scripts/` はビルド成果物のみになる
- CLAUDE.md の開発コマンド表を更新(`cd plugins/basic-design && pnpm build / pnpm test / pnpm typecheck`)

### 配布方式の根拠

スキルは `node "${CLAUDE_PLUGIN_ROOT}/…"` を直接実行するため、利用者の環境に node_modules は存在しない。raguel-mcp と同じく **esbuild で依存を焼き込んだ単一バンドルを git にコミット**することで、利用者は従来どおり `node` コマンドだけで実行できる。elkjs は純 JS・実行時依存ゼロなのでバンドルに問題なく含められる(バンドルサイズは約 1.4MB 増)。

検討した代替案: elkjs は依存ゼロの単一ファイル(`elk.bundled.js`)としても配布されるため、「tsc + ベンダリング」(esbuild なし)も成立する。しかし raguel-mcp とのツールチェーン統一を優先して esbuild 方式を採用した(ユーザー決定)。出力先はビルド成果物専用の `dist/` ではなく、現行のスキル呼び出しパスを維持できる `scripts/` とする(同じくユーザー決定)。

## レイアウト設計

### elkjs への委譲(グラフ系 3 図種)

| 図種 | 方式 | ELK 設定の要点 |
| --- | --- | --- |
| システム構成図 | ELK layered | ゾーン=ELK 階層子ノード(padding 付き)。直交エッジ。エッジラベル配置を ELK に委任 |
| 画面遷移図 | ELK layered | 左→右の階層フロー。start/end は terminal 形状のまま |
| ER図 | ELK layered | エンティティ矩形+関連エッジ。カーディナリティはエッジラベルとして配置 |
| シーケンス図 | 自前(現行移植) | 等間隔配置が正解でありグラフレイアウト不要。ELK 対象外 |

- ELK オプション: `elk.algorithm=layered`、`elk.edgeRouting=ORTHOGONAL`、ノード間 spacing、`elk.edgeLabels.placement` 等を指定
- **ノード・エッジ・エッジラベルの重なり回避は ELK が保証**する。自作の衝突回避アルゴリズムは書かない
- ELK layered は決定的(乱数不使用)なので「同一 spec → 同一出力」は維持され、テストの再現性が保たれる
- `elk.layout()` は Promise を返すため、layout 層〜CLI は async 化する。CLI は `main().catch()` で例外を捕捉し、必ず `{ok: false, errors}` の JSON 1 行 + exit code 1 に整形する(JSON は stdout のみに出す)
- ELK に渡すのはノードの `width/height` と階層・エッジ接続のみ。terminal(楕円)等の形状は中間表現の `shape` として保持し、描画はレンダラの責務のまま(ELK は矩形サイズしか関知しない)
- 具体的な spacing 等の数値は実装時にサンプル spec で調整するが、方向は固定する: 画面遷移図は `elk.direction=RIGHT`、構成図・ER図は `DOWN`

### 中間表現(Layout)の型スキーマ

ELK の出力とシーケンス図の自前計算を、次の共通型に正規化して両レンダラへ渡す(詳細は `types.ts` が正とする):

```ts
interface Layout {
  type: 'architecture' | 'screen-flow' | 'er' | 'sequence';
  title: string;
  nodes: LayoutNode[];   // {id, label, shape, x, y, width, height, kindKey, meta, rows?}
  zones?: LayoutZone[];  // {id, label, x, y, width, height}
  lines?: Lifeline[];    // シーケンス図のみ {x, y1, y2, owner}
  edges: LayoutEdge[];
}
interface LayoutEdge {
  id: string; from: string; to: string; label: string;
  style?: 'arrow' | 'sync' | 'async' | 'return';
  cardinality?: string;
  points: Point[];             // 折れ点列(始点・終点含む)。ELK の edge sections を平坦化
  labelBox?: Box;              // ELK が配置したラベル矩形(シーケンス図は自前計算)
}
```

現行との差分: エッジが `fromPt/toPt`(シーケンス)と「レンダラ内で routeOrthogonal を呼ぶ」(グラフ系)の 2 方式だったのを、**全図種で `points` に統一**する。レンダラから経路計算が消え、描画だけになる。

## ビジュアル設計(モダンドキュメント風)

### decorate.ts — 種別の決定

layout 結果の各ノードに `kindKey`(テーマのパレットキー)を付与する純関数。

- **自動推定**: architecture は `icon`・ラベル・ゾーン名に対するキーワード辞書の部分一致(大文字小文字無視。例: `db|データベース|postgres|mysql → db`、`api|gateway → api`)で決定し、優先順は `icon` > ラベル > ゾーン名。どれにも一致しなければ `generic` にフォールバック。screen-flow は `kind`(start / end / screen)から。ER はエンティティ固定。sequence は `kind`(user / system / external)から
- **上書き**: 各 spec ノードに任意フィールド `kind` を追加し、明示指定があれば推定より優先。スキーマ定義(references/spec-schema.md)と SKILL.md に追記
- **後方互換**: `kind` は任意フィールドなので既存 spec はそのまま通る(推定にフォールバック)。バリデーションは未知の `kind` 値をエラーにせず `generic` 扱いにする(スキルのブレストで自由記述が入っても生成が止まらないように)
- 推定はあくまでセーフティネットであり、主経路はスキル側。SKILL.md のブレスト手順に「ノードの種別(kind)を確認して spec に明示する」ステップを足し、新規生成分は明示指定が基本となるようにする

### theme.ts — デザイントークン

- 種別ごとのパレット 7〜8 種: 淡い塗り + 濃い枠 + アイコン色のセット
- ゾーン: 淡色帯 + 左上ラベルチップ
- 共通トークン: 角丸半径、ソフトシャドウ、フォントスタック(system-ui)、エッジ色、ラベル背景

### HTML レンダラ

- ノード: 角丸 + ソフトシャドウ + 左端にインライン SVG アイコン + 種別色
- エッジラベル: 白背景板(rect)付きで可読性を確保。位置は ELK が配置した座標
- タイポグラフィ改善(タイトル/本文のサイズ・ウェイト整理)
- 既存のインタラクション(ズーム・パン・クリック選択・ホバーハイライト・詳細パネル)は維持
- 図種固有の作り込み: ER の PK/FK/UQ バッジ、シーケンスのメッセージ矢印スタイル(sync/async/return)の視覚差別化 等

### drawio レンダラ

- 同じテーマのパレットから `fillColor / strokeColor / rounded=1 / shadow=1` へ変換(draw.io で再現可能な範囲で追随)
- アイコンは draw.io 標準 shape を使わず、ラベルへの絵文字プレフィックスで近似
- エッジは ELK の折れ点を waypoint(mxPoint 配列)として出力
- **意図した非対称**: HTML と drawio のビジュアル差(特にアイコン表現)はトレードオフとして受け入れる。HTML が閲覧用の主成果物、drawio は編集・持ち出し用という役割分担(ブレスト決定事項)

## テスト戦略

- vitest へ移行(raguel-mcp と統一)。既存の `node --test` テストケースは TS に移植
- **重なり性質テスト**: 4 図種のサンプル spec に対しレイアウト後、以下の非交差をアサート
  - (a) ノード矩形同士
  - (b) ノード矩形とエッジセグメント(接続端点を除く)
  - (c) ラベル矩形とノード矩形/他ラベル矩形
  - 判定対象はすべて中間表現(Layout)上の座標。ELK 出力を正規化した後の値なので、レンダラに依存せずテストできる
- ELK の挙動確認を兼ねて、ノード数・エッジ数の多い「複雑ケース」の spec フィクスチャを性質テストに追加する(既存サンプルは小規模のため)
- 推定ロジック(decorate): 既存サンプル spec の全ノードに対する推定結果をスナップショット的にアサートし、辞書変更時の意図しない変化を検出
- レンダラ: 既存同様の文字列/構造テスト
- `samples/` の HTML / drawio を新ビジュアルで再生成して更新し、目視確認する(HTML をブラウザで開いて4図種を確認)。elkjs はバージョン固定(`^` を使わず exact)し、意図しないレイアウト変化を防ぐ

## エラーハンドリング

- CLI の入出力仕様(`{ok: boolean, files/errors}` の JSON 1 行)は不変。スキル側の変更は実行パスのみ
- ELK が例外を投げた場合は `ok: false` の errors に整形して返す(スキルが利用者に提示できる形)

## リスクと対応

- **ER図と ELK layered の相性**: ER はカーディナリティラベル付きエッジが密になりやすく、layered の出力が読みにくい可能性がある。実装計画では ER を最後に回し、先行図種で ELK 設定の知見を得てから調整する。どうしても品質が出なければ ER のみ現行グリッド配置+ELK エッジルーティングのハイブリッドに退避する(この判断は実装中に samples の目視で行う)
- **ロールバック**: 旧 `scripts/lib/**` の削除は、新パイプラインで 4 図種すべての samples 再生成と目視確認が済んだ後の最終コミットで行う(それまで新旧併存させ、revert 可能性を保つ)
- **elkjs の保守**: バージョンは exact 固定でバンドルに焼き込む。更新は「samples 再生成 → 性質テスト → 目視」の手順を README(design-gen パッケージ内)に記す

## check-drive-config の扱い

`check-drive-config.mjs` は Drive 設定ファイルの読み取り検査のみの小さな CLI。`src/check-drive-config.ts` として移植し、esbuild のエントリポイントに追加して `scripts/check-drive-config.mjs` を出力する(機能変更なし。既存テストを vitest に移植)。

## バージョニング

変更規模が大きい(パッケージ構成刷新・出力ビジュアル刷新)ため、メジャーバージョンアップ相当かの判断は人間に確認する(CLAUDE.md ルール)。確認までは 0.x 系のマイナーアップ(0.5.0-dev 系)で進める。

## スコープ外

- basic-design 以外のプラグインの TS 化(本改修は第一弾であり、他は別途)
- Markdown 系成果物(API 一覧・非機能要件)の変更
- Google Drive 連携の変更
