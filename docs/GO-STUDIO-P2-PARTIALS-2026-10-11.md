# Go Studio P2 — integrazioni parziali completate

Data: 2026-10-11. Stato: implementazione verificata; accettazione desktop completa ancora aperta in [todo-ide.md](../mds/todo-ide.md). Nessuna nuova release pubblicata.

- [x] Il distributed debugger collega i due servizi. — Trace Studio arma 2–16 progetti identificati senza ambiguità, prepara i breakpoint e avvia/riusa Delve. Una richiesta conserva i membri, i breakpoint di ciascun servizio e la goroutine; pausa/continua e navigazione usano il servizio effettivo. Gruppo transitorio condiviso fra pannelli tramite BroadcastChannel; membri obsoleti rifiutati. Correlazione dei breakpoint temporale, indicata come probable, non identificazione certa della request nella goroutine.

- [x] Service boundaries. — Navigazione parent/child fra servizi dai veri span ID e parent span ID della trace ricevuta. Un parent assente è dichiarato non acquisito: nessun confine inventato. Richiede strumentazione OpenTelemetry e propagazione del trace context nei servizi.

- [x] mTLS. — File PEM del progetto → Settings / Requests: percorso proposto, applicazione esplicita, passphrase e client HTTP esistenti. Il PEM deve contenere certificato e chiave; non converte un solo .crt in una coppia utilizzabile.

- [x] JKS/PKCS12 helper integration dove utile. — .jks/.p12/.pfx dal Project tree → PEM/JKS: lettura binaria confinata al progetto, limite 8 MiB, ispezione senza password persistita. JKS riusa lo split locale esistente con keytool/OpenSSL; PKCS12 riusa l’ispezione esistente, non introduce estrazione di chiavi PKCS12.

- [x] Legacy SOAP services. — .xml/.wsdl → SOAP Studio attraverso entity router; envelope standalone con endpoint e SOAPAction modificabili, invio esplicito e strumenti SOAP esistenti.

- [x] WSDL. — .wsdl dal Project tree → import WSDL e selezione service/port/operation in SOAP Studio; preserva il buffer non salvato.

- [x] XML. — .xml/.xsd/.wsdl → XML Tools: format, validazione sintattica, XPath e diff esistenti. Non equivale a validazione XSD semantica.

- [x] WS-Security tooling. — .xml/.wsdl → SOAP Studio con configurazione WS-Security visibile; riusa UsernameToken disponibile, senza aggiungere WS-Security signature/encryption.

Non chiude le sei voci P2 indipendenti: dev container, cattura gRPC, cattura goroutines completa, retry → policy, cache hit/miss e generazione unit test. Gli ID goroutine dei breakpoint sono parte del debug distribuito, non una cattura completa delle goroutines.

Compatibilità: campi sessionIds e sessionId/threadId dei hit sono additivi; i vecchi DTO continuano a funzionare. Il gruppo non viene persistito né riattivato al riavvio. Nessuna modifica del formato .adomnia.

Verifica: TypeScript, build frontend, startup sotto 650 kB, suite frontend completa, test backend della pausa/continua nel secondo servizio e della lettura binaria confinata. Wails beta.28 compila e avvia WebView2/sidecar; uso manuale di due servizi e certificati reali resta nel documento di collaudo.

Verifica finale: `go build ./...` e `go test ./... -timeout 10m` passati; frontend 312 file / 1363 test, TypeScript e build passati; startup 599359 byte.
