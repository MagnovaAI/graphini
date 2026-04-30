import { A2A_PROTOCOL_VERSION, type A2AAgentCard } from '$lib/server/agents/a2a';
import { listMcpTools } from '$lib/server/agents/tool-catalog';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
  const origin = url.origin;
  const tools = listMcpTools();

  const card: A2AAgentCard = {
    capabilities: {
      pushNotifications: false,
      stateTransitionHistory: true,
      streaming: false
    },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json', 'text/markdown', 'text/vnd.mermaid'],
    description:
      'Graphini multi-agent workspace for Mermaid diagrams, architecture planning, visual polish, document drafting, and file/data analysis.',
    documentationUrl: `${origin}/docs`,
    name: 'Graphini Agent Mesh',
    protocolVersion: A2A_PROTOCOL_VERSION,
    skills: [
      {
        description: 'Plan complex architecture and diagram tasks before execution.',
        examples: [
          'Design a multi-tenant SaaS architecture diagram with risks and deployment flow.'
        ],
        id: 'planner',
        inputModes: ['text/plain'],
        name: 'Planner Agent',
        outputModes: ['application/json', 'text/plain'],
        tags: ['planning', 'architecture']
      },
      {
        description: 'Create, edit, patch, and validate Mermaid diagrams.',
        examples: ['Create a service architecture diagram for a GraphQL API with cache and queue.'],
        id: 'diagram-engineer',
        inputModes: ['text/plain', 'text/vnd.mermaid'],
        name: 'Diagram Engineer Agent',
        outputModes: ['text/vnd.mermaid', 'application/json'],
        tags: ['mermaid', 'diagram', 'editing']
      },
      {
        description: 'Improve diagram readability with labels, colors, grouping, and icons.',
        examples: ['Make this diagram clearer and add appropriate technology icons.'],
        id: 'visual-polish',
        inputModes: ['text/vnd.mermaid', 'text/plain'],
        name: 'Visual Polish Agent',
        outputModes: ['text/vnd.mermaid', 'application/json'],
        tags: ['style', 'icons', 'readability']
      },
      {
        description: 'Write and revise architecture notes, summaries, and implementation docs.',
        examples: ['Write a rollout plan that matches the current diagram.'],
        id: 'document-agent',
        inputModes: ['text/plain', 'text/markdown'],
        name: 'Document Agent',
        outputModes: ['text/markdown', 'application/json'],
        tags: ['markdown', 'documentation']
      },
      {
        description: 'Analyze uploaded files and tabular data for diagram or chart generation.',
        examples: ['Summarize the uploaded CSV and suggest a Mermaid chart.'],
        id: 'data-agent',
        inputModes: [
          'text/plain',
          'text/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ],
        name: 'Data Agent',
        outputModes: ['application/json', 'text/markdown'],
        tags: ['files', 'csv', 'analytics']
      },
      {
        description: 'Review diagrams and documents for correctness, completeness, and clarity.',
        examples: ['Review this cloud architecture diagram for missing production concerns.'],
        id: 'critic',
        inputModes: ['text/plain', 'text/vnd.mermaid', 'text/markdown'],
        name: 'Critic Agent',
        outputModes: ['application/json', 'text/plain'],
        tags: ['review', 'quality']
      }
    ],
    url: `${origin}/api/a2a`,
    version: '0.1.0'
  };

  return Response.json({
    ...card,
    metadata: {
      mcpToolsUrl: `${origin}/api/mcp/tools`,
      toolCount: tools.length
    }
  });
};
