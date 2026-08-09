/** Copyright 2026 amatsuka-koubou. Licensed under the Apache License, Version 2.0.
 *  Replaces the ProcessPoolExecutor usage in scripts/run_eval.py from the
 *  skill-creator Claude Code plugin.
 */

export async function pool<T, R>(
  items: T[],
  workers: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const limit = Math.max(1, Math.min(workers, items.length))

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}
