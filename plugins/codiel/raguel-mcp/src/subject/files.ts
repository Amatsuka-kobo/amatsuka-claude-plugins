/**
 * evaluate_plan・evaluate_design の paths を読む(設計書 §6.2.3)。
 * 追跡されていないファイルも読む。
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { joinSections } from "./body"
import {
  readBlob,
  readHead,
  resolveRepoPath,
  sha256Hex,
  validateRelativePaths
} from "./code"
import {
  type Subject,
  type SubjectBody,
  type SubjectFile,
  SubjectInputError
} from "./types"

export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_PATHS = 20

export interface FilesSubjectInput {
  projectRoot: string
  repoPath?: string
  paths: string[]
}

export interface FilesSubject {
  subject: Subject
  body: SubjectBody
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
}

function readOne(repoReal: string, p: string): Buffer {
  let real: string
  try {
    real = fs.realpathSync(path.resolve(repoReal, p))
  } catch {
    throw new SubjectInputError(`ファイルが無い: ${p}`)
  }
  if (!isInside(repoReal, real)) {
    throw new SubjectInputError(`repoPath の外を指すパスは読まない: ${p}`)
  }
  const stat = fs.statSync(real)
  if (!stat.isFile()) throw new SubjectInputError(`通常のファイルでない: ${p}`)
  if (stat.size > MAX_FILE_BYTES) {
    throw new SubjectInputError(
      `${MAX_FILE_BYTES} バイトを超えるファイルは読まない: ${p}`
    )
  }
  return fs.readFileSync(real)
}

/** paths を読み、見出し行 `=== <path> ===` でつないだ本文と subject を返す */
export function collectFilesSubject(input: FilesSubjectInput): FilesSubject {
  const repoPath = resolveRepoPath(input.repoPath, input.projectRoot)
  const { paths } = input
  if (paths.length < 1 || paths.length > MAX_PATHS) {
    throw new SubjectInputError(`paths は 1〜${MAX_PATHS} 件で渡す`)
  }
  validateRelativePaths(paths)
  const repoReal = fs.realpathSync(repoPath)
  const head = readHead(repoPath)
  const decoder = new TextDecoder("utf-8", { fatal: true })

  const files: SubjectFile[] = []
  const sections = paths.map((p) => {
    const bytes = readOne(repoReal, p)
    let text: string
    try {
      text = decoder.decode(bytes)
    } catch {
      throw new SubjectInputError(`UTF-8 として読めない: ${p}`)
    }
    // "./" を付けると、HEAD:<path> を repoPath からの相対で解決する
    const inHead =
      head !== null && readBlob(repoPath, `${head}:./${p}`) !== null
    files.push({ path: p, sha256: sha256Hex(bytes), isNew: !inHead })
    return { heading: p, content: text }
  })

  return {
    subject: { repoPath, head, paths, files },
    body: joinSections(sections)
  }
}
