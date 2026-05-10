<p align="center">
  <img src="static/brand/logo.png" width="96" height="96" alt="Graphini" />
</p>

<h1 align="center">Graphini</h1>

<p align="center">
  <b>AI diagram workspace for turning rough ideas into editable Mermaid diagrams.</b>
</p>

<p align="center">
  Built with Cowork for teams that need architecture, process, and product diagrams to stay editable after the first draft.
</p>

<p align="center">
  <a href="#why-graphini">Why</a> ·
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#api">API</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/SvelteKit-2-ff3e00?logo=svelte&logoColor=white" alt="SvelteKit" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Mermaid-diagrams--as--code-ff3670" alt="Mermaid" />
  <img src="https://img.shields.io/badge/Vercel_AI_SDK-6-000?logo=vercel&logoColor=white" alt="Vercel AI SDK" />
  <img src="https://img.shields.io/badge/Drizzle-ORM-c5f74f" alt="Drizzle ORM" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

<p align="center">
  <img src="static/demo2.png" alt="Graphini workspace" width="820" />
</p>

## What Is Graphini?

Graphini is an open-source AI diagram workspace. Describe a system, workflow, schema, or handoff in plain English, then edit the generated Mermaid source beside the rendered diagram.

Unlike image-first diagram tools, Graphini keeps the diagram as text. That means you can repair it, diff it, save it with project docs, export it for slides or tickets, and keep iterating after the first AI draft.

## Why Graphini

Most AI diagram tools produce a picture. Pictures are easy to share, but hard to review, version, or regenerate from source.

Graphini is built for the messy middle between "we should diagram this" and "this belongs in docs":

- **Start with language** - prompt the assistant with architecture notes, process descriptions, ERD requirements, deployment maps, or incident timelines.
- **Keep the source** - Mermaid remains visible and editable, so the diagram can live in docs and git instead of becoming a frozen canvas.
- **Repair and iterate** - use chat, syntax-aware repair, and model selection to refine a broken or incomplete diagram.
- **Work in a workspace** - keep diagrams, chat, notes, document state, collaborators, and exports connected.
- **Bring real cloud context** - bundled icon support helps infrastructure diagrams look like actual architecture, not placeholder boxes.

Use Graphini when you want a diagram that can be generated quickly, edited precisely, and handed off as code.

## Features

### AI diagram generation

- Natural-language prompts to Mermaid diagrams
- Streaming chat interface powered by the Vercel AI SDK
- Model/provider settings for OpenAI, Anthropic, OpenRouter, and Gemini paths
- Image/audio upload routes for richer diagram context

### Mermaid workspace

- Mermaid source editor with rendered preview
- Workspace, canvas, edit, and view routes
- Diagram repair and error analysis endpoints
- Export-oriented UI for SVG, PNG, Mermaid, and handoff assets

### Persistence and collaboration

- PostgreSQL-backed users, workspaces, conversations, messages, files, memories, credits, and settings
- Drizzle ORM with checked-in SQL schema and migrations
- Workspace collaborators API
- User preferences, app settings, model lab, and admin endpoints

### Product surface

- Public landing page and authenticated app entry
- Magnova Auth cookie flow with local/dev auth fallback
- Admin panel with provider credential management
- OpenAPI spec for external integrations
- MermaidSeqBench harness for evaluating natural-language-to-Mermaid sequence diagram generation

## Screenshots

<p align="center">
  <img src="static/demo1.png" alt="Generated architecture diagram" width="820" />
</p>

## Tech Stack

| Layer                | Technology                                               |
| -------------------- | -------------------------------------------------------- |
| Framework            | SvelteKit 2, Svelte 5, Vite 7, TypeScript 5              |
| UI                   | Tailwind CSS 4, bits-ui, Lucide, Font Awesome, Iconify   |
| Editor and rendering | Mermaid 11, CodeMirror, Monaco, svg-pan-zoom             |
| AI                   | Vercel AI SDK 6, OpenAI, Anthropic, OpenRouter, Gemini   |
| Data                 | PostgreSQL, Neon serverless driver, Drizzle ORM          |
| Auth                 | Magnova Auth cookie flow plus local/dev session fallback |
| Testing              | Vitest, Playwright, coverage-v8                          |
| Deployment           | SvelteKit Vercel adapter                                 |

## Quick Start

### Prerequisites

- Node.js `24+`
- pnpm `10+`
- PostgreSQL database
- At least one AI provider key, such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, or `GEMINI_API_KEY`

### Install

```sh
git clone https://github.com/omkarbhad/graphini.git
cd graphini
pnpm install
cp .env.example .env
```

Fill in `DATABASE_URL`, `COOKIE_SECRET`, and whichever provider keys you want to use.

### Database

Apply the checked-in schema and migrations:

```sh
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/v2-schema.sql
psql "$DATABASE_URL" -f database/add-app-settings.sql
psql "$DATABASE_URL" -f database/add-admin-settings.sql
psql "$DATABASE_URL" -f database/add-files-persistence.sql
psql "$DATABASE_URL" -f database/add-files-support.sql
psql "$DATABASE_URL" -f database/add-user-memories.sql
psql "$DATABASE_URL" -f database/add-gemini-provider.sql
psql "$DATABASE_URL" -f database/performance-indexes.sql
```

### Run

```sh
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Localhost development automatically enables the dev auth bypass unless you configure auth differently.

## Configuration

Typical `.env`:

```env
# Auth
MAGNOVA_AUTH_URL=https://auth.magnova.ai
COOKIE_SECRET=replace-with-a-long-random-secret
DEV_BYPASS_AUTH=true

# Database
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# AI providers
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
ANTHROPIC_API_KEY=
ANTHROPIC_AUTH_TOKEN=
OPENROUTER_API_KEY=
GEMINI_API_KEY=

# Admin
ADMIN_SECRET_KEY=replace-with-admin-secret
ADMIN_EMAIL_OVERRIDES=admin@example.com
```

See [.env.example](.env.example) for all supported variables.

## API

Graphini ships an OpenAPI 3 spec at [api/openapi.yaml](api/openapi.yaml). It documents auth, chat, model settings, workspaces, documents, diagram generation, audio/upload conversion, collaborators, credits, admin operations, and MCP tool discovery.

Useful API groups:

| Area         | Endpoints                                                                             |
| ------------ | ------------------------------------------------------------------------------------- |
| Auth         | `/api/auth/login`, `/api/auth/register`, `/api/auth/me`, `/api/auth/logout`           |
| Chat         | `/api/chat`, `/api/conversations`, `/api/conversations/messages`                      |
| Workspaces   | `/api/workspaces`, `/api/workspaces/{id}`, `/api/workspaces/{id}/document`            |
| Diagrams     | `/api/diagram/generate`, `/api/diagram/generate-stream`, `/api/diagram/analyze-error` |
| Settings     | `/api/app-settings`, `/api/models`, `/api/model-lab`, `/api/admin`                    |
| Integrations | `/api/upload`, `/api/audio`, `/api/mcp/tools`                                         |

## Development

```sh
pnpm dev                    # Vite dev server
pnpm build                  # Production build
pnpm preview                # Preview production build
pnpm lint                   # Prettier + ESLint
pnpm lint:fix               # Format and autofix lint issues
pnpm test:unit              # Vitest
pnpm test:unit:coverage     # Vitest with coverage
pnpm test:e2e               # Playwright
pnpm test                   # Unit + E2E
```

The `predev`, `prebuild`, and `prepreview` hooks run `scripts/build-aws-icon-pack.mjs` so the icon pack is available to the app.

## MermaidSeqBench

Graphini includes a benchmark harness for natural-language-to-Mermaid sequence diagrams:

```sh
pnpm bench:mermaid-seq -- --validate-dataset
OPENROUTER_API_KEY=... pnpm bench:mermaid-seq -- --limit 3
OPENROUTER_API_KEY=... pnpm bench:mermaid-seq -- --model openrouter:nvidia/nemotron-3-super-120b-a12b:free --judge-model openrouter:openai/gpt-oss-120b
```

Runs are written to `tests/logs/mermaid-seq-bench/`.

## Project Structure

```text
graphini/
├── api/                         # OpenAPI spec
├── database/                    # PostgreSQL schema and migrations
├── docs/                        # Project docs, security, code of conduct
├── scripts/                     # Icon-pack build and benchmark scripts
├── src/
│   ├── lib/
│   │   ├── components/          # Shared UI and shell components
│   │   ├── features/
│   │   │   ├── chat/            # AI chat UI and artifacts
│   │   │   ├── diagram/         # Mermaid rendering and diagram state
│   │   │   ├── editor/          # Desktop/mobile editor surfaces
│   │   │   ├── history/         # Diagram history utilities
│   │   │   └── icons/           # Icon metadata and lookup
│   │   ├── server/              # Auth, database, agents, chat, admin, rate limits
│   │   ├── stores/              # Svelte stores
│   │   └── util/                # Client/server helpers
│   └── routes/                  # SvelteKit pages and API routes
├── static/                      # Logo, screenshots, favicons, icon assets
├── tests/                       # Unit and Playwright tests
├── package.json
├── svelte.config.js
└── vite.config.js
```

## Roadmap

- [x] Natural-language Mermaid generation
- [x] Workspace, canvas, edit, and view surfaces
- [x] OpenAPI spec
- [x] Multi-provider AI configuration
- [x] PostgreSQL-backed persistence
- [x] Magnova Auth integration and local dev auth
- [x] Admin and model-lab surfaces
- [x] MermaidSeqBench harness
- [ ] Realtime multi-user editing on one diagram
- [ ] Template gallery for architecture, onboarding, incidents, and CI/CD
- [ ] Deeper diagram diff and review workflow
- [ ] More cloud icon packs beyond AWS

## Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-change`
3. Run `pnpm lint` and the relevant tests
4. Open a pull request

See [docs/CODE_OF_CONDUCT.md](docs/CODE_OF_CONDUCT.md) and [docs/SECURITY.md](docs/SECURITY.md).

## Acknowledgments

- Cowork, for the collaboration/workspace lens behind Graphini
- [Mermaid.js](https://mermaid.js.org), for making diagrams-as-code practical
- [Vercel AI SDK](https://sdk.vercel.ai), for the provider-agnostic AI surface
- [SvelteKit](https://kit.svelte.dev), for the app framework
- [Drizzle ORM](https://orm.drizzle.team), for typed SQL ergonomics
- AWS Architecture Icons, for cloud diagram fidelity

## License

[MIT](LICENSE) © [Omkar Bhad](https://github.com/omkarbhad)
