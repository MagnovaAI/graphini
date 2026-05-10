<script lang="ts">
  import * as Sidebar from '$lib/client/ui/sidebar';
  import type { Snippet } from 'svelte';

  interface Props {
    sidebar: Snippet;
    children: Snippet;
  }

  let { sidebar, children }: Props = $props();
</script>

<Sidebar.Provider class="h-dvh min-h-0 overflow-hidden">
  {@render sidebar()}
  <Sidebar.Inset class="min-h-0 overflow-hidden">
    {@render children()}
  </Sidebar.Inset>
</Sidebar.Provider>
