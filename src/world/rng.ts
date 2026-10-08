// Hasard déterministe : même graine, même carte.

/** Hache une chaîne (la graine) en entier 32 bits. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Hache plusieurs entiers en un entier 32 bits. */
export function hash(...n: number[]): number {
  let h = 0x9e3779b9;
  for (const v of n) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Générateur pseudo-aléatoire (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bruit de valeur lissé, entre 0 et 1. */
export function valueNoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const v = (i: number, j: number) => hash(seed, i, j) / 4294967296;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
  const u = s(xf), w = s(yf);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}

/** Bruit à plusieurs octaves, entre 0 et 1. */
export function fbm(seed: number, x: number, y: number, octaves = 3): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(seed + i * 101, x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Une graine lisible et partageable, par exemple « PAPILLON-482 ». */
export function randomSeedCode(): string {
  const words = ['PAPILLON', 'NUAGE', 'CUIVRE', 'TAPIS', 'COMETE', 'MENTHE', 'GALET', 'LUCIOLE', 'BOUSSOLE', 'ROUAGE', 'PRAIRIE', 'VOLCAN', 'AMANDE', 'ECLAIR', 'BRUME', 'ORAGE'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(100 + Math.random() * 900);
  return `${w}-${n}`;
}
