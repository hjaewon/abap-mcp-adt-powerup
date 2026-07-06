/**
 * systemInfoParsers — pure parsing helpers for GetSystemInfo /
 * GetInstalledComponents, plus a small shared "best-effort GET" wrapper that
 * never throws (turns HTTP errors into an `{ ok: false }` result) so both
 * read-only tools can treat "endpoint absent on this release" as valid data
 * rather than an exception.
 */
import type { IAbapConnection } from '@babamba2/mcp-abap-adt-interfaces';
import { XMLParser } from 'fast-xml-parser';
import { makeAdtRequestWithTimeout } from './utils';

export interface AdtSystemInformation {
  systemId?: string;
  client?: string;
  language?: string;
  userName?: string;
  userFullName?: string;
}

export interface AdtInstalledComponent {
  name: string;
  release?: string;
  spLevel?: string;
  description?: string;
}

export type AdtGetResult =
  | { ok: true; data: unknown; contentType: string }
  | { ok: false; status?: number; error: string };

/**
 * GETs an ADT endpoint, never throwing — non-2xx / network errors are
 * reported back as `{ ok: false }`.
 */
export async function tryAdtGet(
  connection: IAbapConnection,
  url: string,
  headers?: Record<string, string>,
): Promise<AdtGetResult> {
  try {
    const response = await makeAdtRequestWithTimeout(
      connection,
      url,
      'GET',
      'default',
      undefined,
      undefined,
      headers,
    );
    return {
      ok: true,
      data: response.data,
      contentType: String(response.headers?.['content-type'] ?? ''),
    };
  } catch (error: any) {
    return {
      ok: false,
      status: error?.response?.status,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parses the `/sap/bc/adt/core/http/systeminformation` payload. Accepts
 * either an already-parsed object or a raw JSON string (defensive — some
 * ADT stacks serve it as text/plain even when the body is JSON).
 */
export function parseSystemInformation(data: unknown): AdtSystemInformation {
  let obj: any = data;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object') return {};
  return {
    systemId: obj.systemID ?? obj.systemId ?? undefined,
    client: obj.client ?? undefined,
    language: obj.language ?? undefined,
    userName: obj.userName ?? undefined,
    userFullName: obj.userFullName ?? undefined,
  };
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function toStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return String(v);
}

function normalizeComponent(raw: any): AdtInstalledComponent | null {
  const name =
    raw?.name ??
    raw?.component ??
    raw?.swComponent ??
    raw?.['@_name'] ??
    undefined;
  if (!name) return null;
  return {
    name: String(name),
    release: toStr(raw?.release ?? raw?.releaseVersion ?? raw?.['@_release']),
    spLevel: toStr(
      raw?.spLevel ?? raw?.supportPackage ?? raw?.sp ?? raw?.['@_spLevel'],
    ),
    description: toStr(raw?.description ?? raw?.text ?? raw?.['@_description']),
  };
}

function parseInstalledComponentsJson(data: any): AdtInstalledComponent[] {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.components)
      ? data.components
      : Array.isArray(data?.component)
        ? data.component
        : [];
  const out: AdtInstalledComponent[] = [];
  for (const item of list) {
    const c = normalizeComponent(item);
    if (c) out.push(c);
  }
  return out;
}

function parseInstalledComponentsXml(xml: string): AdtInstalledComponent[] {
  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  let raw: any;
  try {
    raw = parser.parse(xml);
  } catch {
    return [];
  }

  // Try a handful of plausible container shapes — schema is unverified
  // against a live system (see VERIFY note at the call site).
  const root =
    raw?.componentReleases ??
    raw?.components ??
    raw?.installedComponents ??
    raw?.feed ??
    raw;

  const candidates = asArray<any>(
    root?.component ?? root?.entry ?? root?.installedComponent,
  );

  const out: AdtInstalledComponent[] = [];
  for (const item of candidates) {
    const c = normalizeComponent(item);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Parses an installed-components payload. Handles both a JSON array/object
 * shape and an XML feed/list shape (namespace-agnostic), normalizing common
 * key-name variants since the exact schema differs across SAP releases.
 * VERIFY(live): schema unverified against a live system — best-effort with
 * graceful degradation (empty list) if no recognizable entries are found.
 */
export function parseInstalledComponents(
  data: unknown,
  contentType = '',
): AdtInstalledComponent[] {
  if (data === undefined || data === null || data === '') return [];

  if (typeof data === 'string' && contentType.includes('xml')) {
    return parseInstalledComponentsXml(data);
  }
  if (typeof data === 'string') {
    try {
      return parseInstalledComponentsJson(JSON.parse(data));
    } catch {
      // Not JSON either — try XML as a last resort in case content-type was
      // missing or mislabeled.
      if (data.trim().startsWith('<')) return parseInstalledComponentsXml(data);
      return [];
    }
  }
  return parseInstalledComponentsJson(data);
}
