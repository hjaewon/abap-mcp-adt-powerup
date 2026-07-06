"use strict";
/**
 * Pure ABAP dependency scanner.
 *
 * Scans ABAP source text for references to other classes, interfaces, and
 * function modules using lightweight regex heuristics (no ABAP parser).
 * Used to build a "compressed dependency prologue" for source reads — see
 * contextPrologue.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SCAN_DEPENDENCIES = void 0;
exports.scanAbapDependencies = scanAbapDependencies;
/** Max number of dependencies returned across all kinds combined. */
exports.MAX_SCAN_DEPENDENCIES = 15;
const CLASS_PREFIX_RE = /^(ZCX_|CX_|ZCL_|YCL_|CL_)/;
const INTERFACE_PREFIX_RE = /^(ZIF_|YIF_|IF_)/;
/** Strips full-line `*` comments and inline `"` comments. */
function stripComments(source) {
    return source
        .split(/\r?\n/)
        .map((line) => {
        if (line.trimStart().startsWith('*'))
            return '';
        const idx = line.indexOf('"');
        return idx === -1 ? line : line.slice(0, idx);
    })
        .join('\n');
}
/**
 * Detects the scanned object's own name from a CLASS/INTERFACE header, so
 * self-references (e.g. recursive static calls) are excluded from results.
 */
function detectOwnName(source) {
    const classMatch = source.match(/^\s*CLASS\s+(\w+)\s+(DEFINITION|IMPLEMENTATION)\b/im);
    if (classMatch)
        return classMatch[1].toUpperCase();
    const interfaceMatch = source.match(/^\s*INTERFACE\s+(\w+)\b/im);
    if (interfaceMatch)
        return interfaceMatch[1].toUpperCase();
    return '';
}
/**
 * Scans `source` for referenced classes, interfaces, and function modules.
 * Results are deduped, uppercased, and capped at MAX_SCAN_DEPENDENCIES total
 * (prioritizing INHERITING FROM > INTERFACES > TYPE REF TO > static calls >
 * CALL FUNCTION > other patterns).
 */
function scanAbapDependencies(source) {
    const cleaned = stripComments(source);
    const ownName = detectOwnName(cleaned);
    const candidates = [];
    const seen = new Set();
    function pushCandidate(rawName, kind, priority) {
        const name = rawName.toUpperCase();
        if (!name || name === ownName)
            return;
        const key = `${kind}:${name}`;
        if (seen.has(key))
            return;
        seen.add(key);
        candidates.push({ name, kind, priority });
    }
    /** Classifies a type-like name as class or interface (dropped if neither). */
    function pushTypeCandidate(rawName, priority) {
        const name = rawName.toUpperCase();
        if (INTERFACE_PREFIX_RE.test(name)) {
            pushCandidate(name, 'interface', priority);
        }
        else if (CLASS_PREFIX_RE.test(name)) {
            pushCandidate(name, 'class', priority);
        }
    }
    // Priority 1: INHERITING FROM <name>
    for (const m of cleaned.matchAll(/INHERITING\s+FROM\s+(\w+)/gi)) {
        pushTypeCandidate(m[1], 1);
    }
    // Priority 2: INTERFACES <name>
    for (const m of cleaned.matchAll(/\bINTERFACES\s+(\w+)/gi)) {
        pushTypeCandidate(m[1], 2);
    }
    // Priority 3: TYPE REF TO <name>
    for (const m of cleaned.matchAll(/TYPE\s+REF\s+TO\s+(\w+)/gi)) {
        pushTypeCandidate(m[1], 3);
    }
    // Priority 4: static call <name>=>
    for (const m of cleaned.matchAll(/\b(\w+)=>/g)) {
        pushTypeCandidate(m[1], 4);
    }
    // Priority 5: CALL FUNCTION 'NAME'
    for (const m of cleaned.matchAll(/CALL\s+FUNCTION\s+'([^']+)'/gi)) {
        pushCandidate(m[1], 'fm', 5);
    }
    // Priority 6 ("others"): NEW <name>(, CAST <name>(, RAISING <name...>, TYPE <name>
    for (const m of cleaned.matchAll(/\bNEW\s+(\w+)\s*\(/gi)) {
        pushTypeCandidate(m[1], 6);
    }
    for (const m of cleaned.matchAll(/\bCAST\s+(\w+)\s*\(/gi)) {
        pushTypeCandidate(m[1], 6);
    }
    for (const m of cleaned.matchAll(/\bRAISING\s+((?:\w+\s*)+)/gi)) {
        for (const word of m[1].trim().split(/\s+/)) {
            pushTypeCandidate(word, 6);
        }
    }
    for (const m of cleaned.matchAll(/\bTYPE\s+(\w+)\b/gi)) {
        pushTypeCandidate(m[1], 6);
    }
    candidates.sort((a, b) => a.priority - b.priority);
    const capped = candidates.slice(0, exports.MAX_SCAN_DEPENDENCIES);
    return {
        classes: capped.filter((c) => c.kind === 'class').map((c) => c.name),
        interfaces: capped.filter((c) => c.kind === 'interface').map((c) => c.name),
        functionModules: capped.filter((c) => c.kind === 'fm').map((c) => c.name),
    };
}
//# sourceMappingURL=abapDependencyScan.js.map