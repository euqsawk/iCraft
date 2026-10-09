// Tracé des tapis au doigt : le chemin du doigt devient des lignes droites
// sur la grille, avec des virages à angle droit.
import { DX, DY, dirBetween, opposite, type Dir } from './geom.ts';
import type { Belt, Factory, Machine } from './factory.ts';

export interface TraceCell {
  x: number;
  y: number;
  dir: Dir;
  inDir: Dir;
  /** Case de tapis déjà construite qu'on prolonge. */
  existing?: boolean;
}

/** Marge (en cases) avant qu'un léger écart du doigt ne crée un virage. */
const HYSTERESIS = 0.85;

export class BeltTracer {
  cells: { x: number; y: number }[] = [];
  /** Machine ou tapis vers lequel pointe la dernière case. */
  endTarget: { x: number; y: number } | null = null;
  /** Le tracé a buté sur un obstacle. */
  blocked = false;
  readonly startMachine: Machine | null = null;
  /** Depuis une machine vers un tapis qui la longe : une liaison de côté, sans nouvelle case. */
  linkBelt: Belt | null = null;
  linkDir: Dir | null = null;
  /** Depuis un tapis vers une machine qu'il longe : le tapis la nourrit par le côté. */
  intoMachine: Dir | null = null;
  readonly extend: Belt | null = null;
  /** Tapis existant d'où part une dérivation (il devient un séparateur). */
  readonly splitFrom: Belt | null = null;
  private startDir: Dir | null = null;
  private factory: Factory;

  constructor(factory: Factory, fx: number, fy: number) {
    this.factory = factory;
    const sx = Math.floor(fx), sy = Math.floor(fy);
    const m = factory.machineAt(sx, sy);
    const b = factory.beltAt(sx, sy);
    if (m) {
      this.startMachine = m;
    } else if (b) {
      const n = factory.next(b);
      if (!n || n.kind !== 'belt') {
        this.extend = b;
        this.cells = [{ x: sx, y: sy }];
      } else if (b.built && b.split === undefined) {
        this.splitFrom = b;
      } else {
        this.blocked = true;
      }
    } else if (this.usable(sx, sy)) {
      this.cells = [{ x: sx, y: sy }];
    } else {
      this.blocked = true;
    }
  }

  private usable(x: number, y: number): boolean {
    return this.factory.isFree(x, y) && this.factory.world.isRevealed(x, y);
  }

  private occupied(x: number, y: number): boolean {
    return !!this.factory.machineAt(x, y) || !!this.factory.beltAt(x, y);
  }

  /** Nombre de cases nouvelles (à construire). */
  get newCount(): number {
    return this.cells.length - (this.extend ? 1 : 0);
  }

  get valid(): boolean {
    return this.newCount >= 1 && (this.cells.length >= 2 || this.endTarget !== null || this.startMachine !== null || this.splitFrom !== null);
  }

  /** Sens de la dérivation créée, s'il y en a une. */
  get splitDir(): Dir | null {
    return this.splitFrom ? this.startDir : null;
  }

  move(fx: number, fy: number): void {
    if (this.blocked && this.cells.length === 0) return;
    const sb = this.splitFrom;
    if (sb && this.cells.length === 0) {
      // Dérivation : la première case part sur un côté libre du tapis.
      const dx = fx - (sb.x + 0.5), dy = fy - (sb.y + 0.5);
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.8) return;
      const d: Dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      this.intoMachine = null;
      if (d === sb.dir || d === opposite(sb.inDir)) return;
      const x = sb.x + DX[d], y = sb.y + DY[d];
      if (this.factory.machineAt(x, y)) { this.intoMachine = d; this.blocked = true; return; }
      if (!this.usable(x, y)) { this.blocked = true; return; }
      this.startDir = d;
      this.cells.push({ x, y });
    }
    const m = this.startMachine;
    if (m && this.cells.length === 0) {
      const cx = Math.floor(fx), cy = Math.floor(fy);
      this.linkBelt = null;
      this.linkDir = null;
      if (this.factory.inside(m, cx, cy)) return;
      // Première case : collée au bord de la machine, du côté du doigt.
      let x = Math.min(Math.max(cx, m.x), m.x + m.w - 1);
      let y = Math.min(Math.max(cy, m.y), m.y + m.h - 1);
      const outX = cx < m.x ? m.x - cx : cx >= m.x + m.w ? cx - (m.x + m.w - 1) : 0;
      const outY = cy < m.y ? m.y - cy : cy >= m.y + m.h ? cy - (m.y + m.h - 1) : 0;
      if (outX >= outY) x = cx < m.x ? m.x - 1 : m.x + m.w;
      else y = cy < m.y ? m.y - 1 : m.y + m.h;
      const inside = { x: Math.min(Math.max(x, m.x), m.x + m.w - 1), y: Math.min(Math.max(y, m.y), m.y + m.h - 1) };
      this.startDir = dirBetween(inside.x, inside.y, x, y);
      // Un tapis longe la machine à cet endroit : on propose de les relier par le côté.
      const lb = this.factory.beltAt(x, y);
      if (lb) {
        const toMachine = opposite(this.startDir as Dir);
        const intoMachine = lb.dir === toMachine;
        const fromMachine = opposite(lb.inDir) === toMachine;
        if (!intoMachine && !fromMachine) { this.linkBelt = lb; this.linkDir = toMachine; }
        this.blocked = true;
        return;
      }
      if (!this.usable(x, y)) { this.blocked = true; return; }
      this.cells.push({ x, y });
    }
    if (this.cells.length === 0) return;

    // Le doigt repasse sur une case déjà tracée : le tracé reprend de là (inutile de revenir case par case).
    const fx0 = Math.floor(fx), fy0 = Math.floor(fy);
    const back = this.cells.findIndex((c) => c.x === fx0 && c.y === fy0);
    if (back >= 0 && back < this.cells.length - 1) {
      this.cells.length = back + 1;
      this.blocked = false;
      this.endTarget = null;
      return;
    }

    // Cible avec hystérésis : on reste sur la ligne tant que le doigt ne s'en écarte pas franchement.
    let tx = Math.floor(fx), ty = Math.floor(fy);
    const last = this.cells[this.cells.length - 1];
    const cur = this.currentDir();
    if (cur !== null) {
      if (DY[cur] === 0 && Math.abs(fy - (last.y + 0.5)) < HYSTERESIS) ty = last.y;
      if (DX[cur] === 0 && Math.abs(fx - (last.x + 0.5)) < HYSTERESIS) tx = last.x;
    }

    this.blocked = false;
    this.endTarget = null;
    for (let guard = 0; guard < 400; guard++) {
      const c = this.cells[this.cells.length - 1];
      const dx = tx - c.x, dy = ty - c.y;
      if (dx === 0 && dy === 0) break;
      const d = this.currentDir();
      let step: Dir;
      if (d !== null && ((DX[d] !== 0 && Math.sign(dx) === DX[d]) || (DY[d] !== 0 && Math.sign(dy) === DY[d]))) step = d;
      else if (Math.abs(dx) >= Math.abs(dy)) step = dx > 0 ? 0 : 2;
      else step = dy > 0 ? 1 : 3;
      const nx = c.x + DX[step], ny = c.y + DY[step];
      const prev = this.cells[this.cells.length - 2];
      if (prev && prev.x === nx && prev.y === ny) {
        // Retour en arrière : on efface la dernière case (sauf la case prolongée).
        if (this.extend && this.cells.length === 1) break;
        this.cells.pop();
        continue;
      }
      if (this.cells.some((p) => p.x === nx && p.y === ny)) { this.blocked = true; break; }
      if (!this.usable(nx, ny)) {
        if (this.occupied(nx, ny)) this.endTarget = { x: nx, y: ny };
        else this.blocked = true;
        break;
      }
      this.cells.push({ x: nx, y: ny });
    }
    // Un tapis ne se branche pas sur lui-même ni sur la machine d'où il part s'il n'a qu'une case.
    if (this.endTarget && this.startMachine && this.cells.length === 1 && this.factory.machineAt(this.endTarget.x, this.endTarget.y) === this.startMachine) {
      this.endTarget = null;
    }
  }

  private currentDir(): Dir | null {
    const n = this.cells.length;
    if (n >= 2) return dirBetween(this.cells[n - 2].x, this.cells[n - 2].y, this.cells[n - 1].x, this.cells[n - 1].y);
    if (n === 1) {
      if (this.extend) return this.extend.inDir;
      return this.startDir;
    }
    return null;
  }

  /** Les cases avec leur sens, prêtes à construire. */
  result(): TraceCell[] {
    const n = this.cells.length;
    if (n === 0) return [];
    const out: TraceCell[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.cells[i];
      let dir: Dir;
      if (i < n - 1) dir = dirBetween(c.x, c.y, this.cells[i + 1].x, this.cells[i + 1].y)!;
      else if (this.endTarget) dir = dirBetween(c.x, c.y, this.endTarget.x, this.endTarget.y)!;
      else dir = this.currentDir() ?? 0;
      let inDir: Dir;
      if (i > 0) inDir = dirBetween(this.cells[i - 1].x, this.cells[i - 1].y, c.x, c.y)!;
      else if (this.extend) inDir = this.extend.inDir;
      else if (this.startDir !== null) inDir = this.startDir;
      else inDir = dir;
      out.push({ x: c.x, y: c.y, dir, inDir, existing: i === 0 && !!this.extend });
    }
    return out;
  }
}
