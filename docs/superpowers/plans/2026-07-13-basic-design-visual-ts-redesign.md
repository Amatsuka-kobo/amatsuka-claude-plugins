# basic-design 図生成 TypeScript 化・ビジュアル刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plugins/basic-design` の4図種生成を TypeScript + elkjs へ移行し、CLI 互換性を保ったまま、重なりを検査できる共通 Layout とモダンドキュメント風 HTML/drawio 出力へ刷新する。

**Architecture:** ソースと Vitest は `src/` に置く。グラフ系3図種は ELK layered の結果を共通 `Layout` へ正規化し、シーケンス図も同じ `LayoutEdge.points` を生成する。`decorateLayout()` が明示 `kind` または既存フィールドから `kindKey` を決め、レンダラは経路計算をせず Layout を描画する。esbuild は elkjs を含む2つの単一 ESM bundle を現行 `scripts/` パスへ出力する。

**Tech Stack:** Node.js 26、TypeScript 6、pnpm 11、Vitest 4、esbuild 0.28、elkjs `0.11.1`(exact)、SVG、draw.io XML。

## Global Constraints

- 正は `docs/superpowers/specs/2026-07-13-basic-design-visual-ts-redesign-design.md`。
- `elkjs` は `"0.11.1"` exact。`^` / `~` 禁止。esbuild bundle へ焼き込む。
- 出力先は `plugins/basic-design/scripts/design-gen.mjs` と `check-drive-config.mjs`。4 SKILL.md の実行コマンドは変更しない。
- design-gen stdout は JSON 1行だけ。成功 `{ok:true,files:string[]}` + exit 0、失敗 `{ok:false,errors:string[]}` + exit 1。check-drive-config は現行 JSON と常時 exit 0 を維持する。
- 全 edge は `points: Point[]`。`fromPt` / `toPt` と renderer 内 `routeOrthogonal()` は廃止する。
- Layout 性質テストで node-node、node-edge(接続端点除外)、label-node、label-label の非交差を検査する。
- HTML は主成果物。色、SVG icon、影、角丸、ラベル背景、既存の zoom/pan/select/hover/detail panel を維持する。drawio は同じ palette、絵文字、ELK waypoint で追随する。
- ER は画面遷移・構成・シーケンスで知見を得た後、最後に実装する。
- 旧 `scripts/lib/**`・旧 tests は4図種 sample 再生成と人間の目視承認後の最終 commit まで残す。
- `kind` は任意文字列。未知値は validation error にせず `generic`。
- Markdown 成果物と Drive 連携の挙動は変更しない。
- manifest は現行 `0.4.1-dev` から `0.5.0-dev`。メジャー変更は人間判断で本計画外。
- 実装時の各 commit 末尾は `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: pnpm / Vitest / TypeScript / esbuild 基盤と Drive CLI 移植

**Files:**
- Create: `plugins/basic-design/package.json`
- Create: `plugins/basic-design/pnpm-workspace.yaml`
- Create: `plugins/basic-design/pnpm-lock.yaml`
- Create: `plugins/basic-design/tsconfig.json`
- Create: `plugins/basic-design/vitest.config.ts`
- Create: `plugins/basic-design/build.ts`
- Create: `plugins/basic-design/src/check-drive-config.ts`
- Create: `plugins/basic-design/src/check-drive-config.test.ts`
- Generated: `plugins/basic-design/scripts/check-drive-config.mjs`

**Interfaces:**
- Consumes: `plugins/basic-design/scripts/check-drive-config.mjs:5-38`。
- Produces: `readDriveConfig(root:string): DriveConfig`、`pnpm build/test/typecheck`。

- [x] **Step 1: failing Vitest を書く**

```ts
// src/check-drive-config.test.ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { readDriveConfig } from "./check-drive-config.js"

async function project(content: string | null) {
  const root = await mkdtemp(path.join(tmpdir(), "drive-"))
  if (content !== null) {
    await mkdir(path.join(root, ".claude"), { recursive: true })
    await writeFile(path.join(root, ".claude", "basic-design.local.md"), content)
  }
  return root
}

test("BOM/CRLF/quoted id/comment を現行どおり読む", async () => {
  const root = await project('\uFEFF---\r\ndrive_folder_id: "1AbC" # note\r\n---\r\n')
  expect(readDriveConfig(root)).toEqual({ configured: true, driveFolderId: "1AbC" })
})

test.each([null, "plain\n", "---\nother: x\n---\n", "---\ndrive_folder_id: ''\n---\n"])(
  "設定なしは disabled: %s", async (content) => {
    expect(readDriveConfig(await project(content))).toEqual({ configured: false, driveFolderId: null })
  }
)
```

同じ file に次の現行ケースも追加し、合計9ケースを維持する。

```ts
test("single quote と unquoted id を読む", async () => {
  expect(readDriveConfig(await project("---\ndrive_folder_id: '1Single'\n---\n"))).toEqual({ configured: true, driveFolderId: "1Single" })
  expect(readDriveConfig(await project("---\ndrive_folder_id: 1Bare\n---\n"))).toEqual({ configured: true, driveFolderId: "1Bare" })
})
test("frontmatter 外の key は無視する", async () => {
  expect(readDriveConfig(await project("---\ntitle: x\n---\ndrive_folder_id: 1Outside\n"))).toEqual({ configured: false, driveFolderId: null })
})
test("CLI 引数省略時は cwd を使い JSON 1行で exit 0", async () => {
  const root = await project("---\ndrive_folder_id: 1Cwd\n---\n")
  const { stdout, stderr } = await execFileAsync("node", [BUNDLED_CLI], { cwd: root })
  expect(stderr).toBe("")
  expect(stdout.trim().split("\n")).toHaveLength(1)
  expect(JSON.parse(stdout)).toEqual({ configured: true, driveFolderId: "1Cwd" })
})
```

`execFileAsync = promisify(execFile)` と `BUNDLED_CLI = fileURLToPath(new URL("../scripts/check-drive-config.mjs", import.meta.url))` を test file 冒頭に定義する。

- [x] **Step 2: failure を確認する**

Run: `cd plugins/basic-design && pnpm install && pnpm test -- src/check-drive-config.test.ts`

Expected: FAIL。module 未作成。

- [x] **Step 3: package/config を作る**

`plugins/basic-design/package.json`:

```json
{"name":"basic-design-generator","version":"0.5.0-dev","private":true,"type":"module","scripts":{"build":"tsx build.ts","test":"vitest run","typecheck":"tsc --noEmit"},"dependencies":{"elkjs":"0.11.1"},"devDependencies":{"@types/node":"^26.0.0","esbuild":"^0.28.1","tsx":"^4.22.4","typescript":"^6.0.3","vitest":"^4.1.10"},"devEngines":{"packageManager":{"name":"pnpm","version":"^11.8.0","onFail":"download"}},"volta":{"node":"26.3.1","pnpm":"11.8.0"}}
```

`plugins/basic-design/pnpm-workspace.yaml`(raguel-mcp の実物と同じ syntax):

```yaml
allowBuilds:
  esbuild: true
```

`plugins/basic-design/tsconfig.json`:

```json
{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","outDir":"scripts/","rootDir":"src/","strict":true,"resolveJsonModule":true,"types":["node"],"esModuleInterop":true,"skipLibCheck":true,"forceConsistentCasingInFileNames":true,"isolatedModules":true},"include":["src/**/*"],"exclude":["node_modules","scripts"]}
```

`plugins/basic-design/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
export default defineConfig({ test: { include: ["src/**/*.test.ts"], environment: "node" } })
```

- [x] **Step 4: Drive CLI を実装する**

```ts
#!/usr/bin/env node
import { readFileSync } from "node:fs"
import path from "node:path"
export interface DriveConfig { configured: boolean; driveFolderId: string | null }
const OFF: DriveConfig = { configured: false, driveFolderId: null }
export function readDriveConfig(root: string): DriveConfig {
  let content: string
  try { content = readFileSync(path.join(root, ".claude", "basic-design.local.md"), "utf8") }
  catch { return OFF }
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/)
  if (lines[0] !== "---") return OFF
  for (const line of lines.slice(1)) {
    if (line === "---") break
    const match = line.match(/^drive_folder_id:\s*(.*)$/)
    if (!match) continue
    const quoted = match[1].trim().match(/^(["'])(.*?)\1/)
    const value = quoted ? quoted[2] : match[1].replace(/\s*#.*$/, "").trim()
    return value ? { configured: true, driveFolderId: value } : OFF
  }
  return OFF
}
if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(readDriveConfig(process.argv[2] ?? process.cwd()))}\n`)
}
```

- [x] **Step 5: 初期 build と検証を行う**

`plugins/basic-design/build.ts`:

```ts
import esbuild from "esbuild"
await esbuild.build({ bundle: true, entryPoints: { "check-drive-config": "./src/check-drive-config.ts" }, outdir: "./scripts", outExtension: { ".js": ".mjs" }, platform: "node", format: "esm", sourcemap: false, target: "node20" })
```

Run: `cd plugins/basic-design && pnpm test -- src/check-drive-config.test.ts && pnpm typecheck && pnpm build && node scripts/check-drive-config.mjs /tmp`

Expected: tests/typecheck/build PASS。最後は `{"configured":false,"driveFolderId":null}` 1行。

- [x] **Step 6: commit**

```bash
git add plugins/basic-design/{package.json,pnpm-workspace.yaml,pnpm-lock.yaml,tsconfig.json,vitest.config.ts,build.ts} plugins/basic-design/src/check-drive-config* plugins/basic-design/scripts/check-drive-config.mjs
git commit -m "build(basic-design): TypeScript ツールチェーンを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Spec / Layout 型と validation 移植

**Files:**
- Create: `plugins/basic-design/src/types.ts`
- Create: `plugins/basic-design/src/validate.ts`
- Create: `plugins/basic-design/src/validate.test.ts`
- Create: `plugins/basic-design/src/xml-util.ts`
- Create: `plugins/basic-design/src/xml-util.test.ts`
- Reference: `plugins/basic-design/scripts/lib/validate.mjs:1-255`

**Interfaces:**
- Produces: `DiagramSpec` union、`Layout`、`validateSpec(unknown):string[]`、`escapeXml(unknown):string`。

- [x] **Step 1: 正規型を作る**

```ts
export type DiagramType = "architecture" | "screen-flow" | "er" | "sequence"
export type KindKey = "generic" | "user" | "api" | "data" | "messaging" | "external" | "screen" | "entity"
export type Point = { x:number; y:number }
export type Box = Point & { width:number; height:number }
export interface LayoutNode extends Box { id:string; label:string; shape:"box"|"terminal"|"actor"|"entity"; kindKey:KindKey; meta:Record<string,unknown>; headerHeight?:number; rowHeight?:number; rows?:Array<{text:string;meta:Record<string,unknown>}> }
export interface LayoutEdge { id:string; from:string; to:string; label:string; style?:"arrow"|"sync"|"async"|"return"; cardinality?:"1:1"|"1:N"|"N:1"|"N:M"; points:Point[]; labelBox?:Box }
export interface Layout { type:DiagramType; title:string; nodes:LayoutNode[]; zones?:Array<Box & {id:string;label:string}>; lines?:Array<{x:number;y1:number;y2:number;owner:string}>; edges:LayoutEdge[] }
export interface ArchitectureSpec { type:"architecture"; title:string; zones?:Array<{id:string;label?:string;children:string[]}>; nodes:Array<{id:string;label?:string;icon?:string;kind?:string}>; edges?:Array<{from:string;to:string;label?:string}> }
export interface ScreenFlowSpec { type:"screen-flow"; title:string; screens:Array<{id:string;label?:string;group?:string;kind?:string}>; transitions?:Array<{from:string;to:string;trigger?:string}> }
export interface ErSpec { type:"er"; title:string; entities:Array<{name:string;label?:string;kind?:string;columns:Array<{name:string;type?:string;pk?:boolean;fk?:boolean;unique?:boolean}>}>; relations?:Array<{from:string;to:string;label?:string;cardinality:"1:1"|"1:N"|"N:1"|"N:M"}> }
export interface SequenceSpec { type:"sequence"; title:string; actors:Array<{id:string;label?:string;kind?:string}>; messages?:Array<{from:string;to:string;label?:string;style?:"async"|"return"}> }
export type DiagramSpec = ArchitectureSpec | ScreenFlowSpec | ErSpec | SequenceSpec
```

- [x] **Step 2: 現行33 validation test と kind test を移植する**

```ts
import { expect, test } from "vitest"
import { validateSpec } from "./validate.js"
test("未知 kind はエラーにしない", () => {
  expect(validateSpec({type:"architecture",title:"A",nodes:[{id:"db",kind:"warehouse"}]})).toEqual([])
})
```

Run: `cd plugins/basic-design && pnpm test -- src/validate.test.ts`

Expected: FAIL。module 未作成。

- [x] **Step 3: validation と XML escape を移植する**

```ts
export const SUPPORTED_TYPES = ["er","screen-flow","architecture","sequence"] as const
export function validateSpec(spec: unknown): string[] {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return ["spec: オブジェクトである必要があります"]
  const value = spec as Record<string,unknown>
  if (!SUPPORTED_TYPES.includes(value.type as never)) return [`type: 未対応です(対応: ${SUPPORTED_TYPES.join(", ")})`]
  const errors: string[] = []
  if (typeof value.title !== "string" || value.title.trim() === "") errors.push("title: 必須です")
  return errors.concat(RULES[value.type as keyof typeof RULES](value))
}
```

`RULES` は次の4関数へ dispatch する。`kind` enum validation は追加しない。

```ts
const RULES = {
  er: validateEr,
  "screen-flow": validateScreenFlow,
  architecture: validateArchitecture,
  sequence: validateSequence
} satisfies Record<DiagramType, (spec: Record<string, unknown>) => string[]>

function duplicateErrors(values: unknown[], path: string): string[] {
  const seen = new Set<string>()
  const errors: string[] = []
  values.forEach((value, index) => {
    if (typeof value !== "string" || value.trim() === "") errors.push(`${path}[${index}]: 必須です`)
    else if (seen.has(value)) errors.push(`${path}[${index}]: "${value}" は重複しています`)
    else seen.add(value)
  })
  return errors
}
```

各 validator の完全契約:

```ts
// validateEr: entities[] 非空; entity.name unique; columns[] 非空; column.name 必須;
// relations? は array; from/to は entity name を参照; cardinality は 1:1|1:N|N:1|N:M。
// validateScreenFlow: screens[] 非空; screen.id unique; kind は未指定/start/end/任意文字列;
// transitions? の from/to は screen.id を参照。
// validateArchitecture: nodes[] 非空; node.id unique; zone.id は node/zone 全体で unique;
// zone.children[] 非空・node.id 参照・同一 node の複数 zone 所属禁止; edges? の from/to は node.id 参照。
// validateSequence: actors[] 非空; actor.id unique; messages? の from/to は actor.id 参照;
// from===to は `${path}: 自己メッセージは未対応です`; style は未指定/async/return。
```

エラー文字列は `plugins/basic-design/scripts/lib/validate.mjs:27-255` と一致させ、移植 test 33件を変更して通すのではなく、その期待値を満たす実装にする。

```ts
const XML: Record<string,string> = {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}
export function escapeXml(value: unknown): string { return String(value).replace(/[&<>"']/g, c => XML[c]) }
```

- [x] **Step 4: verify / commit**

Run: `cd plugins/basic-design && pnpm test -- src/validate.test.ts src/xml-util.test.ts && pnpm typecheck`

Expected: 既存33ケース + kind + XML 全件 PASS。

```bash
git add plugins/basic-design/src/{types,validate,validate.test,xml-util,xml-util.test}.ts
git commit -m "refactor(basic-design): spec と Layout を型定義

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Theme、icons、decorate snapshot

**Files:**
- Create: `plugins/basic-design/src/theme.ts`
- Create: `plugins/basic-design/src/render/icons.ts`
- Create: `plugins/basic-design/src/decorate.ts`
- Create: `plugins/basic-design/src/decorate.test.ts`

**Interfaces:**
- Produces: `THEME`、`iconSvg(KindKey)`、`iconEmoji(KindKey)`、`decorateLayout(spec,layout):Layout`。

- [x] **Step 1: 優先順位 test を書き failure 確認**

```ts
test("explicit kind wins and unknown explicit kind is generic", () => {
  expect(decorateLayout({type:"architecture",title:"A",nodes:[{id:"n",icon:"api",kind:"external"}]}, layout).nodes[0].kindKey).toBe("external")
  expect(decorateLayout({type:"architecture",title:"A",nodes:[{id:"n",kind:"warehouse"}]}, layout).nodes[0].kindKey).toBe("generic")
})
```

Run: `cd plugins/basic-design && pnpm test -- src/decorate.test.ts`

Expected: FAIL。module 未作成。

- [x] **Step 2: token と推定を実装する**

```ts
export const THEME = { palette:{ generic:{fill:"#F8FAFC",stroke:"#64748B",icon:"#475569",text:"#0F172A"}, user:{fill:"#EFF6FF",stroke:"#3B82F6",icon:"#2563EB",text:"#1E3A8A"}, api:{fill:"#ECFEFF",stroke:"#0891B2",icon:"#0E7490",text:"#164E63"}, data:{fill:"#F5F3FF",stroke:"#8B5CF6",icon:"#7C3AED",text:"#4C1D95"}, messaging:{fill:"#FFF7ED",stroke:"#F97316",icon:"#EA580C",text:"#7C2D12"}, external:{fill:"#FDF2F8",stroke:"#DB2777",icon:"#BE185D",text:"#831843"}, screen:{fill:"#F0FDF4",stroke:"#22C55E",icon:"#16A34A",text:"#14532D"}, entity:{fill:"#FFFBEB",stroke:"#D97706",icon:"#B45309",text:"#78350F"} }, zone:{fill:"#F8FAFC",stroke:"#CBD5E1",chip:"#E2E8F0"}, edge:"#475569",labelBackground:"#FFFFFF",fontFamily:"system-ui, sans-serif",radius:12,shadow:"0 6px 18px rgba(15,23,42,.12)" } as const
```

```ts
const ALIASES: Array<[RegExp,KindKey]> = [[/(user|actor|利用者|ユーザー)/i,"user"],[/(api|gateway|service|サーバー)/i,"api"],[/(db|database|postgres|mysql|データベース|storage)/i,"data"],[/(queue|topic|kafka|message|イベント)/i,"messaging"],[/(external|partner|vendor|外部|決済)/i,"external"],[/(screen|page|画面|start|end)/i,"screen"],[/(entity|table|master|テーブル)/i,"entity"]]
const KNOWN=new Set<KindKey>(["generic","user","api","data","messaging","external","screen","entity"])
function normalize(value:unknown):KindKey|undefined{if(typeof value!=="string"||!value.trim())return undefined;const direct=value.trim().toLowerCase() as KindKey;if(KNOWN.has(direct))return direct;return ALIASES.find(([pattern])=>pattern.test(value))?.[1]}
export function resolveKind(spec:DiagramSpec,node:LayoutNode):KindKey{
  const source=spec.type==="architecture"?spec.nodes.find(x=>x.id===node.id):spec.type==="screen-flow"?spec.screens.find(x=>x.id===node.id):spec.type==="er"?spec.entities.find(x=>x.name===node.id):spec.actors.find(x=>x.id===node.id)
  if(source?.kind!==undefined)return normalize(source.kind)??"generic"
  if(spec.type==="screen-flow")return "screen"
  if(spec.type==="er")return "entity"
  if(spec.type==="sequence")return normalize(source?.kind)??"generic"
  for(const value of [source?.icon,node.label,node.meta.zone]){const kind=normalize(value);if(kind)return kind}
  return "generic"
}
export function decorateLayout(spec: DiagramSpec, layout: Layout): Layout { return {...layout,nodes:layout.nodes.map(node=>({...node,kindKey:resolveKind(spec,node)}))} }
```

`icons.ts` は外部 asset を参照せず、mapping を次で固定する。

```ts
const EMOJI: Record<KindKey,string> = {
  generic: "◆",
  user: "👤",
  api: "⚙",
  data: "▰",
  messaging: "✉",
  external: "↗",
  screen: "▣",
  entity: "▦"
}
export function iconEmoji(kind: KindKey): string { return EMOJI[kind] }
export function iconSvg(kind: KindKey): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">${SVG_PATH[kind]}</svg>`
}
```

`SVG_PATH` は8 key すべてを持つ `Record<KindKey,string>` とし、generic=角丸矩形、user=人物、api=3本の service line、data=database cylinder、messaging=吹き出し、external=外向き矢印、screen=browser frame、entity=table grid の固定 path を入れる。

- [x] **Step 3: 4 sample 全 node の inline snapshot を固定する**

Run: `cd plugins/basic-design && pnpm test -- src/decorate.test.ts -u`

Expected: sample 実 ID と kindKey の非空配列4件が test file に入り PASS。通常実行でも差分なし。

- [x] **Step 4: verify / commit**

Run: `cd plugins/basic-design && pnpm test -- src/decorate.test.ts && pnpm typecheck`

```bash
git add plugins/basic-design/src/{theme,decorate,decorate.test}.ts plugins/basic-design/src/render/icons.ts
git commit -m "feat(basic-design): ノード種別テーマと推定を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: geometry とシーケンス Layout

**Files:**
- Create: `plugins/basic-design/src/layout/geometry.ts`
- Create: `plugins/basic-design/src/layout/sequence.ts`
- Create: `plugins/basic-design/src/layout/sequence.test.ts`
- Create: `plugins/basic-design/src/fixtures/complex-sequence.spec.json`

**Interfaces:**
- Produces: `layoutSequence(spec: SequenceSpec): Promise<Layout>`、`assertLayoutHasNoOverlaps(layout: Layout): string[]`。全 layouter を `Promise<Layout>` に統一し、Task 8 の dispatch に分岐を持たせない。

- [x] **Step 1: points/label test を書き failure 確認**

```ts
test("sequence uses points and labelBox", async () => {
  const result = await layoutSequence(spec)
  expect(result.edges[0]).toMatchObject({style:"sync",points:[{x:70,y:114},{x:290,y:114}]})
  expect(result.edges[0].labelBox).toMatchObject({height:18})
  expect("fromPt" in result.edges[0]).toBe(false)
})
```

Run: `cd plugins/basic-design && pnpm test -- src/layout/sequence.test.ts`

Expected: FAIL。

- [x] **Step 2: geometry assertions を実装する**

```ts
export function boxesOverlap(a:Box,b:Box){return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y}
function segmentHitsBox(a:Point,b:Point,box:Box){
  if(a.x===b.x)return a.x>box.x&&a.x<box.x+box.width&&Math.max(a.y,b.y)>box.y&&Math.min(a.y,b.y)<box.y+box.height
  if(a.y===b.y)return a.y>box.y&&a.y<box.y+box.height&&Math.max(a.x,b.x)>box.x&&Math.min(a.x,b.x)<box.x+box.width
  throw new Error(`non-orthogonal segment: ${JSON.stringify([a,b])}`)
}
export function assertLayoutHasNoOverlaps(layout:Layout):string[]{
  const errors:string[]=[]
  for(let i=0;i<layout.nodes.length;i++)for(let j=i+1;j<layout.nodes.length;j++)if(boxesOverlap(layout.nodes[i],layout.nodes[j]))errors.push(`node-node:${layout.nodes[i].id}:${layout.nodes[j].id}`)
  const labels=layout.edges.flatMap(edge=>edge.labelBox?[{id:edge.id,box:edge.labelBox}]:[])
  for(const label of labels)for(const node of layout.nodes)if(boxesOverlap(label.box,node))errors.push(`label-node:${label.id}:${node.id}`)
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)if(boxesOverlap(labels[i].box,labels[j].box))errors.push(`label-label:${labels[i].id}:${labels[j].id}`)
  for(const edge of layout.edges)for(let i=0;i<edge.points.length-1;i++)for(const node of layout.nodes){
    const a={...edge.points[i]}, b={...edge.points[i+1]}
    if(node.id===edge.from&&i===0){a.x+=Math.sign(b.x-a.x);a.y+=Math.sign(b.y-a.y)}
    if(node.id===edge.to&&i===edge.points.length-2){b.x-=Math.sign(b.x-a.x);b.y-=Math.sign(b.y-a.y)}
    if(segmentHitsBox(a,b,node))errors.push(`node-edge:${node.id}:${edge.id}:${i}`)
  }
  return errors
}
```

境界への接触は overlap としない。source/target node についても、接続端点1点だけを1px内側へ縮め、それ以外の segment が node interior を横切れば failure とする。

- [x] **Step 3: sequence を共通 Layout へ移植する**

```ts
export async function layoutSequence(spec:SequenceSpec):Promise<Layout>{
const ACTOR_WIDTH=140, ACTOR_HEIGHT=50, ACTOR_GAP=80, MESSAGE_GAP=64, TAIL=30
// node/lifeline を現行順で作り、edge は次の形にする
const points=[{x:center.get(msg.from)!,y},{x:center.get(msg.to)!,y}]
const width=Math.max(48,(msg.label??"").length*7+16)
return {id:`msg${i+1}`,from:msg.from,to:msg.to,label:msg.label??"",style:msg.style==="return"?"return":msg.style==="async"?"async":"sync",points,labelBox:msg.label?{x:(points[0].x+points[1].x-width)/2,y:y-22,width,height:18}:undefined}
// return {type:"sequence",title:spec.title,nodes,lines,edges}
}
```

- [x] **Step 4: complex fixture と property test**

`complex-sequence.spec.json` は actor ID `user/web/api/auth/db/payment` の6件、message 12件を持つ。style 未指定(sync)、`async`、`return` を各2件以上含め、すべて異なる actor 間にする。test は `expect(layout.nodes).toHaveLength(6)`、`expect(layout.edges).toHaveLength(12)`、`expect(assertLayoutHasNoOverlaps(layout)).toEqual([])` を含める。

Run: `cd plugins/basic-design && pnpm test -- src/layout/sequence.test.ts && pnpm typecheck`

Expected: PASS。

- [x] **Step 5: commit**

```bash
git add plugins/basic-design/src/layout/{geometry,sequence,sequence.test}.ts plugins/basic-design/src/fixtures/complex-sequence.spec.json
git commit -m "refactor(basic-design): シーケンス図を共通 Layout へ移植

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: ELK 共通基盤、画面遷移図、構成図

**Files:**
- Create: `plugins/basic-design/src/layout/graph.ts`
- Create: `plugins/basic-design/src/layout/graph.test.ts`
- Create: `plugins/basic-design/src/fixtures/complex-screen-flow.spec.json`
- Create: `plugins/basic-design/src/fixtures/complex-architecture.spec.json`

**Interfaces:**
- Produces: `layoutScreenFlow(spec):Promise<Layout>`、`layoutArchitecture(spec):Promise<Layout>`。

- [x] **Step 1: failing tests を書く**

```ts
test("screen flow is RIGHT and routed",async()=>{const l=await layoutScreenFlow(flow);expect(node(l,"start").x).toBeLessThan(node(l,"end").x);expect(l.edges.every(e=>e.points.length>=2)).toBe(true);expect(assertLayoutHasNoOverlaps(l)).toEqual([])})
test("architecture compound zones contain nodes",async()=>{const l=await layoutArchitecture(architecture);expect(contains(zone(l,"private"),node(l,"db"))).toBe(true);expect(assertLayoutHasNoOverlaps(l)).toEqual([])})
```

Run: `cd plugins/basic-design && pnpm test -- src/layout/graph.test.ts`

Expected: FAIL。

- [x] **Step 2: ELK options と正規化を実装する**

```ts
import ELK from "elkjs/lib/elk.bundled.js"
import type { ElkExtendedEdge, ElkNode } from "elkjs"
const elk=new ELK()
const BASE={"elk.algorithm":"layered","elk.edgeRouting":"ORTHOGONAL","elk.spacing.nodeNode":"56","elk.spacing.edgeNode":"24","elk.spacing.edgeEdge":"18","elk.layered.spacing.nodeNodeBetweenLayers":"72","elk.padding":"[top=28,left=28,bottom=28,right=28]"}
function points(edge:ElkExtendedEdge){const sections=edge.sections??[];if(!sections.length)throw new Error(`ELK edge ${edge.id} has no routed section`);return sections.flatMap((s,i)=>[s.startPoint,...(s.bendPoints??[]),s.endPoint].slice(i?1:0)).map(({x,y})=>({x,y}))}
```

edge label は `{text,width:max(48,text.length*7+16),height:18}`。出力 label の x/y/width/height を `labelBox` にする。

- [x] **Step 3: screen-flow を実装する**

root options は `{...BASE,"elk.direction":"RIGHT"}`、node 180x60。start/end は `terminal`。transition index を `t1...` に保ち points/labelBox を正規化する。

- [x] **Step 4: architecture compound zone を実装する**

```ts
const root:ElkNode={id:"root",layoutOptions:{...BASE,"elk.direction":"DOWN","elk.hierarchyHandling":"INCLUDE_CHILDREN"},children:[...zones.map(z=>({id:`zone:${z.id}`,layoutOptions:{...BASE,"elk.direction":"DOWN","elk.padding":"[top=52,left=28,bottom=28,right=28]"},children:z.children.map(id=>({id,width:160,height:68}))})),...unzoned],edges}
```

nested node 座標へ zone x/y を加算して絶対化する。meta は `{icon,zone}`。

- [x] **Step 5: sample + complex property tests**

`complex-screen-flow.spec.json` は screen 12件、transition 16件で、start/end、2分岐、2合流、1戻り edge を含める。`complex-architecture.spec.json` は zone 4件、node 16件、edge 20件で、zone 内 edge 8件、zone 間 edge 8件、unzoned 接続4件を含める。各 fixture はすべての参照先 ID が存在する完全な JSON object として作る。sample 2件と fixtures 2件で全 overlap 0。failure 時は自作 router を書かず BASE spacing を増やす。

Run: `cd plugins/basic-design && pnpm test -- src/layout/graph.test.ts && pnpm typecheck`

Expected: PASS。

- [x] **Step 6: commit**

```bash
git add plugins/basic-design/src/layout/{graph,graph.test}.ts plugins/basic-design/src/fixtures/complex-{screen-flow,architecture}.spec.json
git commit -m "feat(basic-design): 画面遷移図と構成図を ELK 化

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: HTML / drawio renderer(ER 以外を先行)

**Files:**
- Create: `plugins/basic-design/src/render/html.ts`
- Create: `plugins/basic-design/src/render/html.test.ts`
- Create: `plugins/basic-design/src/render/drawio.ts`
- Create: `plugins/basic-design/src/render/drawio.test.ts`

**Interfaces:**
- Produces: `renderHtml(layout,spec):string`、`renderDrawio(layout):string`。ELK/route import 禁止。

- [ ] **Step 1: visual/interaction failing tests**

```ts
test("HTML is themed/self-contained/interactive",()=>{const h=renderHtml(layout,spec);expect(h).toContain('class="node-card kind-api"');expect(h).toContain('class="edge-label-bg"');expect(h).toContain('id="design-layout"');expect(h).toContain('addEventListener("wheel"');expect(h).not.toMatch(/<script[^>]+src=|<link[^>]+href=/)})
test("drawio uses palette emoji shadow waypoint",()=>{const x=renderDrawio(layout);expect(x).toContain("rounded=1");expect(x).toContain("shadow=1");expect(x).toContain("fillColor=#ECFEFF");expect(x).toContain("⚙ API");expect(x).toContain('<Array as="points">')})
```

Run: `cd plugins/basic-design && pnpm test -- src/render/html.test.ts src/render/drawio.test.ts`

Expected: FAIL。

- [ ] **Step 2: HTML renderer を実装する**

```ts
function edgeSvg(e:LayoutEdge){const p=e.points.map(v=>`${v.x},${v.y}`).join(" ");const label=e.labelBox?`<g class="edge-label"><rect class="edge-label-bg" x="${e.labelBox.x}" y="${e.labelBox.y}" width="${e.labelBox.width}" height="${e.labelBox.height}" rx="5"/><text x="${e.labelBox.x+e.labelBox.width/2}" y="${e.labelBox.y+13}" text-anchor="middle">${escapeXml(e.label)}</text></g>`:"";return `<g class="edge" data-id="${escapeXml(e.id)}" data-from="${escapeXml(e.from)}" data-to="${escapeXml(e.to)}"><polyline points="${p}" fill="none"/>${label}</g>`}
```

renderer 冒頭で `import { THEME } from "../theme.js"`、`import { escapeXml } from "../xml-util.js"`、`import { iconSvg } from "./icons.js"` を明示する。node は palette CSS variables、soft-shadow filter、角丸/ellipse/actor、24px inline SVG icon。zone chip と lifeline を描く。embedded JSON は `JSON.stringify(value).replace(/</g,"\\u003c")`。

interaction は現行 `plugins/basic-design/scripts/lib/render/html.mjs` の DOM 契約を次の handler で移す。

```js
svg.addEventListener("wheel", onWheel, { passive: false })
svg.addEventListener("pointerdown", onPointerDown)
svg.addEventListener("pointermove", onPointerMove)
svg.addEventListener("pointerup", onPointerUp)
svg.addEventListener("pointerleave", onPointerUp)
for (const item of document.querySelectorAll("[data-id]")) {
  item.addEventListener("click", () => select(item.dataset.id))
  item.addEventListener("pointerenter", () => preview(item.dataset.id))
  item.addEventListener("pointerleave", clearPreview)
}
function connected(id) {
  return layout.edges.filter(edge => edge.from === id || edge.to === id)
}
```

`onWheel` は pointer 位置を中心に viewBox を拡縮、pointer handlers は drag 差分で viewBox を移動する。`select(id)` は直接接続する node/edge のみを highlight し、panel は node の rows/meta または edge の from/to/cardinality/style を表示する。

- [ ] **Step 3: drawio renderer を実装する**

renderer 冒頭で `import { THEME } from "../theme.js"`、`import { escapeXml } from "../xml-util.js"`、`import { iconEmoji } from "./icons.js"` を明示する。

```ts
function nodeStyle(n:LayoutNode){const t=THEME.palette[n.kindKey];return `${n.shape==="terminal"?"ellipse;":"rounded=1;arcSize=16;"}whiteSpace=wrap;html=1;shadow=1;fillColor=${t.fill};strokeColor=${t.stroke};fontColor=${t.text};`}
function waypointXml(e:LayoutEdge){const p=e.points.slice(1,-1);return p.length?`<Array as="points">${p.map(v=>`<mxPoint x="${v.x}" y="${v.y}"/>`).join("")}</Array>`:""}
function edgeCell(e:LayoutEdge){return `<mxCell id="e-${escapeXml(e.id)}" value="${escapeXml(e.label)}" style="${edgeStyle(e)}" edge="1" parent="1" source="n-${escapeXml(e.from)}" target="n-${escapeXml(e.to)}"><mxGeometry relative="1" as="geometry">${waypointXml(e)}</mxGeometry></mxCell>`}
```

全 edge は上記 source/target cell + Layout waypoint。sequence の sourcePoint 分岐や routeOrthogonal は作らない。style sync/async/return と cardinality arrow を draw.io style へ変換する。zone は parent=`1` の背景 cell、entity row は parent=`n-${entityId}` の child vertex として現行 style を移植する。

- [ ] **Step 4: 既存 renderer test を移植して verify**

現行 renderer tests を次の assertion 群として移す。HTML: XML escape、embedded JSON `<` escape、determinism、zone group、lifeline、terminal ellipse、edge polyline、empty label、node selection data、detail panel、no external resource、full document。drawio: XML escape、determinism、zone cell、lifeline cell、terminal style、generic edge、sequence style、ER cardinality、waypoint、empty waypoint、entity rows、mxfile root。

Run: `cd plugins/basic-design && pnpm test -- src/render/html.test.ts src/render/drawio.test.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add plugins/basic-design/src/render/{html,html.test,drawio,drawio.test}.ts
git commit -m "feat(basic-design): HTML と drawio を刷新

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: ER 図を最後に ELK へ移行する

**Files:**
- Modify: `plugins/basic-design/src/layout/graph.ts`
- Modify: `plugins/basic-design/src/layout/graph.test.ts`
- Modify: `plugins/basic-design/src/render/html.ts`
- Modify: `plugins/basic-design/src/render/html.test.ts`
- Modify: `plugins/basic-design/src/render/drawio.ts`
- Modify: `plugins/basic-design/src/render/drawio.test.ts`
- Create: `plugins/basic-design/src/fixtures/complex-er.spec.json`

**Interfaces:**
- Produces: `layoutEr(spec):Promise<Layout>`、PK/FK/UQ badge、cardinality label。

- [ ] **Step 1: failing ER test**

```ts
test("ER preserves rows/cardinality/points",async()=>{const l=await layoutEr(er);expect(l.nodes[0]).toMatchObject({shape:"entity",headerHeight:36,rowHeight:28});expect(l.edges[0]).toMatchObject({cardinality:"1:N"});expect(l.edges[0].points.length).toBeGreaterThanOrEqual(2);expect(assertLayoutHasNoOverlaps(l)).toEqual([])})
```

Run: `cd plugins/basic-design && pnpm test -- src/layout/graph.test.ts`

Expected: FAIL。

- [ ] **Step 2: ER graph を実装する**

```ts
const children=spec.entities.map(e=>({id:e.name,width:240,height:36+e.columns.length*28}))
const edges=(spec.relations??[]).map((r,i)=>{const text=`${r.cardinality} ${r.label??""}`.trim();return{id:`rel${i+1}`,sources:[r.from],targets:[r.to],labels:[{text,width:Math.max(56,text.length*7+16),height:18}]}})
```

direction DOWN。Layout 変換を次で固定し、edge は元 `label` と `cardinality` を分離して保持する。ELK へ渡す label text だけが `${cardinality} ${label}`。

```ts
function formatColumn(column:ErSpec["entities"][number]["columns"][number]) {
  const marks=[column.pk&&"PK",column.fk&&"FK",column.unique&&"UQ"].filter(Boolean)
  const prefix=marks.length?`[${marks.join(",")}] `:""
  return column.type?`${prefix}${column.name} : ${column.type}`:`${prefix}${column.name}`
}
const rows=entity.columns.map(column=>({
  text:formatColumn(column),
  meta:{name:column.name,type:column.type??"",pk:column.pk===true,fk:column.fk===true,unique:column.unique===true}
}))
const layoutEdge={id:`rel${i+1}`,from:r.from,to:r.to,label:r.label??"",cardinality:r.cardinality,points:points(elkEdge),labelBox:labelBox(elkEdge)}
```

- [ ] **Step 3: ER renderer を実装する**

```ts
function badges(meta:Record<string,unknown>){return (["pk","fk","unique"] as const).filter(k=>meta[k]===true).map(k=>`<span class="badge badge-${k}">${k==="unique"?"UQ":k.toUpperCase()}</span>`).join("")}
```

HTML entity renderer の各 `row` 内で `badges(row.meta)` を row text の前へ挿入する。badge 色は PK `#F59E0B`、FK `#8B5CF6`、UQ `#0EA5E9`。

drawio row cell は次の構造で entity cell の child とし、`ERone/ERmany` と waypoint を維持する。

```ts
function rowCell(node:LayoutNode,row:LayoutRow,index:number){return `<mxCell id="${escapeXml(node.id)}-row${index+1}" value="${escapeXml(row.text)}" style="text;html=1;strokeColor=#E2E8F0;fillColor=#FFFFFF;align=left;verticalAlign=middle;spacingLeft=10;fontSize=12;" vertex="1" parent="n-${escapeXml(node.id)}"><mxGeometry y="${node.headerHeight!+index*node.rowHeight!}" width="${node.width}" height="${node.rowHeight}" as="geometry"/></mxCell>`}
```

- [ ] **Step 4: complex fixture/property test**

`complex-er.spec.json` は `users/orders/order_items/products/categories/payments/shipments/addresses/coupons/order_coupons` の10 entity と14 relation を持ち、`1:1` / `1:N` / `N:1` / `N:M` を各1件以上、PK/FK/UQ column を各2件以上含める。test は node 10/edge 14 と overlap 0 を検査する。通らない場合のみ、設計書で許可された「現行 degree grid の固定 node + ELK orthogonal routing」へ退避する。自作 router は復活させない。

Run: `cd plugins/basic-design && pnpm test -- src/layout/graph.test.ts src/render/html.test.ts src/render/drawio.test.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add plugins/basic-design/src/layout/{graph,graph.test}.ts plugins/basic-design/src/render/{html,html.test,drawio,drawio.test}.ts plugins/basic-design/src/fixtures/complex-er.spec.json
git commit -m "feat(basic-design): ER 図を ELK 化

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 4図種横断 overlap suite と async CLI bundle

**Files:**
- Create: `plugins/basic-design/src/layout/overlap.test.ts`
- Create: `plugins/basic-design/src/cli.ts`
- Create: `plugins/basic-design/src/cli.test.ts`
- Modify: `plugins/basic-design/build.ts`
- Generated: `plugins/basic-design/scripts/design-gen.mjs`

**Interfaces:**
- Produces: sample 4 + complex 4 の性質 suite、`main(argv):Promise<void>`、現行 CLI 契約。

- [ ] **Step 1: parameterized overlap test**

```ts
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
const load=(relative:string)=>JSON.parse(readFileSync(fileURLToPath(new URL(relative,import.meta.url)),"utf8")) as DiagramSpec
const CASES=[["../../samples/web-architecture.spec.json",layoutArchitecture],["../../samples/ec-screen-flow.spec.json",layoutScreenFlow],["../../samples/order-system.spec.json",layoutEr],["../../samples/login-sequence.spec.json",layoutSequence],["../fixtures/complex-architecture.spec.json",layoutArchitecture],["../fixtures/complex-screen-flow.spec.json",layoutScreenFlow],["../fixtures/complex-er.spec.json",layoutEr],["../fixtures/complex-sequence.spec.json",layoutSequence]] as const
test.each(CASES)("%s has no overlaps",async(path,fn)=>{const spec=load(path);const layout=decorateLayout(spec,await fn(spec as never));expect(assertLayoutHasNoOverlaps(layout)).toEqual([])})
```

Run: `cd plugins/basic-design && pnpm test -- src/layout/overlap.test.ts`

Expected: 具体 overlap ID を含む FAIL または8件 PASS。FAIL 時は ELK spacing または sequence `MESSAGE_GAP` の固定値だけを増やし、自作 collision loop は追加しない。

- [ ] **Step 2: subprocess CLI failing tests を移植する**

現行12ケースを、次の assertion 名で同じ file に移す: `usage failure`、`invalid format`、`missing format value`、`unreadable spec`、`invalid JSON`、`validation errors`、`default both`、`drawio only`、`html only`、`screen-flow success`、`architecture success`、`sequence success`。ER success は `default both` の fixture を ER にする。さらに `.spec.json` と通常 `.json` の basename、stdout 1行、stderr empty、exit code を各該当 test で確認する。

```ts
test("failure is one JSON line",async()=>{const r=await invoke([]);expect(r.code).toBe(1);expect(r.stderr).toBe("");expect(r.stdout.trim().split("\n")).toHaveLength(1);expect(JSON.parse(r.stdout)).toEqual({ok:false,errors:["usage: node design-gen.mjs <spec.json> --format <drawio|html|both>"]})})
```

- [ ] **Step 3: async CLI を実装する**

```ts
const LAYOUTS:Record<DiagramSpec["type"],(spec:never)=>Promise<Layout>>={architecture:layoutArchitecture as never,"screen-flow":layoutScreenFlow as never,er:layoutEr as never,sequence:layoutSequence as never}
const FORMATS=["drawio","html","both"] as const
function fail(errors:string[]):never{process.stdout.write(`${JSON.stringify({ok:false,errors})}\n`);process.exit(1)}
export async function main(argv=process.argv.slice(2)){
  const formatIndex=argv.indexOf("--format")
  const specArg=argv.find((arg,index)=>!arg.startsWith("--")&&(formatIndex===-1||index!==formatIndex+1))
  const format=formatIndex===-1?"both":argv[formatIndex+1]
  if(!specArg)fail(["usage: node design-gen.mjs <spec.json> --format <drawio|html|both>"])
  if(!FORMATS.includes(format as never))fail([`--format: "${format}" は不正です(対応: ${FORMATS.join(", ")})`])
  let unknown:unknown
  try{unknown=JSON.parse(readFileSync(specArg,"utf8"))}catch(error){fail([`spec ファイルを読めません: ${(error as Error).message}`])}
  const errors=validateSpec(unknown);if(errors.length)fail(errors)
  const spec=unknown as DiagramSpec
  try{
    const layout=decorateLayout(spec,await LAYOUTS[spec.type](spec as never))
    const dir=path.dirname(path.resolve(specArg)),name=path.basename(specArg)
    const base=name.endsWith(".spec.json")?name.slice(0,-".spec.json".length):name.replace(/\.json$/,"")
    const files:string[]=[]
    if(format==="drawio"||format==="both"){const out=path.join(dir,`${base}.drawio`);writeFileSync(out,renderDrawio(layout));files.push(out)}
    if(format==="html"||format==="both"){const out=path.join(dir,`${base}.html`);writeFileSync(out,renderHtml(layout,spec));files.push(out)}
    process.stdout.write(`${JSON.stringify({ok:true,files})}\n`)
  }catch(error){fail([`図の生成に失敗しました: ${(error as Error).message}`])}
}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>fail([`図の生成に失敗しました: ${(e as Error).message}`]))
```

成功例(`--format both`)は `{"ok":true,"files":["/abs/path/ec-screen-flow.drawio","/abs/path/ec-screen-flow.html"]}`。配列順は drawio、html。format が単独なら対応する1件だけを返す。

- [ ] **Step 4: 2-entry build にする**

```ts
import esbuild from "esbuild"
await esbuild.build({bundle:true,entryPoints:{"design-gen":"./src/cli.ts","check-drive-config":"./src/check-drive-config.ts"},outdir:"./scripts",outExtension:{".js":".mjs"},platform:"node",format:"esm",sourcemap:false,target:"node20",banner:{js:'import { createRequire as __basicDesignCreateRequire } from "node:module"; const require = __basicDesignCreateRequire(import.meta.url);'}})
```

- [ ] **Step 5: build/CLI/bundle verify**

Run: `cd plugins/basic-design && pnpm build && pnpm test && pnpm typecheck && node scripts/design-gen.mjs samples/ec-screen-flow.spec.json --format html`

Expected: tests/typecheck/build PASS。最後は `{ok:true,files:[...]}` 1行。

Run: `cd plugins/basic-design && node -e 'const s=require("node:fs").readFileSync("scripts/design-gen.mjs","utf8");if(/from ["'\x60]elkjs/.test(s))process.exit(1)'`

Expected: exit 0(外部 elkjs import なし)。

- [ ] **Step 6: commit**

```bash
git add plugins/basic-design/src/{cli,cli.test}.ts plugins/basic-design/src/layout/overlap.test.ts plugins/basic-design/build.ts plugins/basic-design/scripts/*.mjs
git commit -m "feat(basic-design): async CLI を単一バンドル化

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: kind schema、SKILL ブレスト、開発 docs、version 準備

**Files:**
- Modify: `plugins/basic-design/skills/system-architecture/SKILL.md`
- Modify: `plugins/basic-design/skills/system-architecture/references/spec-schema.md`
- Modify: `plugins/basic-design/skills/screen-flow/SKILL.md`
- Modify: `plugins/basic-design/skills/screen-flow/references/spec-schema.md`
- Modify: `plugins/basic-design/skills/er-diagram/SKILL.md`
- Modify: `plugins/basic-design/skills/er-diagram/references/spec-schema.md`
- Modify: `plugins/basic-design/skills/sequence-diagram/SKILL.md`
- Modify: `plugins/basic-design/skills/sequence-diagram/references/spec-schema.md`
- Modify: `plugins/basic-design/README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: kind semantics、不変 CLI path。
- Produces: 任意 kind schema、kind 確認手順、pnpm commands、elkjs 更新手順。

- [ ] **Step 1: 4 schema へ exact 文面を追加する**

```markdown
- `kind` (任意文字列): 色・アイコンの種別。推奨値は `generic` / `user` / `api` / `data` / `messaging` / `external` / `screen` / `entity`。未知値は生成エラーにせず `generic` 表示になる。
```

例は architecture `api`、screen `screen`(start/end shape 値は維持)、ER `entity`、sequence `user|generic|external`。

- [ ] **Step 2: 4 SKILL.md の spec 作成直前へ追加する**

```markdown
- 各ノードの視覚種別 `kind` を確認する。ユーザーが判断しない場合はラベル・icon・ゾーンから推定候補を提示して確認し、確定値を spec に明示する。
```

図種別の推奨値も schema と同じに書く。実行 command は変更しない。

- [ ] **Step 3: command 不変を検査する**

Run: `rg -n 'node "\$\{CLAUDE_PLUGIN_ROOT\}/scripts/design-gen\.mjs"' plugins/basic-design/skills/{system-architecture,screen-flow,er-diagram,sequence-diagram}/SKILL.md`

Expected: 4件。

- [ ] **Step 4: README / CLAUDE.md を更新する**

```markdown
## 図生成スクリプトの開発
`cd plugins/basic-design && pnpm install && pnpm test && pnpm typecheck && pnpm build`
`src/` が正で `scripts/*.mjs` は生成物。elkjs 更新は exact version 更新 → install → test/typecheck/build → samples 再生成 → HTML/drawio 目視 → lock/bundle/samples 同時 commit。
```

CLAUDE.md command row:

```markdown
| basic-design(ビルド/テスト/型) | `cd plugins/basic-design && pnpm build` / `pnpm test`(vitest) / `pnpm typecheck` |
```

- [ ] **Step 5: verify / commit**

Run: `git diff --check -- CLAUDE.md plugins/basic-design/README.md plugins/basic-design/skills && cd plugins/basic-design && pnpm test && pnpm typecheck`

Expected: diff-check 無出力、tests PASS。

```bash
git add CLAUDE.md plugins/basic-design/README.md plugins/basic-design/skills
git commit -m "docs(basic-design): kind と TypeScript 開発手順を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: samples 再生成、人間目視、旧実装削除、0.5.0-dev

**Files:**
- Modify: `plugins/basic-design/samples/{web-architecture,ec-screen-flow,order-system,login-sequence}.{html,drawio}`
- Delete after approval: `plugins/basic-design/scripts/lib/**`
- Delete after approval: `plugins/basic-design/scripts/{route,validate,render-drawio,render-html,layout-architecture,layout-screen-flow,layout-er,layout-sequence,xml-util,design-gen,check-drive-config}.test.mjs`
- Delete after approval: `plugins/basic-design/scripts/test-helpers.mjs`
- Modify after approval: `plugins/basic-design/.claude-plugin/plugin.json:4`

**Interfaces:**
- Produces: 承認済み8 samples、scripts/ は2 bundleのみ、manifest `0.5.0-dev`。

- [ ] **Step 1: 全検証後に4 samples を再生成する**

Run:

```bash
cd plugins/basic-design && pnpm test && pnpm typecheck && pnpm build
node scripts/design-gen.mjs samples/web-architecture.spec.json --format both
node scripts/design-gen.mjs samples/ec-screen-flow.spec.json --format both
node scripts/design-gen.mjs samples/order-system.spec.json --format both
node scripts/design-gen.mjs samples/login-sequence.spec.json --format both
```

Expected: failure 0。各 CLI は `{"ok":true,"files":["/absolute/<base>.drawio","/absolute/<base>.html"]}` の JSON 1行。配列順は drawio、html。

- [ ] **Step 2: generated structure smoke test**

Run:

```bash
cd plugins/basic-design
rg -L 'id="design-layout"' samples/*.html
rg -n '<script[^>]+src=|<link[^>]+href=' samples/*.html
rg -L '<mxfile host="basic-design">' samples/*.drawio
```

Expected: 全コマンド無出力。

- [ ] **Step 3: 人間 HTML チェックポイントで STOP**

4 HTML をブラウザで確認依頼する。確認項目: overlap なし、kind 色/icon、zone/terminal/entity/lifeline、PK/FK/UQ/cardinality、sync/async/return、zoom/pan/select/hover/detail、文字切れなし。`HTML 4件承認` を得るまで次へ進まない。

- [ ] **Step 4: 人間 drawio チェックポイントで STOP**

4 drawio を diagrams.net で確認依頼する。確認項目: open 成功、palette/emoji/shadow、waypoint が node を横切らない、zone/ER/cardinality/lifeline/arrow、編集可能。`drawio 4件承認` を得るまで次へ進まない。

- [ ] **Step 5: 両承認後だけ旧 JS source/tests を削除する**

```bash
rm -rf plugins/basic-design/scripts/lib
rm -f plugins/basic-design/scripts/{route,validate,render-drawio,render-html,layout-architecture,layout-screen-flow,layout-er,layout-sequence,xml-util,design-gen,check-drive-config}.test.mjs plugins/basic-design/scripts/test-helpers.mjs
```

Expected: `scripts/` は `design-gen.mjs` と `check-drive-config.mjs` のみ。

- [ ] **Step 6: manifest を exact 更新する**

```json
{"name":"basic-design","description":"基本設計フェーズの成果物(ER図・画面遷移図・システム構成図など)をブレインストーミングで作成するツール群","version":"0.5.0-dev"}
```

- [ ] **Step 7: clean/frozen/bundle-only 最終検証**

Run:

```bash
cd plugins/basic-design
pnpm install --frozen-lockfile && pnpm test && pnpm typecheck && pnpm build
rg -n 'scripts/lib|routeOrthogonal|fromPt|toPt|node --test plugins/basic-design/scripts' . ../../CLAUDE.md
mv node_modules node_modules.verify-backup
node scripts/design-gen.mjs samples/ec-screen-flow.spec.json --format html
node scripts/check-drive-config.mjs /tmp
mv node_modules.verify-backup node_modules
```

Expected: install/test/typecheck/build PASS、rg 無出力、node_modules 不在でも2 CLI が JSON 1行で成功。失敗時も backup を必ず戻す。

- [ ] **Step 8: sample commit と最終 cleanup commit**

sample 承認直後:

```bash
git add plugins/basic-design/samples plugins/basic-design/scripts/*.mjs
git commit -m "docs(basic-design): 新レイアウトで samples を再生成

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

最終:

```bash
git add -A plugins/basic-design CLAUDE.md
git commit -m "refactor(basic-design): TypeScript 図生成へ完全移行

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Completion Criteria

- `src/` が唯一の source/test、`scripts/` は2つの単一 bundle のみ。
- elkjs `0.11.1` exact、lockfile/bundle 同梱、node_modules 不在で実行可能。
- CLI 引数・format・basename・JSON 1行・stdout-only・exit code が不変。
- Drive 9ケース、旧 validation/renderer/layout/CLI tests が Vitest へ移植済み。
- sample 4 + complex 4 で4種 overlap が0。
- decorate の sample 全 node 推定が inline snapshot 固定。
- HTML/drawio の visual・図種固有表現・interaction がテストと目視で確認済み。
- 4 schema/SKILL.md が任意 kind と確認手順を記載し、design-gen command は不変。
- 人間が HTML 4件・drawio 4件を承認した後にのみ旧 JS を削除。
- manifest は `0.5.0-dev`。メジャー採否は人間判断として残る。
