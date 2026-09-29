#!/usr/bin/env node

// src/inject.ts
import fs2 from "node:fs";

// src/morph-runtime.ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var VERSION = "6.2.0";
var INSTALL_DIR = `lindera-${VERSION}`;
var LOCK_TTL_MS = 10 * 6e4;
var FAILED_TTL_MS = 24 * 60 * 6e4;
function resolveTarget() {
  const key = `${process.platform}-${process.arch}`;
  if (process.platform === "linux") {
    ;
    process.report.excludeNetwork = true;
    const report = process.report.getReport();
    if (!report.header?.glibcVersionRuntime) return null;
    return key === "linux-x64" || key === "linux-arm64" ? `${key}-gnu` : null;
  }
  if (key === "win32-x64" || key === "win32-arm64") return `${key}-msvc`;
  if (key === "darwin-x64" || key === "darwin-arm64") return key;
  return null;
}
function isFresh(file, ttlMs) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < ttlMs;
  } catch {
    return false;
  }
}
function maybeStartFetch(env) {
  const dataDir = env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) return;
  if (env.AMATSUKA_NATIVE_JAPANESE_MORPH === "off" || env.AMATSUKA_NATIVE_JAPANESE_CHECK === "off")
    return;
  if (resolveTarget() === null) return;
  const morph = path.join(dataDir, "morph");
  if (fs.existsSync(path.join(morph, INSTALL_DIR, "ready.json"))) return;
  if (isFresh(path.join(morph, "fetch.lock"), LOCK_TTL_MS)) return;
  if (isFresh(path.join(morph, "fetch-failed.json"), FAILED_TTL_MS)) return;
  const script = fileURLToPath(
    new URL("../scripts/fetch-morph.mjs", import.meta.url)
  );
  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env
  });
  child.on("error", () => {
  });
  child.unref();
}

// src/inject.ts
var EVENTS = ["SessionStart", "SubagentStart"];
var event;
try {
  const input = JSON.parse(fs2.readFileSync(0, "utf8"));
  event = input?.hook_event_name;
} catch {
  process.exit(0);
}
if (typeof event !== "string" || !EVENTS.includes(event)) process.exit(0);
if (event === "SessionStart") {
  try {
    maybeStartFetch(process.env);
  } catch {
  }
}
var discipline;
try {
  discipline = fs2.readFileSync(
    new URL("../references/discipline.md", import.meta.url),
    "utf8"
  );
} catch {
  process.exit(0);
}
discipline = discipline.replace(
  /^[ \t]*<!-- native-japanese: ignore-file -->[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)?/gm,
  ""
);
if (discipline.trim() === "") process.exit(0);
process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: discipline
    }
  })}
`
);
