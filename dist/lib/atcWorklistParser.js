"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAtcWorklist = parseAtcWorklist;
/**
 * ATC worklist XML parser.
 *
 * Contract adapted from marcellourbani/abap-adt-api
 * (MIT, (c) 2019 Marcello Urbani):
 * https://github.com/marcellourbani/abap-adt-api/blob/master/src/api/atc.ts
 *
 * ATC findings come back as `application/atc.worklist.v1+xml`. We parse with
 * `removeNSPrefix` (heavy namespacing) into a flat findings list.
 */
const fast_xml_parser_1 = require("fast-xml-parser");
function asArray(v) {
    if (v === undefined || v === null)
        return [];
    return Array.isArray(v) ? v : [v];
}
function parseAtcWorklist(xml) {
    const parser = new fast_xml_parser_1.XMLParser({
        removeNSPrefix: true,
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
    });
    const raw = parser.parse(xml);
    const worklist = raw?.worklist ?? {};
    const findings = [];
    for (const obj of asArray(worklist?.objects?.object)) {
        const objName = obj?.['@_name'] ?? '';
        const objType = obj?.['@_type'] ?? '';
        const pkg = obj?.['@_packageName'] ?? '';
        const objUri = obj?.['@_uri'] ?? '';
        for (const f of asArray(obj?.findings?.finding)) {
            const priorityRaw = f?.['@_priority'];
            findings.push({
                objectName: objName,
                objectType: objType,
                packageName: pkg,
                objectUri: objUri,
                priority: priorityRaw !== undefined ? Number(priorityRaw) : 0,
                checkId: f?.['@_checkId'] ?? '',
                checkTitle: f?.['@_checkTitle'] ?? '',
                messageId: `${f?.['@_messageId'] ?? ''}`,
                messageTitle: f?.['@_messageTitle'] ?? '',
                location: f?.['@_location'] ?? '',
                exemptionKind: f?.['@_exemptionKind'] ?? '',
            });
        }
    }
    const errors = findings.filter((x) => x.priority === 1).length;
    const warnings = findings.filter((x) => x.priority === 2).length;
    const infos = findings.length - errors - warnings;
    return {
        worklistId: `${worklist?.['@_id'] ?? ''}`,
        timestamp: `${worklist?.['@_timestamp'] ?? ''}`,
        total: findings.length,
        errors,
        warnings,
        infos,
        findings,
    };
}
//# sourceMappingURL=atcWorklistParser.js.map