import { deleteFile, getFileById, getSessionFiles } from '$lib/server/file-store';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from './context';

export function createFileManagerTool({ sessionId }: ToolContext) {
  return tool({
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
  });
}
