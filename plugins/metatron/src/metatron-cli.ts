#!/usr/bin/env node
// metatron CLI のエントリ。ディスパッチ本体(src/cli/main.ts)にはトップレベルの
// 起動を置かない — esbuild で他のエントリに inline された際に main() が誤発火するため
// (codiel の codiel-state-cli.ts と同じ分離)。
import { main } from "./cli/main.js"

main(process.argv.slice(2))
