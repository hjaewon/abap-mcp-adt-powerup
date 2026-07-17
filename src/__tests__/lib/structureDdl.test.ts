/**
 * Offline unit tests for the structure DDL generator (Fix 4).
 *
 * Pure/deterministic — no SAP connection required.
 */

import { generateStructureDdl } from '../../lib/structureDdl';

describe('generateStructureDdl', () => {
  it('renders a data-element-typed field', () => {
    const ddl = generateStructureDdl({
      structureName: 'ZST_TEST',
      fields: [{ name: 'MATNR', data_element: 'MATNR' }],
    });
    expect(ddl).toContain('define structure zst_test {');
    expect(ddl).toContain('  matnr : matnr;');
    expect(ddl.trim().endsWith('}')).toBe(true);
  });

  it('emits the EndUserText.label header when a description is given', () => {
    const ddl = generateStructureDdl({
      structureName: 'ZST_TEST',
      description: "Al's structure",
      fields: [{ name: 'ID', data_type: 'CHAR', length: 10 }],
    });
    // Single quote in the label is doubled.
    expect(ddl.startsWith("@EndUserText.label : 'Al''s structure'\n")).toBe(
      true,
    );
  });

  it('always emits the enhancement category header (ADT rejects the save without it)', () => {
    const ddl = generateStructureDdl({
      structureName: 'ZST_TEST',
      fields: [{ name: 'ID', data_type: 'CHAR', length: 10 }],
    });
    expect(ddl).toContain(
      '@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE\ndefine structure zst_test {',
    );
  });

  it('renders a built-in CHAR field with a length', () => {
    const ddl = generateStructureDdl({
      structureName: 'ZST_TEST',
      fields: [{ name: 'NAME', data_type: 'CHAR', length: 30 }],
    });
    expect(ddl).toContain('  name : abap.char(30);');
  });

  it('renders a DEC field with length and decimals', () => {
    const ddl = generateStructureDdl({
      structureName: 'ZST_TEST',
      fields: [{ name: 'RATE', data_type: 'DEC', length: 8, decimals: 3 }],
    });
    expect(ddl).toContain('  rate : abap.dec(8,3);');
  });

  it('defaults decimals to 0 for packed types when omitted', () => {
    const ddl = generateStructureDdl({
      structureName: 'ZST_TEST',
      fields: [{ name: 'CNT', data_type: 'DEC', length: 5 }],
    });
    expect(ddl).toContain('  cnt : abap.dec(5,0);');
  });

  it('renders a no-length built-in type without parentheses', () => {
    const ddl = generateStructureDdl({
      structureName: 'ZST_TEST',
      fields: [{ name: 'CREATED_ON', data_type: 'DATS' }],
    });
    expect(ddl).toContain('  created_on : abap.dats;');
  });

  it('renders a CURR field with a currency reference annotation', () => {
    const ddl = generateStructureDdl({
      structureName: 'ZST_TEST',
      fields: [
        { name: 'WAERS', data_type: 'CUKY' },
        {
          name: 'NETWR',
          data_type: 'CURR',
          length: 15,
          decimals: 2,
          currency_reference: 'WAERS',
        },
      ],
    });
    expect(ddl).toContain(
      "  @Semantics.amount.currencyCode : 'zst_test.waers'",
    );
    expect(ddl).toContain('  netwr : abap.curr(15,2);');
    // Annotation must sit immediately above the amount field.
    expect(ddl).toContain(
      "  @Semantics.amount.currencyCode : 'zst_test.waers'\n  netwr : abap.curr(15,2);",
    );
  });

  it('renders a QUAN field with a unit reference annotation', () => {
    const ddl = generateStructureDdl({
      structureName: 'ZST_TEST',
      fields: [
        { name: 'MEINS', data_type: 'UNIT', length: 3 },
        {
          name: 'MENGE',
          data_type: 'QUAN',
          length: 13,
          decimals: 3,
          unit_reference: 'MEINS',
        },
      ],
    });
    expect(ddl).toContain(
      "  @Semantics.quantity.unitOfMeasure : 'zst_test.meins'",
    );
    expect(ddl).toContain('  menge : abap.quan(13,3);');
  });

  it('renders an include line', () => {
    const ddl = generateStructureDdl({
      structureName: 'ZST_TEST',
      fields: [{ name: 'ID', data_type: 'CHAR', length: 10 }],
      includes: [{ name: 'ZINC_COMMON' }],
    });
    expect(ddl).toContain('  include zinc_common;');
  });

  it('throws, naming the field, when a field has neither data_element nor data_type', () => {
    expect(() =>
      generateStructureDdl({
        structureName: 'ZST_TEST',
        fields: [{ name: 'MYSTERY', domain: 'ZDOM_X' }],
      }),
    ).toThrow(/MYSTERY/);
  });

  it('throws when a length-based built-in type has no length', () => {
    expect(() =>
      generateStructureDdl({
        structureName: 'ZST_TEST',
        fields: [{ name: 'NAME', data_type: 'CHAR' }],
      }),
    ).toThrow(/requires a positive "length"/);
  });

  it('throws on an unrecognized data_type', () => {
    expect(() =>
      generateStructureDdl({
        structureName: 'ZST_TEST',
        fields: [{ name: 'X', data_type: 'BOGUS' }],
      }),
    ).toThrow(/unsupported data_type "BOGUS"/);
  });

  it('throws when an include carries a suffix (not expressible)', () => {
    expect(() =>
      generateStructureDdl({
        structureName: 'ZST_TEST',
        includes: [{ name: 'ZINC_COMMON', suffix: 'A' }],
      }),
    ).toThrow(/suffix/);
  });

  it('throws when there are no fields and no includes', () => {
    expect(() =>
      generateStructureDdl({ structureName: 'ZST_TEST', fields: [] }),
    ).toThrow(/At least one field or include/);
  });
});
