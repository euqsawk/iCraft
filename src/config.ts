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
  toundra: 0xeef3f7,
} as const;

export type BiomeId = keyof typeof BIOME_COLORS;

export const BIOME_NAMES: Record<BiomeId, string> = {
  plaine: 'Plaine',
  desert: 'Désert',
  terres: 'Terres rouges',
  marais: 'Marais',
  montagnes: 'Montagnes',
  crateres: 'Cratères',
  toundra: 'Toundra',
};

export const RULES = {
  startMoney: 300,
  beltCost: 1,
  /** Électricité : prix d'une case de câble ; un charbon fait tourner un générateur à pleine charge pendant 10 s. */
  cableCost: 2,
  /** Un câble alimente les machines à cette distance (en cases, carré autour de chaque case de câble). */
  cableRange: 5,
  /** Jour et nuit : durée d'un cycle complet (en secondes de jeu). */
  dayCycle: 480,
  /** Panneau solaire : puissance en plein jour (kW). */
  solarKw: 120,
  /** Batterie : ce qu'elle garde (kJ ; 36 000 kJ = 10 kWh) et ce qu'elle peut donner ou prendre à la fois (kW). */
  batteryKj: 36000,
  batteryKw: 200,
  /** Eau : une pompe donne 40 L/s ; un réacteur en boit 20, un mélangeur 5 (il travaille alors moitié plus vite). */
  pumpWater: 40,
  reactorWater: 20,
  mixerWater: 5,
  pipeCost: 3,
  /** Réacteur : un barreau d'uranium enrichi dure 2 minutes à pleine charge. */
  reactorRodSeconds: 120,
  /** Station de recharge : ce qu'elle tire du réseau. */
  chargerKw: 80,
  /** Hangar : nombre de drones. */
  hangarDrones: 3,
  /** Rampe de lancement : compte à rebours avant le décollage (s). */
  rocketCountdown: 5,
  /** Météo : durée d'un temps (s) ; la pluie ralentit les camions, la neige voile le soleil. */
  weatherSpan: 200,
  rainTruck: 0.7,
  snowSolar: 0.5,
  /** Pollution (par morceau de carte) : un charbon brûlé dans un générateur en ajoute 1, dans une machine 0,3. */
  pollGen: 1,
  pollMachine: 0.3,
  /** Au-delà, les machines ralentissent (jusqu'à 40 % plus lentes) et le soleil passe moins. */
  pollThreshold: 40,
  /** Ce que nettoient chaque seconde un arbre et un filtre à air (au courant) dans leur morceau de carte. */
  treeClean: 0.04,
  filterClean: 0.8,
  filterKw: 60,
  /** Le carburant dure 5 fois plus longtemps qu'un charbon (et brûle en premier). */
  carburantMult: 5,
  /** Véhicules : prix d'une case de route ou de rail, prix du véhicule, charge, vitesse (cases par seconde). */
  roadCost: 2,
  railCost: 5,
  truckCost: 150,
  trainCost: 400,
  truckLoad: 20,
  trainLoad: 80,
  truckSpeed: 4,
  trainSpeed: 7,
  /** Un véhicule attend au plus ce temps (s) au départ pour se remplir, et à l'arrivée pour se vider. */
  vehicleWait: 4,
  /** Véhicules au plus sur une même ligne. */
  maxVehicles: 6,
  /** Arrêts d'une ligne : 6 au plus. */
  maxStops: 6,
  /** Écart entre deux véhicules dans la file d'attente d'un dépôt (en cases). */
  truckGap: 1.8,
  trainGap: 4,
  /** Tapis souterrain : prix par case de trajet. */
  tunnelCost: 4,
  genCoalSeconds: 10,
  /** Pont : un tapis passe par-dessus d'autres tapis, sur 4 cases au plus ; prix en plus des cases. */
  bridgeSpan: 4,
  bridgeCost: 5,
  /** Vitesse des tapis, en cases par seconde. */
  beltSpeed: 1.5,
  /** Écart minimal entre deux objets sur un tapis, en cases. */
  beltGap: 0.5,
  robotSpeed: 4.5,
  droneSpeed: 7,
  /** Un drone au départ (avec 10 charbons en cadeau) ; les suivants viennent des commandes rares. */
  startDrones: 1,
  giftCoal: 10,
  /** Charbon : case carburant de 10 partout ; durée d'un charbon en secondes de travail. */
  fuelStack: 10,
  /** Une station garde plus de charbon : son drone s'y sert pour recharger les machines autour. */
  stationCoal: 50,
  /** Charbon que le drone d'une station laisse dans sa station (pour lui-même). */
  stationReserve: 2,
  coalMachineSeconds: 10,
  coalRobotSeconds: 30,
  coalDroneSeconds: 20,
  /** Une machine sous ce seuil fait clignoter son voyant. */
  lowFuel: 2,
  /** Inventaires : piles de 10 ; robot 5 cases, drone 1 case, coffre 10 cases. */
  invStack: 10,
  robotSlots: 5,
  chestSlots: 10,
  /** Grand coffre (2 × 2) : 30 cases, 300 objets. */
  bigChestSlots: 30,
  /** Entrepôt (3 × 3) : 90 cases de 10. */
  warehouseSlots: 90,
  /** Sans charbon, le robot avance au quart de sa vitesse ; les drones se posent sur lui. */
  robotNoFuelSpeed: 0.25,
  /** Minage du robot : objets par seconde sur un filon normal. */
  robotMineRate: 0.5,
  maxDrones: 3,
  /** Portée de construction des drones autour du robot, en cases. */
  buildRange: 8,
  /** Portée des drones pour le charbon et les livraisons (coffres, machines), autour du robot. */
  supplyRange: 16,
  beltBuildTime: 0.18,
  machineBuildTime: 1.1,
  /** Le robot construit lui-même, à courte portée, un peu plus lentement que les drones. */
  robotBuildRange: 2.5,
  robotBeltTime: 0.3,
  robotMachineTime: 1.6,
  /** Production hors ligne : 10 % de la vitesse, sur 8 h au plus. */
  offlineRate: 0.1,
  offlineMaxSeconds: 8 * 3600,
  /** Stock maximum par objet au Laboratoire. */
  labCap: 500,
  /** Revente : un passage du gros drone toutes les 5 min, 0,2 pièce par point de valeur, 400 objets au plus. */
  /** Station : rayon de travail de son drone, en cases. */
  stationRange: 12,
  sellEvery: 300,
  sellRate: 0.2,
  sellCap: 400,
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
