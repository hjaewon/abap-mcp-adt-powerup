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
import { XMLParser } from 'fast-xml-parser';

export interface AtcFinding {
  objectName: string;
  objectType: string;
  packageName: string;
  objectUri: string;
  /** 1 = Error, 2 = Warning, 3+ = Info. */
  priority: number;
  checkId: string;
  checkTitle: string;
  messageId: string;
  messageTitle: string;
  /** ADT URI with source position fragment. */
  location: string;
  exemptionKind: string;
}

export interface ParsedAtcWorklist {
  worklistId: string;
  timestamp: string;
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  findings: AtcFinding[];
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseAtcWorklist(xml: string): ParsedAtcWorklist {
  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const raw = parser.parse(xml);
  const worklist = raw?.worklist ?? {};

  const findings: AtcFinding[] = [];
  for (const obj of asArray<any>(worklist?.objects?.object)) {
    const objName = obj?.['@_name'] ?? '';
    const objType = obj?.['@_type'] ?? '';
    const pkg = obj?.['@_packageName'] ?? '';
    const objUri = obj?.['@_uri'] ?? '';
    for (const f of asArray<any>(obj?.findings?.finding)) {
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
