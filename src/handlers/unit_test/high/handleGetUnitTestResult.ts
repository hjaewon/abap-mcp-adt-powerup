/**
 * GetUnitTestResult Handler - Read ABAP Unit test run result
 *
 * RunUnitTest now runs synchronously via the classic ADT endpoint (see
 * ../../../lib/abapUnitClassic.ts) and caches the raw `<aunit:runResult>`
 * XML under a generated run_id. This just looks it back up. JUnit-format
 * conversion is not available for the classic endpoint (no verified live
 * endpoint for it), so `format: "junit"` is rejected explicitly rather than
 * silently returning ABAP Unit-format data instead.
 */

import { getUnitTestRun } from '../../../lib/abapUnitClassic';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  type AxiosResponse,
  return_error,
  return_response,
} from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetUnitTestResult',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description: 'Retrieve ABAP Unit test run result for a run_id.',
  inputSchema: {
    type: 'object',
    properties: {
      run_id: {
        type: 'string',
        description: 'Run identifier returned by unit test run.',
      },
      with_navigation_uris: {
        type: 'boolean',
        description: 'Include navigation URIs in result if supported.',
        default: false,
      },
      format: {
        type: 'string',
        description: 'Result format: abapunit or junit.',
        enum: ['abapunit', 'junit'],
      },
    },
    required: ['run_id'],
  },
} as const;

interface GetUnitTestResultArgs {
  run_id: string;
  with_navigation_uris?: boolean;
  format?: 'abapunit' | 'junit';
}

/**
 * Main handler for GetUnitTestResult MCP tool
 *
 * Uses getUnitTestRun() to look up the cached synchronous run result.
 */
export async function handleGetUnitTestResult(
  context: HandlerContext,
  args: GetUnitTestResultArgs,
) {
  const { connection, logger } = context;
  try {
    const { run_id, format } = args as GetUnitTestResultArgs;

    if (!run_id) {
      return return_error(new Error('run_id is required'));
    }

    if (format === 'junit') {
      return return_error(
        new Error(
          'format "junit" is not available for the classic ADT ABAP Unit endpoint (no verified live endpoint for it). Omit format, or use "abapunit", to get the raw result.',
        ),
      );
    }

    logger?.info(`Reading unit test result for run_id: ${run_id}`);

    const resultXml = getUnitTestRun(connection, run_id);
    if (resultXml === undefined) {
      return return_error(
        new Error(
          `Unknown run_id "${run_id}" — no cached result (invalid run_id, or the server process restarted since RunUnitTest was called).`,
        ),
      );
    }

    return return_response({
      data: JSON.stringify(
        {
          success: true,
          run_id,
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
