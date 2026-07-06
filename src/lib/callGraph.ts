/**
 * Pure BFS engine for GetCallGraph — generic call-relationship graph builder.
 *
 * No SAP/ADT/network dependencies — direction (callers vs callees) and the
 * actual ABAP data fetching are injected by the caller as async "expander"
 * callbacks, so this module can be exercised entirely with mock expanders in
 * unit tests. The handler (handleGetCallGraph.ts) wires real ADT where-used /
 * source-scan expanders into runCallGraphBfs().
 */

import { runWithConcurrency } from './promisePool';

/** Default concurrency for expanding one BFS frontier level. */
const DEFAULT_CONCURRENCY = 5;

/** Matches Z- or Y-prefixed custom objects and namespaced (/NS/...) objects. */
const CUSTOM_OBJECT_RE = /^\/[A-Z0-9_]+\/|^[YZ]/i;

/** Returns true when `name` looks like a customer object (Z-/Y-prefixed, or /NAMESPACE/...). */
export function isCustomObject(name: string): boolean {
  return CUSTOM_OBJECT_RE.test(name ?? '');
}

/** Deterministic node id: `${OBJECT_TYPE}:${NAME}`, both uppercased. */
export function makeNodeId(objectType: string, name: string): string {
  return `${(objectType ?? '').toUpperCase()}:${(name ?? '').toUpperCase()}`;
}

export interface CallGraphNodeRef {
  object_type: string;
  name: string;
}

/**
 * A neighbor discovered while expanding a node.
 * - role 'caller': the neighbor calls/uses the node being expanded (edge points neighbor -> node).
 * - role 'callee': the node being expanded calls/uses the neighbor (edge points node -> neighbor).
 */
export interface CallGraphNeighbor extends CallGraphNodeRef {
  role: 'caller' | 'callee';
}

export interface ExpandResult {
  neighbors: CallGraphNeighbor[];
  /** Whether this node was eligible for expansion (type supported + custom_only gate). */
  expandable: boolean;
}

export interface CallGraphNode extends CallGraphNodeRef {
  id: string;
  depth: number;
  /**
   * True until an expansion attempt says otherwise. A node left at the depth
   * limit (never handed to the expander) keeps the default `true`, meaning
   * "not yet expanded" rather than "ineligible for expansion".
   */
  expandable: boolean;
}

export interface CallGraphEdge {
  from: string;
  to: string;
  kind: 'calls' | 'used_by';
}

export interface SkippedNode {
  node: string;
  reason: string;
}

export interface CallGraphStats {
  node_count: number;
  edge_count: number;
  expanded: number;
  skipped_count: number;
}

export interface CallGraphResult {
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
  truncated: boolean;
  skipped: SkippedNode[];
  stats: CallGraphStats;
}

export type NodeExpander = (node: CallGraphNode) => Promise<ExpandResult>;

export interface CallGraphOptions {
  /** Max BFS depth from the root (clamped to 1-4). */
  maxDepth: number;
  /** Global cap on total nodes in the returned graph. */
  maxNodes: number;
  /** Bounded concurrency per BFS level. Default 5. */
  concurrency?: number;
}

/**
 * Runs a breadth-first traversal starting from `root`, expanding each node
 * via `expander` up to `options.maxDepth` levels or `options.maxNodes` total
 * nodes, whichever comes first.
 *
 * Cycle-safe (a node is only ever expanded once) and resilient to individual
 * expander failures (caught and recorded in `skipped`, never thrown).
 */
export async function runCallGraphBfs(
  root: CallGraphNodeRef,
  expander: NodeExpander,
  options: CallGraphOptions,
): Promise<CallGraphResult> {
  const maxDepth = Math.max(1, Math.min(4, options.maxDepth));
  const maxNodes = Math.max(1, options.maxNodes);
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  const rootId = makeNodeId(root.object_type, root.name);
  const nodes = new Map<string, CallGraphNode>();
  nodes.set(rootId, {
    id: rootId,
    object_type: root.object_type,
    name: root.name,
    depth: 0,
    expandable: true,
  });

  const edgeKeys = new Set<string>();
  const edges: CallGraphEdge[] = [];
  const skipped: SkippedNode[] = [];
  let truncated = false;
  let expanded = 0;

  function addEdge(from: string, to: string, kind: 'calls' | 'used_by'): void {
    const key = `${from}|${to}|${kind}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, kind });
  }

  let frontier = [rootId];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    const nextFrontier: string[] = [];

    await runWithConcurrency(frontier, concurrency, async (nodeId) => {
      if (truncated) return;
      const node = nodes.get(nodeId);
      if (!node) return;

      let result: ExpandResult;
      try {
        result = await expander(node);
      } catch (error) {
        node.expandable = false;
        skipped.push({
          node: nodeId,
          reason: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      node.expandable = result.expandable;
      expanded++;
      if (!result.expandable) return;

      for (const neighbor of result.neighbors) {
        const neighborId = makeNodeId(neighbor.object_type, neighbor.name);
        const [from, to, kind]: [string, string, 'calls' | 'used_by'] =
          neighbor.role === 'caller'
            ? [neighborId, nodeId, 'used_by']
            : [nodeId, neighborId, 'calls'];

        if (!nodes.has(neighborId)) {
          if (nodes.size >= maxNodes) {
            truncated = true;
            continue; // drop this neighbor entirely — keep nodes/edges consistent
          }
          nodes.set(neighborId, {
            id: neighborId,
            object_type: neighbor.object_type,
            name: neighbor.name,
            depth: node.depth + 1,
            expandable: true,
          });
          nextFrontier.push(neighborId);
        }
        addEdge(from, to, kind);
      }
    });

    frontier = nextFrontier;
    depth++;
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    truncated,
    skipped,
    stats: {
      node_count: nodes.size,
      edge_count: edges.length,
      expanded,
      skipped_count: skipped.length,
    },
  };
}

/**
 * Combines a callers-expander and a callees-expander into a single expander
 * for direction:'both'. The root is expanded with BOTH directions at once
 * (merged neighbor list); every other node is expanded only in whichever
 * direction first discovered it, so "root's callers" and "root's callees"
 * remain separate subtrees instead of crossing over mid-traversal.
 */
export function combineDirectionExpanders(
  rootId: string,
  callersExpander: NodeExpander,
  calleesExpander: NodeExpander,
): NodeExpander {
  const roleOf = new Map<string, 'caller' | 'callee'>();

  return async (node: CallGraphNode): Promise<ExpandResult> => {
    if (node.id === rootId) {
      const [callersResult, calleesResult] = await Promise.all([
        callersExpander(node),
        calleesExpander(node),
      ]);
      for (const n of callersResult.neighbors) {
        roleOf.set(makeNodeId(n.object_type, n.name), 'caller');
      }
      for (const n of calleesResult.neighbors) {
        const id = makeNodeId(n.object_type, n.name);
        if (!roleOf.has(id)) roleOf.set(id, 'callee');
      }
      return {
        neighbors: [...callersResult.neighbors, ...calleesResult.neighbors],
        expandable: callersResult.expandable || calleesResult.expandable,
      };
    }

    const role = roleOf.get(node.id) ?? 'callee';
    const result =
      role === 'caller'
        ? await callersExpander(node)
        : await calleesExpander(node);
    for (const n of result.neighbors) {
      const id = makeNodeId(n.object_type, n.name);
      if (!roleOf.has(id)) roleOf.set(id, role);
    }
    return result;
  };
}
