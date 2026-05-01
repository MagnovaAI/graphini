<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Header } from '$lib/components/ui/header/index.js';
  import {
    ArrowRight,
    Braces,
    Download,
    FileSearch,
    GitBranch,
    Github,
    LayoutGrid,
    MessageSquareText,
    Mic,
    PanelsTopLeft,
    Paperclip,
    Palette,
    Presentation,
    Share2,
    ShieldCheck,
    Sparkles,
    Table2,
    TerminalSquare,
    Wand2,
    Wrench
  } from 'lucide-svelte';

  function gotoEdit(prompt: string) {
    goto(resolve('/dashboard') + `?prompt=${encodeURIComponent(prompt)}`);
  }

  const diagramTypes = [
    'Flowchart',
    'Sequence',
    'Architecture',
    'C4 Model',
    'State',
    'ERD',
    'Gantt',
    'Mindmap',
    'Git Graph',
    'User Journey',
    'Packet Flow',
    'Deployment',
    'Decision Tree'
  ];

  const workflow = [
    {
      title: 'Start from a sentence',
      description: 'Ask for the system, process, schema, or dependency map you need.',
      icon: MessageSquareText
    },
    {
      title: 'Edit the Mermaid source',
      description: 'Use the generated code directly, or keep shaping it in the workspace.',
      icon: Braces
    },
    {
      title: 'Arrange on canvas',
      description: 'Keep diagrams, notes, and exports together without leaving the page.',
      icon: PanelsTopLeft
    },
    {
      title: 'Ship the result',
      description: 'Export SVG, PNG, or Mermaid for docs, READMEs, slides, and tickets.',
      icon: Download
    }
  ];

  const details = [
    {
      title: 'Mermaid-native',
      description: 'The output stays readable, portable, and easy to review in git.',
      icon: GitBranch
    },
    {
      title: 'Workspace history',
      description:
        'Save diagrams as workspaces so the rough draft and final version stay connected.',
      icon: LayoutGrid
    },
    {
      title: 'Open source',
      description:
        'Graphini is MIT licensed and built for teams that want to self-host or extend it.',
      icon: Share2
    }
  ];

  const useCases = [
    'Architecture reviews',
    'API handoffs',
    'Incident notes',
    'Database planning',
    'Sprint specs',
    'README diagrams'
  ];

  const formats = [
    {
      title: 'Prompt to Mermaid',
      description: 'Generate a first draft, then keep the DSL close enough to edit by hand.',
      icon: TerminalSquare
    },
    {
      title: 'Docs-ready exports',
      description: 'Use SVG or PNG when a diagram needs to leave the workspace cleanly.',
      icon: Presentation
    },
    {
      title: 'Structured diagrams',
      description: 'Flowcharts, sequences, ERDs, state machines, Gantt plans, and more.',
      icon: Table2
    }
  ];

  const scannedFeatures = [
    {
      group: 'AI workspace',
      items: [
        {
          title: 'Context-aware chat',
          description:
            'Ask the assistant to create, expand, convert, review, or document the active diagram.',
          icon: Sparkles
        },
        {
          title: 'Syntax repair',
          description:
            'Diagram edits can be validated and repaired against Mermaid syntax before you keep working.',
          icon: Wrench
        },
        {
          title: 'Prompt enhancer',
          description:
            'Rewrite rough prompts into clearer diagram instructions from inside the chat panel.',
          icon: Wand2
        }
      ]
    },
    {
      group: 'Inputs',
      items: [
        {
          title: 'File-aware prompts',
          description:
            'Attach PDFs, spreadsheets, CSVs, Markdown, code, Mermaid files, or logs for the assistant to read.',
          icon: Paperclip
        },
        {
          title: 'Image understanding',
          description:
            'Uploaded diagrams, screenshots, charts, and technical images are described for reuse in chat.',
          icon: FileSearch
        },
        {
          title: 'Voice input',
          description: 'Record audio and turn it into a prompt without leaving the workspace.',
          icon: Mic
        }
      ]
    },
    {
      group: 'Editing',
      items: [
        {
          title: 'Visual node tools',
          description:
            'Add shapes, edit labels, tune colors, change arrows, and style nodes from the canvas.',
          icon: Palette
        },
        {
          title: 'Markdown document panel',
          description: 'Keep explanation, requirements, and handoff notes beside the diagram.',
          icon: Presentation
        },
        {
          title: 'Architecture handoff',
          description:
            'Export diagrams and notes as clean artifacts for documentation, reviews, and presentations.',
          icon: ShieldCheck
        }
      ]
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

<div class="min-h-screen bg-background text-foreground">
  <Header />

  <main>
    <section
      class="mx-auto grid max-w-6xl gap-10 px-5 pt-14 pb-12 md:grid-cols-[0.78fr_1.22fr] md:px-8 md:pt-20">
      <div class="intro-copy">
        <div class="product-line">
          <img src="/brand/logo.png" alt="" class="size-6 rounded-md" />
          <span>Graphini</span>
        </div>

        <h1>Diagram the idea before it goes stale.</h1>

        <p>
          Turn rough architecture notes, process descriptions, and data models into Mermaid diagrams
          you can edit, save, and export.
        </p>

        <div class="action-row">
          <a href={resolve('/dashboard')} class="primary-action">
            Open workspace
            <ArrowRight class="size-4" />
          </a>
          <a
            href="https://github.com/omkarbhad/graphini"
            target="_blank"
            rel="noopener noreferrer"
            class="secondary-action">
            <Github class="size-4" />
            GitHub
          </a>
        </div>

        <div class="prompt-row" aria-label="Example diagram prompts">
          {#each diagramTypes as type (type)}
            <button type="button" onclick={() => gotoEdit(`${type} diagram`)}>{type}</button>
          {/each}
        </div>
      </div>

      <a
        href={resolve('/dashboard')}
        class="workspace-preview"
        aria-label="Open Graphini workspace">
        <img src="/demo2.png" alt="Graphini workspace with Mermaid editor and rendered diagram" />
      </a>
    </section>

    <section class="border-y border-border bg-card">
      <div
        class="mx-auto grid max-w-6xl divide-y divide-border px-5 md:grid-cols-4 md:divide-x md:divide-y-0 md:px-8">
        {#each workflow as item (item.title)}
          {@const Icon = item.icon}
          <article class="workflow-item">
            <Icon class="mb-4 size-5 text-muted-foreground" />
            <h2>{item.title}</h2>
            <p>{item.description}</p>
          </article>
        {/each}
      </div>
    </section>

    <section class="border-y border-border">
      <div class="mx-auto grid max-w-6xl gap-6 px-5 py-10 md:grid-cols-[0.45fr_1fr] md:px-8">
        <div class="section-copy">
          <h2>Useful when the diagram is part of the work.</h2>
          <p>
            Graphini is meant for the messy middle: when a note, ticket, or design discussion needs
            a diagram before it is polished.
          </p>
        </div>

        <div class="use-case-list" aria-label="Graphini use cases">
          {#each useCases as item (item)}
            <button type="button" onclick={() => gotoEdit(item)}>{item}</button>
          {/each}
        </div>
      </div>
    </section>

    <section
      class="mx-auto grid max-w-6xl gap-8 px-5 py-14 md:grid-cols-[1fr_0.82fr] md:px-8 md:py-20">
      <div class="image-stack">
        <img src="/demo2.png" alt="Graphini prompt and generated diagram view" />
        <img src="/demo1.png" alt="Generated microservices diagram exported from Graphini" />
      </div>

      <div class="detail-list">
        <div>
          <h2>Built around the Mermaid file, not around a proprietary canvas.</h2>
          <p>
            Graphini keeps the source visible and editable, then gives you a canvas around it for
            iteration, organization, and export.
          </p>
        </div>

        {#each details as item (item.title)}
          {@const Icon = item.icon}
          <article>
            <Icon class="mb-4 size-5 text-muted-foreground" />
            <div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </div>
          </article>
        {/each}

        <a href={resolve('/dashboard')} class="text-link">
          Create a diagram
          <Sparkles class="size-4" />
        </a>
      </div>
    </section>

    <section class="border-t border-border bg-card">
      <div
        class="mx-auto grid max-w-6xl divide-y divide-border px-5 md:grid-cols-3 md:divide-x md:divide-y-0 md:px-8">
        {#each formats as item (item.title)}
          {@const Icon = item.icon}
          <article class="format-item">
            <Icon class="mb-4 size-5 text-muted-foreground" />
            <h2>{item.title}</h2>
            <p>{item.description}</p>
          </article>
        {/each}
      </div>
    </section>

    <section class="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
      <div class="section-copy feature-heading">
        <h2>Feature scan from the actual workspace.</h2>
        <p>
          These are the things the app already has behind the homepage: panels, tools, endpoints,
          and stores that show up in the working product.
        </p>
      </div>

      <div class="scanned-grid">
        {#each scannedFeatures as group (group.group)}
          <section class="feature-group" aria-labelledby={`${group.group}-features`}>
            <h3 id={`${group.group}-features`}>{group.group}</h3>
            <div class="feature-group-list">
              {#each group.items as item (item.title)}
                {@const Icon = item.icon}
                <article>
                  <Icon class="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <h4>{item.title}</h4>
                    <p>{item.description}</p>
                  </div>
                </article>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </section>
  </main>

  <footer class="border-t border-border">
    <div
      class="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-6 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:px-8">
      <div class="flex items-center gap-2">
        <img src="/brand/logo.png" alt="" class="size-5 rounded" />
        <span class="font-medium text-foreground">Graphini</span>
        <span>&copy; {new Date().getFullYear()} Magnova</span>
      </div>
      <nav class="flex flex-wrap items-center gap-4">
        <a href={resolve('/dashboard')}>Dashboard</a>
        <a href="https://github.com/omkarbhad/graphini" target="_blank" rel="noopener noreferrer">
          Source
        </a>
        <a
          href="https://github.com/omkarbhad/graphini/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer">
          MIT License
        </a>
      </nav>
    </div>
  </footer>
</div>

<style>
  @reference "../app.css";

  .intro-copy {
    @apply flex flex-col justify-center;
  }

  .product-line {
    @apply mb-5 flex items-center gap-2 text-sm font-semibold;
  }

  h1 {
    @apply max-w-xl text-4xl leading-[1.05] font-semibold tracking-normal text-foreground md:text-5xl;
  }

  .intro-copy > p {
    @apply mt-5 max-w-xl text-base leading-7 text-muted-foreground md:text-lg;
  }

  .action-row {
    @apply mt-8 flex flex-col gap-3 sm:flex-row;
  }

  .primary-action,
  .secondary-action {
    @apply inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors duration-150;
    @apply focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none;
  }

  .primary-action {
    @apply bg-primary text-primary-foreground hover:opacity-90;
  }

  .secondary-action {
    @apply border border-border bg-card text-foreground hover:bg-accent;
  }

  .prompt-row {
    @apply mt-8 flex max-w-xl flex-wrap gap-2;
  }

  .prompt-row button {
    @apply h-8 cursor-pointer rounded-md border border-border bg-card px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground;
  }

  .workspace-preview {
    @apply block overflow-hidden rounded-lg border border-border bg-card transition-colors duration-150 hover:border-foreground/30;
  }

  .workspace-preview img,
  .image-stack img {
    @apply block w-full;
  }

  .workflow-item {
    @apply px-0 py-6 md:px-5;
  }

  .workflow-item h2,
  .detail-list h3,
  .format-item h2 {
    @apply text-base font-semibold tracking-normal text-foreground;
  }

  .workflow-item p,
  .detail-list p,
  .format-item p {
    @apply mt-2 text-sm leading-6 text-muted-foreground;
  }

  .section-copy h2 {
    @apply text-xl leading-tight font-semibold tracking-normal text-foreground md:text-2xl;
  }

  .section-copy p {
    @apply mt-3 max-w-md text-sm leading-6 text-muted-foreground;
  }

  .feature-heading {
    @apply mb-8;
  }

  .use-case-list {
    @apply grid gap-2 sm:grid-cols-2 lg:grid-cols-3;
  }

  .use-case-list button {
    @apply h-10 cursor-pointer rounded-md border border-border bg-card px-3 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-accent;
  }

  .image-stack {
    @apply grid gap-4;
  }

  .image-stack img {
    @apply rounded-lg border border-border bg-card;
  }

  .detail-list {
    @apply flex flex-col justify-center gap-8;
  }

  .detail-list > div:first-child h2 {
    @apply text-2xl leading-tight font-semibold tracking-normal text-foreground md:text-3xl;
  }

  .detail-list > div:first-child p {
    @apply mt-4 text-base leading-7;
  }

  .detail-list article {
    @apply grid grid-cols-[24px_1fr] gap-4 border-t border-border pt-6;
  }

  .text-link {
    @apply inline-flex w-fit items-center gap-2 text-sm font-semibold text-foreground underline underline-offset-4 transition-colors duration-150 hover:text-muted-foreground;
  }

  .format-item {
    @apply px-0 py-6 md:px-6;
  }

  .scanned-grid {
    @apply grid gap-4 md:grid-cols-3;
  }

  .feature-group {
    @apply rounded-lg border border-border bg-card p-5;
  }

  .feature-group h3 {
    @apply text-sm font-semibold tracking-normal text-foreground;
  }

  .feature-group-list {
    @apply mt-5 grid gap-5;
  }

  .feature-group article {
    @apply grid grid-cols-[20px_1fr] gap-3;
  }

  .feature-group h4 {
    @apply text-sm font-semibold tracking-normal text-foreground;
  }

  .feature-group p {
    @apply mt-1 text-sm leading-6 text-muted-foreground;
  }

  footer a {
    @apply transition-colors duration-150 hover:text-foreground;
  }

  @media (max-width: 767px) {
    .workspace-preview {
      @apply rounded-md;
    }

    .prompt-row {
      @apply gap-1.5;
    }

    .prompt-row button {
      @apply px-2.5;
    }
  }
</style>
