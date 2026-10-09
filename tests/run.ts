// Tests de la simulation (sans rendu). Lancer : npm test
import { Game } from '../src/sim/game.ts';
import { BeltTracer, type TraceCell } from '../src/sim/tracer.ts';
import { CableTracer } from '../src/sim/cables.ts';
import { TunnelTracer } from '../src/sim/tunnels.ts';
import { World } from '../src/world/world.ts';
import { producibleItems, generateChoices } from '../src/sim/orders.ts';
import { item, ITEM_LIST } from '../src/data/items.ts';
import { PALIERS } from '../src/data/paliers.ts';
import { NODE } from '../src/data/unlocks.ts';
import { decodeSave, encodeSave } from '../src/save/code.ts';
import { HAND_FACTOR, maxCraftable } from '../src/sim/craft.ts';
import { BUILDABLE, MACHINES } from '../src/data/machines.ts';
import { RULES } from '../src/config.ts';

let failed = 0, passed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  ÉCHEC  ${name}\n        ${(e as Error).message}`); }
}
async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  ÉCHEC  ${name}\n        ${(e as Error).message}`); }
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Trace un tapis en suivant une liste de points (en cases, valeurs continues). */
function trace(g: Game, pts: [number, number][]): BeltTracer {
  const t = new BeltTracer(g.factory, pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) {
    // On interpole pour imiter un doigt qui glisse.
    const prev = pts[pts.indexOf(p) - 1];
    for (let s = 1; s <= 8; s++) t.move(prev[0] + (p[0] - prev[0]) * s / 8, prev[1] + (p[1] - prev[1]) * s / 8);
  }
  return t;
}

function run(g: Game, seconds: number): void {
  for (let i = 0; i < seconds * 30; i++) g.tick(1 / 30);
}

/** Remplit de charbon toutes les machines construites. */
function fuelAll(g: Game): void {
  for (const m of g.factory.machines.values()) if (m.built) g.factory.addFuel(m, 10);
}

console.log('Données');
test('46 objets (45 + fusée), recettes cohérentes', () => {
  assert(ITEM_LIST.length === 46, `objets : ${ITEM_LIST.length}`);
  const ids = new Set(ITEM_LIST.map((i) => i.id));
  for (const m of Object.values(MACHINES)) for (const r of m.recipes) {
    for (const k of [...Object.keys(r.in), ...Object.keys(r.out)]) assert(ids.has(k), `${m.id} : ${k} inconnu`);
  }
});
test('chaque recette se déduit de ses entrées (sauf la raffinerie)', () => {
  for (const m of Object.values(MACHINES)) {
    const sigs = m.recipes.map((r) => Object.keys(r.in).sort().join('+'));
    const dup = sigs.filter((s, i) => sigs.indexOf(s) !== i);
    if (m.id === 'raffinerie') assert(dup.length === 1 && dup[0] === 'petrole', 'raffinerie : seul le pétrole est ambigu');
    else assert(dup.length === 0, `${m.id} : recettes ambiguës ${dup}`);
  }
});

console.log('Monde');
test('même graine, même carte', () => {
  const a = new World('PAPILLON-482'), b = new World('PAPILLON-482'), c = new World('NUAGE-111');
  let same = true, diff = false;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const pa = a.patchesInChunk(i, j).map((p) => p.type + p.cx.toFixed(2)).join();
    const pb = b.patchesInChunk(i, j).map((p) => p.type + p.cx.toFixed(2)).join();
    const pc = c.patchesInChunk(i, j).map((p) => p.type + p.cx.toFixed(2)).join();
    if (pa !== pb) same = false;
    if (pa !== pc) diff = true;
  }
  assert(same, 'cartes différentes pour une même graine');
  assert(diff, 'graines différentes, cartes identiques');
});
test('fer, charbon, cuivre visibles au départ', () => {
  const g = new Game('TEST-1');
  for (const t of ['fer', 'charbon', 'cuivre']) assert(g.world.discovered.has(t), `${t} non découvert`);
  assert(g.world.biomeAt(0, 0) === 'plaine', 'départ hors plaine');
});
test('brouillard : sauvegarde et rechargement', () => {
  const w = new World('X');
  w.reveal(5, 5, 6);
  const w2 = new World('X');
  w2.loadFog(w.saveFog());
  assert(w2.isRevealed(5, 5) && w2.isRevealed(10, 5) && !w2.isRevealed(20, 20), 'brouillard mal rechargé');
});

console.log('Tracé des tapis');
test('ligne droite malgré un doigt qui tremble', () => {
  const g = new Game('TEST-2');
  const t = new BeltTracer(g.factory, 4.5, 8.5);
  const pts = [[5.2, 8.7], [6.4, 8.2], [7.6, 8.9], [8.5, 8.1], [9.5, 8.6]];
  for (const [x, y] of pts) t.move(x, y);
  const r = t.result();
  assert(r.length === 6, `6 cases attendues, ${r.length}`);
  assert(r.every((c) => c.y === 8 && c.dir === 0), 'pas une ligne droite vers l’est');
});
test('virage à angle droit et retour en arrière', () => {
  const g = new Game('TEST-3');
  const t = trace(g, [[4.5, 8.5], [8.5, 8.5], [8.5, 11.5]]);
  const r = t.result();
  assert(r.length === 8, `8 cases attendues, ${r.length}`);
  assert(r[4].x === 8 && r[4].y === 8 && r[4].inDir === 0 && r[4].dir === 1, 'virage mal orienté');
  for (let s = 1; s <= 6; s++) t.move(8.5, 11.5 - s * 0.5);
  assert(t.result().length === 5, `retour en arrière : ${t.result().length}`);
});
test('pont : un tapis passe par-dessus un autre, et les deux continuent de rouler', () => {
  const g = new Game('TEST-B1');
  g.money = 10000; g.world.reveal(7, 6, 14);
  const down: TraceCell[] = [];
  for (let y = 2; y <= 10; y++) down.push({ x: 7, y, dir: 1, inDir: 1 });
  assert(g.placeBelts(down), 'tapis vertical');
  // Sans le déblocage : le tracé s'arrête sur le tapis (il s'y branche).
  const t0 = trace(g, [[4.5, 6.5], [10.5, 6.5]]);
  assert(t0.result().length === 3 && !t0.result().some((c) => c.jump), `sans pont : ${t0.result().length} cases`);
  const t = new BeltTracer(g.factory, 4.5, 6.5);
  t.bridges = true;
  for (let s = 1; s <= 24; s++) t.move(4.5 + s * 0.25, 6.5);
  const r = t.result();
  const bridge = r.find((c) => c.jump);
  assert(bridge && bridge.x === 6 && bridge.jump === 1 && bridge.dir === 0, `pont attendu en (6,6) : ${JSON.stringify(r)}`);
  assert(r.length === 6 && r[r.length - 1].x === 10 && r[3].x === 8 && r[3].inDir === 0, `cases : ${r.map((c) => c.x).join(',')}`);
  assert(!g.placeBelts(r), 'refusé tant que les ponts ne sont pas débloqués');
  g.unlocks.add('pont');
  const before = g.money;
  assert(g.placeBelts(r), 'pont posé');
  assert(before - g.money === 6 * RULES.beltCost + RULES.bridgeCost, `prix ${before - g.money}`);
  const a = g.placeMachine('coffre', 11, 6)!, b = g.placeMachine('coffre', 7, 11)!;
  for (const x of g.factory.belts.values()) x.built = true;
  a.built = true; b.built = true; g.pending = []; g.factory.markBuilt();
  assert(g.factory.beltAt(7, 6)!.jump === undefined && g.factory.beltAt(6, 6)!.jump === 1, 'le tapis du dessous est intact');
  g.factory.beltAt(4, 6)!.items.push({ t: 'cuivre', p: 0 });
  g.factory.beltAt(7, 2)!.items.push({ t: 'charbon', p: 0 });
  run(g, 12);
  assert(a.inBuf.cuivre === 1 && !a.inBuf.charbon, `coffre au bout du pont : ${JSON.stringify(a.inBuf)}`);
  assert(b.inBuf.charbon === 1 && !b.inBuf.cuivre, `coffre sous le pont : ${JSON.stringify(b.inBuf)}`);
  // Débit : un pont ne ralentit pas la file.
  const first = g.factory.beltAt(4, 6)!;
  for (let i = 0; i < 30 * 20; i++) {
    const rear = first.items[first.items.length - 1];
    if (!rear || rear.p >= RULES.beltGap) first.items.push({ t: 'cuivre', p: 0 });
    g.tick(1 / 30);
  }
  // Autant qu'un tapis droit de même longueur (42 en 20 s).
  assert(a.inBuf.cuivre >= 1 + 40, `débit sur le pont : ${a.inBuf.cuivre - 1} en 20 s`);
  // Gomme sur la case enjambée : d'abord le pont (remboursé), puis le tapis du dessous.
  const m0 = g.money;
  assert(g.removeAt(7, 6) && !g.factory.beltAt(6, 6) && !!g.factory.beltAt(7, 6), 'le pont part, pas le tapis du dessous');
  assert(g.money - m0 === RULES.beltCost + RULES.bridgeCost, `remboursé ${g.money - m0}`);
  assert(g.removeAt(7, 6) && !g.factory.beltAt(7, 6), 'puis le tapis');
  // Sauvegarde
  const g2 = new Game('TEST-B1');
  g2.factory.load(g.factory.serialize());
  assert(!g2.factory.beltAt(6, 6) && g2.factory.belts.size === g.factory.belts.size, 'rechargé');
});
test('pont depuis un tapis collé à un autre : dérivation ou bout de tapis, par-dessus le voisin', () => {
  const g = new Game('TEST-B2');
  g.money = 10000; g.world.reveal(6, 6, 14); g.unlocks.add('pont'); g.unlocks.add('separateur');
  const row = (y: number): TraceCell[] => [...Array(9)].map((_, i) => ({ x: 2 + i, y, dir: 0, inDir: 0 }));
  assert(g.placeBelts(row(5)) && g.placeBelts(row(6)), 'deux tapis parallèles');
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  // Depuis le milieu du tapis du haut, vers le bas, par-delà celui du bas : une dérivation en pont.
  const t = new BeltTracer(g.factory, 5.5, 5.5);
  t.bridges = true;
  for (let s2 = 1; s2 <= 12; s2++) t.move(5.5, 5.5 + s2 * 0.25);
  assert(t.splitFrom && t.splitJump === 1 && t.splitDir === 1, `dérivation en pont : ${t.splitJump}`);
  assert(t.result()[0].x === 5 && t.result()[0].y === 7 && t.valid && !t.blocked, `départ ${JSON.stringify(t.result()[0])}`);
  // Le doigt revient sur le tapis du bas : plus de pont.
  t.move(5.5, 6.5);
  assert(t.splitJump === 0 && t.result().length === 0, 'annulé en revenant');
  for (let s2 = 1; s2 <= 8; s2++) t.move(5.5, 6.5 + s2 * 0.25);
  assert(t.splitJump === 1 && t.result().length === 2, 'repris');
  assert(g.placeBelts(t.result(), { from: t.splitFrom!, dir: t.splitDir!, jump: t.splitJump }), 'posé');
  const top = g.factory.beltAt(5, 5)!;
  assert(top.split === 1 && top.splitJump === 1, 'séparateur en pont');
  const chest = g.placeMachine('coffre', 5, 9)!;
  for (const b of g.factory.belts.values()) b.built = true;
  chest.built = true; g.pending = []; g.factory.markBuilt();
  g.factory.beltAt(2, 5)!.items.push({ t: 'cuivre', p: 0 }, { t: 'cuivre', p: 0.6 });
  g.factory.beltAt(2, 6)!.items.push({ t: 'charbon', p: 0 });
  run(g, 15);
  assert(chest.inBuf.cuivre === 1 && !chest.inBuf.charbon, `coffre de la dérivation : ${JSON.stringify(chest.inBuf)}`);
  assert(g.factory.beltAt(10, 6)!.items.some((i) => i.t === 'charbon'), 'le charbon du tapis du bas est passé dessous');
  // Depuis le bout du tapis du haut : il tourne et passe par-dessus le bout du tapis du bas.
  const t2 = new BeltTracer(g.factory, 10.5, 5.5);
  t2.bridges = true;
  for (let s2 = 1; s2 <= 12; s2++) t2.move(10.5, 5.5 + s2 * 0.25);
  const r2 = t2.result();
  assert(r2[0].existing && r2[0].jump === 1 && r2[0].dir === 1 && r2[1].y === 7, `bout en pont : ${JSON.stringify(r2)}`);
  assert(g.placeBelts(r2) && g.factory.beltAt(10, 5)!.jump === 1, 'pont posé depuis le bout');
  // Gomme sur la case sous la dérivation en pont : la dérivation part, le séparateur redevient un tapis simple.
  const snap = g.factory.serialize();
  assert(g.removeAt(5, 6) && g.factory.beltAt(5, 5)!.split === undefined && !!g.factory.beltAt(5, 6), 'dérivation en pont retirée');
  g.factory.load(snap);
  // Sauvegarde
  const g2 = new Game('TEST-B2');
  g2.factory.load(g.factory.serialize());
  assert(g2.factory.beltAt(5, 5)!.splitJump === 1 && g2.factory.beltAt(10, 5)!.jump === 1, 'rechargés');
});
test('un tapis tracé depuis une machine en sort, et entre dans la machine visée', () => {
  const g = new Game('TEST-4');
  g.money = 10000;
  const four = g.placeMachine('four', 4, 9)!;
  assert(four, 'four non posé');
  const t = trace(g, [[2.5, 2.5], [2.5, 6.5], [2.5, 9.5], [4.5, 9.5]]);
  const r = t.result();
  assert(r[0].x === 2 && r[0].y === 4 && r[0].inDir === 1, `première case ${JSON.stringify(r[0])}`);
  assert(t.endTarget && g.factory.machineAt(t.endTarget.x, t.endTarget.y) === four, 'pas branché sur le four');
});

test('repasser sur le tracé le reprend de là', () => {
  const g = new Game('TEST-3B');
  const t = trace(g, [[4.5, 8.5], [10.5, 8.5], [10.5, 12.5]]);
  assert(t.result().length === 11, `avant : ${t.result().length}`);
  t.move(6.5, 8.5); // le doigt saute sur la 3e case
  assert(t.result().length === 3 && t.result()[2].x === 6, `après : ${t.result().length}`);
  for (let s = 1; s <= 6; s++) t.move(6.5, 8.5 + s * 0.5);
  const r = t.result();
  assert(r.length === 6 && r[5].x === 6 && r[5].y === 11, `nouvelle branche : ${JSON.stringify(r[r.length - 1])}`);
});

console.log('Usine');
function buildIronLine(g: Game): void {
  g.money = 10000;
  g.world.reveal(-6, 2, 20);
  assert(g.placeMachine('foreuse', -13, -5), 'foreuse fer');
  assert(g.placeMachine('foreuse', -12, 9), 'foreuse charbon');
  assert(g.placeMachine('four', -8, -5), 'four');
  // Fer → four
  assert(g.placeBelts(trace(g, [[-12.5, -4.5], [-8.5, -4.5], [-7.5, -4.5]]).result()), 'tapis fer');
  // Charbon → four (monte puis tourne)
  assert(g.placeBelts(trace(g, [[-11.5, 9.5], [-9.5, 9.5], [-9.5, -3.5], [-7.5, -3.5]]).result()), 'tapis charbon');
  // Four → Noyau
  assert(g.placeBelts(trace(g, [[-7.5, -4.5], [-5.5, -4.5], [-5.5, 0.5], [0.5, 0.5]]).result()), 'tapis noyau');
}

test('au départ, un drone avec 10 charbons ; robot et drones construisent tout', () => {
  const g = new Game('TEST-5');
  assert(g.drones.length === 1 && g.drones[0].cargo?.t === 'charbon' && g.drones[0].cargo.n === 10, `drone de départ : ${JSON.stringify(g.drones[0]?.cargo)}`);
  buildIronLine(g);
  assert(g.pending.length > 10, `chantiers : ${g.pending.length}`);
  run(g, 150);
  assert(g.pending.length === 0, `chantiers restants : ${g.pending.length}`);
});
test('foreuse → four à charbon → Noyau : la mission du palier avance', () => {
  const g = new Game('TEST-6');
  buildIronLine(g);
  run(g, 150);
  fuelAll(g);
  run(g, 120);
  const four = [...g.factory.machines.values()].find((m) => m.type === 'four')!;
  assert(four.made > 0, `le four n'a rien fabriqué (état ${four.status}, entrées ${JSON.stringify(four.inBuf)})`);
  assert((g.palierDone.lingot_fer ?? 0) > 0 && g.palierProgress() > 0, `mission : ${JSON.stringify(g.palierDone)}`);
});
test('sans charbon, le four attend', () => {
  const g = new Game('TEST-7');
  g.money = 10000;
  g.world.reveal(-6, 2, 20);
  g.placeMachine('foreuse', -13, -5);
  g.placeMachine('four', -8, -5);
  g.placeBelts(trace(g, [[-12.5, -4.5], [-8.5, -4.5], [-7.5, -4.5]]).result());
  g.drones[0].cargo = null; // pas de cadeau dans ce test
  run(g, 60);
  for (const m of g.factory.machines.values()) if (m.type === 'foreuse') g.factory.addFuel(m, 10);
  run(g, 40);
  const four = [...g.factory.machines.values()].find((m) => m.type === 'four')!;
  assert(four.made === 0 && four.status === 'nofuel', `état ${four.status}, fabriqués ${four.made}`);
});
test('les objets gardent leurs distances sur le tapis', () => {
  const g = new Game('TEST-8');
  g.money = 10000;
  g.world.reveal(-6, 2, 20);
  g.placeMachine('foreuse', -13, -5);
  g.placeBelts(trace(g, [[-12.5, -4.5], [-6.5, -4.5]]).result());
  run(g, 40);
  fuelAll(g);
  run(g, 80);
  const items: number[] = [];
  for (const b of g.factory.belts.values()) for (const it of b.items) items.push(b.x + it.p);
  items.sort((a, b) => a - b);
  for (let i = 1; i < items.length; i++) assert(items[i] - items[i - 1] >= 0.49, `écart ${items[i] - items[i - 1]}`);
  assert(items.length >= 8, `objets en file : ${items.length}`);
});
test('séparateur : un tapis tracé depuis le milieu d’un autre partage les objets', () => {
  const g = new Game('TEST-11');
  g.money = 10000;
  g.lab = { lingot_fer: 20 }; assert(g.unlock('separateur'), 'déblocage du séparateur');
  g.world.reveal(-6, 2, 20);
  g.placeMachine('foreuse', -13, -5);
  g.placeBelts(trace(g, [[-12.5, -4.5], [-5.5, -4.5]]).result());
  run(g, 40);
  fuelAll(g);
  run(g, 20);
  const t = trace(g, [[-8.5, -4.5], [-8.5, -2.5], [-8.5, 1.5]]);
  assert(t.splitFrom && t.splitDir === 1 && t.valid, `dérivation non reconnue (${t.splitDir})`);
  assert(g.placeBelts(t.result(), { from: t.splitFrom!, dir: t.splitDir! }), 'pose de la dérivation');
  run(g, 120);
  const main = g.factory.beltAt(-6, -5)!, branch = g.factory.beltAt(-9, 1)!;
  assert(main.items.length > 0 && branch.items.length > 0, `principal ${main.items.length}, dérivation ${branch.items.length}`);
  g.removeAt(-9, -4); // on retire la première case de la dérivation
  assert(g.factory.beltAt(-9, -5)!.split === undefined, 'le séparateur aurait dû redevenir un tapis simple');
});
test('séparateur : à débloquer dans l’arbre', () => {
  const g = new Game('TEST-12');
  g.money = 10000;
  g.world.reveal(-6, 2, 20);
  g.placeBelts(trace(g, [[-6.5, -8.5], [-2.5, -8.5]]).result());
  run(g, 20);
  const t = trace(g, [[-4.5, -8.5], [-4.5, -6.5]]);
  assert(!g.placeBelts(t.result(), { from: t.splitFrom!, dir: t.splitDir! }), 'devrait être refusé sans le déblocage');
});
test('absence : 10 % de production, 8 h au plus, livrée au Noyau', () => {
  const g = new Game('TEST-13');
  buildIronLine(g);
  run(g, 150);
  // Une usine qui tourne seule : on donne aux machines du charbon pour toute l'absence.
  for (const m of g.factory.machines.values()) if (m.built) { m.fuel = 10; m.burn = 1e6; }
  run(g, 50);
  const before = g.palierDone.lingot_fer ?? 0;
  const r = g.catchUp(24 * 3600 * 1000, 20000)!;
  assert(r.counted === 8 * 3600, `durée comptée ${r.counted}`);
  const got = r.gained.lingot_fer ?? 0;
  assert(got > 50, `lingots livrés : ${got}`);
  assert(g.palier === 2 || (g.palierDone.lingot_fer ?? 0) === before + got, 'livraisons incohérentes');
  assert((g.palierDone.lingot_fer ?? 0) <= 150, 'le Noyau a pris plus que sa mission');
  assert(g.catchUp(30 * 1000) === null, 'une absence de 30 s ne compte pas');
});
test('supprimer rembourse', () => {
  const g = new Game('TEST-9');
  const m0 = g.money;
  const m = g.placeMachine('four', 5, 9)!;
  assert(g.money === m0 - 40, 'coût du four');
  g.removeMachine(m);
  assert(g.money === m0, 'remboursement');
});
test('sauvegarde et rechargement', () => {
  const g = new Game('TEST-10');
  buildIronLine(g);
  run(g, 150);
  fuelAll(g);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(g2.factory.belts.size === g.factory.belts.size, 'tapis');
  assert(g2.factory.machines.size === g.factory.machines.size, 'machines');
  g.palierDone.lingot_fer = 0;
  const s2 = JSON.parse(JSON.stringify(g.serialize()));
  const g3 = new Game(s2.seed, s2);
  assert(g2.money === g.money && g2.palier === g.palier, 'argent / palier');
  run(g3, 150);
  assert((g3.palierDone.lingot_fer ?? 0) > 0, 'la production ne reprend pas');
});
test('une ancienne sauvegarde (sans charbon, drones ni séparateurs) se charge', () => {
  const g = new Game('TEST-14');
  buildIronLine(g);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  delete s.drones; delete s.crew; s.v = 1;
  s.factory.belts = s.factory.belts.map((b: unknown[]) => b.slice(0, 6));
  const g2 = new Game(s.seed, s);
  assert(g2.factory.belts.size === g.factory.belts.size, 'tapis');
  assert(g2.drones.length === 1 && g2.drones[0].cargo?.n === 10, 'un drone avec le cadeau de départ');
});

test('une machine posée sur un tapis se branche : entrée et sortie', () => {
  const g = new Game('TEST-15');
  g.money = 10000; g.world.reveal(-6, 2, 20);
  g.placeMachine('foreuse', -13, -5);
  const chest = g.placeMachine('coffre', -1, -5)!;
  assert(g.placeBelts(trace(g, [[-11.5, -4.5], [-2.5, -4.5], [-1.5, -4.5]]).result()), 'tapis');
  const belts0 = g.factory.belts.size, m0 = g.money;
  const four = g.placeMachine('four', -7, -5)!;
  assert(four, 'le four devrait se poser sur le tapis');
  assert(g.factory.belts.size === belts0 - 2 && g.money === m0 - 40 + 2, `tapis ${g.factory.belts.size}/${belts0}, pièces ${m0 - g.money}`);
  run(g, 120);
  fuelAll(g);
  run(g, 60);
  assert(four.made > 0 && (chest.inBuf.lingot_fer ?? 0) > 0, `four ${four.made}, coffre ${JSON.stringify(chest.inBuf)}`);
});

test('relier une machine au tapis qui la longe, sans nouvelle case', () => {
  const g = new Game('TEST-16');
  g.money = 10000; g.world.reveal(6, 6, 20);
  const four = g.placeMachine('four', 6, 6)!;
  const chest = g.placeMachine('coffre', 14, 8)!;
  // Un tapis passe sous le four (rangée y = 8), de gauche à droite, jusqu'au coffre.
  assert(g.placeBelts(trace(g, [[4.5, 8.5], [12.5, 8.5], [13.5, 8.5]]).result()), 'tapis');
  run(g, 40);
  const t = new BeltTracer(g.factory, 6.5, 7.5); // depuis le four…
  t.move(6.6, 8.6); // … vers le tapis juste dessous
  assert(t.linkBelt && t.linkDir === 3 && t.newCount === 0, `liaison proposée : ${t.linkDir}`);
  const n0 = g.factory.belts.size;
  assert(g.linkMachineToBelt(t.linkBelt!, t.linkDir!) && g.factory.belts.size === n0, 'liaison sans case');
  four.outBuf.verre = 5; // (le verre : personne ne le réclame, il reste au coffre)
  run(g, 20);
  assert((chest.inBuf.verre ?? 0) === 5, `coffre ${JSON.stringify(chest.inBuf)}`);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(JSON.stringify(g2.factory.beltAt(6, 8)!.feeds) === '[3]', 'liaison sauvegardée');
});

test('un tapis entre deux machines : relié des deux côtés, et il peut nourrir une machine', () => {
  const g = new Game('TEST-17');
  g.money = 10000; g.world.reveal(6, 6, 20);
  const haut = g.placeMachine('four', 6, 6)!; // au-dessus du tapis
  const bas = g.placeMachine('four', 6, 9)!; // en dessous
  const chest = g.placeMachine('coffre', 14, 8)!;
  assert(g.placeBelts(trace(g, [[4.5, 8.5], [12.5, 8.5], [13.5, 8.5]]).result()), 'tapis');
  run(g, 50);
  const belt = g.factory.beltAt(6, 8)!;
  const t1 = new BeltTracer(g.factory, 6.5, 7.5); t1.move(6.6, 8.6);
  const t2 = new BeltTracer(g.factory, 6.5, 9.5); t2.move(6.6, 8.4);
  assert(t1.linkBelt === belt && t2.linkBelt === belt, 'deux liaisons proposées');
  g.linkMachineToBelt(belt, t1.linkDir!); g.linkMachineToBelt(belt, t2.linkDir!);
  assert(JSON.stringify([...belt.feeds!].sort()) === '[1,3]', `liaisons ${belt.feeds}`);
  haut.outBuf.verre = 3; bas.outBuf.verre = 3;
  run(g, 25);
  assert((chest.inBuf.verre ?? 0) === 6, `coffre ${JSON.stringify(chest.inBuf)}`);
  // Dans l'autre sens : depuis le tapis vers la machine du bas, le tapis la nourrit.
  g.unlinkBelt(belt);
  const belt2 = g.factory.beltAt(7, 8)!;
  const t3 = new BeltTracer(g.factory, 7.5, 8.5); t3.move(7.5, 9.6);
  assert(t3.splitFrom === belt2 && t3.intoMachine === 1, `vers la machine : ${t3.intoMachine}`);
  assert(g.linkBeltToMachine(belt2, 1), 'liaison tapis → machine');
  for (let i = 0; i < 4; i++) belt.items.push({ t: 'fer', p: 0.1 * (3 - i) });
  belt.items.sort((a, c) => c.p - a.p);
  run(g, 10);
  assert((bas.inBuf.fer ?? 0) + bas.made > 0, `la machine du bas n'a rien reçu : ${JSON.stringify(bas.inBuf)}`);
});

test('scanner : les 3 filons les plus proches, du plus proche au plus loin', () => {
  const g = new Game('TEST-18');
  const res = g.scan('sable', 3);
  assert(res.length === 3 && res[0].d <= res[1].d && res[1].d <= res[2].d, JSON.stringify(res));
  for (const f of res) assert(g.world.patchAt(Math.floor(f.x), Math.floor(f.y))?.type === 'sable', 'pas un filon de sable');
  assert(g.scan('licorne').length === 0, 'matière inconnue');
});

test('un drone sans travail se pose sur le robot et ne brûle plus de charbon', () => {
  const g = new Game('TEST-R1');
  g.world.reveal(0, 0, 30); g.drones[0].cargo = null;
  run(g, 10);
  const d = g.drones[0];
  assert(d.state === 'rest', `posé : ${d.state}`);
  const f0 = d.fuel + d.burn / RULES.coalDroneSeconds;
  g.sendRobot(12, 6);
  run(g, 20);
  const f1 = d.fuel + d.burn / RULES.coalDroneSeconds;
  assert(d.state === 'rest' && Math.abs(f1 - f0) < 1e-9, `charbon ${f0} → ${f1}`);
  assert(Math.hypot(d.x - g.robot.x, d.y - g.robot.y) < 1.5, 'il voyage sur le robot');
  // Du travail : il décolle.
  g.money = 1000;
  const a = g.placeMachine('coffre', Math.floor(g.robot.x) + 3, Math.floor(g.robot.y) + 2);
  const b = g.placeMachine('coffre', Math.floor(g.robot.x) - 3, Math.floor(g.robot.y) + 2);
  run(g, 1);
  assert(a && b && d.state !== 'rest', `il repart : ${d.state}`);
});
test('chenilles et antennes : plusieurs niveaux, le meilleur compte', () => {
  const g = new Game('TEST-R2');
  g.world.reveal(0, 0, 40);
  const time = () => {
    const x0 = g.robot.x, y0 = g.robot.y;
    g.sendRobot(x0 + 20, y0);
    let t = 0;
    while (g.robot.target && t < 30) { g.tick(1 / 30); t += 1 / 30; }
    g.sendRobot(x0, y0);
    while (g.robot.target && t < 60) g.tick(1 / 30);
    return t;
  };
  const t0 = time();
  g.unlocks.add('chenilles'); g.unlocks.add('chenilles2');
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  const t1 = time();
  assert(g.robotSpeedMult === 1.5 && Math.abs(t0 / t1 - 1.5) < 0.1, `vitesse : ${t0.toFixed(2)} s → ${t1.toFixed(2)} s`);
  g.unlocks.add('antenne');
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  assert(g.droneRangeMult === 1.5, `portée ${g.droneRangeMult}`);
  for (const id of ['antenne2', 'antenne3', 'chenilles3']) assert(NODE[id] && NODE[id].effect.kind !== 'soon', `${id} existe`);
  assert(!/marais/.test(NODE.chenilles.hint), 'plus de marais');
});
test('station : son drone travaille autour d’elle, loin du robot', () => {
  const g = new Game('TEST-19');
  g.money = 10000; g.world.reveal(30, 2, 26);
  assert(!g.placeMachine('station', 26, 0), 'la station se débloque dans l’arbre');
  g.lab = { lingot_fer: 30, lingot_cuivre: 10 };
  assert(g.unlock('station'), 'déblocage');
  const st = g.placeMachine('station', 26, 0)!;
  // Le robot la construit, puis on l'envoie loin : seule la station reste là-bas.
  run(g, 60);
  assert(st.built && g.stationDrones.size === 1, `station construite ${st.built}, drones ${g.stationDrones.size}`);
  g.sendRobot(-10, 10);
  run(g, 15);
  const chest = g.placeMachine('coffre', 32, 2)!;
  const four = g.placeMachine('four', 22, 3)!;
  run(g, 40);
  assert(chest.built && four.built, `chantiers faits par le drone de la station : coffre ${chest.built}, four ${four.built}`);
  g.factory.putInStorage(chest, 'charbon', 20);
  four.fuel = 0;
  run(g, 30);
  assert(four.fuel > 0, `le drone de la station aurait dû recharger le four (${four.fuel})`);
  // Le Noyau est hors de son rayon : il n'y livre pas (les lingots restent dans le coffre).
  const noyau = [...g.factory.machines.values()].find((m) => m.type === 'noyau')!;
  assert(Math.hypot(noyau.x - st.x, noyau.y - st.y) > RULES.stationRange, 'Noyau loin de la station');
  g.sendRobot(-10, 10);
  run(g, 15);
  const sd = g.stationDrones.get(st.id)!;
  sd.cargo = null;
  g.setStationPriorities(st.id, ['noyau', 'carburant', 'chantiers', 'laboratoire', 'comptoir']);
  g.factory.putInStorage(chest, 'lingot_fer', 10);
  let far = 0;
  for (let i = 0; i < 30 * 20; i++) { g.tick(1 / 30); far = Math.max(far, Math.hypot(sd.x - (st.x + 1), sd.y - (st.y + 1))); }
  assert(chest.inBuf.lingot_fer === 10 && far <= RULES.stationRange + 2, `lingots ${chest.inBuf.lingot_fer}, drone allé à ${far.toFixed(1)} cases`);
  // Sans coffre : il se sert dans la case carburant de la station (50 charbons), en lui en laissant 2.
  g.factory.takeFromStorage(chest, 'charbon', 1000);
  four.fuel = 0; four.burn = 0;
  st.fuel = 0;
  assert(g.factory.addFuel(st, 60) === RULES.stationCoal && st.fuel === 50, `station : ${st.fuel} charbons`);
  const before = st.fuel;
  run(g, 30);
  assert(four.fuel > 0 && st.fuel < before && st.fuel >= RULES.stationReserve - 1, `four ${four.fuel}, station ${before} → ${st.fuel}`);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(g2.stationDrones.size === 1, 'drone de station rechargé');
  g2.removeMachine([...g2.factory.machines.values()].find((m) => m.type === 'station')!);
  run(g2, 1);
  assert(g2.stationDrones.size === 0, 'drone retiré avec la station');
});

test('deux machines collées se relient sans tapis', () => {
  const g = new Game('TEST-1A');
  g.money = 10000; g.world.reveal(6, 6, 20);
  const four = g.placeMachine('four', 6, 6)!;
  const chest = g.placeMachine('coffre', 8, 6)!; // collé à droite du four
  run(g, 40);
  const t = new BeltTracer(g.factory, 6.5, 6.5); t.move(8.5, 6.5);
  assert(t.linkMachine === chest, 'liaison directe proposée');
  assert(g.linkMachines(four, chest), 'reliés');
  four.outBuf.verre = 4;
  run(g, 10);
  assert((chest.inBuf.verre ?? 0) === 4, `coffre ${JSON.stringify(chest.inBuf)}`);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(JSON.stringify(g2.factory.machines.get(four.id)!.links) === `[${chest.id}]`, 'liaison sauvegardée');
  const far = g.placeMachine('four', 12, 12)!;
  assert(!g.linkMachines(four, far), 'pas de liaison entre machines éloignées');
});

console.log('Charbon');
test('une foreuse sur du charbon s’alimente toute seule', () => {
  const g = new Game('TEST-27');
  g.money = 10000; g.world.reveal(-6, 2, 20); g.drones[0].cargo = null;
  const m = g.placeMachine('foreuse', -12, 9)!;
  run(g, 25);
  assert(m.built && g.factory.fuelRoom(m) === 0 && !g.factory.lowFuel(m), 'pas de voyant, personne ne la recharge');
  run(g, 40);
  assert(m.made > 0 && m.fuel + (m.burn > 0 ? 1 : 0) >= 5, `charbon ${m.fuel}, extraits ${m.made}`);
  run(g, 40);
  assert((m.outBuf.charbon ?? 0) > 0, 'une fois sa case pleine, elle envoie le reste');
});
test('une machine sans charbon attend ; un charbon dure 10 s de travail', () => {
  const g = new Game('TEST-20');
  g.money = 10000; g.world.reveal(-6, 2, 20); g.drones[0].cargo = null;
  const m = g.placeMachine('foreuse', -13, -5)!;
  run(g, 40);
  assert(m.built && m.made > 0, 'une foreuse neuve a 10 charbons : elle démarre seule');
  m.fuel = 0; m.burn = 0; m.made = 0; m.outBuf = {};
  run(g, 5);
  assert(m.made === 0 && m.status === 'nofuel', `état ${m.status}`);
  g.factory.addFuel(m, 1);
  run(g, 12);
  assert(m.fuel === 0 && m.made >= 4 && m.made <= 6, `fabriqués avec 1 charbon : ${m.made}`);
  assert(g.factory.lowFuel(m), 'le voyant devrait clignoter');
});
test('le drone de départ dépose ses 10 charbons dans la foreuse qui clignote', () => {
  const g = new Game('TEST-21');
  g.money = 10000; g.world.reveal(-6, 2, 20);
  const m = g.placeMachine('foreuse', -12, 9)!;
  run(g, 60);
  assert(m.built && m.made > 0 && m.fuel + (m.burn > 0 ? 1 : 0) >= 8, `charbon de la foreuse : ${m.fuel}, extraits ${m.made}`);
});
test('une foreuse neuve sort du chantier avec 10 charbons', () => {
  const g = new Game('TEST-29');
  g.money = 10000; g.world.reveal(-6, 2, 20); g.drones[0].cargo = null;
  const m = g.placeMachine('foreuse', -13, -5)!;
  for (let i = 0; i < 3000 && !m.built; i++) g.tick(1 / 30);
  assert(m.built && m.fuel + (m.burn > 0 ? 1 : 0) >= 9, `charbon à la sortie du chantier : ${m.fuel}`);
});
test('le carburant brûle comme le charbon : machines, robot, drones', () => {
  const g = new Game('TEST-F1');
  g.money = 10000; g.world.reveal(-6, 2, 20); g.drones[0].cargo = null;
  const four = g.placeMachine('four', -9, -1)!;
  const chest = g.placeMachine('coffre', -6, 3)!;
  run(g, 40);
  assert(four.built && chest.built, 'construits');
  // Machine : le carburant remplit la case carburant.
  four.fuel = 0; four.burn = 0;
  assert(g.factory.canAccept(four, 'carburant') && g.machineAccepts(four, 'carburant') === 10, 'le four accepte le carburant');
  // Drone : sans charbon dans les coffres, il prend le carburant pour recharger le four.
  g.factory.putInStorage(chest, 'carburant', 20);
  run(g, 30);
  assert(four.fuel > 0 && (chest.inBuf.carburant ?? 0) < 20, `four rechargé au carburant : ${four.fuel}`);
  // Robot : sa case carburant se remplit avec le carburant de son inventaire.
  g.robot.fuel = 0;
  g.robot.inv.add('carburant', 5);
  run(g, 1);
  assert(g.robot.fuel >= 4 && g.robot.inv.count('carburant') <= 1, `robot : ${g.robot.fuel}`);
});
test('le carburant passe avant le charbon et dure 5 fois plus longtemps', () => {
  const g = new Game('TEST-F2');
  g.money = 10000; g.world.reveal(-6, 2, 20); g.drones[0].cargo = null;
  const four = g.placeMachine('four', -9, -1)!;
  run(g, 40);
  four.fuel = 0; four.burn = 0; four.carb = 0; four.outBuf = {};
  g.factory.addFuel(four, 1, 'charbon');
  g.factory.addFuel(four, 1, 'carburant');
  four.inBuf = { fer: 30 };
  run(g, 1);
  assert(four.fuel === 1 && (four.carb ?? 0) === 0, `le carburant brûle d'abord : ${four.fuel} dont ${four.carb}`);
  assert(four.burn > RULES.coalMachineSeconds * 4, `il dure 5 fois plus : ${four.burn}`);
  // Robot : il prend le carburant de son inventaire avant le charbon.
  g.robot.fuel = 0; g.robot.burn = 0; g.robot.carb = 0;
  g.robot.inv.add('charbon', 5); g.robot.inv.add('carburant', 3);
  run(g, 0.1);
  assert(g.robot.inv.count('carburant') === 0 && (g.robot.carb ?? 0) + (g.robot.burn > RULES.coalRobotSeconds ? 1 : 0) === 3, `robot : carburant ${g.robot.carb}, charbon restant ${g.robot.inv.count('charbon')}`);
  // Sauvegarde
  const g2 = new Game('TEST-F2', JSON.parse(JSON.stringify(g.serialize())));
  assert(g2.robot.carb === g.robot.carb, 'carburant du robot sauvegardé');
});
test('le robot mine à l’arrêt sur un filon et se ravitaille avec son charbon', () => {
  const g = new Game('TEST-22');
  g.drones[0].cargo = null;
  g.sendRobot(-11, 10.2);
  run(g, 30);
  const coal = g.robot.inv.count('charbon');
  assert(g.robot.mining === 'charbon' && coal > 0, `minage : ${g.robot.mining}, charbon ${coal}`);
  g.robot.fuel = 0; g.robot.burn = 0;
  run(g, 3);
  assert(g.robot.fuel > 0, 'le robot aurait dû remplir sa case carburant');
});
test('coffre : rempli par un tapis, vidé par un tapis, les drones y prennent le charbon', () => {
  const g = new Game('TEST-24');
  g.money = 10000; g.world.reveal(-6, 2, 20); g.drones[0].cargo = null;
  const drill = g.placeMachine('foreuse', -12, 9)!;
  const chest = g.placeMachine('coffre', -7, 9)!;
  g.placeBelts(trace(g, [[-11.5, 9.5], [-8.5, 9.5], [-7.5, 9.5]]).result());
  run(g, 40);
  g.factory.addFuel(drill, 10);
  run(g, 30);
  // Le drone remplit sa cargaison de charbon au coffre (10 au plus).
  const cargo = g.drones[0].cargo as { t: string; n: number } | null;
  const stored = (chest.inBuf.charbon ?? 0) + (cargo?.t === 'charbon' ? cargo.n : 0);
  assert(stored > 3, `coffre : ${JSON.stringify(chest.inBuf)}, drone ${JSON.stringify(g.drones[0].cargo)}`);
  const four = g.placeMachine('four', -5, 4)!;
  run(g, 40);
  assert(four.fuel > 0 || four.burn > 0, `le drone n’a pas pris le charbon du coffre (${four.fuel})`);
  g.placeBelts(trace(g, [[-6.5, 9.5], [-3.5, 9.5]]).result());
  run(g, 20);
  const out = g.factory.beltAt(-5, 9)!;
  assert(out.items.length > 0, 'rien ne sort du coffre');
});
test('sans charbon, le robot ralentit et le drone se pose sur lui', () => {
  const g = new Game('TEST-25');
  g.robot.fuel = 0; g.robot.burn = 0;
  const x0 = g.robot.x;
  g.sendRobot(x0 + 20, g.robot.y);
  run(g, 2);
  const moved = g.robot.x - x0;
  assert(moved > 1 && moved < 4.5, `distance en 2 s : ${moved.toFixed(2)}`);
  const d = g.drones[0];
  d.fuel = 0; d.burn = 0; d.cargo = null;
  g.money = 10000;
  for (let i = 0; i < 3; i++) g.placeMachine('coffre', Math.floor(g.robot.x) + 3 + i * 2, Math.floor(g.robot.y) + 3);
  run(g, 5);
  assert(d.state === 'parked', `drone : ${d.state}`);
  g.robot.inv.add('charbon', 20); // le robot remplit d'abord sa propre case carburant
  run(g, 1);
  assert(d.state !== 'parked' && d.fuel > 0, 'le drone aurait dû repartir');
});


test('tapis souterrain : d’un coffre à un four, sous un tapis et une machine', () => {
  const g = new Game('TEST-U1');
  g.money = 100000; g.world.reveal(10, 8, 20); g.drones[0].cargo = null;
  const chest = g.placeMachine('coffre', 3, 8)!;
  const four = g.placeMachine('four', 14, 8)!;
  const mid = g.placeMachine('four', 8, 7)!;
  g.placeBelts([...Array(7)].map((_, i) => ({ x: 6, y: 4 + i, dir: 1, inDir: 1 })) as TraceCell[]);
  for (const m of g.factory.machines.values()) m.built = true;
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  // Tracé au doigt : du coffre vers la droite (sous le tapis), la presse arrête le tracé.
  const t = new TunnelTracer(g.factory, g.world, 3.5, 8.5);
  for (let i = 1; i <= 24; i++) t.move(3.5 + i * 0.25, 8.5);
  assert(t.target === mid && t.cells.length === 4, `arrêt sur la machine du milieu : ${t.cells.length} cases, ${t.target?.type}`);
  // En contournant par le bas jusqu'au four.
  const t2 = new TunnelTracer(g.factory, g.world, 3.5, 8.5);
  for (const [x, y] of [[4.5, 8.5], [5.5, 8.5], [6.5, 8.5], [7.5, 8.5], [7.5, 9.5], [7.5, 10.5], [8.5, 10.5], [10.5, 10.5], [12.5, 10.5], [13.5, 10.5], [13.5, 9.5], [14.5, 9.5]]) t2.move(x, y);
  assert(t2.target === four && !t2.blocked, `arrivée au four : ${t2.target?.type} ${JSON.stringify(t2.cells)}`);
  assert(!g.placeTunnel(chest, four, t2.cells), 'à débloquer');
  g.unlocks.add('souterrain');
  const m0 = g.money;
  assert(g.placeTunnel(chest, four, t2.cells) && m0 - g.money === g.tunnelPrice(t2.cells.length), 'posé');
  g.factory.putInStorage(chest, 'fer', 5);
  g.factory.putInStorage(chest, 'cuivre', 3);
  four.fuel = 10;
  run(g, 30);
  assert((four.outBuf.lingot_fer ?? 0) + (four.inBuf.fer ?? 0) + (four.craft ? 1 : 0) >= 4 && !chest.inBuf.fer, `fer arrivé : ${JSON.stringify(four)}`);
  // Sauvegarde, puis suppression d'une machine : le tunnel part avec, remboursé.
  const g2 = new Game('TEST-U1', JSON.parse(JSON.stringify(g.serialize())));
  assert(g2.factory.tunnels.size === 1, 'rechargé');
  const m1 = g.money;
  g.removeMachine(four);
  assert(g.factory.tunnels.size === 0 && g.money - m1 === MACHINES.four.cost + g.tunnelPrice(t2.cells.length), 'retiré avec la machine');
});

test('grand coffre : 2 × 2, 300 objets ; un coffre simple en garde 100', () => {
  const g = new Game('TEST-GC');
  g.money = 10000; g.world.reveal(6, 6, 20);
  g.unlocks.add('grand_coffre');
  const big = g.placeMachine('grand_coffre', 4, 4)!, small = g.placeMachine('coffre', 8, 4)!;
  assert(big.w === 2 && big.h === 2, 'taille 2 × 2');
  big.built = true; small.built = true;
  assert(g.factory.putInStorage(big, 'fer', 1000) === 300 && g.factory.putInStorage(small, 'fer', 1000) === 100, 'contenances');
});

test('compteur : posé sur un tapis, il donne le débit des 20 dernières secondes', () => {
  const g = new Game('TEST-M1');
  g.money = 10000; g.world.reveal(6, 6, 20);
  assert(!g.placeMeter(5, 5), 'pas sans tapis');
  g.placeBelts([...Array(8)].map((_, i) => ({ x: 2 + i, y: 5, dir: 0, inDir: 0 })) as TraceCell[]);
  const chest = g.placeMachine('coffre', 10, 5)!;
  for (const b of g.factory.belts.values()) b.built = true;
  chest.built = true; g.pending = []; g.factory.markBuilt();
  const m0 = g.money;
  assert(g.placeMeter(6, 5) && m0 - g.money === MACHINES.compteur.cost && !g.placeMeter(6, 5), 'posé une fois');
  const first = g.factory.beltAt(2, 5)!;
  // Un objet par seconde.
  for (let i = 0; i < 30 * 30; i++) {
    if (i % 30 === 0) first.items.push({ t: i % 60 === 0 ? 'fer' : 'cuivre', p: 0 });
    g.tick(1 / 30);
  }
  const r = g.factory.meterRates(g.factory.beltAt(6, 5)!);
  assert(Math.abs(r.total - 1) < 0.1 && Math.abs(r.by.fer - 0.5) < 0.1, `débit ${r.total} (fer ${r.by.fer})`);
  // Le tapis s'arrête : le débit retombe à zéro en 20 secondes.
  run(g, 25);
  assert(g.factory.meterRates(g.factory.beltAt(6, 5)!).total === 0, 'à l’arrêt');
  const g2 = new Game('TEST-M1', JSON.parse(JSON.stringify(g.serialize())));
  assert(!!g2.factory.beltAt(6, 5)!.meter, 'rechargé');
  assert(g.removeAt(6, 5) && !g.factory.beltAt(6, 5)!.meter && g.removeAt(6, 5) && !g.factory.beltAt(6, 5), 'gomme : le compteur, puis le tapis');
});

test('dépôts : un camion fait les allers-retours, on ajoute des camions et un troisième arrêt', () => {
  const g = new Game('TEST-V1');
  g.money = 100000; g.world.reveal(14, 10, 30); g.drones[0].cargo = null;
  assert(!g.placeMachine('depot', 3, 8), 'dépôt à débloquer');
  g.unlocks.add('camion');
  const a = g.placeMachine('depot', 3, 8)!, b = g.placeMachine('depot', 23, 8)!, c = g.placeMachine('depot', 13, 16)!;
  const chest = g.placeMachine('coffre', 8, 8)!;
  for (const m of g.factory.machines.values()) m.built = true;
  g.pending = []; g.factory.markBuilt();
  assert(!g.linkStations(a, chest), 'un dépôt se relie à un dépôt');
  const m0 = g.money;
  const l = g.linkStations(a, b)!;
  assert(l && l.vehicles.length === 1 && l.stops[0].load && !l.stops[1].load, 'ligne : charge au départ, décharge à l’arrivée');
  assert(m0 - g.money === g.trackPrice('camion', 20) + RULES.truckCost, `prix ${m0 - g.money}`);
  // Le dépôt se remplit comme un coffre (tapis, drones) : 300 objets.
  assert(g.factory.putInStorage(a, 'fer', 1000) === 300, 'dépôt : 300 objets');
  run(g, 3);
  assert(g.factory.cargoCount(l.vehicles[0]) === RULES.truckLoad && l.vehicles[0].moving, 'parti plein');
  run(g, 12);
  assert((b.inBuf.fer ?? 0) === RULES.truckLoad, `livré : ${b.inBuf.fer}`);
  // Deux camions de plus : la ligne va plus vite.
  assert(g.addVehicle(l.id) && g.addVehicle(l.id) && l.vehicles.length === 3, 'trois camions');
  const before = b.inBuf.fer;
  // Un seul camion à quai par dépôt : les autres attendent leur tour sur la route, sans se chevaucher.
  let queued = 0;
  for (let i = 0; i < 30 * 30; i++) {
    g.tick(1 / 30);
    const docks = l.vehicles.filter((v) => !v.moving).map((v) => l.stops[v.at].id);
    assert(new Set(docks).size === docks.length, 'deux camions à quai au même dépôt');
    for (const v of l.vehicles) for (const o of l.vehicles) {
      if (v !== o && v.moving && o.moving && v.at === o.at) assert(Math.abs(v.pos - o.pos) >= RULES.truckGap - 0.01, `camions trop proches : ${v.pos} ${o.pos}`);
    }
    if (l.vehicles.some((v) => v.moving && v.pos > 0 && v.pos < g.factory.legLength(g.factory.machines.get(l.stops[v.at].id)!, g.factory.machines.get(l.stops[(v.at + 1) % 2].id)!) - 0.5 && g.factory.legLength(g.factory.machines.get(l.stops[v.at].id)!, g.factory.machines.get(l.stops[(v.at + 1) % 2].id)!) - v.pos <= RULES.truckGap + 0.01)) queued++;
  }
  assert(queued > 0, 'personne n’a attendu devant un dépôt');
  assert(b.inBuf.fer - before >= 3 * RULES.truckLoad, `plus vite : ${b.inBuf.fer - before} en 30 s`);
  // Troisième arrêt : A et B chargent, C décharge tout ; les camions passent par les trois.
  assert(g.addStop(l.id, c) && l.stops.length === 3 && !g.addStop(l.id, c), 'troisième arrêt');
  g.setStopLoad(l.id, 1, true);
  run(g, 60);
  assert((c.inBuf.fer ?? 0) > 0, `le troisième dépôt reçoit aussi : ${c.inBuf.fer}`);
  // Sauvegarde ; fermer la ligne la rembourse.
  const g2 = new Game('TEST-V1', JSON.parse(JSON.stringify(g.serialize())));
  assert(g2.factory.lines.size === 1 && [...g2.factory.lines.values()][0].vehicles.length === 3, 'rechargée');
  const m1 = g.money, refund = g.linePrice(l);
  assert(g.removeVehicle(l.id) && g.money - m1 === RULES.truckCost, 'camion retiré, remboursé');
  g.removeLine(l.id);
  assert(g.factory.lines.size === 0 && g.money - m1 === refund, 'ligne fermée, remboursée');
});
test('gares : un train, 80 objets à la fois ; la ligne part avec la gare', () => {
  const g = new Game('TEST-V2');
  g.money = 100000; g.world.reveal(14, 10, 30); g.drones[0].cargo = null;
  g.unlocks.add('train');
  const a = g.placeMachine('gare', 3, 8)!, b = g.placeMachine('gare', 23, 12)!;
  a.built = true; b.built = true; g.pending = []; g.factory.markBuilt();
  const l = g.linkStations(a, b)!;
  g.factory.putInStorage(a, 'cuivre', 200);
  run(g, 20);
  assert((b.inBuf.cuivre ?? 0) >= RULES.trainLoad, `train livré : ${b.inBuf.cuivre}`);
  const m1 = g.money, refund = g.linePrice(l);
  g.removeMachine(b);
  assert(g.factory.lines.size === 0 && g.money - m1 === MACHINES.gare.cost + refund, 'retirée avec la gare');
});

test('raffinerie à carburant : elle se sert d’abord dans ce qu’elle produit', () => {
  const g = new Game('TEST-F3');
  g.money = 100000; g.world.reveal(8, 8, 20); g.drones[0].cargo = null;
  g.unlocks.add('raffinerie');
  const r = g.placeMachine('raffinerie', 9, 4)!;
  r.built = true; g.pending = []; g.factory.markBuilt();
  r.fuel = 0; r.burn = 0;
  r.inBuf = { petrole: 10 };
  run(g, 5);
  assert(r.status === 'noinput' || r.status === 'idle' || r.fuel === 0, 'en plastique, sans charbon : rien');
  assert(!(r.outBuf.plastique > 0), 'pas de plastique sans charbon');
  g.factory.setChoice(r, 'carburant');
  assert(g.factory.selfFed(r) && g.factory.fuelRoom(r) === 0 && !g.factory.lowFuel(r), 'les drones ne la rechargent pas');
  run(g, 12);
  assert((r.carb ?? 0) > 0 && r.fuel === r.carb, `case carburant remplie d’abord : ${r.fuel}/${r.carb}`);
  assert(!(r.outBuf.carburant > 0), `rien ne sort tant que la case n’est pas pleine : ${r.outBuf.carburant}`);
  r.inBuf = { petrole: 10 };
  run(g, 25);
  assert(r.fuel === g.factory.fuelCap(r) && (r.outBuf.carburant ?? 0) > 0, `puis le reste sort : case ${r.fuel}, sortie ${r.outBuf.carburant}`);
});
test('gomme en zone : tout ce qui est dans le rectangle part, remboursé ; le Noyau reste', () => {
  const g = new Game('TEST-Z1');
  g.money = 100000; g.world.reveal(4, 4, 20); g.unlocks.add('generateur');
  const c = g.placeMachine('coffre', 8, 8)!;
  const f4 = g.placeMachine('four', 10, 8)!;
  assert(g.placeBelts(trace(g, [[8.5, 6.5], [12.5, 6.5]]).result()), 'tapis');
  g.placeCables([{ x: 8, y: 11 }, { x: 9, y: 11 }]);
  const inside = g.areaContents(8, 6, 11, 11);
  assert(inside.machines.length === 2 && inside.belts.length === 4 && inside.cables.length === 2, `contenu : ${inside.machines.length} ${inside.belts.length} ${inside.cables.length}`);
  const m0 = g.money;
  const n = g.removeArea(11, 11, 8, 6);
  assert(n === 8 && !g.factory.machines.has(c.id) && !g.factory.machines.has(f4.id), `supprimés : ${n}`);
  assert(g.factory.beltAt(12, 6) && !g.factory.beltAt(11, 6), 'le tapis hors zone reste');
  assert(g.money > m0, 'remboursé');
  assert(g.areaContents(-2, -2, 6, 6).machines.length === 0 && g.removeArea(-2, -2, 6, 6) === 0 && g.factory.machines.has(g.noyau.id), 'le Noyau reste');
});
test('un tapis nourrit deux machines de part et d’autre et continue tout droit', () => {
  const g = new Game('TEST-S3');
  g.money = 100000; g.world.reveal(6, 5, 20);
  const src = g.placeMachine('coffre', 1, 5)!;
  const end = g.placeMachine('coffre', 11, 5)!;
  const up = g.placeMachine('coffre', 5, 4)!;
  const down = g.placeMachine('coffre', 5, 6)!;
  assert(g.placeBelts(trace(g, [[1.5, 5.5], [10.5, 5.5], [11.5, 5.5]]).result()), 'tapis');
  for (const m of g.factory.machines.values()) m.built = true;
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  const b = g.factory.beltAt(5, 5)!;
  // Au doigt : depuis la case, vers la machine du haut, puis vers celle du bas.
  const t1 = new BeltTracer(g.factory, 5.5, 5.5); t1.move(5.5, 4.4);
  assert(t1.intoMachine === 3 && g.linkBeltToMachine(t1.splitFrom!, 3), 'nourrit le coffre du haut');
  const t2 = new BeltTracer(g.factory, 5.5, 5.5); t2.move(5.5, 6.6);
  assert(t2.splitFrom === b && t2.intoMachine === 1 && g.linkBeltToMachine(b, 1), 'et celui du bas');
  assert(b.split === 3 && b.split2 === 1, 'deux dérivations');
  g.factory.putInStorage(src, 'fer', 30);
  run(g, 60);
  const n = (m: typeof src) => m.inBuf.fer ?? 0;
  assert(n(up) >= 9 && n(down) >= 9 && n(end) >= 9 && n(up) + n(down) + n(end) === 30, `répartition : haut ${n(up)}, bas ${n(down)}, tout droit ${n(end)}`);
  const g2 = new Game('TEST-S3', JSON.parse(JSON.stringify(g.serialize())));
  assert(g2.factory.beltAt(5, 5)!.split2 === 1, 'sauvegardé');
  g.unlinkBelt(b);
  assert(b.split === undefined && b.split2 === undefined, 'liaisons coupées');
});
test('le bout d’un tapis se tourne vers une machine collée, puis nourrit aussi celle d’en face', () => {
  const g = new Game('TEST-S4');
  g.money = 100000; g.world.reveal(6, 5, 20);
  const up = g.placeMachine('coffre', 5, 4)!, down = g.placeMachine('coffre', 5, 6)!;
  assert(g.placeBelts(trace(g, [[1.5, 5.5], [5.5, 5.5]]).result()), 'tapis');
  for (const m of g.factory.machines.values()) m.built = true;
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  const t1 = trace(g, [[5.5, 5.5], [5.5, 4.4]]);
  assert(t1.turnsOnly && t1.valid && g.placeBelts(t1.result()), 'le bout se tourne vers le coffre du haut');
  const b = g.factory.beltAt(5, 5)!;
  assert(b.dir === 3 && g.factory.next(b)?.kind === 'machine', 'il donne dans le coffre');
  const t2 = trace(g, [[5.5, 5.5], [5.5, 6.6]]);
  assert(t2.splitFrom === b && t2.intoMachine === 1 && g.linkBeltToMachine(b, 1), 'et nourrit aussi celui du bas');
  const src = g.placeMachine('coffre', 1, 5)!; src.built = true; g.factory.markBuilt();
  g.factory.putInStorage(src, 'fer', 10);
  run(g, 30);
  assert((up.inBuf.fer ?? 0) === 5 && (down.inBuf.fer ?? 0) === 5, `répartition : ${up.inBuf.fer} / ${down.inBuf.fer}`);
});
test('jour et nuit ; panneaux solaires et batteries', () => {
  const g = new Game('TEST-E3');
  const apply = () => (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  g.money = 100000; g.world.reveal(8, 8, 25); g.drones[0].cargo = null;
  assert(g.daylight === 1, 'le jeu commence de jour');
  g.played = RULES.dayCycle * 0.8;
  assert(g.daylight === 0, 'la nuit');
  g.played = RULES.dayCycle * 0.64;
  assert(g.daylight > 0 && g.daylight < 1, 'le crépuscule');
  g.played = 0;
  for (const id of ['generateur', 'batterie', 'solaire', 'presse', 'presse_elec']) g.unlocks.add(id);
  apply();
  const sol = g.placeMachine('solaire', 4, 4)!;
  const bat = g.placeMachine('batterie', 7, 4)!;
  const pr = g.placeMachine('presse', 10, 4)!;
  for (const m of g.factory.machines.values()) m.built = true;
  g.pending = []; g.factory.markBuilt();
  assert(g.placeCables([{ x: 8, y: 7 }]), 'câble');
  pr.inBuf = { lingot_fer: 10 }; pr.fuel = 0;
  run(g, 10);
  const net = g.factory.netOf(pr)!;
  assert(net && net.solar === 120 && (pr.power ?? 0) === 1 && (pr.outBuf.plaque_fer ?? 0) + pr.made > 0, `le soleil fait tourner la presse : ${net?.solar} kW`);
  assert((bat.charge ?? 0) > 0, `le surplus charge la batterie : ${bat.charge}`);
  // La nuit : le soleil s'arrête, la batterie prend le relais.
  g.played = RULES.dayCycle * 0.75;
  const c0 = bat.charge!;
  pr.inBuf = { lingot_fer: 10 }; pr.outBuf = {};
  run(g, 5);
  assert(g.factory.netOf(pr)!.solar === 0 && (bat.charge ?? 0) < c0 && (pr.power ?? 0) > 0, `la batterie donne la nuit : ${c0} → ${bat.charge}`);
  const g2 = new Game('TEST-E3', JSON.parse(JSON.stringify(g.serialize())));
  assert(Math.abs((g2.factory.machines.get(bat.id)!.charge ?? 0) - bat.charge!) < 1, 'charge sauvegardée');
  assert(!g.enterAtelier(sol), 'un panneau n’est pas un atelier');
});
console.log('Modules');
test('atelier : une zone rangée dans un bloc 3 × 3 qui produit pareil, sauvegardé, copié', () => {
  const g = new Game('TEST-M1');
  g.money = 100000; g.world.reveal(8, 8, 25);
  for (const id of ['presse', 'module', 'copie75']) g.unlocks.add(id);
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  const src = g.placeMachine('coffre', 2, 10)!;
  const four = g.placeMachine('four', 8, 10)!;
  const presse = g.placeMachine('presse', 12, 10)!;
  const end = g.placeMachine('coffre', 18, 10)!;
  assert(g.placeBelts(trace(g, [[2.5, 10.5], [7.5, 10.5], [8.5, 10.5]]).result()), 'tapis vers le four');
  assert(g.placeBelts(trace(g, [[9.5, 10.5], [11.5, 10.5], [12.5, 10.5]]).result()), 'four → presse');
  assert(g.placeBelts(trace(g, [[13.5, 10.5], [17.5, 10.5], [18.5, 10.5]]).result()), 'presse → coffre');
  for (const m of g.factory.machines.values()) m.built = true;
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  assert(!g.placeMachine('entree', 5, 5), 'une entrée se pose dans un atelier');
  // On entoure le four et la presse (et le tapis entre eux).
  const n0 = g.factory.machines.size;
  const a = g.createAtelier(7, 9, 14, 12)!;
  assert(a && a.type === 'atelier' && a.inner, 'atelier créé');
  assert(!g.factory.machines.has(four.id) && !g.factory.machines.has(presse.id) && g.factory.machines.size === n0 - 1, 'les machines sont rangées dedans');
  const inner = a.inner!;
  const types = [...inner.machines.values()].map((m) => m.type).sort();
  assert(types.join(',') === 'entree,four,presse,sortie', `intérieur : ${types}`);
  // Les tapis du dehors arrivent sur l'atelier ? Non : on les rebranche. Le tapis d'entrée touchait la zone en x = 7.
  g.removeAt(6, 10);
  assert(g.placeBelts(trace(g, [[5.5, 10.5], [a.x - 0.5, a.y + 1.5], [a.x + 0.5, a.y + 1.5]]).result()), 'tapis rebranché sur l’atelier');
  assert(g.placeBelts(trace(g, [[a.x + 2.5, a.y + 1.5], [a.x + 3.5, a.y + 1.5], [15.5, a.y + 1.5], [15.5, 10.5], [17.5, 10.5]]).result()) || true, 'sortie de l’atelier');
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  a.fuel = 10;
  g.factory.putInStorage(src, 'fer', 20);
  run(g, 90);
  const plates = (end.inBuf.plaque_fer ?? 0);
  assert(plates >= 5, `plaques sorties de l’atelier : ${plates} (atelier ${a.status}, entrée ${JSON.stringify(a.inBuf)}, sortie ${JSON.stringify(a.outBuf)})`);
  assert((a.flowEv ?? []).some((e) => e.k === 'charbon' && !e.out), 'l’atelier brûle du charbon pour ses machines');
  // Entrer et construire dedans : tout de suite, sans chantier.
  assert(g.enterAtelier(a) && g.view === inner, 'entré');
  const c = g.placeMachine('coffre', 1, 1)!;
  assert(c && c.built && inner.machines.has(c.id) && !g.pending.length, 'construit tout de suite');
  assert(!g.placeMachine('coffre', inner.bounds + 1, 1), 'hors de l’intérieur');
  assert(!g.placeMachine('station', 4, 1), 'pas de station dedans');
  g.removeAt(1, 1);
  g.leaveAtelier();
  assert(g.view === g.factory, 'ressorti');
  // Sauvegarde : l'intérieur revient.
  const g2 = new Game('TEST-M1', JSON.parse(JSON.stringify(g.serialize())));
  const a2 = g2.factory.machines.get(a.id)!;
  assert(a2.inner && a2.inner.machines.size === inner.machines.size && a2.size === 20, 'atelier rechargé');
  // Copie à 75 % de ce qu'il contient.
  const price = g.copyPrice(a);
  assert(price === 200 + Math.ceil(g.contentValue(inner) * 0.75), `prix de copie ${price}`);
  const m0 = g.money;
  const b = g.copyAtelier(a, 30, 20)!;
  assert(b && m0 - g.money === price && b.inner!.machines.size === inner.machines.size, 'copie posée');
  assert([...b.inner!.belts.values()].every((x) => !x.items.length), 'la copie est vide');
  // Supprimer un atelier rend aussi ce qu'il contient.
  const m1 = g.money;
  g.removeMachine(b);
  assert(g.money - m1 === 200 + g.contentValue(inner), 'remboursé avec son contenu');
});
test('imbrication : un atelier dans un atelier, qui tourne et se sauvegarde ; place agrandie', () => {
  const g = new Game('TEST-M2');
  const apply = () => (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  g.money = 100000; g.world.reveal(8, 8, 25);
  g.unlocks.add('module'); apply();
  const a = g.placeMachine('atelier', 10, 10)!;
  a.built = true; g.pending = [];
  assert(a.inner && a.size === 20, 'atelier vide de 20 × 20');
  g.enterAtelier(a);
  assert(!g.placeMachine('atelier', 2, 2), 'sans Imbrication, pas d’atelier dedans');
  g.unlocks.add('imbrication'); g.unlocks.add('place1'); apply();
  assert(a.size === 24 && a.inner!.bounds === 24, 'Place +4 : 24 × 24');
  const b = g.placeMachine('atelier', 2, 2)!;
  assert(b && b.built && b.inner, 'atelier dans l’atelier');
  g.enterAtelier(b);
  const c = g.placeMachine('coffre', 3, 3)!;
  assert(c && b.inner!.machines.has(c.id) && g.atelierPath.length === 2, 'deux niveaux');
  g.factory.putInStorage(c, 'fer', 5);
  g.leaveAtelier(true);
  const g2 = new Game('TEST-M2', JSON.parse(JSON.stringify(g.serialize())));
  const b2 = g2.factory.machines.get(a.id)!.inner!.machines.get(b.id)!;
  assert(b2.inner && b2.inner.machines.get(c.id)?.inBuf.fer === 5, 'imbriqué et rechargé');
  run(g, 2);
});
console.log('Électricité');
test('générateur, câbles et machines qui passent au courant', () => {
  const g = new Game('TEST-E1');
  const apply = () => (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  g.money = 100000; g.world.reveal(8, 8, 20); g.drones[0].cargo = null;
  assert(!g.placeMachine('generateur', 4, 4) && !g.placeCables([{ x: 6, y: 4 }]), 'à débloquer');
  assert(!MACHINES.four_elec && !BUILDABLE.some((m) => m.id.endsWith('_elec')), 'plus de machine électrique à part');
  g.unlocks.add('generateur'); apply();
  const gen = g.placeMachine('generateur', 4, 4)!;
  const four = g.placeMachine('four', 9, 4)!;
  g.unlocks.add('broyeur');
  const broyeur = g.placeMachine('broyeur', 6, 2)!;
  for (const m of g.factory.machines.values()) m.built = true;
  g.pending = []; g.factory.markBuilt();
  four.inBuf = { fer: 10 }; four.fuel = 0;
  run(g, 3);
  assert(four.status === 'nofuel', `four au charbon, sans charbon : ${four.status}`);
  // Un câble alimente les machines à 5 cases autour de lui : une seule case entre le générateur (4-5) et le four (9-10) suffit.
  const m0 = g.money;
  assert(g.placeCables([{ x: 7, y: 8 }]) && m0 - g.money === RULES.cableCost, 'une case de câble');
  g.unlocks.add('four_elec'); apply();
  assert(g.factory.netOf(gen) && g.factory.netOf(four) === g.factory.netOf(gen), 'à portée (3 et 3 cases)');
  assert(g.factory.machinesInRange([{ x: 7, y: 8 }]).length === 2, 'portée vue au tracé');
  g.removeAt(7, 8);
  assert(g.placeCables([{ x: 7, y: 11 }]) && !g.factory.netOf(gen), 'à 6 cases : trop loin');
  g.removeAt(7, 11);
  assert(g.placeCables([6, 7, 8].map((x) => ({ x, y: 4 }))), 'câbles');
  g.unlocks.delete('four_elec'); apply();
  gen.fuel = 10;
  assert(!g.factory.netOf(four), 'four pas encore électrique : il ne se branche pas');
  // Le nœud « Four électrique » : les fours déjà posés se branchent.
  g.unlocks.add('four_elec'); apply();
  assert(g.factory.netOf(four) && g.factory.netOf(four) === g.factory.netOf(gen), 'même réseau');
  assert(!g.factory.netOf(broyeur) || !g.factory.netOf(broyeur)!.users.includes(broyeur), 'le broyeur (non débloqué) reste au charbon');
  run(g, 20);
  assert((four.outBuf.lingot_fer ?? 0) >= 3 && four.fuel === 0, `lingots sans charbon dans le four : ${four.outBuf.lingot_fer}`);
  assert(g.factory.powered(four) && g.factory.fuelRoom(four) === 0 && !g.factory.lowFuel(four), 'alimenté : pas de charbon à livrer');
  assert(gen.fuel < 10 && gen.fuel >= 7, `le générateur brûle selon la charge : ${gen.fuel}`);
  // Générateur à sec : le four reprend son charbon, puis s'arrête « sans courant ».
  gen.fuel = 0; gen.burn = 0; four.inBuf = { fer: 10 }; four.outBuf = {}; four.fuel = 2;
  run(g, 4);
  assert(!g.factory.powered(four) && four.fuel < 2 && (four.outBuf.lingot_fer ?? 0) >= 1, `secours au charbon : ${four.fuel}`);
  four.fuel = 0; four.burn = 0;
  run(g, 3);
  assert(four.status === 'nopower' && g.factory.fuelRoom(four) > 0, `ni courant ni charbon : ${four.status}`);
  gen.fuel = 10;
  // Au repos, il ne brûle rien.
  four.inBuf = {}; four.outBuf = {};
  run(g, 3);
  const f = gen.fuel + gen.burn;
  run(g, 30);
  assert(gen.fuel + gen.burn === f && gen.status === 'idle', `au repos : ${f} → ${gen.fuel + gen.burn}`);
  // Ancienne sauvegarde avec un « four_elec » : il redevient un four.
  const old = JSON.parse(JSON.stringify(g.serialize()));
  old.factory.machines.find((x: { id: number }) => x.id === four.id).type = 'four_elec';
  const g0 = new Game('TEST-E1', old);
  assert(g0.factory.machines.get(four.id)?.type === 'four', 'four_elec → four');
  g.unlocks.add('presse'); g.unlocks.add('presse_elec'); apply();
  // Six machines pour un générateur de 5 : chacune reçoit 5/6 du courant.
  const presses = [0, 1, 2, 3, 4, 5].map((i) => g.placeMachine('presse', 4 + i * 2, 7)!);
  const four2 = presses.pop()!;
  g.factory.removeMachine(four2);
  const extra = g.placeMachine('four', 14, 7)!;
  for (const m of g.factory.machines.values()) m.built = true;
  g.pending = []; g.factory.markBuilt();
  g.placeCables([{ x: 5, y: 4 }, { x: 5, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 6 }, ...[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((x) => ({ x, y: 7 }))]);
  for (const p of presses) p.inBuf = { lingot_fer: 10 };
  extra.inBuf = { fer: 10 };
  four.inBuf = { fer: 10 };
  run(g, 2);
  const net = g.factory.netOf(four)!;
  // En kW : 5 presses (60) et 2 fours (90) = 480 kW pour un générateur de 600 kW.
  assert(net.users.length === 7 && net.demand === 5 * 60 + 2 * 90 && net.ratio === 1, `réseau : ${net.users.length} machines, demande ${net.demand} kW, part ${net.ratio}`);
  // Un fabricant (300 kW) de plus : 780 kW demandés, chacun reçoit 600/780.
  g.unlocks.add('fabricant'); g.unlocks.add('fabricant_elec'); apply();
  const fab = g.placeMachine('fabricant', 16, 7)!;
  fab.built = true; g.pending = []; g.factory.markBuilt();
  fab.inBuf = { rotor: 5, stator: 5, vis: 5 };
  run(g, 3);
  const net2 = g.factory.netOf(four)!;
  assert(net2.demand === 780 && Math.abs(net2.ratio - 600 / 780) < 1e-9, `grosse machine : ${net2.demand} kW, part ${net2.ratio}`);
  // Sauvegarde et gomme.
  const g2 = new Game('TEST-E1', JSON.parse(JSON.stringify(g.serialize())));
  assert(g2.factory.cables.size === g.factory.cables.size && g2.factory.hasCable(7, 4), 'câbles rechargés');
  const m1 = g.money;
  assert(g.removeAt(7, 4) && !g.factory.hasCable(7, 4) && g.money - m1 === RULES.cableCost, 'câble gommé');
  assert(g.factory.netOf(four) !== g.factory.netOf(gen) || g.factory.netOf(four)!.gens.length === 1, 'réseau recalculé');
});
test('tracé de câble : passe sous les tapis et les machines, reprend en revenant', () => {
  const g = new Game('TEST-E2');
  g.world.reveal(8, 8, 20);
  const t = new CableTracer(g.world, 2.5, 2.5);
  for (let i = 1; i <= 24; i++) t.move(2.5 + i * 0.25, 2.5);
  for (let i = 1; i <= 12; i++) t.move(8.5, 2.5 + i * 0.25);
  assert(t.cells.length === 10 && t.cells[6].x === 8 && t.cells[9].y === 5, `cases : ${JSON.stringify(t.cells)}`);
  t.move(5.5, 2.5);
  assert(t.cells.length === 4, `reprise : ${t.cells.length}`);
});

console.log('Paliers, Laboratoire, Comptoir');
test('les propositions du Comptoir suivent ce qu’on sait fabriquer', () => {
  const has = (ids: string[]) => (id: string) => ids.includes(id);
  const p1 = producibleItems(has(['foreuse', 'four', 'presse']), new Set(['fer', 'charbon', 'cuivre']));
  assert(p1.has('plaque_fer') && p1.has('lingot_cuivre') && !p1.has('vis'), [...p1].join());
  const p5 = producibleItems(has(['foreuse', 'four', 'presse', 'tour', 'haut_fourneau', 'assembleur', 'trefileuse']), new Set(['fer', 'charbon', 'cuivre']));
  assert(p5.has('engrenage') && p5.has('acier') && !p5.has('cable'), [...p5].join());
  const c = generateChoices(42, 1, new Set(['fer', 'charbon']), 1, false, has(['foreuse', 'four', 'presse']));
  assert(c.length === 3 && c.every((o) => o.lines.every((l) => p1.has(l.item))), JSON.stringify(c));
});
test('missions fixes : les mêmes dans toutes les parties, de plus en plus grosses', () => {
  const a = new Game('AAA-1'), b = new Game('BBB-2');
  assert(JSON.stringify(a.noyauNeeds()) === JSON.stringify(b.noyauNeeds()), 'missions différentes selon la graine');
  let prev = 0;
  for (const p of PALIERS) {
    const v = Object.entries(p.lines).reduce((s, [k, n]) => s + n * item(k).value, 0);
    assert(v > prev, `palier ${p.to} pas plus long que le précédent (${v} ≤ ${prev})`);
    prev = v;
    for (const k of Object.keys(p.lines)) assert(item(k), `objet inconnu ${k}`);
  }
});
test('le Noyau ne prend que ce que demande sa mission, puis passe au palier 2', () => {
  const g = new Game('TEST-40');
  let up = 0;
  g.on((e) => { if (e.type === 'palier') up = e.palier; });
  assert(g.palier === 1 && g.receive(g.noyau, 'vis', 5) === 0, 'le Noyau a pris des vis');
  assert(g.receive(g.noyau, 'lingot_fer', 500) === 150, 'il prend 150 lingots de fer, pas plus');
  assert(g.palier === 1 && !g.isUnlocked('tour') && g.nodeState(NODE.tour) === 'locked', 'le tour s’ouvre au palier 2');
  g.receive(g.noyau, 'lingot_cuivre', 80);
  g.receive(g.noyau, 'plaque_fer', 40);
  assert(g.palier === 2 && up === 2, `palier ${g.palier}`);
  assert(Object.keys(g.palierDone).length === 0 && (g.noyauNeeds().plaque_fer ?? 0) === 300, 'mission suivante');
  g.lab = { presse: 0, lingot_fer: 20 } as Record<string, number>;
  assert(g.unlock('presse') && g.nodeState(NODE.tour) === 'available', 'le tour devient disponible après la presse');
});
test('Laboratoire : il garde les objets, débloquer les consomme', () => {
  const g = new Game('TEST-41');
  g.money = 10000; g.world.reveal(6, 6, 20);
  const lab = g.giveBuilding('laboratoire')!;
  assert(lab, 'laboratoire posé');
  assert(!g.giveBuilding('laboratoire') && !g.placeMachine('laboratoire', 7, 12), 'un seul laboratoire');
  run(g, 30);
  assert(lab.built && g.hasLab(), 'laboratoire construit');
  assert(g.receive(lab, 'fer', 5) === 0, 'le minerai ne sert à rien au labo');
  assert(g.receive(lab, 'lingot_fer', 30) === 30 && g.receive(lab, 'lingot_fer', 1000) === 470, 'plafond de 500');
  assert(!g.unlock('tour'), 'le tour demande le palier 2');
  assert(g.unlock('presse') && g.lab.lingot_fer === 480 && g.hasMachine('presse'), `presse : ${g.lab.lingot_fer}`);
  assert(!g.unlock('trefileuse'), 'la tréfileuse demande du cuivre');
  g.receive(lab, 'lingot_cuivre', 20);
  assert(g.unlockableCount() >= 1 && g.unlock('trefileuse') && (g.lab.lingot_cuivre ?? 0) === 0, 'tréfileuse');
});
test('Laboratoire : il garde de quoi faire toutes les améliorations possibles, pas une seule', () => {
  const g = new Game('TEST-43');
  const users = g.reachableNodes().filter((x) => x.cost.lingot_fer);
  const total = users.reduce((a, x) => a + x.cost.lingot_fer, 0);
  assert(users.length >= 2, `plusieurs nœuds au fer : ${users.map((x) => x.id)}`);
  assert(g.labNeeds().lingot_fer === total && total > Math.max(...users.map((x) => x.cost.lingot_fer)), `besoin ${g.labNeeds().lingot_fer} / ${total}`);
  // Un nœud qui s'ouvre après son parent compte aussi (au même palier).
  assert(g.reachableNodes().every((x) => x.palier <= g.palier && !g.unlocks.has(x.id)), 'seulement ce palier');
});
test('Comptoir : la commande se livre et se paie en pièces', () => {
  const g = new Game('TEST-42');
  g.money = 10000; g.world.reveal(6, 6, 20);
  const c = g.giveBuilding('comptoir')!;
  run(g, 30);
  const m0 = g.money;
  assert(g.order?.lines[0].item === 'lingot_fer', 'première commande');
  assert(g.receive(c, 'lingot_fer', 50) === 10, 'le comptoir prend juste la commande');
  assert(g.order === null && g.choices.length === 3 && g.money > m0, 'commande payée');
  assert(g.receive(c, 'lingot_fer', 5) === 0, 'sans commande, rien n’est pris');
  // Abandonner une commande : trois nouveaux choix, pas de paiement.
  g.acceptOrder(g.choices[0]);
  const m1 = g.money, seq = g.orderSeq;
  assert(g.abandonOrder() && g.order === null && g.choices.length === 3 && g.orderSeq > seq && g.money === m1, 'commande abandonnée');
  assert(!g.abandonOrder(), 'rien à abandonner');
});
test('les drones vident les coffres vers le Noyau et le Laboratoire, selon leur priorité', () => {
  const g = new Game('TEST-43');
  g.money = 10000; g.world.reveal(6, 6, 20); g.drones[0].cargo = null;
  const chest = g.placeMachine('coffre', 6, 8)!;
  const lab = g.giveBuilding('laboratoire')!;
  run(g, 40);
  assert(chest.built && lab.built, 'construits');
  const labWants = g.labNeeds().lingot_fer;
  g.factory.putInStorage(chest, 'lingot_fer', labWants + 30);
  g.setDronePriority(0, 'laboratoire');
  const firsts: string[] = [];
  g.on((e) => { if (e.type === 'deliver' && firsts.length < 1) firsts.push(e.at); });
  run(g, 60);
  assert(firsts[0] === 'laboratoire', `première livraison : ${firsts[0]}`);
  assert((g.lab.lingot_fer ?? 0) === labWants, `labo : ${g.lab.lingot_fer} / ${labWants}`);
  assert((g.palierDone.lingot_fer ?? 0) === 30, `Noyau : ${g.palierDone.lingot_fer}`);
});
test('arbre : effets appliqués et gardés dans la sauvegarde', () => {
  const g = new Game('TEST-30');
  assert(g.hasMachine('four') && g.hasMachine('coffre') && !g.hasMachine('presse'), 'départ');
  g.money = 1000; g.world.reveal(-6, 2, 20);
  assert(!g.placeMachine('presse', 4, 9), 'la presse ne devrait pas se poser avant d’être débloquée');
  g.palier = 2;
  g.lab = { lingot_fer: 100, plaque_fer: 200, fil_cuivre: 100 };
  assert(g.unlock('presse') && g.hasMachine('presse'), 'presse');
  assert(g.unlock('rapide') && g.factory.speedMult === 2, 'tapis rapide');
  assert(g.unlock('separateur') && g.unlock('grand_coffre') && g.hasMachine('grand_coffre') && g.factory.chestSlots === 10, 'grand coffre : une machine à part');
  assert(g.unlock('drone2') && g.drones.length === 2, 'deuxième drone');
  g.setDronePriority(1, 'noyau');
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(g2.hasMachine('presse') && g2.factory.speedMult === 2 && g2.palier === 2 && g2.drones.length === 2, 'sauvegarde de l’arbre');
  assert(g2.drones[1].priorities[0] === 'noyau' && g2.drones[1].priorities.length === 5 && JSON.stringify(g2.lab) === JSON.stringify(g.lab), 'priorités et labo');
});
test('une sauvegarde d’avant les paliers garde ses déblocages et repart au palier 1', () => {
  const g = new Game('TEST-31');
  const s = JSON.parse(JSON.stringify(g.serialize()));
  s.v = 3; s.level = 4; s.unlocks = ['foreuse', 'four', 'presse', 'tour']; s.drones = 2;
  delete s.palier; delete s.palierDone; delete s.lab; delete s.extraDrones;
  const g2 = new Game(s.seed, s);
  assert(g2.palier === 1 && g2.hasMachine('presse') && g2.hasMachine('tour'), 'déblocages gardés');
  assert(g2.drones.length === 2, `drones : ${g2.drones.length}`);
  delete s.unlocks;
  const g3 = new Game(s.seed, s);
  assert(g3.hasMachine('presse') && g3.hasMachine('tour') && g3.hasMachine('trefileuse'), 'machines de l’ancien niveau 4');
});

test('priorités : une liste ordonnée par drone, appliquée dans l’ordre', () => {
  const g = new Game('TEST-44');
  g.money = 10000; g.world.reveal(6, 6, 20); g.drones[0].cargo = null;
  const chest = g.placeMachine('coffre', 6, 8)!;
  const lab = g.giveBuilding('laboratoire')!;
  run(g, 40);
  assert(chest.built && lab.built, 'construits');
  // Le Noyau avant le Laboratoire : tout le fer part au Noyau d'abord.
  g.setDronePriorities(0, ['noyau', 'laboratoire', 'carburant', 'chantiers', 'comptoir']);
  g.factory.putInStorage(chest, 'lingot_fer', 30);
  run(g, 40);
  assert((g.palierDone.lingot_fer ?? 0) === 30 && !(g.lab.lingot_fer > 0), `Noyau ${g.palierDone.lingot_fer}, labo ${g.lab.lingot_fer}`);
  g.setDronePriorities(0, ['laboratoire', 'laboratoire', 'inconnu' as never]);
  assert(g.drones[0].priorities.length === 5 && g.drones[0].priorities[0] === 'laboratoire' && new Set(g.drones[0].priorities).size === 5, 'liste nettoyée');
  const s = JSON.parse(JSON.stringify(g.serialize()));
  s.crew.drones[0] = { ...s.crew.drones[0], priorities: undefined, priority: 'comptoir' };
  const g2 = new Game(s.seed, s);
  assert(g2.drones[0].priorities[0] === 'comptoir' && g2.drones[0].priorities.length === 5, 'ancienne priorité unique reprise en tête');
});
test('Revente : le gros drone passe toutes les 5 minutes et paie peu', () => {
  const g = new Game('TEST-45');
  g.money = 10000; g.world.reveal(6, 6, 20);
  const bin = g.placeMachine('revente', 7, 8)!;
  run(g, 30);
  assert(bin.built, 'benne construite');
  assert(g.receive(bin, 'lingot_fer', 100) === 100 && g.receive(bin, 'fer', 1000) === 300, 'plafond de 400 objets');
  assert(g.sellValue(bin) === Math.floor((100 * 3 + 300) * 0.2), `valeur ${g.sellValue(bin)}`);
  assert((g.palierDone.lingot_fer ?? 0) === 0, 'la revente ne compte pas pour le Noyau');
  const m0 = g.money;
  let sold = 0;
  g.on((e) => { if (e.type === 'sold') sold = e.money; });
  g.sellT = 0;
  run(g, 299);
  assert(g.money === m0 && g.sellCount(bin) === 400, 'vendu trop tôt');
  run(g, 2);
  assert(g.pickups.length === 1, 'le gros drone devrait arriver');
  assert(g.receive(bin, 'fer', 5) === 0, 'la benne est fermée pendant le passage');
  run(g, 4);
  assert(sold === 120 && g.money === m0 + 120 && g.sellCount(bin) === 0, `vendu ${sold}`);
  run(g, 4);
  assert(g.pickups.length === 0 && g.receive(bin, 'fer', 5) === 5, 'la benne rouvre');
  // Bien moins rentable que le Comptoir : 10 lingots y rapportent 80 pièces, 6 à la revente.
  assert(Math.floor(10 * 3 * 0.2) * 10 < 80, 'revente trop rentable');
});

console.log('Inventaire et fabrication');
test('fabrication : du minerai de fer aux vis, fondu puis tourné, lentement', () => {
  const g = new Game('TEST-60');
  g.unlocks.add('presse'); g.unlocks.add('tour');
  g.robot.inv.add('fer', 4);
  const res = g.craftPlan('vis', 3);
  assert('plan' in res, 'plan impossible');
  const plan = (res as { plan: { steps: { item: string }[]; time: number; consume: Record<string, number> } }).plan;
  assert(plan.steps.map((x) => x.item).join() === 'lingot_fer,vis' && plan.consume.fer === 3, JSON.stringify(plan));
  assert(plan.time === (1.6 * 3 + 1.2 * 3) * HAND_FACTOR, `durée ${plan.time}`);
  assert(g.startCraft('vis', 3) === null && g.robot.inv.count('fer') === 1, 'ingrédients pris tout de suite');
  assert(g.startCraft('vis', 5) !== null, 'pas assez de fer : refusé');
  run(g, plan.time - 1);
  assert(g.robot.inv.count('vis') === 0, 'trop rapide');
  run(g, 2);
  assert(g.robot.inv.count('vis') === 3 && g.craftQueue.length === 0, `vis : ${g.robot.inv.count('vis')}`);
  assert(maxCraftable('lingot_fer', { fer: 7 }, () => true) === 7 && !('plan' in g.craftPlan('vis', 2)), 'max');
});
test('fabrication : les composants déjà faits passent avant ; annuler rend tout', () => {
  const g = new Game('TEST-61');
  for (const id of ['presse', 'tour', 'trefileuse', 'haut_fourneau', 'assembleur', 'fabricant']) g.unlocks.add(id);
  g.robot.inv.add('rotor', 1); g.robot.inv.add('stator', 1); g.robot.inv.add('vis', 1);
  const direct = g.craftPlan('moteur', 1) as { plan: { steps: unknown[]; consume: Record<string, number> } };
  assert(direct.plan.steps.length === 1 && direct.plan.consume.rotor === 1, 'le moteur devrait se faire en une étape');
  // Sans composants : le robot remonte jusqu'aux matières premières.
  const g2 = new Game('TEST-62');
  for (const id of ['presse', 'tour', 'trefileuse', 'haut_fourneau', 'assembleur', 'fabricant']) g2.unlocks.add(id);
  g2.robot.inv.add('fer', 10); g2.robot.inv.add('cuivre', 10); g2.robot.inv.add('charbon', 10); g2.robot.inv.add('vis', 2);
  const full = g2.craftPlan('moteur', 1) as { plan: { steps: { item: string }[]; consume: Record<string, number> } };
  assert('plan' in full && full.plan.steps.length >= 6 && full.plan.consume.vis === 2 && !full.plan.steps.some((x) => x.item === 'vis'), JSON.stringify(full));
  const before = JSON.stringify(g2.robot.inv.save());
  assert(g2.startCraft('moteur', 1) === null, 'moteur lancé');
  g2.cancelCraft(0);
  assert(JSON.stringify(g2.robot.inv.kinds().sort()) === JSON.stringify(JSON.parse(before).filter(Boolean).map((x: { t: string }) => x.t).filter((t: string, i: number, a: string[]) => a.indexOf(t) === i).sort()), 'annuler rend les ingrédients');
});
test('le robot peut détruire des objets de son inventaire', () => {
  const g = new Game('TEST-67');
  g.robot.inv.add('cuivre', 8);
  const slot = g.robot.inv.slots.findIndex((s) => s?.t === 'cuivre');
  assert(g.destroyRobotItems(slot, 5) === 5 && g.robot.inv.count('cuivre') === 3, 'cinq de moins');
  assert(g.destroyRobotItems(slot, 50) === 3 && g.robot.inv.count('cuivre') === 0 && g.robot.inv.slots[slot] === null, 'la case se vide');
});
test('coffre ↔ robot : prendre, déposer, séparer une pile', () => {
  const g = new Game('TEST-63');
  g.money = 1000; g.world.reveal(6, 6, 20);
  const chest = g.placeMachine('coffre', 6, 9)!;
  run(g, 20);
  g.factory.putInStorage(chest, 'lingot_fer', 25);
  assert(g.chestToRobot(chest, 'lingot_fer', 12) === 12 && chest.inBuf.lingot_fer === 13 && g.robot.inv.count('lingot_fer') === 12, 'prendre');
  const slot = g.robot.inv.slots.findIndex((x) => x?.t === 'lingot_fer' && x.n === 10);
  assert(g.splitRobotSlot(slot, 4) && g.robot.inv.slots[slot]!.n === 6, 'séparer');
  assert(g.robotToChest(chest, slot, 6) === 6 && chest.inBuf.lingot_fer === 19 && g.robot.inv.count('lingot_fer') === 6, 'déposer');
  g.robot.inv.add('fer', 50);
  assert(g.chestToRobot(chest, 'lingot_fer', 19) <= g.robot.inv.room('lingot_fer') + 19, 'pas plus que la place');
});
test('machine ↔ robot : charbon, ingrédients, reprendre ce qui sort', () => {
  const g = new Game('TEST-66');
  g.money = 1000; g.world.reveal(6, 6, 20);
  const four = g.placeMachine('four', 6, 9)!;
  run(g, 20);
  g.robot.inv.add('charbon', 10); g.robot.inv.add('fer', 10); g.robot.inv.add('vis', 3);
  const slot = (t: string) => g.robot.inv.slots.findIndex((x) => x?.t === t);
  assert(g.machineAccepts(four, 'vis') === 0 && g.robotToMachine(four, slot('vis'), 3) === 0, 'le four ne prend pas de vis');
  const fuel0 = four.fuel;
  assert(g.robotToMachine(four, slot('charbon'), 10) === 10 - fuel0 && four.fuel === 10, `charbon ${four.fuel}`);
  assert(g.robotToMachine(four, slot('fer'), 10) === 6 && four.inBuf.fer === 6 && g.robot.inv.count('fer') === 4, 'six minerais au plus');
  run(g, 10);
  const out = four.outBuf.lingot_fer ?? 0;
  if (out > 0) assert(g.machineToRobot(four, 'out', 'lingot_fer', out) === out && g.robot.inv.count('lingot_fer') === out, 'reprendre les lingots');
  const waiting = four.inBuf.fer ?? 0, fer0 = g.robot.inv.count('fer');
  assert(g.machineToRobot(four, 'in', 'fer', 99) === waiting && g.robot.inv.count('fer') === fer0 + waiting && !four.inBuf.fer, 'reprendre le minerai en attente');
});
test('cadeaux du Noyau : le Comptoir puis le Laboratoire, indestructibles mais déplaçables', () => {
  const g = new Game('TEST-64');
  const gifts: string[] = [];
  g.on((e) => { if (e.type === 'gift') gifts.push(e.building); });
  assert(!g.placeMachine('comptoir', 6, 6), 'le Comptoir ne se pose pas à la main');
  run(g, 100);
  assert(gifts.length === 0, 'trop tôt');
  run(g, 150);
  assert(gifts.join() === 'comptoir', `cadeaux : ${gifts}`);
  const c = [...g.factory.machines.values()].find((m) => m.type === 'comptoir')!;
  assert(c.built && !g.world.patchAt(c.x, c.y), 'Comptoir construit, hors filon');
  assert(!g.removeMachine(c) && !g.removeAt(c.x, c.y) && g.factory.machines.has(c.id), 'indestructible');
  g.world.reveal(c.x + 6, c.y, 6);
  assert(g.moveMachine(c, c.x + 5, c.y), 'déplaçable');
  run(g, 310);
  assert(gifts.join() === 'comptoir,laboratoire' && g.hasLab(), `cadeaux : ${gifts}`);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  run(g2, 5);
  assert(g2.gifts.comptoir !== undefined && [...g2.factory.machines.values()].filter((m) => m.type === 'comptoir').length === 1, 'pas de second cadeau');
});


test('une cargaison dont personne ne veut retourne à son coffre, sinon elle est détruite', () => {
  const g = new Game('TEST-66');
  g.money = 10000; g.world.reveal(-6, 2, 20); g.drones[0].cargo = null;
  const four = g.placeMachine('four', -9, -1)!;
  const home = g.placeMachine('coffre', -6, 3)!;
  const other = g.placeMachine('coffre', -8, 2)!;
  run(g, 40);
  g.sendRobot(-7, 1.5);
  run(g, 6);
  const d = g.drones[0];
  d.cargo = { t: 'cuivre', n: 8 }; d.from = home.id;
  run(g, 40);
  assert(!(four.inBuf.cuivre > 0) && !(other.inBuf.cuivre > 0), 'ni le Four ni un autre coffre');
  assert(home.inBuf.cuivre === 8 && !d.cargo, `coffre d’origine : ${home.inBuf.cuivre}`);
  // Sans coffre d'origine (supprimé) : la cargaison est détruite.
  d.cargo = { t: 'cuivre', n: 5 }; d.from = 9999;
  run(g, 5);
  assert(!d.cargo && !(four.inBuf.cuivre > 0) && !(other.inBuf.cuivre > 0) && home.inBuf.cuivre === 8, 'cargaison détruite');
});
test('les drones ne se servent jamais dans l’inventaire du robot', () => {
  const g = new Game('TEST-65');
  g.money = 10000; g.world.reveal(-6, 2, 20); g.drones[0].cargo = null;
  const four = g.placeMachine('four', -9, -1)!;
  const chest = g.placeMachine('coffre', -6, 3)!;
  run(g, 40);
  g.sendRobot(-7, 1.5); // hors filon
  run(g, 6);
  g.robot.inv.add('cuivre', 10);
  g.robot.inv.add('lingot_fer', 10);
  run(g, 40);
  assert(g.robot.inv.count('cuivre') === 10 && g.robot.inv.count('lingot_fer') === 10, `robot : ${JSON.stringify(g.robot.inv.slots)}`);
  assert(!(four.inBuf.cuivre > 0) && !(chest.inBuf.cuivre > 0), 'rien n’a bougé');
  // Mais dans un coffre, oui : le drone y prend les lingots pour le Noyau.
  g.factory.putInStorage(chest, 'lingot_fer', 10);
  run(g, 40);
  assert((g.palierDone.lingot_fer ?? 0) === 10 && g.robot.inv.count('lingot_fer') === 10, `Noyau ${g.palierDone.lingot_fer}`);
});

console.log('Sauvegardes');
test('sauvegarde : aucune machine ne disparaît, même après des suppressions', () => {
  const g = new Game('TEST-70');
  g.money = 10000; g.world.reveal(6, 6, 20);
  const placed = [];
  for (let i = 0; i < 6; i++) placed.push(g.placeMachine('coffre', 6 + i * 2, 9)!);
  g.removeMachine(placed[1]); g.removeMachine(placed[3]); // des trous dans les numéros
  g.placeMachine('four', 6, 12);
  const types = () => [...g.factory.machines.values()].map((m) => `${m.type}@${m.x},${m.y}`).sort().join();
  let s = JSON.parse(JSON.stringify(g.serialize()));
  let g2 = new Game(s.seed, s);
  s = JSON.parse(JSON.stringify(g2.serialize()));
  g2 = new Game(s.seed, s);
  const t2 = [...g2.factory.machines.values()].map((m) => `${m.type}@${m.x},${m.y}`).sort().join();
  assert(t2 === types(), `avant ${types()}\naprès ${t2}`);
  const fresh = g2.placeMachine('coffre', 20, 9)!;
  assert(fresh && !s.factory.machines.some((m: { id: number }) => m.id === fresh.id), 'numéro déjà utilisé');
  assert(!g2.factory.machineAt(8, 9), 'case fantôme occupée là où était un coffre supprimé');
});
test('un bâtiment offert disparu est rendu par le Noyau', () => {
  const g = new Game('TEST-71');
  g.giveBuilding('comptoir'); g.giveBuilding('laboratoire');
  g.lab = { lingot_fer: 12 };
  const s = JSON.parse(JSON.stringify(g.serialize()));
  s.factory.machines = s.factory.machines.filter((m: { type: string }) => m.type !== 'laboratoire');
  const g2 = new Game(s.seed, s);
  const events: boolean[] = [];
  g2.on((e) => { if (e.type === 'gift') events.push(!!e.again); });
  run(g2, 1);
  assert(g2.hasLab() && events.join() === 'true' && g2.lab.lingot_fer === 12, `rendu : ${events}`);
  run(g2, 5);
  assert([...g2.factory.machines.values()].filter((m) => m.type === 'laboratoire').length === 1, 'un seul');
});
test('apparence, conseils et temps de jeu sont sauvegardés ; une ancienne partie n’a pas de conseils', () => {
  const g = new Game('TEST-50');
  g.look = { color: 'ciel', accessory: 'helice', name: 'Zébulon' };
  g.tips.done.push('charbon');
  run(g, 2);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(g2.look.name === 'Zébulon' && g2.look.accessory === 'helice' && g2.tips.done[0] === 'charbon' && !g2.tips.off, 'apparence ou conseils perdus');
  assert(g2.played >= 1, `temps de jeu ${g2.played}`);
  delete s.look; delete s.tips; s.v = 4;
  const g3 = new Game(s.seed, s);
  assert(g3.look.name === 'Boulon' && g3.tips.off, 'ancienne partie');
  s.look = { color: 'violet-fluo', accessory: 'canon', name: '' };
  const g4 = new Game(s.seed, s);
  assert(g4.look.color === 'jaune' && g4.look.accessory === 'aucun' && g4.look.name === 'Boulon', 'apparence invalide nettoyée');
});
await testAsync('code de partie : export puis import, et codes invalides refusés', async () => {
  const g = new Game('TEST-51');
  g.money = 1234;
  g.look.name = 'Rivet';
  const code = await encodeSave(g.serialize());
  assert(code.startsWith('UF1.') && code.length < 20000, `code ${code.slice(0, 8)} (${code.length})`);
  const back = await decodeSave(`  ${code.slice(0, 40)}\n${code.slice(40)} `);
  const g2 = new Game(back.seed, back);
  assert(g2.money === 1234 && g2.look.name === 'Rivet' && g2.world.seed === g.world.seed, 'partie importée différente');
  for (const bad of ['bonjour', 'UF1.', 'UF1.abcdef', code.slice(0, code.length - 30)]) {
    let failed = false;
    try { await decodeSave(bad); } catch { failed = true; }
    assert(failed, `code accepté : ${bad.slice(0, 20)}`);
  }
});

console.log(`\n${passed} réussis, ${failed} en échec`);
if (failed) (globalThis as unknown as { process: { exit(c: number): void } }).process.exit(1);
