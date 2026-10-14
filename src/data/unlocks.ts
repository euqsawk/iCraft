// L'arbre de déblocages, en étoile : le robot au centre, six branches à 60° autour.
// Chaque palier du Noyau ouvre une partie de l'arbre ; débloquer un nœud demande des objets, déposés au Laboratoire.
// Placement : `row` = rangée depuis le robot (1 = la plus proche ; toutes les branches tombent sur les mêmes hexagones),
// `col` = couloir dans la rangée (+ = vers la branche suivante, dans le sens des aiguilles d'une montre).
// La distance au robot compte les prérequis, jamais le palier.

export type UnlockEffect =
  | { kind: 'machine'; id: string }
  /** Les machines de ce type (déjà posées ou à venir) marchent aussi au courant. */
  | { kind: 'electric'; id: string }
  | { kind: 'splitter' }
  /** Le séparateur peut trier : un seul type d'objet part dans la dérivation. */
  | { kind: 'sorter' }
  /** Le 2e étage des tapis et les ascenseurs. */
  | { kind: 'levels' }
  | { kind: 'bridge' }
  | { kind: 'vehicle'; id: 'camion' | 'train' }
  /** Les tapis peuvent monter jusqu'à ce niveau (chaque tapis s'améliore et se paie à part). */
  | { kind: 'beltLevel'; max: number }
  /** Les foreuses peuvent monter jusqu'à ce niveau. */
  | { kind: 'drillLevel'; max: number }
  /** Les machines (four, presse, assembleur…) peuvent monter jusqu'à ce niveau. */
  | { kind: 'machineLevel'; max: number }
  | { kind: 'chestSlots'; slots: number }
  | { kind: 'robotSpeed'; mult: number }
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
  /** Rangée depuis le robot (1 = la plus proche). */
  row: number;
  /** Couloir dans la rangée (demi-couloirs permis). */
  col: number;
  /** Sans prérequis : accroché au départ de sa branche, se prend dès que son palier est atteint. */
  free?: boolean;
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
  /** Direction de la branche depuis le robot, en degrés (0 = droite, 90 = bas). */
  angle: number;
  color: string;
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
    id: 'production', label: 'Production', angle: 150, color: '#F47C64', nodes: [
      n('foreuse', 'Foreuse', 'foreuse', 2, -1, 1, {}, [], 'Posée sur un filon (2 × 2), elle en extrait la matière et la sort par ses tapis.', m('foreuse'), ['Filon → Minerai']),
      n('four', 'Four', 'four', 2, 0, 1, {}, [], 'Fond le minerai en lingots.', m('four'), ['Fer → Lingot de fer', 'Cuivre → Lingot de cuivre', 'Sable → Verre']),
      n('coffre', 'Coffre', 'coffre', 2, 1, 1, {}, [], 'Garde 100 objets : un tapis le remplit, un tapis qui en part le vide. Pratique pour stocker avant le Noyau, le Comptoir ou le Laboratoire.', m('coffre')),
      n('broyeur', 'Broyeur', 'broyeur', 3, -1.5, 2, { plaque_fer: 40 }, ['foreuse'], 'Réduit les roches en poudre.', m('broyeur'), ['Calcaire → Ciment', 'Quartz → Cristal']),
      n('presse', 'Presse', 'presse', 3, 0.5, 1, { lingot_fer: 20 }, ['four'], 'Aplatit les lingots en plaques.', m('presse'), ['Lingot de fer → Plaque de fer', 'Aluminium → Tôle d’alu', 'Acier → Poutre d’acier']),
      n('trefileuse', 'Tréfileuse', 'trefileuse', 3, 1.5, 1, { lingot_cuivre: 20 }, ['four'], 'Étire les lingots en fil, enroulé en bobines.', m('trefileuse'), ['Lingot de cuivre → Fil de cuivre', 'Lingot d’or → Fil d’or']),
      n('melangeur', 'Mélangeur', 'melangeur', 4, -1.5, 3, { vis: 40, acier: 40 }, ['broyeur'], 'Mélange deux matières. Il lui faut de l’eau : relie-le par un tuyau à une pompe posée sur un lac.', m('melangeur'), ['Ciment + Sable → Béton']),
      n('tour', 'Tour', 'tour', 4, 0.5, 2, { plaque_fer: 40, fil_cuivre: 20 }, ['presse'], 'Tourne le métal pour faire des vis et des tuyaux.', m('tour'), ['Lingot de fer → Vis', 'Acier → Tuyau d’acier']),
      n('haut_fourneau', 'Fourneau', 'haut_fourneau', 3, -0.5, 2, { lingot_fer: 60, plaque_fer: 40 }, ['four'], 'Allie le fer et le charbon.', m('haut_fourneau'), ['Lingot de fer + Charbon → Acier']),
      n('raffinerie', 'Raffinerie', 'raffinerie', 5, -1, 4, { engrenage: 60, tuyau_acier: 40 }, ['melangeur', 'haut_fourneau'], 'Traite la bauxite et le pétrole. Il lui faut de l’eau : relie-la par un tuyau à une pompe.', m('raffinerie'), ['Bauxite → Aluminium', 'Pétrole → Plastique ou Carburant']),
      n('assembleur', 'Assembleur', 'assembleur', 5, 1, 3, { vis: 60, acier: 40 }, ['tour', 'trefileuse'], 'Combine deux pièces en une pièce travaillée.', m('assembleur'), ['Plaque de fer + Vis → Engrenage', 'Engrenage + Fil → Rotor']),
      n('centrifugeuse', 'Centrifugeuse', 'centrifugeuse', 6, -1, 6, { moteur: 20, processeur: 30 }, ['raffinerie'], 'Enrichit l’uranium des cratères.', m('centrifugeuse'), ['Uranium → Uranium enrichi']),
      n('fabricant', 'Fabricant', 'fabricant', 6, 1, 4, { engrenage: 60, beton: 60 }, ['assembleur'], 'Assemble trois composants en machine.', m('fabricant'), ['Rotor + Stator + Vis → Moteur']),
      n('rampe', 'Rampe de lancement', 'rampe', 7, 0, 10, { alliage: 40, guidage: 2 }, ['fabricant', 'centrifugeuse'], 'La Rampe de lancement (4 × 4) : remplis-la de 20 structures, 8 moteurs de fusée, 4 guidages et 100 carburants. La fusée décolle : c’est la fin du voyage (et on peut recommencer).', m('rampe')),
    ],
  },
  {
    id: 'logistique', label: 'Logistique', angle: 210, color: '#E0A82E', nodes: [
      n('tapis', 'Tapis', 'tapis', 1, 0, 1, {}, [], 'Tracés au doigt, droits et rangés.', base),
      n('separateur', 'Séparateur, filtre et ascenseur', 'separateur', 2, 0, 1, { lingot_fer: 30 }, ['tapis'], 'Dans le menu Machine (Tapis). Séparateur et Filtre : une boîte posée sur un tapis ou par terre, au 1er ou au 2e étage, jusqu’à 4 sorties et autant d’entrées ; le séparateur partage à tour de rôle, le filtre envoie chaque objet par la sortie choisie. Ascenseur : le 2ᵉ étage des tapis ; pose-le sur un tapis pour faire monter la suite, ou pendant un tracé, touche 2 en bas à gauche.', { kind: 'splitter' }),
      n('pont', 'Ponts', 'pont', 2, -1, 3, { acier: 40 }, ['tapis'], 'En traçant un tapis, continue tout droit par-delà un autre tapis : il passe par-dessus (jusqu’à 4 cases).', { kind: 'bridge' }),
      n('grand_coffre', 'Grand coffre', 'grand_coffre', 2, 1, 2, { plaque_fer: 60 }, ['tapis'], 'Un coffre de 2 × 2 qui garde 300 objets (un coffre simple en garde 100).', m('grand_coffre')),
      n('camion', 'Camions', 'camion', 3, -1.5, 4, { moteur: 10 }, ['pont'], 'Le Dépôt : pose-en deux, remplis-les par tapis comme un coffre, puis relie-les depuis la fenêtre d’un dépôt. Un camion fait les allers-retours (20 objets à la fois) ; on peut ajouter des camions et un troisième arrêt.', m('depot')),
      n('entrepot', 'Entrepôt', 'entrepot', 4, 1.5, 6, { cadre: 20, acier: 100 }, ['grand_coffre', 'separateur'], 'Un grand bâtiment de 3 × 3 qui garde 900 objets et les range par sorte (il montre ce qu’il garde le plus).', m('entrepot')),
      n('train', 'Trains', 'train', 4, -1.5, 5, { moteur: 40 }, ['camion'], 'La Gare : comme le dépôt, mais pour un train, plus rapide, qui emporte 80 objets à la fois. Pour aller chercher l’or et l’uranium au loin.', m('gare')),
    ],
  },
  {
    // Les niveaux : chaque tapis, foreuse ou machine se paie ensuite à part pour monter.
    id: 'niveaux', label: 'Niveaux', angle: 90, color: '#D45D9A', nodes: [
      n('tapis2', 'Tapis niveau 2', 'rapide', 2, -1.5, 1, { plaque_fer: 20 }, [], 'Tes tapis peuvent monter au niveau 2 (2 fois plus vite) : touche un tapis pour l’améliorer, case par case.', { kind: 'beltLevel', max: 2 }),
      n('rapide', 'Tapis niveau 3', 'rapide', 3, -1.5, 2, { plaque_fer: 30, fil_cuivre: 30 }, ['tapis2'], 'Tes tapis peuvent monter au niveau 3 (deux fois plus vite qu’au départ).', { kind: 'beltLevel', max: 3 }),
      n('tapis4', 'Tapis niveau 4', 'express', 4, -1.5, 3, { engrenage: 40, vis: 60 }, ['rapide'], 'Tes tapis peuvent monter au niveau 4 (2,5 fois plus vite qu’au départ).', { kind: 'beltLevel', max: 4 }),
      n('express', 'Tapis niveau 5', 'express', 5, -1.5, 4, { engrenage: 80, acier: 40 }, ['tapis4'], 'Tes tapis peuvent monter au niveau 5 (trois fois plus vite qu’au départ).', { kind: 'beltLevel', max: 5 }),
      n('foreuse2', 'Foreuses niveau 2', 'foreuse_niveau', 2, -0.5, 1, { lingot_fer: 30 }, [], 'Tes foreuses peuvent monter au niveau 2 (1,5 fois plus de minerai) : touche une foreuse pour l’améliorer.', { kind: 'drillLevel', max: 2 }),
      n('foreuse3', 'Foreuses niveau 3', 'foreuse_niveau', 3, -0.5, 2, { plaque_fer: 60, vis: 20 }, ['foreuse2'], 'Tes foreuses peuvent monter au niveau 3 (deux fois plus de minerai qu’au niveau 1).', { kind: 'drillLevel', max: 3 }),
      n('foreuse4', 'Foreuses niveau 4', 'foreuse_niveau', 4, -0.5, 4, { engrenage: 60, acier: 60 }, ['foreuse3'], 'Tes foreuses peuvent monter au niveau 4 (trois fois plus de minerai qu’au niveau 1).', { kind: 'drillLevel', max: 4 }),
      n('forage', 'Foreuses niveau 5', 'foreuse_niveau', 5, 0, 6, { moteur: 20, acier: 100 }, ['foreuse4', 'machine3'], 'Tes foreuses peuvent monter au niveau 5 (quatre fois plus de minerai qu’au niveau 1).', { kind: 'drillLevel', max: 5 }),
      n('machine2', 'Machines niveau 2', 'machine_niveau', 2, 0.5, 2, { plaque_fer: 60, fil_cuivre: 40 }, [], 'Fours, presses, assembleurs… peuvent monter au niveau 2 (2 fois plus vite) : touche une machine pour l’améliorer.', { kind: 'machineLevel', max: 2 }),
      n('machine3', 'Machines niveau 3', 'machine_niveau', 3, 0.5, 4, { engrenage: 80, circuit: 30 }, ['machine2'], 'Les machines peuvent monter au niveau 3 (trois fois plus vite qu’au départ).', { kind: 'machineLevel', max: 3 }),
    ],
  },
  {
    id: 'robot', label: 'Robot', angle: 30, color: '#2E9E6A', nodes: [
      n('robot', 'Robot', 'robot', 1, 0, 1, {}, [], 'Ton robot explore la carte : envoie-le où tu veux, sa lampe dissipe le brouillard.', base),
      n('chenilles', 'Chenilles', 'chenilles', 2, 0.5, 2, { vis: 30, plaque_fer: 30 }, ['robot'], 'Le robot roule 1,25 fois plus vite.', { kind: 'robotSpeed', mult: 1.25 }),
      n('chenilles2', 'Chenilles II', 'chenilles', 3, 0.5, 3, { engrenage: 30, acier: 20 }, ['chenilles'], 'Le robot roule 1,5 fois plus vite qu’au départ.', { kind: 'robotSpeed', mult: 1.5 }),
      n('chenilles3', 'Chenilles III', 'chenilles', 4, 0.5, 5, { moteur: 10, engrenage: 40 }, ['chenilles2'], 'Le robot roule 2 fois plus vite qu’au départ.', { kind: 'robotSpeed', mult: 2 }),
      n('base_robot', 'Base du robot', 'base_robot', 2, -0.5, 5, { circuit: 20, moteur: 5 }, ['robot'], 'La Base du robot (2 × 2, une seule par partie) : pose-la où tu veux. Depuis le menu du robot, « Retour à la base » le téléporte juste à côté, d’où qu’il soit.', m('base_robot')),
    ],
  },
  {
    id: 'energie', label: 'Énergie', angle: -30, color: '#6B4FA0', nodes: [
      n('charbon', 'Charbon', 'charbon', 1, 0, 1, {}, [], 'Au début, tout tourne au charbon, apporté aux machines par tapis.', base),
      n('lampadaire', 'Lampadaire', 'lampadaire', 2, -1.5, 2, { lingot_fer: 20, fil_cuivre: 10 }, ['charbon'], 'Un lampadaire d’une case : la nuit, il éclaire loin autour de lui (sans courant ni charbon).', m('lampadaire')),
      n('arbre', 'Arbres', 'arbre', 2, 0.5, 2, { lingot_fer: 10 }, ['charbon'], 'Les Arbres (une case) : pour décorer ton usine.', m('arbre')),
      n('generateur', 'Générateur', 'generateur', 2, -0.5, 4, { moteur: 10, cable: 40 }, ['charbon'], 'Brûle du charbon et fournit 600 kW, refroidi par l’eau d’une pompe (10 L/s, par tuyau) (une presse consomme 60 kW, un fabricant 300 kW ; débloque ensuite chaque type de machine au courant). Débloque aussi les câbles : trace-les au doigt : un câble alimente les machines à 5 cases autour de lui.', m('generateur')),
      // Chaque machine a sa version électrique : plus de charbon à livrer, il suffit d'un câble.
      n('foreuse_elec', 'Foreuse électrique', 'foreuse_elec', 3, -1.5, 4, { cable: 20, engrenage: 20 }, ['generateur'], 'Tes foreuses marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 90 kW quand elle travaille.', elec('foreuse')),
      n('four_elec', 'Four électrique', 'four_elec', 3, -0.5, 4, { cable: 40 }, ['generateur'], 'Tes fours marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 90 kW quand elle travaille.', elec('four')),
      n('broyeur_elec', 'Broyeur électrique', 'broyeur_elec', 3, 0.5, 4, { cable: 30, beton: 20 }, ['generateur'], 'Tes broyeurs marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 120 kW quand elle travaille.', elec('broyeur')),
      n('presse_elec', 'Presse électrique', 'presse_elec', 4, -0.5, 5, { cable: 30, plaque_fer: 60 }, ['four_elec'], 'Tes presses marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 60 kW quand elle travaille.', elec('presse')),
      n('trefileuse_elec', 'Tréfileuse électrique', 'trefileuse_elec', 4, 0.5, 5, { cable: 30, fil_cuivre: 60 }, ['four_elec'], 'Tes tréfileuses marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 60 kW quand elle travaille.', elec('trefileuse')),
      n('melangeur_elec', 'Mélangeur électrique', 'melangeur_elec', 4, 1.5, 5, { cable: 40, beton: 40 }, ['broyeur_elec'], 'Tes mélangeurs marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 120 kW quand elle travaille.', elec('melangeur')),
      n('tour_elec', 'Tour électrique', 'tour_elec', 5, -1, 5, { cable: 30, vis: 60 }, ['presse_elec'], 'Tes tours marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 60 kW quand elle travaille.', elec('tour')),
      n('haut_fourneau_elec', 'Fourneau électrique', 'haut_fourneau_elec', 4, -1.5, 5, { cable: 40, acier: 40 }, ['foreuse_elec', 'four_elec'], 'Tes fourneaux marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 180 kW quand elle travaille. L’acier demande toujours du charbon comme ingrédient.', elec('haut_fourneau')),
      n('raffinerie_elec', 'Raffinerie électrique', 'raffinerie_elec', 5, 1.5, 5, { cable: 60, plastique: 40 }, ['melangeur_elec'], 'Tes raffineries marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 250 kW quand elle travaille.', elec('raffinerie')),
      n('assembleur_elec', 'Assembleur électrique', 'assembleur_elec', 5, 0, 5, { cable: 40, engrenage: 40 }, ['presse_elec', 'trefileuse_elec'], 'Tes assembleurs marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 150 kW quand elle travaille.', elec('assembleur')),
      n('fabricant_elec', 'Fabricant électrique', 'fabricant_elec', 6, 0, 6, { cable: 60, moteur: 10 }, ['assembleur_elec'], 'Tes fabricants marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 300 kW quand elle travaille.', elec('fabricant')),
      n('centrifugeuse_elec', 'Centrifugeuse électrique', 'centrifugeuse_elec', 6, 1.5, 6, { cable: 80, processeur: 20 }, ['raffinerie_elec'], 'Tes centrifugeuses marchent au courant quand un câble les relie à un générateur : plus de charbon à livrer. Chacune consomme 400 kW quand elle travaille.', elec('centrifugeuse')),
      n('pompe', 'Pompe à eau', 'pompe', 2, 1.5, 3, { plaque_fer: 40, vis: 20 }, ['charbon'], 'La Pompe à eau : posée sur un lac, elle envoie 40 L/s dans les tuyaux (outil Câble → Tuyau). Il faut de l’eau au mélangeur (5 L/s), à la raffinerie (10 L/s), au générateur au charbon (10 L/s) et au réacteur (20 L/s) : sans eau, ils s’arrêtent.', m('pompe')),
      n('batterie', 'Batteries', 'batterie', 4, 2.5, 5, { batterie: 20 }, ['solaire'], 'La Batterie : elle garde le surplus des panneaux solaires (jusqu’à 10 kWh) et le rend quand le soleil se couche, avant de brûler du charbon.', m('batterie')),
      n('solaire', 'Solaire', 'solaire', 3, 1.5, 5, { panneau_solaire: 10 }, ['arbre'], 'Le Panneau solaire : 120 kW gratuits en plein jour, de moins en moins au crépuscule, rien la nuit. Les batteries gardent le surplus pour la nuit.', m('solaire')),
      n('reacteur', 'Réacteur', 'reacteur', 7, 2, 7, { reacteur: 1 }, ['centrifugeuse_elec', 'batterie'], 'Le Réacteur (3 × 3) : 2,4 MW avec des barreaux d’uranium enrichi (un barreau = 2 minutes à pleine charge), apportés par tapis. Il doit être refroidi : relie-le par un tuyau à une pompe (20 L/s), sinon il s’arrête.', m('centrale')),
    ],
  },
  {
    id: 'modules', label: 'Modules', angle: -90, color: '#4B8BD1', nodes: [
      n('module', 'Modules', 'module', 1, 0, 5, { moteur: 20 }, [], 'Entoure des machines au doigt : elles se rangent dans un atelier de 3 × 3 qui produit pareil. On entre dedans pour les voir ou les modifier (20 × 20 cases), et on peut le copier.', m('atelier')),
      n('copie75', 'Copie à 75 %', 'copie', 2, -0.5, 5, { processeur: 10 }, ['module'], 'Une copie coûte 75 % des machines qu’elle contient.', { kind: 'copyRate', rate: 0.75 }),
      n('place1', 'Place +4', 'place', 2, 0.5, 5, { cadre: 20 }, ['module'], 'L’intérieur d’un atelier passe de 20 × 20 à 24 × 24 cases.', { kind: 'atelierSize', size: 24 }),
      n('copie50', 'Copie à 50 %', 'copie', 3, -1, 6, { processeur: 30 }, ['copie75'], 'Une copie coûte la moitié.', { kind: 'copyRate', rate: 0.5 }),
      n('imbrication', 'Imbrication', 'imbrication', 3, 0, 6, { ordinateur: 10 }, ['module', 'place1'], 'Un atelier peut contenir d’autres ateliers : une usine dans l’usine dans l’usine.', { kind: 'nesting' }),
      n('place2', 'Place +6', 'place', 3, 1, 6, { cadre: 50 }, ['place1'], 'L’intérieur d’un atelier passe à 30 × 30 cases.', { kind: 'atelierSize', size: 30 }),
      n('copie25', 'Copie à 25 %', 'copie', 4, -1, 7, { ordinateur: 20 }, ['copie50'], 'Une copie ne coûte plus qu’un quart.', { kind: 'copyRate', rate: 0.25 }),
      n('monte_charge', 'Monte-charge', 'module', 4, 0, 9, { alliage: 30, processeur: 20 }, ['imbrication'], 'Le Monte-charge : posé dans un atelier, il fait entrer ce qu’il faut depuis les coffres collés à l’atelier, dehors, et y range ce qui sort. Plus besoin de tapis jusqu’à l’atelier.', m('monte_charge')),
    ],
  },
];

export const ALL_NODES: UnlockNode[] = BRANCHES.flatMap((b) => b.nodes);
for (const id of ['lampadaire', 'arbre', 'pompe', 'grand_coffre', 'base_robot', 'tapis2', 'foreuse2', 'machine2', 'module']) {
  const x = ALL_NODES.find((y) => y.id === id);
  if (x) x.free = true;
}
/** La branche d'un nœud. */
export const BRANCH_OF: Record<string, Branch> = Object.fromEntries(BRANCHES.flatMap((b) => b.nodes.map((x) => [x.id, b])));
export const NODE: Record<string, UnlockNode> = Object.fromEntries(ALL_NODES.map((x) => [x.id, x]));

/** Débloqués dès le départ : les nœuds sans coût ni parent. */
export const BASE_UNLOCKS: string[] = ALL_NODES.filter((x) => Object.keys(x.cost).length === 0 && x.parents.length === 0).map((x) => x.id);

/** Le nœud qui débloque une machine, s'il y en a un. */
export function nodeForMachine(machineId: string): UnlockNode | undefined {
  return ALL_NODES.find((x) => x.effect.kind === 'machine' && x.effect.id === machineId);
}

/** Les objets qui servent à débloquer quelque chose (ce que le Laboratoire accepte). */
export const LAB_ITEMS: Set<string> = new Set(ALL_NODES.flatMap((x) => Object.keys(x.cost)));
