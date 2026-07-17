import {
  isCalleeFetchableType,
  resolveFuncCalleeTarget,
  resolveNeighborObjectType,
} from '../../handlers/system/readonly/callGraphHelpers';

describe('isCalleeFetchableType', () => {
  it('returns true for every source-fetchable object type', () => {
    for (const t of ['CLAS', 'PROG', 'INTF', 'INCL', 'FUGR', 'FUNC']) {
      expect(isCalleeFetchableType(t)).toBe(true);
    }
  });

  it('returns false for types whose source the callees expander cannot fetch', () => {
    expect(isCalleeFetchableType('OTHER')).toBe(false);
    expect(isCalleeFetchableType('DDLS')).toBe(false);
    expect(isCalleeFetchableType('TABL')).toBe(false);
    expect(isCalleeFetchableType('')).toBe(false);
  });

  it('expects the normalized (uppercase) node code — a lowercase input is not fetchable', () => {
    // Graph node object_type is always stored uppercase (makeNodeId), so the
    // set lookup is intentionally case-sensitive.
    expect(isCalleeFetchableType('clas')).toBe(false);
  });
});

describe('resolveFuncCalleeTarget', () => {
  it('returns null for a non-FUNC node', () => {
    const node = { id: 'CLAS:ZCL_FOO', object_type: 'CLAS', name: 'ZCL_FOO' };
    expect(resolveFuncCalleeTarget(node, new Map())).toBeNull();
  });

  it('returns null for a FUNC node whose group is unknown (the pre-existing FUNC limitation)', () => {
    const node = { id: 'FUNC:Z_MY_FM', object_type: 'FUNC', name: 'Z_MY_FM' };
    expect(resolveFuncCalleeTarget(node, new Map())).toBeNull();
  });

  it('resolves the {module, group} pair when the group is known for the node', () => {
    const node = { id: 'FUNC:Z_MY_FM', object_type: 'FUNC', name: 'Z_MY_FM' };
    const groups = new Map([['FUNC:Z_MY_FM', 'ZFG_MY_GROUP']]);
    expect(resolveFuncCalleeTarget(node, groups)).toEqual({
      functionModuleName: 'Z_MY_FM',
      functionGroupName: 'ZFG_MY_GROUP',
    });
  });

  it('keys the group lookup by node id, not by function-module name', () => {
    // functionGroupOf is populated by node id; an entry keyed by the bare
    // name must not resolve.
    const node = { id: 'FUNC:Z_MY_FM', object_type: 'FUNC', name: 'Z_MY_FM' };
    const groups = new Map([['Z_MY_FM', 'ZFG_MY_GROUP']]);
    expect(resolveFuncCalleeTarget(node, groups)).toBeNull();
  });
});

describe('resolveNeighborObjectType', () => {
  it('normalizes recognized ADT types to the source-fetch code', () => {
    expect(resolveNeighborObjectType('CLAS/OC')).toBe('CLAS');
    expect(resolveNeighborObjectType('FUGR/I')).toBe('INCL');
    expect(resolveNeighborObjectType('FUGR/FF')).toBe('FUNC');
    expect(resolveNeighborObjectType('INTF/IF')).toBe('INTF');
    expect(resolveNeighborObjectType('PROG/I')).toBe('INCL');
  });

  it('falls back to the raw ADT prefix for unsupported types so they stay identifiable, not "OTHER"', () => {
    expect(resolveNeighborObjectType('DDLS/DF')).toBe('DDLS');
    expect(resolveNeighborObjectType('TABL/DT')).toBe('TABL');
    expect(resolveNeighborObjectType('WDYN')).toBe('WDYN');
  });

  it('returns "OTHER" only for an empty type', () => {
    expect(resolveNeighborObjectType('')).toBe('OTHER');
  });
});
