"use strict";
/**
 * Tier-based readonly enforcement for MCP tool calls.
 *
 * This is the server-side layer of the two-layer defense described in
 * docs/architecture: a client-side PreToolUse hook (sc4sap plugin) rejects
 * calls quickly and explains the reason; this guard is the uncircumventable
 * last line of defense that fires even when the hook is missing, disabled,
 * or never installed.
 *
 * Enforcement model (fail-closed, Strict policy — see sc4sap
 * multi-profile-design.md §4): on QA/PRD a tool is allowed only if it is
 * positively classified read-only (READ_PREFIXES / READ_TOOLS) or passes the
 * runtime-execution matrix. Anything unclassified — including future tools —
 * is blocked. A denylist of mutation prefixes proved incomplete in practice:
 * Activate*, Lock*, Unlock*, Patch*, Write* and the compact Handler* mutators
 * (HandlerCreate, HandlerUpdate, …) all bypassed the original
 * Create/Update/Delete check.
 *
 * Block matrix:
 *
 *   Tool family                                       DEV   QA   PRD
 *   Read-only (READ_PREFIXES / READ_TOOLS)             ✓    ✓    ✓
 *   Unit-test execution (UNIT_TEST_EXECUTION_TOOLS)    ✓    ✓    ✗
 *   Other runtime execution (RuntimeRun*, profiling)   ✓    ✗    ✗
 *   Everything else (mutations + unclassified)         ✓    ✗    ✗
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkToolAllowed = checkToolAllowed;
exports.guardTool = guardTool;
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const profile_1 = require("./profile");
/**
 * Name prefixes that are read-only by construction across the whole registry.
 * `Check*` / `Validate*` are ADT check runs (syntax/consistency) — they never
 * persist changes. Runtime reads are covered by their three concrete
 * prefixes; the bare `Runtime` prefix is deliberately NOT listed so that
 * `RuntimeRun*` / `RuntimeCreate*` fall through to the blocked branch.
 */
const READ_PREFIXES = [
    'Get',
    'Read',
    'Search',
    'List',
    'Grep',
    'Describe',
    'Check',
    'Validate',
    'RuntimeAnalyze',
    'RuntimeGet',
    'RuntimeList',
];
/**
 * Exact-name read-only tools that do not match a read prefix — the compact
 * group's dispatcher-style names.
 */
const READ_TOOLS = new Set([
    'HandlerGet',
    'HandlerCheckRun',
    'HandlerValidate',
    'HandlerDumpList',
    'HandlerDumpView',
    'HandlerProfileList',
    'HandlerProfileView',
    'HandlerUnitTestResult',
    'HandlerUnitTestStatus',
    'HandlerCdsUnitTestResult',
    'HandlerCdsUnitTestStatus',
    'HandlerServiceBindingListTypes',
    'HandlerServiceBindingValidate',
]);
/**
 * Tools that execute ABAP unit tests. Test execution is legitimate on QA
 * (that is what QA systems are for) but stays blocked on PRD.
 */
const UNIT_TEST_EXECUTION_TOOLS = new Set([
    'RunUnitTest',
    'RunClassUnitTestsLow',
    'HandlerUnitTestRun',
]);
/**
 * Tools that execute arbitrary ABAP (profiling runs) — blocked on QA and PRD.
 */
const RUNTIME_EXECUTION_TOOLS = new Set([
    'RuntimeRunProgramWithProfiling',
    'RuntimeRunClassWithProfiling',
    'HandlerProfileRun',
]);
function isReadOnly(toolName) {
    return (READ_TOOLS.has(toolName) ||
        READ_PREFIXES.some((p) => toolName.startsWith(p)));
}
/**
 * Returns `null` if the tool is allowed on the given tier, else a short reason
 * string that explains why it is blocked.
 */
function checkToolAllowed(toolName, tier) {
    if (tier === 'DEV')
        return null;
    if (UNIT_TEST_EXECUTION_TOOLS.has(toolName)) {
        if (tier === 'QA')
            return null;
        return `${toolName} executes ABAP code on the server and is blocked on ${tier} profiles.`;
    }
    if (RUNTIME_EXECUTION_TOOLS.has(toolName)) {
        return `${toolName} executes ABAP code on the server and is blocked on ${tier} profiles.`;
    }
    if (isReadOnly(toolName))
        return null;
    // Fail closed: mutations (Create*, Update*, Delete*, Activate*, Lock*, …)
    // and any tool this guard cannot positively classify as read-only.
    return `${toolName} mutates SAP objects (or is not classified read-only); only DEV profiles may run it.`;
}
/**
 * Throws an `McpError` if the named tool is not allowed on the currently
 * active profile's tier. Called by the registration wrapper in
 * BaseHandlerGroup so every tool is guarded from a single chokepoint.
 */
function guardTool(toolName) {
    // `ReloadProfile` must always be allowed — it is how the user escapes the
    // readonly state by switching back to a DEV profile. It does not touch SAP.
    if (toolName === 'ReloadProfile')
        return;
    const tier = (0, profile_1.getActiveTier)();
    const reason = checkToolAllowed(toolName, tier);
    if (!reason)
        return;
    const alias = (0, profile_1.getActiveAlias)() ?? '(legacy)';
    throw new types_js_1.McpError(types_js_1.ErrorCode.MethodNotFound, `ERR_READONLY_TIER: ${reason} Active profile: ${alias} (tier=${tier}). ` +
        'Switch to a DEV profile via sap-option to perform this operation.');
}
//# sourceMappingURL=readonlyGuard.js.map