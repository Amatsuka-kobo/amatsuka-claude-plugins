import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    metatron: "./src/metatron-cli.ts",
    "inject-context": "./src/inject-context.ts",
    "guard-docs": "./src/guard-docs.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
