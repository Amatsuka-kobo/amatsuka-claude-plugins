// 節名参照のインベントリ(設計書 §14-4)。
//
// metatron 以外のプラグインの指示層が ARCHITECTURE の節名に依存していないことを
// 機械で固定する。分類 A(節を読みに行き中身に依存している)は 1 件でも落ちる。
// 分類 B / C / D は登録簿と照合し、未登録の参照と、登録簿にあるのに実体が無い
// 項目の両方で落ちる。
//
// 走査対象は固定のリストにせず、リポジトリに存在するプラグインを走査する。
// 登録簿だけがこのリポジトリ固有のデータであり、metatron を他のリポジトリへ
// 配布したときこのテストは配布物に含まれない(バンドル対象は src → scripts のみ)。

import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import { ARCHITECTURE_HEADINGS, MOVED_HEADINGS } from "../lib/architecture.js"
import { RULES_FILES } from "../lib/rules.js"

// plugins/metatron/src/__test__/ から 4 つ上がリポジトリルート。
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..")
const PLUGINS = path.join(REPO_ROOT, "plugins")
const SELF = "metatron"
const ANY = "(ARCHITECTURE への言及)"

interface InventoryEntry {
  path: string
  reference: string
  classification: string
  note?: string
}

const inventory = JSON.parse(
  fs.readFileSync(
    path.join(
      import.meta.dirname,
      "..",
      "fixtures",
      "section-reference-inventory.json"
    ),
    "utf8"
  )
) as { entries: InventoryEntry[] }

const TERMS: string[] = [
  ...ARCHITECTURE_HEADINGS,
  ...Object.keys(MOVED_HEADINGS),
  ...RULES_FILES
]

function walkMd(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) walkMd(abs, out)
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(abs)
  }
}

function targets(): string[] {
  const out: string[] = []
  for (const plugin of fs.readdirSync(PLUGINS, { withFileTypes: true })) {
    if (!plugin.isDirectory() || plugin.name === SELF) continue
    const root = path.join(PLUGINS, plugin.name)
    walkMd(path.join(root, "skills"), out)
    for (const sub of ["agents", "commands", "references"]) {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(path.join(root, sub), { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          out.push(path.join(root, sub, entry.name))
        }
      }
    }
    const claudeExample = path.join(root, "CLAUDE.example.md")
    if (fs.existsSync(claudeExample)) out.push(claudeExample)
  }
  return out.sort()
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** 4 形のいずれかに当たる検出語を返す。 */
function termsIn(text: string): string[] {
  const found = new Set<string>()
  for (const term of TERMS) {
    const escaped = escapeRe(term)
    const patterns = [
      new RegExp("`## " + escaped + "`"), // (a)
      new RegExp("^## " + escaped + "\\s*$", "m"), // (b)
      new RegExp("「?" + escaped + "」? *節"), // (c)
      new RegExp("ARCHITECTURE[^\\n]{0,40}" + escaped) // (d)
    ]
    if (patterns.some((pattern) => pattern.test(text))) found.add(term)
  }
  return [...found]
}

/**
 * 4 形に当たらない `ARCHITECTURE` 言及も登録を要する。
 * 「ARCHITECTURE のテストコマンド」のような換言を取りこぼさないためである。
 */
function referencesIn(text: string): string[] {
  const refs = termsIn(text)
  if (/ARCHITECTURE/.test(text)) refs.push(ANY)
  return refs
}

function relativeOf(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/")
}

test("V1: 登録簿に分類 A は存在しない(節名依存はゼロを維持する)", () => {
  expect(
    inventory.entries.filter((e) => e.classification === "A")
  ).toStrictEqual([])
  for (const entry of inventory.entries) {
    expect(["B", "C", "D"], entry.path).toContain(entry.classification)
  }
})

test("V2: 登録簿に無い節名参照・ARCHITECTURE 言及が存在しない", () => {
  const unregistered: string[] = []
  for (const file of targets()) {
    const rel = relativeOf(file)
    const text = fs.readFileSync(file, "utf8")
    for (const ref of referencesIn(text)) {
      const hit = inventory.entries.some(
        (entry) => entry.path === rel && entry.reference === ref
      )
      if (!hit) unregistered.push(`${rel} → ${ref}`)
    }
  }
  // 落ちたときの出力がそのまま登録簿の候補一覧になる。
  expect(unregistered).toStrictEqual([])
})

test("V3: 登録簿にあるのに実体が無い項目が存在しない", () => {
  const stale: string[] = []
  for (const entry of inventory.entries) {
    const abs = path.join(REPO_ROOT, entry.path)
    if (!fs.existsSync(abs)) {
      stale.push(`${entry.path}(ファイルが無い)`)
      continue
    }
    if (!referencesIn(fs.readFileSync(abs, "utf8")).includes(entry.reference)) {
      stale.push(`${entry.path} → ${entry.reference}(参照が無い)`)
    }
  }
  expect(stale).toStrictEqual([])
})
