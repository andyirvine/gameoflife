// The single source of randomness for the whole engine. No bare Math.random() anywhere.
// mulberry32: small, fast, deterministic given a seed.

export type Rng = {
  next(): number              // [0, 1)
  int(maxExclusive: number): number
  range(min: number, max: number): number
  bool(pTrue: number): boolean
  pick<T>(items: readonly T[]): T
  fork(salt: number): Rng     // independent stream, still deterministic
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng: Rng = {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    range: (min, max) => min + next() * (max - min),
    bool: (pTrue) => next() < pTrue,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    fork: (salt) => makeRng((seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0),
  }
  return rng
}
