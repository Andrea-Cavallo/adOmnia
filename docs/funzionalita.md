# adOmnia — Catalogo Funzionalità

**adOmnia** è un API Development Toolbox desktop, local-first, costruito con Go (Wails) + React 18 (TypeScript).  
Tutte le funzionalità sono offline-first: nessun account, nessuna telemetria, nessun dato inviato fuori dalla macchina.

---

## INDICE MACRO-CATEGORIE

| # | Categoria | Sezioni | Funzionalità |
|---|-----------|---------|-------------|
| A | [API Core](#a-api-core) | HTTP Client, Autenticazione, Assertions, Runner, Flows, Matrix, Test Data | ~74 |
| B | [Protocolli & Streaming](#b-protocolli--streaming) | gRPC, SOAP, WebSocket, SSE, Broker Studio | ~65 |
| C | [Infrastruttura & Simulazione](#c-infrastruttura--simulazione) | Mock Server, Proxy/Interceptor, Docker Lab, Load Testing | ~44 |
| D | [Debugging & Analisi](#d-debugging--analisi) | Browser Debug (+ Discovery), HAR Viewer, Network Tools, JSON Tools, XML Tools, Power Tools, Dev Logs, Observability, Secret Scanner | ~90 |
| E | [Dati Locali](#e-dati-locali) | Database Studio, Storage Inspector, Workspace, Vault, Markdown | ~44 |
| F | [Personalizzazione & Estendibilità](#f-personalizzazione--estendibilità) | Temi, Plugin WASM, Template, Python Plugin SDK | ~51 |
| G | [Piattaforma](#g-piattaforma) | Impostazioni, Infrastruttura, UI Framework | ~76 |

---

## A. API CORE

### A1. Client HTTP & Collezioni

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| A1.1 | **Composer Richieste** | Builder HTTP completo: selettore metodo (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, CONNECT, TRACE), barra URL con highlight variabili, pulsanti Invia / Salva / Load-Test. |
| A1.2 | **Query Parameters** | Editor key-value con toggle abilita/disabilita, aggiunta/rimozione righe, sostituzione variabili `{{var}}`. |
| A1.3 | **Headers HTTP** | Editor key-value con toggle, suggerimenti header comuni e sostituzione variabili. |
| A1.4 | **Body Editor — Raw** | Editor multi-tipo: JSON, XML, Text, HTML, JavaScript con syntax highlighting e varianti multiple per richiesta. |
| A1.5 | **Body Editor — Form** | URL-Encoded e Form Data multipart con editor coppie chiave-valore. |
| A1.6 | **Body Editor — GraphQL** | Editor query GraphQL con editor variabili separato. |
| A1.7 | **Script Pre/Post Richiesta** | Editor script pre-request e post-response con API `pm.*` compatibile Postman. |
| A1.8 | **Visualizzatore Risposta** | Badge stato colorato, metriche dimensione/tempo, body JSON con syntax highlighting e token espandibili, vista raw, vista headers, copia negli appunti. |
| A1.9 | **Cronologia Risposte** | Navigazione tra risposte precedenti per tab, numero massimo configurabile. |
| A1.10 | **Generazione Codice** | Snippet equivalente in 13 linguaggi: cURL, JavaScript, Node.js, Python, Go, PHP, C#, Java, Ruby, Rust, Swift, Kotlin, Shell. |
| A1.11 | **Import cURL** | Parser comandi cURL: estrae metodo, URL, headers, body, auth (Bearer, Basic). |
| A1.12 | **Albero Collezioni** | Organizzazione gerarchica cartelle/richieste, ricerca, menu contestuali CRUD, colori per collezione. |
| A1.13 | **Drag & Drop Riordino** | Riordina richieste e cartelle trascinando nell'albero. |
| A1.13b | **Drag & Drop Import** | Trascina file .json/.yaml/.adomnia ovunque nella finestra per importare istantaneamente collection (Postman, Insomnia, Bruno, OpenAPI, adOmnia). Overlay visivo + feedback toast. |
| A1.14 | **Gestione Tab** | Navigazione multi-tab, indicatore dirty-state, chiudi/chiudi-altri/chiudi-tutti, pinning, riordina tab. |
| A1.15 | **Sostituzione Variabili** | Risoluzione `{{nomeVariabile}}` dall'ambiente attivo in URL, headers, params, body, auth, prima di ogni richiesta. |
| A1.16 | **Input Highlight Variabili** | Campo URL evidenzia visivamente i pattern `{{variabile}}` inline. |
| A1.17 | **Timeout & Redirect** | Timeout configurabile per richiesta, toggle segui/blocca redirect, max redirect configurabile. |
| A1.18 | **Workspace Demo adOmnia Lab** | Workspace demo precaricato con collezioni e ambienti di esempio. |

---

### A2. Autenticazione

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| A2.1 | **Nessuna Auth** | Richiesta senza autenticazione (default). |
| A2.2 | **Bearer Token** | Header `Authorization: Bearer <token>`. |
| A2.3 | **Basic Auth** | HTTP Basic con username/password, codifica Base64 automatica. |
| A2.4 | **API Key (Header/Query)** | Autenticazione via header personalizzato o query param. |
| A2.5 | **OAuth 2.0** | Grant type, token URL, auth URL, client ID/secret, scope, redirect URI, refresh token, tracciamento scadenza. |
| A2.6 | **AWS Signature v4** | Firma AWS4: access key, secret key, regione, servizio, token di sessione opzionale. |
| A2.7 | **Digest Auth** | HTTP Digest con challenge-response. |

---

### A3. Assertions Editor

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| A3.1 | **Target Assertion** | Scegli su cosa asserire: Status Code, Response Time, Header, Body Text, JSON Path, Array Length, XML Path, Content-Type, Schema. |
| A3.2 | **Operatori** | eq, neq, gt, lt, gte, lte, contains, !contains, matches, exists, type. |
| A3.3 | **Input Contestuali** | Campi specifici per target: path per JSON/XML, nome header, valore atteso, type selector (string/number/boolean/object/array). |
| A3.4 | **Enable/Disable per Assertion** | Toggle singola assertion senza eliminarla. |
| A3.5 | **Export Snippet Postman** | Copia assertion come snippet pm.expect compatibile Postman. |
| A3.6 | **Stato Empty** | Messaggio guida quando nessuna assertion è definita. |

---

### A4. Runner (Esecuzione Suite)

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| A4.1 | **Selezione Scope** | Esegui una singola richiesta, una cartella o un'intera collection. |
| A4.2 | **Iterazioni** | Numero iterazioni configurabile (1–999). |
| A4.3 | **Delay tra Richieste** | Pausa in millisecondi tra ogni richiesta. |
| A4.4 | **Retry** | Numero di tentativi in caso di fallimento (0–9). |
| A4.5 | **Stop on Failure** | Interrompe l'esecuzione al primo errore. |
| A4.6 | **Dataset CSV/JSON** | Carica dati di test CSV o JSON; le variabili del dataset sostituiscono le variabili della richiesta per ogni iterazione. |
| A4.7 | **Progress Bar** | Barra avanzamento con percentuale di completamento in tempo reale. |
| A4.8 | **Log per Richiesta** | Per ogni request: icona pass/fail, indice, metodo, status code, durata ms, nome, messaggio errore. |
| A4.9 | **Summary Finale** | Totale passati/falliti, durata totale, durata media per richiesta. |
| A4.10 | **Export Report** | Esporta risultati in Markdown, HTML, JSON, JUnit XML. |
| A4.11 | **Assertions nel Runner** | Le assertions definite sulle richieste vengono valutate ad ogni iterazione; i contatori pass/fail sono inclusi nel report. |

---

### A5. Flows (Workflow Multi-Step)

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| A5.1 | **Step Request** | Aggiungi step con nome, metodo HTTP, URL e body (POST/PUT/PATCH). |
| A5.2 | **Esecuzione Sequenziale** | Esegui il flow dall'inizio alla fine, oppure singolo step isolato. |
| A5.3 | **Stato per Step** | Indicatore idle / running / ok / error con messaggio errore e durata. |
| A5.4 | **Estrazione Variabili** | Estrai automaticamente variabili dalle risposte per passarle agli step successivi. |
| A5.5 | **Variabili Ambiente** | Sostituisce variabili `{{var}}` dall'ambiente attivo in URL e body. |
| A5.6 | **Assertions per Step** | Assertions configurate sulle richieste vengono valutate per ogni step. |
| A5.7 | **Gestione Step CRUD** | Aggiungi, rinomina, elimina, riordina step. |
| A5.8 | **Salva / Carica Flow** | Persiste flow con nome in localStorage; sidebar flow salvati con timestamp. |
| A5.9 | **Pannello Variabili** | Sidebar mostra le variabili estratte dai run con chiave/valore. |
| A5.10 | **Pannello Ultimo Run** | Sidebar risultati: status, durata, pass/fail assertions, errore per step. |
| A5.11 | **Mock Recorder Inline** | Registra richiesta/risposta reale e crea automaticamente un endpoint mock (metodo, URL reale, path mock). |
| A5.12 | **Export Flow JSON** | Esporta definizione flow come file JSON. |
| A5.13 | **Export Report Markdown** | Esporta risultato dell'ultimo run come report Markdown. |

---

### A6. Environment Matrix (Test Cross-Ambiente)

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| A6.1 | **Modalità** | Esegui in matrix mode: singola richiesta, collection completa o flow multi-step. |
| A6.2 | **Selezione Ambienti** | Checkbox multi-selezione degli ambienti disponibili; ogni spunta aggiunge una colonna al risultato. |
| A6.3 | **Esclusione Campi** | Lista campi da escludere dal confronto (separati da virgola o newline). |
| A6.4 | **Configurazione Flow** | Editor step inline (metodo, URL, body) per la modalità flow senza aprire il pannello Flows. |
| A6.5 | **Esecuzione Parallela** | Lancia le stesse richieste su tutti gli ambienti selezionati in parallelo. |
| A6.6 | **Tabella Risultati** | Colonne: item, ambiente, status HTTP, durata ms, dimensione bytes, Content-Type. |
| A6.7 | **Rilevamento Differenze** | Confronta i valori per campo tra ambienti; evidenzia differenze con badge critical/normal. |
| A6.8 | **Contatori Anomalie** | Badge con conteggio errori, risposte lente e risposte pesanti. |
| A6.9 | **Salva Configurazione** | Persiste l'ultima configurazione matrix. |
| A6.10 | **Export** | Esporta risultati in Markdown, HTML, JSON completo, JSON raw. |

---

### A7. Test Data Studio

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| A7.1 | **Generatori — Persona** | Nome, Cognome, Email, Username. |
| A7.2 | **Generatori — Contatto** | Telefono. |
| A7.3 | **Generatori — Tech** | Indirizzo IP, UUID v4. |
| A7.4 | **Generatori — Generale** | Data, Intero, Float, Boolean. |
| A7.5 | **Generatori — Finance** | IBAN. |
| A7.6 | **Generatori — Italia** | Codice Fiscale, Partita IVA. |
| A7.7 | **Generatori — Indirizzo** | Via, Città, Provincia, CAP. |
| A7.8 | **Generatori — Testo** | Lorem Ipsum. |
| A7.9 | **Generatori — Commerce** | Prodotto, Descrizione. |
| A7.10 | **Valore Costante** | Tipo "Custom": inserisci valore fisso per ogni riga. |
| A7.11 | **Configura Campi** | Aggiungi/rimuovi/rinomina campi; scegli generatore per campo. |
| A7.12 | **Numero Righe** | Configura quante righe generare (1–9999). |
| A7.13 | **Output JSON / CSV** | Toggle formato output; anteprima inline. |
| A7.14 | **Download** | Scarica il dataset generato come file. |
| A7.15 | **Copia** | Copia output negli appunti. |
| A7.16 | **Invia al Runner** | Apre direttamente il Runner con il dataset generato precaricato. |
| A7.17 | **Preset** | Salva/carica configurazione campi con nome; sidebar mostra conteggio campi e record. |

---

## B. PROTOCOLLI & STREAMING

### B1. Client gRPC

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| B1.1 | **Server Reflection** | Connettiti a un server gRPC e ottieni automaticamente la lista di servizi e metodi. |
| B1.2 | **Method Discovery** | Per ogni metodo: nome, tipo input, tipo output, flag client streaming, flag server streaming. |
| B1.3 | **Message Schema** | Descrive un tipo protobuf: campi, tipo, numero, flag repeated. |
| B1.4 | **Unary Invoke** | Invoca metodo gRPC unario con payload JSON; timing misurato. |
| B1.5 | **Supporto TLS** | Toggle TLS on/off per la connessione. |
| B1.6 | **Metadata Headers** | Editor key-value per metadata gRPC custom (inviati con ogni richiesta). |
| B1.7 | **Prettify Payload** | Formatta JSON nel payload con indentazione. |
| B1.8 | **Presets Connessione** | Salva indirizzo+TLS come preset locale; chip per caricamento rapido. |
| B1.9 | **Warning Streaming** | Badge informativo per metodi streaming (al momento solo unary mode). |
| B1.10 | **Copia Risposta** | Copia risposta JSON negli appunti. |

---

### B2. SOAP Studio

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| B2.1 | **Import WSDL da File** | Carica file WSDL locale e analizza la struttura del servizio. |
| B2.2 | **Import WSDL da URL** | Scarica e analizza WSDL da URL remoto con gestione errori leggibile. |
| B2.3 | **Import WSDL da Testo** | Incolla direttamente XML WSDL nel campo testo. |
| B2.4 | **Navigatore Servizio/Port/Operation** | Sidebar con struttura ad albero; seleziona operation per precompilare envelope. |
| B2.5 | **SOAP 1.1 e 1.2** | Selettore versione SOAP; imposta Content-Type e SOAPAction corretti. |
| B2.6 | **WS-Security UsernameToken** | Aggiunge header WS-Security con username/password all'envelope. |
| B2.7 | **Custom SOAP Headers** | Editor key-value per intestazioni SOAP personalizzate. |
| B2.8 | **Generazione Envelope** | Genera automaticamente envelope SOAP dallo schema dell'operazione selezionata. |
| B2.9 | **Editor Envelope** | Textarea per modificare manualmente l'envelope prima dell'invio. |
| B2.10 | **Invio Richiesta** | Invia l'envelope SOAP con stato di caricamento e gestione errori. |
| B2.11 | **Risposta XML/JSON** | Visualizza risposta in modalità XML o JSON; validazione XML con indicatore. |
| B2.12 | **Metriche Risposta** | Badge status HTTP, tempo di risposta ms, dimensione bytes. |
| B2.13 | **Copia Risposta** | Copia risposta negli appunti. |
| B2.14 | **Export cURL** | Genera comando cURL equivalente alla richiesta SOAP. |
| B2.15 | **Genera Codice Client** | Snippet Python e Node.js per la chiamata SOAP. |
| B2.16 | **Cronologia Richieste** | Sidebar con le ultime 10 richieste; click per ricaricare. |
| B2.17 | **Salva in Collection** | Salva l'operation come richiesta nella collection attiva. |

---

### B3. Client WebSocket

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| B3.1 | **Connessione / Disconnessione** | Apri e chiudi connessione WebSocket con indicatore stato colorato. |
| B3.2 | **Autenticazione** | Supporto auth: none, Bearer token, Basic. |
| B3.3 | **Custom Headers** | Editor header con toggle abilita/disabilita; badge conteggio header attivi. |
| B3.4 | **Auto-Reconnect** | Riconnessione automatica con delay configurabile in secondi. |
| B3.5 | **Modalità Messaggio** | Toggle Text / JSON con prettify automatico. |
| B3.6 | **Invia Messaggio** | Pulsante Invia e shortcut Enter (Shift+Enter per newline). |
| B3.7 | **Ping** | Pulsante Ping disponibile quando connesso. |
| B3.8 | **Log Messaggi** | Visualizza messaggi inbound/outbound/system con tipo (message/ping/pong/close/error), timestamp, payload JSON espandibile. |
| B3.9 | **Copia Payload** | Copia payload di singolo messaggio negli appunti. |
| B3.10 | **Auto-Scroll** | Scorre automaticamente all'ultimo messaggio ricevuto. |
| B3.11 | **Export Conversazione** | Esporta l'intera sessione di messaggi come JSONL. |
| B3.12 | **Script On-Message** | Esegui JavaScript in-browser su ogni messaggio inbound; errori di esecuzione mostrati inline. |
| B3.13 | **Mock WebSocket Server — Avvio/Stop** | Avvia server WebSocket mock locale su porta configurabile; pulsante auto-connect. |
| B3.14 | **Mock WebSocket Server — Regole** | Regole risposta con condition type (any, exact match, contains, regex, JSONPath), risposta JSLT-lite (`{{.field}}`, `{{$MSG}}`, `{{$NOW}}`, `{{$UUID}}`), delay ms. |
| B3.15 | **Mock WebSocket Server — Hit Log** | Log match con preview messaggio in entrata e risposta generata. |

---

### B4. SSE Client (Server-Sent Events)

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| B4.1 | **Connessione / Disconnessione** | Avvia e interrompi stream SSE con indicatore stato (connected/connecting/disconnected/error). |
| B4.2 | **Autenticazione** | None, Bearer token, Basic auth. |
| B4.3 | **Custom Headers** | Editor con toggle abilita/disabilita per ogni header. |
| B4.4 | **Sostituzione Variabili** | Supporto `{{var}}` nell'URL e negli header. |
| B4.5 | **Pausa / Riprendi** | Sospendi la cattura buffering gli eventi; riprendi mostrandoli tutti. Contatore eventi in buffer. |
| B4.6 | **Filtro per Tipo Evento** | Dropdown per filtrare gli eventi per tipo (event field). |
| B4.7 | **Ricerca Payload** | Campo testo per filtrare eventi per contenuto payload. |
| B4.8 | **Contatori** | Totale eventi ricevuti e visibili (post-filtro). |
| B4.9 | **Card Evento** | Mostra timestamp, tipo, event ID, flag retry, payload con pretty-print toggle. |
| B4.10 | **Copia Payload** | Copia payload del singolo evento. |
| B4.11 | **Clear Tutti** | Svuota il log eventi. |
| B4.12 | **Salva Stream** | Persiste sessione corrente con timestamp in localStorage. |
| B4.13 | **Sidebar Stream Salvati** | Lista stream salvati con eliminazione; click per caricare. |
| B4.14 | **Replay Stream** | Ricarica e riproduce un stream salvato. |
| B4.15 | **Export JSONL** | Esporta tutti gli eventi visibili come file JSONL. |

---

### B5. Broker Studio

#### B5.0 Shared — Funzionalità comuni a tutti i protocolli

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| B5.0.1 | **Selettore Protocollo** | Sidebar con tab Kafka / RabbitMQ / MQTT / Redis / NATS; colori distinti per protocollo. |
| B5.0.2 | **Message Log Condiviso** | Pannello destro raccoglie i messaggi consumati da tutti i protocolli: timestamp, topic, content, headers, metadata. |
| B5.0.3 | **Espansione Messaggio** | Click per espandere un messaggio: payload, headers, metadata, visualizzazione JSON con JsonGraph. |
| B5.0.4 | **Export Messaggi** | Esporta tutti i messaggi del log come JSON. |
| B5.0.5 | **Preset Messaggi** | Salva/carica/elimina preset messaggi per protocollo via backend bbolt. |
| B5.0.6 | **Contatore Messaggi** | Badge con numero messaggi nel log; pulsante clear. |
| B5.0.7 | **Stato Backend** | Indicatore connessione al sidecar locale con porta. |
| B5.0.8 | **Note Credenziali** | Banner che ricorda che le credenziali restano locali. |

#### B5.1 Kafka

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| B5.1.1 | **Produce** | Pubblica messaggio su topic: key, value, headers personalizzati, partizione opzionale. |
| B5.1.2 | **Bulk Produce** | Batch con conteggio (1–10.000), delay tra messaggi ms, campo JSON da variare per iterazione. |
| B5.1.3 | **Consume** | Consuma messaggi: max wait, max messaggi, consumer group, opzione lettura dall'inizio. Messaggi consumati inoltrati al Message Log condiviso. |
| B5.1.4 | **Topics** | Elenca topic e broker del cluster. |
| B5.1.5 | **Connessione** | Lista broker, topic, group ID, client ID, TLS, SASL (PLAIN, SCRAM-SHA-256, SCRAM-SHA-512). |
| B5.1.6 | **Info Broker** | Mostra ID e indirizzo di tutti i broker connessi. |

#### B5.2 RabbitMQ

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| B5.2.1 | **Publish** | Pubblica messaggio su exchange con routing key, content-type, mandatory flag. |
| B5.2.2 | **Consume** | Consuma messaggi da queue con auto-ack configurabile. |
| B5.2.3 | **Info Exchange** | Recupera metadati dell'exchange e delle queue associate. |
| B5.2.4 | **Connessione AMQP** | Host, porta, vhost, username, password, TLS. |

#### B5.3 MQTT

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| B5.3.1 | **Publish** | Pubblica messaggio su topic MQTT con QoS (0/1/2) e retain flag. |
| B5.3.2 | **Subscribe** | Sottoscrivi a topic con QoS; messaggi ricevuti nel Message Log condiviso. |
| B5.3.3 | **Connessione** | Broker URL (mqtt/mqtts), client ID, username/password, clean session, keep-alive. |

#### B5.4 Redis Pub/Sub

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| B5.4.1 | **Publish** | Pubblica messaggio su canale Redis. |
| B5.4.2 | **Subscribe** | Sottoscrivi a canale o pattern glob; messaggi nel Message Log condiviso. |
| B5.4.3 | **Connessione** | Host, porta, password, database index, TLS. |

#### B5.5 NATS

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| B5.5.1 | **Publish** | Pubblica messaggio su subject NATS con headers opzionali. |
| B5.5.2 | **Subscribe** | Sottoscrivi a subject; messaggi nel Message Log condiviso. |
| B5.5.3 | **Auth Token** | Autenticazione con token NATS. |
| B5.5.4 | **Connessione** | URL server NATS (nats://), queue group opzionale. |

---

## C. INFRASTRUTTURA & SIMULAZIONE

### C1. Mock Server

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| C1.1 | **Avvio/Arresto** | Avvia e ferma server HTTP mock locale su porta configurabile. |
| C1.2 | **Configurazione Endpoint** | Pattern path, metodo HTTP (o wildcard `*`), varianti multiple di risposta per endpoint. |
| C1.3 | **Pattern Matching** | Matching esatto, `:param` (parametri nominati), `*` (single segment), `**` (multi-segment). |
| C1.4 | **Modalità Selezione Risposta** | First Active, Random, Round-Robin (configurabile per endpoint). |
| C1.5 | **Configurazione Risposta** | Status code, headers, body, delay ms, toggle attivo/inattivo per variante. |
| C1.6 | **Record & Replay** | Registra richiesta/risposta HTTP reale e aggiunge automaticamente come endpoint mock. |
| C1.7 | **Log Hit** | Log in tempo reale: timestamp, metodo, path, match, response ID, status. Max 500 voci. |
| C1.8 | **Autenticazione Server** | Protezione via header `X-Mock-Auth`. |
| C1.9 | **CORS Auto** | Iniezione automatica header CORS nelle risposte mock. |
| C1.10 | **Stato in Tempo Reale** | Interrogazione stato running/stopped e porta attiva. |

---

### C2. Proxy / Interceptor

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| C2.1 | **Avvio/Arresto Proxy** | Proxy interceptor HTTP/HTTPS su porta configurabile. |
| C2.2 | **Cattura Traffico** | Cattura real-time: metodo, URL, headers, body, status, durata, errori. |
| C2.3 | **Intercettazione HTTPS** | Tunneling CONNECT con generazione dinamica certificati per-host (CA interna). |
| C2.4 | **Gestione CA** | Genera, esporta (PEM/DER), verifica stato ed elimina la CA locale. Validità 10 anni. |
| C2.5 | **Map Local** | Reindirizza URL verso file locali con glob matching. |
| C2.6 | **Map Remote** | Riscrive URL upstream verso destinazioni alternative. |
| C2.7 | **Breakpoint** | Pattern URL che flaggano il traffico corrispondente per ispezione manuale. |
| C2.8 | **Regole IP/CIDR** | Filtri allow/block/intercept per IP e range CIDR. |
| C2.9 | **Regole Dominio** | Pattern matching dominio con wildcard `*.`. |
| C2.10 | **Regole Regex** | Regole con espressioni regolari su URL. |
| C2.11 | **Test Regole** | Testa le regole configurate su URL di esempio prima di attivare. |
| C2.12 | **Throttling** | Latenza artificiale ms e limite banda kbps sulle risposte proxy. |
| C2.13 | **Ripeti Richiesta** | Reinvia richiesta catturata con metodo, URL, headers, body originali. |
| C2.14 | **Export Traffico** | Esporta traffico in JSON, HAR 1.2, cURL — selezione singola o tutto. |
| C2.15 | **Mascheramento Header** | Redazione automatica di Authorization, Cookie, Set-Cookie e header con "token/secret/key" → `***redacted***`. |
| C2.16 | **Timing Dettagliato** | DNS lookup, connessione TCP, handshake TLS, richiesta inviata, TTFB, ricezione risposta. |
| C2.17 | **Limiti Traffico** | Max voci (default 500), limite body richiesta (default 32KB), limite body risposta (default 64KB). |

---

### C3. Docker Lab

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| C3.1 | **14 Preset** | REST Mock + PostgreSQL, REST Mock + Kafka, Kafka + UI, RabbitMQ, Redis Stack, PostgreSQL, MySQL, MongoDB, OpenTelemetry Collector, Jaeger Tracing, Prometheus, Grafana, Mock Server WireMock, Full Observability Stack. |
| C3.2 | **docker-compose.yml** | Genera file Docker Compose per il preset selezionato. |
| C3.3 | **.env** | Genera file .env con variabili d'ambiente per il preset. |
| C3.4 | **README.md** | Genera guida con istruzioni di avvio, porte, credenziali di default. |
| C3.5 | **Tab Switcher** | Naviga tra i tre file generati (compose / env / readme). |
| C3.6 | **Copia** | Copia il contenuto della vista attiva negli appunti. |
| C3.7 | **Download** | Scarica il file attivo con estensione corretta (`.yml`, `.env`, `.md`). |

---

### C4. Load Testing

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| C4.1 | **HTTP Load Test** | URL, metodo, headers, body, concorrenza (1–200), richieste totali (1–50.000), modalità durata, timeout, ramp-up, cooldown. |
| C4.2 | **gRPC Load Test** | Address, servizio, metodo, payload, concorrenza, richieste totali, timeout, TLS. |
| C4.3 | **Metriche HDR Histogram** | Distribuzione latenza: avg, min, max, P50, P75, P90, P95, P99, P99.9. Precisione ms, 3 cifre significative. |
| C4.4 | **Timeline Chart** | Timeline per-richiesta: elapsed, latenza, status code, flag successo/fallimento. |
| C4.5 | **Timeline Throughput** | Bucket per-secondo: req/s e latenza media. |
| C4.6 | **Warmup** | Prime N richieste escluse dalle metriche finali. |
| C4.7 | **Cooldown** | Delay ms dopo il test prima del calcolo metriche. |
| C4.8 | **Rate Limiter QPS** | Pacing basato su ticker per target queries-per-secondo. |
| C4.9 | **Export Report** | JSON, Markdown (tabella), HTML (pagina dark stilizzata). |
| C4.10 | **Salva/Carica Scenario** | Salva configurazione come scenario nominato; lista e carica scenari. |
| C4.11 | **Confronto Side-by-Side** | Confronta due risultati: delta percentuali throughput, latenza avg, P95, tasso errore. |
| C4.12 | **Drawer Rapido** | Pannello a scomparsa per load test direttamente dal Composer. |

---

## D. DEBUGGING & ANALISI

### D1. Browser Debugging

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| D1.1 | **Avvio Browser** | Istanza Chromium/Edge con remote debugging (CDP porta 9223) puntata a URL specificato. |
| D1.2 | **Connessione CDP** | Connessione WebSocket al Chrome DevTools Protocol per il target pagina. |
| D1.3 | **Network Monitor** | Cattura traffico pagina: URL, metodo, status, MIME, headers, timing, dimensione. Filtrabile per URL/metodo/tipo MIME (XHR, Doc, CSS, JS, Img, Font). Max 500 voci. |
| D1.4 | **Body Richieste/Risposte** | Recupero body completi (POST data e response body) per voci catturate. |
| D1.5 | **Console JavaScript** | Cattura eventi `consoleAPICalled` (log/error/warn/info). Eval espressioni JS nel contesto pagina con REPL. Max 200 voci. |
| D1.6 | **Debugger JS** | Vista Sources combinata da script CDP e resource tree pagina, cache browser disabilitata via CDP, reload Sources senza cache, visualizzazione codice con numeri riga e syntax highlight minimale theme-aware, breakpoint cliccabili/condizionali anche via `scriptId`, riga corrente evidenziata in pausa, pause/resume/step-over/step-into/step-out, stack call. |
| D1.7 | **DOM Inspector** | Albero DOM con profondità configurabile, nodi non-elemento visibili (document, doctype, text, comment), querySelector CSS, sorgente HTML formattata, stili computati, highlight nodi e breakpoint DOM su subtree/attributi/rimozione. |
| D1.8 | **Storage Viewer** | Cookies (dominio, path, scadenza, HttpOnly, Secure, SameSite), localStorage, sessionStorage, IndexedDB. Elimina cookie. |
| D1.9 | **Network Throttling** | Profili: No Throttling, Slow 3G, Fast 3G, Regular 4G, WiFi, Offline. Kbps/latenza custom. |
| D1.10 | **Discovery Browser Attivi** | Scansiona porte 9222–9230 per trovare istanze browser con remote debugging già attivo. Mostra lista target (tab/pagine) per ogni browser scoperto con titolo, URL, favicon. |
| D1.11 | **Rilevamento Processi** | Scansione processi `chrome.exe`/`msedge.exe` in esecuzione (via wmic/PowerShell) cercando flag `--remote-debugging-port`; restituisce PID, browser, porta. |
| D1.12 | **Connessione a Target Specifico** | Connetti a qualsiasi tab/pagina aperta tramite ID target o URL WebSocket diretto, senza dover lanciare un nuovo browser. |
| D1.13 | **Navigazione Target** | Naviga il target connesso a un nuovo URL tramite `Page.navigate` senza perdere la connessione CDP. |
| D1.14 | **Screenshot Pagina** | Cattura screenshot della pagina corrente in formato PNG/JPEG/WebP con qualità configurabile. |
| D1.15 | **Sorgente Pagina** | Recupera `document.documentElement.outerHTML` della pagina connessa. |
| D1.16 | **Emulazione Dispositivo** | Override dimensioni viewport (width/height), flag mobile, device scale factor per simulare dispositivi mobili. |
| D1.17 | **Metriche Performance** | Recupera metriche di performance CDP (`Performance.getMetrics`) della pagina: DOM nodes, layouts, JS heap, ecc. |
| D1.18 | **Lancia con Debug** | Avvia browser su porta specificata e ritorna lista target disponibili dopo il bootstrap (polling 6s). |
| D1.19 | **Send to Composer** | Dalla vista Network, invia una richiesta catturata direttamente al Composer HTTP come nuovo tab. |
| D1.20 | **Add as Mock** | Dalla vista Network, aggiungi una coppia request/response catturata come endpoint nel Mock Server. |

---

### D2. HAR Viewer

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| D2.1 | **Import File HAR** | Carica file HAR locale. |
| D2.2 | **Import dal Proxy** | Carica traffico catturato direttamente dal Proxy Interceptor. |
| D2.3 | **Export HAR** | Riesporta il HAR caricato. |
| D2.4 | **Filtro URL** | Ricerca testuale su URL. |
| D2.5 | **Filtro Dominio** | Dropdown con tutti i domini presenti nel HAR. |
| D2.6 | **Filtro Status** | Pulsanti: All / 2xx / 3xx / 4xx / 5xx / err. |
| D2.7 | **Filtro MIME** | Dropdown per tipo MIME. |
| D2.8 | **Filtro Durata Minima** | Esclude richieste più veloci di N millisecondi. |
| D2.9 | **Contatori Anomalie** | Badge errori, richieste lente, richieste pesanti nel set filtrato. |
| D2.10 | **Lista Richieste** | Colonne: status, metodo, URL, icone anomalia, MIME, durata, mini timing bar. |
| D2.11 | **Dettaglio — Timings** | Breakdown waterfall: DNS / TCP / TLS / Send / TTFB / Download con barre proporzionali. |
| D2.12 | **Dettaglio — Request** | URL, headers, body della richiesta. |
| D2.13 | **Dettaglio — Response** | Status, dimensione, MIME, headers, body. Copia body. |
| D2.14 | **Compare Mode** | Confronta due HAR affiancati: colonne metodo, URL, durata A, durata B, differenza (▼ faster / ▲ slower / ≈ simile). |

---

### D3. Network Tools

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| D3.1 | **DNS Lookup** | Risolve record di qualsiasi tipo (A, AAAA, CNAME, MX, TXT, NS, SOA, SRV, CAA, PTR, HINFO…) con server DNS configurabile. |
| D3.2 | **DNS Trace** | Catena completa di risoluzione dalla root all'autoritativo con timing per-server. |
| D3.3 | **DNS Compare** | Interroga Google, Cloudflare, Quad9 in parallelo e confronta risultati. |
| D3.4 | **DNS Cache** | Cache in-memory con scadenza TTL; operazioni get e clear. |
| D3.5 | **Port Scanner** | TCP scan: host, range porte, timeout, max 50 connessioni parallele; nomi servizi noti per 20+ protocolli. |
| D3.6 | **CORS Tester** | Preflight OPTIONS + GET; verifica tutti gli header CORS e mostra conformità. |

---

### D4. JSON Tools

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| D4.1 | **JSON Path Query** | Interroga JSON con sintassi gjson (`data.items.0.name`); restituisce valore, raw, tipo, esistenza. |
| D4.2 | **JSON Set / Mutate** | Modifica JSON con sjson; crea strutture intermedie se necessario. |
| D4.3 | **JSON Diff RFC 6902** | Genera JSON Patch RFC 6902; flag identico/non, operazioni patch, conteggio. |
| D4.4 | **JSON Humanizer** | Converti byte in KB/MB/GB; converti ms in durate leggibili. |
| D4.5 | **JSON Streaming Validator** | Valida ed estrae struttura JSON fino a 10MB senza unmarshal completo. |
| D4.6 | **MIME Type Detector** | Rileva tipo MIME da byte raw; restituisce stringa, estensione, categoria. |
| D4.7 | **JSON Graph Visualizer** | Visualizza JSON annidato come albero indentato/espandibile. |
| D4.8 | **JSON Diff Visuale** | Confronto visuale tra due JSON con visualizzazione diff patch (pannello Utils). |

---

### D5. XML Tools

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| D5.1 | **Formatta XML** | Indentazione e pretty-print di documenti XML. |
| D5.2 | **Valida XML** | Controllo sintassi con feedback errore. |
| D5.3 | **XML → JSON** | Conversione documenti XML in rappresentazione JSON. |
| D5.4 | **XPath Query** | Interroga XML con espressioni XPath. |
| D5.5 | **Diff XML** | Confronto tra due documenti XML. |
| D5.6 | **Encode/Decode Entità** | Encode e decode entità XML (`&amp;`, `&lt;`, ecc.). |

---

### D6. Power Tools (UtilsPanel)

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| D6.1 | **Base64 Encode/Decode** | Codifica e decodifica testo. |
| D6.2 | **URL Encode/Decode** | Encode e decode query string, path, frammenti. |
| D6.3 | **JSON ↔ YAML** | Conversione bidirezionale. |
| D6.4 | **Hash Generator** | MD5, SHA-1, SHA-256, SHA-384, SHA-512. |
| D6.5 | **HMAC Generator** | Firma HMAC con algoritmo e chiave configurabili. |
| D6.6 | **JWT Decoder** | Ispezione header, payload e struttura firma locale. |
| D6.7 | **Password Generator** | Lunghezza e set caratteri configurabili (simboli, cifre, maiuscole, minuscole). |
| D6.8 | **UUID v4 Generator** | Generazione singola e batch di UUID. |
| D6.9 | **Timestamp Converter** | Conversione Unix ↔ ISO 8601 ↔ UTC ↔ ora locale. |
| D6.10 | **Fake Data Generator** | Nomi, email, telefoni, IP, lorem ipsum. |
| D6.11 | **Query String Parser** | Analizza URL o query string in oggetti JSON. |
| D6.12 | **Regex Tester** | Test espressioni regolari con visualizzazione match. |
| D6.13 | **YAML Validator** | Validazione sintassi e struttura. |
| D6.14 | **HTTP Status Reference** | Codici 100–511 con categoria e descrizione. |
| D6.15 | **PEM / JKS Inspector** | Identifica blocchi certificato/chiave PEM. |
| D6.16 | **Class File Inspector** | Verifica magic bytes `CAFEBABE` e versione .class Java. |
| D6.17 | **Docker Compose Generator** | Genera file docker-compose.yml starter per servizi mock e dipendenze locali. |

---

### D7. Dev Logs

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| D7.1 | **Dual-Source** | Raccoglie log frontend (console/runtime) e log backend Go. |
| D7.2 | **Formato JSONL** | Voci strutturate: indice, timestamp, sorgente, funzione, livello (DEBUG/INFO/ERROR), messaggio. |
| D7.3 | **Rotazione per Data** | File `debug-YYYY-MM-DD.jsonl` nella directory `logs/`. |
| D7.4 | **Overlay Log Viewer** | Slide-in overlay con auto-refresh (polling 1.5s). Toggle Ctrl+Shift+D. |
| D7.5 | **Pulizia Log** | Tronca file log backend e svuota buffer frontend. |
| D7.6 | **Apri Cartella Log** | Apre la directory log nel file manager di sistema. |
| D7.7 | **Developer Mode** | Flag diagnostica estesa toggleabile. |
| D7.8 | **Forward Log Frontend** | Il frontend può inviare log console al file backend. |

---

### D8. Observability

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| D8.1 | **Log File Browser** | Elenca file JSONL nella directory log con dimensione e data. |
| D8.2 | **Filtro per Livello** | Tab rapidi per filtrare: All, ERROR, WARN, INFO, DEBUG, LOG. |
| D8.3 | **Filtro per Sorgente** | Frontend o backend. |
| D8.4 | **Ricerca Full-Text** | Ricerca su messaggio e metadati dei log. |
| D8.5 | **Correlation ID** | Filtra log correlati tramite trace/correlation ID. |
| D8.6 | **Trace Waterfall** | Visualizzazione trace spans con timeline proporzionale, servizio, durata, stato. |
| D8.7 | **Export Log** | Scarica file log selezionato. |
| D8.8 | **Refresh Automatico** | Aggiornamento periodico del log viewer. |

---

### D9. Secret Scanner

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| D9.1 | **Scansione Workspace** | Analizza collezioni e ambienti per rilevare segreti esposti (Bearer, API key, AWS, password, chiavi private, connection string, alta entropia). |
| D9.2 | **Livelli Rischio** | Classificazione HIGH / MEDIUM / LOW con icone e colori distinti. |
| D9.3 | **Filtro per Rischio** | Filtra risultati per livello di rischio. |
| D9.4 | **Ricerca Risultati** | Ricerca testuale sui finding. |
| D9.5 | **Mostra/Nascondi Valore** | Toggle visibilità del segreto trovato (mascherato di default). |
| D9.6 | **Export Report Markdown** | Genera report di sicurezza scaricabile in formato Markdown. |
| D9.7 | **Copia Finding** | Copia dettagli del finding negli appunti. |
| D9.8 | **Mascheramento Automatico** | I valori sensibili sono mascherati di default nella UI. |

---

## E. DATI LOCALI

### E1. Database Studio

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| E1.1 | **Driver SQLite** | Connessione SQLite con percorso file. Driver `modernc.org/sqlite` — nessuna lib esterna. |
| E1.2 | **Driver PostgreSQL** | Host, porta, database, user, password, SSL mode. Driver `pgx/v5/stdlib`. |
| E1.3 | **Driver MySQL / MariaDB** | Host, porta, database, user, password. Driver `go-sql-driver/mysql`. |
| E1.4 | **Driver MongoDB** | Host, porta, database, collection, user, password. Driver `mongo-driver v2`. |
| E1.5 | **Driver Db2** | Configurazione visibile con warning "Db2 needs IBM CLI/ODBC client libraries". |
| E1.6 | **DSN Override** | Textarea DSN raw per override avanzato. |
| E1.7 | **Test Connessione** | Ping al database con feedback successo/errore. |
| E1.8 | **Gestione Connessioni** | Dropdown con connessioni salvate; aggiungi, seleziona, elimina. |
| E1.9 | **Query Editor** | Textarea con sostituzione variabili `{{var}}`. |
| E1.10 | **Esegui Query** | Invia query al database backend; risultati in griglia. |
| E1.11 | **Explain Plan** | Esegui EXPLAIN (SQL only). |
| E1.12 | **Limit / Timeout** | Limit righe e timeout ms configurabili. |
| E1.13 | **Rilevamento Query Distruttive** | Avviso di conferma per DROP, DELETE senza WHERE, TRUNCATE. |
| E1.14 | **Griglia Risultati** | Colonne ordinabili, valori NULL evidenziati. |
| E1.15 | **Export JSON / CSV** | Scarica risultati correnti. |
| E1.16 | **Cronologia Query** | Sidebar con query precedenti; click per ricaricare. |
| E1.17 | **Query Favorite** | Toggle preferito su ogni query; sidebar dedicata. |
| E1.18 | **Vault Integration** | Contrassegna connessione come gestita dal Vault con badge visivo. |
| E1.19 | **Contatore Righe** | Mostra righe restituite e righe interessate. |

---

### E2. Storage Inspector

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| E2.1 | **Browse Bucket** | Naviga tutti i bucket bbolt con lista chiavi e valori. |
| E2.2 | **Modifica Valore** | Modifica il valore di una chiave esistente. |
| E2.3 | **Elimina Voce** | Cancella una coppia chiave-valore da un bucket. |
| E2.4 | **Aggiungi Voce** | Inserisci nuova coppia chiave-valore in qualsiasi bucket. |
| E2.5 | **Ricerca Full-Text** | Cerca su tutti i bucket per nome chiave o contenuto valore. Max 50 risultati. |
| E2.6 | **Statistiche** | Dimensione file, conteggio chiavi per bucket. |
| E2.7 | **Export Snapshot** | Esporta intero database come JSON `.adomnia-snapshot`. |
| E2.8 | **Ripristino Snapshot** | Ripristina da file snapshot (max 50MB). |
| E2.9 | **Export/Import Bucket** | Export/import contenuti di singolo bucket come JSON. |
| E2.10 | **Migrazione localStorage** | One-shot da `adomnia.v2` / `adomnia.settings` / `adomnia.mock` a bbolt. |

---

### E3. Workspace Management

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| E3.1 | **Workspace Nominati** | Salva e commuta tra workspace multipli; ognuno include collezioni, ambienti, tab, impostazioni. |
| E3.2 | **Salva Workspace** | Snapshot corrente con nome, timestamp, conteggio tab. |
| E3.3 | **Carica Workspace** | Ripristina stato da workspace nominato. |
| E3.4 | **Elimina Workspace** | Rimuove workspace dal registro. |
| E3.5 | **Import/Export `.adomnia`** | Formato JSON portabile (v1.0): collezioni, ambienti, activeEnvId, mockConfig, proxyConfig, flows. |
| E3.6 | **Import OpenAPI 3.0** | Parsing spec JSON/YAML; operazioni convertite in cartelle raggruppate per tag. |
| E3.7 | **Reset Demo** | Carica workspace demo adOmnia Lab con un click. |

---

### E4. Vault (Segreti Cifrati)

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| E4.1 | **Blocca / Sblocca** | Passphrase con derivazione chiave scrypt (crittografia age). Auto-blocco dopo timeout inattività. |
| E4.2 | **Cifra / Decifra** | Cifra testo in base64 age; decifra ciphertext. |
| E4.3 | **Tipi Segreto** | token, API key, password, OAuth2 secret; note opzionali. |
| E4.4 | **Export Cifrato** | Esporta intero workspace cifrato con passphrase age in formato `adomnia-age`. |
| E4.5 | **Import Cifrato** | Importa backup cifrato con decrittazione passphrase. |
| E4.6 | **Stato** | Controlla bloccato/sbloccato. |
| E4.7 | **X25519 Identity** | Supporta crittografia identity-based X25519 oltre a passphrase scrypt. |

---

### E5. Editor Markdown

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| E5.1 | **Editor Live** | Scrittura Markdown con anteprima in tempo reale. |
| E5.2 | **Sintassi Supportata** | H1–H4, bold, italic, inline code, code block con linguaggio, link, immagini, HR, blockquote, liste. |
| E5.3 | **Toolbar** | Pulsanti Bold, Italic, Code, Link, Immagine, Heading. |
| E5.4 | **Split View** | Editor e anteprima affiancati. |

---

## F. PERSONALIZZAZIONE & ESTENDIBILITÀ

### F1. Temi & Skin

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| F1.1 | **11 Temi Integrati** | adOmnia Dark, adOmnia Light, Midnight, Forest, Sunset, Nord, Tokyo Night, Catppuccin Mocha, Solarized Dark, Gruvbox Dark, Legacy Enterprise. |
| F1.2 | **Windows 95 Skin** | Skin vintage con icona `icon95.png` dedicata. |
| F1.3 | **CRUD Temi** | Crea, modifica, elimina temi personalizzati. |
| F1.4 | **Import/Export Tema** | Import da stringa/file JSON; export come JSON formattato. |
| F1.5 | **Import da URL** | Scarica e installa file JSON tema da URL (max 1MB). |
| F1.6 | **Editor Visuale** | Modifica token con anteprima live dei colori. |
| F1.7 | **Validazione Schema** | Verifica 17 token obbligatori; avvisa su token opzionali mancanti. |
| F1.8 | **WCAG Contrast Check** | Valuta conformità AA/AAA per 7 coppie testo/sfondo chiave. |
| F1.9 | **Directory Skins** | Scansione `~/.adomnia/skins/*.json`; salva temi su disco. |
| F1.10 | **Hot Reload** | Polling directory skins ogni 2s; rileva file nuovi, modificati, eliminati. |
| F1.11 | **Design Token Schema** | 27 colori, 3 font, 7 spaziatura, 5 raggio, 4 ombra. |
| F1.12 | **Token Metodi HTTP** | Colori per method-get/post/put/patch/delete/head. |
| F1.13 | **Theme Provider** | React context che applica CSS custom properties alla root. |

---

### F2. Plugin System

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| F2.1 | **Manifest Plugin** | JSON con: ID, nome, versione, autore, descrizione, homepage, licenza, permessi, hook, impostazioni, entry point, icona. |
| F2.2 | **Installa/Disinstalla** | Da manifest JSON; disinstalla rimuove directory e pulisce hook. |
| F2.3 | **Abilita/Disabilita** | Toggle con registrazione/deregistrazione hook; stato persistito. |
| F2.4 | **12 Hook Events** | onRequest, onResponse, onSend, onSave, onImport, onExport, onStartup, onShutdown, onThemeChange, onEnvChange, onTabOpen, onTabClose. |
| F2.5 | **Esecuzione Hook** | Ogni gestore restituisce HookResult (modificato, dati, errore). |
| F2.6 | **Impostazioni Plugin** | Chiave, etichetta, tipo, default, opzioni, descrizione; UI dedicata. |
| F2.7 | **WASM Sandbox** | Limite memoria 64MB, timeout 10s, guardia concorrenza, tracciamento memoria. |
| F2.8 | **8 Host Functions** | `http.fetch`, `storage.get/set/delete`, `log.info/error`, `ui.notify`, `env.get`. |
| F2.9 | **Plugin DevTools** | Pannello debug e test per sviluppatori plugin. |

---

### F3. Template

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| F3.1 | **5 Categorie** | Richieste, Collezioni, Flows, Mock Servers, Ambienti. |
| F3.2 | **CRUD Template** | Crea, modifica, elimina template. |
| F3.3 | **Ricerca** | Per nome, descrizione, tag (case-insensitive). |
| F3.4 | **Import/Export** | Da/verso stringa o file JSON. |
| F3.5 | **Installa Template** | Restituisce il contenuto; traccia conteggio download. |
| F3.6 | **8 Template Integrati** | REST API CRUD, OAuth2 PKCE Flow, Stripe API, Health Check Flow, Load Test Basic, GitHub API, JWT Auth Environment, SOAP Service. |
| F3.7 | **Marketplace** | Sfoglia template disponibili per categoria. |
| F3.8 | **Vista Dettaglio** | Mostra contenuto completo con opzione installazione. |

---

### F4. Python Plugin SDK

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| F4.1 | **Bridge gRPC Bidirezionale** | Comunicazione Go↔Python via due canali gRPC: `worker.proto` (Go→Python) e `sdk.proto` (Python→Go). |
| F4.2 | **Worker Manager** | Gestione ciclo di vita worker Python: spawn, monitor, kill, idle-reap (timeout 60s inattività). Max 4 worker simultanei. |
| F4.3 | **Spawn Worker** | Avvia processo Python isolato con variabili ambiente: `ADOMNIA_GRPC_PORT`, `ADOMNIA_SDK_PORT`, `ADOMNIA_PLUGIN_ID`, `ADOMNIA_DATA_DIR`. |
| F4.4 | **Execute Action** | Invoca azione nominata su un worker Python con payload JSON; supporto sia sincrono che streaming (chunked). |
| F4.5 | **Health Check (Ping)** | Verifica stato worker con uptime e statistiche memoria. |
| F4.6 | **Graceful Shutdown** | Arresto coordinato con grace period configurabile; kill forzato dopo timeout. |
| F4.7 | **Init Worker** | Inizializzazione con configurazione plugin e directory dati. |
| F4.8 | **SDK API — GetCurrentRequest** | Il plugin Python può leggere la richiesta HTTP corrente dal Composer. |
| F4.9 | **SDK API — EmitEvent** | Il plugin può emettere eventi verso il frontend via Wails `EventsEmit`. |
| F4.10 | **SDK API — Log** | Logging strutturato (debug/info/warn/error) inoltrato al sistema log Go. |
| F4.11 | **SDK API — GetEnvVariables** | Lettura variabili ambiente attive dallo store bbolt. |
| F4.12 | **SDK API — Storage** | Storage persistente per plugin: `get`/`set` nel bucket `plugin_storage` di bbolt. |
| F4.13 | **BaseWorker Class** | Classe base Python: sotto-classa e usa il decoratore `@action(name, streaming=False)` per registrare handler. |
| F4.14 | **Decoratore @action** | Registra funzioni Python come azioni invocabili via gRPC senza bisogno di `protoc`. |
| F4.15 | **JSON-over-gRPC** | Serializzazione JSON nativa senza generazione codice protobuf (no `protoc` richiesto per autori plugin). |
| F4.16 | **Auto-Discovery Runtime** | Ricerca Python runtime: prima embedded in `<dataDir>/python-runtime/python.exe`, poi `python3`/`python` da PATH. |
| F4.17 | **Limiti Configurabili** | Timeout (ms), memoria max (MB), numero max worker — modificabili da frontend. |
| F4.18 | **Stato Worker** | Macchina a stati: `starting` → `ready` → `running` → `stopping` → `dead`. Esposta al frontend. |
| F4.19 | **Idle Reaper** | Goroutine che ogni 30s termina i worker inattivi da più di 60s per liberare risorse. |
| F4.20 | **SDK Server** | Server gRPC Go che risponde alle chiamate inverse dei plugin Python (canale ascendente). |
| F4.21 | **Plugin Manifest Python** | `manifest.json` con entry point `main.py`; struttura directory `<dataDir>/plugins/<id>/`. |

---

## G. PIATTAFORMA

### G1. Impostazioni

#### G1.A Generali
| # | Impostazione |
|---|-------------|
| G1.1 | Conferma prima di chiudere tab modificati |
| G1.2 | Ripristina tab all'avvio |
| G1.3 | Mostra benvenuto su workspace vuoto |
| G1.4 | Sezione rail predefinita all'avvio |
| G1.5 | Intervallo auto-salvataggio (ms) |
| G1.6 | Backup workspace all'avvio |
| G1.7 | Max richieste concorrenti |

#### G1.B Aspetto
| # | Impostazione |
|---|-------------|
| G1.8 | Tema (dark/light) |
| G1.9 | Densità (compact/comfortable/spacious) |
| G1.10 | Dimensione font |
| G1.11 | Dimensione font monospace |
| G1.12 | Lingua (en/it) |
| G1.13 | Larghezza sidebar |
| G1.14 | Mostra solo icone rail |
| G1.15 | Preset colore accent |

#### G1.C Richieste
| # | Impostazione |
|---|-------------|
| G1.16 | Timeout predefinito (ms) |
| G1.17 | Segui redirect |
| G1.18 | Salva risposte in cronologia |
| G1.19 | Max cronologia risposte per tab |
| G1.20 | Metodo HTTP predefinito |
| G1.21 | Salta verifica certificato |
| G1.22 | Certificato client (PEM) |
| G1.23 | Passphrase certificato client |
| G1.24 | Invia cookie automaticamente |
| G1.25 | Preserva cookie tra tab |
| G1.26 | Codifica URL automaticamente |
| G1.27 | Trim whitespace negli header |
| G1.28 | Max redirect |
| G1.29 | Rimuovi auth su redirect |

#### G1.D Proxy
| # | Impostazione |
|---|-------------|
| G1.30 | Porta proxy predefinita |
| G1.31 | Max voci traffico |
| G1.32 | Limite body richiesta (KB) |
| G1.33 | Limite body risposta (KB) |
| G1.34 | Proxy upstream |
| G1.35 | Host no-proxy |
| G1.36 | Abilita HTTPS |

#### G1.E Mock
| # | Impostazione |
|---|-------------|
| G1.37 | Porta mock predefinita |
| G1.38 | Delay risposta predefinito (ms) |
| G1.39 | Password mock server |
| G1.40 | CORS headers auto |
| G1.41 | Log hit su file |

#### G1.F Vault
| # | Impostazione |
|---|-------------|
| G1.42 | Timeout auto-blocco (min) |
| G1.43 | Blocca vault su minimizza |
| G1.44 | Mostra vault in autocompletamento |

#### G1.G Editor
| # | Impostazione |
|---|-------------|
| G1.45 | Dimensione tab (2/4/8) |
| G1.46 | Soft tabs (spazi) |
| G1.47 | Word wrap |
| G1.48 | Numeri di riga |
| G1.49 | Auto-chiusura parentesi |
| G1.50 | Formatta risposta automaticamente |
| G1.51 | Max dimensione rendering risposta (KB) |

#### G1.H Altre sezioni
| # | Sezione |
|---|--------|
| G1.52 | Privacy & Dati |
| G1.53 | Shortcut Tastiera |
| G1.54 | About (versione, build, crediti) |
| G1.55 | Developer (developer mode, dev tools) |

---

### G2. Infrastruttura & Piattaforma

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| G2.1 | **Local-First** | Nessun account, nessuna telemetria, nessun dato fuori dalla macchina senza azione esplicita. |
| G2.2 | **Database bbolt Embedded** | Key-value ACID single-file con bucket multipli; auto-creazione e migrazione. |
| G2.3 | **HTTP Sidecar Go** | Server HTTP locale su porta casuale SO per comunicazione frontend↔backend. |
| G2.4 | **Binario Unico** | Eseguibile desktop autocontenuto; nessuna dipendenza runtime esterna. |
| G2.5 | **Titlebar configurabile** | Default frameless con titlebar dell'app; su Linux scelta esplicita tra Wayland nativo, XWayland e titlebar di sistema al riavvio. |
| G2.6 | **Nasconde Console Windows** | Sopprime la finestra console in produzione. |
| G2.7 | **Internazionalizzazione** | Supporto Inglese e Italiano; dizionario traduzioni completo. |
| G2.8 | **State Management Zustand** | Store: app, collezioni, ambienti, tab, impostazioni, devLogs, temi, plugin, browser-debug. |
| G2.9 | **Pannello Onboarding** | Home con catalogo funzionalità, quick-start, shortcut, import workspace, carica demo. |
| G2.10 | **Shortcut Tastiera** | Ctrl+N nuovo tab, Ctrl+Enter invia, Ctrl+K import/export, Alt+← indietro, Ctrl+Shift+D dev logs. |
| G2.11 | **Confirm Dialog** | Componente riutilizzabile per azioni distruttive con messaggio personalizzabile. |

---

### G3. CSS & UI Framework

| # | Funzionalità | Descrizione |
|---|-------------|-------------|
| G3.1 | **CSS Custom Properties** | Sistema design token: superficie, testo, bordi, accent, colori semantici, metodi, densità, font. |
| G3.2 | **Tailwind CSS** | Utility-first con integrazione tema personalizzato. |
| G3.3 | **shadcn/ui Primitives** | Button, Dialog, Prompt, Input, ConfirmDialog. |
| G3.4 | **Icone Lucide** | 50+ icone React per navigazione, azioni, stati. |
| G3.5 | **VarHighlightInput** | Input che evidenzia inline i pattern `{{variabile}}`. |
| G3.6 | **JsonGraph** | Componente albero espandibile per JSON annidati. |
| G3.7 | **JsonEditor** | Editor JSON con syntax highlighting. |
| G3.8 | **Syntax Highlighting JSON** | Tokenizer lato client: chiavi, stringhe, numeri, booleani, null, punteggiatura. |
| G3.9 | **Dark + Light Mode** | Toggle tema tramite classe CSS su `<html>`. |
| G3.10 | **Scrollbar Personalizzata** | Scrollbar sottile coerente con estetica developer tool. |

---

## RIEPILOGO

| Categoria | Sezioni | Funzionalità |
|-----------|---------|-------------|
| **A — API Core** | HTTP Client, Auth, Assertions, Runner, Flows, Matrix, Test Data | 74 |
| **B — Protocolli & Streaming** | gRPC, SOAP, WebSocket, SSE, Broker Studio (5 broker) | 65 |
| **C — Infrastruttura & Simulazione** | Mock Server, Proxy, Docker Lab, Load Testing | 44 |
| **D — Debugging & Analisi** | Browser Debug (+ Discovery), HAR, Network Tools, JSON Tools, XML Tools, Dev Utils, Dev Logs, Observability, Secret Scanner | 90 |
| **E — Dati Locali** | Database Studio, Storage Inspector, Workspace, Vault, Markdown | 44 |
| **F — Personalizzazione & Estendibilità** | Temi, Plugin WASM, Template, Python Plugin SDK | 51 |
| **G — Piattaforma** | Impostazioni, Infrastruttura, UI Framework | 76 |
| **Totale** | 33 sezioni | **~444** |
