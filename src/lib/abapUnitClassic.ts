/**
 * Classic (Eclipse ADT) ABAP Unit test-run client.
 *
 * The vendored @babamba2/mcp-abap-adt-clients AdtUnitTest posts to
 * `/sap/bc/adt/abapunit/runs` (and reads back from `/runs/{id}` +
 * `/results/{id}`) — confirmed via `GET /sap/bc/adt/discovery` against a
 * live on-premise S/4HANA 2021 system that no such collection exists.
 * AdtUnitTestLegacy posts to the right URL (`/testruns`) but with a bare
 * `application/xml` body and no `<options>` block, which SAP accepts but
 * silently resolves to zero selected tests (empty `<aunit:runResult/>`).
 *
 * The real, discovery-confirmed endpoint is the classic Eclipse ADT
 * AbapUnit API:
 *
 *   POST /sap/bc/adt/abapunit/testruns
 *   Content-Type: application/vnd.sap.adt.abapunit.testruns.config.v1+xml
 *   <aunit:runConfiguration xmlns:aunit="http://www.sap.com/adt/aunit">...
 *
 * This is synchronous — the full `<aunit:runResult>` comes back on the same
 * POST response; there is no server-side run_id/polling concept. Since
 * RunUnitTest / GetUnitTestStatus / GetUnitTestResult are three separate
 * MCP tool calls, the result is cached here (in-memory, per connection,
 * keyed by a generated run_id) for the life of this server process,
 * bridging the synchronous SAP response into the existing run_id-based
 * tool contract.
 *
 * Object selection is at container-class granularity (one
 * `<adtcore:objectReference>` per unique container class) — the classic
 * wire protocol runs all local test classes of a referenced class; there
 * is no server-side way to sub-select individual local test classes within
 * one container. The full (unfiltered) result is returned so no test data
 * is silently dropped.
 */
import { randomUUID } from 'node:crypto';
import type { IAbapConnection } from '@babamba2/mcp-abap-adt-interfaces';
import { getTimeout } from './utils';

export interface ClassicUnitTestDefinition {
  containerClass: string;
  testClass: string;
}

export interface ClassicUnitTestOptions {
  scope?: {
    ownTests?: boolean;
    foreignTests?: boolean;
    addForeignTestsAsPreview?: boolean;
  };
  riskLevel?: {
    harmless?: boolean;
    dangerous?: boolean;
    critical?: boolean;
  };
  duration?: {
    short?: boolean;
    medium?: boolean;
    long?: boolean;
  };
}

const CT_TESTRUNS_CONFIG_V1 =
  'application/vnd.sap.adt.abapunit.testruns.config.v1+xml';

/**
 * The classic endpoint executes the whole run inside one synchronous POST,
 * so the HTTP timeout must cover full suite execution — getTimeout('default')
 * (45s) and even 'long' (60s default) are sized for single ADT round-trips,
 * not test runs. Use at least 5 minutes, while still honoring a larger
 * SAP_TIMEOUT_LONG env override if the operator raised it.
 */
const SYNC_RUN_MIN_TIMEOUT_MS = 5 * 60 * 1000;

function boolAttr(value: boolean | undefined, fallback: boolean): string {
  return (value ?? fallback) ? 'true' : 'false';
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildRunConfigurationXml(
  tests: ClassicUnitTestDefinition[],
  options?: ClassicUnitTestOptions,
): string {
  const scope = options?.scope;
  const risk = options?.riskLevel;
  const duration = options?.duration;

  // Object selection is per container class (see file header) — dedupe.
  const containerClasses = Array.from(
    new Set(tests.map((t) => t.containerClass.toUpperCase())),
  );

  const objectRefs = containerClasses
    .map((cls) => {
      // encodeURIComponent matches the vendored client's encodeSapObjectName —
      // namespaced objects (/ACME/ZCL_X) need their slashes percent-encoded
      // to stay a single URI segment.
      const uri = `/sap/bc/adt/oo/classes/${encodeURIComponent(cls.toLowerCase())}`;
      return `        <adtcore:objectReference adtcore:uri="${escapeXmlAttr(uri)}"/>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?><aunit:runConfiguration xmlns:aunit="http://www.sap.com/adt/aunit">
  <external>
    <coverage active="false"/>
  </external>
  <options>
    <uriType value="semantic"/>
    <testDeterminationStrategy appendAssignedTestsPreview="${boolAttr(scope?.addForeignTestsAsPreview, true)}" assignedTests="${boolAttr(scope?.foreignTests, false)}" sameProgram="${boolAttr(scope?.ownTests, true)}"/>
    <testRiskLevels harmless="${boolAttr(risk?.harmless, true)}" dangerous="${boolAttr(risk?.dangerous, true)}" critical="${boolAttr(risk?.critical, true)}"/>
    <testDurations short="${boolAttr(duration?.short, true)}" medium="${boolAttr(duration?.medium, true)}" long="${boolAttr(duration?.long, true)}"/>
    <withNavigationUri enabled="true"/>
  </options>
  <adtcore:objectSets xmlns:adtcore="http://www.sap.com/adt/core">
    <objectSet kind="inclusive">
      <adtcore:objectReferences>
${objectRefs}
      </adtcore:objectReferences>
    </objectSet>
  </adtcore:objectSets>
</aunit:runConfiguration>`;
}

/**
 * Executes an ABAP Unit test run via the classic ADT endpoint and returns
 * the raw `<aunit:runResult>` XML synchronously. Throws when the server
 * responds with something that is not a runResult document (e.g. an HTML
 * error page slipped through with HTTP 200).
 */
export async function runClassicUnitTest(
  connection: IAbapConnection,
  tests: ClassicUnitTestDefinition[],
  options?: ClassicUnitTestOptions,
): Promise<string> {
  if (!tests.length) {
    throw new Error('At least one test definition is required');
  }
  const xml = buildRunConfigurationXml(tests, options);
  const response = await connection.makeAdtRequest({
    url: '/sap/bc/adt/abapunit/testruns',
    method: 'POST',
    timeout: Math.max(getTimeout('long'), SYNC_RUN_MIN_TIMEOUT_MS),
    data: xml,
    headers: { 'Content-Type': CT_TESTRUNS_CONFIG_V1 },
  });
  const body = String(response.data);
  // Namespace-prefix-agnostic root check ("<aunit:runResult ...>" normally).
  if (!/<(?:[\w.-]+:)?runResult[\s/>]/.test(body)) {
    throw new Error(
      `ABAP Unit run returned an unexpected response (HTTP ${response.status}, no runResult root). First 300 chars: ${body.slice(0, 300)}`,
    );
  }
  return body;
}

// ---------------------------------------------------------------------------
// In-memory run-result store bridging the synchronous SAP response into the
// RunUnitTest / GetUnitTestStatus / GetUnitTestResult run_id contract.
// Keyed by connection so that in multi-client transports (http/sse) one
// session cannot read another session's results; in stdio mode there is a
// single cached connection, so behavior is unchanged.
// ---------------------------------------------------------------------------

interface CachedRun {
  resultXml: string;
  createdAt: number;
}

const MAX_CACHED_RUNS = 200;
const RUN_TTL_MS = 30 * 60 * 1000; // 30 minutes

const runStores = new WeakMap<IAbapConnection, Map<string, CachedRun>>();

function isExpired(run: CachedRun): boolean {
  return run.createdAt < Date.now() - RUN_TTL_MS;
}

function evictStaleRuns(runStore: Map<string, CachedRun>): void {
  for (const [id, run] of runStore) {
    if (isExpired(run)) runStore.delete(id);
  }
  // Map iterates in insertion order, so the first keys are the oldest.
  while (runStore.size >= MAX_CACHED_RUNS) {
    const oldest = runStore.keys().next().value;
    if (oldest === undefined) break;
    runStore.delete(oldest);
  }
}

/** Caches a completed run's result XML and returns a generated run_id. */
export function storeUnitTestRun(
  connection: IAbapConnection,
  resultXml: string,
): string {
  let runStore = runStores.get(connection);
  if (!runStore) {
    runStore = new Map();
    runStores.set(connection, runStore);
  }
  evictStaleRuns(runStore);
  const runId = randomUUID();
  runStore.set(runId, { resultXml, createdAt: Date.now() });
  return runId;
}

/** Looks up a previously-cached run's result XML by run_id. */
export function getUnitTestRun(
  connection: IAbapConnection,
  runId: string,
): string | undefined {
  const runStore = runStores.get(connection);
  const run = runStore?.get(runId);
  if (!run) return undefined;
  if (isExpired(run)) {
    runStore?.delete(runId);
    return undefined;
  }
  return run.resultXml;
}
