# Diagram Studio

A diagram editor in the spirit of Lucidchart, built on [React Flow](https://github.com/xyflow/xyflow) (`@xyflow/react`) and drawn with adOmnia's own theme tokens. Open it from the rail: **Document Studio → Diagram Studio**.

The window has three parts: the **shape library** on the left, the **infinite canvas** in the middle, and the **properties inspector** on the right (toggle it with the panel button at the end of the command bar).

## Drawing

| Action | How |
|---|---|
| Add a shape | Drag it from the library onto the canvas, or click it to drop it in the middle of the view (repeated clicks cascade). Search matches names, categories and keywords (`kafka`, `saga`, `osgi`, `uml interface`…). |
| Connect two shapes | Drag from a connection point (they appear on hover: the middle of each side, plus a quarter and three quarters along sides of 120 px or more) and release it on another shape: on one of its points to pin that point, anywhere else on the shape to let the connector pick the facing side. Released on the empty canvas, the connector gets a new shape of the same kind at its end, ready to be typed in. |
| Edit text | Double-click a shape. Enter commits, Shift+Enter starts a new line, Escape cancels. UML attributes and operations are edited in the inspector. |
| Label a connector | Double-click the connector (or its label). |
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
- **Containers:** container, swimlane, system boundary (dashed).
- **Text & notes:** free text, note.

Every shape has a label, an optional subtitle (technology, port, stereotype) and an optional icon. Colors come from the active theme unless you pick one: the inspector offers restrained swatches (graphite, green, blue, amber, red, violet, paper) and any custom color for fill, border and text, plus border width, dashed border and font size.

## Connectors

- **Routing:** orthogonal (default, rounded corners), Bézier or straight, per connector; *New connectors* in the diagram settings sets the default.
- **Automatic routing:** an orthogonal connector without bends tries several routes and keeps the one that does not cross a shape, then the shortest with the fewest corners. Moving shapes re-routes it.
- **Attachment:** a connector drawn by hand stays on the points you chose. One created by a template (or a future generator) attaches to the sides of the two shapes that face each other and follows them.
- **Style:** color, thickness, dashed, arrowheads at either end (arrow, open arrow, diamond, circle, none), label.
- **Animated data flow:** green pulses travel from source to target. They are hidden when the system asks for reduced motion.

## Layout and templates

**Layout** runs ELK's layered algorithm left to right; the arrow next to it lays out top to bottom. Locked shapes stay where they are, and manual bends are cleared so the connectors route again. ELK is loaded the first time you use it.

**New** creates a blank diagram or the worked example, *Saga (orchestrated)*: an orchestrator, its three local transactions, their compensations and the two outcomes, colored by role.

## Saving, import and export

- Diagrams are saved automatically, 0.8 s after the last change, in adOmnia's local bbolt store (bucket `diagrams`): a small `meta:<id>` entry for the list and the diagram under `doc:<id>`. The command bar shows *Unsaved changes*, *Saving…* or *Saved*. A failed save shows **Not saved · retry**; the change is kept and retried with the next edit or the retry button. A pending save is written before switching diagram, when the window is hidden and when the studio closes.
- The diagram list (folder button) opens any saved diagram; the trash button deletes the open one after a confirmation.
- **Export** writes the whole diagram, not only the visible part, through the native Save dialog: **PNG** (2× density), **SVG**, or **adOmnia JSON**. **Import** reads that JSON back as a new diagram, so importing a file twice never overwrites anything.

### File format

```json
{
  "format": "adomnia-diagram",
  "version": 1,
  "id": "diag_…", "name": "Orders", "createdAt": 0, "updatedAt": 0,
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "settings": { "grid": "dots", "snapToGrid": true, "gridSize": 16, "defaultRouting": "orthogonal" },
  "nodes": [{ "id": "n_…", "type": "shape", "position": { "x": 0, "y": 0 }, "width": 170, "height": 76,
              "parentId": "n_container (optional)", "zIndex": 0,
              "data": { "shape": "go-service", "label": "orders", "subtitle": "Go", "icon": "server", "rotation": 0, "locked": false,
                        "style": { "fill": "", "stroke": "", "strokeWidth": 1.5, "textColor": "", "fontSize": 13, "dashed": false } } }],
  "edges": [{ "id": "e_…", "type": "smart", "source": "n_a", "target": "n_b", "sourceHandle": "right-50", "targetHandle": null,
              "data": { "routing": "orthogonal", "label": "", "color": "", "thickness": 1.5, "dashed": false,
                        "arrowStart": "none", "arrowEnd": "arrow", "flow": false, "waypoints": [] } }]
}
```

Empty colors mean "follow the theme". Reading is defensive: missing fields get their defaults, connectors to missing shapes are dropped, an unknown shape draws as a process box and keeps its id, a container listed after its children is reordered, and a file from a newer format is refused with a message instead of being half-read. A format change bumps `DIAGRAM_FORMAT_VERSION` and adds a step to `MIGRATIONS` in `serialization.ts`.

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
| Blueprints | `lib/diagrams/blueprint.ts`, `templates.ts` | Diagrams described as typed nodes and links, built and laid out |
| State | `stores/diagramStudio.ts`, `stores/diagramStudioUi.ts` | Document, history, clipboard and save state; editor-only UI state kept apart |
| UI | `components/diagrams/` | Panel, canvas, shape node, smart edge, library, inspector, toolbar, context menu, actions registry |
| Go | `internal/storage/storage.go` | The `diagrams` bucket |

Every edit goes through the store's `commit`, which records one undo step and schedules the save; continuous gestures (drag, resize, rotate, moving a bend) record their step when they start. Toolbar, context menu and keyboard read the same action list (`diagramActions.ts`).

### Extending

- **A shape:** one entry in `SHAPES`; a new outline only when no existing geometry fits (`ShapeGeometry` + a case in `outlineOf`).
- **A template:** one blueprint in `templates.ts`. A node or a link takes a `color` of the inspector palette (`green`, `blue`, `amber`, `red`, `violet`, `graphite`) when the color carries a meaning, as in the Saga template; nodes of a layer are laid out in the order they are declared.
- **Diagrams from the workspace:** implement `DiagramSource` (`blueprint.ts`): `describe()` returns a blueprint of typed nodes and links, and `diagramFromBlueprint` lays it out. Discovery (Developer Context routes, Kafka topics, datasources, OSGi bundles…) belongs in that source, outside the editor; the editor never reads the workspace.

## Known limits

- Desktop acceptance in the Wails app is still to be done; the editor was exercised end to end in Chromium with the storage and Save-dialog bindings stubbed.
- Automatic routing is a heuristic over a few candidate routes, not a full path search: in dense diagrams a connector can still cross a shape; add a bend to steer it.
- Rotation turns the outline and text; connection points stay on the shape's unrotated box.
- Auto-layout arranges top-level shapes; shapes inside a container keep their place in it.
- Exported pictures show data-flow pulses frozen in place.
