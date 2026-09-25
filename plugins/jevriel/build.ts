import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  keepNames: true,
  entryPoints: ["./src/server.ts"],
  outdir: "./dist",
  outExtension: {
    ".js": ".mjs"
  },
  platform: "node",
  target: "node22",
  format: "esm",
  banner: {
    // NOTE: banner identifiers share scope with bundle top-level code, so avoid dependency name collisions.
    js: 'import { createRequire as __jevrielCreateRequire } from "module"; import { fileURLToPath as __jevrielFileURLToPath } from "url"; const require = __jevrielCreateRequire(import.meta.url); const __filename = __jevrielFileURLToPath(import.meta.url); const __dirname = __jevrielFileURLToPath(new URL(".", import.meta.url));'
  }
})
