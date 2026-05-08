import type { Artifact, ContentPart } from '$lib/client/features/chat/content-parts/types';
import type { DbMessageRow } from './db-types';

export function metadataOf(message: DbMessageRow): Record<string, unknown> {
  return message.metadata && typeof message.metadata === 'object' ? message.metadata : {};
}

export function messagesFromDbRows(rows: DbMessageRow[]): Record<string, unknown>[] {
  return rows.map((message) => {
    const metadata = metadataOf(message);
    return {
      attachments: metadata.attachments || [],
      content: message.content,
      contextContent: metadata.contextContent,
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
