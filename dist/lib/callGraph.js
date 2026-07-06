"use strict";
/**
 * Pure BFS engine for GetCallGraph — generic call-relationship graph builder.
 *
 * No SAP/ADT/network dependencies — direction (callers vs callees) and the
 * actual ABAP data fetching are injected by the caller as async "expander"
 * callbacks, so this module can be exercised entirely with mock expanders in
 * unit tests. The handler (handleGetCallGraph.ts) wires real ADT where-used /
 * source-scan expanders into runCallGraphBfs().
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCustomObject = isCustomObject;
exports.makeNodeId = makeNodeId;
exports.runCallGraphBfs = runCallGraphBfs;
exports.combineDirectionExpanders = combineDirectionExpanders;
const promisePool_1 = require("./promisePool");
/** Default concurrency for expanding one BFS frontier level. */
const DEFAULT_CONCURRENCY = 5;
/** Matches Z- or Y-prefixed custom objects and namespaced (/NS/...) objects. */
const CUSTOM_OBJECT_RE = /^\/[A-Z0-9_]+\/|^[YZ]/i;
/** Returns true when `name` looks like a customer object (Z-/Y-prefixed, or /NAMESPACE/...). */
function isCustomObject(name) {
    return CUSTOM_OBJECT_RE.test(name ?? '');
}
/** Deterministic node id: `${OBJECT_TYPE}:${NAME}`, both uppercased. */
function makeNodeId(objectType, name) {
    return `${(objectType ?? '').toUpperCase()}:${(name ?? '').toUpperCase()}`;
}
/**
 * Runs a breadth-first traversal starting from `root`, expanding each node
 * via `expander` up to `options.maxDepth` levels or `options.maxNodes` total
 * nodes, whichever comes first.
 *
 * Cycle-safe (a node is only ever expanded once) and resilient to individual
 * expander failures (caught and recorded in `skipped`, never thrown).
 */
async function runCallGraphBfs(root, expander, options) {
    const maxDepth = Math.max(1, Math.min(4, options.maxDepth));
    const maxNodes = Math.max(1, options.maxNodes);
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    const rootId = makeNodeId(root.object_type, root.name);
    const nodes = new Map();
    nodes.set(rootId, {
        id: rootId,
        object_type: root.object_type,
        name: root.name,
        depth: 0,
        expandable: true,
    });
    const edgeKeys = new Set();
    const edges = [];
    const skipped = [];
    let truncated = false;
    let expanded = 0;
    function addEdge(from, to, kind) {
        const key = `${from}|${to}|${kind}`;
        if (edgeKeys.has(key))
            return;
        edgeKeys.add(key);
        edges.push({ from, to, kind });
    }
    let frontier = [rootId];
    let depth = 0;
    while (frontier.length > 0 && depth < maxDepth) {
        const nextFrontier = [];
        await (0, promisePool_1.runWithConcurrency)(frontier, concurrency, async (nodeId) => {
            if (truncated)
                return;
            const node = nodes.get(nodeId);
            if (!node)
                return;
            let result;
            try {
                result = await expander(node);
            }
            catch (error) {
                node.expandable = false;
                skipped.push({
                    node: nodeId,
                    reason: error instanceof Error ? error.message : String(error),
                });
                return;
            }
            node.expandable = result.expandable;
            expanded++;
            if (!result.expandable)
                return;
            for (const neighbor of result.neighbors) {
                const neighborId = makeNodeId(neighbor.object_type, neighbor.name);
                const [from, to, kind] = neighbor.role === 'caller'
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
function combineDirectionExpanders(rootId, callersExpander, calleesExpander) {
    const roleOf = new Map();
    return async (node) => {
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
                if (!roleOf.has(id))
                    roleOf.set(id, 'callee');
            }
            return {
                neighbors: [...callersResult.neighbors, ...calleesResult.neighbors],
                expandable: callersResult.expandable || calleesResult.expandable,
            };
        }
        const role = roleOf.get(node.id) ?? 'callee';
        const result = role === 'caller'
            ? await callersExpander(node)
            : await calleesExpander(node);
        for (const n of result.neighbors) {
            const id = makeNodeId(n.object_type, n.name);
            if (!roleOf.has(id))
                roleOf.set(id, role);
        }
        return result;
    };
}
//# sourceMappingURL=callGraph.js.map