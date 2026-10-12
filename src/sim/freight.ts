// Le train de fret (mode à cocher au début d'une partie) : posé dès le départ sur son Quai.
// Il repart toutes les 20 minutes : 10 minutes en route, puis 10 minutes à quai. Sa commande est annoncée
// dès son départ précédent ; on remplit son coffre par tapis (avant ou pendant qu'il est à quai).
// À son départ, il prend ce qu'il a demandé dans son coffre. Complet : une prime. Incomplet : l'amende
// annoncée (fixe) ; si les pièces ne suffisent pas, il prélève le reste dans les coffres.
import { item } from '../data/items.ts';
import { PALIERS } from '../data/paliers.ts';
import { hashString, rng } from '../world/rng.ts';

export const FREIGHT_AWAY = 600;
export const FREIGHT_DOCK = 600;

export interface FreightState {
  phase: 'away' | 'here';
  /** Secondes avant le changement de phase (arrivée ou départ). */
  t: number;
  /** Numéro du passage annoncé. */
  visit: number;
  req: Record<string, number>;
  /** L'amende, fixe et annoncée, si le train repart sans tout. */
  fine: number;
  /** La prime si tout est livré. */
  reward: number;
  /** Passages complets d'affilée. */
  streak: number;
  /** Ce qui s'est passé au dernier départ. */
  last?: { ok: boolean; missing: number; paid: number; taxed: number; reward: number };
}

/** Ce que vaut une commande (en pièces) selon le palier. */
export function freightValue(palier: number): number {
  return Math.round(250 * Math.pow(1.8, Math.max(0, palier - 1)));
}

/** La commande d'un passage : 2 objets (3 à partir du palier 4) parmi ce que l'usine sait déjà faire. */
export function freightOrder(seed: string, visit: number, palier: number): Pick<FreightState, 'req' | 'fine' | 'reward'> {
  const rand = rng(hashString(`${seed}:fret:${visit}`));
  // Les objets des deux dernières missions du Noyau déjà faites (au palier 1 : celle en cours, des lingots et des plaques).
  const done = PALIERS.filter((p) => p.to <= Math.max(2, palier)).slice(-2);
  const pool = [...new Set(done.flatMap((p) => Object.keys(p.lines)))];
  const n = Math.min(pool.length, palier < 4 ? 2 : 3);
  const picks: string[] = [];
  while (picks.length < n) {
    const id = pool[Math.floor(rand() * pool.length)];
    if (!picks.includes(id)) picks.push(id);
  }
  const value = freightValue(palier);
  const req: Record<string, number> = {};
  for (const id of picks) req[id] = Math.max(5, Math.round(value / n / Math.max(1, item(id).value) / 5) * 5);
  return { req, fine: Math.round(value), reward: Math.round(value * 1.5) };
}

export function newFreight(seed: string, palier: number): FreightState {
  return { phase: 'away', t: FREIGHT_AWAY, visit: 1, streak: 0, ...freightOrder(seed, 1, palier) };
}

/** Temps lisible : « 7:42 ». */
export function clock(s: number): string {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
