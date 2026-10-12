// Écran de l'arbre de déblocages, en étoile (maquette « L'arbre en étoile ») :
// le robot au centre, six branches à 60°, les rangées de toutes les branches sur les mêmes hexagones.
// On glisse pour explorer, on pince (ou molette) pour zoomer, on touche un nœud pour sa fiche.
import { BRANCHES, NODE, BRANCH_OF, type Branch, type UnlockNode } from '../data/unlocks.ts';
import { item } from '../data/items.ts';
import type { Game } from '../sim/game.ts';
import { NODE_ICONS } from './nodeIcons.ts';

const R0 = 150, STEP = 100;
const STAR = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1 L11.2 6.8 L17 9 L11.2 11.2 L9 17 L6.8 11.2 L1 9 L6.8 6.8 Z" fill="#F47C64"/></svg>';
const CLOSE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3 L13 13 M13 3 L3 13"/></svg>';
const Q = '<path d="M14.5 15 a5.5 5.5 0 1 1 8.2 4.8 c-1.8 1-2.7 2.1-2.7 4.2 v1" fill="none" stroke="#9AAAA2" stroke-width="3.6" stroke-linecap="round"/><circle cx="20" cy="30.5" r="2.3" fill="#9AAAA2"/>';

// Un nœud d'un palier pas encore atteint garde son cadre mais cache ce qu'il débloque : la surprise donne envie d'avancer.
export const MYSTERY = `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">${Q}</svg>`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const f = (v: number) => v.toFixed(1);
const SHORT: Record<string, string> = {
  tapis2: 'Tapis niv. 2', rapide: 'Tapis niv. 3', tapis4: 'Tapis niv. 4', express: 'Tapis niv. 5',
  foreuse2: 'Foreuses niv. 2', foreuse3: 'Foreuses niv. 3', foreuse4: 'Foreuses niv. 4', forage: 'Foreuses niv. 5',
  machine2: 'Machines niv. 2', machine3: 'Machines niv. 3', separateur2: 'Séparateur 3 sorties', tri2: 'Trieur 2 objets',
  rampe: 'Rampe', base_robot: 'Base du robot',
};
const short = (x: UnlockNode) => SHORT[x.id] ?? x.name.replace(' électrique', '');

/** Une icône de nœud posée dans le plan, à (x, y), de côté `size`. */
function iconAt(svg: string, x: number, y: number, size: number, fade: boolean): string {
  const tag = svg.match(/^<svg[^>]*>/)?.[0];
  if (!tag) return '';
  const attrs = tag.replace(/\s(width|height|x|y)="[^"]*"/g, '').replace(/^<svg/, `<svg x="${f(x)}" y="${f(y)}" width="${f(size)}" height="${f(size)}"${fade ? ' opacity="0.42"' : ''}`);
  return attrs + svg.slice(tag.length);
}

interface Pos { x: number; y: number }

/** Où tombe chaque nœud (le robot est en 0, 0). */
function layout(): { pos: Map<string, Pos>; junction: Map<string, Pos>; roots: Map<string, UnlockNode[]> } {
  const pos = new Map<string, Pos>();
  const junction = new Map<string, Pos>();
  const roots = new Map<string, UnlockNode[]>();
  for (const b of BRANCHES) {
    const t = (b.angle * Math.PI) / 180;
    const u = { x: Math.cos(t), y: Math.sin(t) }, v = { x: -u.y, y: u.x };
    // Écart entre couloirs : plus large quand ils sont côte à côte (les noms prennent de la place en largeur).
    const lane = 1 / Math.hypot(v.x / 106, v.y / 92);
    const at = (row: number, col: number): Pos => {
      const d = R0 + STEP * (row - 1);
      return { x: u.x * d + v.x * col * lane, y: u.y * d + v.y * col * lane };
    };
    for (const x of b.nodes) pos.set(x.id, at(x.row, x.col));
    const r = b.nodes.filter((x) => x.parents.length === 0);
    roots.set(b.id, r);
    // Plusieurs départs : un petit carrefour sur la première rangée, puis un trait vers chacun.
    if (r.length > 1) junction.set(b.id, at(1, 0));
  }
  return { pos, junction, roots };
}
const L = layout();

export class TreeScreen {
  private el: HTMLElement | null = null;
  private sel = '';
  private game: Game;
  private root: HTMLElement;
  private onClose: () => void;
  private icons: Map<string, string>;
  // Vue : le point (0, 0) du plan (le robot) est à (tx, ty) à l'écran, zoom s.
  private tx = 0;
  private ty = 0;
  private s = 0.8;
  private anim = 0;

  constructor(root: HTMLElement, game: Game, icons: Map<string, string>, onClose: () => void) {
    this.root = root;
    this.game = game;
    this.icons = icons;
    this.onClose = onClose;
  }

  get isOpen(): boolean {
    return !!this.el;
  }

  /** Ouvre l'arbre ; `tab` = une branche à montrer, `select` = un nœud à ouvrir. */
  open(tab?: string, select?: string): void {
    const fresh = !this.el;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'tree star';
      this.el.innerHTML = `
        <div class="star-view"><svg class="star-svg" xmlns="http://www.w3.org/2000/svg"><g class="star-world"></g></svg></div>
        <div class="star-fade top"></div>
        <div class="tree-top">
          <button class="round" data-act="back" aria-label="Retour au jeu"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3 L5 9 L11 15"/></svg></button>
          <div class="tree-title"><h1>Déblocages</h1><span class="tree-sub"></span></div>
          <div class="pill tree-points"></div>
        </div>
        <div class="star-legend"></div>
        <div class="tree-sheet star-sheet"></div>`;
      this.el.querySelector<HTMLButtonElement>('[data-act="back"]')!.onclick = () => this.close();
      this.root.append(this.el);
      this.bindGestures(this.el.querySelector<HTMLElement>('.star-view')!);
    }
    this.sel = select && NODE[select] ? select : '';
    this.render();
    const { w, h } = this.size();
    if (fresh) {
      this.s = this.homeScale();
      this.tx = w / 2;
      this.ty = h / 2;
    }
    if (this.sel) this.focusNode(this.sel, !fresh);
    else if (tab && BRANCHES.some((b) => b.id === tab)) this.focusBranch(tab, !fresh);
    else this.apply();
  }

  close(): void {
    cancelAnimationFrame(this.anim);
    this.el?.remove();
    this.el = null;
    this.onClose();
  }

  private size(): { w: number; h: number } {
    const v = this.el?.querySelector<HTMLElement>('.star-view');
    return { w: v?.clientWidth || 390, h: v?.clientHeight || 844 };
  }

  private homeScale(): number {
    const { w, h } = this.size();
    return Math.max(0.5, Math.min(0.9, Math.min(w, h - 120) / 700));
  }

  /** Caché tant que son palier n'est pas atteint. */
  private hidden(x: UnlockNode): boolean {
    return x.palier > this.game.palier;
  }

  // ---------- vue : glisser, pincer, molette ----------

  private apply(): void {
    const g = this.el?.querySelector('.star-world');
    if (!g) return;
    g.setAttribute('transform', `translate(${f(this.tx)} ${f(this.ty)}) scale(${this.s.toFixed(4)})`);
    this.el!.classList.toggle('far', this.s < 0.42);
  }

  private zoomAt(cx: number, cy: number, k: number, animate = false): void {
    const s2 = Math.max(0.3, Math.min(1.6, this.s * k));
    const wx = (cx - this.tx) / this.s, wy = (cy - this.ty) / this.s;
    if (animate) {
      this.animateTo(cx - wx * s2, cy - wy * s2, s2);
      return;
    }
    this.s = s2;
    this.tx = cx - wx * s2;
    this.ty = cy - wy * s2;
    this.apply();
  }

  /** Amène le point (wx, wy) du plan au centre de la zone visible (au-dessus de la fiche si elle est ouverte). */
  private goTo(wx: number, wy: number, s = this.s, animate = true): void {
    const { w, h } = this.size();
    const top = 120;
    const sheet = this.sel ? this.el?.querySelector<HTMLElement>('.star-sheet')?.offsetHeight ?? 0 : 0;
    const cy = top + Math.max(80, h - sheet - top) / 2;
    const tx = w / 2 - wx * s, ty = cy - wy * s;
    if (animate) this.animateTo(tx, ty, s);
    else { this.tx = tx; this.ty = ty; this.s = s; this.apply(); }
  }

  private animateTo(tx: number, ty: number, s: number): void {
    cancelAnimationFrame(this.anim);
    const a = { tx: this.tx, ty: this.ty, s: this.s }, t0 = performance.now(), dur = 320;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      this.tx = a.tx + (tx - a.tx) * e;
      this.ty = a.ty + (ty - a.ty) * e;
      this.s = a.s + (s - a.s) * e;
      this.apply();
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  private focusNode(id: string, animate = true): void {
    const p = L.pos.get(id);
    if (p) this.goTo(p.x, p.y, Math.max(this.s, 0.8), animate);
  }

  private focusBranch(id: string, animate = true): void {
    const b = BRANCHES.find((x) => x.id === id);
    if (!b) return;
    const pts = b.nodes.map((x) => L.pos.get(x.id)!);
    const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
    const { w, h } = this.size();
    const s = Math.max(0.5, Math.min(0.9, (w - 40) / (x1 - x0 + 160), (h - 160) / (y1 - y0 + 160)));
    this.goTo((x0 + x1) / 2, (y0 + y1) / 2, s, animate);
  }

  private bindGestures(view: HTMLElement): void {
    const pts = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number } | null = null, moved = false, pinch = 0;
    view.addEventListener('pointerdown', (e) => {
      cancelAnimationFrame(this.anim);
      view.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { down = { x: e.clientX, y: e.clientY }; moved = false; }
      else moved = true;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    view.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const r = view.getBoundingClientRect();
      if (pts.size === 1) {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) moved = true;
        if (moved) { this.tx += e.clientX - p.x; this.ty += e.clientY - p.y; this.apply(); }
        p.x = e.clientX; p.y = e.clientY;
      } else if (pts.size === 2) {
        const [a0, b0] = [...pts.values()];
        const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
        p.x = e.clientX; p.y = e.clientY;
        const [a, b] = [...pts.values()];
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.tx += m.x - m0.x; this.ty += m.y - m0.y;
        if (pinch > 0) this.zoomAt(m.x - r.left, m.y - r.top, d / pinch);
        pinch = d;
        this.apply();
      }
    });
    const up = (e: PointerEvent) => {
      const had = pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (!had || pts.size > 0) return;
      if (!moved && e.type === 'pointerup') {
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGElement>('[data-id]');
        const id = hit?.dataset.id ?? '';
        if (id !== this.sel) {
          this.sel = id;
          this.render();
          if (id) this.focusNode(id);
        } else if (!id) this.render();
      }
      down = null;
    };
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
    view.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = view.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  // ---------- dessin ----------

  private state(x: UnlockNode): 'done' | 'open' | 'far' | 'next' | 'soon' {
    const st = this.game.nodeState(x);
    if (st === 'owned') return 'done';
    if (this.hidden(x)) return 'next';
    if (st === 'available') return 'open';
    if (st === 'soon') return 'soon';
    return 'far';
  }

  private drawWorld(): string {
    const g = this.game;
    const out: string[] = [];
    const st = new Map(BRANCHES.flatMap((b) => b.nodes).map((x) => [x.id, this.state(x)]));
    const maxRow = Math.max(...BRANCHES.flatMap((b) => b.nodes.map((x) => x.row)));
    // Les hexagones : la même rangée de toutes les branches tombe sur le même.
    for (let k = 1; k <= maxRow + 1; k++) {
      const rr = (R0 + STEP * (k - 1)) / Math.cos(Math.PI / 6);
      const p = [...Array(6)].map((_, i) => { const a = ((-60 + 60 * i) * Math.PI) / 180; return `${f(rr * Math.cos(a))},${f(rr * Math.sin(a))}`; }).join(' ');
      out.push(`<polygon points="${p}" fill="none" stroke="#C3D8CD" stroke-width="1.2" stroke-dasharray="2 6" stroke-linejoin="round"/>`);
    }
    const line = (a: Pos, b: Pos, attrs: string) => `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke-linecap="round" ${attrs}/>`;
    const O = { x: 0, y: 0 };
    // Un seul tronc par branche, du robot à sa racine (ou à son carrefour).
    for (const b of BRANCHES) {
      const roots = L.roots.get(b.id)!;
      const j = L.junction.get(b.id);
      if (j) {
        const any = roots.some((x) => st.get(x.id) === 'done');
        out.push(line(O, j, `stroke="${b.color}" stroke-width="6"${any ? '' : ' opacity="0.45"'}`));
        for (const x of roots) out.push(this.edge(j, L.pos.get(x.id)!, 'done', st.get(x.id)!, b.color));
      } else {
        for (const x of roots) out.push(line(O, L.pos.get(x.id)!, `stroke="${b.color}" stroke-width="6"${st.get(x.id) === 'done' ? '' : ' opacity="0.45"'}`));
      }
      for (const x of b.nodes) for (const pid of x.parents) {
        const pp = L.pos.get(pid);
        if (pp) out.push(this.edge(pp, L.pos.get(x.id)!, st.get(pid)!, st.get(x.id)!, b.color));
      }
    }
    for (const [bid, j] of L.junction) {
      const b = BRANCHES.find((x) => x.id === bid)!;
      out.push(`<circle cx="${f(j.x)}" cy="${f(j.y)}" r="9" fill="${b.color}" stroke="#fff" stroke-width="3"/>`);
    }
    // Les nœuds
    for (const b of BRANCHES) for (const x of b.nodes) out.push(this.node(x, b, st.get(x.id)!, g.canAfford(x)));
    // Le robot au centre
    const k = 1.2;
    out.push(`<g class="star-robot"><circle r="${48 * k}" fill="#fff" opacity="0.55"/><circle r="${38 * k}" fill="none" stroke="#2E3A4B" stroke-width="${2 * k}" stroke-dasharray="${3 * k} ${5 * k}" opacity="0.4"/>
      <rect x="${-25 * k}" y="${-20 * k}" width="${50 * k}" height="${50 * k}" rx="${12 * k}" fill="#BCD2C6"/>
      <rect x="${-25 * k}" y="${-25 * k}" width="${50 * k}" height="${50 * k}" rx="${12 * k}" fill="#FFC857" stroke="#2E3A4B" stroke-width="${3 * k}"/>
      <rect x="${-22 * k}" y="${-22 * k}" width="${44 * k}" height="${12 * k}" rx="${6 * k}" fill="#FFE3A3"/>
      <circle cx="${-9 * k}" cy="${3 * k}" r="${4.2 * k}" fill="#2E3A4B"/><circle cx="${9 * k}" cy="${3 * k}" r="${4.2 * k}" fill="#2E3A4B"/>
      <line x1="0" y1="${-25 * k}" x2="0" y2="${-35 * k}" stroke="#2E3A4B" stroke-width="${3 * k}" stroke-linecap="round"/><circle cx="0" cy="${-38 * k}" r="${4.6 * k}" fill="#FFC857" stroke="#2E3A4B" stroke-width="${2 * k}"/></g>`);
    // Le nom de chaque branche, au bout
    for (const b of BRANCHES) {
      const a = (b.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
      const proj = Math.max(...b.nodes.map((x) => { const p = L.pos.get(x.id)!; return p.x * dx + p.y * dy; }));
      const done = b.nodes.filter((x) => st.get(x.id) === 'done').length;
      const txt = `${b.label} · ${done}/${b.nodes.length}`;
      const fs = 15, wpx = txt.length * fs * 0.56 + fs * 1.7, hpx = fs * 2;
      const gap = 40 + 22 * Math.max(0, dy) + Math.abs(dx) * wpx / 2 + Math.abs(dy) * hpx / 2;
      const X = dx * (proj + gap), Y = dy * (proj + gap);
      out.push(`<g class="star-chip" data-branch="${b.id}"><rect x="${f(X - wpx / 2)}" y="${f(Y - hpx / 2)}" width="${f(wpx)}" height="${hpx}" rx="${hpx / 2}" fill="${b.color}"/><text x="${f(X)}" y="${f(Y + fs * 0.36)}" font-size="${fs}" font-weight="900" fill="#fff" text-anchor="middle">${esc(txt)}</text></g>`);
    }
    return out.join('');
  }

  private edge(a: Pos, b: Pos, sa: string, sb: string, color: string): string {
    const base = `x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke-linecap="round"`;
    if (sa === 'done' && sb === 'done') return `<line ${base} stroke="${color}" stroke-width="5"/>`;
    if (sa === 'done' && sb === 'open') return `<line ${base} stroke="${color}" stroke-width="3" stroke-dasharray="6 5" opacity="0.9"/>`;
    return `<line ${base} stroke="#B5C7BE" stroke-width="3"/>`;
  }

  private node(x: UnlockNode, b: Branch, st: string, ready: boolean): string {
    const { x: cx, y: cy } = L.pos.get(x.id)!;
    const col = b.color, R = 24, lab = cy + 39;
    const halo = 'paint-order="stroke" stroke="#DCEBE3" stroke-width="4" stroke-linejoin="round"';
    const o: string[] = [`<g class="tn ${st}${x.id === this.sel ? ' sel' : ''}" data-id="${x.id}">`];
    // Une zone de toucher plus large que le dessin
    o.push(`<circle cx="${f(cx)}" cy="${f(cy + 8)}" r="40" fill="transparent"/>`);
    if (x.id === this.sel) o.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="34" fill="none" stroke="#2E3A4B" stroke-width="3"/>`);
    if (st === 'next') {
      o.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${R}" fill="#E5EEE9" stroke="#C9D8D0" stroke-width="2" stroke-dasharray="3 3"/>`);
      o.push(`<svg x="${f(cx - 15)}" y="${f(cy - 15)}" width="30" height="30" viewBox="0 0 40 40" aria-hidden="true">${Q}</svg>`);
      o.push(`<text class="tl" x="${f(cx)}" y="${f(lab)}" font-size="10.5" font-weight="800" fill="#8EA198" text-anchor="middle">palier ${x.palier}</text></g>`);
      return o.join('');
    }
    if (st === 'open') o.push(`<circle class="tn-halo${ready ? ' ready' : ''}" cx="${f(cx)}" cy="${f(cy)}" r="31" fill="${col}" opacity="0.18"/>`);
    if (st === 'done' || st === 'open') o.push(`<circle cx="${f(cx)}" cy="${f(cy + 4)}" r="${R}" fill="#BCD2C6"/>`);
    if (st === 'done') o.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${R}" fill="#fff" stroke="${col}" stroke-width="4"/>`);
    else if (st === 'open') o.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${R}" fill="#fff" stroke="${col}" stroke-width="3" stroke-dasharray="5 3.5"/>`);
    else o.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${R}" fill="#EEF4F0" stroke="#C3D3CA" stroke-width="2.5"${st === 'soon' ? ' stroke-dasharray="3 3"' : ''}/>`);
    o.push(iconAt(NODE_ICONS[x.icon] ?? '', cx - 15, cy - 15, 30, st === 'far' || st === 'soon'));
    const bx = cx + 17.3, by = cy - 17.3;
    if (st === 'done') {
      o.push(`<circle cx="${f(bx)}" cy="${f(by)}" r="8" fill="${col}" stroke="#fff" stroke-width="2"/><path d="M${f(bx - 3.6)} ${f(by)} L${f(bx - 1)} ${f(by + 2.8)} L${f(bx + 3.8)} ${f(by - 2.8)}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
    } else if (st === 'open') {
      o.push(`<circle cx="${f(bx)}" cy="${f(by)}" r="8.5" fill="${ready ? '#F47C64' : '#2E3A4B'}" stroke="#fff" stroke-width="2"/><path d="M${f(bx - 3.5)} ${f(by)} H${f(bx + 3.5)} M${f(bx)} ${f(by - 3.5)} V${f(by + 3.5)}" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`);
    }
    const fill = st === 'done' || st === 'open' ? '#2E3A4B' : '#8EA198';
    o.push(`<text class="tl" x="${f(cx)}" y="${f(lab)}" font-size="11.5" font-weight="800" fill="${fill}" text-anchor="middle" ${halo}>${esc(short(x))}</text>`);
    const sub = st === 'soon' ? ['Bientôt', '#8EA198'] : x.free && st !== 'done' ? ['sans prérequis', col] : null;
    if (sub) o.push(`<text class="tl" x="${f(cx)}" y="${f(lab + 13)}" font-size="9.5" font-weight="900" fill="${sub[1]}" text-anchor="middle" ${halo}>${sub[0]}</text>`);
    o.push('</g>');
    return o.join('');
  }

  render(): void {
    const el = this.el;
    if (!el) return;
    const g = this.game;
    const all = BRANCHES.flatMap((b) => b.nodes);
    const avail = all.filter((x) => g.nodeState(x) === 'available');
    const ready = avail.filter((x) => g.canAfford(x)).length;
    el.querySelector('.tree-sub')!.textContent = `${avail.length} possible${avail.length > 1 ? 's' : ''}${ready ? ` · ${ready} prêt${ready > 1 ? 's' : ''}` : ''}${g.hasLab() ? '' : ' · construis un Laboratoire'}`;
    el.querySelector('.tree-points')!.innerHTML = `${STAR}<small>Palier</small>${g.palier}`;
    el.querySelector('.star-world')!.innerHTML = this.drawWorld();
    this.apply();

    el.querySelector('.star-legend')!.innerHTML = `<span><i class="lg done"></i>Débloqué</span><span><i class="lg open"></i>Possible</span><span><i class="lg far"></i>Plus loin</span><span><i class="lg next"></i>Palier suivant</span>`;
    this.renderSheet();
  }

  private renderSheet(): void {
    const el = this.el!;
    const g = this.game;
    const sheet = el.querySelector<HTMLElement>('.star-sheet')!;
    el.classList.toggle('has-sheet', !!this.sel);
    if (!this.sel || !NODE[this.sel]) { sheet.innerHTML = ''; return; }
    const sn = NODE[this.sel];
    const b = BRANCH_OF[sn.id];
    const st = g.nodeState(sn);
    const hide = this.hidden(sn);
    const names = (ids: string[]) => ids.map((p) => NODE[p]?.name ?? p).join(' et ');
    let requires = sn.free ? 'Sans prérequis' : sn.parents.length ? `Après : ${names(sn.parents)}` : 'Point de départ de la branche';
    if (sn.palier > 1) requires += ` · palier ${sn.palier}`;
    const costs = Object.entries(sn.cost);
    let label: string, enabled = false;
    if (st === 'owned') label = costs.length === 0 ? 'Disponible dès le début' : 'Déjà débloqué';
    else if (st === 'soon') label = 'Bientôt dans le jeu';
    else if (hide) label = `S’ouvre au palier ${sn.palier}`;
    else if (st === 'locked') label = `Débloque d’abord : ${names(sn.parents.filter((p) => !g.isUnlocked(p)))}`;
    else if (!g.hasLab()) label = 'Construis un Laboratoire';
    else if (!g.canAfford(sn)) label = 'Il manque des objets au Laboratoire';
    else { label = 'Débloquer'; enabled = true; }
    const costHtml = costs.length && st !== 'owned' && !hide
      ? `<div class="ts-costs">${costs.map(([k, v]) => {
          const have = Math.min(g.lab[k] ?? 0, v);
          return `<div class="ts-cost${have >= v ? ' done' : ''}"><img src="${this.icons.get(k)}" alt=""><span>${esc(item(k).name)}</span><b>${have} / ${v}</b><span class="ts-bar"><span style="width:${(have / v) * 100}%"></span></span></div>`;
        }).join('')}</div>`
      : '';
    const tag = st === 'owned' ? ['Débloqué', 'owned'] : st === 'available' ? ['Disponible', 'available'] : st === 'soon' ? ['Bientôt', 'soon'] : ['Verrouillé', 'locked'];
    sheet.innerHTML = `
      <div class="ts-head"><div class="ts-icon${hide ? ' mystery' : ''}" style="--bc:${b.color}">${hide ? MYSTERY : NODE_ICONS[sn.icon] ?? ''}</div>
        <div class="ts-name"><span class="ts-tag ${tag[1]}">${tag[0]}</span><b>${hide ? 'Déblocage caché' : esc(sn.name)}</b><span class="ts-branch" style="color:${b.color}">${esc(b.label)}</span></div>
        <button class="round ts-close" aria-label="Fermer">${CLOSE}</button></div>
      <p>${hide ? 'Continue de progresser pour découvrir ce qui se cache ici.' : esc(sn.hint)}</p>
      ${sn.recipes.length && !hide ? `<div class="chips">${sn.recipes.map((r) => `<span class="chip plain">${esc(r)}</span>`).join('')}</div>` : ''}
      ${costHtml}
      <div class="ts-req"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7 H12 M8 3 L12 7 L8 11"/></svg>${esc(requires)}</div>
      <button class="btn ${enabled ? 'primary' : ''} ts-btn" ${enabled ? '' : 'disabled'}>${esc(label)}</button>`;
    sheet.querySelector<HTMLButtonElement>('.ts-close')!.onclick = () => { this.sel = ''; this.render(); };
    sheet.querySelector<HTMLButtonElement>('.ts-btn')!.onclick = () => {
      if (g.unlock(sn.id)) this.render();
    };
  }
}

