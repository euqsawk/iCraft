// Tracé des tapis au doigt : le chemin du doigt devient des lignes droites
// sur la grille, avec des virages à angle droit.
import { DX, DY, dirBetween, dirToward, opposite, type Dir } from './geom.ts';
import { RULES } from '../config.ts';
import type { Belt, Factory, Machine } from './factory.ts';

export interface TraceCell {
  x: number;
  y: number;
  dir: Dir;
  inDir: Dir;
  /** Case de tapis déjà construite qu'on prolonge. */
  existing?: boolean;
  /** Pont : nombre de cases enjambées après celle-ci. */
  jump?: number;
  /** En hauteur (étage 2). */
  z?: 1;
}

type Cell = { x: number; y: number; z: 0 | 1; jump?: number };

/** Marge (en cases) avant qu'un léger écart du doigt ne crée un virage. */
const HYSTERESIS = 0.85;

export class BeltTracer {
  cells: Cell[] = [];
  /** Étage des cases qu'on pose (0 : au sol, 1 : en hauteur). Se change pendant le tracé : là où il change, un ascenseur. */
  level: 0 | 1 = 0;
  /** Ponts débloqués : en continuant tout droit par-delà un tapis, on passe par-dessus. */
  bridges = false;
  /** Dérivation qui part en pont (par-dessus un tapis collé) : nombre de cases enjambées. */
  splitJump = 0;
  /** Machine ou tapis vers lequel pointe la dernière case. */
  endTarget: { x: number; y: number } | null = null;
  /** Le tracé a buté sur un obstacle. */
  blocked = false;
  startMachine: Machine | null = null;
  /** Depuis une machine vers un tapis qui la longe : une liaison de côté, sans nouvelle case. */
  linkBelt: Belt | null = null;
  linkDir: Dir | null = null;
  /** Depuis une machine vers une machine collée : liaison directe. */
  linkMachine: Machine | null = null;
  /** Depuis un tapis vers une machine qu'il longe : le tapis la nourrit par le côté. */
  intoMachine: Dir | null = null;
  readonly extend: Belt | null = null;
  /** Tapis existant d'où part une dérivation (il devient un séparateur). */
  readonly splitFrom: Belt | null = null;
  private startDir: Dir | null = null;
  private factory: Factory;
  private lastF: { x: number; y: number } | null = null;

  constructor(factory: Factory, fx: number, fy: number, level: 0 | 1 = 0) {
    this.factory = factory;
    this.level = level;
    const sx = Math.floor(fx), sy = Math.floor(fy);
    const m = factory.machineAt(sx, sy);
    // Le tapis de l'étage choisi d'abord ; celui de l'autre étage seulement pour prolonger son bout (par un ascenseur).
    const b = factory.beltAt(sx, sy, level);
    const o = factory.beltAt(sx, sy, level ? 0 : 1);
    if (m) {
      this.startMachine = m;
    } else if (b) {
      if (this.freeEnd(b)) {
        this.extend = b;
        this.cells = [{ x: sx, y: sy, z: b.z ?? 0 }];
      } else if (b.built && !b.jump && factory.canBranch(b)) {
        this.splitFrom = b;
      } else {
        this.blocked = true;
      }
    } else if (o && this.freeEnd(o)) {
      this.extend = o;
      this.cells = [{ x: sx, y: sy, z: o.z ?? 0 }];
    } else if (this.usable(sx, sy, level)) {
      this.cells = [{ x: sx, y: sy, z: level }];
    } else {
      this.blocked = true;
    }
    // On part d'un tapis existant : le tracé reste à son étage (jusqu'au bouton d'étage).
    const from = this.extend ?? this.splitFrom;
    if (from) this.level = (from.z ?? 0) as 0 | 1;
  }

  /** Un bout de tapis libre (qui ne donne dans rien) se prolonge ; s'il donne dans une machine, on part en dérivation. */
  private freeEnd(b: Belt): boolean {
    const n = this.factory.next(b);
    return !n || (n.kind !== 'belt' && !(n.kind === 'machine' && b.built && !b.jump));
  }

  private usable(x: number, y: number, z: 0 | 1): boolean {
    // On construit aussi dans le brouillard. En hauteur, on passe au-dessus des tapis du sol (pas des machines).
    return this.factory.isFree(x, y, z);
  }

  private occupied(x: number, y: number, z: 0 | 1): boolean {
    return !!this.factory.machineAt(x, y) || !!this.factory.beltAt(x, y, z);
  }

  /**
   * Passer de la case c (étage c.z) à (x, y) à l'étage z : un ascenseur si l'étage change.
   * Il lui faut la place : rien à l'ancien étage dans la nouvelle case, ni au nouvel étage dans l'ancienne.
   */
  private liftOk(c: { x: number; y: number; z: 0 | 1 }, x: number, y: number, z: 0 | 1): boolean {
    return c.z === z || (!this.factory.beltAt(x, y, c.z) && !this.factory.beltAt(c.x, c.y, z));
  }

  /** Change l'étage pendant le tracé : les cases suivantes seront à ce niveau. */
  setLevel(level: 0 | 1): void {
    if (level === this.level) return;
    this.level = level;
    // Une seule case posée pour l'instant : elle change d'étage avec.
    if (this.cells.length === 1 && !this.extend && !this.splitJump) {
      const c = this.cells[0];
      const from = this.splitFrom ? { x: this.splitFrom.x, y: this.splitFrom.y, z: (this.splitFrom.z ?? 0) as 0 | 1 } : null;
      if (this.usable(c.x, c.y, level) && (!from || this.liftOk(from, c.x, c.y, level))) { c.z = level; delete c.jump; }
    }
    if (this.lastF) this.move(this.lastF.x, this.lastF.y);
  }

  /** Nombre de cases nouvelles (à construire). */
  get newCount(): number {
    return this.cells.length - (this.extend ? 1 : 0);
  }

  /** Nombre de ponts dans le tracé. */
  get bridgeCount(): number {
    return this.cells.filter((c) => c.jump).length + (this.splitJump ? 1 : 0);
  }

  /** Depuis (x, y), dans le sens d, par-delà des tapis : la première case libre (k cases plus loin), ou 0. */
  private landing(x: number, y: number, d: Dir): number {
    for (let k = 1; k <= RULES.bridgeSpan + 1; k++) {
      const cx = x + DX[d] * k, cy = y + DY[d] * k;
      if (this.usable(cx, cy, 0)) return k >= 2 ? k : 0;
      // On n'enjambe que des tapis (pas une machine, ni le tracé lui-même, ni le brouillard).
      if (!this.factory.beltAt(cx, cy) || this.cells.some((p) => p.x === cx && p.y === cy)) return 0;
    }
    return 0;
  }

  /**
   * Peut-on passer par-dessus ce qui bloque, depuis la case c, dans le sens step, vers le doigt (tx, ty) ?
   * Renvoie le nombre de cases enjambées (0 : non).
   */
  private bridgeOver(c: Cell, step: Dir, tx: number, ty: number): number {
    // Les ponts sont au sol ; en hauteur, on passe déjà par-dessus.
    if (!this.bridges || this.level || c.z) return 0;
    // On ne repart pas en arrière, et le bout d'un pont existant ne se rallonge pas.
    const cur = this.currentDir();
    if (cur !== null && step === opposite(cur)) return 0;
    if (this.extend && this.cells.length === 1 && this.extend.jump) return 0;
    const ahead = (tx - c.x) * DX[step] + (ty - c.y) * DY[step];
    const k = this.landing(c.x, c.y, step);
    return k && ahead >= k ? k - 1 : 0;
  }

  /** Nombre d'ascenseurs (changements d'étage) dans le tracé. */
  get liftCount(): number {
    const c = this.cells;
    let n = 0;
    for (let i = 1; i < c.length; i++) if (c[i].z !== c[i - 1].z) n++;
    if (this.splitFrom && c.length && c[0].z !== (this.splitFrom.z ?? 0)) n++;
    const last = c[c.length - 1], t = this.endTarget;
    if (last && t && !this.factory.machineAt(t.x, t.y) && !this.factory.beltAt(t.x, t.y, last.z)) n++;
    return n;
  }

  /** Le bout d'un tapis se tourne simplement vers une machine (ou un tapis) collée, sans case nouvelle. */
  get turnsOnly(): boolean {
    return !!this.extend && this.cells.length === 1 && this.endTarget !== null && !this.extend.jump
      && dirBetween(this.extend.x, this.extend.y, this.endTarget.x, this.endTarget.y) !== this.extend.dir;
  }

  get valid(): boolean {
    if (this.turnsOnly) return true;
    return this.newCount >= 1 && (this.cells.length >= 2 || this.endTarget !== null || this.startMachine !== null || this.splitFrom !== null);
  }

  /** Sens de la dérivation créée, s'il y en a une. */
  get splitDir(): Dir | null {
    return this.splitFrom ? this.startDir : null;
  }

  move(fx: number, fy: number): void {
    this.lastF = { x: fx, y: fy };
    if (this.blocked && this.cells.length === 0 && !this.splitFrom) return;
    const L = this.level;
    const sb = this.splitFrom;
    // Dérivation en pont : le doigt revient en deçà de la case d'arrivée, on repart de zéro.
    if (sb && this.splitJump && this.startDir !== null) {
      const ahead = (fx - (sb.x + 0.5)) * DX[this.startDir] + (fy - (sb.y + 0.5)) * DY[this.startDir];
      if (ahead < this.splitJump + 0.6) { this.cells = []; this.splitJump = 0; this.endTarget = null; }
    }
    if (sb && this.cells.length === 0) {
      this.blocked = false;
      // Dérivation : la première case part sur un côté libre du tapis.
      const dx = fx - (sb.x + 0.5), dy = fy - (sb.y + 0.5);
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.8) return;
      const d: Dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      this.intoMachine = null;
      if (d === sb.dir || d === opposite(sb.inDir) || this.factory.nodeOutputs(sb).some((o) => o.d === d)) return;
      const x = sb.x + DX[d], y = sb.y + DY[d];
      if (this.factory.machineAt(x, y)) { this.intoMachine = d; this.blocked = true; return; }
      const sz = (sb.z ?? 0) as 0 | 1;
      const free = this.usable(x, y, L) && this.liftOk({ x: sb.x, y: sb.y, z: sz }, x, y, L);
      if (!free) {
        // Un tapis collé sur ce côté : avec les ponts (au sol), la dérivation passe par-dessus quand le doigt va au-delà.
        const k = this.bridges && !L && !sz && this.factory.beltAt(x, y) ? this.landing(sb.x, sb.y, d) : 0;
        const ahead = (fx - (sb.x + 0.5)) * DX[d] + (fy - (sb.y + 0.5)) * DY[d];
        if (!k || ahead < k - 0.4) { this.blocked = true; return; }
        this.startDir = d;
        this.splitJump = k - 1;
        this.cells.push({ x: sb.x + DX[d] * k, y: sb.y + DY[d] * k, z: 0 });
        return;
      }
      this.startDir = d;
      this.cells.push({ x, y, z: L });
    }
    const m = this.startMachine;
    if (m && this.cells.length === 0) {
      const cx = Math.floor(fx), cy = Math.floor(fy);
      this.linkBelt = null;
      this.linkDir = null;
      this.linkMachine = null;
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
      // Une autre machine est collée à cet endroit : liaison directe.
      const lm = this.factory.machineAt(x, y);
      if (lm && lm !== m) { this.linkMachine = lm; this.blocked = true; return; }
      // Un tapis longe la machine à cet endroit : on propose de les relier par le côté.
      const lb = this.factory.beltAt(x, y, L);
      if (lb && lb.jump) { this.blocked = true; return; }
      if (lb) {
        const toMachine = opposite(this.startDir as Dir);
        const intoMachine = lb.dir === toMachine;
        const fromMachine = opposite(lb.inDir) === toMachine;
        if (!intoMachine && !fromMachine) { this.linkBelt = lb; this.linkDir = toMachine; }
        this.blocked = true;
        return;
      }
      if (!this.usable(x, y, L)) { this.blocked = true; return; }
      this.cells.push({ x, y, z: L });
    }
    if (this.cells.length === 0) return;

    // Le doigt repasse sur une case déjà tracée : le tracé reprend de là (inutile de revenir case par case).
    const fx0 = Math.floor(fx), fy0 = Math.floor(fy);
    const back = this.cells.findIndex((c) => c.x === fx0 && c.y === fy0);
    if (back >= 0 && back < this.cells.length - 1) {
      this.cells.length = back + 1;
      delete this.cells[back].jump;
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
      if (prev && ((prev.x === nx && prev.y === ny) || (prev.jump && d !== null && step === opposite(d)))) {
        // Retour en arrière : on efface la dernière case (sauf la case prolongée), et le pont qui y menait.
        if (this.extend && this.cells.length === 1) break;
        this.cells.pop();
        delete this.cells[this.cells.length - 1].jump;
        continue;
      }
      if (this.cells.some((p) => p.x === nx && p.y === ny)) { this.blocked = true; break; }
      // Le doigt s'arrête sur un tapis de l'autre étage (et rien à celui-ci) : un ascenseur le rejoint.
      // S'il va au-delà, on passe au-dessus (ou en dessous).
      if (nx === tx && ny === ty && this.factory.beltAt(nx, ny, L ? 0 : 1) && !this.factory.beltAt(nx, ny, L)) {
        this.endTarget = { x: nx, y: ny };
        break;
      }
      if (!this.usable(nx, ny, L)) {
        // Un tapis en travers, et le doigt continue au-delà : un pont passe par-dessus.
        const j = this.bridgeOver(c, step, tx, ty);
        if (j > 0) {
          c.jump = j;
          this.cells.push({ x: c.x + DX[step] * (j + 1), y: c.y + DY[step] * (j + 1), z: 0 });
          continue;
        }
        if (this.occupied(nx, ny, L)) this.endTarget = { x: nx, y: ny };
        else this.blocked = true;
        break;
      }
      if (!this.liftOk(c, nx, ny, L)) { this.blocked = true; break; }
      this.cells.push({ x: nx, y: ny, z: L });
    }
    // Un tapis ne se branche pas sur lui-même ni sur la machine d'où il part s'il n'a qu'une case.
    if (this.endTarget && this.startMachine && this.cells.length === 1 && this.factory.machineAt(this.endTarget.x, this.endTarget.y) === this.startMachine) {
      this.endTarget = null;
    }
  }

  private currentDir(): Dir | null {
    const n = this.cells.length;
    if (n >= 2) return dirToward(this.cells[n - 2].x, this.cells[n - 2].y, this.cells[n - 1].x, this.cells[n - 1].y);
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
      if (i < n - 1) dir = dirToward(c.x, c.y, this.cells[i + 1].x, this.cells[i + 1].y)!;
      else if (this.endTarget) dir = dirBetween(c.x, c.y, this.endTarget.x, this.endTarget.y)!;
      else dir = this.currentDir() ?? 0;
      let inDir: Dir;
      if (i > 0) inDir = dirToward(this.cells[i - 1].x, this.cells[i - 1].y, c.x, c.y)!;
      else if (this.extend) inDir = this.extend.inDir;
      else if (this.startDir !== null) inDir = this.startDir;
      else inDir = dir;
      out.push({ x: c.x, y: c.y, dir, inDir, existing: i === 0 && !!this.extend, ...(c.jump ? { jump: c.jump } : {}), ...(c.z ? { z: 1 as const } : {}) });
    }
    return out;
  }
}
