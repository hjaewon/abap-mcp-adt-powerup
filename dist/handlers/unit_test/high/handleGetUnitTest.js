"use strict";
/**
 * GetUnitTest Handler - Read ABAP Unit test status/result
 *
 * RunUnitTest runs synchronously via the classic ADT endpoint (see
 * ../../../lib/abapUnitClassic.ts) and caches the `<aunit:runResult>` XML
 * under a generated run_id — this looks it back up (combined status+result
 * view of the same cache the Status/Result handlers read).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleGetUnitTest = handleGetUnitTest;
const abapUnitClassic_1 = require("../../../lib/abapUnitClassic");
const utils_1 = require("../../../lib/utils");
exports.TOOL_DEFINITION = {
    name: 'GetUnitTest',
    available_in: ['onprem', 'cloud', 'legacy'],
    description: 'Retrieve ABAP Unit test run status and result for a previously started run_id.',
    inputSchema: {
        type: 'object',
        properties: {
            run_id: {
                type: 'string',
                description: 'Run identifier returned by RunUnitTest.',
            },
        },
        required: ['run_id'],
    },
};
/**
 * Main handler for GetUnitTest MCP tool
 *
 * Uses getUnitTestRun() to look up the cached synchronous run result.
 */
async function handleGetUnitTest(context, args) {
    const { connection, logger } = context;
    try {
        const { run_id } = args;
        // Validation
        if (!run_id) {
            return (0, utils_1.return_error)(new Error('run_id is required'));
        }
        logger?.info(`Reading unit test run status/result for run_id: ${run_id}`);
        const resultXml = (0, abapUnitClassic_1.getUnitTestRun)(connection, run_id);
        if (resultXml === undefined) {
            return (0, utils_1.return_error)(new Error(`Unknown run_id "${run_id}" — no cached result (invalid run_id, or the server process restarted since RunUnitTest was called).`));
        }
        logger?.info(`✅ GetUnitTest completed successfully for run_id: ${run_id}`);
        return (0, utils_1.return_response)({
            data: JSON.stringify({
                success: true,
                run_id,
                run_status: { status: 'completed' },
                run_result: resultXml,
            }, null, 2),
        });
    }
    catch (error) {
        return (0, utils_1.return_error)(error);
    }
}
//# sourceMappingURL=handleGetUnitTest.js.map