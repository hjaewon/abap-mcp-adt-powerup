import {
  applySourcePatch,
  buildDiffPreview,
  findOccurrences,
} from '../../lib/sourcePatch';

describe('findOccurrences', () => {
  it('returns an empty array when needle is missing', () => {
    expect(findOccurrences('abc abc abc', '')).toEqual([]);
  });

  it('returns an empty array when there is no match', () => {
    expect(findOccurrences('hello world', 'xyz')).toEqual([]);
  });

  it('returns a single index for a unique match', () => {
    expect(findOccurrences('line1\nOLD\nline3', 'OLD')).toEqual([6]);
  });

  it('returns every non-overlapping match index', () => {
    expect(findOccurrences('foo bar foo baz foo', 'foo')).toEqual([0, 8, 16]);
  });
});

describe('applySourcePatch', () => {
  it('throws "not found" when old_string is absent', () => {
    expect(() => applySourcePatch('hello world', 'xyz', 'abc', false)).toThrow(
      /old_string not found/,
    );
  });

  it('throws a "not unique" error with the match count when ambiguous', () => {
    expect(() => applySourcePatch('foo bar foo', 'foo', 'baz', false)).toThrow(
      /matches 2 locations/,
    );
  });

  it('replaces a unique match and reports occurrences=1', () => {
    const result = applySourcePatch('line1\nOLD\nline3', 'OLD', 'NEW', false);
    expect(result.newSource).toBe('line1\nNEW\nline3');
    expect(result.occurrences).toBe(1);
    expect(result.firstMatchIndex).toBe(6);
  });

  it('replaces every occurrence when replace_all is true', () => {
    const result = applySourcePatch('foo bar foo baz foo', 'foo', 'qux', true);
    expect(result.newSource).toBe('qux bar qux baz qux');
    expect(result.occurrences).toBe(3);
    expect(result.firstMatchIndex).toBe(0);
  });

  it('does not throw for an ambiguous match when replace_all is true', () => {
    expect(() =>
      applySourcePatch('foo bar foo', 'foo', 'baz', true),
    ).not.toThrow();
  });
});

describe('buildDiffPreview', () => {
  it('renders a compact unified-diff-style hunk with context lines', () => {
    const oldSource = 'line1\nline2\nOLD\nline4\nline5';
    const newSource = 'line1\nline2\nNEW\nline4\nline5';
    const matchIndex = oldSource.indexOf('OLD');

    const preview = buildDiffPreview(
      oldSource,
      newSource,
      matchIndex,
      'OLD',
      'NEW',
    );

    expect(preview).toBe(
      [
        '@@ -1,5 +1,5 @@',
        ' line1',
        ' line2',
        '-OLD',
        '+NEW',
        ' line4',
        ' line5',
      ].join('\n'),
    );
  });

  it('clamps context at the start and end of the source', () => {
    const oldSource = 'OLD\nline2';
    const newSource = 'NEW\nline2';
    const matchIndex = 0;

    const preview = buildDiffPreview(
      oldSource,
      newSource,
      matchIndex,
      'OLD',
      'NEW',
    );

    expect(preview).toBe(
      ['@@ -1,2 +1,2 @@', '-OLD', '+NEW', ' line2'].join('\n'),
    );
  });

  it('handles multi-line old/new blocks', () => {
    const oldSource = 'a\nOLD1\nOLD2\nb';
    const newSource = 'a\nNEW1\nNEW2\nNEW3\nb';
    const matchIndex = oldSource.indexOf('OLD1');

    const preview = buildDiffPreview(
      oldSource,
      newSource,
      matchIndex,
      'OLD1\nOLD2',
      'NEW1\nNEW2\nNEW3',
      1,
    );

    expect(preview).toBe(
      [
        '@@ -1,4 +1,5 @@',
        ' a',
        '-OLD1',
        '-OLD2',
        '+NEW1',
        '+NEW2',
        '+NEW3',
        ' b',
      ].join('\n'),
    );
  });
});
