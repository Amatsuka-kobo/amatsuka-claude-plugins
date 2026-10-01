import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  type ComposeInput,
  compose,
  DESCRIPTION_HASH_KEY,
  describeRoles,
  PREAMBLE_HASH_KEY,
  type RolesSummary,
  resolveToolsFor
} from "./agents/compose"
import {
  checkFragments,
  type Fragment,
  type FragmentDir,
  fragmentDirsFor,
  loadFragments,
  scaffoldFragments,
  type Vendor
} from "./agents/fragments"
import { textHash } from "./agents/hash"
import { fetchLiveModels, type LiveModels } from "./agents/live-models"
import {
  listMcpServers,
  type McpCurrent,
  mcpCurrentOf,
  toolPrefix
} from "./agents/mcp"
import {
  ASSIGNMENTS,
  type CandidateScope,
  CLAUDE_ENUM_MODELS,
  candidateScopeFor,
  effortFor,
  MODELS,
  type ModelId,
  type ModelSpec,
  modelById,
  RECOMMENDED,
  runsOnClaude
} from "./agents/policies"
import {
  isRetiredRole,
  RETIRED_ROLE_REPLACEMENTS,
  ROLES,
  type RoleId,
  roleById,
  roleOrder,
  sortRoleIds
} from "./agents/roles"
import { frontmatter, parseToolsField } from "./hooks/marker-scan"

interface Options {
  scope: CandidateScope
  modelId: string
  recommended: boolean
  name: string
  model: string
  vendor: Vendor | ""
  roles: RoleId[]
  dir: string
  lang: string
  mcpServers: string[]
  mcpDeny: string[]
  write: boolean
  merge: boolean
  listLiveModels: boolean
  listRoles: boolean
  listCoverage: boolean
  listMcp: boolean
  checkFragments: boolean
  scaffoldFragments: boolean
  keep: string[]
  pruneTools: boolean
  rewriteRoles: boolean
  tools: string[]
  replace: string[]
}

interface Target {
  modelId: ModelId
  roleId?: RoleId
  name: string
  model: string
  roles: RoleId[]
  color: string
  vendor: Vendor
}

interface TargetResolution {
  targets: Target[]
  warnings: string[]
}

const VENDOR_COLORS: Record<Vendor, string> = {
  gpt: "yellow",
  grok: "red",
  claude: "blue",
  none: "blue"
}

interface Diff {
  ok: true
  target: string
  exists: boolean
  identical: boolean
  frontmatter: {
    changed: { key: string; existing: string; template: string }[]
    toolsOnlyInExisting: string[]
    toolsOnlyInTemplate: string[]
    keysOnlyInExisting: string[]
  }
  preambleChanged: boolean
  body: {
    sectionsOnlyInExisting: string[]
    sectionsOnlyInTemplate: string[]
    sectionsChanged: string[]
  }
  roles: RolesSummary
  /** 既存ファイルが無いときは null */
  description: TextState | null
  preamble: TextState | null
  /** 前置きが same でないときの既存とテンプレート。それ以外は null */
  preambleTexts: { existing: string; template: string } | null
}

interface Document {
  order: string[]
  meta: Map<string, string>
  preamble: string
  sections: Map<string, string>
}

interface Discarded {
  frontmatterKeys: string[]
  preamble: boolean
  sections: string[]
}

function parseDocument(content: string): Document {
  const lines = content.split("\n")
  const startsWithFrontmatter = lines[0]?.trim() === "---"
  const close = startsWithFrontmatter ? lines.indexOf("---", 1) : -1
  const hasFrontmatter = startsWithFrontmatter && close !== -1
  const meta = new Map<string, string>()
  const order: string[] = []

  if (hasFrontmatter) {
    for (const line of lines.slice(1, close)) {
      const at = line.indexOf(": ")
      if (at <= 0) continue
      const key = line.slice(0, at)
      meta.set(key, line.slice(at + 2))
      order.push(key)
    }
  }

  const preamble: string[] = []
  const sections = new Map<string, string>()
  let heading: string | undefined
  let buffer: string[] = []

  for (const line of lines.slice(hasFrontmatter ? close + 1 : 0)) {
    if (line.startsWith("## ")) {
      if (heading !== undefined) sections.set(heading, buffer.join("\n").trim())
      heading = line.trim()
      buffer = []
      continue
    }
    if (heading === undefined) preamble.push(line)
    else buffer.push(line)
  }
  if (heading !== undefined) sections.set(heading, buffer.join("\n").trim())

  return { order, meta, preamble: preamble.join("\n").trim(), sections }
}

function splitTools(value: string | undefined): string[] {
  if (value === undefined) return []
  return value
    .split(",")
    .map((tool) => tool.trim())
    .filter((tool) => tool !== "")
}

function only(left: string[], right: string[]): string[] {
  return left.filter((item) => !right.includes(item))
}

function pluginRoot(): string {
  return (
    process.env.CLAUDE_PLUGIN_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  )
}

function requireModel(options: Options): ModelSpec {
  const spec = modelById(options.modelId)
  if (spec === undefined) throw new Error("model-id: is unknown")
  return spec
}

function recommendedForAlias(model: string): RoleId[] {
  const modelIds = MODELS.filter((spec) => spec.model === model).map(
    (spec) => spec.id
  )
  return sortRoleIds(
    (Object.entries(RECOMMENDED) as [RoleId, ModelId[]][])
      .filter(([, recommended]) =>
        recommended.some((modelId) => modelIds.includes(modelId))
      )
      .map(([role]) => role)
  )
}

function validateRoles(options: Options, model: ModelSpec): string[] {
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), options.dir, options.lang)
  )
  const invalid = options.roles.filter((role) => !fragments.has(role))
  if (invalid.length > 0) {
    throw new Error(`roles: ${invalid.join(", ")} is unknown`)
  }

  return options.roles.flatMap((role) => {
    if (roleById(role) === undefined || RECOMMENDED[role].includes(model.id)) {
      return []
    }
    return [`roles: ${role} is not recommended for ${model.id}`]
  })
}

// lang が ja / en 以外のときは翻訳断片が揃っていなければ止める。
// 揃っていないまま進むと、英語見出しの定義がその言語の指定で書かれる。
function validateFragments(options: Options): void {
  const status = checkFragments(pluginRoot(), options.dir, options.lang)
  if (status.missing.length === 0 && status.stale.length === 0) return
  throw new Error(
    `fragments: translation for "${options.lang}" is incomplete. missing=${status.missing.join(", ")} stale=${status.stale.map((entry) => entry.id).join(", ")}. Run --scaffold-fragments and translate them first`
  )
}

function defaultAgentName(
  options: Options,
  spec: ModelSpec,
  role: RoleId
): string {
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), options.dir, options.lang),
    spec.vendor
  )
  const defaultName =
    fragments.get(role)?.defaultName ??
    bundledDefaultNames(options.dir).get(role)
  return defaultName === undefined ? spec.id : `${spec.id}-${defaultName}`
}

function isClaudeEnum(model: string): boolean {
  return CLAUDE_ENUM_MODELS.includes(model)
}

function unavailableWarning(live: LiveModels): string {
  return `live models unavailable (${live.reason ?? "unknown"}); model existence was not validated`
}

function resolveVendor(
  options: Options,
  model: string,
  spec: ModelSpec,
  live: LiveModels
): Vendor {
  if (options.vendor !== "") return options.vendor
  if (isClaudeEnum(model)) return "claude"
  if (!live.ok) return spec.vendor

  const vendor = live.vendors[model] ?? "unknown"
  if (vendor === "unknown") {
    throw new Error(
      `vendor: could not infer vendor for model "${model}"; pass --vendor gpt|grok|claude|none`
    )
  }
  return vendor
}

function modelIsAvailable(model: string, live: LiveModels): boolean {
  return isClaudeEnum(model) || live.ids.includes(model)
}

// --recommended は各役割に推奨モデルの定義を 1 件ずつ作る。
// --model-id は明示指定の 1 件を作る。live models が取れない場合は推奨候補の先頭を使う。
// 被覆されていない役割は、推奨候補のうち実在する最初のモデルで既定名に作る。
function recommendedTarget(
  options: Options,
  live: LiveModels,
  role: RoleId
): Target {
  const candidates =
    options.scope === "claude-only"
      ? ASSIGNMENTS["claude-model-policy"][role]
      : RECOMMENDED[role]
  const spec = candidates
    .map((id) => modelById(id))
    .find(
      (candidate) =>
        candidate !== undefined &&
        (!live.ok || modelIsAvailable(candidate.model, live))
    )
  if (spec === undefined)
    throw new Error(`roles: no available model for ${role}`)
  return {
    roleId: role,
    modelId: spec.id,
    name: defaultAgentName(options, spec, role),
    model: spec.model,
    roles: [role],
    color: VENDOR_COLORS[spec.vendor],
    vendor: spec.vendor
  }
}

function targetsFor(options: Options, live: LiveModels): TargetResolution {
  const warnings = live.ok ? [] : [unavailableWarning(live)]
  if (options.recommended) {
    const roles = sortRoleIds(
      options.roles.length > 0 ? options.roles : ROLES.map((role) => role.id)
    )
    const definitions = scopedDefinitions(options.dir, options.scope)
    const fragments = loadFragments(
      fragmentDirsFor(pluginRoot(), options.dir, options.lang)
    )
    // 1 つの定義は 1 回だけ生成する。
    const visited = new Set<string>()
    const targets: Target[] = []
    for (const role of roles) {
      if (roleById(role) === undefined)
        throw new Error(
          `roles: ${role} is not a built-in role for --recommended`
        )
      const covering = definitions.filter((definition) =>
        definition.markerIds.includes(role)
      )
      if (covering.length === 1 && covering[0] !== undefined) {
        if (visited.has(covering[0].file)) continue
        visited.add(covering[0].file)
      }
      const target = coveringTarget(role, covering, fragments, live, warnings)
      if (target !== undefined) {
        targets.push(target ?? recommendedTarget(options, live, role))
      }
    }
    return { warnings, targets }
  }

  const spec = requireModel(options)
  if (options.scope === "claude-only" && spec.vendor !== "claude") {
    throw new Error(
      `model-id: ${options.modelId} is not available with --scope claude`
    )
  }
  if (
    options.scope === "claude-only" &&
    options.model !== "" &&
    !isClaudeEnum(options.model)
  ) {
    throw new Error(
      `model: ${options.model} is not available with --scope claude`
    )
  }
  const model = options.model === "" ? spec.model : options.model
  if (options.write && live.ok && !modelIsAvailable(model, live)) {
    throw new Error(
      `model: ${model} is not a Claude enum and was not found in live models`
    )
  }
  warnings.push(...validateRoles(options, spec))
  const vendor = resolveVendor(options, model, spec, live)
  return {
    warnings: [...new Set(warnings)],
    targets: [
      {
        modelId: spec.id,
        name: options.name,
        model,
        roles: options.roles,
        color: VENDOR_COLORS[vendor],
        vendor
      }
    ]
  }
}

// vendor の選択結果に対応する色を必ず compose へ渡す。
function composeInputFor(
  options: Options,
  target: Target,
  mcpServers: string[]
): ComposeInput {
  return {
    name: target.name,
    model: target.model,
    vendor: target.vendor,
    roleIds: target.roles,
    fragmentDirs: fragmentDirsFor(pluginRoot(), options.dir, options.lang),
    lang: options.lang,
    effort: effortFor(target.roles, target.modelId),
    color: target.color,
    mcpServers,
    denyTools: options.mcpDeny
  }
}

function templateFor(input: ComposeInput): string {
  return compose(input)
}

function targetPath(options: Options, target: Target): string {
  return path.join(options.dir, ".claude", "agents", `${target.name}.md`)
}

function compare(
  options: Options,
  target: Target,
  input: ComposeInput,
  rendered: string,
  existingRaw: string | undefined
): Diff {
  const file = targetPath(options, target)
  const relative = path.relative(options.dir, file).split(path.sep).join("/")
  const roles = describeRoles(input)

  if (existingRaw === undefined) {
    return {
      ok: true,
      target: relative,
      exists: false,
      identical: false,
      frontmatter: {
        changed: [],
        toolsOnlyInExisting: [],
        toolsOnlyInTemplate: [],
        keysOnlyInExisting: []
      },
      preambleChanged: false,
      body: {
        sectionsOnlyInExisting: [],
        sectionsOnlyInTemplate: [],
        sectionsChanged: []
      },
      roles,
      description: null,
      preamble: null,
      preambleTexts: null
    }
  }

  const existing = parseDocument(existingRaw)
  const expected = parseDocument(rendered)
  const descriptionState = textState(
    existing.meta.get("description") ?? "",
    expected.meta.get("description") ?? "",
    existing.meta.get(DESCRIPTION_HASH_KEY)
  )
  const preambleState = textState(
    existing.preamble,
    expected.preamble,
    existing.meta.get(PREAMBLE_HASH_KEY)
  )

  const existingTools = splitTools(existing.meta.get("tools"))
  const expectedTools = splitTools(expected.meta.get("tools"))

  const changed: Diff["frontmatter"]["changed"] = []
  for (const [key, value] of expected.meta) {
    // 記録のキーは生成の管理用であり、利用者に見せる差分に含めない。
    if (key === "tools" || RECORD_KEYS.includes(key)) continue
    const current = existing.meta.get(key)
    if (current !== undefined && current !== value) {
      changed.push({ key, existing: current, template: value })
    }
  }

  const sectionsChanged: string[] = []
  for (const [heading, body] of expected.sections) {
    const current = existing.sections.get(heading)
    if (current !== undefined && current !== body) sectionsChanged.push(heading)
  }

  return {
    ok: true,
    target: relative,
    exists: true,
    identical: existingRaw === rendered,
    frontmatter: {
      changed,
      toolsOnlyInExisting: only(existingTools, expectedTools),
      toolsOnlyInTemplate: only(expectedTools, existingTools),
      keysOnlyInExisting: only(
        [...existing.meta.keys()],
        [...expected.meta.keys()]
      )
    },
    preambleChanged: existing.preamble !== expected.preamble,
    body: {
      sectionsOnlyInExisting: only(
        [...existing.sections.keys()],
        [...expected.sections.keys()]
      ),
      sectionsOnlyInTemplate: only(
        [...expected.sections.keys()],
        [...existing.sections.keys()]
      ),
      sectionsChanged
    },
    roles,
    description: descriptionState,
    preamble: preambleState,
    // description の両方の値は frontmatter.changed に載る。前置きはここで返す。
    preambleTexts:
      preambleState === "same"
        ? null
        : { existing: existing.preamble, template: expected.preamble }
  }
}

type TextState = "same" | "templateChanged" | "userEdited" | "unknown"

const RECORD_KEYS: readonly string[] = [DESCRIPTION_HASH_KEY, PREAMBLE_HASH_KEY]

// 既存の値を、テンプレートと生成時の記録に照らして分類する。
function textState(
  existing: string,
  template: string,
  record: string | undefined
): TextState {
  if (existing.trim() === template.trim()) return "same"
  if (record === undefined) return "unknown"
  return textHash(existing) === record ? "templateChanged" : "userEdited"
}

function diff(options: Options, target: Target, mcpServers: string[]): Diff {
  const input = composeInputFor(options, target, mcpServers)
  const rendered = templateFor(input)
  const file = targetPath(options, target)
  const existingRaw = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8")
    : undefined
  return compare(options, target, input, rendered, existingRaw)
}

interface Keep {
  tools: Set<string>
  keys: Set<string>
  sections: Set<string>
  preamble: boolean
}

function parseKeep(selectors: string[]): Keep {
  const keep: Keep = {
    tools: new Set(),
    keys: new Set(),
    sections: new Set(),
    preamble: false
  }

  for (const selector of selectors) {
    if (selector === "preamble") {
      keep.preamble = true
      continue
    }
    const at = selector.indexOf(":")
    const kind = at === -1 ? selector : selector.slice(0, at)
    const value = at === -1 ? "" : selector.slice(at + 1)
    if (value === "")
      throw new Error(`keep: must be <kind>:<value>: ${selector}`)

    switch (kind) {
      case "tools":
        keep.tools.add(value)
        break
      case "key":
        keep.keys.add(value)
        break
      case "section":
        keep.sections.add(value)
        break
      default:
        throw new Error(`keep: unknown selector kind: ${selector}`)
    }
  }

  return keep
}

function render(document: Document): string {
  const head = ["---"]
  for (const key of document.order) {
    head.push(`${key}: ${document.meta.get(key) ?? ""}`)
  }
  head.push("---", "")

  const body: string[] = []
  if (document.preamble !== "") body.push(document.preamble, "")
  for (const [heading, content] of document.sections) {
    body.push(heading, "")
    if (content !== "") body.push(content, "")
  }

  return `${[...head, ...body].join("\n").trimEnd()}\n`
}

interface Retain {
  description: boolean
  preamble: boolean
}

const RETAIN_NONE: Retain = { description: false, preamble: false }

// 保持した値には既存の記録を残す。記録が無ければ書かない。
function retainText(
  existing: Document,
  merged: Document,
  recordKey: string
): void {
  const record = existing.meta.get(recordKey)
  if (record === undefined) {
    merged.meta.delete(recordKey)
    merged.order = merged.order.filter((key) => key !== recordKey)
  } else {
    merged.meta.set(recordKey, record)
  }
}

function merge(
  existingRaw: string,
  renderedRaw: string,
  keep: Keep,
  retain: Retain = RETAIN_NONE
): string {
  const existing = parseDocument(existingRaw)
  const merged = parseDocument(renderedRaw)

  if (retain.description) {
    merged.meta.set("description", existing.meta.get("description") ?? "")
    retainText(existing, merged, DESCRIPTION_HASH_KEY)
  }
  if (retain.preamble) {
    merged.preamble = existing.preamble
    retainText(existing, merged, PREAMBLE_HASH_KEY)
  }

  const missing: string[] = []
  for (const heading of keep.sections) {
    if (!existing.sections.has(heading)) missing.push(`section:${heading}`)
  }
  const existingTools = splitTools(existing.meta.get("tools"))
  for (const tool of keep.tools) {
    if (!existingTools.includes(tool)) missing.push(`tools:${tool}`)
  }
  for (const key of keep.keys) {
    if (!existing.meta.has(key)) missing.push(`key:${key}`)
  }
  if (missing.length > 0) {
    throw new Error(`keep: not found in existing file: ${missing.join(", ")}`)
  }

  // tools: テンプレートの並びを保ち、保持指定されたものを末尾へ足す。
  const tools = splitTools(merged.meta.get("tools"))
  for (const tool of existingTools) {
    if (keep.tools.has(tool) && !tools.includes(tool)) tools.push(tool)
  }
  merged.meta.set("tools", tools.join(", "))

  // frontmatter キー: 保持指定されたものは既存の値を採る。
  for (const key of keep.keys) {
    const value = existing.meta.get(key)
    if (value === undefined) continue
    if (!merged.order.includes(key)) merged.order.push(key)
    merged.meta.set(key, value)
  }

  if (keep.preamble && existing.preamble !== "") {
    merged.preamble = existing.preamble
  }

  // 節: 保持指定されたものは既存の内容を採る。テンプレートに無い節は末尾へ。
  for (const heading of keep.sections) {
    const content = existing.sections.get(heading)
    if (content === undefined) continue
    merged.sections.set(heading, content)
  }

  return render(merged)
}

function automaticKeep(difference: Diff): string[] {
  return [
    ...difference.frontmatter.toolsOnlyInExisting
      // MCP の付与は --mcp-servers と再検証が決める。既存ファイルの内容を
      // 根拠に残すと、切断済みサーバーのツール名が生き残り続ける。
      .filter((tool) => !tool.startsWith("mcp__"))
      .map((tool) => `tools:${tool}`),
    ...difference.frontmatter.keysOnlyInExisting
      // disallowedTools も同じ理由で保持しない。
      .filter((key) => key !== "disallowedTools")
      .map((key) => `key:${key}`),
    ...difference.body.sectionsOnlyInExisting.map(
      (heading) => `section:${heading}`
    )
  ]
}

function unique(selectors: string[]): string[] {
  return [...new Set(selectors)]
}

function discarded(difference: Diff, keep: Keep, retain: Retain): Discarded {
  if (!difference.exists) {
    return { frontmatterKeys: [], preamble: false, sections: [] }
  }

  return {
    frontmatterKeys: difference.frontmatter.changed
      .map((entry) => entry.key)
      .filter(
        (key) =>
          !keep.keys.has(key) && !(key === "description" && retain.description)
      ),
    preamble: difference.preambleChanged && !keep.preamble && !retain.preamble,
    sections: difference.body.sectionsChanged.filter(
      (heading) => !keep.sections.has(heading)
    )
  }
}

function needsReview(selectors: string[]): string[] {
  return selectors.filter((selector) => selector.startsWith("tools:mcp__"))
}

function write(options: Options, target: Target, mcpServers: string[]) {
  const file = targetPath(options, target)
  const input = composeInputFor(options, target, mcpServers)
  const rendered = templateFor(input)
  const exists = fs.existsSync(file)
  // 既存内容はここで一度だけ読み、自動 keep の抽出と merge の双方へ渡す。
  const existingRaw = exists ? fs.readFileSync(file, "utf8") : undefined
  const difference = compare(options, target, input, rendered, existingRaw)
  const selectors = unique([
    ...(exists && options.merge ? automaticKeep(difference) : []),
    ...options.keep
  ])
  const keep = parseKeep(selectors)
  const shouldMerge =
    existingRaw !== undefined && (options.merge || options.keep.length > 0)
  const retain = shouldMerge
    ? retainFor(options, difference, keep)
    : RETAIN_NONE
  const content = shouldMerge
    ? merge(existingRaw, rendered, keep, retain)
    : rendered
  const kept = shouldMerge ? selectors : []

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)

  return {
    ok: true,
    target: path.relative(options.dir, file).split(path.sep).join("/"),
    action: exists ? (options.merge ? "merged" : "overwritten") : "written",
    kept,
    keptNeedsReview: needsReview(kept),
    discarded: discarded(
      difference,
      shouldMerge ? keep : parseKeep([]),
      retain
    ),
    roles: difference.roles,
    description: difference.description,
    preamble: difference.preamble,
    preambleTexts: difference.preambleTexts,
    toolsBefore:
      existingRaw === undefined
        ? []
        : splitTools(parseDocument(existingRaw).meta.get("tools")),
    toolsAfter: splitTools(parseDocument(content).meta.get("tools"))
  }
}

// --merge は same 以外の description と前置きを既存のまま保持する。
// --replace で指定したものだけテンプレートへ置き換える。--keep の明示指定も保持に数える。
function retainFor(options: Options, difference: Diff, keep: Keep): Retain {
  const replaceDescription = options.replace.includes("description")
  const replacePreamble = options.replace.includes("preamble")
  if (replaceDescription && keep.keys.has("description")) {
    throw new Error(
      "replace: description conflicts with --keep key:description"
    )
  }
  if (replacePreamble && keep.preamble) {
    throw new Error("replace: preamble conflicts with --keep preamble")
  }
  return {
    description:
      keep.keys.has("description") ||
      (options.merge &&
        !replaceDescription &&
        difference.description !== null &&
        difference.description !== "same"),
    preamble:
      keep.preamble ||
      (options.merge &&
        !replacePreamble &&
        difference.preamble !== null &&
        difference.preamble !== "same")
  }
}

// --mcp-servers で渡された名前のうち、claude mcp list で usable なものだけを
// tools へ書く。落としたものは mcpDropped として報告する。
function resolveMcp(options: Options): {
  servers: string[]
  dropped: string[]
} {
  if (options.mcpServers.length === 0) return { servers: [], dropped: [] }
  const usable = usableMcpPrefixes()
  const servers: string[] = []
  const dropped: string[] = []
  for (const name of options.mcpServers) {
    const prefixed = toolPrefix(name)
    if (usable.has(prefixed)) servers.push(prefixed)
    else dropped.push(name)
  }
  return { servers, dropped }
}

// 前回の選択は既存定義から逆算する。専用の設定ファイルは持たない。
function mcpCurrentFor(file: string): McpCurrent {
  if (!fs.existsSync(file)) return { servers: [], denyTools: [] }
  return mcpCurrentOf(fs.readFileSync(file, "utf8"))
}

function setup(options: Options, live: LiveModels): unknown {
  validateFragments(options)
  const resolution = targetsFor(options, live)
  const mcp = resolveMcp(options)
  // 既存定義の MCP は既定で残す。--mcp-servers の明示が無い推奨の保持マージに限る。
  const inherits =
    options.recommended && options.merge && options.mcpServers.length === 0
  let usable: Set<string> | undefined
  const results = resolution.targets.map((target) => {
    const file = targetPath(options, target)
    const current = mcpCurrentFor(file)
    let servers = mcp.servers
    let dropped = mcp.dropped
    let targetOptions = options
    if (inherits && fs.existsSync(file)) {
      usable ??= usableMcpPrefixes()
      const inherited = inheritMcp(fs.readFileSync(file, "utf8"), usable)
      servers = inherited.servers
      dropped = inherited.dropped
      if (options.mcpDeny.length === 0) {
        targetOptions = { ...options, mcpDeny: current.denyTools }
      }
    }
    const result = options.write
      ? write(targetOptions, target, servers)
      : diff(targetOptions, target, servers)
    return {
      ...result,
      modelId: target.modelId,
      ...(target.roleId === undefined ? {} : { roleId: target.roleId }),
      mcpCurrent: current,
      mcpDropped: dropped
    }
  })
  return {
    ok: true,
    results,
    warnings: resolution.warnings
  }
}

function usableMcpPrefixes(): Set<string> {
  return new Set(
    listMcpServers(process.env)
      .filter((server) => server.usable)
      .map((server) => toolPrefix(server.name))
  )
}

// 既存の tools にある mcp__ の項目を、接続を再検証して引き継ぐ。
// サーバー単位の項目もツール単位の項目も、そのサーバーが usable なら残す。
function inheritMcp(
  content: string,
  usable: Set<string>
): { servers: string[]; dropped: string[] } {
  const entries = splitTools(parseDocument(content).meta.get("tools")).filter(
    (tool) => tool.startsWith("mcp__")
  )
  const servers: string[] = []
  const dropped: string[] = []
  for (const entry of entries) {
    const alive = [...usable].some(
      (prefix) => entry === prefix || entry.startsWith(`${prefix}__`)
    )
    if (alive) servers.push(entry)
    else dropped.push(entry.slice("mcp__".length))
  }
  return { servers, dropped }
}

// live の実在モデルへ、RECOMMENDED の既定エイリアス一致で役割を添える。
function listLiveModels(live: LiveModels, scope: CandidateScope): unknown {
  const claudeEnums = [...CLAUDE_ENUM_MODELS]
  if (scope === "claude-only") {
    return {
      ok: true,
      models: [],
      claudeEnums
    }
  }
  if (!live.ok) {
    return {
      ok: false,
      reason: live.reason,
      models: [],
      claudeEnums
    }
  }

  return {
    ok: true,
    models: live.ids.map((id) => ({
      id,
      vendor: live.vendors[id] ?? "unknown",
      recommendedFor: recommendedForAlias(id)
    })),
    claudeEnums
  }
}

function listMcp(): unknown {
  return { ok: true, servers: listMcpServers(process.env) }
}

function listAvailableRoles(options: Options): unknown {
  const dirs: FragmentDir[] = fragmentDirsFor(
    pluginRoot(),
    options.dir,
    options.lang
  )
  const fragments: Map<string, Fragment> = loadFragments(dirs)
  // 第 3 段(プロジェクト独自)は言語別ディレクトリより優先されるため、
  // lang が ja 以外でもここ由来の断片は元の言語のまま合成へ入る。
  const ownDir = dirs.at(-1)?.path

  const roles = [...fragments.values()]
    .sort(
      (left, right) =>
        roleOrder(left.id) - roleOrder(right.id) ||
        left.id.localeCompare(right.id)
    )
    .map((fragment) => ({
      id: fragment.id,
      label: fragment.label,
      kind: fragment.kind,
      tools: fragment.tools,
      source: fragment.source,
      languageMismatch:
        options.lang !== "ja" &&
        fragment.source === "project" &&
        ownDir !== undefined &&
        fs.existsSync(path.join(ownDir, `${fragment.id}.md`))
    }))

  return { ok: true, lang: options.lang, roles }
}

function coveredDefinitions(
  projectDir: string,
  roleIds: RoleId[],
  scope: CandidateScope
): Map<RoleId, string[]> {
  const covered = new Map<RoleId, string[]>(
    roleIds.map((roleId) => [roleId, []])
  )
  for (const definition of scopedDefinitions(projectDir, scope)) {
    for (const roleId of definition.markerIds) {
      covered.get(roleId as RoleId)?.push(definition.name)
    }
  }
  return covered
}

interface ScopedDefinition {
  name: string
  /** ファイル名から .md を除いた値。再生成の作成先に使う。 */
  file: string
  model: string | undefined
  vendor: string | undefined
  markerIds: string[]
}

// マーカーを持つ定義のうち、その構成で被覆に数えるもの。
// claude-only では、外部ベンダーのモデルを指定した定義を数えない。
function scopedDefinitions(
  projectDir: string,
  scope: CandidateScope
): ScopedDefinition[] {
  const agentsDir = path.join(projectDir, ".claude", "agents")
  if (!fs.existsSync(agentsDir)) return []

  const definitions: ScopedDefinition[] = []
  for (const file of fs.readdirSync(agentsDir).sort()) {
    if (!file.endsWith(".md")) continue
    // 1 ファイルが読めなくても、他の定義と全体の応答は生かす。
    try {
      const document = parseDocument(
        fs.readFileSync(path.join(agentsDir, file), "utf8")
      )
      const marker = document.meta.get("agent-policy-role")
      if (marker === undefined) continue
      const model = document.meta.get("model")
      const vendor = document.meta.get("agent-policy-vendor")
      if (
        scope === "claude-only" &&
        (!runsOnClaude(model) ||
          (vendor !== undefined && vendor !== "claude" && vendor !== "none"))
      ) {
        continue
      }
      const base = file.replace(/\.md$/, "")
      definitions.push({
        name: document.meta.get("name") ?? base,
        file: base,
        model,
        vendor,
        markerIds: splitList(marker)
      })
    } catch {}
  }
  return definitions
}

// model 値から推奨モデル ID を逆引きする。Claude enum は同名の ID に当たる。
function modelIdOf(model: string | null | undefined): ModelId | null {
  if (model === null || model === undefined) return null
  return MODELS.find((spec) => spec.model === model)?.id ?? null
}

function isVendor(value: string): value is Vendor {
  return (
    value === "gpt" ||
    value === "grok" ||
    value === "claude" ||
    value === "none"
  )
}

// 被覆する定義がちょうど 1 件の役割は、その定義を作成先にする。
// 作成先を決められない役割は undefined を返し、理由を warnings に足す。
// 被覆されていない役割は null を返し、呼び出し側が既定名で作る。
function coveringTarget(
  role: RoleId,
  covering: ScopedDefinition[],
  fragments: Map<string, Fragment>,
  live: LiveModels,
  warnings: string[]
): Target | null | undefined {
  if (covering.length === 0) return null
  const [definition] = covering
  if (covering.length > 1 || definition === undefined) {
    warnings.push(
      `roles: ${role} is covered by ${covering.map((entry) => entry.file).join(", ")}; not regenerated`
    )
    return undefined
  }
  // 作り直すと解決できない ID がマーカーから落ちるため、点検で外し終えるまで触らない。
  const unresolved = definition.markerIds.filter((id) => !fragments.has(id))
  if (unresolved.length > 0) {
    warnings.push(
      `roles: ${definition.file} declares retired or unknown role ids (${unresolved.join(", ")}); not regenerated`
    )
    return undefined
  }
  const modelId = modelIdOf(definition.model)
  if (modelId === null || definition.model === undefined) {
    warnings.push(
      `model: ${definition.file} declares model "${definition.model ?? ""}" that matches no model id; not regenerated`
    )
    return undefined
  }
  const vendor = definition.vendor ?? "none"
  if (!isVendor(vendor)) {
    warnings.push(
      `vendor: ${definition.file} declares unknown vendor "${vendor}"; not regenerated`
    )
    return undefined
  }
  if (live.ok && !modelIsAvailable(definition.model, live)) {
    warnings.push(
      `model: ${definition.file} declares model "${definition.model}" that was not found in live models; not regenerated`
    )
    return undefined
  }
  return {
    roleId: role,
    modelId,
    name: definition.file,
    model: definition.model,
    roles: definition.markerIds.filter((id) => fragments.has(id)) as RoleId[],
    color: VENDOR_COLORS[vendor],
    vendor
  }
}

// default-name は言語に依存しない契約だが、この版より前に scaffold した
// 翻訳断片は持っていない。bodyHash は frontmatter を除外するため stale にも
// ならず、再 scaffold も促されない。同梱英語断片の値へ落として補う。
// 組み込みに無い独自役割は補えないため undefined のまま返す。
function bundledDefaultNames(projectDir: string): Map<string, string> {
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), projectDir, "en").filter(
      (dir) => dir.source === "plugin"
    )
  )
  const names = new Map<string, string>()
  for (const [id, fragment] of fragments) {
    if (fragment.defaultName !== undefined) {
      names.set(id, fragment.defaultName)
    }
  }
  return names
}

type ToolsFormat = "csv" | "other" | "none"

// 1 行のカンマ区切りだけを csv とする。行単位の書き換えはこの書式にだけ効く。
function toolsFormatOf(raw: string | string[] | undefined): ToolsFormat {
  if (raw === undefined) return "none"
  if (Array.isArray(raw)) return "other"
  const value = raw.trim()
  if (value === "" || /^[[{|>]/.test(value) || /["'()#]/.test(value)) {
    return "other"
  }
  return "csv"
}

// frontmatter() は字下げ付きのキーも読み、同じキーは後勝ちにする。
// 書き換える行を 1 行に特定できるのは、字下げの無い行がちょうど 1 行のときだけである。
function keyLinesOf(lines: string[], close: number, key: string): number[] {
  const pattern = new RegExp(`^\\s*${key}\\s*:`)
  return lines
    .slice(1, Math.max(close, 1))
    .flatMap((line, index) => (pattern.test(line) ? [index + 1] : []))
}

function keyLineAmbiguous(
  lines: string[],
  close: number,
  key: string
): boolean {
  const found = keyLinesOf(lines, close, key)
  return found.length > 1 || /^\s/.test(lines[found[0] ?? -1] ?? "")
}

// 役割の許可集合に無い組み込みツールを返す。mcp__ は --mcp-servers が決めるので見ない。
// 解決できる役割が無い定義は、許可集合を決められないため Agent だけを返す。
function disallowedToolsOf(
  tools: string[] | undefined,
  format: ToolsFormat,
  selected: Fragment[]
): string[] {
  if (selected.length === 0) {
    return (tools ?? []).filter((tool) => tool === "Agent")
  }
  if (format === "none") return ["*"]
  const allowed = resolveToolsFor(selected, [])
  return (tools ?? []).filter(
    (tool) => !tool.startsWith("mcp__") && !allowed.includes(tool)
  )
}

function stringValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

// マーカーを持つ定義をスコープで絞らずに点検する。
function inspectDefinitions(
  projectDir: string,
  fragments: Map<string, Fragment>
): unknown[] {
  const agentsDir = path.join(projectDir, ".claude", "agents")
  if (!fs.existsSync(agentsDir)) return []

  const definitions: unknown[] = []
  for (const file of fs.readdirSync(agentsDir).sort()) {
    if (!file.endsWith(".md")) continue
    let meta: Map<string, string | string[]>
    let lines: string[]
    // 1 ファイルが読めなくても、他の定義と全体の応答は生かす。
    try {
      meta = frontmatter(path.join(agentsDir, file))
      lines = fs.readFileSync(path.join(agentsDir, file), "utf8").split("\n")
    } catch {
      continue
    }
    const marker = meta.get("agent-policy-role")
    if (typeof marker !== "string") continue

    const ids = splitList(marker)
    const selected = ids.flatMap((id) => {
      const fragment = fragments.get(id)
      return fragment === undefined ? [] : [fragment]
    })
    const rawTools = meta.get("tools")
    // 書き換え側が 1 行に特定できない定義は、手で直す側へ寄せる。
    const close = lines.indexOf("---", 1)
    const toolsFormat =
      keyLineAmbiguous(lines, close, "tools") ||
      keyLineAmbiguous(lines, close, "agent-policy-role")
        ? "other"
        : toolsFormatOf(rawTools)
    definitions.push({
      name: stringValue(meta.get("name")) ?? file.replace(/\.md$/, ""),
      file: path.posix.join(".claude", "agents", file),
      model: stringValue(meta.get("model")),
      modelId: modelIdOf(stringValue(meta.get("model"))),
      vendor: stringValue(meta.get("agent-policy-vendor")),
      roles: selected.map((fragment) => fragment.id),
      retiredRoles: ids.filter(isRetiredRole).map((id) => ({
        id,
        replacement: RETIRED_ROLE_REPLACEMENTS[id] ?? null
      })),
      unknownRoles: ids.filter(
        (id) => !isRetiredRole(id) && !fragments.has(id)
      ),
      disallowedTools: disallowedToolsOf(
        parseToolsField(rawTools),
        toolsFormat,
        selected
      ),
      toolsFormat
    })
  }
  return definitions
}

function listCoverage(options: Options): unknown {
  const roleIds = sortRoleIds(Object.keys(RECOMMENDED) as RoleId[])
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), options.dir, options.lang)
  )
  const covered = coveredDefinitions(options.dir, roleIds, options.scope)
  const fallbackNames =
    options.lang === "en"
      ? undefined
      : roleIds.some((id) => fragments.get(id)?.defaultName === undefined)
        ? bundledDefaultNames(options.dir)
        : undefined
  const roles = roleIds.map((id) => {
    const fragment = fragments.get(id)
    if (fragment === undefined) {
      throw new Error(`Role fragment not found: ${id}`)
    }
    return {
      id,
      label: fragment.label,
      kind: fragment.kind,
      defaultName: fragment.defaultName ?? fallbackNames?.get(id),
      models:
        options.scope === "claude-only"
          ? ASSIGNMENTS["claude-model-policy"][id]
          : RECOMMENDED[id],
      coveredBy: covered.get(id) ?? []
    }
  })

  return {
    ok: true,
    roles,
    uncovered: roles
      .filter((role) => role.coveredBy.length === 0)
      .map((role) => role.id),
    definitions: inspectDefinitions(options.dir, fragments),
    modelBreakdown: modelBreakdownOf(options.dir)
  }
}

// マーカー付き定義を、claude 構成で被覆に数えるものとそれ以外に分けて数える。
// --scope に依らず、構成を選ぶ前の質問で使う。
function modelBreakdownOf(projectDir: string): {
  claude: number
  external: number
} {
  const all = scopedDefinitions(projectDir, "with-external").length
  const claude = scopedDefinitions(projectDir, "claude-only").length
  return { claude, external: all - claude }
}

interface DefinitionLines {
  file: string
  target: string
  lines: string[]
  close: number
}

// 既存定義の 1 行だけを文字列として差し替えるための読み込み。parseDocument /
// render を通すと空行・コメント・block 配列が落ちるため使わない。
function readDefinition(options: Options): DefinitionLines {
  const file = path.join(options.dir, ".claude", "agents", `${options.name}.md`)
  const target = path.relative(options.dir, file).split(path.sep).join("/")
  if (!fs.existsSync(file)) {
    throw new Error(`target: ${target} が存在しない`)
  }
  const raw = fs.readFileSync(file, "utf8")
  const lines = raw.split("\n")
  const close = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) : -1
  if (close === -1) {
    throw new Error(
      raw.includes("\r\n")
        ? `target: ${target} の frontmatter を読み取れない。改行コードが CRLF の可能性がある(CRLF の定義は書き換えの対象外)`
        : `target: ${target} に frontmatter が無い`
    )
  }
  return { file, target, lines, close }
}

function keyLineIndex(definition: DefinitionLines, key: string): number {
  const { lines, close } = definition
  if (keyLineAmbiguous(lines, close, key)) {
    throw new Error(
      `${key}: ${definition.target} の ${key} 行を 1 行に特定できないため書き換えない(同じキーが複数ある、または字下げされている)`
    )
  }
  return keyLinesOf(lines, close, key)[0] ?? -1
}

function lineValue(line: string | undefined): string {
  if (line === undefined) return ""
  return line.slice(line.indexOf(":") + 1)
}

function writeDefinition(definition: DefinitionLines): void {
  fs.writeFileSync(definition.file, definition.lines.join("\n"))
}

function definitionFragments(
  options: Options,
  ids: string[]
): { fragments: Map<string, Fragment>; selected: Fragment[] } {
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), options.dir, options.lang)
  )
  const selected = ids.flatMap((id) => {
    const fragment = fragments.get(id)
    return fragment === undefined ? [] : [fragment]
  })
  return { fragments, selected }
}

// tools 欄の無い定義へ、役割の許可集合を name 行の直後に 1 行で足す。
function addToolsLine(definition: DefinitionLines, options: Options): unknown {
  if (options.tools.length > 1) {
    throw new Error('tools: "*" は他のツールと併用できない')
  }
  if (keyLineIndex(definition, "tools") !== -1) {
    throw new Error(`tools: ${definition.target} には tools 欄が既にある`)
  }
  const marker = keyLineIndex(definition, "agent-policy-role")
  const ids =
    marker === -1 ? [] : splitList(lineValue(definition.lines[marker]))
  const { selected } = definitionFragments(options, ids)
  if (selected.length === 0) {
    throw new Error(
      `roles: ${definition.target} には解決できる役割が無く、許可するツールを決められない`
    )
  }
  const nameLine = keyLineIndex(definition, "name")
  if (nameLine === -1) {
    throw new Error(`name: ${definition.target} に name 行が無い`)
  }
  definition.lines.splice(
    nameLine + 1,
    0,
    `tools: ${resolveToolsFor(selected, []).join(", ")}`
  )
  writeDefinition(definition)
  return { ok: true, target: definition.target, changed: true, warnings: [] }
}

function pruneTools(options: Options): unknown {
  const definition = readDefinition(options)
  if (options.tools.includes("*")) return addToolsLine(definition, options)

  const index = keyLineIndex(definition, "tools")
  if (index === -1) {
    throw new Error(`tools: ${definition.target} に tools 行が無い`)
  }
  const line = definition.lines[index] ?? ""
  const value = lineValue(line)
  if (toolsFormatOf(value) !== "csv") {
    throw new Error(
      `tools: ${definition.target} の tools は未対応の書式のため書き換えない。1 行のカンマ区切りだけを扱う`
    )
  }

  const current = splitTools(value)
  const warnings = options.tools
    .filter((tool) => !current.includes(tool))
    .map((tool) => `tools: ${tool} は tools 行に無いため無視した`)
  const remaining = current.filter((tool) => !options.tools.includes(tool))
  if (remaining.length === current.length) {
    return { ok: true, target: definition.target, changed: false, warnings }
  }
  // 空の tools は全ツール継承と区別できないため、残りが無くなる削除は拒む。
  if (remaining.length === 0) {
    throw new Error(
      `tools: ${definition.target} のツールがすべて外れるため書き換えない`
    )
  }
  definition.lines[index] =
    `${line.slice(0, line.indexOf(":") + 1)} ${remaining.join(", ")}`
  writeDefinition(definition)
  return { ok: true, target: definition.target, changed: true, warnings }
}

function rewriteRoles(options: Options): unknown {
  const definition = readDefinition(options)
  const { fragments } = definitionFragments(options, [])
  const invalid = options.roles.filter((id) => !fragments.has(id))
  if (invalid.length > 0) {
    throw new Error(
      `roles: ${invalid.join(", ")} は廃止済みか未知の役割 ID のため書き込まない`
    )
  }
  const index = keyLineIndex(definition, "agent-policy-role")
  if (index === -1) {
    throw new Error(`roles: ${definition.target} に agent-policy-role 行が無い`)
  }

  const before = definition.lines[index]
  if (options.roles.length === 0) {
    definition.lines.splice(index, 1)
  } else {
    definition.lines[index] = `agent-policy-role: ${options.roles.join(", ")}`
  }
  const changed =
    options.roles.length === 0 || definition.lines[index] !== before
  if (changed) writeDefinition(definition)
  return { ok: true, target: definition.target, changed, warnings: [] }
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    scope:
      candidateScopeFor(process.env.AMATSUKA_AGENT_AUTO_INJECTION) ??
      "claude-only",
    modelId: "",
    recommended: false,
    name: "",
    model: "",
    vendor: "",
    roles: [],
    dir: process.cwd(),
    lang: "ja",
    mcpServers: [],
    mcpDeny: [],
    write: false,
    merge: false,
    listLiveModels: false,
    listRoles: false,
    listCoverage: false,
    listMcp: false,
    checkFragments: false,
    scaffoldFragments: false,
    keep: [],
    pruneTools: false,
    rewriteRoles: false,
    tools: [],
    replace: []
  }
  const seen = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg !== undefined) seen.add(arg)
    switch (arg) {
      case "--policy":
      case "--list-policies":
      case "--list-models":
        throw new Error(
          `Unsupported option: ${arg} was removed; use --scope claude|custom to choose the candidate scope`
        )
      case "--models":
        throw new Error(
          "Unsupported option: --models was removed; use --recommended"
        )
      case "--scope":
        if (value !== "claude" && value !== "custom") {
          throw new Error("scope: must be claude or custom")
        }
        options.scope = value === "claude" ? "claude-only" : "with-external"
        index += 1
        break
      case "--model-id":
        options.modelId = requireValue(value, "model-id")
        index += 1
        break
      case "--recommended":
        options.recommended = true
        break
      case "--name":
        options.name = requireValue(value, "name")
        index += 1
        break
      case "--model":
        options.model = requireValue(value, "model")
        index += 1
        break
      case "--vendor":
        if (
          value !== "gpt" &&
          value !== "grok" &&
          value !== "claude" &&
          value !== "none"
        ) {
          throw new Error("vendor: must be gpt, grok, claude or none")
        }
        options.vendor = value
        index += 1
        break
      case "--roles":
        options.roles = splitList(requireValue(value, "roles")) as RoleId[]
        index += 1
        break
      case "--dir":
        options.dir = path.resolve(requireValue(value, "dir"))
        index += 1
        break
      case "--lang":
        options.lang = requireValue(value, "lang")
        index += 1
        break
      case "--mcp-servers":
        options.mcpServers = splitList(requireValue(value, "mcp-servers"))
        index += 1
        break
      case "--mcp-deny":
        options.mcpDeny = splitList(requireValue(value, "mcp-deny"))
        index += 1
        break
      case "--check":
        // 差分表示は既定動作。後方互換のため引数だけ受け付ける。
        break
      case "--write":
        options.write = true
        break
      case "--merge":
        options.merge = true
        break
      case "--list-live-models":
        options.listLiveModels = true
        break
      case "--list-roles":
        options.listRoles = true
        break
      case "--list-coverage":
        options.listCoverage = true
        break
      case "--list-mcp":
        options.listMcp = true
        break
      case "--check-fragments":
        options.checkFragments = true
        break
      case "--scaffold-fragments":
        options.scaffoldFragments = true
        break
      case "--keep":
        options.keep.push(requireValue(value, "keep"))
        index += 1
        break
      case "--prune-tools":
        options.pruneTools = true
        break
      case "--rewrite-roles":
        options.rewriteRoles = true
        break
      case "--tools":
        options.tools = splitList(requireValue(value, "tools"))
        index += 1
        break
      case "--replace":
        options.replace = splitList(requireValue(value, "replace"))
        for (const entry of options.replace) {
          if (entry !== "description" && entry !== "preamble") {
            throw new Error("replace: must be description or preamble")
          }
        }
        index += 1
        break
      default:
        throw new Error(`Unsupported option: ${arg}`)
    }
  }

  if (options.recommended) {
    for (const [flag, supplied] of [
      ["--model-id", options.modelId !== ""],
      ["--name", options.name !== ""],
      ["--model", options.model !== ""],
      ["--vendor", options.vendor !== ""],
      ["--keep", options.keep.length > 0],
      ["--replace", options.replace.length > 0]
    ] as const) {
      if (supplied)
        throw new Error(`${flag}: cannot be used with --recommended`)
    }
  }
  if (options.name !== "" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.name)) {
    throw new Error("name: must be lowercase letters, digits and hyphens")
  }
  if (options.pruneTools || options.rewriteRoles) {
    const operation = options.pruneTools ? "--prune-tools" : "--rewrite-roles"
    const accepted = new Set([
      operation,
      "--name",
      "--dir",
      options.pruneTools ? "--tools" : "--roles"
    ])
    for (const flag of seen) {
      if (!accepted.has(flag)) {
        throw new Error(`${flag}: cannot be used with ${operation}`)
      }
    }
    if (options.name === "") throw new Error("name: is required")
    if (options.pruneTools && options.tools.length === 0) {
      throw new Error("tools: is required")
    }
    if (options.rewriteRoles && !seen.has("--roles")) {
      throw new Error("roles: is required")
    }
    return options
  }
  if (seen.has("--tools")) throw new Error("tools: requires --prune-tools")
  if (
    options.listLiveModels ||
    options.listRoles ||
    options.listCoverage ||
    options.listMcp ||
    options.checkFragments ||
    options.scaffoldFragments
  ) {
    return options
  }
  if (options.merge && !options.write)
    throw new Error("merge: requires --write")
  if (options.replace.length > 0 && !options.merge)
    throw new Error("replace: requires --merge")
  if (options.recommended) return options
  if (options.name === "") throw new Error("name: is required")
  if (options.modelId === "") throw new Error("model-id: is required")
  if (options.roles.length === 0) throw new Error("roles: is required")
  return options
}

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "")
    )
  ]
}

function requireValue(value: string | undefined, field: string): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${field}: is required`)
  }
  return value
}

function respond(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.pruneTools) {
      respond(pruneTools(options))
    } else if (options.rewriteRoles) {
      respond(rewriteRoles(options))
    } else if (options.listLiveModels) {
      const live =
        options.scope === "claude-only"
          ? { ok: true, ids: [], vendors: {} }
          : await fetchLiveModels(process.env)
      respond(listLiveModels(live, options.scope))
    } else if (options.listCoverage) {
      respond(listCoverage(options))
    } else if (options.listMcp) {
      respond(listMcp())
    } else if (options.checkFragments) {
      respond({
        ok: true,
        ...checkFragments(pluginRoot(), options.dir, options.lang)
      })
    } else if (options.scaffoldFragments) {
      const written = scaffoldFragments(pluginRoot(), options.dir, options.lang)
      respond({
        ok: true,
        lang: options.lang,
        written: written.map((file) =>
          path.relative(options.dir, file).split(path.sep).join("/")
        )
      })
    } else if (options.listRoles) {
      respond(listAvailableRoles(options))
    } else {
      const live =
        options.scope === "claude-only"
          ? { ok: true, ids: [], vendors: {} }
          : await fetchLiveModels(process.env)
      respond(setup(options, live))
    }
  } catch (error) {
    respond({
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error",
      results: []
    })
    process.exitCode = 1
  }
}

await main()
