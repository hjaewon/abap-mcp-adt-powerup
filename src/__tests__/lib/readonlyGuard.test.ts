/**
 * Unit tests for src/lib/readonlyGuard.ts
 *
 * Exercises the block matrix via `checkToolAllowed` (pure) and the throwing
 * `guardTool` bound to the module-level active tier state.
 */

describe('readonlyGuard — checkToolAllowed (pure matrix)', () => {
  const { checkToolAllowed } = require('../../lib/readonlyGuard');

  const mutations = [
    'CreateClass',
    'CreateTransport',
    'CreateProgram',
    'UpdateClass',
    'UpdateFunctionModule',
    'DeleteTable',
    'DeleteStructure',
    // Non-CUD mutators that bypassed the original prefix denylist:
    'ActivateObjects',
    'ActivateClassLow',
    'LockClassLow',
    'UnlockTableLow',
    'PatchGuiStatus',
    'WriteTextElementsBulk',
    // Compact-group dispatcher mutators:
    'HandlerCreate',
    'HandlerUpdate',
    'HandlerDelete',
    'HandlerActivate',
    'HandlerLock',
    'HandlerUnlock',
    'HandlerTransportCreate',
    // Fail-closed: a future/unknown tool must be blocked, not allowed:
    'SomeFutureMutator',
    'RuntimeCreateProfilerTraceParameters',
  ];
  const runtimeExec = [
    'RuntimeRunProgramWithProfiling',
    'RuntimeRunClassWithProfiling',
    'HandlerProfileRun',
  ];
  const unitTestExec = [
    'RunUnitTest',
    'RunClassUnitTestsLow',
    'HandlerUnitTestRun',
  ];
  const reads = [
    'GetClass',
    'GetCallGraph',
    'ReadProgram',
    'SearchObject',
    'GetSqlQuery',
    'GrepObjects',
    'GrepPackages',
    'DescribeByList',
    'CheckSyntax',
    'RuntimeAnalyzeDump',
    'RuntimeListDumps',
    'RuntimeGetDumpById',
    'ValidateServiceBinding',
    // Compact-group dispatcher reads:
    'HandlerGet',
    'HandlerCheckRun',
    'HandlerDumpList',
    'HandlerProfileView',
    'HandlerCdsUnitTestStatus',
  ];

  it('DEV tier allows everything', () => {
    for (const t of [...mutations, ...runtimeExec, ...unitTestExec, ...reads]) {
      expect(checkToolAllowed(t, 'DEV')).toBeNull();
    }
  });

  it('QA tier blocks mutations', () => {
    for (const t of mutations) {
      expect(checkToolAllowed(t, 'QA')).toMatch(/mutates/);
    }
  });

  it('QA tier blocks runtime program/class execution', () => {
    for (const t of runtimeExec) {
      expect(checkToolAllowed(t, 'QA')).toMatch(/executes ABAP code/);
    }
  });

  it('QA tier allows unit-test execution', () => {
    for (const t of unitTestExec) {
      expect(checkToolAllowed(t, 'QA')).toBeNull();
    }
  });

  it('QA tier allows reads and dump/profile analysis', () => {
    for (const t of reads) {
      expect(checkToolAllowed(t, 'QA')).toBeNull();
    }
  });

  it('PRD tier blocks mutations', () => {
    for (const t of mutations) {
      expect(checkToolAllowed(t, 'PRD')).toMatch(/mutates/);
    }
  });

  it('PRD tier blocks unit-test execution (no QA allowlist applies)', () => {
    for (const t of unitTestExec) {
      expect(checkToolAllowed(t, 'PRD')).toMatch(/executes ABAP/);
    }
  });

  it('PRD tier blocks runtime execution tools', () => {
    for (const t of runtimeExec) {
      expect(checkToolAllowed(t, 'PRD')).toMatch(/executes ABAP code/);
    }
  });

  it('PRD tier allows reads', () => {
    for (const t of reads) {
      expect(checkToolAllowed(t, 'PRD')).toBeNull();
    }
  });
});

describe('readonlyGuard — guardTool (uses active profile state)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('does not throw on DEV tier', () => {
    const { applyProfile, __resetProfileState } = require('../../lib/profile');
    __resetProfileState();
    applyProfile({
      alias: 'HK-DEV',
      sourcePath: '/dev/null',
      envVars: { SAP_TIER: 'DEV' },
      tier: 'DEV',
      readonly: false,
      legacy: false,
    });
    const { guardTool } = require('../../lib/readonlyGuard');
    expect(() => guardTool('UpdateClass')).not.toThrow();
    expect(() => guardTool('CreateTransport')).not.toThrow();
  });

  it('throws McpError on PRD mutation with tier-aware message', () => {
    const { applyProfile, __resetProfileState } = require('../../lib/profile');
    __resetProfileState();
    applyProfile({
      alias: 'HK-PRD',
      sourcePath: '/dev/null',
      envVars: { SAP_TIER: 'PRD' },
      tier: 'PRD',
      readonly: true,
      legacy: false,
    });
    const { guardTool } = require('../../lib/readonlyGuard');
    expect(() => guardTool('UpdateClass')).toThrow(
      /ERR_READONLY_TIER.*HK-PRD.*tier=PRD/s,
    );
  });

  it('throws on QA runtime execution but allows RunUnitTest', () => {
    const { applyProfile, __resetProfileState } = require('../../lib/profile');
    __resetProfileState();
    applyProfile({
      alias: 'HK-QA',
      sourcePath: '/dev/null',
      envVars: { SAP_TIER: 'QA' },
      tier: 'QA',
      readonly: true,
      legacy: false,
    });
    const { guardTool } = require('../../lib/readonlyGuard');
    expect(() => guardTool('RuntimeRunProgramWithProfiling')).toThrow(
      /ERR_READONLY_TIER/,
    );
    expect(() => guardTool('RunUnitTest')).not.toThrow();
  });

  it('always allows ReloadProfile regardless of tier', () => {
    const { applyProfile, __resetProfileState } = require('../../lib/profile');
    __resetProfileState();
    applyProfile({
      alias: 'HK-PRD',
      sourcePath: '/dev/null',
      envVars: { SAP_TIER: 'PRD' },
      tier: 'PRD',
      readonly: true,
      legacy: false,
    });
    const { guardTool } = require('../../lib/readonlyGuard');
    expect(() => guardTool('ReloadProfile')).not.toThrow();
  });

  it('emits legacy marker when no alias is set', () => {
    const { applyProfile, __resetProfileState } = require('../../lib/profile');
    __resetProfileState();
    applyProfile({
      alias: undefined,
      sourcePath: '/dev/null',
      envVars: { SAP_TIER: 'PRD' },
      tier: 'PRD',
      readonly: true,
      legacy: true,
    });
    const { guardTool } = require('../../lib/readonlyGuard');
    expect(() => guardTool('CreateClass')).toThrow(/\(legacy\)/);
  });
});
