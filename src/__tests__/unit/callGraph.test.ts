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
      discovered_via: 'source_scan',
    });
    expect(result.edges).toContainEqual({
      from: 'CLAS:B',
      to: 'CLAS:A',
      kind: 'calls',
      discovered_via: 'source_scan',
    });
  });

  it('stops adding new nodes once max_nodes is reached, but keeps expanding the rest of the frontier so edges between already-known nodes are not lost', async () => {
    // A -> C1, C2, C3, C4 (max_nodes=3 admits A, C1, C2 only; C3/C4 dropped).
    // C1 -> C2 is an edge between two nodes that both survived the cap — it
    // must still be emitted even though the cap was already hit while
    // expanding A. Previously `if (truncated) return;` aborted C1/C2's own
    // expansion entirely once the cap tripped, losing this edge and never
    // even calling the expander for them.
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
      'CLAS:C1': { neighbors: [neighbor('CLAS', 'C2')], expandable: true },
      'CLAS:C2': { neighbors: [], expandable: true },
    };
    const calls: string[] = [];
    const result = await runCallGraphBfs(
      { object_type: 'CLAS', name: 'A' },
      mockExpander(table, calls),
      { maxDepth: 4, maxNodes: 3 },
    );

    expect(result.truncated).toBe(true);
    expect(result.nodes).toHaveLength(3); // A, C1, C2 only — C3/C4 dropped by the cap
    expect(result.nodes.map((n) => n.id).sort()).toEqual([
      'CLAS:A',
      'CLAS:C1',
      'CLAS:C2',
    ]);
    // C1 and C2 still get expanded at the next level despite the cap.
    expect(calls.sort()).toEqual(['CLAS:A', 'CLAS:C1', 'CLAS:C2']);
    expect(result.stats.expanded).toBe(3);
    // The edge between two already-existing nodes survives the cap.
    expect(result.edges).toContainEqual({
      from: 'CLAS:C1',
      to: 'CLAS:C2',
      kind: 'calls',
      discovered_via: 'source_scan',
    });
    // C3 and C4 were each proposed as a new node once and dropped.
    expect(result.stats.unexpanded_due_to_cap).toBe(2);
  });

  it('leaves a gated node as an unexpanded leaf without treating it as a failure, and does not count it as expanded', async () => {
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
    // Only ZCL_ROOT did real expansion work; CL_STANDARD's gate (returning
    // expandable:false without throwing) must not inflate `expanded`.
    expect(result.stats.expanded).toBe(1);
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
      kind: 'calls',
      discovered_via: 'where_used',
    });
    expect(result.edges).toContainEqual({
      from: 'CLAS:X',
      to: 'CLAS:CALLEE1',
      kind: 'calls',
      discovered_via: 'source_scan',
    });

    // Root queried via both expanders; CALLER1 only via callers, CALLEE1 only via callees.
    expect(callersCalls).toEqual(['CLAS:X', 'CLAS:CALLER1']);
    expect(calleesCalls).toEqual(['CLAS:X', 'CLAS:CALLEE1']);
  });

  it('keeps the surviving direction neighbors and records the failure when one direction throws', async () => {
    const rootId = 'CLAS:X';
    const callersExpander: NodeExpander = async () => ({
      neighbors: [neighbor('CLAS', 'CALLER1', 'caller')],
      expandable: true,
    });
    const calleesExpander: NodeExpander = async () => {
      throw new Error('callees boom');
    };

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

    // The callers direction's neighbor is still present...
    expect(result.nodes.map((n) => n.id).sort()).toEqual([
      'CLAS:CALLER1',
      'CLAS:X',
    ]);
    expect(result.edges).toContainEqual({
      from: 'CLAS:CALLER1',
      to: 'CLAS:X',
      kind: 'calls',
      discovered_via: 'where_used',
    });
    // ...the root is still marked expandable (callers direction succeeded)...
    const root = result.nodes.find((n) => n.id === rootId);
    expect(root?.expandable).toBe(true);
    // ...and the callees-direction failure is recorded, not silently dropped.
    expect(result.skipped).toEqual([
      { node: rootId, reason: expect.stringContaining('callees boom') },
    ]);
  });

  it('gives up on the node only when BOTH directions throw', async () => {
    const rootId = 'CLAS:X';
    const callersExpander: NodeExpander = async () => {
      throw new Error('callers boom');
    };
    const calleesExpander: NodeExpander = async () => {
      throw new Error('callees boom');
    };

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

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].expandable).toBe(false);
    expect(result.skipped).toEqual([
      { node: rootId, reason: expect.stringContaining('callers boom') },
    ]);
  });
});
