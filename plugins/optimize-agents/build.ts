import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "run-trigger-eval": "./src/run-trigger-eval.ts",
    // 以下は実装が追いつくまでコメントアウトする。戻すタイミングは実装計画を参照。
    "check-agent-definition": "./src/check-agent-definition.ts"
    // "run-output-eval": "./src/run-output-eval.ts",                // Task 6 Step 5
    // "aggregate-benchmark": "./src/aggregate-benchmark.ts"         // Task 7 Step 5
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
