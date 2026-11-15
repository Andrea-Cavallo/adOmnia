# Visual Editor integration

This directory adapts the vendored Onlook editor, JSX parser and in-page preload modules to adOmnia's Code Studio sessions and Live Preview. The included source license is [vendor/LICENSE.md](vendor/LICENSE.md). Local adapters replace the original workspace, branch, transport and UI integrations; telemetry is disabled by the host adapter.

The engine and panel load only when Design Mode is enabled. Module aliases are shared through `aliases.ts` and mirrored in the frontend TypeScript paths. The in-page preload is built separately with `npm run build:design-bridge` into `internal/ide/preview/design.js`; keep that generated script with changes to its sources.

See [the Design Mode guide](../../../../docs/DESIGN-MODE.md) for usage, build steps and validation limits.
