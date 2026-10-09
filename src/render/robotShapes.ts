// Le dessin du robot en formes simples, partagé entre le rendu PixiJS et les images de l'interface (SVG).
import { PALETTE } from '../config.ts';
import { robotColor, type RobotLook } from '../data/look.ts';

export type Shape =
  | { k: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: number }
  | { k: 'circle'; x: number; y: number; r: number; fill?: number; stroke?: number; sw?: number }
  | { k: 'ellipse'; x: number; y: number; rx: number; ry: number; fill?: number; stroke?: number; sw?: number }
  | { k: 'poly'; pts: number[]; fill?: number; stroke?: number; sw?: number }
  | { k: 'line'; pts: number[]; stroke: number; sw: number };

/** Centre de l'hélice (elle tourne : dessinée à part dans le jeu). */
export const PROPELLER = { x: 0, y: -40 };

/** Le corps du robot (sans phare ni faisceau), accessoire compris. Repère : roues au sol en y = 0, face vers +x. */
export function robotShapes(look: RobotLook): { body: Shape[]; spin: Shape[] } {
  const c = robotColor(look), ink = PALETTE.ink;
  const body: Shape[] = [
    { k: 'rect', x: -13, y: -32, w: 26, h: 26, r: 6, fill: c.main },
    { k: 'rect', x: -13, y: -32, w: 26, h: 8, r: 4, fill: c.light },
    { k: 'circle', x: -8, y: -3, r: 4, fill: ink },
    { k: 'circle', x: 8, y: -3, r: 4, fill: ink },
  ];
  const spin: Shape[] = [];
  const accent = look.color === 'corail' || look.color === 'rose' ? 0x6fb4e8 : PALETTE.coral;
  switch (look.accessory) {
    case 'antenne':
      body.push({ k: 'line', pts: [-6, -32, -8, -41], stroke: ink, sw: 2.5 });
      body.push({ k: 'circle', x: -8, y: -42.5, r: 3.2, fill: accent, stroke: ink, sw: 2 });
      break;
    case 'casquette': {
      const pts: number[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI + (i / 12) * Math.PI;
        pts.push(-1 + Math.cos(a) * 11, -32 + Math.sin(a) * 8);
      }
      body.push({ k: 'poly', pts, fill: accent, stroke: ink, sw: 2 });
      body.push({ k: 'line', pts: [8, -32.5, 17, -32.5], stroke: ink, sw: 3.5 });
      break;
    }
    case 'helice':
      body.push({ k: 'line', pts: [0, -32, 0, -38], stroke: ink, sw: 2.5 });
      spin.push({ k: 'ellipse', x: PROPELLER.x, y: PROPELLER.y, rx: 11, ry: 2.6, fill: accent, stroke: ink, sw: 1.8 });
      spin.push({ k: 'circle', x: PROPELLER.x, y: PROPELLER.y, r: 2, fill: ink });
      break;
    case 'noeud':
      body.push({ k: 'poly', pts: [-3, -33, -10, -38.5, -10, -27.5], fill: accent, stroke: ink, sw: 1.8 });
      body.push({ k: 'poly', pts: [-3, -33, 4, -38.5, 4, -27.5], fill: accent, stroke: ink, sw: 1.8 });
      body.push({ k: 'circle', x: -3, y: -33, r: 2.4, fill: ink });
      break;
    default:
      break;
  }
  return { body, spin };
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function svgShape(s: Shape): string {
  const paint = (fill?: number, stroke?: number, sw?: number) =>
    `fill="${fill === undefined ? 'none' : hex(fill)}"${stroke !== undefined ? ` stroke="${hex(stroke)}" stroke-width="${sw ?? 2}" stroke-linejoin="round" stroke-linecap="round"` : ''}`;
  switch (s.k) {
    case 'rect': return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" fill="${hex(s.fill)}"/>`;
    case 'circle': return `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" ${paint(s.fill, s.stroke, s.sw)}/>`;
    case 'ellipse': return `<ellipse cx="${s.x}" cy="${s.y}" rx="${s.rx}" ry="${s.ry}" ${paint(s.fill, s.stroke, s.sw)}/>`;
    case 'poly': return `<polygon points="${s.pts.join(' ')}" ${paint(s.fill, s.stroke, s.sw)}/>`;
    case 'line': return `<polyline points="${s.pts.join(' ')}" ${paint(undefined, s.stroke, s.sw)}/>`;
  }
}

/** Image SVG du robot (avec phare et faisceau), pour l'interface. */
export function robotSvg(look: RobotLook, opts: { beam?: boolean; spin?: boolean; cls?: string } = {}): string {
  const { body, spin } = robotShapes(look);
  const beam = opts.beam !== false ? `<polygon points="10,-20 34,-40 46,-26" fill="${hex(PALETTE.beam)}" class="rb-beam"/>` : '';
  const lamp = `<circle cx="10" cy="-20" r="9" fill="${hex(robotColor(look).main)}" opacity=".5" class="rb-glow"/><circle cx="10" cy="-20" r="5" fill="${hex(PALETTE.lamp)}" stroke="${hex(PALETTE.ink)}" stroke-width="2.5"/>`;
  const sp = spin.length ? `<g class="${opts.spin ? 'rb-spin' : ''}" style="transform-origin:${PROPELLER.x}px ${PROPELLER.y}px">${spin.map(svgShape).join('')}</g>` : '';
  return `<svg class="${opts.cls ?? 'robot-svg'}" viewBox="-22 -50 72 56" aria-hidden="true"><ellipse cx="0" cy="1" rx="17" ry="4" fill="${hex(PALETTE.shadow)}"/>${beam}<g class="rb-body">${body.map(svgShape).join('')}${lamp}${sp}</g></svg>`;
}

/** Image SVG d'un drone. */
export function droneSvg(look: RobotLook, cls = 'drone-svg'): string {
  const ink = hex(PALETTE.ink);
  return `<svg class="${cls}" viewBox="-14 -14 28 24" aria-hidden="true"><line x1="-10" y1="-9" x2="10" y2="-9" stroke="${ink}" stroke-width="2" stroke-linecap="round"/><line x1="0" y1="-7" x2="0" y2="-9" stroke="${ink}" stroke-width="2"/><circle cx="0" cy="0" r="7" fill="#fff" stroke="${ink}" stroke-width="2"/><circle cx="0" cy="0" r="2.5" fill="${hex(robotColor(look).main)}"/></svg>`;
}
