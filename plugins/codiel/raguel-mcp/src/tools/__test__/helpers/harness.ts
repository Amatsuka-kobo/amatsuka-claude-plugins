/**
 * パイプラインとツールのテストの共通の足場。一時の git リポジトリをプロジェクトルートにし、
 * `.codiel/config.json` を実際の読み込み(createRuntimeSource)で読む。パネルは FakeJudgeProvider で与える。
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { CaseStore } from "../../../casefile/store.js"
import type { JevCall } from "../../../context/jev.js"
import {
  type EvaluationRequest,
  evaluate,
  type PipelineDeps,
  type Providers
} from "../../../core/pipeline.js"
import type {
  ArtifactKind,
  EvaluationIndexEntry,
  EvaluationResult,
  OutcomeRecord
} from "../../../core/types.js"
import { FakeJudgeProvider } from "../../../panel/__test__/helpers/fakeProvider.js"
import {
  commitAll,
  git,
  makeRepo,
  makeTmpDir,
  writeFile
} from "../../../subject/__test__/helpers/gitRepo.js"
import { createRuntimeSource } from "../../shared.js"

export const BUILD_VERSION = "9.9.9-test"

/** ルーブリックの軸(panel/rubrics.ts と同じ) */
export const AXES: Record<ArtifactKind, string[]> = {
  decision: [
    "objective_alignment",
    "risk_awareness",
    "reversibility",
    "alternatives_considered"
  ],
  plan: [
    "objective_alignment",
    "scope_fit",
    "procedure_completeness",
    "risk_controlled"
  ],
  design: ["requirement_coverage", "appropriate_complexity", "consistency"],
  code: ["objective_alignment", "no_unintended_changes", "no_breaking_changes"]
}

export function scores(kind: ArtifactKind, value = 90): Record<string, number> {
  return Object.fromEntries(AXES[kind].map((k) => [k, value]))
}

/** 全パネリストと meta が「問題なし」を返す応答を登録する */
export function benignPanel(provider: FakeJudgeProvider, kind: ArtifactKind) {
  provider.set("adversarial", { findings: [], scores: scores(kind) })
  provider.set("crosscheck", { findings: [], scores: scores(kind) })
  provider.set("steelman", {
    verdicts: [],
    defenseArgument: "問題は見当たらない",
    findings: [],
    scores: scores(kind)
  })
  provider.set("meta", {
    scores: { ...scores(kind), blast_radius_contained: 90 },
    rationale: "証拠を確かめたが問題は無い"
  })
}

export interface HarnessOptions {
  /** `.codiel/config.json` の raguel に重ねる値(トップレベルのキー単位) */
  raguel?: Record<string, unknown>
  /** `.codiel/config.json` の testsDir */
  testsDir?: string
  /** 最初のコミットに入れるファイル */
  files?: Record<string, string>
  providers?: (fake: FakeJudgeProvider) => Providers
  jevCall?: JevCall
  jevApiKey?: string
}

export interface Harness {
  repo: string
  casesDir: string
  provider: FakeJudgeProvider
  deps: PipelineDeps
  /** 最初のコミット */
  base: string
  store(): CaseStore
  evaluate(
    req: EvaluationRequest,
    signal?: AbortSignal
  ): Promise<EvaluationResult>
  /** ファイルを書いてコミットし、HEAD を返す */
  commit(files: Record<string, string>): string
  /** `.codiel/config.json` を書き換える(コミットはしない) */
  writeConfig(value: unknown): void
  index(): EvaluationIndexEntry[]
  outcomes(): OutcomeRecord[]
  cleanup(): void
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T)
}

export function makeHarness(opts: HarnessOptions = {}): Harness {
  const casesDir = makeTmpDir("raguel-cases-")
  const raguel = {
    ...opts.raguel,
    storage: {
      casesDir,
      ...(opts.raguel?.storage as Record<string, unknown> | undefined)
    },
    judge: {
      provider: "claude",
      ...(opts.raguel?.judge as Record<string, unknown> | undefined)
    }
  }
  const configJson = JSON.stringify(
    {
      raguel,
      ...(opts.testsDir !== undefined ? { testsDir: opts.testsDir } : {})
    },
    null,
    2
  )
  const repo = makeRepo({
    ".codiel/config.json": configJson,
    "README.md": "# テスト用のリポジトリ\n",
    ...opts.files
  })
  const provider = new FakeJudgeProvider("claude")
  const makeProviders = () =>
    opts.providers ? opts.providers(provider) : { claude: provider }
  const deps: PipelineDeps = {
    runtime: createRuntimeSource(makeProviders, repo),
    projectRoot: repo,
    buildVersion: BUILD_VERSION,
    ...(opts.jevCall ? { jevCall: opts.jevCall } : {}),
    ...(opts.jevApiKey !== undefined ? { jevApiKey: opts.jevApiKey } : {})
  }
  const base = git(repo, "rev-parse", "HEAD")
  const store = () => {
    const rt = deps.runtime()
    if (!rt.ok) throw new Error(rt.error)
    return new CaseStore(rt.runtime.loaded.config, repo)
  }
  return {
    repo,
    casesDir,
    provider,
    deps,
    base,
    store,
    evaluate: (req, signal = new AbortController().signal) =>
      evaluate(req, deps, { signal }),
    commit(files) {
      for (const [rel, content] of Object.entries(files)) {
        writeFile(repo, rel, content)
      }
      return commitAll(repo, "change")
    },
    writeConfig(value) {
      fs.writeFileSync(
        path.join(repo, ".codiel", "config.json"),
        JSON.stringify(value, null, 2)
      )
    },
    index: () =>
      readJsonl<EvaluationIndexEntry>(
        path.join(store().projectDir, "evaluations.jsonl")
      ),
    outcomes: () =>
      readJsonl<OutcomeRecord>(path.join(store().projectDir, "outcomes.jsonl")),
    cleanup() {
      fs.rmSync(repo, { recursive: true, force: true })
      fs.rmSync(casesDir, { recursive: true, force: true })
    }
  }
}

/** make(i) の行を count 行つないだファイルの本文を作る */
export function lines(count: number, make: (i: number) => string): string {
  return `${Array.from({ length: count }, (_, i) => make(i)).join("\n")}\n`
}
