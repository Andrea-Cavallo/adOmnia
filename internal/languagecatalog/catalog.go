// Package languagecatalog is the single composition of the built-in language adapters.
//
// The desktop host (internal/codestudio) and the CLI (internal/adomniacli, the `adomnia mcp`
// server) register exactly the same set: a second list would drift. Adapters still never
// import a host, so this package only depends on their public constructors.
package languagecatalog

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/declared"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/golang"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/java"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/python"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/rust"
	"github.com/Andrea-Cavallo/adOmnia/internal/languages/web"
)

// Adapters returns the built-in adapters in registration order.
func Adapters() []language.Language {
	adapters := append([]language.Language{golang.New()}, web.Languages()...)
	adapters = append(adapters, java.New(), python.New(), rust.New())
	return append(adapters, declared.Languages()...)
}

// NewRegistry returns a registry with every built-in adapter registered. A duplicate ID is a
// programming error and panics: it must be seen at startup, not silently ignored.
func NewRegistry() *language.Registry {
	registry := language.NewRegistry()
	for _, adapter := range Adapters() {
		if err := registry.Register(adapter); err != nil {
			panic(err)
		}
	}
	return registry
}
