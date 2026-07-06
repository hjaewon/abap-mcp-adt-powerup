"use strict";
/**
 * textDiff — compact, dependency-free line-based unified diff.
 *
 * Uses a full O(N*M) LCS dynamic-programming backtrack to compute the
 * line-level edit script between two texts, then groups it into standard
 * unified-diff hunks (`@@ -l,c +l,c @@`) with configurable context lines.
 *
 * Before running the DP, common leading/trailing lines are trimmed off (ABAP
 * source comparisons are typically mostly identical), so the O(N*M) table is
 * sized to the differing middle section only. A hard cap on the trimmed
 * table size (MAX_DIFF_CELLS) guards against pathologically large,
 * mostly-different inputs still allocating an unbounded table.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DIFF_CELLS = void 0;
exports.diffLines = diffLines;
exports.buildHunks = buildHunks;
exports.computeUnifiedDiff = computeUnifiedDiff;
/**
 * Hard cap on (trimmed old lines) * (trimmed new lines) LCS table cells —
 * about 2000x2000. Applied after common prefix/suffix trimming, so this only
 * bounds the differing middle section, not the raw input size.
 */
exports.MAX_DIFF_CELLS = 4_000_000;
function splitLines(text) {
    if (text === '')
        return [];
    return text.split(/\r\n|\r|\n/);
}
/** Length of the common leading run shared by both line arrays. */
function commonPrefixLength(a, b) {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[i] === b[i])
        i++;
    return i;
}
/**
 * Length of the common trailing run shared by both line arrays, not
 * overlapping the `prefixLen` lines already claimed by the common prefix.
 */
function commonSuffixLength(a, b, prefixLen) {
    const max = Math.min(a.length, b.length) - prefixLen;
    let i = 0;
    while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i])
        i++;
    return i;
}
/**
 * Computes the line-level edit script (equal/add/remove ops) between two
 * arrays of lines using a full LCS dynamic-programming table.
 */
function diffLines(oldLines, newLines) {
    const n = oldLines.length;
    const m = newLines.length;
    // dp[i][j] = length of LCS(oldLines[i:], newLines[j:])
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++)
        dp[i] = new Int32Array(m + 1);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] =
                oldLines[i] === newLines[j]
                    ? dp[i + 1][j + 1] + 1
                    : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const ops = [];
    let oldPos = 1;
    let newPos = 1;
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (oldLines[i] === newLines[j]) {
            ops.push({ type: 'equal', line: oldLines[i], oldPos, newPos });
            i++;
            j++;
            oldPos++;
            newPos++;
        }
        else if (dp[i + 1][j] >= dp[i][j + 1]) {
            ops.push({ type: 'remove', line: oldLines[i], oldPos, newPos });
            i++;
            oldPos++;
        }
        else {
            ops.push({ type: 'add', line: newLines[j], oldPos, newPos });
            j++;
            newPos++;
        }
    }
    while (i < n) {
        ops.push({ type: 'remove', line: oldLines[i], oldPos, newPos });
        i++;
        oldPos++;
    }
    while (j < m) {
        ops.push({ type: 'add', line: newLines[j], oldPos, newPos });
        j++;
        newPos++;
    }
    return ops;
}
/**
 * Groups an edit script into unified-diff hunks. Non-equal ops are dilated
 * by `contextLines` in both directions; contiguous dilated runs become one
 * hunk, so two changes closer together than `2 * contextLines` merge into a
 * single hunk automatically.
 */
function buildHunks(ops, contextLines) {
    const n = ops.length;
    const included = new Array(n).fill(false);
    for (let k = 0; k < n; k++) {
        if (ops[k].type !== 'equal') {
            const lo = Math.max(0, k - contextLines);
            const hi = Math.min(n - 1, k + contextLines);
            for (let x = lo; x <= hi; x++)
                included[x] = true;
        }
    }
    const hunks = [];
    let k = 0;
    while (k < n) {
        if (!included[k]) {
            k++;
            continue;
        }
        const start = k;
        while (k < n && included[k])
            k++;
        const hunkOps = ops.slice(start, k);
        const first = hunkOps[0];
        const oldCount = hunkOps.filter((o) => o.type !== 'add').length;
        const newCount = hunkOps.filter((o) => o.type !== 'remove').length;
        hunks.push({
            oldStart: first.oldPos,
            oldLines: oldCount,
            newStart: first.newPos,
            newLines: newCount,
            ops: hunkOps,
        });
    }
    return hunks;
}
function formatRange(start, count) {
    if (count === 0)
        return `${Math.max(0, start - 1)},0`;
    if (count === 1)
        return `${start}`;
    return `${start},${count}`;
}
function formatHunk(hunk) {
    const header = `@@ -${formatRange(hunk.oldStart, hunk.oldLines)} +${formatRange(hunk.newStart, hunk.newLines)} @@`;
    const body = hunk.ops.map((op) => {
        const prefix = op.type === 'equal' ? ' ' : op.type === 'remove' ? '-' : '+';
        return `${prefix}${op.line}`;
    });
    return [header, ...body].join('\n');
}
/**
 * Computes a full unified diff between two texts.
 *
 * Common leading/trailing lines are trimmed off before running the LCS, and
 * a hard cap on the trimmed table size guards against unbounded allocation
 * for huge, mostly-different inputs (see MAX_DIFF_CELLS).
 */
function computeUnifiedDiff(oldText, newText, options = {}) {
    const contextLines = Math.max(0, options.contextLines ?? 3);
    const oldLabel = options.oldLabel ?? 'a';
    const newLabel = options.newLabel ?? 'b';
    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);
    const prefixLen = commonPrefixLength(oldLines, newLines);
    const suffixLen = commonSuffixLength(oldLines, newLines, prefixLen);
    const midOld = oldLines.slice(prefixLen, oldLines.length - suffixLen);
    const midNew = newLines.slice(prefixLen, newLines.length - suffixLen);
    if (midOld.length * midNew.length > exports.MAX_DIFF_CELLS) {
        return {
            identical: false,
            too_large: true,
            reason: `Diff too large to compute: ${oldLines.length} old line(s) vs ${newLines.length} new line(s) ` +
                `(${midOld.length}x${midNew.length} remain after trimming ${prefixLen} common leading and ` +
                `${suffixLen} common trailing line(s), exceeding the ${exports.MAX_DIFF_CELLS}-cell limit).`,
            stats: { old_lines: oldLines.length, new_lines: newLines.length },
        };
    }
    const midOps = diffLines(midOld, midNew);
    const ops = [];
    for (let k = 0; k < prefixLen; k++) {
        ops.push({
            type: 'equal',
            line: oldLines[k],
            oldPos: k + 1,
            newPos: k + 1,
        });
    }
    for (const op of midOps) {
        ops.push({
            type: op.type,
            line: op.line,
            oldPos: op.oldPos + prefixLen,
            newPos: op.newPos + prefixLen,
        });
    }
    for (let k = 0; k < suffixLen; k++) {
        const oldIdx = oldLines.length - suffixLen + k;
        const newIdx = newLines.length - suffixLen + k;
        ops.push({
            type: 'equal',
            line: oldLines[oldIdx],
            oldPos: oldIdx + 1,
            newPos: newIdx + 1,
        });
    }
    const added = ops.filter((o) => o.type === 'add').length;
    const removed = ops.filter((o) => o.type === 'remove').length;
    if (added === 0 && removed === 0) {
        return {
            identical: true,
            diff: '',
            stats: { added: 0, removed: 0, hunks: 0 },
        };
    }
    const hunks = buildHunks(ops, contextLines);
    const diffText = [
        `--- ${oldLabel}`,
        `+++ ${newLabel}`,
        ...hunks.map(formatHunk),
    ].join('\n');
    return {
        identical: false,
        diff: diffText,
        stats: { added, removed, hunks: hunks.length },
    };
}
//# sourceMappingURL=textDiff.js.map