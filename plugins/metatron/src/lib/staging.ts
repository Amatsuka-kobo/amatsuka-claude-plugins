// stage → commit の 2 段階書き込みで使う staging の保存・照合・期限・単回消費。
//
// 規則の正本はファイル契約
// `harness-docs/design/2026-08-16-file-contract-freeze.md` の §11「staging の保証」。
// 設計上の根拠は metatron 設計書 §7-3。
//
// 保存先は `<tmpdir>/metatron-staging/<プロジェクトパスのハッシュ>/<id>.json`。
// CLI はサブコマンドごとに別プロセスとして起動するため、staging はプロセス外へ置く。
// プロジェクト内に置かないのは、staging がセッション限りの一時状態であって
// プロジェクト資産ではないためである(全利用プロジェクトへの .gitignore 追加や
// 書きかけドラフトの誤コミットを避ける)。
//
// この層は第 1 層(内容の検証)であり、フェイルクローズドする。
// ただし失敗は例外ではなく判別可能な値(`ok: false` と `error`)で返す。

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const STAGING_DIR_NAME = "metatron-staging"
// 2: レコードへ recordHash を追加した(改竄検知。computeRecordHash のコメントを見よ)。
export const STAGING_RECORD_VERSION = 2

/** 契約 §11: staging は単回使用かつ有効期限つき(既定 30 分)。 */
export const DEFAULT_STAGING_TTL_MS = 30 * 60 * 1000

/** stage の対象。いずれも ARCHITECTURE ファイルを書き換える経路である。 */
export type StagingKind = "architecture" | "adr"

export interface StagingRecord {
  version: number
  stagingId: string
  kind: StagingKind
  /** 書き込み対象の絶対パス。 */
  targetPath: string
  /** stage 時点の対象ファイルの内容ハッシュ。存在しなかった場合は null。 */
  baseHash: string | null
  /** commit 時に書き込む全文。 */
  nextContent: string
  createdAt: number
  expiresAt: number
  /** 消費済みなら消費時刻。未消費は null。 */
  usedAt: number | null
  /** 呼び出し元が持たせる付随情報(ADR の assignedId など)。 */
  meta: Record<string, unknown>
  /**
   * recordHash 以外の全フィールドから算出した、このレコード自身の内容ハッシュ。
   * 保証範囲は `computeRecordHash` のコメントに書いてある。
   */
  recordHash: string
}

export type CreateStagingError = "invalid" | "staging_unavailable"

export type CommitStagingError =
  | "unknown_id"
  | "tampered"
  | "already_used"
  | "expired"
  | "file_changed"
  | "write_failed"
  /** 消費の印を保存できなかった。書き込みには進んでいない(commitStaging のコメント)。 */
  | "staging_unavailable"

export type ReadStagingError = "unknown_id" | "tampered"

export interface CreateStagingInput {
  /** 契約 §3 の docRoot。保存先ディレクトリを分ける鍵になる。 */
  projectRoot: string
  kind: StagingKind
  /** 書き込み対象。相対パスは projectRoot 基準で解決する。 */
  targetPath: string
  /** commit 時に書き込む全文。 */
  nextContent: string
  /**
   * 呼び出し元の検証結果。1 件でもあれば stagingId を発行しない。
   * 「壊れたブロックは stage すらできない」保証を、分岐忘れでも破れない位置に置く。
   */
  validationErrors?: string[]
  /**
   * stage 時点の内容ハッシュ。`null` は「対象ファイルが存在しなかった」を表す。
   * 省略時はここでファイルを読んで算出する。diff を計算した時点のバイト列を
   * そのまま照合させたい呼び出し元は、`hashContent` の値を明示的に渡す。
   */
  baseHash?: string | null
  meta?: Record<string, unknown>
  /** 有効期限。既定は DEFAULT_STAGING_TTL_MS(30 分)。 */
  ttlMs?: number
  /** 現在時刻。テストと再現のために注入できる。 */
  now?: number
}

export type CreateStagingResult =
  | {
      ok: true
      stagingId: string
      /** staging レコードの絶対パス(プロジェクト外)。 */
      recordPath: string
      targetPath: string
      baseHash: string | null
      createdAt: number
      expiresAt: number
    }
  | { ok: false; error: CreateStagingError; reasons: string[] }

export interface CommitStagingInput {
  projectRoot: string
  stagingId: string
  now?: number
}

export type CommitStagingResult =
  | {
      ok: true
      stagingId: string
      kind: StagingKind
      /** 書き込んだファイルの絶対パス。 */
      path: string
      bytesWritten: number
      meta: Record<string, unknown>
      /**
       * 書き込みは成功したが後始末で問題が出た場合の 1 行説明。
       * 消費の印は書き込みの前に付け終えるため、現在この配列は常に空である
       * (成功後に残る後始末が無い)。呼び出し元の形は変えずに残してある。
       */
      warnings: string[]
    }
  | { ok: false; error: CommitStagingError; reason: string }

export type ReadStagingResult =
  | { ok: true; record: StagingRecord }
  | { ok: false; error: ReadStagingError; reason: string }

function hashBuffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex")
}

/** 内容ハッシュ。文字列は UTF-8 のバイト列として扱う。 */
export function hashContent(content: string | Buffer): string {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8")
  return hashBuffer(buf)
}

/**
 * ファイルの内容ハッシュ。読めない場合は null を返す。
 *
 * 「存在しない」と「読めない」を区別しない。stage 時と commit 時で同じ判定を通すため、
 * 権限で読めないファイルは両方 null になり `file_changed` にはならず、
 * 実際の書き込みで `write_failed` として現れる。
 */
export function hashFileOrNull(filePath: string): string | null {
  try {
    return hashBuffer(fs.readFileSync(filePath))
  } catch {
    return null
  }
}

// プロジェクトパスの分離キー。sha256 の先頭 16 文字(契約 §11)。
export function projectKey(projectRoot: string): string {
  let resolved: string
  try {
    resolved = path.resolve(projectRoot)
  } catch {
    resolved = projectRoot
  }
  let real = resolved
  try {
    real = fs.realpathSync(resolved)
  } catch {
    // 実体が無ければ解決前のパスをそのまま使う(config.ts と同じ扱い)。
  }
  return hashContent(real.split(path.sep).join("/")).slice(0, 16)
}

/** `<tmpdir>/metatron-staging`。 */
export function stagingRootDir(): string {
  return path.join(os.tmpdir(), STAGING_DIR_NAME)
}

/** `<tmpdir>/metatron-staging/<プロジェクトパスのハッシュ>`。 */
export function stagingDirFor(projectRoot: string): string {
  return path.join(stagingRootDir(), projectKey(projectRoot))
}

// stagingId をファイル名として使うため、パス区切りや `..` を含む値を拒む。
// 拒んだ値は「そんな staging は無い」として扱う(unknown_id)。
const STAGING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function isSafeStagingId(stagingId: unknown): stagingId is string {
  return typeof stagingId === "string" && STAGING_ID_PATTERN.test(stagingId)
}

/** staging レコードの絶対パス。不正な id には null を返す。 */
export function stagingRecordPath(
  projectRoot: string,
  stagingId: string
): string | null {
  if (!isSafeStagingId(stagingId)) return null
  return path.join(stagingDirFor(projectRoot), `${stagingId}.json`)
}

// config.ts の規則 3 と同じ「ルート外への脱出」判定。
function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  if (rel === "" || rel === "..") return false
  return !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStagingKind(value: unknown): value is StagingKind {
  return value === "architecture" || value === "adr"
}

// キー順に依存しない表現へ落とす。オブジェクトのキーを再帰的に並べ替える。
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const canonical = canonicalize(value[key])
      if (canonical !== undefined) out[key] = canonical
    }
    return out
  }
  return value
}

/**
 * レコード本体(recordHash 以外の全フィールド)の内容ハッシュ。
 *
 * **何のためにあるか。** stage が返した diff をユーザーへ提示したあと、保存済みの
 * staging JSON を書き換えて `commit` すると、承認された内容とは別の内容が書き込まれる。
 * 設計書 §7-3 は「承認した diff と実際に適用される diff の一致」を保証すると書いているが、
 * ハッシュ無しではその一致を照合する手段がない。commit 時にこの値を再計算して照合する。
 *
 * **守れるもの。** 偶発的な破損(書きかけ・別ツールによる上書き・部分的な文字化け)と、
 * CLI を経由しないレコード書き換えの**検知**。nextContent だけ、targetPath だけ、
 * expiresAt だけ、といった単独の差し替えはすべて不一致として弾かれる。
 *
 * **守れないもの。** recordHash も整合的に打ち直す改変は検知できない。この関数は公開されており、
 * 鍵を持たないため、同一ユーザー権限で動くプロセスは正しい recordHash を計算できる。
 * これは HMAC を導入しても本質的には変わらない —— 鍵は同じユーザーが読める場所にしか置けず、
 * 鍵の配置と失効という別の問題を持ち込むだけである。したがって metatron は
 * 「同一ユーザー権限からの意図的な改変を防ぐ」ことは目標にしない。防げるのは
 * 「CLI の 2 段階を素通りする経路」であって、「ユーザー自身が自分のマシンで行う書き換え」ではない。
 *
 * 正規化は JSON の往復を挟んでから行う。stage 時のメモリ上の値(meta に Date などが
 * 入りうる)と、commit 時に読み直した値を、必ず同じ形に揃えるためである。
 */
export function computeRecordHash(
  record: Omit<StagingRecord, "recordHash"> & { recordHash?: unknown }
): string {
  const { recordHash: _ignored, ...rest } = record
  const roundTripped: unknown = JSON.parse(JSON.stringify(rest))
  return hashContent(JSON.stringify(canonicalize(roundTripped)))
}

/** レコードが stage 時のまま(または CLI が打ち直したまま)かを照合する。 */
export function verifyRecordHash(record: StagingRecord): boolean {
  return record.recordHash === computeRecordHash(record)
}

function tamperedReason(stagingId: string): string {
  return `staging ${stagingId} の内容が stage 時から変化しています(recordHash 不一致)。承認された diff と一致しないため書き込みません。stage からやり直してください。`
}

function parseRecord(raw: unknown, stagingId: string): StagingRecord | null {
  if (!isPlainObject(raw)) return null
  if (raw.stagingId !== stagingId) return null
  if (typeof raw.version !== "number") return null
  if (!isStagingKind(raw.kind)) return null
  if (typeof raw.targetPath !== "string" || raw.targetPath === "") return null
  if (typeof raw.nextContent !== "string") return null
  if (raw.baseHash !== null && typeof raw.baseHash !== "string") return null
  if (typeof raw.createdAt !== "number") return null
  if (typeof raw.expiresAt !== "number") return null
  if (raw.usedAt !== null && typeof raw.usedAt !== "number") return null
  return {
    version: raw.version,
    stagingId,
    kind: raw.kind,
    targetPath: raw.targetPath,
    baseHash: raw.baseHash,
    nextContent: raw.nextContent,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    usedAt: raw.usedAt,
    meta: isPlainObject(raw.meta) ? raw.meta : {},
    // 欄ごと消された場合は空文字にする。sha256 の hex とは決して一致しないため、
    // 「レコードとしては読めたが整合していない」= tampered に落ちる。
    recordHash: typeof raw.recordHash === "string" ? raw.recordHash : ""
  }
}

// 破損・欠落・ディレクトリごとの消失は、いずれも「未知の ID」に落とす(契約 §11)。
function loadRecord(
  projectRoot: string,
  stagingId: string
): StagingRecord | null {
  const recordPath = stagingRecordPath(projectRoot, stagingId)
  if (recordPath === null) return null
  try {
    const text = fs.readFileSync(recordPath, "utf8")
    return parseRecord(JSON.parse(text), stagingId)
  } catch {
    return null
  }
}

// 途中で切れたレコードを残さないよう、一時ファイルへ書いてから rename する。
function writeRecord(recordPath: string, record: StagingRecord): void {
  const dir = path.dirname(recordPath)
  fs.mkdirSync(dir, { recursive: true })
  const tmpPath = `${recordPath}.tmp-${crypto.randomUUID()}`
  const body = `${JSON.stringify(record, null, 2)}\n`
  // 共有の一時ディレクトリに置くため、他ユーザーから読めないようにする。
  fs.writeFileSync(tmpPath, body, { encoding: "utf8", mode: 0o600 })
  try {
    fs.renameSync(tmpPath, recordPath)
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true })
    } catch {
      // 後始末の失敗は握りつぶす
    }
    throw err
  }
}

/**
 * staging を発行する。契約 §11 の保証 1・2 を成立させる入口。
 *
 * `validationErrors` が空でない場合は stagingId を発行しない
 * (壊れた内容は stage すらできない。設計書 §7-4)。
 */
export function createStaging(input: CreateStagingInput): CreateStagingResult {
  const errors = input.validationErrors ?? []
  if (errors.length > 0) {
    return { ok: false, error: "invalid", reasons: [...errors] }
  }

  const projectRoot = path.resolve(input.projectRoot)
  const targetPath = path.resolve(projectRoot, input.targetPath)
  if (!isInside(projectRoot, targetPath)) {
    // commit は staging に書かれたパスへ書き込むため、ここで外を弾いておく。
    return {
      ok: false,
      error: "invalid",
      reasons: [
        `書き込み対象 ${targetPath} がプロジェクトルート ${projectRoot} の外を指しています。`
      ]
    }
  }

  const now = input.now ?? Date.now()
  const ttlMs =
    typeof input.ttlMs === "number" &&
    Number.isFinite(input.ttlMs) &&
    input.ttlMs > 0
      ? input.ttlMs
      : DEFAULT_STAGING_TTL_MS

  const baseHash =
    input.baseHash === undefined ? hashFileOrNull(targetPath) : input.baseHash

  const stagingId = crypto.randomUUID()
  const draft: Omit<StagingRecord, "recordHash"> = {
    version: STAGING_RECORD_VERSION,
    stagingId,
    kind: input.kind,
    targetPath,
    baseHash,
    nextContent: input.nextContent,
    createdAt: now,
    expiresAt: now + ttlMs,
    usedAt: null,
    meta: input.meta ?? {}
  }

  const recordPath = path.join(stagingDirFor(projectRoot), `${stagingId}.json`)
  try {
    // recordHash の算出は書き込みと同じ try の中で行う。meta が JSON 化できない
    // 場合(循環参照など)はここで落ち、staging_unavailable として返る。
    writeRecord(recordPath, { ...draft, recordHash: computeRecordHash(draft) })
  } catch (err) {
    return {
      ok: false,
      error: "staging_unavailable",
      reasons: [`staging を保存できませんでした(${recordPath}): ${String(err)}`]
    }
  }

  return {
    ok: true,
    stagingId,
    recordPath,
    targetPath,
    baseHash,
    createdAt: draft.createdAt,
    expiresAt: draft.expiresAt
  }
}

/** staging を消費せずに読む(diff の再提示や状態の照会に使う)。 */
export function readStaging(
  projectRoot: string,
  stagingId: string
): ReadStagingResult {
  const record = loadRecord(projectRoot, stagingId)
  if (record === null) {
    return {
      ok: false,
      error: "unknown_id",
      reason: `staging ${stagingId} が見つかりません。stage からやり直してください。`
    }
  }
  // 改竄されたレコードを diff として再提示させない。判定は commit と同じ。
  if (!verifyRecordHash(record)) {
    return {
      ok: false,
      error: "tampered",
      reason: tamperedReason(record.stagingId)
    }
  }
  return { ok: true, record }
}

/**
 * staging を消費して書き込む。契約 §11 の保証 1〜3 の照合点。
 *
 * 判定の順序は unknown_id → tampered → already_used → expired → file_changed。
 *
 * **消費済みの印は書き込みの前に付ける。** 印の保存に失敗したら書き込みへ進まず
 * `staging_unavailable` を返す。以前は書き込みの後に印を付け、失敗しても警告付きで
 * 成功を返していたが、これは契約 §11 の保証 2(単回使用)を破る。印が付かないまま
 * 落ちた staging は未使用のまま残り、**変更前後が同一の stage(no-op)では対象ファイルの
 * ハッシュも変わらない**ため、`file_changed` の歯止めが効かず何度でも commit できてしまう。
 *
 * 代償として「書き込みに失敗したのに staging は消費済み」という状態が生まれる
 * (`write_failed` を返した後の再 commit は `already_used` になる)。これを選ぶ理由は、
 * 失うものが可用性(stage をやり直す手間)だけであり、逆の順序が失うもの
 * ——単回使用という契約上の保証——より軽いためである。この層はフェイルクローズドする。
 * 消費の印を書き戻す巻き戻しは行わない。巻き戻し自体が同じ理由で失敗しうるうえ、
 * 「印が付いていない staging が存在しうる」状態を残すと保証が条件付きに戻る。
 *
 * ロック(契約 §11「採番と挿入の原子性」)はこの関数の外側で取る。
 */
export function commitStaging(input: CommitStagingInput): CommitStagingResult {
  const projectRoot = path.resolve(input.projectRoot)
  const now = input.now ?? Date.now()

  const record = loadRecord(projectRoot, input.stagingId)
  if (record === null) {
    return {
      ok: false,
      error: "unknown_id",
      reason: `staging ${input.stagingId} が見つかりません。stage からやり直してください。`
    }
  }

  // usedAt / expiresAt / targetPath / nextContent のどれを書き換えても、
  // 後続の判定に入る前にここで落ちる。順序を先頭に置くのはそのためである。
  if (!verifyRecordHash(record)) {
    return {
      ok: false,
      error: "tampered",
      reason: tamperedReason(record.stagingId)
    }
  }

  if (record.usedAt !== null) {
    return {
      ok: false,
      error: "already_used",
      reason: `staging ${record.stagingId} は既に使用済みです(${new Date(record.usedAt).toISOString()})。stage からやり直してください。`
    }
  }

  if (now >= record.expiresAt) {
    return {
      ok: false,
      error: "expired",
      reason: `staging ${record.stagingId} は有効期限(${new Date(record.expiresAt).toISOString()})を過ぎています。stage からやり直してください。`
    }
  }

  // 共有の一時ディレクトリに置いたレコードが差し替えられていても、
  // プロジェクト外への書き込みには使わせない。
  if (!isInside(projectRoot, record.targetPath)) {
    return {
      ok: false,
      error: "unknown_id",
      reason: `staging ${record.stagingId} の書き込み先がプロジェクトルートの外を指しています。stage からやり直してください。`
    }
  }

  const currentHash = hashFileOrNull(record.targetPath)
  if (currentHash !== record.baseHash) {
    const before = record.baseHash === null ? "未作成" : record.baseHash
    const after = currentHash === null ? "未作成" : currentHash
    return {
      ok: false,
      error: "file_changed",
      reason: `${record.targetPath} が stage 後に変化しています(${before} → ${after})。stage からやり直してください。`
    }
  }

  // ここから先は staging を消費する。印を付けられない限り 1 バイトも書かない。
  const recordPath = stagingRecordPath(projectRoot, record.stagingId)
  if (recordPath === null) {
    return {
      ok: false,
      error: "unknown_id",
      reason: `staging ${record.stagingId} が見つかりません。stage からやり直してください。`
    }
  }
  try {
    // 消費の印を付けたレコードも recordHash を打ち直す。打ち直さないと、
    // 正当な CLI が書いたレコードを次回の読み取りが tampered と誤判定する。
    const used: Omit<StagingRecord, "recordHash"> = { ...record, usedAt: now }
    writeRecord(recordPath, { ...used, recordHash: computeRecordHash(used) })
  } catch (err) {
    return {
      ok: false,
      error: "staging_unavailable",
      reason: `staging ${record.stagingId} を使用済みにできませんでした(${recordPath}): ${String(err)}。単回使用を保証できないため書き込みません。${record.targetPath} は変更していません。`
    }
  }

  const buf = Buffer.from(record.nextContent, "utf8")
  try {
    fs.mkdirSync(path.dirname(record.targetPath), { recursive: true })
    fs.writeFileSync(record.targetPath, buf)
  } catch (err) {
    return {
      ok: false,
      error: "write_failed",
      reason: `${record.targetPath} へ書き込めませんでした: ${String(err)}。この staging は消費済みになったため、stage からやり直してください。`
    }
  }

  return {
    ok: true,
    stagingId: record.stagingId,
    kind: record.kind,
    path: record.targetPath,
    bytesWritten: buf.byteLength,
    meta: record.meta,
    warnings: []
  }
}
