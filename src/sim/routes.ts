// Routes et rails des lignes de camions et de trains, posés tout seuls.
//
// Une ligne fait une boucle : de chaque arrêt, la voie part par la sortie du quai et arrive au suivant par
// l'entrée de son quai. Les voies sont à sens unique et font 2 cases de large : leur milieu suit les traits du
// quadrillage. L'aller et le retour ne se collent pas : au moins 4 cases entre les deux. Une voie passe en
// tunnel sous ce qu'elle croise (machines, tapis), en descendant 2 ou 3 cases avant. Deux voies qui se croisent
// à la surface font un carrefour (deux routes), un passage à niveau (route et rails) ou un croisement de rails,
// avec des feux.
import { DX, DY, key, type Dir } from './geom.ts';
import { stationGeo, type Pt, type Rot } from './stations.ts';

export type LaneKind = 'camion' | 'train';
export type Axis = 'h' | 'v';

/** Un pas d'une case le long d'une voie : point de départ (quadrillage), sens, distance au début du trajet. */
export interface Step { x: number; y: number; d: Dir; s: number }

export interface LegRoute {
  /** Coins du trajet, sur le quadrillage : du point d'arrêt d'un quai à celui du suivant. */
  pts: Pt[];
  steps: Step[];
  len: number;
  /** Les tunnels : intervalles de distance où la voie est sous terre. */
  tunnels: [number, number][];
}

export interface LineRoute {
  sig: string;
  legs: LegRoute[];
  /** Écart tenu entre l'aller et le retour (6 = 4 cases libres entre les deux voies). */
  gap: number;
}

export type CrossKind = 'carrefour' | 'niveau' | 'rails';

export interface CrossMember { line: number; leg: number; sIn: number; sOut: number; axis: Axis; kind: LaneKind }

export interface Crossing {
  id: number;
  kind: CrossKind;
  /** Centre (en cases) et cases couvertes. */
  x: number;
  y: number;
  cells: number[];
  members: CrossMember[];
}

/** Distance (sur la voie) entre la sortie d'un quai et le premier virage possible. */
export const APPROACH = 3;
/** Le tunnel commence (et finit) ces cases avant (et après) ce qu'il croise. */
export const TUNNEL_MARGIN = 2.5;
/** Écarts essayés entre l'aller et le retour, du plus large au plus serré (milieu à milieu). */
const GAPS = [6, 4, 2];

/** Les 2 cases couvertes par un pas (la voie fait 2 cases de large, centrée sur le trait). */
export function stepCells(x: number, y: number, d: Dir): [number, number, number, number] {
  switch (d) {
    case 0: return [x, y - 1, x, y];
    case 2: return [x - 1, y - 1, x - 1, y];
    case 1: return [x - 1, y, x, y];
    default: return [x - 1, y - 1, x, y - 1];
  }
}

const axisOf = (d: Dir): Axis => (d % 2 === 0 ? 'h' : 'v');

/** Ce que la recherche doit savoir de la carte. */
export interface RouteWorld {
  /** Une case où aucune voie ne passe (bâtiment ou quai d'une gare, d'un dépôt). */
  blocked(x: number, y: number): boolean;
  /** Une case occupée (machine, tapis) : la voie y passerait en tunnel. */
  occupied(x: number, y: number): boolean;
}

export interface StopGeo { x: number; y: number; rot: Rot }

/** Voies déjà posées par les autres lignes : case → sens (1 = horizontal, 2 = vertical). */
export type LaneMap = Map<number, number>;

function stepsOf(pts: Pt[]): Step[] {
  const steps: Step[] = [];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const d: Dir = b.x > a.x ? 0 : b.x < a.x ? 2 : b.y > a.y ? 1 : 3;
    for (let k = 0; k < n; k++) { steps.push({ x: a.x + DX[d] * k, y: a.y + DY[d] * k, d, s }); s++; }
  }
  return steps;
}

/** Garde seulement les coins (et les deux bouts). */
function corners(path: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of path) {
    if (out.length && out[out.length - 1].x === p.x && out[out.length - 1].y === p.y) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

// ---------- Recherche du chemin (A*, sur les points du quadrillage) ----------

class Heap {
  private a: { k: number; f: number }[] = [];
  get size(): number { return this.a.length; }
  push(k: number, f: number): void {
    const a = this.a; a.push({ k, f });
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): { k: number; f: number } {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

interface SearchOpts {
  world: RouteWorld;
  others: LaneMap;
  /** Points interdits (trop près des autres trajets de la même ligne). */
  forbid: Set<number>;
}

/**
 * Chemin de S (en roulant vers dS) à T (en arrivant vers dT), par pas d'une case, sans demi-tour,
 * au moins 2 pas entre deux virages. Coût : longueur, virages, tunnels et croisements.
 */
function search(S: Pt, dS: Dir, T: Pt, dT: Dir, o: SearchOpts): Pt[] | null {
  const margin = 24;
  const x0 = Math.min(S.x, T.x) - margin, y0 = Math.min(S.y, T.y) - margin;
  const W = Math.max(S.x, T.x) + margin - x0 + 1, H = Math.max(S.y, T.y) + margin - y0 + 1;
  if (W * H > 600 * 600) return null;
  // État : point, sens, pas depuis le dernier virage (0, 1, 2+).
  const idx = (x: number, y: number, d: number, r: number) => (((y - y0) * W + (x - x0)) * 4 + d) * 3 + r;
  const N = W * H * 12;
  const g = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const h = (x: number, y: number) => Math.abs(T.x - x) + Math.abs(T.y - y);
  const open = new Heap();
  const s0 = idx(S.x, S.y, dS, 2);
  g[s0] = 0;
  open.push(s0, h(S.x, S.y));
  let found = -1, budget = 500000;
  while (open.size && budget-- > 0) {
    const { k, f } = open.pop();
    const r = k % 3, d = Math.floor(k / 3) % 4, cell = Math.floor(k / 12);
    const x = x0 + (cell % W), y = y0 + Math.floor(cell / W);
    if (f - h(x, y) > g[k] + 1e-6) continue;
    if (x === T.x && y === T.y && d === dT) { found = k; break; }
    for (const nd of [d, (d + 1) % 4, (d + 3) % 4] as Dir[]) {
      const turn = nd !== d;
      if (turn && r < 2) continue;
      const nx = x + DX[nd], ny = y + DY[nd];
      if (nx < x0 || ny < y0 || nx >= x0 + W || ny >= y0 + H) continue;
      if (o.forbid.has(key(nx, ny)) && !(nx === T.x && ny === T.y)) continue;
      const [ax, ay, bx, by] = stepCells(x, y, nd);
      if (o.world.blocked(ax, ay) || o.world.blocked(bx, by)) continue;
      const mask = nd % 2 === 0 ? 1 : 2;
      const oa = o.others.get(key(ax, ay)) ?? 0, ob = o.others.get(key(bx, by)) ?? 0;
      // Jamais le long d'une autre voie (dans le même sens du quadrillage) : on la croise seulement.
      if ((oa | ob) & mask) continue;
      let c = 1 + (turn ? 3 : 0);
      if (oa || ob) c += 4;
      if (o.world.occupied(ax, ay) || o.world.occupied(bx, by)) c += 1.2;
      const nk = idx(nx, ny, nd, turn ? 1 : Math.min(2, r + 1));
      const ng = g[k] + c;
      if (ng < g[nk]) { g[nk] = ng; from[nk] = k; open.push(nk, ng + h(nx, ny)); }
    }
  }
  if (found < 0) return null;
  const path: Pt[] = [];
  for (let k = found; k >= 0; k = from[k]) {
    const cell = Math.floor(k / 12);
    path.push({ x: x0 + (cell % W), y: y0 + Math.floor(cell / W) });
  }
  return path.reverse();
}

/** Le trajet le plus simple (en L) : quand rien d'autre ne passe. */
function fallback(S: Pt, T: Pt): Pt[] {
  return [S, { x: T.x, y: S.y }, T];
}

/** Points interdits autour d'un trajet : tous ceux à moins de `gap` (en cases, milieu à milieu). */
function dilate(pts: Pt[], gap: number, into: Set<number>): void {
  const r = gap - 1;
  if (r < 0) return;
  for (const s of stepsOf(pts)) {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) into.add(key(s.x + i, s.y + j));
  }
  const last = pts[pts.length - 1];
  if (last) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) into.add(key(last.x + i, last.y + j));
}

const ahead = (p: Pt, d: Dir, n: number): Pt => ({ x: p.x + DX[d] * n, y: p.y + DY[d] * n });

/** Signature d'une ligne : ses arrêts (place et sens). Le trajet ne change que si elle change. */
export function routeSig(stops: StopGeo[]): string {
  return stops.map((s) => `${s.x},${s.y},${s.rot}`).join(';');
}

/** Calcule la boucle d'une ligne (un trajet par arrêt, vers le suivant). */
export function computeLine(stops: StopGeo[], world: RouteWorld, others: LaneMap): LineRoute {
  const geos = stops.map((s) => stationGeo(s.x, s.y, s.rot));
  const n = geos.length;
  const legCount = n;
  for (const gap of GAPS) {
    const forbid = new Set<number>();
    const legs: LegRoute[] = [];
    let ok = true;
    for (let i = 0; i < legCount; i++) {
      const a = geos[i], b = geos[(i + 1) % n];
      const S = ahead(a.exit, a.dir, APPROACH), T = ahead(b.entry, b.dir, -APPROACH);
      // Les bouts du trajet ne doivent pas tomber dans la zone interdite (sinon : écart plus serré).
      if (gap > 0 && (forbid.has(key(S.x, S.y)) || forbid.has(key(T.x, T.y)))) { ok = false; break; }
      const mid = search(S, a.dir, T, b.dir, { world, others, forbid });
      if (!mid) { ok = false; break; }
      const pts = corners([a.dock, a.exit, ...mid, b.entry, b.dock]);
      legs.push(makeLeg(pts));
      dilate([a.exit, ...mid, b.entry], gap, forbid);
    }
    if (ok) return { sig: routeSig(stops), legs, gap };
  }
  // Rien ne passe avec les contraintes : des L simples (ça arrive seulement quand tout est très serré).
  const legs = geos.map((a, i) => {
    const b = geos[(i + 1) % n];
    const S = ahead(a.exit, a.dir, APPROACH), T = ahead(b.entry, b.dir, -APPROACH);
    return makeLeg(corners([a.dock, a.exit, ...fallback(S, T), b.entry, b.dock]));
  });
  return { sig: routeSig(stops), legs, gap: 0 };
}

export function makeLeg(pts: Pt[]): LegRoute {
  const steps = stepsOf(pts);
  return { pts, steps, len: steps.length, tunnels: [] };
}

/** Les cases d'une voie (avec le coin extérieur des virages), et leur sens. */
export function laneCells(leg: LegRoute, into: LaneMap): void {
  for (let i = 0; i < leg.steps.length; i++) {
    const st = leg.steps[i];
    const [ax, ay, bx, by] = stepCells(st.x, st.y, st.d);
    const mask = st.d % 2 === 0 ? 1 : 2;
    into.set(key(ax, ay), (into.get(key(ax, ay)) ?? 0) | mask);
    into.set(key(bx, by), (into.get(key(bx, by)) ?? 0) | mask);
  }
}

/**
 * Tunnels d'un trajet : la voie descend sous ce qu'elle croise (machine, tapis), 2 à 3 cases avant,
 * et remonte autant après. Jamais sur le quai lui-même.
 */
export function computeTunnels(leg: LegRoute, world: RouteWorld): [number, number][] {
  const runs: [number, number][] = [];
  const lo = 2, hi = leg.len - 2; // les 2 pas du quai, à chaque bout
  for (const st of leg.steps) {
    if (st.s < lo || st.s >= hi) continue;
    const [ax, ay, bx, by] = stepCells(st.x, st.y, st.d);
    if (!world.occupied(ax, ay) && !world.occupied(bx, by)) continue;
    const last = runs[runs.length - 1];
    if (last && st.s <= last[1] + 0.01) last[1] = st.s + 1;
    else runs.push([st.s, st.s + 1]);
  }
  const out: [number, number][] = [];
  for (const [a, b] of runs) {
    const t: [number, number] = [Math.max(lo, a - TUNNEL_MARGIN), Math.min(hi, b + TUNNEL_MARGIN)];
    const prev = out[out.length - 1];
    // Deux tunnels trop proches n'en font qu'un.
    if (prev && t[0] - prev[1] < 3) prev[1] = Math.max(prev[1], t[1]);
    else out.push(t);
  }
  return out;
}

export function inTunnel(leg: LegRoute, s: number): boolean {
  for (const [a, b] of leg.tunnels) if (s > a && s < b) return true;
  return false;
}

/** Croisements à la surface entre voies (de lignes différentes, ou deux trajets d'une même ligne). */
export function computeCrossings(lines: { id: number; kind: LaneKind; route: LineRoute }[]): Crossing[] {
  type E = { line: number; leg: number; s: number; axis: Axis; kind: LaneKind };
  const at = new Map<number, E[]>();
  for (const l of lines) {
    l.route.legs.forEach((leg, li) => {
      for (const st of leg.steps) {
        if (inTunnel(leg, st.s + 0.5)) continue;
        const [ax, ay, bx, by] = stepCells(st.x, st.y, st.d);
        for (const k of [key(ax, ay), key(bx, by)]) {
          let arr = at.get(k);
          if (!arr) { arr = []; at.set(k, arr); }
          arr.push({ line: l.id, leg: li, s: st.s, axis: axisOf(st.d), kind: l.kind });
        }
      }
    });
  }
  const hot = new Set<number>();
  for (const [k, arr] of at) {
    const owners = new Set(arr.map((e) => `${e.line}:${e.leg}`));
    if (owners.size >= 2) hot.add(k);
  }
  const out: Crossing[] = [];
  const seen = new Set<number>();
  let id = 1;
  for (const k of hot) {
    if (seen.has(k)) continue;
    // Les cases d'un même croisement se touchent.
    const group: number[] = [];
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const c = stack.pop()!;
      group.push(c);
      const cx = Math.floor(c / 65536) - 32768, cy = (c % 65536) - 32768;
      for (let d = 0; d < 4; d++) {
        const nk = key(cx + DX[d], cy + DY[d]);
        if (hot.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    const members = new Map<string, CrossMember>();
    let sx = 0, sy = 0;
    for (const c of group) {
      sx += Math.floor(c / 65536) - 32768 + 0.5; sy += (c % 65536) - 32768 + 0.5;
      for (const e of at.get(c)!) {
        const id2 = `${e.line}:${e.leg}`;
        const m = members.get(id2);
        if (!m) members.set(id2, { line: e.line, leg: e.leg, sIn: e.s, sOut: e.s + 1, axis: e.axis, kind: e.kind });
        else { m.sIn = Math.min(m.sIn, e.s); m.sOut = Math.max(m.sOut, e.s + 1); }
      }
    }
    const ms = [...members.values()];
    const trains = ms.filter((m) => m.kind === 'train').length;
    const kind: CrossKind = trains === 0 ? 'carrefour' : trains === ms.length ? 'rails' : 'niveau';
    out.push({ id: id++, kind, x: sx / group.length, y: sy / group.length, cells: group, members: ms });
  }
  return out;
}

/** Position (en cases) et sens à une distance s le long d'un trajet. */
export function pointAt(leg: LegRoute, s: number): { x: number; y: number; a: number } {
  const n = leg.steps.length;
  if (!n) return { x: leg.pts[0]?.x ?? 0, y: leg.pts[0]?.y ?? 0, a: 0 };
  const c = Math.max(0, Math.min(n - 1e-6, s));
  const i = Math.floor(c), st = leg.steps[i], u = c - i;
  return { x: st.x + DX[st.d] * u, y: st.y + DY[st.d] * u, a: Math.atan2(DY[st.d], DX[st.d]) };
}
