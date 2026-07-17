"use strict";
/**
 * DeleteStructure Handler - Delete ABAP Structure via direct ADT REST API
 *
 * Uses lock -> DELETE {object URI}?lockHandle=... -> read-back verification,
 * the same pattern as handleDeleteInclude. The previous implementation posted
 * to the /sap/bc/adt/deletion framework without a lock and without verifying
 * the response; on ACTIVE structures that request is a no-op and the handler
 * reported a false success (live-verified on S/4HANA 2021).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITION = void 0;
exports.handleDeleteStructure = handleDeleteStructure;
const fast_xml_parser_1 = require("fast-xml-parser");
const utils_1 = require("../../../lib/utils");
const ACCEPT_LOCK = 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result;q=0.8, application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result2;q=0.9';
exports.TOOL_DEFINITION = {
    name: 'DeleteStructure',
    available_in: ['onprem', 'cloud'],
    description: 'Delete an ABAP structure from the SAP system. Locks the structure, deletes it via the ADT object URI, then verifies by reading it back — success is reported only when the server confirms the object is gone. Transport request optional for $TMP objects.',
    inputSchema: {
        type: 'object',
        properties: {
            structure_name: {
                type: 'string',
                description: 'Structure name (e.g., Z_MY_STRUCTURE).',
            },
            transport_request: {
                type: 'string',
                description: 'Transport request number (e.g., E19K905635). Required for transportable objects. Optional for local objects ($TMP).',
            },
        },
        required: ['structure_name'],
    },
};
async function handleDeleteStructure(context, args) {
    const { connection, logger } = context;
    const stepsCompleted = [];
    let lockHandle;
    let structureName = '';
    let baseUrl = '';
    try {
        const { structure_name, transport_request } = args;
        if (!structure_name) {
            return (0, utils_1.return_error)(new Error('structure_name is required'));
        }
        structureName = structure_name.toUpperCase();
        baseUrl = `/sap/bc/adt/ddic/structures/${(0, utils_1.encodeSapObjectName)(structureName).toLowerCase()}`;
        logger?.info(`Starting structure deletion: ${structureName}`);
        // ---- Step 1: Lock (stateful) ----
        connection.setSessionType('stateful');
        const lockResponse = await (0, utils_1.makeAdtRequestWithTimeout)(connection, `${baseUrl}?_action=LOCK&accessMode=MODIFY`, 'POST', 'default', null, undefined, { Accept: ACCEPT_LOCK });
        connection.setSessionType('stateless');
        const parser = new fast_xml_parser_1.XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
        });
        const parsed = parser.parse(lockResponse.data || '');
        lockHandle =
            parsed?.['asx:abap']?.['asx:values']?.DATA?.LOCK_HANDLE ||
                lockResponse.headers?.['x-sap-adt-lock-handle'];
        if (!lockHandle) {
            throw new Error(`Failed to obtain lock handle for structure ${structureName}. It may be locked by another user.`);
        }
        stepsCompleted.push('lock');
        // ---- Step 2: DELETE with lockHandle + optional corrNr ----
        const deleteParams = {
            lockHandle: String(lockHandle),
        };
        if (transport_request) {
            deleteParams.corrNr = transport_request;
        }
        await (0, utils_1.makeAdtRequestWithTimeout)(connection, baseUrl, 'DELETE', 'default', undefined, deleteParams);
        lockHandle = undefined; // a successful delete consumes the lock
        stepsCompleted.push('delete');
        // ---- Step 3: Read-back verification — the delete request returning 2xx
        // is NOT proof of deletion; only a 404 on read-back is. ----
        let stillExists = false;
        try {
            await (0, utils_1.makeAdtRequestWithTimeout)(connection, baseUrl, 'GET', 'default');
            stillExists = true;
        }
        catch (verifyError) {
            if (verifyError?.response?.status === 404) {
                stepsCompleted.push('verify_gone');
            }
            else {
                // Verification read failed for another reason — report honestly.
                throw new Error(`Structure ${structureName} was deleted (DELETE accepted) but the read-back verification failed with an unexpected error: ${verifyError?.message || String(verifyError)}`);
            }
        }
        if (stillExists) {
            throw new Error(`Delete request for structure ${structureName} was accepted by the server but the structure still exists (read-back succeeded). Deletion did NOT happen — check locks, where-used references, or delete it manually in SE11.`);
        }
        logger?.info(`✅ DeleteStructure completed and verified: ${structureName}`);
        return (0, utils_1.return_response)({
            data: JSON.stringify({
                success: true,
                structure_name: structureName,
                transport_request: transport_request || null,
                message: `Structure ${structureName} deleted and verified gone.`,
                steps_completed: stepsCompleted,
            }, null, 2),
        });
    }
    catch (error) {
        // Unlock if the lock is still held (delete failed before consuming it)
        if (lockHandle) {
            try {
                connection.setSessionType('stateful');
                await (0, utils_1.makeAdtRequestWithTimeout)(connection, `${baseUrl}?_action=UNLOCK&lockHandle=${encodeURIComponent(String(lockHandle))}`, 'POST', 'default', null);
            }
            catch (unlockError) {
                logger?.warn(`Failed to unlock structure ${structureName} after delete error: ${unlockError?.message || unlockError}`);
            }
            finally {
                connection.setSessionType('stateless');
            }
        }
        logger?.error(`Error deleting structure ${structureName}: ${error?.message || error}`);
        let errorMessage = `Failed to delete structure: ${error.message || String(error)}`;
        if (error.response?.status === 404) {
            errorMessage = `Structure ${structureName} not found. It may already be deleted.`;
        }
        else if (error.response?.status === 423) {
            errorMessage = `Structure ${structureName} is locked by another user. Cannot delete.`;
        }
        else if (error.response?.data &&
            typeof error.response.data === 'string') {
            try {
                const parser = new fast_xml_parser_1.XMLParser({
                    ignoreAttributes: false,
                    attributeNamePrefix: '@_',
                });
                const errorData = parser.parse(error.response.data);
                const errorMsg = errorData['exc:exception']?.message?.['#text'] ||
                    errorData['exc:exception']?.message;
                if (errorMsg) {
                    errorMessage = `SAP Error: ${errorMsg}${error.response?.status ? ` [HTTP ${error.response.status}]` : ''}`;
                }
            }
            catch (_parseError) {
                // Ignore parse errors
            }
        }
        return (0, utils_1.return_error)(new Error(errorMessage));
    }
}
//# sourceMappingURL=handleDeleteStructure.js.map