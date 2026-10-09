// Interface en HTML par-dessus le jeu, et logique des outils (tracer, poser, gommer, déplacer).
import { BIOME_COLORS, CELL, CHUNK, PALETTE, RULES } from '../config.ts';
import { isFuel, item, itemLabel, ITEM_LIST, RAW_IDS } from '../data/items.ts';
import { BUILDABLE, MACHINES, machineDef, type MachineDef } from '../data/machines.ts';
import type { Gestures, GestureHandlers } from '../input/gestures.ts';
import type { GameRenderer } from '../render/renderer.ts';
import { FLOW_WINDOW, ROCKET_NEEDS, type Belt, type Line, type Machine } from '../sim/factory.ts';
import { DEFAULT_ORDER, DRONE_PRIORITIES, Game, type DronePriority, type GameEvent, type OfflineReport } from '../sim/game.ts';
import { PRIO_ICONS } from './prioIcons.ts';
import { nodeForMachine } from '../data/unlocks.ts';
import { RARITY_LABEL, type Order } from '../sim/orders.ts';
import { CableTracer } from '../sim/cables.ts';
import { TunnelTracer } from '../sim/tunnels.ts';
import { ACHIEVEMENTS } from '../data/achievements.ts';
import { loadPlans, savePlans, type AtelierPlan } from '../save/plans.ts';
import { BeltTracer } from '../sim/tracer.ts';
import { DX, DY } from '../sim/geom.ts';
import { RICHNESS_LABEL } from '../world/world.ts';
import { ICONS } from './icons.ts';
import { TreeScreen } from './tree.ts';
import { craftableItems, maxCraftable } from '../sim/craft.ts';
import { Tips } from './tips.ts';
import { checkForUpdate, copyText } from './update.ts';
import { exportPanel, playTime } from './title.ts';
import { ALL_NODES, type UnlockNode } from '../data/unlocks.ts';
import { palierMission } from '../data/paliers.ts';
import { NODE_ICONS } from './nodeIcons.ts';

type Tool = 'none' | 'tapis' | 'machine' | 'gomme' | 'zone' | 'module' | 'move' | 'cable' | 'tuyau' | 'souterrain' | 'transport';

const STATUS_TEXT: Record<string, string> = {
  idle: 'En attente',
  working: 'En marche',
  blocked: 'Sortie pleine : branche un tapis ou vide la suite',
  nofuel: 'Plus de charbon : le voyant clignote, un drone va en apporter',
  noinput: 'Il manque un ingrédient',
  noore: 'Pas de filon dessous',
  nopower: 'Pas de courant : il faut un câble à 5 cases au plus, relié à un générateur qui a du charbon',
  nowater: 'Pas d’eau : relie-le par un tuyau à une pompe posée sur un lac',
};

/** Le verbe d'une étape de fabrication à la main, selon la machine qu'on imite. */
const MACHINE_VERB: Record<string, string> = {
  four: 'Fonte', presse: 'Pressage', tour: 'Tournage', trefileuse: 'Tréfilage', haut_fourneau: 'Fonte de l’acier',
  assembleur: 'Assemblage', broyeur: 'Broyage', melangeur: 'Mélange', raffinerie: 'Raffinage', fabricant: 'Montage', centrifugeuse: 'Centrifugation',
};

const GIFT_TEXT: Record<string, { title: string; lines: string[]; open: string }> = {
  comptoir: {
    title: 'Le Comptoir',
    lines: [
      'Il propose des commandes au choix. Apporte-lui les objets demandés : par un tapis, ou les drones les prennent dans tes coffres.',
      'Chaque commande livrée rapporte des pièces : c’est ta principale source d’argent pour construire.',
    ],
    open: 'Voir les commandes',
  },
  laboratoire: {
    title: 'Le Laboratoire',
    lines: [
      'Il garde les objets qui débloquent de nouvelles machines dans l’arbre. La Presse, par exemple, demande 20 lingots de fer.',
      'Apporte-les-lui, puis touche ton palier en haut à gauche pour ouvrir l’arbre.',
    ],
    open: 'Ouvrir le Laboratoire',
  },
};

const fmt = (n: number) => Math.floor(n).toLocaleString('fr-FR').replace(/ | /g, ' ');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export interface HudCallbacks {
  /** Retour au menu principal (sauvegarde puis recharge). */
  toTitle(): void;
  /** Avant une mise à jour : sauvegarde, et reprendre cette partie au rechargement. */
  beforeReload(): Promise<void>;
}


/** Une énergie gardée (kJ) en kWh : « 3,4 kWh ». */
function kWh(kj: number): string {
  return `${(Math.round(kj / 360) / 10).toString().replace('.', ',')}\u00a0kWh`;
}

/** Une puissance électrique : « 90 kW », « 1,2 MW ». */
function kW(n: number): string {
  return n >= 1000 ? `${(Math.round(n / 100) / 10).toString().replace('.', ',')}\u00a0MW` : `${Math.round(n)}\u00a0kW`;
}

export class Hud implements GestureHandlers {
  private root: HTMLElement;
  private game: Game;
  private r: GameRenderer;
  private cb: HudCallbacks;
  private tool: Tool = 'none';
  private machineType: string | null = null;
  private moving: Machine | null = null;
  /** Copie d'atelier en cours de pose (mode déplacement, mais on pose une copie). */
  private copying: Machine | null = null;
  /** Plan d'atelier en cours de pose (glissé depuis la palette). */
  private placingPlan: AtelierPlan | null = null;
  private tracer: BeltTracer | null = null;
  private lastErase: { x: number; y: number } | null = null;
  private cableTracer: CableTracer | null = null;
  private tunnelTracer: TunnelTracer | null = null;
  /** Cases déjà gommées pendant ce geste. */
  private erased = new Set<string>();
  /** Gomme en zone : le rectangle tracé (cases), en attente de confirmation une fois le doigt levé. */
  private zone: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private itemIcons = new Map<string, string>();
  private machineIcons = new Map<string, string>();

  // Éléments
  private lvlBadge!: HTMLElement;
  private lvlDot!: HTMLElement;
  private tree!: TreeScreen;
  private lvlTitle!: HTMLElement;
  private xpBar!: HTMLElement;
  private xpText!: HTMLElement;
  private money!: HTMLElement;
  private orderCard!: HTMLButtonElement;
  private minimap!: HTMLCanvasElement;
  private dayIcon!: HTMLElement;
  private weatherIcon!: HTMLElement;
  private weatherSig = '';
  private daySig = '';
  private palette!: HTMLElement;
  private toolButtons = new Map<string, HTMLButtonElement>();
  /** Options de l'outil en cours (Tapis / Sous-sol, Camion / Train). */
  private toolOpts!: HTMLElement;
  private bubble!: HTMLElement;
  private popover!: HTMLElement;
  private toasts!: HTMLElement;
  private overlay: HTMLElement | null = null;
  private popTimer = 0;
  private miniTimer = 0;
  /** Contenu de la feuille ouverte, pour la rafraîchir quand l'état change. */
  private sheetBuild: ((sheet: HTMLElement, close: () => void) => void) | null = null;
  private sheetDirty = false;
  private treeDirty = false;
  private refreshTimer = 0;
  private pressing = false;
  readonly tips: Tips;

  constructor(root: HTMLElement, game: Game, renderer: GameRenderer, cb: HudCallbacks) {
    this.root = root;
    this.game = game;
    this.r = renderer;
    this.cb = cb;
    for (const d of ITEM_LIST) this.itemIcons.set(d.id, renderer.itemIconDataUrl(d.id));
    for (const m of BUILDABLE) this.machineIcons.set(m.id, renderer.machineIconDataUrl(m.id));
    this.build();
    this.tips = new Tips(this.root, game);
    game.on((e) => this.onEvent(e));
    this.refreshAll();
  }

  attach(_g: Gestures): void { /* les gestes appellent les méthodes de GestureHandlers */ }

  // ---------- Construction du DOM ----------

  private build(): void {
    const top = h('div', 'top');
    const lvl = h('button', 'lvl lvl-btn');
    lvl.setAttribute('aria-label', 'Palier du Noyau et arbre de déblocages');
    lvl.onclick = () => this.openTree();
    this.lvlDot = h('span', 'lvl-dot hidden');
    this.lvlBadge = h('div', 'lvl-badge', '1');
    const info = h('div', 'lvl-info');
    this.lvlTitle = h('b', '', 'Palier 1');
    const bar = h('span', 'bar');
    this.xpBar = h('span');
    bar.append(this.xpBar);
    this.xpText = h('small');
    info.append(this.lvlTitle, bar, this.xpText);
    lvl.append(this.lvlBadge, info, this.lvlDot);
    const right = h('div', 'top-right');
    this.money = h('div', 'pill money');
    const menu = h('button', 'round', ICONS.menu);
    menu.setAttribute('aria-label', 'Menu');
    menu.onclick = () => this.openMenu();
    right.append(this.money, menu);
    top.append(lvl, right);

    const row = h('div', 'order-row');
    this.orderCard = h('button', 'order-card');
    this.orderCard.onclick = () => this.openNoyau();
    const mm = h('button', 'minimap');
    mm.setAttribute('aria-label', 'Recentrer sur le robot');
    this.minimap = h('canvas');
    this.minimap.width = 52 * 3; this.minimap.height = 52 * 3;
    mm.append(this.minimap);
    // Jour et nuit : un petit soleil (ou une lune) dans le coin de la mini-carte.
    this.dayIcon = h('span', 'daynight');
    this.weatherIcon = h('span', 'daynight weather hidden');
    mm.append(this.dayIcon, this.weatherIcon);
    // Toucher : la caméra se recentre sur le robot et le suit, jusqu'à ce qu'on la déplace.
    // Rester appuyé : la vraie carte.
    let pressT = 0, long = false;
    mm.addEventListener('pointerdown', () => {
      long = false;
      clearTimeout(pressT);
      pressT = window.setTimeout(() => { long = true; this.openMap(); }, 550);
    });
    const cancelPress = () => clearTimeout(pressT);
    mm.addEventListener('pointerup', cancelPress);
    mm.addEventListener('pointercancel', cancelPress);
    mm.addEventListener('pointerleave', cancelPress);
    mm.addEventListener('contextmenu', (e) => e.preventDefault());
    mm.onclick = () => {
      if (long) { long = false; return; }
      this.r.centerOnRobot();
      this.r.follow = true;
      this.closePopover();
    };
    row.append(this.orderCard, mm);

    this.palette = h('div', 'palette hidden');

    const toolbar = h('nav', 'toolbar');
    const tools: [string, string, string, boolean][] = [
      ['tapis', 'Tapis', ICONS.tapis, false],
      ['cable', 'Câble', ICONS.cable, true],
      ['machine', 'Machine', ICONS.machine, false],
      ['transport', 'Transport', ICONS.transport, true],
      ['module', 'Module', ICONS.module, true],
      ['gomme', 'Gomme', ICONS.gomme, false],
    ];
    for (const [id, label, icon, locked] of tools) {
      const b = h('button', `tool${locked ? ' locked' : ''}`, `${icon}${label}${locked ? `<span class="tool-lock">${ICONS.lock}</span>` : ''}`);
      // Le câble s'ouvre avec le Générateur.
      b.onclick = () => this.pickTool(id, id === 'cable' ? !this.game.isUnlocked('generateur') : id === 'transport' ? !this.game.isUnlocked('camion') : id === 'module' ? !this.game.isUnlocked('module') : locked);
      this.toolButtons.set(id, b);
      toolbar.append(b);
    }

    this.toolOpts = h('div', 'tool-opts hidden');
    this.bubble = h('div', 'bubble hidden');
    this.popover = h('div', 'popover hidden');
    this.toasts = h('div', 'toasts');
    this.root.append(top, row, this.palette, this.toolOpts, toolbar, this.bubble, this.popover, this.toasts);
    this.tree = new TreeScreen(this.root, this.game, this.itemIcons, () => { this.renderPalette(); this.refreshLevel(); });
    // On ne reconstruit pas une feuille pendant qu'un doigt appuie dessus (le bouton serait perdu).
    const press = (on: boolean) => () => { this.pressing = on; };
    this.root.addEventListener('pointerdown', press(true), true);
    window.addEventListener('pointerup', press(false), true);
    window.addEventListener('pointercancel', press(false), true);
  }

  /** Ouvre l'arbre de déblocages. */
  openTree(tab?: string, select?: string): void {
    this.closePopover();
    this.closeSheet();
    this.setTool('none');
    this.tree.open(tab, select);
  }

  /** Tuiles des nœuds de l'arbre (pour les feuilles du Noyau et du passage de palier). */
  private nodeTiles(nodes: UnlockNode[]): string {
    if (!nodes.length) return '';
    return `<div class="lv-ready">${nodes.map((x) => `<div><span class="lv-tile${x.effect.kind === 'soon' ? ' soon' : ''}">${NODE_ICONS[x.icon] ?? ''}</span><small>${esc(x.name)}</small></div>`).join('')}</div>`;
  }

  /** Passage de palier : une partie de l'arbre s'ouvre. */
  private palierUp(p: number): void {
    this.root.querySelector('.celebrate.level')?.remove();
    this.closePopover();
    const opened = ALL_NODES.filter((x) => x.palier === p && x.effect.kind !== 'soon').slice(0, 6);
    const next = palierMission(p);
    const box = h('div', 'celebrate level');
    box.innerHTML = `<div class="lv-badge">${p}</div><h2>Palier ${p} !</h2>
      <p>${opened.length ? 'Le Noyau ouvre de nouveaux déblocages. Apporte au Laboratoire les objets qu’ils demandent.' : 'Le Noyau grandit.'}</p>
      ${this.nodeTiles(opened)}
      ${next ? `<p class="muted-small">Prochaine mission : ${esc(next.pitch)}</p>` : '<p class="muted-small">C’était la dernière mission du Noyau.</p>'}`;
    const open = h('button', 'btn primary', 'Ouvrir l’arbre');
    open.style.width = '100%';
    open.onclick = () => { box.remove(); this.openTree(); };
    const later = h('button', 'btn', 'Plus tard');
    later.style.width = '100%';
    later.onclick = () => box.remove();
    box.append(open, later);
    this.root.append(box);
  }

  // ---------- Mises à jour ----------

  private onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'money': this.refreshMoney(true); break;
      case 'palier': {
        this.refreshLevel();
        this.refreshOrder();
        this.renderPalette();
        this.lvlBadge.classList.add('bump');
        setTimeout(() => this.lvlBadge.classList.remove('bump'), 400);
        this.closeSheet();
        this.palierUp(e.palier);
        this.treeDirty = true;
        break;
      }
      case 'lab': this.refreshLevel(); this.treeDirty = true; this.sheetDirty = true; break;
      case 'unlock': this.renderPalette(); this.refreshLevel(); this.refreshTools(); this.sheetDirty = true; break;
      case 'view': this.onView(); break;
      case 'rocket': this.rocketLaunched(e.n); break;
      case 'order': this.refreshOrder(); this.sheetDirty = true; break;
      case 'inventory': if (this.sheetKind) this.sheetDirty = true; break;
      case 'crafted': this.toast(`${this.game.look.name} a fabriqué ${itemLabel(e.item, e.n)}`, 'good'); break;
      case 'gift': this.onGift(e.building, e.id, !!e.again); break;
      case 'factory': if (this.tool === 'machine') this.renderPalette(); break;
      case 'orderDone': this.celebrate(e.order); break;
      case 'toast': this.toast(e.text, e.tone); break;
      case 'sold': this.toast(`Le gros drone a revendu ${e.count} objet${e.count > 1 ? 's' : ''} : +${fmt(e.money)} pièces`, 'good'); break;
      case 'drones': this.toast(`${this.game.droneCount} drones travaillent avec ton robot`, 'good'); break;
      default: break;
    }
  }

  private refreshAll(): void {
    this.refreshMoney(false);
    this.refreshLevel();
    this.refreshOrder();
    this.renderPalette();
  }

  private refreshMoney(flash: boolean): void {
    this.money.innerHTML = `${ICONS.coin}<span>${fmt(this.game.money)}</span>`;
    if (flash) {
      this.money.classList.remove('flash');
      void this.money.offsetWidth;
      this.money.classList.add('flash');
    }
  }

  /** Le bouton Câble perd son cadenas quand le Générateur est débloqué. */
  private refreshTools(): void {
    if (this.tool !== 'none') this.renderToolOpts();
    const inside = !!this.game.inAtelier;
    for (const [id, node] of [['cable', 'generateur'], ['transport', 'camion'], ['module', 'module']]) {
      const b = this.toolButtons.get(id);
      if (!b) continue;
      const locked = !this.game.isUnlocked(node) || (inside && (id !== 'module' || !this.game.nesting));
      b.classList.toggle('locked', locked);
      b.querySelector('.tool-lock')?.toggleAttribute('hidden', !locked);
    }
  }

  private refreshLevel(): void {
    this.refreshTools();
    const g = this.game;
    const pct = Math.floor(g.palierProgress() * 100);
    this.lvlBadge.textContent = String(g.palier);
    this.lvlTitle.textContent = `Palier ${g.palier}`;
    this.xpBar.style.width = `${pct}%`;
    this.xpText.textContent = g.finalPalier ? 'Le Noyau est complet' : `${pct} % vers le palier ${g.palier + 1}`;
    this.lvlDot.classList.toggle('hidden', g.unlockableCount() === 0);
  }

  /** La carte sous la barre du haut : la mission du Noyau. */
  private refreshOrder(): void {
    const g = this.game;
    const c = this.orderCard;
    const mission = palierMission(g.palier);
    c.classList.remove('choose');
    if (!mission) {
      c.innerHTML = `<div class="main"><span class="tag noyau">Noyau</span><b>Toutes les missions sont faites</b></div>`;
      return;
    }
    const needs = Object.entries(g.noyauNeeds());
    const total = Object.values(mission.lines).reduce((a, b) => a + b, 0);
    const done = total - needs.reduce((a, [, n]) => a + n, 0);
    const what = needs.map(([k, n]) => itemLabel(k, n)).join(' · ');
    c.innerHTML = `<div class="main"><span class="tag noyau">Mission du Noyau</span><b>${esc(what || 'Mission terminée')}</b></div>
      <div class="side"><b>${fmt(done)} / ${fmt(total)}</b><span class="mini-bar"><span style="width:${g.palierProgress() * 100}%"></span></span><small>Palier ${mission.to}</small></div>`;
  }

  /** Catégorie de la palette où range une machine. */
  private static paletteCat(m: MachineDef): string {
    if (m.id === 'depot' || m.id === 'gare') return 'transport';
    if (m.kind === 'atelier' || m.kind === 'port_in' || m.kind === 'port_out') return 'modules';
    if (m.kind === 'drill') return 'extraction';
    if (m.kind === 'generator' || m.kind === 'solar' || m.kind === 'battery' || m.kind === 'pump' || m.kind === 'reactor' || m.kind === 'charger' || m.kind === 'filter') return 'electricite';
    if (m.kind === 'crafter') return 'fabrication';
    if (m.kind === 'storage' || m.kind === 'sell') return 'stockage';
    return 'outils';
  }

  private paletteTab = '';

  private renderPalette(): void {
    const p = this.palette;
    p.innerHTML = '';
    const placed = new Set([...this.game.view.machines.values()].map((x) => x.type));
    if (this.machineType && machineDef(this.machineType).unique && placed.has(this.machineType)) this.machineType = 'foreuse';
    const inside = !!this.game.inAtelier;
    const OUTSIDE_ONLY = ['station', 'generateur', 'depot', 'gare', 'revente', 'foreuse', 'solaire', 'batterie', 'pompe', 'centrale', 'recharge', 'hangar', 'rampe', 'arbre', 'filtre', 'super_foreuse'];
    const list = BUILDABLE.filter((m) => this.game.hasMachine(m.id) && !m.gift && !(m.unique && placed.has(m.id))
      // Dans un atelier : ni foreuse, ni station, ni générateur, ni dépôt ; les entrées et sorties, seulement là.
      && (inside ? !OUTSIDE_ONLY.includes(m.id) && (m.id !== 'atelier' || this.game.nesting) : m.kind !== 'port_in' && m.kind !== 'port_out'));
    if (this.machineType && !list.some((m) => m.id === this.machineType)) this.machineType = list[0]?.id ?? null;
    // À partir de 10 machines, un sous-menu : des catégories, puis les machines de la catégorie choisie.
    const CATS: [string, string][] = [['modules', 'Modules'], ['extraction', 'Extraction'], ['fabrication', 'Fabrication'], ['electricite', 'Électricité'], ['stockage', 'Stockage'], ['transport', 'Transport'], ['outils', 'Outils']];
    let shown = list;
    if (list.length >= 10) {
      const present = CATS.filter(([id]) => list.some((m) => Hud.paletteCat(m) === id));
      if (!present.some(([id]) => id === this.paletteTab)) this.paletteTab = present[0]?.[0] ?? '';
      const cats = h('div', 'pal-cats');
      for (const [id, label] of present) {
        const n = list.filter((m) => Hud.paletteCat(m) === id).length;
        const c = h('button', `pal-cat${id === this.paletteTab ? ' on' : ''}`, `${esc(label)}<small>${n}</small>`);
        c.onclick = () => { this.paletteTab = id; this.renderPalette(); };
        cats.append(c);
      }
      p.append(cats);
      shown = list.filter((m) => Hud.paletteCat(m) === this.paletteTab);
    }
    const row = h('div', 'pal-row');
    for (const m of shown) {
      const b = h('button', 'mcard');
      b.innerHTML = `<img src="${this.machineIcons.get(m.id)}" alt="">${esc(m.name)}<small>${ICONS.coinSm}${m.cost}</small>`;
      // On ne pose qu'en glissant la carte jusqu'à sa place (un toucher ne fait que l'expliquer).
      b.onclick = () => {
        if (this.dragEnded) return;
        this.toast(`${m.name} : glisse sa carte jusqu’à sa place sur la carte`, 'info');
      };
      b.addEventListener('pointerdown', (e) => { this.placingPlan = null; this.cardDown(e, m.id, b); });
      row.append(b);
    }
    // Les plans d'ateliers enregistrés (dans toutes les parties), dans la catégorie Modules.
    const showPlans = this.game.hasMachine('atelier') && (!inside || this.game.nesting) && (list.length < 10 || this.paletteTab === 'modules');
    if (showPlans) {
      for (const plan of loadPlans()) {
        const b = h('button', 'mcard plan');
        b.innerHTML = `<img src="${this.machineIcons.get('atelier')}" alt="">${esc(plan.name)}<small>${ICONS.coinSm}${this.game.planPrice(plan.save)}</small><span class="plan-x" aria-label="Oublier ce plan">×</span>`;
        b.onclick = (ev) => {
          if ((ev.target as HTMLElement).classList.contains('plan-x')) {
            savePlans(loadPlans().filter((p) => p.id !== plan.id));
            this.toast(`Plan oublié : ${plan.name}`, 'info');
            this.renderPalette();
            return;
          }
          if (this.dragEnded) return;
          this.toast(`${plan.name} : glisse sa carte sur la carte pour poser l’atelier`, 'info');
        };
        b.addEventListener('pointerdown', (e) => { if (!(e.target as HTMLElement).classList.contains('plan-x')) { this.placingPlan = plan; this.cardDown(e, 'atelier', b); } });
        row.append(b);
      }
    }
    // Dernière carte : l'arbre, pour débloquer d'autres machines.
    const ready = this.game.unlockableCount();
    const more = h('button', 'mcard more', `<span style="width:40px;height:40px;display:flex">${NODE_ICONS.assembleur}</span>Débloquer<small>${ready ? `${ready} prêt${ready > 1 ? 's' : ''}` : `Palier ${this.game.palier}`}</small>`);
    more.onclick = () => this.openTree('production');
    row.append(more);
    p.append(row);
  }

  // ---------- Glisser une machine depuis la palette ----------

  private dragEnded = false;

  /** Glisser une carte vers le haut : la machine suit le doigt, la lâcher sur la carte la pose. */
  private cardDown(e: PointerEvent, type: string, card: HTMLElement): void {
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    // Pendant le glisser, la palette et la barre d'outils s'effacent : à leur place, une petite corbeille rouge
    // (y lâcher la machine annule).
    let trash: HTMLElement | null = null;
    const overTrash = (ev: PointerEvent) => {
      if (!trash) return false;
      const r = trash.getBoundingClientRect();
      return ev.clientX >= r.left - 16 && ev.clientX <= r.right + 16 && ev.clientY >= r.top - 16 && ev.clientY <= r.bottom + 16;
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!dragging) {
        if (dy < -12 && Math.abs(dy) > Math.abs(dx)) {
          dragging = true;
          this.machineType = type;
          this.palette.querySelectorAll('.mcard').forEach((c) => c.classList.toggle('selected', c === card));
          this.palette.classList.add('dragging');
          this.root.classList.add('dragging-machine');
          trash = h('div', 'drop-trash', `${ICONS.trash}<span>Lâche ici pour annuler</span>`);
          this.root.append(trash);
          this.closePopover();
        } else return;
      }
      ev.preventDefault();
      const hot = overTrash(ev);
      trash?.classList.toggle('hot', hot);
      if (hot) {
        this.dragAt = null;
        this.r.preview = null;
        this.r.guides = [];
        this.bubble.classList.add('hidden');
      } else {
        // Près du bord de l'écran, la carte défile (comme pour les tapis).
        this.dragAt = { x: ev.clientX, y: ev.clientY };
        this.updatePlacement(ev.clientX, ev.clientY);
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (!dragging) return;
      this.dragAt = null;
      this.palette.classList.remove('dragging');
      this.root.classList.remove('dragging-machine');
      const cancel = overTrash(ev);
      trash?.remove();
      this.dragEnded = true;
      setTimeout(() => { this.dragEnded = false; }, 350);
      const pv = this.r.preview;
      if (ev.type === 'pointerup' && pv?.kind === 'place' && pv.ok && !cancel) {
        if (this.placingPlan) this.game.placePlan(this.placingPlan.save, this.placingPlan.size, pv.x, pv.y);
        else this.game.placeMachine(type, pv.x, pv.y);
      }
      this.placingPlan = null;
      this.r.preview = null;
      this.r.guides = [];
      this.bubble.classList.add('hidden');
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }

  // ---------- Outils ----------

  private pickTool(id: string, locked: boolean): void {
    this.closePopover();
    if (locked) {
      const msg: Record<string, string> = {
        cable: 'Câbles : débloque le Générateur dans l’arbre (Énergie)',
        transport: 'Camions : débloque le Dépôt dans l’arbre (Logistique, palier 4)',
        module: 'Modules : débloque-les dans l’arbre (branche Modules, palier 5)',
      };
      this.toast(msg[id] ?? 'Bientôt', 'info');
      return;
    }
    // Dans un atelier : pas de câbles ni de camions, et un atelier dans l'atelier demande l'Imbrication.
    if (this.game.inAtelier && (id === 'cable' || id === 'transport')) {
      this.toast(id === 'cable' ? 'Dans un atelier, pas besoin de câbles : l’atelier alimente ses machines' : 'Les camions roulent dehors, pas dans un atelier', 'info');
      return;
    }
    if (this.game.inAtelier && id === 'module' && !this.game.nesting) {
      this.toast('Imbrication : à débloquer pour faire un atelier dans un atelier', 'info');
      return;
    }
    // Transport : la liste des lignes de camions et de trains.
    if (id === 'transport') { this.setTool('none'); this.openLines(); return; }
    const t = id as Tool;
    // Le bouton Tapis couvre aussi le sous-sol : on rouvre toujours sur les tapis normaux.
    const same = this.tool === t || (t === 'tapis' && this.tool === 'souterrain') || (t === 'gomme' && this.tool === 'zone') || (t === 'cable' && this.tool === 'tuyau');
    this.setTool(same ? 'none' : t);
  }

  /** Les options d'un outil, au-dessus de la barre : Tapis / Sous-sol. */
  private renderToolOpts(): void {
    const box = this.toolOpts;
    box.innerHTML = '';
    const g = this.game;
    let opts: { label: string; icon: string; on: boolean; locked: boolean; pick: () => void; why: string }[] = [];
    if ((this.tool === 'tapis' || this.tool === 'souterrain') && g.isUnlocked('souterrain') && !g.inAtelier) {
      opts = [
        { label: 'Tapis', icon: ICONS.tapis, on: this.tool === 'tapis', locked: false, pick: () => this.setTool('tapis'), why: '' },
        { label: 'Sous-sol', icon: ICONS.sousSol, on: this.tool === 'souterrain', locked: false, pick: () => this.setTool('souterrain'), why: '' },
      ];
    }
    if ((this.tool === 'cable' || this.tool === 'tuyau') && g.isUnlocked('pompe')) {
      opts = [
        { label: 'Câble', icon: ICONS.cable, on: this.tool === 'cable', locked: false, pick: () => this.setTool('cable'), why: '' },
        { label: 'Tuyau', icon: ICONS.pipe, on: this.tool === 'tuyau', locked: false, pick: () => this.setTool('tuyau'), why: '' },
      ];
    }
    if (this.tool === 'gomme' || this.tool === 'zone') {
      opts = [
        { label: 'Gomme', icon: ICONS.gomme, on: this.tool === 'gomme', locked: false, pick: () => this.setTool('gomme'), why: '' },
        { label: 'Zone', icon: ICONS.zone, on: this.tool === 'zone', locked: false, pick: () => this.setTool('zone'), why: '' },
      ];
    }
    box.classList.toggle('hidden', !opts.length);
    for (const o of opts) {
      const b = h('button', `topt${o.on ? ' on' : ''}${o.locked ? ' locked' : ''}`, `${o.icon}<span>${o.label}</span>${o.locked ? ICONS.lock : ''}`);
      b.onclick = () => { if (o.locked) { this.toast(o.why, 'info'); return; } o.pick(); };
      box.append(b);
    }
  }

  /**
   * Mode déplacement : la machine est entourée d'un cadre qui pulse, un bandeau dit quoi faire
   * (avec Annuler), et son fantôme suit le doigt.
   */
  private startMove(m: Machine): void {
    this.closeSheet();
    this.setTool('move');
    this.moving = m;
    this.r.movingId = m.id;
    this.root.querySelector('.move-banner')?.remove();
    const def = machineDef(m.type);
    const banner = h('div', 'move-banner');
    banner.innerHTML = `<span class="mb-ico">${ICONS.move}</span><div><b>Déplacer : ${esc(def.name)}</b><small>Pose le doigt sur la carte et glisse-la à sa nouvelle place${def.kind === 'station' ? ' (son rayon d’action suit)' : ''}</small></div>`;
    const cancel = h('button', 'btn', 'Annuler');
    cancel.onclick = () => this.setTool('none');
    banner.append(cancel);
    this.root.append(banner);
  }

  private setTool(t: Tool): void {
    this.clearZone();
    if (t !== 'move') this.copying = null;
    if (t !== 'move') {
      this.r.movingId = null;
      this.root.querySelector('.move-banner')?.remove();
    }
    this.tool = t;
    // Sous-sol : la surface pâlit, on voit les tapis souterrains.
    this.r.underground = t === 'souterrain';
    // Câble : mode électricité, on voit les câbles sous les blocs et les machines alimentées.
    this.r.electric = t === 'cable';
    this.r.waterView = t === 'tuyau';
    // Hors du mode câble, les câbles sont cachés (sauf avec la gomme, pour voir ce qu'on efface).
    this.r.showCables = t === 'gomme' || t === 'zone';
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', id === t || (id === 'tapis' && t === 'souterrain') || (id === 'gomme' && t === 'zone') || (id === 'cable' && t === 'tuyau'));
    this.renderToolOpts();
    this.palette.classList.toggle('hidden', t !== 'machine');
    if (t === 'machine' && !this.machineType) {
      this.machineType = 'foreuse';
      this.renderPalette();
    }
    if (t !== 'move') this.moving = null;
    this.r.preview = null;
    this.r.guides = [];
    this.bubble.classList.add('hidden');
  }

  toolActive(): boolean {
    // Avec la palette ouverte, la carte se déplace normalement : les machines se posent en glissant leur carte.
    return this.tool !== 'none' && this.tool !== 'machine' && !this.r.introRunning;
  }

  /** Pendant l'animation d'arrivée, l'interface reste cachée. */
  setIntro(on: boolean): void {
    this.root.classList.toggle('intro-hide', on);
  }

  private worldAt(sx: number, sy: number): { x: number; y: number } {
    const w = this.r.camera.screenToWorld(sx, sy);
    return { x: w.x / CELL, y: w.y / CELL };
  }

  tap(sx: number, sy: number): void {
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
    if (this.r.introRunning) { this.r.skipIntro(); return; }
    const w = this.worldAt(sx, sy);
    const cx = Math.floor(w.x), cy = Math.floor(w.y);
    const f = this.game.view;
    const m = f.machineAt(cx, cy);
    const rb = this.game.robot;
    if (!this.game.inAtelier && Math.hypot(w.x - rb.x, w.y - (rb.y - 0.6)) < 0.9) { this.openRobot(); return; }
    if (m?.type === 'noyau') { this.closePopover(); this.openNoyau(); return; }
    if (m?.built && m.type === 'comptoir') { this.closePopover(); this.openOrders(); return; }
    if (m?.built && m.type === 'laboratoire') { this.closePopover(); this.openLab(); return; }
    if (m?.built && machineDef(m.type).kind === 'storage') { this.openChest(m); return; }
    if (m?.built && m.type === 'revente') { this.openSell(m); return; }
    if (m?.built && ['crafter', 'drill', 'station', 'generator', 'atelier', 'solar', 'battery', 'pump', 'reactor', 'charger', 'rocket', 'filter'].includes(machineDef(m.type).kind)) { this.openMachine(m); return; }
    if (m) { this.select({ kind: 'machine', id: m.id }); return; }
    const b = f.beltAt(cx, cy);
    if (b) { this.select({ kind: 'belt', x: cx, y: cy }); return; }
    if (!this.popover.classList.contains('hidden')) { this.closePopover(); return; }
    if (this.game.inAtelier) return;
    this.game.sendRobot(w.x, w.y);
  }

  /** Position de pose d'une machine : un peu au-dessus du doigt, pour la voir. */
  private placeAt(sx: number, sy: number, type: string): { x: number; y: number } {
    const def = machineDef(type);
    const w = this.worldAt(sx, sy - 64);
    return { x: Math.round(w.x - def.w / 2), y: Math.round(w.y - def.h / 2) };
  }

  private updatePlacement(sx: number, sy: number): void {
    const type = this.tool === 'move' ? this.moving!.type : this.machineType!;
    const p = this.placeAt(sx, sy, type);
    const def = machineDef(type);
    const check = this.game.view.checkMachine(type, p.x, p.y, this.copying ? undefined : this.moving ?? undefined, true);
    this.r.preview = { kind: 'place', type, x: p.x, y: p.y, ok: check.ok, ore: check.ore };
    // Guides d'alignement avec les machines voisines.
    const cx = (p.x + def.w / 2) * CELL, cy = (p.y + def.h / 2) * CELL;
    const guides: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const m of this.game.view.machines.values()) {
      if (m === this.moving) continue;
      const mx = (m.x + m.w / 2) * CELL, my = (m.y + m.h / 2) * CELL;
      if (Math.abs(mx - cx) < 1 && Math.abs(my - cy) < CELL * 14) guides.push({ x0: cx, y0: cy, x1: mx, y1: my });
      else if (Math.abs(my - cy) < 1 && Math.abs(mx - cx) < CELL * 14) guides.push({ x0: cx, y0: cy, x1: mx, y1: my });
    }
    this.r.guides = guides;
    const s = this.r.camera.worldToScreen(cx, p.y * CELL);
    const onBelt = check.ok && check.belts ? ' · sur le tapis' : '';
    // Une foreuse sur un filon : ce qu'elle va extraire, en direct.
    if (def.kind === 'drill' && check.ok && check.ore) {
      const rate = (check.rate ?? 0).toFixed(2).replace('.', ',');
      const tail = this.tool === 'move' ? 'déplacer ici' : `${ICONS.coinSm}${def.cost}`;
      this.showBubble(s.x, s.y - 8, `<span class="rate"><img src="${this.itemIcons.get(check.ore)}" alt=""><b>${rate} / s</b></span> ${esc(item(check.ore).name.toLowerCase())} · ${tail}${onBelt}`, false);
      return;
    }
    const label = this.placingPlan ? (check.ok ? `${esc(this.placingPlan.name)} · ${ICONS.coinSm}${this.game.planPrice(this.placingPlan.save)}` : esc(check.reason ?? 'Impossible')) : this.copying ? (check.ok ? `Copie · ${ICONS.coinSm}${this.game.copyPrice(this.copying)}${onBelt}` : esc(check.reason ?? 'Impossible')) : this.tool === 'move' ? `Déplacer ici${onBelt}` : check.ok ? `${def.name} · ${ICONS.coinSm}${def.cost}${onBelt}` : esc(check.reason ?? 'Impossible');
    this.showBubble(s.x, s.y - 8, label, !check.ok);
  }

  private showBubble(x: number, y: number, html: string, bad: boolean): void {
    const b = this.bubble;
    b.innerHTML = html;
    b.classList.remove('hidden');
    b.classList.toggle('bad', bad);
    // La bulle reste entière à l'écran, même quand le doigt est près du bord.
    const half = Math.min(window.innerWidth / 2 - 8, b.offsetWidth / 2 + 8);
    b.style.left = `${Math.min(window.innerWidth - half, Math.max(half, x))}px`;
    b.style.top = `${Math.max(140, y)}px`;
  }

  /** Place la loupe en haut à droite, ou à gauche si le doigt passe dessous. */
  private updateLoupe(sx: number, sy: number): void {
    const size = 140;
    const top = (this.root.querySelector('.order-row') as HTMLElement).getBoundingClientRect().bottom + 16;
    const right = window.innerWidth - 16 - size;
    const cur = this.r.loupe;
    let x = cur ? cur.x : right;
    const under = (lx: number) => sx > lx - 30 && sx < lx + size + 30 && sy < top + size + 40;
    if (under(x)) x = x === right ? 16 : right;
    this.r.loupe = { fx: sx, fy: sy, x, y: top };
  }

  /** Où est le doigt pendant un tracé (pour faire défiler la carte quand il s'approche du bord). */
  private dragAt: { x: number; y: number } | null = null;

  private tracing(): boolean {
    return this.tool === 'tapis' || this.tool === 'souterrain' || this.tool === 'cable' || this.tool === 'tuyau' || ((this.tool === 'zone' || this.tool === 'module') && !!this.zone && !this.root.querySelector('.zone-banner')) || this.tool === 'move' || (this.tool === 'machine' && this.palette.classList.contains('dragging'));
  }

  /** Pendant un tracé, le doigt près du bord de l'écran fait défiler la carte, et le tracé suit. */
  private edgeScroll(dt: number): void {
    const p = this.dragAt;
    if (!p || !this.tracing()) return;
    const W = window.innerWidth, H = window.innerHeight;
    const zone = (d: number, size: number) => (d < size ? Math.pow(1 - Math.max(0, d) / size, 1.4) : 0);
    // Bords : un peu plus larges en haut (barre du palier) et en bas (barre d'outils).
    const vx = zone(W - p.x, 56) - zone(p.x, 56);
    const vy = zone(H - p.y, 150) - zone(p.y, 150);
    if (!vx && !vy) return;
    const cam = this.r.camera, speed = 620 / cam.zoom;
    cam.x += vx * speed * dt;
    cam.y += vy * speed * dt;
    this.r.follow = false;
    this.toolMove(p.x, p.y);
  }

  toolStart(sx: number, sy: number): void {
    this.closePopover();
    this.dragAt = { x: sx, y: sy };
    if (this.tool === 'tapis' || this.tool === 'gomme' || this.tool === 'cable' || this.tool === 'tuyau' || this.tool === 'souterrain') this.updateLoupe(sx, sy);
    const w = this.worldAt(sx, sy);
    if (this.tool === 'souterrain') {
      this.tunnelTracer = new TunnelTracer(this.game.view, this.game.world, w.x, w.y);
      this.r.preview = { kind: 'tunnel', tracer: this.tunnelTracer };
      const src = this.tunnelTracer.source;
      if (!src || !this.game.canSendUnder(src)) this.showBubble(sx, sy - 56, 'Pars d’un coffre ou d’une machine', true);
    } else if (this.tool === 'cable' || this.tool === 'tuyau') {
      this.cableTracer = new CableTracer(this.game.world, w.x, w.y);
      this.r.preview = { kind: this.tool === 'tuyau' ? 'pipe' : 'cable', tracer: this.cableTracer };
    } else if (this.tool === 'tapis') {
      this.tracer = new BeltTracer(this.game.view, w.x, w.y);
      this.tracer.bridges = this.game.isUnlocked('pont');
      this.r.preview = { kind: 'trace', tracer: this.tracer };
    } else if (this.tool === 'machine' || this.tool === 'move') {
      this.updatePlacement(sx, sy);
    } else if (this.tool === 'gomme') {
      this.lastErase = null;
      this.erased.clear();
      this.erase(w.x, w.y);
    } else if (this.tool === 'zone' || this.tool === 'module') {
      this.clearZone();
      const x = Math.floor(w.x), y = Math.floor(w.y);
      this.zone = { x0: x, y0: y, x1: x, y1: y };
      this.r.preview = { kind: 'eraseRect', ...this.zone, module: this.tool === 'module' };
      this.zoneBubble(sx, sy);
    }
  }

  /** Bulle de la gomme en zone : ce qui partira. */
  private zoneBubble(sx: number, sy: number): void {
    const z = this.zone;
    if (!z) return;
    const n = this.zoneCount();
    if (this.tool === 'module') {
      const k = this.game.areaContents(z.x0, z.y0, z.x1, z.y1).machines.length;
      this.showBubble(sx, sy - 56, k ? `${k} machine${k > 1 ? 's' : ''} à ranger dans un atelier` : 'Entoure les machines à ranger dans un atelier', false);
      return;
    }
    this.showBubble(sx, sy - 56, n ? `${n} élément${n > 1 ? 's' : ''} dans la zone` : 'Glisse pour encadrer ce qu’il faut supprimer', false);
  }

  private zoneCount(): number {
    const z = this.zone;
    if (!z) return 0;
    const c = this.game.areaContents(z.x0, z.y0, z.x1, z.y1);
    return c.machines.length + c.belts.length + c.cables.length;
  }

  /** Doigt levé : un bandeau demande confirmation, la zone reste affichée. */
  private confirmZone(): void {
    const z = this.zone;
    const n = this.zoneCount();
    if (!z || !n) { this.clearZone(); return; }
    if (this.tool === 'module') { this.confirmModule(); return; }
    const c = this.game.areaContents(z.x0, z.y0, z.x1, z.y1);
    const parts = [
      c.machines.length ? `${c.machines.length} machine${c.machines.length > 1 ? 's' : ''}` : '',
      c.belts.length ? `${c.belts.length} tapis` : '',
      c.cables.length ? `${c.cables.length} câble${c.cables.length > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(', ');
    const banner = h('div', 'move-banner zone-banner');
    banner.innerHTML = `<span class="mb-ico">${ICONS.zone}</span><div><b>Supprimer ${n} élément${n > 1 ? 's' : ''} ?</b><small>${esc(parts)} · remboursé, mais ce que contiennent les machines est perdu</small></div>`;
    const no = h('button', 'btn', 'Annuler');
    no.onclick = () => this.clearZone();
    const yes = h('button', 'btn danger', `${ICONS.trash}Supprimer`);
    yes.onclick = () => {
      const zz = this.zone;
      this.clearZone();
      if (!zz) return;
      const k = this.game.removeArea(zz.x0, zz.y0, zz.x1, zz.y1);
      if (k) this.toast(`${k} élément${k > 1 ? 's' : ''} supprimé${k > 1 ? 's' : ''}`, 'info');
    };
    banner.append(no, yes);
    this.root.append(banner);
    this.r.preview = { kind: 'eraseRect', ...z };
  }

  /** Outil Module, doigt levé : un bandeau propose de ranger la zone dans un atelier. */
  private confirmModule(): void {
    const z = this.zone!;
    const c = this.game.areaContents(z.x0, z.y0, z.x1, z.y1);
    if (!c.machines.length) { this.clearZone(); this.toast('Entoure au moins une machine', 'info'); return; }
    const k = c.machines.length;
    const banner = h('div', 'move-banner zone-banner module-banner');
    banner.innerHTML = `<span class="mb-ico">${ICONS.module}</span><div><b>Ranger ${k} machine${k > 1 ? 's' : ''} dans un atelier ?</b><small>Elles et leurs tapis tiennent dans un bloc de 3 × 3 qui produit pareil · ${ICONS.coinSm}${machineDef('atelier').cost}. Rebranche ensuite les tapis du dehors sur l’atelier.</small></div>`;
    const no = h('button', 'btn', 'Annuler');
    no.onclick = () => this.clearZone();
    const yes = h('button', 'btn primary', `${ICONS.module}Créer l’atelier`);
    yes.onclick = () => {
      const zz = this.zone;
      this.clearZone();
      if (!zz) return;
      const a = this.game.createAtelier(zz.x0, zz.y0, zz.x1, zz.y1);
      if (a) this.setTool('none');
    };
    banner.append(no, yes);
    this.root.append(banner);
    this.r.preview = { kind: 'eraseRect', ...z, module: true };
  }

  /** On entre dans un atelier ou on en sort : outils, palette et bandeau suivent. */
  private onView(): void {
    this.setTool('none');
    this.closeSheet();
    this.closePopover();
    this.renderPalette();
    this.refreshTools();
    this.renderAtelierBar();
  }

  /** Le bandeau du haut dans un atelier : où l'on est, et Sortir. */
  private renderAtelierBar(): void {
    this.root.querySelector('.atelier-bar')?.remove();
    this.root.classList.toggle('in-atelier', !!this.game.inAtelier);
    const path = this.game.atelierPath;
    if (!path.length) return;
    const bar = h('div', 'atelier-bar');
    const inner = path[path.length - 1];
    const n = inner.inner ? [...inner.inner.machines.values()].filter((m) => !['port_in', 'port_out'].includes(machineDef(m.type).kind)).length : 0;
    bar.innerHTML = `<span class="ab-ico">${ICONS.module}</span><div><b>${path.length > 1 ? `Atelier ${'› '.repeat(path.length - 1)}` : ''}Dans l’atelier</b><small>${inner.size} × ${inner.size} cases · ${n} machine${n > 1 ? 's' : ''} · pose des <b>Entrées</b> et des <b>Sorties</b> pour relier le dehors</small></div>`;
    const out = h('button', 'btn primary', 'Sortir');
    out.onclick = () => this.game.leaveAtelier();
    bar.append(out);
    this.root.append(bar);
  }

  /** Copier un atelier : comme un déplacement, mais on pose une copie (le prix s'affiche). */
  private startCopy(m: Machine): void {
    this.startMove(m);
    this.copying = m;
    const b = this.root.querySelector('.move-banner b');
    if (b) b.textContent = `Copier l’atelier · ${this.game.copyPrice(m)} pièces`;
    const sm = this.root.querySelector('.move-banner small');
    if (sm) sm.textContent = 'Pose le doigt sur la carte et glisse la copie à sa place (elle part vide)';
  }

  private clearZone(): void {
    this.zone = null;
    this.root.querySelector('.zone-banner')?.remove();
    if (this.r.preview?.kind === 'eraseRect') this.r.preview = null;
  }

  toolMove(sx: number, sy: number): void {
    this.dragAt = { x: sx, y: sy };
    const w = this.worldAt(sx, sy);
    if (this.tool === 'tapis' || this.tool === 'gomme' || this.tool === 'cable' || this.tool === 'souterrain') this.updateLoupe(sx, sy);
    if (this.tool === 'souterrain' && this.tunnelTracer) {
      const t = this.tunnelTracer;
      if (!t.source || !this.game.canSendUnder(t.source)) return;
      t.move(w.x, w.y);
      const price = this.game.tunnelPrice(t.cells.length);
      const name = t.target ? machineDef(t.target.type).name.toLowerCase() : '';
      const label = t.target ? `Lâche pour relier à ${esc(name)} · ${ICONS.coinSm}${price}` : t.cells.length ? `${t.cells.length + 1} cases sous terre · glisse jusqu’à un coffre ou une machine` : 'Glisse vers un coffre ou une machine';
      this.showBubble(sx, sy - 56, label, t.blocked || (!!t.target && this.game.money < price));
      return;
    }
    if (this.tool === 'tuyau' && this.cableTracer) {
      const t = this.cableTracer;
      t.move(w.x, w.y);
      const fresh = t.cells.filter((c) => !this.game.view.hasPipe(c.x, c.y)).length;
      const price = fresh * RULES.pipeCost;
      this.showBubble(sx, sy - 56, fresh ? `${fresh} tuyau${fresh > 1 ? 'x' : ''} · ${ICONS.coinSm}${price}` : 'Glisse pour tracer un tuyau', this.game.money < price);
      return;
    }
    if (this.tool === 'cable' && this.cableTracer) {
      const t = this.cableTracer;
      t.move(w.x, w.y);
      const fresh = t.cells.filter((c) => !this.game.view.hasCable(c.x, c.y)).length;
      const price = fresh * RULES.cableCost;
      this.showBubble(sx, sy - 56, fresh ? `${fresh} câble${fresh > 1 ? 's' : ''} · ${ICONS.coinSm}${price}` : 'Glisse pour tracer un câble', t.blocked || this.game.money < price);
      return;
    }
    if (this.tool === 'tapis' && this.tracer) {
      this.tracer.move(w.x, w.y);
      const n = this.tracer.newCount, nb = this.tracer.bridgeCount;
      const price = n * RULES.beltCost + nb * RULES.bridgeCost;
      const ok = this.tracer.valid && !this.tracer.blocked;
      const affordable = this.game.money >= price;
      const what = (this.tracer.splitFrom ? 'Séparateur · ' : '') + (nb ? `${nb > 1 ? `${nb} ponts` : 'Pont'} · ` : '');
      if (this.tracer.linkBelt) {
        this.showBubble(sx, sy - 56, 'Lâche pour relier la machine à ce tapis', false);
        return;
      }
      if (this.tracer.linkMachine) {
        this.showBubble(sx, sy - 56, `Lâche pour relier à ${esc(machineDef(this.tracer.linkMachine.type).name.toLowerCase())}`, false);
        return;
      }
      if (this.tracer.intoMachine !== null) {
        this.showBubble(sx, sy - 56, 'Lâche pour que le tapis nourrisse cette machine', false);
        return;
      }
      if (this.tracer.turnsOnly) {
        const tm = this.tracer.endTarget ? this.game.view.machineAt(this.tracer.endTarget.x, this.tracer.endTarget.y) : null;
        this.showBubble(sx, sy - 56, tm ? `Lâche pour tourner le tapis vers ${esc(machineDef(tm.type).name.toLowerCase())}` : 'Lâche pour tourner le bout du tapis', false);
        return;
      }
      const locked = !!this.tracer.splitFrom && !this.game.isUnlocked('separateur');
      const label = locked ? 'Séparateur : à débloquer dans l’arbre' : n > 0 ? `${what}${n} case${n > 1 ? 's' : ''} · ${ICONS.coinSm}${price}` : this.tracer.splitFrom ? 'Glisse sur le côté pour séparer' : 'Glisse pour tracer';
      this.showBubble(sx, sy - 56, label, locked || !ok || !affordable);
    } else if (this.tool === 'machine' || this.tool === 'move') {
      this.updatePlacement(sx, sy);
    } else if (this.tool === 'gomme') {
      this.erase(w.x, w.y);
    } else if ((this.tool === 'zone' || this.tool === 'module') && this.zone) {
      this.zone.x1 = Math.floor(w.x);
      this.zone.y1 = Math.floor(w.y);
      this.r.preview = { kind: 'eraseRect', ...this.zone, module: this.tool === 'module' };
      this.zoneBubble(sx, sy);
    }
  }

  toolEnd(cancelled: boolean): void {
    this.dragAt = null;
    this.bubble.classList.add('hidden');
    const pv = this.r.preview;
    if (!cancelled) {
      if (this.tool === 'souterrain' && this.tunnelTracer?.source && this.tunnelTracer.target) {
        this.game.placeTunnel(this.tunnelTracer.source, this.tunnelTracer.target, this.tunnelTracer.cells);
      } else if (this.tool === 'cable' && this.cableTracer) {
        this.game.placeCables(this.cableTracer.cells);
      } else if (this.tool === 'tuyau' && this.cableTracer) {
        this.game.placePipes(this.cableTracer.cells);
      } else if (this.tool === 'tapis' && this.tracer?.linkMachine && this.tracer.startMachine) {
        this.game.linkMachines(this.tracer.startMachine, this.tracer.linkMachine);
      } else if (this.tool === 'tapis' && this.tracer?.linkBelt && this.tracer.linkDir !== null) {
        this.game.linkMachineToBelt(this.tracer.linkBelt, this.tracer.linkDir);
      } else if (this.tool === 'tapis' && this.tracer?.splitFrom && this.tracer.intoMachine !== null) {
        this.game.linkBeltToMachine(this.tracer.splitFrom, this.tracer.intoMachine);
      } else if (this.tool === 'tapis' && this.tracer?.valid) {
        const t = this.tracer;
        this.game.placeBelts(t.result(), t.splitFrom && t.splitDir !== null ? { from: t.splitFrom, dir: t.splitDir, jump: t.splitJump } : undefined);
      } else if (this.tool === 'machine' && pv?.kind === 'place' && this.machineType) {
        this.game.placeMachine(this.machineType, pv.x, pv.y);
      } else if (this.tool === 'move' && pv?.kind === 'place' && this.moving && this.copying) {
        if (this.game.copyAtelier(this.copying, pv.x, pv.y)) this.setTool('none');
      } else if (this.tool === 'move' && pv?.kind === 'place' && this.moving) {
        this.game.moveMachine(this.moving, pv.x, pv.y);
        this.setTool('none');
      }
    }
    this.tracer = null;
    this.cableTracer = null;
    this.tunnelTracer = null;
    this.r.preview = null;
    this.r.guides = [];
    this.r.loupe = null;
    if (this.tool === 'zone' || this.tool === 'module') {
      if (cancelled) this.clearZone(); else this.confirmZone();
    }
  }

  private erase(wx: number, wy: number): void {
    const x = Math.floor(wx), y = Math.floor(wy);
    this.r.preview = { kind: 'erase', x, y };
    // On gomme aussi les cases entre deux positions du doigt.
    const from = this.lastErase ?? { x, y };
    const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y), 1);
    for (let i = 0; i <= steps; i++) {
      const cx = Math.round(from.x + ((x - from.x) * i) / steps), cy = Math.round(from.y + ((y - from.y) * i) / steps);
      // Une case n'est gommée qu'une fois par geste : sous un pont, le premier coup retire le pont, le suivant le tapis.
      const ck = `${cx},${cy}`;
      if (this.erased.has(ck)) continue;
      this.erased.add(ck);
      const m = this.game.view.machineAt(cx, cy);
      if (m?.type === 'noyau' || (m && machineDef(m.type).gift)) continue;
      this.game.removeAt(cx, cy);
    }
    this.lastErase = { x, y };
  }

  cameraMoved(): void {
    this.r.stopFocus();
    this.r.follow = false;
    if (!this.popover.classList.contains('hidden')) this.positionPopover();
  }

  // ---------- Bulle d'une construction ----------

  private select(sel: GameRenderer['selection']): void {
    this.r.selection = sel;
    this.renderPopover();
    this.popover.classList.remove('hidden');
    this.positionPopover();
  }

  private closePopover(): void {
    this.r.selection = null;
    this.popKey = '';
    this.popover.classList.add('hidden');
  }

  private chips(buf: Record<string, number>): string {
    return Object.entries(buf).filter(([, n]) => n > 0)
      .map(([id, n]) => `<span class="chip"><img src="${this.itemIcons.get(id)}" alt="">${fmt(n)} ${esc(n > 1 ? item(id).plural : item(id).name.toLowerCase())}</span>`).join('');
  }

  private renderPopover(): void {
    const sel = this.r.selection;
    const p = this.popover;
    const f = this.game.view;
    if (sel?.kind === 'machine') {
      const m = f.machines.get(sel.id);
      if (!m) { this.closePopover(); return; }
      const def = machineDef(m.type);
      let title = def.name, text = '';
      if (!m.built) {
        text = 'En construction.';
      } else if (def.kind === 'drill') {
        const patch = this.game.world.patchAt(m.x, m.y) ?? this.game.world.patchAt(m.x + 1, m.y + 1);
        title = `Foreuse · ${m.ore ? item(m.ore).name.toLowerCase() : '?'}`;
        text = `${STATUS_TEXT[m.status]}. Filon ${patch ? RICHNESS_LABEL[patch.richness] : ''} : ${(m.rate ?? 0).toFixed(2).replace('.', ',')} par seconde.`;
      } else if (def.kind === 'sell') {
        const g = this.game, n = g.sellCount(m);
        const t = Math.ceil(g.nextPickup), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
        const coming = g.pickups.some((x) => x.id === m.id && !x.done);
        text = `Tout ce qu’un tapis y apporte est revendu, à bas prix. ${coming ? 'Le gros drone arrive !' : `Prochain passage du gros drone dans ${mm} min ${ss}.`} ${n} objet${n > 1 ? 's' : ''} sur ${RULES.sellCap} · environ ${g.sellValue(m)} pièces.`;
      } else {
        text = def.kind === 'storage'
          ? `${def.hint}. ${this.game.view.storageSlots(m)} cases sur 10 occupées.`
          : `${STATUS_TEXT[m.status]}. ${def.hint}.`;
      }
      const fuelLine = m.built && def.coal ? this.gauge('Carburant', m.fuel, this.game.view.fuelCap(m), this.game.view.lowFuel(m), m.carb) : '';
      const inChips = this.chips(m.inBuf);
      const outChips = this.chips(m.outBuf);
      const recipes = m.built ? this.recipesHtml(def, m) : '';
      let choice = '';
      if (m.type === 'raffinerie') {
        const cur = m.choice ?? 'plastique';
        choice = `<div class="row"><button class="btn ${cur === 'plastique' ? 'primary' : ''}" data-choice="plastique">Plastique</button><button class="btn ${cur === 'carburant' ? 'primary' : ''}" data-choice="carburant">Carburant</button></div>`;
      }
      const info = `<h3>${esc(title)}</h3><p>${esc(text)}</p>${fuelLine}<p class="refund">${m.built ? 'Supprimer' : 'Annuler'} rend ${def.cost} ${ICONS.coinSm}</p>
        ${recipes}
        ${inChips ? `<p>${def.kind === 'storage' || def.kind === 'sell' ? 'Contenu' : 'En attente'}</p><div class="chips">${inChips}</div>` : ''}
        ${outChips ? `<p>Prêt à sortir</p><div class="chips">${outChips}</div>` : ''}`;
      const actions = `${choice}<div class="row">
          ${m.built ? `<button class="btn" data-act="move">${ICONS.move}Déplacer</button>` : ''}
          <button class="btn danger" data-act="del">${ICONS.trash}${m.built ? 'Supprimer' : 'Annuler'}</button>
        </div>`;
      if (!this.setPopover(`m${m.id}`, info, actions)) return;
      p.querySelector<HTMLButtonElement>('[data-act="del"]')!.onclick = () => { this.game.removeMachine(m); this.closePopover(); };
      const mv = p.querySelector<HTMLButtonElement>('[data-act="move"]');
      if (mv) mv.onclick = () => { this.closePopover(); this.startMove(m); };
      p.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) => {
        b.onclick = () => { f.setChoice(m, b.dataset.choice!); this.renderPopover(); };
      });
    } else if (sel?.kind === 'robot') {
      this.closePopover();
    } else if (sel?.kind === 'belt') {
      const b = f.beltAt(sel.x, sel.y);
      if (!b) { this.closePopover(); return; }
      const chain = f.chainOf(b);
      const items = chain.reduce((s, c) => s + c.items.length, 0);
      const pending = chain.some((c) => !c.built);
      const isSplit = b.split !== undefined && !f.machineAt(b.x + DX[b.split], b.y + DY[b.split]);
      const splitter = !isSplit ? '' : b.filter
        ? `<p><b>Tri</b> : seul ${esc(item(b.filter).name.toLowerCase())} part dans la dérivation ; tout le reste continue tout droit.</p>`
        : '<p>Séparateur : un objet sur deux part dans la dérivation. Si une sortie est pleine, tout passe par l’autre.</p>';
      // Un compteur sur la chaîne : son débit, matière par matière.
      const mb = chain.find((c) => c.meter);
      let meter = '';
      if (mb) {
        const r = f.meterRates(mb);
        const parts = Object.entries(r.by).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${esc(item(k).name.toLowerCase())} ${fmtN(v)}`);
        meter = `<p><b>Compteur : ${fmtN(r.total)} objet${r.total >= 2 ? 's' : ''} par seconde</b>${parts.length ? ` (${parts.join(', ')})` : ''}, sur les 20 dernières secondes. La gomme le retire avant le tapis.</p>`;
      }
      const info = `<h3>${splitter ? 'Séparateur' : 'Tapis'} · ${chain.length} case${chain.length > 1 ? 's' : ''}</h3>${splitter}${meter}
        <p>${pending ? 'En construction.' : items ? `${items} objet${items > 1 ? 's' : ''} en route.` : 'Vide pour l’instant.'} Pour en effacer une partie, prends la gomme.</p><p class="refund">Supprimer rend ${chain.length} ${ICONS.coinSm}</p>`;
      const feeders = (b.feeds ?? []).map((d) => f.machineAt(b.x + DX[d], b.y + DY[d])).filter((m): m is Machine => !!m);
      const fed = b.split !== undefined ? f.machineAt(b.x + DX[b.split], b.y + DY[b.split]) : null;
      const fed2 = b.split2 !== undefined ? f.machineAt(b.x + DX[b.split2], b.y + DY[b.split2]) : null;
      const linked = feeders.length > 0 || !!fed;
      const fedText = fed && fed2
        ? `<p>Ce tapis nourrit ${esc(machineDef(fed.type).name.toLowerCase())} et ${esc(machineDef(fed2.type).name.toLowerCase())} de part et d’autre, et continue tout droit : un objet sur trois pour chacun.</p>`
        : fed ? `<p>Ce tapis nourrit ${esc(machineDef(fed.type).name.toLowerCase())} par le côté : un objet sur deux y entre. Il peut aussi nourrir une machine collée de l’autre côté : pars de cette case vers elle.</p>` : '';
      const linkInfo = `${feeders.map((m) => `<p>${esc(machineDef(m.type).name)} y dépose sa production par le côté.</p>`).join('')}${fedText}`;
      const sortBtn = isSplit && this.game.isUnlocked('tri') ? `<div class="row"><button class="btn" data-act="sort">${b.filter ? `<img class="btn-ico" src="${this.itemIcons.get(b.filter)}" alt="">Changer le tri` : 'Trier un objet'}</button></div>` : '';
      const actions = `${sortBtn}${linked ? `<div class="row"><button class="btn" data-act="unlink">Couper la liaison</button></div>` : ''}<div class="row"><button class="btn danger" data-act="del">${ICONS.trash}Supprimer le tapis</button></div>`;
      if (!this.setPopover(`b${sel.x},${sel.y}`, info + linkInfo, actions)) return;
      const so = p.querySelector<HTMLButtonElement>('[data-act="sort"]');
      if (so) so.onclick = () => this.openSortPicker(b);
      p.querySelector<HTMLButtonElement>('[data-act="del"]')!.onclick = () => { this.game.removeChain(b); this.closePopover(); };
      const un = p.querySelector<HTMLButtonElement>('[data-act="unlink"]');
      if (un) un.onclick = () => { this.game.unlinkBelt(b); this.closePopover(); };
    }
  }

  /** Ce que la machine attend en entrée et ce qu'elle renvoie en sortie. */
  private recipesHtml(def: MachineDef, m: Machine): string {
    const it = (id: string, n: number) => `<span class="it"><img src="${this.itemIcons.get(id)}" alt="">${n > 1 ? `${n} ` : ''}${esc(item(id).name)}</span>`;
    const arrow = '<span class="arrow">→</span>';
    if (def.kind === 'drill') {
      return m.ore ? `<p>Ce qu’elle fait</p><div class="recipes"><div class="recipe current"><span class="it">Filon</span>${arrow}${it(m.ore, 1)}</div></div>` : '';
    }
    if (def.kind === 'storage') return '<p>Accepte tous les objets ; un tapis qui part du coffre les ressort.</p>';
    if (def.kind !== 'crafter') return '';
    const current = m.craft ? m.craft.ri : -1;
    const rows = def.recipes.map((r, i) => {
      const sig = Object.keys(r.in).sort().join('+');
      const same = def.recipes.filter((x) => Object.keys(x.in).sort().join('+') === sig);
      const chosen = same.length < 2 || (m.choice ?? Object.keys(same[0].out)[0]) === Object.keys(r.out)[0];
      const ins = Object.entries(r.in).map(([k, v]) => it(k, v)).join('<span class="arrow">+</span>');
      const outs = Object.entries(r.out).map(([k, v]) => it(k, v)).join('');
      return `<div class="recipe${i === current ? ' current' : ''}${chosen ? '' : ' off'}">${ins}${arrow}${outs}</div>`;
    }).join('');
    const fuel = def.coal ? ' Elle brûle aussi du charbon.' : '';
    return `<p>Entrée → sortie (la recette suit ce qu’on lui apporte).${fuel}</p><div class="recipes">${rows}</div>`;
  }

  /**
   * Toutes les recettes qu'on sait faire : les filons découverts (foreuse), puis chaque machine débloquée.
   * La liste s'allonge avec l'arbre ; les machines encore verrouillées sont rappelées en bas.
   */
  openRecipes(): void {
    this.closePopover();
    const g = this.game;
    let query = '';
    this.openSheet((sheet, close) => {
      sheet.append(this.sheetHead('Recettes', 'Ce que tes machines savent faire · la liste s’allonge avec l’arbre', close));
      const search = h('input', 'recipe-search') as HTMLInputElement;
      search.type = 'search';
      search.placeholder = 'Chercher un objet (fer, vis, moteur…)';
      search.value = query;
      const list = h('div', 'recipe-list');
      const it = (id: string, n: number) => `<span class="it"><img src="${this.itemIcons.get(id)}" alt="">${n > 1 ? `${n} ` : ''}${esc(item(id).name)}</span>`;
      const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const render = () => {
        const q = norm(query.trim());
        const match = (ids: string[]) => !q || ids.some((id) => norm(item(id).name).includes(q));
        let html = '';
        // Extraction : les filons qu'on a vus.
        const raws = [...g.world.discovered].filter((id) => id !== 'eau' && match([id]));
        if (raws.length) {
          html += `<div class="card"><div class="rc-head"><img src="${this.machineIcons.get('foreuse')}" alt=""><b>Foreuse</b><small>sur un filon découvert</small></div><div class="recipes">${raws.map((id) => `<div class="recipe"><span class="it">Filon</span><span class="arrow">→</span>${it(id, 1)}</div>`).join('')}</div></div>`;
        }
        const machines = Object.values(MACHINES).filter((m) => m.kind === 'crafter');
        const locked: MachineDef[] = [];
        let shown = 0;
        for (const m of machines) {
          if (!g.hasMachine(m.id)) { locked.push(m); continue; }
          const rows = m.recipes.filter((r) => match([...Object.keys(r.in), ...Object.keys(r.out)]));
          if (!rows.length) continue;
          shown += rows.length;
          const elec = g.view.canPower(m.id) ? `<small class="rc-elec">aussi au courant · ${kW(m.kw ?? 100)}</small>` : '';
          html += `<div class="card"><div class="rc-head"><img src="${this.machineIcons.get(m.id)}" alt=""><b>${esc(m.name)}</b>${elec}</div><div class="recipes">${rows.map((r) => {
            const ins = Object.entries(r.in).map(([k, v]) => it(k, v)).join('<span class="arrow">+</span>');
            const outs = Object.entries(r.out).map(([k, v]) => it(k, v)).join('');
            return `<div class="recipe">${ins}<span class="arrow">→</span>${outs}<small class="rc-time">${String(r.time).replace('.', ',')} s</small></div>`;
          }).join('')}</div></div>`;
        }
        if (!shown && !raws.length) html += '<div class="card"><p class="muted">Rien ne correspond.</p></div>';
        if (locked.length && !q) {
          html += `<div class="card"><p class="muted">Encore à débloquer dans l’arbre</p><div class="rc-locked">${locked.map((m) => {
            const node = nodeForMachine(m.id);
            return `<span class="chip"><img src="${this.machineIcons.get(m.id)}" alt="">${esc(m.name)} · ${m.recipes.length} recette${m.recipes.length > 1 ? 's' : ''}${node ? ` · palier ${node.palier}` : ''}</span>`;
          }).join('')}</div></div>`;
        }
        list.innerHTML = html;
      };
      search.oninput = () => { query = search.value; render(); };
      render();
      sheet.append(search, list);
    }, true);
    this.sheetKind = 'building';
  }

  /** Jauge de charbon (case carburant). */
  /** Le courant d'une machine électrique ou d'un générateur : une jauge éclair, et une phrase. */
  private powerCard(m: Machine): string {
    const f = this.game.view, def = machineDef(m.type), net = f.netOf(m);
    const bar = (pct: number, low: boolean, label: string, right: string) =>
      `<div class="gauge power${low ? ' low' : ''}"><span class="g-label">${ICONS.cable}${label}</span><span class="g-bar"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></span><b>${right}</b></div>`;
    if (!net) return `${bar(0, true, 'Courant', '—')}<p class="muted small">${def.kind === 'battery' ? 'Aucun câble à 5 cases' : def.supply ? `Fournit ${kW(def.supply)}, mais aucun câble à 5 cases` : `Consomme ${kW(f.powerUse(m))} au courant ; elle marche au charbon tant qu’aucun câble n’est à 5 cases`} : trace un câble jusqu’à un générateur (outil Câble).</p>`;
    if (def.supply || def.kind === 'battery') {
      const used = Math.min(net.demand, net.supply);
      const gens = net.gens.filter((x) => machineDef(x.type).kind === 'generator').length;
      const max = net.users.reduce((a, u) => a + f.powerUse(u), 0);
      const extra = `${net.gens.some((x) => machineDef(x.type).kind === 'solar') ? ` Soleil : ${kW(net.solar)}.` : ''}${net.capacity ? ` Batteries : ${kWh(net.stored)} sur ${kWh(net.capacity)}.` : ''}`;
      if (def.kind !== 'generator') {
        return `${bar(net.supply ? (used / net.supply) * 100 : 0, net.demand > net.supply, 'Charge du réseau', `${kW(net.demand)} / ${kW(net.supply)}`)}
          <p class="muted small">${net.users.length} machine${net.users.length > 1 ? 's' : ''} branchée${net.users.length > 1 ? 's' : ''} (jusqu’à ${kW(max)}).${extra} Le soleil sert d’abord, puis les batteries, puis le charbon des générateurs.</p>`;
      }
      return `${bar(net.supply ? (used / net.supply) * 100 : 0, net.demand > net.supply, 'Charge du réseau', `${kW(net.demand)} / ${kW(net.supply)}`)}
        <p class="muted small">${net.users.length} machine${net.users.length > 1 ? 's' : ''} branchée${net.users.length > 1 ? 's' : ''} (jusqu’à ${kW(max)} quand toutes travaillent)${gens > 1 ? `, ${gens} générateurs` : ''}. Chaque générateur fournit ${kW(def.supply!)} ; il ne brûle du charbon que pour ce qui est consommé.${extra}</p>`;
    }
    const use = `Consomme ${kW(f.powerUse(m))} quand elle travaille.`;
    if (net.supply <= 0) return `${bar(0, true, 'Courant', '0 %')}<p class="muted small">${use} Le réseau n’a pas de courant : ${net.gens.length ? 'son générateur n’a plus de charbon' : 'aucun générateur n’y est relié'}. En attendant, elle brûle son charbon.</p>`;
    const pct = Math.round((m.power ?? 1) * 100);
    return `${bar(pct, pct < 100, 'Courant', `${pct} %`)}<p class="muted small">${use}${pct < 100 ? ` Le réseau est trop chargé (${kW(net.demand)} demandés pour ${kW(net.supply)}) : les machines tournent moins vite. Ajoute un générateur.` : ''}</p>`;
  }

  /** Jauge de la case carburant ; s'il y a du carburant dedans (il brûle en premier), une petite pastille le dit. */
  private gauge(label: string, n: number, max: number, low: boolean, carb = 0): string {
    const c = carb > 0 ? `<span class="g-carb" title="Carburant : brûle en premier, 5 fois plus long"><img src="${this.itemIcons.get('carburant')}" alt="">${carb}</span>` : '';
    return `<div class="gauge${low ? ' low' : ''}"><span class="g-label"><img src="${this.itemIcons.get(carb > 0 ? 'carburant' : 'charbon')}" alt="">${label}</span><span class="g-bar"><span style="width:${(n / max) * 100}%"></span></span><b>${n}/${max}</b>${c}</div>`;
  }

  // ---------- Inventaires en grand : robot, coffre, fabrication ----------

  /** Pile choisie : une case du robot, ou un objet d'un coffre (chest) ou d'une machine (min : en attente, mout : prêt à sortir). */
  private invSel: { side: 'chest' | 'min' | 'mout'; item: string } | { side: 'robot'; slot: number } | null = null;
  private invQty = 1;
  private craftSel: string | null = null;
  private craftQty = 1;
  /** Feuille ouverte : pour la rafraîchir régulièrement. */
  private sheetKind: 'robot' | 'chest' | 'sell' | 'building' | 'machine' | 'line' | '' = '';
  private machineId = -1;
  private chestId = -1;
  private liveTimer = 0;

  private robotStatus(): string {
    const g = this.game, r = g.robot;
    return g.robotOutOfCoal ? 'Plus de charbon : il avance au ralenti. Arrête-le sur un filon de charbon.'
      : g.craftQueue[0] ? 'Il fabrique.'
      : r.mining ? `Il mine : ${item(r.mining).name.toLowerCase()}.`
      : g.robotBuilding ? 'Il construit.'
      : r.moving ? 'Il roule.'
      : 'À l’arrêt sur un filon, il mine tout seul.';
  }

  /** Une grille de cases ; data-side et data-i (ou data-item) pour la sélection. */
  private gridHtml(cells: ({ t: string; n: number } | null)[], side: 'chest' | 'robot' | 'min' | 'mout', cols = 5, accept?: (t: string) => boolean): string {
    const sel = this.invSel;
    return `<div class="inv-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${cells.map((c, i) => {
      if (!c) return `<button class="inv-cell empty" data-side="${side}" data-i="${i}" aria-label="Case vide"></button>`;
      const on = sel && sel.side === side && (side === 'robot' ? (sel as { slot: number }).slot === i : (sel as { item: string }).item === c.t);
      const no = accept && !accept(c.t);
      return `<button class="inv-cell${on ? ' on' : ''}${no ? ' no' : ''}" data-side="${side}" data-i="${i}" data-item="${c.t}" aria-label="${esc(item(c.t).name)} : ${c.n}"><img src="${this.itemIcons.get(c.t)}" alt=""><b>${c.n}</b></button>`;
    }).join('')}</div>`;
  }

  /** Le contenu d'un coffre, rangé en piles de 10. */
  private chestCells(m: Machine): ({ t: string; n: number } | null)[] {
    const cells: ({ t: string; n: number } | null)[] = [];
    for (const [t, n] of Object.entries(m.inBuf)) {
      let left = n;
      while (left > 0) { const k = Math.min(RULES.invStack, left); cells.push({ t, n: k }); left -= k; }
    }
    while (cells.length < this.game.view.slotsOf(m)) cells.push(null);
    return cells;
  }

  /** Branche les cases : toucher une pile la choisit (ou la quitte). */
  private wireGrid(root: HTMLElement, target: Machine | null): void {
    root.querySelectorAll<HTMLButtonElement>('.inv-cell').forEach((b) => {
      b.onclick = () => {
        const side = b.dataset.side as 'chest' | 'robot' | 'min' | 'mout';
        const it = b.dataset.item;
        if (!it) { this.invSel = null; this.refreshSheet(); return; }
        const n = Number(b.querySelector('b')?.textContent ?? 1);
        if (side === 'robot') {
          const slot = Number(b.dataset.i);
          const same = this.invSel?.side === 'robot' && this.invSel.slot === slot;
          this.invSel = same ? null : { side, slot };
        } else {
          const same = this.invSel?.side === side && (this.invSel as { item: string }).item === it;
          this.invSel = same ? null : { side, item: it };
        }
        this.invQty = n;
        if (!target && this.invSel) this.invQty = Math.max(1, Math.floor(n / 2));
        this.refreshSheet();
      };
    });
  }

  /** La barre d'action d'une pile choisie : quantité, puis prendre, déposer ou séparer. */
  private invBar(target: Machine | null): HTMLElement | null {
    const g = this.game, sel = this.invSel;
    if (!sel) return null;
    const kind = target ? machineDef(target.type).kind : null;
    const chest = kind === 'storage' ? target : null;
    const machine = kind === 'crafter' || kind === 'drill' || kind === 'generator' ? target : null;
    const building = target && !chest && !machine ? target : null;
    let t: string, have: number, max: number, verb: string, why = '';
    if (sel.side === 'robot') {
      const sl = g.robot.inv.slots[sel.slot];
      if (!sl) { this.invSel = null; return null; }
      t = sl.t; have = sl.n;
      if (chest) { max = Math.min(sl.n, g.view.storageRoom(chest, t)); verb = 'Déposer dans le coffre'; if (!max) why = 'Le coffre est plein'; }
      else if (building) {
        const name = machineDef(building.type).name;
        max = Math.min(sl.n, g.accepts(building, t));
        verb = `Donner ${building.type === 'revente' ? 'à la' : 'au'} ${name}`;
        if (!max) why = building.type === 'revente' ? 'La Revente est pleine (ou le gros drone est là)' : `${name} n’en a pas besoin pour l’instant`;
      }
      else if (machine) {
        const name = machineDef(machine.type).name.toLowerCase();
        max = Math.min(sl.n, g.machineAccepts(machine, t));
        verb = isFuel(t) ? `Recharger en ${t === 'charbon' ? 'charbon' : 'carburant'}` : `Mettre dans la machine`;
        if (!max) why = g.machineAccepts(machine, t) === 0 && !machineDef(machine.type).recipes.some((r) => r.in[t]) && !isFuel(t) ? `La ${name} ne s’en sert pas` : 'Elle est pleine pour l’instant';
      }
      else { max = sl.n; verb = ''; }
    } else {
      const src = sel.side === 'chest' ? chest?.inBuf : sel.side === 'min' ? machine?.inBuf : machine?.outBuf;
      if (!src || !(src[sel.item] > 0)) { this.invSel = null; return null; }
      t = sel.item; have = src[t];
      max = Math.min(have, g.robot.inv.room(t)); verb = sel.side === 'chest' ? `Donner à ${g.look.name}` : `Reprendre dans l’inventaire`;
      if (!max) why = `L’inventaire de ${g.look.name} est plein`;
    }
    const q = Math.max(max ? 1 : 0, Math.min(this.invQty, max));
    this.invQty = q;
    const bar = h('div', 'inv-bar');
    const where = sel.side === 'robot' ? `dans la case de ${esc(g.look.name)}` : sel.side === 'chest' ? 'dans le coffre' : 'dans la machine';
    bar.innerHTML = `<div class="ib-head"><img src="${this.itemIcons.get(t)}" alt=""><b>${esc(item(t).name)}</b><small>${fmt(have)} ${where}</small></div>
      ${max ? `<div class="ib-qty"><button class="btn ib-step" data-d="-1" aria-label="Un de moins">−</button><input class="ib-range" type="range" min="1" max="${max}" value="${q}" aria-label="Quantité"><button class="btn ib-step" data-d="1" aria-label="Un de plus">+</button><b class="ib-n">${q}</b></div>
      <div class="ib-quick"><button class="btn" data-set="1">1</button><button class="btn" data-set="half">Moitié</button><button class="btn" data-set="all">Tout (${max})</button></div>` : `<p class="muted">${why}</p>`}
      <div class="ib-acts"></div>`;
    const range = bar.querySelector<HTMLInputElement>('.ib-range');
    const label = bar.querySelector<HTMLElement>('.ib-n');
    const setQ = (v: number) => {
      this.invQty = Math.max(1, Math.min(max, v));
      if (range) range.value = String(this.invQty);
      if (label) label.textContent = String(this.invQty);
    };
    if (range) range.oninput = () => setQ(Number(range.value));
    bar.querySelectorAll<HTMLButtonElement>('.ib-step').forEach((b) => { b.onclick = () => setQ(this.invQty + Number(b.dataset.d)); });
    bar.querySelectorAll<HTMLButtonElement>('[data-set]').forEach((b) => {
      b.onclick = () => setQ(b.dataset.set === 'all' ? max : b.dataset.set === 'half' ? Math.max(1, Math.floor(max / 2)) : 1);
    });
    const acts = bar.querySelector<HTMLElement>('.ib-acts')!;
    if (sel.side === 'robot') {
      const slot = sel.slot;
      const sl = g.robot.inv.slots[slot]!;
      const canSplit = sl.n > 1 && g.robot.inv.slots.includes(null) && (!!target || this.invQty < sl.n);
      const split = h('button', 'btn', 'Séparer la pile');
      split.disabled = !canSplit;
      split.onclick = () => {
        const n = Math.min(this.invQty, sl.n - 1);
        if (g.splitRobotSlot(slot, n)) this.toast(`Pile séparée : ${sl.n} et ${n}`, 'good');
        this.invSel = null;
        this.refreshSheet();
      };
      acts.append(split);
      if (!target) {
        // Détruire : en deux temps, pour ne rien perdre par erreur.
        const armed = this.armedTrash?.slot === slot && performance.now() < this.armedTrash.until;
        const n = this.invQty;
        const trash = h('button', `btn danger${armed ? ' armed' : ''}`, armed ? `Confirmer : détruire ${n}` : `Détruire ${n}`);
        trash.onclick = () => {
          if (!(this.armedTrash?.slot === slot && performance.now() < this.armedTrash.until)) {
            this.armedTrash = { slot, until: performance.now() + 4000 };
            this.refreshSheet();
            setTimeout(() => { if (this.armedTrash && performance.now() >= this.armedTrash.until) { this.armedTrash = null; this.refreshSheet(); } }, 4100);
            return;
          }
          this.armedTrash = null;
          const name = sl.t;
          const k = g.destroyRobotItems(slot, this.invQty);
          if (k) this.toast(`${itemLabel(name, k)} détruit${k > 1 ? 's' : ''}`, 'warn');
          this.invSel = null;
          this.refreshSheet();
        };
        // Changer la quantité désarme la confirmation.
        bar.querySelectorAll<HTMLElement>('.ib-step, [data-set], .ib-range').forEach((el) => {
          el.addEventListener(el.classList.contains('ib-range') ? 'input' : 'click', () => {
            this.armedTrash = null;
            trash.classList.remove('armed');
            trash.textContent = `Détruire ${this.invQty}`;
            split.disabled = !(sl.n > 1 && g.robot.inv.slots.includes(null) && this.invQty < sl.n);
          });
        });
        acts.append(trash);
      }
      if (chest) {
        const dep = h('button', 'btn primary', verb);
        dep.disabled = !max;
        dep.onclick = () => { g.robotToChest(chest, slot, this.invQty); this.invSel = null; this.refreshSheet(); };
        acts.append(dep);
      } else if (machine) {
        split.remove();
        const dep = h('button', 'btn primary', verb);
        dep.disabled = !max;
        dep.onclick = () => { g.robotToMachine(machine, slot, this.invQty); this.invSel = null; this.refreshSheet(); };
        acts.append(dep);
      } else if (building) {
        split.remove();
        const dep = h('button', 'btn primary', verb);
        dep.disabled = !max;
        dep.onclick = () => {
          const n = g.robotToBuilding(building, slot, this.invQty);
          if (n) this.toast(`${itemLabel(sl.t, n)} donné${n > 1 ? 's' : ''}`, 'good');
          this.invSel = null;
          this.refreshSheet();
        };
        acts.append(dep);
      }
    } else if (chest) {
      const take = h('button', 'btn primary', verb);
      take.disabled = !max;
      take.onclick = () => { g.chestToRobot(chest, t, this.invQty); this.invSel = null; this.refreshSheet(); };
      acts.append(take);
    } else if (machine && (sel.side === 'min' || sel.side === 'mout')) {
      const which = sel.side === 'min' ? 'in' : 'out';
      const take = h('button', 'btn primary', verb);
      take.disabled = !max;
      take.onclick = () => { g.machineToRobot(machine, which, t, this.invQty); this.invSel = null; this.refreshSheet(); };
      acts.append(take);
    }
    return bar;
  }

  /** L'inventaire du robot en grand : charbon, cases, fabrication, drones. */
  openRobot(): void {
    this.closePopover();
    this.tips.note('robotOpened');
    this.invSel = null;
    this.craftSel = null;
    this.openSheet((sheet, close) => this.buildRobotSheet(sheet, close), true);
    this.sheetKind = 'robot';
  }

  private buildRobotSheet(sheet: HTMLElement, close: () => void): void {
    const g = this.game, r = g.robot;
    sheet.classList.add('inv-sheet');
    sheet.append(this.sheetHead(g.look.name, esc(this.robotStatus()), close));
    const inv = h('div', 'card');
    inv.innerHTML = `${this.gauge('Carburant', r.fuel, 10, g.robotOutOfCoal, r.carb)}<p class="muted">Inventaire · touche une pile pour la séparer ou la détruire</p>${this.gridHtml(r.inv.slots, 'robot')}`;
    this.wireGrid(inv, null);
    const bar = this.invBar(null);
    if (bar) inv.append(bar);
    sheet.append(inv, this.scanCard(close), this.craftCard());
    // Drones et leurs priorités.
    const label = (p: DronePriority) => DRONE_PRIORITIES.find((x) => x.id === p)?.label ?? p;
    const dr = h('div', 'card');
    dr.innerHTML = g.drones.length
      ? `<p class="muted">Drones · touche un drone pour ranger ses tâches</p>${g.drones.map((d, i) => `<button class="prio-btn big" data-drone="${i}"><span>Drone ${i + 1}</span>${this.gauge('', d.fuel, 10, d.fuel <= 2, d.carb)}${d.cargo ? `<span class="chip"><img src="${this.itemIcons.get(d.cargo.t)}" alt="">${d.cargo.n}</span>` : ''}<b>${PRIO_ICONS[d.priorities[0]] ?? ''}${esc(label(d.priorities[0]))}</b><i>›</i></button>`).join('')}`
      : '<p class="muted">Pas encore de drone.</p>';
    dr.querySelectorAll<HTMLButtonElement>('[data-drone]').forEach((b) => { b.onclick = () => this.openPriorities(Number(b.dataset.drone)); });
    sheet.append(dr);
  }

  /** Scanner : choisir une matière, des flèches montrent les 3 filons les plus proches pendant 10 s. */
  private scanCard(close: () => void): HTMLElement {
    const g = this.game;
    const card = h('div', 'card');
    card.innerHTML = `<p class="muted">Scanner · trouve les 3 filons les plus proches, même sous le brouillard</p>`;
    const grid = h('div', 'scan-grid');
    for (const id of RAW_IDS) {
      const b = h('button', 'scan-opt', `<img src="${this.itemIcons.get(id)}" alt=""><small>${esc(item(id).name.replace('Minerai de ', '').replace("Minerai d'", '').replace(/^./, (c) => c.toUpperCase()))}</small>`);
      b.onclick = () => {
        const found = g.scan(id, 3);
        if (!found.length) { this.toast(`Aucun filon de ${item(id).name.toLowerCase()} à portée du scanner`, 'warn'); return; }
        close();
        this.r.startScan(id, found);
        this.r.centerOnRobot();
        this.toast(`Scanner : ${found.length} filon${found.length > 1 ? 's' : ''} de ${item(id).name.toLowerCase()} · le plus proche à ${Math.round(found[0].d)} cases`, 'good');
      };
      grid.append(b);
    }
    card.append(grid);
    return card;
  }

  /** Fabrication à la main : ce qui est en cours, puis ce qu'on peut faire avec l'inventaire. */
  private craftCard(): HTMLElement {
    const g = this.game;
    const card = h('div', 'card craft');
    card.innerHTML = `<p class="muted">Fabriquer à la main · lentement, avec ce que ${esc(g.look.name)} a sur lui</p>`;
    // File en cours
    g.craftQueue.forEach((job, i) => {
      const st = Game.craftStep(job);
      const row = h('div', 'craft-job');
      row.dataset.i = String(i);
      row.innerHTML = `<img src="${this.itemIcons.get(job.target)}" alt=""><div class="cj-info"><b>${job.n} × ${esc(item(job.target).name)}</b><small class="cj-step">${i === 0 ? (job.blocked ? 'Inventaire plein : fais de la place' : st ? `${esc(MACHINE_VERB[st.machine] ?? 'Fabrication')} : ${esc(item(st.item).name.toLowerCase())}` : '') : 'En attente'}</small><span class="cj-bar"><span style="width:${(job.t / job.total) * 100}%"></span></span></div>`;
      const x = h('button', 'round small', ICONS.close);
      x.setAttribute('aria-label', 'Annuler');
      x.onclick = () => { g.cancelCraft(i); this.refreshSheet(); };
      row.append(x);
      card.append(row);
    });
    // Ce qu'on peut fabriquer maintenant
    const has = (id: string) => g.hasMachine(id);
    const have: Record<string, number> = {};
    for (const sl of g.robot.inv.slots) if (sl) have[sl.t] = (have[sl.t] ?? 0) + sl.n;
    const options = craftableItems(has)
      .map((id) => ({ id, max: maxCraftable(id, have, has, 50) }))
      .filter((o) => o.max > 0)
      .sort((a, b) => item(a.id).tier - item(b.id).tier || item(a.id).value - item(b.id).value);
    if (!options.length) {
      card.insertAdjacentHTML('beforeend', `<p class="muted small">Rien à fabriquer pour l’instant : mine du fer ou du cuivre, ou prends des objets dans un coffre.</p>`);
      this.craftSel = null;
      return card;
    }
    if (this.craftSel && !options.some((o) => o.id === this.craftSel)) this.craftSel = null;
    const grid = h('div', 'craft-grid');
    for (const o of options) {
      const b = h('button', `craft-opt${o.id === this.craftSel ? ' on' : ''}`, `<img src="${this.itemIcons.get(o.id)}" alt=""><small>${esc(item(o.id).name)}</small><b>×${o.max}</b>`);
      b.onclick = () => { this.craftSel = this.craftSel === o.id ? null : o.id; this.craftQty = 1; this.refreshSheet(); };
      grid.append(b);
    }
    card.append(grid);
    const sel = options.find((o) => o.id === this.craftSel);
    if (sel) {
      const q = Math.min(this.craftQty, sel.max);
      const res = g.craftPlan(sel.id, q);
      if ('plan' in res) {
        const plan = res.plan;
        const chain = plan.steps.map((st) => `<span class="it"><img src="${this.itemIcons.get(st.item)}" alt="">${st.runs > 1 ? `${st.runs} ` : ''}${esc(item(st.item).name)}</span>`).join('<span class="arrow">→</span>');
        const uses = Object.entries(plan.consume).map(([k, v]) => `<span class="chip"><img src="${this.itemIcons.get(k)}" alt="">${v} ${esc((v > 1 ? item(k).plural : item(k).name).toLowerCase())}</span>`).join('');
        const sec = Math.ceil(plan.time);
        const det = h('div', 'craft-detail');
        det.innerHTML = `<div class="recipes"><div class="recipe">${chain}</div></div>
          <p class="muted small">Prend : </p><div class="chips">${uses}</div>
          <div class="ib-quick">${[1, 5, 10].filter((n) => n < sel.max).map((n) => `<button class="btn${n === q ? ' primary' : ''}" data-cq="${n}">${n}</button>`).join('')}<button class="btn${q === sel.max ? ' primary' : ''}" data-cq="${sel.max}">Max (${sel.max})</button></div>`;
        det.querySelectorAll<HTMLButtonElement>('[data-cq]').forEach((b) => { b.onclick = () => { this.craftQty = Number(b.dataset.cq); this.refreshSheet(); }; });
        const go = h('button', 'btn primary big', `Fabriquer ${q} × ${esc(item(sel.id).name.toLowerCase())} · ${sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')}`}`);
        go.onclick = () => {
          const err = g.startCraft(sel.id, q);
          if (err) this.toast(err, 'warn');
          else { this.craftSel = null; this.toast(`${g.look.name} se met au travail`, 'good'); }
          this.refreshSheet();
        };
        det.append(go);
        card.append(det);
      }
    }
    return card;
  }

  /** « Depuis ton inventaire » : donner directement au Noyau, au Laboratoire, au Comptoir ou à la Revente. */
  private depositCard(m: Machine): HTMLElement {
    const g = this.game;
    const card = h('div', 'card');
    card.innerHTML = `<p class="muted">Depuis l’inventaire de ${esc(g.look.name)} · touche une pile pour la donner</p>${this.gridHtml(g.robot.inv.slots, 'robot', 5, (t) => g.accepts(m, t) > 0)}`;
    this.wireGrid(card, m);
    const bar = this.invBar(m);
    if (bar) card.append(bar);
    return card;
  }

  /**
   * Bouton Supprimer en deux temps. Le « toucher encore » est retenu par machine pendant 4 s,
   * même si la fenêtre se redessine entre les deux touchers (elle se rafraîchit toute seule).
   */
  private armedDelete: { id: number; until: number } | null = null;
  /** Abandon de la commande du Comptoir en attente de confirmation (jusqu'à cette date). */
  private armedAbandon = 0;
  /** Destruction d'objets du robot en attente de confirmation. */
  private armedTrash: { slot: number; until: number } | null = null;

  private deleteButton(m: Machine, label: string, confirm: string, close: () => void): HTMLButtonElement {
    const armed = () => this.armedDelete?.id === m.id && performance.now() < this.armedDelete.until;
    const del = h('button', `btn danger${armed() ? ' armed' : ''}`, `${ICONS.trash}${esc(armed() ? confirm : label)}`);
    del.onclick = () => {
      if (!armed()) {
        this.armedDelete = { id: m.id, until: performance.now() + 4000 };
        del.classList.add('armed');
        del.innerHTML = `${ICONS.trash}${esc(confirm)}`;
        return;
      }
      this.armedDelete = null;
      this.game.removeMachine(m);
      close();
    };
    return del;
  }

  /** Une machine en grand (four, foreuse…) : état, charbon, recettes, ce qu'elle contient, et l'inventaire du robot. */
  openMachine(m: Machine): void {
    this.closePopover();
    this.invSel = null;
    this.machineId = m.id;
    this.openSheet((sheet, close) => {
      const g = this.game;
      const mm = g.view.machines.get(this.machineId);
      if (!mm) { close(); return; }
      const def = machineDef(mm.type);
      sheet.classList.add('inv-sheet');
      let title = def.name, status = `${STATUS_TEXT[mm.status]}.`;
      if (def.kind === 'drill') {
        const patch = g.world.patchAt(mm.x, mm.y) ?? g.world.patchAt(mm.x + 1, mm.y + 1);
        title = `${def.name} · ${mm.ore ? item(mm.ore).name.toLowerCase() : '?'}`;
        status += ` Filon ${patch ? RICHNESS_LABEL[patch.richness] : ''} : ${(mm.rate ?? 0).toFixed(2).replace('.', ',')} par seconde.`;
      }
      if (def.kind === 'station') {
        const nd = g.stationCapacity(mm);
        sheet.append(this.sheetHead(def.name, nd > 1 ? `Ses ${nd} drones construisent, rechargent et livrent dans un rayon de ${RULES.stationRange} cases autour de lui.` : `Son drone construit, recharge et livre dans un rayon de ${RULES.stationRange} cases autour d’elle.`, close));
        this.r.rangeOf = mm.id;
        const d = g.stationDrones.get(mm.id);
        const label = (p: DronePriority) => DRONE_PRIORITIES.find((x) => x.id === p)?.label ?? p;
        const card = h('div', 'card');
        card.innerHTML = `${this.gauge('Carburant de la station', mm.fuel, g.view.fuelCap(mm), g.view.lowFuel(mm), mm.carb)}<p class="muted small">Son drone s’y sert pour recharger les machines autour (et lui-même). Un tapis ou les autres drones la remplissent.</p>
          ${d ? `<button class="prio-btn big" data-st="1"><span>Drone</span>${this.gauge('', d.fuel, 10, d.fuel <= 2, d.carb)}${d.cargo ? `<span class="chip"><img src="${this.itemIcons.get(d.cargo.t)}" alt="">${d.cargo.n}</span>` : ''}<b>${PRIO_ICONS[d.priorities[0]] ?? ''}${esc(label(d.priorities[0]))}</b><i>›</i></button>` : ''}`;
        card.querySelector<HTMLButtonElement>('[data-st]')?.addEventListener('click', () => this.openPriorities(0, mm.id));
        sheet.append(card);
        const dep = h('div', 'card');
        dep.innerHTML = `<p class="muted">Depuis l’inventaire de ${esc(g.look.name)} · charbon</p>${this.gridHtml(g.robot.inv.slots, 'robot', 5, (t) => g.machineAccepts(mm, t) > 0)}`;
        this.wireGrid(dep, mm);
        if (this.invSel?.side === 'robot') { const bar = this.invBar(mm); if (bar) dep.append(bar); }
        sheet.append(dep);
        const acts = h('div', 'row');
        const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
        mv.onclick = () => { close(); this.startMove(mm); };
        acts.append(mv, this.deleteButton(mm, `Supprimer · rend ${def.cost}`, 'Toucher encore pour supprimer', close));
        sheet.append(acts);
        return;
      }
      if (def.kind === 'atelier') {
        const inner = mm.inner;
        const count = new Map<string, number>();
        for (const x of inner?.machines.values() ?? []) count.set(x.type, (count.get(x.type) ?? 0) + 1);
        const ports = (count.get('entree') ?? 0) + (count.get('sortie') ?? 0);
        const machines = [...count].filter(([t]) => t !== 'entree' && t !== 'sortie');
        const total = machines.reduce((a, [, n]) => a + n, 0);
        sheet.append(this.sheetHead('Atelier', esc(`${status} ${total} machine${total > 1 ? 's' : ''} rangée${total > 1 ? 's' : ''}, ${ports} entrée${ports > 1 ? 's' : ''} et sortie${ports > 1 ? 's' : ''} · intérieur de ${mm.size} × ${mm.size} cases.`), close));
        const card = h('div', 'card');
        const kw = g.view.powerUse(mm);
        card.innerHTML = `${this.gauge('Carburant', mm.fuel, g.view.fuelCap(mm), g.view.lowFuel(mm), mm.carb)}${kw ? this.powerCard(mm) : ''}
          <p class="muted small">L’atelier brûle du charbon (ou prend du courant) pour toutes ses machines qui travaillent.</p>
          <div class="chips">${machines.map(([t, n]) => `<span class="chip"><img src="${this.machineIcons.get(t)}" alt="">${n} × ${esc(machineDef(t).name.toLowerCase())}</span>`).join('') || '<span class="muted small">Vide : entre pour y construire.</span>'}</div>
          ${Object.values(mm.inBuf).some((n) => n > 0) ? `<p class="muted small">À l’entrée :</p><div class="chips">${this.chips(mm.inBuf)}</div>` : ''}
          ${Object.values(mm.outBuf).some((n) => n > 0) ? `<p class="muted small">Prêt à sortir :</p><div class="chips">${this.chips(mm.outBuf)}</div>` : ''}`;
        sheet.append(card);
        const row1 = h('div', 'row');
        const enter = h('button', 'btn primary', `${ICONS.module}Entrer`);
        enter.onclick = () => { close(); g.enterAtelier(mm); };
        const copy = h('button', 'btn', `Copier · ${ICONS.coinSm}${g.copyPrice(mm)}`);
        copy.onclick = () => { close(); this.startCopy(mm); };
        row1.append(enter, copy);
        sheet.append(row1);
        const planBtn = h('button', 'btn', 'Enregistrer comme plan');
        planBtn.onclick = () => {
          const save = g.planOf(mm);
          if (!save) return;
          const kinds = machines.map(([t]) => machineDef(t).name.toLowerCase()).slice(0, 3).join(', ');
          const plans = loadPlans();
          const plan: AtelierPlan = { id: `p${Date.now().toString(36)}`, name: `Atelier ${plans.length + 1}${kinds ? ` · ${kinds}` : ''}`, size: mm.size ?? 20, save, machines: total };
          if (savePlans([...plans, plan])) { this.toast('Plan enregistré : il est dans la palette (Modules) de toutes tes parties', 'good'); this.renderPalette(); }
          else this.toast('Impossible d’enregistrer le plan sur cet appareil', 'warn');
        };
        const prow = h('div', 'row');
        prow.append(planBtn);
        sheet.append(prow);
        const acts = h('div', 'row');
        const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
        mv.onclick = () => { close(); this.startMove(mm); };
        const refund = def.cost + (inner ? g.contentValue(inner) : 0);
        acts.append(mv, this.deleteButton(mm, `Supprimer · rend ${refund}`, 'Toucher encore : ce qu’il contient sera perdu', close));
        sheet.append(acts);
        return;
      }
      if (def.kind === 'rocket') {
        const counting = !!mm.craft;
        sheet.append(this.sheetHead(def.name, esc(counting ? `Décollage dans ${Math.max(0, Math.ceil(RULES.rocketCountdown - mm.craft!.t))} s !` : `${g.rockets ? `${g.rockets} fusée${g.rockets > 1 ? 's' : ''} lancée${g.rockets > 1 ? 's' : ''}. ` : ''}Remplis-la par tapis (ou depuis l’inventaire du robot) : quand tout y est, la fusée décolle.`), close));
        const card = h('div', 'card');
        card.innerHTML = Object.entries(ROCKET_NEEDS).map(([k, n]) => this.gauge(item(k).name, Math.min(n, mm.inBuf[k] ?? 0), n, false).replace(this.itemIcons.get('charbon')!, this.itemIcons.get(k)!)).join('');
        sheet.append(card);
        const dep = h('div', 'card');
        dep.innerHTML = `<p class="muted">Depuis l’inventaire de ${esc(g.look.name)}</p>${this.gridHtml(g.robot.inv.slots, 'robot', 5, (t) => g.machineAccepts(mm, t) > 0)}`;
        this.wireGrid(dep, mm);
        if (this.invSel?.side === 'robot') { const bar = this.invBar(mm); if (bar) dep.append(bar); }
        sheet.append(dep);
        const acts = h('div', 'row');
        const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
        mv.onclick = () => { close(); this.startMove(mm); };
        acts.append(mv, this.deleteButton(mm, `Supprimer · rend ${def.cost}`, 'Toucher encore pour supprimer', close));
        sheet.append(acts);
        return;
      }
      if (def.kind === 'pump' || def.kind === 'reactor' || def.kind === 'charger' || def.kind === 'filter') {
        const wn = g.view.waterNetOf(mm);
        const waterLine = wn ? `Réseau d’eau : ${fmtN(wn.demand)} L/s demandés pour ${fmtN(wn.supply)} L/s pompés.` : 'Aucun tuyau ne la touche.';
        const sub = def.kind === 'pump' ? `${status} 40 L/s. ${waterLine}`
          : def.kind === 'reactor' ? `${status} Eau : ${Math.round((mm.water ?? 0) * 100)} %. ${wn ? waterLine : 'Relie-le par un tuyau à une pompe, sinon il ne démarre pas.'}`
          : def.kind === 'filter' ? `${status} Pollution ici : ${Math.round(g.view.pollutionAt(mm))}. Au courant, il en retire ${RULES.filterClean} par seconde.`
          : `${status} Les drones autour (robot ou stations) viennent s’y recharger au lieu de brûler du charbon.`;
        sheet.append(this.sheetHead(def.name, esc(sub), close));
        const card = h('div', 'card');
        if (def.kind === 'reactor') {
          const rods = mm.inBuf.uranium_enrichi ?? 0;
          card.innerHTML = `${this.gauge('Barreaux', rods, RULES.fuelStack, rods <= 1).replace(this.itemIcons.get('charbon')!, this.itemIcons.get('uranium_enrichi')!)}<div class="gauge power"><span class="g-label">${ICONS.pipe}Eau</span><span class="g-bar"><span style="width:${(mm.water ?? 0) * 100}%"></span></span><b>${Math.round((mm.water ?? 0) * 100)} %</b></div>${this.powerCard(mm)}<p class="muted small">Un barreau d’uranium enrichi dure 2 minutes à pleine charge ; apporte-les par tapis.</p>`;
        } else if (def.kind === 'charger' || def.kind === 'filter') {
          card.innerHTML = this.powerCard(mm);
        } else {
          card.innerHTML = `<p class="muted small">${esc(waterLine)}</p>`;
        }
        sheet.append(card);
        const acts = h('div', 'row');
        const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
        mv.onclick = () => { close(); this.startMove(mm); };
        acts.append(mv, this.deleteButton(mm, `Supprimer · rend ${def.cost}`, 'Toucher encore pour supprimer', close));
        sheet.append(acts);
        return;
      }
      if (def.kind === 'solar' || def.kind === 'battery') {
        const light = g.daylight;
        const sub = def.kind === 'solar'
          ? `${light > 0.95 ? 'Plein soleil' : light > 0.05 ? (g.dayTime > 0.5 ? 'Crépuscule' : 'Aube') : 'Nuit'} : ${kW((def.supply ?? 0) * light)} sur ${kW(def.supply ?? 0)}.`
          : `${kWh(mm.charge ?? 0)} gardés sur ${kWh(RULES.batteryKj)} · ${kW(RULES.batteryKw)} au plus, en charge comme en décharge.`;
        sheet.append(this.sheetHead(def.name, esc(`${status} ${sub}`), close));
        const card = h('div', 'card');
        const gaugeHtml = def.kind === 'battery'
          ? `<div class="gauge power"><span class="g-label">${ICONS.cable}Charge</span><span class="g-bar"><span style="width:${((mm.charge ?? 0) / RULES.batteryKj) * 100}%"></span></span><b>${kWh(mm.charge ?? 0)}</b></div>`
          : `<div class="gauge power"><span class="g-label">${ICONS.cable}Soleil</span><span class="g-bar"><span style="width:${light * 100}%"></span></span><b>${Math.round(light * 100)} %</b></div>`;
        card.innerHTML = `${gaugeHtml}${this.powerCard(mm)}`;
        sheet.append(card);
        const acts = h('div', 'row');
        const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
        mv.onclick = () => { close(); this.startMove(mm); };
        acts.append(mv, this.deleteButton(mm, `Supprimer · rend ${def.cost}`, 'Toucher encore pour supprimer', close));
        sheet.append(acts);
        return;
      }
      if (def.kind === 'generator') {
        sheet.append(this.sheetHead('Générateur', esc(status), close));
        const card = h('div', 'card');
        card.innerHTML = `${this.gauge('Carburant', mm.fuel, g.view.fuelCap(mm), g.view.lowFuel(mm), mm.carb)}${this.powerCard(mm)}`;
        sheet.append(card);
        const dep = h('div', 'card');
        dep.innerHTML = `<p class="muted">Depuis l’inventaire de ${esc(g.look.name)} · charbon</p>${this.gridHtml(g.robot.inv.slots, 'robot', 5, (t) => g.machineAccepts(mm, t) > 0)}`;
        this.wireGrid(dep, mm);
        if (this.invSel?.side === 'robot') { const bar = this.invBar(mm); if (bar) dep.append(bar); }
        sheet.append(dep);
        const acts = h('div', 'row');
        const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
        mv.onclick = () => { close(); this.startMove(mm); };
        acts.append(mv, this.deleteButton(mm, `Supprimer · rend ${def.cost}`, 'Toucher encore pour supprimer', close));
        sheet.append(acts);
        return;
      }
      sheet.append(this.sheetHead(title, esc(status), close));
      sheet.append(this.flowCard(mm));
      // Liaisons directes avec des machines collées
      const links = (mm.links ?? []).map((id) => g.view.machines.get(id)).filter((x): x is Machine => !!x);
      if (links.length) {
        const lc = h('div', 'card');
        lc.innerHTML = '<p class="muted">Reliée directement (machines collées)</p>';
        for (const to of links) {
          const row = h('div', 'row link-row', `<span>→ ${esc(machineDef(to.type).name)}</span>`);
          const cut = h('button', 'btn', 'Couper');
          cut.onclick = () => { g.unlinkMachines(mm, to.id); this.refreshSheet(); };
          row.append(cut);
          lc.append(row);
        }
        sheet.append(lc);
      }
      const tc = this.tunnelsCard(mm);
      if (tc) sheet.append(tc);
      // Charbon et recettes
      const top = h('div', 'card mrec');
      top.innerHTML = `${def.coal ? this.gauge('Carburant', mm.fuel, g.view.fuelCap(mm), g.view.lowFuel(mm), mm.carb) : ''}${g.view.powerUse(mm) ? this.powerCard(mm) : ''}${this.recipesHtml(def, mm)}`;
      if (mm.type === 'raffinerie') {
        const cur = mm.choice ?? 'plastique';
        const row = h('div', 'row');
        for (const [id, label] of [['plastique', 'Plastique'], ['carburant', 'Carburant']]) {
          const b = h('button', `btn ${cur === id ? 'primary' : ''}`, label);
          b.onclick = () => { g.view.setChoice(mm, id); this.refreshSheet(); };
          row.append(b);
        }
        top.append(row);
        if (cur === 'carburant') top.append(h('p', 'muted small', 'Elle remplit d’abord sa propre case carburant avec ce qu’elle produit : plus besoin de la recharger.'));
      }
      sheet.append(top);
      // Ce que la machine contient : en attente, et prêt à sortir
      const cellsOf = (buf: Record<string, number>) => {
        const c: ({ t: string; n: number } | null)[] = Object.entries(buf).filter(([, n]) => n > 0).map(([t, n]) => ({ t, n }));
        while (c.length < 6) c.push(null);
        return c;
      };
      const box = h('div', 'card');
      box.innerHTML = `${def.kind === 'crafter' ? `<p class="muted">En attente</p>${this.gridHtml(cellsOf(mm.inBuf), 'min', 6)}` : ''}
        <p class="muted">Prêt à sortir · touche une pile pour la reprendre</p>${this.gridHtml(cellsOf(mm.outBuf), 'mout', 6)}`;
      this.wireGrid(box, mm);
      const sel = this.invSel;
      if (sel && sel.side !== 'robot') { const bar = this.invBar(mm); if (bar) box.append(bar); }
      sheet.append(box);
      // Depuis l'inventaire du robot
      const dep = h('div', 'card');
      dep.innerHTML = `<p class="muted">Depuis l’inventaire de ${esc(g.look.name)} · charbon et ingrédients</p>${this.gridHtml(g.robot.inv.slots, 'robot', 5, (t) => g.machineAccepts(mm, t) > 0)}`;
      this.wireGrid(dep, mm);
      if (sel && sel.side === 'robot') { const bar = this.invBar(mm); if (bar) dep.append(bar); }
      sheet.append(dep);
      const acts = h('div', 'row');
      const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
      mv.onclick = () => { close(); this.startMove(mm); };
      const del = this.deleteButton(mm, `Supprimer · rend ${def.cost}`, 'Toucher encore pour supprimer', close);
      acts.append(mv, del);
      sheet.append(acts);
    }, true);
    this.sheetKind = 'machine';
  }

  /** Débit réel d'une machine : ce qui entre et ce qui sort, par seconde, avec le maximum possible. */
  private flowCard(m: Machine): HTMLElement {
    const g = this.game, def = machineDef(m.type);
    const real = g.view.flowOf(m);
    // Le maximum : la recette en cours (ou la dernière), et le charbon brûlé en travaillant.
    const maxIn: Record<string, number> = {}, maxOut: Record<string, number> = {};
    if (def.kind === 'drill' && m.ore) maxOut[m.ore] = m.rate ?? 0;
    if (def.kind === 'crafter' && def.recipes.length) {
      const ri = m.craft ? m.craft.ri : ((m.rrRecipe - 1) % def.recipes.length + def.recipes.length) % def.recipes.length;
      const rec = def.recipes[ri];
      if (m.craft || m.made > 0 || Object.keys(real.in).length) {
        for (const [k, v] of Object.entries(rec.in)) maxIn[k] = v / rec.time;
        for (const [k, v] of Object.entries(rec.out)) maxOut[k] = v / rec.time;
      }
    }
    if (def.coal) maxIn.charbon = (maxIn.charbon ?? 0) + 1 / RULES.coalMachineSeconds;
    const rate = (x: number) => (x < 0.005 ? '0' : x >= 10 ? x.toFixed(1).replace('.', ',') : x.toFixed(2).replace('.', ','));
    const chevron = (color: string) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 L10.5 8 L6 12.5"/></svg>`;
    const rows = (side: 'in' | 'out') => {
      const r = side === 'in' ? real.in : real.out, mx = side === 'in' ? maxIn : maxOut;
      const keys = [...new Set([...Object.keys(mx), ...Object.keys(r)])]
        .sort((a, b) => Number(a === 'charbon') - Number(b === 'charbon'));
      return keys.map((k) => {
        const max = mx[k] ?? 0;
        // La mesure peut dépasser d'un cheveu le maximum (bord de la fenêtre) : on la borne.
        const v = max > 0 ? Math.min(r[k] ?? 0, max) : r[k] ?? 0;
        const pct = max > 0 ? Math.min(100, (v / max) * 100) : v > 0 ? 100 : 0;
        const fuel = side === 'in' && k === 'charbon' && !def.recipes.some((x) => x.in.charbon);
        return `<div class="flow-row ${side}">
          <span class="flow-badge">${chevron(side === 'in' ? '#F47C64' : '#2E6B51')}</span>
          <div class="flow-main"><small>${side === 'in' ? 'Entrée' : 'Sortie'}${fuel ? ' · carburant' : ''}</small><span class="flow-item"><img src="${this.itemIcons.get(k)}" alt="">${esc(item(k).name)}</span></div>
          <div class="flow-rate"><b>${rate(v)}</b><span>/ s</span>${max > 0 ? `<small>max ${rate(max)}</small>` : ''}</div>
          <span class="flow-bar"><span style="width:${pct}%"></span></span>
        </div>`;
      }).join('');
    };
    const card = h('div', 'card flow');
    const body = rows('in') + rows('out');
    card.innerHTML = `<p class="muted">Débit réel · mesuré sur les ${FLOW_WINDOW} dernières secondes</p>${body || '<p class="muted small">Rien ne passe pour l’instant.</p>'}`;
    return card;
  }

  /** La Revente en grand : contenu, passage du gros drone, et dépôt depuis l'inventaire. */
  openSell(m: Machine): void {
    this.closePopover();
    this.invSel = null;
    this.openSheet((sheet, close) => {
      const g = this.game;
      const bin = g.view.machines.get(m.id);
      if (!bin) { close(); return; }
      const n = g.sellCount(bin);
      const t = Math.ceil(g.nextPickup), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
      const coming = g.pickups.some((x) => x.id === bin.id && !x.done);
      sheet.append(this.sheetHead('Revente', coming ? 'Le gros drone est là !' : `Prochain passage du gros drone dans ${mm} min ${ss}`, close));
      const info = h('div', 'card');
      info.innerHTML = `<p class="muted">Tout ce qui arrive ici est revendu à bas prix : ${n} objet${n > 1 ? 's' : ''} sur ${RULES.sellCap}, environ ${g.sellValue(bin)} pièces.</p>${n ? `<div class="chips">${this.chips(bin.inBuf)}</div>` : ''}`;
      sheet.append(info, this.depositCard(bin));
      const acts = h('div', 'row');
      const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
      mv.onclick = () => { close(); this.startMove(bin); };
      const del = this.deleteButton(bin, 'Supprimer', n ? 'Son contenu sera perdu : toucher encore' : 'Toucher encore pour supprimer', close);
      acts.append(mv, del);
      sheet.append(acts);
    }, true);
    this.sheetKind = 'sell';
  }

  // ---------- Camions et trains ----------

  /** Le nom d'un arrêt : « Dépôt 2 », « Gare 1 » (numérotés dans l'ordre de pose). */
  private stationName(m: Machine): string {
    const same = [...this.game.view.machines.values()].filter((x) => x.type === m.type).sort((a, b) => a.id - b.id);
    return `${machineDef(m.type).name} ${same.indexOf(m) + 1}`;
  }

  /** Ce que fait un véhicule, en quelques mots. */
  private vehicleDoing(l: Line, i: number): string {
    const f = this.game.view, v = l.vehicles[i];
    const here = f.machines.get(l.stops[v.at % l.stops.length].id), next = f.machines.get(l.stops[(v.at + 1) % l.stops.length].id);
    const n = f.cargoCount(v);
    const load = n ? ` · ${n} objet${n > 1 ? 's' : ''}` : '';
    if (v.moving) return `vers ${next ? this.stationName(next) : '?'}${load}`;
    return `${l.stops[v.at % l.stops.length].load ? 'charge' : 'décharge'} à ${here ? this.stationName(here) : '?'}${load}`;
  }

  /** Dans la fenêtre d'un dépôt ou d'une gare : ses lignes, et le bouton pour en ouvrir une. */
  private stationCard(m: Machine): HTMLElement {
    const g = this.game, f = g.view, kind = g.stationKind(m)!;
    const card = h('div', 'card');
    const word = kind === 'train' ? 'gare' : 'dépôt';
    card.append(h('p', 'muted', kind === 'train' ? 'Trains' : 'Camions'));
    for (const l of f.linesOf(m)) {
      const names = l.stops.map((st) => { const x = f.machines.get(st.id); return x ? this.stationName(x) : '?'; }).join(' → ');
      const row = h('div', 'row link-row', `<span>${esc(names)} · ${l.vehicles.length} ${kind === 'train' ? 'train' : 'camion'}${l.vehicles.length > 1 ? 's' : ''}</span>`);
      const open = h('button', 'btn', 'Gérer');
      open.onclick = () => this.openLine(l.id);
      row.append(open);
      card.append(row);
    }
    const others = [...f.machines.values()].filter((x) => x.type === m.type && x !== m);
    const link = h('button', 'btn primary', `Relier à ${kind === 'train' ? 'une autre gare' : 'un autre dépôt'}`);
    link.onclick = () => {
      if (!others.length) { this.toast(`Pose d’abord ${kind === 'train' ? 'une autre gare' : 'un autre dépôt'}`, 'info'); return; }
      this.closeSheet();
      this.openMap({
        title: kind === 'train' ? 'Choisis l’autre gare' : 'Choisis l’autre dépôt',
        sub: `${this.stationName(m)} : touche l’arrêt d’arrivée`,
        candidates: others,
        onPick: (to) => { const l = g.linkStations(m, to); if (l) this.openLine(l.id); },
      });
    };
    card.append(link);
    if (!f.linesOf(m).length) card.append(h('p', 'muted small', `Remplis ce ${word} par tapis (ou les drones), relie-le : le véhicule charge ici et décharge à l’autre bout.`));
    return card;
  }

  /** Toutes les lignes (bouton Transport). */
  openLines(): void {
    this.closePopover();
    this.openSheet((sheet, close) => {
      const g = this.game, f = g.view;
      sheet.append(this.sheetHead('Transport', 'Camions entre dépôts, trains entre gares', close));
      const card = h('div', 'card');
      if (!f.lines.size) {
        card.innerHTML = `<p class="muted">Aucune ligne. Pose deux ${g.isUnlocked('train') ? 'dépôts (ou deux gares)' : 'dépôts'} depuis la palette des machines, remplis le premier par tapis, puis touche-le : « Relier à un autre dépôt ».</p>`;
      }
      for (const l of f.lines.values()) {
        const names = l.stops.map((st) => { const x = f.machines.get(st.id); return x ? this.stationName(x) : '?'; }).join(' → ');
        const row = h('div', 'row link-row', `<span>${l.kind === 'train' ? 'Train' : 'Camion'} · ${esc(names)} · ${l.vehicles.length} véhicule${l.vehicles.length > 1 ? 's' : ''}</span>`);
        const open = h('button', 'btn', 'Gérer');
        open.onclick = () => this.openLine(l.id);
        row.append(open);
        card.append(row);
      }
      sheet.append(card);
    }, true);
    this.sheetKind = 'line';
  }

  /** Une ligne : ses arrêts (charge ou décharge), ses véhicules, un troisième arrêt. */
  openLine(id: number): void {
    this.closePopover();
    this.openSheet((sheet, close) => {
      const g = this.game, f = g.view, l = f.lines.get(id);
      if (!l) { close(); return; }
      const truck = l.kind !== 'train';
      sheet.append(this.sheetHead(truck ? 'Ligne de camions' : 'Ligne de trains', `${l.stops.length} arrêts, parcourus en boucle · ${truck ? RULES.truckLoad : RULES.trainLoad} objets par voyage`, close));
      // Arrêts
      const stops = h('div', 'card');
      stops.append(h('p', 'muted', 'Arrêts · on charge tout ce que l’arrêt garde, ou on y vide tout'));
      l.stops.forEach((st, i) => {
        const m = f.machines.get(st.id);
        const row = h('div', 'row link-row stop-row', `<span><b>${i + 1}.</b> ${esc(m ? this.stationName(m) : '?')}</span>`);
        const seg = h('div', 'seg');
        for (const [load, label] of [[true, 'Charge'], [false, 'Décharge']] as const) {
          const b = h('button', `btn${st.load === load ? ' primary' : ''}`, label);
          b.onclick = () => { g.setStopLoad(l.id, i, load); this.refreshSheet(); };
          seg.append(b);
        }
        row.append(seg);
        stops.append(row);
      });
      if (l.stops.length < 3) {
        const cand = [...f.machines.values()].filter((x) => g.stationKind(x) === l.kind && !l.stops.some((st) => st.id === x.id));
        const add = h('button', 'btn', `Ajouter un arrêt${cand.length ? '' : ` (pose ${truck ? 'un autre dépôt' : 'une autre gare'})`}`);
        add.disabled = !cand.length;
        add.onclick = () => {
          this.closeSheet();
          this.openMap({
            title: 'Troisième arrêt', sub: 'Touche l’arrêt à ajouter', candidates: cand,
            onPick: (m) => { if (!g.addStop(l.id, m)) this.toast('Pas assez de pièces', 'warn'); this.openLine(l.id); },
          });
        };
        stops.append(add);
      }
      sheet.append(stops);
      // Véhicules
      const vc = h('div', 'card');
      vc.append(h('p', 'muted', `${truck ? 'Camions' : 'Trains'} · plus il y en a, plus la ligne va vite`));
      l.vehicles.forEach((_, i) => vc.append(h('div', 'row link-row', `<span>${truck ? 'Camion' : 'Train'} ${i + 1} · ${esc(this.vehicleDoing(l, i))}</span>`)));
      const row = h('div', 'row');
      const minus = h('button', 'btn', `Retirer un ${truck ? 'camion' : 'train'}`);
      minus.disabled = l.vehicles.length <= 1;
      minus.onclick = () => { g.removeVehicle(l.id); this.refreshSheet(); };
      const plus = h('button', 'btn primary', `Ajouter · ${ICONS.coinSm}${g.vehiclePrice(l.kind)}`);
      plus.disabled = l.vehicles.length >= RULES.maxVehicles;
      plus.onclick = () => { if (!g.addVehicle(l.id)) this.toast('Pas assez de pièces', 'warn'); this.refreshSheet(); };
      row.append(minus, plus);
      vc.append(row);
      sheet.append(vc);
      const end = h('div', 'row');
      const shut = h('button', 'btn danger', `Fermer la ligne · rend ${g.linePrice(l)}`);
      shut.onclick = () => { g.removeLine(l.id); close(); };
      end.append(shut);
      sheet.append(end);
    }, true);
    this.sheetKind = 'line';
  }

  /** Les tapis souterrains d'une machine (départs et arrivées), avec de quoi les couper. */
  private tunnelsCard(m: Machine): HTMLElement | null {
    const g = this.game, list = g.view.tunnelsOf(m);
    if (!list.length) return null;
    const card = h('div', 'card');
    if (list.length) card.append(h('p', 'muted', 'Tapis souterrains'));
    for (const t of list) {
      const out = t.from === m.id;
      const other = g.view.machines.get(out ? t.to : t.from);
      const moving = t.items.length ? ` · ${t.items.length} en route` : '';
      const row = h('div', 'row link-row', `<span>${out ? '↓ vers' : '↑ depuis'} ${esc(other ? machineDef(other.type).name.toLowerCase() : '?')} · ${g.view.tunnelLength(t)} cases${moving}</span>`);
      const cut = h('button', 'btn', 'Couper');
      cut.onclick = () => { g.removeTunnel(t.id); this.refreshSheet(); };
      row.append(cut);
      card.append(row);
    }
    return card;
  }

  /** Un coffre en grand, avec l'inventaire du robot dessous. */
  openChest(m: Machine): void {
    this.closePopover();
    this.invSel = null;
    this.chestId = m.id;
    this.openSheet((sheet, close) => {
      const chest = this.game.view.machines.get(this.chestId);
      if (!chest) { close(); return; }
      const g = this.game;
      let total = 0;
      for (const v of Object.values(chest.inBuf)) total += v;
      sheet.classList.add('inv-sheet');
      sheet.append(this.sheetHead(machineDef(chest.type).name, `${fmt(total)} / ${g.view.slotsOf(chest) * RULES.invStack} objets · les tapis le remplissent et le vident, les drones s’y servent`, close));
      const c1 = h('div', 'card');
      c1.innerHTML = `<p class="muted">${esc(machineDef(chest.type).name)}</p>${this.gridHtml(this.chestCells(chest), 'chest')}`;
      const swap = h('div', 'inv-swap', `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3 V15 M3 12 L6 15 L9 12 M12 15 V3 M9 6 L12 3 L15 6"/></svg>Touche une pile pour la déplacer`);
      const c2 = h('div', 'card');
      c2.innerHTML = `<p class="muted">Inventaire de ${esc(g.look.name)}</p>${this.gridHtml(g.robot.inv.slots, 'robot')}`;
      this.wireGrid(c1, chest);
      this.wireGrid(c2, chest);
      sheet.append(c1, swap, c2);
      const bar = this.invBar(chest);
      if (bar) { bar.classList.add('floating'); sheet.append(bar); }
      // Dépôt ou gare : ses lignes, et de quoi le relier à un autre.
      if (g.stationKind(chest)) sheet.append(this.stationCard(chest));
      const tc = this.tunnelsCard(chest);
      if (tc) sheet.append(tc);
      const acts = h('div', 'row');
      const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
      mv.onclick = () => { close(); this.startMove(chest); };
      const del = this.deleteButton(chest, 'Supprimer', total ? 'Son contenu sera perdu : toucher encore' : 'Toucher encore pour supprimer', close);
      acts.append(mv, del);
      sheet.append(acts);
    }, true);
    this.sheetKind = 'chest';
  }

  /** La liste des tâches d'un drone, à ranger de la plus importante à la moins importante. */
  private openPriorities(i: number, station?: number): void {
    this.closePopover();
    const g = this.game;
    const setOrder = (list: DronePriority[]) => (station !== undefined ? g.setStationPriorities(station, list) : g.setDronePriorities(i, list));
    this.openSheet((sheet, close) => {
      const d = station !== undefined ? g.stationDrones.get(station) : g.drones[i];
      if (!d) { close(); return; }
      sheet.append(this.sheetHead(station !== undefined ? 'Priorités du drone de la station' : `Priorités du drone ${i + 1}`, 'De la plus importante à la moins importante. Le drone fait la première tâche utile de la liste ; son propre charbon passe toujours avant.', close));
      const list = h('div', 'prio-list');
      const move = (from: number, to: number) => {
        const order = [...d.priorities];
        const [p] = order.splice(from, 1);
        order.splice(to, 0, p);
        setOrder(order);
        this.refreshSheet();
      };
      d.priorities.forEach((p, k) => {
        const row = h('div', `prio-item${k === 0 ? ' first' : ''}`);
        row.innerHTML = `<span class="prio-n">${k + 1}</span><span class="prio-ico">${PRIO_ICONS[p] ?? ''}</span><b>${esc(DRONE_PRIORITIES.find((x) => x.id === p)?.label ?? p)}</b>`;
        const up = h('button', 'prio-move', '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9 L7 5 L11 9"/></svg>');
        up.setAttribute('aria-label', 'Monter');
        up.disabled = k === 0;
        up.onclick = () => move(k, k - 1);
        const down = h('button', 'prio-move', '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5 L7 9 L11 5"/></svg>');
        down.setAttribute('aria-label', 'Descendre');
        down.disabled = k === d.priorities.length - 1;
        down.onclick = () => move(k, k + 1);
        row.append(up, down);
        list.append(row);
      });
      sheet.append(list);
      const row = h('div', 'row prio-actions');
      if (g.drones.length > 1 && station === undefined) {
        const all = h('button', 'btn', 'Même ordre pour tous');
        all.onclick = () => {
          g.drones.forEach((_, j) => g.setDronePriorities(j, d.priorities));
          this.toast('Tous les drones suivent cet ordre', 'good');
        };
        row.append(all);
      }
      const reset = h('button', 'btn', 'Ordre de départ');
      reset.onclick = () => { setOrder(DEFAULT_ORDER); this.refreshSheet(); };
      row.append(reset);
      sheet.append(row);
      if (g.drones.length > 1 && station === undefined) {
        const tabs = h('div', 'row');
        g.drones.forEach((_, j) => {
          if (j === i) return;
          const b = h('button', 'btn', `Drone ${j + 1}`);
          b.onclick = () => this.openPriorities(j);
          tabs.append(b);
        });
        sheet.append(tabs);
      }
    }, true);
  }

  private popKey = '';
  private popActions = '';

  /** Met à jour la bulle. Renvoie vrai si les boutons ont été recréés (il faut les rebrancher). */
  /** Tri : choisir l'objet qui part dans la dérivation d'un séparateur. */
  private openSortPicker(b: Belt): void {
    this.closePopover();
    const g = this.game;
    this.openSheet((sheet, close) => {
      sheet.append(this.sheetHead('Trier', 'Choisis l’objet qui part dans la dérivation ; tout le reste continue tout droit.', close));
      // D'abord ce qui passe sur ce tapis et ce qu'on fabrique déjà, puis le reste.
      const onBelt = new Set<string>();
      for (const c of g.view.chainOf(b)) for (const it of c.items) onBelt.add(it.t);
      const known = Object.keys(g.factory.stats.made);
      const order = [...new Set([...onBelt, ...known, ...ITEM_LIST.map((x) => x.id)])].filter((id) => id !== 'eau');
      const card = h('div', 'card');
      const grid = h('div', 'sort-grid');
      const none = h('button', `sort-cell${!b.filter ? ' on' : ''}`, '<span class="sc-none">½</span><small>Un sur deux</small>');
      none.onclick = () => { g.setBeltFilter(b, null); close(); };
      grid.append(none);
      for (const id of order) {
        const c = h('button', `sort-cell${b.filter === id ? ' on' : ''}`, `<img src="${this.itemIcons.get(id)}" alt=""><small>${esc(item(id).name)}</small>`);
        c.onclick = () => { g.setBeltFilter(b, id); close(); };
        grid.append(c);
      }
      card.append(grid);
      sheet.append(card);
    });
  }

  /** Statistiques : ce que l'usine fabrique, par minute, et depuis le début. */
  private openStats(): void {
    const g = this.game;
    this.openSheet((sheet, close) => {
      sheet.append(this.sheetHead('Statistiques', 'Ce que ton usine fabrique et extrait · par minute, sur la dernière minute et les 5 dernières', close));
      const made = g.factory.stats.made;
      const ids = Object.keys(made).filter((k) => made[k] > 0).sort((a, b) => g.ratePerMinute(b, 300) - g.ratePerMinute(a, 300) || made[b] - made[a]);
      const total = Object.values(made).reduce((a, b) => a + b, 0);
      const head = h('div', 'card');
      head.innerHTML = `<p class="muted">${fmt(total)} objets fabriqués ou extraits depuis le début · ${ids.length} sortes</p>`;
      sheet.append(head);
      const card = h('div', 'card stats');
      if (!ids.length) card.innerHTML = '<p class="muted">Rien encore : pose une foreuse sur un filon.</p>';
      for (const id of ids) {
        const r1 = g.ratePerMinute(id, 60), r5 = g.ratePerMinute(id, 300);
        // La courbe des 10 dernières minutes (une valeur toutes les 10 secondes).
        const hist = g.statHistory;
        const pts: number[] = [];
        for (let i = 1; i < hist.length; i++) pts.push(((hist[i].made[id] ?? 0) - (hist[i - 1].made[id] ?? 0)) * 6);
        const max = Math.max(1, ...pts);
        const W = 90, H = 26;
        const line = pts.map((v, i) => `${(i / Math.max(1, pts.length - 1)) * W},${H - (v / max) * (H - 2) - 1}`).join(' ');
        const row = h('div', 'stat-row');
        row.innerHTML = `<img src="${this.itemIcons.get(id)}" alt=""><div class="st-name"><b>${esc(item(id).name)}</b><small>${fmt(made[id])} en tout</small></div>
          <svg class="st-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${pts.length > 1 ? `<polyline points="${line}" fill="none" stroke="#2E6B51" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}</svg>
          <div class="st-rate"><b>${fmtN(r1)}</b><small>/ min · ${fmtN(r5)} sur 5 min</small></div>`;
        card.append(row);
      }
      sheet.append(card);
    }, true);
  }

  /** Les succès : obtenus, et ceux qui restent (avec un indice). */
  private openAchievements(): void {
    const g = this.game;
    this.openSheet((sheet, close) => {
      const n = ACHIEVEMENTS.filter((a) => g.achievements.has(a.id)).length;
      sheet.append(this.sheetHead('Succès', `${n} sur ${ACHIEVEMENTS.length}`, close));
      const card = h('div', 'card ach');
      for (const a of ACHIEVEMENTS) {
        const done = g.achievements.has(a.id);
        const row = h('div', `ach-row${done ? ' done' : ''}`);
        row.innerHTML = `<span class="ach-ico">${done ? '★' : '☆'}</span><div><b>${esc(a.name)}</b><small>${esc(a.hint)}</small></div>`;
        card.append(row);
      }
      sheet.append(card);
    });
  }

  private setPopover(k: string, info: string, actions: string): boolean {
    const p = this.popover;
    if (k !== this.popKey || !p.firstElementChild) {
      p.innerHTML = '<div class="pinfo"></div><div class="pact"></div>';
      this.popKey = k;
      this.popActions = '';
    }
    const pi = p.querySelector('.pinfo')!, pa = p.querySelector('.pact')!;
    if (pi.innerHTML !== info) pi.innerHTML = info;
    if (actions === this.popActions) return false;
    pa.innerHTML = actions;
    this.popActions = actions;
    return true;
  }

  private positionPopover(): void {
    const sel = this.r.selection;
    if (!sel) return;
    let wx: number, wy: number, top: number;
    if (sel.kind === 'machine') {
      const m = this.game.view.machines.get(sel.id);
      if (!m) return;
      wx = (m.x + m.w / 2) * CELL; wy = m.y * CELL; top = (m.y + m.h) * CELL;
    } else if (sel.kind === 'robot') {
      const r = this.game.robot;
      wx = r.x * CELL; wy = (r.y - 1.6) * CELL; top = (r.y + 0.4) * CELL;
    } else {
      wx = (sel.x + 0.5) * CELL; wy = sel.y * CELL; top = (sel.y + 1) * CELL;
    }
    const s = this.r.camera.worldToScreen(wx, wy);
    const below = this.r.camera.worldToScreen(wx, top);
    const pw = 230, ph = this.popover.offsetHeight || 150;
    let x = s.x - pw / 2, y = s.y - ph - 18;
    if (y < 150) y = below.y + 14;
    x = Math.max(12, Math.min(window.innerWidth - pw - 12, x));
    y = Math.max(150, Math.min(window.innerHeight - ph - 100, y));
    this.popover.style.left = `${x}px`;
    this.popover.style.top = `${y}px`;
  }

  // ---------- Feuilles : commandes et menu ----------

  private openSheet(build: (sheet: HTMLElement, close: () => void) => void, live = false): void {
    this.closeSheet();
    const back = h('div', 'backdrop');
    const sheet = h('div', 'sheet');
    back.append(sheet);
    const close = () => this.closeSheet();
    // Le « clic » qui suit le toucher d'ouverture tombe sur le fond : on l'ignore.
    const opened = performance.now();
    back.onclick = (e) => { if (e.target === back && performance.now() - opened > 450) close(); };
    // Et par sécurité : aucun clic dans la fenêtre pendant son ouverture (clic fantôme du toucher qui l'a ouverte).
    back.addEventListener('click', (e) => {
      if (performance.now() - opened < 450) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    build(sheet, close);
    this.root.append(back);
    this.overlay = back;
    this.sheetBuild = live ? build : null;
    this.sheetDirty = false;
  }

  /** Reconstruit la feuille ouverte (livraisons en cours), en gardant le défilement. */
  private refreshSheet(): void {
    const back = this.overlay, build = this.sheetBuild;
    if (!back || !build) return;
    const sheet = back.firstElementChild as HTMLElement;
    const top = sheet.scrollTop;
    sheet.innerHTML = '';
    build(sheet, () => this.closeSheet());
    sheet.scrollTop = top;
  }

  private closeSheet(): void {
    this.r.rangeOf = null;
    this.overlay?.remove();
    this.overlay = null;
    this.sheetBuild = null;
    this.sheetKind = '';
  }

  private sheetHead(title: string, sub: string, close: () => void): HTMLElement {
    const head = h('div', 'sheet-head');
    head.innerHTML = `<div><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div>`;
    const x = h('button', 'round', ICONS.close);
    x.setAttribute('aria-label', 'Fermer');
    x.onclick = close;
    head.append(x);
    return head;
  }

  /** Lignes « objet : x / y » avec barre de progression. */
  private costRows(lines: [string, number, number][]): string {
    return `<div class="ts-costs">${lines.map(([k, have, need]) => {
      const v = Math.min(have, need);
      return `<div class="ts-cost${v >= need ? ' done' : ''}"><img src="${this.itemIcons.get(k)}" alt=""><span>${esc(item(k).name)}</span><b>${fmt(v)} / ${fmt(need)}</b><span class="ts-bar"><span style="width:${(v / need) * 100}%"></span></span></div>`;
    }).join('')}</div>`;
  }

  /** Boutons Déplacer et Supprimer d'un bâtiment ouvert en feuille (Laboratoire, Comptoir). */
  private buildingActions(type: string, close: () => void, _note: string): HTMLElement | null {
    const m = [...this.game.factory.machines.values()].find((x) => x.type === type);
    if (!m) return null;
    const def = machineDef(type);
    const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
    mv.onclick = () => { close(); this.startMove(m); };
    const wrap = h('div', 'card');
    wrap.innerHTML = `<p class="muted">${def.name} · un cadeau du Noyau : on peut le déplacer, pas le supprimer.</p>`;
    wrap.append(mv);
    return wrap;
  }

  /** Le Noyau offre un bâtiment : la caméra va le voir, une carte explique à quoi il sert. */
  private onGift(type: string, id: number, again = false): void {
    const m = this.game.view.machines.get(id);
    if (!m) return;
    this.closePopover();
    this.closeSheet();
    if (this.tree.isOpen) this.tree.close();
    this.setTool('none');
    this.root.querySelector('.gift-card')?.remove();
    this.r.focusOn(m.x + m.w / 2, m.y + m.h / 2 + 2.2, 1.15);
    this.r.highlightMachine(id);
    const text = GIFT_TEXT[type];
    if (!text) return;
    const name = this.game.look.name;
    const card = h('div', 'gift-card');
    const lines = again
      ? [`Il avait disparu à cause d’une erreur de sauvegarde, désormais corrigée. Le Noyau te le rend, avec tout ce qu’il gardait.`]
      : text.lines.map((l) => l.replace('{robot}', name));
    card.innerHTML = `<div class="gc-head"><img src="${this.machineIcons.get(type)}" alt=""><div><span class="gc-tag">${again ? 'Le Noyau te le rend' : 'Cadeau du Noyau'}</span><b>${esc(text.title)}</b></div></div>
      ${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
      <p class="gc-note">Tu peux le déplacer, mais pas le supprimer.</p>`;
    const row = h('div', 'row');
    const ok = h('button', 'btn', 'Compris');
    ok.onclick = () => card.remove();
    const open = h('button', 'btn primary', text.open);
    open.onclick = () => { card.remove(); if (type === 'comptoir') this.openOrders(); else this.openLab(); };
    row.append(ok, open);
    card.append(row);
    this.root.append(card);
  }

  /** La mission du Noyau : ce qu'il demande pour passer au palier suivant. */
  openNoyau(): void {
    this.closePopover();
    this.invSel = null;
    const g = this.game;
    this.openSheet((sheet, close) => {
      const mission = palierMission(g.palier);
      if (!mission) {
        sheet.append(this.sheetHead('Le Noyau est complet', `Palier ${g.palier} atteint : toutes les missions sont faites.`, close));
        return;
      }
      sheet.append(this.sheetHead(`Mission du Noyau`, `Palier ${g.palier} → palier ${mission.to}`, close));
      const card = h('div', 'card');
      card.innerHTML = `<p><b>${esc(mission.pitch)}</b></p>${this.costRows(Object.entries(mission.lines).map(([k, v]) => [k, g.palierDone[k] ?? 0, v]))}
        <p class="muted">Relie un tapis au Noyau, ou range ces objets dans un coffre : les drones les y apportent.</p>`;
      sheet.append(card);
      sheet.append(this.depositCard(g.noyau));
      const opens = ALL_NODES.filter((x) => x.palier === mission.to);
      if (opens.length) {
        const c2 = h('div', 'card');
        c2.innerHTML = `<p class="muted">Le palier ${mission.to} ouvre</p>${this.nodeTiles(opens)}`;
        sheet.append(c2);
      }
      const tree = h('button', 'btn', 'Ouvrir l’arbre de déblocages');
      tree.onclick = () => { close(); this.openTree(); };
      sheet.append(tree);
    }, true);
    this.sheetKind = 'building';
  }

  /** Le Laboratoire : son stock et les déblocages qu'il peut payer. */
  openLab(): void {
    this.closePopover();
    this.invSel = null;
    const g = this.game;
    this.openSheet((sheet, close) => {
      sheet.append(this.sheetHead('Laboratoire', `Il garde les objets qui servent à débloquer l’arbre (${RULES.labCap} de chaque au plus).`, close));
      const open = ALL_NODES.filter((x) => g.nodeState(x) === 'available')
        .sort((a, b) => Number(g.canAfford(b)) - Number(g.canAfford(a)) || a.palier - b.palier);
      if (open.length === 0) {
        sheet.insertAdjacentHTML('beforeend', '<div class="card"><p class="muted">Rien à débloquer pour l’instant : termine la mission du Noyau pour ouvrir la suite de l’arbre.</p></div>');
      }
      for (const x of open) {
        const c = h('div', 'card lab-node');
        c.innerHTML = `<div class="lab-title"><span class="lab-ico">${NODE_ICONS[x.icon] ?? ''}</span><b>${esc(x.name)}</b></div>
          ${this.costRows(Object.entries(x.cost).map(([k, v]) => [k, g.lab[k] ?? 0, v]))}`;
        if (g.canAfford(x)) {
          const b = h('button', 'btn primary', 'Débloquer');
          b.onclick = () => { if (g.unlock(x.id)) this.toast(`${x.name} débloqué`, 'good'); this.refreshSheet(); };
          c.append(b);
        }
        sheet.append(c);
      }
      const stock = Object.entries(g.lab).filter(([, n]) => n > 0);
      const st = h('div', 'card');
      st.innerHTML = `<p class="muted">En stock</p>${stock.length ? `<div class="chips">${this.chips(Object.fromEntries(stock))}</div>` : '<p class="muted">Vide. Relie-lui un tapis, ou range les objets dans un coffre : les drones les y apportent.</p>'}`;
      sheet.append(st);
      const lab = [...g.factory.machines.values()].find((x) => x.type === 'laboratoire');
      if (lab) sheet.append(this.depositCard(lab));
      const tree = h('button', 'btn', 'Ouvrir l’arbre de déblocages');
      tree.onclick = () => { close(); this.openTree(); };
      sheet.append(tree);
      const act = this.buildingActions('laboratoire', close, 'Son stock reste gardé.');
      if (act) sheet.append(act);
    }, true);
    this.sheetKind = 'building';
  }

  private orderCardHtml(o: Order, withProgress: boolean): string {
    const lines = o.lines.map((l) => `<div class="line"><img src="${this.itemIcons.get(l.item)}" alt="">${esc(item(l.item).name)}<span class="count">${withProgress ? `${Math.min(l.done, l.qty)} / ` : ''}${l.qty}</span></div>`).join('');
    return `<span class="tag ${o.rarity}">${RARITY_LABEL[o.rarity]}</span>${lines}
      <div class="rewards"><span class="reward">${ICONS.coinSm}+${fmt(o.money)}</span></div>`;
  }

  /** Le Comptoir : des commandes au choix, payées en pièces. */
  openOrders(): void {
    this.closePopover();
    this.invSel = null;
    const g = this.game;
    if (!g.order && g.choices.length === 0) g.refreshChoices();
    this.openSheet((sheet, close) => {
      if (g.order) {
        sheet.append(this.sheetHead('Comptoir', 'Commande en cours : relie un tapis au Comptoir, ou laisse les drones y apporter le contenu de tes coffres.', close));
        sheet.append(h('div', 'card', this.orderCardHtml(g.order, true)));
        const comptoir = [...g.factory.machines.values()].find((x) => x.type === 'comptoir');
        if (comptoir) sheet.append(this.depositCard(comptoir));
        // Abandonner : en deux temps (ce qui a déjà été livré est perdu).
        const armed = performance.now() < this.armedAbandon;
        const quit = h('button', `btn danger${armed ? ' armed' : ''}`, armed ? 'Toucher encore : ce qui est livré sera perdu' : 'Abandonner la commande');
        quit.onclick = () => {
          if (performance.now() >= this.armedAbandon) {
            this.armedAbandon = performance.now() + 4000;
            this.refreshSheet();
            setTimeout(() => { if (performance.now() >= this.armedAbandon && this.sheetKind === 'building') this.refreshSheet(); }, 4100);
            return;
          }
          this.armedAbandon = 0;
          if (g.abandonOrder()) this.toast('Commande abandonnée : choisis-en une autre', 'info');
          this.refreshSheet();
        };
        sheet.append(quit);
      } else {
        sheet.append(this.sheetHead('Comptoir', 'Choisis une commande. Pas de chrono, pas de pénalité : elle se paie en pièces.', close));
        for (const o of g.choices) {
          const card = h('div', 'card', this.orderCardHtml(o, false));
          const pick = h('button', 'btn primary', 'Choisir');
          pick.onclick = () => { g.acceptOrder(o); close(); this.toast('Commande acceptée', 'good'); };
          card.append(pick);
          sheet.append(card);
        }
        const re = h('button', 'btn yellow', `${ICONS.reroll}Relancer les 3 choix · ${ICONS.coinSm}${g.rerollCost()}`);
        re.onclick = () => { g.reroll(); this.refreshSheet(); };
        sheet.append(re);
      }
      const act = this.buildingActions('comptoir', close, '');
      if (act) sheet.append(act);
    }, true);
    this.sheetKind = 'building';
  }

  /** La fusée a décollé : un grand bravo. */
  private rocketLaunched(n: number): void {
    this.closeSheet();
    this.root.querySelector('.celebrate.rocket')?.remove();
    const box = h('div', 'celebrate level rocket');
    box.innerHTML = `<div class="lv-badge">${n}</div><h2>${n === 1 ? 'La fusée décolle !' : `Fusée n° ${n} !`}</h2>
      <p>${n === 1 ? 'Ton usine a construit une fusée et l’a envoyée dans l’espace. C’est la fin du voyage… et rien n’empêche d’en lancer d’autres.' : 'Encore une ! Le programme spatial continue.'}</p>
      <p class="muted-small">${playTime(this.game.played)} de jeu · ${fmt(Object.values(this.game.factory.stats.made).reduce((a, b) => a + b, 0))} objets fabriqués</p>`;
    const ok = h('button', 'btn primary', 'Continuer');
    ok.style.width = '100%';
    ok.onclick = () => box.remove();
    box.append(ok);
    setTimeout(() => this.root.append(box), 2600);
  }

  private celebrate(o: Order): void {
    this.closeSheet();
    const box = h('div', 'celebrate');
    box.innerHTML = `<h2>Commande livrée !</h2><p>${esc(Game.orderTitle(o))}</p>
      <div class="rewards" style="justify-content:center;margin-bottom:14px"><span class="reward">${ICONS.coinSm}+${fmt(o.money)}</span></div>`;
    const next = h('button', 'btn primary', 'Choisir la suivante');
    next.style.width = '100%';
    next.onclick = () => { box.remove(); this.openOrders(); };
    box.append(next);
    this.root.append(box);
    box.addEventListener('pointerdown', (ev) => { if (ev.target === box) box.remove(); });
    setTimeout(() => { if (box.isConnected && !this.overlay) box.remove(); }, 12000);
  }

  private openMenu(): void {
    this.closePopover();
    const g = this.game;
    this.openSheet((sheet, close) => {
      const head = h('div', 'sheet-head');
      head.innerHTML = `<div><h2>Usine fractale</h2><p>${esc(g.look.name)} · version ${esc(__VERSION__)}</p></div>`;
      const x = h('button', 'round', ICONS.close);
      x.setAttribute('aria-label', 'Fermer');
      x.onclick = close;
      head.append(x);

      const upd = h('button', 'btn primary', 'Chercher une mise à jour');
      upd.onclick = () => checkForUpdate(upd, () => this.cb.beforeReload(), (t, tone) => this.toast(t, tone));
      const treeBtn = h('button', 'btn', `Arbre de déblocages · palier ${g.palier}`);
      treeBtn.onclick = () => { close(); this.openTree(); };
      const center = h('button', 'btn', `Recentrer sur ${esc(g.look.name)}`);
      center.onclick = () => { this.r.centerOnRobot(); close(); };
      const recipesBtn = h('button', 'btn', 'Toutes les recettes');
      recipesBtn.onclick = () => this.openRecipes();
      const statsBtn = h('button', 'btn', 'Statistiques');
      statsBtn.onclick = () => this.openStats();
      const achBtn = h('button', 'btn', `Succès · ${[...g.achievements].length}/${ACHIEVEMENTS.length}`);
      achBtn.onclick = () => this.openAchievements();

      const saveCard = h('div', 'card');
      saveCard.innerHTML = `<p class="muted">Cette partie · ${playTime(g.played)} de jeu · graine ${esc(g.world.seed)}</p>`;
      const row = h('div', 'row');
      const exp = h('button', 'btn', 'Exporter la partie');
      exp.onclick = () => this.openExport();
      const copy = h('button', 'btn', 'Copier la graine');
      copy.onclick = async () => this.toast((await copyText(g.world.seed)) ? 'Graine copiée' : g.world.seed, 'good');
      row.append(exp, copy);
      const tipsBtn = h('button', 'btn', g.tips.off ? 'Réactiver les conseils' : 'Couper les conseils');
      tipsBtn.onclick = () => {
        if (g.tips.off) { this.tips.restart(); this.toast('Conseils réactivés', 'good'); } else { g.tips.off = true; this.toast('Plus de conseils sur cette partie', 'info'); }
        close();
      };
      saveCard.append(row, tipsBtn);

      const title = h('button', 'btn', 'Menu principal');
      title.onclick = () => { close(); this.cb.toTitle(); };

      const help = h('div', 'card');
      const standalone = (navigator as unknown as { standalone?: boolean }).standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
      help.innerHTML = `<p class="muted"><b>Gestes</b> · Sans outil : glisse pour te déplacer, touche le sol pour envoyer ${esc(g.look.name)}. Avec un outil : un doigt trace ou pose. Deux doigts : déplacer et zoomer.</p>
        ${standalone ? '' : '<p class="muted"><b>Installer</b> · Dans Safari : Partager, puis « Sur l’écran d’accueil ». Le jeu s’ouvre alors en plein écran et ta sauvegarde est mieux protégée.</p>'}`;
      sheet.append(head, upd, treeBtn, recipesBtn, statsBtn, achBtn, center, saveCard, title, help);
    });
  }

  /** Le code de la partie en cours, à copier ou partager. */
  private openExport(): void {
    this.closeSheet();
    const back = h('div', 'backdrop');
    this.root.append(back);
    this.overlay = back;
    const close = () => this.closeSheet();
    back.onclick = (e) => { if (e.target === back) close(); };
    exportPanel(this.game.serialize(), close).then((panel) => {
      panel.classList.add('sheet');
      back.append(panel);
    }).catch(() => { close(); this.toast('Export impossible sur ce navigateur', 'warn'); });
  }

  /** Écran de retour : ce que l'usine a produit pendant l'absence. */
  showAway(r: OfflineReport): void {
    const dur = (sec: number) => {
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      return h ? `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}` : `${Math.max(1, m)} min`;
    };
    const gained = Object.entries(r.gained).sort((a, b) => item(b[0]).tier - item(a[0]).tier || b[1] - a[1]);
    const capped = r.away > r.counted + 60;
    this.closeSheet();
    this.root.querySelector('.celebrate')?.remove();
    const box = h('div', 'celebrate away');
    const list = gained.length
      ? `<div class="chips gained">${gained.map(([id, n]) => `<span class="chip"><img src="${this.itemIcons.get(id)}" alt="">+${fmt(n)} ${esc(n > 1 ? item(id).plural : item(id).name.toLowerCase())}</span>`).join('')}</div>`
      : '<p>Rien n’a été livré. Relie une chaîne au Noyau, au Laboratoire ou au Comptoir pour qu’elle travaille pendant ton absence.</p>';
    box.innerHTML = `<h2>Pendant ton absence</h2><p>${dur(r.away)}${capped ? ` · ${dur(r.counted)} comptées` : ''}</p>${gained.length ? '<p>Livré par tes tapis :</p>' : ''}${list}
      <p class="muted-small">Quand le jeu est fermé, l’usine tourne au ralenti (10 %, ${RULES.offlineMaxSeconds / 3600} h au plus).</p>`;
    const btn = h('button', 'btn primary', 'Reprendre');
    btn.style.width = '100%';
    btn.onclick = () => box.remove();
    box.append(btn);
    this.root.append(box);
  }

  toast(text: string, tone: 'info' | 'warn' | 'good' = 'info'): void {
    const t = h('div', `toast ${tone}`);
    t.textContent = text;
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => t.remove(), 2500);
  }

  // ---------- Mini-carte ----------

  /** La vraie carte (appui long sur la mini-carte) : tout ce qui a été exploré ; toucher un endroit y emmène la caméra. */
  openMap(pick?: { title: string; sub: string; candidates: Machine[]; onPick: (m: Machine) => void }): void {
    this.closePopover();
    this.root.querySelector('.map-screen')?.remove();
    const g = this.game, w = g.world;
    const keys = [...w.fogVersion.keys()].map((k) => k.split(',').map(Number));
    if (!keys.length) return;
    const cx0 = Math.min(...keys.map((k) => k[0])), cx1 = Math.max(...keys.map((k) => k[0]));
    const cy0 = Math.min(...keys.map((k) => k[1])), cy1 = Math.max(...keys.map((k) => k[1]));
    const x0 = cx0 * CHUNK, y0 = cy0 * CHUNK, cols = (cx1 - cx0 + 1) * CHUNK, rows = (cy1 - cy0 + 1) * CHUNK;
    // Le sol, une case par pixel.
    const base = document.createElement('canvas');
    base.width = cols; base.height = rows;
    const bctx = base.getContext('2d')!;
    const img = bctx.createImageData(cols, rows);
    const fog = PALETTE.fog;
    for (let i = 0; i < cols * rows; i++) {
      img.data[i * 4] = (fog >> 16) & 255; img.data[i * 4 + 1] = (fog >> 8) & 255; img.data[i * 4 + 2] = fog & 255; img.data[i * 4 + 3] = 255;
    }
    for (const [cx, cy] of keys) {
      const f = w.fogData(cx, cy);
      if (!f) continue;
      for (let i = 0; i < f.length; i++) {
        if (!f[i]) continue;
        const x = cx * CHUNK + (i % CHUNK), y = cy * CHUNK + Math.floor(i / CHUNK);
        const pa = w.patchAt(x, y);
        const c = pa ? item(pa.type).patch ?? 0xcccccc : BIOME_COLORS[w.biomeAt(x, y)];
        const o = ((y - y0) * cols + (x - x0)) * 4;
        img.data[o] = (c >> 16) & 255; img.data[o + 1] = (c >> 8) & 255; img.data[o + 2] = c & 255;
      }
    }
    bctx.putImageData(img, 0, 0);
    const screen = h('div', 'map-screen');
    const head = h('div', 'map-head', pick ? `<div><h2>${esc(pick.title)}</h2><p>${esc(pick.sub)}</p></div>` : '<div><h2>Carte</h2><p>Touche un endroit pour y aller</p></div>');
    const x = h('button', 'round', ICONS.close);
    x.setAttribute('aria-label', 'Fermer');
    const close = () => screen.remove();
    x.onclick = close;
    head.append(x);
    const wrap = h('div', 'map-wrap');
    const canvas = h('canvas');
    wrap.append(canvas);
    screen.append(head, wrap);
    this.root.append(screen);
    // Échelle : toute la zone explorée tient dans l'écran (8 pixels par case au plus).
    const box = wrap.getBoundingClientRect();
    const scale = Math.max(1, Math.min((box.width - 8) / cols, (box.height - 8) / rows, 8));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.width = `${cols * scale}px`; canvas.style.height = `${rows * scale}px`;
    canvas.width = Math.round(cols * scale * dpr); canvas.height = Math.round(rows * scale * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, cols * scale, rows * scale);
    const px = (cx: number) => (cx - x0) * scale, py = (cy: number) => (cy - y0) * scale;
    ctx.fillStyle = '#ffffff';
    for (const b of g.factory.belts.values()) ctx.fillRect(px(b.x), py(b.y), scale, scale);
    for (const m of g.factory.machines.values()) {
      ctx.fillStyle = m.type === 'noyau' ? '#F47C64' : '#2E3A4B';
      ctx.fillRect(px(m.x), py(m.y), m.w * scale, m.h * scale);
    }
    // La caméra (cadre) et le robot (pastille jaune).
    const cam = this.r.camera.bounds();
    ctx.strokeStyle = 'rgba(46,58,75,.55)'; ctx.lineWidth = 2;
    ctx.strokeRect(px(cam.x0 / CELL), py(cam.y0 / CELL), (cam.x1 - cam.x0) / CELL * scale, (cam.y1 - cam.y0) / CELL * scale);
    ctx.fillStyle = '#FFC857'; ctx.strokeStyle = '#2E3A4B'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(px(g.robot.x), py(g.robot.y), Math.max(5, scale * 1.2), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Choisir un arrêt : les dépôts (ou gares) possibles sont entourés et numérotés.
    if (pick) {
      pick.candidates.forEach((m, i) => {
        const cx = px(m.x + m.w / 2), cy = py(m.y + m.h / 2), rad = Math.max(12, scale * 2.2);
        ctx.fillStyle = 'rgba(255,200,87,.35)'; ctx.strokeStyle = '#2E3A4B'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2E3A4B'; ctx.font = '900 12px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), cx, cy - rad - 9);
      });
    }
    canvas.onclick = (e) => {
      const r = canvas.getBoundingClientRect();
      const wx = x0 + (e.clientX - r.left) / scale, wy = y0 + (e.clientY - r.top) / scale;
      if (pick) {
        // Le plus proche des arrêts possibles (à quelques cases près).
        let best: Machine | null = null, bd = Infinity;
        for (const m of pick.candidates) {
          const d = Math.hypot(m.x + m.w / 2 - wx, m.y + m.h / 2 - wy);
          if (d < bd) { bd = d; best = m; }
        }
        if (best && bd * scale < Math.max(28, scale * 4)) { close(); pick.onPick(best); }
        else this.toast('Touche un des arrêts entourés', 'info');
        return;
      }
      this.r.follow = false;
      this.r.camera.x = wx * CELL; this.r.camera.y = wy * CELL;
      close();
    };
  }

  private drawMinimap(): void {
    const c = this.minimap, ctx = c.getContext('2d')!;
    const g = this.game, w = g.world;
    const R = 26, s = c.width / (R * 2);
    const ox = Math.floor(g.robot.x) - R, oy = Math.floor(g.robot.y) - R;
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = hex(PALETTE.fog);
    ctx.fillRect(0, 0, c.width, c.height);
    for (let j = 0; j < R * 2; j++) {
      for (let i = 0; i < R * 2; i++) {
        const x = ox + i, y = oy + j;
        if (!w.isRevealed(x, y)) continue;
        const p = w.patchAt(x, y);
        ctx.fillStyle = p ? hex(item(p.type).patch ?? 0xcccccc) : hex(BIOME_COLORS[w.biomeAt(x, y)]);
        ctx.fillRect(i * s, j * s, s + 0.5, s + 0.5);
      }
    }
    ctx.fillStyle = '#ffffff';
    for (const b of g.factory.belts.values()) {
      const i = b.x - ox, j = b.y - oy;
      if (i >= 0 && j >= 0 && i < R * 2 && j < R * 2) ctx.fillRect(i * s, j * s, s, s);
    }
    for (const m of g.factory.machines.values()) {
      const i = m.x - ox, j = m.y - oy;
      ctx.fillStyle = m.type === 'noyau' ? '#F47C64' : '#2E3A4B';
      ctx.fillRect(i * s, j * s, m.w * s, m.h * s);
    }
    ctx.fillStyle = '#FFC857';
    ctx.strokeStyle = '#2E3A4B';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(R * s, R * s, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  /** Appelé à chaque image. */
  update(dt: number): void {
    this.edgeScroll(dt);
    this.tips.setHidden(!!this.r.loupe || !!this.overlay || this.tree.isOpen || !!this.root.querySelector('.gift-card, .move-banner'));
    this.tips.update(dt);
    this.popTimer += dt;
    this.miniTimer += dt;
    if (this.popTimer > 0.3) {
      this.popTimer = 0;
      if (!this.popover.classList.contains('hidden')) { this.renderPopover(); this.positionPopover(); }
    }
    if (this.miniTimer > 0.5) {
      this.miniTimer = 0;
      this.drawMinimap();
      const light = this.game.daylight;
      const sig = light > 0.5 ? 'sun' : 'moon';
      if (sig !== this.daySig) {
        this.daySig = sig;
        this.dayIcon.innerHTML = sig === 'sun'
          ? '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.4" fill="#FFC857" stroke="#2E3A4B" stroke-width="1.4"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="#2E3A4B" stroke-width="1.4" stroke-linecap="round"/></svg>'
          : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.8 2.2a6 6 0 1 0 3 9.6A5 5 0 0 1 10.8 2.2Z" fill="#F4E7B8" stroke="#2E3A4B" stroke-width="1.4" stroke-linejoin="round"/></svg>';
        this.dayIcon.title = sig === 'sun' ? 'Jour' : 'Nuit';
      }
      // Le reste de la journée ou de la nuit, en couleur sur le bord de la pastille.
      this.dayIcon.style.background = light > 0.5 ? '#FFF6D6' : '#1F2A3D';
      // La nuit, le titre du palier (posé sur la carte) garde un fond blanc pour rester lisible.
      this.root.classList.toggle('is-night', light < 0.6 && !this.game.inAtelier);
      const w = this.game.weather;
      if (w !== this.weatherSig) {
        this.weatherSig = w;
        this.weatherIcon.classList.toggle('hidden', w === 'clair');
        this.weatherIcon.innerHTML = w === 'pluie'
          ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 10 H11.5 A2.8 2.8 0 0 0 11 4.5 A3.5 3.5 0 0 0 4.3 5.6 A2.2 2.2 0 0 0 4.5 10 Z" fill="#DCE6F0" stroke="#2E3A4B" stroke-width="1.3"/><path d="M6 12 L5.3 14 M9 12 L8.3 14 M12 12 L11.3 14" stroke="#4B8BD1" stroke-width="1.4" stroke-linecap="round"/></svg>'
          : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 V14 M2.8 5 L13.2 11 M2.8 11 L13.2 5" stroke="#4B8BD1" stroke-width="1.6" stroke-linecap="round"/></svg>';
        this.weatherIcon.title = w === 'pluie' ? 'Pluie : camions plus lents' : w === 'neige' ? 'Neige : solaire réduit' : '';
      }
    }
    // Inventaires en grand : la fabrication avance à chaque image, le reste chaque seconde.
    if (this.sheetKind && this.overlay) {
      this.overlay.querySelectorAll<HTMLElement>('.craft-job').forEach((row) => {
        const job = this.game.craftQueue[Number(row.dataset.i)];
        const bar = row.querySelector<HTMLElement>('.cj-bar > span');
        if (job && bar) bar.style.width = `${(job.t / job.total) * 100}%`;
      });
      this.liveTimer += dt;
      if (this.liveTimer > 1 && (this.sheetKind === 'robot' || this.sheetKind === 'sell' || this.sheetKind === 'machine' || this.sheetKind === 'line' || this.sheetKind === 'chest')) { this.liveTimer = 0; this.sheetDirty = true; }
    }
    this.refreshTimer += dt;
    if (this.refreshTimer > 0.8 && !this.pressing) {
      this.refreshTimer = 0;
      if (this.sheetDirty && this.overlay) { this.sheetDirty = false; this.refreshSheet(); }
      if (this.treeDirty && this.tree.isOpen) { this.treeDirty = false; this.tree.render(); }
    }
  }
}

declare global {
  const __VERSION__: string;
  const __DEV__: boolean;
}

/** Un nombre court, à la française (au plus un chiffre après la virgule). */
function fmtN(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace('.', ',');
}
