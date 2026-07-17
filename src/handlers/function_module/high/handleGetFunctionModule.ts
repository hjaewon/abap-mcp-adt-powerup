/**
 * GetFunctionModule Handler - Read ABAP FunctionModule via AdtClient
 *
 * Uses AdtClient.getFunctionModule().read() for high-level read operation.
 * Supports both active and inactive versions.
 */

import { createAdtClient } from '../../../lib/clients';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  type AxiosResponse,
  return_error,
  return_response,
} from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetFunctionModule',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    'Retrieve ABAP function module definition. Supports reading active or inactive version. ' +
    "CAUTION: the default version='active' returns the pre-edit source when an unactivated edit exists — writing on top of it silently destroys the previous edit and no gate catches it. When re-editing, read version='inactive' first (or check GetInactiveObjects), and re-read after every write. A returned 'active' source is NOT proof the FM was ever successfully activated (never-activated FMs also return it).",
  inputSchema: {
    type: 'object',
    properties: {
      function_module_name: {
        type: 'string',
        description: 'FunctionModule name (e.g., Z_MY_FUNCTIONMODULE).',
      },
      function_group_name: {
        type: 'string',
        description:
          'FunctionGroup name containing the function module (e.g., Z_MY_FUNCTIONGROUP).',
      },
      version: {
        type: 'string',
        enum: ['active', 'inactive'],
        description:
          'Version to read: "active" (default) for deployed version, "inactive" for modified but not activated version.',
        default: 'active',
      },
      check_inactive: {
        type: 'boolean',
        description:
          "When reading the active version, also read the inactive version (one extra ADT call) and, if an unactivated version exists and its source differs, attach a 'warning' to the response. Default true. The extra read never fails or slows the main read. Set false to skip it.",
        default: true,
      },
    },
    required: ['function_module_name', 'function_group_name'],
  },
} as const;

interface GetFunctionModuleArgs {
  function_module_name: string;
  function_group_name: string;
  version?: 'active' | 'inactive';
  check_inactive?: boolean;
}

const INACTIVE_DIVERGENCE_WARNING =
  "An inactive (unactivated) version of this function module exists and differs from the active source returned here — re-read with version='inactive' before editing, or the pending edit will be silently overwritten.";

function extractFunctionModuleSource(readResult: any): string | undefined {
  const data = readResult?.readResult?.data;
  if (data == null) {
    return undefined;
  }
  if (typeof data === 'string') {
    return data;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

/**
 * Main handler for GetFunctionModule MCP tool
 *
 * Uses AdtClient.getFunctionModule().read() - high-level read operation
 */
export async function handleGetFunctionModule(
  context: HandlerContext,
  args: GetFunctionModuleArgs,
) {
  const { connection, logger } = context;
  try {
    const {
      function_module_name,
      function_group_name,
      version = 'active',
      check_inactive = true,
    } = args as GetFunctionModuleArgs;

    // Validation
    if (!function_module_name || !function_group_name) {
      return return_error(
        new Error('function_module_name and function_group_name are required'),
      );
    }

    const client = createAdtClient(connection, logger);
    const functionModuleName = function_module_name.toUpperCase();
    const functionGroupName = function_group_name.toUpperCase();

    logger?.info(
      `Reading function module ${functionModuleName} in ${functionGroupName}, version: ${version}`,
    );

    try {
      // Read function module using AdtClient
      const functionModuleObject = client.getFunctionModule();
      const readResult = await functionModuleObject.read(
        { functionModuleName, functionGroupName },
        version as 'active' | 'inactive',
      );

      if (!readResult || !readResult.readResult) {
        throw new Error(`FunctionModule ${functionModuleName} not found`);
      }

      // Extract data from read result
      const functionModuleData =
        extractFunctionModuleSource(readResult) ??
        String(readResult.readResult.data);

      // Inactive-divergence check: when reading the active version, optionally
      // read the inactive version and warn if a pending, differing edit exists.
      // This extra read must NEVER fail or slow-fail the main read.
      let warning: string | undefined;
      if (version === 'active' && check_inactive !== false) {
        try {
          const inactiveResult = await functionModuleObject.read(
            { functionModuleName, functionGroupName },
            'inactive',
          );
          const inactiveData = extractFunctionModuleSource(inactiveResult);
          if (inactiveData != null && inactiveData !== functionModuleData) {
            warning = INACTIVE_DIVERGENCE_WARNING;
          }
        } catch (inactiveError: any) {
          // Inactive version missing (404) or any other error → no warning.
          logger?.debug?.(
            `[GetFunctionModule] Inactive-version check skipped for ${functionModuleName}: ${inactiveError?.message || inactiveError}`,
          );
        }
      }

      logger?.info(
        `✅ GetFunctionModule completed successfully: ${functionModuleName}`,
      );

      return return_response({
        data: JSON.stringify(
          {
            success: true,
            function_module_name: functionModuleName,
            function_group_name: functionGroupName,
            version,
            function_module_data: functionModuleData,
            status: readResult.readResult.status,
            status_text: readResult.readResult.statusText,
            warning,
          },
          null,
          2,
        ),
      } as AxiosResponse);
    } catch (error: any) {
      logger?.error(
        `Error reading function module ${functionModuleName}: ${error?.message || error}`,
      );

      // Parse error message
      let errorMessage = `Failed to read function module: ${error.message || String(error)}`;

      if (error.response?.status === 404) {
        errorMessage = `FunctionModule ${functionModuleName} not found.`;
      } else if (error.response?.status === 423) {
        errorMessage = `FunctionModule ${functionModuleName} is locked by another user.`;
      }

      return return_error(new Error(errorMessage));
    }
  } catch (error: any) {
    return return_error(error);
  }
}
