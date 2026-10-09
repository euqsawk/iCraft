// Rendu du monde avec PixiJS : sol, filons, tapis, machines, objets, robot, brouillard.
import { Application, CanvasSource, Container, Graphics, RenderTexture, Sprite, Text, Texture, TilingSprite, type ICanvas } from 'pixi.js';

/** Les types DOM et ceux de PixiJS divergent sur getContext('webgpu') : simple conversion. */
const asCanvas = (c: HTMLCanvasElement) => c as unknown as ICanvas;
import { BIOME_COLORS, CELL, CHUNK, PALETTE, RULES } from '../config.ts';
import { PICKUP_TIME } from '../sim/game.ts';
import { item, ITEM_LIST } from '../data/items.ts';
import { machineDef } from '../data/machines.ts';
import { span, type Belt, type Line, type Machine, type Tunnel } from '../sim/factory.ts';
import type { Game } from '../sim/game.ts';
import { DX, DY, unkey } from '../sim/geom.ts';
import type { CableTracer } from '../sim/cables.ts';
import type { TunnelTracer } from '../sim/tunnels.ts';
import type { BeltTracer } from '../sim/tracer.ts';
import { chunkKey, patchRadius, type Patch } from '../world/world.ts';
import { hashString, rng } from '../world/rng.ts';
import { Camera } from './camera.ts';
import { dashedPolyline, drawBolt, drawItem, drawMachineBody, drawMachineIcon, roundRectPoints } from './draw.ts';
import { PROPELLER, robotShapes, type Shape } from './robotShapes.ts';
import { robotColor } from '../data/look.ts';

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
  | { kind: 'cable'; tracer: CableTracer }
  | { kind: 'tunnel'; tracer: TunnelTracer }
  | { kind: 'place'; type: string; x: number; y: number; ok: boolean; ore?: string }
  | { kind: 'erase'; x: number; y: number }
  | { kind: 'eraseRect'; x0: number; y0: number; x1: number; y1: number }
  | null;

export type Selection = { kind: 'machine'; id: number } | { kind: 'belt'; x: number; y: number } | { kind: 'robot' } | null;

interface ChunkView {
  ground: Sprite;
  filons: Graphics;
  fog: Sprite | Graphics;
  fogVersion: number;
}

interface MachineView {
  /** Revente : remplissage dessiné. */
  fill?: number;
  /** Grand coffre : ce qu'il garde, en petit (et la signature du dernier dessin). */
  shelf?: Container;
  shelfSig?: string;
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
  /** Compteurs posés sur les tapis : un portique au-dessus des objets, et leur débit affiché au-dessus. */
  private meterG = new Graphics();
  private meterLabels = new Container();
  private meterViews = new Map<Belt, { box: Graphics; text: Text; icon: Sprite; sig: string }>();
  private meterT = 0;
  /** Routes et rails (au sol, sous les tapis), et les véhicules qui y roulent. */
  private routeG = new Graphics();
  private routeSig = '';
  private vehicleViews = new Map<string, { root: Container; parts: Container[]; cargo: Sprite; kind: string }>();
  /** Vue du sous-sol (outil Sous-sol) : la surface pâlit, on voit les tapis souterrains et ce qu'ils transportent. */
  underground = false;
  private undergroundOn = false;
  /** Mode électricité (outil Câble) : la surface pâlit, on voit les câbles sous les blocs et les machines alimentées. */
  electric = false;
  /** Câbles visibles hors du mode électricité (gomme) ; sinon ils restent cachés. */
  showCables = false;
  private electricOn = false;
  /** Câbles et machines du réseau, par-dessus le voile, en mode électricité. */
  private powerG = new Graphics();
  private undergroundTint = new Graphics();
  private tunnelG = new Graphics();
  private tunnelItems = new Container();
  private tunnelPool: Sprite[] = [];
  /** En surface : une petite trappe là où un tapis souterrain sort d'une machine ou y entre. */
  private tunnelMarks = new Graphics();
  private tunnelSig = '';
  /** Câbles électriques : au sol, sous les tapis et les machines. */
  private cableG = new Graphics();
  private cableT = 0;
  private cableCount = 0;
  /** Ombres au sol (robot) : sous les machines. */
  private groundShadows = new Container();
  /** Tapis découpés par morceaux de carte (ombres en dessous, bandes blanches au-dessus) : hors écran, on les cache. */
  private beltShadow = new Container();
  private beltTop = new Container();
  private beltChunks = new Map<string, { s: Graphics; t: Graphics; x: number; y: number }>();
  private ghostBeltG = new Graphics();
  /** Raccords entre les tapis et les machines (au-dessus des machines). */
  private portG = new Graphics();
  /** Bouts de tapis entre machines collées : sous les machines, comme les autres tapis. */
  private linkG = new Graphics();
  /** Machines rangées de haut en bas : celle du dessous passe devant (son ombre ne mord pas sur la voisine). */
  private machineLayer = new Container({ sortableChildren: true });
  private itemLayer = new Container();
  /** Ponts : le tablier passe au-dessus des tapis enjambés et de leurs objets ; les objets du pont encore au-dessus. */
  private bridgeG = new Graphics();
  private bridgeItemLayer = new Container();
  private bridgePool: Sprite[] = [];
  private actorLayer = new Container();
  private fx = new Graphics();
  private fogLayer = new Container();
  private overlay = new Graphics();
  private chunks = new Map<string, ChunkView>();
  private machineViews = new Map<number, MachineView>();
  private noyauView: { root: Container; ring: Graphics; badge: Graphics; progress: number; pulse: number } | null = null;
  private itemTextures = new Map<string, Texture>();
  private itemPool: Sprite[] = [];
  private robotView!: { root: Container; shadow: Graphics; body: Container; beam: Graphics; glow: Graphics; flip: Container; shape: Graphics; spin: Graphics; look: string };
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
    app.stage.addChild(this.worldLayer, this.scanLayer);
    this.worldLayer.addChild(this.groundLayer);
    const dotTex = this.makeDotTexture();
    this.dots = new TilingSprite({ texture: dotTex, width: 100, height: 100 });
    this.dots.alpha = 0.5;
    this.worldLayer.addChild(this.dots, this.filonLayer, this.routeG, this.groundShadows, this.cableG, this.beltShadow, this.beltTop, this.linkG, this.ghostBeltG, this.itemLayer, this.bridgeG, this.bridgeItemLayer, this.meterG, this.machineLayer, this.portG, this.tunnelMarks, this.undergroundTint, this.powerG, this.tunnelG, this.tunnelItems, this.meterLabels, this.actorLayer, this.fx, this.fogLayer, this.overlay);
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
      if (e.type === 'deliver' && e.at === 'noyau' && this.noyauView) this.noyauView.pulse = 1;
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
  /** La caméra suit le robot (après un toucher sur la mini-carte), jusqu'à ce que le joueur la déplace. */
  follow = false;

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

  private beltPath(b: { x: number; y: number; dir: number; inDir: number; jump?: number }): { x: number; y: number }[] {
    const cx = (b.x + 0.5) * CELL, cy = (b.y + 0.5) * CELL, h = CELL / 2;
    // Un pont va plus loin, tout droit, jusqu'au bord de la case où il atterrit.
    const e = h + (b.jump ?? 0) * CELL;
    return [
      { x: cx - DX[b.inDir] * h, y: cy - DY[b.inDir] * h },
      { x: cx, y: cy },
      { x: cx + DX[b.dir] * e, y: cy + DY[b.dir] * e },
    ];
  }

  private redrawBelts(): void {
    this.beltsDirty = false;
    const gg = this.ghostBeltG;
    gg.clear();
    const built: Belt[] = [], ghosts: Belt[] = [];
    // Les tapis construits, rangés par morceau de carte.
    const groups = new Map<string, Belt[]>();
    for (const b of this.game.factory.belts.values()) {
      if (!b.built) { ghosts.push(b); continue; }
      built.push(b);
      const k = chunkKey(Math.floor(b.x / CHUNK), Math.floor(b.y / CHUNK));
      let l = groups.get(k);
      if (!l) groups.set(k, l = []);
      l.push(b);
    }
    for (const [k, c] of this.beltChunks) {
      if (groups.has(k)) continue;
      c.s.destroy(); c.t.destroy();
      this.beltChunks.delete(k);
    }
    // Là où le tapis touche une machine, il file sous elle (la machine est dessinée par-dessus) :
    // pas de bout arrondi qui laisserait un vide contre ses coins arrondis.
    const f = this.game.factory;
    const under = (b: Belt, d: number) => (f.machineAt(b.x + DX[d], b.y + DY[d]) ? CELL / 2 : 0);
    const line = (g: Graphics, list: Belt[], dy: number) => {
      for (const b of list) {
        const p = this.beltPath(b);
        const back = (b.inDir + 2) % 4;
        const e0 = under(b, back), e2 = under(b, b.dir);
        // Pont : seule la rampe (jusqu'au milieu de la case) est au sol ; le tablier est dessiné à part, plus haut.
        if (b.jump) { g.moveTo(p[0].x + DX[back] * e0, p[0].y + DY[back] * e0 + dy).lineTo(p[1].x, p[1].y + dy); continue; }
        g.moveTo(p[0].x + DX[back] * e0, p[0].y + DY[back] * e0 + dy).lineTo(p[1].x, p[1].y + dy).lineTo(p[2].x + DX[b.dir] * e2, p[2].y + DY[b.dir] * e2 + dy);
        if (b.split !== undefined && !b.splitJump) {
          const es = CELL / 2 + under(b, b.split);
          g.moveTo(p[1].x, p[1].y + dy).lineTo(p[1].x + DX[b.split] * es, p[1].y + DY[b.split] * es + dy);
        }
        if (b.split2 !== undefined) {
          const es = CELL / 2 + under(b, b.split2);
          g.moveTo(p[1].x, p[1].y + dy).lineTo(p[1].x + DX[b.split2] * es, p[1].y + DY[b.split2] * es + dy);
        }
        // Liaison de côté avec une machine : un bout de tapis qui file sous elle.
        for (const fd of b.feeds ?? []) {
          if (!f.machineAt(b.x + DX[fd], b.y + DY[fd])) continue;
          g.moveTo(p[1].x, p[1].y + dy).lineTo(p[1].x + DX[fd] * CELL, p[1].y + DY[fd] * CELL + dy);
        }
      }
    };
    for (const [k, list] of groups) {
      let c = this.beltChunks.get(k);
      if (!c) {
        const [x, y] = k.split(',').map(Number);
        c = { s: new Graphics(), t: new Graphics(), x, y };
        this.beltShadow.addChild(c.s); this.beltTop.addChild(c.t);
        this.beltChunks.set(k, c);
      }
      const gs = c.s, g = c.t;
      gs.clear(); g.clear();
      line(gs, list, 3);
      gs.stroke({ width: 14, color: PALETTE.shadow, cap: 'round', join: 'round' });
      line(g, list, 0);
      g.stroke({ width: 14, color: PALETTE.white, cap: 'round', join: 'round' });
      // Rouleaux discrets : un chevron par case, dans le sens du tapis.
      for (const b of list) {
        const cx = (b.x + 0.5) * CELL, cy = (b.y + 0.5) * CELL;
        const fx = DX[b.dir], fy = DY[b.dir];
        const px = -fy, py = fx;
        g.moveTo(cx - fx * 2 + px * 3.2, cy - fy * 2 + py * 3.2).lineTo(cx + fx * 1.2, cy + fy * 1.2).lineTo(cx - fx * 2 - px * 3.2, cy - fy * 2 - py * 3.2);
      }
      g.stroke({ width: 2, color: PALETTE.roller, cap: 'round', join: 'round' });
      // Séparateurs : un losange blanc cerclé (comme sur la maquette).
      for (const b of list) {
        if (b.split === undefined) continue;
        // Un tapis qui nourrit une machine par le côté n'est pas un vrai séparateur : pas de losange.
        if (f.machineAt(b.x + DX[b.split], b.y + DY[b.split])) continue;
        const cx = (b.x + 0.5) * CELL, cy = (b.y + 0.5) * CELL;
        g.poly([cx, cy - 9, cx + 9, cy, cx, cy + 9, cx - 9, cy]).fill(PALETTE.white).stroke({ width: 2, color: PALETTE.ink, join: 'round' });
      }
    }
    this.drawBridges(built);
    this.drawMeters();
    for (const b of ghosts) dashedPolyline(gg, this.beltPath(b), 6, 5);
    gg.stroke({ width: 11, color: PALETTE.white, alpha: 0.9, cap: 'round' });
    for (const b of ghosts) dashedPolyline(gg, this.beltPath(b), 6, 5);
    gg.stroke({ width: 2, color: PALETTE.ink, alpha: 0.18, cap: 'round' });
    this.drawPorts();
  }

  /**
   * Raccord propre entre un tapis et une machine : une petite bouche posée sur le bord de la machine,
   * avec un chevron dans le sens du flux (vers la machine pour une entrée, vers le tapis pour une sortie).
   */
  /** Le portique d'un compteur : deux poteaux de part et d'autre du tapis, une barre, un voyant jaune. */
  private drawMeters(): void {
    const g = this.meterG;
    g.clear();
    for (const b of this.game.factory.belts.values()) {
      if (!b.meter) continue;
      const cx = (b.x + 0.5) * CELL, cy = (b.y + 0.5) * CELL;
      const px = -DY[b.dir], py = DX[b.dir];
      g.moveTo(cx + px * 10, cy + py * 10 - 4).lineTo(cx - px * 10, cy - py * 10 - 4).stroke({ width: 5, color: PALETTE.ink, cap: 'round' });
      g.circle(cx + px * 10, cy + py * 10 - 2, 3.2).circle(cx - px * 10, cy - py * 10 - 2, 3.2).fill(PALETTE.ink);
      g.circle(cx, cy - 4, 2.4).fill(PALETTE.yellow);
    }
    this.meterT = 1;
  }

  /** Le débit de chaque compteur, mis à jour deux fois par seconde : « 1,2 /s » et la matière principale. */
  private updateMeterLabels(): void {
    const f = this.game.factory;
    const seen = new Set<Belt>();
    for (const b of f.belts.values()) {
      if (!b.meter) continue;
      seen.add(b);
      let v = this.meterViews.get(b);
      if (!v) {
        const box = new Graphics();
        const text = new Text({ text: '', style: { fontFamily: FONT, fontSize: 10, fontWeight: '800', fill: PALETTE.ink }, resolution: 3 });
        text.anchor.set(0, 0.5);
        const icon = new Sprite();
        icon.anchor.set(0.5);
        icon.scale.set(0.6);
        const c = new Container();
        c.addChild(box, icon, text);
        this.meterLabels.addChild(c);
        v = { box, text, icon, sig: '' };
        this.meterViews.set(b, v);
      }
      const r = f.meterRates(b);
      const main = Object.entries(r.by).sort((a, c) => c[1] - a[1])[0]?.[0];
      const label = `${(Math.round(r.total * 10) / 10).toString().replace('.', ',')} /s`;
      const sig = `${label}|${main ?? ''}`;
      const c = v.box.parent!;
      c.position.set((b.x + 0.5) * CELL, (b.y + 0.5) * CELL - 20);
      if (sig === v.sig) continue;
      v.sig = sig;
      v.text.text = label;
      v.icon.visible = !!main;
      if (main) v.icon.texture = this.itemTextures.get(main)!;
      const iw = main ? 12 : 0, w = iw + v.text.width + 10;
      v.icon.position.set(-w / 2 + 5 + 5, 0);
      v.text.position.set(-w / 2 + 5 + iw, 0);
      v.box.clear().roundRect(-w / 2, -8, w, 16, 8).fill(0xffffff).stroke({ width: 1.5, color: PALETTE.ink, alpha: 0.6 });
    }
    for (const [b, v] of this.meterViews) {
      if (seen.has(b)) continue;
      v.box.parent?.destroy({ children: true });
      this.meterViews.delete(b);
    }
  }

  /** Un point (et l'angle) à la fraction k d'un trajet. */
  private alongPath(pts: { x: number; y: number }[], k: number): { x: number; y: number; a: number } {
    const seg: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); total += d; }
    let dist = Math.max(0, Math.min(1, k)) * total, i = 0;
    while (i < seg.length - 1 && dist > seg[i]) { dist -= seg[i]; i++; }
    const u = seg[i] ? Math.min(1, dist / seg[i]) : 0;
    const p0 = pts[i], p1 = pts[i + 1] ?? pts[i];
    return { x: p0.x + (p1.x - p0.x) * u, y: p0.y + (p1.y - p0.y) * u, a: Math.atan2(p1.y - p0.y, p1.x - p0.x) };
  }

  private drawRoutes(): void {
    const g = this.routeG, f = this.game.factory;
    g.clear();
    const legs: { kind: string; pts: { x: number; y: number }[] }[] = [];
    for (const l of f.lines.values()) {
      for (let i = 0; i < l.stops.length; i++) {
        if (l.stops.length === 2 && i === 1) break;
        const pts = this.legPx(l, i);
        if (pts) legs.push({ kind: l.kind, pts });
      }
    }
    for (const { kind, pts } of legs) {
      if (kind === 'camion') {
        // Route à deux voies : bas-côtés, chaussée, lignes de rive et ligne du milieu en pointillés.
        const line = (o: number) => { const q = offsetPath(pts, o); g.moveTo(q[0].x, q[0].y); for (const p of q.slice(1)) g.lineTo(p.x, p.y); };
        line(0); g.stroke({ width: 32, color: 0x8f9aa6, cap: 'round', join: 'miter' });
        line(0); g.stroke({ width: 28, color: 0xa9b3bd, cap: 'round', join: 'miter' });
        for (const o of [-11.5, 11.5]) { line(o); g.stroke({ width: 1.4, color: 0xffffff, alpha: 0.75, join: 'miter' }); }
        dashedPolyline(g, pts, 6, 6);
        g.stroke({ width: 2, color: 0xffffff, alpha: 0.95 });
      } else {
        // Double voie : traverses, puis deux rails par voie.
        for (const o of [-8, 8]) {
          const q = offsetPath(pts, o);
          for (let i = 1; i < q.length; i++) {
            const a2 = q[i - 1], b2 = q[i], d = Math.hypot(b2.x - a2.x, b2.y - a2.y);
            const ux = (b2.x - a2.x) / (d || 1), uy = (b2.y - a2.y) / (d || 1), px = -uy, py = ux;
            for (let s2 = 0; s2 < d; s2 += 8) {
              const x = a2.x + ux * s2, y = a2.y + uy * s2;
              g.moveTo(x + px * 6.5, y + py * 6.5).lineTo(x - px * 6.5, y - py * 6.5);
            }
          }
          g.stroke({ width: 3, color: 0x9b7653, cap: 'round' });
          for (const r of [-3.5, 3.5]) {
            const rq = offsetPath(pts, o + r);
            g.moveTo(rq[0].x, rq[0].y);
            for (const p of rq.slice(1)) g.lineTo(p.x, p.y);
            g.stroke({ width: 1.8, color: 0x56606b, join: 'miter' });
          }
        }
      }
    }
  }

  /** Un camion (cabine et benne) ou un train (locomotive et deux wagons), vus de dessus. */
  private makeVehicle(kind: string): { root: Container; parts: Container[]; cargo: Sprite; kind: string } {
    const root = new Container();
    const ink = PALETTE.ink;
    const parts: Container[] = [];
    if (kind === 'camion') {
      const c = new Container();
      const g = new Graphics();
      g.roundRect(-11, -7, 14, 14, 3).fill(0xc98a4b).stroke({ width: 2, color: ink });
      g.roundRect(3, -6.5, 9, 13, 3.5).fill(PALETTE.yellow).stroke({ width: 2, color: ink });
      g.roundRect(8, -4.5, 3, 9, 1.5).fill(0xbfe3f2);
      c.addChild(g);
      parts.push(c);
    } else {
      for (let i = 0; i < 3; i++) {
        const c = new Container();
        const g = new Graphics();
        if (i === 0) {
          g.roundRect(-9, -7, 18, 14, 4).fill(PALETTE.coral).stroke({ width: 2, color: ink });
          g.circle(3, 0, 3.4).fill(ink);
          g.roundRect(-7, -4, 5, 8, 1.5).fill(0xbfe3f2);
        } else {
          g.roundRect(-9, -7, 18, 14, 3).fill(0x6b7c8f).stroke({ width: 2, color: ink });
          g.moveTo(-5, -7).lineTo(-5, 7).moveTo(0, -7).lineTo(0, 7).moveTo(5, -7).lineTo(5, 7).stroke({ width: 1.2, color: ink, alpha: 0.5 });
        }
        c.addChild(g);
        parts.push(c);
      }
    }
    for (const p of parts) root.addChild(p);
    const cargo = new Sprite();
    cargo.anchor.set(0.5);
    cargo.scale.set(0.75);
    root.addChild(cargo);
    this.actorLayer.addChildAt(root, 0);
    return { root, parts, cargo, kind };
  }

  /** Le trajet (en pixels) du trajet i d'une ligne : de l'arrêt i à l'arrêt suivant, en L. */
  private legPx(l: Line, i: number): { x: number; y: number }[] | null {
    const f = this.game.factory;
    const a = f.machines.get(l.stops[i % l.stops.length].id), b = f.machines.get(l.stops[(i + 1) % l.stops.length].id);
    if (!a || !b) return null;
    // Deux arrêts alignés : le coin du L se confond avec un bout, on l'enlève.
    return f.legPath(a, b).map((p) => ({ x: p.x * CELL, y: p.y * CELL }))
      .filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 0.5);
  }

  private updateRoutes(): void {
    const f = this.game.factory;
    let sig = '';
    for (const l of f.lines.values()) {
      sig += `|${l.id}:${l.stops.map((st) => { const m = f.machines.get(st.id); return `${m?.x},${m?.y}`; }).join(';')}`;
    }
    if (sig !== this.routeSig) { this.routeSig = sig; this.drawRoutes(); }
    const seen = new Set<string>();
    for (const l of f.lines.values()) {
      l.vehicles.forEach((v, vi) => {
        const id = `${l.id}:${vi}`;
        seen.add(id);
        const pts = this.legPx(l, v.at);
        if (!pts) return;
        let view = this.vehicleViews.get(id);
        if (!view || view.kind !== l.kind) { view?.root.destroy({ children: true }); view = this.makeVehicle(l.kind); this.vehicleViews.set(id, view); }
        const a = f.machines.get(l.stops[v.at % l.stops.length].id)!, b = f.machines.get(l.stops[(v.at + 1) % l.stops.length].id)!;
        const L = Math.max(0.01, f.legLength(a, b));
        // À l'arrêt, les véhicules se rangent côte à côte ; en route, chaque wagon suit le précédent.
        const k = v.moving ? v.pos / L : 0;
        const gap = 19 / (L * CELL);
        view.parts.forEach((part, i) => {
          const p = this.alongPath(pts, k - i * gap);
          // Chacun sa voie : on roule à droite (8 px du milieu), on se croise sans se toucher.
          const lane = l.kind === 'train' ? 8 : 6.5;
          const ox = -Math.sin(p.a) * lane, oy = Math.cos(p.a) * lane;
          part.position.set(p.x + ox, p.y + oy + (v.moving ? 0 : (vi - (l.vehicles.length - 1) / 2) * 15));
          part.rotation = p.a;
        });
        const n = f.cargoCount(v);
        const main = Object.entries(v.cargo).sort((x, y) => y[1] - x[1])[0]?.[0];
        view.cargo.visible = n > 0 && !!main;
        if (main) view.cargo.texture = this.itemTextures.get(main)!;
        const carrier = view.parts[view.parts.length > 1 ? 1 : 0];
        view.cargo.position.set(carrier.x, carrier.y);
        view.root.visible = this.inView(view.parts[0].x, view.parts[0].y, CELL * 3);
      });
    }
    for (const [id, v] of this.vehicleViews) {
      if (seen.has(id)) continue;
      v.root.destroy({ children: true });
      this.vehicleViews.delete(id);
    }
  }

  /** Le trajet d'un tapis souterrain : du centre de la machine de départ à celui de l'arrivée, par ses cases. */
  private tunnelPath(t: Tunnel): { x: number; y: number }[] | null {
    const f = this.game.factory;
    const a = f.machines.get(t.from), b = f.machines.get(t.to);
    if (!a || !b) return null;
    const c = (m: Machine) => ({ x: (m.x + m.w / 2) * CELL, y: (m.y + m.h / 2) * CELL });
    return [c(a), ...t.cells.map((k) => { const [x, y] = unkey(k); return { x: (x + 0.5) * CELL, y: (y + 0.5) * CELL }; }), c(b)];
  }

  /** Surface pâlie ou normale, tapis souterrains et trappes. */
  private updateUnderground(): void {
    const on = this.underground;
    const elec = this.electric && !on;
    this.cableG.visible = this.showCables && !elec;
    const f = this.game.factory;
    if (on !== this.undergroundOn || elec !== this.electricOn) {
      this.undergroundOn = on;
      this.electricOn = elec;
      const a = on ? 0.22 : elec ? 0.3 : 1;
      for (const l of [this.routeG, this.cableG, this.beltShadow, this.beltTop, this.linkG, this.ghostBeltG, this.itemLayer, this.bridgeG, this.bridgeItemLayer, this.groundShadows, this.machineLayer, this.portG]) l.alpha = a;
      this.actorLayer.alpha = on || elec ? 0.45 : 1;
      this.undergroundTint.visible = on || elec;
      this.powerG.visible = elec;
      this.cableG.visible = this.showCables && !elec;
      this.drawCables();
      this.tunnelG.visible = on;
      this.tunnelItems.visible = on;
      this.tunnelMarks.visible = !on;
      this.tunnelSig = '';
    }
    // Redessin quand les tapis souterrains (ou les machines qu'ils relient) changent.
    let sig = on ? 'u' : 's';
    for (const t of f.tunnels.values()) {
      const a = f.machines.get(t.from), b = f.machines.get(t.to);
      sig += `|${t.id}:${a?.x},${a?.y}:${b?.x},${b?.y}`;
    }
    if (sig !== this.tunnelSig) {
      this.tunnelSig = sig;
      this.drawTunnels();
    }
    if (elec) {
      // Mode électricité : un voile bleu nuit.
      const b = this.camera.bounds(CELL * 2);
      this.undergroundTint.clear().rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0).fill({ color: 0x1f2a3d, alpha: 0.42 });
    }
    if (on) {
      // Un voile couleur de terre sur la surface.
      const b = this.camera.bounds(CELL * 2);
      this.undergroundTint.clear().rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0).fill({ color: 0x3d2f24, alpha: 0.38 });
      this.drawTunnelItems();
    }
  }

  private drawTunnels(): void {
    const g = this.tunnelG, mk = this.tunnelMarks, f = this.game.factory;
    g.clear(); mk.clear();
    for (const t of f.tunnels.values()) {
      const pts = this.tunnelPath(t);
      if (!pts) continue;
      if (this.undergroundOn) {
        const line = () => { g.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) g.lineTo(p.x, p.y); };
        line(); g.stroke({ width: 17, color: 0x2b211a, alpha: 0.9, cap: 'round', join: 'round' });
        line(); g.stroke({ width: 12, color: 0x9a7556, cap: 'round', join: 'round' });
        dashedPolyline(g, pts, 5, 6);
        g.stroke({ width: 2, color: 0xe8d6bd, cap: 'round' });
        // Les deux bouts : départ (cercle plein) et arrivée (anneau).
        const s = pts[0], e = pts[pts.length - 1];
        g.circle(s.x, s.y, 7).fill(0x2b211a).circle(s.x, s.y, 3.5).fill(0xe8d6bd);
        g.circle(e.x, e.y, 7).fill(0x2b211a).circle(e.x, e.y, 4).stroke({ width: 2, color: 0xe8d6bd });
      }
      // En surface : une trappe sur le bord de la machine, là où le tapis plonge et là où il remonte.
      if (t.cells.length) {
        const ends: [number, number, number][] = [[t.cells[0], t.from, 1], [t.cells[t.cells.length - 1], t.to, -1]];
        for (const [k, mid, sign] of ends) {
          const m = f.machines.get(mid);
          if (!m) continue;
          const [x, y] = unkey(k);
          for (let d = 0; d < 4; d++) {
            if (f.machineAt(x + DX[d], y + DY[d]) !== m) continue;
            const ex = (x + 0.5 + DX[d] * 0.5) * CELL, ey = (y + 0.5 + DY[d] * 0.5) * CELL;
            mk.roundRect(ex - 6, ey - 6, 12, 12, 3).fill(0x6b5240).stroke({ width: 1.6, color: PALETTE.ink });
            // Flèche : vers le bas au départ, vers le haut à l'arrivée.
            mk.moveTo(ex - 3, ey - 1.5 * sign).lineTo(ex, ey + 1.5 * sign).lineTo(ex + 3, ey - 1.5 * sign).stroke({ width: 1.8, color: 0xffffff, cap: 'round', join: 'round' });
            break;
          }
        }
      }
    }
  }

  /** Les objets en route sous terre (seulement dans la vue du sous-sol). */
  private drawTunnelItems(): void {
    const f = this.game.factory;
    let used = 0;
    for (const t of f.tunnels.values()) {
      if (!t.items.length) continue;
      const pts = this.tunnelPath(t);
      if (!pts) continue;
      const seg: number[] = [];
      let total = 0;
      for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); total += d; }
      const L = f.tunnelLength(t);
      for (const it of t.items) {
        let dist = Math.min(1, it.p / L) * total, i = 0;
        while (i < seg.length - 1 && dist > seg[i]) { dist -= seg[i]; i++; }
        const k = seg[i] ? Math.min(1, dist / seg[i]) : 0;
        let s = this.tunnelPool[used];
        if (!s) { s = new Sprite(); s.anchor.set(0.5); this.tunnelItems.addChild(s); this.tunnelPool.push(s); }
        s.texture = this.itemTextures.get(it.t)!;
        s.position.set(pts[i].x + (pts[i + 1].x - pts[i].x) * k, pts[i].y + (pts[i + 1].y - pts[i].y) * k);
        s.visible = true;
        used++;
      }
    }
    for (let i = used; i < this.tunnelPool.length; i++) this.tunnelPool[i].visible = false;
  }

  /**
   * Les câbles : un trait sombre de case en case, jaune au milieu quand le réseau a du courant.
   * En mode électricité, ils passent par-dessus le voile, avec les machines du réseau colorées.
   */
  private drawCables(): void {
    this.cableT = 0;
    const f = this.game.factory;
    this.cableCount = f.cables.size;
    this.cableG.clear();
    this.powerG.clear();
    const g = this.electricOn ? this.powerG : this.cableG;
    if (this.electricOn) this.drawPowerMachines(g);
    if (!f.cables.size) return;
    const segs: { x0: number; y0: number; x1: number; y1: number; on: boolean }[] = [];
    const dots: { x: number; y: number; on: boolean }[] = [];
    for (const k of f.cables) {
      const [x, y] = unkey(k);
      const net = f.netAt(x, y);
      const on = !!net && net.supply > 0;
      const cx = (x + 0.5) * CELL, cy = (y + 0.5) * CELL;
      let links = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (f.hasCable(nx, ny)) { links++; if (d < 2) segs.push({ x0: cx, y0: cy, x1: cx + DX[d] * CELL, y1: cy + DY[d] * CELL, on }); }
      }
      if (links !== 2) dots.push({ x: cx, y: cy, on });
    }
    for (const s of segs) g.moveTo(s.x0, s.y0).lineTo(s.x1, s.y1);
    g.stroke({ width: 5, color: PALETTE.ink, alpha: 0.85, cap: 'round', join: 'round' });
    for (const d of dots) g.circle(d.x, d.y, 4).fill({ color: PALETTE.ink, alpha: 0.85 });
    for (const s of segs) g.moveTo(s.x0, s.y0).lineTo(s.x1, s.y1).stroke({ width: 2, color: s.on ? PALETTE.yellow : 0x8a99ad, cap: 'round' });
    for (const d of dots) g.circle(d.x, d.y, 2).fill(d.on ? PALETTE.yellow : 0x8a99ad);
  }

  /**
   * Mode électricité : les machines qui peuvent se brancher, colorées selon leur état.
   * Jaune vif : alimentée (ou générateur qui tourne) ; gris bleu : branchée mais sans courant ; contour clair : pas branchée.
   */
  private drawPowerMachines(g: Graphics): void {
    const f = this.game.factory;
    // La portée des câbles posés : 5 cases autour de chaque câble.
    if (f.cables.size) {
      const cells = [...f.cables].map((k) => { const [x, y] = unkey(k); return { x, y }; });
      this.fillRange(g, cells, 0xffe7a3, 0.1);
    }
    for (const m of f.machines.values()) {
      const def = machineDef(m.type);
      const gen = def.kind === 'generator';
      if (!gen && !f.powerUse(m)) continue;
      const net = f.netOf(m);
      const x = m.x * CELL + 2, y = m.y * CELL + 2, w = m.w * CELL - 4, hh = m.h * CELL - 4, r = 12;
      const lit = !!net && net.supply > 0 && (gen ? m.status === 'working' || m.fuel > 0 || m.burn > 0 : (m.power ?? 0) > 0);
      if (lit) {
        g.roundRect(x - 3, y - 3, w + 6, hh + 6, r + 3).fill({ color: PALETTE.yellow, alpha: 0.25 });
        g.roundRect(x, y, w, hh, r).fill({ color: PALETTE.yellow, alpha: 0.85 }).stroke({ width: 2.5, color: 0xffffff });
        drawBolt(g, x + w / 2, y + hh / 2, m.w === 1 ? 0.8 : 1.2);
      } else if (net) {
        g.roundRect(x, y, w, hh, r).fill({ color: 0x8a99ad, alpha: 0.75 }).stroke({ width: 2, color: 0xd5dde6 });
      } else {
        dashedPolyline(g, roundRectPoints(x, y, w, hh, r), 6, 5, true);
        g.stroke({ width: 2, color: 0xffffff, alpha: 0.75 });
      }
    }
  }

  /** Remplit les cases à portée de ces câbles (bandes horizontales fusionnées, dans la vue). */
  private fillRange(g: Graphics, cells: { x: number; y: number }[], color: number, alpha: number, outline = false): void {
    const R = RULES.cableRange;
    const v = this.camera.bounds(CELL * 10);
    const vy0 = Math.floor(v.y0 / CELL), vy1 = Math.ceil(v.y1 / CELL), vx0 = Math.floor(v.x0 / CELL), vx1 = Math.ceil(v.x1 / CELL);
    const rows = new Map<number, [number, number][]>();
    for (const c of cells) {
      if (c.x + R < vx0 || c.x - R > vx1 || c.y + R < vy0 || c.y - R > vy1) continue;
      for (let y = Math.max(vy0, c.y - R); y <= Math.min(vy1, c.y + R); y++) {
        let r = rows.get(y);
        if (!r) { r = []; rows.set(y, r); }
        r.push([c.x - R, c.x + R]);
      }
    }
    for (const [y, list] of rows) {
      list.sort((a, b) => a[0] - b[0]);
      let [a0, a1] = list[0];
      const flush = () => g.rect(a0 * CELL, y * CELL, (a1 - a0 + 1) * CELL, CELL);
      for (const [b0, b1] of list.slice(1)) {
        if (b0 <= a1 + 1) a1 = Math.max(a1, b1);
        else { flush(); [a0, a1] = [b0, b1]; }
      }
      flush();
    }
    g.fill({ color, alpha });
    if (outline) {
      // Le bord de la zone : les côtés des cases qui n'ont pas de voisine à portée.
      const inRange = (x: number, y: number) => (rows.get(y) ?? []).some(([a, b]) => x >= a && x <= b);
      for (const [y, list] of rows) {
        for (const [a, b] of list) {
          for (let x = a; x <= b; x++) {
            if (!inRange(x, y - 1)) g.moveTo(x * CELL, y * CELL).lineTo((x + 1) * CELL, y * CELL);
            if (!inRange(x, y + 1)) g.moveTo(x * CELL, (y + 1) * CELL).lineTo((x + 1) * CELL, (y + 1) * CELL);
            if (!inRange(x - 1, y)) g.moveTo(x * CELL, y * CELL).lineTo(x * CELL, (y + 1) * CELL);
            if (!inRange(x + 1, y)) g.moveTo((x + 1) * CELL, y * CELL).lineTo((x + 1) * CELL, (y + 1) * CELL);
          }
        }
      }
      g.stroke({ width: 2, color, alpha: 0.9 });
    }
  }

  /** Tabliers des ponts : du milieu de la rampe jusqu'à la case d'arrivée, au-dessus des tapis enjambés. */
  private drawBridges(built: Belt[]): void {
    const g = this.bridgeG;
    g.clear();
    const f = this.game.factory;
    const decks: { x0: number; y0: number; x1: number; y1: number; d: number; jump: number }[] = [];
    const deck = (b: Belt, d: number, jump: number) => {
      const L = 1 + jump;
      // Il atterrit dans une machine : le tablier file sous elle.
      const into = f.machineAt(b.x + DX[d] * L, b.y + DY[d] * L) ? CELL / 2 : 0;
      const cx = (b.x + 0.5) * CELL, cy = (b.y + 0.5) * CELL, e = CELL / 2 + jump * CELL + into;
      decks.push({ x0: cx, y0: cy, x1: cx + DX[d] * e, y1: cy + DY[d] * e, d, jump });
    };
    const splitters: Belt[] = [];
    for (const b of built) {
      if (b.jump) deck(b, b.dir, b.jump);
      // Dérivation d'un séparateur qui passe par-dessus un tapis collé.
      if (b.splitJump && b.split !== undefined) { deck(b, b.split, b.splitJump); splitters.push(b); }
    }
    if (!decks.length) return;
    // Ombre portée au sol (le pont est en hauteur), puis piliers, liseré et tablier blanc.
    for (const d of decks) {
      const ax = DX[d.d], ay = DY[d.d];
      g.moveTo(d.x0 + ax * CELL * 0.4, d.y0 + ay * CELL * 0.4 + 7).lineTo(d.x1 - ax * CELL * 0.4, d.y1 - ay * CELL * 0.4 + 7);
    }
    g.stroke({ width: 14, color: PALETTE.shadow, alpha: 0.8, cap: 'round' });
    for (const d of decks) {
      const ax = DX[d.d], ay = DY[d.d], px = -ay, py = ax;
      for (const k of [0.5, d.jump + 0.5]) {
        const x = d.x0 + ax * k * CELL, y = d.y0 + ay * k * CELL;
        g.moveTo(x + px * 6, y + py * 6).lineTo(x - px * 6, y - py * 6);
      }
    }
    g.stroke({ width: 4, color: PALETTE.ink, alpha: 0.25, cap: 'round' });
    for (const d of decks) g.moveTo(d.x0, d.y0).lineTo(d.x1, d.y1);
    g.stroke({ width: 18, color: PALETTE.ink, alpha: 0.22, cap: 'round' });
    for (const d of decks) g.moveTo(d.x0, d.y0).lineTo(d.x1, d.y1);
    g.stroke({ width: 14, color: PALETTE.white, cap: 'round' });
    // Rouleaux du tablier, comme sur un tapis.
    for (const d of decks) {
      const fx = DX[d.d], fy = DY[d.d], px = -fy, py = fx;
      for (let k = 1; k <= d.jump; k++) {
        const cx = d.x0 + fx * k * CELL, cy = d.y0 + fy * k * CELL;
        g.moveTo(cx - fx * 2 + px * 3.2, cy - fy * 2 + py * 3.2).lineTo(cx + fx * 1.2, cy + fy * 1.2).lineTo(cx - fx * 2 - px * 3.2, cy - fy * 2 - py * 3.2);
      }
    }
    g.stroke({ width: 2, color: PALETTE.roller, cap: 'round', join: 'round' });
    // Le losange du séparateur reste visible au départ de son pont.
    for (const b of splitters) {
      const cx = (b.x + 0.5) * CELL, cy = (b.y + 0.5) * CELL;
      g.poly([cx, cy - 9, cx + 9, cy, cx, cy + 9, cx - 9, cy]).fill(PALETTE.white).stroke({ width: 2, color: PALETTE.ink, join: 'round' });
    }
  }

  /** Le milieu du bord commun entre deux machines collées, et le sens de a vers b. */
  private linkEdge(a: Machine, b: Machine): { x: number; y: number; d: number } {
    if (a.x + a.w === b.x || b.x + b.w === a.x) {
      const d = a.x + a.w === b.x ? 0 : 2;
      return { x: (d === 0 ? b.x : a.x) * CELL, y: (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2 * CELL, d };
    }
    const d = a.y + a.h === b.y ? 1 : 3;
    return { x: (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2 * CELL, y: (d === 1 ? b.y : a.y) * CELL, d };
  }

  private drawPorts(): void {
    const g = this.portG, lg = this.linkG;
    g.clear(); lg.clear();
    const f = this.game.factory;
    // Raccord : un simple chevron là où le tapis touche la machine.
    const port = (b: Belt, d: number, into: boolean, dist = 1) => {
      const m = f.machineAt(b.x + DX[d] * dist, b.y + DY[d] * dist);
      const ghost = !b.built || !m?.built;
      const ex = (b.x + 0.5 + DX[d] * (dist - 0.5)) * CELL, ey = (b.y + 0.5 + DY[d] * (dist - 0.5)) * CELL;
      const ax = DX[d], ay = DY[d], px = -ay, py = ax;
      // Juste un chevron sur le bord : rouge pour une entrée, vert pour une sortie.
      const s = into ? 1 : -1, cx = ex + ax * 5, cy = ey + ay * 5;
      g.moveTo(cx - ax * 2.5 * s + px * 4.5, cy - ay * 2.5 * s + py * 4.5).lineTo(cx + ax * 2 * s, cy + ay * 2 * s).lineTo(cx - ax * 2.5 * s - px * 4.5, cy - ay * 2.5 * s - py * 4.5)
        .stroke({ width: 2.6, color: into ? PALETTE.coral : PALETTE.green, alpha: ghost ? 0.4 : 1, cap: 'round', join: 'round' });
    };
    // Liaisons directes entre machines collées : un bout de tapis sur le bord commun, chevron vert.
    for (const a of f.machines.values()) {
      for (const id of a.links ?? []) {
        const b = f.machines.get(id);
        if (!b || !f.touching(a, b)) continue;
        const { x: ex, y: ey, d } = this.linkEdge(a, b);
        const ax = DX[d], ay = DY[d], px = -ay, py = ax;
        const ghost = !a.built || !b.built;
        // Un tapis normal (ombre, bande blanche, rouleau) d'un milieu de case à l'autre, sous les deux machines :
        // on n'en voit que le bout entre leurs coins. Seul le chevron vert est par-dessus, sans fond.
        const al = ghost ? 0.5 : 1, L = CELL / 2;
        lg.moveTo(ex - ax * L, ey - ay * L + 3).lineTo(ex + ax * L, ey + ay * L + 3)
          .stroke({ width: 14, color: PALETTE.shadow, alpha: al, cap: 'round' });
        lg.moveTo(ex - ax * L, ey - ay * L).lineTo(ex + ax * L, ey + ay * L)
          .stroke({ width: 14, color: PALETTE.white, alpha: al, cap: 'round' });
        g.moveTo(ex - ax * 2.5 + px * 4.5, ey - ay * 2.5 + py * 4.5).lineTo(ex + ax * 2, ey + ay * 2).lineTo(ex - ax * 2.5 - px * 4.5, ey - ay * 2.5 - py * 4.5)
          .stroke({ width: 2.6, color: PALETTE.green, alpha: ghost ? 0.4 : 1, cap: 'round', join: 'round' });
      }
    }
    for (const b of f.belts.values()) {
      // Entrée : le tapis donne dans une machine.
      const L = span(b);
      if (f.machineAt(b.x + DX[b.dir] * L, b.y + DY[b.dir] * L)) port(b, b.dir, true, L);
      if (b.split !== undefined && f.machineAt(b.x + DX[b.split], b.y + DY[b.split])) port(b, b.split, true);
      if (b.split2 !== undefined && f.machineAt(b.x + DX[b.split2], b.y + DY[b.split2])) port(b, b.split2, true);
      // Sortie : le tapis part d'une machine.
      const back = (b.inDir + 2) % 4;
      if (f.machineAt(b.x + DX[back], b.y + DY[back])) port(b, back, false);
      // Liaison de côté : la machine voisine dépose sur ce tapis.
      for (const fd of b.feeds ?? []) if (fd !== back && f.machineAt(b.x + DX[fd], b.y + DY[fd])) port(b, fd, false);
    }
  }

  private drawItems(): void {
    const b = this.camera.bounds(CELL);
    const far = CELL * (RULES.bridgeSpan + 1);
    let used = 0, usedB = 0;
    const sprite = (pool: Sprite[], layer: Container, i: number) => {
      let s = pool[i];
      if (!s) { s = new Sprite(); s.anchor.set(0.5); layer.addChild(s); pool.push(s); }
      return s;
    };
    for (const belt of this.game.factory.belts.values()) {
      if (!belt.built || belt.items.length === 0) continue;
      const bx = (belt.x + 0.5) * CELL, by = (belt.y + 0.5) * CELL;
      const m = belt.jump || belt.splitJump ? far : 0;
      if (bx < b.x0 - m || bx > b.x1 + m || by < b.y0 - m || by > b.y1 + m) continue;
      if (belt.jump) {
        // Sur un pont : la rampe (de l'arrière jusqu'au milieu), puis le tablier jusqu'à la case d'arrivée, au-dessus du reste.
        const L = span(belt) * CELL;
        for (const it of belt.items) {
          const dist = Math.min(it.p, 1) * L, h = CELL / 2;
          const s = sprite(this.bridgePool, this.bridgeItemLayer, usedB++);
          s.texture = this.itemTextures.get(it.t)!;
          if (dist < h) s.position.set(bx - DX[belt.inDir] * (h - dist), by - DY[belt.inDir] * (h - dist));
          else s.position.set(bx + DX[belt.dir] * (dist - h), by + DY[belt.dir] * (dist - h));
          s.visible = true;
        }
        continue;
      }
      for (const it of belt.items) {
        let x: number, y: number;
        const p = Math.min(it.p, 1);
        if (p < 0.5) {
          const t = p * 2 - 1;
          x = bx + DX[belt.inDir] * t * CELL / 2; y = by + DY[belt.inDir] * t * CELL / 2;
        } else {
          const t = (p - 0.5) * 2;
          const d = it.o === 2 && belt.split2 !== undefined ? belt.split2 : it.o && belt.split !== undefined ? belt.split : belt.dir;
          // Dérivation en pont : la seconde moitié file sur le tablier, par-dessus le tapis collé.
          const reach = it.o === 1 && belt.splitJump ? 0.5 + belt.splitJump : 0.5;
          x = bx + DX[d] * t * CELL * reach; y = by + DY[d] * t * CELL * reach;
          if (reach > 0.5) {
            const s = sprite(this.bridgePool, this.bridgeItemLayer, usedB++);
            s.texture = this.itemTextures.get(it.t)!;
            s.position.set(x, y);
            s.visible = true;
            continue;
          }
        }
        const s = sprite(this.itemPool, this.itemLayer, used++);
        s.texture = this.itemTextures.get(it.t)!;
        s.position.set(x + (it.sx ?? 0) * CELL, y + (it.sy ?? 0) * CELL);
        s.visible = true;
      }
    }
    for (let i = used; i < this.itemPool.length; i++) this.itemPool[i].visible = false;
    for (let i = usedB; i < this.bridgePool.length; i++) this.bridgePool[i].visible = false;
  }

  /** Une autre machine touche-t-elle le haut de celle-ci ? */
  private machineAbove(m: Machine): boolean {
    const f = this.game.factory;
    for (let x = m.x; x < m.x + m.w; x++) {
      const o = f.machineAt(x, m.y - 1);
      if (o && o !== m) return true;
    }
    return false;
  }

  /** Rectangle visible (en pixels du monde, avec marge), mis à jour à chaque image. */
  private view = { x0: 0, y0: 0, x1: 0, y1: 0 };

  /** Un objet centré en (x, y), de demi-taille r, est-il (au moins en partie) à l'écran ? */
  private inView(x: number, y: number, r: number): boolean {
    const v = this.view;
    return x + r >= v.x0 && x - r <= v.x1 && y + r >= v.y0 && y - r <= v.y1;
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
    root.zIndex = zOf(m);
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
    root.zIndex = zOf(m);
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
      if (v.root.zIndex !== zOf(m)) v.root.zIndex = zOf(m);
      // Hors de l'écran : on ne la dessine pas, et on saute ses petites animations.
      v.root.visible = this.inView(v.root.x, v.root.y, Math.max(def.w, def.h) * CELL);
      if (!v.root.visible) { v.made = m.made; continue; }
      // Pendant qu'on la déplace, la machine pâlit sous son fantôme.
      v.root.alpha = m.id === this.movingId && this.preview?.kind === 'place' ? 0.4 : 1;
      if (m.made !== v.made) { v.made = m.made; v.pop = 1; }
      v.pop = Math.max(0, v.pop - dt * 4);
      const s = 1 + Math.sin(v.pop * Math.PI) * 0.16;
      v.icon.scale.set(s);
      if (m.type === 'four' && m.status === 'working') v.icon.y = Math.sin(this.time * 9) * 0.6;
      // Le nom s'affiche au-dessus de la machine, sauf si une autre machine y est collée (il la recouvrirait).
      if (v.label) v.label.visible = this.camera.zoom > 0.6 && !this.machineAbove(m);
      const low = this.game.factory.lowFuel(m);
      v.lamp.visible = low && Math.sin(this.time * (m.fuel <= 0 && m.burn <= 0 ? 12 : 6)) > -0.2;
      // Branchée sur un réseau qui a du courant : un petit éclair dans le coin (elle se passe de charbon).
      const powered = m.built && this.game.factory.powered(m);
      const st = `${m.status}${powered ? '+' : ''}`;
      if (st !== v.status) {
        v.status = st;
        v.badge.clear();
        if (m.built && m.status === 'blocked') {
          // Pastille « en pause » dans le coin, sans déborder sur une machine voisine.
          const r = def.w === 1 ? 5.5 : 7, x = def.w * CELL / 2 - 4 - r, y = -def.h * CELL / 2 + 4 + r;
          v.badge.circle(x, y, r).fill(0xffffff).stroke({ width: 2, color: PALETTE.coral });
          v.badge.rect(x - r * 0.38, y - r * 0.45, r * 0.25, r * 0.9).rect(x + r * 0.13, y - r * 0.45, r * 0.25, r * 0.9).fill(PALETTE.coral);
        } else if (m.built && m.status === 'nopower') {
          // Pas de courant : un éclair dans le même coin.
          const r = 7.5, x = def.w * CELL / 2 - 4 - r, y = -def.h * CELL / 2 + 4 + r;
          v.badge.circle(x, y, r).fill(0xffffff).stroke({ width: 2, color: PALETTE.ink });
          drawBolt(v.badge, x, y, 0.62);
        } else if (powered) {
          const x = def.w * CELL / 2 - 10, y = -def.h * CELL / 2 + 11;
          drawBolt(v.badge, x, y, def.w === 1 ? 0.55 : 0.7);
        }
      }
    }
    for (const [id, v] of this.machineViews) {
      if (!seen.has(id)) { v.root.destroy({ children: true }); this.machineViews.delete(id); }
    }
    // Noyau : anneau de progression de la mission du palier.
    const nv = this.noyauView;
    if (nv) {
      const prog = this.game.palierProgress();
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
      nv.root.visible = this.inView(nv.root.x, nv.root.y, 4 * CELL);
      nv.pulse = Math.max(0, nv.pulse - dt * 3);
      nv.root.scale.set(1 + nv.pulse * 0.04);
    }
    // Grand coffre : ses quatre objets les plus nombreux, en petit, à la place du dessin du coffre.
    // Petit coffre : l'objet qu'il garde ; s'il en garde de plusieurs sortes, une icône « mélange ».
    for (const m of this.game.factory.machines.values()) {
      if ((m.type !== 'grand_coffre' && m.type !== 'coffre') || !m.built) continue;
      const v = this.machineViews.get(m.id);
      if (!v || !v.root.visible) continue;
      const kinds = Object.entries(m.inBuf).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([t]) => t);
      const small = m.type === 'coffre';
      const top = kinds.slice(0, small ? 1 : 4);
      const sig = small && kinds.length > 1 ? '*' : top.join(',');
      if (sig === v.shelfSig) continue;
      v.shelfSig = sig;
      if (!v.shelf) { v.shelf = new Container(); v.root.addChildAt(v.shelf, v.root.getChildIndex(v.icon) + 1); }
      v.shelf.removeChildren().forEach((c) => c.destroy());
      v.icon.visible = top.length === 0;
      if (small) {
        if (sig === '*') {
          // Plusieurs sortes d'objets : trois pastilles de couleurs qui se chevauchent.
          const g = new Graphics();
          for (const [x, y, c] of [[-3.5, 2.5, 0x8a99ad], [3.5, 2.5, 0xd98146], [0, -3.5, 0x33415c]] as const) g.circle(x, y, 4.6).fill(c).stroke({ width: 1.6, color: 0xffffff });
          v.shelf.addChild(g);
        } else if (top[0]) {
          const sp = new Sprite(this.itemTextures.get(top[0])!);
          sp.anchor.set(0.5);
          sp.scale.set(0.85);
          v.shelf.addChild(sp);
        }
        continue;
      }
      const spots = top.length === 1 ? [[0, 0]] : top.length === 2 ? [[-9, 0], [9, 0]] : [[-9, -9], [9, -9], [-9, 9], [9, 9]];
      top.forEach((t, i) => {
        const s = new Sprite(this.itemTextures.get(t)!);
        s.anchor.set(0.5);
        s.scale.set(top.length === 1 ? 1.1 : 0.8);
        s.position.set(spots[i][0], spots[i][1]);
        v.shelf!.addChild(s);
      });
    }
    // Comptoir : un « ! » quand il attend qu'on choisisse une commande.
    // Revente : une jauge de remplissage.
    for (const m of this.game.factory.machines.values()) {
      if (m.type === 'revente') {
        const v = this.machineViews.get(m.id);
        if (!v || !m.built || !v.root.visible) continue;
        const fill = Math.min(1, this.game.sellCount(m) / RULES.sellCap);
        if (Math.abs(fill - (v.fill ?? -1)) < 0.004) continue;
        v.fill = fill;
        v.badge.clear();
        const W = 2 * CELL - 14, y = CELL - 9;
        v.badge.roundRect(-W / 2, y, W, 5, 2.5).fill(PALETTE.roller);
        if (fill > 0) v.badge.roundRect(-W / 2, y, Math.max(5, W * fill), 5, 2.5).fill(fill >= 1 ? PALETTE.coral : PALETTE.green);
        continue;
      }
      if (m.type !== 'comptoir') continue;
      const v = this.machineViews.get(m.id);
      if (!v || !v.root.visible) continue;
      v.badge.clear();
      if (m.built && !this.game.order) {
        // « ! » dans le coin du Comptoir, sans déborder.
        const b = 1 + Math.sin(this.time * 5) * 0.08, x = CELL - 13, y = -CELL + 13;
        v.badge.circle(x, y, 8.5 * b).fill(PALETTE.yellow).stroke({ width: 2.2, color: PALETTE.ink });
        v.badge.roundRect(x - 1.3, y - 5.5, 2.6, 6.8, 1.3).fill(PALETTE.ink).circle(x, y + 3.6, 1.5).fill(PALETTE.ink);
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
    const spin = new Graphics();
    spin.position.set(PROPELLER.x, PROPELLER.y);
    const glow = new Graphics().circle(10, -20, 9).fill({ color: PALETTE.yellow, alpha: 0.5 });
    const lamp = new Graphics().circle(10, -20, 5).fill(PALETTE.lamp).stroke({ width: 2.5, color: PALETTE.ink });
    body.addChild(g, glow, lamp, spin);
    flip.addChild(beam, body);
    // Son ombre est au sol, sous les machines (pas par-dessus quand il passe à côté).
    this.groundShadows.addChild(shadow);
    root.addChild(flip);
    this.actorLayer.addChild(root);
    this.robotView = { root, shadow, body, beam, glow, flip, shape: g, spin, look: '' };
    this.refreshLook();
  }

  /** Redessine le robot et les drones avec l'apparence choisie. */
  refreshLook(): void {
    const v = this.robotView;
    const look = this.game.look;
    const id = `${look.color}/${look.accessory}`;
    if (v.look === id) return;
    v.look = id;
    const { body, spin } = robotShapes(look);
    v.shape.clear();
    for (const sh of body) drawShape(v.shape, sh, 0, 0);
    v.spin.clear();
    for (const sh of spin) drawShape(v.spin, sh, PROPELLER.x, PROPELLER.y);
    // Les drones prennent la couleur du robot.
    for (const d of this.droneViews) d.destroy({ children: true });
    this.droneViews = [];
  }

  /** Un drone : petit corps de la couleur du robot, visière, deux bras à hélice, pattes pour se poser. */
  private makeDroneView(): Container {
    const d = new Container();
    const ink = PALETTE.ink, col = robotColor(this.game.look);
    const body = new Container();
    body.label = 'body';
    const g = new Graphics();
    // Bras et moyeux
    g.moveTo(-12, -4).lineTo(12, -4).stroke({ width: 2.5, color: ink, cap: 'round' });
    g.circle(-12, -4, 2).circle(12, -4, 2).fill(ink);
    // Pattes
    g.moveTo(-5, 5).lineTo(-7, 9).moveTo(5, 5).lineTo(7, 9).moveTo(-9, 9).lineTo(-5, 9).moveTo(5, 9).lineTo(9, 9)
      .stroke({ width: 2, color: ink, cap: 'round', join: 'round' });
    // Corps et visière
    g.roundRect(-8, -8, 16, 14, 6).fill(col.main).stroke({ width: 2, color: ink });
    g.roundRect(-5.5, -5, 11, 6, 3).fill(0xffffff).stroke({ width: 1.5, color: ink });
    g.circle(2, -2, 1.7).fill(ink);
    // Hélices (elles tournent en vol)
    const rotors: Graphics[] = [];
    for (const x of [-12, 12]) {
      const rg = new Graphics().ellipse(0, 0, 7.5, 1.8).fill({ color: ink, alpha: 0.6 });
      rg.position.set(x, -7);
      rg.label = 'rotor';
      rotors.push(rg);
    }
    body.addChild(g, ...rotors);
    const cargo = new Sprite();
    cargo.anchor.set(0.5);
    cargo.position.set(0, 15);
    cargo.label = 'cargo';
    d.addChild(cargo, body);
    this.actorLayer.addChild(d);
    return d;
  }

  /** Anime un drone : hélices qui tournent en vol ; posé, il est plus petit et ses hélices s'arrêtent. */
  private styleDrone(v: Container, down: boolean, seed: number): void {
    const body = v.getChildByLabel('body') as Container;
    const k = down ? 0.68 : 1;
    body.scale.set(k);
    for (const c of body.children) if (c.label === 'rotor') c.scale.x = down ? 1 : Math.cos(this.time * 32 + seed);
    const cargo = v.getChildByLabel('cargo') as Sprite;
    cargo.y = down ? 10 : 15;
    cargo.scale.set(k);
  }

  private updateActors(): void {
    while (this.droneViews.length < this.game.drones.length) this.droneViews.push(this.makeDroneView());
    while (this.droneViews.length > this.game.drones.length) this.droneViews.pop()!.destroy({ children: true });
    const r = this.game.robot, v = this.robotView;
    v.root.position.set(r.x * CELL, r.y * CELL);
    v.shadow.position.set(r.x * CELL, r.y * CELL);
    v.spin.scale.x = Math.cos(this.time * 18);
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
      if (d.state === 'parked' || d.state === 'rest') {
        // Posé sur le robot : en panne de charbon (pâle), ou simplement au repos.
        dv.position.set(r.x * CELL + (i - (this.game.drones.length - 1) / 2) * 17, r.y * CELL + v.body.y - 38);
        dv.alpha = d.state === 'parked' ? 0.75 : 1;
      } else {
        dv.position.set(d.x * CELL, d.y * CELL - 22 + Math.sin(this.time * 4 + i) * 2.5);
        dv.alpha = 1;
      }
      dv.visible = this.inView(dv.x, dv.y, CELL);
      this.styleDrone(dv, d.state === 'parked' || d.state === 'rest', i);
      const cargo = dv.getChildByLabel('cargo') as Sprite;
      cargo.visible = !!d.cargo;
      if (d.cargo) cargo.texture = this.itemTextures.get(d.cargo.t)!;
    });
    // Faisceaux de construction : pointillés du drone vers le chantier.
    const fx = this.fx;
    fx.clear();
    for (const d of this.game.allDrones()) {
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

  // ---------- Gros drone de revente ----------

  private skyLayer: Container | null = null;
  private pickupViews = new Map<number, { root: Container; rotors: Graphics[]; crate: Graphics; shadow: Graphics }>();

  private makeCargoDrone(): { root: Container; rotors: Graphics[]; crate: Graphics; shadow: Graphics } {
    if (!this.skyLayer) {
      this.skyLayer = new Container();
      this.worldLayer.addChildAt(this.skyLayer, this.worldLayer.getChildIndex(this.fogLayer) + 1);
    }
    const ink = PALETTE.ink;
    const shadow = new Graphics().ellipse(0, 0, 26, 7).fill({ color: PALETTE.shadow, alpha: 0.8 });
    this.skyLayer.addChild(shadow);
    const root = new Container();
    const crate = new Graphics();
    crate.moveTo(-8, 8).lineTo(-12, 22).moveTo(8, 8).lineTo(12, 22).stroke({ width: 2, color: ink, cap: 'round' });
    crate.roundRect(-16, 20, 32, 20, 4).fill(0xc98a4b).stroke({ width: 2.5, color: ink });
    crate.rect(-16, 28, 32, 3).fill(0x8a5a2b);
    const body = new Graphics();
    body.moveTo(-34, -4).lineTo(34, -4).stroke({ width: 4, color: ink, cap: 'round' });
    body.roundRect(-22, -12, 44, 22, 9).fill(0xffffff).stroke({ width: 3, color: ink });
    body.roundRect(-14, -6, 28, 9, 4).fill(PALETTE.yellow);
    body.circle(0, 14, 4).fill(ink);
    const rotors: Graphics[] = [];
    for (const x of [-34, 34]) {
      const r = new Graphics().ellipse(0, 0, 15, 3.2).fill({ color: ink, alpha: 0.55 });
      r.position.set(x, -8);
      rotors.push(r);
      body.addChild(r);
    }
    root.addChild(crate, body);
    this.skyLayer.addChild(root);
    return { root, rotors, crate, shadow };
  }

  private updatePickups(): void {
    const seen = new Set<number>();
    for (const p of this.game.pickups) {
      seen.add(p.id);
      let v = this.pickupViews.get(p.id);
      if (!v) { v = this.makeCargoDrone(); this.pickupViews.set(p.id, v); }
      // Arrivée depuis le haut à droite, vol stationnaire au-dessus de la benne, départ vers le haut à gauche.
      const T = PICKUP_TIME, half = T / 2, t = p.t;
      const bx = p.x * CELL, by = (p.y - 1.4) * CELL;
      const far = CELL * 26;
      const smooth = (u: number) => u * u * (3 - 2 * u);
      let x: number, y: number, k: number;
      if (t < half - 0.6) { k = 1 - smooth(Math.min(1, t / (half - 0.6))); x = bx + far * k; y = by - far * 0.8 * k; }
      else if (t < half + 0.6) { k = 0; x = bx; y = by + Math.sin((t - half + 0.6) / 1.2 * Math.PI) * CELL * 0.6; }
      else { k = smooth(Math.min(1, (t - half - 0.6) / (half - 0.6))); x = bx - far * k; y = by - far * 0.8 * k; }
      v.root.position.set(x, y + Math.sin(this.time * 5) * 2);
      v.root.rotation = t < half - 0.6 || t > half + 0.6 ? -0.12 : 0;
      v.root.scale.set(1.25);
      v.crate.visible = p.done;
      for (const r of v.rotors) r.scale.x = Math.cos(this.time * 30);
      v.shadow.position.set(x, p.y * CELL + CELL * 0.6);
      v.shadow.alpha = Math.max(0, 1 - Math.abs(x - bx) / (CELL * 8)) * 0.8;
    }
    for (const [id, v] of this.pickupViews) {
      if (seen.has(id)) continue;
      v.root.destroy({ children: true });
      v.shadow.destroy();
      this.pickupViews.delete(id);
    }
  }

  /** Station dont on montre le rayon d'action (fenêtre ouverte). */
  rangeOf: number | null = null;
  /** Machine qu'on est en train de déplacer. */
  movingId: number | null = null;

  private drawRange(g: Graphics, cx: number, cy: number): void {
    const R = RULES.stationRange * CELL;
    // Les machines à portée du drone de la station se teintent en vert.
    for (const m of this.game.factory.machines.values()) {
      if (m.type === 'station') continue;
      const mx = (m.x + m.w / 2) * CELL, my = (m.y + m.h / 2) * CELL;
      if (Math.hypot(mx - cx, my - cy) > R) continue;
      const r = m.w === 1 ? 8 : m.type === 'noyau' ? 18 : 15;
      g.roundRect(m.x * CELL + 1, m.y * CELL + 1, m.w * CELL - 2, m.h * CELL - 2, r).fill({ color: 0x6cc7a0, alpha: 0.45 }).stroke({ width: 2.5, color: PALETTE.green, alpha: 0.8 });
    }
    g.circle(cx, cy, R).fill({ color: PALETTE.yellow, alpha: 0.1 });
    dashedPolyline(g, Array.from({ length: 97 }, (_, i) => ({ x: cx + Math.cos(i / 96 * Math.PI * 2) * R, y: cy + Math.sin(i / 96 * Math.PI * 2) * R })), 10, 7);
    g.stroke({ width: 3, color: PALETTE.ink, alpha: 0.35, cap: 'round' });
  }

  // Drones des stations
  private stationViews = new Map<number, Container>();

  private updateStationDrones(): void {
    const seen = new Set<number>();
    for (const [id, d] of this.game.stationDrones) {
      seen.add(id);
      let v = this.stationViews.get(id);
      if (!v) { v = this.makeDroneView(); this.stationViews.set(id, v); }
      const down = d.state === 'parked' || d.state === 'rest';
      v.position.set(d.x * CELL, d.y * CELL - (down ? 10 : 22) + (down ? 0 : Math.sin(this.time * 4 + id) * 2.5));
      v.alpha = d.state === 'parked' ? 0.75 : 1;
      v.visible = this.inView(v.x, v.y, CELL);
      this.styleDrone(v, down, id);
      const cargo = v.getChildByLabel('cargo') as Sprite;
      cargo.visible = !!d.cargo;
      if (d.cargo) cargo.texture = this.itemTextures.get(d.cargo.t)!;
    }
    for (const [id, v] of this.stationViews) {
      if (!seen.has(id)) { v.destroy({ children: true }); this.stationViews.delete(id); }
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
    if (pv?.kind === 'tunnel') {
      const t = pv.tracer;
      if (t.source) {
        const c = (m: Machine) => ({ x: (m.x + m.w / 2) * CELL, y: (m.y + m.h / 2) * CELL });
        const pts = [c(t.source), ...t.cells.map((p) => ({ x: (p.x + 0.5) * CELL, y: (p.y + 0.5) * CELL })), ...(t.target ? [c(t.target)] : [])];
        if (t.target) {
          const m = t.target;
          g.roundRect(m.x * CELL + 1, m.y * CELL + 1, m.w * CELL - 2, m.h * CELL - 2, m.w === 1 ? 8 : 15).fill({ color: 0x6cc7a0, alpha: 0.45 }).stroke({ width: 3, color: PALETTE.green });
        }
        if (pts.length > 1) {
          g.moveTo(pts[0].x, pts[0].y);
          for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
          g.stroke({ width: 14, color: 0x9a7556, alpha: 0.95, cap: 'round', join: 'round' });
          dashedPolyline(g, pts, 5, 5);
          g.stroke({ width: 2.5, color: t.blocked ? PALETTE.coral : 0xffffff, cap: 'round' });
        }
      }
    } else if (pv?.kind === 'cable') {
      const cells = pv.tracer.cells;
      if (cells.length) {
        // La portée du câble tracé, et les machines qu'il alimentera (cerclées de jaune).
        this.fillRange(g, cells, PALETTE.yellow, 0.16, true);
        for (const m of this.game.factory.machinesInRange(cells)) {
          g.roundRect(m.x * CELL - 3, m.y * CELL - 3, m.w * CELL + 6, m.h * CELL + 6, 15).stroke({ width: 3.5, color: PALETTE.yellow });
        }
        g.moveTo((cells[0].x + 0.5) * CELL, (cells[0].y + 0.5) * CELL);
        for (const c of cells.slice(1)) g.lineTo((c.x + 0.5) * CELL, (c.y + 0.5) * CELL);
        if (cells.length === 1) g.circle((cells[0].x + 0.5) * CELL, (cells[0].y + 0.5) * CELL, 3);
        g.stroke({ width: 7, color: PALETTE.ink, alpha: 0.75, cap: 'round', join: 'round' });
        dashedPolyline(g, cells.map((c) => ({ x: (c.x + 0.5) * CELL, y: (c.y + 0.5) * CELL })), 5, 4);
        g.stroke({ width: 2.5, color: pv.tracer.blocked ? PALETTE.coral : PALETTE.yellow, cap: 'round' });
      }
    } else if (pv?.kind === 'trace') {
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
      // Une station : son rayon d'action, en pointillés, pendant qu'on la pose ou la déplace.
      if (pv.type === 'station') this.drawRange(g, x + W / 2, y + H / 2);
      g.roundRect(x + 1, y + 1, W - 2, H - 2, 15).fill({ color: pv.ok ? PALETTE.white : 0xffd9d0, alpha: 0.85 });
      dashedPolyline(g, roundRectPoints(x + 1, y + 1, W - 2, H - 2, 15), 6, 5, true);
      g.stroke({ width: 2, color: pv.ok ? PALETTE.ink : PALETTE.coral, alpha: 0.6 });
    } else if (pv?.kind === 'eraseRect') {
      // Gomme en zone : le rectangle, et ce qui partira cerclé de corail.
      const x0 = Math.min(pv.x0, pv.x1) * CELL, y0 = Math.min(pv.y0, pv.y1) * CELL;
      const w = (Math.abs(pv.x1 - pv.x0) + 1) * CELL, hh = (Math.abs(pv.y1 - pv.y0) + 1) * CELL;
      const c = this.game.areaContents(pv.x0, pv.y0, pv.x1, pv.y1);
      for (const m of c.machines) g.roundRect(m.x * CELL + 2, m.y * CELL + 2, m.w * CELL - 4, m.h * CELL - 4, 12).fill({ color: PALETTE.coral, alpha: 0.3 });
      for (const b of c.belts) g.rect(b.x * CELL + 3, b.y * CELL + 3, CELL - 6, CELL - 6).fill({ color: PALETTE.coral, alpha: 0.3 });
      g.roundRect(x0, y0, w, hh, 6).fill({ color: PALETTE.coral, alpha: 0.1 });
      dashedPolyline(g, roundRectPoints(x0, y0, w, hh, 6), 7, 5, true);
      g.stroke({ width: 2.5, color: PALETTE.coral, alpha: 0.9 });
    } else if (pv?.kind === 'erase') {
      g.circle((pv.x + 0.5) * CELL, (pv.y + 0.5) * CELL, CELL * 0.8).fill({ color: PALETTE.coral, alpha: 0.25 }).stroke({ width: 2, color: PALETTE.coral });
    }
    // Machine qu'on déplace : un cadre corail qui pulse, et une croix de déplacement au-dessus.
    if (this.movingId !== null) {
      const m = this.game.factory.machines.get(this.movingId);
      if (m) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
        const pad = 6 + pulse * 4;
        const x0 = m.x * CELL - pad, y0 = m.y * CELL - pad, w = m.w * CELL + pad * 2, hh = m.h * CELL + pad * 2;
        g.roundRect(x0, y0, w, hh, 18).fill({ color: PALETTE.coral, alpha: 0.12 });
        dashedPolyline(g, roundRectPoints(x0, y0, w, hh, 18), 7, 5, true);
        g.stroke({ width: 3, color: PALETTE.coral, alpha: 0.6 + 0.4 * pulse });
        const cx = (m.x + m.w / 2) * CELL, cy = m.y * CELL - pad - 28;
        g.circle(cx, cy, 13).fill(PALETTE.coral).stroke({ width: 2.5, color: 0xffffff });
        const a = 7, t = 2.6;
        g.moveTo(cx - a, cy).lineTo(cx + a, cy).moveTo(cx, cy - a).lineTo(cx, cy + a)
          .moveTo(cx - a + t, cy - t).lineTo(cx - a, cy).lineTo(cx - a + t, cy + t)
          .moveTo(cx + a - t, cy - t).lineTo(cx + a, cy).lineTo(cx + a - t, cy + t)
          .moveTo(cx - t, cy - a + t).lineTo(cx, cy - a).lineTo(cx + t, cy - a + t)
          .moveTo(cx - t, cy + a - t).lineTo(cx, cy + a).lineTo(cx + t, cy + a - t)
          .stroke({ width: 2, color: 0xffffff, cap: 'round', join: 'round' });
        if (m.type === 'station' && !(this.preview?.kind === 'place')) this.drawRange(g, (m.x + m.w / 2) * CELL, (m.y + m.h / 2) * CELL);
      }
    }
    // Fenêtre d'une station ouverte : son rayon d'action.
    if (this.rangeOf !== null) {
      const st = this.game.factory.machines.get(this.rangeOf);
      if (st) this.drawRange(g, (st.x + st.w / 2) * CELL, (st.y + st.h / 2) * CELL);
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

  // ---------- Arrivée : vue de loin, plongée, puis le brouillard se referme ----------

  private intro: {
    t: number; done: () => void; layer: Container; mask: Graphics; puffTex: Texture;
    puffs: { s: Sprite; a: number; j: number; base: number; spin: number }[];
    from: { x: number; y: number; zoom: number }; to: { x: number; y: number; zoom: number };
    cx: number; cy: number; r0: number; r1: number;
  } | null = null;

  static readonly INTRO = 6.2;

  get introRunning(): boolean {
    return !!this.intro;
  }

  /** Lance l'animation d'arrivée d'une nouvelle partie. */
  playIntro(done: () => void, revealRadius: number, center: { x: number; y: number }): void {
    const cam = this.camera;
    const to = { x: cam.x, y: cam.y, zoom: cam.zoom };
    const from = { x: to.x - CELL * 6, y: to.y + CELL * 10, zoom: 0.15 };
    // Nuage doux : un dégradé radial, teinté couleur brouillard.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const puffTex = Texture.from(c);
    const layer = new Container();
    const mask = new Graphics();
    this.worldLayer.addChildAt(layer, this.worldLayer.getChildIndex(this.fogLayer) + 1);
    this.worldLayer.addChild(mask);
    const rand = rng(hashString('brouillard'));
    const puffs: { s: Sprite; a: number; j: number; base: number; spin: number }[] = [];
    const N = 72;
    for (let i = 0; i < N; i++) {
      const sp = new Sprite(puffTex);
      sp.anchor.set(0.5);
      sp.tint = PALETTE.fog;
      sp.alpha = 0;
      layer.addChild(sp);
      puffs.push({ s: sp, a: (i / N) * Math.PI * 2 + rand() * 0.08, j: rand(), base: 1.6 + rand() * 2.4, spin: (rand() - 0.5) * 0.6 });
    }
    this.fogLayer.setMask({ mask, inverse: true });
    const cx = (center.x + 0.5) * CELL, cy = (center.y + 0.5) * CELL;
    const r1 = revealRadius * CELL;
    const r0 = Math.hypot(cam.width, cam.height) / 2 / 0.42 + CELL * 4;
    this.intro = { t: 0, done, layer, mask, puffTex, puffs, from, to, cx, cy, r0, r1 };
    this.fogLayer.alpha = 0.3;
    this.stepIntro(0);
  }

  /** Passe directement à la fin de l'animation. */
  skipIntro(): void {
    if (this.intro) this.intro.t = Math.max(this.intro.t, GameRenderer.INTRO - 0.35);
  }

  private stepIntro(dt: number): void {
    const it = this.intro!;
    it.t += dt;
    const t = it.t, cam = this.camera;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const ease = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
    const easeOut = (v: number) => 1 - Math.pow(1 - v, 3);
    // Caméra : un instant de loin, une première plongée (on voit la zone de départ en entier),
    // le brouillard se referme, puis on descend jusqu'au robot.
    const mid = 0.42;
    const z1 = ease(clamp((t - 1.0) / 2.0)), z2 = ease(clamp((t - 4.5) / 1.6));
    const lz = Math.log(it.from.zoom) + (Math.log(mid) - Math.log(it.from.zoom)) * z1 + (Math.log(it.to.zoom) - Math.log(mid)) * z2;
    cam.zoom = Math.exp(lz);
    const drift = (1 - z1) * t * CELL * 0.8;
    cam.x = it.from.x + (it.to.x - it.from.x) * z1 + drift;
    cam.y = it.from.y + (it.to.y - it.from.y) * z1;
    // La brume du début se dissipe pendant la plongée…
    const haze = 1 - clamp((t - 1.0) / 1.0);
    // … puis le brouillard revient des bords et se referme autour de la zone de départ.
    const k = easeOut(clamp((t - 2.1) / 2.5));
    const R = it.r0 + (it.r1 - it.r0) * k;
    const m = it.mask;
    m.clear();
    const pts: number[] = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const w = 1 + 0.05 * Math.sin(a * 5 + t * 1.3) + 0.035 * Math.sin(a * 9 - t * 2.1);
      pts.push(it.cx + Math.cos(a) * R * w, it.cy + Math.sin(a) * R * w);
    }
    m.poly(pts).fill(0xffffff);
    this.fogLayer.alpha = t < 2.1 ? 0.3 * haze : 1;
    // Les nuages suivent le bord du brouillard, puis s'effacent une fois en place.
    const show = clamp((t - 2.1) / 0.4) * (1 - clamp((t - 4.6) / 1.0));
    for (const p of it.puffs) {
      const w = 1 + 0.05 * Math.sin(p.a * 5 + t * 1.3) + 0.035 * Math.sin(p.a * 9 - t * 2.1);
      const rr = R * w * (0.97 + p.j * 0.1);
      p.s.position.set(it.cx + Math.cos(p.a + p.spin * t * 0.1) * rr, it.cy + Math.sin(p.a + p.spin * t * 0.1) * rr);
      const size = (p.base * CELL * 3) * (0.55 + 0.45 * (R / it.r0)) / 64;
      p.s.scale.set(Math.max(size, 1.2));
      p.s.alpha = show * (0.75 + 0.25 * p.j);
    }
    if (t >= GameRenderer.INTRO) this.endIntro();
  }

  private endIntro(): void {
    const it = this.intro!;
    this.intro = null;
    this.fogLayer.setMask({ inverse: false });
    this.fogLayer.mask = null;
    this.fogLayer.alpha = 1;
    it.mask.destroy();
    it.layer.destroy({ children: true });
    it.puffTex.destroy(true);
    this.camera.x = it.to.x; this.camera.y = it.to.y; this.camera.zoom = it.to.zoom;
    it.done();
  }

  // ---------- Scanner du robot : flèches vers les filons les plus proches ----------

  private scanLayer = new Container();
  private scanG = new Graphics();
  private scanTexts: Text[] = [];
  private scanState: { item: string; targets: { x: number; y: number; r: number }[]; t: number } | null = null;
  static readonly SCAN_TIME = 10;

  /** Affiche pendant 10 s une flèche autour du robot vers chaque filon trouvé, avec sa distance. */
  startScan(itemId: string, targets: { x: number; y: number; r: number }[]): void {
    this.scanState = { item: itemId, targets, t: 0 };
    if (!this.scanG.parent) this.scanLayer.addChild(this.scanG);
  }

  private stepScan(dt: number): void {
    const g = this.scanG;
    g.clear();
    const st = this.scanState;
    if (!st) { for (const t of this.scanTexts) t.visible = false; return; }
    st.t += dt;
    if (st.t > GameRenderer.SCAN_TIME) { this.scanState = null; for (const t of this.scanTexts) t.visible = false; return; }
    const a = Math.min(1, (GameRenderer.SCAN_TIME - st.t) / 1.5) * Math.min(1, st.t / 0.25);
    const cam = this.camera, r = this.game.robot;
    const rs = cam.worldToScreen(r.x * CELL, (r.y - 0.6) * CELL);
    const color = item(st.item).patch ?? item(st.item).color;
    const pulse = 0.5 + 0.5 * Math.sin(st.t * 6);
    st.targets.forEach((tg, i) => {
      const dx = tg.x - r.x, dy = tg.y - r.y;
      const dist = Math.hypot(dx, dy);
      const ux = dist > 0 ? dx / dist : 1, uy = dist > 0 ? dy / dist : 0;
      const px = -uy, py = ux;
      const R = 58 + i * 4;
      const cx = rs.x + ux * R, cy = rs.y + uy * R;
      // La flèche : un triangle arrondi, couleur du filon, cerclé d'encre.
      g.poly([cx + ux * 13, cy + uy * 13, cx - ux * 7 + px * 10, cy - uy * 7 + py * 10, cx - ux * 3, cy - uy * 3, cx - ux * 7 - px * 10, cy - uy * 7 - py * 10])
        .fill({ color, alpha: a }).stroke({ width: 2.5, color: PALETTE.ink, alpha: a, join: 'round' });
      // Sur le filon lui-même (s'il est à l'écran) : un anneau qui pulse.
      const ts = cam.worldToScreen(tg.x * CELL, tg.y * CELL);
      if (ts.x > -40 && ts.y > -40 && ts.x < cam.width + 40 && ts.y < cam.height + 40) {
        g.circle(ts.x, ts.y, (16 + pulse * 8) * Math.max(0.6, cam.zoom)).stroke({ width: 3, color: PALETTE.ink, alpha: a * (0.4 + 0.4 * pulse) });
      }
      let t = this.scanTexts[i];
      if (!t) {
        t = new Text({ text: '', style: { fontFamily: FONT, fontSize: 12, fontWeight: '900', fill: PALETTE.ink, stroke: { color: 0xffffff, width: 4 } }, resolution: 3 });
        t.anchor.set(0.5);
        this.scanLayer.addChild(t);
        this.scanTexts[i] = t;
      }
      const cells = Math.max(0, Math.round(dist - tg.r));
      t.text = `${cells} cases`;
      t.position.set(cx + ux * 30, cy + uy * 30);
      t.alpha = a;
      t.visible = true;
    });
    for (let i = st.targets.length; i < this.scanTexts.length; i++) this.scanTexts[i].visible = false;
  }

  // ---------- Caméra guidée et bâtiment mis en avant ----------

  private focus: { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; t: number; dur: number } | null = null;
  private highlight: { id: number; t: number } | null = null;
  private highlightG = new Graphics();

  /** Glisse la caméra vers un point du monde (en cases), avec un zoom. */
  focusOn(x: number, y: number, zoom: number, dur = 1.3): void {
    this.follow = false;
    const c = this.camera;
    this.focus = { fx: c.x, fy: c.y, fz: c.zoom, tx: x * CELL, ty: y * CELL, tz: zoom, t: 0, dur };
  }

  /** Un anneau pulse quelques secondes autour d'une machine. */
  highlightMachine(id: number): void {
    this.highlight = { id, t: 0 };
    if (!this.highlightG.parent) this.worldLayer.addChildAt(this.highlightG, this.worldLayer.getChildIndex(this.fogLayer));
  }

  /** Le joueur reprend la main : la caméra guidée s'arrête. */
  stopFocus(): void {
    this.focus = null;
  }

  private stepFocus(dt: number): void {
    const f = this.focus;
    if (f) {
      f.t = Math.min(f.dur, f.t + dt);
      const u = f.t / f.dur, e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const c = this.camera;
      c.x = f.fx + (f.tx - f.fx) * e;
      c.y = f.fy + (f.ty - f.fy) * e;
      c.zoom = Math.exp(Math.log(f.fz) + (Math.log(f.tz) - Math.log(f.fz)) * e);
      if (f.t >= f.dur) this.focus = null;
    }
    const h = this.highlight, g = this.highlightG;
    g.clear();
    if (h) {
      h.t += dt;
      const m = this.game.factory.machines.get(h.id);
      if (!m || h.t > 7) { this.highlight = null; return; }
      const pulse = 0.5 + 0.5 * Math.sin(h.t * 5);
      const pad = 6 + pulse * 5, a = Math.min(1, (7 - h.t) / 1.5);
      g.roundRect(m.x * CELL - pad, m.y * CELL - pad, m.w * CELL + pad * 2, m.h * CELL + pad * 2, 16 + pad)
        .stroke({ width: 4, color: PALETTE.coral, alpha: a * (0.5 + 0.5 * pulse) });
    }
  }

  render(dt: number): void {
    this.time += dt;
    if (this.intro) this.stepIntro(dt);
    this.stepFocus(dt);
    if (this.follow) this.centerOnRobot();
    this.stepScan(dt);
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
    // Les chevrons des raccords s'effacent dès qu'on dézoome un peu.
    const portA = Math.min(1, Math.max(0, (cam.zoom - 0.75) / 0.15));
    this.portG.alpha = portA;
    this.portG.visible = portA > 0;
    this.updateChunks();
    const cablesChanged = this.beltsDirty || this.game.factory.cables.size !== this.cableCount;
    if (this.beltsDirty) this.redrawBelts();
    // Les câbles : redessinés quand l'usine change, et deux fois par seconde (réseau alimenté ou non).
    this.cableT += dt;
    if (cablesChanged || ((this.cableCount > 0 || this.electricOn) && this.cableT > 0.5)) this.drawCables();
    this.view = cam.bounds(CELL * 3);
    this.updateUnderground();
    this.updateRoutes();
    this.meterT += dt;
    if (this.meterT > 0.5) { this.meterT = 0; this.updateMeterLabels(); }
    this.meterLabels.visible = cam.zoom > 0.55 && !this.underground;
    const span = CHUNK * CELL;
    for (const c of this.beltChunks.values()) {
      const vis = this.inView((c.x + 0.5) * span, (c.y + 0.5) * span, span / 2 + CELL);
      c.s.visible = vis; c.t.visible = vis;
    }
    this.updateMachines(dt);
    this.drawItems();
    this.updateActors();
    this.updateStationDrones();
    this.updatePickups();
    this.drawOverlay();
    this.renderLoupe();
  }
}

/** Dessine une forme du robot (repère décalé de ox, oy). */
function drawShape(g: Graphics, s: Shape, ox: number, oy: number): void {
  const st = (stroke?: number, sw?: number) => { if (stroke !== undefined) g.stroke({ width: sw ?? 2, color: stroke, cap: 'round', join: 'round' }); };
  switch (s.k) {
    case 'rect': g.roundRect(s.x - ox, s.y - oy, s.w, s.h, s.r).fill(s.fill); break;
    case 'circle': g.circle(s.x - ox, s.y - oy, s.r); if (s.fill !== undefined) g.fill(s.fill); st(s.stroke, s.sw); break;
    case 'ellipse': g.ellipse(s.x - ox, s.y - oy, s.rx, s.ry); if (s.fill !== undefined) g.fill(s.fill); st(s.stroke, s.sw); break;
    case 'poly': g.poly(s.pts.map((v, i) => v - (i % 2 ? oy : ox))); if (s.fill !== undefined) g.fill(s.fill); st(s.stroke, s.sw); break;
    case 'line': {
      g.moveTo(s.pts[0] - ox, s.pts[1] - oy);
      for (let i = 2; i < s.pts.length; i += 2) g.lineTo(s.pts[i] - ox, s.pts[i + 1] - oy);
      st(s.stroke, s.sw);
      break;
    }
  }
}

/** Ordre d'affichage d'une machine : de haut en bas, puis de gauche à droite. */
function zOf(m: { x: number; y: number; h: number }): number {
  return (m.y + m.h) * 4096 + m.x;
}

/** Un trajet décalé de o pixels sur sa droite (coins en onglet : un L reste un L). */
function offsetPath(pts: { x: number; y: number }[], o: number): { x: number; y: number }[] {
  const n = pts.length;
  const norm = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / d, y: (b.x - a.x) / d };
  };
  return pts.map((p, i) => {
    const n1 = i > 0 ? norm(pts[i - 1], p) : null, n2 = i < n - 1 ? norm(p, pts[i + 1]) : null;
    if (!n1 || !n2) { const m = (n1 ?? n2)!; return { x: p.x + m.x * o, y: p.y + m.y * o }; }
    const k = 1 + n1.x * n2.x + n1.y * n2.y;
    return k < 1e-6 ? { x: p.x + n1.x * o, y: p.y + n1.y * o } : { x: p.x + (n1.x + n2.x) * o / k, y: p.y + (n1.y + n2.y) * o / k };
  });
}
