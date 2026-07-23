import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test, vi } from "vitest"
import {
  AntibodyIoError,
  AntibodyNotFoundError,
  antibodyFilePath,
  createAntibody,
  listAntibodies,
  patchAntibody,
  recordAntibodyFire,
  setAntibodyStatus,
  writeAntibodyCreate
} from "../antibody-store.js"
import {
  AntibodyValidationError,
  serializeAntibodyMarkdown
} from "../frontmatter.js"
import type { Antibody, AntibodyTrigger } from "../types.js"

function withProject(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raphael-antibodies-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function value(overrides: Partial<Antibody> = {}): Antibody {
  return {
    id: "ab-2026-0724-001",
    created: "2026-07-24",
    source: "manual",
    trigger: { event: "PreToolUse", tool: "Bash", pattern: "pnpm test" },
    status: "active",
    stats: { fired: 0, last_fired: null },
    expires: "2026-08-23",
    body: "Run the focused test first.",
    ...overrides
  }
}

const draft = {
  source: "infection-1",
  trigger: {
    event: "PreToolUse" as const,
    tool: "Bash" as const,
    pattern: "pnpm test"
  },
  expires: "2026-08-23",
  body: "Run the focused test first."
}

test("ローカル日付の日次 ID を有効最大値+1で採番し、番号を再利用しない", () => {
  withProject((dir) => {
    writeAntibodyCreate(dir, value())
    writeAntibodyCreate(
      dir,
      value({ id: "ab-2026-0724-003", source: "manual-3" })
    )
    fs.writeFileSync(
      antibodyFilePath(dir, "ab-2026-0724-010"),
      "not an antibody"
    )

    const created = createAntibody(
      dir,
      draft,
      new Date(2026, 6, 24, 23, 59, 59)
    )
    expect(created.id).toBe("ab-2026-0724-004")
    expect(created.created).toBe("2026-07-24")
    expect(created.stats).toEqual({ fired: 0, last_fired: null })
    expect(created.status).toBe("active")
  })
})

test("同日 999 を超える採番を validation error にする", () => {
  withProject((dir) => {
    writeAntibodyCreate(dir, value({ id: "ab-2026-0724-999" }))
    expect(() => createAntibody(dir, draft, new Date(2026, 6, 24, 12))).toThrow(
      AntibodyValidationError
    )
  })
})

test("atomic create の衝突時に一覧を再読して最大3回再採番する", () => {
  withProject((dir) => {
    const realWrite = fs.writeFileSync.bind(fs)
    let exclusiveWrites = 0
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(((
      file: fs.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
      options?: unknown
    ) => {
      const flag =
        typeof options === "object" && options !== null && "flag" in options
          ? (options as { flag?: string }).flag
          : undefined
      if (flag === "wx" && exclusiveWrites === 0) {
        exclusiveWrites += 1
        const collided = value()
        realWrite(file, serializeAntibodyMarkdown(collided), "utf8")
        const error = new Error("collision") as NodeJS.ErrnoException
        error.code = "EEXIST"
        throw error
      }
      return realWrite(file, data, options as never)
    }) as typeof fs.writeFileSync)

    try {
      expect(createAntibody(dir, draft, new Date(2026, 6, 24)).id).toBe(
        "ab-2026-0724-002"
      )
      expect(exclusiveWrites).toBe(1)
    } finally {
      spy.mockRestore()
    }
  })
})

test("初回衝突後に最大3回再採番し、全て衝突したら I/O error にする", () => {
  withProject((dir) => {
    let exclusiveWrites = 0
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(((
      _file: fs.PathOrFileDescriptor,
      _data: string | NodeJS.ArrayBufferView,
      options?: unknown
    ) => {
      const flag =
        typeof options === "object" && options !== null && "flag" in options
          ? (options as { flag?: string }).flag
          : undefined
      if (flag === "wx") {
        exclusiveWrites += 1
        const error = new Error("collision") as NodeJS.ErrnoException
        error.code = "EEXIST"
        throw error
      }
      return undefined
    }) as typeof fs.writeFileSync)

    try {
      expect(() => createAntibody(dir, draft, new Date(2026, 6, 24))).toThrow(
        AntibodyIoError
      )
      expect(exclusiveWrites).toBe(4)
    } finally {
      spy.mockRestore()
    }
  })
})

test("既存 ID の atomic create 上書きを拒否する", () => {
  withProject((dir) => {
    writeAntibodyCreate(dir, value())
    expect(() =>
      writeAntibodyCreate(dir, value({ body: "overwrite" }))
    ).toThrow(AntibodyValidationError)
    expect(
      fs.readFileSync(antibodyFilePath(dir, value().id), "utf8")
    ).toContain("Run the focused test first.")
  })
})

test("patch は source/trigger/body のみ atomic 更新し invalid patch は書かない", () => {
  withProject((dir) => {
    writeAntibodyCreate(dir, value())
    const before = fs.readFileSync(antibodyFilePath(dir, value().id), "utf8")
    expect(() =>
      patchAntibody(dir, value().id, {
        trigger: {
          ...value().trigger,
          pattern: "["
        } as AntibodyTrigger
      })
    ).toThrow(AntibodyValidationError)
    expect(fs.readFileSync(antibodyFilePath(dir, value().id), "utf8")).toBe(
      before
    )

    const updated = patchAntibody(dir, value().id, {
      source: "external:tool#1",
      body: "Updated body."
    })
    expect(updated).toMatchObject({
      source: "external:tool#1",
      body: "Updated body.",
      status: "active",
      expires: "2026-08-23"
    })
  })
})

test("confirmed status 更新でも expires の byte-level 値を保持する", () => {
  withProject((dir) => {
    writeAntibodyCreate(dir, value({ expires: "2026-08-23" }))
    setAntibodyStatus(dir, value().id, "confirmed")
    const raw = fs.readFileSync(antibodyFilePath(dir, value().id), "utf8")
    expect(raw).toContain("status: confirmed\n")
    expect(raw).toContain("expires: 2026-08-23\n")
  })
})

test("record-fire は fired とローカル日付を atomic 更新する", () => {
  withProject((dir) => {
    writeAntibodyCreate(dir, value())
    const updated = recordAntibodyFire(
      dir,
      value().id,
      new Date(2026, 6, 25, 1)
    )
    expect(updated.stats).toEqual({ fired: 1, last_fired: "2026-07-25" })
  })
})

test("list は不正ファイルを errors に分離して有効抗体を返す", () => {
  withProject((dir) => {
    writeAntibodyCreate(dir, value())
    fs.writeFileSync(
      antibodyFilePath(dir, "ab-2026-0724-002"),
      "broken",
      "utf8"
    )
    const listed = listAntibodies(dir)
    expect(listed.antibodies.map(({ id }) => id)).toEqual([value().id])
    expect(listed.errors).toHaveLength(1)
    expect(listed.errors[0]?.file).toBe("ab-2026-0724-002.md")
  })
})

test("存在しない抗体の更新は not found error にする", () => {
  withProject((dir) => {
    expect(() => patchAntibody(dir, value().id, { body: "missing" })).toThrow(
      AntibodyNotFoundError
    )
  })
})
