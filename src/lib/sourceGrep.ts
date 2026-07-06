/**
 * Pure line-based regex grep engine for ABAP source text.
 *
 * No SAP/network dependencies — used by GrepObjects and GrepPackages to search
 * already-fetched source text server-side, in one call, instead of the caller
 * reading each object individually and grepping client-side.
 */
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/** Hard cap on lines scanned per object. Bounds worst-case regex work without needing a timeout. */
const MAX_LINES_PER_OBJECT = 20000;

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
  /** True when scanning stopped before reaching the end of the source (max_matches reached or the line cap was hit). */
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
  let hasMore = false;

  for (let i = 0; i < scanLimit; i++) {
    if (maxMatches <= 0 || matches.length >= maxMatches) {
      hasMore = true;
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

  if (!hasMore && scanLimit < lines.length) {
    // Line-count guard cut the scan short before maxMatches was reached.
    hasMore = true;
  }

  return { matches, hasMore };
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
    const { matches, hasMore } = grepText(
      obj.source,
      regex,
      contextLines,
      remaining,
    );
    if (matches.length > 0) {
      results.push({
        object_type: obj.object_type,
        object_name: obj.object_name,
        matches,
      });
      total += matches.length;
    }
    if (hasMore) {
      truncated = true;
    }
  }

  return { total_matches: total, truncated, results, skipped };
}
