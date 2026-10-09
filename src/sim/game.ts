// L'état complet d'une partie : monde, usine, robot, drones, argent, paliers, laboratoire et commandes.
import { CHUNK, RULES } from '../config.ts';
import { MACHINES, machineDef } from '../data/machines.ts';
import { FUELS, isFuel, item, itemLabel } from '../data/items.ts';
import { addTo, burnOne, moveFuel } from './fuel.ts';
import { World } from '../world/world.ts';
import { Factory, ROCKET_NEEDS, type Belt, type FactorySave, type Line, type Machine, type VehicleKind } from './factory.ts';
import { DX, DY, key, unkey, type Dir } from './geom.ts';
import { firstOrder, generateChoices, orderComplete, type Order } from './orders.ts';
import type { TraceCell } from './tracer.ts';
import { Inventory, type Slot } from './inventory.ts';
import { planCraft, type CraftStep } from './craft.ts';
import { RICHNESS_RATE } from '../world/world.ts';
import { ACHIEVEMENTS } from '../data/achievements.ts';
import { ALL_NODES, BASE_UNLOCKS, LAB_ITEMS, NODE, nodeForMachine, type UnlockNode } from '../data/unlocks.ts';
import { MAX_PALIER, palierMission } from '../data/paliers.ts';
import { cleanLook, DEFAULT_LOOK, type RobotLook } from '../data/look.ts';

/** Ce qu'un drone fait en premier ; ensuite il fait le reste dans l'ordre habituel. */
export type DronePriority = 'carburant' | 'chantiers' | 'noyau' | 'laboratoire' | 'comptoir';
export const DRONE_PRIORITIES: { id: DronePriority; label: string }[] = [
  { id: 'carburant', label: 'Recharger le charbon' },
  { id: 'chantiers', label: 'Construire' },
  { id: 'noyau', label: 'Livrer le Noyau' },
  { id: 'laboratoire', label: 'Livrer le Laboratoire' },
  { id: 'comptoir', label: 'Livrer le Comptoir' },
];
export const DEFAULT_ORDER: DronePriority[] = DRONE_PRIORITIES.map((p) => p.id);

/** Une liste de priorités complète et sans doublon (les tâches oubliées vont à la fin). */
export function cleanOrder(list: unknown): DronePriority[] {
  const ok = Array.isArray(list) ? list.filter((p): p is DronePriority => DEFAULT_ORDER.includes(p as DronePriority)) : [];
  const uniq = [...new Set(ok)];
  return [...uniq, ...DEFAULT_ORDER.filter((p) => !uniq.includes(p))];
}

/** Passage du gros drone de revente : il arrive, ramasse (à mi-parcours), repart. */
export interface SellPickup { id: number; t: number; x: number; y: number; done: boolean }
export const PICKUP_TIME = 6;

/** Une fabrication à la main en cours (les ingrédients sont déjà pris dans l'inventaire). */
export interface CraftJob {
  target: string;
  n: number;
  consume: Record<string, number>;
  extra: Record<string, number>;
  steps: CraftStep[];
  total: number;
  t: number;
  /** Fini, mais l'inventaire est plein. */
  blocked?: boolean;
}
export const CRAFT_QUEUE = 5;

/** Bâtiments offerts par le Noyau, dans l'ordre. */
export const GIFTS = ['comptoir', 'laboratoire'] as const;
export type GiftType = typeof GIFTS[number];

export type Job = { kind: 'belt'; k: number } | { kind: 'machine'; id: number };

/** D'où un drone prend un objet : un coffre (jamais l'inventaire du robot). */
export type Source = { kind: 'chest' | 'station'; id: number };

export type DroneTask =
  | { kind: 'build'; job: Job }
  /** Prendre un objet ; `self` : remplir sa propre case carburant. */
  | { kind: 'fetch'; from: Source; item: string; self?: boolean; max?: number }

  /** Recharger une machine en charbon. */
  | { kind: 'refuel'; id: number }
  /** Le drone va se recharger à une station de recharge (au courant, sans charbon). */
  | { kind: 'recharge'; id: number }
  /** Déposer la cargaison (minerai du robot) dans une machine ou un coffre. */
  | { kind: 'deliver'; id: number };

export interface Drone {
  x: number;
  y: number;
  /** Drone d'une station (numéro de la station) : il travaille autour d'elle, pas autour du robot. */
  station?: number;
  /** home : en vol stationnaire près du robot ; fly : en mission ; parked : posé sur le robot, sans charbon. */
  /** rest : posé sur le robot ou sur sa station, sans rien à faire (il ne brûle rien). */
  state: 'home' | 'fly' | 'work' | 'parked' | 'rest';
  task: DroneTask | null;
  t: number;
  /** Angle de rangement autour du robot. */
  slot: number;
  /** Case carburant (0 à 10) et secondes restantes du charbon en cours ; carb : dont du carburant. */
  fuel: number;
  burn: number;
  carb?: number;
  /** Une case d'inventaire. */
  cargo: Slot | null;
  /** Le coffre d'où vient la cargaison : si plus personne n'en veut, elle y retourne. */
  from?: number;

  /** Ses tâches, de la plus importante à la moins importante. */
  priorities: DronePriority[];
}

export interface Robot {
  x: number;
  y: number;
  target: { x: number; y: number } | null;
  /** Le joueur a donné l'ordre de se déplacer (prioritaire sur la construction). */
  manual: boolean;
  heading: number;
  moving: boolean;
  /** Case carburant (0 à 10) et secondes restantes du charbon en cours. */
  fuel: number;
  burn: number;
  /** Dont du carburant (brûlé en premier, 5 fois plus long). */
  carb?: number;
  /** Cinq cases d'inventaire (piles de 10). */
  inv: Inventory;
  /** Matière en cours de minage, si le robot est arrêté sur un filon. */
  mining: string | null;
  mineT: number;
  /** Nombre d'objets minés (pour l'animation). */
  mined: number;
  /** Le robot a travaillé à la dernière image (il brûle du charbon). */
  active: boolean;
}

export type GameEvent =
  | { type: 'money' }
  | { type: 'palier'; palier: number }
  | { type: 'lab' }
  | { type: 'order' }
  | { type: 'orderDone'; order: Order }
  | { type: 'deliver'; item: string; at: string }
  | { type: 'toast'; text: string; tone?: 'info' | 'warn' | 'good' }
  | { type: 'built'; job: Job }
  | { type: 'reveal' }
  | { type: 'factory' }
  | { type: 'view' }
  | { type: 'rocket'; id: number; n: number }
  | { type: 'drones' }
  | { type: 'sold'; money: number; count: number }
  | { type: 'inventory' }
  | { type: 'crafted'; item: string; n: number }
  | { type: 'gift'; building: GiftType; id: number; again?: boolean }
  | { type: 'unlock'; id: string };

/** Ce qui s'est passé pendant l'absence du joueur. */
export interface OfflineReport {
  /** Durée réelle de l'absence, en secondes. */
  away: number;
  /** Durée prise en compte (plafonnée). */
  counted: number;
  gained: Record<string, number>;
}

/** Conseils de début de partie : ceux déjà vus, et s'ils sont coupés pour cette partie. */
export interface TipState { done: string[]; off: boolean }

export interface GameSave {
  v: 1 | 2 | 3 | 4 | 5;
  seed: string;
  time: number;
  money: number;
  xp: number;
  level: number;
  robot: { x: number; y: number };
  factory: FactorySave;
  pending: Job[];
  fog: Record<string, string>;
  order: Order | null;
  choices: Order[];
  stock: Record<string, number>;
  orderSeq: number;
  rerolls: number;
  delivered: number;
  /** Nombre de drones (module de drones). Absent des premières sauvegardes. */
  drones?: number;
  /** Arbre de déblocages (depuis la version 3). */
  unlocks?: string[];
  points?: number;
  /** Paliers du Noyau et laboratoire (depuis la version 4). */
  palier?: number;
  palierDone?: Record<string, number>;
  lab?: Record<string, number>;
  extraDrones?: number;
  priorities?: DronePriority[];
  /** Apparence du robot, conseils et temps de jeu (depuis la version 5). */
  look?: RobotLook;
  tips?: TipState;
  played?: number;
  /** Statistiques de production et succès. */
  stats?: { made: Record<string, number>; used: Record<string, number> };
  achievements?: string[];
  rockets?: number;
  gifts?: Record<string, number>;
  ordersDone?: number;
  sellT?: number;
  /** Charbon et inventaires du robot et des drones (depuis la version 2). */
  crew?: {
    robot: { fuel: number; carb?: number; burn: number; inv: (Slot | null)[]; craft?: CraftJob[] };
    drones: { fuel: number; carb?: number; burn: number; cargo: Slot | null; from?: number; priority?: DronePriority; priorities?: DronePriority[] }[];
    stations?: { id: number; fuel: number; carb?: number; burn: number; cargo: Slot | null; from?: number; priorities?: DronePriority[] }[];
  };
}

/** Ce qu'on ne pose pas dans un atelier (ça vit sur la carte, avec le robot et les drones). */
const NOT_IN_ATELIER = new Set(['station', 'generateur', 'depot', 'gare', 'revente', 'foreuse', 'solaire', 'batterie', 'pompe', 'centrale', 'recharge', 'hangar']);

export class Game {
  readonly world: World;
  readonly factory: Factory;
  /** Les ateliers où l'on est entré, du plus grand au plus petit (le dernier est celui qu'on regarde). */
  private viewStack: Machine[] = [];
  /** Modules : côté de l'intérieur d'un atelier, prix d'une copie (fraction), ateliers dans les ateliers. */
  atelierSize = 20;
  copyRate = 1;
  nesting = false;

  /** L'usine qu'on regarde et où l'on construit : la carte, ou l'intérieur d'un atelier. */
  get view(): Factory {
    return this.viewStack[this.viewStack.length - 1]?.inner ?? this.factory;
  }

  /** L'atelier où l'on est (null sur la carte). */
  get inAtelier(): Machine | null {
    return this.viewStack[this.viewStack.length - 1] ?? null;
  }

  /** Les ateliers ouverts, du plus grand au plus petit. */
  get atelierPath(): Machine[] {
    return [...this.viewStack];
  }

  /** Entre dans un atelier (pour voir et modifier ce qu'il contient). */
  enterAtelier(m: Machine): boolean {
    if (!m.inner || !m.built) return false;
    this.viewStack.push(m);
    this.emit({ type: 'view' });
    return true;
  }

  /** Ressort d'un atelier (d'un cran). */
  leaveAtelier(all = false): void {
    if (!this.viewStack.length) return;
    if (all) this.viewStack = []; else this.viewStack.pop();
    this.emit({ type: 'view' });
  }

  /** Ce que vaut ce que contient une usine (machines, tapis, ateliers imbriqués), en pièces. */
  contentValue(f: Factory): number {
    let v = 0;
    for (const m of f.machines.values()) v += machineDef(m.type).cost + (m.inner ? this.contentValue(m.inner) : 0);
    for (const b of f.belts.values()) v += RULES.beltCost + (b.jump ? RULES.bridgeCost : 0) + (b.splitJump ? RULES.bridgeCost : 0);
    return v;
  }

  /** Prix d'une copie d'atelier : l'atelier, plus ce qu'il contient au taux de copie. */
  copyPrice(m: Machine): number {
    return machineDef('atelier').cost + Math.ceil((m.inner ? this.contentValue(m.inner) : 0) * this.copyRate);
  }

  /** L'intérieur d'un atelier vidé de ce qui y circule (pour une copie). */
  private blankSave(s: FactorySave): FactorySave {
    return {
      ...s,
      belts: s.belts.map((b) => { const c = [...b] as typeof b; c[5] = []; return c; }),
      machines: s.machines.map((m) => ({ ...m, inBuf: {}, outBuf: {}, fuel: 0, carb: 0, burn: 0, craft: null, made: 0, drillT: 0, ...(m.inner ? { inner: this.blankSave(m.inner) } : {}) })),
    };
  }

  /** Pose une copie d'un atelier (vide de ce qui y circule) ; le prix dépend des déblocages Copie. */
  copyAtelier(src: Machine, x: number, y: number): Machine | null {
    if (!src.inner) return null;
    const f = this.view;
    const check = f.checkMachine('atelier', x, y, undefined, true);
    if (!check.ok) { this.emit({ type: 'toast', text: check.reason ?? 'Impossible ici', tone: 'warn' }); return null; }
    if (this.inAtelier && !this.nesting) { this.emit({ type: 'toast', text: 'Imbrication : à débloquer dans l’arbre (Modules)', tone: 'warn' }); return null; }
    if (this.isAncestorOrSelf(src)) { this.emit({ type: 'toast', text: 'Un atelier ne peut pas se contenir lui-même', tone: 'warn' }); return null; }
    if (!this.spend(this.copyPrice(src))) return null;
    if (check.belts) this.earn(this.clearBeltsUnder(3, 3, x, y));
    const m = f.addMachine('atelier', x, y, false);
    f.makeInner(m, Math.max(src.size ?? this.atelierSize, this.atelierSize)).load(this.blankSave(src.inner.serialize()));
    this.finishPlacement(m);
    this.emit({ type: 'toast', text: 'Copie de l’atelier posée', tone: 'good' });
    return m;
  }

  /** Est-on à l'intérieur de cet atelier (ou de l'un de ceux qu'il contient) ? */
  private isAncestorOrSelf(m: Machine): boolean {
    return this.viewStack.includes(m);
  }

  /** Après une pose : dans un atelier, c'est construit tout de suite ; sur la carte, le robot s'en charge. */
  private finishPlacement(m: Machine): void {
    if (this.inAtelier) m.built = true;
    else this.pending.push({ kind: 'machine', id: m.id });
    this.emit({ type: 'factory' });
  }

  /**
   * Range les machines et les tapis d'une zone dans un atelier de 3 × 3, posé au milieu de la zone.
   * Les tapis qui entraient dans la zone arrivent à l'intérieur par une Entrée, ceux qui en sortaient par une Sortie.
   */
  createAtelier(x0: number, y0: number, x1: number, y1: number): Machine | null {
    const f = this.view;
    const warn = (text: string) => { this.emit({ type: 'toast', text, tone: 'warn' }); return null; };
    if (!this.hasMachine('atelier')) return warn('Modules : à débloquer dans l’arbre');
    // La zone s'agrandit pour contenir entièrement les machines qu'elle touche.
    let ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    let machines: Machine[] = [];
    for (let guard = 0; guard < 8; guard++) {
      machines = [];
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) { const m = f.machineAt(x, y); if (m && !machines.includes(m)) machines.push(m); }
      let nx0 = ax, nx1 = bx, ny0 = ay, ny1 = by;
      for (const m of machines) { nx0 = Math.min(nx0, m.x); ny0 = Math.min(ny0, m.y); nx1 = Math.max(nx1, m.x + m.w - 1); ny1 = Math.max(ny1, m.y + m.h - 1); }
      if (nx0 === ax && nx1 === bx && ny0 === ay && ny1 === by) break;
      ax = nx0; bx = nx1; ay = ny0; by = ny1;
    }
    if (!machines.length) return warn('Entoure au moins une machine');
    for (const m of machines) {
      const d = machineDef(m.type);
      if (!d.buildable || d.gift || NOT_IN_ATELIER.has(m.type) && m.type !== 'foreuse') return warn(`${d.name} : ne se range pas dans un atelier`);
      if (m.inner && !this.nesting) return warn('Imbrication : à débloquer pour ranger un atelier dans un atelier');
      if (d.kind === 'port_in' || d.kind === 'port_out') return warn('Les entrées et sorties restent dans leur atelier');
    }
    const W = bx - ax + 1, H = by - ay + 1, size = this.atelierSize;
    if (W + 2 > size || H + 2 > size) return warn(`Zone trop grande : ${size - 2} × ${size - 2} cases au plus`);
    const inSel = (x: number, y: number) => x >= ax && x <= bx && y >= ay && y <= by;
    const selected = new Set(machines);
    const belts: Belt[] = [];
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) { const b = f.beltAt(x, y); if (b) belts.push(b); }
    // La place de l'atelier : au milieu de la zone, sur des cases qui seront libres.
    const freeAfter = (x: number, y: number) => {
      if (!f.inBounds(x, y)) return false;
      if (inSel(x, y)) return true;
      return !f.machineAt(x, y) && !f.beltAt(x, y);
    };
    let spot: { x: number; y: number } | null = null;
    const cx = ax + Math.floor((W - 3) / 2), cy = ay + Math.floor((H - 3) / 2);
    for (let r = 0; r <= 4 && !spot; r++) {
      for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        let ok = true;
        for (let j = 0; j < 3 && ok; j++) for (let i = 0; i < 3 && ok; i++) ok = freeAfter(cx + dx + i, cy + dy + j);
        if (ok) spot = { x: cx + dx, y: cy + dy };
      }
    }
    if (!spot) return warn('Pas de place pour l’atelier (3 × 3) ici');
    if (!this.spend(machineDef('atelier').cost)) return null;
    // L'intérieur : la zone recentrée, avec une case de marge pour les entrées et les sorties.
    const ox = Math.floor((size - W) / 2) - ax, oy = Math.floor((size - H) / 2) - ay;
    const save = f.serialize();
    const ids = new Set(machines.map((m) => m.id));
    let nextId = save.nextId;
    const inner: FactorySave = {
      nextId,
      cables: [], lines: [], tunnels: [],
      belts: save.belts.filter(([x, y]) => inSel(x, y)).map((b) => { const c = [...b] as typeof b; c[0] = b[0] + ox; c[1] = b[1] + oy; c[4] = 1; return c; }),
      machines: save.machines.filter((m) => ids.has(m.id)).map((m) => {
        const live = f.machines.get(m.id)!;
        return { ...m, x: m.x + ox, y: m.y + oy, built: true, links: m.links?.filter((id) => ids.has(id)), ore: live.ore, rate: live.rate };
      }),
    };
    const ports = new Map<string, { type: string; id: number }>();
    const port = (type: 'entree' | 'sortie', x: number, y: number) => {
      const k = `${x},${y}`;
      let p = ports.get(k);
      if (!p) {
        p = { type, id: nextId++ };
        ports.set(k, p);
        inner.machines.push({ id: p.id, type, x: x + ox, y: y + oy, built: true, inBuf: {}, outBuf: {}, fuel: 0, burn: 0, craft: null, drillT: 0 });
      }
      return p;
    };
    const outside = (x: number, y: number) => !inSel(x, y) && (!!f.beltAt(x, y) || (!!f.machineAt(x, y) && !selected.has(f.machineAt(x, y)!)));
    for (const b of belts) {
      const px = b.x - DX[b.inDir], py = b.y - DY[b.inDir];
      if (outside(px, py)) port('entree', px, py);
      for (const [d, jump] of [[b.dir, b.jump ?? 0], [b.split, b.splitJump ?? 0], [b.split2, 0]] as [Dir | undefined, number][]) {
        if (d === undefined) continue;
        const nx = b.x + DX[d] * (1 + jump), ny = b.y + DY[d] * (1 + jump);
        if (!inSel(nx, ny) && outside(nx, ny)) {
          if (jump) { // le pont sortirait de l'intérieur : la sortie se pose juste à côté
            const ib = inner.belts.find((c) => c[0] === b.x + ox && c[1] === b.y + oy);
            if (ib) { if (d === b.dir) ib[8] = 0; else ib[9] = 0; }
            port('sortie', b.x + DX[d], b.y + DY[d]);
          } else port('sortie', nx, ny);
        }
      }
    }
    // Machines reliées directement à un tapis du dehors : une entrée ou une sortie collée, reliée à elle.
    for (const m of machines) {
      const im = inner.machines.find((x) => x.id === m.id)!;
      for (let j = -1; j <= m.h; j++) for (let i = -1; i <= m.w; i++) {
        const x = m.x + i, y = m.y + j;
        if (inSel(x, y) || f.inside(m, x, y) || ((i < 0 || i >= m.w) && (j < 0 || j >= m.h))) continue;
        const b = f.beltAt(x, y);
        if (!b) continue;
        if (f.machineAt(b.x - DX[b.inDir], b.y - DY[b.inDir]) === m || (b.feeds ?? []).some((d) => f.machineAt(b.x + DX[d], b.y + DY[d]) === m)) {
          const p = port('sortie', x, y);
          im.links = [...(im.links ?? []).filter((id) => id !== p.id), p.id];
        } else if (f.machineAt(b.x + DX[b.dir] * (1 + (b.jump ?? 0)), b.y + DY[b.dir] * (1 + (b.jump ?? 0))) === m || (b.split !== undefined && f.machineAt(b.x + DX[b.split], b.y + DY[b.split]) === m)) {
          const p = port('entree', x, y);
          const ip = inner.machines.find((q) => q.id === p.id)!;
          ip.links = [...(ip.links ?? []).filter((id) => id !== m.id), m.id];
        }
      }
    }
    inner.nextId = nextId;
    // On retire la zone de la carte (sans rembourser : tout part dans l'atelier).
    let coal = 0;
    for (const m of machines) {
      coal += m.fuel;
      for (const t of f.tunnelsOf(m)) this.earn(this.tunnelPrice(t.cells.length));
      for (const l of f.linesOf(m)) this.earn(this.linePrice(l));
      for (const o of f.machines.values()) if (o.links?.includes(m.id)) o.links = o.links.filter((id) => id !== m.id);
      f.removeMachine(m);
      this.pending = this.pending.filter((j) => !(j.kind === 'machine' && j.id === m.id));
    }
    for (const b of belts) {
      f.removeBelt(b);
      const k = key(b.x, b.y);
      this.pending = this.pending.filter((j) => !(j.kind === 'belt' && j.k === k));
    }
    const a = f.addMachine('atelier', spot.x, spot.y, true);
    f.makeInner(a, size).load(inner);
    a.fuel = Math.min(RULES.fuelStack, coal);
    this.emit({ type: 'factory' });
    this.emit({ type: 'toast', text: `Atelier créé : ${machines.length} machine${machines.length > 1 ? 's' : ''} rangée${machines.length > 1 ? 's' : ''}`, tone: 'good' });
    return a;
  }
  money = RULES.startMoney;
  /** Palier du Noyau (1 au départ) et ce qui a déjà été livré pour la mission en cours. */
  palier = 1;
  palierDone: Record<string, number> = {};
  /** Objets déposés au Laboratoire (pour débloquer l'arbre). */
  lab: Record<string, number> = {};
  robot: Robot = {
    x: 2, y: 7, target: null, manual: false, heading: 0, moving: false,
    fuel: RULES.fuelStack, burn: 0, inv: new Inventory(RULES.robotSlots, RULES.invStack),
    mining: null, mineT: 0, mined: 0, active: false,
  };
  drones: Drone[] = [];
  pending: Job[] = [];
  order: Order | null = null;
  choices: Order[] = [];
  orderSeq = 1;
  rerolls = 0;
  delivered = 0;
  time = 0;
  /** Déblocages acquis. */
  unlocks = new Set<string>(BASE_UNLOCKS);
  look: RobotLook = { ...DEFAULT_LOOK };
  tips: TipState = { done: [], off: false };
  /** Temps de jeu, en secondes. */
  played = 0;
  /** Fabrications à la main, dans l'ordre. */
  craftQueue: CraftJob[] = [];
  /** Bâtiments offerts : type → temps de jeu au moment du cadeau. */
  gifts: Record<string, number> = {};
  ordersDone = 0;
  /** Revente : temps depuis le dernier passage, et passages en cours. */
  sellT = 0;
  pickups: SellPickup[] = [];
  /** Drones gagnés avec l'ancien système de commandes (anciennes parties). */
  extraDrones = 0;
  /** Chantier en cours du robot lui-même. */
  robotJob: Job | null = null;
  robotBuilding = false;
  private robotT = 0;
  /** Pendant le calcul de la production hors ligne : objets livrés, par type. */
  private offlineGains: Record<string, number> | null = null;
  private listeners: ((e: GameEvent) => void)[] = [];
  private lastRobotCell = '';
  readonly noyau: Machine;

  constructor(seed: string, save?: GameSave) {
    this.world = new World(seed);
    this.factory = new Factory(this.world);
    this.factory.onDeliver = (m, item) => this.receive(m, item, 1);
    this.factory.onRocket = (m) => { this.rockets++; this.emit({ type: 'rocket', id: m.id, n: this.rockets }); };
    this.factory.buildingAccepts = (m, item) => this.accepts(m, item) > 0;
    if (save) {
      this.load(save);
      this.noyau = [...this.factory.machines.values()].find((m) => m.type === 'noyau') ?? this.factory.addMachine('noyau', 0, 0, true);
    } else {
      this.world.reveal(2, 2, RULES.revealStart);
      this.noyau = this.factory.addMachine('noyau', 0, 0, true);
      this.order = firstOrder(this.orderSeq++);
      this.applyUnlocks();
      this.rebuildDrones();
      // Cadeau de départ : 10 charbons dans le premier drone, pour lancer la première foreuse.
      if (this.drones[0]) this.drones[0].cargo = { t: 'charbon', n: RULES.giftCoal };
    }
    this.revealRobot(true);
  }

  /** Nombre de drones : un au départ, plus ceux débloqués dans l'arbre. */
  get droneCount(): number {
    const fromTree = [...this.unlocks].filter((id) => NODE[id]?.effect.kind === 'drone').length;
    return Math.min(RULES.maxDrones + this.extraDrones, RULES.startDrones + fromTree + this.extraDrones);
  }

  private rebuildDrones(): void {
    const n = this.droneCount;
    while (this.drones.length < n) {
      this.drones.push({ x: this.robot.x, y: this.robot.y - 1, state: 'home', task: null, t: 0, slot: 0, fuel: RULES.fuelStack, burn: 0, cargo: null, priorities: [...DEFAULT_ORDER] });
    }
    this.drones.length = n;
    this.drones.forEach((d, i) => { d.slot = (i / Math.max(n, 1)) * Math.PI * 2; });
  }

  on(fn: (e: GameEvent) => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((f) => f !== fn); };
  }

  emit(e: GameEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  // ---------- Argent ----------

  spend(n: number): boolean {
    if (this.money < n) {
      this.emit({ type: 'toast', text: 'Pas assez de pièces', tone: 'warn' });
      return false;
    }
    this.money -= n;
    this.emit({ type: 'money' });
    return true;
  }

  earn(n: number): void {
    this.money += n;
    this.emit({ type: 'money' });
  }

  // ---------- Bâtiments qui reçoivent : Noyau, Laboratoire, Comptoir ----------

  /** Ce qu'il manque encore pour la mission du Noyau. */
  noyauNeeds(): Record<string, number> {
    const mission = palierMission(this.palier);
    const out: Record<string, number> = {};
    if (!mission) return out;
    for (const [k, v] of Object.entries(mission.lines)) {
      const left = v - (this.palierDone[k] ?? 0);
      if (left > 0) out[k] = left;
    }
    return out;
  }

  /** Ce qu'il manque au Laboratoire pour les déblocages ouverts (le plus gros besoin par objet). */
  /** Les nœuds pas encore débloqués qu'on peut débloquer à ce palier, directement ou après leurs parents. */
  reachableNodes(): UnlockNode[] {
    const ok = new Set<string>(this.unlocks);
    const out: UnlockNode[] = [];
    for (let changed = true; changed;) {
      changed = false;
      for (const x of ALL_NODES) {
        if (ok.has(x.id) || x.effect.kind === 'soon' || x.palier > this.palier) continue;
        if (!x.parents.every((p) => ok.has(p))) continue;
        ok.add(x.id); out.push(x); changed = true;
      }
    }
    return out;
  }

  labNeeds(): Record<string, number> {
    // Tout ce qu'il faut pour débloquer chaque nœud possible à ce palier (y compris ceux qui s'ouvriront
    // une fois leurs parents débloqués) : les coûts s'additionnent quand deux nœuds demandent le même objet.
    const want: Record<string, number> = {};
    for (const x of this.reachableNodes()) {
      for (const [k, v] of Object.entries(x.cost)) want[k] = (want[k] ?? 0) + v;
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(want)) {
      const left = v - (this.lab[k] ?? 0);
      if (left > 0) out[k] = left;
    }
    return out;
  }

  /** Ce qu'il manque pour la commande du Comptoir. */
  comptoirNeeds(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const l of this.order?.lines ?? []) if (l.done < l.qty) out[l.item] = l.qty - l.done;
    return out;
  }

  /** Combien d'objets ce bâtiment accepte encore. */
  accepts(m: Machine, item: string): number {
    if (m.type === 'noyau') return this.noyauNeeds()[item] ?? 0;
    if (m.type === 'comptoir') return this.comptoirNeeds()[item] ?? 0;
    if (m.type === 'laboratoire') return LAB_ITEMS.has(item) ? Math.max(0, RULES.labCap - (this.lab[item] ?? 0), this.labNeeds()[item] ?? 0) : 0;
    if (m.type === 'revente') return m.built && !this.pickups.some((p) => p.id === m.id && !p.done) ? Math.max(0, RULES.sellCap - this.sellCount(m)) : 0;
    return 0;
  }

  /** Un bâtiment reçoit des objets (par tapis ou par drone). Renvoie le nombre accepté. */
  receive(m: Machine, item: string, n: number): number {
    const k = Math.min(n, this.accepts(m, item));
    if (k <= 0) return 0;
    if (m.type === 'revente') {
      m.inBuf[item] = (m.inBuf[item] ?? 0) + k;
      return k;
    }
    if (this.offlineGains) this.offlineGains[item] = (this.offlineGains[item] ?? 0) + k;
    this.delivered += k;
    if (m.type === 'noyau') {
      this.palierDone[item] = (this.palierDone[item] ?? 0) + k;
      this.emit({ type: 'order' });
      if (!this.offlineGains) this.checkPalier();
    } else if (m.type === 'laboratoire') {
      this.lab[item] = (this.lab[item] ?? 0) + k;
      this.emit({ type: 'lab' });
    } else if (m.type === 'comptoir') {
      for (const l of this.order?.lines ?? []) {
        if (l.item !== item) continue;
        const add = Math.min(k, l.qty - l.done);
        l.done += add;
      }
      this.emit({ type: 'order' });
      if (!this.offlineGains && this.order && orderComplete(this.order)) this.completeOrder();
    }
    this.emit({ type: 'deliver', item, at: m.type });
    return k;
  }

  /** Passe au palier suivant quand la mission du Noyau est terminée. */
  private checkPalier(): void {
    const mission = palierMission(this.palier);
    if (!mission || Object.keys(this.noyauNeeds()).length > 0) return;
    this.palier = mission.to;
    this.palierDone = {};
    this.emit({ type: 'palier', palier: this.palier });
  }

  /** Avancement de la mission du Noyau, de 0 à 1 (1 au dernier palier). */
  palierProgress(): number {
    const mission = palierMission(this.palier);
    if (!mission) return 1;
    let done = 0, total = 0;
    for (const [k, v] of Object.entries(mission.lines)) {
      total += v;
      done += Math.min(v, this.palierDone[k] ?? 0);
    }
    return total ? done / total : 1;
  }

  // ---------- Revente : le gros drone passe toutes les 5 minutes ----------

  sellCount(m: Machine): number {
    let n = 0;
    for (const v of Object.values(m.inBuf)) n += v;
    return n;
  }

  /** Ce que rapporterait le contenu d'une benne de revente. */
  sellValue(m: Machine): number {
    let v = 0;
    for (const [k, n] of Object.entries(m.inBuf)) v += item(k).value * n;
    return Math.floor(v * RULES.sellRate);
  }

  /** Secondes avant le prochain passage du gros drone. */
  get nextPickup(): number {
    return Math.max(0, RULES.sellEvery - this.sellT);
  }

  /** Vide une benne et paie son contenu. */
  private sell(m: Machine): number {
    const money = this.sellValue(m);
    const n = this.sellCount(m);
    m.inBuf = {};
    if (money > 0) this.earn(money);
    if (n > 0) this.emit({ type: 'sold', money, count: n });
    return money;
  }

  private tickSell(dt: number): void {
    this.sellT += dt;
    if (this.sellT >= RULES.sellEvery) {
      this.sellT -= RULES.sellEvery;
      for (const m of this.factory.machines.values()) {
        if (m.type === 'revente' && m.built && this.sellCount(m) > 0) this.pickups.push({ id: m.id, t: 0, x: m.x + m.w / 2, y: m.y + m.h / 2, done: false });
      }
    }
    for (const p of this.pickups) {
      const before = p.t;
      p.t += dt;
      if (before < PICKUP_TIME / 2 && p.t >= PICKUP_TIME / 2) {
        const m = this.factory.machines.get(p.id);
        if (m) this.sell(m);
        p.done = true;
      }
    }
    this.pickups = this.pickups.filter((p) => p.t < PICKUP_TIME);
  }

  get finalPalier(): boolean {
    return this.palier >= MAX_PALIER;
  }

  // ---------- Comptoir : commandes au choix, payées en pièces ----------

  private completeOrder(): void {
    const o = this.order!;
    this.order = null;
    this.ordersDone++;
    this.earn(o.money);
    this.emit({ type: 'orderDone', order: o });
    this.refreshChoices();
  }

  refreshChoices(): void {
    const seed = this.world.seedNum ^ (this.orderSeq * 7919) ^ (this.rerolls * 104729);
    const discovered = new Set([...this.world.discovered]);
    this.choices = generateChoices(seed >>> 0, this.palier, discovered, this.orderSeq, false, (id) => this.hasMachine(id));
    this.orderSeq += 3;
    this.emit({ type: 'order' });
  }

  rerollCost(): number {
    return RULES.rerollBase * this.palier;
  }

  reroll(): void {
    if (!this.spend(this.rerollCost())) return;
    this.rerolls++;
    this.refreshChoices();
  }

  /** Abandonne la commande en cours : ce qui a déjà été livré est perdu, trois nouveaux choix arrivent. */
  abandonOrder(): boolean {
    if (!this.order) return false;
    this.order = null;
    this.refreshChoices();
    return true;
  }

  acceptOrder(o: Order): void {
    this.order = o;
    this.choices = [];
    this.emit({ type: 'order' });
  }

  // ---------- Arbre de déblocages ----------

  isUnlocked(id: string): boolean {
    return this.unlocks.has(id);
  }

  /** Une machine est-elle débloquée ? (Celles hors de l'arbre le sont toujours.) */
  hasMachine(id: string): boolean {
    const node = nodeForMachine(id);
    return !node || this.unlocks.has(node.id);
  }

  /** État d'un nœud : acquis, disponible, verrouillé (parent ou palier), ou prévu plus tard. */
  nodeState(node: UnlockNode): 'owned' | 'available' | 'locked' | 'soon' {
    if (this.unlocks.has(node.id)) return 'owned';
    const parentsOk = node.parents.every((p) => this.unlocks.has(p));
    if (!parentsOk || node.palier > this.palier) return 'locked';
    return node.effect.kind === 'soon' ? 'soon' : 'available';
  }

  /** Le Laboratoire a-t-il tout ce qu'il faut pour ce nœud ? */
  canAfford(node: UnlockNode): boolean {
    return Object.entries(node.cost).every(([k, v]) => (this.lab[k] ?? 0) >= v);
  }

  hasLab(): boolean {
    for (const m of this.factory.machines.values()) if (m.type === 'laboratoire' && m.built) return true;
    return false;
  }

  unlock(id: string): boolean {
    const node = NODE[id];
    if (!node || this.nodeState(node) !== 'available' || !this.canAfford(node)) return false;
    for (const [k, v] of Object.entries(node.cost)) this.lab[k] -= v;
    this.unlocks.add(id);
    this.applyUnlocks();
    this.emit({ type: 'unlock', id });
    this.emit({ type: 'lab' });
    return true;
  }

  /** Nombre de nœuds qu'on pourrait débloquer tout de suite. */
  unlockableCount(): number {
    return ALL_NODES.filter((x) => this.nodeState(x) === 'available' && this.canAfford(x)).length;
  }

  /** Chenilles et antennes : vitesse du robot et portée de ses drones (le meilleur niveau débloqué). */
  robotSpeedMult = 1;
  droneRangeMult = 1;

  private applyUnlocks(): void {
    let speed = 1, slots = RULES.chestSlots, copy = 1, size = 20, nest = false;
    this.robotSpeedMult = 1;
    this.droneRangeMult = 1;
    for (const id of this.unlocks) {
      const e = NODE[id]?.effect;
      if (e?.kind === 'robotSpeed') this.robotSpeedMult = Math.max(this.robotSpeedMult, e.mult);
      if (e?.kind === 'droneRange') this.droneRangeMult = Math.max(this.droneRangeMult, e.mult);
      if (e?.kind === 'beltSpeed') speed = Math.max(speed, e.mult);
      if (e?.kind === 'chestSlots') slots = Math.max(slots, e.slots);
      if (e?.kind === 'copyRate') copy = Math.min(copy, e.rate);
      if (e?.kind === 'atelierSize') size = Math.max(size, e.size);
      if (e?.kind === 'nesting') nest = true;
    }
    this.copyRate = copy;
    this.nesting = nest;
    if (size !== this.atelierSize) {
      this.atelierSize = size;
      // Les ateliers déjà posés s'agrandissent aussi.
      const grow = (f: Factory) => { for (const m of f.machines.values()) if (m.inner) { m.size = Math.max(m.size ?? 20, size); m.inner.bounds = m.size; grow(m.inner); } };
      grow(this.factory);
    }
    this.factory.speedMult = speed;
    this.factory.chestSlots = slots;
    this.factory.setElectric([...this.unlocks].flatMap((id) => { const e = NODE[id]?.effect; return e?.kind === 'electric' ? [e.id] : []; }));
    if (this.drones.length !== this.droneCount && this.drones.length > 0) {
      this.rebuildDrones();
      this.emit({ type: 'drones' });
    }
  }

  // ---------- Absence ----------

  /**
   * L'usine a continué de tourner pendant l'absence, au ralenti (10 %) et sur 8 h au plus.
   * On rejoue la simulation de l'usine en accéléré. Les livraisons comptent, mais les paliers
   * et les commandes ne se valident qu'au retour.
   */
  catchUp(awayMs: number, budgetMs = 2500): OfflineReport | null {
    const away = awayMs / 1000;
    if (!(away >= 60)) return null;
    const counted = Math.min(away, RULES.offlineMaxSeconds);
    const target = counted * RULES.offlineRate;
    const step = 0.2;
    const start = Date.now();
    const gained: Record<string, number> = {};
    this.offlineGains = gained;
    try {
      for (let t = 0; t < target; t += step) {
        this.factory.tick(step);
        if (Date.now() - start > budgetMs) break;
      }
    } finally {
      this.offlineGains = null;
    }
    this.checkPalier();
    if (this.order && orderComplete(this.order)) this.completeOrder();
    // Le gros drone est passé pendant l'absence : les bennes de revente sont vidées.
    for (const m of this.factory.machines.values()) if (m.type === 'revente' && m.built) this.sell(m);
    this.emit({ type: 'order' });
    return { away, counted, gained };
  }

  // ---------- Construction ----------

  placeMachine(type: string, x: number, y: number): Machine | null {
    const def = machineDef(type);
    if (def.kind === 'meter') { this.placeMeter(x, y); return null; }
    if (def.gift) {
      this.emit({ type: 'toast', text: `${def.name} : le Noyau te l’offre bientôt`, tone: 'info' });
      return null;
    }
    if (!this.hasMachine(type)) {
      this.emit({ type: 'toast', text: `${def.name} : à débloquer dans l’arbre`, tone: 'warn' });
      return null;
    }
    if (this.inAtelier && (NOT_IN_ATELIER.has(type) || (def.kind === 'atelier' && !this.nesting))) {
      this.emit({ type: 'toast', text: def.kind === 'atelier' ? 'Imbrication : à débloquer dans l’arbre (Modules)' : `${def.name} : pas dans un atelier`, tone: 'warn' });
      return null;
    }
    if (!this.inAtelier && (def.kind === 'port_in' || def.kind === 'port_out')) {
      this.emit({ type: 'toast', text: `${def.name} : se pose à l’intérieur d’un atelier`, tone: 'warn' });
      return null;
    }
    if (def.unique && [...this.factory.machines.values()].some((m) => m.type === type)) {
      this.emit({ type: 'toast', text: `Un seul ${def.name.toLowerCase()} par partie`, tone: 'warn' });
      return null;
    }
    const check = this.view.checkMachine(type, x, y, undefined, true);
    if (!check.ok) {
      this.emit({ type: 'toast', text: check.reason ?? 'Impossible ici', tone: 'warn' });
      return null;
    }
    if (!this.spend(def.cost)) return null;
    // Posée sur un tapis : les cases de tapis dessous disparaissent (remboursées). Le tapis qui arrive
    // devient l'entrée de la machine, celui qui repart devient sa sortie.
    if (check.belts) this.earn(this.clearBeltsUnder(def.w, def.h, x, y));
    const m = this.view.addMachine(type, x, y, false);
    if (def.kind === 'atelier') this.view.makeInner(m, this.atelierSize);
    this.finishPlacement(m);
    return m;
  }

  placeBelts(cells: TraceCell[], split?: { from: Belt; dir: Dir; jump?: number }): boolean {
    const fresh = cells.filter((c) => !c.existing);
    const bridges = cells.filter((c) => c.jump).length + (split?.jump ? 1 : 0);
    const cost = fresh.length * RULES.beltCost + bridges * RULES.bridgeCost;
    // Rien de neuf : seulement le bout d'un tapis qui se tourne (vers une machine collée, par exemple).
    const turns = cells.some((c) => c.existing && this.view.beltAt(c.x, c.y)?.dir !== c.dir);
    if (fresh.length === 0 && !turns) return false;
    if (split && !this.isUnlocked('separateur')) {
      this.emit({ type: 'toast', text: 'Séparateur : à débloquer dans l’arbre (Logistique)', tone: 'warn' });
      return false;
    }
    if (bridges && !this.isUnlocked('pont')) {
      this.emit({ type: 'toast', text: 'Ponts : à débloquer dans l’arbre (Logistique)', tone: 'warn' });
      return false;
    }
    if (!this.spend(cost)) return false;
    if (split) this.view.setSplit(split.from, split.dir, split.jump ?? 0);
    for (const c of cells) {
      if (c.existing) {
        const b = this.view.beltAt(c.x, c.y);
        if (b) {
          this.view.setBeltDir(b, c.dir);
          // Le bout d'un tapis existant peut devenir un pont (vers un tapis voisin à enjamber).
          if (c.jump) b.jump = Math.min(c.jump, RULES.bridgeSpan);
        }
      } else {
        const nb = this.view.addBelt(c.x, c.y, c.dir, c.inDir, !!this.inAtelier);
        if (c.jump) nb.jump = Math.min(c.jump, RULES.bridgeSpan);
        if (!this.inAtelier) this.pending.push({ kind: 'belt', k: key(c.x, c.y) });
      }
    }
    this.emit({ type: 'factory' });
    return true;
  }

  private refundBelt(b: Belt): number {
    this.view.removeBelt(b);
    const k = key(b.x, b.y);
    this.pending = this.pending.filter((j) => !(j.kind === 'belt' && j.k === k));
    return RULES.beltCost + (b.jump ? RULES.bridgeCost : 0) + (b.splitJump ? RULES.bridgeCost : 0);
  }

  /** Supprime ce qui se trouve sur une case. Renvoie vrai si quelque chose a été supprimé. */
  /** Pose un compteur de débit sur un tapis (tout de suite). */
  placeMeter(x: number, y: number): boolean {
    const check = this.view.checkMachine('compteur', x, y);
    if (!check.ok) { this.emit({ type: 'toast', text: check.reason ?? 'Impossible ici', tone: 'warn' }); return false; }
    if (!this.spend(MACHINES.compteur.cost)) return false;
    this.view.addMeter(this.view.beltAt(x, y)!);
    this.emit({ type: 'factory' });
    return true;
  }

  /** Ce que contient un rectangle de cases (bornes incluses) : machines (sauf Noyau et cadeaux), tapis, câbles. */
  areaContents(x0: number, y0: number, x1: number, y1: number): { machines: Machine[]; belts: Belt[]; cables: { x: number; y: number }[] } {
    const f = this.view;
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const machines = new Set<Machine>(), belts: Belt[] = [], cables: { x: number; y: number }[] = [];
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        const m = f.machineAt(x, y);
        if (m) { const d = machineDef(m.type); if (d.buildable && !d.gift) machines.add(m); }
        const b = f.beltAt(x, y);
        if (b) belts.push(b);
        if (f.hasCable(x, y)) cables.push({ x, y });
      }
    }
    return { machines: [...machines], belts, cables };
  }

  /** Gomme en zone : tout ce qui est dans le rectangle part (remboursé). Renvoie le nombre d'éléments supprimés. */
  removeArea(x0: number, y0: number, x1: number, y1: number): number {
    const { machines, belts, cables } = this.areaContents(x0, y0, x1, y1);
    let n = 0;
    for (const b of belts) {
      if (b.meter) this.earn(MACHINES.compteur.cost);
      this.earn(this.refundBelt(b));
      n++;
    }
    for (const m of machines) if (this.view.machines.has(m.id) && this.removeMachine(m)) n++;
    for (const c of cables) if (this.view.removeCable(c.x, c.y)) { this.earn(RULES.cableCost); n++; }
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (this.view.removePipe(x, y)) { this.earn(RULES.pipeCost); n++; }
    if (n) this.emit({ type: 'factory' });
    return n;
  }

  removeAt(x: number, y: number): boolean {
    // Un pont passe au-dessus : on retire d'abord le pont, le tapis du dessous reste.
    const over = this.view.bridgeOver(x, y);
    if (over) {
      if (over.split) {
        this.view.clearSplit(over.belt);
        this.earn(RULES.bridgeCost);
      } else {
        this.earn(this.refundBelt(over.belt));
      }
      this.emit({ type: 'factory' });
      return true;
    }
    const b = this.view.beltAt(x, y);
    // Un compteur sur le tapis : il part d'abord (remboursé), le tapis au coup suivant.
    if (b?.meter) {
      delete b.meter;
      this.earn(MACHINES.compteur.cost);
      this.emit({ type: 'factory' });
      return true;
    }
    if (b) {
      this.earn(this.refundBelt(b));
      this.emit({ type: 'factory' });
      return true;
    }
    const m = this.view.machineAt(x, y);
    if (m) return this.removeMachine(m);
    // Le câble et le tuyau en dernier (ils passent sous le reste).
    if (this.view.removeCable(x, y)) {
      this.earn(RULES.cableCost);
      this.emit({ type: 'factory' });
      return true;
    }
    if (this.view.removePipe(x, y)) {
      this.earn(RULES.pipeCost);
      this.emit({ type: 'factory' });
      return true;
    }
    return false;
  }

  /** Le véhicule d'un arrêt : camion pour un dépôt, train pour une gare. */
  stationKind(m: Machine): VehicleKind | null {
    return m.type === 'depot' ? 'camion' : m.type === 'gare' ? 'train' : null;
  }

  /** Prix des véhicules et de la route (ou des rails), à la case. */
  vehiclePrice(kind: VehicleKind): number {
    return kind === 'train' ? RULES.trainCost : RULES.truckCost;
  }

  trackPrice(kind: VehicleKind, cells: number): number {
    return Math.ceil(cells) * (kind === 'train' ? RULES.railCost : RULES.roadCost);
  }

  /** Ce que rendrait une ligne : sa route et ses véhicules. */
  linePrice(l: Line): number {
    return this.trackPrice(l.kind, this.factory.lineLength(l)) + l.vehicles.length * this.vehiclePrice(l.kind);
  }

  /** Relie deux dépôts (ou deux gares) : la route est posée, un premier véhicule part du premier. */
  linkStations(from: Machine, to: Machine): Line | null {
    const kind = this.stationKind(from);
    if (!kind || from === to || this.stationKind(to) !== kind) {
      this.emit({ type: 'toast', text: kind === 'train' ? 'Une gare se relie à une autre gare' : 'Un dépôt se relie à un autre dépôt', tone: 'warn' });
      return null;
    }
    const price = this.trackPrice(kind, this.factory.legLength(from, to)) + this.vehiclePrice(kind);
    if (!this.spend(price)) return null;
    const l = this.factory.addLine(kind, from, to);
    l.vehicles.push(this.factory.newVehicle());
    this.emit({ type: 'factory' });
    this.emit({ type: 'toast', text: `${kind === 'train' ? 'Train' : 'Camion'} : la ligne est ouverte`, tone: 'good' });
    return l;
  }

  /** Prix d'un troisième arrêt : la route en plus. */
  stopPrice(l: Line, m: Machine): number {
    const before = this.factory.lineLength(l);
    const after = this.factory.lineLength({ ...l, stops: [...l.stops, { id: m.id, load: false }] });
    return this.trackPrice(l.kind, Math.max(0, after - before));
  }

  /** Ajoute un arrêt à une ligne (3 au plus). */
  addStop(lineId: number, m: Machine): boolean {
    const l = this.factory.lines.get(lineId);
    if (!l || l.stops.length >= 3 || this.stationKind(m) !== l.kind || l.stops.some((st) => st.id === m.id)) return false;
    if (!this.spend(this.stopPrice(l, m))) return false;
    l.stops.push({ id: m.id, load: false });
    this.emit({ type: 'factory' });
    return true;
  }

  /** Ajoute un véhicule sur la ligne (6 au plus) : il part du premier arrêt. */
  addVehicle(lineId: number): boolean {
    const l = this.factory.lines.get(lineId);
    if (!l || l.vehicles.length >= RULES.maxVehicles) return false;
    if (!this.spend(this.vehiclePrice(l.kind))) return false;
    l.vehicles.push(this.factory.newVehicle());
    this.emit({ type: 'factory' });
    return true;
  }

  /** Retire un véhicule (il en reste au moins un ; remboursé, sa cargaison est perdue). */
  removeVehicle(lineId: number): boolean {
    const l = this.factory.lines.get(lineId);
    if (!l || l.vehicles.length <= 1) return false;
    l.vehicles.pop();
    this.earn(this.vehiclePrice(l.kind));
    this.emit({ type: 'factory' });
    return true;
  }

  /** Un arrêt charge (on y remplit le véhicule) ou décharge (il y vide sa cargaison). */
  setStopLoad(lineId: number, i: number, load: boolean): void {
    const st = this.factory.lines.get(lineId)?.stops[i];
    if (!st) return;
    st.load = load;
    this.emit({ type: 'factory' });
  }

  /** Ferme une ligne (route et véhicules remboursés). */
  removeLine(id: number): void {
    const l = this.factory.lines.get(id);
    if (!l) return;
    this.earn(this.linePrice(l));
    this.factory.removeLine(id);
    this.emit({ type: 'factory' });
  }

  /** Prix d'un tapis souterrain : par case de trajet. */
  tunnelPrice(cells: number): number {
    return (cells + 1) * RULES.tunnelCost;
  }

  /** Une machine peut-elle envoyer quelque chose sous terre (coffre, foreuse, machine qui fabrique) ? */
  canSendUnder(m: Machine): boolean {
    const k = machineDef(m.type).kind;
    return k === 'storage' || k === 'crafter' || k === 'drill';
  }

  /** Relie deux machines par un tapis souterrain (posé tout de suite). */
  placeTunnel(from: Machine, to: Machine, cells: { x: number; y: number }[]): boolean {
    if (!this.isUnlocked('souterrain')) {
      this.emit({ type: 'toast', text: 'Tapis souterrains : à débloquer dans l’arbre (Logistique, palier 5)', tone: 'warn' });
      return false;
    }
    if (from === to || !this.canSendUnder(from)) return false;
    if (this.factory.tunnelsOf(from).some((t) => t.from === from.id && t.to === to.id)) {
      this.emit({ type: 'toast', text: 'Ces deux-là sont déjà reliés sous terre', tone: 'info' });
      return false;
    }
    if (!this.spend(this.tunnelPrice(cells.length))) return false;
    this.factory.addTunnel(from, to, cells);
    this.emit({ type: 'factory' });
    this.emit({ type: 'toast', text: `${machineDef(from.type).name} → ${machineDef(to.type).name.toLowerCase()} : relié sous terre`, tone: 'good' });
    return true;
  }

  /** Retire un tapis souterrain (remboursé ; ce qui était en route est perdu). */
  removeTunnel(id: number): void {
    const t = this.factory.removeTunnel(id);
    if (!t) return;
    this.earn(this.tunnelPrice(t.cells.length));
    this.emit({ type: 'factory' });
  }

  /** Pose des câbles (tout de suite, sans chantier) sur les cases révélées ; les cases déjà câblées sont gratuites. */
  placeCables(cells: { x: number; y: number }[]): boolean {
    if (!this.isUnlocked('generateur')) {
      this.emit({ type: 'toast', text: 'Câbles : débloque le Générateur dans l’arbre (Énergie)', tone: 'warn' });
      return false;
    }
    const fresh = cells.filter((c) => !this.factory.hasCable(c.x, c.y));
    if (!fresh.length) return false;
    if (!this.spend(fresh.length * RULES.cableCost)) return false;
    for (const c of fresh) this.factory.addCable(c.x, c.y);
    this.emit({ type: 'factory' });
    return true;
  }

  /** Tuyaux d'eau : comme les câbles (3 pièces la case), ils relient les pompes aux machines qu'ils touchent. */
  placePipes(cells: { x: number; y: number }[]): boolean {
    if (!this.isUnlocked('pompe')) {
      this.emit({ type: 'toast', text: 'Tuyaux : débloque la Pompe à eau dans l’arbre (Énergie)', tone: 'warn' });
      return false;
    }
    const fresh = cells.filter((c) => !this.factory.hasPipe(c.x, c.y));
    if (!fresh.length) return false;
    if (!this.spend(fresh.length * RULES.pipeCost)) return false;
    for (const c of fresh) this.factory.addPipe(c.x, c.y);
    this.emit({ type: 'factory' });
    return true;
  }

  removeMachine(m: Machine): boolean {
    const def = machineDef(m.type);
    if (!def.buildable) {
      this.emit({ type: 'toast', text: 'Le Noyau reste en place', tone: 'warn' });
      return false;
    }
    if (def.gift) {
      this.emit({ type: 'toast', text: `${def.name} : un cadeau du Noyau. On peut le déplacer, pas le supprimer.`, tone: 'info' });
      return false;
    }
    // Ses tapis souterrains partent avec elle (remboursés).
    for (const t of this.view.tunnelsOf(m)) this.earn(this.tunnelPrice(t.cells.length));
    for (const l of this.view.linesOf(m)) this.earn(this.linePrice(l));
    this.view.removeMachine(m);
    this.pending = this.pending.filter((j) => !(j.kind === 'machine' && j.id === m.id));
    // Un atelier rend aussi ce qu'il contient (ce qui y circulait est perdu).
    this.earn(def.cost + (m.inner ? this.contentValue(m.inner) : 0));
    this.emit({ type: 'factory' });
    return true;
  }

  removeChain(b: Belt): void {
    let refund = 0;
    for (const c of this.view.chainOf(b)) refund += this.refundBelt(c);
    this.earn(refund);
    this.emit({ type: 'factory' });
  }

  /**
   * Scanner du robot : les filons de cette matière les plus proches, même sous le brouillard
   * (jusqu'à 8 chunks autour du robot). Distance au bord du filon, en cases.
   */
  scan(type: string, n = 3, reach = 8): { x: number; y: number; r: number; d: number }[] {
    const r = this.robot;
    const ccx = Math.floor(r.x / CHUNK), ccy = Math.floor(r.y / CHUNK);
    const found: { x: number; y: number; r: number; d: number }[] = [];
    for (let j = -reach; j <= reach; j++) {
      for (let i = -reach; i <= reach; i++) {
        for (const p of this.world.patchesInChunk(ccx + i, ccy + j)) {
          if (p.type !== type) continue;
          found.push({ x: p.cx, y: p.cy, r: p.r, d: Math.max(0, Math.hypot(p.cx - r.x, p.cy - r.y) - p.r) });
        }
      }
    }
    return found.sort((a, b) => a.d - b.d).slice(0, n);
  }

  /** Relie deux machines collées : la production de la première passe directement dans la seconde. */
  linkMachines(from: Machine, to: Machine): boolean {
    if (from === to || !this.view.touching(from, to)) return false;
    if (!from.links?.includes(to.id)) from.links = [...(from.links ?? []), to.id];
    this.view.markBuilt();
    this.emit({ type: 'factory' });
    this.emit({ type: 'toast', text: `${machineDef(from.type).name} → ${machineDef(to.type).name.toLowerCase()} : reliés`, tone: 'good' });
    return true;
  }

  unlinkMachines(from: Machine, to?: number): void {
    from.links = to === undefined ? [] : (from.links ?? []).filter((id) => id !== to);
    if (!from.links.length) delete from.links;
    this.view.markBuilt();
    this.emit({ type: 'factory' });
  }

  /** Relie une machine au côté d'un tapis qui la longe (sa production y est déposée). */
  linkMachineToBelt(b: Belt, dir: Dir): boolean {
    const m = this.view.machineAt(b.x + DX[dir], b.y + DY[dir]);
    if (!m) return false;
    this.view.addFeed(b, dir);
    this.emit({ type: 'factory' });
    this.emit({ type: 'toast', text: `${machineDef(m.type).name} reliée au tapis`, tone: 'good' });
    return true;
  }

  /** Le tapis nourrit la machine qu'il longe : un objet sur deux y entre (tout, si le tapis s'arrête là). */
  linkBeltToMachine(b: Belt, dir: Dir): boolean {
    const m = this.view.machineAt(b.x + DX[dir], b.y + DY[dir]);
    if (!m || dir === b.dir || dir === b.split || dir === b.split2) return false;
    // Le tapis nourrit déjà une machine d'un côté : il peut aussi nourrir celle de l'autre côté (un objet sur trois chacune).
    if (b.split !== undefined) {
      if (b.split2 !== undefined || b.splitJump || !this.view.machineAt(b.x + DX[b.split], b.y + DY[b.split])) return false;
      this.view.setSplit2(b, dir);
    } else {
      this.view.setSplit(b, dir);
    }
    this.emit({ type: 'factory' });
    this.emit({ type: 'toast', text: `Le tapis nourrit ${machineDef(m.type).name.toLowerCase()}`, tone: 'good' });
    return true;
  }

  /** Coupe les liaisons d'un tapis avec les machines qu'il longe. */
  unlinkBelt(b: Belt): void {
    this.view.clearFeeds(b);
    if (b.split2 !== undefined) delete b.split2;
    if (b.split !== undefined && !b.splitJump && this.view.machineAt(b.x + DX[b.split], b.y + DY[b.split])) {
      delete b.split;
      this.view.markBuilt();
    }
    this.emit({ type: 'factory' });
  }

  /** Retire les tapis sous une zone ; renvoie le remboursement. */
  private clearBeltsUnder(w: number, h: number, x: number, y: number): number {
    let refund = 0;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const b = this.view.beltAt(x + i, y + j);
        if (b) refund += this.refundBelt(b);
      }
    }
    return refund;
  }

  moveMachine(m: Machine, x: number, y: number): boolean {
    const check = this.view.checkMachine(m.type, x, y, m, true);
    if (check.ok && check.belts) this.earn(this.clearBeltsUnder(m.w, m.h, x, y));
    const ok = this.view.moveMachine(m, x, y);
    if (!ok) this.emit({ type: 'toast', text: 'Impossible ici', tone: 'warn' });
    else { if (!this.inAtelier) this.world.reveal(x + 1, y + 1, RULES.revealBuilding); this.emit({ type: 'factory' }); }
    return ok;
  }

  jobPos(j: Job): { x: number; y: number } | null {
    if (j.kind === 'belt') {
      const b = this.factory.belts.get(j.k);
      if (!b || b.built) return null;
      return { x: b.x + 0.5, y: b.y + 0.5 };
    }
    const m = this.factory.machines.get(j.id);
    if (!m || m.built) return null;
    return { x: m.x + m.w / 2, y: m.y + m.h / 2 };
  }

  private finishJob(j: Job): void {
    if (j.kind === 'belt') {
      const b = this.factory.belts.get(j.k);
      if (!b) return;
      b.built = true;
      if (this.world.reveal(b.x, b.y, 2)) this.emit({ type: 'reveal' });
    } else {
      const m = this.factory.machines.get(j.id);
      if (!m) return;
      m.built = true;
      // Une foreuse neuve sort du chantier avec un plein de charbon : elle démarre tout de suite.
      if (m.type === 'foreuse') m.fuel = Math.max(m.fuel, RULES.fuelStack);
      if (this.world.reveal(m.x + 1, m.y + 1, RULES.revealBuilding)) this.emit({ type: 'reveal' });
    }
    this.factory.markBuilt();
    this.pending = this.pending.filter((p) => p !== j);
    this.emit({ type: 'built', job: j });
  }

  // ---------- Robot ----------

  sendRobot(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.robot.target = { x, y };
    this.robot.manual = true;
  }

  private revealRobot(force = false): void {
    const cx = Math.floor(this.robot.x), cy = Math.floor(this.robot.y);
    const id = `${cx},${cy}`;
    if (!force && id === this.lastRobotCell) return;
    this.lastRobotCell = id;
    if (this.world.reveal(cx, cy, RULES.revealRobot)) this.emit({ type: 'reveal' });
  }

  /** Le robot a-t-il du charbon pour travailler ? (Il brûle seulement quand il travaille.) */
  private robotPowered(dt: number): boolean {
    const r = this.robot;
    // Le robot remplit sa case carburant avec son inventaire : le carburant d'abord (il dure 5 fois plus), puis le charbon.
    for (const f of FUELS) if (r.fuel < RULES.fuelStack) addTo(r, r.inv.take(f, RULES.fuelStack - r.fuel), f);
    if (!r.active) return r.burn > 0 || r.fuel > 0;
    if (r.burn <= 0 && !burnOne(r, RULES.coalRobotSeconds)) return false;
    r.burn -= dt;
    return true;
  }

  /** Vrai si le robot n'a plus du tout de charbon (il avance alors au ralenti). */
  get robotOutOfCoal(): boolean {
    return this.robot.fuel <= 0 && this.robot.burn <= 0;
  }

  /** Le robot construit lui-même : il va au chantier le plus proche et le construit à courte portée. */
  private tickRobot(dt: number): void {
    const r = this.robot;
    const power = this.robotPowered(dt) ? 1 : RULES.robotNoFuelSpeed;
    r.active = false;
    this.robotBuilding = false;
    if (this.robotJob && !this.jobPos(this.robotJob)) { this.robotJob = null; this.robotT = 0; }
    if (!this.robotJob && this.pending.length) {
      const taken = this.droneJobs();
      let best: Job | null = null, bd = Infinity;
      for (const j of this.pending) {
        if (taken.has(j)) continue;
        const p = this.jobPos(j);
        if (!p) continue;
        const d = Math.hypot(p.x - r.x, p.y - r.y);
        if (d < bd) { bd = d; best = j; }
      }
      this.robotJob = best;
      this.robotT = 0;
    }
    if (this.robotJob && !r.manual) {
      const p = this.jobPos(this.robotJob)!;
      const d = Math.hypot(p.x - r.x, p.y - r.y);
      if (d <= RULES.robotBuildRange) {
        r.target = null;
        this.robotBuilding = true;
        r.active = true;
        this.robotT += dt * power;
        const need = this.robotJob.kind === 'belt' ? RULES.robotBeltTime : RULES.robotMachineTime;
        if (this.robotT >= need) {
          this.finishJob(this.robotJob);
          this.robotJob = null;
          this.robotT = 0;
        }
      } else {
        const k = (d - (RULES.robotBuildRange - 0.6)) / d;
        r.target = { x: r.x + (p.x - r.x) * k, y: r.y + (p.y - r.y) * k };
      }
    }
    if (r.target) {
      const dx = r.target.x - r.x, dy = r.target.y - r.y;
      const d = Math.hypot(dx, dy);
      const step = RULES.robotSpeed * this.robotSpeedMult * dt * power;
      r.active = true;
      if (d <= step) {
        r.x = r.target.x; r.y = r.target.y; r.target = null; r.manual = false; r.moving = false;
      } else {
        r.x += (dx / d) * step; r.y += (dy / d) * step;
        r.heading = Math.atan2(dy, dx);
        r.moving = true;
      }
      this.revealRobot();
    } else {
      r.moving = false;
    }
    // À l'arrêt sur un filon, sans chantier, le robot mine et garde ce qu'il trouve.
    r.mining = null;
    if (!r.target && !this.robotBuilding) {
      const p = this.world.patchAt(Math.floor(r.x), Math.floor(r.y));
      if (p && p.type !== 'eau' && r.inv.room(p.type) > 0) {
        r.mining = p.type;
        r.active = true;
        r.mineT += dt * power * RULES.robotMineRate * RICHNESS_RATE[p.richness];
        if (r.mineT >= 1) {
          r.mineT -= 1;
          r.inv.add(p.type, 1);
          r.mined++;
          this.emit({ type: 'inventory' });
        }
      }
    }
    // Fabrication à la main : en même temps que le reste, et au charbon elle aussi.
    const job = this.craftQueue[0];
    if (job) {
      r.active = true;
      job.t = Math.min(job.total, job.t + dt * power);
      if (job.t >= job.total) this.finishCraft(job);
    }
  }

  // ---------- Inventaire du robot : coffres et fabrication ----------

  private have(): Record<string, number> {
    const h: Record<string, number> = {};
    for (const sl of this.robot.inv.slots) if (sl) h[sl.t] = (h[sl.t] ?? 0) + sl.n;
    return h;
  }

  /** Ce que le robot peut fabriquer avec son inventaire (ou ce qui manque). */
  craftPlan(target: string, n: number) {
    return planCraft(target, n, this.have(), (id) => this.hasMachine(id));
  }

  /** Lance une fabrication : les ingrédients sont pris tout de suite. Renvoie un message d'erreur, ou null. */
  startCraft(target: string, n: number): string | null {
    if (this.craftQueue.length >= CRAFT_QUEUE) return 'Trop de fabrications en attente';
    const res = this.craftPlan(target, n);
    if (!('plan' in res)) return 'Il manque des matières';
    const { plan } = res;
    // Il faut la place pour le résultat, une fois les ingrédients pris.
    const test = this.robot.inv.clone();
    for (const [k, v] of Object.entries(plan.consume)) test.take(k, v);
    let fits = test.add(target, n) === n;
    for (const [k, v] of Object.entries(plan.extra)) fits = fits && test.add(k, v) === v;
    for (const j of this.craftQueue) {
      fits = fits && test.add(j.target, j.n) === j.n;
      for (const [k, v] of Object.entries(j.extra)) fits = fits && test.add(k, v) === v;
    }
    if (!fits) return 'Pas assez de place dans l’inventaire';
    for (const [k, v] of Object.entries(plan.consume)) this.robot.inv.take(k, v);
    this.craftQueue.push({ target, n, consume: plan.consume, extra: plan.extra, steps: plan.steps, total: Math.max(0.5, plan.time), t: 0 });
    this.emit({ type: 'inventory' });
    return null;
  }

  private finishCraft(job: CraftJob): void {
    const test = this.robot.inv.clone();
    let fits = test.add(job.target, job.n) === job.n;
    for (const [k, v] of Object.entries(job.extra)) fits = fits && test.add(k, v) === v;
    if (!fits) { job.blocked = true; return; }
    job.blocked = false;
    this.robot.inv.add(job.target, job.n);
    for (const [k, v] of Object.entries(job.extra)) this.robot.inv.add(k, v);
    this.craftQueue.shift();
    this.emit({ type: 'crafted', item: job.target, n: job.n });
    this.emit({ type: 'inventory' });
  }

  /** Annule une fabrication : les ingrédients reviennent (ce qui ne rentre pas est perdu). */
  cancelCraft(i: number): void {
    const job = this.craftQueue[i];
    if (!job) return;
    this.craftQueue.splice(i, 1);
    for (const [k, v] of Object.entries(job.consume)) this.robot.inv.add(k, v);
    this.emit({ type: 'inventory' });
  }

  /** L'étape en cours d'une fabrication (pour l'afficher). */
  static craftStep(job: CraftJob): CraftStep | null {
    let acc = 0;
    for (const st of job.steps) {
      acc += st.time;
      if (job.t < acc) return st;
    }
    return job.steps[job.steps.length - 1] ?? null;
  }

  /** Du coffre vers le robot ; renvoie la quantité déplacée. */
  chestToRobot(m: Machine, item: string, n: number): number {
    const k = Math.min(n, m.inBuf[item] ?? 0, this.robot.inv.room(item));
    if (k <= 0) return 0;
    this.factory.takeFromStorage(m, item, k);
    this.robot.inv.add(item, k);
    this.emit({ type: 'inventory' });
    return k;
  }

  /** D'une case du robot vers le coffre ; renvoie la quantité déplacée. */
  robotToChest(m: Machine, slot: number, n: number): number {
    const sl = this.robot.inv.slots[slot];
    if (!sl) return 0;
    const k = Math.min(n, sl.n, this.factory.storageRoom(m, sl.t));
    if (k <= 0) return 0;
    const t = sl.t;
    this.robot.inv.takeAt(slot, k);
    this.factory.putInStorage(m, t, k);
    this.emit({ type: 'inventory' });
    return k;
  }

  /** D'une case du robot vers le Noyau, le Laboratoire, le Comptoir ou la Revente ; renvoie la quantité donnée. */
  robotToBuilding(m: Machine, slot: number, n: number): number {
    const sl = this.robot.inv.slots[slot];
    if (!sl) return 0;
    const t = sl.t;
    const k = Math.min(n, sl.n, this.accepts(m, t));
    if (k <= 0) return 0;
    this.robot.inv.takeAt(slot, k);
    const got = this.receive(m, t, k);
    if (got < k) this.robot.inv.add(t, k - got);
    this.emit({ type: 'inventory' });
    return got;
  }

  /** Combien une machine (four, foreuse…) accepte encore de cet objet : charbon dans sa case carburant, ingrédients. */
  machineAccepts(m: Machine, t: string): number {
    const def = machineDef(m.type);
    if (m.built && def.kind === 'rocket') return m.craft ? 0 : Math.max(0, (ROCKET_NEEDS[t] ?? 0) - (m.inBuf[t] ?? 0));
    if (!m.built || (def.kind !== 'crafter' && def.kind !== 'drill' && def.kind !== 'station' && def.kind !== 'generator')) return 0;
    let n = 0;
    const ingredient = def.recipes.some((r) => r.in[t]);
    if (isFuel(t) && def.coal) n += this.factory.fuelRoom(m);
    if (def.kind === 'crafter' && ingredient) n += Math.max(0, RULES.machineBuffer - (m.inBuf[t] ?? 0));
    return n;
  }

  /** D'une case du robot vers une machine ; renvoie la quantité donnée. */
  robotToMachine(m: Machine, slot: number, n: number): number {
    const sl = this.robot.inv.slots[slot];
    if (!sl) return 0;
    const t = sl.t;
    const k = Math.min(n, sl.n, this.machineAccepts(m, t));
    if (k <= 0) return 0;
    this.robot.inv.takeAt(slot, k);
    let rest = k;
    if (isFuel(t)) rest -= this.factory.addFuel(m, rest, t);
    if (rest > 0) m.inBuf[t] = (m.inBuf[t] ?? 0) + rest;
    this.emit({ type: 'inventory' });
    return k;
  }

  /** Reprend des objets d'une machine (en attente ou prêts à sortir) ; renvoie la quantité reprise. */
  machineToRobot(m: Machine, which: 'in' | 'out', t: string, n: number): number {
    const buf = which === 'in' ? m.inBuf : m.outBuf;
    const k = Math.min(n, buf[t] ?? 0, this.robot.inv.room(t));
    if (k <= 0) return 0;
    buf[t] -= k;
    if (buf[t] <= 0) delete buf[t];
    this.robot.inv.add(t, k);
    this.emit({ type: 'inventory' });
    return k;
  }

  /** Sépare une pile du robot en deux. */
  /** Détruit n objets d'une case du robot (pour faire de la place). Renvoie la quantité détruite. */
  destroyRobotItems(slot: number, n: number): number {
    const k = this.robot.inv.takeAt(slot, Math.max(0, Math.floor(n)));
    if (k > 0) this.emit({ type: 'inventory' });
    return k;
  }

  splitRobotSlot(slot: number, n: number): boolean {
    const ok = this.robot.inv.split(slot, n) >= 0;
    if (ok) this.emit({ type: 'inventory' });
    return ok;
  }

  // ---------- Bâtiments offerts par le Noyau ----------

  /** Le Comptoir arrive après les premiers pas, le Laboratoire un peu plus tard. */
  private tickGifts(): void {
    const t = this.played;
    // Un bâtiment offert qui a disparu (ancienne erreur de sauvegarde) : le Noyau le rend.
    for (const type of GIFTS) {
      if (this.gifts[type] !== undefined && ![...this.factory.machines.values()].some((m) => m.type === type)) this.giveBuilding(type, true);
    }
    if (this.gifts.comptoir === undefined) {
      const delivered = Object.values(this.palierDone).some((v) => v > 0) || this.palier > 1;
      if (t >= 90 && (delivered || t >= 240)) this.giveBuilding('comptoir');
      return;
    }
    if (this.gifts.laboratoire === undefined) {
      const since = t - this.gifts.comptoir;
      if (since >= 120 && (this.ordersDone >= 1 || since >= 300)) this.giveBuilding('laboratoire');
    }
  }

  /** Une place libre près du Noyau, hors des filons, avec une case de marge. */
  findGiftSpot(type: string): { x: number; y: number } | null {
    const def = machineDef(type);
    const n = this.noyau;
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const cands: { x: number; y: number; d: number }[] = [];
    for (let y = cy - 14; y <= cy + 14; y++) {
      for (let x = cx - 14; x <= cx + 14; x++) {
        const px = Math.floor(x - def.w / 2), py = Math.floor(y - def.h / 2);
        const d = Math.hypot(x - cx, y - cy);
        if (d < 6.5) continue;
        cands.push({ x: px, y: py, d: d + Math.hypot(x - this.robot.x, y - this.robot.y) * 0.15 });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) {
      let ok = true;
      for (let j = -1; j <= def.h && ok; j++) {
        for (let i = -1; i <= def.w && ok; i++) {
          const x = c.x + i, y = c.y + j;
          if (!this.world.isRevealed(x, y) || this.world.patchAt(x, y) || this.factory.machineAt(x, y) || this.factory.beltAt(x, y)) ok = false;
        }
      }
      if (ok) return { x: c.x, y: c.y };
    }
    return null;
  }

  giveBuilding(type: GiftType, again = false): Machine | null {
    if (this.gifts[type] !== undefined && !again) return null;
    const spot = this.findGiftSpot(type);
    if (!spot) return null;
    const m = this.factory.addMachine(type, spot.x, spot.y, true);
    this.factory.markBuilt();
    if (!again) this.gifts[type] = this.played;
    this.world.reveal(spot.x + 1, spot.y + 1, RULES.revealBuilding);
    this.emit({ type: 'factory' });
    this.emit({ type: 'gift', building: type, id: m.id, again });
    return m;
  }

  // ---------- Drones ----------

  private droneJobs(): Set<Job> {
    const s = new Set<Job>();
    for (const d of this.allDrones()) if (d.task?.kind === 'build') s.add(d.task.job);
    return s;
  }

  /** Les drones des stations, par numéro de station. */
  stationDrones = new Map<number, Drone>();

  /** Tous les drones : ceux du robot, puis ceux des stations. */
  allDrones(): Drone[] {
    return [...this.drones, ...this.stationDrones.values()];
  }

  /** Le point autour duquel travaille le drone en cours : le robot, ou sa station. */
  private anchor = { x: 0, y: 0, build: RULES.buildRange, supply: RULES.supplyRange };

  private useAnchor(d: Drone): void {
    const st = d.station !== undefined ? this.factory.machines.get(d.station) : undefined;
    if (st) {
      const c = this.center(st);
      this.anchor = { x: c.x, y: c.y, build: RULES.stationRange, supply: RULES.stationRange };
    } else {
      this.anchor = { x: this.robot.x, y: this.robot.y, build: RULES.buildRange * this.droneRangeMult, supply: RULES.supplyRange * this.droneRangeMult };
    }
  }

  /** Une station construite a son drone ; une station retirée l'emporte avec elle. */
  /** Combien de drones a une station (trois pour un hangar). */
  stationCapacity(m: Machine): number {
    return m.type === 'hangar' ? RULES.hangarDrones : 1;
  }

  /** Clé d'un drone de station : le numéro de la station, puis + 1 000 000 par drone en plus (hangar). */
  stationKey(id: number, k: number): number {
    return id + k * 1_000_000;
  }

  private syncStations(): void {
    for (const m of this.factory.machines.values()) {
      if (machineDef(m.type).kind !== 'station' || !m.built) continue;
      const n = this.stationCapacity(m);
      for (let k = 0; k < n; k++) {
        const key = this.stationKey(m.id, k);
        if (this.stationDrones.has(key)) continue;
        const c = this.center(m);
        this.stationDrones.set(key, { x: c.x + (k - (n - 1) / 2) * 0.8, y: c.y - 1, station: m.id, state: 'home', task: null, t: 0, slot: k, fuel: RULES.fuelStack, burn: 0, cargo: null, priorities: [...DEFAULT_ORDER] });
      }
    }
    for (const [key, d] of this.stationDrones) {
      const m = d.station !== undefined ? this.factory.machines.get(d.station) : undefined;
      const k = Math.floor(key / 1_000_000);
      if (!m || machineDef(m.type).kind !== 'station' || !m.built || k >= this.stationCapacity(m)) this.stationDrones.delete(key);
    }
  }

  setStationPriorities(id: number, list: DronePriority[]): void {
    // Tous les drones de la station (trois pour un hangar) prennent le même ordre.
    for (const d of this.stationDrones.values()) {
      if (d.station !== id) continue;
      d.priorities = cleanOrder(list);
      d.task = null;
      if (d.state === 'fly') d.state = 'home';
    }
  }

  private near(p: { x: number; y: number }, range = this.anchor.build): boolean {
    return Math.hypot(p.x - this.anchor.x, p.y - this.anchor.y) <= range;
  }

  private center(m: Machine): { x: number; y: number } {
    return { x: m.x + m.w / 2, y: m.y + m.h / 2 };
  }

  /** Les bâtiments qui reçoivent, s'ils existent. */
  private building(type: 'noyau' | 'laboratoire' | 'comptoir'): Machine | null {
    for (const m of this.factory.machines.values()) if (m.type === type && m.built) return m;
    return null;
  }

  /** Le coffre à portée le plus proche du drone qui contient cet objet. Les drones ne se servent jamais dans l'inventaire du robot. */
  private sourceFor(d: Drone, item: string): Source | null {
    // Le drone d'une station prend d'abord le charbon de sa station (elle en garde 2 pour lui).
    if (item === 'charbon' && d.station !== undefined) {
      const st = this.factory.machines.get(d.station);
      if (st?.built && st.fuel > RULES.stationReserve) return { kind: 'station', id: st.id };
    }
    if (item === 'carburant' && d.station !== undefined) {
      const st = this.factory.machines.get(d.station);
      if (st?.built && (st.carb ?? 0) > 0 && st.fuel > RULES.stationReserve) return { kind: 'station', id: st.id };
    }
    let best: Source | null = null, bd = Infinity;
    for (const m of this.factory.machines.values()) {
      if (machineDef(m.type).kind !== 'storage' || !m.built || !(m.inBuf[item] > 0)) continue;
      const c = this.center(m);
      if (!this.near(c, this.anchor.supply)) continue;
      const dist = Math.hypot(c.x - d.x, c.y - d.y);
      if (dist < bd) { bd = dist; best = { kind: 'chest', id: m.id }; }
    }
    return best;
  }

  /** Où prendre de quoi brûler : du charbon d'abord, sinon du carburant. */
  private fuelSource(d: Drone): { src: Source; item: string } | null {
    for (const item of FUELS) {
      const src = this.sourceFor(d, item);
      if (src) return { src, item };
    }
    return null;
  }

  /** Le coffre où rendre la cargaison du drone : celui d'où elle vient, s'il existe encore et a de la place. */
  private returnChest(d: Drone): Machine | null {
    if (!d.cargo || d.from === undefined) return null;
    const m = this.factory.machines.get(d.from);
    if (!m || !m.built) return null;
    // Le charbon pris dans une station y retourne.
    if (machineDef(m.type).kind === 'station') return isFuel(d.cargo.t) && this.factory.fuelRoom(m) > 0 ? m : null;
    if (machineDef(m.type).kind !== 'storage') return null;
    return this.factory.storageRoom(m, d.cargo.t) > 0 ? m : null;
  }

  /** Ce qui manque à un bâtiment, et le bâtiment lui-même. */
  private needsOf(cat: 'noyau' | 'laboratoire' | 'comptoir', d: Drone): { m: Machine; needs: Record<string, number> } | null {
    const m = this.building(cat);
    if (!m) return null;
    // Le drone d'une station ne quitte pas son rayon : le bâtiment doit y être.
    if (d.station !== undefined && !this.near(this.center(m), this.anchor.supply)) return null;
    const needs = cat === 'noyau' ? this.noyauNeeds() : cat === 'laboratoire' ? this.labNeeds() : this.comptoirNeeds();
    return Object.keys(needs).length ? { m, needs } : null;
  }

  private pickTask(d: Drone): DroneTask | null {
    const others = this.allDrones().filter((o) => o !== d && o.task);
    const reservedFuel = new Set(others.map((o) => (o.task!.kind === 'refuel' ? o.task!.id : -1)));

    // Son propre carburant d'abord, toujours : une recharge reliée au courant, à portée, sinon du charbon.
    if (d.fuel <= 3) {
      const ch = [...this.factory.machines.values()]
        .filter((m) => m.built && machineDef(m.type).kind === 'charger' && (m.power ?? 0) > 0 && this.near(this.center(m), this.anchor.supply))
        .sort((a, b) => Math.hypot(this.center(a).x - d.x, this.center(a).y - d.y) - Math.hypot(this.center(b).x - d.x, this.center(b).y - d.y))[0];
      if (ch) return { kind: 'recharge', id: ch.id };
      const fs = this.fuelSource(d);
      if (fs) return { kind: 'fetch', from: fs.src, item: fs.item, self: true };
    }
    // Machines à portée qui ont besoin de charbon, la plus vide d'abord.
    const needy = [...this.factory.machines.values()]
      .filter((m) => m.built && this.factory.fuelRoom(m) > 0 && !reservedFuel.has(m.id) && m.id !== d.station && this.near(this.center(m), this.anchor.supply))
      .sort((a, b) => a.fuel - b.fuel);
    const order = d.priorities;
    const refueler = order[0] === 'carburant';
    const cargo = d.cargo;

    // 1. Avec une cargaison : la livrer là où elle sert, dans l'ordre des priorités.
    if (cargo) {
      for (const cat of order) {
        if (cat === 'carburant') {
          if (isFuel(cargo.t) && needy[0]) return { kind: 'refuel', id: needy[0].id };
          if (isFuel(cargo.t) && refueler && cargo.n < RULES.invStack) {
            const src = this.sourceFor(d, cargo.t);
            if (src) return { kind: 'fetch', from: src, item: cargo.t };
          }
        } else if (cat === 'chantiers') {
          const job = this.freeJob();
          if (job) return { kind: 'build', job };
        } else {
          const nb = this.needsOf(cat, d);
          if (nb && nb.needs[cargo.t]) return { kind: 'deliver', id: nb.m.id };
        }
      }
      // Personne n'en veut (sauf le charbon d'un drone ravitailleur, qu'il garde pour la prochaine machine) :
      // retour au coffre d'où elle vient ; s'il n'existe plus ou qu'il est plein, la cargaison est détruite.
      if (!(isFuel(cargo.t) && refueler)) {
        const home = this.returnChest(d);
        if (home) return machineDef(home.type).kind === 'station' ? { kind: 'refuel', id: home.id } : { kind: 'deliver', id: home.id };
        d.cargo = null;
        d.from = undefined;
      }
      return null;
    }

    // 2. Les mains vides : la première tâche utile dans l'ordre des priorités.
    for (const cat of order) {
      if (cat === 'carburant') {
        if (needy.length || refueler) {
          const fs = this.fuelSource(d);
          if (fs) return { kind: 'fetch', from: fs.src, item: fs.item };
        }
      } else if (cat === 'chantiers') {
        const job = this.freeJob();
        if (job) return { kind: 'build', job };
      } else {
        const nb = this.needsOf(cat, d);
        if (!nb) continue;
        for (const [item, need] of Object.entries(nb.needs)) {
          const src = this.sourceFor(d, item);
          // Juste ce qu'il faut : le reste reste dans le coffre ou chez le robot.
          if (src) return { kind: 'fetch', from: src, item, max: need };
        }
      }
    }
    return null;
  }

  /** Un chantier à portée que personne ne fait encore. */
  private freeJob(): Job | null {
    const taken = this.droneJobs();
    return this.pending.find((j) => {
      if (taken.has(j) || j === this.robotJob) return false;
      const p = this.jobPos(j);
      return p && this.near(p);
    }) ?? null;
  }

  private taskPos(t: DroneTask): { x: number; y: number } | null {
    if (t.kind === 'build') return this.jobPos(t.job);
    const id = t.kind === 'fetch' ? (t.from as { id: number }).id : t.id;
    const m = this.factory.machines.get(id);
    return m && m.built ? this.center(m) : null;
  }

  private doTask(d: Drone, t: DroneTask): void {
    const f = this.factory;
    if (t.kind === 'fetch') {
      const take = (n: number): number => {
        if (n <= 0) return 0;
        const m = f.machines.get(t.from.id);
        if (!m) return 0;
        if (t.from.kind === 'station') {
          // Dans la case carburant de la station (on lui en laisse un peu pour le drone).
          return f.takeFuel(m, n, t.item, RULES.stationReserve);
        }
        return f.takeFromStorage(m, t.item, n);
      };
      if (t.self) addTo(d, take(RULES.fuelStack - d.fuel), t.item);
      if (!d.cargo || d.cargo.t === t.item) {
        const room = RULES.invStack - (d.cargo?.n ?? 0);
        const got = take(t.max !== undefined ? Math.min(room, t.max) : room);
        if (got > 0) {
          d.cargo = { t: t.item, n: (d.cargo?.n ?? 0) + got };
          d.from = t.from.id;
        }
      }

    } else if (t.kind === 'recharge') {
      const m = f.machines.get(t.id);
      if (m && (m.power ?? 0) > 0) { d.fuel = RULES.fuelStack; d.carb = 0; d.burn = RULES.coalDroneSeconds; }
    } else if (t.kind === 'refuel' && d.cargo && isFuel(d.cargo.t)) {
      const m = f.machines.get(t.id);
      if (m) d.cargo.n -= f.addFuel(m, d.cargo.n);
    } else if (t.kind === 'deliver' && d.cargo) {
      const m = f.machines.get(t.id);
      if (m) {
        const kind = machineDef(m.type).kind;
        d.cargo.n -= kind === 'core' || kind === 'lab' || kind === 'missions'
          ? this.receive(m, d.cargo.t, d.cargo.n)
          : f.putInMachine(m, d.cargo.t, d.cargo.n);
      }
    }
    if (d.cargo && d.cargo.n <= 0) d.cargo = null;
    if (!d.cargo) d.from = undefined;
  }

  /** Range les tâches d'un drone, de la plus importante à la moins importante. */
  setDronePriorities(i: number, list: DronePriority[]): void {
    const d = this.drones[i];
    if (!d) return;
    d.priorities = cleanOrder(list);
    d.task = null;
    if (d.state === 'fly') d.state = 'home';
  }

  /** Met une tâche en tête de liste. */
  setDronePriority(i: number, p: DronePriority): void {
    const d = this.drones[i];
    if (d) this.setDronePriorities(i, [p, ...d.priorities.filter((x) => x !== p)]);
  }

  /** Le drone brûle du charbon en vol ; faux s'il n'en a plus. */
  private droneFuel(d: Drone, dt: number): boolean {
    if (d.burn <= 0 && !burnOne(d, RULES.coalDroneSeconds)) return false;
    d.burn -= dt;
    return true;
  }

  private tickDrones(dt: number): void {
    const r = this.robot;
    this.syncStations();
    for (const d of this.allDrones()) {
      this.useAnchor(d);
      const st = d.station !== undefined ? this.factory.machines.get(d.station) : undefined;
      if (d.state === 'parked' && st) {
        // Posé sur sa station : il repart dès qu'elle a du charbon dans sa case carburant.
        d.x = this.anchor.x; d.y = this.anchor.y - 0.6;
        if (moveFuel(st, d, RULES.fuelStack - d.fuel) > 0) d.state = 'home';
        continue;
      }
      if (d.state === 'parked') {
        // Posé sur le robot : il repart dès que le robot peut partager sa case carburant
        // (jamais son inventaire ; le robot y remplit lui-même sa case carburant).
        d.x = r.x; d.y = r.y - 0.9;
        if (moveFuel(r, d, Math.min(RULES.fuelStack - d.fuel, Math.floor(r.fuel / 2))) > 0) d.state = 'home';
        continue;
      }
      // Sans travail, il se pose sur le robot (qui le porte) ou sur sa station : il ne brûle plus de charbon.
      const restAt = st ? { x: this.anchor.x, y: this.anchor.y - 0.6 } : { x: r.x, y: r.y - 0.9 };
      if (d.state === 'rest') {
        d.x = restAt.x; d.y = restAt.y;
        d.task = this.pickTask(d);
        if (!d.task) continue;
        d.state = 'home';
      }
      if (d.task && !this.taskPos(d.task)) d.task = null;
      if (!d.task && d.state !== 'work') d.task = this.pickTask(d);
      const target = d.task ? this.taskPos(d.task)! : restAt;
      const dist = Math.hypot(target.x - d.x, target.y - d.y);
      if (d.state === 'work' && d.task?.kind === 'build') {
        d.t += dt;
        const need = d.task.job.kind === 'belt' ? RULES.beltBuildTime : RULES.machineBuildTime;
        if (d.t >= need) {
          this.finishJob(d.task.job);
          d.task = null;
          d.state = 'home';
        }
        continue;
      }
      if (d.state === 'work') d.state = 'home';
      if (dist > 0.05 && (d.task || dist > 0.6)) {
        // En vol : il brûle du charbon. Sans charbon, il revient se poser sur le robot.
        if (!this.droneFuel(d, dt)) {
          d.task = null;
          d.state = 'parked';
          continue;
        }
        d.state = 'fly';
        const step = RULES.droneSpeed * dt;
        if (dist <= step) { d.x = target.x; d.y = target.y; }
        else { d.x += ((target.x - d.x) / dist) * step; d.y += ((target.y - d.y) / dist) * step; }
      } else if (!d.task) {
        d.state = 'rest';
        d.x = restAt.x; d.y = restAt.y;
      }
      if (d.task && Math.hypot(target.x - d.x, target.y - d.y) < 0.05) {
        if (d.task.kind === 'build') { d.state = 'work'; d.t = 0; }
        else { this.doTask(d, d.task); d.task = null; d.state = 'home'; }
      }
    }
  }

  /** Moment de la journée, de 0 à 1 (0 : le matin ; la nuit tombe vers 0,6). */
  get dayTime(): number {
    return (this.played % RULES.dayCycle) / RULES.dayCycle;
  }

  /** Lumière du jour : 1 en plein jour, 0 la nuit, entre les deux au crépuscule et à l'aube. */
  get daylight(): number {
    const t = this.dayTime;
    if (t < 0.6) return 1;
    if (t < 0.68) return 1 - (t - 0.6) / 0.08;
    if (t < 0.92) return 0;
    return (t - 0.92) / 0.08;
  }

  private wasNight: boolean | null = null;

  /** Fusées lancées. */
  rockets = 0;

  /** Succès obtenus. */
  achievements = new Set<string>();
  private achT = 0;

  private checkAchievements(): void {
    for (const a of ACHIEVEMENTS) {
      if (this.achievements.has(a.id)) continue;
      let ok = false;
      try { ok = a.test(this); } catch { ok = false; }
      if (!ok) continue;
      this.achievements.add(a.id);
      this.emit({ type: 'toast', text: `Succès : ${a.name}`, tone: 'good' });
    }
  }

  /** Statistiques : ce qui a été fabriqué, relevé toutes les 10 secondes (les 10 dernières minutes). */
  statHistory: { t: number; made: Record<string, number> }[] = [];
  private statT = 0;

  /** Débit de fabrication d'un objet, par minute, sur les `seconds` dernières secondes. */
  ratePerMinute(item: string, seconds = 60): number {
    const h = this.statHistory;
    if (!h.length) return 0;
    const now = this.factory.stats.made[item] ?? 0;
    const target = this.played - seconds;
    let old = h[0];
    for (const p of h) if (p.t <= target) old = p; else break;
    const dt = Math.max(10, this.played - old.t);
    return ((now - (old.made[item] ?? 0)) / dt) * 60;
  }

  /** Change ce que trie un séparateur (null : il ne trie plus, un objet sur deux de chaque côté). */
  setBeltFilter(b: Belt, item: string | null): boolean {
    if (!this.isUnlocked('tri') || b.split === undefined) return false;
    if (item) b.filter = item; else delete b.filter;
    this.view.markBuilt();
    this.emit({ type: 'factory' });
    return true;
  }

  tick(dt: number): void {
    this.time += dt;
    this.played += dt;
    const light = this.daylight;
    this.factory.daylight = light;
    const night = light < 0.5;
    if (this.wasNight !== null && night !== this.wasNight && this.hasMachine('solaire') && [...this.factory.machines.values()].some((m) => m.type === 'solaire')) {
      this.emit({ type: 'toast', text: night ? 'La nuit tombe : les panneaux solaires s’arrêtent, les batteries prennent le relais' : 'Le jour se lève : les panneaux solaires repartent', tone: 'info' });
    }
    this.wasNight = night;
    this.achT += dt;
    if (this.achT > 2) { this.achT = 0; this.checkAchievements(); }
    this.statT += dt;
    if (this.statT >= 10 || !this.statHistory.length) {
      this.statT = 0;
      this.statHistory.push({ t: this.played, made: { ...this.factory.stats.made } });
      if (this.statHistory.length > 61) this.statHistory.shift();
    }
    this.tickRobot(dt);
    this.tickDrones(dt);
    this.factory.tick(dt);
    this.tickSell(dt);
    this.tickGifts();
  }

  // ---------- Sauvegarde ----------

  serialize(): GameSave {
    const r = this.robot;
    return {
      v: 5, seed: this.world.seed, time: Date.now(), money: this.money, xp: 0, level: this.palier,
      robot: { x: r.x, y: r.y },
      factory: this.factory.serialize(),
      pending: this.pending, fog: this.world.saveFog(),
      order: this.order, choices: this.choices, stock: {},
      orderSeq: this.orderSeq, rerolls: this.rerolls, delivered: this.delivered,
      drones: this.droneCount,
      unlocks: [...this.unlocks],
      palier: this.palier, palierDone: this.palierDone, lab: this.lab, extraDrones: this.extraDrones,
      look: this.look, tips: this.tips, played: Math.floor(this.played), sellT: this.sellT,
      gifts: this.gifts, ordersDone: this.ordersDone,
      stats: this.factory.stats, achievements: [...this.achievements], rockets: this.rockets,
      crew: {
        robot: { fuel: r.fuel, carb: r.carb, burn: r.burn, inv: r.inv.save(), craft: this.craftQueue },
        drones: this.drones.map((d) => ({ fuel: d.fuel, carb: d.carb, burn: d.burn, cargo: d.cargo ? { ...d.cargo } : null, from: d.from, priorities: [...d.priorities] })),
        stations: [...this.stationDrones.entries()].map(([id, d]) => ({ id, fuel: d.fuel, carb: d.carb, burn: d.burn, cargo: d.cargo ? { ...d.cargo } : null, from: d.from, priorities: [...d.priorities] })),
      },
    };
  }

  private load(s: GameSave): void {
    this.money = s.money;
    this.robot.x = s.robot.x; this.robot.y = s.robot.y;
    this.world.loadFog(s.fog);
    this.factory.load(s.factory);
    if (s.stats) { this.factory.stats.made = { ...s.stats.made }; this.factory.stats.used = { ...s.stats.used }; }
    for (const id of s.achievements ?? []) this.achievements.add(id);
    this.rockets = s.rockets ?? 0;
    this.pending = s.pending.filter((j) => (j.kind === 'belt' ? this.factory.belts.has(j.k) : this.factory.machines.has(j.id)));
    this.order = s.order; this.choices = s.choices;
    this.orderSeq = s.orderSeq; this.rerolls = s.rerolls; this.delivered = s.delivered ?? 0;
    if (this.order) { this.order.xp = 0; delete this.order.equip; }
    this.look = cleanLook(s.look);
    // Les parties d'avant les conseils n'en reçoivent pas.
    this.tips = s.tips ? { done: [...(s.tips.done ?? [])], off: !!s.tips.off } : { done: [], off: true };
    this.played = s.played ?? 0;
    this.sellT = s.sellT ?? 0;
    this.ordersDone = s.ordersDone ?? 0;
    this.gifts = { ...(s.gifts ?? {}) };
    // Déjà posés avant les cadeaux : ils comptent comme offerts.
    for (const m of this.factory.machines.values()) if ((m.type === 'comptoir' || m.type === 'laboratoire') && this.gifts[m.type] === undefined) this.gifts[m.type] = 0;
    if (s.v >= 4) {
      this.palier = s.palier ?? 1;
      this.palierDone = s.palierDone ?? {};
      this.lab = s.lab ?? {};
      this.extraDrones = s.extraDrones ?? 0;
      this.unlocks = new Set([...BASE_UNLOCKS, ...(s.unlocks ?? [])]);
    } else {
      // Avant les paliers : on garde les déblocages (ou ceux qu'ouvrait le niveau), on repart du palier 1.
      if (s.unlocks) {
        this.unlocks = new Set([...BASE_UNLOCKS, ...s.unlocks]);
      } else {
        const legacy: Record<string, number> = { presse: 1, tour: 2, trefileuse: 3, haut_fourneau: 4, assembleur: 5, broyeur: 6, melangeur: 7, raffinerie: 8, fabricant: 9, centrifugeuse: 12, separateur: 2 };
        for (const [id, lvl] of Object.entries(legacy)) if ((s.level ?? 1) >= lvl) this.unlocks.add(id);
        for (const x of ALL_NODES) if (this.unlocks.has(x.id)) x.parents.forEach((p) => this.unlocks.add(p));
      }
      const fromTree = [...this.unlocks].filter((id) => NODE[id]?.effect.kind === 'drone').length;
      this.extraDrones = Math.max(0, (s.drones ?? RULES.startDrones) - RULES.startDrones - fromTree);
    }
    this.applyUnlocks();
    this.rebuildDrones();
    if (s.crew) {
      const r = this.robot;
      r.fuel = s.crew.robot.fuel; r.burn = s.crew.robot.burn; r.carb = Math.min(s.crew.robot.carb ?? 0, r.fuel); r.inv.load(s.crew.robot.inv);
      this.craftQueue = (s.crew.robot.craft ?? []).filter((j) => j && typeof j.target === 'string').map((j) => ({ ...j }));
      this.syncStations();
      for (const sd of s.crew.stations ?? []) {
        const d = this.stationDrones.get(sd.id);
        if (d) { d.fuel = sd.fuel; d.carb = Math.min(sd.carb ?? 0, sd.fuel); d.burn = sd.burn; d.cargo = sd.cargo ? { ...sd.cargo } : null; d.from = sd.cargo ? sd.from : undefined; d.priorities = cleanOrder(sd.priorities ?? []); }
      }
      s.crew.drones.forEach((sd, i) => {
        const d = this.drones[i];
        if (d) { d.fuel = sd.fuel; d.carb = Math.min(sd.carb ?? 0, sd.fuel); d.burn = sd.burn; d.cargo = sd.cargo ? { ...sd.cargo } : null; d.from = sd.cargo ? sd.from : undefined; d.priorities = cleanOrder(sd.priorities ?? (sd.priority ? [sd.priority] : [])); }
      });
    } else if (this.drones[0]) {
      // Sauvegarde d'avant le charbon : le cadeau de départ.
      this.drones[0].cargo = { t: 'charbon', n: RULES.giftCoal };
    }
  }

  /** Résumé lisible d'une commande (« 20 plaques de fer »). */
  static orderTitle(o: Order): string {
    return o.lines.map((l) => itemLabel(l.item, l.qty)).join(' et ');
  }
}

export { unkey };
