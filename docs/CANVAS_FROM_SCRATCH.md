# Graphini Canvas — Build from Scratch

**Status:** idea, not yet planned.
**Logged:** 2026-05-07. Captured during a tigerclaw architecture session where this gap was found in the wild.
**Owner:** TBD.
**Related:** Mermaid + Vercel AI SDK (existing stack); ARCHITECTURE.mmd diagrams across our other repos.

## Problem

Mermaid (and D2, and PlantUML) are great as **source-of-truth text formats** for diagrams — git-friendly, AI-editable, render anywhere. But their rendering output is fundamentally **flat and static**:

- Subgraphs are decorative grouping. They cannot collapse, expand, or filter.
- Static SVG output has no click handlers, no zoom, no drill-down, no search.
- "Show me only the AgentRunner subsystem" requires editing the source — not a UI gesture.
- A 297-node diagram is illegible at the level of detail readers actually need.

The Mermaid Live Editor and embedded renderers fix none of this. D2 Studio improves rendering but doesn't add interactive abstraction either. Tools like Structurizr offer drill-down but only across pre-defined C4 levels — not across arbitrary user-chosen groupings.

The web has all the primitives. Nobody has glued them together for **diagrams-as-code with real interactive abstraction**.

## What we'd build

A canvas (in-app, part of Graphini's existing SvelteKit shell) that takes a Mermaid (or D2) source file and produces a fully interactive view:

- **Click a subgraph → it collapses to a single box.** All its internal nodes hide; edges that crossed into the subgraph terminate at the box. Click again → re-expands.
- **Pan + zoom** the whole canvas, native (`d3-zoom` or equivalent).
- **Search by label** — typing "context" highlights every node whose label/id matches; fades the rest.
- **Click a node** — highlights its incoming + outgoing edges, dims everything else.
- **Right-click a subgraph → "isolate"** — hides everything outside it. Useful for "show me only the gateway-side of this system."
- **Hash routing** — `?node=H_agent_runner&collapsed=Substrate,Util` so views are shareable.
- **Live edit + re-render** — Graphini already streams Mermaid edits in chat; the canvas should re-render incrementally as the AI mutates the source.
- **Per-node metadata** — file size, last modified, "in canonical inner loop?", custom tags. The canvas surfaces them as tooltip / sidebar / color-coding.

## Why build it from scratch (vs adopt)

Surveyed during the discussion that spawned this doc:

- **Mermaid + a frontend library**: tried various `mermaid-zoom`-style libraries; they manipulate Mermaid's generated SVG, which is fragile (Mermaid's selectors aren't a stable API). Layout doesn't reflow on collapse.
- **Structurizr**: forces you into the C4 four-level mental model. Excellent for systems-engineering shops; overkill for ad-hoc diagrams.
- **Codecity**: directory-shaped drill-down only. We have it; it works for code structure, but it can't represent architectural concepts that don't map to folders.
- **D2 Studio**: pretty rendering, but no click-collapse on containers either. We were wrong about this in the first round of analysis.

**The build-it-yourself answer is honest:** parse Mermaid into a graph data structure, render with D3.js (or canvas), own the interaction model. ~500 LOC of well-organized TypeScript on the SvelteKit side. Pays for itself the moment you have a 100-node diagram.

## Architecture sketch

Three layers, each independently testable:

1. **Parser layer.** Parse Mermaid (subset: `graph TD/LR`, `subgraph`/`end`, edges, labels, classDefs) into a typed graph:

   ```ts
   type Graph = {
     nodes: Node[];      // { id, label, parent?, class?, metadata }
     edges: Edge[];      // { source, target, label?, kind: "solid" | "dotted" }
     groups: Group[];    // { id, label, parent?, children, collapsed: boolean }
   };
   ```

   Live in `src/lib/canvas/parse-mermaid.ts`. Self-contained, no DOM. Unit-testable against fixture `.mmd` files.

   Future: `parse-d2.ts` for D2 source. Same `Graph` output type — the rest of the canvas is format-agnostic.

2. **Layout layer.** Given a `Graph` + collapsed-group set, compute (x, y, w, h) for every visible node and edge polyline.

   Two layout engines worth supporting:
   - **`elkjs`** — port of Eclipse Layout Kernel. Best for hierarchical / dependency graphs. Handles container nesting natively. Slightly heavy (~500 KB) but high-quality output.
   - **`d3-force`** — physics simulation. Better for "feel free to roam," worse for hierarchies.

   Default to ELK; expose `d3-force` as an alternative for cases where ELK's hierarchy is wrong for the data.

3. **Render layer.** SVG (D3) for fewer-than-1000-nodes case; canvas (`canvas-pixi-stage` or raw 2D context) when we cross that threshold. Either way: native pan/zoom, click → toggle group, hover → highlight neighbors.

   Live in `src/lib/canvas/CanvasView.svelte`. Reactive Svelte stores wire user interaction back to the graph state.

## Phasing (when this gets prioritized)

| Stage | Scope | Time |
|---|---|---|
| 0 | Spike: parse `tigerclaw/docs/ARCHITECTURE.mmd` to JSON, render with naive D3 force layout. Prove the round-trip works. | 1 day |
| 1 | Real parser for the Mermaid subset Graphini's AI generates today. ELK layout. Click-to-collapse. Pan + zoom. | 3 days |
| 2 | Search, click-to-highlight, isolate, hash routing. | 2 days |
| 3 | Live edit integration: when the AI streams Mermaid edits, re-render incrementally without losing the user's collapse state or pan position. | 3 days |
| 4 | D2 parser (same Graph output). | 2 days |
| 5 | Per-node metadata layer (file size, freshness, custom tags). | 1-2 days |

Total: ~2 weeks for a competitive, tigerclaw-real-architecture-handling canvas.

## Why this matters for Graphini specifically

Graphini's pitch is "diagrams that stay editable after the first draft." Today the AI can edit Mermaid source, but the **rendering** is take-it-or-leave-it. A user with a 50-node architecture diagram cannot navigate it. The canvas is the missing half of the editability promise:

- The AI mutates the Mermaid source.
- The canvas mutates the **view** of that source — collapse, focus, zoom.

These are two independent levers, and the user wants both.

It also opens the door to **canvas-driven editing**: drag a node → AI rewrites the Mermaid source to match. That's a future move, but the canvas has to exist first.

## Anti-goals (explicitly out of scope for v1)

- Live multi-user collaboration. Add later if needed; canvases mostly serve one viewer at a time during diagram review.
- Diagram-from-scratch UI. Graphini already has chat-based generation; this canvas only renders existing source.
- Replacing Mermaid as the source format. The canvas reads Mermaid; it doesn't replace it.
- Graphviz/Excalidraw/Figma export. Open file format; let users render the source elsewhere if they want.
- Animation timeline / sequence-diagram playback. Different shape; could be a sister canvas, not this one.

## Open questions

- ELK vs `dagre` vs custom: ELK gives the best output for our shape but is the largest dependency. Worth benchmarking on tigerclaw's 297-node graph before committing.
- Canvas vs SVG break-even point: where does pure D3-on-SVG stop being usable? 500 nodes? 1000?
- Persistence: should collapse state and pan position be saved per-user-per-diagram (server-side) or just hash routing? Probably both, with hash routing first.
- Mobile: do we even support touch interaction in v1, or is this desktop-only?

## Why this is logged here, not built now

This idea surfaced while reviewing tigerclaw's architecture diagram. Tigerclaw work is the priority; the canvas is a Graphini investment that pays back across every project we use Graphini for. Logging it so:

1. We don't forget the design we just talked through.
2. When prioritization comes, the staging and the rejected alternatives are already written down.
3. Anyone else who hits the same problem (a flat Mermaid diagram they wish they could collapse) finds this doc and either picks it up or knows the design intent before iterating.

When prioritized, the natural starting point is **Stage 0 against tigerclaw's `ARCHITECTURE.mmd`** — a known-hard 297-node graph that today is unreadable in static form. If the Stage 0 spike feels usable, the rest of the staging is just elbow grease.
