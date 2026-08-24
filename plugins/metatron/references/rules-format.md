# rules の書式

## ファイル構成

ファイル名と内容の対応を次に固定する。config では変えられない。変えられるのは置き場(`paths.rulesDir`、既定 `.claude/rules/metatron`)だけである。

| ファイル | 内容 |
| --- | --- |
| `conventions.md` | コーディング規約・ブランチ運用・DoD |
| `protected-paths.md` | 触らないパスと、変更に慎重を要するパス |
| `testing-policy.md` | ユニットテストと E2E の役割分担、テストの配置と命名 |

- CLI の `name` キーは拡張子を除いたファイル名(`conventions` / `protected-paths` / `testing-policy`)をそのまま使う。
- 更新は `stage-rules` → `commit-rules` で行う。直接編集は PreToolUse hook が拒否する。
- 3 ファイルに収まらない規律は `.claude/rules/` 直下へユーザーが自由に置く。metatron はそこを読み書きせず、hook も拒否しない。

## ファイルの構造

- 1 行目を `# 見出し` とする。`stage-rules` の `body` は見出し行を含む完全なファイル内容であり、ARCHITECTURE のセクション本文と違う。
- 2 行目に管理者表示行を置く。
- frontmatter を書かない。`paths` を含め、いかなるキーも書かない。frontmatter を持つファイルは起動時に読み込まれず、サブエージェントにも渡らない。
- `##` 以下の小見出しは自由に置く。ARCHITECTURE と違い、見出しの許可リストを持たない。

### 管理者表示

見出しの直後へ次の 1 行をそのまま置く。

```
> この文書は metatron の管理下にある。直接編集は PreToolUse hook が拒否する。更新は metatron の CLI(`stage-rules` → `commit-rules`)で行う。CLI の絶対パスは、セッション冒頭の注入文または hook の拒否メッセージに載っている。
```

- この行が本文の先頭 5 行に無いと `stage-rules` が `missing_admin_notice` で拒否する。
- CLI の絶対パスをこの行に書かない。インストール先で変わるため、読み手は注入文または拒否メッセージから取る。

## 分量

- 1 ファイル 200 行を目安とする。超えても拒否されず、警告だけが返る。
- **公式が rules に定めた上限は存在しない。** CLAUDE.md の `target under 200 lines` を運用上の目安として借りた metatron 側の判断であり、公式仕様ではない。
- rules は起動時に読み込まれ、サブエージェントへ委譲するたびに再度読み込まれる。`references/writing-discipline.md` の削る基準を全文へ強く当てる。

## conventions.md
- コーディング規約・ブランチ運用・DoD を書く。
- 言語やフォーマッタの既定と同じ内容は書かない。
- 禁止事項には代わりに取る手段を併記する。

## protected-paths.md
- 触らないパスと、変更に慎重を要するパスを分けて列挙する。
- 触らないパスには、変更が必要になったときに取る手順(誰に確認するか)を併記する。
- 慎重を要するパスには、変更してよい条件(何を確認するか、どのテストを通すか)を書く。

## testing-policy.md
- ユニットテストと E2E の役割分担を書く。
- テストファイルの配置規約と命名規約を書く。
- 新規テストをどこへ足すかが、読んだだけで決まる粒度にする。
