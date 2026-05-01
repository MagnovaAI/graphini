# Graphini Multi-Agent Design

## Goal

Turn Graphini's current single chat assistant into a deployable multi-agent diagram workspace. The user should be able to ask for architecture diagrams, refactors, debugging, docs, data analysis, and visual polish while specialized agents collaborate behind one chat UI.

## Recommended Libraries

Use the libraries already aligned with this codebase:

- `ai` v6 as the main agent/tool runtime.
- `@openrouter/ai-sdk-provider` for provider routing across OpenAI, Anthropic, Google, and other models.
- Add provider-specific AI SDK packages only if we need embeddings or provider-only features.
- `zod` for strict tool input/output schemas.
- `drizzle-orm` with the existing database layer for run logs, traces, memories, and durable agent state.
- Mermaid and the existing canvas/editor stores for UI updates.

Avoid adding LangChain or CrewAI for the first implementation. They add orchestration concepts that overlap with AI SDK v6, while this app already has tool calling, streaming, OpenRouter, Svelte chat UI, and typed tools. Revisit a workflow engine later only if we need durable background jobs, retries across hours, or scheduled autonomous work.

## Agent Topology

### 1. Orchestrator Agent

Owns the conversation and delegates work. It decides whether a request is casual chat, diagram generation, editing, research, data analysis, or documentation.

Responsibilities:

- Classify the user request.
- Pick specialist agents.
- Merge specialist outputs into one user-facing response.
- Enforce budget, max steps, and tool permissions.
- Keep the response short unless the user asks for detail.

Recommended model:

- Fast/default: `openai/gpt-4.1-mini` or equivalent OpenRouter model.
- Hard architecture/design: a stronger model such as `anthropic/claude-sonnet-4.5` or current top OpenAI model through OpenRouter.

### 2. Planner Agent

Breaks complex diagram requests into steps and acceptance criteria.

Use when:

- User asks to design a system.
- User asks for a full architecture.
- User says "think harder", "plan", or asks for trade-offs.

Output:

- Task summary.
- Ordered plan.
- Agent assignments.
- Risks or missing information.

### 3. Diagram Engineer Agent

Writes and edits Mermaid only.

Tools:

- `diagramRead`
- `diagramWrite`
- `diagramPatch`
- `diagramDelete`
- `errorChecker`

Rules:

- Never write prose into diagram tools.
- For new diagrams, use `diagramWrite`.
- For existing diagrams, read first, patch/write second, validate after.
- Produce meaningful diagrams with enough real components, not filler.

### 4. Visual Polish Agent

Improves readability, layout, colors, labels, grouping, and icons.

Tools:

- `diagramRead`
- `diagramPatch`
- `diagramWrite`
- `autoStyler`
- `iconifier`
- `errorChecker`

Use after the Diagram Engineer has produced valid Mermaid.

### 5. Research Agent

Looks up current technical details, docs, services, and integration facts.

Tools:

- `webSearch`
- `fileManager`
- future: provider docs search or MCP connectors.

Rules:

- Only browse when information may be stale or the user asks for current facts.
- Return concise sourced facts to the Orchestrator, not a long essay.

### 6. Document Agent

Writes implementation notes, architecture docs, migration plans, and summaries in the document panel.

Tools:

- `markdownRead`
- `markdownWrite`
- `fileManager`
- `actionItemExtractor`

Rules:

- Never write Mermaid through markdown tools unless the user explicitly wants documentation containing fenced Mermaid.
- Keep docs aligned with the active diagram.

### 7. Data Agent

Analyzes uploaded CSV/XLSX/table data and can suggest charts or diagrams.

Tools:

- `fileManager`
- `tableAnalytics`
- `dataAnalyzer`

Use when:

- User asks about uploaded files.
- User wants dashboards, process diagrams from data, or summaries.

### 8. Critic Agent

Reviews the proposed diagram/doc before finalizing.

Tools:

- `selfCritique`
- `errorChecker`

Use when:

- The task is high complexity.
- The user asks for quality review.
- The orchestrator detects many edits or a full rewrite.

## Execution Pattern

Start with a routed sequential flow:

1. Orchestrator classifies request.
2. Planner runs only for complex tasks.
3. One specialist performs the main work.
4. Optional polish or critic agent runs.
5. Orchestrator summarizes the result.

Do not run all agents for every prompt. Multi-agent should mean better task routing, not more latency.

## First Implementation Slice

### Phase 1: Extract Agent Runtime

Create:

- `src/lib/server/agents/types.ts`
- `src/lib/server/agents/models.ts`
- `src/lib/server/agents/tools.ts`
- `src/lib/server/agents/orchestrator.ts`
- `src/lib/server/agents/specialists/diagram-engineer.ts`
- `src/lib/server/agents/specialists/planner.ts`
- `src/lib/server/agents/specialists/critic.ts`

Move tool creation out of `src/routes/api/chat/+server.ts` behind a typed factory. Keep the route API stable so the frontend keeps working.

### Phase 2: Replace Giant Prompt With Routing

The current prompt contains all behavior in one place. Replace it with:

- Small orchestrator prompt.
- Specialist prompts colocated with each specialist.
- Shared safety/tool rules in one module.

### Phase 3: Add Run Tracing

Persist:

- agent run id
- conversation id
- selected model
- agent role
- tool calls
- token usage
- status
- error details

Use the existing database layer rather than introducing a new persistence service.

### Phase 4: UI Agent Activity

Expose activity events to the chat UI:

- `Planning`
- `Editing diagram`
- `Checking syntax`
- `Styling`
- `Reviewing`
- `Done`

This makes multi-agent behavior visible without overwhelming the user.

## Deployment Shape

For Vercel/serverless:

- Keep each chat request as one bounded agent run.
- Use `AbortSignal.timeout`.
- Limit max tool steps per agent.
- Store durable state in the database, not process memory.
- Treat current in-memory stores as development-only.

For long-running background work later:

- Add a job queue or workflow layer after the API is stable.
- Candidate options: Inngest, Trigger.dev, or Vercel Workflow if this project is deployed primarily on Vercel.

## Near-Term Defaults

Recommended defaults:

- Runtime: AI SDK v6.
- Provider router: OpenRouter.
- Schemas: Zod.
- Agent orchestration: local TypeScript orchestrator first.
- Durable state: existing Drizzle database.
- Background jobs: defer.
- MCP: defer until external tools become a real requirement.

This keeps the implementation tight: one chat route, multiple specialist modules, typed tools, streamed UI, and deployable behavior without a framework rewrite.
