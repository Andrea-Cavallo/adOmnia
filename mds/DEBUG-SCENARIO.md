# One-Click Debug Scenario

Debug Request turned into a replayable scenario. Entry point: **Scenarios** next to **Debug** in the
request actions menu.

## What a scenario holds

| Part | Source | Used at run time |
|---|---|---|
| Request | snapshot of the tab (method, URL, headers, body, auth, scripts, **assertions**) | sent as saved, not as the tab is today |
| Environment | active environment when saved | switched to before sending |
| Test data | variables edited in the dialog | layered over the environment, never written back |
| Breakpoints | enabled Code Studio breakpoints of the service's project (conditions, hit counts, logpoints kept) | set again with `putBreakpoint` once the debugger runs |
| Check queries | Database Studio connection + SQL | run after the call, read-only (`confirm: false`), rows digested |

## Run

`runDebugScenario` (`frontend/src/lib/devsession/debugScenarioRun.ts`): open tab → environment →
`prepareDebugRequest` (start/reuse the service under the debugger, wait for the port) → breakpoints →
`prepareLiveSend`/`executeRequest`/`finishLiveSend` (the run is correlated like any Debug Request, so it
stops at the breakpoints) → evidence → `recordRun` keeps the last two runs.

## Evidence and differences

`frontend/src/lib/devsession/debugScenario.ts` (pure, tested in `debugScenario.test.ts`):
status, duration, error, JSON body **shape** (values left out: ids and timestamps change), assertion and
script-test results, breakpoint stops, SQL with literals replaced by `?`, Kafka topics, error log lines,
check-query rows. `diffEvidence` reports status/error changes, slowdowns (> +50 % and ≥ 200 ms),
body fields added/gone, assertions flipping, code path, SQL and topic changes, more error logs, changed data.
The list colours each scenario: grey not run, green same as before, amber differences, red failing assertions.

## Storage

`localStorage` key `adomnia.debugScenarios` (`frontend/src/stores/debugScenarios.ts`).

## Not done yet

- Scenarios are not in the `.adomnia` workspace export: add them there when they must travel with a team.
- No setup/seed queries before the call (only read-only checks after it): add with an explicit confirm
  when a real case needs destructive setup.
- Breakpoints are captured at save time; to change them, set them in Code Studio and save again.

## Manual checks

- [ ] DS-M1 Go service with a breakpoint in a handler: Debug once, *Scenarios → Save this request*;
      the scenario shows the breakpoint and that run as last run.
- [ ] DS-M2 Stop the service, remove the breakpoint in Code Studio, *Run scenario*: the service starts
      under Delve, the breakpoint is back, the request stops there, Continue completes it.
- [ ] DS-M3 Add a test-data variable used in the URL and a check query: second run lists the differences
      (e.g. status, data changed) and the dot turns amber; an identical run shows "Same as the previous run".
