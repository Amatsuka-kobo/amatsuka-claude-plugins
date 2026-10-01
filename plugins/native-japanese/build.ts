import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    inject: "./src/inject.ts",
    "fetch-morph": "./src/fetch-morph.ts",
    measure: "./src/measure.ts",
    check: "./src/check.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
