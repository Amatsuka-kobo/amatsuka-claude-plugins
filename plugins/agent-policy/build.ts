import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "delegation-gate": "./src/hooks/delegation-gate.ts",
    "parallel-nudge": "./src/hooks/parallel-nudge.ts",
    "session-start": "./src/hooks/session-start.ts",
    "setup-agents": "./src/setup-agents.ts",
    "subagent-start": "./src/hooks/subagent-start.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
