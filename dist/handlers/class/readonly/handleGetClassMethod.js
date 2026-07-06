"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleGetClassMethod = handleGetClassMethod;
const abapMethodBoundaries_1 = require("../../../lib/abapMethodBoundaries");
const clients_1 = require("../../../lib/clients");
const utils_1 = require("../../../lib/utils");
exports.TOOL_DEFINITION = {
    name: 'GetClassMethod',
    available_in: ['onprem', 'cloud', 'legacy'],
    description: '[read-only] Read the source of a single method implementation (the METHOD...ENDMETHOD block) from an ABAP class, without fetching the entire class source. Use this instead of GetClass/ReadClass when only one method needs inspecting — dramatically smaller than reading the whole class.',
    inputSchema: {
        type: 'object',
        properties: {
            class_name: {
                type: 'string',
                description: 'Class name (e.g., ZCL_MY_CLASS).',
            },
            method_name: {
                type: 'string',
                description: "Method name to extract (e.g. 'GET_DATA', or for interface method implementations 'ZIF_FOO~BAR').",
            },
        },
        required: ['class_name', 'method_name'],
    },
};
async function handleGetClassMethod(context, args) {
    const { connection, logger } = context;
    try {
        const { class_name, method_name } = args;
        if (!class_name || !method_name) {
            return (0, utils_1.return_error)(new Error('class_name and method_name are required'));
        }
        const className = class_name.toUpperCase();
        const client = (0, clients_1.createAdtClient)(connection, logger);
        logger?.info(`Reading method ${method_name} of class ${className}`);
        const readResult = await client.getClass().read({ className }, 'active');
        if (!readResult?.readResult) {
            return (0, utils_1.return_error)(new Error(`Class ${className} not found`));
        }
        const sourceCode = typeof readResult.readResult.data === 'string'
            ? readResult.readResult.data
            : JSON.stringify(readResult.readResult.data);
        const totalClassLines = sourceCode.split(/\r\n|\r|\n/).length;
        const boundary = (0, abapMethodBoundaries_1.findMethodBoundary)(sourceCode, method_name);
        if (!boundary) {
            const available = (0, abapMethodBoundaries_1.listMethodImplementations)(sourceCode).map((m) => m.name);
            return (0, utils_1.return_error)(new Error(`Method "${method_name}" not found in class ${className}. Available methods: ${available.length > 0 ? available.join(', ') : '(none found)'}`));
        }
        const methodSource = (0, abapMethodBoundaries_1.extractMethodSource)(sourceCode, boundary);
        logger?.info(`GetClassMethod completed: ${className}.${boundary.name} (lines ${boundary.startLine}-${boundary.endLine})`);
        return (0, utils_1.return_response)({
            data: JSON.stringify({
                class_name: className,
                method_name: boundary.name,
                start_line: boundary.startLine,
                end_line: boundary.endLine,
                total_class_lines: totalClassLines,
                source: methodSource,
            }, null, 2),
        });
    }
    catch (error) {
        return (0, utils_1.return_error)(error);
    }
}
//# sourceMappingURL=handleGetClassMethod.js.map