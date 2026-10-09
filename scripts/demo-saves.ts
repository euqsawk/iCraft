// Parties d'essai à différents niveaux d'avancement, sous forme de codes à importer (menu principal → Importer un code).
// node --experimental-strip-types --no-warnings scripts/demo-saves.ts > saves.json
import { Game } from '../src/sim/game.ts';
import { ALL_NODES } from '../src/data/unlocks.ts';
import { MAX_PALIER } from '../src/data/paliers.ts';
import { encodeSave } from '../src/save/code.ts';

interface Demo {
  id: string;
  title: string;
  about: string;
  seed: string;
  palier: number;
  money: number;
  /** Ce qui est rangé dans les grands coffres près du Noyau. */
  items: Record<string, number>;
}

const DEMOS: Demo[] = [
  {
    id: 'p2', title: 'Palier 2 · les débuts', seed: 'DEMO-DEBUTS', palier: 2, money: 3000,
    about: 'Presse, tour, tréfileuse, fourneau, séparateur, station, chenilles et antenne débloqués. De quoi lancer les plaques et les vis.',
    items: { charbon: 300, lingot_fer: 300, lingot_cuivre: 200, plaque_fer: 150, fil_cuivre: 150, vis: 100 },
  },
  {
    id: 'p4', title: 'Palier 4 · électricité', seed: 'DEMO-COURANT', palier: 4, money: 25000,
    about: 'Générateur, câbles et machines électriques, raffinerie, fabricant, camions et dépôts. Des câbles et des moteurs en réserve.',
    items: { charbon: 600, carburant: 200, acier: 300, engrenage: 300, cable: 300, moteur: 60, plaque_fer: 300, vis: 300, beton: 200, plastique: 200 },
  },
  {
    id: 'p5', title: 'Palier 5 · logistique', seed: 'DEMO-LOGISTIQUE', palier: 5, money: 60000,
    about: 'En plus : tapis souterrains, trains et gares, antenne et chenilles III. Grosses réserves pour bâtir loin.',
    items: { charbon: 400, carburant: 400, acier: 400, engrenage: 400, cable: 400, moteur: 150, circuit: 150, processeur: 80, plaque_fer: 300, beton: 200 },
  },
  {
    id: 'fin', title: `Palier ${MAX_PALIER} · fin de partie`, seed: 'DEMO-FIN', palier: MAX_PALIER, money: 250000,
    about: 'Tout l’arbre débloqué (sauf ce qui arrive bientôt), beaucoup de pièces et de composants avancés.',
    items: { carburant: 600, acier: 400, engrenage: 400, cable: 400, moteur: 300, circuit: 300, processeur: 200, ordinateur: 100, batterie: 150, panneau_solaire: 100, uranium_enrichi: 50 },
  },
];

async function build(d: Demo): Promise<{ id: string; title: string; about: string; code: string; size: number }> {
  const g = new Game(d.seed);
  g.tips.off = true;
  g.played = d.palier * 1800;
  g.palier = d.palier;
  for (const n of ALL_NODES) if (n.effect.kind !== 'soon' && n.palier <= d.palier) g.unlocks.add(n.id);
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  g.money = d.money;
  g.world.reveal(Math.round(g.robot.x), Math.round(g.robot.y), 26 + d.palier * 5);
  // Les bâtiments offerts, déjà construits.
  for (const t of ['comptoir', 'laboratoire'] as const) { const m = g.giveBuilding(t); if (m) m.built = true; }
  // Les réserves, dans des grands coffres près du Noyau (300 objets chacun).
  const left = { ...d.items };
  for (let guard = 0; guard < 40 && Object.values(left).some((n) => n > 0); guard++) {
    const spot = g.findGiftSpot('grand_coffre');
    if (!spot) break;
    const c = g.placeMachine('grand_coffre', spot.x, spot.y);
    if (!c) break;
    c.built = true;
    for (const [k, n] of Object.entries(left)) {
      if (n <= 0) continue;
      left[k] -= g.factory.putInStorage(c, k, n);
    }
  }
  g.money = d.money;
  g.pending = [];
  g.factory.markBuilt();
  g.robot.inv.add('charbon', 10);
  // Un tour de simulation pour que tout soit en place (drones, réseaux).
  for (let i = 0; i < 30; i++) g.tick(1 / 30);
  const code = await encodeSave(g.serialize());
  // Vérifie qu'elle se recharge.
  const back = new Game(d.seed, JSON.parse(JSON.stringify(g.serialize())));
  if (back.palier !== d.palier) throw new Error(`${d.id} : palier ${back.palier}`);
  return { id: d.id, title: d.title, about: d.about, code, size: code.length };
}

const out = [];
for (const d of DEMOS) out.push(await build(d));
console.log(JSON.stringify(out, null, 2));
