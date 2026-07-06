/**
 * GetInstalledComponents — read-only installed software-component lookup
 * (e.g. SAP_BASIS release/support-package level).
 *
 * VERIFY(live): there is no confirmed ADT REST endpoint for this in the
 * vendored @babamba2/mcp-abap-adt-clients (unlike GetSystemInfo's
 * /core/http/systeminformation, which is confirmed real). The candidate
 * URLs below are tried in order; the parser (systemInfoParsers.ts) is
 * intentionally defensive about the response shape. If neither responds,
 * this returns `{ supported: false }` rather than throwing — these tools
 * feed platform auto-detection, so "not available" is valid data.
 */
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  parseInstalledComponents,
  tryAdtGet,
} from '../../../lib/systemInfoParsers';

export const TOOL_DEFINITION = {
  name: 'GetInstalledComponents',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    '[read-only] Retrieve installed software components with release/support-package level (e.g. SAP_BASIS 757 SP02). Returns { supported: false } instead of an error when the underlying ADT endpoint is absent on this release.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

const CANDIDATE_URLS = [
  '/sap/bc/adt/core/http/systeminformation/componentreleases',
  '/sap/bc/adt/core/systeminformation/componentreleases',
];

export async function handleGetInstalledComponents(
  context: HandlerContext,
  _args: any,
) {
  const { connection, logger } = context;

  for (const url of CANDIDATE_URLS) {
    const result = await tryAdtGet(connection, url, {
      Accept: 'application/json, application/xml',
    });
    if (result.ok) {
      const components = parseInstalledComponents(
        result.data,
        result.contentType,
      );
      logger?.info(
        `GetInstalledComponents: ${url} responded, ${components.length} component(s) parsed`,
      );
      return {
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ supported: true, components }),
          },
        ],
      };
    }
  }

  logger?.info('GetInstalledComponents: no candidate endpoint responded');
  return {
    isError: false,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          supported: false,
          reason: `No installed-components endpoint responded on this system (tried: ${CANDIDATE_URLS.join(', ')}).`,
        }),
      },
    ],
  };
}
