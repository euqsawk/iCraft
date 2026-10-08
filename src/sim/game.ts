// L'état complet d'une partie : monde, usine, robot, drones, argent, XP et commandes.
import { RULES, xpForLevel } from '../config.ts';
import { machineDef } from '../data/machines.ts';
import { itemLabel } from '../data/items.ts';
import { World } from '../world/world.ts';
import { Factory, type Belt, type FactorySave, type Machine } from './factory.ts';
import { key, unkey, type Dir } from './geom.ts';
import { firstOrder, generateChoices, orderComplete, type Order } from './orders.ts';
import type { TraceCell } from './tracer.ts';

export type Job = { kind: 'belt'; k: number } | { kind: 'machine'; id: number };

export interface Drone {
  x: number;
  y: number;
  state: 'home' | 'go' | 'build' | 'back';
  job: Job | null;
  t: number;
  /** Angle de rangement autour du robot. */
  slot: number;
}

export interface Robot {
  x: number;
  y: number;
  target: { x: number; y: number } | null;
  /** Le joueur a donné l'ordre de se déplacer (prioritaire sur la construction). */
  manual: boolean;
  heading: number;
  moving: boolean;
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
  | { type: 'drones' };

/** Ce qui s'est passé pendant l'absence du joueur. */
export interface OfflineReport {
  /** Durée réelle de l'absence, en secondes. */
  away: number;
  /** Durée prise en compte (plafonnée). */
  counted: number;
  gained: Record<string, number>;
}

export interface GameSave {
  v: 1;
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
}

export class Game {
  readonly world: World;
  readonly factory: Factory;
  money = RULES.startMoney;
  xp = 0;
  level = 1;
  robot: Robot = { x: 2, y: 7, target: null, manual: false, heading: 0, moving: false };
  drones: Drone[] = [];
  pending: Job[] = [];
  order: Order | null = null;
  choices: Order[] = [];
  stock: Record<string, number> = {};
  orderSeq = 1;
  rerolls = 0;
  delivered = 0;
  time = 0;
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
    }
    this.rebuildDrones();
    this.revealRobot(true);
  }

  private rebuildDrones(): void {
    const n = this.droneCount;
    while (this.drones.length < n) {
      this.drones.push({ x: this.robot.x, y: this.robot.y - 1, state: 'home', job: null, t: 0, slot: 0 });
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
    this.choices = generateChoices(seed >>> 0, this.level, discovered, this.orderSeq, this.droneCount < RULES.maxDrones);
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
    if (def.unlock > this.level) {
      this.emit({ type: 'toast', text: `${def.name} : niveau ${def.unlock}`, tone: 'warn' });
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
    if (split && this.level < RULES.splitterLevel) {
      this.emit({ type: 'toast', text: `Séparateur de tapis : niveau ${RULES.splitterLevel}`, tone: 'warn' });
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

  /** Le robot construit lui-même : il va au chantier le plus proche et le construit à courte portée. */
  private tickRobot(dt: number): void {
    const r = this.robot;
    this.robotBuilding = false;
    if (this.robotJob && !this.jobPos(this.robotJob)) { this.robotJob = null; this.robotT = 0; }
    if (!this.robotJob && this.pending.length) {
      const taken = new Set(this.drones.filter((d) => d.job).map((d) => d.job!));
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
        this.robotT += dt;
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
      const step = RULES.robotSpeed * dt;
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

  private tickDrones(dt: number): void {
    const r = this.robot;
    const taken = new Set(this.drones.filter((d) => d.job).map((d) => d.job!));
    for (const d of this.drones) {
      const home = { x: r.x + Math.cos(d.slot + this.time * 0.8) * 1.1, y: r.y - 1.4 + Math.sin(d.slot + this.time * 0.8) * 0.35 };
      if (d.job && !this.jobPos(d.job)) { d.job = null; d.state = 'back'; }
      if (!d.job && (d.state === 'home' || d.state === 'back')) {
        const j = this.pending.find((p) => {
          if (taken.has(p) || p === this.robotJob) return false;
          const pos = this.jobPos(p);
          return pos && Math.hypot(pos.x - r.x, pos.y - r.y) <= RULES.buildRange;
        });
        if (j) { d.job = j; d.state = 'go'; d.t = 0; taken.add(j); }
      }
      const target = d.job ? this.jobPos(d.job) : home;
      if (!target) continue;
      const dx = target.x - d.x, dy = target.y - d.y;
      const dist = Math.hypot(dx, dy);
      const step = RULES.droneSpeed * dt;
      if (d.state === 'build' && d.job) {
        d.t += dt;
        const need = d.job.kind === 'belt' ? RULES.beltBuildTime : RULES.machineBuildTime;
        if (d.t >= need) {
          this.finishJob(d.job);
          d.job = null;
          d.state = 'back';
        }
        continue;
      }
      if (dist <= step) {
        d.x = target.x; d.y = target.y;
        if (d.state === 'go') { d.state = 'build'; d.t = 0; }
        else if (d.state === 'back') d.state = 'home';
      } else {
        d.x += (dx / dist) * step; d.y += (dy / dist) * step;
      }
      if (d.state === 'home') { d.x = home.x; d.y = home.y; }
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
    return {
      v: 1, seed: this.world.seed, time: Date.now(), money: this.money, xp: this.xp, level: this.level,
      robot: { x: this.robot.x, y: this.robot.y },
      factory: this.factory.serialize(),
      pending: this.pending, fog: this.world.saveFog(),
      order: this.order, choices: this.choices, stock: this.stock,
      orderSeq: this.orderSeq, rerolls: this.rerolls, delivered: this.delivered,
      drones: this.droneCount,
    };
  }

  private load(s: GameSave): void {
    this.money = s.money; this.xp = s.xp; this.level = s.level;
    this.robot.x = s.robot.x; this.robot.y = s.robot.y;
    this.droneCount = s.drones ?? RULES.startDrones;
    this.world.loadFog(s.fog);
    this.factory.load(s.factory);
    this.pending = s.pending.filter((j) => (j.kind === 'belt' ? this.factory.belts.has(j.k) : this.factory.machines.has(j.id)));
    this.order = s.order; this.choices = s.choices; this.stock = s.stock;
    this.orderSeq = s.orderSeq; this.rerolls = s.rerolls; this.delivered = s.delivered ?? 0;
  }

  /** Résumé lisible d'une commande (« 20 plaques de fer »). */
  static orderTitle(o: Order): string {
    return o.lines.map((l) => itemLabel(l.item, l.qty)).join(' et ');
  }
}

export { unkey };
