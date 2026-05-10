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
    if (
      p.includes('openai') ||
      m.includes('gpt') ||
      m.includes('o1') ||
      m.includes('o3') ||
      m.includes('o4')
    )
      return 'openai';
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
    <path
      d="M17.3 3.7h-3.5l6.4 16.6h3.5L17.3 3.7zM6.7 3.7L.3 20.3h3.6l1.3-3.4h6.7l1.3 3.4h3.6L10.4 3.7H6.7zm-.4 10.2L8.5 8l2.2 5.9H6.3z" />
  </svg>
{:else if kind === 'openai'}
  <svg viewBox="0 0 320 320" fill="currentColor" class={className} aria-hidden="true">
    <path
      d="M297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68C188.12 9.63 166.21-.14 143.24 0c-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zM176.78 299.08c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zM47.94 244.05c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83L129.87 266c-28.69 16.52-65.33 6.7-81.92-21.95zM31.17 104.96c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91L118.44 224c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92V92c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74V80.86c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07L116 72.67c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zM125.35 140 160 119.99l34.65 20V180L160 200l-34.65-20z" />
  </svg>
{:else if kind === 'google'}
  <img src="/brand/gemini.svg" alt="" class={className} aria-hidden="true" />
{:else if kind === 'mistral'}
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path d="M3 3h4v4H3zm0 7h4v4H3zm0 7h4v4H3zm7-7h4v4h-4zm7-7h4v4h-4zm0 7h4v4h-4zm0 7h4v4h-4z" />
  </svg>
{:else if kind === 'meta'}
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path
      d="M12 4.5c-3.3 0-5.5 2.5-5.5 5s2.2 5 5.5 5c1.7 0 3-.6 4-1.7 1 1.1 2.3 1.7 4 1.7 3.3 0 5.5-2.5 5.5-5s-2.2-5-5.5-5c-1.7 0-3 .6-4 1.7-1-1.1-2.3-1.7-4-1.7zm0 2c2.2 0 3.5 1.6 3.5 3s-1.3 3-3.5 3-3.5-1.6-3.5-3 1.3-3 3.5-3zm8 0c2.2 0 3.5 1.6 3.5 3s-1.3 3-3.5 3-3.5-1.6-3.5-3 1.3-3 3.5-3z" />
  </svg>
{:else if kind === 'xai'}
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path d="M3 3l8 8-8 10h4l6-7.5L18.5 21H22L13 11l8-8h-4l-5.5 7L6.5 3z" />
  </svg>
{:else if kind === 'deepseek'}
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path
      d="M12 2a10 10 0 1 0 10 10 10 10 0 0 0-10-10zm0 4a6 6 0 1 1-6 6 6 6 0 0 1 6-6zm0 2.5A3.5 3.5 0 1 0 15.5 12 3.5 3.5 0 0 0 12 8.5z" />
  </svg>
{:else if kind === 'qwen'}
  <svg viewBox="0 0 24 24" fill="currentColor" class={className} aria-hidden="true">
    <path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z" />
  </svg>
{:else}
  <!-- OpenRouter (default) -->
  <svg
    fill="currentColor"
    fill-rule="evenodd"
    viewBox="0 0 24 24"
    class={className}
    aria-hidden="true">
    <path
      d="M16.804 1.957l7.22 4.105v.087L16.73 10.21l.017-2.117-.821-.03c-1.059-.028-1.611.002-2.268.11-1.064.175-2.038.577-3.147 1.352L8.345 11.03c-.284.195-.495.336-.68.455l-.515.322-.397.234.385.23.53.338c.476.314 1.17.796 2.701 1.866 1.11.775 2.083 1.177 3.147 1.352l.3.045c.694.091 1.375.094 2.825.033l.022-2.159 7.22 4.105v.087L16.589 22l.014-1.862-.635.022c-1.386.042-2.137.002-3.138-.162-1.694-.28-3.26-.926-4.881-2.059l-2.158-1.5a21.997 21.997 0 0 0-.755-.498l-.467-.28a55.927 55.927 0 0 0-.76-.43C2.908 14.73.563 14.116 0 14.116V9.888l.14.004c.564-.007 2.91-.622 3.809-1.124l1.016-.58.438-.274c.428-.28 1.072-.726 2.686-1.853 1.621-1.133 3.186-1.78 4.881-2.059 1.152-.19 1.974-.213 3.814-.138l.02-1.907z" />
  </svg>
{/if}
