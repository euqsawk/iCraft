// Rendu du monde avec PixiJS : sol, filons, tapis, machines, objets, robot, brouillard.
import { Application, CanvasSource, Container, Graphics, RenderTexture, Sprite, Text, Texture, TilingSprite, type ICanvas } from 'pixi.js';

/** Les types DOM et ceux de PixiJS divergent sur getContext('webgpu') : simple conversion. */
const asCanvas = (c: HTMLCanvasElement) => c as unknown as ICanvas;
import { BIOME_COLORS, CELL, CHUNK, PALETTE } from '../config.ts';
import { item, ITEM_LIST } from '../data/items.ts';
import { machineDef } from '../data/machines.ts';
import type { Belt, Machine } from '../sim/factory.ts';
import type { Game } from '../sim/game.ts';
import { DX, DY } from '../sim/geom.ts';
import { orderProgress } from '../sim/orders.ts';
import type { BeltTracer } from '../sim/tracer.ts';
import { chunkKey, patchRadius, type Patch } from '../world/world.ts';
import { hashString, rng } from '../world/rng.ts';
import { Camera } from './camera.ts';
import { dashedPolyline, drawItem, drawMachineBody, drawMachineIcon, roundRectPoints } from './draw.ts';

/** Contour d'un rectangle arrondi qui part du milieu du bord haut, dans le sens des aiguilles d'une montre. */
function trackPoints(x: number, y: number, w: number, h: number, r: number): { x: number; y: number }[] {
  const pts = roundRectPoints(x, y, w, h, r);
  const top = { x: x + w / 2, y };
  return [top, ...pts, top];
}

/** Début d'une ligne brisée, sur une fraction de sa longueur. */
function partialPolyline(pts: { x: number; y: number }[], frac: number): { x: number; y: number }[] {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let left = total * Math.min(1, frac);
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d >= left) {
      const k = d ? left / d : 0;
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      return out;
    }
    out.push(b);
    left -= d;
  }
  return out;
}

const FONT = "Nunito, ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";

export type Preview =
  | { kind: 'trace'; tracer: BeltTracer }
  | { kind: 'place'; type: string; x: number; y: number; ok: boolean; ore?: string }
  | { kind: 'erase'; x: number; y: number }
  | null;

export type Selection = { kind: 'machine'; id: number } | { kind: 'belt'; x: number; y: number } | { kind: 'robot' } | null;

interface ChunkView {
  ground: Sprite;
  filons: Graphics;
  fog: Sprite | Graphics;
  fogVersion: number;
}

interface MachineView {
  root: Container;
  body: Graphics;
  icon: Container;
  badge: Graphics;
  lamp: Graphics;
  label: Text | null;
  built: boolean;
  ore?: string;
  made: number;
  pop: number;
  status: string;
}

export class GameRenderer {
  readonly app: Application;
  readonly camera = new Camera();
  private game: Game;
  private worldLayer = new Container();
  private groundLayer = new Container();
  private dots!: TilingSprite;
  private filonLayer = new Container();
  private beltG = new Graphics();
  private ghostBeltG = new Graphics();
  private machineLayer = new Container();
  private itemLayer = new Container();
  private actorLayer = new Container();
  private fx = new Graphics();
  private fogLayer = new Container();
  private overlay = new Graphics();
  private chunks = new Map<string, ChunkView>();
  private machineViews = new Map<number, MachineView>();
  private noyauView: { root: Container; ring: Graphics; badge: Graphics; progress: number; pulse: number } | null = null;
  private itemTextures = new Map<string, Texture>();
  private itemPool: Sprite[] = [];
  private robotView!: { root: Container; body: Container; beam: Graphics; glow: Graphics; flip: Container };
  private droneViews: Container[] = [];
  private beltsDirty = true;
  private time = 0;
  preview: Preview = null;
  selection: Selection = null;
  /** Loupe : ce qui se passe sous le doigt, agrandi dans un coin de l'écran. */
  loupe: { fx: number; fy: number; x: number; y: number } | null = null;
  static readonly LOUPE = 140;
  private loupeLayer = new Container();
  private loupeRT!: RenderTexture;
  /** Lignes d'alignement à dessiner pendant la pose d'une machine. */
  guides: { x0: number; y0: number; x1: number; y1: number }[] = [];

  constructor(app: Application, game: Game) {
    this.app = app;
    this.game = game;
    app.stage.addChild(this.worldLayer);
    this.worldLayer.addChild(this.groundLayer);
    const dotTex = this.makeDotTexture();
    this.dots = new TilingSprite({ texture: dotTex, width: 100, height: 100 });
    this.dots.alpha = 0.5;
    this.worldLayer.addChild(this.dots, this.filonLayer, this.beltG, this.ghostBeltG, this.machineLayer, this.itemLayer, this.actorLayer, this.fx, this.fogLayer, this.overlay);
    for (const d of ITEM_LIST) {
      const g = new Graphics();
      drawItem(g, d.id);
      this.itemTextures.set(d.id, app.renderer.generateTexture({ target: g, resolution: 4, antialias: true }));
      g.destroy();
    }
    this.buildRobot();
    this.buildLoupe();
    game.on((e) => {
      if (e.type === 'factory' || e.type === 'built') this.beltsDirty = true;
      if (e.type === 'deliver' && this.noyauView) this.noyauView.pulse = 1;
    });
    const r = game.robot;
    this.camera.x = ((r.x + 2) / 2) * CELL;
    this.camera.y = ((r.y + 2) / 2) * CELL;
  }

  private buildLoupe(): void {
    const size = GameRenderer.LOUPE;
    this.loupeRT = RenderTexture.create({ width: size, height: size, resolution: this.app.renderer.resolution, antialias: true });
    const frame = new Graphics();
    frame.roundRect(0, 5, size, size, 22).fill(PALETTE.shadow);
    frame.roundRect(-4, -4, size + 8, size + 8, 25).fill(PALETTE.white);
    const sprite = new Sprite(this.loupeRT);
    const mask = new Graphics().roundRect(0, 0, size, size, 20).fill(0xffffff);
    sprite.mask = mask;
    // Repère au centre : le point exact sous le doigt.
    const mark = new Graphics();
    mark.circle(size / 2, size / 2, 7).stroke({ width: 2.5, color: PALETTE.coral });
    mark.circle(size / 2, size / 2, 2).fill(PALETTE.coral);
    this.loupeLayer.addChild(frame, sprite, mask, mark);
    this.loupeLayer.visible = false;
    this.app.stage.addChild(this.loupeLayer);
  }

  private renderLoupe(): void {
    const L = this.loupe;
    this.loupeLayer.visible = !!L;
    if (!L) return;
    const size = GameRenderer.LOUPE, cam = this.camera;
    const w = cam.screenToWorld(L.fx, L.fy);
    const z = Math.min(2.6, Math.max(1.5, cam.zoom * 1.8));
    const wl = this.worldLayer;
    const px = wl.position.x, py = wl.position.y, sc = wl.scale.x;
    wl.scale.set(z);
    wl.position.set(size / 2 - w.x * z, size / 2 - w.y * z);
    this.app.renderer.render({ container: wl, target: this.loupeRT, clear: true, clearColor: PALETTE.ground });
    wl.scale.set(sc);
    wl.position.set(px, py);
    this.loupeLayer.position.set(L.x, L.y);
  }

  /** Recentre la caméra sur le robot. */
  centerOnRobot(): void {
    this.camera.x = this.game.robot.x * CELL;
    this.camera.y = this.game.robot.y * CELL;
  }

  private makeDotTexture(): Texture {
    const c = document.createElement('canvas');
    const s = 4; // résolution
    c.width = CELL * s; c.height = CELL * s;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#7fa593';
    ctx.beginPath();
    ctx.arc((CELL / 2) * s, (CELL / 2) * s, 1.3 * s, 0, Math.PI * 2);
    ctx.fill();
    const source = new CanvasSource({ resource: asCanvas(c), resolution: s });
    return new Texture({ source });
  }

  // ---------- Chunks : sol, filons, brouillard ----------

  private updateChunks(): void {
    const b = this.camera.bounds(CELL * 2);
    const cx0 = Math.floor(b.x0 / (CHUNK * CELL)), cx1 = Math.floor(b.x1 / (CHUNK * CELL));
    const cy0 = Math.floor(b.y0 / (CHUNK * CELL)), cy1 = Math.floor(b.y1 / (CHUNK * CELL));
    const keep = new Set<string>();
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = chunkKey(cx, cy);
        keep.add(k);
        let v = this.chunks.get(k);
        if (!v) { v = this.createChunk(cx, cy); this.chunks.set(k, v); }
        const ver = this.game.world.fogVersion.get(k) ?? 0;
        if (ver !== v.fogVersion) this.refreshFog(cx, cy, v, ver);
      }
    }
    if (this.chunks.size > keep.size + 24) {
      for (const [k, v] of this.chunks) {
        if (keep.has(k)) continue;
        v.ground.destroy({ texture: true, textureSource: true });
        v.filons.destroy();
        v.fog.destroy(v.fog instanceof Sprite ? { texture: true, textureSource: true } : undefined);
        this.chunks.delete(k);
      }
    }
  }

  /** Texture de (CHUNK + 2)² pixels, un pixel par case, avec une bordure pour des raccords sans couture. */
  private chunkTexture(cx: number, cy: number, fill: (x: number, y: number) => [number, number]): Texture {
    const n = CHUNK + 2;
    const c = document.createElement('canvas');
    c.width = n; c.height = n;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(n, n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const [color, alpha] = fill(cx * CHUNK + i - 1, cy * CHUNK + j - 1);
        const o = (j * n + i) * 4;
        img.data[o] = (color >> 16) & 255; img.data[o + 1] = (color >> 8) & 255; img.data[o + 2] = color & 255;
        img.data[o + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const source = new CanvasSource({ resource: asCanvas(c), scaleMode: 'linear' });
    return new Texture({ source, frame: { x: 1, y: 1, width: CHUNK, height: CHUNK } as never });
  }

  private createChunk(cx: number, cy: number): ChunkView {
    const w = this.game.world;
    const groundTex = this.chunkTexture(cx, cy, (x, y) => [BIOME_COLORS[w.biomeAt(x, y)], 1]);
    const ground = new Sprite(groundTex);
    ground.position.set(cx * CHUNK * CELL, cy * CHUNK * CELL);
    ground.scale.set(CELL);
    this.groundLayer.addChild(ground);

    const filons = new Graphics();
    for (const p of w.patchesInChunk(cx, cy)) this.drawPatch(filons, p);
    this.filonLayer.addChild(filons);

    const fog = new Graphics();
    fog.rect(cx * CHUNK * CELL, cy * CHUNK * CELL, CHUNK * CELL, CHUNK * CELL).fill({ color: PALETTE.fog, alpha: 0.96 });
    this.fogLayer.addChild(fog);
    return { ground, filons, fog, fogVersion: 0 };
  }

  private refreshFog(cx: number, cy: number, v: ChunkView, ver: number): void {
    const w = this.game.world;
    const tex = this.chunkTexture(cx, cy, (x, y) => [PALETTE.fog, w.isRevealed(x, y) ? 0 : 0.96]);
    const s = new Sprite(tex);
    s.position.set(cx * CHUNK * CELL, cy * CHUNK * CELL);
    s.scale.set(CELL);
    const idx = this.fogLayer.getChildIndex(v.fog);
    this.fogLayer.addChildAt(s, idx);
    v.fog.destroy(v.fog instanceof Sprite ? { texture: true, textureSource: true } : undefined);
    v.fog = s;
    v.fogVersion = ver;
  }

  private drawPatch(g: Graphics, p: Patch): void {
    const d = item(p.type);
    const pts: number[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r = (patchRadius(p, a) + 0.3) * CELL;
      pts.push(p.cx * CELL + Math.cos(a) * r, p.cy * CELL + Math.sin(a) * r);
    }
    g.poly(pts).fill(d.patch ?? 0xcccccc);
    const rand = rng(hashString(p.id));
    const n = p.richness === 'riche' ? 9 : p.richness === 'normal' ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * p.r * 0.85 * CELL;
      g.circle(p.cx * CELL + Math.cos(a) * rr, p.cy * CELL + Math.sin(a) * rr, 2.5 + rand() * 1.8).fill(d.color);
    }
    if (p.richness === 'riche') {
      for (let i = 0; i < 3; i++) {
        const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * p.r * 0.7 * CELL;
        const x = p.cx * CELL + Math.cos(a) * rr, y = p.cy * CELL + Math.sin(a) * rr;
        g.poly([x, y - 4, x + 1.2, y - 1.2, x + 4, y, x + 1.2, y + 1.2, x, y + 4, x - 1.2, y + 1.2, x - 4, y, x - 1.2, y - 1.2]).fill(0xffffff);
      }
    }
  }

  // ---------- Tapis ----------

  private beltPath(b: { x: number; y: number; dir: number; inDir: number }): { x: number; y: number }[] {
    const cx = (b.x + 0.5) * CELL, cy = (b.y + 0.5) * CELL, h = CELL / 2;
    return [
      { x: cx - DX[b.inDir] * h, y: cy - DY[b.inDir] * h },
      { x: cx, y: cy },
      { x: cx + DX[b.dir] * h, y: cy + DY[b.dir] * h },
    ];
  }

  private redrawBelts(): void {
    this.beltsDirty = false;
    const g = this.beltG, gg = this.ghostBeltG;
    g.clear(); gg.clear();
    const built: Belt[] = [], ghosts: Belt[] = [];
    for (const b of this.game.factory.belts.values()) (b.built ? built : ghosts).push(b);
    const line = (list: Belt[], dy: number) => {
      for (const b of list) {
        const p = this.beltPath(b);
        g.moveTo(p[0].x, p[0].y + dy).lineTo(p[1].x, p[1].y + dy).lineTo(p[2].x, p[2].y + dy);
        if (b.split !== undefined) {
          g.moveTo(p[1].x, p[1].y + dy).lineTo(p[1].x + DX[b.split] * CELL / 2, p[1].y + DY[b.split] * CELL / 2 + dy);
        }
      }
    };
    line(built, 3);
    g.stroke({ width: 14, color: PALETTE.shadow, cap: 'round', join: 'round' });
    line(built, 0);
    g.stroke({ width: 14, color: PALETTE.white, cap: 'round', join: 'round' });
    // Rouleaux discrets : un chevron par case, dans le sens du tapis.
    for (const b of built) {
      const cx = (b.x + 0.5) * CELL, cy = (b.y + 0.5) * CELL;
      const fx = DX[b.dir], fy = DY[b.dir];
      const px = -fy, py = fx;
      g.moveTo(cx - fx * 2 + px * 3.2, cy - fy * 2 + py * 3.2).lineTo(cx + fx * 1.2, cy + fy * 1.2).lineTo(cx - fx * 2 - px * 3.2, cy - fy * 2 - py * 3.2);
    }
    g.stroke({ width: 2, color: PALETTE.roller, cap: 'round', join: 'round' });
    // Séparateurs : un losange blanc cerclé (comme sur la maquette).
    for (const b of built) {
      if (b.split === undefined) continue;
      const cx = (b.x + 0.5) * CELL, cy = (b.y + 0.5) * CELL;
      g.poly([cx, cy - 9, cx + 9, cy, cx, cy + 9, cx - 9, cy]).fill(PALETTE.white).stroke({ width: 2, color: PALETTE.ink, join: 'round' });
    }
    for (const b of ghosts) dashedPolyline(gg, this.beltPath(b), 6, 5);
    gg.stroke({ width: 11, color: PALETTE.white, alpha: 0.9, cap: 'round' });
    for (const b of ghosts) dashedPolyline(gg, this.beltPath(b), 6, 5);
    gg.stroke({ width: 2, color: PALETTE.ink, alpha: 0.18, cap: 'round' });
  }

  private drawItems(): void {
    const b = this.camera.bounds(CELL);
    let used = 0;
    for (const belt of this.game.factory.belts.values()) {
      if (!belt.built || belt.items.length === 0) continue;
      const bx = (belt.x + 0.5) * CELL, by = (belt.y + 0.5) * CELL;
      if (bx < b.x0 || bx > b.x1 || by < b.y0 || by > b.y1) continue;
      for (const it of belt.items) {
        let x: number, y: number;
        const p = Math.min(it.p, 1);
        if (p < 0.5) {
          const t = p * 2 - 1;
          x = bx + DX[belt.inDir] * t * CELL / 2; y = by + DY[belt.inDir] * t * CELL / 2;
        } else {
          const t = (p - 0.5) * 2;
          const d = it.o && belt.split !== undefined ? belt.split : belt.dir;
          x = bx + DX[d] * t * CELL / 2; y = by + DY[d] * t * CELL / 2;
        }
        let s = this.itemPool[used];
        if (!s) { s = new Sprite(); s.anchor.set(0.5); this.itemLayer.addChild(s); this.itemPool.push(s); }
        s.texture = this.itemTextures.get(it.t)!;
        s.position.set(x, y);
        s.visible = true;
        used++;
      }
    }
    for (let i = used; i < this.itemPool.length; i++) this.itemPool[i].visible = false;
  }

  // ---------- Machines ----------

  private makeLabel(text: string): Text {
    const t = new Text({ text, style: { fontFamily: FONT, fontSize: 11, fontWeight: '800', fill: PALETTE.ink2 }, resolution: 3 });
    t.anchor.set(0.5, 1);
    return t;
  }

  private buildMachineView(m: Machine): MachineView {
    const def = machineDef(m.type);
    const root = new Container();
    const body = new Graphics();
    const icon = new Container();
    const iconG = new Graphics();
    icon.addChild(iconG);
    const badge = new Graphics();
    const W = def.w * CELL, H = def.h * CELL;
    const isDrill = def.kind === 'drill';
    const bw = isDrill ? W - 8 : W - 2, bh = isDrill ? H - 8 : H - 2, br = isDrill ? 12 : def.w === 1 ? 7 : 15;
    if (m.built) {
      drawMachineBody(body, bw, bh, br);
    } else {
      body.roundRect(-bw / 2, -bh / 2, bw, bh, br).fill({ color: PALETTE.white, alpha: 0.45 });
      dashedPolyline(body, roundRectPoints(-bw / 2, -bh / 2, bw, bh, br), 6, 5, true);
      body.stroke({ width: 2, color: PALETTE.ink, alpha: 0.45 });
      icon.alpha = 0.4;
    }
    drawMachineIcon(iconG, m.type, m.ore);
    // Voyant du charbon, en haut à gauche : il clignote quand la machine en manque.
    const lamp = new Graphics();
    lamp.circle(-bw / 2 + 7, -bh / 2 + 7, 4.5).fill(0xffffff).circle(-bw / 2 + 7, -bh / 2 + 7, 3).fill(PALETTE.coral);
    lamp.visible = false;
    root.addChild(body, icon, badge, lamp);
    let label: Text | null = null;
    const name = isDrill && m.ore ? item(m.ore).name.replace('Minerai de ', '').replace("Minerai d'", '').replace(/^./, (c) => c.toUpperCase()) : def.name;
    label = this.makeLabel(name);
    label.position.set(0, -bh / 2 - 4);
    root.addChild(label);
    root.position.set((m.x + def.w / 2) * CELL, (m.y + def.h / 2) * CELL);
    this.machineLayer.addChild(root);
    return { root, body, icon, badge, lamp, label, built: m.built, ore: m.ore, made: m.made, pop: 0, status: '' };
  }

  private buildNoyau(m: Machine): void {
    // Le Noyau est carré et remplit ses 4 × 4 cases : un tapis peut y entrer par n'importe quel côté, coins compris.
    const root = new Container();
    const ring = new Graphics();
    const body = new Graphics();
    const S = m.w * CELL;
    body.roundRect(-S / 2 + 12, -S / 2 + 16, S - 24, S - 24, 16).fill(0xd8644d);
    body.roundRect(-S / 2 + 12, -S / 2 + 12, S - 24, S - 24, 16).fill(PALETTE.coral);
    const t = new Text({ text: 'Noyau', style: { fontFamily: FONT, fontSize: 13, fontWeight: '900', fill: 0xffffff }, resolution: 3 });
    t.anchor.set(0.5);
    const badge = new Graphics();
    root.addChild(ring, body, t, badge);
    root.position.set((m.x + m.w / 2) * CELL, (m.y + m.h / 2) * CELL);
    this.machineLayer.addChild(root);
    this.noyauView = { root, ring, badge, progress: -1, pulse: 0 };
  }

  private updateMachines(dt: number): void {
    const seen = new Set<number>();
    for (const m of this.game.factory.machines.values()) {
      seen.add(m.id);
      if (m.type === 'noyau') {
        if (!this.noyauView) this.buildNoyau(m);
        continue;
      }
      let v = this.machineViews.get(m.id);
      if (v && (v.built !== m.built || v.ore !== m.ore)) {
        v.root.destroy({ children: true });
        this.machineViews.delete(m.id);
        v = undefined;
      }
      if (!v) { v = this.buildMachineView(m); this.machineViews.set(m.id, v); }
      const def = machineDef(m.type);
      v.root.position.set((m.x + def.w / 2) * CELL, (m.y + def.h / 2) * CELL);
      if (m.made !== v.made) { v.made = m.made; v.pop = 1; }
      v.pop = Math.max(0, v.pop - dt * 4);
      const s = 1 + Math.sin(v.pop * Math.PI) * 0.16;
      v.icon.scale.set(s);
      if (m.type === 'four' && m.status === 'working') v.icon.y = Math.sin(this.time * 9) * 0.6;
      if (v.label) v.label.visible = this.camera.zoom > 0.6;
      const low = this.game.factory.lowFuel(m);
      v.lamp.visible = low && Math.sin(this.time * (m.fuel <= 0 && m.burn <= 0 ? 12 : 6)) > -0.2;
      if (m.status !== v.status) {
        v.status = m.status;
        v.badge.clear();
        if (m.built && m.status === 'blocked') {
          const x = def.w * CELL / 2 - 4, y = -def.h * CELL / 2 + 4;
          v.badge.circle(x, y, 8).fill(0xffffff).stroke({ width: 2, color: PALETTE.coral });
          v.badge.rect(x - 3, y - 3.5, 2, 7).rect(x + 1, y - 3.5, 2, 7).fill(PALETTE.coral);
        }
      }
    }
    for (const [id, v] of this.machineViews) {
      if (!seen.has(id)) { v.root.destroy({ children: true }); this.machineViews.delete(id); }
    }
    // Noyau : anneau de progression de la commande.
    const nv = this.noyauView;
    if (nv) {
      const o = this.game.order;
      const prog = o ? orderProgress(o) : 0;
      if (Math.abs(prog - nv.progress) > 0.001) {
        nv.progress = prog;
        nv.ring.clear();
        const S = 4 * CELL, r = 22, x0 = -S / 2 + 4;
        const track = trackPoints(x0, x0, S - 8, S - 8, r);
        nv.ring.roundRect(x0, x0 + 4, S - 8, S - 8, r).stroke({ width: 8, color: PALETTE.shadow });
        nv.ring.roundRect(x0, x0, S - 8, S - 8, r).stroke({ width: 8, color: PALETTE.white });
        if (prog > 0) {
          const part = partialPolyline(track, prog);
          nv.ring.moveTo(part[0].x, part[0].y);
          for (const q of part.slice(1)) nv.ring.lineTo(q.x, q.y);
          nv.ring.stroke({ width: 8, color: PALETTE.coral, cap: 'round', join: 'round' });
        }
      }
      nv.pulse = Math.max(0, nv.pulse - dt * 3);
      nv.root.scale.set(1 + nv.pulse * 0.04);
      nv.badge.clear();
      if (!o) {
        const b = 1 + Math.sin(this.time * 5) * 0.12;
        nv.badge.circle(42, -42, 11 * b).fill(PALETTE.yellow).stroke({ width: 2.5, color: PALETTE.ink });
        nv.badge.roundRect(40.5, -49, 3, 9, 1.5).fill(PALETTE.ink).circle(42, -36, 1.8).fill(PALETTE.ink);
      }
    }
  }

  // ---------- Robot et drones ----------

  private buildRobot(): void {
    const root = new Container();
    const shadow = new Graphics().ellipse(0, 1, 17, 4).fill(PALETTE.shadow);
    const flip = new Container();
    const body = new Container();
    const beam = new Graphics().poly([10, -20, 34, -40, 46, -26]).fill(PALETTE.beam);
    const g = new Graphics();
    g.roundRect(-13, -32, 26, 26, 6).fill(PALETTE.yellow);
    g.roundRect(-13, -32, 26, 8, 4).fill(PALETTE.yellowLight);
    g.circle(-8, -3, 4).fill(PALETTE.ink).circle(8, -3, 4).fill(PALETTE.ink);
    const glow = new Graphics().circle(10, -20, 9).fill({ color: PALETTE.yellow, alpha: 0.5 });
    const lamp = new Graphics().circle(10, -20, 5).fill(PALETTE.lamp).stroke({ width: 2.5, color: PALETTE.ink });
    body.addChild(g, glow, lamp);
    flip.addChild(beam, body);
    root.addChild(shadow, flip);
    this.actorLayer.addChild(root);
    this.robotView = { root, body, beam, glow, flip };
  }

  private makeDroneView(): Container {
    const d = new Container();
    const dg = new Graphics();
    dg.circle(0, 0, 7).fill(0xffffff).stroke({ width: 2, color: PALETTE.ink });
    dg.moveTo(-10, -9).lineTo(10, -9).stroke({ width: 2, color: PALETTE.ink, cap: 'round' });
    dg.moveTo(0, -7).lineTo(0, -9).stroke({ width: 2, color: PALETTE.ink });
    dg.circle(0, 0, 2.5).fill(PALETTE.yellow);
    const cargo = new Sprite();
    cargo.anchor.set(0.5);
    cargo.position.set(0, 12);
    cargo.label = 'cargo';
    d.addChild(cargo, dg);
    this.actorLayer.addChild(d);
    return d;
  }

  private updateActors(): void {
    while (this.droneViews.length < this.game.drones.length) this.droneViews.push(this.makeDroneView());
    while (this.droneViews.length > this.game.drones.length) this.droneViews.pop()!.destroy({ children: true });
    const r = this.game.robot, v = this.robotView;
    v.root.position.set(r.x * CELL, r.y * CELL);
    v.flip.scale.x = Math.cos(r.heading) < -0.1 ? -1 : 1;
    v.body.y = r.moving ? Math.abs(Math.sin(this.time * 14)) * -1.5 : 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * (Math.PI * 2 / 1.8));
    v.beam.alpha = 0.5 + 0.35 * pulse;
    v.glow.alpha = 0.4 + 0.6 * pulse;
    v.glow.scale.set(1);
    // Le robot mine : il tremble un peu, et chaque objet trouvé saute au-dessus de lui.
    v.body.x = r.mining ? Math.sin(this.time * 40) * 0.8 : 0;
    if (r.mined !== this.lastMined) {
      if (r.mined > this.lastMined && r.mining) this.spawnPop(r.mining, r.x * CELL, r.y * CELL - 36);
      this.lastMined = r.mined;
    }
    this.updatePops();
    this.game.drones.forEach((d, i) => {
      const dv = this.droneViews[i];
      if (d.state === 'parked') {
        dv.position.set(r.x * CELL + (i - (this.game.drones.length - 1) / 2) * 14, r.y * CELL + v.body.y - 40);
        dv.alpha = 0.75;
      } else {
        dv.position.set(d.x * CELL, d.y * CELL - 22 + Math.sin(this.time * 4 + i) * 2.5);
        dv.alpha = 1;
      }
      const cargo = dv.getChildByLabel('cargo') as Sprite;
      cargo.visible = !!d.cargo;
      if (d.cargo) cargo.texture = this.itemTextures.get(d.cargo.t)!;
    });
    // Faisceaux de construction : pointillés du drone vers le chantier.
    const fx = this.fx;
    fx.clear();
    for (const d of this.game.drones) {
      if (d.state !== 'work' || d.task?.kind !== 'build') continue;
      const p = this.game.jobPos(d.task.job);
      if (!p) continue;
      dashedPolyline(fx, [{ x: d.x * CELL, y: d.y * CELL - 14 }, { x: p.x * CELL, y: p.y * CELL }], 3, 3);
    }
    fx.stroke({ width: 2, color: PALETTE.ink, alpha: 0.35 });
    // Le robot construit lui-même : faisceau jaune depuis son phare.
    if (this.game.robotBuilding && this.game.robotJob) {
      const p = this.game.jobPos(this.game.robotJob);
      if (p) {
        const lx = r.x * CELL + 10 * v.flip.scale.x, ly = r.y * CELL - 20 + v.body.y;
        dashedPolyline(fx, [{ x: lx, y: ly }, { x: p.x * CELL, y: p.y * CELL }], 4, 3);
        fx.stroke({ width: 3, color: PALETTE.yellow, alpha: 0.9, cap: 'round' });
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 12);
        fx.circle(p.x * CELL, p.y * CELL, 5 + pulse * 3).fill({ color: PALETTE.yellow, alpha: 0.5 });
      }
    }
  }

  private lastMined = 0;
  private pops: { s: Sprite; t: number }[] = [];

  private spawnPop(itemId: string, x: number, y: number): void {
    const s = new Sprite(this.itemTextures.get(itemId)!);
    s.anchor.set(0.5);
    s.position.set(x, y);
    this.actorLayer.addChild(s);
    this.pops.push({ s, t: 0 });
  }

  private updatePops(): void {
    for (const p of this.pops) {
      p.t += 1 / 60;
      p.s.y -= 0.5;
      p.s.alpha = Math.max(0, 1 - p.t / 0.9);
      p.s.scale.set(1 + p.t * 0.4);
    }
    this.pops = this.pops.filter((p) => {
      if (p.t < 0.9) return true;
      p.s.destroy();
      return false;
    });
  }

  // ---------- Superpositions : tracé en cours, pose, gomme, sélection ----------

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const pv = this.preview;
    if (pv?.kind === 'trace') {
      const cells = pv.tracer.result();
      const ok = pv.tracer.valid && !pv.tracer.blocked;
      for (const c of cells) {
        const p = this.beltPath(c);
        g.moveTo(p[0].x, p[0].y).lineTo(p[1].x, p[1].y).lineTo(p[2].x, p[2].y);
      }
      g.stroke({ width: 14, color: ok ? PALETTE.white : 0xffd9d0, alpha: 0.95, cap: 'round', join: 'round' });
      for (const c of cells) dashedPolyline(g, this.beltPath(c), 6, 5);
      g.stroke({ width: 2.5, color: ok ? PALETTE.ink : PALETTE.coral, alpha: 0.45, cap: 'round' });
      const last = cells[cells.length - 1];
      if (last) {
        const cx = (last.x + 0.5) * CELL + DX[last.dir] * 9, cy = (last.y + 0.5) * CELL + DY[last.dir] * 9;
        const fx = DX[last.dir], fy = DY[last.dir];
        g.poly([cx + fx * 6, cy + fy * 6, cx - fy * 6, cy + fx * 6, cx + fy * 6, cy - fx * 6]).fill(ok ? PALETTE.ink : PALETTE.coral);
      }
      if (pv.tracer.endTarget) {
        const t = pv.tracer.endTarget;
        g.circle((t.x + 0.5) * CELL, (t.y + 0.5) * CELL, 5).fill(PALETTE.coral);
      }
    } else if (pv?.kind === 'place') {
      const def = machineDef(pv.type);
      const W = def.w * CELL, H = def.h * CELL;
      const x = pv.x * CELL, y = pv.y * CELL;
      for (const gd of this.guides) {
        dashedPolyline(g, [{ x: gd.x0, y: gd.y0 }, { x: gd.x1, y: gd.y1 }], 5, 5);
      }
      g.stroke({ width: 2, color: PALETTE.coral, alpha: 0.8 });
      g.roundRect(x + 1, y + 1, W - 2, H - 2, 15).fill({ color: pv.ok ? PALETTE.white : 0xffd9d0, alpha: 0.85 });
      dashedPolyline(g, roundRectPoints(x + 1, y + 1, W - 2, H - 2, 15), 6, 5, true);
      g.stroke({ width: 2, color: pv.ok ? PALETTE.ink : PALETTE.coral, alpha: 0.6 });
    } else if (pv?.kind === 'erase') {
      g.circle((pv.x + 0.5) * CELL, (pv.y + 0.5) * CELL, CELL * 0.8).fill({ color: PALETTE.coral, alpha: 0.25 }).stroke({ width: 2, color: PALETTE.coral });
    }
    const sel = this.selection;
    if (sel?.kind === 'robot') {
      const r = this.game.robot;
      dashedPolyline(g, Array.from({ length: 33 }, (_, i) => ({ x: r.x * CELL + Math.cos(i / 32 * Math.PI * 2) * 26, y: r.y * CELL - 16 + Math.sin(i / 32 * Math.PI * 2) * 26 })), 5, 4);
      g.stroke({ width: 2.5, color: PALETTE.coral });
    } else if (sel?.kind === 'machine') {
      const m = this.game.factory.machines.get(sel.id);
      if (m) {
        const pad = 5;
        dashedPolyline(g, roundRectPoints(m.x * CELL - pad, m.y * CELL - pad, m.w * CELL + pad * 2, m.h * CELL + pad * 2, 18), 6, 4, true);
        g.stroke({ width: 2.5, color: PALETTE.coral });
      }
    } else if (sel?.kind === 'belt') {
      const b = this.game.factory.beltAt(sel.x, sel.y);
      if (b) {
        for (const c of this.game.factory.chainOf(b)) {
          const p = this.beltPath(c);
          g.moveTo(p[0].x, p[0].y).lineTo(p[1].x, p[1].y).lineTo(p[2].x, p[2].y);
        }
        g.stroke({ width: 20, color: PALETTE.coral, alpha: 0.3, cap: 'round', join: 'round' });
      }
    }
  }

  /** Icône d'une machine en image (pour l'interface HTML). */
  machineIconDataUrl(type: string): string {
    const c = new Container();
    const g = new Graphics();
    drawMachineBody(g, 46, 46, 15);
    const ig = new Graphics();
    drawMachineIcon(ig, type, type === 'foreuse' ? 'fer' : undefined);
    if (type === 'coffre') ig.scale.set(1.8);
    c.addChild(g, ig);
    const canvas = this.app.renderer.extract.canvas({ target: c, resolution: 3 }) as HTMLCanvasElement;
    c.destroy({ children: true });
    return canvas.toDataURL();
  }

  itemIconDataUrl(id: string): string {
    const g = new Graphics();
    drawItem(g, id);
    const canvas = this.app.renderer.extract.canvas({ target: g, resolution: 4 }) as HTMLCanvasElement;
    g.destroy();
    return canvas.toDataURL();
  }

  // ---------- Image par image ----------

  render(dt: number): void {
    this.time += dt;
    const cam = this.camera;
    cam.setSize(this.app.screen.width, this.app.screen.height);
    this.worldLayer.scale.set(cam.zoom);
    this.worldLayer.position.set(cam.width / 2 - cam.x * cam.zoom, cam.height / 2 - cam.y * cam.zoom);
    const b = cam.bounds(CELL);
    const x0 = Math.floor(b.x0 / CELL) * CELL, y0 = Math.floor(b.y0 / CELL) * CELL;
    this.dots.position.set(x0, y0);
    this.dots.width = Math.ceil((b.x1 - x0) / CELL) * CELL;
    this.dots.height = Math.ceil((b.y1 - y0) / CELL) * CELL;
    this.dots.visible = cam.zoom > 0.5;
    this.updateChunks();
    if (this.beltsDirty) this.redrawBelts();
    this.updateMachines(dt);
    this.drawItems();
    this.updateActors();
    this.drawOverlay();
    this.renderLoupe();
  }
}
