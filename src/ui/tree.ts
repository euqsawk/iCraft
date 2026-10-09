// Écran de l'arbre de déblocages (fidèle à la maquette Claude Design « Arbre de déblocages »).
import { BRANCHES, NODE, type UnlockNode } from '../data/unlocks.ts';
import { item } from '../data/items.ts';
import type { Game } from '../sim/game.ts';
import { NODE_ICONS } from './nodeIcons.ts';

const ROW = 128, TOP = 18, TILE = 76;
const STAR = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1 L11.2 6.8 L17 9 L11.2 11.2 L9 17 L6.8 11.2 L1 9 L6.8 6.8 Z" fill="#F47C64"/></svg>';
const STAR_INK = '<svg width="10" height="10" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1 L11.2 6.8 L17 9 L11.2 11.2 L9 17 L6.8 11.2 L1 9 L6.8 6.8 Z" fill="#2E3A4B"/></svg>';
const CHECK = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5 L5 9 L9.5 3.5"/></svg>';
const LOCK = '<svg width="11" height="11" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="4.5" width="8" height="5.5" rx="1.5" fill="currentColor"/><path d="M3 4.5 V3.2 A2 2 0 0 1 7 3.2 V4.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class TreeScreen {
  private el: HTMLElement | null = null;
  private tab = 'production';
  private sel = '';
  private game: Game;
  private root: HTMLElement;
  private onClose: () => void;
  private icons: Map<string, string>;

  constructor(root: HTMLElement, game: Game, icons: Map<string, string>, onClose: () => void) {
    this.root = root;
    this.game = game;
    this.icons = icons;
    this.onClose = onClose;
  }

  get isOpen(): boolean {
    return !!this.el;
  }

  open(tab?: string, select?: string): void {
    if (tab) this.tab = tab;
    const br = BRANCHES.find((b) => b.id === this.tab)!;
    this.sel = select ?? this.firstAvailable(br.nodes)?.id ?? br.nodes[0].id;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'tree';
      this.el.innerHTML = `
        <div class="tree-top">
          <button class="round" data-act="back" aria-label="Retour au jeu"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3 L5 9 L11 15"/></svg></button>
          <div class="tree-title"><h1>Déblocages</h1><span class="tree-sub"></span></div>
          <div class="pill tree-points"></div>
        </div>
        <div class="tree-tabs" role="tablist" aria-label="Branches"></div>
        <div class="tree-scroll"><div class="tree-canvas"></div></div>
        <div class="tree-sheet"></div>`;
      this.el.querySelector<HTMLButtonElement>('[data-act="back"]')!.onclick = () => this.close();
      this.root.append(this.el);
    }
    this.render(true);
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    this.onClose();
  }

  private firstAvailable(nodes: UnlockNode[]): UnlockNode | undefined {
    return nodes.find((x) => this.game.nodeState(x) === 'available');
  }

  render(resetScroll = false): void {
    const el = this.el;
    if (!el) return;
    const g = this.game;
    el.querySelector('.tree-sub')!.textContent = g.hasLab() ? 'Les objets se déposent au Laboratoire' : 'Construis un Laboratoire pour débloquer';
    el.querySelector('.tree-points')!.innerHTML = `${STAR}<small>Palier</small>${g.palier}`;

    // Onglets
    const tabs = el.querySelector('.tree-tabs')!;
    tabs.innerHTML = '';
    for (const b of BRANCHES) {
      const t = document.createElement('button');
      t.className = `tree-tab${b.id === this.tab ? ' active' : ''}`;
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(b.id === this.tab));
      const dot = b.nodes.some((x) => g.nodeState(x) === 'available' && g.canAfford(x));
      t.innerHTML = `${esc(b.label)}${dot ? '<span class="tree-dot"></span>' : ''}`;
      t.onclick = () => {
        this.tab = b.id;
        this.sel = (this.firstAvailable(b.nodes) ?? b.nodes[0]).id;
        this.render(true);
      };
      tabs.append(t);
    }

    // Arbre
    const br = BRANCHES.find((b) => b.id === this.tab)!;
    const scroll = el.querySelector<HTMLElement>('.tree-scroll')!;
    const canvas = el.querySelector<HTMLElement>('.tree-canvas')!;
    const w = scroll.clientWidth || 390;
    const base = Math.min(w, 460), off = (w - base) / 2;
    const cols = [off + base * 0.185, off + base * 0.5, off + base * 0.815];
    const top = (row: number) => TOP + row * ROW;
    const maxRow = Math.max(...br.nodes.map((x) => x.row));
    // De la place en bas pour la fiche du nœud (sa hauteur varie avec le texte) : on peut toujours voir la dernière ligne.
    const fit = () => {
      const sheetH = el.querySelector<HTMLElement>('.tree-sheet')?.offsetHeight ?? 300;
      canvas.style.height = `${TOP + maxRow * ROW + TILE + Math.max(310, sheetH + 60)}px`;
    };
    fit();
    requestAnimationFrame(fit);
    let html = '';
    for (const child of br.nodes) {
      for (const pid of child.parents) {
        const p = NODE[pid];
        if (!p) continue;
        const on = g.isUnlocked(pid);
        const x1 = cols[p.col], y1 = top(p.row) + TILE, x2 = cols[child.col], y2 = top(child.row), mid = y2 - 14;
        const segs = x1 === x2 ? [[x1, y1, x1, y2]] : [[x1, y1, x1, mid], [x1, mid, x2, mid], [x2, mid, x2, y2]];
        for (const [ax, ay, bx, by] of segs) {
          const vertical = ax === bx;
          const a = Math.min(ax, bx), b = Math.min(ay, by);
          const len = vertical ? Math.abs(by - ay) : Math.abs(bx - ax);
          // Chemin ouvert : un tapis blanc ; chemin fermé : pointillés.
          html += on
            ? `<div class="edge on" style="left:${a - 6}px;top:${b - 6}px;width:${vertical ? 12 : len + 12}px;height:${vertical ? len + 12 : 12}px"></div>`
            : vertical
              ? `<div class="edge off v" style="left:${a - 1.5}px;top:${b}px;height:${len}px"></div>`
              : `<div class="edge off h" style="left:${a}px;top:${b - 1.5}px;width:${len}px"></div>`;
        }
      }
    }
    for (const x of br.nodes) {
      const st = g.nodeState(x);
      const first = Object.entries(x.cost)[0];
      const badge = st === 'owned' ? `<span class="nb-owned">${CHECK}</span>`
        : st === 'available' ? (g.canAfford(x) ? `<span class="nb-cost ready">${STAR_INK}Prêt</span>` : first ? `<span class="nb-cost"><img src="${this.icons.get(first[0])}" alt="">${first[1]}</span>` : '')
        : st === 'soon' ? '<span class="nb-soon">Bientôt</span>'
        : x.palier > g.palier ? `<span class="nb-level">Palier ${x.palier}</span>`
        : `<span class="nb-lock">${LOCK}</span>`;
      html += `<button class="node ${st}${x.id === this.sel ? ' sel' : ''}" data-id="${x.id}" style="left:${cols[x.col] - 50}px;top:${top(x.row)}px" aria-label="${esc(x.name)}">
        <span class="tile"><span class="ico">${NODE_ICONS[x.icon] ?? ''}</span>${badge}</span>
        <span class="lbl">${esc(x.name)}</span></button>`;
    }
    canvas.innerHTML = html;
    canvas.querySelectorAll<HTMLButtonElement>('.node').forEach((b) => {
      b.onclick = () => { this.sel = b.dataset.id!; this.render(); };
    });
    if (resetScroll) scroll.scrollTop = 0;

    // Fiche du nœud choisi
    const sn = NODE[this.sel] ?? br.nodes[0];
    const st = g.nodeState(sn);
    const names = (ids: string[]) => ids.map((p) => NODE[p]?.name ?? p).join(', ');
    let requires = sn.parents.length ? `Après : ${names(sn.parents)}` : 'Point de départ de la branche';
    if (sn.palier > 1) requires += ` · palier ${sn.palier}`;
    const costs = Object.entries(sn.cost);
    let label: string, enabled = false;
    if (st === 'owned') label = costs.length === 0 ? 'Disponible dès le début' : 'Déjà débloqué';
    else if (st === 'soon') label = 'Bientôt dans le jeu';
    else if (st === 'locked') {
      const missing = sn.parents.filter((p) => !g.isUnlocked(p));
      label = missing.length ? `Débloque d’abord : ${names(missing)}` : `S’ouvre au palier ${sn.palier}`;
    } else if (!g.hasLab()) label = 'Construis un Laboratoire';
    else if (!g.canAfford(sn)) label = 'Il manque des objets au Laboratoire';
    else { label = 'Débloquer'; enabled = true; }
    const costHtml = costs.length && st !== 'owned'
      ? `<div class="ts-costs">${costs.map(([k, v]) => {
          const have = Math.min(g.lab[k] ?? 0, v);
          return `<div class="ts-cost${have >= v ? ' done' : ''}"><img src="${this.icons.get(k)}" alt=""><span>${esc(item(k).name)}</span><b>${have} / ${v}</b><span class="ts-bar"><span style="width:${(have / v) * 100}%"></span></span></div>`;
        }).join('')}</div>`
      : '';
    const tag = st === 'owned' ? ['Débloqué', 'owned'] : st === 'available' ? ['Disponible', 'available'] : st === 'soon' ? ['Bientôt', 'soon'] : ['Verrouillé', 'locked'];
    const sheet = el.querySelector<HTMLElement>('.tree-sheet')!;
    sheet.innerHTML = `
      <div class="ts-head"><div class="ts-icon">${NODE_ICONS[sn.icon] ?? ''}</div>
        <div class="ts-name"><span class="ts-tag ${tag[1]}">${tag[0]}</span><b>${esc(sn.name)}</b></div></div>
      <p>${esc(sn.hint)}</p>
      ${sn.recipes.length ? `<div class="chips">${sn.recipes.map((r) => `<span class="chip plain">${esc(r)}</span>`).join('')}</div>` : ''}
      ${costHtml}
      <div class="ts-req"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7 H12 M8 3 L12 7 L8 11"/></svg>${esc(requires)}</div>
      <button class="btn ${enabled ? 'primary' : ''} ts-btn" ${enabled ? '' : 'disabled'}>${esc(label)}</button>`;
    const btn = sheet.querySelector<HTMLButtonElement>('.ts-btn')!;
    btn.onclick = () => {
      if (g.unlock(sn.id)) this.render();
    };
  }
}
