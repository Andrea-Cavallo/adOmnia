# Release Notes — Request Editor Hierarchy

Data: 2026-06-21

## Panoramica

L'editor delle request ora distingue chiaramente tre livelli che prima avevano quasi lo stesso peso visivo:

1. navigazione principale della request;
2. esempi e varianti del body;
3. formato tecnico del payload.

Il nuovo layout rende immediatamente riconoscibile la relazione tra una sezione come `Body`, una variante come `Bonifico SEPA` e un formato come `JSON`.

## Tab principali della request

Le sezioni `Overview`, `Body`, `Auth`, `Headers`, `Cookies`, `Params`, `Scripts`, `Tests` e `Notes` sono ora veri tab compatti:

- area cliccabile più ampia;
- icona dedicata;
- testo e contrasto più leggibili;
- badge numerici in pill;
- stato attivo con sfondo pieno e bordo cyan marcato;
- hover e focus ring visibili;
- separazione più netta dal contenuto sottostante.

## Varianti del body

Gli esempi del body sono diventati tab-card orizzontali con:

- sfondo e bordo visibili anche quando inattivi;
- barra cyan superiore sulla variante attiva;
- titolo su massimo due righe con ellissi e tooltip completo;
- indicazione del formato corrente, come `JSON`, `URL ENCODED` o `FORM DATA`;
- pulsante `×` al passaggio del mouse;
- menu contestuale `⋮` con rinomina, duplicazione ed eliminazione;
- pulsante separato `New body` per aggiungere un nuovo esempio;
- scorrimento orizzontale quando le varianti non entrano nello spazio disponibile.

Tutte le azioni modificano realmente la request e preservano sempre almeno una variante valida.

## Formato del payload

I formati mutuamente esclusivi sono ora raccolti in un segmented control dedicato:

- `JSON`;
- `Raw`;
- `URL Encoded` (`application/x-www-form-urlencoded` nel tooltip);
- `Form Data`;
- `GraphQL`.

Il formato attivo usa bordo e fondo cyan, mentre gli altri rimangono raggruppati su uno sfondo comune. La toolbar JSON è stata separata visivamente e mostra azioni più leggibili per `Pretty`, `Graph` e validazione.

## Accessibilità e coerenza

- Semantica `tablist`, `tab` e `radiogroup` per le tre gerarchie.
- Focus ring da tastiera su tab, card, menu e formati.
- Tooltip espliciti sulle azioni e sui nomi troncati.
- Colori basati sui token del tema adOmnia.
- Nessun cambiamento al formato dei workspace o ai dati salvati.

## Verifica

Controlli completati:

```bash
cd frontend
npm run build
npx tsc --noEmit
npm test -- --run src/components/ui/ContextMenu.test.ts
```

Build di produzione, controllo TypeScript e test del menu contestuale superati.
