import path from "node:path"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"
import { buildPresets } from "./src/agents/build-presets"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "session-start": "./src/hooks/session-start.ts",
    "setup-agents": "./src/setup-agents.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})

buildPresets(path.dirname(fileURLToPath(import.meta.url)))
