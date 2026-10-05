import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "guard-bash": "./src/hooks/guard-bash.ts",
    "guard-github-mcp": "./src/hooks/guard-github-mcp.ts",
    "guard-write": "./src/hooks/guard-write.ts",
    "stop-guard": "./src/hooks/stop-guard.ts",
    "codiel-state": "./src/codiel-state-cli.ts",
    "check-intent-env": "./src/check-intent-env.ts",
    lib: "./src/hooks/lib.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
