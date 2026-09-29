import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defaultConfig } from "../defaults"
import {
  configCandidate,
  createConfigReloader,
  loadConfig,
  tryLoadConfig
} from "../loader"

let workDir: string
let originalCwd: string
let originalEnvValue: string | undefined

beforeEach(() => {
  workDir = realpathSync(mkdtempSync(join(tmpdir(), "raguel-loader-test-")))
  originalCwd = process.cwd()
  originalEnvValue = process.env.RAGUEL_CONFIG
  delete process.env.RAGUEL_CONFIG
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalEnvValue === undefined) {
    delete process.env.RAGUEL_CONFIG
  } else {
    process.env.RAGUEL_CONFIG = originalEnvValue
  }
  rmSync(workDir, { recursive: true, force: true })
})

/**
 * workDir 配下に、raguel の値と同じ形の JSON ファイルを書き、RAGUEL_CONFIG に設定してパスを返す。
 * 文字列はそのまま書く(壊れた JSON を試すため)。
 */
function useConfig(
  content: string | Record<string, unknown>,
  filename = "raguel.json"
): string {
  const path = join(workDir, filename)
  writeFileSync(
    path,
    typeof content === "string" ? content : JSON.stringify(content),
    "utf8"
  )
  process.env.RAGUEL_CONFIG = path
  return path
}

/** workDir(プロジェクトルート)に .codiel/config.json を書き、cwd を workDir にしてパスを返す */
function useProjectConfig(content: string | Record<string, unknown>): string {
  mkdirSync(join(workDir, ".codiel"), { recursive: true })
  const path = join(workDir, ".codiel", "config.json")
  writeFileSync(
    path,
    typeof content === "string" ? content : JSON.stringify(content),
    "utf8"
  )
  process.chdir(workDir)
  return path
}

/** raguel の値だけを RAGUEL_CONFIG で渡して読み込む */
function loadRaguel(raguel: Record<string, unknown>) {
  process.chdir(workDir)
  useConfig(raguel)
  return loadConfig()
}

function touchLater(path: string, offsetMs: number): void {
  const later = new Date(Date.now() + offsetMs)
  utimesSync(path, later, later)
}

describe("loadConfig - 読む順と configSource(R23)", () => {
  it("RAGUEL_CONFIG が指すパスを JSON として読み、source は env:<パス> になる", () => {
    const path = useConfig({ judge: { model: "sonnet" } })
    const loaded = loadConfig(workDir)
    expect(loaded.source).toBe(`env:${path}`)
    expect(loaded.config.judge.model).toBe("sonnet")
  })

  it("RAGUEL_CONFIG が無く、プロジェクトルートの config.json に raguel があればそれを使い、source は cwd:<絶対パス> になる", () => {
    const path = useProjectConfig({
      testsDir: "docs/codiel/tests",
      raguel: { judge: { model: "sonnet" } }
    })
    const loaded = loadConfig()
    expect(loaded.source).toBe(`cwd:${path}`)
    expect(loaded.config.judge.model).toBe("sonnet")
  })

  it("RAGUEL_CONFIG があればプロジェクトルートの config.json より優先する", () => {
    useProjectConfig({ raguel: { judge: { model: "sonnet" } } })
    const path = useConfig({ precedent: { topN: 3 } })
    const loaded = loadConfig()
    expect(loaded.source).toBe(`env:${path}`)
    expect(loaded.config.precedent.topN).toBe(3)
    expect(loaded.config.judge.model).toBeUndefined()
  })

  it("サブディレクトリの cwd からプロジェクトルートの config.json を見つける", () => {
    const path = useProjectConfig({ raguel: { judge: { model: "sonnet" } } })
    const sub = join(workDir, "src", "deep")
    mkdirSync(sub, { recursive: true })
    const loaded = loadConfig(sub)
    expect(loaded.source).toBe(`cwd:${path}`)
    expect(loaded.projectRoot).toBe(workDir)
    expect(loaded.config.judge.model).toBe("sonnet")
    expect(configCandidate(sub)).toEqual({ path, source: `cwd:${path}` })
  })

  it("config.json に raguel が無ければ内蔵の既定値で動き、source は defaults になる", () => {
    useProjectConfig({ testsDir: "docs/codiel/tests" })
    const loaded = loadConfig()
    expect(loaded.source).toBe("defaults")
    expect(loaded.config.judge).toEqual(defaultConfig.judge)
  })

  it("raguel.config.yaml だけがあっても読まず、source は defaults になる", () => {
    writeFileSync(
      join(workDir, "raguel.config.yaml"),
      "judge:\n  model: sonnet\n",
      "utf8"
    )
    const loaded = loadConfig(workDir)
    expect(loaded.source).toBe("defaults")
    expect(loaded.config.judge.model).toBeUndefined()
  })

  it("設定ファイルが一切無ければ内蔵の既定値だけを使う", () => {
    const loaded = loadConfig(workDir)
    expect(loaded.source).toBe("defaults")
    expect(loaded.config.judge.provider).toBe("claude")
    expect(loaded.config.judge.timeoutMs).toBe(180000)
    expect(loaded.config.judge.deadlineMs).toBe(600000)
    expect(loaded.config.judge.thresholds.confidence).toBe(70)
    expect(loaded.config.contextJudge.enabled).toBe(false)
  })

  it("RAGUEL_CONFIG が存在しないパスを指すときは既定値に落ちず throw する", () => {
    process.env.RAGUEL_CONFIG = join(workDir, "does-not-exist.json")
    expect(() => loadConfig(workDir)).toThrow()
  })

  it("config.json が JSON として読めないときは throw する", () => {
    useProjectConfig('{ "raguel": ')
    expect(() => loadConfig()).toThrow(/JSON/)
  })

  it.each([
    ["文字列", '"x"'],
    ["配列", "[]"],
    ["null", "null"]
  ])("config.json の raguel が%sのときは throw する", (_name, value) => {
    useProjectConfig(`{ "raguel": ${value} }`)
    expect(() => loadConfig()).toThrow(/raguel/)
  })

  it("RAGUEL_CONFIG が指すファイルが JSON として読めないときは throw する", () => {
    useConfig("judge:\n  model: sonnet\n")
    expect(() => loadConfig(workDir)).toThrow(/JSON/)
  })

  it("runsDir は検証しない(不正な値でも読み込める)", () => {
    useProjectConfig({ runsDir: "/abs/runs", raguel: {} })
    expect(() => loadConfig()).not.toThrow()
  })
})

describe("loadConfig - testsDir(R24)", () => {
  it("config.json かキーが無ければ既定の docs/codiel/tests を使う", () => {
    expect(loadConfig(workDir).testsDir).toBe("docs/codiel/tests")
    useProjectConfig({ raguel: {} })
    expect(loadConfig().testsDir).toBe("docs/codiel/tests")
  })

  it("RAGUEL_CONFIG を設定したときもプロジェクトルートの config.json から読む", () => {
    useProjectConfig({ testsDir: "./e2e-tests/" })
    useConfig({ precedent: { topN: 2 } })
    const loaded = loadConfig()
    expect(loaded.source.startsWith("env:")).toBe(true)
    expect(loaded.testsDir).toBe("e2e-tests")
  })

  it.each([
    ["文字列でない", 1],
    ["空", ""],
    ["絶対パス", "/abs/tests"],
    ["..", "../tests"]
  ])("testsDir が%sなら読み込みの失敗になる(RAGUEL_CONFIG のときも)", (_name, value) => {
    useProjectConfig({ testsDir: value, raguel: {} })
    expect(() => loadConfig()).toThrow(/testsDir/)
    useConfig({})
    expect(() => loadConfig()).toThrow(/testsDir/)
  })

  it("testsDir を書き換えると読み直し、新しい testsDir を返す", () => {
    const path = useProjectConfig({ testsDir: "a" })
    const current = createConfigReloader((loaded) => loaded)
    expect(current().testsDir).toBe("a")
    writeFileSync(path, JSON.stringify({ testsDir: "b" }), "utf8")
    touchLater(path, 10_000)
    expect(current().testsDir).toBe("b")
  })
})

describe("loadConfig - 厳格なスキーマ(A14)", () => {
  it("未知のトップレベルキーは読み込みエラー", () => {
    expect(() => loadRaguel({ unknownKey: true })).toThrow(/unknownKey/)
  })

  it("未知のネストしたキーは読み込みエラー", () => {
    expect(() => loadRaguel({ judge: { timeout: 1 } })).toThrow(/timeout/)
  })

  it("登録されていないルール ID は読み込みエラー", () => {
    expect(() => loadRaguel({ rules: { "code/no-such-rule": {} } })).toThrow(
      /code\/no-such-rule/
    )
  })

  it("ルールに無いパラメータは読み込みエラー", () => {
    expect(() =>
      loadRaguel({ rules: { "code/max-diff-lines": { limt: 10 } } })
    ).toThrow(/limt/)
  })

  it("パラメータの型が違えば読み込みエラー", () => {
    expect(() =>
      loadRaguel({ rules: { "code/max-diff-lines": { limit: "10" } } })
    ).toThrow(/limit/)
  })

  it.each([2, 0])("version: %s は読み込みエラー", (version) => {
    expect(() => loadRaguel({ version })).toThrow(/version/)
  })

  it.each([
    "STOP",
    "PROCEED"
  ])("onError: %s は読み込みエラー(ASK だけを受ける)", (onError) => {
    expect(() => loadRaguel({ onError })).toThrow(/onError/)
  })

  it('onError: "ASK" は受ける(M4 で写した設定を読み込める)', () => {
    expect(loadRaguel({ onError: "ASK" }).config.onError).toBe("ASK")
  })

  it.each([
    "jev",
    "claude-cli"
  ])("judge.provider: %s は読み込みエラー", (provider) => {
    expect(() => loadRaguel({ judge: { provider } })).toThrow(/provider/)
  })

  it("perPanelist のキーが adversarial・steelman・crosscheck・meta 以外なら読み込みエラー", () => {
    expect(() =>
      loadRaguel({ panel: { perPanelist: { assumption: { model: "x" } } } })
    ).toThrow(/assumption/)
  })

  it("perPanelist.<名前>.provider: none は読み込みエラー", () => {
    expect(() =>
      loadRaguel({
        panel: { perPanelist: { adversarial: { provider: "none" } } }
      })
    ).toThrow(/provider/)
  })

  it("perPanelist に codex を書ける", () => {
    const { config } = loadRaguel({
      panel: { perPanelist: { meta: { provider: "codex" } } }
    })
    expect(config.panel.perPanelist.meta?.provider).toBe("codex")
  })
})

describe("loadConfig - 廃止したキーとルール ID(C5 ほか)", () => {
  it.each([
    "trivial",
    "standard",
    "critical"
  ])("panel.%s は廃止を名指しする読み込みエラー", (tier) => {
    expect(() => loadRaguel({ panel: { [tier]: ["adversarial"] } })).toThrow(
      new RegExp(`panel\\.${tier} は廃止した`)
    )
  })

  it("judge の STOP の許可のキーは廃止を名指しする読み込みエラー", () => {
    // biome-ignore format: 廃止のキーと文言を同じ行に置く(廃止の文言の行だけに旧キーの名前を残す)
    expect(() => loadRaguel({ judge: { canStop: false } })).toThrow(/judge\.canStop は廃止した/)
  })

  it("common/resubmission-loop.stopAfter は廃止を名指しする読み込みエラー", () => {
    expect(() =>
      loadRaguel({ rules: { "common/resubmission-loop": { stopAfter: 3 } } })
    ).toThrow(/stopAfter は廃止した/)
  })

  it("code/dangerous-patterns は後継の 2 つを名指しする読み込みエラー", () => {
    expect(() =>
      loadRaguel({ rules: { "code/dangerous-patterns": {} } })
    ).toThrow(/code\/destructive-ops.*code\/unsafe-exec/)
  })
})

describe("loadConfig - 深いマージと和集合(E2)", () => {
  it("ネストしたオブジェクトは再帰でマージし、書かなかった兄弟は既定値を保つ", () => {
    const { config } = loadRaguel({ judge: { thresholds: { proceed: 55 } } })
    expect(config.judge.thresholds).toEqual({
      ...defaultConfig.judge.thresholds,
      proceed: 55
    })
    expect(config.judge.timeoutMs).toBe(defaultConfig.judge.timeoutMs)
  })

  it("和集合と宣言していない配列は利用者の値で置き換える", () => {
    const { config } = loadRaguel({
      rules: { "plan/irreversible-ops": { keywords: ["本番"] } }
    })
    expect(config.rules["plan/irreversible-ops"].keywords).toEqual(["本番"])
  })

  it.each([
    ["[]", []],
    ['["src/auth/**"]', ["src/auth/**"]]
  ])("code/protected-paths の globs が %s でも既定の 3 つの glob が残る", (globs, extra) => {
    process.chdir(workDir)
    useConfig(`{"rules":{"code/protected-paths":{"globs":${globs}}}}`)
    const { config } = loadConfig()
    expect(config.rules["code/protected-paths"].globs).toEqual([
      ".github/**",
      "infra/**",
      "**/*.env*",
      ...extra
    ])
  })

  it("common/secrets の allowPatterns は既定値との和集合になる(既定は空なので利用者の値が残る)", () => {
    const { config } = loadRaguel({
      rules: { "common/secrets": { allowPatterns: ["^example-token$"] } }
    })
    expect(config.rules["common/secrets"].allowPatterns).toEqual([
      "^example-token$"
    ])
  })

  it("ルールのパラメータを書かなければ表の既定値が入る", () => {
    const { config } = loadConfig(workDir)
    expect(config.rules["code/max-diff-lines"].limit).toBe(500)
    expect(config.rules["code/protected-paths"].generated).toEqual([])
  })
})

describe("loadConfig - 保護パスの既定の除外と生成物(R20)", () => {
  it("excludeDefaults に挙げた既定の glob が保護から外れる", () => {
    const { config } = loadRaguel({
      rules: {
        "code/protected-paths": { excludeDefaults: ["infra/**", ".github/**"] }
      }
    })
    expect(config.rules["code/protected-paths"].globs).toEqual(["**/*.env*"])
    expect(config.rules["code/protected-paths"].excludeDefaults).toEqual([
      "infra/**",
      ".github/**"
    ])
  })

  it("excludeDefaults で利用者が globs に書いた glob は外れない", () => {
    const { config } = loadRaguel({
      rules: {
        "code/protected-paths": {
          globs: ["infra/**", "src/auth/**"],
          excludeDefaults: ["infra/**"]
        }
      }
    })
    expect(config.rules["code/protected-paths"].globs).toEqual([
      ".github/**",
      "infra/**",
      "**/*.env*",
      "src/auth/**"
    ])
  })

  it("excludeDefaults に既定に無い文字列を書くと読み込みエラー", () => {
    expect(() =>
      loadRaguel({
        rules: { "code/protected-paths": { excludeDefaults: ["infra/*"] } }
      })
    ).toThrow(/excludeDefaults/)
  })

  it.each([
    "**/*",
    "*.js",
    "**"
  ])("generated に固定部の無い glob(%s)を書くと読み込みエラー", (glob) => {
    expect(() =>
      loadRaguel({ rules: { "code/protected-paths": { generated: [glob] } } })
    ).toThrow(/generated/)
  })

  it("generated は和集合を取らず、固定部のある glob を受ける", () => {
    const { config } = loadRaguel({
      rules: {
        "code/protected-paths": {
          generated: ["plugins/*/scripts/**", "plugins/*/dist/**"]
        }
      }
    })
    expect(config.rules["code/protected-paths"].generated).toEqual([
      "plugins/*/scripts/**",
      "plugins/*/dist/**"
    ])
  })
})

describe("loadConfig - sealed と不変条件(A3・R21)", () => {
  it("sealed ルールの enabled: false は読み込みエラー", () => {
    expect(() =>
      loadRaguel({ rules: { "common/secrets": { enabled: false } } })
    ).toThrow(/common\/secrets/)
  })

  it("sealed ルールの severity を既定より軽くすると読み込みエラー", () => {
    expect(() =>
      loadRaguel({ rules: { "code/unsafe-exec": { severity: "info" } } })
    ).toThrow(/code\/unsafe-exec/)
  })

  it("stop にできないルールの severity: stop は読み込みエラー", () => {
    expect(() =>
      loadRaguel({ rules: { "code/max-diff-lines": { severity: "stop" } } })
    ).toThrow(/severity: stop/)
  })

  it("allowPatterns の不正な正規表現は読み込みエラー", () => {
    expect(() =>
      loadRaguel({ rules: { "common/secrets": { allowPatterns: ["(abc"] } } })
    ).toThrow(/allowPatterns/)
  })

  it.each([
    ".*",
    "sk-"
  ])("空文字列か見本の秘密情報に一致する allowPatterns(%s)は読み込みエラー", (pattern) => {
    expect(() =>
      loadRaguel({ rules: { "common/secrets": { allowPatterns: [pattern] } } })
    ).toThrow(/allowPatterns/)
  })

  it("similarityThreshold が 0.95 を超えると読み込みエラー", () => {
    expect(() =>
      loadRaguel({
        rules: { "common/resubmission-loop": { similarityThreshold: 0.96 } }
      })
    ).toThrow(/similarityThreshold/)
  })

  it("judge.deadlineMs が 1800000 を超えると読み込みエラー", () => {
    expect(() => loadRaguel({ judge: { deadlineMs: 1800001 } })).toThrow(
      /deadlineMs/
    )
  })

  it("judge.deadlineMs の上限ちょうどは受ける", () => {
    expect(
      loadRaguel({ judge: { deadlineMs: 1800000 } }).config.judge.deadlineMs
    ).toBe(1800000)
  })

  it("judge.timeoutMs が judge.deadlineMs を超えると読み込みエラー", () => {
    expect(() =>
      loadRaguel({ judge: { timeoutMs: 300000, deadlineMs: 200000 } })
    ).toThrow(/timeoutMs/)
  })

  it("contextJudge.timeoutMs が judge.deadlineMs を超えると読み込みエラー", () => {
    expect(() => loadRaguel({ contextJudge: { timeoutMs: 700000 } })).toThrow(
      /contextJudge\.timeoutMs/
    )
  })

  it.each([
    [{ lower: 0.7, raise: 0.7 }, /lower/],
    [{ lower: -0.1 }, /lower/],
    [{ raise: 1.5 }, /raise/]
  ])("contextJudge.thresholds %j は読み込みエラー", (thresholds, message) => {
    expect(() => loadRaguel({ contextJudge: { thresholds } })).toThrow(message)
  })
})

describe("tryLoadConfig - 設定が壊れていても例外を投げない(§6.12.4)", () => {
  it("読み込みに失敗したら例外にせず、理由と設定のパスを返す", () => {
    const path = useProjectConfig({ raguel: { unknownKey: 1 } })
    const result = tryLoadConfig()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.path).toBe(path)
    expect(result.source).toBe(`cwd:${path}`)
    expect(result.error).toMatch(/unknownKey/)
  })

  it("読み込めたら loaded を返す", () => {
    const result = tryLoadConfig(workDir)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.loaded.source).toBe("defaults")
  })
})

describe("createConfigReloader - 読み直しの契機", () => {
  it("ファイルの有無と mtime が変わったときだけ読み直し、configHash と source が変わる", () => {
    process.chdir(workDir)
    let builds = 0
    const current = createConfigReloader((loaded) => {
      builds++
      return loaded
    })

    const first = current()
    expect(first.source).toBe("defaults")
    expect(current()).toBe(first)
    expect(builds).toBe(1)

    const path = useProjectConfig({ raguel: { judge: { model: "sonnet" } } })
    const second = current()
    expect(second.source).toBe(`cwd:${path}`)
    expect(second.config.judge.model).toBe("sonnet")
    expect(second.configHash).not.toBe(first.configHash)
    expect(builds).toBe(2)

    writeFileSync(
      path,
      JSON.stringify({ raguel: { judge: { model: "opus" } } }),
      "utf8"
    )
    touchLater(path, 10_000)
    const third = current()
    expect(third.config.judge.model).toBe("opus")
    expect(third.configHash).not.toBe(second.configHash)
    expect(builds).toBe(3)
  })

  it("config.json の raguel 以外のキーを書き換えると読み直すが、raguel が同じなら configHash は変わらない", () => {
    const path = useProjectConfig({
      runsDir: "a",
      raguel: { precedent: { topN: 3 } }
    })
    const current = createConfigReloader((loaded) => loaded)
    const first = current()

    writeFileSync(
      path,
      JSON.stringify({ runsDir: "b", raguel: { precedent: { topN: 3 } } }),
      "utf8"
    )
    touchLater(path, 10_000)
    const second = current()
    expect(second).not.toBe(first)
    expect(second.configHash).toBe(first.configHash)
  })

  it("読み込みに失敗したら前の設定に戻さず、直るまで失敗を返す", () => {
    process.chdir(workDir)
    const path = useConfig({ precedent: { topN: 3 } })
    const current = createConfigReloader((loaded) => loaded)
    expect(current().config.precedent.topN).toBe(3)

    writeFileSync(path, '{"onError":"PROCEED"}', "utf8")
    touchLater(path, 10_000)
    expect(() => current()).toThrow()
    expect(() => current()).toThrow()

    writeFileSync(path, '{"precedent":{"topN":4}}', "utf8")
    touchLater(path, 20_000)
    expect(current().config.precedent.topN).toBe(4)
  })
})

describe("loadConfig - storage.casesDir の ~ の展開", () => {
  it("~/ で始まるパスをホームディレクトリの下の絶対パスへ展開する", () => {
    const { config } = loadRaguel({ storage: { casesDir: "~/custom-cases" } })
    expect(config.storage.casesDir).toBe(join(homedir(), "custom-cases"))
  })

  it("既定の ~/.raguel も展開する", () => {
    const { config } = loadConfig(workDir)
    expect(config.storage.casesDir).toBe(join(homedir(), ".raguel"))
  })
})

describe("loadConfig - configHash の安定性", () => {
  it("キーの順が違うだけの同じ設定は同じハッシュになる", () => {
    process.chdir(workDir)
    useConfig(
      '{"version":1,"onError":"ASK","judge":{"model":"haiku","timeoutMs":60000}}'
    )
    const first = loadConfig().configHash

    useConfig(
      '{"judge":{"timeoutMs":60000,"model":"haiku"},"onError":"ASK","version":1}'
    )
    const second = loadConfig().configHash

    expect(first).toBe(second)
  })

  it("値が違えば違うハッシュになる", () => {
    const first = loadRaguel({ judge: { model: "haiku" } }).configHash
    const second = loadRaguel({ judge: { model: "sonnet" } }).configHash
    expect(first).not.toBe(second)
  })
})
