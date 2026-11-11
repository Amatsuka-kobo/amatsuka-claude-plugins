// Standard Agent モードと fork の依頼文の前置きを組み立てる。
// 前置きの言語は全体で 1 つに揃え、訳がそろわない言語は全体を en にする。

import fs from "node:fs"
import path from "node:path"
import {
  checkFragments,
  loadFragments,
  loadPreamble,
  vocabularyFor
} from "./fragments"
import type { RoleId } from "./roles"

export interface PreambleContext {
  pluginRoot: string
  projectDir: string
  lang: string
}

const WHEN_TO_INVOKE = "## When to invoke"
const OUTPUT_FORMAT = "## Output Format"

const FORK_INSTRUCTION = {
  ja: (roleId: RoleId) =>
    `split の分担を担う担い手として、依頼文の作業だけを行う。会話の履歴にあるオーケストレーターの規律のうち、委譲と pick-delegate に関するものは当てない。依頼文が指示したときを除き、Agent ツールでさらに委譲しない。\n役割 ID: ${roleId}`,
  en: (roleId: RoleId) =>
    `As the worker for a split assignment, do only the work in the request. Do not apply the orchestrator rules in the conversation history that concern delegation and pick-delegate. Do not delegate further with the Agent tool unless the request tells you to.\nRole ID: ${roleId}`
}

// ja・en は同梱の断片を使う。それ以外は役割と _common.md の訳がどちらも ready のときだけ訳を使う。
function languageFor(roleId: RoleId, context: PreambleContext): string {
  const { lang } = context
  if (lang === "ja" || lang === "en") return lang
  const status = checkFragments(context.pluginRoot, context.projectDir, lang)
  return status.ready.includes(roleId) && status.ready.includes("_common")
    ? lang
    : "en"
}

function policy(pluginRoot: string): string {
  return fs
    .readFileSync(
      path.join(pluginRoot, "references", "subagent-policy.md"),
      "utf8"
    )
    .trim()
}

function section(heading: string, lines: string[]): string {
  return [heading, "", ...lines].join("\n")
}

export function standardPreamble(
  roleId: RoleId,
  context: PreambleContext
): string {
  const lang = languageFor(roleId, context)
  const fragment = loadFragments(
    context.pluginRoot,
    context.projectDir,
    lang
  ).get(roleId)
  if (fragment === undefined) throw new Error(`Unknown role id: ${roleId}`)
  const head = loadPreamble(context.pluginRoot, context.projectDir, lang)
    .map((line) =>
      line
        .replaceAll("{{NAME}}", fragment.defaultName)
        .replaceAll("{{ROLE_LABEL}}", fragment.label)
        .replaceAll("{{ROLE_ID}}", roleId)
    )
    .join("\n")
    .trim()
  const parts = [head]
  for (const heading of vocabularyFor(lang).bodyOrder) {
    if (heading === WHEN_TO_INVOKE) continue
    const lines = fragment.sections.get(heading)
    if (lines !== undefined && lines.length > 0)
      parts.push(section(heading, lines))
  }
  parts.push(policy(context.pluginRoot))
  return parts.join("\n\n")
}

// fork の指示は断片に無く訳せないので、ja 以外は全体を en にする。
export function forkPreamble(roleId: RoleId, context: PreambleContext): string {
  const lang = context.lang === "ja" ? "ja" : "en"
  const fragment = loadFragments(
    context.pluginRoot,
    context.projectDir,
    lang
  ).get(roleId)
  if (fragment === undefined) throw new Error(`Unknown role id: ${roleId}`)
  const parts = [FORK_INSTRUCTION[lang](roleId)]
  const output = fragment.sections.get(OUTPUT_FORMAT)
  if (output !== undefined && output.length > 0)
    parts.push(section(OUTPUT_FORMAT, output))
  parts.push(policy(context.pluginRoot))
  return parts.join("\n\n")
}
