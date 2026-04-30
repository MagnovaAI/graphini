import { createOpenRouter } from '@openrouter/ai-sdk-provider';

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error('OPENROUTER_API_KEY is not set');
}

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY
});

export function openrouterFastChat(modelId: string) {
  return openrouter.chat(modelId, {
    includeReasoning: true,
    reasoning: {
      enabled: true,
      exclude: false,
      max_tokens: 96
    }
  });
}
