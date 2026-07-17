"use strict";
/**
 * DDIC structure DDL generation.
 *
 * Turns the CreateStructure tool's `fields` / `includes` input into a
 * "define structure" DDL source string that the ADT structure update path
 * accepts. Pure and side-effect free so it can be unit-tested offline.
 *
 * Supported per-field typing (precedence in this order):
 *   1. data_element        -> `name : zde;`
 *   2. built-in data_type  -> `name : abap.char(10);`, `abap.dec(15,2)`, ...
 *        - CURR with currency_reference -> emits @Semantics.amount.currencyCode
 *        - QUAN with unit_reference     -> emits @Semantics.quantity.unitOfMeasure
 *   includes[]             -> `include zstruct;`
 *
 * Anything that cannot be expressed from the information given THROWS
 * (naming the offending field/include) rather than emitting a guess or a
 * placeholder.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateStructureDdl = generateStructureDdl;
// ABAP DDL built-in type mapping. `len` types require a positive length;
// `lendec` types require a positive length and use decimals (default 0).
const BUILTIN_TYPES = {
    CHAR: { ddl: 'abap.char', kind: 'len' },
    NUMC: { ddl: 'abap.numc', kind: 'len' },
    RAW: { ddl: 'abap.raw', kind: 'len' },
    UNIT: { ddl: 'abap.unit', kind: 'len' },
    STRING: { ddl: 'abap.string', kind: 'len' },
    DEC: { ddl: 'abap.dec', kind: 'lendec' },
    CURR: { ddl: 'abap.curr', kind: 'lendec' },
    QUAN: { ddl: 'abap.quan', kind: 'lendec' },
    DATS: { ddl: 'abap.dats', kind: 'none' },
    TIMS: { ddl: 'abap.tims', kind: 'none' },
    CUKY: { ddl: 'abap.cuky', kind: 'none' },
    INT1: { ddl: 'abap.int1', kind: 'none' },
    INT2: { ddl: 'abap.int2', kind: 'none' },
    INT4: { ddl: 'abap.int4', kind: 'none' },
    INT8: { ddl: 'abap.int8', kind: 'none' },
    FLTP: { ddl: 'abap.fltp', kind: 'none' },
};
function isPositiveLength(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function renderField(field, structureNameLower) {
    const fieldName = field?.name?.trim();
    if (!fieldName) {
        throw new Error('A structure field is missing its required "name".');
    }
    const nameLower = fieldName.toLowerCase();
    // 1. Data-element-typed field wins over everything else.
    const dataElement = field.data_element?.trim();
    if (dataElement) {
        return [`  ${nameLower} : ${dataElement.toLowerCase()};`];
    }
    // 2. Built-in data type.
    const dataType = field.data_type?.trim();
    if (dataType) {
        const key = dataType.toUpperCase();
        const def = BUILTIN_TYPES[key];
        if (!def) {
            throw new Error(`Field "${fieldName}": unsupported data_type "${dataType}". ` +
                `Use a data_element, or one of: ${Object.keys(BUILTIN_TYPES).join(', ')}.`);
        }
        let typeExpr;
        if (def.kind === 'none') {
            typeExpr = def.ddl;
        }
        else {
            if (!isPositiveLength(field.length)) {
                throw new Error(`Field "${fieldName}": data_type ${key} requires a positive "length".`);
            }
            if (def.kind === 'lendec') {
                const decimals = field.decimals ?? 0;
                typeExpr = `${def.ddl}(${field.length},${decimals})`;
            }
            else {
                typeExpr = `${def.ddl}(${field.length})`;
            }
        }
        const lines = [];
        // Semantic reference annotations for amount / quantity fields.
        if (key === 'CURR' && field.currency_reference?.trim()) {
            lines.push(`  @Semantics.amount.currencyCode : '${structureNameLower}.${field.currency_reference.trim().toLowerCase()}'`);
        }
        else if (key === 'QUAN' && field.unit_reference?.trim()) {
            lines.push(`  @Semantics.quantity.unitOfMeasure : '${structureNameLower}.${field.unit_reference.trim().toLowerCase()}'`);
        }
        lines.push(`  ${nameLower} : ${typeExpr};`);
        return lines;
    }
    // 3. Nothing usable — refuse to guess from domain/structure_ref/table_ref.
    throw new Error(`Field "${fieldName}" cannot be expressed as DDL: provide "data_element" or a ` +
        `built-in "data_type" (with "length"/"decimals" where required). ` +
        `The generator does not infer a type from domain/structure_ref/table_ref.`);
}
/**
 * Generate DDIC "define structure" DDL from field/include specs.
 * Throws (naming the offending entry) when an input cannot be expressed.
 */
function generateStructureDdl(input) {
    const structureName = input?.structureName?.trim();
    if (!structureName) {
        throw new Error('structureName is required to generate structure DDL.');
    }
    const structureNameLower = structureName.toLowerCase();
    const fields = input.fields ?? [];
    const includes = input.includes ?? [];
    if (fields.length === 0 && includes.length === 0) {
        throw new Error('At least one field or include is required to generate structure DDL.');
    }
    const bodyLines = [];
    for (const field of fields) {
        bodyLines.push(...renderField(field, structureNameLower));
    }
    for (const include of includes) {
        const includeName = include?.name?.trim();
        if (!includeName) {
            throw new Error('An include entry is missing its required "name".');
        }
        if (include.suffix?.trim()) {
            throw new Error(`Include "${includeName}": a "suffix" cannot be expressed in generated DDL; ` +
                `include the structure without a suffix.`);
        }
        bodyLines.push(`  include ${includeName.toLowerCase()};`);
    }
    const header = [];
    const description = input.description?.trim();
    if (description) {
        header.push(`@EndUserText.label : '${description.replace(/'/g, "''")}'`);
    }
    // Without an enhancement category the ADT source PUT is rejected with
    // "Kein Sichern wegen Fehler in Quelle" (live A/B-verified on S/4 2021);
    // #NOT_EXTENSIBLE matches what ADT's own create template emits.
    header.push('@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE');
    header.push(`define structure ${structureNameLower} {`);
    return [...header, ...bodyLines, '}'].join('\n');
}
//# sourceMappingURL=structureDdl.js.map