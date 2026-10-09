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

export type MachineKind = 'drill' | 'crafter' | 'core' | 'storage' | 'lab' | 'missions' | 'sell' | 'station' | 'generator' | 'meter' | 'atelier' | 'port_in' | 'port_out' | 'solar' | 'battery' | 'lamp' | 'pump' | 'reactor' | 'charger';

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
  /** Générateur : puissance fournie, en kW. */
  supply?: number;
  /** Puissance consommée quand elle travaille au courant, en kW (les grosses machines consomment plus). */
  kw?: number;
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
    id: 'haut_fourneau', name: 'Fourneau', kind: 'crafter', coal: true, w: 2, h: 2, cost: 120, unlock: 4, buildable: true,
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
  compteur: {
    id: 'compteur', name: 'Compteur', kind: 'meter', coal: false, w: 1, h: 1, cost: 10, unlock: 1, recipes: [], buildable: true,
    hint: 'Se pose sur un tapis : son débit, sur les 20 dernières secondes',
  },
  grand_coffre: {
    id: 'grand_coffre', name: 'Grand coffre', kind: 'storage', coal: false, w: 2, h: 2, cost: 50, unlock: 1, recipes: [], buildable: true,
    hint: 'Garde 300 objets · 2 × 2',
  },
  depot: {
    id: 'depot', name: 'Dépôt', kind: 'storage', coal: false, w: 2, h: 2, cost: 120, unlock: 1, recipes: [], buildable: true,
    hint: 'Garde 300 objets ; relie-le à un autre dépôt, un camion fait les allers-retours',
  },
  gare: {
    id: 'gare', name: 'Gare', kind: 'storage', coal: false, w: 2, h: 2, cost: 250, unlock: 1, recipes: [], buildable: true,
    hint: 'Garde 300 objets ; relie-la à une autre gare, un train fait les allers-retours',
  },
  generateur: {
    id: 'generateur', name: 'Générateur', kind: 'generator', coal: true, w: 2, h: 2, cost: 120, unlock: 1, recipes: [], buildable: true, supply: 600,
    hint: 'Brûle du charbon et alimente les machines reliées par câble',
  },
  station: {
    id: 'station', name: 'Station', kind: 'station', coal: true, w: 2, h: 2, cost: 100, unlock: 1, recipes: [], buildable: true,
    hint: 'Un drone qui travaille tout seul dans la zone autour',
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
  pompe: {
    id: 'pompe', name: 'Pompe à eau', kind: 'pump', coal: false, w: 2, h: 2, cost: 80, unlock: 1, recipes: [], buildable: true,
    hint: 'Posée sur de l’eau : 40 L/s dans les tuyaux qui la touchent',
  },
  centrale: {
    id: 'centrale', name: 'Réacteur', kind: 'reactor', coal: false, w: 3, h: 3, cost: 1500, unlock: 1, recipes: [], buildable: true, supply: 2400,
    hint: '2,4 MW à l’uranium enrichi ; il doit être refroidi par l’eau d’une pompe (20 L/s)',
  },
  recharge: {
    id: 'recharge', name: 'Recharge des drones', kind: 'charger', coal: false, w: 2, h: 2, cost: 200, unlock: 1, recipes: [], buildable: true,
    hint: 'Reliée au courant : les drones autour s’y rechargent au lieu de brûler du charbon',
  },
  hangar: {
    id: 'hangar', name: 'Hangar', kind: 'station', coal: true, w: 3, h: 3, cost: 500, unlock: 1, recipes: [], buildable: true,
    hint: 'Une station à trois drones',
  },
  entrepot: {
    id: 'entrepot', name: 'Entrepôt', kind: 'storage', coal: false, w: 3, h: 3, cost: 300, unlock: 1, recipes: [], buildable: true,
    hint: 'Garde 900 objets, rangés par sorte · 3 × 3',
  },
  lampadaire: {
    id: 'lampadaire', name: 'Lampadaire', kind: 'lamp', coal: false, w: 1, h: 1, cost: 15, unlock: 1, recipes: [], buildable: true,
    hint: 'Éclaire loin autour de lui la nuit',
  },
  solaire: {
    id: 'solaire', name: 'Panneau solaire', kind: 'solar', coal: false, w: 2, h: 2, cost: 180, unlock: 1, recipes: [], buildable: true, supply: 120,
    hint: 'Du courant gratuit le jour (120 kW en plein soleil), rien la nuit',
  },
  batterie: {
    id: 'batterie', name: 'Batterie', kind: 'battery', coal: false, w: 2, h: 2, cost: 150, unlock: 1, recipes: [], buildable: true,
    hint: 'Garde le surplus du solaire (10 kWh) et le rend la nuit',
  },
  atelier: {
    id: 'atelier', name: 'Atelier', kind: 'atelier', coal: true, w: 3, h: 3, cost: 200, unlock: 1, recipes: [], buildable: true,
    hint: 'Un module : des machines rangées dans un seul bloc. Entre dedans pour les voir ou les modifier, copie-le',
  },
  entree: {
    id: 'entree', name: 'Entrée', kind: 'port_in', coal: false, w: 1, h: 1, cost: 5, unlock: 1, recipes: [], buildable: true,
    hint: 'Dans un atelier : ce qui entre dans l’atelier ressort ici, sur un tapis',
  },
  sortie: {
    id: 'sortie', name: 'Sortie', kind: 'port_out', coal: false, w: 1, h: 1, cost: 5, unlock: 1, recipes: [], buildable: true,
    hint: 'Dans un atelier : ce qu’un tapis y apporte sort de l’atelier',
  },
  noyau: {
    id: 'noyau', name: 'Noyau', kind: 'core', coal: false, w: 4, h: 4, cost: 0, unlock: 1, recipes: [], buildable: false,
    hint: 'Reçoit les livraisons',
  },
};

/** Les machines qui peuvent marcher à l'électricité, une fois débloqué leur nœud « électrique » (branche Énergie). */
export const ELECTRIC_BASES = ['foreuse', 'four', 'presse', 'tour', 'trefileuse', 'haut_fourneau', 'assembleur', 'broyeur', 'melangeur', 'raffinerie', 'fabricant', 'centrifugeuse'];

/** Consommation au courant, en kW : de 60 kW pour une presse à 400 kW pour une centrifugeuse. */
const KW: Record<string, number> = {
  presse: 60, tour: 60, trefileuse: 60, foreuse: 90, four: 90, broyeur: 120, melangeur: 120,
  assembleur: 150, haut_fourneau: 180, raffinerie: 250, fabricant: 300, centrifugeuse: 400,
};
for (const [id, kw] of Object.entries(KW)) if (MACHINES[id]) MACHINES[id].kw = kw;

/** Anciennes sauvegardes : les « machines électriques » séparées redeviennent la machine d'origine. */
export function baseType(id: string): string {
  return id.endsWith('_elec') && MACHINES[id.slice(0, -5)] ? id.slice(0, -5) : id;
}

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
  if (def.coal) { s.add('charbon'); s.add('carburant'); }
  return s;
}

/** La machine qui fabrique un objet, et la recette. */
export function producerOf(itemId: string): { machine: MachineDef; recipe: Recipe } | null {
  for (const m of Object.values(MACHINES)) {
    for (const rec of m.recipes) if (rec.out[itemId]) return { machine: m, recipe: rec };
  }
  return null;
}
