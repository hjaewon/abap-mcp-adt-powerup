/**
 * GetCallGraph — server-side breadth-first call-relationship graph for an
 * ABAP object, replacing what would otherwise be dozens of round-trips of
 * GetWhereUsed (callers) combined with manual source reads + dependency
 * scanning (callees).
 *
 * Read-only: only queries where-used references and active source text,
 * never modifies objects.
 *
 * - callers: reuses the same underlying where-used client call as
 *   GetWhereUsed (client.getUtils().getWhereUsedList), expanding each
 *   discovered referencing object by querying ITS where-used in turn.
 * - callees: reuses fetchObjectSource (Phase-2 objectSourceFetch) + the
 *   regex-based scanAbapDependencies scanner to find classes/interfaces/
 *   function modules referenced in each node's source.
 *
 * Static analysis only — dynamic calls (CALL FUNCTION lv_name, dynamic
 * method dispatch, BAdI/enhancement injection) are not captured by either
 * the ADT where-used index or the regex scanner.
 */
import type { AdtClient } from '@babamba2/mcp-abap-adt-clients';
import type {
  IAbapConnection,
  ILogger,
} from '@babamba2/mcp-abap-adt-interfaces';
import { scanAbapDependencies } from '../../../lib/abapDependencyScan';
import {
  type CallGraphNeighbor,
  type CallGraphNode,
  combineDirectionExpanders,
  type ExpandResult,
  isCustomObject,
  makeNodeId,
  type NodeExpander,
  runCallGraphBfs,
} from '../../../lib/callGraph';
import { createAdtClient } from '../../../lib/clients';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  classifySourceType,
  fetchObjectSource,
} from '../../../lib/objectSourceFetch';
import { ErrorCode, McpError } from '../../../lib/utils';

const ROOT_OBJECT_TYPES = new Set(['CLAS', 'INTF', 'PROG', 'FUGR', 'FUNC']);
const MAX_DEPTH = 4;
const MAX_MAX_NODES = 300;
const DEFAULT_MAX_NODES = 100;
const DEFAULT_DEPTH = 2;

/** Maps our internal object-type codes to the object_type string expected by getWhereUsedList (FUNC handled separately — it needs "GROUP|NAME"). */
const WHERE_USED_TYPE: Record<string, string> = {
  CLAS: 'class',
  INTF: 'interface',
  PROG: 'program',
  FUGR: 'function',
  INCL: 'include',
};

export const TOOL_DEFINITION = {
  name: 'GetCallGraph',
  available_in: ['onprem', 'cloud', 'legacy'] as const,
  description:
    '[read-only] Build a call-relationship graph (callers and/or callees) for an ABAP object via server-side breadth-first traversal — replaces repeated round-trips of GetWhereUsed by expanding discovered nodes automatically up to a bounded depth and node count. Static analysis only: dynamic calls, BAdI dispatch, and other runtime-only wiring are not captured.',
  inputSchema: {
    type: 'object',
    properties: {
      object_type: {
        type: 'string',
        enum: ['CLAS', 'INTF', 'PROG', 'FUGR', 'FUNC'],
        description: 'Root ABAP object type.',
      },
      object_name: {
        type: 'string',
        description: 'Root ABAP object name.',
      },
      function_group: {
        type: 'string',
        description:
          'Function group name — required only when object_type is FUNC (function modules are addressed as GROUP|NAME).',
      },
      direction: {
        type: 'string',
        enum: ['callers', 'callees', 'both'],
        description:
          "'callers' = who uses the root (default), 'callees' = what the root calls, 'both' = both traversals merged into one graph.",
        default: 'callers',
      },
      depth: {
        type: 'number',
        description: 'Max BFS depth from the root (1-4). Default 2.',
        default: DEFAULT_DEPTH,
      },
      max_nodes: {
        type: 'number',
        description:
          'Global cap on total nodes in the returned graph (max 300). Default 100.',
        default: DEFAULT_MAX_NODES,
      },
      custom_only: {
        type: 'boolean',
        description:
          'When true (default), only Z*/Y*//NAMESPACE/ custom objects are expanded further during traversal — standard SAP objects still appear as leaf nodes but are not traversed past. The root is always expanded regardless of this flag.',
        default: true,
      },
    },
    required: ['object_type', 'object_name'],
  },
} as const;

interface GetCallGraphArgs {
  object_type: string;
  object_name: string;
  function_group?: string;
  direction?: 'callers' | 'callees' | 'both';
  depth?: number;
  max_nodes?: number;
  custom_only?: boolean;
}

/** Extracts the function group name from a function-module where-used reference's ADT URI (…/functions/groups/{group}/fmodules/{fm}). */
function extractFunctionGroupFromUri(uri?: string): string | undefined {
  if (!uri) return undefined;
  const match = uri.match(/\/functions\/groups\/([^/]+)\/fmodules\//i);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]).toUpperCase();
  } catch {
    return match[1].toUpperCase();
  }
}

/**
 * Builds the 'callers' direction expander: queries where-used for a node and
 * turns each reference into a neighbor with role 'caller'. Function-module
 * neighbors have their function group captured (from the reference URI) into
 * `functionGroupOf`, so they can be expanded in a later BFS level.
 */
function buildCallersExpander(
  client: AdtClient,
  functionGroupOf: Map<string, string>,
  customOnly: boolean,
): NodeExpander {
  return async (node: CallGraphNode): Promise<ExpandResult> => {
    if (customOnly && node.depth > 0 && !isCustomObject(node.name)) {
      return { neighbors: [], expandable: false };
    }

    let whereUsedType: string;
    let objectName = node.name;
    if (node.object_type === 'FUNC') {
      const group = functionGroupOf.get(node.id);
      if (!group) {
        // Function group could not be identified cheaply (no where-used URI
        // told us the group) — consistent with the known FUNC limitation.
        return { neighbors: [], expandable: false };
      }
      whereUsedType = 'functionmodule';
      objectName = `${group}|${node.name}`;
    } else {
      whereUsedType = WHERE_USED_TYPE[node.object_type];
      if (!whereUsedType) {
        return { neighbors: [], expandable: false };
      }
    }

    const utils = client.getUtils();
    const result = await utils.getWhereUsedList({
      object_name: objectName,
      object_type: whereUsedType,
    });

    const neighbors: CallGraphNeighbor[] = [];
    for (const ref of result.references) {
      if (!ref.name) continue;
      const refType = classifySourceType(ref.type) ?? 'OTHER';
      const neighborId = makeNodeId(refType, ref.name);
      if (neighborId === node.id) continue; // skip self-reference

      if (refType === 'FUNC') {
        const group =
          extractFunctionGroupFromUri(ref.uri) ??
          extractFunctionGroupFromUri(ref.parentUri);
        if (group && !functionGroupOf.has(neighborId)) {
          functionGroupOf.set(neighborId, group);
        }
      }

      neighbors.push({ object_type: refType, name: ref.name, role: 'caller' });
    }

    return { neighbors, expandable: true };
  };
}

/**
 * Builds the 'callees' direction expander: fetches a node's source (Phase-2
 * fetchObjectSource) and scans it (scanAbapDependencies) for classes,
 * interfaces, and function modules it references. Fetch failures (404,
 * structurally-unsupported types like FUNC) are thrown so the BFS engine
 * records them in `skipped` instead of silently dropping the reason.
 */
function buildCalleesExpander(
  client: AdtClient,
  connection: IAbapConnection,
  logger: ILogger | undefined,
  customOnly: boolean,
): NodeExpander {
  return async (node: CallGraphNode): Promise<ExpandResult> => {
    if (customOnly && node.depth > 0 && !isCustomObject(node.name)) {
      return { neighbors: [], expandable: false };
    }
    if (node.object_type === 'OTHER') {
      return { neighbors: [], expandable: false };
    }

    const { source, skipReason } = await fetchObjectSource(
      client,
      connection,
      node.object_type,
      node.name,
      logger,
    );
    if (skipReason || source == null) {
      throw new Error(skipReason ?? 'Source not available');
    }

    const deps = scanAbapDependencies(source);
    const neighbors: CallGraphNeighbor[] = [
      ...deps.classes.map((name) => ({
        object_type: 'CLAS',
        name,
        role: 'callee' as const,
      })),
      ...deps.interfaces.map((name) => ({
        object_type: 'INTF',
        name,
        role: 'callee' as const,
      })),
      ...deps.functionModules.map((name) => ({
        object_type: 'FUNC',
        name,
        role: 'callee' as const,
      })),
    ].filter((n) => makeNodeId(n.object_type, n.name) !== node.id);

    return { neighbors, expandable: true };
  };
}

export async function handleGetCallGraph(
  context: HandlerContext,
  args: GetCallGraphArgs,
) {
  const { connection, logger } = context;
  try {
    const objectType = String(args?.object_type ?? '')
      .trim()
      .toUpperCase();
    if (!objectType) {
      throw new McpError(ErrorCode.InvalidParams, 'object_type is required');
    }
    if (!ROOT_OBJECT_TYPES.has(objectType)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `object_type must be one of ${Array.from(ROOT_OBJECT_TYPES).join(', ')}`,
      );
    }

    const objectName = String(args?.object_name ?? '').trim();
    if (!objectName) {
      throw new McpError(ErrorCode.InvalidParams, 'object_name is required');
    }
    const rootName = objectName.toUpperCase();

    let functionGroup: string | undefined;
    if (objectType === 'FUNC') {
      functionGroup = String(args?.function_group ?? '')
        .trim()
        .toUpperCase();
      if (!functionGroup) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'function_group is required when object_type is FUNC',
        );
      }
    }

    const direction = args?.direction ?? 'callers';
    if (!['callers', 'callees', 'both'].includes(direction)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "direction must be 'callers', 'callees', or 'both'",
      );
    }

    const depth = Math.max(
      1,
      Math.min(MAX_DEPTH, Math.trunc(Number(args?.depth) || DEFAULT_DEPTH)),
    );
    const maxNodes = Math.max(
      1,
      Math.min(
        MAX_MAX_NODES,
        Math.trunc(Number(args?.max_nodes) || DEFAULT_MAX_NODES),
      ),
    );
    const customOnly = args?.custom_only !== false;

    const rootId = makeNodeId(objectType, rootName);
    logger?.info(
      `GetCallGraph: root=${rootId} direction=${direction} depth=${depth} max_nodes=${maxNodes} custom_only=${customOnly}`,
    );

    const client = createAdtClient(connection, logger);
    const functionGroupOf = new Map<string, string>();
    if (objectType === 'FUNC' && functionGroup) {
      functionGroupOf.set(rootId, functionGroup);
    }

    const callersExpander = buildCallersExpander(
      client,
      functionGroupOf,
      customOnly,
    );
    const calleesExpander = buildCalleesExpander(
      client,
      connection,
      logger,
      customOnly,
    );

    let expander: NodeExpander;
    if (direction === 'callers') expander = callersExpander;
    else if (direction === 'callees') expander = calleesExpander;
    else
      expander = combineDirectionExpanders(
        rootId,
        callersExpander,
        calleesExpander,
      );

    const result = await runCallGraphBfs(
      { object_type: objectType, name: rootName },
      expander,
      { maxDepth: depth, maxNodes },
    );

    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              root: rootId,
              direction,
              depth,
              truncated: result.truncated,
              stats: result.stats,
              nodes: result.nodes,
              edges: result.edges,
              skipped: result.skipped,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger?.error('Failed to build call graph', error as any);
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
