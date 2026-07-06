/**
 * GetClass Handler - Read ABAP Class via AdtClient
 *
 * Uses AdtClient.getClass().read() for high-level read operation.
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
  name: 'GetClass',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    'Retrieve ABAP class source code. Supports reading active or inactive version. Optionally append a compressed dependency context (public signatures of referenced classes/interfaces) via with_context.',
  inputSchema: {
    type: 'object',
    properties: {
      class_name: {
        type: 'string',
        description: 'Class name (e.g., ZCL_MY_CLASS).',
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
          'If true, append a "dependency_context" field with compressed public contracts (signatures) of every class/interface referenced by this class, so callers get surrounding context in one call. Function modules referenced via CALL FUNCTION are noted but not resolved. Default false.',
        default: false,
      },
      context_max_deps: {
        type: 'number',
        description:
          'Max number of dependencies to resolve when with_context is true (1-15). Default 10.',
        default: 10,
      },
    },
    required: ['class_name'],
  },
} as const;

interface GetClassArgs {
  class_name: string;
  version?: 'active' | 'inactive';
  with_context?: boolean;
  context_max_deps?: number;
}

/**
 * Main handler for GetClass MCP tool
 *
 * Uses AdtClient.getClass().read() - high-level read operation
 */
export async function handleGetClass(
  context: HandlerContext,
  args: GetClassArgs,
) {
  const { connection, logger } = context;
  try {
    const {
      class_name,
      version = 'active',
      with_context = false,
      context_max_deps = 10,
    } = args as GetClassArgs;

    // Validation
    if (!class_name) {
      return return_error(new Error('class_name is required'));
    }

    const client = createAdtClient(connection, logger);
    const className = class_name.toUpperCase();

    logger?.info(`Reading class ${className}, version: ${version}`);

    try {
      // Read class using AdtClient
      const classObject = client.getClass();
      const readResult = await classObject.read(
        { className },
        version as 'active' | 'inactive',
      );

      if (!readResult || !readResult.readResult) {
        throw new Error(`Class ${className} not found`);
      }

      // Extract source code from read result
      const sourceCode =
        typeof readResult.readResult.data === 'string'
          ? readResult.readResult.data
          : JSON.stringify(readResult.readResult.data);

      logger?.info(`✅ GetClass completed successfully: ${className}`);

      const responseData: Record<string, unknown> = {
        success: true,
        class_name: className,
        version,
        source_code: sourceCode,
        status: readResult.readResult.status,
        status_text: readResult.readResult.statusText,
      };

      if (with_context) {
        responseData.dependency_context = await buildContextPrologue(
          context,
          sourceCode,
          context_max_deps,
        );
      }

      return return_response({
        data: JSON.stringify(responseData, null, 2),
      } as AxiosResponse);
    } catch (error: any) {
      logger?.error(
        `Error reading class ${className}: ${error?.message || error}`,
      );

      // Parse error message
      let errorMessage = `Failed to read class: ${error.message || String(error)}`;

      if (error.response?.status === 404) {
        errorMessage = `Class ${className} not found.`;
      } else if (error.response?.status === 423) {
        errorMessage = `Class ${className} is locked by another user.`;
      }

      return return_error(new Error(errorMessage));
    }
  } catch (error: any) {
    return return_error(error);
  }
}
