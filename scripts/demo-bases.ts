// Bases toutes construites pour les parties d'essai : foreuses, fours, tapis, stations, électricité, camions…
// Les places sont cherchées autour de points de repère, et les tapis sont routés case par case (parcours en largeur),
// puis tracés comme au doigt avec le vrai traceur de tapis.
import type { Game } from '../src/sim/game.ts';
import type { Machine } from '../src/sim/factory.ts';
import { BeltTracer } from '../src/sim/tracer.ts';
import { machineDef } from '../src/data/machines.ts';

type P = { x: number; y: number };

export class BaseBuilder {
  readonly g: Game;
  /** Cases gardées libres (couloirs) : ni machine ni tapis n'y entre tant qu'on ne les libère pas. */
  private keep = new Set<string>();

  constructor(g: Game) {
    this.g = g;
    g.money = 1e9;
  }

  private k(x: number, y: number): string {
    return `${x},${y}`;
  }

  private open(x: number, y: number, patchOk = false): boolean {
    const g = this.g, f = g.factory;
    if (!g.world.isRevealed(x, y) || f.machineAt(x, y) || f.beltAt(x, y) || this.keep.has(this.k(x, y))) return false;
    return patchOk || !g.world.patchAt(x, y);
  }

  /** Rectangle libre, avec une marge autour (sans machine ni tapis). */
  private fits(x: number, y: number, w: number, h: number, margin: number): boolean {
    for (let j = -margin; j < h + margin; j++) {
      for (let i = -margin; i < w + margin; i++) {
        const inside = i >= 0 && j >= 0 && i < w && j < h;
        if (!this.open(x + i, y + j, !inside)) return false;
      }
    }
    return true;
  }

  /** Une place libre pour cette machine, au plus près du point. */
  spot(type: string, near: P, margin = 1): P {
    const d = machineDef(type);
    for (let r = 0; r < 30; r++) {
      const cands: P[] = [];
      for (let y = near.y - r; y <= near.y + r; y++) {
        for (let x = near.x - r; x <= near.x + r; x++) {
          if (Math.max(Math.abs(x - near.x), Math.abs(y - near.y)) !== r) continue;
          cands.push({ x: x - Math.floor(d.w / 2), y: y - Math.floor(d.h / 2) });
        }
      }
      cands.sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y));
      for (const c of cands) if (this.fits(c.x, c.y, d.w, d.h, margin) && this.g.factory.checkMachine(type, c.x, c.y).ok) return c;
    }
    throw new Error(`pas de place pour ${type} près de ${near.x},${near.y}`);
  }

  /** Pose une machine construite, avec sa case carburant pleine. */
  put(type: string, at: P): Machine {
    const m = this.g.placeMachine(type, at.x, at.y);
    if (!m) throw new Error(`${type} refusé en ${at.x},${at.y}`);
    m.built = true;
    if (machineDef(type).coal) this.g.factory.addFuel(m, 10);
    return m;
  }

  place(type: string, near: P, margin = 1): Machine {
    return this.put(type, this.spot(type, near, margin));
  }

  /** n foreuses sur le filon de ce minerai le plus proche du point, une case d'écart entre elles. */
  drills(ore: string, near: P, n: number): Machine[] {
    const g = this.g, f = g.factory;
    const out: Machine[] = [];
    for (let i = 0; i < n; i++) {
      let best: { p: P; score: number } | null = null;
      for (let y = near.y - 14; y <= near.y + 14; y++) {
        for (let x = near.x - 14; x <= near.x + 14; x++) {
          const c = f.checkMachine('foreuse', x, y);
          if (!c.ok || c.ore !== ore) continue;
          let room = true;
          for (let j = -1; j <= 2 && room; j++) for (let ii = -1; ii <= 2 && room; ii++) {
            if (f.machineAt(x + ii, y + j) || f.beltAt(x + ii, y + j) || !g.world.isRevealed(x + ii, y + j)) room = false;
          }
          if (!room) continue;
          let cells = 0;
          for (let j = 0; j < 2; j++) for (let ii = 0; ii < 2; ii++) if (g.world.patchAt(x + ii, y + j)?.type === ore) cells++;
          const score = cells * 10 + (c.rate ?? 0) * 5 - Math.hypot(x - near.x, y - near.y) * 0.3;
          if (!best || score > best.score) best = { p: { x, y }, score };
        }
      }
      if (!best) throw new Error(`pas de foreuse possible sur ${ore} près de ${near.x},${near.y}`);
      out.push(this.put('foreuse', best.p));
    }
    return out;
  }

  /** Cases voisines (par les côtés) d'une machine. */
  private around(m: Machine): { cell: P; inside: P }[] {
    const r: { cell: P; inside: P }[] = [];
    for (let i = 0; i < m.w; i++) {
      r.push({ cell: { x: m.x + i, y: m.y - 1 }, inside: { x: m.x + i, y: m.y } });
      r.push({ cell: { x: m.x + i, y: m.y + m.h }, inside: { x: m.x + i, y: m.y + m.h - 1 } });
    }
    for (let j = 0; j < m.h; j++) {
      r.push({ cell: { x: m.x - 1, y: m.y + j }, inside: { x: m.x, y: m.y + j } });
      r.push({ cell: { x: m.x + m.w, y: m.y + j }, inside: { x: m.x + m.w - 1, y: m.y + j } });
    }
    return r;
  }

  /** Un tapis de a vers b, routé autour de ce qui est déjà posé. */
  belt(a: Machine, b: Machine): number {
    const g = this.g;
    const starts = this.around(a).filter((s) => this.open(s.cell.x, s.cell.y, true));
    const goals = new Map(this.around(b).filter((s) => this.open(s.cell.x, s.cell.y, true)).map((s) => [this.k(s.cell.x, s.cell.y), s]));
    if (!starts.length || !goals.size) throw new Error(`tapis ${a.type}→${b.type} : pas d'accès`);
    // Parcours en largeur ; un virage coûte un peu (on préfère les lignes droites), via une file à deux niveaux.
    const prev = new Map<string, string | null>();
    const startOf = new Map<string, { cell: P; inside: P }>();
    let frontier: P[] = [];
    for (const s of starts) {
      const key = this.k(s.cell.x, s.cell.y);
      if (prev.has(key)) continue;
      prev.set(key, null);
      startOf.set(key, s);
      frontier.push(s.cell);
    }
    let end: string | null = null;
    const minX = Math.min(a.x, b.x) - 14, maxX = Math.max(a.x, b.x) + 16, minY = Math.min(a.y, b.y) - 14, maxY = Math.max(a.y, b.y) + 16;
    while (frontier.length && !end) {
      const next: P[] = [];
      for (const c of frontier) {
        const key = this.k(c.x, c.y);
        if (goals.has(key)) { end = key; break; }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = c.x + dx, ny = c.y + dy, nk = this.k(nx, ny);
          if (nx < minX || nx > maxX || ny < minY || ny > maxY || prev.has(nk) || !this.open(nx, ny, true)) continue;
          prev.set(nk, key);
          next.push({ x: nx, y: ny });
        }
      }
      frontier = next;
    }
    if (!end) throw new Error(`tapis ${a.type}→${b.type} : pas de chemin`);
    const path: P[] = [];
    for (let c: string | null = end; c; c = prev.get(c) ?? null) {
      const [x, y] = c.split(',').map(Number);
      path.unshift({ x, y });
    }
    const st = startOf.get(this.k(path[0].x, path[0].y))!;
    const gl = goals.get(end)!;
    const pts: P[] = [st.inside, ...path, gl.inside];
    const t = new BeltTracer(g.factory, pts[0].x + 0.5, pts[0].y + 0.5);
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      for (let s = 1; s <= 4; s++) t.move(p0.x + 0.5 + (p1.x - p0.x) * s / 4, p0.y + 0.5 + (p1.y - p0.y) * s / 4);
    }
    const cells = t.result();
    if (!g.placeBelts(cells)) throw new Error(`tapis ${a.type}→${b.type} refusé`);
    return path.length;
  }

  /** Câbles en ligne droite puis en équerre, de dessous une machine à dessous l'autre (ils passent sous tout). */
  cable(a: Machine, b: Machine): void {
    const ax = a.x + Math.floor(a.w / 2), ay = a.y + a.h - 1; // une case de a
    const bx = b.x + Math.floor(b.w / 2), by = b.y + b.h - 1;
    const cells: P[] = [];
    const sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
    for (let x = ax; x !== bx; x += sx) cells.push({ x, y: ay });
    for (let y = ay; y !== by; y += sy) cells.push({ x: bx, y });
    cells.push({ x: bx, y: by });
    const fresh = cells.filter((c) => !this.g.factory.hasCable(c.x, c.y));
    if (fresh.length && !this.g.placeCables(fresh)) throw new Error(`câble ${a.type}→${b.type} refusé`);
  }

  /** Tout ce qui a été posé est construit (pas de chantier en attente). */
  finish(): void {
    const g = this.g;
    for (const m of g.factory.machines.values()) m.built = true;
    for (const b of g.factory.belts.values()) b.built = true;
    g.pending = [];
    g.factory.markBuilt();
  }
}
