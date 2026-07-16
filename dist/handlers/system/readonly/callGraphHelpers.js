"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCalleeFetchableType = isCalleeFetchableType;
exports.resolveFuncCalleeTarget = resolveFuncCalleeTarget;
exports.resolveNeighborObjectType = resolveNeighborObjectType;
const objectSourceFetch_1 = require("../../../lib/objectSourceFetch");
/** ABAP object types whose source GetCallGraph's callees expander can fetch and scan. */
const CALLEE_SOURCE_TYPES = new Set([
    'CLAS',
    'PROG',
    'INTF',
    'INCL',
    'FUGR',
    'FUNC',
]);
/** True when a node's object_type is one the callees expander can fetch source for. */
function isCalleeFetchableType(objectType) {
    return CALLEE_SOURCE_TYPES.has(objectType);
}
/**
 * Resolves the {function group, function module} pair needed to read a FUNC
 * node's source directly via client.getFunctionModule().read(...), or null
 * when the function group is not known for this node — the pre-existing
 * FUNC limitation (the node is then left to fall back to the generic
 * fetchObjectSource() skip path).
 */
function resolveFuncCalleeTarget(node, functionGroupOf) {
    if (node.object_type !== 'FUNC')
        return null;
    const group = functionGroupOf.get(node.id);
    if (!group)
        return null;
    return { functionModuleName: node.name, functionGroupName: group };
}
/** Uppercased ADT-type prefix before the first '/', e.g. "DDLS/DF" -> "DDLS". Falls back to "OTHER" for empty input. */
function rawTypePrefix(adtType) {
    const t = (adtType ?? '').trim().toUpperCase();
    if (!t)
        return 'OTHER';
    const slash = t.indexOf('/');
    return slash === -1 ? t : t.slice(0, slash) || 'OTHER';
}
/**
 * Resolves the object_type to store on a graph node for a where-used
 * reference: the normalized source-fetch code (CLAS/PROG/INTF/INCL/FUGR/
 * FUNC) when recognized, otherwise the raw ADT type's prefix (e.g. "DDLS",
 * "TABL", "WDYN") so unsupported types remain identifiable in the output
 * instead of collapsing into a generic "OTHER".
 */
function resolveNeighborObjectType(rawAdtType) {
    return (0, objectSourceFetch_1.classifySourceType)(rawAdtType) ?? rawTypePrefix(rawAdtType);
}
//# sourceMappingURL=callGraphHelpers.js.map