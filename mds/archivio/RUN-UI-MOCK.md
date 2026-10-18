# Run UI — mock a bassa fedeltà (Fase 4, 2026-10-18)

Barra di esecuzione: `[ configurazione ▾ ]  ▶ Run  Debug  Test  Edit`.
Il form vive soltanto nel gestore Edit.

```text
┌ Run configurations ───────────────────────────────────────────┐
│ Salvate             │ Nome                       Pin · Git     │
│ ▸ api               │ Provider / tipo                         │
│   frontend          ├ Configurazione · Ambiente · Task ───────┤
│   script            │ Campi base forniti dallo schema         │
│                     │ Working directory · Arguments           │
│                     │ ▸ Advanced                              │
│ + New configuration │                                         │
├─────────────────────┴─────────────────────────────────────────┤
│ Feedback inline                           Close    Save        │
└───────────────────────────────────────────────────────────────┘
```

- Nuova: proposte rilevate, conferma in un click; tipi manuali raggruppati per provider; generico sempre disponibile.
- Stesso form per Go, web, Java e generico. I campi specifici derivano da `GetRunSchema`; campi comuni e tool condivisi da descrittori riusati.
- Tab per Environment, Before/After launch, Run target e Restart: un solo pannello attivo, altezza limitata; nessuna pagina di campi a scroll infinito.
- Base sempre visibile nella scheda Configuration, Advanced chiuso inizialmente. Nessun campo Go nel form comune.
- `gs-*`, token di tema e lucide-react; controlli compatti, focus visibile, footer persistente e messaggi accessibili.
- Dati locali e condivisione tramite il file Git esistente: pilastri Local-first e User-extensible.
- `rules/web/design-quality` non presente nel checkout: applicate le regole di CLAUDE.md e docs/SOUL.md.

## Accettazione manuale ancora da eseguire

1. Windows, Go: Edit una configurazione esistente, vedere i campi base e Advanced chiuso; modificare GOOS/tag senza duplicati. Salvare, duplicare, rinominare, pin e Share; riaprire e verificare i valori.
2. Web/Vite: New → proposta dev, creazione con un click; Run apre il flusso preview esistente. Test nel monorepo usa l'unità web selezionata. Debug indisponibile spiega il motivo.
3. Generico: Shell command o Executable; argomento con spazi resta un argomento; provare un errore di salvataggio e Retry del rilevamento/schema.
4. Environment: scegliere preset e percorso custom, override e Secret. Prima/dopo: aggiungere, riordinare e rimuovere i task. Run target: Local e Dev Container. Controllare Restart e la riapertura delle configurazioni.
5. Tastiera e light/dark; su Linux WebKitGTK controllare select/input/textarea nativi in dark. Nessuna di queste prove è coperta dal solo build.
