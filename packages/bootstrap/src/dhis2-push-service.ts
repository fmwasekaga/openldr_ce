import type { PluginDataStore } from '@openldr/db';
import type { ConnectorPushInput, RunOutcome } from './dhis2-orchestration';

const PLUGIN_ID = 'dhis2-sink';
const MAPPINGS = 'mappings';
const ORG_UNIT_MAPS = 'orgUnitMaps';

export interface Dhis2PushServiceInput {
  mappingId: string;
  period: string;
  dryRun?: boolean;
}

interface MappingDoc {
  id?: string;
  name?: string;
  definition?: { connectorId?: string } & Record<string, unknown>;
}

interface OrgUnitDoc {
  facilityId?: string;
  orgUnitId?: string;
}

/**
 * Builds the workflow `dhis2Push` service: reads the DHIS2 mapping + org-unit map
 * from the `dhis2-sink` plugin datastore (NOT the host dhis2-context) and pushes
 * via the generic DHIS2 orchestration. Deployment-agnostic — works whenever the
 * dhis2-sink plugin's data is present and a connector is configured on the mapping.
 */
export function buildDhis2PushService(deps: {
  pluginData: PluginDataStore;
  push: (input: ConnectorPushInput) => Promise<RunOutcome>;
}): (input: Dhis2PushServiceInput) => Promise<RunOutcome> {
  return async ({ mappingId, period, dryRun }) => {
    const mDoc = (await deps.pluginData.get(PLUGIN_ID, MAPPINGS, mappingId)) as MappingDoc | null;
    if (!mDoc?.definition) throw new Error(`unknown DHIS2 mapping: ${mappingId}`);
    const definition = mDoc.definition;
    const connectorId = definition.connectorId;
    if (!connectorId) throw new Error('DHIS2 mapping has no connector configured');

    const orgEntries = await deps.pluginData.list(PLUGIN_ID, ORG_UNIT_MAPS);
    const orgUnitMap = Object.fromEntries(
      orgEntries
        .map((e) => e.doc as OrgUnitDoc)
        .filter((d): d is { facilityId: string; orgUnitId: string } =>
          typeof d.facilityId === 'string' && typeof d.orgUnitId === 'string')
        .map((d) => [d.facilityId, d.orgUnitId]),
    );

    return deps.push({ connectorId, mapping: definition, orgUnitMap, period, dryRun: Boolean(dryRun), trigger: 'workflow' });
  };
}
