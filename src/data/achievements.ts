// Les succès : de petits objectifs qui marquent la progression. Ils se cochent tout seuls.
import type { Game } from '../sim/game.ts';
import type { Factory } from '../sim/factory.ts';

export interface Achievement {
  id: string;
  name: string;
  hint: string;
  test: (g: Game) => boolean;
}

const made = (g: Game, k: string) => g.factory.stats.made[k] ?? 0;
const totalMade = (g: Game) => Object.values(g.factory.stats.made).reduce((a, b) => a + b, 0);
const anyMachine = (f: Factory, test: (type: string) => boolean): boolean => {
  for (const m of f.machines.values()) {
    if (m.built && test(m.type)) return true;
    if (m.inner && anyMachine(m.inner, test)) return true;
  }
  return false;
};
const count = (f: Factory): number => {
  let n = 0;
  for (const m of f.machines.values()) { if (m.built) n++; if (m.inner) n += count(m.inner); }
  return n;
};
const nested = (f: Factory, depth = 0): number => {
  let best = depth;
  for (const m of f.machines.values()) if (m.inner) best = Math.max(best, nested(m.inner, depth + 1));
  return best;
};

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'lingot', name: 'Premier lingot', hint: 'Fondre un lingot de fer dans un four.', test: (g) => made(g, 'lingot_fer') >= 1 },
  { id: 'plaques100', name: 'Cent plaques', hint: 'Presser 100 plaques de fer.', test: (g) => made(g, 'plaque_fer') >= 100 },
  { id: 'plaques1000', name: 'Mille plaques', hint: 'Presser 1 000 plaques de fer.', test: (g) => made(g, 'plaque_fer') >= 1000 },
  { id: 'nuit', name: 'Première nuit', hint: 'Voir tomber la nuit sur l’usine.', test: (g) => g.played >= 480 * 0.68 },
  { id: 'palier3', name: 'Ça grandit', hint: 'Atteindre le palier 3.', test: (g) => g.palier >= 3 },
  { id: 'electricite', name: 'Au courant', hint: 'Faire tourner une machine à l’électricité.', test: (g) => [...g.factory.machines.values()].some((m) => g.factory.powered(m)) },
  { id: 'solaire', name: 'Coup de soleil', hint: 'Poser un panneau solaire.', test: (g) => anyMachine(g.factory, (t) => t === 'solaire') },
  { id: 'camion', name: 'En route', hint: 'Ouvrir une ligne de camions.', test: (g) => [...g.factory.lines.values()].some((l) => l.kind === 'camion') },
  { id: 'train', name: 'Tchou tchou', hint: 'Ouvrir une ligne de train.', test: (g) => [...g.factory.lines.values()].some((l) => l.kind === 'train') },
  { id: 'atelier', name: 'Usine dans l’usine', hint: 'Créer un atelier.', test: (g) => anyMachine(g.factory, (t) => t === 'atelier') },
  { id: 'fractale', name: 'Fractale', hint: 'Un atelier dans un atelier.', test: (g) => nested(g.factory) >= 2 },
  { id: 'machines50', name: 'Cinquante machines', hint: 'Avoir 50 bâtiments construits.', test: (g) => count(g.factory) >= 50 },
  { id: 'objets10k', name: 'Dix mille', hint: 'Fabriquer ou extraire 10 000 objets en tout.', test: (g) => totalMade(g) >= 10000 },
  { id: 'loin', name: 'Explorateur', hint: 'Emmener le robot à 100 cases du Noyau.', test: (g) => Math.hypot(g.robot.x - 2, g.robot.y - 2) >= 100 },
  { id: 'palier5', name: 'À mi-chemin', hint: 'Atteindre le palier 5.', test: (g) => g.palier >= 5 },
  { id: 'palier8', name: 'Le Noyau est complet', hint: 'Atteindre le palier 8.', test: (g) => g.palier >= 8 },
];
