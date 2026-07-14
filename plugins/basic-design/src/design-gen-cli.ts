import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { decorateLayout } from "./decorate.js"
import {
  layoutArchitecture,
  layoutEr,
  layoutScreenFlow
} from "./layout/graph.js"
import { layoutSequence } from "./layout/sequence.js"
import { renderDrawio } from "./render/drawio.js"
import { renderHtml } from "./render/html.js"
import type { DiagramSpec, Layout } from "./types.js"
import { validateSpec } from "./validate.js"

const LAYOUTS: Record<DiagramSpec["type"], (spec: never) => Promise<Layout>> = {
  architecture: layoutArchitecture as never,
  "screen-flow": layoutScreenFlow as never,
  er: layoutEr as never,
  sequence: layoutSequence as never
}
const FORMATS = ["drawio", "html", "both"] as const

function fail(errors: string[]): never {
  process.stdout.write(`${JSON.stringify({ ok: false, errors })}\n`)
  process.exit(1)
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const formatIndex = argv.indexOf("--format")
  const specArg = argv.find(
    (arg, index) =>
      !arg.startsWith("--") && (formatIndex === -1 || index !== formatIndex + 1)
  )
  const format = formatIndex === -1 ? "both" : argv[formatIndex + 1]

  if (!specArg)
    fail(["usage: node design-gen.mjs <spec.json> --format <drawio|html|both>"])
  if (!FORMATS.includes(format as never))
    fail([`--format: "${format}" は不正です(対応: ${FORMATS.join(", ")})`])

  let unknown: unknown
  try {
    unknown = JSON.parse(readFileSync(specArg, "utf8"))
  } catch (error) {
    fail([`spec ファイルを読めません: ${(error as Error).message}`])
  }

  const errors = validateSpec(unknown)
  if (errors.length) fail(errors)
  const spec = unknown as DiagramSpec

  try {
    const layout = decorateLayout(spec, await LAYOUTS[spec.type](spec as never))
    const dir = path.dirname(path.resolve(specArg))
    const name = path.basename(specArg)
    const base = name.endsWith(".spec.json")
      ? name.slice(0, -".spec.json".length)
      : name.replace(/\.json$/, "")
    const files: string[] = []
    if (format === "drawio" || format === "both") {
      const out = path.join(dir, `${base}.drawio`)
      writeFileSync(out, renderDrawio(layout))
      files.push(out)
    }
    if (format === "html" || format === "both") {
      const out = path.join(dir, `${base}.html`)
      writeFileSync(out, renderHtml(layout, spec))
      files.push(out)
    }
    process.stdout.write(`${JSON.stringify({ ok: true, files })}\n`)
  } catch (error) {
    fail([`図の生成に失敗しました: ${(error as Error).message}`])
  }
}

main().catch((error) =>
  fail([`図の生成に失敗しました: ${(error as Error).message}`])
)
