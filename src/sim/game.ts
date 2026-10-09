// L'état complet d'une partie : monde, usine, robot, drones, argent, paliers, laboratoire et commandes.
import { RULES } from '../config.ts';
import { machineDef } from '../data/machines.ts';
import { itemLabel } from '../data/items.ts';
import { World } from '../world/world.ts';
import { Factory, type Belt, type FactorySave, type Machine } from './factory.ts';
import { key, unkey, type Dir } from './geom.ts';
import { firstOrder, generateChoices, orderComplete, type Order } from './orders.ts';
import type { TraceCell } from './tracer.ts';
import { Inventory, type Slot } from './inventory.ts';
import { RICHNESS_RATE } from '../world/world.ts';
import { ALL_NODES, BASE_UNLOCKS, LAB_ITEMS, NODE, nodeForMachine, type UnlockNode } from '../data/unlocks.ts';
import { MAX_PALIER, palierMission } from '../data/paliers.ts';
import { cleanLook, DEFAULT_LOOK, type RobotLook } from '../data/look.ts';

/** Ce qu'un drone fait en premier ; ensuite il fait le reste dans l'ordre habituel. */
export type DronePriority = 'carburant' | 'chantiers' | 'noyau' | 'laboratoire' | 'comptoir' | 'robot';
export const DRONE_PRIORITIES: { id: DronePriority; label: string }[] = [
  { id: 'carburant', label: 'Recharger le charbon' },
  { id: 'chantiers', label: 'Construire' },
  { id: 'noyau', label: 'Livrer le Noyau' },
  { id: 'laboratoire', label: 'Livrer le Laboratoire' },
  { id: 'comptoir', label: 'Livrer le Comptoir' },
  { id: 'robot', label: 'Distribuer le minerai du robot' },
];
const DEFAULT_ORDER: DronePriority[] = DRONE_PRIORITIES.map((p) => p.id);

export type Job = { kind: 'belt'; k: number } | { kind: 'machine'; id: number };

/** D'où un drone prend un objet : l'inventaire du robot ou un coffre. */
export type Source = { kind: 'robot' } | { kind: 'chest'; id: number };

export type DroneTask =
  | { kind: 'build'; job: Job }
  /** Prendre un objet ; `self` : remplir sa propre case carburant. */
  | { kind: 'fetch'; from: Source; item: string; self?: boolean }
  /** Recharger une machine en charbon. */
  | { kind: 'refuel'; id: number }
  /** Déposer la cargaison (minerai du robot) dans une machine ou un coffre. */
  | { kind: 'deliver'; id: number };

export interface Drone {
  x: number;
  y: number;
  /** home : en vol stationnaire près du robot ; fly : en mission ; parked : posé sur le robot, sans charbon. */
  state: 'home' | 'fly' | 'work' | 'parked';
  task: DroneTask | null;
  t: number;
  /** Angle de rangement autour du robot. */
  slot: number;
  /** Case carburant (0 à 10) et secondes restantes du charbon en cours. */
  fuel: number;
  burn: number;
  /** Une case d'inventaire. */
  cargo: Slot | null;
  /** Sa tâche principale. */
  priority: DronePriority;
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
  | { type: 'drones' }
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
  /** Charbon et inventaires du robot et des drones (depuis la version 2). */
  crew?: {
    robot: { fuel: number; burn: number; inv: (Slot | null)[] };
    drones: { fuel: number; burn: number; cargo: Slot | null; priority?: DronePriority }[];
  };
}

export class Game {
  readonly world: World;
  readonly factory: Factory;
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
    this.factory.buildingAccepts = (m, item) => this.accepts(m, item) > 0;
    if (save) {
      this.load(save);
      this.noyau = [...this.factory.machines.values()].find((m) => m.type === 'noyau')!;
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
      this.drones.push({ x: this.robot.x, y: this.robot.y - 1, state: 'home', task: null, t: 0, slot: 0, fuel: RULES.fuelStack, burn: 0, cargo: null, priority: 'carburant' });
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
  labNeeds(): Record<string, number> {
    const want: Record<string, number> = {};
    for (const x of ALL_NODES) {
      if (this.nodeState(x) !== 'available') continue;
      for (const [k, v] of Object.entries(x.cost)) want[k] = Math.max(want[k] ?? 0, v);
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
    if (m.type === 'laboratoire') return LAB_ITEMS.has(item) ? Math.max(0, RULES.labCap - (this.lab[item] ?? 0)) : 0;
    return 0;
  }

  /** Un bâtiment reçoit des objets (par tapis ou par drone). Renvoie le nombre accepté. */
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

  get finalPalier(): boolean {
    return this.palier >= MAX_PALIER;
  }

  // ---------- Comptoir : commandes au choix, payées en pièces ----------

  private completeOrder(): void {
    const o = this.order!;
    this.order = null;
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

  private applyUnlocks(): void {
    let speed = 1, slots = RULES.chestSlots;
    for (const id of this.unlocks) {
      const e = NODE[id]?.effect;
      if (e?.kind === 'beltSpeed') speed = Math.max(speed, e.mult);
      if (e?.kind === 'chestSlots') slots = Math.max(slots, e.slots);
    }
    this.factory.speedMult = speed;
    this.factory.chestSlots = slots;
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
    this.emit({ type: 'order' });
    return { away, counted, gained };
  }

  // ---------- Construction ----------

  placeMachine(type: string, x: number, y: number): Machine | null {
    const def = machineDef(type);
    if (!this.hasMachine(type)) {
      this.emit({ type: 'toast', text: `${def.name} : à débloquer dans l’arbre`, tone: 'warn' });
      return null;
    }
    if (def.unique && [...this.factory.machines.values()].some((m) => m.type === type)) {
      this.emit({ type: 'toast', text: `Un seul ${def.name.toLowerCase()} par partie`, tone: 'warn' });
      return null;
    }
    const check = this.factory.checkMachine(type, x, y);
    if (!check.ok) {
      this.emit({ type: 'toast', text: check.reason ?? 'Impossible ici', tone: 'warn' });
      return null;
    }
    if (!this.spend(def.cost)) return null;
    const m = this.factory.addMachine(type, x, y, false);
    this.pending.push({ kind: 'machine', id: m.id });
    this.emit({ type: 'factory' });
    return m;
  }

  placeBelts(cells: TraceCell[], split?: { from: Belt; dir: Dir }): boolean {
    const fresh = cells.filter((c) => !c.existing);
    const cost = fresh.length * RULES.beltCost;
    if (fresh.length === 0) return false;
    if (split && !this.isUnlocked('separateur')) {
      this.emit({ type: 'toast', text: 'Séparateur : à débloquer dans l’arbre (Logistique)', tone: 'warn' });
      return false;
    }
    if (!this.spend(cost)) return false;
    if (split) this.factory.setSplit(split.from, split.dir);
    for (const c of cells) {
      if (c.existing) {
        const b = this.factory.beltAt(c.x, c.y);
        if (b) this.factory.setBeltDir(b, c.dir);
      } else {
        this.factory.addBelt(c.x, c.y, c.dir, c.inDir, false);
        this.pending.push({ kind: 'belt', k: key(c.x, c.y) });
      }
    }
    this.emit({ type: 'factory' });
    return true;
  }

  private refundBelt(b: Belt): number {
    this.factory.removeBelt(b);
    const k = key(b.x, b.y);
    this.pending = this.pending.filter((j) => !(j.kind === 'belt' && j.k === k));
    return RULES.beltCost;
  }

  /** Supprime ce qui se trouve sur une case. Renvoie vrai si quelque chose a été supprimé. */
  removeAt(x: number, y: number): boolean {
    const b = this.factory.beltAt(x, y);
    if (b) {
      this.earn(this.refundBelt(b));
      this.emit({ type: 'factory' });
      return true;
    }
    const m = this.factory.machineAt(x, y);
    if (m) return this.removeMachine(m);
    return false;
  }

  removeMachine(m: Machine): boolean {
    const def = machineDef(m.type);
    if (!def.buildable) {
      this.emit({ type: 'toast', text: 'Le Noyau reste en place', tone: 'warn' });
      return false;
    }
    this.factory.removeMachine(m);
    this.pending = this.pending.filter((j) => !(j.kind === 'machine' && j.id === m.id));
    this.earn(def.cost);
    this.emit({ type: 'factory' });
    return true;
  }

  removeChain(b: Belt): void {
    let refund = 0;
    for (const c of this.factory.chainOf(b)) refund += this.refundBelt(c);
    this.earn(refund);
    this.emit({ type: 'factory' });
  }

  moveMachine(m: Machine, x: number, y: number): boolean {
    const ok = this.factory.moveMachine(m, x, y);
    if (!ok) this.emit({ type: 'toast', text: 'Impossible ici', tone: 'warn' });
    else { this.world.reveal(x + 1, y + 1, RULES.revealBuilding); this.emit({ type: 'factory' }); }
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
    // Le robot remplit sa case carburant avec le charbon de son inventaire.
    if (r.fuel < RULES.fuelStack) r.fuel += r.inv.take('charbon', RULES.fuelStack - r.fuel);
    if (!r.active) return r.burn > 0 || r.fuel > 0;
    if (r.burn <= 0) {
      if (r.fuel <= 0) return false;
      r.fuel--;
      r.burn += RULES.coalRobotSeconds;
    }
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
      const step = RULES.robotSpeed * dt * power;
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
      if (p && r.inv.room(p.type) > 0) {
        r.mining = p.type;
        r.active = true;
        r.mineT += dt * power * RULES.robotMineRate * RICHNESS_RATE[p.richness];
        if (r.mineT >= 1) {
          r.mineT -= 1;
          r.inv.add(p.type, 1);
          r.mined++;
        }
      }
    }
  }

  // ---------- Drones ----------

  private droneJobs(): Set<Job> {
    const s = new Set<Job>();
    for (const d of this.drones) if (d.task?.kind === 'build') s.add(d.task.job);
    return s;
  }

  private near(p: { x: number; y: number }, range = RULES.buildRange): boolean {
    return Math.hypot(p.x - this.robot.x, p.y - this.robot.y) <= range;
  }

  private center(m: Machine): { x: number; y: number } {
    return { x: m.x + m.w / 2, y: m.y + m.h / 2 };
  }

  /** Les bâtiments qui reçoivent, s'ils existent. */
  private building(type: 'noyau' | 'laboratoire' | 'comptoir'): Machine | null {
    for (const m of this.factory.machines.values()) if (m.type === type && m.built) return m;
    return null;
  }

  /** La source la plus proche du drone pour un objet : un coffre à portée ou l'inventaire du robot. */
  private sourceFor(d: Drone, item: string): Source | null {
    let best: Source | null = null, bd = Infinity;
    if (this.robot.inv.count(item) > 0) {
      best = { kind: 'robot' };
      bd = Math.hypot(this.robot.x - d.x, this.robot.y - d.y);
    }
    for (const m of this.factory.machines.values()) {
      if (m.type !== 'coffre' || !m.built || !(m.inBuf[item] > 0)) continue;
      const c = this.center(m);
      if (!this.near(c, RULES.supplyRange)) continue;
      const dist = Math.hypot(c.x - d.x, c.y - d.y);
      if (dist < bd) { bd = dist; best = { kind: 'chest', id: m.id }; }
    }
    return best;
  }

  /** La machine à portée la plus proche du robot qui accepte cet objet ; sinon le coffre le plus proche. */
  private destinationFor(item: string, chestOk = true): Machine | null {
    let best: Machine | null = null, bd = Infinity;
    let chest: Machine | null = null, cd = Infinity;
    for (const m of this.factory.machines.values()) {
      if (!m.built) continue;
      const c = this.center(m);
      const d = Math.hypot(c.x - this.robot.x, c.y - this.robot.y);
      if (d > RULES.supplyRange) continue;
      const def = machineDef(m.type);
      if (def.kind === 'crafter' && item !== 'charbon' && this.factory.canAccept(m, item)) {
        if (d < bd) { bd = d; best = m; }
      } else if (chestOk && def.kind === 'storage' && this.factory.storageRoom(m, item) > 0 && d < cd) {
        cd = d; chest = m;
      }
    }
    return best ?? chest;
  }

  /** Ce qui manque à un bâtiment, et le bâtiment lui-même. */
  private needsOf(cat: 'noyau' | 'laboratoire' | 'comptoir'): { m: Machine; needs: Record<string, number> } | null {
    const m = this.building(cat);
    if (!m) return null;
    const needs = cat === 'noyau' ? this.noyauNeeds() : cat === 'laboratoire' ? this.labNeeds() : this.comptoirNeeds();
    return Object.keys(needs).length ? { m, needs } : null;
  }

  private pickTask(d: Drone): DroneTask | null {
    const others = this.drones.filter((o) => o !== d && o.task);
    const reservedFuel = new Set(others.map((o) => (o.task!.kind === 'refuel' ? o.task!.id : -1)));

    // Son propre carburant d'abord, toujours.
    if (d.fuel <= 3) {
      const src = this.sourceFor(d, 'charbon');
      if (src) return { kind: 'fetch', from: src, item: 'charbon', self: true };
    }
    // Machines à portée qui ont besoin de charbon, la plus vide d'abord.
    const needy = [...this.factory.machines.values()]
      .filter((m) => m.built && this.factory.fuelRoom(m) > 0 && !reservedFuel.has(m.id) && this.near(this.center(m), RULES.supplyRange))
      .sort((a, b) => a.fuel - b.fuel);
    const order = [d.priority, ...DEFAULT_ORDER.filter((p) => p !== d.priority)];
    const cargo = d.cargo;

    // 1. Avec une cargaison : la livrer là où elle sert, dans l'ordre des priorités.
    if (cargo) {
      for (const cat of order) {
        if (cat === 'carburant') {
          if (cargo.t === 'charbon' && needy[0]) return { kind: 'refuel', id: needy[0].id };
          if (cargo.t === 'charbon' && d.priority === 'carburant' && cargo.n < RULES.invStack) {
            const src = this.sourceFor(d, 'charbon');
            if (src) return { kind: 'fetch', from: src, item: 'charbon' };
          }
        } else if (cat === 'chantiers') {
          const job = this.freeJob();
          if (job) return { kind: 'build', job };
        } else if (cat === 'robot') {
          if (cargo.t !== 'charbon') {
            const dest = this.destinationFor(cargo.t, false);
            if (dest) return { kind: 'deliver', id: dest.id };
          }
        } else {
          const nb = this.needsOf(cat);
          if (nb && nb.needs[cargo.t]) return { kind: 'deliver', id: nb.m.id };
        }
      }
      // Personne n'en veut : on la range dans un coffre (sauf le charbon d'un drone ravitailleur).
      if (!(cargo.t === 'charbon' && d.priority === 'carburant')) {
        const dest = this.destinationFor(cargo.t);
        if (dest) return { kind: 'deliver', id: dest.id };
      }
      return null;
    }

    // 2. Les mains vides : la première tâche utile dans l'ordre des priorités.
    for (const cat of order) {
      if (cat === 'carburant') {
        if (needy.length || d.priority === 'carburant') {
          const src = this.sourceFor(d, 'charbon');
          if (src) return { kind: 'fetch', from: src, item: 'charbon' };
        }
      } else if (cat === 'chantiers') {
        const job = this.freeJob();
        if (job) return { kind: 'build', job };
      } else if (cat === 'robot') {
        for (const t of this.robot.inv.kinds()) {
          if (t !== 'charbon' && this.destinationFor(t, false)) return { kind: 'fetch', from: { kind: 'robot' }, item: t };
        }
      } else {
        const nb = this.needsOf(cat);
        if (!nb) continue;
        for (const item of Object.keys(nb.needs)) {
          const src = this.sourceFor(d, item);
          if (src) return { kind: 'fetch', from: src, item };
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
    if (t.kind === 'fetch' && t.from.kind === 'robot') return { x: this.robot.x, y: this.robot.y - 0.6 };
    const id = t.kind === 'fetch' ? (t.from as { id: number }).id : t.id;
    const m = this.factory.machines.get(id);
    return m && m.built ? this.center(m) : null;
  }

  private doTask(d: Drone, t: DroneTask): void {
    const f = this.factory;
    if (t.kind === 'fetch') {
      const take = (n: number): number => {
        if (n <= 0) return 0;
        if (t.from.kind === 'robot') return this.robot.inv.take(t.item, n);
        const m = f.machines.get(t.from.id);
        return m ? f.takeFromStorage(m, t.item, n) : 0;
      };
      if (t.self) d.fuel += take(RULES.fuelStack - d.fuel);
      if (!d.cargo || d.cargo.t === t.item) {
        const got = take(RULES.invStack - (d.cargo?.n ?? 0));
        if (got > 0) d.cargo = { t: t.item, n: (d.cargo?.n ?? 0) + got };
      }
    } else if (t.kind === 'refuel' && d.cargo?.t === 'charbon') {
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
  }

  setDronePriority(i: number, p: DronePriority): void {
    const d = this.drones[i];
    if (!d) return;
    d.priority = p;
    d.task = null;
    if (d.state === 'fly') d.state = 'home';
  }

  /** Le drone brûle du charbon en vol ; faux s'il n'en a plus. */
  private droneFuel(d: Drone, dt: number): boolean {
    if (d.burn <= 0) {
      if (d.fuel <= 0) return false;
      d.fuel--;
      d.burn += RULES.coalDroneSeconds;
    }
    d.burn -= dt;
    return true;
  }

  private tickDrones(dt: number): void {
    const r = this.robot;
    for (const d of this.drones) {
      const home = { x: r.x + Math.cos(d.slot + this.time * 0.8) * 1.1, y: r.y - 1.4 + Math.sin(d.slot + this.time * 0.8) * 0.35 };
      if (d.state === 'parked') {
        // Posé sur le robot : il repart dès que le robot a du charbon à lui donner.
        d.x = r.x; d.y = r.y - 0.9;
        const got = r.inv.take('charbon', RULES.fuelStack - d.fuel);
        if (got > 0) { d.fuel += got; d.state = 'home'; }
        continue;
      }
      if (d.task && !this.taskPos(d.task)) d.task = null;
      if (!d.task && d.state !== 'work') d.task = this.pickTask(d);
      const target = d.task ? this.taskPos(d.task)! : home;
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
        d.state = 'home';
        d.x = home.x; d.y = home.y;
      }
      if (d.task && Math.hypot(target.x - d.x, target.y - d.y) < 0.05) {
        if (d.task.kind === 'build') { d.state = 'work'; d.t = 0; }
        else { this.doTask(d, d.task); d.task = null; d.state = 'home'; }
      }
    }
  }

  tick(dt: number): void {
    this.time += dt;
    this.played += dt;
    this.tickRobot(dt);
    this.tickDrones(dt);
    this.factory.tick(dt);
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
      look: this.look, tips: this.tips, played: Math.floor(this.played),
      crew: {
        robot: { fuel: r.fuel, burn: r.burn, inv: r.inv.save() },
        drones: this.drones.map((d) => ({ fuel: d.fuel, burn: d.burn, cargo: d.cargo ? { ...d.cargo } : null, priority: d.priority })),
      },
    };
  }

  private load(s: GameSave): void {
    this.money = s.money;
    this.robot.x = s.robot.x; this.robot.y = s.robot.y;
    this.world.loadFog(s.fog);
    this.factory.load(s.factory);
    this.pending = s.pending.filter((j) => (j.kind === 'belt' ? this.factory.belts.has(j.k) : this.factory.machines.has(j.id)));
    this.order = s.order; this.choices = s.choices;
    this.orderSeq = s.orderSeq; this.rerolls = s.rerolls; this.delivered = s.delivered ?? 0;
    if (this.order) { this.order.xp = 0; delete this.order.equip; }
    this.look = cleanLook(s.look);
    // Les parties d'avant les conseils n'en reçoivent pas.
    this.tips = s.tips ? { done: [...(s.tips.done ?? [])], off: !!s.tips.off } : { done: [], off: true };
    this.played = s.played ?? 0;
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
      r.fuel = s.crew.robot.fuel; r.burn = s.crew.robot.burn; r.inv.load(s.crew.robot.inv);
      s.crew.drones.forEach((sd, i) => {
        const d = this.drones[i];
        if (d) { d.fuel = sd.fuel; d.burn = sd.burn; d.cargo = sd.cargo ? { ...sd.cargo } : null; d.priority = sd.priority ?? 'carburant'; }
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
