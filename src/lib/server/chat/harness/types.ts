export interface WorkspaceTabContext {
  engine: string;
  id?: string;
  title: string;
}

export interface WorkspaceToolContext {
  activeEngine?: string;
  activeTabId?: string;
  activeTabName?: string;
  tabs?: WorkspaceTabContext[];
}
