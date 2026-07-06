"use strict";
/**
 * UpdateClassMethod Handler - Update a single method implementation
 * (METHOD...ENDMETHOD block) of an existing ABAP class.
 *
 * Splices the replacement method block into the current full class source,
 * then delegates the actual write to handleUpdateClass (lock -> syntax
 * check on the full reconstructed class -> update -> unlock -> optional
 * activate). Because the syntax check validates the full reconstructed
 * class, a broken method never lands.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleUpdateClassMethod = handleUpdateClassMethod;
const abapMethodBoundaries_1 = require("../../../lib/abapMethodBoundaries");
const clients_1 = require("../../../lib/clients");
const utils_1 = require("../../../lib/utils");
const handleUpdateClass_1 = require("./handleUpdateClass");
exports.TOOL_DEFINITION = {
    name: 'UpdateClassMethod',
    available_in: ['onprem', 'cloud', 'legacy'],
    description: 'Update a single method implementation (METHOD...ENDMETHOD block) of an existing ABAP class without sending the entire class source. Splices the replacement into the current class source, then locks, syntax-checks the full reconstructed class, updates, unlocks, and optionally activates — a broken method never lands.',
    inputSchema: {
        type: 'object',
        properties: {
            class_name: {
                type: 'string',
                description: 'Class name (e.g., ZCL_MY_CLASS).',
            },
            method_name: {
                type: 'string',
                description: "Method name to replace (e.g. 'GET_DATA', or for interface method implementations 'ZIF_FOO~BAR').",
            },
            source: {
                type: 'string',
                description: 'Full replacement method block. Must start with "METHOD <name>." and end with "ENDMETHOD." (leading/trailing blank lines tolerated); the name must match method_name.',
            },
            transport_request: {
                type: 'string',
                description: 'Transport request number (e.g., E19K905635). Required for transportable packages.',
            },
            activate: {
                type: 'boolean',
                description: 'Activate after update. Default: false.',
            },
        },
        required: ['class_name', 'method_name', 'source'],
    },
};
async function handleUpdateClassMethod(context, args) {
    const { connection, logger } = context;
    try {
        const { class_name, method_name, source } = args;
        if (!class_name || !method_name || !source) {
            return (0, utils_1.return_error)(new Error('class_name, method_name, and source are required'));
        }
        const className = class_name.toUpperCase();
        const client = (0, clients_1.createAdtClient)(connection, logger);
        logger?.info(`Updating method ${method_name} of class ${className}`);
        const readResult = await client.getClass().read({ className }, 'active');
        if (!readResult?.readResult) {
            return (0, utils_1.return_error)(new Error(`Class ${className} not found`));
        }
        const currentSource = typeof readResult.readResult.data === 'string'
            ? readResult.readResult.data
            : JSON.stringify(readResult.readResult.data);
        const boundary = (0, abapMethodBoundaries_1.findMethodBoundary)(currentSource, method_name);
        if (!boundary) {
            const available = (0, abapMethodBoundaries_1.listMethodImplementations)(currentSource).map((m) => m.name);
            return (0, utils_1.return_error)(new Error(`Method "${method_name}" not found in class ${className}. Available methods: ${available.length > 0 ? available.join(', ') : '(none found)'}`));
        }
        const validation = (0, abapMethodBoundaries_1.validateMethodBlock)(source, method_name);
        if (!validation.valid) {
            return (0, utils_1.return_error)(new Error(`Invalid replacement source: ${validation.error}`));
        }
        const newFullSource = (0, abapMethodBoundaries_1.spliceMethodSource)(currentSource, boundary, source);
        const newClassLineCount = newFullSource.split(/\r\n|\r|\n/).length;
        const delegatedResult = await (0, handleUpdateClass_1.handleUpdateClass)(context, {
            class_name: className,
            source_code: newFullSource,
            transport_request: args.transport_request,
            activate: args.activate,
        });
        if (delegatedResult?.isError) {
            // Forward the delegated failure as-is (e.g. structured syntax-check
            // diagnostics from the pre-write check) — the broken method never
            // reaches SAP.
            return delegatedResult;
        }
        let delegatedInfo = {};
        try {
            const text = delegatedResult?.content?.[0]?.text;
            if (typeof text === 'string') {
                delegatedInfo = JSON.parse(text);
            }
        }
        catch {
            // Non-fatal: keep delegatedInfo empty if the delegated payload isn't
            // parseable JSON for some reason.
        }
        const activated = delegatedInfo.activated ??
            args.activate === true;
        const checkWarnings = delegatedInfo
            .check_warnings;
        logger?.info(`UpdateClassMethod completed: ${className}.${boundary.name} (lines ${boundary.startLine}-${boundary.endLine})`);
        return (0, utils_1.return_response)({
            data: JSON.stringify({
                success: true,
                class_name: className,
                method_name: boundary.name,
                replaced_start_line: boundary.startLine,
                replaced_end_line: boundary.endLine,
                new_class_line_count: newClassLineCount,
                activated,
                check_warnings: checkWarnings,
                message: `Method ${boundary.name} of class ${className} updated${activated ? ' and activated' : ''} successfully`,
            }, null, 2),
        });
    }
    catch (error) {
        return (0, utils_1.return_error)(error);
    }
}
//# sourceMappingURL=handleUpdateClassMethod.js.map