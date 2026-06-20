# GIT_FEATURE_AUDIT.md

**Audit della sezione Git di adOmnia vs. client Git professionale (GitKraken-class)**
Aggiornato: 2026-06-20 · Branch: `master`

> Lo storico degli interventi completati è ora nel changelog di release (`CHANGELOG.md`, `[0.4.0]`). Questo file elenca **solo il lavoro residuo**.

---

## Stato

| Metrica | Conteggio | % |
|---------|-----------|---|
| Feature **complete** | 34/40 | **85%** |
| Feature **parziali** | 1/40 | ~2% |
| Feature **mancanti** | 5/40 | ~13% |

Lo strato "single-repo / single-developer" è completo. Il divario residuo è quasi tutto nello strato **collaborazione/hosting** (Pull Request, account host) e richiede decisioni di prodotto (host supportati, modello OAuth/token, storage credenziali in `vault.go`) prima di partire.

---

## Lavoro residuo

### 🟡 Parziale (1)

| # | Feature | Stato | Note |
|---|---------|-------|------|
| 26 | Integrazione GitHub/GitLab/Bitbucket/Azure | **Parziale** | Solo deep-link web (commit/compare) con host detection inclusa Azure DevOps. Mancano API/auth/oggetti remoti. |

### 🔴 Mancanti (5)

| # | Feature | Priorità | Note |
|---|---------|----------|------|
| 27 | Creazione e gestione Pull Request | **Alta** | Nessuna creazione PR (al più apre la compare-URL nel browser). Dipende da integrazione API host (#26) e credenziali (#34). |
| 28 | Visualizzazione PR aperte | **Alta** | Nessuna lista PR. Dipende da #26/#34. |
| 34 | Credenziali e account host multipli | **Alta** | Delega al credential helper di sistema; nessuna UI. Storage token/OAuth in `vault.go`. |
| 31 | Generazione AI descrizione PR | Media | Titolo+body dal range. Dipende da #27. |
| 29 | Terminale integrato sul repo | Media | Nessun terminale embedded (richiede PTY cross-platform con CWD sul repo attivo). |

---

## Roadmap residua

**Fase 4 — AI**
- **4.3 Descrizione PR generata (#31)** — una volta presenti le PR, generare titolo+body dal range. *Complessità:* **M**. *Dipendenze:* 5.1.

**Fase 5 — Enterprise / collaborazione**
- **5.1 Integrazione host: PR create/list (#26–28)** — provider con OAuth/token in vault, lista PR aperte, creazione PR dal branch pushato. *Complessità:* **XL**. *Dipendenze:* credenziali (5.2). *Criteri:* da un branch pushato si apre una PR senza lasciare adOmnia; lista PR navigabile.
- **5.2 Account/credenziali host multipli (#34)** — token/OAuth per host con auto-switch per remote. *Complessità:* **L**. *Dipendenze:* `vault.go`. *Criteri:* push su host A usa l'identità A, su host B l'identità B, senza intervento manuale.
- **5.3 Terminale integrato (#29)** — terminale embedded con CWD sul repo attivo. *Complessità:* **L** (PTY cross-platform). *Criteri:* i comandi git eseguiti nel terminale si riflettono al refresh del pannello.
