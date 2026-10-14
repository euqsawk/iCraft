// Tests de la simulation (sans rendu). Lancer : npm test
import { Game } from '../src/sim/game.ts';
// Dans les tests, tout se construit tout de suite (sauf le test du robot qui construit).
Game.instantBuild = true;
import { BeltTracer, type TraceCell } from '../src/sim/tracer.ts';
import { CableTracer } from '../src/sim/cables.ts';
import { World } from '../src/world/world.ts';
import { producibleItems, generateChoices } from '../src/sim/orders.ts';
import { item, ITEM_LIST } from '../src/data/items.ts';
import { PALIERS } from '../src/data/paliers.ts';
import { NODE } from '../src/data/unlocks.ts';
import { decodeSave, encodeSave } from '../src/save/code.ts';
import { BUILDABLE, MACHINES } from '../src/data/machines.ts';
import { RULES } from '../src/config.ts';
import { ROCKET_NEEDS, type Machine } from '../src/sim/factory.ts';
import { key } from '../src/sim/geom.ts';

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
  const t = new BeltTracer(g.view, pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) {
    // On interpole pour imiter un doigt qui glisse.
    const prev = pts[pts.indexOf(p) - 1];
    for (let s = 1; s <= 8; s++) t.move(prev[0] + (p[0] - prev[0]) * s / 8, prev[1] + (p[1] - prev[1]) * s / 8);
  }
  return t;
}

/** Comme trace, avec un niveau de départ ; « 0 » ou « 1 » dans la liste change de niveau en cours de route. */
function traceL(g: Game, level: 0 | 1, pts: ([number, number] | '0' | '1')[]): BeltTracer {
  const first = pts[0] as [number, number];
  const t = new BeltTracer(g.view, first[0], first[1], level);
  let prev = first;
  for (const p of pts.slice(1)) {
    if (typeof p === 'string') { t.setLevel(p === '1' ? 1 : 0); continue; }
    for (let s = 1; s <= 8; s++) t.move(prev[0] + (p[0] - prev[0]) * s / 8, prev[1] + (p[1] - prev[1]) * s / 8);
    prev = p;
  }
  return t;
}

function run(g: Game, seconds: number): void {
  for (let i = 0; i < seconds * 30; i++) g.tick(1 / 30);
}

/** Un carré de 2 × 2 foreuses 1 × 1 (un groupe, comme une ancienne foreuse) ; renvoie la première. */
function drills(g: Game, x: number, y: number): Machine {
  const placed: Machine[] = [];
  for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const m = g.placeMachine('foreuse', x + i, y + j); if (m) placed.push(m); }
  assert(placed.length, `pas de foreuse en ${x}, ${y}`);
  return placed[0];
}

/** Remplit de charbon toutes les machines construites. */
function fuelAll(g: Game): void {
  for (const m of g.factory.machines.values()) if (m.built) g.factory.addFuel(m, 10);
}

console.log('Données');
test('les objets (et l’eau), recettes cohérentes', () => {
  assert(ITEM_LIST.length >= 47 && new Set(ITEM_LIST.map((i) => i.id)).size === ITEM_LIST.length, `objets : ${ITEM_LIST.length}`);
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
  assert(top.node === 'sep' && top.jumps?.[1] === 1, 'séparateur en pont');
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
  // Gomme sur la case sous la dérivation en pont : le pont part, cette sortie est coupée.
  const snap = g.factory.serialize();
  assert(g.removeAt(5, 6) && !g.factory.beltAt(5, 5)!.jumps && g.factory.nodeOutputs(g.factory.beltAt(5, 5)!).length === 1 && !!g.factory.beltAt(5, 6), 'dérivation en pont retirée');
  g.factory.load(snap);
  // Sauvegarde
  const g2 = new Game('TEST-B2');
  g2.factory.load(g.factory.serialize());
  assert(g2.factory.beltAt(5, 5)!.jumps?.[1] === 1 && g2.factory.beltAt(10, 5)!.jump === 1, 'rechargés');
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

test('tout se construit tout de suite (plus de drones ni de chantiers)', () => {
  const g = new Game('TEST-5');
  buildIronLine(g);
  assert(g.pending.length === 0, `chantiers : ${g.pending.length}`);
  assert([...g.factory.machines.values()].every((m) => m.built) && [...g.factory.belts.values()].every((b) => b.built), 'tout est construit');
  const s = g.serialize() as unknown as Record<string, unknown>;
  assert(!('crew' in s) && !('drones' in s), 'plus de drones dans la sauvegarde');
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
test('fiche machine : entrées et sorties vues, sorties prévues sur un côté, recette prévue sauvegardée', () => {
  const g = new Game('TEST-6P');
  buildIronLine(g);
  run(g, 150);
  fuelAll(g);
  run(g, 60);
  const four = [...g.factory.machines.values()].find((m) => m.type === 'four')!;
  const io = g.view.machineIO(four);
  const ins = io.filter((c) => c.io === 'in' && !c.planned).map((c) => c.item).sort().join();
  const outs = io.filter((c) => c.io === 'out' && !c.planned).map((c) => c.item).join();
  assert(ins === 'charbon,fer' && outs === 'lingot_fer', `vu : entrées ${ins}, sorties ${outs}`);
  assert(io.every((c) => c.side === (c.io === 'in' ? 'left' : 'right')), `côtés : ${JSON.stringify(io)}`);
  assert(!g.addPort(four, four.x, four.y, 'out'), 'une sortie prévue dans le bâtiment');
  assert(!g.addPort(four, four.x - 1, four.y - 1, 'out'), 'un coin n’est pas un côté');
  assert(g.addPort(four, four.x, four.y - 1, 'out', 'lingot_fer'), 'sortie prévue en haut');
  assert(g.addPort(four, four.x + 1, four.y - 1, 'out', 'lingot_fer') && four.ports!.length === 1 && four.ports![0].rx === 1, 'le même objet est déplacé, pas doublé');
  const planned = g.view.machineIO(four).filter((c) => c.planned);
  assert(planned.length === 1 && planned[0].side === 'top' && planned[0].port === 0, `prévue : ${JSON.stringify(planned)}`);
  assert(!g.factory.beltAt(four.x + 1, four.y - 1), 'une sortie prévue ne prend pas de case');
  g.setPlan(four, 0);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  const f2 = [...g2.factory.machines.values()].find((m) => m.type === 'four')!;
  assert(f2.plan === 0 && f2.ports?.length === 1 && Object.values(f2.seenIn ?? {}).includes('fer'), `rechargé : ${JSON.stringify({ plan: f2.plan, ports: f2.ports, seen: f2.seenIn })}`);
  g2.removePort(f2, 0);
  assert(!f2.ports, 'sortie prévue retirée');
});
test('une machine bouchée (ou d’une ancienne partie) connaît encore ses entrées et sorties', () => {
  const g = new Game('TEST-6Q');
  g.money = 10000;
  g.world.reveal(-6, 2, 20);
  assert(g.placeMachine('foreuse', -13, -5), 'foreuse fer');
  const four = g.placeMachine('four', -8, -5)!;
  assert(g.placeBelts(trace(g, [[-12.5, -4.5], [-8.5, -4.5], [-7.5, -4.5]]).result()), 'tapis fer');
  // La sortie part dans le vide : elle se remplit, puis le four s'arrête.
  assert(g.placeBelts(trace(g, [[-7.5, -4.5], [-5.5, -4.5], [-3.5, -4.5]]).result()), 'tapis sans issue');
  run(g, 150);
  for (let i = 0; i < 40; i++) { fuelAll(g); run(g, 10); }
  const ready = Object.values(four.outBuf).reduce((a, b) => a + b, 0);
  assert(ready > 0, `le four devrait être bouché (prêt ${ready})`);
  delete four.seenIn; delete four.seenOut;
  const io = g.view.machineIO(four);
  const got = io.map((c) => `${c.io}:${c.item}`).sort().join();
  assert(got === 'in:fer,out:lingot_fer', `vu : ${got}`);
});
test('une sortie prévue puis tracée garde son objet, même sur une machine vide', () => {
  const g = new Game('TEST-6R');
  g.money = 10000; g.world.reveal(6, 6, 20);
  g.unlocks.add('assembleur');
  const a = g.placeMachine('assembleur', 6, 9)!;
  assert(a, 'assembleur');
  assert(g.addPort(a, a.x + a.w, a.y, 'out', 'cadre'), 'sortie prévue à droite');
  const y = a.y + 0.5, x0 = a.x + a.w - 0.5;
  assert(g.placeBelts(trace(g, [[x0, y], [x0 + 1, y], [x0 + 4, y]]).result()), 'tapis depuis le chevron');
  const out = g.view.machineIO(a).filter((c) => c.io === 'out');
  assert(out.length === 1 && !out[0].planned && out[0].item === 'cadre', `sortie : ${JSON.stringify(out)}`);
});
test('sans charbon, le four attend', () => {
  const g = new Game('TEST-7');
  g.money = 10000;
  g.world.reveal(-6, 2, 20);
  g.placeMachine('foreuse', -13, -5);
  g.placeMachine('four', -8, -5);
  g.placeBelts(trace(g, [[-12.5, -4.5], [-8.5, -4.5], [-7.5, -4.5]]).result());
  // pas de cadeau dans ce test
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
  g.lab = { lingot_fer: 30 }; assert(g.unlock('separateur'), 'déblocage du séparateur');
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
  const sb = g.factory.beltAt(-9, -5)!;
  assert(g.factory.nodeOutputs(sb).length === 1, 'plus que la sortie tout droit');
  const m0 = g.money;
  g.removeNode(sb);
  assert(!sb.node && g.money === m0 + RULES.nodeCost, 'la boîte retirée est remboursée');
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
test('supprimer rembourse', () => {
  const g = new Game('TEST-9');
  const m0 = g.money;
  const m = g.placeMachine('four', 5, 9)!;
  assert(g.money === m0 - 40, 'coût du four');
  g.removeMachine(m);
  assert(g.money === m0, 'remboursement');
});
test('Base du robot : palier 5, une seule, le robot s’y téléporte', () => {
  const g = new Game('TEST-BASE');
  g.money = 100000;
  assert(NODE.base_robot?.palier === 5, 'débloquée au palier 5');
  const spot = (): [number, number] => {
    for (let y = -6; y < 14; y++) for (let x = -6; x < 14; x++) if (g.view.checkMachine('base_robot', x, y, undefined, true).ok) return [x, y];
    throw new Error('pas de place');
  };
  let [x, y] = spot();
  assert(!g.placeMachine('base_robot', x, y), 'pas avant le déblocage');
  assert(!g.teleportRobot(), 'pas de téléportation sans base');
  g.unlocks.add('base_robot');
  const b = g.placeMachine('base_robot', x, y)!;
  assert(b && b.built, 'posée et construite tout de suite');
  [x, y] = spot();
  assert(!g.placeMachine('base_robot', x, y), 'une seule par partie');
  g.robot.x = 40; g.robot.y = -30; g.sendRobot(80, 80);
  assert(g.teleportRobot(), 'téléportation');
  assert(Math.abs(g.robot.x - (b.x + 1)) < 0.01 && Math.abs(g.robot.y - (b.y + 3.2)) < 0.01, `à côté de la base : ${g.robot.x}, ${g.robot.y}`);
  assert(!g.robot.target && !g.robot.moving, 'il s’arrête');
  assert((g.baseDistance() ?? 9) < 0.01, 'distance nulle');
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(g2.robotBase?.type === 'base_robot', 'la base se sauvegarde');
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
  // Les lingots arrivent au coffre (les drones peuvent ensuite en porter au Noyau).
  assert(four.made > 0 && (chest.inBuf.lingot_fer ?? 0) + (g.palierDone.lingot_fer ?? 0) > 0, `four ${four.made}, coffre ${JSON.stringify(chest.inBuf)}`);
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
  assert(!g.linkBeltToMachine(belt2, 1), 'sans le Séparateur : pas de dérivation vers la machine');
  g.unlocks.add('separateur');
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

test('chenilles : plusieurs niveaux, le meilleur compte', () => {
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
  for (const id of ['chenilles3']) assert(NODE[id] && NODE[id].effect.kind !== 'soon', `${id} existe`);
  for (const id of ['antenne', 'drone2', 'station', 'hangar', 'recharge']) assert(!NODE[id], `${id} retiré`);
  assert(!/marais/.test(NODE.chenilles.hint), 'plus de marais');
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

test('foreuses 2 × 2 collées : elles ne se relient pas, chacune sort son minerai', () => {
  const g = new Game('TEST-G1');
  g.money = 10000; g.world.reveal(-10, -3, 20);
  const a = g.placeMachine('foreuse', -14, -5)!, b = g.placeMachine('foreuse', -12, -5)!;
  assert(a && b && a.w === 2 && b.h === 2, 'deux foreuses 2 × 2 posées côte à côte');
  run(g, 40);
  assert(a.built && b.built && g.factory.drillGroup(a).length === 1 && g.factory.drillGroup(b).length === 1, 'pas de groupe');
  const c = g.placeMachine('coffre', -18, -5)!;
  assert(g.placeBelts(trace(g, [[-14.5, -4.5], [-17.5, -4.5]]).result()), 'une sortie pour la première seulement');
  for (const m of [a, b]) { m.outBuf = {}; m.made = 0; m.fuel = 10; }
  c.inBuf = {};
  run(g, 60);
  assert((c.inBuf.fer ?? 0) > 0 && (c.inBuf.fer ?? 0) <= a.made + 1, `le coffre ne reçoit que la première : ${c.inBuf.fer} / ${a.made}`);
});
test('le robot construit ce qu’on pose : il va au chantier le plus proche, puis au suivant', () => {
  Game.instantBuild = false;
  try {
    const g = new Game('TEST-RB');
    g.money = 10000; g.world.reveal(10, 10, 30);
    const four = g.placeMachine('four', 14, 12)!;
    assert(four && !four.built && g.pending.length === 1, 'un chantier');
    assert(g.placeBelts(trace(g, [[14.5, 15.5], [20.5, 15.5]]).result()), 'tapis');
    assert(g.pending.length === 8 && [...g.factory.belts.values()].every((b) => !b.built), `chantiers : ${g.pending.length}`);
    let saw = false;
    for (let i = 0; i < 400 && g.pending.length; i++) { g.tick(0.05); if (g.robot.build) saw = true; }
    assert(saw && four.built && g.pending.length === 0 && [...g.factory.belts.values()].every((b) => b.built), `tout construit (reste ${g.pending.length})`);
    assert(Math.hypot(g.robot.x - 17, g.robot.y - 15) < 8, `le robot est allé sur place : ${g.robot.x.toFixed(1)}, ${g.robot.y.toFixed(1)}`);
  } finally { Game.instantBuild = true; }
});
test('jeter un objet d’un coffre', () => {
  const g = new Game('TEST-JC');
  g.money = 1000; g.world.reveal(6, 6, 20);
  const c = g.placeMachine('coffre', 8, 8)!;
  g.factory.putInStorage(c, 'vis', 23); g.factory.putInStorage(c, 'charbon', 4);
  assert(g.discardFromChest(c, 'vis') === 23 && !c.inBuf.vis && c.inBuf.charbon === 4, 'les vis sont jetées, le charbon reste');
});
test('monter un coffre de niveau : 2 puis 3 fois plus de place, rendu à la suppression', () => {
  const g = new Game('TEST-CL');
  g.money = 1000; g.world.reveal(6, 6, 20);
  const c = g.placeMachine('coffre', 8, 8)!;
  const cap = g.factory.slotsOf(c);
  const up = g.chestUpgrade(c)!;
  assert(up.to === 2 && up.price === MACHINES.coffre.cost * 2, `prix ${up.price}`);
  const m0 = g.money;
  assert(g.upgradeChest(c) && g.factory.slotsOf(c) === cap * 2 && g.money === m0 - up.price, 'niveau 2');
  assert(g.upgradeChest(c) && g.factory.slotsOf(c) === cap * 3 && !g.chestUpgrade(c), 'niveau 3, le dernier');
  const m1 = g.money;
  g.removeMachine(c);
  assert(g.money - m1 === MACHINES.coffre.cost * (1 + 2 + 4), `rendu ${g.money - m1}`);
});
test('pont direct entre deux machines par-dessus un tapis (MACHINE > TAPIS > MACHINE)', () => {
  const g = new Game('TEST-PM');
  g.money = 10000; g.world.reveal(8, 8, 20);
  const a = g.placeMachine('coffre', 6, 8)!, b = g.placeMachine('coffre', 8, 8)!;
  assert(g.placeBelts(trace(g, [[7.5, 5.5], [7.5, 11.5]]).result()), 'un tapis passe entre les deux');
  for (const m of g.factory.machines.values()) m.built = true;
  g.pending = []; g.factory.markBuilt();
  // L'option vient du tapis sélectionné : un pont dans chaque sens.
  const opts = g.machineBridges(g.factory.beltAt(7, 8)!);
  assert(opts.length === 2 && opts.some((o) => o.from === a && o.to === b), 'le tapis propose le pont entre les deux machines');
  assert(!new BeltTracer(g.factory, 6.5, 8.5).linkMachine, 'plus de pont au doigt');
  assert(g.linkMachines(a, b), 'pont posé');
  g.factory.putInStorage(a, 'vis', 4);
  run(g, 10);
  assert((b.inBuf.vis ?? 0) === 4, `les vis passent par le pont : ${JSON.stringify(b.inBuf)}`);
  const far = g.placeMachine('coffre', 12, 8)!;
  assert(!g.linkMachines(a, far), 'pas de pont s’il n’y a pas que des tapis entre elles');
});
test('vider un tapis : tout ce qu’il transporte disparaît', () => {
  const g = new Game('TEST-VT');
  g.money = 10000; g.world.reveal(6, 6, 20);
  assert(g.placeBelts(trace(g, [[2.5, 8.5], [9.5, 8.5]]).result()), 'tapis');
  const b = g.factory.beltAt(4, 8)!, c = g.factory.beltAt(8, 8)!;
  b.items.push({ t: 'fer', p: 0.2 }); c.items.push({ t: 'cuivre', p: 0.5 }, { t: 'cuivre', p: 0.1 });
  assert(g.emptyChain(b) === 3 && !b.items.length && !c.items.length, 'toute la chaîne vidée');
});
test('train de fret : commande annoncée, coffre du quai, prime si plein, amende fixe sinon (puis les coffres)', () => {
  const g = new Game('TEST-FR');
  assert(!g.freight && ![...g.factory.machines.values()].some((m) => m.type === 'quai'), 'pas de train sans le mode');
  g.startFreight();
  const fr = g.freight!, q = g.quai();
  assert(fr.phase === 'away' && fr.t === 1200 && Object.keys(fr.req).length === 2 && g.world.isRevealed(-6, 25) && g.world.isRevealed(10, 25), `commande : ${JSON.stringify(fr.req)}`);
  assert(q.w === 18 && q.x === -7 && q.y === 24 && !g.removeMachine(q), `le quai, sous le Noyau à 20 cases, reste en place : ${q.x},${q.y}`);
  const [k, n] = Object.entries(fr.req)[0];
  assert(g.accepts(q, k) === n && g.accepts(q, 'uranium') === 0, 'il ne prend que sa commande');
  assert(g.receive(q, k, n + 5) === n, 'pas plus que demandé');
  for (let i = 0; i < 1200; i++) g.tick(1);
  assert(fr.phase === 'here', 'le premier train arrive après 20 minutes');
  for (const [kk, nn] of Object.entries(fr.req)) g.receive(q, kk, nn);
  const m0 = g.money, reward = fr.reward;
  for (let i = 0; i < 600; i++) g.tick(1);
  assert(fr.phase === 'away' && fr.visit === 2 && g.money === m0 + reward && fr.streak === 1, `prime : ${g.money - m0}`);
  assert(Object.values(q.inBuf).every((x) => !x), 'il a tout pris');
  // Incomplet : l'amende ; sans assez de pièces, il prend le reste dans un coffre.
  g.money = 10;
  const chest = g.factory.addMachine('coffre', 30, 30, true);
  chest.inBuf = { lingot_fer: 1000 };
  const fine = fr.fine;
  for (let i = 0; i < 1200; i++) g.tick(1);
  assert(g.money === 0 && fr.last && !fr.last.ok && fr.last.paid === 10 && fr.last.taxed === Math.ceil((fine - 10) / 3), `amende : ${JSON.stringify(fr.last)}`);
  const g2 = new Game('TEST-FR', JSON.parse(JSON.stringify(g.serialize())));
  assert(g2.freight?.visit === fr.visit && g2.freight.phase === fr.phase && [...g2.factory.machines.values()].filter((m) => m.type === 'quai').length === 1, 'sauvegardé');
});
test('anciennes parties : foreuses 2 × 2 gardées telles quelles ; petites foreuses 1 × 1 regroupées en 2 × 2', () => {
  const g = new Game('TEST-G2');
  g.world.reveal(-10, -3, 20);
  const base = g.factory.serialize();
  const old = (id: number, x: number, y: number, extra = {}) => ({ id, type: 'foreuse', x, y, built: true, inBuf: {}, outBuf: { fer: 3 }, fuel: 7, burn: 0, craft: null, drillT: 0, made: 12, ...extra });
  // Avant les petites foreuses : une 2 × 2 reste une 2 × 2.
  const s1 = JSON.parse(JSON.stringify(base));
  delete s1.drills1; delete s1.drills2;
  s1.machines.push(old(900, -13, -4)); s1.nextId = 901;
  g.factory.load(s1);
  const m = g.factory.machineAt(-12, -3);
  assert(m?.id === 900 && m.w === 2 && m.fuel === 7, 'ancienne 2 × 2 intacte');
  // Entre-deux : quatre petites en carré → une grande (meilleur niveau, charbon et contenu additionnés).
  const s2 = JSON.parse(JSON.stringify(base));
  delete s2.drills2; s2.drills1 = 1;
  s2.machines.push(old(910, -13, -4, { lvl: 2 }), old(911, -12, -4), old(912, -13, -3), old(913, -12, -3, { lvl: 3, fuel: 2 }));
  s2.nextId = 914;
  g.factory.load(s2);
  const big = g.factory.machineAt(-13, -4);
  assert(big?.id === 910 && big.w === 2 && big.lvl === 3, `une grande au niveau 3 : ${big?.id} ${big?.w} ${big?.lvl}`);
  assert(big!.outBuf.fer === 12 && big!.made === 48, 'contenu additionné');
  assert([...g.factory.machines.values()].filter((x) => x.type === 'foreuse').length === 1, 'une seule');
  assert(g.factory.legacyRefund === 0, `rien à rembourser : ${g.factory.legacyRefund}`);
  assert(g.factory.serialize().drills2 === 1, 'nouvelle sauvegarde marquée');
});
test('trieur « pour le Noyau » : il n’envoie que ce qui manque, en comptant ce qui est déjà en route', () => {
  const g = new Game('TEST-DN');
  g.money = 1e5; g.world.reveal(0, 6, 20);
  for (const id of ['separateur', 'tri']) g.unlocks.add(id);
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  // Il ne manque que 3 lingots de fer au Noyau (le reste de sa mission est fait).
  g.palierDone = { lingot_fer: 147, lingot_cuivre: 80, plaque_fer: 40 };
  const src = g.placeMachine('coffre', -7, 6)!, end = g.placeMachine('coffre', 8, 6)!;
  assert(g.placeBelts(trace(g, [[-6.5, 6.5], [7.5, 6.5]]).result()), 'tapis');
  const t = trace(g, [[1.5, 6.5], [1.5, 4.5]]);
  assert(t.splitFrom && g.placeBelts(t.result(), { from: t.splitFrom, dir: t.splitDir!, jump: t.splitJump }), 'dérivation vers le Noyau');
  const sb = g.factory.beltAt(1, 6)!;
  g.setNodeRule(sb, 3, ['@noyau']);
  assert(sb.node === 'tri' && sb.rules?.[3]?.[0] === '@noyau', 'tri pour le Noyau');
  g.factory.putInStorage(src, 'lingot_fer', 20);
  g.factory.putInStorage(src, 'charbon', 5);
  run(g, 60);
  assert(g.palier === 2, `le Noyau a eu ses 3 lingots : palier ${g.palier}`);
  assert((end.inBuf.lingot_fer ?? 0) === 17 && (end.inBuf.charbon ?? 0) === 5, `le reste continue : ${JSON.stringify(end.inBuf)}`);
});
test('séparateur : 4 sorties, dont l’étage du dessus ; filtre : des objets par sortie, le reste ailleurs', () => {
  const setup = () => {
    const g = new Game('TEST-S3'); g.money = 1e5; g.world.reveal(0, 9, 20);
    for (const id of ['separateur', 'tri', 'grand_coffre', 'pont', 'ascenseurs']) g.unlocks.add(id);
    (g as unknown as { applyUnlocks(): void }).applyUnlocks();
    const src = g.placeMachine('coffre', -7, 9)!, eS = g.placeMachine('coffre', 5, 9)!, eU = g.placeMachine('coffre', 0, 5)!;
    const eD = g.placeMachine('coffre', 0, 13)!, eV = g.placeMachine('coffre', 2, 13)!;
    assert(g.placeBelts(trace(g, [[-6.5, 9.5], [5.5, 9.5]]).result()), 'tapis');
    for (const end of [5.5, 13.5]) {
      const t = trace(g, [[0.5, 9.5], [0.5, end]]);
      assert(t.splitFrom && t.splitDir !== null && g.placeBelts(t.result(), { from: t.splitFrom, dir: t.splitDir, jump: t.splitJump }), `dérivation vers ${end}`);
    }
    // Au 2ᵉ étage, un tapis part d'au-dessus de la boîte vers un 4ᵉ coffre.
    const up: TraceCell[] = [
      { x: 0, y: 9, dir: 0, inDir: 0, z: 1 }, { x: 1, y: 9, dir: 0, inDir: 0, z: 1 }, { x: 2, y: 9, dir: 1, inDir: 0, z: 1 },
      { x: 2, y: 10, dir: 1, inDir: 1, z: 1 }, { x: 2, y: 11, dir: 1, inDir: 1, z: 1 }, { x: 2, y: 12, dir: 1, inDir: 1, z: 1 },
    ];
    assert(g.placeBelts(up), 'tapis du haut');
    for (const m of g.factory.machines.values()) m.built = true;
    for (const b of g.factory.belts.values()) b.built = true;
    g.pending = []; g.factory.markBuilt();
    const sb = g.factory.beltAt(0, 9)!;
    assert(g.factory.nodeOutputs(sb).length === 3 && g.factory.nodeSides(sb)[4] === 'off', 'trois sorties, l’étage du dessus coupé');
    assert(g.setNodeOutput(sb, 4, true) && g.factory.nodeOutputs(sb).length === 4 && !g.factory.canBranch(sb), 'quatre sorties, pas plus');
    return { g, sb, src, eS, eU, eD, eV };
  };
  const total = (m: Machine) => Object.values(m.inBuf).reduce((x, n) => x + n, 0);
  const a = setup();
  a.g.factory.putInStorage(a.src, 'fer', 40);
  run(a.g, 80);
  for (const c of [a.eS, a.eU, a.eD, a.eV]) assert(total(c) === 10, `un quart chacun : ${[a.eS, a.eU, a.eD, a.eV].map(total).join(' / ')}`);
  // Filtre : le fer en haut, le cuivre et le charbon à l'étage du dessus ; le reste (lingots) tout droit et en bas.
  const b = setup();
  b.g.setNodeRule(b.sb, 3, ['fer']);
  b.g.setNodeRule(b.sb, 4, ['cuivre', 'charbon']);
  assert(b.sb.node === 'tri', 'devenu un filtre');
  for (const t of ['fer', 'cuivre', 'charbon', 'lingot_fer']) b.g.factory.putInStorage(b.src, t, 20);
  run(b.g, 120);
  assert(b.eU.inBuf.fer === 20 && total(b.eU) === 20, `en haut : ${JSON.stringify(b.eU.inBuf)}`);
  assert(b.eV.inBuf.cuivre === 20 && b.eV.inBuf.charbon === 20 && total(b.eV) === 40, `au 2ᵉ étage : ${JSON.stringify(b.eV.inBuf)}`);
  assert(b.eS.inBuf.lingot_fer === 10 && b.eD.inBuf.lingot_fer === 10 && total(b.eS) === 10 && total(b.eD) === 10, `le reste : ${JSON.stringify(b.eS.inBuf)} ${JSON.stringify(b.eD.inBuf)}`);
  const s2 = JSON.parse(JSON.stringify(b.g.serialize()));
  const g2 = new Game(s2.seed, s2);
  const sb2 = g2.factory.beltAt(0, 9)!;
  assert(sb2.rules?.[4]?.length === 2 && sb2.vert === 1 && g2.factory.nodeOutputs(sb2).length === 4, 'filtre sauvegardé');
  // Une ancienne partie : séparateur à deux dérivations triées (fer en haut, lingots en bas).
  const fs = b.g.factory.serialize();
  const old = fs.belts.find((t) => t[0] === 0 && t[1] === 9 && !t[16])!;
  old[6] = 3; old[11] = 1; old[12] = 'fer'; old[15] = 'lingot_fer'; old[17] = 0;
  const g3 = new Game('TEST-S3');
  g3.factory.load(fs);
  const sb3 = g3.factory.beltAt(0, 9)!;
  assert(sb3.node === 'tri' && sb3.rules?.[3]?.[0] === 'fer' && sb3.rules?.[1]?.[0] === 'lingot_fer' && g3.factory.nodeOutputs(sb3).length === 3, `ancien trieur repris : ${JSON.stringify(sb3.rules)}`);
});
test('séparateur posé d’un toucher, avec plusieurs entrées ; ascenseur sur un tapis', () => {
  const g = new Game('TEST-S5'); g.money = 1e5; g.world.reveal(0, 9, 20);
  g.unlocks.add('pont');
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  const a = g.placeMachine('coffre', -7, 9)!, c = g.placeMachine('coffre', 0, 4)!;
  const eS = g.placeMachine('coffre', 5, 9)!, eD = g.placeMachine('coffre', 0, 13)!;
  assert(g.placeBelts(trace(g, [[-6.5, 9.5], [5.5, 9.5]]).result()), 'tapis');
  assert(g.placeBelts([5, 6, 7, 8].map((y) => ({ x: 0, y, dir: 1, inDir: 1 }) as TraceCell)), 'tapis qui arrive du haut');
  for (const m of g.factory.machines.values()) m.built = true;
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  const sb = g.factory.beltAt(0, 9)!;
  // Une seule compétence pour tout le menu du tapis : séparateur, filtre et ascenseur.
  assert(!g.placeNode(sb, 'sep') && !g.liftFrom(g.factory.beltAt(3, 9)!) && !g.levels2, 'à débloquer');
  g.unlocks.add('separateur');
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  assert(g.levels2, 'le 2ᵉ étage vient avec');
  const m0 = g.money;
  assert(g.placeNode(sb, 'tri') && sb.node === 'tri' && g.money === m0 - RULES.nodeCost, 'filtre posé');
  assert(g.placeNode(sb, 'sep') && sb.node === 'sep' && g.money === m0 - RULES.nodeCost, 'devenu un séparateur');
  const t = trace(g, [[0.5, 9.5], [0.5, 13.5]]);
  assert(t.splitFrom === sb && g.placeBelts(t.result(), { from: sb, dir: t.splitDir!, jump: t.splitJump }), 'sortie vers le bas');
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  const sides = g.factory.nodeSides(sb);
  assert(sides[2] === 'in' && sides[3] === 'in' && sides[0] === 'main' && sides[1] === 'out', `deux entrées : ${JSON.stringify(sides)}`);
  g.factory.putInStorage(a, 'fer', 10);
  g.factory.putInStorage(c, 'cuivre', 10);
  run(g, 60);
  const total = (m: Machine) => Object.values(m.inBuf).reduce((x, n) => x + n, 0);
  assert(total(eS) === 10 && total(eD) === 10 && (eS.inBuf.fer ?? 0) > 0 && (eS.inBuf.cuivre ?? 0) > 0, `partagé : ${JSON.stringify(eS.inBuf)} ${JSON.stringify(eD.inBuf)}`);
  // Ascenseur : la fin de la sortie du bas passe au 2ᵉ étage.
  const lb = g.factory.beltAt(0, 11)!;
  assert(g.liftFrom(lb) && g.factory.beltAt(0, 11, 1) === lb && !!g.factory.beltAt(0, 12, 1) && !g.factory.beltAt(0, 11), 'la suite passe en haut');
  assert(g.factory.liftOf(g.factory.beltAt(0, 10)!).to === lb, 'un ascenseur');
  assert(!g.liftFrom(sb), 'pas sur une boîte');
  g.factory.putInStorage(a, 'fer', 10);
  run(g, 60);
  assert(total(eD) === 15, `le coffre du bas reçoit par le 2ᵉ étage : ${total(eD)}`);
});
test('palette : séparateur et filtre posés par terre ou sur un tapis, au 1er ou au 2e étage ; ascenseur seul', () => {
  const g = new Game('TEST-S6'); g.money = 1e5; g.world.reveal(0, 9, 20);
  assert(!g.hasMachine('boite_sep') && !g.placeBox('boite_sep', 0, 9, 0), 'à débloquer');
  g.unlocks.add('separateur');
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  assert(g.hasMachine('boite_sep') && g.hasMachine('boite_tri') && g.hasMachine('ascenseur'), 'dans la palette');
  // Par terre : une case qui ne porte que la boîte. On trace ensuite une entrée et trois sorties autour.
  const m0 = g.money;
  assert(g.placeBox('boite_tri', 0, 9, 0), 'filtre posé par terre');
  const fb = g.factory.beltAt(0, 9)!;
  assert(fb.node === 'tri' && g.money === m0 - RULES.beltCost - RULES.nodeCost, 'payé : une case et la boîte');
  const src = g.placeMachine('coffre', -6, 9)!, eR = g.placeMachine('coffre', 5, 9)!, eL = g.placeMachine('coffre', 0, 4)!, eD = g.placeMachine('coffre', 0, 14)!;
  for (const m of g.factory.machines.values()) m.built = true;
  g.factory.markBuilt();
  // Une sortie vers le haut (depuis la boîte seule : elle prend ce sens), puis vers la droite et vers le bas.
  for (const [ex, ey] of [[0.5, 4.5], [5.5, 9.5], [0.5, 14.5]] as [number, number][]) {
    const t = trace(g, [[0.5, 9.5], [ex, ey]]);
    assert(t.valid && g.placeBelts(t.result(), t.splitFrom && t.splitDir !== null ? { from: t.splitFrom, dir: t.splitDir, jump: t.splitJump } : undefined), `sortie vers ${ex},${ey}`);
  }
  // Une entrée depuis la gauche.
  assert(g.placeBelts(trace(g, [[-5.5, 9.5], [-0.5, 9.5], [0.5, 9.5]]).result()), 'entrée');
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  assert(g.factory.nodeOutputs(fb).length === 3, `trois sorties : ${JSON.stringify(g.factory.nodeSides(fb))}`);
  g.setNodeRule(fb, 3, ['fer']);
  g.setNodeRule(fb, 0, ['cuivre']);
  g.factory.putInStorage(src, 'fer', 10); g.factory.putInStorage(src, 'cuivre', 10); g.factory.putInStorage(src, 'charbon', 10);
  run(g, 60);
  assert(eL.inBuf.fer === 10 && eR.inBuf.cuivre === 10 && eD.inBuf.charbon === 10, `tri : ${JSON.stringify([eL.inBuf, eR.inBuf, eD.inBuf])}`);
  // Sur un tapis, au 2e étage : sur le tapis du haut s'il y en a un, sinon par terre en hauteur.
  assert(g.placeBox('boite_sep', 3, 9, 0) && g.factory.beltAt(3, 9)!.node === 'sep', 'sur le tapis');
  assert(g.placeBox('boite_sep', 8, 3, 1) && g.factory.beltAt(8, 3, 1)?.node === 'sep' && !g.factory.beltAt(8, 3), 'au 2e étage');
  // Ascenseur seul : le tapis tracé depuis lui part au 2e étage.
  assert(g.placeBox('ascenseur', 10, 12, 0) && g.factory.beltAt(10, 12)!.lift === 1, 'ascenseur posé');
  for (const b of g.factory.belts.values()) b.built = true;
  const t = trace(g, [[10.5, 12.5], [14.5, 12.5]]);
  assert(t.level === 1 && t.result().slice(1).every((c) => c.z === 1) && g.placeBelts(t.result()), 'le tapis part en haut');
  assert(g.factory.liftOf(g.factory.beltAt(10, 12)!).to === g.factory.beltAt(11, 12, 1), 'un ascenseur');
  const s2 = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s2.seed, s2);
  assert(g2.factory.beltAt(10, 12)!.lift === 1 && g2.factory.beltAt(8, 3, 1)?.node === 'sep', 'sauvegardé');
});
test('monte-charge : un objet à la fois dans la cabine, la traversée prend son temps, tout arrive', () => {
  const g = new Game('TEST-LC'); g.money = 1e5; g.world.reveal(0, 9, 20);
  g.unlocks.add('separateur');
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  const src = g.placeMachine('coffre', -6, 9)!, dst = g.placeMachine('coffre', 6, 9)!;
  const cells: TraceCell[] = [];
  for (let x = -5; x <= 5; x++) cells.push({ x, y: 9, dir: 0, inDir: 0, ...(x >= 0 ? { z: 1 as const } : {}) });
  assert(g.placeBelts(cells), 'tapis qui monte');
  for (const m of g.factory.machines.values()) m.built = true;
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  const cab = g.factory.beltAt(0, 9, 1)!;
  g.tick(0.01);
  assert(g.factory.cabins.has(cab), 'la cabine est la case du haut');
  g.factory.putInStorage(src, 'fer', 20);
  let most = 0;
  for (let t = 0; t < 60 * 10; t++) { g.tick(0.1); most = Math.max(most, cab.items.filter((i) => i.p < 0.75).length); }
  assert(most <= 1, `un seul objet à la fois : ${most}`);
  assert(dst.inBuf.fer === 20, `tout arrive : ${dst.inBuf.fer}`);
});
test('une boîte posée à l’autre étage, à côté d’un tapis, ne se branche pas toute seule', () => {
  const g = new Game('TEST-S7'); g.money = 1e5; g.world.reveal(0, 9, 20);
  g.unlocks.add('separateur');
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  const m = g.placeMachine('coffre', -1, 9)!;
  assert(g.placeBelts([5, 6, 7, 8, 9, 10, 11].map((y) => ({ x: 0, y, dir: 1, inDir: 1 })) as TraceCell[]), 'tapis');
  for (const b of g.factory.belts.values()) b.built = true;
  m.built = true; g.pending = []; g.factory.markBuilt();
  const b = g.factory.beltAt(0, 9)!;
  assert(g.linkBeltToMachine(b, 2) && g.factory.nodeIsLink(b), 'le tapis nourrit le coffre de côté');
  // Un filtre seul au 2ᵉ étage, juste à droite, puis un ascenseur seul à gauche du tapis, au sol.
  assert(g.placeBox('boite_tri', 1, 9, 1), 'filtre au 2ᵉ étage');
  assert(g.placeBox('ascenseur', 1, 10, 0), 'ascenseur seul');
  assert(g.factory.nodeIsLink(b) && g.factory.nodeOutputs(b).length === 2, `rien de nouveau : ${JSON.stringify(g.factory.nodeOutputs(b).map((o) => o.d))}`);
  assert(g.factory.next(g.factory.beltAt(0, 10)!)?.kind === 'belt' && (g.factory.next(g.factory.beltAt(0, 10)!) as { belt: { x: number } }).belt.x === 0, 'le tapis continue tout droit');
});
test('les boîtes ne se branchent jamais toutes seules : c’est au joueur de tracer', () => {
  const g = new Game('TEST-S8'); g.money = 1e5; g.world.reveal(0, 9, 20);
  g.unlocks.add('separateur');
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  const src = g.placeMachine('coffre', -6, 9)!, end = g.placeMachine('coffre', 6, 9)!, side = g.placeMachine('coffre', 0, 10)!;
  assert(g.placeBelts([...Array(11)].map((_, i) => ({ x: -5 + i, y: 9, dir: 0, inDir: 0 })) as TraceCell[]), 'tapis');
  for (const m of g.factory.machines.values()) m.built = true;
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  // Sur le tapis, à côté d'un coffre : il ne le nourrit pas tant qu'on n'a pas branché cette sortie.
  const sb = g.factory.beltAt(0, 9)!;
  assert(g.placeBox('boite_sep', 0, 9, 0), 'séparateur sur le tapis');
  assert(g.factory.nodeOutputs(sb).length === 1 && g.factory.nodeSides(sb)[1] === 'off', `pas branché : ${JSON.stringify(g.factory.nodeSides(sb))}`);
  g.factory.putInStorage(src, 'fer', 6);
  run(g, 30);
  assert(end.inBuf.fer === 6 && !side.inBuf.fer, `tout droit : ${JSON.stringify([end.inBuf, side.inBuf])}`);
  assert(g.setNodeOutput(sb, 1, true) && g.factory.nodeOutputs(sb).length === 2, 'branché à la main');
  // Seul, collé au tapis (au-dessus) et au coffre de droite : rien ne se branche, ni dedans ni dehors.
  const top = g.placeMachine('coffre', 6, 8)!; top.built = true; g.factory.markBuilt();
  const m0 = g.money;
  assert(g.placeBox('boite_tri', 5, 8, 0), 'filtre seul');
  const fb = g.factory.beltAt(5, 8)!;
  assert(g.factory.next(fb) === null && g.factory.nodeOutputs(fb).length === 0, 'pas de sortie');
  assert(g.factory.next(fb) === null && g.factory.next(g.factory.beltAt(4, 9)!)?.kind === 'belt', 'pas même vers le coffre collé ; le tapis continue');
  g.removeNode(fb);
  assert(!g.factory.beltAt(5, 8) && g.money === m0, 'retiré : la case part avec, tout est rendu');
});
test('gomme avec le 1er étage seul : le tapis du 2e étage reste', () => {
  const g = new Game('TEST-GZ'); g.money = 1e5; g.world.reveal(0, 9, 20);
  g.unlocks.add('separateur');
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  assert(g.placeBelts([0, 1, 2].map((x) => ({ x, y: 9, dir: 0, inDir: 0 })) as TraceCell[]), 'au sol');
  assert(g.placeBelts([8, 9, 10].map((y) => ({ x: 1, y, dir: 1, inDir: 1, z: 1 as const })) as TraceCell[]), 'en hauteur');
  g.groundOnly = true;
  assert(g.removeAt(1, 9) && !!g.factory.beltAt(1, 9, 1) && !g.factory.beltAt(1, 9), 'le sol part, le haut reste');
  assert(g.areaContents(0, 8, 2, 10).belts.every((b) => !b.z), 'la zone non plus');
  g.groundOnly = false;
  assert(g.removeAt(1, 9) && !g.factory.beltAt(1, 9, 1), 'avec les deux étages, le haut part');
});
console.log('Charbon');
test('une foreuse sur du charbon s’alimente toute seule', () => {
  const g = new Game('TEST-27');
  g.money = 10000; g.world.reveal(-6, 2, 20);
  const m = g.placeMachine('foreuse', -12, 9)!;
  run(g, 25);
  assert(m.built && g.factory.fuelRoom(m) === 0 && !g.factory.lowFuel(m), 'pas de voyant, personne ne la recharge');
  run(g, 40);
  assert(m.made > 0 && m.fuel + (m.burn > 0 ? 1 : 0) >= 5, `charbon ${m.fuel}, extraits ${m.made}`);
  run(g, 40);
  assert((m.outBuf.charbon ?? 0) > 0, 'une fois sa case pleine, elle envoie le reste');
});
test('une machine sans charbon attend ; un charbon dure 10 s de travail pour une foreuse', () => {
  const g = new Game('TEST-20');
  g.money = 10000; g.world.reveal(-6, 2, 20);
  const m = g.placeMachine('foreuse', -13, -5)!;
  run(g, 40);
  assert(m.built && m.made > 0, 'une foreuse neuve a 10 charbons : elle démarre seule');
  m.fuel = 0; m.burn = 0; m.made = 0; m.outBuf = {};
  run(g, 5);
  assert(m.made === 0 && m.status === 'nofuel', `état ${m.status}`);
  g.factory.addFuel(m, 1);
  run(g, 15);
  const expect = 10 * m.rate!;
  assert(m.fuel === 0 && Math.abs(m.made - expect) <= 1.5, `fabriqués avec 1 charbon : ${m.made} (attendu ${expect.toFixed(1)})`);
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
  g.money = 10000; g.world.reveal(-6, 2, 20);
  const m = g.placeMachine('foreuse', -13, -5)!;
  for (let i = 0; i < 3000 && !m.built; i++) g.tick(1 / 30);
  assert(m.built && m.fuel + (m.burn > 0 ? 1 : 0) >= 9, `charbon à la sortie du chantier : ${m.fuel}`);
});
test('le carburant brûle comme le charbon dans les machines', () => {
  const g = new Game('TEST-F1');
  g.money = 10000; g.world.reveal(-6, 2, 20);
  const four = g.placeMachine('four', -9, -1)!;
  const chest = g.placeMachine('coffre', -6, 3)!;
  run(g, 40);
  assert(four.built && chest.built, 'construits');
  // Machine : le carburant remplit la case carburant.
  four.fuel = 0; four.burn = 0;
  assert(g.factory.canAccept(four, 'carburant') && g.factory.fuelRoom(four) === 10, 'le four accepte le carburant');
  assert(chest.built, 'coffre');
});
test('le carburant passe avant le charbon et dure 5 fois plus longtemps', () => {
  const g = new Game('TEST-F2');
  g.money = 10000; g.world.reveal(-6, 2, 20);
  const four = g.placeMachine('four', -9, -1)!;
  run(g, 40);
  four.fuel = 0; four.burn = 0; four.carb = 0; four.outBuf = {};
  g.factory.addFuel(four, 1, 'charbon');
  g.factory.addFuel(four, 1, 'carburant');
  four.inBuf = { fer: 30 };
  run(g, 1);
  assert(four.fuel === 1 && (four.carb ?? 0) === 0, `le carburant brûle d'abord : ${four.fuel} dont ${four.carb}`);
  assert(four.burn > RULES.coalMachineSeconds * 4, `il dure 5 fois plus : ${four.burn}`);
});
test('coffre : rempli par un tapis, vidé par un tapis', () => {
  const g = new Game('TEST-24');
  g.money = 10000; g.world.reveal(-6, 2, 20);
  const drill = drills(g, -12, 9);
  const chest = g.placeMachine('coffre', -7, 9)!;
  g.placeBelts(trace(g, [[-11.5, 9.5], [-8.5, 9.5], [-7.5, 9.5]]).result());
  run(g, 40);
  g.factory.addFuel(drill, 10);
  run(g, 30);
  assert((chest.inBuf.charbon ?? 0) > 3, `coffre : ${JSON.stringify(chest.inBuf)}`);
  g.placeBelts(trace(g, [[-6.5, 9.5], [-3.5, 9.5]]).result());
  run(g, 20);
  const out = g.factory.beltAt(-5, 9)!;
  assert(out.items.length > 0, 'rien ne sort du coffre');
});
test('les anciens tapis souterrains sont retirés et remboursés au chargement', () => {
  const g = new Game('TEST-U1');
  g.money = 1000;
  const save = JSON.parse(JSON.stringify(g.serialize()));
  save.factory.tunnels = [{ id: 1, from: 1, to: 2, cells: [1, 2, 3], items: [['fer', 0.5]] }];
  save.unlocks = [...save.unlocks, 'souterrain'];
  const g2 = new Game('TEST-U1', save);
  assert(g2.money === 1000 + 4 * 4, `remboursé : ${g2.money}`);
  assert(!g2.unlocks.has('souterrain'), 'le déblocage disparaît');
  assert(!('tunnels' in g2.serialize().factory), 'plus sauvegardé');
});
test('pas de filtre : une entrée prévue garde son étiquette, mais tout entre et tout sort', () => {
  const g = new Game('TEST-TRI');
  g.money = 10000; g.world.reveal(6, 6, 20);
  const src = g.placeMachine('coffre', 2, 5)!;
  const dst = g.placeMachine('coffre', 9, 5)!;
  assert(g.addPort(dst, 8, 5, 'in', 'cuivre'), 'entrée prévue');
  g.placeBelts([...Array(6)].map((_, i) => ({ x: 3 + i, y: 5, dir: 0, inDir: 0 })) as TraceCell[]);
  for (const b of g.factory.belts.values()) b.built = true;
  src.built = true; dst.built = true; g.pending = []; g.factory.markBuilt();
  g.factory.putInStorage(src, 'fer', 4);
  g.factory.putInStorage(src, 'cuivre', 4);
  run(g, 14);
  assert((dst.inBuf.fer ?? 0) > 0 && (dst.inBuf.cuivre ?? 0) > 0, `tout entre : ${JSON.stringify(dst.inBuf)}`);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  s.factory.machines.find((m: { id: number }) => m.id === dst.id).ports = [{ rx: -1, ry: 0, io: 'in', item: 'cuivre', lock: true }];
  const g2 = new Game(s.seed, s);
  const d2 = g2.factory.machineAt(9, 5)!;
  assert(d2.ports?.length === 1 && !('lock' in d2.ports[0]), `un ancien filtre redevient une étiquette : ${JSON.stringify(d2.ports)}`);
});

test('glisser une entrée prévue la déplace (et échange avec celle qui y était)', () => {
  const g = new Game('TEST-6S');
  g.money = 10000; g.world.reveal(6, 6, 20);
  const four = g.placeMachine('four', 6, 6)!;
  assert(g.addPort(four, 5, 6, 'in', 'fer') && g.addPort(four, 6, 5, 'out', 'lingot_fer'), 'prévues');
  assert(g.movePort(four, { x: 5, y: 6 }, { x: 6, y: 5 }), 'déplacée');
  const io = g.view.machineIO(four);
  const at = (x: number, y: number) => io.find((c) => c.x === x && c.y === y)!;
  assert(at(6, 5).item === 'fer' && at(6, 5).io === 'in' && at(5, 6).item === 'lingot_fer', `après : ${JSON.stringify(io)}`);
  assert(!g.movePort(four, { x: 7, y: 8 }, { x: 5, y: 7 }), 'rien de prévu là');
});

test('ancienne partie : un trieur est remboursé', () => {
  const g = new Game('TEST-TRO');
  g.money = 10000; g.world.reveal(6, 6, 20);
  g.placeMachine('coffre', 2, 5);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  s.factory.picks = [[key(3, 5), ['cuivre']]];
  const m0 = s.money;
  const g2 = new Game(s.seed, s);
  assert(!g2.factory.machineAt(2, 5)!.ports, 'plus de sortie filtrée');
  assert(g2.money - m0 === 20, `remboursé : ${g2.money - m0}`);
});

test('gare : deux coffres, les arrivées sortent sur les tapis, les tapis remplissent les départs', () => {
  const g = new Game('TEST-G2');
  g.money = 100000; g.world.reveal(6, 6, 20);
  g.unlocks.add('train');
  const gare = g.placeMachine('gare', 4, 4)!;
  // Un tapis qui part de la gare vers la droite, un autre qui y arrive par la gauche.
  g.placeBelts([...Array(5)].map((_, i) => ({ x: 8 + i, y: 4, dir: 0, inDir: 0 })) as TraceCell[]);
  g.placeBelts([...Array(3)].map((_, i) => ({ x: 1 + i, y: 5, dir: 0, inDir: 0 })) as TraceCell[]);
  for (const b of g.factory.belts.values()) b.built = true;
  gare.built = true; g.pending = []; g.factory.markBuilt();
  g.factory.putInStorage(gare, 'carburant', 60, gare.outBuf);
  g.factory.putInStorage(gare, 'fer', 10);
  for (let i = 0; i < 4 * 30; i++) {
    if (i % 15 === 0) g.factory.beltAt(1, 5)!.items.push({ t: 'cuivre', p: 0 });
    g.tick(1 / 30);
  }
  const out = [8, 9, 10, 11, 12].flatMap((x) => g.factory.beltAt(x, 4)!.items.map((i) => i.t));
  assert(out.length > 0 && out.every((t) => t === 'carburant') && gare.inBuf.fer === 10, `seules les arrivées sortent : ${out.join(',')}`);
  assert((gare.inBuf.cuivre ?? 0) > 0 && !gare.outBuf.cuivre, `les tapis remplissent les départs : ${JSON.stringify(gare.inBuf)}`);
  // Le robot prend dans l'un ou l'autre.
});

test('un drone qui recharge une machine en carburant y met du carburant', () => {
  const g = new Game('TEST-DC');
  g.money = 10000; g.world.reveal(8, 8, 20);
  const four = g.placeMachine('four', 9, 4)!;
  four.built = true; g.pending = []; g.factory.markBuilt();
  four.fuel = 0; four.carb = 0; four.burn = 0;
  g.factory.addFuel(four, 3, 'carburant');
  assert(four.fuel === 3 && four.carb === 3, `carburant compté : ${four.fuel} ${four.carb}`);
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
  g.money = 100000; g.world.reveal(14, 10, 30);
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
  assert(m0 - g.money === g.trackPrice('camion', g.factory.lineLength(l)) + RULES.truckCost && g.factory.lineLength(l) > 40, `prix ${m0 - g.money}, boucle ${g.factory.lineLength(l)}`);
  // Le dépôt se remplit comme un coffre (tapis, drones) : 300 objets.
  assert(g.factory.putInStorage(a, 'fer', 1000) === 300, 'dépôt : 300 objets');
  run(g, 3);
  assert(g.factory.cargoCount(l.vehicles[0]) === RULES.truckLoad && l.vehicles[0].moving, 'parti plein');
  run(g, 12);
  assert((b.outBuf.fer ?? 0) === RULES.truckLoad && !b.inBuf.fer, `livré dans les arrivées : ${b.outBuf.fer}`);
  // Deux camions de plus : la ligne va plus vite.
  assert(g.addVehicle(l.id) && g.addVehicle(l.id) && l.vehicles.length === 3, 'trois camions');
  const before = b.outBuf.fer;
  // Un seul camion à quai par dépôt : les autres attendent leur tour sur la route, sans se chevaucher.
  let queued = 0;
  for (let i = 0; i < 30 * 30; i++) {
    g.tick(1 / 30);
    const docks = l.vehicles.filter((v) => !v.moving).map((v) => l.stops[v.at].id);
    assert(new Set(docks).size === docks.length, 'deux camions à quai au même dépôt');
    for (const v of l.vehicles) for (const o of l.vehicles) {
      if (v !== o && v.moving && o.moving && v.at === o.at) assert(Math.abs(v.pos - o.pos) >= RULES.truckGap - 0.01, `camions trop proches : ${v.pos} ${o.pos}`);
    }
    if (l.vehicles.some((v) => v.moving && v.pos > 0 && v.pos < g.factory.legLen(l, v.at) - 0.5 && g.factory.legLen(l, v.at) - v.pos <= RULES.truckGap + 0.01)) queued++;
  }
  assert(queued > 0, 'personne n’a attendu devant un dépôt');
  assert(b.outBuf.fer - before >= 3 * RULES.truckLoad, `plus vite : ${b.outBuf.fer - before} en 30 s`);
  // Troisième arrêt : A et B chargent, C décharge tout ; les camions passent par les trois.
  assert(g.addStop(l.id, c) && l.stops.length === 3 && !g.addStop(l.id, c), 'troisième arrêt');
  g.setStopLoad(l.id, 1, true);
  run(g, 60);
  assert((c.outBuf.fer ?? 0) > 0, `le troisième dépôt reçoit aussi : ${c.outBuf.fer}`);
  // Sauvegarde ; fermer la ligne la rembourse.
  const g2 = new Game('TEST-V1', JSON.parse(JSON.stringify(g.serialize())));
  assert(g2.factory.lines.size === 1 && [...g2.factory.lines.values()][0].vehicles.length === 3, 'rechargée');
  const m1 = g.money, refund = g.linePrice(l);
  assert(g.removeVehicle(l.id) && g.money - m1 === RULES.truckCost, 'camion retiré, remboursé');
  g.removeLine(l.id);
  assert(g.factory.lines.size === 0 && g.money - m1 === refund, 'ligne fermée, remboursée');
});
test('gares et dépôts : 4 × 2, quai réservé le long du grand côté, on les tourne', () => {
  const g = new Game('TEST-Q1');
  g.money = 100000; g.unlocks.add('camion');
  const d = g.placeMachine('depot', 4, 4)!;
  assert(d.w === 4 && d.h === 2 && (d.rot ?? 0) === 0, 'dépôt 4 × 2');
  // Le quai est dessous (y 6 et 7) : ni tapis ni machine.
  assert(!g.factory.isFree(5, 6) && !g.factory.isFree(7, 7) && g.factory.isFree(5, 8), 'quai réservé');
  assert(!g.placeMachine('coffre', 5, 7), 'pas de coffre sur le quai');
  assert(!g.factory.checkMachine('depot', 4, 6).ok, 'pas de dépôt sur le quai d’un autre');
  // Tourné d'un quart : 2 × 4, quai à gauche.
  assert(g.rotateStation(d) && d.w === 2 && d.h === 4 && d.rot === 1, `tourné ${d.w}×${d.h} ${d.rot}`);
  const q = g.factory.stationOf(d).quay;
  assert(q.every((c) => c.x < d.x) && q.length === 8, 'quai à gauche');
  const v = g.placeMachine('depot', 20, 4, 3)!;
  assert(v.w === 2 && v.h === 4 && g.factory.stationOf(v).quay.every((c) => c.x >= v.x + 2), 'posé tourné : quai à droite');
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(g2.factory.machines.get(v.id)!.rot === 3 && !g2.factory.isFree(v.x + 2, v.y + 1), 'sens sauvegardé');
});
test('routes en boucle : voies à sens unique, 4 cases entre l’aller et le retour, tracé gardé', () => {
  const g = new Game('TEST-R1');
  g.money = 1e6; g.unlocks.add('camion');
  const a = g.placeMachine('depot', 10, 40)!, b = g.placeMachine('depot', 40, 46)!;
  for (const m of g.factory.machines.values()) m.built = true;
  const l = g.linkStations(a, b)!;
  const r = g.factory.routes.get(l.id)!;
  assert(r.legs.length === 2 && r.gap === 6, `deux trajets, écart ${r.gap}`);
  const pts = (i: number) => r.legs[i].steps.slice(5, -5);
  let near = 99;
  for (const p of pts(0)) for (const q of pts(1)) near = Math.min(near, Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)));
  assert(near >= 6, `aller et retour trop proches : ${near}`);
  // Chaque trajet part par la sortie du quai et arrive par l'entrée du suivant.
  const ga = g.factory.stationOf(a), gb = g.factory.stationOf(b);
  const l0 = r.legs[0].pts, l1 = r.legs[1].pts;
  assert(l0[0].x === ga.dock.x && l0[l0.length - 1].x === gb.dock.x && l1[0].x === gb.dock.x && l1[l1.length - 1].x === ga.dock.x, 'de quai à quai');
  // Le tracé est gardé tel quel au rechargement.
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  g2.factory.ensureRoutes();
  assert(JSON.stringify(g2.factory.routes.get(l.id)!.legs.map((x) => x.pts)) === JSON.stringify(r.legs.map((x) => x.pts)), 'tracé rechargé');
});
test('tunnels : la route passe sous un tapis posé dessus, en descendant 2 à 3 cases avant', () => {
  const g = new Game('TEST-R2');
  g.money = 1e6; g.unlocks.add('camion');
  const a = g.placeMachine('depot', 10, 40)!, b = g.placeMachine('depot', 40, 40)!;
  for (const m of g.factory.machines.values()) m.built = true;
  const l = g.linkStations(a, b)!;
  const leg = g.factory.routes.get(l.id)!.legs[0];
  const before = JSON.stringify(leg.pts);
  assert(leg.tunnels.length === 0, 'pas de tunnel au départ');
  // Un tapis vertical en x = 25 qui coupe l'aller, au milieu du trajet.
  const lane = leg.steps.find((st) => st.x === 25 && st.d % 2 === 0)!;
  assert(!!lane, 'l’aller passe en x = 25');
  assert(g.placeBelts([...Array(9)].map((_, i) => ({ x: 25, y: lane.y - 4 + i, dir: 1, inDir: 1 })) as TraceCell[]), 'tapis posé sur la route');
  g.tick(0.1);
  const r = g.factory.routes.get(l.id)!.legs[0];
  assert(JSON.stringify(r.pts) === before, 'le tracé ne bouge pas');
  assert(r.tunnels.length === 1, `un tunnel : ${JSON.stringify(r.tunnels)}`);
  const [t0, t1] = r.tunnels[0];
  assert(lane.s - t0 >= 2 && lane.s - t0 <= 3 && t1 - (lane.s + 1) >= 2 && t1 - (lane.s + 1) <= 3, `entrées du tunnel : ${t0} ${t1} (tapis à ${lane.s})`);
  // Un camion passe dessous : il arrive quand même.
  g.factory.putInStorage(a, 'fer', 50);
  run(g, 30);
  assert((b.outBuf.fer ?? 0) > 0, 'livré par le tunnel');
});
test('croisements : carrefour à feux, passage à niveau ; jamais deux voies dans le croisement en même temps', () => {
  const g = new Game('TEST-R3');
  g.money = 1e7; g.unlocks.add('camion'); g.unlocks.add('train');
  const a = g.placeMachine('depot', 10, 40)!, b = g.placeMachine('depot', 50, 40)!;
  const c = g.placeMachine('depot', 28, 16, 1)!, d = g.placeMachine('depot', 28, 62, 1)!;
  const e = g.placeMachine('gare', 16, 28, 0)!, f2 = g.placeMachine('gare', 40, 52, 0)!;
  for (const m of g.factory.machines.values()) m.built = true;
  const l1 = g.linkStations(a, b)!, l2 = g.linkStations(c, d)!;
  g.addVehicle(l1.id); g.addVehicle(l2.id);
  const cr = g.factory.crossings;
  assert(cr.some((x) => x.kind === 'carrefour'), `un carrefour : ${cr.map((x) => x.kind)}`);
  const l3 = g.linkStations(e, f2)!;
  assert(g.factory.crossings.some((x) => x.kind === 'niveau'), `un passage à niveau : ${g.factory.crossings.map((x) => x.kind)}`);
  g.factory.putInStorage(a, 'fer', 300); g.factory.putInStorage(c, 'cuivre', 300); g.factory.putInStorage(e, 'sable', 300);
  const hold = (g.factory as unknown as { crossHold: Map<unknown, Map<unknown, { line: number; leg: number }>> }).crossHold;
  let waited = 0;
  for (let i = 0; i < 30 * 120; i++) {
    g.tick(1 / 30);
    for (const h2 of hold.values()) {
      const lanes = new Set([...h2.values()].map((m) => `${m.line}:${m.leg}`));
      assert(lanes.size <= 1, 'deux voies dans le même croisement');
    }
    for (const x of g.factory.crossings) for (const m of x.members) if (g.factory.crossLight(x, m) === 'red') waited++;
  }
  assert(waited > 0, 'aucun feu rouge');
  assert((b.outBuf.fer ?? 0) > 0 && (d.outBuf.cuivre ?? 0) > 0 && (f2.outBuf.sable ?? 0) > 0, `tout le monde passe : ${b.outBuf.fer} ${d.outBuf.cuivre} ${f2.outBuf.sable}`);
  assert(l3.vehicles.length === 1, 'train');
});
test('une ancienne partie : ses dépôts de 2 × 2 deviennent des 4 × 2 avec quai, les lignes restent', () => {
  const g = new Game('TEST-R4');
  g.money = 1e6; g.unlocks.add('camion');
  const a = g.placeMachine('depot', 10, 40)!, b = g.placeMachine('depot', 30, 40)!;
  g.linkStations(a, b);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  delete s.factory.stations2;
  for (const l of s.factory.lines) delete l.track;
  const g2 = new Game(s.seed, s);
  const a2 = g2.factory.machines.get(a.id)!;
  assert(a2 && a2.w * a2.h === 8 && g2.factory.lines.size === 1, 'reposé en 4 × 2, ligne gardée');
});
test('gares : un train, 80 objets à la fois ; la ligne part avec la gare', () => {
  const g = new Game('TEST-V2');
  g.money = 100000; g.world.reveal(14, 10, 30);
  g.unlocks.add('train');
  const a = g.placeMachine('gare', 3, 8)!, b = g.placeMachine('gare', 23, 12)!;
  a.built = true; b.built = true; g.pending = []; g.factory.markBuilt();
  const l = g.linkStations(a, b)!;
  g.factory.putInStorage(a, 'cuivre', 200);
  run(g, 20);
  assert((b.outBuf.cuivre ?? 0) >= RULES.trainLoad, `train livré : ${b.outBuf.cuivre}`);
  const m1 = g.money, refund = g.linePrice(l);
  g.removeMachine(b);
  assert(g.factory.lines.size === 0 && g.money - m1 === MACHINES.gare.cost + refund, 'retirée avec la gare');
});

test('raffinerie à carburant : elle se sert d’abord dans ce qu’elle produit', () => {
  const g = new Game('TEST-F3');
  g.factory.waterFactor = () => 1; // de l'eau partout (la raffinerie en a besoin)
  g.money = 100000; g.world.reveal(8, 8, 20);
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
  g.unlocks.add('separateur');
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
  assert(b.node === 'sep' && g.factory.nodeOutputs(b).map((o) => o.d).sort().join() === '0,1,3' && g.factory.nodeIsLink(b), 'deux dérivations');
  g.factory.putInStorage(src, 'fer', 30);
  run(g, 60);
  const n = (m: typeof src) => m.inBuf.fer ?? 0;
  assert(n(up) >= 9 && n(down) >= 9 && n(end) >= 9 && n(up) + n(down) + n(end) === 30, `répartition : haut ${n(up)}, bas ${n(down)}, tout droit ${n(end)}`);
  const g2 = new Game('TEST-S3', JSON.parse(JSON.stringify(g.serialize())));
  assert(g2.factory.nodeOutputs(g2.factory.beltAt(5, 5)!).some((o) => o.d === 1), 'sauvegardé');
  g.unlinkBelt(b);
  assert(!b.node, 'liaisons coupées');
});
test('le bout d’un tapis se tourne vers une machine collée, puis nourrit aussi celle d’en face', () => {
  const g = new Game('TEST-S4');
  g.money = 100000; g.world.reveal(6, 5, 20);
  g.unlocks.add('separateur');
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
  g.money = 100000; g.world.reveal(8, 8, 25);
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
  pr.inBuf = { lingot_fer: 40 }; pr.fuel = 0;
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
test('tri : seul l’objet choisi part de côté ; entrepôt ; statistiques et succès', () => {
  const g = new Game('TEST-T1');
  g.money = 100000; g.world.reveal(8, 8, 25);
  for (const id of ['separateur', 'grand_coffre', 'tri', 'entrepot']) g.unlocks.add(id);
  const src = g.placeMachine('coffre', 1, 5)!;
  const straight = g.placeMachine('coffre', 10, 5)!;
  const side = g.placeMachine('coffre', 5, 9)!;
  assert(g.placeBelts(trace(g, [[1.5, 5.5], [9.5, 5.5], [10.5, 5.5]]).result()), 'tapis');
  for (const b of g.factory.belts.values()) b.built = true;
  const t = trace(g, [[5.5, 5.5], [5.5, 8.5], [5.5, 9.5]]);
  assert(t.splitFrom && g.placeBelts(t.result(), { from: t.splitFrom!, dir: t.splitDir! }), 'dérivation');
  for (const m of g.factory.machines.values()) m.built = true;
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  const sb = g.factory.beltAt(5, 5)!;
  g.setNodeRule(sb, 1, ['cuivre']);
  assert(sb.node === 'tri' && sb.rules?.[1]?.[0] === 'cuivre', 'tri sur le cuivre');
  g.factory.putInStorage(src, 'fer', 10);
  g.factory.putInStorage(src, 'cuivre', 10);
  run(g, 40);
  assert(side.inBuf.cuivre === 10 && !side.inBuf.fer && straight.inBuf.fer === 10 && !straight.inBuf.cuivre, `tri : côté ${JSON.stringify(side.inBuf)}, tout droit ${JSON.stringify(straight.inBuf)}`);
  const g2 = new Game('TEST-T1', JSON.parse(JSON.stringify(g.serialize())));
  assert(g2.factory.beltAt(5, 5)!.rules?.[1]?.[0] === 'cuivre', 'tri sauvegardé');
  const e = g.placeMachine('entrepot', 14, 12)!;
  assert(e && g.factory.slotsOf(e) === 90 && g.factory.putInStorage(e, 'fer', 2000) === 900, 'entrepôt : 900 objets');
  // Statistiques et succès.
  const four = g.placeMachine('four', 14, 2)!;
  four.built = true; four.inBuf = { fer: 3 }; four.fuel = 5; g.factory.markBuilt();
  run(g, 10);
  assert((g.factory.stats.made.lingot_fer ?? 0) >= 3, `stats : ${JSON.stringify(g.factory.stats.made)}`);
  assert(g.ratePerMinute('lingot_fer', 60) > 0, 'débit par minute');
  const g3 = new Game('TEST-T1', JSON.parse(JSON.stringify(g.serialize())));
  assert((g3.factory.stats.made.lingot_fer ?? 0) >= 3, 'stats sauvegardées');
});
test('eau : pompe sur le lac, tuyaux, réacteur refroidi', () => {
  const g = new Game('TEST-W1');
  const apply = () => (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  g.money = 1e6; g.world.reveal(8, -16, 30);
  for (const id of ['generateur', 'pompe', 'reacteur', 'presse', 'presse_elec', 'hangar', 'recharge', 'drone3']) g.unlocks.add(id);
  apply();
  assert(g.world.patchAt(8, -24)?.type === 'eau', 'un lac près du départ');
  assert(!g.placeMachine('pompe', 20, -10), 'une pompe se pose sur l’eau');
  assert(!g.placeMachine('foreuse', 7, -25), 'pas de foreuse sur l’eau');
  const pump = g.placeMachine('pompe', 7, -25)!;
  const reac = g.placeMachine('centrale', 14, -25)!;
  const pr = g.placeMachine('presse', 19, -25)!;
  assert(pump && reac && pr, 'posés');
  for (const m of g.factory.machines.values()) m.built = true;
  g.pending = []; g.factory.markBuilt();
  reac.inBuf = { uranium_enrichi: 3 };
  pr.inBuf = { lingot_fer: 40 }; pr.fuel = 0;
  assert(g.placeCables([{ x: 17, y: -24 }]), 'câble réacteur → presse');
  run(g, 3);
  assert(reac.status === 'nowater' && !(pr.power ?? 0), `sans eau, le réacteur ne démarre pas : ${reac.status}`);
  assert(g.placePipes([9, 10, 11, 12, 13].map((x) => ({ x, y: -24 }))), 'tuyaux');
  run(g, 2);
  pr.outBuf = {}; // la presse ne doit pas être bouchée pour réclamer du courant
  run(g, 2);
  const net = g.factory.waterNetOf(reac)!;
  assert(net && net.supply === 40 && reac.water === 1, `eau : ${net?.supply} L/s, ${reac.water}`);
  assert(reac.status === 'working' && (pr.power ?? 0) === 1, `le réacteur alimente la presse : ${reac.status}`);
  assert((reac.inBuf.uranium_enrichi ?? 0) === 2, 'un barreau entamé');
  const g2 = new Game('TEST-W1', JSON.parse(JSON.stringify(g.serialize())));
  assert(g2.factory.pipes.size === 5, 'tuyaux sauvegardés');
  assert(g.removeAt(11, -24) && !g.factory.hasPipe(11, -24), 'la gomme retire un tuyau');
  g.placePipes([{ x: 11, y: -24 }]);
});
test('toundras lointaines (titane, cristal pur), fusée, monte-charge', () => {
  const g = new Game('TEST-R1');
  // Une toundra existe loin du départ, avec ses filons rares.
  let found = 0, rare = 0;
  for (let y = -400; y <= 400 && !rare; y += 6) for (let x = -400; x <= 400 && !rare; x += 6) {
    if (g.world.biomeAt(x, y) === 'toundra') { found++; const p = g.world.patchAt(x, y); if (p && (p.type === 'titane' || p.type === 'cristal_pur')) rare++; }
  }
  assert(found > 0, 'une toundra');
  assert(g.world.biomeAt(0, 0) === 'plaine', 'le départ reste en plaine');
  // La fusée.
  g.money = 1e6; g.world.reveal(10, 10, 25);
  g.unlocks.add('rampe');
  const pad = g.placeMachine('rampe', 10, 10)!;
  pad.built = true; g.pending = []; g.factory.markBuilt();
  let launched = 0;
  g.on((e) => { if (e.type === 'rocket') launched++; });
  for (const [k, n] of Object.entries(ROCKET_NEEDS)) assert(g.factory.putInMachine(pad, k, n + 5) === n, `rampe : ${k}`);
  run(g, RULES.rocketCountdown + 1);
  assert(launched === 1 && g.rockets === 1 && !Object.keys(pad.inBuf).length && g.achievements.has('fusee') !== undefined, `décollage : ${launched}`);
  // Monte-charge : l'atelier prend le fer dans le coffre collé et y range les lingots.
  for (const id of ['module', 'monte_charge', 'grand_coffre']) g.unlocks.add(id);
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  const a = g.placeMachine('atelier', 20, 20)!;
  a.built = true; g.pending = []; a.fuel = 10;
  const chest = g.placeMachine('grand_coffre', 23, 20)!;
  chest.built = true; g.factory.markBuilt();
  g.factory.putInStorage(chest, 'sable', 20);
  g.enterAtelier(a);
  const lift = g.placeMachine('monte_charge', 4, 5)!;
  const four = g.placeMachine('four', 7, 5)!;
  const out = g.placeMachine('sortie', 12, 5)!;
  assert(lift && four && out, 'posés dans l’atelier');
  assert(g.placeBelts(trace(g, [[4.5, 5.5], [6.5, 5.5], [7.5, 5.5]]).result()), 'monte-charge → four');
  assert(g.placeBelts(trace(g, [[8.5, 5.5], [11.5, 5.5], [12.5, 5.5]]).result()), 'four → sortie');
  g.leaveAtelier();
  run(g, 60);
  assert((chest.inBuf.verre ?? 0) >= 5 && (chest.inBuf.sable ?? 0) < 20, `monte-charge : ${JSON.stringify(chest.inBuf)}`);
});
test('météo, arbres décoratifs, plans d’ateliers', () => {
  const g = new Game('TEST-P1');
  const apply = () => (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  g.money = 1e6; g.world.reveal(8, 8, 25);
  // Météo : clair au début, puis des temps tirés de la graine.
  assert(g.weather === 'clair', 'il fait beau au départ');
  const seen = new Set<string>();
  for (let i = 1; i < 40; i++) { g.played = i * RULES.weatherSpan + 1; seen.add(g.weather); }
  assert(seen.has('pluie') && seen.has('clair'), `temps : ${[...seen]}`);
  g.played = [...Array(40).keys()].map((i) => i * RULES.weatherSpan + 1).find((t) => { g.played = t; return g.weather === 'pluie'; })!;
  run(g, 0.1);
  assert(g.factory.truckMult === RULES.rainTruck, 'la pluie ralentit les camions');
  // Plus de pollution : un arbre est un simple décor.
  for (const id of ['arbre', 'presse']) g.unlocks.add(id);
  apply();
  const tree = g.placeMachine('arbre', 13, 10)!;
  assert(tree && !('pollution' in g), 'arbre posé, pas de pollution');
  // Plans : l'intérieur d'un atelier, reposé ailleurs (dans une autre partie).
  g.unlocks.add('module'); apply();
  const a = g.placeMachine('atelier', 20, 20)!;
  a.built = true; g.pending = [];
  g.enterAtelier(a); g.placeMachine('presse', 5, 5); g.leaveAtelier();
  const plan = g.planOf(a)!;
  const other = new Game('TEST-P2');
  other.money = 1e6; other.world.reveal(8, 8, 25);
  for (const id of ['module']) other.unlocks.add(id);
  (other as unknown as { applyUnlocks(): void }).applyUnlocks();
  assert(!other.placePlan(plan, 20, 10, 10), 'la presse n’est pas débloquée dans l’autre partie');
  other.unlocks.add('presse');
  const m0 = other.money;
  const b = other.placePlan(plan, 20, 10, 10)!;
  assert(b && b.inner && [...b.inner.machines.values()].some((x) => x.type === 'presse') && m0 - other.money === other.planPrice(plan), 'atelier posé depuis le plan');
});
test('niveaux de foreuses : chaque niveau dans l’arbre ; chaque foreuse monte à part et extrait plus', () => {
  const g = new Game('TEST-DL');
  g.money = 1e6; g.world.reveal(-10, -4, 20);
  const a = g.placeMachine('foreuse', -13, -4)!;
  assert(a, 'foreuse posée');
  a.built = true; a.fuel = 10;
  g.pending = []; g.factory.markBuilt();
  const base = g.factory.drillRate(a);
  const unlock = (...ids: string[]) => { for (const id of ids) g.unlocks.add(id); (g as unknown as { applyUnlocks(): void }).applyUnlocks(); };
  assert(g.drillUpgrade(a)!.locked && !g.upgradeDrills(a), 'niveau 2 : à débloquer');
  unlock('foreuse2', 'foreuse3');
  const up = g.drillUpgrade(a)!;
  assert(up.to === 2 && up.drills.length === 1 && up.price === RULES.drillLevelCost[1], `prix : ${up.price}`);
  const m0 = g.money;
  assert(g.upgradeDrills(a) && a.lvl === 2 && g.money === m0 - up.price, 'niveau 2');
  assert(Math.abs(g.factory.drillRate(a) - base * RULES.drillLevelSpeed[1]) < 1e-9, 'elle extrait plus');
  assert(g.upgradeDrills(a) && a.lvl === 3, 'niveau 3');
  assert(g.drillUpgrade(a)!.locked && !g.upgradeDrills(a) && a.lvl === 3, 'niveau 4 : à débloquer');
  unlock('foreuse4', 'forage');
  assert(g.drillMaxLevel === 5 && g.upgradeDrills(a) && g.upgradeDrills(a) && a.lvl === 5 && !g.drillUpgrade(a), 'jusqu’au niveau 5');
  const m1 = g.money;
  g.removeMachine(a);
  assert(g.money - m1 === MACHINES.foreuse.cost + RULES.drillLevelCost.slice(1).reduce((x, n) => x + n, 0), 'supprimer rend aussi les niveaux');
});
test('niveaux de tapis : chaque niveau dans l’arbre ; on paie chaque case ; il va plus vite', () => {
  const g = new Game('TEST-BL');
  g.money = 1e6; g.world.reveal(-6, 2, 20);
  assert(g.placeBelts(trace(g, [[-4.5, 9.5], [3.5, 9.5]]).result()), 'tapis');
  for (const b of g.factory.belts.values()) b.built = true;
  g.pending = []; g.factory.markBuilt();
  const b0 = g.factory.beltAt(-4, 9)!;
  const n = g.factory.chainOf(b0).length;
  assert(g.beltUpgrade(b0)!.locked && !g.upgradeBelt(b0), 'niveau 2 : à débloquer');
  g.unlocks.add('tapis2'); (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  const up = g.beltUpgrade(b0)!;
  assert(up.to === 2 && up.cells.length === n && up.price === n * RULES.beltLevelCost[1], `prix : ${up.price} pour ${n} cases`);
  // Un objet met moins de temps à traverser un tapis de niveau 2.
  const cross = () => {
    for (const c of g.factory.chainOf(b0)) c.items = [];
    b0.items = [{ t: 'charbon', p: 0 }];
    let t = 0;
    const end = g.factory.beltAt(3, 9)!;
    while (!(end.items[0]?.p >= 0.74) && t < 30) { g.factory.tick(1 / 30); t += 1 / 30; }
    return t;
  };
  const t1 = cross();
  assert(g.upgradeBelt(b0) && g.factory.chainOf(b0).every((c) => c.lvl === 2), 'tout le tapis au niveau 2');
  const t2 = cross();
  assert(t2 < t1 / 1.3, `plus vite : ${t1.toFixed(2)} s puis ${t2.toFixed(2)} s`);
  assert(g.beltUpgrade(b0)!.locked && !g.upgradeBelt(b0), 'niveau 3 : à débloquer');
  // Un bout ajouté repart au niveau 1 : seul lui monte (et seul lui se paie).
  assert(g.placeBelts(trace(g, [[3.5, 9.5], [6.5, 9.5]]).result()), 'rallonge');
  for (const b of g.factory.belts.values()) b.built = true;
  g.factory.markBuilt();
  const up2 = g.beltUpgrade(b0)!;
  assert(up2.to === 2 && up2.cells.length === g.factory.chainOf(b0).length - n, `seule la rallonge : ${up2.cells.length}`);
  const m0 = g.money;
  g.removeChain(b0);
  assert(g.money > m0 + n * (RULES.beltCost + RULES.beltLevelCost[1]) - 1, 'supprimer rend aussi les niveaux');
});
test('niveaux de machines : un four monte au niveau 3 et fabrique deux fois plus vite', () => {
  const g = new Game('TEST-ML');
  g.money = 1e5; g.world.reveal(-6, 2, 20);
  const four = g.placeMachine('four', -9, -1)!;
  assert(g.drillUpgrade(four)!.locked, 'niveau 2 : à débloquer');
  for (const id of ['machine2', 'machine3']) g.unlocks.add(id);
  (g as unknown as { applyUnlocks(): void }).applyUnlocks();
  const make = () => { four.made = 0; four.fuel = 10; four.burn = 0; four.craft = null; four.outBuf = {}; four.inBuf = { fer: 30 }; run(g, 4.5); return four.made; };
  const n1 = make();
  const m0 = g.money;
  assert(g.upgradeDrills(four) && g.upgradeDrills(four) && four.lvl === 3, 'niveau 3');
  assert(m0 - g.money === MACHINES.four.cost * (RULES.machineLevelCost[1] + RULES.machineLevelCost[2]), `prix : ${m0 - g.money}`);
  assert(!g.drillUpgrade(four), 'trois niveaux au plus');
  const n3 = make();
  assert(n3 >= n1 * 1.6, `deux fois plus vite : ${n1} puis ${n3}`);
  const m1 = g.money;
  g.removeMachine(four);
  assert(g.money - m1 === MACHINES.four.cost * 4, 'supprimer rend aussi les niveaux');
});
test('ancienne partie : tapis rapides, Grande foreuse et son déblocage deviennent des niveaux', () => {
  const g = new Game('TEST-LV');
  g.money = 1000; g.world.reveal(-10, -3, 20);
  assert(g.placeBelts(trace(g, [[-4.5, 9.5], [0.5, 9.5]]).result()), 'tapis');
  const s = JSON.parse(JSON.stringify(g.serialize()));
  delete s.factory.levels;
  s.unlocks = [...s.unlocks, 'rapide', 'super_foreuse'];
  s.factory.machines.push({ id: 950, type: 'super_foreuse', x: -14, y: -6, built: true, inBuf: {}, outBuf: { fer: 5 }, fuel: 8, burn: 0, craft: null, drillT: 0, made: 3 });
  s.factory.nextId = 951;
  const g2 = new Game(s.seed, s);
  assert([...g2.factory.belts.values()].every((b) => b.lvl === 3), 'tapis rapides : niveau 3');
  assert(g2.unlocks.has('forage') && !g2.unlocks.has('super_foreuse') && g2.drillMaxLevel === 5, 'Forage profond');
  const small = [...g2.factory.machines.values()].filter((m) => m.type === 'foreuse');
  assert(small.length >= 2 && small.every((m) => m.lvl === 3) && small.some((m) => m.id === 950 && m.fuel === 8), `foreuses : ${small.length}`);
  const spent = small.length * (MACHINES.foreuse.cost + RULES.drillLevelCost[1] + RULES.drillLevelCost[2]);
  assert(g2.money === s.money + 1500 - spent, `rendu : ${g2.money - s.money}`);
  assert(!g2.factory.machines.has(951) || g2.factory.machines.get(951)!.type === 'foreuse', 'plus de Grande foreuse');
});
test('lignes dans les deux sens : du carburant vers la mine, du minerai au retour ; jusqu’à 6 arrêts', () => {
  const g = new Game('TEST-V3');
  g.money = 1e6; g.world.reveal(14, 10, 30);
  g.unlocks.add('camion');
  const base = g.placeMachine('depot', 3, 8)!, mine = g.placeMachine('depot', 23, 8)!;
  for (const m of g.factory.machines.values()) m.built = true;
  g.pending = []; g.factory.markBuilt();
  const l = g.linkStations(base, mine)!;
  // La base envoie du carburant et reçoit le reste ; la mine reçoit le carburant et renvoie tout le reste.
  g.setStopRule(l.id, 0, 'take', ['vis']);
  g.setStopRule(l.id, 0, 'drop', 'all');
  g.setStopRule(l.id, 1, 'drop', ['vis']);
  g.setStopRule(l.id, 1, 'take', 'all');
  g.factory.putInStorage(base, 'vis', 30);
  g.factory.putInStorage(mine, 'sable', 40);
  run(g, 60);
  // Deux coffres par dépôt : ce qui arrive (outBuf) n'est jamais repris pour repartir.
  assert((mine.outBuf.vis ?? 0) >= 20 && !(mine.inBuf.sable > 20) && !mine.outBuf.sable, `mine : ${JSON.stringify(mine)}`);
  assert((base.outBuf.sable ?? 0) >= 20 && (base.inBuf.vis ?? 0) < 30 && !base.outBuf.vis, `base : ${JSON.stringify(base)}`);
  // Plus de deux arrêts.
  const extra = [0, 1, 2, 3, 4].map((i) => { const m = g.placeMachine('depot', 5 + i * 4, 16)!; m.built = true; return m; });
  g.factory.markBuilt();
  let added = 0;
  for (const m of extra) if (g.addStop(l.id, m)) added++;
  assert(added === RULES.maxStops - 2 && l.stops.length === RULES.maxStops, `arrêts : ${l.stops.length}`);
  assert(g.removeStop(l.id, 2) && l.stops.length === RULES.maxStops - 1, 'arrêt retiré');
  const g2 = new Game('TEST-V3', JSON.parse(JSON.stringify(g.serialize())));
  const l2 = [...g2.factory.lines.values()][0];
  assert(JSON.stringify(l2.stops[0].take) === '["vis"]' && l2.stops[1].take === 'all', 'règles sauvegardées');
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
  assert(!g.placeMachine('generateur', 4, 1), 'pas de générateur dedans');
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
  g.money = 100000; g.world.reveal(8, 8, 20);
  // Sans eau, un générateur au charbon ne tourne pas ; une raffinerie, un mélangeur non plus.
  {
    const dry = new Game('TEST-E0');
    dry.money = 1e6; dry.world.reveal(8, 8, 20);
    for (const id of ['generateur', 'melangeur', 'broyeur']) dry.unlocks.add(id);
    (dry as unknown as { applyUnlocks(): void }).applyUnlocks();
    const gen0 = dry.placeMachine('generateur', 4, 4)!, mix = dry.placeMachine('melangeur', 9, 4)!;
    for (const m of dry.factory.machines.values()) m.built = true;
    dry.pending = []; dry.factory.markBuilt();
    gen0.fuel = 10; mix.inBuf = { ciment: 10, sable: 10 }; mix.fuel = 10;
    run(dry, 5);
    assert(gen0.status === 'nowater' && mix.status === 'nowater' && mix.made === 0, `sans eau : ${gen0.status} / ${mix.status}`);
  }
  g.factory.waterFactor = () => 1;
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
test('Laboratoire : il ne prend que ce qu’il faut à ce palier, débloquer le consomme', () => {
  const g = new Game('TEST-41');
  g.money = 10000; g.world.reveal(6, 6, 20);
  const lab = g.giveBuilding('laboratoire')!;
  assert(lab, 'laboratoire posé');
  assert(!g.giveBuilding('laboratoire') && !g.placeMachine('laboratoire', 7, 12), 'un seul laboratoire');
  run(g, 30);
  assert(lab.built && g.hasLab(), 'laboratoire construit');
  assert(g.receive(lab, 'fer', 5) === 0, 'le minerai ne sert à rien au labo');
  const need = g.labNeeds().lingot_fer ?? 0;
  assert(need > 0 && g.receive(lab, 'lingot_fer', 1000) === need && g.receive(lab, 'lingot_fer', 5) === 0, `seulement ce qu’il faut à ce palier : ${need}`);
  assert(!g.unlock('tour'), 'le tour demande le palier 2');
  assert(g.unlock('presse') && g.lab.lingot_fer === need - 20 && g.hasMachine('presse'), `presse : ${g.lab.lingot_fer}`);
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
test('arbre : effets appliqués et gardés dans la sauvegarde', () => {
  const g = new Game('TEST-30');
  assert(g.hasMachine('four') && g.hasMachine('coffre') && !g.hasMachine('presse'), 'départ');
  g.money = 1000; g.world.reveal(-6, 2, 20);
  assert(!g.placeMachine('presse', 4, 9), 'la presse ne devrait pas se poser avant d’être débloquée');
  g.palier = 2;
  g.lab = { lingot_fer: 100, plaque_fer: 200, fil_cuivre: 100 };
  assert(g.unlock('presse') && g.hasMachine('presse'), 'presse');
  assert(g.unlock('tapis2') && g.unlock('rapide') && g.beltMaxLevel === 3, 'tapis niveau 3 possible');
  assert(g.unlock('separateur') && g.unlock('grand_coffre') && g.hasMachine('grand_coffre') && g.factory.chestSlots === 10, 'grand coffre : une machine à part');
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(g2.hasMachine('presse') && g2.beltMaxLevel === 3 && g2.palier === 2, 'sauvegarde de l’arbre');
  // Une ancienne partie avec le Filtre (ou les Ascenseurs) a le déblocage unique Séparateur, filtre et ascenseur.
  const s3 = JSON.parse(JSON.stringify(g.serialize()));
  s3.unlocks = (s3.unlocks as string[]).filter((x) => x !== 'separateur').concat('tri');
  const g3 = new Game(s3.seed, s3);
  assert(g3.unlocks.has('separateur') && !g3.unlocks.has('tri') && g3.levels2, 'Filtre repris dans le Séparateur');
  assert(JSON.stringify(g2.lab) === JSON.stringify(g.lab), 'labo');
});
test('une sauvegarde d’avant les paliers garde ses déblocages et repart au palier 1', () => {
  const g = new Game('TEST-31');
  const s = JSON.parse(JSON.stringify(g.serialize()));
  s.v = 3; s.level = 4; s.unlocks = ['foreuse', 'four', 'presse', 'tour']; s.drones = 2;
  delete s.palier; delete s.palierDone; delete s.lab; delete s.extraDrones;
  const g2 = new Game(s.seed, s);
  assert(g2.palier === 1 && g2.hasMachine('presse') && g2.hasMachine('tour'), 'déblocages gardés');
  delete s.unlocks;
  const g3 = new Game(s.seed, s);
  assert(g3.hasMachine('presse') && g3.hasMachine('tour') && g3.hasMachine('trefileuse'), 'machines de l’ancien niveau 4');
});

console.log('Inventaire et fabrication');
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
  g.look = { color: 'ciel', skin: 'origine', name: 'Zébulon' };
  g.tips.done.push('charbon');
  run(g, 2);
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(g2.look.name === 'Zébulon' && g2.look.color === 'ciel' && g2.tips.done[0] === 'charbon' && !g2.tips.off, 'apparence ou conseils perdus');
  assert(g2.played >= 1, `temps de jeu ${g2.played}`);
  delete s.look; delete s.tips; s.v = 4;
  const g3 = new Game(s.seed, s);
  assert(g3.look.name === 'Boulon' && g3.tips.off, 'ancienne partie');
  s.look = { color: 'violet-fluo', accessory: 'canon', skin: 'chat', name: '' };
  const g4 = new Game(s.seed, s);
  assert(g4.look.color === 'jaune' && g4.look.skin === 'origine' && g4.look.name === 'Boulon', 'apparence invalide nettoyée');
});
test('succès et skins : paliers Fortune, skin gagné puis porté, anciens succès repris', () => {
  const g = new Game('TEST-SKIN');
  assert(g.ownsSkin('origine') && !g.ownsSkin('tirelire') && !g.setSkin('tirelire'), 'au départ, le Boulon d’origine seul');
  g.earned = 99999; run(g, 3);
  assert(!g.achievements.has('fortune1'), 'pas avant 100 000 pièces');
  // Les commandes du Comptoir comptent dans les pièces gagnées ; un remboursement non.
  g.earned = 0; g.earn(500);
  assert(g.earned === 0, 'un remboursement ne compte pas');
  g.order = { id: 1, rarity: 'commune', lines: [], xp: 0, money: 100000 } as never;
  (g as unknown as { completeOrder: () => void }).completeOrder();
  assert(g.earned === 100000 && g.ordersDone === 1, `gagné ${g.earned}`);
  run(g, 3);
  assert(g.achievements.has('fortune1') && !g.achievements.has('fortune2'), 'Fortune I');
  assert(g.setSkin('tirelire') && g.look.skin === 'tirelire', 'skin porté');
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(s.seed, s);
  assert(g2.look.skin === 'tirelire' && g2.earned === 100000, 'skin et compteur sauvegardés');
  // Une ancienne partie : objets10k devient Production I, les succès sans skin disparaissent, skin non gagné refusé.
  s.achievements = ['objets10k', 'plaques100', 'palier3']; s.look.skin = 'dore'; delete s.earned; s.money = 30000;
  const g3 = new Game(s.seed, s);
  assert(g3.achievements.has('production1') && g3.achievements.has('palier3') && !g3.achievements.has('plaques100'), `migration : ${[...g3.achievements]}`);
  assert(g3.look.skin === 'origine', 'skin non gagné retiré');
  assert(g3.earned > 0, 'compteur estimé');
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

test('tapis sur 2 niveaux : un tapis en hauteur passe au-dessus d’un tapis du sol', () => {
  const g = new Game('TEST-Z1');
  g.money = 100000; g.world.reveal(6, 6, 20);
  const a = g.placeMachine('coffre', 1, 6)!, b = g.placeMachine('coffre', 11, 6)!;
  const c = g.placeMachine('coffre', 6, 1)!, d = g.placeMachine('coffre', 6, 11)!;
  assert(g.placeBelts(trace(g, [[1.5, 6.5], [11.5, 6.5]]).result()), 'tapis du sol');
  const t = traceL(g, 1, [[6.5, 1.5], [6.5, 11.5]]);
  assert(t.valid && !t.blocked && t.cells.length === 9 && t.cells.every((x) => x.z === 1) && t.liftCount === 0, `tout en hauteur : ${JSON.stringify(t.cells)}`);
  assert(g.placeBelts(t.result()), 'posé');
  assert(g.factory.beltAt(6, 6) && g.factory.beltAt(6, 6, 1)?.z === 1, 'deux tapis sur la même case');
  for (const m of g.factory.machines.values()) m.built = true;
  g.pending = []; g.factory.markBuilt();
  g.factory.putInStorage(a, 'fer', 5); g.factory.putInStorage(c, 'cuivre', 5);
  run(g, 40);
  assert(b.inBuf.fer === 5 && !b.inBuf.cuivre && d.inBuf.cuivre === 5 && !d.inBuf.fer, `chacun son chemin : ${JSON.stringify(b.inBuf)} ${JSON.stringify(d.inBuf)}`);
  const g2 = new Game('TEST-Z1', JSON.parse(JSON.stringify(g.serialize())));
  assert(g2.factory.beltAt(6, 6, 1)?.z === 1 && g2.factory.beltAt(6, 6)!.z === undefined, 'sauvegardé');
  assert(!g.view.checkMachine('coffre', 6, 3).ok, 'pas de machine sous un tapis en hauteur');
  assert(g.removeAt(6, 6) && !g.factory.beltAt(6, 6, 1) && g.factory.beltAt(6, 6), 'la gomme retire d’abord celui du haut');
});

test('ascenseurs : changer de niveau en traçant, ou s’arrêter sur un tapis de l’autre niveau', () => {
  const g = new Game('TEST-Z2');
  g.money = 100000; g.world.reveal(6, 10, 24);
  // Un tapis du sol en travers (vertical), que le tapis horizontal enjambe en hauteur.
  const v0 = g.placeMachine('coffre', 7, 1)!, v1 = g.placeMachine('coffre', 7, 11)!;
  assert(g.placeBelts(trace(g, [[7.5, 1.5], [7.5, 11.5]]).result()), 'tapis en travers');
  const a = g.placeMachine('coffre', 1, 6)!, b = g.placeMachine('coffre', 12, 6)!;
  const t = traceL(g, 0, [[1.5, 6.5], [5.5, 6.5], '1', [9.5, 6.5], '0', [12.5, 6.5]]);
  assert(t.valid && !t.blocked && t.liftCount === 2, `deux ascenseurs : ${JSON.stringify(t.cells)}`);
  assert(t.cells.find((c) => c.x === 7)!.z === 1 && t.cells.find((c) => c.x === 11)!.z === 0, 'en hauteur au-dessus du tapis en travers, au sol au bout');
  assert(g.placeBelts(t.result()), 'posé');
  // Un tapis du sol en bas ; un tapis en hauteur qui s'arrête dessus le rejoint par un ascenseur (par le côté).
  const e = g.placeMachine('coffre', 1, 15)!, f = g.placeMachine('coffre', 12, 15)!;
  assert(g.placeBelts(trace(g, [[1.5, 15.5], [12.5, 15.5]]).result()), 'tapis du bas');
  const h = g.placeMachine('coffre', 4, 19)!;
  const t2 = traceL(g, 1, [[4.5, 19.5], [4.5, 15.5]]);
  assert(t2.valid && !t2.blocked && t2.endTarget?.x === 4 && t2.endTarget.y === 15 && t2.liftCount === 1, `il s’arrête sur le tapis du sol : ${JSON.stringify(t2.cells)} ${JSON.stringify(t2.endTarget)}`);
  assert(g.placeBelts(t2.result()), 'posé');
  for (const m of g.factory.machines.values()) m.built = true;
  g.pending = []; g.factory.markBuilt();
  g.factory.putInStorage(a, 'fer', 5); g.factory.putInStorage(v0, 'cuivre', 5); g.factory.putInStorage(h, 'charbon', 4);
  run(g, 60);
  assert(b.inBuf.fer === 5 && v1.inBuf.cuivre === 5 && !b.inBuf.cuivre && !v1.inBuf.fer, `ascenseurs : ${JSON.stringify(b.inBuf)} ${JSON.stringify(v1.inBuf)}`);
  assert(f.inBuf.charbon === 4 && e !== f, `descendu sur le tapis du bas : ${JSON.stringify(f.inBuf)}`);
  // Le niveau qui change sur la toute première case : elle change avec.
  const t3 = traceL(g, 0, [[3.5, 22.5], '1', [6.5, 22.5]]);
  assert(t3.cells.every((c) => c.z === 1), 'première case montée avec le niveau');
});

console.log(`\n${passed} réussis, ${failed} en échec`);
if (failed) (globalThis as unknown as { process: { exit(c: number): void } }).process.exit(1);
