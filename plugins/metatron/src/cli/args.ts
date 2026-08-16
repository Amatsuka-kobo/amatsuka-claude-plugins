// CLI の引数解析。外部ライブラリを使わない(契約 §11 の呼び出し規約は
// `<subcommand> [--key value]` だけなので、標準の parseArgs も要らない)。

export interface ParsedArgs {
  positionals: string[]
  flags: Record<string, string | true>
  /** 解析の時点で分かった不正。呼び出し元が経路(読み / 書き)に応じて扱う。 */
  errors: string[]
}

// 値を取らないフラグ。ここに無い `--foo` は次の語を値として取る。
const BOOLEAN_FLAGS = new Set([
  "exclude-tagged",
  "promotion-candidates",
  "help"
])

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | true> = {}
  const errors: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }
    const body = arg.slice(2)
    if (body === "") {
      errors.push('"--" は解釈できません。')
      continue
    }
    const eq = body.indexOf("=")
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    if (BOOLEAN_FLAGS.has(body)) {
      flags[body] = true
      continue
    }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("--")) {
      errors.push(`--${body} に値がありません。`)
      continue
    }
    flags[body] = next
    i++
  }

  return { positionals, flags, errors }
}

export function stringFlag(
  flags: Record<string, string | true>,
  name: string
): string | undefined {
  const value = flags[name]
  if (value === undefined) return undefined
  if (value === true) return undefined
  return value
}

export function boolFlag(
  flags: Record<string, string | true>,
  name: string
): boolean {
  const value = flags[name]
  if (value === true) return true
  if (typeof value === "string") return value !== "false" && value !== "0"
  return false
}

export type IntFlag =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string }

export function intFlag(
  flags: Record<string, string | true>,
  name: string
): IntFlag {
  const raw = flags[name]
  if (raw === undefined) return { ok: true, value: undefined }
  if (raw === true)
    return { ok: false, message: `--${name} に値がありません。` }
  if (!/^-?\d+$/.test(raw.trim())) {
    return {
      ok: false,
      message: `--${name} は整数で指定してください(受領: ${JSON.stringify(raw)})。`
    }
  }
  return { ok: true, value: Number.parseInt(raw.trim(), 10) }
}
