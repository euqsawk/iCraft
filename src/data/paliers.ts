// Les missions fixes du Noyau : les mêmes dans toutes les parties.
// Chaque mission terminée fait passer au palier suivant, qui ouvre une partie de l'arbre.
// Palier 1 → 2 : environ 15 minutes ; les suivants sont de plus en plus longs.

export interface PalierMission {
  /** Palier atteint quand la mission est terminée. */
  to: number;
  lines: Record<string, number>;
  /** Phrase d'accroche affichée dans la fiche du Noyau. */
  pitch: string;
}

export const PALIERS: PalierMission[] = [
  { to: 2, pitch: 'Le Noyau se réveille : il lui faut du métal pour s’étendre.', lines: { lingot_fer: 150, lingot_cuivre: 80, plaque_fer: 40 } },
  { to: 3, pitch: 'Pour tenir le choc, le Noyau veut des pièces solides.', lines: { plaque_fer: 300, fil_cuivre: 200, vis: 200, acier: 100 } },
  { to: 4, pitch: 'Le Noyau prépare ses fondations.', lines: { engrenage: 250, tuyau_acier: 150, beton: 150, verre: 150 } },
  { to: 5, pitch: 'Le Noyau apprend à bouger.', lines: { moteur: 60, plastique: 200, cable: 150, tole_alu: 150 } },
  { to: 6, pitch: 'Le Noyau se met à réfléchir.', lines: { ordinateur: 40, batterie: 80, panneau_solaire: 40, processeur: 60 } },
  { to: 7, pitch: 'Le Noyau construit son équipage.', lines: { robot: 30, drone: 30, reacteur: 12 } },
  { to: 8, pitch: 'Dernière étape : le Noyau assemble la fusée.', lines: { robot: 40, drone: 40, reacteur: 20, panneau_solaire: 60 } },
];

export const MAX_PALIER = PALIERS[PALIERS.length - 1].to;

/** La mission du Noyau pour passer au palier suivant (ou rien à la fin). */
export function palierMission(palier: number): PalierMission | null {
  return PALIERS.find((p) => p.to === palier + 1) ?? null;
}
