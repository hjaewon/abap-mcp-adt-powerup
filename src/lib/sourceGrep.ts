/**
 * Pure line-based regex grep engine for ABAP source text.
 *
 * No SAP/network dependencies — used by GrepObjects and GrepPackages to search
 * already-fetched source text server-side, in one call, instead of the caller
 * reading each object individually and grepping client-side.
 */
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/** Hard cap on lines scanned per object. Bounds worst-case regex work without needing a timeout. */
export const MAX_LINES_PER_OBJECT = 20000;

/** Max context lines allowed before/after a match. */
const MAX_CONTEXT_LINES = 5;

export interface GrepMatch {
  line: number;
  text: string;
  context_before: string[];
  context_after: string[];
}

export interface GrepTextResult {
  matches: GrepMatch[];
  /**
   * True once `maxMatches` matches were found and the scan stopped early to
   * respect that budget. This is the only condition that should count
   * against a caller's shared/global result cap.
   */
  matchLimitReached: boolean;
  /**
   * True when the per-object MAX_LINES_PER_OBJECT guard stopped the scan
   * before reaching the end of the source. Independent of matchLimitReached
   * — a single oversized object can hit this with zero matches found, and it
   * says nothing about a caller's shared/global result budget.
   */
  lineCapReached: boolean;
  /** True when scanning stopped before reaching the end of the source, for either reason above. */
  hasMore: boolean;
}

export interface ObjectGrepInput {
  object_type: string;
  object_name: string;
  /** Source text, or null if it could not be fetched. */
  source: string | null;
  /** Reason source is unavailable/unsupported. Set together with source: null. */
  skip_reason?: string;
}

export interface ObjectGrepResult {
  object_type: string;
  object_name: string;
  matches: GrepMatch[];
  /** True when this object's source exceeded MAX_LINES_PER_OBJECT and was only
   * partially scanned — matches may exist beyond the scanned portion. */
  truncated_object?: boolean;
}

export interface SkippedObject {
  object: string;
  reason: string;
}

export interface GrepAggregateResult {
  total_matches: number;
  truncated: boolean;
  results: ObjectGrepResult[];
  skipped: SkippedObject[];
}

export interface GrepAggregateOptions {
  context_lines?: number;
  max_results?: number;
}

/**
 * Compiles a regex pattern for source grepping.
 * @throws McpError(InvalidParams) if the pattern is empty or not valid JS regex source.
 */
export function compileGrepRegex(
  pattern: string,
  caseInsensitive = false,
): RegExp {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'pattern must be a non-empty string',
    );
  }
  try {
    return new RegExp(pattern, caseInsensitive ? 'i' : '');
  } catch (error) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid regex pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Scans source text line-by-line for `regex`, collecting up to `maxMatches` matches
 * with up to `contextLines` of surrounding context per match.
 *
 * Stops early (hasMore: true) once maxMatches is reached, or after
 * MAX_LINES_PER_OBJECT lines — a simple guard against pathological regex
 * patterns / huge sources that avoids needing a timeout.
 */
export function grepText(
  sourceText: string,
  regex: RegExp,
  contextLines: number,
  maxMatches: number,
): GrepTextResult {
  const lines = sourceText.split(/\r\n|\r|\n/);
  const clampedContext = Math.max(0, Math.min(contextLines, MAX_CONTEXT_LINES));
  const scanLimit = Math.min(lines.length, MAX_LINES_PER_OBJECT);

  const matches: GrepMatch[] = [];
  let matchLimitReached = false;

  for (let i = 0; i < scanLimit; i++) {
    if (maxMatches <= 0 || matches.length >= maxMatches) {
      matchLimitReached = true;
      break;
    }
    if (regex.test(lines[i])) {
      matches.push({
        line: i + 1,
        text: lines[i],
        context_before:
          clampedContext > 0
            ? lines.slice(Math.max(0, i - clampedContext), i)
            : [],
        context_after:
          clampedContext > 0
            ? lines.slice(i + 1, Math.min(lines.length, i + 1 + clampedContext))
            : [],
      });
    }
  }

  // Line-count guard cut the scan short before the end of the source was
  // reached — independent of whether the match cap was also hit.
  const lineCapReached = scanLimit < lines.length;

  return {
    matches,
    matchLimitReached,
    lineCapReached,
    hasMore: matchLimitReached || lineCapReached,
  };
}

/**
 * Aggregates grep results across multiple already-fetched objects, applying a
 * shared max_results cap across all of them. Pure function — callers resolve
 * sources (or skip reasons) first via their own fetch dispatcher, then pass
 * the resolved list in here.
 */
export function aggregateGrepResults(
  objects: readonly ObjectGrepInput[],
  regex: RegExp,
  options: GrepAggregateOptions = {},
): GrepAggregateResult {
  const contextLines = Math.max(
    0,
    Math.min(options.context_lines ?? 0, MAX_CONTEXT_LINES),
  );
  const maxResults = options.max_results ?? 100;

  const results: ObjectGrepResult[] = [];
  const skipped: SkippedObject[] = [];
  let total = 0;
  let truncated = false;

  for (const obj of objects) {
    const label = `${obj.object_type} ${obj.object_name}`;
    if (obj.skip_reason || obj.source == null) {
      skipped.push({
        object: label,
        reason: obj.skip_reason ?? 'Source not available',
      });
      continue;
    }
    if (total >= maxResults) {
      truncated = true;
      skipped.push({
        object: label,
        reason: 'max_results reached; object not scanned',
      });
      continue;
    }
    const remaining = maxResults - total;
    const { matches, matchLimitReached, lineCapReached } = grepText(
      obj.source,
      regex,
      contextLines,
      remaining,
    );
    if (matches.length > 0) {
      const entry: ObjectGrepResult = {
        object_type: obj.object_type,
        object_name: obj.object_name,
        matches,
      };
      if (lineCapReached) entry.truncated_object = true;
      results.push(entry);
      total += matches.length;
    } else if (lineCapReached) {
      // Oversized object, scanned up to the line cap, with no matches found
      // in the scanned portion — distinct from the global max_results skip.
      skipped.push({
        object: label,
        reason: `object exceeds the ${MAX_LINES_PER_OBJECT}-line scan cap; no matches found in the scanned portion`,
      });
    }
    if (matchLimitReached) {
      // Only a match-cap hit means the shared/global result budget is exhausted.
      truncated = true;
    }
  }

  return { total_matches: total, truncated, results, skipped };
}
