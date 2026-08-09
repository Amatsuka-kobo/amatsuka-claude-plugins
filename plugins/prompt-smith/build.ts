import esbuild from "esbuild"

const banner = `/**
 * Portions of this bundle are a TypeScript port of the skill-creator
 * Claude Code plugin (Apache License, Version 2.0), Copyright Anthropic, PBC.
 * Modified by amatsuka-koubou. See plugins/prompt-smith/NOTICE for the list
 * of changes and plugins/prompt-smith/LICENSE for the license text.
 */`

await esbuild.build({
  bundle: true,
  entryPoints: {
    "run-trigger-eval": "./src/run-trigger-eval.ts",
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26",
  banner: { js: banner },
})
