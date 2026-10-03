package goide

import (
	"adomnia/internal/ide/language"
	"adomnia/internal/languages/golang"
)

// newLanguageRegistry è la composition root dei linguaggi: aggiungerne uno è una riga qui,
// senza toccare il core (docs/architecture/ide-multilanguage-refactor.md).
func newLanguageRegistry() *language.Registry {
	registry := language.NewRegistry()
	for _, adapter := range []language.Language{golang.New()} {
		if err := registry.Register(adapter); err != nil {
			panic(err) // ID duplicato o non valido: errore di programmazione, va visto all'avvio.
		}
	}
	return registry
}
