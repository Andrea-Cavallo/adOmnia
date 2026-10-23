# Piani di lavoro adOmnia

Tutto il lavoro ancora da fare, in un solo posto e in ordine di esecuzione. **OpenShift e Collaborazione sono volutamente gli ultimi.** Il piano 06, benché numerato per ultimo, si esegue prima di 04 e 05: continua `MULTILANGUAGE-IDE.md`.

| # | File | Che cosa contiene | Quando |
|---|------|-------------------|--------|
| 01 | [RILASCIO-V1](01-RILASCIO-V1.md) | Perimetro approvato, funzioni nascoste, gate di pubblicazione (CI, installer, updater, firma), collaudi Git/PDF/Home | Subito |
| 02 | [UI-DESKTOP-VERIFICHE-VISIVE](02-UI-DESKTOP-VERIFICHE-VISIVE.md) | Smoke test dell'app compilata: shell API, toolbar, icona nativa, screenshot README | Subito (una sessione) |
| 03 | [GO-STUDIO-PIANO-UNIFICATO](03-GO-STUDIO-PIANO-UNIFICATO.md) | Collaudo M1–M34 e gate, lacune reali, effetti Wow, funzioni 2027, Copilot Edit/Agent, idee per l'editor, qualità continua | Dopo 01–02 |
| — | [MULTILANGUAGE-IDE](MULTILANGUAGE-IDE.md) | Rename Go Studio → **Code Studio**, run provider-driven, UI Run unica, workspace multi-modulo, nuovi linguaggi: JS/TS/Java, **Python (§9.5, PY-0–PY-9)** e **Rust (§9.6, RS-0–RS-10)**, poi C#/Kotlin | Dopo il Gate Fase 1 di 03 (freeze) |
| 04 | [OPENSHIFT-KUBERNETES-STUDIO](04-OPENSHIFT-KUBERNETES-STUDIO.md) | Studio cluster per sviluppatori (nascosto in v1) | **Penultimo** |
| 05 | [COLLABORAZIONE-REALTIME](05-COLLABORAZIONE-REALTIME.md) | Collaborazione LAN su due computer, runbook A1—A6, P1/P2 (beta opt-in in v1) | **Ultimo** |
| 06 | [JAVA-SPRING-STUDIO](06-JAVA-SPRING-STUDIO.md) | Profondità JVM su Code Studio (Java/Spring/Maven/Gradle/JUnit): Spring Index, comandi Java, test per metodo, error navigation, debug con stepping filters, hot update, dipendenze, JFR | Dopo la Fase 9.4 di `MULTILANGUAGE-IDE` (Java al contratto minimo) |

**Priorità corrente (2026-10-21).** Python è implementato in Code Studio e i suoi item di codice sono chiusi: restano i collaudi `PY-M*` in `MANUAL-CHECK.md` (sezione PY), la matrice macOS/Linux (PY-0.2), la verifica manuale dell'editor (PY-4.3) e le misure di risorse (PY-8.4). Il piano **Rust** è in esecuzione avanzata: `MULTILANGUAGE-IDE.md` §9.6 (RS-0–RS-10) ha il codice di RS-0→RS-8 implementato al 2026-10-22 (vedi le note inline per i rinvii dichiarati), restano i collaudi `RS-M*` in `MANUAL-CHECK.md`, con **RS-7 (integrazione con API Workspace, Mock, Database, Live Session, Security) non opzionale** — la regola *Language parity* di `CLAUDE.md` vale anche qui. In parallelo restano i gap Java aperti (piano 06).

`archivio/` contiene l'originale di `todo-ide.md`, già fuso in 03: solo consultazione, non aggiornarlo.

## Regole

- Un'idea o un bug nuovo va nel file della sua area; non creare nuovi file `TODO-*.md` sparsi.
- Una voce si spunta solo con la **prova** (sessione desktop registrata o test indicato), non perché "il codice c'è".
- Quando cambia un comportamento, aggiornare anche i documenti elencati in CLAUDE.md (`docs/CODE-STUDIO.md`, `docs/ISSUES.md`).
- Gli stati documentati qui rispecchiano il codice alla data in testa a ciascun file; riverificare prima di agire.
