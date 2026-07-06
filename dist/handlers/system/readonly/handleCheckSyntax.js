"use strict";
/**
 * CheckSyntax Handler - Standalone ABAP syntax check WITHOUT writing to SAP
 *
 * Wraps runSyntaxCheck() (see lib/preCheckBeforeActivation.ts) so callers can
 * validate proposed source code the same way Update* handlers do their
 * pre-write check, without locking, updating, or activating anything.
 *
 * source_code pre-write substitution is only supported for class / program /
 * interface (the kinds runSyntaxCheck can inline-substitute). For include and
 * function_module, SAP's checkrun endpoint always validates whatever is
 * currently staged as the inactive version on the server — any source_code
 * passed for those kinds is ignored, and the response says so via `note`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleCheckSyntax = handleCheckSyntax;
const preCheckBeforeActivation_1 = require("../../../lib/preCheckBeforeActivation");
const utils_1 = require("../../../lib/utils");
exports.TOOL_DEFINITION = {
    name: 'CheckSyntax',
    available_in: ['onprem', 'cloud', 'legacy'],
    description: "[read-only] Run a standalone ABAP syntax check WITHOUT writing anything to SAP. Supports 'class', 'program', 'interface', 'include', and 'function_module'. " +
        'If source_code is provided (class/program/interface only), the proposed source is compiled in place and checked without touching the server. ' +
        'If source_code is omitted, checks whatever is currently staged as the inactive version on the server (mirroring the post-write check Update* handlers run). ' +
        'Syntax errors are returned as normal results, not as tool errors — only connection/infra failures are reported as errors.',
    inputSchema: {
        type: 'object',
        properties: {
            object_type: {
                type: 'string',
                enum: ['class', 'program', 'interface', 'include', 'function_module'],
                description: "[read-only] ABAP object kind to check: 'class' (CLAS), 'program' (PROG), 'interface' (INTF), 'include' (PROG/I), or 'function_module' (FUGR/FF).",
            },
            object_name: {
                type: 'string',
                description: '[read-only] Name of the object to check (e.g., ZCL_MY_CLASS).',
            },
            function_group_name: {
                type: 'string',
                description: "[read-only] Function group name. Required when object_type is 'function_module'.",
            },
            source_code: {
                type: 'string',
                description: "[read-only] Optional proposed ABAP source code to check in place. Only honored for object_type 'class', 'program', or 'interface' — ignored for 'include' and 'function_module' (see description).",
            },
        },
        required: ['object_type', 'object_name'],
    },
};
const KIND_MAP = {
    class: 'class',
    program: 'program',
    interface: 'interface',
    include: 'include',
    function_module: 'functionModule',
};
async function handleCheckSyntax(context, args) {
    const { connection, logger } = context;
    try {
        const { object_type, object_name, function_group_name, source_code } = args ?? {};
        if (!object_type || !object_name) {
            throw new utils_1.McpError(utils_1.ErrorCode.InvalidParams, 'object_type and object_name are required');
        }
        const kind = KIND_MAP[object_type];
        if (!kind) {
            throw new utils_1.McpError(utils_1.ErrorCode.InvalidParams, `Unsupported object_type '${object_type}'. Must be one of: ${Object.keys(KIND_MAP).join(', ')}`);
        }
        if (kind === 'functionModule' && !function_group_name) {
            throw new utils_1.McpError(utils_1.ErrorCode.InvalidParams, 'function_group_name is required when object_type is function_module');
        }
        const name = String(object_name).toUpperCase();
        const sourceCodeIgnored = source_code !== undefined &&
            (kind === 'include' || kind === 'functionModule');
        logger?.info(`CheckSyntax: object_type=${object_type}, object_name=${name}, hasSourceCode=${!!source_code}`);
        const result = await (0, preCheckBeforeActivation_1.runSyntaxCheck)({ connection, logger }, {
            kind,
            name,
            sourceCode: sourceCodeIgnored ? undefined : source_code,
            functionGroupName: kind === 'functionModule'
                ? String(function_group_name).toUpperCase()
                : undefined,
        });
        const payload = {
            success: result.success,
            object_type,
            object_name: name,
            errors: result.errors,
            warnings: result.warnings,
            note: sourceCodeIgnored
                ? `source_code is only used for pre-write substitution checks on class/program/interface; SAP's checkrun endpoint for '${object_type}' always validates the current inactive version already staged on the server, so the supplied source_code was ignored.`
                : undefined,
        };
        return (0, utils_1.return_response)({
            data: JSON.stringify(payload, null, 2),
        });
    }
    catch (error) {
        // Syntax errors are surfaced above via return_response (isError:false).
        // This catch only triggers for infra failures — invalid params, network
        // issues, or unexpected exceptions from runSyntaxCheck's transport layer.
        logger?.error(`CheckSyntax failed: ${error?.message || error}`);
        return (0, utils_1.return_error)(error);
    }
}
//# sourceMappingURL=handleCheckSyntax.js.map