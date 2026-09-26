---
sketch: 001
name: connection-error-response
question: "How should a refused connection become useful without overwhelming the Response panel?"
winner: null
tags: [response, error, diagnostics, recovery]
---

# Sketch 001: Connection Error Response

## Design Question

How should adOmnia explain a refused connection, surface useful diagnostics, and let the user recover without turning the Response panel into a wall of technical text?

## How to View

Open `.planning/sketches/001-connection-error-response/index.html`.

## Variants

- **A: Compact Recovery Card** — minimal centered card with endpoint, one-line cause, retry and expandable raw details.
- **B: Guided Diagnostics** — a troubleshooting-oriented state that checks server, host and port in sequence.
- **C: Hybrid Diagnostic Card** — clear summary and recovery actions first, structured metadata and technical details on demand.

## What to Look For

Compare information density, how quickly the eye finds Retry, whether the endpoint is readable, and whether raw network details remain accessible without dominating the panel.
