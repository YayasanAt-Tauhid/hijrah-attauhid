/**
 * Fetch readiness data in bounded batches. The function is deliberately independent
 * from Supabase so it can be tested without a database connection.
 */
export async function fetchSpmbReadinessInBatches<T>(
  ids: string[],
  fetchBatch: (ids: string[]) => Promise<T[]>,
  batchSize = 12,
  concurrency = 3,
): Promise<T[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("Invalid batch size");
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Invalid concurrency");
  if (!ids.length) return [];

  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += batchSize) batches.push(ids.slice(i, i + batchSize));
  const results: T[][] = new Array(batches.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < batches.length) {
      const index = nextIndex++;
      results[index] = await fetchBatch(batches[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()));
  return results.flat();
}
