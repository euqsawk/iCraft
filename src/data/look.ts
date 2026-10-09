// L'apparence du robot, choisie en début de partie.

export interface RobotColor { id: string; label: string; main: number; light: number }
export const ROBOT_COLORS: RobotColor[] = [
  { id: 'jaune', label: 'Jaune', main: 0xffc857, light: 0xffe3a3 },
  { id: 'corail', label: 'Corail', main: 0xf47c64, light: 0xf9a896 },
  { id: 'menthe', label: 'Menthe', main: 0x6cc7a0, light: 0x9fdcc1 },
  { id: 'ciel', label: 'Ciel', main: 0x6fb4e8, light: 0xa3d0f2 },
  { id: 'lavande', label: 'Lavande', main: 0xa58bd6, light: 0xc7b7ea },
  { id: 'rose', label: 'Rose', main: 0xf29bc0, light: 0xf7c1d8 },
];

export type Accessory = 'aucun' | 'antenne' | 'casquette' | 'helice' | 'noeud';
export const ACCESSORIES: { id: Accessory; label: string }[] = [
  { id: 'aucun', label: 'Rien' },
  { id: 'antenne', label: 'Antenne' },
  { id: 'casquette', label: 'Casquette' },
  { id: 'helice', label: 'Hélice' },
  { id: 'noeud', label: 'Nœud' },
];

export interface RobotLook { color: string; accessory: Accessory; name: string }
export const DEFAULT_LOOK: RobotLook = { color: 'jaune', accessory: 'aucun', name: 'Boulon' };
export const ROBOT_NAMES = ['Boulon', 'Pixel', 'Rivet', 'Clé', 'Volt', 'Bricole', 'Tournevis', 'Écrou'];

export function robotColor(look: RobotLook): RobotColor {
  return ROBOT_COLORS.find((c) => c.id === look.color) ?? ROBOT_COLORS[0];
}

export function cleanLook(l: Partial<RobotLook> | undefined): RobotLook {
  const name = (l?.name ?? '').trim().slice(0, 14) || DEFAULT_LOOK.name;
  return {
    color: ROBOT_COLORS.some((c) => c.id === l?.color) ? l!.color! : DEFAULT_LOOK.color,
    accessory: ACCESSORIES.some((a) => a.id === l?.accessory) ? l!.accessory! : 'aucun',
    name,
  };
}
