// Les dessins des bâtiments (choisis sur la page de design), en SVG 64 × 64.
// Ils sont rendus une fois en images au démarrage, puis posés sur le socle blanc de chaque bâtiment.
import { CanvasSource, Texture, type ICanvas } from 'pixi.js';
import { item, RAW_IDS } from '../data/items.ts';

/** Le contenu de chaque dessin (sans la balise svg). Un tableau : plusieurs variantes (les arbres). */
export const BUILDING_SVG: Record<string, string | string[]> = {
  four: "<path d=\"M12 54 V32 a20 20 0 0 1 40 0 V54 Z\" fill=\"#E3ECE7\"/><path d=\"M22 54 V40 a10 10 0 0 1 20 0 V54\" fill=\"#2E3A4B\"/><path d=\"M32 52 c-6 -3 -6 -9 0 -14 c6 5 6 11 0 14 z\" fill=\"#F47C64\" stroke=\"none\"/><path d=\"M8 54 H56\"/>",
  presse: "<path d=\"M12 9 H52\"/><path d=\"M17 9 V54 M47 9 V54\"/><rect x=\"24\" y=\"13\" width=\"16\" height=\"10\" rx=\"2\" fill=\"#8A99AD\"/><path d=\"M32 23 V29\"/><rect x=\"22\" y=\"29\" width=\"20\" height=\"6\" rx=\"2\" fill=\"#2E3A4B\"/><rect x=\"20\" y=\"44\" width=\"24\" height=\"5\" rx=\"1.5\" fill=\"#FFC857\"/><path d=\"M10 54 H54\"/>",
  tour: "<path d=\"M27 18 V50 L32 57 L37 50 V18\" fill=\"#E3ECE7\"/><path d=\"M27 24 L37 28 M27 31 L37 35 M27 38 L37 42 M27 45 L37 49\" stroke-width=\"2.5\"/><rect x=\"19\" y=\"8\" width=\"26\" height=\"10\" rx=\"3\" fill=\"#8A99AD\"/><path d=\"M32 10 V16\" stroke-width=\"2.5\"/>",
  trefileuse: "<rect x=\"20\" y=\"16\" width=\"24\" height=\"32\" fill=\"#E8913A\"/><path d=\"M20 23 H44 M20 30 H44 M20 37 H44 M20 44 H44\" stroke=\"#B4602A\" stroke-width=\"2\"/><rect x=\"13\" y=\"10\" width=\"38\" height=\"7\" rx=\"3\" fill=\"#2E3A4B\"/><rect x=\"13\" y=\"47\" width=\"38\" height=\"7\" rx=\"3\" fill=\"#2E3A4B\"/><path d=\"M44 42 C52 42 57 46 57 56\" stroke=\"#E8913A\"/>",
  haut_fourneau: "<path d=\"M22 55 L18 26 L26 11 H38 L46 26 L42 55 Z\" fill=\"#E3ECE7\"/><path d=\"M19 26 H45\"/><rect x=\"26\" y=\"35\" width=\"12\" height=\"12\" rx=\"3\" fill=\"#F47C64\"/><path d=\"M29 6 c2 -2 4 0 6 -2\" stroke=\"#8A99AD\" stroke-width=\"2.5\"/><path d=\"M12 55 H52\"/>",
  assembleur: "<path d=\"M8 18 H27 V24 a5 5 0 0 1 0 10 V46 H8 Z\" fill=\"#FFC857\"/><path d=\"M35 18 H56 V46 H35 V34 a5 5 0 0 0 0 -10 Z\" fill=\"#6CC7A0\"/>",
  broyeur: "<path d=\"M27 4 L36 4 L39 10 L33 13 L25 10 Z\" fill=\"#C9B79C\"/><circle cx=\"21\" cy=\"30\" r=\"13\" stroke-width=\"5\" stroke-dasharray=\"4 4.2\"/><circle cx=\"21\" cy=\"30\" r=\"10.5\" fill=\"#8A99AD\"/><circle cx=\"43\" cy=\"30\" r=\"13\" stroke-width=\"5\" stroke-dasharray=\"4 4.2\"/><circle cx=\"43\" cy=\"30\" r=\"10.5\" fill=\"#8A99AD\"/><circle cx=\"27\" cy=\"52\" r=\"2\" fill=\"#C9B79C\" stroke=\"none\"/><circle cx=\"33\" cy=\"56\" r=\"2\" fill=\"#C9B79C\" stroke=\"none\"/><circle cx=\"37\" cy=\"51\" r=\"2\" fill=\"#C9B79C\" stroke=\"none\"/>",
  melangeur: "<rect x=\"14\" y=\"14\" width=\"36\" height=\"40\" rx=\"8\" fill=\"#E3ECE7\"/><path d=\"M14 34 H50 V46 a8 8 0 0 1 -8 8 H22 a8 8 0 0 1 -8 -8 Z\" fill=\"#8FC6E8\"/><path d=\"M32 10 V42\"/><path d=\"M23 42 H41\" stroke-width=\"5\"/><rect x=\"25\" y=\"4\" width=\"14\" height=\"7\" rx=\"2\" fill=\"#2E3A4B\"/>",
  raffinerie: "<path d=\"M32 16 H43 V29\"/><rect x=\"18\" y=\"7\" width=\"14\" height=\"47\" rx=\"4\" fill=\"#E3ECE7\"/><path d=\"M18 19 H32 M18 30 H32 M18 41 H32\" stroke-width=\"2.5\"/><path d=\"M43 33 C39 39 37 43 37 46 a6 6 0 0 0 12 0 C49 43 47 39 43 33 Z\" fill=\"#2E3A4B\"/><path d=\"M10 54 H54\"/>",
  centrifugeuse: "<rect x=\"28\" y=\"6\" width=\"8\" height=\"19\" rx=\"4\" fill=\"#9BD16A\"/><rect x=\"28\" y=\"6\" width=\"8\" height=\"19\" rx=\"4\" fill=\"#9BD16A\" transform=\"rotate(120 32 32)\"/><rect x=\"28\" y=\"6\" width=\"8\" height=\"19\" rx=\"4\" fill=\"#9BD16A\" transform=\"rotate(240 32 32)\"/><circle cx=\"32\" cy=\"32\" r=\"7\" fill=\"#2E3A4B\"/>",
  foreuse: "<path d=\"M8 50 H56\"/><path d=\"M24 22 H40 L32 47 Z\" fill=\"#8A99AD\"/><path d=\"M26 28 L38 30 M28 34 L36 36 M30 40 L34 41\" stroke-width=\"2.5\"/><rect x=\"19\" y=\"7\" width=\"26\" height=\"15\" rx=\"4\" fill=\"#FFC857\"/><circle cx=\"18\" cy=\"56\" r=\"2.5\" fill=\"#8A99AD\" stroke=\"none\"/><circle cx=\"46\" cy=\"57\" r=\"2.5\" fill=\"#8A99AD\" stroke=\"none\"/>",
  pompe: "<path d=\"M32 8 C22 22 16 30 16 38 a16 16 0 0 0 32 0 C48 30 42 22 32 8 Z\" fill=\"#8FC6E8\"/><path d=\"M32 46 V30 M25 36 L32 29 L39 36\" stroke=\"#FFFFFF\" stroke-width=\"4\"/>",
  generateur: "<path d=\"M16 50 V56 M48 50 V56\"/><rect x=\"10\" y=\"15\" width=\"44\" height=\"35\" rx=\"6\" fill=\"#2E3A4B\"/><path d=\"M35 19 L24 35 H32 L29 46 L41 29 H33 Z\" fill=\"#FFC857\" stroke=\"none\"/>",
  solaire: "<rect x=\"8\" y=\"10\" width=\"48\" height=\"44\" rx=\"4\" fill=\"#3B6EA5\"/><path d=\"M8 24.7 H56 M8 39.3 H56 M24 10 V54 M40 10 V54\" stroke=\"#FFFFFF\" stroke-width=\"2\"/><path d=\"M13 30 L26 15\" stroke=\"#8FC6E8\" stroke-width=\"3\"/>",
  batterie: "<rect x=\"26\" y=\"5\" width=\"12\" height=\"7\" rx=\"2\" fill=\"#2E3A4B\"/><rect x=\"18\" y=\"12\" width=\"28\" height=\"45\" rx=\"5\" fill=\"#E3ECE7\"/><rect x=\"23\" y=\"44\" width=\"18\" height=\"8\" rx=\"2\" fill=\"#6CC7A0\" stroke=\"none\"/><rect x=\"23\" y=\"33\" width=\"18\" height=\"8\" rx=\"2\" fill=\"#6CC7A0\" stroke=\"none\"/><rect x=\"23\" y=\"22\" width=\"18\" height=\"8\" rx=\"2\" fill=\"#C8EBDA\" stroke=\"none\"/>",
  centrale: "<ellipse cx=\"32\" cy=\"32\" rx=\"25\" ry=\"9\"/><ellipse cx=\"32\" cy=\"32\" rx=\"25\" ry=\"9\" transform=\"rotate(60 32 32)\"/><ellipse cx=\"32\" cy=\"32\" rx=\"25\" ry=\"9\" transform=\"rotate(120 32 32)\"/><circle cx=\"32\" cy=\"32\" r=\"7\" fill=\"#FFC857\"/><path d=\"M34 27 L30 32.5 H34 L31 37\" stroke-width=\"2.2\"/>",
  recharge: "<path d=\"M14 17 H24 M40 17 H50\"/><ellipse cx=\"14\" cy=\"13\" rx=\"8\" ry=\"2.5\" fill=\"#E3ECE7\"/><ellipse cx=\"50\" cy=\"13\" rx=\"8\" ry=\"2.5\" fill=\"#E3ECE7\"/><path d=\"M14 13 V17 M50 13 V17\"/><rect x=\"23\" y=\"14\" width=\"18\" height=\"12\" rx=\"5\" fill=\"#FFC857\"/><path d=\"M8 52 H56\" stroke-width=\"5\"/><path d=\"M34 31 L27 42 H33 L30 49\" stroke=\"#F47C64\" stroke-width=\"3.5\"/>",
  filtre: "<rect x=\"8\" y=\"8\" width=\"48\" height=\"48\" rx=\"9\" fill=\"#E3ECE7\"/><path d=\"M32 32 C32 22 36 16 44 16 C44 24 40 30 32 32 Z\" fill=\"#6CC7A0\"/><path d=\"M32 32 C40 34 44 40 42 48 C34 46 30 40 32 32 Z\" fill=\"#6CC7A0\"/><path d=\"M32 32 C26 38 18 38 14 32 C20 26 26 26 32 32 Z\" fill=\"#6CC7A0\"/><circle cx=\"32\" cy=\"32\" r=\"3.5\" fill=\"#2E3A4B\"/>",
  coffre: "<rect x=\"11\" y=\"11\" width=\"42\" height=\"42\" rx=\"4\" fill=\"#E0B07A\"/><rect x=\"17\" y=\"17\" width=\"30\" height=\"30\" rx=\"1\" stroke-width=\"2.5\"/><path d=\"M17 17 L47 47 M47 17 L17 47\" stroke-width=\"3\"/>",
  depot: "<path d=\"M16 50 V56 M48 50 V56\" stroke-width=\"5\"/><rect x=\"10\" y=\"10\" width=\"44\" height=\"40\" rx=\"7\" fill=\"#FFC857\"/><rect x=\"16\" y=\"15\" width=\"32\" height=\"14\" rx=\"3\" fill=\"#BFE3F2\"/><circle cx=\"19\" cy=\"40\" r=\"4\" fill=\"#FFF3C4\"/><circle cx=\"45\" cy=\"40\" r=\"4\" fill=\"#FFF3C4\"/><path d=\"M27 40 H37\"/>",
  compteur: "<path d=\"M8 44 a24 24 0 0 1 48 0 Z\" fill=\"#E3ECE7\"/><path d=\"M14 38 l4 2 M20 26 l3 3 M32 22 V26 M44 26 l-3 3 M50 38 l-4 2\" stroke-width=\"2.5\"/><path d=\"M32 44 L44 30\" stroke=\"#F47C64\" stroke-width=\"4\"/><circle cx=\"32\" cy=\"44\" r=\"4\" fill=\"#2E3A4B\"/><path d=\"M8 52 H56\" stroke=\"#D5E5DC\" stroke-width=\"5\"/>",
  revente: "<path d=\"M8 28 H56 L50 54 H14 Z\" fill=\"#E3ECE7\"/><path d=\"M22 34 L24 48 M32 34 V48 M42 34 L40 48\" stroke-width=\"2.5\"/><path d=\"M20 28 L28 12 M44 28 L36 12\"/><circle cx=\"32\" cy=\"12\" r=\"7\" fill=\"#FFC857\"/><path d=\"M32 9 V15\" stroke-width=\"2.5\"/>",
  station: "<circle cx=\"32\" cy=\"32\" r=\"26\" fill=\"#E3F4EA\" stroke=\"#6CC7A0\" stroke-width=\"3\" stroke-dasharray=\"5 5\"/><path d=\"M18 30 H26 M38 30 H46\"/><ellipse cx=\"18\" cy=\"27\" rx=\"6\" ry=\"2\" fill=\"#E3ECE7\"/><ellipse cx=\"46\" cy=\"27\" rx=\"6\" ry=\"2\" fill=\"#E3ECE7\"/><rect x=\"25\" y=\"27\" width=\"14\" height=\"10\" rx=\"4\" fill=\"#FFC857\"/><rect x=\"26\" y=\"44\" width=\"12\" height=\"7\" rx=\"2\" fill=\"#2E3A4B\"/>",
  hangar: "<path d=\"M6 56 V36 a26 24 0 0 1 52 0 V56 Z\" fill=\"#E3ECE7\"/><path d=\"M14 56 V40 H50 V56\" fill=\"#2E3A4B\"/><rect x=\"17\" y=\"45\" width=\"8\" height=\"5\" rx=\"2\" fill=\"#FFC857\" stroke=\"none\"/><rect x=\"28\" y=\"45\" width=\"8\" height=\"5\" rx=\"2\" fill=\"#FFC857\" stroke=\"none\"/><rect x=\"39\" y=\"45\" width=\"8\" height=\"5\" rx=\"2\" fill=\"#FFC857\" stroke=\"none\"/>",
  laboratoire: "<path d=\"M14 56 H50 M22 56 V50 H42\"/><path d=\"M40 50 C50 46 52 34 44 26\"/><g transform=\"rotate(-30 30 24)\"><rect x=\"25\" y=\"8\" width=\"10\" height=\"26\" rx=\"3\" fill=\"#8A99AD\"/><rect x=\"27\" y=\"34\" width=\"6\" height=\"6\" fill=\"#2E3A4B\"/></g><path d=\"M22 44 H38\" stroke=\"#6CC7A0\" stroke-width=\"4\"/>",
  comptoir: "<rect x=\"10\" y=\"26\" width=\"44\" height=\"30\" rx=\"3\" fill=\"#E3ECE7\"/><path d=\"M8 12 H56 L58 24 a6.5 6.5 0 0 1 -12.5 2 a6.5 6.5 0 0 1 -13.5 0 a6.5 6.5 0 0 1 -13.5 0 A6.5 6.5 0 0 1 6 24 Z\" fill=\"#F47C64\"/><path d=\"M19 12 L18 26 M32 12 V26 M45 12 L46 26\" stroke-width=\"2.5\"/><rect x=\"24\" y=\"38\" width=\"16\" height=\"18\" fill=\"#2E3A4B\"/>",
  rampe: "<path d=\"M8 8 V56 M16 8 V56 M8 16 L16 24 M16 16 L8 24 M8 32 L16 40 M16 32 L8 40\" stroke-width=\"2.5\"/><path d=\"M16 22 H28 M16 40 H28\" stroke-width=\"2.5\"/><path d=\"M38 6 C45 13 47 24 45 46 H31 C29 24 31 13 38 6 Z\" fill=\"#FFFFFF\"/><path d=\"M31 38 L25 46 V50 H31 M45 38 L51 46 V50 H45\" fill=\"#F47C64\"/><circle cx=\"38\" cy=\"22\" r=\"4\" fill=\"#8FC6E8\"/><path d=\"M4 57 H60\" stroke-width=\"4\"/>",
  atelier: "<rect x=\"6\" y=\"6\" width=\"52\" height=\"52\" rx=\"9\" fill=\"#E3ECE7\"/><rect x=\"13\" y=\"13\" width=\"17\" height=\"17\" rx=\"4\" fill=\"#F47C64\"/><rect x=\"34\" y=\"13\" width=\"17\" height=\"17\" rx=\"4\" fill=\"#FFC857\"/><rect x=\"13\" y=\"34\" width=\"17\" height=\"17\" rx=\"4\" fill=\"#6CC7A0\"/><rect x=\"34\" y=\"34\" width=\"17\" height=\"17\" rx=\"4\" fill=\"#FFFFFF\"/><rect x=\"39\" y=\"39\" width=\"7\" height=\"7\" rx=\"1.5\" fill=\"#F47C64\" stroke-width=\"2\"/>",
  entree: "<path d=\"M30 8 H52 a4 4 0 0 1 4 4 V52 a4 4 0 0 1 -4 4 H30\" fill=\"#E3F4EA\"/><path d=\"M6 32 H38 M28 22 L38 32 L28 42\" stroke=\"#2E6B51\" stroke-width=\"4.5\"/>",
  sortie: "<path d=\"M34 8 H12 a4 4 0 0 0 -4 4 V52 a4 4 0 0 0 4 4 H34\" fill=\"#FDE3DC\"/><path d=\"M24 32 H58 M48 22 L58 32 L48 42\" stroke=\"#C4473A\" stroke-width=\"4.5\"/>",
  monte_charge: "<rect x=\"10\" y=\"6\" width=\"44\" height=\"52\" rx=\"6\" fill=\"#E3ECE7\"/><path d=\"M32 6 V58\" stroke-width=\"2.5\"/><path d=\"M21 34 V18 M15 24 L21 18 L27 24\" stroke=\"#2E6B51\" stroke-width=\"4\"/><path d=\"M43 30 V46 M37 40 L43 46 L49 40\" stroke=\"#C4473A\" stroke-width=\"4\"/>",
  arbre: [
    "<path d=\"M32 40 V56\" stroke=\"#8A5A2B\" stroke-width=\"6\"/><circle cx=\"32\" cy=\"27\" r=\"19\" fill=\"#5DAE6A\"/><circle cx=\"25\" cy=\"22\" r=\"4\" fill=\"#8BCB8F\" stroke=\"none\"/>",
    "<path d=\"M32 46 V58\" stroke=\"#8A5A2B\" stroke-width=\"6\"/><path d=\"M32 6 L46 24 H40 L50 37 H43 L52 48 H12 L21 37 H14 L24 24 H18 Z\" fill=\"#3F8F5A\"/>",
    "<path d=\"M32 38 V57\" stroke=\"#8A5A2B\" stroke-width=\"6\"/><circle cx=\"22\" cy=\"30\" r=\"12\" fill=\"#5DAE6A\"/><circle cx=\"42\" cy=\"30\" r=\"12\" fill=\"#5DAE6A\"/><circle cx=\"32\" cy=\"18\" r=\"13\" fill=\"#6CC7A0\"/>",
  ],
  fabricant: "<path d=\"M4 18 H18 V27.5 a4.5 4.5 0 0 1 0 9 V46 H4 Z\" fill=\"#FFC857\"/><path d=\"M25 18 H39 V27.5 a4.5 4.5 0 0 1 0 9 V46 H25 V36.5 a4.5 4.5 0 0 0 0 -9 Z\" fill=\"#6CC7A0\"/><path d=\"M46 18 H60 V46 H46 V36.5 a4.5 4.5 0 0 0 0 -9 Z\" fill=\"#F47C64\"/>",
  super_foreuse: "<path d=\"M4 50 H60\"/><path d=\"M10 24 H22 L16 44 Z\" fill=\"#8A99AD\"/><path d=\"M26 24 H38 L32 47 Z\" fill=\"#8A99AD\"/><path d=\"M42 24 H54 L48 44 Z\" fill=\"#8A99AD\"/><path d=\"M12 29 L20 30.5 M13.5 35 L18.5 36 M28 29 L36 30.5 M29.5 35 L34.5 36 M30.5 41 L33.5 41.5 M44 29 L52 30.5 M45.5 35 L50.5 36\" stroke-width=\"2.2\"/><rect x=\"6\" y=\"9\" width=\"52\" height=\"15\" rx=\"4\" fill=\"#FFC857\"/><circle cx=\"14\" cy=\"56\" r=\"2.5\" fill=\"#8A99AD\" stroke=\"none\"/><circle cx=\"33\" cy=\"57\" r=\"2.5\" fill=\"#8A99AD\" stroke=\"none\"/><circle cx=\"51\" cy=\"56\" r=\"2.5\" fill=\"#8A99AD\" stroke=\"none\"/>",
  grand_coffre: "<rect x=\"4\" y=\"18\" width=\"27\" height=\"27\" rx=\"3\" fill=\"#E0B07A\"/><rect x=\"8\" y=\"22\" width=\"19\" height=\"19\" rx=\"1\" stroke-width=\"2\"/><path d=\"M8 22 L27 41 M27 22 L8 41\" stroke-width=\"2.4\"/><rect x=\"33\" y=\"18\" width=\"27\" height=\"27\" rx=\"3\" fill=\"#E0B07A\"/><rect x=\"37\" y=\"22\" width=\"19\" height=\"19\" rx=\"1\" stroke-width=\"2\"/><path d=\"M37 22 L56 41 M56 22 L37 41\" stroke-width=\"2.4\"/>",
  entrepot: "<rect x=\"7\" y=\"33\" width=\"24\" height=\"24\" rx=\"3\" fill=\"#E0B07A\"/><rect x=\"11\" y=\"37\" width=\"16\" height=\"16\" rx=\"1\" stroke-width=\"2\"/><path d=\"M11 37 L27 53 M27 37 L11 53\" stroke-width=\"2.4\"/><rect x=\"33\" y=\"33\" width=\"24\" height=\"24\" rx=\"3\" fill=\"#E0B07A\"/><rect x=\"37\" y=\"37\" width=\"16\" height=\"16\" rx=\"1\" stroke-width=\"2\"/><path d=\"M37 37 L53 53 M53 37 L37 53\" stroke-width=\"2.4\"/><rect x=\"20\" y=\"8\" width=\"24\" height=\"24\" rx=\"3\" fill=\"#E0B07A\"/><rect x=\"24\" y=\"12\" width=\"16\" height=\"16\" rx=\"1\" stroke-width=\"2\"/><path d=\"M24 12 L40 28 M40 12 L24 28\" stroke-width=\"2.4\"/>",
  gare: "<rect x=\"6\" y=\"54\" width=\"52\" height=\"5\" rx=\"2\" fill=\"#C98A4B\"/><path d=\"M13 51 H23 M41 51 H51\" stroke=\"#8A99AD\" stroke-width=\"5\"/><path d=\"M18 46 V50 M46 46 V50\" stroke-width=\"5\"/><rect x=\"10\" y=\"7\" width=\"44\" height=\"40\" rx=\"7\" fill=\"#F47C64\"/><rect x=\"16\" y=\"12\" width=\"32\" height=\"14\" rx=\"3\" fill=\"#BFE3F2\"/><circle cx=\"19\" cy=\"37\" r=\"4\" fill=\"#FFF3C4\"/><circle cx=\"45\" cy=\"37\" r=\"4\" fill=\"#FFF3C4\"/><path d=\"M27 37 H37\"/>",
};

/** Gris du foret : remplacé par la couleur du minerai sur une foreuse posée. */
const DRILL_GREY = '#8A99AD';

const textures = new Map<string, Texture>();

function svgDoc(body: string, px: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64" fill="none" stroke="#2E3A4B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** L'image du dessin, en adresse de données (pour les fiches et la palette). */
export function buildingSvgUrl(type: string, variant = 0, px = 128): string | null {
  const v = BUILDING_SVG[type];
  if (!v) return null;
  const body = Array.isArray(v) ? v[variant % v.length] : v;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgDoc(body, px))}`;
}

async function raster(body: string, px: number): Promise<Texture> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgDoc(body, px))}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = px;
  c.getContext('2d')!.drawImage(img, 0, 0, px, px);
  return new Texture({ source: new CanvasSource({ resource: c as unknown as ICanvas, autoGenerateMipmaps: true, scaleMode: 'linear' }) });
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Rend tous les dessins une fois (à faire avant de dessiner la carte). */
export async function loadBuildingTextures(): Promise<void> {
  const jobs: Promise<void>[] = [];
  const add = (k: string, body: string, px: number) => jobs.push(raster(body, px).then((t) => { textures.set(k, t); }).catch(() => undefined));
  for (const [type, v] of Object.entries(BUILDING_SVG)) {
    (Array.isArray(v) ? v : [v]).forEach((body, i) => add(`${type}:${i}`, body, 256));
  }
  // Les foreuses prennent la couleur de leur minerai.
  for (const type of ['foreuse', 'super_foreuse']) {
    const body = BUILDING_SVG[type] as string;
    for (const ore of RAW_IDS) add(`${type}:${ore}`, body.split(DRILL_GREY).join(hex(item(ore).color)), 192);
  }
  await Promise.all(jobs);
}

/** La texture d'un bâtiment (variante ou minerai), si son dessin existe. */
export function buildingTexture(type: string, variant: number | string = 0): Texture | null {
  if (typeof variant === 'string') return textures.get(`${type}:${variant}`) ?? textures.get(`${type}:0`) ?? null;
  const v = BUILDING_SVG[type];
  const n = Array.isArray(v) ? v.length : 1;
  return textures.get(`${type}:${((variant % n) + n) % n}`) ?? null;
}
