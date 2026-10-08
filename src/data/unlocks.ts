// L'arbre de déblocages : on gagne un point à chaque niveau et on choisit quoi débloquer.
// Quatre branches (Production, Logistique, Énergie, Modules), comme dans la maquette.

export type UnlockEffect =
  | { kind: 'machine'; id: string }
  | { kind: 'splitter' }
  | { kind: 'beltSpeed'; mult: number }
  | { kind: 'chestSlots'; slots: number }
  /** Prévu dans le document de game design, pas encore dans le jeu. */
  | { kind: 'soon' };

export interface UnlockNode {
  id: string;
  name: string;
  /** Clé d'icône (voir ui/nodeIcons.ts). */
  icon: string;
  row: number;
  col: number;
  /** Coût en points ; 0 = acquis dès le départ. */
  cost: number;
  parents: string[];
  hint: string;
  recipes: string[];
  /** Niveau minimal. */
  level: number;
  effect: UnlockEffect;
}

export interface Branch {
  id: string;
  label: string;
  nodes: UnlockNode[];
}

function n(id: string, name: string, icon: string, row: number, col: number, cost: number, parents: string[], hint: string, effect: UnlockEffect, recipes: string[] = [], level = 1): UnlockNode {
  return { id, name, icon, row, col, cost, parents, hint, effect, recipes, level };
}

const m = (id: string): UnlockEffect => ({ kind: 'machine', id });
const soon: UnlockEffect = { kind: 'soon' };

export const BRANCHES: Branch[] = [
  {
    id: 'production', label: 'Production', nodes: [
      n('foreuse', 'Foreuse', 'foreuse', 0, 0, 0, [], 'Posée sur un filon, elle en extrait la matière.', m('foreuse'), ['Filon → Minerai']),
      n('four', 'Four', 'four', 0, 1, 0, [], 'Fond le minerai en lingots.', m('four'), ['Fer → Lingot de fer', 'Cuivre → Lingot de cuivre', 'Sable → Verre']),
      n('coffre', 'Coffre', 'coffre', 0, 2, 0, [], 'Garde 100 objets. Les drones y prennent le charbon.', m('coffre')),
      n('broyeur', 'Broyeur', 'broyeur', 1, 0, 1, ['foreuse'], 'Réduit les roches en poudre.', m('broyeur'), ['Calcaire → Ciment', 'Quartz → Cristal']),
      n('presse', 'Presse', 'presse', 1, 1, 1, ['four'], 'Aplatit les lingots en plaques.', m('presse'), ['Lingot de fer → Plaque de fer', 'Aluminium → Tôle d’alu', 'Acier → Poutre d’acier']),
      n('trefileuse', 'Tréfileuse', 'trefileuse', 1, 2, 1, ['four'], 'Étire les lingots en fil, enroulé en bobines.', m('trefileuse'), ['Lingot de cuivre → Fil de cuivre', 'Lingot d’or → Fil d’or']),
      n('melangeur', 'Mélangeur', 'melangeur', 2, 0, 1, ['broyeur'], 'Mélange deux matières.', m('melangeur'), ['Ciment + Sable → Béton']),
      n('tour', 'Tour', 'tour', 2, 1, 1, ['presse'], 'Tourne le métal pour faire des vis et des tuyaux.', m('tour'), ['Lingot de fer → Vis', 'Acier → Tuyau d’acier']),
      n('haut_fourneau', 'Haut-fourneau', 'haut_fourneau', 2, 2, 1, ['presse'], 'Allie le fer et le charbon.', m('haut_fourneau'), ['Lingot de fer + Charbon → Acier']),
      n('raffinerie', 'Raffinerie', 'raffinerie', 3, 0, 2, ['melangeur'], 'Traite la bauxite et le pétrole.', m('raffinerie'), ['Bauxite → Aluminium', 'Pétrole → Plastique ou Carburant'], 6),
      n('assembleur', 'Assembleur', 'assembleur', 3, 1, 2, ['tour'], 'Combine deux pièces en une pièce travaillée.', m('assembleur'), ['Plaque de fer + Vis → Engrenage', 'Engrenage + Fil → Rotor'], 5),
      n('centrifugeuse', 'Centrifugeuse', 'centrifugeuse', 3, 2, 3, ['haut_fourneau'], 'Enrichit l’uranium des cratères.', m('centrifugeuse'), ['Uranium → Uranium enrichi'], 12),
      n('fabricant', 'Fabricant', 'fabricant', 4, 1, 3, ['assembleur'], 'Assemble trois composants en machine.', m('fabricant'), ['Rotor + Stator + Vis → Moteur'], 9),
    ],
  },
  {
    id: 'logistique', label: 'Logistique', nodes: [
      n('tapis', 'Tapis', 'tapis', 0, 1, 0, [], 'Tracés au doigt, droits et rangés.', soon),
      n('separateur', 'Séparateur', 'separateur', 1, 0, 1, ['tapis'], 'Glisse depuis le milieu d’un tapis : un objet sur deux part dans la dérivation.', { kind: 'splitter' }),
      n('rapide', 'Tapis rapide', 'rapide', 1, 1, 1, ['tapis'], 'Tous les tapis vont deux fois plus vite.', { kind: 'beltSpeed', mult: 2 }),
      n('pont', 'Ponts', 'pont', 1, 2, 1, ['tapis'], 'Un tapis passe par-dessus un autre.', soon),
      n('grand_coffre', 'Grand coffre', 'grand_coffre', 2, 0, 1, ['separateur'], 'Les coffres gardent 300 objets au lieu de 100.', { kind: 'chestSlots', slots: 30 }),
      n('express', 'Tapis express', 'express', 2, 1, 2, ['rapide'], 'Tous les tapis vont trois fois plus vite qu’au départ.', { kind: 'beltSpeed', mult: 3 }, [], 6),
      n('camion', 'Camions', 'camion', 2, 2, 2, ['pont'], 'Une route tracée au doigt, des allers-retours entre deux points.', soon, [], 5),
      n('tri', 'Tri', 'tri', 3, 0, 1, ['grand_coffre'], 'Un séparateur qui choisit : un seul objet part de côté.', soon),
      n('train', 'Trains', 'train', 3, 2, 3, ['camion'], 'Rails et gares pour aller chercher l’or et l’uranium au loin.', soon, [], 10),
    ],
  },
  {
    id: 'energie', label: 'Énergie', nodes: [
      n('charbon', 'Charbon', 'charbon', 0, 1, 0, [], 'Au début, tout tourne au charbon : machines, robot et drones.', soon),
      n('generateur', 'Générateur', 'generateur', 1, 1, 2, ['charbon'], 'Brûle du charbon et alimente les machines par câbles.', soon, [], 5),
      n('four_elec', 'Four électrique', 'four_elec', 2, 0, 1, ['generateur'], 'Un four qui marche à l’électricité : plus de charbon à livrer.', soon),
      n('batterie', 'Batteries', 'batterie', 2, 2, 1, ['generateur'], 'Stocke le surplus pour plus tard.', soon),
      n('solaire', 'Solaire', 'solaire', 3, 2, 2, ['batterie'], 'Énergie gratuite le jour, gardée la nuit dans les batteries.', soon, [], 8),
      n('reacteur', 'Réacteur', 'reacteur', 4, 1, 3, ['solaire'], 'Fonctionne à l’uranium enrichi. Fin de partie.', soon, [], 15),
    ],
  },
  {
    id: 'modules', label: 'Modules', nodes: [
      n('module', 'Modules', 'module', 0, 1, 2, [], 'Entoure des machines au doigt : elles deviennent un atelier qu’on peut copier.', soon, [], 6),
      n('copie75', 'Copie à 75 %', 'copie', 1, 0, 1, ['module'], 'Une copie coûte 75 % des machines qu’elle contient.', soon),
      n('place1', 'Place +4', 'place', 1, 2, 1, ['module'], 'L’intérieur d’un atelier passe de 20 à 24 cases.', soon),
      n('copie50', 'Copie à 50 %', 'copie', 2, 0, 2, ['copie75'], 'Une copie coûte la moitié.', soon),
      n('imbrication', 'Imbrication', 'imbrication', 2, 1, 2, ['module'], 'Un atelier peut contenir d’autres ateliers.', soon, [], 8),
      n('place2', 'Place +6', 'place', 2, 2, 2, ['place1'], 'L’intérieur d’un atelier passe à 30 cases.', soon),
      n('copie25', 'Copie à 25 %', 'copie', 3, 0, 3, ['copie50'], 'Une copie ne coûte plus qu’un quart.', soon, [], 10),
    ],
  },
];

export const ALL_NODES: UnlockNode[] = BRANCHES.flatMap((b) => b.nodes);
export const NODE: Record<string, UnlockNode> = Object.fromEntries(ALL_NODES.map((x) => [x.id, x]));

/** Débloqués dès le départ. */
export const BASE_UNLOCKS: string[] = ALL_NODES.filter((x) => x.cost === 0 && x.parents.length === 0).map((x) => x.id);

/** Points donnés au départ (en plus d'un point par niveau gagné). */
export const START_POINTS = 1;

/** Le nœud qui débloque une machine, s'il y en a un. */
export function nodeForMachine(machineId: string): UnlockNode | undefined {
  return ALL_NODES.find((x) => x.effect.kind === 'machine' && x.effect.id === machineId);
}
