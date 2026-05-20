# adOmnia — Roadmap Funzionalità da Aggiungere

> **Completamento verificato:** Priorità 1 53/55 · Priorità 2 57/59 · Priorità 3 51/52 · Priorità 4 33/36 · Priorità 5 39/40 (+ Docker Lab workspace completo)
> 
> **Ultima verifica:** 2026-05-17 — implementati: Flows Stable, gRPC proto/server-streaming, HAR browser bridge, Observability trace/correlation, Vault bridges, Docker Lab workspace + Database/Broker bridge, Template install end-to-end, Plugin runtime inspector, Themes icon.png/icon95.png.

Roadmap organizzata a checkbox per evolvere **adOmnia** da API Development Toolbox a vero **laboratorio local-first per sviluppo, test, simulazione, intercettazione e validazione di sistemi moderni e legacy**.

---

## Obiettivo di prodotto

> adOmnia non è solo un client API.  
> È un laboratorio locale per sviluppare, testare, simulare, intercettare e validare sistemi moderni e legacy.

---

# Priorità 1 — API Quality & Testing

## 1. Contract Testing OpenAPI

- [x] Validare le response HTTP contro schema OpenAPI.
- [x] Validare le request HTTP contro schema OpenAPI.
- [x] Evidenziare errori di contratto nella UI.
- [x] Mostrare campo mancante, tipo errato, enum non valido.
- [x] Collegare ogni richiesta importata da OpenAPI al relativo schema.
- [x] Aggiungere pannello "Contract Result" nella response view.
- [x] Supportare validazione status code atteso.
- [x] Supportare validazione headers attesi.
- [x] Supportare validazione content-type.
- [x] Eseguire contract test da singola request.
- [x] Eseguire contract test da collection.
- [x] Eseguire contract test da CLI. *(CLI con `--contract <openapi-spec>`)*
- [x] Esportare report in Markdown.
- [x] Esportare report in HTML.
- [x] Esportare report JSON per automazioni future.

> Verifica Codex 2026-05-16: la validazione response OpenAPI e i report sono integrati nella UI. La funzione `validateRequestContract` esiste, ma non risulta ancora collegata al flusso di invio request/Composer; quindi la validazione request e' da considerare parziale finche' non viene mostrata/eseguita in UI.

---

## 2. Collection Runner Completo

- [x] Eseguire una collection intera.
- [x] Eseguire una singola folder.
- [x] Eseguire singole request in sequenza.
- [x] Supportare numero di iterazioni.
- [x] Supportare dataset CSV.
- [x] Supportare dataset JSON.
- [x] Mappare variabili da dataset a `{{variabili}}`.
- [x] Aggiungere modalità "stop on failure".
- [x] Aggiungere retry automatico configurabile.
- [x] Aggiungere delay tra richieste.
- [x] Aggiungere summary finale.
- [x] Mostrare richieste riuscite/fallite.
- [x] Mostrare durata totale.
- [x] Mostrare tempo medio per request.
- [x] Esportare report Markdown.
- [x] Esportare report HTML.
- [x] Esportare report JSON.
- [x] Esportare report JUnit XML per CI/CD.
- [x] Integrare il runner con la CLI `adOmnia run`. *(CLI run con `--data`, `--contract`, assertions)*

> Verifica Codex 2026-05-16: corretto bug UI del Runner; ora il summary finale e gli export vengono effettivamente popolati dalla fine del generator.

---

## 3. Request Assertions Visuali

- [x] Aggiungere builder visuale per assertions. *(implementato 2026-05-17: AssertionsEditor integrato nel Composer come tab Tests)*
- [x] Assertion: status code equals.
- [x] Assertion: status code is in range.
- [x] Assertion: response time lower than.
- [x] Assertion: header exists.
- [x] Assertion: header contains.
- [x] Assertion: body contains text.
- [x] Assertion: JSON path exists.
- [x] Assertion: JSON path equals.
- [x] Assertion: JSON path matches regex.
- [x] Assertion: JSON path type is string/number/boolean/object/array.
- [x] Assertion: array length equals. *(implementato 2026-05-17: target `arrayLength` con operatori eq/neq/gt/lt/gte/lte)*
- [x] Assertion: XML path exists.
- [ ] Assertion: response schema valid. *(verifica: target `schema` nell'assertion engine e' delegato al Contract tab, non e' un'assertion autonoma)*
- [x] Mostrare risultato assertions nella response view.
- [x] Mostrare conteggio passed/failed.
- [x] Salvare assertions dentro la request. *(implementato 2026-05-17: AssertionsEditor persiste via request.assertions[])*
- [x] Eseguire assertions nei flows. *(implementato 2026-05-17: FlowsPanel valuta `request.assertions` a ogni step e blocca il flow su failure)*
- [x] Eseguire assertions nel collection runner.
- [x] Eseguire assertions da CLI. *(backend: Go CLI)*
- [x] Generare snippet compatibili con `pm.*` dove possibile. *(implementato 2026-05-17: pulsante Code nell'AssertionsEditor)*

> Verifica Codex 2026-05-17: builder visuale assertions integrato nel Composer (tab "Tests"). Aggiunto target `arrayLength`. Pulsante snippet `pm.*`. Assertions salvate nella request e valutate dal runner e dai flows.

---

# Priorità 2 — Enterprise / Legacy

## 4. SOAP / WSDL Studio

- [x] Importare file WSDL da path locale.
- [x] Importare WSDL da URL.
- [x] Elencare services disponibili.
- [x] Elencare ports disponibili.
- [x] Elencare operations SOAP.
- [x] Generare envelope SOAP automaticamente.
- [x] Gestire namespace XML.
- [x] Gestire SOAPAction.
- [x] Supportare SOAP 1.1.
- [x] Supportare SOAP 1.2.
- [x] Supportare WS-Security UsernameToken.
- [x] Supportare header SOAP custom. *(implementato 2026-05-17: editor KV per custom SOAP headers nel SoapPanel)*
- [x] Supportare template request per operation.
- [x] Validare response XML.
- [x] Visualizzare request SOAP in editor XML.
- [x] Visualizzare response SOAP formattata.
- [x] Convertire response SOAP/XML in JSON navigabile.
- [x] Salvare history per operation.
- [x] Collegare operation SOAP a collection/workspace. *(implementato 2026-05-17: pulsante Save nel SoapPanel)*
- [x] Esportare chiamata SOAP come cURL.
- [x] Generare codice client base da operation SOAP.

> Verifica Codex 2026-05-17: aggiunto editor headers custom (KV) e pulsante Save per esportare operation SOAP come request nella collection. Custom headers propagati via `SoapRequest.customHeaders`.

---

## 5. Environment Matrix Runner

- [x] Eseguire una request su più ambienti.
- [x] Eseguire un flow su più ambienti.
- [x] Eseguire una collection su più ambienti.
- [x] Mostrare tabella comparativa DEV/TEST/COLL/PROD.
- [x] Confrontare status code tra ambienti.
- [x] Confrontare headers tra ambienti.
- [x] Confrontare body JSON tra ambienti.
- [x] Confrontare body XML tra ambienti.
- [x] Confrontare tempi di risposta.
- [x] Evidenziare ambiente con errore.
- [x] Evidenziare differenze critiche.
- [x] Consentire esclusione campi dinamici dal diff.
- [x] Salvare configurazioni matrix.
- [x] Esportare report Markdown.
- [x] Esportare report HTML.
- [x] Esportare report JSON.

> Implementato 2026-05-16: aggiunto pannello UI `Env Matrix` nel rail Dev. Supporta request, collection e flow multi-step su ambienti reali dello workspace, tabella comparativa, diff status/header/body JSON/XML/time/size, esclusione campi dinamici, salvataggio config ed export Markdown/HTML/JSON.

---

## 6. Test Data Studio

- [x] Generare dataset JSON.
- [x] Generare dataset CSV.
- [x] Supportare template con variabili fake.
- [x] Generare nomi.
- [x] Generare email.
- [x] Generare username.
- [x] Generare numeri telefono.
- [x] Generare indirizzi IP.
- [x] Generare lorem ipsum.
- [x] Generare UUID.
- [x] Generare date casuali.
- [x] Generare IBAN fake.
- [x] Generare dati italiani fake.
- [x] Generare codice fiscale fake.
- [x] Generare partita IVA fake.
- [x] Generare CAP/provincia/comune fake.
- [ ] Supportare regole custom. *(verifica: presente solo valore custom costante, non regole custom vere)*
- [x] Supportare batch generation.
- [x] Collegare dataset al Collection Runner. *(implementato 2026-05-17: pulsante "Run in Runner" in TestDataStudio con evento window)*
- [ ] Collegare dataset al Load Testing. *(verifica: non trovato collegamento Test Data Studio -> Load Test)*
- [x] Salvare preset di dataset.
- [x] Esportare dataset generati. *(implementato 2026-05-17: pulsante Download per JSON/CSV)*

---

# Priorità 3 — Protocolli e Runtime Moderni

## 7. WebSocket Client

- [x] Creare pannello WebSocket dedicato.
- [x] Supportare connessioni WS.
- [x] Supportare connessioni WSS.
- [x] Supportare headers custom.
- [x] Supportare Bearer Token.
- [x] Supportare Basic Auth.
- [x] Supportare variabili ambiente nella URL.
- [x] Supportare variabili ambiente negli headers.
- [x] Inviare messaggi text.
- [x] Inviare messaggi JSON.
- [x] Formattare JSON in uscita.
- [x] Visualizzare messaggi inbound.
- [x] Visualizzare messaggi outbound.
- [x] Distinguere messaggi client/server.
- [x] Salvare conversazione. *(implementato 2026-05-17: conversazione persistita in localStorage e ricaricata al mount)*
- [x] Esportare conversazione in JSONL.
- [x] Aggiungere auto-reconnect.
- [x] Aggiungere ping/pong manuale.
- [x] Aggiungere script su messaggio ricevuto.
- [x] Salvare sessioni WebSocket nel workspace. *(implementato 2026-05-17: WebSocket config incluso nell'export workspace)*

---

## 8. SSE Client

- [x] Creare pannello Server-Sent Events.
- [x] Connettersi a endpoint SSE.
- [x] Supportare headers custom.
- [x] Supportare autenticazione.
- [x] Supportare variabili ambiente.
- [x] Visualizzare eventi in tempo reale.
- [x] Mostrare event type.
- [x] Mostrare event id.
- [x] Mostrare retry.
- [x] Mostrare payload evento.
- [x] Filtrare eventi per type.
- [x] Cercare nel payload eventi.
- [x] Pausare stream lato UI.
- [x] Riprendere stream.
- [x] Salvare stream.
- [x] Esportare stream in JSONL.
- [x] Replay eventi salvati.

---

## 9. Message Broker Hub

- [x] Rinominare sezione Kafka in "Broker Studio" o "Message Broker".
- [x] Mantenere Kafka come modulo principale.
- [x] Aggiungere supporto RabbitMQ publish.
- [x] Aggiungere supporto RabbitMQ consume.
- [x] Aggiungere supporto RabbitMQ exchange/queue.
- [x] Aggiungere supporto MQTT publish.
- [x] Aggiungere supporto MQTT subscribe.
- [x] Aggiungere supporto Redis Pub/Sub.
- [x] Aggiungere supporto NATS publish.
- [x] Aggiungere supporto NATS subscribe.
- [ ] Salvare connessioni broker nel vault. *(verifica: UI mostra solo hint Vault; non salva credenziali/connessioni nel Vault)*
- [x] Salvare preset messaggi.
- [x] Esportare messaggi consumati.
- [x] Aggiungere viewer JSON per messaggi.
- [x] Aggiungere viewer headers/metadata.

---

# Priorità 4 — Debugging, Observability e Sicurezza

## 10. HAR Viewer Avanzato

- [x] Importare file HAR.
- [x] Visualizzare lista richieste HAR.
- [x] Visualizzare waterfall timing.
- [x] Mostrare DNS timing.
- [x] Mostrare TCP timing.
- [x] Mostrare TLS timing.
- [x] Mostrare TTFB.
- [x] Mostrare download time.
- [x] Filtrare per dominio.
- [x] Filtrare per status code.
- [x] Filtrare per MIME type.
- [x] Filtrare per durata.
- [x] Identificare richieste lente.
- [x] Identificare errori HTTP.
- [x] Identificare payload pesanti.
- [x] Confrontare due file HAR.
- [x] Collegare HAR Viewer al Proxy/Interceptor.
- [x] Collegare HAR Viewer al Browser Debugging. *(implementato 2026-05-17: import diretto da Browser Debug traffic e azioni send/create mock)*

---

## 11. Observability Panel

- [x] Creare pannello Observability.
- [x] Leggere log JSONL locali.
- [x] Filtrare log per livello.
- [x] Filtrare log per sorgente.
- [x] Filtrare log per correlation ID.
- [x] Visualizzare trace OpenTelemetry locali. *(2026-05-17: estrae trace/span/correlation da campi JSONL comuni)*
- [x] Mostrare trace waterfall. *(2026-05-17: gruppi trace con timeline span)*
- [x] Mostrare span duration.
- [x] Mostrare error span.
- [x] Collegare request HTTP a log correlati.
- [x] Collegare request HTTP a trace correlata.
- [x] Cercare nei log.
- [x] Salvare query di ricerca.
- [x] Esportare log filtrati.
- [x] Evidenziare errori critici.
- [x] Supportare ingest locale da file.
- [ ] Valutare endpoint locale OTLP per trace.

---

## 12. Secret Scanner

- [ ] Scansionare workspace alla ricerca di token.
- [ ] Scansionare ambienti alla ricerca di secret hardcoded.
- [ ] Scansionare headers sensibili.
- [ ] Scansionare body salvati.
- [ ] Scansionare log.
- [ ] Scansionare export HAR.
- [ ] Scansionare export cURL.
- [ ] Rilevare Bearer Token.
- [ ] Rilevare API key comuni.
- [ ] Rilevare password.
- [ ] Rilevare secret AWS.
- [ ] Rilevare private key PEM.
- [ ] Mascherare valori sensibili prima dell'export.
- [ ] Avvisare prima di condividere un file.
- [ ] Suggerire spostamento nel Vault.
- [ ] Aggiungere livello rischio: basso/medio/alto.
- [ ] Aggiungere report sicurezza workspace.

---

# Priorità 5 — Local Lab e Produttività

## 13. Database Client Leggero

- [x] Creare pannello Database.
- [x] Supportare SQLite.
- [x] Supportare PostgreSQL.
- [x] IBM Db2. *(UI/validazione presente; richiede IBM CLI/ODBC esterno, driver non bundlato nel portable build)*
- [x] Supportare MySQL/MariaDB.
- [x] Supporto MongoDB documentale. *(runner JSON per find, aggregate, insert/update/delete, count, listDatabases, listCollections, create/drop collection, drop database, runCommand)*
- [x] Salvare connessioni nel vault. *(connessioni persistite localmente e marcabili vault-managed; integrazione vault cifrata completa da rafforzare)*
- [x] Query editor con syntax highlighting. *(editor SQL monospazio moderno con stati visuali; highlighting ricco da raffinare)*
- [x] Result grid.
- [x] Export risultato in JSON.
- [x] Export risultato in CSV.
- [x] Query history.
- [x] Query favorites.
- [x] Supportare variabili ambiente nelle query.
- [x] Supportare explain plan base.
- [x] Mostrare tempo esecuzione query.
- [x] Limit automatico configurabile.
- [x] Avviso per query distruttive.
- [x] Conferma per DROP/DELETE senza WHERE.

---

## 14. Docker Compose Lab Generator Avanzato

- [x] Creare wizard Docker Lab.
- [x] Preset REST mock + PostgreSQL.
- [x] Preset REST mock + Kafka.
- [x] Preset Kafka + UI.
- [x] Preset RabbitMQ.
- [x] Preset Redis.
- [x] Preset PostgreSQL.
- [x] Preset MySQL.
- [x] Preset MongoDB.
- [x] Preset OpenTelemetry Collector.
- [x] Preset Jaeger.
- [x] Preset Prometheus.
- [x] Preset Grafana.
- [x] Preset mock server.
- [x] Generare `docker-compose.yml`.
- [x] Generare `.env`.
- [x] Generare README locale del lab.
- [x] Aggiungere pulsante copia.
- [x] Aggiungere pulsante salva su disco.
- [x] Aggiungere integrazione con workspace lab. *(implementato 2026-05-17: ultimo lab in `adomnia.dockerlab.last`, incluso in workspace export/import; bridge Database/Broker)*

> Implementato 2026-05-17: DockerLabPanel con 14 preset (REST+Pg, REST+Kafka, Kafka+UI, RabbitMQ, Redis Stack, PostgreSQL, MySQL, MongoDB, OTel Collector, Jaeger, Prometheus, Grafana, WireMock, Full Observability Stack). Genera compose.yml, .env, README.md con endpoint documentati. Copia e download per ogni file.

---

## 15. AI Assistant Locale / Opzionale

- [ ] Aggiungere sezione AI opzionale.
- [ ] Supportare provider locale Ollama.
- [ ] Supportare provider esterni solo se configurati dall'utente.
- [ ] Nessuna chiamata esterna di default.
- [ ] Spiegare response JSON.
- [ ] Spiegare response XML.
- [ ] Generare assertions da una response.
- [ ] Generare mock response da schema.
- [ ] Generare OpenAPI da collection.
- [ ] Generare documentazione Markdown.
- [ ] Suggerire fix per errori HTTP.
- [ ] Suggerire test case mancanti.
- [ ] Suggerire edge case.
- [ ] Generare esempi payload.
- [ ] Integrare con Vault per secret provider.
- [ ] Aggiungere indicatore chiaro quando AI è attiva.
- [ ] Aggiungere modalità privacy/local-first.

---

# Priorità Finale Consigliata

## Sequenza consigliata

- [x] 3. Request Assertions visuali.
- [x] 4. SOAP/WSDL Studio.
- [x] 5. Environment Matrix Runner.
- [x] 6. WebSocket Client.
- [x] 7. SSE Client.
- [x] 8. HAR Viewer avanzato.
- [ ] 9. Secret Scanner.
- [x] 10. Database Client leggero.
- [x] 11. Docker Compose Lab Generator avanzato.
- [x] 12. Observability Panel.
- [x] 13. Message Broker Hub.
- [x] 14. Test Data Studio.
- [ ] 15. AI Assistant locale/opzionale.
- [x] 16. Contract Testing OpenAPI.
- [x] 17. Collection Runner completo.

---

# Criterio di Scelta

Ogni nuova feature dovrebbe rispettare almeno uno di questi obiettivi:

- [ ] Rafforza il posizionamento local-first.
- [ ] Aiuta nel debugging reale.
- [ ] Aiuta nel testing reale.
- [ ] Aiuta con sistemi enterprise/legacy.
- [ ] Si integra con almeno due moduli già esistenti.
- [ ] Non è solo una utility isolata.
- [ ] Aumenta la differenza rispetto a Postman/Insomnia.
- [ ] Può funzionare bene anche senza cloud.
- [ ] Può essere eseguita da UI e, dove ha senso, da CLI.
- [ ] Produce report o output esportabile.

---

# Nota Strategica

Non aggiungere funzionalità solo perché sono tecnicamente possibili.

Le prossime feature dovrebbero rendere adOmnia più riconoscibile come:

> Developer Toolbox locale, estendibile, potente per API, debugging, mock, proxy, test, broker, legacy e automazione.
