// Gares et dépôts : un bâtiment de 4 × 2 qu'on peut tourner, avec son quai (la voie, 2 cases de large) le long
// du grand côté. Les véhicules entrent par un bout du quai, s'y arrêtent, et repartent par l'autre bout.
import type { Dir } from './geom.ts';

export type Rot = 0 | 1 | 2 | 3;

export function isStationType(type: string): boolean {
  return type === 'depot' || type === 'gare';
}

/** Un point du quadrillage (les coins des cases) : les voies passent au milieu de leurs 2 cases. */
export interface Pt { x: number; y: number }

export interface StationGeo {
  /** Les 4 × 2 cases du quai (réservées : ni tapis ni machine). */
  quay: Pt[];
  /** Bouts de la voie à quai (entrée, sortie) et l'endroit où le véhicule s'arrête, sur le quadrillage. */
  entry: Pt;
  exit: Pt;
  dock: Pt;
  /** Sens de la voie à quai. */
  dir: Dir;
}

/** Taille d'un bâtiment tourné : les quarts de tour échangent largeur et hauteur. */
export function rotDims(w: number, h: number, rot: number): { w: number; h: number } {
  return rot % 2 ? { w: h, h: w } : { w, h };
}

/**
 * Le quai d'une gare (ou d'un dépôt) dont le coin haut gauche est en x, y. Sans tourner : le bâtiment fait 4 × 2,
 * le quai est dessous et l'on roule vers l'est ; chaque quart de tour (sens des aiguilles) fait pivoter le tout.
 */
export function stationGeo(x: number, y: number, rot: Rot): StationGeo {
  const quay: Pt[] = [];
  const cells = (x0: number, y0: number, w: number, h: number) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) quay.push({ x: x0 + i, y: y0 + j }); };
  switch (rot) {
    case 1:
      cells(x - 2, y, 2, 4);
      return { quay, entry: { x: x - 1, y }, exit: { x: x - 1, y: y + 4 }, dock: { x: x - 1, y: y + 2 }, dir: 1 };
    case 2:
      cells(x, y - 2, 4, 2);
      return { quay, entry: { x: x + 4, y: y - 1 }, exit: { x, y: y - 1 }, dock: { x: x + 2, y: y - 1 }, dir: 2 };
    case 3:
      cells(x + 2, y, 2, 4);
      return { quay, entry: { x: x + 3, y: y + 4 }, exit: { x: x + 3, y }, dock: { x: x + 3, y: y + 2 }, dir: 3 };
    default:
      cells(x, y + 2, 4, 2);
      return { quay, entry: { x, y: y + 3 }, exit: { x: x + 4, y: y + 3 }, dock: { x: x + 2, y: y + 3 }, dir: 0 };
  }
}

/** Cadre du bâtiment et de son quai (pour centrer et cadrer). */
export function stationBox(x: number, y: number, rot: Rot): { x: number; y: number; w: number; h: number } {
  switch (rot) {
    case 1: return { x: x - 2, y, w: 4, h: 4 };
    case 2: return { x, y: y - 2, w: 4, h: 4 };
    case 3: return { x, y, w: 4, h: 4 };
    default: return { x, y, w: 4, h: 4 };
  }
}
