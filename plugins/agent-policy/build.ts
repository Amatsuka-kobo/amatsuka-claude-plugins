import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "setup-agents": "./src/setup-agents.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
