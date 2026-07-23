export type RaphaelToolName = "Bash" | "Edit" | "Write"

export type InfectionKind =
  | "command-failure"
  | "retry-loop"
  | "user-rejection"
  | "edit-churn"

export type InfectionDetails =
  | {
      type: "command-failure"
      command: string
      normalized_command: string
      exit_code: number | null
      output_tail: string
    }
  | {
      type: "retry-loop"
      command: string
      normalized_command: string
      consecutive_failures: number
      exit_codes: Array<number | null>
    }
  | {
      type: "user-rejection"
      prompt_excerpt: string
      matched_pattern: string
      previous_tool: {
        tool: RaphaelToolName
        input_digest: string
      } | null
    }
  | {
      type: "edit-churn"
      file_path: string
      line_start: number
      line_end: number
      edits_in_window: number
    }

export interface InfectionRecordV1 {
  schema_version: 1
  id: string
  ts: string
  kind: InfectionKind
  session: string
  hook_event: "PostToolUse" | "PostToolUseFailure" | "UserPromptSubmit"
  tool: RaphaelToolName | null
  tool_use_id: string | null
  input_digest: string
  evidence: string
  fingerprint: string
  details: InfectionDetails
  distilled: boolean
  distilled_at: string | null
}

export interface RaphaelStateV1 {
  schema_version: 1
  session: string
  next_event_seq: number
  recent_commands: Array<{
    ts: string
    normalized_command: string
    failed: boolean
    exit_code: number | null
    infection_id: string | null
  }>
  recent_edits: Array<{
    ts: string
    file_path: string
    line_start: number
    line_end: number
  }>
  last_tool: {
    ts: string
    tool: RaphaelToolName
    input_digest: string
  } | null
  injected: Array<{
    ts: string
    antibody_id: string
    trigger_fingerprint: string
  }>
  last_distill_nag_digest: string | null
}

export type AntibodyStatus = "active" | "expired" | "confirmed"

export interface AntibodyTrigger {
  event: "PreToolUse"
  tool: RaphaelToolName | "*"
  pattern: string
  scope?: string
}

export interface AntibodyStats {
  fired: number
  last_fired: string | null
}

export interface Antibody {
  id: string
  created: string
  source: string
  trigger: AntibodyTrigger
  status: AntibodyStatus
  stats: AntibodyStats
  expires: string
  body: string
}

export interface HookInput {
  session_id?: string
  transcript_path?: string
  cwd?: string
  hook_event_name?: string
  tool_name?: string
  tool_input?: {
    command?: string
    file_path?: string
    old_string?: string
    new_string?: string
    content?: string
    [key: string]: unknown
  }
  tool_response?: unknown
  error?: string
  prompt?: string
  user_prompt?: string
  tool_use_id?: string
  stop_hook_active?: boolean
  [key: string]: unknown
}

export interface RaphaelConfig {
  detectCommandFailure: boolean
  detectRetryLoop: boolean
  detectUserRejection: boolean
  detectEditChurn: boolean
  retryThreshold: number
  editChurnThreshold: number
  distillThreshold: number
  defaultExpiryDays: number
  maxInjections: number
  rejectionPatterns: string[]
  benignExit1Commands: string[]
  antibodiesGitPolicy: "commit" | "ignore"
}
