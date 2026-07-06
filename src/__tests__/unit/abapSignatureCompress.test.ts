import {
  compressClass,
  compressFunctionModule,
  compressInterface,
} from '../../lib/abapSignatureCompress';

describe('compressClass', () => {
  const fullClassSource = `
CLASS zcl_example DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC .

  PUBLIC SECTION.
    METHODS do_something
      IMPORTING
        iv_input TYPE string
      RETURNING
        VALUE(rv_result) TYPE string.

    DATA mv_public_attr TYPE string.

  PROTECTED SECTION.
    METHODS protected_helper.
    DATA mv_protected_attr TYPE string.

  PRIVATE SECTION.
    METHODS private_helper.
    DATA mv_private_attr TYPE string.
ENDCLASS.

CLASS zcl_example IMPLEMENTATION.
  METHOD do_something.
    rv_result = iv_input && '_processed'.
  ENDMETHOD.

  METHOD protected_helper.
  ENDMETHOD.

  METHOD private_helper.
  ENDMETHOD.
ENDCLASS.
`;

  it('keeps the DEFINITION header and PUBLIC SECTION content', () => {
    const result = compressClass(fullClassSource);
    expect(result).toContain('CLASS zcl_example DEFINITION');
    expect(result).toContain('PUBLIC SECTION.');
    expect(result).toContain('do_something');
    expect(result).toContain('mv_public_attr');
  });

  it('strips the PROTECTED SECTION', () => {
    const result = compressClass(fullClassSource);
    expect(result).not.toContain('PROTECTED SECTION');
    expect(result).not.toContain('protected_helper');
    expect(result).not.toContain('mv_protected_attr');
  });

  it('strips the PRIVATE SECTION', () => {
    const result = compressClass(fullClassSource);
    expect(result).not.toContain('PRIVATE SECTION');
    expect(result).not.toContain('private_helper');
    expect(result).not.toContain('mv_private_attr');
  });

  it('strips the entire IMPLEMENTATION part', () => {
    const result = compressClass(fullClassSource);
    expect(result).not.toContain('IMPLEMENTATION');
    expect(result).not.toContain("&& '_processed'");
    expect(result).not.toContain('METHOD do_something.');
  });

  it('ends with a single ENDCLASS.', () => {
    const result = compressClass(fullClassSource);
    const matches = result.match(/ENDCLASS\s*\./gi) ?? [];
    expect(matches).toHaveLength(1);
    expect(result.trim().endsWith('ENDCLASS.')).toBe(true);
  });

  it('strips comment-only lines', () => {
    const source = `
CLASS zcl_commented DEFINITION.
  PUBLIC SECTION.
    * this is a comment line
    METHODS foo.
ENDCLASS.
`;
    const result = compressClass(source);
    expect(result).not.toContain('this is a comment line');
    expect(result).toContain('METHODS foo.');
  });

  it('falls back to comment-stripped source when no DEFINITION header is found', () => {
    const source = `* just a comment\nSOME UNRELATED TEXT.`;
    const result = compressClass(source);
    expect(result).toBe('SOME UNRELATED TEXT.');
  });
});

describe('compressInterface', () => {
  it('returns the source unchanged aside from stripped comment lines', () => {
    const source = `
* header comment
INTERFACE if_example
  PUBLIC.
  METHODS foo
    IMPORTING iv_x TYPE i.
ENDINTERFACE.
`;
    const result = compressInterface(source);
    expect(result).not.toContain('header comment');
    expect(result).toContain('INTERFACE if_example');
    expect(result).toContain('METHODS foo');
    expect(result).toContain('ENDINTERFACE.');
  });
});

describe('compressFunctionModule', () => {
  const fmSource = `FUNCTION z_my_function_module.
*"----------------------------------------------------------------------
*"*"Local interface:
*"  IMPORTING
*"     VALUE(IV_FOO) TYPE STRING
*"  EXPORTING
*"     VALUE(EV_BAR) TYPE STRING
*"  EXCEPTIONS
*"     NOT_FOUND
*"----------------------------------------------------------------------

  " actual body starts here
  ev_bar = iv_foo.
  IF ev_bar IS INITIAL.
    RAISE not_found.
  ENDIF.

ENDFUNCTION.
`;

  it('keeps the FUNCTION header and the signature comment block', () => {
    const result = compressFunctionModule(fmSource);
    expect(result).toContain('FUNCTION z_my_function_module.');
    expect(result).toContain('*"  IMPORTING');
    expect(result).toContain('VALUE(IV_FOO) TYPE STRING');
    expect(result).toContain('*"  EXPORTING');
    expect(result).toContain('*"  EXCEPTIONS');
  });

  it('strips the function body', () => {
    const result = compressFunctionModule(fmSource);
    expect(result).not.toContain('ev_bar = iv_foo.');
    expect(result).not.toContain('RAISE not_found.');
  });

  it('ends with ENDFUNCTION.', () => {
    const result = compressFunctionModule(fmSource);
    expect(result.trim().endsWith('ENDFUNCTION.')).toBe(true);
  });

  it('falls back to the original source when FUNCTION/ENDFUNCTION markers are not found', () => {
    const source = 'NOT A FUNCTION MODULE AT ALL.';
    expect(compressFunctionModule(source)).toBe(source);
  });
});
