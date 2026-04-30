import { validateSession } from '$lib/server/auth';
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
import { hasRecentSubagentFanout, shouldExposePlanningTool } from '$lib/server/chat/tool-gating';
import { instructionsForSubagent } from '$lib/server/chat/subagents';
import { openrouterFastChat } from '$lib/server/chat/model';
import { getDb } from '$lib/server/db';
import { deleteFile, getFileById, getSessionFiles } from '$lib/server/file-store';
import { stateManager } from '$lib/server/state-manager';
import { chatLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';
import { error, json } from '@sveltejs/kit';
import { generateText, streamText, tool } from 'ai';
import { execFile } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { z } from 'zod';
import type { RequestHandler } from './$types';
dotenv.config({ path: '.env.local' });
dotenv.config();

const execFileAsync = promisify(execFile);

// --- Iconifier: local icon index & resolution helpers ---

interface IconEntry {
  id: string;
  path: string;
  category: string;
  keywords: string[];
}

// Load icon index from static/icons/index.json (cached in memory)
let _iconIndex: IconEntry[] | null = null;
function getIconIndex(): IconEntry[] {
  if (_iconIndex) return _iconIndex;
  try {
    const indexPath = path.resolve('static/icons/index.json');
    const raw = fs.readFileSync(indexPath, 'utf-8');
    const data = JSON.parse(raw);
    _iconIndex = data.icons as IconEntry[];
    console.log(`[iconifier] Loaded ${_iconIndex.length} icons from local index`);
  } catch (e) {
    console.error('[iconifier] Failed to load icon index:', e);
    _iconIndex = [];
  }
  return _iconIndex;
}

const CONFIDENCE_THRESHOLD = 0.7;

// --- Iconify web icon search fallback ---
async function searchIconifyWeb(
  query: string,
  limit = 3
): Promise<{ url: string; iconId: string; confidence: number }[]> {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `https://api.iconify.design/search?query=${encoded}&limit=${limit * 2}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const icons: string[] = data.icons || [];
    return icons.slice(0, limit).map((iconId, i) => {
      const [prefix, name] = iconId.split(':');
      return {
        url: `https://api.iconify.design/${prefix}/${name}.svg`,
        iconId,
        confidence: Math.max(0.7, 0.9 - i * 0.05)
      };
    });
  } catch {
    return [];
  }
}

// Normalize text for matching
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract keywords from text (remove common words)
function extractKeywords(text: string): string[] {
  const commonWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'by',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'must',
    'this',
    'that',
    'these',
    'those',
    'i',
    'you',
    'he',
    'she',
    'it',
    'we',
    'they',
    'me',
    'him',
    'her',
    'us',
    'them',
    'service',
    'server',
    'layer',
    'system',
    'component',
    'primary',
    'main',
    'core',
    'handles',
    'manages',
    'provides',
    'stores',
    'processes'
  ]);
  return normalizeText(text)
    .split(' ')
    .filter((w) => w.length >= 2 && !commonWords.has(w));
}

// Score how well a query matches an icon entry
function scoreIconMatch(query: string, icon: IconEntry): number {
  const q = normalizeText(query);
  const iconId = icon.id.toLowerCase();
  const iconWords = icon.keywords.map((k) => k.toLowerCase());

  // Exact match on icon id
  if (q === iconId) return 1.0;

  // Query equals one of the keywords exactly
  if (iconWords.includes(q)) return 0.95;

  // Icon id contains query or vice versa
  if (iconId.includes(q)) return 0.9;
  if (q.includes(iconId) && iconId.length > 2) return 0.85;

  // Keyword overlap scoring
  const queryKeywords = extractKeywords(query);
  if (queryKeywords.length === 0) return 0;

  let matchedKeywords = 0;
  for (const qk of queryKeywords) {
    // Check against icon id and keywords
    if (iconId.includes(qk) || qk.includes(iconId)) {
      matchedKeywords += 1;
    } else if (iconWords.some((iw) => iw.includes(qk) || qk.includes(iw))) {
      matchedKeywords += 0.8;
    }
  }

  const keywordScore = matchedKeywords / queryKeywords.length;

  // Dice coefficient for fuzzy matching
  const diceScore = diceCoefficient(q, iconId);

  return Math.max(keywordScore * 0.8, diceScore * 0.6, keywordScore * 0.5 + diceScore * 0.3);
}

// Dice coefficient for string similarity
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bi = a.substring(i, i + 2);
    bigrams.set(bi, (bigrams.get(bi) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bi = b.substring(i, i + 2);
    const count = bigrams.get(bi) || 0;
    if (count > 0) {
      bigrams.set(bi, count - 1);
      hits++;
    }
  }
  return (2 * hits) / (a.length - 1 + b.length - 1);
}

// Search local icon index for best match
function searchLocalIcons(
  query: string,
  limit = 5
): { path: string; iconId: string; confidence: number }[] {
  if (!query.trim()) return [];
  const icons = getIconIndex();
  const scored: { path: string; iconId: string; confidence: number }[] = [];

  for (const icon of icons) {
    const score = scoreIconMatch(query, icon);
    if (score >= CONFIDENCE_THRESHOLD) {
      scored.push({ path: icon.path, iconId: icon.id, confidence: Math.round(score * 100) / 100 });
    }
  }

  // Sort by confidence descending
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, limit);
}

// Resolve icon for a diagram node — tries local then web fallback
async function resolveIconForNode(
  nodeId: string,
  nodeText: string
): Promise<{ url: string; iconId: string; confidence: number } | null> {
  // Strategy 1: Direct nodeId match (highest priority — nodeId should be a brand name)
  const directMatch = searchLocalIcons(nodeId, 1);
  if (directMatch.length > 0 && directMatch[0].confidence >= 0.85) {
    return {
      url: directMatch[0].path,
      iconId: directMatch[0].iconId,
      confidence: directMatch[0].confidence
    };
  }

  // Strategy 2: Extract brand-like words from nodeId (camelCase split)
  const camelParts = nodeId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((p) => p.length > 2);
  for (const part of camelParts) {
    const partMatch = searchLocalIcons(part, 1);
    if (partMatch.length > 0 && partMatch[0].confidence >= 0.85) {
      return {
        url: partMatch[0].path,
        iconId: partMatch[0].iconId,
        confidence: partMatch[0].confidence
      };
    }
  }

  // Strategy 3: Search using node text keywords
  if (nodeText.trim()) {
    const textMatch = searchLocalIcons(nodeText, 1);
    if (textMatch.length > 0 && textMatch[0].confidence >= CONFIDENCE_THRESHOLD) {
      return {
        url: textMatch[0].path,
        iconId: textMatch[0].iconId,
        confidence: textMatch[0].confidence
      };
    }

    // Strategy 4: Individual keywords from text
    const keywords = extractKeywords(nodeText);
    for (const kw of keywords) {
      const kwMatch = searchLocalIcons(kw, 1);
      if (kwMatch.length > 0 && kwMatch[0].confidence >= 0.85) {
        return {
          url: kwMatch[0].path,
          iconId: kwMatch[0].iconId,
          confidence: kwMatch[0].confidence
        };
      }
    }
  }

  // Strategy 5: Combined nodeId + first keyword from text
  if (nodeText.trim()) {
    const keywords = extractKeywords(nodeText);
    if (keywords.length > 0) {
      const combined = `${nodeId} ${keywords[0]}`;
      const combinedMatch = searchLocalIcons(combined, 1);
      if (combinedMatch.length > 0 && combinedMatch[0].confidence >= CONFIDENCE_THRESHOLD) {
        return {
          url: combinedMatch[0].path,
          iconId: combinedMatch[0].iconId,
          confidence: combinedMatch[0].confidence
        };
      }
    }
  }

  // Strategy 6: Iconify web search fallback (async)
  const webQueries = [nodeId, nodeText.trim()].filter(Boolean);
  for (const wq of webQueries) {
    const webResults = await searchIconifyWeb(wq, 1);
    if (webResults.length > 0) {
      return webResults[0];
    }
  }

  return null;
}

// AI SDK Tool Definitions for Multi-Step Calling
const createDiagramTools = (sessionId: string, modelId?: string) => ({
  actionItemExtractor: tool({
    description:
      'Extract action items, tasks, KPIs, risks, and key entities from the current document or a provided text. Returns structured data that can be used to create diagrams or task lists. Use when the user asks to "extract action items", "find tasks", "identify risks", or "summarize key points".',
    inputSchema: z.object({
      source: z
        .enum(['document', 'text'])
        .describe(
          'Where to extract from: "document" = current markdown panel, "text" = provided text'
        ),
      text: z
        .string()
        .optional()
        .describe('Text to extract from (only used when source is "text")'),
      extractTypes: z
        .array(z.enum(['actions', 'risks', 'kpis', 'entities', 'decisions', 'deadlines']))
        .optional()
        .describe('Types of items to extract. Defaults to all.')
    }),
    execute: async ({ source, text, extractTypes }) => {
      const content = source === 'document' ? markdownStore.get(sessionId) || '' : text || '';
      if (!content.trim()) {
        return { success: false, error: 'No content to extract from' };
      }

      const types = extractTypes || [
        'actions',
        'risks',
        'kpis',
        'entities',
        'decisions',
        'deadlines'
      ];

      return {
        content: content,
        instruction:
          'Analyze the provided content and extract the requested item types. Return structured results with: actions (who, what, when), risks (description, severity, mitigation), KPIs (metric, target, current), entities (name, type, role), decisions (what, rationale, impact), deadlines (task, date, owner). Format as a clear summary.',
        requestedTypes: types,
        sourceLength: content.length,
        sourceLines: content.split('\n').length,
        success: true
      };
    }
  }),

  askQuestions: tool({
    description:
      'Ask the user one or more multiple-choice or multi-select questions to clarify requirements before creating/editing a diagram. The user will see a questionnaire UI and can select answers. Use this when the request is ambiguous or you need to understand preferences (e.g. diagram type, level of detail, which components to include). Questions should be concise and options should be clear.',
    inputSchema: z.object({
      context: z.string().describe('Brief context about why you are asking these questions'),
      questions: z
        .array(
          z.object({
            id: z.string().describe('Unique question ID like q1, q2'),
            text: z.string().describe('The question text'),
            type: z
              .enum(['single', 'multi'])
              .describe('single = radio buttons, multi = checkboxes'),
            options: z
              .array(
                z.object({
                  id: z.string().describe('Option ID like a, b, c'),
                  label: z.string().describe('Option label shown to user')
                })
              )
              .describe('Answer options (2-6 options)')
          })
        )
        .describe('Array of questions to ask')
    })
    // No execute — this is a client-handled tool (requires user interaction)
  }),

  autoStyler: tool({
    description:
      'Automatically style all nodes and subgraphs in the diagram with harmonious grouped colors. Applies fill, border, and text colors. Use when the user asks to "make it colorful", "style the diagram", or "add colors".',
    inputSchema: z.object({
      palette: z
        .enum(['vibrant', 'pastel', 'earth', 'ocean', 'sunset', 'monochrome'])
        .optional()
        .describe('Color palette theme. Defaults to vibrant.'),
      preserveExisting: z
        .boolean()
        .optional()
        .describe('If true, only style nodes that have no existing style. Default false.')
    }),
    execute: async ({ palette = 'vibrant', preserveExisting = false }) => {
      const diagram = diagramStore.get(sessionId) || '';
      if (!diagram.trim()) {
        return { success: false, message: 'No diagram to style' };
      }

      // Check if diagram type supports style directives
      const firstLine = diagram.split('\n')[0]?.trim().split(/\s/)[0]?.toLowerCase() || '';
      const noStyleTypes = [
        'mindmap',
        'timeline',
        'pie',
        'gantt',
        'gitgraph',
        'sequencediagram',
        'erdiagram',
        'sankey',
        'packet',
        'quadrantchart',
        'xychart',
        'journey'
      ];
      if (noStyleTypes.includes(firstLine)) {
        return {
          success: false,
          message: `${firstLine} diagrams do not support style directives. Styling must be done through Mermaid theme configuration or by restructuring the diagram as a flowchart. You cannot add colors to ${firstLine} nodes with "style" lines.`
        };
      }

      const palettes: Record<string, { fill: string; stroke: string; text: string }[]> = {
        earth: [
          { fill: '#92400e', stroke: '#78350f', text: '#fef3c7' },
          { fill: '#065f46', stroke: '#064e3b', text: '#d1fae5' },
          { fill: '#7c2d12', stroke: '#6c2710', text: '#fed7aa' },
          { fill: '#1e3a5f', stroke: '#172554', text: '#dbeafe' },
          { fill: '#713f12', stroke: '#5c3210', text: '#fef9c3' },
          { fill: '#4a1942', stroke: '#3b1336', text: '#fae8ff' }
        ],
        monochrome: [
          { fill: '#374151', stroke: '#1f2937', text: '#f9fafb' },
          { fill: '#6b7280', stroke: '#4b5563', text: '#f9fafb' },
          { fill: '#9ca3af', stroke: '#6b7280', text: '#111827' },
          { fill: '#d1d5db', stroke: '#9ca3af', text: '#111827' },
          { fill: '#1f2937', stroke: '#111827', text: '#f9fafb' },
          { fill: '#4b5563', stroke: '#374151', text: '#f9fafb' }
        ],
        ocean: [
          { fill: '#0ea5e9', stroke: '#0284c7', text: '#ffffff' },
          { fill: '#06b6d4', stroke: '#0891b2', text: '#ffffff' },
          { fill: '#14b8a6', stroke: '#0d9488', text: '#ffffff' },
          { fill: '#3b82f6', stroke: '#2563eb', text: '#ffffff' },
          { fill: '#6366f1', stroke: '#4f46e5', text: '#ffffff' },
          { fill: '#0369a1', stroke: '#075985', text: '#ffffff' }
        ],
        pastel: [
          { fill: '#c7d2fe', stroke: '#818cf8', text: '#312e81' },
          { fill: '#e0e7ff', stroke: '#818cf8', text: '#312e81' },
          { fill: '#99f6e4', stroke: '#2dd4bf', text: '#134e4a' },
          { fill: '#fde68a', stroke: '#fbbf24', text: '#78350f' },
          { fill: '#ddd6fe', stroke: '#a78bfa', text: '#4c1d95' },
          { fill: '#a5f3fc', stroke: '#22d3ee', text: '#164e63' },
          { fill: '#fecaca', stroke: '#f87171', text: '#7f1d1d' },
          { fill: '#bbf7d0', stroke: '#4ade80', text: '#14532d' }
        ],
        sunset: [
          { fill: '#ef4444', stroke: '#dc2626', text: '#ffffff' },
          { fill: '#f97316', stroke: '#ea580c', text: '#ffffff' },
          { fill: '#f59e0b', stroke: '#d97706', text: '#ffffff' },
          { fill: '#818cf8', stroke: '#6366f1', text: '#ffffff' },
          { fill: '#a855f7', stroke: '#9333ea', text: '#ffffff' },
          { fill: '#e11d48', stroke: '#be123c', text: '#ffffff' }
        ],
        vibrant: [
          { fill: '#6366f1', stroke: '#4f46e5', text: '#ffffff' },
          { fill: '#818cf8', stroke: '#6366f1', text: '#ffffff' },
          { fill: '#14b8a6', stroke: '#0d9488', text: '#ffffff' },
          { fill: '#f59e0b', stroke: '#d97706', text: '#ffffff' },
          { fill: '#8b5cf6', stroke: '#7c3aed', text: '#ffffff' },
          { fill: '#06b6d4', stroke: '#0891b2', text: '#ffffff' },
          { fill: '#ef4444', stroke: '#dc2626', text: '#ffffff' },
          { fill: '#22c55e', stroke: '#16a34a', text: '#ffffff' }
        ]
      };

      const colors = palettes[palette] || palettes.vibrant;
      const lines = diagram.split('\n');

      // Parse nodes: lines like "  NodeId[Label]" or "  NodeId(Label)" etc.
      const nodePattern = /^\s*([A-Za-z_][\w]*)\s*[[({<|]|^\s*([A-Za-z_][\w]*)\s*@\{/;
      const edgePattern = /(<-->|<-\.->|<==>|<---|-->|-\.->|==>|---)/;
      const nodeIds: string[] = [];
      const subgraphIds: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed.startsWith('%%') ||
          trimmed.startsWith('style ') ||
          trimmed.startsWith('classDef ') ||
          trimmed.startsWith('class ') ||
          trimmed.startsWith('linkStyle')
        )
          continue;
        if (trimmed.startsWith('subgraph ')) {
          const sgMatch = trimmed.match(/^subgraph\s+([A-Za-z_][\w]*)/);
          if (sgMatch) subgraphIds.push(sgMatch[1]);
          continue;
        }
        if (trimmed === 'end' || trimmed.startsWith('flowchart') || trimmed.startsWith('graph'))
          continue;

        // Extract node IDs from edge lines and definition lines
        const nodeMatch = trimmed.match(nodePattern);
        if (nodeMatch) {
          const id = nodeMatch[1] || nodeMatch[2];
          if (id && !nodeIds.includes(id)) nodeIds.push(id);
        }
        // Also extract from edge lines: A --> B
        if (edgePattern.test(trimmed)) {
          const parts = trimmed.split(edgePattern);
          for (const part of parts) {
            const idMatch = part.trim().match(/^([A-Za-z_][\w]*)/);
            if (idMatch && !edgePattern.test(idMatch[1]) && !nodeIds.includes(idMatch[1])) {
              nodeIds.push(idMatch[1]);
            }
          }
        }
      }

      // Remove existing style lines if not preserving
      let cleanedLines = lines;
      if (!preserveExisting) {
        cleanedLines = lines.filter((l) => {
          const t = l.trim();
          return !t.startsWith('style ') && !t.startsWith('classDef ') && !t.startsWith('class ');
        });
      }

      // Assign colors: group nodes by subgraph membership or sequentially
      const styleLines: string[] = [];
      let colorIdx = 0;
      for (const nodeId of nodeIds) {
        const c = colors[colorIdx % colors.length];
        styleLines.push(
          `    style ${nodeId} fill:${c.fill},stroke:${c.stroke},stroke-width:2px,color:${c.text}`
        );
        colorIdx++;
      }

      // Style subgraphs
      const sgFills = [
        { fill: '#f0f0ff', stroke: '#6366f1' },
        { fill: '#eef2ff', stroke: '#6366f1' },
        { fill: '#f0fdfa', stroke: '#14b8a6' },
        { fill: '#fffbeb', stroke: '#f59e0b' },
        { fill: '#faf5ff', stroke: '#8b5cf6' },
        { fill: '#ecfeff', stroke: '#06b6d4' }
      ];
      for (let i = 0; i < subgraphIds.length; i++) {
        const sf = sgFills[i % sgFills.length];
        styleLines.push(
          `    style ${subgraphIds[i]} fill:${sf.fill},stroke:${sf.stroke},stroke-width:2px`
        );
      }

      const newDiagram = cleanedLines.join('\n') + '\n' + styleLines.join('\n');
      diagramStore.set(sessionId, newDiagram);

      return {
        content: newDiagram,
        nodesStyled: nodeIds.length,
        palette,
        subgraphsStyled: subgraphIds.length,
        success: true,
        summary: `Styled ${nodeIds.length} nodes and ${subgraphIds.length} subgraphs with ${palette} palette`
      };
    }
  }),

  codePatch: tool({
    description:
      'Patch the current non-Mermaid code artifact by replacing a 1-based line range. Use for JSON, YAML, TypeScript, JavaScript, CSS, HTML, config, and other code. Never use this for Mermaid diagrams.',
    inputSchema: z.object({
      content: z.string().min(1).describe('Replacement code for the selected line range'),
      endLine: z.number().int().min(1).describe('1-based ending line number'),
      language: z
        .enum([
          'json',
          'yaml',
          'typescript',
          'javascript',
          'svelte',
          'html',
          'css',
          'markdown',
          'text'
        ])
        .optional()
        .describe('Language of the code artifact'),
      startLine: z.number().int().min(1).describe('1-based starting line number')
    }),
    execute: async ({ startLine, endLine, content, language }) => {
      const current = codeStore.get(sessionId) || '';
      const lines = current.split('\n');

      if (startLine > endLine) {
        return {
          success: false,
          error: `startLine (${startLine}) cannot exceed endLine (${endLine})`
        };
      }
      if (!current.trim()) {
        return { success: false, error: 'No code artifact exists yet. Use codeWrite first.' };
      }
      if (endLine > lines.length) {
        return {
          success: false,
          error: `endLine ${endLine} exceeds artifact length (${lines.length})`
        };
      }

      const unescapedContent = content.replace(/\\n/g, '\n');
      lines.splice(startLine - 1, endLine - startLine + 1, ...unescapedContent.split('\n'));
      const nextCode = lines.join('\n');
      const validation = validateCodeArtifact(nextCode, language ?? detectCodeLanguage(nextCode));
      if (!validation.valid) return { success: false, error: validation.error };

      codeStore.set(sessionId, nextCode);
      return {
        content: nextCode,
        language: language ?? detectCodeLanguage(nextCode),
        lines: nextCode.split('\n').length,
        success: true
      };
    }
  }),

  codeRead: tool({
    description:
      'Read the current code artifact content for JSON, YAML, TypeScript, JavaScript, CSS, HTML, config, or other non-Mermaid code. Use this before patching generated code artifacts.',
    inputSchema: z.object({
      endLine: z.number().int().min(1).optional().describe('Optional 1-based end line'),
      startLine: z.number().int().min(1).optional().describe('Optional 1-based start line')
    }),
    execute: async ({ startLine, endLine } = {}) => {
      const code = codeStore.get(sessionId) || '';
      const lines = code.split('\n');

      if (!code.trim()) {
        return { content: '', isPartial: false, readFrom: 1, readTo: 0, totalLines: 0 };
      }

      const totalLines = lines.length;
      const from = startLine ? Math.max(1, Math.min(startLine, totalLines)) : 1;
      const to = endLine ? Math.max(from, Math.min(endLine, totalLines)) : totalLines;
      const isPartial = from !== 1 || to !== totalLines;

      return {
        content: isPartial ? lines.slice(from - 1, to).join('\n') : code,
        isPartial,
        language: detectCodeLanguage(code),
        readFrom: from,
        readTo: to,
        totalLines
      };
    }
  }),

  codeWrite: tool({
    description:
      'Create or replace a non-Mermaid code artifact. Use for JSON, YAML, TypeScript, JavaScript, Svelte, HTML, CSS, config, and plaintext code. This does not write to the repository filesystem.',
    inputSchema: z.object({
      content: z.string().min(1).describe('Complete code artifact content'),
      language: z
        .enum([
          'json',
          'yaml',
          'typescript',
          'javascript',
          'svelte',
          'html',
          'css',
          'markdown',
          'text'
        ])
        .describe('Language of the code artifact'),
      purpose: z.string().optional().describe('Short reason for creating this code artifact')
    }),
    execute: async ({ content, language, purpose }) => {
      const unescapedContent = content.replace(/\\n/g, '\n');
      const validation = validateCodeArtifact(unescapedContent, language);
      if (!validation.valid) return { success: false, error: validation.error };

      codeStore.set(sessionId, unescapedContent);
      return {
        content: unescapedContent,
        language,
        lines: unescapedContent.split('\n').length,
        purpose,
        success: true
      };
    }
  }),

  dataAnalyzer: tool({
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
  }),

  diagramDelete: tool({
    description: 'Clear the entire diagram',
    inputSchema: z.object({}),
    execute: async () => {
      diagramStore.set(sessionId, '');
      return { success: true, content: '' };
    }
  }),

  diagramPatch: tool({
    description:
      'Apply a patch to the diagram by replacing lines from startLine to endLine with new content. ONLY Mermaid diagram syntax is allowed. Do NOT write markdown, documentation, or prose here.',
    inputSchema: z.object({
      startLine: z.number().int().min(1).describe('1-based starting line number'),
      endLine: z.number().int().min(1).describe('1-based ending line number'),
      content: z.string().describe('New Mermaid diagram content to replace the specified lines')
    }),
    execute: async ({ startLine, endLine, content }) => {
      // Validate: reject markdown/prose content
      const markdownSignals = /^(#{1,6}\s|\*\*|__|\[.*\]\(.*\)|^>\s|^-{3,}$|^\*{3,}$|^```)/m;
      if (markdownSignals.test(content)) {
        return {
          error:
            'REJECTED: Content appears to be markdown/documentation, not Mermaid diagram syntax. Use markdownWrite for documentation. Redo with valid Mermaid code only.',
          hint: 'diagramPatch only accepts Mermaid diagram syntax (graph, flowchart, sequenceDiagram, etc.)'
        };
      }

      const diagram = diagramStore.get(sessionId) || '';
      const lines = diagram.split('\n');

      if (startLine > endLine) {
        return { error: `startLine (${startLine}) cannot exceed endLine (${endLine})` };
      }
      if (endLine > lines.length) {
        return { error: `endLine ${endLine} exceeds diagram length (${lines.length} lines)` };
      }

      // Unescape \n to actual newlines
      const unescapedContent = content.replace(/\\n/g, '\n');
      lines.splice(startLine - 1, endLine - startLine + 1, ...unescapedContent.split('\n'));
      const newDiagram = lines.join('\n');
      const validation = validateSingleMermaidDocument(newDiagram);
      if (!validation.valid) {
        return {
          error: validation.error,
          hint: validation.hint
        };
      }

      diagramStore.set(sessionId, newDiagram);

      return { success: true, newLineCount: lines.length, content: newDiagram };
    }
  }),

  diagramRead: tool({
    description:
      'Read the current Mermaid diagram content. Optionally read a specific range of lines. The client will validate syntax using the real Mermaid parser. ALWAYS call this first before making changes.',
    inputSchema: z.object({
      startLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Optional 1-based start line to read from'),
      endLine: z.number().int().min(1).optional().describe('Optional 1-based end line to read to')
    }),
    execute: async ({ startLine, endLine } = {}) => {
      const diagram = diagramStore.get(sessionId) || '';
      const allLines = diagram.split('\n');
      const totalLines = allLines.length;

      if (diagram.trim().length === 0) {
        return {
          content: '',
          isPartial: false,
          readFrom: 1,
          readTo: 0,
          totalLines: 0
        };
      }

      // Determine read range
      const from = startLine ? Math.max(1, Math.min(startLine, totalLines)) : 1;
      const to = endLine ? Math.max(from, Math.min(endLine, totalLines)) : totalLines;
      const isPartial = from !== 1 || to !== totalLines;

      const readContent = isPartial ? allLines.slice(from - 1, to).join('\n') : diagram;

      return {
        content: readContent,
        isPartial,
        readFrom: from,
        readTo: to,
        totalLines
      };
    }
  }),

  diagramWrite: tool({
    description:
      'Replace the entire diagram with new content. ONLY Mermaid diagram syntax is allowed. Do NOT write markdown, documentation, or prose here.',
    inputSchema: z.object({
      content: z
        .string()
        .describe(
          'Complete new Mermaid diagram content — must start with a valid diagram type (graph, flowchart, sequenceDiagram, classDiagram, etc.)'
        )
    }),
    execute: async ({ content }) => {
      // Unescape \n to actual newlines
      const unescapedContent = content.replace(/\\n/g, '\n');
      const trimmed = unescapedContent.trim();

      // Validate: must be one complete Mermaid document with one diagram root
      const validation = validateSingleMermaidDocument(trimmed);
      if (!validation.valid) {
        return {
          error: validation.error,
          hint: validation.hint
        };
      }

      // Validate: reject if content looks like markdown
      const markdownSignals = /^(#{1,6}\s|\*\*|__|\[.*\]\(.*\)|^>\s|^-{3,}$|^\*{3,}$|^```)/m;
      if (markdownSignals.test(trimmed)) {
        return {
          error:
            'REJECTED: Content contains markdown formatting. Use markdownWrite for documentation. Redo with pure Mermaid diagram syntax only.',
          hint: 'diagramWrite only accepts Mermaid diagram syntax.'
        };
      }

      diagramStore.set(sessionId, unescapedContent);
      return {
        success: true,
        lines: unescapedContent.split('\n').length,
        content: unescapedContent
      };
    }
  }),

  errorChecker: tool({
    description:
      'Validate the current Mermaid diagram syntax. Returns any syntax errors found. Use this when the user reports rendering issues or after making complex edits.',
    inputSchema: z.object({}),
    execute: async () => {
      const diagram = diagramStore.get(sessionId) || '';
      if (!diagram.trim()) {
        return { success: true, valid: true, errors: [], message: 'No diagram to validate' };
      }

      const errors: { line: number; message: string }[] = [];
      const lines = diagram.split('\n');
      const singleDocumentValidation = validateSingleMermaidDocument(diagram);
      if (!singleDocumentValidation.valid) {
        const declaration = findMermaidDeclarations(diagram)[1];
        errors.push({
          line: declaration?.line ?? 1,
          message: `${singleDocumentValidation.error} ${singleDocumentValidation.hint}`
        });
      }

      // Basic syntax checks
      const firstLine = lines[0]?.trim() || '';
      const validStarts = [
        'graph',
        'flowchart',
        'sequenceDiagram',
        'classDiagram',
        'stateDiagram',
        'erDiagram',
        'gantt',
        'pie',
        'gitgraph',
        'mindmap',
        'timeline',
        'quadrantChart',
        'xychart',
        'block',
        'sankey',
        'packet',
        'kanban',
        'architecture'
      ];
      if (!validStarts.some((s) => firstLine.startsWith(s))) {
        errors.push({
          line: 1,
          message: `Diagram must start with a valid type declaration (e.g. flowchart TD, sequenceDiagram)`
        });
      }

      // Detect diagram type for type-specific validation
      const diagramType = firstLine.split(/\s/)[0]?.toLowerCase() || '';

      // Diagram types that do NOT support style/classDef directives
      const noStyleTypes = [
        'mindmap',
        'timeline',
        'pie',
        'gantt',
        'gitgraph',
        'sequencediagram',
        'erdiagram',
        'sankey',
        'packet',
        'quadrantchart',
        'xychart',
        'journey'
      ];
      const supportsStyle = !noStyleTypes.includes(diagramType);

      // Check for style directives in diagram types that don't support them
      if (!supportsStyle) {
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (
            trimmed.startsWith('style ') ||
            trimmed.startsWith('classDef ') ||
            trimmed.startsWith('class ') ||
            trimmed.startsWith('linkStyle')
          ) {
            errors.push({
              line: i + 1,
              message: `"${trimmed.split(' ')[0]}" directives are not supported in ${diagramType} diagrams. Remove this line.`
            });
          }
        }
      }

      // Check subgraph/end pairing (only for types that use subgraphs)
      if (['graph', 'flowchart', 'block'].includes(diagramType)) {
        let subgraphCount = 0;
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (trimmed.startsWith('subgraph ')) subgraphCount++;
          if (trimmed === 'end') subgraphCount--;
          if (subgraphCount < 0) {
            errors.push({ line: i + 1, message: 'Unexpected "end" without matching subgraph' });
            subgraphCount = 0;
          }
        }
        if (subgraphCount > 0) {
          errors.push({
            line: lines.length,
            message: `${subgraphCount} unclosed subgraph(s) — missing "end"`
          });
        }
      }

      // Check for common syntax issues
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.includes('-->') && trimmed.match(/-->\s*$/)) {
          errors.push({ line: i + 1, message: 'Arrow "-->" has no target node' });
        }
        // Unmatched brackets (skip comment lines and style lines)
        if (
          !trimmed.startsWith('%%') &&
          !trimmed.startsWith('//') &&
          !trimmed.startsWith('style ')
        ) {
          const opens = (trimmed.match(/\[/g) || []).length;
          const closes = (trimmed.match(/\]/g) || []).length;
          if (opens !== closes) {
            errors.push({ line: i + 1, message: 'Unmatched brackets [ ]' });
          }
        }
      }

      return {
        content: diagram,
        errors,
        message:
          errors.length === 0 ? 'Diagram syntax looks valid' : `Found ${errors.length} issue(s)`,
        success: true,
        valid: errors.length === 0
      };
    }
  }),

  fileManager: tool({
    description: `Manage uploaded files attached by the user. Use this to list, read, search, or delete files from the current session.

OPERATIONS:
- "list" — List all files uploaded in this session (names, types, sizes)
- "read" — Read the extracted text content of a specific file by fileId. Supports optional startChar/endChar for reading sections of large files.
- "search" — Search across all session files for a keyword/phrase. Returns matching excerpts.
- "delete" — Delete a file from the session store.
- "summary" — Get a summary of a specific file (first 500 chars + metadata).

WHEN TO USE:
- When the user asks about their uploaded files ("what files did I upload?", "show my files")
- When you need to reference content from a previously uploaded PDF or document
- When the user asks to find something in their uploaded files
- When the user wants to delete an uploaded file
- For large PDFs, use "read" with startChar/endChar to read specific sections instead of the full text`,
    inputSchema: z.object({
      endChar: z.number().optional().describe('End character position for partial read'),
      fileId: z.string().optional().describe('File ID (required for read, delete, summary)'),
      operation: z
        .enum(['list', 'read', 'search', 'delete', 'summary'])
        .describe('The file operation to perform'),
      query: z.string().optional().describe('Search query (required for search operation)'),
      startChar: z
        .number()
        .optional()
        .describe('Start character position for partial read (0-based)')
    }),
    execute: async ({ operation, fileId, startChar, endChar, query }) => {
      if (operation === 'list') {
        const files = await getSessionFiles(sessionId);
        if (files.length === 0) {
          return { success: true, files: [], message: 'No files uploaded in this session.' };
        }
        return {
          success: true,
          fileCount: files.length,
          files: files.map((f) => ({
            filename: f.filename,
            id: f.id,
            mediaType: f.mediaType,
            size: f.size,
            sizeFormatted:
              f.size > 1024 * 1024
                ? `${(f.size / (1024 * 1024)).toFixed(1)}MB`
                : `${(f.size / 1024).toFixed(1)}KB`,
            storedAt: new Date(f.storedAt).toISOString(),
            textLength: f.extractedText?.length || 0,
            type: f.type
          }))
        };
      }

      if (operation === 'read') {
        if (!fileId) return { success: false, error: 'fileId is required for read operation' };
        const file = await getFileById(fileId);
        if (!file) return { success: false, error: `File not found: ${fileId}` };

        let text = file.extractedText || '';
        const totalLength = text.length;

        // Support partial reads for large files
        if (startChar !== undefined || endChar !== undefined) {
          const from = startChar || 0;
          const to = endChar || text.length;
          text = text.slice(from, to);
          return {
            content: text,
            fileId: file.id,
            filename: file.filename,
            isPartial: true,
            readFrom: from,
            readTo: Math.min(to, totalLength),
            success: true,
            totalLength
          };
        }

        return {
          content: text,
          fileId: file.id,
          filename: file.filename,
          mediaType: file.mediaType,
          size: file.size,
          success: true,
          totalLength,
          type: file.type
        };
      }

      if (operation === 'search') {
        if (!query) return { success: false, error: 'query is required for search operation' };
        const files = await getSessionFiles(sessionId);
        const results: {
          fileId: string;
          filename: string;
          matches: { position: number; excerpt: string }[];
        }[] = [];

        const lowerQuery = query.toLowerCase();
        for (const file of files) {
          const extractedText = file.extractedText ?? '';
          const text = extractedText.toLowerCase();
          const matches: { position: number; excerpt: string }[] = [];
          let pos = 0;
          while ((pos = text.indexOf(lowerQuery, pos)) !== -1) {
            const start = Math.max(0, pos - 80);
            const end = Math.min(extractedText.length, pos + query.length + 80);
            matches.push({
              position: pos,
              excerpt:
                (start > 0 ? '...' : '') +
                extractedText.slice(start, end) +
                (end < extractedText.length ? '...' : '')
            });
            pos += query.length;
            if (matches.length >= 5) break; // Max 5 matches per file
          }
          if (matches.length > 0) {
            results.push({ fileId: file.id, filename: file.filename, matches });
          }
        }

        return {
          filesSearched: files.length,
          query,
          results,
          success: true,
          totalMatches: results.reduce((sum, r) => sum + r.matches.length, 0)
        };
      }

      if (operation === 'delete') {
        if (!fileId) return { success: false, error: 'fileId is required for delete operation' };
        const success = await deleteFile(fileId);
        if (!success) return { success: false, error: `File not found: ${fileId}` };
        return { success: true, message: `File ${fileId} deleted.` };
      }

      if (operation === 'summary') {
        if (!fileId) return { success: false, error: 'fileId is required for summary operation' };
        const file = await getFileById(fileId);
        if (!file) return { success: false, error: `File not found: ${fileId}` };

        const preview = (file.extractedText || '').slice(0, 500);
        return {
          fileId: file.id,
          filename: file.filename,
          mediaType: file.mediaType,
          preview: preview + (file.extractedText && file.extractedText.length > 500 ? '...' : ''),
          size: file.size,
          sizeFormatted:
            file.size > 1024 * 1024
              ? `${(file.size / (1024 * 1024)).toFixed(1)}MB`
              : `${(file.size / 1024).toFixed(1)}KB`,
          storedAt: new Date(file.storedAt).toISOString(),
          success: true,
          textLength: file.extractedText?.length || 0,
          type: file.type
        };
      }

      return { success: false, error: `Unknown operation: ${operation}` };
    }
  }),

  gitGuard: tool({
    description:
      'Check git safety before any repository file or docs mutation. Use this before planning codebase file edits. Reports dirty status and protected paths; does not modify files.',
    inputSchema: z.object({
      operation: z.enum(['status', 'protect-paths', 'preflight']).describe('Git guard operation'),
      paths: z.array(z.string()).optional().describe('Paths the agent wants to read or modify'),
      reason: z.string().optional().describe('Why these paths are needed')
    }),
    execute: async ({ operation, paths = [], reason }) => {
      try {
        const { stdout } = await execFileAsync('git', ['status', '--short'], {
          cwd: process.cwd(),
          timeout: 5000
        });
        const changedPaths = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.slice(3));
        const requestedDirtyPaths = paths.filter((requestedPath) =>
          changedPaths.some(
            (changedPath) =>
              changedPath === requestedPath ||
              changedPath.startsWith(`${requestedPath}/`) ||
              requestedPath.startsWith(`${changedPath}/`)
          )
        );

        return {
          changedPaths,
          clean: changedPaths.length === 0,
          operation,
          protectedPaths: requestedDirtyPaths,
          reason,
          requestedPaths: paths,
          requiresUserConfirmation: requestedDirtyPaths.length > 0,
          success: true
        };
      } catch (e) {
        return {
          error: e instanceof Error ? e.message : 'Unable to run git status',
          operation,
          requestedPaths: paths,
          success: false
        };
      }
    }
  }),

  iconifier: tool({
    description: `Post-processing tool that attaches visual icons to diagram nodes AFTER a diagram is created.

HOW IT WORKS:
- You provide a mode and optional node list. The tool automatically resolves the best icon for each node.
- Resolution order: (1) exact NodeID match against 2400+ local icons (AWS, Azure, GCP, K8s, Cisco, brands), (2) camelCase-split parts of NodeID, (3) node label text keywords, (4) Iconify web API fallback (200,000+ icons from logos, devicon, simple-icons, mdi, etc.)
- Icons are inserted as @{ img: "url" } annotations on the node line in the Mermaid code.
- The tool returns a summary showing which nodes got icons and which were skipped.

WHEN TO CALL:
- ALWAYS call with mode "all" immediately after creating any architecture/infrastructure/tech diagram.
- Call with mode "selective" when user asks to add icons to specific nodes.
- Call with mode "remove" when user wants icons removed.
- Do NOT call for simple flowcharts, sequence diagrams, or non-tech diagrams unless user asks.

CRITICAL FOR BEST RESULTS:
- NodeIDs MUST be real brand/product names (e.g. "React", "PostgreSQL", "Docker", "Nginx") — this is how icons are matched.
- Node labels should describe function (e.g. "Frontend App", "Primary Database") — NOT contain brand names.
- Example: React["Frontend Application"] NOT WebApp["React Frontend"]`,
    inputSchema: z.object({
      mode: z
        .enum(['all', 'selective', 'remove'])
        .describe(
          'all = attach icons to all nodes, selective = attach to specific nodes, remove = remove icons'
        ),
      nodes: z
        .array(z.string())
        .optional()
        .describe('Node IDs to attach icons to (for selective mode)'),
      removeAll: z.boolean().optional().describe('Remove all icons (for remove mode)'),
      removeFromNodes: z
        .array(z.string())
        .optional()
        .describe('Node IDs to remove icons from (for remove mode)')
    }),
    execute: async ({ mode, nodes: targetNodes, removeAll, removeFromNodes }) => {
      const diagram = diagramStore.get(sessionId) || '';
      if (!diagram.trim()) return { success: false, error: 'No diagram to iconify' };

      const lines = diagram.split('\n');
      const allNodes = parseMermaidNodes(diagram);
      interface IconResult {
        nodeId: string;
        nodeText: string;
        status: 'added' | 'removed' | 'skipped';
        iconId?: string;
        iconUrl?: string;
        confidence?: number;
      }
      const results: IconResult[] = [];

      if (mode === 'remove') {
        // Remove icons: strip @{ img: ... } from same line
        const removeSet = removeAll ? null : new Set(removeFromNodes || []);
        for (let i = lines.length - 1; i >= 0; i--) {
          const iconMatch = lines[i].match(/^(\s*[\w][\w]*\[[^\]]*\])\s*@\{\s*img:[^}]*\}/);
          if (iconMatch) {
            const nodeId = iconMatch[1].match(/\s*([\w][\w]*)\[/)?.[1];
            if (nodeId && (removeSet === null || removeSet.has(nodeId))) {
              lines[i] = iconMatch[1]; // Remove the @{...} part, keep the node definition
              results.push({ nodeId, nodeText: '', status: 'removed' });
            }
          }
        }
        const newDiagram = lines.join('\n');
        diagramStore.set(sessionId, newDiagram);
        return {
          content: newDiagram,
          mode: 'remove',
          results,
          success: true,
          summary: `Removed icons from ${results.length} node(s)`
        };
      }

      // Mode: all or selective — resolve and attach icons
      const nodesToProcess =
        mode === 'all' ? allNodes : allNodes.filter((n) => targetNodes?.includes(n.id));

      if (nodesToProcess.length === 0) {
        return { success: false, error: 'No matching nodes found in diagram' };
      }

      // Resolve icons for each node and apply as separate annotation lines
      let insertionOffset = 0;
      for (const node of nodesToProcess) {
        const result = await resolveIconForNode(node.id, node.text);
        if (result) {
          // Escape node.id for safe regex usage
          const escapedId = node.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          // Find the current line index for this node (may have shifted from previous insertions)
          let currentLineIndex = -1;
          for (let i = 0; i < lines.length; i++) {
            if (
              lines[i].includes(`${node.id}[`) ||
              lines[i].includes(`${node.id}(`) ||
              lines[i].match(new RegExp(`^\\s*${escapedId}\\s*\\[`))
            ) {
              currentLineIndex = i;
              break;
            }
          }
          if (currentLineIndex === -1) currentLineIndex = node.line + insertionOffset;

          const iconLine = `    ${node.id}@{ img: "${result.url}", pos: "b", w: 60, h: 60, constraint: "on" }`;

          // Check if an icon line already exists for this node and replace it
          const existingIconIndex = lines.findIndex(
            (line, idx) => idx > currentLineIndex && line.trim().startsWith(`${node.id}@{`)
          );
          if (existingIconIndex !== -1) {
            lines[existingIconIndex] = iconLine;
          } else {
            // Insert new icon line after the node definition
            lines.splice(currentLineIndex + 1, 0, iconLine);
            insertionOffset++;
          }

          results.push({
            confidence: result.confidence,
            iconId: result.iconId,
            iconUrl: result.url,
            nodeId: node.id,
            nodeText: node.text,
            status: 'added'
          });
        } else {
          results.push({ nodeId: node.id, nodeText: node.text, status: 'skipped' });
        }
      }

      const newDiagram = lines.join('\n');
      diagramStore.set(sessionId, newDiagram);

      const addedCount = results.filter((r) => r.status === 'added').length;
      const skippedCount = results.filter((r) => r.status === 'skipped').length;

      return {
        content: newDiagram,
        mode,
        results,
        success: true,
        summary: `Iconified ${addedCount} node(s)${skippedCount > 0 ? `, ${skippedCount} skipped (below 90% confidence)` : ''}`
      };
    }
  }),

  longTermMemory: tool({
    description: `Store and retrieve long-term memories about the user's preferences, past work, and context. Memories persist across sessions.

OPERATIONS:
- "save" — Save a new memory with a key and value. Overwrites if key exists.
- "get" — Retrieve a specific memory by key.
- "list" — List all saved memory keys.
- "delete" — Delete a specific memory.
- "search" — Search memories by keyword in keys and values.

WHEN TO USE:
- When the user says "remember that..." or "keep in mind..."
- When you notice recurring preferences (preferred diagram style, colors, naming conventions)
- When the user asks "do you remember..." or "what did I say about..."
- To store project context that should persist across conversations`,
    inputSchema: z.object({
      operation: z.enum(['save', 'get', 'list', 'delete', 'search']).describe('Memory operation'),
      key: z.string().optional().describe('Memory key (required for save, get, delete)'),
      value: z.string().optional().describe('Memory value (required for save)'),
      query: z.string().optional().describe('Search query (required for search)')
    }),
    execute: async ({ operation, key, value, query }) => {
      const memoryKey = `memory_${sessionId}`;
      const stored = memoryStore.get(memoryKey) || '{}';
      let memories: Record<string, { value: string; savedAt: string }> = {};
      try {
        memories = JSON.parse(stored);
      } catch {
        /* ignore */
      }

      switch (operation) {
        case 'save': {
          if (!key || !value) return { success: false, error: 'key and value required for save' };
          memories[key] = { value, savedAt: new Date().toISOString() };
          memoryStore.set(memoryKey, JSON.stringify(memories));
          return {
            success: true,
            message: `Remembered: "${key}"`,
            totalMemories: Object.keys(memories).length
          };
        }
        case 'get': {
          if (!key) return { success: false, error: 'key required for get' };
          const mem = memories[key];
          if (!mem) return { success: false, error: `No memory found for key: "${key}"` };
          return { success: true, key, value: mem.value, savedAt: mem.savedAt };
        }
        case 'list': {
          const keys = Object.keys(memories);
          return {
            success: true,
            totalMemories: keys.length,
            memories: keys.map((k) => ({
              key: k,
              preview: memories[k].value.slice(0, 80),
              savedAt: memories[k].savedAt
            }))
          };
        }
        case 'delete': {
          if (!key) return { success: false, error: 'key required for delete' };
          if (!memories[key]) return { success: false, error: `No memory found for key: "${key}"` };
          memories = Object.fromEntries(Object.entries(memories).filter(([k]) => k !== key));
          memoryStore.set(memoryKey, JSON.stringify(memories));
          return {
            success: true,
            message: `Forgot: "${key}"`,
            totalMemories: Object.keys(memories).length
          };
        }
        case 'search': {
          if (!query) return { success: false, error: 'query required for search' };
          const q = query.toLowerCase();
          const results = Object.entries(memories)
            .filter(([k, v]) => k.toLowerCase().includes(q) || v.value.toLowerCase().includes(q))
            .map(([k, v]) => ({ key: k, value: v.value, savedAt: v.savedAt }));
          return { success: true, query, resultCount: results.length, results };
        }
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    }
  }),

  markdownRead: tool({
    description:
      'Read the current content from the markdown/document editor panel. Use this to see what documentation the user has written.',
    inputSchema: z.object({}),
    execute: async () => {
      const markdown = markdownStore.get(sessionId) || '';
      return {
        content: markdown,
        length: markdown.length,
        lines: markdown.split('\n').length
      };
    }
  }),

  markdownWrite: tool({
    description:
      'Write or replace content in the markdown/document editor panel. Use this ONLY for documentation, notes, or explanations. Do NOT write Mermaid diagram code here — use diagramWrite for that.',
    inputSchema: z.object({
      content: z
        .string()
        .describe(
          'The markdown/documentation content to write. Must NOT be Mermaid diagram syntax.'
        ),
      append: z
        .boolean()
        .optional()
        .describe('If true, append to existing content instead of replacing')
    }),
    execute: async ({ content, append }) => {
      // Validate: reject if content looks like a Mermaid diagram
      const trimmed = content.trim();
      const mermaidDiagramTypes =
        /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|kanban|gitGraph|gitgraph|quadrantChart|xyChart|xychart|sankey|block|packet|architecture|C4Context|C4Container|C4Component|C4Deployment|requirementDiagram|zenuml)\b/i;
      if (mermaidDiagramTypes.test(trimmed)) {
        return {
          error:
            'REJECTED: Content appears to be Mermaid diagram code, not markdown documentation. Use diagramWrite to write diagram code. Use markdownWrite ONLY for documentation/prose.',
          hint: 'markdownWrite is for documentation only. Use diagramWrite for Mermaid diagrams.'
        };
      }

      const existing = markdownStore.get(sessionId) || '';
      const newContent = append ? (existing ? existing + '\n\n' + content : content) : content;
      markdownStore.set(sessionId, newContent);
      return {
        success: true,
        content: newContent,
        lines: newContent.split('\n').length
      };
    }
  }),

  planWithProgress: tool({
    description: `Create and manage a visible plan with progress tracking. The plan is shown to the user as a checklist that updates in real-time as steps are completed.

OPERATIONS:
- "create" — Create a new plan with steps. Each step has an id, title, and optional description.
- "update" — Update a step's status to "pending", "in_progress", "done", or "skipped".
- "get" — Get the current plan and all step statuses.

WHEN TO USE:
- When the user asks for something complex that requires multiple steps
- When you want to show the user your progress on a multi-step task
- After creating a plan, update each step as you work through it
- Always create a plan before starting complex diagram creation tasks`,
    inputSchema: z.object({
      message: z.string().optional().describe('Progress message (for update)'),
      operation: z.enum(['create', 'update', 'get']).describe('Plan operation'),
      status: z
        .enum(['pending', 'in_progress', 'done', 'skipped'])
        .optional()
        .describe('New status (for update)'),
      stepId: z.string().optional().describe('Step ID to update (for update)'),
      steps: z
        .array(
          z.object({
            id: z.string().describe('Step ID like step1, step2'),
            title: z.string().describe('Step title'),
            description: z.string().optional().describe('Step description')
          })
        )
        .optional()
        .describe('Plan steps (for create)'),
      title: z.string().optional().describe('Plan title (for create)')
    }),
    execute: async ({ operation, title, steps, stepId, status, message }) => {
      const planKey = `plan_${sessionId}`;
      let plan: {
        title: string;
        createdAt: string;
        steps: {
          id: string;
          title: string;
          description: string;
          status: string;
          message: string;
          updatedAt: string;
        }[];
      } | null = null;
      try {
        const stored = planStore.get(planKey);
        if (stored) plan = JSON.parse(stored);
      } catch {
        /* ignore */
      }

      switch (operation) {
        case 'create': {
          if (!title || !steps || steps.length === 0)
            return { success: false, error: 'title and steps required for create' };
          plan = {
            title,
            createdAt: new Date().toISOString(),
            steps: steps.map((s) => ({
              description: s.description || '',
              id: s.id,
              message: '',
              status: 'pending' as const,
              title: s.title,
              updatedAt: new Date().toISOString()
            }))
          };
          planStore.set(planKey, JSON.stringify(plan));
          return {
            success: true,
            plan,
            message: `Plan created: "${title}" with ${steps.length} steps`
          };
        }
        case 'update': {
          if (!plan) return { success: false, error: 'No active plan. Create one first.' };
          if (!stepId || !status)
            return { success: false, error: 'stepId and status required for update' };
          const step = plan.steps.find((s) => s.id === stepId);
          if (!step) return { success: false, error: `Step not found: ${stepId}` };
          step.status = status;
          step.message = message || '';
          step.updatedAt = new Date().toISOString();
          planStore.set(planKey, JSON.stringify(plan));
          const done = plan.steps.filter((s) => s.status === 'done').length;
          const total = plan.steps.length;
          return {
            success: true,
            plan,
            progress: `${done}/${total} steps done`,
            stepUpdated: stepId
          };
        }
        case 'get': {
          if (!plan) return { success: false, error: 'No active plan.' };
          const done = plan.steps.filter((s) => s.status === 'done').length;
          return { success: true, plan, progress: `${done}/${plan.steps.length} steps done` };
        }
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    }
  }),

  planner: tool({
    description:
      'Decompose a complex task into a step-by-step plan. Use this when the user asks for something complex that requires multiple steps (e.g. "Create architecture diagram for RAG system"). Returns a structured plan that you should execute step-by-step using other tools.',
    inputSchema: z.object({
      task: z.string().describe('The user task to decompose into steps'),
      context: z
        .string()
        .optional()
        .describe('Additional context about the current state (diagram, document, etc.)')
    }),
    execute: async ({ task, context }) => {
      const diagram = diagramStore.get(sessionId) || '';
      const markdown = markdownStore.get(sessionId) || '';

      return {
        context: context || '',
        currentState: {
          hasDiagram: diagram.trim().length > 0,
          diagramLines: diagram.split('\n').length,
          hasDocument: markdown.trim().length > 0,
          documentLines: markdown.split('\n').length
        },
        instruction:
          'Analyze the task and create a step-by-step plan. For each step, identify which tool to use. Then execute the plan step-by-step, calling the appropriate tools. After completing all steps, summarize what was done.',
        success: true,
        task
      };
    }
  }),

  selfCritique: tool({
    description:
      'Evaluate and improve the current diagram or document. Reviews the content for quality, completeness, best practices, and potential issues. Use after creating or editing a diagram to ensure quality, or when the user asks to "review", "improve", or "critique" the work.',
    inputSchema: z.object({
      target: z
        .enum(['diagram', 'document', 'both'])
        .describe('What to critique: diagram, document, or both'),
      criteria: z
        .array(
          z.enum([
            'completeness',
            'clarity',
            'best-practices',
            'accessibility',
            'complexity',
            'naming'
          ])
        )
        .optional()
        .describe('Specific criteria to evaluate. Defaults to all.')
    }),
    execute: async ({ target, criteria }) => {
      const diagram = diagramStore.get(sessionId) || '';
      const markdown = markdownStore.get(sessionId) || '';
      const evalCriteria = criteria || [
        'completeness',
        'clarity',
        'best-practices',
        'accessibility',
        'complexity',
        'naming'
      ];

      const result: Record<string, unknown> = {
        success: true,
        criteria: evalCriteria,
        instruction:
          'Evaluate the content against each criterion. For each, provide: (1) a score 1-5, (2) specific issues found, (3) concrete improvement suggestions. Then apply the top 3 most impactful improvements automatically using the appropriate tools. Summarize what was improved.'
      };

      if (target === 'diagram' || target === 'both') {
        if (!diagram.trim()) {
          result.diagram = { error: 'No diagram to critique' };
        } else {
          const lines = diagram.split('\n');
          const nodes = parseMermaidNodes(diagram);
          const review = buildDiagramReview(diagram);
          result.summary = review.summary;
          result.improvements = review.improvements;
          result.diagram = {
            content: diagram,
            hasComments: lines.some((l: string) => l.trim().startsWith('%%')),
            hasIcons: lines.some((l: string) => l.includes('@{')),
            hasStyles: lines.some((l: string) => l.trim().startsWith('style ')),
            hasSubgraphs: lines.some((l: string) => l.trim().startsWith('subgraph ')),
            lineCount: lines.length,
            nodeCount: nodes.length
          };
        }
      }

      if (target === 'document' || target === 'both') {
        if (!markdown.trim()) {
          result.document = { error: 'No document to critique' };
        } else {
          result.document = {
            content: markdown,
            hasCodeBlocks: /```/.test(markdown),
            hasHeadings: /^#{1,6}\s/m.test(markdown),
            hasLists: /^[-*]\s/m.test(markdown),
            lineCount: markdown.split('\n').length,
            wordCount: markdown.split(/\s+/).length
          };
        }
      }

      return result;
    }
  }),

  sequentialThinking: tool({
    description: `Think through a problem step-by-step before acting. Use this for complex reasoning, analysis, or when you need to break down a problem before creating a diagram.

This tool lets you record your thought process visibly to the user, showing them your reasoning chain. Each thought builds on the previous one.

WHEN TO USE:
- Before creating complex architecture diagrams (think about components, relationships, data flow)
- When analyzing requirements or trade-offs
- When the user asks "how would you approach..." or "what's the best way to..."
- For debugging complex diagram issues
- When you need to reason about multiple options before choosing one`,
    inputSchema: z.object({
      thought: z.string().describe('Your current thought/reasoning step'),
      thoughtNumber: z.number().int().min(1).describe('Current thought number (1, 2, 3...)'),
      totalThoughts: z.number().int().min(1).describe('Estimated total thoughts needed'),
      nextAction: z.string().optional().describe('What you plan to do next based on this thought')
    }),
    execute: async ({ thought, thoughtNumber, totalThoughts, nextAction }) => {
      return {
        isComplete: thoughtNumber >= totalThoughts,
        nextAction: nextAction || '',
        success: true,
        thought,
        thoughtNumber,
        totalThoughts
      };
    }
  }),

  subagentAssemble: tool({
    description:
      'Assemble planned subagent outputs into a single integration plan. Use after subagentFanout. Produces ordered changes, conflict notes, and verification steps; does not mutate files.',
    inputSchema: z.object({
      outputs: z.array(
        z.object({
          agentId: z.string().min(1),
          changedPaths: z.array(z.string()).optional(),
          summary: z.string().min(1)
        })
      ),
      runId: z.string().min(1),
      verification: z.array(z.string()).optional()
    }),
    execute: async ({ runId, outputs, verification = [] }) => {
      return {
        integrationPlan: outputs.map((output, index) => ({
          order: index + 1,
          ...output
        })),
        nextRequiredAction:
          'Continue after assembly: execute the next concrete tool step, ask for missing confirmation, or clearly state the blocker. Do not stop at assembly alone.',
        runId,
        success: true,
        verification,
        warning:
          'Assembly is advisory only. File writes require explicit repository write tooling and gitGuard preflight.'
      };
    }
  }),

  subagentFanout: tool({
    description:
      'Run a bounded multi-agent fanout for complex work. Creates specialist assignments, executes lightweight parallel specialist LLM calls, and returns concrete subagent outputs for assembly. This does not mutate files.',
    inputSchema: z.object({
      agents: z
        .array(
          z.object({
            allowedTools: z.array(z.string()).optional(),
            id: z.string().min(1),
            objective: z.string().min(1),
            ownedPaths: z.array(z.string()).optional(),
            role: z.enum([
              'planner',
              'diagram-engineer',
              'visual-polish',
              'research-agent',
              'document-agent',
              'data-agent',
              'critic',
              'code-agent'
            ])
          })
        )
        .min(1),
      task: z.string().min(1)
    }),
    execute: async ({ task, agents }) => {
      const runId = crypto.randomUUID();
      const runStartedAt = new Date();
      const assignments = agents.map((agent) => ({
        ...agent,
        guardrails: [
          'Do not modify files outside ownedPaths.',
          'Do not overwrite dirty user changes.',
          'Return a patch or artifact summary before assembly.'
        ],
        status: 'planned'
      }));

      const agentOutputs = await Promise.all(
        assignments.map(async (agent) => {
          const startedAt = new Date();
          const system = instructionsForSubagent(agent.role);
          const prompt = [
            `Task: ${task}`,
            `Specialist objective: ${agent.objective}`,
            agent.ownedPaths?.length ? `Owned paths: ${agent.ownedPaths.join(', ')}` : '',
            agent.allowedTools?.length ? `Allowed tools: ${agent.allowedTools.join(', ')}` : '',
            'Return: concise findings, proposed concrete output, and any blocker.'
          ]
            .filter(Boolean)
            .join('\n');

          if (!modelId) {
            const completedAt = new Date();
            return {
              agentId: agent.id,
              allowedTools: agent.allowedTools || [],
              completedAt: completedAt.toISOString(),
              durationMs: completedAt.getTime() - startedAt.getTime(),
              events: [
                { at: startedAt.toISOString(), label: 'Queued specialist assignment' },
                { at: completedAt.toISOString(), label: 'Failed: no model available' }
              ],
              objective: agent.objective,
              output: 'No model was available for specialist execution.',
              prompt,
              role: agent.role,
              startedAt: startedAt.toISOString(),
              status: 'failed'
            };
          }

          try {
            const result = await generateText({
              maxOutputTokens: 900,
              model: openrouterFastChat(modelId),
              prompt,
              system,
              temperature: 0.45
            });
            const completedAt = new Date();

            return {
              agentId: agent.id,
              allowedTools: agent.allowedTools || [],
              completedAt: completedAt.toISOString(),
              durationMs: completedAt.getTime() - startedAt.getTime(),
              events: [
                { at: startedAt.toISOString(), label: 'Queued specialist assignment' },
                { at: startedAt.toISOString(), label: `Started ${agent.role}` },
                { at: completedAt.toISOString(), label: 'Returned specialist output' }
              ],
              modelId,
              objective: agent.objective,
              output: result.text,
              prompt,
              role: agent.role,
              startedAt: startedAt.toISOString(),
              status: 'completed'
            };
          } catch (e) {
            const completedAt = new Date();
            return {
              agentId: agent.id,
              allowedTools: agent.allowedTools || [],
              completedAt: completedAt.toISOString(),
              durationMs: completedAt.getTime() - startedAt.getTime(),
              events: [
                { at: startedAt.toISOString(), label: 'Queued specialist assignment' },
                { at: startedAt.toISOString(), label: `Started ${agent.role}` },
                { at: completedAt.toISOString(), label: 'Failed during specialist execution' }
              ],
              modelId,
              objective: agent.objective,
              output: e instanceof Error ? e.message : 'Subagent execution failed',
              prompt,
              role: agent.role,
              startedAt: startedAt.toISOString(),
              status: 'failed'
            };
          }
        })
      );

      subagentStore.set(
        `subagents_${sessionId}_${runId}`,
        JSON.stringify({ assignments, outputs: agentOutputs, task })
      );

      const runCompletedAt = new Date();

      return {
        assignments,
        completedAt: runCompletedAt.toISOString(),
        durationMs: runCompletedAt.getTime() - runStartedAt.getTime(),
        nextRequiredAction:
          'Continue after fanout: DO NOT call subagentFanout again. Use the completed specialist outputs to perform the concrete next tool step, call subagentAssemble, or ask one blocking question.',
        outputs: agentOutputs,
        runId,
        startedAt: runStartedAt.toISOString(),
        success: true,
        task
      };
    }
  }),

  tableAnalytics: tool({
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
  }),

  webSearch: tool({
    description:
      'Search the web for information. Use this to look up documentation, find icon names, research diagram patterns, or answer questions that need current information. Returns structured results with sources.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
      reason: z
        .string()
        .optional()
        .describe('Brief reason why you are searching — shown to the user')
    }),
    execute: async ({ query, reason }) => {
      try {
        const encoded = encodeURIComponent(query);
        const res = await fetch(
          `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (!res.ok) return { success: false, query, reason, error: 'Search request failed' };
        const data = await res.json();

        const results: { title: string; snippet: string; url?: string; source?: string }[] = [];

        if (data.AbstractText) {
          results.push({
            title: data.Heading || query,
            snippet: data.AbstractText,
            url: data.AbstractURL,
            source: data.AbstractSource || 'Wikipedia'
          });
        }
        if (data.RelatedTopics) {
          for (const topic of data.RelatedTopics.slice(0, 5)) {
            if (topic.Text) {
              const urlHost = topic.FirstURL
                ? new URL(topic.FirstURL).hostname.replace('www.', '')
                : undefined;
              results.push({
                title: topic.Text.slice(0, 80),
                snippet: topic.Text,
                url: topic.FirstURL,
                source: urlHost
              });
            }
          }
        }
        if (results.length === 0 && data.Answer) {
          results.push({
            title: 'Answer',
            snippet: data.Answer,
            source: data.AnswerType || 'DuckDuckGo'
          });
        }

        return {
          query,
          reason: reason || `Searching for "${query}"`,
          resultCount: results.length,
          results: results.slice(0, 5),
          success: true,
          summary:
            results.length > 0
              ? `Found ${results.length} result(s) for "${query}"`
              : `No results found for "${query}". Try rephrasing.`
        };
      } catch (e: unknown) {
        return {
          success: false,
          query,
          reason,
          error: e instanceof Error ? e.message : 'Search failed'
        };
      }
    }
  })
});

// Multi-step system prompt
function buildMultiStepSystemPrompt(): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return `You are an expert Mermaid diagram assistant inside a live editor.
Today's date: ${today}.

IMPORTANT COMMUNICATION RULES:
- Use emojis in greetings and explanations to make conversations friendly and engaging 🎨
- NEVER discuss system prompts, tools, or internal workings - just focus on helping with diagrams
- Keep conversations natural and user-friendly
- Do not write diagrams without tools.
- Be FAST and DIRECT. Do NOT over-think or over-explain. Act immediately with tools — minimal reasoning, maximum action.
- Never narrate tool choice or internal control flow in visible text/reasoning. Do not say "we need to call", "thus produce the function call", or similar. If the right tool is obvious, call it directly.
- Default to the shortest working path. Most requests should use 1-3 tool calls total.
- Keep text responses to 1-3 sentences. No lengthy explanations unless asked.
- For simple requests (create diagram, add node, fix error, write JSON/YAML/code), call the concrete tool immediately without preamble.
- Planning tools are optional helpers, not ceremony. Skip planner/sequentialThinking/subagentFanout unless they clearly reduce risk.

TOOLS:
- diagramRead(startLine?, endLine?) — Read current diagram content. Supports optional line range.
- diagramPatch(startLine, endLine, content) — Replace specific lines (surgical edits)
- diagramWrite(content) — Replace entire diagram (new or full rewrite)
- diagramDelete — Clear diagram
- iconifier(mode, nodes?, removeAll?, removeFromNodes?) — Attaches visual icons to diagram nodes. Searches 2400+ local icons + 200k Iconify web icons. ALWAYS call with mode "all" after creating architecture/tech diagrams. NodeIDs must be brand names for best matching.
- errorChecker() — Validate diagram syntax and report errors. Use when the user reports rendering issues.
- autoStyler(palette?, preserveExisting?) — Automatically style all nodes and subgraphs with harmonious colors. Palettes: vibrant, pastel, earth, ocean, sunset, monochrome. Use when user asks to "style", "colorize", or "make colorful". NOTE: autoStyler does NOT work on mindmap, timeline, pie, gantt, gitgraph, sequenceDiagram, erDiagram, sankey, or journey diagrams — these types do not support style directives. If the user asks to style one of these, explain the limitation and suggest converting to a flowchart first.
- markdownRead() — Read content from the markdown/document editor panel.
- markdownWrite(content, append?) — Write or append content to the markdown/document editor panel.
- codeRead(startLine?, endLine?) — Read the current non-Mermaid code artifact. Use for JSON, YAML, TypeScript, JavaScript, Svelte, HTML, CSS, config, and text code.
- codeWrite(content, language, purpose?) — Create or replace a non-Mermaid code artifact. Use for JSON, YAML, config files, TypeScript, JavaScript, Svelte, HTML, CSS, and code examples. This creates an artifact; it does NOT write to repository files.
- codePatch(startLine, endLine, content, language?) — Patch the current non-Mermaid code artifact by line range.
- webSearch(query) — Search the web for information, documentation, etc.
- askQuestions(context, questions) — Ask the user multiple-choice/multi-select questions to clarify requirements. Use when the request is ambiguous.
- planner(task, context?) — Decompose genuinely ambiguous or high-risk tasks into steps. Do NOT use for normal diagram creation if you can directly write the diagram.
- actionItemExtractor(source, text?, extractTypes?) — Extract action items, risks, KPIs, entities, decisions, deadlines from documents or text.
- tableAnalytics(source, data?, operations?) — Analyze CSV/tabular data: statistics, trends, outliers, chart suggestions. Can auto-generate Mermaid charts.
- selfCritique(target, criteria?) — Evaluate and improve diagrams/documents for quality, completeness, best practices. Auto-applies top improvements.
- fileManager(operation, fileId?, startChar?, endChar?, query?) — Manage uploaded files. Operations: "list" (show all files), "read" (read file content, supports partial reads for large files), "search" (find text across files), "delete" (remove file), "summary" (quick preview). Use when user asks about uploaded files or you need to reference attachment content.
- longTermMemory(operation, key?, value?, query?) — Store and retrieve persistent memories. Operations: "save" (store key-value), "get" (retrieve by key), "list" (show all), "delete" (remove), "search" (find by keyword). Use when user says "remember this" or asks "do you remember".
- planWithProgress(operation, title?, steps?, stepId?, status?, message?) — Create and track visible plans. Use only for long multi-step tasks where visible progress helps.
- sequentialThinking(thought, thoughtNumber, totalThoughts, nextAction?) — Think through hard trade-offs visibly. Use only when the user explicitly asks for deep reasoning or when the task is genuinely ambiguous/high-risk.
- gitGuard(operation, paths?, reason?) — Check git safety before repository file/docs mutation planning. Use before any codebase modification plan. It reports dirty/protected paths and never modifies files.
- subagentFanout(task, agents) — Run bounded specialist subagents in parallel for complex work. Use when the task needs parallel planning, research, code, docs, diagram, or review agents. It returns concrete specialist outputs but does not mutate files.
- subagentAssemble(runId, outputs, verification?) — Assemble subagent outputs into one integration plan with conflict notes and verification steps. It plans only and does not mutate files.

THINK HARDER / DEEP THINKING:
When the user says "think harder", "think more", "think deeply", "think step by step", "reason through this", or similar phrases requesting deeper analysis, use at most ONE planning/thinking tool first, then act. Keep visible reasoning short. Do not chain planner + sequentialThinking unless the user explicitly asks for a detailed plan.

WHEN TO USE TOOLS:
- Use diagram tools (diagramRead/diagramWrite/diagramPatch) ONLY for Mermaid diagram code.
- Use markdown tools (markdownRead/markdownWrite) ONLY for documentation, notes, and prose text.
- Use code tools (codeRead/codeWrite/codePatch) for JSON, YAML, TOML, TypeScript, JavaScript, Svelte, HTML, CSS, shell snippets, config files, and any non-Mermaid code artifact.
- If the user asks for JSON or YAML, call codeWrite with language "json" or "yaml". NEVER put JSON/YAML in diagramWrite. Use markdownWrite only if the user explicitly wants explanatory prose around it.
- For greetings ("hi", "hey", "hello"), casual chat, or general questions — just respond naturally WITHOUT calling any tools.
- If the user asks to create a NEW diagram from scratch, use diagramWrite directly (no need to read first).
- If the user asks to EDIT or FIX an existing diagram, call diagramRead first, then apply changes.
- If the user asks to modify repository files or docs, call gitGuard first with the target paths. Use subagentFanout/subagentAssemble only when multiple independent workstreams or path ownership matters.
- Use askQuestions when the user's request is vague or has multiple possible interpretations — ask 2-4 concise questions with clear options.
- Use webSearch when you need to look up information you're unsure about.
- When Fixing diagram or error, always read diagram first.

CRITICAL — TOOL SEPARATION (NEVER VIOLATE):
- diagramWrite/diagramPatch: ONLY Mermaid diagram syntax (graph TD, flowchart LR, sequenceDiagram, etc.). NEVER write markdown, documentation, or prose to diagram tools.
- Every Mermaid artifact must contain exactly ONE top-level diagram declaration. Do not prepend placeholder diagrams like "A[Start] --> B[New diagram]". Do not mix "flowchart TD" and "graph TD" in one artifact.
- markdownWrite: ONLY markdown documentation/prose. NEVER write Mermaid diagram code to markdownWrite.
- codeWrite/codePatch: ONLY non-Mermaid code artifacts such as JSON, YAML, config, TypeScript, JavaScript, Svelte, HTML, CSS, shell, or plaintext code. These tools do NOT write repository files.
- These three tool categories are COMPLETELY INDEPENDENT. Writing to one must NEVER trigger writing to another.
- If the user asks for BOTH a diagram AND documentation, call them as separate independent operations. Do NOT combine or mix content.
- After ANY diagram edit (diagramWrite or diagramPatch), ALWAYS call errorChecker() to validate the syntax.

GIT AND FILE SAFETY:
- Before planning repository file or docs changes, call gitGuard with the paths you expect to touch.
- Dirty/protected paths require explicit user confirmation before overwrite-style work.
- Subagents must own explicit, non-overlapping paths. If two subagents need the same path, assign one owner and make the other produce review notes only.
- Never delete, reset, or revert files. Never claim a repository mutation happened unless a real file-writing operation succeeded.
- Current code tools create in-chat artifacts only; they are safe for drafting JSON/YAML/code before repository writes exist.

WORKFLOW (for diagram edits only):
1. For new diagrams, call diagramWrite directly with exactly one Mermaid declaration followed by nodes/edges. For edits, call diagramRead first.
2. Apply the diagram with diagramWrite or diagramPatch
3. Call errorChecker() once
4. Only fix if errorChecker reports errors
5. Respond with a brief summary (1-2 sentences max)

WORKFLOW (for markdown/documentation):
1. Call markdownRead to see current content (if editing)
2. Use markdownWrite to create or update documentation
3. Respond with a brief summary of what was written
4. Do NOT call any diagram tools as part of this workflow unless the user explicitly asked for diagram changes too

WORKFLOW (for JSON/YAML/code artifacts):
1. Use codeRead if editing an existing artifact
2. Use codeWrite for a full artifact or codePatch for a local edit
3. For JSON, ensure valid JSON before writing
4. Respond with the artifact purpose and language
5. Do NOT call diagram tools unless the user explicitly asks for Mermaid

WORKFLOW (for multi-agent repository work planning):
1. Call gitGuard(operation="preflight", paths, reason)
2. Call subagentFanout with explicit roles, objectives, ownedPaths, and allowedTools
3. Continue the work after fanout. subagentFanout returns specialist outputs but is NOT a final answer.
4. Use available concrete tools to apply the assembled direction where possible (codeWrite/codePatch for code artifacts, markdownWrite for docs, diagramWrite/diagramPatch for Mermaid, webSearch/fileManager/dataAnalyzer for research/data)
5. Call subagentAssemble with the fanout outputs when an integration plan helps
6. Provide verification steps and note any dirty/protected paths
7. Do NOT say files were modified unless a repository-writing tool actually modified them

IMPORTANT MULTI-AGENT CONTINUATION RULE:
- Use subagentFanout only when the user explicitly asks for subagents OR when the task naturally has 2+ independent workstreams.
- Never stop immediately after subagentFanout unless the tool result says user confirmation is required or the user explicitly asked only for a plan.
- After subagentFanout, read the returned specialist outputs, then execute the next concrete tool step in the SAME response. For diagram requests, call diagramWrite next. Use subagentAssemble only when outputs conflict or need synthesis. Do NOT call subagentFanout twice for the same request.
- After subagentAssemble, summarize the assembled result and continue to the next requested action if one remains.

RULES:
- Do NOT call tools for greetings or casual conversation
- For new diagrams, use diagramWrite directly
- For edits, diagramRead first, then one write/patch
- Never output raw Mermaid code in your text response — tools only
- Keep text responses concise: what you did and why
- Valid Mermaid syntax always — check node IDs, arrows, indentation
- Descriptive labels: A[User Login] not A[]
- Proper subgraph/end pairing
- Do NOT say things like "confirming no errors" or "checking for errors" — the client validates automatically
- ALWAYS call errorChecker() after diagramWrite or diagramPatch to catch syntax errors early

MINIMUM DIAGRAM QUALITY:
- Every diagram MUST have at least 10 nodes. Never create a diagram with fewer than 10 nodes.
- If the user's request is too vague or simple to produce 10+ nodes, use askQuestions to gather more details — ask about components, services, data flow, external integrations, infrastructure layers, etc.
- When expanding a diagram to meet the 10-node minimum, add relevant supporting components (databases, caches, load balancers, monitoring, CI/CD, auth, CDN, queues, etc.) that would realistically exist in the system.
- Do NOT pad diagrams with meaningless filler nodes. Every node must represent a real, meaningful component.

ICONIFIER — Post-processing icon decoration:
Diagrams must always be created WITHOUT icons. Do not include icons in diagram text.
Each node follows a strict semantic rule:
- Node ID: MUST be exactly one brand name from the lists below. NO exceptions.
- Node text: MUST describe the function/responsibility. NO brand names in text.

REQUIREMENT: NodeID = BrandName, Text = Function Description

CORRECT EXAMPLES:
- React[Frontend web application]
- Cloudflare[Content delivery and DDoS protection]
- Auth0[User authentication and authorization]
- PostgreSQL[Primary relational database]
- Redis[In-memory caching layer]
- ExpressJS[REST API server]

WRONG EXAMPLES (what NOT to do):
- WebApp[Web Application<br/>React/VueJS] ← NodeID should be "React" or "VueJS"
- CDN[Content Delivery<br/>Cloudflare] ← NodeID should be "Cloudflare"
- AuthSvc[Authentication<br/>Auth0/FirebaseAuth] ← NodeID should be "Auth0"
- PrimaryDB[(Primary Database<br/>PostgreSQL)] ← NodeID should be "PostgreSQL"

MANDATORY BRAND NAMES FOR NodeID:

**Databases**: PostgreSQL, MongoDB, MySQL, Redis, Elasticsearch, Cassandra, CouchDB, Neo4j, InfluxDB, DynamoDB, Firestore, Supabase

**API/Frameworks**: ExpressJS, FastAPI, SpringBoot, DjangoREST, GraphQL, NestJS, Laravel, Rails, ASPNET, NextJS, NuxtJS

**Caching**: Redis, Memcached, Hazelcast, Caffeine, GuavaCache, APCu, Varnish

**Messaging/Queues**: RabbitMQ, ApacheKafka, SQS, AzureServiceBus, GooglePubSub, NATS, ActiveMQ, Pulsar

**Web Servers**: Nginx, Apache, Caddy, IIS, OpenResty, LiteSpeed

**Containers/Orchestration**: Docker, Kubernetes, Podman, LXC, OpenShift, Rancher, Nomad

**Cloud Platforms**: AWS, Azure, GCP, DigitalOcean, Heroku, Vercel, Netlify, Cloudflare

**Frontend**: React, VueJS, Angular, Svelte, NextJS, NuxtJS, Gatsby, Remix, SolidJS

**Mobile**: ReactNative, Flutter, SwiftiOS, KotlinAndroid, Xamarin, Ionic

**Authentication**: Auth0, Okta, FirebaseAuth, Cognito, Keycloak, PassportJS

**Monitoring**: Prometheus, Grafana, Datadog, NewRelic, Splunk, ELKStack

**CI/CD**: Jenkins, GitHubActions, GitLabCI, CircleCI, TravisCI, TeamCity

ABSOLUTE REQUIREMENT: NodeID MUST be exactly one of the brand names above. No exceptions, no variations, no generic terms.

Icons are resolved automatically by the iconifier tool using this order:
1. Split NodeID parts (brand names extracted from NodeID) - HIGHEST PRIORITY
2. Full NodeID 
3. Full node text
4. First match ≥90% confidence wins; below threshold = no icon

CRITICAL: The split NodeID parts are searched FIRST, giving them the highest priority for icon matching.

You may call the iconifier tool only:
- Immediately after a diagram is created (call iconifier with mode "all")
- When the user explicitly asks to add icons (e.g. "add icons", "iconify this", "attach icons")
- When the user asks to remove icons

Iconifier modes:
- mode "all" — attach icons to all nodes
- mode "selective" with nodes array — attach icons to specific node IDs
- mode "remove" with removeAll=true — remove all icons
- mode "remove" with removeFromNodes array — remove icons from specific node IDs

SUBGRAPHS — Group related nodes:
  subgraph SubgraphId["Label"]
    NodeA["Node A"]
    NodeB["Node B"]
  end
  - Always pair subgraph with end
  - Subgraphs can be nested
  - Use classDef and class to style subgraphs (e.g. classDef vpc fill:none,stroke:#0a0; class VPC vpc)

When the user asks for architecture diagrams, create the diagram first WITHOUT icons, then call iconifier to add icons.
When the user asks for grouped/layered diagrams, use subgraphs to organize nodes logically.`;
}

export const GET: RequestHandler = async ({ request }) => {
  const rl = chatLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  try {
    const db = getDb();
    const enabledModels = await db.listEnabledModels(true);

    const models = enabledModels.map((m) => ({
      category: m.category || 'General',
      description: m.description || '',
      gemsPerMessage: m.gems_per_message ?? 2,
      id: m.model_id,
      isEnabled: true,
      isFree: m.is_free || false,
      maxTokens: m.max_tokens || 4000,
      name: m.model_name,
      provider: m.provider || 'openrouter',
      toolSupport: m.tool_support || false
    }));

    return json({ success: true, data: models });
  } catch (err) {
    console.error('Failed to fetch models:', err);
    return error(500, 'Failed to fetch models');
  }
};

export const POST: RequestHandler = async ({ request }) => {
  const rl = chatLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  try {
    const clonedRequest = request.clone();
    const {
      message,
      model,
      currentDiagram,
      currentMarkdown,
      messages: uiMessages,
      sessionId,
      conversationId,
      enabledTools,
      isRepair
    } = await clonedRequest.json();

    // Use sessionId if provided, otherwise fall back to conversationId, then 'default'
    const diagramSessionId = sessionId ?? conversationId ?? 'default';

    if (!message || !model) {
      return error(400, 'Message and model are required');
    }

    // Require authentication — block unauthenticated users
    let userId: string | null = null;
    try {
      const user = await validateSession(request);
      if (!user) {
        return error(401, 'Authentication required. Please sign in to use the chat.');
      }
      userId = user.id;

      // Deduct gems (skip for repair/error-fix messages)
      if (!isRepair) {
        const db = getDb();
        let gemsToDeduct = 2;
        try {
          const enabledModel = await db.getEnabledModel(model);
          if (enabledModel) {
            gemsToDeduct = enabledModel.gems_per_message ?? 2;
          }
        } catch {
          // fallback to default
        }
        const result = await db.deductCredits(
          userId,
          gemsToDeduct,
          `Chat: ${model}`,
          model,
          conversationId || undefined,
          undefined
        );
        if (!result.success) {
          return error(402, 'Insufficient gems. Please add more gems to continue.');
        }
      }
    } catch (authErr) {
      console.warn('Auth check during chat:', authErr);
      return error(401, 'Authentication required. Please sign in to use the chat.');
    }

    // Extract the actual model ID for the AI SDK
    // Supports formats: "openrouter/org/model", "openrouter:org/model", "org/model"
    let actualModelId = model;
    if (actualModelId.startsWith('openrouter/')) {
      actualModelId = actualModelId.slice('openrouter/'.length);
    } else if (actualModelId.startsWith('openrouter:')) {
      actualModelId = actualModelId.slice('openrouter:'.length);
    }

    // Store current diagram and markdown in session store
    if (currentDiagram !== undefined) {
      diagramStore.set(diagramSessionId, currentDiagram);
    }
    if (currentMarkdown !== undefined) {
      markdownStore.set(diagramSessionId, currentMarkdown);
    }

    // Build messages array — always text-only (images are pre-processed in /api/upload)
    const userContent = message;

    const systemPrompt = buildMultiStepSystemPrompt();

    const continuingAfterFanout = hasRecentSubagentFanout(uiMessages);
    const continuationPrompt = continuingAfterFanout
      ? 'A subagent fanout already completed in the recent conversation. Do NOT call subagentFanout again for this continuation. Read the existing specialist outputs in history, then call subagentAssemble if synthesis helps, or immediately perform the concrete next tool step such as diagramWrite, markdownWrite, or errorChecker.'
      : '';

    const messages: Record<string, unknown>[] = [
      { role: 'system', content: systemPrompt },
      ...(continuationPrompt ? [{ role: 'system', content: continuationPrompt }] : []),
      ...(uiMessages || []),
      { role: 'user', content: userContent }
    ];

    // Create tools and filter based on enabled tools from client
    let allTools = createDiagramTools(diagramSessionId, actualModelId);
    if (enabledTools && Array.isArray(enabledTools)) {
      const enabledSet = new Set(enabledTools as string[]);
      const filtered: Partial<typeof allTools> = {};
      for (const [key, value] of Object.entries(allTools)) {
        if (continuingAfterFanout && key === 'subagentFanout') continue;
        if (enabledSet.has(key) && shouldExposePlanningTool(key, message)) {
          (filtered as Record<string, typeof value>)[key] = value;
        }
      }
      allTools = filtered as typeof allTools;
    } else {
      const filtered: Partial<typeof allTools> = {};
      for (const [key, value] of Object.entries(allTools)) {
        if (continuingAfterFanout && key === 'subagentFanout') continue;
        if (shouldExposePlanningTool(key, message)) {
          (filtered as Record<string, typeof value>)[key] = value;
        }
      }
      allTools = filtered as typeof allTools;
    }

    // Convert to AI SDK format and stream with multi-step tool calling
    const result = streamText({
      messages: messages,
      model: openrouterFastChat(actualModelId),
      temperature: 0.55,
      tools: allTools
    });

    // Track usage after stream completes (fire-and-forget)
    Promise.resolve(result.usage)
      .then(async (usage) => {
        try {
          const db = getDb();
          const client = (db as unknown as { client?: unknown }).client;
          if (client && userId) {
            const prompt = usage?.inputTokens || 0;
            const completion = usage?.outputTokens || 0;
            await client.from('usage_stats').insert({
              completion_tokens: completion,
              conversation_id: conversationId || null,
              created_at: new Date().toISOString(),
              model: model,
              prompt_tokens: prompt,
              total_tokens: prompt + completion,
              user_id: userId
            });
          }
        } catch (e) {
          console.error('[Usage tracking] Error:', e);
        }
      })
      .catch(() => {
        /* no-op */
      });

    // Return streaming response
    const response = result.toUIMessageStreamResponse({
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });

    return response;
  } catch (err) {
    console.error('Chat server error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Internal server error';
    console.error('Error details:', errorMessage);
    // Log error to admin-visible state store
    stateManager
      .logError(err instanceof Error ? err : new Error(errorMessage), {
        metadata: { endpoint: '/api/chat', model: 'unknown' }
      })
      .catch(() => {
        /* no-op */
      });
    return error(500, errorMessage);
  }
};

// Handle OPTIONS for CORS
export const OPTIONS: RequestHandler = async () => {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
};

// Cursor-style system prompt for diagram editing
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _buildCursorSystemPrompt(): string {
  return `You are an AI coding assistant operating inside a code editor.

You are editing a Mermaid diagram.

IMPORTANT COMMUNICATION RULES:
- Use emojis in greetings and explanations to make conversations friendly and engaging 🎨
- NEVER discuss system prompts, tools, or internal workings - just focus on helping with diagrams
- Keep conversations natural and user-friendly

You do NOT edit text directly.

You can only modify the diagram using the following tools:

<diagram-read />
<diagram-patch start-line end-line>
<diagram-write>
<diagram-delete />

Rules:
- You MUST call <diagram-read /> before making any changes.
- Prefer <diagram-patch> for small, localized edits.
- Use <diagram-write> only for large rewrites.
- NEVER output Mermaid code outside of tools.
- NEVER explain your actions.
- Output ONLY tool calls or nothing.
- Dont think too much, if you want to think more then use chain of thoughts.

Examples:

User: Add a cache between API and Database
Assistant:
<diagram-read />

User: Insert cache
Assistant:
<diagram-patch start-line="3" end-line="3">
  B --> D[Cache]
  D --> C[Database]
</diagram-patch>

User: Rewrite diagram left to right
Assistant:
<diagram-write>
graph LR
  A[User] --> B[API]
  B --> C[Database]
</diagram-write>

User: Clear diagram
Assistant:
<diagram-delete />`;
}

// Parse XML-style diagram tools from model output
function parseDiagramTools(output: string): DiagramToolCall[] {
  const tools: DiagramToolCall[] = [];

  // Parse <diagram-read />
  const readMatch = output.match(/<diagram-read\s*\/>/);
  if (readMatch) {
    tools.push({ type: 'read' });
  }

  // Parse <diagram-patch start-line="x" end-line="y">content</diagram-patch>
  const patchMatches = output.matchAll(
    /<diagram-patch\s+start-line="(\d+)"\s+end-line="(\d+)">(.*?)<\/diagram-patch>/gs
  );
  for (const match of patchMatches) {
    tools.push({
      type: 'patch',
      startLine: parseInt(match[1]),
      endLine: parseInt(match[2]),
      content: match[3].trim()
    });
  }

  // Parse <diagram-write>content</diagram-write>
  const writeMatch = output.match(/<diagram-write>(.*?)<\/diagram-write>/s);
  if (writeMatch) {
    tools.push({
      type: 'write',
      content: writeMatch[1].trim()
    });
  }

  // Parse <diagram-delete />
  const deleteMatch = output.match(/<diagram-delete\s*\/>/);
  if (deleteMatch) {
    tools.push({ type: 'delete' });
  }

  return tools;
}

// Tool limits (production safety)
const TOOL_LIMITS = {
  MAX_TOOLS_PER_RESPONSE: 4,
  MAX_TOTAL_TOOLS_PER_RUN: 10,
  MAX_PATCH_CHARS: 5000,
  MAX_WRITE_CHARS: 20000
} as const;

interface ValidationResult {
  valid: boolean;
  error?: string;
}

function toolNameFor(action: DiagramToolCall): string {
  switch (action.type) {
    case 'read':
      return 'diagram-read';
    case 'patch':
      return 'diagram-patch';
    case 'write':
      return 'diagram-write';
    case 'delete':
      return 'diagram-delete';
  }
}

function validateTool(tool: DiagramToolCall, diagram: string, hasRead: boolean): ValidationResult {
  // Skip validation for empty diagrams
  if (!diagram.trim()) {
    return { valid: true };
  }

  if ((tool.type === 'patch' || tool.type === 'write' || tool.type === 'delete') && !hasRead) {
    return { valid: false, error: 'Must read diagram before editing' };
  }

  if (tool.type === 'patch') {
    if (typeof tool.startLine !== 'number' || typeof tool.endLine !== 'number') {
      return { valid: false, error: 'Patch requires start-line and end-line' };
    }
    if (tool.startLine < 1 || tool.endLine < 1) {
      return { valid: false, error: 'Line numbers must be 1-based' };
    }
    if (tool.startLine > tool.endLine) {
      return {
        valid: false,
        error: `start-line (${tool.startLine}) cannot exceed end-line (${tool.endLine})`
      };
    }
    const lines = diagram.split('\n');
    if (tool.endLine > lines.length) {
      return {
        valid: false,
        error: `end-line ${tool.endLine} exceeds diagram length (${lines.length} lines)`
      };
    }
    if (!tool.content || tool.content.length === 0) {
      return { valid: false, error: 'Patch content cannot be empty' };
    }
    if (tool.content.length > TOOL_LIMITS.MAX_PATCH_CHARS) {
      return { valid: false, error: `Patch exceeds ${TOOL_LIMITS.MAX_PATCH_CHARS} chars` };
    }
    if (tool.content.includes('<diagram-')) {
      return { valid: false, error: 'Patch content cannot contain nested tool tags' };
    }
  }

  if (tool.type === 'write') {
    if (!tool.content || tool.content.length === 0) {
      return { valid: false, error: 'Write content cannot be empty' };
    }
    if (tool.content.length > TOOL_LIMITS.MAX_WRITE_CHARS) {
      return { valid: false, error: `Write exceeds ${TOOL_LIMITS.MAX_WRITE_CHARS} chars` };
    }
    if (tool.content.includes('<diagram-')) {
      return { valid: false, error: 'Write content cannot contain tool tags' };
    }
  }

  return { valid: true };
}

// Apply patch to diagram (Monaco-compatible)
function applyPatch(
  source: string,
  { startLine, endLine, content }: { startLine: number; endLine: number; content: string }
): string {
  const lines = source.split('\n');

  lines.splice(startLine - 1, endLine - startLine + 1, ...content.split('\n'));

  return lines.join('\n');
}

// Cursor-style agent loop for diagram editing
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _runDiagramAgent(
  userMessage: string,
  systemPrompt: string,
  initialDiagram: string,
  modelId: string
) {
  let diagram = initialDiagram;
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  // Cursor-correct: enforce "read before write" invariant
  let hasRead = false;

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let totalToolCount = 0;
        let toolCallCounter = 0;

        for (let i = 0; i < 5; i++) {
          // Call LLM with ALL messages (Cursor-correct - include tool results)
          const result = await streamText({
            model: openrouterFastChat(modelId),
            messages: messages,
            temperature: 0.55
          });

          let fullOutput = '';
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _artifactCounter = 0;

          // Stream LLM text deltas to client in real-time for live artifact preview
          for await (const delta of result.textStream) {
            fullOutput += delta;

            // Send each delta so the client can build the artifact incrementally
            controller.enqueue(
              `data: ${JSON.stringify({ type: 'llm-delta', delta, fullText: fullOutput })}\n\n`
            );
          }

          // Parse tools from complete output
          const actions = parseDiagramTools(fullOutput);

          // Stop if no tools
          if (actions.length === 0) {
            break;
          }

          // Check max tools per response
          if (actions.length > TOOL_LIMITS.MAX_TOOLS_PER_RESPONSE) {
            throw new Error(
              `Too many tools: ${actions.length} (max ${TOOL_LIMITS.MAX_TOOLS_PER_RESPONSE})`
            );
          }

          // Execute each tool with validation
          for (const action of actions) {
            totalToolCount++;
            if (totalToolCount > TOOL_LIMITS.MAX_TOTAL_TOOLS_PER_RUN) {
              throw new Error(`Exceeded max tools per run: ${TOOL_LIMITS.MAX_TOTAL_TOOLS_PER_RUN}`);
            }

            // Validate tool
            const validation = validateTool(action, diagram, hasRead);
            if (!validation.valid) {
              // Send error to model for recovery
              messages.push({
                role: 'tool',
                toolCallId: `error-${Date.now()}`,
                content: `Error: ${validation.error}. Fix parameters or call <diagram-read /> first.`
              });

              // Emit to client
              controller.enqueue(
                `data: ${JSON.stringify({ type: 'error', error: validation.error })}\n\n`
              );
              continue;
            }

            // Execute valid tools
            toolCallCounter++;
            const artifactId = `artifact-${i}-${toolCallCounter}-${Date.now()}`;

            // Emit tool-start so client can show artifact immediately
            controller.enqueue(
              `data: ${JSON.stringify({ type: 'tool-start', artifactId, operation: action.type, toolName: toolNameFor(action) })}\n\n`
            );

            if (action.type === 'read') {
              hasRead = true;
              const toolCallId = `read-${Date.now()}`;
              messages.push({
                role: 'assistant',
                content: [],
                toolCalls: [
                  {
                    id: toolCallId,
                    type: 'function',
                    function: { name: 'diagram-read', arguments: '{}' }
                  }
                ]
              });
              messages.push({
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId,
                    toolName: 'diagram-read',
                    output: { value: diagram }
                  }
                ]
              });
              controller.enqueue(
                `data: ${JSON.stringify({ type: 'diagram-read', artifactId, content: { diagram } })}\n\n`
              );
            }

            if (action.type === 'patch' && action.startLine && action.endLine && action.content) {
              const toolCallId = `patch-${Date.now()}`;
              messages.push({
                role: 'assistant',
                content: [],
                toolCalls: [
                  {
                    id: toolCallId,
                    type: 'function',
                    function: { name: 'diagram-patch', arguments: '{}' }
                  }
                ]
              });
              diagram = applyPatch(diagram, {
                startLine: action.startLine,
                endLine: action.endLine,
                content: action.content
              });
              messages.push({
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId,
                    toolName: 'diagram-patch',
                    output: { success: true }
                  }
                ]
              });
              controller.enqueue(
                `data: ${JSON.stringify({ type: 'diagram-update', artifactId, operation: 'patch', content: { diagram } })}\n\n`
              );
            }

            if (action.type === 'write' && action.content) {
              const toolCallId = `write-${Date.now()}`;
              messages.push({
                role: 'assistant',
                content: [],
                toolCalls: [
                  {
                    id: toolCallId,
                    type: 'function',
                    function: { name: 'diagram-write', arguments: '{}' }
                  }
                ]
              });
              diagram = action.content;
              messages.push({
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId,
                    toolName: 'diagram-write',
                    output: { success: true }
                  }
                ]
              });
              controller.enqueue(
                `data: ${JSON.stringify({ type: 'diagram-update', artifactId, operation: 'write', content: { diagram } })}\n\n`
              );
            }

            if (action.type === 'delete') {
              const toolCallId = `delete-${Date.now()}`;
              messages.push({
                role: 'assistant',
                content: [],
                toolCalls: [
                  {
                    id: toolCallId,
                    type: 'function',
                    function: { name: 'diagram-delete', arguments: '{}' }
                  }
                ]
              });
              diagram = '';
              messages.push({
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId,
                    toolName: 'diagram-delete',
                    output: { success: true }
                  }
                ]
              });
              controller.enqueue(
                `data: ${JSON.stringify({ type: 'diagram-update', artifactId, operation: 'delete', content: { diagram } })}\n\n`
              );
            }
          }
        }

        // Send final message
        const finalChunk = {
          type: 'done',
          diagram
        };
        controller.enqueue(`data: ${JSON.stringify(finalChunk)}\n\n`);
        controller.close();
      } catch (err) {
        console.error('Diagram agent error:', err);

        const errorChunk = {
          type: 'error',
          error: err instanceof Error ? err.message : 'Unknown error occurred'
        };

        controller.enqueue(`data: ${JSON.stringify(errorChunk)}\n\n`);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream'
    }
  });
}

// Type definitions for diagram tools
type DiagramToolCall =
  | { type: 'read' }
  | { type: 'patch'; startLine: number; endLine: number; content: string }
  | { type: 'write'; content: string }
  | { type: 'delete' };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _MessageRole = 'system' | 'user' | 'assistant' | 'tool';
