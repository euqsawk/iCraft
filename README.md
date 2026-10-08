# Usine fractale

Un jeu d'usine en 2D pour téléphone, joué dans le navigateur. On trace ses tapis au doigt, on pose ses machines sur une grille invisible, et un petit robot jaune construit le tout avec ses drones.

Ce dépôt contient le **premier prototype jouable** : la carte, le robot et ses drones, les machines au charbon, les tapis tracés au doigt, le Noyau et ses paliers, le Laboratoire, le Comptoir et l'arbre de déblocages.

## Jouer sur iPhone

1. Ouvre le lien GitHub Pages du dépôt dans Safari.
2. Touche **Partager**, puis **Sur l'écran d'accueil**. Le jeu s'ouvre alors en plein écran, fonctionne hors connexion et sa sauvegarde est mieux protégée.

### Les gestes

| Geste | Sans outil | Avec un outil |
| --- | --- | --- |
| Glisser un doigt | Déplace la caméra | Trace un tapis, pose une machine ou gomme |
| Toucher le sol | Envoie le robot | Pose la machine (outil Machine) ou gomme une case |
| Toucher une construction | Ouvre sa bulle (Déplacer, Supprimer) | — |
| Toucher le Noyau | Ouvre sa mission | — |
| Toucher le Laboratoire ou le Comptoir | Ouvre son stock ou ses commandes | — |
| Toucher le robot | Inventaire, charbon et priorité des drones | — |
| Glisser depuis le milieu d'un tapis | — | Crée une dérivation : le tapis devient un séparateur (à débloquer) |
| Deux doigts | Déplacer et zoomer | Déplacer et zoomer |

Pour poser une machine, elle apparaît un peu au-dessus du doigt pour rester visible. Des guides corail montrent quand elle est alignée avec ses voisines. Pendant un tracé ou un coup de gomme, une loupe en haut de l'écran montre ce qui se passe sous le doigt.

### La première usine

1. Envoie le robot sur le filon de charbon (gris foncé) : à l'arrêt, il mine tout seul.
2. **Machine → Foreuse** sur le charbon, et un **Coffre** à côté, relié par un tapis. Le premier drone apporte ses 10 charbons de départ à la foreuse.
3. **Machine → Foreuse** sur le fer (gris-bleu), puis un **Four**.
4. **Tapis** : du fer jusqu'au four, puis du four jusqu'au Noyau.
5. Le robot construit chaque fantôme à son tour. Le drone va chercher le charbon dans le coffre et recharge les machines dont le voyant clignote. Le Noyau reçoit les lingots : sa mission avance.
6. Pose un **Comptoir** (ses commandes rapportent des pièces) et un **Laboratoire** (il garde les objets qui débloquent l'arbre, la Presse en premier).

## Règles déjà en place

- **Recettes déduites de l'entrée** : une machine fait ce qu'on lui apporte (une presse transforme un lingot de fer en plaque, de l'aluminium en tôle…). Seule la raffinerie avec du pétrole demande un choix, dans sa bulle.
- **Tout au charbon** (jusqu'à l'électricité) : chaque machine a une case carburant de 10 charbons ; un charbon dure 10 s de travail. Un tapis qui apporte du charbon remplit cette case. Quand elle tombe à 2, un voyant clignote sur la machine.
- **Robot** : une case carburant (un charbon = 30 s de route, de chantier ou de minage) et 5 cases d'inventaire de 10. À l'arrêt sur un filon, il mine et garde ce qu'il trouve ; il se recharge avec le charbon de son inventaire. Sans charbon, il avance au quart de sa vitesse. Touche-le pour voir sa jauge et son inventaire.
- **Drones** : un au départ (avec 10 charbons), deux de plus à débloquer dans l'arbre (branche Robot). Chacun a une case carburant (un charbon = 20 s de vol) et une case d'inventaire. Ils construisent, rechargent les machines en charbon en priorité celles qui clignotent, vont remplir leur cargaison au coffre le plus proche ou dans l'inventaire du robot, et distribuent ce que le robot a miné, toujours à la machine la plus proche du robot d'abord. Sans charbon, ils se posent sur le robot. Portée : 8 cases autour du robot pour construire, 16 pour le charbon et les livraisons.
- **Coffre** (1 case, 100 objets) : un tapis peut le remplir, un tapis peut en sortir, les drones y prennent le charbon.
- **Construction** : chaque pose coûte des pièces et apparaît en fantôme. Le robot construit à courte portée, en allant de chantier en chantier ; les drones l'aident autour de lui.
- **Séparateur** (à débloquer dans l'arbre) : un objet sur deux part dans la dérivation ; si une sortie est pleine, tout passe par l'autre. Pour fusionner deux tapis, il suffit d'en faire arriver un sur le côté de l'autre.
- **Noyau et paliers** : le Noyau, carré, reçoit les tapis par n'importe quelle case de son bord. Il donne des missions fixes, les mêmes dans toutes les parties (palier 1 → 2 : 150 lingots de fer, 80 lingots de cuivre, 40 plaques de fer, environ 15 minutes ; les suivantes sont de plus en plus longues). Chaque mission terminée fait passer au palier suivant, qui ouvre une partie de l'arbre. Il prend seulement ce que demande sa mission.
- **Laboratoire** (unique) : il garde jusqu'à 500 de chaque objet qui sert à un déblocage. Débloquer un nœud consomme les objets demandés (par exemple 20 lingots de fer pour la Presse).
- **Comptoir** (unique) : il reprend les commandes au choix (3 propositions, relance contre des pièces) ; une commande livrée rapporte des pièces, c'est la source d'argent.
- **Priorité des drones** : dans la bulle du robot, chaque drone a une tâche principale (recharger le charbon, construire, livrer le Noyau, le Laboratoire ou le Comptoir, distribuer le minerai du robot) ; il la fait d'abord, puis le reste. Pour livrer, les drones se servent dans les coffres et dans l'inventaire du robot.
- **Supprimer** rembourse 100 % (bulle ou gomme).
- **Arbre de déblocages** : cinq branches, Production (machines), Logistique (séparateur, tapis rapide et express, grand coffre…), Robot (deuxième et troisième drones…), Énergie et Modules. Chaque nœud s'ouvre à un palier et se paie en objets déposés au Laboratoire. Touche ton palier en haut à gauche pour l'ouvrir ; un point rouge signale qu'un nœud est prêt. Ceux marqués « Bientôt » arriveront avec les prochaines étapes.
- **Bulle d'une machine** : elle montre ce que la machine attend en entrée et ce qu'elle renvoie en sortie, recette par recette.
- **Carte infinie** générée par une graine (visible et copiable dans le menu), avec brouillard, biomes et filons pauvres, normaux ou riches.
- **Sauvegarde** automatique dans le navigateur (IndexedDB), toutes les 10 secondes et à la fermeture. Les mises à jour gardent la partie.
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
| `src/ui` | Interface HTML (barre du haut, commande, outils, bulles, feuilles) |
| `src/save` | Sauvegarde IndexedDB |
| `tests` | Tests de la simulation |

La simulation n'importe jamais PixiJS : elle se teste seule et pourra calculer la production hors ligne.
