export const TOOL_VERBS: Record<string, { pending: string; done: string }> = {
  askQuestions: { pending: 'Asking', done: 'Asked' },
  autoStyler: { pending: 'Styling', done: 'Styled' },
  dataAnalyzer: { pending: 'Analyzing', done: 'Analyzed' },
  errorChecker: { pending: 'Checking', done: 'Checked' },
  fileManager: { pending: 'Managing', done: 'Managed' },
  fileSystem: { pending: 'Working with files', done: 'Files updated' },
  iconSearch: { pending: 'Finding icons', done: 'Found icons' },
  styleSearch: { pending: 'Styling', done: 'Styled' },
  thinking: { pending: 'Thinking', done: 'Thought' },
  webSearch: { pending: 'Searching', done: 'Searched' }
};

const FILE_SYSTEM_VERBS: Record<string, { pending: string; done: string }> = {
  create: { pending: 'Creating', done: 'Created' },
  delete: { pending: 'Deleting', done: 'Deleted' },
  deleteFolder: { pending: 'Deleting folder', done: 'Deleted folder' },
  list: { pending: 'Listing files', done: 'Listed files' },
  moveFolder: { pending: 'Moving folder', done: 'Moved folder' },
  patch: { pending: 'Patching', done: 'Patched' },
  read: { pending: 'Reading', done: 'Read' },
  update: { pending: 'Updating', done: 'Updated' }
};

export function toolVerbs(
  toolName: string,
  input?: { operation?: unknown }
): { pending: string; done: string } {
  if (toolName === 'fileSystem' && input && typeof input.operation === 'string') {
    const verb = FILE_SYSTEM_VERBS[input.operation];
    if (verb) return verb;
  }
  return TOOL_VERBS[toolName] ?? { pending: 'Running', done: 'Done' };
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  askQuestions: 'Question Tool',
  autoStyler: 'Style Tool',
  dataAnalyzer: 'Data Analyzer',
  errorChecker: 'Error Checker',
  fileManager: 'Files',
  fileSystem: 'File System',
  iconSearch: 'Icon Tool',
  styleSearch: 'Style Tool',
  thinking: 'Thinking',
  webSearch: 'Web Search'
};

export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}
