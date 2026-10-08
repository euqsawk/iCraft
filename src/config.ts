// Constantes du jeu et palette Pastel (valeurs reprises de la maquette PastelV2).

/** Taille d'une case de la grille, en unités du monde (px à zoom 1). */
export const CELL = 24;
/** Taille d'un chunk, en cases. */
export const CHUNK = 32;

export const PALETTE = {
  ground: 0xdcebe3,
  dots: 0xc4d9ce,
  shadow: 0xbcd2c6,
  ink: 0x2e3a4b,
  ink2: 0x4a5868,
  white: 0xffffff,
  coral: 0xf47c64,
  yellow: 0xffc857,
  yellowLight: 0xffe3a3,
  lamp: 0xfff3c4,
  beam: 0xfff6c8,
  cable: 0x33415c,
  roller: 0xd5e5dc,
  fog: 0xf4f8f6,
  green: 0x2e6b51,
  greenLight: 0xe3ede8,
  danger: 0xc4473a,
  ghost: 0x2e3a4b,
} as const;

/** Couleurs de sol des biomes. */
export const BIOME_COLORS = {
  plaine: 0xdcebe3,
  desert: 0xeadfbe,
  terres: 0xefd5c6,
  marais: 0xd2d9b6,
  montagnes: 0xd5dde6,
  crateres: 0xe3ddef,
} as const;

export type BiomeId = keyof typeof BIOME_COLORS;

export const BIOME_NAMES: Record<BiomeId, string> = {
  plaine: 'Plaine',
  desert: 'Désert',
  terres: 'Terres rouges',
  marais: 'Marais',
  montagnes: 'Montagnes',
  crateres: 'Cratères',
};

export const RULES = {
  startMoney: 300,
  beltCost: 1,
  /** Vitesse des tapis, en cases par seconde. */
  beltSpeed: 1.5,
  /** Écart minimal entre deux objets sur un tapis, en cases. */
  beltGap: 0.5,
  robotSpeed: 4.5,
  droneSpeed: 7,
  /** Le robot commence sans drone : ils arrivent avec les commandes rares (module de drones). */
  startDrones: 0,
  maxDrones: 3,
  /** Portée de construction des drones autour du robot, en cases. */
  buildRange: 8,
  beltBuildTime: 0.18,
  machineBuildTime: 1.1,
  /** Le robot construit lui-même, à courte portée, un peu plus lentement que les drones. */
  robotBuildRange: 2.5,
  robotBeltTime: 0.3,
  robotMachineTime: 1.6,
  /** Niveau qui débloque les séparateurs de tapis. */
  splitterLevel: 2,
  /** Production hors ligne : 10 % de la vitesse, sur 8 h au plus. */
  offlineRate: 0.1,
  offlineMaxSeconds: 8 * 3600,
  /** Stock maximum par objet au Noyau pendant l'absence. */
  offlineStockCap: 500,
  revealRobot: 7,
  revealBuilding: 4,
  revealStart: 19,
  machineBuffer: 6,
  noyauSize: 4,
  rerollBase: 20,
  autosaveSeconds: 10,
};

/** XP nécessaire pour passer du niveau n au niveau n + 1 (niveau 4 → 500, comme la maquette). */
export function xpForLevel(level: number): number {
  return 125 * level;
}
