import esbuild from "esbuild"
await esbuild.build({ bundle: true, entryPoints: { "check-drive-config": "./src/check-drive-config.ts" }, outdir: "./scripts", outExtension: { ".js": ".mjs" }, platform: "node", format: "esm", sourcemap: false, target: "node20" })
