/**
 * GetAtcFindings — run ABAP Test Cockpit (ATC) static checks over ADT REST and
 * return findings. Read-only: does not modify or execute repository objects.
 *
 * ATC ADT-REST contract adapted from marcellourbani/abap-adt-api
 * (MIT, (c) 2019 Marcello Urbani):
 * https://github.com/marcellourbani/abap-adt-api/blob/master/src/api/atc.ts
 *
 * Flow:
 *   1. POST /atc/worklists?checkVariant=<v>        -> worklistId (text/plain)
 *   2. POST /atc/runs?worklistId=<worklistId> +XML -> run result id
 *   3. GET  /atc/worklists/<runResultId>           -> findings XML
 */
import { XMLParser } from 'fast-xml-parser';
import { parseAtcWorklist } from '../../../lib/atcWorklistParser';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import { resolveAdtUri } from '../../../lib/resolveAdtUri';
import {
  ErrorCode,
  McpError,
  makeAdtRequestWithTimeout,
} from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetAtcFindings',
  available_in: ['onprem', 'cloud'] as const,
  description:
    '[read-only] Run ABAP Test Cockpit (ATC) static checks on an object or package and return findings (priority 1=error/2=warning/3+=info, check title, message, object, location). Does not modify or execute repository objects.',
  inputSchema: {
    type: 'object',
    properties: {
      object_uri: {
        type: 'string',
        description:
          'Explicit ADT URI of the target (e.g. /sap/bc/adt/oo/classes/zcl_x). If given, object_name/object_type are ignored.',
      },
      object_name: {
        type: 'string',
        description:
          'Object name (used with object_type when object_uri is absent).',
      },
      object_type: {
        type: 'string',
        description:
          'SAP object type code for URI resolution: CLAS, INTF, PROG, FUGR, TABL, STRU, VIEW, DTEL, DOMA, DDLS, BDEF, SRVD, SRVB, DEVC (package).',
      },
      check_variant: {
        type: 'string',
        description:
          'ATC check variant name. If omitted, the system default variant is resolved from /atc/customizing.',
      },
      max_results: {
        type: 'number',
        description: 'Maximum findings (maps to ATC maximumVerdicts).',
        default: 100,
      },
    },
    required: [],
  },
} as const;

interface GetAtcFindingsArgs {
  object_uri?: string;
  object_name?: string;
  object_type?: string;
  check_variant?: string;
  max_results?: number;
}

const ATC_BASE = '/sap/bc/adt/atc';

function newParser(): XMLParser {
  return new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
}

export async function handleGetAtcFindings(
  context: HandlerContext,
  args: GetAtcFindingsArgs,
) {
  const { connection, logger } = context;
  try {
    // 1. Resolve the target object's ADT URI (mainUrl).
    let mainUrl: string;
    if (args.object_uri && args.object_uri.trim().length > 0) {
      mainUrl = args.object_uri.trim();
    } else if (args.object_name) {
      mainUrl = resolveAdtUri({
        name: args.object_name,
        type: args.object_type,
      });
    } else {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Provide object_uri, or object_name + object_type.',
      );
    }

    const maxResults = args.max_results ?? 100;

    // Resolve check variant (explicit input wins; else system default).
    let variant = args.check_variant?.trim();
    if (!variant) {
      const cust = await makeAdtRequestWithTimeout(
        connection,
        `${ATC_BASE}/customizing`,
        'GET',
        'default',
        undefined,
        undefined,
        {
          Accept: 'application/xml, application/vnd.sap.atc.customizing-v1+xml',
        },
      );
      const craw = newParser().parse(String(cust.data));
      const props = craw?.customizing?.properties?.property;
      const arr = Array.isArray(props) ? props : props ? [props] : [];
      // VERIFY(live-757): exact property key for the system default variant.
      const hit = arr.find(
        (p: any) =>
          String(p?.['@_name'] ?? '').toLowerCase() === 'systemcheckvariant',
      );
      variant = hit?.['@_value'] ? String(hit['@_value']) : undefined;
      if (!variant) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'No check_variant given and could not resolve the system default from /atc/customizing — pass check_variant explicitly.',
        );
      }
    }

    logger?.info(`ATC: variant=${variant} target=${mainUrl} max=${maxResults}`);

    // 2. Create a worklist for the variant -> worklistId (text/plain).
    const worklistResp = await makeAdtRequestWithTimeout(
      connection,
      `${ATC_BASE}/worklists?checkVariant=${encodeURIComponent(variant)}`,
      'POST',
      'csrf',
      undefined,
      undefined,
      { Accept: 'text/plain' },
    );
    const worklistId = String(worklistResp.data).trim();

    // 3. Trigger the run. Response carries the run-result worklist id.
    const runBody = `<?xml version="1.0" encoding="UTF-8"?>
<atc:run maximumVerdicts="${maxResults}" xmlns:atc="http://www.sap.com/adt/atc">
  <objectSets xmlns:adtcore="http://www.sap.com/adt/core">
    <objectSet kind="inclusive">
      <adtcore:objectReferences>
        <adtcore:objectReference adtcore:uri="${mainUrl}"/>
      </adtcore:objectReferences>
    </objectSet>
  </objectSets>
</atc:run>`;
    const runResp = await makeAdtRequestWithTimeout(
      connection,
      `${ATC_BASE}/runs?worklistId=${encodeURIComponent(worklistId)}`,
      'POST',
      'long',
      runBody,
      undefined,
      { Accept: 'application/xml', 'Content-Type': 'application/xml' },
    );
    const runRaw = newParser().parse(String(runResp.data));
    // VERIFY(live-757): run response shape; abap-adt-api reads worklistRun/worklistId.
    const runResultId = runRaw?.worklistRun?.worklistId
      ? String(runRaw.worklistRun.worklistId)
      : worklistId;

    // 4. Fetch the findings worklist.
    const findingsResp = await makeAdtRequestWithTimeout(
      connection,
      `${ATC_BASE}/worklists/${encodeURIComponent(runResultId)}`,
      'GET',
      'long',
      undefined,
      { includeExemptedFindings: false },
      { Accept: 'application/atc.worklist.v1+xml' },
    );
    const parsed = parseAtcWorklist(String(findingsResp.data));

    logger?.info(
      `ATC done: ${parsed.total} findings (E:${parsed.errors} W:${parsed.warnings} I:${parsed.infos})`,
    );

    return {
      isError: false,
      content: [
        {
          type: 'json',
          json: {
            target: mainUrl,
            check_variant: variant,
            ...parsed,
          },
        },
      ],
    };
  } catch (error) {
    logger?.error('GetAtcFindings failed', error as any);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
