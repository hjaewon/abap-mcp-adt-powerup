import { parseSqlQueryXml } from '../handlers/system/readonly/handleGetSqlQuery';

/**
 * ADT returns dataPreview column-wise: one <dataPreview:columns> section per
 * column, each holding that column's cells in row order. A NULL cell is emitted
 * as a self-closing <dataPreview:data/>. If such a cell is not materialised as a
 * positional null, the column array shortens and every later value slides up a
 * row — silently pairing values from different rows.
 */
function column(name: string, cells: (string | null)[]): string {
  const data = cells
    .map((c) =>
      c === null
        ? '<dataPreview:data/>'
        : `<dataPreview:data>${c}</dataPreview:data>`,
    )
    .join('');
  return (
    `<dataPreview:columns>` +
    `<dataPreview:metadata dataPreview:name="${name}" dataPreview:type="C" dataPreview:description="${name}" dataPreview:length="4"/>` +
    `<dataPreview:dataSet>${data}</dataPreview:dataSet>` +
    `</dataPreview:columns>`
  );
}

function tableData(columns: string[], totalRows: number): string {
  return (
    `<dataPreview:tableData>` +
    `<dataPreview:totalRows>${totalRows}</dataPreview:totalRows>` +
    `<dataPreview:queryExecutionTime>1.5</dataPreview:queryExecutionTime>` +
    columns.join('') +
    `</dataPreview:tableData>`
  );
}

describe('parseSqlQueryXml row alignment', () => {
  it('keeps rows aligned when a leading cell is NULL', () => {
    // Fixtures are synthetic. T001: the first company code has no chart of
    // accounts; YCOA/ZCOA belong to the LATER rows. Dropping the empty cell
    // would hand YCOA to the first row — a value that exists on a different
    // company code, so no plausibility check can catch the swap.
    const xml = tableData(
      [
        column('BUKRS', ['1000', '2000', '3000']),
        column('KTOPL', [null, 'YCOA', 'ZCOA']),
      ],
      3,
    );

    const { rows } = parseSqlQueryXml(xml, 'SELECT * FROM T001', 3);

    expect(rows).toEqual([
      { BUKRS: '1000', KTOPL: null },
      { BUKRS: '2000', KTOPL: 'YCOA' },
      { BUKRS: '3000', KTOPL: 'ZCOA' },
    ]);
  });

  it('keeps rows aligned when NULLs appear mid-column and in several columns', () => {
    const xml = tableData(
      [
        column('BUKRS', ['1000', '2000', '3000']),
        column('BUTXT', ['Example Corp', null, 'Example Trading']),
        column('WAERS', [null, 'EUR', null]),
      ],
      3,
    );

    const { rows } = parseSqlQueryXml(xml, 'SELECT * FROM T001', 3);

    expect(rows).toEqual([
      { BUKRS: '1000', BUTXT: 'Example Corp', WAERS: null },
      { BUKRS: '2000', BUTXT: null, WAERS: 'EUR' },
      { BUKRS: '3000', BUTXT: 'Example Trading', WAERS: null },
    ]);
  });

  it('parses metadata and non-null rows as before', () => {
    const xml = tableData(
      [column('BUKRS', ['1000', '2000']), column('KTOPL', ['YCOA', 'ZCOA'])],
      2,
    );

    const result = parseSqlQueryXml(xml, 'SELECT * FROM T001', 2);

    expect(result.total_rows).toBe(2);
    expect(result.execution_time).toBe(1.5);
    expect(result.columns.map((c) => c.name)).toEqual(['BUKRS', 'KTOPL']);
    expect(result.rows).toEqual([
      { BUKRS: '1000', KTOPL: 'YCOA' },
      { BUKRS: '2000', KTOPL: 'ZCOA' },
    ]);
  });

  it('reports ragged columns instead of emitting misaligned rows silently', () => {
    // Hand-built ragged payload: BUKRS has 2 cells, KTOPL only 1. Alignment
    // cannot be recovered here, so the parser must at least say so.
    const xml = tableData(
      [column('BUKRS', ['1000', '2000']), column('KTOPL', ['YCOA'])],
      2,
    );
    const logger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    parseSqlQueryXml(xml, 'SELECT * FROM T001', 2, logger as any);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('ragged columns'),
    );
  });
});
