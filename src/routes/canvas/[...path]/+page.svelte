<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';

  // /canvas/* is deprecated — editor lives at /workspace/{id}
  onMount(() => {
    goto(resolve('/app'), { replaceState: true });
  });
</script>

<div class="flex h-screen items-center justify-center bg-background">
  <span class="text-sm text-muted-foreground">Redirecting to app...</span>
</div>
