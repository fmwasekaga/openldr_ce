import type { EnShape } from './en';

export const fr: EnShape = {
  common: {
    delete: 'Supprimer',
    save: 'Enregistrer',
    cancel: 'Annuler',
    create: 'Créer',
    loading: 'Chargement…',
    actions: 'Actions',
    saving: 'Enregistrement…',
    signIn: 'Se connecter',
    signOut: 'Se déconnecter',
    signingIn: 'Connexion…',
    callbackError: 'Échec de la connexion. Veuillez réessayer.',
    configUnreachable: 'Impossible de joindre le serveur. Veuillez recharger.',
    previous: 'Précédent',
    next: 'Suivant',
  },
  table: {
    filter: 'Filtrer',
    sort: 'Trier',
    columns: 'Colonnes',
    reset: 'Réinitialiser',
    resetToDefaults: 'Réinitialiser par défaut',
    where: 'Où',
    and: 'ET',
    or: 'OU',
    apply: 'Appliquer',
    clear: 'Effacer',
    clearAll: 'Tout effacer',
    addFilter: 'Ajouter un filtre',
    addSort: 'Ajouter un tri',
    noFilters: 'Aucun filtre appliqué.',
    noSorts: 'Aucun tri appliqué.',
    allColumnsSorted: 'Toutes les colonnes sont triées.',
    ascending: 'Croissant',
    descending: 'Décroissant',
    asc: 'Croiss.',
    desc: 'Décroiss.',
    pickRange: 'Choisir une plage',
    pickDate: 'Choisir une date',
    pickValue: 'Choisir une valeur',
    from: 'De',
    to: 'À',
    commaSeparated: 'Séparé par des virgules',
    enterValue: 'Saisir une valeur',
    operators: {
      eq: 'Égal à',
      ne: 'Différent de',
      like: 'Contient',
      gt: 'Supérieur à',
      gte: 'Au moins',
      lt: 'Inférieur à',
      lte: 'Au plus',
      between: 'Entre',
      in: 'Dans la liste',
      is_null: 'Est vide',
      is_not_null: "N'est pas vide",
    },
  },
  users: {
    searchPlaceholder: "Rechercher un nom d'utilisateur ou un nom complet",
    username: "Nom d'utilisateur",
    fullName: 'Nom complet',
    email: 'E-mail',
    roles: 'Rôles',
    status: 'Statut',
    created: 'Créé',
    lastLogin: 'Dernière connexion',
    statusActive: 'Actif',
    statusDisabled: 'Désactivé',
    count: '{{count}} utilisateurs',
    newUser: 'Nouvel utilisateur',
    refresh: 'Actualiser',
    edit: 'Modifier',
    disable: 'Désactiver',
    enable: 'Activer',
    selfSuffix: 'vous',
    noUsers: 'Aucun utilisateur.',
    noMatch: 'Aucun utilisateur ne correspond.',
    savedToast: '{{username}} enregistré',
    enabledToast: '{{username}} activé',
    disabledToast: '{{username}} désactivé',
    errorToast: "L'action a échoué : {{error}}",
    disableTitle: 'Désactiver {{username}} ?',
    disableDescription: 'Il/elle ne pourra plus se connecter.',
    enableTitle: 'Activer {{username}} ?',
    enableDescription: 'Il/elle pourra se connecter à nouveau.',
    editUserTitle: "Modifier l'utilisateur",
    newUserTitle: 'Nouvel utilisateur',
    editUserDesc: 'Mettre à jour le profil, les rôles et le statut.',
    newUserDesc: 'Créer un compte opérateur local.',
    noUsersForm:
      'Aucun formulaire Utilisateurs publié trouvé. Créez un formulaire Utilisateurs dans le Générateur de formulaires.',
    firstName: 'Prénom',
    lastName: 'Nom de famille',
    resetPassword: 'Réinitialiser le mot de passe',
    sendResetEmail: 'Envoyer un e-mail de réinitialisation',
    forceSignOut: 'Forcer la déconnexion',
    noProviderAccount: 'aucun compte lié',
    resetPasswordTitle: 'Réinitialiser le mot de passe',
    resetPasswordDescription: 'Définir un nouveau mot de passe pour {{username}}.',
    newPassword: 'Nouveau mot de passe',
    newPasswordPlaceholder: 'Saisir un nouveau mot de passe',
    confirmPassword: 'Confirmer le mot de passe',
    copyPassword: 'Copier le mot de passe',
    resetPasswordHint:
      'Partagez ce mot de passe temporaire de manière sécurisée ; l\'utilisateur doit le modifier à sa prochaine connexion.',
    resetPasswordButton: 'Réinitialiser le mot de passe',
    passwordRequired: 'Le mot de passe est requis.',
    passwordMismatch: 'Les mots de passe ne correspondent pas.',
    resetPasswordSavedToast: 'Mot de passe réinitialisé pour {{username}}',
    sendResetEmailToast: 'E-mail de réinitialisation envoyé à {{username}}',
    forceSignOutTitle: 'Forcer la déconnexion de {{username}} ?',
    forceSignOutDescription: 'Toutes leurs sessions actives seront terminées.',
    forceSignOutToast: 'Toutes les sessions déconnectées pour {{username}}',
    roleNames: {
      lab_admin: 'Admin laboratoire',
      lab_manager: 'Responsable laboratoire',
      lab_technician: 'Technicien de laboratoire',
      data_analyst: 'Analyste de données',
      system_auditor: 'Auditeur système',
    },
  },
  dhis2: {
    title: 'DHIS2',
    connection: 'Connexion',
    configured: 'Configuré',
    notConfigured: 'Non configuré',
    syncEnabled: 'Synchronisation activée',
    syncDisabled: 'Synchronisation désactivée',
    host: 'Hôte',
    reachability: 'Accessibilité',
    up: 'Accessible',
    down: 'Inaccessible',
    degraded: 'Dégradé',
    notConfiguredHelp:
      'Définissez REPORTING_TARGET_ADAPTER=dhis2 et DHIS2_BASE_URL / DHIS2_USERNAME / DHIS2_PASSWORD dans l\'environnement serveur pour activer DHIS2.',
    metadata: 'Métadonnées',
    pullMetadata: 'Récupérer les métadonnées',
    pulling: 'Récupération…',
    dataElements: 'Éléments de données', // review
    orgUnits: 'Unités d\'organisation', // review
    categoryOptionCombos: 'Combos d\'options de catégorie', // review
    programs: 'Programmes',
    programStages: 'Étapes de programme', // review
    overview: 'Vue d\'ensemble',
    mappingsCount: 'Mappings', // review
    orgUnitMappings: 'Mappings d\'OrgUnit', // review
    schedules: 'Planifications',
    recentPushes: 'Envois récents', // review
    noPushes: 'Aucun envoi pour l\'instant.', // review
    when: 'Quand',
    action: 'Action',
    mapping: 'Mapping', // review
    orgunits: {
      heading: 'OrgUnits DHIS2', // review
      title: 'Mappings Établissement → OrgUnit', // review
      manage: 'Gérer →',
      facility: 'Établissement',
      orgUnit: 'OrgUnit DHIS2', // review
      unmapped: 'Non mappé', // review
      pick: 'Choisir un OrgUnit…', // review
      search: 'Rechercher des OrgUnits', // review
      clear: 'Effacer',
      pulledAt: 'Catalogue d\'OrgUnit récupéré {{when}}', // review
      neverPulled:
        'Aucun catalogue d\'OrgUnit — récupérez d\'abord les métadonnées depuis les paramètres DHIS2.', // review
      noFacilities: 'Aucun établissement.',
      mappedToast: '{{facility}} mappé', // review
      clearedToast: 'Mapping effacé pour {{facility}}', // review
      errorToast: 'Échec : {{error}}',
    },
    mappings: {
      heading: 'Mappings DHIS2', // review
      title: 'Mappings DHIS2', // review
      manage: 'Gérer →',
      newMapping: 'Nouveau mapping', // review
      name: 'Nom',
      kind: 'Type',
      edit: 'Modifier',
      delete: 'Supprimer',
      deleteTitle: 'Supprimer le mapping {{name}} ?', // review
      deleteDescription: 'Ceci supprime le mapping. Cette action est irréversible.', // review
      none: 'Aucun mapping pour l\'instant.', // review
      deletedToast: '{{name}} supprimé',
      errorToast: 'Échec : {{error}}',
      editor: {
        newTitle: 'Nouveau mapping agrégé', // review
        editTitle: 'Modifier le mapping agrégé', // review
        mappingName: 'Nom du mapping', // review
        sourceReport: 'Rapport source',
        pickReport: 'Choisir un rapport…',
        orgUnitColumn: 'Colonne OrgUnit', // review
        periodColumn: 'Colonne de période (optionnel)',
        pickColumn: 'Choisir une colonne…',
        columns: 'Colonne → élément de données', // review
        reportColumn: 'Colonne du rapport',
        dataElement: 'Élément de données', // review
        coc: 'Combo d\'option de catégorie (optionnel)', // review
        addColumn: 'Ajouter une colonne',
        remove: 'Supprimer',
        validate: 'Valider',
        noProblems: 'Aucun problème.',
        save: 'Enregistrer',
        cancel: 'Annuler',
        savedToast: '{{name}} enregistré',
        noMetadata:
          'Aucune métadonnée DHIS2 en cache — récupérez les métadonnées depuis les paramètres DHIS2 pour activer les sélecteurs d\'éléments de données.', // review
        notFound: 'Mapping introuvable.', // review
        kindLabel: 'Type de mapping', // review
        kindAggregate: 'Agrégé', // review
        kindTracker: 'Tracker', // review
        tracker: {
          sourceEventSource: 'Source d\'événement source', // review
          pickEventSource: 'Choisir une source d\'événement…', // review
          program: 'Programme',
          pickProgram: 'Choisir un programme…',
          programStage: 'Étape de programme', // review
          pickStage: 'Choisir une étape…',
          orgUnitColumn: 'Colonne OrgUnit', // review
          eventDateColumn: 'Colonne de date d\'événement', // review
          idColumn: 'Colonne ID',
          pickColumn: 'Choisir une colonne…',
          dataValues: 'Colonne → élément de données', // review
          eventColumn: 'Colonne source d\'événement', // review
          dataElement: 'Élément de données', // review
          addRow: 'Ajouter une ligne',
          remove: 'Supprimer',
        },
      },
    },
    ops: {
      schedulesHeading: 'Planifications DHIS2',
      pushesHeading: 'Historique des envois DHIS2', // review
      run: 'Exécuter',
      runTitle: 'Exécuter {{name}}',
      period: 'Période',
      periodHint: 'mensuel 202601 · trimestriel 2026T1 · annuel 2026',
      dryRun: 'Simulation', // review
      push: 'Envoyer', // review
      close: 'Fermer',
      values: 'Valeurs',
      skippedRows: 'Lignes ignorées',
      pushResult: 'Résultat de l\'envoi', // review
      imported: 'Importé',
      updated: 'Mis à jour',
      ignored: 'Ignoré',
      conflicts: 'Conflits',
      notConfigured:
        'DHIS2 n\'est pas configuré — configurez-le dans les paramètres DHIS2 pour exécuter des mappings.', // review
      schedules: 'Planifications',
      schedulesManage: 'Gérer →',
      scheduleTitle: 'Planifications DHIS2',
      newSchedule: 'Nouvelle planification',
      mapping: 'Mapping', // review
      periodType: 'Type de période',
      eventDriven: 'Piloté par événement', // review
      enabled: 'Activé',
      lastRun: 'Dernière exécution',
      nextDue: 'Prochaine échéance',
      create: 'Créer',
      delete: 'Supprimer',
      deleteScheduleTitle: 'Supprimer la planification ?',
      deleteScheduleDesc: 'Ceci supprime la planification.',
      noSchedules: 'Aucune planification pour l\'instant.',
      syncNote: 'Les planifications s\'exécutent uniquement si le serveur a DHIS2_SYNC_ENABLED.',
      pushesTitle: 'Historique des envois DHIS2', // review
      viewAll: 'Tout voir →',
      when: 'Quand',
      action: 'Action',
      status: 'Statut',
      noPushes: 'Aucun envoi pour l\'instant.', // review
      errorToast: 'Échec : {{error}}',
    },
  },
  settings: {
    title: 'Paramètres',
    subNav: {
      dhis2: 'DHIS2',
      marketplace: 'Marketplace',
    },
    marketplace: {
      heading: 'Marketplace',
      available: 'Disponible',
      installed: 'Installé',
      filterPlaceholder: 'Filtrer…',
      type: 'Type',
      publisher: 'Éditeur',
      version: 'Version',
      install: 'Installer',
      verified: 'Vérifié',
      firstUse: 'Nouvel éditeur',
      invalid: 'Signature invalide', // review
      notConfigured: 'Aucun registre marketplace configuré (définir MARKETPLACE_REGISTRY_DIR).',
      consentTitle: 'Vérifier et approuver : {{id}}',
      requestedCapabilities: 'Capacités demandées',
      approveInstall: 'Approuver et installer',
      cancel: 'Annuler',
      enable: 'Activer',
      disable: 'Désactiver',
      rollback: 'Revenir en arrière',
      remove: 'Supprimer',
      active: 'Actif',
      enabledLabel: 'Activé',
      approvedBy: 'Approuvé par',
      installPluginOnly: 'Seuls les artefacts de plugin peuvent être installés pour l\'instant.',
      removeTitle: 'Supprimer {{id}} ?',
      removeDescription: 'Ceci désinstalle l\'artefact de ce déploiement.',
      installedToast: '{{id}} installé',
      errorToast: 'Erreur marketplace : {{error}}',
    },
  },
  layout: {
    settings: 'Paramètres',
    language: 'Langue',
  },
  reports: {
    searchPlaceholder: 'Rechercher des rapports…',
    pinned: 'Épinglés',
    selectReport: 'Sélectionnez un rapport dans la bibliothèque.',
    runReport: 'Exécutez le rapport pour voir les résultats.',
    running: 'Exécution…',
    run: 'Exécuter',
    runHistory: 'Historique',
    schedules: 'Planifications',
    comingSoon: 'Bientôt disponible',
    tabDocument: 'Document',
    tabSpreadsheet: 'Tableur',
    runMeta: '{{count}} lignes · {{time}}',
    all: 'Tous',
    download: 'Télécharger',
    exportCsv: 'Exporter CSV',
    exportXlsx: 'Exporter XLSX',
    pdfRenderError: 'Impossible d’afficher le PDF.',
    noData: 'Aucune donnée pour les filtres sélectionnés.',
    categories: {
      amr: 'RAM / Surveillance',
      operational: 'Opérationnel',
      quality: 'Qualité',
      regulatory: 'Réglementaire',
    },
    history: {
      title: 'Historique',
      empty: 'Aucune exécution enregistrée.',
      colFormat: 'Format',
      colRows: 'Lignes',
      colUser: 'Utilisateur',
      colWhen: 'Quand',
      loadError: 'Impossible de charger l’historique.',
    },
    scheduling: {
      title: 'Planifications', new: 'Nouvelle planification', frequency: 'Fréquence',
      daily: 'Quotidien', weekly: 'Hebdomadaire', monthly: 'Mensuel', quarterly: 'Trimestriel',
      dayOfWeek: 'Jour de la semaine', dayOfMonth: 'Jour du mois', outputFormat: 'Format de sortie',
      dateWindowAuto: 'Période : automatique (période précédente)',
      runNow: 'Exécuter', edit: 'Modifier', delete: 'Supprimer',
      queued: 'Exécution lancée — elle apparaîtra bientôt dans les exécutions planifiées.',
      saved: 'Planification enregistrée.', deleted: 'Planification supprimée.',
      deleteConfirm: 'Supprimer cette planification ?',
      nextRun: 'Prochaine', lastRun: 'Dernière', empty: 'Aucune planification.',
      saveError: 'Impossible d’enregistrer la planification.', loadError: 'Impossible de charger les planifications.',
      save: 'Enregistrer', cancel: 'Annuler', activity: 'Activité', scheduledRuns: 'Exécutions planifiées',
      colStatus: 'Statut', colPeriod: 'Période', statusSuccess: 'OK', statusFailed: 'Échec',
      runsLoadError: 'Impossible de charger les exécutions planifiées.', noRuns: 'Aucune exécution planifiée.',
      download: 'Télécharger',
    },
  },
  nav: {
    dashboard: 'Tableau de bord',
    reports: 'Rapports',
    terminology: 'Terminologie',
    forms: 'Formulaires',
    users: 'Utilisateurs',
    audit: 'Audit',
    docs: 'Documentation',
  },
  a11y: {
    expandSidebar: 'Développer la barre latérale',
    collapseSidebar: 'Réduire la barre latérale',
    switchToLight: 'Passer en mode clair',
    switchToDark: 'Passer en mode sombre',
    lightMode: 'Mode clair',
    darkMode: 'Mode sombre',
  },
} as const;
