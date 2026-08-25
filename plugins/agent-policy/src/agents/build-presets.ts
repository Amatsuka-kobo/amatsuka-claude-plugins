import fs from "node:fs"
import path from "node:path"
import { compose } from "./compose"
import { PRESETS } from "./presets"

// 同梱プリセットはプラグイン同梱の断片だけから作る。
// プロジェクト側の断片(.claude/agent-policy/roles/)は読まない。
export function buildPresets(pluginRoot: string): void {
  const roles = path.join(pluginRoot, "assets", "roles", "ja")
  const outDir = path.join(pluginRoot, "agents")
  fs.mkdirSync(outDir, { recursive: true })

  for (const preset of PRESETS) {
    const document = compose({
      name: preset.name,
      model: preset.defaultAlias,
      vendor: preset.vendor,
      roleIds: preset.roleIds,
      fragmentDirs: [{ path: roles, source: "plugin" }],
      color: preset.color
    })
    fs.writeFileSync(path.join(outDir, `${preset.name}.md`), document)
  }

  const generated = new Set(PRESETS.map((preset) => `${preset.name}.md`))
  for (const name of fs.readdirSync(outDir)) {
    if (name.endsWith(".md") && !generated.has(name)) {
      const file = path.join(outDir, name)
      if (fs.statSync(file).isFile()) fs.unlinkSync(file)
    }
  }
}
