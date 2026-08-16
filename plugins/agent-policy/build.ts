import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "session-start": "./src/hooks/session-start.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
