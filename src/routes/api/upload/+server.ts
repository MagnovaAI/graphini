import { storeFile } from '$lib/server/file-store';
import { loadOpenRouterApiKey } from '$lib/server/chat/model';
import { error, json } from '@sveltejs/kit';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import type { RequestHandler } from './$types';

dotenv.config({ path: '.env.local' });
dotenv.config();

/**
 * File upload endpoint - processes all files server-side.
 * Images are analyzed via a vision model and returned as text descriptions.
 * Documents (txt, md, csv, json) have their text extracted server-side.
 * PDFs are parsed with pdf-parse for full text extraction.
 * All files are stored in the server-side file store for agent access.
 *
 * Accepts multipart/form-data with 'file' field and optional 'sessionId' field.
 * Returns: { url: string|null, mediaType: string, filename: string, type: string, extractedText?: string, fileId?: string }
 */

async function describeImageWithVision(base64DataUrl: string, filename: string): Promise<string> {
  const apiKey = await loadOpenRouterApiKey();
  if (!apiKey) return `[Image: ${filename} — vision processing unavailable (no API key)]`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this image in detail. Describe:
1. What type of image it is (diagram, screenshot, photo, chart, etc.)
2. All text visible in the image
3. The structure and layout
4. Key elements, relationships, and data shown
5. If it's a diagram/flowchart, describe the nodes, connections, and flow
6. If it contains code or technical content, transcribe it

Be thorough and precise. This description will be used to recreate or reference the image content.`
              },
              {
                type: 'image_url',
                image_url: { url: base64DataUrl }
              }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[upload] Vision API error ${res.status}:`, errBody);
      return `[Image: ${filename} — could not analyze (API error ${res.status})]`;
    }

    const data = await res.json();
    const description = data.choices?.[0]?.message?.content?.trim();
    if (!description) return `[Image: ${filename} — no description returned]`;
    return description;
  } catch (err) {
    console.error('[upload] Vision processing error:', err);
    return `[Image: ${filename} — processing failed]`;
  }
}

function csvToMarkdown(csvText: string, filename: string): string {
  try {
    const workbook = XLSX.read(csvText, { type: 'string' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: ''
    }) as string[][];
    if (rows.length === 0) return `# CSV: ${filename}\n\n_Empty file_`;
    const header = rows[0].map((c: any) => String(c ?? ''));
    const separator = header.map(() => '---');
    const mdRows = [header.join(' | '), separator.join(' | ')];
    for (let r = 1; r < rows.length; r++) {
      mdRows.push(rows[r].map((c: any) => String(c ?? '')).join(' | '));
    }
    let md = `# CSV: ${filename} (${rows.length} rows, ${header.length} cols)\n\n| ${mdRows.join(' |\n| ')} |`;
    if (md.length > 80000) {
      md = md.slice(0, 80000) + `\n\n[... truncated, ${md.length - 80000} more characters]`;
    }
    return md;
  } catch {
    return csvText;
  }
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return error(400, 'No file provided');
    }

    // Size limits: 20MB for all files
    const MAX_FILE_SIZE = 20 * 1024 * 1024;

    if (file.size > MAX_FILE_SIZE) {
      return error(413, `File too large. Max 20MB allowed.`);
    }

    const filename = file.name;
    const mediaType = file.type || 'application/octet-stream';
    const isImage = file.type.startsWith('image/');

    // For images: analyze with vision model, return text description + thumbnail URL
    if (isImage) {
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const dataUrl = `data:${mediaType};base64,${base64}`;

      // Process image with vision model to get text description
      const description = await describeImageWithVision(dataUrl, filename);

      // Store image metadata for agent access
      const sessionId = (formData.get('sessionId') as string) || 'default';
      const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await storeFile({
        id: fileId,
        sessionId,
        filename,
        mediaType,
        type: 'image',
        size: file.size,
        extractedText: `[Image: ${filename}]\n${description}`,
        storedAt: Date.now()
      });

      return json({
        url: dataUrl,
        mediaType,
        filename,
        type: 'image',
        extractedText: `[Image: ${filename}]\n${description}`,
        fileId,
        size: file.size
      });
    }

    // For text-based documents: extract text content
    const textTypes = [
      'text/plain',
      'text/markdown',
      'text/csv',
      'text/html',
      'application/json',
      'application/xml',
      'text/xml',
      'application/x-yaml',
      'text/yaml',
      'application/javascript',
      'text/javascript',
      'application/typescript',
      'text/typescript'
    ];

    const textExtensions = [
      '.txt',
      '.md',
      '.csv',
      '.json',
      '.xml',
      '.yaml',
      '.yml',
      '.html',
      '.mmd',
      '.mermaid',
      '.svg',
      '.log',
      '.env',
      '.toml',
      '.ini',
      '.cfg',
      '.js',
      '.ts',
      '.py',
      '.java',
      '.c',
      '.cpp',
      '.h',
      '.go',
      '.rs',
      '.rb',
      '.php',
      '.sh',
      '.bat',
      '.sql',
      '.r',
      '.swift',
      '.kt'
    ];
    const ext = '.' + filename.split('.').pop()?.toLowerCase();
    const isTextFile = textTypes.includes(mediaType) || textExtensions.includes(ext);

    if (isTextFile) {
      const text = await file.text();
      // Convert CSV to markdown table for better AI consumption
      let extractedText = text;
      if (ext === '.csv' || mediaType === 'text/csv') {
        extractedText = csvToMarkdown(text, filename);
      }
      const sessionId = (formData.get('sessionId') as string) || 'default';
      const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await storeFile({
        id: fileId,
        sessionId,
        filename,
        mediaType,
        type: 'document',
        size: file.size,
        extractedText,
        storedAt: Date.now()
      });

      return json({
        url: null,
        mediaType,
        filename,
        type: 'document',
        extractedText,
        fileId,
        size: file.size
      });
    }

    // For PDF: full text extraction using pdf-parse
    if (mediaType === 'application/pdf' || ext === '.pdf') {
      const buffer = Buffer.from(await file.arrayBuffer());
      let extractedText = '';
      let pageCount = 0;
      try {
        const { PDFParse } = await import('pdf-parse');
        const pdfParser = new PDFParse(new Uint8Array(buffer));
        const pdfData = await pdfParser.getText();
        extractedText = pdfData.text || '';
        pageCount = pdfData.pages?.length || 0;
        // Truncate very large PDFs to avoid context overflow (keep first ~50k chars)
        if (extractedText.length > 50000) {
          extractedText =
            extractedText.slice(0, 50000) +
            `\n\n[... truncated, ${extractedText.length - 50000} more characters. Use fileManager tool to read specific sections.]`;
        }
      } catch (pdfErr) {
        console.error('[upload] PDF parse error:', pdfErr);
        extractedText = `[PDF document: ${filename} — text extraction failed. The file has been stored and can be accessed via the fileManager tool.]`;
      }

      // Store file for agent access
      const sessionId = (formData.get('sessionId') as string) || 'default';
      const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await storeFile({
        id: fileId,
        sessionId,
        filename,
        mediaType,
        type: 'pdf',
        size: file.size,
        extractedText: extractedText || `[PDF: ${filename}]`,
        storedAt: Date.now()
      });

      const summary =
        pageCount > 0
          ? `[PDF: ${filename}, ${pageCount} pages, ${(file.size / 1024).toFixed(1)}KB]`
          : `[PDF: ${filename}, ${(file.size / 1024).toFixed(1)}KB]`;

      return json({
        url: null,
        mediaType,
        filename,
        type: 'pdf',
        extractedText: extractedText ? `${summary}\n\n${extractedText}` : summary,
        fileId,
        pageCount,
        size: file.size
      });
    }

    // For Excel files (XLSX/XLS): parse all sheets into markdown tables
    const isExcel =
      mediaType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mediaType === 'application/vnd.ms-excel' ||
      ext === '.xlsx' ||
      ext === '.xls';
    if (isExcel) {
      const buffer = Buffer.from(await file.arrayBuffer());
      let extractedText = '';
      let sheetCount = 0;
      try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        sheetCount = workbook.SheetNames.length;
        const parts: string[] = [];
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: ''
          }) as string[][];
          if (rows.length === 0) {
            parts.push(`## Sheet: ${sheetName}\n\n_Empty sheet_`);
            continue;
          }
          // Build markdown table
          const header = rows[0].map((c: any) => String(c ?? ''));
          const separator = header.map(() => '---');
          const mdRows = [header.join(' | '), separator.join(' | ')];
          for (let r = 1; r < rows.length; r++) {
            mdRows.push(rows[r].map((c: any) => String(c ?? '')).join(' | '));
          }
          parts.push(
            `## Sheet: ${sheetName} (${rows.length} rows, ${header.length} cols)\n\n| ${mdRows.join(' |\n| ')} |`
          );
        }
        extractedText = `# Excel: ${filename} (${sheetCount} sheet${sheetCount > 1 ? 's' : ''}, ${(file.size / 1024).toFixed(1)}KB)\n\n${parts.join('\n\n')}`;
        // Truncate very large files
        if (extractedText.length > 80000) {
          extractedText =
            extractedText.slice(0, 80000) +
            `\n\n[... truncated, ${extractedText.length - 80000} more characters]`;
        }
      } catch (xlsxErr) {
        console.error('[upload] XLSX processing error:', xlsxErr);
        extractedText = `[Excel file: ${filename} — parsing failed: ${xlsxErr instanceof Error ? xlsxErr.message : 'unknown error'}]`;
      }

      const sessionId = (formData.get('sessionId') as string) || 'default';
      const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await storeFile({
        id: fileId,
        sessionId,
        filename,
        mediaType,
        type: 'document',
        size: file.size,
        extractedText,
        storedAt: Date.now()
      });

      return json({
        url: null,
        mediaType,
        filename,
        type: 'document',
        extractedText,
        fileId,
        sheetCount,
        size: file.size
      });
    }

    // Unsupported file type - reject with error
    return error(
      415,
      `Unsupported file type: ${ext || mediaType}. Accepted: images, PDFs, text/code files (.txt, .md, .json, .js, .ts, .py, .csv, .xlsx, etc.).`
    );
  } catch (err) {
    console.error('Upload error:', err);
    return error(500, 'Failed to process file');
  }
};
