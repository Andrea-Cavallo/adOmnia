# SOUL.md

The product soul of adOmnia — what it is, why it exists, how it should feel, and the quality it must achieve.

---

## Why adOmnia Exists

Developers deserve a professional API toolbox that respects their privacy, their workflow, and their legacy systems — without forcing them into a cloud account, a subscription, or a browser tab.

**adOmnia exists because:**

- **Postman went cloud-only and locked users in.** Your data should live on your machine, not on someone else's server.
- **No API tool integrates browser debugging.** Developers switch between browser DevTools, API clients, and interceptors constantly. This should be one tool.
- **Enterprise protocols are treated as second-class citizens.** SOAP, WSDL, mTLS, JKS, WS-Security — these are not "legacy." They run the world's financial and government systems. They deserve first-class support.
- **Desktop tools should feel like desktop tools.** Not web apps wrapped in Electron. Fast, native, responsive. No loading spinners for local operations.
- **Your workflow should be yours.** Exportable, versionable, shareable as a file. No vendor lock-in. No cloud dependency.

---

## Product Identity

**adOmnia is a developer toolbox, not a toy.**

It is built for professionals who:
- Test APIs daily
- Debug browser interactions
- Work with enterprise systems
- Need offline, local-first tools
- Value privacy and control
- Want a premium desktop experience

It is NOT:
- A Postman clone
- A student project
- An Electron web wrapper
- A feature checklist exercise
- A "good enough" MVP

---

## The Desired Feeling

When a developer opens adOmnia, they should feel:

### Power
The application feels capable. Every panel has depth. No feature feels shallow or half-baked. The user thinks: *"This tool can handle whatever I throw at it."*

### Fluidity
Everything moves at 60fps. Transitions are instant. No perceptible lag between click and result. The user thinks: *"This is fast. Like, native fast."*

### Focus
The interface fades away when the user is in flow. No unnecessary visual noise. No popups asking for reviews. No upgrade banners. The user thinks: *"Nothing gets between me and my work."*

### Professionalism
Every pixel is intentional. Every interaction feels considered. Typography, spacing, color — all consistent. The user thinks: *"Someone actually designed this."*

### Modularity
Each panel is self-contained yet cohesive with the whole. Panels can be rearranged, resized, shown, hidden. The user thinks: *"It adapts to how I work, not the other way around."*

### Control
The user always knows what's happening. State is visible. Errors are clear. No hidden magic. Every operation can be inspected, modified, cancelled. The user thinks: *"I'm in control of this tool."*

### Speed (Perceived)
Even when operations take time, the UI responds immediately. Skeleton states, progress indicators, streamed responses. The user never waits without feedback. The user thinks: *"It keeps up with me."*

### Premium Desktop Experience
The application feels like a JetBrains IDE, not a Bootstrap admin panel. Custom rendering. Native-like interactions. No browser-first design compromises. The user thinks: *"This is a real desktop application."*

---

## UX Principles

### 1. Zero-Friction First Use
- No sign-up, no account, no onboarding wizard
- Open the app, start working immediately
- Sensible defaults that can be changed later

### 2. Progressive Complexity
- Simple operations are simple (type URL, press send)
- Advanced features are discoverable but not in the way
- Nobody should need a tutorial for basic usage

### 3. Keyboard-Driven
- Every action has a keyboard shortcut
- Power users never need to touch the mouse
- Command palette for discoverability

### 4. Immediate Feedback
- Every action produces a visible result
- Loading states never block the UI
- Errors explain what happened and suggest fixes

### 5. Stable Layout
- No layout shifts between operations
- Panels maintain their position and size
- Controls don't jump, resize, or disappear unexpectedly

### 6. Visual Cohesion
- Every panel uses the same design language
- Same spacing, same typography, same interaction patterns
- The application feels like one product, not a collection of prototypes

### 7. Local-First Integrity
- Data autosaves, never lost
- Works offline, always
- Exports are complete and importable

### 8. Respect for the User
- No telemetry, no analytics, no tracking
- No upgrade prompts, no feature gating
- No "sign in to continue" anywhere

---

## Visual Design Language

### Aesthetic
- **Dense but not cluttered** — information-rich without feeling cramped
- **Dark-first** — designed for developers who work in dark environments
- **Monochromatic base with semantic accents** — greys for structure, colors for meaning
- **Subtle depth** — enough layering to understand hierarchy, not so much as to feel decorative
- **Sharp where JetBrains is sharp, smooth where Linear is smooth**

### Typography
- **Monospace for code, sans-serif for UI**
- **Consistent sizing hierarchy** — no font-size chaos between panels
- **Readable at small sizes** — developers scan, they don't read novels

### Spacing
- **Tight enough for density, loose enough for clarity**
- **Consistent 4px grid** — every margin, padding, gap is a multiple of 4
- **No "eyeballed" spacing** — if it looks inconsistent, it is

### Color
- **Grey palette for structure** — backgrounds, borders, dividers
- **Semantic colors for meaning** — green for success, red for error, blue for info
- **Accent color for primary actions** — one color, used sparingly
- **No rainbow UI** — colors communicate state, not decoration

### Motion
- **Instant for tiny changes** — toggles, selections, focus
- **Subtle for medium changes** — panel opens, tab switches
- **Visible for large changes** — navigation, mode switches
- **Never gratuitous** — no bouncing, no spring physics, no "delight" animations that slow down power users

---

## Reference Software

The quality bar is set by these applications:

| Product | What We Learn From It |
|---------|----------------------|
| **JetBrains IDEs** | Density, keyboard-driven, custom rendering, professional feel, stable layout |
| **Postman Desktop** | API workflow, collection management, environment variables, request/response UX |
| **Insomnia** | Simpler, cleaner Postman alternative — less bloat, more focus |
| **Raycast** | Speed, command palette, instant feedback, keyboard-first, beautiful UI |
| **Linear** | Modern design language, smooth interactions, focused feature set, perceived quality |
| **TablePlus** | Native desktop feel, tight typography, minimal but powerful |
| **Figma Desktop** | Canvas-based interactions, panel management, professional tooling feel |

### Anti-References (What We Avoid)

| Product | What We Avoid |
|---------|---------------|
| **Cookie-cutter Electron apps** | Web-like feel, non-native interactions, poor performance |
| **Bootstrap Admin Panels** | Generic aesthetic, inconsistent spacing, no design language |
| **University projects** | Misaligned elements, random colors, broken layouts, no polish |
| **Startup MVPs** | Feature gating, upgrade prompts, cloud dependency, shallow features |

---

## Long-Term Vision

### Phase 1: Cohesion (Current Focus)
Make the frontend feel like one product. Every panel aligns visually. Every interaction follows the same patterns. The backend is connected to real UI, not mock panels.

### Phase 2: Integration
Browser debugging works seamlessly. Proxy interception feels native. The four pillars are all visibly present in the product experience.

### Phase 3: Extension
Plugin system ships. Users can extend the tool. Workspace templates circulate. The community contributes skins, plugins, and workflows.

### Phase 4: Polish
Performance tuning. Accessibility. i18n. Every rough edge smoothed. The product competes with (and surpasses) established commercial tools on quality alone.

### Phase 5: Evolution
New protocols, new integrations, new workflows. The tool grows with its users. But never at the expense of the core: local-first, private, extensible, powerful.

---

## What Success Looks Like

A developer recommends adOmnia to a colleague not because it's free, but because **it's the best API tool they've ever used.**

The recommendation sounds like:

> *"Have you tried adOmnia? It's like Postman but it's a real desktop app — fast, offline, handles SOAP and browser debugging in one place. And your data stays on your machine. I switched and never looked back."*

That is the target. Every decision — code, design, feature — should move us closer to that recommendation.

---

## The Non-Negotiables

These cannot be compromised, ever:

1. **Local-First** — data never leaves the machine without explicit user export
2. **No Accounts** — no sign-up, no login, no user tracking
3. **Offline** — all core features work without internet
4. **Portable** — single executable, no installer, runs from USB if needed
5. **Professional Quality** — never ships with "placeholder" or "mock" visible to the user
6. **Visual Cohesion** — every panel belongs to the same application
7. **Keyboard Accessible** — every action reachable without mouse

---

## For AI Agents

When working on adOmnia, internalize this document. Before every change, ask:

- Does this make the product feel more premium or less?
- Does this maintain or break visual cohesion?
- Does this respect the user's privacy and control?
- Would a JetBrains/Linear-level designer approve this?
- Does this move us closer to "the best API tool they've ever used"?

If the answer to any of these is "no," reconsider the approach.
