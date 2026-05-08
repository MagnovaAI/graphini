<script lang="ts">
  import { loadingStateStore } from '$lib/client/util/loading';
  import { toggleDarkTheme } from '$lib/client/util/state/state';
  import { initHandler } from '$lib/client/util/bootstrap';
  import { Toaster } from '$lib/client/ui/sonner/index.js';
  import { authStore } from '$lib/client/stores/auth.svelte.js';
  import { kv } from '$lib/client/stores/kvStore.svelte';
  import { uiSettings } from '$lib/client/stores/settings.svelte';
  import { toolsStore } from '$lib/client/stores/toolsStore.svelte';
  import { mode, ModeWatcher, setMode } from 'mode-watcher';
  import { onMount, type Snippet } from 'svelte';
  import '../app.css';

  let { children }: { children: Snippet } = $props();

  // Register KV store instance globally for synchronous access from .svelte.ts files
  (globalThis as any).__kvStoreModule = kv;
  // Initialize KV store (loads all user settings from Supabase)
  kv.init().then(() => toolsStore.syncFromKv());

  async function initializeClientState() {
    await authStore.init();
    await kv.init({ force: true });
    toolsStore.syncFromKv();
    setMode(uiSettings.value.theme);
  }

  // This can be removed once https://github.com/sveltejs/kit/issues/1612 is fixed.
  onMount(() => {
    // Initialize auth store to check for existing session
    void initializeClientState();

    window.addEventListener('hashchange', () => {
      void initHandler();
    });

    // Apply initial theme class
    const currentMode = $mode;
    if (currentMode === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Service worker disabled — no service-worker.js exists
    // Unregister any stale service workers from previous deployments
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
      });
    }
  });

  $effect(() => {
    toggleDarkTheme($mode === 'dark');
    // Apply dark class to HTML element for CSS styling
    if ($mode === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  });
</script>

<ModeWatcher />
<Toaster />

<main class="h-[100dvh]">
  {@render children()}
</main>

{#if $loadingStateStore.loading}
  <div
    class="absolute top-0 left-0 z-50 flex h-screen w-screen justify-center bg-background/60 align-middle backdrop-blur-sm">
    <div class="my-auto text-[22px] font-semibold text-foreground">
      <div class="loader mx-auto"></div>
      <div>{$loadingStateStore.message}</div>
    </div>
  </div>
{/if}

<style>
  .loader {
    border: 0.45em solid color-mix(in oklch, var(--color-border), transparent 30%);
    border-radius: 50%;
    border-top: 0.45em solid var(--color-primary);
    width: 3em;
    height: 3em;
    -webkit-animation: spin 2s linear infinite; /* Safari */
    animation: spin 2s linear infinite;
  }

  /* Safari */
  @-webkit-keyframes spin {
    0% {
      -webkit-transform: rotate(0deg);
    }
    100% {
      -webkit-transform: rotate(360deg);
    }
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
