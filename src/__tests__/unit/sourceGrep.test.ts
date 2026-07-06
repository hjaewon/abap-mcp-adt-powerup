import {
  aggregateGrepResults,
  compileGrepRegex,
  grepText,
  MAX_LINES_PER_OBJECT,
  type ObjectGrepInput,
} from '../../lib/sourceGrep';

/** Builds a source with more than MAX_LINES_PER_OBJECT lines, none of which match anything meaningful. */
function buildOversizedSource(): string {
  return Array.from(
    { length: MAX_LINES_PER_OBJECT + 5 },
    (_, i) => `DATA(lv_x_${i}) = 1.`,
  ).join('\n');
}

describe('compileGrepRegex', () => {
  it('compiles a valid pattern', () => {
    const regex = compileGrepRegex('SELECT\\s+\\*');
    expect(regex.test('SELECT * FROM mara')).toBe(true);
  });

  it('applies the case-insensitive flag', () => {
    const regex = compileGrepRegex('select', true);
    expect(regex.test('SELECT SINGLE * FROM mara')).toBe(true);
  });

  it('throws McpError for an invalid regex pattern', () => {
    expect(() => compileGrepRegex('(unclosed')).toThrow(
      /Invalid regex pattern/,
    );
  });

  it('throws McpError for an empty pattern', () => {
    expect(() => compileGrepRegex('')).toThrow(/non-empty string/);
  });
});

describe('grepText', () => {
  const source = [
    'REPORT z_test.',
    'DATA: lv_result TYPE i.',
    'SELECT SINGLE * FROM mara INTO @DATA(ls_mara).',
    'WRITE: / lv_result.',
    'SELECT SINGLE * FROM marc INTO @DATA(ls_marc).',
  ].join('\n');

  it('finds a basic match', () => {
    const regex = compileGrepRegex('SELECT SINGLE');
    const { matches, hasMore } = grepText(source, regex, 0, 100);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({
      line: 3,
      text: 'SELECT SINGLE * FROM mara INTO @DATA(ls_mara).',
      context_before: [],
      context_after: [],
    });
    expect(matches[1].line).toBe(5);
    expect(hasMore).toBe(false);
  });

  it('matches case-insensitively when requested', () => {
    const regex = compileGrepRegex('report', true);
    const { matches } = grepText(source, regex, 0, 100);
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(1);
  });

  it('is case-sensitive by default (no match on different case)', () => {
    const regex = compileGrepRegex('report');
    const { matches } = grepText(source, regex, 0, 100);
    expect(matches).toHaveLength(0);
  });

  it('includes context lines around a match', () => {
    const regex = compileGrepRegex('WRITE');
    const { matches } = grepText(source, regex, 1, 100);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      line: 4,
      text: 'WRITE: / lv_result.',
      context_before: ['SELECT SINGLE * FROM mara INTO @DATA(ls_mara).'],
      context_after: ['SELECT SINGLE * FROM marc INTO @DATA(ls_marc).'],
    });
  });

  it('clamps context at the start of the file (no lines before line 1)', () => {
    const regex = compileGrepRegex('REPORT');
    const { matches } = grepText(source, regex, 3, 100);
    expect(matches[0].context_before).toEqual([]);
    expect(matches[0].context_after).toHaveLength(3);
  });

  it('clamps context at the end of the file (no lines after the last line)', () => {
    const regex = compileGrepRegex('marc');
    const { matches } = grepText(source, regex, 3, 100);
    expect(matches[0].line).toBe(5);
    expect(matches[0].context_after).toEqual([]);
    expect(matches[0].context_before.length).toBeGreaterThan(0);
  });

  it('truncates at max_matches and reports hasMore', () => {
    const regex = compileGrepRegex('SELECT SINGLE');
    const { matches, hasMore } = grepText(source, regex, 0, 1);
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(3);
    expect(hasMore).toBe(true);
  });

  it('does not report hasMore when every match fit under the cap', () => {
    const regex = compileGrepRegex('SELECT SINGLE');
    const { hasMore } = grepText(source, regex, 0, 10);
    expect(hasMore).toBe(false);
  });

  it('reports matchLimitReached (not lineCapReached) when the match cap is hit', () => {
    const regex = compileGrepRegex('SELECT SINGLE');
    const { matchLimitReached, lineCapReached } = grepText(source, regex, 0, 1);
    expect(matchLimitReached).toBe(true);
    expect(lineCapReached).toBe(false);
  });

  it('reports lineCapReached (not matchLimitReached) when only the per-object line cap is hit', () => {
    const oversized = buildOversizedSource();
    const regex = compileGrepRegex('NO_SUCH_TOKEN_ANYWHERE');
    const result = grepText(oversized, regex, 0, 100);
    expect(result.matches).toHaveLength(0);
    expect(result.matchLimitReached).toBe(false);
    expect(result.lineCapReached).toBe(true);
    expect(result.hasMore).toBe(true);
  });
});

describe('aggregateGrepResults', () => {
  const regex = compileGrepRegex('SELECT');

  it('aggregates matches across multiple objects', () => {
    const objects: ObjectGrepInput[] = [
      {
        object_type: 'CLAS',
        object_name: 'ZCL_A',
        source: 'METHOD foo.\nSELECT * FROM mara.\nENDMETHOD.',
      },
      {
        object_type: 'PROG',
        object_name: 'Z_PROG_B',
        source: 'REPORT z_prog_b.\nSELECT * FROM marc.\nSELECT * FROM mard.',
      },
    ];

    const result = aggregateGrepResults(objects, regex, { max_results: 100 });

    expect(result.total_matches).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.skipped).toEqual([]);
    expect(result.results).toEqual([
      {
        object_type: 'CLAS',
        object_name: 'ZCL_A',
        matches: [
          {
            line: 2,
            text: 'SELECT * FROM mara.',
            context_before: [],
            context_after: [],
          },
        ],
      },
      {
        object_type: 'PROG',
        object_name: 'Z_PROG_B',
        matches: [
          {
            line: 2,
            text: 'SELECT * FROM marc.',
            context_before: [],
            context_after: [],
          },
          {
            line: 3,
            text: 'SELECT * FROM mard.',
            context_before: [],
            context_after: [],
          },
        ],
      },
    ]);
  });

  it('records objects with no fetchable source in skipped, and excludes them from results', () => {
    const objects: ObjectGrepInput[] = [
      {
        object_type: 'CLAS',
        object_name: 'ZCL_A',
        source: 'SELECT * FROM mara.',
      },
      {
        object_type: 'FUNC',
        object_name: 'Z_MY_FM',
        source: null,
        skip_reason: 'Function module source requires a function group name.',
      },
    ];

    const result = aggregateGrepResults(objects, regex);

    expect(result.results).toHaveLength(1);
    expect(result.skipped).toEqual([
      {
        object: 'FUNC Z_MY_FM',
        reason: 'Function module source requires a function group name.',
      },
    ]);
  });

  it('respects a global max_results cap across objects and marks truncated', () => {
    const objects: ObjectGrepInput[] = [
      {
        object_type: 'CLAS',
        object_name: 'ZCL_A',
        source: 'SELECT 1.\nSELECT 2.\nSELECT 3.',
      },
      {
        object_type: 'PROG',
        object_name: 'Z_PROG_B',
        source: 'SELECT 4.\nSELECT 5.',
      },
    ];

    const result = aggregateGrepResults(objects, regex, { max_results: 2 });

    expect(result.total_matches).toBe(2);
    expect(result.truncated).toBe(true);
    // First object exhausts the cap (2 of its 3 matches); second object is
    // never scanned and shows up as skipped instead.
    expect(result.results).toEqual([
      {
        object_type: 'CLAS',
        object_name: 'ZCL_A',
        matches: [
          { line: 1, text: 'SELECT 1.', context_before: [], context_after: [] },
          { line: 2, text: 'SELECT 2.', context_before: [], context_after: [] },
        ],
      },
    ]);
    expect(result.skipped).toEqual([
      {
        object: 'PROG Z_PROG_B',
        reason: 'max_results reached; object not scanned',
      },
    ]);
  });

  it('does not stop the scan or mark truncated when an oversized object with no matches precedes normal objects (package-scan simulation)', () => {
    const objects: ObjectGrepInput[] = [
      {
        object_type: 'PROG',
        object_name: 'Z_HUGE_NO_MATCH',
        source: buildOversizedSource(),
      },
      {
        object_type: 'CLAS',
        object_name: 'ZCL_A',
        source: 'METHOD foo.\nSELECT * FROM mara.\nENDMETHOD.',
      },
      {
        object_type: 'PROG',
        object_name: 'Z_PROG_B',
        source: 'REPORT z_prog_b.\nSELECT * FROM marc.',
      },
    ];

    const result = aggregateGrepResults(objects, regex, { max_results: 100 });

    // Total matches are well under max_results, so the global scan must not
    // be marked truncated just because one object hit its own line cap.
    expect(result.total_matches).toBe(2);
    expect(result.truncated).toBe(false);
    // Both objects scanned after the oversized one must still contribute
    // their matches — the scan must not have stopped early.
    expect(result.results).toEqual([
      {
        object_type: 'CLAS',
        object_name: 'ZCL_A',
        matches: [
          {
            line: 2,
            text: 'SELECT * FROM mara.',
            context_before: [],
            context_after: [],
          },
        ],
      },
      {
        object_type: 'PROG',
        object_name: 'Z_PROG_B',
        matches: [
          {
            line: 2,
            text: 'SELECT * FROM marc.',
            context_before: [],
            context_after: [],
          },
        ],
      },
    ]);
    // The oversized, no-match object is reported distinctly from the
    // "max_results reached" skip reason.
    expect(result.skipped).toEqual([
      {
        object: 'PROG Z_HUGE_NO_MATCH',
        reason: `object exceeds the ${MAX_LINES_PER_OBJECT}-line scan cap; no matches found in the scanned portion`,
      },
    ]);
  });
});
