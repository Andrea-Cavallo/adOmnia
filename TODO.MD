# adOmnia Technical Remediation TODO

Rebuilt on 2026-06-01 after the v0.1.3 remediation pass and the merge that landed
AI Engine, Git Sync, MCP Client, and AI Mock Generation onto `master`.

Priority is product-first: protect the four pillars (local-first, extensible,
browser-integrated, enterprise/legacy), close visible UX gaps, then code health.

> Verified-and-already-fixed before this review (do **not** re-open): proxy
> breakpoints now pause traffic (`internal/proxy/proxy.go`), OAuth2 supports
> `password`/`refresh_token`/`PKCE` grants with token caching
> (`frontend/src/lib/sendRequest.ts`), and there are no stray `console.log`
> debug statements.

---

## DONE — 2026-06-01 session

- [x] **AI provider API keys no longer stored in plaintext.**
  - The key is encrypted into the Vault (`/vault/encrypt`) and stored only as a
    `vault:<ciphertext>` reference in settings; it is resolved to plaintext
    in-memory at call time via `resolveSecret`.
  - Files: `frontend/src/lib/vaultRefs.ts` (new `encryptToVaultRef`,
    `resolveSecret`), `frontend/src/components/settings/AISettings.tsx`.
  - Also fixed a latent bug: the config was sent with `api_key`/`base_url`
    while the Go struct expects `apiKey`/`baseURL`, so the key never reached
    the backend. Now camelCase, matching `internal/ai/engine.go`.

- [x] **Tests for the newly merged backends.**
  - `internal/ai/engine_test.go`, `internal/mcp/client_test.go` (incl. a real
    JSON-RPC round-trip via httptest), `internal/git/git_test.go`,
    `internal/mock/ai_generate_test.go`. All green.

- [x] **Error surfacing in Git backend.**
  - `internal/git/git.go`: `GetStatus` now errors on a non-git / empty path
    instead of returning an empty-but-valid-looking status; remote add/set-url
    failures in `Init` are surfaced instead of swallowed.

- [x] **Replaced the remaining native `window.confirm` dialogs.**
  - New app-native, promise-based dialog: `frontend/src/lib/confirmDialog.ts`
    + `frontend/src/components/ui/ConfirmDialogHost.tsx` (mounted in `App.tsx`).
  - Migrated `DatabasePanel` (dangerous query), `RequestHistoryPanel` (clear
    history), `KafkaPanel` (delete topic).
  - Fixed a rendering bug in `ui/confirm-dialog.tsx` (it drew the action button
    three times).

- [x] **N03 — Win95 theme JSON bracket-depth colors restored.**
  - `internal/themes/extended.go`: bracket depths 1/2/3 were all `#000000`; now
    distinct dark, high-contrast colors.

- [x] **Documentation drift in `CLAUDE.md` corrected.**
  - Removed references to non-existent `docs/TODO.md`, `docs/AUDIT.md`,
    `docs/adomnia-roadmap-checkbox.md`, `docs/REFACTORING.md`,
    `docs/CHANGELOG.md`, `docs/SECURITY.md`, `docs/TAILWIND.md`. Pointed the
    docs index at the real files (`ISSUES.md`, `ROADMAP.md`, `RELEASE.md`,
    `.github/SECURITY.md`, etc.).

---

## DONE — 2026-06-01 session (follow-up pass)

- [x] **AI engine auto-configures from current settings.** New shared
  `frontend/src/lib/aiEngine.ts` (`buildAIConfig`/`ensureAIConfigured`);
  `AiMockDialog` calls `ensureAIConfigured()` before generating, so AI works
  after a restart without re-saving (a locked Vault surfaces a clear error).
- [x] **Inline error states verified in MCP / Git / AI panels.** `McpPanel`,
  `GitSyncPanel`, and `AISettings` already render `setError(String(e))` /
  test-result errors inline — no silent empty state.
- [x] **P2-11 (partial) - keyboard shortcuts aligned with reality.** Added
  `Cmd/Ctrl+L` (focus URL), `Cmd/Ctrl+W` (close tab), `Cmd/Ctrl+Shift+]`/`[`
  (next/prev tab) to `useKeyboardShortcuts`; the Settings list now also
  documents the Command Palette and Duplicate Tab shortcuts that were
  previously missing or wrong (`SettingsPanel.tsx`, `i18n.ts`).
- [x] **P3-08 (advanced) - Vault references are first-class in the env editor.**
  `EnvModal` now detects `vault:` values, shows a shield indicator, and masks
  them. Combined with VaultPanel "copy as vault: reference", a secret flows
  Vault -> environment -> request end-to-end.

---

## OPEN — still to do

### P2 - Product UX (larger efforts)
- [ ] **P2-11 (remaining) - broaden shortcut coverage.** Per-rail navigation
  (`Cmd+2..9`), search focus, and a fuller catalog beyond the current set.
- [ ] **P2-09 - GraphQL schema and query variables are not persisted.** Cache
  the introspection result and persist variables across tab close/reopen.

### P3 - Code health (lowest priority per product-first philosophy)
- [ ] **Split oversized components (>800-line guideline).**
  `utils/UtilsPanel.tsx` (2326), `settings/SettingsPanel.tsx` (1223),
  `kafka/BrokerStudioPanel.tsx` (1066), `mock/MockPanel.tsx` (1050),
  `websocket/WebSocketPanel.tsx` (984), `kafka/KafkaPanel.tsx` (976),
  `har/HarViewerPanel.tsx` (954), `response/ResponsePanel.tsx` (944),
  `proxy/ProxyPanel.tsx` (938). Extract sections/helpers without changing UX.
- [ ] **Tighten `any` usage at boundaries.** ~58 `: any` / `as any` in
  `frontend/src`; replace with explicit types or schema-validated parsing,
  prioritizing API/IPC boundaries.
