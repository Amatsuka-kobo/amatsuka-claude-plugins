#!/usr/bin/env node
// metatron の PreToolUse deny hook。
// 正本(ARCHITECTURE / GOTCHAS)への Edit / Write / NotebookEdit を拒否し、
// CLI の絶対パスを添えて正しい窓口へ誘導する。
//
// **この hook が C1 構成の唯一の強制点である**(設計書 §7-5)。
// MCP でも CLI でも達成できなかった「正本を直接編集させない」という不変条件は、
// ここで初めて機械的に満たされる。
//
// ---
// フェイル方針: **フェイルオープン**(契約 §12・設計書 §12-1 第 2 層)。
// codiel の guard-write は catch で emit("ask", ...) を返すフェイルクローズドだが、
// metatron は逆に素通しする。**codiel に合わせてフェイルクローズドへ変えないこと。**
// 拒否機構の故障でユーザーのあらゆる編集が止まる損害のほうが、
// 直接編集 1 回の見逃しより桁違いに大きいためである。
// ---

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "./lib/config.js"
import { emit, pass, readStdin } from "./lib/emit.js"

// hook 自身の位置(import.meta.url)からプラグインルートを求め、
// その配下の CLI の絶対パスを組み立てる。deny hook は CLI を実行しない。
// 行うのは絶対パスを文字列として組み立て、拒否理由に載せることだけである
// (実行するのはモデルが Bash 経由で行う。設計書 §3-1)。
// バンドル後は <root>/scripts/guard-docs.mjs、ソース実行時は <root>/src/guard-docs.ts。
// どちらも 2 つ上がプラグインルートになる。
function metatronCliPath(): string {
  const self = fileURLToPath(import.meta.url)
  return path.join(path.dirname(path.dirname(self)), "scripts", "metatron.mjs")
}

// 区切り文字の差(`\` と `/`)を吸収する。POSIX 上では `\` はファイル名に使える文字だが、
// 設計書 §7-5 の表に従い区切りとして正規化する側に倒す。
function toSlash(value: string): string {
  return value.replace(/\\/g, "/")
}

// シンボリックリンク経由のすり抜けを塞ぐ。未作成のファイルは realpath できないため、
// 親ディレクトリを実体へ解決してファイル名を付け直す(Write による新規作成でも効かせる)。
function realpathOrParent(abs: string): string {
  try {
    return fs.realpathSync(abs)
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs))
    } catch {
      return abs
    }
  }
}

function flipCase(value: string): string {
  return value.replace(/[A-Za-z]/g, (c) =>
    c >= "a" && c <= "z" ? c.toUpperCase() : c.toLowerCase()
  )
}

function deepestExisting(abs: string): string | null {
  let dir = abs
  for (;;) {
    if (fs.existsSync(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// 大文字小文字を区別しない FS かを実測する。プラットフォーム名で決め打ちしないのは、
// macOS でも区別するボリュームがあり、Linux でも区別しないマウントがありうるため。
// 判定は正本が載っている FS 自身に、実在するディレクトリの inode 一致で問う。
// 区別する側(= より素通しに倒れる側)を既定にしてあるのは、フェイルオープンの方針に沿う。
function isCaseInsensitiveFs(probe: string): boolean {
  // Windows は既定で非区別。かつ ino / dev が 0 になり得て実測が効かない。
  if (process.platform === "win32") return true
  let dir = deepestExisting(probe)
  while (dir !== null) {
    const base = path.basename(dir)
    const flipped = flipCase(base)
    if (flipped !== base) {
      try {
        const a = fs.statSync(dir)
        const b = fs.statSync(path.join(path.dirname(dir), flipped))
        return a.ino === b.ino && a.dev === b.dev
      } catch {
        return false
      }
    }
    // 英字を含まない名前では判定できないので親へ遡る。
    const parent = path.dirname(dir)
    dir = parent === dir ? null : parent
  }
  return false
}

// 比較用の正規形。前方一致・部分一致はしない(設計書 §7-5)。
// docs/ARCHITECTURE.md.bak や .orig は別ファイルであり素通しする。
//
// Unicode 正規化(NFC)を両辺に掛ける。既定パスは ASCII なので通常は無害だが、
// metatron.config.json の paths に結合文字を含む名前(濁点・合成可能なラテン文字)を
// 設定し、かつ対象ファイルが未作成のときは realpath による実体解決が効かず、
// 生文字列同士の比較になる。NFC と NFD は視覚的に同一でも byte 列が異なるため、
// 正規化しないとすり抜ける(設計書 §7-5 の「正規化のうえ一致」の範囲内の措置)。
function comparisonKey(abs: string, caseInsensitive: boolean): string {
  const key = toSlash(realpathOrParent(abs)).normalize("NFC")
  return caseInsensitive ? key.toLowerCase() : key
}

function architectureReason(relative: string, cli: string): string {
  return [
    `${relative} は metatron の管理下にあり、直接編集できません(セクション単位の差分確認と書式検証のため)。`,
    "更新するセクションの JSON を一時ファイルに書き、次の 2 段階で反映してください:",
    `  node ${cli} stage-architecture --input /tmp/metatron-architecture.json`,
    `  node ${cli} commit-architecture --staging-id <stage-architecture が発行した id>`,
    "ADR の追加・状態変更は stage-adr を使ってください(stage-architecture では拒否されます):",
    `  node ${cli} stage-adr --input /tmp/metatron-adr.json`,
    `入力の書式: node ${cli} get config`
  ].join("\n")
}

function gotchasReason(relative: string, cli: string): string {
  return [
    `${relative} は metatron の管理下にあり、直接編集できません(追記のみ・採番・書式検証のため)。`,
    "エントリの JSON を一時ファイルに書き、次のコマンドで追記してください:",
    `  node ${cli} append-gotcha --input /tmp/metatron-gotcha.json`,
    "既存エントリへのタグ付与(解決済み / 対象外):",
    `  node ${cli} tag-gotcha --id GOTCHA-003 --tag 解決済み --reason "<理由>"`,
    `入力の書式: node ${cli} get config`
  ].join("\n")
}

try {
  const input = await readStdin()
  // Edit / Write は file_path、NotebookEdit は notebook_path を持つ。
  // matcher が 1 語欠けるだけでノートブック形式の正本がすり抜けるため両方を見る。
  // **2 つを独立に判定する。** `file_path ?? notebook_path` と書くと、file_path が
  // 定義されてさえいれば(空文字列や無関係な値でも)notebook_path が一切参照されず、
  // そこに正本を入れた呼び出しが素通りする。
  const candidates = [
    input.tool_input?.file_path,
    input.tool_input?.notebook_path
  ].filter(
    (value): value is string => typeof value === "string" && value !== ""
  )
  if (candidates.length === 0) pass()

  const cwd = input.cwd ?? process.cwd()
  const config = loadConfig(cwd)

  const caseInsensitive = isCaseInsensitiveFs(config.docRoot)
  const architectureKey = comparisonKey(
    config.architecturePath,
    caseInsensitive
  )
  const gotchasKey = comparisonKey(config.gotchasPath, caseInsensitive)
  const cli = metatronCliPath()

  let hitArchitecture = false
  let hitGotchas = false
  for (const raw of candidates) {
    const key = comparisonKey(path.resolve(cwd, toSlash(raw)), caseInsensitive)
    if (key === architectureKey) hitArchitecture = true
    if (key === gotchasKey) hitGotchas = true
  }

  // 2 つのフィールドが別々の正本に当たったときは ARCHITECTURE の案内を出す。
  // 案内が長く 2 段階コミットと ADR の誘導まで含む側を残すほうが、取りこぼす情報が少ない。
  if (hitArchitecture)
    emit("deny", architectureReason(config.architectureRelative, cli))

  if (hitGotchas) emit("deny", gotchasReason(config.gotchasRelative, cli))

  pass()
} catch {
  // フェイルオープン。理由も出力せず素通しする(冒頭のコメントを参照)。
  pass()
}
