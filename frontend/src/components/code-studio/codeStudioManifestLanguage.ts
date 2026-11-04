import type { Monaco } from '@/lib/monacoRef'

/**
 * MANIFEST.MF / `.mf` (OSGi e JAR): nome dell'header a sinistra, valori a destra, righe di
 * continuazione che iniziano con uno spazio. Monaco non ha questa grammatica, quindi la colorazione
 * è questa: nomi degli header, attributi `;nome`, operatori `:=`/`=`, versioni e booleani.
 */
export const MANIFEST_LANGUAGE: Monaco.languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      // `Bundle-SymbolicName:` — il nome dell'header è la parte prima dei due punti, che restano grigi.
      [/^([A-Za-z0-9][\w-]*)(:)/, ['type', 'delimiter']],
      // Continuazione: la riga inizia con uno spazio e appartiene al valore precedente.
      [/^\s+/, { token: '' }],
      [/;[A-Za-z0-9_.-]+(?==|:=)/, 'attribute.name'],
      [/:=|=/, 'operator'],
      // Versioni OSGi: 1.0.0.qualifier, 0.10.0, 2.3.100.v20141111-1402.
      [/\d+(?:\.\d+)*(?:[.-][A-Za-z0-9_]+)*/, 'number'],
      [/\b(?:true|false)\b/, 'keyword'],
      [/"[^"]*"/, 'string'],
      [/,/, 'delimiter'],
      [/\{\{[^}]*\}\}|%[A-Za-z0-9_]+/, 'variable'],
      [/[A-Za-z0-9_.$-]+/, { token: '' }],
      [/./, { token: '' }],
    ],
  },
}
