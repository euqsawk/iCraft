// Interface en HTML par-dessus le jeu, et logique des outils (tracer, poser, gommer, déplacer).
import { BIOME_COLORS, CELL, PALETTE, RULES } from '../config.ts';
import { item, itemLabel, ITEM_LIST } from '../data/items.ts';
import { BUILDABLE, machineDef, type MachineDef } from '../data/machines.ts';
import type { Gestures, GestureHandlers } from '../input/gestures.ts';
import type { GameRenderer } from '../render/renderer.ts';
import type { Machine } from '../sim/factory.ts';
import { DEFAULT_ORDER, DRONE_PRIORITIES, Game, type DronePriority, type GameEvent, type OfflineReport } from '../sim/game.ts';
import { PRIO_ICONS } from './prioIcons.ts';
import { RARITY_LABEL, type Order } from '../sim/orders.ts';
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

type Tool = 'none' | 'tapis' | 'machine' | 'gomme' | 'move';

const STATUS_TEXT: Record<string, string> = {
  idle: 'En attente',
  working: 'En marche',
  blocked: 'Sortie pleine : branche un tapis ou vide la suite',
  nofuel: 'Plus de charbon : le voyant clignote, un drone va en apporter',
  noinput: 'Il manque un ingrédient',
  noore: 'Pas de filon dessous',
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

export class Hud implements GestureHandlers {
  private root: HTMLElement;
  private game: Game;
  private r: GameRenderer;
  private cb: HudCallbacks;
  private tool: Tool = 'none';
  private machineType: string | null = null;
  private moving: Machine | null = null;
  private tracer: BeltTracer | null = null;
  private lastErase: { x: number; y: number } | null = null;
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
  private palette!: HTMLElement;
  private toolButtons = new Map<string, HTMLButtonElement>();
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
    mm.onclick = () => { this.r.centerOnRobot(); this.closePopover(); };
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
      const b = h('button', `tool${locked ? ' locked' : ''}`, `${icon}${label}${locked ? ICONS.lock : ''}`);
      b.onclick = () => this.pickTool(id, locked);
      this.toolButtons.set(id, b);
      toolbar.append(b);
    }

    this.bubble = h('div', 'bubble hidden');
    this.popover = h('div', 'popover hidden');
    this.toasts = h('div', 'toasts');
    this.root.append(top, row, this.palette, toolbar, this.bubble, this.popover, this.toasts);
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
      case 'unlock': this.renderPalette(); this.refreshLevel(); this.sheetDirty = true; break;
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

  private refreshLevel(): void {
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

  private renderPalette(): void {
    const p = this.palette;
    p.innerHTML = '';
    const placed = new Set([...this.game.factory.machines.values()].map((x) => x.type));
    // Le Laboratoire et le Comptoir viennent en tête ; une fois posés, ils disparaissent de la liste.
    if (this.machineType && machineDef(this.machineType).unique && placed.has(this.machineType)) this.machineType = 'foreuse';
    for (const m of BUILDABLE) {
      if (!this.game.hasMachine(m.id)) continue;
      if (m.gift || (m.unique && placed.has(m.id))) continue;
      const b = h('button', `mcard${this.machineType === m.id ? ' selected' : ''}`);
      b.innerHTML = `<img src="${this.machineIcons.get(m.id)}" alt="">${esc(m.name)}<small>${ICONS.coinSm}${m.cost}</small>`;
      b.onclick = () => {
        if (this.dragEnded) return;
        this.machineType = m.id;
        this.renderPalette();
        this.toast(`${m.name} : glisse-la sur la carte, ou touche la carte pour la poser`, 'info');
      };
      b.addEventListener('pointerdown', (e) => this.cardDown(e, m.id, b));
      p.append(b);
    }
    // Dernière carte : l'arbre, pour débloquer d'autres machines.
    const ready = this.game.unlockableCount();
    const more = h('button', 'mcard more', `<span style="width:40px;height:40px;display:flex">${NODE_ICONS.assembleur}</span>Débloquer<small>${ready ? `${ready} prêt${ready > 1 ? 's' : ''}` : `Palier ${this.game.palier}`}</small>`);
    more.onclick = () => this.openTree('production');
    p.append(more);
  }

  // ---------- Glisser une machine depuis la palette ----------

  private dragEnded = false;

  /** Glisser une carte vers le haut : la machine suit le doigt, la lâcher sur la carte la pose. */
  private cardDown(e: PointerEvent, type: string, card: HTMLElement): void {
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    const paletteTop = () => this.palette.getBoundingClientRect().top;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!dragging) {
        if (dy < -12 && Math.abs(dy) > Math.abs(dx)) {
          dragging = true;
          this.machineType = type;
          this.palette.querySelectorAll('.mcard').forEach((c) => c.classList.toggle('selected', c === card));
          this.palette.classList.add('dragging');
          this.closePopover();
        } else return;
      }
      ev.preventDefault();
      if (ev.clientY > paletteTop() - 8) {
        this.r.preview = null;
        this.r.guides = [];
        this.showBubble(ev.clientX, ev.clientY - 70, 'Lâche sur la carte pour poser', true);
      } else {
        this.updatePlacement(ev.clientX, ev.clientY);
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (!dragging) return;
      this.palette.classList.remove('dragging');
      this.dragEnded = true;
      setTimeout(() => { this.dragEnded = false; }, 350);
      const pv = this.r.preview;
      if (ev.type === 'pointerup' && pv?.kind === 'place' && pv.ok && ev.clientY < paletteTop() - 8) {
        this.game.placeMachine(type, pv.x, pv.y);
      }
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
        cable: 'Câbles et électricité : prochaine étape',
        transport: 'Camions et trains : bientôt',
        module: 'Modules : bientôt',
      };
      this.toast(msg[id] ?? 'Bientôt', 'info');
      return;
    }
    const t = id as Tool;
    this.setTool(this.tool === t ? 'none' : t);
  }

  private setTool(t: Tool): void {
    this.tool = t;
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', id === t);
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
    return this.tool !== 'none' && !this.r.introRunning;
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
    const f = this.game.factory;
    const m = f.machineAt(cx, cy);
    const rb = this.game.robot;
    if (Math.hypot(w.x - rb.x, w.y - (rb.y - 0.6)) < 0.9) { this.openRobot(); return; }
    if (m?.type === 'noyau') { this.closePopover(); this.openNoyau(); return; }
    if (m?.built && m.type === 'comptoir') { this.closePopover(); this.openOrders(); return; }
    if (m?.built && m.type === 'laboratoire') { this.closePopover(); this.openLab(); return; }
    if (m?.built && m.type === 'coffre') { this.openChest(m); return; }
    if (m?.built && m.type === 'revente') { this.openSell(m); return; }
    if (m?.built && (machineDef(m.type).kind === 'crafter' || machineDef(m.type).kind === 'drill')) { this.openMachine(m); return; }
    if (m) { this.select({ kind: 'machine', id: m.id }); return; }
    const b = f.beltAt(cx, cy);
    if (b) { this.select({ kind: 'belt', x: cx, y: cy }); return; }
    if (!this.popover.classList.contains('hidden')) { this.closePopover(); return; }
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
    const check = this.game.factory.checkMachine(type, p.x, p.y, this.moving ?? undefined, true);
    this.r.preview = { kind: 'place', type, x: p.x, y: p.y, ok: check.ok, ore: check.ore };
    // Guides d'alignement avec les machines voisines.
    const cx = (p.x + def.w / 2) * CELL, cy = (p.y + def.h / 2) * CELL;
    const guides: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const m of this.game.factory.machines.values()) {
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
    const label = this.tool === 'move' ? `Déplacer ici${onBelt}` : check.ok ? `${def.name} · ${ICONS.coinSm}${def.cost}${onBelt}` : esc(check.reason ?? 'Impossible');
    this.showBubble(s.x, s.y - 8, label, !check.ok);
  }

  private showBubble(x: number, y: number, html: string, bad: boolean): void {
    const b = this.bubble;
    b.innerHTML = html;
    b.classList.remove('hidden');
    b.classList.toggle('bad', bad);
    b.style.left = `${Math.min(window.innerWidth - 70, Math.max(70, x))}px`;
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

  toolStart(sx: number, sy: number): void {
    this.closePopover();
    if (this.tool === 'tapis' || this.tool === 'gomme') this.updateLoupe(sx, sy);
    const w = this.worldAt(sx, sy);
    if (this.tool === 'tapis') {
      this.tracer = new BeltTracer(this.game.factory, w.x, w.y);
      this.r.preview = { kind: 'trace', tracer: this.tracer };
    } else if (this.tool === 'machine' || this.tool === 'move') {
      this.updatePlacement(sx, sy);
    } else if (this.tool === 'gomme') {
      this.lastErase = null;
      this.erase(w.x, w.y);
    }
  }

  toolMove(sx: number, sy: number): void {
    const w = this.worldAt(sx, sy);
    if (this.tool === 'tapis' || this.tool === 'gomme') this.updateLoupe(sx, sy);
    if (this.tool === 'tapis' && this.tracer) {
      this.tracer.move(w.x, w.y);
      const n = this.tracer.newCount;
      const ok = this.tracer.valid && !this.tracer.blocked;
      const affordable = this.game.money >= n;
      const what = this.tracer.splitFrom ? 'Séparateur · ' : '';
      if (this.tracer.linkBelt) {
        this.showBubble(sx, sy - 56, 'Lâche pour relier la machine à ce tapis', false);
        return;
      }
      if (this.tracer.intoMachine !== null) {
        this.showBubble(sx, sy - 56, 'Lâche pour que le tapis nourrisse cette machine', false);
        return;
      }
      const locked = !!this.tracer.splitFrom && !this.game.isUnlocked('separateur');
      const label = locked ? 'Séparateur : à débloquer dans l’arbre' : n > 0 ? `${what}${n} case${n > 1 ? 's' : ''} · ${ICONS.coinSm}${n}` : this.tracer.splitFrom ? 'Glisse sur le côté pour séparer' : 'Glisse pour tracer';
      this.showBubble(sx, sy - 56, label, locked || !ok || !affordable);
    } else if (this.tool === 'machine' || this.tool === 'move') {
      this.updatePlacement(sx, sy);
    } else if (this.tool === 'gomme') {
      this.erase(w.x, w.y);
    }
  }

  toolEnd(cancelled: boolean): void {
    this.bubble.classList.add('hidden');
    const pv = this.r.preview;
    if (!cancelled) {
      if (this.tool === 'tapis' && this.tracer?.linkBelt && this.tracer.linkDir !== null) {
        this.game.linkMachineToBelt(this.tracer.linkBelt, this.tracer.linkDir);
      } else if (this.tool === 'tapis' && this.tracer?.splitFrom && this.tracer.intoMachine !== null) {
        this.game.linkBeltToMachine(this.tracer.splitFrom, this.tracer.intoMachine);
      } else if (this.tool === 'tapis' && this.tracer?.valid) {
        const t = this.tracer;
        this.game.placeBelts(t.result(), t.splitFrom && t.splitDir !== null ? { from: t.splitFrom, dir: t.splitDir } : undefined);
      } else if (this.tool === 'machine' && pv?.kind === 'place' && this.machineType) {
        this.game.placeMachine(this.machineType, pv.x, pv.y);
      } else if (this.tool === 'move' && pv?.kind === 'place' && this.moving) {
        this.game.moveMachine(this.moving, pv.x, pv.y);
        this.setTool('none');
      }
    }
    this.tracer = null;
    this.r.preview = null;
    this.r.guides = [];
    this.r.loupe = null;
  }

  private erase(wx: number, wy: number): void {
    const x = Math.floor(wx), y = Math.floor(wy);
    this.r.preview = { kind: 'erase', x, y };
    // On gomme aussi les cases entre deux positions du doigt.
    const from = this.lastErase ?? { x, y };
    const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y), 1);
    for (let i = 0; i <= steps; i++) {
      const cx = Math.round(from.x + ((x - from.x) * i) / steps), cy = Math.round(from.y + ((y - from.y) * i) / steps);
      const m = this.game.factory.machineAt(cx, cy);
      if (m?.type === 'noyau' || (m && machineDef(m.type).gift)) continue;
      this.game.removeAt(cx, cy);
    }
    this.lastErase = { x, y };
  }

  cameraMoved(): void {
    this.r.stopFocus();
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
    const f = this.game.factory;
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
          ? `${def.hint}. ${this.game.factory.storageSlots(m)} cases sur 10 occupées.`
          : `${STATUS_TEXT[m.status]}. ${def.hint}.`;
      }
      const fuelLine = m.built && def.coal ? this.gauge('Charbon', m.fuel, 10, this.game.factory.lowFuel(m)) : '';
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
      if (mv) mv.onclick = () => {
        this.closePopover();
        this.setTool('move');
        this.moving = m;
        this.toast('Glisse la machine à sa nouvelle place', 'info');
      };
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
      const splitter = b.split !== undefined && !f.machineAt(b.x + DX[b.split], b.y + DY[b.split]) ? '<p>Séparateur : un objet sur deux part dans la dérivation. Si une sortie est pleine, tout passe par l’autre.</p>' : '';
      const info = `<h3>${splitter ? 'Séparateur' : 'Tapis'} · ${chain.length} case${chain.length > 1 ? 's' : ''}</h3>${splitter}
        <p>${pending ? 'En construction.' : items ? `${items} objet${items > 1 ? 's' : ''} en route.` : 'Vide pour l’instant.'} Pour en effacer une partie, prends la gomme.</p><p class="refund">Supprimer rend ${chain.length} ${ICONS.coinSm}</p>`;
      const feeders = (b.feeds ?? []).map((d) => f.machineAt(b.x + DX[d], b.y + DY[d])).filter((m): m is Machine => !!m);
      const fed = b.split !== undefined ? f.machineAt(b.x + DX[b.split], b.y + DY[b.split]) : null;
      const linked = feeders.length > 0 || !!fed;
      const linkInfo = `${feeders.map((m) => `<p>${esc(machineDef(m.type).name)} y dépose sa production par le côté.</p>`).join('')}${fed ? `<p>Ce tapis nourrit ${esc(machineDef(fed.type).name.toLowerCase())} par le côté : un objet sur deux y entre.</p>` : ''}`;
      const actions = `${linked ? `<div class="row"><button class="btn" data-act="unlink">Couper la liaison</button></div>` : ''}<div class="row"><button class="btn danger" data-act="del">${ICONS.trash}Supprimer le tapis</button></div>`;
      if (!this.setPopover(`b${sel.x},${sel.y}`, info + linkInfo, actions)) return;
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

  /** Jauge de charbon (case carburant). */
  private gauge(label: string, n: number, max: number, low: boolean): string {
    return `<div class="gauge${low ? ' low' : ''}"><span class="g-label"><img src="${this.itemIcons.get('charbon')}" alt="">${label}</span><span class="g-bar"><span style="width:${(n / max) * 100}%"></span></span><b>${n}/${max}</b></div>`;
  }

  // ---------- Inventaires en grand : robot, coffre, fabrication ----------

  /** Pile choisie : une case du robot, ou un objet d'un coffre (chest) ou d'une machine (min : en attente, mout : prêt à sortir). */
  private invSel: { side: 'chest' | 'min' | 'mout'; item: string } | { side: 'robot'; slot: number } | null = null;
  private invQty = 1;
  private craftSel: string | null = null;
  private craftQty = 1;
  /** Feuille ouverte : pour la rafraîchir régulièrement. */
  private sheetKind: 'robot' | 'chest' | 'sell' | 'building' | 'machine' | '' = '';
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
    while (cells.length < this.game.factory.chestSlots) cells.push(null);
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
    const machine = kind === 'crafter' || kind === 'drill' ? target : null;
    const building = target && !chest && !machine ? target : null;
    let t: string, have: number, max: number, verb: string, why = '';
    if (sel.side === 'robot') {
      const sl = g.robot.inv.slots[sel.slot];
      if (!sl) { this.invSel = null; return null; }
      t = sl.t; have = sl.n;
      if (chest) { max = Math.min(sl.n, g.factory.storageRoom(chest, t)); verb = 'Déposer dans le coffre'; if (!max) why = 'Le coffre est plein'; }
      else if (building) {
        const name = machineDef(building.type).name;
        max = Math.min(sl.n, g.accepts(building, t));
        verb = `Donner ${building.type === 'revente' ? 'à la' : 'au'} ${name}`;
        if (!max) why = building.type === 'revente' ? 'La Revente est pleine (ou le gros drone est là)' : `${name} n’en a pas besoin pour l’instant`;
      }
      else if (machine) {
        const name = machineDef(machine.type).name.toLowerCase();
        max = Math.min(sl.n, g.machineAccepts(machine, t));
        verb = t === 'charbon' ? 'Recharger en charbon' : `Mettre dans la machine`;
        if (!max) why = g.machineAccepts(machine, t) === 0 && !machineDef(machine.type).recipes.some((r) => r.in[t]) && t !== 'charbon' ? `La ${name} ne s’en sert pas` : 'Elle est pleine pour l’instant';
      }
      else { max = sl.n - 1; verb = ''; if (!max) why = 'Une seule unité : rien à séparer'; }
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
      const canSplit = sl.n > 1 && g.robot.inv.slots.includes(null);
      const split = h('button', 'btn', 'Séparer la pile');
      split.disabled = !canSplit;
      split.onclick = () => {
        const n = Math.min(this.invQty, sl.n - 1);
        if (g.splitRobotSlot(slot, n)) this.toast(`Pile séparée : ${sl.n} et ${n}`, 'good');
        this.invSel = null;
        this.refreshSheet();
      };
      acts.append(split);
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
    inv.innerHTML = `${this.gauge('Charbon', r.fuel, 10, g.robotOutOfCoal)}<p class="muted">Inventaire · touche une pile pour la séparer</p>${this.gridHtml(r.inv.slots, 'robot')}`;
    this.wireGrid(inv, null);
    const bar = this.invBar(null);
    if (bar) inv.append(bar);
    sheet.append(inv, this.craftCard());
    // Drones et leurs priorités.
    const label = (p: DronePriority) => DRONE_PRIORITIES.find((x) => x.id === p)?.label ?? p;
    const dr = h('div', 'card');
    dr.innerHTML = g.drones.length
      ? `<p class="muted">Drones · touche un drone pour ranger ses tâches</p>${g.drones.map((d, i) => `<button class="prio-btn big" data-drone="${i}"><span>Drone ${i + 1}</span>${this.gauge('', d.fuel, 10, d.fuel <= 2)}${d.cargo ? `<span class="chip"><img src="${this.itemIcons.get(d.cargo.t)}" alt="">${d.cargo.n}</span>` : ''}<b>${PRIO_ICONS[d.priorities[0]] ?? ''}${esc(label(d.priorities[0]))}</b><i>›</i></button>`).join('')}`
      : '<p class="muted">Pas encore de drone.</p>';
    dr.querySelectorAll<HTMLButtonElement>('[data-drone]').forEach((b) => { b.onclick = () => this.openPriorities(Number(b.dataset.drone)); });
    sheet.append(dr);
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

  /** Une machine en grand (four, foreuse…) : état, charbon, recettes, ce qu'elle contient, et l'inventaire du robot. */
  openMachine(m: Machine): void {
    this.closePopover();
    this.invSel = null;
    this.machineId = m.id;
    this.openSheet((sheet, close) => {
      const g = this.game;
      const mm = g.factory.machines.get(this.machineId);
      if (!mm) { close(); return; }
      const def = machineDef(mm.type);
      sheet.classList.add('inv-sheet');
      let title = def.name, status = `${STATUS_TEXT[mm.status]}.`;
      if (def.kind === 'drill') {
        const patch = g.world.patchAt(mm.x, mm.y) ?? g.world.patchAt(mm.x + 1, mm.y + 1);
        title = `Foreuse · ${mm.ore ? item(mm.ore).name.toLowerCase() : '?'}`;
        status += ` Filon ${patch ? RICHNESS_LABEL[patch.richness] : ''} : ${(mm.rate ?? 0).toFixed(2).replace('.', ',')} par seconde.`;
      }
      sheet.append(this.sheetHead(title, esc(status), close));
      // Charbon et recettes
      const top = h('div', 'card mrec');
      top.innerHTML = `${def.coal ? this.gauge('Charbon', mm.fuel, 10, g.factory.lowFuel(mm)) : ''}${this.recipesHtml(def, mm)}`;
      if (mm.type === 'raffinerie') {
        const cur = mm.choice ?? 'plastique';
        const row = h('div', 'row');
        for (const [id, label] of [['plastique', 'Plastique'], ['carburant', 'Carburant']]) {
          const b = h('button', `btn ${cur === id ? 'primary' : ''}`, label);
          b.onclick = () => { g.factory.setChoice(mm, id); this.refreshSheet(); };
          row.append(b);
        }
        top.append(row);
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
      mv.onclick = () => { close(); this.setTool('move'); this.moving = mm; this.toast('Glisse la machine à sa nouvelle place', 'info'); };
      const del = h('button', 'btn danger', `${ICONS.trash}Supprimer · rend ${def.cost}`);
      let armed = false;
      del.onclick = () => {
        if (!armed) { armed = true; del.textContent = 'Toucher encore'; return; }
        g.removeMachine(mm);
        close();
      };
      acts.append(mv, del);
      sheet.append(acts);
    }, true);
    this.sheetKind = 'machine';
  }

  /** La Revente en grand : contenu, passage du gros drone, et dépôt depuis l'inventaire. */
  openSell(m: Machine): void {
    this.closePopover();
    this.invSel = null;
    this.openSheet((sheet, close) => {
      const g = this.game;
      const bin = g.factory.machines.get(m.id);
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
      mv.onclick = () => { close(); this.setTool('move'); this.moving = bin; this.toast('Glisse la Revente à sa nouvelle place', 'info'); };
      const del = h('button', 'btn danger', `${ICONS.trash}Supprimer`);
      let armed = false;
      del.onclick = () => {
        if (!armed) { armed = true; del.textContent = n ? 'Son contenu sera perdu : toucher encore' : 'Toucher encore'; return; }
        g.removeMachine(bin);
        close();
      };
      acts.append(mv, del);
      sheet.append(acts);
    }, true);
    this.sheetKind = 'sell';
  }

  /** Un coffre en grand, avec l'inventaire du robot dessous. */
  openChest(m: Machine): void {
    this.closePopover();
    this.invSel = null;
    this.chestId = m.id;
    this.openSheet((sheet, close) => {
      const chest = this.game.factory.machines.get(this.chestId);
      if (!chest) { close(); return; }
      const g = this.game;
      let total = 0;
      for (const v of Object.values(chest.inBuf)) total += v;
      sheet.classList.add('inv-sheet');
      sheet.append(this.sheetHead('Coffre', `${fmt(total)} / ${g.factory.chestSlots * RULES.invStack} objets · les tapis le remplissent et le vident, les drones s’y servent`, close));
      const c1 = h('div', 'card');
      c1.innerHTML = `<p class="muted">Coffre</p>${this.gridHtml(this.chestCells(chest), 'chest')}`;
      const swap = h('div', 'inv-swap', `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3 V15 M3 12 L6 15 L9 12 M12 15 V3 M9 6 L12 3 L15 6"/></svg>Touche une pile pour la déplacer`);
      const c2 = h('div', 'card');
      c2.innerHTML = `<p class="muted">Inventaire de ${esc(g.look.name)}</p>${this.gridHtml(g.robot.inv.slots, 'robot')}`;
      this.wireGrid(c1, chest);
      this.wireGrid(c2, chest);
      sheet.append(c1, swap, c2);
      const bar = this.invBar(chest);
      if (bar) { bar.classList.add('floating'); sheet.append(bar); }
      const acts = h('div', 'row');
      const mv = h('button', 'btn', `${ICONS.move}Déplacer`);
      mv.onclick = () => { close(); this.setTool('move'); this.moving = chest; this.toast('Glisse le coffre à sa nouvelle place', 'info'); };
      const del = h('button', 'btn danger', `${ICONS.trash}Supprimer`);
      let armed = false;
      del.onclick = () => {
        if (!armed) { armed = true; del.textContent = total ? 'Son contenu sera perdu : toucher encore' : 'Toucher encore'; return; }
        g.removeMachine(chest);
        close();
      };
      acts.append(mv, del);
      sheet.append(acts);
    }, true);
    this.sheetKind = 'chest';
  }

  /** La liste des tâches d'un drone, à ranger de la plus importante à la moins importante. */
  private openPriorities(i: number): void {
    this.closePopover();
    const g = this.game;
    this.openSheet((sheet, close) => {
      const d = g.drones[i];
      if (!d) { close(); return; }
      sheet.append(this.sheetHead(`Priorités du drone ${i + 1}`, 'De la plus importante à la moins importante. Le drone fait la première tâche utile de la liste ; son propre charbon passe toujours avant.', close));
      const list = h('div', 'prio-list');
      const move = (from: number, to: number) => {
        const order = [...d.priorities];
        const [p] = order.splice(from, 1);
        order.splice(to, 0, p);
        g.setDronePriorities(i, order);
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
      if (g.drones.length > 1) {
        const all = h('button', 'btn', 'Même ordre pour tous');
        all.onclick = () => {
          g.drones.forEach((_, j) => g.setDronePriorities(j, d.priorities));
          this.toast('Tous les drones suivent cet ordre', 'good');
        };
        row.append(all);
      }
      const reset = h('button', 'btn', 'Ordre de départ');
      reset.onclick = () => { g.setDronePriorities(i, DEFAULT_ORDER); this.refreshSheet(); };
      row.append(reset);
      sheet.append(row);
      if (g.drones.length > 1) {
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
      const m = this.game.factory.machines.get(sel.id);
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
    mv.onclick = () => { close(); this.setTool('move'); this.moving = m; this.toast('Glisse le bâtiment à sa nouvelle place', 'info'); };
    const wrap = h('div', 'card');
    wrap.innerHTML = `<p class="muted">${def.name} · un cadeau du Noyau : on peut le déplacer, pas le supprimer.</p>`;
    wrap.append(mv);
    return wrap;
  }

  /** Le Noyau offre un bâtiment : la caméra va le voir, une carte explique à quoi il sert. */
  private onGift(type: string, id: number, again = false): void {
    const m = this.game.factory.machines.get(id);
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
      sheet.append(head, upd, treeBtn, center, saveCard, title, help);
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
    this.tips.setHidden(!!this.r.loupe || !!this.overlay || this.tree.isOpen || !!this.root.querySelector('.gift-card'));
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
    }
    // Inventaires en grand : la fabrication avance à chaque image, le reste chaque seconde.
    if (this.sheetKind && this.overlay) {
      this.overlay.querySelectorAll<HTMLElement>('.craft-job').forEach((row) => {
        const job = this.game.craftQueue[Number(row.dataset.i)];
        const bar = row.querySelector<HTMLElement>('.cj-bar > span');
        if (job && bar) bar.style.width = `${(job.t / job.total) * 100}%`;
      });
      this.liveTimer += dt;
      if (this.liveTimer > 1 && (this.sheetKind === 'robot' || this.sheetKind === 'sell' || this.sheetKind === 'machine')) { this.liveTimer = 0; this.sheetDirty = true; }
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
