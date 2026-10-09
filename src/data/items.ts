// Les objets du jeu : 10 matières premières, 35 objets fabriqués et la fusée.
// Source : planche « Toutes les recettes » des maquettes, plus le carburant (document de game design).

export type ItemShape = 'ore' | 'sand' | 'drop' | 'crystal' | 'ingot' | 'plate' | 'coil' | 'screw' | 'block' | 'gear' | 'tube' | 'chip';

export type Rarity = 'commune' | 'peu commune' | 'rare';

export interface ItemDef {
  id: string;
  name: string;
  /** Nom au pluriel, pour les commandes (« 20 plaques de fer »). */
  plural: string;
  color: number;
  shape: ItemShape;
  /** Palier : 0 matière première … 6 objet fini, 7 fusée. */
  tier: number;
  /** Prix de base (marché, récompenses). */
  value: number;
  rarity?: Rarity;
  /** Couleur claire du filon au sol (matières premières seulement). */
  patch?: number;
}

const RAW: ItemDef[] = [
  { id: 'fer', name: 'Minerai de fer', plural: 'minerais de fer', color: 0x8a99ad, patch: 0xc6d0dc, shape: 'ore', tier: 0, value: 1, rarity: 'commune' },
  { id: 'cuivre', name: 'Minerai de cuivre', plural: 'minerais de cuivre', color: 0xd9824a, patch: 0xf2c6a5, shape: 'ore', tier: 0, value: 1, rarity: 'commune' },
  { id: 'charbon', name: 'Charbon', plural: 'charbons', color: 0x3c4350, patch: 0xaeb4be, shape: 'ore', tier: 0, value: 1, rarity: 'commune' },
  { id: 'calcaire', name: 'Calcaire', plural: 'calcaires', color: 0xbdb49e, patch: 0xe4ddcb, shape: 'ore', tier: 0, value: 1, rarity: 'commune' },
  { id: 'sable', name: 'Sable', plural: 'sables', color: 0xd9b865, patch: 0xf0dfae, shape: 'sand', tier: 0, value: 1, rarity: 'commune' },
  { id: 'quartz', name: 'Quartz', plural: 'quartz', color: 0xa9bcd0, patch: 0xdbe4ee, shape: 'crystal', tier: 0, value: 3, rarity: 'peu commune' },
  { id: 'bauxite', name: 'Bauxite', plural: 'bauxites', color: 0x9e4b3a, patch: 0xdcb1a6, shape: 'ore', tier: 0, value: 3, rarity: 'peu commune' },
  { id: 'petrole', name: 'Pétrole', plural: 'barils de pétrole', color: 0x2b2f38, patch: 0xa9adb6, shape: 'drop', tier: 0, value: 3, rarity: 'peu commune' },
  { id: 'or', name: "Minerai d'or", plural: "minerais d'or", color: 0xd4a72c, patch: 0xf1dc9c, shape: 'ore', tier: 0, value: 8, rarity: 'rare' },
  { id: 'uranium', name: 'Uranium', plural: "minerais d'uranium", color: 0x7fa33b, patch: 0xcbdcae, shape: 'ore', tier: 0, value: 10, rarity: 'rare' },
  { id: 'eau', name: 'Eau', plural: 'eau', color: 0x3d8fd1, patch: 0xa9d6f2, shape: 'drop', tier: 0, value: 0 },
];

const MADE: ItemDef[] = [
  // 1 · Matériaux
  { id: 'lingot_fer', name: 'Lingot de fer', plural: 'lingots de fer', color: 0x8a99ad, shape: 'ingot', tier: 1, value: 3 },
  { id: 'lingot_cuivre', name: 'Lingot de cuivre', plural: 'lingots de cuivre', color: 0xd9824a, shape: 'ingot', tier: 1, value: 3 },
  { id: 'lingot_or', name: "Lingot d'or", plural: "lingots d'or", color: 0xd4a72c, shape: 'ingot', tier: 1, value: 20 },
  { id: 'verre', name: 'Verre', plural: 'verres', color: 0x9fd3d6, shape: 'plate', tier: 1, value: 3 },
  { id: 'ciment', name: 'Ciment', plural: 'sacs de ciment', color: 0xa7a296, shape: 'block', tier: 1, value: 3 },
  { id: 'cristal', name: 'Cristal', plural: 'cristaux', color: 0x93aee0, shape: 'crystal', tier: 1, value: 8 },
  { id: 'aluminium', name: 'Aluminium', plural: "lingots d'aluminium", color: 0xb8c4cc, shape: 'ingot', tier: 1, value: 8 },
  { id: 'plastique', name: 'Plastique', plural: 'plastiques', color: 0x7cc6a4, shape: 'block', tier: 1, value: 8 },
  { id: 'carburant', name: 'Carburant', plural: 'bidons de carburant', color: 0xe0a33a, shape: 'drop', tier: 1, value: 8 },
  { id: 'uranium_enrichi', name: 'Uranium enrichi', plural: "barres d'uranium enrichi", color: 0x9ad04a, shape: 'tube', tier: 1, value: 30 },
  // 2 · Pièces simples
  { id: 'plaque_fer', name: 'Plaque de fer', plural: 'plaques de fer', color: 0x8a99ad, shape: 'plate', tier: 2, value: 5 },
  { id: 'vis', name: 'Vis', plural: 'vis', color: 0x8a99ad, shape: 'screw', tier: 2, value: 5 },
  { id: 'fil_cuivre', name: 'Fil de cuivre', plural: 'bobines de fil de cuivre', color: 0xd9824a, shape: 'coil', tier: 2, value: 5 },
  { id: 'fil_or', name: "Fil d'or", plural: "bobines de fil d'or", color: 0xd4a72c, shape: 'coil', tier: 2, value: 26 },
  { id: 'acier', name: 'Acier', plural: "lingots d'acier", color: 0x5f6b7a, shape: 'ingot', tier: 2, value: 7 },
  { id: 'tole_alu', name: "Tôle d'alu", plural: "tôles d'alu", color: 0xb8c4cc, shape: 'plate', tier: 2, value: 11 },
  { id: 'beton', name: 'Béton', plural: 'blocs de béton', color: 0x9c9a92, shape: 'block', tier: 2, value: 7 },
  // 3 · Pièces travaillées
  { id: 'tuyau_acier', name: "Tuyau d'acier", plural: "tuyaux d'acier", color: 0x5f6b7a, shape: 'tube', tier: 3, value: 10 },
  { id: 'poutre_acier', name: "Poutre d'acier", plural: "poutres d'acier", color: 0x5f6b7a, shape: 'plate', tier: 3, value: 10 },
  { id: 'engrenage', name: 'Engrenage', plural: 'engrenages', color: 0x8a99ad, shape: 'gear', tier: 3, value: 13 },
  { id: 'cable', name: 'Câble', plural: 'câbles', color: 0x33415c, shape: 'coil', tier: 3, value: 16 },
  { id: 'circuit', name: 'Circuit', plural: 'circuits', color: 0x3f9b6b, shape: 'chip', tier: 3, value: 40 },
  { id: 'oscillateur', name: 'Oscillateur', plural: 'oscillateurs', color: 0x93aee0, shape: 'chip', tier: 3, value: 18 },
  // 4 · Composants
  { id: 'rotor', name: 'Rotor', plural: 'rotors', color: 0xd9824a, shape: 'gear', tier: 4, value: 22 },
  { id: 'stator', name: 'Stator', plural: 'stators', color: 0x5f6b7a, shape: 'coil', tier: 4, value: 20 },
  { id: 'cadre', name: 'Cadre renforcé', plural: 'cadres renforcés', color: 0x6e7684, shape: 'block', tier: 4, value: 22 },
  { id: 'ecran', name: 'Écran', plural: 'écrans', color: 0x4b6cb7, shape: 'chip', tier: 4, value: 50 },
  { id: 'processeur', name: 'Processeur', plural: 'processeurs', color: 0x2e3a4b, shape: 'chip', tier: 4, value: 70 },
  { id: 'batterie', name: 'Batterie', plural: 'batteries', color: 0x8bd17c, shape: 'block', tier: 4, value: 32 },
  { id: 'panneau_solaire', name: 'Panneau solaire', plural: 'panneaux solaires', color: 0x4b6cb7, shape: 'plate', tier: 4, value: 70 },
  // 5 · Machines
  { id: 'moteur', name: 'Moteur', plural: 'moteurs', color: 0xf47c64, shape: 'block', tier: 5, value: 70 },
  { id: 'ordinateur', name: 'Ordinateur', plural: 'ordinateurs', color: 0x4b6cb7, shape: 'block', tier: 5, value: 160 },
  // 6 · Objets finis
  { id: 'robot', name: 'Robot', plural: 'robots', color: 0xffc857, shape: 'block', tier: 6, value: 300 },
  { id: 'drone', name: 'Drone', plural: 'drones', color: 0xffc857, shape: 'block', tier: 6, value: 200 },
  { id: 'reacteur', name: 'Réacteur', plural: 'réacteurs', color: 0x9ad04a, shape: 'block', tier: 6, value: 300 },
  // Objectif lointain
  { id: 'fusee', name: 'Fusée', plural: 'fusées', color: 0xf47c64, shape: 'block', tier: 7, value: 2000 },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries([...RAW, ...MADE].map((d) => [d.id, d]));
export const ITEM_LIST: ItemDef[] = [...RAW, ...MADE];
/** L'eau : un liquide, pompé dans les tuyaux, jamais sur un tapis. */
export const FLUIDS = new Set(['eau']);
export const RAW_IDS: string[] = RAW.map((d) => d.id).filter((id) => !FLUIDS.has(id));

export function item(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error(`Objet inconnu : ${id}`);
  return d;
}

/** « 1 plaque de fer », « 20 plaques de fer ». */
export function itemLabel(id: string, qty: number): string {
  const d = item(id);
  return `${qty} ${qty > 1 ? d.plural : d.name.toLowerCase()}`;
}

/** Ce qui se brûle (avant l'électricité) : le carburant de la raffinerie d'abord (il dure 5 fois plus), puis le charbon. */
export const FUELS = ['carburant', 'charbon'];

export function isFuel(id: string | undefined): boolean {
  return id === 'charbon' || id === 'carburant';
}
