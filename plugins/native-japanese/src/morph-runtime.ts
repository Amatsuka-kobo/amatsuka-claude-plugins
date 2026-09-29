// 形態素解析の取得物(lindera の .node と IPADIC の辞書)の置き場所の解決、取得の起動、
// 読み込み、取得と展開の本体を持つ。取得を起動するときに
// ../scripts/fetch-morph.mjs を import.meta.url から解決するので、src/ の直下に置く。
// npm の lindera パッケージは ESM へバンドルできないので import しない(GOTCHA-004)。

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { extractTarEntry, extractZipEntries } from "./lib/archive.js"
import type { Analyzer } from "./lib/lint.js"

const VERSION = "6.2.0"
const INSTALL_DIR = `lindera-${VERSION}`
const DICT_DIR = "ipadic"
const DICT_PREFIX = "lindera-ipadic/"
// 実物の lindera-ipadic-6.2.0.zip の lindera-ipadic/ の直下にある 10 ファイル
const DICT_FILES = [
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
]
const LOCK_TTL_MS = 10 * 60_000
const FAILED_TTL_MS = 24 * 60 * 60_000
const FETCH_TIMEOUT_MS = 120_000

export interface Sources {
  node: Record<string, { url: string; path: string; sha256: string }>
  dict: { url: string; sha256: string }
}

// target ごとの .node のパスは、組み立てずに tarball の中の実際の値をそのまま持つ
export const SOURCES: Sources = {
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
}

interface Ready {
  version: string
  target: string
  node: string
  dict: string
  files: Record<string, { size: number; mtimeMs: number }>
}

// Linux は glibc のときだけ対応する。glibc の版が取れなければ musl か判定できないので null。
export function resolveTarget(): string | null {
  const key = `${process.platform}-${process.arch}`
  if (process.platform === "linux") {
    // excludeNetwork は @types/node の型に無いが、node 22.13 以降で効く
    ;(process.report as { excludeNetwork?: boolean }).excludeNetwork = true
    const report = process.report.getReport() as {
      header?: { glibcVersionRuntime?: string }
    }
    if (!report.header?.glibcVersionRuntime) return null
    return key === "linux-x64" || key === "linux-arm64" ? `${key}-gnu` : null
  }
  if (key === "win32-x64" || key === "win32-arm64") return `${key}-msvc`
  if (key === "darwin-x64" || key === "darwin-arm64") return key
  return null
}

function isFresh(file: string, ttlMs: number): boolean {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < ttlMs
  } catch {
    return false
  }
}

// ready.json のサイズと mtime が実物と 1 つでも合わなければ ready.json を消し、
// 次の SessionStart で取得をやり直させる。sha256 は取得の直後にだけ照合する。
export function loadAnalyzer(dataDir: string | undefined): Analyzer | null {
  if (!dataDir) return null
  const dir = path.join(dataDir, "morph", INSTALL_DIR)
  const readyFile = path.join(dir, "ready.json")
  try {
    if (!fs.existsSync(readyFile)) return null
    const ready = JSON.parse(fs.readFileSync(readyFile, "utf8")) as Ready
    const intact = Object.entries(ready.files).every(([rel, rec]) => {
      try {
        const st = fs.statSync(path.join(dir, rel))
        return st.size === rec.size && st.mtimeMs === rec.mtimeMs
      } catch {
        return false
      }
    })
    if (!intact) {
      fs.rmSync(readyFile, { force: true })
      return null
    }
    const lindera = createRequire(import.meta.url)(
      path.join(dir, ready.node)
    ) as {
      loadDictionary(dir: string): unknown
      Tokenizer: new (dict: unknown, mode: string) => Analyzer
    }
    return new lindera.Tokenizer(
      lindera.loadDictionary(path.join(dir, ready.dict)),
      "normal"
    )
  } catch {
    return null
  }
}

// 取得を切り離した子プロセスに任せ、終わりを待たない。
export function maybeStartFetch(env: NodeJS.ProcessEnv): void {
  const dataDir = env.CLAUDE_PLUGIN_DATA
  if (!dataDir) return
  if (
    env.AMATSUKA_NATIVE_JAPANESE_MORPH === "off" ||
    env.AMATSUKA_NATIVE_JAPANESE_CHECK === "off"
  )
    return
  if (resolveTarget() === null) return
  const morph = path.join(dataDir, "morph")
  if (fs.existsSync(path.join(morph, INSTALL_DIR, "ready.json"))) return
  if (isFresh(path.join(morph, "fetch.lock"), LOCK_TTL_MS)) return
  if (isFresh(path.join(morph, "fetch-failed.json"), FAILED_TTL_MS)) return

  const script = fileURLToPath(
    new URL("../scripts/fetch-morph.mjs", import.meta.url)
  )
  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env
  })
  child.on("error", () => {})
  child.unref()
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

async function download(url: string, expected: string): Promise<Buffer> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`${url} の取得が HTTP ${res.status} で失敗した`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (sha256(buf) !== expected) throw new Error(`${url} の sha256 が合わない`)
  return buf
}

// 一時ディレクトリに展開して照合し、rename で置き換える。ready.json は最後に置くので、
// ready.json がある時点で取得物はそろっている。失敗したら取得物を残さない。
export async function installMorph(opts: {
  dataDir: string
  target: string
  sources: Sources
}): Promise<void> {
  const morph = path.join(opts.dataDir, "morph")
  fs.mkdirSync(morph, { recursive: true })
  const lock = path.join(morph, "fetch.lock")
  if (fs.existsSync(lock) && !isFresh(lock, LOCK_TTL_MS))
    fs.rmSync(lock, { force: true })
  try {
    fs.closeSync(fs.openSync(lock, "wx"))
  } catch {
    return // 別のプロセスが取得中
  }

  const dir = path.join(morph, INSTALL_DIR)
  const tmp = path.join(morph, `${INSTALL_DIR}.tmp-${process.pid}`)
  try {
    if (fs.existsSync(path.join(dir, "ready.json"))) return
    const node = opts.sources.node[opts.target]
    if (!node) throw new Error(`target ${opts.target} の .node が無い`)
    const [tgz, zip] = await Promise.all([
      download(node.url, node.sha256),
      download(opts.sources.dict.url, opts.sources.dict.sha256)
    ])

    const nodeName = path.posix.basename(node.path)
    const nodeBody = extractTarEntry(tgz, node.path)
    if (!nodeBody) throw new Error(`tarball に ${node.path} が無い`)
    const dict = extractZipEntries(zip, DICT_PREFIX, DICT_FILES)
    const missing = DICT_FILES.filter((f) => !dict.has(f))
    if (missing.length > 0)
      throw new Error(`辞書の zip に ${missing.join(", ")} が無い`)
    const files = new Map<string, Buffer>([[nodeName, nodeBody]])
    for (const [name, body] of dict) files.set(`${DICT_DIR}/${name}`, body)

    fs.rmSync(tmp, { recursive: true, force: true })
    fs.mkdirSync(path.join(tmp, DICT_DIR), { recursive: true })
    for (const [rel, body] of files) fs.writeFileSync(path.join(tmp, rel), body)
    for (const [rel, body] of files) {
      if (sha256(fs.readFileSync(path.join(tmp, rel))) !== sha256(body))
        throw new Error(`書き込んだ ${rel} の sha256 が合わない`)
    }

    // ready.json の無いディレクトリは、途中で止まった展開の残り
    if (!fs.existsSync(path.join(dir, "ready.json")))
      fs.rmSync(dir, { recursive: true, force: true })
    fs.renameSync(tmp, dir)

    const ready: Ready = {
      version: VERSION,
      target: opts.target,
      node: nodeName,
      dict: DICT_DIR,
      files: {}
    }
    for (const rel of files.keys()) {
      const st = fs.statSync(path.join(dir, rel))
      ready.files[rel] = { size: st.size, mtimeMs: st.mtimeMs }
    }
    const readyTmp = path.join(dir, `ready.json.tmp-${process.pid}`)
    fs.writeFileSync(readyTmp, `${JSON.stringify(ready, null, 2)}\n`)
    fs.renameSync(readyTmp, path.join(dir, "ready.json"))

    for (const entry of fs.readdirSync(morph)) {
      if (entry.startsWith("lindera-") && entry !== INSTALL_DIR)
        fs.rmSync(path.join(morph, entry), { recursive: true, force: true })
    }
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.writeFileSync(
      path.join(morph, "fetch-failed.json"),
      `${JSON.stringify({
        time: new Date().toISOString(),
        reason: error instanceof Error ? error.message : String(error)
      })}\n`
    )
  } finally {
    fs.rmSync(lock, { force: true })
  }
}
