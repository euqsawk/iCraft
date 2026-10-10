// L'arbre de déblocages. Chaque palier du Noyau ouvre une partie de l'arbre ;
// débloquer un nœud demande des objets, déposés au Laboratoire.
// Cinq branches : Production, Logistique, Robot, Énergie, Modules.

export type UnlockEffect =
  | { kind: 'machine'; id: string }
  /** Les machines de ce type (déjà posées ou à venir) marchent aussi au courant. */
  | { kind: 'electric'; id: string }
  | { kind: 'splitter' }
  /** Le séparateur peut trier : un seul type d'objet part dans la dérivation. */
  | { kind: 'sorter' }
  | { kind: 'bridge' }
  | { kind: 'vehicle'; id: 'camion' | 'train' }
  | { kind: 'beltSpeed'; mult: number }
  | { kind: 'chestSlots'; slots: number }
  | { kind: 'drone' }
  | { kind: 'robotSpeed'; mult: number }
  | { kind: 'droneRange'; mult: number }
  /** Modules : prix d'une copie d'atelier (fraction du prix de ce qu'il contient). */
  | { kind: 'copyRate'; rate: number }
  /** Modules : côté de l'intérieur d'un atelier, en cases. */
  | { kind: 'atelierSize'; size: number }
  /** Modules : un atelier peut contenir d'autres ateliers. */
  | { kind: 'nesting' }
  /** Acquis d'office (point de départ d'une branche). */
  | { kind: 'base' }
  /** Prévu dans le document de game design, pas encore dans le jeu. */
  | { kind: 'soon' };

export interface UnlockNode {
  id: string;
  name: string;
  /** Clé d'icône (voir ui/nodeIcons.ts). */
  icon: string;
  row: number;
  col: number;
  /** Objets à déposer au Laboratoire ; vide = acquis dès le départ. */
  cost: Record<string, number>;
  parents: string[];
  hint: string;
  recipes: string[];
  /** Palier du Noyau qui ouvre ce nœud. */
  palier: number;
  effect: UnlockEffect;
}

export interface Branch {
  id: string;
  label: string;
  nodes: UnlockNode[];
}

function n(id: string, name: string, icon: string, row: number, col: number, palier: number, cost: Record<string, number>, parents: string[], hint: string, effect: UnlockEffect, recipes: string[] = []): UnlockNode {
  return { id, name, icon, row, col, palier, cost, parents, hint, effect, recipes };
}

const m = (id: string): UnlockEffect => ({ kind: 'machine', id });
const elec = (id: string): UnlockEffect => ({ kind: 'electric', id });
const base: UnlockEffect = { kind: 'base' };

export const BRANCHES: Branch[] = [
  {
    id: 'production', label: 'Production', nodes: [
      n('foreuse', 'Foreuse', 'foreuse', 0, 0, 1, {}, [], 'Posée sur un filon, elle en extrait la matière.', m('foreuse'), ['Filon → Minerai']),
      n('four', 'Four', 'four', 0, 1, 1, {}, [], 'Fond le minerai en lingots.', m('four'), ['Fer → Lingot de fer', 'Cuivre → Lingot de cuivre', 'Sable → Verre']),
      n('coffre', 'Coffre', 'coffre', 0, 2, 1, {}, [], 'Garde 100 objets. Les drones y prennent le charbon et ce que demandent le Noyau, le Comptoir et le Laboratoire.', m('coffre')),
      n('broyeur', 'Broyeur', 'broyeur', 1, 0, 2, { plaque_fer: 40 }, ['foreuse'], 'Réduit les roches en poudre.', m('broyeur'), ['Calcaire → Ciment', 'Quartz → Cristal']),
      n('presse', 'Presse', 'presse', 1, 1, 1, { lingot_fer: 20 }, ['four'], 'Aplatit les lingots en plaques.', m('presse'), ['Lingot de fer → Plaque de fer', 'Aluminium → Tôle d’alu', 'Acier → Poutre d’acier']),
      n('trefileuse', 'Tréfileuse', 'trefileuse', 1, 2, 1, { lingot_cuivre: 20 }, ['four'], 'Étire les lingots en fil, enroulé en bobines.', m('trefileuse'), ['Lingot de cuivre → Fil de cuivre', 'Lingot d’or → Fil d’or']),
      n('melangeur', 'Mélangeur', 'melangeur', 2, 0, 3, { vis: 40, acier: 40 }, ['broyeur'], 'Mélange deux matières.', m('melangeur'), ['Ciment + Sable → Béton']),
      n('tour', 'Tour', 'tour', 2, 1, 2, { plaque_fer: 40, fil_cuivre: 20 }, ['presse'], 'Tourne le métal pour faire des vis et des tuyaux.', m('tour'), ['Lingot de fer → Vis', 'Acier → Tuyau d’acier']),
      n('haut_fourneau', 'Fourneau', 'haut_fourneau', 2, 2, 2, { lingot_fer: 60, plaque_fer: 40 }, ['presse'], 'Allie le fer et le charbon.', m('haut_fourneau'), ['Lingot de fer + Charbon → Acier']),
      n('raffinerie', 'Raffinerie', 'raffinerie', 3, 0, 4, { engrenage: 60, tuyau_acier: 40 }, ['melangeur'], 'Traite la bauxite et le pétrole.', m('raffinerie'), ['Bauxite → Aluminium', 'Pétrole → Plastique ou Carburant']),
      n('assembleur', 'Assembleur', 'assembleur', 3, 1, 3, { vis: 60, acier: 40 }, ['tour'], 'Combine deux pièces en une pièce travaillée.', m('assembleur'), ['Plaque de fer + Vis → Engrenage', 'Engrenage + Fil → Rotor']),
      n('centrifugeuse', 'Centrifugeuse', 'centrifugeuse', 4, 2, 6, { moteur: 20, processeur: 30 }, ['haut_fourneau'], 'Enrichit l’uranium des cratères.', m('centrifugeuse'), ['Uranium → Uranium enrichi']),
      n('fabricant', 'Fabricant', 'fabricant', 4, 1, 4, { engrenage: 60, beton: 60 }, ['assembleur'], 'Assemble trois composants en machine.', m('fabricant'), ['Rotor + Stator + Vis → Moteur']),
      n('super_foreuse', 'Grande foreuse', 'super_foreuse', 4, 0, 6, { moteur: 20, acier: 100 }, ['raffinerie'], 'La Grande foreuse (4 × 4) : posée au milieu d’un filon, elle l’exploite en entier, comme si des foreuses le couvraient partout, sans perte. Plus aucune autre foreuse ne s’y pose. Elle passe au courant avec les foreuses (400 kW).', m('super_foreuse')),
      n('rampe', 'Rampe de lancement', 'rampe', 5, 1, 10, { alliage: 40, guidage: 2 }, ['fabricant'], 'La Rampe de lancement (4 × 4) : remplis-la de 20 structures, 8 moteurs de fusée, 4 guidages et 100 carburants. La fusée décolle : c’est la fin du voyage (et on peut recommencer).', m('rampe')),
    ],
  },
  {
    id: 'logistique', label: 'Logistique', nodes: [
      n('tapis', 'Tapis', 'tapis', 0, 1, 1, {}, [], 'Tracés au doigt, droits et rangés.', base),
      n('separateur', 'Séparateur', 'separateur', 1, 0, 1, { lingot_fer: 20 }, ['tapis'], 'Glisse depuis le milieu d’un tapis : un objet sur deux part dans la dérivation.', { kind: 'splitter' }),
      n('rapide', 'Tapis rapide', 'rapide', 1, 1, 2, { plaque_fer: 30, fil_cuivre: 30 }, ['tapis'], 'Tous les tapis vont deux fois plus vite.', { kind: 'beltSpeed', mult: 2 }),
      n('pont', 'Ponts', 'pont', 1, 2, 3, { acier: 40 }, ['tapis'], 'En traçant un tapis, continue tout droit par-delà un autre tapis : il passe par-dessus (jusqu’à 4 cases).', { kind: 'bridge' }),
      n('grand_coffre', 'Grand coffre', 'grand_coffre', 2, 0, 2, { plaque_fer: 60 }, ['separateur'], 'Un coffre de 2 × 2 qui garde 300 objets (un coffre simple en garde 100).', m('grand_coffre')),
      n('express', 'Tapis express', 'express', 2, 1, 4, { engrenage: 80, acier: 40 }, ['rapide'], 'Tous les tapis vont trois fois plus vite qu’au départ.', { kind: 'beltSpeed', mult: 3 }),
      n('camion', 'Camions', 'camion', 2, 2, 4, { moteur: 10 }, ['pont'], 'Le Dépôt : pose-en deux, remplis-les par tapis comme un coffre, puis relie-les depuis la fenêtre d’un dépôt. Un camion fait les allers-retours (20 objets à la fois) ; on peut ajouter des camions et un troisième arrêt.', m('depot')),
      n('tri', 'Tri', 'tri', 3, 0, 3, { engrenage: 20 }, ['grand_coffre'], 'Le Trieur, posé sur un tapis qui part d’un coffre, d’une gare ou d’une machine, ne laisse sortir que les objets choisis. Et le séparateur peut trier : un seul objet part dans la dérivation.', { kind: 'sorter' }),
      n('entrepot', 'Entrepôt', 'entrepot', 4, 0, 6, { cadre: 20, acier: 100 }, ['tri'], 'Un grand bâtiment de 3 × 3 qui garde 900 objets et les range par sorte (il montre ce qu’il garde le plus).', m('entrepot')),
      n('train', 'Trains', 'train', 3, 2, 5, { moteur: 40 }, ['camion'], 'La Gare : comme le dépôt, mais pour un train, plus rapide, qui emporte 80 objets à la fois. Pour aller chercher l’or et l’uranium au loin.', m('gare')),
    ],
  },
  {
    id: 'robot', label: 'Robot', nodes: [
      n('robot', 'Robot', 'robot', 0, 1, 1, {}, [], 'Ton robot construit, mine à l’arrêt sur un filon et emmène ses drones.', base),
      n('drone2', 'Deuxième drone', 'drone', 1, 0, 2, { plaque_fer: 40, fil_cuivre: 30 }, ['robot'], 'Un drone de plus pour construire, recharger et livrer.', { kind: 'drone' }),
      n('station', 'Station', 'station', 1, 1, 1, { lingot_fer: 30, lingot_cuivre: 10 }, ['robot'], 'Une station avec son propre drone : il construit, recharge et livre dans un rayon de 12 cases autour d’elle.', m('station')),
      n('antenne', 'Antenne', 'antenne', 1, 2, 2, { fil_cuivre: 40, plaque_fer: 20 }, ['robot'], 'Les drones du robot vont 1,5 fois plus loin autour de lui (construire et livrer).', { kind: 'droneRange', mult: 1.5 }),
      n('drone3', 'Troisième drone', 'drone', 2, 0, 3, { vis: 40, acier: 30, fil_cuivre: 30 }, ['drone2'], 'Un drone de plus.', { kind: 'drone' }),
      n('chenilles', 'Chenilles', 'chenilles', 2, 1, 2, { vis: 30, plaque_fer: 30 }, ['station'], 'Le robot roule 1,25 fois plus vite.', { kind: 'robotSpeed', mult: 1.25 }),
      n('antenne2', 'Antenne II', 'antenne', 2, 2, 3, { fil_cuivre: 80, acier: 30 }, ['antenne'], 'Les drones du robot vont 2 fois plus loin qu’au départ.', { kind: 'droneRange', mult: 2 }),
      n('chenilles2', 'Chenilles II', 'chenilles', 3, 1, 3, { engrenage: 30, acier: 20 }, ['chenilles'], 'Le robot roule 1,5 fois plus vite qu’au départ.', { kind: 'robotSpeed', mult: 1.5 }),
      n('antenne3', 'Antenne III', 'antenne', 3, 2, 5, { circuit: 30, cable: 30 }, ['antenne2'], 'Les drones du robot vont 2,5 fois plus loin qu’au départ.', { kind: 'droneRange', mult: 2.5 }),
      n('hangar', 'Hangar', 'station', 3, 0, 4, { moteur: 10, acier: 60 }, ['drone3'], 'Le Hangar (3 × 3) : une station à trois drones, qui construisent, rechargent et livrent autour de lui.', m('hangar')),
      n('recharge', 'Recharge des drones', 'drone', 4, 2, 5, { batterie: 10, circuit: 20 }, ['antenne3'], 'La Recharge : reliée au courant (80 kW), les drones autour d’elle viennent s’y recharger au lieu de brûler du charbon.', m('recharge')),
      n('chenilles3', 'Chenilles III', 'chenilles', 4, 1, 5, { moteur: 10, engrenage: 40 }, ['chenilles2'], 'Le robot roule 2 fois plus vite qu’au départ.', { kind: 'robotSpeed', mult: 2 }),
    ],
  },
  {
    id: 'energie', label: 'Énergie', nodes: [
      n('charbon', 'Charbon', 'charbon', 0, 1, 1, {}, [], 'Au début, tout tourne au charbon : machines, robot et drones.', base),
      n('lampadaire', 'Lampadaire', 'lampadaire', 1, 0, 2, { lingot_fer: 20, fil_cuivre: 10 }, ['charbon'], 'Un lampadaire d’une case : la nuit, il éclaire loin autour de lui (sans courant ni charbon).', m('lampadaire')),
      n('arbre', 'Arbres', 'arbre', 1, 2, 2, { lingot_fer: 10 }, ['charbon'], 'Les Arbres (une case) : ils nettoient doucement la pollution des générateurs et des machines au charbon.', m('arbre')),
      n('generateur', 'Générateur', 'generateur', 1, 1, 4, { moteur: 10, cable: 40 }, ['charbon'], 'Brûle du charbon et fournit 600 kW (une presse consomme 60 kW, un fabricant 300 kW ; débloque ensuite chaque type de machine au courant). Débloque aussi les câbles : trace-les au doigt : un câble alimente les machines à 5 cases autour de lui.', m('generateur')),
      // Chaque machine a sa version électrique : plus de charbon à livrer, il suffit d'un câble.
      n('foreuse_elec', 'Foreuse électrique', 'foreuse_elec', 2, 0, 4, { cable: 20, engrenage: 20 }, ['generateur'], 'Tes foreuses marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 90 kW quand elle travaille.', elec('foreuse')),
      n('four_elec', 'Four électrique', 'four_elec', 2, 1, 4, { cable: 40 }, ['generateur'], 'Tes fours marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 90 kW quand elle travaille.', elec('four')),
      n('broyeur_elec', 'Broyeur électrique', 'broyeur_elec', 2, 2, 4, { cable: 30, beton: 20 }, ['generateur'], 'Tes broyeurs marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 120 kW quand elle travaille.', elec('broyeur')),
      n('presse_elec', 'Presse électrique', 'presse_elec', 3, 0, 4, { cable: 30, plaque_fer: 60 }, ['foreuse_elec'], 'Tes presses marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 60 kW quand elle travaille.', elec('presse')),
      n('trefileuse_elec', 'Tréfileuse électrique', 'trefileuse_elec', 3, 1, 4, { cable: 30, fil_cuivre: 60 }, ['four_elec'], 'Tes tréfileuses marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 60 kW quand elle travaille.', elec('trefileuse')),
      n('melangeur_elec', 'Mélangeur électrique', 'melangeur_elec', 3, 2, 4, { cable: 40, beton: 40 }, ['broyeur_elec'], 'Tes mélangeurs marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 120 kW quand elle travaille.', elec('melangeur')),
      n('tour_elec', 'Tour électrique', 'tour_elec', 4, 0, 4, { cable: 30, vis: 60 }, ['presse_elec'], 'Tes tours marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 60 kW quand elle travaille.', elec('tour')),
      n('haut_fourneau_elec', 'Fourneau électrique', 'haut_fourneau_elec', 4, 1, 4, { cable: 40, acier: 40 }, ['trefileuse_elec'], 'Tes fourneaux marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 180 kW quand elle travaille. L’acier demande toujours du charbon comme ingrédient.', elec('haut_fourneau')),
      n('raffinerie_elec', 'Raffinerie électrique', 'raffinerie_elec', 4, 2, 4, { cable: 60, plastique: 40 }, ['melangeur_elec'], 'Tes raffineries marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 250 kW quand elle travaille.', elec('raffinerie')),
      n('assembleur_elec', 'Assembleur électrique', 'assembleur_elec', 5, 0, 4, { cable: 40, engrenage: 40 }, ['tour_elec'], 'Tes assembleurs marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 150 kW quand elle travaille.', elec('assembleur')),
      n('fabricant_elec', 'Fabricant électrique', 'fabricant_elec', 5, 1, 4, { cable: 60, moteur: 10 }, ['haut_fourneau_elec'], 'Tes fabricants marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 300 kW quand elle travaille.', elec('fabricant')),
      n('centrifugeuse_elec', 'Centrifugeuse électrique', 'centrifugeuse_elec', 7, 1, 6, { cable: 80, processeur: 20 }, ['fabricant_elec'], 'Tes centrifugeuses marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 400 kW quand elle travaille.', elec('centrifugeuse')),
      n('pompe', 'Pompe à eau', 'pompe', 5, 2, 5, { tuyau_acier: 40, moteur: 5 }, ['raffinerie_elec'], 'La Pompe à eau : posée sur un lac, elle envoie 40 L/s dans les tuyaux (outil Câble → Tuyau). Un mélangeur arrosé travaille moitié plus vite ; le réacteur en a besoin pour refroidir.', m('pompe')),
      n('filtre', 'Filtre à air', 'filtre', 6, 2, 5, { cable: 40, circuit: 20 }, ['pompe'], 'Le Filtre à air : au courant (60 kW), il nettoie vite la pollution autour de lui. Sans ça, une zone très polluée ralentit les machines et voile les panneaux solaires.', m('filtre')),
      n('batterie', 'Batteries', 'batterie', 6, 0, 5, { batterie: 20 }, ['assembleur_elec'], 'La Batterie : elle garde le surplus des panneaux solaires (jusqu’à 10 kWh) et le rend quand le soleil se couche, avant de brûler du charbon.', m('batterie')),
      n('solaire', 'Solaire', 'solaire', 7, 0, 5, { panneau_solaire: 10 }, ['batterie'], 'Le Panneau solaire : 120 kW gratuits en plein jour, de moins en moins au crépuscule, rien la nuit. Les batteries gardent le surplus pour la nuit.', m('solaire')),
      n('reacteur', 'Réacteur', 'reacteur', 8, 1, 7, { reacteur: 1 }, ['centrifugeuse_elec', 'solaire'], 'Le Réacteur (3 × 3) : 2,4 MW avec des barreaux d’uranium enrichi (un barreau = 2 minutes à pleine charge), apportés par tapis. Il doit être refroidi : relie-le par un tuyau à une pompe (20 L/s), sinon il s’arrête.', m('centrale')),
    ],
  },
  {
    id: 'modules', label: 'Modules', nodes: [
      n('module', 'Modules', 'module', 0, 1, 5, { moteur: 20 }, [], 'Entoure des machines au doigt : elles se rangent dans un atelier de 3 × 3 qui produit pareil. On entre dedans pour les voir ou les modifier (20 × 20 cases), et on peut le copier.', m('atelier')),
      n('copie75', 'Copie à 75 %', 'copie', 1, 0, 5, { processeur: 10 }, ['module'], 'Une copie coûte 75 % des machines qu’elle contient.', { kind: 'copyRate', rate: 0.75 }),
      n('place1', 'Place +4', 'place', 1, 2, 5, { cadre: 20 }, ['module'], 'L’intérieur d’un atelier passe de 20 × 20 à 24 × 24 cases.', { kind: 'atelierSize', size: 24 }),
      n('copie50', 'Copie à 50 %', 'copie', 2, 0, 6, { processeur: 30 }, ['copie75'], 'Une copie coûte la moitié.', { kind: 'copyRate', rate: 0.5 }),
      n('imbrication', 'Imbrication', 'imbrication', 2, 1, 6, { ordinateur: 10 }, ['module'], 'Un atelier peut contenir d’autres ateliers : une usine dans l’usine dans l’usine.', { kind: 'nesting' }),
      n('place2', 'Place +6', 'place', 2, 2, 6, { cadre: 50 }, ['place1'], 'L’intérieur d’un atelier passe à 30 × 30 cases.', { kind: 'atelierSize', size: 30 }),
      n('copie25', 'Copie à 25 %', 'copie', 3, 0, 7, { ordinateur: 20 }, ['copie50'], 'Une copie ne coûte plus qu’un quart.', { kind: 'copyRate', rate: 0.25 }),
      n('monte_charge', 'Monte-charge', 'module', 3, 2, 9, { alliage: 30, processeur: 20 }, ['place2'], 'Le Monte-charge : posé dans un atelier, il fait entrer ce qu’il faut depuis les coffres collés à l’atelier, dehors, et y range ce qui sort. Plus besoin de tapis jusqu’à l’atelier.', m('monte_charge')),
    ],
  },
];

export const ALL_NODES: UnlockNode[] = BRANCHES.flatMap((b) => b.nodes);
export const NODE: Record<string, UnlockNode> = Object.fromEntries(ALL_NODES.map((x) => [x.id, x]));

/** Débloqués dès le départ : les nœuds sans coût ni parent. */
export const BASE_UNLOCKS: string[] = ALL_NODES.filter((x) => Object.keys(x.cost).length === 0 && x.parents.length === 0).map((x) => x.id);

/** Le nœud qui débloque une machine, s'il y en a un. */
export function nodeForMachine(machineId: string): UnlockNode | undefined {
  if (machineId === 'trieur') return NODE.tri;
  return ALL_NODES.find((x) => x.effect.kind === 'machine' && x.effect.id === machineId);
}

/** Les objets qui servent à débloquer quelque chose (ce que le Laboratoire accepte). */
export const LAB_ITEMS: Set<string> = new Set(ALL_NODES.flatMap((x) => Object.keys(x.cost)));
