import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["plugins/**/__test__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 20_000
  }
})
