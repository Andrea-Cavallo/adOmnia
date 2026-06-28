---
name: adomnia-workspace
description: Use when the user wants an importable .adomnia workspace file for adOmnia — for Kafka, Database, or Flows — or wants to turn a Go/Java/Python codebase into an adOmnia request collection. Generates version-2 workspace JSON the user imports via Workspace → Import.
---

# adomnia-workspace

Generate **importable `.adomnia` workspace files** (version 2) for adOmnia. Four modes:
`kafka`, `database`, `flows`, `from-code`. All shapes, endpoint tables, and ready-to-fill
JSON skeletons live in [reference.md](reference.md) — read it before generating.

## When to use

- "Make me an `.adomnia` for the Kafka lab / for my Postgres DB / a login flow."
- "Read this Go/Java/Python service and build an adOmnia collection from its endpoints."

## How import works (why version 2)

The file is imported via the **Workspace panel → Import**, which calls `applyWorkspaceState`
(`frontend/src/lib/workspaceState.ts`). It restores the arrays `collections`,
`environments` (+ `activeEnvId`), `settings`, and `flows`. Always emit version 2 — it is the
only shape that restores flows. Kafka/DB are **sidecar HTTP requests**, not saved panel
connections (the importer does not restore those); this matches `workspaces/adomnia-full-lab.adomnia`.

## Steps

1. **Pick the mode** from the user's request (`kafka | database | flows | from-code`). If
   unclear, ask which one.
2. **Gather inputs:**
   - `kafka`: broker(s), topic (default to the lab: `localhost:19092` / `adomnia.lab.events`).
   - `database`: driver (postgres/mysql/sqlite/...), host, port, db name, user.
   - `flows`: the scenario in plain words (what calls, what to extract, what to branch on).
   - `from-code`: the path to the repo / directory / file to scan.
3. **Build the file** from the matching skeleton in [reference.md](reference.md):
   - Start from the **Output envelope**, fill `environments` with `{{var}}`-friendly values.
   - `kafka` → the **Kafka** skeleton (4 sidecar requests).
   - `database` → the **Database** skeleton (`/database/test`, `/database/query`).
   - `flows` → the **Flows** skeleton; add nodes/edges per the scenario.
   - `from-code` → see below.
4. **Validate (required gate before delivering):** `JSON.parse` the file and assert
   `collections` / `environments` / `flows` are arrays (run the check below). Fix anything
   that fails. Only then write the `.adomnia` file.
5. **Hand off:** tell the user to import via **Workspace → Import**, and to update
   `sidecarBase` with the runtime sidecar port the app shows (for kafka/database modes).

## from-code mode

Claude is the parser — read the source with Grep/Read, never execute it.

1. Detect routes using the **from-code patterns** table in [reference.md](reference.md)
   (Go net/http + gin/echo/chi/fiber; Java Spring + JAX-RS; Python Flask/FastAPI/Django).
2. For each route emit a request: `method`, `url` = `{{baseUrl}}/path` (path params like
   `:id` / `{id}` / `<id>` → `{{id}}`), base `Content-Type` header.
3. For POST/PUT/PATCH, infer a JSON body from the request model (struct json tags / DTO
   fields / Pydantic model) per the **Body inference** rules; GET/DELETE get a `none` body.
4. Group requests into folders by controller / file / router. Combine class-level base
   paths with method-level sub-paths.
5. Put it all in one `collections[]` entry inside the version-2 envelope, with a `baseUrl`
   environment variable.

## Validation check

```bash
node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
for(const k of ["collections","environments"]) if(!Array.isArray(o[k])) throw new Error(k+" not array");
if("flows" in o && !Array.isArray(o.flows)) throw new Error("flows not array");
console.log("OK", (o.collections[0]||{}).name || "(no collection)");' <path-to-generated.adomnia>
```

Expected: `OK <collection name>`, no throw.
