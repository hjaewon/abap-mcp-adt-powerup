/**
 * GrepObjects — regex-search ABAP object source across multiple objects in
 * one call, so an AI doesn't have to read each object individually and grep
 * client-side. Read-only: only fetches active source, never modifies objects.
 */
import type { AdtClient } from '@babamba2/mcp-abap-adt-clients';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { createAdtClient } from '../../../lib/clients';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import { fetchObjectSource } from '../../../lib/objectSourceFetch';
import { runWithConcurrency } from '../../../lib/promisePool';
import {
  aggregateGrepResults,
  compileGrepRegex,
  type ObjectGrepInput,
} from '../../../lib/sourceGrep';

const MAX_OBJECTS = 50;
const FETCH_CONCURRENCY = 5;

export const TOOL_DEFINITION = {
  name: 'GrepObjects',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    '[read-only] Search ABAP source code for a regex pattern across multiple named objects in a single call — finds matching lines (with optional context) instead of reading each object one by one. Supports CLAS, PROG, INTF, INCL, and FUGR (function group). Individual function modules (FUNC) are not supported; use FUGR with the group name to search the whole group.',
  inputSchema: {
    type: 'object',
    properties: {
      objects: {
        type: 'array',
        description: 'Objects to search (1-50 entries).',
        items: {
          type: 'object',
          properties: {
            object_type: {
              type: 'string',
              description: 'ABAP object type: CLAS, PROG, INTF, INCL, or FUGR.',
            },
            object_name: {
              type: 'string',
              description: 'Object name (e.g. ZCL_MY_CLASS).',
            },
          },
          required: ['object_type', 'object_name'],
        },
        minItems: 1,
        maxItems: MAX_OBJECTS,
      },
      pattern: {
        type: 'string',
        description:
          'JavaScript regular expression source to search for (e.g. "SELECT\\\\s+\\\\*").',
      },
      case_insensitive: {
        type: 'boolean',
        description: 'Case-insensitive match. Default: false.',
        default: false,
      },
      context_lines: {
        type: 'number',
        description:
          'Number of lines of context before/after each match (0-5). Default: 0.',
        default: 0,
      },
      max_results: {
        type: 'number',
        description:
          'Maximum total matches to return across all objects. Default: 100.',
        default: 100,
      },
    },
    required: ['objects', 'pattern'],
  },
} as const;

interface GrepObjectsArgs {
  objects: Array<{ object_type?: string; object_name?: string }>;
  pattern: string;
  case_insensitive?: boolean;
  context_lines?: number;
  max_results?: number;
}

export async function handleGrepObjects(
  context: HandlerContext,
  args: GrepObjectsArgs,
) {
  const { connection, logger } = context;
  try {
    const objectsInput = args?.objects;
    if (!Array.isArray(objectsInput) || objectsInput.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'objects must be a non-empty array (1-50 entries)',
      );
    }
    if (objectsInput.length > MAX_OBJECTS) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `objects must contain at most ${MAX_OBJECTS} entries`,
      );
    }

    const caseInsensitive = args.case_insensitive === true;
    const contextLines = args.context_lines ?? 0;
    const maxResults = args.max_results ?? 100;

    // Validate the pattern up front so bad regex fails fast, before any SAP round-trips.
    const regex = compileGrepRegex(args.pattern, caseInsensitive);

    const client: AdtClient = createAdtClient(connection, logger);

    const inputs: ObjectGrepInput[] = new Array(objectsInput.length);
    await runWithConcurrency(
      objectsInput,
      FETCH_CONCURRENCY,
      async (item, index) => {
        const objectType = String(item?.object_type ?? '').trim();
        const objectName = String(item?.object_name ?? '').trim();
        if (!objectType || !objectName) {
          inputs[index] = {
            object_type: objectType || '(missing)',
            object_name: objectName || '(missing)',
            source: null,
            skip_reason: 'object_type and object_name are required',
          };
          return;
        }
        const { source, skipReason } = await fetchObjectSource(
          client,
          connection,
          objectType,
          objectName,
          logger,
        );
        inputs[index] = {
          object_type: objectType,
          object_name: objectName,
          source,
          skip_reason: skipReason,
        };
      },
    );

    const aggregate = aggregateGrepResults(inputs, regex, {
      context_lines: contextLines,
      max_results: maxResults,
    });

    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify(aggregate, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
