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
    let unexpandedDueToCap = 0;
    function addEdge(from, to, discoveredVia) {
        const key = `${from}|${to}`;
        if (edgeKeys.has(key))
            return;
        edgeKeys.add(key);
        edges.push({ from, to, kind: 'calls', discovered_via: discoveredVia });
    }
    let frontier = [rootId];
    let depth = 0;
    while (frontier.length > 0 && depth < maxDepth) {
        const nextFrontier = [];
        // Note: frontier nodes keep being expanded even after `truncated` flips
        // true (below) — an early return here would also skip picking up edges
        // between nodes that already exist in the graph, which is the bug this
        // fixes. Only the addition of brand-new nodes is capped.
        await (0, promisePool_1.runWithConcurrency)(frontier, concurrency, async (nodeId) => {
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
            if (result.partialFailure) {
                skipped.push({ node: nodeId, reason: result.partialFailure });
            }
            if (!result.expandable)
                return;
            expanded++;
            for (const neighbor of result.neighbors) {
                const neighborId = makeNodeId(neighbor.object_type, neighbor.name);
                const [from, to] = neighbor.role === 'caller'
                    ? [neighborId, nodeId]
                    : [nodeId, neighborId];
                const discoveredVia = neighbor.role === 'caller' ? 'where_used' : 'source_scan';
                if (!nodes.has(neighborId)) {
                    if (nodes.size >= maxNodes) {
                        truncated = true;
                        unexpandedDueToCap++;
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
                addEdge(from, to, discoveredVia);
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
            unexpanded_due_to_cap: unexpandedDueToCap,
        },
    };
}
function describeReason(reason) {
    return reason instanceof Error ? reason.message : String(reason);
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
            // Promise.allSettled (not Promise.all) so one direction throwing
            // doesn't discard the neighbors the other direction already found —
            // only give up entirely when BOTH directions fail.
            const [callersOutcome, calleesOutcome] = await Promise.allSettled([
                callersExpander(node),
                calleesExpander(node),
            ]);
            if (callersOutcome.status === 'rejected' &&
                calleesOutcome.status === 'rejected') {
                throw callersOutcome.reason instanceof Error
                    ? callersOutcome.reason
                    : new Error(String(callersOutcome.reason));
            }
            const callersResult = callersOutcome.status === 'fulfilled'
                ? callersOutcome.value
                : { neighbors: [], expandable: false };
            const calleesResult = calleesOutcome.status === 'fulfilled'
                ? calleesOutcome.value
                : { neighbors: [], expandable: false };
            const failures = [];
            if (callersOutcome.status === 'rejected') {
                failures.push(`callers direction failed: ${describeReason(callersOutcome.reason)}`);
            }
            if (calleesOutcome.status === 'rejected') {
                failures.push(`callees direction failed: ${describeReason(calleesOutcome.reason)}`);
            }
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
                partialFailure: failures.length > 0 ? failures.join('; ') : undefined,
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