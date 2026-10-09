// L'usine : tapis et machines sur la grille, et leur simulation.
import { RULES } from '../config.ts';
import { acceptedInputs, MACHINES, machineDef, type MachineDef, type Recipe } from '../data/machines.ts';
import { DX, DY, key, opposite, type Dir } from './geom.ts';
import { RICHNESS_RATE, type World } from '../world/world.ts';

export interface BeltItem {
  t: string;
  /** Avancée dans la case, de 0 (entrée) à 1 (sortie). */
  p: number;
  /** Sur un séparateur : 1 si l'objet part par la dérivation. */
  o?: 1;
  /** Arrivé par le côté : décalage (en cases) qui se résorbe en avançant, pour ne pas sauter au milieu. */
  sx?: number;
  sy?: number;
}

export interface Belt {
  x: number;
  y: number;
  /** Sens de sortie. */
  dir: Dir;
  /** Sens d'entrée (d'où viennent les objets). */
  inDir: Dir;
  built: boolean;
  items: BeltItem[];
  /** Séparateur : sens de la dérivation (les objets alternent entre `dir` et `split`). */
  split?: Dir;
  /** Alternance du séparateur. */
  toggle?: number;
  /** Liaisons de côté : les machines voisines dans ces sens y déposent leur production (sans case de tapis). */
  feeds?: Dir[];
  /** Pont : nombre de cases enjambées tout droit (la case suivante est jump + 1 plus loin). */
  jump?: number;
}

/** Longueur parcourue sur une case de tapis, en cases (plus longue sur un pont). */
export function span(b: { jump?: number }): number {
  return 1 + (b.jump ?? 0);
}

export type MachineStatus = 'idle' | 'working' | 'blocked' | 'nofuel' | 'noinput' | 'noore';

export interface Machine {
  id: number;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  built: boolean;
  inBuf: Record<string, number>;
  outBuf: Record<string, number>;
  /** Charbon dans la case carburant (0 à 10). */
  fuel: number;
  /** Secondes de travail restantes du charbon en cours. */
  burn: number;
  craft: { ri: number; t: number } | null;
  /** Foreuse : matière et vitesse (objets par seconde). */
  ore?: string;
  rate?: number;
  drillT: number;
  /** Recette choisie quand plusieurs recettes ont les mêmes entrées (raffinerie). */
  choice?: string;
  status: MachineStatus;
  /** Tourniquets pour répartir sorties et recettes. */
  rrOut: number;
  rrRecipe: number;
  /** Total fabriqué (statistiques, animation). */
  made: number;
  /** Débit réel : ce qui est entré et sorti ces dernières secondes (non sauvegardé). */
  flowEv?: { t: number; k: string; n: number; out: boolean }[];
  flowSince?: number;
  /** Liaisons directes vers des machines collées (sans case de tapis). */
  links?: number[];
  linkT?: number;
}

/** Fenêtre de mesure du débit réel, en secondes. */
export const FLOW_WINDOW = 20;

type Next =
  | { kind: 'belt'; belt: Belt; side: boolean }
  | { kind: 'machine'; machine: Machine }
  | null;

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
  ore?: string;
  rate?: number;
  /** Tapis sous la machine (posée sur un tapis : ils sont remplacés, l'entrée et la sortie se branchent). */
  belts?: number;
}

const DRILL_BASE_RATE = 0.5;

export class Factory {
  readonly belts = new Map<number, Belt>();
  readonly machines = new Map<number, Machine>();
  private cellMachine = new Map<number, Machine>();
  private nextId = 1;

  // Topologie, recalculée quand l'usine change.
  private dirty = true;
  private order: Belt[] = [];
  private nextOf = new Map<Belt, Next>();
  private splitOf = new Map<Belt, Next>();
  private outputs = new Map<Machine, Belt[]>();
  private accepts = new Map<string, Set<string>>();

  /** Vitesse des tapis (déblocages Tapis rapide et express). */
  speedMult = 1;
  /** Cases d'un coffre (déblocage Grand coffre). */
  chestSlots = RULES.chestSlots;
  /** Les bâtiments spéciaux (Noyau, Laboratoire, Comptoir) acceptent-ils cet objet ? */
  buildingAccepts: (m: Machine, item: string) => boolean = () => true;
  /** Appelé quand un objet entre dans un bâtiment spécial. */
  onDeliver: (m: Machine, item: string) => void = () => {};

  readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  // ---------- Consultation ----------

  beltAt(x: number, y: number): Belt | undefined {
    return this.belts.get(key(x, y));
  }

  machineAt(x: number, y: number): Machine | undefined {
    return this.cellMachine.get(key(x, y));
  }

  isFree(x: number, y: number): boolean {
    const k = key(x, y);
    return !this.belts.has(k) && !this.cellMachine.has(k);
  }

  inside(m: Machine, x: number, y: number): boolean {
    return x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h;
  }

  /** Le tapis suivant d'une case (pour le rendu et les tests). */
  next(b: Belt): Next {
    this.refresh();
    return this.nextOf.get(b) ?? null;
  }

  /** La case de tapis qui nourrit celle-ci par l'arrière (voisine, ou un pont qui atterrit ici). */
  feederOf(b: Belt): Belt | null {
    for (let k = 1; k <= RULES.bridgeSpan + 1; k++) {
      const f = this.beltAt(b.x - DX[b.inDir] * k, b.y - DY[b.inDir] * k);
      if (f && f.x + DX[f.dir] * span(f) === b.x && f.y + DY[f.dir] * span(f) === b.y) return f;
    }
    return null;
  }

  /** Vrai si rien ne nourrit ce tapis (premier maillon d'une chaîne). */
  isChainStart(b: Belt): boolean {
    return !this.feederOf(b);
  }

  /** Toutes les cases d'une chaîne de tapis reliée à cette case (amont et aval, sans les branches). */
  chainOf(b: Belt): Belt[] {
    const out: Belt[] = [b];
    const seen = new Set<Belt>([b]);
    // Amont
    let cur: Belt | undefined = b;
    while (cur) {
      const f = this.feederOf(cur);
      if (!f || seen.has(f)) break;
      out.unshift(f); seen.add(f); cur = f;
    }
    // Aval
    cur = b;
    while (cur) {
      const L = span(cur);
      const n = this.beltAt(cur.x + DX[cur.dir] * L, cur.y + DY[cur.dir] * L);
      if (!n || seen.has(n)) break;
      if (n.inDir !== cur.dir) break; // chargement par le côté : autre chaîne
      out.push(n); seen.add(n); cur = n;
    }
    return out;
  }

  // ---------- Construction ----------

  checkMachine(type: string, x: number, y: number, ignore?: Machine, overBelts = false): PlaceCheck {
    const def = machineDef(type);
    const oreCount = new Map<string, { n: number; rate: number }>();
    let belts = 0;
    for (let j = 0; j < def.h; j++) {
      for (let i = 0; i < def.w; i++) {
        const cx = x + i, cy = y + j;
        if (!this.world.isRevealed(cx, cy)) return { ok: false, reason: 'Zone inexplorée' };
        const k = key(cx, cy);
        const m = this.cellMachine.get(k);
        if (m && m !== ignore) return { ok: false, reason: 'Place occupée' };
        if (this.belts.has(k)) {
          if (!overBelts) return { ok: false, reason: 'Place occupée' };
          belts++;
        }
        if (def.kind === 'drill') {
          const p = this.world.patchAt(cx, cy);
          if (p) {
            const e = oreCount.get(p.type) ?? { n: 0, rate: RICHNESS_RATE[p.richness] };
            e.n++;
            e.rate = Math.max(e.rate, RICHNESS_RATE[p.richness]);
            oreCount.set(p.type, e);
          }
        }
      }
    }
    if (def.kind === 'drill') {
      let best: [string, { n: number; rate: number }] | null = null;
      for (const e of oreCount) if (!best || e[1].n > best[1].n) best = e;
      if (!best || best[1].n < 2) return { ok: false, reason: 'À poser sur un filon' };
      return { ok: true, ore: best[0], rate: DRILL_BASE_RATE * best[1].rate * (best[1].n / 4 * 0.5 + 0.5), belts };
    }
    return { ok: true, belts };
  }

  addMachine(type: string, x: number, y: number, built = false, id?: number): Machine {
    const def = machineDef(type);
    const check = def.kind === 'drill' ? this.checkMachine(type, x, y, undefined, true) : { ok: true } as PlaceCheck;
    if (id === undefined) id = this.nextId++;
    else this.nextId = Math.max(this.nextId, id + 1);
    const m: Machine = {
      id, type, x, y, w: def.w, h: def.h, built,
      inBuf: {}, outBuf: {}, fuel: 0, burn: 0, craft: null, drillT: 0,
      status: 'idle', rrOut: 0, rrRecipe: 0, made: 0,
      ore: check.ore, rate: check.rate,
    };
    this.machines.set(m.id, m);
    this.indexMachine(m);
    this.dirty = true;
    return m;
  }

  private indexMachine(m: Machine): void {
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) this.cellMachine.set(key(m.x + i, m.y + j), m);
  }

  private unindexMachine(m: Machine): void {
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) this.cellMachine.delete(key(m.x + i, m.y + j));
  }

  moveMachine(m: Machine, x: number, y: number): boolean {
    const check = this.checkMachine(m.type, x, y, m, true);
    if (check.ok && check.belts) return false;
    if (!check.ok) return false;
    this.unindexMachine(m);
    m.x = x; m.y = y;
    if (check.ore) { m.ore = check.ore; m.rate = check.rate; }
    this.indexMachine(m);
    this.dirty = true;
    return true;
  }

  removeMachine(m: Machine): void {
    this.unindexMachine(m);
    this.machines.delete(m.id);
    this.dirty = true;
  }

  addBelt(x: number, y: number, dir: Dir, inDir: Dir, built = false): Belt {
    const b: Belt = { x, y, dir, inDir, built, items: [] };
    this.belts.set(key(x, y), b);
    this.dirty = true;
    return b;
  }

  setSplit(b: Belt, dir: Dir): void {
    b.split = dir;
    this.dirty = true;
  }

  /** Relie une machine voisine au côté d'un tapis : elle y dépose sa production. */
  addFeed(b: Belt, dir: Dir): void {
    if (!b.feeds?.includes(dir)) b.feeds = [...(b.feeds ?? []), dir];
    this.dirty = true;
  }

  /** Coupe les liaisons de côté d'un tapis (toutes, ou une seule). */
  clearFeeds(b: Belt, dir?: Dir): void {
    if (dir === undefined) delete b.feeds;
    else { b.feeds = (b.feeds ?? []).filter((d) => d !== dir); if (!b.feeds.length) delete b.feeds; }
    this.dirty = true;
  }

  setBeltDir(b: Belt, dir: Dir): void {
    b.dir = dir;
    this.dirty = true;
  }

  removeBelt(b: Belt): void {
    this.belts.delete(key(b.x, b.y));
    // Un séparateur dont on retire la dérivation redevient un tapis simple.
    for (let d = 0; d < 4; d++) {
      const nb = this.beltAt(b.x - DX[d], b.y - DY[d]);
      if (nb && nb.split === d) delete nb.split;
    }
    this.dirty = true;
  }

  markBuilt(): void {
    this.dirty = true;
  }

  setChoice(m: Machine, out: string): void {
    m.choice = out;
    m.craft = null;
  }

  // ---------- Topologie ----------

  private refresh(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.nextOf.clear();
    this.outputs.clear();
    for (const m of this.machines.values()) this.outputs.set(m, []);

    this.splitOf.clear();
    for (const b of this.belts.values()) {
      const nxt = this.linkFor(b, b.dir);
      this.nextOf.set(b, nxt);
      if (b.split !== undefined) this.splitOf.set(b, this.linkFor(b, b.split));
      // Sortie de machine : la case d'où vient le tapis est dans une machine.
      const fm = this.machineAt(b.x - DX[b.inDir], b.y - DY[b.inDir]);
      if (fm && !(nxt?.kind === 'machine' && nxt.machine === fm)) this.outputs.get(fm)!.push(b);
      // Liaison de côté : la machine voisine dépose au milieu de la case.
      for (const fd of b.feeds ?? []) {
        const lm = this.machineAt(b.x + DX[fd], b.y + DY[fd]);
        if (lm && lm !== fm && !(nxt?.kind === 'machine' && nxt.machine === lm) && !this.outputs.get(lm)!.includes(b)) this.outputs.get(lm)!.push(b);
      }
    }

    // Ordre de mise à jour : l'aval d'abord, pour que les objets avancent en file.
    const visited = new Set<Belt>();
    const order: Belt[] = [];
    const visit = (start: Belt) => {
      // Parcours itératif en profondeur, post-ordre sur « suivant ».
      const stack: [Belt, boolean][] = [[start, false]];
      while (stack.length) {
        const [b, done] = stack.pop()!;
        if (done) { order.push(b); continue; }
        if (visited.has(b)) continue;
        visited.add(b);
        stack.push([b, true]);
        const n = this.nextOf.get(b);
        if (n?.kind === 'belt' && !visited.has(n.belt)) stack.push([n.belt, false]);
        const sp = this.splitOf.get(b);
        if (sp?.kind === 'belt' && !visited.has(sp.belt)) stack.push([sp.belt, false]);
      }
    };
    for (const b of this.belts.values()) visit(b);
    this.order = order;
  }

  /** Ce qui suit une case de tapis dans une direction donnée. */
  private linkFor(b: Belt, dir: Dir): Next {
    // Un pont atterrit plus loin, tout droit.
    const L = dir === b.dir ? span(b) : 1;
    const nx = b.x + DX[dir] * L, ny = b.y + DY[dir] * L;
    const nb = this.beltAt(nx, ny);
    if (nb) {
      // Deux tapis face à face ne se relient pas.
      if (nb.x + DX[nb.dir] * span(nb) === b.x && nb.y + DY[nb.dir] * span(nb) === b.y) return null;
      // On ne monte pas sur un pont par le côté.
      if (nb.jump && nb.inDir !== dir) return null;
      return { kind: 'belt', belt: nb, side: nb.inDir !== dir };
    }
    const m = this.machineAt(nx, ny);
    return m ? { kind: 'machine', machine: m } : null;
  }

  /** La dérivation d'un séparateur (pour les tests). */
  splitNext(b: Belt): Next {
    this.refresh();
    return this.splitOf.get(b) ?? null;
  }

  /** Un objet entre dans une case : sur un séparateur, il prend une sortie sur deux. */
  private enter(b: Belt, it: BeltItem): void {
    if (b.split === undefined) { delete it.o; return; }
    b.toggle = (b.toggle ?? 0) ^ 1;
    if (b.toggle) it.o = 1; else delete it.o;
  }

  /** Sorties d'une machine (pour le rendu et les tests). */
  outputsOf(m: Machine): Belt[] {
    this.refresh();
    return this.outputs.get(m) ?? [];
  }

  // ---------- Simulation ----------

  private acceptSet(def: MachineDef): Set<string> {
    let s = this.accepts.get(def.id);
    if (!s) { s = acceptedInputs(def); this.accepts.set(def.id, s); }
    return s;
  }

  // ---------- Charbon et coffres ----------

  /** Place restante dans la case carburant. */
  fuelRoom(m: Machine): number {
    const def = machineDef(m.type);
    if (this.selfFed(m)) return 0;
    return def.coal ? Math.max(0, RULES.fuelStack - m.fuel) : 0;
  }

  /** Une foreuse sur du charbon s'alimente elle-même : personne n'a besoin de la recharger. */
  selfFed(m: Machine): boolean {
    return m.ore === 'charbon' && machineDef(m.type).kind === 'drill';
  }

  /** Ajoute du charbon dans la case carburant ; renvoie la quantité ajoutée. */
  addFuel(m: Machine, n: number): number {
    const k = Math.min(n, this.fuelRoom(m));
    m.fuel += k;
    return k;
  }

  /** La machine fait clignoter son voyant : il lui faut du charbon. */
  lowFuel(m: Machine): boolean {
    return m.built && machineDef(m.type).coal && !this.selfFed(m) && m.fuel <= RULES.lowFuel;
  }

  /** Cases occupées d'un coffre (piles de 10). */
  storageSlots(m: Machine): number {
    let n = 0;
    for (const v of Object.values(m.inBuf)) n += Math.ceil(v / RULES.invStack);
    return n;
  }

  /** Place restante dans un coffre pour un type d'objet. */
  storageRoom(m: Machine, item: string): number {
    const have = m.inBuf[item] ?? 0;
    const partial = have % RULES.invStack ? RULES.invStack - (have % RULES.invStack) : 0;
    return partial + Math.max(0, this.chestSlots - this.storageSlots(m)) * RULES.invStack;
  }

  /** Brûle du charbon pour travailler dt secondes ; faux s'il n'y en a plus. */
  private useFuel(m: Machine, def: MachineDef, dt: number): boolean {
    if (!def.coal) return true;
    if (m.burn <= 0) {
      if (m.fuel <= 0) return false;
      m.fuel--;
      this.flow(m, 'charbon', 1, false);
      m.burn += RULES.coalMachineSeconds;
    }
    m.burn -= dt;
    return true;
  }

  canAccept(m: Machine, item: string): boolean {
    if (!m.built) return false;
    const def = machineDef(m.type);
    if (def.kind === 'core' || def.kind === 'lab' || def.kind === 'missions' || def.kind === 'sell') return this.buildingAccepts(m, item);
    if (def.kind === 'storage') return this.storageRoom(m, item) > 0;
    if (item === 'charbon' && def.coal && m.fuel < RULES.fuelStack) return true;
    if (def.kind !== 'crafter') return false;
    if (!this.acceptSet(def).has(item)) return false;
    return (m.inBuf[item] ?? 0) < RULES.machineBuffer;
  }

  /** Une machine qui utilise le charbon comme ingrédient (fourneau). */
  private coalIngredient(def: MachineDef): boolean {
    return def.recipes.some((r) => r.in.charbon);
  }

  private give(m: Machine, item: string): void {
    const def = machineDef(m.type);
    if (def.kind === 'core' || def.kind === 'lab' || def.kind === 'missions' || def.kind === 'sell') { this.onDeliver(m, item); return; }
    if (item === 'charbon' && def.coal && m.fuel < RULES.fuelStack) {
      // Le carburant d'abord ; un fourneau bien chargé garde le reste comme ingrédient.
      const asIngredient = this.coalIngredient(def) && m.fuel >= 3 && (m.inBuf.charbon ?? 0) < RULES.machineBuffer;
      if (!asIngredient) { m.fuel++; return; }
    }
    m.inBuf[item] = (m.inBuf[item] ?? 0) + 1;
  }

  /** Retire des objets d'un coffre ; renvoie la quantité prise. */
  takeFromStorage(m: Machine, item: string, n: number): number {
    const k = Math.min(n, m.inBuf[item] ?? 0);
    if (k > 0) m.inBuf[item] -= k;
    if (m.inBuf[item] === 0) delete m.inBuf[item];
    return k;
  }

  /** Dépose des objets dans un coffre ; renvoie la quantité déposée. */
  putInStorage(m: Machine, item: string, n: number): number {
    const k = Math.min(n, this.storageRoom(m, item));
    if (k > 0) m.inBuf[item] = (m.inBuf[item] ?? 0) + k;
    return k;
  }

  /** Dépose des ingrédients dans une machine ; renvoie la quantité déposée. */
  putInMachine(m: Machine, item: string, n: number): number {
    const def = machineDef(m.type);
    if (def.kind === 'storage') return this.putInStorage(m, item, n);
    if (def.kind !== 'crafter' || !this.acceptSet(def).has(item) || item === 'charbon') return 0;
    const k = Math.min(n, RULES.machineBuffer - (m.inBuf[item] ?? 0));
    if (k > 0) m.inBuf[item] = (m.inBuf[item] ?? 0) + k;
    return Math.max(0, k);
  }

  /** La suite peut-elle prendre un objet maintenant ? */
  private canTake(n: Next, item: string): boolean {
    if (!n) return false;
    if (n.kind === 'machine') return this.canAccept(n.machine, item);
    if (!n.belt.built) return false;
    if (n.side) return this.roomAt(n.belt, 0.5);
    const items = n.belt.items;
    return items.length === 0 || items[items.length - 1].p >= RULES.beltGap / span(n.belt);
  }

  /** Une case peut-elle recevoir un objet à la position p ? */
  private roomAt(b: Belt, p: number): boolean {
    const gap = RULES.beltGap / span(b);
    for (const it of b.items) if (Math.abs(it.p - p) < gap - 1e-6) return false;
    return true;
  }

  /** Horloge de l'usine (pour mesurer les débits). */
  clock = 0;

  /** Note un objet qui entre dans une machine (consommé) ou qui en sort (fabriqué). */
  private flow(m: Machine, k: string, n: number, out: boolean): void {
    const ev = (m.flowEv ??= []);
    if (m.flowSince === undefined) m.flowSince = this.clock;
    ev.push({ t: this.clock, k, n, out });
    while (ev.length && ev[0].t < this.clock - FLOW_WINDOW) ev.shift();
  }

  /** Débit réel d'une machine, en objets par seconde, sur les dernières secondes. */
  flowOf(m: Machine): { in: Record<string, number>; out: Record<string, number> } {
    const res = { in: {} as Record<string, number>, out: {} as Record<string, number> };
    if (m.flowSince === undefined) return res;
    const span = Math.max(4, Math.min(FLOW_WINDOW, this.clock - m.flowSince));
    for (const e of m.flowEv ?? []) {
      if (e.t < this.clock - FLOW_WINDOW) continue;
      const r = e.out ? res.out : res.in;
      r[e.k] = (r[e.k] ?? 0) + e.n / span;
    }
    return res;
  }

  tick(dt: number): void {
    this.clock += dt;
    this.refresh();
    const speed = RULES.beltSpeed * this.speedMult * dt;
    const gap = RULES.beltGap;

    for (const b of this.order) {
      if (!b.built || b.items.length === 0) continue;
      // Sur un pont, p couvre plusieurs cases : on avance moins vite en p, avec un écart plus petit en p.
      const Lb = span(b), sp = speed / Lb, gp = gap / Lb;
      const main = this.nextOf.get(b) ?? null;
      const branch = b.split !== undefined ? this.splitOf.get(b) ?? null : null;
      const items = b.items; // triés : le plus avancé en premier
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.sx || it.sy) {
          const k = Math.hypot(it.sx ?? 0, it.sy ?? 0), nk = Math.max(0, k - speed);
          if (nk === 0) { delete it.sx; delete it.sy; } else { it.sx = (it.sx ?? 0) * nk / k; it.sy = (it.sy ?? 0) * nk / k; }
        }
        // Sur un séparateur, si une sortie n'existe plus, l'objet prend l'autre.
        if (it.o && !branch) delete it.o;
        else if (!it.o && !main && branch) it.o = 1;
        // Le premier objet d'un séparateur prend l'autre sortie si la sienne est bouchée.
        if (i === 0 && main && branch) {
          const want = it.o ? branch : main, other = it.o ? main : branch;
          if (!this.canTake(want, it.t) && this.canTake(other, it.t)) { if (it.o) delete it.o; else it.o = 1; }
        }
        const nxt = it.o ? branch : main;
        let limit: number;
        if (i > 0) {
          limit = items[i - 1].p - gp;
        } else if (nxt?.kind === 'belt' && nxt.belt.built) {
          if (nxt.side) {
            limit = 1;
          } else {
            const Lt = span(nxt.belt);
            const rear = nxt.belt.items.length ? nxt.belt.items[nxt.belt.items.length - 1].p : Infinity;
            limit = Math.min(1 + (rear * Lt - gap) / Lb, 1 + 0.5 / Lb);
          }
        } else if (nxt?.kind === 'machine' && nxt.machine.built) {
          limit = 1;
        } else {
          limit = 0.75; // bout de tapis : l'objet attend au milieu de la case
        }
        if (it.p < limit) it.p = Math.min(it.p + sp, limit);

        if (i === 0 && it.p >= 1 && nxt) {
          if (nxt.kind === 'belt' && nxt.belt.built) {
            const target = nxt.belt;
            const entry = nxt.side ? 0.5 : (it.p - 1) * Lb / span(target);
            if (this.roomAt(target, entry)) {
              items.shift(); i--;
              const moved: BeltItem = { t: it.t, p: entry };
              if (nxt.side) {
                // Il arrive par le côté : il part du bord commun et glisse jusqu'au milieu.
                const d = it.o && b.split !== undefined ? b.split : b.dir;
                moved.sx = -DX[d] * 0.5; moved.sy = -DY[d] * 0.5;
              }
              this.enter(target, moved);
              target.items.push(moved);
              if (nxt.side) target.items.sort((a, c) => c.p - a.p);
            } else {
              it.p = 1;
            }
          } else if (nxt.kind === 'machine' && this.canAccept(nxt.machine, it.t)) {
            items.shift(); i--;
            this.give(nxt.machine, it.t);
          } else {
            it.p = 1;
          }
        }
      }
    }

    for (const m of this.machines.values()) {
      if (!m.built) continue;
      const def = machineDef(m.type);
      if (def.kind === 'drill') this.tickDrill(m, dt);
      else if (def.kind === 'crafter') this.tickCrafter(m, def, dt);
      if (def.kind === 'drill' || def.kind === 'crafter' || def.kind === 'storage') {
        this.pushOutputs(m, def.kind === 'storage' ? m.inBuf : m.outBuf);
        if (m.links?.length) this.pushLinks(m, def.kind === 'storage' ? m.inBuf : m.outBuf, dt);
      }
    }
  }

  private outCount(m: Machine): number {
    let n = 0;
    for (const v of Object.values(m.outBuf)) n += v;
    return n;
  }

  private tickDrill(m: Machine, dt: number): void {
    if (!m.ore || !m.rate) { m.status = 'noore'; return; }
    if (this.outCount(m) >= RULES.machineBuffer) { m.status = 'blocked'; m.drillT = Math.min(m.drillT, 1); return; }
    // Sur du charbon, elle démarre même à vide : elle brûlera ce qu'elle extrait.
    if (!this.useFuel(m, machineDef(m.type), dt) && !this.selfFed(m)) { m.status = 'nofuel'; return; }
    m.status = 'working';
    m.drillT += dt * m.rate;
    if (m.drillT >= 1) {
      m.drillT -= 1;
      m.made++;
      if (this.selfFed(m) && m.fuel < RULES.fuelStack) {
        m.fuel++; // sa propre case carburant d'abord
      } else {
        m.outBuf[m.ore] = (m.outBuf[m.ore] ?? 0) + 1;
        this.flow(m, m.ore, 1, true);
      }
    }
  }

  private recipeAllowed(def: MachineDef, m: Machine, rec: Recipe): boolean {
    // Plusieurs recettes avec les mêmes entrées : seule la recette choisie compte.
    const sig = Object.keys(rec.in).sort().join('+');
    const group = def.recipes.filter((r) => Object.keys(r.in).sort().join('+') === sig);
    if (group.length < 2) return true;
    const chosen = m.choice ?? Object.keys(group[0].out)[0];
    return rec.out[chosen] !== undefined;
  }

  private tickCrafter(m: Machine, def: MachineDef, dt: number): void {
    if (m.craft) {
      const rec = def.recipes[m.craft.ri];
      if (m.craft.t < rec.time) {
        if (!this.useFuel(m, def, dt)) { m.status = 'nofuel'; return; }
        m.craft.t += dt;
        if (m.craft.t < rec.time) { m.status = 'working'; return; }
      }
      for (const [k, v] of Object.entries(rec.out)) {
        if ((m.outBuf[k] ?? 0) + v > RULES.machineBuffer) { m.status = 'blocked'; m.craft.t = rec.time; return; }
      }
      for (const [k, v] of Object.entries(rec.out)) { m.outBuf[k] = (m.outBuf[k] ?? 0) + v; this.flow(m, k, v, true); }
      m.made++;
      m.craft = null;
    }
    // Choisir la prochaine recette d'après ce qui est arrivé.
    const n = def.recipes.length;
    for (let s = 0; s < n; s++) {
      const ri = (m.rrRecipe + s) % n;
      const rec = def.recipes[ri];
      if (!this.recipeAllowed(def, m, rec)) continue;
      let ok = true;
      for (const [k, v] of Object.entries(rec.in)) if ((m.inBuf[k] ?? 0) < v) { ok = false; break; }
      if (!ok) continue;
      for (const [k, v] of Object.entries(rec.in)) { m.inBuf[k] -= v; this.flow(m, k, v, false); }
      m.craft = { ri, t: 0 };
      m.rrRecipe = ri + 1;
      m.status = 'working';
      return;
    }
    m.status = this.hasAnyInput(m) ? 'noinput' : 'idle';
  }

  private hasAnyInput(m: Machine): boolean {
    for (const v of Object.values(m.inBuf)) if (v > 0) return true;
    return false;
  }

  /** Deux machines collées et reliées : les objets passent directement, à la vitesse d'un tapis. */
  private pushLinks(m: Machine, buf: Record<string, number>, dt: number): void {
    m.linkT = Math.min(1, (m.linkT ?? 0) + dt * RULES.beltSpeed * this.speedMult * 0.5);
    if (m.linkT < 1) return;
    for (const id of m.links!) {
      const to = this.machines.get(id);
      if (!to || !to.built) continue;
      const t = Object.keys(buf).find((k) => buf[k] > 0 && this.canAccept(to, k));
      if (!t) continue;
      buf[t]--;
      if (buf[t] === 0 && buf === m.inBuf) delete buf[t];
      this.give(to, t);
      m.linkT = 0;
      return;
    }
  }

  /** Les deux machines se touchent-elles par un côté ? */
  touching(a: Machine, b: Machine): boolean {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (ox === 0 && oy > 0) || (oy === 0 && ox > 0);
  }

  private pushOutputs(m: Machine, buf: Record<string, number>): void {
    const outs = this.outputs.get(m);
    if (!outs || outs.length === 0) return;
    const kinds = Object.keys(buf).filter((k) => buf[k] > 0);
    if (kinds.length === 0) return;
    for (let s = 0; s < outs.length; s++) {
      const b = outs[(m.rrOut + s) % outs.length];
      if (!b.built) continue;
      const side = (b.feeds ?? []).some((fd) => this.machineAt(b.x + DX[fd], b.y + DY[fd]) === m) && this.machineAt(b.x - DX[b.inDir], b.y - DY[b.inDir]) !== m;
      if (side) {
        if (!this.roomAt(b, 0.5)) continue;
      } else {
        const rear = b.items.length ? b.items[b.items.length - 1].p : Infinity;
        if (rear < RULES.beltGap / span(b)) continue;
      }
      const t = kinds[(m.rrOut + s) % kinds.length];
      buf[t]--;
      if (buf[t] === 0 && buf === m.inBuf) delete buf[t];
      const it: BeltItem = { t, p: side ? 0.5 : 0 };
      if (side) {
        // Il sort de la machine par le côté du tapis : il part de son bord.
        const fd = (b.feeds ?? []).find((d) => this.machineAt(b.x + DX[d], b.y + DY[d]) === m)!;
        it.sx = DX[fd] * 0.5; it.sy = DY[fd] * 0.5;
      }
      this.enter(b, it);
      b.items.push(it);
      if (side) b.items.sort((a, c) => c.p - a.p);
      m.rrOut = (m.rrOut + s + 1) % Math.max(outs.length, 1);
      return;
    }
  }

  // ---------- Sauvegarde ----------

  serialize(): FactorySave {
    return {
      nextId: this.nextId,
      belts: [...this.belts.values()].map((b) => [b.x, b.y, b.dir, b.inDir, b.built ? 1 : 0, b.items.map((i) => [i.t, Math.round(i.p * 1000) / 1000, i.o ?? 0]), b.split ?? -1, b.feeds?.length ? 10 + b.feeds.reduce<number>((a, d) => a | (1 << d), 0) : -1, b.jump ?? 0]),
      machines: [...this.machines.values()].map((m) => ({
        id: m.id, type: m.type, x: m.x, y: m.y, built: m.built, inBuf: m.inBuf, outBuf: m.outBuf,
        fuel: m.fuel, burn: m.burn, craft: m.craft, drillT: m.drillT, choice: m.choice, made: m.made, links: m.links,
      })),
    };
  }

  load(s: FactorySave): void {
    this.belts.clear(); this.machines.clear(); this.cellMachine.clear();
    for (const [x, y, dir, inDir, built, items, split, feed, jump] of s.belts) {
      const b = this.addBelt(x, y, dir as Dir, inDir as Dir, built === 1);
      b.items = items.map(([t, p, o]) => (o ? { t, p, o: 1 as const } : { t, p }));
      if (split !== undefined && split >= 0) b.split = split as Dir;
      if (jump) b.jump = Math.min(jump, RULES.bridgeSpan);
      // Liaisons de côté : 10 + masque des sens (une ancienne sauvegarde : un seul sens, de 0 à 3).
      if (feed !== undefined && feed >= 0) {
        b.feeds = feed >= 10 ? ([0, 1, 2, 3] as Dir[]).filter((d) => (feed - 10) & (1 << d)) : [feed as Dir];
      }
    }
    this.nextId = 1;
    for (const sm of s.machines) {
      // Chaque machine garde son numéro. (Avant, un numéro provisoire pouvait effacer
      // une machine déjà rechargée : elle disparaissait en laissant ses cases occupées.)
      if (!MACHINES[sm.type] || this.machines.has(sm.id)) continue;
      const m = this.addMachine(sm.type, sm.x, sm.y, sm.built, sm.id);
      Object.assign(m, { inBuf: sm.inBuf, outBuf: sm.outBuf, fuel: Math.min(sm.fuel ?? 0, RULES.fuelStack), burn: sm.burn ?? 0, craft: sm.craft, drillT: sm.drillT, choice: sm.choice, made: sm.made ?? 0 });
      if (sm.links?.length) m.links = [...sm.links];
    }
    this.nextId = Math.max(this.nextId, s.nextId);
    this.dirty = true;
  }
}

export interface FactorySave {
  nextId: number;
  belts: [number, number, number, number, number, [string, number, number?][], number?, number?, number?][];
  machines: {
    id: number; type: string; x: number; y: number; built: boolean;
    inBuf: Record<string, number>; outBuf: Record<string, number>; fuel: number; burn?: number;
    craft: { ri: number; t: number } | null; drillT: number; choice?: string; made?: number; links?: number[];
  }[];
}

export { opposite };
