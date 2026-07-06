"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LINES_PER_OBJECT = void 0;
exports.compileGrepRegex = compileGrepRegex;
exports.grepText = grepText;
exports.aggregateGrepResults = aggregateGrepResults;
/**
 * Pure line-based regex grep engine for ABAP source text.
 *
 * No SAP/network dependencies — used by GrepObjects and GrepPackages to search
 * already-fetched source text server-side, in one call, instead of the caller
 * reading each object individually and grepping client-side.
 */
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
/** Hard cap on lines scanned per object. Bounds worst-case regex work without needing a timeout. */
exports.MAX_LINES_PER_OBJECT = 20000;
/** Max context lines allowed before/after a match. */
const MAX_CONTEXT_LINES = 5;
/**
 * Compiles a regex pattern for source grepping.
 * @throws McpError(InvalidParams) if the pattern is empty or not valid JS regex source.
 */
function compileGrepRegex(pattern, caseInsensitive = false) {
    if (typeof pattern !== 'string' || pattern.length === 0) {
        throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidParams, 'pattern must be a non-empty string');
    }
    try {
        return new RegExp(pattern, caseInsensitive ? 'i' : '');
    }
    catch (error) {
        throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidParams, `Invalid regex pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`);
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
function grepText(sourceText, regex, contextLines, maxMatches) {
    const lines = sourceText.split(/\r\n|\r|\n/);
    const clampedContext = Math.max(0, Math.min(contextLines, MAX_CONTEXT_LINES));
    const scanLimit = Math.min(lines.length, exports.MAX_LINES_PER_OBJECT);
    const matches = [];
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
                context_before: clampedContext > 0
                    ? lines.slice(Math.max(0, i - clampedContext), i)
                    : [],
                context_after: clampedContext > 0
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
function aggregateGrepResults(objects, regex, options = {}) {
    const contextLines = Math.max(0, Math.min(options.context_lines ?? 0, MAX_CONTEXT_LINES));
    const maxResults = options.max_results ?? 100;
    const results = [];
    const skipped = [];
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
        const { matches, matchLimitReached, lineCapReached } = grepText(obj.source, regex, contextLines, remaining);
        if (matches.length > 0) {
            const entry = {
                object_type: obj.object_type,
                object_name: obj.object_name,
                matches,
            };
            if (lineCapReached)
                entry.truncated_object = true;
            results.push(entry);
            total += matches.length;
        }
        else if (lineCapReached) {
            // Oversized object, scanned up to the line cap, with no matches found
            // in the scanned portion — distinct from the global max_results skip.
            skipped.push({
                object: label,
                reason: `object exceeds the ${exports.MAX_LINES_PER_OBJECT}-line scan cap; no matches found in the scanned portion`,
            });
        }
        if (matchLimitReached) {
            // Only a match-cap hit means the shared/global result budget is exhausted.
            truncated = true;
        }
    }
    return { total_matches: total, truncated, results, skipped };
}
//# sourceMappingURL=sourceGrep.js.map