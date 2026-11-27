# metatron の ARCHITECTURE を 8 見出しの新構成に変え、CLAUDE.md との境界を references に定義する

Issue: #50(親 Story #49)

## ARCHITECTURE は同じ決まりを 1 か所にだけ書く構成になる

今の構成では、同じ決まりが複数の見出しに分かれる。バンドル出力を手で編集しない決まりは「レイヤー構造」「ドメインマップ」「保護パス」の 3 か所にあり、ディレクトリの役割は「レイヤー構造」の表と「ディレクトリ構成と責務」のツリーが二重に説明している。

新しい構成では、見出しを次の 8 つに固定する。並びは Story #49 の決定に従い、`ドメインマップ` は 5 番目から 4 番目へ移る。

| # | 見出し | 持つ内容 |
| --- | --- | --- |
| 1 | `## システム概要` | 変更なし |
| 2 | `## 技術スタック` | 変更なし |
| 3 | `## ディレクトリ構成` | ツリーと各ディレクトリの責務、レイヤーと許される依存方向 |
| 4 | `## ドメインマップ` | 変更なし(`metatron:domains` のブロック) |
| 5 | `## コマンド定義` | 変更なし |
| 6 | `## テスト方針` | 変更なし |
| 7 | `## 禁止事項` | 禁止する依存方向・触らないパス・読まないパスなど、禁止のすべて |
| 8 | `## 変更時の追随` | パスを変更したときに確かめること・同時に直すもの |

ドメインマップの見出しとブロックの形は変えない。codiel は `json metatron:domains` のフェンスだけを読み、見出しを読まない(`plugins/codiel/src/hooks/lib.ts:432-440`)。

## 3 つの見出しの書式

`references/architecture-format.md` の規定を次のように書き換える。

### ディレクトリ構成

- 主要ディレクトリをツリーで示し、各行に責務を 1 行で書く。置き場を迷うディレクトリに絞り、全ディレクトリを網羅しない。
- レイヤーがディレクトリに対応するときは、ツリーの行の責務の前に `[レイヤー名]` を付ける。レイヤーが 1 つしか無いプロジェクトは付けない。
- レイヤーがディレクトリに対応しないとき(ファイル名の接尾辞で層を分けるなど)は、ツリーの下にレイヤーの表を置き、上から下へ各レイヤーの責務を 1 行で書く。
- 許される依存方向をツリーの下に箇条書きで書く。禁止する方向は「禁止事項」に書く。
- ツリーのパスを `## ドメインマップ` の glob と矛盾させない。

### 禁止事項

- 禁止を 1 項目 1 つで書き、代わりに取る手段を同じ項目に併記する。例: 「バンドル出力を手で編集しない。`src/` を変更し、ビルドで再生成する」。
- 触らないパスには、変更が必要になったときに取る手順(誰に確認するか)を併記する。
- 禁止する依存方向・触らないパス・読まないパスを含め、禁止は他の見出しに書かない。

### 変更時の追随

- パスまたは glob ごとに、変更したときに確かめること(通すテスト・確かめる条件)と、同時に直すものを書く。
- そのパスが何であるかは「ディレクトリ構成」に載っていれば書かない。載っていないパス(ツリーから外した設定ファイルなど)は、何であるかを語句 1 つで添えてよい。
- 禁止とその代わりの手段は「禁止事項」に書き、ここで繰り返さない。

## ARCHITECTURE と CLAUDE.md の境界は「成果物の決まりか、作業の進め方か」で分ける

`references/document-boundary.md` に次の定義を置く。

- ARCHITECTURE には、成果物の決まりを書く。成果物の構成(何がどこにあり、どの技術で作られているか)、成果物同士の関係(依存方向、何を変えたら何を揃えるか)、成果物を守る禁止が該当する。誰が作業しても同じに当たる。
- CLAUDE.md には、作業の進め方を書く。ツールの選び方、Issue とブランチの運用、作業の順序、完了の判定、コーディング規約が該当する。
- 1 つの内容が両方に読めるときは、文の主語で決める。主語が成果物(「`plugin.json` のバージョンは〜」)なら ARCHITECTURE、作業(「完了の前に〜を実行する」)なら CLAUDE.md とする。
- 同じ内容を両方に書かない。

判定の例:

| 内容 | 置き場 | 理由 |
| --- | --- | --- |
| `tools/` には Python、`scripts/` には ShellScript を置く | ARCHITECTURE「ディレクトリ構成」 | 置き場ごとの成果物の決まり |
| プラグインを改修したら `plugin.json` のパッチバージョンを上げる | ARCHITECTURE「変更時の追随」 | 成果物を変えたときに揃える成果物 |
| TypeScript は strict を有効にする | ARCHITECTURE「技術スタック」 | 成果物の構成 |
| コードベースの探索は Serena のシンボルツールで行う | CLAUDE.md | ツールの選び方 |
| `pnpm run lint` と `pnpm run test` が通ってから完了とする | CLAUDE.md | 完了の判定 |
| Issue に Project のフィールドを設定する | CLAUDE.md | Issue の運用 |

- `capturing-architecture` と `updating-architecture`(監査を含む)は起草の前にこの文書を読み、CLAUDE.md に当たる内容を ARCHITECTURE に書かない。
- 今の書式契約の「コーディング規約・ブランチ運用・DoD は CLAUDE.md に書く」は、この定義へ移し、`architecture-format.md` からは参照だけにする。
- #53 の置き場の判定表は、この文書に追加する。判定表の「ARCHITECTURE」と「CLAUDE.md」の行は、この定義を参照する。
- このリポジトリの CLAUDE.md への当てはめ(「スクリプトツール」と「プラグインのバージョン」を ARCHITECTURE へ移す)は #54 で行う。

## 旧構成の文書と旧 rules は 1 件の「旧構成の移行」で移す

### 読み取りと書き込みの動作

- 読み取りの経路(`get architecture`・`get domains`・`scan`・SessionStart・CLAUDE.md の @メンション)は旧見出しをそのまま扱い、拒否も警告もしない。
- `diff-architecture` は、旧見出しが残っていれば見出しごとに `legacy_section` の所見を返す。`detail` に移し先を載せる。
- 旧見出しを `body` 付きで stage すると、今までどおり `unknown_heading` で拒否する。メッセージに移し先を添える。旧見出しの `{ remove: true }` は通る。
- 旧見出しと新しい見出しが両方あるときは、新しい見出しを正とする。`diffDirectories` は `ディレクトリ構成` があればそれを、無く `ディレクトリ構成と責務` があればそれを突き合わせる。

| 旧見出し | 移し先 |
| --- | --- |
| `レイヤー構造` | レイヤーと許される依存方向は「ディレクトリ構成」、禁止する依存方向は「禁止事項」 |
| `ディレクトリ構成と責務` | 「ディレクトリ構成」 |
| `保護パス` | 触らないパスは「禁止事項」、変更に慎重を要するパスは「変更時の追随」 |
| `ADR 一覧` | 移し先なし。本文の退避を確かめてから削除する(現行どおり) |

### `updating-architecture` の手順

- 手順 3 で、次のどちらかがあれば「旧構成の移行」を 1 件の候補にする。旧 ADR 一覧は今までどおり別の候補にする。
  - `ADR 一覧` 以外の `legacy_section`
  - 旧 rules(`conventions.md`・`protected-paths.md`・`testing-policy.md`)
- 「旧構成の移行」の候補には、新しい見出し(`ディレクトリ構成`・`禁止事項`・`変更時の追随`・`テスト方針`)の `section_missing` をまとめ、別の候補にしない。移す元が無い見出し(0.6.0 より前の文書で `保護パス` も旧 rules も無いなど)の欠落は、通常の欠落の候補として残す。
- 候補の提示では、移行しないと旧見出しのセクションを直せず、削除しかできないことを添える。
- 移行が選ばれたら、次の材料から新しい見出しの草案を起こし、手順 5〜7 の起草・簡潔化・提示を通す。旧 rules の本文も起草に回す。
  - 旧見出しの本文
  - 旧 rules の `protected-paths.md`(触らないパスと慎重を要するパスに分けて「禁止事項」と「変更時の追随」へ)
  - 旧 rules の `testing-policy.md`(「テスト方針」へ。ARCHITECTURE に同じ見出しがあれば、両方を並べてユーザーに決めてもらう)
- 起草で同じ決まりを 2 か所に見つけたら、上の「3 つの見出しの書式」で持ち主の見出しに寄せる。禁止とその代わりの手段は「禁止事項」に寄せる。
- 新しい見出しの `body` と旧見出しの `{ remove: true }` を 1 回の stage に入れる。
- 旧 rules の `conventions.md` を CLAUDE.md へ移す段階、@メンションの追記、旧 rules の削除は、今の手順 11 の b〜d をそのまま使う。
- 移行が終わった状態は、`legacy_section`(`ADR 一覧` を除く)が 0 件で、旧 rules の 3 ファイルが無いこととする。

### 監査と初回生成

- 監査の手順で、ARCHITECTURE に書式の表に無い見出しがあれば候補にする。旧見出しなら「旧構成の移行」へ回す。監査だけの依頼でも、旧見出しの有無は `get architecture` の本文から分かる。
- `capturing-architecture` は、既存の ARCHITECTURE に旧見出しのどれかがあれば初回生成をせず、`/metatron:update` を案内して終える。ドメインマップだけの最小構成は今までどおり初回生成で育てる。
- `capturing-architecture` が旧 rules を材料にする箇所は、`protected-paths.md` を「禁止事項」と「変更時の追随」の材料にするよう改める。

## 実装の変更

`src/lib/architecture.ts`

- `ARCHITECTURE_HEADINGS` を新しい 8 つに差し替える。
- `unknown_heading` のメッセージで、値が旧見出しなら移し先を添える。旧見出しと移し先の対応は `LEGACY_HEADINGS` として持つ。

`src/lib/scan.ts`

- `ARCHITECTURE_SECTIONS` を新しい 8 つに差し替える(独立複製の規約は維持する)。
- `LEGACY_ADR_HEADING` を、旧見出しと移し先の対応を持つ `LEGACY_SECTIONS` に広げる。`ADR 一覧` も含め、所見の `detail` は見出しごとに作る。
- `diffDirectories` の対象を上の「読み取りと書き込みの動作」のとおりに変える。
- `保護パスの不整合` の `skipped` を消す。Raguel の設定との突き合わせは、codiel の `initializing-harness` が「保護パスの正本は `.codiel/config.json` の `raguel` である」と定めており、metatron は今も行っていない。

テスト

- 旧見出しを直接書いた既存のテストを新しい見出しへ直す(`architecture.test.ts`・`scan.test.ts`・`cli.test.ts` の S11 など)。
- 加えるテスト: 旧構成の文書で `legacy_section` が見出しごとに移し先付きで返る。旧見出しの `body` 付き stage が移し先付きの `unknown_heading` を返る。新しい見出しの追加と旧見出しの削除を 1 回で stage すると、8 見出しが正しい順に並び、区切りの空行が崩れない。旧見出しと新しい見出しが両方あるとき `diffDirectories` が新しい方を読む。
- `src/__test__/section-reference-inventory.test.ts` は `ARCHITECTURE_HEADINGS` から検出語を作るので追随は不要である。新しい見出し名を他プラグインの指示書でセクションとして読む箇所は無い(調査済み)。

## 指示書と文書の変更

| ファイル | 変更 |
| --- | --- |
| `references/architecture-format.md` | 表と各セクションの規定を新構成に差し替える。境界は `document-boundary.md` を参照する |
| `references/document-boundary.md` | 新規。境界の定義と判定の例 |
| `references/writing-discipline.md` | 図の基準と適用の強さの表の見出し名 |
| `references/cli-usage.md` | `stage-architecture` の例の見出し名と、`diff-architecture` の `legacy_section` の説明 |
| `skills/updating-architecture/SKILL.md` | 旧構成の移行、監査での旧見出しの扱い、境界の参照、`保護パス` の語の置き換え、description |
| `skills/capturing-architecture/SKILL.md` | 8 単位の表、旧見出しがあるときの案内、旧 rules の材料の行き先、境界の参照、description |
| `commands/update.md` | 旧構成の文書の移行に触れる |
| `docs/ARCHITECTURE.example.md` | 新構成の記入例。レイヤーをツリーに付ける例と、禁止に代わりの手段を併記する例を含める |
| `docs/format-change-checklist.md` | 旧見出しの対応表(`LEGACY_HEADINGS`・`LEGACY_SECTIONS`)と `document-boundary.md` の項目を追加し、既存文書の追随の経路を「`/metatron:update` の旧構成の移行」に直す |
| `docs/rationale.md` | 構成を変えた理由のセクションを追加する |
| `evals/*.json` | `保護パス`・`レイヤー構造` を前提にした問を新しい見出しへ直し、旧構成の移行で発火する問を追加する |
| `README.md`(metatron) | セクション構成と旧構成の移行。108 行の「`/codiel:init` が最小の ARCHITECTURE を生成する」は codiel の実態に合わせて直す |
| `README.md`(ルート) | 93 行の「保護パスとテスト方針を含む」 |
| `harness-docs/design/2026-08-16-file-contract-freeze.md` §4 | 4-1 の表と 4-4 の `レイヤー構造` の要件。チェックリストが追随先に定めている |
| `plugins/codiel/README.md` | 26 行の「レイヤー構造」の例示 |

- SKILL.md・commands・references の本文は、編集の前に `prompt-smith:prompt-smith` を起動する。description は `prompt-smith:skill-creator` で直す。
- `plugins/codiel/docs/DESIGN.md` の旧 8 項目は「現行の節構成は契約 §4-1 が正本」と明記された記録なので直さない。`plugins/prompt-smith/docs/` の測定記録も直さない。
- Serena のメモリ(`.serena/memories/metatron/core.md`・`file_contract.md`)は、worktree から書くと main 側に入るため、マージの後に main で更新する。

## #50 から #54 までの間の扱い

- #50 のマージから #54 のマージまで、このリポジトリの ARCHITECTURE は旧構成のままになる。その間は旧見出しへの `body` 付き stage が拒否されるので、#51〜#53 の作業で ARCHITECTURE を直す必要が出たら #54 へ回す。
- `references/document-boundary.md` を ARCHITECTURE の「変更時の追随」へ記録するのは #54 で行う。

## 範囲外

- このリポジトリの `harness-docs/ARCHITECTURE.md` と CLAUDE.md の移行は #54 で行う。
- 削れる内容の洗い出しと行数の目安は #51、検査の定義は #52、置き場の判定表は #53 で行う。
- SessionStart の案内に旧見出しの移行を加えることはしない。監査と更新が旧見出しを検出する。

## 決定事項

| 項目 | 決定 |
| --- | --- |
| 8 番目の見出し名 | `変更時の追随`。持つ内容を名前で表す |
| 境界の判定 | 成果物の決まりか作業の進め方か。両方に読めるときは文の主語で決める |
| 旧見出しを持つ文書 | 読み取りは今までどおり。`legacy_section` で検出し、「旧構成の移行」の 1 件の候補で移す |
| 旧 rules | 旧見出しと同じ「旧構成の移行」に入れ、`protected-paths.md` と `testing-policy.md` も起草に回す |
| バージョン | `0.6.3-dev` → `0.6.4-dev`。origin/main と origin/dev の `plugin.json` がどちらも `0.6.3-dev` で、dev に未反映のバージョンアップは無い |

## 完了の条件

- `pnpm run lint`・`pnpm run typecheck`・`pnpm run test`・`pnpm run build` が通り、`plugins/metatron/scripts/` の差分が `src/` の変更と同じコミットにある。
- 「実装の変更」のテストに挙げた 4 つのテストがある。
- `plugin.json` と `package.json` が `0.6.4-dev` で揃っている。
