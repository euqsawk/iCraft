/** Les couleurs des sorties d'une boîte (séparateur ou filtre), les mêmes sur la carte et dans sa fenêtre. */
export const NODE_COLORS = { main: 0x2e9e6a, right: 0xf47c64, left: 0x6b4fa0, back: 0x3f7fc9, vert: 0xe0a82e };

/** La couleur de la sortie `d` (0–3 : un côté, 4 : l'autre étage) d'une boîte qui va vers `dir`. */
export function nodeColor(dir: number, d: number): number {
  if (d === 4) return NODE_COLORS.vert;
  if (d === dir) return NODE_COLORS.main;
  if (d === (dir + 1) % 4) return NODE_COLORS.right;
  if (d === (dir + 3) % 4) return NODE_COLORS.left;
  return NODE_COLORS.back;
}

export const hexCss = (c: number): string => '#' + c.toString(16).padStart(6, '0');
