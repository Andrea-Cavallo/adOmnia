# P1 — Hide Plugins & Daily Scenarios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Remove Plugins and Daily Scenarios from the visible rail by default, without deleting any code, and add toggles in Settings to re-enable them.

**Architecture:** Add a `features` block to `AppSettings` with two boolean flags defaulting to `false`. `Rail.tsx` filters items based on the flags. A new "Features" section in Settings exposes the toggles.

**Tech Stack:** TypeScript, React, Zustand (`useSettingsStore`), existing `Toggle` component from `SettingsFields.tsx`.

---

## Feature Checklist

- [x] **Plugins hidden from rail by default**
  - **AC:** `pluginsEnabled: false` in default settings; Plugins rail item not rendered on fresh launch
- [x] **Daily Scenarios hidden from rail by default**
  - **AC:** `dailyScenariosEnabled: false` in default settings; Scenarios rail item not rendered on fresh launch
- [x] **Both re-enabling via Settings → Features toggles**
  - **AC:** Toggling on causes item to appear in rail without app restart; toggling off hides it again
- [x] **Persistence across restarts**
  - **AC:** Feature flag state survives app close/reopen

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/stores/settings.ts` | Add `features` block to `AppSettings` interface and `defaultSettings`; add `updateFeatures` action; add migration in `load()` |
| `frontend/src/components/layout/Rail.tsx` | Read `settings.features` from `useSettingsStore`; filter `plugins` and `scenarios` items |
| `frontend/src/components/settings/SettingsPanel.tsx` | Add `'features'` to `SectionId` union; add nav item; add `FeaturesSection` render branch |

---

### Task 1: Extend AppSettings with features block

**Files:**
- Modify: `frontend/src/stores/settings.ts`

- [x] **Step 1: Add `features` to the `AppSettings` interface**

  Open `frontend/src/stores/settings.ts`. After the `ai` block (line ~83), add:

  ```ts
  features: {
    pluginsEnabled: boolean
    dailyScenariosEnabled: boolean
  }
  ```

  **DoD:**
  - [x] Interface compiles — `npm run build` exits 0
  - [x] `AppSettings` now has a `features` property with the two boolean fields

- [x] **Step 2: Add defaults to `defaultSettings`**

  In `defaultSettings` (line ~97), after the `ai` block, add:

  ```ts
  features: {
    pluginsEnabled: false,
    dailyScenariosEnabled: false,
  },
  ```

  **DoD:**
  - [x] `defaultSettings.features.pluginsEnabled` is `false`
  - [x] `defaultSettings.features.dailyScenariosEnabled` is `false`
  - [x] Build passes

- [x] **Step 3: Add `updateFeatures` to `SettingsState` interface and store**

  In the `SettingsState` interface (line ~177), add:

  ```ts
  updateFeatures: (patch: Partial<AppSettings['features']>) => void
  ```

  In the `create<SettingsState>` call, after `updateAi`, add:

  ```ts
  updateFeatures: (patch) => {
    set((s) => ({
      settings: { ...s.settings, features: { ...s.settings.features, ...patch } },
    }))
    get().save()
  },
  ```

  **DoD:**
  - [x] `updateFeatures` is present in the `SettingsState` interface
  - [x] Calling `updateFeatures({ pluginsEnabled: true })` updates the store and calls `save()`
  - [x] Build passes

- [x] **Step 4: Wire migration in `load()`**

  In the `load()` function, add `features` to the merge block (same pattern as `ai`):

  ```ts
  const merged: AppSettings = {
    ...defaultSettings,
    ...parsed,
    general:    mergeBlock(defaultSettings.general,    parsed.general),
    appearance: mergeBlock(defaultSettings.appearance, parsed.appearance),
    requests:   mergeBlock(defaultSettings.requests,   parsed.requests),
    proxy:      mergeBlock(defaultSettings.proxy,      parsed.proxy),
    mock:       mergeBlock(defaultSettings.mock,       parsed.mock),
    vault:      mergeBlock(defaultSettings.vault,      parsed.vault),
    editor:     mergeBlock(defaultSettings.editor,     parsed.editor),
    ai:         mergeBlock(defaultSettings.ai,         parsed.ai),
    features:   mergeBlock(defaultSettings.features,   parsed.features),  // ADD
  }
  ```

  **DoD:**
  - [x] `features` is merged in `load()` — old settings without `features` key will get the defaults
  - [x] Build passes

- [x] **Step 5: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [x] Exit code 0
  - [x] Zero TypeScript errors in output

- [x] **Step 6: Commit**

  ```bash
  git add frontend/src/stores/settings.ts
  git commit -m "feat: add features flags block to AppSettings (plugins, dailyScenarios off by default)"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the commit above
  - [x] Only `settings.ts` in the diff

---

### Task 2: Filter Rail items based on feature flags

**Files:**
- Modify: `frontend/src/components/layout/Rail.tsx`

- [x] **Step 1: Import `useSettingsStore`**

  At the top of `Rail.tsx`, add:

  ```ts
  import { useSettingsStore } from '@/stores/settings'
  ```

  **DoD:**
  - [x] Import resolves — build passes

- [x] **Step 2: Read the feature flags inside the Rail component**

  Locate the component that renders the rail (it uses `CATEGORIES`). Add near the top of the component body:

  ```ts
  const features = useSettingsStore((s) => s.settings.features)
  ```

  **DoD:**
  - [x] `features` is typed as `AppSettings['features']` — no implicit `any`
  - [x] Build passes

- [x] **Step 3: Filter items in each category's groups**

  Before rendering `CATEGORIES`, derive a filtered version:

  ```ts
  const visibleCategories = CATEGORIES.map((cat) => ({
    ...cat,
    groups: cat.groups.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.id === 'plugins' && !features.pluginsEnabled) return false
        if (item.id === 'scenarios' && !features.dailyScenariosEnabled) return false
        return true
      }),
    })).filter((group) => group.items.length > 0),
  })).filter((cat) => cat.groups.length > 0)
  ```

  Replace all references to `CATEGORIES` in the render with `visibleCategories`.

  **DoD:**
  - [x] No direct `CATEGORIES` reference remains in JSX render — all replaced with `visibleCategories`
  - [x] Build passes

- [x] **Step 4: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [x] Exit code 0
  - [x] Zero TypeScript errors

- [x] **Step 5: Manual smoke test**

  Run `wails dev`. Open the app. Verify:

  **DoD:**
  - [x] "Plugins" is NOT visible in the rail with default settings
  - [x] "Daily Scenarios" is NOT visible in the rail with default settings
  - [x] All other rail items appear normally (count is the same as before minus 2)

- [x] **Step 6: Commit**

  ```bash
  git add frontend/src/components/layout/Rail.tsx
  git commit -m "feat: hide plugins and daily scenarios from rail when feature flags are off"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the commit above
  - [x] Only `Rail.tsx` in the diff

---

### Task 3: Add Features section to Settings panel

**Files:**
- Modify: `frontend/src/components/settings/SettingsPanel.tsx`

- [x] **Step 1: Add `'features'` to the `SectionId` union**

  Find the `type SectionId = ...` declaration (around line 68). Add `'features'` to the union:

  ```ts
  type SectionId =
    | 'general'
    | 'appearance'
    | 'requests'
    | 'proxy'
    | 'mock'
    | 'vault'
    | 'editor'
    | 'features'   // ADD
    | 'privacy'
    | 'shortcuts'
    | 'about'
    | 'developer'
    | 'python'
    | 'ai'
  ```

  **DoD:**
  - [x] `'features'` is in the union
  - [x] Build passes with no unreachable code warnings

- [x] **Step 2: Add `updateFeatures` to the component's store reads**

  Near where `updateGeneral`, `updateAppearance`, etc. are declared (around line 107), add:

  ```ts
  const updateFeatures = useSettingsStore((s) => s.updateFeatures)
  ```

  **DoD:**
  - [x] `updateFeatures` is typed as `(patch: Partial<AppSettings['features']>) => void`
  - [x] Build passes

- [x] **Step 3: Add the nav item for Features**

  Locate the sidebar nav list inside `SettingsPanel` (the list of `<button>` elements that set `section`). Add a new item — place it after "General" and before "Appearance":

  ```tsx
  <button
    onClick={() => setSection('features')}
    className={cn('flex items-center gap-2 px-3 py-2 rounded text-xs transition-colors w-full text-left',
      section === 'features' ? 'bg-accent/15 text-accent' : 'text-text-3 hover:text-text-1 hover:bg-surface-2')}
  >
    <Puzzle size={13} />
    Features
  </button>
  ```

  Add `Puzzle` to the lucide-react import at the top of the file.

  **DoD:**
  - [x] `Puzzle` icon imported without error
  - [x] "Features" button is visible in the Settings sidebar
  - [x] Active state highlights correctly when selected

- [x] **Step 4: Add the Features section render branch**

  Locate the `section === 'general'` render block. Add a new branch:

  ```tsx
  {section === 'features' && (
    <>
      <SectionHeader
        title="Features"
        subtitle="Enable or disable experimental and optional features. Disabled features are hidden from the rail."
      />
      <SettingsCard>
        <Toggle
          label="Plugins (experimental)"
          desc="Enable the plugin system. The plugin sandbox is not yet stable."
          checked={settings.features.pluginsEnabled}
          onChange={(v) => updateFeatures({ pluginsEnabled: v })}
        />
        <Toggle
          label="Daily Scenarios (experimental)"
          desc="Enable the Daily Scenarios feature. This feature is not yet production-ready."
          checked={settings.features.dailyScenariosEnabled}
          onChange={(v) => updateFeatures({ dailyScenariosEnabled: v })}
        />
      </SettingsCard>
    </>
  )}
  ```

  **DoD:**
  - [x] Render branch exists and compiles
  - [x] Both toggles render with correct labels and descriptions
  - [x] Toggling "Plugins" updates `settings.features.pluginsEnabled` in the store

- [x] **Step 5: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [x] Exit code 0
  - [x] Zero TypeScript errors

- [x] **Step 6: Manual smoke test**

  Run `wails dev`. Open Settings. Verify:

  **DoD:**
  - [x] "Features" nav item appears in the sidebar
  - [x] Clicking it shows the section with two toggles
  - [x] Enabling "Plugins (experimental)" → Plugins item appears in rail immediately (no restart)
  - [x] Disabling it → item disappears again immediately
  - [x] Same for "Daily Scenarios"
  - [x] Closing and reopening the app preserves the toggle state

- [x] **Step 7: Commit**

  ```bash
  git add frontend/src/components/settings/SettingsPanel.tsx
  git commit -m "feat: add Features section in Settings to toggle plugins and daily scenarios"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the commit above
  - [x] Only `SettingsPanel.tsx` in the diff
