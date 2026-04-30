import { z } from 'zod';

export const A2A_PROTOCOL_VERSION = '0.2.6';

export const a2aTextPartSchema = z.object({
  kind: z.literal('text'),
  metadata: z.record(z.string(), z.unknown()).optional(),
  text: z.string()
});

export const a2aDataPartSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  kind: z.literal('data'),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const a2aFilePartSchema = z.object({
  file: z.object({
    bytes: z.string().optional(),
    mimeType: z.string().optional(),
    name: z.string().optional(),
    uri: z.string().optional()
  }),
  kind: z.literal('file'),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const a2aPartSchema = z.discriminatedUnion('kind', [
  a2aTextPartSchema,
  a2aDataPartSchema,
  a2aFilePartSchema
]);

export const a2aMessageSchema = z.object({
  contextId: z.string().optional(),
  kind: z.literal('message').optional(),
  messageId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  parts: z.array(a2aPartSchema).min(1),
  role: z.enum(['user', 'agent']),
  taskId: z.string().optional()
});

export const a2aSendMessageParamsSchema = z.object({
  configuration: z
    .object({
      acceptedOutputModes: z.array(z.string()).optional(),
      blocking: z.boolean().optional(),
      historyLength: z.number().int().min(0).optional()
    })
    .optional(),
  message: a2aMessageSchema,
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const a2aJsonRpcRequestSchema = z.object({
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown().optional()
});

export type A2APart = z.infer<typeof a2aPartSchema>;
export type A2AMessage = z.infer<typeof a2aMessageSchema>;
export type A2ASendMessageParams = z.infer<typeof a2aSendMessageParamsSchema>;
export type A2AJsonRpcRequest = z.infer<typeof a2aJsonRpcRequestSchema>;

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown';

export interface A2AArtifact {
  artifactId: string;
  description?: string;
  name?: string;
  parts: A2APart[];
}

export interface A2ATask {
  artifacts?: A2AArtifact[];
  contextId: string;
  history?: A2AMessage[];
  id: string;
  kind: 'task';
  metadata?: Record<string, unknown>;
  status: {
    message?: A2AMessage;
    state: A2ATaskState;
    timestamp?: string;
  };
}

export interface A2AAgentCard {
  capabilities: {
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
    streaming?: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  description: string;
  documentationUrl?: string;
  name: string;
  protocolVersion: string;
  security?: Record<string, string[]>[];
  securitySchemes?: Record<string, unknown>;
  skills: {
    description: string;
    examples?: string[];
    id: string;
    inputModes?: string[];
    name: string;
    outputModes?: string[];
    tags?: string[];
  }[];
  url: string;
  version: string;
}

export function jsonRpcResult(id: A2AJsonRpcRequest['id'], result: unknown): Response {
  return Response.json({
    id: id ?? null,
    jsonrpc: '2.0',
    result
  });
}

export function jsonRpcError(
  id: A2AJsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown
): Response {
  return Response.json(
    {
      error: {
        code,
        data,
        message
      },
      id: id ?? null,
      jsonrpc: '2.0'
    },
    { status: code === -32600 || code === -32602 ? 400 : 200 }
  );
}

export function textFromMessage(message: A2AMessage): string {
  return message.parts
    .filter((part): part is Extract<A2APart, { kind: 'text' }> => part.kind === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}
