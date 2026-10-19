/*
 * Runs a task once and shares its result. A failed task is not cached, so the next call runs it again. This lets the
 * game-module preload and the loading step share one import, and lets a failed import be retried.
 */
export function createRetryableOnce<T>(task: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (cached === null) {
      cached = task().catch((error: unknown) => {
        cached = null;
        throw error;
      });
    }
    return cached;
  };
}
