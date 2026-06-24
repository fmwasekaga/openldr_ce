import { getOpenldr } from './sdk';

/**
 * Plugin-owned i18n for the DHIS2 webview (SP-A2 Task 12b).
 *
 * The plugin SPA carries its OWN en/fr/pt bundles so it stays self-contained — a
 * later task DELETES the host's DHIS2 fr/pt strings, so the plugin must not depend
 * on them. `en` strings are byte-identical to the literals that used to be inlined
 * in the screens/shell/Picker (the screen tests render under the default `'en'`
 * locale and assert those exact strings).
 *
 * Bundles are flat dot-notation dictionaries with an identical key set across all
 * three locales (enforced by i18n.test.ts). `t(key, vars?)` resolves against the
 * current locale, falling back to `en` for a missing key/locale, and supports
 * simple `{name}` interpolation.
 */

export type Locale = 'en' | 'fr' | 'pt';

type Bundle = Record<string, string>;

const en: Bundle = {
  // Shell / nav
  'nav.dashboard': 'Dashboard',
  'nav.mappings': 'Mappings',
  'nav.schedules': 'Schedules',
  'nav.orgUnits': 'Org Units',
  'nav.pushes': 'Pushes',

  // Shared
  'common.loading': 'Loading…',

  // Picker / Modal defaults
  'picker.select': 'Select…',
  'picker.search': 'Search…',
  'picker.noMatches': 'No matches',
  'modal.close': 'Close',

  // Dashboard
  'dashboard.title': 'DHIS2',
  'dashboard.activeConnector': 'Active connector',
  'dashboard.configured': 'Configured',
  'dashboard.notConfigured': 'Not configured',
  'dashboard.name': 'Name',
  'dashboard.host': 'Host',
  'dashboard.noConnector':
    'No connector is configured. Add one in Settings ▸ Connectors before pushing to DHIS2.',
  'dashboard.metadata': 'Metadata',
  'dashboard.pulling': 'Pulling…',
  'dashboard.pullMetadata': 'Pull metadata',
  'dashboard.dataElements': 'Data elements',
  'dashboard.orgUnits': 'Org units',
  'dashboard.categoryOptionCombos': 'Category option combos',
  'dashboard.programs': 'Programs',
  'dashboard.programStages': 'Program stages',
  'dashboard.noMetadata': 'No metadata cached yet. Pull to populate the counts.',
  'dashboard.overview': 'Overview',
  'dashboard.mappings': 'Mappings: ',
  'dashboard.orgUnitMappings': 'Org-unit mappings: ',
  'dashboard.schedules': 'Schedules: ',
  'dashboard.manage': 'Manage',
  'dashboard.recentPushes': 'Recent pushes',
  'dashboard.viewAll': 'View all',
  'dashboard.noPushes': 'No pushes yet',
  'dashboard.when': 'When',
  'dashboard.status': 'Status',
  'dashboard.kindPeriod': 'Kind / Period',

  // Mappings list + run
  'mappings.title': 'Mappings',
  'mappings.newMapping': 'New mapping',
  'mappings.subtitle': 'Mappings turn report rows into DHIS2 data values or tracker events.',
  'mappings.name': 'Name',
  'mappings.kind': 'Kind',
  'mappings.none': 'No mappings yet.',
  'mappings.run': 'Run',
  'mappings.edit': 'Edit',
  'mappings.delete': 'Delete',
  'mappings.deletedToast': 'Deleted {name}',
  'mappings.deleteTitle': 'Delete {name}?',
  'mappings.deleteBody': 'This mapping will be removed. This cannot be undone.',
  'mappings.cancel': 'Cancel',
  'mappings.runTitle': 'Run {name}',
  'mappings.period': 'Period',
  'mappings.periodPlaceholder': 'e.g. 202401',
  'mappings.dryRun': 'Dry run',
  'mappings.push': 'Push',
  'mappings.values': 'Values: ',
  'mappings.skipped': ' · Skipped: ',
  'mappings.rowReason': 'row {row}: {reason}',
  'mappings.pushResult': 'Push result: ',
  'mappings.pushResultDetail':
    ' — imported {imported} · updated {updated} · ignored {ignored} · conflicts {conflicts}',

  // Schedules
  'schedules.title': 'Schedules',
  'schedules.subtitle':
    'Schedules run mappings on a recurring period; event-driven ones also fire on new data.',
  'schedules.mapping': 'Mapping',
  'schedules.pickMapping': 'Pick a mapping',
  'schedules.searchMappings': 'Search mappings…',
  'schedules.period': 'Period',
  'schedules.monthly': 'monthly',
  'schedules.quarterly': 'quarterly',
  'schedules.yearly': 'yearly',
  'schedules.eventDriven': 'Event-driven',
  'schedules.create': 'Create',
  'schedules.enabled': 'Enabled',
  'schedules.nextDue': 'Next due',
  'schedules.none': 'No schedules yet.',
  'schedules.on': 'on',
  'schedules.off': 'off',
  'schedules.disable': 'Disable',
  'schedules.enable': 'Enable',
  'schedules.delete': 'Delete',
  'schedules.deleteTitle': 'Delete this schedule?',
  'schedules.deleteBody': '{mapping} will stop running. This cannot be undone.',
  'schedules.cancel': 'Cancel',

  // Org units
  'orgUnits.title': 'Org-unit mapping',
  'orgUnits.pulledAt': 'Metadata pulled at {when}',
  'orgUnits.neverPulled': 'Metadata never pulled',
  'orgUnits.facility': 'Facility',
  'orgUnits.orgUnit': 'Org unit',
  'orgUnits.noFacilities': 'No facilities found.',
  'orgUnits.unmapped': 'Unmapped',
  'orgUnits.pickOrgUnit': 'Pick an org unit',
  'orgUnits.searchOrgUnits': 'Search org units…',
  'orgUnits.clear': 'Clear',
  'orgUnits.mappedToast': 'Mapped {facility}',
  'orgUnits.clearedToast': 'Cleared {facility}',

  // Pushes
  'pushes.title': 'Push history',
  'pushes.noPushes': 'No pushes yet',
  'pushes.when': 'When',
  'pushes.kind': 'Kind',
  'pushes.period': 'Period',
  'pushes.status': 'Status',
  'pushes.result': 'Result',
  'pushes.trigger': 'Trigger',

  // Mapping editor
  'editor.newTitle': 'New mapping',
  'editor.editTitle': 'Edit mapping',
  'editor.notFound': 'That mapping no longer exists.',
  'editor.noMetadata': 'No DHIS2 metadata cached yet. Pull metadata before you can pick data elements.',
  'editor.kindLabel': 'Mapping kind',
  'editor.kindAggregate': 'Aggregate',
  'editor.kindTracker': 'Tracker',
  'editor.name': 'Name',
  'editor.connector': 'Connector',
  'editor.pickConnector': 'Pick a connector',
  'editor.searchConnectors': 'Search connectors…',
  'editor.noConnectors': 'No enabled connectors. Add one in Connectors first.',
  'editor.sourceReport': 'Source report',
  'editor.pickReport': 'Pick a report',
  'editor.searchReports': 'Search reports…',
  'editor.orgUnitColumn': 'Org-unit column',
  'editor.periodColumn': 'Period column',
  'editor.pickColumn': 'Pick a column',
  'editor.columns': 'Columns',
  'editor.addColumn': 'Add column',
  'editor.reportColumn': 'Report column',
  'editor.dataElement': 'Data element',
  'editor.coc': 'Category option combo',
  'editor.remove': 'Remove',
  'editor.sourceEventSource': 'Source event source',
  'editor.pickEventSource': 'Pick an event source',
  'editor.searchEventSources': 'Search event sources…',
  'editor.program': 'Program',
  'editor.pickProgram': 'Pick a program',
  'editor.programStage': 'Program stage',
  'editor.pickStage': 'Pick a stage',
  'editor.eventDateColumn': 'Event-date column',
  'editor.idColumn': 'Id column',
  'editor.dataValues': 'Data values',
  'editor.addRow': 'Add row',
  'editor.eventColumn': 'Event column',
  'editor.noProblems': 'No problems.',
  'editor.validate': 'Validate',
  'editor.validateTitle': 'Select a connector to validate',
  'editor.save': 'Save',
  'editor.cancel': 'Cancel',
};

const fr: Bundle = {
  // Shell / nav
  'nav.dashboard': 'Tableau de bord',
  'nav.mappings': 'Mappings',
  'nav.schedules': 'Planifications',
  'nav.orgUnits': 'Unités d\'organisation',
  'nav.pushes': 'Envois',

  // Shared
  'common.loading': 'Chargement…',

  // Picker / Modal defaults
  'picker.select': 'Sélectionner…',
  'picker.search': 'Rechercher…',
  'picker.noMatches': 'Aucune correspondance',
  'modal.close': 'Fermer',

  // Dashboard
  'dashboard.title': 'DHIS2',
  'dashboard.activeConnector': 'Connecteur actif',
  'dashboard.configured': 'Configuré',
  'dashboard.notConfigured': 'Non configuré',
  'dashboard.name': 'Nom',
  'dashboard.host': 'Hôte',
  'dashboard.noConnector':
    'Aucun connecteur configuré. Ajoutez-en un dans Paramètres ▸ Connecteurs avant d\'envoyer vers DHIS2.',
  'dashboard.metadata': 'Métadonnées',
  'dashboard.pulling': 'Récupération…',
  'dashboard.pullMetadata': 'Récupérer les métadonnées',
  'dashboard.dataElements': 'Éléments de données',
  'dashboard.orgUnits': 'Unités d\'organisation',
  'dashboard.categoryOptionCombos': 'Combos d\'options de catégorie',
  'dashboard.programs': 'Programmes',
  'dashboard.programStages': 'Étapes de programme',
  'dashboard.noMetadata': 'Aucune métadonnée en cache. Récupérez pour renseigner les compteurs.',
  'dashboard.overview': 'Vue d\'ensemble',
  'dashboard.mappings': 'Mappings : ',
  'dashboard.orgUnitMappings': 'Mappings d\'unités d\'organisation : ',
  'dashboard.schedules': 'Planifications : ',
  'dashboard.manage': 'Gérer',
  'dashboard.recentPushes': 'Envois récents',
  'dashboard.viewAll': 'Tout voir',
  'dashboard.noPushes': 'Aucun envoi pour l\'instant',
  'dashboard.when': 'Quand',
  'dashboard.status': 'Statut',
  'dashboard.kindPeriod': 'Type / Période',

  // Mappings list + run
  'mappings.title': 'Mappings',
  'mappings.newMapping': 'Nouveau mapping',
  'mappings.subtitle':
    'Les mappings transforment les lignes de rapport en valeurs de données DHIS2 ou en événements tracker.',
  'mappings.name': 'Nom',
  'mappings.kind': 'Type',
  'mappings.none': 'Aucun mapping pour l\'instant.',
  'mappings.run': 'Exécuter',
  'mappings.edit': 'Modifier',
  'mappings.delete': 'Supprimer',
  'mappings.deletedToast': '{name} supprimé',
  'mappings.deleteTitle': 'Supprimer {name} ?',
  'mappings.deleteBody': 'Ce mapping sera supprimé. Cette action est irréversible.',
  'mappings.cancel': 'Annuler',
  'mappings.runTitle': 'Exécuter {name}',
  'mappings.period': 'Période',
  'mappings.periodPlaceholder': 'ex. 202401',
  'mappings.dryRun': 'Simulation',
  'mappings.push': 'Envoyer',
  'mappings.values': 'Valeurs : ',
  'mappings.skipped': ' · Ignorées : ',
  'mappings.rowReason': 'ligne {row} : {reason}',
  'mappings.pushResult': 'Résultat de l\'envoi : ',
  'mappings.pushResultDetail':
    ' — importé {imported} · mis à jour {updated} · ignoré {ignored} · conflits {conflicts}',

  // Schedules
  'schedules.title': 'Planifications',
  'schedules.subtitle':
    'Les planifications exécutent les mappings selon une période récurrente ; celles pilotées par événement se déclenchent aussi sur de nouvelles données.',
  'schedules.mapping': 'Mapping',
  'schedules.pickMapping': 'Choisir un mapping',
  'schedules.searchMappings': 'Rechercher des mappings…',
  'schedules.period': 'Période',
  'schedules.monthly': 'mensuel',
  'schedules.quarterly': 'trimestriel',
  'schedules.yearly': 'annuel',
  'schedules.eventDriven': 'Piloté par événement',
  'schedules.create': 'Créer',
  'schedules.enabled': 'Activé',
  'schedules.nextDue': 'Prochaine échéance',
  'schedules.none': 'Aucune planification pour l\'instant.',
  'schedules.on': 'activé',
  'schedules.off': 'désactivé',
  'schedules.disable': 'Désactiver',
  'schedules.enable': 'Activer',
  'schedules.delete': 'Supprimer',
  'schedules.deleteTitle': 'Supprimer cette planification ?',
  'schedules.deleteBody': '{mapping} cessera de s\'exécuter. Cette action est irréversible.',
  'schedules.cancel': 'Annuler',

  // Org units
  'orgUnits.title': 'Mapping d\'unités d\'organisation',
  'orgUnits.pulledAt': 'Métadonnées récupérées le {when}',
  'orgUnits.neverPulled': 'Métadonnées jamais récupérées',
  'orgUnits.facility': 'Établissement',
  'orgUnits.orgUnit': 'Unité d\'organisation',
  'orgUnits.noFacilities': 'Aucun établissement trouvé.',
  'orgUnits.unmapped': 'Non mappé',
  'orgUnits.pickOrgUnit': 'Choisir une unité d\'organisation',
  'orgUnits.searchOrgUnits': 'Rechercher des unités d\'organisation…',
  'orgUnits.clear': 'Effacer',
  'orgUnits.mappedToast': '{facility} mappé',
  'orgUnits.clearedToast': '{facility} effacé',

  // Pushes
  'pushes.title': 'Historique des envois',
  'pushes.noPushes': 'Aucun envoi pour l\'instant',
  'pushes.when': 'Quand',
  'pushes.kind': 'Type',
  'pushes.period': 'Période',
  'pushes.status': 'Statut',
  'pushes.result': 'Résultat',
  'pushes.trigger': 'Déclencheur',

  // Mapping editor
  'editor.newTitle': 'Nouveau mapping',
  'editor.editTitle': 'Modifier le mapping',
  'editor.notFound': 'Ce mapping n\'existe plus.',
  'editor.noMetadata':
    'Aucune métadonnée DHIS2 en cache. Récupérez les métadonnées avant de pouvoir choisir des éléments de données.',
  'editor.kindLabel': 'Type de mapping',
  'editor.kindAggregate': 'Agrégé',
  'editor.kindTracker': 'Tracker',
  'editor.name': 'Nom',
  'editor.connector': 'Connecteur',
  'editor.pickConnector': 'Choisir un connecteur',
  'editor.searchConnectors': 'Rechercher des connecteurs…',
  'editor.noConnectors': 'Aucun connecteur activé. Ajoutez-en un dans Connecteurs d\'abord.',
  'editor.sourceReport': 'Rapport source',
  'editor.pickReport': 'Choisir un rapport',
  'editor.searchReports': 'Rechercher des rapports…',
  'editor.orgUnitColumn': 'Colonne d\'unité d\'organisation',
  'editor.periodColumn': 'Colonne de période',
  'editor.pickColumn': 'Choisir une colonne',
  'editor.columns': 'Colonnes',
  'editor.addColumn': 'Ajouter une colonne',
  'editor.reportColumn': 'Colonne du rapport',
  'editor.dataElement': 'Élément de données',
  'editor.coc': 'Combo d\'option de catégorie',
  'editor.remove': 'Supprimer',
  'editor.sourceEventSource': 'Source d\'événement source',
  'editor.pickEventSource': 'Choisir une source d\'événement',
  'editor.searchEventSources': 'Rechercher des sources d\'événement…',
  'editor.program': 'Programme',
  'editor.pickProgram': 'Choisir un programme',
  'editor.programStage': 'Étape de programme',
  'editor.pickStage': 'Choisir une étape',
  'editor.eventDateColumn': 'Colonne de date d\'événement',
  'editor.idColumn': 'Colonne ID',
  'editor.dataValues': 'Valeurs de données',
  'editor.addRow': 'Ajouter une ligne',
  'editor.eventColumn': 'Colonne d\'événement',
  'editor.noProblems': 'Aucun problème.',
  'editor.validate': 'Valider',
  'editor.validateTitle': 'Sélectionnez un connecteur pour valider',
  'editor.save': 'Enregistrer',
  'editor.cancel': 'Annuler',
};

const pt: Bundle = {
  // Shell / nav
  'nav.dashboard': 'Painel',
  'nav.mappings': 'Mapeamentos',
  'nav.schedules': 'Agendamentos',
  'nav.orgUnits': 'Unidades organizacionais',
  'nav.pushes': 'Envios',

  // Shared
  'common.loading': 'A carregar…',

  // Picker / Modal defaults
  'picker.select': 'Selecionar…',
  'picker.search': 'Pesquisar…',
  'picker.noMatches': 'Sem correspondências',
  'modal.close': 'Fechar',

  // Dashboard
  'dashboard.title': 'DHIS2',
  'dashboard.activeConnector': 'Conector ativo',
  'dashboard.configured': 'Configurado',
  'dashboard.notConfigured': 'Não configurado',
  'dashboard.name': 'Nome',
  'dashboard.host': 'Anfitrião',
  'dashboard.noConnector':
    'Nenhum conector configurado. Adicione um em Configurações ▸ Conectores antes de enviar para o DHIS2.',
  'dashboard.metadata': 'Metadados',
  'dashboard.pulling': 'A obter…',
  'dashboard.pullMetadata': 'Obter metadados',
  'dashboard.dataElements': 'Elementos de dados',
  'dashboard.orgUnits': 'Unidades organizacionais',
  'dashboard.categoryOptionCombos': 'Combinações de opções de categoria',
  'dashboard.programs': 'Programas',
  'dashboard.programStages': 'Etapas do programa',
  'dashboard.noMetadata': 'Nenhum metadado em cache. Obtenha para preencher os contadores.',
  'dashboard.overview': 'Visão geral',
  'dashboard.mappings': 'Mapeamentos: ',
  'dashboard.orgUnitMappings': 'Mapeamentos de unidades organizacionais: ',
  'dashboard.schedules': 'Agendamentos: ',
  'dashboard.manage': 'Gerir',
  'dashboard.recentPushes': 'Envios recentes',
  'dashboard.viewAll': 'Ver tudo',
  'dashboard.noPushes': 'Nenhum envio ainda',
  'dashboard.when': 'Quando',
  'dashboard.status': 'Estado',
  'dashboard.kindPeriod': 'Tipo / Período',

  // Mappings list + run
  'mappings.title': 'Mapeamentos',
  'mappings.newMapping': 'Novo mapeamento',
  'mappings.subtitle':
    'Os mapeamentos transformam linhas de relatório em valores de dados DHIS2 ou eventos tracker.',
  'mappings.name': 'Nome',
  'mappings.kind': 'Tipo',
  'mappings.none': 'Nenhum mapeamento ainda.',
  'mappings.run': 'Executar',
  'mappings.edit': 'Editar',
  'mappings.delete': 'Eliminar',
  'mappings.deletedToast': '{name} eliminado',
  'mappings.deleteTitle': 'Eliminar {name}?',
  'mappings.deleteBody': 'Este mapeamento será removido. Não pode ser desfeito.',
  'mappings.cancel': 'Cancelar',
  'mappings.runTitle': 'Executar {name}',
  'mappings.period': 'Período',
  'mappings.periodPlaceholder': 'ex. 202401',
  'mappings.dryRun': 'Simulação',
  'mappings.push': 'Enviar',
  'mappings.values': 'Valores: ',
  'mappings.skipped': ' · Ignoradas: ',
  'mappings.rowReason': 'linha {row}: {reason}',
  'mappings.pushResult': 'Resultado do envio: ',
  'mappings.pushResultDetail':
    ' — importado {imported} · atualizado {updated} · ignorado {ignored} · conflitos {conflicts}',

  // Schedules
  'schedules.title': 'Agendamentos',
  'schedules.subtitle':
    'Os agendamentos executam mapeamentos num período recorrente; os orientados por eventos também disparam com novos dados.',
  'schedules.mapping': 'Mapeamento',
  'schedules.pickMapping': 'Escolher um mapeamento',
  'schedules.searchMappings': 'Pesquisar mapeamentos…',
  'schedules.period': 'Período',
  'schedules.monthly': 'mensal',
  'schedules.quarterly': 'trimestral',
  'schedules.yearly': 'anual',
  'schedules.eventDriven': 'Orientado por eventos',
  'schedules.create': 'Criar',
  'schedules.enabled': 'Ativado',
  'schedules.nextDue': 'Próximo prazo',
  'schedules.none': 'Nenhum agendamento ainda.',
  'schedules.on': 'ativado',
  'schedules.off': 'desativado',
  'schedules.disable': 'Desativar',
  'schedules.enable': 'Ativar',
  'schedules.delete': 'Eliminar',
  'schedules.deleteTitle': 'Eliminar este agendamento?',
  'schedules.deleteBody': '{mapping} deixará de ser executado. Não pode ser desfeito.',
  'schedules.cancel': 'Cancelar',

  // Org units
  'orgUnits.title': 'Mapeamento de unidades organizacionais',
  'orgUnits.pulledAt': 'Metadados obtidos em {when}',
  'orgUnits.neverPulled': 'Metadados nunca obtidos',
  'orgUnits.facility': 'Estabelecimento',
  'orgUnits.orgUnit': 'Unidade organizacional',
  'orgUnits.noFacilities': 'Nenhum estabelecimento encontrado.',
  'orgUnits.unmapped': 'Sem mapeamento',
  'orgUnits.pickOrgUnit': 'Escolher uma unidade organizacional',
  'orgUnits.searchOrgUnits': 'Pesquisar unidades organizacionais…',
  'orgUnits.clear': 'Limpar',
  'orgUnits.mappedToast': '{facility} mapeado',
  'orgUnits.clearedToast': '{facility} limpo',

  // Pushes
  'pushes.title': 'Histórico de envios',
  'pushes.noPushes': 'Nenhum envio ainda',
  'pushes.when': 'Quando',
  'pushes.kind': 'Tipo',
  'pushes.period': 'Período',
  'pushes.status': 'Estado',
  'pushes.result': 'Resultado',
  'pushes.trigger': 'Desencadeador',

  // Mapping editor
  'editor.newTitle': 'Novo mapeamento',
  'editor.editTitle': 'Editar mapeamento',
  'editor.notFound': 'Este mapeamento já não existe.',
  'editor.noMetadata':
    'Nenhum metadado DHIS2 em cache. Obtenha os metadados antes de poder escolher elementos de dados.',
  'editor.kindLabel': 'Tipo de mapeamento',
  'editor.kindAggregate': 'Agregado',
  'editor.kindTracker': 'Tracker',
  'editor.name': 'Nome',
  'editor.connector': 'Conector',
  'editor.pickConnector': 'Escolher um conector',
  'editor.searchConnectors': 'Pesquisar conectores…',
  'editor.noConnectors': 'Nenhum conector ativado. Adicione um em Conectores primeiro.',
  'editor.sourceReport': 'Relatório de origem',
  'editor.pickReport': 'Escolher um relatório',
  'editor.searchReports': 'Pesquisar relatórios…',
  'editor.orgUnitColumn': 'Coluna de unidade organizacional',
  'editor.periodColumn': 'Coluna de período',
  'editor.pickColumn': 'Escolher uma coluna',
  'editor.columns': 'Colunas',
  'editor.addColumn': 'Adicionar coluna',
  'editor.reportColumn': 'Coluna do relatório',
  'editor.dataElement': 'Elemento de dados',
  'editor.coc': 'Combinação de opção de categoria',
  'editor.remove': 'Remover',
  'editor.sourceEventSource': 'Fonte de eventos de origem',
  'editor.pickEventSource': 'Escolher uma fonte de eventos',
  'editor.searchEventSources': 'Pesquisar fontes de eventos…',
  'editor.program': 'Programa',
  'editor.pickProgram': 'Escolher um programa',
  'editor.programStage': 'Etapa do programa',
  'editor.pickStage': 'Escolher uma etapa',
  'editor.eventDateColumn': 'Coluna de data do evento',
  'editor.idColumn': 'Coluna ID',
  'editor.dataValues': 'Valores de dados',
  'editor.addRow': 'Adicionar linha',
  'editor.eventColumn': 'Coluna de evento',
  'editor.noProblems': 'Sem problemas.',
  'editor.validate': 'Validar',
  'editor.validateTitle': 'Selecione um conector para validar',
  'editor.save': 'Guardar',
  'editor.cancel': 'Cancelar',
};

export const bundles: Record<Locale, Bundle> = { en, fr, pt };

/**
 * The iframe locale is fixed per session, so resolve it ONCE on first use. Any
 * value other than 'fr'/'pt' (including a missing/unknown locale) → 'en'.
 */
let resolved: Locale | null = null;

export function resolveLocale(): Locale {
  if (resolved) return resolved;
  let loc: string | undefined;
  try {
    loc = getOpenldr().locale;
  } catch {
    loc = undefined;
  }
  resolved = loc === 'fr' || loc === 'pt' ? loc : 'en';
  return resolved;
}

/** Test-only reset so each test can pick a fresh locale from its own mock. */
export function resetLocale(): void {
  resolved = null;
}

/**
 * Resolve `key` against the current locale's bundle, falling back to `en` for a
 * missing key/locale. `vars` substitutes `{name}`-style placeholders.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const locale = resolveLocale();
  const value = bundles[locale]?.[key] ?? en[key] ?? key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}
