<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Textarea } from '$lib/components/ui/textarea';
  import { cn } from '$lib/utils.js';
  import { ArrowRight, Bot, Check, ChevronDown, Paperclip } from 'lucide-svelte';

  interface ModelOption {
    label: string;
    provider: 'openai' | 'gemini' | 'anthropic' | 'generic';
  }

  interface Props {
    class?: string;
    placeholder?: string;
    onSubmit?: (message: string, model: string) => void;
  }

  let {
    class: className,
    placeholder = 'What can I do for you?',
    onSubmit = () => {}
  }: Props = $props();

  const models: ModelOption[] = [
    { label: 'o3-mini', provider: 'openai' },
    { label: 'Gemini 2.5 Flash', provider: 'gemini' },
    { label: 'Claude 3.5 Sonnet', provider: 'anthropic' },
    { label: 'GPT-4-1 Mini', provider: 'openai' },
    { label: 'GPT-4-1', provider: 'openai' }
  ];

  let value = $state('');
  let selectedModel = $state(models[3]);
  let textarea: HTMLTextAreaElement | null = $state(null);

  function adjustHeight(reset = false) {
    if (!textarea) return;

    textarea.style.height = '72px';
    if (reset) return;

    const nextHeight = Math.max(72, Math.min(textarea.scrollHeight, 300));
    textarea.style.height = `${nextHeight}px`;
  }

  function submitMessage() {
    const message = value.trim();
    if (!message) return;

    onSubmit(message, selectedModel.label);
    value = '';
    requestAnimationFrame(() => adjustHeight(true));
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && value.trim()) {
      event.preventDefault();
      submitMessage();
    }
  }
</script>

{#snippet OpenAiIcon()}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 256 260"
    aria-label="OpenAI icon"
    class="size-4">
    <path
      d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z"
      fill="currentColor" />
  </svg>
{/snippet}

{#snippet ModelIcon(model: ModelOption)}
  {#if model.provider === 'openai'}
    {@render OpenAiIcon()}
  {:else if model.provider === 'gemini'}
    <svg class="size-4" viewBox="0 0 24 24" aria-label="Gemini icon">
      <defs>
        <linearGradient id="graphini-gemini-fill" x1="0%" x2="68.73%" y1="100%" y2="30.395%">
          <stop offset="0%" stop-color="#1c7dff" />
          <stop offset="52.021%" stop-color="#1c69ff" />
          <stop offset="100%" stop-color="#f0dcd6" />
        </linearGradient>
      </defs>
      <path
        d="M12 24A14.304 14.304 0 0 0 0 12 14.304 14.304 0 0 0 12 0a14.305 14.305 0 0 0 12 12 14.305 14.305 0 0 0-12 12"
        fill="url(#graphini-gemini-fill)" />
    </svg>
  {:else if model.provider === 'anthropic'}
    <svg class="size-4" viewBox="0 0 24 24" aria-label="Anthropic icon">
      <path
        fill="currentColor"
        fill-rule="evenodd"
        d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z" />
    </svg>
  {:else}
    <Bot class="size-4 opacity-60" />
  {/if}
{/snippet}

<div class={cn('animated-ai-input w-full max-w-3xl', className)}>
  <div class="rounded-2xl bg-black/5 p-2">
    <div class="relative flex flex-col">
      <Textarea
        bind:ref={textarea}
        bind:value
        id="homepage-ai-input"
        aria-label="Describe your diagram"
        {placeholder}
        class="min-h-[72px] resize-none rounded-xl rounded-b-none border-none bg-black/5 px-4 py-3 text-[13px] text-neutral-950 shadow-none placeholder:text-black/60 focus-visible:ring-0 dark:bg-white/5 dark:text-white dark:placeholder:text-white/70"
        style="max-height: 300px;"
        oninput={() => adjustHeight()}
        onkeydown={handleKeydown} />

      <div class="h-14 rounded-b-xl bg-black/5">
        <div class="absolute right-3 bottom-3 left-3 flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                class="flex h-8 max-w-[190px] items-center gap-1 rounded-md px-2 text-[13px] font-semibold text-neutral-900 transition hover:bg-black/10 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none dark:text-white dark:hover:bg-white/10"
                aria-label="Select model">
                {@render ModelIcon(selectedModel)}
                <span class="truncate">{selectedModel.label}</span>
                <ChevronDown class="size-3 opacity-50" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start" class="min-w-48 border-black/10">
                {#each models as model (model.label)}
                  <DropdownMenu.Item onclick={() => (selectedModel = model)}>
                    {@render ModelIcon(model)}
                    <span>{model.label}</span>
                    {#if selectedModel.label === model.label}
                      <Check class="ml-auto size-4 text-primary" />
                    {/if}
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>

            <div class="h-4 w-px bg-black/10 dark:bg-white/10"></div>

            <label
              class="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-black/5 text-black/45 transition focus-within:ring-1 focus-within:ring-ring hover:bg-black/10 hover:text-black dark:bg-white/5 dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Attach file">
              <input type="file" class="sr-only" />
              <Paperclip class="size-4" />
            </label>
          </div>

          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            class="rounded-lg bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
            aria-label="Send message"
            disabled={!value.trim()}
            onclick={submitMessage}>
            <ArrowRight
              class={cn(
                'size-4 transition-opacity',
                value.trim() ? 'opacity-100' : 'opacity-30'
              )} />
          </Button>
        </div>
      </div>
    </div>
  </div>
</div>
