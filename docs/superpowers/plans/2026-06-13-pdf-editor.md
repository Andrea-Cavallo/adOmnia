# PDF Editor Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a PDF Editor panel to adOmnia that views PDFs and overlays re-editable text, annotations, form values, and a visible signature, exporting a flattened PDF.

**Architecture:** All-frontend. `pdfjs-dist` renders pages to canvas; an absolutely-positioned overlay holds editable elements stored in PDF points; `pdf-lib` draws/fills/flattens on export. Projects persist via the existing generic `Storage*` (bbolt) bindings (bucket `pdfprojects`), bytes base64-encoded. File open via drag-drop + hidden file input; export via Blob download.

**Tech Stack:** React 18 + TS + Vite, Zustand-adjacent local state, pdfjs-dist 4.10, pdf-lib 1.17, existing Wails `Storage*` bindings.

---

## File structure

```
frontend/src/lib/pdf/annotationModel.ts   # types, coordinate conversion, factories
frontend/src/lib/pdf/pdfDocument.ts        # pdf.js: load, render page, read form widgets
frontend/src/lib/pdf/pdfExport.ts          # pdf-lib: apply annotations + form, flatten
frontend/src/lib/pdf/pdfProjects.ts        # persistence over Storage* bindings (base64)
frontend/src/lib/pdf/annotationModel.test.ts
frontend/src/lib/pdf/pdfExport.test.ts
frontend/src/components/pdfeditor/PdfEditorPanel.tsx
frontend/src/components/pdfeditor/PdfToolbar.tsx
frontend/src/components/pdfeditor/PdfPageView.tsx
frontend/src/components/pdfeditor/AnnotationLayer.tsx
frontend/src/components/pdfeditor/FormFieldLayer.tsx
frontend/src/components/pdfeditor/SignatureModal.tsx
frontend/src/components/pdfeditor/PdfProjectList.tsx
```

Wiring touch-points: `stores/app.ts` (RailItem + import kind), `components/layout/MainArea.tsx` (lazy panel), `components/layout/Rail.tsx` (icon), `lib/i18n.ts` (label), `lib/commandPalette.ts` (entry), `lib/globalFileRouter.ts` + `hooks/useFileDrop.ts` (.pdf routing), `lib/storageSchemas.ts` (`pdfprojects` schema), `components/response/ResponsePanel.tsx` (Open-in-PDF button).

## Tasks (executed inline this session)

1. Add libs (done), `pdfprojects` storage schema, `pdf` import kind to RoutedToolFile + router + useFileDrop.
2. `annotationModel.ts` — types + `pointToScreen`/`screenToPoint`, factories, `normalizeRect`. + unit test.
3. `pdfDocument.ts` — worker setup, `loadPdfDocument(bytes)`, `renderPdfPage(doc,page,scale)`, `readFormWidgets(page)`.
4. `pdfExport.ts` — `exportPdf(bytes, annotations, formValues)` → Uint8Array. + unit test.
5. `pdfProjects.ts` — `listProjects/saveProject/loadProject/deleteProject` over `Storage*`.
6. Element rendering + interaction in `AnnotationLayer.tsx`; `FormFieldLayer.tsx`; `SignatureModal.tsx`.
7. `PdfPageView.tsx` lazy page render + overlays.
8. `PdfToolbar.tsx`, `PdfProjectList.tsx`, `PdfEditorPanel.tsx` orchestrator.
9. App wiring: app store, MainArea, Rail, i18n, commandPalette, ResponsePanel button.
10. `npm run build` + `npm test` green.

Validation: `cd frontend && npm run build` (tsc + vite) and `npm test` (vitest) must pass; manual `wails dev` smoke for the full open→annotate→export→reopen loop.
