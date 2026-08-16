// 読み取り系サブコマンド(契約 §11)。
//
// この経路は第 2 層(フェイルオープン)である。どんな異常環境でも例外を外へ出さず、
// **常に exit 0** で「読めなかった」という事実を JSON で返す。

import {
  type AdrEntry,
  filterAdrEntries,
  parseAdrDocument
} from "../lib/adr.js"
import {
  extractDomains,
  findSection,
  parseArchitectureForRead
} from "../lib/architecture.js"
import { loadConfig, type ResolvedConfig } from "../lib/config.js"
import {
  filterGotchas,
  type GotchaEntry,
  parseGotchas
} from "../lib/gotchas.js"
import { boolFlag, intFlag, stringFlag } from "./args.js"
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
  const gotchas = readDocument(config.gotchasPath)
  const warnings = [
    ...config.warnings,
    ...architecture.warnings,
    ...gotchas.warnings
  ]
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
    gotchas: {
      path: config.gotchasPath,
      relative: config.gotchasRelative,
      exists: gotchas.exists
    },
    injection: config.injection,
    cli: {
      path: metatronCliPath(),
      stageArchitecture: commandLine("stage-architecture --input <path>"),
      stageAdr: commandLine("stage-adr --input <path>"),
      commitArchitecture: commandLine("commit-architecture --staging-id <id>"),
      appendGotcha: commandLine("append-gotcha --input <path>"),
      tagGotcha: commandLine(
        "tag-gotcha --id <GOTCHA-NNN> --tag <解決済み|対象外> --reason <理由>"
      )
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
// get gotchas
// ---------------------------------------------------------------------------

function serializeGotcha(entry: GotchaEntry): Record<string, unknown> {
  return {
    id: entry.id,
    number: entry.number,
    date: entry.date,
    tag: entry.tag,
    title: entry.title,
    task: entry.task,
    mistake: entry.mistake,
    cause: entry.cause,
    countermeasure: entry.countermeasure,
    promotionCandidate: entry.promotionCandidate,
    raw: entry.raw
  }
}

export function runGetGotchas(ctx: GetContext): void {
  const command = "get gotchas"
  const config = configOf(ctx.cwd)
  const file = readDocument(config.gotchasPath)
  const doc = parseGotchas(file.text)
  const warnings = [...config.warnings, ...file.warnings, ...doc.warnings]
  noteWarnings(warnings)

  const recent = intFlag(ctx.flags, "recent")
  if (!recent.ok) {
    emitReadFailure(command, "invalid_option", recent.message, {
      path: config.gotchasPath,
      exists: file.exists,
      entries: [],
      warnings
    })
    return
  }

  const filter = {
    id: stringFlag(ctx.flags, "id"),
    query: stringFlag(ctx.flags, "query"),
    recent: recent.value,
    excludeTagged: boolFlag(ctx.flags, "exclude-tagged"),
    promotionCandidates: boolFlag(ctx.flags, "promotion-candidates")
  }

  if (!file.exists) {
    emitReadFailure(
      command,
      "not_created",
      `${config.gotchasPath} は未作成です。append-gotcha が台帳ごと作成します。`,
      {
        path: config.gotchasPath,
        exists: false,
        total: 0,
        count: 0,
        filter,
        entries: [],
        warnings
      }
    )
    return
  }

  const entries = filterGotchas(doc.entries, filter)
  emitResult(command, {
    ok: true,
    path: config.gotchasPath,
    exists: true,
    total: doc.entries.length,
    count: entries.length,
    promotionCandidateCount: doc.entries.filter(
      (e) => e.promotionCandidate === "Yes"
    ).length,
    filter,
    entries: entries.map(serializeGotcha),
    warnings
  })
}

// ---------------------------------------------------------------------------
// get adr
// ---------------------------------------------------------------------------

function serializeAdr(entry: AdrEntry): Record<string, unknown> {
  return {
    id: entry.id,
    number: entry.number,
    title: entry.title,
    status: entry.status,
    statusRaw: entry.statusRaw,
    decidedOn: entry.decidedOn,
    decidedBy: entry.decidedBy,
    statusChanges: entry.statusChanges.map((change) => ({
      date: change.date,
      from: change.from,
      to: change.to,
      reason: change.reason
    })),
    raw: entry.raw
  }
}

export function runGetAdr(ctx: GetContext): void {
  const command = "get adr"
  const config = configOf(ctx.cwd)
  const file = readDocument(config.architecturePath)
  const doc = parseAdrDocument(file.text)
  const warnings = [...config.warnings, ...file.warnings, ...doc.warnings]
  noteWarnings(warnings)

  const filter = {
    id: stringFlag(ctx.flags, "id"),
    status: stringFlag(ctx.flags, "status")
  }

  if (!file.exists) {
    emitReadFailure(
      command,
      "not_created",
      `${config.architecturePath} は未作成です。stage-adr が節ごと作成します。`,
      {
        path: config.architecturePath,
        exists: false,
        hasSection: false,
        total: 0,
        count: 0,
        filter,
        entries: [],
        warnings
      }
    )
    return
  }

  const entries = filterAdrEntries(doc.entries, filter)
  emitResult(command, {
    ok: true,
    path: config.architecturePath,
    exists: true,
    hasSection: doc.hasSection,
    total: doc.entries.length,
    count: entries.length,
    nextNumber: doc.nextNumber,
    filter,
    entries: entries.map(serializeAdr),
    warnings
  })
}

// ---------------------------------------------------------------------------
// ディスパッチ
// ---------------------------------------------------------------------------

const GET_TARGETS = ["config", "architecture", "domains", "gotchas", "adr"]

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
      case "gotchas":
        runGetGotchas(ctx)
        return
      case "adr":
        runGetAdr(ctx)
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
