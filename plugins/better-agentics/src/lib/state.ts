export type OrchestrationState =
  | { kind: "off" }
  | { kind: "unknown-value"; value: string }
  | { kind: "conflict-injection" }
  | { kind: "conflict-gate" }
  | { kind: "inject" }

const ON = new Set(["1", "true", "on"])
const OFF = new Set(["", "0", "false", "off"])

// README の「環境変数」の表を上から順に評価し、最初に当たった行で決める。
export function orchestrationState(env: NodeJS.ProcessEnv): OrchestrationState {
  const value =
    env.AMATSUKA_AGENT_ENABLE_ORCHESTRATION?.trim().toLowerCase() ?? ""
  if (OFF.has(value)) return { kind: "off" }
  if (!ON.has(value)) return { kind: "unknown-value", value }
  const injection =
    env.AMATSUKA_AGENT_AUTO_INJECTION?.trim().toLowerCase() ?? ""
  if (injection !== "" && injection !== "none") {
    return { kind: "conflict-injection" }
  }
  const gate = env.AMATSUKA_AGENT_DELEGATION_GATE?.trim().toLowerCase() ?? ""
  if (ON.has(gate)) return { kind: "conflict-gate" }
  // TYPESAFE_API_KEY の有無は見ない。キーが無ければ pick-delegate が候補を返し、オーケストレーターが選ぶ。
  return { kind: "inject" }
}

export function subagentPolicyApplies(state: OrchestrationState): boolean {
  return state.kind === "inject"
}
