<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { AnimatedAiInput } from '$lib/components/ui/animated-ai-input';
  import { authStore } from '$lib/stores/auth.svelte.js';
  import {
    ArrowRight,
    Braces,
    Download,
    Github,
    LayoutGrid,
    LogIn,
    Sparkles,
    TerminalSquare
  } from 'lucide-svelte';

  function gotoEdit(prompt: string) {
    goto(resolve('/app') + `?prompt=${encodeURIComponent(prompt)}`);
  }

  const systemCards = [
    {
      index: '01',
      title: 'Prompt',
      description:
        'Start with rough architecture notes, a process description, a schema, or a handoff question.'
    },
    {
      index: '02',
      title: 'Source',
      description:
        'Keep Mermaid readable and editable, so every diagram remains reviewable in docs and git.'
    },
    {
      index: '03',
      title: 'Canvas',
      description:
        'Use the workspace around the diagram for chat, notes, visual arrangement, export, and repair.'
    }
  ];

  const differenceItems = [
    {
      index: '001',
      title: 'Mermaid-native output',
      description: 'No proprietary format standing between the idea and the document.'
    },
    {
      index: '002',
      title: 'Code and diagram stay together',
      description: 'The source remains visible while the rendered artifact is shaped for handoff.'
    },
    {
      index: '003',
      title: 'Built for the messy middle',
      description:
        'Useful before a spec is final, before a review starts, and before the README gets polished.'
    },
    {
      index: '004',
      title: 'Open source by default',
      description: 'Self-host, extend, inspect, and keep the workflow close to your team.'
    }
  ];

  const prompts = [
    'Architecture review',
    'Sequence diagram',
    'ERD from schema',
    'Incident timeline',
    'API handoff',
    'Deployment map'
  ];

  const proofPoints = [
    { icon: TerminalSquare, title: 'Generate', text: 'Plain English to Mermaid drafts.' },
    { icon: Braces, title: 'Repair', text: 'Syntax-aware edits when code breaks.' },
    {
      icon: LayoutGrid,
      title: 'Organize',
      text: 'Workspaces keep diagrams, notes, and exports connected.'
    },
    {
      icon: Download,
      title: 'Export',
      text: 'SVG, PNG, and Mermaid for docs, tickets, and slides.'
    }
  ];
</script>

<svelte:head>
  <title>Graphini — AI diagram workspace</title>
  <meta
    name="description"
    content="Create Mermaid diagrams from plain English, edit them in a workspace, and export clean assets for docs and presentations." />
  <meta property="og:title" content="Graphini — AI diagram workspace" />
  <meta
    property="og:description"
    content="Create Mermaid diagrams from plain English, edit them in a workspace, and export clean assets." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://graphini.magnova.ai" />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="flex min-h-screen flex-col bg-background text-foreground">
  <!-- Top header — matches the workspace AppHeader visually -->
  <header
    class="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/95 px-4 backdrop-blur-sm supports-backdrop-filter:bg-background/60 md:px-6">
    <a href={resolve('/')} class="flex items-center gap-2 text-[13px] font-semibold">
      <img src="/brand/logo.png" alt="" class="size-5" />
      <span>Graphini</span>
    </a>

    <nav class="hidden items-center gap-1 text-[12px] text-muted-foreground md:flex">
      <a
        href={resolve('/app')}
        class="rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent hover:text-foreground">
        Workspace
      </a>
      <a
        href="https://github.com/omkarbhad/graphini"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent hover:text-foreground">
        <Github class="size-3.5" />
        GitHub
      </a>
    </nav>

    <div class="flex items-center gap-2">
      {#if authStore.isLoggedIn}
        <a
          href={resolve('/app')}
          class="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent">
          App
        </a>
      {:else}
        <button
          type="button"
          class="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onclick={() => authStore.login()}>
          <LogIn class="size-3.5" />
          Sign in
        </button>
      {/if}
      <a
        href={resolve('/app')}
        class="flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90">
        Open app
        <ArrowRight class="size-3.5" />
      </a>
    </div>
  </header>

  <main class="flex-1">
    <!-- HERO -->
    <section class="border-b border-border">
      <div class="mx-auto flex max-w-5xl flex-col items-center gap-8 px-6 py-20 text-center">
        <span
          class="rounded-full border border-border bg-muted/40 px-3 py-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          AI diagram workspace
        </span>
        <h1
          class="max-w-3xl text-4xl font-semibold tracking-tight text-balance text-foreground md:text-5xl lg:text-6xl">
          Diagram the system before it goes stale.
        </h1>
        <p
          class="max-w-2xl text-[14px] leading-relaxed text-pretty text-muted-foreground md:text-[15px]">
          Graphini turns rough architecture notes, process descriptions, schemas, and product
          handoffs into Mermaid diagrams you can edit, save, repair, and export.
        </p>

        <div class="w-full max-w-2xl">
          <AnimatedAiInput
            placeholder="Describe a diagram to generate..."
            onSubmit={(message) => gotoEdit(message)} />
        </div>

        <div class="flex flex-wrap items-center justify-center gap-1.5">
          {#each prompts as prompt (prompt)}
            <button
              type="button"
              class="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onclick={() => gotoEdit(prompt)}>
              {prompt}
            </button>
          {/each}
        </div>

        <div class="flex items-center gap-2 pt-2">
          <a
            href={resolve('/app')}
            class="flex h-9 items-center gap-2 rounded-md bg-foreground px-4 text-[13px] font-medium text-background transition-opacity hover:opacity-90">
            Open workspace
            <ArrowRight class="size-3.5" />
          </a>
          <a
            href="https://github.com/omkarbhad/graphini"
            target="_blank"
            rel="noopener noreferrer"
            class="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-accent">
            <Github class="size-3.5" />
            Source
          </a>
        </div>
      </div>
    </section>

    <!-- WORKSPACE SHOT -->
    <section class="border-b border-border">
      <div class="mx-auto max-w-6xl px-6 py-16">
        <div class="mb-6 flex items-baseline justify-between gap-4">
          <h2 class="text-[18px] font-semibold tracking-tight">Workspace</h2>
          <span class="font-mono text-[10px] tracking-widest text-muted-foreground/60 uppercase"
            >Preview</span>
        </div>
        <a
          href={resolve('/app')}
          class="block overflow-hidden rounded-lg border border-border bg-muted/20 transition-colors hover:bg-muted/40"
          aria-label="Open Graphini workspace">
          <img
            src="/graphini_demo1.png"
            alt="Graphini workspace with Mermaid editor and rendered diagram"
            class="h-auto w-full" />
        </a>

        <div
          class="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
          {#each proofPoints as point (point.title)}
            {@const Icon = point.icon}
            <article class="flex flex-col gap-2 bg-background p-4">
              <Icon class="size-4 text-muted-foreground" />
              <h3 class="text-[13px] font-semibold tracking-tight text-foreground">
                {point.title}
              </h3>
              <p class="text-[12px] leading-relaxed text-muted-foreground">{point.text}</p>
            </article>
          {/each}
        </div>
      </div>
    </section>

    <!-- SYSTEM 3-STEP -->
    <section class="border-b border-border">
      <div class="mx-auto max-w-6xl px-6 py-16">
        <div class="mb-8 flex items-baseline justify-between gap-4">
          <h2 class="text-[18px] font-semibold tracking-tight">System</h2>
          <span class="font-mono text-[10px] tracking-widest text-muted-foreground/60 uppercase"
            >Prompt → Mermaid → Handoff</span>
        </div>

        <div
          class="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
          {#each systemCards as card (card.index)}
            <article class="flex flex-col gap-2 bg-background p-5">
              <span class="font-mono text-[10px] tracking-widest text-muted-foreground/60 uppercase"
                >{card.index}</span>
              <h3 class="text-[14px] font-semibold tracking-tight text-foreground">
                {card.title}
              </h3>
              <p class="text-[12px] leading-relaxed text-muted-foreground">
                {card.description}
              </p>
            </article>
          {/each}
        </div>
      </div>
    </section>

    <!-- WHY DIFFERENT -->
    <section class="border-b border-border">
      <div class="mx-auto max-w-6xl px-6 py-16">
        <div class="mb-8 flex items-baseline justify-between gap-4">
          <h2 class="text-[18px] font-semibold tracking-tight">Why different</h2>
          <span class="font-mono text-[10px] tracking-widest text-muted-foreground/60 uppercase"
            >004</span>
        </div>

        <div class="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {#each differenceItems as item (item.index)}
            <article class="flex items-start gap-4 bg-background p-4 md:p-5">
              <span class="shrink-0 font-mono text-[11px] tracking-widest text-muted-foreground/60"
                >{item.index}</span>
              <div class="min-w-0 flex-1">
                <h3 class="text-[13px] font-semibold tracking-tight text-foreground">
                  {item.title}
                </h3>
                <p class="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </article>
          {/each}
        </div>
      </div>
    </section>

    <!-- ACCESS CTA -->
    <section class="border-b border-border">
      <div
        class="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-16 md:flex-row md:items-center">
        <div class="max-w-xl">
          <h2 class="text-2xl font-semibold tracking-tight md:text-3xl">Start exploring.</h2>
          <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground md:text-[14px]">
            Open the workspace, describe the system, and keep shaping the diagram until it is ready
            for the place your team actually works.
          </p>
        </div>
        <a
          href={resolve('/app')}
          class="flex h-10 items-center gap-2 rounded-md bg-foreground px-5 text-[13px] font-medium text-background transition-opacity hover:opacity-90">
          Create a diagram
          <Sparkles class="size-3.5" />
        </a>
      </div>
    </section>
  </main>

  <footer class="border-t border-border">
    <div
      class="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-6 py-6 text-[11px] text-muted-foreground md:flex-row md:items-center">
      <div class="flex items-center gap-3">
        <span class="font-mono tracking-widest uppercase">Graphini</span>
        <span>&copy; {new Date().getFullYear()} Magnova</span>
      </div>
      <nav class="flex items-center gap-3">
        <a class="hover:text-foreground" href={resolve('/app')}>App</a>
        <a
          class="hover:text-foreground"
          href="https://github.com/omkarbhad/graphini"
          target="_blank"
          rel="noopener noreferrer">
          GitHub
        </a>
        <a
          class="hover:text-foreground"
          href="https://github.com/omkarbhad/graphini/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer">
          MIT License
        </a>
      </nav>
    </div>
  </footer>
</div>
