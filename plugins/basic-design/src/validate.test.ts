import { expect, test } from "vitest"
import { validateSpec } from "./validate.js"

const validSpec = (): any => ({
  type: "er",
  title: "受注管理 ER図",
  entities: [
    {
      name: "users",
      label: "ユーザー",
      columns: [
        { name: "id", type: "BIGINT", pk: true },
        { name: "email", type: "VARCHAR(255)", unique: true },
      ],
    },
    {
      name: "orders",
      columns: [
        { name: "id", type: "BIGINT", pk: true },
        { name: "user_id", type: "BIGINT", fk: true },
      ],
    },
  ],
  relations: [{ from: "users", to: "orders", cardinality: "1:N", label: "発注する" }],
})

test("妥当な ER spec は空配列を返す", () => {
  expect(validateSpec(validSpec())).toEqual([])
})

test("オブジェクトでない spec はエラー", () => {
  expect(validateSpec(null)).toHaveLength(1)
  expect(validateSpec("x")).toHaveLength(1)
})

test("未対応の type はエラー", () => {
  const errors = validateSpec({ ...validSpec(), type: "flowchart" })
  expect(errors.some((e) => e.includes("flowchart"))).toBe(true)
})

test("title が無い・空はエラー", () => {
  const spec: Record<string, unknown> = validSpec()
  delete spec.title
  expect(validateSpec(spec).some((e) => e.includes("title"))).toBe(true)
  expect(validateSpec({ ...validSpec(), title: "" }).some((e) => e.includes("title"))).toBe(true)
})

test("entities が空配列はエラー", () => {
  const errors = validateSpec({ ...validSpec(), entities: [] })
  expect(errors.some((e) => e.includes("entities"))).toBe(true)
})

test("エンティティ名の重複はエラー(重複した名前を含むメッセージ)", () => {
  const spec = validSpec()
  spec.entities.push({ name: "users", columns: [{ name: "id" }] })
  expect(validateSpec(spec).some((e) => e.includes("users") && e.includes("重複"))).toBe(true)
})

test("カラム name が無いエンティティはエラー(エンティティ名を含むメッセージ)", () => {
  const spec = validSpec()
  ;(spec.entities[0].columns as unknown[]).push({ type: "TEXT" })
  expect(validateSpec(spec).some((e) => e.includes("users"))).toBe(true)
})

test("存在しないエンティティへの relation はエラー(参照名を含むメッセージ)", () => {
  const spec = validSpec()
  spec.relations.push({ from: "users", to: "products", cardinality: "1:N" })
  expect(validateSpec(spec).some((e) => e.includes("products"))).toBe(true)
})

test("不正な cardinality はエラー", () => {
  const spec = validSpec()
  spec.relations[0].cardinality = "1..*"
  expect(validateSpec(spec).some((e) => e.includes("cardinality"))).toBe(true)
})

test("relations は省略可", () => {
  const spec: Record<string, unknown> = validSpec()
  delete spec.relations
  expect(validateSpec(spec)).toEqual([])
})

test("relations が配列でない場合はエラー(throw しない)", () => {
  const spec = { ...validSpec(), relations: {} }
  expect(() => validateSpec(spec)).not.toThrow()
  const errors = validateSpec(spec)
  expect(errors.some((e) => e.includes("relations"))).toBe(true)
})

test("entities の要素が null の場合はエラー(throw しない)", () => {
  const spec = { ...validSpec(), entities: [null] }
  expect(() => validateSpec(spec)).not.toThrow()
  const errors = validateSpec(spec)
  expect(errors.some((e) => e.includes("entities"))).toBe(true)
})

test("columns の要素が null の場合はエラー(throw しない)", () => {
  const spec = validSpec()
  spec.entities[0].columns = [null]
  expect(() => validateSpec(spec)).not.toThrow()
  const errors = validateSpec(spec)
  expect(errors.some((e) => e.includes("columns"))).toBe(true)
})

test("relations の要素が null の場合はエラー(throw しない)", () => {
  const spec = validSpec()
  spec.relations = [null]
  expect(() => validateSpec(spec)).not.toThrow()
  const errors = validateSpec(spec)
  expect(errors.some((e) => e.includes("relations"))).toBe(true)
})

// ---- Stage 2: screen-flow ----

const validScreenFlow = (): any => ({
  type: "screen-flow",
  title: "EC サイト画面遷移",
  screens: [
    { id: "login", label: "ログイン", group: "認証", kind: "start" },
    { id: "home", label: "ホーム" },
    { id: "done", label: "完了", kind: "end" },
  ],
  transitions: [
    { from: "login", to: "home", trigger: "ログイン成功" },
    { from: "home", to: "done" },
  ],
})

test("screen-flow: 妥当な spec は空配列", () => {
  expect(validateSpec(validScreenFlow())).toEqual([])
})

test("screen-flow: screens が空はエラー", () => {
  expect(validateSpec({ ...validScreenFlow(), screens: [] }).some((e) => e.includes("screens"))).toBe(true)
})

test("screen-flow: id 重複はエラー", () => {
  const spec = validScreenFlow()
  spec.screens.push({ id: "login" })
  expect(validateSpec(spec).some((e) => e.includes("login") && e.includes("重複"))).toBe(true)
})

test("screen-flow: 不正な kind はエラー", () => {
  const spec = validScreenFlow()
  spec.screens[1].kind = "middle"
  expect(validateSpec(spec).some((e) => e.includes("kind") && e.includes("middle"))).toBe(true)
})

test("screen-flow: 存在しない画面への遷移はエラー", () => {
  const spec = validScreenFlow()
  spec.transitions.push({ from: "home", to: "nowhere" })
  expect(validateSpec(spec).some((e) => e.includes("nowhere"))).toBe(true)
})

test("screen-flow: transitions 省略可・非配列はエラー", () => {
  const spec: Record<string, unknown> = validScreenFlow()
  delete spec.transitions
  expect(validateSpec(spec)).toEqual([])
  expect(validateSpec({ ...validScreenFlow(), transitions: {} }).some((e) => e.includes("transitions"))).toBe(true)
})

test("screen-flow: null 要素でクラッシュしない", () => {
  const spec = validScreenFlow()
  spec.screens.push(null)
  spec.transitions.push(null)
  const errors = validateSpec(spec)
  expect(errors.length).toBeGreaterThanOrEqual(2)
})

// ---- Stage 2: architecture ----

const validArchitecture = (): any => ({
  type: "architecture",
  title: "Web システム構成",
  zones: [{ id: "aws", label: "AWS", children: ["alb", "app", "db"] }],
  nodes: [
    { id: "browser", label: "ブラウザ" },
    { id: "alb", label: "ALB" },
    { id: "app", label: "App Server", icon: "server" },
    { id: "db", label: "DB" },
  ],
  edges: [
    { from: "browser", to: "alb", label: "HTTPS" },
    { from: "alb", to: "app", label: "HTTP" },
    { from: "app", to: "db", label: "SQL" },
  ],
})

test("architecture: 妥当な spec は空配列", () => {
  expect(validateSpec(validArchitecture())).toEqual([])
})

test("architecture: nodes が空はエラー", () => {
  expect(validateSpec({ ...validArchitecture(), nodes: [] }).some((e) => e.includes("nodes"))).toBe(true)
})

test("architecture: zone の children が未定義ノードを指すとエラー", () => {
  const spec = validArchitecture()
  spec.zones[0].children.push("ghost")
  expect(validateSpec(spec).some((e) => e.includes("ghost"))).toBe(true)
})

test("architecture: ノードが複数ゾーンに属するとエラー", () => {
  const spec = validArchitecture()
  spec.zones.push({ id: "backup", label: "Backup", children: ["db"] })
  expect(validateSpec(spec).some((e) => e.includes("db") && e.includes("複数"))).toBe(true)
})

test("architecture: zone id とノード id の衝突はエラー", () => {
  const spec = validArchitecture()
  spec.zones.push({ id: "db", label: "x", children: ["alb"] })
  const errors = validateSpec(spec)
  expect(errors.some((e) => e.includes('"db"') && e.includes("重複"))).toBe(true)
})

test("architecture: 存在しないノードへの edge はエラー", () => {
  const spec = validArchitecture()
  spec.edges.push({ from: "app", to: "cache" })
  expect(validateSpec(spec).some((e) => e.includes("cache"))).toBe(true)
})

test("architecture: zones / edges 省略可", () => {
  const spec: Record<string, unknown> = validArchitecture()
  delete spec.zones
  delete spec.edges
  expect(validateSpec(spec)).toEqual([])
})

test("未知 kind はエラーにしない", () => {
  expect(validateSpec({ type: "architecture", title: "A", nodes: [{ id: "db", kind: "warehouse" }] })).toEqual([])
})

// ---- Stage 2: sequence ----

const validSequence = (): any => ({
  type: "sequence",
  title: "ログイン処理",
  actors: [
    { id: "user", label: "ユーザー", kind: "actor" },
    { id: "web", label: "Web" },
    { id: "db", label: "DB" },
  ],
  messages: [
    { from: "user", to: "web", label: "ログイン要求" },
    { from: "web", to: "db", label: "照会", style: "async" },
    { from: "db", to: "web", label: "結果", style: "return" },
  ],
})

test("sequence: 妥当な spec は空配列", () => {
  expect(validateSpec(validSequence())).toEqual([])
})

test("sequence: actors が空はエラー", () => {
  expect(validateSpec({ ...validSequence(), actors: [] }).some((e) => e.includes("actors"))).toBe(true)
})

test("sequence: 未定義アクターへのメッセージはエラー", () => {
  const spec = validSequence()
  spec.messages.push({ from: "web", to: "mail" })
  expect(validateSpec(spec).some((e) => e.includes("mail"))).toBe(true)
})

test("sequence: 自己メッセージはエラー(未対応の明示)", () => {
  const spec = validSequence()
  spec.messages.push({ from: "web", to: "web", label: "内部処理" })
  expect(validateSpec(spec).some((e) => e.includes("自己メッセージ"))).toBe(true)
})

test("sequence: 不正な style はエラー", () => {
  const spec = validSequence()
  spec.messages[0].style = "dashed"
  expect(validateSpec(spec).some((e) => e.includes("style") && e.includes("dashed"))).toBe(true)
})
