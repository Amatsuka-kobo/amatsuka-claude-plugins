import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "inject-trigger-map": "./src/inject-trigger-map.ts",
    "remind-skill": "./src/remind-skill.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
