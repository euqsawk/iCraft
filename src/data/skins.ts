// Les skins du robot : chacun se gagne avec un succès (sauf le Boulon d'origine, offert).
// Les dessins sont dans skinArt.ts ; ici, leurs noms, leur rareté, et l'image SVG pour l'interface.
import { SKIN_ART } from './skinArt.ts';
import { robotColor, type RobotLook } from './look.ts';

export type Rarity = 'depart' | 'commun' | 'rare' | 'epique' | 'legendaire';
export const RARITY_NAME: Record<Rarity, string> = { depart: 'Départ', commun: 'Commun', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire' };

export interface Skin { id: string; name: string; rarity: Rarity }

export const SKINS: Skin[] = [
  { id: 'origine', name: 'Boulon d’origine', rarity: 'depart' },
  // Succès uniques
  { id: 'nuit', name: 'Veilleur de nuit', rarity: 'commun' },
  { id: 'tournesol', name: 'Le tournesol', rarity: 'commun' },
  { id: 'chat', name: 'Le chat', rarity: 'commun' },
  { id: 'electricien', name: 'L’électricien', rarity: 'rare' },
  { id: 'explorateur', name: 'L’explorateur', rarity: 'rare' },
  { id: 'chevalier', name: 'Le chevalier', rarity: 'rare' },
  { id: 'nord', name: 'Grand Nord', rarity: 'rare' },
  { id: 'fractale', name: 'Fractale', rarity: 'legendaire' },
  { id: 'neon', name: 'Néon', rarity: 'legendaire' },
  // Fortune
  { id: 'tirelire', name: 'La tirelire', rarity: 'commun' },
  { id: 'affaires', name: 'L’homme d’affaires', rarity: 'rare' },
  { id: 'magnat', name: 'Le magnat', rarity: 'epique' },
  { id: 'dore', name: 'Boulon d’or', rarity: 'legendaire' },
  // Production
  { id: 'mineur', name: 'Le mineur', rarity: 'commun' },
  { id: 'contremaitre', name: 'Le contremaître', rarity: 'rare' },
  { id: 'foreur', name: 'Le foreur', rarity: 'epique' },
  { id: 'cristal', name: 'Cœur de cristal', rarity: 'legendaire' },
  // Commandes
  { id: 'coursier', name: 'Le coursier', rarity: 'commun' },
  { id: 'routier', name: 'Le routier', rarity: 'rare' },
  { id: 'loco', name: 'La locomotive', rarity: 'epique' },
  { id: 'pirate', name: 'Le capitaine', rarity: 'legendaire' },
  // Espace
  { id: 'astronaute', name: 'L’astronaute', rarity: 'commun' },
  { id: 'pilote', name: 'Le pilote', rarity: 'rare' },
  { id: 'commandant', name: 'Le commandant', rarity: 'epique' },
  { id: 'alien', name: 'Le visiteur', rarity: 'legendaire' },
  // Bâtisseur
  { id: 'apprenti', name: 'L’apprenti', rarity: 'commun' },
  { id: 'architecte', name: 'L’architecte', rarity: 'rare' },
  { id: 'ingenieur', name: 'L’ingénieur', rarity: 'epique' },
  { id: 'batisseur', name: 'Le bâtisseur', rarity: 'legendaire' },
];

export const SKIN: Record<string, Skin> = Object.fromEntries(SKINS.map((s) => [s.id, s]));

export function skinOf(id: string | undefined): Skin {
  return (id && SKIN[id]) || SKINS[0];
}

/** Cadre des dessins : roues au sol en y = 0 ; le plus haut chapeau monte vers y = -232. */
export const SKIN_BOX = { x: -104, y: -244, w: 208, h: 262 };

/** Orbite des objets des skins légendaires (repère du dessin). */
export const ORBIT = { rx: 98, ry: 26, cy: -86, tilt: (-9 * Math.PI) / 180, size: 1.75 };

/** Position d'un objet sur l'orbite (phase en tours) : x, y, échelle, devant le robot ou derrière. */
export function orbitPoint(phase: number): { x: number; y: number; s: number; front: boolean } {
  const th = phase * Math.PI * 2;
  const x0 = ORBIT.rx * Math.cos(th), y0 = ORBIT.ry * Math.sin(th);
  const c = Math.cos(ORBIT.tilt), s = Math.sin(ORBIT.tilt);
  return { x: x0 * c - y0 * s, y: ORBIT.cy + x0 * s + y0 * c, s: 0.78 + 0.22 * Math.sin(th), front: Math.sin(th) > 0 };
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Le dessin d'un skin (sans orbite). Le Boulon d'origine prend la couleur choisie en début de partie. */
export function skinBody(id: string, look?: Pick<RobotLook, 'color'>): string {
  const art = SKIN_ART[skinOf(id).id];
  let svg = art.svg;
  if (skinOf(id).id === 'origine' && look) {
    const c = robotColor(look as RobotLook);
    svg = svg.replace('rx="24" fill="#FFC857"', `rx="24" fill="${hex(c.main)}"`).replace('V-122 H-61 Z" fill="#FFE3A3"', `V-122 H-61 Z" fill="${hex(c.light)}"`);
  }
  return svg;
}

/** Les objets qui tournent, animés en SVG (pour l'interface) : derrière le robot, puis devant. */
function orbitSvg(id: string): { back: string; front: string } {
  const o = SKIN_ART[id]?.orbit;
  if (!o) return { back: '', front: '' };
  const n = 36;
  const kt = Array.from({ length: n + 1 }, (_, i) => (i / n).toFixed(4)).join(';');
  let back = '', front = '';
  o.items.forEach((item, k) => {
    const off = k / o.items.length;
    const pts: string[] = [], sc: string[] = [], ob: string[] = [], of: string[] = [];
    for (let i = 0; i <= n; i++) {
      const p = orbitPoint(i / n + off);
      pts.push(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`); sc.push(p.s.toFixed(2));
      of.push(p.front ? '1' : '0'); ob.push(p.front ? '0' : '1');
    }
    const dur = `${o.dur}s`;
    const wob = o.wobble ? `<animateTransform attributeName="transform" type="rotate" values="-14;14;-14" dur="${(2.2 + k * 0.4).toFixed(1)}s" repeatCount="indefinite" additive="sum"/>` : '';
    const copy = (op: string[]) => `<g transform="translate(${pts[0]})" opacity="${op[0]}">`
      + `<animateTransform attributeName="transform" type="translate" values="${pts.join(';')}" keyTimes="${kt}" dur="${dur}" repeatCount="indefinite"/>`
      + `<animateTransform attributeName="transform" type="scale" values="${sc.join(';')}" keyTimes="${kt}" dur="${dur}" repeatCount="indefinite" additive="sum"/>`
      + `${wob}<animate attributeName="opacity" calcMode="discrete" values="${op.join(';')}" keyTimes="${kt}" dur="${dur}" repeatCount="indefinite"/>`
      + `<g transform="scale(${ORBIT.size})">${item}</g></g>`;
    back += copy(ob); front += copy(of);
  });
  return { back, front };
}

/** Image SVG complète d'un skin (ombre, dessin, objets qui tournent si `anim`). */
export function skinSvg(id: string, opts: { look?: Pick<RobotLook, 'color'>; anim?: boolean; cls?: string; gray?: boolean } = {}): string {
  const sid = skinOf(id).id;
  const o = opts.anim === false ? { back: '', front: '' } : orbitSvg(sid);
  const B = SKIN_BOX;
  const gray = opts.gray ? ' style="filter: grayscale(1) opacity(.42)"' : '';
  return `<svg class="${opts.cls ?? 'skin-svg'}" viewBox="${B.x} ${B.y} ${B.w} ${B.h}" aria-hidden="true"${gray}>`
    + `<ellipse cx="0" cy="4" rx="84" ry="10" fill="#2E3A4B" opacity=".12"/>${o.back}<g class="sk-body">${skinBody(sid, opts.look)}</g>${o.front}</svg>`;
}
