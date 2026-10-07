# Workspace modulare di adOmnia

## Obiettivo

Editor, console, terminali, log e chat possono affiancarsi o vivere su un altro monitor. Spostare una vista mantiene il processo e la conversazione del progetto. Il primo blocco riguarda Go Studio; i moduli adOmnia già staccabili continuano a usare il proprio flusso.

## Primo blocco implementato — 2026-10-07

- [x] Controlli comuni per Run output, Terminal, Service logs, Copilot e milk: posizione, ingrandimento/ripristino e finestra nativa.
- [x] Posizioni Bottom / Left / Right; output e log possono affiancarsi.
- [x] Il layout usa celle CSS grid stabili: cambiare posizione o ingrandire non smonta editor e terminale.
- [x] Il manager `internal/panelwindow` gestisce anche le finestre degli strumenti, una per sessione/strumento, con identificatori validati.
- [x] Il progetto possiede lo stato Run/AI. Le finestre degli strumenti ricevono snapshot locali tramite eventi Wails e inoltrano comandi esplicitamente supportati al proprietario.
- [x] Le azioni Run vengono verificate rispetto alle esecuzioni della sessione; il root della chat viene risolto dal progetto proprietario.
- [x] Invio chat confermato subito; lo streaming continua nello store proprietario.
- [x] Bozze chat, filtro/stdin console e scelta/split/ricerca terminale restano in memoria durante distacco e riaggancio.
- [x] La cronologia PTY viene trasferita con un checkpoint di sequenza: gli eventi arrivati durante il bootstrap non vengono duplicati. Il PTY resta nel backend.
- [x] Chiusura della finestra e Bring back restituiscono la vista; la chiusura/spostamento del progetto chiude le sue finestre degli strumenti.
- [x] Posizioni salvate localmente per sessione; schema IDE e workspace invariati. Nuova chiave opzionale `adomnia.studio.toolLayout.v1`, nessuna migrazione dei dati esistenti.

- [x] Distaccare uno strumento elimina la sua colonna/riga dal layout: codice e strumenti rimasti si allargano automaticamente, senza segnaposto; il riaggancio ripristina la posizione.

### Verifica

- [x] TypeScript, frontend build, budget startup (636.554 byte, sotto 650 kB) e build Go.
- [x] Test identificatori native tool windows; test isolamento bozze/filtri; test bootstrap PTY senza duplicati; test routing proprietario/esecuzione e invio AI con streaming ancora aperto.
- [x] Suite frontend completa: 260 file e 1.154 test passati. Test Go dei manager `internal/panelwindow` e `internal/goidewindow` passati.
- [x] Osservata la finestra Copilot nativa con progetto e stato provider corretti; dopo la sua chiusura la finestra principale era ancora aperta.
- [ ] Collaudo nativo completo: terminale con lo stesso PID/output prima e dopo distacco; filtro log conservato; risposta AI in streaming durante distacco/riaggancio; ingrandimento/ripristino e posizione su secondo monitor.

Il collaudo nativo completo resta distinto dai test automatici; non si considera dimostrato soltanto perché la build si avvia.
L'app Windows è stata avviata con `wails3 task dev`; ulteriori input di collaudo sono stati interrotti dal rilevamento di input utente nella finestra, poi trovata minimizzata. Non sono stati inviati prompt AI né digitati comandi di shell durante il collaudo UI dell'agente.

## Blocchi successivi

- [ ] Dimensioni indipendenti e persistenza dei bounds delle finestre, con recupero quando cambia il numero di monitor.
- [ ] Trascinamento con anteprima delle aree di docking.
- [ ] Gruppi di schede arbitrari e divisioni annidate.
- [ ] Layout nominati per progetto: Coding, Debug, API, Observability; esportazione locale e Reset layout.
- [ ] Estensione del contenitore comune a Database, Broker, API, Debug e agli altri moduli.
- [ ] Gestione esplicita di riavvio/crash della finestra proprietaria e riconnessione delle viste.

## Confini

Service logs è una vista del vero stdout/stderr della Run selezionata, non un ricevitore OTLP né una nuova acquisizione di log. Le conversazioni AI continuano a usare la configurazione e le autorizzazioni esistenti: staccare una vista non invia un prompt. Bozze e output condivisi restano nella memoria del processo/UI; solo le posizioni vengono persistite dalla nuova funzionalità.
