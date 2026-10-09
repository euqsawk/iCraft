// Fabrication à la main par le robot : on remonte les recettes jusqu'aux matières qu'il a sur lui.
// Les composants déjà fabriqués (dans l'inventaire) passent avant : on ne refait que ce qui manque.
import { MACHINES, type Recipe } from '../data/machines.ts';

/** À la main, chaque recette prend trois fois plus de temps qu'en machine. */
export const HAND_FACTOR = 3;

export interface CraftStep {
  item: string;
  runs: number;
  machine: string;
  time: number;
}

export interface CraftPlan {
  target: string;
  n: number;
  /** Ce qui est pris dans l'inventaire. */
  consume: Record<string, number>;
  /** Étapes dans l'ordre (les composants d'abord). */
  steps: CraftStep[];
  /** Ce qui sort en plus de la cible (restes d'une recette qui fait plusieurs objets). */
  extra: Record<string, number>;
  /** Durée totale, en secondes. */
  time: number;
}

/** La recette qui fabrique cet objet, parmi les machines débloquées. */
export function recipeFor(item: string, hasMachine: (id: string) => boolean): { machine: string; recipe: Recipe } | null {
  for (const m of Object.values(MACHINES)) {
    if (m.kind !== 'crafter' || !hasMachine(m.id)) continue;
    for (const r of m.recipes) if (r.out[item]) return { machine: m.id, recipe: r };
  }
  return null;
}

/**
 * Prépare la fabrication de n objets à partir de ce qu'on a.
 * Renvoie le plan, ou ce qui manque (en matières premières).
 */
export function planCraft(target: string, n: number, have: Record<string, number>, hasMachine: (id: string) => boolean): { plan: CraftPlan } | { missing: Record<string, number> } {
  const avail: Record<string, number> = { ...have };
  const consume: Record<string, number> = {};
  const surplus: Record<string, number> = {};
  const missing: Record<string, number> = {};
  const steps: CraftStep[] = [];
  const add = (r: Record<string, number>, k: string, v: number) => { if (v) r[k] = (r[k] ?? 0) + v; };

  const need = (item: string, q: number, depth: number, top: boolean): void => {
    if (!top) {
      const s = Math.min(surplus[item] ?? 0, q);
      if (s > 0) { surplus[item] -= s; q -= s; }
      const a = Math.min(avail[item] ?? 0, q);
      if (a > 0) { avail[item] -= a; add(consume, item, a); q -= a; }
    }
    if (q <= 0) return;
    const rf = depth < 8 ? recipeFor(item, hasMachine) : null;
    if (!rf) { add(missing, item, q); return; }
    const outQ = rf.recipe.out[item];
    const runs = Math.ceil(q / outQ);
    for (const [k, v] of Object.entries(rf.recipe.in)) need(k, v * runs, depth + 1, false);
    steps.push({ item, runs, machine: rf.machine, time: rf.recipe.time * runs * HAND_FACTOR });
    for (const [k, v] of Object.entries(rf.recipe.out)) add(surplus, k, v * runs - (k === item ? q : 0));
  };

  if (n <= 0) return { missing: {} };
  need(target, n, 0, true);
  if (Object.keys(missing).length) return { missing };
  const extra: Record<string, number> = {};
  for (const [k, v] of Object.entries(surplus)) if (v > 0) extra[k] = v;
  return { plan: { target, n, consume, steps, extra, time: steps.reduce((s, x) => s + x.time, 0) } };
}

/** Combien d'objets on peut fabriquer au plus (jusqu'à max). */
export function maxCraftable(target: string, have: Record<string, number>, hasMachine: (id: string) => boolean, max = 50): number {
  let lo = 0, hi = max;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ('plan' in planCraft(target, mid, have, hasMachine)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Les objets qu'on sait fabriquer à la main (machines débloquées), du plus simple au plus travaillé. */
export function craftableItems(hasMachine: (id: string) => boolean): string[] {
  const out = new Set<string>();
  for (const m of Object.values(MACHINES)) {
    if (m.kind !== 'crafter' || !hasMachine(m.id)) continue;
    for (const r of m.recipes) for (const k of Object.keys(r.out)) out.add(k);
  }
  return [...out];
}
