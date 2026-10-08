// Tests de la simulation (sans rendu). Lancer : npm test
import { Game } from '../src/sim/game.ts';
import { BeltTracer } from '../src/sim/tracer.ts';
import { World } from '../src/world/world.ts';
import { producibleItems, generateChoices } from '../src/sim/orders.ts';
import { ITEM_LIST } from '../src/data/items.ts';
import { MACHINES } from '../src/data/machines.ts';

let failed = 0, passed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
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
test('foreuse → four à charbon → Noyau : la première commande se termine', () => {
  const g = new Game('TEST-6');
  buildIronLine(g);
  const xp0 = g.xp, money0 = g.money;
  run(g, 150);
  fuelAll(g);
  run(g, 120);
  const four = [...g.factory.machines.values()].find((m) => m.type === 'four')!;
  assert(four.made > 0, `le four n'a rien fabriqué (état ${four.status}, entrées ${JSON.stringify(four.inBuf)})`);
  assert(g.order === null && g.choices.length === 3, `commande : ${JSON.stringify(g.order?.lines)}`);
  assert(g.xp > xp0 || g.level > 1, 'pas d’XP');
  assert(g.money > money0, 'pas d’argent');
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
  g.points = 1; g.unlock('separateur');
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
test('absence : 10 % de production, 8 h au plus, rien ne se livre tout seul', () => {
  const g = new Game('TEST-13');
  buildIronLine(g);
  run(g, 150);
  // Une usine qui s'alimente toute seule : la foreuse de charbon remplit aussi celle du fer.
  fuelAll(g);
  for (const m of g.factory.machines.values()) if (m.built) { m.fuel = 10; m.burn = 1e6; }
  run(g, 50);
  const order = g.order;
  const doneBefore = order ? order.lines[0].done : 0;
  const ingots0 = g.stock.lingot_fer ?? 0;
  const r = g.catchUp(24 * 3600 * 1000, 20000)!;
  assert(r.counted === 8 * 3600, `durée comptée ${r.counted}`);
  const got = r.gained.lingot_fer ?? 0;
  assert(got > 100, `lingots gagnés : ${got}`);
  assert((g.stock.lingot_fer ?? 0) <= 500, 'stock du Noyau dépassé');
  assert(!order || order.lines[0].done === doneBefore, 'la commande a avancé pendant l’absence');
  assert((g.stock.lingot_fer ?? 0) === ingots0 + got, 'stock incohérent');
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
  assert(g2.money === g.money && g2.level === g.level, 'argent / niveau');
  run(g2, 150);
  assert(g2.order === null || g2.order.lines[0].done > 0, 'la production ne reprend pas');
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

console.log('Charbon');
test('une machine sans charbon attend ; un charbon dure 10 s de travail', () => {
  const g = new Game('TEST-20');
  g.money = 10000; g.world.reveal(-6, 2, 20); g.drones[0].cargo = null;
  const m = g.placeMachine('foreuse', -13, -5)!;
  run(g, 40);
  assert(m.built && m.made === 0 && m.status === 'nofuel', `état ${m.status}`);
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
test('les drones distribuent ce que mine le robot (charbon et minerai)', () => {
  const g = new Game('TEST-23');
  g.money = 10000; g.world.reveal(-6, 2, 20); g.drones[0].cargo = null;
  const four = g.placeMachine('four', -9, -1)!;
  const chest = g.placeMachine('coffre', -8, 2)!;
  run(g, 30);
  g.sendRobot(-12, -4.2); // filon de fer, le four est à portée
  run(g, 5);
  g.robot.inv.add('charbon', 10);
  run(g, 60);
  assert(four.fuel > 0 || four.burn > 0, `charbon du four : ${four.fuel}`);
  assert(four.made > 0 || (four.inBuf.fer ?? 0) > 0 || (chest.inBuf.fer ?? 0) > 0, `fer distribué : four ${JSON.stringify(four.inBuf)} coffre ${JSON.stringify(chest.inBuf)}`);
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
  assert((chest.inBuf.charbon ?? 0) > 3, `coffre : ${JSON.stringify(chest.inBuf)}`);
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

test('les drones livrent le minerai à la machine la plus proche du robot', () => {
  const g = new Game('TEST-26');
  g.money = 10000; g.world.reveal(-6, 2, 20); g.drones[0].cargo = null;
  const near = g.placeMachine('four', -9, -1)!;
  const far = g.placeMachine('four', -2, 8)!;
  run(g, 40);
  g.sendRobot(-7, 1.5); // hors filon : le robot ne mine pas
  run(g, 6);
  g.robot.inv.add('fer', 4);
  run(g, 15);
  assert((near.inBuf.fer ?? 0) > 0 && !(far.inBuf.fer > 0), `proche ${near.inBuf.fer}, loin ${far.inBuf.fer}`);
});

console.log('Commandes');
test('les propositions suivent ce qu’on sait fabriquer', () => {
  const has = (ids: string[]) => (id: string) => ids.includes(id);
  const p1 = producibleItems(has(['foreuse', 'four', 'presse']), new Set(['fer', 'charbon', 'cuivre']));
  assert(p1.has('plaque_fer') && p1.has('lingot_cuivre') && !p1.has('vis'), [...p1].join());
  const p5 = producibleItems(has(['foreuse', 'four', 'presse', 'tour', 'haut_fourneau', 'assembleur', 'trefileuse']), new Set(['fer', 'charbon', 'cuivre']));
  assert(p5.has('engrenage') && p5.has('acier') && !p5.has('cable'), [...p5].join());
  const c = generateChoices(42, 1, new Set(['fer', 'charbon']), 1, false, has(['foreuse', 'four', 'presse']));
  assert(c.length === 3 && c.every((o) => o.lines.every((l) => p1.has(l.item))), JSON.stringify(c));
});
test('arbre : 1 point au départ, 1 par niveau, effets appliqués', () => {
  const g = new Game('TEST-30');
  assert(g.points === 1 && g.hasMachine('four') && !g.hasMachine('presse'), `départ : ${g.points} points`);
  g.money = 1000; g.world.reveal(-6, 2, 20);
  assert(!g.placeMachine('presse', 4, 9), 'la presse ne devrait pas se poser avant d’être débloquée');
  assert(g.unlock('presse') && g.points === 0 && g.hasMachine('presse'), 'déblocage de la presse');
  assert(!g.unlock('tour'), 'plus de point : le tour reste fermé');
  g.addXp(125);
  assert(g.level === 2 && g.points === 1, `niveau ${g.level}, points ${g.points}`);
  assert(!g.unlock('assembleur'), 'l’assembleur demande le tour et le niveau 5');
  assert(g.unlock('rapide') && g.factory.speedMult === 2, 'tapis rapide');
  g.points = 5;
  assert(g.unlock('separateur') && g.unlock('grand_coffre') && g.factory.chestSlots === 30, 'grand coffre');
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(g2.hasMachine('presse') && g2.factory.speedMult === 2 && g2.points === g.points, 'sauvegarde de l’arbre');
});
test('arbre : une ancienne sauvegarde garde ses machines et reçoit ses points', () => {
  const g = new Game('TEST-31');
  g.addXp(125 + 250 + 375); // niveau 4
  const s = JSON.parse(JSON.stringify(g.serialize()));
  delete s.unlocks; delete s.points;
  const g2 = new Game(s.seed, s);
  assert(g2.level === 4 && g2.hasMachine('presse') && g2.hasMachine('tour') && g2.hasMachine('trefileuse') && g2.hasMachine('haut_fourneau'), 'machines du niveau 4');
  assert(g2.isUnlocked('separateur') && g2.points >= 0, `points ${g2.points}`);
});

console.log(`\n${passed} réussis, ${failed} en échec`);
if (failed) (globalThis as unknown as { process: { exit(c: number): void } }).process.exit(1);
