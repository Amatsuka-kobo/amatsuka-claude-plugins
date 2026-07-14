#!/usr/bin/env node
// codiel-state の CLI エントリ。ライブラリ本体(codiel-state.ts)にはトップレベルの
// CLI 起動判定を置かない — esbuild で hooks に inline された際に main() が誤発火するため。
import { main } from "./codiel-state.js"

main(process.argv.slice(2))
