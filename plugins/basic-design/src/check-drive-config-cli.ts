#!/usr/bin/env node
import { readDriveConfig } from "./check-drive-config.js"

process.stdout.write(
  `${JSON.stringify(readDriveConfig(process.argv[2] ?? process.cwd()))}\n`
)
