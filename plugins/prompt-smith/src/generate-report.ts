/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * This file is a TypeScript port of scripts/generate_report.py from the
 * skill-creator Claude Code plugin. Changes: Google Fonts links are replaced
 * with a system font stack so reports render without network access.
 */

import type {
  EvalResultItem,
  IterationRecord,
  LoopResult
} from "./lib/types.js"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function aggregateRuns(results: EvalResultItem[]): [number, number] {
  return results.reduce(
    ([correct, total], result) => [
      correct +
        (result.should_trigger
          ? result.triggers
          : result.runs - result.triggers),
      total + result.runs
    ],
    [0, 0]
  )
}

function scoreClass(correct: number, total: number): string {
  if (total > 0) {
    const ratio = correct / total
    if (ratio >= 0.8) return "score-good"
    if (ratio >= 0.5) return "score-ok"
  }
  return "score-bad"
}

function queryHeaders(
  queries: EvalResultItem[],
  test: boolean = false
): string[] {
  return queries.map((result) => {
    const polarity = result.should_trigger ? "positive-col" : "negative-col"
    const testClass = test ? "test-col " : ""
    return `                <th class="${testClass}${polarity}">${escapeHtml(result.query)}</th>\n`
  })
}

function resultCells(
  queries: EvalResultItem[],
  results: EvalResultItem[],
  test: boolean = false
): string[] {
  const byQuery = new Map(results.map((result) => [result.query, result]))
  return queries.map((query) => {
    const result = byQuery.get(query.query)
    const didPass = result?.pass ?? false
    const triggers = result?.triggers ?? 0
    const runs = result?.runs ?? 0
    const icon = didPass ? "✓" : "✗"
    const passClass = didPass ? "pass" : "fail"
    const testClass = test ? " test-result" : ""
    return `                <td class="result${testClass} ${passClass}">${icon}<span class="rate">${triggers}/${runs}</span></td>\n`
  })
}

function reportRow(
  record: IterationRecord,
  trainQueries: EvalResultItem[],
  testQueries: EvalResultItem[],
  bestIteration: number | undefined
): string {
  const [trainCorrect, trainRuns] = aggregateRuns(record.train_results)
  const testResults = record.test_results ?? []
  const [testCorrect, testRuns] = aggregateRuns(testResults)
  const rowClass = record.iteration === bestIteration ? "best-row" : ""

  return [
    `            <tr class="${rowClass}">\n`,
    `                <td>${record.iteration}</td>\n`,
    `                <td><span class="score ${scoreClass(trainCorrect, trainRuns)}">${trainCorrect}/${trainRuns}</span></td>\n`,
    `                <td><span class="score ${scoreClass(testCorrect, testRuns)}">${testCorrect}/${testRuns}</span></td>\n`,
    `                <td class="description">${escapeHtml(record.description)}</td>\n`,
    ...resultCells(trainQueries, record.train_results),
    ...resultCells(testQueries, testResults, true),
    "            </tr>\n"
  ].join("")
}

export function generateHtml(
  output: LoopResult,
  autoRefresh: boolean,
  skillName: string
): string {
  const history = output.history
  const firstRecord = history[0]
  const trainQueries = firstRecord?.train_results ?? firstRecord?.results ?? []
  const testQueries = firstRecord?.test_results ?? []
  const bestIteration = history.length
    ? testQueries.length
      ? history.reduce((best, record) =>
          (record.test_passed ?? 0) > (best.test_passed ?? 0) ? record : best
        ).iteration
      : history.reduce((best, record) =>
          record.train_passed > best.train_passed ? record : best
        ).iteration
    : undefined
  const titlePrefix = skillName ? `${escapeHtml(skillName)} — ` : ""
  const score = autoRefresh ? "in progress" : output.best_score
  const scoreSet = output.best_test_score ? "test" : "train"
  const refreshTag = autoRefresh
    ? '    <meta http-equiv="refresh" content="5">\n'
    : ""

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
${refreshTag}    <title>${titlePrefix}Skill Description Optimization</title>
    <style>
        body {
            font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
            max-width: 100%;
            margin: 0 auto;
            padding: 20px;
            background: #faf9f5;
            color: #141413;
        }
        h1, th, .legend { font-family: ui-sans-serif, system-ui, sans-serif; color: #141413; }
        .explainer, .summary { background: white; padding: 15px; border-radius: 6px; margin-bottom: 20px; border: 1px solid #e8e6dc; }
        .explainer { color: #6b6a64; font-size: 0.875rem; line-height: 1.6; }
        .summary p { margin: 5px 0; }
        .best { color: #788c5d; font-weight: bold; }
        .table-container { overflow-x: auto; width: 100%; }
        table { border-collapse: collapse; background: white; border: 1px solid #e8e6dc; border-radius: 6px; font-size: 12px; min-width: 100%; }
        th, td { padding: 8px; text-align: left; border: 1px solid #e8e6dc; white-space: normal; overflow-wrap: break-word; }
        th { background: #141413; color: #faf9f5; font-weight: 500; }
        th.test-col { background: #6a9bcc; }
        th.query-col { min-width: 200px; }
        td.description { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; max-width: 400px; }
        td.result { text-align: center; font-size: 16px; min-width: 40px; }
        td.test-result { background: #f0f6fc; }
        .pass { color: #788c5d; }
        .fail { color: #c44; }
        .rate { font-size: 9px; color: #6b6a64; display: block; }
        tr:hover { background: #faf9f5; }
        .score { display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px; }
        .score-good { background: #eef2e8; color: #788c5d; }
        .score-ok { background: #fef3c7; color: #d97706; }
        .score-bad { background: #fceaea; color: #c44; }
        .best-row { background: #f5f8f2; }
        th.positive-col { border-bottom: 3px solid #788c5d; }
        th.negative-col { border-bottom: 3px solid #c44; }
        .legend { display: flex; gap: 20px; margin-bottom: 10px; font-size: 13px; align-items: center; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-swatch { width: 16px; height: 16px; border-radius: 3px; display: inline-block; }
        .swatch-positive { background: #141413; border-bottom: 3px solid #788c5d; }
        .swatch-negative { background: #141413; border-bottom: 3px solid #c44; }
        .swatch-test { background: #6a9bcc; }
        .swatch-train { background: #141413; }
    </style>
</head>
<body>
    <h1>${titlePrefix}Skill Description Optimization</h1>
    <div class="explainer">
        <strong>Optimizing your skill's description.</strong> This page updates automatically as Claude tests different versions of your skill's description. Each row is an iteration — a new description attempt. The columns show test queries: green checkmarks mean the skill triggered correctly (or correctly didn't trigger), red crosses mean it got it wrong. The "Train" score shows performance on queries used to improve the description; the "Test" score shows performance on held-out queries the optimizer hasn't seen. When it's done, Claude will apply the best-performing description to your skill.
    </div>
    <div class="summary">
        <p><strong>Original:</strong> ${escapeHtml(output.original_description)}</p>
        <p class="best"><strong>${autoRefresh ? "Current best" : "Best"}:</strong> ${escapeHtml(output.best_description)}</p>
        <p><strong>Best Score:</strong> ${score}${autoRefresh ? "" : ` (${scoreSet})`}</p>
        <p><strong>Best Train Score:</strong> ${autoRefresh ? "in progress" : output.best_train_score}</p>
        ${output.best_test_score ? `<p><strong>Best Test Score:</strong> ${autoRefresh ? "in progress" : output.best_test_score}</p>` : ""}
        <p><strong>Iterations:</strong> ${output.iterations_run} | <strong>Train:</strong> ${output.train_size} | <strong>Test:</strong> ${output.test_size}</p>
    </div>
    <div class="legend">
        <span style="font-weight:600">Query columns:</span>
        <span class="legend-item"><span class="legend-swatch swatch-positive"></span> Should trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-negative"></span> Should NOT trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-train"></span> Train</span>
        <span class="legend-item"><span class="legend-swatch swatch-test"></span> Test</span>
    </div>
    <div class="table-container">
    <table>
        <thead>
            <tr>
                <th>Iter</th>
                <th>Train</th>
                <th>Test</th>
                <th class="query-col">Description</th>
${queryHeaders(trainQueries).join("")}${queryHeaders(testQueries, true).join("")}            </tr>
        </thead>
        <tbody>
${history
  .map((record) => reportRow(record, trainQueries, testQueries, bestIteration))
  .join("")}        </tbody>
    </table>
    </div>
</body>
</html>
`
}
