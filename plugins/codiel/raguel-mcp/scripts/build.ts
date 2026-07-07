import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: ["./src/server.ts"],
  outdir: "./dist",
  outExtension: {
    ".js": ".mjs"
  },
  platform: "node",
  format: "esm",
  banner: {
    // NOTE: banner の識別子はバンドル本体のトップレベルと同一スコープになるため、
    // 依存(zod の `url` 等)と衝突しない名前を使うこと
    js: 'import { createRequire as __raguelCreateRequire } from "module"; import { fileURLToPath as __raguelFileURLToPath } from "url"; const require = __raguelCreateRequire(import.meta.url); const __filename = __raguelFileURLToPath(import.meta.url); const __dirname = __raguelFileURLToPath(new URL(".", import.meta.url));'
  }
})
