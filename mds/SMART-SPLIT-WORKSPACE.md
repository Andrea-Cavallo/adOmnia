# Smart Split Workspace

Goal, in one screen: **open an API → find its handler → send the request → stop at the
breakpoint → inspect a query → return to the response**, without losing the project,
service or request at any step.

This is the priority before new languages, themes or standalone tools.

## Principle

No second system. The pieces exist; what is missing is one **focus** they all share and one
**coordinator** that owns the layout.

```
             Developer Context (internal/devcontext, stores/devcontext.ts)
             entities: route · handler · datasource · topic …   ← exists
                                │
                        Workspace Focus                           ← new, small
            project · service · route · handler · request tab · live run
                                │
      ┌──────────────┬──────────┴───────┬──────────────────┐
  API Workspace   Code Studio       Debugger          Database Studio
      └──────────────┴──────────┬───────┴──────────────────┘
                Layout & Navigation Coordinator                   ← extends moduleRouting
                split · focus · restore · synchronize
```

## What exists today (2026-11-07)

| Piece | Where | Limit |
|---|---|---|
| Entities route/handler/datasource per Code Studio session | `internal/devcontext`, `stores/devcontext.ts` | Snapshot only: no notion of "the one I am working on" |
| API ↔ Code link (one selected route/handler/tab) | `lib/api-code-link/*` (`ApiCodeLink`, `linkStore`) | Covers two panels only; no service, no live run, no query |
| Live run ↔ request tab ↔ breakpoint | `stores/devSession.ts` (`runByTab`, `runs`, `hits`) | Separate from the link above |
| Module requests without knowing React | `lib/moduleRouting.ts` (`ModuleAction`, `routeToModule`, cross-window) | Every action *replaces* the active rail: no placement |
| Split | `MainAreaRouter.tsx` + `app.splitView` + `api-code-link/splitView.ts` | Hard-coded to `collections` + `codestudio`, two panes |
| Split Debug View | `lib/devsession/navigation.ts#openSplitDebugView` | Same two-pane split |
| SQL of a live run → Database | `ContextSwitcher.tsx`, `LiveRequestViews.tsx` (`handoffToPanel('database', …)`) | **Leaves the split**: Database replaces the screen |
| Tool shortcuts Alt+Shift+1…5 | `DevSessionHost.tsx` | Call `setSplitView(false)`: they break the split |
| Back | Code Studio history (`codeStudioNavigation.ts`), `goBack` in MainAreaRouter | Per-module; layout is never restored |

The break in the target flow is precisely at "analyze a query" (Database leaves the split) and
"return to the response" (no layout history).

## Design

### 1. Workspace Focus — `stores/workspaceFocus.ts`

One record, derived where possible, never a copy of what another store owns:

```ts
interface WorkspaceFocus {
  sessionId?: string        // Code Studio session = project identity
  service?: string          // devSession service name
  routeId?: string          // Developer Context entity id
  handler?: { file: string; line: number }
  requestTabId?: string     // API Workspace tab
  runId?: string            // devSession run (request → breakpoint → SQL)
  queryId?: string          // SQL statement of that run
}
```

- `ApiCodeLink` becomes a **view** of the focus (`sessionId/routeId/file/line/requestTabId`):
  `linkStore` keeps its API, and writes through to the focus. No consumer changes.
- `runId` is filled from `devSession.runByTab[requestTabId]`; `service` from the run's session.
- Rule: a focus field is only ever set together with its parent (route ⇒ session), so a
  navigation can never mix project A's handler with project B's request.
- Session-only (not persisted). The layout is persisted; the focus is not.

### 2. Layout & Navigation Coordinator — `lib/workspaceLayout.ts`

Extends `moduleRouting` instead of adding a parallel router.

- **Pane registry**: which rails can live in a split (`collections`, `codestudio`, `database`,
  later `broker`, `loginspector`). `MainAreaRouter` renders panes from a layout value, not from
  the `collections`/`codestudio` literal.
- **Layout value**: the two primary panes (side and ratio in `adomnia.apiCode.split.v1`, unchanged)
  plus at most one auxiliary pane on the far side (width in `adomnia.workspace.auxRatio.v1`).
- **Placement on every action**: `RouteOptions.placement?: 'replace' | 'auxiliary'`.
  Default `replace` = today's behaviour, so no existing call changes. A module asks
  `routeToModule('database', action, { placement: 'auxiliary' })` and never imports the panel.
- **Focus without unmount**: panes stay mounted (already true for the two-pane split); keyboard
  focus moves, buffers/tabs/scroll survive.
- **Layout history**: each placement change pushes `{ layout, focus }`; *Back* (Alt+←, and a
  "Back to response" chip) pops it. This is how "return to the response" works.
- **Synchronize**: when the focus changes (route selected in API, breakpoint hit, query picked),
  the other visible panes follow — handler revealed, request tab activated — but only panes that
  are already visible; nothing opens unasked.
- Detached windows: an action for a detached rail keeps going to its window (existing
  `moduleRouting` behaviour); placement is ignored there.

### 3. Shortcuts and entry points

- Alt+Shift+1…5 **focus** the pane when it is in the split, open it only if it is not; never
  close the split.
- Split header: pane switcher, maximize/hide/close per pane (generalizes `SplitViewHeader`).

## Status (2026-11-07)

All six phases are implemented; desktop acceptance (SSW-M1…M8 below) is still open.

| Phase | Delivered | Where |
|---|---|---|
| 1. Coordinator core | Split rendered from panes (`SPLIT_PRIMARY_PANES` + one of `SPLIT_AUXILIARY_PANES`), `placement: 'replace' \| 'auxiliary'` on `routeToModule`/`showModule`/`handoffToPanel` (default `replace`), resizable third pane with saved width (`adomnia.workspace.auxRatio.v1`) | `lib/workspaceLayout.ts`, `lib/moduleRouting.ts`, `lib/entities/dispatch.ts`, `stores/app.ts` (`splitAuxiliary`), `MainAreaRouter.tsx` |
| 2. Workspace Focus | Derived from API ↔ code link, active request tab and Live Session, never copied; identity rule enforced in `deriveFocus`; focus line in the split header with the project name | `lib/workspaceFocus.ts`, `hooks/useWorkspaceFocus.ts`, `SplitViewHeader.tsx` |
| 3. Database as third pane | `openLiveQuery` (DB tab, context switcher) and Kafka messages use `placement: 'auxiliary'`; connection preselected from the capture proxy datasource; Alt+Shift+3/4/5 add the pane instead of closing the split | `lib/devsession/navigation.ts`, `LiveRequestViews.tsx`, `ContextSwitcher.tsx`, `database/datasourceMatch.ts`, `DevSessionHost.tsx` |
| 4. Layout history | Snapshot on every coordinated change, *Back to response* button and Alt+← (before the rail history), trail cleared when the split closes | `lib/workspaceLayout.ts`, `SplitViewHeader.tsx`, `MainAreaRouter.tsx` |
| 5. Synchronization | A new breakpoint hit with the split open activates its request tab and reveals the paused frame in the visible panes; the split no longer closes on any Live Session event, only when the debugger ends | `DevSessionHost.tsx` |
| 6. Docs | `docs/LIVE-SESSION.md`, feature catalog D11.12, this file | |

Deliberately left out of this round: palette commands for the layout (the header menu and Alt+← cover
them), persisting the open split across launches (the Split Debug View reopens on the next
breakpoint), Broker connection preselection.

## Manual checks

- [ ] **SSW-M1** Open a route from the Endpoints catalog: code and request side by side, header shows `project · GET /path · handler()`.
- [ ] **SSW-M2** Debug Request on that route: the split opens on the breakpoint, header says *paused at breakpoint*.
- [ ] **SSW-M3** DB tab of the paused request → *Open in Database*: Database Studio appears as the third pane, the query is prefilled, the capture proxy's connection is selected; code and request stay visible.
- [ ] **SSW-M4** *Back to response* (and Alt+←): the third pane closes, the request pane has the keyboard on the same tab.
- [ ] **SSW-M5** Alt+Shift+3 with the split open adds Database instead of closing the split; Alt+Shift+1/2 move the keyboard between panes.
- [ ] **SSW-M6** Resize the third pane, restart: its width is kept. Maximize / close it from the split menu.
- [ ] **SSW-M7** Two projects with the same route path: the header never shows the other project's service or run.
- [ ] **SSW-M8** Detach Database Studio into its own window: *Open in Database* goes to that window, the split is untouched.

## Non-goals (for now)

- Arbitrary tiling / drag-to-dock of every module.
- More than three panes.
- Persisting the focus across launches.
- A new event bus: `moduleRouting` stays the only cross-module channel.
