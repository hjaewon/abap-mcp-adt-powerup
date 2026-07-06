"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleGrepPackages = handleGrepPackages;
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const clients_1 = require("../../../lib/clients");
const objectSourceFetch_1 = require("../../../lib/objectSourceFetch");
const promisePool_1 = require("../../../lib/promisePool");
const sourceGrep_1 = require("../../../lib/sourceGrep");
const MAX_PACKAGES = 10;
const FETCH_CONCURRENCY = 5;
exports.TOOL_DEFINITION = {
    name: 'GrepPackages',
    available_in: ['onprem', 'cloud', 'legacy'],
    description: "[read-only] Search ABAP source code for a regex pattern across every object in one or more packages, in a single call — finds matching lines (with optional context) instead of listing then reading objects one by one. Scans CLAS, PROG, INTF, INCL, and FUGR (function group) objects; other repository object types (tables, data elements, domains, etc.) are skipped since they carry no source text. Optionally recurses into subpackages and can filter to specific object types (e.g. ['CLAS','PROG']).",
    inputSchema: {
        type: 'object',
        properties: {
            packages: {
                type: 'array',
                description: 'Package names to search (1-10 entries).',
                items: { type: 'string' },
                minItems: 1,
                maxItems: MAX_PACKAGES,
            },
            pattern: {
                type: 'string',
                description: 'JavaScript regular expression source to search for (e.g. "SELECT\\\\s+\\\\*").',
            },
            case_insensitive: {
                type: 'boolean',
                description: 'Case-insensitive match. Default: false.',
                default: false,
            },
            context_lines: {
                type: 'number',
                description: 'Number of lines of context before/after each match (0-5). Default: 0.',
                default: 0,
            },
            max_results: {
                type: 'number',
                description: 'Maximum total matches to return across all objects. Once reached, remaining objects are not fetched. Default: 200.',
                default: 200,
            },
            include_subpackages: {
                type: 'boolean',
                description: 'Recurse into subpackages. Default: false.',
                default: false,
            },
            object_types: {
                type: 'array',
                description: "Optional filter to only scan these object types (e.g. ['CLAS','PROG']). Allowed: CLAS, PROG, INTF, INCL, FUGR. If omitted, all source-bearing types are scanned.",
                items: { type: 'string' },
            },
        },
        required: ['packages', 'pattern'],
    },
};
async function handleGrepPackages(context, args) {
    const { connection, logger } = context;
    try {
        const packages = args?.packages;
        if (!Array.isArray(packages) || packages.length === 0) {
            throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidParams, 'packages must be a non-empty array (1-10 entries)');
        }
        if (packages.length > MAX_PACKAGES) {
            throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidParams, `packages must contain at most ${MAX_PACKAGES} entries`);
        }
        const caseInsensitive = args.case_insensitive === true;
        const contextLines = args.context_lines ?? 0;
        const maxResults = args.max_results ?? 200;
        const includeSubpackages = args.include_subpackages === true;
        const typeFilter = Array.isArray(args.object_types)
            ? new Set(args.object_types
                .map((t) => (0, objectSourceFetch_1.classifySourceType)(t))
                .filter((c) => !!c && c !== 'FUNC'))
            : undefined;
        // Validate the pattern up front so bad regex fails fast, before any SAP round-trips.
        const regex = (0, sourceGrep_1.compileGrepRegex)(args.pattern, caseInsensitive);
        const client = (0, clients_1.createAdtClient)(connection, logger);
        const utils = client.getUtils();
        // 1. Enumerate package contents (recursing into subpackages when requested).
        const candidates = [];
        for (const rawName of packages) {
            const packageName = String(rawName ?? '')
                .trim()
                .toUpperCase();
            if (!packageName)
                continue;
            const items = await utils.getPackageContentsList(packageName, {
                includeSubpackages,
                includeDescriptions: false,
            });
            for (const item of items) {
                if (item.isPackage)
                    continue;
                const code = (0, objectSourceFetch_1.classifySourceType)(item.adtType);
                // FUNC (individual function modules) is structurally unsupported — see
                // fetchObjectSource. Skip quietly rather than filling `skipped` with
                // one entry per function module in every function group.
                if (!code || code === 'FUNC')
                    continue;
                if (typeFilter && !typeFilter.has(code))
                    continue;
                candidates.push({ object_type: code, object_name: item.name });
            }
        }
        // 2. Scan candidates with bounded concurrency, stopping once max_results is hit.
        const results = [];
        const skipped = [];
        let totalMatches = 0;
        let objectsScanned = 0;
        let capReached = false;
        await (0, promisePool_1.runWithConcurrency)(candidates, FETCH_CONCURRENCY, async (candidate) => {
            const label = `${candidate.object_type} ${candidate.object_name}`;
            if (capReached) {
                skipped.push({
                    object: label,
                    reason: 'max_results reached; object not scanned',
                });
                return;
            }
            const { source, skipReason } = await (0, objectSourceFetch_1.fetchObjectSource)(client, connection, candidate.object_type, candidate.object_name, logger);
            if (capReached) {
                skipped.push({
                    object: label,
                    reason: 'max_results reached; object not scanned',
                });
                return;
            }
            if (skipReason || source == null) {
                skipped.push({
                    object: label,
                    reason: skipReason ?? 'Source not available',
                });
                return;
            }
            const remaining = maxResults - totalMatches;
            if (remaining <= 0) {
                capReached = true;
                skipped.push({
                    object: label,
                    reason: 'max_results reached; object not scanned',
                });
                return;
            }
            objectsScanned++;
            const { matches, matchLimitReached, lineCapReached } = (0, sourceGrep_1.grepText)(source, regex, contextLines, remaining);
            if (matches.length > 0) {
                const entry = {
                    object_type: candidate.object_type,
                    object_name: candidate.object_name,
                    matches,
                };
                if (lineCapReached)
                    entry.truncated_object = true;
                results.push(entry);
                totalMatches += matches.length;
            }
            else if (lineCapReached) {
                // Oversized object, scanned up to the line cap, with no matches
                // found in the scanned portion — this must not stop the scan of
                // other candidates or count toward max_results.
                skipped.push({
                    object: label,
                    reason: `object exceeds the ${sourceGrep_1.MAX_LINES_PER_OBJECT}-line scan cap; no matches found in the scanned portion`,
                });
            }
            if (matchLimitReached || totalMatches >= maxResults) {
                capReached = true;
            }
        });
        return {
            isError: false,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        total_matches: totalMatches,
                        truncated: capReached,
                        results,
                        skipped,
                        packages_scanned: packages.length,
                        objects_scanned: objectsScanned,
                        objects_skipped: skipped.length,
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
//# sourceMappingURL=handleGrepPackages.js.map