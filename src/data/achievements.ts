// Les succès : chacun donne un skin au robot. Ils se cochent tout seuls.
// Deux sortes : des familles à paliers pour les gros trucs à farmer (4 paliers, 4 skins de plus en plus
// poussés), et des succès uniques pour les grandes étapes de l'aventure.
import type { Game } from '../sim/game.ts';
import type { Factory } from '../sim/factory.ts';
import { SKIN, type Rarity } from './skins.ts';

export interface Achievement {
  id: string;
  name: string;
  hint: string;
  /** Le skin qu'il donne. */
  skin: string;
  rarity: Rarity;
  /** Famille à paliers (et rang du palier, de 0 à 3). */
  family?: string;
  tier?: number;
  test: (g: Game) => boolean;
}

export interface Family {
  id: string;
  name: string;
  /** Ce qui est compté. */
  what: string;
  unit: string;
  color: string;
  goals: number[];
  skins: string[];
  value: (g: Game) => number;
}

const made = (g: Game, k: string) => g.factory.stats.made[k] ?? 0;
export const totalMade = (g: Game) => Object.values(g.factory.stats.made).reduce((a, b) => a + b, 0);
const anyMachine = (f: Factory, test: (type: string) => boolean): boolean => {
  for (const m of f.machines.values()) {
    if (m.built && test(m.type)) return true;
    if (m.inner && anyMachine(m.inner, test)) return true;
  }
  return false;
};
/** Bâtiments construits (ceux des ateliers compris). */
export const buildingCount = (f: Factory): number => {
  let n = 0;
  for (const m of f.machines.values()) { if (m.built) n++; if (m.inner) n += buildingCount(m.inner); }
  return n;
};
const nested = (f: Factory, depth = 0): number => {
  let best = depth;
  for (const m of f.machines.values()) if (m.inner) best = Math.max(best, nested(m.inner, depth + 1));
  return best;
};

export const FAMILIES: Family[] = [
  { id: 'fortune', name: 'Fortune', what: 'Pièces gagnées au total', unit: 'pièces', color: '#E0A82E', goals: [100000, 200000, 500000, 1000000], skins: ['tirelire', 'affaires', 'magnat', 'dore'], value: (g) => g.earned },
  { id: 'production', name: 'Production', what: 'Objets fabriqués ou extraits', unit: 'objets', color: '#4B8BD1', goals: [10000, 50000, 250000, 1000000], skins: ['mineur', 'contremaitre', 'foreur', 'cristal'], value: totalMade },
  { id: 'commandes', name: 'Commandes', what: 'Livrées au Comptoir', unit: 'commandes', color: '#F47C64', goals: [10, 50, 200, 500], skins: ['coursier', 'routier', 'loco', 'pirate'], value: (g) => g.ordersDone },
  { id: 'espace', name: 'Espace', what: 'Fusées lancées', unit: 'fusées', color: '#6B4FA0', goals: [1, 5, 20, 50], skins: ['astronaute', 'pilote', 'commandant', 'alien'], value: (g) => g.rockets },
  { id: 'batisseur', name: 'Bâtisseur', what: 'Bâtiments construits en même temps', unit: 'bâtiments', color: '#2E9E6A', goals: [50, 150, 400, 1000], skins: ['apprenti', 'architecte', 'ingenieur', 'batisseur'], value: (g) => buildingCount(g.factory) },
];

export const ROMAN = ['I', 'II', 'III', 'IV'];
const TIER_RARITY: Rarity[] = ['commun', 'rare', 'epique', 'legendaire'];
export const fmtNum = (n: number) => Math.floor(n).toLocaleString('fr-FR').replace(/ | /g, ' ');

const ONCE: Achievement[] = [
  { id: 'nuit', name: 'Première nuit', hint: 'Voir tomber la nuit sur l’usine.', skin: 'nuit', rarity: 'commun', test: (g) => g.played >= 480 * 0.68 },
  { id: 'solaire', name: 'Coup de soleil', hint: 'Poser un panneau solaire.', skin: 'tournesol', rarity: 'commun', test: (g) => anyMachine(g.factory, (t) => t === 'solaire') },
  { id: 'palier3', name: 'Ça grandit', hint: 'Atteindre le palier 3.', skin: 'chat', rarity: 'commun', test: (g) => g.palier >= 3 },
  { id: 'electricite', name: 'Au courant', hint: 'Faire tourner une machine à l’électricité.', skin: 'electricien', rarity: 'rare', test: (g) => [...g.factory.machines.values()].some((m) => g.factory.powered(m)) },
  { id: 'loin', name: 'Explorateur', hint: 'Emmener le robot à 100 cases du Noyau.', skin: 'explorateur', rarity: 'rare', test: (g) => Math.hypot(g.robot.x - 2, g.robot.y - 2) >= 100 },
  { id: 'palier5', name: 'À mi-chemin', hint: 'Atteindre le palier 5.', skin: 'chevalier', rarity: 'rare', test: (g) => g.palier >= 5 },
  { id: 'titane', name: 'Grand Nord', hint: 'Fondre un lingot de titane.', skin: 'nord', rarity: 'rare', test: (g) => made(g, 'lingot_titane') >= 1 },
  { id: 'fractale', name: 'Fractale', hint: 'Un atelier dans un atelier.', skin: 'fractale', rarity: 'legendaire', test: (g) => nested(g.factory) >= 2 },
  { id: 'palier10', name: 'Le Noyau est complet', hint: 'Atteindre le palier 10.', skin: 'neon', rarity: 'legendaire', test: (g) => g.palier >= 10 },
];

const TIERED: Achievement[] = FAMILIES.flatMap((f) => f.goals.map((goal, i): Achievement => ({
  id: `${f.id}${i + 1}`,
  name: `${f.name} ${ROMAN[i]}`,
  hint: `${f.what} : ${fmtNum(goal)} ${f.unit}.`,
  skin: f.skins[i],
  rarity: TIER_RARITY[i],
  family: f.id,
  tier: i,
  test: (g) => f.value(g) >= goal,
})));

export const UNIQUE_ACHIEVEMENTS = ONCE;
export const ACHIEVEMENTS: Achievement[] = [...ONCE, ...TIERED];

/** Le succès qui donne ce skin (aucun pour le Boulon d'origine, offert). */
export const ACHIEVEMENT_OF_SKIN: Record<string, Achievement> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.skin, a]));

/** Anciens succès (avant les skins) devenus des paliers. */
export const OLD_ACHIEVEMENTS: Record<string, string> = { objets10k: 'production1', machines50: 'batisseur1', fusee: 'espace1', fusee5: 'espace2' };

for (const a of ACHIEVEMENTS) if (!SKIN[a.skin]) throw new Error(`skin inconnu : ${a.skin}`);
