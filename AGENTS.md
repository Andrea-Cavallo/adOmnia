# AGENTS.md

Guida operativa per Codex e altri agenti AI che lavorano su adOmnia.

Questo file e' intenzionalmente pratico: prima aiuta l'agente a capire il progetto, poi gli dice come modificarlo senza rompere le convenzioni locali.

---

## PRODUCT-FIRST PHILOSOPHY (PRIMARY DIRECTIVE)

**adOmnia is a production-grade desktop developer toolbox. This is NOT a theoretical exercise, a code challenge, or a boilerplate.**

The *primary goal* is a **professional, coherent, modern, and truly usable FINAL desktop PRODUCT**. Every decision must prioritize end-user experience and overall application quality.

### What We Are NOT Aiming For
- ❌ Perfect unit tests or excessively high code coverage
- ❌ Premature micro-optimizations
- ❌ "Academic" clean architecture at the expense of agility
- ❌ Isolated demos or proof-of-concepts

### Priority Hierarchy

| 🔴 HIGH PRIORITY (Product) | 🟢 LOW PRIORITY (Internal) |
|:----------------------------|:---------------------------|
| User Experience (UX) | Excessive, unnecessary unit tests |
| Real-world Integration | Premature abstractions |
| Fluidity & Responsiveness | Artificial layering (e.g. 900 layers) |
| Graphical Cohesion | Over-engineering solutions |
| Complete Workflows | |
| Perceived Stability | |
| User Journey | |
| Evolutionary Architecture | |
| Real Backend/Frontend Connection | |

**Rule:** when in doubt, bias toward what the user sees and touches. Internal code quality matters only insofar as it enables a better product.

---

## Current Project Status (HONEST ASSESSMENT)

Agents must understand the *real, current state* of the project:

- **Current runtime is Wails 2 + Go backend + React 18/TypeScript frontend.**
- Some older documentation may still mention Tauri/Rust or legacy paths; treat the actual files in this repo as the source of truth.
- **Backend is significantly more advanced** than the frontend
- **Frontend is still incomplete and nascent**
- **Many backend features are not yet connected** to the frontend
- **The UI is not yet professional** — lacks visual cohesion
- **Many modules still resemble mocks or prototypes**
- **Some features are technically functional but do NOT yet deliver a final product experience**

**Implication:** the highest-impact work is closing the frontend/backend gap, achieving visual cohesion, and elevating the UI to production quality — NOT adding more backend features in isolation.

---

## Canonical Project Context

Before planning or changing non-trivial behavior, use these docs to understand the product quickly:

| File | Use it for |
|------|------------|
| `docs/SOUL.md` | Product soul, UX philosophy, long-term vision, and what adOmnia should feel like as a finished desktop product. |
| `docs/adomnia-feature-catalog.en.md` | Fast inventory of all major features and modules. Read this when you need to understand what already exists before adding or moving functionality. |
| `docs/ISSUES.md` | Active bugs, gaps, near-term work queue, and completion status across major product areas. |
| `README.md` | Public-facing product positioning and build overview. |

**Rule:** if you are unsure whether a feature already exists, first search the code, then check `docs/adomnia-feature-catalog.en.md`. If you are unsure how a feature should feel or fit the product, check `docs/SOUL.md`.

---

## Identita del Progetto

**adOmnia** è un desktop API development toolbox costruito attorno a **quattro pilastri difendibili:**

1. **Local-First** — niente cloud, niente account, niente telemetria. I dati non lasciano mai la macchina.
2. **User-Extensible** — plugin system, skin importabili, template condivisibili, workspace versionabili.
3. **Browser Debugging Integrato** — debug di pagine web esterne dentro lo stesso tool per API testing (nessun competitor lo fa).
4. **Enterprise & Legacy First-Class** — SOAP, WSDL, WS-Security, mTLS, JKS, eIDAS, Berlin Group.

**Stack tecnologico:**
- **Frontend:** React 18 + TypeScript + Vite
- **Desktop shell:** Wails 2
- **Backend:** Go
- **State frontend:** Zustand + React hooks
- **Persistence:** bbolt, local files, local workspaces, settings bindings
- **Distribuzione:** Eseguibile portabile singolo (`.exe`, `.app`, binario Linux)
- **Filosofia:** Local-first, privacy-first, user-extensible

---

## Prima di Toccare Codice

1. **Leggi CLAUDE.md** per architettura dettagliata, pattern, e binding Wails/Go
2. **Leggi `docs/SOUL.md`** se il cambio tocca UX, posizionamento prodotto, visual design o comportamento percepito
3. **Consulta `docs/adomnia-feature-catalog.en.md`** per capire velocemente tutte le funzionalità già presenti e non duplicare moduli esistenti
4. **Controlla il file specifico più vicino alla feature** — questo progetto preferisce cambi piccoli e localizzati
5. **Mantieni la filosofia local-first:** qualunque dato deve stare in storage locale, bbolt, localStorage o essere esportabile come file
6. **Se tocchi storage, settings o workspace `.adomnia`**, preserva backward compatibility e documenta la migrazione
7. **Ogni feature deve allinearsi con almeno 2 dei 4 pilastri** — vedi "Four Pillar Decision Framework" in CLAUDE.md

---

## Struttura Reale del Repo

Nota: la struttura attuale è Wails/Go alla root con frontend in `frontend/`. Se trovi sezioni legacy che citano `src-tauri/`, considerale storiche e verifica sempre contro i file reali.

```text
adomnia/
├── main.go                    # Wails entrypoint
├── app.go                     # App lifecycle and desktop bindings
├── server.go                  # Local HTTP sidecar
├── mock.go                    # Mock server
├── proxy*.go                  # Proxy/interceptor, CA, traffic, rules, export
├── browser_debug*.go          # Browser debugging via CDP
├── kafka.go / broker.go       # Kafka and multi-broker support
├── grpc.go                    # gRPC backend
├── loadtest.go                # Load testing engine
├── database_go.go             # Database Studio backend
├── dockerlab.go               # Docker Lab generator/runner
├── themes*.go                 # Themes, skins, validation, hot reload
├── plugins*.go                # WASM plugin sandbox and bindings
├── frontend/                  # React frontend
│   ├── src/components/        # UI panels and components
│   ├── src/stores/            # Zustand stores
│   ├── src/lib/               # API wrappers, parsers, helpers, types
│   └── src/styles/            # Global CSS and design tokens
├── assets/images/             # App artwork and icons
├── docker/adomnia-lab/        # Local lab Docker Compose setup
├── workspaces/                # Sample .adomnia workspace files
├── docs/                      # Documentation
│   ├── BUILD.md
│   ├── SOUL.md
│   ├── ISSUES.md
│   └── adomnia-feature-catalog.en.md
├── AGENTS.md                  # Questo file
├── CLAUDE.md                  # Guida dettagliata per Claude Code
├── LICENSE.md                 # MIT license
├── README.md                  # User-facing overview
├── go.mod                     # Go dependencies
├── wails.json                 # Wails configuration
└── frontend/package.json      # Frontend dependencies
```

---

## Architecture

### Backend (Wails 2 + Go)

Il backend Go espone metodi Wails che il frontend chiama tramite bindings generati in `frontend/wailsjs/go/main/*`.

**Comandi principali:**

| Area | Files / bindings |
|------|------------------|
| App lifecycle/settings | `app.go`, `settings_bindings.go`, `frontend/wailsjs/go/main/App.*` |
| HTTP/mock/proxy | `mock.go`, `proxy*.go`, `httputil.go`, `record_replay.go` |
| Browser debugging | `browser_debug*.go` |
| Brokers/protocols | `kafka.go`, `broker.go`, `grpc.go`, `websocket_*.go`, `sse_client.go` |
| Data/security | `database_go.go`, `storage*.go`, `vault.go`, `certtools_go.go` |
| Docker Lab | `dockerlab.go`, `frontend/src/lib/dockerlab-api.ts` |
| Themes/plugins/templates | `themes*.go`, `plugins*.go`, `templates.go` |

**Pattern importanti:**
- Backend mantiene lifecycle e processi locali per proxy/mock/lab/plugin dove necessario
- Validazione input sempre prima di chiamate di sistema
- Timeout context per operazioni di rete
- Errori backend devono diventare messaggi UI puliti, non stack trace o output raw di terminale

### Frontend (React 18 + TypeScript)

**Componenti principali:**

| Component | Purpose |
|-----------|---------|
| `App.tsx` | Root component, state owner, keyboard shortcuts |
| `Sidebar.tsx` | Collection tree, folder/request CRUD, search |
| `Composer.tsx` | Method + URL bar, body/headers/auth/scripts editors |
| `ResponsePanel.tsx` | HTTP response viewer, syntax highlighting, tests |
| `EnvBar.tsx` | Environment switcher, variable editor |
| `TabBar.tsx` | Tab management, pinning, context menus |
| `WSPanel.tsx` | WebSocket client con live messaging |
| `KafkaPanel.tsx` | Kafka producer/consumer UI |
| `MockPanel.tsx` | Mock server endpoint config, hit log |
| `ProxyPanel.tsx` | Interceptor traffic viewer, breakpoints |
| `LoadTestDrawer.tsx` | Load test config, scatter plot |
| `UtilsPanel.tsx` | 20+ developer utilities |
| `SettingsPanel.tsx` | Settings UI |

**Pattern importanti:**
- **State management:** React hooks (`useState`, `useEffect`, `useReducer`)
- **State stores:** Zustand in `frontend/src/stores/`
- **Persistence:** bbolt/settings bindings/localStorage/workspace file a seconda del modulo
- **Variable substitution:** `{{varName}}` risolto da environment attivo
- **Wails calls:** wrapper in `frontend/src/lib/*-api.ts` chiamano bindings sotto `frontend/wailsjs/go/main/`
- **Immutable updates:** `setState(s => ({ ...s, key: value }))`

---

## Storage and Workspace

**Primary localStorage keys:**

| Key | Meaning |
|-----|---------|
| `adomnia.v2` | Main app state: collections, environments, tabs, history |
| `adomnia.settings` | Settings (versioned schema) |
| `adomnia.mock` | Mock server config |
| `adomnia.respHistory` | Response history (size-limited) |

**Workspace export shape:**

```json
{
  "format": "adomnia-workspace",
  "version": "1.0",
  "collections": [],
  "environments": [],
  "activeEnvId": "",
  "mockConfig": {},
  "proxyConfig": {},
  "flows": []
}
```

**Quando cambi schemi:**
- Mantieni retrocompatibilità — vecchi dati devono rimanere leggibili
- Migra in loader functions (`loadStateV2()`)
- Non cancellare dati utente silenziosamente
- Aggiorna docs se export/import cambia

---

## Build, Run, Check

**Development:**

```bash
# Install dependencies
cd frontend
npm install
cd ..

# Start dev server with hot reload
wails dev
```

**Production build:**

```bash
# Windows
.\build.ps1

# macOS / Linux
./build.sh
```

**Common checks:**

```bash
# TypeScript check
cd frontend
npm run build

# Go check
cd ..
go test ./...
```

**Note:**
- Questa cartella potrebbe non essere un checkout Git. Non fare affidamento su `git status` disponibile.
- Wails richiede Go, Node.js e le dipendenze native della piattaforma. Vedi `docs/BUILD.md`.

---

## Coding Conventions

### React/TypeScript

- **Functional components** con hooks
- **Prop types espliciti** (no `any`)
- **Immutable state updates**
- **Estrai logica riusabile** in custom hooks
- **Componenti focalizzati:** split se >300 righe
- **Usa Icon.* components** dove possibile

### Go/Wails

- **Metodi Wails piccoli e chiari:** delega logica complessa a helper/service locali
- **Valida input** prima di chiamate di sistema, processi, filesystem o rete
- **Usa `context.WithTimeout`** per operazioni di rete/processi lunghi
- **Ritorna errori leggibili** che il frontend può mostrare senza output raw di terminale
- **Su Windows nascondi processi CLI** quando avviati dal backend per evitare flash di console

### CSS/UI

- **Usa CSS custom properties** da `frontend/src/styles/globals.css` (`--color-*`, `--font-*`, radius, spacing, shadow)
- **Stili modulari** vicini ai componenti
- **Mantieni estetica dense developer tool** — professionale, moderna, coerente
- **No nuovi framework CSS esterni** (Bootstrap, ecc.) — Tailwind è già integrato in questo frontend: usa il setup esistente e i design token
- **Controlli stabili e compatti** — no layout shift
- **Ogni pannello deve sembrare parte della stessa applicazione** — non un collage di prototipi
- **Coerenza dimensionale:** stessi spacing, stesse dimensioni font, stessi pattern di interazione
- **Feedback visivo immediato:** ogni azione deve avere un feedback percepibile (hover, active, loading, success, error)
- **Niente UI "cheap":** no bordi storti, no colori fuori palette, no spaziature inconsistenti
- **Coerenza cross-platform Wails/WebKitGTK:** tratta ogni differenza WebKitGTK visibile nella UI Linux come un problema di qualita' prodotto, non come un dettaglio tecnico secondario. Preferisci normalizzazioni globali token-based per problemi ricorrenti in `frontend/src/styles/globals.css`; usa workaround locali solo quando il componente e' davvero isolato. In particolare, Linux puo' renderizzare controlli nativi chiari dentro temi scuri: per `select`, `input`, `textarea`, checkbox/radio e number input mantieni `color-scheme`, le normalizzazioni globali, token `surface/text/border/accent/status`, ed evita colori Tailwind hardcoded nella UI primaria (`bg-white/*`, `text-purple-*`, `bg-green-*`, ecc.) salvo stati semantici intenzionali.

---

## Common Change Recipes

### Add a backend command

1. Aggiungi o estendi il metodo Go nel file backend più vicino alla feature
2. Registra/binda il servizio in `main.go`/setup Wails se è un nuovo servizio
3. Rigenera o verifica i bindings Wails in `frontend/wailsjs/go/main/*` quando necessario
4. Crea un wrapper frontend in `frontend/src/lib/<feature>-api.ts` se non esiste
5. Test: `wails dev`, `go test ./...`, e `cd frontend && npm run build`

### Add a frontend component

1. Crea `frontend/src/components/<area>/<Component>.tsx`
2. Esporta e importa in `App.tsx`
3. Aggiungi a routing/rail/modal system
4. Persisti state usando lo store esistente, settings binding, bbolt o workspace file secondo il modulo
5. Aggiungi stili con classi esistenti/design tokens, evitando palette o layout fuori sistema

### Add a developer utility

1. Apri `frontend/src/components/utils/UtilsPanel.tsx` oppure il pannello dedicato più coerente
2. Aggiungi tab seguendo pattern esistente (switch/state)
3. Mantieni logica locale tranne se riusabile altrove
4. No librerie browser terze parti

### Add a protocol (SOAP, gRPC, etc.)

1. Aggiungi backend Go nel file/protocol service più vicino o crea `<protocol>.go`
2. Aggiungi panel in `frontend/src/components/<protocol>/<Protocol>Panel.tsx`
3. Aggiungi rail icon e routing in `App.tsx`
4. Aggiorna import/export per includere dati protocol-specific
5. Documenta in README.md

---

## Testing Strategy

**Product-first testing: verify the user experience, not code coverage.**

Per cambi:

- Esegui `npm run build` per catturare errori TypeScript
- Esegui `go test ./...` per check backend Go
- Usa `wails dev` per test integrazione app
- **Testa manualmente l'esperienza utente completa** — apri il pannello, usalo come farebbe un utente reale
- Verifica che il workflow sia fluido dall'inizio alla fine
- Verifica la coesione visuale con i pannelli adiacenti

**High-value test targets (what the user actually does):**
- Variable substitution (`{{var}}`) nei vari campi
- Auth flows end-to-end (OAuth2, AWS4)
- Mock path matching (`:param`, `*`, `**`) con richieste reali
- Proxy breakpoints e map local/remote con traffico reale
- Workspace import/export con dati reali
- Postman v2.1 parser con file reali

**What we DON'T chase:**
- 100% code coverage
- Unit test per ogni funzione
- Test che non simulano uso reale

---

## Security and Privacy Constraints

- **Local-first by design** — no telemetry, no external calls
- **Plaintext storage** — localStorage non è encrypted, documenta questo
- **Script execution** — user scripts girano in renderer, avvisa rischi
- **Certificate handling** — valida cert paths, mai auto-trust
- **Proxy CA export** — in progress, documenta implicazioni trust

---

## Known Pain Points

- **localStorage size limits** (≈5-10MB) — workspace grandi possono colpire limite
- **Wails build** richiede Go, Node.js e dipendenze native della piattaforma
- **HTTPS interception CA export** incompleta (TODO)
- **Flow builder** parked/disabled (state management complesso)
- **Plugin system** architettura in progress
- **Browser debugging integration** early stage

---

## Documentation Expectations

Aggiorna docs quando comportamento cambia:

- `README.md` per feature user-facing
- `docs/BUILD.md` per cambi build/distribution
- `docs/RELEASE.md` per cambi release-worthy
- `.github/SECURITY.md` per cambi security posture
- `docs/ISSUES.md` quando lo stato feature cambia
- `docs/SOUL.md` quando product vision o UX philosophy evolve
- `CLAUDE.md` per guidance architettura/pattern dettagliato

---

## Agent Operating Style

Quando lavori in questo repo, pensa da **product engineer**, non da code monkey:

1. **Product-first, sempre** — ogni decisione parte da "come lo vede l'utente?"
2. **Rispetta i quattro pilastri** — ogni cambio dovrebbe rafforzare local-first, extensibility, browser integration, o enterprise/legacy support
3. **Il frontend NON e' quasi finito** — è la parte più indietro. Trattalo come tale. Non assumere che "funzioni già".
4. **Collega backend e frontend** — se esiste un metodo/binding Go senza UI, quella è la priorità
5. **Ogni pannello deve sentirsi parte dello stesso prodotto** — coesione visuale, stessi pattern UX, stesso linguaggio di design
6. **Preferisci edit piccoli e chirurgici** — non refactorare codice non correlato
7. **Riusa pattern esistenti** — segui struttura componenti, storage keys, auth flows
8. **Mantienilo local-first** — no chiamate di rete esterne senza azione esplicita utente
9. **Documenta breaking changes** — specialmente in workspace format o storage keys
10. **Prima di finalizzare**, riassumi file cambiati e comandi di verifica

---

## Four Pillar Decision Framework

Quando proponi una feature, chiediti:

1. **Local-First:** Mantiene i dati locali? Funziona offline? È condivisibile come file?
2. **Extensible:** Gli utenti possono customizzarlo? È pluggable? Template-abile?
3. **Browser Integration:** Lega API testing a web debugging? Riduce tool switching?
4. **Enterprise/Legacy:** Supporta protocolli/standard che Postman ignora? Banking, gov, sistemi legacy?

**Se una feature ha score 0/4, riconsiderale. Se ha score 2+, è probabilmente un buon fit.**

---

## Related Files

Quattro file vivono nella root — tutto il resto è in `docs/`:

- **README.md** — User-facing overview, quick start, feature list
- **AGENTS.md** — Questo file
- **CLAUDE.md** — Guida operativa per Claude Code
- **LICENSE.md** — MIT license

### docs/ — indice completo

| File | Scopo |
|------|-------|
| `docs/SOUL.md` | Product philosophy, UX principles, long-term vision |
| `docs/adomnia-feature-catalog.en.md` | Catalogo rapido e completo delle funzionalità del prodotto |
| `docs/ISSUES.md` | Bug aperti, feature mancanti e stato di completamento — coda di lavoro attiva |
| `docs/BUILD.md` | Istruzioni di build per tutte le piattaforme |
| `docs/RELEASE.md` | Release history |
| `.github/SECURITY.md` | Security policy (riconosciuto dal tab GitHub Security) |
