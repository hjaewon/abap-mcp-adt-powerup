"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleGetSourceDiff = handleGetSourceDiff;
const clients_1 = require("../../../lib/clients");
const textDiff_1 = require("../../../lib/textDiff");
const utils_1 = require("../../../lib/utils");
exports.TOOL_DEFINITION = {
    name: 'GetSourceDiff',
    available_in: ['onprem', 'cloud', 'legacy'],
    description: '[read-only] Compute a unified diff between the source code of two ABAP objects (e.g. compare ZCL_A vs ZCL_B, or a program vs a copy of itself). Supports CLAS, PROG, INTF, INCL.',
    inputSchema: {
        type: 'object',
        properties: {
            object_type_a: {
                type: 'string',
                enum: ['CLAS', 'PROG', 'INTF', 'INCL'],
                description: 'Object type of the first (left / "old") object.',
            },
            object_name_a: {
                type: 'string',
                description: 'Object name of the first (left / "old") object.',
            },
            object_type_b: {
                type: 'string',
                enum: ['CLAS', 'PROG', 'INTF', 'INCL'],
                description: 'Object type of the second (right / "new") object.',
            },
            object_name_b: {
                type: 'string',
                description: 'Object name of the second (right / "new") object.',
            },
            context_lines: {
                type: 'number',
                description: 'Number of unchanged context lines around each change.',
                default: 3,
            },
        },
        required: [
            'object_type_a',
            'object_name_a',
            'object_type_b',
            'object_name_b',
        ],
    },
};
const SUPPORTED_TYPES = ['CLAS', 'PROG', 'INTF', 'INCL'];
function extractSourceData(data) {
    if (data === null || data === undefined)
        return '';
    return typeof data === 'string' ? data : JSON.stringify(data);
}
async function fetchSource(context, objectType, objectName) {
    const { connection, logger } = context;
    const type = objectType.toUpperCase();
    const name = objectName.toUpperCase();
    if (type === 'INCL') {
        const url = `/sap/bc/adt/programs/includes/${(0, utils_1.encodeSapObjectName)(name)}/source/main`;
        const response = await (0, utils_1.makeAdtRequestWithTimeout)(connection, url, 'GET', 'default');
        return extractSourceData(response.data);
    }
    const client = (0, clients_1.createAdtClient)(connection, logger);
    if (type === 'CLAS') {
        const result = await client.getClass().read({ className: name }, 'active');
        return extractSourceData(result?.readResult?.data);
    }
    if (type === 'PROG') {
        const result = await client
            .getProgram()
            .read({ programName: name }, 'active');
        return extractSourceData(result?.readResult?.data);
    }
    if (type === 'INTF') {
        const result = await client
            .getInterface()
            .read({ interfaceName: name }, 'active');
        return extractSourceData(result?.readResult?.data);
    }
    throw new utils_1.McpError(utils_1.ErrorCode.InvalidParams, `Unsupported object_type "${objectType}". Supported: ${SUPPORTED_TYPES.join(', ')}`);
}
async function handleGetSourceDiff(context, args) {
    try {
        const { object_type_a, object_name_a, object_type_b, object_name_b, context_lines = 3, } = args ?? {};
        if (!object_type_a || !object_name_a || !object_type_b || !object_name_b) {
            throw new utils_1.McpError(utils_1.ErrorCode.InvalidParams, 'object_type_a, object_name_a, object_type_b, object_name_b are all required');
        }
        const typeA = object_type_a.toUpperCase();
        const typeB = object_type_b.toUpperCase();
        if (!SUPPORTED_TYPES.includes(typeA) || !SUPPORTED_TYPES.includes(typeB)) {
            throw new utils_1.McpError(utils_1.ErrorCode.InvalidParams, `object_type must be one of ${SUPPORTED_TYPES.join(', ')}`);
        }
        const [sourceA, sourceB] = await Promise.all([
            fetchSource(context, typeA, object_name_a),
            fetchSource(context, typeB, object_name_b),
        ]);
        const result = (0, textDiff_1.computeUnifiedDiff)(sourceA, sourceB, {
            contextLines: context_lines,
            oldLabel: `${object_name_a.toUpperCase()} (${typeA})`,
            newLabel: `${object_name_b.toUpperCase()} (${typeB})`,
        });
        return {
            isError: false,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        identical: result.identical,
                        diff: result.diff,
                        stats: result.stats,
                    }),
                },
            ],
        };
    }
    catch (error) {
        return (0, utils_1.return_error)(error);
    }
}
//# sourceMappingURL=handleGetSourceDiff.js.map