// La case carburant (machines, robot, drones) : du charbon et du carburant mélangés.
// Le carburant brûle en premier et dure 5 fois plus longtemps qu'un charbon.
import { RULES } from '../config.ts';

export interface FuelSlot {
  /** Objets dans la case (charbon et carburant). */
  fuel: number;
  /** Secondes restantes de l'objet en train de brûler. */
  burn: number;
  /** Parmi eux, le carburant. */
  carb?: number;
}

/** Charbon de la case (le reste n'est pas du carburant). */
export function coalIn(s: FuelSlot): number {
  return s.fuel - (s.carb ?? 0);
}

/** Brûle un objet de la case pour `seconds` (multiplié pour le carburant) ; renvoie ce qui brûle, ou null si vide. */
export function burnOne(s: FuelSlot, seconds: number): 'carburant' | 'charbon' | null {
  if (s.fuel <= 0) return null;
  s.fuel--;
  if ((s.carb ?? 0) > 0) {
    s.carb!--;
    s.burn += seconds * RULES.carburantMult;
    return 'carburant';
  }
  s.burn += seconds;
  return 'charbon';
}

/** Ajoute n objets de ce type. */
export function addTo(s: FuelSlot, n: number, item: string): void {
  if (n <= 0) return;
  s.fuel += n;
  if (item === 'carburant') s.carb = (s.carb ?? 0) + n;
}

/** Retire jusqu'à n objets d'un type (en laissant `keep` objets dans la case) ; renvoie la quantité prise. */
export function takeOf(s: FuelSlot, n: number, item: string, keep = 0): number {
  const have = item === 'carburant' ? s.carb ?? 0 : coalIn(s);
  const k = Math.max(0, Math.min(n, have, s.fuel - keep));
  s.fuel -= k;
  if (item === 'carburant') s.carb = (s.carb ?? 0) - k;
  return k;
}

/** Passe jusqu'à n objets d'une case à une autre, le carburant d'abord ; renvoie la quantité passée. */
export function moveFuel(from: FuelSlot, to: FuelSlot, n: number): number {
  const c = takeOf(from, n, 'carburant');
  addTo(to, c, 'carburant');
  const k = takeOf(from, n - c, 'charbon');
  addTo(to, k, 'charbon');
  return c + k;
}
