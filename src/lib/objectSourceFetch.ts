/**
 * Thin source-fetch dispatcher for the Grep* read-only tools.
 *
 * Given an ABAP object type + name, returns the plain source text for the
 * types that are cheap and unambiguous to fetch (class, program, interface,
 * include, function group). Everything else is reported back with a reason
 * instead of throwing, so callers can keep scanning the rest of a batch.
 */
import type { AdtClient } from '@babamba2/mcp-abap-adt-clients';
import type {
  IAbapConnection,
  ILogger,
} from '@babamba2/mcp-abap-adt-interfaces';
import { encodeSapObjectName, makeAdtRequestWithTimeout } from './utils';

export type SourceObjectCode =
  | 'CLAS'
  | 'PROG'
  | 'INTF'
  | 'INCL'
  | 'FUGR'
  | 'FUNC';

export interface FetchSourceResult {
  source: string | null;
  /** Set (with source: null) when the object could not be scanned. */
  skipReason?: string;
}

/**
 * Classifies a caller-supplied object_type (short code like "CLAS", or a raw
 * ADT type like "CLAS/OC", "PROG/I", "FUGR/FF") into one of the codes this
 * dispatcher knows how to handle. Standalone includes report ADT type
 * "PROG/I" (not "PROG/P"), so that prefix is checked before the generic
 * PROG/ prefix.
 */
export function classifySourceType(
  rawType: string,
): SourceObjectCode | undefined {
  const t = (rawType ?? '').trim().toUpperCase();
  if (!t) return undefined;
  if (t === 'INCL' || t.startsWith('PROG/I')) return 'INCL';
  if (t === 'CLAS' || t.startsWith('CLAS/')) return 'CLAS';
  if (t === 'PROG' || t.startsWith('PROG/')) return 'PROG';
  if (t === 'INTF' || t.startsWith('INTF/')) return 'INTF';
  if (t === 'FUNC' || t === 'FUGR/FF') return 'FUNC';
  if (t === 'FUGR' || t.startsWith('FUGR/')) return 'FUGR';
  return undefined;
}

function extractSourceData(data: unknown): string | null {
  if (data === undefined || data === null) return null;
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

/**
 * Fetches source text for one object. Returns { source: null, skipReason }
 * instead of throwing for unsupported types or fetch failures, so batch
 * callers can keep going.
 */
export async function fetchObjectSource(
  client: AdtClient,
  connection: IAbapConnection,
  objectType: string,
  objectName: string,
  logger?: ILogger,
): Promise<FetchSourceResult> {
  const code = classifySourceType(objectType);
  const name = (objectName ?? '').trim().toUpperCase();

  if (!name) {
    return { source: null, skipReason: 'object_name is required' };
  }
  if (!code) {
    return {
      source: null,
      skipReason: `Unsupported object_type "${objectType}" for source search (supported: CLAS, PROG, INTF, INCL, FUGR)`,
    };
  }
  if (code === 'FUNC') {
    return {
      source: null,
      skipReason:
        'Function module source requires both function_module_name and function_group_name; not resolvable from object_name alone. Use object_type "FUGR" with the function group name to search the whole group instead.',
    };
  }

  try {
    switch (code) {
      case 'CLAS': {
        const result = await client
          .getClass()
          .read({ className: name }, 'active');
        return { source: extractSourceData(result?.readResult?.data) };
      }
      case 'PROG': {
        const result = await client
          .getProgram()
          .read({ programName: name }, 'active');
        return { source: extractSourceData(result?.readResult?.data) };
      }
      case 'INTF': {
        const result = await client
          .getInterface()
          .read({ interfaceName: name }, 'active');
        return { source: extractSourceData(result?.readResult?.data) };
      }
      case 'FUGR': {
        const result = await client
          .getFunctionGroup()
          .read({ functionGroupName: name }, 'active');
        return { source: extractSourceData(result?.readResult?.data) };
      }
      case 'INCL': {
        const url = `/sap/bc/adt/programs/includes/${encodeSapObjectName(name)}/source/main`;
        const response = await makeAdtRequestWithTimeout(
          connection,
          url,
          'GET',
          'default',
        );
        return { source: extractSourceData(response?.data) };
      }
      default:
        return {
          source: null,
          skipReason: `Unsupported object_type "${objectType}"`,
        };
    }
  } catch (error) {
    logger?.warn(
      `GrepObjects/GrepPackages: could not fetch source for ${objectType} ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      source: null,
      skipReason: `Failed to fetch source: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
