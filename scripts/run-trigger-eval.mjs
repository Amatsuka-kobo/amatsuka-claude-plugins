#!/usr/bin/env node
// スキルの発火精度(trigger eval)を測定する。
//
// skill-creator の run_eval.py は測定対象を .claude/commands/ にスラッシュコマンドとして
// 登録するが、Claude Code の現行版ではコマンドと skills が別系統であり、自然文の依頼からは
// コマンドが選ばれない。そのため Skill ツール呼び出しを見る検出側が常に false になる。
// このランナーは .claude/skills/ へ登録することでその問題を回避する。
//
// 使い方:
//   node run-trigger-eval.mjs --skill <SKILL.mdのパス> --eval-set <クエリJSON> [--runs 2] [--workers 4]
//
// 出力: JSON { results: [{query, should_trigger, triggers, runs, trigger_rate, pass}], summary }

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const skillPath = opt("skill");
const evalSetPath = opt("eval-set");
const runs = Number(opt("runs", "2"));
const workers = Number(opt("workers", "4"));
const model = opt("model", "claude-opus-5");
const timeoutMs = Number(opt("timeout", "240")) * 1000;

if (!skillPath || !evalSetPath) {
  console.error("usage: run-trigger-eval.mjs --skill <SKILL.md> --eval-set <queries.json>");
  process.exit(2);
}

const skillBody = readFileSync(skillPath, "utf8");
const skillName = (skillBody.match(/^name:\s*(.+)$/m) || [, "skill-under-test"])[1].trim();
const queries = JSON.parse(readFileSync(evalSetPath, "utf8"));

/** 測定用のプロジェクトディレクトリを作り、スキルを skills として登録する */
function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "trigger-eval-"));
  mkdirSync(join(dir, ".claude", "skills", skillName), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", skillName, "SKILL.md"), skillBody);
  return dir;
}

/**
 * 1 クエリを 1 回実行し、Skill ツールが呼ばれたかを返す。
 * 最初のツール呼び出しを検出した時点で打ち切る(実処理まで走らせない)。
 */
function runOnce(workspace, query) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn(
      "claude",
      ["-p", query, "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model],
      { cwd: workspace, env, stdio: ["ignore", "pipe", "ignore"] },
    );

    let buf = "";
    let settled = false;
    const finish = (triggered) => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      clearTimeout(timer);
      resolve(triggered);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        // 部分ストリームから最初のツール呼び出しを拾う
        if (e.type === "stream_event" && e.event?.type === "content_block_start") {
          const cb = e.event.content_block ?? {};
          if (cb.type === "tool_use") finish(cb.name === "Skill");
        }
        // ツールを1つも呼ばずに終了した場合
        if (e.type === "result") finish(false);
      }
    });
    child.on("error", () => finish(false));
    child.on("close", () => finish(false));
  });
}

/** 同時実行数を絞って全タスクを処理する */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workerLoop = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, workerLoop));
  return out;
}

const workspace = makeWorkspace();
try {
  const tasks = queries.flatMap((q) => Array.from({ length: runs }, () => q));
  const flat = await pool(tasks, workers, (q) => runOnce(workspace, q.query));

  const results = queries.map((q, qi) => {
    const slice = flat.slice(qi * runs, (qi + 1) * runs);
    const triggers = slice.filter(Boolean).length;
    const rate = triggers / runs;
    // should_trigger は過半数で発火、should_not_trigger は 1 度も発火しないことを合格とする
    const pass = q.should_trigger ? rate >= 0.5 : rate === 0;
    return { query: q.query, should_trigger: q.should_trigger, triggers, runs, trigger_rate: rate, pass };
  });

  const passed = results.filter((r) => r.pass).length;
  console.log(
    JSON.stringify(
      {
        skill: skillName,
        results,
        summary: {
          total: results.length,
          passed,
          failed: results.length - passed,
          false_negatives: results.filter((r) => !r.pass && r.should_trigger).length,
          false_positives: results.filter((r) => !r.pass && !r.should_trigger).length,
        },
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
