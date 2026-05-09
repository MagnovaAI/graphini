/**
 * File Store (Legacy Stub)
 * The filesystem feature has been replaced by the workspace system.
 * These stubs exist for backward compatibility with upload/chat routes.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const UPLOAD_DIR = path.join(os.tmpdir(), 'graphini-uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export interface StoredFile {
  id: string;
  sessionId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  mediaType: string;
  type: string;
  size: number;
  path: string;
  extractedText?: string;
  createdAt: number;
  storedAt: number;
}

const fileStore = new Map<string, StoredFile>();

/**
 * Strip anything that could be interpreted as a path separator, control char,
 * or shell metacharacter from a user-supplied filename before joining it onto
 * UPLOAD_DIR. The UUID prefix already guarantees uniqueness; this just makes
 * sure the suffix can't escape the directory or break tooling that later
 * reads the path back. 80-char cap keeps temp filenames bounded.
 */
function sanitizeFilenameSegment(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return cleaned || 'file';
}

export function storeFile(data: {
  sessionId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  extractedText?: string;
}): StoredFile {
  const id = crypto.randomUUID();
  const filePath = path.join(UPLOAD_DIR, `${id}-${sanitizeFilenameSegment(data.filename)}`);
  fs.writeFileSync(filePath, data.buffer);

  const stored: StoredFile = {
    createdAt: Date.now(),
    extractedText: data.extractedText,
    filename: data.filename,
    id,
    mediaType: data.mimeType,
    mimeType: data.mimeType,
    originalName: data.originalName,
    path: filePath,
    sessionId: data.sessionId,
    size: data.buffer.length,
    storedAt: Date.now(),
    type: data.mimeType.split('/')[0] || 'unknown'
  };

  fileStore.set(id, stored);
  return stored;
}

export function getFileById(id: string): StoredFile | undefined {
  return fileStore.get(id);
}

export function getSessionFiles(sessionId: string): StoredFile[] {
  return Array.from(fileStore.values()).filter((f) => f.sessionId === sessionId);
}

export function deleteFile(id: string): boolean {
  const file = fileStore.get(id);
  if (!file) return false;
  try {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
  } catch {
    /* ignore */
  }
  fileStore.delete(id);
  return true;
}
