import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "design-gen": "./src/design-gen-cli.ts",
    "check-drive-config": "./src/check-drive-config-cli.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26",
  banner: {
    js: 'import { createRequire as __basicDesignCreateRequire } from "node:module"; const require = __basicDesignCreateRequire(import.meta.url);'
  }
})
