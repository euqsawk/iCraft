// L'image du robot pour l'interface (écran titre, parties sauvegardées, présentation) : le skin qu'il porte.
import { PALETTE } from '../config.ts';
import type { RobotLook } from '../data/look.ts';
import { SKIN_BOX, skinSvg } from '../data/skins.ts';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Image SVG du robot (le faisceau de sa lampe seulement si `beam: true`), pour l'interface. */
export function robotSvg(look: RobotLook, opts: { beam?: boolean; spin?: boolean; cls?: string } = {}): string {
  const svg = skinSvg(look.skin, { look, cls: opts.cls ?? 'robot-svg' });
  if (opts.beam !== true) return svg; // plus de cône jaune par défaut
  // Le faisceau part du côté droit du robot, à mi-hauteur.
  const beam = `<polygon points="66,-96 170,-150 196,-84" fill="${hex(PALETTE.beam)}" class="rb-beam"/>`;
  const B = SKIN_BOX;
  return svg.replace(`viewBox="${B.x} ${B.y} ${B.w} ${B.h}"`, `viewBox="${B.x} ${B.y} ${B.w + 96} ${B.h}"`).replace('<g class="sk-body">', `${beam}<g class="sk-body">`);
}
