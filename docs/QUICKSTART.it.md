# Usare adOmnia: dalla richiesta API al codice

Inizia da API Workspace. Go Studio serve quando vuoi eseguire e debuggare il tuo servizio; non è necessario per chiamare un'API esistente.

## 1. Crea e invia una richiesta

In API Workspace crea una collection e aggiungi una richiesta. Scegli metodo e URL, poi imposta Body, Headers, Params e autenticazione. Per un payload JSON seleziona il tipo JSON e controlla il content type richiesto dal servizio.

Premi SEND: leggi status, durata, body e header della risposta. Aggiungi le verifiche in Tests e salva la richiesta con un nome riconoscibile.

![Richiesta con risposta riuscita e handler collegato](screenshots/api-connected.png)

## 2. Imposta un environment

Crea una variabile `baseUrl` con l'indirizzo del servizio, seleziona l'environment e usa `{{baseUrl}}/api/records`. Il percorso è un esempio: scegli una route presente nel tuo servizio.

Workspace seleziona le collection; Environment seleziona le variabili; Hosts seleziona i profili host. Conserva credenziali nelle variabili private o nel vault e controlla gli export prima di condividerli.

## 3. Apri ed esegui il progetto Go

In Go Studio scegli File → Open Project e apri la cartella del servizio. Sono supportati moduli `go.mod`, workspace `go.work` e cartelle di progetto. Autorizza solo progetti di cui ti fidi: la fiducia abilita tooling e processi.

Seleziona SDK e configurazione Run del package principale. Avvia il servizio, leggi la porta nel console e aggiorna `baseUrl`. Se compare Connection refused, verifica prima servizio, porta e URL.

## 4. Segui la richiesta nel debugger

Metti un breakpoint nel handler. Avvia Debug oppure scegli Debug Request dalle azioni della richiesta API. Quando la richiesta raggiunge il breakpoint, controlla variabili, stack e goroutine; usa Step o Continue per arrivare alla risposta.

Se adOmnia riconosce la route, la barra HANDLER offre OPEN IN GO IDE. Route dinamiche o framework non supportati possono richiedere la configurazione manuale del debug.

![Go Studio fermo su un breakpoint](screenshots/go-debug-light.png)

## 5. Collega log, database e messaggi

La live session raccoglie le evidenze disponibili. SQL capture e broker watch richiedono configurazione esplicita: non compaiono automaticamente per ogni servizio. Apri una query in Database Studio o il topic in Broker Studio; aprire una query non significa eseguirla.

Save reproduction, quando disponibile, conserva richiesta ed evidenze per ripetere il problema. Controlla sempre i file prima di condividerli. I limiti dei trasporti sono descritti nella [guida Live Session](LIVE-SESSION.md).

## 6. Più progetti, un'unica istanza

Apri altri progetti dal selettore di Go Studio. Puoi passare da uno all'altro o scegliere Open Project in New Window per affiancarli. Prima di spostare un progetto salva o scarta le modifiche pendenti. IDE, API Workspace e altri studi usano la stessa applicazione e il suo backend.

Il progetto selezionato nella finestra principale viene ricordato per workspace nelle build che includono la correzione; le finestre separate mantengono il proprio progetto.

## Se qualcosa manca

| Problema | Cosa controllare |
| --- | --- |
| Nessuna risposta | Servizio avviato, porta, URL ed environment |
| Breakpoint ignorato | Debug attivo, progetto e handler corretti, route chiamata |
| HANDLER assente | Progetto caricato, route riconoscibile, metodo e percorso |
| SQL o messaggi assenti | Capture/watch configurati e trasporto supportato |
| Tool non disponibili | Fiducia del progetto, SDK, gopls e Delve |

[Guarda la demo da 0:38](https://www.youtube.com/watch?v=tefwLUadRr8&t=38s) · [Guida completa Go Studio](GO-STUDIO.md) · [Installazione](INSTALL.md)
