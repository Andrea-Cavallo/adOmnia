# Diagram Studio

A diagram editor in the spirit of Lucidchart, built on [React Flow](https://github.com/xyflow/xyflow) (`@xyflow/react`) and drawn with adOmnia's own theme tokens. Open it from the rail: **Diagram Studio** (the group also holds the PDF editor and LaTeX Studio).

The window has three parts: the **library** on the left (tabs *Shapes* and *Icons*), the **infinite canvas** in the middle with the **page tabs** bottom left, and the **properties inspector** on the right. Both side panels are hidden and shown from the buttons at the end of the command bar, like the rest of adOmnia; the studio has no title header, so the command bar sits directly under the module bar.

## Drawing

| Action | How |
|---|---|
| Add a shape | Drag it from the library onto the canvas, or click it to drop it in the middle of the view (repeated clicks cascade). Search matches names, categories and keywords (`kafka`, `saga`, `osgi`, `uml interface`…). |
| Connect two shapes | Drag from a connection point (they appear on hover: the middle of each side, plus a quarter and three quarters along sides of 120 px or more) and release it on another shape: on one of its points to pin that point, anywhere else on the shape to let the connector pick the facing side. Released on the empty canvas, the connector gets a new shape of the same kind at its end, ready to be typed in. |
| Edit text | Double-click a shape. Enter commits, Shift+Enter starts a new line, Escape cancels. UML attributes and operations are edited in the inspector. |
| Straighten a connector | Double-click a crooked connector: its bends go away and one end moves so it is exactly horizontal or vertical (a sequence message snaps back to its source row). Double-click an already straight connector to write its label. |
| Label a connector | Double-click a straight connector, or its label. |
| Place a picture | Drop a PNG/JPEG/GIF/WebP/SVG file on the canvas (up to 4 MB, kept inside the diagram), or use **Import**. Resize it with the corner handles, move it freely, connect it like any shape. |
| Fill color | Right-click a shape: the palette swatches and a custom color are at the top of the menu (and in the inspector). Under them, **Corners** offers 0, 4, 10 and 20 px with a glyph that shows the radius, so a block gets its rounding the same way it gets its color. |
| Sticky note | Right-click a shape and choose **Add sticky note**: a yellow note appears beside it, already open for typing. **Add a sticky note here** does the same on the empty canvas. |
| Legend | Right-click the empty canvas and choose **Add legend (colors in use)**: the legend arrives already filled with one row per palette color the diagram uses, most used first (eight at most), named after the palette entry. Colors outside the palette keep their hex. The item is disabled while nothing is colored. |
| Pages | The tabs bottom left switch page; **+** adds one, double-click renames, × deletes the open page. Right-click a tab for **Rename page**, **Open this page**, **Add a page** and **Delete page**. Undo history belongs to the page. |
| Resize / rotate | Select the shape and drag a handle; drag the round handle above it to rotate (15° steps, Shift for a free angle). Boxes of text and containers do not rotate. |
| Bend a connector | Select it and drag a **+** to add a bend; drag a bend to move it, double-click it to remove it. *Reset bends* in the inspector routes it automatically again. |
| Move a connector end | Drag the end of a selected connector onto another shape. |
| Select | Drag on empty canvas for a box selection; Shift/Ctrl/Cmd+click adds to it. |
| Pan / zoom | Wheel or trackpad pans; Ctrl/Cmd+wheel or pinch zooms; Space+drag or the middle button pans. The controls bottom left zoom and fit. |
| Put shapes in a container | Drop a shape inside a *Container* or *System boundary*; drag it out to take it out. *Group* (Ctrl+G) wraps the selection in a new container. |

The floating toolbar above a selection offers duplicate, group/ungroup, align (left, center, right, top, middle, bottom), distribute (three or more shapes), bring to front, send to back, lock and delete. Right-click opens the same actions, plus *Edit text*, *Paste here* and *Add a process here* on the empty canvas.

### Keyboard

| Keys | Action |
|---|---|
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y | Undo, redo (100 steps) |
| Ctrl/Cmd+C, X, V | Copy, cut, paste (each paste lands 32 px further) |
| Ctrl/Cmd+D | Duplicate |
| Ctrl/Cmd+A | Select all |
| Ctrl/Cmd+G, Ctrl/Cmd+Shift+G | Group, ungroup |
| Ctrl/Cmd+L | Lock or unlock (locked shapes cannot be moved, resized, connected or deleted) |
| Ctrl/Cmd+] and [ (with Shift: to front/back) | Layer order |
| Delete or Backspace | Delete the selection |
| Arrow keys (with Shift: 10 px) | Nudge |

Shortcuts work while the canvas has focus and never while you type in a field.

## Shapes

- **Basic shapes:** rectangle, rounded rectangle, ellipse, circle, triangle, diamond, hexagon, star, block arrow, cloud. They start without text.
- **Flowchart:** process, decision, input/output, start/end, connector, document, stored data, subprocess, manual input, preparation, delay, off-page link.
- **Architecture:** service, API, database, cache, message queue, API gateway, load balancer, client, external system.
- **Integration & services:** Go service, Java service, REST endpoint, SOAP endpoint, Kafka topic, domain event, Camel route, Saga orchestrator, Saga step, OSGi bundle.
- **UML:** class and interface (with attribute and operation compartments), actor, use case, package, component.
- **Sequence (UML):** lifeline, actor lifeline, activation bar, loop, alt/else, opt (see *Sequence diagrams*).
- **Containers:** container, swimlane, system boundary (dashed).
- **Text & notes:** free text, note, sticky notes (yellow, pink, green, blue), **legend** (rows of color + meaning, solid or dashed; double-click the title or a row to write in place, *+ Add row* on a selected legend, colors and dashes in the inspector).
- **Icons tab:** two sets, chosen at the top. *Tech logos*: the 3,472 Simple Icons logos in their brand color, grouped in Languages, Runtimes & frameworks, Databases, Messaging & streaming (Kafka, RabbitMQ, Pulsar…), Cloud & hosting, Containers & infrastructure, Operating systems, CI/CD & dev tools, Observability, Security & identity, AI & data science, and *More brands* for the rest. *AWS*: 783 architecture icons (services, resources, categories) in 27 categories. A category menu narrows the list, search matches name, category and aliases (and tells you how many matches the other set has), and the last 12 icons you used stay on top. Drag an icon onto the canvas or click it; it becomes an image node with its name underneath. The pictures are static files (`frontend/public/diagram-icons`, manifest written by `node scripts/import-diagram-icons.mjs --aws <dir> --tech <simple-icons checkout>`) loaded only when the tab opens.

## Sequence diagrams

- **New → Sequence diagram from text…** adds a page drawn from Mermaid-style text (`rect <color> … end` draws a tinted band whose messages take the color, as in the *Saga (orchestrated) · sequence* template): `participant A as Name`, `actor U`, `A->>B: call` (sync, filled arrow), `A-)B: event` (async, open arrow), `A-->>B: reply` (dashed), `A->>A: self`, `loop`/`alt`/`else`/`opt`/`par` … `end`, `autonumber`. The template *Sequence (registration and login)* is a complete example.
- Lifelines have a connection point every 40 px row on both sides of the timeline: a message drawn between two rows stays horizontal however the lifelines move, and lands on the activation bar's edge. Activation bars are children of their lifeline (they move with it); the generator puts them where a participant sends, receives or waits for a reply.
- Fragments are click-through: only their border and operator tab catch the pointer, so what is inside stays selectable. Operands (`[else]`) are edited in the inspector.
- *Align lifelines* in the inspector gives the selected (or all) lifelines the same top, height and spacing.

Every shape has a label, an optional subtitle (technology, port, stereotype) and an optional icon. Colors come from the active theme unless you pick one: the inspector offers restrained swatches (graphite, green, blue, amber, red, violet, paper) and any custom color for fill, border and text, plus border width, corner radius, dashed border and font size. The radius applies to rectangles, rounded boxes, containers and legends (0 keeps the shape's own corners); it is saved with the shape and travels to draw.io as `arcSize`.

## Connectors

- **Routing:** orthogonal (default, rounded corners), Bézier or straight, per connector; *New connectors* in the diagram settings sets the default.
- **Automatic routing:** an orthogonal connector without bends tries several routes and keeps the one that does not cross a shape, then the shortest with the fewest corners. Moving shapes re-routes it.
- **Attachment:** a connector drawn by hand stays on the points you chose. One created by a template (or a future generator) attaches to the sides of the two shapes that face each other and follows them.
- **Style:** color, thickness, dashed, arrowheads at either end (arrow, open arrow, diamond, circle, none), label.
- **Animated data flow:** green pulses travel from source to target. They are hidden when the system asks for reduced motion.

## Generating from a Code Studio workspace

The strip above the canvas turns the project selected in **Code Studio** into a diagram. Nothing is sent anywhere: the analysis is local and read-only.

| Action | What it does |
|---|---|
| **Generate from Workspace** | Analyses the active Code Studio session and opens the *System Architecture* view. If the open diagram came from the same session it is refreshed instead of duplicated. |
| **View selector** | Re-renders the same normalized graph at a different level: *System Architecture* (services, endpoints, topics, tables, external systems), *Service Flow* (one service and its handlers), *Function / Call Flow* (callers/callees around the selected entity), *Endpoint Flow* (route → handler → downstream calls), *OSGi / Legacy Flow* (bundles, flows, subflows, activators). |
| **Refresh from Code** | Re-reads the sources and merges the result into the open diagram. Nodes keep their position, size, label and style; generated relations are replaced; a node whose entity disappeared is kept and marked **stale**; manual nodes and connectors are never touched. |
| **Search** | Finds a service, method, endpoint, topic, table or file in the analysis and brings its node into view. |
| **Status** | Entities and languages that actually fed the diagram, truncation, and the problems the adapters reported. |

Right-click a generated node for the actions that apply to it: **Open in Code Studio (Split Right)** (the diagram stays open on the left, selected and zoomed as it was), **Show Callers / Show Callees**, **Open in API Workspace** for an endpoint, **Open in Database Studio** for a table, **Open in Broker Studio** for a topic, **Copy Symbol / Copy Path** and **Refresh / Re-resolve**. In Code Studio, the editor context menu has **Show in Diagram Studio**, which finds the entity declared at the caret and highlights it.

Every generated node is a navigable entity, not a picture: `data.source` holds the stable adapter id, the session, the source file and line, the confidence and the analysis fingerprint. Every generated connector says how it was found (`declared`, `derived`, `inferred`, `observed`): inferred relations are dashed amber, observed ones animate. The native JSON keeps these references; a PNG/SVG/draw.io export is only a picture.

### Sources and trust

The diagram is a view of the indexes the IDE already builds: the Go **Semantic Workspace Graph** (`internal/ide/graph`, filled by the Architecture Explorer) and **Flow Intelligence** (`internal/flowintel`, Java/XML/OSGi). `internal/diagrams/workspace.go` normalizes and deduplicates them, attributes every entity to its owning module/bundle, and `internal/codestudio/diagram_workspace.go` exposes it as one binding (`GoIDE.DiagramWorkspace`). The analysis is refused for a project whose tools are not explicitly authorized in Code Studio.

Unsaved Monaco buffers are not analysed: when a buffer becomes dirty the generated nodes are marked stale and the notice says the diagram reflects the last saved sources. Save, then **Refresh from Code**.

## Layout and templates



**Layout** runs ELK's layered algorithm left to right; the arrow next to it lays out top to bottom. Locked shapes stay where they are, and manual bends are cleared so the connectors route again. ELK is loaded the first time you use it.

**New** creates a blank diagram or one of the presets, grouped in the menu. Each preset has to show something the shape library alone does not: pick a variant that only renames the shapes and the menu becomes harder to read.

| Group | Preset | What it shows |
| --- | --- | --- |
| Sequence | *Debug request · sequence* | The adOmnia loop: API Workspace sends the request, Code Studio starts the service under Delve, the breakpoint stops it, SQL and the event are captured |
| Sequence | *Kafka retry and DLQ · sequence* | Async arrows, a backoff loop on the retry topic and the dead-letter queue |
| Sequence | *Saga (orchestrated) · sequence* | The Saga as a UML sequence: forward steps in blue, the failure in red, the compensations in amber |
| Sequence | *Sequence (registration and login)* | Lifelines, sync calls, replies, activation bars and an `alt` fragment |
| Architecture | *Service platform* | A system boundary with two services inside, a shared database, a cache, a topic and an external SOAP system |
| Architecture | *Request across layers · swimlanes* | One `POST /orders` as five lanes — client, edge, service, database, event bus — with the steps of each layer |
| Architecture | *Event-driven with Kafka* | Technology icons as nodes: an outbox relayed to a topic, three consumers, a search projection and a dead-letter topic |
| Architecture | *Streaming analytics* | Kafka → Flink → ClickHouse and object storage, read by Grafana |
| Architecture | *Microservices on Kubernetes* | Icons inside a cluster boundary, and the telemetry path to Jaeger, Prometheus and Grafana |
| Patterns | *CQRS with a read model* | Shapes and icons mixed: command side, events, projector, read model, query side |
| Patterns | *Saga (orchestrated)* | An orchestrator, its three local transactions, their compensations and the two outcomes, colored by role |

A blueprint is laid out by ELK when it is created; swimlane presets place their lanes by declaration order instead (`lanesFromBlueprint`), because ELK orders top-level nodes by their edges and lanes must read in the order they were written. `templates.test.ts` builds every preset and fails on an unknown shape, an unknown color, a link to a node that does not exist or a fragment that is never closed.

## Saving, import and export

- Diagrams are saved automatically, 0.8 s after the last change, in adOmnia's local bbolt store (bucket `diagrams`): a small `meta:<id>` entry for the list and the diagram under `doc:<id>`. The command bar shows *Unsaved changes*, *Saving…* or *Saved*. A failed save shows **Not saved · retry**; the change is kept and retried with the next edit or the retry button. A pending save is written before switching diagram, when the window is hidden and when the studio closes.
- The diagram list (folder button) opens any saved diagram; the trash button deletes the open one after a confirmation.
- **Export** writes the whole diagram, not only the visible part, through the native Save dialog: **PNG** (2× density), **SVG** (with the editable diagram embedded, so importing it gives back every shape and page), **draw.io** (`.drawio`, one page per page; shapes map to the closest draw.io style, colors, text, containers, connection points, routing, arrowheads and bends are kept; library icons are embedded as data URLs) or **adOmnia JSON**.
- **Import** (or drop the file on the canvas) opens as a new diagram: adOmnia JSON, an SVG exported by adOmnia, `.drawio`/`.xml` (plain or compressed pages, every page), a draw.io SVG (its file is read from the SVG), or a blueprint written by the MCP server. Any other picture is placed as an image. Importing twice never overwrites anything.
- **A draw.io file lands in adOmnia's style.** draw.io's light defaults are translated instead of kept: `#ffffff`/`#f5f5f5` fills follow the theme, the standard pastel fills (`#dae8fc`, `#d5e8d4`, `#ffe6cc`, `#f8cecc`, `#e1d5e7`, `#fff2cc`) become the matching graphite/green/blue/amber/red/violet tint, black borders and black text follow the theme so they stay visible on the dark canvas, and any other color is kept exactly. A label's second, smaller line (`Service<br><font size=10>Go</font>`) becomes the subtitle, `rounded=1` with `arcSize` becomes the corner radius, containers keep their children and connection constraints pick the nearest connection point. Compressed pages are inflated in the browser.
- **New → From Markdown…** generates a colored, laid-out diagram: `#` is the name, `##` sections with bullet lists become containers of components (shape inferred from the words: database, Kafka topic, queue, cache, gateway, client, external, service), numbered lists become step flows (questions become decisions), `A -> B: label` lines become connectors (`-->` dashed, `=>` animated), ```mermaid flowcharts and `sequenceDiagram` blocks are read too (a sequence becomes its own page). The parser is in Go (`internal/diagrams`), shared with the MCP server.

### MCP

`adomnia mcp` exposes `diagram_shapes` (shape ids and colors), `diagram_from_markdown` (Markdown text or a `.md` file in the workspace) and `diagram_create` (a blueprint the agent writes: nodes with key/shape/label/color/parent, links, optional sequence text). Both return the blueprint; with `output` (`"default"` = `diagrams/<name>.adomnia-diagram.json`) and a server started with `--write` they save it inside the workspace. Open the file in Diagram Studio with Import or by dropping it on the canvas: it is laid out with ELK and every element stays editable.

Two read-only tools expose the indexed workspace: `diagram_workspace_overview` (entities by kind, adapters, services, source problems) and `diagram_find_entity` (stable id, file and line for a service, method, flow, bundle, endpoint, topic or table). They use the Flow Intelligence index (Java/XML/OSGi); the Go Semantic Workspace Graph is added by the desktop app. An agent must not present an inferred relation as verified: the normalized model reports confidence and evidence.

### File format

```json
{
  "format": "adomnia-diagram",
  "version": 2,
  "id": "diag_…", "name": "Orders", "createdAt": 0, "updatedAt": 0,
  "activePageId": "page_…",
  "pages": [{ "id": "page_…", "name": "Page 1", "nodes": [], "edges": [], "viewport": { "x": 0, "y": 0, "zoom": 1 } }],
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "settings": { "grid": "dots", "snapToGrid": true, "gridSize": 16, "defaultRouting": "orthogonal" },
  "origin": { "sessionId": "go-…", "workspaceId": "…", "root": "/repo", "projectName": "payments", "fingerprint": "…",
              "generatedAt": 0, "view": "architecture", "focusId": "mod:payments (optional)", "sources": ["go", "flow"] },
  "nodes": [{ "id": "n_…", "type": "shape", "position": { "x": 0, "y": 0 }, "width": 170, "height": 76,
              "parentId": "n_container (optional)", "zIndex": 0,
              "data": { "shape": "go-service", "label": "orders", "subtitle": "Go", "icon": "server", "rotation": 0, "locked": false,
                        "generated": true, "stale": false, "service": "mod:payments",
                        "source": { "sessionId": "go-…", "entityId": "fn:payments.CreatePayment", "kind": "function",
                                    "file": "service/payment.go", "line": 42, "column": 1, "symbol": "payments.CreatePayment",
                                    "confidence": "derived", "fingerprint": "…" },
                        "style": { "fill": "", "stroke": "", "strokeWidth": 1.5, "radius": 0, "textColor": "", "fontSize": 13, "dashed": false } } }],
  "edges": [{ "id": "e_…", "type": "smart", "source": "n_a", "target": "n_b", "sourceHandle": "right-50", "targetHandle": null,
              "data": { "routing": "orthogonal", "label": "", "color": "", "thickness": 1.5, "dashed": false,
                        "arrowStart": "none", "arrowEnd": "arrow", "flow": false, "waypoints": [],
                        "confidence": "inferred", "evidence": "calls · inferred", "generated": true } }]
}
```

`pages` holds every page; the top-level `nodes`/`edges`/`viewport` repeat the active page. Version 1 files (no pages) open as one page. Node data may also carry `image` (data URL or app URL), `legend` (`[{ color, label, dashed? }]`) and `dividers` (`[{ y, label }]`, fragment operands). Empty colors mean "follow the theme". Reading is defensive: missing fields get their defaults, connectors to missing shapes are dropped, an unknown shape draws as a process box and keeps its id, a container listed after its children is reordered, and a file from a newer format is refused with a message instead of being half-read. A format change bumps `DIAGRAM_FORMAT_VERSION` and adds a step to `MIGRATIONS` in `serialization.ts`.

## Architecture

| Piece | Where | What |
|---|---|---|
| Model | `frontend/src/lib/diagrams/model.ts` | Document, node and edge types (React Flow types with typed data), defaults |
| Shape catalog | `lib/diagrams/shapes.ts` | Shapes as data: category, size, default style, icon, keywords |
| Geometry | `lib/diagrams/geometry.ts` | SVG outlines of each geometry at any size (canvas and library share it) |
| Graph operations | `lib/diagrams/graphOps.ts` | Pure edits: create, delete, copy/paste, group, reparent on drop, align, distribute, layers, lock |
| History | `lib/diagrams/history.ts` | Bounded undo/redo snapshots without selection state |
| Routing | `lib/diagrams/routing.ts` | Connector points and paths, automatic orthogonal routing, facing-side anchors |
| Guides | `lib/diagrams/guides.ts` | Snap and guide lines while dragging |
| Layout | `lib/diagrams/layout.ts` | ELK input and result, loaded on demand |
| Serialization | `lib/diagrams/serialization.ts` | Versioned JSON, validation, migrations |
| Persistence | `lib/diagrams/storage.ts`, `autosave.ts` | Repository over the generic `Storage*` Wails bindings (injected backend, tested in memory); debounced autosave |
| Export | `lib/diagrams/export.ts` | PNG/SVG through html-to-image (loaded on demand), JSON, native Save dialog |
| Blueprints | `lib/diagrams/blueprint.ts`, `templates.ts` | Diagrams described as typed nodes and links, built and laid out (swimlane presets place their lanes themselves) |
| Sequence | `lib/diagrams/sequence.ts` | Mermaid-style text → lifelines, row-attached messages, activation bars, fragments |
| Legend | `lib/diagrams/legend.ts` | Rows for the colors a diagram already uses (palette names, hex for custom colors) |
| draw.io | `lib/diagrams/drawio.ts` | `.drawio` export and import (plain and compressed pages), with draw.io's palette mapped to adOmnia's tints |
| Import | `lib/diagrams/importFile.ts` | What a dropped/imported file becomes (diagram, blueprint, picture) |
| Straighten | `lib/diagrams/straighten.ts` | Double-click straightening of crooked connectors |
| Workspace analysis | `lib/diagrams/workspace.ts`, `workspaceMerge.ts` | View selection over the normalized model, source refs, confidence, merge on refresh |
| Workspace state | `stores/diagramCodeGraph.ts` | Analysis cache per session, views, expand, reveal, open source |
| Normalizer (Go) | `internal/diagrams/workspace.go` | Deduplicate Go + Flow graphs, attribute entities to services, stable ids |
| Analysis binding | `internal/codestudio/diagram_workspace.go` | One authorized call returning the normalized workspace |
| Split | `lib/workspaceLayout.ts`, `MainAreaRouter.tsx` | Diagram Studio + Code Studio pair in the same coordinator as API ↔ code |
| Markdown, MCP | `internal/diagrams`, `diagram_bindings.go`, `internal/adomniacli/mcp_diagram.go` | Markdown → blueprint parser, `diagram_*` MCP tools |
| State | `stores/diagramStudio.ts`, `stores/diagramStudioUi.ts` | Document, history, clipboard and save state; editor-only UI state kept apart |
| UI | `components/diagrams/` | Panel, canvas, shape node, smart edge, library, inspector, toolbar, context menu, actions registry |
| Go | `internal/storage/storage.go` | The `diagrams` bucket |

Every edit goes through the store's `commit`, which records one undo step and schedules the save; continuous gestures (drag, resize, rotate, moving a bend) record their step when they start. Toolbar, context menu and keyboard read the same action list (`diagramActions.ts`).

### Extending

- **A shape:** one entry in `SHAPES`; a new outline only when no existing geometry fits (`ShapeGeometry` + a case in `outlineOf`).
- **A template:** one blueprint in `templates.ts`. A node or a link takes a `color` of the inspector palette (`green`, `blue`, `amber`, `red`, `violet`, `graphite`) when the color carries a meaning, as in the Saga template; nodes of a layer are laid out in the order they are declared.
- **Diagrams from the workspace:** a view lives in `lib/diagrams/workspace.ts` (select entities and links from the normalized model); discovery belongs to the language adapters. A new entity kind: add it to `internal/diagrams` (`normalizeKind`), then map it to a shape in `SHAPES`/`SERVICE_LANGUAGE_SHAPE` in `workspace.ts`. A new adapter (another language): fill the Semantic Workspace Graph from its analyzer; the normalizer and Diagram Studio stay unchanged.

## Known limits

- Desktop acceptance in the Wails app is still to be done; the editor was exercised end to end in Chromium with the storage and Save-dialog bindings stubbed.
- Automatic routing is a heuristic over a few candidate routes, not a full path search: in dense diagrams a connector can still cross a shape; add a bend to steer it.
- Rotation turns the outline and text; connection points stay on the shape's unrotated box.
- Auto-layout arranges top-level shapes; shapes inside a container keep their place in it.
- Exported pictures show data-flow pulses frozen in place.
- Workspace generation covers what the indexed adapters found: Go needs the project's tools authorized in Code Studio; Java/OSGi comes from Flow Intelligence. A view is capped (140 shapes by default) and the status reports truncation instead of drawing a partial graph silently.
- Expanding is neighbour-based (callers/callees, one hop per action), not a full recursive call tree; use Flow Intelligence's trace/impact for deep traversal.
- A renamed symbol is re-resolved by file and then by symbol name; if both changed, the old node is marked stale and **Refresh / Re-resolve** rebuilds the view.
