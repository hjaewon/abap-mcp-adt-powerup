import {
  extractMethodSource,
  findMethodBoundary,
  listMethodImplementations,
  type MethodBoundary,
  spliceMethodSource,
  validateMethodBlock,
} from '../../lib/abapMethodBoundaries';

/** Looks up a method boundary and fails the test immediately if not found. */
function requireBoundary(source: string, methodName: string): MethodBoundary {
  const boundary = findMethodBoundary(source, methodName);
  if (boundary === null) {
    throw new Error(`test fixture error: method "${methodName}" not found`);
  }
  return boundary;
}

describe('abapMethodBoundaries', () => {
  describe('findMethodBoundary / listMethodImplementations', () => {
    it('locates a simple method', () => {
      const source = [
        'CLASS zcl_foo IMPLEMENTATION.',
        '  METHOD get_data.',
        '    DATA(lv_x) = 1.',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      const boundary = findMethodBoundary(source, 'get_data');
      expect(boundary).toEqual({ name: 'get_data', startLine: 2, endLine: 4 });
      expect(
        extractMethodSource(source, requireBoundary(source, 'get_data')),
      ).toBe(
        ['  METHOD get_data.', '    DATA(lv_x) = 1.', '  ENDMETHOD.'].join(
          '\n',
        ),
      );
    });

    it('is case-insensitive on the method name', () => {
      const source = ['METHOD Get_Data.', '  RETURN.', 'ENDMETHOD.'].join('\n');
      expect(findMethodBoundary(source, 'GET_DATA')).toEqual({
        name: 'Get_Data',
        startLine: 1,
        endLine: 3,
      });
    });

    it('lists multiple method implementations with correct ranges', () => {
      const source = [
        'CLASS zcl_foo IMPLEMENTATION.',
        '  METHOD first.',
        '    DATA(lv_a) = 1.',
        '  ENDMETHOD.',
        '  METHOD second.',
        '    DATA(lv_b) = 2.',
        '    DATA(lv_c) = 3.',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      const all = listMethodImplementations(source);
      expect(all).toEqual([
        { name: 'first', startLine: 2, endLine: 4 },
        { name: 'second', startLine: 5, endLine: 8 },
      ]);
    });

    it('locates an interface method implementation with a tilde in the name', () => {
      const source = [
        'CLASS zcl_foo IMPLEMENTATION.',
        '  METHOD zif_foo~bar.',
        '    RETURN.',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      expect(findMethodBoundary(source, 'zif_foo~bar')).toEqual({
        name: 'zif_foo~bar',
        startLine: 2,
        endLine: 4,
      });
    });

    it('does not match a method name that only appears in a comment', () => {
      const source = [
        '* METHOD fake_method.',
        '  " METHOD another_fake.',
        '  METHOD real_method. " METHOD trailing_comment_fake.',
        '    RETURN.',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      expect(findMethodBoundary(source, 'fake_method')).toBeNull();
      expect(findMethodBoundary(source, 'another_fake')).toBeNull();
      expect(findMethodBoundary(source, 'trailing_comment_fake')).toBeNull();
      expect(findMethodBoundary(source, 'real_method')).toEqual({
        name: 'real_method',
        startLine: 3,
        endLine: 5,
      });
    });

    it('does not match a method name that only appears inside a string literal', () => {
      const source = [
        '  METHOD real_method.',
        "    lv_text = 'METHOD fake_in_string.'.",
        '  ENDMETHOD.',
        '  METHOD fake_in_string.',
        '    RETURN.',
        '  ENDMETHOD.',
      ].join('\n');

      // The first (real) implementation must resolve correctly...
      expect(findMethodBoundary(source, 'real_method')).toEqual({
        name: 'real_method',
        startLine: 1,
        endLine: 3,
      });
      // ...and the string-literal occurrence must not be picked up instead
      // of the genuine implementation declared later in the source.
      expect(findMethodBoundary(source, 'fake_in_string')).toEqual({
        name: 'fake_in_string',
        startLine: 4,
        endLine: 6,
      });
    });

    it('does not treat ENDMETHOD inside a string literal as closing the block', () => {
      const source = [
        '  METHOD real_method.',
        "    lv_text = 'not the real ENDMETHOD.'.",
        '    DATA(lv_y) = 1.',
        '  ENDMETHOD.',
      ].join('\n');

      expect(findMethodBoundary(source, 'real_method')).toEqual({
        name: 'real_method',
        startLine: 1,
        endLine: 4,
      });
    });

    it('locates an AMDP method with a single-line BY DATABASE PROCEDURE addition', () => {
      const source = [
        'CLASS zcl_foo IMPLEMENTATION.',
        '  METHOD get_data BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT USING t001.',
        '    lt_result = select * from t001;',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      expect(findMethodBoundary(source, 'get_data')).toEqual({
        name: 'get_data',
        startLine: 2,
        endLine: 4,
      });
    });

    it('locates an AMDP method whose BY DATABASE PROCEDURE addition spans multiple lines', () => {
      const source = [
        'CLASS zcl_foo IMPLEMENTATION.',
        '  METHOD get_data',
        '    BY DATABASE PROCEDURE',
        '    FOR HDB LANGUAGE SQLSCRIPT',
        '    USING t001.',
        '    lt_result = select * from t001;',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      expect(findMethodBoundary(source, 'get_data')).toEqual({
        name: 'get_data',
        startLine: 2,
        endLine: 7,
      });
    });

    it('locates a namespaced interface method implementation (leading /NS/ plus tilde)', () => {
      const source = [
        'CLASS zcl_foo IMPLEMENTATION.',
        '  METHOD /iwbep/if_mgw_appl_srv_runtime~get_entityset.',
        '    RETURN.',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      expect(
        findMethodBoundary(
          source,
          '/iwbep/if_mgw_appl_srv_runtime~get_entityset',
        ),
      ).toEqual({
        name: '/iwbep/if_mgw_appl_srv_runtime~get_entityset',
        startLine: 2,
        endLine: 4,
      });
    });

    it('locates a method implementation of a namespaced class name', () => {
      const source = [
        'CLASS /ns1/cl_foo IMPLEMENTATION.',
        '  METHOD /ns1/get_data.',
        '    RETURN.',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      expect(findMethodBoundary(source, '/ns1/get_data')).toEqual({
        name: '/ns1/get_data',
        startLine: 2,
        endLine: 4,
      });
    });

    it('locates a one-line method (METHOD a. ... ENDMETHOD. on a single line) followed by a normal method, keeping both independently addressable', () => {
      // Regression for the 4.10.1 METHOD_START_RE widening: it opened a
      // boundary at the one-line METHOD but never saw the same-line
      // ENDMETHOD, so the boundary swallowed the next method too.
      const source = [
        'CLASS zcl_foo IMPLEMENTATION.',
        '  METHOD a. RETURN. ENDMETHOD.',
        '  METHOD b.',
        '    DATA(lv_x) = 1.',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      expect(listMethodImplementations(source)).toEqual([
        { name: 'a', startLine: 2, endLine: 2 },
        { name: 'b', startLine: 3, endLine: 5 },
      ]);
      expect(findMethodBoundary(source, 'a')).toEqual({
        name: 'a',
        startLine: 2,
        endLine: 2,
      });
      expect(findMethodBoundary(source, 'b')).toEqual({
        name: 'b',
        startLine: 3,
        endLine: 5,
      });
    });

    it('splices a one-line method without deleting the next method (data-loss regression)', () => {
      const source = [
        'CLASS zcl_foo IMPLEMENTATION.',
        '  METHOD a. RETURN. ENDMETHOD.',
        '  METHOD b.',
        '    DATA(lv_x) = 1.',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      const boundaryA = requireBoundary(source, 'a');
      const replacement = ['METHOD a.', '  RETURN 42.', 'ENDMETHOD.'].join(
        '\n',
      );
      const spliced = spliceMethodSource(source, boundaryA, replacement);

      expect(spliced.split('\n')).toEqual([
        'CLASS zcl_foo IMPLEMENTATION.',
        'METHOD a.',
        '  RETURN 42.',
        'ENDMETHOD.',
        '  METHOD b.',
        '    DATA(lv_x) = 1.',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ]);

      // Method b must still be independently locatable, fully intact, at its
      // shifted position.
      const bAfter = findMethodBoundary(spliced, 'b');
      expect(bAfter).toEqual({ name: 'b', startLine: 5, endLine: 7 });
      expect(extractMethodSource(spliced, bAfter as MethodBoundary)).toBe(
        ['  METHOD b.', '    DATA(lv_x) = 1.', '  ENDMETHOD.'].join('\n'),
      );
    });

    it('locates a one-line method that is the last method in the file', () => {
      const source = [
        'CLASS zcl_foo IMPLEMENTATION.',
        '  METHOD only_one. RETURN. ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      expect(listMethodImplementations(source)).toEqual([
        { name: 'only_one', startLine: 2, endLine: 2 },
      ]);
    });

    it('lists a file made entirely of one-line methods, alongside a normal multi-line one', () => {
      const source = [
        'METHOD a. RETURN. ENDMETHOD.',
        'METHOD b. RETURN. ENDMETHOD.',
        'METHOD c.',
        '  DATA(lv) = 1.',
        'ENDMETHOD.',
      ].join('\n');

      expect(listMethodImplementations(source)).toEqual([
        { name: 'a', startLine: 1, endLine: 1 },
        { name: 'b', startLine: 2, endLine: 2 },
        { name: 'c', startLine: 3, endLine: 5 },
      ]);
    });

    it('returns null and an accurate available-methods list when not found', () => {
      const source = [
        '  METHOD alpha.',
        '  ENDMETHOD.',
        '  METHOD beta.',
        '  ENDMETHOD.',
      ].join('\n');

      expect(findMethodBoundary(source, 'gamma')).toBeNull();
      expect(listMethodImplementations(source).map((m) => m.name)).toEqual([
        'alpha',
        'beta',
      ]);
    });
  });

  describe('validateMethodBlock', () => {
    it('accepts a well-formed block matching the expected name', () => {
      const block = ['METHOD get_data.', '  RETURN.', 'ENDMETHOD.'].join('\n');
      expect(validateMethodBlock(block, 'get_data')).toEqual({
        valid: true,
        name: 'get_data',
      });
    });

    it('tolerates leading/trailing blank lines', () => {
      const block = [
        '',
        '  ',
        'METHOD get_data.',
        '  RETURN.',
        'ENDMETHOD.',
        '',
      ].join('\n');
      expect(validateMethodBlock(block, 'get_data').valid).toBe(true);
    });

    it('rejects a block whose declared name does not match method_name', () => {
      const block = ['METHOD other_method.', 'ENDMETHOD.'].join('\n');
      const result = validateMethodBlock(block, 'get_data');
      expect(result.valid).toBe(false);
      expect(result.name).toBe('other_method');
      expect(result.error).toMatch(/method name mismatch/i);
    });

    it('rejects a block missing ENDMETHOD', () => {
      const block = ['METHOD get_data.', '  RETURN.'].join('\n');
      const result = validateMethodBlock(block, 'get_data');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/must end with "ENDMETHOD\."/i);
    });

    it('rejects a block not starting with METHOD', () => {
      const block = ['DATA(lv_x) = 1.', 'ENDMETHOD.'].join('\n');
      const result = validateMethodBlock(block, 'get_data');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/must start with "METHOD/i);
    });

    it('accepts an AMDP method header with a multi-line BY DATABASE PROCEDURE addition', () => {
      const block = [
        'METHOD get_data',
        '  BY DATABASE PROCEDURE',
        '  FOR HDB LANGUAGE SQLSCRIPT',
        '  USING t001.',
        '  lt_result = select * from t001;',
        'ENDMETHOD.',
      ].join('\n');
      expect(validateMethodBlock(block, 'get_data')).toEqual({
        valid: true,
        name: 'get_data',
      });
    });

    it('rejects a METHOD statement that never terminates with a period (widened-regex regression)', () => {
      // The 4.10.1 METHOD_START_RE widening (lookahead instead of a
      // full-line anchor) made a bare "METHOD name" with no period anywhere
      // match as a valid start line. Must still be rejected.
      const block = ['METHOD get_data', 'ENDMETHOD.'].join('\n');
      const result = validateMethodBlock(block, 'get_data');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/terminated by a period/i);
    });

    it('accepts a METHOD ... REDEFINITION.-style addition since it terminates with a period (no addition enumeration)', () => {
      const block = ['METHOD get_data REDEFINITION.', 'ENDMETHOD.'].join('\n');
      expect(validateMethodBlock(block, 'get_data')).toEqual({
        valid: true,
        name: 'get_data',
      });
    });

    it('accepts a namespaced interface method header', () => {
      const block = [
        'METHOD /iwbep/if_mgw_appl_srv_runtime~get_entityset.',
        '  RETURN.',
        'ENDMETHOD.',
      ].join('\n');
      expect(
        validateMethodBlock(
          block,
          '/iwbep/if_mgw_appl_srv_runtime~get_entityset',
        ),
      ).toEqual({
        valid: true,
        name: '/iwbep/if_mgw_appl_srv_runtime~get_entityset',
      });
    });
  });

  describe('spliceMethodSource', () => {
    it('replaces exactly the boundary lines and preserves the rest of the class', () => {
      const source = [
        'CLASS zcl_foo IMPLEMENTATION.',
        '  METHOD first.',
        '    DATA(lv_a) = 1.',
        '  ENDMETHOD.',
        '  METHOD second.',
        '    DATA(lv_b) = 2.',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ].join('\n');

      const boundary = requireBoundary(source, 'first');
      const replacement = [
        'METHOD first.',
        '  DATA(lv_a) = 42.',
        '  DATA(lv_extra) = 43.',
        'ENDMETHOD.',
      ].join('\n');

      const spliced = spliceMethodSource(source, boundary, replacement);

      expect(spliced.split('\n')).toEqual([
        'CLASS zcl_foo IMPLEMENTATION.',
        'METHOD first.',
        '  DATA(lv_a) = 42.',
        '  DATA(lv_extra) = 43.',
        'ENDMETHOD.',
        '  METHOD second.',
        '    DATA(lv_b) = 2.',
        '  ENDMETHOD.',
        'ENDCLASS.',
      ]);

      // The untouched method is still discoverable at its new position.
      const secondAfter = findMethodBoundary(spliced, 'second');
      expect(secondAfter).toEqual({ name: 'second', startLine: 6, endLine: 8 });
    });
  });
});
