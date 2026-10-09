// Tracé d'un tapis souterrain : il part d'un coffre ou d'une machine et file sous le sol
// (sous les tapis, les câbles, le reste) jusqu'à la machine où le doigt s'arrête.
import { DX, DY, dirBetween, type Dir } from './geom.ts';
import type { Factory, Machine } from './factory.ts';
import type { World } from '../world/world.ts';

const HYSTERESIS = 0.85;

export class TunnelTracer {
  readonly source: Machine | null;
  /** La machine d'arrivée, quand le tracé y entre. */
  target: Machine | null = null;
  cells: { x: number; y: number }[] = [];
  /** Le tracé est bloqué (plus utilisé : on construit aussi dans le brouillard). */
  blocked = false;
  private factory: Factory;
  private startDir: Dir | null = null;

  /**
   * Départ sur un sol libre (routes et rails seulement) : un coffre y sera posé. C'est alors la première case du tracé.
   * Arrivée sur un sol libre : la dernière case recevra un coffre.
   */
  readonly start: { x: number; y: number } | null = null;

  constructor(factory: Factory, _world: World, fx: number, fy: number, free = false) {
    this.factory = factory;
    const x = Math.floor(fx), y = Math.floor(fy);
    this.source = factory.machineAt(x, y) ?? null;
    if (!this.source && free && factory.isFree(x, y)) {
      this.start = { x, y };
      this.cells = [{ x, y }];
    }
  }

  /** Un coffre est à poser au départ ou à l'arrivée (cases du tracé qui ne sont pas du chemin). */
  get chestStart(): { x: number; y: number } | null {
    return this.start;
  }

  get chestEnd(): { x: number; y: number } | null {
    if (this.target || this.blocked) return null;
    const last = this.cells[this.cells.length - 1];
    if (!last || (this.start && this.cells.length < 2)) return null;
    if (!this.factory.isFree(last.x, last.y)) return null;
    return last;
  }

  /** Les cases du chemin lui-même (sans les cases où un coffre sera posé). */
  get pathCells(): { x: number; y: number }[] {
    return this.cells.slice(this.start ? 1 : 0, this.chestEnd ? -1 : undefined);
  }

  /** Le tracé peut être posé (vers une machine, ou vers un coffre à poser). */
  get ready(): boolean {
    if (!this.source && !this.start) return false;
    return !!this.target || !!this.chestEnd;
  }

  private dir(): Dir | null {
    const n = this.cells.length;
    if (n >= 2) return dirBetween(this.cells[n - 2].x, this.cells[n - 2].y, this.cells[n - 1].x, this.cells[n - 1].y);
    return n === 1 ? this.startDir : null;
  }

  move(fx: number, fy: number): void {
    const m = this.source;
    if (!m && !this.start) return;
    const cx = Math.floor(fx), cy = Math.floor(fy);
    this.target = null;
    this.blocked = false;
    if (m && this.factory.inside(m, cx, cy)) { this.cells = []; return; }
    if (this.start && cx === this.start.x && cy === this.start.y) { this.cells = [this.start]; return; }
    if (m && !this.cells.length) {
      // Première case : contre le bord de la machine, du côté du doigt.
      let x = Math.min(Math.max(cx, m.x), m.x + m.w - 1);
      let y = Math.min(Math.max(cy, m.y), m.y + m.h - 1);
      const outX = cx < m.x ? m.x - cx : cx >= m.x + m.w ? cx - (m.x + m.w - 1) : 0;
      const outY = cy < m.y ? m.y - cy : cy >= m.y + m.h ? cy - (m.y + m.h - 1) : 0;
      const inX = x, inY = y;
      if (outX >= outY) x = cx < m.x ? m.x - 1 : m.x + m.w;
      else y = cy < m.y ? m.y - 1 : m.y + m.h;
      this.startDir = dirBetween(inX, inY, x, y);
      const o = this.factory.machineAt(x, y);
      if (o && o !== m) { this.target = o; return; }
      this.cells.push({ x, y });
    }
    let tx = cx, ty = cy;
    const last = this.cells[this.cells.length - 1];
    const cur = this.dir();
    if (cur !== null && !this.factory.machineAt(cx, cy)) {
      if (DY[cur] === 0 && Math.abs(fy - (last.y + 0.5)) < HYSTERESIS) ty = last.y;
      if (DX[cur] === 0 && Math.abs(fx - (last.x + 0.5)) < HYSTERESIS) tx = last.x;
    }
    // Le doigt repasse sur une case déjà tracée : on reprend de là.
    const back = this.cells.findIndex((c) => c.x === tx && c.y === ty);
    if (back >= 0) { this.cells.length = back + 1; return; }
    for (let guard = 0; guard < 400; guard++) {
      const c = this.cells[this.cells.length - 1];
      const dx = tx - c.x, dy = ty - c.y;
      if (dx === 0 && dy === 0) break;
      const d = this.dir();
      let step: Dir;
      if (d !== null && ((DX[d] !== 0 && Math.sign(dx) === DX[d]) || (DY[d] !== 0 && Math.sign(dy) === DY[d]))) step = d;
      else if (Math.abs(dx) >= Math.abs(dy)) step = dx > 0 ? 0 : 2;
      else step = dy > 0 ? 1 : 3;
      const nx = c.x + DX[step], ny = c.y + DY[step];
      const seen = this.cells.findIndex((p) => p.x === nx && p.y === ny);
      if (seen >= 0) { this.cells.length = seen + 1; continue; }
      const o = this.factory.machineAt(nx, ny);
      if (o === m) break;
      // On entre dans une autre machine : c'est l'arrivée.
      if (o) { this.target = o; break; }
      this.cells.push({ x: nx, y: ny });
    }
  }
}
