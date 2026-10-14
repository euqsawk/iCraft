// L'apparence du robot : sa couleur et son nom, choisis en début de partie, et le skin qu'il porte.

export interface RobotColor { id: string; label: string; main: number; light: number }
export const ROBOT_COLORS: RobotColor[] = [
  { id: 'jaune', label: 'Jaune', main: 0xffc857, light: 0xffe3a3 },
  { id: 'corail', label: 'Corail', main: 0xf47c64, light: 0xf9a896 },
  { id: 'menthe', label: 'Menthe', main: 0x6cc7a0, light: 0x9fdcc1 },
  { id: 'ciel', label: 'Ciel', main: 0x6fb4e8, light: 0xa3d0f2 },
  { id: 'lavande', label: 'Lavande', main: 0xa58bd6, light: 0xc7b7ea },
  { id: 'rose', label: 'Rose', main: 0xf29bc0, light: 0xf7c1d8 },
];

/** Couleur (celle du Boulon d'origine), skin porté (gagné avec un succès) et nom. */
export interface RobotLook { color: string; skin: string; name: string }
export const DEFAULT_LOOK: RobotLook = { color: 'jaune', skin: 'origine', name: 'Bolty' };
export const ROBOT_NAMES = ['Boulon', 'Pixel', 'Rivet', 'Clé', 'Volt', 'Bricole', 'Tournevis', 'Écrou'];

export function robotColor(look: RobotLook): RobotColor {
  return ROBOT_COLORS.find((c) => c.id === look.color) ?? ROBOT_COLORS[0];
}

export function cleanLook(l: Partial<RobotLook> | undefined): RobotLook {
  const name = (l?.name ?? '').trim().slice(0, 14) || DEFAULT_LOOK.name;
  return {
    color: ROBOT_COLORS.some((c) => c.id === l?.color) ? l!.color! : DEFAULT_LOOK.color,
    skin: typeof l?.skin === 'string' && /^[a-z]{2,16}$/.test(l.skin) ? l.skin : 'origine',
    name,
  };
}
