#!/usr/bin/env node

// src/morph-runtime.ts
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// src/lib/archive.ts
import zlib from "node:zlib";
var BLOCK = 512;
function cString(buf, start, length) {
  const field = buf.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}
function extractTarEntry(tgz, name) {
  const tar = zlib.gunzipSync(tgz);
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) return null;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++)
      sum += i >= 148 && i < 156 ? 32 : header[i];
    if (Number.parseInt(cString(header, 148, 8).trim(), 8) !== sum) {
      throw new Error(`tar \u306E\u30D8\u30C3\u30C0\u306E\u30C1\u30A7\u30C3\u30AF\u30B5\u30E0\u304C\u5408\u308F\u306A\u3044(\u4F4D\u7F6E ${offset})`);
    }
    const size = Number.parseInt(cString(header, 124, 12).trim() || "0", 8);
    const dataStart = offset + BLOCK;
    if (Number.isNaN(size) || dataStart + size > tar.length) {
      throw new Error(`tar \u306E\u9805\u76EE\u306E\u30B5\u30A4\u30BA\u304C\u4E0D\u6B63(\u4F4D\u7F6E ${offset})`);
    }
    const prefix = cString(header, 345, 155);
    const base = cString(header, 0, 100);
    const entryName = prefix ? `${prefix}/${base}` : base;
    const type = header[156];
    if (entryName === name && (type === 48 || type === 0)) {
      return Buffer.from(tar.subarray(dataStart, dataStart + size));
    }
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error("tar \u306E\u7D42\u7AEF\u30D6\u30ED\u30C3\u30AF\u304C\u7121\u3044");
}
function isUnsafe(entryName) {
  return entryName.startsWith("/") || entryName.includes("\\") || /^[A-Za-z]:/.test(entryName) || entryName.split("/").includes("..");
}
function extractZipEntries(zip, prefix, names) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 101010256) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("zip \u306E\u7D42\u7AEF\u30EC\u30B3\u30FC\u30C9\u304C\u898B\u3064\u304B\u3089\u306A\u3044");
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const wanted = new Set(names);
  const out = /* @__PURE__ */ new Map();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 33639248) {
      throw new Error(
        `zip \u306E\u30BB\u30F3\u30C8\u30E9\u30EB\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u304C\u58CA\u308C\u3066\u3044\u308B(\u4F4D\u7F6E ${offset})`
      );
    }
    const method = zip.readUInt16LE(offset + 10);
    const compSize = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const entryName = zip.toString("utf8", offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;
    if (isUnsafe(entryName) || !entryName.startsWith(prefix)) continue;
    const rest = entryName.slice(prefix.length);
    if (rest.includes("/") || !wanted.has(rest)) continue;
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 67324752) {
      throw new Error(`zip \u306E\u30ED\u30FC\u30AB\u30EB\u30D8\u30C3\u30C0\u304C\u58CA\u308C\u3066\u3044\u308B: ${entryName}`);
    }
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    if (dataStart + compSize > zip.length) {
      throw new Error(`zip \u306E\u9805\u76EE\u304C\u9014\u4E2D\u3067\u5207\u308C\u3066\u3044\u308B: ${entryName}`);
    }
    const data = zip.subarray(dataStart, dataStart + compSize);
    let body;
    if (method === 0) body = Buffer.from(data);
    else if (method === 8) body = zlib.inflateRawSync(data);
    else
      throw new Error(
        `zip \u306E\u5727\u7E2E\u65B9\u5F0F ${method} \u306B\u306F\u5BFE\u5FDC\u3057\u3066\u3044\u306A\u3044: ${entryName}`
      );
    if (body.length !== size) {
      throw new Error(`zip \u306E\u9805\u76EE\u306E\u5C55\u958B\u5F8C\u306E\u30B5\u30A4\u30BA\u304C\u5408\u308F\u306A\u3044: ${entryName}`);
    }
    out.set(rest, body);
  }
  return out;
}

// src/morph-runtime.ts
var VERSION = "6.2.0";
var INSTALL_DIR = `lindera-${VERSION}`;
var DICT_DIR = "ipadic";
var DICT_PREFIX = "lindera-ipadic/";
var DICT_FILES = [
  "NOTICE.txt",
  "metadata.json",
  "dict.trie",
  "dict.wordsidx",
  "char_def.bin",
  "matrix.mtx",
  "dict.vals",
  "unk.bin",
  "dict.valsidx",
  "dict.words"
];
var LOCK_TTL_MS = 10 * 6e4;
var FAILED_TTL_MS = 24 * 60 * 6e4;
var FETCH_TIMEOUT_MS = 12e4;
var SOURCES = {
  node: {
    "linux-x64-gnu": {
      url: "https://registry.npmjs.org/lindera-linux-x64-gnu/-/lindera-linux-x64-gnu-6.2.0.tgz",
      path: "package/lindera.linux-x64-gnu.node",
      sha256: "ad2be9b1298c7e4596e241f5bcfbab85b826d68e60cc5c52355ddb1c6bf77f37"
    },
    "linux-arm64-gnu": {
      url: "https://registry.npmjs.org/lindera-linux-arm64-gnu/-/lindera-linux-arm64-gnu-6.2.0.tgz",
      path: "package/lindera.linux-arm64-gnu.node",
      sha256: "f908b9a3e1a08d6263c6ccdf008597a7c4901d8e06339300da0dc19524e0a629"
    },
    "darwin-x64": {
      url: "https://registry.npmjs.org/lindera-darwin-x64/-/lindera-darwin-x64-6.2.0.tgz",
      path: "package/lindera.darwin-x64.node",
      sha256: "ef2a93bab4529fbb4aa0c225b802a90033d586fe24a82aa384f8b4df08fcd0b5"
    },
    "darwin-arm64": {
      url: "https://registry.npmjs.org/lindera-darwin-arm64/-/lindera-darwin-arm64-6.2.0.tgz",
      path: "package/lindera.darwin-arm64.node",
      sha256: "82b92172f70a6335505b8057d6ee989d8d6b3073b0a4f1a1e718da2faaf849b2"
    },
    "win32-x64-msvc": {
      url: "https://registry.npmjs.org/lindera-win32-x64-msvc/-/lindera-win32-x64-msvc-6.2.0.tgz",
      path: "package/lindera.win32-x64-msvc.node",
      sha256: "f963a9512a77c98b37a76ac27caeae6d90da6bb5fd0a517281c873dd800cc8dc"
    },
    "win32-arm64-msvc": {
      url: "https://registry.npmjs.org/lindera-win32-arm64-msvc/-/lindera-win32-arm64-msvc-6.2.0.tgz",
      path: "package/lindera.win32-arm64-msvc.node",
      sha256: "4e3e790876bc32fea1a4b13a6588315dccf9be5c933d429bf5d2e9c135da7017"
    }
  },
  dict: {
    url: "https://github.com/lindera/lindera/releases/download/v6.2.0/lindera-ipadic-6.2.0.zip",
    sha256: "5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72"
  }
};
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
function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
async function download(url, expected) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`${url} \u306E\u53D6\u5F97\u304C HTTP ${res.status} \u3067\u5931\u6557\u3057\u305F`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== expected) throw new Error(`${url} \u306E sha256 \u304C\u5408\u308F\u306A\u3044`);
  return buf;
}
async function installMorph(opts) {
  const morph = path.join(opts.dataDir, "morph");
  fs.mkdirSync(morph, { recursive: true });
  const lock = path.join(morph, "fetch.lock");
  if (fs.existsSync(lock) && !isFresh(lock, LOCK_TTL_MS))
    fs.rmSync(lock, { force: true });
  try {
    fs.closeSync(fs.openSync(lock, "wx"));
  } catch {
    return;
  }
  const dir = path.join(morph, INSTALL_DIR);
  const tmp = path.join(morph, `${INSTALL_DIR}.tmp-${process.pid}`);
  try {
    if (fs.existsSync(path.join(dir, "ready.json"))) return;
    const node = opts.sources.node[opts.target];
    if (!node) throw new Error(`target ${opts.target} \u306E .node \u304C\u7121\u3044`);
    const [tgz, zip] = await Promise.all([
      download(node.url, node.sha256),
      download(opts.sources.dict.url, opts.sources.dict.sha256)
    ]);
    const nodeName = path.posix.basename(node.path);
    const nodeBody = extractTarEntry(tgz, node.path);
    if (!nodeBody) throw new Error(`tarball \u306B ${node.path} \u304C\u7121\u3044`);
    const dict = extractZipEntries(zip, DICT_PREFIX, DICT_FILES);
    const missing = DICT_FILES.filter((f) => !dict.has(f));
    if (missing.length > 0)
      throw new Error(`\u8F9E\u66F8\u306E zip \u306B ${missing.join(", ")} \u304C\u7121\u3044`);
    const files = /* @__PURE__ */ new Map([[nodeName, nodeBody]]);
    for (const [name, body] of dict) files.set(`${DICT_DIR}/${name}`, body);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmp, DICT_DIR), { recursive: true });
    for (const [rel, body] of files) fs.writeFileSync(path.join(tmp, rel), body);
    for (const [rel, body] of files) {
      if (sha256(fs.readFileSync(path.join(tmp, rel))) !== sha256(body))
        throw new Error(`\u66F8\u304D\u8FBC\u3093\u3060 ${rel} \u306E sha256 \u304C\u5408\u308F\u306A\u3044`);
    }
    if (!fs.existsSync(path.join(dir, "ready.json")))
      fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
    const ready = {
      version: VERSION,
      target: opts.target,
      node: nodeName,
      dict: DICT_DIR,
      files: {}
    };
    for (const rel of files.keys()) {
      const st = fs.statSync(path.join(dir, rel));
      ready.files[rel] = { size: st.size, mtimeMs: st.mtimeMs };
    }
    const readyTmp = path.join(dir, `ready.json.tmp-${process.pid}`);
    fs.writeFileSync(readyTmp, `${JSON.stringify(ready, null, 2)}
`);
    fs.renameSync(readyTmp, path.join(dir, "ready.json"));
    for (const entry of fs.readdirSync(morph)) {
      if (entry.startsWith("lindera-") && entry !== INSTALL_DIR)
        fs.rmSync(path.join(morph, entry), { recursive: true, force: true });
    }
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(
      path.join(morph, "fetch-failed.json"),
      `${JSON.stringify({
        time: (/* @__PURE__ */ new Date()).toISOString(),
        reason: error instanceof Error ? error.message : String(error)
      })}
`
    );
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

// src/fetch-morph.ts
var dataDir = process.env.CLAUDE_PLUGIN_DATA;
var target = resolveTarget();
if (dataDir && target) {
  await installMorph({ dataDir, target, sources: SOURCES }).catch(() => {
  });
}
