// Deterministic randomness for HELIO SCRAPYARD. Every die the match rolls — bot
// picks, spread jitter, spawn variation — comes from one seeded mulberry32 stream,
// so the same seed replays the same match. The renderer never consumes randomness;
// only the fixed-step simulation does, which is what makes repeated runs identical.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uniform float in [min, max).
export function range(random, min, max) {
  return min + random() * (max - min);
}

// Integer in [min, max] inclusive.
export function rangeInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

// Pick one element of an array.
export function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}

// True with probability p (0..1): one call, one draw from the stream.
export function chance(random, p) {
  return random() < p;
}

// Fisher-Yates shuffle that returns a new array, driven by the same stream.
export function shuffled(random, array) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
