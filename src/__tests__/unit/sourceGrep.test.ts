import {
  aggregateGrepResults,
  compileGrepRegex,
  grepText,
  type ObjectGrepInput,
} from '../../lib/sourceGrep';

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
});
