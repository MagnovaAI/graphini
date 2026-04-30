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

export function createTableAnalyticsTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Analyze CSV/tabular data and generate insights. Can detect columns, calculate statistics (mean, median, min, max, outliers), and suggest chart types. Use when the user provides CSV data or asks to "analyze this data", "create a chart from this", or "what are the trends".',
    inputSchema: z.object({
      source: z
        .enum(['document', 'text'])
        .describe('Where to get data: "document" = current markdown panel, "text" = provided text'),
      data: z.string().optional().describe('CSV or tabular data (only used when source is "text")'),
      operations: z
        .array(z.enum(['summary', 'statistics', 'trends', 'outliers', 'chart-suggestion']))
        .optional()
        .describe('Analysis operations to perform. Defaults to all.')
    }),
    execute: async ({ source, data, operations }) => {
      const content = source === 'document' ? markdownStore.get(sessionId) || '' : data || '';
      if (!content.trim()) {
        return { success: false, error: 'No data to analyze' };
      }

      // Basic CSV parsing
      const lines = content.trim().split('\n');
      const separator = lines[0].includes('\t') ? '\t' : ',';
      const headers = lines[0]
        .split(separator)
        .map((h: string) => h.trim().replace(/^["']|["']$/g, ''));
      const rows = lines
        .slice(1)
        .map((line: string) =>
          line.split(separator).map((cell: string) => cell.trim().replace(/^["']|["']$/g, ''))
        );

      // Detect numeric columns
      const numericColumns: Record<string, number[]> = {};
      for (let col = 0; col < headers.length; col++) {
        const values = rows
          .map((row: string[]) => parseFloat(row[col]))
          .filter((v: number) => !isNaN(v));
        if (values.length > rows.length * 0.5) {
          numericColumns[headers[col]] = values;
        }
      }

      // Calculate statistics for numeric columns
      const stats: Record<
        string,
        {
          count: number;
          max: number;
          mean: number;
          median: number;
          min: number;
          outlierCount: number;
          outliers: number[];
          q1: number;
          q3: number;
          stdDev: number;
        }
      > = {};
      for (const [col, values] of Object.entries(numericColumns)) {
        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / values.length;
        const median =
          sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)];
        const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
        const stdDev = Math.sqrt(variance);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        const outliers = values.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);

        stats[col] = {
          count: values.length,
          max: sorted[sorted.length - 1],
          mean: Math.round(mean * 100) / 100,
          median: Math.round(median * 100) / 100,
          min: sorted[0],
          outlierCount: outliers.length,
          outliers: outliers.slice(0, 5),
          q1: Math.round(q1 * 100) / 100,
          q3: Math.round(q3 * 100) / 100,
          stdDev: Math.round(stdDev * 100) / 100
        };
      }

      // Suggest chart types
      const chartSuggestions: string[] = [];
      const numCols = Object.keys(numericColumns).length;
      const catCols = headers.length - numCols;
      if (numCols >= 2) chartSuggestions.push('scatter plot', 'line chart');
      if (numCols >= 1 && catCols >= 1) chartSuggestions.push('bar chart', 'grouped bar chart');
      if (numCols === 1 && rows.length <= 10) chartSuggestions.push('pie chart');
      if (rows.length > 5 && numCols >= 1) chartSuggestions.push('line chart (trend)');

      return {
        categoricalColumns: headers.filter((h: string) => !numericColumns[h]),
        chartSuggestions,
        columnCount: headers.length,
        headers,
        instruction:
          'Present the analysis results clearly. For each numeric column, show key statistics. Highlight any outliers or interesting trends. If the user wants a chart, create a Mermaid xychart or pie chart using diagramWrite. Format the summary as markdown if writing to the document panel.',
        numericColumns: Object.keys(numericColumns),
        operations: operations || [
          'summary',
          'statistics',
          'trends',
          'outliers',
          'chart-suggestion'
        ],
        rowCount: rows.length,
        statistics: stats,
        success: true
      };
    }
  });
}
