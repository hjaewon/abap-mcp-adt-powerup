"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleGrepObjects = handleGrepObjects;
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const clients_1 = require("../../../lib/clients");
const objectSourceFetch_1 = require("../../../lib/objectSourceFetch");
const promisePool_1 = require("../../../lib/promisePool");
const sourceGrep_1 = require("../../../lib/sourceGrep");
const MAX_OBJECTS = 50;
const FETCH_CONCURRENCY = 5;
exports.TOOL_DEFINITION = {
    name: 'GrepObjects',
    available_in: ['onprem', 'cloud', 'legacy'],
    description: '[read-only] Search ABAP source code for a regex pattern across multiple named objects in a single call — finds matching lines (with optional context) instead of reading each object one by one. Supports CLAS, PROG, INTF, INCL, and FUGR (function group). Individual function modules (FUNC) are not supported; use FUGR with the group name to search the whole group.',
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
                description: 'Maximum total matches to return across all objects. Default: 100.',
                default: 100,
            },
        },
        required: ['objects', 'pattern'],
    },
};
async function handleGrepObjects(context, args) {
    const { connection, logger } = context;
    try {
        const objectsInput = args?.objects;
        if (!Array.isArray(objectsInput) || objectsInput.length === 0) {
            throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidParams, 'objects must be a non-empty array (1-50 entries)');
        }
        if (objectsInput.length > MAX_OBJECTS) {
            throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidParams, `objects must contain at most ${MAX_OBJECTS} entries`);
        }
        const caseInsensitive = args.case_insensitive === true;
        const contextLines = args.context_lines ?? 0;
        const maxResults = args.max_results ?? 100;
        // Validate the pattern up front so bad regex fails fast, before any SAP round-trips.
        const regex = (0, sourceGrep_1.compileGrepRegex)(args.pattern, caseInsensitive);
        const client = (0, clients_1.createAdtClient)(connection, logger);
        const inputs = new Array(objectsInput.length);
        await (0, promisePool_1.runWithConcurrency)(objectsInput, FETCH_CONCURRENCY, async (item, index) => {
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
            const { source, skipReason } = await (0, objectSourceFetch_1.fetchObjectSource)(client, connection, objectType, objectName, logger);
            inputs[index] = {
                object_type: objectType,
                object_name: objectName,
                source,
                skip_reason: skipReason,
            };
        });
        const aggregate = (0, sourceGrep_1.aggregateGrepResults)(inputs, regex, {
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
//# sourceMappingURL=handleGrepObjects.js.map