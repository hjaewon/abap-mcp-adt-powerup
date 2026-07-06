import {
  type CallGraphNeighbor,
  type CallGraphNode,
  combineDirectionExpanders,
  type ExpandResult,
  isCustomObject,
  makeNodeId,
  type NodeExpander,
  runCallGraphBfs,
} from '../../lib/callGraph';

/** Builds a mock expander from a lookup table keyed by node id. Records every call. */
function mockExpander(
  table: Record<string, ExpandResult>,
  calls: string[] = [],
): NodeExpander {
  return async (node: CallGraphNode) => {
    calls.push(node.id);
    return table[node.id] ?? { neighbors: [], expandable: false };
  };
}

function neighbor(
  objectType: string,
  name: string,
  role: 'caller' | 'callee' = 'callee',
): CallGraphNeighbor {
  return { object_type: objectType, name, role };
}

describe('isCustomObject', () => {
  it('matches Z-prefixed names', () => {
    expect(isCustomObject('ZCL_FOO')).toBe(true);
  });
  it('matches Y-prefixed names', () => {
    expect(isCustomObject('Y_TABLE')).toBe(true);
  });
  it('matches namespaced names', () => {
    expect(isCustomObject('/ACME/CL_FOO')).toBe(true);
  });
  it('does not match standard SAP names', () => {
    expect(isCustomObject('CL_STANDARD')).toBe(false);
  });
});

describe('makeNodeId', () => {
  it('uppercases and joins type:name', () => {
    expect(makeNodeId('clas', 'zcl_foo')).toBe('CLAS:ZCL_FOO');
  });
});

describe('runCallGraphBfs', () => {
  it('clamps a linear chain at the configured depth', async () => {
    // A -> B -> C -> D -> E ; depth=2 should surface A, B, C only (C left unexpanded).
    const table: Record<string, ExpandResult> = {
      'CLAS:A': { neighbors: [neighbor('CLAS', 'B')], expandable: true },
      'CLAS:B': { neighbors: [neighbor('CLAS', 'C')], expandable: true },
      'CLAS:C': { neighbors: [neighbor('CLAS', 'D')], expandable: true },
      'CLAS:D': { neighbors: [neighbor('CLAS', 'E')], expandable: true },
    };
    const calls: string[] = [];
    const result = await runCallGraphBfs(
      { object_type: 'CLAS', name: 'A' },
      mockExpander(table, calls),
      { maxDepth: 2, maxNodes: 100 },
    );

    expect(result.nodes.map((n) => n.id).sort()).toEqual([
      'CLAS:A',
      'CLAS:B',
      'CLAS:C',
    ]);
    expect(calls.sort()).toEqual(['CLAS:A', 'CLAS:B']);
    expect(result.truncated).toBe(false);
  });

  it('visits a shared node only once in a diamond shape', async () => {
    // A -> B, A -> C ; B -> D, C -> D
    const table: Record<string, ExpandResult> = {
      'CLAS:A': {
        neighbors: [neighbor('CLAS', 'B'), neighbor('CLAS', 'C')],
        expandable: true,
      },
      'CLAS:B': { neighbors: [neighbor('CLAS', 'D')], expandable: true },
      'CLAS:C': { neighbors: [neighbor('CLAS', 'D')], expandable: true },
      'CLAS:D': { neighbors: [], expandable: true },
    };
    const calls: string[] = [];
    const result = await runCallGraphBfs(
      { object_type: 'CLAS', name: 'A' },
      mockExpander(table, calls),
      { maxDepth: 4, maxNodes: 100 },
    );

    expect(result.nodes).toHaveLength(4);
    expect(calls.filter((id) => id === 'CLAS:D')).toHaveLength(1);
    const dEdges = result.edges.filter((e) => e.to === 'CLAS:D');
    expect(dEdges).toHaveLength(2);
  });

  it('terminates on a cycle (A -> B -> A)', async () => {
    const table: Record<string, ExpandResult> = {
      'CLAS:A': { neighbors: [neighbor('CLAS', 'B')], expandable: true },
      'CLAS:B': { neighbors: [neighbor('CLAS', 'A')], expandable: true },
    };
    const result = await runCallGraphBfs(
      { object_type: 'CLAS', name: 'A' },
      mockExpander(table),
      { maxDepth: 4, maxNodes: 100 },
    );

    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toContainEqual({
      from: 'CLAS:A',
      to: 'CLAS:B',
      kind: 'calls',
    });
    expect(result.edges).toContainEqual({
      from: 'CLAS:B',
      to: 'CLAS:A',
      kind: 'calls',
    });
  });

  it('truncates and stops expansion once max_nodes is reached', async () => {
    const table: Record<string, ExpandResult> = {
      'CLAS:A': {
        neighbors: [
          neighbor('CLAS', 'C1'),
          neighbor('CLAS', 'C2'),
          neighbor('CLAS', 'C3'),
          neighbor('CLAS', 'C4'),
        ],
        expandable: true,
      },
      'CLAS:C1': { neighbors: [], expandable: true },
      'CLAS:C2': { neighbors: [], expandable: true },
    };
    const calls: string[] = [];
    const result = await runCallGraphBfs(
      { object_type: 'CLAS', name: 'A' },
      mockExpander(table, calls),
      { maxDepth: 4, maxNodes: 3 },
    );

    expect(result.truncated).toBe(true);
    expect(result.nodes).toHaveLength(3); // A + 2 children only
    expect(result.stats.expanded).toBe(1); // C1/C2 never got expanded — cap hit first
    expect(calls).toEqual(['CLAS:A']);
  });

  it('leaves a gated node as an unexpanded leaf without treating it as a failure', async () => {
    // Emulates custom_only: the expander itself decides ZCL_ROOT expands, but
    // the standard object it discovers reports expandable:false.
    const table: Record<string, ExpandResult> = {
      'CLAS:ZCL_ROOT': {
        neighbors: [neighbor('CLAS', 'CL_STANDARD')],
        expandable: true,
      },
      'CLAS:CL_STANDARD': { neighbors: [], expandable: false },
    };
    const result = await runCallGraphBfs(
      { object_type: 'CLAS', name: 'ZCL_ROOT' },
      mockExpander(table),
      { maxDepth: 4, maxNodes: 100 },
    );

    const leaf = result.nodes.find((n) => n.id === 'CLAS:CL_STANDARD');
    expect(leaf?.expandable).toBe(false);
    expect(result.nodes).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it('records an expander failure in skipped instead of throwing', async () => {
    const expander: NodeExpander = async () => {
      throw new Error('boom');
    };
    const result = await runCallGraphBfs(
      { object_type: 'CLAS', name: 'A' },
      expander,
      { maxDepth: 2, maxNodes: 100 },
    );

    expect(result.skipped).toEqual([{ node: 'CLAS:A', reason: 'boom' }]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].expandable).toBe(false);
    expect(result.stats.skipped_count).toBe(1);
  });
});

describe('combineDirectionExpanders', () => {
  it('merges callers and callees from the root with correct edge kinds, and keeps each subtree in its own direction', async () => {
    const rootId = 'CLAS:X';
    const callersCalls: string[] = [];
    const calleesCalls: string[] = [];

    const callersExpander = mockExpander(
      {
        'CLAS:X': {
          neighbors: [neighbor('CLAS', 'CALLER1', 'caller')],
          expandable: true,
        },
        'CLAS:CALLER1': { neighbors: [], expandable: true },
      },
      callersCalls,
    );
    const calleesExpander = mockExpander(
      {
        'CLAS:X': {
          neighbors: [neighbor('CLAS', 'CALLEE1', 'callee')],
          expandable: true,
        },
        'CLAS:CALLEE1': { neighbors: [], expandable: true },
      },
      calleesCalls,
    );

    const combined = combineDirectionExpanders(
      rootId,
      callersExpander,
      calleesExpander,
    );

    const result = await runCallGraphBfs(
      { object_type: 'CLAS', name: 'X' },
      combined,
      { maxDepth: 4, maxNodes: 100 },
    );

    expect(result.edges).toContainEqual({
      from: 'CLAS:CALLER1',
      to: 'CLAS:X',
      kind: 'used_by',
    });
    expect(result.edges).toContainEqual({
      from: 'CLAS:X',
      to: 'CLAS:CALLEE1',
      kind: 'calls',
    });

    // Root queried via both expanders; CALLER1 only via callers, CALLEE1 only via callees.
    expect(callersCalls).toEqual(['CLAS:X', 'CLAS:CALLER1']);
    expect(calleesCalls).toEqual(['CLAS:X', 'CLAS:CALLEE1']);
  });
});
