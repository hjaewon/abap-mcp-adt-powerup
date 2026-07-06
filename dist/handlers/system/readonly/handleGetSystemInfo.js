"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleGetSystemInfo = handleGetSystemInfo;
const systemInfoParsers_1 = require("../../../lib/systemInfoParsers");
exports.TOOL_DEFINITION = {
    name: 'GetSystemInfo',
    available_in: ['onprem', 'cloud', 'legacy'],
    description: '[read-only] Retrieve SAP system identity: system ID (SID), client, logon language, connected user, and an ADT-stack "modern vs legacy" hint. Returns { supported: false } instead of an error when the underlying ADT endpoints are absent on this release.',
    inputSchema: {
        type: 'object',
        properties: {},
        required: [],
    },
};
const SYSTEMINFO_URL = '/sap/bc/adt/core/http/systeminformation';
const DISCOVERY_MODERN_URL = '/sap/bc/adt/core/discovery';
const DISCOVERY_LEGACY_URL = '/sap/bc/adt/discovery';
async function handleGetSystemInfo(context, _args) {
    const { connection, logger } = context;
    const infoResult = await (0, systemInfoParsers_1.tryAdtGet)(connection, SYSTEMINFO_URL, {
        Accept: 'application/vnd.sap.adt.core.http.systeminformation.v1+json',
    });
    let adtStackType = 'unknown';
    const modernResult = await (0, systemInfoParsers_1.tryAdtGet)(connection, DISCOVERY_MODERN_URL, {
        Accept: 'application/atomsvc+xml',
    });
    if (modernResult.ok && modernResult.contentType.includes('xml')) {
        adtStackType = 'modern';
    }
    else {
        const legacyResult = await (0, systemInfoParsers_1.tryAdtGet)(connection, DISCOVERY_LEGACY_URL, {
            Accept: 'application/atomsvc+xml',
        });
        if (legacyResult.ok && legacyResult.contentType.includes('xml')) {
            adtStackType = 'legacy';
        }
    }
    if (!infoResult.ok && adtStackType === 'unknown') {
        logger?.info('GetSystemInfo: no ADT system-info endpoint responded');
        return {
            isError: false,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        supported: false,
                        reason: 'Neither /sap/bc/adt/core/http/systeminformation nor the ADT discovery document responded on this system.',
                    }),
                },
            ],
        };
    }
    const info = infoResult.ok ? (0, systemInfoParsers_1.parseSystemInformation)(infoResult.data) : {};
    return {
        isError: false,
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    supported: true,
                    system_id: info.systemId ?? null,
                    client: info.client ?? null,
                    language: info.language ?? null,
                    user_name: info.userName ?? null,
                    user_full_name: info.userFullName ?? null,
                    adt_stack_type: adtStackType,
                }),
            },
        ],
    };
}
//# sourceMappingURL=handleGetSystemInfo.js.map