"use strict";
/**
 * RunUnitTest Handler - Start ABAP Unit test run via the classic ADT endpoint
 *
 * Uses runClassicUnitTest() (see ../../../lib/abapUnitClassic.ts) instead of
 * the vendored AdtClient.getUnitTest().create(), which posts to
 * /sap/bc/adt/abapunit/runs — confirmed absent (404) via live discovery on
 * both a modern S/4HANA 2021 on-prem system and a legacy BASIS 7.00 system.
 * The classic endpoint is synchronous, so the result is cached locally and
 * a generated run_id is returned for the subsequent GetUnitTestStatus /
 * GetUnitTestResult calls.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleRunUnitTest = handleRunUnitTest;
const abapUnitClassic_1 = require("../../../lib/abapUnitClassic");
const utils_1 = require("../../../lib/utils");
exports.TOOL_DEFINITION = {
    name: 'RunUnitTest',
    available_in: ['onprem', 'cloud', 'legacy'],
    description: 'Start an ABAP Unit test run for provided class test definitions. Returns run_id for status/result queries.',
    inputSchema: {
        type: 'object',
        properties: {
            tests: {
                type: 'array',
                description: 'List of container/test class pairs to execute.',
                items: {
                    type: 'object',
                    properties: {
                        container_class: {
                            type: 'string',
                            description: 'Class that owns the test include (e.g., ZCL_MAIN_CLASS).',
                        },
                        test_class: {
                            type: 'string',
                            description: 'Test class name inside the include (e.g., LTCL_MAIN_CLASS).',
                        },
                    },
                    required: ['container_class', 'test_class'],
                },
            },
            title: {
                type: 'string',
                description: 'Optional title for the ABAP Unit run.',
            },
            context: {
                type: 'string',
                description: 'Optional context string shown in SAP tools.',
            },
            scope: {
                type: 'object',
                properties: {
                    own_tests: { type: 'boolean' },
                    foreign_tests: { type: 'boolean' },
                    add_foreign_tests_as_preview: { type: 'boolean' },
                },
            },
            risk_level: {
                type: 'object',
                properties: {
                    harmless: { type: 'boolean' },
                    dangerous: { type: 'boolean' },
                    critical: { type: 'boolean' },
                },
            },
            duration: {
                type: 'object',
                properties: {
                    short: { type: 'boolean' },
                    medium: { type: 'boolean' },
                    long: { type: 'boolean' },
                },
            },
        },
        required: ['tests'],
    },
};
/**
 * Main handler for RunUnitTest MCP tool
 *
 * Uses runClassicUnitTest() - synchronous classic ADT test run operation
 */
async function handleRunUnitTest(context, args) {
    const { connection, logger } = context;
    try {
        const { tests, scope, risk_level, duration } = args;
        // Validation
        if (!Array.isArray(tests) || tests.length === 0) {
            return (0, utils_1.return_error)(new Error('tests array with at least one entry is required'));
        }
        for (let i = 0; i < tests.length; i++) {
            if (!tests[i]?.container_class?.trim() || !tests[i]?.test_class?.trim()) {
                return (0, utils_1.return_error)(new Error(`tests[${i}] must include non-empty container_class and test_class`));
            }
        }
        const formattedTests = tests.map((test) => ({
            containerClass: test.container_class.toUpperCase(),
            testClass: test.test_class.toUpperCase(),
        }));
        logger?.info(`Starting ABAP Unit run for ${formattedTests.length} test definition(s)`);
        try {
            // Run synchronously via the classic ADT endpoint and cache the result
            // under a generated run_id (see ../../../lib/abapUnitClassic.ts).
            const resultXml = await (0, abapUnitClassic_1.runClassicUnitTest)(connection, formattedTests, {
                scope: scope
                    ? {
                        ownTests: scope.own_tests,
                        foreignTests: scope.foreign_tests,
                        addForeignTestsAsPreview: scope.add_foreign_tests_as_preview,
                    }
                    : undefined,
                riskLevel: risk_level,
                duration,
            });
            const runId = (0, abapUnitClassic_1.storeUnitTestRun)(connection, resultXml);
            logger?.info(`✅ RunUnitTest started. Run ID: ${runId}`);
            return (0, utils_1.return_response)({
                data: JSON.stringify({
                    success: true,
                    run_id: runId,
                    message: `ABAP Unit run started. Use GetUnitTest with run_id ${runId} to get status and results. Note: the classic ADT endpoint runs all local test classes of each container class — per-test_class sub-selection is not supported by the protocol, so the result may include more test classes than requested.`,
                }, null, 2),
            });
        }
        catch (error) {
            logger?.error(`Error starting ABAP Unit run: ${error?.message || error}`);
            return (0, utils_1.return_error)(new Error(error?.message || String(error)));
        }
    }
    catch (error) {
        return (0, utils_1.return_error)(error);
    }
}
//# sourceMappingURL=handleRunUnitTest.js.map