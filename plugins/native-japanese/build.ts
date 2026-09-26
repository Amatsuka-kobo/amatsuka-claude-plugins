import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    inject: "./src/inject.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
