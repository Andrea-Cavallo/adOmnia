# PDF Editor — Design Spec

**Date:** 2026-06-13
**Status:** Approved (design), pending implementation plan
**Area:** `frontend/src/components/pdfeditor`, `frontend/src/lib/pdf`, `pdfeditor.go`

---

## 1. Goal

Add a **PDF Editor** panel to adOmnia that lets users **view and edit PDFs** like an
online PDF editor: place free text, draw annotations, fill existing form fields, and
apply a visible signature. Work is **re-editable** (annotations live as a separate
layer that can be reopened) with a **"Export final PDF"** action that flattens everything
into a new `.pdf`.

### In scope

- **A) Free text** — click anywhere to place positionable text boxes.
- **B) Annotations** — highlight, underline, shapes (rect / ellipse / line / arrow),
  freehand ink drawing.
- **C) Form filling** — fill existing AcroForm fields.
- **D) Signature (visible)** — drawn or uploaded image, embedded into the PDF.

### Out of scope (YAGNI)

- Page manipulation (rotate / delete / reorder / merge / split).
- Cryptographic / eIDAS digital signing (adOmnia already has separate `certtools`;
  may be added later).
- Editing pre-existing text content of the source PDF (we overlay, we do not reflow).
- Encrypted / password-protected PDFs (show a clear error for v1).

---

## 2. Approach

**Chosen: all-frontend rendering + editing, with Go/bbolt persistence for heavy bytes.**

| Concern | Tool |
|---------|------|
| Render pages to canvas | `pdfjs-dist` (+ web worker) |
| Interactive form widgets | pdf.js annotation layer |
| Write / fill / flatten / export | `pdf-lib` |
| Unicode font embedding on export | `@pdf-lib/fontkit` (loaded only at export) |
| Project persistence (PDF bytes + layer) | Go `pdfeditor.go` → bbolt |
| File open / save dialogs | existing Wails file-dialog bindings |

Rejected alternatives: Go-side rendering/export (weak text/annotation writing, unidoc
commercial licensing, heavier IPC); embedded commercial PDF SDK (license cost, external
framework, against repo conventions). Both conflict with the local-first / no-cost pillars.

All libraries are lazy-loaded with the panel, keeping them out of the initial bundle.

---

## 3. File structure

Many small, focused files.

```
frontend/src/components/pdfeditor/
  PdfEditorPanel.tsx      # orchestrator: state, toolbar, page list, viewport
  PdfToolbar.tsx          # tool select, zoom, page nav, Save / Export
  PdfPageView.tsx         # one page: pdf.js canvas + editing overlay (lazy via IntersectionObserver)
  AnnotationLayer.tsx     # renders + drag/resize of elements on a page
  elements/
    TextBoxEl.tsx
    HighlightEl.tsx
    ShapeEl.tsx
    InkEl.tsx
    SignatureEl.tsx
  SignatureModal.tsx      # draw or upload a signature image
  PdfProjectList.tsx      # saved projects (reopen / delete)

frontend/src/lib/pdf/
  pdfDocument.ts          # load bytes -> pdf.js doc, page count, render a page
  annotationModel.ts      # annotation types + screen<->PDF-point coordinate conversion
  pdfExport.ts            # pdf-lib: apply annotations + form values, flatten, return bytes
  pdfFormBridge.ts        # read/write AcroForm field values

frontend/src/lib/pdf-api.ts  # wrapper over Go bindings (project persistence)

pdfeditor.go               # bbolt-backed project store (bytes + annotation JSON)
```

---

## 4. Data model

```ts
type PdfAnnotation =
  | { id: string; page: number; type: 'text';      x: number; y: number; w: number; h: number; text: string; fontSize: number; color: string; align: 'left'|'center'|'right' }
  | { id: string; page: number; type: 'highlight'; x: number; y: number; w: number; h: number; color: string; opacity: number }
  | { id: string; page: number; type: 'rect'|'ellipse'|'line'|'arrow'; x: number; y: number; w: number; h: number; color: string; strokeWidth: number }
  | { id: string; page: number; type: 'ink';       paths: number[][]; color: string; width: number }
  | { id: string; page: number; type: 'signature'; x: number; y: number; w: number; h: number; imageDataUrl: string }

interface PdfProject {
  id: string
  name: string
  pageCount: number
  annotations: PdfAnnotation[]
  formValues: Record<string, string | boolean>
  updatedAt: number
}
```

- Coordinates stored in **PDF points** with a **top-left origin** in the editor.
- `annotationModel.ts` converts to pdf-lib's **bottom-left origin** at export, so the
  result is exact regardless of on-screen zoom.
- State managed with a Zustand store (immutable updates), consistent with existing stores.

---

## 5. Persistence (local-first)

PDFs are commonly several MB; `localStorage` caps at ~5–10 MB (a known pain point).
Therefore projects are persisted via a small **Go module `pdfeditor.go` backed by bbolt**,
mirroring the existing `flows` pattern.

- bbolt bucket stores **original PDF bytes + annotation/form JSON** per project.
- `lib/pdf-api.ts` exposes `saveProject`, `listProjects`, `loadProject`, `deleteProject`.
- Opening from disk and **Export final PDF** use the existing Wails file-dialog bindings.
- The annotation layer JSON is small; the original bytes are the heavy part and stay in bbolt.

Runtime render output (canvases) is session-only and never persisted.

---

## 6. Forms and signature

- **Forms (C):** pdf.js renders interactive widgets via its annotation layer; values are
  captured into `formValues` keyed by field name. On export, pdf-lib sets the field values
  and calls `form.flatten()` so they bake into the output.
- **Signature (D):** v1 is a **visible** signature — drawn on a canvas in `SignatureModal`
  or uploaded as PNG — embedded as an image annotation via pdf-lib. Cryptographic signing
  is out of scope for v1.

---

## 7. App integration

- Add `'pdfeditor'` to the `RailItem` union in `stores/app.ts`.
- Lazy import + `panelFor` case in `components/layout/MainArea.tsx`.
- Rail icon (`FileText`) under the Power Tools category in `components/layout/Rail.tsx`.
- i18n labels in `lib/i18n.ts`; command palette entry in `lib/commandPalette.ts`.
- **Drag-drop:** extend `globalFileRouter` to recognize `.pdf` (kind `'pdf'`) and route to
  the PDF Editor, wired through `useFileDrop` / `DropOverlay`.
- **From API response (B):** in `ResponsePanel`, when the response content-type is
  `application/pdf`, show an **"Open in PDF Editor"** button that hands the bytes to the
  panel using the existing `consumeFileImport` channel pattern.

---

## 8. Export pipeline (pdf-lib)

1. Load original bytes into a `PDFDocument`.
2. For each annotation: convert coordinates and draw text / shapes / ink / signature image.
3. Fill AcroForm fields from `formValues`, then `form.flatten()`.
4. `doc.save()` → `Uint8Array` → write via the Wails save dialog.

---

## 9. Error handling

- Validate the input is a real PDF before loading; show a user-facing error otherwise.
- Detect encrypted / password-protected PDFs and report clearly (unsupported in v1).
- Wrap export in try/catch; surface failures with a toast, never silently swallow.
- Validate coordinates and field names at the export boundary.

---

## 10. Testing (product-first)

- Unit tests (vitest) for coordinate conversion in `annotationModel.ts` and for
  `pdfExport.ts` (assert the produced PDF bytes contain the expected text / annotations).
- Manual end-to-end test in `wails dev`: open a PDF (disk + API response), add text /
  highlight / shape / ink, fill a form, place a signature, export, reopen the saved project.
- Verify visual cohesion with adjacent panels (tokens, spacing, control sizes).

---

## 11. Performance notes

- pdf.js + pdf-lib are heavy; they load only with the lazy panel and `fontkit` only at export.
- Pages render lazily as they scroll into view (IntersectionObserver), not all at once.
- pdf.js runs its worker off the main thread.
- Animate only compositor-friendly properties for any overlay transitions.

---

## 11b. Implementation notes / deviations from the original design

These choices were made during implementation and supersede the design where they differ:

- **Persistence:** instead of a new `pdfeditor.go` bbolt module, the feature reuses
  the existing generic `Storage*` bindings (bbolt) with a new `pdfprojects` bucket.
  The only Go change is registering that bucket in `internal/storage/storage.go`'s
  whitelist (buckets are whitelisted; an unlisted bucket is rejected). Each project
  is one item keyed by id, with the PDF bytes base64-encoded inside the JSON.
- **Save size limit:** the storage layer caps a single value at 10 MB. A base64 PDF
  larger than that fails to save with a surfaced error; export is unaffected (it does
  not go through storage). Raising this is a post-v1 follow-up.
- **File open:** drag-drop (`.pdf` via `globalFileRouter`) plus a hidden `<input
  type="file">` in the panel — no native Go open dialog.
- **Export:** the flattened PDF is delivered via a Blob download (`<a download>`),
  not a native Wails save dialog. A native save dialog is a post-v1 polish item.
- **Open from API response:** best-effort — the response body is a string over the
  Go transport, reconstructed to bytes via latin1 mapping. Reliable for the disk and
  drag-drop paths; binary responses may need a backend base64 path later.
- **Fonts:** export uses StandardFonts.Helvetica (WinAnsi); non-WinAnsi characters are
  replaced with `?`. Full Unicode via fontkit is a post-v1 follow-up.

## 12. Open follow-ups (post-v1)

- Cryptographic / eIDAS signing tied into existing `certtools`.
- Page manipulation (rotate / reorder / merge / split).
- Text search and copy from the rendered layer.
