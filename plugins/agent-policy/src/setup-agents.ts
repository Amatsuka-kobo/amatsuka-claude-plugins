import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  type ComposeInput,
  compose,
  describeRoles,
  type RolesSummary
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
  MODELS,
  type ModelId,
  type ModelSpec,
  modelById,
  RECOMMENDED,
  runsOnClaude
} from "./agents/policies"
import { type RoleId, roleById, roleOrder, sortRoleIds } from "./agents/roles"

interface Options {
  scope: CandidateScope
  modelId: string
  models: ModelId[]
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
}

interface Target {
  modelId: ModelId
  composeModelId?: ModelId
  name: string
  model: string
  roles: RoleId[]
  color: string
  vendor: Vendor
}

interface TargetResolution {
  targets: Target[]
  warnings: string[]
  modelsDropped: ModelId[]
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

function recommendedRolesFor(modelId: ModelId): RoleId[] {
  return sortRoleIds(
    (Object.entries(RECOMMENDED) as [RoleId, ModelId[]][])
      .filter(([, models]) => models.includes(modelId))
      .map(([role]) => role)
  )
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

function defaultAgentName(options: Options, spec: ModelSpec): string {
  const roles = recommendedRolesFor(spec.id)
  if (roles.length !== 1) return spec.id

  const role = roles[0]
  if (role === undefined) return spec.id
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

// --models は RECOMMENDED から既定名・既定役割を、--model-id は明示指定で
// 1 件を作る。live models が取れない場合は、推奨 ModelSpec の既定値を使う。
function targetsFor(options: Options, live: LiveModels): TargetResolution {
  const warnings = live.ok ? [] : [unavailableWarning(live)]
  if (options.models.length > 0) {
    const specs = options.models.map((id) => {
      const spec = modelById(id)
      if (spec === undefined) throw new Error(`models: ${id} is unknown`)
      return spec
    })
    const candidates =
      options.scope === "claude-only"
        ? specs.filter((spec) => spec.vendor === "claude")
        : specs
    const scopeDropped =
      options.scope === "claude-only"
        ? specs
            .filter((spec) => spec.vendor !== "claude")
            .map((spec) => spec.id)
        : []
    const included = live.ok
      ? candidates.filter((spec) => modelIsAvailable(spec.model, live))
      : candidates
    const unavailableDropped = live.ok
      ? candidates
          .filter((spec) => !modelIsAvailable(spec.model, live))
          .map((spec) => spec.id)
      : []

    return {
      warnings,
      modelsDropped: [...scopeDropped, ...unavailableDropped],
      targets: included.map((spec) => {
        const vendor = resolveVendor(options, spec.model, spec, live)
        return {
          modelId: spec.id,
          composeModelId: spec.id,
          name: defaultAgentName(options, spec),
          model: spec.model,
          roles: recommendedRolesFor(spec.id),
          color: VENDOR_COLORS[vendor],
          vendor
        }
      })
    }
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
    modelsDropped: [],
    targets: [
      {
        modelId: spec.id,
        composeModelId: options.model === "" ? spec.id : undefined,
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
    modelId: target.composeModelId,
    vendor: target.vendor,
    roleIds: target.roles,
    fragmentDirs: fragmentDirsFor(pluginRoot(), options.dir, options.lang),
    lang: options.lang,
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
      roles
    }
  }

  const existing = parseDocument(existingRaw)
  const expected = parseDocument(rendered)

  const existingTools = splitTools(existing.meta.get("tools"))
  const expectedTools = splitTools(expected.meta.get("tools"))

  const changed: Diff["frontmatter"]["changed"] = []
  for (const [key, value] of expected.meta) {
    if (key === "tools") continue
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
    roles
  }
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

function merge(existingRaw: string, renderedRaw: string, keep: Keep): string {
  const existing = parseDocument(existingRaw)
  const merged = parseDocument(renderedRaw)

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

function discarded(difference: Diff, keep: Keep): Discarded {
  if (!difference.exists) {
    return { frontmatterKeys: [], preamble: false, sections: [] }
  }

  return {
    frontmatterKeys: difference.frontmatter.changed
      .map((entry) => entry.key)
      .filter((key) => !keep.keys.has(key)),
    preamble: difference.preambleChanged && !keep.preamble,
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
  const content = shouldMerge ? merge(existingRaw, rendered, keep) : rendered
  const kept = shouldMerge ? selectors : []

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)

  return {
    ok: true,
    target: path.relative(options.dir, file).split(path.sep).join("/"),
    action: exists ? (options.merge ? "merged" : "overwritten") : "written",
    kept,
    keptNeedsReview: needsReview(kept),
    discarded: discarded(difference, shouldMerge ? keep : parseKeep([])),
    roles: difference.roles
  }
}

// --mcp-servers で渡された名前のうち、claude mcp list で usable なものだけを
// tools へ書く。落としたものは mcpDropped として報告する。
function resolveMcp(options: Options): {
  servers: string[]
  dropped: string[]
} {
  if (options.mcpServers.length === 0) return { servers: [], dropped: [] }
  const usable = new Set(
    listMcpServers(process.env)
      .filter((server) => server.usable)
      .map((server) => toolPrefix(server.name))
  )
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
  const results = resolution.targets.map((target) => {
    const current = mcpCurrentFor(targetPath(options, target))
    const result = options.write
      ? write(options, target, mcp.servers)
      : diff(options, target, mcp.servers)
    return {
      ...result,
      modelId: target.modelId,
      mcpCurrent: current,
      mcpDropped: mcp.dropped
    }
  })
  return {
    ok: true,
    results,
    warnings: resolution.warnings,
    modelsDropped: resolution.modelsDropped
  }
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
  const agentsDir = path.join(projectDir, ".claude", "agents")
  if (!fs.existsSync(agentsDir)) return covered

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
      const name = document.meta.get("name") ?? file.replace(/\.md$/, "")
      for (const roleId of splitList(marker)) {
        covered.get(roleId as RoleId)?.push(name)
      }
    } catch {}
  }

  return covered
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
      .map((role) => role.id)
  }
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    scope:
      candidateScopeFor(process.env.AMATSUKA_AGENT_AUTO_INJECTION) ??
      "claude-only",
    modelId: "",
    models: [],
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
    keep: []
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    switch (arg) {
      case "--policy":
      case "--list-policies":
      case "--list-models":
        throw new Error(
          `Unsupported option: ${arg} was removed; use --scope claude|custom to choose the candidate scope`
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
      case "--models":
        options.models = splitList(requireValue(value, "models")) as ModelId[]
        index += 1
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
      default:
        throw new Error(`Unsupported option: ${arg}`)
    }
  }

  if (options.name !== "" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.name)) {
    throw new Error("name: must be lowercase letters, digits and hyphens")
  }
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
  if (options.models.length > 0) {
    if (options.keep.length > 0) {
      throw new Error("keep: cannot be used with --models")
    }
    return options
  }
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
    if (options.listLiveModels) {
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
