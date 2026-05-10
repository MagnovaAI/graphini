import { describe, expect, it } from 'vitest';
import { validateMermaidSyntaxServer } from '../../src/lib/server/chat/mermaid';

describe('validateMermaidSyntaxServer', () => {
  it('reports Mermaid parse failures that the model must see', async () => {
    const result = await validateMermaidSyntaxServer(
      'flowchart TD\n  A[Load Balancer<br/>(Single Tier)] e'
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.line).toBe(2);
      expect(result.error.message).toContain('Parse error');
    }
  });

  it('accepts simple valid flowcharts', async () => {
    await expect(
      validateMermaidSyntaxServer('flowchart TD\n  A[Start] --> B[End]')
    ).resolves.toEqual({ valid: true });
  });
});
