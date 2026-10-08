// Interface en HTML par-dessus le jeu, et logique des outils (tracer, poser, gommer, déplacer).
import { BIOME_COLORS, CELL, PALETTE, xpForLevel } from '../config.ts';
import { item, ITEM_LIST } from '../data/items.ts';
import { BUILDABLE, machineDef } from '../data/machines.ts';
import type { Gestures, GestureHandlers } from '../input/gestures.ts';
import type { GameRenderer } from '../render/renderer.ts';
import type { Machine } from '../sim/factory.ts';
import { Game, type GameEvent } from '../sim/game.ts';
import { orderProgress, RARITY_LABEL, type Order } from '../sim/orders.ts';
import { BeltTracer } from '../sim/tracer.ts';
import { RICHNESS_LABEL } from '../world/world.ts';
import { ICONS } from './icons.ts';

type Tool = 'none' | 'tapis' | 'machine' | 'gomme' | 'move';

const STATUS_TEXT: Record<string, string> = {
  idle: 'En attente',
  working: 'En marche',
  blocked: 'Sortie pleine : branche un tapis ou vide la suite',
  nofuel: 'Il manque du charbon',
  noinput: 'Il manque un ingrédient',
  noore: 'Pas de filon dessous',
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
  newGame(seed: string): void;
  save(): void;
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

  constructor(root: HTMLElement, game: Game, renderer: GameRenderer, cb: HudCallbacks) {
    this.root = root;
    this.game = game;
    this.r = renderer;
    this.cb = cb;
    for (const d of ITEM_LIST) this.itemIcons.set(d.id, renderer.itemIconDataUrl(d.id));
    for (const m of BUILDABLE) this.machineIcons.set(m.id, renderer.machineIconDataUrl(m.id));
    this.build();
    game.on((e) => this.onEvent(e));
    this.refreshAll();
  }

  attach(_g: Gestures): void { /* les gestes appellent les méthodes de GestureHandlers */ }

  // ---------- Construction du DOM ----------

  private build(): void {
    const top = h('div', 'top');
    const lvl = h('div', 'lvl');
    this.lvlBadge = h('div', 'lvl-badge', '1');
    const info = h('div', 'lvl-info');
    this.lvlTitle = h('b', '', 'Niveau 1');
    const bar = h('span', 'bar');
    this.xpBar = h('span');
    bar.append(this.xpBar);
    this.xpText = h('small');
    info.append(this.lvlTitle, bar, this.xpText);
    lvl.append(this.lvlBadge, info);
    const right = h('div', 'top-right');
    this.money = h('div', 'pill money');
    const menu = h('button', 'round', ICONS.menu);
    menu.setAttribute('aria-label', 'Menu');
    menu.onclick = () => this.openMenu();
    right.append(this.money, menu);
    top.append(lvl, right);

    const row = h('div', 'order-row');
    this.orderCard = h('button', 'order-card');
    this.orderCard.onclick = () => this.openOrders();
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
  }

  // ---------- Mises à jour ----------

  private onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'money': this.refreshMoney(true); break;
      case 'xp': this.refreshLevel(); break;
      case 'level': {
        this.refreshLevel();
        this.lvlBadge.classList.add('bump');
        setTimeout(() => this.lvlBadge.classList.remove('bump'), 400);
        const fresh = BUILDABLE.filter((m) => m.unlock === e.level).map((m) => m.name);
        this.toast(`Niveau ${e.level} !${fresh.length ? ` Nouveau : ${fresh.join(', ')}` : ''}`, 'good');
        this.renderPalette();
        break;
      }
      case 'order': this.refreshOrder(); break;
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

  private refreshLevel(): void {
    const g = this.game, need = xpForLevel(g.level);
    this.lvlBadge.textContent = String(g.level);
    this.lvlTitle.textContent = `Niveau ${g.level}`;
    this.xpBar.style.width = `${Math.min(100, (g.xp / need) * 100)}%`;
    this.xpText.textContent = `${fmt(g.xp)} / ${fmt(need)} XP`;
  }

  private refreshOrder(): void {
    const o = this.game.order;
    const c = this.orderCard;
    if (!o) {
      c.classList.add('choose');
      c.innerHTML = `<div class="main"><span class="tag" style="background:#fff">Noyau</span><b>Choisis une commande</b></div><div class="side"><b>3 choix</b></div>`;
      return;
    }
    c.classList.remove('choose');
    const done = o.lines.reduce((s, l) => s + Math.min(l.done, l.qty), 0);
    const total = o.lines.reduce((s, l) => s + l.qty, 0);
    c.innerHTML = `<div class="main"><span class="tag ${o.rarity}">${RARITY_LABEL[o.rarity]}</span><b>${esc(Game.orderTitle(o))}</b></div>
      <div class="side"><b>${done} / ${total}</b><span class="mini-bar"><span style="width:${orderProgress(o) * 100}%"></span></span><small>+${o.xp} XP</small></div>`;
  }

  private renderPalette(): void {
    const p = this.palette;
    p.innerHTML = '';
    const list = [...BUILDABLE].sort((a, b) => a.unlock - b.unlock);
    const next = list.find((m) => m.unlock > this.game.level);
    for (const m of list) {
      const locked = m.unlock > this.game.level;
      if (locked && m !== next) continue;
      const b = h('button', `mcard${locked ? ' locked' : ''}${this.machineType === m.id ? ' selected' : ''}`);
      b.innerHTML = `<img src="${this.machineIcons.get(m.id)}" alt="">${esc(m.name)}<small>${locked ? `${ICONS.lock} Niv. ${m.unlock}` : `${ICONS.coinSm}${m.cost}`}</small>`;
      b.onclick = () => {
        if (locked) { this.toast(`${m.name} : niveau ${m.unlock}. ${m.hint}`, 'warn'); return; }
        this.machineType = m.id;
        this.renderPalette();
        this.toast(`${m.name} : touche la carte pour la poser`, 'info');
      };
      p.append(b);
    }
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
    return this.tool !== 'none';
  }

  private worldAt(sx: number, sy: number): { x: number; y: number } {
    const w = this.r.camera.screenToWorld(sx, sy);
    return { x: w.x / CELL, y: w.y / CELL };
  }

  tap(sx: number, sy: number): void {
    const w = this.worldAt(sx, sy);
    const cx = Math.floor(w.x), cy = Math.floor(w.y);
    const f = this.game.factory;
    const m = f.machineAt(cx, cy);
    if (m?.type === 'noyau') { this.closePopover(); this.openOrders(); return; }
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
    const check = this.game.factory.checkMachine(type, p.x, p.y, this.moving ?? undefined);
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
    const label = this.tool === 'move' ? 'Déplacer ici' : check.ok ? `${def.name} · ${ICONS.coinSm}${def.cost}` : esc(check.reason ?? 'Impossible');
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

  toolStart(sx: number, sy: number): void {
    this.closePopover();
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
    if (this.tool === 'tapis' && this.tracer) {
      this.tracer.move(w.x, w.y);
      const n = this.tracer.newCount;
      const ok = this.tracer.valid && !this.tracer.blocked;
      const affordable = this.game.money >= n;
      this.showBubble(sx, sy - 56, n > 0 ? `${n} case${n > 1 ? 's' : ''} · ${ICONS.coinSm}${n}` : 'Glisse pour tracer', !ok || !affordable);
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
      if (this.tool === 'tapis' && this.tracer?.valid) {
        this.game.placeBelts(this.tracer.result());
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
      if (m?.type === 'noyau') continue;
      this.game.removeAt(cx, cy);
    }
    this.lastErase = { x, y };
  }

  cameraMoved(): void {
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
      .map(([id, n]) => `<span class="chip"><img src="${this.itemIcons.get(id)}" alt="">${n} ${esc(item(id).name.toLowerCase())}</span>`).join('');
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
        text = 'En construction : les drones arrivent.';
      } else if (def.kind === 'drill') {
        const patch = this.game.world.patchAt(m.x, m.y) ?? this.game.world.patchAt(m.x + 1, m.y + 1);
        title = `Foreuse · ${m.ore ? item(m.ore).name.toLowerCase() : '?'}`;
        text = `${STATUS_TEXT[m.status]}. Filon ${patch ? RICHNESS_LABEL[patch.richness] : ''} : ${(m.rate ?? 0).toFixed(2).replace('.', ',')} par seconde.`;
      } else {
        text = `${STATUS_TEXT[m.status]}. ${def.hint}.`;
        if (def.fuel) text += ` Charbon : ${m.fuel + (m.inBuf[def.fuel.item] ?? 0) * def.fuel.per} fournées.`;
      }
      const inChips = this.chips(Object.fromEntries(Object.entries(m.inBuf).filter(([k]) => k !== def.fuel?.item)));
      const outChips = this.chips(m.outBuf);
      let choice = '';
      if (m.type === 'raffinerie') {
        const cur = m.choice ?? 'plastique';
        choice = `<div class="row"><button class="btn ${cur === 'plastique' ? 'primary' : ''}" data-choice="plastique">Plastique</button><button class="btn ${cur === 'carburant' ? 'primary' : ''}" data-choice="carburant">Carburant</button></div>`;
      }
      const info = `<h3>${esc(title)}</h3><p>${esc(text)}</p>
        ${inChips ? `<p>Entrées</p><div class="chips">${inChips}</div>` : ''}
        ${outChips ? `<p>Sorties</p><div class="chips">${outChips}</div>` : ''}`;
      const actions = `${choice}<div class="row">
          ${m.built ? `<button class="btn" data-act="move">${ICONS.move}Déplacer</button>` : ''}
          <button class="btn danger" data-act="del">${ICONS.trash}${m.built ? 'Supprimer' : 'Annuler'} · +${def.cost}</button>
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
    } else if (sel?.kind === 'belt') {
      const b = f.beltAt(sel.x, sel.y);
      if (!b) { this.closePopover(); return; }
      const chain = f.chainOf(b);
      const items = chain.reduce((s, c) => s + c.items.length, 0);
      const pending = chain.some((c) => !c.built);
      const info = `<h3>Tapis · ${chain.length} case${chain.length > 1 ? 's' : ''}</h3>
        <p>${pending ? 'En construction.' : items ? `${items} objet${items > 1 ? 's' : ''} en route.` : 'Vide pour l’instant.'} Pour en effacer une partie, prends la gomme.</p>`;
      const actions = `<div class="row"><button class="btn danger" data-act="del">${ICONS.trash}Supprimer le tapis · +${chain.length}</button></div>`;
      if (!this.setPopover(`b${sel.x},${sel.y}`, info, actions)) return;
      p.querySelector<HTMLButtonElement>('[data-act="del"]')!.onclick = () => { this.game.removeChain(b); this.closePopover(); };
    }
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

  private openSheet(build: (sheet: HTMLElement, close: () => void) => void): void {
    this.closeSheet();
    const back = h('div', 'backdrop');
    const sheet = h('div', 'sheet');
    back.append(sheet);
    const close = () => this.closeSheet();
    back.onclick = (e) => { if (e.target === back) close(); };
    build(sheet, close);
    this.root.append(back);
    this.overlay = back;
  }

  private closeSheet(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private orderCardHtml(o: Order, withProgress: boolean): string {
    const lines = o.lines.map((l) => `<div class="line"><img src="${this.itemIcons.get(l.item)}" alt="">${esc(item(l.item).name)}<span class="count">${withProgress ? `${Math.min(l.done, l.qty)} / ` : ''}${l.qty}</span></div>`).join('');
    return `<span class="tag ${o.rarity}">${RARITY_LABEL[o.rarity]}</span>${lines}
      <div class="rewards"><span class="reward">${ICONS.xp}+${o.xp} XP</span><span class="reward">${ICONS.coinSm}+${fmt(o.money)}</span></div>`;
  }

  openOrders(): void {
    this.closePopover();
    const g = this.game;
    if (!g.order && g.choices.length === 0) g.refreshChoices();
    this.openSheet((sheet, close) => {
      const head = h('div', 'sheet-head');
      const x = h('button', 'round', ICONS.close);
      x.setAttribute('aria-label', 'Fermer');
      x.onclick = close;
      const stock = Object.entries(g.stock).filter(([, n]) => n > 0);
      const stockHtml = stock.length
        ? `<div class="card"><p class="muted">Au Noyau, hors commande</p><div class="chips">${this.chips(Object.fromEntries(stock))}</div><p class="muted">Ce stock compte dès qu’une commande en a besoin.</p></div>`
        : '';
      if (g.order) {
        head.innerHTML = `<div><h2>Commande en cours</h2><p>Relie tes tapis au Noyau pour livrer.</p></div>`;
        head.append(x);
        const card = h('div', 'card', this.orderCardHtml(g.order, true));
        sheet.append(head, card);
        if (stockHtml) sheet.insertAdjacentHTML('beforeend', stockHtml);
      } else {
        head.innerHTML = `<div><h2>Choisis une commande</h2><p>Pas de chrono, pas de pénalité : prends celle qui te tente.</p></div>`;
        head.append(x);
        sheet.append(head);
        for (const o of g.choices) {
          const card = h('div', 'card', this.orderCardHtml(o, false));
          const pick = h('button', 'btn primary', 'Choisir');
          pick.onclick = () => { g.acceptOrder(o); close(); this.toast('Commande acceptée', 'good'); };
          card.append(pick);
          sheet.append(card);
        }
        const re = h('button', 'btn yellow', `${ICONS.reroll}Relancer les 3 choix · ${ICONS.coinSm}${g.rerollCost()}`);
        re.onclick = () => { g.reroll(); close(); this.openOrders(); };
        sheet.append(re);
        if (stockHtml) sheet.insertAdjacentHTML('beforeend', stockHtml);
      }
    });
  }

  private celebrate(o: Order): void {
    this.closeSheet();
    const box = h('div', 'celebrate');
    box.innerHTML = `<h2>Commande livrée !</h2><p>${esc(Game.orderTitle(o))}</p>
      <div class="rewards" style="justify-content:center;margin-bottom:14px"><span class="reward">${ICONS.xp}+${o.xp} XP</span><span class="reward">${ICONS.coinSm}+${fmt(o.money)}</span></div>`;
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
      head.innerHTML = `<div><h2>Usine fractale</h2><p>Version __VER__</p></div>`.replace('__VER__', __VERSION__);
      const x = h('button', 'round', ICONS.close);
      x.setAttribute('aria-label', 'Fermer');
      x.onclick = close;
      head.append(x);

      const seedCard = h('div', 'card');
      seedCard.innerHTML = `<p class="muted">Graine de cette carte</p><div class="line">${esc(g.world.seed)}</div>`;
      const copy = h('button', 'btn', 'Copier la graine');
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(g.world.seed); this.toast('Graine copiée', 'good'); } catch { this.toast(g.world.seed, 'info'); }
      };
      seedCard.append(copy);

      const center = h('button', 'btn', 'Recentrer sur le robot');
      center.onclick = () => { this.r.centerOnRobot(); close(); };

      const newCard = h('div', 'card');
      newCard.innerHTML = `<p class="muted">Nouvelle partie : laisse vide pour une carte au hasard, ou colle une graine partagée.</p>`;
      const input = h('input', 'field') as HTMLInputElement;
      input.placeholder = 'GRAINE (facultatif)';
      input.autocapitalize = 'characters';
      const start = h('button', 'btn danger', 'Recommencer');
      let armed = false;
      start.onclick = () => {
        if (!armed) { armed = true; start.textContent = 'Toucher encore pour effacer la partie'; return; }
        close();
        this.cb.newGame(input.value.trim().toUpperCase());
      };
      newCard.append(input, start);

      const tips = h('div', 'card');
      const standalone = (navigator as unknown as { standalone?: boolean }).standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
      tips.innerHTML = `<p class="muted"><b>Gestes</b> · Sans outil : glisse pour te déplacer, touche le sol pour envoyer le robot. Avec un outil : un doigt trace ou pose. Deux doigts : déplacer et zoomer.</p>
        ${standalone ? '' : '<p class="muted"><b>Installer</b> · Dans Safari : Partager, puis « Sur l’écran d’accueil ». Le jeu s’ouvre alors en plein écran et ta sauvegarde est mieux protégée.</p>'}`;

      sheet.append(head, seedCard, center, newCard, tips);
    });
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
  }
}

declare global {
  const __VERSION__: string;
  const __DEV__: boolean;
}
