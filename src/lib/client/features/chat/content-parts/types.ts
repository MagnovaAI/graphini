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
  operation: 'create' | 'edit' | 'delete' | 'read';
  isStreaming: boolean;
  title: string;
  /** Full workspace path of the target file, used for the header filename
      tooltip and click-to-open. Always the unmodified tool input path. */
  path?: string;
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
      /**
       * Parsed tool input — used by per-operation icon resolution for file
       * tools. Workspace file icons also consider the extension in `path`.
       */
      toolInput?: { path?: unknown; from?: unknown; operation?: unknown };
      /**
       * Structured search results, when the tool produced them (webSearch).
       * Renderers should prefer this over `details` when present.
       */
      searchResults?: {
        title: string;
        snippet?: string;
        url?: string;
        source?: string;
      }[];
    }
  | {
      /**
       * Output of the `thinking` tool. Rendered as a Chain of Thought block;
       * never goes through the generic tool-simple chip.
       */
      type: 'chain-of-thought';
      id: string;
      status: 'running' | 'done';
      thoughts: { label: string; detail?: string }[];
      conclusion?: string;
    };

export type ToolSimplePart = Extract<ContentPart, { type: 'tool-simple' }>;

export type DisplayContentPart =
  | ContentPart
  | {
      // Two or more contiguous tool-simple parts grouped under a single
      // ChainOfThought presentation. Single tool-simple parts stay as-is.
      type: 'thought-chain';
      id: string;
      parts: ToolSimplePart[];
      status: 'running' | 'done';
    };
