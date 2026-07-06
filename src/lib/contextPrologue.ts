/**
 * Builds a "compressed dependency prologue" for a class/interface/program
 * source read: scans the source for referenced classes/interfaces/function
 * modules, fetches each dependency's source, compresses it down to its
 * public contract, and assembles a single text block.
 *
 * Never throws — failures for individual dependencies are recorded as
 * skipped entries so the main source read is never affected.
 */

import type { HandlerContext } from '../handlers/interfaces';
import { scanAbapDependencies } from './abapDependencyScan';
import { compressClass, compressInterface } from './abapSignatureCompress';
import { createAdtClient } from './clients';

export const DEFAULT_CONTEXT_MAX_DEPS = 10;
export const MAX_CONTEXT_MAX_DEPS = 15;
const MAX_CONCURRENT_FETCHES = 5;

type DepKind = 'class' | 'interface' | 'fm';

interface DepTask {
  kind: DepKind;
  name: string;
}

type DepResult =
  | { status: 'resolved'; kind: DepKind; name: string; contract: string }
  | { status: 'skipped'; kind: DepKind; name: string; reason: string };

/** Runs `fn` over `items` with at most `limit` in flight at once. Preserves
 * input order in the returned array regardless of completion order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Scans `source` for dependencies and builds the compressed prologue text.
 * Returns an empty string if no dependencies were found.
 */
export async function buildContextPrologue(
  context: HandlerContext,
  source: string,
  maxDeps: number = DEFAULT_CONTEXT_MAX_DEPS,
): Promise<string> {
  const cappedMaxDeps = Math.max(0, Math.min(maxDeps, MAX_CONTEXT_MAX_DEPS));

  const deps = scanAbapDependencies(source);
  const tasks: DepTask[] = [
    ...deps.classes.map((name) => ({ kind: 'class' as const, name })),
    ...deps.interfaces.map((name) => ({ kind: 'interface' as const, name })),
    ...deps.functionModules.map((name) => ({ kind: 'fm' as const, name })),
  ].slice(0, cappedMaxDeps);

  if (tasks.length === 0) {
    return '';
  }

  const { connection, logger } = context;
  const client = createAdtClient(connection, logger);

  const results = await mapWithConcurrency(
    tasks,
    MAX_CONCURRENT_FETCHES,
    async (task): Promise<DepResult> => {
      if (task.kind === 'fm') {
        return {
          status: 'skipped',
          kind: task.kind,
          name: task.name,
          reason:
            'function module — function group required to fetch source, not resolved by static analysis',
        };
      }

      try {
        if (task.kind === 'class') {
          const result = await client
            .getClass()
            .read({ className: task.name }, 'active');
          const rawSource = result?.readResult?.data;
          if (typeof rawSource !== 'string' || !rawSource) {
            throw new Error('empty response');
          }
          return {
            status: 'resolved',
            kind: task.kind,
            name: task.name,
            contract: compressClass(rawSource),
          };
        }

        const result = await client
          .getInterface()
          .read({ interfaceName: task.name }, 'active');
        const rawSource = result?.readResult?.data;
        if (typeof rawSource !== 'string' || !rawSource) {
          throw new Error('empty response');
        }
        return {
          status: 'resolved',
          kind: task.kind,
          name: task.name,
          contract: compressInterface(rawSource),
        };
      } catch (error: any) {
        const status = error?.response?.status;
        const reason =
          status === 404
            ? 'not found'
            : status
              ? `HTTP ${status}`
              : error?.message || 'fetch failed';
        return { status: 'skipped', kind: task.kind, name: task.name, reason };
      }
    },
  );

  const resolved = results.filter(
    (r): r is Extract<DepResult, { status: 'resolved' }> =>
      r.status === 'resolved',
  );
  const skipped = results.filter(
    (r): r is Extract<DepResult, { status: 'skipped' }> =>
      r.status === 'skipped',
  );

  const lines: string[] = [
    '* ===== DEPENDENCY CONTEXT (compressed public contracts) =====',
    `* ${resolved.length} dependencies resolved, ${skipped.length} failed/skipped`,
  ];

  for (const dep of resolved) {
    lines.push(
      '',
      `* ----- ${dep.kind.toUpperCase()}: ${dep.name} -----`,
      dep.contract,
    );
  }

  if (skipped.length > 0) {
    lines.push('', '* ----- SKIPPED -----');
    for (const dep of skipped) {
      lines.push(`* ${dep.name} (${dep.kind}): ${dep.reason}`);
    }
  }

  return lines.join('\n');
}
