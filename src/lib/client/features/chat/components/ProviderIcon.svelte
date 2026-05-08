<script lang="ts">
  interface Props {
    provider?: string | null;
    modelId?: string | null;
    class?: string;
  }
  let { provider = '', modelId = '', class: className = 'size-3.5' }: Props = $props();

  let kind = $derived.by(() => {
    const p = (provider || '').toLowerCase();
    const m = (modelId || '').toLowerCase();
    if (p.includes('anthropic') || m.includes('claude')) return 'anthropic';
    if (p.includes('openai') || m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'openai';
    if (p.includes('google') || p.includes('gemini') || m.includes('gemini')) return 'google';
    if (p.includes('mistral') || m.includes('mistral')) return 'mistral';
    if (p.includes('meta') || m.includes('llama')) return 'meta';
    if (p.includes('xai') || m.includes('grok')) return 'xai';
    if (p.includes('deepseek') || m.includes('deepseek')) return 'deepseek';
    if (p.includes('qwen') || m.includes('qwen')) return 'qwen';
    if (p.includes('openrouter')) return 'openrouter';
    return 'openrouter';
  });
</script>

{#if kind === 'anthropic'}
  <!-- Anthropic asterisk -->
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path d="M17.3 3.7h-3.5l6.4 16.6h3.5L17.3 3.7zM6.7 3.7L.3 20.3h3.6l1.3-3.4h6.7l1.3 3.4h3.6L10.4 3.7H6.7zm-.4 10.2L8.5 8l2.2 5.9H6.3z"/>
  </svg>
{:else if kind === 'openai'}
  <!-- OpenAI knot -->
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
  </svg>
{:else if kind === 'google'}
  <!-- Gemini spark -->
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path d="M12 2 L13.5 9 L21 12 L13.5 14.5 L12 22 L10.5 14.5 L3 12 L10.5 9 Z"/>
  </svg>
{:else if kind === 'mistral'}
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path d="M3 3h4v4H3zm0 7h4v4H3zm0 7h4v4H3zm7-7h4v4h-4zm7-7h4v4h-4zm0 7h4v4h-4zm0 7h4v4h-4z"/>
  </svg>
{:else if kind === 'meta'}
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path d="M12 4.5c-3.3 0-5.5 2.5-5.5 5s2.2 5 5.5 5c1.7 0 3-.6 4-1.7 1 1.1 2.3 1.7 4 1.7 3.3 0 5.5-2.5 5.5-5s-2.2-5-5.5-5c-1.7 0-3 .6-4 1.7-1-1.1-2.3-1.7-4-1.7zm0 2c2.2 0 3.5 1.6 3.5 3s-1.3 3-3.5 3-3.5-1.6-3.5-3 1.3-3 3.5-3zm8 0c2.2 0 3.5 1.6 3.5 3s-1.3 3-3.5 3-3.5-1.6-3.5-3 1.3-3 3.5-3z"/>
  </svg>
{:else if kind === 'xai'}
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path d="M3 3l8 8-8 10h4l6-7.5L18.5 21H22L13 11l8-8h-4l-5.5 7L6.5 3z"/>
  </svg>
{:else if kind === 'deepseek'}
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path d="M12 2a10 10 0 1 0 10 10 10 10 0 0 0-10-10zm0 4a6 6 0 1 1-6 6 6 6 0 0 1 6-6zm0 2.5A3.5 3.5 0 1 0 15.5 12 3.5 3.5 0 0 0 12 8.5z"/>
  </svg>
{:else if kind === 'qwen'}
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z"/>
  </svg>
{:else}
  <!-- OpenRouter (default) -->
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={className} aria-hidden="true">
    <path d="M3 12h6"/>
    <path d="M15 12h6"/>
    <circle cx="6" cy="6" r="2"/>
    <circle cx="6" cy="18" r="2"/>
    <circle cx="18" cy="12" r="2"/>
    <path d="M8 6h2a3 3 0 0 1 3 3v0a3 3 0 0 0 3 3"/>
    <path d="M8 18h2a3 3 0 0 0 3-3v0a3 3 0 0 1 3-3"/>
  </svg>
{/if}
