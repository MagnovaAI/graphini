export interface WorkspaceTabContext {
  engine: string;
  id?: string;
  title: string;
}

export interface ActiveFileContext {
  id: string;
  path: string;
  kind: 'md' | 'json' | 'yaml' | 'mermaid';
}

export interface WorkspaceToolContext {
  activeEngine?: string;
  activeTabId?: string;
  activeTabName?: string;
  tabs?: WorkspaceTabContext[];
  /** When the user has a workspace file open, file-aware tools route through it. */
  activeFile?: ActiveFileContext;
}
