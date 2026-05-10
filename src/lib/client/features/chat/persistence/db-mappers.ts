import type { Artifact, ContentPart } from '$lib/client/features/chat/content-parts/types';
import type { DbMessageRow } from './db-types';

export function metadataOf(message: DbMessageRow): Record<string, unknown> {
  return message.metadata && typeof message.metadata === 'object' ? message.metadata : {};
}

export function textFromContentParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  const text: string[] = [];
  for (const raw of parts) {
    if (!raw || typeof raw !== 'object') continue;
    const part = raw as Record<string, unknown>;
    if (part.type === 'text' && typeof part.text === 'string') {
      text.push(part.text);
    }
  }
  return text.join('');
}

export function bestVisibleContent(message: {
  content?: unknown;
  role?: unknown;
  parts?: unknown;
}): string {
  const content =
    typeof message.content === 'string' ? message.content : String(message.content ?? '');
  if (message.role !== 'assistant') return content;

  const partsText = textFromContentParts(message.parts);
  if (!partsText.trim()) return content;
  if (
    !content.trim() ||
    content === '[tool call]' ||
    partsText.trim().length > content.trim().length
  ) {
    return partsText;
  }
  return content;
}

export function messagesFromDbRows(rows: DbMessageRow[]): Record<string, unknown>[] {
  return rows.map((message) => {
    const metadata = metadataOf(message);
    const contextContent =
      typeof metadata.contextContent === 'string' && metadata.contextContent.trim()
        ? metadata.contextContent
        : undefined;
    const attachments = Array.isArray(metadata.attachments) ? metadata.attachments : [];
    const content =
      message.role === 'user' &&
      message.content === '[tool call]' &&
      (contextContent || attachments.length > 0)
        ? ''
        : bestVisibleContent(message);
    return {
      attachments,
      content,
      ...(message.role === 'user' && contextContent ? { contextContent } : {}),
      id: typeof metadata.clientId === 'string' ? metadata.clientId : message.id,
      model_used: message.model_used,
      role: message.role,
      timestamp: metadata.timestamp || new Date(message.created_at).getTime()
    };
  });
}

export interface RestoredPartsResult {
  parts: Record<number, ContentPart[]>;
  artifacts: Record<string, Artifact>;
}

export function partsFromDbRows(rows: DbMessageRow[]): RestoredPartsResult {
  const parts: Record<number, ContentPart[]> = {};
  const artifacts: Record<string, Artifact> = {};

  rows.forEach((message, index) => {
    if (Array.isArray(message.parts)) {
      const cleaned: ContentPart[] = [];
      for (const raw of message.parts) {
        if (!raw || typeof raw !== 'object') continue;
        const part = raw as Record<string, unknown>;
        if (part.type === 'artifact' && typeof part.artifactId === 'string') {
          const inline = part.artifact;
          if (inline && typeof inline === 'object') {
            artifacts[part.artifactId] = {
              ...(inline as Artifact),
              id: part.artifactId,
              isStreaming: false
            };
          }
          cleaned.push({ type: 'artifact', artifactId: part.artifactId });
          continue;
        }
        cleaned.push(part as unknown as ContentPart);
      }
      parts[index] = cleaned;
    } else if (message.role === 'assistant' && message.content) {
      parts[index] = [{ type: 'text', text: message.content }];
    }
  });

  return { parts, artifacts };
}
