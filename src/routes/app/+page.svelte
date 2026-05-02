<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { Loader2 as Loader2Spin } from 'lucide-svelte';
  import { authStore } from '$lib/stores/auth.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';

  let error = $state<string | null>(null);

  onMount(async () => {
    if (!authStore.isInitialized) await authStore.init();
    if (!authStore.isLoggedIn) {
      authStore.login(window.location.href);
      return;
    }

    const workspace = await workspaceStore.create('Untitled Workspace', 'mermaid');
    if (workspace) {
      await goto(resolve(`/workspace/${workspace.id}`), { replaceState: true });
      return;
    }

    error = workspaceStore.error || 'Failed to open workspace';
  });
</script>

<div class="flex h-screen items-center justify-center bg-background">
  <div class="flex flex-col items-center gap-3 text-muted-foreground">
    {#if error}
      <span class="text-[13px] text-destructive">{error}</span>
      <button
        type="button"
        class="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted"
        onclick={() => goto(resolve('/app'), { replaceState: true })}>
        Try again
      </button>
    {:else}
      <Loader2Spin class="size-6 animate-spin text-primary" />
      <span class="text-[13px]">Opening workspace...</span>
    {/if}
  </div>
</div>
