// Les skins du robot en images pour PixiJS : le dessin SVG est rendu une fois (à la demande), puis posé en sprite.
import { CanvasSource, Texture, type ICanvas } from 'pixi.js';
import { ORBIT, SKIN_BOX } from '../data/skins.ts';

/** Taille du robot sur la carte : pixels du monde par unité du dessin. */
export const SKIN_SCALE = 0.2;
/** Résolution des images : pixels par unité du dessin (assez pour le zoom maximal sur un écran net). */
const RES = 1.3;
/** Les objets qui tournent sont dessinés dans ce carré (unités du dessin, avant leur agrandissement). */
const ITEM_BOX = 17;

const cache = new Map<string, Promise<Texture>>();

async function raster(svg: string, w: number, h: number): Promise<Texture> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.ceil(w); c.height = Math.ceil(h);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Texture({ source: new CanvasSource({ resource: c as unknown as ICanvas, autoGenerateMipmaps: true, scaleMode: 'linear' }) });
}

/** L'image d'un skin (sa clé change avec la couleur du Boulon d'origine). */
export function skinTexture(key: string, body: string): Promise<Texture> {
  let p = cache.get(`s:${key}`);
  if (!p) {
    const B = SKIN_BOX;
    const w = B.w * RES, h = B.h * RES;
    p = raster(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${B.x} ${B.y} ${B.w} ${B.h}">${body}</svg>`, w, h);
    cache.set(`s:${key}`, p);
  }
  return p;
}

/** Point d'ancrage d'un skin : les roues au sol, au milieu. */
export const SKIN_ANCHOR = { x: -SKIN_BOX.x / SKIN_BOX.w, y: -SKIN_BOX.y / SKIN_BOX.h };
/** Échelle d'un sprite de skin pour qu'il ait la taille du robot. */
export const SKIN_SPRITE_SCALE = SKIN_SCALE / RES;

/** L'image d'un objet qui tourne autour d'un skin légendaire (centré). */
export function orbitItemTexture(svg: string): Promise<Texture> {
  let p = cache.get(`o:${svg}`);
  if (!p) {
    const side = ITEM_BOX * 2 * ORBIT.size * RES;
    p = raster(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="${-ITEM_BOX} ${-ITEM_BOX} ${ITEM_BOX * 2} ${ITEM_BOX * 2}">${svg}</svg>`, side, side);
    cache.set(`o:${svg}`, p);
  }
  return p;
}
/** Échelle d'un sprite d'objet (dans le repère du dessin du robot). */
export const ITEM_SPRITE_SCALE = 1 / RES;
