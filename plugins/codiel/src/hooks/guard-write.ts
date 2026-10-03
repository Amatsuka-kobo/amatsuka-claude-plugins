#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import {
  findActiveRun,
  type RunState,
  readCodielConfig,
  type StepState
} from "../codiel-state.js"
import { resolveRaguelStore } from "../raguel-records.js"
import {
  emit,
  findDocRoot,
  findMainRoot,
  findRepoRoot,
  globToRegExp,
  pass,
  readDomainsResult,
  readStdin
} from "./lib.js"

const DOC_PHASES = new Set<string | null>([
  "intent",
  "discuss",
  "design",
  "test-spec",
  "dev-plan",
  "intent-sync"
])
const CODE_PHASES = new Set<string | null>([
  "test-code",
  "implement",
  "test-loop",
  "fix-loop"
])
// テストの保護を当てるフェーズ(設計書 §6.13.6)。test-code はテストを書くフェーズなので当てない。
const TEST_GUARD_PHASES = new Set<string | null>([
  "implement",
  "test-loop",
  "fix-loop"
])

// codiel の worktree(`.codiel/worktrees/<slug>/<名前>`。設計書 §6.6.3)の中のパス。
// 1 つ目のグループは worktree のルートの相対パス、2 つ目はその worktree の中の相対パスである。
const WORKTREE_REL_RE = /^(\.codiel\/worktrees\/[^/]+\/[^/]+)(?:\/(.*))?$/

// §6.8 の docs/intents/** の規則。直下(domains/ を含まない)の *.md と、
// domains/ 配下とで通すフェーズが異なるため、2 本の正規表現に分ける。
// 大文字小文字を区別しない FS(macOS・Windows の既定)で、`docs/Intents/domains/` のような
// 綴りで同じディレクトリへ書いて制限をすり抜けないよう、i フラグを付ける。
const INTENT_DOC_RE = /^docs\/intents\/[^/]+\.md$/i
const INTENT_DOC_PHASES = new Set<string | null>([
  null,
  "intent",
  "intent-sync",
  "triage"
])
const INTENT_DOMAIN_RE = /^docs\/intents\/domains\/.+/i

// 契約 §1 の検証 4 項目は `readDomains` 側で行う(2 実装で同じ判定にするため)。
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

// 実体パスへ解決する。**書き込み先とその親はまだ存在しないことがある**(新規作成)ため、
// 実在する最も近い祖先を実体パスにして、残りの区間を付け直す。例外は投げない。
// metatron の `src/guard-docs.ts` の `realpathOrParent` は親 1 つだけを解決する。ここは
// 祖先まで辿る。持続層の初回の書き込み(`docs/intents/domains/` がまだ無い)でも、
// 実体パスで返る repoRoot と座標系をそろえるためである。親が在るときの結果は同じになる。
// 2 プラグイン(metatron と codiel)は互いのインストールパスを解決できないため、import しない。
function realpathOrAncestor(abs: string): string {
  let dir = abs
  let rest = ""
  while (true) {
    try {
      return path.join(fs.realpathSync(dir), rest)
    } catch {
      const parent = path.dirname(dir)
      if (parent === dir) return abs
      rest = path.join(path.basename(dir), rest)
      dir = parent
    }
  }
}

// 契約 §1「警告は経路を問わず返す」。ただし **PreToolUse hook は警告を返す口を持たない**。
// 出せるのは deny / ask / 無出力の 3 つだけで、「素通しするが警告はある」を表現できない。
// そこで ask を返すときだけ理由へ添える。境界判定が誤っているかもしれない文脈でこそ
// 警告が要るので、届け先としては理に適っている。素通し時は届かない(契約 §1 に明記した
// 限界)。届く経路は CLI・skills の検証コマンド・この ask の理由である。
// 警告が無いときに定型文を足さないのは、理由を読む人間のノイズを増やさないため。
function withDomainWarnings(reason: string, warnings: string[]): string {
  if (warnings.length === 0) return reason
  return `${reason}\n[ドメインマップの警告] ${warnings.join(" / ")}`
}

function toPosix(p: string): string {
  return p.replaceAll("\\", "/")
}

// repoRoot 相対のパスを比べられるように、`./` と末尾の `/` を落とす。
// codiel-state の step-update が worktree の一意性を検査するときと同じ正規化である。
function normalizeRel(p: string): string {
  return path.posix.normalize(toPosix(p)).replace(/\/+$/, "")
}

// testsDir・runsDir の配下か。値が `.` ならリポジトリ全体を指す。
function underDir(repoRel: string, dir: string): boolean {
  return dir === "." || repoRel.startsWith(`${dir}/`)
}

// E2E のレポート `<testsDir>/**/reports/**` か(設計書 §6.17.3・§6.17.6)。
export function isE2eReport(repoRel: string, testsDir: string): boolean {
  if (!underDir(repoRel, testsDir)) return false
  const rest = testsDir === "." ? repoRel : repoRel.slice(testsDir.length + 1)
  return /(^|\/)reports\//.test(rest)
}

// spec.md の frontmatter(先頭の `---` で囲む部分)の tests の値を返す(設計書 §6.13.5)。
// 値はブロックの列(`- <パス>`)か、1 行の列(`[a, b]`)で書かれる。
function frontmatterTests(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return []
  const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2")
  const tests: string[] = []
  let inTests = false
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break
    const item = /^\s*-\s+(.+)$/.exec(line)
    if (inTests && (item || line.trim() === "")) {
      if (item) tests.push(unquote(item[1]))
      continue
    }
    const key = /^tests:\s*(.*)$/.exec(line)
    inTests = key !== null
    const flow = key && /^\[(.*)\]$/.exec(key[1].trim())
    if (flow) tests.push(...flow[1].split(",").map(unquote).filter(Boolean))
  }
  return tests
}

// メインの作業ツリーの `<testsDir>/**/spec.md` の tests に載ったパス(repoRoot 相対)を集める
// (設計書 §6.13.6)。worktree の中の spec.md は読まない。記録は run ブランチの HEAD と同じである。
// シンボリックリンクのディレクトリは辿らない(循環を避ける)。
function recordedTests(testsRoot: string): Set<string> {
  const found = new Set<string>()
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === "spec.md")
        for (const t of frontmatterTests(fs.readFileSync(p, "utf8")))
          found.add(normalizeRel(t))
    }
  }
  walk(testsRoot)
  return found
}

// worktree の記録が wtRel と一致する要素を 3 つの表から引く(設計書 §6.8 の (c))。
// worktree の名前から ID を読み取らない。
function worktreeElements(
  st: RunState,
  wtRel: string
): { label: string; step: StepState }[] {
  const tables: [string, Record<string, StepState> | undefined][] = [
    ["implement.steps", st.implement?.steps],
    ["testCode.units", st.testCode?.units],
    ["testLoop.units", st.testLoop?.units]
  ]
  const hits: { label: string; step: StepState }[] = []
  for (const [name, table] of tables)
    for (const [id, step] of Object.entries(table ?? {}))
      if (step.worktree && normalizeRel(step.worktree) === wtRel)
        hits.push({ label: `${name}[${id}]`, step })
  return hits
}

// Raguel の設定と記録(Raguel 設計書 §6.13.4、所見 G8・R12)。守るのは次の 3 つである。
// - `.codiel/config.json`。raguel キーだけでなくファイル全体を守る。
//   codiel の worktree の写しも同じ形なので、パスの末尾で判定する。
// - RAGUEL_CONFIG が指すファイル。
// - casesDir の配下。
// 当たればそのパスの表示を返し、当たらなければ null を返す。
// casesDir は raguel-records の置き場の解決で求める。設定が読めないときは casesDir の判定だけを外す。
// そのとき Raguel も評価できず、pass-gate が失敗として扱う。
// シンボリックリンクの別名は、論理パスと実体パスの両方で比べて塞ぐ。
const CODIEL_CONFIG_RE = /[/\\]\.codiel[/\\]config\.json$/i

// p が dir そのものか、その配下か
function isUnder(p: string, dir: string): boolean {
  const rel = path.relative(dir, p)
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  )
}

function raguelTarget(abs: string, mainRoot: string): string | null {
  const absReal = realpathOrAncestor(abs)
  if (CODIEL_CONFIG_RE.test(abs) || CODIEL_CONFIG_RE.test(absReal))
    return ".codiel/config.json"
  const env = process.env.RAGUEL_CONFIG
  if (env) {
    const file = path.resolve(env)
    if (abs === file || absReal === realpathOrAncestor(file))
      return `RAGUEL_CONFIG が指す ${file}`
  }
  let casesDir: string
  try {
    casesDir = resolveRaguelStore(mainRoot).casesDir
  } catch {
    return null
  }
  if (isUnder(abs, casesDir) || isUnder(absReal, realpathOrAncestor(casesDir)))
    return `casesDir ${casesDir} の配下`
  return null
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

  // 基準の異なる 3 つの相対パスを持つ。同じ「rel」で複数を指すと取り違えが起きる。
  //
  // codielRel = codielRoot(`.codiel` を持つ最も近い祖先)基準。判定対象は
  // **ハーネス自身の運用資産の位置**(`.codiel/` 配下か)。
  // repoRel = repoRoot(git ルート)基準。判定対象は **intent 文書とテストの位置**
  // (`state.intent` との一致と `docs/intents/**`、テストの保護と `<testsDir>/`。
  // 設計書 §6.2.1・§6.3.1・§6.8・§6.13.6)。
  // docRel  = docRoot(契約 §3 規則 1)基準。判定対象は **ドメイン境界の glob**。
  //
  // 契約 §3 は docRoot と codielRoot が異なる構成(例: repo/.codiel と
  // repo/sub/metatron.config.json)を正常と定めるため、この 2 つは一致するとは限らない。
  // repoRoot と codielRoot も、git ルートの下のディレクトリでセッションを始めて
  // `.codiel` をそこに作った構成(repo/app/.codiel)では一致しない。
  //
  // **相対パスは前処理も異なる。** 揃える相手が違うためである。
  // codielRel は **論理パス基準**(abs をそのまま使う)。基準の findProjectRoot は
  // 論理パスを `path.dirname` で辿るだけで実体化しないので、こちらだけ実体パス化すると
  // symlink 越しの cwd で相対が `../` に落ち、`.codiel/` 免除が外れる。
  // repoRel と docRel は **実体パス基準**(realpathOrAncestor を通す)。基準の findRepoRoot と
  // findDocRoot は、git の出力と契約 §3 規則 1 の細目に従って実体パスを返す。
  // 「一貫性のため」どれか 1 つに揃えると、揃えた側の基準関数と食い違って壊れる。
  //
  // 書き込み先が worktree の中なら、3 つとも worktree の中へ写した基準で取る(下記)。
  // run は常にメインの作業ツリーで探す(設計書 §6.8 の (a))。cwd が worktree の中でも
  // findMainRoot がメインのルートを返す。
  const mainRoot = findMainRoot(cwd)
  const run = findActiveRun(mainRoot)
  // Raguel の設定と記録(Raguel 設計書 §6.13.4)。awaiting_human の run でも効かせるため、
  // status で通す分岐より前に置く。state.intent・config の読み込み・退避先の判定より前なので、
  // それらの扱いに左右されない。
  if (run) {
    const target = raguelTarget(abs, mainRoot)
    if (target)
      emit(
        "deny",
        `run の間(active・awaiting_human)は Raguel の設定と記録(${target})を書き換えられません。ゲートの偽装を防ぐためです。変更するときは run を止めるか、利用者が自分で変更してください`
      )
  }
  if (run?.state.status !== "active") pass()

  const phase = run.state.phase
  // repoRoot は run の置き場(メインのルート)から解決する。git の子プロセスを起動するので、
  // active run があると分かってから求める。
  const repoRoot = findRepoRoot(mainRoot)
  const mainReal = realpathOrAncestor(mainRoot)
  const absReal = realpathOrAncestor(abs)

  // 書き込み先が worktree の中なら、その worktree のルートを基準に判定する(設計書 §6.8 の (b))。
  // codielRel と repoRel は worktreeRoot 基準の相対パスになる。メインのルート基準のままだと、
  // worktree の中のすべての書き込みが `.codiel/` 配下と判定されて免除される。
  // worktree の位置は実体パスどうしで見る(findMainRoot は cwd のパスの形からルートを得るので、
  // realpathOrAncestor で実体化してから書き込み先の実体パスと比べる)。
  const wt = WORKTREE_REL_RE.exec(toPosix(path.relative(mainReal, absReal)))
  const worktreeRoot = wt ? path.join(mainReal, wt[1]) : null
  const codielRel = wt ? (wt[2] ?? "") : toPosix(path.relative(mainRoot, abs))
  const repoRel = wt ? (wt[2] ?? "") : toPosix(path.relative(repoRoot, absReal))

  // §6.8 の判定順序: まず state.intent のファイルかを見る。当たればすべての
  // フェーズで通す(run 途中の原文追記、review/finalize での派生文の反映)。
  // 比べるのは repoRoot 相対のパスとの完全一致である(§6.8)。
  if (run.state.intent === repoRel) pass()

  // testsDir と runsDir(設計書 §6.13.4)。不正な設定では null にし、それに頼る規則だけを外すか、
  // コード系フェーズでは ask にする(フェイルクローズド)。
  let config: { testsDir: string; runsDir: string } | null = null
  let configError = ""
  try {
    config = readCodielConfig(mainRoot)
  } catch (e) {
    configError = (e as Error).message
  }

  // 次に docs/intents/** の規則を当てる。DOC_PHASES の分岐(直後)は docs/ 全体を
  // 通してしまうため、domains/** への書き込みはそれより先に判定する。
  if (INTENT_DOMAIN_RE.test(repoRel)) {
    if (phase === "intent-sync") pass()
    // finalize の作業中(triage が passed で、finalize がまだ status を awaiting_outcome にしていない間)は、
    // 最後の intent-sync より後に出た ADR 候補と GOTCHAS 候補を持続層へ写す。finalize は start-phase を呼ばないので、
    // この間の phase は triage のままである。
    if (run.state.phases.triage?.status === "passed") pass()
    emit(
      "ask",
      `持続層(${repoRel})への書き込みは intent-sync フェーズの担当です(現在のフェーズ: ${phase})`
    )
  }
  if (INTENT_DOC_RE.test(repoRel)) {
    if (INTENT_DOC_PHASES.has(phase)) pass()
    emit(
      "ask",
      `intent 文書(${repoRel})への書き込みはこのフェーズでは想定していません(現在のフェーズ: ${phase})`
    )
  }

  if (DOC_PHASES.has(phase)) {
    if (codielRel.startsWith(".codiel/") || codielRel.startsWith("docs/"))
      pass()
    // test-spec が testsDir を docs/ の外に置いた仕様を書けるように、<testsDir>/ も通す
    // (設計書 §6.13.6)。runsDir を docs/ の外に置いても run の文書を書けるように、
    // <runsDir>/ も通す(§6.17.6)。設定が不正なときはこの 2 つの規則だけを外す(§6.13.4)。
    if (
      config &&
      (underDir(repoRel, config.testsDir) || underDir(repoRel, config.runsDir))
    )
      pass()
    emit(
      "ask",
      `文書フェーズ(${phase})中にコード領域 ${codielRel} へ書き込もうとしています`
    )
  }
  if (CODE_PHASES.has(phase)) {
    // テストの保護(設計書 §6.13.6)。ドメイン境界より先に判定する。
    // 期待結果(spec.md・cases.md)と記録されたテストは test-spec と test-code が書くもので、
    // コードを直すフェーズで書き換えると、テストを実装に合わせる改竄になりうる。
    // fix-loop だけは、所見がテストに向くときに set-test-edit で保護を外せる。
    if (TEST_GUARD_PHASES.has(phase)) {
      // 保護の対象を決められないので、このフェーズの書き込みをすべて止める(フェイルクローズド)
      if (!config)
        emit(
          "ask",
          `.codiel/config.json が不正なため、${phase} 中の書き込みがテストの保護に当たるか判定できません(${configError})`
        )
      const testsDir = config.testsDir
      const testEdit = phase === "fix-loop" && run.state.testEdit === true
      if (
        !testEdit &&
        ((underDir(repoRel, testsDir) &&
          /(^|\/)(spec|cases)\.md$/.test(repoRel)) ||
          recordedTests(path.join(repoRoot, testsDir)).has(repoRel))
      )
        emit(
          "ask",
          `テスト(${repoRel})の変更は test-spec と test-code フェーズの担当です(${phase} 中の変更は改竄の疑い)`
        )
    }
    // run の文書(設計書 §6.17.6)。書くのは文書フェーズだけなので、コード系フェーズの委譲が
    // <runsDir>/ を書き換えたら、実行モードと domain によらず人に確かめる。ドメイン境界は
    // mapped で domain があるときしか働かないので、境界の免除を外すだけでは足りない。
    // E2E のレポートは runsDir と testsDir が重なる設定でもオーケストレーターが書けるよう、対象外にする。
    // runsDir を決められなければ、test-code を含むコード系フェーズの書き込みをすべて止める。
    if (!config)
      emit(
        "ask",
        `.codiel/config.json が不正なため、${phase} 中の書き込みが run の文書(runsDir)に当たるか判定できません(${configError})`
      )
    if (
      underDir(repoRel, config.runsDir) &&
      !isE2eReport(repoRel, config.testsDir)
    )
      emit(
        "ask",
        `run の文書(${repoRel})は文書フェーズで書きます(${phase} 中の変更は想定外)`
      )
    // ドメイン境界(設計書 §16-5 の配線)。ドメイン別の実装・レビューへ委譲中だけ
    // state.json の domain が入る。値が無ければ(未定義・null)境界を課さない。
    // deny ではなく ask にするのは、境界の誤りは state.json の改竄と違って人間が判断して
    // 通せる余地があり、ドメインマップの記述漏れで正当な書き込みを止めたくないためである。
    // .codiel/ 配下はドメイン境界の対象外。ドメインマップは「どのコードがどの関心事に
    // 属するか」の写像であり、分類の対象はプロジェクトのソースである。.codiel/ 配下は
    // ハーネス自身の運用資産(run の状態・報告・設定)で、どのドメインにも
    // 属さない。ドメインマップがこれを縛るのは責務の取り違えである。DOC_PHASES 分岐と
    // 末尾の catch-all は既に同じ免除を持っており、CODE_PHASES だけが例外になっていた。
    // 免除が無いと、ドメインに紐付かない委譲(テストの実行など)と紐付く委譲(コードの修正)を
    // 往復する際に clear-domain を呼び忘れると、`.codiel/runs/` の報告のような
    // 運用資産への正当な書き込みが黙って ask になる。
    //
    // worktree の中への書き込みでは、state.domain(1 値しか持てない)を使わず、worktree の
    // 記録がこの worktree と一致する要素の domain を使う(設計書 §6.6.6・§6.8 の (c))。
    let domain = run.state.domain
    if (worktreeRoot) {
      const wtRel = normalizeRel(path.relative(repoRoot, worktreeRoot))
      const hits = worktreeElements(run.state, wtRel)
      // worktree のパスは run の中で一意のはず(設計書 §6.6.3)。崩れたときの安全網である。
      if (hits.length >= 2)
        emit(
          "ask",
          `worktree ${wtRel} を記録した要素が ${hits.length} 個あり(${hits.map((h) => h.label).join(", ")})、境界に使うドメインを 1 つに決められません(worktree のパスは run の中で一意のはずです)`
        )
      domain = hits[0]?.step.domain ?? null
    }
    // `.codiel/` 配下かどうかは codielRel で判定する(基準は運用資産の位置)。
    // E2E のレポートもどのドメインにも属さない(設計書 §6.17.6)。オーケストレーターが
    // set-domain の間に md を書いても ask にしない。判定は repoRel で行う。
    if (
      domain &&
      !codielRel.startsWith(".codiel/") &&
      !isE2eReport(repoRel, config.testsDir)
    ) {
      // ドメイン境界の照合は **docRoot 基準の docRel** で行う。ドメインマップは
      // ARCHITECTURE に書かれており、ARCHITECTURE の位置は契約 §3 規則 1 の docRoot で
      // 決まるので、そこに書かれた glob も docRoot 基準の相対パスと解釈するのが唯一
      // 整合する読み方である(metatron の scan も docRoot 相対で同じ glob を解釈する)。
      // codielRel で照合すると、docRoot ≠ codielRoot の構成で同じ glob を 2 つの基準で
      // 解釈することになり、担当範囲内の書き込みが ask に落ち、docRoot 外のパスが
      // 範囲内として通りうる。
      //
      // docRoot とドメインマップはメインの作業ツリーで解決する。cwd が worktree の中なら、
      // メインの作業ツリーの同じ位置に写してから探す。worktree はメインの作業ツリーの中にあるので、
      // worktree の中から祖先を辿るとメインの metatron.config.json に届いてしまう。
      const cwdWt = WORKTREE_REL_RE.exec(
        toPosix(path.relative(mainReal, realpathOrAncestor(cwd)))
      )
      const docStart = cwdWt ? path.join(repoRoot, cwdWt[2] ?? "") : cwd
      const mainDocRoot = findDocRoot(docStart)
      // worktree の中への書き込みでは、docRoot を worktreeRoot + relative(repoRoot, docRoot) に
      // 写す(設計書 §6.8 の (b))。docRoot が repoRoot の子(repo/sub)でも同じ位置関係で写る。
      const docRoot = worktreeRoot
        ? path.join(worktreeRoot, path.relative(repoRoot, mainDocRoot))
        : mainDocRoot
      // findDocRoot が開始ディレクトリを実体パス化する以上、相対を取る相手も
      // 実体パスでなければ座標系が割れる。/tmp/link -> /repo のとき論理パスのまま
      // 相対を取ると docRel が `../tmp/link/src/server/a.ts` になり、
      // **担当範囲内の書き込みが範囲外として ask される**。
      const docRel = toPosix(path.relative(docRoot, absReal))
      // 契約 §1「警告は経路を問わず返す」。警告を捨てる readDomains を使わない。
      const { domains: rawDomains, warnings } = readDomainsResult(docStart)
      const domains = toDomainMap(rawDomains)
      // ドメイン定義が無い・読めない環境で新たに書き込みを止めるのは配線の目的ではない。
      if (domains) {
        const globs: string[] | undefined = domains[domain]
        // 境界を判定する材料が無いまま通すと配線した意味が消えるので ask で止める。
        if (!globs)
          emit(
            "ask",
            withDomainWarnings(
              `ドメイン ${domain} が ARCHITECTURE のドメインマップに無いため、${docRel} への書き込みが担当範囲内か判定できません(ドメイン名の誤り、またはドメインマップの記述漏れ)`,
              warnings
            )
          )
        if (!globs.some((g) => globToRegExp(g).test(docRel)))
          emit(
            "ask",
            withDomainWarnings(
              `${docRel} はドメイン ${domain} の担当範囲外です(${domain} の範囲: ${globs.join(", ")})`,
              warnings
            )
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
