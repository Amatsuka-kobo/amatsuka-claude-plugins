# metatron.config.json のスキーマとパス解決規則

## 変更時のチェックリスト

この規則を変更したら、次をすべて更新して 3 者比較テストを通す。

- [ ] `plugins/metatron/src/lib/config.ts`(正本の実装)
- [ ] `plugins/codiel/src/hooks/lib.ts` の `findDocRoot` / `resolveDocPaths`
- [ ] `plugins/sandalphon/src/check-intent-env.ts`
- [ ] 3 者比較テスト(metatron のテスト R4 / sandalphon のケース 16f)

3 つのプラグインはこの規則を独立に実装している。写しが割れると、同じカレントディレクトリから別のファイルへ辿り着く。

## 設定ファイル

| 項目 | 値 |
| --- | --- |
| ファイル名 | `metatron.config.json` |
| 置き場 | `docRoot` 直下 |
| 形式 | JSON |
| 存在の要否 | 任意 |

設定ファイルが無いときは全項目を既定値として扱う。「設定ファイルが無い」はエラーではなく、ユーザーへの報告対象でもない。

## スキーマ

```json
{
  "version": 1,
  "paths": {
    "architecture": "docs/ARCHITECTURE.md",
    "gotchas": "docs/GOTCHAS.md"
  },
  "injection": {
    "enabled": true,
    "gotchasRecentCount": 5,
    "maxChars": 9000
  }
}
```

| キー | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `version` | number | `1` | スキーマバージョン |
| `paths.architecture` | string | `docs/ARCHITECTURE.md` | ARCHITECTURE のパス |
| `paths.gotchas` | string | `docs/GOTCHAS.md` | GOTCHAS のパス |
| `injection.enabled` | boolean | `true` | SessionStart 注入の有効・無効 |
| `injection.gotchasRecentCount` | number | `5` | 全文で注入する直近エントリ数。0 以上の整数 |
| `injection.maxChars` | number | `9000` | 注入全体の文字数上限。1 以上の整数 |

未知キーは無視する。`$schema` が書かれていても未知キーとして無視する。

## 壊れた設定の扱い

「壊れた JSON」は次の 2 つを指す。

- JSON として解析できない。
- 解析できるが、トップレベルがオブジェクトでない(配列・`null`・数値・文字列)。

- 壊れた JSON のときは全項目を既定値として扱い、理由を `warnings` へ積む。例外は投げない。
- `version` が `1` 以外のときは全項目を既定値として扱い、警告を 1 行添える。
- 個々のキーの型不整合は壊れた JSON に含めない。その項目だけを既定値へ落として理由を積む。
- `paths` / `injection` がオブジェクトでないときは、その配下の項目だけを既定値へ落とす。
- 設定ファイルが存在するのに読めなかったときは、全項目を既定値として扱い理由を積む。

## ルート解決(docRoot)

開始ディレクトリから上方向に探索し、最初に見つかったものを `docRoot` とする。

1. `metatron.config.json` を持つ最も近い祖先ディレクトリ
2. 無ければ `git rev-parse --show-toplevel` の出力
3. それも無ければ開始ディレクトリ

細目は次のとおり。

- 開始ディレクトリは、引数が与えられていればその値、無ければ `process.cwd()` とする。
- 探索を始める前に、開始ディレクトリを `fs.realpathSync` で実体パスへ解決する。解決できないときは解決前のパスをそのまま使う。
- 探索は開始ディレクトリ自身を候補に含める。真の親から始めない。
- 段 1 の探索は、ファイルシステムのルートに達したら打ち切る。
- 段 2 は必ず `git rev-parse --show-toplevel` を実行して得る。`.git` の祖先探索で代替しない。
- git の実行が失敗したときは、原因を区別せず段 3 へ進む。git 未インストール・git 管理外・その他の非 0 終了・タイムアウトのいずれも「無かった」として扱い、例外を外へ投げない。
- 解決結果はキャッシュしない。呼ばれるたびに解決し直す。

## パス解決

- `paths.architecture` / `paths.gotchas` は `docRoot` からの相対パスとして解決する。
- 判定の前に区切り文字を `/` へ正規化する。
- 絶対パスは拒否する。POSIX の先頭 `/`、Windows のドライブレター、UNC のいずれも絶対パスとみなす。
- `..` で `docRoot` の外へ出るパスは拒否する。`docRoot` 自身を指すパスも拒否する。
- 空文字列と文字列でない値は拒否する。
- 拒否した項目だけを既定値へ落とし、理由を `warnings` へ積む。他の項目は落とさない。

## 既定パス

| 文書 | 既定パス | 基準 |
| --- | --- | --- |
| ARCHITECTURE | `docs/ARCHITECTURE.md` | `docRoot`。設定で変更できる |
| GOTCHAS | `docs/GOTCHAS.md` | `docRoot`。設定で変更できる |
| intent 文書 | `docs/intents/YYYY-MM-DD-<slug>.md` | `repoRoot`(git ルート)。設定を持たない |

ARCHITECTURE と GOTCHAS のパスを固定と前提にしない。参照するときは `get config` の出力から取る。
