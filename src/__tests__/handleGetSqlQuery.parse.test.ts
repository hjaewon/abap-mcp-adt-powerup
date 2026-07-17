import { parseSqlQueryXml } from '../handlers/system/readonly/handleGetSqlQuery';

/**
 * Offline unit tests for parseSqlQueryXml.
 *
 * Focus:
 *  - Fix 1: self-closing <dataPreview:data/> cells must NOT shift later rows.
 *  - Fix 2: returned_row_count / truncated / server_total_rows response fields.
 *
 * No SAP connection required — all fixtures are hand-built Data Preview XML.
 */

/**
 * Build one <dataPreview:columns> block (one column) with its metadata plus the
 * raw cell markup (already including <dataPreview:data ...> tags) for each row.
 */
function column(name: string, cells: string[]): string {
  return [
    '  <dataPreview:columns>',
    `    <dataPreview:metadata dataPreview:name="${name}" dataPreview:type="C" dataPreview:description="${name} desc" dataPreview:length="10"/>`,
    ...cells.map((c) => `    ${c}`),
    '  </dataPreview:columns>',
  ].join('\n');
}

const OPEN = (v: string) => `<dataPreview:data>${v}</dataPreview:data>`;
const EMPTY = '<dataPreview:data></dataPreview:data>';
const SELF_CLOSING = '<dataPreview:data/>';
const SELF_CLOSING_ATTR = '<dataPreview:data dataPreview:something="x"/>';

function buildXml(opts: { totalRows?: number; columns: string }): string {
  const total =
    opts.totalRows === undefined
      ? ''
      : `  <dataPreview:totalRows>${opts.totalRows}</dataPreview:totalRows>\n`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/datapreview">',
    `${total}  <dataPreview:queryExecutionTime>1.23</dataPreview:queryExecutionTime>`,
    opts.columns,
    '</dataPreview:tableData>',
  ].join('\n');
}

describe('parseSqlQueryXml — cell-shift fix (Fix 1)', () => {
  // 3 columns x 4 rows.
  //  COL_A: self-closing cell in a MIDDLE row (row index 1)
  //  COL_B: empty open/close cell (row 1) + whitespace-only cell (row 2)
  //  COL_C: all present
  const xml = buildXml({
    totalRows: 35936,
    columns: [
      column('COL_A', [OPEN('A0'), SELF_CLOSING, OPEN('A2'), OPEN('A3')]),
      column('COL_B', [OPEN('B0'), EMPTY, OPEN('   '), OPEN('B3')]),
      column('COL_C', [OPEN('C0'), OPEN('C1'), OPEN('C2'), OPEN('C3')]),
    ].join('\n'),
  });

  const parsed = parseSqlQueryXml(xml, 'SELECT * FROM TREL', 10000);

  test('parses all 4 rows across 3 columns', () => {
    expect(parsed.columns.map((c) => c.name)).toEqual([
      'COL_A',
      'COL_B',
      'COL_C',
    ]);
    expect(parsed.rows).toHaveLength(4);
  });

  test('self-closing cell in a middle row does NOT shift later rows', () => {
    // Row 1 self-closing -> null, but rows 2 and 3 keep their OWN values.
    expect(parsed.rows[0].COL_A).toBe('A0');
    expect(parsed.rows[1].COL_A).toBeNull(); // self-closing -> null
    expect(parsed.rows[2].COL_A).toBe('A2'); // NOT "A3" (no upward shift)
    expect(parsed.rows[3].COL_A).toBe('A3');
    // COL_C is unaffected and stays row-aligned.
    expect(parsed.rows.map((r) => r.COL_C)).toEqual(['C0', 'C1', 'C2', 'C3']);
  });

  test('empty open/close cell becomes null', () => {
    expect(parsed.rows[1].COL_B).toBeNull();
  });

  test('whitespace-only cell is preserved verbatim (not trimmed)', () => {
    expect(parsed.rows[2].COL_B).toBe('   ');
  });
});

describe('parseSqlQueryXml — self-closing with attributes', () => {
  test('<dataPreview:data .../> attribute form also maps to null without shift', () => {
    const xml = buildXml({
      columns: column('COL_X', [OPEN('X0'), SELF_CLOSING_ATTR, OPEN('X2')]),
    });
    const parsed = parseSqlQueryXml(xml, 'SELECT * FROM T', 100);
    expect(parsed.rows.map((r) => r.COL_X)).toEqual(['X0', null, 'X2']);
  });
});

describe('parseSqlQueryXml — truncation flags (Fix 2)', () => {
  test('server_total_rows extracted; truncated true when server total exceeds returned', () => {
    const xml = buildXml({
      totalRows: 35936,
      columns: column('COL_A', [OPEN('A0'), OPEN('A1'), OPEN('A2')]),
    });
    // rowNumber cap (10000) NOT hit (only 3 rows), but server total 35936 > 3.
    const parsed = parseSqlQueryXml(xml, 'SELECT * FROM TREL', 10000);
    expect(parsed.returned_row_count).toBe(3);
    expect(parsed.server_total_rows).toBe(35936);
    expect(parsed.truncated).toBe(true);
  });

  test('truncated true when returned count hits the requested cap', () => {
    // No totalRows element -> server_total_rows omitted. 3 rows, cap = 3.
    const xml = buildXml({
      columns: column('COL_A', [OPEN('A0'), OPEN('A1'), OPEN('A2')]),
    });
    const parsed = parseSqlQueryXml(xml, 'SELECT * FROM T', 3);
    expect(parsed.returned_row_count).toBe(3);
    expect(parsed.truncated).toBe(true);
    expect(parsed.server_total_rows).toBeUndefined();
  });

  test('not truncated when returned < cap and server total does not exceed it', () => {
    const xml = buildXml({
      totalRows: 3,
      columns: column('COL_A', [OPEN('A0'), OPEN('A1'), OPEN('A2')]),
    });
    const parsed = parseSqlQueryXml(xml, 'SELECT * FROM T', 100);
    expect(parsed.returned_row_count).toBe(3);
    expect(parsed.server_total_rows).toBe(3);
    expect(parsed.truncated).toBe(false);
  });
});
