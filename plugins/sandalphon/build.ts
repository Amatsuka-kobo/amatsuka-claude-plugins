import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "check-intent-env": "./src/check-intent-env.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
