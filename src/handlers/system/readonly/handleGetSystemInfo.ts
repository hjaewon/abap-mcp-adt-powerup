/**
 * GetSystemInfo — read-only SAP system identity lookup.
 *
 * Primary source: `/sap/bc/adt/core/http/systeminformation` (JSON) — the
 * same endpoint @babamba2/mcp-abap-adt-clients' getSystemInformation() uses;
 * confirmed real, but mainly populated on cloud/JWT-auth systems.
 * Secondary source: the ADT discovery Atom Service Document, tried at the
 * modern path first (`/sap/bc/adt/core/discovery`) and the legacy path
 * second (`/sap/bc/adt/discovery`), used only to classify the ADT stack as
 * "modern" vs "legacy" (a system-type hint, not a release number).
 *
 * Neither endpoint reliably exposes ABAP release/kernel/SP-level details —
 * there is no confirmed ADT REST endpoint for that in this codebase's
 * vendored client. If both probes fail (e.g. very old on-prem release with
 * no ADT discovery at all), this returns `{ supported: false }` rather than
 * throwing, since "not available" is itself useful platform-detection data.
 */
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  parseSystemInformation,
  tryAdtGet,
} from '../../../lib/systemInfoParsers';

export const TOOL_DEFINITION = {
  name: 'GetSystemInfo',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    '[read-only] Retrieve SAP system identity: system ID (SID), client, logon language, connected user, and an ADT-stack "modern vs legacy" hint. Returns { supported: false } instead of an error when the underlying ADT endpoints are absent on this release.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

const SYSTEMINFO_URL = '/sap/bc/adt/core/http/systeminformation';
const DISCOVERY_MODERN_URL = '/sap/bc/adt/core/discovery';
const DISCOVERY_LEGACY_URL = '/sap/bc/adt/discovery';

export async function handleGetSystemInfo(context: HandlerContext, _args: any) {
  const { connection, logger } = context;

  const infoResult = await tryAdtGet(connection, SYSTEMINFO_URL, {
    Accept: 'application/vnd.sap.adt.core.http.systeminformation.v1+json',
  });

  let adtStackType: 'modern' | 'legacy' | 'unknown' = 'unknown';
  const modernResult = await tryAdtGet(connection, DISCOVERY_MODERN_URL, {
    Accept: 'application/atomsvc+xml',
  });
  if (modernResult.ok && modernResult.contentType.includes('xml')) {
    adtStackType = 'modern';
  } else {
    const legacyResult = await tryAdtGet(connection, DISCOVERY_LEGACY_URL, {
      Accept: 'application/atomsvc+xml',
    });
    if (legacyResult.ok && legacyResult.contentType.includes('xml')) {
      adtStackType = 'legacy';
    }
  }

  if (!infoResult.ok && adtStackType === 'unknown') {
    logger?.info('GetSystemInfo: no ADT system-info endpoint responded');
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            supported: false,
            reason:
              'Neither /sap/bc/adt/core/http/systeminformation nor the ADT discovery document responded on this system.',
          }),
        },
      ],
    };
  }

  const info = infoResult.ok ? parseSystemInformation(infoResult.data) : {};

  return {
    isError: false,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          supported: true,
          system_id: info.systemId ?? null,
          client: info.client ?? null,
          language: info.language ?? null,
          user_name: info.userName ?? null,
          user_full_name: info.userFullName ?? null,
          adt_stack_type: adtStackType,
        }),
      },
    ],
  };
}
