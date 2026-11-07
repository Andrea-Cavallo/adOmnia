package codestudio

import (
	"github.com/Andrea-Cavallo/adOmnia/internal/ide/language"
	"github.com/Andrea-Cavallo/adOmnia/internal/languagecatalog"
)

// newLanguageRegistry è la composition root dei linguaggi: aggiungerne uno è una riga in
// internal/languagecatalog, senza toccare il core (docs/architecture/ide-package-rules.md).
func newLanguageRegistry() *language.Registry {
	return languagecatalog.NewRegistry()
}
