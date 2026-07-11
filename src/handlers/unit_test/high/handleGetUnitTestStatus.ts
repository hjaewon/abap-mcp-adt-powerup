/**
 * GetUnitTestStatus Handler - Read ABAP Unit test run status
 *
 * RunUnitTest now runs synchronously via the classic ADT endpoint (see
 * ../../../lib/abapUnitClassic.ts) and caches the result under a generated
 * run_id — there is no server-side async run to poll, so this simply
 * reports "completed" for any run_id present in that cache.
 */

import { getUnitTestRun } from '../../../lib/abapUnitClassic';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  type AxiosResponse,
  return_error,
  return_response,
} from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetUnitTestStatus',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description: 'Retrieve ABAP Unit test run status for a run_id.',
  inputSchema: {
    type: 'object',
    properties: {
      run_id: {
        type: 'string',
        description: 'Run identifier returned by unit test run.',
      },
      with_long_polling: {
        type: 'boolean',
        description: 'Enable long polling while waiting for status.',
        default: true,
      },
    },
    required: ['run_id'],
  },
} as const;

interface GetUnitTestStatusArgs {
  run_id: string;
  with_long_polling?: boolean;
}

/**
 * Main handler for GetUnitTestStatus MCP tool
 *
 * Uses getUnitTestRun() to look up the cached synchronous run result.
 */
export async function handleGetUnitTestStatus(
  context: HandlerContext,
  args: GetUnitTestStatusArgs,
) {
  const { connection, logger } = context;
  try {
    const { run_id } = args as GetUnitTestStatusArgs;

    if (!run_id) {
      return return_error(new Error('run_id is required'));
    }

    logger?.info(`Reading unit test status for run_id: ${run_id}`);

    const resultXml = getUnitTestRun(connection, run_id);
    if (resultXml === undefined) {
      return return_error(
        new Error(
          `Unknown run_id "${run_id}" — no cached result (invalid run_id, or the server process restarted since RunUnitTest was called).`,
        ),
      );
    }

    // The classic ADT endpoint is synchronous (see abapUnitClassic.ts), so
    // by the time a run_id exists in the cache, the run has already finished.
    return return_response({
      data: JSON.stringify(
        {
          success: true,
          run_id,
          run_status: { status: 'completed' },
        },
        null,
        2,
      ),
    } as AxiosResponse);
  } catch (error: any) {
    return return_error(error);
  }
}
