// Tracé des câbles au doigt : comme les tapis (lignes droites, virages à angle droit),
// mais un câble passe partout (même dans le brouillard), sous les tapis et sous les machines.
import { DX, DY, type Dir } from './geom.ts';
import type { World } from '../world/world.ts';

/** Marge (en cases) avant qu'un léger écart du doigt ne crée un virage. */
const HYSTERESIS = 0.85;

export class CableTracer {
  cells: { x: number; y: number }[] = [];
  /** Le tracé est bloqué (plus utilisé : on construit aussi dans le brouillard). */
  blocked = false;

  constructor(_world: World, fx: number, fy: number) {
    const x = Math.floor(fx), y = Math.floor(fy);
    this.cells.push({ x, y });
  }

  private dir(): Dir | null {
    const n = this.cells.length;
    if (n < 2) return null;
    const a = this.cells[n - 2], b = this.cells[n - 1];
    return (b.x > a.x ? 0 : b.y > a.y ? 1 : b.x < a.x ? 2 : 3) as Dir;
  }

  move(fx: number, fy: number): void {
    if (!this.cells.length) return;
    const last = this.cells[this.cells.length - 1];
    let tx = Math.floor(fx), ty = Math.floor(fy);
    const cur = this.dir();
    if (cur !== null) {
      if (DY[cur] === 0 && Math.abs(fy - (last.y + 0.5)) < HYSTERESIS) ty = last.y;
      if (DX[cur] === 0 && Math.abs(fx - (last.x + 0.5)) < HYSTERESIS) tx = last.x;
    }
    // Le doigt repasse sur une case déjà tracée : on reprend de là.
    const back = this.cells.findIndex((c) => c.x === tx && c.y === ty);
    if (back >= 0) { this.cells.length = back + 1; this.blocked = false; return; }
    this.blocked = false;
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
      this.cells.push({ x: nx, y: ny });
    }
  }
}
