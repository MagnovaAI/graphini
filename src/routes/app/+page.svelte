<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { Loader2 as Loader2Spin } from 'lucide-svelte';
  import { authStore } from '$lib/stores/auth.svelte';
  import { conversationsStore } from '$lib/stores/conversations.svelte';

  let error = $state<string | null>(null);

  onMount(async () => {
    if (!authStore.isInitialized) await authStore.init();
    // Either signed-in or guest is fine — fetchMe() guarantees a user (the
    // guest cookie is upgraded to a synthetic user row server-side).
    if (!authStore.hasSession) {
      // Re-init in case the cookie was just set; if still nothing, fall back
      // to login. This should be rare.
      await authStore.init();
      if (!authStore.hasSession) {
        authStore.login(window.location.href);
        return;
      }
    }

    const userId = authStore.user?.id;
    if (!userId) {
      error = 'Could not resolve account id';
      return;
    }

    // Preserve a `?prompt=` if the user landed here from the homepage. When a
    // prompt is provided we always create a fresh chat so the prompt does not
    // graft onto whatever conversation happens to be most recent.
    const params = new URLSearchParams(window.location.search);
    const prompt = params.get('prompt');
    const querySuffix = prompt ? `?prompt=${encodeURIComponent(prompt)}` : '';

    if (!prompt) {
      await conversationsStore.fetch();
      const latest = conversationsStore.list[0];
      if (latest?.id) {
        await goto(`/app/${userId}/${latest.id}`, { replaceState: true });
        return;
      }
    }

    const created = await conversationsStore.create('New chat');
    if (created?.id) {
      await goto(`/app/${userId}/${created.id}${querySuffix}`, { replaceState: true });
      return;
    }

    error = 'Failed to open chat';
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
