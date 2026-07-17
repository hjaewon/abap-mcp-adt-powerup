import type { ILogger } from '@babamba2/mcp-abap-adt-interfaces';
import { createAdtClient } from '../../../lib/clients';
import type { HandlerContext } from '../../../lib/handlers/interfaces';
import {
  activeProfile,
  checkTables,
  evaluateHits,
  extractTablesFromSql,
  isAggregateOnly,
} from '../../../lib/policy/tableBlocklist';
import { ErrorCode, McpError } from '../../../lib/utils';
import { writeResultToFile } from '../../../lib/writeResultToFile';
export const TOOL_DEFINITION = {
  name: 'GetSqlQuery',
  available_in: ['onprem', 'cloud'] as const,
  description:
    '[read-only] Execute ABAP SQL SELECT queries on database tables and CDS views via SAP ADT Data Preview API. Use for ad-hoc data retrieval, row counts, and filtered queries. ' +
    'Empty cells (including self-closing XML cells) are preserved as null in row order. Complex statements (4-way joins, long IN lists) can fail with HTTP 400 — shorten aliases or replace long IN lists with BETWEEN ranges; sporadic 400s under concurrent calls succeed on retry. ' +
    'The response also reports returned_row_count (rows actually parsed), truncated (true when the row_number cap was hit or the server total exceeds it), and server_total_rows (server-reported total when the XML provides it).',
  inputSchema: {
    type: 'object',
    properties: {
      sql_query: {
        type: 'string',
        description: 'SQL query to execute',
      },
      row_number: {
        type: 'number',
        description: '[read-only] Maximum number of rows to return',
        default: 100,
      },
      acknowledge_risk: {
        type: 'boolean',
        description:
          "Set to true ONLY after the user has explicitly authorized row extraction from an 'ask'-tier protected table. The approval is logged to stderr for audit. Has no effect on 'deny'-tier tables.",
        default: false,
      },
    },
    required: ['sql_query'],
  },
} as const;

/**
 * Interface for SQL query execution response
 */
export interface SqlQueryResponse {
  sql_query: string;
  row_number: number;
  execution_time?: number;
  total_rows?: number;
  /** Number of rows actually parsed from the response (rows.length). */
  returned_row_count?: number;
  /** True when the returned count hit the requested cap, or a server-reported total exceeds it. */
  truncated?: boolean;
  /** Server-reported total row count, present only when the Data Preview XML provides it. */
  server_total_rows?: number;
  columns: Array<{
    name: string;
    type: string;
    description?: string;
    length?: number;
  }>;
  rows: Array<Record<string, any>>;
}

/**
 * Parse SAP ADT XML response from freestyle SQL query and convert to JSON format
 * @param xmlData - Raw XML response from ADT
 * @param sqlQuery - Original SQL query
 * @param rowNumber - Number of rows requested
 * @returns Parsed SQL query response
 */
export function parseSqlQueryXml(
  xmlData: string,
  sqlQuery: string,
  rowNumber: number,
  logger?: ILogger,
): SqlQueryResponse {
  try {
    // Extract basic information
    const totalRowsMatch = xmlData.match(
      /<dataPreview:totalRows>(\d+)<\/dataPreview:totalRows>/,
    );
    const totalRows = totalRowsMatch ? parseInt(totalRowsMatch[1], 10) : 0;

    const queryTimeMatch = xmlData.match(
      /<dataPreview:queryExecutionTime>([\d.]+)<\/dataPreview:queryExecutionTime>/,
    );
    const queryExecutionTime = queryTimeMatch
      ? parseFloat(queryTimeMatch[1])
      : 0;

    // Extract column metadata
    const columns: Array<{
      name: string;
      type: string;
      description?: string;
      length?: number;
    }> = [];
    const columnMatches = xmlData.match(/<dataPreview:metadata[^>]*>/g);

    if (columnMatches) {
      columnMatches.forEach((match) => {
        const nameMatch = match.match(/dataPreview:name="([^"]+)"/);
        const typeMatch = match.match(/dataPreview:type="([^"]+)"/);
        const descMatch = match.match(/dataPreview:description="([^"]+)"/);
        const lengthMatch = match.match(/dataPreview:length="(\d+)"/);

        if (nameMatch) {
          columns.push({
            name: nameMatch[1],
            type: typeMatch ? typeMatch[1] : 'UNKNOWN',
            description: descMatch ? descMatch[1] : '',
            length: lengthMatch ? parseInt(lengthMatch[1], 10) : undefined,
          });
        }
      });
    }

    // Extract row data
    const rows: Array<Record<string, any>> = [];

    // Find all column sections
    const columnSections = xmlData.match(
      /<dataPreview:columns>.*?<\/dataPreview:columns>/gs,
    );

    if (columnSections && columnSections.length > 0) {
      // Extract data for each column
      const columnData: Record<string, (string | null)[]> = {};

      // Match BOTH open/close cells (<dataPreview:data>value</dataPreview:data>)
      // AND self-closing cells (<dataPreview:data/> or <dataPreview:data .../>)
      // in a single ordered pass. A self-closing cell maps to null while KEEPING
      // its array position, so values in later rows do not shift up a row. The
      // self-closing alternative is listed first so it wins for empty-element
      // tags; \b after "data" prevents matching sibling tags like dataSet.
      const cellRegex =
        /<dataPreview:data\b[^>]*\/>|<dataPreview:data\b[^>]*>(.*?)<\/dataPreview:data>/g;

      columnSections.forEach((section, index) => {
        if (index < columns.length) {
          const columnName = columns[index].name;
          columnData[columnName] = [...section.matchAll(cellRegex)].map(
            (match) => {
              // Self-closing cell → capture group is undefined → null.
              if (match[1] === undefined) {
                return null;
              }
              // Empty open/close content → null; whitespace-only preserved verbatim.
              const content = match[1].replace(/<[^>]+>/g, '');
              return content || null;
            },
          );
        }
      });

      // Convert column-based data to row-based data
      const maxRowCount = Math.max(
        ...Object.values(columnData).map((arr) => arr.length),
        0,
      );

      for (let rowIndex = 0; rowIndex < maxRowCount; rowIndex++) {
        const row: Record<string, any> = {};
        columns.forEach((column) => {
          const columnValues = columnData[column.name] || [];
          row[column.name] = columnValues[rowIndex] || null;
        });
        rows.push(row);
      }
    }

    // Truncation flags: make it undeniable how many rows were actually fetched
    // vs. how many the server reports exist. `server_total_rows` is present only
    // when the XML carries <dataPreview:totalRows>.
    const returnedRowCount = rows.length;
    const serverTotalRows = totalRowsMatch ? totalRows : undefined;
    const truncated =
      returnedRowCount >= rowNumber ||
      (serverTotalRows !== undefined && serverTotalRows > returnedRowCount);

    return {
      sql_query: sqlQuery,
      row_number: rowNumber,
      execution_time: queryExecutionTime,
      total_rows: totalRows,
      returned_row_count: returnedRowCount,
      truncated,
      server_total_rows: serverTotalRows,
      columns,
      rows,
    };
  } catch (parseError) {
    logger?.error('Failed to parse SQL query XML:', parseError as any);

    // Return basic structure on parse error
    return {
      sql_query: sqlQuery,
      row_number: rowNumber,
      columns: [],
      rows: [],
      error: 'Failed to parse XML response',
    } as any;
  }
}

/**
 * Handler to execute freestyle SQL queries via SAP ADT Data Preview API
 *
 * @param args - Tool arguments containing sql_query and optional row_number parameter
 * @returns Response with parsed SQL query results or error
 */
export async function handleGetSqlQuery(context: HandlerContext, args: any) {
  const { connection, logger } = context;
  try {
    logger?.info('handleGetSqlQuery called');

    if (!args?.sql_query) {
      throw new McpError(ErrorCode.InvalidParams, 'SQL query is required');
    }

    const sqlQuery = args.sql_query;
    const rowNumber = args.row_number || 100; // Default to 100 rows if not specified

    const tables = extractTablesFromSql(sqlQuery);
    if (tables.length > 0 && !isAggregateOnly(sqlQuery)) {
      const hits = checkTables(tables);
      const verdict = evaluateHits(
        hits,
        args.acknowledge_risk === true,
        activeProfile(),
      );
      if (verdict.kind === 'deny') {
        logger?.warn(`Blocked GetSqlQuery: ${tables.join(',')}`);
        throw new McpError(ErrorCode.InvalidRequest, verdict.message);
      }
      if (verdict.kind === 'ask') {
        logger?.warn(
          `GetSqlQuery requires user acknowledgement: ${tables.join(',')}`,
        );
        throw new McpError(ErrorCode.InvalidRequest, verdict.message);
      }
      if (verdict.kind === 'approved') {
        process.stderr.write(
          `[mcp-abap-adt][blocklist] AUDIT: user-acknowledged GetSqlQuery on ${verdict.tables.join(',')}\n`,
        );
        logger?.warn(
          `AUDIT: user-acknowledged GetSqlQuery on ${verdict.tables.join(',')}`,
        );
      }
    }

    logger?.info(`Executing SQL query (rows=${rowNumber})`);

    const client = createAdtClient(connection, logger);
    const response = await client
      .getUtils()
      .getSqlQuery({ sql_query: sqlQuery, row_number: rowNumber });

    if (response.status === 200 && response.data) {
      logger?.info('SQL query request completed successfully');

      // Parse the XML response
      const parsedData = parseSqlQueryXml(
        response.data,
        sqlQuery,
        rowNumber,
        logger,
      );

      logger?.debug(
        `Parsed SQL query data: rows=${parsedData.rows.length}/${parsedData.total_rows ?? 0}, columns=${parsedData.columns.length}`,
      );

      const result = {
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify(parsedData, null, 2),
          },
        ],
      };
      if (args.filePath) {
        logger?.debug(`Writing SQL query result to file: ${args.filePath}`);
        writeResultToFile(result, args.filePath);
      }
      return result;
    } else {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to execute SQL query. Status: ${response.status}`,
      );
    }
  } catch (error) {
    logger?.error('Failed to execute SQL query', error as any);
    // MCP-compliant error response: always return content[] with type "text"
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `ADT error: ${String(error)}`,
        },
      ],
    };
  }
}
