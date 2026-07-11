/**
 * Discovery-negotiated Function Group content types.
 *
 * The vendored @babamba2/mcp-abap-adt-clients defaults Function Group
 * create/update to `application/vnd.sap.adt.functions.groups.v3+xml`
 * (constants CT_FUNCTION_GROUP and AdtContentTypesModern). Live measurement
 * against an S/4HANA 2021 on-prem system shows its ADT discovery document
 * advertises only `...groups.v2+xml` for the `/sap/bc/adt/functions/groups`
 * collection — POSTing v3 there fails with HTTP 400
 * "Daten sind ungültig und konnten nicht konvertiert werden" (ADT cannot
 * unmarshal an unknown schema version), while the identical payload with
 * the advertised v2 content type succeeds.
 *
 * Following the engine's existing discovery-based branching pattern (see
 * handleGetSystemInfo / resolveContentTypes in the clients package), this
 * module reads the `<app:accept>` media types the live system advertises
 * for the function-groups collection and picks the highest supported
 * version. The result is wrapped in an AdtContentTypesModern subclass that
 * overrides only functionGroupCreate/functionGroupUpdate, and is injected
 * per-call via AdtClient's official `options.contentTypes` hook. If
 * discovery is unavailable or advertises nothing recognizable, `undefined`
 * is returned and the caller falls back to current behavior.
 */

import type {
  IAdtContentTypes,
  IAdtHeaders,
} from '@babamba2/mcp-abap-adt-clients';
import { AdtContentTypesModern } from '@babamba2/mcp-abap-adt-clients';
import type {
  IAbapConnection,
  ILogger,
} from '@babamba2/mcp-abap-adt-interfaces';
import { tryAdtGet } from './systemInfoParsers';

const DISCOVERY_URL = '/sap/bc/adt/discovery';
const FG_COLLECTION_HREF = '/sap/bc/adt/functions/groups';
const FG_MEDIA_TYPE_RE =
  /^application\/vnd\.sap\.adt\.functions\.groups(?:\.v(\d+))?\+xml$/;

class AdtContentTypesFgNegotiated extends AdtContentTypesModern {
  private readonly fgContentType: string;

  constructor(fgContentType: string) {
    super();
    this.fgContentType = fgContentType;
  }

  functionGroupCreate(): IAdtHeaders {
    return { accept: this.fgContentType, contentType: this.fgContentType };
  }

  functionGroupUpdate(): IAdtHeaders {
    return {
      accept: this.fgContentType,
      contentType: `${this.fgContentType}; charset=utf-8`,
    };
  }
}

/**
 * Extracts the `<app:accept>` values of one collection from an ADT
 * discovery Atom Service Document. Namespace-prefix-agnostic (regex on the
 * serialized XML, not a full parse — the document is ~200KB and only one
 * collection block is needed). The href match is lenient: single or double
 * quotes, an optional trailing slash, and absolute URLs ending in the
 * collection path are all accepted.
 */
export function extractCollectionAccepts(
  discoveryXml: string,
  collectionHref: string,
): string[] {
  const escapedHref = collectionHref.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const collectionRe = new RegExp(
    `<(?:[\\w.-]+:)?collection\\b[^>]*href=(["'])(?:[^"']*)?${escapedHref}/?\\1[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?collection>`,
  );
  const block = discoveryXml.match(collectionRe)?.[2];
  if (!block) return [];
  const accepts: string[] = [];
  const acceptRe = /<(?:[\w.-]+:)?accept>([^<]+)<\/(?:[\w.-]+:)?accept>/g;
  let m: RegExpExecArray | null = acceptRe.exec(block);
  while (m !== null) {
    accepts.push(m[1].trim());
    m = acceptRe.exec(block);
  }
  return accepts;
}

/**
 * Picks the highest-versioned function-group media type from a list of
 * advertised accepts. An unversioned `...groups+xml` counts as v1.
 * Returns `undefined` when nothing matches.
 */
export function pickFunctionGroupContentType(
  accepts: string[],
): string | undefined {
  let best: { version: number; mediaType: string } | undefined;
  for (const accept of accepts) {
    const match = accept.match(FG_MEDIA_TYPE_RE);
    if (!match) continue;
    const version = match[1] ? Number(match[1]) : 1;
    if (!best || version > best.version) {
      best = { version, mediaType: accept };
    }
  }
  return best?.mediaType;
}

// Successful negotiations are cached per connection object (stdio mode
// reuses one connection for the whole session). Failures are not cached so
// a transient discovery hiccup doesn't pin the fallback for the session.
const negotiatedCache = new WeakMap<IAbapConnection, IAdtContentTypes>();

/**
 * Negotiates Function Group content types against the live system's ADT
 * discovery document. Returns `undefined` (caller keeps current defaults)
 * when discovery is unreachable or advertises no recognizable media type.
 */
export async function negotiateFunctionGroupContentTypes(
  connection: IAbapConnection,
  logger?: ILogger,
): Promise<IAdtContentTypes | undefined> {
  const cached = negotiatedCache.get(connection);
  if (cached) return cached;

  const result = await tryAdtGet(connection, DISCOVERY_URL, {
    Accept: 'application/atomsvc+xml',
  });
  if (!result.ok || typeof result.data !== 'string') {
    logger?.debug?.(
      'FunctionGroup content-type negotiation: discovery unavailable, keeping defaults',
    );
    return undefined;
  }

  const accepts = extractCollectionAccepts(result.data, FG_COLLECTION_HREF);
  const mediaType = pickFunctionGroupContentType(accepts);
  if (!mediaType) {
    logger?.debug?.(
      'FunctionGroup content-type negotiation: no groups media type advertised, keeping defaults',
    );
    return undefined;
  }

  logger?.info(
    `FunctionGroup content-type negotiated from discovery: ${mediaType}`,
  );
  const contentTypes = new AdtContentTypesFgNegotiated(mediaType);
  negotiatedCache.set(connection, contentTypes);
  return contentTypes;
}
