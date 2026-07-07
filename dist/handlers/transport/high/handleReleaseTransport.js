"use strict";
/**
 * ReleaseTransport Handler - Release an ABAP transport request or task via the
 * ADT CTS release action.
 *
 * Endpoint: POST /sap/bc/adt/cts/transportrequests/<trkorr>/newreleasejobs
 *   Accept:  application/vnd.sap.adt.transportorganizer.v1+xml
 *
 * This is the standard ADT release action (the same one Eclipse ADT and
 * abap-adt-api drive), but it is NOT present in this repo's captured
 * `docs/adt-discovery.xml`, so availability is treated as uncertain: a
 * 404/405 (endpoint absent on this release) is surfaced as a SUCCESS payload
 * `{ supported: false, ... }` rather than a tool error — mirroring the
 * detection pattern in handleGetInstalledComponents. All other errors flow
 * through the central `return_error`, which now surfaces ADT exception XML as
 * readable `SAP Error: ... [HTTP nnn]` text.
 *
 * Tasks must be released before their parent request (SAP CTS rule); this tool
 * releases whatever single trkorr it is given — the release workflow skill is
 * responsible for ordering task-then-request.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.parseReleaseJobResponse = parseReleaseJobResponse;
exports.handleReleaseTransport = handleReleaseTransport;
const utils_1 = require("../../../lib/utils");
const ACCEPT_ORGANIZER_V1 = 'application/vnd.sap.adt.transportorganizer.v1+xml, application/vnd.sap.adt.transportorganizertree.v1+xml';
exports.TOOL_DEFINITION = {
    name: 'ReleaseTransport',
    available_in: ['onprem', 'cloud'],
    description: 'Release an ABAP transport request or task via the ADT CTS release action. ' +
        'Tasks must be released before their parent request. Returns the release status reported by SAP; ' +
        'on systems where the ADT release action is unavailable, returns { supported: false } instead of failing.',
    inputSchema: {
        type: 'object',
        properties: {
            transport_number: {
                type: 'string',
                description: 'Transport request or task number to release (e.g., E19K905635, DEVK905123).',
            },
        },
        required: ['transport_number'],
    },
};
/**
 * Defensively parse the ADT release-job response. SAP returns different shapes
 * across releases (release-report list, refreshed tm:request node, or a bare
 * job acknowledgement), so unknown shapes yield nulls plus a raw excerpt rather
 * than silently dropping the response.
 */
function parseReleaseJobResponse(xml) {
    const result = {
        status: null,
        statusText: null,
        messages: [],
    };
    if (!xml || typeof xml !== 'string' || xml.trim().length === 0) {
        return result;
    }
    try {
        const { XMLParser } = require('fast-xml-parser');
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: '#text',
        });
        const parsed = parser.parse(xml);
        const root = parsed['tm:root'] || parsed.root || parsed;
        // Shape A: refreshed request node carries the new status directly.
        const request = root?.['tm:request'];
        const requestNode = Array.isArray(request) ? request[0] : request;
        if (requestNode) {
            result.status =
                pickText(requestNode['@_tm:status']) ??
                    pickText(requestNode['tm:status']) ??
                    result.status;
            result.statusText =
                pickText(requestNode['@_tm:status_text']) ??
                    pickText(requestNode['tm:status_text']) ??
                    result.statusText;
        }
        // Shape B: release-report / job acknowledgement carries state + messages.
        // The report list may be wrapped one level (tm:releasereports > tm:releasereport).
        const reportsContainer = root?.['tm:releasereports'] ||
            root?.['tm:releasereport'] ||
            root?.['tm:releasejob'];
        const reports = (reportsContainer && reportsContainer['tm:releasereport']) ||
            reportsContainer;
        collectMessages(reports, result.messages);
        collectMessages(root?.['chkrun:messages'], result.messages);
        // Shape C: top-level state/status attributes on the root.
        result.status =
            result.status ??
                pickText(root?.['@_tm:status']) ??
                pickText(root?.['@_state']) ??
                null;
        result.statusText =
            result.statusText ?? pickText(root?.['@_tm:status_text']) ?? null;
        // Nothing recognizable → keep the raw XML (capped) so it is never lost.
        if (result.status === null &&
            result.statusText === null &&
            result.messages.length === 0) {
            result.messages.push(xml.trim().slice(0, 500));
        }
    }
    catch {
        result.messages.push(xml.trim().slice(0, 500));
    }
    return result;
}
function pickText(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'string')
        return value.trim() || null;
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (typeof value === 'object' && '#text' in value) {
        return pickText(value['#text']);
    }
    return null;
}
function collectMessages(node, out) {
    if (!node)
        return;
    const items = Array.isArray(node) ? node : [node];
    for (const item of items) {
        if (typeof item === 'string') {
            const t = item.trim();
            if (t)
                out.push(t);
            continue;
        }
        if (item && typeof item === 'object') {
            const msg = pickText(item['tm:message']) ??
                pickText(item['chkrun:shortText']) ??
                pickText(item['@_tm:message']) ??
                pickText(item['#text']);
            if (msg)
                out.push(msg);
        }
    }
}
async function handleReleaseTransport(context, args) {
    const { connection, logger } = context;
    try {
        if (!args?.transport_number) {
            throw new utils_1.McpError(utils_1.ErrorCode.InvalidParams, 'Transport number is required');
        }
        const trNumber = args.transport_number;
        const url = `/sap/bc/adt/cts/transportrequests/${encodeURIComponent(trNumber)}/newreleasejobs`;
        logger?.info(`ReleaseTransport: releasing ${trNumber} via ${url}`);
        let response;
        try {
            response = await (0, utils_1.makeAdtRequestWithTimeout)(connection, url, 'POST', 'long', undefined, undefined, { Accept: ACCEPT_ORGANIZER_V1 });
        }
        catch (error) {
            const status = error?.response?.status;
            if (status === 404 || status === 405) {
                logger?.info(`ReleaseTransport: ADT release action not available (HTTP ${status})`);
                return {
                    isError: false,
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                supported: false,
                                transport_number: trNumber,
                                hint: 'ADT transport release action not available on this system — release via SE09/SE10 or STMS.',
                            }),
                        },
                    ],
                };
            }
            throw error;
        }
        const parsed = parseReleaseJobResponse(response.data);
        logger?.info(`ReleaseTransport: ${trNumber} release submitted (status=${parsed.status ?? 'unknown'})`);
        return {
            isError: false,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        supported: true,
                        transport_number: trNumber,
                        status: parsed.status,
                        status_text: parsed.statusText,
                        messages: parsed.messages,
                        message: `Release action submitted for ${trNumber}${parsed.status ? ` (status: ${parsed.status})` : ''}. Verify final state with GetTransport.`,
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
        if (error instanceof utils_1.McpError) {
            throw error;
        }
        return (0, utils_1.return_error)(error);
    }
}
//# sourceMappingURL=handleReleaseTransport.js.map