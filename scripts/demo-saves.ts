// Parties d'essai à différents niveaux d'avancement, sous forme de codes à importer (menu principal → Importer un code).
// node --experimental-strip-types --no-warnings scripts/demo-saves.ts > saves.json
import { Game } from '../src/sim/game.ts';
import { ALL_NODES } from '../src/data/unlocks.ts';
import { MAX_PALIER } from '../src/data/paliers.ts';
import { encodeSave } from '../src/save/code.ts';
import { BaseBuilder } from './demo-bases.ts';
import type { Machine } from '../src/sim/factory.ts';

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
    about: 'Une base qui tourne déjà : deux lignes de fer (plaques et vis), une de cuivre (fil), le charbon monté au tapis jusqu’à une station. Presse, tour, tréfileuse, fourneau, chenilles et antenne débloqués.',
    items: { charbon: 300, lingot_fer: 300, lingot_cuivre: 200, plaque_fer: 150, fil_cuivre: 150, vis: 100 },
  },
  {
    id: 'p4', title: 'Palier 4 · électricité', seed: 'DEMO-COURANT', palier: 4, money: 25000,
    about: 'La ligne de fer passe au courant : deux générateurs nourris au tapis, des câbles de machine en machine. Plaques et vis deviennent des engrenages. Camions, raffinerie et fabricant débloqués.',
    items: { charbon: 600, carburant: 200, acier: 300, engrenage: 300, cable: 300, moteur: 60, plaque_fer: 300, vis: 300, beton: 200, plastique: 200 },
  },
  {
    id: 'p5', title: 'Palier 5 · logistique', seed: 'DEMO-LOGISTIQUE', palier: 5, money: 60000,
    about: 'En plus : un camion ramène le fer d’un filon riche éloigné jusqu’à un four et une presse, et le calcaire est broyé en ciment. Trains débloqués.',
    items: { charbon: 400, carburant: 400, acier: 400, engrenage: 400, cable: 400, moteur: 150, circuit: 150, processeur: 80, plaque_fer: 300, beton: 200 },
  },
  {
    id: 'fin', title: `Palier ${MAX_PALIER} · fin de partie`, seed: 'DEMO-FIN', palier: MAX_PALIER, money: 250000,
    about: 'Tout l’arbre débloqué (sauf ce qui arrive bientôt). Un train ramène le pétrole d’un filon lointain, raffiné en plastique au courant. Grosses réserves de composants avancés.',
    items: { carburant: 600, acier: 400, engrenage: 400, cable: 400, moteur: 300, circuit: 300, processeur: 200, ordinateur: 100, batterie: 150, panneau_solaire: 100, uranium_enrichi: 50 },
  },
];

/**
 * La base déjà construite, de plus en plus grande selon le palier :
 * - palier 2 : deux lignes de fer (plaques, vis), une de cuivre (fil), le charbon tiré au tapis jusqu'aux stations ;
 * - palier 4 : un générateur nourri au tapis alimente la ligne de fer (passée au courant), les plaques et les vis font des engrenages ;
 * - palier 5 : un camion ramène le fer d'un filon riche éloigné, le calcaire est broyé en ciment ;
 * - fin : un train ramène le pétrole, raffiné en plastique.
 */
function buildBase(g: Game, palier: number): { name: string; m: Machine }[] {
  const b = new BaseBuilder(g);
  const has = (id: string) => g.hasMachine(id);
  const big = has('grand_coffre') ? 'grand_coffre' : 'coffre';
  /** Les bouts de chaîne : la machine qui produit et son coffre. */
  const ends: { name: string; m: Machine }[] = [];
  const end = (src: Machine, name: string, near: { x: number; y: number }) => { const c = b.place(big, near); b.belt(src, c); ends.push({ name, m: src }); return c; };

  // Le charbon : une foreuse le monte au tapis jusqu'à la station du quartier du fer.
  const [c1, c2] = b.drills('charbon', { x: -11, y: 10 }, 2);
  const s1 = b.place('station', { x: -7, y: 3 });
  b.belt(c1, s1);
  // Le fer : deux foreuses, deux fours.
  const [d1, d2] = b.drills('fer', { x: -12, y: -4 }, 2);
  const f1 = b.place('four', { x: -7, y: -10 });
  const f2 = b.place('four', { x: -4, y: -4 });
  b.belt(d1, f1);
  b.belt(d2, f2);
  const p1 = b.place('presse', { x: -6, y: -15 });
  b.belt(f1, p1);
  const t1 = has('tour') ? b.place('tour', { x: 0, y: -9 }) : null;
  if (t1) b.belt(f2, t1);
  let a1: Machine | null = null;
  if (palier >= 3 && t1 && has('assembleur')) {
    // Plaques + vis → engrenages.
    a1 = b.place('assembleur', { x: -2, y: -15 });
    b.belt(p1, a1);
    b.belt(t1, a1);
    end(a1, 'Engrenages', { x: 2, y: -15 });
  } else {
    end(p1, 'Plaques de fer', { x: -10, y: -15 });
    if (t1) end(t1, 'Vis', { x: 4, y: -9 });
    else end(f2, 'Lingots de fer', { x: 0, y: -9 });
  }
  // Le cuivre : foreuse → four → tréfileuse → coffre, avec sa station (pleine de charbon) que les drones du robot rechargent.
  const [cu] = b.drills('cuivre', { x: 16, y: 12 }, 1);
  const f3 = b.place('four', { x: 11, y: 6 });
  b.belt(cu, f3);
  const s2 = b.place('station', { x: 15, y: 4 });
  g.factory.addFuel(s2, 50);
  const w1 = b.place('trefileuse', { x: 9, y: 0 });
  b.belt(f3, w1);
  end(w1, 'Fil de cuivre', { x: 9, y: -5 });
  // Le charbon de réserve, près du Noyau, pour les drones du robot.
  end(c2, 'Charbon', { x: -3, y: 9 });

  if (palier >= 4) {
    // Un générateur nourri au tapis par une troisième foreuse de charbon ; la ligne de fer passe au courant.
    const [c3] = b.drills('charbon', { x: -11, y: 10 }, 1);
    const gen = b.place('generateur', { x: -14, y: 3 });
    b.belt(c3, gen);
    // Un second générateur sur le même réseau, rechargé par le drone de la station.
    const gen2 = b.place('generateur', { x: gen.x, y: gen.y - 4 });
    g.factory.addFuel(gen2, 10);
    b.cable(gen, gen2);
    // Les câbles vont de machine en machine : un seul réseau.
    b.cable(gen, d2); b.cable(d2, d1); b.cable(d1, f1); b.cable(f1, p1); b.cable(d2, f2);
    if (t1) b.cable(f2, t1);
    if (a1) b.cable(p1, a1);
  }

  if (palier >= 5) {
    // Le camion : deux foreuses sur le filon riche du sud-ouest remplissent un dépôt ; l'autre dépôt, près du Noyau,
    // fait partir le fer au tapis vers un four et une presse.
    g.world.reveal(-24, 22, 12);
    const far = b.drills('fer', { x: -26, y: 24 }, 2);
    const da = b.place('depot', { x: -20, y: 20 });
    for (const d of far) b.belt(d, da);
    const db = b.place('depot', { x: 3, y: 14 });
    const line = g.linkStations(da, db);
    if (!line) throw new Error('ligne de camion refusée');
    g.addVehicle(line.id);
    const f5 = b.place('four', { x: 8, y: 16 });
    b.belt(db, f5);
    const p5 = b.place('presse', { x: 12, y: 18 });
    b.belt(f5, p5);
    end(p5, 'Plaques (camion)', { x: 16, y: 20 });
    // Le calcaire, broyé en ciment.
    const [ca] = b.drills('calcaire', { x: 16, y: -10 }, 1);
    const br = b.place('broyeur', { x: 11, y: -12 });
    b.belt(ca, br);
    end(br, 'Ciment', { x: 7, y: -12 });
    const s3 = b.place('station', { x: 14, y: -5 });
    g.factory.addFuel(s3, 50);
  }

  if (palier >= 8) {
    // Le train : le pétrole du filon riche de l'est part en gare, raffiné en plastique près du Noyau.
    g.world.reveal(44, -24, 12);
    const pet = b.drills('petrole', { x: 46, y: -25 }, 2);
    const ga = b.place('gare', { x: 40, y: -20 });
    for (const d of pet) b.belt(d, ga);
    const gb = b.place('gare', { x: 20, y: -2 });
    const line = g.linkStations(ga, gb);
    if (!line) throw new Error('ligne de train refusée');
    const ra = b.place('raffinerie', { x: 24, y: 4 });
    b.belt(gb, ra);
    end(ra, 'Plastique', { x: 28, y: 6 });
    const gen3 = b.place('generateur', { x: 30, y: 0 });
    g.factory.addFuel(gen3, 10);
    b.cable(gen3, ra);
    for (const d of pet) { const gx = b.place('generateur', { x: d.x + 3, y: d.y - 3 }); g.factory.addFuel(gx, 10); b.cable(gx, d); }
  }
  b.finish();
  return ends;
}

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
  const ends = buildBase(g, d.palier);
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
  // La base tourne un peu : les tapis se remplissent, les fours chauffent.
  for (let i = 0; i < 90 * 30; i++) g.tick(1 / 30);
  g.money = d.money;
  const code = await encodeSave(g.serialize());
  // Vérifie qu'elle se recharge, puis qu'elle produit : chaque coffre du bout de chaîne doit se remplir.
  const back = new Game(d.seed, JSON.parse(JSON.stringify(g.serialize())));
  if (back.palier !== d.palier) throw new Error(`${d.id} : palier ${back.palier}`);
  const count = (gg: Game, id: number) => gg.factory.machines.get(id)!.made;
  const before = ends.map((e) => count(back, e.m.id));
  for (let i = 0; i < 240 * 30; i++) back.tick(1 / 30);
  const report = ends.map((e, i) => `${e.name} +${count(back, e.m.id) - before[i]}`);
  const stuck = [...back.factory.machines.values()].filter((m) => ['nofuel', 'nopower', 'noore'].includes(m.status)).map((m) => `${m.type}#${m.id}:${m.status}`);
  console.error(`${d.id} : ${report.join(', ')}${stuck.length ? ` · arrêtées : ${stuck.join(' ')}` : ''}`);
  if (ends.some((e, i) => count(back, e.m.id) - before[i] <= 0)) throw new Error(`${d.id} : une chaîne ne produit pas`);
  return { id: d.id, title: d.title, about: d.about, code, size: code.length };
}

export { buildBase, DEMOS };
const only = process.argv[2];
const out = [];
for (const d of DEMOS) if (!only || only === d.id) out.push(await build(d));
console.log(JSON.stringify(out, null, 2));
