// L'état complet d'une partie : monde, usine, robot, drones, argent, XP et commandes.
import { RULES, xpForLevel } from '../config.ts';
import { machineDef } from '../data/machines.ts';
import { itemLabel } from '../data/items.ts';
import { World } from '../world/world.ts';
import { Factory, type Belt, type FactorySave, type Machine } from './factory.ts';
import { key, unkey } from './geom.ts';
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
  | { type: 'factory' };

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
  private listeners: ((e: GameEvent) => void)[] = [];
  private lastRobotCell = '';
  readonly noyau: Machine;

  constructor(seed: string, save?: GameSave) {
    this.world = new World(seed);
    this.factory = new Factory(this.world);
    this.factory.onDeliver = (item) => this.deliver(item);
    for (let i = 0; i < RULES.droneCount; i++) {
      this.drones.push({ x: this.robot.x, y: this.robot.y, state: 'home', job: null, t: 0, slot: (i / RULES.droneCount) * Math.PI * 2 });
    }
    if (save) {
      this.load(save);
      this.noyau = [...this.factory.machines.values()].find((m) => m.type === 'noyau')!;
    } else {
      this.world.reveal(2, 2, RULES.revealStart);
      this.noyau = this.factory.addMachine('noyau', 0, 0, true);
      this.order = firstOrder(this.orderSeq++);
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
    this.emit({ type: 'orderDone', order: o });
    this.refreshChoices();
  }

  refreshChoices(): void {
    const seed = this.world.seedNum ^ (this.orderSeq * 7919) ^ (this.rerolls * 104729);
    const discovered = new Set([...this.world.discovered]);
    this.choices = generateChoices(seed >>> 0, this.level, discovered, this.orderSeq);
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
    for (const l of o.lines) {
      const have = Math.min(this.stock[l.item] ?? 0, l.qty);
      if (have > 0) { l.done += have; this.stock[l.item] -= have; }
    }
    this.emit({ type: 'order' });
    if (orderComplete(o)) this.completeOrder();
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

  placeBelts(cells: TraceCell[]): boolean {
    const fresh = cells.filter((c) => !c.existing);
    const cost = fresh.length * RULES.beltCost;
    if (fresh.length === 0) return false;
    if (!this.spend(cost)) return false;
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

  private tickRobot(dt: number): void {
    const r = this.robot;
    // Sans ordre du joueur, le robot va vers le chantier le plus proche hors de portée.
    if (!r.manual) {
      const inRange = this.pending.some((j) => {
        const p = this.jobPos(j);
        return p && Math.hypot(p.x - r.x, p.y - r.y) <= RULES.buildRange;
      });
      if (!inRange && this.pending.length) {
        let best: { x: number; y: number } | null = null, bd = Infinity;
        for (const j of this.pending) {
          const p = this.jobPos(j);
          if (!p) continue;
          const d = Math.hypot(p.x - r.x, p.y - r.y);
          if (d < bd) { bd = d; best = p; }
        }
        if (best) {
          const k = (bd - (RULES.buildRange - 2)) / bd;
          r.target = { x: r.x + (best.x - r.x) * k, y: r.y + (best.y - r.y) * k };
        }
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
          if (taken.has(p)) return false;
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
    };
  }

  private load(s: GameSave): void {
    this.money = s.money; this.xp = s.xp; this.level = s.level;
    this.robot.x = s.robot.x; this.robot.y = s.robot.y;
    for (const d of this.drones) { d.x = s.robot.x; d.y = s.robot.y; }
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
