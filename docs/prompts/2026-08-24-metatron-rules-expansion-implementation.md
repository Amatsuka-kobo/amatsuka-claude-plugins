# metatron rules 拡大: 実装セッションの起動プロンプト

対象の設計書: `harness-docs/design/2026-08-24-metatron-rules-expansion-design.md`(2026-08-24 にユーザー承認済み)

## 使い方

実装は 3 区間に分ける。`/goal` を使うのは区間 2 だけである。

| 区間 | 内容 | 起動 |
| --- | --- | --- |
| 1 | 実装計画書(WBS)の作成と承認 | 通常のプロンプト。§区間1 を貼る |
| 2 | 設計書 §16 のステップ 1〜11 の実装 | `/goal` + §区間2 を貼る |
| 3 | このリポジトリの移行(ステップ 12〜14) | 通常のプロンプト。§区間3 を貼る |

区間 1 と 3 に `/goal` を使わない。`/goal` は各 turn の後に条件の充足を評価し、未充足なら次の turn を自動で開始する。この 2 区間には人間の承認ゲートがあり、質問で終わった turn の後に自動継続が起きると、承認を待たずに先へ進む。

区間 2 に承認ゲートは無い。metatron の正本へ書き込まないためである(書式契約と参照文書は `references/` 配下で、hook の対象外)。

いずれの区間でも、着手前に §運用指示 を読む。

---

## 区間 1

```
harness-docs/design/2026-08-24-metatron-rules-expansion-design.md を全文読み、docs/prompts/2026-08-24-metatron-rules-expansion-implementation.md の「運用指示」節を読んだうえで、実装計画書(WBS)を harness-docs/plans/ に書いてください。

設計書 §16 の 14 ステップを分解し、各ステップに次を定めます。

- 変更するファイル
- 完了条件(通すテスト、既存挙動をどう保証するか)
- 先行するステップ

設計書 §16 の依存関係を崩さないこと。特にステップ 10(codiel から節名参照を削除)をステップ 12(このリポジトリの移行)より前に置くこと。

書き上げたら全文を提示してください。承認するまで実装に入らないでください。
```

## 区間 2

`/goal` に次を渡す。1,145 文字(上限 4,000)。

```
承認済みの実装計画書(harness-docs/plans/ の最新)と設計書 harness-docs/design/2026-08-24-metatron-rules-expansion-design.md に従い、設計書 §16 のステップ 1 から 11 までを実装する。ステップ 12 以降には進まない。着手前に docs/prompts/2026-08-24-metatron-rules-expansion-implementation.md の「運用指示」節を読む。

次のすべてが満たされたら完了とする。

1. `pnpm run lint` と `pnpm run typecheck` と `pnpm run test` がいずれも exit 0 で終わる。
2. `pnpm run build` の実行後、`git status --porcelain plugins/` の出力に未コミットの差分が無い。
3. `node plugins/metatron/scripts/metatron.mjs get config` の出力に rulesDir の解決結果が含まれる。
4. `stage-rules` `commit-rules` `get rules` の 3 サブコマンドが動作し、`stage-architecture` が remove 指定を受け付ける。いずれもテストで検証されている。
5. plugins/*/skills/ と agents/ と commands/ に ARCHITECTURE の節名を名指しする記述が残っておらず、設計書 §14-4 の節名参照インベントリのテストが通る。
6. plugins/metatron/.claude-plugin/plugin.json と plugins/metatron/package.json の version が一致し、着手前よりマイナーが上がっている。
7. 作業ツリーに一時スクリプトと hook の無効化が残っていない。

途中で次を変えない。

- metatron の PreToolUse hook を無効化しない。迂回スクリプトを作らない。
- harness-docs/ARCHITECTURE.md と harness-docs/GOTCHAS.md と .claude/rules/ を変更しない。この区間の対象外である。
- 設計書の設計判断を蒸し返さない。設計書に無い判断が要るときは作業を止めて質問する。
- ブランチを切らない。git push に --force 系を付けない。

30 turn を超えたら停止し、残っている作業を報告する。
```

## 区間 3

```
設計書 harness-docs/design/2026-08-24-metatron-rules-expansion-design.md の §16 ステップ 12 から 14 を実施してください。docs/prompts/2026-08-24-metatron-rules-expansion-implementation.md の「運用指示」節に従います。

ステップ 12 の移行は設計書 §8 の 4 段階です。rules 3 ファイルを先に書き、ARCHITECTURE から後で消します。各段階で stage の diff を全文提示し、承認を得てから commit してください。承認前に commit しないでください。

移行の完了後、設計書 §12-3 の実測を行い、結果を報告してください。縮退は §12-2 のとおり崖であり、警告も出ません。
```

---

## 運用指示

区間 1・2・3 のいずれでも従う。

### metatron の hook を迂回しない

正本(`harness-docs/ARCHITECTURE.md`・`harness-docs/GOTCHAS.md`・`.claude/rules/metatron/*.md`)への Edit / Write は PreToolUse hook が拒否する。迂回スクリプトを作らない。hook を一時的にも無効化しない。

`rm` はシェル経由で通るが、使わない。

迂回の誘惑が出る場面ごとの対処は設計書 §16-1 にある。

### 正本への書き込みは CLI 経由で行う

```
node plugins/metatron/scripts/metatron.mjs <サブコマンド> [オプション]
```

`stage-*` で diff を得て、全文をユーザーへ提示して承認を得てから `commit-*` を実行する。`stage-*` が exit 0 で返ったことを承認と読み替えない。

長い入力は一時ファイルへ書き、`--input <path>` で渡す。引数へ本文を直接埋めない。

### サブエージェントへ規律を転記する

この実装が完了するまで、`## 規約` と `## 保護パス` はサブエージェントに届かない。SessionStart hook の注入がサブエージェントへ渡らないためである。この非対称の解消が本実装の目的であり、実装中はまだ解消されていない。

サブエージェントへ委譲するときは、次を依頼文へ書く。

- `plugins/*/scripts/` と `plugins/*/dist/` はバンドル出力である。手で編集せず、`src/` を変更して `pnpm run build` で再生成する。
- `harness-docs/ARCHITECTURE.md` と `harness-docs/GOTCHAS.md` と `.claude/rules/` を直接編集しない。
- ブランチを切らない。切る必要があると判断したときは git worktree を使う。
- `git push` に `--force` 系のオプションを付けない。
- コードベースの探索は Serena のシンボルツールで行う。0 件でも結論にせず Grep で裏を取る。
- ライブラリ・CLI・API の仕様は Context7 で取る。Web 検索より優先する。

### コミットを分ける

設計書が分けると定めている箇所を守る。

- codiel の「節名参照の削除」と「フォールバックの新設」を分ける。
- 移行(本文の機械的な移設)と推敲(設計書 §13-3 の判定)を分ける。

### 迷ったら止まる

設計書に無い判断が要るときは、自分で決めずに質問する。設計書の記述と実装が食い違うときは、実装を設計書へ合わせる。

metatron はまだ利用者を持たない。破壊的変更を許す。後方互換のための経路を足さない。
