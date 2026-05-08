export const TOOL_VERBS: Record<string, { pending: string; done: string }> = {
  askQuestions: { pending: 'Asking', done: 'Asked' },
  autoStyler: { pending: 'Styling', done: 'Styled' },
  dataAnalyzer: { pending: 'Analyzing', done: 'Analyzed' },
  diagramDelete: { pending: 'Clearing', done: 'Cleared' },
  diagramRead: { pending: 'Reading', done: 'Read' },
  errorChecker: { pending: 'Checking', done: 'Checked' },
  fileManager: { pending: 'Managing', done: 'Managed' },
  iconSearch: { pending: 'Finding icons', done: 'Found icons' },
  markdownRead: { pending: 'Reading', done: 'Read' },
  markdownWrite: { pending: 'Writing', done: 'Wrote' },
  styleSearch: { pending: 'Styling', done: 'Styled' },
  thinking: { pending: 'Thinking', done: 'Thought' },
  webSearch: { pending: 'Searching', done: 'Searched' }
};

export function toolVerbs(toolName: string): { pending: string; done: string } {
  return TOOL_VERBS[toolName] ?? { pending: 'Running', done: 'Done' };
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  askQuestions: 'Question Tool',
  autoStyler: 'Style Tool',
  dataAnalyzer: 'Data Analyzer',
  diagramDelete: 'Clear Diagram',
  diagramPatch: 'Diagram Patch',
  diagramRead: 'Diagram Read',
  diagramWrite: 'Diagram Write',
  errorChecker: 'Error Checker',
  fileManager: 'Files',
  iconSearch: 'Icon Tool',
  markdownRead: 'Markdown Read',
  markdownWrite: 'Markdown Write',
  styleSearch: 'Style Tool',
  thinking: 'Thinking',
  webSearch: 'Web Search'
};

export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}
