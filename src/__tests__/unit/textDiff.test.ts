import { computeUnifiedDiff } from '../../lib/textDiff';

describe('computeUnifiedDiff', () => {
  it('reports identical for empty inputs', () => {
    const result = computeUnifiedDiff('', '');
    expect(result).toEqual({
      identical: true,
      diff: '',
      stats: { added: 0, removed: 0, hunks: 0 },
    });
  });

  it('reports identical when texts are equal', () => {
    const text = 'line1\nline2\nline3';
    const result = computeUnifiedDiff(text, text);
    expect(result.identical).toBe(true);
    expect(result.diff).toBe('');
    expect(result.stats).toEqual({ added: 0, removed: 0, hunks: 0 });
  });

  it('handles insert-only diffs (old empty, new has lines)', () => {
    const result = computeUnifiedDiff('', 'a\nb', { contextLines: 3 });
    expect(result.identical).toBe(false);
    expect(result.stats).toEqual({ added: 2, removed: 0, hunks: 1 });
    expect(result.diff).toBe(
      ['--- a', '+++ b', '@@ -0,0 +1,2 @@', '+a', '+b'].join('\n'),
    );
  });

  it('handles delete-only diffs (old has lines, new empty)', () => {
    const result = computeUnifiedDiff('a\nb', '', { contextLines: 3 });
    expect(result.identical).toBe(false);
    expect(result.stats).toEqual({ added: 0, removed: 2, hunks: 1 });
    expect(result.diff).toBe(
      ['--- a', '+++ b', '@@ -1,2 +0,0 @@', '-a', '-b'].join('\n'),
    );
  });

  it('produces a single hunk with correct context lines for a mid-file change', () => {
    const oldText = ['1', '2', '3', '4', '5', '6', '7'].join('\n');
    const newText = ['1', '2', '3', 'X', '5', '6', '7'].join('\n');
    const result = computeUnifiedDiff(oldText, newText, { contextLines: 1 });
    expect(result.identical).toBe(false);
    expect(result.stats).toEqual({ added: 1, removed: 1, hunks: 1 });
    expect(result.diff).toBe(
      ['--- a', '+++ b', '@@ -3,3 +3,3 @@', ' 3', '-4', '+X', ' 5'].join('\n'),
    );
  });

  it('splits distant changes into multiple hunks', () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `${i + 1}`).join('\n');
    const lines = Array.from({ length: 20 }, (_, i) => `${i + 1}`);
    lines[0] = 'A'; // change near line 1
    lines[19] = 'B'; // change near line 20
    const newText = lines.join('\n');

    const result = computeUnifiedDiff(oldText, newText, { contextLines: 2 });
    expect(result.identical).toBe(false);
    expect(result.stats).toEqual({ added: 2, removed: 2, hunks: 2 });
    expect(result.diff).toContain('@@ -1,3 +1,3 @@');
    expect(result.diff).toContain('@@ -18,3 +18,3 @@');
  });

  it('merges changes that are within 2*contextLines of each other', () => {
    // Two single-line changes 3 lines apart, contextLines=2 -> gap (1 equal
    // line) <= 2*2, so they must merge into a single hunk.
    const oldLines = ['1', '2', '3', '4', '5'];
    const newLines = ['1', 'X', '3', 'Y', '5'];
    const result = computeUnifiedDiff(
      oldLines.join('\n'),
      newLines.join('\n'),
      {
        contextLines: 2,
      },
    );
    expect(result.stats.hunks).toBe(1);
  });

  it('honors custom labels in the --- / +++ header', () => {
    const result = computeUnifiedDiff('a', 'b', {
      oldLabel: 'ZCL_A (CLAS)',
      newLabel: 'ZCL_B (CLAS)',
    });
    expect(result.diff.startsWith('--- ZCL_A (CLAS)\n+++ ZCL_B (CLAS)\n')).toBe(
      true,
    );
  });

  it('defaults contextLines to 3 when omitted', () => {
    const oldText = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n');
    const newText = ['1', '2', '3', '4', 'X', '6', '7', '8', '9'].join('\n');
    const result = computeUnifiedDiff(oldText, newText);
    expect(result.diff).toContain('@@ -2,7 +2,7 @@');
  });

  it('treats negative contextLines as zero', () => {
    const result = computeUnifiedDiff('1\n2\n3', '1\nX\n3', {
      contextLines: -5,
    });
    expect(result.diff).toBe(
      ['--- a', '+++ b', '@@ -2 +2 @@', '-2', '+X'].join('\n'),
    );
  });

  it('normalizes different line-ending styles when comparing for equality', () => {
    const result = computeUnifiedDiff('a\r\nb\r\nc', 'a\nb\nc');
    expect(result.identical).toBe(true);
  });
});
