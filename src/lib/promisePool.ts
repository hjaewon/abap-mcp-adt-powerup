/**
 * Tiny bounded-concurrency worker pool.
 *
 * Runs `worker` over `items` with at most `concurrency` tasks in flight at once,
 * preserving each item's original index for callers that write into a
 * pre-sized results array (so output order matches input order even though
 * completion order does not).
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, runNext));
}
