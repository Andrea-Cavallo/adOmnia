# UI Refactor — Checklist

> Stato: `- [ ]` = da fare · `- [x]` = completato  
> Aggiorna questo file man mano che i task vengono completati.

---

## 🟥 PRIORITÀ 0 — Palette colori ufficiale adOmnia

> **Fare prima di tutto il resto.** Tutti i componenti ereditano i colori dalle CSS vars in `globals.css` → nessun file TSX da toccare, solo il CSS e la verifica visiva.

### Palette di riferimento

| Ruolo | Nome | HEX |
|-------|------|-----|
| Background app | Nero bluastro | `#05070D` |
| Card / pannello | Nero soft | `#0B0D14` |
| Viola primary (accent) | Electric Purple | `#8B3DFF` |
| Viola secondary (accent dark) | Deep Violet | `#5B21D6` |
| Viola highlight (accent light) | Neon Violet | `#A855F7` |
| Testo primario | Soft White | `#F8FAFC` |
| Testo secondario | Cool Gray | `#9CA3AF` |
| Bordo sottile (primary) | Dark Border | `#1F2333` |

### Analisi delta — cosa è già corretto e cosa va cambiato

**Già corretto** (`globals.css` corrisponde):
- [x] `--color-surface-0: #05070D` ✅
- [x] `--color-surface-1: #0B0D14` ✅
- [x] `--color-text-1: #F8FAFC` ✅
- [x] `--color-text-2: #9CA3AF` ✅

**Da correggere** — i tre delta reali:

**A. Accent in OKLCH → HEX specifici** (`globals.css` righe 26-30)  
Attualmente i colori accent usano `oklch(...)` che produce sfumature viola leggermente diverse dagli HEX target.

- [x] `--color-accent` → `#8B3DFF` *(era `oklch(0.58 0.25 290)`)*
- [x] `--color-accent-dark` → `#5B21D6` *(era `oklch(0.42 0.22 290)`)*
- [x] `--color-accent-light` → `#A855F7` *(era `oklch(0.80 0.14 290)`)*
- [x] `--color-accent-hover` → `#9B4FFF` *(valore intermedio tra primary e light, era `oklch(0.65 0.22 290)`)*
- [x] `--color-accent-glow` → `rgba(139, 61, 255, 0.18)` *(era `oklch(0.58 0.25 290 / 0.18)`)*
- [x] `--shadow-glow` → `0 0 20px rgba(139, 61, 255, 0.15)` *(era `oklch(0.58 0.25 290 / 0.15)`)*

**B. Bordo primario** (`globals.css` righe 21-23)  
Il bordo "sottile" ufficiale è `#1F2333` ma attualmente `--color-border-1` è `#131722` (troppo scuro) e `--color-border-3` è `#1F2333`. Il sistema è invertito rispetto all'intensità visiva attesa.

- [x] `--color-border-1` → `#1F2333` *(era `#131722`, diventa il bordo standard)*
- [x] `--color-border-2` → `#252A3A` *(era `#1A1E2C`, bordo medio leggermente più visibile)*
- [x] `--color-border-3` → `#2E3447` *(era `#1F2333`, bordo enfatizzato)*
- [x] Verificare che `border-color: var(--color-border-1)` in `@layer base` produca bordi visibili dopo il cambio

**C. Method GET color** — aggiornare per coerenza con il nuovo accent HEX

- [x] `--color-method-get` → `#8B3DFF` *(era `oklch(0.58 0.25 290)`, ora uguale all'accent principale)*

**D. Verifica visiva post-modifica**

- [ ] Aprire l'app in dev mode e controllare: rail, tab bar, pulsanti accent, bordi pannelli, indicatori di stato
- [x] Controllare il tema **light** in `.light {}` (righe 73-104) — aggiornare i corrispondenti valori accent light se necessario:
  - `--color-accent: #7C2FF5` *(versione light del primary, leggermente più scuro per contrasto su sfondo chiaro)*
  - `--color-accent-light: #9B4FFF`
  - `--color-accent-dark: #4A18B8`

---

## 🔴 CRITICO — Fare subito

### 1. Sostituire tutti i `prompt()` / `confirm()` nativi

Il componente `<Prompt>` styled esiste già in `ui/prompt.tsx` ma non è mai usato.  
I `confirm()` vanno sostituiti con un `<ConfirmDialog>` inline usando `DialogOverlay`/`DialogContent` da `ui/dialog.tsx`.

- [x] **`EnvBar.tsx:29`** — `prompt('Environment name:')` → `<Prompt>` con state `[promptOpen, setPromptOpen]`
- [x] **`EnvModal.tsx:114`** — `prompt('Environment name:')` → `<Prompt>`
- [x] **`EnvModal.tsx:175`** — `confirm('Delete "..."?')` → `<ConfirmDialog>` inline
- [x] **`StoragePanel.tsx:85`** — `confirm('Delete "..."?')` → `<ConfirmDialog>` inline
- [x] Verificare presenza di altri `prompt()`/`confirm()` nel codebase con grep

---

### 2. Errori `storage not initialized` al boot

Causa: `save()` viene chiamato prima che `load()` sia completato, durante HMR Vite o primo avvio.  
Fix: aggiungere guard `if (!get().loaded) return` all'inizio di ogni `save()`.

- [x] **`frontend/src/stores/collections.ts`** — aggiungere `if (!get().loaded) return` in `save()` (riga ~77)
- [x] **`frontend/src/stores/environments.ts`** — aggiungere `if (!get().loaded) return` in `save()` (riga ~46)
- [x] Verificare che `loadForgeCoreDemo()` in `App.tsx:98` venga chiamata solo quando entrambi i load hanno avuto **successo** (non solo `loaded: true` che viene settato anche nel `catch`)

---

### 3. Variabili `{{ENV_VAR}}` — highlight risolte/mancanti

**Sintomo:** nell'URL bar e nei campi del Composer (headers, params, body) i segnaposto `{{base_url}}` sono completamente bianchi. L'utente non capisce al volo se la variabile è definita nell'environment attivo o mancante.

**Comportamento atteso:**
- `{{base_url}}` → **verde** se la variabile esiste nell'env attivo con un valore non vuoto
- `{{missing_var}}` → **rosso** con sfondo tenue se la variabile non è definita o è vuota
- `{{no_env}}` → **arancione** se non c'è nessun environment attivo

**Approccio implementativo:**  
Creare un componente `VarHighlightInput` (wrapper dell'`<input>`) che, in read-only overlay, spezza il testo in segmenti normali e segmenti `{{...}}`, colora ogni segmento in base alla risoluzione nell'env attivo. L'input rimane editabile sotto; il layer colorato è solo visuale (stessa tecnica dei code editor con `contenteditable` o `position: absolute` overlay).

In alternativa più semplice: tooltip on-hover su ogni `{{var}}` nell'URL bar che mostra il valore risolto o "⚠ not defined".

- [x] **Creare `frontend/src/components/ui/VarHighlightInput.tsx`** — componente input con overlay colorato per i token `{{...}}`
  - Legge le variabili risolte da `useEnvironmentsStore().getResolvedVars()`
  - Token verde = variabile definita → mostrare il valore in tooltip on-hover
  - Token rosso = variabile mancante → mostrare "⚠ not set" in tooltip
  - Token arancione = nessun env attivo → mostrare "⚠ no active environment"
- [x] **`frontend/src/components/composer/Composer.tsx`** — sostituire l'`<input>` dell'URL bar (riga ~196) con `<VarHighlightInput>`
- [x] **`frontend/src/components/composer/KVEditor.tsx`** — applicare `VarHighlightInput` alla colonna "Value" (i valori possono contenere `{{vars}}`)
- [x] **`frontend/src/components/composer/BodyEditor.tsx`** — nel JSON raw editor, aggiungere un mini-badge/warning bar sotto se il testo contiene `{{var}}` non risolte

---

## 🟡 MEDIO — Fare presto

### 4. Dev logs: sessioni precedenti mischiate + messaggi duplicati

Causa: backend persiste tutti i log FE nel file devlog; al riavvio vengono ricaricati tutti.  
`main.tsx` logga 2 messaggi ad ogni init del modulo (ogni HMR reload).

- [x] **`frontend/src/main.tsx`** — aggiungere sentinel di sessione:  
  ```ts
  console.info(`━━━ SESSION START ${new Date().toISOString()} ━━━`)
  ```
- [x] **`frontend/src/App.tsx`** — dopo il primo `syncBackendLogs()`, chiamare `clearBackendDevLogs()` per pulire il file e ricominciare la sessione pulita
- [x] **`frontend/src/main.tsx`** — in `recordFrontendDevLog` dentro il log interceptor, chiamare il backend solo per livelli `warn` e `error` (non per `log`/`info`/`debug` banali che gonfiano il file)
- [x] Verificare in `DevLogOverlay.tsx` che il sentinel `━━━ SESSION START ━━━` venga reso visivamente distinto (separatore orizzontale o badge)

---

### 5. TabBar — redesign tab pills e pulsante "+"

**Sintomo attuale:**
- La X per chiudere è `opacity-0 group-hover:opacity-100` — invisibile, difficile da cliccare su tab strette
- Con molte tab aperte la barra diventa un muro di testo uniforme senza gerarchia visiva
- Non c'è un pulsante `+` visibile per aprire una nuova tab (solo `Ctrl+N` o WelcomePanel)

**Fix:**
- [x] **`frontend/src/components/layout/TabBar.tsx`** — ridisegnare la tab pill:
  - La X deve essere sempre visibile (non opacity-0), ma piccola e in colore `text-text-4`; diventa `text-error` on-hover
  - Aggiungere `min-w` e `max-w` con ellipsis per URL lunghe
  - Tab attiva: sfondo `bg-surface-2` + bordo bottom `border-b-2 border-accent` invece di solo background
  - Tab inattiva: bordo bottom trasparente, hover leggero
  - Dot indicator dirty (modifica non salvata) già presente — tenerlo
- [x] **`frontend/src/components/layout/TabBar.tsx`** — aggiungere pulsante `+` dopo l'ultima tab:
  ```tsx
  <button onClick={onNewTab} title="New tab (Ctrl+N)" className="...">
    <Plus size={12} />
  </button>
  ```
- [x] **`frontend/src/components/layout/TabBar.tsx`** — aggiungere `onNewTab: () => void` alle `TabBarProps`
- [x] **`frontend/src/components/layout/MainArea.tsx`** — passare `newTab` da `useTabsStore` a `<TabBar>`

---

### 6. Body Editor — rimuovere Builder, JSON come primo formato con syntax highlight

**Sintomo attuale:**
- Selezionando body JSON, si apre il "Builder" (form key/type/value) come default — è utile solo per JSON piani; per tutto il resto è un ostacolo
- La textarea raw per JSON non ha syntax highlighting — tutto bianco su grigio
- Il body editor prende pochissimo spazio verticale (`min-h-[200px]`)

**Fix — cosa rimuovere:**
- [x] **`frontend/src/components/composer/BodyEditor.tsx`** — rimuovere completamente la funzione `JsonBuilder` e tutto il codice builder (righe ~77-245)
- [x] **`frontend/src/components/composer/BodyEditor.tsx`** — rimuovere dalla lista `BODY_TYPES` la voce `none` (sostituire con "no body" come stato implicito senza tab separata)
- [x] **`frontend/src/components/composer/BodyEditor.tsx`** — mettere `json` come **primo** elemento in `BODY_TYPES` e selezionarlo di default per POST/PUT/PATCH

**Fix — JSON editor migliorato:**
- [x] **Creare `frontend/src/components/ui/JsonEditor.tsx`** — textarea con syntax highlighting sovrapposto:
  - Implementazione: `<div>` con due layer sovrapposti — un `<pre>` colorato (non editabile, `pointer-events: none`) + una `<textarea>` trasparente sopra editabile (stessa tecnica di CodeFlask/simple-code-editor)
  - **Colori token JSON** (usando le CSS vars dell'app, non hardcoded):
    - Chiavi stringa `"key"`: `var(--color-json-key)` → blu/viola chiaro
    - Valori stringa `"value"`: `var(--color-json-string)` → verde
    - Numeri: `var(--color-json-number)` → arancione
    - `true` / `false`: `var(--color-json-bool)` → viola
    - `null`: `var(--color-json-null)` → grigio
    - Brackets `{}` e `[]` per livello di nesting: colori diversi per depth 0/1/2+ (es. bianco, giallo, ciano)
    - Punteggiatura `:` `,`: `text-text-3`
  - Pulsante "Prettify" già presente — tenerlo, renderlo prominente
  - Indicatore errore già presente (border rosso + messaggio) — tenerlo
- [x] **`frontend/src/components/composer/BodyEditor.tsx`** — sostituire la `<textarea>` raw del JSON con `<JsonEditor>`
- [x] **`frontend/src/components/composer/BodyEditor.tsx`** — aumentare altezza minima da `min-h-[200px]` a `min-h-[280px]` e permettere resize verticale fino a fill dello spazio disponibile (usare `flex-1` invece di min-h fisso)
- [x] Aggiungere le CSS vars per i colori JSON in `frontend/src/styles/globals.css` (una versione dark e una light)

---

### 7. WebSocket payload editor — stesso trattamento del body JSON

**Contesto:** `HttpMethod` include `'WS'` (`types.ts:39`). Quando il metodo è WS, il Composer mostra il body editor standard. I payload WS sono spesso JSON.

- [x] **`frontend/src/components/composer/Composer.tsx`** — quando `request.method === 'WS'`, passare al body editor un flag `isWebSocket` che:
  - Nasconde le tab `urlencoded` / `form-data` / `graphql` (non applicabili a WS)
  - Mostra JSON come unica opzione rilevante + Raw come fallback
- [x] **`frontend/src/components/composer/BodyEditor.tsx`** — accettare prop `isWebSocket?: boolean` e filtrare i `BODY_TYPES` di conseguenza
- [x] Riutilizzare `<JsonEditor>` creato al punto 6 anche per il payload WS

---

### 8. EnvBar: "Manage" nascosto senza environment attivo

Causa: `EnvBar.tsx:56` mostra "Manage" solo se `activeEnv` esiste.  
L'`EnvModal` funziona già senza un env selezionato.

- [x] **`frontend/src/components/environment/EnvBar.tsx`** — rimuovere la condizione `{activeEnv && ...}` attorno al pulsante "Manage" (mostrarlo sempre)
- [x] Rinominare il pulsante da "Manage" a "Environments" per chiarezza

---

## 🟢 BASSO — Polish / dopo

### 9. PanelHeader titleKey non passa per i18n

Causa: in `MainArea.tsx:161-178` i titleKey sono stringhe hardcoded (`'kafka'`, `'Dev Tools'`, ecc.).

- [x] **`frontend/src/components/layout/MainArea.tsx`** — far usare `useT().rail[titleKey]` nel `PanelHeader` con fallback alla stringa grezza

---

### 10. Welcome → Collections: focus URL bar mancante

Causa: cliccando "Send / Request" si crea una tab ma il cursore non va nell'URL bar del `Composer`.

- [x] **`frontend/src/components/composer/Composer.tsx`** — esporre un `ref` sull'URL bar o ascoltare un custom event `'adomnia:focus-url'`
- [x] **`frontend/src/components/layout/WelcomePanel.tsx`** — dopo `newTab()`, dispatchare l'evento per focalizzare l'URL bar

---

## Riepilogo stato

| # | Task | File principale | Stato |
|---|------|----------------|-------|
| 0a | Accent HEX: primary `#8B3DFF` | `globals.css` | ✅ |
| 0b | Accent HEX: dark `#5B21D6` | `globals.css` | ✅ |
| 0c | Accent HEX: light `#A855F7` | `globals.css` | ✅ |
| 0d | Accent hover + glow → HEX | `globals.css` | ✅ |
| 0e | Border-1 → `#1F2333` (scala bordi) | `globals.css` | ✅ |
| 0f | Method GET → `#8B3DFF` | `globals.css` | ✅ |
| 0g | Verifica visiva dark + light theme | — | ⬜ |
| 1a | `prompt()` in EnvBar | `EnvBar.tsx` | ✅ |
| 1b | `prompt()` in EnvModal | `EnvModal.tsx` | ✅ |
| 1c | `confirm()` in EnvModal | `EnvModal.tsx` | ✅ |
| 1d | `confirm()` in StoragePanel | `StoragePanel.tsx` | ✅ |
| 2a | Guard `loaded` in collections `save()` | `stores/collections.ts` | ✅ |
| 2b | Guard `loaded` in environments `save()` | `stores/environments.ts` | ✅ |
| 2c | Init sequence `loadForgeCoreDemo` | `App.tsx` | ✅ |
| 3a | Componente `VarHighlightInput` | `ui/VarHighlightInput.tsx` | ✅ |
| 3b | URL bar con var highlight | `Composer.tsx` | ✅ |
| 3c | KVEditor value column con var highlight | `KVEditor.tsx` | ✅ |
| 3d | Warning bar body con vars non risolte | `BodyEditor.tsx` | ✅ |
| 4a | Sentinel SESSION START in logs | `main.tsx` | ✅ |
| 4b | Clear backend logs dopo primo sync | `App.tsx` | ✅ |
| 4c | RecordFrontendLog solo warn/error | `main.tsx` | ✅ |
| 4d | Render visivo del sentinel | `DevLogOverlay.tsx` | ✅ |
| 5a | Tab pill redesign (X visibile, bordo active) | `TabBar.tsx` | ✅ |
| 5b | Pulsante "+" in TabBar | `TabBar.tsx` | ✅ |
| 5c | Passare `onNewTab` a TabBar | `MainArea.tsx` | ✅ |
| 6a | Rimuovere `JsonBuilder` | `BodyEditor.tsx` | ✅ |
| 6b | JSON come primo formato | `BodyEditor.tsx` | ✅ |
| 6c | Componente `JsonEditor` con syntax highlight | `ui/JsonEditor.tsx` | ✅ |
| 6d | CSS vars colori JSON in globals.css | `globals.css` | ✅ |
| 6e | Sostituire textarea JSON con `JsonEditor` | `BodyEditor.tsx` | ✅ |
| 6f | Aumentare altezza editor (flex-1) | `BodyEditor.tsx` | ✅ |
| 7a | Flag `isWebSocket` in Composer→BodyEditor | `Composer.tsx` | ✅ |
| 7b | Filtrare BODY_TYPES per WS | `BodyEditor.tsx` | ✅ |
| 7c | Riusare `JsonEditor` per payload WS | `BodyEditor.tsx` | ✅ |
| 8 | "Environments" sempre visibile | `EnvBar.tsx` | ✅ |
| 9 | PanelHeader i18n | `MainArea.tsx` | ✅ |
| 10a | Ref URL bar in Composer | `Composer.tsx` | ✅ |
| 10b | Dispatch focus da WelcomePanel | `WelcomePanel.tsx` | ✅ |

> Legenda stato: ⬜ da fare · 🔄 in corso · ✅ fatto
