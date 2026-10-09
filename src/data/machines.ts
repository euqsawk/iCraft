// Les machines et leurs recettes (planche « Toutes les recettes »).
// Chaque machine déduit sa recette de ce qu'on lui apporte : aucune machine n'a deux recettes
// avec les mêmes entrées, sauf la raffinerie avec du pétrole (plastique ou carburant).
// Avant l'électricité, toutes les machines brûlent du charbon (une case carburant de 10).

export interface Recipe {
  in: Record<string, number>;
  out: Record<string, number>;
  /** Durée en secondes. */
  time: number;
}

export type MachineKind = 'drill' | 'crafter' | 'core' | 'storage' | 'lab' | 'missions' | 'sell';

export interface MachineDef {
  id: string;
  name: string;
  kind: MachineKind;
  /** Largeur et hauteur en cases. */
  w: number;
  h: number;
  cost: number;
  /** (Ancien système de niveaux, plus utilisé.) */
  unlock: number;
  /** Offert par le Noyau : il n'est pas dans la palette et ne se supprime pas. */
  gift?: boolean;
  /** Bâtiment unique (un seul exemplaire). */
  unique?: boolean;
  recipes: Recipe[];
  /** Fonctionne au charbon (case carburant). */
  coal: boolean;
  /** Peut être posée par le joueur. */
  buildable: boolean;
  /** Phrase courte pour la palette. */
  hint: string;
}

const r = (inp: Record<string, number>, out: Record<string, number>, time: number): Recipe => ({ in: inp, out, time });

export const MACHINES: Record<string, MachineDef> = {
  foreuse: {
    id: 'foreuse', name: 'Foreuse', kind: 'drill', coal: true, w: 2, h: 2, cost: 40, unlock: 1, recipes: [], buildable: true,
    hint: 'Posée sur un filon',
  },
  four: {
    id: 'four', name: 'Four', kind: 'crafter', coal: true, w: 2, h: 2, cost: 40, unlock: 1, buildable: true,
    hint: 'Minerai → lingot',
    recipes: [
      r({ fer: 1 }, { lingot_fer: 1 }, 1.6),
      r({ cuivre: 1 }, { lingot_cuivre: 1 }, 1.6),
      r({ sable: 1 }, { verre: 1 }, 1.6),
      r({ or: 1 }, { lingot_or: 1 }, 2.4),
    ],
  },
  presse: {
    id: 'presse', name: 'Presse', kind: 'crafter', coal: true, w: 2, h: 2, cost: 60, unlock: 1, buildable: true,
    hint: 'Lingot → plaque',
    recipes: [
      r({ lingot_fer: 1 }, { plaque_fer: 1 }, 1.2),
      r({ aluminium: 1 }, { tole_alu: 1 }, 1.4),
      r({ acier: 1 }, { poutre_acier: 1 }, 1.6),
    ],
  },
  tour: {
    id: 'tour', name: 'Tour', kind: 'crafter', coal: true, w: 2, h: 2, cost: 70, unlock: 2, buildable: true,
    hint: 'Lingot de fer → vis',
    recipes: [
      r({ lingot_fer: 1 }, { vis: 1 }, 1.2),
      r({ acier: 1 }, { tuyau_acier: 1 }, 1.6),
    ],
  },
  trefileuse: {
    id: 'trefileuse', name: 'Tréfileuse', kind: 'crafter', coal: true, w: 2, h: 2, cost: 70, unlock: 3, buildable: true,
    hint: 'Lingot de cuivre → fil',
    recipes: [
      r({ lingot_cuivre: 1 }, { fil_cuivre: 1 }, 1.2),
      r({ lingot_or: 1 }, { fil_or: 1 }, 1.6),
    ],
  },
  haut_fourneau: {
    id: 'haut_fourneau', name: 'Fourneau nu', kind: 'crafter', coal: true, w: 2, h: 2, cost: 120, unlock: 4, buildable: true,
    hint: 'Lingot de fer + charbon → acier',
    recipes: [r({ lingot_fer: 1, charbon: 1 }, { acier: 1 }, 2)],
  },
  assembleur: {
    id: 'assembleur', name: 'Assembleur', kind: 'crafter', coal: true, w: 2, h: 2, cost: 150, unlock: 5, buildable: true,
    hint: 'Deux pièces → une pièce travaillée',
    recipes: [
      r({ plaque_fer: 1, vis: 1 }, { engrenage: 1 }, 1.6),
      r({ fil_cuivre: 1, plastique: 1 }, { cable: 1 }, 1.6),
      r({ plastique: 1, fil_or: 1 }, { circuit: 1 }, 2),
      r({ cristal: 1, fil_cuivre: 1 }, { oscillateur: 1 }, 2),
      r({ engrenage: 1, fil_cuivre: 1 }, { rotor: 1 }, 2),
      r({ tuyau_acier: 1, fil_cuivre: 1 }, { stator: 1 }, 2),
      r({ poutre_acier: 1, beton: 1 }, { cadre: 1 }, 2),
      r({ verre: 1, circuit: 1 }, { ecran: 1 }, 2.4),
      r({ circuit: 1, oscillateur: 1 }, { processeur: 1 }, 2.4),
      r({ tole_alu: 1, cable: 1 }, { batterie: 1 }, 2.4),
    ],
  },
  broyeur: {
    id: 'broyeur', name: 'Broyeur', kind: 'crafter', coal: true, w: 2, h: 2, cost: 90, unlock: 6, buildable: true,
    hint: 'Calcaire → ciment, quartz → cristal',
    recipes: [
      r({ calcaire: 1 }, { ciment: 1 }, 1.4),
      r({ quartz: 1 }, { cristal: 1 }, 1.8),
    ],
  },
  melangeur: {
    id: 'melangeur', name: 'Mélangeur', kind: 'crafter', coal: true, w: 2, h: 2, cost: 110, unlock: 7, buildable: true,
    hint: 'Ciment + sable → béton',
    recipes: [r({ ciment: 1, sable: 1 }, { beton: 1 }, 1.8)],
  },
  raffinerie: {
    id: 'raffinerie', name: 'Raffinerie', kind: 'crafter', coal: true, w: 2, h: 2, cost: 160, unlock: 8, buildable: true,
    hint: 'Bauxite → aluminium, pétrole → plastique ou carburant',
    recipes: [
      r({ bauxite: 1 }, { aluminium: 1 }, 2),
      r({ petrole: 1 }, { plastique: 1 }, 2),
      r({ petrole: 1 }, { carburant: 1 }, 2),
    ],
  },
  fabricant: {
    id: 'fabricant', name: 'Fabricant', kind: 'crafter', coal: true, w: 2, h: 2, cost: 250, unlock: 9, buildable: true,
    hint: 'Trois composants → une machine',
    recipes: [
      r({ verre: 1, circuit: 1, tole_alu: 1 }, { panneau_solaire: 1 }, 3),
      r({ rotor: 1, stator: 1, vis: 1 }, { moteur: 1 }, 3),
      r({ processeur: 1, ecran: 1, cable: 1 }, { ordinateur: 1 }, 3.5),
      r({ moteur: 1, ordinateur: 1, cadre: 1 }, { robot: 1 }, 4),
      r({ moteur: 1, batterie: 1, processeur: 1 }, { drone: 1 }, 4),
      r({ uranium_enrichi: 1, cadre: 1, ordinateur: 1 }, { reacteur: 1 }, 4),
    ],
  },
  centrifugeuse: {
    id: 'centrifugeuse', name: 'Centrifugeuse', kind: 'crafter', coal: true, w: 2, h: 2, cost: 300, unlock: 12, buildable: true,
    hint: 'Uranium → uranium enrichi',
    recipes: [r({ uranium: 1 }, { uranium_enrichi: 1 }, 3)],
  },
  coffre: {
    id: 'coffre', name: 'Coffre', kind: 'storage', coal: false, w: 1, h: 1, cost: 15, unlock: 1, recipes: [], buildable: true,
    hint: 'Garde 100 objets · les drones y prennent le charbon',
  },
  revente: {
    id: 'revente', name: 'Revente', kind: 'sell', coal: false, w: 2, h: 2, cost: 20, unlock: 1, recipes: [], buildable: true,
    hint: 'Un gros drone passe toutes les 5 minutes et revend tout, à bas prix',
  },
  laboratoire: {
    id: 'laboratoire', name: 'Laboratoire', kind: 'lab', coal: false, unique: true, gift: true, w: 2, h: 2, cost: 80, unlock: 1, recipes: [], buildable: true,
    hint: 'Garde les objets qui servent à débloquer l’arbre',
  },
  comptoir: {
    id: 'comptoir', name: 'Comptoir', kind: 'missions', coal: false, unique: true, gift: true, w: 2, h: 2, cost: 60, unlock: 1, recipes: [], buildable: true,
    hint: 'Des commandes au choix, payées en pièces',
  },
  noyau: {
    id: 'noyau', name: 'Noyau', kind: 'core', coal: false, w: 4, h: 4, cost: 0, unlock: 1, recipes: [], buildable: false,
    hint: 'Reçoit les livraisons',
  },
};

export const BUILDABLE: MachineDef[] = Object.values(MACHINES).filter((m) => m.buildable);

export function machineDef(id: string): MachineDef {
  const d = MACHINES[id];
  if (!d) throw new Error(`Machine inconnue : ${id}`);
  return d;
}

/** Objets qu'une machine accepte en entrée (ingrédients et combustible). */
export function acceptedInputs(def: MachineDef): Set<string> {
  const s = new Set<string>();
  for (const rec of def.recipes) for (const k of Object.keys(rec.in)) s.add(k);
  if (def.coal) s.add('charbon');
  return s;
}

/** La machine qui fabrique un objet, et la recette. */
export function producerOf(itemId: string): { machine: MachineDef; recipe: Recipe } | null {
  for (const m of Object.values(MACHINES)) {
    for (const rec of m.recipes) if (rec.out[itemId]) return { machine: m, recipe: rec };
  }
  return null;
}
