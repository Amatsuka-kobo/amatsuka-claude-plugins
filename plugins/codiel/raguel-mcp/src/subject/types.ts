/**
 * 評価対象(subject)の型。Subject の型の正本はこのファイルに置き、
 * core/types.ts は定義し直さずに re-export する。
 */

/** subject に載せるファイル 1 件 */
export interface SubjectFile {
  /** repoPath 相対(code は git のトップレベル相対)のパス */
  path: string
  /** code は HEAD の blob、plan と design は読んだバイト列の sha256。削除は null */
  sha256: string | null
  /** HEAD にそのパスが無ければ true */
  isNew: boolean
}

/** subject.json と応答の subject に載せる中身(設計書 §6.9.2) */
export interface Subject {
  repoPath: string
  /** 40 桁のコミット。HEAD を解決できないとき(git の管理外、コミットが無い)だけ null */
  head: string | null
  /** evaluate_code だけ持つ */
  base?: string
  /** 入力で paths を指定したときだけ持つ */
  paths?: string[]
  files: SubjectFile[]
  /** evaluate_decision だけ持つ。本文全体の sha256 */
  contentSha256?: string
}

/**
 * 見出し行の位置を持つ検査の本文。
 * headingLines は text を "\n" で分けたときの 0 始まりの行番号で、ルール層の検査から外す。
 */
export interface SubjectBody {
  text: string
  headingLines: number[]
}

/** 入力の誤り。MCP のツールエラー(isError)に変換する */
export class SubjectInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SubjectInputError"
  }
}
