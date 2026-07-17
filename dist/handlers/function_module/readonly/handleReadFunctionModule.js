"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleReadFunctionModule = handleReadFunctionModule;
const clients_1 = require("../../../lib/clients");
const utils_1 = require("../../../lib/utils");
exports.TOOL_DEFINITION = {
    name: 'ReadFunctionModule',
    available_in: ['onprem', 'cloud', 'legacy'],
    description: '[read-only] Read ABAP function module source code and metadata (package, responsible, description, etc.). ' +
        "CAUTION: default version='active' returns the pre-edit source when an unactivated edit exists — when re-editing, read version='inactive' first, or the previous edit is silently lost on the next write. 'Active' source being returned is not proof of successful activation.",
    inputSchema: {
        type: 'object',
        properties: {
            function_module_name: {
                type: 'string',
                description: 'Function module name (e.g., Z_MY_FM).',
            },
            function_group_name: {
                type: 'string',
                description: 'Function group name containing the function module (e.g., Z_MY_FG).',
            },
            version: {
                type: 'string',
                enum: ['active', 'inactive'],
                description: 'Version to read: "active" (default) or "inactive".',
                default: 'active',
            },
            check_inactive: {
                type: 'boolean',
                description: 'Opt-in (default false). When reading the active version, also read the inactive version and, if an unactivated version exists and its source differs, attach a "warning" to the response. Costs one extra ADT call; recommended before re-editing an FM. The extra read never fails or slows the main read.',
                default: false,
            },
        },
        required: ['function_module_name', 'function_group_name'],
    },
};
async function handleReadFunctionModule(context, args) {
    const { connection, logger } = context;
    try {
        const { function_module_name, function_group_name, version = 'active', check_inactive = false, } = args;
        if (!function_module_name || !function_group_name)
            return (0, utils_1.return_error)(new Error('function_module_name and function_group_name are required'));
        const client = (0, clients_1.createAdtClient)(connection, logger);
        const functionModuleName = function_module_name.toUpperCase();
        const functionGroupName = function_group_name.toUpperCase();
        const obj = client.getFunctionModule();
        let source_code = null;
        try {
            const readResult = await obj.read({ functionModuleName, functionGroupName }, version);
            if (readResult?.readResult?.data) {
                source_code =
                    typeof readResult.readResult.data === 'string'
                        ? readResult.readResult.data
                        : safeStringify(readResult.readResult.data);
            }
        }
        catch (e) {
            logger?.warn(`Could not read source for ${functionModuleName}: ${e?.message}`);
        }
        let metadata = null;
        try {
            const metaResult = await obj.readMetadata({
                functionModuleName,
                functionGroupName,
            });
            if (metaResult?.metadataResult?.data) {
                metadata =
                    typeof metaResult.metadataResult.data === 'string'
                        ? metaResult.metadataResult.data
                        : safeStringify(metaResult.metadataResult.data);
            }
        }
        catch (e) {
            logger?.warn(`Could not read metadata for ${functionModuleName}: ${e?.message}`);
        }
        // Inactive-divergence check (opt-in): when reading the active version,
        // read the inactive version and warn if a pending, differing edit exists.
        // This extra read must never fail or slow-fail the main read.
        let warning;
        if (version === 'active' &&
            check_inactive === true &&
            source_code != null) {
            try {
                const inactiveResult = await obj.read({ functionModuleName, functionGroupName }, 'inactive');
                if (inactiveResult?.readResult?.data != null) {
                    const inactiveSource = typeof inactiveResult.readResult.data === 'string'
                        ? inactiveResult.readResult.data
                        : safeStringify(inactiveResult.readResult.data);
                    if (inactiveSource !== source_code) {
                        warning =
                            "An inactive (unactivated) version of this function module exists and differs from the active source returned here — re-read with version='inactive' before editing, or the pending edit will be silently overwritten.";
                    }
                }
            }
            catch (e) {
                logger?.debug?.(`Inactive-version check skipped for ${functionModuleName}: ${e?.message}`);
            }
        }
        return (0, utils_1.return_response)({
            data: JSON.stringify({
                success: true,
                function_module_name: functionModuleName,
                function_group_name: functionGroupName,
                version,
                source_code,
                metadata,
                warning,
            }, null, 2),
        });
    }
    catch (error) {
        return (0, utils_1.return_error)(error);
    }
}
function safeStringify(data) {
    try {
        return JSON.stringify(data);
    }
    catch {
        return String(data);
    }
}
//# sourceMappingURL=handleReadFunctionModule.js.map