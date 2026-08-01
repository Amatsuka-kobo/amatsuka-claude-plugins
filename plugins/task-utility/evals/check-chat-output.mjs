#!/usr/bin/env node
// chat スキルの記録フォーマット契約を機械検証する。
// 使い方: node check.mjs <出力ディレクトリ> <eval-id>
// 出力: grading.json 互換の JSON (expectations[].text / .passed / .evidence)

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const [, , outDir, evalId] = process.argv;
if (!outDir) {
  console.error("usage: check.mjs <outputDir> <evalId>");
  process.exit(2);
}

/** ディレクトリ配下の .md を再帰収集する */
function collectMd(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectMd(p, acc);
    else if (name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

// 収集対象は docs/chat/ 配下だけに限る。作業ディレクトリ全体を走査すると
// .claude/skills/chat/SKILL.md のようなスキル定義まで記録ファイルとして数えてしまう。
const files = collectMd(join(outDir, "docs", "chat"));
const records = files.filter((f) => !f.endsWith("INDEX.md"));
const indexFile = files.find((f) => f.endsWith("INDEX.md"));
const body = records.map((f) => readFileSync(f, "utf8")).join("\n");
const indexBody = indexFile ? readFileSync(indexFile, "utf8") : "";

/** 引用ブロックの行だけを集めて連結する(先頭の > と空白を除去) */
function quotedText(text) {
  return text
    .split("\n")
    .filter((l) => l.trimStart().startsWith(">"))
    .map((l) => l.trimStart().replace(/^>\s?/, ""))
    .join("\n");
}

const quoted = quotedText(body);
const expectations = [];
const check = (text, passed, evidence) =>
  expectations.push({ text, passed: Boolean(passed), evidence: String(evidence).slice(0, 300) });

if (evalId === "0") {
  const verbatim = "以前 10 万行を一括生成してメモリ落ちしたことがあるので";
  check(
    "ユーザー発言が引用ブロック(>)で原文のまま記録されている",
    quoted.includes(verbatim),
    quoted.includes(verbatim) ? "原文が引用ブロック内に存在" : `引用ブロック内に見つからない: ${quoted.slice(0, 150)}`,
  );
  check(
    "ユーザー発言が要約・改変されていない",
    quoted.includes("BOM 付き UTF-8 固定") || quoted.includes("BOM付きUTF-8固定"),
    "BOM 指定の原文表現の有無",
  );
  check("AI パートに決定と理由が含まれている", /csv-stringify/.test(body), "csv-stringify への言及");
  check("AI パートに却下された選択肢が含まれている", /fast-csv/.test(body), "fast-csv への言及");
  check(
    "AI パートに失敗の経緯が含まれている",
    /背圧|pipeline\(\)|線形増加/.test(body),
    "背圧/pipeline/線形増加 いずれかへの言及",
  );
  check("網羅性の明記が含まれている", /残り\s*3\s*本|残り3本|無風/.test(body), "残り3本/無風 への言及");
  check(
    "ファイルパスが docs/chat/2026/0801/testuser/ 配下である",
    records.some((f) => f.includes("2026/0801/testuser")),
    records.join(", ") || "記録ファイルなし",
  );
  const indexLines = indexBody.split("\n").filter((l) => l.trim().startsWith("- "));
  check("INDEX.md に対応する行が1行だけ追加されている", indexLines.length === 1, `INDEX 行数=${indexLines.length}`);
  check(
    "ヘッダーに日付・参加者・成果物・前提が含まれている",
    /日付/.test(body) && /参加者/.test(body) && /成果物/.test(body) && /前提/.test(body),
    "4 項目の有無",
  );
}

if (evalId === "1") {
  check("既存ファイルに追記されている(新規ファイルが作られていない)", records.length === 1, `記録ファイル数=${records.length}`);
  const sessions = body.match(/^##\s*セッション\s*\d+/gm) || [];
  check("新しいセッション見出しが追加されている", sessions.length >= 2, `セッション見出し数=${sessions.length}`);
  check("既存のセッション1の内容が保持されている", /csv-stringify/.test(body), "セッション1の内容(csv-stringify)の残存");
  check(
    "ユーザー発言が引用ブロックで原文のまま記録されている",
    quoted.includes("海外向けは要らないので"),
    quoted.includes("海外向けは要らないので") ? "原文が引用ブロック内に存在" : "引用ブロック内に見つからない",
  );
  check("却下された選択肢が記録されている", /CSV_ENCODING/.test(body), "CSV_ENCODING への言及");
  const indexLines = indexBody.split("\n").filter((l) => l.trim().startsWith("- "));
  check("INDEX.md の行数が増えていない(1ファイル1行)", indexLines.length === 1, `INDEX 行数=${indexLines.length}`);
}

const passed = expectations.filter((e) => e.passed).length;
console.log(
  JSON.stringify(
    { eval_id: Number(evalId), expectations, summary: { total: expectations.length, passed, failed: expectations.length - passed } },
    null,
    2,
  ),
);
