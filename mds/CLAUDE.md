# CLAUDE.md — regole per `mds/`

Cartella dei **piani di lavoro** di adOmnia: code, piani per area, verifiche manuali. Non contiene codice: ogni modifica qui è documentale e deve restare coerente col codice e con gli altri documenti.

## Mappa dei file

| File | Contenuto | Non metterci |
|------|-----------|--------------|
| `README.md` | Indice dei piani (`01…06`, più i piani trasversali) e regole minime | Voci di lavoro |
| `01…06-*.md` | Piani per area, in ordine di esecuzione (06 continua `MULTILANGUAGE-IDE.md` e si esegue prima di 04–05) | Verifiche manuali |
| `MULTILANGUAGE-IDE.md` | Piano Code Studio multi-linguaggio: **solo lavoro aperto** con priorità P0–P3, **§9.6 Rust (RS-0–RS-10)** e **AG** (workflow agenti) | Verifiche manuali (stanno in `MANUAL-CHECK.md`), lavoro già chiuso |
| `MULTILANGUAGE-IDE-DONE.md` | Archivio del lavoro multi-linguaggio completato (fasi 1–8, Java 9.4.x, Python PY-*, Fase 10) con evidenze e registro avanzamento | Voci aperte |
| `SECURITY-INTELLIGENCE-HANDOFF.md` | Handoff del motore di sicurezza delle dipendenze (engine + adapter per ecosistema) | Piani o verifiche manuali |
| `COVERAGE-RIENTRO.md` | Rientro del gate Sonar `new_coverage` (misura, ondate, regole di ingaggio, strumenti) | Verifiche manuali (stanno in `MANUAL-CHECK.md`) |
| `FIX.md` | Code unica del lavoro (IDE, Go Studio/Hub, Database) + regole 0.1–0.8 | Verifiche che richiedono l'app in esecuzione |
| `MANUAL-CHECK.md` | **Unico** file delle verifiche manuali (voci `…M*`, riproduzioni nell'app, gate manuali) | Codice, test automatici |
| `REFACTOR.md` | Piano di refactor | — |
| `archivio/` | Solo consultazione (`todo-ide.md` originale, già fuso in 03) | **Non aggiornarlo mai** |

## Regole

1. **Una cosa è "fatta" solo con la prova** (regola 0.1 di `FIX.md`): codice nel repo + test automatico rosso→verde + comandi di verifica eseguiti davvero + verifica manuale nell'app per ciò che ha UI. Non valgono "dovrebbe funzionare", "in teoria", "il codice è corretto", "compila" (regola 0.2).
2. **Tutto ciò che richiede l'app in esecuzione** si scrive solo in `MANUAL-CHECK.md`: voci `…M*`, riproduzioni nell'app, verifiche delle voci `IMPLEMENTATO`, gate manuali, ispezioni visive. In `FIX.md` restano codice, test automatici ed evidenze di build. Non creare altri file di verifiche manuali.
3. **Stessi ID** tra `FIX.md` e `MANUAL-CHECK.md` (es. `GS-9.M1`). Quando una verifica è eseguita: spuntare la voce in `MANUAL-CHECK.md` → spuntare la casella in `FIX.md` → aggiornare **entrambe** le tabelle "Stato a colpo d'occhio".
4. **Niente file sparsi**: un'idea o un bug nuovo va nel file della sua area. Non creare `TODO-*.md`, checklist parallele o duplicati (es. `MANUAL-CHECKS.md`, fuso e cancellato il 2026-10-15).
5. **Documenti allineati quando cambia un comportamento** (regola 0.5 di `FIX.md`): `docs/CODE-STUDIO.md`, `docs/ISSUES.md`, `docs/adomnia-feature-catalog.en.md`, `README.md`, sezione sicurezza del `CLAUDE.md` root, e ogni modifica allo storage/shortcut.
6. **I riferimenti `file:riga` sono stati letti, non eseguiti**: rileggere le righe citate prima di modificare; il codice può essere cambiato.
7. **Una voce = una modifica rivedibile**; non mescolare fix indipendenti. Voce bloccata → non spuntare, scrivere `BLOCCATO: motivo, chi sblocca`. Voce inutile o già a posto → `[x]` solo con la nota `GIÀ OK: evidenza`.
8. **Gate delle sezioni**: chi implementa compila Impl / Test / Manuale / Doc; la casella "Verificato da altra persona/agente" la spunta qualcun altro rileggendo evidenza e diff.
9. **Lingua e stile**: documenti in italiano, stessa struttura delle sezioni già presenti. Non riscrivere interi file per cambi puntuali.
10. **In caso di conflitto vince `FIX.md` §0** (regole complete: comandi di verifica proporzionati, responsabilità, regole di repo). Questo file riassume; non lo contraddice.

## Prima di scrivere qui

- Rileggere la sezione che si modifica: gli stati rispecchiano il codice alla data in testa al file; riverificare prima di agire.
- Verifiche proporzionate durante le feature (`go test ./internal/<dominio>/...`, vitest mirati + `npx tsc --noEmit`); suite complete al rilascio o su regressione. Vedi `FIX.md` 0.4 e la root `AGENTS.md`.
- Chiudere una voce = registrare l'evidenza (comando + esito, screenshot o hash del commit) nel Registro indicato dalla sezione.
