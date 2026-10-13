# 02 · UI desktop — verifiche visive e rifiniture

Aggiornato: 2026-10-13. Indice: [README.md](README.md). Questi punti sono implementati e verificati a build/test; manca **la prova visiva nell'eseguibile Wails**, che nessun test automatico sostituisce (vedi CLAUDE.md: coerenza visiva = priorità di prodotto).

## Smoke test dell'app compilata (una sola sessione, ~30 min)

Eseguirli insieme: servono gli stessi prerequisiti (build desktop corrente, skin chiara e scura, una palette custom).

- [ ] **Shell API (ex A7 della collaborazione):** tab in stile browser, Send, composer a scomparsa, selettori Environments/Hosts nell'header (click nella zona titlebar), drag/reorder/detach dei tab, navigazione da tastiera.
- [ ] **Toolbar API compatta:** skin chiara/scura, palette, menu, molte tab, tab pinnate, ridimensionamento. (Fatto in codice: Body/Headers/Params e toolbar Body sempre visibili; titoli Nothing; barra 40 px, tab 32 px con overflow ricalcolato.)
- [ ] **Errori API stile Nothing:** riprodurre *Connection refused* e controllare Dark/White e accenti personalizzati (titolo dot-matrix, riquadro dettagli, badge).
- [ ] **Etichette REQUEST / RESPONSE / SEND** seguono l'accento: verificate nel browser locale con `#FACC15` (`rgb(250, 204, 21)`, screenshot `.artifacts/api-nothing-yellow-labels.png`); da ripetere nell'eseguibile.

## Icona nativa Windows e palette

- [x] Logo nativo originale bianco/nero secondo la skin ripristinato.
- [x] Cambi skin coalescenti (si applica solo la modalità più recente).
- [x] Test Windows con HWND reale: icone piccola/grande, cambio skin, creazione colore.
- [ ] Verifica visiva nella taskbar con l'app compilata: skin bianca/nera, palette custom, DPI, finestre separate.
- [ ] **Colorazione nativa secondo palette: disattivata** dopo la regressione segnalata nella taskbar. Riattivare solo dopo aver verificato forma, trasparenza e colore.
- [ ] Linux launcher / macOS Dock: cambio colore palette ancora da implementare (il cambio light/dark preesistente resta).

Nota: l'icona aggiornata vale per l'app in esecuzione; la risorsa dell'EXE e il collegamento pinnato ad app chiusa restano statici (Windows può mantenere la cache del collegamento).

## Documentazione visiva

- [ ] Rinnovare gli screenshot del README con la build desktop corrente (quelli attuali sono reali ma precedenti agli ultimi ritocchi toolbar).
- [ ] Copiare nel repo i due mockup approvati per M8 (oggi in cartelle personali, uno dei due manca) — vedi [03](03-GO-STUDIO-PIANO-UNIFICATO.md#riferimenti-grafici-approvati-per-m8).
