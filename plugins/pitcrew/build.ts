import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "capture-subagent-stop": "./src/hooks/capture-subagent-stop.ts",
    "capture-post-tool-use": "./src/hooks/capture-post-tool-use.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26"
})
