/**
 * Pure string-patch logic for UpdateSourceByPatch.
 *
 * Locates `old_string` inside a source blob, validates uniqueness, applies
 * the replacement, and renders a compact unified-diff-style preview of the
 * changed region. No SAP I/O here — this module is exercised directly by
 * unit tests; the handler owns fetching/writing source via ADT.
 */

export interface SourcePatchResult {
  newSource: string;
  occurrences: number;
  /** Start index of the first occurrence in the ORIGINAL source. */
  firstMatchIndex: number;
}

/**
 * Returns the start index of every non-overlapping occurrence of `needle`
 * inside `haystack`.
 */
export function findOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const indices: number[] = [];
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    indices.push(idx);
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return indices;
}

/**
 * Applies a single or all-occurrences replacement of `oldString` with
 * `newString` inside `source`. Throws when `oldString` isn't found, or when
 * it matches more than once and `replaceAll` is false.
 */
export function applySourcePatch(
  source: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): SourcePatchResult {
  const indices = findOccurrences(source, oldString);

  if (indices.length === 0) {
    throw new Error('old_string not found in current source');
  }
  if (indices.length > 1 && !replaceAll) {
    throw new Error(
      `old_string matches ${indices.length} locations (not unique) — add more context to old_string, or pass replace_all: true to replace every occurrence`,
    );
  }

  if (replaceAll) {
    return {
      newSource: source.split(oldString).join(newString),
      occurrences: indices.length,
      firstMatchIndex: indices[0],
    };
  }

  const idx = indices[0];
  const newSource =
    source.slice(0, idx) + newString + source.slice(idx + oldString.length);
  return { newSource, occurrences: 1, firstMatchIndex: idx };
}

/**
 * Renders a compact unified-diff-style preview of the region around the
 * FIRST occurrence of the patch. Content before that occurrence is
 * identical between `oldSource` and `newSource`, so line numbers line up
 * on both sides.
 */
export function buildDiffPreview(
  oldSource: string,
  newSource: string,
  matchIndex: number,
  oldString: string,
  newString: string,
  contextLines = 2,
): string {
  const oldLines = oldSource.split('\n');
  const newLines = newSource.split('\n');

  const startLine = oldSource.slice(0, matchIndex).split('\n').length; // 1-based
  const oldBlockLineCount = oldString.split('\n').length;
  const newBlockLineCount = newString.split('\n').length;

  const oldStart = Math.max(1, startLine - contextLines);
  const oldEnd = Math.min(
    oldLines.length,
    startLine + oldBlockLineCount - 1 + contextLines,
  );
  const newEnd = Math.min(
    newLines.length,
    startLine + newBlockLineCount - 1 + contextLines,
  );

  const contextBefore = oldLines
    .slice(oldStart - 1, startLine - 1)
    .map((l) => ` ${l}`);
  const removed = oldLines
    .slice(startLine - 1, startLine - 1 + oldBlockLineCount)
    .map((l) => `-${l}`);
  const added = newLines
    .slice(startLine - 1, startLine - 1 + newBlockLineCount)
    .map((l) => `+${l}`);
  const contextAfter = oldLines
    .slice(startLine - 1 + oldBlockLineCount, oldEnd)
    .map((l) => ` ${l}`);

  const header = `@@ -${oldStart},${oldEnd - oldStart + 1} +${oldStart},${newEnd - oldStart + 1} @@`;

  return [header, ...contextBefore, ...removed, ...added, ...contextAfter].join(
    '\n',
  );
}
