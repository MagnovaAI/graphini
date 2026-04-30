import { z } from 'zod';

export interface JsonSchemaObject {
  $schema?: string;
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface McpToolAnnotations {
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  readOnlyHint?: boolean;
  title?: string;
}

export interface McpToolDescriptor {
  annotations?: McpToolAnnotations;
  description: string;
  inputSchema: JsonSchemaObject;
  name: string;
  outputSchema?: JsonSchemaObject;
  title?: string;
}

export interface McpToolResult {
  content: (
    | {
        text: string;
        type: 'text';
      }
    | {
        data: string;
        mimeType: string;
        type: 'image';
      }
    | {
        data: unknown;
        type: 'resource';
      }
  )[];
  isError?: boolean;
  structuredContent?: unknown;
}

export function objectSchema(schema: z.ZodType): JsonSchemaObject {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as JsonSchemaObject;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    additionalProperties: false,
    ...jsonSchema,
    type: 'object'
  };
}

export function emptyObjectSchema(): JsonSchemaObject {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    additionalProperties: false,
    properties: {},
    type: 'object'
  };
}

export function textToolResult(text: string, structuredContent?: unknown): McpToolResult {
  return {
    content: [{ text, type: 'text' }],
    structuredContent
  };
}
