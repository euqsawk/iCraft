# Usine fractale

Un jeu d'usine en 2D pour téléphone, joué dans le navigateur. On trace ses tapis au doigt, on pose ses machines sur une grille invisible, et un petit robot jaune construit le tout avec ses drones.

Ce dépôt contient le **premier prototype jouable** : la carte, le robot et ses drones, les machines au charbon, les tapis tracés au doigt, le Noyau et ses paliers, le Laboratoire, le Comptoir et l'arbre de déblocages.

## Jouer sur iPhone

1. Ouvre le lien GitHub Pages du dépôt dans Safari.
2. Touche **Partager**, puis **Sur l'écran d'accueil**. Le jeu s'ouvre alors en plein écran, fonctionne hors connexion et sa sauvegarde est mieux protégée.

### Menu principal et nouvelle partie

À chaque lancement (quand le jeu n'était plus en mémoire), le menu principal s'ouvre : **Continuer** la dernière partie, **Nouvelle partie**, **Parties** (3 emplacements : jouer, exporter, supprimer) et **Importer un code**. Dans le menu du jeu, **Exporter la partie** donne un code (« UF1.… », la sauvegarde compressée) à copier ou partager ; l'importer recrée la partie sur n'importe quel téléphone. « Menu principal » ramène à cet écran.

Une nouvelle partie commence par une courte présentation : « Ça, c'est toi », la personnalisation du robot (couleur, accessoire, nom), puis les drones et leurs priorités. Ensuite la caméra montre la carte de loin, plonge vers le robot, et le brouillard se referme autour de la zone de départ (toucher l'écran passe l'animation).

Pendant la partie, quelques **conseils** courts expliquent les débuts (charbon, foreuse, coffre, fer, fabrication à la main). Chacun se valide tout seul quand on l'a fait, ou avec « Compris ». « Plus de conseils sur cette partie » les coupe pour cette partie ; le menu du jeu permet de les réactiver.

### Les gestes

| Geste | Sans outil | Avec un outil |
| --- | --- | --- |
| Glisser un doigt | Déplace la caméra | Trace un tapis (repasser sur le tracé le reprend de là), pose une machine ou gomme |
| Toucher le sol | Envoie le robot | Pose la machine (outil Machine) ou gomme une case |
| Toucher une construction | Ouvre sa bulle (Déplacer, Supprimer) | — |
| Toucher le Noyau | Ouvre sa mission | — |
| Toucher le Laboratoire ou le Comptoir | Ouvre son stock ou ses commandes | — |
| Toucher le robot | Inventaire, charbon et priorité des drones | — |
| Glisser depuis le milieu d'un tapis | — | Crée une dérivation : le tapis devient un séparateur (à débloquer) |
| Deux doigts | Déplacer et zoomer | Déplacer et zoomer |

Pour poser une machine : touche sa carte puis la carte du jeu, ou fais glisser sa carte depuis la palette jusqu'à sa place. Elle apparaît un peu au-dessus du doigt pour rester visible. Une foreuse affiche en direct ce qu'elle va extraire par seconde sur le filon visé. Là où un tapis touche une machine, un petit bloc blanc montre l'entrée (chevron rouge) ou la sortie (chevron vert). Si un tapis longe déjà une machine, trace avec l'outil Tapis depuis la machine vers ce tapis : ils sont reliés par le côté, sans nouvelle case, avec un petit bout de tapis entre les deux. Un tapis coincé entre deux machines peut être relié aux deux. Dans l'autre sens, trace depuis le milieu d'un tapis vers une machine qu'il longe : le tapis la nourrit (un objet sur deux y entre, tout si elle est seule à en vouloir). La bulle du tapis permet de couper ces liaisons. Deux machines collées se relient aussi en traçant de l'une vers l'autre : un bout de tapis à cheval sur leur bord commun, avec un chevron vert, et les objets passent directement (on coupe la liaison dans la fenêtre de la machine). Posée (ou déplacée) sur un tapis, elle remplace les cases de tapis dessous (remboursées) : le tapis qui arrive devient son entrée, celui qui repart sa sortie. Des guides corail montrent quand elle est alignée avec ses voisines. Ce qui est hors de l'écran (machines, tapis, drones) n'est pas dessiné, mais l'usine continue de tourner. Pendant un tracé ou un coup de gomme, une loupe en haut de l'écran montre ce qui se passe sous le doigt.

### La première usine

1. Envoie le robot sur le filon de charbon (gris foncé) : à l'arrêt, il mine tout seul.
2. **Machine → Foreuse** sur le charbon, et un **Coffre** à côté, relié par un tapis. Toute foreuse neuve sort du chantier avec 10 charbons. Une foreuse sur du charbon s'alimente toute seule : elle remplit d'abord sa propre case carburant avec ce qu'elle extrait, puis envoie le reste.
3. **Machine → Foreuse** sur le fer (gris-bleu), puis un **Four**.
4. **Tapis** : du fer jusqu'au four, puis du four jusqu'au Noyau.
5. Le robot construit chaque fantôme à son tour. Le drone va chercher le charbon dans le coffre et recharge les machines dont le voyant clignote. Le Noyau reçoit les lingots : sa mission avance.
6. Après quelques minutes, le Noyau t'offre un **Comptoir** (ses commandes rapportent des pièces), puis un peu plus tard un **Laboratoire** (il garde les objets qui débloquent l'arbre, la Presse en premier). La caméra va les voir et une carte explique leur rôle.

## Règles déjà en place

- **Recettes déduites de l'entrée** : une machine fait ce qu'on lui apporte (une presse transforme un lingot de fer en plaque, de l'aluminium en tôle…). Seule la raffinerie avec du pétrole demande un choix, dans sa bulle.
- **Tout au charbon** (jusqu'à l'électricité) : chaque machine a une case carburant de 10 charbons ; un charbon dure 10 s de travail. Un tapis qui apporte du charbon remplit cette case. Quand elle tombe à 2, un voyant clignote sur la machine.
- **Robot** : une case carburant (un charbon = 30 s de route, de chantier ou de minage) et 5 cases d'inventaire de 10. À l'arrêt sur un filon, il mine et garde ce qu'il trouve ; il se recharge avec le charbon de son inventaire. Sans charbon, il avance au quart de sa vitesse. Touche-le pour voir sa jauge et son inventaire.
- **Drones** : un au départ (avec 10 charbons), deux de plus à débloquer dans l'arbre (branche Robot). Chacun a une case carburant (un charbon = 20 s de vol) et une case d'inventaire. Ils construisent, rechargent les machines en charbon en priorité celles qui clignotent, vont remplir leur cargaison au coffre le plus proche. Ils ne se servent jamais dans l'inventaire du robot : ce qu'il mine reste à lui. Sans charbon, ils se posent sur le robot, qui partage avec eux la moitié de sa case carburant. Portée : 8 cases autour du robot pour construire, 16 pour le charbon et les livraisons.
- **Coffre** (1 case, 100 objets) : un tapis peut le remplir, un tapis peut en sortir, les drones y prennent le charbon.
- **Construction** : chaque pose coûte des pièces et apparaît en fantôme. Le robot construit à courte portée, en allant de chantier en chantier ; les drones l'aident autour de lui.
- **Séparateur** (à débloquer dans l'arbre) : un objet sur deux part dans la dérivation ; si une sortie est pleine, tout passe par l'autre. Pour fusionner deux tapis, il suffit d'en faire arriver un sur le côté de l'autre. Les objets qui arrivent par le côté glissent du bord jusqu'au milieu du tapis (ils ne sautent plus).
- **Noyau et paliers** : le Noyau, carré, reçoit les tapis par n'importe quelle case de son bord. Il donne des missions fixes, les mêmes dans toutes les parties (palier 1 → 2 : 150 lingots de fer, 80 lingots de cuivre, 40 plaques de fer, environ 15 minutes ; les suivantes sont de plus en plus longues). Chaque mission terminée fait passer au palier suivant, qui ouvre une partie de l'arbre. Il prend seulement ce que demande sa mission.
- **Inventaire en grand** : toucher le robot ouvre son inventaire (charbon, 5 cases), la fabrication à la main et ses drones. Toucher un coffre ouvre son contenu avec l'inventaire du robot dessous : on choisit une pile, une quantité (1, moitié, tout, ou au curseur), puis on la donne au robot ou on la dépose dans le coffre. Une pile du robot peut aussi être séparée en deux. Toucher une machine (four, foreuse…) l'ouvre en grand : son débit réel (chaque entrée et sortie en objets par seconde, mesuré sur les 20 dernières secondes, avec le maximum possible), charbon, recettes, ce qui attend et ce qui est prêt à sortir (on peut le reprendre), et l'inventaire du robot pour lui donner du charbon ou des ingrédients. Le Noyau, le Laboratoire, le Comptoir et la Revente ont aussi l'inventaire du robot dans leur fenêtre : on leur donne directement ce dont ils ont besoin (les piles qu'ils refusent sont grisées).
- **Scanner** : dans l'inventaire du robot, choisis une matière ; pendant 10 secondes, trois flèches autour du robot montrent les trois filons les plus proches (même sous le brouillard, jusqu'à 8 chunks), avec leur distance en cases.
- **Fabrication à la main** : le robot fabrique tout ce que font les machines débloquées, trois fois plus lentement, en brûlant son charbon. Il remonte les recettes tout seul (du minerai de fer aux vis : fonte, puis tournage) et prend d'abord les composants déjà fabriqués qu'il a sur lui. Jusqu'à 5 fabrications en file ; annuler rend les ingrédients.
- **Laboratoire** (unique, offert) : il garde jusqu'à 500 de chaque objet qui sert à un déblocage. Débloquer un nœud consomme les objets demandés (par exemple 20 lingots de fer pour la Presse).
- **Station** (2 × 2, 100 pièces, à débloquer dans la branche Robot : 30 lingots de fer et 10 de cuivre) : elle a son propre drone, qui construit, recharge en charbon et livre depuis les coffres dans un rayon de 12 cases autour d'elle, même quand le robot est loin. Ce rayon s'affiche (et les machines à portée se teintent en vert) quand on la pose, la déplace ou ouvre sa fenêtre (où l'on range aussi les priorités de son drone). Sans charbon, le drone se pose sur la station et reprend celui de sa case carburant.
- **Revente** (2 × 2, 20 pièces) : une benne où les tapis déposent ce dont on ne veut plus (400 objets au plus). Toutes les 5 minutes, un gros drone vient la vider et revend tout d'un coup, à bas prix (0,2 pièce par point de valeur : 10 lingots de fer rapportent 6 pièces, contre 80 au Comptoir). C'est une poubelle et un filet de sécurité quand on n'a plus de pièces. Pendant une absence, la benne est vendue au retour.
- **Bâtiments offerts** : le Comptoir et le Laboratoire ne sont pas dans la palette. Le Noyau les pose près de lui (Comptoir après la première livraison au Noyau ou 4 minutes de jeu, Laboratoire 2 à 5 minutes plus tard). On peut les déplacer, pas les supprimer.
- **Comptoir** (unique, offert) : il reprend les commandes au choix (3 propositions, relance contre des pièces) ; une commande livrée rapporte des pièces, c'est la source d'argent.
- **Priorités des drones** : dans la bulle du robot, touche un drone pour ranger ses cinq tâches (recharger le charbon, construire, livrer le Noyau, le Laboratoire ou le Comptoir), de la plus importante à la moins importante. Il fait la première tâche utile de sa liste ; son propre charbon passe toujours avant. Un drone ne prend dans un coffre que la quantité dont le bâtiment a besoin. « Même ordre pour tous » copie la liste sur les autres drones. Pour livrer, les drones se servent uniquement dans les coffres ; une cargaison dont plus personne ne veut retourne dans un coffre, jamais dans une machine.
- **Supprimer** rembourse 100 % (bulle ou gomme).
- **Arbre de déblocages** : cinq branches, Production (machines), Logistique (séparateur, tapis rapide et express, grand coffre…), Robot (deuxième et troisième drones…), Énergie et Modules. Chaque nœud s'ouvre à un palier et se paie en objets déposés au Laboratoire. Touche ton palier en haut à gauche pour l'ouvrir ; un point rouge signale qu'un nœud est prêt. Ceux marqués « Bientôt » arriveront avec les prochaines étapes.
- **Bulle d'une machine** : elle montre ce que la machine attend en entrée et ce qu'elle renvoie en sortie, recette par recette.
- **Carte infinie** générée par une graine (visible et copiable dans le menu), avec brouillard, biomes et filons pauvres, normaux ou riches.
- **Sauvegarde** automatique dans le navigateur (IndexedDB), toutes les 10 secondes et à la fermeture, dans l'emplacement de la partie. Les mises à jour gardent la partie (et la relancent directement). L'ancienne partie unique est reprise dans le premier emplacement.
- **Absence** : quand le jeu est fermé, l'usine tourne à 10 % de sa vitesse, sur 8 h au plus. Ce que les tapis livrent au Noyau, au Laboratoire et au Comptoir compte ; un écran au retour montre ce qui a été livré.
- **Mise à jour** : le menu propose « Chercher une mise à jour ».

## Pas encore là

Électricité et câbles, modules, sons, transport (camions et trains), marché et le reste de l'équipement du robot. Ce sont les prochaines étapes du document de game design.

## Développement

```bash
npm install
npm run dev        # http://localhost:5173, reconstruit à chaque modification
npm test           # tests de la simulation (sans navigateur)
npm run typecheck
npm run build      # produit dist/
```

Ajouter `?debug` à l'adresse expose `window.__game` et `window.__renderer` dans la console.

Chaque poussée sur `main` lance les tests puis publie `dist/` sur GitHub Pages (`.github/workflows/deploy.yml`).

### Organisation

| Dossier | Rôle |
| --- | --- |
| `src/data` | Objets (46, fusée comprise), machines et recettes, missions des paliers, arbre de déblocages |
| `src/world` | Graine, bruit, biomes, filons, brouillard |
| `src/sim` | Simulation pure, sans rendu : usine, tapis, tracé au doigt, robot, drones, paliers, commandes |
| `src/render` | Rendu PixiJS dans le style Pastel |
| `src/input` | Gestes tactiles |
| `src/ui` | Interface HTML (menu principal, présentation, conseils, barre du haut, outils, bulles, feuilles) |
| `src/save` | Sauvegarde IndexedDB (3 emplacements) et codes d'export |
| `tests` | Tests de la simulation |

La simulation n'importe jamais PixiJS : elle se teste seule et pourra calculer la production hors ligne.
