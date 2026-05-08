import { z } from 'zod';

export interface WorkspaceToolTab {
  engine: string;
  id?: string;
  title: string;
}

export interface WorkspaceToolTarget {
  activeEngine?: string;
  activeTabId?: string;
  activeTabName?: string;
  tabs?: WorkspaceToolTab[];
}

export interface ToolContext {
  modelId?: string;
  sessionId: string;
  /** Authenticated user (or guest) id. Tools that need per-user keys read this. */
  userId?: string;
  target?: WorkspaceToolTarget;
}

export const targetTabNameSchema = z
  .string()
  .min(1)
  .describe(
    'Exact unique workspace tab name to read or modify. Must match the active tab shown in context.'
  );

export function targetMetadata(target: WorkspaceToolTarget | undefined, targetTabName?: string) {
  return {
    targetEngine: target?.activeEngine,
    targetTabId: target?.activeTabId,
    targetTabName: targetTabName || target?.activeTabName
  };
}

export function validateTargetTab(target: WorkspaceToolTarget | undefined, targetTabName?: string) {
  if (!target?.activeTabName) return null;
  if (!targetTabName) {
    return {
      error: `REJECTED: targetTabName is required. Use "${target.activeTabName}".`,
      hint: 'Every workspace tool call must include the exact active tab name.'
    };
  }
  if (targetTabName !== target.activeTabName) {
    return {
      error: `REJECTED: Tool targeted "${targetTabName}", but the active tab is "${target.activeTabName}".`,
      hint: 'Switch to the intended tab first, then call the tool with that exact tab name.'
    };
  }
  return null;
}

export function validateMermaidTarget(
  target: WorkspaceToolTarget | undefined,
  targetTabName?: string
) {
  const tabError = validateTargetTab(target, targetTabName);
  if (tabError) return tabError;
  if (target?.activeEngine && target.activeEngine !== 'mermaid') {
    return {
      error: `REJECTED: The active tab "${target.activeTabName ?? 'Untitled'}" is ${target.activeEngine}, not Mermaid.`,
      hint: 'Use the tool category that matches the active tab engine.'
    };
  }
  return null;
}
