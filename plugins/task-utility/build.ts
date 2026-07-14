import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "check-issue-env": "./src/check-issue-env.ts",
    "extract-conversation": "./src/extract-conversation.ts",
    "find-chat-records": "./src/find-chat-records.ts",
    "link-sub-issue": "./src/link-sub-issue.ts",
    "list-issues": "./src/list-issues.ts",
    "check-chat-recorded": "./src/hooks/check-chat-recorded.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node26"
})
