"use strict";
/**
 * Builds a "compressed dependency prologue" for a class/interface/program
 * source read: scans the source for referenced classes/interfaces/function
 * modules, fetches each dependency's source, compresses it down to its
 * public contract, and assembles a single text block.
 *
 * Never throws — failures for individual dependencies are recorded as
 * skipped entries so the main source read is never affected.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_CONTEXT_MAX_DEPS = exports.DEFAULT_CONTEXT_MAX_DEPS = void 0;
exports.buildContextPrologue = buildContextPrologue;
const abapDependencyScan_1 = require("./abapDependencyScan");
const abapSignatureCompress_1 = require("./abapSignatureCompress");
const clients_1 = require("./clients");
exports.DEFAULT_CONTEXT_MAX_DEPS = 10;
exports.MAX_CONTEXT_MAX_DEPS = 15;
const MAX_CONCURRENT_FETCHES = 5;
/** Runs `fn` over `items` with at most `limit` in flight at once. Preserves
 * input order in the returned array regardless of completion order. */
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        for (;;) {
            const i = next++;
            if (i >= items.length)
                return;
            results[i] = await fn(items[i]);
        }
    }
    const workerCount = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}
/**
 * Scans `source` for dependencies and builds the compressed prologue text.
 * Returns an empty string if no dependencies were found.
 */
async function buildContextPrologue(context, source, maxDeps = exports.DEFAULT_CONTEXT_MAX_DEPS) {
    const cappedMaxDeps = Math.max(0, Math.min(maxDeps, exports.MAX_CONTEXT_MAX_DEPS));
    const deps = (0, abapDependencyScan_1.scanAbapDependencies)(source);
    const tasks = [
        ...deps.classes.map((name) => ({ kind: 'class', name })),
        ...deps.interfaces.map((name) => ({ kind: 'interface', name })),
        ...deps.functionModules.map((name) => ({ kind: 'fm', name })),
    ].slice(0, cappedMaxDeps);
    if (tasks.length === 0) {
        return '';
    }
    const { connection, logger } = context;
    const client = (0, clients_1.createAdtClient)(connection, logger);
    const results = await mapWithConcurrency(tasks, MAX_CONCURRENT_FETCHES, async (task) => {
        if (task.kind === 'fm') {
            return {
                status: 'skipped',
                kind: task.kind,
                name: task.name,
                reason: 'function module — function group required to fetch source, not resolved by static analysis',
            };
        }
        try {
            if (task.kind === 'class') {
                const result = await client
                    .getClass()
                    .read({ className: task.name }, 'active');
                const rawSource = result?.readResult?.data;
                if (typeof rawSource !== 'string' || !rawSource) {
                    throw new Error('empty response');
                }
                return {
                    status: 'resolved',
                    kind: task.kind,
                    name: task.name,
                    contract: (0, abapSignatureCompress_1.compressClass)(rawSource),
                };
            }
            const result = await client
                .getInterface()
                .read({ interfaceName: task.name }, 'active');
            const rawSource = result?.readResult?.data;
            if (typeof rawSource !== 'string' || !rawSource) {
                throw new Error('empty response');
            }
            return {
                status: 'resolved',
                kind: task.kind,
                name: task.name,
                contract: (0, abapSignatureCompress_1.compressInterface)(rawSource),
            };
        }
        catch (error) {
            const status = error?.response?.status;
            const reason = status === 404
                ? 'not found'
                : status
                    ? `HTTP ${status}`
                    : error?.message || 'fetch failed';
            return { status: 'skipped', kind: task.kind, name: task.name, reason };
        }
    });
    const resolved = results.filter((r) => r.status === 'resolved');
    const skipped = results.filter((r) => r.status === 'skipped');
    const lines = [
        '* ===== DEPENDENCY CONTEXT (compressed public contracts) =====',
        `* ${resolved.length} dependencies resolved, ${skipped.length} failed/skipped`,
    ];
    for (const dep of resolved) {
        lines.push('', `* ----- ${dep.kind.toUpperCase()}: ${dep.name} -----`, dep.contract);
    }
    if (skipped.length > 0) {
        lines.push('', '* ----- SKIPPED -----');
        for (const dep of skipped) {
            lines.push(`* ${dep.name} (${dep.kind}): ${dep.reason}`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=contextPrologue.js.map