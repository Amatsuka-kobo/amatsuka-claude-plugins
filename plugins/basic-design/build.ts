import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: { "design-gen": "./src/cli.ts", "check-drive-config": "./src/check-drive-config.ts" },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node20",
  banner: {
    js: 'import { createRequire as __basicDesignCreateRequire } from "node:module"; const require = __basicDesignCreateRequire(import.meta.url);',
  },
})
