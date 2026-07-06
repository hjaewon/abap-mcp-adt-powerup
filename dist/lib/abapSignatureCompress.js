"use strict";
/**
 * Pure ABAP signature compressors.
 *
 * Reduce full ABAP source down to its public "contract" — used to build a
 * compressed dependency prologue (see contextPrologue.ts) so a single MCP
 * call can return a class/interface/program body plus the signatures of
 * everything it depends on, without pulling in full implementation bodies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compressClass = compressClass;
exports.compressInterface = compressInterface;
exports.compressFunctionModule = compressFunctionModule;
function stripCommentLines(source) {
    return source
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith('*'))
        .join('\n');
}
/**
 * Keeps only the `CLASS ... DEFINITION` header and `PUBLIC SECTION` of a
 * class, dropping the PROTECTED/PRIVATE sections and the entire
 * IMPLEMENTATION part. Falls back to the comment-stripped source unchanged
 * if the expected structure isn't found (e.g. unusual formatting).
 */
function compressClass(source) {
    const cleaned = stripCommentLines(source);
    const defMatch = cleaned.match(/CLASS\s+\S+\s+DEFINITION\b/i);
    if (!defMatch || defMatch.index === undefined) {
        return cleaned.trim();
    }
    const tail = cleaned.slice(defMatch.index);
    const endMatch = tail.match(/ENDCLASS\s*\./i);
    if (!endMatch || endMatch.index === undefined) {
        return cleaned.trim();
    }
    const definitionBlock = tail.slice(0, endMatch.index + endMatch[0].length);
    const publicMatch = definitionBlock.match(/PUBLIC\s+SECTION\s*\./i);
    if (!publicMatch || publicMatch.index === undefined) {
        // No PUBLIC SECTION found (unusual) — nothing further to cut.
        return definitionBlock.trim();
    }
    const header = definitionBlock.slice(0, publicMatch.index);
    const afterPublic = definitionBlock.slice(publicMatch.index);
    const cutMatch = afterPublic.match(/\b(PROTECTED|PRIVATE)\s+SECTION\s*\./i);
    let publicSection;
    if (cutMatch && cutMatch.index !== undefined) {
        publicSection = afterPublic.slice(0, cutMatch.index);
    }
    else {
        const endInAfter = afterPublic.match(/ENDCLASS\s*\./i);
        publicSection =
            endInAfter && endInAfter.index !== undefined
                ? afterPublic.slice(0, endInAfter.index)
                : afterPublic;
    }
    return `${header}${publicSection}\nENDCLASS.`.trim();
}
/**
 * Interfaces are already pure contracts — just strip full-line comments.
 */
function compressInterface(source) {
    return stripCommentLines(source).trim();
}
/**
 * Keeps only the `FUNCTION` header, the `*"` local-interface signature
 * comment block, and the closing `ENDFUNCTION` — strips the function body.
 * Falls back to the source unchanged if the expected structure isn't found.
 */
function compressFunctionModule(source) {
    const lines = source.split(/\r?\n/);
    const funcIdx = lines.findIndex((line) => /^\s*FUNCTION\s+\S+\s*\.\s*$/i.test(line));
    if (funcIdx === -1) {
        return source;
    }
    const endIdx = lines.findIndex((line, i) => i > funcIdx && /^\s*ENDFUNCTION\s*\.\s*$/i.test(line));
    if (endIdx === -1) {
        return source;
    }
    const kept = [lines[funcIdx]];
    for (let i = funcIdx + 1; i < endIdx; i++) {
        const trimmed = lines[i].trimStart();
        if (trimmed.startsWith('*"')) {
            kept.push(lines[i]);
        }
        else if (trimmed === '') {
        }
        else {
            break;
        }
    }
    kept.push(lines[endIdx]);
    return kept.join('\n');
}
//# sourceMappingURL=abapSignatureCompress.js.map