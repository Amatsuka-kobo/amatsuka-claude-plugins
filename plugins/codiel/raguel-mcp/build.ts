import { readFileSync } from "node:fs"
import esbuild from "esbuild"

// サーバーが名乗るバージョンと応答の policy.buildVersion は package.json の version を埋め込む(設計書 §8、所見 J2)
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string }

await esbuild.build({
  bundle: true,
  entryPoints: ["./src/server.ts"],
  outdir: "./dist",
  outExtension: {
    ".js": ".mjs"
  },
  platform: "node",
  target: "node22",
  format: "esm",
  define: {
    __RAGUEL_VERSION__: JSON.stringify(version)
  },
  banner: {
    // NOTE: banner の識別子はバンドル本体のトップレベルと同一スコープになるため、
    // 依存(zod の `url` 等)と衝突しない名前を使うこと
    js: 'import { createRequire as __raguelCreateRequire } from "module"; import { fileURLToPath as __raguelFileURLToPath } from "url"; const require = __raguelCreateRequire(import.meta.url); const __filename = __raguelFileURLToPath(import.meta.url); const __dirname = __raguelFileURLToPath(new URL(".", import.meta.url));'
  }
})
