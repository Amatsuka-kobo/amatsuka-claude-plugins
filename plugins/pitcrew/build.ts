import fs from "node:fs"
import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "capture-subagent-stop": "./src/hooks/capture-subagent-stop.ts",
    "capture-post-tool-use": "./src/hooks/capture-post-tool-use.ts",
    "inject-pre-tool-use": "./src/hooks/inject-pre-tool-use.ts",
    "inject-stop": "./src/hooks/inject-stop.ts",
    serve: "./src/server/serve.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26"
})

// ブラウザビューアの UI はバンドルせず、serve.mjs の隣に置いて実行時に読む
// (tsx 直実行のテストとバンドル実行で同じ読み込みコードを使うため)
fs.copyFileSync("./src/server/ui.html", "./scripts/ui.html")
