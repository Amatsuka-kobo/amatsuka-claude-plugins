# agent-policy 役割ベース setup 残課題 実装計画書

作成日: 2026-08-24
対象ブランチ: `agent-policy-change`(worktree)
親設計書: `harness-docs/design/2026-08-24-agent-policy-role-based-setup-design.md`
引き継ぎ書: `harness-docs/2026-08-24-agent-policy-role-based-setup-handover.md`
context-map: `.claude/context-maps/2026-08-24-agent-policy-role-based-setup-followup.md`

## 0. 前提と方針

引き継ぎ書 §4 の残課題(Important 4 件 + Minor 13 件)を解消してから `main` へマージする。

3 つの Important(I4 / I6 / I8)は**設計側の欠陥**である。実装だけ直すと設計書が実装と食い違うため、設計書の該当節を同じコミットで訂正する。

引き継ぎ書 §4.4 の構造提案のうち、`--list-roles` を配る案(提案 3)だけを採る。残る 3 件(`roles.generated.ts` 化・担当表突き合わせテスト・フックからの移行周知)は次の改修へ送る。

### 0.1 I4 の前提の検証結果

公式ドキュメント(`code.claude.com/docs/en/skills` の Frontmatter reference / "Pre-approve tools for a skill" / "Skill content lifecycle"、2026-08-24 取得)を確認した。引き継ぎ書の主張は正しい。ただし独立レビューが、対になる制約の**寿命**を見落としていることを指摘した。

| フィールド | 原文 | 意味 |
| --- | --- | --- |
| `allowed-tools` | "Tools Claude can use without asking permission during the turn that invokes this skill." / "It does not restrict which tools are available: every tool remains callable" | **事前承認**。列挙しないことは禁止を意味しない |
| `disallowed-tools` | "Tools removed from Claude's available pool while this skill is active." / **"The restriction clears when you send your next message."** | **除去**。ただし**起動ターン限り** |

あわせて "This persistence applies to the skill's instructions, **not its permissions**" とある。本文はセッションに残るが、権限の付与も除去も次のユーザーメッセージで切れる。

**この改修が採る立場。** `disallowed-tools: Write, Edit` は起動ターンの保護として入れるが、**ウィザード全行程の強制とは呼ばない**。恒久的な担保は次の 2 つに置く。

1. 書き込みを行えるのは `setup-agents.mjs` だけであるという構造(設計 §10.2)
2. SKILL.md 本文の standing instruction —「`.claude/agents/` を `Write` / `Edit` で直接編集せず、必ずこのスクリプトで書く」

設計書 §10.3 にはこの 3 層(事前承認・起動ターンの除去・本文の恒久指示)を書き分ける。「`allowed-tools` に書かないから禁止される」という現在の誤りだけでなく、「`disallowed-tools` を書いたから全行程で禁止される」という別の誤りも作らない。

補足として、`disallowed-tools` は claude.ai へのアップロードと Skills API のパッケージ仕様が許す 6 フィールドに含まれない。本プラグインは Claude Code 用スキルなので影響しないが、将来アップロード経路へ載せるとハードエラーになる。公式ページに最小バージョンの記載は無い。いずれも設計書 §14 のリスクへ記録する。

## 1. 作業単位

依存関係は次のとおり。W1 → W2 → W3 の順に進め、W4 は W1〜W3 と独立、W5 は全ての後。

| ID | 内容 | 依存 |
| --- | --- | --- |
| W1 | 設計書の訂正 | なし |
| W2 | CLI の拡張(`--list-roles` / `--check` の `roles` / `--merge`)と `roles.ts` / `fragments.ts` の整理 | W1 |
| W3 | SKILL.md 2 本の改訂 | W2 |
| W4 | フック(I6・M7・M13)、`build-presets`(M12)、断片(M3)、README(M11・M14・M15) | W1 |
| W5 | テスト追加・ビルド・検証・バージョン・コミット・マージ | W2〜W4 |

---

## W1. 設計書の訂正

対象: `harness-docs/design/2026-08-24-agent-policy-role-based-setup-design.md`

| 節 | 訂正内容 |
| --- | --- |
| §5.3 | 警告の判定根拠を明記する。読み取り/実装の分類は SKILL.md に手書きせず、`--list-roles` が返す `kind` と `--check` が返す `roles.mixedKinds` に基づく |
| §6.3 | `color` の決まり方を改める。同梱プリセットは `presets.ts` の `color` を優先し、指定が無ければベンダー既定を使う(W4.5) |
| §8.1 | プリセット表に `color` 列を足す |
| §8.2 | 同梱プリセットの生成時に、`PRESETS` に無い `agents/*.md` を削除する旨を追記する |
| §9.2-3 | 促しの条件を書き換える。「対応する定義が `.claude/agents/` に無い」→「そのエイリアスを `model` に持つ定義群の**役割の和集合が、プリセットの `roleIds` を覆わない**」。目的 4(名前非依存)と整合させる |
| §9.2-4 | 旧定義の残骸通知に、Grok 4.6 のエイリアス変更の 1 行を条件付きで足す(§2.1) |
| §10.1 | `--yes` の挙動を「確認を挟まず既定プリセットを既定エイリアスで生成する」→「保持マージで書き、破棄した内容を報告する」に改める |
| §10.2 | `--check` の戻り値に `roles` ブロックを追加する。`--merge` を追加し、「保持マージ(推奨)」と `--yes` の両方がこのフラグへ寄ることを書く |
| §10.3 | `allowed-tools` の意味の取り違えを訂正する。§0.1 の 3 層(事前承認 / 起動ターン限りの除去 / 本文の恒久指示)を書き分け、「`disallowed-tools` を書けば全行程で禁止される」という別の誤りも作らない |
| §10.4(新設) | `--list-roles` の仕様を定義する |
| §14 | 3 件を追記する。(1) `disallowed-tools` がアップロード/Skills API のパッケージ仕様に含まれない (2) `--merge` は保持対象の提供者を区別できず、`keptNeedsReview` は可視化に留まる (3) `sortRoleIds` の変更でプロジェクト固有役割の利用者に 1 度だけ並び差分が出る |
| §15 | `0.8.0-dev` → `0.9.0-dev`。機能追加(`--list-roles` / `--merge`)を含むためマイナーを上げる |

---

## W2. CLI の拡張

### W2.1 `fragments.ts`

- `Fragment` に `source: "plugin" | "project"` を足す。`loadFragments(dirs, vendor)` は `dirs` の先頭を `"plugin"`、それ以外を `"project"` として付ける。この対応をコメントで明示する。
- 2 パス目(ベンダー別断片)のソートを 1 パス目と同じ `localeCompare` に揃える(M4)。
- helper `require` を `requireMeta` へ改名する(M5)。

### W2.2 `roles.ts`

- `roleOrder(id: string): number` を追加する。`ROLES` に無い ID は `ROLES.length` を返し、末尾へ並ぶようにする。
- `sortRoleIds` を `roleOrder` で実装し直す。現行の `order.get(left) ?? 0` は未知 ID を先頭へ寄せるため、プロジェクト固有役割の並びが担当表と逆になっていた。
- `sortRoleIds` のシグネチャを `<T extends string>(ids: T[]) => T[]` へ広げる。`describeRoles` と `--list-roles` はプロジェクト固有役割の `string` を扱うため、`RoleId[]` のままだと型と実行時がねじれる。`--roles` は現行も `as RoleId[]` で通しており、実行時には未知 ID が入り得る。
- `hasMixedKinds` のシグネチャを `(kinds: RoleKind[]) => boolean` に変える。現行は `roleById` に依存するためプロジェクト固有役割の `kind` を解決できず、呼び出し元も無かった(I5)。

**確認事項**: `sortRoleIds` の変更で `agents/*.md` の再生成差分が出ないこと。`presets.ts` の `roleIds` は 4 プリセットとも既に `ROLES` 順であり、変更が動かすのは未知 ID の位置だけなので構造的に差分は出ない。`pnpm build` 後に `git status --porcelain plugins/` で最終確認する。

**受容する代償**(独立レビューの反証 D): プロジェクト固有役割 ID を含む定義を持つ利用者は、再 setup 時に「マーカー CSV の並び」「本文節の連結順」「カスタム断片由来の tools 順」が変わり、1 度だけ `identical: false` になる。中身は同じで並びだけが変わる差分である。壊れはせず、保持マージで通過できる。担当表と並びを揃える利得のほうが大きいと判断し、今払う。設計書 §14 のリスクへ記録する。

### W2.3 `compose.ts`

`describeRoles(input: ComposeInput): RolesSummary` を追加して export する。

```ts
export interface RolesSummary {
  ids: string[]          // sortRoleIds 済み
  implRoles: string[]
  readonlyRoles: string[]
  mixedKinds: boolean
  agentTool: boolean
}
```

- `kind` は断片の frontmatter から採る。プロジェクト固有役割も正しく分類される。
- `mixedKinds` は `hasMixedKinds(kinds)` を呼ぶ。これが I5 の死にコードの呼び出し元になる。
- `agentTool` は `allowsAgentTool(input.roleIds)`。組み込みの `AGENT_CAPABLE` に基づく現行仕様を変えない。

### W2.4 `setup-agents.ts`

#### `--list-roles`

`--name` / `--model` / `--roles` を要求しない新しいモードとする。`--dir` と `--vendor` は受け付ける。

```json
{
  "ok": true,
  "roles": [
    { "id": "complex-impl", "label": "複雑または重要な実装", "kind": "impl",
      "tools": ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill", "LSP"], "source": "plugin" }
  ]
}
```

並びは `roleOrder` 順、同順のものは `id` の `localeCompare` 順。プロジェクト固有役割は末尾に並ぶ。組み込みと同じ `id` の断片で置き換えたときは `source` が `project` になる。

#### `--check` の戻り値に `roles` を追加

既存フィールドは削除も改名もしない。`describeRoles` の結果をそのまま `roles` として載せる。

#### `--merge`

`--write` と併用する。既存ファイルがあるとき、**テンプレートに存在し得ない情報**(`toolsOnlyInExisting` / `keysOnlyInExisting` / `sectionsOnlyInExisting`)を自動で `--keep` 相当として保持する。明示的な `--keep` はこれに追加される。

戻り値を次の形へ拡張する。

```json
{
  "ok": true,
  "target": ".claude/agents/gpt-sol.md",
  "action": "merged",
  "kept": ["tools:mcp__context7", "key:permissionMode", "section:## ツール運用"],
  "keptNeedsReview": ["tools:mcp__context7", "section:## ツール運用"],
  "discarded": { "frontmatterKeys": ["description"], "preamble": true, "sections": ["## 制約"] }
}
```

- `action`: 新規作成は `written`、`--merge` ありで既存は `merged`、`--merge` なしで既存は `overwritten`。
- `discarded` は `--merge` の有無にかかわらず算出する。`changed` のうち `--keep key:` されなかったキー、`preambleChanged` かつ `--keep preamble` されなかった場合、`sectionsChanged` のうち `--keep section:` されなかった見出し。
- 新規作成時の `discarded` と `keptNeedsReview` は全て空。

**実装上の要点**(Haiku レビューの指摘 2): `write()` は既存ファイルを **1 回だけ**読み、その内容から自動 keep セレクタの抽出と `merge()` の両方を行う。同一内容から導いたセレクタは必ず存在するため、`merge()` の「keep: not found in existing file」検証と衝突しない。明示 `--keep` は従来どおり検証にかかる。

#### `keptNeedsReview`(独立レビューの反証 B への対応)

`--merge` は提供者を区別できない。利用者が意図して足した `mcp__context7` と、0.7.x の同梱定義から残った `mcp__context7` は、差分上まったく同じ形で現れる。自動保持だけを入れると、本改修が外した MCP ツールと `## ツール運用` 節が推奨経路(保持マージ・`--yes`)で永久に残り続ける。

**自動除外はしない。** README 移行手順 3 が「必要なら自分で追加してよい。再 setup で保持される」と案内している以上、`mcp__*` を機械的に捨てると利用者の意図的な追加を黙って壊す。反対方向の事故になる。

代わりに、保持したセレクタのうち**プラグインが過去に同梱していて今は外したもの**に一致するものを `keptNeedsReview` として別に返す。判定は接頭辞 `mcp__` の tools と、見出し `## ツール運用` の 2 つに限る。SKILL.md はこれを空でない限り必ず列挙し、「旧版の同梱定義に含まれていた項目である。意図して足したものでなければ削除を検討する」と添えて報告する。

判断は利用者に残し、見えない状態だけを消す。

#### 堅牢化

| 項目 | 内容 |
| --- | --- |
| M8 | `parseDocument` が `lines[0].trim() === "---"` を検証する。frontmatter が無い、または閉じていないファイルは全体を本文として扱い、`meta` を空にする |
| M9 | `--name` を `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` で検証する。不一致は `name: must be lowercase letters, digits and hyphens` で終了コード 1。`.claude/agents/` の外へ書けなくなる |
| M10 | `--roles` を `[...new Set(...)]` で重複除去する |

M6(`keep.preamble` の非対称)は**変更しない**。空の preamble を保持するとテンプレートの冒頭宣言が消えるため、現行挙動が正しい。設計書にも記載しない。

---

## W3. SKILL.md の改訂

対象: `plugins/agent-policy/skills/setup-gpt/SKILL.md` / `setup-grok/SKILL.md`

**この作業は `prompt-smith:prompt-smith` スキルをロードして行う。** 引き継ぎ書 §7 の判断表にあるとおり、I4 は `skill-creator` を飛ばした代償である。

### W3.1 frontmatter

```yaml
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *), AskUserQuestion
disallowed-tools: Write, Edit
```

`description` は変更しない。

### W3.1b 恒久指示の追加

`disallowed-tools` は起動ターンでしか効かない(§0.1)。ウィザードは `AskUserQuestion` を複数回挟むため、これだけでは全行程を守れない。本文冒頭の一文の直後に standing instruction を置く。

> `.claude/agents/` のファイルは `Write` / `Edit` で直接編集せず、必ず下記のスクリプトで書き込む。差分の確認も生成も、このスクリプトが行う。

本文はセッションに残る("This persistence applies to the skill's instructions, not its permissions")ため、権限が切れた後もこの指示は効き続ける。

### W3.2 ステップ 2(役割の選択)

役割 10 件のベタ書きを削除し、次に置き換える。

````markdown
次を実行して、選べる役割の一覧を得る。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-roles
```

返った `roles` を配列順のまま `AskUserQuestion` の複数選択の選択肢にする。各選択肢のラベルは `id`、説明は `label` とする。`source` が `project` のものには、プロジェクト固有の役割である旨を添える。
````

「選択数の上限は設けない。1 回のウィザードで作るのは 1 定義である」以降は残す。

### W3.3 ステップ 3(読み取り専用性の確認)

役割 ID の手書きの振り分けを削除し、ステップ 2 で得た `kind` を判定根拠にする。

> ステップ 2 で得た `kind` を見る。選ばれた役割に `readonly` と `impl` の両方が含まれるときは、次を伝えて続行するか確認する。既定は「続行しない」とする。

警告文は現行のまま残す。

### W3.4 ステップ 6(既存確認と差分提示)

差分の分類の説明はそのまま残し、末尾に次を足す。

> `--check` の `roles.mixedKinds` が `true` で、ステップ 3 の確認を経ていないときは、書き込む前にステップ 3 へ戻る。

選択肢 4 つの文言は変えない。

### W3.5 ステップ 7(生成)

`--keep` の組み立てを次へ置き換える。

| 選択 | コマンド |
| --- | --- |
| 保持マージ(推奨) | `--write --merge` |
| 項目を選んで保持 | `--write --merge` に、残す項目ごとの `--keep key:<name>` / `--keep section:<heading>` / `--keep preamble` を足す |
| 完全上書き | `--write` |
| スキップ | 実行しない |

「既存にしかない tools / キー / 節」を `--keep` へ手で変換する記述は削除する。`--merge` が自動で行う。

実行後は `action` と `kept` を報告し、`discarded` が空でなければ「テンプレート側で上書きした項目」として必ず列挙する。

### W3.6 非対話モード

`--write` を `--write --merge` に変える。報告文を次にする。

> `ok: true` のときは `target` と `action` を報告する。`discarded` が空でなければ、上書きした項目を列挙して報告する。`ok: false` のときは `error` をそのまま報告して終了する。

---

## W4. フック・ビルド・断片・README

### W4.1 `session-start.ts`

**I6(充足判定を名前非依存にする)**

`setupBlock` の判定を次に変える。代表役割の表は新設せず、`PRESETS` の `roleIds` から導く。

充足条件は「役割が 1 つでも交差すること」**ではなく**「そのエイリアスを `model` に持つ定義群の役割の**和集合が、プリセットの `roleIds` を覆う**こと」とする。1 つのエイリアスを複数定義に分けて担わせる構成(`my-explorer` + `my-coder` が両方 `model: my-terra`)を許しつつ、カバー不足を見逃さない。

```ts
const preset = PRESETS.find((entry) => entry.name === spec.preset)
const named = byName.get(spec.preset)

// 名前一致の定義が正しい model を持てば従来どおり充足。
if (named?.model === alias) continue

// PRESETS と ALIASES がずれた場合は、名前一致だけの旧判定へ落とす。
if (preset === undefined) {
  if (named === undefined) lines.push(`- ${spec.preset}: 定義が無い。${spec.skill} を実行する`)
  else lines.push(`- ${spec.preset}: 定義の model が "${named.model}" で、${spec.variable} の "${alias}" と食い違う。${spec.skill} を実行する`)
  continue
}

const withAlias = marked.filter((entry) => entry.model === alias)
const covered = new Set(withAlias.flatMap((entry) => entry.roles))
const missing = preset.roleIds.filter((role) => !covered.has(role))
if (missing.length === 0) continue

if (withAlias.length === 0) {
  if (named === undefined) {
    lines.push(`- ${spec.preset}: ${spec.variable} の "${alias}" を model に持つ定義が無い。${spec.skill} を実行する`)
  } else {
    lines.push(`- ${spec.preset}: 定義の model が "${named.model}" で、${spec.variable} の "${alias}" と食い違う。${spec.skill} を実行する`)
  }
} else {
  lines.push(`- ${spec.preset}: ${withAlias.map((entry) => entry.name).join(" / ")} が "${alias}" を使っているが、${missing.join(", ")} を宣言する定義が無い。${spec.skill} を実行する`)
}
```

`model` キーを持たない定義は `entry.model` が `undefined` になり、どのエイリアスとも一致しない。これは正しい挙動である(マーカーだけ付けて `model` を書き忘れた定義は充足に数えない)。テストで固定する。

**この設計を採る理由**(独立レビューの反証 C): 当初案の「役割 1 つでも交差すれば充足」は緩すぎた。`AMATSUKA_AGENT_GPT_TERRA_ALIAS=my-terra` を設定し、`model: my-terra` の `explore` 専用定義だけを置いた利用者は、`normal-impl` を担う定義が無いのに充足と判定され、促しが出なくなる。I6 の「名前依存の恒久誤検知」を、別種の沈黙に置き換えてしまう。和集合カバレッジならこの穴が閉じる。

`presets.ts` の `PRESETS` を import する。現行は `DEFAULT_ALIASES` だけを import している。

**M7**: `labelOf` に `Map<string, string | undefined>` のメモ化を足す。同じ役割 ID につき最大 3 回、プロジェクト断片では毎回 `existsSync` + `readFileSync` していた。

**M13**: `markerBlock` の行順を `roleOrder` 順(同順は `id` の `localeCompare`)にする。現行は走査順のため担当表と並びが揃わない。

**Grok 4.6 移行周知**(§2.1): `retiredBlock` を拡張する。廃止済み定義が見つかり、その名前に `grok-` で始まるものが含まれ、かつ `AMATSUKA_AGENT_GROK_ALIAS` が未設定(空文字を含む)のときだけ、既存の通知文へ次の 1 行を足す。

> Grok の既定エイリアスは `claude-grok-4-6` へ変わった。プロキシ設定にこの別名が無い場合、委譲時に `unknown provider for model` で失敗する。4.5 を使い続けるなら `AMATSUKA_AGENT_GROK_ALIAS=claude-grok-4-5` を設定する。

`retiredBlock` は現在 `env` を受け取っていないため、シグネチャに `env: NodeJS.ProcessEnv` を足す。

### W4.2 `build-presets.ts`(M12)

生成後に、`PRESETS` に対応しない `agents/*.md` を削除する。`.md` 以外は触らない。

### W4.3 役割断片(M3)

`## 制約` の各項目に役割名の冠を付ける規則(設計書 §6.5)から外れている項目を直す。

| ファイル | 現行 | 修正後 |
| --- | --- | --- |
| `realtime-research.md` | 調査結果の採否を自分で判断しない。判断材料を揃えて返す。 | **リアルタイム情報調査として依頼されたときは**、調査結果の採否を自分で判断せず、判断材料を揃えて返す。 |
| `code-review.md` | 差分の範囲を越えた改善提案は、指摘とは分けて書く。 | **コードレビューとして依頼されたときは**、差分の範囲を越えた改善提案を指摘とは分けて書く。 |

**あわせて 10 断片すべての `## 制約` を確認し、冠を欠く項目が他にないかを検査する。** レビューが挙げたのは 2 件だが、同じ規則違反が他にある可能性を潰す。`_common.md` の共通制約は冠を付けない(§6.5 の規定どおり)。

### W4.4 README(M11・M14・M15)

- **M14**: 移行手順 1 に「SessionStart フックは残骸を検知すると削除を促す通知を出します」の一文を戻す。実装(`retiredBlock`)は今も通知する。
- **M15**: 移行手順 2(Grok 4.6)の 1 文 6 情報を箇条書きに割る。内容は変えない。
- **M11**: 同梱プリセットごとに `color` を固定する(ユーザー判断: 2026-08-24)。README の同梱エージェント表へ `color` 列を足す。

ルート `README.md` の agent-policy の記述も、`--list-roles` / `--merge` に触れる必要があるか確認する。

### W4.5 プリセットごとの color(M11)

同梱プリセットは旧版の識別を復元し、setup で利用者が作る定義はベンダー既定のままにする。

| プリセット | `color` |
| --- | --- |
| `gpt-sol` | `yellow` |
| `gpt-terra` | `green` |
| `gpt-luna` | `cyan` |
| `grok` | `red` |

実装:

- `presets.ts` の `Preset` に `color: string` を足し、上表の値を持たせる。
- `compose.ts` の `ComposeInput` に `color?: string` を足す。指定があればそれを使い、無ければ従来どおり `COLORS[vendor]` を使う。
- `build-presets.ts` が `preset.color` を渡す。`setup-agents.ts` は渡さない(利用者定義はベンダー既定)。
- 設計書 §6.3 を「同梱プリセットは `presets.ts` の `color` を優先し、指定が無ければベンダー既定を使う」に改める。

**再生成差分**: `gpt-sol` はベンダー既定と同値のため変わらない。`gpt-terra`(yellow → green)と `gpt-luna`(yellow → cyan)の 2 ファイルに差分が出る。`grok` は `red` のままで変わらない。

**受容する非対称**: 同梱プリセットと利用者定義で色の決まり方が違う。setup は名前も役割も自由に決めさせるため、プリセット名に紐づく色を利用者定義へ再現する手段が無い。ベンダーで揃うことが利用者定義側の一貫性になる。

---

## W5. テスト・検証・マージ

### W5.1 追加するテスト

既存の流儀に従う(引き継ぎ書 §6.2〜§6.4)。`import.meta.dirname` を使わない。`runTs` の import は `.js` 付き。CLI テストは非ゼロ終了の例外から `stdout` を取り出す。フックのテストは `environment()` を通す。

| 対象 | ケース |
| --- | --- |
| `--list-roles` | 組み込み 10 種を `ROLES` 順で返す / プロジェクト断片の ID が末尾に加わる / 同一 ID の置き換えで `source` が `project` になる / `--name` 等を要求しない |
| `--check` の `roles` | 実装のみ → `mixedKinds: false` / 混在 → `true` / `implRoles` と `readonlyRoles` の振り分け / `agentTool` が `light-impl` 単独で `false`、`complex-impl` で `true` |
| `--write --merge` | 既存の独自 tools・独自キー・独自節が残る / `changed` と `sectionsChanged` は破棄され `discarded` に載る / 新規作成では `action: "written"` かつ `discarded` と `keptNeedsReview` が全て空 / 明示 `--keep` が併用できる / 自動 keep セレクタが `merge()` の存在検証と衝突しない |
| `keptNeedsReview` | 既存の `mcp__*` tools と `## ツール運用` 節が `kept` と `keptNeedsReview` の両方に載る / 利用者独自の tools・節は `kept` のみで `keptNeedsReview` に載らない |
| `--write`(merge なし) | `action: "overwritten"` で `discarded` が埋まる |
| `parseArgs` | `--name ../../pwned` / `--name GPT_Sol` / `--name -a` を拒否 / `--roles explore,explore` が 1 件に潰れる |
| `parseDocument` | frontmatter の無い既存ファイルを本文として扱い、`keysOnlyInExisting` が空になる |
| `session-start` | 別名の定義が役割マーカーでプリセットの `roleIds` を覆っていれば促さない / 覆えていなければ不足役割を挙げて促す / エイリアスを持つ定義が 1 つも無ければ促す / 名前一致で model 不一致なら食い違いを報告 / `model` キーを持たない定義は充足に数えない / 複数定義で分担しても和集合が覆えば促さない / `markerBlock` が `ROLES` 順に並ぶ |
| `build-presets` | 生成対象外の `.md` が削除され、`.md` 以外は残る |
| `roles.ts` | `roleOrder` が未知 ID に `ROLES.length` を返す / `sortRoleIds` が未知 ID を末尾へ置く / `hasMixedKinds(kinds)` |
| `color`(M11) | `gpt-terra` が `green`、`gpt-luna` が `cyan`、`grok` が `red` で生成される / `setup-agents.ts` 経由の生成はベンダー既定(`gpt` は `yellow`)になる |
| `retiredBlock` | `grok-` 残骸 + `AMATSUKA_AGENT_GROK_ALIAS` 未設定で 4.6 の 1 行が出る / エイリアス設定済みなら出ない / 残骸が `gpt-researcher` だけなら出ない / 残骸が無ければブロック自体が出ない |

`hasMixedKinds` の既存テストは新シグネチャへ書き換える。

### W5.2 検証

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test
git status --porcelain plugins/          # 出力が無いこと
claude plugin validate plugins/agent-policy --strict
```

引き継ぎ書 §6.5 の grep 検査を再実行する(MCP 残存・廃止定義名の残存・断片への固有名混入・旧エイリアスの残存)。

`--list-roles` の実機確認:

```bash
node plugins/agent-policy/scripts/setup-agents.mjs --list-roles | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).roles.map(r=>`${r.id} ${r.kind} ${r.source}`).join("\n")))'
```

### W5.3 バージョン

`plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` を `0.9.0-dev` に揃える。

### W5.4 コミットとマージ

- 生成物(`plugins/agent-policy/scripts/` と `agents/`)の差分は同じコミットに含める。
- `.raphael/antibodies/` と `docs/chat/` の未コミット変更は本改修と無関係なので**含めない**。
- マージは引き継ぎ書 §5.3 のとおりメインのチェックアウトで行い、マージ結果に対して再度 `pnpm build && pnpm lint && pnpm typecheck && pnpm test` を回す。
- 後片付け(§5.4)はマージ結果が緑になってから。`worktree remove` が拒否されたら `--force` を使わず中身を確認する。

---

## 2. 判断が要る点

| # | 内容 | 決定 |
| --- | --- | --- |
| 1 | M11: GPT 3 種の `color` が全て `yellow` になった | **決定済み(2026-08-24)**: プリセットごとに固定値を持たせる。利用者定義はベンダー既定。W4.5 |
| 2 | Grok 4.6 移行のフック周知(下記 §2.1) | **決定済み(2026-08-24)**: `retiredBlock` への相乗りだけ行う |
| 3 | バージョンを `0.9.0-dev` へ上げる | 機能追加を含むためマイナー。メジャーではないので自動判断の範囲 |
| 4 | 引き継ぎ書 §4.4 の残る 2 提案(`roles.generated.ts` 化・担当表突き合わせテスト) | 今回はスコープ外。引き継ぎ書に記録済み |

### 2.1 Grok 4.6 移行のフック周知(独立レビューの反証 E)

独立レビューは、引き継ぎ書 §4.4-4 をスコープ外にする判断に反証を出した。`AMATSUKA_AGENT_GROK_ALIAS` が未設定のとき、フックは既定値と一致するとみなして `continue` する。既定値そのものが `claude-grok-4-5` → `claude-grok-4-6` へ変わったことは検知対象外である。プロキシに 4.6 の別名が無い利用者は、セッション開始時に何の通知も受けず、委譲したその瞬間に `unknown provider for model` で失敗する。README の改稿はセッションへ注入されない。

**難点**: この条件は自力で解消しない。「1 度だけ注入する」には注入済みかどうかの状態を持つ必要があり、フックはファイルを書かない(設計 §9.2)。無条件に注入すると、既にプロキシへ 4.6 を追加済みの利用者にも恒久的に出続ける。

**採った案**(2026-08-24 決定): 既存の `retiredBlock` に相乗りする。`.claude/agents/` に廃止済み定義(`grok-researcher` / `grok-implementer` など)が残っているのは「旧構成から来た利用者」の確実なシグナルであり、しかも**削除すれば条件が消える**。次の条件で 1 行足す。

- `retiredBlock` が発火し、その残骸に `grok-` で始まる名前が含まれ、かつ `AMATSUKA_AGENT_GROK_ALIAS` が未設定

> Grok の既定エイリアスは `claude-grok-4-6` へ変わった。プロキシ設定にこの別名が無い場合、委譲時に `unknown provider for model` で失敗する。4.5 を使い続けるなら `AMATSUKA_AGENT_GROK_ALIAS=claude-grok-4-5` を設定する。

新しい状態も新しい恒久ナグも増やさず、引き継ぎ書が名指しした「旧構成から来た利用者」を確実に捕まえる。

**この案が捕まえないもの**: `.claude/agents/` を一度も作らず同梱プリセットだけを使ってきた利用者。この経路の通知には、解消しない恒久ナグか、フックの状態書き込みのどちらかが要る。どちらも設計の前提を崩すため今回は入れず、README の移行手順 2(M15 で箇条書きに整形する)に委ねる。

## 3. やらないこと

- `roles.ts` の `ROLES` を断片から生成する(`roles.generated.ts`)。今回の `--list-roles` で SKILL.md の写しは消えるが、`roles.ts` と README の写しは残る。
- 4 本の方針スキルの担当表と `PRESET_ASSIGNMENTS` の突き合わせテスト。
- Grok 4.6 移行周知の**全面版**(エイリアス未設定の全利用者への注入)。§2.1 のとおり `retiredBlock` への相乗りだけを行う。
- `--merge` が保持する `mcp__*` / `## ツール運用` の**自動除外**。`keptNeedsReview` で可視化するに留める(W2.4)。
- `disallowed-tools` によるウィザード全行程の権限強制。仕様上できない(§0.1)。
- `_common.md` の節マージ規則、`compose` の本文合成順序。生成物の全面差分になる。
- M6(`keep.preamble` の非対称)。現行挙動が正しい。
