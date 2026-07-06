/**
 * GetInterface Handler - Read ABAP Interface via AdtClient
 *
 * Uses AdtClient.getInterface().read() for high-level read operation.
 * Supports both active and inactive versions.
 */

import { createAdtClient } from '../../../lib/clients';
import { buildContextPrologue } from '../../../lib/contextPrologue';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  type AxiosResponse,
  return_error,
  return_response,
} from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetInterface',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    'Retrieve ABAP interface definition. Supports reading active or inactive version. Optionally append a compressed dependency context (public signatures of referenced classes/interfaces) via with_context.',
  inputSchema: {
    type: 'object',
    properties: {
      interface_name: {
        type: 'string',
        description: 'Interface name (e.g., Z_MY_INTERFACE).',
      },
      version: {
        type: 'string',
        enum: ['active', 'inactive'],
        description:
          'Version to read: "active" (default) for deployed version, "inactive" for modified but not activated version.',
        default: 'active',
      },
      with_context: {
        type: 'boolean',
        description:
          'If true, append a "dependency_context" field with compressed public contracts (signatures) of every class/interface referenced by this interface, so callers get surrounding context in one call. Function modules referenced via CALL FUNCTION are noted but not resolved. Default false.',
        default: false,
      },
      context_max_deps: {
        type: 'number',
        description:
          'Max number of dependencies to resolve when with_context is true (1-15). Default 10.',
        default: 10,
      },
    },
    required: ['interface_name'],
  },
} as const;

interface GetInterfaceArgs {
  interface_name: string;
  version?: 'active' | 'inactive';
  with_context?: boolean;
  context_max_deps?: number;
}

/**
 * Main handler for GetInterface MCP tool
 *
 * Uses AdtClient.getInterface().read() - high-level read operation
 */
export async function handleGetInterface(
  context: HandlerContext,
  args: GetInterfaceArgs,
) {
  const { connection, logger } = context;
  try {
    const {
      interface_name,
      version = 'active',
      with_context = false,
      context_max_deps = 10,
    } = args as GetInterfaceArgs;

    // Validation
    if (!interface_name) {
      return return_error(new Error('interface_name is required'));
    }

    const client = createAdtClient(connection, logger);
    const interfaceName = interface_name.toUpperCase();

    logger?.info(`Reading interface ${interfaceName}, version: ${version}`);

    try {
      // Read interface using AdtClient
      const interfaceObject = client.getInterface();
      const readResult = await interfaceObject.read(
        { interfaceName },
        version as 'active' | 'inactive',
      );

      if (!readResult || !readResult.readResult) {
        throw new Error(`Interface ${interfaceName} not found`);
      }

      // Extract data from read result
      const interfaceData =
        typeof readResult.readResult.data === 'string'
          ? readResult.readResult.data
          : JSON.stringify(readResult.readResult.data);

      logger?.info(`✅ GetInterface completed successfully: ${interfaceName}`);

      const responseData: Record<string, unknown> = {
        success: true,
        interface_name: interfaceName,
        version,
        interface_data: interfaceData,
        status: readResult.readResult.status,
        status_text: readResult.readResult.statusText,
      };

      if (with_context) {
        responseData.dependency_context = await buildContextPrologue(
          context,
          interfaceData,
          context_max_deps,
        );
      }

      return return_response({
        data: JSON.stringify(responseData, null, 2),
      } as AxiosResponse);
    } catch (error: any) {
      logger?.error(
        `Error reading interface ${interfaceName}: ${error?.message || error}`,
      );

      // Parse error message
      let errorMessage = `Failed to read interface: ${error.message || String(error)}`;

      if (error.response?.status === 404) {
        errorMessage = `Interface ${interfaceName} not found.`;
      } else if (error.response?.status === 423) {
        errorMessage = `Interface ${interfaceName} is locked by another user.`;
      }

      return return_error(new Error(errorMessage));
    }
  } catch (error: any) {
    return return_error(error);
  }
}
