<script lang="ts">
  import { cn } from '$lib/utils.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { resolve } from '$app/paths';
  import { authStore } from '$lib/stores/auth.svelte.js';
  import { onMount } from 'svelte';
  import { ArrowRight, Github, LogIn, Menu, X } from 'lucide-svelte';

  let scrolled = $state(false);
  let mobileOpen = $state(false);

  onMount(() => {
    function onScroll() {
      scrolled = window.scrollY > 10;
    }
    window.addEventListener('scroll', onScroll);
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  });

  $effect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  });

  const navLinks = [
    { title: 'Workspace', href: '/dashboard' },
    { title: 'GitHub', href: 'https://github.com/omkarbhad/graphini', external: true }
  ];
</script>

<header
  class={cn('sticky top-0 z-50 w-full border-b transition-colors', {
    'border-transparent bg-background': !scrolled,
    'border-border bg-background/95 shadow-[0_1px_0_color-mix(in_oklch,var(--color-border),transparent_35%)] supports-[backdrop-filter]:bg-background/90':
      scrolled
  })}>
  <nav class="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 md:px-8">
    <div class="flex min-w-0 items-center gap-6">
      <a
        href={resolve('/')}
        class="flex min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-foreground transition-colors outline-none hover:text-foreground/80 focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <img src="/brand/logo.png" alt="" class="size-7 rounded-md" />
        <span class="truncate text-sm font-semibold">Graphini</span>
      </a>

      <div class="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
        {#each navLinks as link (link.title)}
          <a
            href={link.external ? link.href : resolve(link.href as '/dashboard')}
            target={link.external ? '_blank' : undefined}
            rel={link.external ? 'noopener noreferrer' : undefined}
            class="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {#if link.title === 'GitHub'}
              <Github class="size-4" />
            {/if}
            {link.title}
          </a>
        {/each}
      </div>
    </div>

    <div class="hidden items-center gap-2 md:flex">
      {#if authStore.isLoggedIn}
        <Button variant="outline" href={resolve('/dashboard')}>Dashboard</Button>
      {:else}
        <Button variant="ghost" onclick={() => authStore.login()}>
          <LogIn class="size-4" />
          Sign in
        </Button>
      {/if}
      <Button href={resolve('/dashboard')}>
        Open app
        <ArrowRight class="size-4" />
      </Button>
    </div>

    <Button
      variant="ghost"
      size="icon"
      class="md:hidden"
      onclick={() => (mobileOpen = !mobileOpen)}
      aria-expanded={mobileOpen}
      aria-controls="mobile-menu"
      aria-label={mobileOpen ? 'Close menu' : 'Open menu'}>
      {#if mobileOpen}
        <X class="size-5" />
      {:else}
        <Menu class="size-5" />
      {/if}
    </Button>
  </nav>

  {#if mobileOpen}
    <div id="mobile-menu" class="fixed inset-x-0 top-14 z-40 border-y bg-background md:hidden">
      <div class="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-4">
        <div class="grid gap-1" aria-label="Mobile navigation">
          {#each navLinks as link (link.title)}
            <a
              href={link.external ? link.href : resolve(link.href as '/dashboard')}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
              class="flex min-h-11 items-center justify-between rounded-md px-2 text-sm font-medium text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onclick={() => (mobileOpen = false)}>
              <span class="inline-flex items-center gap-2">
                {#if link.title === 'GitHub'}
                  <Github class="size-4 text-muted-foreground" />
                {/if}
                {link.title}
              </span>
              {#if link.external}
                <span class="text-xs text-muted-foreground">External</span>
              {/if}
            </a>
          {/each}
        </div>

        <div class="grid gap-2 border-t pt-4">
          {#if authStore.isLoggedIn}
            <Button variant="outline" class="w-full bg-transparent" href={resolve('/dashboard')}>
              Dashboard
            </Button>
          {:else}
            <Button
              variant="outline"
              class="w-full bg-transparent"
              onclick={() => authStore.login()}>
              <LogIn class="size-4" />
              Sign in
            </Button>
          {/if}
          <Button class="w-full" href={resolve('/dashboard')}>
            Open app
            <ArrowRight class="size-4" />
          </Button>
        </div>
      </div>
    </div>
  {/if}
</header>
