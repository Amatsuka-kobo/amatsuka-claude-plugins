import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "session-start": "./src/hooks/session-start.ts",
    "subagent-start": "./src/hooks/subagent-start.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22",
  // SDK は例外の名前を new.target.name で決めるため、クラス名の改名を防ぐ
  keepNames: true
})
