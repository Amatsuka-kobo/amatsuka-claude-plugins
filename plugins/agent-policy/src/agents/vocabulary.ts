import type { Lang } from "./policies"

export interface Vocabulary {
  bodyOrder: string[]
  advisorHeading: string
  agentConstraintHeading: string
  constraintHeading: string
  outputFormatHeading: string
  listSeparator: string
  quote: (value: string) => string
  describe: (roles: string) => string
}

const JA: Vocabulary = {
  bodyOrder: ["## When to invoke", "## Core Responsibilities", "## 作業手順"],
  advisorHeading: "## アドバイザーへの相談",
  agentConstraintHeading: "## Agent tool の制約",
  constraintHeading: "## 制約",
  outputFormatHeading: "## Output Format",
  listSeparator: "、",
  quote: (value) => `「${value}」`,
  describe: (roles) =>
    `Use this agent when ${roles}を委譲するとき。詳細は本文の「When to invoke」を参照。`
}

const EN: Vocabulary = {
  bodyOrder: ["## When to invoke", "## Core Responsibilities", "## Procedure"],
  advisorHeading: "## Consulting an advisor",
  agentConstraintHeading: "## Agent tool limits",
  constraintHeading: "## Constraints",
  outputFormatHeading: "## Output Format",
  listSeparator: ", ",
  quote: (value) => `"${value}"`,
  describe: (roles) =>
    `Use this agent when delegating ${roles}. See "When to invoke" below for details.`
}

// ja / en 以外は en の語彙を使う。翻訳断片の見出しも英語のままとし、
// 翻訳するのは本文と label / description に限る(合成器が見出しで節を
// 突き合わせるため)。
export function vocabularyFor(lang: Lang): Vocabulary {
  return lang === "ja" ? JA : EN
}
