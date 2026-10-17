package codestudio

import (
	"adomnia/internal/ide/language"
	"adomnia/internal/languages/golang"
	"adomnia/internal/languages/java"
	"adomnia/internal/languages/web"
)

// newLanguageRegistry è la composition root dei linguaggi: aggiungerne uno è una riga qui,
// senza toccare il core (docs/architecture/ide-multilanguage-refactor.md).
func newLanguageRegistry() *language.Registry {
	registry := language.NewRegistry()
	adapters := append([]language.Language{golang.New()}, web.Languages()...)
	adapters = append(adapters, java.New())
	for _, adapter := range adapters {
		if err := registry.Register(adapter); err != nil {
			panic(err) // ID duplicato o non valido: errore di programmazione, va visto all'avvio.
		}
	}
	return registry
}
