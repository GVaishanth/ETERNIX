/*
 * Small, fixed, deterministic random source. The same seed always gives the same sequence, so procedural layout and
 * traffic generation are reproducible. Not for security. Nothing here uses Math.random.
 */

/** mulberry32: returns a generator of floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks one item with the given random source. Throws on an empty list, which is always a caller bug. */
export function pickFrom<T>(random: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pickFrom: empty list');
  const index = Math.min(Math.floor(random() * items.length), items.length - 1);
  const item = items[index];
  if (item === undefined) throw new Error('pickFrom: index out of range');
  return item;
}
