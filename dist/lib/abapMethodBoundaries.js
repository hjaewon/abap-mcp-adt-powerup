"use strict";
/**
 * Line-based ABAP METHOD ... ENDMETHOD boundary detection.
 *
 * Pragmatic, not a full ABAP parser. Used to locate a single method
 * implementation inside a full class source so callers can read/replace
 * just that method instead of the whole class.
 *
 * Comment/string heuristics (per line, ABAP string literals cannot span
 * lines so this is safe):
 * - A line whose first non-blank character is `*` is a full-line comment.
 * - `"` starts an inline comment, unless it appears inside a string literal.
 * - String literals are delimited by `'`; `''` inside a literal is an
 *   escaped single quote.
 *
 * The METHOD statement itself is only recognized by its opening line —
 * `METHOD <name>` optionally followed by additions (e.g. AMDP's
 * `BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT USING ...`) which may
 * span multiple lines up to the statement-ending period. Those additions are
 * never parsed; the boundary simply starts at the `METHOD` line and ends at
 * the next matching `ENDMETHOD.`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMethodImplementations = listMethodImplementations;
exports.findMethodBoundary = findMethodBoundary;
exports.extractMethodSource = extractMethodSource;
exports.validateMethodBlock = validateMethodBlock;
exports.spliceMethodSource = spliceMethodSource;
/** Identifier: letters/digits/underscore, must start with a letter or underscore. */
const NAME_SEGMENT = '[A-Za-z_][A-Za-z0-9_]*';
/** Method name: optional leading `/NAMESPACE/` segment, then an identifier,
 * then an optional `~identifier` (interface method implementation) suffix. */
const METHOD_NAME_SOURCE = `(?:/${NAME_SEGMENT}/)?${NAME_SEGMENT}(?:~${NAME_SEGMENT})?`;
const METHOD_START_RE = new RegExp(`^METHOD\\s+(${METHOD_NAME_SOURCE})(?=[\\s.]|$)`, 'i');
const METHOD_END_RE = /^ENDMETHOD\s*\.\s*$/i;
function splitLines(source) {
    return source.split(/\r\n|\r|\n/);
}
function isFullLineComment(line) {
    const match = line.match(/\S/);
    return match !== null && match[0] === '*';
}
/**
 * Masks string-literal content and strips a trailing inline comment from a
 * single line, so keyword matching never accidentally fires on text that
 * appears inside a comment or a string literal.
 */
function codeOnlyPortion(line) {
    let result = '';
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inString) {
            if (ch === "'") {
                if (line[i + 1] === "'") {
                    result += '  ';
                    i++;
                }
                else {
                    inString = false;
                    result += ' ';
                }
            }
            else {
                result += ' ';
            }
            continue;
        }
        if (ch === "'") {
            inString = true;
            result += ' ';
            continue;
        }
        if (ch === '"') {
            break; // Rest of the line is an inline comment.
        }
        result += ch;
    }
    return result;
}
function codeOnly(line) {
    if (isFullLineComment(line))
        return '';
    return codeOnlyPortion(line);
}
/**
 * Lists every METHOD...ENDMETHOD implementation block found in a full class
 * (or include) source. Malformed/unterminated blocks are skipped.
 */
function listMethodImplementations(source) {
    const lines = splitLines(source);
    const results = [];
    let current = null;
    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const code = codeOnly(lines[i]).trim();
        if (!code)
            continue;
        if (!current) {
            const startMatch = code.match(METHOD_START_RE);
            if (startMatch) {
                current = { name: startMatch[1], startLine: lineNo };
            }
            continue;
        }
        if (METHOD_END_RE.test(code)) {
            results.push({
                name: current.name,
                startLine: current.startLine,
                endLine: lineNo,
            });
            current = null;
        }
        // A nested METHOD line here would indicate malformed source (ABAP does
        // not allow nested method implementations); it is ignored defensively
        // rather than throwing, since this is a pragmatic line-based scan.
    }
    return results;
}
/**
 * Finds the boundary of a single named method implementation.
 * Method name matching is case-insensitive.
 */
function findMethodBoundary(source, methodName) {
    const target = methodName.trim().toLowerCase();
    const found = listMethodImplementations(source).find((m) => m.name.toLowerCase() === target);
    return found ?? null;
}
/**
 * Extracts the exact source lines (inclusive) for a given method boundary.
 */
function extractMethodSource(source, boundary) {
    const lines = splitLines(source);
    return lines.slice(boundary.startLine - 1, boundary.endLine).join('\n');
}
/**
 * Validates that a replacement method block itself starts with a METHOD
 * statement and ends with ENDMETHOD, tolerating leading/trailing blank
 * lines, and that the declared method name matches the expected one
 * (case-insensitive).
 */
function validateMethodBlock(source, expectedMethodName) {
    const lines = splitLines(source);
    let startIdx = 0;
    while (startIdx < lines.length && lines[startIdx].trim() === '') {
        startIdx++;
    }
    let endIdx = lines.length - 1;
    while (endIdx >= 0 && lines[endIdx].trim() === '') {
        endIdx--;
    }
    if (startIdx > endIdx) {
        return { valid: false, error: 'source is empty' };
    }
    const startCode = codeOnly(lines[startIdx]).trim();
    const startMatch = startCode.match(METHOD_START_RE);
    if (!startMatch) {
        return {
            valid: false,
            error: `source must start with "METHOD <name>." (found: "${lines[startIdx].trim()}")`,
        };
    }
    const endCode = codeOnly(lines[endIdx]).trim();
    if (!METHOD_END_RE.test(endCode)) {
        return {
            valid: false,
            error: `source must end with "ENDMETHOD." (found: "${lines[endIdx].trim()}")`,
        };
    }
    const name = startMatch[1];
    if (name.toLowerCase() !== expectedMethodName.trim().toLowerCase()) {
        return {
            valid: false,
            name,
            error: `method name mismatch: source declares "${name}" but method_name is "${expectedMethodName}"`,
        };
    }
    return { valid: true, name };
}
/**
 * Splices a replacement method block into a full class source, replacing
 * the lines covered by `boundary`.
 */
function spliceMethodSource(fullSource, boundary, replacement) {
    const lines = splitLines(fullSource);
    const before = lines.slice(0, boundary.startLine - 1);
    const after = lines.slice(boundary.endLine);
    const replacementLines = splitLines(replacement);
    return [...before, ...replacementLines, ...after].join('\n');
}
//# sourceMappingURL=abapMethodBoundaries.js.map