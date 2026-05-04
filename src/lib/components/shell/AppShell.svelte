<script lang="ts">
  import * as Sidebar from '$lib/components/ui/sidebar';
  import type { Snippet } from 'svelte';

  interface Props {
    sidebar: Snippet;
    children: Snippet;
  }

  let { sidebar, children }: Props = $props();
</script>

<Sidebar.Provider class="h-screen min-h-0 overflow-hidden">
  {@render sidebar()}
  <Sidebar.Inset class="min-h-0 overflow-hidden">
    {@render children()}
  </Sidebar.Inset>
</Sidebar.Provider>
