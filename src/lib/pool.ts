// Bounded concurrency, without a dependency.
//
// The collector is network-bound: on the benchmark, database time was 12% of
// wall clock and the rest was HTTP waiting. Fan-out is therefore the single
// largest lever available, and the only thing that has to stay honest while
// fanning out is politeness -- which is enforced per DOMAIN, not per task, so
// running many tasks at once never means hitting one host harder.

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}

/** Like mapWithConcurrency, but a thrown task yields null instead of aborting the batch. */
export async function mapSettled<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  return mapWithConcurrency(items, limit, async (item, index) => {
    try {
      return await fn(item, index);
    } catch {
      return null;
    }
  });
}
