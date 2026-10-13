// Interface en HTML par-dessus le jeu, et logique des outils (tracer, poser, gommer, déplacer).
import { clock } from '../sim/freight.ts';
import { BIOME_COLORS, CELL, CHUNK, PALETTE, RULES } from '../config.ts';
import { FLUIDS, isFuel, item, itemLabel, ITEM_LIST, RAW_IDS } from '../data/items.ts';
import { BUILDABLE, MACHINES, machineDef, type MachineDef } from '../data/machines.ts';
import type { Gestures, GestureHandlers } from '../input/gestures.ts';
import type { GameRenderer } from '../render/renderer.ts';
import { Factory, ROCKET_NEEDS, stopRules, type Belt, type StopRule, type Line, type Machine } from '../sim/factory.ts';
import { Game, type GameEvent } from '../sim/game.ts';
import { nodeForMachine } from '../data/unlocks.ts';
import { RARITY_LABEL, type Order } from '../sim/orders.ts';
import { CableTracer } from '../sim/cables.ts';
import { ACHIEVEMENT_OF_SKIN, ACHIEVEMENTS, FAMILIES, fmtNum, ROMAN, UNIQUE_ACHIEVEMENTS } from '../data/achievements.ts';
import { RARITY_NAME, SKINS, skinOf, skinSvg } from '../data/skins.ts';
import { loadPlans, savePlans, type AtelierPlan } from '../save/plans.ts';
import { BeltTracer } from '../sim/tracer.ts';
import { DX, DY } from '../sim/geom.ts';
import { RICHNESS_LABEL } from '../world/world.ts';
import { ICONS } from './icons.ts';
import { TreeScreen, MYSTERY } from './tree.ts';
import { Tips } from './tips.ts';
import { checkForUpdate, copyText } from './update.ts';
import { exportPanel, playTime } from './title.ts';
import { ALL_NODES, type UnlockNode } from '../data/unlocks.ts';
import { palierMission } from '../data/paliers.ts';
import { NODE_ICONS, UNLOCK_ICON } from './nodeIcons.ts';
import { hexCss, nodeColor } from '../data/nodeColors.ts';
import { buildingSvgUrl } from '../render/buildingIcons.ts';
import { isStationType, rotDims, type Rot } from '../sim/stations.ts';
import { swipeToClose } from './swipe.ts';

type Tool = 'none' | 'tapis' | 'machine' | 'gomme' | 'zone' | 'module' | 'move' | 'cable' | 'tuyau' | 'transport';

/** 100 k, 1 M : les grands paliers en court. */
const shortNum = (n: number) => n >= 1e6 ? `${String(n / 1e6).replace('.', ',')} M` : n >= 1e4 ? `${String(n / 1e3).replace('.', ',')} k` : fmtNum(n);

const STATUS_TEXT: Record<string, string> = {
  idle: 'En attente',
  working: 'En marche',
  blocked: 'Sortie pleine : branche un tapis ou vide la suite',
  nofuel: 'Plus de charbon : apporte-lui du charbon par tapis',
  noinput: 'Il manque un ingrédient',
  noore: 'Pas de filon dessous',
  nopower: 'Pas de courant : il faut un câble à 5 cases au plus, relié à un générateur qui a du charbon',
  nowater: 'Pas d’eau : relie-le par un tuyau à une pompe posée sur un lac',
};

/** L'état d'une machine en deux ou trois mots, pour la pastille. */
const STATUS_SHORT: Record<string, string> = {
  idle: 'En attente', working: 'En marche', blocked: 'Sortie pleine', nofuel: 'Plus de charbon',
  noinput: 'Manque un ingrédient', noore: 'Pas de filon', nopower: 'Pas de courant', nowater: 'Pas d’eau',
};

/** La flèche entre ce qui entre et ce qui sort. */
const MP_ARROW = '<svg class="mp-arrow" width="24" height="24" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13 H22 M16 7 L22 13 L16 19"/></svg>';

/** Une durée lisible : « 1,6 s », « 10 s », « 1 min 04 ». */
function secs(t: number): string {
  if (!isFinite(t) || t <= 0) return '0 s';
  if (t < 60) return `${t < 10 && Math.abs(t - Math.round(t)) > 0.05 ? t.toFixed(1).replace('.', ',') : Math.round(t)} s`;
  const m = Math.floor(t / 60), s = Math.round(t % 60);
  return s ? `${m} min ${String(s).padStart(2, '0')}` : `${m} min`;
}


const GIFT_TEXT: Record<string, { title: string; lines: string[]; open: string }> = {
  comptoir: {
    title: 'Le Comptoir',
    lines: [
      'Il propose des commandes au choix. Apporte-lui les objets demandés par un tapis.',
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

/** Une ligne d'une grande liste de choix. */
interface PickOpt { id: string | null; label: string; sub?: string; icon?: string; badge?: string; on?: boolean; group?: string; danger?: boolean }

/** Petit entonnoir : un séparateur qui trie. */
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/></svg>';
/** Le menu du tapis : séparateur, filtre, ascenseur. */
const BI = (p: string) => `<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const BELT_ICONS = {
  sep: BI('<rect x="7" y="7" width="8" height="8" rx="2"/><path d="M2 11 H7 M15 11 H20 M11 2 V7 M11 15 V20"/>'),
  tri: BI('<rect x="6" y="6" width="10" height="10" rx="2"/><path d="M8.5 9 H13.5 M9.5 11 H12.5 M10.5 13 H11.5"/><path d="M1 11 H6 M16 11 H21"/>'),
  lift: BI('<rect x="5" y="5" width="12" height="12" rx="2.5"/><path d="M11 14 V8 M8.5 10.5 L11 8 L13.5 10.5"/><circle cx="5" cy="5" r="1.2" fill="currentColor"/><circle cx="17" cy="5" r="1.2" fill="currentColor"/><circle cx="5" cy="17" r="1.2" fill="currentColor"/><circle cx="17" cy="17" r="1.2" fill="currentColor"/>'),
};
const FUNNEL = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M1 1.5 H9 L6 5.2 V8.5 L4 9.2 V5.2 Z"/></svg>';
const CHECK_SM = '<svg class="plan-check" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#2E6B51" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5 L6.5 12 L13 4.5"/></svg>';
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
  /** Le jeu se met en pause : on sauvegarde. */
  onPause(): void;
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
  private freightPill!: HTMLElement;
  private freightT = 0;
  private minimap!: HTMLCanvasElement;
  private dayIcon!: HTMLElement;
  private weatherIcon!: HTMLElement;
  private weatherSig = '';
  private daySig = '';
  private palette!: HTMLElement;
  private toolButtons = new Map<string, HTMLButtonElement>();
  /** Options de l'outil en cours (Câble / Tuyau, Gomme / Zone). */
  private toolOpts!: HTMLElement;
  /**
   * Le bouton d'étage (en bas à gauche) : « Étage 2 » (on voit les deux étages) ou « Étage 1 seul » (le haut pâlit).
   * Pendant un tracé, il fait passer le tapis à l'autre étage (un ascenseur là où il change).
   */
  private upperFaded = false;
  /** Outil Tapis : l'étage où se posent les tapis (1 en le prenant ; 2 si on touche 2, avant ou pendant le tracé). */
  private beltLevel: 0 | 1 = 0;
  /** Le haut est-il pâli en ce moment (vue choisie, ou étage de l'outil Tapis) ? */
  private fadedNow = false;
  private levelBtn!: HTMLElement;
  /** Pendant qu'on glisse un séparateur ou un filtre depuis la palette : l'étage où il se posera. */
  private placeLevel: 0 | 1 = 0;
  private draggingBox = false;
  /** Fenêtre d'une boîte : le côté choisi (0–3, 4 : l'autre étage). */
  private nodeSel: number | null = null;
  /** Où le doigt s'est posé avec un outil (pour reconnaître un simple toucher). */
  private downAt: { x: number; y: number; moved: boolean } | null = null;
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
    for (const id of ['noyau', 'laboratoire', 'comptoir']) if (!this.machineIcons.has(id)) this.machineIcons.set(id, renderer.machineIconDataUrl(id));
    this.build();
    this.tips = new Tips(this.root, game);
    game.on((e) => this.onEvent(e));
    // Au clavier : R tourne la gare (ou le dépôt) qu'on pose ou qu'on déplace.
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'r' || e.key === 'R') && !(e.target instanceof HTMLInputElement) && this.r.preview?.kind === 'place' && isStationType(this.r.preview.type)) this.rotatePlacement();
    });
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
    // Pause, à côté de l'argent.
    const pause = h('button', 'round pause-btn', PAUSE_ICON);
    pause.setAttribute('aria-label', 'Pause');
    pause.onclick = () => this.setPaused(true);
    right.append(this.money, pause, menu);
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
    this.freightPill = h('button', 'freight-pill hidden');
    this.freightPill.onclick = () => this.openFreight();

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
      b.onclick = () => this.pickTool(id, id === 'cable' ? !this.game.isUnlocked('generateur') && !this.game.isUnlocked('pompe') : id === 'transport' ? !this.game.isUnlocked('camion') : id === 'module' ? !this.game.isUnlocked('module') : locked);
      this.toolButtons.set(id, b);
      toolbar.append(b);
    }

    this.toolOpts = h('div', 'tool-opts hidden');
    // Le bouton d'étage : se touche aussi pendant un tracé (avec un autre doigt).
    // 1 : seulement le 1ᵉʳ étage (le haut pâlit) ; 2 : les deux étages (par défaut). Pendant un tracé : l'étage du tapis.
    this.levelBtn = h('div', 'level-switch hidden',
      `<span class="ls-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 3 21 8l-9 5-9-5z"/><path d="m3 12.5 9 5 9-5" opacity=".55"/><path d="m3 17 9 5 9-5" opacity=".3"/></svg></span><button data-l="0" aria-label="1ᵉʳ étage seul">1</button><button data-l="1" aria-label="Les deux étages">2</button>`);
    this.levelBtn.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.pressLevel(b.dataset.l === '1' ? 1 : 0); });
    });
    this.bubble = h('div', 'bubble hidden');
    this.popover = h('div', 'popover hidden');
    this.toasts = h('div', 'toasts');
    this.root.append(top, row, this.freightPill, this.palette, this.toolOpts, this.levelBtn, toolbar, this.bubble, this.popover, this.toasts);
    window.addEventListener('resize', () => this.placeLevelSwitch());
    this.updateLevelBtn();
    this.tree = new TreeScreen(this.root, this.game, this.itemIcons, () => { this.renderPalette(); this.refreshLevel(); this.renderToolOpts(); });
    // On ne reconstruit pas une feuille pendant qu'un doigt appuie dessus (le bouton serait perdu).
    const press = (on: boolean) => () => { this.pressing = on; };
    this.root.addEventListener('pointerdown', press(true), true);
    window.addEventListener('pointerup', press(false), true);
    window.addEventListener('pointercancel', press(false), true);
  }

  /** Ouvre l'arbre de déblocages. */
  openTree(tab?: string, select?: string): void {
    // L'arbre ne s'ouvre qu'une fois le Laboratoire posé (c'est lui qui reçoit les objets des déblocages).
    if (!this.game.hasLab()) {
      this.toast('Pose d’abord le Laboratoire : l’arbre des déblocages s’ouvre avec lui', 'info');
      return;
    }
    this.closePopover();
    this.closeSheet();
    this.setTool('none');
    this.tree.open(tab, select);
  }

  /** Tuiles des nœuds de l'arbre (pour les feuilles du Noyau et du passage de palier). */
  private nodeTiles(nodes: UnlockNode[]): string {
    if (!nodes.length) return '';
    // Comme dans l'arbre : ce qu'on ne peut pas encore débloquer reste caché.
    return `<div class="lv-ready">${nodes.map((x) => {
      const st = this.game.nodeState(x);
      const hide = st === 'locked' || st === 'soon';
      return `<div><span class="lv-tile${hide ? ' mystery' : ''}">${hide ? MYSTERY : NODE_ICONS[x.icon] ?? ''}</span><small>${hide ? '???' : esc(x.name)}</small></div>`;
    }).join('')}</div>`;
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
    this.refreshFreight();
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
      case 'freight': this.refreshFreight(); if (this.sheetKind === 'freight') this.sheetDirty = true; break;
      case 'gift': this.onGift(e.building, e.id, !!e.again); break;
      case 'factory': if (this.tool === 'machine') this.renderPalette(); this.updateLevelBtn(); break;
      case 'orderDone': this.celebrate(e.order); break;
      case 'toast': this.toast(e.text, e.tone); break;
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
      const open = id === 'cable' ? this.game.isUnlocked('generateur') || this.game.isUnlocked('pompe') : this.game.isUnlocked(node);
      const locked = !open || (inside && (id !== 'module' || !this.game.nesting));
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
    if (m.kind === 'box' || m.kind === 'lift') return 'tapis';
    if (m.id === 'depot' || m.id === 'gare') return 'transport';
    if (m.kind === 'atelier' || m.kind === 'port_in' || m.kind === 'port_out') return 'modules';
    if (m.kind === 'drill') return 'extraction';
    if (m.kind === 'generator' || m.kind === 'solar' || m.kind === 'battery' || m.kind === 'pump' || m.kind === 'reactor') return 'electricite';
    if (m.kind === 'crafter') return 'fabrication';
    if (m.kind === 'storage') return 'stockage';
    return 'outils';
  }

  private paletteTab = '';
  /** La catégorie affichée au dernier dessin de la palette. */
  private shownTab = '';

  private renderPalette(): void {
    const p = this.palette;
    // On garde la position des catégories (et des cartes, si on reste dans la même catégorie).
    const catScroll = p.querySelector<HTMLElement>('.pal-cats')?.scrollLeft ?? 0;
    const rowScroll = p.querySelector<HTMLElement>('.pal-row')?.scrollLeft ?? 0;
    p.innerHTML = '';
    const placed = new Set([...this.game.view.machines.values()].map((x) => x.type));
    if (this.machineType && machineDef(this.machineType).unique && placed.has(this.machineType)) this.machineType = 'foreuse';
    const inside = !!this.game.inAtelier;
    const OUTSIDE_ONLY = ['generateur', 'depot', 'gare', 'foreuse', 'solaire', 'batterie', 'pompe', 'centrale', 'rampe', 'arbre', 'base_robot'];
    const list = BUILDABLE.filter((m) => this.game.hasMachine(m.id) && !m.gift && !(m.unique && placed.has(m.id))
      // Dans un atelier : ni foreuse, ni station, ni générateur, ni dépôt ; les entrées et sorties, seulement là.
      && (inside ? !OUTSIDE_ONLY.includes(m.id) && (m.id !== 'atelier' || this.game.nesting) : m.kind !== 'port_in' && m.kind !== 'port_out'));
    if (this.machineType && !list.some((m) => m.id === this.machineType)) this.machineType = list[0]?.id ?? null;
    // À partir de 10 machines, un sous-menu : des catégories, puis les machines de la catégorie choisie.
    const CATS: [string, string][] = [['modules', 'Modules'], ['tapis', 'Tapis'], ['extraction', 'Extraction'], ['fabrication', 'Fabrication'], ['electricite', 'Électricité'], ['stockage', 'Stockage'], ['transport', 'Transport'], ['outils', 'Outils']];
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
    const more = h('button', 'mcard more', `<span style="width:40px;height:40px;display:flex">${UNLOCK_ICON}</span>Débloquer<small>${ready ? `${ready} prêt${ready > 1 ? 's' : ''}` : `Palier ${this.game.palier}`}</small>`);
    more.onclick = () => this.openTree('production');
    row.append(more);
    p.append(row);
    const cats = p.querySelector<HTMLElement>('.pal-cats');
    if (cats) cats.scrollLeft = catScroll;
    if (this.paletteTab === this.shownTab) row.scrollLeft = rowScroll;
    this.shownTab = this.paletteTab;
    this.updateLevelBtn();
  }

  // ---------- Glisser une machine depuis la palette ----------

  private dragEnded = false;
  /** Sens choisi pour poser (ou déplacer) une gare ou un dépôt : quarts de tour. */
  private placeRot: Rot = 0;
  /** Dernière position du doigt pendant une pose (pour redessiner après un quart de tour). */
  private lastPlaceAt: { x: number; y: number } | null = null;

  /** Glisser une carte vers le haut : la machine suit le doigt, la lâcher sur la carte la pose. */
  private cardDown(e: PointerEvent, type: string, card: HTMLElement): void {
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    // Pendant le glisser, la palette et la barre d'outils s'effacent : à leur place, une petite corbeille rouge
    // (y lâcher la machine annule).
    let trash: HTMLElement | null = null;
    let rot: HTMLElement | null = null;
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
          // Séparateur ou filtre : l'interrupteur d'étage apparaît pour choisir où le poser.
          this.draggingBox = machineDef(type).kind === 'box';
          this.placeLevel = 0;
          this.updateLevelBtn();
          trash = h('div', 'drop-trash', `${ICONS.trash}<span>Lâche ici pour annuler</span>`);
          this.root.append(trash);
          // Gare ou dépôt : un bouton pour tourner (avec un autre doigt pendant qu'on glisse).
          if (isStationType(type)) {
            rot = h('button', 'drop-rotate', `${ICONS.rotate}<span>Tourner</span>`);
            rot.addEventListener('pointerdown', (pe) => { pe.preventDefault(); pe.stopPropagation(); this.rotatePlacement(); }, true);
            this.root.append(rot);
          }
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
      const boxZ = this.placeLevel;
      this.draggingBox = false;
      this.updateLevelBtn();
      const cancel = overTrash(ev);
      trash?.remove();
      rot?.remove();
      this.dragEnded = true;
      setTimeout(() => { this.dragEnded = false; }, 350);
      const pv = this.r.preview;
      if (ev.type === 'pointerup' && pv?.kind === 'place' && pv.ok && !cancel) {
        const kind = machineDef(type).kind;
        if (this.placingPlan) this.game.placePlan(this.placingPlan.save, this.placingPlan.size, pv.x, pv.y);
        else if (kind === 'box' || kind === 'lift') this.game.placeBox(type, pv.x, pv.y, boxZ);
        else this.game.placeMachine(type, pv.x, pv.y, (pv.rot ?? 0) as Rot);
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
        cable: 'Câbles et tuyaux : débloque la Pompe à eau ou le Générateur dans l’arbre (Énergie)',
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
    const same = this.tool === t || (t === 'gomme' && this.tool === 'zone') || (t === 'cable' && this.tool === 'tuyau');
    // Seulement la pompe débloquée : le bouton Câble ouvre directement les tuyaux.
    this.setTool(same ? 'none' : t === 'cable' && !this.game.isUnlocked('generateur') ? 'tuyau' : t);
  }

  /** Le bouton d'étage : pendant un tracé, l'étage du tapis ; sinon, 1 pâlit l'étage 2, 2 montre les deux. */
  private pressLevel(l: 0 | 1): void {
    if (this.draggingBox) {
      this.placeLevel = l;
      this.updateLevelBtn();
      if (this.lastPlaceAt) this.updatePlacement(this.lastPlaceAt.x, this.lastPlaceAt.y);
      return;
    }
    if (this.tracer || this.tool === 'tapis') {
      if (l && !this.game.levels2) { this.toast('2ᵉ étage : débloque « Séparateur, filtre et ascenseur » dans l’arbre (Logistique)', 'info'); return; }
      this.beltLevel = l;
      if (this.tracer) {
        this.tracer.setLevel(l);
        if (this.dragAt) this.toolMove(this.dragAt.x, this.dragAt.y);
      }
      this.updateLevelBtn();
      return;
    }
    const faded = l === 0;
    if (faded === this.upperFaded) return;
    this.upperFaded = faded;
    this.r.setUpperFaded(faded);
    this.toast(faded ? '1ᵉʳ étage seul : le haut pâlit, tu touches ce qui passe dessous' : 'Les deux étages', 'info');
    this.updateLevelBtn();
  }

  /** L'interrupteur d'étage se pose juste au-dessus de ce qui est ouvert en bas (barre, options, palette, corbeille). */
  private placeLevelSwitch(): void {
    requestAnimationFrame(() => {
      const b = this.levelBtn;
      if (b.classList.contains('hidden')) return;
      const dragging = this.root.classList.contains('dragging-machine');
      const els: (Element | null)[] = [this.root.querySelector('.drop-trash'), this.root.querySelector('.move-banner')];
      if (!dragging) els.push(this.root.querySelector('.toolbar'), this.palette, this.toolOpts);
      let top = window.innerHeight;
      for (const el of els) {
        if (!el || el.classList.contains('hidden')) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0) top = Math.min(top, r.top);
      }
      b.style.bottom = `${Math.max(10, window.innerHeight - top + 10)}px`;
    });
  }

  /** Le bouton d'étage : l'étage montré (ou celui du tracé, ou celui où se posera la boîte qu'on glisse). */
  private updateLevelBtn(): void {
    const b = this.levelBtn;
    if (!b) return;
    // Seulement une fois débloqué (ou s'il y a déjà un tapis en hauteur) ; dans le menu des machines, seulement
    // pendant qu'on glisse un séparateur ou un filtre.
    const open = this.game.levels2 || [...this.game.view.belts.values()].some((x) => x.z);
    if (!open && this.upperFaded) { this.upperFaded = false; this.r.setUpperFaded(false); }
    const show = open && (this.tool !== 'machine' || this.draggingBox);
    b.classList.toggle('hidden', !show);
    const t = this.tracer;
    const building = !!t || this.draggingBox || this.tool === 'tapis';
    const l = this.draggingBox ? this.placeLevel : t ? t.level : this.tool === 'tapis' ? this.beltLevel : this.upperFaded ? 0 : 1;
    // Pendant un tracé (ou le glisser d'une boîte), la vue suit l'étage où l'on pose : au 1ᵉʳ, le haut pâlit.
    // Ensuite, elle revient à ce qu'on avait choisi.
    this.fadedNow = open && (building ? l === 0 : this.upperFaded);
    this.r.setUpperFaded(this.fadedNow);
    if (!show) return;
    this.placeLevelSwitch();
    b.querySelectorAll<HTMLButtonElement>('button').forEach((x) => x.classList.toggle('on', x.dataset.l === String(l)));
    b.classList.toggle('up', !!t && l === 1);
  }

  /** Les options d'un outil, au-dessus de la barre : Câble / Tuyau, Gomme / Zone. */
  private renderToolOpts(): void {
    const box = this.toolOpts;
    box.innerHTML = '';
    const g = this.game;
    let opts: { label: string; icon: string; on: boolean; locked: boolean; pick: () => void; why: string }[] = [];
    if (this.tool === 'cable' || this.tool === 'tuyau') {
      opts = [
        { label: 'Câble', icon: ICONS.cable, on: this.tool === 'cable', locked: !g.isUnlocked('generateur'), pick: () => this.setTool('cable'), why: 'Câbles : débloque le Générateur (Énergie, palier 4)' },
        { label: 'Tuyau', icon: ICONS.pipe, on: this.tool === 'tuyau', locked: !g.isUnlocked('pompe'), pick: () => this.setTool('tuyau'), why: 'Tuyaux : débloque la Pompe à eau (Énergie, palier 3)' },
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
    this.updateLevelBtn();
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
    this.placeRot = (m.rot ?? 0) as Rot;
    this.lastPlaceAt = null;
    const banner = h('div', 'move-banner');
    const station = isStationType(m.type);
    banner.innerHTML = `<span class="mb-ico">${ICONS.move}</span><div><b>Déplacer : ${esc(def.name)}</b><small>${station ? this.rotHint() : 'Pose le doigt sur la carte et glisse-la à sa nouvelle place'}</small></div>`;
    if (station) {
      const turn = h('button', 'btn', `${ICONS.rotate}`);
      turn.setAttribute('aria-label', 'Tourner');
      turn.onclick = () => this.rotatePlacement();
      banner.append(turn);
    }
    const cancel = h('button', 'btn', 'Annuler');
    cancel.onclick = () => this.setTool('none');
    banner.append(cancel);
    this.root.append(banner);
  }

  private setTool(t: Tool): void {
    this.clearZone();
    // En prenant l'outil Tapis, on pose au 1ᵉʳ étage (2 se choisit sur l'interrupteur).
    if (t === 'tapis' && this.tool !== 'tapis') this.beltLevel = 0;
    if (t !== 'move') this.copying = null;
    if (t !== 'move') {
      this.r.movingId = null;
      this.root.querySelector('.move-banner')?.remove();
    }
    this.tool = t;
    // Câble : mode électricité, on voit les câbles sous les blocs et les machines alimentées.
    this.r.electric = t === 'cable';
    this.r.waterView = t === 'tuyau';
    // Hors du mode câble, les câbles sont cachés (sauf avec la gomme, pour voir ce qu'on efface).
    this.r.showCables = t === 'gomme' || t === 'zone';
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', id === t || (id === 'gomme' && t === 'zone') || (id === 'cable' && t === 'tuyau'));
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
    if (!this.game.inAtelier && Math.hypot(w.x - rb.x, w.y - (rb.y - 0.85)) < 1.05) { this.openRobot(); return; }
    if (m?.type === 'noyau') { this.closePopover(); this.openNoyau(); return; }
    if (m?.type === 'quai') { this.closePopover(); this.openFreight(); return; }
    if (m?.built && m.type === 'comptoir') { this.closePopover(); this.openOrders(); return; }
    if (m?.built && m.type === 'laboratoire') { this.closePopover(); this.openLab(); return; }
    const sheet = m ? this.sheetOf(m) : null;
    if (sheet) { sheet(); return; }
    if (m) { this.select({ kind: 'machine', id: m.id }); return; }
    // Un tapis en hauteur d'abord ; toucher encore la même case sélectionne celui du dessous.
    // Avec « Étage 1 seul », seulement ceux du dessous.
    const prev = this.r.selection;
    const again = prev?.kind === 'belt' && prev.x === cx && prev.y === cy && prev.z === 1;
    const b = this.fadedNow ? f.beltAt(cx, cy) : (!again && f.beltAt(cx, cy, 1)) || f.beltAt(cx, cy) || f.beltAt(cx, cy, 1);
    if (b?.node && !f.nodeIsLink(b)) { this.closePopover(); this.openNodeSheet(b); return; }
    if (b) { this.select({ kind: 'belt', x: cx, y: cy, ...(b.z ? { z: 1 as const } : {}) }); return; }
    if (!this.popover.classList.contains('hidden')) { this.closePopover(); return; }
    if (this.game.inAtelier) return;
    this.game.sendRobot(w.x, w.y);
  }

  /** La grande fenêtre d'un bâtiment construit, s'il en a une (sinon, la petite bulle). */
  private sheetOf(m: Machine): (() => void) | null {
    if (!m.built) return null;
    const kind = machineDef(m.type).kind;
    if (kind === 'storage') return () => this.openChest(m);
    if (['crafter', 'drill', 'generator', 'atelier', 'solar', 'battery', 'pump', 'reactor', 'rocket'].includes(kind)) return () => this.openMachine(m);
    return null;
  }

  /** Position de pose d'une machine : un peu au-dessus du doigt, pour la voir. */
  private placeAt(sx: number, sy: number, type: string): { x: number; y: number } {
    const def = machineDef(type);
    const size = rotDims(def.w, def.h, isStationType(type) ? this.placeRot : 0);
    const w = this.worldAt(sx, sy - 64);
    return { x: Math.round(w.x - size.w / 2), y: Math.round(w.y - size.h / 2) };
  }

  /** Un quart de tour pour la gare (ou le dépôt) qu'on pose ou qu'on déplace. */
  private rotatePlacement(): void {
    this.placeRot = ((this.placeRot + 1) % 4) as Rot;
    if (this.lastPlaceAt) this.updatePlacement(this.lastPlaceAt.x, this.lastPlaceAt.y);
    this.root.querySelector('.move-banner small')?.replaceChildren(document.createTextNode(this.rotHint()));
  }

  private rotHint(): string {
    return `Quai ${['en bas', 'à gauche', 'en haut', 'à droite'][this.placeRot]} · glisse-la à sa place, ou tourne-la`;
  }

  private updatePlacement(sx: number, sy: number): void {
    const type = this.tool === 'move' ? this.moving!.type : this.machineType!;
    this.lastPlaceAt = { x: sx, y: sy };
    const p = this.placeAt(sx, sy, type);
    const def = machineDef(type);
    const rot = isStationType(type) ? this.placeRot : 0;
    const size = rotDims(def.w, def.h, rot);
    const check = this.game.view.checkMachine(type, p.x, p.y, this.copying ? undefined : this.moving ?? undefined, true, rot, this.draggingBox ? this.placeLevel : 0);
    this.r.preview = { kind: 'place', type, x: p.x, y: p.y, ok: check.ok, ore: check.ore, rot };
    // Guides d'alignement avec les machines voisines.
    const cx = (p.x + size.w / 2) * CELL, cy = (p.y + size.h / 2) * CELL;
    const guides: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const m of this.game.view.machines.values()) {
      if (m === this.moving) continue;
      const mx = (m.x + m.w / 2) * CELL, my = (m.y + m.h / 2) * CELL;
      if (Math.abs(mx - cx) < 1 && Math.abs(my - cy) < CELL * 14) guides.push({ x0: cx, y0: cy, x1: mx, y1: my });
      else if (Math.abs(my - cy) < 1 && Math.abs(mx - cx) < CELL * 14) guides.push({ x0: cx, y0: cy, x1: mx, y1: my });
    }
    this.r.guides = guides;
    const s = this.r.camera.worldToScreen(cx, p.y * CELL);
    const onBelt = (check.ok && check.belts ? ' · sur le tapis' : '') + (this.draggingBox && this.placeLevel ? ' · 2ᵉ étage' : '');
    // Une foreuse sur un filon : ce qu'elle va extraire, en direct.
    if (def.kind === 'drill' && check.ok && check.ore) {
      const rate = (check.rate ?? 0).toFixed(2).replace('.', ',');
      const tail = this.tool === 'move' ? 'déplacer ici' : `${ICONS.coinSm}${def.cost}`;
      const join = '';
      this.showBubble(s.x, s.y - 8, `<span class="rate"><img src="${this.itemIcons.get(check.ore)}" alt=""><b>${rate} / s</b></span> ${esc(item(check.ore).name.toLowerCase())}${join} · ${tail}${onBelt}`, false);
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
    return this.tool === 'tapis' || this.tool === 'cable' || this.tool === 'tuyau' || ((this.tool === 'zone' || this.tool === 'module') && !!this.zone && !this.root.querySelector('.zone-banner')) || this.tool === 'move' || (this.tool === 'machine' && this.palette.classList.contains('dragging'));
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
    this.downAt = { x: sx, y: sy, moved: false };
    if (this.tool === 'tapis' || this.tool === 'gomme' || this.tool === 'cable' || this.tool === 'tuyau') this.updateLoupe(sx, sy);
    const w = this.worldAt(sx, sy);
    if (this.tool === 'cable' || this.tool === 'tuyau') {
      this.cableTracer = new CableTracer(this.game.world, w.x, w.y);
      this.r.preview = { kind: this.tool === 'tuyau' ? 'pipe' : 'cable', tracer: this.cableTracer };
    } else if (this.tool === 'tapis') {
      // À l'étage choisi sur l'interrupteur (le bout d'un tapis existant garde le sien).
      this.tracer = new BeltTracer(this.game.view, w.x, w.y, this.game.levels2 ? this.beltLevel : 0);
      this.tracer.bridges = this.game.isUnlocked('pont');
      this.updateLevelBtn();
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
    if (this.downAt && Math.hypot(sx - this.downAt.x, sy - this.downAt.y) > 12) this.downAt.moved = true;
    this.dragAt = { x: sx, y: sy };
    const w = this.worldAt(sx, sy);
    if (this.tool === 'tapis' || this.tool === 'gomme' || this.tool === 'cable' || this.tool === 'tuyau') this.updateLoupe(sx, sy);
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
      const price = n * RULES.beltCost + nb * RULES.bridgeCost + (this.tracer.splitFrom && !this.tracer.splitFrom.node ? RULES.nodeCost : 0);
      const ok = this.tracer.valid && !this.tracer.blocked;
      const affordable = this.game.money >= price;
      const lifts = this.tracer.liftCount;
      const what = (this.tracer.splitFrom ? 'Séparateur · ' : '') + (nb ? `${nb > 1 ? `${nb} ponts` : 'Pont'} · ` : '')
        + (lifts ? `${lifts > 1 ? `${lifts} ascenseurs` : 'Ascenseur'} · ` : '') + (this.tracer.cells.some((c) => c.z) ? 'En hauteur · ' : '');
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
    // Outil Tapis, un simple toucher sur une boîte : sa fenêtre.
    const down = this.downAt;
    this.downAt = null;
    if (!cancelled && this.tool === 'tapis' && down && !down.moved) {
      const w = this.worldAt(down.x, down.y);
      const cx = Math.floor(w.x), cy = Math.floor(w.y), f = this.game.view;
      const tb = this.fadedNow ? f.beltAt(cx, cy) : f.beltAt(cx, cy, 1) ?? f.beltAt(cx, cy);
      if (tb?.node && !f.nodeIsLink(tb)) {
        this.tracer = null;
        this.updateLevelBtn();
        this.r.preview = null;
        this.r.loupe = null;
        this.openNodeSheet(tb);
        return;
      }
    }
    if (!cancelled) {
      if (this.tool === 'cable' && this.cableTracer) {
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
        this.game.placeMachine(this.machineType, pv.x, pv.y, (pv.rot ?? 0) as Rot);
      } else if (this.tool === 'move' && pv?.kind === 'place' && this.moving && this.copying) {
        if (this.game.copyAtelier(this.copying, pv.x, pv.y)) this.setTool('none');
      } else if (this.tool === 'move' && pv?.kind === 'place' && this.moving) {
        this.game.moveMachine(this.moving, pv.x, pv.y, (pv.rot ?? 0) as Rot);
        this.setTool('none');
      }
    }
    this.tracer = null;
    this.updateLevelBtn();
    this.cableTracer = null;
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
      if (m && (!machineDef(m.type).buildable || machineDef(m.type).gift)) continue;
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
      // Choisi pendant le chantier, puis construit : il a maintenant sa grande fenêtre, l'ancienne bulle s'en va.
      if (this.sheetOf(m)) { this.closePopover(); return; }
      const def = machineDef(m.type);
      let title = def.name, text = '';
      if (!m.built) {
        text = 'En construction.';
      } else if (def.kind === 'drill') {
        const patch = this.game.world.patchAt(m.x, m.y) ?? this.game.world.patchAt(m.x + 1, m.y + 1);
        title = `Foreuse · ${m.ore ? item(m.ore).name.toLowerCase() : '?'}`;
        text = `${STATUS_TEXT[m.status]}. Filon ${patch ? RICHNESS_LABEL[patch.richness] : ''} : ${this.game.view.drillRate(m).toFixed(2).replace('.', ',')} par seconde.`;
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
        ${inChips ? `<p>${this.game.view.isStop(m) ? 'Départs' : def.kind === 'storage' ? 'Contenu' : 'En attente'}</p><div class="chips">${inChips}</div>` : ''}
        ${outChips ? `<p>${this.game.view.isStop(m) ? 'Arrivées' : 'Prêt à sortir'}</p><div class="chips">${outChips}</div>` : ''}`;
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
      const b = f.beltAt(sel.x, sel.y, sel.z ?? 0);
      if (!b) { this.closePopover(); return; }
      const chain = f.chainOf(b);
      const items = chain.reduce((s, c) => s + c.items.length, 0);
      const pending = chain.some((c) => !c.built);
      // Un compteur sur la chaîne : son débit, matière par matière.
      const mb = chain.find((c) => c.meter);
      let meter = '';
      if (mb) {
        const r = f.meterRates(mb);
        const parts = Object.entries(r.by).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${esc(item(k).name.toLowerCase())} ${fmtN(v)}`);
        meter = `<p><b>Compteur : ${fmtN(r.total)} objet${r.total >= 2 ? 's' : ''} par seconde</b>${parts.length ? ` (${parts.join(', ')})` : ''}, sur les 20 dernières secondes. La gomme le retire avant le tapis.</p>`;
      }
      const lmin = Math.min(...chain.map((c) => c.lvl ?? 1)), lmax = Math.max(...chain.map((c) => c.lvl ?? 1));
      const bup = this.game.beltUpgrade(b);
      const lvText = `<p class="lv-line"><span class="lv-dot l${lmin}"></span><b>Niveau ${lmin}${lmax > lmin ? ` à ${lmax}` : ''}</b> · ${fmtN(RULES.beltSpeed * RULES.beltLevelSpeed[lmin - 1])} case${lmin > 1 ? 's' : ''} par seconde</p>`;
      const info = `<h3>${b.z ? 'Tapis en hauteur' : 'Tapis'} · ${chain.length} case${chain.length > 1 ? 's' : ''}</h3>${lvText}${meter}
        <p>${pending ? 'En construction.' : items ? `${items} objet${items > 1 ? 's' : ''} en route.` : 'Vide pour l’instant.'} Pour en effacer une partie, prends la gomme.</p><p class="refund">Supprimer rend ${chain.reduce((a, c) => a + RULES.beltCost + Game.levelValue(RULES.beltLevelCost, c.lvl), 0)} ${ICONS.coinSm}</p>`;
      const feeders = (b.feeds ?? []).map((d) => f.machineAt(b.x + DX[d], b.y + DY[d])).filter((m): m is Machine => !!m);
      // Les machines que ce tapis nourrit par le côté (une liaison : un séparateur sans boîte).
      const fed = b.node ? f.nodeOutputs(b).flatMap((o) => (o.d < 4 && o.d !== b.dir && o.next?.kind === 'machine' ? [o.next.machine] : [])) : [];
      const linked = feeders.length > 0 || fed.length > 0;
      const fedText = fed.length
        ? `<p>Ce tapis nourrit ${fed.map((x) => esc(machineDef(x.type).name.toLowerCase())).join(' et ')} par le côté, et continue tout droit : chacun son tour.${fed.length < 3 ? ' Il peut aussi nourrir une machine collée de l’autre côté : pars de cette case vers elle.' : ''}</p>` : '';
      const linkInfo = `${feeders.map((m) => `<p>${esc(machineDef(m.type).name)} y dépose sa production par le côté.</p>`).join('')}${fedText}`;
      const sortBtn = fed.length && this.game.isUnlocked('separateur') ? `<div class="row"><button class="btn" data-act="sort">${FUNNEL}Régler comme un filtre</button></div>` : '';
      const upBtn = !bup ? '' : bup.locked
        ? `<div class="row"><button class="btn" data-act="lvl">${ICONS.lock}Tapis niveau ${bup.to} : à débloquer (Niveaux)</button></div>`
        : `<div class="row"><button class="btn primary" data-act="lvl"${this.game.money < bup.price ? ' disabled' : ''}>Niveau ${bup.to} · ${bup.cells.length} case${bup.cells.length > 1 ? 's' : ''} · ${ICONS.coinSm}${fmt(bup.price)}</button></div>`;
      const emptyBtn = items ? `<div class="row"><button class="btn" data-act="empty">${ICONS.gomme}Vider le tapis</button></div>` : '';
      // Une machine de chaque côté (le tapis entre les deux) : un pont direct de l'une à l'autre, par-dessus.
      const mbr = this.game.machineBridges(b);
      const bridgeKey = mbr.map((o) => `${o.from.id}>${o.to.id}${o.from.links?.includes(o.to.id) ? '+' : ''}`).join(',');
      const bridgeBtns = mbr.map((o, i) => {
        const on = !!o.from.links?.includes(o.to.id);
        return `<div class="row"><button class="btn" data-bridge="${i}">${on ? 'Retirer le pont ' : 'Pont '}${esc(machineDef(o.from.type).name.toLowerCase())} → ${esc(machineDef(o.to.type).name.toLowerCase())}</button></div>`;
      }).join('');
      const actions = `${upBtn}${sortBtn}${bridgeBtns}${emptyBtn}${linked ? `<div class="row"><button class="btn" data-act="unlink">Couper la liaison</button></div>` : ''}<div class="row"><button class="btn danger" data-act="del">${ICONS.trash}Supprimer le tapis</button></div>`;
      if (!this.setPopover(`b${sel.x},${sel.y},${sel.z ?? 0}:${bridgeKey}:${items ? 'i' : ''}:${lmin}-${lmax}:${bup ? `${bup.price}${bup.locked ? 'L' : ''}${this.game.money >= bup.price ? '$' : ''}` : ''}`, info + linkInfo, actions)) return;
      const lb = p.querySelector<HTMLButtonElement>('[data-act="lvl"]');
      if (lb) lb.onclick = () => {
        const done = this.game.upgradeBelt(b);
        if (done) this.toast(`Tapis au niveau ${(bup?.to ?? 2)}`, 'good');
        this.popKey = '';
        this.renderPopover();
      };
      const em = p.querySelector<HTMLButtonElement>('[data-act="empty"]');
      if (em) em.onclick = () => {
        const n = this.game.emptyChain(b);
        if (n) this.toast(`Tapis vidé : ${n} objet${n > 1 ? 's' : ''} jeté${n > 1 ? 's' : ''}`, 'info');
        this.popKey = '';
        this.renderPopover();
      };
      const so = p.querySelector<HTMLButtonElement>('[data-act="sort"]');
      if (so) so.onclick = () => { if (this.game.placeNode(b, 'tri')) this.openNodeSheet(b); };
      p.querySelectorAll<HTMLButtonElement>('[data-bridge]').forEach((bt) => {
        bt.onclick = () => {
          const o = mbr[Number(bt.dataset.bridge)];
          if (o.from.links?.includes(o.to.id)) this.game.unlinkMachines(o.from, o.to.id); else this.game.linkMachines(o.from, o.to);
          this.popKey = '';
          this.renderPopover();
        };
      });
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
          const rank = (m: MachineDef) => { const n = nodeForMachine(m.id); const st = n ? g.nodeState(n) : 'locked'; return (st === 'locked' || st === 'soon' ? 100 : 0) + (n?.palier ?? 99); };
          locked.sort((a, b) => rank(a) - rank(b));
          html += `<div class="card"><p class="muted">Encore à débloquer dans l’arbre</p><div class="rc-locked">${locked.map((m) => {
            const node = nodeForMachine(m.id);
            // Comme dans l'arbre : une machine qu'on ne peut pas encore débloquer garde son secret.
            const st = node ? g.nodeState(node) : 'locked';
            if (st === 'locked' || st === 'soon') {
              return `<div class="rc-lrow mystery"><span class="rc-q">${MYSTERY}</span><b>???</b><small>${node ? `palier ${node.palier}` : 'plus tard'}</small></div>`;
            }
            return `<div class="rc-lrow"><img src="${this.machineIcons.get(m.id)}" alt=""><b>${esc(m.name)}</b><small>${m.recipes.length} recette${m.recipes.length > 1 ? 's' : ''}${node ? ` · palier ${node.palier}` : ''}</small></div>`;
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

  /** Feuille ouverte : pour la rafraîchir régulièrement. */
  private sheetKind: 'robot' | 'chest' | 'sell' | 'building' | 'machine' | 'line' | 'stop' | 'splitter' | 'freight' | '' = '';
  private machineId = -1;
  private chestId = -1;
  private liveTimer = 0;


  /** Une grille de cases (le contenu d'un coffre, en piles). */
  private gridHtml(cells: ({ t: string; n: number } | null)[], cols = 5): string {
    return `<div class="inv-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${cells.map((c) => {
      if (!c) return '<span class="inv-cell empty"></span>';
      return `<span class="inv-cell${c.t === this.chestPick ? ' on' : ''}" data-t="${c.t}" aria-label="${esc(item(c.t).name)} : ${c.n}"><img src="${this.itemIcons.get(c.t)}" alt=""><b>${c.n}</b></span>`;
    }).join('')}</div>`;
  }

  /** Le contenu d'un coffre, rangé en piles de 10. */
  private chestCells(m: Machine, buf: Record<string, number> = m.inBuf): ({ t: string; n: number } | null)[] {
    const cells: ({ t: string; n: number } | null)[] = [];
    for (const [t, n] of Object.entries(buf)) {
      let left = n;
      while (left > 0) { const k = Math.min(RULES.invStack, left); cells.push({ t, n: k }); left -= k; }
    }
    while (cells.length < this.game.view.slotsOf(m)) cells.push(null);
    return cells;
  }



  /** La fenêtre du robot : son nom, ce qu'il fait, le scanner. (Plus d'inventaire ni de fabrication.) */
  openRobot(): void {
    this.closePopover();
    this.tips.note('robotOpened');
    this.openSheet((sheet, close) => {
      const g = this.game, r = g.robot;
      const speed = g.robotSpeedMult > 1 ? ` · chenilles : ×${String(g.robotSpeedMult).replace('.', ',')}` : '';
      sheet.append(this.sheetHead(g.look.name, esc(`${r.moving ? 'Il roule.' : 'À l’arrêt.'} Touche le sol pour l’envoyer explorer : sa lampe dissipe le brouillard${speed}.`), close));
      sheet.append(this.skinCard(close), this.scanCard(close));
      const home = this.homeCard(close);
      if (home) sheet.append(home);
    }, true);
    this.sheetKind = 'robot';
  }


  /** Apparence : le skin porté ; toucher ouvre la page des skins. */
  private skinCard(close: () => void): HTMLElement {
    const g = this.game;
    const owned = SKINS.filter((s) => g.ownsSkin(s.id)).length;
    const btn = h('button', 'card scan-btn skin-btn', `<span class="scan-ico">${skinSvg(g.look.skin, { look: g.look })}</span><span class="pl"><b>Skin : ${esc(skinOf(g.look.skin).name)}</b><small>${owned} sur ${SKINS.length} gagnés · toucher pour changer</small></span><i>›</i>`);
    btn.onclick = () => { close(); this.openAchievements('skins'); };
    return btn;
  }

  /** Retour à la base : le robot se téléporte à côté de sa base (débloquée au palier 5, posée une fois). */
  private homeCard(close: () => void): HTMLElement | null {
    const g = this.game;
    if (!g.hasMachine('base_robot')) return null;
    const d = g.baseDistance();
    const icon = buildingSvgUrl('base_robot', 0, 96);
    const sub = d === null ? 'Pose ta Base du robot (palette) pour pouvoir t’y téléporter'
      : d < 1.5 ? 'Il est déjà à sa base'
      : `Téléporte le robot à côté de sa base · à ${Math.round(d)} case${Math.round(d) > 1 ? 's' : ''}`;
    const btn = h('button', `card scan-btn home-btn${d === null || d < 1.5 ? ' off' : ''}`, `<span class="scan-ico">${icon ? `<img src="${icon}" alt="">` : ''}</span><span class="pl"><b>Retour à la base</b><small>${esc(sub)}</small></span><i>›</i>`);
    btn.onclick = () => {
      if (d !== null && d < 1.5) return;
      if (!g.teleportRobot()) return;
      close();
      this.r.centerOnRobot();
      this.toast('Le robot est rentré à sa base', 'good');
    };
    return btn;
  }

  /** Scanner : choisir une matière, des flèches montrent les 3 filons les plus proches pendant 10 s. */
  private scanCard(close: () => void): HTMLElement {
    const g = this.game;
    const short = (id: string) => item(id).name.replace('Minerai de ', '').replace("Minerai d'", '').replace(/^./, (c) => c.toUpperCase());
    const btn = h('button', 'card scan-btn', `<span class="scan-ico">${RAW_IDS.slice(0, 3).map((id) => `<img src="${this.itemIcons.get(id)}" alt="">`).join('')}</span><span class="pl"><b>Scanner</b><small>Trouve les 3 filons les plus proches, même sous le brouillard</small></span><i>›</i>`);
    btn.onclick = () => {
      const opts: PickOpt[] = RAW_IDS.map((id) => ({ id, label: short(id), icon: this.itemIcons.get(id) }));
      this.openPicker('Scanner', 'Choisis une matière : des flèches montrent ses 3 filons les plus proches pendant 10 secondes.', opts, (id) => {
        if (!id) return;
        const found = g.scan(id, 3);
        if (!found.length) { this.toast(`Aucun filon de ${item(id).name.toLowerCase()} à portée du scanner`, 'warn'); return; }
        close();
        this.r.startScan(id, found);
        this.r.centerOnRobot();
        this.toast(`Scanner : ${found.length} filon${found.length > 1 ? 's' : ''} de ${item(id).name.toLowerCase()} · le plus proche à ${Math.round(found[0].d)} cases`, 'good');
      });
    };
    return btn;
  }



  /**
   * Bouton Supprimer en deux temps. Le « toucher encore » est retenu par machine pendant 4 s,
   * même si la fenêtre se redessine entre les deux touchers (elle se rafraîchit toute seule).
   */
  private armedDelete: { id: number; until: number } | null = null;
  /** Abandon de la commande du Comptoir en attente de confirmation (jusqu'à cette date). */
  private armedAbandon = 0;

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
    this.machineId = m.id;
    if (this.machTabOf !== m.id) { this.machTab = 'prod'; this.machTabOf = m.id; }
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
        status += ` Filon ${patch ? RICHNESS_LABEL[patch.richness] : ''} : ${g.view.drillRate(mm).toFixed(2).replace('.', ',')} par seconde.`;
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
        sheet.append(this.sheetHead(def.name, esc(counting ? `Décollage dans ${Math.max(0, Math.ceil(RULES.rocketCountdown - mm.craft!.t))} s !` : `${g.rockets ? `${g.rockets} fusée${g.rockets > 1 ? 's' : ''} lancée${g.rockets > 1 ? 's' : ''}. ` : ''}Remplis-la par tapis : quand tout y est, la fusée décolle.`), close));
        const card = h('div', 'card');
        card.innerHTML = Object.entries(ROCKET_NEEDS).map(([k, n]) => this.gauge(item(k).name, Math.min(n, mm.inBuf[k] ?? 0), n, false).replace(this.itemIcons.get('charbon')!, this.itemIcons.get(k)!)).join('');
        sheet.append(card);
        const acts = h('div', 'row');
        const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
        mv.onclick = () => { close(); this.startMove(mm); };
        acts.append(mv, this.deleteButton(mm, `Supprimer · rend ${def.cost}`, 'Toucher encore pour supprimer', close));
        sheet.append(acts);
        return;
      }
      if (def.kind === 'pump' || def.kind === 'reactor') {
        const wn = g.view.waterNetOf(mm);
        const waterLine = wn ? `Réseau d’eau : ${fmtN(wn.demand)} L/s demandés pour ${fmtN(wn.supply)} L/s pompés.` : 'Aucun tuyau ne la touche.';
        const sub = def.kind === 'pump' ? `${status} 40 L/s. ${waterLine}`
          : `${status} Eau : ${Math.round((mm.water ?? 0) * 100)} %. ${wn ? waterLine : 'Relie-le par un tuyau à une pompe, sinon il ne démarre pas.'}`;
        sheet.append(this.sheetHead(def.name, esc(sub), close));
        const card = h('div', 'card');
        if (def.kind === 'reactor') {
          const rods = mm.inBuf.uranium_enrichi ?? 0;
          card.innerHTML = `${this.gauge('Barreaux', rods, RULES.fuelStack, rods <= 1).replace(this.itemIcons.get('charbon')!, this.itemIcons.get('uranium_enrichi')!)}<div class="gauge power"><span class="g-label">${ICONS.pipe}Eau</span><span class="g-bar"><span style="width:${(mm.water ?? 0) * 100}%"></span></span><b>${Math.round((mm.water ?? 0) * 100)} %</b></div>${this.powerCard(mm)}<p class="muted small">Un barreau d’uranium enrichi dure 2 minutes à pleine charge ; apporte-les par tapis.</p>`;
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
        const wn = g.view.waterNetOf(mm), wet = Math.round((mm.water ?? 0) * 100);
        card.innerHTML = `${this.gauge('Carburant', mm.fuel, g.view.fuelCap(mm), g.view.lowFuel(mm), mm.carb)}<div class="gauge power"><span class="g-label">${ICONS.pipe}Eau</span><span class="g-bar"><span style="width:${wet}%"></span></span><b>${wet} %</b></div>${wn ? '' : '<p class="muted small">Il doit être refroidi : relie-le par un tuyau à une pompe posée sur un lac.</p>'}${this.powerCard(mm)}`;
        sheet.append(card);
        const acts = h('div', 'row');
        const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
        mv.onclick = () => { close(); this.startMove(mm); };
        acts.append(mv, this.deleteButton(mm, `Supprimer · rend ${def.cost}`, 'Toucher encore pour supprimer', close));
        sheet.append(acts);
        return;
      }
      // Four, presse, assembleur, foreuse… : une demi-fenêtre (la carte reste visible), trois onglets.
      sheet.classList.add('mach-sheet');
      this.r.selection = { kind: 'machine', id: mm.id };
      const crew = g.view.drillGroup(mm);
      sheet.append(this.machHead(def.kind === 'drill' ? (crew.length > 1 ? `${crew.length} foreuses` : def.name) : title, mm, close));
      if (this.machTab === 'rec' && !def.recipes.length) this.machTab = 'prod';
      const held = (crew.length > 1 ? crew : [mm]).reduce((a, x) => a + [...Object.values(x.inBuf), ...Object.values(x.outBuf)].reduce((b, n) => b + Math.max(0, n), 0), 0);
      const tabs = h('div', 'mtabs');
      const tabList: ['prod' | 'inv' | 'rec', string][] = [['prod', 'Production'], ['inv', `Contenu${held ? ` <small>${fmt(held)}</small>` : ''}`]];
      if (def.recipes.length) tabList.push(['rec', `Recettes${def.recipes.length > 1 ? ` <small>${def.recipes.length}</small>` : ''}`]);
      for (const [id, label] of tabList) {
        const b = h('button', `mtab${this.machTab === id ? ' on' : ''}`, label);
        b.onclick = () => { if (this.machTab !== id) this.setMachTab(id); };
        tabs.append(b);
      }
      sheet.append(tabs);
      const body = h('div', 'mtab-body');
      if (this.machTab === 'prod') this.machProduction(body, mm);
      else if (this.machTab === 'inv') this.machContents(body, mm);
      else this.machRecipes(body, mm);
      sheet.append(body);
      const acts = h('div', 'macts two');
      const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
      mv.onclick = () => { close(); this.startMove(mm); };
      acts.append(mv, this.deleteButton(mm, 'Supprimer', 'Confirmer', close));
      sheet.append(acts);
    }, true);
    this.sheetKind = 'machine';
    const def = machineDef(m.type);
    if (def.kind === 'crafter' || def.kind === 'drill') {
      this.overlay?.classList.add('see-map');
    }
  }

  /** Onglet ouvert dans la fenêtre d'une machine (gardé quand on revient sur la même machine). */
  private machTab: 'prod' | 'inv' | 'rec' = 'prod';
  private machTabOf = -1;

  private setMachTab(id: 'prod' | 'inv' | 'rec'): void {
    this.machTab = id;
    const body = this.overlay?.querySelector('.mtab-body');
    if (body) body.scrollTop = 0;
    this.refreshSheet();
  }



  /** Nom, pastille d'état, bouton fermer. */
  private machHead(title: string, mm: Machine, close: () => void): HTMLElement {
    const tone = mm.status === 'working' ? 'ok' : mm.status === 'idle' ? 'idle' : 'warn';
    return this.pillHead(title, STATUS_SHORT[mm.status] ?? STATUS_TEXT[mm.status] ?? '', tone, close);
  }

  private pillHead(title: string, pill: string, tone: 'ok' | 'idle' | 'warn', close: () => void): HTMLElement {
    const head = h('div', 'sheet-head mhead');
    head.innerHTML = `<h2>${esc(title)}</h2><span class="mpill ${tone}"><i></i>${esc(pill)}</span>`;
    const x = h('button', 'round', ICONS.close);
    x.setAttribute('aria-label', 'Fermer');
    x.onclick = close;
    head.append(x);
    return head;
  }

  /** Une case de la ligne de production : l'objet, son débit, son nom. */
  private mpItem(k: string, rate: number | null, out: boolean, n = 1, sub?: string): string {
    return `<div class="mp-it${out ? ' out' : ''}"><span class="mp-ico"><img src="${this.itemIcons.get(k)}" alt="">${n > 1 ? `<i>${n}</i>` : ''}</span>`
      + `<b>${rate !== null ? `${Hud.rate(rate)}<small>/s</small>` : '&nbsp;'}</b><span class="mp-n">${esc(sub ?? item(k).name.toLowerCase())}</span></div>`;
  }

  /** Onglet Production : ce qui entre → ce qui sort, l'avancement, le charbon. */
  private machProduction(body: HTMLElement, mm: Machine): void {
    const g = this.game, f = g.view, def = machineDef(mm.type);
    if (mm.type === 'raffinerie') {
      const cur = mm.choice ?? 'plastique';
      const row = h('div', 'mrow seg-row', '<span>Le pétrole donne</span>');
      for (const [id, label] of [['plastique', 'Plastique'], ['carburant', 'Carburant']]) {
        const b = h('button', `btn ${cur === id ? 'primary' : ''}`, label);
        b.onclick = () => { f.setChoice(mm, id); this.refreshSheet(); };
        row.append(b);
      }
      body.append(row);
    }
    const card = h('div', 'card mprod');
    let flow = '', cap = '', foot = '';
    const crew = f.drillGroup(mm);
    if (def.kind === 'drill' && crew.length > 1) {
      // Un groupe de foreuses collées : tout ce qu'il extrait, et par combien de sorties ça part.
      const by = new Map<string, number>();
      for (const x of crew) if (x.ore) by.set(x.ore, (by.get(x.ore) ?? 0) + f.drillRate(x));
      const outs = f.drillOutletTotal(mm);
      const total = [...by.values()].reduce((a, n) => a + n, 0);
      cap = `${crew.length} foreuses collées · un seul groupe`;
      flow = `<div class="mp-it"><span class="mp-ico"><img src="${this.machineIcons.get('foreuse')}" alt=""><i>${crew.length}</i></span><b>&nbsp;</b><span class="mp-n">groupe</span></div>${MP_ARROW}`
        + `<div class="mp-ins">${[...by].slice(0, 3).map(([k, r]) => this.mpItem(k, r, true)).join('<span class="mp-plus">+</span>')}</div>`;
      foot = `<span>${outs ? `${outs} sortie${outs > 1 ? 's' : ''}${outs > 1 ? ` · ${Hud.rate(total / outs)} /s chacune` : ''}` : 'Pas de sortie : trace un tapis depuis une foreuse'}</span>`;
      const made = crew.reduce((a, x) => a + x.made, 0);
      if (made > 0) foot += `<span>${fmt(made)} extraits</span>`;
    } else if (def.kind === 'drill') {
      const patch = g.world.patchAt(mm.x, mm.y) ?? g.world.patchAt(mm.x + 1, mm.y + 1);
      const ore = mm.ore;
      cap = ore ? `Extrait du ${esc(item(ore).name.toLowerCase())}` : 'Pas de filon dessous';
      if (ore) {
        flow = `${this.mpItem(ore, null, false, 1, `filon ${patch ? RICHNESS_LABEL[patch.richness] : ''}`)}${MP_ARROW}${this.mpItem(ore, f.drillRate(mm), true)}`;
        foot = `<span>${f.drillRate(mm) > 0 ? `1 toutes les ${secs(1 / f.drillRate(mm))}` : ''}</span>`;
      }
    } else {
      const ri = this.ratesRecipe(mm), auto = this.autoRecipe(mm);
      const rec = ri >= 0 ? def.recipes[ri] : null;
      if (rec) {
        const outs = Object.entries(rec.out);
        const main = outs[0]?.[0];
        if (mm.plan !== undefined) cap = `Débits prévus pour : ${esc(item(main).name.toLowerCase())}`;
        else if (auto >= 0) cap = `Fait des ${esc(item(main).plural)}`;
        else cap = 'Fait ce qu’on lui apporte · exemple :';
        // Le niveau de la machine accélère tout : débits et temps par pièce.
        const sp = Factory.levelSpeed(mm), tt = rec.time / sp;
        flow = `<div class="mp-ins">${Object.entries(rec.in).map(([k, n]) => this.mpItem(k, n / tt, false, n)).join('<span class="mp-plus">+</span>')}</div>${MP_ARROW}`
          + `<div class="mp-ins">${outs.map(([k, n]) => this.mpItem(k, n / tt, true, n)).join('<span class="mp-plus">+</span>')}</div>`;
        foot = `<span>${secs(tt)} par ${esc(item(main).name.toLowerCase())}</span>`;
      }
    }
    if (mm.made > 0 && crew.length < 2) foot += `<span>${fmt(mm.made)} ${def.kind === 'drill' ? 'extrait' : 'fabriqué'}${mm.made > 1 ? 's' : ''}</span>`;
    const many = def.recipes.length > 1;
    card.innerHTML = `<div class="mp-cap"><span>${cap}</span>${many ? `<button class="mp-more">${def.recipes.length} recettes ›</button>` : ''}</div>
      ${flow ? `<div class="mp-flow">${flow}</div>` : ''}
      ${crew.length > 1 ? '' : `<span class="mp-bar"><span data-mp="${mm.id}" style="width:${this.machProgress(mm) * 100}%"></span></span>`}
      ${foot ? `<div class="mp-foot">${foot}</div>` : ''}
      ${mm.status !== 'working' && mm.status !== 'idle' && mm.status !== 'noinput' ? `<p class="mp-warn">${esc(STATUS_TEXT[mm.status] ?? '')}</p>` : ''}`;
    card.querySelector<HTMLButtonElement>('.mp-more')?.addEventListener('click', () => this.setMachTab('rec'));
    // Énergie : le charbon (stock + celui qui brûle), ou le courant.
    if (f.powered(mm)) {
      const on = crew.length > 1 ? crew.filter((x) => f.powered(x)) : [mm];
      const label = crew.length > 1 ? `Au courant · ${on.length} sur ${crew.length}` : 'Au courant';
      card.append(h('div', 'mfuel power', `<span class="mf-ico">${ICONS.cable}</span><span class="mf-l">${label}</span><b>${kW(on.reduce((a, x) => a + f.powerUse(x), 0))}</b>`));
    } else if (def.coal && f.selfFed(mm)) {
      card.append(h('div', 'mfuel', `<span class="mf-ico"><img src="${this.itemIcons.get(mm.ore === 'charbon' ? 'charbon' : 'carburant')}" alt=""></span><span class="mf-l">Se sert dans ce qu’elle produit</span><b>${mm.fuel}/${f.fuelCap(mm)}</b>`));
    } else if (def.coal && !f.freeEnergy) {
      card.append(this.fuelBar(mm));
    }
    body.append(card);
    if (def.kind === 'drill' || def.kind === 'crafter') body.append(this.levelCard(mm));
  }

  /** Niveau d'une foreuse (de tout son groupe) : ce qu'il apporte, et le bouton pour monter d'un niveau. */
  private levelCard(mm: Machine): HTMLElement {
    const g = this.game, f = g.view;
    const crafter = machineDef(mm.type).kind === 'crafter';
    const crew = crafter ? [mm] : f.drillGroup(mm), all = crew.length > 1 ? crew : [mm];
    const up = g.drillUpgrade(mm);
    const lv = Math.min(...all.map((x) => x.lvl ?? 1));
    const mixed = all.some((x) => (x.lvl ?? 1) !== lv);
    const top = crafter ? 3 : 5, max = crafter ? g.machineMaxLevel : g.drillMaxLevel;
    const table = crafter ? RULES.machineLevelSpeed : RULES.drillLevelSpeed;
    const pips = Array.from({ length: top }, (_, i) => `<i class="l${i + 1} ${i + 1 <= lv ? 'on' : i + 1 <= max ? '' : 'lock'}"></i>`).join('');
    const card = h('div', 'card lvlcard');
    const speed = (n: number) => `×${String(table[n - 1]).replace('.', ',')}`;
    card.innerHTML = `<div class="lv-row"><div class="lv-t"><b>Niveau ${lv}${mixed ? '+' : ''}</b><small>${speed(lv)} ${crafter ? 'plus vite' : 'de minerai'}${all.length > 1 ? ` · ${all.length} foreuses` : ''}</small></div><span class="lv-pips">${pips}</span></div>`;
    if (up) {
      const b = h('button', `btn ${up.locked ? '' : 'primary'} lv-btn`, up.locked
        ? `${ICONS.lock}Niveau ${up.to} : à débloquer (Niveaux)`
        : `Niveau ${up.to} · ${speed(up.to)}<span class="lv-price">${ICONS.coinSm}${fmt(up.price)}</span>`);
      b.disabled = up.locked || g.money < up.price;
      b.onclick = () => { if (g.upgradeDrills(mm)) { this.toast(`${up.drills.length > 1 ? `${up.drills.length} foreuses` : crafter ? machineDef(mm.type).name : 'Foreuse'} au niveau ${up.to}`, 'good'); this.refreshSheet(); } };
      card.append(b);
    } else card.append(h('p', 'muted small', 'Niveau le plus haut.'));
    return card;
  }

  /** Avancement de la pièce en cours (0 à 1). */
  private machProgress(mm: Machine): number {
    const def = machineDef(mm.type);
    if (def.kind === 'drill') return Math.max(0, Math.min(1, mm.drillT));
    if (!mm.craft) return 0;
    const rec = def.recipes[mm.craft.ri];
    return rec ? Math.max(0, Math.min(1, mm.craft.t / rec.time)) : 0;
  }

  /**
   * La barre du charbon : une case qui se vide pour le morceau en train de brûler, puis le stock en cases.
   * Dessous, ce qu'elle consomme et combien de temps elle tiendra.
   */
  private fuelBar(mm: Machine): HTMLElement {
    const f = this.game.view;
    // Un groupe de foreuses partage son charbon : on montre celui de tout le groupe.
    const crew = f.drillGroup(mm), all = crew.length > 1 ? crew : [mm], k = all.length;
    let n = 0, carb = 0, cap = 0, left = 0;
    const per = RULES.coalMachineSeconds * (machineDef(mm.type).coalMult ?? 1);
    for (const x of all) {
      const xn = Math.max(0, x.fuel), xc = x.carb ?? 0;
      n += xn; carb += xc; cap += f.fuelCap(x);
      left += (xn - xc) * per + xc * per * RULES.carburantMult + Math.max(0, x.burn);
    }
    left /= k;
    const burnMax = mm.burn > per ? per * RULES.carburantMult : per;
    let cells = '';
    if (cap <= 20) for (let i = 0; i < cap; i++) cells += `<i class="${i < carb ? 'carb' : i < n ? 'on' : ''}"></i>`;
    const bar = cap <= 20 ? `<span class="mf-cells">${cells}</span>` : `<span class="mf-cont"><span style="width:${Math.min(100, (n / cap) * 100)}%"></span></span>`;
    const low = f.lowFuel(mm);
    const el = h('div', `mfuel${low ? ' low' : ''}`);
    const every = (carb > 0 ? per * RULES.carburantMult : per) / k;
    el.innerHTML = `<span class="mf-ico"><img src="${this.itemIcons.get(carb > 0 ? 'carburant' : 'charbon')}" alt=""></span>
      <span class="mf-main">
        <span class="mf-bar">${k > 1 ? '' : `<span class="mf-burn" title="En train de brûler"><span data-burn="${mm.id}" style="width:${Math.min(1, Math.max(0, mm.burn) / burnMax) * 100}%"></span></span>`}${bar}</span>
        <small>1 toutes les ${secs(every)}${k > 1 ? ' pour le groupe' : ''} · ${left > 0 ? `tient encore ${secs(left)}` : 'vide'}</small>
      </span>
      <b>${n}/${cap}</b>`;
    return el;
  }

  /** Onglet Contenu : ce qui attend dedans (touchable pour le reprendre), les tapis branchés, les liaisons. */
  private machContents(body: HTMLElement, mm: Machine): void {
    const g = this.game, f = g.view, def = machineDef(mm.type);
    const slots = (buf: Record<string, number>, which: 'in' | 'out', min: number) => {
      const list = Object.entries(buf).filter(([, n]) => n > 0);
      let html = list.map(([t, n]) => `<span class="mslot" data-which="${which}" aria-label="${esc(item(t).name)} : ${n}"><img src="${this.itemIcons.get(t)}" alt=""><b>${n}</b></span>`).join('');
      for (let i = list.length; i < min; i++) html += '<span class="mslot empty"></span>';
      return html;
    };
    // Un groupe de foreuses : ce qui attend dans tout le groupe, ensemble.
    const crew = f.drillGroup(mm), all = crew.length > 1 ? crew : [mm];
    const outAll: Record<string, number> = {};
    for (const x of all) for (const [t, n] of Object.entries(x.outBuf)) if (n > 0) outAll[t] = (outAll[t] ?? 0) + n;
    const any = Object.values(mm.inBuf).some((n) => n > 0) || Object.keys(outAll).length > 0;
    const inv = h('div', 'card minv2', `${def.kind === 'crafter' ? `<div class="minv-g"><small>En attente</small><div class="minv-s">${slots(mm.inBuf, 'in', 3)}</div></div>` : ''}
      <div class="minv-g"><small>Prêt à sortir${all.length > 1 ? ' (tout le groupe)' : ''}</small><div class="minv-s">${slots(outAll, 'out', 2)}</div></div>
      ${any ? '' : '<p class="muted small">Rien dedans pour l’instant.</p>'}`);
    body.append(inv);
    // Les tapis branchés : on entre et on sort par où l'on veut, on les compte seulement.
    const io = f.machineIO(mm), ioAll = all.flatMap((x) => (x === mm ? io : f.machineIO(x)));
    const nin = ioAll.filter((c) => !c.planned && c.io === 'in').length, nout = ioAll.filter((c) => !c.planned && c.io === 'out').length;
    const belts = h('div', 'mrow', `<span class="mrow-ico">${ICONS.tapis}</span><span>${nin || nout ? `${nin} tapis entre${nin > 1 ? 'nt' : ''} · ${nout} sort${nout > 1 ? 'ent' : ''}` : 'Aucun tapis branché'}</span>`);
    body.append(belts);
    // Restes d'une ancienne partie : des entrées ou sorties prévues sans tapis. On peut les effacer.
    const planned = io.filter((c) => c.planned && c.port !== undefined);
    if (planned.length) {
      const row = h('div', 'mrow', `<span>${planned.length} emplacement${planned.length > 1 ? 's' : ''} prévu${planned.length > 1 ? 's' : ''} sans tapis</span>`);
      const clear = h('button', 'btn small', 'Effacer');
      clear.onclick = () => {
        for (const p of [...planned].sort((a, b) => b.port! - a.port!)) g.removePort(mm, p.port!);
        this.refreshSheet();
      };
      row.append(clear);
      body.append(row);
    }
    for (const to of (mm.links ?? []).map((id) => f.machines.get(id)).filter((x): x is Machine => !!x)) {
      const row = h('div', 'mrow', `<span>Reliée directement à ${esc(machineDef(to.type).name.toLowerCase())}</span>`);
      const cut = h('button', 'btn small', 'Couper');
      cut.onclick = () => { g.unlinkMachines(mm, to.id); this.refreshSheet(); };
      row.append(cut);
      body.append(row);
    }
  }

  /** Onglet Recettes : tout ce qu'elle sait faire ; en toucher une sert à prévoir ses débits. */
  private machRecipes(body: HTMLElement, mm: Machine): void {
    const g = this.game, def = machineDef(mm.type);
    const auto = this.autoRecipe(mm);
    const list = h('div', 'card mrecs');
    const autoRow = h('button', `mrec-row${mm.plan === undefined ? ' on' : ''}`, `<span class="plan-auto">Auto</span><span class="mrec-name">Selon ce qui arrive</span>${mm.plan === undefined ? '<span class="mrec-tick">✓</span>' : ''}`);
    autoRow.onclick = () => { g.setPlan(mm, undefined); this.refreshSheet(); };
    list.append(autoRow);
    def.recipes.forEach((r, i) => {
      const outs = Object.keys(r.out);
      if (!outs.length) return;
      const o = outs[0];
      const ins = Object.entries(r.in).map(([k, n]) => `<span class="mrec-i"><img src="${this.itemIcons.get(k)}" alt="">${n > 1 ? `<i>${n}</i>` : ''}</span>`).join('<b class="mp-plus">+</b>');
      const tag = auto === i && mm.status === 'working' ? '<span class="mrec-tag">en cours</span>' : '';
      const row = h('button', `mrec-row${mm.plan === i ? ' on' : ''}`, `${ins}<b class="mp-plus">→</b><span class="mrec-i out"><img src="${this.itemIcons.get(o)}" alt=""></span><span class="mrec-name">${esc(item(o).name)}${tag}</span><span class="mrec-t">${secs(r.time)}</span>`);
      row.onclick = () => { g.setPlan(mm, mm.plan === i ? undefined : i); this.setMachTab('prod'); };
      list.append(row);
    });
    body.append(list);
    body.append(h('p', 'muted small mrec-hint', 'Elle fabrique selon ce qu’on lui apporte. Une recette touchée montre ses débits.'));
  }

  /** Une entrée ou une sortie est en train d'être glissée vers la carte (la fenêtre attend). */
  private portDragging = false;

  /** La recette des débits attendus : celle prévue, sinon celle en cours, sinon celle des objets déjà reçus, sinon la première. */
  private ratesRecipe(mm: Machine): number {
    const def = machineDef(mm.type);
    if (!def.recipes.length) return -1;
    if (mm.plan !== undefined && def.recipes[mm.plan]) return mm.plan;
    const ri = this.autoRecipe(mm);
    return ri >= 0 ? ri : 0;
  }

  /**
   * La recette que la machine fait vraiment (en auto), si on le sait : celle en cours, sinon d'après
   * ce qu'elle a vu passer, ce qui attend sur ses tapis et dans ses cases (une machine bouchée le sait encore).
   */
  private autoRecipe(mm: Machine): number {
    const def = machineDef(mm.type), n = def.recipes.length;
    if (!n) return -1;
    if (mm.craft) return mm.craft.ri;
    const io = this.game.view.machineIO(mm).filter((c) => !!c.item);
    const ins = new Set([...Object.values(mm.seenIn ?? {}), ...io.filter((c) => c.io === 'in').map((c) => c.item!), ...Object.keys(mm.inBuf).filter((t) => mm.inBuf[t] > 0)]);
    const outs = new Set([...Object.keys(mm.outBuf).filter((t) => mm.outBuf[t] > 0), ...Object.values(mm.seenOut ?? {}), ...io.filter((c) => c.io === 'out').map((c) => c.item!)]);
    const byOut = def.recipes.findIndex((r) => Object.keys(r.out).some((k) => outs.has(k)));
    if (byOut >= 0) return byOut;
    const byIn = def.recipes.findIndex((r) => Object.keys(r.in).every((k) => ins.has(k)));
    if (byIn >= 0) return byIn;
    if (mm.made > 0) return ((mm.rrRecipe - 1) % n + n) % n;
    return n === 1 ? 0 : -1;
  }

  private static rate(x: number): string {
    return x < 0.005 ? '0' : x >= 10 ? x.toFixed(1).replace('.', ',') : x.toFixed(2).replace('.', ',').replace(/0$/, '');
  }

  /**
   * La machine au milieu, ses entrées et sorties autour, là où elles se branchent, avec leurs débits attendus.
   * Rien n'est filtré : on entre et on sort par où l'on veut. Une entrée ou une sortie prévue se glisse ailleurs ;
   * ce qui manque encore (d'après la recette) attend en pointillés.
   */
  private machineDiagram(mm: Machine): HTMLElement {
    const g = this.game, f = g.view, def = machineDef(mm.type);
    const store = def.kind === 'storage' || f.isStop(mm);
    const W = 340, M = 80, CW = 118, CH = 52;
    const box = h('div', 'mdiag');
    const inner = h('div', 'mdiag-in');
    box.append(inner);
    const ri = this.ratesRecipe(mm), rec = ri >= 0 ? def.recipes[ri] : null;
    const maxIn: Record<string, number> = {}, maxOut: Record<string, number> = {};
    if (rec) {
      for (const [k, v] of Object.entries(rec.in)) maxIn[k] = v / rec.time;
      for (const [k, v] of Object.entries(rec.out)) maxOut[k] = v / rec.time;
    }
    if (def.kind === 'drill' && mm.ore) maxOut[mm.ore] = f.drillRate(mm);
    // Le combustible : ce qu'elle brûle en travaillant, si elle n'est pas au courant.
    if (def.coal && !f.powered(mm)) for (const t of ['charbon', 'carburant']) if (maxIn[t] === undefined) maxIn[t] = 1 / (RULES.coalMachineSeconds * (t === 'carburant' ? RULES.carburantMult : 1));
    type Entry = { side: 'top' | 'right' | 'bottom' | 'left'; io: 'in' | 'out'; item?: string; kind: 'belt' | 'planned' | 'ghost'; port?: number; x?: number; y?: number };
    const io = f.machineIO(mm);
    const entries: Entry[] = io.map((c) => ({ side: c.side, io: c.io, item: c.item, kind: c.planned ? 'planned' : 'belt', port: c.port, x: c.x, y: c.y }));
    // Dans l'ordre du bord : de haut en bas sur les côtés, de gauche à droite en haut et en bas.
    entries.sort((p, q) => (p.side === 'left' || p.side === 'right' ? (p.y ?? 0) - (q.y ?? 0) : (p.x ?? 0) - (q.x ?? 0)));
    const has = (k: string, dir: 'in' | 'out') => entries.some((e) => e.io === dir && e.item === k);
    for (const k of Object.keys(maxIn)) if (!has(k, 'in') && !(isFuel(k) && !rec?.in[k])) entries.push({ side: 'left', io: 'in', item: k, kind: 'ghost' });
    for (const k of Object.keys(maxOut)) if (!has(k, 'out')) entries.push({ side: 'right', io: 'out', item: k, kind: 'ghost' });
    // La hauteur suit ce qu'il y a autour : pas de vide en haut ni en bas sans raison.
    const count = (side: Entry['side']) => entries.filter((e) => e.side === side).length;
    const stack = (n: number) => n * CH + Math.max(0, n - 1) * 6;
    const topH = count('top') ? CH + 26 : 0, botH = count('bottom') ? CH + 26 : 0;
    const midH = Math.max(M + 16, stack(count('left')), stack(count('right')));
    const H = topH + midH + botH;
    const mx = (W - M) / 2, my = topH + (midH - M) / 2;
    inner.style.height = `${H}px`;
    // La machine
    const icon = this.machineIcons.get(mm.type);
    const mEl = h('div', 'mdiag-m', icon ? `<img src="${icon}" alt="${esc(def.name)}">` : '');
    mEl.style.left = `${mx}px`; mEl.style.top = `${my}px`;
    inner.append(mEl);
    const place = (el: HTMLElement, x: number, y: number) => { el.style.left = `${x}px`; el.style.top = `${y}px`; inner.append(el); };
    (['left', 'right', 'top', 'bottom'] as const).forEach((side) => {
      const list = entries.filter((e) => e.side === side);
      list.forEach((e, i) => {
        let x: number, y: number;
        if (side === 'left' || side === 'right') {
          const total = list.length * CH + (list.length - 1) * 6;
          x = side === 'left' ? 0 : W - CW;
          y = topH + midH / 2 - total / 2 + i * (CH + 6);
        } else {
          const total = list.length * CW + (list.length - 1) * 8;
          x = W / 2 - total / 2 + i * (CW + 8);
          y = side === 'top' ? 2 : H - CH - 2;
        }
        // Le fil jusqu'au bord de la machine, et le chevron sur ce bord.
        const cls = `mdiag-wire ${e.io} ${e.kind}`;
        let cx: number, cy: number;
        if (side === 'left' || side === 'right') {
          cy = Math.max(my + 12, Math.min(my + M - 12, y + CH / 2));
          const x0 = side === 'left' ? CW : mx + M, x1 = side === 'left' ? mx : W - CW;
          const wire = h('div', `${cls} h`); wire.style.width = `${x1 - x0}px`; place(wire, x0, cy - 2);
          cx = side === 'left' ? mx : mx + M;
        } else {
          cx = Math.max(mx + 12, Math.min(mx + M - 12, x + CW / 2));
          const y0 = side === 'top' ? CH + 2 : my + M, y1 = side === 'top' ? my : H - CH - 2;
          const wire = h('div', `${cls} v`); wire.style.height = `${y1 - y0}px`; place(wire, cx - 2, y0);
          cy = side === 'top' ? my : my + M;
        }
        const out = side === 'left' ? 0 : side === 'right' ? 180 : side === 'top' ? 90 : 270;
        const rot = e.io === 'in' ? out : (out + 180) % 360;
        const chev = h('span', `mdiag-chev ${e.io} ${e.kind}`, `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${rot}deg)"><path d="M3.5 2 L6.5 5 L3.5 8"/></svg>`);
        place(chev, cx - 10, cy - 10);
        // La carte : l'objet et son débit attendu.
        const k = e.item;
        const exp = k ? (e.io === 'in' ? maxIn[k] : maxOut[k]) : undefined;
        const name = k ? esc(item(k).name) : e.kind === 'ghost' ? (e.io === 'in' ? 'Entrée' : 'Nouvelle sortie') : e.io === 'in' ? 'Tout ce qui arrive' : 'Tout ce qui est prêt';
        const ico = k ? `<img src="${this.itemIcons.get(k)}" alt="">` : '';
        const tag = e.kind === 'planned' ? '<small class="mc-tag">prévue</small>' : '';
        const rate = exp !== undefined ? `<b>${Hud.rate(exp)}</b><small>/s</small>` : e.kind === 'ghost' && !k ? '<small>à glisser</small>' : store ? '' : '<b>—</b>';
        const chip = h('div', `mchip ${e.io} ${e.kind}`, `<span class="mc-name">${ico}<span class="mc-t">${name}</span></span><span class="mc-rate">${rate}${tag}</span>`);
        if (e.kind === 'planned' && e.port !== undefined) {
          const x0 = h('button', 'mc-x', '×');
          x0.setAttribute('aria-label', 'Retirer');
          const pi = e.port;
          x0.onclick = (ev) => { ev.stopPropagation(); g.removePort(mm, pi); this.refreshSheet(); };
          chip.append(x0);
        }
        // Ce qui est déjà branché par un tapis ne se glisse pas ; une carte prévue ou en pointillés, oui.
        if (e.kind !== 'belt') {
          const from = e.kind === 'ghost' ? undefined : { x: e.x!, y: e.y! };
          this.bindPortDrag(chip, mm, e.io, k, from, () => this.toast(from ? 'Glisse-la sur un autre côté du bâtiment pour la déplacer' : 'Glisse-la sur un côté du bâtiment', 'info'));
        }
        place(chip, x, y);
      });
    });
    const hint = entries.some((e) => e.kind === 'ghost')
      ? 'Glisse ce qui est en pointillés sur un côté du bâtiment pour le prévoir. Un tapis entre et sort par où tu veux.'
      : entries.some((e) => e.kind === 'planned') ? 'Glisse une entrée ou une sortie prévue pour la déplacer.' : '';
    if (hint) box.append(h('p', 'mdiag-hint', hint));
    return box;
  }

  /**
   * Glisser une entrée ou une sortie jusqu'à un côté du bâtiment, sur la carte : une nouvelle (en pointillés)
   * devient prévue ; une prévue est déplacée, et échangée avec celle qui était à l'endroit où on la lâche.
   * Un simple toucher appelle `tap`.
   */
  private bindPortDrag(el: HTMLElement, mm: Machine, io: 'in' | 'out', itemId: string | undefined, from: { x: number; y: number } | undefined, tap: () => void): void {
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.mc-x')) return;
      const sx = e.clientX, sy = e.clientY;
      let started = false, ghost: HTMLElement | null = null;
      let slot: { x: number; y: number } | null = null;
      const begin = () => {
        started = true;
        this.portDragging = true;
        if (this.overlay) this.overlay.style.visibility = 'hidden';
        ghost = el.cloneNode(true) as HTMLElement;
        ghost.classList.add('mchip-drag');
        this.root.append(ghost);
        this.r.focusOn(mm.x + mm.w / 2, mm.y + mm.h / 2, Math.max(this.r.camera.zoom, 1.6), 0.35);
        this.showBubble(window.innerWidth / 2, Math.min(window.innerHeight * 0.36, 300), from ? 'Lâche-la sur un autre côté : elle s’échange avec ce qui y est' : 'Lâche-la sur un côté du bâtiment', false);
      };
      const move = (ev: PointerEvent) => {
        if (!started) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return; begin(); }
        if (ghost) ghost.style.transform = `translate(${ev.clientX - 52}px, ${ev.clientY - 70}px) rotate(-4deg)`;
        slot = this.portSlotAt(mm, ev.clientX, ev.clientY - 40);
        this.r.preview = { kind: 'ports', id: mm.id, io, slot };
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        if (!started) { tap(); return; }
        ghost?.remove();
        this.r.preview = null;
        this.bubble.classList.add('hidden');
        this.portDragging = false;
        if (slot) {
          const g = this.game;
          const ok = from ? g.movePort(mm, from, slot) : g.addPort(mm, slot.x, slot.y, io, itemId);
          if (ok) this.toast(from ? 'Déplacée' : io === 'in' ? 'Entrée prévue : trace un tapis jusqu’au chevron' : 'Sortie prévue : trace un tapis depuis le chevron', 'good');
        }
        if (this.overlay) this.overlay.style.visibility = '';
        this.refreshSheet();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }

  /** L'emplacement (case dehors, sur un côté) le plus proche du doigt, s'il est assez près. */
  private portSlotAt(mm: Machine, sx: number, sy: number): { x: number; y: number } | null {
    const w = this.worldAt(sx, sy);
    let best: { x: number; y: number } | null = null, bd = 1.1;
    for (const c of this.game.view.perimeter(mm)) {
      const ex = c.x + 0.5 - DX[c.d] * 0.3, ey = c.y + 0.5 - DY[c.d] * 0.3;
      const d = Math.hypot(w.x - ex, w.y - ey);
      if (d < bd) { bd = d; best = { x: c.x, y: c.y }; }
    }
    return best;
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
    return `à quai à ${here ? this.stationName(here) : '?'}${load}`;
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

  /** Ce qu'un véhicule dépose ou prend à un arrêt : rien, tout, ou des objets choisis. */
  /** Ce qu'un véhicule prend ou dépose à un arrêt : rien, tout, ou les objets choisis (plusieurs), dans la grande fenêtre. */
  private openStopRule(lineId: number, i: number, which: 'take' | 'drop'): void {
    const g = this.game;
    const l = g.factory.lines.get(lineId);
    const st = l?.stops[i];
    if (!l || !st) return;
    const m = g.factory.machines.get(st.id);
    let rule = stopRules(st)[which];
    const picked = new Set<string>(Array.isArray(rule) ? rule : []);
    let query = '';
    const save = () => { g.setStopRule(lineId, i, which, rule); this.refreshSheet(); };
    this.openModal(`${which === 'take' ? 'Prend' : 'Dépose'} à ${m ? this.stationName(m) : '?'}`, which === 'take' ? 'Ce que le véhicule emporte d’ici (jamais ce qu’il vient d’y déposer)' : 'Ce que le véhicule laisse ici en arrivant', (body, _close, rebuild) => {
      const modes = h('div', 'rule-seg pick-seg');
      for (const [mode, label] of [['none', 'Rien'], ['all', 'Tout'], ['list', 'Choisir']] as const) {
        const on = mode === 'list' ? Array.isArray(rule) : rule === mode;
        const b = h('button', `btn${on ? ' primary' : ''}`, label);
        b.onclick = () => {
          rule = mode === 'list' ? [...picked] : mode;
          if (mode !== 'list' || picked.size) save();
          rebuild();
        };
        modes.append(b);
      }
      body.append(modes);
      if (!Array.isArray(rule)) {
        body.append(h('p', 'pick-note', rule === 'all' ? 'Tout ce qui est là part (ou est déposé), dans la limite du chargement.' : 'Rien n’est pris ni déposé à cet arrêt.'));
        return;
      }
      body.append(h('p', 'pick-note', 'Touche les objets (plusieurs possibles).'));
      const input = h('input', 'pick-search') as HTMLInputElement;
      input.type = 'search';
      input.placeholder = 'Chercher un objet';
      input.value = query;
      body.append(input);
      const list = h('div', 'pick-list');
      body.append(list);
      // Les objets de la partie : ceux qui passent déjà dans ce dépôt d'abord.
      const here = m ? [...Object.keys(m.inBuf), ...Object.keys(m.outBuf)] : [];
      const known = Object.keys(g.factory.stats.made);
      const order = [...new Set([...picked, ...here, ...known, ...ITEM_LIST.map((x) => x.id)])].filter((id) => !FLUIDS.has(id));
      const fill = () => {
        list.innerHTML = '';
        const q = query.trim().toLowerCase();
        let group = '';
        for (const id of order) {
          if (q && !item(id).name.toLowerCase().includes(q)) continue;
          const grp = picked.has(id) ? 'Choisis' : here.includes(id) ? 'Dans cet arrêt' : 'Autres objets';
          if (grp !== group) { group = grp; list.append(h('p', 'pick-group', grp)); }
          const row = h('button', `pick-row${picked.has(id) ? ' on' : ''}`, `<img class="pi" src="${this.itemIcons.get(id)}" alt=""><span class="pl"><b>${esc(item(id).name)}</b></span><span class="pick-box">${picked.has(id) ? CHECK_SM : ''}</span>`);
          row.onclick = () => {
            if (picked.has(id)) picked.delete(id); else picked.add(id);
            rule = [...picked];
            g.setStopRule(lineId, i, which, rule.length ? rule : 'none');
            this.refreshSheet();
            row.classList.toggle('on', picked.has(id));
            row.querySelector('.pick-box')!.innerHTML = picked.has(id) ? CHECK_SM : '';
          };
          list.append(row);
        }
      };
      input.oninput = () => { query = input.value; fill(); };
      fill();
    }, (bar, close) => {
      const ok = h('button', 'btn primary big', 'Terminé');
      ok.onclick = close;
      bar.append(ok);
    });
  }

  /** Une ligne : ses arrêts (ce qu'on y dépose et ce qu'on y prend), ses véhicules, d'autres arrêts. */
  openLine(id: number): void {
    this.closePopover();
    this.openSheet((sheet, close) => {
      const g = this.game, f = g.view, l = f.lines.get(id);
      if (!l) { close(); return; }
      const truck = l.kind !== 'train';
      sheet.append(this.sheetHead(truck ? 'Ligne de camions' : 'Ligne de trains', `${l.stops.length} arrêts, parcourus en boucle · ${truck ? RULES.truckLoad : RULES.trainLoad} objets par voyage`, close));
      // Arrêts
      const stops = h('div', 'card');
      stops.append(h('p', 'muted', 'Arrêts, parcourus dans l’ordre · à chacun, le véhicule dépose ce qui est prévu, puis prend ce qu’il faut emporter'));
      const ruleText = (r: StopRule) => r === 'all' ? 'tout' : r === 'none' ? 'rien' : r.length <= 2 ? r.map((k) => item(k).name.toLowerCase()).join(', ') : `${r.length} objets`;
      const ruleIcons = (r: StopRule) => Array.isArray(r) ? r.slice(0, 3).map((k) => `<img class="btn-ico" src="${this.itemIcons.get(k)}" alt="">`).join('') : '';
      l.stops.forEach((st, i) => {
        const m = f.machines.get(st.id);
        const { take, drop } = stopRules(st);
        const box = h('div', 'stop-box');
        const head = h('div', 'row link-row', `<span><b>${i + 1}.</b> ${esc(m ? this.stationName(m) : '?')}</span>`);
        if (l.stops.length > 2) {
          const del = h('button', 'btn danger stop-del', '×');
          del.setAttribute('aria-label', 'Retirer cet arrêt');
          del.onclick = () => { g.removeStop(l.id, i); this.refreshSheet(); };
          head.append(del);
        }
        box.append(head);
        const rules = h('div', 'row stop-rules');
        const dropBtn = h('button', 'btn', `<span>Dépose</span>${ruleIcons(drop)}<b>${esc(ruleText(drop))}</b>`);
        dropBtn.onclick = () => this.openStopRule(l.id, i, 'drop');
        const takeBtn = h('button', 'btn', `<span>Prend</span>${ruleIcons(take)}<b>${esc(ruleText(take))}</b>`);
        takeBtn.onclick = () => this.openStopRule(l.id, i, 'take');
        rules.append(dropBtn, takeBtn);
        box.append(rules);
        stops.append(box);
      });
      if (l.stops.length < RULES.maxStops) {
        const cand = [...f.machines.values()].filter((x) => g.stationKind(x) === l.kind && !l.stops.some((st) => st.id === x.id));
        const add = h('button', 'btn', `Ajouter un arrêt${cand.length ? '' : ` (pose ${truck ? 'un autre dépôt' : 'une autre gare'})`}`);
        add.disabled = !cand.length;
        add.onclick = () => {
          this.closeSheet();
          this.openMap({
            title: 'Ajouter un arrêt', sub: 'Touche l’arrêt à ajouter (il dépose tout par défaut)', candidates: cand,
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

  /** Un coffre en grand, avec l'inventaire du robot dessous. */
  openChest(m: Machine): void {
    this.closePopover();
    this.chestId = m.id;
    this.chestPick = null;
    this.chestArmed = false;
    this.openSheet((sheet, close) => {
      const chest = this.game.view.machines.get(this.chestId);
      if (!chest) { close(); return; }
      const g = this.game;
      let total = 0, arrived = 0;
      for (const v of Object.values(chest.inBuf)) total += v;
      for (const v of Object.values(chest.outBuf)) arrived += v;
      const stop = g.view.isStop(chest), cap = g.view.slotsOf(chest) * RULES.invStack;
      if (stop && g.stationKind(chest)) { this.buildStopSheet(sheet, chest, close); return; }
      // Comme une machine : une demi-fenêtre (la carte reste visible), deux onglets, les boutons en bas.
      if (this.chestTabOf !== chest.id) { this.chestTab = 'inv'; this.chestTabOf = chest.id; this.chestPick = null; this.chestArmed = false; }
      sheet.classList.add('mach-sheet');
      this.r.selection = { kind: 'machine', id: chest.id };
      const name = machineDef(chest.type).name;
      sheet.append(this.pillHead((chest.lvl ?? 1) > 1 ? `${name} · niv. ${chest.lvl}` : name, total ? `${fmt(total)} / ${cap}` : 'Vide', total >= cap ? 'warn' : total ? 'ok' : 'idle', close));
      const tabs = h('div', 'mtabs');
      const kinds = Object.values(chest.inBuf).filter((n) => n > 0).length;
      const list: ['inv' | 'io', string][] = [['inv', `Contenu${total ? ` <small>${fmt(total)}</small>` : ''}`], ['io', 'Entrées et sorties']];
      for (const [id, label] of list) {
        const t = h('button', `mtab${this.chestTab === id ? ' on' : ''}`, label);
        t.onclick = () => { if (this.chestTab === id) return; this.chestTab = id; this.refreshSheet(); };
        tabs.append(t);
      }
      sheet.append(tabs);
      const body = h('div', 'mtab-body');
      if (this.chestTab === 'inv') {
        const cells = this.chestCells(chest).filter((c) => c);
        const cols = 6;
        while (cells.length < Math.max(cols, Math.ceil(cells.length / cols) * cols)) cells.push(null);
        const c1 = h('div', 'card');
        c1.innerHTML = `<div class="sfill"><b>Rempli</b><span class="mp-bar"><span style="width:${Math.min(100, (total / cap) * 100)}%"></span></span><b>${fmt(total)} / ${cap}</b></div>
          <p class="muted small">${total ? `${kinds} sorte${kinds > 1 ? 's' : ''} d’objets · touche-en un pour le jeter · ` : ''}les tapis qui arrivent le remplissent, un tapis qui en part le vide.</p>
          ${this.gridHtml(cells, cols)}`;
        if (this.chestPick && !(chest.inBuf[this.chestPick] > 0)) this.chestPick = null;
        c1.querySelectorAll<HTMLElement>('.inv-cell[data-t]').forEach((el) => {
          el.onclick = () => { this.chestPick = this.chestPick === el.dataset.t ? null : el.dataset.t!; this.chestArmed = false; this.refreshSheet(); };
        });
        // Un objet choisi : on peut jeter tout ce qu'il y en a (en touchant deux fois).
        if (this.chestPick) {
          const t = this.chestPick, n = chest.inBuf[t] ?? 0;
          const bar = h('div', 'chest-pick');
          bar.innerHTML = `<img src="${this.itemIcons.get(t)}" alt=""><span><b>${fmt(n)} ${esc(n > 1 ? item(t).plural : item(t).name.toLowerCase())}</b><small>${this.chestArmed ? 'Pour de bon' : 'Dans ce coffre'}</small></span>`;
          const no = h('button', 'btn', 'Annuler');
          no.onclick = () => { this.chestPick = null; this.chestArmed = false; this.refreshSheet(); };
          const yes = h('button', `btn danger${this.chestArmed ? ' armed' : ''}`, `${ICONS.trash}${this.chestArmed ? 'Confirmer' : 'Jeter'}`);
          yes.onclick = () => {
            if (!this.chestArmed) { this.chestArmed = true; this.refreshSheet(); return; }
            const k = g.discardFromChest(chest, t);
            this.chestPick = null; this.chestArmed = false;
            if (k) this.toast(`${fmt(k)} ${k > 1 ? item(t).plural : item(t).name.toLowerCase()} jeté${k > 1 ? 's' : ''}`, 'info');
            this.refreshSheet();
          };
          bar.append(no, yes);
          c1.append(bar);
        }
        body.append(c1);
      } else {
        // Ses entrées et sorties : tout passe, par où l'on veut.
        body.append(this.machineDiagram(chest));
      }
      sheet.append(body);
      // Monter de niveau : plus de place (jusqu'au niveau 3).
      const up = g.chestUpgrade(chest);
      const lvl = chest.lvl ?? 1;
      if (up) {
        const nextCap = cap / lvl * up.to;
        const ub = h('button', 'btn primary', `<span class="lv-dot l${up.to}"></span>Niveau ${up.to} · ${nextCap} objets · ${ICONS.coinSm}${fmt(up.price)}`);
        if (g.money < up.price) ub.setAttribute('disabled', '');
        ub.onclick = () => { if (g.upgradeChest(chest)) { this.toast(`${name} au niveau ${up.to} : ${nextCap} objets`, 'good'); this.refreshSheet(); } };
        sheet.append(ub);
      } else if (['coffre', 'grand_coffre', 'entrepot'].includes(chest.type)) {
        sheet.append(h('p', 'muted small', `Niveau 3 : le plus grand (${cap} objets).`));
      }
      const acts = h('div', 'row');
      const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
      mv.onclick = () => { close(); this.startMove(chest); };
      const del = this.deleteButton(chest, 'Supprimer', total + arrived ? 'Son contenu sera perdu : toucher encore' : 'Toucher encore pour supprimer', close);
      acts.append(mv, del);
      sheet.append(acts);
    }, true);
    this.sheetKind = 'chest';
    if (this.game.view.isStop(m) && this.game.stationKind(m)) {
      this.overlay?.classList.add('see-map');
    }
  }

  private chestTab: 'inv' | 'io' = 'inv';
  /** L'objet choisi dans la grille d'un coffre (pour le jeter), et la confirmation. */
  private chestPick: string | null = null;
  private chestArmed = false;
  private chestTabOf = -1;
  private stopTab: 'lines' | 'arr' | 'dep' = 'lines';
  private stopTabOf = -1;

  /**
   * Dépôt ou gare, comme une machine : une demi-fenêtre (la carte reste visible), trois onglets
   * (ses lignes, ce qui est arrivé, ce qui part) et en bas Relier / Déplacer / Supprimer.
   */
  private buildStopSheet(sheet: HTMLElement, st: Machine, close: () => void): void {
    const g = this.game, f = g.view, kind = g.stationKind(st)!;
    const train = kind === 'train';
    if (this.stopTabOf !== st.id) { this.stopTab = 'lines'; this.stopTabOf = st.id; }
    sheet.classList.add('mach-sheet');
    this.r.selection = { kind: 'machine', id: st.id };
    const lines = f.linesOf(st);
    const sum = (b: Record<string, number>) => Object.values(b).reduce((a, n) => a + Math.max(0, n), 0);
    const dep = sum(st.inBuf), arr = sum(st.outBuf), cap = f.slotsOf(st) * RULES.invStack;
    const docked = lines.some((l) => l.vehicles.some((v) => !v.moving && l.stops[v.at % l.stops.length]?.id === st.id));
    sheet.append(this.pillHead(this.stationName(st), lines.length ? `${lines.length} ligne${lines.length > 1 ? 's' : ''}${docked ? ' · à quai' : ''}` : train ? 'Pas reliée' : 'Pas relié', lines.length ? 'ok' : 'idle', close));
    const tabs = h('div', 'mtabs');
    const list: ['lines' | 'arr' | 'dep', string][] = [['lines', 'Lignes'], ['arr', `Arrivées${arr ? ` <small>${fmt(arr)}</small>` : ''}`], ['dep', `Départs${dep ? ` <small>${fmt(dep)}</small>` : ''}`]];
    for (const [id, label] of list) {
      const b = h('button', `mtab${this.stopTab === id ? ' on' : ''}`, label);
      b.onclick = () => { if (this.stopTab === id) return; this.stopTab = id; this.refreshSheet(); };
      tabs.append(b);
    }
    sheet.append(tabs);
    const body = h('div', 'mtab-body');
    if (this.stopTab === 'lines') {
      const card = h('div', 'card slines');
      for (const l of lines) {
        const names = l.stops.map((s2) => { const x = f.machines.get(s2.id); return x ? this.stationName(x) : '?'; }).join(' → ');
        const row = h('button', 'sline', `<span class="sline-ico">${train ? ICONS.train : ICONS.transport}</span><span class="sline-t"><b>${esc(names)}</b><small>${l.vehicles.length} ${train ? 'train' : 'camion'}${l.vehicles.length > 1 ? 's' : ''} · ${l.stops.length} arrêts en boucle</small></span><i>›</i>`);
        row.onclick = () => this.openLine(l.id);
        card.append(row);
      }
      if (!lines.length) card.append(h('p', 'muted', `Remplis ${train ? 'cette gare' : 'ce dépôt'} par tapis, puis relie-${train ? 'la' : 'le'} : le ${train ? 'train' : 'camion'} charge ici les départs et dépose à l’autre bout, dans ses arrivées.`));
      body.append(card);
    } else {
      const isArr = this.stopTab === 'arr';
      const buf = isArr ? st.outBuf : st.inBuf, n = isArr ? arr : dep;
      const cells = this.chestCells(st, buf).filter((c) => c);
      const cols = 6;
      while (cells.length < Math.max(cols, Math.ceil(cells.length / cols) * cols)) cells.push(null);
      const c1 = h('div', 'card');
      c1.innerHTML = `<div class="sfill"><b>${isArr ? 'Arrivées' : 'Départs'}</b><span class="mp-bar"><span style="width:${Math.min(100, (n / cap) * 100)}%"></span></span><b>${fmt(n)} / ${cap}</b></div>
        <p class="muted small">${isArr ? `Déposé par les ${train ? 'trains' : 'camions'} ; ressort sur les tapis qui partent d’ici.` : `Apporté par les tapis ; part avec les ${train ? 'trains' : 'camions'}.`}</p>
        ${this.gridHtml(cells, cols)}`;
      body.append(c1);
    }
    sheet.append(body);
    const acts = h('div', 'macts');
    const others = [...f.machines.values()].filter((x) => x.type === st.type && x !== st);
    const link = h('button', 'btn primary', 'Relier');
    link.onclick = () => {
      if (!others.length) { this.toast(`Pose d’abord ${train ? 'une autre gare' : 'un autre dépôt'}`, 'info'); return; }
      this.closeSheet();
      this.openMap({
        title: train ? 'Choisis l’autre gare' : 'Choisis l’autre dépôt',
        sub: `${this.stationName(st)} : touche l’arrêt d’arrivée`,
        candidates: others,
        onPick: (to) => { const l = g.linkStations(st, to); if (l) this.openLine(l.id); },
      });
    };
    const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
    mv.onclick = () => { close(); this.startMove(st); };
    const turn = h('button', 'btn', `${ICONS.rotate}Tourner`);
    turn.onclick = () => { if (g.rotateStation(st)) this.refreshSheet(); };
    acts.classList.add('two');
    acts.append(link, turn, mv, this.deleteButton(st, 'Supprimer', 'Confirmer', close));
    sheet.append(acts);
  }


  private popKey = '';
  private popActions = '';

  /** Met à jour la bulle. Renvoie vrai si les boutons ont été recréés (il faut les rebrancher). */
  /** Tri : choisir l'objet qui part dans la dérivation d'un séparateur. */
  /**
   * Un séparateur, dessiné comme une machine : ce qui arrive à gauche, tout droit à droite, la dérivation sur son côté.
   * En auto, un objet sur deux de chaque côté ; avec Tri, on choisit l'objet qui seul part dans la dérivation.
   */
  /** Ce que trie un séparateur : un objet, ou une destination (« pour le Noyau »…), avec son icône. */
  private filterInfo(f: string): { name: string; icon: string } {
    const dest: Record<string, [string, string]> = { '@noyau': ['Pour le Noyau', 'noyau'], '@labo': ['Pour le Laboratoire', 'laboratoire'], '@comptoir': ['Pour le Comptoir', 'comptoir'], '@train': ['Pour le train de fret', 'depot'] };
    const d = dest[f];
    if (d) return { name: d[0], icon: this.machineIcons.get(d[1]) ?? '' };
    return { name: item(f).name, icon: this.itemIcons.get(f) ?? '' };
  }

  /** Les tris par destination : seulement ce qui manque encore au bâtiment (sans compter ce qui est déjà en route). */
  private destOptions(current: string | undefined): PickOpt[] {
    const g = this.game;
    const list: [string, string][] = [['@noyau', 'Ce qui manque à la mission du Noyau'], ['@labo', 'Ce qui manque au Laboratoire pour les déblocages']];
    if (g.order) list.push(['@comptoir', 'Ce qui manque à la commande du Comptoir']);
    if (g.freight) list.push(['@train', 'Ce qui manque à la commande du train']);
    return list.map(([id, sub]) => ({ id, label: this.filterInfo(id).name, sub, icon: this.filterInfo(id).icon, on: current === id, group: 'Destinations' }));
  }

  /**
   * La fenêtre d'une boîte (séparateur ou filtre), « la boussole » : la boîte au milieu, une tuile par côté
   * (entrée, sortie ou rien) et une pour l'autre étage ; on touche une tuile pour la régler en dessous.
   */
  private openNodeSheet(belt: Belt): void {
    this.closePopover();
    const g = this.game;
    const at = { x: belt.x, y: belt.y, z: belt.z ?? 0 };
    this.nodeSel = null;
    this.openSheet((sheet, close) => {
      const f = g.view;
      const b = f.beltAt(at.x, at.y, at.z);
      if (!b || !b.node) { close(); return; }
      const tri = b.node === 'tri';
      const sides = f.nodeSides(b);
      const outs = f.nodeOutputs(b);
      const nIn = [0, 1, 2, 3].filter((d) => sides[d] === 'in').length;
      if (this.nodeSel === null) this.nodeSel = outs.find((o) => o.d !== b.dir)?.d ?? b.dir;
      if (this.nodeSel === 4 && !g.levels2 && sides[4] === 'none') this.nodeSel = b.dir;
      const sel = this.nodeSel;
      const below = b.z ? 'dessous' : 'dessus';
      const NAME = ['Droite →', '↓ Bas', '← Gauche', '↑ Haut', b.z ? '⤓ Dessous' : '⤒ Dessus'];
      const OF = ['de droite', 'du bas', 'de gauche', 'du haut', `du ${below}`];
      const rules = b.rules ?? {};
      const restOuts = outs.filter((o) => !rules[o.d]?.length);
      sheet.classList.add('node-sheet');
      sheet.append(this.sheetHead(tri ? 'Filtre' : 'Séparateur',
        `${b.z ? '2ᵉ étage' : '1ᵉʳ étage'} · ${nIn} entrée${nIn > 1 ? 's' : ''}, ${outs.length} sortie${outs.length > 1 ? 's' : ''} sur 4`, close));
      // Séparateur ou filtre.
      const kinds = h('div', 'mtabs ns-kind');
      for (const [k, label] of [['sep', 'Séparateur'], ['tri', 'Filtre']] as const) {
        const locked = !g.isUnlocked('separateur');
        const bt = h('button', `mtab${b.node === k ? ' on' : ''}${locked ? ' locked' : ''}`, `${label}${locked ? ICONS.lock : ''}`);
        bt.onclick = () => { if (b.node !== k && g.placeNode(b, k)) this.refreshSheet(); };
        kinds.append(bt);
      }
      sheet.append(kinds);
      // Ce qu'une sortie envoie, en court, sur sa tuile.
      const what = (d: number): string => {
        if (!tri) return `<small>${outs.length > 1 ? `1 sur ${outs.length}` : 'tout'}</small>`;
        const r = rules[d];
        if (!r?.length) return '<small>le reste</small>';
        return r.slice(0, 3).map((t) => `<img src="${this.filterInfo(t).icon}" alt="">`).join('') + (r.length > 3 ? `<small>+${r.length - 3}</small>` : '');
      };
      const tile = (d: number): HTMLElement => {
        const st = sides[d] ?? 'none';
        const open = st === 'main' || st === 'out';
        const col = hexCss(nodeColor(b.dir, d));
        const body = st === 'in' ? '<b class="ns-in">Entrée</b>' : open ? `<span class="ns-what">${what(d)}</span>`
          : st === 'off' ? '<small>coupée</small>' : '<small>rien</small>';
        const el = h('button', `ns-tile ${st}${d === sel ? ' sel' : ''}`, `<span class="ns-name"${open ? ` style="color:${col}"` : ''}>${NAME[d]}</span>${body}`);
        if (open) el.style.borderColor = col;
        if (d === sel) el.style.boxShadow = `0 0 0 4px ${open ? col : '#9AAFA4'}40`;
        el.onclick = () => { this.nodeSel = d; this.refreshSheet(); };
        return el;
      };
      const cross = h('div', 'ns-cross');
      const center = h('div', 'ns-center', `${tri ? BELT_ICONS.tri : BELT_ICONS.sep}<small>${tri ? 'Filtre' : 'Séparateur'}</small>`);
      const tag = h('div', 'ns-tag', `<span>${b.z ? '2ᵉ étage' : '1ᵉʳ étage'}</span>`);
      // L'autre étage : seulement avec les ascenseurs (ou s'il y a déjà un tapis là).
      const vert = g.levels2 || sides[4] !== 'none';
      cross.append(h('div', ''), tile(3), tag, tile(2), center, tile(0), h('div', ''), tile(1), vert ? tile(4) : h('div', ''));
      sheet.append(cross);
      // Le réglage du côté choisi.
      const st = sides[sel] ?? 'none';
      const open = st === 'main' || st === 'out';
      const col = open ? hexCss(nodeColor(b.dir, sel)) : '#9AAFA4';
      const ed = h('div', 'card ns-edit');
      const next = outs.find((o) => o.d === sel)?.next;
      const to = !next ? '' : next.kind === 'machine' ? `vers ${esc(machineDef(next.machine.type).name.toLowerCase())}` : (next.belt.z ?? 0) !== (b.z ?? 0) ? `vers le tapis du ${below}` : 'vers un tapis';
      ed.append(h('div', 'ns-ed-head', `<span class="ns-dot" style="background:${col}"></span><b>${st === 'in' ? 'Entrée' : 'Sortie'} ${OF[sel]}</b>${to ? `<small>${to}</small>` : ''}`));
      const seg = (opts: [string, boolean, () => void][]) => {
        const row = h('div', 'mtabs');
        for (const [label, on, act] of opts) {
          const bt = h('button', `mtab${on ? ' on' : ''}`, label);
          bt.onclick = () => { if (!on) act(); };
          row.append(bt);
        }
        ed.append(row);
      };
      const hint = (t: string) => ed.append(h('p', 'ns-hint', t));
      if (st === 'in') hint('Un tapis arrive par ici : ses objets entrent dans la boîte. Une boîte prend autant d’entrées que tu veux.');
      else if (st === 'none') hint(sel === 4
        ? `Pas de tapis au ${below} de cette case. Fais-y passer un tapis de l’autre étage : la boîte pourra lui envoyer des objets.`
        : 'Rien de ce côté. Avec l’outil Tapis, glisse depuis la boîte vers ce côté (ou colle une machine) : ce tapis devient une sortie.');
      else {
        if (st === 'main') hint('Tout droit : la sortie principale, toujours ouverte.');
        else seg([
          ['Sortie', st === 'out', () => { if (g.setNodeOutput(b, sel, true)) this.refreshSheet(); }],
          ['Rien', st === 'off', () => { g.setNodeOutput(b, sel, false); this.refreshSheet(); }],
        ]);
        if (st === 'off') hint(`Coupée : rien ne part ${sel === 4 ? `au ${below}` : 'par ici'}, même si un tapis part de ce côté.`);
      }
      if (open && !tri) hint(outs.length > 1 ? `Chacun son tour : un objet sur ${outs.length} part par ici. Si une sortie est pleine, l’objet prend la suivante.` : 'Tout passe par ici pour l’instant : trace des tapis qui partent de la boîte (jusqu’à 4 sorties) pour partager.');
      if (open && tri) {
        const list = rules[sel] ?? [];
        const add = () => {
          const count = new Map<string, number>();
          for (const c of f.chainOf(b)) for (const it of c.items) count.set(it.t, (count.get(it.t) ?? 0) + 1);
          const seen = [...count.entries()].sort((p, q) => q[1] - p[1]).map(([t]) => t);
          const order = [...new Set([...seen, ...Object.keys(g.factory.stats.made), ...ITEM_LIST.map((x) => x.id)])].filter((id) => !FLUIDS.has(id));
          const opts: PickOpt[] = this.destOptions(undefined).map((o) => ({ ...o, on: list.includes(o.id!) }));
          for (const t of order) opts.push({ id: t, label: item(t).name, icon: this.itemIcons.get(t), on: list.includes(t), group: seen.includes(t) ? 'Sur ce tapis' : 'Autres objets' });
          this.openPicker(`Sortie ${OF[sel]}`, 'Ce qui part par ici. Touche encore un objet coché pour l’enlever.', opts, (t) => {
            if (!t) return;
            g.setNodeRule(b, sel, list.includes(t) ? list.filter((x) => x !== t) : [...list, t]);
            this.refreshSheet();
          });
        };
        seg([
          ['Seulement…', list.length > 0, add],
          ['Le reste', list.length === 0, () => { g.setNodeRule(b, sel, null); this.refreshSheet(); }],
        ]);
        if (list.length) {
          const chips = h('div', 'ns-chips');
          for (const t of list) {
            const info = this.filterInfo(t);
            const c = h('button', 'ns-chip', `<img src="${info.icon}" alt=""><span>${esc(t.startsWith('@') ? info.name : item(t).name)}</span><i>×</i>`);
            c.onclick = () => { g.setNodeRule(b, sel, list.filter((x) => x !== t)); this.refreshSheet(); };
            chips.append(c);
          }
          const plus = h('button', 'ns-chip add', '+');
          plus.setAttribute('aria-label', 'Ajouter un objet');
          plus.onclick = add;
          chips.append(plus);
          ed.append(chips);
          hint(list.some((t) => t.startsWith('@')) ? 'Une destination : seulement ce qui lui manque encore (sans compter ce qui est déjà en route).' : 'Touche un objet pour l’enlever. Ceux qui ne sont choisis nulle part vont dans « le reste ».');
        } else {
          const others = restOuts.filter((o) => o.d !== sel).length;
          hint(restOuts.length === outs.length
            ? 'Rien n’est encore trié : tout se partage entre les sorties. Choisis « Seulement… » pour qu’un objet parte par ici.'
            : `Ce qui n’est choisi par aucune autre sortie part par ici${others ? `, chacun son tour avec ${others} autre${others > 1 ? 's' : ''} sortie${others > 1 ? 's' : ''}` : ''}.`);
        }
      }
      sheet.append(ed);
      const acts = h('div', 'row');
      const del = h('button', 'btn danger', `${ICONS.trash}Retirer · ${ICONS.coinSm}${RULES.nodeCost}`);
      del.onclick = () => { g.removeNode(b); close(); };
      const ok = h('button', 'btn primary', 'Terminé');
      ok.onclick = close;
      acts.append(del, ok);
      sheet.append(acts);
    }, true);
    this.sheetKind = 'splitter';
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

  /** Onglet ouvert dans la page des succès. */

  private achTab: 'skins' | 'tiers' | 'once' = 'skins';

  /** Les succès et les skins qu'ils donnent : choisir le skin du robot, voir les paliers et les succès uniques. */
  openAchievements(tab?: 'skins' | 'tiers' | 'once'): void {
    const g = this.game;
    if (tab) this.achTab = tab;
    this.openSheet((sheet, close) => {
      sheet.classList.add('ach-sheet');
      const owned = SKINS.filter((s) => g.ownsSkin(s.id)).length;
      const n = ACHIEVEMENTS.filter((a) => g.achievements.has(a.id)).length;
      sheet.append(this.sheetHead('Succès', esc(`${n} sur ${ACHIEVEMENTS.length} · ${owned} skins sur ${SKINS.length}. Chaque succès donne un skin au robot.`), close));
      const tabs = h('div', 'mtabs');
      const body = h('div', 'mtab-body ach-body');
      const render = () => {
        tabs.innerHTML = '';
        for (const [id, label] of [['skins', 'Skins'], ['tiers', 'À paliers'], ['once', 'Uniques']] as const) {
          const b = h('button', `mtab${this.achTab === id ? ' on' : ''}`, label);
          b.onclick = () => { if (this.achTab !== id) { this.achTab = id; render(); } };
          tabs.append(b);
        }
        body.innerHTML = '';
        if (this.achTab === 'skins') this.achSkins(body, render);
        else if (this.achTab === 'tiers') this.achTiers(body, render);
        else this.achOnce(body);
      };
      render();
      sheet.append(tabs, body);
    });
  }

  /** Porter un skin gagné (ou dire comment le gagner). */
  private wearSkin(id: string, done: () => void): void {
    const g = this.game;
    if (g.setSkin(id)) { this.toast(`${g.look.name} porte maintenant : ${skinOf(id).name}`, 'good'); done(); return; }
    const a = ACHIEVEMENT_OF_SKIN[id];
    if (a) this.toast(`${skinOf(id).name} : succès « ${a.name} » · ${a.hint}`, 'info');
  }

  /** Onglet Skins : tous les skins, le porté entouré ; toucher un skin gagné le met au robot. */
  private achSkins(body: HTMLElement, redraw: () => void): void {
    const g = this.game;
    const grid = h('div', 'skin-grid');
    const order = [...SKINS].sort((a, b) => Number(g.ownsSkin(b.id)) - Number(g.ownsSkin(a.id)));
    for (const s of order) {
      const own = g.ownsSkin(s.id), worn = g.look.skin === s.id;
      const a = ACHIEVEMENT_OF_SKIN[s.id];
      const card = h('button', `skin-card r-${s.rarity}${own ? '' : ' locked'}${worn ? ' worn' : ''}`);
      card.innerHTML = `<span class="sk-pic">${skinSvg(s.id, { look: g.look, gray: !own, anim: own })}</span>`
        + `<b>${esc(s.name)}</b><small>${worn ? 'Porté' : own ? RARITY_NAME[s.rarity] : esc(a ? a.name : '')}</small>`;
      card.onclick = () => this.wearSkin(s.id, redraw);
      grid.append(card);
    }
    body.append(grid);
  }

  /** Onglet À paliers : chaque famille, sa progression vers le prochain palier et ses 4 skins. */
  private achTiers(body: HTMLElement, redraw: () => void): void {
    const g = this.game;
    for (const f of FAMILIES) {
      const have = f.value(g);
      const owns = f.goals.map((_, i) => g.achievements.has(`${f.id}${i + 1}`));
      const first = owns.indexOf(false);
      const done = first < 0 ? 4 : first;
      const next = f.goals[Math.min(done, 3)], prev = done ? f.goals[done - 1] : 0;
      const frac = done === 4 ? 1 : Math.max(0, Math.min(1, (have - prev) / (next - prev)));
      const card = h('div', 'card tier-card');
      card.style.setProperty('--fam', f.color);
      card.innerHTML = `<div class="tier-head"><b>${esc(f.name)}</b><small>${done === 4 ? `${fmtNum(have)} ${f.unit} · complet` : `${fmtNum(have)} / ${fmtNum(next)} ${f.unit}`}</small></div>`
        + `<div class="tier-bar"><i style="width:${(frac * 100).toFixed(1)}%"></i></div><p class="tier-what">${esc(f.what)}</p>`;
      const row = h('div', 'tier-skins');
      f.skins.forEach((sid, i) => {
        const own = owns[i];
        const b = h('button', `tier-skin${own ? ' own' : ''}${i === done ? ' next' : ''}${g.look.skin === sid ? ' worn' : ''}`);
        b.innerHTML = `${skinSvg(sid, { gray: !own, anim: own })}<small>${ROMAN[i]} · ${shortNum(f.goals[i])}</small>${own ? '<em>✓</em>' : ''}`;
        b.onclick = () => this.wearSkin(sid, redraw);
        row.append(b);
      });
      card.append(row);
      body.append(card);
    }
  }

  /** Onglet Uniques : les grandes étapes, chacune son skin. */
  private achOnce(body: HTMLElement): void {
    const g = this.game;
    const card = h('div', 'card ach');
    for (const a of UNIQUE_ACHIEVEMENTS) {
      const done = g.achievements.has(a.id);
      const row = h('div', `ach-row once${done ? ' done' : ''}`);
      row.innerHTML = `<span class="ach-skin">${skinSvg(a.skin, { gray: !done, anim: done })}</span><div><b>${esc(a.name)}</b><small>${esc(a.hint)}</small><small class="ach-gives">${done ? '✓ ' : ''}Skin : ${esc(skinOf(a.skin).name)} · ${RARITY_NAME[a.rarity]}</small></div>`;
      card.append(row);
    }
    body.append(card);
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
    // La languette : on voit qu'on peut tirer la fenêtre vers le bas pour la fermer.
    const full = (s: HTMLElement, c: () => void) => { s.append(h('div', 'sheet-grab')); build(s, c); };
    full(sheet, close);
    swipeToClose(sheet, back, () => { if (this.overlay === back) close(); });
    this.root.append(back);
    this.overlay = back;
    this.sheetBuild = live ? full : null;
    this.sheetDirty = false;
  }

  /** Reconstruit la feuille ouverte (livraisons en cours), en gardant le défilement. */
  private refreshSheet(): void {
    const back = this.overlay, build = this.sheetBuild;
    if (!back || !build) return;
    const sheet = back.firstElementChild as HTMLElement;
    // Pas pendant qu'on la tire vers le bas : le doigt perdrait son élément (et la fin du geste).
    if (sheet.dataset.dragging || this.portDragging) { this.sheetDirty = true; return; }
    const top = sheet.scrollTop, inner = sheet.querySelector('.mtab-body')?.scrollTop ?? 0;
    sheet.innerHTML = '';
    build(sheet, () => this.closeSheet());
    sheet.scrollTop = top;
    const body = sheet.querySelector('.mtab-body');
    if (body) body.scrollTop = inner;
  }

  private closeSheet(): void {
    this.closeModal();
    if ((this.sheetKind === 'machine' || this.sheetKind === 'chest') && this.popover.classList.contains('hidden')) this.r.selection = null;
    this.overlay?.remove();
    this.overlay = null;
    this.sheetBuild = null;
    this.sheetKind = '';
  }

  // ---------- Grandes fenêtres de choix ----------

  private modal: HTMLElement | null = null;

  /**
   * Une grande fenêtre sur presque tout l'écran, au-dessus de la fenêtre du bas : pour choisir dans une liste.
   * `build` remplit le corps ; `rebuild` le refait (en gardant le défilement).
   */
  private openModal(title: string, sub: string, build: (body: HTMLElement, close: () => void, rebuild: () => void) => void, foot?: (bar: HTMLElement, close: () => void) => void): void {
    this.closeModal();
    const back = h('div', 'pick-back');
    const box = h('div', 'pick-modal');
    back.append(box);
    const close = () => { if (this.modal === back) this.closeModal(); };
    box.append(this.sheetHead(title, sub, close));
    const body = h('div', 'pick-body');
    box.append(body);
    const rebuild = () => { const top = body.scrollTop; body.innerHTML = ''; build(body, close, rebuild); body.scrollTop = top; };
    build(body, close, rebuild);
    if (foot) { const bar = h('div', 'pick-foot'); foot(bar, close); box.append(bar); }
    // Le toucher qui l'ouvre ne doit pas la refermer (clic fantôme).
    const opened = performance.now();
    back.addEventListener('click', (e) => {
      if (performance.now() - opened < 400) { e.stopPropagation(); e.preventDefault(); return; }
      if (e.target === back) close();
    }, true);
    this.root.append(back);
    this.modal = back;
  }

  private closeModal(): void {
    this.modal?.remove();
    this.modal = null;
  }

  /**
   * Choisir une option dans une grande liste : le choix actuel coché, des groupes, une recherche s'il y en a beaucoup.
   * Toucher une ligne choisit et referme.
   */
  private openPicker(title: string, sub: string, opts: PickOpt[], pick: (id: string | null) => void): void {
    const searchable = opts.filter((o) => o.icon).length > 10;
    let query = '';
    this.openModal(title, sub, (body, close) => {
      let list: HTMLElement;
      const fill = () => {
        list.innerHTML = '';
        const q = query.trim().toLowerCase();
        let group = '';
        for (const o of opts) {
          if (q && !o.label.toLowerCase().includes(q) && o.id !== null) continue;
          if (o.group && o.group !== group) { group = o.group; list.append(h('p', 'pick-group', esc(group))); }
          const row = h('button', `pick-row${o.on ? ' on' : ''}${o.danger ? ' danger' : ''}`, `${o.badge ?? (o.icon ? `<img class="pi" src="${o.icon}" alt="">` : '')}<span class="pl"><b>${esc(o.label)}</b>${o.sub ? `<small>${o.sub}</small>` : ''}</span>${o.on ? CHECK_SM : ''}`);
          row.onclick = () => { close(); pick(o.id); };
          list.append(row);
        }
      };
      if (searchable) {
        const input = h('input', 'pick-search') as HTMLInputElement;
        input.type = 'search';
        input.placeholder = 'Chercher un objet';
        input.value = query;
        input.oninput = () => { query = input.value; fill(); };
        body.append(input);
      }
      list = h('div', 'pick-list');
      body.append(list);
      fill();
      // Le choix actuel est visible tout de suite.
      requestAnimationFrame(() => list.querySelector('.pick-row.on')?.scrollIntoView({ block: 'center' }));
    });
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
  /** La pastille du train de fret, sous la mission : où il en est et ce qu'il manque. */
  private freightSeen: { phase: string; t: number } | null = null;

  private refreshFreight(): void {
    const fr = this.game.freight, p = this.freightPill;
    p.classList.toggle('hidden', !fr || !!this.game.inAtelier);
    if (!fr) return;
    // On prévient : une minute avant l'arrivée, puis à l'arrivée (bannière et pastille qui clignote).
    const prev = this.freightSeen;
    if (prev && prev.phase === 'away' && fr.phase === 'here') this.freightBanner('Le train de fret est à quai !', `Il repart dans ${clock(fr.t)} : remplis son coffre.`);
    if (prev && prev.phase === 'away' && fr.phase === 'away' && prev.t > 60 && fr.t <= 60) this.freightBanner('Le train arrive dans 1 minute', 'Prépare sa commande sur le quai.');
    this.freightSeen = { phase: fr.phase, t: fr.t };
    const left = Object.values(this.game.freightMissing()).reduce((a, n) => a + n, 0);
    const total = Object.values(fr.req).reduce((a, n) => a + n, 0) || 1;
    const here = fr.phase === 'here';
    const urgent = here && left > 0 && fr.t < 120;
    p.classList.toggle('here', here);
    p.classList.toggle('urgent', urgent);
    p.innerHTML = `${ICONS.transport}<span>${here ? `À quai · part dans <b>${clock(fr.t)}</b>` : `Train dans <b>${clock(fr.t)}</b>`}</span><span class="fp-bar"><span style="width:${Math.round((1 - left / total) * 100)}%"></span></span><small>${left ? `${left} à livrer` : 'prêt'}</small>`;
  }

  /** Une bannière en haut de l'écran pour l'arrivée du train (elle s'en va seule), et la pastille qui clignote. */
  private freightBanner(title: string, text: string): void {
    if (this.game.inAtelier) return;
    this.root.querySelector('.freight-banner')?.remove();
    const b = h('div', 'freight-banner');
    b.innerHTML = `<span class="fb-ico">${ICONS.transport}</span><span class="fb-txt"><b>${esc(title)}</b><small>${esc(text)}</small></span>`;
    const see = h('button', 'btn primary', 'Voir');
    see.onclick = () => { b.remove(); const q = this.game.quai(); this.r.focusOn(q.x + q.w / 2, q.y + q.h / 2, 0.9); };
    b.append(see);
    b.onclick = (e) => { if (e.target === b) b.remove(); };
    this.root.append(b);
    this.freightPill.classList.remove('flash');
    void this.freightPill.offsetWidth;
    this.freightPill.classList.add('flash');
    window.setTimeout(() => { b.classList.add('out'); window.setTimeout(() => b.remove(), 400); }, 7000);
    window.setTimeout(() => this.freightPill.classList.remove('flash'), 6000);
    navigator.vibrate?.(120);
  }

  /** La fenêtre qui présente le train de fret (une seule fois, après 10 minutes de jeu). */
  private openFreightIntro(): void {
    const g = this.game;
    this.openSheet((sheet, close) => {
      const fr = g.freight!;
      sheet.append(this.sheetHead('Le train de fret', fr.phase === 'here' ? 'Il est à quai !' : `Il arrive dans ${clock(fr.t)}`, close));
      const card = h('div', 'card');
      card.innerHTML = `<p><b>Un gros train vient chercher des matériaux</b> sur le Quai, sous le Noyau. Il sort du tunnel, reste <b>10 minutes</b> à quai, puis repart pendant <b>10 minutes</b> : il revient toutes les 20 minutes.</p>
        <p>Sa commande est annoncée à l’avance : relie des tapis au Quai pour remplir son coffre (avant qu’il arrive ou pendant qu’il est là).</p>
        <div class="freight-deal"><div class="fd-row good"><b>Tout livré</b><span>une prime</span></div><div class="fd-row bad"><b>Il manque quelque chose</b><span>une amende fixe</span></div></div>
        <p class="muted small">L’amende est annoncée avec la commande. Sans assez de pièces, le train prend le reste dans tes coffres.</p>
        ${this.costRows(Object.entries(fr.req).map(([k, v]) => [k, g.quai().inBuf[k] ?? 0, v]))}`;
      sheet.append(card);
      const row = h('div', 'row');
      const see = h('button', 'btn', 'Voir le quai');
      see.onclick = () => {
        close();
        const q = g.quai();
        this.r.focusOn(q.x + q.w / 2, q.y + q.h / 2, 0.9);
      };
      const ok = h('button', 'btn primary', 'Compris');
      ok.onclick = close;
      row.append(see, ok);
      sheet.append(row);
    }, true);
    this.sheetKind = 'freight';
  }

  /** Le Quai du train : la commande, le compte à rebours, la prime et l'amende annoncées. */
  openFreight(): void {
    this.closePopover();
    const g = this.game;
    if (!g.freight) return;
    this.openSheet((sheet, close) => {
      const fr = g.freight!;
      const q = g.quai();
      const here = fr.phase === 'here';
      sheet.append(this.sheetHead('Train de fret', here ? `À quai : il repart dans ${clock(fr.t)}` : `En route : il arrive dans ${clock(fr.t)}, puis reste 10 minutes à quai`, close));
      const card = h('div', 'card');
      card.innerHTML = `<p><b>Commande n° ${fr.visit}</b></p>${this.costRows(Object.entries(fr.req).map(([k, v]) => [k, q.inBuf[k] ?? 0, v]))}
        <p class="muted">Relie des tapis au Quai : son coffre garde la commande jusqu’au départ du train (tu peux le remplir avant qu’il arrive).</p>`;
      sheet.append(card);
      const deal = h('div', 'card freight-deal');
      deal.innerHTML = `<div class="fd-row good"><b>Tout livré</b><span>+${fmt(fr.reward)} pièces</span></div>
        <div class="fd-row bad"><b>Il manque quelque chose</b><span>amende de ${fmt(fr.fine)} pièces</span></div>
        <p class="muted small">L’amende est fixe. Si tu n’as pas assez de pièces, le train prend le reste dans tes coffres.${fr.streak > 1 ? ` · ${fr.streak} trains pleins d’affilée` : ''}</p>`;
      sheet.append(deal);
      if (fr.last) {
        const l = fr.last;
        const last = h('div', 'card');
        last.innerHTML = `<p class="muted small">Dernier train : ${l.ok ? `parti plein, +${fmt(l.reward)} pièces` : `parti avec ${l.missing} objets manquants, ${fmt(l.paid)} pièces d’amende${l.taxed ? ` et ${l.taxed} objets pris dans tes coffres` : ''}`}.</p>`;
        sheet.append(last);
      }
    }, true);
    this.sheetKind = 'freight';
  }

  openNoyau(): void {
    this.closePopover();
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
        <p class="muted">Relie un tapis au Noyau : il prend ce que demande sa mission.</p>`;
      sheet.append(card);
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
    const g = this.game;
    this.openSheet((sheet, close) => {
      sheet.append(this.sheetHead('Laboratoire', 'Il ne prend que ce qu’il faut encore pour les déblocages possibles à ce palier.', close));
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
      st.innerHTML = `<p class="muted">En stock</p>${stock.length ? `<div class="chips">${this.chips(Object.fromEntries(stock))}</div>` : '<p class="muted">Vide. Relie-lui un tapis.</p>'}`;
      sheet.append(st);
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
    const g = this.game;
    if (!g.order && g.choices.length === 0) g.refreshChoices();
    this.openSheet((sheet, close) => {
      if (g.order) {
        sheet.append(this.sheetHead('Comptoir', 'Commande en cours : relie un tapis au Comptoir.', close));
        sheet.append(h('div', 'card', this.orderCardHtml(g.order, true)));
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
      panel.prepend(h('div', 'sheet-grab'));
      swipeToClose(panel, back, () => { if (this.overlay === back) close(); });
      back.append(panel);
    }).catch(() => { close(); this.toast('Export impossible sur ce navigateur', 'warn'); });
  }

  // ---------- Pause ----------

  /** En pause : le jeu ne tourne plus (rien ne se passe non plus quand le jeu est fermé). */
  paused = false;
  private pauseEl: HTMLElement | null = null;

  /**
   * Pause : une grande icône au milieu. Toucher n'importe où relance.
   * (Aussi d'office quand on quitte la fenêtre.)
   */
  setPaused(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    if (on) {
      this.cancelGestures();
      const el = h('div', 'pause-screen', `<div class="pause-mid"><span class="pause-ico">${PAUSE_ICON}</span><b>Pause</b><small>Touche n’importe où pour reprendre</small></div>`);
      // Le toucher qui relance ne doit rien faire d'autre (ni sur la carte, ni sur un bouton).
      const resume = (e: Event) => { e.preventDefault(); e.stopPropagation(); this.setPaused(false); };
      el.addEventListener('pointerdown', resume);
      el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
      document.body.append(el);
      this.pauseEl = el;
      this.cb.onPause();
    } else {
      this.pauseEl?.remove();
      this.pauseEl = null;
    }
  }

  /** Un tracé ou un glisser en cours est abandonné (la pause arrive au milieu). */
  private cancelGestures(): void {
    if (this.dragAt || this.tracer || this.cableTracer) this.toolEnd(true);
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
    this.freightT += dt;
    if (this.freightT > 0.5 && this.game.freight) {
      this.freightT = 0;
      // Au bout de 10 minutes de jeu (le premier train arrive à 20), une fenêtre explique le train.
      const fr = this.game.freight;
      if (!fr.explained && this.game.played >= 600 && !this.overlay && !this.tree.isOpen && !this.r.introRunning && !this.game.inAtelier && !this.root.querySelector('.gift-card, .move-banner')) {
        fr.explained = true;
        this.openFreightIntro();
      }
      this.refreshFreight();
      if (this.sheetKind === 'freight' && this.overlay) this.sheetDirty = true;
    }
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
    // Fenêtres en grand : les barres avancent à chaque image, le reste chaque seconde.
    if (this.sheetKind && this.overlay) {
      // Fenêtre d'une machine : la pièce en cours et le charbon qui brûle avancent en continu.
      this.overlay.querySelectorAll<HTMLElement>('[data-mp]').forEach((bar) => {
        const mm = this.game.view.machines.get(Number(bar.dataset.mp));
        if (mm) bar.style.width = `${this.machProgress(mm) * 100}%`;
      });
      this.overlay.querySelectorAll<HTMLElement>('[data-burn]').forEach((bar) => {
        const mm = this.game.view.machines.get(Number(bar.dataset.burn));
        if (!mm) return;
        const per = RULES.coalMachineSeconds * (machineDef(mm.type).coalMult ?? 1), max = mm.burn > per ? per * RULES.carburantMult : per;
        bar.style.width = `${Math.min(1, Math.max(0, mm.burn) / max) * 100}%`;
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
