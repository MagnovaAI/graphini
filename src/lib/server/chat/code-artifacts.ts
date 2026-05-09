import { MERMAID_DIAGRAM_DECLARATION } from './mermaid';

export type CodeArtifactLanguage =
  | 'json'
  | 'yaml'
  | 'typescript'
  | 'javascript'
  | 'svelte'
  | 'html'
  | 'css'
  | 'markdown'
  | 'text';

export function detectCodeLanguage(code: string): CodeArtifactLanguage {
  const trimmed = code.trim();
  if (!trimmed) return 'text';
  if (/^---\n/.test(trimmed) || /^[\w-]+:\s/m.test(trimmed)) return 'yaml';
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || trimmed.startsWith('[')) return 'json';
  if (/^(#{1,6}\s|[-*]\s|\d+\.\s|>\s|```)/m.test(trimmed)) return 'markdown';
  if (trimmed.includes('<script') && trimmed.includes('</script>')) return 'svelte';
  if (/^<!doctype html/i.test(trimmed) || /<\/?[a-z][\s\S]*>/i.test(trimmed)) return 'html';
  if (/\b(import|export|interface|type)\b/.test(trimmed)) return 'typescript';
  if (/\b(function|const|let|var)\b/.test(trimmed)) return 'javascript';
  return 'text';
}

export function validateCodeArtifact(
  code: string,
  language: CodeArtifactLanguage
): { valid: true } | { error: string; valid: false } {
  const trimmed = code.trim();

  if (MERMAID_DIAGRAM_DECLARATION.test(trimmed)) {
    return {
      error:
        'REJECTED: code tools are for non-Mermaid code. Use fileSystem with a .mermaid file for Mermaid.',
      valid: false
    };
  }

  if (language === 'json') {
    try {
      JSON.parse(trimmed);
    } catch (e) {
      return {
        error: `Invalid JSON: ${e instanceof Error ? e.message : 'parse failed'}`,
        valid: false
      };
    }
  }

  return { valid: true };
}
