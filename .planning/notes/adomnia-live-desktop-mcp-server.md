---
title: adOmnia as a live desktop MCP server
date: 2026-09-26
context: Architecture exploration for controlling the running adOmnia desktop app from Claude and other MCP clients
status: accepted-direction
---

# adOmnia as a live desktop MCP server

## Decision

adOmnia will act as both an MCP client and an MCP server. The server side will control only a running desktop instance. A standalone or headless adOmnia engine is explicitly out of scope.

Claude Code, Claude Desktop, Codex, and other MCP clients should be able to inspect the current workspace, propose changes, execute approved API operations, and bring affected artifacts into view inside adOmnia.

## Product intent

The differentiating experience is not merely exporting an API collection as a generated MCP server. It is allowing an AI agent to collaborate with the live API workbench the user is already viewing.

Example:

> Open the login request, add an `X-Correlation-ID` header, run it, and explain why the response is 401.

The resulting request, diff, response, and explanation should remain visible and reproducible inside adOmnia.

## Existing foundation

adOmnia already contains:

- an MCP client with stdio and HTTP transports in `internal/mcp`;
- Wails bindings for MCP client sessions in `mcp_bindings.go`;
- a collection-to-MCP-server generator;
- OpenAPI parsing and validation;
- executable API flows with extraction and dependency mapping;
- a local AI gateway and multiple local/cloud model providers;
- a local Vault whose secret values must remain private.

The missing capability is a first-party MCP server backed by the running application state.

## Proposed architecture

```text
Claude Code ---- local Streamable HTTP ----+
                                            |
Claude Desktop -- MCPB/stdio bridge --------+--> running adOmnia desktop app
                                            |          |
Other MCP clients --------------------------+          v
                                               application command layer
                                                        |
                                      collections / requests / flows / OpenAPI
                                                        |
                                               Wails events -> React UI
```

### Components

1. `internal/mcpserver`
   - Implements MCP discovery, tools, resources, prompts, and change notifications.
   - Supports the current MCP protocol plus the legacy initialization flow needed by older clients.

2. Application command layer
   - Provides typed operations shared by Wails bindings and the MCP server.
   - Prevents MCP handlers from manipulating React state or persistence directly.
   - Returns revision identifiers and structured diffs for mutations.

3. Embedded local transport
   - Starts and stops with the desktop application.
   - Binds only to `127.0.0.1` on a configurable or discoverable port.
   - Requires a per-installation or per-session credential.
   - Validates `Origin` and `Host` to protect against DNS rebinding and browser-origin attacks.

4. Claude Desktop bridge
   - Distributed as an MCPB/local extension or small stdio bridge.
   - Discovers the running adOmnia instance and forwards MCP messages.
   - Returns a clear `adOmnia is not running` error rather than starting a headless engine.

5. Agent activity UI
   - Shows connected clients, tool calls, proposed changes, approvals, execution results, and failures.
   - Lets the user revoke a connection or disable the server immediately.

## Capability model

### Tools

Initial read-only tools:

- `adomnia_list_collections`
- `adomnia_search_requests`
- `adomnia_get_request`
- `adomnia_get_openapi`
- `adomnia_list_flows`
- `adomnia_get_response_history`

Draft tools:

- `adomnia_create_request_draft`
- `adomnia_update_request_draft`
- `adomnia_import_openapi_draft`
- `adomnia_create_flow_draft`

Controlled execution tools:

- `adomnia_send_request`
- `adomnia_run_flow`
- `adomnia_validate_openapi`
- `adomnia_open_in_ui`

### Resources

Expose collections, request definitions, OpenAPI documents, flow definitions, and redacted response history through stable `adomnia://` resource URIs. Resource subscriptions and change notifications should keep clients synchronized with the live workbench.

### Prompts

Provide user-selected workflow templates such as diagnosing a failed request, deriving a test flow, improving an OpenAPI contract, and documenting an endpoint.

## Permissions and safety

- Enforce server-side permission levels: `read`, `draft`, and `execute`.
- Treat MCP tool annotations as descriptive hints, never as authorization.
- Default mutations to a visible preview/diff before application.
- Require explicit policy for network execution and destructive changes.
- Never expose Vault values, environment-resolved credentials, authorization headers, or raw secret-bearing history through MCP.
- Resolve Vault references only inside adOmnia at execution time.
- Redact tool results and audit events using the same secret-handling rules as the existing AI features.
- Allow the user to disable MCP globally or revoke individual clients.

## State and synchronization

The largest architectural constraint is that important workspace state currently lives partly in frontend storage. MCP must not mutate `localStorage` indirectly.

The first implementation should introduce a narrow typed command boundary and a synchronized backend projection for MCP-visible state. Wails events notify the React frontend after accepted commands. Every mutation carries a base revision so stale agent proposals can be rejected rather than overwriting newer user changes.

This does not require implementing a headless persistence engine, but the command layer should remain independent of MCP transport and React components.

## MVP boundary

The MVP is complete when:

1. adOmnia can enable a localhost-only MCP server from Settings.
2. Claude Code can connect to the running app and inspect collections and requests.
3. Claude Desktop can connect through a packaged local bridge.
4. An agent can create or modify a request as a draft and adOmnia displays the diff.
5. The user can approve the draft and see the UI update without reloading.
6. An approved tool can send a request and return a redacted structured response.
7. Agent activity and permission decisions are visible and auditable.
8. Closing adOmnia makes the integration unavailable; no hidden headless engine remains running.

## Non-goals

- Running adOmnia as a standalone headless workspace engine.
- Allowing remote Internet access to the embedded MCP endpoint.
- Returning raw Vault secrets to an MCP client.
- Letting agents silently execute every mutation or network request.
- Replacing the existing MCP client or collection server generator.

## Implementation risks

- Synchronizing backend commands with frontend-owned state without introducing two sources of truth.
- Maintaining compatibility across MCP protocol generations and clients.
- Packaging and updating the Claude Desktop bridge on every supported OS.
- Preventing prompt/tool output from leaking tokens already present in request history.
- Avoiding UI races when the user and an agent edit the same request.

## Official references

- MCP transports: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
- MCP versioning: https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
- MCP tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- MCP resources: https://modelcontextprotocol.io/specification/2026-07-28/server/resources
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Desktop local MCP servers: https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- Claude remote connectors: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
