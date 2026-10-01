/**
 * ルールごとのパラメータのスキーマ(設計書 §6.4.2・§6.12.2)。
 * 設定の検証(config/schema.ts)・内蔵の既定値(config/defaults.ts)・各ルール・list_rules がこの表を読む。
 * ルールを足すか消すときは、この表と rules/registry.ts を揃える。
 */

import { z } from "zod"
import type { RaguelConfig, Severity } from "../core/types.js"
import { IRREVERSIBLE_KEYWORDS } from "./util.js"

/** list_rules に載せるパラメータの型の名前 */
export type ParamType = "number" | "string[]" | "regex[]" | "glob[]"

export interface ParamSpec {
  name: string
  type: ParamType
  default: number | string[]
  /**
   * 利用者の値と既定値の合わせ方。union は既定値との和集合(sealed ルールのリスト)、
   * replace は利用者の値で置き換える
   */
  merge: "union" | "replace"
  description: string
  /** sealed での制約。list_rules に載せる。無ければ省く */
  constraint?: string
  schema: z.ZodType
}

export interface RuleSpec {
  id: string
  sealed: boolean
  defaultSeverity: Severity
  params: ParamSpec[]
}

/** code/protected-paths の既定の glob。excludeDefaults はこの文字列だけを受ける */
export const DEFAULT_PROTECTED_GLOBS: readonly string[] = [
  ".github/**",
  "infra/**",
  "**/*.env*"
]

/** plan/irreversible-ops と decision/no-rollback の既定の語(§6.4.2 の A8 で足した語を含む) */
export const DEFAULT_IRREVERSIBLE_KEYWORDS: readonly string[] = [
  ...IRREVERSIBLE_KEYWORDS,
  "デプロイ",
  "マイグレーション",
  "リリース",
  "破棄",
  "上書き"
]

/** common/resubmission-loop の similarityThreshold の上限(緩和の限度) */
export const MAX_SIMILARITY_THRESHOLD = 0.95

/** STOP を出せるルール(§6.4.1)。casefile/tampered は kernel が出すので設定の対象にしない */
export const STOP_CAPABLE_RULE_IDS: readonly string[] = [
  "common/secrets",
  "code/protected-paths",
  "code/destructive-ops"
]

const stringList = z.array(z.string().min(1))
const positiveInt = z.number().int().positive()

function limitParam(defaultValue: number, description: string): ParamSpec {
  return {
    name: "limit",
    type: "number",
    default: defaultValue,
    merge: "replace",
    description,
    schema: positiveInt
  }
}

function keywordsParam(): ParamSpec {
  return {
    name: "keywords",
    type: "string[]",
    default: [...DEFAULT_IRREVERSIBLE_KEYWORDS],
    merge: "replace",
    description: "不可逆な操作を表す語",
    schema: stringList
  }
}

export const RULE_SPECS: readonly RuleSpec[] = [
  {
    id: "common/secrets",
    sealed: true,
    defaultSeverity: "stop",
    params: [
      {
        name: "allowPatterns",
        type: "regex[]",
        default: [],
        merge: "union",
        description:
          "秘密情報とみなさないトークンの正規表現。行ではなくトークンに当てる",
        constraint:
          "正しい正規表現に限る。空文字列や内蔵の見本の秘密情報に一致するものは受けない",
        schema: z.array(z.string())
      }
    ]
  },
  {
    id: "common/injection-marker",
    sealed: true,
    defaultSeverity: "ask",
    params: []
  },
  {
    id: "common/resubmission-loop",
    sealed: true,
    defaultSeverity: "ask",
    params: [
      {
        name: "similarityThreshold",
        type: "number",
        default: 0.85,
        merge: "replace",
        description: "前の attempt と似ているとみなす類似度",
        constraint: `${MAX_SIMILARITY_THRESHOLD} を超えられない`,
        schema: z.number().min(0).max(1)
      }
    ]
  },
  {
    id: "common/max-size",
    sealed: false,
    defaultSeverity: "ask",
    params: [limitParam(200000, "本文の文字数の上限")]
  },
  {
    id: "code/protected-paths",
    sealed: true,
    defaultSeverity: "stop",
    params: [
      {
        name: "globs",
        type: "glob[]",
        default: [...DEFAULT_PROTECTED_GLOBS],
        merge: "union",
        description: "保護するパスの glob。既定の glob との和集合になる",
        constraint: "既定の glob は excludeDefaults で名指ししない限り外れない",
        schema: stringList
      },
      {
        name: "excludeDefaults",
        type: "string[]",
        default: [],
        merge: "replace",
        description: "保護から外す既定の glob",
        constraint: `既定の glob(${DEFAULT_PROTECTED_GLOBS.join("・")})と完全に一致する文字列だけを受ける`,
        schema: stringList
      },
      {
        name: "generated",
        type: "glob[]",
        default: [],
        merge: "replace",
        description:
          "生成物のパスの glob。common/secrets だけを当て、保護パス・Jev から外す",
        constraint:
          "固定部(ワイルドカードを含む最初のセグメントより前)が空の glob は受けない",
        schema: stringList
      }
    ]
  },
  {
    id: "code/destructive-ops",
    sealed: true,
    defaultSeverity: "stop",
    params: []
  },
  {
    id: "code/unsafe-exec",
    sealed: true,
    defaultSeverity: "ask",
    params: []
  },
  {
    id: "code/max-diff-lines",
    sealed: false,
    defaultSeverity: "ask",
    params: [limitParam(500, "変更行数の上限")]
  },
  {
    id: "code/test-deletion",
    sealed: false,
    defaultSeverity: "ask",
    params: []
  },
  {
    id: "code/new-dependency",
    sealed: false,
    defaultSeverity: "ask",
    params: []
  },
  {
    id: "plan/irreversible-ops",
    sealed: false,
    defaultSeverity: "info",
    params: [keywordsParam()]
  },
  {
    id: "plan/max-steps",
    sealed: false,
    defaultSeverity: "info",
    params: [limitParam(15, "ステップ数の上限")]
  },
  {
    id: "plan/scope-keywords",
    sealed: false,
    defaultSeverity: "info",
    params: [
      {
        name: "domains",
        type: "string[]",
        default: [],
        merge: "replace",
        description: "内蔵の領域に足す領域の名前",
        schema: stringList
      }
    ]
  },
  {
    id: "decision/no-alternatives",
    sealed: false,
    defaultSeverity: "info",
    params: []
  },
  {
    id: "decision/no-rollback",
    sealed: false,
    defaultSeverity: "info",
    params: [keywordsParam()]
  },
  {
    id: "precedent/failure-match",
    sealed: false,
    defaultSeverity: "info",
    params: []
  }
]

/** 廃止したルール ID と、読み込みエラーの文言で名指しする後継 */
export const RETIRED_RULE_IDS: Readonly<Record<string, readonly string[]>> = {
  "code/dangerous-patterns": ["code/destructive-ops", "code/unsafe-exec"]
}

export function findRuleSpec(ruleId: string): RuleSpec | undefined {
  return RULE_SPECS.find((spec) => spec.id === ruleId)
}

export function findParamSpec(
  ruleId: string,
  name: string
): ParamSpec | undefined {
  return findRuleSpec(ruleId)?.params.find((p) => p.name === name)
}

/**
 * ルールのパラメータの現在値を返す。設定に無ければ表の既定値を返す。
 * 表に無いパラメータは例外にする(ルールと表の食い違いをテストで見つけるため)
 */
export function ruleParam<T extends number | string[]>(
  config: RaguelConfig,
  ruleId: string,
  name: string
): T {
  const value = config.rules[ruleId]?.[name]
  if (value !== undefined) return value as T
  const spec = findParamSpec(ruleId, name)
  if (!spec) {
    throw new Error(`パラメータの表に ${ruleId}.${name} がありません`)
  }
  return structuredClone(spec.default) as T
}
