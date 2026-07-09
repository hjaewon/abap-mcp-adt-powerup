import { classifySourceType } from '../../lib/objectSourceFetch';

describe('classifySourceType', () => {
  it('classifies a standalone program include (PROG/I) as INCL', () => {
    expect(classifySourceType('PROG/I')).toBe('INCL');
  });

  it('classifies a function-group include (FUGR/I) as INCL, not FUGR', () => {
    // Regression: FUGR/I (code living inside a function group, e.g.
    // "LZFOOF01") previously fell through to the generic FUGR/ prefix rule
    // and was misclassified as FUGR, causing GetCallGraph to build a
    // function-group URI from an include name (404) and lose the caller
    // chain through that include.
    expect(classifySourceType('FUGR/I')).toBe('INCL');
  });

  it('still classifies a plain function group (FUGR) as FUGR', () => {
    expect(classifySourceType('FUGR')).toBe('FUGR');
  });

  it('still classifies a function-group subtype other than /I as FUGR', () => {
    expect(classifySourceType('FUGR/FG')).toBe('FUGR');
  });

  it('still classifies an individual function module (FUGR/FF) as FUNC', () => {
    expect(classifySourceType('FUGR/FF')).toBe('FUNC');
  });

  it('classifies a class (CLAS/OC) as CLAS', () => {
    expect(classifySourceType('CLAS/OC')).toBe('CLAS');
  });

  it('classifies a program (PROG/P) as PROG', () => {
    expect(classifySourceType('PROG/P')).toBe('PROG');
  });

  it('classifies an interface (INTF/IF) as INTF', () => {
    expect(classifySourceType('INTF/IF')).toBe('INTF');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(classifySourceType('  fugr/i  ')).toBe('INCL');
  });

  it('returns undefined for an unrecognized or empty type', () => {
    expect(classifySourceType('DDLS/DF')).toBeUndefined();
    expect(classifySourceType('')).toBeUndefined();
  });
});
