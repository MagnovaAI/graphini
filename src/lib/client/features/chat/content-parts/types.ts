export interface QuestionnaireQuestion {
  id: string;
  text: string;
  type: 'single' | 'multi';
  options: { id: string; label: string }[];
}

export interface Artifact {
  id: string;
  code: string;
  previousCode: string;
  operation: 'create' | 'update' | 'patch' | 'delete' | 'read';
  isStreaming: boolean;
  title: string;
  language?: string;
  hasErrors?: boolean;
  errors?: string[];
  readFrom?: number;
  readTo?: number;
  totalLines?: number;
}

export interface Checkpoint {
  code: string;
  messageIndex: number;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; id: string }
  | { type: 'artifact'; artifactId: string }
  | { type: 'reasoning'; id: string; text: string; status: 'running' | 'done' }
  | { type: 'error'; error: string; userMessage?: string }
  | {
      type: 'questionnaire';
      id: string;
      context: string;
      questions: QuestionnaireQuestion[];
      isStreaming?: boolean;
      submitted?: boolean;
    }
  | {
      type: 'markdown';
      id: string;
      content: string;
      operation: 'read' | 'write' | 'append';
      lines: number;
      isStreaming?: boolean;
    }
  | {
      type: 'tool-simple';
      id: string;
      toolName: string;
      titlePending: string;
      titleDone: string;
      subtitle?: string;
      status: 'running' | 'done';
      details?: string[];
    };

export type PatchChainPart = Extract<ContentPart, { type: 'artifact' }>;
export type ToolSimplePart = Extract<ContentPart, { type: 'tool-simple' }>;

export type DisplayContentPart =
  | ContentPart
  | {
      type: 'tool-chain';
      id: string;
      parts: PatchChainPart[];
      status: 'running' | 'done';
    }
  | {
      // Two or more contiguous tool-simple parts grouped under a single
      // ChainOfThought presentation. Single tool-simple parts stay as-is.
      type: 'thought-chain';
      id: string;
      parts: ToolSimplePart[];
      status: 'running' | 'done';
    };
