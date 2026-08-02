import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "run-trigger-eval": "./src/run-trigger-eval.ts",
    "check-agent-definition": "./src/check-agent-definition.ts",
    "run-output-eval": "./src/run-output-eval.ts",
    "aggregate-benchmark": "./src/aggregate-benchmark.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
