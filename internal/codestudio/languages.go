package codestudio

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/python"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/rust"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/web"
)

// newLanguageRegistry è la composition root dei linguaggi: aggiungerne uno è una riga qui,
// senza toccare il core (docs/architecture/ide-package-rules.md).
func newLanguageRegistry() *language.Registry {
	registry := language.NewRegistry()
	adapters := append([]language.Language{golang.New()}, web.Languages()...)
	adapters = append(adapters, java.New(), python.New(), rust.New())
	for _, adapter := range adapters {
		if err := registry.Register(adapter); err != nil {
			panic(err) // ID duplicato o non valido: errore di programmazione, va visto all'avvio.
		}
	}
	return registry
}
