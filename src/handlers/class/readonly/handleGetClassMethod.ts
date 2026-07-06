import {
  extractMethodSource,
  findMethodBoundary,
  listMethodImplementations,
} from '../../../lib/abapMethodBoundaries';
import { createAdtClient } from '../../../lib/clients';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  type AxiosResponse,
  return_error,
  return_response,
} from '../../../lib/utils';

export const TOOL_DEFINITION = {
  name: 'GetClassMethod',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    '[read-only] Read the source of a single method implementation (the METHOD...ENDMETHOD block) from an ABAP class, without fetching the entire class source. Use this instead of GetClass/ReadClass when only one method needs inspecting — dramatically smaller than reading the whole class.',
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
          "Method name to extract (e.g. 'GET_DATA', or for interface method implementations 'ZIF_FOO~BAR').",
      },
    },
    required: ['class_name', 'method_name'],
  },
} as const;

interface GetClassMethodArgs {
  class_name: string;
  method_name: string;
}

export async function handleGetClassMethod(
  context: HandlerContext,
  args: GetClassMethodArgs,
) {
  const { connection, logger } = context;
  try {
    const { class_name, method_name } = args;
    if (!class_name || !method_name) {
      return return_error(new Error('class_name and method_name are required'));
    }

    const className = class_name.toUpperCase();
    const client = createAdtClient(connection, logger);

    logger?.info(`Reading method ${method_name} of class ${className}`);

    const readResult = await client.getClass().read({ className }, 'active');
    if (!readResult?.readResult) {
      return return_error(new Error(`Class ${className} not found`));
    }

    const sourceCode =
      typeof readResult.readResult.data === 'string'
        ? readResult.readResult.data
        : JSON.stringify(readResult.readResult.data);

    const totalClassLines = sourceCode.split(/\r\n|\r|\n/).length;
    const boundary = findMethodBoundary(sourceCode, method_name);

    if (!boundary) {
      const available = listMethodImplementations(sourceCode).map(
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

    const methodSource = extractMethodSource(sourceCode, boundary);

    logger?.info(
      `GetClassMethod completed: ${className}.${boundary.name} (lines ${boundary.startLine}-${boundary.endLine})`,
    );

    return return_response({
      data: JSON.stringify(
        {
          class_name: className,
          method_name: boundary.name,
          start_line: boundary.startLine,
          end_line: boundary.endLine,
          total_class_lines: totalClassLines,
          source: methodSource,
        },
        null,
        2,
      ),
    } as AxiosResponse);
  } catch (error: any) {
    return return_error(error);
  }
}
