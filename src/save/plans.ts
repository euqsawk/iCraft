// Plans d'ateliers : enregistrés sur l'appareil, ils servent dans toutes les parties.
import type { FactorySave } from '../sim/factory.ts';

export interface AtelierPlan {
  id: string;
  name: string;
  size: number;
  save: FactorySave;
  /** Machines rangées (hors entrées et sorties), pour l'affichage. */
  machines: number;
}

const KEY = 'uf-plans';

export function loadPlans(): AtelierPlan[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && p.save) : [];
  } catch {
    return [];
  }
}

export function savePlans(list: AtelierPlan[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
