// L'usine : tapis et machines sur la grille, et leur simulation.
import { RULES } from '../config.ts';
import { isStationType, rotDims, stationGeo, type Rot } from './stations.ts';
import { computeCrossings, computeLine, computeTunnels, laneCells, makeLeg, routeSig, type CrossMember, type Crossing, type LaneMap, type LineRoute, type RouteWorld } from './routes.ts';
import { acceptedInputs, baseType, MACHINES, machineDef, type MachineDef, type Recipe } from '../data/machines.ts';
import { DX, DY, key, keyZ, opposite, unkey, type Dir } from './geom.ts';
import { RICHNESS_RATE, type World } from '../world/world.ts';
import { isFuel } from '../data/items.ts';
import { addTo, burnOne, moveFuel, takeOf } from './fuel.ts';

export interface BeltItem {
  t: string;
  /** Avancée dans la case, de 0 (entrée) à 1 (sortie). */
  p: number;
  /** Dans une boîte (séparateur ou filtre) : la sortie qu'il prend (sens + 1 ; 5 = l'autre étage) ; absent : tout droit. */
  o?: number;
  /** Arrivé par le côté : décalage (en cases) qui se résorbe en avançant, pour ne pas sauter au milieu. */
  sx?: number;
  sy?: number;
}

export type NodeKind = 'sep' | 'tri';

/** Une sortie d'une boîte : son sens (4 = l'autre étage) et ce qui suit. */
export interface NodeOut { d: number; next: Next }

export interface Belt {
  x: number;
  y: number;
  /** En hauteur (étage 2) : passe au-dessus des tapis du sol ; un ascenseur le relie au sol à ses bouts. */
  z?: 1;
  /** Sens de sortie. */
  dir: Dir;
  /** Sens d'entrée (d'où viennent les objets). */
  inDir: Dir;
  built: boolean;
  items: BeltItem[];
  /**
   * Boîte posée sur la case : séparateur (partage à tour de rôle) ou filtre (chaque sortie ses objets).
   * Ses sorties : tout droit, les tapis qui partent de ses côtés, et (si `vert`) le tapis de l'autre étage
   * sur la même case ; 4 au plus. Ses entrées : tous les tapis qui y arrivent.
   */
  node?: NodeKind;
  /** Filtre : les objets de chaque sortie (sens 0 à 3, 4 = l'autre étage). Une sortie sans liste prend « le reste ». */
  rules?: Record<number, string[]>;
  /** Côtés coupés (« Rien ») : le tapis ou la machine de ce côté n'est pas nourri. */
  off?: number[];
  /** Sortie vers le tapis de l'autre étage, sur la même case (dessous au 2e étage, dessus au 1er). */
  vert?: 1;
  /** Sortie de côté qui part en pont : nombre de cases enjambées, par sens. */
  jumps?: Record<number, number>;
  /** Tour de rôle de la boîte. */
  toggle?: number;
  /** Liaisons de côté : les machines voisines dans ces sens y déposent leur production (sans case de tapis). */
  feeds?: Dir[];
  /** Pont : nombre de cases enjambées tout droit (la case suivante est jump + 1 plus loin). */
  jump?: number;
  /** Compteur posé sur cette case : les objets qui en sortent (date et matière), pour le débit. */
  meter?: { ev: { t: number; k: string }[]; since: number };
  /** Niveau du tapis (1 à 5, absent = 1) : il va plus vite à chaque niveau. */
  lvl?: number;
}

/** Vitesse d'un tapis (× la vitesse de base) selon son niveau. */
export function beltLevelSpeed(b: { lvl?: number }): number {
  return RULES.beltLevelSpeed[Math.max(0, Math.min(4, (b.lvl ?? 1) - 1))];
}

/** Longueur parcourue sur une case de tapis, en cases (plus longue sur un pont). */
export function span(b: { jump?: number }): number {
  return 1 + (b.jump ?? 0);
}

export type MachineStatus = 'idle' | 'working' | 'blocked' | 'nofuel' | 'noinput' | 'noore' | 'nopower' | 'nowater';

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
  /** Foreuse : son niveau (1 à 5, absent = 1), qui multiplie ce qu'elle extrait. */
  lvl?: number;
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
  /** Batterie : énergie gardée, en kJ. */
  charge?: number;
  /** Eau reçue par les tuyaux (0 à 1 : la part de ce qu'elle demande). Non sauvegardé. */
  water?: number;
  /** Gare ou dépôt : quarts de tour (le quai et le sens de la voie tournent avec). */
  rot?: Rot;
  /** Monte-charge d'un atelier : minuteur des échanges avec les coffres collés. */
  liftT?: number;
  /** Recette prévue (fenêtre de la machine) : sert seulement à calculer les débits attendus ; la machine reste en auto. */
  plan?: number;
  /** Dernier objet reçu par chaque tapis d'entrée, et envoyé par chaque tapis de sortie (clé : case du tapis). */
  seenIn?: Record<number, string>;
  seenOut?: Record<number, string>;
  /** Entrées et sorties prévues sur les bords (case dehors, relative à la machine) : un chevron, sans prendre de case. */
  ports?: MachinePort[];
  /** Atelier (module) : l'usine rangée dedans, et le côté de son intérieur en cases. */
  inner?: Factory;
  size?: number;
}

/**
 * Une entrée ou une sortie prévue sur un côté d'une machine : l'objet n'est qu'une étiquette
 * (ce qu'on prévoit d'y faire passer). Rien n'est filtré : on entre et on sort par où l'on veut.
 */
export interface MachinePort { rx: number; ry: number; io: 'in' | 'out'; item?: string }

/** L'intérieur d'un atelier : pas de filons, tout est découvert. */
const ROOM_WORLD = { patchAt: () => null, isRevealed: () => true } as unknown as World;

/** Ce qu'il faut sur la rampe de lancement pour que la fusée décolle. */
export const ROCKET_NEEDS: Record<string, number> = { structure_fusee: 20, moteur_fusee: 8, guidage: 4, carburant: 100 };

/** Objets qu'un atelier garde à l'entrée, en attendant que l'intérieur les prenne. */
const ATELIER_BUFFER = 40;

export type VehicleKind = 'camion' | 'train';

/** Un arrêt d'une ligne : un dépôt (camions) ou une gare (trains), où l'on charge ou décharge. */
export interface LineStop {
  id: number;
  /** Ancien réglage (charge tout ou décharge tout), gardé pour les vieilles sauvegardes. */
  load: boolean;
  /** Ce que le véhicule prend à cet arrêt, et ce qu'il y dépose : rien, tout, ou une liste d'objets. */
  take?: StopRule;
  drop?: StopRule;
}

export type StopRule = 'none' | 'all' | string[];

/** Ce qu'un arrêt fait prendre et déposer (avec les anciens réglages « charge » / « décharge »). */
export function stopRules(st: LineStop): { take: StopRule; drop: StopRule } {
  return { take: st.take ?? (st.load ? 'all' : 'none'), drop: st.drop ?? (st.load ? 'none' : 'all') };
}

export function ruleHas(r: StopRule, item: string): boolean {
  return r === 'all' ? true : r === 'none' ? false : r.includes(item);
}

/** Un camion ou un train d'une ligne : l'arrêt où il est (ou qu'il vient de quitter), sa position sur le trajet suivant. */
export interface Vehicle {
  at: number;
  pos: number;
  moving: boolean;
  /** Temps passé à l'arrêt. */
  t: number;
  cargo: Record<string, number>;
  /** À l'arrêt, il a commencé à charger : il ne dépose plus rien avant le prochain arrêt. */
  loading?: boolean;
}

/** Une ligne : 2 à 6 arrêts parcourus en boucle, et ses véhicules. La route ou les rails font une boucle (voir routes.ts). */
export interface Line {
  id: number;
  kind: VehicleKind;
  stops: LineStop[];
  vehicles: Vehicle[];
  /** Le tracé posé (gardé tel quel tant que les arrêts ne bougent pas) : coins de chaque trajet, à plat. */
  track?: { sig: string; gap: number; legs: number[][] };
}

/** Un réseau électrique : les câbles reliés entre eux et les machines qui les touchent. */
export interface PowerNet {
  id: number;
  gens: Machine[];
  users: Machine[];
  batteries: Machine[];
  /** Courant disponible (charbon, soleil, batteries) et demandé, en kW, et la part servie (0 à 1). */
  supply: number;
  /** Dont le soleil (kW), et l'énergie gardée dans les batteries (kJ) sur ce qu'elles peuvent garder. */
  solar: number;
  stored: number;
  capacity: number;
  demand: number;
  ratio: number;
}

/** Un réseau d'eau : des tuyaux reliés, des pompes et les machines qui boivent (en L/s). */
export interface WaterNet {
  pumps: Machine[];
  users: Machine[];
  supply: number;
  demand: number;
  ratio: number;
}

/** Fenêtre de mesure du débit réel, en secondes. */
export const FLOW_WINDOW = 20;

export type Next =
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

/** Bâtiments retirés du jeu, avec leur prix (rendu quand une ancienne partie se charge). */
const REMOVED_COST: Record<string, number> = { station: 100, hangar: 500, recharge: 200, revente: 20, filtre: 250 };

export class Factory {
  readonly belts = new Map<number, Belt>();
  readonly machines = new Map<number, Machine>();
  /** Lignes de camions et de trains. */
  readonly lines = new Map<number, Line>();
  private nextLine = 1;
  /** Pièces à rendre au chargement d'une ancienne partie (ce qui a été retiré du jeu). */
  legacyRefund = 0;
  /** Câbles électriques (une couche à part : ils passent sous les tapis et les machines). */
  readonly cables = new Set<number>();
  private cellMachine = new Map<number, Machine>();
  /** Cases des quais des gares et dépôts : réservées aux véhicules (ni tapis ni machine). */
  readonly quays = new Map<number, Machine>();
  private nets: PowerNet[] = [];
  private netOfMachine = new Map<Machine, PowerNet>();
  private netOfCable = new Map<number, PowerNet>();
  private nextId = 1;

  // Topologie, recalculée quand l'usine change.
  private dirty = true;
  private order: Belt[] = [];
  private nextOf = new Map<Belt, Next>();
  /** Les sorties de chaque boîte (séparateur, filtre), dans l'ordre : tout droit d'abord. */
  private nodeOuts = new Map<Belt, NodeOut[]>();
  private outputs = new Map<Machine, Belt[]>();
  /** Groupes de foreuses 1 × 1 collées par un côté (construites) : chaque foreuse → son groupe. */
  private drillGroups = new Map<Machine, Machine[]>();
  /** À qui le tour, parmi les sorties d'un groupe de foreuses. */
  private drillTurn = new Map<Machine[], number>();
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

  /** Puissance demandée par la machine quand elle travaille, en kW (0 : elle ne se branche pas). */
  powerUse(m: Machine): number {
    if (m.inner) return this.electric.size ? this.innerKw(m) : 0;
    if (!this.electric.has(m.type)) return 0;
    // Une foreuse ou une machine améliorée va plus vite : elle consomme d'autant plus.
    return Math.round((machineDef(m.type).kw ?? 100) * Factory.levelSpeed(m));
  }

  /** Ce que consomment au courant les machines d'un atelier (et des ateliers qu'il contient), en kW. */
  innerKw(m: Machine): number {
    let kw = 0;
    for (const x of m.inner?.machines.values() ?? []) {
      const d = machineDef(x.type);
      if (x.inner) kw += this.innerKw(x);
      else if (d.kind === 'crafter' || d.kind === 'drill') kw += d.kw ?? 60;
    }
    return Math.max(kw, 30);
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
  /** Appelé quand une fusée décolle. */
  onRocket: (m: Machine) => void = () => {};

  readonly world: World;
  /** Dans un atelier : l'atelier qui contient cette usine (ses ports y prennent et y déposent). */
  host: Machine | null = null;
  /** Dans un atelier : côté de l'intérieur (les cases de 0 à bounds - 1) ; 0 = sans limite. */
  bounds = 0;
  /** Dans un atelier : les machines ne brûlent rien, c'est l'atelier qui consomme pour elles. */
  freeEnergy = false;

  constructor(world: World) {
    this.world = world;
  }

  /** Crée l'usine intérieure d'un atelier. */
  makeInner(m: Machine, size: number): Factory {
    const f = new Factory(ROOM_WORLD);
    f.host = m;
    f.bounds = size;
    f.freeEnergy = true;
    f.speedMult = this.speedMult;
    f.chestSlots = this.chestSlots;
    f.electric = this.electric;
    f.stats = this.stats;
    m.inner = f;
    m.size = size;
    return f;
  }

  /** La case est-elle dans l'intérieur (toujours vrai hors d'un atelier) ? */
  inBounds(x: number, y: number): boolean {
    return !this.bounds || (x >= 0 && y >= 0 && x < this.bounds && y < this.bounds);
  }

  // ---------- Consultation ----------

  beltAt(x: number, y: number, z = 0): Belt | undefined {
    return this.belts.get(keyZ(x, y, z));
  }

  /** La clé d'une case de tapis (avec son étage). */
  beltKey(b: Belt): number {
    return keyZ(b.x, b.y, b.z ?? 0);
  }

  /**
   * Ascenseur : le tapis de l'autre étage dans la case suivante, quand rien ne continue celui-ci à son propre étage
   * (tout droit ou par le côté, comme à un même étage).
   */
  private liftAt(b: Belt, nx: number, ny: number): Belt | null {
    return this.beltAt(nx, ny, b.z ? 0 : 1) ?? null;
  }

  /** Le tapis de l'autre étage que celui-ci rejoint par un ascenseur (ou qui le rejoint), s'il y en a un. */
  liftOf(b: Belt): { to: Belt | null; from: Belt | null } {
    this.refresh();
    const n = this.nextOf.get(b);
    const to = n?.kind === 'belt' && (n.belt.z ?? 0) !== (b.z ?? 0) ? n.belt : null;
    const f = this.feederOf(b);
    return { to, from: f && (f.z ?? 0) !== (b.z ?? 0) ? f : null };
  }

  machineAt(x: number, y: number): Machine | undefined {
    return this.cellMachine.get(key(x, y));
  }

  isFree(x: number, y: number, z = 0): boolean {
    const k = key(x, y);
    return this.inBounds(x, y) && !this.belts.has(keyZ(x, y, z)) && !this.cellMachine.has(k) && !this.quays.has(k);
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


  /** Les cases autour d'une machine, sur ses côtés (sans les coins) : là où une entrée ou une sortie peut se brancher. */
  perimeter(m: Machine): { x: number; y: number; side: 'top' | 'right' | 'bottom' | 'left'; d: Dir }[] {
    const out: { x: number; y: number; side: 'top' | 'right' | 'bottom' | 'left'; d: Dir }[] = [];
    const dirOf = (dx: number, dy: number) => ([0, 1, 2, 3] as Dir[]).find((d) => DX[d] === dx && DY[d] === dy)!;
    for (let i = 0; i < m.w; i++) out.push({ x: m.x + i, y: m.y - 1, side: 'top', d: dirOf(0, -1) });
    for (let j = 0; j < m.h; j++) out.push({ x: m.x + m.w, y: m.y + j, side: 'right', d: dirOf(1, 0) });
    for (let i = m.w - 1; i >= 0; i--) out.push({ x: m.x + i, y: m.y + m.h, side: 'bottom', d: dirOf(0, 1) });
    for (let j = m.h - 1; j >= 0; j--) out.push({ x: m.x - 1, y: m.y + j, side: 'left', d: dirOf(-1, 0) });
    return out;
  }

  /**
   * Les entrées et sorties d'une machine, autour d'elle : tapis branchés (avec le dernier objet passé par là)
   * et entrées ou sorties prévues (un chevron, pas encore de tapis).
   */
  private portIndex(m: Machine, x: number, y: number, io: 'in' | 'out'): number | undefined {
    const i = m.ports?.findIndex((p) => p.io === io && m.x + p.rx === x && m.y + p.ry === y) ?? -1;
    return i >= 0 ? i : undefined;
  }

  /** Ce que la machine sort sans doute : ce qui attend dans sa sortie, sinon sa recette en cours ou la dernière. */
  likelyOutput(m: Machine): string | undefined {
    const ready = Object.keys(m.outBuf).find((t) => m.outBuf[t] > 0);
    if (ready) return ready;
    const def = machineDef(m.type);
    if (def.kind === 'drill') return m.ore;
    const n = def.recipes.length;
    if (!n) return undefined;
    const ri = m.craft ? m.craft.ri : n === 1 ? 0 : m.made > 0 ? ((m.rrRecipe - 1) % n + n) % n : -1;
    return ri >= 0 ? Object.keys(def.recipes[ri].out)[0] : undefined;
  }

  machineIO(m: Machine): { x: number; y: number; side: 'top' | 'right' | 'bottom' | 'left'; io: 'in' | 'out'; item?: string; planned: boolean; port?: number }[] {
    this.refresh();
    const res: { x: number; y: number; side: 'top' | 'right' | 'bottom' | 'left'; io: 'in' | 'out'; item?: string; planned: boolean; port?: number }[] = [];
    const outs = new Set(this.outputs.get(m) ?? []);
    for (const c of this.perimeter(m)) {
      // Au sol d'abord ; sinon un tapis en hauteur qui arrive ou part de la machine.
      const b = this.beltAt(c.x, c.y) ?? this.beltAt(c.x, c.y, 1);
      if (!b) continue;
      const k = key(c.x, c.y);
      const nxt = this.nextOf.get(b);
      const feeds = (this.nodeOuts.get(b) ?? []).some((o) => o.d < 4 && o.d !== b.dir && o.next?.kind === 'machine' && o.next.machine === m);
      // Ce qui passe là : le dernier objet vu ; sinon (machine bouchée, ancienne partie) ce qui attend sur le tapis ou dans la machine.
      // Une entrée ou sortie prévue à cet endroit, puis tracée : on garde ce qu'on y avait prévu.
      const portAt = (io: 'in' | 'out') => m.ports?.find((p) => p.io === io && m.x + p.rx === c.x && m.y + p.ry === c.y);
      const plan = (io: 'in' | 'out') => portAt(io)?.item;
      if ((nxt?.kind === 'machine' && nxt.machine === m) || feeds) res.push({ x: c.x, y: c.y, side: c.side, io: 'in', item: m.seenIn?.[k] ?? b.items[0]?.t ?? plan('in'), planned: false, port: this.portIndex(m, c.x, c.y, 'in') });
      if (outs.has(b)) res.push({ x: c.x, y: c.y, side: c.side, io: 'out', item: m.seenOut?.[k] ?? plan('out') ?? b.items[b.items.length - 1]?.t ?? this.likelyOutput(m), planned: false, port: this.portIndex(m, c.x, c.y, 'out') });
    }
    (m.ports ?? []).forEach((p, i) => {
      const x = m.x + p.rx, y = m.y + p.ry;
      if (res.some((r) => r.x === x && r.y === y && r.io === p.io)) return;
      const c = this.perimeter(m).find((q) => q.x === x && q.y === y);
      if (c) res.push({ x, y, side: c.side, io: p.io, item: p.item, planned: true, port: i });
    });
    return res;
  }

  /** La machine (ou le coffre) qui dépose sur ce tapis, s'il part d'elle. */
  outputOwner(b: Belt): Machine | null {
    this.refresh();
    for (const [m, list] of this.outputs) if (list.includes(b)) return m;
    return null;
  }

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
      if (!b.jump && !b.jumps) continue;
      const spans: [number, number, boolean][] = [];
      if (b.jump) spans.push([b.dir, b.jump, false]);
      for (const [d, n] of Object.entries(b.jumps ?? {})) spans.push([Number(d), n, true]);
      for (const [d, n, split] of spans) {
        for (let k = 1; k <= n; k++) if (b.x + DX[d] * k === x && b.y + DY[d] * k === y) return { belt: b, split };
      }
    }
    return null;
  }

  /** Change l'étage d'une case de tapis (elle garde ses objets). */
  setBeltZ(b: Belt, z: 0 | 1): void {
    this.belts.delete(this.beltKey(b));
    if (z) b.z = 1; else delete b.z;
    this.belts.set(this.beltKey(b), b);
    this.dirty = true;
  }

  /** Pose (ou change) une boîte sur une case de tapis : séparateur ou filtre. */
  setNode(b: Belt, kind: NodeKind): void {
    b.node = kind;
    if (kind === 'sep') delete b.rules;
    this.dirty = true;
  }

  /** Retire la boîte : la case redevient un tapis simple. */
  clearNode(b: Belt): void {
    delete b.node; delete b.rules; delete b.off; delete b.vert; delete b.jumps; delete b.toggle;
    for (const it of b.items) delete it.o;
    this.dirty = true;
  }

  /** Filtre : les objets d'une sortie (vide : « le reste »). */
  setNodeRule(b: Belt, d: number, items: string[] | null): void {
    const r = { ...(b.rules ?? {}) };
    if (items && items.length) r[d] = [...new Set(items)]; else delete r[d];
    if (Object.keys(r).length) b.rules = r; else delete b.rules;
    this.dirty = true;
  }

  /** Coupe (« Rien ») ou rétablit une sortie de côté ; 4 : la sortie vers l'autre étage. */
  setNodeOff(b: Belt, d: number, off: boolean): void {
    if (d === 4) { if (off) delete b.vert; else b.vert = 1; this.dirty = true; return; }
    const s = new Set(b.off ?? []);
    if (off) s.add(d); else s.delete(d);
    if (s.size) b.off = [...s]; else delete b.off;
    this.dirty = true;
  }

  /** Une sortie de côté qui part en pont (par-dessus un tapis collé). */
  setNodeJump(b: Belt, d: number, jump: number): void {
    const j = { ...(b.jumps ?? {}) };
    if (jump > 0) j[d] = Math.min(jump, RULES.bridgeSpan); else delete j[d];
    if (Object.keys(j).length) b.jumps = j; else delete b.jumps;
    this.dirty = true;
  }

  /** Peut-on faire partir une dérivation de cette case (elle devient, ou est déjà, une boîte de moins de 4 sorties) ? */
  canBranch(b: Belt): boolean {
    return !b.node || this.nodeOutputs(b).length < 4;
  }

  /**
   * Une simple liaison : un séparateur sans réglage dont les sorties de côté sont toutes des machines collées
   * (le tapis nourrit la machine qu'il longe). Pas de boîte dessinée, pas de fenêtre.
   */
  nodeIsLink(b: Belt): boolean {
    if (b.node !== 'sep') return false;
    const side = this.nodeOutputs(b).filter((o) => o.d !== b.dir);
    return side.length > 0 && side.every((o) => o.d < 4 && o.next?.kind === 'machine');
  }

  /** Les sorties d'une boîte (tout droit d'abord). */
  nodeOutputs(b: Belt): NodeOut[] {
    this.refresh();
    return this.nodeOuts.get(b) ?? [];
  }

  /**
   * Ce qu'il y a de chaque côté d'une boîte, pour sa fenêtre : « main » (tout droit), « in » (un tapis y arrive),
   * « out » (une sortie), « off » (une sortie coupée), « none » (rien). 4 : l'autre étage (s'il y a un tapis).
   */
  nodeSides(b: Belt): Record<number, 'main' | 'in' | 'out' | 'off' | 'none'> {
    this.refresh();
    const outs = this.nodeOuts.get(b) ?? [];
    const res: Record<number, 'main' | 'in' | 'out' | 'off' | 'none'> = {};
    for (let d = 0; d < 4; d++) {
      if (d === b.dir) { res[d] = 'main'; continue; }
      if (outs.some((o) => o.d === d)) { res[d] = 'out'; continue; }
      if (d === opposite(b.inDir) || this.feedsInto(b, d)) { res[d] = 'in'; continue; }
      res[d] = this.sideTarget(b, d, true) ? 'off' : 'none';
    }
    const other = this.beltAt(b.x, b.y, b.z ? 0 : 1);
    res[4] = !other ? 'none' : outs.some((o) => o.d === 4) ? 'out' : 'off';
    return res;
  }

  /** Un tapis voisin, de ce côté, qui donne dans cette case. */
  private feedsInto(b: Belt, d: number): boolean {
    const nb = this.beltAt(b.x + DX[d], b.y + DY[d], b.z ?? 0);
    return !!nb && nb.x + DX[nb.dir] * span(nb) === b.x && nb.y + DY[nb.dir] * span(nb) === b.y;
  }

  /**
   * Ce qu'une boîte nourrirait de ce côté : un tapis qui part de là (il commence contre la boîte), ou une machine collée.
   * `ignoreOff` : même si ce côté est coupé.
   */
  private sideTarget(b: Belt, d: number, ignoreOff = false): Next {
    if (!ignoreOff && b.off?.includes(d)) return null;
    const L = 1 + (b.jumps?.[d] ?? 0);
    const nx = b.x + DX[d] * L, ny = b.y + DY[d] * L;
    // Au même étage ; sinon un tapis de l'autre étage qui part de là (un ascenseur dès la première case).
    const nb = this.beltAt(nx, ny, b.z ?? 0) ?? (L === 1 ? this.liftAt(b, nx, ny) : null);
    if (nb) return nb.inDir === d && !nb.jump && !(nb.x + DX[nb.dir] * span(nb) === b.x && nb.y + DY[nb.dir] * span(nb) === b.y) ? { kind: 'belt', belt: nb, side: false } : null;
    if (L > 1) return null;
    const m = this.machineAt(nx, ny);
    return m ? { kind: 'machine', machine: m } : null;
  }

  /** La case de tapis qui nourrit celle-ci par l'arrière (voisine, ou un pont qui atterrit ici). */
  feederOf(b: Belt): Belt | null {
    for (let k = 1; k <= RULES.bridgeSpan + 1; k++) {
      const f = this.beltAt(b.x - DX[b.inDir] * k, b.y - DY[b.inDir] * k, b.z ?? 0);
      if (f && f.x + DX[f.dir] * span(f) === b.x && f.y + DY[f.dir] * span(f) === b.y) return f;
    }
    // Par un ascenseur : le tapis de l'autre étage juste derrière, qui n'a rien à son étage devant lui.
    const px = b.x - DX[b.inDir], py = b.y - DY[b.inDir];
    const o = this.beltAt(px, py, b.z ? 0 : 1);
    if (o && o.dir === b.inDir && !o.jump && !this.beltAt(b.x, b.y, o.z ?? 0)) return o;
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
      const c: Belt = cur;
      const L = span(c);
      const nx: number = c.x + DX[c.dir] * L, ny: number = c.y + DY[c.dir] * L;
      const n: Belt | undefined = this.beltAt(nx, ny, c.z ?? 0) ?? this.liftAt(c, nx, ny) ?? undefined;
      if (!n || seen.has(n)) break;
      if (n.inDir !== cur.dir) break; // chargement par le côté : autre chaîne
      out.push(n); seen.add(n); cur = n;
    }
    return out;
  }

  // ---------- Construction ----------

  checkMachine(type: string, x: number, y: number, ignore?: Machine, overBelts = false, rot: Rot = 0): PlaceCheck {
    const def = machineDef(type);
    const station = isStationType(type);
    const size = rotDims(def.w, def.h, station ? rot : 0);
    // Un compteur se pose sur un tapis, sans rien remplacer.
    if (def.kind === 'meter') {
      const b = this.beltAt(x, y);
      if (!b) return { ok: false, reason: 'Pose-le sur un tapis' };
      if (b.meter) return { ok: false, reason: 'Ce tapis a déjà un compteur' };
      return { ok: true };
    }
    const oreCount = new Map<string, { n: number; rate: number }>();
    let belts = 0;
    for (let j = 0; j < size.h; j++) {
      for (let i = 0; i < size.w; i++) {
        const cx = x + i, cy = y + j;
        if (!this.inBounds(cx, cy)) return { ok: false, reason: 'Hors de l’atelier' };
        const k = key(cx, cy);
        const m = this.cellMachine.get(k);
        if (m && m !== ignore) return { ok: false, reason: 'Place occupée' };
        const q = this.quays.get(k);
        if (q && q !== ignore) return { ok: false, reason: 'Le quai d’une gare doit rester libre' };
        if (this.belts.has(keyZ(cx, cy, 1))) return { ok: false, reason: 'Un tapis passe au-dessus' };
        if (this.belts.has(k)) {
          if (!overBelts) return { ok: false, reason: 'Place occupée' };
          belts++;
        }
        if (def.kind === 'pump') {
          const p = this.world.patchAt(cx, cy);
          if (p?.type === 'eau') { const e = oreCount.get('eau') ?? { n: 0, rate: 1 }; e.n++; oreCount.set('eau', e); }
        }
        if (def.kind === 'drill') {
          const p = this.world.patchAt(cx, cy);
          if (p && p.type !== 'eau') {
            const e = oreCount.get(p.type) ?? { n: 0, rate: RICHNESS_RATE[p.richness] };
            e.n++;
            e.rate = Math.max(e.rate, RICHNESS_RATE[p.richness]);
            oreCount.set(p.type, e);
          }
        }
      }
    }
    // Gare ou dépôt : son quai (le long du grand côté) doit être libre.
    if (station) {
      for (const c of stationGeo(x, y, rot).quay) {
        if (!this.inBounds(c.x, c.y)) return { ok: false, reason: 'Hors de l’atelier' };
        const k = key(c.x, c.y);
        const m = this.cellMachine.get(k), q = this.quays.get(k);
        if ((m && m !== ignore) || (q && q !== ignore) || this.belts.has(k)) return { ok: false, reason: 'Le quai (la voie le long du bâtiment) doit être libre' };
      }
    }
    if (def.kind === 'pump') {
      if ((oreCount.get('eau')?.n ?? 0) < 2) return { ok: false, reason: 'À poser sur de l’eau' };
      return { ok: true, belts };
    }
    if (def.kind === 'drill') {
      let best: [string, { n: number; rate: number }] | null = null;
      for (const e of oreCount) if (!best || e[1].n > best[1].n) best = e;
      if (!best || best[1].n < Math.min(2, def.w * def.h)) return { ok: false, reason: 'À poser sur un filon' };
      // Une foreuse 1 × 1 : le quart d'une ancienne foreuse 2 × 2 (quatre collées valent la même chose).
      if (def.w * def.h === 1) return { ok: true, ore: best[0], rate: DRILL_BASE_RATE * best[1].rate / 4, belts };
      // Le débit ne dépend que du filon (pas du nombre de cases couvertes) : des chiffres ronds.
      return { ok: true, ore: best[0], rate: DRILL_BASE_RATE * best[1].rate, belts };
    }
    return { ok: true, belts };
  }

  addMachine(type: string, x: number, y: number, built = false, id?: number, rot: Rot = 0): Machine {
    const def = machineDef(type);
    const station = isStationType(type);
    const size = rotDims(def.w, def.h, station ? rot : 0);
    const check = def.kind === 'drill' ? this.checkMachine(type, x, y, undefined, true) : { ok: true } as PlaceCheck;
    if (id === undefined) id = this.nextId++;
    else this.nextId = Math.max(this.nextId, id + 1);
    const m: Machine = {
      id, type, x, y, w: size.w, h: size.h, built,
      inBuf: {}, outBuf: {}, fuel: 0, burn: 0, craft: null, drillT: 0,
      status: 'idle', rrOut: 0, rrRecipe: 0, made: 0,
      ore: check.ore, rate: check.rate,
    };
    if (station) m.rot = rot;
    this.machines.set(m.id, m);
    this.indexMachine(m);
    this.dirty = true;
    this.routesDirty = true;
    return m;
  }

  private indexMachine(m: Machine): void {
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) this.cellMachine.set(key(m.x + i, m.y + j), m);
    if (isStationType(m.type)) for (const c of stationGeo(m.x, m.y, m.rot ?? 0).quay) this.quays.set(key(c.x, c.y), m);
  }

  private unindexMachine(m: Machine): void {
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) this.cellMachine.delete(key(m.x + i, m.y + j));
    if (isStationType(m.type)) for (const c of stationGeo(m.x, m.y, m.rot ?? 0).quay) if (this.quays.get(key(c.x, c.y)) === m) this.quays.delete(key(c.x, c.y));
  }

  /** Le quai d'une gare ou d'un dépôt posé. */
  stationOf(m: Machine) {
    return stationGeo(m.x, m.y, m.rot ?? 0);
  }

  moveMachine(m: Machine, x: number, y: number, rot: Rot = m.rot ?? 0): boolean {
    const check = this.checkMachine(m.type, x, y, m, true, rot);
    if (check.ok && check.belts) return false;
    if (!check.ok) return false;
    this.unindexMachine(m);
    m.x = x; m.y = y;
    if (isStationType(m.type)) {
      const def = machineDef(m.type), size = rotDims(def.w, def.h, rot);
      m.rot = rot; m.w = size.w; m.h = size.h;
      // Les tapis branchés sur un côté qui a tourné ne sont plus les mêmes : on oublie les liaisons.
      delete m.links;
      this.routesDirty = true;
    }
    if (check.ore) { m.ore = check.ore; m.rate = check.rate; }
    this.indexMachine(m);
    this.dirty = true;
    return true;
  }

  removeMachine(m: Machine): void {
    this.unindexMachine(m);
    if (isStationType(m.type)) this.routesDirty = true;
    this.machines.delete(m.id);
    for (const l of [...this.lines.values()]) if (l.stops.some((st) => st.id === m.id)) { this.lines.delete(l.id); this.routesDirty = true; }
    this.dirty = true;
  }

  addBelt(x: number, y: number, dir: Dir, inDir: Dir, built = false, z = 0): Belt {
    const b: Belt = { x, y, dir, inDir, built, items: [], ...(z ? { z: 1 as const } : {}) };
    this.belts.set(keyZ(x, y, z), b);
    this.dirty = true;
    return b;
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
    this.belts.delete(this.beltKey(b));
    // Une boîte dont on retire la sortie en pont oublie ce pont.
    for (let d = 0; d < 4; d++) {
      for (let k = 2; k <= RULES.bridgeSpan + 1; k++) {
        const nb = this.beltAt(b.x - DX[d] * k, b.y - DY[d] * k, b.z ?? 0);
        if (nb?.jumps && 1 + (nb.jumps[d] ?? 0) === k) this.setNodeJump(nb, d, 0);
      }
    }
    this.dirty = true;
  }

  markBuilt(): void {
    this.dirty = true;
  }

  // ---------- Camions et trains ----------

  /** Les trajets sont à recalculer (une gare posée, déplacée, tournée, ou une ligne changée). */
  routesDirty = true;
  /** Les tunnels et croisements sont à recalculer (on a construit ou retiré quelque chose). */
  private tunnelsDirty = true;
  /** Le tracé de chaque ligne (par numéro), et les croisements entre voies. */
  readonly routes = new Map<number, LineRoute>();
  crossings: Crossing[] = [];
  /** Change à chaque nouveau tracé (pour le rendu). */
  routeVersion = 0;
  private crossByLeg = new Map<string, { c: Crossing; m: CrossMember }[]>();
  /** Qui est dans chaque croisement (et par quelle voie). */
  private crossHold = new Map<Crossing, Map<Vehicle, CrossMember>>();

  private routeWorld(): RouteWorld {
    return {
      blocked: (x, y) => {
        if (!this.inBounds(x, y)) return true;
        const k = key(x, y), m = this.cellMachine.get(k);
        return (!!m && isStationType(m.type)) || this.quays.has(k);
      },
      occupied: (x, y) => {
        const k = key(x, y);
        if (this.belts.has(k)) return true;
        const m = this.cellMachine.get(k);
        return !!m && !isStationType(m.type);
      },
    };
  }

  private stopGeos(ids: number[]): { x: number; y: number; rot: Rot }[] | null {
    const out: { x: number; y: number; rot: Rot }[] = [];
    for (const id of ids) {
      const m = this.machines.get(id);
      if (!m) return null;
      out.push({ x: m.x, y: m.y, rot: (m.rot ?? 0) as Rot });
    }
    return out;
  }

  /** Les voies des lignes déjà tracées (sauf une). */
  private laneMap(except?: number): LaneMap {
    const map: LaneMap = new Map();
    for (const [id, r] of this.routes) if (id !== except) for (const leg of r.legs) laneCells(leg, map);
    return map;
  }

  /** Recalcule ce qui doit l'être : les trajets (gares changées), puis les tunnels et les croisements. */
  ensureRoutes(): void {
    if (this.routesDirty) {
      this.routesDirty = false;
      this.routes.clear();
      const world = this.routeWorld();
      const others: LaneMap = new Map();
      for (const l of [...this.lines.values()].sort((a, b) => a.id - b.id)) {
        const geo = this.stopGeos(l.stops.map((st) => st.id));
        if (!geo || geo.length < 2) continue;
        const sig = routeSig(geo);
        const saved = l.track;
        const r: LineRoute = saved && saved.sig === sig && saved.legs.length === geo.length
          ? { sig, gap: saved.gap, legs: saved.legs.map((f) => makeLeg(Array.from({ length: f.length / 2 }, (_, i) => ({ x: f[i * 2], y: f[i * 2 + 1] })))) }
          : computeLine(geo, world, others);
        l.track = { sig, gap: r.gap, legs: r.legs.map((leg) => leg.pts.flatMap((p) => [p.x, p.y])) };
        for (const leg of r.legs) laneCells(leg, others);
        this.routes.set(l.id, r);
        // Les véhicules restent sur leur trajet (raccourci ou allongé).
        for (const v of l.vehicles) {
          v.at = Math.min(v.at, l.stops.length - 1);
          v.pos = Math.min(v.pos, r.legs[v.at]?.len ?? 0);
        }
      }
      this.tunnelsDirty = true;
    }
    if (this.tunnelsDirty) {
      this.tunnelsDirty = false;
      const world = this.routeWorld();
      for (const r of this.routes.values()) for (const leg of r.legs) leg.tunnels = computeTunnels(leg, world);
      this.crossings = computeCrossings([...this.lines.values()].filter((l) => this.routes.has(l.id)).map((l) => ({ id: l.id, kind: l.kind, route: this.routes.get(l.id)! })));
      this.crossByLeg.clear();
      for (const c of this.crossings) for (const m of c.members) {
        const k = `${m.line}:${m.leg}`;
        const arr = this.crossByLeg.get(k) ?? [];
        arr.push({ c, m });
        this.crossByLeg.set(k, arr);
      }
      // Qui se trouve déjà dans un croisement le garde (sinon deux véhicules pourraient s'y retrouver).
      this.crossHold.clear();
      for (const l of this.lines.values()) for (const v of l.vehicles) {
        if (!v.moving) continue;
        const vl = l.kind === 'train' ? RULES.trainLength : RULES.truckLength;
        for (const { c, m } of this.crossByLeg.get(`${l.id}:${v.at}`) ?? []) {
          if (v.pos >= m.sIn - 0.4 && v.pos - vl <= m.sOut) this.holdOf(c).set(v, m);
        }
      }
      this.routeVersion++;
    }
  }

  private holdOf(c: Crossing): Map<Vehicle, CrossMember> {
    let h = this.crossHold.get(c);
    if (!h) { h = new Map(); this.crossHold.set(c, h); }
    return h;
  }

  /** Longueur du trajet i d'une ligne (en cases). */
  legLen(l: Line, i: number): number {
    this.ensureRoutes();
    return this.routes.get(l.id)?.legs[i % Math.max(1, l.stops.length)]?.len ?? 0;
  }

  /** Longueur totale d'une ligne (toute sa boucle, en cases). */
  lineLength(l: Line): number {
    this.ensureRoutes();
    const r = this.routes.get(l.id);
    return r ? r.legs.reduce((a, leg) => a + leg.len, 0) : 0;
  }

  /** Longueur de la boucle qu'aurait une ligne par ces arrêts (pour le prix, avant de la poser). */
  loopLength(stopIds: number[], exceptLine?: number): number {
    this.ensureRoutes();
    const geo = this.stopGeos(stopIds);
    if (!geo || geo.length < 2) return 0;
    return computeLine(geo, this.routeWorld(), this.laneMap(exceptLine)).legs.reduce((a, leg) => a + leg.len, 0);
  }

  /**
   * Feu d'une voie à un croisement. Carrefour : les deux sens passent chacun leur tour (vert, orange, rouge).
   * Passage à niveau : rouge pour la route quand un train approche ou passe. Croisement de rails : un train à la fois.
   */
  crossLight(c: Crossing, m: CrossMember): 'green' | 'amber' | 'red' {
    const hold = this.crossHold.get(c);
    const othersIn = !!hold && [...hold.values()].some((x) => x !== m);
    if (c.kind === 'carrefour') {
      const T = RULES.lightCycle, t = ((this.clock + c.id * 1.7) % (T * 2) + T * 2) % (T * 2);
      const greenAxis = t < T ? 'h' : 'v', u = t % T;
      if (m.axis !== greenAxis) return 'red';
      return u > T - 1.2 ? 'amber' : 'green';
    }
    if (c.kind === 'niveau' && m.kind === 'camion') return othersIn || this.trainNear(c) ? 'red' : 'green';
    return othersIn ? 'red' : 'green';
  }

  /** Un train passe le passage à niveau, ou arrive (moins de 6 cases). */
  private trainNear(c: Crossing): boolean {
    const hold = this.crossHold.get(c);
    if (hold && [...hold.values()].some((m) => m.kind === 'train')) return true;
    for (const m of c.members) {
      if (m.kind !== 'train') continue;
      const l = this.lines.get(m.line);
      if (!l) continue;
      for (const v of l.vehicles) if (v.moving && v.at === m.leg && m.sIn - v.pos <= 6 && m.sIn - v.pos >= -0.5) return true;
    }
    return false;
  }

  addLine(kind: VehicleKind, from: Machine, to: Machine, id?: number): Line {
    const l: Line = { id: id ?? this.nextLine++, kind, stops: [{ id: from.id, load: true }, { id: to.id, load: false }], vehicles: [] };
    this.nextLine = Math.max(this.nextLine, l.id + 1);
    this.lines.set(l.id, l);
    this.routesDirty = true;
    return l;
  }

  newVehicle(): Vehicle {
    return { at: 0, pos: 0, moving: false, t: 0, cargo: {} };
  }

  removeLine(id: number): Line | null {
    const l = this.lines.get(id);
    if (l) { this.lines.delete(id); this.routesDirty = true; }
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
    this.ensureRoutes();
    // Un seul véhicule à quai par dépôt (ou gare) : les autres attendent leur tour sur la route, devant l'entrée.
    const docked = new Set<number>();
    for (const l of this.lines.values()) {
      const n = l.stops.length;
      const gap = l.kind === 'train' ? RULES.trainGap : RULES.truckGap;
      for (const v of l.vehicles) {
        if (v.moving) continue;
        const id = l.stops[v.at % n].id;
        if (!docked.has(id)) { docked.add(id); continue; }
        // Déjà quelqu'un à quai : il recule dans la file, sur la route qui arrive.
        const prevAt = (v.at - 1 + n) % n;
        let pos = this.legLen(l, prevAt) - gap;
        for (const o of l.vehicles) if (o !== v && o.moving && o.at === prevAt) pos = Math.min(pos, o.pos - gap);
        v.at = prevAt; v.moving = true; v.t = 0;
        v.pos = Math.max(0, pos);
      }
    }
    for (const l of this.lines.values()) {
      const cap = l.kind === 'train' ? RULES.trainLoad : RULES.truckLoad;
      const speed = (l.kind === 'train' ? RULES.trainSpeed : RULES.truckSpeed * this.truckMult);
      const gap = l.kind === 'train' ? RULES.trainGap : RULES.truckGap;
      const n = l.stops.length;
      for (const v of l.vehicles) {
        const stop = l.stops[v.at % n];
        const here = this.machines.get(stop.id);
        const next = this.machines.get(l.stops[(v.at + 1) % n].id);
        if (!here || !next) continue;
        if (v.moving) {
          const legI = v.at % n;
          const len = this.legLen(l, legI);
          // Il s'arrête derrière le véhicule qui le précède, et devant l'entrée si le quai est pris.
          let limit = docked.has(next.id) ? len - gap : len;
          for (const o of l.vehicles) {
            if (o === v || !o.moving || o.at !== v.at) continue;
            if (o.pos > v.pos || (o.pos === v.pos && l.vehicles.indexOf(o) < l.vehicles.indexOf(v))) limit = Math.min(limit, o.pos - gap);
          }
          // Croisements : il attend au feu (ou que la voie soit libre), puis le tient jusqu'à l'avoir passé.
          const vl = l.kind === 'train' ? RULES.trainLength : RULES.truckLength;
          for (const { c, m } of this.crossByLeg.get(`${l.id}:${legI}`) ?? []) {
            const hold = this.holdOf(c);
            if (hold.has(v)) { if (v.pos - vl > m.sOut) hold.delete(v); continue; }
            const stopAt = m.sIn - 0.4;
            if (v.pos > stopAt + 0.05 || stopAt - v.pos > 2.5) continue;
            // Pas de place après le croisement (le véhicule devant attend) : on ne bloque pas le passage.
            const room = !l.vehicles.some((o) => o !== v && o.moving && o.at === v.at && o.pos > v.pos && o.pos - gap < m.sOut + 0.3)
              && !(docked.has(next.id) && len - gap < m.sOut + 0.3);
            if (room && this.crossLight(c, m) === 'green') {
              if (v.pos + speed * dt >= stopAt) hold.set(v, m);
            } else limit = Math.min(limit, stopAt);
          }
          v.pos = Math.max(v.pos, Math.min(v.pos + speed * dt, limit));
          if (v.pos >= len - 1e-6 && !docked.has(next.id)) {
            v.at = (v.at + 1) % n; v.pos = 0; v.moving = false; v.t = 0;
            docked.add(next.id);
          }
          continue;
        }
        if (!here.built) continue;
        v.t += dt;
        // À l'arrêt : il dépose dans les arrivées ce que l'arrêt reçoit, puis prend dans les départs ce qu'il envoie.
        // Deux coffres séparés : il ne reprend jamais ce qu'il vient de déposer.
        const { take, drop } = stopRules(stop);
        const arr = here.outBuf;
        // Une fois qu'il a commencé à charger, il ne dépose plus rien ici (sinon il redéposerait ce qu'il vient de prendre).
        const dropKey = () => v.loading ? undefined : Object.keys(v.cargo).find((x) => v.cargo[x] > 0 && ruleHas(drop, x) && this.storageRoom(here, x, arr) > 0);
        const takeKey = () => this.cargoCount(v) < cap ? Object.keys(here.inBuf).find((x) => here.inBuf[x] > 0 && ruleHas(take, x)) : undefined;
        let busy = false;
        while (v.t >= 0.1) {
          const d = dropKey();
          if (d) {
            v.cargo[d]--; if (!v.cargo[d]) delete v.cargo[d];
            arr[d] = (arr[d] ?? 0) + 1;
            v.t -= 0.1; busy = true; continue;
          }
          const k = takeKey();
          if (k) {
            here.inBuf[k]--; if (!here.inBuf[k]) delete here.inBuf[k];
            v.cargo[k] = (v.cargo[k] ?? 0) + 1;
            v.loading = true;
            v.t -= 0.1; busy = true; continue;
          }
          break;
        }
        if (busy || dropKey() || takeKey()) continue;
        // Plus rien à faire ici : il part plein, ou après un moment s'il a quelque chose (ou si un autre arrêt a de quoi lui donner).
        const c = this.cargoCount(v);
        const othersGive = l.stops.some((o) => o !== stop && stopRules(o).take !== 'none');
        let leave = false;
        if (c >= cap) leave = true;
        else if (take === 'none') leave = c === 0 || v.t >= RULES.vehicleWait;
        else if (v.t >= RULES.vehicleWait) leave = c > 0 || othersGive;
        if (leave) { v.moving = true; v.t = 0; v.loading = false; docked.delete(here.id); }
        else if (c === 0 && !othersGive) v.t = Math.min(v.t, RULES.vehicleWait);
      }
    }
  }

  // ---------- Eau ----------

  /** Tuyaux : une couche à part, comme les câbles ; ils relient les machines qu'ils touchent (dessous ou à côté). */
  readonly pipes = new Set<number>();
  private waterNets: WaterNet[] = [];
  private waterOfMachine = new Map<Machine, WaterNet>();

  hasPipe(x: number, y: number): boolean {
    return this.pipes.has(key(x, y));
  }

  addPipe(x: number, y: number): boolean {
    const k = key(x, y);
    if (this.pipes.has(k)) return false;
    this.pipes.add(k);
    this.dirty = true;
    return true;
  }

  removePipe(x: number, y: number): boolean {
    const ok = this.pipes.delete(key(x, y));
    if (ok) this.dirty = true;
    return ok;
  }

  /** Eau demandée par une machine quand elle travaille (L/s). */
  waterUse(m: Machine): number {
    const k = machineDef(m.type).kind;
    if (k === 'reactor') return RULES.reactorWater;
    if (k === 'generator') return RULES.genWater;
    if (m.type === 'melangeur') return RULES.mixerWater;
    if (m.type === 'raffinerie') return RULES.refineryWater;
    return 0;
  }

  /** Part d'eau reçue par une machine qui en a besoin (1 pour les autres, et dans un atelier). */
  waterFactor(m: Machine): number {
    if (!this.waterUse(m) || this.freeEnergy) return 1;
    return m.water ?? 0;
  }

  /** Le réseau d'eau d'une machine (null sans tuyau qui la touche). */
  waterNetOf(m: Machine): WaterNet | null {
    this.refresh();
    return this.waterOfMachine.get(m) ?? null;
  }

  private buildWaterNets(): void {
    const parent = new Map<number, number>();
    const find = (k: number): number => { let r = k; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
    for (const k of this.pipes) parent.set(k, k);
    for (const k of this.pipes) {
      const [x, y] = unkey(k);
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const n = key(x + dx, y + dy);
        if (this.pipes.has(n)) { const a = find(k), b = find(n); if (a !== b) parent.set(a, b); }
      }
    }
    const nets = new Map<number, WaterNet>();
    this.waterOfMachine.clear();
    for (const m of this.machines.values()) {
      const kind = machineDef(m.type).kind;
      if (kind !== 'pump' && !this.waterUse(m)) continue;
      let root = -1;
      for (let y = m.y - 1; y <= m.y + m.h && root < 0; y++) {
        for (let x = m.x - 1; x <= m.x + m.w && root < 0; x++) {
          const corner = (x < m.x || x >= m.x + m.w) && (y < m.y || y >= m.y + m.h);
          if (!corner && this.pipes.has(key(x, y))) root = find(key(x, y));
        }
      }
      if (root < 0) continue;
      let n = nets.get(root);
      if (!n) { n = { pumps: [], users: [], supply: 0, demand: 0, ratio: 0 }; nets.set(root, n); }
      if (kind === 'pump') n.pumps.push(m); else n.users.push(m);
      this.waterOfMachine.set(m, n);
    }
    this.waterNets = [...nets.values()];
  }

  /** L'eau de chaque réseau : les pompes posées sur l'eau servent les machines qui en veulent. */
  private stepWater(): void {
    for (const m of this.machines.values()) m.water = 0;
    for (const n of this.waterNets) {
      let supply = 0, demand = 0;
      for (const p of n.pumps) if (p.built) { supply += RULES.pumpWater; p.status = 'working'; }
      for (const u of n.users) if (u.built) demand += this.waterUse(u);
      const ratio = supply <= 0 ? 0 : demand <= 0 ? 1 : Math.min(1, supply / demand);
      for (const u of n.users) u.water = ratio;
      n.supply = supply; n.demand = demand; n.ratio = ratio;
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

  /** Le réseau d'une machine (null si aucun câble n'est à portée). */
  netOf(m: Machine): PowerNet | null {
    this.refresh();
    return this.netOfMachine.get(m) ?? null;
  }

  /** Les machines branchables (ou générateurs) à portée de ces cases de câble. */
  machinesInRange(cells: { x: number; y: number }[]): Machine[] {
    const R = RULES.cableRange;
    const out = new Set<Machine>();
    for (const c of cells) {
      for (let y = c.y - R; y <= c.y + R; y++) {
        for (let x = c.x - R; x <= c.x + R; x++) {
          const m = this.cellMachine.get(key(x, y));
          if (m && !out.has(m) && (this.powerUse(m) || machineDef(m.type).supply || machineDef(m.type).kind === 'battery')) out.add(m);
        }
      }
    }
    return [...out];
  }

  /** Le réseau d'une case de câble. */
  netAt(x: number, y: number): PowerNet | null {
    this.refresh();
    return this.netOfCable.get(key(x, y)) ?? null;
  }

  /** Les réseaux : câbles reliés (case à case), et les machines à portée d'un câble (5 cases). */
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
    // Une machine se branche sur le câble le plus proche, à 5 cases au plus (dessous compris).
    // Elle ne relie pas deux réseaux entre eux : seul le câble les relie.
    const R = RULES.cableRange;
    const touch = new Map<Machine, number[]>();
    for (const m of this.machines.values()) {
      const def = machineDef(m.type);
      if (!this.powerUse(m) && !def.supply && def.kind !== 'battery') continue;
      let best = -1, bestD = Infinity;
      for (let y = m.y - R; y < m.y + m.h + R; y++) {
        for (let x = m.x - R; x < m.x + m.w + R; x++) {
          const k = key(x, y);
          if (!this.cables.has(k)) continue;
          const dx = x < m.x ? m.x - x : x >= m.x + m.w ? x - (m.x + m.w - 1) : 0;
          const dy = y < m.y ? m.y - y : y >= m.y + m.h ? y - (m.y + m.h - 1) : 0;
          const d = Math.max(dx, dy) + (dx + dy) * 0.001;
          if (d < bestD) { bestD = d; best = k; }
        }
      }
      if (best >= 0) touch.set(m, [best]);
    }
    const byRoot = new Map<number, PowerNet>();
    const netFor = (k: number) => {
      const r = find(k);
      let n = byRoot.get(r);
      if (!n) { n = { id: byRoot.size + 1, gens: [], users: [], batteries: [], supply: 0, demand: 0, ratio: 0, solar: 0, stored: 0, capacity: 0 }; byRoot.set(r, n); }
      return n;
    };
    this.netOfCable.clear();
    this.netOfMachine.clear();
    for (const k of this.cables) this.netOfCable.set(k, netFor(k));
    for (const [m, found] of touch) {
      const n = netFor(found[0]);
      this.netOfMachine.set(m, n);
      const d = machineDef(m.type);
      if (d.kind === 'battery') n.batteries.push(m); else if (d.supply) n.gens.push(m); else n.users.push(m);
    }
    this.nets = [...byRoot.values()];
  }

  /** Le courant de chaque réseau : les générateurs qui ont du charbon servent les machines qui veulent travailler. */
  /** Lumière du jour (0 la nuit, 1 en plein jour) : les panneaux solaires en dépendent. */
  daylight = 1;
  /** Météo : vitesse des camions et part du soleil qui passe (pluie, neige). */
  truckMult = 1;
  solarMult = 1;
  /**
   * Le courant de chaque réseau. Le soleil sert d'abord, puis les batteries, puis les générateurs au charbon
   * (qui ne brûlent que pour ce qui reste). Le surplus du soleil recharge les batteries.
   */
  private stepPower(dt: number): void {
    for (const m of this.machines.values()) m.power = 0;
    for (const n of this.nets) {
      let coal = 0, solar = 0, demand = 0, batt = 0, capacity = 0;
      for (const g of n.gens) {
        if (!g.built) continue;
        const d = machineDef(g.type);
        if (d.kind === 'solar') solar += d.supply! * this.daylight * this.solarMult;
        else if (d.kind === 'reactor') { if ((g.inBuf.uranium_enrichi ?? 0) > 0 || g.burn > 0) coal += d.supply! * (g.water ?? 0); }
        else if (g.fuel > 0 || g.burn > 0) coal += d.supply! * this.waterFactor(g);
      }
      for (const b of n.batteries) {
        if (!b.built) continue;
        capacity += RULES.batteryKj;
        if (dt > 0) batt += Math.min(RULES.batteryKw, (b.charge ?? 0) / dt);
      }
      for (const u of n.users) if (u.built && u.want) demand += this.powerUse(u);
      const supply = solar + batt + coal;
      const ratio = supply <= 0 ? 0 : demand <= 0 ? 1 : Math.min(1, supply / demand);
      for (const u of n.users) u.power = ratio;
      const used = Math.min(demand, supply);
      const fromSolar = Math.min(used, solar);
      const fromBatt = Math.min(used - fromSolar, batt);
      const fromCoal = used - fromSolar - fromBatt;
      // Batteries : elles se vident pour combler, ou se remplissent avec le surplus du soleil.
      const spare = solar - fromSolar;
      const live = n.batteries.filter((b) => b.built);
      for (const b of live) {
        let c = b.charge ?? 0;
        if (fromBatt > 0 && batt > 0) { const k = Math.min(RULES.batteryKw, c / Math.max(dt, 1e-9)) / batt; c -= fromBatt * k * dt; b.status = 'working'; }
        else if (spare > 0 && c < RULES.batteryKj) { c += Math.min(RULES.batteryKw, spare / live.length) * dt; b.status = 'working'; }
        else b.status = 'idle';
        b.charge = Math.max(0, Math.min(RULES.batteryKj, c));
      }
      n.supply = supply; n.demand = demand; n.ratio = ratio;
      n.solar = solar; n.stored = live.reduce((a, b) => a + (b.charge ?? 0), 0); n.capacity = capacity;
      // Chaque générateur brûle selon ce qui lui reste à fournir.
      const load = coal > 0 ? Math.min(1, fromCoal / coal) : 0;
      for (const g of n.gens) {
        const gk = machineDef(g.type).kind;
        if (gk === 'solar') g.status = this.daylight > 0.05 ? 'working' : 'idle';
        else if (gk === 'reactor') this.tickReactor(g, load, dt);
        else this.tickGenerator(g, load, dt);
      }
    }
    for (const m of this.machines.values()) {
      const k = machineDef(m.type).kind;
      if (!m.built || this.netOfMachine.has(m)) continue;
      if (k === 'solar' || k === 'battery') m.status = 'idle';
      if (k === 'reactor') m.status = (m.water ?? 0) > 0 ? 'idle' : 'nowater';
    }
    // Un générateur sans câble ne sert à rien.
    for (const m of this.machines.values()) {
      if (machineDef(m.type).kind === 'generator' && m.built && !this.netOfMachine.has(m)) m.status = this.waterFactor(m) <= 0 ? 'nowater' : m.fuel > 0 ? 'idle' : 'nofuel';
    }
  }

  /** Réacteur : un barreau d'uranium enrichi dure 2 minutes à pleine charge ; sans eau, il s'arrête. */
  private tickReactor(g: Machine, load: number, dt: number): void {
    if (!g.built) return;
    if ((g.water ?? 0) <= 0) { g.status = 'nowater'; return; }
    if (load <= 0) { g.status = (g.inBuf.uranium_enrichi ?? 0) > 0 || g.burn > 0 ? 'idle' : 'nofuel'; return; }
    if (g.burn <= 0) {
      if (!((g.inBuf.uranium_enrichi ?? 0) > 0)) { g.status = 'nofuel'; return; }
      g.inBuf.uranium_enrichi--;
      if (!g.inBuf.uranium_enrichi) delete g.inBuf.uranium_enrichi;
      g.burn += RULES.reactorRodSeconds;
      this.flow(g, 'uranium_enrichi', 1, false);
    }
    g.burn -= dt * load;
    g.status = 'working';
  }

  private tickGenerator(g: Machine, load: number, dt: number): void {
    if (!g.built) return;
    // Un générateur au charbon doit être refroidi : sans eau, il ne tourne pas.
    if (this.waterFactor(g) <= 0) { g.status = 'nowater'; return; }
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
    if (this.freeEnergy) return 1;
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
    this.tunnelsDirty = true;
    this.nextOf.clear();
    this.outputs.clear();
    for (const m of this.machines.values()) this.outputs.set(m, []);

    this.nodeOuts.clear();
    for (const b of this.belts.values()) {
      const nxt = this.linkFor(b, b.dir);
      this.nextOf.set(b, nxt);
      // Sortie de machine : la case d'où vient le tapis est dans une machine.
      const fm = this.machineAt(b.x - DX[b.inDir], b.y - DY[b.inDir]);
      if (fm && !(nxt?.kind === 'machine' && nxt.machine === fm)) this.outputs.get(fm)!.push(b);
      // Liaison de côté : la machine voisine dépose au milieu de la case.
      for (const fd of b.feeds ?? []) {
        const lm = this.machineAt(b.x + DX[fd], b.y + DY[fd]);
        if (lm && lm !== fm && !(nxt?.kind === 'machine' && nxt.machine === lm) && !this.outputs.get(lm)!.includes(b)) this.outputs.get(lm)!.push(b);
      }
    }

    // Les boîtes : tout droit, puis les côtés (droite, gauche, arrière), puis l'autre étage ; 4 sorties au plus.
    for (const b of this.belts.values()) {
      if (!b.node) continue;
      const outs: NodeOut[] = [];
      const main = this.nextOf.get(b) ?? null;
      if (main) outs.push({ d: b.dir, next: main });
      for (const d of [(b.dir + 1) % 4, (b.dir + 3) % 4, (b.dir + 2) % 4]) {
        if (outs.length >= 4 || d === opposite(b.inDir)) continue;
        const n = this.sideTarget(b, d);
        if (n) outs.push({ d, next: n });
      }
      const other = b.vert ? this.beltAt(b.x, b.y, b.z ? 0 : 1) : undefined;
      if (other && outs.length < 4) outs.push({ d: 4, next: { kind: 'belt', belt: other, side: true } });
      this.nodeOuts.set(b, outs);
    }

    this.buildDrillGroups();
    this.buildNets();
    this.buildWaterNets();

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
        for (const o of this.nodeOuts.get(b) ?? []) if (o.next?.kind === 'belt' && !visited.has(o.next.belt)) stack.push([o.next.belt, false]);
      }
    };
    for (const b of this.belts.values()) visit(b);
    this.order = order;
  }

  /** Ce qui suit une case de tapis dans une direction donnée. */
  private linkFor(b: Belt, dir: Dir): Next {
    // Un pont atterrit plus loin, tout droit.
    const L = dir === b.dir ? span(b) : 1 + (b.jumps?.[dir] ?? 0);
    const nx = b.x + DX[dir] * L, ny = b.y + DY[dir] * L;
    // Un tapis en hauteur ne voit que les tapis en hauteur ; à son bout, un ascenseur le relie au sol (et inversement).
    const nb = this.beltAt(nx, ny, b.z ?? 0) ?? this.liftAt(b, nx, ny);
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

  /** La sortie d'une boîte dans un sens donné (pour les tests). */
  outNext(b: Belt, d: number): Next {
    this.refresh();
    return (this.nodeOuts.get(b) ?? []).find((o) => o.d === d)?.next ?? null;
  }

  /**
   * Ce qu'il manque encore à une destination de tri (« @noyau », « @labo », « @comptoir », « @train ») :
   * branché par la partie. Un trieur réglé sur une destination n'envoie que ce qui manque.
   */
  destNeeds: ((dest: string) => Record<string, number>) | null = null;
  private transit: Map<string, Map<string, number>> | null = null;
  private needCache: Map<string, Record<string, number>> | null = null;

  /**
   * Ce qui est déjà en route vers une destination : les objets partis dans la dérivation d'un trieur réglé
   * sur elle (sur la case du trieur, puis sur les tapis qui suivent jusqu'au bâtiment).
   */
  private inTransit(dest: string): Map<string, number> {
    if (!this.transit) this.transit = new Map();
    let m = this.transit.get(dest);
    if (m) return m;
    m = new Map();
    const tag = `@${dest}`;
    const add = (t: string) => m!.set(t, (m!.get(t) ?? 0) + 1);
    for (const b of this.belts.values()) {
      if (!b.rules) continue;
      for (const o of this.nodeOuts.get(b) ?? []) {
        if (!b.rules[o.d]?.includes(tag)) continue;
        const link = o.next;
        for (const it of b.items) if ((it.o === undefined ? b.dir : it.o - 1) === o.d) add(it.t);
        // Les tapis de la dérivation, jusqu'au bâtiment (ou au bout).
        const seen = new Set<Belt>();
        let nx = link;
        while (nx && nx.kind === 'belt' && !seen.has(nx.belt) && seen.size < 400) {
          seen.add(nx.belt);
          for (const it of nx.belt.items) add(it.t);
          nx = this.nextOf.get(nx.belt) ?? null;
        }
      }
    }
    this.transit.set(dest, m);
    return m;
  }

  /** Un trieur réglé sur une destination : cet objet lui manque-t-il encore (compte tenu de ce qui est en route) ? */
  private wantedBy(filter: string, t: string): boolean {
    const dest = filter.slice(1);
    if (!this.needCache) this.needCache = new Map();
    let needs = this.needCache.get(dest);
    if (!needs) { needs = this.destNeeds?.(dest) ?? {}; this.needCache.set(dest, needs); }
    const need = needs[t] ?? 0;
    if (need <= 0) return false;
    const tr = this.inTransit(dest);
    return (tr.get(t) ?? 0) < need;
  }

  /** Il part vers cette destination : il compte tout de suite comme « en route ». */
  private sentTo(filter: string, t: string): void {
    const tr = this.inTransit(filter.slice(1));
    tr.set(t, (tr.get(t) ?? 0) + 1);
  }

  /**
   * Un objet entre dans une case. Dans un séparateur, il prend la sortie suivante, à tour de rôle. Dans un filtre,
   * il part par une sortie qui le demande (à tour de rôle s'il y en a plusieurs), sinon par une sortie « le reste ».
   */
  private enter(b: Belt, it: BeltItem): void {
    if (!b.node) { delete it.o; return; }
    const outs = this.nodeOuts.get(b) ?? [];
    if (!outs.length) { delete it.o; return; }
    let cands = outs, tag: string | null = null;
    if (b.node === 'tri' && b.rules) {
      const rules = b.rules;
      const want: NodeOut[] = [];
      for (const o of outs) {
        const f = rules[o.d]?.find((x) => (x.startsWith('@') ? this.wantedBy(x, it.t) : x === it.t));
        if (f) { want.push(o); if (f.startsWith('@')) tag = f; }
      }
      cands = want.length ? want : outs.filter((o) => !rules[o.d]?.length);
      if (!cands.length) cands = [outs[0]];
    }
    b.toggle = ((b.toggle ?? 0) + 1) % cands.length;
    const o = cands[b.toggle];
    if (tag && b.rules?.[o.d]?.includes(tag)) this.sentTo(tag, it.t);
    if (o.d === b.dir) delete it.o; else it.o = o.d + 1;
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

  /** Taille de la case carburant (10). */
  fuelCap(_m: Machine): number {
    return RULES.fuelStack;
  }

  /** Place restante dans la case carburant. */
  fuelRoom(m: Machine): number {
    const def = machineDef(m.type);
    if (this.freeEnergy || this.selfFed(m) || this.powered(m)) return 0;
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
    if (!(m.built && !this.freeEnergy && machineDef(m.type).coal && !this.selfFed(m) && !this.powered(m))) return false;
    // Un groupe de foreuses partage son charbon : il clignote quand tout le groupe en manque.
    const group = this.drillGroups.get(m);
    if (group && group.length > 1) {
      let fuel = 0;
      for (const x of group) fuel += x.fuel;
      return fuel <= RULES.lowFuel * Math.ceil(group.length / 4);
    }
    return m.fuel <= RULES.lowFuel;
  }

  /** Cases occupées d'un coffre (piles de 10). */
  /** Nombre de cases d'un coffre (30 pour un grand coffre). */
  slotsOf(m: Machine): number {
    // Un coffre, un grand coffre ou un entrepôt monte de niveau : 2 puis 3 fois plus de place.
    const lv = m.type === 'depot' || m.type === 'gare' ? 1 : Math.max(1, Math.min(3, m.lvl ?? 1));
    if (m.type === 'entrepot') return RULES.warehouseSlots * lv;
    return (m.type === 'grand_coffre' || m.type === 'depot' || m.type === 'gare' ? RULES.bigChestSlots : this.chestSlots) * lv;
  }

  storageSlots(m: Machine, buf: Record<string, number> = m.inBuf): number {
    let n = 0;
    for (const v of Object.values(buf)) n += Math.ceil(v / RULES.invStack);
    return n;
  }

  /** Place restante dans un coffre pour un type d'objet (dans les départs d'une gare, sauf `buf`). */
  storageRoom(m: Machine, item: string, buf: Record<string, number> = m.inBuf): number {
    const have = buf[item] ?? 0;
    const partial = have % RULES.invStack ? RULES.invStack - (have % RULES.invStack) : 0;
    return partial + Math.max(0, this.slotsOf(m) - this.storageSlots(m, buf)) * RULES.invStack;
  }

  /** Dépôt ou gare : deux coffres. Les départs (inBuf) se remplissent par les tapis et les drones, et partent avec les véhicules ;
   *  les arrivées (outBuf) reçoivent ce que ramènent les véhicules, et ressortent sur les tapis. */
  isStop(m: Machine): boolean {
    return m.type === 'depot' || m.type === 'gare';
  }

  /** Le coffre d'où l'on sort (tapis, drones, monte-charge) : les arrivées d'une gare, sinon tout le contenu. */
  outOf(m: Machine): Record<string, number> {
    return this.isStop(m) ? m.outBuf : m.inBuf;
  }

  /** Brûle du charbon pour travailler dt secondes ; faux s'il n'y en a plus. */
  private useFuel(m: Machine, def: MachineDef, dt: number): boolean {
    if (!def.coal) return true;
    if (m.burn <= 0) {
      const k = burnOne(m, RULES.coalMachineSeconds * (def.coalMult ?? 1));
      if (!k) return false;
      this.flow(m, k, 1, false);
    }
    m.burn -= dt;
    return true;
  }

  canAccept(m: Machine, item: string): boolean {
    if (!m.built) return false;
    const def = machineDef(m.type);
    if (def.kind === 'core' || def.kind === 'lab' || def.kind === 'missions' || def.kind === 'freight') return this.buildingAccepts(m, item);
    if (def.kind === 'storage') return this.storageRoom(m, item) > 0;
    if (def.kind === 'port_out') return !!this.host && this.bufCount(this.host.outBuf) < ATELIER_BUFFER;
    if (isFuel(item) && def.coal && !this.freeEnergy && m.fuel < this.fuelCap(m)) return true;
    if (def.kind === 'atelier') return this.bufCount(m.inBuf) < ATELIER_BUFFER && this.atelierWants(m, item);
    if (def.kind === 'reactor') return item === 'uranium_enrichi' && (m.inBuf[item] ?? 0) < RULES.fuelStack;
    if (def.kind === 'rocket') return !m.craft && (m.inBuf[item] ?? 0) < (ROCKET_NEEDS[item] ?? 0);
    if (def.kind !== 'crafter') return false;
    if (!this.acceptSet(def).has(item)) return false;
    return (m.inBuf[item] ?? 0) < RULES.machineBuffer;
  }

  private give(m: Machine, item: string): void {
    const def = machineDef(m.type);
    if (def.kind === 'core' || def.kind === 'lab' || def.kind === 'missions' || def.kind === 'freight') { this.onDeliver(m, item); return; }
    if (def.kind === 'port_out') { if (this.host) this.host.outBuf[item] = (this.host.outBuf[item] ?? 0) + 1; return; }
    if (def.kind === 'rocket') { m.inBuf[item] = (m.inBuf[item] ?? 0) + 1; return; }
    if (isFuel(item) && def.coal && !this.freeEnergy && m.fuel < this.fuelCap(m)) {
      // Le carburant d'abord ; un fourneau bien chargé garde le reste comme ingrédient.
      const asIngredient = def.recipes.some((r) => r.in[item]) && m.fuel >= 3 && (m.inBuf[item] ?? 0) < RULES.machineBuffer;
      if (!asIngredient) { addTo(m, 1, item); return; }
    }
    m.inBuf[item] = (m.inBuf[item] ?? 0) + 1;
  }

  /** Retire des objets d'un coffre ; renvoie la quantité prise. */
  takeFromStorage(m: Machine, item: string, n: number, buf: Record<string, number> = this.outOf(m)): number {
    const k = Math.min(n, buf[item] ?? 0);
    if (k > 0) buf[item] -= k;
    if (buf[item] === 0) delete buf[item];
    return k;
  }

  /** Dépose des objets dans un coffre ; renvoie la quantité déposée. */
  putInStorage(m: Machine, item: string, n: number, buf: Record<string, number> = m.inBuf): number {
    const k = Math.min(n, this.storageRoom(m, item, buf));
    if (k > 0) buf[item] = (buf[item] ?? 0) + k;
    return k;
  }

  /** Dépose des ingrédients dans une machine ; renvoie la quantité déposée. */
  putInMachine(m: Machine, item: string, n: number): number {
    const def = machineDef(m.type);
    if (def.kind === 'storage') return this.putInStorage(m, item, n);
    if (def.kind === 'rocket') { const k = m.craft ? 0 : Math.max(0, Math.min(n, (ROCKET_NEEDS[item] ?? 0) - (m.inBuf[item] ?? 0))); if (k) m.inBuf[item] = (m.inBuf[item] ?? 0) + k; return k; }
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
  /** Statistiques : tout ce qui a été fabriqué ou extrait, et consommé (partagé avec les ateliers). */
  stats: { made: Record<string, number>; used: Record<string, number> } = { made: {}, used: {} };

  private flow(m: Machine, k: string, n: number, out: boolean): void {
    const kind = machineDef(m.type).kind;
    if (kind === 'drill' || kind === 'crafter') {
      const t = out ? this.stats.made : this.stats.used;
      t[k] = (t[k] ?? 0) + n;
    }
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
    this.transit = null;
    this.needCache = null;
    const base = RULES.beltSpeed * this.speedMult * dt;
    const gap = RULES.beltGap;

    for (const b of this.order) {
      if (!b.built || b.items.length === 0) continue;
      // Chaque tapis va à la vitesse de son niveau.
      const speed = base * beltLevelSpeed(b);
      // Sur un pont, p couvre plusieurs cases : on avance moins vite en p, avec un écart plus petit en p.
      const Lb = span(b), sp = speed / Lb, gp = gap / Lb;
      const main = this.nextOf.get(b) ?? null;
      const nodeOuts = b.node ? this.nodeOuts.get(b) ?? [] : null;
      // La sortie d'un objet : tout droit, ou celle que la boîte lui a donnée.
      const outOf = (o: number | undefined): Next => (o === undefined || !nodeOuts ? main : nodeOuts.find((x) => x.d === o - 1)?.next ?? null);
      const items = b.items; // triés : le plus avancé en premier
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.sx || it.sy) {
          const k = Math.hypot(it.sx ?? 0, it.sy ?? 0), nk = Math.max(0, k - speed);
          if (nk === 0) { delete it.sx; delete it.sy; } else { it.sx = (it.sx ?? 0) * nk / k; it.sy = (it.sy ?? 0) * nk / k; }
        }
        // Dans une boîte, si la sortie de l'objet n'existe plus, il en prend une autre (tout droit d'abord).
        if (nodeOuts && it.o !== undefined && !outOf(it.o)) {
          const alt = nodeOuts[0];
          if (!alt || alt.d === b.dir) delete it.o; else it.o = alt.d + 1;
        }
        // Le premier objet d'un séparateur prend une autre sortie si la sienne est bouchée.
        if (i === 0 && nodeOuts && b.node === 'sep' && nodeOuts.length > 1) {
          const want = outOf(it.o);
          if (!this.canTake(want, it.t)) {
            const alt = nodeOuts.find((o) => o.next !== want && this.canTake(o.next, it.t));
            if (alt) { if (alt.d === b.dir) delete it.o; else it.o = alt.d + 1; }
          }
        }
        const nxt = outOf(it.o);
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
                // Il arrive par le côté : il part du bord commun et glisse jusqu'au milieu (sauf depuis l'autre étage).
                const d = it.o === undefined ? b.dir : it.o - 1;
                if (d < 4) { moved.sx = -DX[d] * 0.5; moved.sy = -DY[d] * 0.5; }
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
            (nxt.machine.seenIn ??= {})[key(b.x, b.y)] = it.t;
            this.give(nxt.machine, it.t);
          } else {
            it.p = 1;
          }
        }
      }
    }

    this.stepWater();
    this.stepPower(dt);
    for (const m of this.machines.values()) {
      if (!m.built) continue;
      const def = machineDef(m.type);
      m.want = false;
      if (def.kind === 'drill') this.tickDrill(m, dt);
      else if (def.kind === 'crafter') this.tickCrafter(m, def, dt);
      else if (def.kind === 'atelier') this.tickAtelier(m, def, dt);
      else if (def.kind === 'rocket') this.tickRocket(m, dt);
      else if (def.kind === 'port_in' && this.host) {
        // Une entrée d'atelier : ce qui est entré dans l'atelier ressort ici, vers ce qui en a l'usage.
        const buf = this.host.inBuf;
        this.pushOutputs(m, buf, (b, t) => this.portSends(b, t));
        if (m.links?.length) this.pushLinks(m, buf, dt);
        m.status = this.bufCount(buf) ? 'working' : 'idle';
        for (const k of Object.keys(buf)) if (!buf[k]) delete buf[k];
      }
      if (def.kind === 'drill' || def.kind === 'crafter' || def.kind === 'storage' || def.kind === 'atelier') {
        const out = def.kind === 'storage' ? this.outOf(m) : m.outBuf;
        this.pushOutputs(m, out);
        if (m.links?.length) this.pushLinks(m, out, dt);
      }
    }
    if (this.lines.size) this.tickLines(dt);
  }

  private outCount(m: Machine): number {
    let n = 0;
    for (const v of Object.values(m.outBuf)) n += v;
    return n;
  }

  /** Ce qu'une foreuse extrait par seconde, avec son niveau. */
  drillRate(m: Machine): number {
    return (m.rate ?? 0) * Factory.levelSpeed(m);
  }

  /** Vitesse due au niveau : foreuses (1 à 5), machines qui fabriquent (1 à 3) ; 1 pour le reste. */
  static levelSpeed(m: Machine): number {
    const kind = machineDef(m.type).kind, lv = (m.lvl ?? 1) - 1;
    if (kind === 'drill') return RULES.drillLevelSpeed[Math.max(0, Math.min(4, lv))];
    if (kind === 'crafter') return RULES.machineLevelSpeed[Math.max(0, Math.min(2, lv))];
    return 1;
  }

  /** Les foreuses (2 × 2) ne se relient plus entre elles : chacune sort son minerai par ses propres tapis. */
  static isSmallDrill(_m: Machine): boolean {
    return false;
  }

  /** Les groupes : foreuses 1 × 1 construites qui se touchent par un côté, de n'importe quelle forme. */
  private buildDrillGroups(): void {
    this.drillGroups.clear();
    this.drillTurn.clear();
    for (const m of this.machines.values()) {
      if (!m.built || !Factory.isSmallDrill(m) || this.drillGroups.has(m)) continue;
      const group: Machine[] = [m];
      this.drillGroups.set(m, group);
      for (let i = 0; i < group.length; i++) {
        const c = group[i];
        for (let d = 0; d < 4; d++) {
          const o = this.cellMachine.get(key(c.x + DX[d], c.y + DY[d]));
          if (o && o.built && Factory.isSmallDrill(o) && !this.drillGroups.has(o)) { this.drillGroups.set(o, group); group.push(o); }
        }
      }
    }
  }

  /** Le groupe d'une foreuse 1 × 1 (elle seule si elle n'en touche aucune ; vide pour une autre machine). */
  drillGroup(m: Machine): Machine[] {
    this.refresh();
    return this.drillGroups.get(m) ?? (machineDef(m.type).kind === 'drill' ? [m] : []);
  }

  /** Nombre de sorties d'une machine : tapis qui en partent et liaisons directes. */
  private outletCount(m: Machine): number {
    return (this.outputs.get(m)?.length ?? 0) + (m.links?.length ?? 0);
  }

  /** Nombre de sorties d'un groupe de foreuses (tapis qui en partent et liaisons). */
  drillOutletTotal(m: Machine): number {
    return this.drillGroup(m).reduce((a, x) => a + this.outletCount(x), 0);
  }

  /** Les foreuses du groupe qui ont une sortie (tapis ou liaison) : tout le minerai du groupe part par elles. */
  drillOutlets(m: Machine): Machine[] {
    return this.drillGroup(m).filter((x) => this.outletCount(x) > 0);
  }

  /**
   * Où va un minerai extrait dans un groupe : la sortie la moins chargée (par tapis), pour que
   * deux sorties en reçoivent chacune la moitié. Sans sortie, il reste dans la foreuse.
   */
  private drillTarget(m: Machine, take = false): Machine {
    const group = this.drillGroups.get(m);
    if (!group || group.length < 2) return m;
    // Chaque sortie (tapis ou liaison) a son tour : deux sorties reçoivent chacune la moitié.
    const slots: Machine[] = [];
    for (const x of group) for (let i = this.outletCount(x); i > 0; i--) slots.push(x);
    if (!slots.length) return m;
    const turn = this.drillTurn.get(group) ?? 0;
    for (let s = 0; s < slots.length; s++) {
      const x = slots[(turn + s) % slots.length];
      if (this.outCount(x) < RULES.machineBuffer * this.outletCount(x)) {
        if (take) this.drillTurn.set(group, (turn + s + 1) % slots.length);
        return x;
      }
    }
    return slots[turn % slots.length];
  }

  private tickDrill(m: Machine, dt: number): void {
    if (!m.ore || !m.rate) { m.status = 'noore'; return; }
    const def = machineDef(m.type);
    const group = this.drillGroups.get(m);
    // Dans un groupe, ce qui attend dans une foreuse sans sortie rejoint une sortie dès qu'il y en a une.
    if (group && group.length > 1 && !this.outletCount(m)) {
      for (const t of Object.keys(m.outBuf)) {
        while ((m.outBuf[t] ?? 0) > 0) {
          const to = this.drillTarget(m, true);
          if (to === m || this.outCount(to) >= RULES.machineBuffer * this.outletCount(to)) break;
          m.outBuf[t]--; to.outBuf[t] = (to.outBuf[t] ?? 0) + 1;
        }
        if (!m.outBuf[t]) delete m.outBuf[t];
      }
    }
    const target = this.drillTarget(m);
    const cap = RULES.machineBuffer * Math.max(1, target === m ? 1 : this.outletCount(target));
    if (this.outCount(target) >= cap) { m.status = 'blocked'; m.drillT = Math.min(m.drillT, 1); return; }
    // Le charbon se partage dans le groupe : à vide, elle en prend un à la voisine qui en a le plus.
    if (group && group.length > 1 && def.coal && m.fuel <= 0 && m.burn <= 0 && !this.freeEnergy && !this.powered(m)) {
      let rich: Machine | null = null;
      for (const x of group) if (x !== m && x.fuel > (rich?.fuel ?? 0)) rich = x;
      if (rich) moveFuel(rich, m, 1);
    }
    // Sur du charbon, elle démarre même à vide : elle brûlera ce qu'elle extrait.
    const k = this.energy(m, def, dt);
    if (k <= 0 && !this.selfFed(m)) { m.status = this.noEnergy(m); return; }
    m.status = 'working';
    m.drillT += dt * this.drillRate(m) * (k > 0 ? k : 1);
    if (m.drillT >= 1) {
      m.drillT -= 1;
      m.made++;
      if (this.selfFed(m) && m.fuel < RULES.fuelStack) {
        m.fuel++; // sa propre case carburant d'abord
      } else {
        const to = this.drillTarget(m, true);
        to.outBuf[m.ore] = (to.outBuf[m.ore] ?? 0) + 1;
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
        // Mélangeur et raffinerie ont besoin d'eau (un tuyau depuis une pompe) : sans eau, ils s'arrêtent.
        const wf = this.waterFactor(m);
        if (wf <= 0) { m.status = 'nowater'; return; }
        m.craft.t += dt * k * Factory.levelSpeed(m) * wf;
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
      // Plus collées ni reliées par un pont (déplacées, tapis retiré) : la liaison ne passe plus.
      if (!this.touching(m, to) && !this.bridgeBetween(m, to)) continue;
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
  /**
   * Un pont direct entre deux machines : elles se font face, séparées seulement par des tapis
   * (1 à 4 cases, en ligne droite). Renvoie la ligne du pont (le milieu de leur bord commun), ou null.
   */
  bridgeBetween(a: Machine, b: Machine): { d: Dir; gap: number; lane: number } | null {
    const ox0 = Math.max(a.x, b.x), ox1 = Math.min(a.x + a.w, b.x + b.w);
    const oy0 = Math.max(a.y, b.y), oy1 = Math.min(a.y + a.h, b.y + b.h);
    let d: Dir, gap: number, lanes: number[];
    if (ox1 > ox0 && (b.y >= a.y + a.h || a.y >= b.y + b.h)) {
      d = b.y >= a.y + a.h ? 1 : 3;
      gap = d === 1 ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
      lanes = [...Array(ox1 - ox0).keys()].map((i) => ox0 + i);
    } else if (oy1 > oy0 && (b.x >= a.x + a.w || a.x >= b.x + b.w)) {
      d = b.x >= a.x + a.w ? 0 : 2;
      gap = d === 0 ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
      lanes = [...Array(oy1 - oy0).keys()].map((i) => oy0 + i);
    } else return null;
    if (gap < 1 || gap > RULES.bridgeSpan) return null;
    // Une ligne où toutes les cases entre elles sont des tapis (au plus près du milieu de leur bord commun).
    const mid = (lanes[0] + lanes[lanes.length - 1]) / 2;
    lanes.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
    for (const lane of lanes) {
      let ok = true;
      for (let k = 1; k <= gap && ok; k++) {
        const x = d === 0 ? a.x + a.w - 1 + k : d === 2 ? a.x - k : lane;
        const y = d === 1 ? a.y + a.h - 1 + k : d === 3 ? a.y - k : lane;
        ok = (!!this.beltAt(x, y) || !!this.beltAt(x, y, 1)) && !this.machineAt(x, y);
      }
      if (ok) return { d, gap, lane };
    }
    return null;
  }

  touching(a: Machine, b: Machine): boolean {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (ox === 0 && oy > 0) || (oy === 0 && ox > 0);
  }

  private bufCount(buf: Record<string, number>): number {
    let n = 0;
    for (const v of Object.values(buf)) n += v;
    return n;
  }

  // ---------- Ateliers (modules) ----------

  /** La machine au bout d'un tapis (en suivant la chaîne), ou null. */
  private chainTarget(b: Belt): Machine | null {
    let cur: Belt = b;
    for (let i = 0; i < 600; i++) {
      const n = this.nextOf.get(cur);
      if (!n) return null;
      if (n.kind === 'machine') return n.machine;
      cur = n.belt;
    }
    return null;
  }

  /** Cette machine pourrait-elle prendre cet objet (sans regarder si elle est pleine) ? */
  private takesType(m: Machine, item: string): boolean {
    const def = machineDef(m.type);
    if (def.kind === 'storage' || def.kind === 'port_out') return true;
    if (def.kind === 'atelier') return true;
    if (isFuel(item) && def.coal && !this.freeEnergy) return true;
    return def.kind === 'crafter' && this.acceptSet(def).has(item);
  }

  /** Une entrée d'atelier peut-elle faire sortir cet objet sur ce tapis ? */
  private portSends(b: Belt, item: string): boolean {
    const t = this.chainTarget(b);
    return !t || this.takesType(t, item);
  }

  /** L'intérieur de l'atelier a-t-il une entrée qui sait quoi faire de cet objet ? */
  atelierWants(m: Machine, item: string): boolean {
    const f = m.inner;
    if (!f) return false;
    f.refresh();
    for (const p of f.machines.values()) {
      if (machineDef(p.type).kind !== 'port_in' || !p.built) continue;
      if ((f.outputs.get(p) ?? []).some((b) => f.portSends(b, item))) return true;
      for (const id of p.links ?? []) { const to = f.machines.get(id); if (to && f.takesType(to, item)) return true; }
    }
    return false;
  }

  /** Rampe de lancement : pleine, elle compte cinq secondes, puis la fusée décolle (la rampe se vide). */
  private tickRocket(m: Machine, dt: number): void {
    if (m.craft) {
      m.craft.t += dt;
      m.status = 'working';
      if (m.craft.t >= RULES.rocketCountdown) {
        m.craft = null;
        for (const [k, n] of Object.entries(ROCKET_NEEDS)) { m.inBuf[k] = (m.inBuf[k] ?? 0) - n; if (m.inBuf[k] <= 0) delete m.inBuf[k]; }
        m.made++;
        this.stats.made.fusee = (this.stats.made.fusee ?? 0) + 1;
        this.onRocket(m);
      }
      return;
    }
    const full = Object.entries(ROCKET_NEEDS).every(([k, n]) => (m.inBuf[k] ?? 0) >= n);
    if (full) { m.craft = { ri: 0, t: 0 }; m.status = 'working'; return; }
    m.status = Object.keys(m.inBuf).length ? 'noinput' : 'idle';
  }

  /** Monte-charge : l'atelier se sert dans les coffres collés à lui (ce que son intérieur sait utiliser) et y range ce qui sort. */
  private tickLift(m: Machine, dt: number): void {
    const f = m.inner;
    if (!f || ![...f.machines.values()].some((x) => x.type === 'monte_charge' && x.built)) return;
    m.liftT = (m.liftT ?? 0) + dt;
    if (m.liftT < 0.25) return;
    m.liftT = 0;
    for (const s of this.machines.values()) {
      if (!s.built || machineDef(s.type).kind !== 'storage' || !this.touching(m, s)) continue;
      const sb = this.outOf(s);
      const k = Object.keys(sb).find((t) => sb[t] > 0 && this.bufCount(m.inBuf) < ATELIER_BUFFER && this.atelierWants(m, t));
      if (k) { sb[k]--; if (!sb[k]) delete sb[k]; m.inBuf[k] = (m.inBuf[k] ?? 0) + 1; }
      const o = Object.keys(m.outBuf).find((t) => m.outBuf[t] > 0 && this.storageRoom(s, t) > 0);
      if (o) { m.outBuf[o]--; if (!m.outBuf[o]) delete m.outBuf[o]; s.inBuf[o] = (s.inBuf[o] ?? 0) + 1; }
    }
  }

  /** Un atelier : son usine intérieure tourne tant qu'il a de quoi (charbon ou courant) pour toutes ses machines. */
  private tickAtelier(m: Machine, def: MachineDef, dt: number): void {
    const f = m.inner;
    if (!f) { m.status = 'idle'; return; }
    f.speedMult = this.speedMult;
    f.chestSlots = this.chestSlots;
    f.electric = this.electric;
    let busy = 0, any = 0;
    for (const x of f.machines.values()) {
      const k = machineDef(x.type).kind;
      if (k !== 'crafter' && k !== 'drill' && k !== 'atelier') continue;
      any++;
      if (x.status === 'working') busy++;
    }
    let k = 1;
    if (busy > 0) {
      // Au charbon, il brûle pour chacune de ses machines qui travaille.
      k = this.energy(m, def, dt * busy);
      if (k <= 0) { m.status = this.noEnergy(m); return; }
    }
    f.tick(dt * k);
    this.tickLift(m, dt);
    m.status = busy > 0 ? 'working' : any ? 'idle' : 'idle';
    if (busy > 0) {
      let made = 0;
      for (const x of f.machines.values()) made += x.made;
      if (made !== m.drillT) { if (made > m.drillT) m.made++; m.drillT = made; }
    }
  }

  private pushOutputs(m: Machine, buf: Record<string, number>, sends?: (b: Belt, item: string) => boolean): void {
    const outs = this.outputs.get(m);
    if (!outs || outs.length === 0) return;
    const all = Object.keys(buf).filter((k) => buf[k] > 0);
    if (all.length === 0) return;
    for (let s = 0; s < outs.length; s++) {
      const b = outs[(m.rrOut + s) % outs.length];
      if (!b.built) continue;
      const kinds = sends ? all.filter((k) => sends(b, k)) : all;
      if (!kinds.length) continue;
      // Même bouchée, la sortie sait ce qu'elle attend de faire passer.
      if (kinds.length === 1 && !m.seenOut?.[key(b.x, b.y)]) (m.seenOut ??= {})[key(b.x, b.y)] = kinds[0];
      const side = (b.feeds ?? []).some((fd) => this.machineAt(b.x + DX[fd], b.y + DY[fd]) === m) && this.machineAt(b.x - DX[b.inDir], b.y - DY[b.inDir]) !== m;
      if (side) {
        if (!this.roomAt(b, 0.5)) continue;
      } else {
        const rear = b.items.length ? b.items[b.items.length - 1].p : Infinity;
        if (rear < RULES.beltGap / span(b)) continue;
      }
      const t = kinds[(m.rrOut + s) % kinds.length];
      (m.seenOut ??= {})[key(b.x, b.y)] = t;
      buf[t]--;
      if (buf[t] === 0 && (buf === m.inBuf || sends)) delete buf[t];
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
      drills1: 1,
      drills2: 1,
      levels: 1,
      stations2: 1,
      cables: [...this.cables],
      pipes: [...this.pipes],
      lines: [...this.lines.values()].map((l) => ({ id: l.id, kind: l.kind, stops: l.stops.map((st) => ({ ...st })), vehicles: l.vehicles.map((v) => ({ ...v, cargo: { ...v.cargo } })), ...(l.track ? { track: { sig: l.track.sig, gap: l.track.gap, legs: l.track.legs.map((f) => [...f]) } } : {}) })),
      belts: [...this.belts.values()].map((b) => [b.x, b.y, b.dir, b.inDir, b.built ? 1 : 0, b.items.map((i) => [i.t, Math.round(i.p * 1000) / 1000, i.o ?? 0]), -1, b.feeds?.length ? 10 + b.feeds.reduce<number>((a, d) => a | (1 << d), 0) : -1, b.jump ?? 0, 0, b.meter ? 1 : 0, -1, '', 0, b.lvl ?? 1, '', b.z ?? 0, b.node ? { n: b.node, ...(b.rules ? { r: b.rules } : {}), ...(b.off ? { f: b.off } : {}), ...(b.vert ? { v: 1 } : {}), ...(b.jumps ? { j: b.jumps } : {}) } : 0]),
      machines: [...this.machines.values()].map((m) => ({
        id: m.id, type: m.type, x: m.x, y: m.y, built: m.built, inBuf: m.inBuf, outBuf: m.outBuf,
        fuel: m.fuel, carb: m.carb, burn: m.burn, craft: m.craft, drillT: m.drillT, choice: m.choice, made: m.made, links: m.links,
        ...(m.lvl && m.lvl > 1 ? { lvl: m.lvl } : {}),
        ...(m.rot ? { rot: m.rot } : {}),
        ...(m.plan !== undefined ? { plan: m.plan } : {}), ...(m.ports?.length ? { ports: m.ports.map((p) => ({ ...p })) } : {}),
        ...(m.seenIn ? { seenIn: { ...m.seenIn } } : {}), ...(m.seenOut ? { seenOut: { ...m.seenOut } } : {}),
        ...(m.charge ? { charge: Math.round(m.charge) } : {}),
        ...(m.inner ? { inner: m.inner.serialize(), size: m.size, ore: m.ore, rate: m.rate } : m.ore && this.freeEnergy ? { ore: m.ore, rate: m.rate } : {}),
      })),
    };
  }

  load(s: FactorySave): void {
    this.legacyRefund = 0;
    this.belts.clear(); this.machines.clear(); this.cellMachine.clear(); this.quays.clear(); this.cables.clear();
    this.routesDirty = true;
    for (const k of s.cables ?? []) this.cables.add(k);
    this.pipes.clear();
    for (const k of s.pipes ?? []) this.pipes.add(k);
    // Parties d'avant : les trieurs (retirés) sont remboursés.
    const oldPicks = new Map<number, string[]>();
    for (const [k, v] of s.picks ?? []) if (Array.isArray(v)) oldPicks.set(k, v.filter((t) => typeof t === 'string'));
    // Anciens séparateurs (une ou deux dérivations) : des boîtes dont seules ces sorties restent ouvertes (vu plus bas).
    const oldSplits: { b: Belt; outs: number[] }[] = [];
    for (const [x, y, dir, inDir, built, items, split, feed, jump, splitJump, meter, split2, filter, pick, lvl, filter2, z, node] of s.belts) {
      const b = this.addBelt(x, y, dir as Dir, inDir as Dir, built === 1, z ? 1 : 0);
      if (typeof lvl === 'number' && lvl > 1) b.lvl = Math.min(5, Math.floor(lvl));
      const s1 = split !== undefined && split >= 0 ? split : -1, s2 = s1 >= 0 && split2 !== undefined && split2 >= 0 ? split2 : -1;
      b.items = items.map(([t, p, o]) => {
        if (!o) return { t, p };
        if (node && typeof node === 'object') return { t, p, o };
        const d = o === 2 ? s2 : s1;
        return d >= 0 ? { t, p, o: d + 1 } : { t, p };
      });
      if (node && typeof node === 'object' && (node.n === 'sep' || node.n === 'tri')) {
        b.node = node.n;
        if (node.r && typeof node.r === 'object') for (const [d, l] of Object.entries(node.r)) if (Array.isArray(l) && l.length) (b.rules ??= {})[Number(d)] = l.filter((v) => typeof v === 'string');
        if (Array.isArray(node.f) && node.f.length) b.off = node.f.filter((d) => d >= 0 && d < 4);
        if (node.v) b.vert = 1;
        if (node.j && typeof node.j === 'object') for (const [d, n] of Object.entries(node.j)) if (n > 0) (b.jumps ??= {})[Number(d)] = Math.min(n, RULES.bridgeSpan);
      } else if (s1 >= 0) {
        b.node = filter || filter2 ? 'tri' : 'sep';
        if (filter) (b.rules ??= {})[s1] = [filter];
        if (filter2 && s2 >= 0) (b.rules ??= {})[s2] = [filter2];
        if (splitJump) b.jumps = { [s1]: Math.min(splitJump, RULES.bridgeSpan) };
        oldSplits.push({ b, outs: s2 >= 0 ? [s1, s2] : [s1] });
      }
      if (jump) b.jump = Math.min(jump, RULES.bridgeSpan);
      if (meter) this.addMeter(b);
      // Parties d'avant : le trieur était rangé sur le tapis.
      if (Array.isArray(pick)) oldPicks.set(key(x, y), pick.filter((t) => typeof t === 'string'));
      // Liaisons de côté : 10 + masque des sens (une ancienne sauvegarde : un seul sens, de 0 à 3).
      if (feed !== undefined && feed >= 0) {
        b.feeds = feed >= 10 ? ([0, 1, 2, 3] as Dir[]).filter((d) => (feed - 10) & (1 << d)) : [feed as Dir];
      }
    }
    this.nextId = 1;
    const oldDrills: FactorySave['machines'] = [];
    const bigDrills: FactorySave['machines'] = [];
    const oldStations: FactorySave['machines'] = [];
    for (const sm of s.machines) {
      // Chaque machine garde son numéro. (Avant, un numéro provisoire pouvait effacer
      // une machine déjà rechargée : elle disparaissait en laissant ses cases occupées.)
      sm.type = baseType(sm.type); // les anciennes « machines électriques » redeviennent des machines normales
      if (sm.type === 'super_foreuse' && !this.machines.has(sm.id)) { bigDrills.push(sm); continue; }
      // Bâtiments retirés du jeu (drones et revente) : leur prix est rendu.
      if (REMOVED_COST[sm.type] !== undefined) { this.legacyRefund += REMOVED_COST[sm.type]; continue; }
      if (!MACHINES[sm.type] || this.machines.has(sm.id)) continue;
      // Foreuse 1 × 1 (parties d'entre-deux) : regroupée en foreuses 2 × 2 plus bas, une fois les autres numéros connus.
      if (s.drills1 && !s.drills2 && sm.type === 'foreuse') { oldDrills.push(sm); continue; }
      // Ancienne gare (ou ancien dépôt) de 2 × 2 : reposé plus bas en 4 × 2 avec son quai, là où il y a la place.
      if (!s.stations2 && isStationType(sm.type)) { oldStations.push(sm); continue; }

      const rot = (isStationType(sm.type) ? (sm.rot ?? 0) & 3 : 0) as Rot;
      const m = this.addMachine(sm.type, sm.x, sm.y, sm.built, sm.id, rot);
      Object.assign(m, { inBuf: sm.inBuf, outBuf: sm.outBuf, fuel: Math.min(sm.fuel ?? 0, RULES.fuelStack), burn: sm.burn ?? 0, craft: sm.craft, drillT: sm.drillT, choice: sm.choice, made: sm.made ?? 0 });
      if (sm.carb) m.carb = Math.min(sm.carb, m.fuel);
      if (sm.links?.length) m.links = [...sm.links];
      // Dans un atelier, une foreuse garde le filon d'où elle vient.
      if (sm.ore && !m.ore) { m.ore = sm.ore; m.rate = sm.rate; }
      if (sm.charge) m.charge = sm.charge;
      if (typeof sm.lvl === 'number' && sm.lvl > 1) m.lvl = Math.min(5, Math.floor(sm.lvl));
      if (typeof sm.plan === 'number') m.plan = sm.plan;
      // Les filtres d'entrée et de sortie n'existent plus : il ne reste que les étiquettes prévues.
      if (sm.ports?.length) m.ports = sm.ports.filter((p) => p && (p.io === 'in' || p.io === 'out')).map((p) => ({ rx: p.rx, ry: p.ry, io: p.io, ...(p.item ? { item: p.item } : {}) }));
      if (sm.seenIn) m.seenIn = { ...sm.seenIn };
      if (sm.seenOut) m.seenOut = { ...sm.seenOut };
      if (sm.inner) this.makeInner(m, sm.size ?? 20).load(sm.inner);
    }
    // Les anciennes gares et anciens dépôts (2 × 2) deviennent des 4 × 2 avec quai : à leur place si elle est libre,
    // sinon tout près (la position et le sens les plus proches). Faute de place, leur prix est rendu.
    for (const sm of oldStations) {
      let spot: { x: number; y: number; rot: Rot } | null = null;
      search: for (let r = 0; r <= 8; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          for (const rot of [0, 2, 1, 3] as Rot[]) {
            if (this.checkMachine(sm.type, sm.x + dx, sm.y + dy, undefined, false, rot).ok) { spot = { x: sm.x + dx, y: sm.y + dy, rot }; break search; }
          }
        }
      }
      if (!spot) { this.legacyRefund += MACHINES[sm.type]?.cost ?? 0; continue; }
      const m = this.addMachine(sm.type, spot.x, spot.y, sm.built, sm.id, spot.rot);
      Object.assign(m, { inBuf: sm.inBuf ?? {}, outBuf: sm.outBuf ?? {}, made: sm.made ?? 0 });
    }
    // Les anciens séparateurs ne nourrissaient que leurs dérivations : les autres côtés sont coupés.
    for (const { b, outs } of oldSplits) {
      for (let d = 0; d < 4; d++) if (d !== b.dir && !outs.includes(d) && d !== opposite(b.inDir) && this.sideTarget(b, d, true)) this.setNodeOff(b, d, true);
    }
    this.nextId = Math.max(this.nextId, s.nextId);
    this.lines.clear();
    this.nextLine = 1;
    for (const sl of s.lines ?? []) {
      if (!sl.stops.every((st) => this.machines.has(st.id))) continue;
      this.lines.set(sl.id, { id: sl.id, kind: sl.kind, stops: sl.stops.map((st) => ({ ...st })), vehicles: sl.vehicles.map((v) => ({ ...v, cargo: { ...v.cargo } })), ...(sl.track && Array.isArray(sl.track.legs) ? { track: { sig: String(sl.track.sig), gap: Number(sl.track.gap) || 0, legs: sl.track.legs.map((f) => f.map(Number)) } } : {}) });
      this.nextLine = Math.max(this.nextLine, sl.id + 1);
    }
    // Les tapis souterrains n'existent plus : une ancienne partie récupère leur prix (4 pièces par case de trajet).
    for (const st of s.tunnels ?? []) this.legacyRefund += (st.cells.length + 1) * 4;
    // Les trieurs d'avant (retirés, comme les filtres) sont remboursés.
    this.legacyRefund += oldPicks.size * 20;
    // Les petites foreuses 1 × 1 (parties d'entre-deux) redeviennent des foreuses 2 × 2 : chaque carré qui en
    // couvre le plus en reprend le numéro, le charbon, le contenu et le meilleur niveau. Celles qui ne trouvent
    // pas de place sont remboursées, avec leurs niveaux.
    const big = MACHINES.foreuse;
    const smallLevels = [0, 20, 40, 80, 160];
    const left = new Map(oldDrills.map((sm) => [key(sm.x, sm.y), sm]));
    for (const sm of [...oldDrills].sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (!left.has(key(sm.x, sm.y))) continue;
      let best: { x: number; y: number; cover: typeof oldDrills } | null = null;
      for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const x = sm.x + ox, y = sm.y + oy;
        const cover = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => left.get(key(x + i, y + j))).filter((c): c is (typeof oldDrills)[number] => !!c);
        if (!cover.includes(sm)) continue;
        const inherited = !!sm.ore;
        if (!inherited && !this.checkMachine('foreuse', x, y).ok) continue;
        if (inherited && [[0, 0], [1, 0], [0, 1], [1, 1]].some(([i, j]) => this.cellMachine.has(key(x + i, y + j)) || this.belts.has(key(x + i, y + j)))) continue;
        if (!best || cover.length > best.cover.length) best = { x, y, cover };
      }
      if (!best) {
        left.delete(key(sm.x, sm.y));
        this.legacyRefund += 10 + smallLevels.slice(1, sm.lvl ?? 1).reduce((a, n) => a + n, 0);
        continue;
      }
      for (const c of best.cover) left.delete(key(c.x, c.y));
      const lead = best.cover[0];
      const m = this.addMachine('foreuse', best.x, best.y, best.cover.some((c) => c.built), lead.id);
      if (lead.ore) { m.ore = lead.ore; m.rate = best.cover.reduce((a, c) => a + (c.rate ?? 0), 0) * 4 / best.cover.length; }
      const lvl = Math.max(...best.cover.map((c) => c.lvl ?? 1));
      if (lvl > 1) m.lvl = Math.min(5, Math.floor(lvl));
      const outBuf: Record<string, number> = {};
      for (const c of best.cover) for (const [k, v] of Object.entries(c.outBuf ?? {})) outBuf[k] = (outBuf[k] ?? 0) + v;
      Object.assign(m, { inBuf: lead.inBuf ?? {}, outBuf, fuel: Math.min(best.cover.reduce((a, c) => a + (c.fuel ?? 0), 0), RULES.fuelStack), burn: lead.burn ?? 0, made: best.cover.reduce((a, c) => a + (c.made ?? 0), 0) });
      if (lead.carb) m.carb = Math.min(lead.carb, m.fuel);
      const links = best.cover.flatMap((c) => c.links ?? []);
      if (links.length) m.links = [...new Set(links)];
      // Quatre petites valaient 40 pièces, comme une grande ; moins de quatre : la grande est offerte.
      this.legacyRefund += Math.max(0, best.cover.length * 10 - big.cost);
    }
    // La Grande foreuse (4 × 4, 1500 pièces) est retirée : quatre foreuses 2 × 2 au niveau 3 sur ses cases,
    // et le reste de son prix est rendu.
    for (const sm of bigDrills) {
      let spent = 0, first: Machine | null = null;
      for (const [i, j] of [[0, 0], [2, 0], [0, 2], [2, 2]]) {
        const cx = sm.x + i, cy = sm.y + j;
        if (!this.checkMachine('foreuse', cx, cy).ok) continue;
        const m = this.addMachine('foreuse', cx, cy, sm.built, first ? undefined : sm.id);
        m.lvl = 3;
        spent += big.cost + RULES.drillLevelCost[1] + RULES.drillLevelCost[2];
        if (!first) {
          first = m;
          Object.assign(m, { outBuf: sm.outBuf ?? {}, fuel: Math.min(sm.fuel ?? 0, RULES.fuelStack), burn: sm.burn ?? 0, made: sm.made ?? 0 });
          if (sm.carb) m.carb = Math.min(sm.carb, m.fuel);
        }
      }
      this.legacyRefund += Math.max(0, 1500 - spent);
    }
    this.dirty = true;
  }
}

export interface FactorySave {
  nextId: number;
  cables?: number[];
  pipes?: number[];
  lines?: Line[];
  /** Trieurs : [case, objets]. */
  picks?: [number, string[]][];
  /** Anciennes parties : tapis souterrains (retirés du jeu, remboursés au chargement). */
  tunnels?: { cells: number[] }[];
  /** Foreuses 1 × 1 (sans ce drapeau : une ancienne partie, ses foreuses 2 × 2 sont coupées en quatre). */
  drills1?: 1;
  /** Foreuses redevenues 2 × 2 (sans groupes). */
  drills2?: 1;
  belts: [number, number, number, number, number, [string, number, number?][], number?, number?, number?, number?, number?, number?, string?, (number | string[])?, number?, string?, number?, (0 | { n: NodeKind; r?: Record<number, string[]>; f?: number[]; v?: 1; j?: Record<number, number> })?][];
  /** Tapis à niveaux (sans ce drapeau : une partie d'avant, où la vitesse était la même pour tous). */
  levels?: 1;
  machines: {
    id: number; type: string; x: number; y: number; built: boolean;
    inBuf: Record<string, number>; outBuf: Record<string, number>; fuel: number; carb?: number; burn?: number;
    craft: { ri: number; t: number } | null; drillT: number; choice?: string; made?: number; links?: number[];
    inner?: FactorySave; size?: number; ore?: string; rate?: number; charge?: number; lvl?: number;
    plan?: number; ports?: MachinePort[]; seenIn?: Record<number, string>; seenOut?: Record<number, string>; rot?: number;
  }[];
  /** Gares et dépôts de 4 × 2 avec quai (sans ce drapeau : une ancienne partie, ils faisaient 2 × 2). */
  stations2?: 1;
}

export { opposite };
export type { Rot };
