/* eslint-disable @typescript-eslint/no-unused-vars */
import { deleteFile, getFileById, getSessionFiles } from '$lib/server/file-store';
import {
  codeStore,
  diagramStore,
  markdownStore,
  memoryStore,
  planStore,
  subagentStore
} from '$lib/server/chat/state';
import {
  buildDiagramReview,
  findMermaidDeclarations,
  parseMermaidNodes,
  validateSingleMermaidDocument
} from '$lib/server/chat/mermaid';
import { detectCodeLanguage, validateCodeArtifact } from '$lib/server/chat/code-artifacts';
import { openrouterFastChat } from '$lib/server/chat/model';
import { instructionsForSubagent } from '$lib/server/chat/subagents';
import { generateText, tool } from 'ai';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { resolveIconForNode } from './icon-resolver';

const execFileAsync = promisify(execFile);

interface ToolContext {
  modelId?: string;
  sessionId: string;
}

export function createDataAnalyzerTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description: `Perform computational analysis on CSV/tabular data from uploaded files. Use this when the user asks to analyze data, find patterns, frequencies, trends, top values, or any computation on uploaded CSV/Excel files.

OPERATIONS:
- "frequency" — Count how often each unique value appears in a column. Great for finding most common items, popular numbers, etc.
- "groupBy" — Group rows by one column and aggregate another column (sum, count, avg, min, max).
- "filter" — Filter rows where a column matches a condition (equals, contains, gt, lt, gte, lte).
- "topN" — Get the top N rows sorted by a column (ascending or descending).
- "crossTab" — Cross-tabulate two columns to see how values co-occur.
- "valueCounts" — Count occurrences of specific values across multiple columns (useful for lottery numbers across draw columns).
- "correlate" — Find correlation between two numeric columns.

WHEN TO USE:
- User asks "find me good numbers" from lottery data → use frequency + valueCounts
- User asks "what are the most common X" → use frequency
- User asks "group by X and sum Y" → use groupBy
- User asks "show top 10 by sales" → use topN
- User asks "filter where price > 100" → use filter
- Any data analysis request on uploaded CSV files`,
    inputSchema: z.object({
      aggregation: z
        .enum(['sum', 'count', 'avg', 'min', 'max'])
        .optional()
        .describe('Aggregation function for groupBy'),
      ascending: z.boolean().optional().describe('Sort ascending (default false = descending)'),
      column: z.string().optional().describe('Primary column name to analyze'),
      column2: z
        .string()
        .optional()
        .describe('Secondary column (for groupBy aggregation, crossTab, correlate)'),
      columns: z
        .array(z.string())
        .optional()
        .describe('Multiple columns for valueCounts operation'),
      fileId: z.string().describe('File ID of the uploaded CSV file to analyze'),
      filterOp: z
        .enum(['equals', 'contains', 'gt', 'lt', 'gte', 'lte', 'notEquals'])
        .optional()
        .describe('Filter comparison operator'),
      filterValue: z.string().optional().describe('Value to filter by'),
      n: z.number().optional().describe('Number of results for topN (default 20)'),
      operation: z
        .enum(['frequency', 'groupBy', 'filter', 'topN', 'crossTab', 'valueCounts', 'correlate'])
        .describe('The analysis operation to perform')
    }),
    execute: async ({
      fileId,
      operation,
      column,
      column2,
      aggregation,
      filterOp,
      filterValue,
      n = 20,
      ascending = false,
      columns: multiColumns
    }) => {
      const file = await getFileById(fileId);
      if (!file) return { success: false, error: `File not found: ${fileId}` };

      const rawText = file.extractedText || '';
      if (!rawText.trim()) return { success: false, error: 'File has no extracted text content' };

      // Parse CSV — handle both raw CSV and markdown-table format
      let headers: string[] = [];
      let rows: string[][] = [];

      // Check if it's markdown table format (from csvToMarkdown)
      if (rawText.includes('| ') && rawText.includes(' | ')) {
        const lines = rawText.split('\n').filter((l: string) => l.trim().startsWith('|'));
        if (lines.length >= 2) {
          headers = lines[0]
            .split('|')
            .map((h: string) => h.trim())
            .filter(Boolean);
          // Skip separator line (---)
          for (let i = 1; i < lines.length; i++) {
            const cells = lines[i]
              .split('|')
              .map((c: string) => c.trim())
              .filter(Boolean);
            if (cells.some((c: string) => /^-+$/.test(c))) continue; // skip separator
            if (cells.length > 0) rows.push(cells);
          }
        }
      }

      // Fallback: try raw CSV parsing
      if (headers.length === 0) {
        const lines = rawText.trim().split('\n');
        const sep = lines[0].includes('\t') ? '\t' : ',';
        headers = lines[0].split(sep).map((h: string) => h.trim().replace(/^["']|["']$/g, ''));
        rows = lines
          .slice(1)
          .map((line: string) =>
            line.split(sep).map((cell: string) => cell.trim().replace(/^["']|["']$/g, ''))
          );
      }

      if (headers.length === 0 || rows.length === 0) {
        return {
          success: false,
          error: 'Could not parse tabular data from file',
          headers: [],
          rowCount: 0
        };
      }

      const colIndex = (name: string) => {
        const idx = headers.findIndex((h: string) => h.toLowerCase() === name.toLowerCase());
        if (idx >= 0) return idx;
        // Fuzzy match: partial match
        return headers.findIndex((h: string) => h.toLowerCase().includes(name.toLowerCase()));
      };

      try {
        switch (operation) {
          case 'frequency': {
            if (!column)
              return {
                success: false,
                error: 'column is required for frequency operation',
                availableColumns: headers
              };
            const ci = colIndex(column);
            if (ci < 0)
              return {
                success: false,
                error: `Column "${column}" not found`,
                availableColumns: headers
              };
            const freq: Record<string, number> = {};
            for (const row of rows) {
              const val = (row[ci] || '').trim();
              if (val) freq[val] = (freq[val] || 0) + 1;
            }
            const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
            return {
              column,
              instruction:
                'Present the frequency results as a clear ranked list. Highlight the most common values. If the user wants lottery numbers, emphasize the "hot" numbers (most frequent) and suggest combinations.',
              operation: 'frequency',
              results: sorted.slice(0, n).map(([value, count]) => ({
                value,
                count,
                percentage: Math.round((count / rows.length) * 10000) / 100
              })),
              success: true,
              totalRows: rows.length,
              uniqueValues: sorted.length
            };
          }

          case 'valueCounts': {
            const cols = multiColumns || (column ? [column] : []);
            if (cols.length === 0)
              return {
                success: false,
                error: 'columns or column is required for valueCounts',
                availableColumns: headers
              };
            const indices = cols.map((c: string) => colIndex(c)).filter((i: number) => i >= 0);
            if (indices.length === 0)
              return {
                success: false,
                error: `None of the specified columns found`,
                availableColumns: headers
              };
            // Count every value across all specified columns
            const freq: Record<string, number> = {};
            for (const row of rows) {
              for (const ci of indices) {
                const val = (row[ci] || '').trim();
                if (val) freq[val] = (freq[val] || 0) + 1;
              }
            }
            const sorted = Object.entries(freq).sort((a, b) =>
              ascending ? a[1] - b[1] : b[1] - a[1]
            );
            return {
              columnsAnalyzed: cols,
              instruction:
                'Present the value counts clearly. For lottery analysis, these are the "hot numbers" that appear most frequently across all draw columns. Suggest the top values as recommended picks.',
              operation: 'valueCounts',
              results: sorted.slice(0, n).map(([value, count]) => ({ value, count })),
              success: true,
              totalValues: Object.values(freq).reduce((a, b) => a + b, 0),
              uniqueValues: sorted.length
            };
          }

          case 'groupBy': {
            if (!column)
              return {
                success: false,
                error: 'column is required for groupBy',
                availableColumns: headers
              };
            const ci = colIndex(column);
            if (ci < 0)
              return {
                success: false,
                error: `Column "${column}" not found`,
                availableColumns: headers
              };
            const agg = aggregation || 'count';
            const ci2 = column2 ? colIndex(column2) : -1;
            if (agg !== 'count' && ci2 < 0)
              return {
                success: false,
                error: `column2 is required for ${agg} aggregation`,
                availableColumns: headers
              };

            const groups: Record<string, number[]> = {};
            for (const row of rows) {
              const key = (row[ci] || '').trim();
              if (!key) continue;
              if (!groups[key]) groups[key] = [];
              if (ci2 >= 0) {
                const num = parseFloat(row[ci2]);
                if (!isNaN(num)) groups[key].push(num);
              } else {
                groups[key].push(1);
              }
            }

            const results = Object.entries(groups)
              .map(([key, vals]) => {
                let aggVal: number;
                switch (agg) {
                  case 'sum':
                    aggVal = vals.reduce((a, b) => a + b, 0);
                    break;
                  case 'avg':
                    aggVal = vals.length
                      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
                      : 0;
                    break;
                  case 'min':
                    aggVal = Math.min(...vals);
                    break;
                  case 'max':
                    aggVal = Math.max(...vals);
                    break;
                  default:
                    aggVal = vals.length;
                }
                return { group: key, [agg]: aggVal, count: vals.length };
              })
              .sort((a, b) =>
                ascending
                  ? (a as Record<string, number>)[agg] - (b as Record<string, number>)[agg]
                  : (b as Record<string, number>)[agg] - (a as Record<string, number>)[agg]
              );

            return {
              aggregation: agg,
              groupColumn: column,
              groupCount: results.length,
              operation: 'groupBy',
              results: results.slice(0, n),
              success: true,
              valueColumn: column2 || '(count)'
            };
          }

          case 'filter': {
            if (!column || !filterOp || filterValue === undefined)
              return {
                success: false,
                error: 'column, filterOp, and filterValue are required',
                availableColumns: headers
              };
            const ci = colIndex(column);
            if (ci < 0)
              return {
                success: false,
                error: `Column "${column}" not found`,
                availableColumns: headers
              };
            const filtered = rows.filter((row: string[]) => {
              const val = (row[ci] || '').trim();
              const numVal = parseFloat(val);
              const numFilter = parseFloat(filterValue);
              switch (filterOp) {
                case 'equals':
                  return val.toLowerCase() === filterValue.toLowerCase();
                case 'notEquals':
                  return val.toLowerCase() !== filterValue.toLowerCase();
                case 'contains':
                  return val.toLowerCase().includes(filterValue.toLowerCase());
                case 'gt':
                  return !isNaN(numVal) && !isNaN(numFilter) && numVal > numFilter;
                case 'lt':
                  return !isNaN(numVal) && !isNaN(numFilter) && numVal < numFilter;
                case 'gte':
                  return !isNaN(numVal) && !isNaN(numFilter) && numVal >= numFilter;
                case 'lte':
                  return !isNaN(numVal) && !isNaN(numFilter) && numVal <= numFilter;
                default:
                  return false;
              }
            });
            return {
              column,
              filterOp,
              filterValue,
              matchedRows: filtered.length,
              operation: 'filter',
              results: filtered.slice(0, n).map((row: string[]) => {
                const obj: Record<string, string> = {};
                headers.forEach((h: string, i: number) => {
                  obj[h] = row[i] || '';
                });
                return obj;
              }),
              success: true,
              totalRows: rows.length
            };
          }

          case 'topN': {
            if (!column)
              return {
                success: false,
                error: 'column is required for topN',
                availableColumns: headers
              };
            const ci = colIndex(column);
            if (ci < 0)
              return {
                success: false,
                error: `Column "${column}" not found`,
                availableColumns: headers
              };
            const sorted = [...rows].sort((a: string[], b: string[]) => {
              const va = parseFloat(a[ci]);
              const vb = parseFloat(b[ci]);
              if (!isNaN(va) && !isNaN(vb)) return ascending ? va - vb : vb - va;
              return ascending
                ? (a[ci] || '').localeCompare(b[ci] || '')
                : (b[ci] || '').localeCompare(a[ci] || '');
            });
            return {
              ascending,
              column,
              n,
              operation: 'topN',
              results: sorted.slice(0, n).map((row: string[]) => {
                const obj: Record<string, string> = {};
                headers.forEach((h: string, i: number) => {
                  obj[h] = row[i] || '';
                });
                return obj;
              }),
              success: true,
              totalRows: rows.length
            };
          }

          case 'crossTab': {
            if (!column || !column2)
              return {
                success: false,
                error: 'column and column2 are required for crossTab',
                availableColumns: headers
              };
            const ci1 = colIndex(column);
            const ci2 = colIndex(column2);
            if (ci1 < 0)
              return {
                success: false,
                error: `Column "${column}" not found`,
                availableColumns: headers
              };
            if (ci2 < 0)
              return {
                success: false,
                error: `Column "${column2}" not found`,
                availableColumns: headers
              };
            const cross: Record<string, Record<string, number>> = {};
            for (const row of rows) {
              const v1 = (row[ci1] || '').trim();
              const v2 = (row[ci2] || '').trim();
              if (!v1 || !v2) continue;
              if (!cross[v1]) cross[v1] = {};
              cross[v1][v2] = (cross[v1][v2] || 0) + 1;
            }
            return {
              column1: column,
              column2,
              operation: 'crossTab',
              results: cross,
              success: true
            };
          }

          case 'correlate': {
            if (!column || !column2)
              return {
                success: false,
                error: 'column and column2 are required for correlate',
                availableColumns: headers
              };
            const ci1 = colIndex(column);
            const ci2 = colIndex(column2);
            if (ci1 < 0 || ci2 < 0)
              return { success: false, error: 'Column(s) not found', availableColumns: headers };
            const pairs: [number, number][] = [];
            for (const row of rows) {
              const v1 = parseFloat(row[ci1]);
              const v2 = parseFloat(row[ci2]);
              if (!isNaN(v1) && !isNaN(v2)) pairs.push([v1, v2]);
            }
            if (pairs.length < 3)
              return { success: false, error: 'Not enough numeric pairs for correlation' };
            const n1 = pairs.length;
            const sumX = pairs.reduce((s, p) => s + p[0], 0);
            const sumY = pairs.reduce((s, p) => s + p[1], 0);
            const sumXY = pairs.reduce((s, p) => s + p[0] * p[1], 0);
            const sumX2 = pairs.reduce((s, p) => s + p[0] ** 2, 0);
            const sumY2 = pairs.reduce((s, p) => s + p[1] ** 2, 0);
            const num = n1 * sumXY - sumX * sumY;
            const den = Math.sqrt((n1 * sumX2 - sumX ** 2) * (n1 * sumY2 - sumY ** 2));
            const r = den === 0 ? 0 : Math.round((num / den) * 10000) / 10000;
            return {
              column1: column,
              column2,
              correlation: r,
              operation: 'correlate',
              pairCount: n1,
              strength: Math.abs(r) > 0.7 ? 'strong' : Math.abs(r) > 0.4 ? 'moderate' : 'weak',
              success: true
            };
          }

          default:
            return { success: false, error: `Unknown operation: ${operation}` };
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Analysis failed' };
      }
    }
  });
}
