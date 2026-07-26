import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { parseFrontmatter } from "../frontmatter.js"
import { processedDir, questionsDir } from "../paths.js"
import { claimQuestion, listQuestions, writeQuestion } from "../queue.js"

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guidepost-queue-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("質問の書き込みと列挙を往復できる", () => {
  withTmpDir((dir) => {
    const name = writeQuestion(dir, {
      tourId: "tour-001",
      stopId: "stop-01",
      body: "この変更の理由は何ですか？"
    })

    expect(name).toMatch(/^\d{8}T\d{9}(?:-\d+)?\.md$/)
    expect(listQuestions(dir)).toEqual([
      {
        name,
        tourId: "tour-001",
        stopId: "stop-01",
        createdAt: expect.any(String),
        body: "この変更の理由は何ですか？"
      }
    ])
  })
})

test("空本文の質問は保存せず null を返す", () => {
  withTmpDir((dir) => {
    expect(
      writeQuestion(dir, {
        tourId: "tour-001",
        stopId: "stop-01",
        body: " \n\t "
      })
    ).toBeNull()
    expect(fs.existsSync(questionsDir(dir))).toBe(false)
  })
})

test("frontmatter がない質問もメタデータなしで列挙する", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(questionsDir(dir), { recursive: true })
    fs.writeFileSync(
      path.join(questionsDir(dir), "manual.md"),
      "手書きの質問です\n"
    )

    expect(listQuestions(dir)).toEqual([
      {
        name: "manual.md",
        tourId: null,
        stopId: null,
        createdAt: null,
        body: "手書きの質問です"
      }
    ])
  })
})

test("claimQuestion は質問を processed に移動する", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(questionsDir(dir), { recursive: true })
    fs.writeFileSync(path.join(questionsDir(dir), "question.md"), "質問")

    expect(claimQuestion(dir, "question.md")).toBe(true)
    expect(fs.existsSync(path.join(questionsDir(dir), "question.md"))).toBe(
      false
    )
    expect(fs.existsSync(path.join(processedDir(dir), "question.md"))).toBe(
      true
    )
  })
})

test("同じ質問を 2 回 claim すると 2 回目は false", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(questionsDir(dir), { recursive: true })
    fs.writeFileSync(path.join(questionsDir(dir), "question.md"), "質問")

    expect(claimQuestion(dir, "question.md")).toBe(true)
    expect(claimQuestion(dir, "question.md")).toBe(false)
  })
})

test("キューディレクトリがない場合は空配列を返す", () => {
  withTmpDir((dir) => {
    expect(listQuestions(dir)).toEqual([])
  })
})

test("改行を含む ID は frontmatter で引用され、往復できる", () => {
  withTmpDir((dir) => {
    const tourId = "tour\nnext"
    const stopId = "stop\nnext"
    const name = writeQuestion(dir, { tourId, stopId, body: "質問" })
    expect(name).not.toBeNull()

    const raw = fs.readFileSync(
      path.join(questionsDir(dir), name as string),
      "utf8"
    )
    expect(raw).toContain('tourId: "tour\\nnext"')
    expect(raw).toContain('stopId: "stop\\nnext"')
    expect(parseFrontmatter(raw).data).toMatchObject({ tourId, stopId })
  })
})
