#!/usr/bin/env node
import path from "node:path";
import { readStdin, emit } from "./lib.mjs";
import { findActiveRun } from "../../scripts/codiel-state.mjs";

const DOC_PHASES = new Set(["init", "design", "test-spec", "dev-plan"]);
const CODE_PHASES = new Set(["implement", "test-loop", "fix-loop"]);

try {
  const input = await readStdin();
  const filePath = input.tool_input?.file_path;
  if (!filePath) emit("allow", "");
  const rel = path.relative(input.cwd, path.resolve(input.cwd, filePath)).replaceAll("\\", "/");

  if (/^\.codiel\/runs\/.+\/state\.json$/.test(rel))
    emit("deny", "state.json は codiel-state スクリプト経由でのみ変更できます(フェーズ飛ばし・ゲート偽装の防止)");

  const run = findActiveRun(input.cwd);
  if (!run || run.state.status !== "active") emit("allow", "");

  const phase = run.state.phase;
  if (DOC_PHASES.has(phase)) {
    if (rel.startsWith(".codiel/") || rel.startsWith("docs/")) emit("allow", "");
    emit("ask", `文書フェーズ(${phase})中にコード領域 ${rel} へ書き込もうとしています`);
  }
  if (CODE_PHASES.has(phase)) {
    if (/^\.codiel\/specs\/[^/]+\/(spec|cases)\.md$/.test(rel))
      emit("ask", `テスト仕様・期待値(${rel})の変更は test-designer の担当です(${phase} 中の変更は改竄の疑い)`);
    emit("allow", "");
  }
  // pr / review / triage / finalize
  if (rel.startsWith(".codiel/")) emit("allow", "");
  emit("ask", `フェーズ ${phase} 中の ${rel} への書き込みは想定外です`);
} catch (e) {
  emit("ask", `guard-write の内部エラー(フェイルクローズド): ${e.message}`);
}
