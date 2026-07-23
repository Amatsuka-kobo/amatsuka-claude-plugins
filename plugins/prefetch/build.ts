import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "check-prefetch-manifest": "./src/check-prefetch-manifest.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26"
})
