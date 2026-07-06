/**
 * textDiff — compact, dependency-free line-based unified diff.
 *
 * Uses a full O(N*M) LCS dynamic-programming backtrack to compute the
 * line-level edit script between two texts, then groups it into standard
 * unified-diff hunks (`@@ -l,c +l,c @@`) with configurable context lines.
 * O(N*M) is acceptable here because inputs are bounded ABAP source files,
 * not arbitrary large corpora.
 */

export type DiffOpType = 'equal' | 'add' | 'remove';

export interface DiffOp {
  type: DiffOpType;
  line: string;
  /** 1-based line number in the old file, as of just before this op. */
  oldPos: number;
  /** 1-based line number in the new file, as of just before this op. */
  newPos: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  ops: DiffOp[];
}

export interface UnifiedDiffOptions {
  /** Number of unchanged context lines around each change. Default 3. */
  contextLines?: number;
  /** Label for the old/left side, used in the `---` header line. */
  oldLabel?: string;
  /** Label for the new/right side, used in the `+++` header line. */
  newLabel?: string;
}

export interface UnifiedDiffResult {
  identical: boolean;
  diff: string;
  stats: { added: number; removed: number; hunks: number };
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split(/\r\n|\r|\n/);
}

/**
 * Computes the line-level edit script (equal/add/remove ops) between two
 * arrays of lines using a full LCS dynamic-programming table.
 */
export function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;

  // dp[i][j] = length of LCS(oldLines[i:], newLines[j:])
  const dp: Int32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
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
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', line: oldLines[i], oldPos, newPos });
      i++;
      oldPos++;
    } else {
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
export function buildHunks(ops: DiffOp[], contextLines: number): DiffHunk[] {
  const n = ops.length;
  const included = new Array<boolean>(n).fill(false);
  for (let k = 0; k < n; k++) {
    if (ops[k].type !== 'equal') {
      const lo = Math.max(0, k - contextLines);
      const hi = Math.min(n - 1, k + contextLines);
      for (let x = lo; x <= hi; x++) included[x] = true;
    }
  }

  const hunks: DiffHunk[] = [];
  let k = 0;
  while (k < n) {
    if (!included[k]) {
      k++;
      continue;
    }
    const start = k;
    while (k < n && included[k]) k++;
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

function formatRange(start: number, count: number): string {
  if (count === 0) return `${Math.max(0, start - 1)},0`;
  if (count === 1) return `${start}`;
  return `${start},${count}`;
}

function formatHunk(hunk: DiffHunk): string {
  const header = `@@ -${formatRange(hunk.oldStart, hunk.oldLines)} +${formatRange(
    hunk.newStart,
    hunk.newLines,
  )} @@`;
  const body = hunk.ops.map((op) => {
    const prefix = op.type === 'equal' ? ' ' : op.type === 'remove' ? '-' : '+';
    return `${prefix}${op.line}`;
  });
  return [header, ...body].join('\n');
}

/**
 * Computes a full unified diff between two texts.
 */
export function computeUnifiedDiff(
  oldText: string,
  newText: string,
  options: UnifiedDiffOptions = {},
): UnifiedDiffResult {
  const contextLines = Math.max(0, options.contextLines ?? 3);
  const oldLabel = options.oldLabel ?? 'a';
  const newLabel = options.newLabel ?? 'b';

  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const ops = diffLines(oldLines, newLines);

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
