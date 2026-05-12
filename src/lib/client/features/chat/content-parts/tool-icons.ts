import {
  Box,
  ChartBar,
  FileCode,
  FileJson,
  FilePenLine,
  FilePlus,
  FileSearch,
  FileText,
  FileX,
  FolderInput,
  FolderX,
  Globe,
  Lightbulb,
  List,
  MessageCircleQuestion,
  Paintbrush,
  Palette,
  ScrollText,
  Search,
  ShieldCheck,
  Workflow
} from 'lucide-svelte';
import type { Component } from 'svelte';

type IconComponent = Component<{ class?: string }>;

// lucide-svelte exports Svelte 4-style components; cast through `unknown` to
// satisfy our Svelte 5 Component<...> contract. Runtime-compatible.
const i = (icon: unknown) => icon as IconComponent;

const ICON_BY_TOOL: Record<string, IconComponent> = {
  askQuestions: i(MessageCircleQuestion),
  autoStyler: i(Paintbrush),
  dataAnalyzer: i(ChartBar),
  errorChecker: i(ShieldCheck),
  fileSystem: i(FilePenLine),
  iconSearch: i(Search),
  personalization: i(ScrollText),
  styleSearch: i(Palette),
  thinking: i(Lightbulb),
  useSkill: i(Box),
  webSearch: i(Globe)
};

function normalizedFileOperation(operation: string): string {
  if (operation === 'update' || operation === 'patch') return 'edit';
  return operation;
}

const ICON_BY_FILE_OPERATION: Record<string, IconComponent> = {
  create: i(FilePlus),
  delete: i(FileX),
  deleteFolder: i(FolderX),
  edit: i(FilePenLine),
  grep: i(Search),
  list: i(List),
  moveFolder: i(FolderInput),
  read: i(FileSearch)
};

const ICON_BY_FILE_KIND: Record<string, IconComponent> = {
  json: i(FileJson),
  md: i(FileText),
  mermaid: i(FileCode),
  mmd: i(FileCode),
  yaml: i(FileJson),
  yml: i(FileJson)
};

/**
 * Resolve the icon for a tool call. `fileSystem` gets operation-level icons,
 * with a file-extension fallback for partially streamed calls.
 */
export function toolIcon(
  toolName: string,
  input?: { path?: unknown; from?: unknown; operation?: unknown }
): IconComponent {
  if (toolName === 'fileSystem' && input) {
    if (typeof input.operation === 'string') {
      const byOperation = ICON_BY_FILE_OPERATION[normalizedFileOperation(input.operation)];
      if (byOperation) return byOperation;
    }
    const candidate =
      typeof input.path === 'string'
        ? input.path
        : typeof input.from === 'string'
          ? input.from
          : '';
    const dot = candidate.lastIndexOf('.');
    if (dot >= 0) {
      const ext = candidate.slice(dot + 1).toLowerCase();
      const byKind = ICON_BY_FILE_KIND[ext];
      if (byKind) return byKind;
    }
    return ICON_BY_FILE_OPERATION.edit;
  }
  return ICON_BY_TOOL[toolName] ?? i(Workflow);
}
