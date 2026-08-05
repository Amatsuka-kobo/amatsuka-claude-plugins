import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "check-issue-env": "./src/check-issue-env.ts",
    "link-sub-issue": "./src/link-sub-issue.ts",
    "list-issues": "./src/list-issues.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
