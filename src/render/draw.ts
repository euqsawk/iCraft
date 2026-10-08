// Dessins vectoriels réutilisables : formes des objets, icônes des machines, pointillés.
import { Graphics } from 'pixi.js';
import { PALETTE } from '../config.ts';
import { item, type ItemShape } from '../data/items.ts';

/** Trace une ligne brisée en pointillés. */
export function dashedPolyline(g: Graphics, pts: { x: number; y: number }[], dash: number, gap: number, closed = false): void {
  const list = closed ? [...pts, pts[0]] : pts;
  let on = true, left = dash;
  for (let i = 0; i < list.length - 1; i++) {
    let ax = list[i].x, ay = list[i].y;
    const bx = list[i + 1].x, by = list[i + 1].y;
    let segLen = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / (segLen || 1), uy = (by - ay) / (segLen || 1);
    while (segLen > 0) {
      const step = Math.min(left, segLen);
      const nx = ax + ux * step, ny = ay + uy * step;
      if (on) { g.moveTo(ax, ay); g.lineTo(nx, ny); }
      ax = nx; ay = ny; segLen -= step; left -= step;
      if (left <= 1e-6) { on = !on; left = on ? dash : gap; }
    }
  }
}

/** Contour d'un rectangle arrondi, en points (pour les pointillés). */
export function roundRectPoints(x: number, y: number, w: number, h: number, r: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  };
  arc(x + w - r, y + r, -Math.PI / 2);
  arc(x + w - r, y + h - r, 0);
  arc(x + r, y + h - r, Math.PI / 2);
  arc(x + r, y + r, Math.PI);
  return pts;
}

/** Forme d'un objet, centrée sur (0, 0). */
export function drawItemShape(g: Graphics, shape: ItemShape, color: number): void {
  const ink = PALETTE.ink;
  switch (shape) {
    case 'ore': {
      const w = 12, h = 11;
      const p = [[0.25, 0], [0.8, 0.08], [1, 0.55], [0.72, 1], [0.12, 0.88], [0, 0.38]];
      g.poly(p.flatMap(([a, b]) => [a * w - w / 2, b * h - h / 2])).fill(color);
      break;
    }
    case 'sand':
      g.circle(-3, 2, 3).circle(3, 2, 3).circle(0, -2.5, 3).fill(color);
      break;
    case 'drop':
      g.moveTo(0, -6).bezierCurveTo(3, -2, 5, 0, 5, 2).arc(0, 2, 5, 0, Math.PI).bezierCurveTo(-5, 0, -3, -2, 0, -6).fill(color);
      break;
    case 'crystal':
      g.poly([0, -6, 5, -1, 0, 6, -5, -1]).fill(color);
      g.poly([0, -6, 5, -1, 0, -1]).fill({ color: 0xffffff, alpha: 0.35 });
      break;
    case 'ingot':
      g.poly([-4.3, -3.5, 4.3, -3.5, 6.5, 3.5, -6.5, 3.5]).fill(color);
      g.rect(-4, -3.5, 8, 1.6).fill({ color: 0xffffff, alpha: 0.3 });
      break;
    case 'plate':
      g.roundRect(-6.5, -2.5, 13, 5, 1.2).fill(color);
      g.rect(-6.5, -2.5, 13, 1.4).fill({ color: 0xffffff, alpha: 0.35 });
      break;
    case 'coil':
      g.circle(0, 0, 5.5).fill(color);
      g.circle(0, 0, 2).fill(0xffffff);
      g.circle(0, 0, 3.8).stroke({ width: 0.8, color: 0xffffff, alpha: 0.4 });
      break;
    case 'screw':
      g.roundRect(-6, -1.6, 9, 3.2, 1).fill(color);
      g.roundRect(3, -3.6, 3.5, 7.2, 1.2).fill(color);
      for (let i = 0; i < 3; i++) g.rect(-5 + i * 2.8, -1.6, 0.9, 3.2).fill({ color: 0xffffff, alpha: 0.45 });
      break;
    case 'gear': {
      const pts: number[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = i % 2 === 0 ? 6 : 4.3;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.poly(pts).fill(color);
      g.circle(0, 0, 1.7).fill(0xffffff);
      break;
    }
    case 'tube':
      g.roundRect(-6.5, -2.6, 13, 5.2, 2.6).fill(color);
      g.circle(4, 0, 1.4).fill({ color: ink, alpha: 0.5 });
      break;
    case 'chip':
      g.roundRect(-4.5, -4.5, 9, 9, 1.5).fill(color);
      for (let i = -1; i <= 1; i++) {
        g.rect(-6.5, i * 2.6 - 0.6, 2, 1.2).fill(ink).rect(4.5, i * 2.6 - 0.6, 2, 1.2).fill(ink);
      }
      g.rect(-1.5, -1.5, 3, 3).fill({ color: 0xffffff, alpha: 0.5 });
      break;
    case 'block':
    default:
      g.roundRect(-5, -5, 10, 10, 3).fill(color);
      g.roundRect(-5, -5, 10, 3.4, 2).fill({ color: 0xffffff, alpha: 0.3 });
      break;
  }
}

export function drawItem(g: Graphics, id: string): void {
  const d = item(id);
  drawItemShape(g, d.shape, d.color);
}

/**
 * Icône d'une machine, centrée sur (0, 0), pour un bâtiment de 48 unités.
 * Les dessins reprennent la maquette (four, presse, générateur…).
 */
export function drawMachineIcon(g: Graphics, type: string, ore?: string): void {
  const ink = PALETTE.ink, coral = PALETTE.coral;
  const st = { width: 3, color: ink, cap: 'round' as const, join: 'round' as const };
  switch (type) {
    case 'foreuse': {
      const c = ore ? item(ore).color : PALETTE.ink2;
      g.poly([-9, -7, 9, -7, 0, 10]).fill(c);
      break;
    }
    case 'four':
      g.moveTo(-12, 13).lineTo(-12, -1).arc(0, -1, 12, Math.PI, 0).lineTo(12, 13).closePath().fill(ink);
      g.moveTo(0, 10).bezierCurveTo(-5, 6, -3, 1, 0, -3).bezierCurveTo(3, 1, 5, 6, 0, 10).fill(coral);
      break;
    case 'presse':
      g.moveTo(-14, -13).lineTo(14, -13).moveTo(0, -13).lineTo(0, 1).moveTo(-6, -5).lineTo(0, 1).lineTo(6, -5).moveTo(-14, 14).lineTo(14, 14).stroke(st);
      break;
    case 'tour':
      g.roundRect(-14, -5, 7, 10, 2).fill(ink);
      g.roundRect(-7, -3, 19, 6, 2).stroke({ ...st, width: 2.5 });
      for (let i = 0; i < 4; i++) g.moveTo(-3 + i * 4, -3).lineTo(-1 + i * 4, 3).stroke({ ...st, width: 2 });
      g.moveTo(-14, 12).lineTo(14, 12).stroke(st);
      break;
    case 'trefileuse':
      g.circle(0, 0, 11).stroke(st);
      g.circle(0, 0, 4).fill(ink);
      g.moveTo(11, 0).lineTo(15, 0).stroke({ ...st, color: 0xd9824a });
      break;
    case 'haut_fourneau':
      g.roundRect(-11, -4, 22, 17, 3).fill(ink);
      g.rect(3, -14, 6, 12).fill(ink);
      g.moveTo(-3, 10).bezierCurveTo(-7, 6, -5, 2, -3, -1).bezierCurveTo(-1, 2, 1, 6, -3, 10).fill(coral);
      break;
    case 'assembleur':
      g.moveTo(-12, 0).lineTo(12, 0).moveTo(0, -12).lineTo(0, 12).stroke({ ...st, width: 3.5 });
      break;
    case 'broyeur':
      g.poly([-13, -6, -8, -12, -3, -6, 2, -12, 7, -6, 12, -12, 13, -6]).stroke(st);
      g.poly([-13, 6, -8, 12, -3, 6, 2, 12, 7, 6, 12, 12, 13, 6]).stroke(st);
      break;
    case 'melangeur':
      g.moveTo(-13, -4).lineTo(-10, 12).lineTo(10, 12).lineTo(13, -4).stroke(st);
      g.moveTo(-6, 2).bezierCurveTo(-2, -4, 2, 8, 6, 2).stroke({ ...st, color: coral });
      break;
    case 'raffinerie':
      g.roundRect(-12, -12, 9, 25, 3).stroke(st);
      g.moveTo(7, -10).bezierCurveTo(10, -5, 13, -2, 13, 2).arc(7, 2, 6, 0, Math.PI).bezierCurveTo(1, -2, 4, -5, 7, -10).fill(ink);
      break;
    case 'fabricant': {
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 === 0 ? 14 : 6;
        pts.push(Math.cos(a) * r, Math.sin(a) * r + 1);
      }
      g.poly(pts).fill(PALETTE.yellow).stroke({ width: 2, color: ink, join: 'round' });
      break;
    }
    case 'centrifugeuse':
      g.circle(0, 0, 12).stroke(st);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        g.moveTo(0, 0).lineTo(Math.cos(a) * 10, Math.sin(a) * 10).stroke({ ...st, color: 0x7fa33b });
      }
      g.circle(0, 0, 3).fill(ink);
      break;
    default:
      g.roundRect(-10, -10, 20, 20, 5).stroke(st);
  }
}

/** Corps blanc arrondi d'une machine, avec son ombre pleine décalée vers le bas. */
export function drawMachineBody(g: Graphics, w: number, h: number, r: number): void {
  g.roundRect(-w / 2, -h / 2 + 4, w, h, r).fill(PALETTE.shadow);
  g.roundRect(-w / 2, -h / 2, w, h, r).fill(PALETTE.white);
}
