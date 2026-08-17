#!/usr/bin/env node
import path from "node:path"
import { findActiveRun } from "../codiel-state.js"
import {
  emit,
  findDocRoot,
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

// 契約 §1 の検証 4 項目は `readDomains` 側で行う(3 実装で同じ判定にするため)。
// ここが担うのは**プロトタイプなしのマップへの詰め替え**だけである。`toString` のような
// ドメイン名を引いたときに継承プロパティが返る(= 存在しないのに存在するとみなす)のと、
// `__proto__` キーの代入がプロトタイプ差し替えになるのを防ぐ。例外は投げない。
function toDomainMap(
  value: Record<string, string[]> | null
): Record<string, string[]> | null {
  if (value === null) return null
  const map: Record<string, string[]> = Object.create(null)
  for (const [name, globs] of Object.entries(value)) map[name] = globs
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

  // 基準の異なる 2 つの相対パスを持つ。同じ「rel」で両方を指すと取り違えが起きる。
  //
  // codielRel = codielRoot(`.codiel` を持つ最も近い祖先)基準。判定対象は
  // **ハーネス自身の運用資産の位置**(`.codiel/` 配下か、specs の spec/cases か)。
  // docRel  = docRoot(契約 §3 規則 1)基準。判定対象は **ドメイン境界の glob**。
  //
  // 契約 §3 は docRoot と codielRoot が異なる構成(例: repo/.codiel と
  // repo/sub/metatron.config.json)を正常と定めるため、この 2 つは一致するとは限らない。
  const codielRoot = findProjectRoot(cwd)
  const codielRel = path.relative(codielRoot, abs).replaceAll("\\", "/")

  const run = findActiveRun(codielRoot)
  if (run?.state.status !== "active") pass()

  const phase = run.state.phase
  if (DOC_PHASES.has(phase)) {
    if (codielRel.startsWith(".codiel/") || codielRel.startsWith("docs/"))
      pass()
    emit(
      "ask",
      `文書フェーズ(${phase})中にコード領域 ${codielRel} へ書き込もうとしています`
    )
  }
  if (CODE_PHASES.has(phase)) {
    if (/^\.codiel\/specs\/.+\/(spec|cases)\.md$/.test(codielRel))
      emit(
        "ask",
        `テスト仕様・期待値(${codielRel})の変更は test-designer の担当です(${phase} 中の変更は改竄の疑い)`
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
    // `.codiel/` 配下かどうかは codielRel で判定する(基準は運用資産の位置)。
    if (domain && !codielRel.startsWith(".codiel/")) {
      // ドメイン境界の照合は **docRoot 基準の docRel** で行う。ドメインマップは
      // ARCHITECTURE に書かれており、ARCHITECTURE の位置は契約 §3 規則 1 の docRoot で
      // 決まるので、そこに書かれた glob も docRoot 基準の相対パスと解釈するのが唯一
      // 整合する読み方である(metatron の scan も docRoot 相対で同じ glob を解釈する)。
      // codielRel で照合すると、docRoot ≠ codielRoot の構成で同じ glob を 2 つの基準で
      // 解釈することになり、担当範囲内の書き込みが ask に落ち、docRoot 外のパスが
      // 範囲内として通りうる。
      const docRoot = findDocRoot(cwd)
      const docRel = path.relative(docRoot, abs).replaceAll("\\", "/")
      const domains = toDomainMap(readDomains(cwd))
      // ドメイン定義が無い・読めない環境で新たに書き込みを止めるのは配線の目的ではない。
      if (domains) {
        const globs: string[] | undefined = domains[domain]
        // 境界を判定する材料が無いまま通すと配線した意味が消えるので ask で止める。
        if (!globs)
          emit(
            "ask",
            `ドメイン ${domain} が ARCHITECTURE のドメインマップに無いため、${docRel} への書き込みが担当範囲内か判定できません(ドメイン名の誤り、またはドメインマップの記述漏れ)`
          )
        if (!globs.some((g) => globToRegExp(g).test(docRel)))
          emit(
            "ask",
            `${docRel} はドメイン ${domain} の担当範囲外です(${domain} の範囲: ${globs.join(", ")})`
          )
      }
    }
    pass()
  }
  // pr / review / triage / finalize
  if (codielRel.startsWith(".codiel/")) pass()
  emit("ask", `フェーズ ${phase} 中の ${codielRel} への書き込みは想定外です`)
} catch (e) {
  emit(
    "ask",
    `guard-write の内部エラー(フェイルクローズド): ${(e as Error).message}`
  )
}
