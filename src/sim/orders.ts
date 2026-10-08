// Les commandes du Noyau : on en choisit une parmi trois.
import { ITEMS, RAW_IDS, item } from '../data/items.ts';
import { MACHINES } from '../data/machines.ts';
import { rng } from '../world/rng.ts';

export type OrderRarity = 'commune' | 'rare' | 'tres_rare';

export const RARITY_LABEL: Record<OrderRarity, string> = {
  commune: 'Commune',
  rare: 'Rare',
  tres_rare: 'Très rare',
};

export interface OrderLine {
  item: string;
  qty: number;
  done: number;
}

export interface Order {
  id: number;
  rarity: OrderRarity;
  lines: OrderLine[];
  xp: number;
  money: number;
}

/** Objets fabricables avec les machines débloquées et les matières découvertes. */
export function producibleItems(level: number, discovered: Set<string>): Set<string> {
  const ok = new Set<string>(RAW_IDS.filter((r) => discovered.has(r)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of Object.values(MACHINES)) {
      if (!m.buildable || m.unlock > level) continue;
      if (m.fuel && !ok.has(m.fuel.item)) continue;
      for (const rec of m.recipes) {
        if (!Object.keys(rec.in).every((k) => ok.has(k))) continue;
        for (const o of Object.keys(rec.out)) if (!ok.has(o)) { ok.add(o); grew = true; }
      }
    }
  }
  return ok;
}

function roundQty(n: number): number {
  if (n <= 5) return Math.max(1, Math.round(n));
  return Math.max(5, Math.round(n / 5) * 5);
}

function makeLine(id: string, level: number, mult: number): OrderLine {
  const tier = item(id).tier;
  const base = 22 / (1 + tier * 0.9);
  return { item: id, qty: roundQty(base * (1 + level * 0.12) * mult), done: 0 };
}

function rewards(lines: OrderLine[], factor: number): { xp: number; money: number } {
  const v = lines.reduce((s, l) => s + item(l.item).value * l.qty, 0);
  return { xp: Math.round((v * 1.1 + 15) * factor), money: Math.round((v * 1.6 + 10) * factor / 5) * 5 };
}

/** La toute première commande, pour apprendre le jeu. */
export function firstOrder(id: number): Order {
  return { id, rarity: 'commune', lines: [{ item: 'lingot_fer', qty: 10, done: 0 }], xp: 60, money: 80 };
}

/** Trois propositions de commandes. */
export function generateChoices(seed: number, level: number, discovered: Set<string>, startId: number): Order[] {
  const rand = rng(seed);
  const pool = [...producibleItems(level, discovered)].filter((id) => ITEMS[id] && item(id).tier < 7);
  if (pool.length === 0) pool.push('fer');
  const pick = (exclude: Set<string>, minTier = 0): string => {
    const cands = pool.filter((p) => !exclude.has(p) && item(p).tier >= minTier);
    const list = cands.length ? cands : pool;
    const weights = list.map((p) => 1 + item(p).tier * 1.6);
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  };

  const orders: Order[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const roll = rand();
    const rarity: OrderRarity = roll < 0.02 + level * 0.004 ? 'tres_rare' : roll < 0.1 + level * 0.012 ? 'rare' : 'commune';
    const lines: OrderLine[] = [];
    if (rarity === 'commune') {
      const id = pick(used);
      used.add(id);
      lines.push(makeLine(id, level, 1));
    } else {
      const n = rarity === 'rare' ? 2 : 3;
      const local = new Set(used);
      const maxTier = Math.max(...pool.map((p) => item(p).tier));
      for (let k = 0; k < n; k++) {
        const id = pick(local, Math.max(0, maxTier - 2));
        local.add(id);
        lines.push(makeLine(id, level, rarity === 'rare' ? 1.4 : 2));
      }
    }
    const rw = rewards(lines, rarity === 'commune' ? 1 : rarity === 'rare' ? 1.8 : 3.5);
    orders.push({ id: startId + i, rarity, lines, ...rw });
  }
  return orders;
}

export function orderProgress(o: Order): number {
  const total = o.lines.reduce((s, l) => s + l.qty, 0);
  const done = o.lines.reduce((s, l) => s + Math.min(l.done, l.qty), 0);
  return total ? done / total : 0;
}

export function orderComplete(o: Order): boolean {
  return o.lines.every((l) => l.done >= l.qty);
}
