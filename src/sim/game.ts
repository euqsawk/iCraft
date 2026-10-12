// L'état complet d'une partie : monde, usine, robot, argent, paliers, laboratoire et commandes.
import { CHUNK, RULES } from '../config.ts';
import { MACHINES, machineDef } from '../data/machines.ts';
import { item as itemDef, itemLabel } from '../data/items.ts';
const itemValue = (id: string): number => itemDef(id).value;
import { World } from '../world/world.ts';
import { Factory, stopRules, type Belt, type StopRule, type FactorySave, type Line, type Machine, type VehicleKind } from './factory.ts';
import { DX, DY, key, unkey, type Dir } from './geom.ts';
import { firstOrder, generateChoices, orderComplete, type Order } from './orders.ts';
import type { TraceCell } from './tracer.ts';
import { ACHIEVEMENT_OF_SKIN, ACHIEVEMENTS, OLD_ACHIEVEMENTS } from '../data/achievements.ts';
import { SKIN, skinOf } from '../data/skins.ts';
import { ALL_NODES, BASE_UNLOCKS, LAB_ITEMS, NODE, nodeForMachine, type UnlockNode } from '../data/unlocks.ts';
import { MAX_PALIER, palierMission } from '../data/paliers.ts';
import { cleanLook, DEFAULT_LOOK, type RobotLook } from '../data/look.ts';
import { FREIGHT_AWAY, FREIGHT_DOCK, freightOrder, newFreight, type FreightState } from './freight.ts';

/** Ce qu'un drone fait en premier ; ensuite il fait le reste dans l'ordre habituel. */
/** Bâtiments offerts par le Noyau, dans l'ordre. */
export const GIFTS = ['comptoir', 'laboratoire'] as const;
export type GiftType = typeof GIFTS[number];

export type Job = { kind: 'belt'; k: number } | { kind: 'machine'; id: number };

export interface Robot {
  x: number;
  y: number;
  target: { x: number; y: number } | null;
  /** Le joueur a donné l'ordre de se déplacer. */
  manual: boolean;
  heading: number;
  moving: boolean;
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
  | { type: 'freight' }
  | { type: 'gift'; building: GiftType; id: number; again?: boolean }
  | { type: 'unlock'; id: string }
  /** Le robot s'est téléporté à sa base (d'où il partait). */
  | { type: 'teleport'; fromX: number; fromY: number }
  | { type: 'achievement'; id: string }
  | { type: 'look' };

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
  /** Anciennes parties : nombre de drones (retirés du jeu). */
  drones?: number;
  /** Arbre de déblocages (depuis la version 3). */
  unlocks?: string[];
  points?: number;
  /** Paliers du Noyau et laboratoire (depuis la version 4). */
  palier?: number;
  palierDone?: Record<string, number>;
  lab?: Record<string, number>;
  extraDrones?: number;
  priorities?: unknown;
  /** Apparence du robot, conseils et temps de jeu (depuis la version 5). */
  look?: RobotLook;
  tips?: TipState;
  played?: number;
  /** Statistiques de production et succès. */
  stats?: { made: Record<string, number>; used: Record<string, number> };
  achievements?: string[];
  rockets?: number;
  /** Le train de fret (mode à cocher au début d'une partie). */
  freight?: FreightState;
  /** Ancienne pollution (retirée) : ignorée au chargement. */
  pollution?: Record<string, number>;
  gifts?: Record<string, number>;
  ordersDone?: number;
  /** Pièces gagnées au total (commandes du Comptoir), pour les succès Fortune. */
  earned?: number;
  /** Anciennes parties : revente, charbon et inventaires du robot et des drones (retirés du jeu). */
  sellT?: number;
  crew?: unknown;
}

/** Ce qu'on ne pose pas dans un atelier (ça vit sur la carte). */
const NOT_IN_ATELIER = new Set(['generateur', 'depot', 'gare', 'foreuse', 'solaire', 'batterie', 'pompe', 'centrale', 'rampe', 'arbre', 'base_robot']);

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
    for (const b of f.belts.values()) v += RULES.beltCost + (b.jump ? RULES.bridgeCost : 0) + (b.splitJump ? RULES.bridgeCost : 0) + Game.levelValue(RULES.beltLevelCost, b.lvl);
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

  /** Ce que vaut l'intérieur enregistré d'un atelier (machines, tapis, ateliers imbriqués). */
  saveValue(s: FactorySave): number {
    let v = 0;
    for (const m of s.machines) v += (MACHINES[m.type]?.cost ?? 0) + (m.inner ? this.saveValue(m.inner) : 0);
    for (const b of s.belts) v += RULES.beltCost + (b[8] ? RULES.bridgeCost : 0) + (b[9] ? RULES.bridgeCost : 0) + Game.levelValue(RULES.beltLevelCost, b[14]);
    return v;
  }

  /** Prix d'un atelier posé depuis un plan : l'atelier, plus son contenu au taux de copie. */
  planPrice(s: FactorySave): number {
    return machineDef('atelier').cost + Math.ceil(this.saveValue(s) * this.copyRate);
  }

  /** L'intérieur d'un atelier, vidé, prêt à enregistrer comme plan. */
  planOf(m: Machine): FactorySave | null {
    return m.inner ? this.blankSave(m.inner.serialize()) : null;
  }

  /** Pose un atelier depuis un plan enregistré (d'une autre partie, peut-être). */
  placePlan(save: FactorySave, size: number, x: number, y: number): Machine | null {
    if (!this.hasMachine('atelier')) { this.emit({ type: 'toast', text: 'Modules : à débloquer dans l’arbre', tone: 'warn' }); return null; }
    if (this.inAtelier && !this.nesting) { this.emit({ type: 'toast', text: 'Imbrication : à débloquer dans l’arbre (Modules)', tone: 'warn' }); return null; }
    const f = this.view;
    const check = f.checkMachine('atelier', x, y, undefined, true);
    if (!check.ok) { this.emit({ type: 'toast', text: check.reason ?? 'Impossible ici', tone: 'warn' }); return null; }
    // Un plan peut contenir des machines pas encore débloquées dans cette partie.
    const missing = [...new Set(save.machines.map((m) => m.type))].filter((t) => MACHINES[t] && !this.hasMachine(t));
    if (missing.length) { this.emit({ type: 'toast', text: `Pas encore débloqué : ${missing.map((t) => machineDef(t).name.toLowerCase()).join(', ')}`, tone: 'warn' }); return null; }
    if (!this.spend(this.planPrice(save))) return null;
    if (check.belts) this.earn(this.clearBeltsUnder(3, 3, x, y));
    const m = f.addMachine('atelier', x, y, false);
    f.makeInner(m, Math.max(size, this.atelierSize)).load(this.blankSave(save));
    this.finishPlacement(m);
    this.emit({ type: 'toast', text: 'Atelier posé depuis le plan', tone: 'good' });
    return m;
  }

  /** Est-on à l'intérieur de cet atelier (ou de l'un de ceux qu'il contient) ? */
  private isAncestorOrSelf(m: Machine): boolean {
    return this.viewStack.includes(m);
  }

  /** Après une pose : c'est construit tout de suite (plus de chantier ni de drones). */
  private finishPlacement(m: Machine): void {
    if (this.inAtelier) m.built = true;
    else this.finishJob({ kind: 'machine', id: m.id });
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
      cables: [], lines: [],
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
  robot: Robot = { x: 2, y: 7, target: null, manual: false, heading: 0, moving: false };
  /** Chantiers en attente : toujours vide (tout se construit tout de suite), gardé pour les anciennes sauvegardes. */
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
  /** Bâtiments offerts : type → temps de jeu au moment du cadeau. */
  gifts: Record<string, number> = {};
  ordersDone = 0;
  /** Pièces gagnées au total (les remboursements ne comptent pas). */
  earned = 0;
  /** Pendant le calcul de la production hors ligne : objets livrés, par type. */
  private offlineGains: Record<string, number> | null = null;
  private listeners: ((e: GameEvent) => void)[] = [];
  private lastRobotCell = '';
  readonly noyau: Machine;
  /** Le train de fret, si la partie a été lancée avec ce mode. */
  freight: FreightState | null = null;

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
    }
    this.revealRobot(true);
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
    if (m.type === 'quai') return this.freight ? Math.max(0, (this.freight.req[item] ?? 0) - (m.inBuf[item] ?? 0)) : 0;
    // Le Laboratoire ne prend que ce qu'il faut encore pour les déblocages possibles à ce palier (rien en réserve).
    if (m.type === 'laboratoire') return LAB_ITEMS.has(item) ? this.labNeeds()[item] ?? 0 : 0;
    return 0;
  }

  /** Un bâtiment reçoit des objets (par tapis). Renvoie le nombre accepté. */
  receive(m: Machine, item: string, n: number): number {
    const k = Math.min(n, this.accepts(m, item));
    if (k <= 0) return 0;
    if (this.offlineGains) this.offlineGains[item] = (this.offlineGains[item] ?? 0) + k;
    this.delivered += k;
    if (m.type === 'noyau') {
      this.palierDone[item] = (this.palierDone[item] ?? 0) + k;
      this.emit({ type: 'order' });
      if (!this.offlineGains) this.checkPalier();
    } else if (m.type === 'laboratoire') {
      this.lab[item] = (this.lab[item] ?? 0) + k;
      this.emit({ type: 'lab' });
    } else if (m.type === 'quai') {
      m.inBuf[item] = (m.inBuf[item] ?? 0) + k;
      this.emit({ type: 'freight' });
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

  // ---------- Train de fret ----------

  /** Où va le Quai : toujours en bas, centré sous le Noyau, à 20 cases de lui. */
  static readonly QUAI_AT = { x: -1, y: 24 };

  /** Le Quai du train (posé s'il manque, à sa place sous le Noyau ; ramené là si la place est libre). */
  quai(relocate = false): Machine {
    const f = this.factory, { x, y } = Game.QUAI_AT;
    const have = [...f.machines.values()].find((m) => m.type === 'quai');
    if (have) {
      if (relocate && (have.x !== x || have.y !== y) && f.checkMachine('quai', x, y, have, false).ok) {
        f.removeMachine(have);
        const m = f.addMachine('quai', x, y, true, have.id);
        m.inBuf = have.inBuf;
        return m;
      }
      return have;
    }
    // Rien ne doit l'empêcher : ce qui est sous lui (filon, lac) reste dessous.
    const m = f.addMachine('quai', x, y, true);
    this.world.reveal(x + 3, y + 1, 6);
    return m;
  }

  /** Lance le mode train de fret (au début d'une partie) : le Quai est posé, la première commande annoncée. */
  startFreight(): void {
    if (this.freight) return;
    this.quai(true);
    this.freight = newFreight(this.world.seed, this.palier);
    this.emit({ type: 'freight' });
  }

  private stepFreight(dt: number): void {
    const fr = this.freight!;
    fr.t -= dt;
    if (fr.t > 0) return;
    if (fr.phase === 'away') {
      fr.phase = 'here';
      fr.t = FREIGHT_DOCK;
      this.emit({ type: 'toast', text: 'Le train de fret est à quai : il repart dans 10 minutes', tone: 'info' });
    } else {
      this.freightDeparts();
      fr.phase = 'away';
      fr.t = FREIGHT_AWAY;
      fr.visit++;
      Object.assign(fr, freightOrder(this.world.seed, fr.visit, this.palier));
    }
    this.emit({ type: 'freight' });
  }

  /** Ce qu'il reste à mettre dans le coffre du train. */
  freightMissing(): Record<string, number> {
    const out: Record<string, number> = {};
    if (!this.freight) return out;
    const q = this.quai();
    for (const [k, v] of Object.entries(this.freight.req)) { const left = v - (q.inBuf[k] ?? 0); if (left > 0) out[k] = left; }
    return out;
  }

  /** Le train repart : il prend sa commande ; prime si tout y est, sinon l'amende annoncée. */
  private freightDeparts(): void {
    const fr = this.freight!;
    const q = this.quai();
    const missing = Object.values(this.freightMissing()).reduce((a, n) => a + n, 0);
    for (const [k, v] of Object.entries(fr.req)) {
      const take = Math.min(v, q.inBuf[k] ?? 0);
      if (take > 0) { q.inBuf[k] -= take; if (!q.inBuf[k]) delete q.inBuf[k]; }
    }
    if (missing === 0) {
      fr.streak++;
      this.earn(fr.reward);
      fr.last = { ok: true, missing: 0, paid: 0, taxed: 0, reward: fr.reward };
      this.emit({ type: 'toast', text: `Le train repart plein : +${fr.reward} pièces`, tone: 'good' });
      return;
    }
    fr.streak = 0;
    const paid = Math.min(this.money, fr.fine);
    this.money -= paid;
    this.emit({ type: 'money' });
    // Pas assez de pièces : il prélève le reste dans les coffres (à la valeur des objets).
    let rest = fr.fine - paid, taxed = 0;
    for (const m of this.factory.machines.values()) {
      if (rest <= 0) break;
      if (machineDef(m.type).kind !== 'storage') continue;
      for (const buf of [m.inBuf, m.outBuf]) {
        for (const k of Object.keys(buf)) {
          if (rest <= 0) break;
          const val = Math.max(1, itemValue(k));
          const n = Math.min(buf[k], Math.ceil(rest / val));
          if (n <= 0) continue;
          buf[k] -= n; if (!buf[k]) delete buf[k];
          rest -= n * val; taxed += n;
        }
      }
    }
    fr.last = { ok: false, missing, paid, taxed, reward: 0 };
    this.emit({ type: 'toast', text: `Le train repart sans tout (${missing} manquants) : amende de ${fr.fine} pièces${taxed ? `, ${taxed} objets pris dans tes coffres` : ''}`, tone: 'warn' });
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






  get finalPalier(): boolean {
    return this.palier >= MAX_PALIER;
  }

  // ---------- Comptoir : commandes au choix, payées en pièces ----------

  private completeOrder(): void {
    const o = this.order!;
    this.order = null;
    this.ordersDone++;
    this.earned += o.money;
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

  /** Niveau le plus haut où l'on peut monter un tapis, une foreuse (selon l'arbre). */
  beltMaxLevel = RULES.beltBaseMax;
  drillMaxLevel = RULES.drillBaseMax;
  machineMaxLevel = RULES.machineBaseMax;

  /**
   * Monter tout un tapis d'un niveau : les cases du niveau le plus bas passent au suivant.
   * Renvoie le niveau visé, les cases concernées et le prix ; null si c'est le plus haut possible.
   */
  beltUpgrade(b: Belt): { from: number; to: number; cells: Belt[]; price: number; locked: boolean } | null {
    const chain = this.view.chainOf(b);
    const from = Math.min(...chain.map((c) => c.lvl ?? 1));
    if (from >= 5) return null;
    const to = from + 1;
    const cells = chain.filter((c) => (c.lvl ?? 1) < to);
    return { from, to, cells, price: cells.length * RULES.beltLevelCost[to - 1], locked: to > this.beltMaxLevel };
  }

  upgradeBelt(b: Belt): boolean {
    const up = this.beltUpgrade(b);
    if (!up) return false;
    if (up.locked) { this.emit({ type: 'toast', text: `Tapis niveau ${up.to} : à débloquer dans l’arbre (branche Niveaux)`, tone: 'warn' }); return false; }
    if (this.money < up.price) { this.emit({ type: 'toast', text: `Il faut ${up.price} pièces`, tone: 'warn' }); return false; }
    this.money -= up.price;
    for (const c of up.cells) c.lvl = up.to;
    this.emit({ type: 'money' });
    this.emit({ type: 'factory' });
    return true;
  }

  /**
   * Monter d'un niveau : tout un groupe de foreuses (celles du niveau le plus bas, jusqu'au 5),
   * ou une machine qui fabrique (jusqu'au 3, au prix de la machine puis du double).
   */
  drillUpgrade(m: Machine): { from: number; to: number; drills: Machine[]; price: number; locked: boolean } | null {
    const kind = machineDef(m.type).kind;
    if (kind === 'crafter') {
      const from = m.lvl ?? 1;
      if (from >= 3) return null;
      const to = from + 1;
      return { from, to, drills: [m], price: machineDef(m.type).cost * RULES.machineLevelCost[to - 1], locked: to > this.machineMaxLevel };
    }
    const group = this.view.drillGroup(m);
    if (!group.length) return null;
    const from = Math.min(...group.map((x) => x.lvl ?? 1));
    if (from >= 5) return null;
    const to = from + 1;
    const drills = group.filter((x) => (x.lvl ?? 1) < to);
    return { from, to, drills, price: drills.length * RULES.drillLevelCost[to - 1], locked: to > this.drillMaxLevel };
  }

  upgradeDrills(m: Machine): boolean {
    const up = this.drillUpgrade(m);
    if (!up) return false;
    if (up.locked) { this.emit({ type: 'toast', text: `Niveau ${up.to} : à débloquer dans l’arbre (branche Niveaux)`, tone: 'warn' }); return false; }
    if (this.money < up.price) { this.emit({ type: 'toast', text: `Il faut ${up.price} pièces`, tone: 'warn' }); return false; }
    this.money -= up.price;
    for (const x of up.drills) x.lvl = up.to;
    this.emit({ type: 'money' });
    this.emit({ type: 'factory' });
    return true;
  }

  /** Ce qu'on a payé pour les niveaux d'une foreuse ou d'une machine. */
  levelPaid(m: Machine): number {
    const def = machineDef(m.type);
    if (def.kind === 'crafter') return Game.levelValue(RULES.machineLevelCost.map((k) => k * def.cost), m.lvl);
    return def.kind === 'drill' ? Game.levelValue(RULES.drillLevelCost, m.lvl) : 0;
  }

  /** Ce qu'on a payé pour monter un tapis ou une foreuse jusqu'à son niveau (rendu quand on le supprime). */
  static levelValue(costs: number[], lvl: number | undefined): number {
    let v = 0;
    for (let i = 1; i < (lvl ?? 1); i++) v += costs[i];
    return v;
  }

  /** Chenilles : vitesse du robot (le meilleur niveau débloqué). */
  robotSpeedMult = 1;

  private applyUnlocks(): void {
    const speed = 1;
    let slots = RULES.chestSlots, copy = 1, size = 20, nest = false;
    let beltMax = RULES.beltBaseMax, drillMax = RULES.drillBaseMax, machineMax = RULES.machineBaseMax;
    this.robotSpeedMult = 1;
    for (const id of this.unlocks) {
      const e = NODE[id]?.effect;
      if (e?.kind === 'robotSpeed') this.robotSpeedMult = Math.max(this.robotSpeedMult, e.mult);
      if (e?.kind === 'beltLevel') beltMax = Math.max(beltMax, e.max);
      if (e?.kind === 'drillLevel') drillMax = Math.max(drillMax, e.max);
      if (e?.kind === 'machineLevel') machineMax = Math.max(machineMax, e.max);
      if (e?.kind === 'chestSlots') slots = Math.max(slots, e.slots);
      if (e?.kind === 'copyRate') copy = Math.min(copy, e.rate);
      if (e?.kind === 'atelierSize') size = Math.max(size, e.size);
      if (e?.kind === 'nesting') nest = true;
    }
    this.copyRate = copy;
    this.nesting = nest;
    this.beltMaxLevel = beltMax;
    this.drillMaxLevel = drillMax;
    this.machineMaxLevel = machineMax;
    if (size !== this.atelierSize) {
      this.atelierSize = size;
      // Les ateliers déjà posés s'agrandissent aussi.
      const grow = (f: Factory) => { for (const m of f.machines.values()) if (m.inner) { m.size = Math.max(m.size ?? 20, size); m.inner.bounds = m.size; grow(m.inner); } };
      grow(this.factory);
    }
    this.factory.speedMult = speed;
    this.factory.chestSlots = slots;
    this.factory.thirdOutput = this.unlocks.has('separateur2');
    this.factory.setElectric([...this.unlocks].flatMap((id) => { const e = NODE[id]?.effect; return e?.kind === 'electric' ? [e.id] : []; }));
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
    // Une seconde dérivation (de l'autre côté d'un séparateur) : le séparateur à 3 sorties.
    const third = !!split && split.from.split !== undefined && split.from.split !== split.dir;
    if (third && !this.isUnlocked('separateur2')) {
      this.emit({ type: 'toast', text: 'Séparateur à 3 sorties : à débloquer dans l’arbre (Logistique)', tone: 'warn' });
      return false;
    }
    if (!this.spend(cost)) return false;
    if (split && third) this.view.setSplit2(split.from, split.dir);
    else if (split) this.view.setSplit(split.from, split.dir, split.jump ?? 0);
    for (const c of cells) {
      if (c.existing) {
        const b = this.view.beltAt(c.x, c.y);
        if (b) {
          this.view.setBeltDir(b, c.dir);
          // Le bout d'un tapis existant peut devenir un pont (vers un tapis voisin à enjamber).
          if (c.jump) b.jump = Math.min(c.jump, RULES.bridgeSpan);
        }
      } else {
        const nb = this.view.addBelt(c.x, c.y, c.dir, c.inDir, true);
        if (c.jump) nb.jump = Math.min(c.jump, RULES.bridgeSpan);
        if (!this.inAtelier && this.world.reveal(c.x, c.y, 2)) this.emit({ type: 'reveal' });
      }
    }
    this.view.markBuilt();
    this.emit({ type: 'factory' });
    return true;
  }

  private refundBelt(b: Belt): number {
    this.view.removeBelt(b);
    const k = key(b.x, b.y);
    this.pending = this.pending.filter((j) => !(j.kind === 'belt' && j.k === k));
    return RULES.beltCost + (b.jump ? RULES.bridgeCost : 0) + (b.splitJump ? RULES.bridgeCost : 0)
      + (b.meter ? MACHINES.compteur.cost : 0) + Game.levelValue(RULES.beltLevelCost, b.lvl);
  }

  /** Supprime ce qui se trouve sur une case. Renvoie vrai si quelque chose a été supprimé. */
  /** Recette prévue d'une machine (pour les débits attendus) ; undefined = rien de prévu. La machine reste en auto. */
  setPlan(m: Machine, ri: number | undefined): void {
    if (ri === undefined) delete m.plan; else m.plan = ri;
    this.emit({ type: 'factory' });
  }

  /** Prévoit une entrée ou une sortie sur un côté d'une machine (case dehors, sans la prendre). */
  addPort(m: Machine, x: number, y: number, io: 'in' | 'out', item?: string): boolean {
    if (!this.view.perimeter(m).some((c) => c.x === x && c.y === y)) return false;
    const rx = x - m.x, ry = y - m.y;
    const ports = (m.ports ??= []);
    // Une seule chose par emplacement : on remplace ce qui y était.
    const i = ports.findIndex((p) => p.rx === rx && p.ry === ry);
    if (i >= 0) ports.splice(i, 1);
    // Le même objet n'est prévu qu'à un endroit : on le déplace.
    if (item) { const j = ports.findIndex((p) => p.io === io && p.item === item); if (j >= 0) ports.splice(j, 1); }
    ports.push({ rx, ry, io, ...(item ? { item } : {}) });
    const k = key(x, y);
    if (m.seenIn) delete m.seenIn[k];
    if (m.seenOut) delete m.seenOut[k];
    this.emit({ type: 'factory' });
    return true;
  }

  /**
   * Déplace une entrée ou une sortie prévue vers un autre endroit du bord ;
   * celle qui s'y trouvait prend la place laissée.
   */
  movePort(m: Machine, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
    const per = this.view.perimeter(m);
    if (!per.some((c) => c.x === to.x && c.y === to.y) || (from.x === to.x && from.y === to.y)) return false;
    const ports = m.ports ?? [];
    const at = (c: { x: number; y: number }) => ports.find((q) => m.x + q.rx === c.x && m.y + q.ry === c.y);
    const src = at(from), dst = at(to);
    if (!src) return false;
    src.rx = to.x - m.x; src.ry = to.y - m.y;
    if (dst) { dst.rx = from.x - m.x; dst.ry = from.y - m.y; }
    for (const c of [from, to]) { const k = key(c.x, c.y); if (m.seenIn) delete m.seenIn[k]; if (m.seenOut) delete m.seenOut[k]; }
    this.emit({ type: 'factory' });
    return true;
  }

  removePort(m: Machine, i: number): void {
    if (!m.ports?.[i]) return;
    m.ports.splice(i, 1);
    if (!m.ports.length) delete m.ports;
    this.emit({ type: 'factory' });
  }



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
      this.earn(this.refundBelt(b));
      n++;
    }
    for (const m of machines) if (this.view.machines.has(m.id) && this.removeMachine(m)) n++;
    for (const c of cables) if (this.view.removeCable(c.x, c.y)) { this.earn(RULES.cableCost); n++; }
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { if (this.view.removePipe(x, y)) { this.earn(RULES.pipeCost); n++; } }
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

  /** Ajoute un arrêt à une ligne (6 au plus). */
  addStop(lineId: number, m: Machine): boolean {
    const l = this.factory.lines.get(lineId);
    if (!l || l.stops.length >= RULES.maxStops || this.stationKind(m) !== l.kind || l.stops.some((st) => st.id === m.id)) return false;
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
    st.take = load ? 'all' : 'none';
    st.drop = load ? 'none' : 'all';
    this.emit({ type: 'factory' });
  }

  /** Ce qu'un véhicule prend (take) ou dépose (drop) à un arrêt : rien, tout, ou certains objets. */
  setStopRule(lineId: number, i: number, which: 'take' | 'drop', rule: StopRule): void {
    const st = this.factory.lines.get(lineId)?.stops[i];
    if (!st) return;
    const r = stopRules(st);
    st.take = r.take; st.drop = r.drop;
    st[which] = Array.isArray(rule) ? (rule.length ? [...rule] : 'none') : rule;
    st.load = st.take !== 'none';
    this.emit({ type: 'factory' });
  }

  /** Retire un arrêt d'une ligne (il en reste au moins deux ; la route en trop est remboursée). */
  removeStop(lineId: number, i: number): boolean {
    const l = this.factory.lines.get(lineId);
    if (!l || l.stops.length <= 2 || !l.stops[i]) return false;
    const before = this.factory.lineLength(l);
    l.stops.splice(i, 1);
    for (const v of l.vehicles) { v.at = Math.min(v.at, l.stops.length - 1); v.pos = 0; v.moving = false; v.t = 0; }
    this.earn(this.trackPrice(l.kind, Math.max(0, before - this.factory.lineLength(l))));
    this.emit({ type: 'factory' });
    return true;
  }

  /** Ferme une ligne (route et véhicules remboursés). */
  removeLine(id: number): void {
    const l = this.factory.lines.get(id);
    if (!l) return;
    this.earn(this.linePrice(l));
    this.factory.removeLine(id);
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
      this.emit({ type: 'toast', text: `${def.name} reste en place`, tone: 'warn' });
      return false;
    }
    if (def.gift) {
      this.emit({ type: 'toast', text: `${def.name} : un cadeau du Noyau. On peut le déplacer, pas le supprimer.`, tone: 'info' });
      return false;
    }
    for (const l of this.view.linesOf(m)) this.earn(this.linePrice(l));
    this.view.removeMachine(m);
    this.pending = this.pending.filter((j) => !(j.kind === 'machine' && j.id === m.id));
    // Un atelier rend aussi ce qu'il contient (ce qui y circulait est perdu).
    this.earn(def.cost + (m.inner ? this.contentValue(m.inner) : 0) + this.levelPaid(m));
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
    // Au milieu d'un tapis qui continue, c'est une dérivation : il faut le Séparateur (et le Séparateur à 3 sorties pour les deux côtés).
    const ax = b.x + DX[b.dir], ay = b.y + DY[b.dir];
    const continues = !!this.view.beltAt(ax, ay) || !!this.view.machineAt(ax, ay) || b.split !== undefined;
    if (continues && !this.isUnlocked('separateur')) {
      this.emit({ type: 'toast', text: 'Nourrir une machine depuis le milieu d’un tapis : débloque le Séparateur (Logistique)', tone: 'warn' });
      return false;
    }
    if (b.split !== undefined && !this.isUnlocked('separateur2')) {
      this.emit({ type: 'toast', text: 'Nourrir les deux côtés : débloque le Séparateur à 3 sorties (Logistique)', tone: 'warn' });
      return false;
    }
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

  /** La base du robot (bâtiment unique, sur la carte), si elle est posée. */
  get robotBase(): Machine | null {
    for (const m of this.factory.machines.values()) if (m.type === 'base_robot' && m.built) return m;
    return null;
  }

  /** Distance du robot à sa base, en cases (null sans base). */
  baseDistance(): number | null {
    const b = this.robotBase;
    if (!b) return null;
    const p = this.baseSpot(b);
    return Math.hypot(p.x - this.robot.x, p.y - this.robot.y);
  }

  /** Où le robot apparaît : juste sous la base, au milieu. */
  private baseSpot(b: Machine): { x: number; y: number } {
    return { x: b.x + b.w / 2, y: b.y + b.h + 1.2 };
  }

  /** « Retour à la base » : le robot se téléporte à côté de sa base, d'où qu'il soit. */
  teleportRobot(): boolean {
    const b = this.robotBase;
    if (!b) {
      this.emit({ type: 'toast', text: this.hasMachine('base_robot') ? 'Pose d’abord la Base du robot' : 'Base du robot : à débloquer dans l’arbre (Robot, palier 5)', tone: 'warn' });
      return false;
    }
    const r = this.robot, from = { x: r.x, y: r.y };
    const p = this.baseSpot(b);
    r.x = p.x; r.y = p.y; r.target = null; r.manual = false; r.moving = false;
    this.revealRobot(true);
    this.emit({ type: 'teleport', fromX: from.x, fromY: from.y });
    return true;
  }

  private revealRobot(force = false): void {
    const cx = Math.floor(this.robot.x), cy = Math.floor(this.robot.y);
    const id = `${cx},${cy}`;
    if (!force && id === this.lastRobotCell) return;
    this.lastRobotCell = id;
    if (this.world.reveal(cx, cy, RULES.revealRobot)) this.emit({ type: 'reveal' });
  }



  /** Le robot se déplace où on l'envoie (il ne construit plus, ne mine plus, ne porte plus rien). */
  private tickRobot(dt: number): void {
    const r = this.robot;
    if (r.target) {
      const dx = r.target.x - r.x, dy = r.target.y - r.y;
      const d = Math.hypot(dx, dy);
      const step = RULES.robotSpeed * this.robotSpeedMult * dt;
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
  }

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

  /** Le temps qu'il fait : un temps tiré de la graine toutes les 200 secondes (clair le plus souvent). */
  get weather(): 'clair' | 'pluie' | 'neige' {
    const seg = Math.floor(this.played / RULES.weatherSpan);
    if (seg < 1) return 'clair';
    const r = (((Math.sin(seg * 127.1 + (this.world.seedNum % 1000) * 3.7) * 43758.5453) % 1) + 1) % 1;
    return r < 0.62 ? 'clair' : r < 0.87 ? 'pluie' : 'neige';
  }


  /** Succès obtenus. */
  achievements = new Set<string>();
  private achT = 0;

  /** Juste après un chargement : les succès déjà mérités se cochent sans annonce. */
  private achQuiet = false;

  private checkAchievements(): void {
    const quiet = this.achQuiet;
    this.achQuiet = false;
    for (const a of ACHIEVEMENTS) {
      if (this.achievements.has(a.id)) continue;
      let ok = false;
      try { ok = a.test(this); } catch { ok = false; }
      if (!ok) continue;
      this.achievements.add(a.id);
      if (!quiet) {
        this.emit({ type: 'toast', text: `Succès : ${a.name} · nouveau skin : ${skinOf(a.skin).name}`, tone: 'good' });
        this.emit({ type: 'achievement', id: a.id });
      }
    }
  }

  /** Le robot peut porter ce skin (le Boulon d'origine est offert, les autres se gagnent). */
  ownsSkin(id: string): boolean {
    if (!SKIN[id]) return false;
    const a = ACHIEVEMENT_OF_SKIN[id];
    return !a || this.achievements.has(a.id);
  }

  /** Change le skin du robot (s'il est gagné). */
  setSkin(id: string): boolean {
    if (!this.ownsSkin(id)) return false;
    this.look = { ...this.look, skin: id };
    this.emit({ type: 'look' });
    return true;
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
  setBeltFilter(b: Belt, item: string | null, which: 1 | 2 = 1): boolean {
    if (!this.isUnlocked('tri') || b.split === undefined) return false;
    if (which === 2) {
      if (!this.isUnlocked('tri2') || b.split2 === undefined) return false;
      if (item) b.filter2 = item; else delete b.filter2;
    } else if (item) b.filter = item; else delete b.filter;
    this.view.markBuilt();
    this.emit({ type: 'factory' });
    return true;
  }

  tick(dt: number): void {
    this.time += dt;
    this.played += dt;
    if (this.freight) this.stepFreight(dt);
    const light = this.daylight;
    this.factory.daylight = light;
    const night = light < 0.5;
    if (this.wasNight !== null && night !== this.wasNight && this.hasMachine('solaire') && [...this.factory.machines.values()].some((m) => m.type === 'solaire')) {
      this.emit({ type: 'toast', text: night ? 'La nuit tombe : les panneaux solaires s’arrêtent, les batteries prennent le relais' : 'Le jour se lève : les panneaux solaires repartent', tone: 'info' });
    }
    this.wasNight = night;
    // Météo : la pluie ralentit les camions, la neige (et un peu la pluie) voile le soleil.
    const w = this.weather;
    this.factory.truckMult = w === 'pluie' ? RULES.rainTruck : w === 'neige' ? 0.85 : 1;
    this.factory.solarMult = w === 'neige' ? RULES.snowSolar : w === 'pluie' ? 0.8 : 1;
    this.achT += dt;
    if (this.achT > 2) { this.achT = 0; this.checkAchievements(); }
    this.statT += dt;
    if (this.statT >= 10 || !this.statHistory.length) {
      this.statT = 0;
      this.statHistory.push({ t: this.played, made: { ...this.factory.stats.made } });
      if (this.statHistory.length > 61) this.statHistory.shift();
    }
    this.tickRobot(dt);
    this.factory.tick(dt);
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
      unlocks: [...this.unlocks],
      palier: this.palier, palierDone: this.palierDone, lab: this.lab,
      look: this.look, tips: this.tips, played: Math.floor(this.played),
      gifts: this.gifts, ordersDone: this.ordersDone, earned: this.earned,
      stats: this.factory.stats, achievements: [...this.achievements], rockets: this.rockets,
      ...(this.freight ? { freight: { ...this.freight, req: { ...this.freight.req } } } : {}),
    };
  }

  private load(s: GameSave): void {
    this.money = s.money;
    this.robot.x = s.robot.x; this.robot.y = s.robot.y;
    this.world.loadFog(s.fog);
    this.factory.load(s.factory);
    // Ce qui a été retiré du jeu (tapis souterrains) est remboursé.
    this.money += this.factory.legacyRefund;
    if (s.stats) { this.factory.stats.made = { ...s.stats.made }; this.factory.stats.used = { ...s.stats.used }; }
    for (const id of s.achievements ?? []) this.achievements.add(OLD_ACHIEVEMENTS[id] ?? id);
    // Les anciens succès sans skin (premier lingot, plaques, camions…) disparaissent.
    for (const id of [...this.achievements]) if (!ACHIEVEMENTS.some((a) => a.id === id)) this.achievements.delete(id);
    this.achQuiet = true;
    this.rockets = s.rockets ?? 0;
    if (s.freight) { this.freight = { ...s.freight, req: { ...s.freight.req } }; this.quai(true); }
    // Les chantiers d'une ancienne partie se terminent tout de suite (plus de drones pour les construire).
    for (const j of s.pending ?? []) {
      if (j.kind === 'belt') { const b = this.factory.belts.get(j.k); if (b) b.built = true; }
      else { const m = this.factory.machines.get(j.id); if (m) m.built = true; }
    }
    for (const b of this.factory.belts.values()) b.built = true;
    for (const m of this.factory.machines.values()) m.built = true;
    this.factory.markBuilt();
    this.pending = [];
    this.order = s.order; this.choices = s.choices;
    this.orderSeq = s.orderSeq; this.rerolls = s.rerolls; this.delivered = s.delivered ?? 0;
    if (this.order) { this.order.xp = 0; delete this.order.equip; }
    this.look = cleanLook(s.look);
    // Les parties d'avant les conseils n'en reçoivent pas.
    this.tips = s.tips ? { done: [...(s.tips.done ?? [])], off: !!s.tips.off } : { done: [], off: true };
    this.played = s.played ?? 0;
    this.ordersDone = s.ordersDone ?? 0;
    // Avant le compteur : on part de l'argent en poche (au moins ce qui a été gagné).
    this.earned = s.earned ?? Math.max(0, Math.floor(s.money) - RULES.startMoney);
    if (!this.ownsSkin(this.look.skin)) this.look = { ...this.look, skin: 'origine' };
    this.gifts = { ...(s.gifts ?? {}) };
    // Déjà posés avant les cadeaux : ils comptent comme offerts.
    for (const m of this.factory.machines.values()) if ((m.type === 'comptoir' || m.type === 'laboratoire') && this.gifts[m.type] === undefined) this.gifts[m.type] = 0;
    if (s.v >= 4) {
      this.palier = s.palier ?? 1;
      this.palierDone = s.palierDone ?? {};
      this.lab = s.lab ?? {};
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
    }
    // La Grande foreuse est devenue « Forage profond » (foreuses jusqu'au niveau 5).
    if (this.unlocks.delete('super_foreuse')) this.unlocks.add('forage');
    // Un déblocage acquis emporte ceux qui le précèdent (les niveaux de tapis et de foreuses ont maintenant leurs étapes).
    for (let changed = true; changed;) {
      changed = false;
      for (const x of ALL_NODES) if (this.unlocks.has(x.id)) for (const pa of x.parents) if (!this.unlocks.has(pa) && NODE[pa]) { this.unlocks.add(pa); changed = true; }
    }
    // Les déblocages retirés du jeu (tapis souterrains) disparaissent de la partie.
    for (const id of [...this.unlocks]) if (!NODE[id]) this.unlocks.delete(id);
    this.applyUnlocks();
    // Partie d'avant les niveaux de tapis : la vitesse débloquée pour tous devient le niveau de chaque tapis.
    if (!s.factory.levels) {
      const lvl = this.unlocks.has('express') ? 5 : this.unlocks.has('rapide') ? 3 : 1;
      const raise = (f: Factory) => { for (const b of f.belts.values()) b.lvl = Math.max(b.lvl ?? 1, lvl); for (const m of f.machines.values()) if (m.inner) raise(m.inner); };
      if (lvl > 1) raise(this.factory);
    }
  }

  /** Résumé lisible d'une commande (« 20 plaques de fer »). */
  static orderTitle(o: Order): string {
    return o.lines.map((l) => itemLabel(l.item, l.qty)).join(' et ');
  }
}

export { unkey };
