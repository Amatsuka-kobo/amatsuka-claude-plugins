import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defaultConfig } from "../defaults"
import { loadConfig } from "../loader"

let workDir: string
let originalCwd: string
let originalEnvValue: string | undefined

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "raguel-loader-test-"))
  originalCwd = process.cwd()
  originalEnvValue = process.env.RAGUEL_CONFIG
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

/** workDir 配下に YAML ファイルを書き、RAGUEL_CONFIG に設定してパスを返す */
function useConfig(
  yamlContent: string,
  filename = "raguel.config.yaml"
): string {
  const path = join(workDir, filename)
  writeFileSync(path, yamlContent, "utf8")
  process.env.RAGUEL_CONFIG = path
  return path
}

describe("loadConfig - 解決順", () => {
  it("RAGUEL_CONFIG が指すパスを読み込み source は env:<path> になる", () => {
    const path = useConfig("onError: STOP\n")
    const loaded = loadConfig()
    expect(loaded.source).toBe(`env:${path}`)
    expect(loaded.config.onError).toBe("STOP")
  })

  it("RAGUEL_CONFIG 未設定 かつ cwd/raguel.config.yaml が存在すればそれを使う", () => {
    delete process.env.RAGUEL_CONFIG
    writeFileSync(
      join(workDir, "raguel.config.yaml"),
      "onError: STOP\n",
      "utf8"
    )
    process.chdir(workDir)
    const loaded = loadConfig()
    expect(loaded.source).toBe(`cwd:${join(workDir, "raguel.config.yaml")}`)
    expect(loaded.config.onError).toBe("STOP")
  })

  it("設定ファイルが一切なければ内蔵デフォルトのみを使う", () => {
    delete process.env.RAGUEL_CONFIG
    process.chdir(workDir)
    const loaded = loadConfig()
    expect(loaded.source).toBe("defaults")
    expect(loaded.config.onError).toBe(defaultConfig.onError)
    expect(loaded.config.judge.model).toBe(defaultConfig.judge.model)
  })

  it("RAGUEL_CONFIG が存在しないパスを指す場合は黙ってデフォルトに落ちず throw する", () => {
    process.env.RAGUEL_CONFIG = join(workDir, "does-not-exist.yaml")
    expect(() => loadConfig()).toThrow()
  })
})

describe("loadConfig - 深マージ", () => {
  it("ネストしたオブジェクトは再帰マージされ、指定しなかった兄弟フィールドはデフォルトを維持する", () => {
    useConfig("judge:\n  thresholds:\n    proceed: 55\n")
    const { config } = loadConfig()
    expect(config.judge.thresholds.proceed).toBe(55)
    expect(config.judge.thresholds.confidence).toBe(
      defaultConfig.judge.thresholds.confidence
    )
    expect(config.judge.thresholds.maxVariance).toBe(
      defaultConfig.judge.thresholds.maxVariance
    )
    expect(config.judge.model).toBe(defaultConfig.judge.model)
    expect(config.judge.timeoutMs).toBe(defaultConfig.judge.timeoutMs)
  })

  it("配列はマージされずユーザー値で丸ごと置換される", () => {
    useConfig("panel:\n  critical: [adversarial]\n")
    const { config } = loadConfig()
    expect(config.panel.critical).toEqual(["adversarial"])
    // 兄弟の standard は影響を受けない
    expect(config.panel.standard).toEqual(defaultConfig.panel.standard)
  })
})

describe("loadConfig - 不変条件・zod 違反の拒否", () => {
  it("onError: PROCEED は拒否する", () => {
    useConfig("onError: PROCEED\n")
    expect(() => loadConfig()).toThrow()
  })

  it("sealed ルールの enabled: false は拒否する", () => {
    useConfig("rules:\n  common/secrets:\n    enabled: false\n")
    expect(() => loadConfig()).toThrow(/common\/secrets/)
  })

  it("adversarial なしの steelman 構成(standard: [steelman])は拒否する", () => {
    useConfig("panel:\n  standard: [steelman]\n")
    expect(() => loadConfig()).toThrow(/steelman/)
  })

  it("common/resubmission-loop の stopAfter が 5 を超えると拒否する", () => {
    useConfig("rules:\n  common/resubmission-loop:\n    stopAfter: 6\n")
    expect(() => loadConfig()).toThrow(/stopAfter/)
  })

  it("不正な YAML はパースエラーとして throw する", () => {
    useConfig("onError: [ASK\n")
    expect(() => loadConfig()).toThrow()
  })

  it("zod スキーマ違反(型不一致)は throw する", () => {
    useConfig('judge:\n  timeoutMs: "not-a-number"\n')
    expect(() => loadConfig()).toThrow()
  })
})

describe("loadConfig - storage.casesDir の ~ 展開", () => {
  it("~/ 始まりのパスを os.homedir() 基準の絶対パスへ展開する", () => {
    useConfig("storage:\n  casesDir: ~/custom-cases\n")
    const { config } = loadConfig()
    expect(config.storage.casesDir).toBe(join(homedir(), "custom-cases"))
  })

  it("デフォルトの ~/.raguel も展開される", () => {
    delete process.env.RAGUEL_CONFIG
    process.chdir(workDir)
    const { config } = loadConfig()
    expect(config.storage.casesDir).toBe(join(homedir(), ".raguel"))
  })
})

describe("loadConfig - configHash の安定性", () => {
  it("キー順が異なるだけの同一設定は同じハッシュになる", () => {
    useConfig(
      [
        "version: 1",
        "onError: ASK",
        "judge:",
        "  model: haiku",
        "  timeoutMs: 60000"
      ].join("\n")
    )
    const first = loadConfig().configHash

    useConfig(
      [
        "judge:",
        "  timeoutMs: 60000",
        "  model: haiku",
        "onError: ASK",
        "version: 1"
      ].join("\n")
    )
    const second = loadConfig().configHash

    expect(first).toBe(second)
  })

  it("値が異なれば異なるハッシュになる", () => {
    useConfig("judge:\n  model: haiku\n")
    const first = loadConfig().configHash

    useConfig("judge:\n  model: sonnet\n")
    const second = loadConfig().configHash

    expect(first).not.toBe(second)
  })
})
