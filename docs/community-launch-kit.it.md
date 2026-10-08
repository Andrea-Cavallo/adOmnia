# adOmnia — testi per forum e community

Preparato il 7 ottobre 2026. Bozze da pubblicare dal profilo dell'autore.

## Messaggio principale

Un IDE Go e una toolbox API nella stessa app desktop locale, con console, log e
chat staccabili in finestre indipendenti. Il valore da mostrare è il percorso
codice → servizio → richiesta → debug, con meno passaggi tra applicazioni.

Il repository usa licenza MIT. L'app non richiede un account adOmnia; le funzioni
AI sono opzionali e possono richiedere account e servizi del provider scelto.
Non presentare il progetto come una sostituzione completa di ogni IDE o client
API: chiedere feedback su un flusso concreto, dichiarando che è ancora in sviluppo.

## Dove iniziare

1. **r/golang — Small Projects.** Primo commento breve nel thread dedicato,
   che invita alla condivisione di progetti legati a Go. Thread trovato:
   https://www.reddit.com/r/golang/comments/1wyh354/small_projects/
   Controllare che sia ancora il thread corrente al momento della pubblicazione.
2. **Go Forum — Releases.** La descrizione della categoria ammette annunci di
   release di progetti Go: https://forum.golangbridge.org/categories
   Regole: https://forum.golangbridge.org/guidelines
   Pubblicare un solo topic nella categoria appropriata; evitare duplicati.
3. **Hacker News — Show HN.** Presentare qualcosa di proprio che gli utenti
   possano provare; titolo con prefisso Show HN e presenza dell'autore per
   rispondere. Regole: https://news.ycombinator.com/showhn.html
   Non chiedere voti o commenti coordinati.

**r/SideProject è una possibilità secondaria:** la pagina ufficiale delle regole
non ha esposto il testo durante la verifica. Leggere sidebar e regole nel proprio
account prima di scegliere questo canale; non considerare verificate le indicazioni
dei siti di marketing esterni.

## 1. Commento r/golang — Small Projects

I'm building **adOmnia**, an MIT-licensed desktop app combining a Go IDE and an
API toolbox. The goal is to keep editing, running a service, testing its API
and inspecting logs in one workspace.

It uses Go/Wails and React, with gopls, Delve, an API client, database and broker
tools. The workspace is now modular: output, terminal, logs and AI chats can
detach into native windows, while the editor expands into the freed space.

It's still evolving. I'd appreciate feedback on the Go editing/debugging
workflow and what would make the integrated API tools useful in your daily work.

Source and downloads: https://github.com/Andrea-Cavallo/adOmnia

## 2. Topic Go Forum — Releases

**Titolo:** adOmnia: an open-source Go IDE and API toolbox with detachable tool windows

Hi everyone, I'm the author of **adOmnia**, a local-first desktop developer
toolbox built with Go, Wails and React, released under the MIT license.

The goal is to bring the Go service and the tools used to test it into the same
workspace. Go editing uses gopls; debugging uses Delve. The app also includes
REST, GraphQL, SOAP and gRPC tooling, database explorers, broker clients and logs.

I've recently added a modular workspace. Run output, Terminal, service logs,
Copilot Chat and milk can move between the left, right and bottom areas,
maximize, or detach into native windows. Detaching a tool frees its space in
the main IDE automatically.

The core app requires no adOmnia account. AI integrations are optional and use
the provider you configure. The project is still developing; arbitrary drag
docking and some advanced window-layout features remain work in progress.

I'd especially like feedback from Go developers on the edit → run → API test
→ debug workflow, and reports of anything that feels awkward or unreliable.

Source: https://github.com/Andrea-Cavallo/adOmnia

Downloads: https://github.com/Andrea-Cavallo/adOmnia/releases/latest

## 3. Show HN

**Titolo:** Show HN: adOmnia – A local-first Go IDE and API toolbox

**URL da inviare:** https://github.com/Andrea-Cavallo/adOmnia

**Primo commento dell'autore:**

Hi HN, I'm the author of adOmnia, an MIT-licensed desktop app built with Go,
Wails and React.

The idea is to keep the tools around a Go service in one workspace: edit with
gopls, debug with Delve, call its API, and inspect databases, messages and logs.

The workspace now supports detachable output, terminal, log and AI-chat views.
Detaching a view removes it from the main IDE and gives the editor and remaining
tools the freed space.

The app requires no adOmnia account and has no telemetry. AI features are
optional and may use external providers. There are Windows, macOS and Linux
downloads in GitHub Releases, with platform requirements documented in the repo.

It's still evolving. I'd love feedback on whether combining the IDE and API
workflow helps, and where separate tools still serve you better.

Download: https://github.com/Andrea-Cavallo/adOmnia/releases/latest

## Versione italiana breve

Sto sviluppando **adOmnia**, un'app desktop open source con licenza MIT che
riunisce un IDE Go e gli strumenti per testare e osservare le API.

Integra gopls, Delve, client REST/GraphQL/SOAP/gRPC, database, broker e log.
Il workspace è modulare: console, terminale, log e chat AI possono essere
staccati in finestre indipendenti; l'editor si allarga automaticamente.

Non serve un account adOmnia. Le integrazioni AI sono facoltative e usano il
provider configurato. Il progetto è ancora in sviluppo: cerco feedback sul
flusso codice → esecuzione → richiesta API → debug e segnalazioni concrete.

Codice e download: https://github.com/Andrea-Cavallo/adOmnia

## Demo da accompagnare al post

Registrare un video di 30–45 secondi con dati dimostrativi:

1. Aprire un piccolo progetto Go e avviare un servizio locale.
2. Chiamare un endpoint dall'API Workspace.
3. Mostrare il codice e il relativo output.
4. Staccare la chat o l'output e mostrare l'editor che si allarga.
5. Riagganciare lo strumento.

Mostrare solo azioni riuscite nella build usata. Evitare credenziali, repository
privati e conversazioni personali. Uno screenshot reale può accompagnare il
video; non serve una grafica che simuli funzionalità.

## Sequenza suggerita

- Iniziare con il commento Small Projects e rispondere alle osservazioni.
- Pubblicare il topic Go Forum con uno screenshot e una release scaricabile.
- Preparare Show HN dopo aver controllato il percorso di installazione e la demo.
- Annotare link del post, commenti utili, problemi riproducibili e contributori.
  Le stelle GitHub sono un segnale secondario: il primo obiettivo sono persone
  che provano il prodotto e spiegano dove il flusso funziona o si interrompe.

Al momento della preparazione, l'ultima release pubblicata verificata era
v0.9.67; il tag v0.9.68 era già presente, ma la relativa release non era ancora
disponibile. I testi usano quindi link stabili e non promettono il download di
una versione non ancora pubblicata. Verificare nuovamente prima del post.
