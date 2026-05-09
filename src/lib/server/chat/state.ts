/**
 * Per-session in-memory mirrors used by tools that need cross-call state
 * within a single chat turn (planner snapshots, subagent comms, memory).
 *
 * Diagram/code/markdown state was previously mirrored here for the legacy
 * diagramWrite/Patch/Read/Delete and markdownWrite/Read tools. Those tools
 * are gone — file-aware tools now read and write directly through
 * workspace_files via the `target.activeFile` context.
 */
export const memoryStore = new Map<string, string>();
export const planStore = new Map<string, string>();
export const subagentStore = new Map<string, string>();
