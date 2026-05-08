import {
  ChartBar,
  Eye,
  FileText,
  Globe,
  Lightbulb,
  MessageCircleQuestion,
  Paintbrush,
  Palette,
  ShieldCheck,
  Trash2,
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
  diagramDelete: i(Trash2),
  diagramRead: i(Eye),
  errorChecker: i(ShieldCheck),
  fileManager: i(FileText),
  iconSearch: i(Palette),
  iconifier: i(Palette),
  styleSearch: i(Paintbrush),
  thinking: i(Lightbulb),
  webSearch: i(Globe)
};

export function toolIcon(toolName: string): IconComponent {
  return ICON_BY_TOOL[toolName] ?? i(Wrench);
}
