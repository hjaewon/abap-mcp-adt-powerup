import {
  MAX_SCAN_DEPENDENCIES,
  scanAbapDependencies,
} from '../../lib/abapDependencyScan';

describe('scanAbapDependencies', () => {
  it('detects INHERITING FROM as a class dependency', () => {
    const source = `
      CLASS zcl_child DEFINITION INHERITING FROM zcl_parent.
        PUBLIC SECTION.
      ENDCLASS.
    `;
    expect(scanAbapDependencies(source).classes).toContain('ZCL_PARENT');
  });

  it('detects INTERFACES as an interface dependency', () => {
    const source = `
      CLASS zcl_foo DEFINITION.
        PUBLIC SECTION.
          INTERFACES if_bar.
      ENDCLASS.
    `;
    expect(scanAbapDependencies(source).interfaces).toContain('IF_BAR');
  });

  it('detects TYPE REF TO as a class or interface dependency', () => {
    const source = `
      DATA lo_obj TYPE REF TO zcl_helper.
      DATA lo_if TYPE REF TO if_something.
    `;
    const result = scanAbapDependencies(source);
    expect(result.classes).toContain('ZCL_HELPER');
    expect(result.interfaces).toContain('IF_SOMETHING');
  });

  it('detects static calls (<name>=>) as a class dependency', () => {
    const source = `zcl_utility=>do_something( ).`;
    expect(scanAbapDependencies(source).classes).toContain('ZCL_UTILITY');
  });

  it('detects CALL FUNCTION literal as a function module dependency', () => {
    const source = `CALL FUNCTION 'Z_MY_FUNCTION_MODULE'
      EXPORTING
        iv_foo = lv_foo.`;
    expect(scanAbapDependencies(source).functionModules).toContain(
      'Z_MY_FUNCTION_MODULE',
    );
  });

  it('detects CAST as a class dependency', () => {
    const source = `lo_result = CAST zcl_result( lo_generic ).`;
    expect(scanAbapDependencies(source).classes).toContain('ZCL_RESULT');
  });

  it('detects NEW as a class dependency', () => {
    const source = `DATA(lo_obj) = NEW zcl_new_thing( ).`;
    expect(scanAbapDependencies(source).classes).toContain('ZCL_NEW_THING');
  });

  it('detects RAISING as a class dependency (exception classes)', () => {
    const source = `METHODS do_stuff RAISING cx_static_error zcx_custom_error.`;
    const result = scanAbapDependencies(source);
    expect(result.classes).toContain('CX_STATIC_ERROR');
    expect(result.classes).toContain('ZCX_CUSTOM_ERROR');
  });

  it('detects TYPE <name> matching class/interface prefix conventions', () => {
    const source = `TYPES ty_ref TYPE if_typed_thing.`;
    expect(scanAbapDependencies(source).interfaces).toContain('IF_TYPED_THING');
  });

  it('ignores names that do not match class/interface prefix conventions', () => {
    const source = `TYPES lv_flag TYPE abap_bool. DATA lv_str TYPE string.`;
    const result = scanAbapDependencies(source);
    expect(result.classes).toHaveLength(0);
    expect(result.interfaces).toHaveLength(0);
  });

  it('excludes the scanned class own name (self-reference)', () => {
    const source = `
      CLASS zcl_self DEFINITION.
        PUBLIC SECTION.
          METHODS create_self RETURNING VALUE(ro_self) TYPE REF TO zcl_self.
      ENDCLASS.

      CLASS zcl_self IMPLEMENTATION.
        METHOD create_self.
          ro_self = NEW zcl_self( ).
        ENDMETHOD.
      ENDCLASS.
    `;
    expect(scanAbapDependencies(source).classes).not.toContain('ZCL_SELF');
  });

  it('excludes the scanned interface own name (self-reference)', () => {
    const source = `
      INTERFACE if_self.
        METHODS foo RETURNING VALUE(ro_self) TYPE REF TO if_self.
      ENDINTERFACE.
    `;
    expect(scanAbapDependencies(source).interfaces).not.toContain('IF_SELF');
  });

  it('ignores full-line * comments', () => {
    const source = `
      * DATA lo_obj TYPE REF TO zcl_should_be_ignored.
      DATA lo_real TYPE REF TO zcl_real_dep.
    `;
    const result = scanAbapDependencies(source);
    expect(result.classes).not.toContain('ZCL_SHOULD_BE_IGNORED');
    expect(result.classes).toContain('ZCL_REAL_DEP');
  });

  it('ignores inline " comments', () => {
    const source = `DATA lo_real TYPE REF TO zcl_real_dep. " TYPE REF TO zcl_should_be_ignored`;
    const result = scanAbapDependencies(source);
    expect(result.classes).not.toContain('ZCL_SHOULD_BE_IGNORED');
    expect(result.classes).toContain('ZCL_REAL_DEP');
  });

  it('dedups repeated references to the same dependency', () => {
    const source = `
      DATA lo_a TYPE REF TO zcl_dup.
      DATA lo_b TYPE REF TO zcl_dup.
      zcl_dup=>static_method( ).
    `;
    const result = scanAbapDependencies(source);
    expect(result.classes.filter((c) => c === 'ZCL_DUP')).toHaveLength(1);
  });

  it('uppercases dependency names regardless of source casing', () => {
    const source = `data lo_obj type ref to zcl_lower_case.`;
    expect(scanAbapDependencies(source).classes).toContain('ZCL_LOWER_CASE');
  });

  it('caps total dependencies at MAX_SCAN_DEPENDENCIES, prioritizing higher-priority patterns', () => {
    // 20 distinct INHERITING FROM-style hints is unrealistic (a class can only
    // inherit from one superclass), so combine a handful of high-priority
    // INTERFACES lines with a larger number of low-priority TYPE <name> hits
    // to prove that priority patterns win the cap.
    const interfaceLines = Array.from(
      { length: 5 },
      (_, i) => `INTERFACES if_high_prio_${i}.`,
    ).join('\n');
    const typeLines = Array.from(
      { length: 20 },
      (_, i) => `TYPES ty_${i} TYPE cl_low_prio_${i}.`,
    ).join('\n');
    const source = `${interfaceLines}\n${typeLines}`;

    const result = scanAbapDependencies(source);
    const total =
      result.classes.length +
      result.interfaces.length +
      result.functionModules.length;

    expect(total).toBeLessThanOrEqual(MAX_SCAN_DEPENDENCIES);
    // All 5 high-priority interfaces must have made the cut.
    for (let i = 0; i < 5; i++) {
      expect(result.interfaces).toContain(`IF_HIGH_PRIO_${i}`);
    }
    // Only the remaining budget (15 - 5 = 10) of low-priority classes survive.
    expect(result.classes).toHaveLength(MAX_SCAN_DEPENDENCIES - 5);
  });
});
