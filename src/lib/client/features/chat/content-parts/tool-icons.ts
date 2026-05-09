import {
  ChartBar,
  FileCode,
  FileJson,
  FileText,
  FolderTree,
  Globe,
  Lightbulb,
  MessageCircleQuestion,
  Paintbrush,
  Palette,
  ShieldCheck,
  Wrench
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
  fileManager: i(FileText),
  fileSystem: i(FolderTree),
  iconSearch: i(Palette),
  styleSearch: i(Paintbrush),
  thinking: i(Lightbulb),
  webSearch: i(Globe)
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
 * Resolve the icon for a tool call. For `fileSystem`, the icon varies by the
 * file extension in the `path` argument so the chain-of-tools display reflects
 * what the model is actually editing (.md, .json, .yaml, .mermaid).
 */
export function toolIcon(
  toolName: string,
  input?: { path?: unknown; from?: unknown }
): IconComponent {
  if (toolName === 'fileSystem' && input) {
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
    return ICON_BY_TOOL.fileSystem;
  }
  return ICON_BY_TOOL[toolName] ?? i(Wrench);
}
