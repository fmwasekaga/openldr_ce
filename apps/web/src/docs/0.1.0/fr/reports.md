# Rapports & AMR/GLASS

OpenLDR fournit un catalogue de rapports paramétrés sur les tables aplaties de l'entrepôt.

## Rapports disponibles

- **Taux de résistance AMR** — pourcentage de résistance (%R) par antibiotique, dédupliqué sur le premier isolat.
- **Antibiogramme** — matrice de sensibilité par micro-organisme et antibiotique.
- **Volume de tests** — demandes par test et par mois.
- **Délai de rendu** — heures entre le prélèvement et le compte-rendu.
- **Données démographiques des patients** — effectifs par sexe et tranche d'âge.

## Export

Chaque rapport peut être exporté en **CSV** depuis sa page de détail. Les rapports AMR sont également disponibles en **PDF**. Le fichier **RIS** WHO GLASS est accessible depuis la route d'export GLASS.

![AMR report](report-amr.png)

## Paramètres

Les rapports acceptent une fenêtre de dates (`from`/`to`, inclusive) et un filtre optionnel par établissement via la barre de paramètres.
