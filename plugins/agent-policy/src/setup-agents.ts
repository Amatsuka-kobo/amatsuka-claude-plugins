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
import {
  listMcpServers,
  type McpCurrent,
  mcpCurrentOf,
  toolPrefix
} from "./agents/mcp"
import {
  type ModelId,
  type ModelSpec,
  modelById,
  modelsFor,
  POLICIES,
  type PolicyName,
  policyById,
  policyForInjection,
  resolveModelValue,
  rolesFor
} from "./agents/policies"
import { type RoleId, roleById, roleOrder } from "./agents/roles"

interface Options {
  policy: string
  modelId: string
  models: ModelId[]
  name: string
  model: string
  roles: RoleId[]
  dir: string
  lang: string
  mcpServers: string[]
  mcpDeny: string[]
  check: boolean
  write: boolean
  merge: boolean
  listPolicies: boolean
  listModels: boolean
  listRoles: boolean
  listMcp: boolean
  checkFragments: boolean
  scaffoldFragments: boolean
  keep: string[]
}

interface Target {
  modelId: ModelId
  name: string
  model: string
  roles: RoleId[]
  color: string
  vendor: Vendor
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

function requirePolicy(options: Options): PolicyName {
  const policy = policyById(options.policy)
  if (policy === undefined) {
    throw new Error(
      `policy: must be one of ${POLICIES.map((entry) => entry.id).join(", ")}`
    )
  }
  return policy.id
}

function requireModel(options: Options, policy: PolicyName): ModelSpec {
  const spec = modelById(options.modelId)
  if (spec === undefined) throw new Error("model-id: is unknown")
  if (!modelsFor(policy).some((entry) => entry.id === spec.id)) {
    throw new Error(`model-id: ${spec.id} is not used in ${policy}`)
  }
  return spec
}

function validateRoles(
  options: Options,
  policy: PolicyName,
  model: ModelSpec
): void {
  const allowed = new Set<string>(rolesFor(policy, model.id))
  // 組み込み役割だけを担当表で検証する。プロジェクト独自役割は担当表に
  // 現れないため、ここで弾くと既存利用者が setup を実行できなくなる。
  const invalid = options.roles.filter(
    (role) => roleById(role) !== undefined && !allowed.has(role)
  )
  if (invalid.length > 0) {
    throw new Error(
      `roles: ${invalid.join(", ")} is not assigned to ${model.id} in ${policy}`
    )
  }
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

// --models は既定名・既定役割で複数を、--model-id は明示指定で 1 件を作る。
function targetsFor(options: Options, policy: PolicyName): Target[] {
  if (options.models.length > 0) {
    return options.models.map((id) => {
      const spec = modelById(id)
      if (spec === undefined) throw new Error(`models: ${id} is unknown`)
      if (!modelsFor(policy).some((entry) => entry.id === spec.id)) {
        throw new Error(`models: ${id} is not used in ${policy}`)
      }
      return {
        modelId: spec.id,
        name: spec.defaultName,
        model: resolveModelValue(spec, process.env),
        roles: rolesFor(policy, spec.id),
        color: spec.color,
        vendor: spec.vendor
      }
    })
  }

  const spec = requireModel(options, policy)
  validateRoles(options, policy, spec)
  return [
    {
      modelId: spec.id,
      name: options.name,
      model:
        options.model === ""
          ? resolveModelValue(spec, process.env)
          : options.model,
      roles: options.roles,
      color: spec.color,
      vendor: spec.vendor
    }
  ]
}

// color を必ず渡す。渡さないと COLORS[vendor] にフォールバックし、
// Claude 帯の 4 定義がすべて blue になる。
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
  return selectors.filter(
    (selector) =>
      selector.startsWith("tools:mcp__") || selector === "section:## ツール運用"
  )
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

function setup(options: Options): unknown {
  const policy = requirePolicy(options)
  validateFragments(options)
  const targets = targetsFor(options, policy)
  const mcp = resolveMcp(options)
  const results = targets.map((target) => {
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
  return { ok: true, results }
}

// injected は AMATSUKA_AGENT_AUTO_INJECTION が解決するポリシー ID である。
// 未設定・none・未知の値はいずれも SessionStart フックが方針を注入しない
// ケースであり、まとめて null を返す。スキルはこれを見て、ポリシーの
// 第一候補と CLAUDE.md への追記案内の要否を決める。
function listPolicies(env: NodeJS.ProcessEnv): unknown {
  return {
    ok: true,
    injected: policyForInjection(env.AMATSUKA_AGENT_AUTO_INJECTION) ?? null,
    policies: POLICIES.map(({ id, label, injection }) => ({
      id,
      label,
      injection
    }))
  }
}

function listModels(options: Options): unknown {
  const policy = requirePolicy(options)
  return {
    ok: true,
    policy,
    models: modelsFor(policy).map((spec) => ({
      id: spec.id,
      label: spec.label,
      defaultName: spec.defaultName,
      model: resolveModelValue(spec, process.env),
      vendor: spec.vendor,
      color: spec.color,
      roles: rolesFor(policy, spec.id)
    }))
  }
}

function listMcp(): unknown {
  return { ok: true, servers: listMcpServers(process.env) }
}

function listAvailableRoles(options: Options): unknown {
  const policy = requirePolicy(options)
  const model = requireModel(options, policy)
  const allowed = new Set<string>(rolesFor(policy, model.id))
  const dirs: FragmentDir[] = fragmentDirsFor(
    pluginRoot(),
    options.dir,
    options.lang
  )
  const fragments: Map<string, Fragment> = loadFragments(dirs, model.vendor)
  // 第 3 段(プロジェクト独自)は言語別ディレクトリより優先されるため、
  // lang が ja 以外でもここ由来の断片は元の言語のまま合成へ入る。
  const ownDir = dirs.at(-1)?.path

  const roles = [...fragments.values()]
    .filter(
      (fragment) =>
        allowed.has(fragment.id) || roleById(fragment.id) === undefined
    )
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

  return { ok: true, policy, modelId: model.id, lang: options.lang, roles }
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    policy: "",
    modelId: "",
    models: [],
    name: "",
    model: "",
    roles: [],
    dir: process.cwd(),
    lang: "ja",
    mcpServers: [],
    mcpDeny: [],
    check: false,
    write: false,
    merge: false,
    listPolicies: false,
    listModels: false,
    listRoles: false,
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
        options.policy = requireValue(value, "policy")
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
        options.check = true
        break
      case "--write":
        options.write = true
        break
      case "--merge":
        options.merge = true
        break
      case "--list-policies":
        options.listPolicies = true
        break
      case "--list-models":
        options.listModels = true
        break
      case "--list-roles":
        options.listRoles = true
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
    options.listPolicies ||
    options.listModels ||
    options.listRoles ||
    options.listMcp ||
    options.checkFragments ||
    options.scaffoldFragments
  ) {
    return options
  }
  if (options.merge && !options.write)
    throw new Error("merge: requires --write")
  if (options.models.length > 0) {
    if (options.policy === "") throw new Error("policy: is required")
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

try {
  const options = parseArgs(process.argv.slice(2))
  if (options.listPolicies) {
    respond(listPolicies(process.env))
  } else if (options.listModels) {
    respond(listModels(options))
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
    respond(setup(options))
  }
} catch (error) {
  respond({
    ok: false,
    error: error instanceof Error ? error.message : "Unexpected error",
    results: []
  })
  process.exitCode = 1
}
