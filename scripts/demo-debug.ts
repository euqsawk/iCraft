// Débogage des bases d'essai : carte texte et états après un temps de jeu.
import { Game } from '../src/sim/game.ts';
import { ALL_NODES } from '../src/data/unlocks.ts';
const { buildBase } = await import('./demo-saves.ts');
const palier = Number(process.argv[2] ?? 2), secs = Number(process.argv[3] ?? 60);
const g = new Game('DEMO-DEBUTS');
g.tips.off = true; g.palier = palier;
for (const n of ALL_NODES) if (n.effect.kind !== 'soon' && n.palier <= palier) g.unlocks.add(n.id);
(g as unknown as { applyUnlocks(): void }).applyUnlocks();
g.world.reveal(2, 7, 26 + palier * 5);
for (const t of ['comptoir', 'laboratoire'] as const) { const m = g.giveBuilding(t); if (m) m.built = true; }
const ends = buildBase(g, palier);
for (let i = 0; i < secs * 30; i++) g.tick(1 / 30);
const f = g.factory;
let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
for (const m of f.machines.values()) { minX = Math.min(minX, m.x); minY = Math.min(minY, m.y); maxX = Math.max(maxX, m.x + m.w); maxY = Math.max(maxY, m.y + m.h); }
const ch: Record<string, string> = { foreuse: 'D', four: 'F', presse: 'P', tour: 'T', trefileuse: 'W', station: 'S', coffre: 'c', grand_coffre: 'C', generateur: 'G', assembleur: 'A', depot: 'K', broyeur: 'B', raffinerie: 'R', gare: 'Q', noyau: 'N', comptoir: 'O', laboratoire: 'L' };
const arrows = '>v<^';
for (let y = minY - 1; y <= maxY; y++) {
  let row = '';
  for (let x = minX - 1; x <= maxX; x++) {
    const m = f.machineAt(x, y), b = f.beltAt(x, y);
    row += m ? (ch[m.type] ?? '?') : b ? arrows[b.dir] : g.world.patchAt(x, y) ? '.' : f.hasCable(x, y) ? '+' : ' ';
  }
  console.log(`${String(y).padStart(4)} ${row}`);
}
console.log('x from', minX - 1);
for (const m of f.machines.values()) console.log(m.type, m.id, `(${m.x},${m.y})`, m.status, 'fuel', m.fuel, 'in', JSON.stringify(m.inBuf), 'out', JSON.stringify(m.outBuf), 'made', m.made, m.built ? '' : 'NOT BUILT');
console.log('ends', ends.map((e) => e.name + '#' + e.m.id).join(' '));
