// 読み取り系サブコマンド(契約 §11)。
//
// この経路は第 2 層(フェイルオープン)である。どんな異常環境でも例外を外へ出さず、
// **常に exit 0** で「読めなかった」という事実を JSON で返す。

import {
  extractDomains,
  findSection,
  parseArchitectureForRead
} from "../lib/architecture.js"
import { loadConfig, type ResolvedConfig } from "../lib/config.js"
import { stringFlag } from "./args.js"
import { readDocument } from "./input.js"
import {
  emitReadFailure,
  emitResult,
  messageOf,
  noteWarnings
} from "./output.js"
import { commandLine, INPUT_SCHEMAS, metatronCliPath } from "./paths.js"

export interface GetContext {
  flags: Record<string, string | true>
  cwd: string
}

function configOf(cwd: string): ResolvedConfig {
  return loadConfig(cwd)
}

// ---------------------------------------------------------------------------
// get config
// ---------------------------------------------------------------------------

export function runGetConfig(ctx: GetContext): void {
  const command = "get config"
  const config = configOf(ctx.cwd)
  const architecture = readDocument(config.architecturePath)
  const warnings = [...config.warnings, ...architecture.warnings]
  noteWarnings(warnings)
  emitResult(command, {
    ok: true,
    docRoot: config.docRoot,
    configPath: config.configPath,
    configExists: config.configExists,
    architecture: {
      path: config.architecturePath,
      relative: config.architectureRelative,
      exists: architecture.exists
    },
    cli: {
      path: metatronCliPath(),
      stageArchitecture: commandLine("stage-architecture --input <path>"),
      commitArchitecture: commandLine("commit-architecture --staging-id <id>"),
      linkClaudeMd: commandLine("link-claude-md")
    },
    inputSchemas: INPUT_SCHEMAS,
    warnings
  })
}

// ---------------------------------------------------------------------------
// get architecture
// ---------------------------------------------------------------------------

export function runGetArchitecture(ctx: GetContext): void {
  const command = "get architecture"
  const config = configOf(ctx.cwd)
  const file = readDocument(config.architecturePath)
  const doc = parseArchitectureForRead(file.text)
  const warnings = [...config.warnings, ...file.warnings, ...doc.warnings]
  noteWarnings(warnings)

  const section = stringFlag(ctx.flags, "section")

  if (!file.exists) {
    emitReadFailure(
      command,
      "not_created",
      `${config.architecturePath} は未作成です。stage-architecture で新規作成の diff を取得できます。`,
      {
        path: config.architecturePath,
        exists: false,
        section: section ?? null,
        warnings
      }
    )
    return
  }

  if (section !== undefined) {
    const found = findSection(doc, section.trim())
    if (found === undefined) {
      emitReadFailure(
        command,
        "section_not_found",
        `セクション「${section}」は ${config.architecturePath} にありません。`,
        {
          path: config.architecturePath,
          exists: true,
          section,
          headings: doc.sections.map((s) => s.heading),
          warnings
        }
      )
      return
    }
    emitResult(command, {
      ok: true,
      path: config.architecturePath,
      exists: true,
      section: {
        heading: found.heading,
        body: found.body,
        raw: found.raw
      },
      warnings
    })
    return
  }

  emitResult(command, {
    ok: true,
    path: config.architecturePath,
    exists: true,
    eol: doc.eol === "\r\n" ? "crlf" : "lf",
    preamble: doc.preamble,
    headings: doc.sections.map((s) => s.heading),
    sections: doc.sections.map((s) => ({ heading: s.heading, body: s.body })),
    text: file.text,
    warnings
  })
}

// ---------------------------------------------------------------------------
// get domains
// ---------------------------------------------------------------------------

export function runGetDomains(ctx: GetContext): void {
  const command = "get domains"
  const config = configOf(ctx.cwd)
  const file = readDocument(config.architecturePath)
  const result = extractDomains(file.text)
  const warnings = [...config.warnings, ...file.warnings, ...result.warnings]
  noteWarnings(warnings)

  if (!result.ok) {
    emitReadFailure(
      command,
      result.reason ?? "block_not_found",
      result.message ?? "ドメインマップを読めませんでした。",
      {
        path: config.architecturePath,
        exists: file.exists,
        reason: result.reason,
        domains: null,
        warnings
      }
    )
    return
  }

  emitResult(command, {
    ok: true,
    path: config.architecturePath,
    exists: file.exists,
    reason: null,
    domains: result.domains,
    warnings
  })
}

// ---------------------------------------------------------------------------
// ディスパッチ
// ---------------------------------------------------------------------------

const GET_TARGETS = ["config", "architecture", "domains"]

export function runGet(target: string | undefined, ctx: GetContext): void {
  const command = target === undefined ? "get" : `get ${target}`
  try {
    switch (target) {
      case "config":
        runGetConfig(ctx)
        return
      case "architecture":
        runGetArchitecture(ctx)
        return
      case "domains":
        runGetDomains(ctx)
        return
      default:
        emitReadFailure(
          command,
          "unknown_target",
          `get の対象は ${GET_TARGETS.join(" / ")} のいずれかです(受領: ${JSON.stringify(target ?? null)})。`,
          { targets: GET_TARGETS }
        )
        return
    }
  } catch (error) {
    // 第 2 層はフェイルオープン。読めなかったことを事実として返し、exit 0 のままにする。
    emitReadFailure(command, "internal_error", messageOf(error))
  }
}
