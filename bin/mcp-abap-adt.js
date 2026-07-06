#!/usr/bin/env node

/**
 * MCP ABAP ADT Server Launcher
 *
 * Runs the single-file bundled server (dist/server.bundle.cjs), which is the
 * only runtime artifact shipped in the published npm package.
 *
 * NOTE: Using direct require() instead of spawn() to ensure proper stdio handling.
 * spawn() with stdio: 'inherit' can cause issues with MCP protocol
 * because the parent process becomes an unnecessary intermediate layer.
 */

require('../dist/server.bundle.cjs');
