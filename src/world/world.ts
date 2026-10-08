// Génération de la carte : biomes, filons et brouillard, découpés en chunks.
import { CHUNK, type BiomeId } from '../config.ts';
import { fbm, hash, hashString, rng } from './rng.ts';

export type Richness = 'pauvre' | 'normal' | 'riche';

export const RICHNESS_RATE: Record<Richness, number> = { pauvre: 0.6, normal: 1, riche: 1.6 };
export const RICHNESS_LABEL: Record<Richness, string> = { pauvre: 'pauvre', normal: 'normal', riche: 'riche' };

export interface Patch {
  id: string;
  type: string;
  /** Centre en cases (valeur continue). */
  cx: number;
  cy: number;
  /** Rayon moyen en cases. */
  r: number;
  richness: Richness;
  p1: number;
  p2: number;
}

interface ChunkData {
  patches: Patch[];
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function cellToChunk(x: number): number {
  return Math.floor(x / CHUNK);
}

/** Rayon du filon dans la direction θ : un contour irrégulier mais stable. */
export function patchRadius(p: Patch, theta: number): number {
  return p.r * (1 + 0.16 * Math.sin(3 * theta + p.p1) + 0.09 * Math.sin(5 * theta + p.p2));
}

export function patchContains(p: Patch, x: number, y: number): boolean {
  const dx = x + 0.5 - p.cx, dy = y + 0.5 - p.cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > (p.r * 1.3) ** 2) return false;
  return Math.sqrt(d2) <= patchRadius(p, Math.atan2(dy, dx));
}

const BIOME_ORES: Record<BiomeId, { type: string; w: number; rich?: boolean }[]> = {
  plaine: [{ type: 'fer', w: 4 }, { type: 'cuivre', w: 3 }, { type: 'charbon', w: 3 }, { type: 'calcaire', w: 2 }],
  desert: [{ type: 'sable', w: 4 }, { type: 'quartz', w: 2 }, { type: 'petrole', w: 2 }],
  terres: [{ type: 'bauxite', w: 3 }, { type: 'cuivre', w: 2, rich: true }],
  marais: [{ type: 'petrole', w: 3 }, { type: 'charbon', w: 2, rich: true }],
  montagnes: [{ type: 'fer', w: 3, rich: true }, { type: 'or', w: 2 }],
  crateres: [{ type: 'uranium', w: 3 }, { type: 'quartz', w: 2, rich: true }],
};

/** Filons garantis autour du départ (le Noyau occupe les cases 0 à 3). */
const START_PATCHES: Omit<Patch, 'id' | 'p1' | 'p2'>[] = [
  { type: 'fer', cx: -12, cy: -4, r: 3.4, richness: 'normal' },
  { type: 'charbon', cx: -11, cy: 10, r: 3.2, richness: 'normal' },
  { type: 'cuivre', cx: 16, cy: 12, r: 3.2, richness: 'normal' },
  { type: 'calcaire', cx: 16, cy: -10, r: 2.8, richness: 'pauvre' },
  { type: 'fer', cx: -26, cy: 24, r: 3.6, richness: 'riche' },
];
const START_RADIUS = 30;

export class World {
  readonly seed: string;
  readonly seedNum: number;
  private chunks = new Map<string, ChunkData>();
  private fog = new Map<string, Uint8Array>();
  /** Incrémenté quand le brouillard d'un chunk change (pour redessiner). */
  readonly fogVersion = new Map<string, number>();
  /** Types de matières premières déjà découvertes (filon révélé). */
  readonly discovered = new Set<string>();

  constructor(seed: string) {
    this.seed = seed;
    this.seedNum = hashString(seed);
  }

  biomeAt(x: number, y: number): BiomeId {
    const d = Math.hypot(x, y);
    const warp = fbm(this.seedNum + 7, x / 30, y / 30) * 30;
    if (d + warp < 60) return 'plaine';
    const n2 = fbm(this.seedNum + 2, x / 110, y / 110);
    if (d > 320 && n2 < 0.36) return 'crateres';
    if (d > 160 && n2 > 0.6) return 'montagnes';
    const n1 = fbm(this.seedNum + 1, x / 70, y / 70);
    if (n1 < 0.4) return 'plaine';
    if (n1 < 0.5) return 'marais';
    if (n1 < 0.6) return 'terres';
    return 'desert';
  }

  private chunk(cx: number, cy: number): ChunkData {
    const k = chunkKey(cx, cy);
    let c = this.chunks.get(k);
    if (!c) {
      c = this.generate(cx, cy);
      this.chunks.set(k, c);
    }
    return c;
  }

  private generate(cx: number, cy: number): ChunkData {
    const patches: Patch[] = [];
    const rand = rng(hash(this.seedNum, cx, cy, 17));
    // Filons de départ : rangés dans le chunk de leur centre.
    START_PATCHES.forEach((p, i) => {
      if (cellToChunk(Math.floor(p.cx)) === cx && cellToChunk(Math.floor(p.cy)) === cy) {
        const pr = rng(hash(this.seedNum, i, 99));
        patches.push({ ...p, id: `s${i}`, p1: pr() * 6.28, p2: pr() * 6.28 });
      }
    });
    const count = rand() < 0.25 ? 0 : rand() < 0.6 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const px = cx * CHUNK + 5 + rand() * (CHUNK - 10);
      const py = cy * CHUNK + 5 + rand() * (CHUNK - 10);
      const d = Math.hypot(px, py);
      if (d < START_RADIUS) continue;
      const biome = this.biomeAt(Math.floor(px), Math.floor(py));
      const options = BIOME_ORES[biome];
      const total = options.reduce((s, o) => s + o.w, 0);
      let pick = rand() * total;
      let choice = options[0];
      for (const o of options) { pick -= o.w; if (pick <= 0) { choice = o; break; } }
      const roll = rand() + Math.min(d / 600, 0.25) + (choice.rich ? 0.35 : 0);
      const richness: Richness = roll > 0.95 ? 'riche' : roll > 0.5 ? 'normal' : 'pauvre';
      const overlaps = patches.some((p) => Math.hypot(p.cx - px, p.cy - py) < p.r + 6);
      if (overlaps) continue;
      patches.push({
        id: `${cx}:${cy}:${i}`, type: choice.type, cx: px, cy: py,
        r: 2.4 + rand() * 1.8 + (richness === 'riche' ? 0.4 : 0),
        richness, p1: rand() * 6.28, p2: rand() * 6.28,
      });
    }
    return { patches };
  }

  /** Les filons d'un chunk. */
  patchesInChunk(cx: number, cy: number): Patch[] {
    return this.chunk(cx, cy).patches;
  }

  /** Le filon sous une case, s'il y en a un. */
  patchAt(x: number, y: number): Patch | null {
    const cx = cellToChunk(x), cy = cellToChunk(y);
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        for (const p of this.chunk(cx + i, cy + j).patches) {
          if (patchContains(p, x, y)) return p;
        }
      }
    }
    return null;
  }

  // ---- Brouillard ----

  private fogChunk(cx: number, cy: number, create: boolean): Uint8Array | null {
    const k = chunkKey(cx, cy);
    let f = this.fog.get(k);
    if (!f && create) {
      f = new Uint8Array(CHUNK * CHUNK);
      this.fog.set(k, f);
    }
    return f ?? null;
  }

  isRevealed(x: number, y: number): boolean {
    const cx = cellToChunk(x), cy = cellToChunk(y);
    const f = this.fogChunk(cx, cy, false);
    if (!f) return false;
    return f[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)] === 1;
  }

  /** Révèle un disque autour d'une case. Renvoie vrai si quelque chose a changé. */
  reveal(x: number, y: number, radius: number): boolean {
    let changed = false;
    const r2 = radius * radius;
    const ri = Math.ceil(radius);
    for (let j = -ri; j <= ri; j++) {
      for (let i = -ri; i <= ri; i++) {
        if (i * i + j * j > r2) continue;
        const px = x + i, py = y + j;
        const cx = cellToChunk(px), cy = cellToChunk(py);
        const f = this.fogChunk(cx, cy, true)!;
        const idx = (py - cy * CHUNK) * CHUNK + (px - cx * CHUNK);
        if (f[idx] === 0) {
          f[idx] = 1;
          changed = true;
          const k = chunkKey(cx, cy);
          this.fogVersion.set(k, (this.fogVersion.get(k) ?? 0) + 1);
          const p = this.patchAt(px, py);
          if (p) this.discovered.add(p.type);
        }
      }
    }
    return changed;
  }

  fogData(cx: number, cy: number): Uint8Array | null {
    return this.fogChunk(cx, cy, false);
  }

  /** Brouillard sérialisé : { "cx,cy": base64 du masque de bits }. */
  saveFog(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, f] of this.fog) {
      const bits = new Uint8Array(f.length / 8);
      for (let i = 0; i < f.length; i++) if (f[i]) bits[i >> 3] |= 1 << (i & 7);
      let s = '';
      for (const b of bits) s += String.fromCharCode(b);
      out[k] = btoa(s);
    }
    return out;
  }

  loadFog(data: Record<string, string>): void {
    for (const [k, b64] of Object.entries(data)) {
      const s = atob(b64);
      const f = new Uint8Array(CHUNK * CHUNK);
      for (let i = 0; i < f.length; i++) if (s.charCodeAt(i >> 3) & (1 << (i & 7))) f[i] = 1;
      this.fog.set(k, f);
      this.fogVersion.set(k, 1);
      const [cx, cy] = k.split(',').map(Number);
      for (let i = 0; i < f.length; i++) {
        if (!f[i]) continue;
        const p = this.patchAt(cx * CHUNK + (i % CHUNK), cy * CHUNK + Math.floor(i / CHUNK));
        if (p) this.discovered.add(p.type);
      }
    }
  }
}
