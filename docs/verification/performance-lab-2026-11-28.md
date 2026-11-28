# Performance lab UI — 2026-11-28

The Composer load-test panel and Flow Builder stress dock now share a visual direction: a workload column, a separate report area, theme tokens, sans-serif labels and monospaced measurements. Narrow containers stack the workload above the report.

## Changes

- HTTP workload selection: virtual users, arrival rate, parallel burst and paced requests.
- Optional HTTP SLO gates go to `Scenario.gates` on the existing Go engine. p95/RPS zero disables those gates; error zero means no tolerated errors.
- Live HTTP throughput chart is bounded to the latest 600 progress buckets; chart sizing follows the container and display scale.
- Shared request inspector: filter step/status/error, errors-only toggle, slowest-first ordering, 50-row pages, per-request details and aggregate histogram.
- Flow results expose Overview and Request inspector views. Raw samples are available after completion; live aggregates remain visible while running.
- Saved HTTP scenarios retain their mode, rate, pool size, burst/gap settings and SLO settings. Older saved Load configurations remain readable.
- Comparison colours treat increased throughput as an improvement. CSV export quotes URLs containing commas, quotes or newlines.

## Verification

- TypeScript, focused lint and production frontend build passed.
- Six focused Vitest files: 28 tests passed, including scenario restoration and CSV quoting regressions.
- Chrome headless rendered the actual HTTP and flow components from Vite, with no page errors on the HTTP preview. Workload selection and SLO checkbox worked. At 620 px the HTTP view had no document overflow.
- Chrome interaction checks on explicitly synthetic inspector data passed: pagination, errors-only filter, text search, latency ordering, sample detail and histogram.
- Screenshots in `artifacts/stress-test-desktop.png`, `stress-test-narrow.png`, `flow-stress-desktop.png`, `stress-inspector-samples.png` (the last contains labelled synthetic samples).
- Native Wails acceptance and a real backend load run were not performed. Browser fixtures do not establish native event delivery or engine gate behaviour.

## JMeter reference and scope

Reference: https://jmeter.apache.org/usermanual/test_plan.html — workload groups, timers, assertions and listeners inform the configuration/report separation. This change does not establish full JMeter parity, JMX import, distributed generators or support for all JMeter samplers/plugins. Existing flow CSV datasets, assertions, stages, APDEX, baseline/history and CI exports remain available.

Unrelated backend load-test/storage work appeared during implementation and was left untouched.
