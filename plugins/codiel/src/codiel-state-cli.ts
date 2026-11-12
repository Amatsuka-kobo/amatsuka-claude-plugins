#!/usr/bin/env node
// codiel-state の CLI エントリ。ライブラリ本体(codiel-state.ts)にはトップレベルの
// CLI 起動判定を置かない — esbuild で hooks に inline された際に main() が誤発火するため。
// ルートはメインの作業ツリーに解決する。worktree の中やサブディレクトリから呼んでも、
// .codiel/runs/ はメインにだけ置く。
import { main } from "./codiel-state.js"
import { findMainRoot } from "./hooks/lib.js"

main(process.argv.slice(2), findMainRoot(process.cwd()))
