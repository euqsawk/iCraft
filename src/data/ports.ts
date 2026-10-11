// Entrées et sorties imposées des machines de production : chaque machine a ses emplacements,
// fixés par son type et son orientation. Le seul moyen de les changer est de tourner la machine.
//
// Orientation 0 : les entrées à gauche, la sortie à droite, l'entrée du charbon en haut.
// Chaque quart de tour (dans le sens des aiguilles d'une montre) fait tourner le tout autour de la machine.
import { baseType } from './machines.ts';
import type { Dir } from '../sim/geom.ts';

/** Entrée d'ingrédients, sortie, ou entrée du charbon (combustible seulement). */
export type PortIO = 'in' | 'out' | 'fuel';

/** Un emplacement, en case dehors relative au coin haut-gauche de la machine (orientation 0). */
export interface PortSpec { rx: number; ry: number; io: PortIO }

/** Un emplacement après rotation : la case dehors, et le sens qui va de la machine vers elle. */
export interface FixedPort extends PortSpec { d: Dir }

const IN = (rx: number, ry: number): PortSpec => ({ rx, ry, io: 'in' });
const OUT = (rx: number, ry: number): PortSpec => ({ rx, ry, io: 'out' });
const FUEL = (rx: number, ry: number): PortSpec => ({ rx, ry, io: 'fuel' });

// Machines de 2 × 2 : les entrées à gauche (rangée du haut d'abord), la sortie à droite sur la rangée du haut
// (alignée avec la première entrée de la machine suivante), le charbon en haut à gauche.
const ONE_IN = [IN(-1, 0), OUT(2, 0), FUEL(0, -1)];
const TWO_IN = [IN(-1, 0), IN(-1, 1), OUT(2, 0), FUEL(0, -1)];
const THREE_IN = [IN(-1, 0), IN(-1, 1), IN(0, 2), OUT(2, 0), FUEL(0, -1)];

const LAYOUTS: Record<string, PortSpec[]> = {
  foreuse: [OUT(2, 0), FUEL(0, -1)],
  super_foreuse: [OUT(4, 0), FUEL(0, -1)],
  four: ONE_IN,
  presse: ONE_IN,
  tour: ONE_IN,
  trefileuse: ONE_IN,
  broyeur: ONE_IN,
  raffinerie: ONE_IN,
  centrifugeuse: ONE_IN,
  haut_fourneau: TWO_IN,
  melangeur: TWO_IN,
  assembleur: TWO_IN,
  fabricant: THREE_IN,
  generateur: [FUEL(0, -1)],
};

/** La machine a-t-elle des entrées et sorties imposées ? */
export function hasFixedPorts(type: string): boolean {
  return !!LAYOUTS[baseType(type)];
}

/** Les emplacements de la machine en orientation 0 (ou rien). */
export function portLayout(type: string): PortSpec[] | null {
  return LAYOUTS[baseType(type)] ?? null;
}

/** Fait tourner une case (relative à une machine carrée de côté `size`) d'un quart de tour, `rot` fois. */
export function rotateCell(rx: number, ry: number, size: number, rot: number): { rx: number; ry: number } {
  let x = rx, y = ry;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) { const nx = size - 1 - y; y = x; x = nx; }
  return { rx: x, ry: y };
}

/** Le sens qui va de la machine vers une case dehors posée sur un de ses côtés. */
export function outwardDir(rx: number, ry: number, w: number, h: number): Dir {
  if (rx >= w) return 0;
  if (ry >= h) return 1;
  if (rx < 0) return 2;
  return 3;
}

/** Les emplacements de la machine dans son orientation (cases dehors relatives à son coin). */
export function fixedPorts(type: string, rot: number, w: number, h: number): FixedPort[] {
  const base = portLayout(type);
  if (!base) return [];
  const size = Math.max(w, h);
  return base.map((p) => {
    const r = rotateCell(p.rx, p.ry, size, rot);
    return { rx: r.rx, ry: r.ry, io: p.io, d: outwardDir(r.rx, r.ry, w, h) };
  });
}
