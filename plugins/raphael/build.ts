import esbuild from "esbuild"

await esbuild.build({
  bundle: true,
  entryPoints: {
    "detect-infection": "./src/detect-infection.ts",
    inoculate: "./src/inoculate.ts",
    "check-distill-needed": "./src/check-distill-needed.ts",
    "list-antibodies": "./src/list-antibodies.ts",
    "update-antibody": "./src/update-antibody.ts"
  },
  outdir: "./scripts",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  sourcemap: false,
  target: "node22"
})
