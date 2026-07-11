import type { IAdtClientOptions } from '@babamba2/mcp-abap-adt-clients';
import { AdtClient, AdtClientLegacy } from '@babamba2/mcp-abap-adt-clients';
import type {
  IAbapConnection,
  ILogger,
} from '@babamba2/mcp-abap-adt-interfaces';
import type { AbapConnection } from '@babamba2/mcp-abap-connection';
import { registerConnectionResetHook } from './connectionEvents';
import { getSystemContext } from './systemContext';
import { getManagedConnection } from './utils';

let adtClient: AdtClient | undefined;
let adtClientConnection: AbapConnection | undefined;

export function createAdtClient(
  connection: IAbapConnection,
  logger?: ILogger,
  extraOptions?: Pick<IAdtClientOptions, 'contentTypes'>,
): AdtClient {
  const ctx = getSystemContext();
  const options =
    ctx.masterSystem || ctx.responsible
      ? { masterSystem: ctx.masterSystem, responsible: ctx.responsible }
      : undefined;
  if (ctx.isLegacy) {
    // Legacy clients default to AdtContentTypesBase (unversioned/v1 headers)
    // internally — don't override that with caller-negotiated types.
    return new AdtClientLegacy(connection, logger, options);
  }
  const merged = extraOptions ? { ...options, ...extraOptions } : options;
  return new AdtClient(connection, logger, merged);
}

export function getAdtClient(): AdtClient {
  const connection = getManagedConnection();

  if (!adtClient || adtClientConnection !== connection) {
    adtClient = createAdtClient(connection);
    adtClientConnection = connection;
  }

  return adtClient;
}

export function resetClientCache() {
  adtClient = undefined;
  adtClientConnection = undefined;
}

registerConnectionResetHook(resetClientCache);
