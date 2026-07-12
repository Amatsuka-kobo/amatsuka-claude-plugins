#!/usr/bin/env node
// docs/chat/ の会話記録を検索・列挙し、結果を JSON で stdout に出力する。
// INDEX.md があれば索引行を検索(index)、なければ全文検索(grep)。--latest はパスの
// 日付構造 YYYY/MMDD の新しい順(同日内は mtime 降順)。どのモードでも INDEX.md に
// 載っていない記録を unindexed として返す。判断(STOP や提示)はスキル側が行い、
// このスクリプトは常に exit 0。
// 使い方: node find-chat-records.mjs [--dir <projectDir>] [--since YYYY-MM-DD] [--user <name>] [--latest [N]] [keyword...]
import fs from 'node:fs';
import path from 'node:path';

function output(obj) {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
}

const args = process.argv.slice(2);
let dir = process.cwd();
let since = null;
let user = null;
let latest = null;
const keywords = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dir') dir = args[++i] ?? dir;
  else if (a === '--since') since = args[++i] ?? '';
  else if (a === '--user') user = args[++i] ?? '';
  else if (a === '--latest') latest = /^\d+$/.test(args[i + 1] ?? '') ? Number(args[++i]) : 3;
  else keywords.push(a);
}
if (since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  output({ ok: false, error: `--since は YYYY-MM-DD 形式で指定してください: ${since}` });
}
if (latest === null && keywords.length === 0) {
  output({ ok: false, error: 'キーワードまたは --latest を指定してください' });
}

const chatDir = path.join(dir, 'docs', 'chat');
if (!fs.existsSync(chatDir)) {
  output({ ok: false, error: `docs/chat が存在しません: ${chatDir}` });
}

// 記録ファイルを再帰列挙し、パス構造 YYYY/MMDD/<user>/*.md から日付と作業者を読む。
// 旧構造 YYYY/MMDD/*.md は user: null。構造外のファイル(INDEX.md 等)は対象にしない
// このスクリプトは常に exit 0 で JSON を返す契約を負っているため、FS 呼び出しは
// すべて try/catch で守り、読めないエントリはクラッシュさせずスキップする
function walk(d) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return out; // 読めないディレクトリはスキップ
  }
  for (const e of entries) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const records = walk(chatDir)
  .map((abs) => {
    const rel = path.relative(chatDir, abs).replaceAll('\\', '/');
    const m = rel.match(/^(\d{4})\/(\d{4})\/(?:([^/]+)\/)?[^/]+\.md$/);
    if (!m) return null;
    return { path: rel, date: `${m[1]}-${m[2].slice(0, 2)}-${m[2].slice(2)}`, user: m[3] ?? null, abs };
  })
  .filter(Boolean);

// INDEX.md(1 ファイル 1 行の索引)。行形式: - `path` | date | user | 要旨
// 存在しても読めない(EACCES、ディレクトリ等)場合は存在しない扱いにして grep フォールバックする
const indexPath = path.join(chatDir, 'INDEX.md');
let indexLines = null;
if (fs.existsSync(indexPath)) {
  try {
    indexLines = fs.readFileSync(indexPath, 'utf8').split('\n').filter((l) => l.startsWith('- `'));
  } catch {
    indexLines = null;
  }
}
const indexedPaths = new Set((indexLines ?? []).map((l) => l.match(/^- `([^`]+)`/)?.[1]).filter(Boolean));
const unindexed = records.filter((r) => !indexedPaths.has(r.path)).map((r) => r.path);

const inScope = (r) => (!user || r.user === user) && (!since || r.date >= since);
// 読めないファイル(削除された・権限がない等)はタイトル無し/mtime 0 扱いにしてスキップする
const titleFromContent = (content) => content.match(/^# (.+)$/m)?.[1] ?? null;
const title = (abs) => {
  try {
    return titleFromContent(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
};
const mtimeOf = (abs) => {
  try {
    return fs.statSync(abs).mtimeMs;
  } catch {
    return 0;
  }
};

if (latest !== null) {
  const hits = records
    .filter(inScope)
    .sort((a, b) => b.date.localeCompare(a.date) || mtimeOf(b.abs) - mtimeOf(a.abs))
    .slice(0, latest)
    .map((r) => ({ path: r.path, date: r.date, user: r.user, title: title(r.abs) }));
  output({ ok: true, mode: 'latest', hits, unindexed });
}

const kw = keywords.map((k) => k.toLowerCase());
const hasKw = (text) => kw.some((k) => text.toLowerCase().includes(k)); // 複数キーワードは OR

if (indexLines) {
  const byPath = new Map(records.map((r) => [r.path, r]));
  const hits = [];
  for (const line of indexLines) {
    const p = line.match(/^- `([^`]+)`/)?.[1];
    const r = p ? byPath.get(p) : null;
    if (!r || !inScope(r) || !hasKw(line)) continue;
    const summary = line.split(' | ')[3]?.trim() ?? null;
    hits.push({ path: r.path, date: r.date, user: r.user, title: summary, matches: [line] });
  }
  output({ ok: true, mode: 'index', hits, unindexed });
}

// grep モード: 各ファイルのキーワード一致行を前後 1 行の文脈付きで返す(1 ファイル最大 5 箇所)
const hits = [];
for (const r of records.filter(inScope)) {
  let content;
  try {
    content = fs.readFileSync(r.abs, 'utf8');
  } catch {
    continue; // 読めないファイルはスキップ(exit 0 を保つ)
  }
  const lines = content.split('\n');
  const found = [];
  for (let i = 0; i < lines.length && found.length < 5; i++) {
    if (!hasKw(lines[i])) continue;
    found.push(lines.slice(Math.max(0, i - 1), i + 2).join('\n'));
  }
  if (found.length) {
    hits.push({ path: r.path, date: r.date, user: r.user, title: titleFromContent(content), matches: found });
  }
}
output({ ok: true, mode: 'grep', hits, unindexed });
