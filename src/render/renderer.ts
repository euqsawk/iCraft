// Rendu du monde avec PixiJS : sol, filons, tapis, machines, objets, robot, brouillard.
import { Application, CanvasSource, Container, FillGradient, Graphics, RenderTexture, Sprite, Text, Texture, TilingSprite, type ICanvas } from 'pixi.js';

/** Les types DOM et ceux de PixiJS divergent sur getContext('webgpu') : simple conversion. */
const asCanvas = (c: HTMLCanvasElement) => c as unknown as ICanvas;
import { BIOME_COLORS, CELL, CHUNK, LEVEL_COLORS, PALETTE, RULES } from '../config.ts';
import { item, ITEM_LIST } from '../data/items.ts';
import { machineDef } from '../data/machines.ts';
import { span, type Belt, type Machine } from '../sim/factory.ts';
import type { Game } from '../sim/game.ts';
import { clock } from '../sim/freight.ts';
import { DX, DY, key, unkey } from '../sim/geom.ts';
import type { CableTracer } from '../sim/cables.ts';
import type { BeltTracer } from '../sim/tracer.ts';
import { chunkKey, patchRadius, type Patch } from '../world/world.ts';
import { hashString, rng } from '../world/rng.ts';
import { Camera } from './camera.ts';
import { buildingTexture, itemSvgUrl, itemTexture } from './buildingIcons.ts';
import { dashedPolyline, drawBolt, drawItem, drawMachineBody, drawMachineIcon, roundRectPoints } from './draw.ts';
import { ITEM_SPRITE_SCALE, orbitItemTexture, SKIN_ANCHOR, SKIN_SCALE, SKIN_SPRITE_SCALE, skinTexture } from './skinTextures.ts';
import { orbitPoint, skinBody, skinOf } from '../data/skins.ts';
import { inTunnel, pointAt, stepCells, type LegRoute } from '../sim/routes.ts';
import { isStationType, rotDims, stationGeo, type Rot } from '../sim/stations.ts';
import { SKIN_ART } from '../data/skinArt.ts';

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

/** Pixels de sol par case : assez pour des bords de biomes arrondis. */
const GROUND_RES = 4;
const FONT = "Nunito, ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";

export type Preview =
  | { kind: 'trace'; tracer: BeltTracer }
  | { kind: 'cable'; tracer: CableTracer }
  | { kind: 'pipe'; tracer: CableTracer }
  | { kind: 'place'; type: string; x: number; y: number; ok: boolean; ore?: string; rot?: number }
  | { kind: 'erase'; x: number; y: number }
  | { kind: 'eraseRect'; x0: number; y0: number; x1: number; y1: number; module?: boolean }
  /** On glisse une entrée ou une sortie vers un côté de la machine : ses emplacements, et celui visé. */
  | { kind: 'ports'; id: number; io: 'in' | 'out'; slot: { x: number; y: number } | null }
  | null;

export type Selection = { kind: 'machine'; id: number } | { kind: 'belt'; x: number; y: number } | { kind: 'robot' } | null;

interface ChunkView {
  ground: Sprite;
  filons: Graphics;
  fog: Sprite | Graphics;
  fogVersion: number;
}

interface MachineView {
  /** Gare ou dépôt : son sens au dernier dessin. */
  rot?: number;
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
  /** Foreuse 1 × 1 : côtés où une foreuse voisine du même groupe est collée (masque), et texte du nom. */
  link?: number;
  labelText?: string;
  /** Niveau dessiné (couleur du socle). */
  lvl?: number;
  made: number;
  pop: number;
  /** L'ombre du socle (dessinée au sol, sous les tapis). */
  sh?: { w: number; h: number; r: number };
  /** Petit rebond quand le robot vient de la construire. */
  bp?: number;
  status: string;
}

/** Couleur des chevrons d'un tapis selon son niveau (1 discret, puis jaune, corail, violet, bleu). */
const BELT_LEVEL_COLORS = LEVEL_COLORS.mark;

/** Le socle d'une machine prend la couleur de son niveau (blanc au niveau 1). */
function levelFill(m: { lvl?: number }): number {
  return LEVEL_COLORS.body[Math.max(0, Math.min(4, (m.lvl ?? 1) - 1))];
}

/** La variante du dessin d'un bâtiment : le minerai d'une foreuse, une forme d'arbre selon sa place. */
function iconVariant(m: Machine): number | string {
  if ((m.type === 'foreuse' || m.type === 'super_foreuse') && m.ore) return m.ore;
  if (m.type === 'arbre') {
    let h = Math.imul(m.x, 374761393) + Math.imul(m.y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % 3;
  }
  return 0;
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
  /** Feux et barrières des croisements (redessinés à chaque image). */
  private lightG = new Graphics();
  private routeSig = '';
  private vehicleViews = new Map<string, { root: Container; parts: Container[]; cargo: Sprite; kind: string }>();
  /** Mode électricité (outil Câble) : la surface pâlit, on voit les câbles sous les blocs et les machines alimentées. */
  electric = false;
  /** Câbles visibles hors du mode électricité (gomme) ; sinon ils restent cachés. */
  showCables = false;
  /** Outil Tuyau : les tuyaux ressortent (le reste pâlit un peu). */
  waterView = false;
  /** Tuyaux d'eau : au sol, sous les tapis, toujours visibles. */
  private pipeG = new Graphics();
  private electricOn = false;
  /** Câbles et machines du réseau, par-dessus le voile, en mode électricité. */
  private powerG = new Graphics();
  /** La portée des drones du robot, très pâle, sous tout le reste (construction, puis charbon et livraisons). */
  /** Voile du mode électricité, sur la surface. */
  private modeTint = new Graphics();
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
  private noyauView: { root: Container; ring: Graphics; badge: Graphics; progress: number; pulse: number; reactor?: NoyauReactor } | null = null;
  private noyauLabel: Text | null = null;
  private itemTextures = new Map<string, Texture>();
  private itemPool: Sprite[] = [];
  private robotView!: { root: Container; shadow: Graphics; body: Container; beam: Graphics; flip: Container; sprite: Sprite; back: Container; front: Container; items: { back: Sprite; front: Sprite }[]; dur: number; wobble: boolean; look: string };
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
  /** L'usine affichée (la carte ou l'intérieur d'un atelier) et la pièce de l'atelier. */
  private shownFactory: unknown = null;
  /** La nuit : un voile bleu nuit sur la carte, et la lumière des bâtiments et du robot (en mode additif). */
  /**
   * La nuit : une carte de lumière (couleur de la nuit, et des taches de lumière ajoutées par-dessus),
   * dessinée hors écran puis posée sur la scène en mode « multiplier » : ce qui est éclairé garde ses couleurs,
   * le reste s'assombrit.
   */
  private nightLayer = new Container();
  private nightDark = new Graphics();
  private glowLayer = new Container();
  private lightRT: RenderTexture | null = null;
  private lightSprite = new Sprite();
  /** Météo : pluie ou neige, à l'écran. */
  private weatherG = new Graphics();
  /** Le robot qui construit : un rayon vers le chantier, des étincelles, un anneau qui se remplit, une bouffée à la fin. */
  private buildG = new Graphics();
  private buildPuffs: { x: number; y: number; t: number; big: boolean }[] = [];
  private justBuilt = new Set<number>();
  /** Les ombres des socles, au sol : les tapis passent par-dessus (un tapis qui entre par le bas se voit en entier). */
  private machineShadowG = new Graphics();
  private shadowsDirty = true;
  private noyauShadow: { w: number; h: number; r: number } | null = null;
  /** Le train de fret sur son quai, et son compte à rebours. */
  private trainG = new Graphics();
  private trainText: Text | null = null;
  private trainP = 0;
  private trainLeaving = false;
  /** La fusée : debout sur sa rampe pendant le compte à rebours, puis le décollage. */
  private rocketG = new Graphics();
  private rocketAnim: { x: number; y: number; t: number } | null = null;
  /** Téléportation du robot vers sa base : d'où il part, et depuis combien de temps. */
  private tpAnim: { fx: number; fy: number; t: number } | null = null;
  /** Tri : l'objet trié, en petit, sur la case du séparateur. */
  private filterLayer = new Container();
  /** Les trieurs, par-dessus les machines (leur pastille déborde du tapis). */
  private pickLayer = new Container();
  private glowPool: Sprite[] = [];
  private glowTex: Texture | null = null;
  private roomG = new Graphics();
  private roomSize = 0;
  /** Caméra de la carte, gardée pendant qu'on est dans un atelier. */
  private outerCam: { x: number; y: number; zoom: number } | null = null;

  constructor(app: Application, game: Game) {
    this.app = app;
    this.game = game;
    app.stage.addChild(this.worldLayer, this.scanLayer);
    this.worldLayer.addChild(this.groundLayer);
    const dotTex = this.makeDotTexture();
    this.dots = new TilingSprite({ texture: dotTex, width: 100, height: 100 });
    this.dots.alpha = 0.5;
    this.worldLayer.addChild(this.roomG, this.dots, this.filonLayer, this.routeG, this.pipeG, this.groundShadows, this.cableG, this.beltShadow, this.beltTop, this.linkG, this.ghostBeltG, this.itemLayer, this.bridgeG, this.bridgeItemLayer, this.filterLayer, this.meterG, this.machineLayer, this.pickLayer, this.portG, this.modeTint, this.powerG, this.meterLabels, this.lightG, this.buildG, this.actorLayer, this.rocketG, this.trainG, this.fx, this.fogLayer, this.overlay);
    this.nightLayer.addChild(this.nightDark, this.glowLayer);
    this.glowLayer.blendMode = 'add';
    this.lightSprite.blendMode = 'multiply';
    this.lightSprite.visible = false;
    app.stage.addChildAt(this.lightSprite, app.stage.getChildIndex(this.worldLayer) + 1);
    app.stage.addChildAt(this.weatherG, app.stage.getChildIndex(this.lightSprite) + 1);
    for (const d of ITEM_LIST) {
      const tex = itemTexture(d.id);
      if (tex) { this.itemTextures.set(d.id, tex); continue; }
      const g = new Graphics();
      drawItem(g, d.id);
      this.itemTextures.set(d.id, app.renderer.generateTexture({ target: g, resolution: 4, antialias: true }));
      g.destroy();
    }
    this.buildRobot();
    this.buildLoupe();
    game.on((e) => {
      if (e.type === 'factory' || e.type === 'built') { this.beltsDirty = true; this.shadowsDirty = true; }
      if (e.type === 'built') {
        const p = e.job.kind === 'belt' ? (() => { const b = this.game.view.belts.get(e.job.k); return b ? { x: b.x + 0.5, y: b.y + 0.5 } : null; })()
          : (() => { const m = this.game.view.machines.get(e.job.id); if (m) this.justBuilt.add(m.id); return m ? { x: m.x + m.w / 2, y: m.y + m.h / 2 } : null; })();
        if (p) this.buildPuffs.push({ x: p.x * CELL, y: p.y * CELL, t: 0, big: e.job.kind === 'machine' });
      }
      if (e.type === 'deliver' && e.at === 'noyau' && this.noyauView) this.noyauView.pulse = 1;
      if (e.type === 'look') this.refreshLook();
      if (e.type === 'teleport') this.tpAnim = { fx: e.fromX * CELL, fy: e.fromY * CELL, t: 0 };
      if (e.type === 'rocket') {
        const m = game.factory.machines.get(e.id);
        if (m) {
          this.rocketAnim = { x: (m.x + m.w / 2) * CELL, y: (m.y + m.h / 2) * CELL, t: 0 };
          if (!game.inAtelier) this.focusOn(this.rocketAnim.x, this.rocketAnim.y - CELL * 4, 0.8, 1.2);
        }
      }
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

  /**
   * Le sol d'un chunk : GROUND_RES pixels par case, pour des bords de biomes nets et arrondis (et non des marches floues
   * où deux couleurs semblent se chevaucher). Le biome n'est recalculé finement que près des bords.
   */
  private groundTexture(cx: number, cy: number): Texture {
    const w = this.game.world, S = GROUND_RES, n = CHUNK + 2, px = n * S;
    const x0 = cx * CHUNK - 1, y0 = cy * CHUNK - 1;
    // Une valeur par case (bordure comprise), comme le jeu la voit.
    const cells: string[] = new Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cells[j * n + i] = w.biomeAt(x0 + i, y0 + j);
    const same = (i: number, j: number): boolean => {
      const b = cells[j * n + i];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, c = j + dj;
        if (a < 0 || c < 0 || a >= n || c >= n) continue;
        if (cells[c * n + a] !== b) return false;
      }
      return true;
    };
    const c = document.createElement('canvas');
    c.width = px; c.height = px;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(px, px);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const flat = same(i, j);
        for (let sj = 0; sj < S; sj++) {
          for (let si = 0; si < S; si++) {
            // Au centre d'une case, le biome fin vaut celui du jeu ; entre deux cases il suit le relief du bruit.
            const b = flat ? cells[j * n + i] : w.biomeAt(x0 + i + (si + 0.5) / S - 0.5, y0 + j + (sj + 0.5) / S - 0.5);
            const color = BIOME_COLORS[b as keyof typeof BIOME_COLORS];
            const o = ((j * S + sj) * px + i * S + si) * 4;
            img.data[o] = (color >> 16) & 255; img.data[o + 1] = (color >> 8) & 255; img.data[o + 2] = color & 255; img.data[o + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    const source = new CanvasSource({ resource: asCanvas(c), scaleMode: 'linear' });
    return new Texture({ source, frame: { x: S, y: S, width: CHUNK * S, height: CHUNK * S } as never });
  }

  private createChunk(cx: number, cy: number): ChunkView {
    const w = this.game.world;
    const groundTex = this.groundTexture(cx, cy);
    const ground = new Sprite(groundTex);
    ground.position.set(cx * CHUNK * CELL, cy * CHUNK * CELL);
    ground.scale.set(CELL / GROUND_RES);
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

  /** Un lac : une rive de sable, l'eau de plus en plus profonde vers le milieu, des reflets et quelques nénuphars. */
  private drawLake(g: Graphics, p: Patch): void {
    const ring = (k: number, add: number) => {
      const pts: number[] = [];
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const r = (patchRadius(p, a) * k + add) * CELL;
        pts.push(p.cx * CELL + Math.cos(a) * r, p.cy * CELL + Math.sin(a) * r);
      }
      return pts;
    };
    g.poly(ring(1, 1.1)).fill(0xE9DFB4); // la plage
    g.poly(ring(1, 0.75)).fill(0xD6CF9C); // le sable mouillé
    g.poly(ring(1, 0.35)).fill(0x9AD4EC); // le bord, peu profond
    g.poly(ring(0.82, 0)).fill(0x7CC2E6);
    g.poly(ring(0.55, 0)).fill(0x63B0DD); // le fond
    const rand = rng(hashString(p.id));
    // Reflets : de petites vagues claires.
    const waves = Math.round(p.r * 2.2);
    for (let i = 0; i < waves; i++) {
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * p.r * 0.78 * CELL;
      const x = p.cx * CELL + Math.cos(a) * rr, y = p.cy * CELL + Math.sin(a) * rr, w = (5 + rand() * 7);
      g.moveTo(x - w, y).quadraticCurveTo(x - w / 2, y - 3, x, y).quadraticCurveTo(x + w / 2, y - 3, x + w, y);
      g.stroke({ width: 1.8, color: 0xffffff, alpha: 0.55, cap: 'round' });
    }
    // Nénuphars près du bord.
    const pads = 3 + Math.round(rand() * 4);
    for (let i = 0; i < pads; i++) {
      const a = rand() * Math.PI * 2, rr = (patchRadius(p, a) * (0.8 + rand() * 0.1)) * CELL;
      const x = p.cx * CELL + Math.cos(a) * rr, y = p.cy * CELL + Math.sin(a) * rr, r = 3.5 + rand() * 2.5, cut = rand() * Math.PI * 2;
      g.moveTo(x, y).arc(x, y, r, cut + 0.5, cut + Math.PI * 2 - 0.1).closePath().fill(0x5FA65A);
      if (rand() < 0.4) g.circle(x + Math.cos(cut + 2) * r * 0.3, y + Math.sin(cut + 2) * r * 0.3, 1.6).fill(0xF6A5C0);
    }
    // Quelques roseaux sur la rive.
    const reeds = 2 + Math.round(rand() * 3);
    for (let i = 0; i < reeds; i++) {
      const a = rand() * Math.PI * 2, rr = (patchRadius(p, a) + 0.55) * CELL;
      const x = p.cx * CELL + Math.cos(a) * rr, y = p.cy * CELL + Math.sin(a) * rr;
      for (let k = -1; k <= 1; k++) g.moveTo(x + k * 2.5, y + 4).lineTo(x + k * 3.5, y - 5 - (k === 0 ? 3 : 0));
      g.stroke({ width: 1.6, color: 0x6E8F4A, cap: 'round' });
    }
  }

  private drawPatch(g: Graphics, p: Patch): void {
    if (p.type === 'eau') { this.drawLake(g, p); return; }
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

  /** Les tuyaux : un double trait bleu de case en case, avec un raccord rond aux bouts et aux croisements. */
  private drawPipes(): void {
    const g = this.pipeG, f = this.game.view;
    g.clear();
    if (!f.pipes.size) return;
    const segs: [number, number, number, number][] = [];
    const joints: [number, number][] = [];
    for (const k of f.pipes) {
      const [x, y] = unkey(k);
      const cx = (x + 0.5) * CELL, cy = (y + 0.5) * CELL;
      let links = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        const m = f.machineAt(nx, ny);
        if (f.hasPipe(nx, ny)) { links++; if (d < 2) segs.push([cx, cy, cx + DX[d] * CELL, cy + DY[d] * CELL]); }
        else if (m && (machineDef(m.type).kind === 'pump' || f.waterUse(m))) { links++; segs.push([cx, cy, cx + DX[d] * CELL * 0.6, cy + DY[d] * CELL * 0.6]); }
      }
      if (links !== 2) joints.push([cx, cy]);
    }
    for (const [a, b, c, d] of segs) g.moveTo(a, b).lineTo(c, d);
    g.stroke({ width: 8, color: 0x2b5f8a, cap: 'round', join: 'round' });
    for (const [a, b, c, d] of segs) g.moveTo(a, b).lineTo(c, d);
    g.stroke({ width: 4.5, color: 0x7cc3f0, cap: 'round', join: 'round' });
    for (const [x, y] of joints) g.circle(x, y, 5.5).fill(0x2b5f8a).circle(x, y, 3).fill(0xbfe4fb);
  }

  private redrawBelts(): void {
    this.beltsDirty = false;
    this.drawPipes();
    this.filterLayer.removeChildren().forEach((c) => c.destroy());
    this.pickLayer.removeChildren().forEach((c) => c.destroy());
    for (const b of this.game.view.belts.values()) {
      if (b.split === undefined) continue;
      // Une pastille par dérivation triée : l'objet qui y part.
      for (const [t, d] of [[b.filter, b.split], [b.filter2, b.split2]] as [string | undefined, number | undefined][]) {
        if (!t || d === undefined) continue;
        const x = (b.x + 0.5) * CELL + DX[d] * 7, y = (b.y + 0.5) * CELL + DY[d] * 7;
        const badge = new Graphics().circle(x, y, 7.5).fill(0xffffff).stroke({ width: 1.6, color: PALETTE.ink });
        // Tri par destination : la petite image du bâtiment (Noyau, Laboratoire, Comptoir, quai du train).
        const dest = ({ '@noyau': 'noyau', '@labo': 'laboratoire', '@comptoir': 'comptoir', '@train': 'depot' } as Record<string, string>)[t];
        const tex = dest ? buildingTexture(dest) : this.itemTextures.get(t);
        if (!tex) continue;
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        if (dest) sp.width = sp.height = 11; else sp.scale.set(0.5);
        sp.position.set(x, y);
        this.filterLayer.addChild(badge, sp);
      }
    }
    const gg = this.ghostBeltG;
    gg.clear();
    const built: Belt[] = [], ghosts: Belt[] = [];
    // Les tapis construits, rangés par morceau de carte.
    const groups = new Map<string, Belt[]>();
    for (const b of this.game.view.belts.values()) {
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
    const f = this.game.view;
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
      // Le tapis prend la couleur de son niveau.
      for (let lv = 1; lv <= 5; lv++) {
        const part = list.filter((b) => (b.lvl ?? 1) === lv);
        if (!part.length) continue;
        line(g, part, 0);
        g.stroke({ width: 14, color: LEVEL_COLORS.belt[lv - 1], cap: 'round', join: 'round' });
      }
      // Rouleaux discrets : un chevron par case, dans le sens du tapis, à la couleur de son niveau
      // (deux chevrons à partir du niveau 4).
      for (let lv = 1; lv <= 5; lv++) {
        let any = false;
        for (const b of list) {
          if ((b.lvl ?? 1) !== lv) continue;
          any = true;
          const cx = (b.x + 0.5) * CELL, cy = (b.y + 0.5) * CELL;
          const fx = DX[b.dir], fy = DY[b.dir];
          const px = -fy, py = fx;
          const offs = lv >= 4 ? [-2.2, 2.2] : [0];
          for (const o of offs) {
            const ox = cx + fx * o, oy = cy + fy * o;
            g.moveTo(ox - fx * 2 + px * 3.2, oy - fy * 2 + py * 3.2).lineTo(ox + fx * 1.2, oy + fy * 1.2).lineTo(ox - fx * 2 - px * 3.2, oy - fy * 2 - py * 3.2);
          }
        }
        if (any) g.stroke({ width: lv === 1 ? 2 : 2.4, color: BELT_LEVEL_COLORS[lv - 1], cap: 'round', join: 'round' });
      }
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
    for (const b of this.game.view.belts.values()) {
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
    const f = this.game.view;
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

  /** Les points (en pixels) d'un morceau de trajet, entre les distances s0 et s1. */
  private legSlice(leg: LegRoute, s0: number, s1: number): { x: number; y: number }[] {
    const a = Math.max(0, s0), b = Math.min(leg.len, s1);
    if (b - a < 0.01) return [];
    const pts: { x: number; y: number }[] = [];
    const push = (s: number) => { const p = pointAt(leg, s); pts.push({ x: p.x * CELL, y: p.y * CELL }); };
    push(a);
    // Les coins du trajet entre les deux.
    for (let i = 1; i < leg.steps.length; i++) if (leg.steps[i].d !== leg.steps[i - 1].d && i > a && i < b) push(i);
    push(Math.min(b, leg.len - 1e-6));
    if (b >= leg.len - 1e-6) { const last = leg.pts[leg.pts.length - 1]; pts[pts.length - 1] = { x: last.x * CELL, y: last.y * CELL }; }
    return pts;
  }

  /** Les morceaux à la surface d'un trajet (entre les tunnels). */
  private surfaceParts(leg: LegRoute): [number, number][] {
    const out: [number, number][] = [];
    let s = 0;
    for (const [a, b] of leg.tunnels) { if (a > s) out.push([s, a]); s = b; }
    if (s < leg.len) out.push([s, leg.len]);
    return out;
  }

  private drawRoutes(): void {
    const g = this.routeG, f = this.game.view;
    g.clear();
    const legs: { kind: string; leg: LegRoute }[] = [];
    for (const l of f.lines.values()) for (const leg of f.routes.get(l.id)?.legs ?? []) legs.push({ kind: l.kind, leg });
    const line = (pts: { x: number; y: number }[], o = 0) => { const q = o ? offsetPath(pts, o) : pts; g.moveTo(q[0].x, q[0].y); for (const p of q.slice(1)) g.lineTo(p.x, p.y); };
    const W = CELL * 2;
    // Les rails d'abord, les routes par-dessus (aux passages à niveau, les rails sont redessinés sur la route).
    for (const { kind, leg } of [...legs].sort((x, y) => (x.kind === 'train' ? 0 : 1) - (y.kind === 'train' ? 0 : 1))) {
      for (const [a, b] of this.surfaceParts(leg)) {
        const pts = this.legSlice(leg, a, b);
        if (pts.length < 2) continue;
        if (kind === 'camion') {
          // Voie à sens unique de 2 cases : bas-côtés, chaussée, lignes de rive, flèches dans le sens de la marche.
          line(pts); g.stroke({ width: W, color: 0x8f9aa6, join: 'miter', cap: 'butt' });
          line(pts); g.stroke({ width: W - 5, color: 0xa9b3bd, join: 'miter', cap: 'butt' });
          for (const o of [-W / 2 + 5, W / 2 - 5]) { line(pts, o); g.stroke({ width: 1.6, color: 0xffffff, alpha: 0.8, join: 'miter' }); }
        } else {
          // Ballast de 2 cases, traverses, une voie au milieu.
          line(pts); g.stroke({ width: W - 4, color: 0xc9b79c, join: 'miter', cap: 'butt' });
          for (let i = 1; i < pts.length; i++) {
            const p0 = pts[i - 1], p1 = pts[i], d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
            const ux = (p1.x - p0.x) / (d || 1), uy = (p1.y - p0.y) / (d || 1), px = -uy, py = ux;
            for (let s2 = 4; s2 < d; s2 += 8) {
              const x = p0.x + ux * s2, y = p0.y + uy * s2;
              g.moveTo(x + px * 10, y + py * 10).lineTo(x - px * 10, y - py * 10);
            }
          }
          g.stroke({ width: 3.2, color: 0x9b7653, cap: 'round' });
          for (const r of [-5, 5]) { line(pts, r); g.stroke({ width: 2, color: 0x56606b, join: 'miter' }); }
        }
      }
      // Flèches (routes) : le sens de la marche, toutes les 4 cases à la surface.
      if (kind === 'camion') {
        for (let s = 3; s < leg.len - 2; s += 4) {
          if (inTunnel(leg, s)) continue;
          const p = pointAt(leg, s), q = pointAt(leg, s + 0.05);
          if (Math.abs(p.a - q.a) > 0.01) continue;
          const cx = p.x * CELL, cy = p.y * CELL, ca = Math.cos(p.a), sa = Math.sin(p.a);
          const P = (u: number, v: number) => ({ x: cx + ca * u - sa * v, y: cy + sa * u + ca * v });
          const A = P(-4, -7), B = P(4, 0), C = P(-4, 7);
          g.moveTo(A.x, A.y).lineTo(B.x, B.y).lineTo(C.x, C.y).stroke({ width: 3, color: 0xffffff, alpha: 0.85, cap: 'round', join: 'round' });
        }
      }
      // Tunnels : le trajet en pointillés sous la terre, et une entrée à chaque bout.
      for (const [a, b] of leg.tunnels) {
        const pts = this.legSlice(leg, a, b);
        if (pts.length >= 2) for (const o of [-W / 2 + 2, W / 2 - 2]) {
          dashedPolyline(g, offsetPath(pts, o), 6, 6);
          g.stroke({ width: 2, color: PALETTE.ink, alpha: 0.28 });
        }
        for (const [s, inward] of [[a, 1], [b, -1]] as const) this.drawPortal(g, leg, s, inward, kind);
      }
    }
    // Croisements : carrefour (asphalte uni), passage à niveau (rails sur la route), croisement de rails.
    for (const c of f.crossings) {
      const xs = c.cells.map((k) => unkey(k));
      const x0 = Math.min(...xs.map((p) => p[0])), y0 = Math.min(...xs.map((p) => p[1]));
      const x1 = Math.max(...xs.map((p) => p[0])) + 1, y1 = Math.max(...xs.map((p) => p[1])) + 1;
      if (c.kind === 'carrefour') {
        g.rect(x0 * CELL, y0 * CELL, (x1 - x0) * CELL, (y1 - y0) * CELL).fill(0xa9b3bd);
        // Lignes d'arrêt avant le carrefour.
        for (const m of c.members) {
          const leg = f.routes.get(m.line)?.legs[m.leg];
          if (!leg) continue;
          const p = pointAt(leg, m.sIn - 0.15), ca = Math.cos(p.a), sa = Math.sin(p.a);
          g.moveTo(p.x * CELL + sa * (CELL - 4), p.y * CELL - ca * (CELL - 4)).lineTo(p.x * CELL - sa * (CELL - 4), p.y * CELL + ca * (CELL - 4)).stroke({ width: 3, color: 0xffffff, alpha: 0.9 });
        }
      } else {
        for (const m of c.members) {
          if (m.kind !== 'train') continue;
          const leg = f.routes.get(m.line)?.legs[m.leg];
          if (!leg) continue;
          const pts = this.legSlice(leg, m.sIn - 0.2, m.sOut + 0.2);
          if (pts.length < 2) continue;
          for (const r of [-5, 5]) { line(pts, r); g.stroke({ width: 2.4, color: 0x56606b }); }
        }
      }
    }
  }

  /** Entrée d'un tunnel : la voie descend sous un cadre de béton, la bouche sombre vers l'extérieur. */
  private drawPortal(g: Graphics, leg: LegRoute, s: number, inward: number, kind: string): void {
    const p = pointAt(leg, Math.min(leg.len - 0.01, Math.max(0.01, s)));
    const ca = Math.cos(p.a) * inward, sa = Math.sin(p.a) * inward;
    const cx = p.x * CELL, cy = p.y * CELL;
    // u : vers l'intérieur du tunnel ; v : en travers.
    const P = (u: number, v: number) => ({ x: cx + ca * u - sa * v, y: cy + sa * u + ca * v });
    const quad = (u0: number, u1: number, v0: number, v1: number) => { const a = P(u0, v0), b = P(u1, v0), c = P(u1, v1), d = P(u0, v1); g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]); };
    // La rampe qui descend (de plus en plus sombre).
    for (let i = 0; i < 4; i++) { quad(-CELL * 1.6 + i * CELL * 0.4, -CELL * 1.6 + (i + 1) * CELL * 0.4, -CELL + 3, CELL - 3); g.fill({ color: 0x2e3a4b, alpha: 0.06 + i * 0.07 }); }
    // La bouche et le cadre.
    quad(-2, 8, -CELL + 2, CELL - 2); g.fill(0x26303f);
    quad(-6, 0, -CELL - 3, CELL + 3); g.fill(kind === 'train' ? 0x8a99ad : 0xc7d3df).stroke({ width: 2, color: PALETTE.ink });
    quad(0, 10, -CELL - 3, -CELL + 2); g.fill(0xc7d3df).stroke({ width: 2, color: PALETTE.ink });
    quad(0, 10, CELL - 2, CELL + 3); g.fill(0xc7d3df).stroke({ width: 2, color: PALETTE.ink });
  }

  /** Les feux des croisements, à droite de chaque voie avant le croisement (rouge, orange ou vert). */
  private drawLights(): void {
    const g = this.lightG, f = this.game.view;
    g.clear();
    for (const c of f.crossings) {
      if (!this.inView(c.x * CELL, c.y * CELL, CELL * 6)) continue;
      for (const m of c.members) {
        const leg = f.routes.get(m.line)?.legs[m.leg];
        if (!leg) continue;
        const st = f.crossLight(c, m);
        const p = pointAt(leg, Math.max(0, m.sIn - 0.5));
        const rx = -Math.sin(p.a), ry = Math.cos(p.a);
        const x = p.x * CELL + rx * (CELL + 7), y = p.y * CELL + ry * (CELL + 7);
        // Barrière du passage à niveau : baissée quand un train approche.
        if (c.kind === 'niveau' && m.kind === 'camion') {
          const down = st === 'red';
          const bx = p.x * CELL + rx * (CELL - 1), by = p.y * CELL + ry * (CELL - 1);
          const len = down ? CELL * 2 - 4 : 8;
          const ex = bx - rx * len, ey = by - ry * len;
          g.moveTo(bx, by).lineTo(ex, ey).stroke({ width: 4.5, color: PALETTE.ink, cap: 'round' });
          g.moveTo(bx, by).lineTo(ex, ey).stroke({ width: 2.6, color: 0xffffff, cap: 'round' });
          for (let k = 0.2; k < 1; k += 0.4) {
            const sx = bx + (ex - bx) * k, sy = by + (ey - by) * k, tx = bx + (ex - bx) * Math.min(1, k + 0.2), ty = by + (ey - by) * Math.min(1, k + 0.2);
            g.moveTo(sx, sy).lineTo(tx, ty).stroke({ width: 2.6, color: PALETTE.coral });
          }
        }
        const blink = c.kind === 'niveau' && m.kind === 'camion' && st === 'red' ? Math.sin(this.time * 9) > 0 : true;
        g.roundRect(x - 5, y - 9, 10, 18, 4).fill(PALETTE.ink);
        const top = st === 'green' ? 0x5a2a2a : st === 'amber' ? 0xffb347 : blink ? 0xff5a4a : 0x5a2a2a;
        const bot = st === 'green' ? 0x5fe08a : 0x24432f;
        g.circle(x, y - 4, 3).fill(top).circle(x, y + 4, 3).fill(bot);
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
    // Les voies font 2 cases : camions et trains sont dessinés plus grands.
    for (const p of parts) { p.scale.set(VEHICLE_SCALE); root.addChild(p); }
    const cargo = new Sprite();
    cargo.anchor.set(0.5);
    cargo.scale.set(0.75 * VEHICLE_SCALE);
    root.addChild(cargo);
    this.actorLayer.addChildAt(root, 0);
    return { root, parts, cargo, kind };
  }

  private updateRoutes(): void {
    const f = this.game.view;
    f.ensureRoutes();
    const sig = `${f.routeVersion}:${f.lines.size}`;
    if (sig !== this.routeSig) { this.routeSig = sig; this.drawRoutes(); }
    this.drawLights();
    const seen = new Set<string>();
    const PART = (19 * VEHICLE_SCALE) / CELL;
    for (const l of f.lines.values()) {
      const route = f.routes.get(l.id);
      if (!route) continue;
      const n = l.stops.length;
      l.vehicles.forEach((v, vi) => {
        const id = `${l.id}:${vi}`;
        seen.add(id);
        let view = this.vehicleViews.get(id);
        if (!view || view.kind !== l.kind) { view?.root.destroy({ children: true }); view = this.makeVehicle(l.kind); this.vehicleViews.set(id, view); }
        // À quai, il est au bout du trajet qui arrive ; en route, chaque wagon suit le précédent (sur le trajet d'avant s'il le faut).
        const legI = v.moving ? v.at % n : (v.at - 1 + n) % n;
        const head = v.moving ? v.pos : route.legs[legI]?.len ?? 0;
        view.parts.forEach((part, i) => {
          let li = legI, s = head - i * PART;
          if (s < 0) { li = (li - 1 + n) % n; s += route.legs[li]?.len ?? 0; }
          const leg = route.legs[li];
          if (!leg) return;
          const p = pointAt(leg, s);
          part.position.set(p.x * CELL, p.y * CELL);
          part.rotation = p.a;
          // Dans un tunnel, on ne le voit plus.
          part.visible = !inTunnel(leg, s);
        });
        const nC = f.cargoCount(v);
        const main = Object.entries(v.cargo).sort((x, y) => y[1] - x[1])[0]?.[0];
        const carrier = view.parts[view.parts.length > 1 ? 1 : 0];
        view.cargo.visible = nC > 0 && !!main && carrier.visible;
        if (main) view.cargo.texture = this.itemTextures.get(main)!;
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

  /** Surface normale, ou pâlie sous un voile bleu nuit en mode électricité. */
  private updateModeView(): void {
    const elec = this.electric;
    this.cableG.visible = this.showCables && !elec;
    if (elec !== this.electricOn) {
      this.electricOn = elec;
      const a = elec ? 0.3 : 1;
      for (const l of [this.routeG, this.cableG, this.beltShadow, this.beltTop, this.linkG, this.ghostBeltG, this.itemLayer, this.bridgeG, this.bridgeItemLayer, this.groundShadows, this.machineLayer, this.portG]) l.alpha = a;
      this.actorLayer.alpha = elec ? 0.45 : 1;
      this.modeTint.visible = elec;
      this.powerG.visible = elec;
      this.cableG.visible = this.showCables && !elec;
      this.drawCables();
    }
    if (elec) {
      const b = this.camera.bounds(CELL * 2);
      this.modeTint.clear().rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0).fill({ color: 0x1f2a3d, alpha: 0.42 });
    }
  }

  /**
   * Les câbles : un trait sombre de case en case, jaune au milieu quand le réseau a du courant.
   * En mode électricité, ils passent par-dessus le voile, avec les machines du réseau colorées.
   */
  private drawCables(): void {
    this.cableT = 0;
    const f = this.game.view;
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
    const f = this.game.view;
    // La portée des câbles posés : 5 cases autour de chaque câble.
    if (f.cables.size) {
      const cells = [...f.cables].map((k) => { const [x, y] = unkey(k); return { x, y }; });
      this.fillRange(g, cells, 0xffe7a3, 0.1);
    }
    for (const m of f.machines.values()) {
      const def = machineDef(m.type);
      const gen = def.kind === 'generator' || def.kind === 'solar' || def.kind === 'battery';
      if (!gen && !f.powerUse(m)) continue;
      const net = f.netOf(m);
      const x = m.x * CELL + 2, y = m.y * CELL + 2, w = m.w * CELL - 4, hh = m.h * CELL - 4, r = 12;
      const lit = !!net && net.supply > 0 && (def.kind === 'solar' ? this.game.daylight > 0.05 : def.kind === 'battery' ? (m.charge ?? 0) > 0 : gen ? m.status === 'working' || m.fuel > 0 || m.burn > 0 : (m.power ?? 0) > 0);
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
    const f = this.game.view;
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
    const f = this.game.view;
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
    // Entrées et sorties prévues (pas encore de tapis) : un chevron dans une pastille, sur le bord de la machine.
    for (const m of f.machines.values()) {
      if (!m.ports?.length) continue;
      const per = f.perimeter(m);
      for (const p of m.ports) {
        const x = m.x + p.rx, y = m.y + p.ry;
        if (f.beltAt(x, y)) continue;
        const c = per.find((q) => q.x === x && q.y === y);
        if (!c) continue;
        this.drawPortBadge(g, c.x, c.y, c.d, p.io === 'in', 1);
      }
    }
  }

  /** Une pastille sur le bord d'une machine, côté case (x, y) : chevron vers la machine (entrée) ou vers dehors (sortie). */
  private drawPortBadge(g: Graphics, x: number, y: number, d: number, into: boolean, alpha: number, ring?: number): void {
    const ax = DX[d], ay = DY[d], px = -ay, py = ax;
    const ex = (x + 0.5 - ax * 0.5) * CELL, ey = (y + 0.5 - ay * 0.5) * CELL;
    const color = into ? PALETTE.coral : PALETTE.green;
    g.circle(ex, ey, 7.5).fill({ color: 0xffffff, alpha }).stroke({ width: 2, color, alpha });
    if (ring) g.circle(ex, ey, 11).stroke({ width: 3, color: ring });
    // Entrée : la pointe vers la machine (contre la direction « dehors »).
    const s = into ? -1 : 1;
    g.moveTo(ex - ax * 2 * s + px * 3.5, ey - ay * 2 * s + py * 3.5).lineTo(ex + ax * 2 * s, ey + ay * 2 * s).lineTo(ex - ax * 2 * s - px * 3.5, ey - ay * 2 * s - py * 3.5)
      .stroke({ width: 2.4, color, alpha, cap: 'round', join: 'round' });
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
    for (const belt of this.game.view.belts.values()) {
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
  /** Côtés (1 droite, 2 bas, 4 gauche, 8 haut) où une foreuse 1 × 1 construite est collée à celle-ci (construite). */
  private drillLink(m: Machine): number {
    if (!m.built) return 0;
    const f = this.game.view;
    let mask = 0;
    for (let d = 0; d < 4; d++) {
      const o = f.machineAt(m.x + DX[d], m.y + DY[d]);
      if (o && o.built && o.type === 'foreuse') mask |= 1 << d;
    }
    return mask;
  }

  private leaders = new WeakMap<Machine[], Machine>();

  /** La foreuse en haut à gauche de son groupe : c'est elle qui porte le nom et le voyant. */
  private drillLeader(m: Machine): Machine {
    const group = this.game.view.drillGroup(m);
    if (group.length < 2) return m;
    let lead = this.leaders.get(group);
    if (!lead) {
      lead = group.reduce((a, b) => (b.y < a.y || (b.y === a.y && b.x < a.x) ? b : a));
      this.leaders.set(group, lead);
    }
    return lead;
  }

  /** Le nom d'un groupe de foreuses : ses minerais (« Fer », « Fer + cuivre »). */
  private drillGroupName(m: Machine): string {
    const ores = [...new Set(this.game.view.drillGroup(m).map((x) => x.ore).filter((o): o is string => !!o))];
    const short = (o: string) => item(o).name.replace('Minerai de ', '').replace("Minerai d'", '').replace('Minerai d’', '');
    const names = ores.slice(0, 2).map(short).join(' + ') + (ores.length > 2 ? ' …' : '');
    const lv = Math.min(...this.game.view.drillGroup(m).map((x) => x.lvl ?? 1));
    return (names.replace(/^./, (c) => c.toUpperCase()) || 'Foreuse') + (lv > 1 ? ` · niv. ${lv}` : '');
  }

  /**
   * Le nom d'un bâtiment s'écrit sur la rangée de cases juste au-dessus : il se cache dès qu'il y a quelque chose
   * derrière (une machine, un tapis, un quai, une route ou des rails), sur toute la largeur du texte.
   */
  private labelBlocked(m: Machine, textWidth: number): boolean {
    const f = this.game.view;
    const cx = m.x + m.w / 2, half = Math.max(m.w * CELL, textWidth + 4) / 2 / CELL;
    const y = m.y - 1;
    const lanes = this.laneCells();
    for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
      const o = f.machineAt(x, y);
      if ((o && o !== m) || f.beltAt(x, y) || f.quays.has(key(x, y)) || lanes.has(key(x, y))) return true;
    }
    return false;
  }

  /** Les cases couvertes par les routes et les rails (recalculées quand les tracés changent). */
  private laneCache: { v: number; cells: Set<number> } = { v: -1, cells: new Set() };
  private laneCells(): Set<number> {
    const f = this.game.view;
    if (this.laneCache.v !== f.routeVersion) {
      const cells = new Set<number>();
      for (const r of f.routes.values()) for (const leg of r.legs) for (const st of leg.steps) {
        const [ax, ay, bx, by] = stepCells(st.x, st.y, st.d);
        cells.add(key(ax, ay)); cells.add(key(bx, by));
      }
      this.laneCache = { v: f.routeVersion, cells };
    }
    return this.laneCache.cells;
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
    const W = m.w * CELL, H = m.h * CELL;
    const isDrill = def.kind === 'drill';
    const small = m.type === 'foreuse' && def.w === 1;
    const bw = small ? W - 2 : isDrill ? W - 8 : W - 2, bh = small ? H - 2 : isDrill ? H - 8 : H - 2, br = small ? 7 : isDrill ? 12 : m.w === 1 ? 7 : 15;
    let sh: { w: number; h: number; r: number } | undefined;
    // Lampadaires et arbres : posés tels quels, sans socle blanc ni nom.
    const bare = def.kind === 'lamp' || def.kind === 'tree' || def.kind === 'freight';
    if (def.kind === 'freight') {
      // Le Quai du train : le quai en haut (côté Noyau, là où arrivent les tapis), avec sa bande jaune au bord des rails ;
      // la voie en dessous, sur toute la longueur (elle s'enfonce sous terre aux deux bouts, voir drawTrain).
      const x0 = -W / 2, y0 = -H / 2, side = (def.w - 6) / 2 * CELL, px = x0 + side, pw = 6 * CELL, ry = y0 + CELL;
      body.roundRect(px, y0 + 4, pw, CELL - 2, 6).fill(PALETTE.shadow);
      body.roundRect(px, y0 + 1, pw, CELL - 2, 6).fill(0xEDE6D6);
      body.rect(px + 4, y0 + CELL - 6, pw - 8, 3).fill(PALETTE.yellow);
      for (let i = 0; i < 3; i++) body.roundRect(px + 12 + i * CELL * 2, y0 + 6, CELL - 6, 8, 3).fill({ color: 0xC8BFA9, alpha: 0.8 });
      body.rect(x0, ry + 2, W, CELL - 4).fill({ color: 0xB9AE95, alpha: 0.55 });
      for (let x = x0 + 3; x < x0 + W - 3; x += 9) body.roundRect(x, ry + 3, 6, CELL - 6, 1.5).fill(0x9A7B5B);
      body.rect(x0, ry + 6, W, 3).fill(0x7D8A99).rect(x0, ry + CELL - 9, W, 3).fill(0x7D8A99);
    } else if (bare) {
      icon.scale.set(1.35);
      if (!m.built) icon.alpha = 0.4;
    } else if (m.built && small) {
      // Foreuse 1 × 1 : le socle se prolonge jusqu'aux voisines du groupe, elles ne font qu'un bloc.
      const link = this.drillLink(m);
      // Les ponts vont jusqu'au bord de la case, et jusqu'aux coins quand une voisine est aussi de l'autre côté.
      const x0 = link & 4 ? -W / 2 - 0.5 : -bw / 2, x1 = link & 1 ? W / 2 + 0.5 : bw / 2;
      const y0 = link & 8 ? -H / 2 - 0.5 : -bh / 2, y1 = link & 2 ? H / 2 + 0.5 : bh / 2;
      const shapes = (dy: number) => {
        body.roundRect(-bw / 2, -bh / 2 + dy, bw, bh, br);
        const hx0 = link & 4 ? x0 : 0, hx1 = link & 1 ? x1 : 0, vy0 = link & 8 ? y0 : 0, vy1 = link & 2 ? y1 : 0;
        if (link & 5) body.rect(hx0, -bh / 2 + dy, hx1 - hx0, bh);
        if (link & 10) body.rect(-bw / 2, vy0 + dy, bw, vy1 - vy0);
        // Les coins entre deux voisines (droite et bas, etc.) : le reste des coins reste arrondi.
        if (link & 1 && link & 2) body.rect(0, dy, x1, y1);
        if (link & 1 && link & 8) body.rect(0, y0 + dy, x1, -y0);
        if (link & 4 && link & 2) body.rect(x0, dy, -x0, y1);
        if (link & 4 && link & 8) body.rect(x0, y0 + dy, -x0, -y0);
      };
      shapes(4); body.fill(PALETTE.shadow);
      shapes(0); body.fill(levelFill(m));
    } else if (m.built) {
      // Son ombre est dessinée à part, au sol, sous les tapis (drawMachineShadows).
      drawMachineBody(body, bw, bh, br, levelFill(m), false);
      sh = { w: bw, h: bh, r: br };
    } else {
      body.roundRect(-bw / 2, -bh / 2, bw, bh, br).fill({ color: PALETTE.white, alpha: 0.45 });
      dashedPolyline(body, roundRectPoints(-bw / 2, -bh / 2, bw, bh, br), 6, 5, true);
      body.stroke({ width: 2, color: PALETTE.ink, alpha: 0.45 });
      icon.alpha = 0.4;
    }
    const station = isStationType(m.type);
    const tex = def.kind === 'freight' || station ? null : buildingTexture(m.type, iconVariant(m));
    if (def.kind === 'freight') { /* dessiné à part */ } else if (station) {
      // Gare ou dépôt : le dessin et le quai tournent avec le bâtiment.
      const art = new Graphics();
      drawStationArt(art, m.type, m.built);
      art.rotation = ((m.rot ?? 0) * Math.PI) / 2;
      icon.addChild(art);
    } else if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      const size = Math.round(Math.min(bw, bh) * (bare ? 0.7 : 0.68));
      sp.width = sp.height = size;
      icon.addChild(sp);
    } else drawMachineIcon(iconG, m.type, m.ore);
    // Voyant du charbon, en haut à gauche : il clignote quand la machine en manque.
    const lamp = new Graphics();
    lamp.circle(-bw / 2 + 7, -bh / 2 + 7, 4.5).fill(0xffffff).circle(-bw / 2 + 7, -bh / 2 + 7, 3).fill(PALETTE.coral);
    lamp.visible = false;
    root.addChild(body, icon, badge, lamp);
    let label: Text | null = null;
    if (!bare) {
      const name = isDrill && m.ore ? item(m.ore).name.replace('Minerai de ', '').replace("Minerai d'", '').replace(/^./, (c) => c.toUpperCase()) : def.name;
      label = this.makeLabel(name);
      label.position.set(0, -bh / 2 - 4);
      root.addChild(label);
    }
    root.position.set((m.x + m.w / 2) * CELL, (m.y + m.h / 2) * CELL);
    root.zIndex = zOf(m);
    this.machineLayer.addChild(root);
    return { rot: m.rot ?? 0, root, body, icon, badge, lamp, label, built: m.built, ore: m.ore, made: m.made, pop: 0, sh, status: '', lvl: m.lvl ?? 1, ...(small ? { link: this.drillLink(m) } : {}) };
  }

  private buildNoyau(m: Machine): void {
    // Le Noyau est carré et remplit ses 4 × 4 cases : un tapis peut y entrer par n'importe quel côté, coins compris.
    const root = new Container();
    const ring = new Graphics();
    const body = new Graphics();
    const S = m.w * CELL;
    const badge = new Graphics();
    let reactor: NoyauReactor | undefined;
    const tex = buildingTexture('noyau');
    if (tex) {
      // Le Noyau, réacteur à anneaux : un cœur lumineux et deux anneaux en orbite, posé sur un socle.
      // Socle d'abord, puis l'anneau de progression (le trait autour), puis le réacteur ; le nom au-dessus.
      drawMachineBody(body, S - 2, S - 2, 22, PALETTE.white, false);
      this.noyauShadow = { w: S - 2, h: S - 2, r: 22 };
      reactor = makeNoyauReactor(S);
      const label = this.makeLabel('Noyau');
      label.position.set(0, -S / 2 - 2);
      root.addChild(body, ring, reactor.root, label, badge);
      this.noyauLabel = label;
    } else {
      body.roundRect(-S / 2 + 12, -S / 2 + 16, S - 24, S - 24, 16).fill(0xd8644d);
      body.roundRect(-S / 2 + 12, -S / 2 + 12, S - 24, S - 24, 16).fill(PALETTE.coral);
      root.addChild(ring, body, badge);
    }
    root.position.set((m.x + m.w / 2) * CELL, (m.y + m.h / 2) * CELL);
    root.zIndex = zOf(m);
    this.machineLayer.addChild(root);
    this.noyauView = { root, ring, badge, progress: -1, pulse: 0, reactor };
  }

  private updateMachines(dt: number): void {
    const seen = new Set<number>();
    for (const m of this.game.view.machines.values()) {
      seen.add(m.id);
      if (m.type === 'noyau') {
        if (!this.noyauView) this.buildNoyau(m);
        continue;
      }
      let v = this.machineViews.get(m.id);
      if (v && (v.built !== m.built || v.ore !== m.ore || v.lvl !== (m.lvl ?? 1) || v.rot !== (m.rot ?? 0) || (v.link !== undefined && v.link !== this.drillLink(m)))) {
        v.root.destroy({ children: true });
        this.machineViews.delete(m.id);
        v = undefined;
      }
      if (!v) {
        v = this.buildMachineView(m);
        this.machineViews.set(m.id, v);
        this.shadowsDirty = true;
        if (this.justBuilt.delete(m.id)) v.bp = 1;
      }
      if (v.bp) { v.bp = Math.max(0, v.bp - dt * 3); v.root.scale.set(1 + Math.sin(v.bp * Math.PI) * 0.14); }
      const def = machineDef(m.type);
      v.root.position.set((m.x + m.w / 2) * CELL, (m.y + m.h / 2) * CELL);
      if (v.root.zIndex !== zOf(m)) v.root.zIndex = zOf(m);
      // Hors de l'écran : on ne la dessine pas, et on saute ses petites animations.
      v.root.visible = this.inView(v.root.x, v.root.y, (Math.max(m.w, m.h) + 2) * CELL);
      if (!v.root.visible) { v.made = m.made; continue; }
      // Pendant qu'on la déplace, la machine pâlit sous son fantôme.
      v.root.alpha = m.id === this.movingId && this.preview?.kind === 'place' ? 0.4 : 1;
      if (m.made !== v.made) { v.made = m.made; v.pop = 1; }
      v.pop = Math.max(0, v.pop - dt * 4);
      const s = 1 + Math.sin(v.pop * Math.PI) * 0.16;
      v.icon.scale.set(s * (def.kind === 'lamp' || def.kind === 'tree' ? 1.35 : 1));
      if (m.type === 'four' && m.status === 'working') v.icon.y = Math.sin(this.time * 9) * 0.6;
      // Le nom s'affiche au-dessus de la machine, sauf si une autre machine y est collée (il la recouvrirait).
      // Un groupe de foreuses : le nom, le voyant et les pastilles une seule fois, sur la foreuse en haut à gauche.
      const lead = v.link === undefined || this.drillLeader(m) === m;
      if (v.link !== undefined && v.label) {
        const txt = lead ? this.drillGroupName(m) : '';
        if (txt !== v.labelText) { v.labelText = txt; v.label.text = txt; }
      }
      if (v.label) v.label.visible = lead && this.camera.zoom > 0.6 && !this.labelBlocked(m, v.label.width);
      const low = lead && this.game.view.lowFuel(m);
      v.lamp.visible = low && Math.sin(this.time * (m.fuel <= 0 && m.burn <= 0 ? 12 : 6)) > -0.2;
      // Branchée sur un réseau qui a du courant : un petit éclair dans le coin (elle se passe de charbon).
      const powered = m.built && this.game.view.powered(m);
      const st = lead ? `${m.status}${powered ? '+' : ''}` : 'member';
      if (st !== v.status) {
        v.status = st;
        v.badge.clear();
        if (st === 'member') {
          // Une foreuse du groupe qui n'est pas la première : rien dans son coin.
        } else if (m.built && m.status === 'blocked') {
          // Pastille « en pause » dans le coin, sans déborder sur une machine voisine.
          const r = m.w === 1 ? 5.5 : 7, x = m.w * CELL / 2 - 4 - r, y = -m.h * CELL / 2 + 4 + r;
          v.badge.circle(x, y, r).fill(0xffffff).stroke({ width: 2, color: PALETTE.coral });
          v.badge.rect(x - r * 0.38, y - r * 0.45, r * 0.25, r * 0.9).rect(x + r * 0.13, y - r * 0.45, r * 0.25, r * 0.9).fill(PALETTE.coral);
        } else if (m.built && m.status === 'nopower') {
          // Pas de courant : un éclair dans le même coin.
          const r = 7.5, x = m.w * CELL / 2 - 4 - r, y = -m.h * CELL / 2 + 4 + r;
          v.badge.circle(x, y, r).fill(0xffffff).stroke({ width: 2, color: PALETTE.ink });
          drawBolt(v.badge, x, y, 0.62);
        } else if (powered) {
          const x = m.w * CELL / 2 - 10, y = -m.h * CELL / 2 + 11;
          drawBolt(v.badge, x, y, m.w === 1 ? 0.55 : 0.7);
        }
      }
    }
    for (const [id, v] of this.machineViews) {
      if (!seen.has(id)) { v.root.destroy({ children: true }); this.machineViews.delete(id); this.shadowsDirty = true; }
    }
    this.drawMachineShadows();
    // Noyau : anneau de progression de la mission du palier.
    const nv = this.noyauView;
    if (nv) {
      const prog = this.game.palierProgress();
      if (Math.abs(prog - nv.progress) > 0.001) {
        nv.progress = prog;
        nv.ring.clear();
        const S = 4 * CELL, r = 22, x0 = -S / 2 + 4;
        const track = trackPoints(x0, x0, S - 8, S - 8, r);
        // L'ombre de l'anneau seulement en bas (en haut, elle tombait sur le socle et ne servait à rien).
        const low = track.filter((q) => q.y > 0);
        if (low.length > 1) {
          const start = low.findIndex((q, i) => i === 0 || Math.hypot(q.x - low[i - 1].x, q.y - low[i - 1].y) > 12);
          const run = [...low.slice(start), ...low.slice(0, start)];
          nv.ring.moveTo(run[0].x, run[0].y + 4);
          for (const q of run.slice(1)) nv.ring.lineTo(q.x, q.y + 4);
          nv.ring.stroke({ width: 8, color: PALETTE.shadow, cap: 'round', join: 'round' });
        }
        nv.ring.roundRect(x0, x0, S - 8, S - 8, r).stroke({ width: 8, color: PALETTE.white });
        if (prog > 0) {
          const part = partialPolyline(track, prog);
          nv.ring.moveTo(part[0].x, part[0].y);
          for (const q of part.slice(1)) nv.ring.lineTo(q.x, q.y);
          nv.ring.stroke({ width: 8, color: PALETTE.coral, cap: 'round', join: 'round' });
        }
      }
      nv.root.visible = this.inView(nv.root.x, nv.root.y, 4 * CELL);
      const nm = [...this.game.view.machines.values()].find((x) => x.type === 'noyau');
      if (this.noyauLabel && nm) this.noyauLabel.visible = this.camera.zoom > 0.6 && !this.labelBlocked(nm, this.noyauLabel.width);
      nv.pulse = Math.max(0, nv.pulse - dt * 3);
      nv.root.scale.set(1 + nv.pulse * 0.02);
      if (nv.reactor && nv.root.visible) animateNoyauReactor(nv.reactor, dt, this.time, nv.pulse);
    }
    // Grand coffre : ses quatre objets les plus nombreux, en petit, à la place du dessin du coffre.
    // Petit coffre : l'objet qu'il garde ; s'il en garde de plusieurs sortes, une icône « mélange ».
    for (const m of this.game.view.machines.values()) {
      if ((m.type !== 'grand_coffre' && m.type !== 'coffre' && m.type !== 'entrepot') || !m.built) continue;
      const v = this.machineViews.get(m.id);
      if (!v || !v.root.visible) continue;
      const kinds = Object.entries(m.inBuf).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([t]) => t);
      const small = m.type === 'coffre';
      const big = m.type === 'entrepot';
      const top = kinds.slice(0, small ? 1 : big ? 9 : 4);
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
      // Entrepôt : jusqu'à neuf sortes, rangées en grille.
      const spots = big ? [[-18, -18], [0, -18], [18, -18], [-18, 0], [0, 0], [18, 0], [-18, 18], [0, 18], [18, 18]]
        : top.length === 1 ? [[0, 0]] : top.length === 2 ? [[-9, 0], [9, 0]] : [[-9, -9], [9, -9], [-9, 9], [9, 9]];
      top.forEach((t, i) => {
        const s = new Sprite(this.itemTextures.get(t)!);
        s.anchor.set(0.5);
        s.scale.set(big ? 0.8 : top.length === 1 ? 1.1 : 0.8);
        s.position.set(spots[i][0], spots[i][1]);
        v.shelf!.addChild(s);
      });
    }
    // Comptoir : un « ! » quand il attend qu'on choisisse une commande.
    for (const m of this.game.view.machines.values()) {
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
    // Le faisceau de la lampe part du côté du robot, à mi-hauteur.
    const beam = new Graphics().poly([13, -18, 38, -38, 50, -24]).fill(PALETTE.beam);
    // Le skin (une image) et les objets qui tournent autour : derrière, puis devant.
    const art = new Container();
    art.scale.set(SKIN_SCALE);
    const back = new Container(), front = new Container();
    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(SKIN_ANCHOR.x, SKIN_ANCHOR.y);
    sprite.scale.set(SKIN_SPRITE_SCALE / SKIN_SCALE);
    art.addChild(back, sprite, front);
    body.addChild(art);
    // Plus de cône de lumière devant lui : la nuit, sa lampe éclaire tout autour (drawNight).
    beam.visible = false;
    flip.addChild(body);
    // Son ombre est au sol, sous les machines (pas par-dessus quand il passe à côté).
    this.groundShadows.addChild(shadow);
    root.addChild(flip);
    this.actorLayer.addChild(root);
    this.robotView = { root, shadow, body, beam, flip, sprite, back, front, items: [], dur: 7, wobble: true, look: '' };
    this.refreshLook();
  }

  /** Met le skin choisi au robot (l'image se prépare une fois, l'ancienne reste en attendant). */
  refreshLook(): void {
    const v = this.robotView;
    const look = this.game.look;
    const sid = skinOf(look.skin).id;
    const key = sid === 'origine' ? `${sid}/${look.color}` : sid;
    if (v.look === key) return;
    v.look = key;
    void skinTexture(key, skinBody(sid, look)).then((tex) => { if (v.look === key) v.sprite.texture = tex; }).catch(() => undefined);
    v.back.removeChildren().forEach((c) => c.destroy());
    v.front.removeChildren().forEach((c) => c.destroy());
    v.items = [];
    const o = SKIN_ART[sid]?.orbit;
    if (!o) return;
    v.dur = o.dur; v.wobble = o.wobble;
    for (const svg of o.items) {
      const mk = (parent: Container) => {
        const s = new Sprite(Texture.EMPTY);
        s.anchor.set(0.5);
        parent.addChild(s);
        return s;
      };
      const pair = { back: mk(v.back), front: mk(v.front) };
      v.items.push(pair);
      void orbitItemTexture(svg).then((tex) => { if (v.look === key) { pair.back.texture = tex; pair.front.texture = tex; } }).catch(() => undefined);
    }
  }

  private updateActors(): void {
    const r = this.game.robot, v = this.robotView;
    v.root.position.set(r.x * CELL, r.y * CELL);
    v.shadow.position.set(r.x * CELL, r.y * CELL);
    // Le robot se tourne là où il roule : il regarde à gauche ou à droite, et penche vers le haut ou le bas.
    if (r.moving) {
      let d = r.heading - this.robotFace;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.robotFace += d * Math.min(1, this.frameDt * 9);
    }
    const left = Math.cos(this.robotFace) < -0.05;
    v.flip.scale.x = left ? -1 : 1;
    let tilt = left ? this.robotFace - Math.PI : this.robotFace;
    while (tilt > Math.PI) tilt -= Math.PI * 2;
    while (tilt < -Math.PI) tilt += Math.PI * 2;
    v.flip.rotation = Math.max(-0.55, Math.min(0.55, tilt)) * (r.moving ? 0.6 : 0.3);
    v.body.y = r.moving ? Math.abs(Math.sin(this.time * 14)) * -1.5 : 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * (Math.PI * 2 / 1.8));
    void pulse;
    // Skins légendaires : les objets tournent doucement autour, derrière puis devant le robot.
    const n = v.items.length;
    v.items.forEach((it, k) => {
      const p = orbitPoint(this.time / v.dur + k / n);
      const rot = v.wobble ? -Math.cos((this.time * Math.PI * 2) / (2.2 + k * 0.4)) * 0.244 : 0;
      for (const s of [it.back, it.front]) {
        s.position.set(p.x, p.y);
        s.scale.set(p.s * ITEM_SPRITE_SCALE);
        s.rotation = rot;
      }
      it.front.visible = p.front;
      it.back.visible = !p.front;
    });
    const tp = this.tpAnim ? Math.min(1, Math.max(0, (this.tpAnim.t - 0.3) / 0.35)) : 1;
    v.root.scale.set(0.6 + 0.4 * tp, tp);
    v.root.alpha = tp;
  }

  /** Machine qu'on est en train de déplacer. */
  movingId: number | null = null;

  // ---------- Superpositions : tracé en cours, pose, gomme, sélection ----------

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const pv = this.preview;
    if (pv?.kind === 'ports') {
      const m = this.game.view.machines.get(pv.id);
      if (m) {
        for (const c of this.game.view.perimeter(m)) {
          const hot = !!pv.slot && pv.slot.x === c.x && pv.slot.y === c.y;
          const ex = (c.x + 0.5 - DX[c.d] * 0.5) * CELL, ey = (c.y + 0.5 - DY[c.d] * 0.5) * CELL;
          if (hot) this.drawPortBadge(g, c.x, c.y, c.d, pv.io === 'in', 1, PALETTE.coral);
          else {
            dashedPolyline(g, Array.from({ length: 13 }, (_, i) => ({ x: ex + Math.cos(i / 12 * Math.PI * 2) * 8, y: ey + Math.sin(i / 12 * Math.PI * 2) * 8 })), 3, 3);
            g.stroke({ width: 2, color: PALETTE.ink, alpha: 0.45 });
          }
        }
      }
    } else if (pv?.kind === 'cable') {
      const cells = pv.tracer.cells;
      if (cells.length) {
        // La portée du câble tracé, et les machines qu'il alimentera (cerclées de jaune).
        this.fillRange(g, cells, PALETTE.yellow, 0.16, true);
        for (const m of this.game.view.machinesInRange(cells)) {
          g.roundRect(m.x * CELL - 3, m.y * CELL - 3, m.w * CELL + 6, m.h * CELL + 6, 15).stroke({ width: 3.5, color: PALETTE.yellow });
        }
        g.moveTo((cells[0].x + 0.5) * CELL, (cells[0].y + 0.5) * CELL);
        for (const c of cells.slice(1)) g.lineTo((c.x + 0.5) * CELL, (c.y + 0.5) * CELL);
        if (cells.length === 1) g.circle((cells[0].x + 0.5) * CELL, (cells[0].y + 0.5) * CELL, 3);
        g.stroke({ width: 7, color: PALETTE.ink, alpha: 0.75, cap: 'round', join: 'round' });
        dashedPolyline(g, cells.map((c) => ({ x: (c.x + 0.5) * CELL, y: (c.y + 0.5) * CELL })), 5, 4);
        g.stroke({ width: 2.5, color: pv.tracer.blocked ? PALETTE.coral : PALETTE.yellow, cap: 'round' });
      }
    } else if (pv?.kind === 'pipe') {
      const cells = pv.tracer.cells;
      if (cells.length) {
        g.moveTo((cells[0].x + 0.5) * CELL, (cells[0].y + 0.5) * CELL);
        for (const c of cells.slice(1)) g.lineTo((c.x + 0.5) * CELL, (c.y + 0.5) * CELL);
        if (cells.length === 1) g.circle((cells[0].x + 0.5) * CELL, (cells[0].y + 0.5) * CELL, 3);
        g.stroke({ width: 9, color: 0x2b5f8a, alpha: 0.75, cap: 'round', join: 'round' });
        dashedPolyline(g, cells.map((c) => ({ x: (c.x + 0.5) * CELL, y: (c.y + 0.5) * CELL })), 5, 4);
        g.stroke({ width: 3, color: 0xbfe4fb, cap: 'round' });
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
      const station = isStationType(pv.type);
      const size = rotDims(def.w, def.h, station ? pv.rot ?? 0 : 0);
      const W = size.w * CELL, H = size.h * CELL;
      const x = pv.x * CELL, y = pv.y * CELL;
      if (station) {
        // Le quai : la voie (2 cases) le long du bâtiment, avec le sens de la marche.
        const geo = stationGeo(pv.x, pv.y, (pv.rot ?? 0) as Rot);
        const qx = Math.min(...geo.quay.map((c) => c.x)), qy = Math.min(...geo.quay.map((c) => c.y));
        const qw = Math.max(...geo.quay.map((c) => c.x)) + 1 - qx, qh = Math.max(...geo.quay.map((c) => c.y)) + 1 - qy;
        g.rect(qx * CELL, qy * CELL, qw * CELL, qh * CELL).fill({ color: pv.type === 'gare' ? 0xc9b79c : 0xa9b3bd, alpha: 0.7 });
        dashedPolyline(g, roundRectPoints(qx * CELL + 1, qy * CELL + 1, qw * CELL - 2, qh * CELL - 2, 2), 6, 5, true);
        g.stroke({ width: 2, color: pv.ok ? PALETTE.ink : PALETTE.coral, alpha: 0.5 });
        const ax = geo.dock.x * CELL, ay = geo.dock.y * CELL, dx = DX[geo.dir], dy = DY[geo.dir];
        for (const o of [-26, 0, 26]) {
          const cx = ax + dx * o, cy = ay + dy * o;
          g.moveTo(cx - dx * 6 - dy * 8, cy - dy * 6 + dx * 8).lineTo(cx + dx * 6, cy + dy * 6).lineTo(cx - dx * 6 + dy * 8, cy - dy * 6 - dx * 8)
            .stroke({ width: 3.5, color: 0xffffff, cap: 'round', join: 'round' });
        }
      }
      for (const gd of this.guides) {
        dashedPolyline(g, [{ x: gd.x0, y: gd.y0 }, { x: gd.x1, y: gd.y1 }], 5, 5);
      }
      g.stroke({ width: 2, color: PALETTE.coral, alpha: 0.8 });
      g.roundRect(x + 1, y + 1, W - 2, H - 2, 15).fill({ color: pv.ok ? PALETTE.white : 0xffd9d0, alpha: 0.85 });
      dashedPolyline(g, roundRectPoints(x + 1, y + 1, W - 2, H - 2, 15), 6, 5, true);
      g.stroke({ width: 2, color: pv.ok ? PALETTE.ink : PALETTE.coral, alpha: 0.6 });
    } else if (pv?.kind === 'eraseRect') {
      // Gomme en zone : le rectangle, et ce qui partira cerclé de corail.
      const x0 = Math.min(pv.x0, pv.x1) * CELL, y0 = Math.min(pv.y0, pv.y1) * CELL;
      const w = (Math.abs(pv.x1 - pv.x0) + 1) * CELL, hh = (Math.abs(pv.y1 - pv.y0) + 1) * CELL;
      const c = this.game.areaContents(pv.x0, pv.y0, pv.x1, pv.y1);
      // Module : en vert, ce qui sera rangé dans l'atelier ; gomme : en corail, ce qui partira.
      const col = pv.module ? PALETTE.green : PALETTE.coral;
      for (const m of c.machines) g.roundRect(m.x * CELL + 2, m.y * CELL + 2, m.w * CELL - 4, m.h * CELL - 4, 12).fill({ color: col, alpha: 0.3 });
      for (const b of c.belts) g.rect(b.x * CELL + 3, b.y * CELL + 3, CELL - 6, CELL - 6).fill({ color: col, alpha: 0.3 });
      g.roundRect(x0, y0, w, hh, 6).fill({ color: col, alpha: 0.1 });
      dashedPolyline(g, roundRectPoints(x0, y0, w, hh, 6), 7, 5, true);
      g.stroke({ width: 2.5, color: col, alpha: 0.9 });
    } else if (pv?.kind === 'erase') {
      g.circle((pv.x + 0.5) * CELL, (pv.y + 0.5) * CELL, CELL * 0.8).fill({ color: PALETTE.coral, alpha: 0.25 }).stroke({ width: 2, color: PALETTE.coral });
    }
    // Machine qu'on déplace : un cadre corail qui pulse, et une croix de déplacement au-dessus.
    if (this.movingId !== null) {
      const m = this.game.view.machines.get(this.movingId);
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
      }
    }
    const sel = this.selection;
    if (sel?.kind === 'robot') {
      const r = this.game.robot;
      dashedPolyline(g, Array.from({ length: 33 }, (_, i) => ({ x: r.x * CELL + Math.cos(i / 32 * Math.PI * 2) * 26, y: r.y * CELL - 16 + Math.sin(i / 32 * Math.PI * 2) * 26 })), 5, 4);
      g.stroke({ width: 2.5, color: PALETTE.coral });
    } else if (sel?.kind === 'machine') {
      const m = this.game.view.machines.get(sel.id);
      if (m) {
        const pad = 5;
        dashedPolyline(g, roundRectPoints(m.x * CELL - pad, m.y * CELL - pad, m.w * CELL + pad * 2, m.h * CELL + pad * 2, 18), 6, 4, true);
        g.stroke({ width: 2.5, color: PALETTE.coral });
      }
    } else if (sel?.kind === 'belt') {
      const b = this.game.view.beltAt(sel.x, sel.y);
      if (b) {
        for (const c of this.game.view.chainOf(b)) {
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
    const tex = buildingTexture(type, type === 'foreuse' || type === 'super_foreuse' ? 'fer' : type === 'arbre' ? 1 : 0);
    if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.width = sp.height = 31;
      c.addChild(g, sp);
    } else {
      const ig = new Graphics();
      drawMachineIcon(ig, type, type === 'foreuse' ? 'fer' : undefined);
      if (type === 'coffre') ig.scale.set(1.8);
      c.addChild(g, ig);
    }
    const canvas = this.app.renderer.extract.canvas({ target: c, resolution: 3 }) as HTMLCanvasElement;
    c.destroy({ children: true });
    return canvas.toDataURL();
  }

  itemIconDataUrl(id: string): string {
    const url = itemSvgUrl(id, 96);
    if (url) return url;
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
      const m = this.game.view.machines.get(h.id);
      if (!m || h.t > 7) { this.highlight = null; return; }
      const pulse = 0.5 + 0.5 * Math.sin(h.t * 5);
      const pad = 6 + pulse * 5, a = Math.min(1, (7 - h.t) / 1.5);
      g.roundRect(m.x * CELL - pad, m.y * CELL - pad, m.w * CELL + pad * 2, m.h * CELL + pad * 2, 16 + pad)
        .stroke({ width: 4, color: PALETTE.coral, alpha: a * (0.5 + 0.5 * pulse) });
    }
  }

  /**
   * On entre dans un atelier (ou on en sort) : tout ce qui est dessiné pour l'ancienne usine part,
   * et la pièce de l'atelier remplace le sol, le brouillard, le robot et les drones.
   */
  private switchView(): void {
    const inside = this.game.inAtelier;
    const wasOuter = this.shownFactory === this.game.factory;
    this.shownFactory = this.game.view;
    for (const v of this.machineViews.values()) v.root.destroy({ children: true });
    this.machineViews.clear();
    if (this.noyauView) { this.noyauView.root.destroy({ children: true }); this.noyauView = null; }
    this.beltsDirty = true;
    this.cableCount = -1;
    this.routeSig = '';
    this.selection = null;
    this.preview = null;
    for (const l of [this.groundLayer, this.filonLayer, this.fogLayer, this.actorLayer, this.groundShadows, this.routeG, this.lightG]) l.visible = !inside;
    this.roomG.visible = !!inside;
    this.roomSize = 0;
    if (inside) {
      if (wasOuter) this.outerCam = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
      // On cadre ce qu'il contient (ou toute la pièce si elle est vide).
      const size = inside.size ?? 20;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const m of this.game.view.machines.values()) { x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x + m.w); y1 = Math.max(y1, m.y + m.h); }
      if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = size; y1 = size; }
      const w = Math.max(x1 - x0 + 4, 10) * CELL;
      this.camera.x = (x0 + x1) / 2 * CELL; this.camera.y = (y0 + y1) / 2 * CELL;
      this.camera.zoom = Math.max(0.35, Math.min(1.3, (this.app.screen.width - 24) / w));
      this.follow = false;
    } else if (this.outerCam) {
      Object.assign(this.camera, this.outerCam);
      this.outerCam = null;
    }
  }

  /** La pièce d'un atelier : un sol clair bordé d'un mur, et le dehors en sombre. */
  private drawRoom(): void {
    const inside = this.game.inAtelier;
    if (!inside) return;
    const size = inside.size ?? 20;
    if (size === this.roomSize) return;
    this.roomSize = size;
    const S = size * CELL, g = this.roomG;
    g.clear();
    g.rect(-S * 4, -S * 4, S * 9, S * 9).fill(0x2e3a4b);
    g.roundRect(-14, -10, S + 28, S + 28, 22).fill(0x1f2835);
    g.roundRect(-14, -14, S + 28, S + 28, 22).fill(0x8fa3b8);
    g.roundRect(-4, -4, S + 8, S + 8, 14).fill(0xe9efe9);
    g.rect(0, 0, S, S).fill(0xf4f7f2);
  }

  /** Une tache de lumière douce (dégradé radial), pour les lampes de nuit. */
  private glowTexture(): Texture {
    if (this.glowTex) return this.glowTex;
    // Une seule vraie lumière : forte au centre, qui baisse doucement avec la distance jusqu'à rien (sans palier ni anneau).
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (let i = 0; i <= 24; i++) {
      const d = i / 24;
      const a = Math.pow(1 - d, 2.2) * (1 - d * d * 0.15);
      grad.addColorStop(d, `rgba(255,255,255,${Math.max(0, a).toFixed(4)})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    this.glowTex = new Texture({ source: new CanvasSource({ resource: asCanvas(c) }) });
    return this.glowTex;
  }

  /**
   * Jour et nuit : la nuit, un voile bleu nuit couvre la carte ; chaque bâtiment construit éclaire autour de lui,
   * et le robot porte sa lumière (un halo et le faisceau de sa lampe).
   */
  private drawNight(): void {
    const night = this.game.inAtelier ? 0 : 1 - this.game.daylight;
    this.lightSprite.visible = night > 0.01;
    if (!this.lightSprite.visible) return;
    const W = this.app.screen.width, H = this.app.screen.height;
    // La carte de lumière, à mi-résolution (la lumière est douce, ça ne se voit pas).
    if (!this.lightRT || this.lightRT.width !== W || this.lightRT.height !== H) {
      this.lightRT?.destroy(true);
      this.lightRT = RenderTexture.create({ width: W, height: H, resolution: 0.5 });
      this.lightSprite.texture = this.lightRT;
    }
    // La couleur de la nuit : du blanc (jour) à un bleu nuit profond.
    const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
    const amb = (mix(255, 50, night) << 16) | (mix(255, 58, night) << 8) | mix(255, 92, night);
    const cam = this.camera;
    this.nightLayer.scale.set(cam.zoom);
    this.nightLayer.position.set(cam.width / 2 - cam.x * cam.zoom, cam.height / 2 - cam.y * cam.zoom);
    const b = cam.bounds(CELL * 2);
    this.nightDark.clear().rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0).fill(amb);
    const tex = this.glowTexture();
    let used = 0;
    const glow = (x: number, y: number, r: number, tint: number, a: number) => {
      let sp = this.glowPool[used];
      if (!sp) { sp = new Sprite(tex); sp.anchor.set(0.5); this.glowPool.push(sp); this.glowLayer.addChild(sp); }
      used++;
      sp.visible = true;
      sp.position.set(x, y);
      sp.width = sp.height = r * 2;
      sp.tint = tint;
      sp.alpha = Math.min(1, a);
    };
    for (const m of this.game.view.machines.values()) {
      if (!m.built) continue;
      const cx = (m.x + m.w / 2) * CELL, cy = (m.y + m.h / 2) * CELL;
      const r = Math.max(m.w, m.h) * CELL * 1.1 + CELL * 1.6;
      if (!this.inView(cx, cy, m.type === 'lampadaire' ? CELL * 7 : r)) continue;
      // Une machine qui travaille éclaire un peu plus, et sa lumière vacille à peine.
      const busy = m.status === 'working' ? 1 : 0.8;
      const flick = 0.95 + 0.05 * Math.sin(this.time * 3 + m.id);
      if (m.type === 'lampadaire') { glow(cx, cy, CELL * 7, 0xffe7b8, 1); continue; }
      if (m.type === 'centrale' && m.status === 'working') { glow(cx, cy, CELL * 5, 0xc8ffd8, 0.9); continue; }
      glow(cx, cy, r, m.type === 'noyau' ? 0xffa58a : 0xffcf8f, 0.9 * busy * flick);
    }
    const rb = this.game.robot;
    const rx = rb.x * CELL, ry = (rb.y - 0.6) * CELL;
    // Le robot porte une seule grande lumière autour de lui.
    glow(rx, ry, CELL * 6, 0xfff2d6, 1);
    // Camions et trains : deux gros phares devant, et un faisceau qui éclaire la route.
    for (const vv of this.vehicleViews.values()) {
      if (!vv.root.visible) continue;
      const lead = vv.parts[0];
      const ca = Math.cos(lead.rotation), sa = Math.sin(lead.rotation);
      const big = vv.kind === 'train' ? 1.35 : 1;
      const nose = (vv.kind === 'train' ? 14 : 12);
      // Une seule lumière, un peu en avant (ses phares).
      glow(lead.x + ca * (nose + CELL), lead.y + sa * (nose + CELL), CELL * 3 * big, 0xfff6e0, 0.95);
    }
    for (let i = used; i < this.glowPool.length; i++) this.glowPool[i].visible = false;
    this.app.renderer.render({ container: this.nightLayer, target: this.lightRT, clear: true, clearColor: amb });
  }

  /** Direction du robot à l'écran (lissée), et la durée de la dernière image. */
  private robotFace = 0;
  private frameDt = 1 / 60;

  /** Dessine une fusée (pointe en haut), son pied en (x, y). */
  private drawRocket(g: Graphics, x: number, y: number, s: number, flame: number): void {
    const ink = PALETTE.ink;
    if (flame > 0) {
      const fl = (14 + Math.sin(this.time * 40) * 3) * flame * s;
      g.poly([x - 5 * s, y, x, y + fl, x + 5 * s, y]).fill(PALETTE.yellow);
      g.poly([x - 3 * s, y, x, y + fl * 0.6, x + 3 * s, y]).fill(0xffffff);
    }
    g.poly([x - 7 * s, y - 8 * s, x - 12 * s, y, x - 7 * s, y - 2 * s]).fill(PALETTE.coral).stroke({ width: 1.6, color: ink, join: 'round' });
    g.poly([x + 7 * s, y - 8 * s, x + 12 * s, y, x + 7 * s, y - 2 * s]).fill(PALETTE.coral).stroke({ width: 1.6, color: ink, join: 'round' });
    g.moveTo(x - 7 * s, y - 2 * s).lineTo(x - 7 * s, y - 24 * s).quadraticCurveTo(x, y - 40 * s, x + 7 * s, y - 24 * s).lineTo(x + 7 * s, y - 2 * s).closePath()
      .fill(0xffffff).stroke({ width: 2, color: ink, join: 'round' });
    g.circle(x, y - 20 * s, 3.2 * s).fill(0x7cc3f0).stroke({ width: 1.6, color: ink });
  }

  /** La fusée sur sa rampe (compte à rebours), puis son décollage avec de la fumée. */
  private drawRockets(dt: number): void {
    const g = this.rocketG;
    g.clear();
    for (const m of this.game.view.machines.values()) {
      if (m.type !== 'rampe' || !m.built || !m.craft) continue;
      const x = (m.x + m.w / 2) * CELL + Math.sin(this.time * 50) * m.craft.t * 0.3, y = (m.y + m.h / 2) * CELL + CELL * 0.8;
      this.drawRocket(g, x, y, 2.2, Math.min(1, m.craft.t / 4) * 0.6);
    }
    const a = this.rocketAnim;
    if (!a) return;
    a.t += dt;
    const rise = a.t * a.t * 42;
    // La fumée qui s'étale au sol.
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const r = Math.min(1, a.t / 1.2) * CELL * (1.6 + (i % 3) * 0.5);
      g.circle(a.x + Math.cos(ang) * r, a.y + CELL * 0.8 + Math.sin(ang) * r * 0.45, CELL * 0.6 * Math.max(0, 1 - a.t / 6)).fill({ color: 0xe6ebf0, alpha: Math.max(0, 0.8 - a.t / 7) });
    }
    this.drawRocket(g, a.x, a.y + CELL * 0.8 - rise, 2.2, 1.4);
    if (a.t > 6) this.rocketAnim = null;
  }

  /** Téléportation : une colonne de lumière là où il était, des anneaux qui se resserrent à l'arrivée. */
  private drawTeleport(dt: number): void {
    const g = this.fx;
    g.clear();
    const a = this.tpAnim;
    if (!a || this.game.inAtelier) return;
    a.t += dt;
    const k = Math.min(1, a.t / 0.7);
    const r = this.game.robot, x = r.x * CELL, y = r.y * CELL;
    // Départ : la lumière monte et s'efface.
    if (k < 1) {
      g.roundRect(a.fx - 12, a.fy - 46 - k * 30, 24, 50 + k * 30, 12).fill({ color: 0x7ce0f0, alpha: 0.5 * (1 - k) });
      g.ellipse(a.fx, a.fy, 22 * (1 + k), 7 * (1 + k)).stroke({ width: 3, color: 0x3bb3c9, alpha: 1 - k });
    }
    // Arrivée : trois anneaux qui se resserrent sur le robot, puis un éclat.
    for (let i = 0; i < 3; i++) {
      const p = Math.min(1, Math.max(0, (a.t - i * 0.1) / 0.5));
      if (p <= 0 || p >= 1) continue;
      g.ellipse(x, y, 40 * (1 - p) + 8, (40 * (1 - p) + 8) * 0.35).stroke({ width: 3, color: 0x3bb3c9, alpha: 0.9 * (1 - p * 0.5) });
    }
    const flash = Math.max(0, 1 - Math.abs(a.t - 0.55) / 0.25);
    if (flash > 0) g.circle(x, y - 16, 26).fill({ color: 0xbff4ff, alpha: 0.55 * flash });
    if (a.t > 1) this.tpAnim = null;
  }

  /** Le train de fret : il arrive par la droite, reste à quai, repart par la gauche ; au-dessus, le compte à rebours. */
  private drawTrain(dt: number): void {
    const g = this.trainG;
    g.clear();
    const fr = this.game.freight;
    const q = fr && !this.game.inAtelier ? [...this.game.view.machines.values()].find((m) => m.type === 'quai') : undefined;
    if (!fr || !q) { if (this.trainText) this.trainText.visible = false; return; }
    const here = fr.phase === 'here';
    if (here && this.trainP < 1) this.trainLeaving = false;
    if (!here && this.trainP > 0) this.trainLeaving = true;
    this.trainP = Math.max(0, Math.min(1, this.trainP + (here ? dt : -dt) / 2.5));
    const x0 = q.x * CELL, y0 = q.y * CELL, W = q.w * CELL;
    if (!this.trainText) {
      this.trainText = new Text({ text: '', style: { fontFamily: FONT, fontSize: 11, fontWeight: '900', fill: PALETTE.ink }, resolution: 3 });
      this.trainText.anchor.set(0.5, 1);
      this.trainG.addChild(this.trainText);
    }
    const t = this.trainText;
    // Plus de texte au-dessus du quai : le compte à rebours est dans la pastille du haut de l'écran.
    t.visible = false;
    const left = Object.values(this.game.freightMissing()).reduce((a, n) => a + n, 0);
    const clk = clock(fr.t);
    t.text = here ? `Train à quai · part dans ${clk}${left ? ` · il manque ${left}` : ' · plein'}` : `Train de fret · arrive dans ${clk}`;
    t.style.fill = here && left ? PALETTE.coral : PALETTE.ink;
    t.position.set(x0 + W / 2, y0 - 4);
    // Le train roule d'un bout à l'autre de la voie : il sort du sol à droite, s'arrête au quai, s'enfonce à gauche.
    const xL = x0, xR = x0 + W;
    const px = x0 + (q.w - 6) / 2 * CELL, cy = y0 + CELL * 1.5, car = (6 * CELL - 10) / 3, len = car * 3;
    if (this.trainP > 0) {
      const e = this.trainP * this.trainP * (3 - 2 * this.trainP);
      const startOff = xR - (px + 5) + 4, endOff = -((px + 5 + len) - xL) - 4;
      const off = (1 - e) * (this.trainLeaving ? endOff : startOff);
      const tot = Object.values(fr.req).reduce((s, n) => s + n, 0) || 1;
      const fill = Math.max(0, Math.min(1, 1 - left / tot));
      // Un rectangle coupé aux bouches des tunnels.
      const clip = (x: number, w: number): [number, number] | null => { const a0 = Math.max(x, xL), a1 = Math.min(x + w, xR); return a1 > a0 ? [a0, a1 - a0] : null; };
      for (let i = 0; i < 3; i++) {
        const cx = px + 5 + i * car + off;
        const loco = i === 0;
        const r1 = clip(cx + 1, car - 3);
        if (!r1) continue;
        g.roundRect(r1[0], cy - 6, r1[1], 18, 5).fill(PALETTE.shadow);
        g.roundRect(r1[0], cy - 9, r1[1], 18, 5).fill(loco ? PALETTE.coral : 0x5D6B7D);
        const whole = cx + 1 >= xL && cx + car - 2 <= xR;
        if (!whole) continue;
        if (loco) {
          g.roundRect(cx + 5, cy - 6, 12, 8, 2).fill(0xBFE3F2);
          g.circle(cx + 7, cy + 3, 2.6).fill(PALETTE.yellow);
        } else {
          // Le wagon se remplit avec ce qui est livré.
          g.roundRect(cx + 5, cy - 5, (car - 13) * fill, 10, 3).fill({ color: PALETTE.yellow, alpha: 0.9 });
          g.roundRect(cx + 5, cy - 5, car - 13, 10, 3).stroke({ width: 1.5, color: 0x3A4656 });
        }
        if (i < 2 && cx + car + 1 <= xR) g.rect(cx + car - 3, cy - 1.5, 4, 3).fill(PALETTE.ink);
      }
    }
    // Aux deux bouts, un voile couleur du sol passe par-dessus la voie et le train, de plus en plus opaque
    // (vu du dessus : ils passent sous terre). Opaque au bout, transparent 4 cases plus loin vers le quai.
    const ground = BIOME_COLORS[this.game.world.biomeAt(q.x + 1, q.y) as keyof typeof BIOME_COLORS] ?? PALETTE.ground;
    // Un vrai dégradé (pas des bandes : elles se chevauchaient et faisaient des traits sur un écran net).
    const span = CELL * 4.4;
    const [gl, gr] = this.fadeGradients(ground);
    g.rect(xL - CELL * 1.2, y0 + CELL - 4, span, CELL + 8).fill(gl);
    g.rect(xR + CELL * 1.2 - span, y0 + CELL - 4, span, CELL + 8).fill(gr);
  }

  private drawBuild(dt: number): void {
    const g = this.buildG;
    g.clear();
    if (this.game.inAtelier) { this.buildPuffs.length = 0; return; }
    const r = this.game.robot, b = r.build;
    if (b) {
      const p = this.game.jobPos(b.job);
      if (p) {
        const rx = r.x * CELL, ry = (r.y - 0.75) * CELL, px = p.x * CELL, py = p.y * CELL;
        const m = b.job.kind === 'machine' ? this.game.view.machines.get(b.job.id) : null;
        // Un rayon en tirets qui avance vers le chantier.
        const len = Math.hypot(px - rx, py - ry), ux = (px - rx) / (len || 1), uy = (py - ry) / (len || 1);
        const ph = (this.time * 60) % 10;
        for (let d = ph; d < len; d += 10) {
          const e = Math.min(len, d + 5);
          g.moveTo(rx + ux * d, ry + uy * d).lineTo(rx + ux * e, ry + uy * e);
        }
        g.stroke({ width: 2.5, color: PALETTE.yellow, alpha: 0.95, cap: 'round' });
        g.circle(rx, ry, 3.5).fill({ color: 0xffffff, alpha: 0.9 });
        // Des étincelles qui sautent au point de construction.
        for (let i = 0; i < 6; i++) {
          const a = this.time * 7 + i * 1.7, k = (this.time * 3 + i * 0.37) % 1;
          const d = 3 + k * 10;
          g.circle(px + Math.cos(a) * d, py + Math.sin(a) * d, 1.8 * (1 - k) + 0.6).fill({ color: i % 2 ? PALETTE.yellow : 0xffffff, alpha: 1 - k });
        }
        // L'anneau d'avancement.
        const rad = m ? Math.max(m.w, m.h) * CELL * 0.5 + 6 : 10;
        const f = Math.min(1, b.t / Math.max(0.01, b.need));
        g.circle(px, py, rad).stroke({ width: 3, color: PALETTE.ink, alpha: 0.15 });
        g.moveTo(px, py - rad).arc(px, py, rad, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2).stroke({ width: 3, color: PALETTE.yellow, cap: 'round' });
      }
    }
    // Une petite bouffée blanche quand c'est fini.
    for (const pf of this.buildPuffs) {
      pf.t += dt * (pf.big ? 2.2 : 3.5);
      const k = Math.min(1, pf.t);
      const rr = (pf.big ? 14 : 6) + k * (pf.big ? 26 : 12);
      g.circle(pf.x, pf.y, rr).stroke({ width: (pf.big ? 4 : 2.5) * (1 - k), color: 0xffffff, alpha: 1 - k });
    }
    this.buildPuffs = this.buildPuffs.filter((pf) => pf.t < 1);
  }

  private drawMachineShadows(): void {
    if (!this.shadowsDirty) return;
    this.shadowsDirty = false;
    const g = this.machineShadowG;
    if (!g.parent) this.groundShadows.addChildAt(g, 0);
    g.clear();
    for (const m of this.game.view.machines.values()) {
      const sh = m.type === 'noyau' ? this.noyauShadow : this.machineViews.get(m.id)?.sh;
      if (!sh || !m.built) continue;
      const cx = (m.x + m.w / 2) * CELL, cy = (m.y + m.h / 2) * CELL;
      g.roundRect(cx - sh.w / 2, cy - sh.h / 2 + 4, sh.w, sh.h, sh.r).fill(PALETTE.shadow);
    }
  }

  private fadeCache: { color: number; l: FillGradient; r: FillGradient } | null = null;

  /** Les deux voiles des bouts de voie : opaques au bout, transparents vers le quai. */
  private fadeGradients(color: number): [FillGradient, FillGradient] {
    if (this.fadeCache?.color !== color) {
      const r = (color >> 16) & 255, gg = (color >> 8) & 255, b = color & 255;
      const c = (a: number) => `rgba(${r}, ${gg}, ${b}, ${a})`;
      const stops = (rev: boolean) => {
        const st = [{ offset: 0, color: c(0) }, { offset: 0.17, color: c(1) }, { offset: 0.3, color: c(1) }, { offset: 0.55, color: c(0.6) }, { offset: 0.8, color: c(0.2) }, { offset: 1, color: c(0) }];
        return rev ? st.map((x) => ({ offset: 1 - x.offset, color: x.color })).reverse() : st;
      };
      this.fadeCache = {
        color,
        l: new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, colorStops: stops(false), textureSpace: 'local' }),
        r: new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, colorStops: stops(true), textureSpace: 'local' }),
      };
    }
    return [this.fadeCache.l, this.fadeCache.r];
  }

  /** Pluie (traits obliques) ou neige (flocons qui dérivent), dessinées à l'écran. */
  private drawWeather(): void {
    const g = this.weatherG;
    g.clear();
    const w = this.game.inAtelier ? 'clair' : this.game.weather;
    if (w === 'clair') return;
    const W = this.app.screen.width, H = this.app.screen.height, t = this.time;
    const n = w === 'pluie' ? 110 : 80;
    for (let i = 0; i < n; i++) {
      const sx = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const sy = ((Math.sin(i * 78.233) * 12345.678) % 1 + 1) % 1;
      if (w === 'pluie') {
        const y = ((sy * H + t * 620) % (H + 40)) - 20, x = ((sx * W - t * 140 + y * 0.22) % W + W) % W;
        g.moveTo(x, y).lineTo(x - 4, y + 14);
      } else {
        const y = ((sy * H + t * 45) % (H + 20)) - 10, x = ((sx * W + Math.sin(t * 1.3 + i) * 14) % W + W) % W;
        g.circle(x, y, 1.6 + (i % 3) * 0.6);
      }
    }
    if (w === 'pluie') g.stroke({ width: 1.5, color: 0x8fb8de, alpha: 0.7 });
    else g.fill({ color: 0xffffff, alpha: 0.85 });
  }

  render(dt: number): void {
    this.frameDt = dt;
    if (this.game.view !== this.shownFactory) this.switchView();
    this.drawRoom();
    this.time += dt;
    if (this.intro) this.stepIntro(dt);
    this.stepFocus(dt);
    if (this.follow && !this.game.inAtelier) this.centerOnRobot();
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
    const cablesChanged = this.beltsDirty || this.game.view.cables.size !== this.cableCount;
    if (this.beltsDirty) this.redrawBelts();
    // Les câbles : redessinés quand l'usine change, et deux fois par seconde (réseau alimenté ou non).
    this.cableT += dt;
    if (cablesChanged || ((this.cableCount > 0 || this.electricOn) && this.cableT > 0.5)) this.drawCables();
    this.view = cam.bounds(CELL * 3);
    this.updateModeView();
    this.updateRoutes();
    this.meterT += dt;
    if (this.meterT > 0.5) { this.meterT = 0; this.updateMeterLabels(); }
    this.meterLabels.visible = cam.zoom > 0.55;
    const span = CHUNK * CELL;
    for (const c of this.beltChunks.values()) {
      const vis = this.inView((c.x + 0.5) * span, (c.y + 0.5) * span, span / 2 + CELL);
      c.s.visible = vis; c.t.visible = vis;
    }
    this.updateMachines(dt);
    this.drawItems();
    this.updateActors();
    this.drawRockets(dt);
    this.drawTrain(dt);
    this.drawBuild(dt);
    this.drawTeleport(dt);
    this.drawNight();
    this.drawWeather();
    this.drawOverlay();
    this.renderLoupe();
  }
}

/**
 * Gare ou dépôt, sans tourner (bâtiment 4 × 2 centré, quai dessous, on roule vers la droite).
 * Dépôt : un entrepôt jaune à trois portes de quai, et une aire goudronnée. Gare : un hall corail avec son horloge,
 * un quai couvert, et la voie ferrée.
 */
function drawStationArt(g: Graphics, type: string, built: boolean): void {
  const ink = PALETTE.ink, C = CELL;
  const a = built ? 1 : 0.45;
  // Le quai (2 cases sous le bâtiment).
  if (type === 'gare') {
    g.rect(-2 * C, C, 4 * C, 2 * C).fill({ color: 0xc9b79c, alpha: a });
    for (let x = -2 * C + 4; x < 2 * C; x += 8) g.moveTo(x, 2 * C - 10).lineTo(x, 2 * C + 10);
    g.stroke({ width: 3.2, color: 0x9b7653, alpha: a, cap: 'round' });
    for (const r of [-5, 5]) g.moveTo(-2 * C, 2 * C + r).lineTo(2 * C, 2 * C + r);
    g.stroke({ width: 2, color: 0x56606b, alpha: a });
  } else {
    g.rect(-2 * C, C, 4 * C, 2 * C).fill({ color: 0xa9b3bd, alpha: a });
    g.rect(-2 * C, C, 4 * C, 2 * C).stroke({ width: 2, color: 0x8f9aa6, alpha: a });
    for (const x of [-C, 0, C]) g.moveTo(x, C + 2).lineTo(x, C + 15);
    g.stroke({ width: 2, color: 0xffffff, alpha: 0.85 * a });
    for (const x of [-C, 0, C]) {
      g.moveTo(x - 4, 2 * C - 7).lineTo(x + 4, 2 * C).lineTo(x - 4, 2 * C + 7).stroke({ width: 3, color: 0xffffff, alpha: 0.85 * a, cap: 'round', join: 'round' });
    }
  }
  if (!built) return;
  if (type === 'gare') {
    // Hall corail, bandeau clair, horloge ; quai couvert (auvent rayé) le long des rails.
    g.roundRect(-2 * C + 6, -C + 5, 4 * C - 12, 2 * C - 20, 6).fill(PALETTE.coral).stroke({ width: 2.5, color: ink });
    g.roundRect(-2 * C + 9, -C + 8, 4 * C - 18, 6, 3).fill(0xf9a896);
    g.circle(0, -4, 8).fill(0xffffff).stroke({ width: 2.2, color: ink });
    g.moveTo(0, -4).lineTo(0, -9).moveTo(0, -4).lineTo(4, -2).stroke({ width: 1.8, color: ink, cap: 'round' });
    for (const x of [-30, 30]) g.roundRect(x - 7, -C + 12, 14, 10, 2).fill(0xbfe3f2).stroke({ width: 1.6, color: ink });
    g.rect(-2 * C + 3, C - 14, 4 * C - 6, 11).fill(0xe8eef2).stroke({ width: 2, color: ink });
    for (let x = -2 * C + 9; x < 2 * C - 6; x += 12) g.rect(x, C - 13, 6, 9).fill(0xf9a896);
    g.moveTo(-2 * C + 3, C - 2).lineTo(2 * C - 3, C - 2).stroke({ width: 2.5, color: PALETTE.yellow });
  } else {
    // Entrepôt : toit jaune à nervures, trois portes de quai rayées du côté de la route.
    g.roundRect(-2 * C + 6, -C + 5, 4 * C - 12, 2 * C - 18, 6).fill(PALETTE.yellow).stroke({ width: 2.5, color: ink });
    for (let x = -2 * C + 18; x < 2 * C - 10; x += 12) g.moveTo(x, -C + 7).lineTo(x, C - 15);
    g.stroke({ width: 1.6, color: 0xe0a82e });
    for (const x of [-30, -6, 18]) {
      g.roundRect(x - 1, C - 15, 14, 13, 2).fill(0x59636f).stroke({ width: 1.8, color: ink });
      g.moveTo(x + 1, C - 11).lineTo(x + 11, C - 11).moveTo(x + 1, C - 7).lineTo(x + 11, C - 7).stroke({ width: 1.2, color: 0xa9b6c3 });
    }
  }
}

/** Taille des camions et des trains (les voies font 2 cases de large). */
const VEHICLE_SCALE = 1.6;

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

/** Le Noyau dessiné en réacteur à anneaux, animé : le cœur respire, deux anneaux tournent, une lune sur chacun. */
interface NoyauReactor {
  root: Container;
  glow: Graphics;
  core: Container;
  dot: Graphics;
  rings: { box: Container; backBox: Container; moon: Graphics; tilt: number; speed: number; a: number; rx: number; ry: number }[];
  /** Les lunes passent derrière le cœur (backMoons) ou par-dessus tout, anneaux compris (topMoons). */
  backMoons: Container;
  topMoons: Container;
  spin: number;
}

function makeNoyauReactor(S: number): NoyauReactor {
  const INK = PALETTE.ink;
  const root = new Container();
  const k = S / 96;
  const glow = new Graphics().circle(0, 0, 22 * k).fill({ color: PALETTE.yellowLight, alpha: 0.9 });
  const core = new Container();
  const ball = new Graphics().circle(0, 0, 13.5 * k).fill(PALETTE.coral).stroke({ width: 3 * k, color: INK });
  const dot = new Graphics().circle(0, 0, 5.5 * k).fill(PALETTE.yellow);
  const shine = new Graphics().circle(-5 * k, -5 * k, 2.4 * k).fill({ color: 0xffffff, alpha: 0.85 });
  core.addChild(ball, dot, shine);
  const rings: NoyauReactor['rings'] = [];
  const backs = new Container(), fronts = new Container();
  for (const [tilt, speed, a, color] of [[-0.44, 1.25, 0, PALETTE.yellow], [0.61, -0.95, 2.2, PALETTE.coral]] as [number, number, number, number][]) {
    const rx = 28 * k, ry = 9.5 * k;
    const box = new Container(), boxF = new Container();
    box.rotation = tilt; boxF.rotation = tilt;
    const back = new Graphics(), front = new Graphics();
    // La moitié arrière de l'anneau passe derrière le cœur, la moitié avant devant.
    back.ellipse(0, 0, rx, ry).stroke({ width: 3 * k, color: INK });
    front.moveTo(-rx, 0);
    for (let i = 0; i <= 24; i++) { const t = Math.PI * (i / 24); front.lineTo(-Math.cos(t) * rx, Math.sin(t) * ry); }
    front.stroke({ width: 3 * k, color: INK, cap: 'round' });
    const moon = new Graphics().circle(0, 0, 3.6 * k).fill(color).stroke({ width: 2 * k, color: INK });
    box.addChild(back); boxF.addChild(front);
    backs.addChild(box); fronts.addChild(boxF);
    rings.push({ box: boxF, backBox: box, moon, tilt, speed, a, rx, ry });
  }
  const backMoons = new Container(), topMoons = new Container();
  root.addChild(glow, backs, backMoons, core, fronts, topMoons);
  return { root, glow, core, dot, rings, backMoons, topMoons, spin: 0 };
}

function animateNoyauReactor(r: NoyauReactor, dt: number, time: number, pulse: number): void {
  // À chaque livraison, il s'emballe un instant (les anneaux accélèrent, le cœur brille).
  const boost = 1 + pulse * 3;
  r.spin += dt * boost;
  const breathe = 1 + Math.sin(time * 2.2) * 0.06 + pulse * 0.12;
  r.glow.scale.set(breathe * 1.05);
  r.glow.alpha = 0.75 + Math.sin(time * 2.2) * 0.12 + pulse * 0.25;
  r.core.scale.set(1 + Math.sin(time * 2.2 + 0.6) * 0.03 + pulse * 0.08);
  r.dot.scale.set(1 + Math.sin(time * 4.4) * 0.12);
  for (const g of r.rings) {
    const back = g.backBox;
    const tilt = g.tilt + Math.sin(time * 0.5 + g.a) * 0.12;
    g.box.rotation = tilt; back.rotation = tilt;
    const th = g.a + r.spin * g.speed;
    const x = Math.cos(th) * g.rx, y = Math.sin(th) * g.ry;
    // Position sur l'anneau incliné, mais dessinée hors de l'anneau : devant, elle passe par-dessus les deux anneaux.
    g.moon.position.set(x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt));
    const want = Math.sin(th) > 0 ? r.topMoons : r.backMoons;
    if (g.moon.parent !== want) want.addChild(g.moon);
  }
}

