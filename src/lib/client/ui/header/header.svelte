<script lang="ts">
  import { resolve } from '$app/paths';
  import { authStore } from '$lib/client/stores/auth.svelte.js';
  import { ArrowRight, Github, LogIn, Menu, X } from 'lucide-svelte';

  let mobileOpen = $state(false);

  $effect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
  });

  const navLinks = [
    { title: 'Workspace', href: '/app' },
    { title: 'GitHub', href: 'https://github.com/omkarbhad/graphini', external: true }
  ];
</script>

<header class="poster-header">
  <nav>
    <a href={resolve('/')} class="brand-link" aria-label="Graphini home">
      <img src="/brand/logo.png" alt="" />
      <span>Graphini</span>
    </a>

    <div class="desktop-nav" aria-label="Primary navigation">
      {#each navLinks as link (link.title)}
        <a
          href={link.external ? link.href : resolve(link.href as '/app')}
          target={link.external ? '_blank' : undefined}
          rel={link.external ? 'noopener noreferrer' : undefined}>
          {#if link.title === 'GitHub'}
            <Github class="size-4" />
          {/if}
          {link.title}
        </a>
      {/each}
    </div>

    <div class="desktop-actions">
      {#if authStore.isLoggedIn}
        <a href={resolve('/app')} class="header-button secondary">App</a>
      {:else}
        <button type="button" class="header-button ghost" onclick={() => authStore.login()}>
          <LogIn class="size-4" />
          Sign in
        </button>
      {/if}
      <a href={resolve('/app')} class="header-button primary">
        Open app
        <ArrowRight class="size-4" />
      </a>
    </div>

    <button
      type="button"
      class="mobile-toggle"
      onclick={() => (mobileOpen = !mobileOpen)}
      aria-expanded={mobileOpen}
      aria-controls="mobile-menu"
      aria-label={mobileOpen ? 'Close menu' : 'Open menu'}>
      {#if mobileOpen}
        <X class="size-5" />
      {:else}
        <Menu class="size-5" />
      {/if}
    </button>
  </nav>

  {#if mobileOpen}
    <div id="mobile-menu" class="mobile-menu">
      {#each navLinks as link (link.title)}
        <a
          href={link.external ? link.href : resolve(link.href as '/app')}
          target={link.external ? '_blank' : undefined}
          rel={link.external ? 'noopener noreferrer' : undefined}
          onclick={() => (mobileOpen = false)}>
          <span>
            {#if link.title === 'GitHub'}
              <Github class="size-4" />
            {/if}
            {link.title}
          </span>
          {#if link.external}
            <span>External</span>
          {/if}
        </a>
      {/each}

      <div class="mobile-actions">
        {#if authStore.isLoggedIn}
          <a href={resolve('/app')} class="header-button secondary">App</a>
        {:else}
          <button type="button" class="header-button secondary" onclick={() => authStore.login()}>
            <LogIn class="size-4" />
            Sign in
          </button>
        {/if}
        <a href={resolve('/app')} class="header-button primary">
          Open app
          <ArrowRight class="size-4" />
        </a>
      </div>
    </div>
  {/if}
</header>

<style>
  @reference "../../../../app.css";

  .poster-header {
    position: sticky;
    top: 0;
    z-index: 50;
    border-bottom: 1px solid #c7c7c7;
    background: rgb(227 226 222 / 0.95);
    color: #141414;
    backdrop-filter: blur(12px);
  }

  nav {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    min-height: 64px;
    align-items: center;
  }

  .brand-link {
    grid-column: span 3;
    display: flex;
    height: 64px;
    align-items: center;
    gap: 12px;
    border-right: 1px solid #c7c7c7;
    padding: 0 24px;
    color: #141414;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .brand-link img {
    width: 22px;
    height: 22px;
    border-radius: 0;
  }

  .desktop-nav {
    grid-column: 8 / span 2;
    display: flex;
    justify-content: flex-end;
    gap: 24px;
  }

  .desktop-nav a {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: #444343;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
    transition: color 0.3s linear;
  }

  .desktop-nav a:hover {
    color: #1351aa;
  }

  .desktop-actions {
    grid-column: 10 / span 3;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-right: 24px;
  }

  .header-button,
  .mobile-toggle {
    display: inline-flex;
    min-height: 36px;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid #141414;
    border-radius: 0;
    padding: 0 13px;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0;
    line-height: 1;
    text-transform: uppercase;
    transition:
      background-color 0.3s linear,
      color 0.3s linear,
      border-color 0.3s linear;
  }

  .header-button.primary {
    background: #141414;
    color: #e3e2de;
  }

  .header-button.primary:hover {
    border-color: #1351aa;
    background: #1351aa;
  }

  .header-button.secondary,
  .header-button.ghost {
    background: transparent;
    color: #141414;
  }

  .header-button.secondary:hover,
  .header-button.ghost:hover,
  .mobile-toggle:hover {
    background: #141414;
    color: #e3e2de;
  }

  .mobile-toggle {
    display: none;
    grid-column: 12 / span 1;
    justify-self: end;
    width: 48px;
    padding: 0;
    margin-right: 20px;
    background: transparent;
    color: #141414;
  }

  .mobile-menu {
    border-top: 1px solid #c7c7c7;
    background: #e3e2de;
  }

  .mobile-menu > a {
    display: flex;
    min-height: 56px;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #c7c7c7;
    padding: 0 20px;
    color: #141414;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .mobile-menu > a span {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .mobile-menu > a span:last-child {
    color: #7a7a7a;
    font-size: 11px;
  }

  .mobile-actions {
    display: grid;
    gap: 10px;
    padding: 20px;
  }

  .mobile-actions .header-button {
    width: 100%;
  }

  @media (max-width: 1180px) {
    .desktop-actions .header-button.secondary,
    .desktop-actions .header-button.ghost {
      display: none;
    }
  }

  @media (max-width: 860px) {
    nav {
      min-height: 64px;
    }

    .brand-link {
      grid-column: span 8;
      height: 56px;
      padding: 0 20px;
    }

    nav {
      min-height: 56px;
    }

    .desktop-nav,
    .desktop-actions {
      display: none;
    }

    .mobile-toggle {
      display: inline-flex;
    }
  }
</style>
