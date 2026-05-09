import { storeFile } from '$lib/server/file-store';
import { loadOpenRouterApiKey } from '$lib/server/chat/model';
import { validateSessionOrGuest } from '$lib/server/auth';
import { getClientKey, rateLimitResponse, uploadLimiter } from '$lib/server/rate-limit';
import { error, json } from '@sveltejs/kit';
import dotenv from 'dotenv';
import type { RequestHandler } from './$types';

dotenv.config({ path: '.env.local' });
dotenv.config();

/**
 * File upload endpoint - processes all files server-side.
 * Images are analyzed via a vision model only when the selected chat model allows images.
 * Documents (txt, md) have their text extracted server-side.
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

export const POST: RequestHandler = async ({ request }) => {
  try {
    // Auth + rate limit before reading the body so anonymous floods get
    // rejected before we pay the multipart parsing / vision-model costs.
    const rl = uploadLimiter.check(getClientKey(request));
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

    const user = await validateSessionOrGuest(request).catch(() => null);
    if (!user) return error(401, 'Authentication required to upload files.');

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
    const supportsImages = formData.get('supportsImages') === 'true';

    // For images: analyze with vision model, return text description + thumbnail URL
    if (isImage) {
      if (!supportsImages) {
        return error(415, 'Images are only supported when the selected model allows image input.');
      }

      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const dataUrl = `data:${mediaType};base64,${base64}`;

      // Process image with vision model to get text description
      const description = await describeImageWithVision(dataUrl, filename);

      // Store image metadata for agent access
      const sessionId = (formData.get('sessionId') as string) || 'default';
      const storedFile = storeFile({
        buffer: Buffer.from(buffer),
        extractedText: `[Image: ${filename}]\n${description}`,
        filename,
        mimeType: mediaType,
        originalName: filename,
        sessionId
      });

      return json({
        extractedText: `[Image: ${filename}]\n${description}`,
        fileId: storedFile.id,
        filename,
        mediaType,
        size: file.size,
        type: 'image',
        url: dataUrl
      });
    }

    // For text-based documents: extract text content
    const textTypes = ['text/plain', 'text/markdown'];

    const textExtensions = ['.txt', '.md', '.markdown'];
    const ext = '.' + filename.split('.').pop()?.toLowerCase();
    const isTextFile = textTypes.includes(mediaType) || textExtensions.includes(ext);

    if (isTextFile) {
      const text = await file.text();
      const extractedText = text;
      const sessionId = (formData.get('sessionId') as string) || 'default';
      const storedFile = storeFile({
        buffer: Buffer.from(text),
        extractedText,
        filename,
        mimeType: mediaType,
        originalName: filename,
        sessionId
      });

      return json({
        extractedText,
        fileId: storedFile.id,
        filename,
        mediaType,
        size: file.size,
        type: 'document',
        url: null
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
      const storedFile = storeFile({
        buffer,
        extractedText: extractedText || `[PDF: ${filename}]`,
        filename,
        mimeType: mediaType,
        originalName: filename,
        sessionId
      });

      const summary =
        pageCount > 0
          ? `[PDF: ${filename}, ${pageCount} pages, ${(file.size / 1024).toFixed(1)}KB]`
          : `[PDF: ${filename}, ${(file.size / 1024).toFixed(1)}KB]`;

      return json({
        extractedText: extractedText ? `${summary}\n\n${extractedText}` : summary,
        fileId: storedFile.id,
        filename,
        mediaType,
        pageCount,
        size: file.size,
        type: 'pdf',
        url: null
      });
    }

    // Unsupported file type - reject with error
    return error(
      415,
      `Unsupported file type: ${ext || mediaType}. Accepted: Markdown, text, PDF${supportsImages ? ', and images' : ''}.`
    );
  } catch (err) {
    console.error('Upload error:', err);
    return error(500, 'Failed to process file');
  }
};
