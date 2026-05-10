<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { AnimatedAiInput } from '$lib/client/ui/animated-ai-input';
  import {
    ArrowRight,
    Braces,
    CheckCircle2,
    Code2,
    Download,
    FileCode2,
    Github,
    MessageSquareText,
    Sparkles,
    Wand2
  } from 'lucide-svelte';

  function gotoEdit(prompt: string) {
    goto(resolve('/app') + `?prompt=${encodeURIComponent(prompt)}`);
  }

  const prompts = [
    {
      title: 'Checkout flow',
      text: 'Create a sequence diagram for checkout: user adds item, payment intent is created, Stripe confirms payment, inventory updates, and email receipt is sent.'
    },
    {
      title: 'Cloud architecture',
      text: 'Map a cloud microservices architecture with CDN, load balancer, auth service, order service, PostgreSQL, Redis cache, queue, and monitoring.'
    },
    {
      title: 'Incident timeline',
      text: 'Create an incident timeline for API latency: deploy at 10:05, error spike at 10:12, rollback at 10:30, cache fix at 10:45, resolved at 11:00.'
    }
  ];

  const workflow = [
    {
      icon: MessageSquareText,
      title: 'Prompt',
      text: 'Describe the system in rough notes, tickets, or pasted docs.'
    },
    {
      icon: Braces,
      title: 'Mermaid',
      text: 'Keep every diagram inspectable, editable, and portable.'
    },
    {
      icon: Wand2,
      title: 'Repair',
      text: 'Ask Graphini to fix syntax, layout, labels, or missing edges.'
    },
    {
      icon: Download,
      title: 'Export',
      text: 'Ship SVG, PNG, and Mermaid into docs, PRs, or issues.'
    }
  ];

  const formats = ['Flowchart', 'Sequence', 'ERD', 'C4', 'Timeline'];
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

<div class="min-h-screen bg-background text-foreground">
  <header
    class="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/75">
    <div class="mx-auto flex h-12 max-w-7xl items-center gap-3 px-4 md:px-6">
      <a
        href={resolve('/')}
        class="flex min-w-0 items-center gap-2 text-[13px] font-semibold"
        aria-label="Graphini home">
        <img src="/brand/logo.png" alt="" class="size-5 shrink-0" />
        <span class="truncate">Graphini</span>
      </a>

      <div class="ml-auto flex items-center gap-2">
        <a
          href="https://github.com/omkarbhad/graphini"
          target="_blank"
          rel="noopener noreferrer"
          class="flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Open GitHub repository">
          <Github class="size-4" />
        </a>
        <a
          href={resolve('/app')}
          class="flex h-8 items-center gap-2 rounded-md bg-foreground px-3 text-[13px] font-medium text-background transition-opacity hover:opacity-90">
          Open app
          <ArrowRight class="size-3.5" />
        </a>
      </div>
    </div>
  </header>

  <main>
    <section class="border-b border-border">
      <div class="mx-auto max-w-7xl px-4 py-8 md:px-6 lg:py-10">
        <div class="mx-auto flex max-w-3xl flex-col items-center text-center">
          <div class="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Sparkles class="size-3.5" />
            AI diagram workspace for Mermaid
          </div>
          <h1
            class="mt-5 max-w-3xl text-[42px] leading-[1.04] font-semibold tracking-tight text-balance md:text-[64px] lg:text-[72px]">
            Diagram systems while the context is still fresh.
          </h1>
          <p class="mt-5 max-w-2xl text-[14px] leading-6 text-pretty text-muted-foreground">
            Turn rough architecture notes, schemas, incidents, and handoff questions into diagrams
            that stay readable as code.
          </p>
        </div>

        <div class="mx-auto mt-7 max-w-3xl space-y-3">
          <AnimatedAiInput
            placeholder="Describe a diagram to generate..."
            class="max-w-none"
            onSubmit={(message) => gotoEdit(message)} />
          <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
            {#each prompts as prompt (prompt.title)}
              <button
                type="button"
                class="min-h-28 rounded-md border border-border bg-background px-3 py-3 text-left transition-colors hover:bg-accent"
                onclick={() => gotoEdit(prompt.text)}>
                <span class="block text-[13px] font-medium text-foreground">{prompt.title}</span>
                <span class="mt-2 block text-[12px] leading-relaxed text-muted-foreground">
                  {prompt.text}
                </span>
              </button>
            {/each}
          </div>
        </div>

        <a
          href={resolve('/app')}
          class="group mt-8 block overflow-hidden rounded-lg border border-border bg-card"
          aria-label="Open Graphini workspace">
          <div class="flex items-center justify-between border-b border-border px-3 py-2">
            <div class="flex min-w-0 items-center gap-2">
              <span class="size-2 rounded-full bg-success"></span>
              <span class="truncate text-[13px] font-medium">System Design</span>
            </div>
            <span class="text-[12px] text-muted-foreground">Canvas, code, document, chat</span>
          </div>
          <img
            src="/demo2.png"
            alt="Graphini workspace showing a system diagram canvas and chat panel"
            class="aspect-[2934/1544] w-full object-cover object-left-top transition-opacity group-hover:opacity-95" />
        </a>
      </div>
    </section>

    <section class="border-b border-border">
      <div class="mx-auto max-w-7xl px-4 py-8 md:px-6">
        <div class="grid grid-cols-1 gap-3 md:auto-rows-[148px] md:grid-cols-12">
          <article class="rounded-lg border border-border bg-card p-4 md:col-span-5 md:row-span-2">
            <div class="flex h-full flex-col justify-between gap-6">
              <FileCode2 class="size-4 text-muted-foreground" />
              <div class="space-y-3">
                <h2 class="max-w-sm text-[28px] leading-tight font-semibold tracking-tight">
                  One workspace for the whole diagram.
                </h2>
                <p class="max-w-md text-[13px] leading-relaxed text-muted-foreground">
                  Chat, source, rendered canvas, and document notes stay together so the diagram can
                  move from rough thought to handoff without changing tools.
                </p>
              </div>
            </div>
          </article>

          <article class="rounded-lg border border-border bg-card p-4 md:col-span-4">
            <div class="flex h-full flex-col justify-between gap-4">
              <div class="flex items-center justify-between">
                <Code2 class="size-4 text-muted-foreground" />
                <span class="text-[12px] text-muted-foreground">Mermaid</span>
              </div>
              <div>
                <div class="text-[13px] font-medium">Readable source</div>
                <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  Keep generated diagrams inspectable, editable, copied, and versioned.
                </p>
              </div>
            </div>
          </article>

          <article class="rounded-lg border border-border bg-card p-4 md:col-span-3">
            <div class="flex h-full flex-col justify-between gap-4">
              <CheckCircle2 class="size-4 text-success" />
              <div>
                <div class="text-[13px] font-medium">Syntax aware</div>
                <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  Repair broken Mermaid without rewriting the entire diagram.
                </p>
              </div>
            </div>
          </article>

          <article class="rounded-lg border border-border bg-card p-4 md:col-span-4">
            <div class="flex h-full flex-col justify-between gap-4">
              <div class="flex flex-wrap gap-2">
                {#each formats as format (format)}
                  <span
                    class="rounded-md border border-border bg-muted/30 px-2 py-1 text-[12px] text-muted-foreground">
                    {format}
                  </span>
                {/each}
              </div>
              <div>
                <div class="text-[13px] font-medium">Built for system diagrams</div>
                <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  Architecture maps, API flows, schemas, timelines, and review diagrams.
                </p>
              </div>
            </div>
          </article>

          <article class="rounded-lg border border-border bg-card p-4 md:col-span-3">
            <div class="flex h-full flex-col justify-between gap-4">
              <Download class="size-4 text-muted-foreground" />
              <p class="text-[13px] leading-relaxed text-muted-foreground">
                Export SVG, PNG, and Mermaid source for docs and PRs.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="border-b border-border">
      <div class="mx-auto grid max-w-7xl gap-3 px-4 py-8 md:grid-cols-4 md:px-6">
        {#each workflow as item (item.title)}
          {@const Icon = item.icon}
          <article class="rounded-lg border border-border bg-card p-4">
            <Icon class="size-4 text-muted-foreground" />
            <h2 class="mt-5 text-[13px] font-semibold tracking-tight">{item.title}</h2>
            <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">{item.text}</p>
          </article>
        {/each}
      </div>
    </section>

    <section>
      <div
        class="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 py-8 md:flex-row md:items-center md:px-6">
        <div>
          <h2 class="text-[20px] font-semibold tracking-tight">
            Open the workspace and start with a messy thought.
          </h2>
          <p class="mt-2 text-[13px] text-muted-foreground">
            The diagram can get cleaner as your understanding gets sharper.
          </p>
        </div>
        <a
          href={resolve('/app')}
          class="flex h-9 items-center gap-2 rounded-md bg-foreground px-4 text-[13px] font-medium text-background transition-opacity hover:opacity-90">
          Create a diagram
          <ArrowRight class="size-3.5" />
        </a>
      </div>
    </section>
  </main>

  <footer class="border-t border-border">
    <div
      class="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 px-4 py-5 text-[13px] text-muted-foreground md:flex-row md:items-center md:px-6">
      <div class="flex items-center gap-3">
        <span class="font-medium text-foreground">Graphini</span>
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
