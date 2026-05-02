<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { AnimatedAiInput } from '$lib/components/ui/animated-ai-input';
  import { Header } from '$lib/components/ui/header/index.js';
  import {
    ArrowRight,
    Braces,
    Download,
    Github,
    LayoutGrid,
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

<div class="poster-page">
  <Header />

  <main>
    <section class="poster-section hero-section">
      <aside class="section-rail">
        <div class="rail-square" aria-hidden="true"></div>
        <p>Manifesto</p>
      </aside>

      <div class="section-main hero-main">
        <h1>
          Diagram the system before it
          <span>goes stale.</span>
        </h1>

        <div class="hero-lower">
          <p>
            Graphini turns rough architecture notes, process descriptions, schemas, and product
            handoffs into Mermaid diagrams you can edit, save, repair, and export.
          </p>

          <div class="cta-cluster">
            <a href={resolve('/app')} class="poster-button primary">
              Open workspace
              <ArrowRight class="size-4" />
            </a>
            <a
              href="https://github.com/omkarbhad/graphini"
              target="_blank"
              rel="noopener noreferrer"
              class="source-link">
              <Github class="size-4" />
              Source
            </a>
          </div>
        </div>

        <AnimatedAiInput
          class="homepage-chat-input"
          placeholder="Describe a diagram to generate..."
          onSubmit={(message) => gotoEdit(message)} />

        <div class="prompt-strip" aria-label="Example diagram prompts">
          {#each prompts as prompt (prompt)}
            <button type="button" onclick={() => gotoEdit(prompt)}>{prompt}</button>
          {/each}
        </div>
      </div>
    </section>

    <section class="poster-section product-section">
      <aside class="section-rail">
        <p>Workspace</p>
      </aside>

      <div class="section-main product-main">
        <a href={resolve('/app')} class="workspace-shot" aria-label="Open Graphini workspace">
          <img src="/demo2.png" alt="Graphini workspace with Mermaid editor and rendered diagram" />
        </a>

        <div class="proof-grid">
          {#each proofPoints as point (point.title)}
            {@const Icon = point.icon}
            <article>
              <Icon class="size-5" />
              <h2>{point.title}</h2>
              <p>{point.text}</p>
            </article>
          {/each}
        </div>
      </div>
    </section>

    <section class="poster-section system-section">
      <aside class="section-rail">
        <p>System</p>
      </aside>

      <div class="section-main">
        <h2 class="stack-headline">
          Prompt.
          <br />
          Mermaid.
          <br />
          Handoff.
        </h2>

        <div class="system-grid">
          {#each systemCards as card (card.index)}
            <article>
              <span>{card.index}</span>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </article>
          {/each}
        </div>
      </div>
    </section>

    <section class="poster-section difference-section">
      <aside class="section-rail">
        <p>Why different</p>
      </aside>

      <div class="section-main">
        <div class="difference-list">
          {#each differenceItems as item (item.index)}
            <article>
              <span>{item.index}</span>
              <div>
                <h2>{item.title}</h2>
                <p>{item.description}</p>
              </div>
            </article>
          {/each}
        </div>
      </div>
    </section>

    <section class="poster-section access-section">
      <aside class="section-rail">
        <p>Access</p>
      </aside>

      <div class="section-main access-main">
        <div>
          <h2>Start exploring.</h2>
          <p>
            Open the workspace, describe the system, and keep shaping the diagram until it is ready
            for the place your team actually works.
          </p>
        </div>

        <a href={resolve('/app')} class="poster-button secondary">
          Create a diagram
          <Sparkles class="size-4" />
        </a>
      </div>
    </section>
  </main>

  <footer class="poster-footer">
    <div>
      <span>Graphini</span>
      <span>&copy; {new Date().getFullYear()} Magnova</span>
    </div>
    <nav>
      <a href={resolve('/app')}>App</a>
      <a href="https://github.com/omkarbhad/graphini" target="_blank" rel="noopener noreferrer">
        GitHub
      </a>
      <a
        href="https://github.com/omkarbhad/graphini/blob/main/LICENSE"
        target="_blank"
        rel="noopener noreferrer">
        MIT License
      </a>
    </nav>
  </footer>
</div>

<style>
  @reference "../app.css";

  :global(:root) {
    --poster-bg: #e3e2de;
    --poster-blue: #1351aa;
    --poster-black: #141414;
    --poster-gray: #444343;
    --poster-muted: #7a7a7a;
    --poster-border: #c7c7c7;
  }

  :global(body) {
    background: var(--poster-bg);
  }

  .poster-page {
    min-height: 100vh;
    background: var(--poster-bg);
    color: var(--poster-black);
  }

  .poster-section {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    border-bottom: 1px solid var(--poster-border);
  }

  .section-rail {
    grid-column: span 3;
    min-height: 100%;
    border-right: 1px solid var(--poster-border);
    padding: 36px 24px;
  }

  .section-rail p {
    position: sticky;
    top: 128px;
    margin: 0;
    color: var(--poster-muted);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0;
    line-height: 1;
    text-transform: uppercase;
  }

  .rail-square {
    width: 16px;
    height: 16px;
    margin-bottom: 20px;
    background: var(--poster-black);
  }

  .section-main {
    grid-column: span 9;
    min-width: 0;
    padding: 48px 40px;
  }

  .hero-section {
    min-height: calc(88vh - 72px);
  }

  .hero-main {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 32px;
  }

  h1,
  .stack-headline,
  .access-main h2 {
    margin: 0;
    font-family:
      'Space Grotesk',
      'DM Sans',
      -apple-system,
      BlinkMacSystemFont,
      sans-serif;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  h1 {
    max-width: 1120px;
    font-size: 104px;
    font-weight: 900;
    line-height: 0.86;
  }

  h1 span {
    color: var(--poster-blue);
  }

  .hero-lower {
    display: grid;
    grid-template-columns: minmax(260px, 420px) minmax(220px, 1fr);
    gap: 32px;
    align-items: start;
  }

  .hero-lower p,
  .access-main p {
    margin: 0;
    color: var(--poster-gray);
    font-size: 16px;
    line-height: 1.5;
  }

  .cta-cluster {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    align-items: center;
  }

  .poster-button {
    display: inline-flex;
    min-height: 48px;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 1px solid transparent;
    border-radius: 0;
    padding: 13px 24px;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0;
    line-height: 1;
    text-transform: uppercase;
    transition:
      background-color 0.3s linear,
      border-color 0.3s linear,
      color 0.3s linear;
  }

  .poster-button.primary {
    background: var(--poster-blue);
    color: var(--poster-bg);
  }

  .poster-button.primary:hover,
  .poster-button.secondary {
    background: var(--poster-black);
    color: var(--poster-bg);
  }

  .poster-button.secondary:hover {
    background: var(--poster-blue);
  }

  .source-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--poster-black);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
    text-decoration: underline;
    text-underline-offset: 5px;
    transition: color 0.3s linear;
  }

  .source-link:hover {
    color: var(--poster-blue);
  }

  .prompt-strip {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    border: 1px solid var(--poster-border);
  }

  .prompt-strip button {
    min-height: 52px;
    cursor: pointer;
    border: 0;
    border-right: 1px solid var(--poster-border);
    border-radius: 0;
    background: transparent;
    color: var(--poster-black);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
    transition:
      background-color 0.3s linear,
      color 0.3s linear;
  }

  .prompt-strip button:last-child {
    border-right: 0;
  }

  .prompt-strip button:hover {
    background: var(--poster-black);
    color: var(--poster-bg);
  }

  .product-main {
    display: grid;
    gap: 28px;
  }

  .workspace-shot {
    display: block;
    border: 1px solid var(--poster-border);
    background: #f2f1ed;
  }

  .workspace-shot img {
    display: block;
    width: 100%;
  }

  .proof-grid,
  .system-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border: 1px solid var(--poster-border);
  }

  .proof-grid article,
  .system-grid article {
    min-height: 160px;
    border-right: 1px solid var(--poster-border);
    padding: 20px;
    transition: background-color 0.3s linear;
  }

  .proof-grid article:last-child,
  .system-grid article:last-child {
    border-right: 0;
  }

  .proof-grid article:hover,
  .system-grid article:hover {
    background: rgb(255 255 255 / 0.28);
  }

  .proof-grid :global(svg) {
    color: var(--poster-blue);
  }

  .proof-grid h2,
  .system-grid h3 {
    margin: 32px 0 0;
    color: var(--poster-black);
    font-size: 19px;
    font-weight: 800;
    letter-spacing: 0;
    line-height: 1;
  }

  .proof-grid p,
  .system-grid p,
  .difference-list p {
    margin: 12px 0 0;
    color: var(--poster-gray);
    font-size: 13px;
    line-height: 1.45;
  }

  .stack-headline {
    font-size: 74px;
    font-weight: 900;
    line-height: 0.9;
  }

  .system-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 36px;
  }

  .system-grid span,
  .difference-list span {
    color: var(--poster-muted);
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 12px;
    font-weight: 700;
  }

  .difference-list {
    border-bottom: 1px solid var(--poster-border);
  }

  .difference-list article {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 24px;
    min-height: 108px;
    align-items: start;
    border-top: 1px solid var(--poster-border);
    padding: 22px 0;
  }

  .difference-list h2 {
    margin: 0;
    color: var(--poster-black);
    font-size: 42px;
    font-weight: 900;
    letter-spacing: 0;
    line-height: 0.95;
    transition: color 0.3s linear;
  }

  .difference-list article:hover h2 {
    color: var(--poster-blue);
  }

  .access-section {
    min-height: 50vh;
  }

  .access-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 36px;
    align-items: end;
  }

  .access-main h2 {
    font-size: 82px;
    font-weight: 900;
    line-height: 0.9;
  }

  .access-main p {
    max-width: 720px;
    margin-top: 20px;
  }

  .poster-footer {
    display: flex;
    min-height: 88px;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    border-top: 1px solid var(--poster-border);
    padding: 24px 28px;
    color: var(--poster-gray);
    font-size: 13px;
  }

  .poster-footer div,
  .poster-footer nav {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    align-items: center;
  }

  .poster-footer span:first-child {
    color: var(--poster-black);
    font-weight: 900;
    text-transform: uppercase;
  }

  .poster-footer a {
    color: var(--poster-gray);
    transition: color 0.3s linear;
  }

  .poster-footer a:hover {
    color: var(--poster-blue);
  }

  @media (max-width: 1180px) {
    h1 {
      font-size: 78px;
    }

    .stack-headline,
    .access-main h2 {
      font-size: 62px;
    }

    .proof-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .proof-grid article:nth-child(2) {
      border-right: 0;
    }

    .proof-grid article:nth-child(n + 3) {
      border-top: 1px solid var(--poster-border);
    }
  }

  @media (max-width: 860px) {
    .poster-section {
      display: block;
    }

    .section-rail {
      min-height: 0;
      border-right: 0;
      border-bottom: 1px solid var(--poster-border);
      padding: 20px;
    }

    .section-rail p {
      position: static;
    }

    .rail-square {
      margin-bottom: 12px;
    }

    .section-main {
      padding: 28px 20px;
    }

    .hero-section {
      min-height: 0;
    }

    .hero-main {
      gap: 24px;
    }

    h1 {
      font-size: 44px;
      line-height: 0.9;
    }

    .hero-lower,
    .access-main {
      grid-template-columns: 1fr;
    }

    .prompt-strip,
    .system-grid {
      grid-template-columns: 1fr;
    }

    .prompt-strip button,
    .system-grid article,
    .proof-grid article {
      border-right: 0;
      border-bottom: 1px solid var(--poster-border);
    }

    .prompt-strip button:last-child,
    .system-grid article:last-child,
    .proof-grid article:last-child {
      border-bottom: 0;
    }

    .proof-grid {
      grid-template-columns: 1fr;
    }

    .proof-grid article:nth-child(2) {
      border-right: 0;
    }

    .proof-grid article:nth-child(n + 3) {
      border-top: 0;
    }

    .stack-headline,
    .access-main h2 {
      font-size: 40px;
    }

    .difference-list article {
      grid-template-columns: 1fr;
      gap: 12px;
      min-height: 0;
    }

    .difference-list h2 {
      font-size: 28px;
    }

    .poster-footer {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
