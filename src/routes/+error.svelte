<script>
  import { page } from '$app/stores';
</script>

<div class="container mx-auto p-8">
  {#if $page.status === 404}
    <h1 class="mb-4 text-[22px] font-bold">Page not found</h1>
    <p class="mb-4">
      We couldn't find <code>{$page.url.pathname}</code>. The link may be broken or the page may have moved.
    </p>
  {:else}
    <h1 class="mb-4 text-[22px] font-bold">Error {$page.status}</h1>
    <p class="mb-4">{$page.error?.message || 'An unexpected error occurred'}</p>
  {/if}
  <a href="/" class="text-primary hover:underline">Return to Home</a>
</div>
