export interface HookInput {
  cwd?: string
  agent_type?: string
}

// hook の入力 JSON を読む。空の入力は {} として扱い、JSON でなければ例外を投げる。
export async function readStdin(): Promise<HookInput> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString("utf8").trim()
  if (raw === "") return {}
  const parsed = JSON.parse(raw)
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("hook input is not a JSON object")
  }
  return parsed as HookInput
}
