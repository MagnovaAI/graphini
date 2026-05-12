import { validateSessionOrGuest } from '$lib/server/auth';
import { getDrizzle } from '$lib/server/db';
import { workspaceFiles } from '$lib/server/db/schema';
import { getClientKey, rateLimitResponse, uploadLimiter } from '$lib/server/rate-limit';
import { validateContentForKind } from '$lib/server/workspace-content-validation';
import { PATH_RE } from '$lib/server/workspace-paths';
import { error, json } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Upload endpoint.
 *
 * Uploads are no longer a temporary chat attachment store. Supported source
 * files are converted into Markdown and inserted into the user's workspace
 * file tree as `uploads/<name>.md`, so the normal `fileSystem` tool can read,
 * patch, move, and delete them.
 */

const GUEST_MAX_FILE_SIZE = 2 * 1024 * 1024;
const USER_MAX_FILE_SIZE = 10 * 1024 * 1024;
const INLINE_UPLOAD_TOKEN_LIMIT = 50_000;
const GUEST_QUOTA = 15;
const USER_QUOTA = 30;
const UPLOAD_FOLDER = 'uploads';

const drizzleDb = () => {
  const db = getDrizzle();
  if (!db) throw new Error('Upload endpoint requires a Drizzle-backed database adapter.');
  return db;
};

function quotaFor(user: { is_guest?: boolean | null }): number {
  return user.is_guest ? GUEST_QUOTA : USER_QUOTA;
}

function maxFileSizeFor(user: { is_guest?: boolean | null }): number {
  return user.is_guest ? GUEST_MAX_FILE_SIZE : USER_MAX_FILE_SIZE;
}

function formatMegabytes(bytes: number): string {
  return `${Math.floor(bytes / 1024 / 1024)}MB`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function sanitizePathSegment(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[ ._-]+|[ ._-]+$/g, '')
    .slice(0, 80);
  return normalized || 'upload';
}

function markdownTitle(filename: string): string {
  return stripExtension(filename).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

function textToMarkdown(text: string, filename: string, sourceLabel: string): string {
  const title = markdownTitle(filename) || 'Uploaded file';
  const body = normalizeText(text);
  return [
    `# ${title}`,
    '',
    `> Imported from ${sourceLabel}.`,
    '',
    body || '_No extractable text was found._',
    ''
  ].join('\n');
}

async function pdfToMarkdown(
  buffer: Buffer,
  filename: string
): Promise<{ markdown: string; pageCount: number }> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse(new Uint8Array(buffer));
  const pdf = await parser.getText();
  const pageCount = pdf.pages?.length ?? 0;
  const markdown = textToMarkdown(
    pdf.text ?? '',
    filename,
    `PDF${pageCount ? `, ${pageCount} page${pageCount === 1 ? '' : 's'}` : ''}`
  );
  return { markdown, pageCount };
}

async function nextUploadPath(
  db: ReturnType<typeof drizzleDb>,
  userId: string,
  filename: string
): Promise<string> {
  const base = sanitizePathSegment(stripExtension(filename));
  const rows = await db
    .select({ path: workspaceFiles.path })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.user_id, userId));
  const taken = new Set(rows.map((row) => row.path));

  const first = `${UPLOAD_FOLDER}/${base}.md`;
  if (!taken.has(first)) return first;

  for (let index = 2; index < 1000; index++) {
    const candidate = `${UPLOAD_FOLDER}/${base} ${index}.md`;
    if (!taken.has(candidate)) return candidate;
  }

  return `${UPLOAD_FOLDER}/${base}-${crypto.randomUUID().slice(0, 8)}.md`;
}

function classifyUpload(filename: string, mediaType: string) {
  const ext = `.${filename.split('.').pop()?.toLowerCase() ?? ''}`;
  if (mediaType === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (mediaType === 'text/markdown' || ext === '.md' || ext === '.markdown') return 'markdown';
  if (mediaType === 'text/plain' || ext === '.txt') return 'text';
  return null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const rl = uploadLimiter.check(getClientKey(request));
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

    const user = await validateSessionOrGuest(request).catch(() => null);
    if (!user) return error(401, 'Authentication required to upload files.');

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return error(400, 'No file provided');
    const maxFileSize = maxFileSizeFor(user);
    if (file.size > maxFileSize) {
      return error(413, `File too large. Max ${formatMegabytes(maxFileSize)} allowed.`);
    }

    const filename = file.name || 'attachment';
    const mediaType = file.type || 'application/octet-stream';
    const uploadType = classifyUpload(filename, mediaType);
    if (!uploadType) {
      return error(415, 'Unsupported file type. Accepted: Markdown, text, and PDF.');
    }

    const db = drizzleDb();
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.user_id, user.id));
    const cap = quotaFor(user);
    if (count >= cap) {
      return json(
        { error: `File quota reached (${count}/${cap}). Delete a file to make room.` },
        { status: 409 }
      );
    }

    let markdown = '';
    let pageCount = 0;
    if (uploadType === 'pdf') {
      const converted = await pdfToMarkdown(Buffer.from(await file.arrayBuffer()), filename).catch(
        (pdfErr) => {
          console.error('[upload] PDF conversion failed:', pdfErr);
          return null;
        }
      );
      if (!converted) {
        return json({ error: 'Could not extract text from this PDF.' }, { status: 422 });
      }
      markdown = converted.markdown;
      pageCount = converted.pageCount;
    } else if (uploadType === 'markdown') {
      markdown = normalizeText(await file.text());
      if (!markdown) markdown = textToMarkdown('', filename, 'Markdown file');
    } else {
      markdown = textToMarkdown(await file.text(), filename, 'plain text file');
    }

    const path = await nextUploadPath(db, user.id, filename);
    if (!PATH_RE.test(path)) return error(400, 'Generated upload path was invalid.');
    const validation = validateContentForKind('md', markdown);
    if (!validation.ok) {
      return json({ error: validation.error, hint: validation.hint }, { status: 400 });
    }

    const [inserted] = await db
      .insert(workspaceFiles)
      .values({ content: markdown, kind: 'md', path, user_id: user.id })
      .returning();
    const tokenEstimate = estimateTokens(markdown);
    const shouldInlineContent = tokenEstimate <= INLINE_UPLOAD_TOKEN_LIMIT;

    const workspaceFile = {
      content: shouldInlineContent ? inserted.content : '',
      created_at: inserted.created_at.toISOString(),
      id: inserted.id,
      kind: inserted.kind,
      path: inserted.path,
      updated_at: inserted.updated_at.toISOString()
    };

    return json(
      {
        fileId: inserted.id,
        filename,
        mediaType,
        pageCount,
        shouldInlineContent,
        size: file.size,
        tokenEstimate,
        type: uploadType,
        url: null,
        workspaceFile,
        workspaceFileId: inserted.id,
        workspacePath: inserted.path
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('Upload error:', err);
    return error(500, err instanceof Error ? err.message : 'Failed to process file');
  }
};
