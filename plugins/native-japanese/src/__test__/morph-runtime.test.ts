import { createHash } from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest"

const spawn = vi.hoisted(() => vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })))
vi.mock("node:child_process", () => ({ spawn }))

const { installMorph, loadAnalyzer, maybeStartFetch, resolveTarget, SOURCES } =
  await import("../morph-runtime.js")

const TGZ = fs.readFileSync(
  new URL("../fixtures/archive/pkg.tgz", import.meta.url)
)
const ZIP = fs.readFileSync(
  new URL("../fixtures/archive/ipadic.zip", import.meta.url)
)
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
const TARGET = "linux-x64-gnu"
const MINUTE = 60_000

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

// 固定データだけを返すローカルの HTTP サーバー。取得の回数を数える。
let server: http.Server
let base: string
let requests = 0
beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests++
    const body =
      req.url === "/pkg.tgz" ? TGZ : req.url === "/ipadic.zip" ? ZIP : null
    res.statusCode = body ? 200 : 404
    res.end(body ?? "")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

function sources(
  over: { nodeSha?: string; dictSha?: string; dictUrl?: string } = {}
): typeof SOURCES {
  return {
    node: {
      [TARGET]: {
        url: `${base}/pkg.tgz`,
        path: "package/a.node",
        sha256: over.nodeSha ?? sha256(TGZ)
      }
    },
    dict: {
      url: over.dictUrl ?? `${base}/ipadic.zip`,
      sha256: over.dictSha ?? sha256(ZIP)
    }
  }
}

const dirs: string[] = []
function tmpData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nj-morph-"))
  dirs.push(dir)
  return dir
}

const platformDesc = Object.getOwnPropertyDescriptor(process, "platform")
const archDesc = Object.getOwnPropertyDescriptor(process, "arch")
afterEach(() => {
  if (platformDesc) Object.defineProperty(process, "platform", platformDesc)
  if (archDesc) Object.defineProperty(process, "arch", archDesc)
  vi.restoreAllMocks()
  spawn.mockClear()
  requests = 0
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true })
})

function stubPlatform(
  platform: string,
  arch: string,
  glibc?: string
): ReturnType<typeof vi.spyOn> {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true
  })
  Object.defineProperty(process, "arch", { value: arch, configurable: true })
  return vi.spyOn(process.report, "getReport").mockReturnValue({
    header: glibc ? { glibcVersionRuntime: glibc } : {}
  } as never)
}

const morphDir = (data: string) => path.join(data, "morph")
const installDir = (data: string) => path.join(data, "morph", "lindera-6.2.0")
const readyPath = (data: string) => path.join(installDir(data), "ready.json")

// --- SOURCES

test("SOURCES は 6 種の .node と IPADIC の zip だけを持つ", () => {
  expect(Object.keys(SOURCES.node).sort()).toEqual([
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64-gnu",
    "linux-x64-gnu",
    "win32-arm64-msvc",
    "win32-x64-msvc"
  ])
  expect(SOURCES.node["linux-x64-gnu"]).toEqual({
    url: "https://registry.npmjs.org/lindera-linux-x64-gnu/-/lindera-linux-x64-gnu-6.2.0.tgz",
    path: "package/lindera.linux-x64-gnu.node",
    sha256: "ad2be9b1298c7e4596e241f5bcfbab85b826d68e60cc5c52355ddb1c6bf77f37"
  })
  expect(SOURCES.dict).toEqual({
    url: "https://github.com/lindera/lindera/releases/download/v6.2.0/lindera-ipadic-6.2.0.zip",
    sha256: "5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72"
  })
})

// --- resolveTarget

test.each([
  ["linux", "x64", "2.39", "linux-x64-gnu"],
  ["linux", "arm64", "2.39", "linux-arm64-gnu"],
  ["darwin", "x64", undefined, "darwin-x64"],
  ["darwin", "arm64", undefined, "darwin-arm64"],
  ["win32", "x64", undefined, "win32-x64-msvc"],
  ["win32", "arm64", undefined, "win32-arm64-msvc"],
  ["linux", "x64", undefined, null],
  ["linux", "ia32", "2.39", null],
  ["freebsd", "x64", undefined, null],
  ["darwin", "ppc64", undefined, null]
])("%s-%s(glibc %s)の target は %s", (platform, arch, glibc, expected) => {
  stubPlatform(platform, arch, glibc)
  expect(resolveTarget()).toBe(expected)
})

test("Linux で glibc を調べる前に、報告からネットワークの情報を外す", () => {
  const spy = stubPlatform("linux", "x64", "2.39")
  spy.mockImplementation(() => {
    expect(
      (process.report as { excludeNetwork?: boolean }).excludeNetwork
    ).toBe(true)
    return { header: { glibcVersionRuntime: "2.39" } } as never
  })
  expect(resolveTarget()).toBe("linux-x64-gnu")
  expect(spy).toHaveBeenCalled()
})

// --- maybeStartFetch

function env(data: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: data, ...extra }
}

function touch(file: string, ageMs = 0): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, "{}")
  const t = new Date(Date.now() - ageMs)
  fs.utimesSync(file, t, t)
}

test("条件に当たらなければ fetch-morph.mjs を切り離して起動する", () => {
  stubPlatform("linux", "x64", "2.39")
  const data = tmpData()
  maybeStartFetch(env(data))
  expect(spawn).toHaveBeenCalledTimes(1)
  const [cmd, args, opts] = spawn.mock.calls[0] as unknown as [
    string,
    string[],
    Record<string, unknown>
  ]
  expect(cmd).toBe(process.execPath)
  expect(args).toHaveLength(1)
  expect(args[0].split(path.sep).slice(-2)).toEqual([
    "scripts",
    "fetch-morph.mjs"
  ])
  expect(opts).toMatchObject({
    detached: true,
    stdio: "ignore",
    windowsHide: true
  })
  expect((opts.env as NodeJS.ProcessEnv).CLAUDE_PLUGIN_DATA).toBe(data)
  const child = spawn.mock.results[0].value as {
    unref: ReturnType<typeof vi.fn>
  }
  expect(child.unref).toHaveBeenCalled()
})

test.each([
  ["CLAUDE_PLUGIN_DATA が無い", () => ({ PATH: process.env.PATH })],
  [
    "AMATSUKA_NATIVE_JAPANESE_MORPH=off",
    (d: string) => env(d, { AMATSUKA_NATIVE_JAPANESE_MORPH: "off" })
  ],
  [
    "AMATSUKA_NATIVE_JAPANESE_CHECK=off",
    (d: string) => env(d, { AMATSUKA_NATIVE_JAPANESE_CHECK: "off" })
  ],
  [
    "ready.json がある",
    (d: string) => {
      touch(readyPath(d))
      return env(d)
    }
  ],
  [
    "10 分以内の fetch.lock がある",
    (d: string) => {
      touch(path.join(morphDir(d), "fetch.lock"), 9 * MINUTE)
      return env(d)
    }
  ],
  [
    "24 時間以内の fetch-failed.json がある",
    (d: string) => {
      touch(path.join(morphDir(d), "fetch-failed.json"), 23 * 60 * MINUTE)
      return env(d)
    }
  ]
])("%s なら起動しない", (_, makeEnv) => {
  stubPlatform("linux", "x64", "2.39")
  maybeStartFetch(makeEnv(tmpData()))
  expect(spawn).not.toHaveBeenCalled()
})

test("古い fetch.lock と古い fetch-failed.json では起動する", () => {
  stubPlatform("linux", "x64", "2.39")
  const data = tmpData()
  touch(path.join(morphDir(data), "fetch.lock"), 11 * MINUTE)
  touch(path.join(morphDir(data), "fetch-failed.json"), 25 * 60 * MINUTE)
  maybeStartFetch(env(data))
  expect(spawn).toHaveBeenCalledTimes(1)
})

test.each([
  ["musl か判定できない Linux", "linux", "x64", undefined],
  ["6 種に無い組", "freebsd", "x64", undefined]
])("%s では起動せず、fetch-failed.json も書かない", (_, platform, arch, glibc) => {
  stubPlatform(platform, arch, glibc)
  const data = tmpData()
  maybeStartFetch(env(data))
  expect(spawn).not.toHaveBeenCalled()
  expect(fs.existsSync(path.join(morphDir(data), "fetch-failed.json"))).toBe(
    false
  )
})

// --- installMorph

async function install(data: string, src = sources()): Promise<void> {
  await installMorph({ dataDir: data, target: TARGET, sources: src })
}

test("取得して展開し、ready.json を最後に置く", async () => {
  const data = tmpData()
  await install(data)
  expect(requests).toBe(2)
  const dir = installDir(data)
  expect(fs.readFileSync(path.join(dir, "a.node"), "utf8")).toBe(
    "lindera native addon stub\n".repeat(12)
  )
  expect(fs.readdirSync(path.join(dir, "ipadic")).sort()).toEqual(
    [...DICT_FILES].sort()
  )
  expect(fs.readdirSync(morphDir(data)).sort()).toEqual(["lindera-6.2.0"])
  // ready.json は他の 11 ファイルより後に書かれている
  const readyTime = fs.statSync(readyPath(data)).mtimeMs
  expect(
    fs.statSync(path.join(dir, "ipadic", "dict.words")).mtimeMs
  ).toBeLessThanOrEqual(readyTime)
})

test("展開後の ipadic/NOTICE.txt がある", async () => {
  const data = tmpData()
  await install(data)
  expect(
    fs.readFileSync(path.join(installDir(data), "ipadic", "NOTICE.txt"), "utf8")
  ).toBe("NOTICE.txt stub\n".repeat(4))
})

test("ready.json に 11 ファイルのサイズと mtime を記録する", async () => {
  const data = tmpData()
  await install(data)
  const ready = JSON.parse(fs.readFileSync(readyPath(data), "utf8")) as {
    version: string
    target: string
    node: string
    dict: string
    files: Record<string, { size: number; mtimeMs: number }>
  }
  expect(ready).toMatchObject({
    version: "6.2.0",
    target: TARGET,
    node: "a.node",
    dict: "ipadic"
  })
  expect(Object.keys(ready.files).sort()).toEqual(
    ["a.node", ...DICT_FILES.map((f) => `ipadic/${f}`)].sort()
  )
  for (const [rel, rec] of Object.entries(ready.files)) {
    const st = fs.statSync(path.join(installDir(data), rel))
    expect(rec).toEqual({ size: st.size, mtimeMs: st.mtimeMs })
  }
})

test.each([
  ["tarball", { nodeSha: "0".repeat(64) }],
  ["辞書の zip", { dictSha: "0".repeat(64) }]
])("%s の sha256 が合わなければ何も残さず fetch-failed.json を書く", async (_, over) => {
  const data = tmpData()
  await install(data, sources(over))
  expect(fs.readdirSync(morphDir(data)).sort()).toEqual(["fetch-failed.json"])
  const failed = JSON.parse(
    fs.readFileSync(path.join(morphDir(data), "fetch-failed.json"), "utf8")
  ) as { time: string; reason: string }
  expect(Number.isNaN(Date.parse(failed.time))).toBe(false)
  expect(failed.reason).toContain("sha256")
})

test("HTTP のエラーでも何も残さず fetch-failed.json を書く", async () => {
  const data = tmpData()
  await install(data, sources({ dictUrl: `${base}/missing.zip` }))
  expect(fs.readdirSync(morphDir(data)).sort()).toEqual(["fetch-failed.json"])
})

test("target に対応する .node が無ければ失敗として扱う", async () => {
  const data = tmpData()
  await installMorph({
    dataDir: data,
    target: "darwin-arm64",
    sources: sources()
  })
  expect(requests).toBe(0)
  expect(fs.readdirSync(morphDir(data)).sort()).toEqual(["fetch-failed.json"])
})

test("新しい fetch.lock があると取得せず、lock も消さない", async () => {
  const data = tmpData()
  const lock = path.join(morphDir(data), "fetch.lock")
  touch(lock, 9 * MINUTE)
  await install(data)
  expect(requests).toBe(0)
  expect(fs.existsSync(lock)).toBe(true)
  expect(fs.existsSync(installDir(data))).toBe(false)
})

test("10 分より古い fetch.lock は消して取得し、終わったら lock を消す", async () => {
  const data = tmpData()
  const lock = path.join(morphDir(data), "fetch.lock")
  touch(lock, 11 * MINUTE)
  await install(data)
  expect(fs.existsSync(readyPath(data))).toBe(true)
  expect(fs.existsSync(lock)).toBe(false)
})

test("ready.json の無い同名のディレクトリを消してから置き換える", async () => {
  const data = tmpData()
  touch(path.join(installDir(data), "leftover.bin"))
  await install(data)
  expect(fs.existsSync(path.join(installDir(data), "leftover.bin"))).toBe(false)
  expect(fs.existsSync(readyPath(data))).toBe(true)
})

test("別のバージョンのディレクトリと一時ディレクトリの残りを消す", async () => {
  const data = tmpData()
  touch(path.join(morphDir(data), "lindera-6.1.0", "ready.json"))
  touch(path.join(morphDir(data), "lindera-6.2.0.tmp-99999", "a.node"))
  await install(data)
  expect(fs.readdirSync(morphDir(data)).sort()).toEqual(["lindera-6.2.0"])
})

// --- loadAnalyzer

test("dataDir が無いか ready.json が無いと null", () => {
  expect(loadAnalyzer(undefined)).toBeNull()
  expect(loadAnalyzer(tmpData())).toBeNull()
})

test("壊れた .node では null を返し、ready.json は残す", async () => {
  const data = tmpData()
  await install(data)
  expect(loadAnalyzer(data)).toBeNull()
  expect(fs.existsSync(readyPath(data))).toBe(true)
})

test("サイズが ready.json と合わなければ ready.json を消して null", async () => {
  const data = tmpData()
  await install(data)
  fs.appendFileSync(path.join(installDir(data), "ipadic", "dict.words"), "x")
  expect(loadAnalyzer(data)).toBeNull()
  expect(fs.existsSync(readyPath(data))).toBe(false)
})

test("mtime が ready.json と合わなければ ready.json を消して null", async () => {
  const data = tmpData()
  await install(data)
  const t = new Date(Date.now() - 5 * MINUTE)
  fs.utimesSync(path.join(installDir(data), "a.node"), t, t)
  expect(loadAnalyzer(data)).toBeNull()
  expect(fs.existsSync(readyPath(data))).toBe(false)
})

test("ファイルが消えていれば ready.json を消して null", async () => {
  const data = tmpData()
  await install(data)
  fs.rmSync(path.join(installDir(data), "ipadic", "NOTICE.txt"))
  expect(loadAnalyzer(data)).toBeNull()
  expect(fs.existsSync(readyPath(data))).toBe(false)
})
