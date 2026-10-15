# Database Studio: connessioni e credenziali

Da 1.0.2 password e Raw DSN vengono cifrati automaticamente prima di salvare le connessioni nel bucket bbolt `database/connections` e nel mirror `adomnia.database.connections`. La serializzazione rifiuta testo in chiaro anziché scartarlo. Una password vuota nell'editor non elimina un riferimento salvato: usare **Remove password** o **Remove DSN**. Le modifiche vengono salvate dopo una breve pausa nella digitazione o quando si lascia il campo.

La cifratura usa AES-256-GCM con nonce casuale e riferimenti `vault:local:v1:…`. La chiave master per utente è nel keychain di sistema tramite go-keyring: Credential Manager su Windows, Keychain su macOS, Secret Service su Linux. Se il keychain non è disponibile alla prima configurazione, il fallback è un file locale con permessi utente; su Windows il file contiene una chiave protetta da DPAPI. Il form segnala il fallback. Un keychain già inizializzato ma successivamente bloccato causa un errore: la chiave non viene sostituita silenziosamente.

I riferimenti locali possono essere esportati ma non sono decifrabili su un'altra installazione priva della chiave. Non esportare o condividere la chiave master. La passphrase aggiuntiva **Protect** è facoltativa: usa il Vault precedente e richiede lo sblocco dopo riavvio/auto-lock. La cifratura automatica non richiede questa passphrase e resta operativa quando il Vault si blocca.

## Connessione

**Connect** conserva un client SQL/MongoDB/Redis in Go. **Disconnect** chiude il client; una query successiva può connettersi nuovamente. Lo stato e la latenza vengono aggiornati nella lista e nel form. **Test Connection** apre, verifica e chiude un client distinto, senza modificare la sessione persistente.

Il backend controlla la connessione circa ogni 30 secondi, ritenta gli errori con backoff da 1 a 30 secondi e jitter, e chiude i client inattivi dopo 15 minuti per default. Il campo **Idle (min)** consente 1–120 minuti. **Auto-connect on selection** abilita la connessione quando si seleziona la voce; senza questa preferenza la prima query connette su richiesta.

Password e DSN salvati si risolvono solo in Go. Query e test usano l'ID della connessione; le risposte non restituiscono le credenziali. Gli errori dei driver vengono sostituiti da messaggi che non riportano URI/password.

## Compatibilità

Gli ID e gli altri campi delle connessioni restano compatibili; si aggiungono preferenze opzionali. Le credenziali in chiaro ancora disponibili vengono cifrate prima della riscrittura. I riferimenti Vault esistenti sono mantenuti quando il Vault è bloccato e possono migrare alla cifratura automatica quando vengono aperti, salvo protezione aggiuntiva scelta esplicitamente. Le password già scartate dalle versioni precedenti non sono recuperabili: reinserirle una volta.

La matrice manuale completa dei driver remoti resta tracciata in [FIX.md](../mds/FIX.md), separata dai test automatici di cifratura, riuso del client, backoff e timeout.
