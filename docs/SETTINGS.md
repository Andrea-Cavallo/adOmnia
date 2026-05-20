# Settings Panel — Checklist

> Stato: `- [ ]` = da fare · `- [x]` = completato  
> Aggiorna questo file man mano che i task vengono completati.

---

## Infrastruttura (prerequisiti per tutto il resto)

- [x] **`frontend/src/stores/settings.ts`** — estendere `AppSettings` interface con tutti i nuovi campi (vedi sezioni sotto) e aggiornare `defaultSettings`
- [x] **`frontend/src/lib/i18n.ts`** — aggiungere chiavi EN + IT per ogni nuova label/desc
- [x] **`frontend/src/components/settings/SettingsPanel.tsx`** — allargare la sidebar sinistra da `w-44` a `w-52`, aggiungere icone accanto alle label delle sezioni
- [x] **`frontend/src/components/settings/SettingsPanel.tsx`** — aggiungere `SectionId` per ogni nuova sezione e relativo `case` nel render

---

## Sezione: General (estensione dell'esistente)

Campi esistenti (già implementati):
- [x] Restore tabs on startup
- [x] Show welcome on empty workspace
- [x] Confirm before closing dirty tabs

Campi mancanti:
- [x] **Default startup rail** — Select (già in `AppSettings.general.defaultStartupRail` nel store, ma non renderizzato nel panel)
- [x] **Auto-save interval** — Number input in ms (quanto aspettare prima di salvare automaticamente la tab corrente)
- [x] **Backup workspace on startup** — Toggle (crea copia `.adomnia` prima di sovrascrivere)
- [x] **Max concurrent requests** — Number (throttle globale richieste parallele)

---

## Sezione: Appearance (estensione dell'esistente)

Campi esistenti (già implementati):
- [x] Language (en/it)
- [x] Theme (dark/light)
- [x] Density (compact/comfortable/spacious)
- [x] Font size (small/medium/large)

Campi mancanti:
- [x] **Monospace font size** — già in `AppSettings.appearance.monoFontSize` nel store, **mai renderizzato** nel panel
- [x] **Sidebar width** — Number input (larghezza pannello collezioni in px)
- [x] **Show only icons in rail** — Toggle (nascondi label rail, solo icone)
- [x] **Accent color preset** — Select con preset colori (richiede estensione ThemeProvider)
- [x] **Link al ThemeEditor** — pulsante/link che porta alla sezione `/themes` per personalizzazione avanzata

---

## Sezione: Requests (estensione dell'esistente)

Campi esistenti (già implementati):
- [x] Default timeout (ms)
- [x] Follow redirects
- [x] Save responses to history
- [x] Max history per tab

Campi mancanti:
- [x] **Default HTTP method** — Select GET/POST per nuove tab vuote
- [x] **SSL/TLS verification** — Toggle "Skip certificate verification" (⚠️ mostrare warning visibile)
- [x] **Client certificate (mTLS)** — file picker PEM + passphrase (globale per tutte le richieste)
- [x] **Send cookies automatically** — Toggle cookie jar automatico
- [x] **Preserve cookies between tabs** — Toggle sessione cookie cross-tab
- [x] **Encode URL automatically** — Toggle percent-encoding automatico
- [x] **Trim whitespace in headers** — Toggle trim su chiavi e valori
- [x] **Max redirects** — Number (default 10, quanti 3xx seguire prima di fermarsi)
- [x] **Strip auth on redirect** — Toggle rimuove `Authorization` su redirect cross-domain

---

## Sezione: Network / Proxy *(NUOVA)*

> I campi nel backend (`proxySettingsState`) esistono già — vanno solo esposti e cablati.

- [x] Aggiungere `SectionId = 'proxy'` in `SettingsPanel.tsx`
- [x] **Default proxy port** — Number (porta usata all'avvio del proxy)
- [x] **Max traffic entries** — Number
- [x] **Request body limit (KB)** — Number
- [x] **Response body limit (KB)** — Number
- [x] **Upstream HTTP proxy** — Text `http://user:pass@host:port` (proxy corporate)
- [x] **No-proxy hosts** — Textarea (host da escludere dall'upstream proxy)
- [x] **Enable HTTPS interception** — Toggle
- [x] **Export proxy CA certificate** — Button (placeholder, da cablare al backend)

---

## Sezione: Mock Server Defaults *(NUOVA)*

- [x] Aggiungere `SectionId = 'mock'` in `SettingsPanel.tsx`
- [x] **Default mock port** — Number (porta di avvio del mock server)
- [x] **Default response delay (ms)** — Number (delay applicato a tutte le risposte mock)
- [x] **Mock server password** — Password con toggle eye
- [x] **CORS headers automatici** — Toggle (`Access-Control-Allow-*` automatici)
- [x] **Log hits to file** — Toggle (persiste hit log su file oltre che in memoria)

---

## Sezione: Vault *(NUOVA)*

- [x] Aggiungere `SectionId = 'vault'` in `SettingsPanel.tsx`
- [x] **Auto-lock timeout (min)** — Number
  - [x] Esporre la variabile `vaultTimeout` come configurabile dal backend (comandi Go `GetVaultTimeout` / `SetVaultTimeout` aggiunti in `app.go`)
- [x] **Lock vault on minimize** — Toggle (blocca quando la finestra si minimizza)
- [x] **Show vault entries in autocomplete** — Toggle (suggerisce segreti nei campi header/auth)

---

## Sezione: Editor *(NUOVA)*

- [x] Aggiungere `SectionId = 'editor'` in `SettingsPanel.tsx`
- [x] Aggiungere `editor` block in `AppSettings` e `defaultSettings`
- [x] **Tab size** — Select 2 / 4 / 8 spazi
- [x] **Soft tabs** — Toggle (spazi invece di tab)
- [x] **Word wrap** — Toggle (testo a capo nel body editor)
- [x] **Line numbers** — Toggle (numeri di riga nel code editor)
- [x] **Auto-close brackets** — Toggle (chiusura automatica `{}`, `[]`, `""`)
- [x] **Format response automatically** — Toggle (pretty-print JSON/XML alla ricezione)
- [x] **Response max render size (KB)** — Number (soglia oltre cui mostrare avviso invece del body raw)

---

## Sezione: Privacy & Data *(NUOVA)*

- [x] Aggiungere `SectionId = 'privacy'` in `SettingsPanel.tsx`
- [x] **Storage usage badge** — display read-only con stima KB usati su localStorage
- [x] **Clear response history** — Button danger con `<ConfirmDialog>` (svuota cronologia risposte)
- [x] **Export settings** — Button (scarica `adomnia-settings.json`)
- [x] **Import settings** — Button file picker (importa settings da JSON)
- [x] **Reset to defaults** — Button danger con `<ConfirmDialog>` (ripristina tutti i default)
- [x] **Clear all data** — Button danger con `<ConfirmDialog>` (reset completo)
- [x] Tutti i button danger stanno in un blocco `Danger Zone` con bordo rosso e icona Shield

---

## Sezione: Keyboard Shortcuts *(NUOVA)*

- [x] Aggiungere `SectionId = 'shortcuts'` in `SettingsPanel.tsx`
- [x] Rendere la lista visualizzabile read-only
- [x] **Send request** — `Ctrl+Enter`
- [x] **New tab** — `Ctrl+N`
- [x] **Close tab** — `Ctrl+W`
- [x] **Save tab** — `Ctrl+S`
- [x] **Focus URL bar** — `Ctrl+L`
- [x] **Toggle sidebar** — `Ctrl+B`
- [x] **Open settings** — `Ctrl+,`
- [x] **Open collections** — `Ctrl+1`
- [x] **Switch to next tab** — `Ctrl+Tab`
- [x] **Open dev logs** — `Ctrl+Shift+D`
- [ ] *(v2)* Aggiungere personalizzazione shortcut con input key binding

---

## Sezione: About *(NUOVA)*

- [x] Aggiungere `SectionId = 'about'` in `SettingsPanel.tsx`
- [x] **Logo + nome** — display statico con `/logo.png` e nome app
- [x] **Versione** — hardcoded `0.1.0` (da injettare a build time)
- [x] **Build date / commit hash** — placeholder `Unknown` (da injettare a build time)
- [x] **Stack info** — Wails · Go · React
- [x] **Link GitHub** — link esterno a `github.com/anomalyco/adomnia`
- [x] **Open source licenses** — lista espandibile delle dipendenze

---

## Sezione: Developer / Debug *(NUOVA, solo se `isDev=true`)*

- [x] Aggiungere `SectionId = 'developer'` in `SettingsPanel.tsx`
- [x] Mostrare la sezione solo quando `isDev` è true — cablato a backend `IsDevMode()`
- [x] **Dev logging** — Toggle cablato a backend `SetDevMode(bool)`
  - [x] Rendere `isDev` configurabile runtime (comando Go `SetDevMode(bool)` aggiunto in `app.go`)
- [x] **Open dev logs folder** — Button cablato a backend `OpenDevLogsFolder()`
- [x] **Clear dev logs** — Button cablato a `ClearDevLogs()` backend
- [x] **Show performance overlay** — Toggle (placeholder, non ancora implementato)

---

## Refactoring strutturale del pannello

- [x] Allargare sidebar sinistra da `w-44` a `w-52` per contenere label più lunghe
- [x] Aggiungere icone alle voci della sidebar (lucide-react)
- [x] Aggiungere titolo + sottotitolo in ogni sezione (`SectionHeader`)
- [x] Raggruppare i campi in card visive all'interno delle sezioni (`SettingsCard`)
- [x] Usare `<input type="password">` con toggle eye per i campi password (`PasswordInput`)
- [x] Creare blocco "Danger Zone" visivamente distinto (bordo rosso) per azioni distruttive (`DangerZone`)
- [x] *(v2)* Campo di ricerca in cima alla sidebar per filtrare le impostazioni
- [x] *(v2)* Badge punto su sezioni con modifiche non salvate

---

## Riepilogo stato per sezione

| Sezione | Campi esistenti | Campi da aggiungere | Stato |
|---------|:--------------:|:------------------:|-------|
| General | 3 | 4 | ✅ fatto |
| Appearance | 4 | 5 | ✅ fatto |
| Requests | 4 | 9 | ✅ fatto |
| Network / Proxy | 0 | 8 | ✅ fatto |
| Mock Defaults | 0 | 5 | ✅ fatto |
| Vault | 0 | 3 | ✅ fatto |
| Editor | 0 | 7 | ✅ fatto |
| Privacy & Data | 0 | 6 | ✅ fatto |
| Keyboard Shortcuts | 0 | 10 | ✅ fatto |
| About | 0 | 6 | ✅ fatto |
| Developer / Debug | 0 | 4 | ✅ fatto |

> Legenda stato: ⬜ da fare · 🔄 in corso · ✅ fatto
> **Nota:** Tutte le sezioni completate. Resta solo l'implementazione del performance overlay nella sezione Developer.
