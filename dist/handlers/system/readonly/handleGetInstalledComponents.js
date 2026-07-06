"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleGetInstalledComponents = handleGetInstalledComponents;
const systemInfoParsers_1 = require("../../../lib/systemInfoParsers");
exports.TOOL_DEFINITION = {
    name: 'GetInstalledComponents',
    available_in: ['onprem', 'cloud', 'legacy'],
    description: '[read-only] Retrieve installed software components with release/support-package level (e.g. SAP_BASIS 757 SP02). Returns { supported: false } instead of an error when the underlying ADT endpoint is absent on this release.',
    inputSchema: {
        type: 'object',
        properties: {},
        required: [],
    },
};
const CANDIDATE_URLS = [
    '/sap/bc/adt/core/http/systeminformation/componentreleases',
    '/sap/bc/adt/core/systeminformation/componentreleases',
];
async function handleGetInstalledComponents(context, _args) {
    const { connection, logger } = context;
    for (const url of CANDIDATE_URLS) {
        const result = await (0, systemInfoParsers_1.tryAdtGet)(connection, url, {
            Accept: 'application/json, application/xml',
        });
        if (result.ok) {
            const components = (0, systemInfoParsers_1.parseInstalledComponents)(result.data, result.contentType);
            logger?.info(`GetInstalledComponents: ${url} responded, ${components.length} component(s) parsed`);
            return {
                isError: false,
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ supported: true, components }),
                    },
                ],
            };
        }
    }
    logger?.info('GetInstalledComponents: no candidate endpoint responded');
    return {
        isError: false,
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    supported: false,
                    reason: `No installed-components endpoint responded on this system (tried: ${CANDIDATE_URLS.join(', ')}).`,
                }),
            },
        ],
    };
}
//# sourceMappingURL=handleGetInstalledComponents.js.map