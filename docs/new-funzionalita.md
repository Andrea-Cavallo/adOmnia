# adOmnia — Nuove Funzionalità Innovative

10 funzionalità che nessun competitor fa bene (o fa del tutto), tutte coerenti con i quattro pilastri di adOmnia: **Local-First · User-Extensible · Browser Integration · Enterprise/Legacy**.

Ordinate per impatto percepito dall'utente.

---

## 1. AI Assistant Locale (via Ollama)

**Problema risolto:** i developer perdono tempo a costruire richieste da zero, a leggere errori cryptici, a scrivere assertions a mano. I tool cloud-AI (come Postman AI) mandano i tuoi dati su server remoti.

**Perché è innovativo:** Postman AI esiste ma è cloud e a pagamento. Nessun tool locale fa questo. adOmnia sarebbe il primo API toolbox privacy-first con AI integrata.

**Checklist implementazione:**
- [ ] Rilevamento automatico Ollama su `localhost:11434`; feature nascosta se non installato
- [ ] Drawer slide-in nel Composer con campo testo libero e selettore modello (llama3, mistral, codellama…)
- [ ] Generazione richiesta HTTP da linguaggio naturale → popola metodo, URL, body, headers nel Composer
- [ ] Spiegazione risposta ricevuta: analizza status code + body e genera testo human-readable
- [ ] Suggerimento assertions da risposta campione: propone automaticamente le assertions più utili
- [ ] Suggerimento configurazione auth da errore 401/403
- [ ] Risposta AI in streaming inline (token by token)
- [ ] Pulsanti contestuali: "Applica al Composer" / "Aggiungi come Assertion" / "Copia"
- [ ] Nessuna chiamata esterna — tutto via Ollama locale

---

## 2. Contract Testing Engine

**Problema risolto:** le API cambiano senza preavviso. I developer scoprono i breaking change in produzione, non durante lo sviluppo.

**Perché è innovativo:** tool come Dredd esistono ma sono CLI separati e complessi. Nessun API client desktop ha questo integrato. adOmnia lo rende immediato: importi la spec, premi "Valida", vedi i risultati.

**Checklist implementazione:**
- [ ] Import spec OpenAPI 3.0 da file, URL o testo incollato
- [ ] Import spec AsyncAPI 2.x
- [ ] Selezione endpoint da validare (tutti o sottoinsieme)
- [ ] Associazione ambiente attivo come base URL
- [ ] Esecuzione richieste definite nella spec contro endpoint reale o mock
- [ ] Confronto risposta vs schema: campi mancanti, type mismatch, formati errati, status code inattesi
- [ ] Report pass/fail per ogni operazione con dettaglio violazione espandibile
- [ ] Export report Markdown e JUnit XML
- [ ] Modalità headless / CI (eseguibile da CLI)

---

## 3. Reverse API Explorer — Spec da Traffico

**Problema risolto:** molte API legacy o interne non hanno documentazione. I developer devono reverse-engineerarle a mano, un endpoint alla volta.

**Perché è innovativo:** nessun API client lo fa built-in. Esistono tool separati (swagger-autogen, har2openapi) ma richiedono setup e CLI. adOmnia integra il proxy che già cattura il traffico: il passo ulteriore è naturale.

**Checklist implementazione:**
- [ ] Origine traffico: selezione voci dal Proxy Interceptor
- [ ] Origine traffico: import da file HAR
- [ ] Raggruppamento automatico per path template (`/users/123` → `/users/{id}`)
- [ ] Inferenza schema body richiesta e risposta da campioni multipli (merge esempi)
- [ ] Rilevamento autenticazione (Bearer, Basic, API Key) dai pattern negli headers
- [ ] Estrazione query string, path params, headers comuni
- [ ] Generazione spec OpenAPI 3.0 completa (JSON e YAML)
- [ ] Editor spec inline con preview prima del download
- [ ] Azioni post-generazione: Scarica / Importa in Mock Server / Importa in Collection
- [ ] Modal di configurazione: range voci, base URL, nome spec

---

## 4. gRPC Mock Server

**Problema risolto:** testare un client gRPC senza un server reale è impossibile. I mock gRPC esistenti richiedono di scrivere codice o file proto a mano.

**Perché è innovativo:** nessun API client desktop fa questo. Mock gRPC esiste solo come librerie o tool separati (gripmock, grpc-mock). Integrato in adOmnia diventa immediato.

**Checklist implementazione:**
- [ ] Import schema da file `.proto`
- [ ] Import schema da reflection su server reale esistente
- [ ] Albero servizi/metodi con editor risposta JSON per ogni metodo
- [ ] Configurazione status code gRPC per metodo (OK, NOT_FOUND, INVALID_ARGUMENT, UNAVAILABLE…)
- [ ] Delay configurabile per risposta (ms)
- [ ] Supporto streaming server: sequenza di messaggi configurabile con interval ms
- [ ] Avvio server mock su porta locale configurabile
- [ ] Hit log in tempo reale: metodo, payload ricevuto, risposta inviata
- [ ] Integrazione con Flows: usa il mock gRPC come backend in workflow multi-step

---

## 5. Chaos Engineering Panel

**Problema risolto:** i developer non testano mai la resilienza della propria applicazione a meno di strumenti dedicati costosi (Chaos Monkey, Gremlin). Il testing del fallimento è sempre l'ultimo pensiero.

**Perché è innovativo:** chaos testing locale integrato in un API client non esiste. Il developer può testare la resilienza della propria app in 30 secondi senza installare nulla.

**Checklist implementazione:**
- [ ] Layer fault injection innestato sul Proxy Interceptor esistente
- [ ] Regola tipo **Latency injection**: delay fisso o range casuale (ms) per pattern URL
- [ ] Regola tipo **Error injection**: forza risposta 500/503/504 su % configurabile delle richieste
- [ ] Regola tipo **Timeout**: chiudi connessione dopo N ms senza risposta
- [ ] Regola tipo **Truncation**: tronca body risposta a N bytes
- [ ] Regola tipo **Abort**: chiudi connessione prima di inviare qualsiasi risposta
- [ ] Regola tipo **Header mutation**: rimuovi o modifica header response (es. rimuovi `Content-Type`)
- [ ] Percentuale di attivazione per regola (0–100%)
- [ ] Hit counter per regola: quante richieste hanno subito il fault
- [ ] Toggle globale "Chaos Mode attivo" con banner rosso visibile in tutta la UI
- [ ] Report: richieste totali intercettate, faults iniettati, distribuzione per tipo

---

## 6. Request Dependency Graph

**Problema risolto:** nei workflow multi-richiesta (Flows, Runner con dataset) è difficile capire quale richiesta dipende da quale, dove scorre un token, perché uno step fallisce a causa di uno step precedente.

**Perché è innovativo:** nessun API client visualizza il flusso di dati tra richieste. Postman ha i Flow ma non ha questa visione grafica delle dipendenze variabili.

**Checklist implementazione:**
- [ ] Analisi statica di Collection e Flows: rileva `{{var}}` usate in URL, body, headers, auth
- [ ] Tracciamento origine variabile: quale richiesta la estrae e con quale path (JSONPath, header, regex)
- [ ] Rendering grafo DAG con nodi (richieste) e archi etichettati con il nome variabile
- [ ] Click su nodo: pannello produces/consumes con lista variabili
- [ ] Click su arco: dettaglio path di estrazione
- [ ] Rilevamento cicli (warning) e variabili usate ma mai estratte (badge di errore)
- [ ] Modalità "esegui sottoalbero": seleziona nodo finale → esegui solo le dipendenze necessarie
- [ ] Export grafo come PNG o SVG

---

## 7. API Response Evolution Tracker

**Problema risolto:** le API in sviluppo cambiano continuamente. I developer non hanno uno strumento per capire cosa è cambiato tra una versione e l'altra di una risposta.

**Perché è innovativo:** non esiste in nessun API client. È il "git blame" delle risposte API. Particolarmente utile per chi integra API di terze parti o monitora microservizi in evoluzione.

**Checklist implementazione:**
- [ ] Toggle "Track" per singola richiesta nella Collection
- [ ] Snapshot automatico della struttura schema risposta ad ogni run (campi, tipi, presenza — non valori)
- [ ] Mini timeline inline nel Response Panel: ultimi N run con punti colorati
- [ ] Colori timeline: verde = campo aggiunto, rosso = campo rimosso, giallo = tipo cambiato, grigio = invariato
- [ ] Diff schema tra due run selezionabili con visualizzazione side-by-side
- [ ] Alert configurabile per endpoint: "notifica se campo scompare" / "notifica se tipo cambia"
- [ ] Sezione dedicata "Evolution" con lista endpoint tracciati e timeline completa
- [ ] Export timeline come report Markdown

---

## 8. Local Security Fuzzer

**Problema risolto:** il security testing di un'API richiede tool separati (Burp Suite, OWASP ZAP) complessi e costosi. I developer non testano mai la sicurezza delle proprie API localmente.

**Perché è innovativo:** security fuzzing integrato in un API client non esiste. Nessuno che usa Postman o Insomnia fa fuzzing. adOmnia lo renderebbe accessibile in 2 click, tutto locale.

**Checklist implementazione:**
- [ ] Lancio fuzzer da richiesta catturata (Proxy) o da richiesta in Collection
- [ ] Selezione campi da fuzzare: headers, body fields, query params, path params
- [ ] Categoria probe **Injection**: SQL injection, XSS, command injection, path traversal
- [ ] Categoria probe **Boundary**: null, stringa vuota, intero overflow, array vuoto, JSON malformato
- [ ] Categoria probe **Encoding**: doppio URL-encode, Unicode surrogate, null bytes
- [ ] Categoria probe **Oversized**: payload 1KB / 10KB / 100KB / 1MB / 10MB
- [ ] Categoria probe **Auth bypass**: token malformato, token scaduto, token vuoto
- [ ] Esecuzione varianti in parallelo con progress bar e risultati live
- [ ] Classificazione anomalie: 500 = possibile crash, 200 inatteso = possibile bypass, lentezza = possibile DoS
- [ ] Report con severity (info/warning/critical) e diff risposta vs baseline
- [ ] Export report Markdown

---

## 9. Mock Server da Spec OpenAPI (Auto-Mock)

**Problema risolto:** quando si sviluppa un frontend o un microservizio, spesso il backend non è ancora pronto. Configurare manualmente un mock server endpoint per endpoint è lento e noioso.

**Perché è innovativo:** Prism di Stoplight fa qualcosa di simile ma è CLI e non è integrato in un API client. adOmnia lo rende un'operazione a un click, con il mock subito modificabile nella UI.

**Checklist implementazione:**
- [ ] Import spec OpenAPI 3.0 da file, URL o testo nel pannello Mock Server
- [ ] Preview: lista N endpoint che verranno generati prima di confermare
- [ ] Opzione "Usa esempi dalla spec" (usa i `examples` definiti nella spec)
- [ ] Opzione "Genera con faker" (genera valori realistici dagli schema types/formats)
- [ ] Opzione "Solo scheletro" (body vuoto, solo status code corretto)
- [ ] Status code realistici automatici: 200 GET, 201 POST, 204 DELETE, 422 validation error
- [ ] Varianti errore preconfigurate: 404 not found, 400 bad request, 401 unauthorized
- [ ] Headers corretti automatici: `Content-Type`, `Location` per 201
- [ ] Tutti gli endpoint generati appaiono nell'editor mock e sono immediatamente editabili
- [ ] Badge "Auto-generated from spec" su ogni endpoint generato
- [ ] Aggiornamento incrementale: reimporta spec aggiornata → aggiorna solo endpoint cambiati

---

## 10. Global Auth Manager (Multi-Profile)

**Problema risolto:** in progetti con decine di API, ogni richiesta ha la sua auth configurata a mano. I token OAuth2 scadono silenziosamente. Non c'è visibilità su quante credenziali stai gestendo o quando scadranno.

**Perché è innovativo:** Postman ha qualcosa di simile ma cloud. Nessun tool locale gestisce il ciclo di vita dei token in modo centralizzato con scadenze e auto-refresh.

**Checklist implementazione:**
- [ ] Registro centrale profili auth: OAuth2, API Key, Bearer token, AWS credentials, certificati mTLS
- [ ] Per ogni profilo: nome, tipo, credenziali, data scadenza, data ultima validazione
- [ ] Timeline scadenze: vista lista con giorni rimanenti e badge verde/giallo/rosso
- [ ] Auto-refresh OAuth2: rinnova access token prima della scadenza usando il refresh token
- [ ] Notifica in-app configurabile: "avvisami N giorni prima della scadenza"
- [ ] Test credenziali: endpoint probe configurabile per verificare validità token
- [ ] Assegna profilo a Collection (eredita a tutte le richieste) o a singola richiesta come override
- [ ] Campo auth Composer: opzione "Usa profilo globale" con dropdown profili
- [ ] Integrazione Vault: salva credenziali cifrate invece che in chiaro
- [ ] Import/export profili come JSON (cifrato se Vault attivo)

---

## RIEPILOGO PRIORITÀ

| # | Funzionalità | Pilastro | Impatto | Difficoltà | Unicità |
|---|-------------|----------|---------|------------|---------|
| 1 | AI Assistant Locale (Ollama) | Local-First | ★★★★★ | ★★★☆☆ | ★★★★★ |
| 2 | Contract Testing Engine | Enterprise | ★★★★★ | ★★★★☆ | ★★★★☆ |
| 3 | Reverse API Explorer | Enterprise | ★★★★☆ | ★★★★☆ | ★★★★★ |
| 4 | gRPC Mock Server | Enterprise | ★★★★☆ | ★★★★☆ | ★★★★★ |
| 5 | Chaos Engineering Panel | Local-First | ★★★★☆ | ★★★☆☆ | ★★★★★ |
| 6 | Request Dependency Graph | Extensible | ★★★☆☆ | ★★★★☆ | ★★★★☆ |
| 7 | API Response Evolution Tracker | Local-First | ★★★★☆ | ★★★☆☆ | ★★★★★ |
| 8 | Local Security Fuzzer | Enterprise | ★★★★☆ | ★★★★☆ | ★★★★★ |
| 9 | Mock Server da Spec OpenAPI | Extensible | ★★★★★ | ★★★☆☆ | ★★★★☆ |
| 10 | Global Auth Manager Multi-Profile | Enterprise | ★★★★★ | ★★★☆☆ | ★★★★☆ |

**Quick-win (alto impatto, difficoltà contenuta):** #1 AI Ollama · #5 Chaos · #7 Evolution Tracker · #9 Auto-Mock · #10 Auth Manager

**Flagship (alto impatto, alta unicità, più lavoro):** #3 Reverse Explorer · #4 gRPC Mock Server · #8 Fuzzer
