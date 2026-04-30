import { agentToolNames, type GraphiniAgentId } from './tool-catalog';

export function pickToolsForAgent<TTool>(
  tools: Record<string, TTool>,
  agentId: GraphiniAgentId
): Partial<Record<string, TTool>> {
  const selected = new Set(agentToolNames[agentId]);
  return Object.fromEntries(Object.entries(tools).filter(([name]) => selected.has(name)));
}

export function pickToolsByName<TTool>(
  tools: Record<string, TTool>,
  toolNames: string[]
): Partial<Record<string, TTool>> {
  const selected = new Set(toolNames);
  return Object.fromEntries(Object.entries(tools).filter(([name]) => selected.has(name)));
}
