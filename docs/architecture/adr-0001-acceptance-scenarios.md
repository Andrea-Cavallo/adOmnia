# ADR 0001 — Acceptance scenarios as one JSON file per scenario

**Status:** accepted (2026-11-01) · **Context:** AGENTIC-IDE AGI-05

## Decision

Acceptance scenarios live in the project under `.adomnia/acceptance/<id>.json`, one file per scenario, written by `internal/ide/acceptance`:

```json
{
  "format": "adomnia-acceptance",
  "version": 1,
  "id": "orders-404",
  "title": "Unknown order",
  "status": "active",
  "description": "…",
  "routes": ["GET /orders/{id}"],
  "files": ["internal/orders/handler.go"],
  "criteria": [
    { "id": "c1", "text": "Unknown ids return 404",
      "check": { "kind": "request", "method": "GET", "url": "http://localhost:8080/orders/x", "expectedStatus": 404 } }
  ]
}
```

- `id` is stable and is the file name; `status` is `draft`, `active` or `retired`.
- A criterion's optional `check` has the fields of an Agent Task verification (`test` or `request`), so a scenario run from a task produces the same evidence as AGI-02.
- `routes` and `files` are explicit user links. Links proposed by analysis (Developer Context entities) are not stored in the file.
- The last run is not stored: it is the latest evidence of the task verifications linked to the scenario (`scenarioId`, `criterionId`).

## Why JSON and not Markdown with front matter

- Every other shared adOmnia file (`run-configurations.json`, `ai-policy.json`, workspaces) is JSON: one parser, one migration path (`format` + `version`, migrate in the loader).
- Checks are structured data (method, URL, headers, expected status). In front matter they would be YAML inside Markdown, a second syntax to validate.
- Pretty-printed JSON with a stable key order diffs well in Git; one file per scenario keeps merge conflicts local.

The cost is a less pleasant prose editor: descriptions and criterion texts are strings. If long-form specs become common, a `description` pointing to a Markdown file next to the JSON can be added without changing the format.

## Consequences

- A broken file is reported and skipped; the other scenarios stay usable.
- Unknown future versions are read with the current schema; the loader migrates when a version 2 exists.
