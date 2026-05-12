export const TOOL_VERBS: Record<string, { pending: string; done: string }> = {
  askQuestions: { pending: 'Asking', done: 'Asked' },
  autoStyler: { pending: 'Styling', done: 'Styled' },
  dataAnalyzer: { pending: 'Analyzing', done: 'Analyzed' },
  errorChecker: { pending: 'Checking', done: 'Checked' },
  fileSystem: { pending: 'Editing', done: 'Edited' },
  iconSearch: { pending: 'Finding icons', done: 'Found icons' },
  styleSearch: { pending: 'Finding styles', done: 'Found styles' },
  thinking: { pending: 'Thinking', done: 'Thought' },
  useSkill: { pending: 'Loading skill', done: 'Loaded skill' },
  webSearch: { pending: 'Searching', done: 'Searched' }
};

function normalizedFileOperation(operation: string): string {
  if (operation === 'update' || operation === 'patch') return 'edit';
  return operation;
}

const FILE_SYSTEM_VERBS: Record<string, { pending: string; done: string }> = {
  create: { pending: 'Creating file', done: 'Created file' },
  delete: { pending: 'Deleting file', done: 'Deleted file' },
  deleteFolder: { pending: 'Deleting folder', done: 'Deleted folder' },
  edit: { pending: 'Editing file', done: 'Edited file' },
  grep: { pending: 'Searching files', done: 'Searched files' },
  list: { pending: 'Listing workspace', done: 'Listed workspace' },
  moveFolder: { pending: 'Moving folder', done: 'Moved folder' },
  read: { pending: 'Reading file', done: 'Read file' }
};

export function toolVerbs(
  toolName: string,
  input?: { operation?: unknown }
): { pending: string; done: string } {
  if (toolName === 'fileSystem' && input && typeof input.operation === 'string') {
    const verb = FILE_SYSTEM_VERBS[normalizedFileOperation(input.operation)];
    if (verb) return verb;
  }
  const fallbackName = getToolDisplayName(toolName);
  return (
    TOOL_VERBS[toolName] ?? {
      done: `${fallbackName} finished`,
      pending: `Running ${fallbackName}`
    }
  );
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  askQuestions: 'Questions',
  autoStyler: 'Auto Styler',
  dataAnalyzer: 'Data Analyzer',
  errorChecker: 'Error Checker',
  fileSystem: 'Workspace Files',
  iconSearch: 'Icon Search',
  styleSearch: 'Style Search',
  thinking: 'Thinking',
  useSkill: 'Skill',
  webSearch: 'Web Search'
};

function humanizeToolName(toolName: string): string {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? humanizeToolName(toolName);
}
