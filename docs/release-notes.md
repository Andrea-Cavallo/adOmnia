# Release Notes - Desktop UI Refresh

Data: 2026-06-15

Questa nota riassume gli ultimi miglioramenti all'esperienza desktop di adOmnia, con focus su hub principale, navigazione laterale e LaTeX Studio.

## Highlights

- Hub principale tornato compatto: le aree prodotto non sono piu' tutte aperte al primo accesso.
- Nuove voci mantenute nell'hub: API, documenti, Git, infrastruttura, debug, dati e power tools restano raggiungibili.
- Espansione progressiva: cliccando una sezione dell'hub si apre il contenuto inline, senza entrare subito in una pagina.
- Menu laterale piu' diretto: clic su `GIT` apre subito Git Sync, senza sottomenu inutile.
- Primo preset LaTeX aggiornato: il template resume ora replica un formato classico da Software Engineer Resume.
- API Docs ora puo' salvare la documentazione OpenAPI dentro una collection e usare l'AI configurata per generare o migliorare descrizioni.

## Hub Principale

L'hub desktop e' stato ripulito per tornare al comportamento precedente: una vista iniziale compatta, piu' simile a una dashboard di orientamento che a una pagina gia' completamente esplosa.

Ora l'utente vede quattro sezioni principali chiuse:

- `API & Protocols`
- `Documents`
- `Version Control`
- `Infra - Debug - Data - Power`

Ogni sezione mostra una riga sintetica con contesto e statistiche. Il click sulla riga espande la sezione dentro l'hub; solo il click su uno strumento specifico apre il pannello dedicato.

Questo riduce rumore visivo, evita navigazioni accidentali e rende l'ingresso nell'app piu' ordinato.

## Navigazione Laterale

La voce `GIT` nel menu sinistro ora apre direttamente la pagina Git Sync.

Prima il click apriva un piccolo pannello con una sola voce `Git Sync`, creando un passaggio superfluo. Ora il comportamento e' piu' coerente: se una voce ha una sola destinazione reale, porta direttamente li'.

## LaTeX Studio

Il primo esempio di resume nel LaTeX Studio e' stato sostituito con un template classico in stile Software Engineer Resume:

- intestazione con nome a sinistra e contatti a destra;
- sezioni `Education`, `Experience`, `Projects`, `Programming Skills`;
- tipografia piu' sobria e compatta;
- linee orizzontali sottili tra le sezioni;
- contenuto di esempio allineato al formato mostrato nel riferimento.

Anche la preview interna e' stata aggiornata per rappresentare meglio il layout classico del template, evitando lo stile moderno precedente con accenti colorati e chip.

## API Docs e AI

Il pannello API Docs non e' piu' soltanto un viewer temporaneo. Dopo aver generato, incollato o caricato un documento OpenAPI, l'utente puo' scegliere una collection e salvare la documentazione dentro quella collection.

Il salvataggio usa lo stesso campo `_openapiSpec` gia' usato dall'OpenAPI Contract Editor, quindi la documentazione resta disponibile nei flussi successivi e viene persistita nello storage locale del workspace.

E' stato aggiunto anche un flusso AI reale:

- `Generate docs with AI` crea o arricchisce un documento OpenAPI partendo dalle collection selezionate.
- `Improve with AI` migliora summary, description, tag e response descriptions del documento gia' aperto.
- L'output AI viene validato come OpenAPI prima di essere mostrato.
- Il risultato non viene salvato automaticamente: l'utente lo revisiona e poi preme `Save docs`.

L'AI usa il provider configurato in `Settings > AI Engine` e mantiene il principio local-first: nessuna chiamata AI parte se l'utente non abilita/configura esplicitamente il motore.

## Impatto Utente

- Primo avvio piu' pulito e meno dispersivo.
- Meno click inutili nella navigazione.
- Maggiore coerenza tra hub, rail laterale e pannelli reali.
- LaTeX Studio piu' utile per chi vuole partire da un resume tecnico tradizionale.
- Documentazione API persistente e migliorabile con AI direttamente dentro adOmnia.

## Verifica

Controllo frontend eseguito:

```bash
cd frontend
npm run build
npm run test -- parseSpec
```

Risultato: build completata correttamente.
