package jsonutil

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"io"
)

// Questi wrapper sono encoding/json/v2 con l'ordinamento deterministico delle chiavi di map:
// in v1 le mappe erano marshallate in ordine stabile, in v2 no, e adOmnia confronta e conserva
// JSON (export di collezioni, revisioni canoniche, firme di manifest, test): l'output non può
// dipendere dall'iterazione delle map. È la forma standard di marshalling del progetto: usare
// queste funzioni (o passare json.Deterministic(true)) per ogni nuovo codice.
// json.Deterministic è applicato per ultimo: vince su qualsiasi altra opzione passata.

// Marshal serializza v con le chiavi di map in ordine deterministico.
func Marshal(v any, opts ...jsontext.Options) ([]byte, error) {
	return json.Marshal(v, append(opts, json.Deterministic(true))...)
}

// MarshalWrite scrive v su w con le chiavi di map in ordine deterministico.
func MarshalWrite(w io.Writer, v any, opts ...jsontext.Options) error {
	return json.MarshalWrite(w, v, append(opts, json.Deterministic(true))...)
}

// MarshalEncode codifica v su un encoder jsontext con le chiavi di map in ordine deterministico.
func MarshalEncode(out *jsontext.Encoder, v any, opts ...jsontext.Options) error {
	return json.MarshalEncode(out, v, append(opts, json.Deterministic(true))...)
}
