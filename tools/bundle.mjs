#!/usr/bin/env node
/**
 * Build the single-file server bundle (dist/server.bundle.cjs).
 *
 * Replaces the former inline `esbuild` CLI npm script so the engine version
 * can be stamped into the bundle at build time (define: __ENGINE_VERSION__).
 * Without the stamp, `--version` walks up to the nearest package.json — and
 * when the bundle is embedded in another package (sc4sap ships it under
 * <plugin>/engine/), that walk finds the *host* package.json and reports the
 * wrong version.
 */

import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

await build({
  entryPoints: ['dist/server/launcher.js'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/server.bundle.cjs',
  external: ['node-rfc', '@napi-rs/keyring', 'pino', 'pino-pretty'],
  logLevel: 'warning',
  define: { __ENGINE_VERSION__: JSON.stringify(pkg.version) },
});

console.log(`bundled dist/server.bundle.cjs (${pkg.name}@${pkg.version})`);
