# Request Advisor example plugin

Install this complete folder from **Plugins → Install Plugin → Folder**, then enable it.

- The `onRequest` hook adds `X-Adomnia-Plugin` to outgoing HTTP requests and normalizes bare local URLs to `http://`.
- The **Inspect plugin** panel action returns the plugin ID and current setting, writes a log entry, and shows a success notification.
- Functions receive the call arguments as their first parameter and the permission-aware `adomnia` API as their second parameter; the same API is also available globally.

Executable JavaScript entrypoints may export functions with ESM syntax (`export function`) or CommonJS (`module.exports`). Hook functions return `{ modified: true, data: payload }` when they transform an event payload.

Privileged host APIs require the matching manifest permission: `http`, `storage`, `notifications`, or `env`. `adomnia.log` is always available. Each invocation has a configurable timeout and an input/output memory budget.
