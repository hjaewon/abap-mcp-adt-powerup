/**
 * UpdateClassMethod Handler - Update a single method implementation
 * (METHOD...ENDMETHOD block) of an existing ABAP class.
 *
 * Splices the replacement method block into the current full class source,
 * then delegates the actual write to handleUpdateClass (lock -> syntax
 * check on the full reconstructed class -> update -> unlock -> optional
 * activate). Because the syntax check validates the full reconstructed
 * class, a broken method never lands.
 */

import {
  findMethodBoundary,
  listMethodImplementations,
  spliceMethodSource,
  validateMethodBlock,
} from '../../../lib/abapMethodBoundaries';
import { createAdtClient } from '../../../lib/clients';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  type AxiosResponse,
  return_error,
  return_response,
} from '../../../lib/utils';
import { handleUpdateClass } from './handleUpdateClass';

export const TOOL_DEFINITION = {
  name: 'UpdateClassMethod',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    'Update a single method implementation (METHOD...ENDMETHOD block) of an existing ABAP class without sending the entire class source. Splices the replacement into the current class source, then locks, syntax-checks the full reconstructed class, updates, unlocks, and optionally activates — a broken method never lands.',
  inputSchema: {
    type: 'object',
    properties: {
      class_name: {
        type: 'string',
        description: 'Class name (e.g., ZCL_MY_CLASS).',
      },
      method_name: {
        type: 'string',
        description:
          "Method name to replace (e.g. 'GET_DATA', or for interface method implementations 'ZIF_FOO~BAR').",
      },
      source: {
        type: 'string',
        description:
          'Full replacement method block. Must start with "METHOD <name>." and end with "ENDMETHOD." (leading/trailing blank lines tolerated); the name must match method_name.',
      },
      transport_request: {
        type: 'string',
        description:
          'Transport request number (e.g., E19K905635). Required for transportable packages.',
      },
      activate: {
        type: 'boolean',
        description: 'Activate after update. Default: false.',
      },
    },
    required: ['class_name', 'method_name', 'source'],
  },
} as const;

interface UpdateClassMethodArgs {
  class_name: string;
  method_name: string;
  source: string;
  transport_request?: string;
  activate?: boolean;
}

export async function handleUpdateClassMethod(
  context: HandlerContext,
  args: UpdateClassMethodArgs,
) {
  const { connection, logger } = context;
  try {
    const { class_name, method_name, source } = args;
    if (!class_name || !method_name || !source) {
      return return_error(
        new Error('class_name, method_name, and source are required'),
      );
    }

    const className = class_name.toUpperCase();
    const client = createAdtClient(connection, logger);

    logger?.info(`Updating method ${method_name} of class ${className}`);

    const readResult = await client.getClass().read({ className }, 'active');
    if (!readResult?.readResult) {
      return return_error(new Error(`Class ${className} not found`));
    }

    const currentSource =
      typeof readResult.readResult.data === 'string'
        ? readResult.readResult.data
        : JSON.stringify(readResult.readResult.data);

    const boundary = findMethodBoundary(currentSource, method_name);
    if (!boundary) {
      const available = listMethodImplementations(currentSource).map(
        (m) => m.name,
      );
      return return_error(
        new Error(
          `Method "${method_name}" not found in class ${className}. Available methods: ${
            available.length > 0 ? available.join(', ') : '(none found)'
          }`,
        ),
      );
    }

    const validation = validateMethodBlock(source, method_name);
    if (!validation.valid) {
      return return_error(
        new Error(`Invalid replacement source: ${validation.error}`),
      );
    }

    const newFullSource = spliceMethodSource(currentSource, boundary, source);
    const newClassLineCount = newFullSource.split(/\r\n|\r|\n/).length;

    const delegatedResult = await handleUpdateClass(context, {
      class_name: className,
      source_code: newFullSource,
      transport_request: args.transport_request,
      activate: args.activate,
    });

    if (delegatedResult?.isError) {
      // Forward the delegated failure as-is (e.g. structured syntax-check
      // diagnostics from the pre-write check) — the broken method never
      // reaches SAP.
      return delegatedResult;
    }

    let delegatedInfo: Record<string, unknown> = {};
    try {
      const text = delegatedResult?.content?.[0]?.text;
      if (typeof text === 'string') {
        delegatedInfo = JSON.parse(text);
      }
    } catch {
      // Non-fatal: keep delegatedInfo empty if the delegated payload isn't
      // parseable JSON for some reason.
    }

    const activated =
      (delegatedInfo as { activated?: boolean }).activated ??
      args.activate === true;
    const checkWarnings = (delegatedInfo as { check_warnings?: unknown })
      .check_warnings;

    logger?.info(
      `UpdateClassMethod completed: ${className}.${boundary.name} (lines ${boundary.startLine}-${boundary.endLine})`,
    );

    return return_response({
      data: JSON.stringify(
        {
          success: true,
          class_name: className,
          method_name: boundary.name,
          replaced_start_line: boundary.startLine,
          replaced_end_line: boundary.endLine,
          new_class_line_count: newClassLineCount,
          activated,
          check_warnings: checkWarnings,
          message: `Method ${boundary.name} of class ${className} updated${
            activated ? ' and activated' : ''
          } successfully`,
        },
        null,
        2,
      ),
    } as AxiosResponse);
  } catch (error: any) {
    return return_error(error);
  }
}
