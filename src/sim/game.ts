// L'état complet d'une partie : monde, usine, robot, drones, argent, XP et commandes.
import { RULES, xpForLevel } from '../config.ts';
import { machineDef } from '../data/machines.ts';
import { itemLabel } from '../data/items.ts';
import { World } from '../world/world.ts';
import { Factory, type Belt, type FactorySave, type Machine } from './factory.ts';
import { key, unkey, type Dir } from './geom.ts';
import { firstOrder, generateChoices, orderComplete, type Order } from './orders.ts';
import type { TraceCell } from './tracer.ts';
import { Inventory, type Slot } from './inventory.ts';
import { RICHNESS_RATE } from '../world/world.ts';
import { ALL_NODES, BASE_UNLOCKS, NODE, START_POINTS, nodeForMachine, type UnlockNode } from '../data/unlocks.ts';

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
  | { type: 'xp'; gained: number }
  | { type: 'level'; level: number }
  | { type: 'order' }
  | { type: 'orderDone'; order: Order }
  | { type: 'deliver'; item: string }
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

export interface GameSave {
  v: 1 | 2 | 3;
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
  /** Charbon et inventaires du robot et des drones (depuis la version 2). */
  crew?: {
    robot: { fuel: number; burn: number; inv: (Slot | null)[] };
    drones: { fuel: number; burn: number; cargo: Slot | null }[];
  };
}

export class Game {
  readonly world: World;
  readonly factory: Factory;
  money = RULES.startMoney;
  xp = 0;
  level = 1;
  robot: Robot = {
    x: 2, y: 7, target: null, manual: false, heading: 0, moving: false,
    fuel: RULES.fuelStack, burn: 0, inv: new Inventory(RULES.robotSlots, RULES.invStack),
    mining: null, mineT: 0, mined: 0, active: false,
  };
  drones: Drone[] = [];
  pending: Job[] = [];
  order: Order | null = null;
  choices: Order[] = [];
  stock: Record<string, number> = {};
  orderSeq = 1;
  rerolls = 0;
  delivered = 0;
  time = 0;
  /** Déblocages acquis et points à dépenser. */
  unlocks = new Set<string>(BASE_UNLOCKS);
  points = START_POINTS;
  /** Nombre de drones obtenus avec les commandes. */
  droneCount = RULES.startDrones;
  /** Chantier en cours du robot lui-même. */
  robotJob: Job | null = null;
  robotBuilding = false;
  private robotT = 0;
  /** Vrai pendant le calcul de la production hors ligne. */
  private offline = false;
  private listeners: ((e: GameEvent) => void)[] = [];
  private lastRobotCell = '';
  readonly noyau: Machine;

  constructor(seed: string, save?: GameSave) {
    this.world = new World(seed);
    this.factory = new Factory(this.world);
    this.factory.onDeliver = (item) => this.deliver(item);
    this.factory.coreAccepts = (item) => !this.offline || (this.stock[item] ?? 0) < RULES.offlineStockCap;
    if (save) {
      this.load(save);
      this.noyau = [...this.factory.machines.values()].find((m) => m.type === 'noyau')!;
    } else {
      this.world.reveal(2, 2, RULES.revealStart);
      this.noyau = this.factory.addMachine('noyau', 0, 0, true);
      this.order = firstOrder(this.orderSeq++);
      this.rebuildDrones();
      // Cadeau de départ : 10 charbons dans le premier drone, pour lancer la première foreuse.
      if (this.drones[0]) this.drones[0].cargo = { t: 'charbon', n: RULES.giftCoal };
    }
    this.revealRobot(true);
  }

  private rebuildDrones(): void {
    const n = this.droneCount;
    while (this.drones.length < n) {
      this.drones.push({ x: this.robot.x, y: this.robot.y - 1, state: 'home', task: null, t: 0, slot: 0, fuel: RULES.fuelStack, burn: 0, cargo: null });
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

  // ---------- Économie et progression ----------

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

  addXp(n: number): void {
    this.xp += n;
    this.emit({ type: 'xp', gained: n });
    while (this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level++;
      this.points++;
      this.emit({ type: 'level', level: this.level });
    }
  }

  private deliver(item: string): void {
    this.delivered++;
    if (this.offline) {
      // Pendant l'absence, rien n'est livré : tout s'accumule au Noyau.
      this.stock[item] = (this.stock[item] ?? 0) + 1;
      return;
    }
    const line = this.order?.lines.find((l) => l.item === item && l.done < l.qty);
    if (line) {
      line.done++;
      this.emit({ type: 'order' });
      if (this.order && orderComplete(this.order)) this.completeOrder();
    } else {
      this.stock[item] = (this.stock[item] ?? 0) + 1;
    }
    this.emit({ type: 'deliver', item });
  }

  private completeOrder(): void {
    const o = this.order!;
    this.order = null;
    this.earn(o.money);
    this.addXp(o.xp);
    if (o.equip === 'drone' && this.droneCount < RULES.maxDrones) {
      this.droneCount++;
      this.rebuildDrones();
      this.emit({ type: 'drones' });
    }
    this.emit({ type: 'orderDone', order: o });
    this.refreshChoices();
  }

  refreshChoices(): void {
    const seed = this.world.seedNum ^ (this.orderSeq * 7919) ^ (this.rerolls * 104729);
    const discovered = new Set([...this.world.discovered]);
    this.choices = generateChoices(seed >>> 0, this.level, discovered, this.orderSeq, this.droneCount < RULES.maxDrones, (id) => this.hasMachine(id));
    this.orderSeq += 3;
    this.emit({ type: 'order' });
  }

  rerollCost(): number {
    return RULES.rerollBase * this.level;
  }

  reroll(): void {
    if (!this.spend(this.rerollCost())) return;
    this.rerolls++;
    this.refreshChoices();
  }

  acceptOrder(o: Order): void {
    this.order = o;
    this.choices = [];
    // Ce qui attend déjà au Noyau compte tout de suite.
    this.deliverStock();
  }

  /** Ce que le stock du Noyau peut apporter à la commande en cours. */
  stockUsable(): number {
    const o = this.order;
    if (!o) return 0;
    return o.lines.reduce((s, l) => s + Math.min(this.stock[l.item] ?? 0, Math.max(0, l.qty - l.done)), 0);
  }

  /** Livre à la commande en cours ce qui attend au Noyau. Renvoie le nombre d'objets livrés. */
  deliverStock(): number {
    const o = this.order;
    if (!o) return 0;
    let n = 0;
    for (const l of o.lines) {
      const have = Math.min(this.stock[l.item] ?? 0, Math.max(0, l.qty - l.done));
      if (have > 0) { l.done += have; this.stock[l.item] -= have; n += have; }
    }
    this.emit({ type: 'order' });
    if (orderComplete(o)) this.completeOrder();
    return n;
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

  /** État d'un nœud : acquis, disponible, verrouillé, ou prévu plus tard. */
  nodeState(node: UnlockNode): 'owned' | 'available' | 'locked' | 'soon' {
    if (this.unlocks.has(node.id)) return 'owned';
    const parentsOk = node.parents.every((p) => this.unlocks.has(p));
    if (node.effect.kind === 'soon') return parentsOk ? 'soon' : 'locked';
    return parentsOk && this.level >= node.level ? 'available' : 'locked';
  }

  unlock(id: string): boolean {
    const node = NODE[id];
    if (!node || this.nodeState(node) !== 'available' || this.points < node.cost) return false;
    this.points -= node.cost;
    this.unlocks.add(id);
    this.applyUnlocks();
    this.emit({ type: 'unlock', id });
    return true;
  }

  /** Nombre de nœuds qu'on pourrait débloquer tout de suite. */
  unlockableCount(): number {
    return ALL_NODES.filter((x) => this.nodeState(x) === 'available' && x.cost <= this.points).length;
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
  }

  // ---------- Absence ----------

  /**
   * L'usine a continué de tourner pendant l'absence, au ralenti (10 %) et sur 8 h au plus.
   * On rejoue la simulation de l'usine en accéléré ; les objets s'accumulent au Noyau
   * (stock limité) et aucune commande ne se termine toute seule.
   */
  catchUp(awayMs: number, budgetMs = 2500): OfflineReport | null {
    const away = awayMs / 1000;
    if (!(away >= 60)) return null;
    const counted = Math.min(away, RULES.offlineMaxSeconds);
    const target = counted * RULES.offlineRate;
    const before = { ...this.stock };
    const step = 0.2;
    const start = Date.now();
    this.offline = true;
    try {
      for (let t = 0; t < target; t += step) {
        this.factory.tick(step);
        if (Date.now() - start > budgetMs) break;
      }
    } finally {
      this.offline = false;
    }
    const gained: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.stock)) {
      const d = v - (before[k] ?? 0);
      if (d > 0) gained[k] = d;
    }
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

  /** La source de charbon la plus proche du drone : un coffre à portée ou l'inventaire du robot. */
  private coalSource(d: Drone): Source | null {
    let best: Source | null = null, bd = Infinity;
    if (this.robot.inv.count('charbon') > 0) {
      best = { kind: 'robot' };
      bd = Math.hypot(this.robot.x - d.x, this.robot.y - d.y);
    }
    for (const m of this.factory.machines.values()) {
      if (m.type !== 'coffre' || !m.built || !(m.inBuf.charbon > 0)) continue;
      const c = this.center(m);
      if (!this.near(c, RULES.supplyRange)) continue;
      const dist = Math.hypot(c.x - d.x, c.y - d.y);
      if (dist < bd) { bd = dist; best = { kind: 'chest', id: m.id }; }
    }
    return best;
  }

  /** La machine à portée la plus proche du robot qui accepte cet objet ; sinon le coffre le plus proche. */
  private destinationFor(item: string): Machine | null {
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
      } else if (def.kind === 'storage' && this.factory.storageRoom(m, item) > 0 && d < cd) {
        cd = d; chest = m;
      }
    }
    return best ?? chest;
  }

  private pickTask(d: Drone): DroneTask | null {
    const others = this.drones.filter((o) => o !== d && o.task);
    const reservedFuel = new Set(others.map((o) => (o.task!.kind === 'refuel' ? o.task!.id : -1)));
    const cargoCoal = d.cargo?.t === 'charbon' ? d.cargo.n : 0;

    // a. Son propre carburant d'abord.
    if (d.fuel <= 3) {
      const src = this.coalSource(d);
      if (src) return { kind: 'fetch', from: src, item: 'charbon', self: true };
    }
    // Machines à portée qui ont besoin de charbon, la plus vide d'abord.
    const needy = [...this.factory.machines.values()]
      .filter((m) => m.built && this.factory.fuelRoom(m) > 0 && !reservedFuel.has(m.id) && this.near(this.center(m), RULES.supplyRange))
      .sort((a, b) => a.fuel - b.fuel);
    // b. Une machine dont le voyant clignote passe avant tout.
    if (cargoCoal > 0 && needy[0] && this.factory.lowFuel(needy[0])) return { kind: 'refuel', id: needy[0].id };
    // c. Les chantiers.
    const taken = this.droneJobs();
    const job = this.pending.find((j) => {
      if (taken.has(j) || j === this.robotJob) return false;
      const p = this.jobPos(j);
      return p && this.near(p);
    });
    if (job) return { kind: 'build', job };
    // d. Compléter les réservoirs.
    if (cargoCoal > 0 && needy[0]) return { kind: 'refuel', id: needy[0].id };
    // e. Toujours remplir sa cargaison de charbon.
    if (!d.cargo || (d.cargo.t === 'charbon' && d.cargo.n < RULES.invStack)) {
      const src = this.coalSource(d);
      if (src && (needy.length || !d.cargo)) return { kind: 'fetch', from: src, item: 'charbon' };
    }
    // f. Distribuer ce que le robot a miné.
    if (!d.cargo) {
      for (const t of this.robot.inv.kinds()) {
        if (t === 'charbon') continue;
        if (this.destinationFor(t)) return { kind: 'fetch', from: { kind: 'robot' }, item: t };
      }
    }
    // g. Livrer une cargaison de minerai.
    if (d.cargo && d.cargo.t !== 'charbon') {
      const dest = this.destinationFor(d.cargo.t);
      if (dest) return { kind: 'deliver', id: dest.id };
    }
    return null;
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
      if (m) d.cargo.n -= f.putInMachine(m, d.cargo.t, d.cargo.n);
    }
    if (d.cargo && d.cargo.n <= 0) d.cargo = null;
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
    this.tickRobot(dt);
    this.tickDrones(dt);
    this.factory.tick(dt);
  }

  // ---------- Sauvegarde ----------

  serialize(): GameSave {
    const r = this.robot;
    return {
      v: 3, seed: this.world.seed, time: Date.now(), money: this.money, xp: this.xp, level: this.level,
      robot: { x: r.x, y: r.y },
      factory: this.factory.serialize(),
      pending: this.pending, fog: this.world.saveFog(),
      order: this.order, choices: this.choices, stock: this.stock,
      orderSeq: this.orderSeq, rerolls: this.rerolls, delivered: this.delivered,
      drones: this.droneCount,
      unlocks: [...this.unlocks],
      points: this.points,
      crew: {
        robot: { fuel: r.fuel, burn: r.burn, inv: r.inv.save() },
        drones: this.drones.map((d) => ({ fuel: d.fuel, burn: d.burn, cargo: d.cargo ? { ...d.cargo } : null })),
      },
    };
  }

  private load(s: GameSave): void {
    this.money = s.money; this.xp = s.xp; this.level = s.level;
    this.robot.x = s.robot.x; this.robot.y = s.robot.y;
    this.world.loadFog(s.fog);
    this.factory.load(s.factory);
    this.pending = s.pending.filter((j) => (j.kind === 'belt' ? this.factory.belts.has(j.k) : this.factory.machines.has(j.id)));
    this.order = s.order; this.choices = s.choices; this.stock = s.stock;
    this.orderSeq = s.orderSeq; this.rerolls = s.rerolls; this.delivered = s.delivered ?? 0;
    if (s.unlocks) {
      this.unlocks = new Set([...BASE_UNLOCKS, ...s.unlocks]);
      this.points = s.points ?? 0;
    } else {
      // Sauvegarde d'avant l'arbre : on garde ce que le niveau avait ouvert, et les points restants.
      const legacy: Record<string, number> = { presse: 1, tour: 2, trefileuse: 3, haut_fourneau: 4, assembleur: 5, broyeur: 6, melangeur: 7, raffinerie: 8, fabricant: 9, centrifugeuse: 12, separateur: 2 };
      let spent = 0;
      for (const [id, lvl] of Object.entries(legacy)) {
        if (this.level >= lvl) { this.unlocks.add(id); spent += NODE[id]?.cost ?? 0; }
      }
      // Les parents manquants sont ajoutés pour garder un arbre cohérent.
      for (const x of ALL_NODES) if (this.unlocks.has(x.id)) x.parents.forEach((p) => this.unlocks.add(p));
      this.points = Math.max(0, START_POINTS + this.level - 1 - spent);
    }
    this.applyUnlocks();
    if (s.crew) {
      this.droneCount = s.drones ?? RULES.startDrones;
      this.rebuildDrones();
      const r = this.robot;
      r.fuel = s.crew.robot.fuel; r.burn = s.crew.robot.burn; r.inv.load(s.crew.robot.inv);
      s.crew.drones.forEach((sd, i) => {
        const d = this.drones[i];
        if (d) { d.fuel = sd.fuel; d.burn = sd.burn; d.cargo = sd.cargo ? { ...sd.cargo } : null; }
      });
    } else {
      // Sauvegarde d'avant le charbon : un drone au moins, avec le cadeau de départ.
      this.droneCount = Math.max(RULES.startDrones, s.drones ?? 0);
      this.rebuildDrones();
      if (this.drones[0]) this.drones[0].cargo = { t: 'charbon', n: RULES.giftCoal };
    }
  }

  /** Résumé lisible d'une commande (« 20 plaques de fer »). */
  static orderTitle(o: Order): string {
    return o.lines.map((l) => itemLabel(l.item, l.qty)).join(' et ');
  }
}

export { unkey };
