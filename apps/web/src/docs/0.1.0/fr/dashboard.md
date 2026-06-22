# Tableau de bord

Le tableau de bord est la page d'accueil. Il affiche une grille configurable de **widgets** — indicateurs clés (KPI), graphiques, jauges et tableaux — construits à partir des données de votre entrepôt. Vous pouvez conserver plusieurs tableaux de bord et passer de l'un à l'autre avec le sélecteur en haut à gauche.

## Consultation

Chaque widget exécute sa propre requête et affiche le résultat. Changez de tableau de bord avec le sélecteur **Tableau de bord**. Les tableaux de bord sont partagés entre tous les utilisateurs du déploiement.

## Édition

Cliquez sur **Modifier** pour entrer en mode édition. En mode édition, vous pouvez :

- **Ajouter un widget** — ouvrir l'éditeur de widgets (voir ci-dessous).
- **Déplacer** un widget par sa poignée d'en-tête, ou faire glisser son coin pour le redimensionner. La grille à 12 colonnes compacte automatiquement les widgets vers le haut.
- **Modifier** ou **supprimer** un widget avec les boutons de son en-tête.
- **Filtres** — définir des variables de filtre au niveau du tableau de bord.

Les modifications sont sauvegardées automatiquement pendant l'édition ; cliquez sur **Terminé** pour quitter le mode édition.

## Création d'un widget

L'éditeur de widgets propose deux façons de définir une requête, avec un aperçu en direct à droite :

- **Générateur** (par défaut) — choisissez une **Source** (par ex. Ordonnances, Résultats, Spécimens), une **Métrique** (un comptage ou un agrégat), une dimension optionnelle **Regrouper par**, et — pour les dimensions de date — un **Grain** (jour/semaine/mois/année). Le générateur compile vers une requête paramétrée sécurisée qui fonctionne sur les entrepôts PostgreSQL et SQL Server.
- **Visualisation** — choisissez comment le résultat est rendu : KPI, graphique en courbes / barres / aires / lignes / secteurs / nuage de points / entonnoir, jauge, barre de progression, feu tricolore, ou tableau.

## Filtres du tableau de bord

Définissez des variables de filtre (texte, nombre, date, ou plage de dates) et liez-les à des widgets. La modification d'une valeur de filtre relance les widgets associés, ce qui permet à un seul contrôle de piloter l'ensemble du tableau de bord.

## SQL personnalisé (avancé)

Lorsque cette fonctionnalité est activée par un administrateur, un onglet **SQL** vous permet d'écrire directement une requête `SELECT` en lecture seule. Cette option de contournement est **désactivée par défaut**, disponible **uniquement sur les entrepôts PostgreSQL**, et exécute chaque requête dans une transaction en lecture seule avec un délai d'expiration et une limite de lignes. Utilisez des espaces réservés `{{variable}}` pour référencer les filtres du tableau de bord. Pour des raisons de portabilité et de sécurité, privilégiez le générateur visuel.

## Thèmes

Utilisez le bouton soleil/lune dans la barre supérieure pour basculer entre les thèmes sombre et clair. Votre choix est mémorisé dans le navigateur.

![Dashboard](dashboard.png)
