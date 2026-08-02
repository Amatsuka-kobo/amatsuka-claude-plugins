import fs from "node:fs"
import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    serve: "./src/serve.ts",
    "inject-stop": "./src/hooks/inject-stop.ts",
    "inject-pre-tool-use": "./src/hooks/inject-pre-tool-use.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})

fs.copyFileSync("./src/ui.html", "./scripts/ui.html")
