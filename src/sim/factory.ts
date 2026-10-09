// L'usine : tapis et machines sur la grille, et leur simulation.
import { RULES } from '../config.ts';
import { acceptedInputs, baseType, ELECTRIC_BASES, MACHINES, machineDef, type MachineDef, type Recipe } from '../data/machines.ts';
import { DX, DY, key, opposite, unkey, type Dir } from './geom.ts';
import { RICHNESS_RATE, type World } from '../world/world.ts';
import { isFuel } from '../data/items.ts';
import { addTo, burnOne, takeOf } from './fuel.ts';

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
  /** Séparateur dont la dérivation part en pont : nombre de cases enjambées par la dérivation. */
  splitJump?: number;
  /** Compteur posé sur cette case : les objets qui en sortent (date et matière), pour le débit. */
  meter?: { ev: { t: number; k: string }[]; since: number };
}

/** Longueur parcourue sur une case de tapis, en cases (plus longue sur un pont). */
export function span(b: { jump?: number }): number {
  return 1 + (b.jump ?? 0);
}

export type MachineStatus = 'idle' | 'working' | 'blocked' | 'nofuel' | 'noinput' | 'noore' | 'nopower';

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
  /** Dont du carburant (il brûle en premier, 5 fois plus longtemps). */
  carb?: number;
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
  /** Électricité (non sauvegardé) : la machine a voulu travailler, et la part de courant qu'elle reçoit (0 à 1). */
  want?: boolean;
  power?: number;
}

/** Un tapis souterrain : d'une machine (ou d'un coffre) à une autre, par un trajet sous le sol. */
export interface Tunnel {
  id: number;
  from: number;
  to: number;
  /** Cases du trajet sous terre (entre les deux machines), dans l'ordre. */
  cells: number[];
  /** Objets en route : p de 0 (départ) à la longueur du trajet (arrivée), en cases. */
  items: { t: string; p: number }[];
}

export type VehicleKind = 'camion' | 'train';

/** Un arrêt d'une ligne : un dépôt (camions) ou une gare (trains), où l'on charge ou décharge. */
export interface LineStop {
  id: number;
  load: boolean;
}

/** Un camion ou un train d'une ligne : l'arrêt où il est (ou qu'il vient de quitter), sa position sur le trajet suivant. */
export interface Vehicle {
  at: number;
  pos: number;
  moving: boolean;
  /** Temps passé à l'arrêt. */
  t: number;
  cargo: Record<string, number>;
}

/** Une ligne : 2 ou 3 arrêts parcourus en boucle, et ses véhicules. La route ou les rails sont posés en L entre deux arrêts. */
export interface Line {
  id: number;
  kind: VehicleKind;
  stops: LineStop[];
  vehicles: Vehicle[];
}

/** Un réseau électrique : les câbles reliés entre eux et les machines qui les touchent. */
export interface PowerNet {
  id: number;
  gens: Machine[];
  users: Machine[];
  /** Courant disponible et demandé (en machines), et la part servie (0 à 1). */
  supply: number;
  demand: number;
  ratio: number;
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
  /** Lignes de camions et de trains. */
  readonly lines = new Map<number, Line>();
  private nextLine = 1;
  /** Tapis souterrains (sous tout le reste). */
  readonly tunnels = new Map<number, Tunnel>();
  private nextTunnel = 1;
  /** Câbles électriques (une couche à part : ils passent sous les tapis et les machines). */
  readonly cables = new Set<number>();
  private cellMachine = new Map<number, Machine>();
  private nets: PowerNet[] = [];
  private netOfMachine = new Map<Machine, PowerNet>();
  private netOfCable = new Map<number, PowerNet>();
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
  /** Les types de machines qui peuvent marcher au courant (nœuds « électriques » de la branche Énergie). */
  private electric = new Set<string>();

  setElectric(types: Iterable<string>): void {
    const next = new Set(types);
    if (next.size === this.electric.size && [...next].every((t) => this.electric.has(t))) return;
    this.electric = next;
    this.dirty = true;
  }

  /** Ce type de machine peut marcher au courant. */
  canPower(type: string): boolean {
    return this.electric.has(type);
  }

  /** Courant demandé par la machine quand elle travaille (0 : elle ne se branche pas). */
  powerUse(m: Machine): number {
    return this.electric.has(m.type) ? 1 : 0;
  }

  /** Branchée par câble sur un réseau dont un générateur tourne : elle se passe de charbon. */
  powered(m: Machine): boolean {
    if (!this.powerUse(m)) return false;
    const n = this.netOf(m);
    return !!n && n.supply > 0;
  }
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

  // ---------- Compteurs de débit ----------

  addMeter(b: Belt): void {
    b.meter = { ev: [], since: this.clock };
  }

  /** Un objet quitte une case : son compteur le note (on garde les 20 dernières secondes). */
  private meterHit(b: Belt, k: string): void {
    const m = b.meter!;
    m.ev.push({ t: this.clock, k });
    while (m.ev.length && m.ev[0].t < this.clock - FLOW_WINDOW) m.ev.shift();
  }

  /** Débit d'un compteur, en objets par seconde, par matière (sur les 20 dernières secondes, ou depuis la pose). */
  meterRates(b: Belt): { total: number; by: Record<string, number> } {
    const m = b.meter;
    const res = { total: 0, by: {} as Record<string, number> };
    if (!m) return res;
    const span = Math.max(4, Math.min(FLOW_WINDOW, this.clock - m.since));
    for (const e of m.ev) {
      if (e.t < this.clock - FLOW_WINDOW) continue;
      res.by[e.k] = (res.by[e.k] ?? 0) + 1 / span;
      res.total += 1 / span;
    }
    return res;
  }

  /** Le pont qui passe au-dessus de cette case, s'il y en a un (split : c'est la dérivation d'un séparateur). */
  bridgeOver(x: number, y: number): { belt: Belt; split: boolean } | null {
    for (const b of this.belts.values()) {
      if (!b.jump && !b.splitJump) continue;
      const spans: [number, number, boolean][] = [];
      if (b.jump) spans.push([b.dir, b.jump, false]);
      if (b.splitJump && b.split !== undefined) spans.push([b.split, b.splitJump, true]);
      for (const [d, n, split] of spans) {
        for (let k = 1; k <= n; k++) if (b.x + DX[d] * k === x && b.y + DY[d] * k === y) return { belt: b, split };
      }
    }
    return null;
  }

  /** Retire la dérivation d'un séparateur. */
  clearSplit(b: Belt): void {
    delete b.split; delete b.splitJump;
    this.dirty = true;
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
    // Un compteur se pose sur un tapis, sans rien remplacer.
    if (def.kind === 'meter') {
      const b = this.beltAt(x, y);
      if (!b) return { ok: false, reason: 'Pose-le sur un tapis' };
      if (b.meter) return { ok: false, reason: 'Ce tapis a déjà un compteur' };
      return { ok: true };
    }
    const oreCount = new Map<string, { n: number; rate: number }>();
    let belts = 0;
    for (let j = 0; j < def.h; j++) {
      for (let i = 0; i < def.w; i++) {
        const cx = x + i, cy = y + j;
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
    for (const t of [...this.tunnels.values()]) if (t.from === m.id || t.to === m.id) this.tunnels.delete(t.id);
    for (const l of [...this.lines.values()]) if (l.stops.some((st) => st.id === m.id)) this.lines.delete(l.id);
    this.dirty = true;
  }

  addBelt(x: number, y: number, dir: Dir, inDir: Dir, built = false): Belt {
    const b: Belt = { x, y, dir, inDir, built, items: [] };
    this.belts.set(key(x, y), b);
    this.dirty = true;
    return b;
  }

  setSplit(b: Belt, dir: Dir, jump = 0): void {
    b.split = dir;
    if (jump > 0) b.splitJump = Math.min(jump, RULES.bridgeSpan); else delete b.splitJump;
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
      for (let k = 1; k <= RULES.bridgeSpan + 1; k++) {
        const nb = this.beltAt(b.x - DX[d] * k, b.y - DY[d] * k);
        if (nb && nb.split === d && 1 + (nb.splitJump ?? 0) === k) { delete nb.split; delete nb.splitJump; }
      }
    }
    this.dirty = true;
  }

  markBuilt(): void {
    this.dirty = true;
  }

  // ---------- Camions et trains ----------

  /** Le trajet entre deux arrêts : en L (d'abord à l'horizontale), d'un centre à l'autre, en cases. */
  legPath(a: Machine, b: Machine): { x: number; y: number }[] {
    // Le même L dans les deux sens (on part toujours de l'arrêt au plus petit numéro) : à l'aller comme au retour,
    // le véhicule reste sur la route dessinée.
    if (a.id > b.id) return this.legPath(b, a).reverse();
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    return [{ x: ax, y: ay }, { x: bx, y: ay }, { x: bx, y: by }];
  }

  legLength(a: Machine, b: Machine): number {
    return Math.abs(b.x + b.w / 2 - (a.x + a.w / 2)) + Math.abs(b.y + b.h / 2 - (a.y + a.h / 2));
  }

  /** Longueur totale d'une ligne (tous ses trajets, en cases). */
  lineLength(l: Line): number {
    let n = 0;
    for (let i = 0; i < l.stops.length; i++) {
      const a = this.machines.get(l.stops[i].id), b = this.machines.get(l.stops[(i + 1) % l.stops.length].id);
      if (a && b && (l.stops.length > 2 || i === 0)) n += this.legLength(a, b);
    }
    return n;
  }

  addLine(kind: VehicleKind, from: Machine, to: Machine, id?: number): Line {
    const l: Line = { id: id ?? this.nextLine++, kind, stops: [{ id: from.id, load: true }, { id: to.id, load: false }], vehicles: [] };
    this.nextLine = Math.max(this.nextLine, l.id + 1);
    this.lines.set(l.id, l);
    return l;
  }

  newVehicle(): Vehicle {
    return { at: 0, pos: 0, moving: false, t: 0, cargo: {} };
  }

  removeLine(id: number): Line | null {
    const l = this.lines.get(id);
    if (l) this.lines.delete(id);
    return l ?? null;
  }

  /** Les lignes qui passent par cet arrêt. */
  linesOf(m: Machine): Line[] {
    return [...this.lines.values()].filter((l) => l.stops.some((s) => s.id === m.id));
  }

  cargoCount(v: Vehicle): number {
    let n = 0;
    for (const k of Object.values(v.cargo)) n += k;
    return n;
  }

  /**
   * Les véhicules : à un arrêt de chargement, ils prennent tout ce que le dépôt garde (jusqu'à leur charge) ;
   * à un arrêt de déchargement, ils y vident leur cargaison ; puis ils roulent jusqu'à l'arrêt suivant (en boucle).
   */
  private tickLines(dt: number): void {
    for (const l of this.lines.values()) {
      const cap = l.kind === 'train' ? RULES.trainLoad : RULES.truckLoad;
      const speed = (l.kind === 'train' ? RULES.trainSpeed : RULES.truckSpeed);
      const n = l.stops.length;
      for (const v of l.vehicles) {
        const stop = l.stops[v.at % n];
        const here = this.machines.get(stop.id);
        const next = this.machines.get(l.stops[(v.at + 1) % n].id);
        if (!here || !next) continue;
        if (v.moving) {
          v.pos += speed * dt;
          if (v.pos >= this.legLength(here, next)) { v.at = (v.at + 1) % n; v.pos = 0; v.moving = false; v.t = 0; }
          continue;
        }
        if (!here.built) continue;
        v.t += dt;
        if (stop.load) {
          while (this.cargoCount(v) < cap && v.t >= 0.1) {
            const k = Object.keys(here.inBuf).find((x) => here.inBuf[x] > 0);
            if (!k) break;
            here.inBuf[k]--;
            if (!here.inBuf[k]) delete here.inBuf[k];
            v.cargo[k] = (v.cargo[k] ?? 0) + 1;
            v.t -= 0.1;
          }
          const c = this.cargoCount(v);
          // Il part plein, ou après un moment s'il a quelque chose ; vide, il attend.
          if (c >= cap || (c > 0 && v.t >= RULES.vehicleWait)) { v.moving = true; v.t = 0; }
          if (c === 0) v.t = Math.min(v.t, 0.1);
        } else {
          let k = Object.keys(v.cargo).find((x) => v.cargo[x] > 0 && this.storageRoom(here, x) > 0);
          while (k && v.t >= 0.1) {
            v.cargo[k]--;
            if (!v.cargo[k]) delete v.cargo[k];
            here.inBuf[k] = (here.inBuf[k] ?? 0) + 1;
            v.t -= 0.1;
            k = Object.keys(v.cargo).find((x) => v.cargo[x] > 0 && this.storageRoom(here, x) > 0);
          }
          // Vide (ou le dépôt est plein depuis un moment) : il repart.
          if (this.cargoCount(v) === 0 || (!k && v.t >= RULES.vehicleWait)) { v.moving = true; v.t = 0; }
        }
      }
    }
  }

  // ---------- Tapis souterrains ----------

  /** Longueur d'un trajet souterrain, en cases (une de plus que ses cases : on sort de la machine). */
  tunnelLength(t: Tunnel): number {
    return t.cells.length + 1;
  }

  addTunnel(from: Machine, to: Machine, cells: { x: number; y: number }[], id?: number): Tunnel {
    const t: Tunnel = { id: id ?? this.nextTunnel++, from: from.id, to: to.id, cells: cells.map((c) => key(c.x, c.y)), items: [] };
    this.nextTunnel = Math.max(this.nextTunnel, t.id + 1);
    this.tunnels.set(t.id, t);
    return t;
  }

  removeTunnel(id: number): Tunnel | null {
    const t = this.tunnels.get(id);
    if (!t) return null;
    this.tunnels.delete(id);
    return t;
  }

  /** Les tapis souterrains qui partent de cette machine ou y arrivent. */
  tunnelsOf(m: Machine): Tunnel[] {
    return [...this.tunnels.values()].filter((t) => t.from === m.id || t.to === m.id);
  }

  /** Une machine pousse ce qu'elle produit (ou ce que garde un coffre) dans ses tapis souterrains. */
  private pushTunnels(m: Machine, buf: Record<string, number>): void {
    for (const t of this.tunnels.values()) {
      if (t.from !== m.id) continue;
      const to = this.machines.get(t.to);
      if (!to || !to.built) continue;
      const rear = t.items[t.items.length - 1];
      if (rear && rear.p < RULES.beltGap) continue;
      // Ce que la machine d'arrivée accepte (en comptant ce qui est déjà en route).
      const k = Object.keys(buf).find((x) => buf[x] > 0 && this.canAccept(to, x) && t.items.filter((i) => i.t === x).length < 4);
      if (!k) continue;
      buf[k]--;
      if (buf[k] === 0 && buf === m.inBuf) delete buf[k];
      t.items.push({ t: k, p: 0 });
    }
  }

  private tickTunnels(dt: number): void {
    const speed = RULES.beltSpeed * this.speedMult * dt, gap = RULES.beltGap;
    for (const t of this.tunnels.values()) {
      const L = this.tunnelLength(t);
      const to = this.machines.get(t.to);
      for (let i = 0; i < t.items.length; i++) {
        const it = t.items[i];
        const limit = i === 0 ? L : t.items[i - 1].p - gap;
        if (it.p < limit) it.p = Math.min(it.p + speed, limit);
      }
      const first = t.items[0];
      if (first && first.p >= L && to?.built && this.canAccept(to, first.t)) {
        t.items.shift();
        this.give(to, first.t);
      }
    }
  }

  // ---------- Électricité ----------

  hasCable(x: number, y: number): boolean {
    return this.cables.has(key(x, y));
  }

  addCable(x: number, y: number): boolean {
    const k = key(x, y);
    if (this.cables.has(k)) return false;
    this.cables.add(k);
    this.dirty = true;
    return true;
  }

  removeCable(x: number, y: number): boolean {
    const ok = this.cables.delete(key(x, y));
    if (ok) this.dirty = true;
    return ok;
  }

  /** Le réseau d'une machine (null si aucun câble ne passe sous elle). */
  netOf(m: Machine): PowerNet | null {
    this.refresh();
    return this.netOfMachine.get(m) ?? null;
  }

  /** Le réseau d'une case de câble. */
  netAt(x: number, y: number): PowerNet | null {
    this.refresh();
    return this.netOfCable.get(key(x, y)) ?? null;
  }

  /** Les réseaux : câbles reliés (case à case), et les machines posées sur un câble. */
  private buildNets(): void {
    const parent = new Map<number, number>();
    const find = (k: number): number => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let c = k;
      while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
      return r;
    };
    const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    for (const k of this.cables) parent.set(k, k);
    for (const k of this.cables) {
      const [x, y] = unkey(k);
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const n = key(x + dx, y + dy);
        if (this.cables.has(n)) union(k, n);
      }
    }
    // Une machine relie les câbles qui passent sous elle (sur ses cases ; un câble collé à côté ne suffit pas).
    const touch = new Map<Machine, number[]>();
    for (const m of this.machines.values()) {
      const def = machineDef(m.type);
      if (!this.powerUse(m) && !def.supply) continue;
      const found: number[] = [];
      for (let y = m.y; y < m.y + m.h; y++) {
        for (let x = m.x; x < m.x + m.w; x++) {
          const k = key(x, y);
          if (this.cables.has(k)) found.push(k);
        }
      }
      if (!found.length) continue;
      for (const k of found) union(found[0], k);
      touch.set(m, found);
    }
    const byRoot = new Map<number, PowerNet>();
    const netFor = (k: number) => {
      const r = find(k);
      let n = byRoot.get(r);
      if (!n) { n = { id: byRoot.size + 1, gens: [], users: [], supply: 0, demand: 0, ratio: 0 }; byRoot.set(r, n); }
      return n;
    };
    this.netOfCable.clear();
    this.netOfMachine.clear();
    for (const k of this.cables) this.netOfCable.set(k, netFor(k));
    for (const [m, found] of touch) {
      const n = netFor(found[0]);
      this.netOfMachine.set(m, n);
      if (machineDef(m.type).supply) n.gens.push(m); else n.users.push(m);
    }
    this.nets = [...byRoot.values()];
  }

  /** Le courant de chaque réseau : les générateurs qui ont du charbon servent les machines qui veulent travailler. */
  private stepPower(dt: number): void {
    for (const m of this.machines.values()) m.power = 0;
    for (const n of this.nets) {
      let supply = 0, demand = 0;
      for (const g of n.gens) if (g.built && (g.fuel > 0 || g.burn > 0)) supply += machineDef(g.type).supply!;
      for (const u of n.users) if (u.built && u.want) demand += this.powerUse(u);
      const ratio = supply <= 0 ? 0 : demand <= 0 ? 1 : Math.min(1, supply / demand);
      for (const u of n.users) u.power = ratio;
      n.supply = supply; n.demand = demand; n.ratio = ratio;
      // Chaque générateur brûle selon la charge du réseau.
      const load = supply > 0 ? Math.min(1, demand / supply) : 0;
      for (const g of n.gens) this.tickGenerator(g, load, dt);
    }
    // Un générateur sans câble ne sert à rien.
    for (const m of this.machines.values()) {
      if (machineDef(m.type).kind === 'generator' && m.built && !this.netOfMachine.has(m)) m.status = m.fuel > 0 ? 'idle' : 'nofuel';
    }
  }

  private tickGenerator(g: Machine, load: number, dt: number): void {
    if (!g.built) return;
    if (load <= 0) { g.status = g.fuel > 0 || g.burn > 0 ? 'idle' : 'nofuel'; return; }
    if (g.burn <= 0) {
      const k = burnOne(g, RULES.genCoalSeconds);
      if (!k) { g.status = 'nofuel'; return; }
      this.flow(g, k, 1, false);
    }
    g.burn -= dt * load;
    g.status = 'working';
  }

  /**
   * Branchée au réseau : part du courant reçue (et on note qu'elle en veut).
   * Sans courant (pas de câble, générateur à l'arrêt) : 1 si elle a de quoi brûler.
   */
  private energy(m: Machine, def: MachineDef, dt: number): number {
    if (this.powerUse(m) && this.netOfMachine.has(m)) {
      m.want = true;
      if ((m.power ?? 0) > 0) return m.power!;
    }
    if (!def.coal) return 0;
    return this.useFuel(m, def, dt) ? 1 : 0;
  }

  /** Arrêtée faute d'énergie : branchée → « pas de courant », sinon « pas de charbon ». */
  private noEnergy(m: Machine): MachineStatus {
    return this.powerUse(m) && this.netOfMachine.has(m) && m.fuel <= 0 ? 'nopower' : 'nofuel';
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

    this.buildNets();

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
    const L = dir === b.dir ? span(b) : dir === b.split ? 1 + (b.splitJump ?? 0) : 1;
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

  /** Taille de la case carburant (10, ou 50 pour une station). */
  fuelCap(m: Machine): number {
    return machineDef(m.type).kind === 'station' ? RULES.stationCoal : RULES.fuelStack;
  }

  /** Place restante dans la case carburant. */
  fuelRoom(m: Machine): number {
    const def = machineDef(m.type);
    if (this.selfFed(m) || this.powered(m)) return 0;
    return def.coal ? Math.max(0, this.fuelCap(m) - m.fuel) : 0;
  }

  /** S'alimente elle-même (foreuse au charbon sur du charbon, raffinerie réglée sur le carburant) : personne n'a besoin de la recharger. */
  selfFed(m: Machine): boolean {
    const def = machineDef(m.type);
    if (m.type === 'raffinerie' && m.choice === 'carburant') return true;
    return m.ore === 'charbon' && def.kind === 'drill' && def.coal;
  }

  /** Ajoute du charbon dans la case carburant ; renvoie la quantité ajoutée. */
  addFuel(m: Machine, n: number, item = 'charbon'): number {
    const k = Math.max(0, Math.min(n, this.fuelRoom(m)));
    addTo(m, k, item);
    return k;
  }

  /** Prend du charbon ou du carburant dans la case carburant d'une machine (une station), en lui en laissant `keep`. */
  takeFuel(m: Machine, n: number, item: string, keep = 0): number {
    return takeOf(m, n, item, keep);
  }

  /** La machine fait clignoter son voyant : il lui faut du charbon. */
  lowFuel(m: Machine): boolean {
    return m.built && machineDef(m.type).coal && !this.selfFed(m) && !this.powered(m) && m.fuel <= RULES.lowFuel;
  }

  /** Cases occupées d'un coffre (piles de 10). */
  /** Nombre de cases d'un coffre (30 pour un grand coffre). */
  slotsOf(m: Machine): number {
    return m.type === 'grand_coffre' || m.type === 'depot' || m.type === 'gare' ? RULES.bigChestSlots : this.chestSlots;
  }

  storageSlots(m: Machine): number {
    let n = 0;
    for (const v of Object.values(m.inBuf)) n += Math.ceil(v / RULES.invStack);
    return n;
  }

  /** Place restante dans un coffre pour un type d'objet. */
  storageRoom(m: Machine, item: string): number {
    const have = m.inBuf[item] ?? 0;
    const partial = have % RULES.invStack ? RULES.invStack - (have % RULES.invStack) : 0;
    return partial + Math.max(0, this.slotsOf(m) - this.storageSlots(m)) * RULES.invStack;
  }

  /** Brûle du charbon pour travailler dt secondes ; faux s'il n'y en a plus. */
  private useFuel(m: Machine, def: MachineDef, dt: number): boolean {
    if (!def.coal) return true;
    if (m.burn <= 0) {
      const k = burnOne(m, RULES.coalMachineSeconds);
      if (!k) return false;
      this.flow(m, k, 1, false);
    }
    m.burn -= dt;
    return true;
  }

  canAccept(m: Machine, item: string): boolean {
    if (!m.built) return false;
    const def = machineDef(m.type);
    if (def.kind === 'core' || def.kind === 'lab' || def.kind === 'missions' || def.kind === 'sell') return this.buildingAccepts(m, item);
    if (def.kind === 'storage') return this.storageRoom(m, item) > 0;
    if (isFuel(item) && def.coal && m.fuel < this.fuelCap(m)) return true;
    if (def.kind !== 'crafter') return false;
    if (!this.acceptSet(def).has(item)) return false;
    return (m.inBuf[item] ?? 0) < RULES.machineBuffer;
  }

  private give(m: Machine, item: string): void {
    const def = machineDef(m.type);
    if (def.kind === 'core' || def.kind === 'lab' || def.kind === 'missions' || def.kind === 'sell') { this.onDeliver(m, item); return; }
    if (isFuel(item) && def.coal && m.fuel < this.fuelCap(m)) {
      // Le carburant d'abord ; un fourneau bien chargé garde le reste comme ingrédient.
      const asIngredient = def.recipes.some((r) => r.in[item]) && m.fuel >= 3 && (m.inBuf[item] ?? 0) < RULES.machineBuffer;
      if (!asIngredient) { addTo(m, 1, item); return; }
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
    if (def.kind !== 'crafter' || !this.acceptSet(def).has(item) || (isFuel(item) && !def.recipes.some((r) => r.in[item]))) return 0;
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
              if (b.meter) this.meterHit(b, it.t);
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
            if (b.meter) this.meterHit(b, it.t);
            this.give(nxt.machine, it.t);
          } else {
            it.p = 1;
          }
        }
      }
    }

    this.stepPower(dt);
    for (const m of this.machines.values()) {
      if (!m.built) continue;
      const def = machineDef(m.type);
      m.want = false;
      if (def.kind === 'drill') this.tickDrill(m, dt);
      else if (def.kind === 'crafter') this.tickCrafter(m, def, dt);
      if (def.kind === 'drill' || def.kind === 'crafter' || def.kind === 'storage') {
        this.pushOutputs(m, def.kind === 'storage' ? m.inBuf : m.outBuf);
        if (m.links?.length) this.pushLinks(m, def.kind === 'storage' ? m.inBuf : m.outBuf, dt);
        if (this.tunnels.size) this.pushTunnels(m, def.kind === 'storage' ? m.inBuf : m.outBuf);
      }
    }
    if (this.tunnels.size) this.tickTunnels(dt);
    if (this.lines.size) this.tickLines(dt);
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
    const def = machineDef(m.type);
    const k = this.energy(m, def, dt);
    if (k <= 0 && !this.selfFed(m)) { m.status = this.noEnergy(m); return; }
    m.status = 'working';
    m.drillT += dt * m.rate * (k > 0 ? k : 1);
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
        let k = this.energy(m, def, dt);
        // Une raffinerie à carburant démarre même à vide : elle brûlera ce qu'elle produit.
        if (k <= 0 && this.selfFed(m)) k = 1;
        if (k <= 0) { m.status = this.noEnergy(m); return; }
        m.craft.t += dt * k;
        if (m.craft.t < rec.time) { m.status = 'working'; return; }
      }
      // Le carburant qu'elle produit remplit d'abord sa propre case carburant.
      const own: Record<string, number> = {};
      if (this.selfFed(m)) {
        for (const [k, v] of Object.entries(rec.out)) {
          if (!isFuel(k)) continue;
          const put = Math.max(0, Math.min(v, this.fuelCap(m) - m.fuel));
          if (put > 0) own[k] = put;
        }
      }
      for (const [k, v] of Object.entries(rec.out)) {
        if ((m.outBuf[k] ?? 0) + v - (own[k] ?? 0) > RULES.machineBuffer) { m.status = 'blocked'; m.craft.t = rec.time; return; }
      }
      for (const [k, n] of Object.entries(own)) { addTo(m, n, k); this.flow(m, k, n, true); }
      for (const [k, v] of Object.entries(rec.out)) {
        const left = v - (own[k] ?? 0);
        if (left <= 0) continue;
        m.outBuf[k] = (m.outBuf[k] ?? 0) + left;
        this.flow(m, k, left, true);
      }
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
      cables: [...this.cables],
      cableV: 2,
      lines: [...this.lines.values()].map((l) => ({ id: l.id, kind: l.kind, stops: l.stops.map((st) => ({ ...st })), vehicles: l.vehicles.map((v) => ({ ...v, cargo: { ...v.cargo } })) })),
      tunnels: [...this.tunnels.values()].map((t) => ({ id: t.id, from: t.from, to: t.to, cells: [...t.cells], items: t.items.map((i) => [i.t, Math.round(i.p * 1000) / 1000] as [string, number]) })),
      belts: [...this.belts.values()].map((b) => [b.x, b.y, b.dir, b.inDir, b.built ? 1 : 0, b.items.map((i) => [i.t, Math.round(i.p * 1000) / 1000, i.o ?? 0]), b.split ?? -1, b.feeds?.length ? 10 + b.feeds.reduce<number>((a, d) => a | (1 << d), 0) : -1, b.jump ?? 0, b.splitJump ?? 0, b.meter ? 1 : 0]),
      machines: [...this.machines.values()].map((m) => ({
        id: m.id, type: m.type, x: m.x, y: m.y, built: m.built, inBuf: m.inBuf, outBuf: m.outBuf,
        fuel: m.fuel, carb: m.carb, burn: m.burn, craft: m.craft, drillT: m.drillT, choice: m.choice, made: m.made, links: m.links,
      })),
    };
  }

  load(s: FactorySave): void {
    this.belts.clear(); this.machines.clear(); this.cellMachine.clear(); this.cables.clear();
    for (const k of s.cables ?? []) this.cables.add(k);
    for (const [x, y, dir, inDir, built, items, split, feed, jump, splitJump, meter] of s.belts) {
      const b = this.addBelt(x, y, dir as Dir, inDir as Dir, built === 1);
      b.items = items.map(([t, p, o]) => (o ? { t, p, o: 1 as const } : { t, p }));
      if (split !== undefined && split >= 0) b.split = split as Dir;
      if (jump) b.jump = Math.min(jump, RULES.bridgeSpan);
      if (splitJump && b.split !== undefined) b.splitJump = Math.min(splitJump, RULES.bridgeSpan);
      if (meter) this.addMeter(b);
      // Liaisons de côté : 10 + masque des sens (une ancienne sauvegarde : un seul sens, de 0 à 3).
      if (feed !== undefined && feed >= 0) {
        b.feeds = feed >= 10 ? ([0, 1, 2, 3] as Dir[]).filter((d) => (feed - 10) & (1 << d)) : [feed as Dir];
      }
    }
    this.nextId = 1;
    for (const sm of s.machines) {
      // Chaque machine garde son numéro. (Avant, un numéro provisoire pouvait effacer
      // une machine déjà rechargée : elle disparaissait en laissant ses cases occupées.)
      sm.type = baseType(sm.type); // les anciennes « machines électriques » redeviennent des machines normales
      if (!MACHINES[sm.type] || this.machines.has(sm.id)) continue;
      const m = this.addMachine(sm.type, sm.x, sm.y, sm.built, sm.id);
      Object.assign(m, { inBuf: sm.inBuf, outBuf: sm.outBuf, fuel: Math.min(sm.fuel ?? 0, MACHINES[sm.type].kind === 'station' ? RULES.stationCoal : RULES.fuelStack), burn: sm.burn ?? 0, craft: sm.craft, drillT: sm.drillT, choice: sm.choice, made: sm.made ?? 0 });
      if (sm.carb) m.carb = Math.min(sm.carb, m.fuel);
      if (sm.links?.length) m.links = [...sm.links];
    }
    this.nextId = Math.max(this.nextId, s.nextId);
    // Ancienne sauvegarde : un câble collé à une machine la reliait. On le prolonge d'une case sous elle.
    if ((s.cableV ?? 1) < 2 && this.cables.size) {
      for (const m of this.machines.values()) {
        const def = machineDef(m.type);
        if (def.kind !== 'generator' && !ELECTRIC_BASES.includes(m.type)) continue;
        for (let y = m.y; y < m.y + m.h; y++) {
          for (let x = m.x; x < m.x + m.w; x++) {
            const out = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => !this.inside(m, nx, ny) && this.cables.has(key(nx, ny)));
            if (out) this.cables.add(key(x, y));
          }
        }
      }
    }
    this.lines.clear();
    this.nextLine = 1;
    for (const sl of s.lines ?? []) {
      if (!sl.stops.every((st) => this.machines.has(st.id))) continue;
      this.lines.set(sl.id, { id: sl.id, kind: sl.kind, stops: sl.stops.map((st) => ({ ...st })), vehicles: sl.vehicles.map((v) => ({ ...v, cargo: { ...v.cargo } })) });
      this.nextLine = Math.max(this.nextLine, sl.id + 1);
    }
    this.tunnels.clear();
    this.nextTunnel = 1;
    for (const st of s.tunnels ?? []) {
      if (!this.machines.has(st.from) || !this.machines.has(st.to)) continue;
      const t: Tunnel = { id: st.id, from: st.from, to: st.to, cells: [...st.cells], items: st.items.map(([t2, p]) => ({ t: t2, p })) };
      this.tunnels.set(t.id, t);
      this.nextTunnel = Math.max(this.nextTunnel, t.id + 1);
    }
    this.dirty = true;
  }
}

export interface FactorySave {
  nextId: number;
  cables?: number[];
  /** 2 : un câble ne relie une machine que s'il passe sous elle (avant, il suffisait d'y être collé). */
  cableV?: number;
  lines?: Line[];
  tunnels?: { id: number; from: number; to: number; cells: number[]; items: [string, number][] }[];
  belts: [number, number, number, number, number, [string, number, number?][], number?, number?, number?, number?, number?][];
  machines: {
    id: number; type: string; x: number; y: number; built: boolean;
    inBuf: Record<string, number>; outBuf: Record<string, number>; fuel: number; carb?: number; burn?: number;
    craft: { ri: number; t: number } | null; drillT: number; choice?: string; made?: number; links?: number[];
  }[];
}

export { opposite };
