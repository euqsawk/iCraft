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
/** Un éclair jaune cerné d'encre, centré en (x, y), de hauteur environ 16 * s. */
export function drawBolt(g: Graphics, x: number, y: number, s = 1): void {
  const p = [1, -8, -5, 1, -0.5, 1, -2, 8, 5, -2, 0.5, -2].map((v, i) => (i % 2 ? y : x) + v * s);
  g.poly(p).fill(PALETTE.yellow).stroke({ width: 1.6 * Math.max(0.8, s), color: PALETTE.ink, join: 'round' });
}

export function drawMachineIcon(g: Graphics, type: string, ore?: string): void {
  const ink = PALETTE.ink, coral = PALETTE.coral;
  const st = { width: 3, color: ink, cap: 'round' as const, join: 'round' as const };
  switch (type) {
    case 'pompe':
      g.roundRect(-12, -6, 24, 16, 4).fill(0x7cc3f0).stroke({ width: 2.6, color: ink });
      g.rect(-3, -14, 6, 9).fill(ink);
      g.moveTo(-8, 3).quadraticCurveTo(-4, -1, 0, 3).quadraticCurveTo(4, 7, 8, 3).stroke({ width: 2, color: 0xffffff, cap: 'round' });
      break;
    case 'centrale': {
      // Une tour de refroidissement et l'atome.
      g.moveTo(-14, 18).quadraticCurveTo(-8, 0, -12, -16).lineTo(12, -16).quadraticCurveTo(8, 0, 14, 18).closePath().fill(0xdfe7ee).stroke({ width: 3, color: ink, join: 'round' });
      g.circle(0, 2, 4).fill(0x7fa33b).stroke({ width: 1.8, color: ink });
      g.ellipse(0, 2, 10, 4).stroke({ width: 1.6, color: ink });
      break;
    }
    case 'recharge':
      g.roundRect(-12, -9, 24, 18, 5).fill(0xffffff).stroke({ width: 2.6, color: ink });
      g.moveTo(-6, -2).lineTo(6, -2).moveTo(0, -2).lineTo(0, -6).stroke({ width: 2, color: ink, cap: 'round' });
      drawBolt(g, 0, 4, 0.5);
      break;
    case 'hangar':
      g.moveTo(-20, 12).lineTo(-20, -2).quadraticCurveTo(0, -22, 20, -2).lineTo(20, 12).closePath().fill(0xdfe7ee).stroke({ width: 3, color: ink, join: 'round' });
      g.rect(-9, 0, 18, 12).fill(0x8a99ad);
      g.circle(0, -8, 4.5).fill(0xffffff).stroke({ width: 2, color: coral });
      break;
    case 'lampadaire':
      g.moveTo(0, 9).lineTo(0, -5).stroke({ width: 2.4, color: ink, cap: 'round' });
      g.moveTo(-4, 9).lineTo(4, 9).stroke({ width: 2.4, color: ink, cap: 'round' });
      g.circle(0, -7, 4).fill(PALETTE.yellow).stroke({ width: 1.8, color: ink });
      break;
    case 'entrepot':
      g.poly([-22, -6, 0, -20, 22, -6]).fill(0xc98a4b).stroke({ width: 3, color: ink, join: 'round' });
      g.rect(-18, -6, 36, 24).fill(0xe8d3b4).stroke({ width: 3, color: ink });
      g.rect(-8, 4, 16, 14).fill(0x8a5a2b);
      break;
    case 'solaire': {
      // Un panneau bleu quadrillé, et un petit soleil.
      g.roundRect(-14, -9, 26, 20, 3).fill(0x3a6ea5).stroke({ width: 2.4, color: ink });
      g.moveTo(-14, 1).lineTo(12, 1).moveTo(-5.3, -9).lineTo(-5.3, 11).moveTo(3.3, -9).lineTo(3.3, 11).stroke({ width: 1.4, color: 0xa9d0f5 });
      g.circle(12, -11, 5).fill(PALETTE.yellow).stroke({ width: 1.6, color: ink });
      break;
    }
    case 'batterie':
      g.roundRect(-9, -12, 18, 25, 4).fill(0xffffff).stroke({ width: 2.6, color: ink });
      g.rect(-4, -15, 8, 3).fill(ink);
      g.roundRect(-6, 1, 12, 9, 2).fill(PALETTE.green);
      drawBolt(g, 0, -4, 0.55);
      break;
    case 'atelier': {
      // Un module : des carrés emboîtés (l'usine dans l'usine).
      g.roundRect(-16, -16, 32, 32, 7).stroke({ width: 3, color: ink });
      g.roundRect(-9, -9, 18, 18, 4).stroke({ width: 2.6, color: coral });
      g.roundRect(-3.5, -3.5, 7, 7, 2).fill(ink);
      break;
    }
    case 'entree':
      g.roundRect(-8, -8, 16, 16, 4).fill(0xe3f3dd).stroke({ width: 2, color: PALETTE.green });
      g.moveTo(-4, 0).lineTo(4, 0).moveTo(1, -3.5).lineTo(4.5, 0).lineTo(1, 3.5).stroke({ width: 2.4, color: PALETTE.green, cap: 'round', join: 'round' });
      break;
    case 'sortie':
      g.roundRect(-8, -8, 16, 16, 4).fill(0xfde3dc).stroke({ width: 2, color: coral });
      g.moveTo(-4, 0).lineTo(4, 0).moveTo(1, -3.5).lineTo(4.5, 0).lineTo(1, 3.5).stroke({ width: 2.4, color: coral, cap: 'round', join: 'round' });
      break;
    case 'generateur':
      g.roundRect(-14, -12, 28, 24, 6).fill(ink);
      g.circle(-8, 8, 2).circle(8, 8, 2).fill(PALETTE.ink2);
      drawBolt(g, 0, -1, 1.15);
      break;
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
    case 'depot':
      // Un camion de profil : benne, cabine, roues, sur un quai.
      g.roundRect(-15, 9, 30, 4, 2).fill(PALETTE.ink2);
      g.roundRect(-14, -7, 18, 13, 2.5).fill(0xc98a4b).stroke({ width: 2, color: ink });
      g.moveTo(4, 6).lineTo(4, -3).lineTo(10, -3).lineTo(14, 2).lineTo(14, 6).closePath().fill(PALETTE.yellow).stroke({ width: 2, color: ink, join: 'round' });
      g.circle(-8, 7, 3).circle(9, 7, 3).fill(ink);
      break;
    case 'gare':
      // Une locomotive de profil sur ses rails.
      g.moveTo(-16, 11).lineTo(16, 11).stroke({ width: 2.5, color: PALETTE.ink2, cap: 'round' });
      g.roundRect(-13, -4, 20, 11, 3).fill(PALETTE.coral).stroke({ width: 2, color: ink });
      g.roundRect(3, -11, 9, 18, 2.5).fill(PALETTE.coral).stroke({ width: 2, color: ink });
      g.roundRect(5, -8, 5, 5, 1.2).fill(0xbfe3f2);
      g.rect(-10, -10, 4, 6).fill(ink);
      g.circle(-7, 8, 3).circle(1, 8, 3).circle(9, 8, 3).fill(ink);
      break;
    case 'compteur':
      // Un petit cadran : arc, aiguille, et un tapis dessous.
      g.moveTo(-12, 10).lineTo(12, 10).stroke({ width: 5, color: PALETTE.white, cap: 'round' });
      g.moveTo(-12, 10).lineTo(12, 10).stroke({ width: 1.5, color: PALETTE.roller, cap: 'round' });
      g.arc(0, 4, 11, Math.PI, 0).stroke({ width: 3, color: ink, cap: 'round' });
      g.moveTo(0, 4).lineTo(6, -3).stroke({ width: 2.6, color: coral, cap: 'round' });
      g.circle(0, 4, 2.4).fill(ink);
      break;
    case 'grand_coffre': {
      // Une grosse malle : couvercle bombé, deux sangles, ferrures aux coins et une serrure.
      const wood = 0xc98a4b, dark = 0x8a5a2b;
      g.roundRect(-16, -4, 32, 17, 3).fill(wood);
      g.moveTo(-16, -3).lineTo(-16, -8).quadraticCurveTo(0, -17, 16, -8).lineTo(16, -3).closePath().fill(0xd99a58);
      g.rect(-16, -4.5, 32, 2.6).fill(dark);
      g.rect(-10, -13, 3.2, 26).rect(6.8, -13, 3.2, 26).fill(dark);
      for (const [x, y] of [[-16, 13], [16, 13], [-16, -4], [16, -4]]) g.circle(x * 0.93, y - (y > 0 ? 2 : 0), 1.6).fill(PALETTE.yellow);
      g.roundRect(-3, -6, 6, 7, 1.6).fill(PALETTE.yellow).stroke({ width: 1.3, color: ink });
      g.circle(0, -2.8, 1).fill(ink);
      break;
    }
    case 'coffre':
      g.roundRect(-7.5, -5, 15, 11, 2.5).fill(0xc98a4b);
      g.rect(-7.5, -1.5, 15, 1.6).fill(0x8a5a2b);
      g.roundRect(-1.8, -2.6, 3.6, 3.8, 1).fill(PALETTE.yellow).stroke({ width: 1, color: ink });
      break;
    case 'station':
      // Aire d'atterrissage : un cercle et un H.
      g.circle(0, 0, 12.5).fill(0xffffff).stroke(st);
      g.moveTo(-5, -6).lineTo(-5, 6).moveTo(5, -6).lineTo(5, 6).moveTo(-5, 0).lineTo(5, 0).stroke({ width: 3, color: coral, cap: 'round' });
      break;
    case 'revente':
      // Benne ouverte avec une flèche vers le bas et une pièce.
      g.poly([-13, -4, 13, -4, 10, 12, -10, 12]).fill(0xffffff).stroke({ ...st, join: 'round' });
      g.moveTo(-7, 2).lineTo(-6, 9).moveTo(0, 2).lineTo(0, 9).moveTo(7, 2).lineTo(6, 9).stroke({ width: 2, color: ink, cap: 'round' });
      g.circle(0, -11, 5).fill(PALETTE.yellow).stroke({ width: 1.8, color: ink });
      g.moveTo(-1.2, -13).lineTo(-1.2, -9).stroke({ width: 1.6, color: ink, cap: 'round' });
      break;
    case 'laboratoire': {
      // Fiole : le liquide d'abord (il épouse les parois), le contour par-dessus.
      const half = (y: number) => 4 + ((y + 5) * 9) / 16;
      g.poly([-4, -14, 4, -14, 4, -5, 13, 11, -13, 11, -4, -5]).fill(0xffffff);
      g.poly([-half(2), 2, half(2), 2, half(11), 11, -half(11), 11]).fill(0x8fd3b6);
      g.circle(-2.5, 6, 1.8).fill(0xffffff).circle(3, 4.5, 1.2).fill(0xffffff);
      g.poly([-4, -14, 4, -14, 4, -5, 13, 11, -13, 11, -4, -5]).stroke({ ...st, join: 'round' });
      g.moveTo(-6.5, -14).lineTo(6.5, -14).stroke({ ...st, cap: 'round' });
      g.circle(0.5, -2, 1.4).fill(ink);
      break;
    }
    case 'comptoir':
      // Petite échoppe : auvent rayé et une pièce.
      g.roundRect(-12, -3, 24, 15, 3).fill(0xffffff).stroke(st);
      for (let i = 0; i < 4; i++) g.rect(-13 + i * 6.5, -12, 6.5, 9).fill(i % 2 ? 0xffffff : coral);
      g.roundRect(-13, -12, 26, 9, 2).stroke(st);
      g.circle(0, 5, 4.5).fill(PALETTE.yellow).stroke({ width: 1.6, color: ink });
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
