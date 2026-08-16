#!/usr/bin/env node
import path from "node:path"
import { findActiveRun } from "../codiel-state.js"
import {
  emit,
  findProjectRoot,
  globToRegExp,
  pass,
  readDomains,
  readStdin
} from "./lib.js"

const DOC_PHASES = new Set<string | null>([
  "init",
  "discuss",
  "design",
  "test-spec",
  "dev-plan"
])
const CODE_PHASES = new Set<string | null>([
  "implement",
  "test-loop",
  "fix-loop"
])

// 契約 §1 の検証 4 項目(有効な JSON / トップレベルがオブジェクト / 各値が 1 要素以上の
// 文字列配列 / キーが 1 個以上)。readDomains は JSON として読めた値をそのまま返すため、
// 形の検証はここで行う。1 つでも反すれば「読めない」として扱い、例外を投げない。
function toDomainMap(value: unknown): Record<string, string[]> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return null
  // プロトタイプなしで組む。`toString` のようなドメイン名を引いたときに継承プロパティが
  // 返る(= 存在しないのに存在するとみなす)のと、`__proto__` キーの代入がプロトタイプ
  // 差し替えになるのを防ぐ。
  const map: Record<string, string[]> = Object.create(null)
  for (const [name, globs] of entries) {
    if (!Array.isArray(globs) || globs.length === 0) return null
    if (globs.some((g) => typeof g !== "string")) return null
    map[name] = globs as string[]
  }
  return map
}

try {
  const input = await readStdin()
  const cwd = input.cwd ?? process.cwd()
  const filePath = input.tool_input?.file_path
  if (!filePath) pass()
  const abs = path.resolve(cwd, filePath)

  // cwd がプロジェクトルートのサブディレクトリであっても、絶対パス指定での
  // 書き込みが state.json 保護をすり抜けないよう、絶対パス自体を検査する
  // (cwd 非依存)。ケース非依存 FS でのすり抜けも防ぐため大文字小文字を無視する。
  if (/[/\\]\.codiel[/\\]runs[/\\].+[/\\]state\.json$/i.test(abs))
    emit(
      "deny",
      "state.json は codiel-state スクリプト経由でのみ変更できます(フェーズ飛ばし・ゲート偽装の防止)"
    )

  const root = findProjectRoot(cwd)
  const rel = path.relative(root, abs).replaceAll("\\", "/")

  const run = findActiveRun(root)
  if (run?.state.status !== "active") pass()

  const phase = run.state.phase
  if (DOC_PHASES.has(phase)) {
    if (rel.startsWith(".codiel/") || rel.startsWith("docs/")) pass()
    emit(
      "ask",
      `文書フェーズ(${phase})中にコード領域 ${rel} へ書き込もうとしています`
    )
  }
  if (CODE_PHASES.has(phase)) {
    if (/^\.codiel\/specs\/.+\/(spec|cases)\.md$/.test(rel))
      emit(
        "ask",
        `テスト仕様・期待値(${rel})の変更は test-designer の担当です(${phase} 中の変更は改竄の疑い)`
      )
    // ドメイン境界(設計書 §16-5 の配線)。ドメイン別 implementer / reviewer へ委譲中だけ
    // state.json の domain が入る。値が無ければ(未定義・null)境界を課さない。
    // deny ではなく ask にするのは、境界の誤りは state.json の改竄と違って人間が判断して
    // 通せる余地があり、ドメインマップの記述漏れで正当な書き込みを止めたくないためである。
    // .codiel/ 配下はドメイン境界の対象外。ドメインマップは「どのコードがどの関心事に
    // 属するか」の写像であり、分類の対象はプロジェクトのソースである。.codiel/ 配下は
    // ハーネス自身の運用資産(run の状態・テスト仕様・レポート)で、どのドメインにも
    // 属さない。ドメインマップがこれを縛るのは責務の取り違えである。DOC_PHASES 分岐と
    // 末尾の catch-all は既に同じ免除を持っており、CODE_PHASES だけが例外になっていた。
    // 免除が無いと、test-loop でスクリプト安定化(domain 非紐付け)と TDD 修正(domain
    // 紐付け)を往復する際に clear-domain を呼び忘れると、tester の
    // .codiel/specs/**/scripts/ への正当な書き込みが黙って ask になる。
    const domain = run.state.domain
    if (domain && !rel.startsWith(".codiel/")) {
      // 判定対象は rel(プロジェクトルート基準の相対パス)。ドメインマップの解決は
      // 文書ルート基準なので readDomains に開始ディレクトリを渡して内側で解決させる。
      const domains = toDomainMap(readDomains(cwd))
      // ドメイン定義が無い・読めない環境で新たに書き込みを止めるのは配線の目的ではない。
      if (domains) {
        const globs: string[] | undefined = domains[domain]
        // 境界を判定する材料が無いまま通すと配線した意味が消えるので ask で止める。
        if (!globs)
          emit(
            "ask",
            `ドメイン ${domain} が ARCHITECTURE のドメインマップに無いため、${rel} への書き込みが担当範囲内か判定できません(ドメイン名の誤り、またはドメインマップの記述漏れ)`
          )
        if (!globs.some((g) => globToRegExp(g).test(rel)))
          emit(
            "ask",
            `${rel} はドメイン ${domain} の担当範囲外です(${domain} の範囲: ${globs.join(", ")})`
          )
      }
    }
    pass()
  }
  // pr / review / triage / finalize
  if (rel.startsWith(".codiel/")) pass()
  emit("ask", `フェーズ ${phase} 中の ${rel} への書き込みは想定外です`)
} catch (e) {
  emit(
    "ask",
    `guard-write の内部エラー(フェイルクローズド): ${(e as Error).message}`
  )
}
