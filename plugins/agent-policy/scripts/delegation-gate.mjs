#!/usr/bin/env node

// src/hooks/delegation-gate.ts
import fs from "node:fs";
import path from "node:path";
var STDIN_TIMEOUT_MS = 2e3;
var CONFIG_RELATIVE_PATH = path.join(
  ".claude",
  "agent-policy",
  "delegation-gate.json"
);
var DENIAL_REASON = "delegation-gate: \u3053\u306E\u30D1\u30B9\u306F\u30E1\u30A4\u30F3\u30BB\u30C3\u30B7\u30E7\u30F3\u3067\u306F\u7DE8\u96C6\u3057\u306A\u3044\u904B\u7528\u3067\u3042\u308B\u3002\u62C5\u5F53\u8868\u306E\u5F79\u5272\u306B\u5F93\u3044\u3001Agent tool \u3067\u59D4\u8B72\u3059\u308B\u3002Bash \u3067\u306E\u66F8\u304D\u8FBC\u307F\u3084\u4ED6\u30C4\u30FC\u30EB\u3078\u306E\u5207\u308A\u66FF\u3048\u3067\u56DE\u907F\u305B\u305A\u3001\u59D4\u8B72\u3067\u9032\u3081\u308B\u3002";
var BUILTIN_TOOLS = {
  Edit: { pathParam: "file_path", absolute: true },
  Write: { pathParam: "file_path", absolute: true },
  NotebookEdit: { pathParam: "notebook_path", absolute: true }
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function report(message) {
  process.stderr.write(`${message}
`);
}
function readHookInput() {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => {
      process.stdin.destroy();
      finish({ ok: false, reason: "stdin timeout" });
    }, STDIN_TIMEOUT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (!isRecord(parsed)) {
          finish({ ok: false, reason: "stdin parse failed" });
          return;
        }
        finish({ ok: true, input: parsed });
      } catch {
        finish({ ok: false, reason: "stdin parse failed" });
      }
    });
    process.stdin.on(
      "error",
      () => finish({ ok: false, reason: "stdin read failed" })
    );
  });
}
function gateEnabled(env) {
  const value = env.AMATSUKA_AGENT_DELEGATION_GATE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}
function canonicalizePath(value) {
  const absolute = path.resolve(value);
  let existing = absolute;
  const missing = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fs.realpathSync(existing), ...missing);
}
function resolveProjectRoot(input) {
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  const inputRoot = input?.cwd;
  const selected = envRoot !== void 0 && envRoot !== "" ? envRoot : typeof inputRoot === "string" && inputRoot !== "" ? inputRoot : process.cwd();
  return canonicalizePath(selected);
}
function configPath(projectRoot) {
  return path.join(projectRoot, CONFIG_RELATIVE_PATH);
}
function invalidConfigMessage(file) {
  return `delegation-gate: \u6709\u52B9\u5316\u3055\u308C\u3066\u3044\u308B\u304C\u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB\u304C\u58CA\u308C\u3066\u3044\u308B(${file})`;
}
function readConfig(projectRoot) {
  const file = configPath(projectRoot);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    const code = isRecord(error) ? error.code : void 0;
    return {
      ok: false,
      message: code === "ENOENT" ? `delegation-gate: \u6709\u52B9\u5316\u3055\u308C\u3066\u3044\u308B\u304C\u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB\u304C\u7121\u3044(${file})` : `delegation-gate: \u6709\u52B9\u5316\u3055\u308C\u3066\u3044\u308B\u304C\u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB\u3092\u8AAD\u3081\u306A\u3044(${file})`
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: invalidConfigMessage(file) };
  }
  if (!isRecord(parsed)) {
    return { ok: false, message: invalidConfigMessage(file) };
  }
  const denyGlobs = parsed.denyGlobs;
  if (!Array.isArray(denyGlobs) || !denyGlobs.every((item) => typeof item === "string")) {
    return { ok: false, message: invalidConfigMessage(file) };
  }
  if (denyGlobs.length === 0) {
    return {
      ok: false,
      message: `delegation-gate: \u6709\u52B9\u5316\u3055\u308C\u3066\u3044\u308B\u304C denyGlobs \u304C\u7A7A\u3067\u3042\u308B(${file})`
    };
  }
  const mcpTools = {};
  if (parsed.mcpTools !== void 0) {
    if (!isRecord(parsed.mcpTools)) {
      return { ok: false, message: invalidConfigMessage(file) };
    }
    for (const [toolName, value] of Object.entries(parsed.mcpTools)) {
      if (!isRecord(value) || typeof value.pathParam !== "string" || value.pathParam === "" || typeof value.absolute !== "boolean") {
        return { ok: false, message: invalidConfigMessage(file) };
      }
      mcpTools[toolName] = {
        pathParam: value.pathParam,
        absolute: value.absolute
      };
    }
  }
  return { ok: true, config: { denyGlobs, mcpTools } };
}
function toolPathSpec(toolName, config) {
  return BUILTIN_TOOLS[toolName] ?? config.mcpTools[toolName];
}
function normalizedTargetPath(toolInput, spec, projectRoot) {
  if (!isRecord(toolInput)) return void 0;
  const rawPath = toolInput[spec.pathParam];
  if (typeof rawPath !== "string" || rawPath === "") return void 0;
  if (spec.absolute && !path.isAbsolute(rawPath)) return void 0;
  const target = canonicalizePath(
    spec.absolute ? rawPath : path.resolve(projectRoot, rawPath)
  );
  const relative = path.relative(projectRoot, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return void 0;
  }
  return relative.split(path.sep).join("/");
}
function respondDeny() {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: DENIAL_REASON
      }
    })}
`
  );
}
async function runHook() {
  if (!gateEnabled(process.env)) return;
  const result = await readHookInput();
  if (!result.ok) {
    report(`delegation-gate: ${result.reason}`);
    return;
  }
  if ("agent_id" in result.input) return;
  const projectRoot = resolveProjectRoot(result.input);
  const configResult = readConfig(projectRoot);
  if (!configResult.ok) {
    report(configResult.message);
    return;
  }
  const { config } = configResult;
  const toolName = result.input.tool_name;
  if (typeof toolName !== "string") return;
  const spec = toolPathSpec(toolName, config);
  if (spec === void 0) return;
  const target = normalizedTargetPath(
    result.input.tool_input,
    spec,
    projectRoot
  );
  if (target === void 0) return;
  if (!config.denyGlobs.some((glob) => path.matchesGlob(target, glob))) return;
  respondDeny();
}
async function main() {
  try {
    await runHook();
  } catch {
  }
}
void main();
