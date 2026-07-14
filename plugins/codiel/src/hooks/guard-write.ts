#!/usr/bin/env node
import path from "node:path";
import { readStdin, emit, pass, findProjectRoot } from "./lib.js";
import { findActiveRun } from "../codiel-state.js";

const DOC_PHASES = new Set<string | null>(["init", "discuss", "design", "test-spec", "dev-plan"]);
const CODE_PHASES = new Set<string | null>(["implement", "test-loop", "fix-loop"]);

try {
  const input = await readStdin();
  const filePath = input.tool_input?.file_path;
  if (!filePath) pass();
  const abs = path.resolve(input.cwd ?? process.cwd(), filePath);

  // cwd がプロジェクトルートのサブディレクトリであっても、絶対パス指定での
  // 書き込みが state.json 保護をすり抜けないよう、絶対パス自体を検査する
  // (cwd 非依存)。ケース非依存 FS でのすり抜けも防ぐため大文字小文字を無視する。
  if (/[\/\\]\.codiel[\/\\]runs[\/\\].+[\/\\]state\.json$/i.test(abs))
    emit("deny", "state.json は codiel-state スクリプト経由でのみ変更できます(フェーズ飛ばし・ゲート偽装の防止)");

  const root = findProjectRoot(input.cwd ?? process.cwd());
  const rel = path.relative(root, abs).replaceAll("\\", "/");

  const run = findActiveRun(root);
  if (!run || run.state.status !== "active") pass();

  const phase = run.state.phase;
  if (DOC_PHASES.has(phase)) {
    if (rel.startsWith(".codiel/") || rel.startsWith("docs/")) pass();
    emit("ask", `文書フェーズ(${phase})中にコード領域 ${rel} へ書き込もうとしています`);
  }
  if (CODE_PHASES.has(phase)) {
    if (/^\.codiel\/specs\/.+\/(spec|cases)\.md$/.test(rel))
      emit("ask", `テスト仕様・期待値(${rel})の変更は test-designer の担当です(${phase} 中の変更は改竄の疑い)`);
    pass();
  }
  // pr / review / triage / finalize
  if (rel.startsWith(".codiel/")) pass();
  emit("ask", `フェーズ ${phase} 中の ${rel} への書き込みは想定外です`);
} catch (e) {
  emit("ask", `guard-write の内部エラー(フェイルクローズド): ${(e as Error).message}`);
}
