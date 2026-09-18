export interface HelpOption {
  flag: string
  value?: string
  required?: boolean
  defaultValue?: string
  summary: string
}

export interface HelpSpec {
  command: string
  summary: string
  options: HelpOption[]
}

export function renderHelp(spec: HelpSpec): string {
  const lines = [
    `Usage: ${spec.command} [options]`,
    "",
    spec.summary,
    "",
    "Options:"
  ]

  for (const option of spec.options) {
    const value = option.value ? ` ${option.value}` : ""
    const required = option.required ? " (required)" : ""
    const defaultValue = option.defaultValue
      ? ` (default: ${option.defaultValue})`
      : ""
    lines.push(`  ${option.flag}${value}${required}${defaultValue}`)
    lines.push(`    ${option.summary}`)
  }

  return `${lines.join("\n")}\n`
}
