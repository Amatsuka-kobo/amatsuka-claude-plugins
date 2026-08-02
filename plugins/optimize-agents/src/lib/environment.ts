export interface EvalEnvironment {
  base_url: string
  auth_source: string
  model: string
}

export function captureEnvironment(model: string): EvalEnvironment {
  let authSource = "(claude.ai login)"
  if (process.env.ANTHROPIC_API_KEY !== undefined)
    authSource = "ANTHROPIC_API_KEY"
  else if (process.env.ANTHROPIC_AUTH_TOKEN !== undefined)
    authSource = "ANTHROPIC_AUTH_TOKEN"

  return {
    base_url: process.env.ANTHROPIC_BASE_URL ?? "(default)",
    auth_source: authSource,
    model
  }
}
