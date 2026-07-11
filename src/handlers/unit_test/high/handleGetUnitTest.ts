/**
 * GetUnitTest Handler - Read ABAP Unit test status/result
 *
 * RunUnitTest runs synchronously via the classic ADT endpoint (see
 * ../../../lib/abapUnitClassic.ts) and caches the `<aunit:runResult>` XML
 * under a generated run_id — this looks it back up (combined status+result
 * view of the same cache the Status/Result handlers read).
 */

import { getUnitTestRun } from '../../../lib/abapUnitClassic';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  type AxiosResponse,
  return_error,
  return_response,
} from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetUnitTest',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    'Retrieve ABAP Unit test run status and result for a previously started run_id.',
  inputSchema: {
    type: 'object',
    properties: {
      run_id: {
        type: 'string',
        description: 'Run identifier returned by RunUnitTest.',
      },
    },
    required: ['run_id'],
  },
} as const;

interface GetUnitTestArgs {
  run_id: string;
}

/**
 * Main handler for GetUnitTest MCP tool
 *
 * Uses getUnitTestRun() to look up the cached synchronous run result.
 */
export async function handleGetUnitTest(
  context: HandlerContext,
  args: GetUnitTestArgs,
) {
  const { connection, logger } = context;
  try {
    const { run_id } = args as GetUnitTestArgs;

    // Validation
    if (!run_id) {
      return return_error(new Error('run_id is required'));
    }

    logger?.info(`Reading unit test run status/result for run_id: ${run_id}`);

    const resultXml = getUnitTestRun(connection, run_id);
    if (resultXml === undefined) {
      return return_error(
        new Error(
          `Unknown run_id "${run_id}" — no cached result (invalid run_id, or the server process restarted since RunUnitTest was called).`,
        ),
      );
    }

    logger?.info(`✅ GetUnitTest completed successfully for run_id: ${run_id}`);

    return return_response({
      data: JSON.stringify(
        {
          success: true,
          run_id,
          run_status: { status: 'completed' },
          run_result: resultXml,
        },
        null,
        2,
      ),
    } as AxiosResponse);
  } catch (error: any) {
    return return_error(error);
  }
}
