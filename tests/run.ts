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
  const t = trace(g, [[2.5, 2.5], [2.5, 6.5], [2.5, 9.5], [4.5, 9.5]]);
  const r = t.result();
  assert(r[0].x === 2 && r[0].y === 4 && r[0].inDir === 1, `première case ${JSON.stringify(r[0])}`);
  assert(t.endTarget && g.factory.machineAt(t.endTarget.x, t.endTarget.y) === four, 'pas branché sur le four');
});

console.log('Usine');
function buildIronLine(g: Game): void {
  g.money = 10000;
  g.world.reveal(-6, 0, 14);
  assert(g.placeMachine('foreuse', -7, -3), 'foreuse fer');
  assert(g.placeMachine('foreuse', -7, 6), 'foreuse charbon');
  assert(g.placeMachine('four', -3, -3), 'four');
  // Fer → four
  assert(g.placeBelts(trace(g, [[-6.5, -2.5], [-3.5, -2.5], [-2.5, -2.5]]).result()), 'tapis fer');
  // Charbon → four (monte puis tourne)
  assert(g.placeBelts(trace(g, [[-6.5, 6.5], [-4.5, 6.5], [-4.5, -1.5], [-2.5, -1.5]]).result()), 'tapis charbon');
  // Four → Noyau
  assert(g.placeBelts(trace(g, [[-2.5, -2.5], [-0.5, -2.5], [-0.5, 0.5], [0.5, 0.5]]).result()), 'tapis noyau');
}

test('les drones construisent tous les fantômes', () => {
  const g = new Game('TEST-5');
  buildIronLine(g);
  assert(g.pending.length > 10, `chantiers : ${g.pending.length}`);
  run(g, 60);
  assert(g.pending.length === 0, `chantiers restants : ${g.pending.length}`);
});
test('foreuse → four à charbon → Noyau : la première commande se termine', () => {
  const g = new Game('TEST-6');
  buildIronLine(g);
  const xp0 = g.xp, money0 = g.money;
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
  g.world.reveal(-6, 0, 14);
  g.placeMachine('foreuse', -7, -3);
  g.placeMachine('four', -3, -3);
  g.placeBelts(trace(g, [[-6.5, -2.5], [-3.5, -2.5], [-2.5, -2.5]]).result());
  run(g, 40);
  const four = [...g.factory.machines.values()].find((m) => m.type === 'four')!;
  assert(four.made === 0 && four.status === 'nofuel', `état ${four.status}, fabriqués ${four.made}`);
});
test('les objets gardent leurs distances sur le tapis', () => {
  const g = new Game('TEST-8');
  g.money = 10000;
  g.world.reveal(-6, 0, 14);
  g.placeMachine('foreuse', -7, -3);
  g.placeBelts(trace(g, [[-6.5, -2.5], [-1.5, -2.5]]).result());
  run(g, 90);
  const items: number[] = [];
  for (const b of g.factory.belts.values()) for (const it of b.items) items.push(b.x + it.p);
  items.sort((a, b) => a - b);
  for (let i = 1; i < items.length; i++) assert(items[i] - items[i - 1] >= 0.49, `écart ${items[i] - items[i - 1]}`);
  assert(items.length >= 8, `objets en file : ${items.length}`);
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
  run(g, 50);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(g2.factory.belts.size === g.factory.belts.size, 'tapis');
  assert(g2.factory.machines.size === g.factory.machines.size, 'machines');
  assert(g2.money === g.money && g2.level === g.level, 'argent / niveau');
  run(g2, 60);
  assert(g2.order === null || g2.order.lines[0].done > 0, 'la production ne reprend pas');
});

console.log('Commandes');
test('les propositions suivent ce qu’on sait fabriquer', () => {
  const p1 = producibleItems(1, new Set(['fer', 'charbon', 'cuivre']));
  assert(p1.has('plaque_fer') && p1.has('lingot_cuivre') && !p1.has('vis'), [...p1].join());
  const p5 = producibleItems(5, new Set(['fer', 'charbon', 'cuivre']));
  assert(p5.has('engrenage') && p5.has('acier') && !p5.has('cable'), [...p5].join());
  const c = generateChoices(42, 1, new Set(['fer', 'charbon']), 1);
  assert(c.length === 3 && c.every((o) => o.lines.every((l) => p1.has(l.item))), JSON.stringify(c));
});

console.log(`\n${passed} réussis, ${failed} en échec`);
if (failed) (globalThis as unknown as { process: { exit(c: number): void } }).process.exit(1);
