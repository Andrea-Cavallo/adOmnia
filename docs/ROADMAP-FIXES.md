# Roadmap dei fix dopo 1.0.2

Aggiornata il 15 ottobre 2026. Fonte operativa: [mds/FIX.md](../mds/FIX.md). Le versioni sono obiettivi indicativi; i gate di test e verifica desktop governano la chiusura delle voci.

| Versione obiettivo | Lavoro rimanente | Dipendenze e accettazione |
|---|---|---|
| 1.0.3 | Chiudere le prove native di IDE-1, IDE-2, GS-1, GS-2, GS-3 e DB-2; splitter visibili nei temi scuri (GS-5), selettore unico dei provider AI (GS-4). | Update/rollback firmato, conhost e Windows Terminal, Run/Debug/coverage nell'app, portali aziendali, DB con password dopo reload/riavvio e recupero del server. Nessuna casella manuale chiusa dai soli test automatici. |
| 1.0.4 | Import graph leggibile e navigabile (IDE-3), vista Goroutines (IDE-4). | Riuso della barra attività; layout e filtri, focus/pan/zoom, test sui grafi condivisi; acquisizione goroutine, cancellazione e limiti dei dati. |
| 1.0.5 | Anteprima Markdown predefinita (GS-7), Mermaid nell'editor (GS-8), Git come tool window IDE (GS-9). Poi pulizia del Hub (GS-6). | Document Studio/Git si rimuovono dal Hub solo dopo aver verificato i percorsi equivalenti nell'IDE. |
| 1.1.0 | Valori annidati, Cell Inspector e schermo intero nei risultati DB (DB-1); console per categoria, template/snippet, schema condiviso e completamento contestuale (DB-3 fase 1). | Connessioni DB-2, compatibilità BSON/JSON, limiti dei dati e prove SQL/Mongo/Redis nei due temi. |
| 1.1.1 | Interprete query e rischio, stima esplicita dell'impatto, esecuzione selezione/statement e conferme coerenti con il backend (DB-3 fase 2). | Tokenizer e test dei casi limite SQL; nessuna stima se la riscrittura COUNT non è sicura. |
| 1.2.0 | Suggerimenti AI facoltativi per query, disattivati di default (DB-3 fase 3); cronologia/preferiti strutturati e migrazione (DB-3.4). | Solo azioni esplicite, schema redatto senza righe dati, anteprima prima dell'inserimento, nessuna esecuzione automatica. |

## Lavoro trasversale

- **IDE-5 e GS-10:** riprodurre prima le cause ipotizzate; anticipare i P1 che bloccano l'uso. Poi accessibilità di albero/tab, overflow, feedback asincrono, token dei colori e coerenza dei dialoghi. Le voci duplicate IDE-5.7/GS-10.7 e IDE-5.8/GS-10.12 hanno una sola implementazione.
- **Prestazioni:** [piano di misurazione e ottimizzazione](../mds/REFACTOR.txt). Prima baseline e profili, poi interventi misurati; il documento è una proposta di lavoro, non una dichiarazione di ottimizzazioni già eseguite.
- Ogni fase aggiorna registro evidenze, migrazioni e documentazione. Le revisioni indipendenti restano distinte dalla revisione dell'autore.
